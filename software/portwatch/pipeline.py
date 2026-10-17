"""Feature computation (cached), training, and the live stream processor.

Recordings may be mono (one hydrophone) or multi-channel (the simulated
4-hydrophone array). Each channel is scored by the same detector; for arrays
the alert score is the fused array score (``model.fuse``), calibrated on
multi-channel calibration sessions.
"""
from __future__ import annotations

import hashlib
import os
import time
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from pathlib import Path

import numpy as np

from . import harbour as H
from .alerting import AlertEngine, AlertParams
from .audio import WindowSpec, load_channels
from .dispatch import Boat, DispatchPolicy, SceneTruth
from .features import EXTRACTORS, FEATURE_VERSION, N_BANDS, display_columns
from .localize import EventTrack, Localizer
from .model import Detector, ModelBundle, describe_band, fuse

SPEC = WindowSpec()
METHODS = ("spectrogram", "emd")
CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "cache"
AFTER_END_S = 900.0  # the boat mission may continue this long after the recording ends
_POOL = ThreadPoolExecutor(max_workers=4)
_LOCALIZER: Localizer | None = None


def localizer() -> Localizer:
    global _LOCALIZER
    if _LOCALIZER is None:
        _LOCALIZER = Localizer()
    return _LOCALIZER


# ---------------------------------------------------------------- batch features
def _features_uncached(path: str) -> dict:
    x = load_channels(path)  # (ch, n)
    n = SPEC.n_windows(x.shape[1])
    out, secs = {}, {}
    for m in METHODS:
        fn = EXTRACTORS[m]
        t0 = time.perf_counter()
        out[m] = np.stack([np.stack([fn(SPEC.window(c, i)) for i in range(n)]) for c in x]) if n else np.zeros((x.shape[0], 0, 1), np.float32)
        secs[m] = time.perf_counter() - t0
    return {"feats": out, "secs": secs, "audio_s": x.shape[1] / SPEC.sr, "n": n, "channels": x.shape[0]}


def _cache_key(path: str) -> str:
    st = os.stat(path)
    return hashlib.sha1(f"{Path(path).resolve()}|{st.st_size}|{st.st_mtime_ns}|v{FEATURE_VERSION}".encode()).hexdigest()[:16]


