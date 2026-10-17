"""SIMULATED underwater port soundscape, rendered at a hydrophone array.

Everything produced here is synthetic and labelled ``source="simulated"``.
It exists so the demo works without real recordings; results on it say
nothing about real-world performance.

Each session is a *scene*: sound sources with position tracks in the
simulated harbour (``harbour.py``). Each source's sound reaches each
hydrophone after the acoustic travel time and with spherical spreading loss
(amplitude ~ 1/r), so moving sources also produce natural Doppler shift.
Ambient sea noise and snapping shrimp are local to each hydrophone.

Normal activity: ambient, shrimp, quay pump hum, chain/hull clanks, large
vessels entering/leaving (blade-rate harmonics, machinery tonals,
blade-rate-modulated cavitation), small craft (brighter, faster, some with
echo-sounder pings). Large vessels always broadcast AIS; ~40% of small craft do.

Unusual events (test sessions only): "uuv" small electric-thruster vehicle,
"diver" with breathing apparatus. Their tracks are ground truth, written to a
scene sidecar used only by the evaluator, the simulated AIS feed (AIS
sources only) and the simulated inspection-boat sensors, never by the detector.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt

from . import harbour as H
from .audio import SAMPLE_RATE, save_wav

SR = SAMPLE_RATE
PAD_S = 3.0  # signals start PAD_S before the session so distant sources have no onset artefact
PADS = int(PAD_S * SR)
HYDROPHONE_DEPTH = 10.0  # m

SHIP_NAMES = ["MV Nordic Crest", "MV Pacific Trader", "MV Harbour Star", "MV Coral Bay", "MV Ostend Spirit", "MV Kestrel",
              "MV Bluewater", "MV Saltmarsh", "MV Endeavour", "MV Grey Heron", "MV Atlas Bay", "MV Seaholm"]
CRAFT_NAMES = ["Pilot 3", "Tug Brava", "Workboat 12", "Launch Osprey", "Tug Hercules", "Survey Gull", "Pilot 7", "Bunker 2"]


def _band(x: np.ndarray, lo: float | None, hi: float | None, order: int = 4) -> np.ndarray:
    if lo and hi:
        sos = butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    elif lo:
        sos = butter(order, lo, btype="high", fs=SR, output="sos")
    else:
        sos = butter(order, hi, btype="low", fs=SR, output="sos")
    return sosfilt(sos, x)


def _colored_noise(n: int, rng: np.random.Generator, slope_db_oct: float, knee: float) -> np.ndarray:
    spec = rng.standard_normal(n // 2 + 1) + 1j * rng.standard_normal(n // 2 + 1)
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    mag = np.where(f < knee, 1.0, (f / knee) ** (slope_db_oct / 6.02))
    mag *= 1.0 / (1.0 + (10.0 / f) ** 2)
    x = np.fft.irfft(spec * mag, n)
    return x / (np.std(x) + 1e-12)


def _smooth_walk(n: int, rng: np.random.Generator, n_knots: int, spread: float) -> np.ndarray:
    knots = np.cumsum(rng.normal(0, spread, n_knots))
    knots -= knots.mean()
    return np.interp(np.arange(n), np.linspace(0, n - 1, n_knots), knots)


def _tone(freq_t: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    return np.sin(2 * np.pi * np.cumsum(freq_t) / SR + rng.uniform(0, 2 * np.pi))


def _unit(x: np.ndarray) -> np.ndarray:
    return (x / (np.std(x) + 1e-12)).astype(np.float32)


# ------------------------------------------------------------------ local noise (per hydrophone)
def ambient(n: int, rng: np.random.Generator, level: float) -> np.ndarray:
    x = _colored_noise(n, rng, slope_db_oct=rng.uniform(-6.0, -4.5), knee=rng.uniform(50, 150))
    gust = np.exp(_smooth_walk(n, rng, max(4, n // (SR * 8)), 0.15))
    return level * x * gust


def shrimp(n: int, rng: np.random.Generator, level: float) -> np.ndarray:
    k = rng.poisson(rng.uniform(15, 70) * n / SR)
    x = np.zeros(n)
    np.add.at(x, rng.integers(0, n, k), (rng.pareto(2.5, k) + 1.0) * rng.choice([-1, 1], k))
    kernel = np.exp(-np.arange(int(0.0015 * SR)) / (0.00025 * SR))
    return level * _band(np.convolve(x, kernel, mode="same"), 2000, None, order=2) * 1.5


# ------------------------------------------------------------------ source signals (unit RMS, emission time)
def vessel_signal(m: int, rng: np.random.Generator, small: bool) -> np.ndarray:
    if small:
        blade, n_harm, tonal_hi = rng.uniform(25, 60), 25, 2500
        cav_band = (rng.uniform(400, 900), rng.uniform(4000, 7000))
    else:
        blade, n_harm, tonal_hi = rng.uniform(6, 14), 30, 400
        cav_band = (rng.uniform(60, 150), rng.uniform(1500, 3500))
    drift = 1 + 0.01 * _smooth_walk(m, rng, 12, 0.5)
    tonal = np.zeros(m)
    for k in range(1, n_harm + 1):
        if blade * k > tonal_hi:
            break
        tonal += (1.0 / k**0.7) * rng.uniform(0.3, 1.0) * _tone(blade * k * drift, rng)
    for _ in range(rng.integers(1, 4)):
        tonal += rng.uniform(0.2, 0.8) * _tone(rng.uniform(30, 900 if small else 400) * drift, rng)
    cav = _band(rng.standard_normal(m), *cav_band)
    cav = cav / (np.std(cav) + 1e-12) * (1 + rng.uniform(0.3, 0.8) * np.sin(2 * np.pi * np.cumsum(blade * drift) / SR))
    sig = 0.5 * rng.uniform(0.3, 0.6) * tonal / (np.std(tonal) + 1e-12) + cav
    if small and rng.random() < 0.35:  # echo sounder
        f, period = rng.uniform(5000, 7500), rng.uniform(0.5, 2.0)
        L = int(0.008 * SR)
        ping = np.sin(2 * np.pi * f * np.arange(L) / SR) * np.hanning(L) * 6
        for i in np.arange(rng.integers(0, int(period * SR)), m - L, int(period * SR)):
            sig[i : i + L] += ping
    return _unit(sig)


def hum_signal(m: int, rng: np.random.Generator) -> np.ndarray:
    f = rng.choice([50.0, 60.0]) * (1 + 0.0005 * _smooth_walk(m, rng, 10, 1.0))
    return _unit(sum((0.6**k) * _tone(f * (k + 1), rng) for k in range(4)))


def clank_signal(m: int, rng: np.random.Generator, dur_s: float) -> np.ndarray:
    x = np.zeros(m)
    for _ in range(rng.poisson(dur_s / 40) + 1):
        L = int(rng.uniform(0.05, 0.25) * SR)
        i = rng.integers(0, m - L)
        tt = np.arange(L) / SR
        burst = np.sin(2 * np.pi * rng.uniform(300, 2500) * tt) * np.exp(-tt / rng.uniform(0.01, 0.06))
        burst += 0.5 * rng.standard_normal(L) * np.exp(-tt / 0.01)
        x[i : i + L] += burst * rng.uniform(0.5, 2.0)
    return (x / 0.3).astype(np.float32)  # sparse: scaled so bursts are ~unit peak*3


def uuv_signal(m: int, rng: np.random.Generator) -> np.ndarray:
    shaft, blades, poles = rng.uniform(18, 45), rng.integers(3, 6), rng.integers(4, 9)
    rpm = 1 + 0.06 * _smooth_walk(m, rng, max(3, m // (SR * 6)), 0.6)
    sig = 0.6 * _tone(shaft * blades * rpm, rng)
    elec = shaft * poles * rpm
    for k in range(1, 5):
        sig += (0.9 / k) * _tone(elec * k, rng)
    sig += 0.35 * _tone(rng.uniform(2500, 6000) * (1 + 0.002 * rpm), rng) * (1 + 0.3 * np.sin(2 * np.pi * np.cumsum(elec) / SR))
    sig += 0.5 * _band(rng.standard_normal(m), 300, 6000)  # thruster flow / cavitation broadband
    return _unit(sig)


def diver_signal(m: int, rng: np.random.Generator) -> np.ndarray:
    sig = np.zeros(m)
    period = rng.uniform(3.0, 5.0)
    t, dur = rng.uniform(0, 1), m / SR
    while t < dur - period:
        i0 = int(t * SR)
        L_in = int(rng.uniform(0.8, 1.3) * SR)
        if i0 + L_in < m:
            sig[i0 : i0 + L_in] += 0.7 * _band(rng.standard_normal(L_in), 1500, 6000) * np.hanning(L_in)
        j0, L_ex = i0 + L_in + int(0.2 * SR), int(rng.uniform(1.0, 1.8) * SR)
        Lb = int(0.02 * SR)
        tt = np.arange(Lb) / SR
        for _ in range(rng.integers(60, 140)):
            b = j0 + rng.integers(0, L_ex)
            if b + Lb < m:
                sig[b : b + Lb] += rng.uniform(0.3, 1.2) * np.sin(2 * np.pi * rng.uniform(400, 3000) * tt) * np.exp(-tt / 0.004)
        t += period * rng.uniform(0.9, 1.1)
    return _unit(sig)


# ------------------------------------------------------------------ scene
@dataclass
class Source:
    kind: str
    track: list            # [[t, x, y], ...] piecewise linear; clamped outside
    amp: float             # amplitude at 1 m; received ~ amp / r
    t_on: float            # sound active window (seconds, session time)
    t_off: float
    underwater: bool = False
    event: bool = False
    ais: dict | None = None
    sig: np.ndarray | None = field(default=None, repr=False)


def position(track: list, t) -> tuple[np.ndarray, np.ndarray]:
    tr = np.asarray(track, float)
    return np.interp(t, tr[:, 0], tr[:, 1]), np.interp(t, tr[:, 0], tr[:, 2])


def _path(points: list[tuple[float, float]], speed: float, t0: float) -> list:
    out, t = [[t0, *points[0]]], t0
    for a, b in zip(points[:-1], points[1:]):
        t += float(np.hypot(b[0] - a[0], b[1] - a[1])) / speed
        out.append([t, *b])
    return out


def _random_basin_point(rng, margin=40.0):
    while True:
        x, y = rng.uniform(H.PATROL_BBOX[0], H.PATROL_BBOX[2]), rng.uniform(H.PATROL_BBOX[1], H.PATROL_BBOX[3])
        if H.point_in_poly(x, y, H.PATROL) and y < H.QUAY_Y - margin and x > 80 + margin and x < 1150 - margin:
            return float(x), float(y)


def build_scene(duration: float, seed: int, events: list[dict]) -> tuple[list[Source], float]:
    """Source layout + signals. Layout uses its own RNG stream so it is reproducible."""
    rng = np.random.default_rng([seed, 1])  # layout
    srng = np.random.default_rng([seed, 2])  # signals
    amb = 0.006 * 10 ** (rng.uniform(-3, 3) / 20)
    m = int(duration * SR) + PADS
    sources: list[Source] = []
    names_s, names_c = list(rng.permutation(SHIP_NAMES)), list(rng.permutation(CRAFT_NAMES))

    def add(kind, track, amp, t_on, t_off, sig, **kw):
        sources.append(Source(kind, track, float(amp), float(t_on), float(t_off), sig=sig, **kw))

    # large vessels: entrance <-> berth
    for _ in range(rng.poisson(duration / 160) + (1 if rng.random() < 0.5 else 0)):
        bx, by = H.BERTHS[rng.integers(0, 4)]
        pts = [(rng.uniform(320, 380), -1500.0), (380.0, 0.0), (430.0, 200.0), (bx, by - 80), (bx, by)]
        if rng.random() < 0.5:
            pts = pts[::-1]
        speed = rng.uniform(2.5, 4.0)
        L = sum(np.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts[:-1], pts[1:]))
        t0 = rng.uniform(-L / speed + 60, duration - 60)
        tr = _path(pts, speed, t0)
        add("large vessel", tr, amb * 10 ** (rng.uniform(14, 24) / 20) * 200, tr[0][0], tr[-1][0], vessel_signal(m, srng, False),
            ais={"name": names_s.pop(), "type": "cargo"})
    # small craft: point to point in the basin, sometimes via the entrance
    for _ in range(rng.poisson(duration / 90)):
        a = _random_basin_point(rng) if rng.random() < 0.7 else (350.0, -600.0)
        b = _random_basin_point(rng) if rng.random() < 0.7 else (350.0, -600.0)
        if a == b:
            continue
        pts = [a, _random_basin_point(rng), b]
        speed = rng.uniform(5, 10)
        L = sum(np.hypot(q[0] - p[0], q[1] - p[1]) for p, q in zip(pts[:-1], pts[1:]))
        t0 = rng.uniform(-L / speed + 20, duration - 20)
        tr = _path(pts, speed, t0)
        ais = {"name": names_c.pop(), "type": "small craft"} if rng.random() < 0.4 and names_c else None
        add("small craft", tr, amb * 10 ** (rng.uniform(8, 16) / 20) * 100, tr[0][0], tr[-1][0], vessel_signal(m, srng, True), ais=ais)
    # quay pump hum, chain/hull clanks at berths
    hx = rng.uniform(250, 1050)
    add("quay pump", [[0, hx, H.QUAY_Y - 5]], amb * rng.uniform(0.1, 0.5) * 150, -PAD_S, duration + 10, hum_signal(m, srng))
    for _ in range(rng.integers(1, 3)):
        bx, by = H.BERTHS[rng.integers(0, 4)]
        add("berth clank", [[0, bx + rng.uniform(-40, 40), by]], amb * rng.uniform(1, 3) * 100, -PAD_S, duration + 10, clank_signal(m, srng, duration))
    # unusual events
    for ev in events:
        if ev["type"] == "uuv":
            bx, by = H.BERTHS[rng.integers(0, 4)]
            speed = rng.uniform(1.2, 2.0)
            ang = np.arctan2(by - 400, bx - 600) + rng.uniform(-0.5, 0.5)
            # start so it travels towards the berth during the event
            sx = float(np.clip(bx - np.cos(ang) * speed * ev["dur"] * 1.3, 140, 1100))
            sy = float(np.clip(by - 30 - np.sin(ang) * speed * ev["dur"] * 1.3, 220, 620))
            tr = _path([(sx, sy), (bx, by - 30)], speed, ev["start"])
            amp, sig = amb * 10 ** (ev["snr_db"] / 20) * 100, uuv_signal(m, srng)
        else:
            bx, by = H.BERTHS[rng.integers(0, 4)]
            sx, sy = bx + rng.uniform(-120, 120), by - rng.uniform(60, 160)
            tr = _path([(sx, sy), (bx + rng.uniform(-20, 20), by - 15)], rng.uniform(0.4, 0.7), ev["start"])
            amp, sig = amb * 10 ** (ev["snr_db"] / 20) * 50, diver_signal(m, srng)
        add(ev["type"], tr, amp, ev["start"], ev["start"] + ev["dur"], sig, underwater=True, event=True)
    return sources, amb


def _gain_window(t: np.ndarray, t_on: float, t_off: float, ramp: float) -> np.ndarray:
    return np.clip((t - t_on) / ramp + 1, 0, 1) * np.clip((t_off - t) / ramp + 1, 0, 1) if ramp > 0 else ((t >= t_on) & (t <= t_off)).astype(float)


def render(sources: list[Source], amb: float, duration: float, receivers: list[int], seed: int) -> np.ndarray:
    """Render the scene at the given hydrophone indices. Returns (len(receivers), n)."""
    n = int(duration * SR)
    tt = np.arange(0, n + 160, 160) / SR  # 10 ms control grid
    out = np.zeros((len(receivers), n))
    idx_all = np.arange(n)
    for ci, h in enumerate(receivers):
        rx, ry = H.HYD_XY[h]
        crng = np.random.default_rng([seed, 100 + h])
        out[ci] += ambient(n, crng, amb * 10 ** (crng.uniform(-1, 1) / 20))
        out[ci] += shrimp(n, crng, amb * crng.uniform(0.5, 1.5))
        for s in sources:
            sx, sy = position(s.track, tt)
            r = np.maximum(np.hypot(sx - rx, sy - ry), HYDROPHONE_DEPTH)  # seabed-mounted: nothing passes closer than the depth
            ramp = 3.0 if s.event else 15.0
            g = s.amp / r * _gain_window(tt - r / H.SOUND_SPEED, s.t_on, s.t_off, ramp)
            if not g.any():
                continue
            src_idx = np.interp(idx_all, tt * SR, (tt - r / H.SOUND_SPEED) * SR) + PADS
            out[ci] += np.interp(src_idx, np.arange(len(s.sig)), s.sig, left=0, right=0) * np.interp(idx_all, tt * SR, g)
    return (0.95 * np.tanh(out / 0.95)).astype(np.float32)


def scene_json(sources: list[Source], amb: float) -> dict:
    return {
        "simulated": True,
        "ambient_level": amb,
        "sources": [{k: v for k, v in asdict(s).items() if k != "sig"} for s in sources],
    }


# ------------------------------------------------------------------ sessions
@dataclass
class SessionPlan:
    name: str
    role: str
    duration: float
    seed: int
    events: list[dict] = field(default_factory=list)
    channels: list[int] = field(default_factory=lambda: [0, 1, 2, 3])


def render_session(plan: SessionPlan) -> tuple[np.ndarray, list[dict], dict]:
    sources, amb = build_scene(plan.duration, plan.seed, plan.events)
    x = render(sources, amb, plan.duration, plan.channels, plan.seed)
    labels = [
        {"start": s.t_on, "end": s.t_off, "label": f"simulated {s.kind}", "snr_db": ev["snr_db"], "track": s.track}
        for s, ev in zip([s for s in sources if s.event], plan.events)
    ]
    return x, labels, scene_json(sources, amb)


def default_plans() -> list[SessionPlan]:
    plans = [SessionPlan(f"sim-train-{i + 1:02d}", "train", 150, 1000 + i, channels=[i % 4]) for i in range(12)]
    plans += [SessionPlan(f"sim-cal-{i + 1:02d}", "calibration", 150, 2000 + i) for i in range(4)]
    plans += [SessionPlan(f"sim-test-normal-{i + 1:02d}", "test", 180, 3000 + i) for i in range(6)]
    # unusual events; snr_db = event level vs session ambient at 100 m (uuv) / 50 m (diver)
    ev_specs = [
        [{"type": "uuv", "start": 40, "dur": 60, "snr_db": 12}],
        [{"type": "uuv", "start": 25, "dur": 45, "snr_db": 6}, {"type": "diver", "start": 95, "dur": 40, "snr_db": 9}],
        [{"type": "uuv", "start": 50, "dur": 70, "snr_db": 3}],
        [{"type": "diver", "start": 40, "dur": 60, "snr_db": 6}],
        [{"type": "uuv", "start": 20, "dur": 45, "snr_db": 9}, {"type": "uuv", "start": 90, "dur": 50, "snr_db": 0}],
        [{"type": "diver", "start": 60, "dur": 50, "snr_db": 0}],
        [{"type": "uuv", "start": 60, "dur": 60, "snr_db": -3}],
        [{"type": "diver", "start": 20, "dur": 45, "snr_db": 3}, {"type": "uuv", "start": 85, "dur": 50, "snr_db": 6}],
    ]
    plans += [SessionPlan(f"sim-test-event-{i + 1:02d}", "test", 150, 4000 + i, evs) for i, evs in enumerate(ev_specs)]
    return plans


def generate(out_dir: Path, plans: list[SessionPlan] | None = None) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for p in plans or default_plans():
        x, labels, scene = render_session(p)
        path = out_dir / f"{p.name}.wav"
        save_wav(path, x)
        scene["hydrophones"] = [H.HYDROPHONES[c]["id"] for c in p.channels]
        (out_dir / f"{p.name}.scene.json").write_text(json.dumps(scene))
        entries.append({
            "id": p.name,
            "name": f"{p.name}.wav",
            "session": p.name,
            "role": p.role,
            "source": "simulated",
            "duration": p.duration,
            "channels": len(p.channels),
            "hydrophones": scene["hydrophones"],
            "labels": labels if p.role == "test" else None,
            "scene": str(out_dir / f"{p.name}.scene.json"),
            "path": str(path),
        })
    return entries
