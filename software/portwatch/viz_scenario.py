"""Turn a live replay session into a scenario for the 3D visualisation (viz/).

The dashboard sends this scenario to the embedded viz and keeps it updated as
the incident develops; the viz follows the dashboard's feed clock, so both
halves of the screen show the same moment.

What it contains
- The simulated hydrophone array and berths. The source's true track and
  non-AIS craft are included only when truth display is requested or the
  source has been confirmed by an officer.
- What the system knew and did, taken from the live session: alert time and
  score, which hydrophones heard it, the location estimate, the inspection
  boat's actual track plus its planned route, sonar contact, officer verdict.
- Camera shots placed around those moments.

Coordinates: local harbour metres (x east, y north) -> viz [x, depth, z] with
z pointing south, centred on the patrol basin.
"""
from __future__ import annotations

import numpy as np

from . import harbour as H
from .simulate import position

_px, _py = [p[0] for p in H.PATROL], [p[1] for p in H.PATROL]
CX, CY = (min(_px) + max(_px)) / 2, (min(_py) + max(_py)) / 2
VEXAG = 4.0  # must match viz/src/theme.ts
DEPTH = {"uuv": -8.0, "diver": -5.0}
KIND_LABEL = {"uuv": "Small underwater vehicle", "diver": "Diver"}


def V(x: float, y: float, depth: float = 0.0) -> list[float]:
    return [round(float(x) - CX, 1), round(depth, 1), round(-(float(y) - CY), 1)]


def _scene(x: float, y: float, depth: float, up: float = 0.0, back: float = 0.0, side: float = 0.0) -> list[float]:
    """Camera-space point (scene units, depth already exaggerated)."""
    vx, vy, vz = V(x, y, depth)
    return [round(vx + side, 1), round(vy * VEXAG + up, 1), round(vz + back, 1)]


def _fmt(t: float | None) -> str:
    if t is None:
        return "–"
    s = int(max(0, t))
    return f"{s // 60:02d}:{s % 60:02d}"


def _first_state(sortie: dict | None, state: str) -> float | None:
    for t, st in (sortie or {}).get("states", []):
        if st == state:
            return t
    return None


def _boat_plan(boat, t_now: float) -> list[dict]:
    """Planned future keyframes of the boat from its current route, so motion stays smooth between updates."""
    if boat.state == "docked":
        return []
    pts: list[tuple[float, float]] = []
    t = t_now
    if boat.state == "pending":
        t = max(t, boat.pending_until or t)
        pts = H.route((boat.x, boat.y), (boat.target["x"], boat.target["y"])) if boat.target else []
        speed = H.USV_SPEED
    else:
        pts = list(boat.path) + (list(boat.waypoints) if boat.state == "searching" else [])
        speed = H.USV_SEARCH_SPEED if boat.state == "searching" else H.USV_SPEED
    out, cur = [], (boat.x, boat.y)
    if boat.state == "pending":
        out.append({"t": round(t, 2), "pos": V(*cur)})
    for p in pts[:80]:
        t += float(np.hypot(p[0] - cur[0], p[1] - cur[1])) / speed
        out.append({"t": round(t, 2), "pos": V(*p)})
        cur = p
    return out