def features_for(path: str) -> dict:
    """Features with shape (channels, windows, dims) per method."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cf = CACHE_DIR / f"{_cache_key(path)}.npz"
    if cf.exists():
        z = np.load(cf)
        return {"feats": {m: z[m] for m in METHODS}, "secs": {m: float(z[f"secs_{m}"]) for m in METHODS},
                "audio_s": float(z["audio_s"]), "n": int(z["n"]), "channels": int(z["channels"])}
    r = _features_uncached(path)
    np.savez(cf, **r["feats"], **{f"secs_{m}": r["secs"][m] for m in METHODS}, audio_s=r["audio_s"], n=r["n"], channels=r["channels"])
    return r


def features_many(paths: list[str], progress=None) -> dict[str, dict]:
    results: dict[str, dict] = {}
    todo = []
    for p in dict.fromkeys(paths):
        if (CACHE_DIR / f"{_cache_key(p)}.npz").exists():
            results[p] = features_for(p)
        else:
            todo.append(p)
    if todo:
        workers = max(1, min(len(todo), (os.cpu_count() or 2) - 1))
        with ProcessPoolExecutor(workers) as ex:
            for p, r in zip(todo, ex.map(features_for, todo)):
                results[p] = r
                if progress:
                    progress(len(results), len(set(paths)))
    return results


def channel_scores(bundle: ModelBundle, f: dict, method: str) -> np.ndarray:
    """Per-channel anomaly scores, shape (channels, windows)."""
    det = bundle.detectors[method]
    return np.stack([det.score(ch) if len(ch) else np.zeros(0) for ch in f["feats"][method]])


# ---------------------------------------------------------------------- training
def train_bundle(train: list[dict], calibration: list[dict], progress=None) -> ModelBundle:
    """Fit both detectors on ``train`` sessions; calibrate thresholds on separate ``calibration`` sessions."""
    tr_sessions = {e["session"] for e in train}
    cal_sessions = {e["session"] for e in calibration}
    overlap = tr_sessions & cal_sessions
    if overlap:
        raise ValueError(f"Sessions used for both training and calibration: {sorted(overlap)}")
    if not train or not calibration:
        raise ValueError("Need at least one training session and one separate calibration session.")
    feats = features_many([e["path"] for e in train + calibration], progress)
    flat = lambda e, m: feats[e["path"]]["feats"][m].reshape(-1, feats[e["path"]]["feats"][m].shape[-1])
    detectors, fit_secs = {}, {}
    for m in METHODS:
        Xtr = np.concatenate([flat(e, m) for e in train])
        Xcal = np.concatenate([flat(e, m) for e in calibration])
        t0 = time.perf_counter()
        det = Detector(m).fit(Xtr).calibrate(Xcal)
        det.calibrate_fused([feats[e["path"]]["feats"][m] for e in calibration if feats[e["path"]]["channels"] > 1])
        detectors[m] = det
        fit_secs[m] = time.perf_counter() - t0
    bands = np.concatenate([flat(e, "spectrogram")[:, :N_BANDS] for e in train])
    return ModelBundle(
        detectors=detectors,
        band_mu=bands.mean(0),
        band_sd=bands.std(0),
        train_sessions=sorted(tr_sessions),
        calibration_sessions=sorted(cal_sessions),
        sources={e["session"]: e["source"] for e in train + calibration},
        fit_seconds=fit_secs,
    )


# ------------------------------------------------------------------ live stream
class StreamProcessor:
    """Causal, incremental processing of one recording replayed as if live.

    ``precomputed`` ({method: (channels, windows) scores}) skips feature
    extraction; evaluation uses it to run this exact alert/locate/dispatch code fast.
    """

    def __init__(self, bundle: ModelBundle, audio: np.ndarray, sensitivity: float, persistence_s: float,
                 active_method: str = "spectrogram", truth: SceneTruth | None = None,
                 policy: DispatchPolicy | None = None, precomputed: dict | None = None, display: bool = True):
        self.bundle = bundle
        self.audio = np.atleast_2d(audio)
        self.channels = self.audio.shape[0]
        self.array = self.channels == H.N_HYD and self.channels > 1
        self.n_windows = SPEC.n_windows(self.audio.shape[1])
        self.next_i = 0
        self.active_method = active_method
        self.sensitivity = sensitivity
        self.persistence_s = persistence_s
        self.truth = truth or SceneTruth(None)
        self.precomputed = precomputed
        self.display = display
        self.mono = self.audio.mean(axis=0)
        self.engines = {
            m: AlertEngine(m, AlertParams(threshold=self._thr(m), persistence_s=persistence_s, hop_s=SPEC.hop_s))
            for m in METHODS
        }
        self.boat = Boat(policy or DispatchPolicy())
        self.tracks: dict[str, tuple[float, EventTrack]] = {}  # method -> (candidate start, track)
        self.locations: dict[str, dict | None] = {m: None for m in METHODS}
        self.check: dict = {"ok": False, "reasons": ["No active alert."], "ais_match": None}
        self.proc_s = {m: 0.0 for m in METHODS}
        self.loc_s = 0.0
        self.t_sim = 0.0  # simulated-world clock (continues after the audio ends while the boat is out)
        # history kept for the 3D reconstruction (viz_scenario.py)
        self.boat_track: list[tuple[float, float, float]] = []      # (t, x, y)
        self.heard: dict[str, dict[str, dict[int, float]]] = {m: {} for m in METHODS}  # method -> cand start -> hydrophone -> t
        self.loc_first: dict[str, dict[str, float]] = {m: {} for m in METHODS}

    def _thr(self, m: str) -> float:
        return self.bundle.detectors[m].threshold(self.sensitivity, fused=self.array)

    @property
    def duration(self) -> float:
        return self.audio.shape[1] / SPEC.sr

    def set_params(self, sensitivity=None, persistence_s=None, active_method=None) -> None:
        if sensitivity is not None:
            self.sensitivity = sensitivity
        if persistence_s is not None:
            self.persistence_s = persistence_s
        if active_method in METHODS:
            self.active_method = active_method
        for m, eng in self.engines.items():
            eng.params.threshold = self._thr(m)
            eng.params.persistence_s = self.persistence_s

    def thresholds(self) -> dict[str, float]:
        return {m: round(e.params.threshold, 3) for m, e in self.engines.items()}

    def _score_window(self, i: int) -> tuple[dict, np.ndarray | None]:
        """Per-channel scores per method, plus spectrogram features of each channel."""
        if self.precomputed is not None:
            return {m: self.precomputed[m][:, i] for m in METHODS}, None
        wins = [SPEC.window(c, i) for c in self.audio]
        scores, spec_feats = {}, None
        for m in METHODS:
            t0 = time.perf_counter()
            feats = list(_POOL.map(EXTRACTORS[m], wins)) if self.channels > 1 else [EXTRACTORS[m](wins[0])]
            scores[m] = self.bundle.detectors[m].score(np.stack(feats))
            self.proc_s[m] += time.perf_counter() - t0
            if m == "spectrogram":
                spec_feats = np.stack(feats)
        return scores, spec_feats

    def _locate(self, m: str, t_end: float) -> None:
        eng = self.engines[m]
        if not self.array or eng.cand is None:
            self.tracks.pop(m, None)
            self.locations[m] = None
            return
        start = eng.cand.start
        if m not in self.tracks or self.tracks[m][0] != start:
            self.tracks[m] = (start, EventTrack(localizer()))
        t0 = time.perf_counter()
        est = self.tracks[m][1].update(self.audio, t_end, start, self.truth.ais_xy(t_end))
        self.loc_s += time.perf_counter() - t0
        self.locations[m] = est
        if eng.active is not None and est is not None:
            eng.active["location"] = est

    def advance(self, until_t: float) -> list[dict]:
        """Process every window that is complete by playback time ``until_t``."""
        frames = []
        while self.next_i < self.n_windows and SPEC.end_time(self.next_i) <= until_t + 1e-6:
            i = self.next_i
            t_end = SPEC.end_time(i)
            t_start = t_end - SPEC.window_s
            ch_scores, spec_feats = self._score_window(i)
            fused = {m: float(fuse(ch_scores[m][:, None])[0]) for m in METHODS}
            band = None
            if spec_feats is not None:
                band = describe_band(spec_feats[int(np.argmax(ch_scores["spectrogram"]))], self.bundle)
            changed = []
            for m, eng in self.engines.items():
                ev = eng.step(t_start, t_end, fused[m], band)
                self._locate(m, t_end)
                if eng.cand is not None:
                    key = f"{eng.cand.start:.2f}"
                    heard = self.heard[m].setdefault(key, {})
                    for h, z in enumerate(ch_scores[m]):
                        if z > eng.params.threshold and h not in heard:
                            heard[h] = round(t_end, 2)
                    if self.locations[m] is not None:
                        self.loc_first[m].setdefault(key, round(t_end, 2))
                if ev is not None:
                    changed.append(dict(ev))
            # dispatch follows the officer's chosen method
            am = self.active_method
            act = self.engines[am].active
            ais = self.truth.ais_at(t_end)
            self.check = self.boat.step(t_end, SPEC.hop_s, act, self.locations[am] if act else None, self.truth, ais)
            self.t_sim = t_end
            self.boat_track.append((t_end, self.boat.x, self.boat.y))
            frame = {
                "i": i,
                "t": round(t_end, 2),
                "scores": {m: round(s, 3) for m, s in fused.items()},
                "ch_scores": {m: [round(float(v), 2) for v in ch_scores[m]] for m in METHODS},
                "levels": {m: e.threat_level(t_end) for m, e in self.engines.items()},
                "band": band,
            }
            if self.display:
                seg = self.mono[: SPEC.win] if i == 0 else self.mono[i * SPEC.hop + SPEC.win - SPEC.hop : i * SPEC.hop + SPEC.win]
                frame["spec"] = display_columns(seg)
            if changed:
                frame["changed"] = changed
            frames.append(frame)
            self.next_i += 1
        # recording finished: no new audio, but the boat mission carries on in the simulated world
        if self.next_i >= self.n_windows:
            limit = min(until_t, self.duration + AFTER_END_S)
            while self.boat.state != "docked" and self.t_sim + SPEC.hop_s <= limit:
                self.t_sim += SPEC.hop_s
                self.check = self.boat.step(self.t_sim, SPEC.hop_s, None, None, self.truth, self.truth.ais_at(self.t_sim))
                self.boat_track.append((self.t_sim, self.boat.x, self.boat.y))
        return frames

    @property
    def audio_done(self) -> bool:
        return self.next_i >= self.n_windows

    def now(self) -> float:
        return self.t_sim

    def map_state(self) -> dict:
        t = self.now()
        return {
            "array": self.array,
            "ais": self.truth.ais_at(t),
            "location": self.locations[self.active_method],
            "boat": self.boat.snapshot(t),
            "dispatch_check": self.check,
            "truth": self.truth.event_positions(t),  # analyst overlay only
            "simulated_world": self.truth.available,
        }

    def state(self) -> dict:
        n = max(self.next_i, 1)
        return {
            "processed_s": round(min(self.now(), self.duration), 2),
            "sim_time": round(self.now(), 2),
            "audio_done": self.audio_done,
            "done": self.audio_done and self.boat.state == "docked",
            "thresholds": self.thresholds(),
            "events": {m: [dict(e) for e in eng.events] for m, eng in self.engines.items()},
            "speed": {
                m: {"ms_per_window": round(1000 * self.proc_s[m] / n, 2),
                    "x_realtime": round(SPEC.hop_s * self.next_i / max(self.proc_s[m], 1e-9), 1),
                    "channels": self.channels}
                for m in METHODS
            },
            "map": self.map_state(),
        }
