import numpy as np
import pytest

from portwatch.alerting import AlertEngine, AlertParams
from portwatch.audio import SAMPLE_RATE, WindowSpec
from portwatch.emd import emd
from portwatch.evaluate import _match
from portwatch.features import emd_features, spectrogram_features
from portwatch.pipeline import StreamProcessor, train_bundle
from portwatch.simulate import SessionPlan, render_session
from portwatch.store import check_sessions


def test_emd_reconstructs_signal_and_orders_by_frequency():
    t = np.arange(SAMPLE_RATE) / SAMPLE_RATE
    x = np.sin(2 * np.pi * 40 * t) + 0.5 * np.sin(2 * np.pi * 900 * t)
    imfs = emd(x)
    assert np.allclose(imfs.sum(axis=0), x, atol=1e-8)  # IMFs + residual == signal
    # first IMF should carry the 900 Hz component: count zero crossings
    zc = lambda s: np.sum(np.diff(np.signbit(s)))
    assert zc(imfs[0]) > zc(imfs[1])
    assert abs(zc(imfs[0]) / 2 - 900) < 90


def test_feature_shapes_are_fixed():
    x = np.random.default_rng(0).standard_normal(SAMPLE_RATE).astype(np.float32) * 0.01
    assert spectrogram_features(x).shape == spectrogram_features(x * 3).shape
    assert emd_features(x).shape == emd_features(x * 3).shape


def _run(scores, persistence):
    spec = WindowSpec()
    eng = AlertEngine("t", AlertParams(threshold=1.0, persistence_s=persistence))
    for i, z in enumerate(scores):
        te = spec.end_time(i)
        eng.step(te - spec.window_s, te, z)
    return eng


def test_single_blip_does_not_alert_but_persistent_anomaly_does():
    blip = [0] * 10 + [5] + [0] * 20
    assert _run(blip, persistence=2.0).events == []
    sustained = [0] * 10 + [5] * 6 + [0] * 20  # 6 windows * 0.5 s = 3 s hot
    ev = _run(sustained, persistence=2.0).events
    assert len(ev) == 1 and ev[0]["status"] == "ended"
    # 4 hot windows (2.0 s) are needed; alert raised at end of the 4th hot window
    assert ev[0]["alert_time"] == pytest.approx(WindowSpec().end_time(13))


def test_short_dips_do_not_split_an_event():
    scores = [0] * 5 + [5] * 6 + [0] + [5] * 6 + [0] * 20
    assert len(_run(scores, persistence=2.0).events) == 1


def test_threat_levels_escalate():
    spec = WindowSpec()
    eng = AlertEngine("t", AlertParams(threshold=1.0, persistence_s=2.0))
    levels = []
    for i, z in enumerate([0, 5, 5, 5, 5, 5]):
        te = spec.end_time(i)
        eng.step(te - 1, te, z)
        levels.append(eng.threat_level(te)["level"])
    assert levels[0] == 0 and levels[1] == 1 and 2 in levels and levels[-1] == 3


def test_matching_does_not_credit_alerts_raised_before_event():
    events = [{"start": 5.0, "alert_time": 9.0, "end": 60.0}]
    labels = [{"start": 20.0, "end": 40.0, "label": "x"}]
    fa, per = _match(events, labels)
    assert fa == [] and per[0]["detected"] is False


def test_session_cannot_span_roles():
    errs = check_sessions([{"session": "a", "role": "train"}, {"session": "a", "role": "test"}])
    assert errs


def test_train_rejects_shared_session(tmp_path):
    e = {"path": "x.wav", "session": "s1", "source": "simulated"}
    with pytest.raises(ValueError):
        train_bundle([e], [e])


@pytest.fixture(scope="module")
def small_bundle(tmp_path_factory):
    from portwatch.audio import save_wav

    d = tmp_path_factory.mktemp("sim")
    entries = []
    for i, role in enumerate(["train", "train", "train", "calibration"]):
        x, _, _ = render_session(SessionPlan(f"s{i}", role, 40, 77 + i, channels=[i % 4] if role == "train" else [0, 1, 2, 3]))
        p = d / f"s{i}.wav"
        save_wav(p, x)
        entries.append({"path": str(p), "session": f"s{i}", "source": "simulated", "role": role})
    return train_bundle([e for e in entries if e["role"] == "train"], [e for e in entries if e["role"] == "calibration"])


def test_stream_is_causal(small_bundle):
    x, _, _ = render_session(SessionPlan("test", "test", 20, 999, [{"type": "uuv", "start": 5, "dur": 10, "snr_db": 12}]))
    proc = StreamProcessor(small_bundle, x, sensitivity=50, persistence_s=2.0)
    assert proc.array and small_bundle.detectors["spectrogram"].cal_fused_sorted is not None
    frames = proc.advance(3.0)
    # only windows that have fully arrived by t=3.0 s are scored
    assert frames and all(f["t"] <= 3.0 for f in frames)
    assert len(frames) == WindowSpec().n_windows(int(3.0 * SAMPLE_RATE))
    assert proc.advance(3.0) == []  # nothing new without new audio


def test_fuse_needs_two_hydrophones():
    from portwatch.model import fuse

    z = np.array([[10.0], [0.0], [0.0], [0.0]])  # one hot hydrophone only
    assert fuse(z)[0] == pytest.approx(5.0)
    assert fuse(np.array([[3.0]]))[0] == 3.0  # mono passes through


def test_localiser_finds_isolated_source():
    from portwatch import simulate as S
    from portwatch.localize import EventTrack, Localizer

    srcs, amb = S.build_scene(40, 4001, [{"type": "uuv", "start": 5, "dur": 30, "snr_db": 12}])
    srcs = [s for s in srcs if s.event]
    x = S.render(srcs, amb, 40, [0, 1, 2, 3], 4001)
    tr = EventTrack(Localizer())
    est = None
    for t in np.arange(6, 30, 0.5):
        est = tr.update(x, t, 5.0)
    tx, ty = S.position(srcs[0].track, 29)
    assert est is not None and np.hypot(est["x"] - tx, est["y"] - ty) <= est["r95"]


def test_dispatch_held_when_ais_vessel_explains_sound():
    from portwatch.dispatch import DispatchPolicy, check_dispatch

    ev = {"id": "E1", "status": "active"}
    loc = {"x": 500.0, "y": 500.0, "r95": 60.0}
    ais = [{"name": "MV Test", "type": "cargo", "x": 520.0, "y": 505.0}]
    held = check_dispatch(ev, loc, ais, True, DispatchPolicy())
    assert not held["ok"] and held["ais_match"]["name"] == "MV Test"
    assert check_dispatch(ev, loc, [], True, DispatchPolicy())["ok"]
    assert not check_dispatch(ev, dict(loc, r95=900.0), [], True, DispatchPolicy())["ok"]


def test_boat_cancel_window_and_cancel():
    from portwatch.dispatch import Boat, DispatchPolicy, SceneTruth

    boat = Boat(DispatchPolicy(auto=True, cancel_s=10))
    ev = {"id": "E1", "status": "active", "start": 0.0}
    loc = {"x": 500.0, "y": 500.0, "r95": 60.0}
    boat.step(1.0, 0.5, ev, loc, SceneTruth(None), [])
    assert boat.state == "pending"
    boat.command("cancel")
    boat.step(1.5, 0.5, ev, loc, SceneTruth(None), [])
    assert boat.state == "docked" and boat.sorties[-1]["verdict"] == "cancelled by officer"
    boat.step(2.0, 0.5, ev, loc, SceneTruth(None), [])
    assert boat.state == "docked"  # the same alert does not relaunch after a cancel
