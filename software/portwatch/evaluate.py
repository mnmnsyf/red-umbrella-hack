"""Side-by-side evaluation of the spectrogram and EMD detectors.

Same test sessions, same alert engine, same matching rules for both. Results
are computed separately per data source ("simulated" vs "real"), never mixed.

Metrics
- False alerts / hour: alerts not overlapping any labelled event (+grace),
  divided by hours of test audio outside labelled events. Reported with the
  raw count, exposure hours and a Poisson 95% interval: with under an hour of
  audio, one false alert moves the rate a lot.
- Detection rate: labelled events with at least one alert overlapping
  [start, end + grace]. Only defined when labelled events exist.
- Time to alert: alert time minus labelled event start. An alert counts as
  a detection only if it is raised inside [start, end + grace].
- Window AUC: threshold-free separability of event vs normal windows.
- Processing speed: feature + scoring time per window, x faster than real time.

Array sessions (simulated 4-hydrophone array) additionally run the full live
loop (``StreamProcessor`` with precomputed scores: same alert, location and
dispatch code) with auto-dispatch and a simulated officer who confirms a
sonar contact and otherwise records "nothing found":
- Location error of each detected event (10 s after the alert) and whether
  the truth lay inside the stated 95% area.
- Inspection sorties per hour, sorties on false alerts, events reached
  (sonar contact) and time from event start to contact.
- Alerts held back because an AIS vessel explained them.

Run:  uv run python -m portwatch.evaluate
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
from scipy.stats import chi2
from sklearn.metrics import roc_auc_score

from . import store
from .alerting import AlertEngine, AlertParams
from .audio import load_channels
from .dispatch import DispatchPolicy, SceneTruth
from .model import ModelBundle, fuse
from .pipeline import AFTER_END_S, METHODS, SPEC, StreamProcessor, channel_scores, features_many, train_bundle
from .simulate import position

GRACE_S = 10.0
SWEEP_SENS = [10, 25, 40, 50, 60, 75, 90]
SWEEP_PERSIST = [0.0, 1.0, 2.0, 4.0, 6.0, 8.0]


def _poisson_ci(k: int, hours: float) -> tuple[float, float]:
    if hours <= 0:
        return (float("nan"), float("nan"))
    lo = 0.0 if k == 0 else chi2.ppf(0.025, 2 * k) / 2
    hi = chi2.ppf(0.975, 2 * k + 2) / 2
    return (round(lo / hours, 2), round(hi / hours, 2))


def run_alerts(scores: np.ndarray, threshold: float, persistence_s: float, duration: float) -> list[dict]:
    eng = AlertEngine("eval", AlertParams(threshold=threshold, persistence_s=persistence_s, hop_s=SPEC.hop_s))
    for i, z in enumerate(scores):
        t_end = SPEC.end_time(i)
        eng.step(t_end - SPEC.window_s, t_end, float(z))
    for e in eng.events:
        if e["end"] is None:
            e["end"] = round(e.get("last_hot", duration), 2)
    return eng.events


def _match(events: list[dict], labels: list[dict]) -> tuple[list[dict], list[dict]]:
    """Return (false_alerts, per_label_results)."""
    false_alerts = []
    for ev in events:
        hit = any(ev["start"] <= lab["end"] + GRACE_S and ev["end"] >= lab["start"] for lab in labels)
        if not hit:
            false_alerts.append(ev)
    per_label = []
    for lab in labels:
        # credited only if the alert was raised during the event (or its grace period);
        # an alert already running before the event began is not counted as detecting it
        hits = [ev for ev in events if lab["start"] <= ev["alert_time"] <= lab["end"] + GRACE_S]
        first = min((ev["alert_time"] for ev in hits), default=None)
        per_label.append({**lab, "detected": first is not None, "time_to_alert": None if first is None else round(first - lab["start"], 2)})
    return false_alerts, per_label


def _thr(bundle: ModelBundle, s: dict, method: str, sensitivity: float) -> float:
    return bundle.detectors[method].threshold(sensitivity, fused=s["array"])


def _metrics(sessions: list[dict], method: str, bundle: ModelBundle, sensitivity: float, persistence_s: float) -> dict:
    n_false, normal_s, total_s = 0, 0.0, 0.0
    n_false_normal_only, normal_only_s = 0, 0.0
    per_label_all, all_events = [], []
    for s in sessions:
        labels = s["labels"] or []
        events = run_alerts(s["scores"][method], _thr(bundle, s, method, sensitivity), persistence_s, s["duration"])
        fa, per_label = _match(events, labels)
        n_false += len(fa)
        excl = sum(min(lab["end"] + GRACE_S, s["duration"]) - lab["start"] for lab in labels)
        normal_s += max(0.0, s["duration"] - excl)
        total_s += s["duration"]
        if not labels:
            n_false_normal_only += len(fa)
            normal_only_s += s["duration"]
        for p in per_label:
            p["session"] = s["session"]
        per_label_all += per_label
        all_events += [dict(e, session=s["session"], false_alert=e in fa) for e in events]
    hours = normal_s / 3600
    tta = [p["time_to_alert"] for p in per_label_all if p["detected"]]
    out = {
        "threshold": round(_thr(bundle, sessions[0], method, sensitivity), 3),
        "persistence_s": persistence_s,
        "false_alerts": n_false,
        "normal_hours": round(hours, 3),
        "false_alerts_per_hour": round(n_false / hours, 2) if hours else None,
        "false_alerts_per_hour_ci95": _poisson_ci(n_false, hours),
        "normal_only_sessions": {
            "false_alerts": n_false_normal_only,
            "hours": round(normal_only_s / 3600, 3),
            "false_alerts_per_hour": round(n_false_normal_only / (normal_only_s / 3600), 2) if normal_only_s else None,
        },
        "labelled_events": len(per_label_all),
        "detected": sum(p["detected"] for p in per_label_all),
        "detection_rate": round(sum(p["detected"] for p in per_label_all) / len(per_label_all), 3) if per_label_all else None,
        "time_to_alert_median_s": round(float(np.median(tta)), 2) if tta else None,
        "time_to_alert_mean_s": round(float(np.mean(tta)), 2) if tta else None,
        "per_event": per_label_all,
        "events": all_events,
    }
    return out


def _response_eval(bundle: ModelBundle, sessions: list[dict], method: str, sensitivity: float, persistence_s: float) -> dict:
    """Run the live loop (alert -> locate -> dispatch) on array sessions with a simulated officer."""
    loc_rows, sorties, ais_held, hours = [], [], 0, 0.0
    per_event = []
    for s in sessions:
        truth = SceneTruth.load(s["scene"])
        proc = StreamProcessor(bundle, load_channels(s["path"]), sensitivity, persistence_s, method, truth,
                               DispatchPolicy(auto=True, cancel_s=15.0), precomputed=s["ch_scores"], display=False)
        labels = s["labels"] or []
        loc_at: dict[str, list] = {}
        held: set[str] = set()
        while True:
            if proc.audio_done:  # boat mission continues after the recording ends
                if proc.boat.state == "docked" or proc.now() >= proc.duration + AFTER_END_S:
                    break
                proc.advance(proc.now() + SPEC.hop_s)
            else:
                proc.advance(SPEC.end_time(proc.next_i))
            t = proc.now()
            act = proc.engines[method].active
            if act is not None and proc.locations[method] is not None:
                loc_at.setdefault(act["id"], []).append((t, proc.locations[method]))
                if proc.check["ais_match"]:
                    held.add(act["id"])
            if proc.boat.state == "awaiting_verdict":  # simulated officer
                proc.boat.command("verdict", verdict="confirmed intrusion" if proc.boat.contact else "nothing found")
        ais_held += len(held)
        hours += s["duration"] / 3600
        events = proc.engines[method].events
        for lab in labels:
            hit = next((e for e in events if lab["start"] <= e["alert_time"] <= lab["end"] + GRACE_S), None)
            row = {"session": s["session"], "start": lab["start"], "label": lab["label"], "snr_db": lab.get("snr_db"), "detected": hit is not None,
                   "loc_error_m": None, "inside_95": None, "loc_mode": None, "contact_after_s": None}
            if hit and hit["id"] in loc_at:
                t_want = hit["alert_time"] + 10
                t, est = min(loc_at[hit["id"]], key=lambda z: abs(z[0] - t_want))
                tx, ty = position(lab["track"], t - 1)
                err = float(np.hypot(est["x"] - tx, est["y"] - ty))
                row.update(loc_error_m=round(err), inside_95=err <= est["r95"], loc_mode=est.get("mode"))
                loc_rows.append(row)
            per_event.append(row)
        for so in proc.boat.sorties + ([proc.boat.sortie] if proc.boat.sortie else []):
            ev = next((e for e in events if e["id"] == so["event_id"]), None)
            lab = next((l for l in labels if ev and l["start"] <= ev["alert_time"] <= l["end"] + GRACE_S), None)
            so = dict(so, session=s["session"], true_event=lab is not None)
            if lab and so.get("contact_at") is not None:
                so["contact_after_s"] = round(so["contact_at"] - lab["start"], 1)
                for r in per_event:
                    if r["session"] == s["session"] and r["start"] == lab["start"] and r["contact_after_s"] is None:
                        r["contact_after_s"] = so["contact_after_s"]
            sorties.append(so)
    errs = [r["loc_error_m"] for r in loc_rows]
    launched = [x for x in sorties if x.get("verdict") != "cancelled by officer"]
    reached = [r for r in per_event if r["contact_after_s"] is not None]
    n_lab = len([r for r in per_event])
    return {
        "hours": round(hours, 3),
        "located_events": len(loc_rows),
        "loc_error_median_m": round(float(np.median(errs)), 1) if errs else None,
        "loc_error_p90_m": round(float(np.percentile(errs, 90)), 1) if errs else None,
        "loc_inside_95_rate": round(float(np.mean([r["inside_95"] for r in loc_rows])), 2) if loc_rows else None,
        "loc_modes": {m: sum(r["loc_mode"] == m for r in loc_rows) for m in ("array", "coarse")},
        "sorties": len(launched),
        "sorties_per_hour": round(len(launched) / hours, 2) if hours else None,
        "sorties_on_false_alerts": sum(not x["true_event"] for x in launched),
        "events_reached": len(reached),
        "events_reached_rate": round(len(reached) / n_lab, 2) if n_lab else None,
        "contact_after_median_s": round(float(np.median([r["contact_after_s"] for r in reached])), 1) if reached else None,
        "alerts_explained_by_ais": ais_held,
        "per_event": per_event,
        "sortie_log": sorties,
    }


def _window_auc(sessions: list[dict], method: str) -> float | None:
    y, s = [], []
    for sess in sessions:
        labels = sess["labels"] or []
        sc = sess["scores"][method]
        for i, z in enumerate(sc):
            c = SPEC.end_time(i) - SPEC.window_s / 2
            pos = any(lab["start"] <= c <= lab["end"] for lab in labels)
            near = any(lab["start"] - 2 <= c <= lab["end"] + GRACE_S for lab in labels)
            if pos:
                y.append(1); s.append(z)
            elif not near:
                y.append(0); s.append(z)
    if len(set(y)) < 2:
        return None
    return round(float(roc_auc_score(y, s)), 4)


def evaluate(bundle: ModelBundle, test_entries: list[dict], sensitivity: float = 50, persistence_s: float = 4.0, progress=None) -> dict:
    used = set(bundle.train_sessions) | set(bundle.calibration_sessions)
    leak = sorted({e["session"] for e in test_entries} & used)
    if leak:
        raise ValueError(f"Test sessions overlap training/calibration sessions: {leak}")
    if not test_entries:
        raise ValueError("No test recordings in the library.")
    feats = features_many([e["path"] for e in test_entries], progress)

    sessions, speed_acc = [], {m: [0.0, 0, 0.0] for m in METHODS}  # feat secs, channel-windows, score secs
    for e in test_entries:
        f = feats[e["path"]]
        scores, ch = {}, {}
        for m in METHODS:
            t0 = time.perf_counter()
            ch[m] = channel_scores(bundle, f, m) if f["n"] else np.zeros((f["channels"], 0))
            scores[m] = fuse(ch[m]) if f["n"] else np.zeros(0)
            speed_acc[m][2] += time.perf_counter() - t0
            speed_acc[m][0] += f["secs"][m]
            speed_acc[m][1] += f["n"] * f["channels"]
        sessions.append({"session": e["session"], "source": e["source"], "duration": f["audio_s"], "labels": e.get("labels"),
                         "scores": scores, "ch_scores": ch, "array": f["channels"] == 4, "path": e["path"], "scene": e.get("scene")})

    report = {
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "settings": {"sensitivity": sensitivity, "persistence_s": persistence_s, "grace_s": GRACE_S, "window_s": SPEC.window_s, "hop_s": SPEC.hop_s},
        "model": bundle.summary(),
        "speed": {
            m: {
                "ms_per_window": round(1000 * (a[0] + a[2]) / max(a[1], 1), 2),
                "x_realtime": round(SPEC.hop_s * a[1] / max(a[0] + a[2], 1e-9), 1),
                "note": "per hydrophone per 1 s window (one window every 0.5 s); x real time is per hydrophone",
            }
            for m, a in speed_acc.items()
        },
        "by_source": {},
    }
    for src in ("simulated", "real"):
        group = [s for s in sessions if s["source"] == src]
        if not group:
            continue
        has_labels = any(s["labels"] for s in group)
        res = {
            "sessions": [s["session"] for s in group],
            "hours": round(sum(s["duration"] for s in group) / 3600, 3),
            "has_labelled_events": has_labels,
            "methods": {},
        }
        for m in METHODS:
            main = _metrics(group, m, bundle, sensitivity, persistence_s)
            sweep_s = []
            for sv in SWEEP_SENS:
                r = _metrics(group, m, bundle, sv, persistence_s)
                sweep_s.append({k: r[k] for k in ("threshold", "false_alerts_per_hour", "detection_rate", "time_to_alert_median_s")} | {"sensitivity": sv})
            sweep_p = []
            for pv in SWEEP_PERSIST:
                r = _metrics(group, m, bundle, sensitivity, pv)
                sweep_p.append({k: r[k] for k in ("false_alerts_per_hour", "detection_rate", "time_to_alert_median_s")} | {"persistence_s": pv})
            res["methods"][m] = {**main, "window_auc": _window_auc(group, m), "sweep_sensitivity": sweep_s, "sweep_persistence": sweep_p}
            arr = [s for s in group if s["array"]]
            if arr:
                res["methods"][m]["response"] = _response_eval(bundle, arr, m, sensitivity, persistence_s)
        report["by_source"][src] = res
    return report


def to_markdown(r: dict) -> str:
    L = ["# Detector comparison: Spectrogram vs EMD", "", f"Generated {r['generated']}. Settings: sensitivity {r['settings']['sensitivity']}, persistence {r['settings']['persistence_s']} s, matching grace {r['settings']['grace_s']} s.", ""]
    m = r["model"]
    L += [f"Trained on {len(m['train_sessions'])} sessions, thresholds calibrated on {len(m['calibration_sessions'])} separate sessions (data: {', '.join(m['data_source'])}).", ""]
    L += ["## Processing speed", "", "| Method | ms / window | x real-time |", "|---|---|---|"]
    for k, v in r["speed"].items():
        L.append(f"| {k} | {v['ms_per_window']} | {v['x_realtime']}x |")
    for src, res in r["by_source"].items():
        tag = "SIMULATED DATA: demonstrates the pipeline only, not real-world performance" if src == "simulated" else "REAL RECORDINGS"
        L += ["", f"## Results on {tag}", "", f"{len(res['sessions'])} test sessions, {res['hours']} h."]
        L += ["", "| Metric | Spectrogram | EMD |", "|---|---|---|"]
        a, b = res["methods"]["spectrogram"], res["methods"]["emd"]

        def row(name, key, fmt=lambda v: "n/a" if v is None else str(v)):
            L.append(f"| {name} | {fmt(a[key])} | {fmt(b[key])} |")

        row("False alerts / hour", "false_alerts_per_hour")
        row("  95% interval", "false_alerts_per_hour_ci95", lambda v: f"{v[0]}–{v[1]}")
        row("  false alerts (count)", "false_alerts")
        if res["has_labelled_events"]:
            row("Detection rate", "detection_rate", lambda v: "n/a" if v is None else f"{v:.0%}")
            row("  events detected", "detected", lambda v: str(v))
            row("Median time to alert (s)", "time_to_alert_median_s")
            row("Window AUC", "window_auc")
        else:
            L.append("| Detection rate | not measurable: no labelled events | |")
        if "response" in a:
            ra, rb = a["response"], b["response"]
            L += ["", "Response loop on array sessions (location + inspection boat, simulated officer):", "",
                  "| Measure | Spectrogram | EMD |", "|---|---|---|"]
            for name, key in [("Median location error (m)", "loc_error_median_m"), ("90th pct location error (m)", "loc_error_p90_m"),
                              ("Truth inside stated 95% area", "loc_inside_95_rate"), ("Inspection sorties", "sorties"),
                              ("Sorties on false alerts", "sorties_on_false_alerts"), ("Events reached by boat (sonar contact)", "events_reached"),
                              ("Median event start to contact (s)", "contact_after_median_s"), ("Alerts explained by AIS", "alerts_explained_by_ais")]:
                L.append(f"| {name} | {ra[key] if ra[key] is not None else 'n/a'} | {rb[key] if rb[key] is not None else 'n/a'} |")
        if res["has_labelled_events"]:
            L += ["", "Per event:", "", "| Session | Event | SNR dB | Spectrogram | EMD |", "|---|---|---|---|---|"]
            for pa, pb in zip(a["per_event"], b["per_event"]):
                fa = f"{pa['time_to_alert']} s" if pa["detected"] else "missed"
                fb = f"{pb['time_to_alert']} s" if pb["detected"] else "missed"
                L.append(f"| {pa['session']} | {pa['label']} | {pa.get('snr_db', '')} | {fa} | {fb} |")
    return "\n".join(L) + "\n"


def run_default(sensitivity: float = 50, persistence_s: float = 4.0, retrain: bool = True) -> dict:
    store.ensure_sample_data()
    errs = store.check_sessions(store.entries())
    if errs:
        raise ValueError("; ".join(errs))
    bundle = None if retrain else ModelBundle.load(store.MODEL_PATH)
    if bundle is None:
        bundle = train_bundle(store.entries("train"), store.entries("calibration"))
        bundle.save(store.MODEL_PATH)
    report = evaluate(bundle, store.entries("test"), sensitivity, persistence_s)
    store.REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (store.REPORT_DIR / "latest.json").write_text(json.dumps(report, indent=2, default=float))
    (store.REPORT_DIR / "latest.md").write_text(to_markdown(report))
    return report


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sensitivity", type=float, default=50)
    ap.add_argument("--persistence", type=float, default=4.0)
    ap.add_argument("--use-saved-model", action="store_true")
    a = ap.parse_args()
    rep = run_default(a.sensitivity, a.persistence, retrain=not a.use_saved_model)
    print(to_markdown(rep))
    print(f"Report written to {store.REPORT_DIR / 'latest.md'}")