def build(proc, entry: dict, show_truth: bool = False) -> dict:
    t_now = proc.now()
    m = proc.active_method
    eng = proc.engines[m]
    boat = proc.boat
    truth = proc.truth

    # the incident: the alert the boat is handling, else the latest alert of the officer's method
    sortie = boat.sortie or (boat.sorties[-1] if boat.sorties else None)
    ev = None
    if sortie:
        ev = next((e for e in eng.events if e["id"] == sortie["event_id"]), None)
    if ev is None and eng.events:
        ev = eng.events[-1]
    if sortie and ev and sortie["event_id"] != ev["id"]:
        sortie = None
    cand_start = ev["start"] if ev else (eng.cand.start if eng.cand else None)
    key = f"{cand_start:.2f}" if cand_start is not None else None

    loc = (ev or {}).get("location") or proc.locations[m]
    fix = (loc.get("best") or loc) if loc else None

    # unusual source (simulated truth) nearest the estimate
    src = None
    cands = [s for s in truth.sources if s["event"] and s["t_on"] <= t_now + 1]
    if cands:
        t_ref = ev["alert_time"] if ev else t_now
        if fix:
            src = min(cands, key=lambda s: float(np.hypot(*(np.array(position(s["track"], t_ref)) - [fix["x"], fix["y"]]))))
        else:
            src = cands[-1]
    src_depth = DEPTH.get(src["kind"], -8.0) if src else -8.0

    events: list[dict] = []
    t_alert = ev["alert_time"] if ev else None
    if key and key in proc.heard[m]:
        for h, th in sorted(proc.heard[m][key].items(), key=lambda kv: kv[1]):
            events.append({"t": th, "type": "hear", "hydrophone": H.HYDROPHONES[h]["id"]})
    t_loc = None
    if t_alert is not None:
        events.append({"t": t_alert, "type": "phase", "phase": "DETECT"})
        events.append({"t": t_alert, "type": "label", "text": f"Unusual acoustic event · score {ev.get('peak_score', 0):.1f}"})
        lf = proc.loc_first[m].get(key) if key else None
        if fix and lf is not None:
            t_loc = max(t_alert + 2.0, lf)  # shown just after the alert so the phases read in order
            events.append({"t": t_loc, "type": "phase", "phase": "LOCATE"})
            if show_truth:
                events.append({"t": t_loc, "type": "bearings", "noiseDeg": 4})
            events.append({"t": t_loc, "type": "estimate", "pos": V(fix["x"], fix["y"]),
                           "radius": fix["r95"], "shrinkTo": fix["r95"], "shrinkDur": 1})

    t_launch = sortie["launched_at"] if sortie else None
    t_enroute = _first_state(sortie, "en_route")
    t_search = _first_state(sortie, "searching")
    t_contact = sortie.get("contact_at") if sortie else None
    t_await = _first_state(sortie, "awaiting_verdict")
    # the officer's decision is needed from the moment sonar has contact (or the search ends empty)
    t_handoff = t_contact if t_contact is not None else t_await
    t_verdict = sortie.get("verdict_at") if sortie else None
    verdict = sortie.get("verdict") if sortie else None
    t_inspect = t_enroute if t_enroute is not None else t_launch
    if t_launch is not None:
        t_decide = max(t_launch, t_loc or t_launch)
        if _first_state(sortie, "pending") is not None:
            events.append({"t": t_decide, "type": "action", "mode": "auto",
                           "text": f"Auto-dispatch: boat launches in {boat.policy.cancel_s:.0f} s unless the officer cancels"})
        elif sortie["how"] == "officer":
            events.append({"t": t_decide, "type": "action", "mode": "approved", "text": "Inspection boat dispatched by officer"})
    if t_inspect is not None and verdict != "cancelled by officer":
        events.append({"t": max(t_inspect, (t_loc or t_inspect) + 1.0), "type": "phase", "phase": "INSPECT"})
    if verdict == "cancelled by officer":
        events.append({"t": sortie.get("back_at") or t_now, "type": "action", "mode": "approved", "text": "Launch cancelled by officer"})
    if t_enroute is not None:
        events.append({"t": t_enroute, "type": "action", "mode": "auto", "text": "Inspection boat under way to the estimated area"})
    if t_search is not None:
        events.append({"t": t_search, "type": "action", "mode": "auto", "text": "Sonar search of the estimated area"})
    if t_contact is not None:
        c = sortie.get("contact") or {}
        events.append({"t": t_contact, "type": "scan", "dur": boat.policy.inspect_s, "result": "suspicious"})
        events.append({"t": t_contact, "type": "label", "text": f"Sonar contact · {c.get('sonar', 'underwater object').lower()}"})
    elif t_await is not None:
        events.append({"t": t_await, "type": "label", "text": "Search complete · nothing on sonar"})
    if t_handoff is not None:
        events.append({"t": t_handoff + 0.5, "type": "phase", "phase": "HANDOFF"})
        events.append({"t": t_handoff + 0.5, "type": "banner", "style": "handoff", "text": "HANDOFF → Officer"})
        events.append({"t": t_handoff + 0.5, "type": "action", "mode": "approval", "text": "Record the inspection verdict — needs officer"})
    if t_verdict is not None and verdict and verdict != "cancelled by officer":
        events.append({"t": t_verdict, "type": "action", "mode": "approved", "text": f"Officer verdict: {verdict}"})
        if verdict == "confirmed intrusion" and t_contact is not None and src:
            events.append({"t": t_verdict, "type": "reveal",
                           "text": f"{KIND_LABEL.get(src['kind'], 'Underwater object')} · confirmed by sonar and officer"})
            events.append({"t": t_verdict + 6, "type": "endcard", "lines": [
                f"Intrusion confirmed at T+{_fmt(t_verdict)}.",
                f"Alert T+{_fmt(t_alert)}, boat on scene T+{_fmt(sortie.get('on_scene_at'))}, sonar contact T+{_fmt(t_contact)}."]})
        else:
            events.append({"t": t_verdict + 6, "type": "endcard", "lines": [f"Inspection complete: {verdict}.", "Boat returning to dock."]})
    events.sort(key=lambda e: e["t"])

    # tracks
    dock = V(*H.USV_DOCK)
    track = [{"t": 0.0, "pos": dock}]
    last = -1e9
    for t, x, y in proc.boat_track:
        if t - last >= 1.0:
            track.append({"t": round(t, 2), "pos": V(x, y)})
            last = t
    if proc.boat_track:
        t, x, y = proc.boat_track[-1]
        if track[-1]["t"] < t:
            track.append({"t": round(t, 2), "pos": V(x, y)})
    track += [k for k in _boat_plan(boat, t_now) if k["t"] > track[-1]["t"]]

    truth_revealed_at = t_verdict if verdict == "confirmed intrusion" and t_contact is not None else None
    if src and (show_truth or truth_revealed_at is not None):
        visible_from = (cand_start if cand_start is not None else src["t_on"]) if show_truth else truth_revealed_at
        intruder = {"path": [{"t": round(p[0], 2), "pos": V(p[1], p[2], src_depth)} for p in src["track"]],
                    "visibleFrom": round(visible_from, 2)}
    else:
        intruder = {"path": [{"t": 0.0, "pos": [0.0, -8.0, 0.0]}], "visibleFrom": 1e9}

    boats = []
    for i, s in enumerate(truth.sources):
        if s["kind"] in ("large vessel", "small craft") and (show_truth or s["ais"]):
            path = [{"t": round(p[0], 2), "pos": V(p[1], p[2])} for p in s["track"]]
            boats.append({"id": (s["ais"] or {}).get("name") or f"craft-{i}", "path": path})

    ref = (fix["x"], fix["y"]) if fix else (CX, CY)
    berths = sorted(enumerate(H.BERTHS), key=lambda kv: np.hypot(kv[1][0] - ref[0], kv[1][1] - ref[1]))
    zones = []
    for i, (bx, by) in berths:
        a, b = V(bx - 50, by - 20), V(bx + 50, by + 20)
        zones.append({"name": f"Berth {i + 1}", "min": [min(a[0], b[0]), min(a[2], b[2])], "max": [max(a[0], b[0]), max(a[2], b[2])]})

    # camera: wide harbour view, then follow the incident as it unfolds
    camera = [{"t": 0, "pos": [0, 1700, 1900], "target": [0, -80, 0], "dur": 0}]
    if t_alert is not None and fix:
        camera.append({"t": t_alert, "pos": _scene(fix["x"], fix["y"], 0, up=420, back=560), "target": _scene(fix["x"], fix["y"], src_depth), "dur": 4})
    if t_enroute is not None and fix:
        mx, my = (H.USV_DOCK[0] + fix["x"]) / 2, (H.USV_DOCK[1] + fix["y"]) / 2
        camera.append({"t": t_enroute, "pos": _scene(mx, my, 0, up=480, back=620), "target": _scene(mx, my, -6), "dur": 4})
    if t_search is not None:
        bx, by = next(((x, y) for t, x, y in proc.boat_track if t >= t_search), (boat.x, boat.y))
        camera.append({"t": t_search, "pos": _scene(bx, by, 0, up=220, back=300), "target": _scene(bx, by, -6), "dur": 4})
    if t_contact is not None and src and show_truth:
        sx, sy = position(src["track"], t_contact)
        camera.append({"t": t_contact, "pos": _scene(sx, sy, src_depth, up=40, back=150, side=60), "target": _scene(sx, sy, src_depth), "dur": 4})
    if t_verdict is not None and fix:
        camera.append({"t": t_verdict + 8, "pos": _scene(fix["x"], fix["y"], 0, up=600, back=760), "target": _scene(fix["x"], fix["y"], -10), "dur": 6})
    camera.sort(key=lambda c: c["t"])

    duration = round(max(proc.duration, t_now, track[-1]["t"]) + 120, 1)
    marks = [("Quiet harbour", 0.0), ("Detect", t_alert), ("Locate", t_loc), ("Inspect", t_inspect), ("Handoff", None if t_handoff is None else t_handoff + 0.5), ("Outcome", t_verdict)]
    known = [(n, t) for n, t in marks if t is not None]
    acts = []
    for i, (name, start) in enumerate(known):
        end = known[i + 1][1] if i + 1 < len(known) else duration
        acts.append({"id": i + 1, "name": name, "start": round(start, 2), "end": round(max(end, start + 0.01), 2), "rate": 1})

    hyd_near = loc.get("nearest_hydrophone") if loc else None
    return {
        "title": f"{entry['name']} · 3D reconstruction",
        "duration": duration,
        "acts": acts,
        "vMax": 2.0,    # m/s, fastest plausible small vehicle: drives the "officer must decide in" countdown
        "tHuman": 10,   # s, officer reaction time
        "hydrophones": [{"id": h["id"], "pos": V(h["x"], h["y"], -20)} for h in H.HYDROPHONES],
        "zones": zones,
        "intruder": intruder,
        "truthVisible": show_truth,
        "droneBoat": {"path": track},
        "surfaceBoats": boats,
        "events": events,
        "camera": camera,
        "cameraDrift": {"deg": 9, "period": 48, "lift": 0.06},  # slow orbit so the view feels live (viz CameraDirector)
        "text": {
            "summaries": {
                "LOCATE": f"Located near {hyd_near}, within about {fix['r95']:.0f} m. Not confirmed; verify." if fix else None,
                "INSPECT": "Inspection boat dispatched to the estimated area.",
                "HANDOFF": "Sonar contact made. Officer verdict needed." if t_contact is not None else "Search complete. Officer verdict needed.",
            },
            "revealLevel": "THREAT",
            "revealSummary": "Intrusion confirmed by inspection. Escalate per the port security plan.",
        },
    }
