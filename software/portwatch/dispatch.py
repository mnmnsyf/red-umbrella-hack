"""Inspection-boat dispatch: decision rules, a SIMULATED uncrewed boat, and
SIMULATED sensors / AIS feed.

What drives what
- Detection, alert and the boat's target come only from the acoustic model
  and the location estimate.
- ``SceneTruth`` reads the simulator's scene sidecar. It plays the part of
  the physical world: the AIS feed (AIS-broadcasting vessels only) and the
  boat's own sonar and camera. It is never used to raise alerts or to choose
  where the boat goes.

Policy: auto-launch with an officer cancel window (default 15 s of feed time).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import harbour as H
from .simulate import position


# ---------------------------------------------------------------- simulated world
class SceneTruth:
    def __init__(self, scene: dict | None):
        self.scene = scene
        self.sources = scene["sources"] if scene else []
        self.amb = scene["ambient_level"] if scene else 0.006

    @staticmethod
    def load(path: str | None) -> "SceneTruth":
        if path and Path(path).exists():
            return SceneTruth(json.loads(Path(path).read_text()))
        return SceneTruth(None)

    @property
    def available(self) -> bool:
        return self.scene is not None

    def _active(self, s: dict, t: float) -> bool:
        return s["t_on"] <= t <= s["t_off"]

    def ais_at(self, t: float) -> list[dict]:
        """Simulated AIS feed: only vessels that broadcast AIS."""
        out = []
        for s in self.sources:
            if not s["ais"] or not self._active(s, t):
                continue
            x, y = position(s["track"], t)
            x2, y2 = position(s["track"], t + 2)
            sp = float(np.hypot(x2 - x, y2 - y) / 2)
            out.append({"name": s["ais"]["name"], "type": s["ais"]["type"], "x": round(float(x), 1), "y": round(float(y), 1),
                        "course": round(float(np.degrees(np.arctan2(x2 - x, y2 - y))) % 360, 0), "speed_kn": round(sp * 1.944, 1)})
        return out

    def ais_xy(self, t: float) -> np.ndarray:
        return np.array([[a["x"], a["y"]] for a in self.ais_at(t)]).reshape(-1, 2)

    def sonar(self, x: float, y: float, t: float) -> list[dict]:
        """Underwater objects within sonar range (simulated sensor)."""
        out = []
        for s in self.sources:
            # an object stays physically present after it goes quiet (it holds its last position)
            if s["underwater"] and t >= s["t_on"]:
                sx, sy = position(s["track"], t)
                r = float(np.hypot(sx - x, sy - y))
                if r <= H.SONAR_RANGE:
                    out.append({"range_m": round(r), "bearing_deg": round(float(np.degrees(np.arctan2(sx - x, sy - y))) % 360),
                                "x": float(sx), "y": float(sy), "kind": s["kind"], "amp": s["amp"] if self._active(s, t) else 0.0})
        return out

    def camera(self, x: float, y: float, t: float) -> list[dict]:
        """Surface vessels in camera range (simulated sensor)."""
        out = []
        for s in self.sources:
            if s["kind"] in ("large vessel", "small craft") and self._active(s, t):
                sx, sy = position(s["track"], t)
                r = float(np.hypot(sx - x, sy - y))
                if r <= H.CAMERA_RANGE:
                    name = s["ais"]["name"] if s["ais"] else None
                    out.append({"range_m": round(r), "what": f"{s['kind']}" + (f" ({name}, AIS)" if name else ", no AIS")})
        return out

    def event_positions(self, t: float) -> list[dict]:
        """Ground truth of unusual sources, for the analyst overlay and evaluation only."""
        out = []
        for s in self.sources:
            if s["event"] and self._active(s, t):
                x, y = position(s["track"], t)
                out.append({"kind": s["kind"], "x": round(float(x), 1), "y": round(float(y), 1)})
        return out


# ---------------------------------------------------------------- policy
@dataclass
class DispatchPolicy:
    auto: bool = True
    cancel_s: float = 15.0          # officer cancel window (feed seconds)
    max_r95_m: float = 250.0        # don't auto-launch on a location vaguer than this
    ais_radius_m: float = 75.0      # AIS vessel this close to the estimate explains the sound
    verdict_timeout_s: float = 120.0
    inspect_s: float = 20.0         # time spent observing after a sonar contact


def check_dispatch(event: dict | None, loc: dict | None, ais: list[dict], boat_free: bool, policy: DispatchPolicy) -> dict:
    """Decide whether an inspection may be launched. Returns reasons in plain language."""
    reasons, ais_match = [], None
    if event is None or event.get("status") != "active":
        reasons.append("No active alert.")
    if loc is None:
        reasons.append("No location estimate yet (needs the hydrophone array).")
    else:
        if loc["r95"] > policy.max_r95_m:
            reasons.append(f"Location too uncertain ({loc['r95']:.0f} m).")
        if not H.point_in_poly(loc["x"], loc["y"], H.PATROL):
            reasons.append("Estimated position is outside the patrol area.")
        if ais:
            d = [(np.hypot(a["x"] - loc["x"], a["y"] - loc["y"]), a) for a in ais]
            dist, a = min(d, key=lambda z: z[0])
            if dist <= max(policy.ais_radius_m, 0.5 * loc["r95"]):
                ais_match = {"name": a["name"], "type": a["type"], "distance_m": round(float(dist))}
                reasons.append(f"Likely a known vessel: {a['name']} (AIS) is {dist:.0f} m from the estimate.")
    if not boat_free:
        reasons.append("Inspection boat is already on a task.")
    return {"ok": not reasons, "reasons": reasons, "ais_match": ais_match}


def _spiral(cx: float, cy: float, radius: float, spacing: float) -> list[tuple[float, float]]:
    pts, th = [], 0.0
    b = spacing / (2 * np.pi)
    while b * th <= radius:
        r = b * th
        x, y = cx + r * np.cos(th), cy + r * np.sin(th)
        if H.point_in_poly(x, y, H.PATROL):
            pts.append((float(x), float(y)))
        th += max(0.3, 20.0 / max(r, 20.0))
    return pts or [(cx, cy)]


# ---------------------------------------------------------------- boat
STATE_TEXT = {
    "docked": "Docked, ready",
    "pending": "Launch pending",
    "en_route": "En route to search area",
    "searching": "Searching",
    "inspecting": "Sonar contact, observing",
    "awaiting_verdict": "Awaiting officer verdict",
    "returning": "Returning to dock",
}


@dataclass
class Boat:
    policy: DispatchPolicy = field(default_factory=DispatchPolicy)
    state: str = "docked"
    x: float = H.USV_DOCK[0]
    y: float = H.USV_DOCK[1]
    heading: float = 90.0
    target: dict | None = None
    event_id: str | None = None
    waypoints: list = field(default_factory=list)
    pending_until: float | None = None
    contact: dict | None = None
    camera: list = field(default_factory=list)
    sortie: dict | None = None
    sorties: list = field(default_factory=list)
    handled: set = field(default_factory=set)
    trail: list = field(default_factory=list)
    _cmd: list = field(default_factory=list)
    state_since: float = 0.0

    @property
    def free(self) -> bool:
        return self.state == "docked"

    def command(self, cmd: str, **kw) -> None:
        self._cmd.append((cmd, kw))

    def _set(self, state: str, t: float) -> None:
        self.state, self.state_since = state, t

    def _move_to(self, tx: float, ty: float, speed: float, dt: float) -> float:
        dx, dy = tx - self.x, ty - self.y
        d = float(np.hypot(dx, dy))
        step = min(d, speed * dt)
        if d > 1e-6:
            self.x += dx / d * step
            self.y += dy / d * step
            self.heading = float(np.degrees(np.arctan2(dx, dy))) % 360
        return d - step

    @staticmethod
    def _search_point(loc: dict) -> dict:
        b = loc.get("best")
        return {"x": b["x"], "y": b["y"], "r95": b["r95"]} if b else {"x": loc["x"], "y": loc["y"], "r95": loc["r95"]}

    def _launch(self, t: float, event: dict, loc: dict, how: str) -> None:
        self.event_id = event["id"]
        self.handled.add(event["id"])
        self.target = self._search_point(loc)
        self.sortie = {"event_id": event["id"], "launched_at": round(t, 1), "how": how, "event_start": event["start"],
                       "on_scene_at": None, "contact_at": None, "contact": None, "verdict": None, "back_at": None}
        self._set("en_route", t)

    def _finish(self, t: float, verdict: str | None, note: str = "") -> None:
        if self.sortie is not None:
            self.sortie["verdict"] = self.sortie["verdict"] or verdict
            self.sortie["note"] = note
        self.waypoints = []
        self._set("returning", t)

    def step(self, t: float, dt: float, event: dict | None, loc: dict | None, truth: SceneTruth, ais: list[dict]) -> dict:
        """Advance one analysis step. ``event``/``loc`` describe the active alert of the officer's chosen method."""
        p = self.policy
        check = check_dispatch(event, loc, ais, self.free, p)
        for cmd, kw in self._cmd:
            if cmd == "dispatch" and self.free and event is not None and loc is not None:
                self._launch(t, event, loc, "officer")
            elif cmd == "launch_now" and self.state == "pending":
                self._set("en_route", t)
                self.sortie["how"] = "auto (launched early by officer)"
            elif cmd == "cancel" and self.state == "pending":
                self.sortie["verdict"] = "cancelled by officer"
                self.sortie["back_at"] = round(t, 1)
                self.sorties.append(self.sortie)
                self.sortie, self.target, self.event_id = None, None, None
                self._set("docked", t)
            elif cmd == "recall" and self.state not in ("docked", "returning"):
                self._finish(t, "recalled by officer")
            elif cmd == "verdict" and self.state in ("searching", "inspecting", "awaiting_verdict"):
                self._finish(t, kw.get("verdict"), kw.get("note", ""))
        self._cmd = []

        # auto-launch with cancel window
        if self.state == "docked" and p.auto and check["ok"] and event["id"] not in self.handled:
            self._launch(t, event, loc, "auto")
            if p.cancel_s > 0:
                self.pending_until = t + p.cancel_s
                self._set("pending", t)
        if self.state == "pending" and t >= (self.pending_until or t):
            self._set("en_route", t)

        if self.state == "en_route":
            if loc is not None and event is not None and event["id"] == self.event_id:
                self.target = self._search_point(loc)  # follow the best fix as evidence accumulates
            rem = self._move_to(self.target["x"], self.target["y"], H.USV_SPEED, dt)
            if rem < 5:
                self.sortie["on_scene_at"] = round(t, 1)
                radius = max(self.target["r95"], 60.0)
                self.waypoints = _spiral(self.target["x"], self.target["y"], radius, 1.6 * H.SONAR_RANGE)
                self._set("searching", t)
        elif self.state == "searching":
            if self.waypoints:
                if self._move_to(*self.waypoints[0], H.USV_SEARCH_SPEED, dt) < 2:
                    self.waypoints.pop(0)
            hits = truth.sonar(self.x, self.y, t)
            if hits:
                h = min(hits, key=lambda z: z["range_m"])
                level = 20 * np.log10(h["amp"] / max(h["range_m"], 3) / truth.amb) if h["amp"] > 0 else None
                self.contact = {
                    "at": round(t, 1), "range_m": h["range_m"], "bearing_deg": h["bearing_deg"],
                    "sonar": "Small underwater object" + (", moving" if h["amp"] > 0 else ", stationary"),
                    "close_range_acoustic_db": None if level is None else round(float(level), 1),
                    "simulated": True,
                }
                self.sortie["contact_at"] = round(t, 1)
                self.sortie["contact"] = self.contact
                self._set("inspecting", t)
            elif not self.waypoints:
                self.contact = None
                self._set("awaiting_verdict", t)
        elif self.state in ("inspecting", "awaiting_verdict"):
            hits = truth.sonar(self.x, self.y, t) if self.contact else []
            if hits:  # keep station ~15 m from the contact
                h = min(hits, key=lambda z: z["range_m"])
                if h["range_m"] > 15:
                    self._move_to(h["x"], h["y"], H.USV_SEARCH_SPEED, dt)
                self.contact.update(range_m=h["range_m"], bearing_deg=h["bearing_deg"])
            if self.state == "inspecting" and t - self.state_since >= p.inspect_s:
                self._set("awaiting_verdict", t)
            if self.state == "awaiting_verdict" and t - self.state_since >= p.verdict_timeout_s:
                self._finish(t, "no verdict recorded")
        elif self.state == "returning":
            if self._move_to(*H.USV_DOCK, H.USV_SPEED, dt) < 2:
                self.sortie["back_at"] = round(t, 1)
                self.sorties.append(self.sortie)
                self.sortie, self.target, self.event_id, self.contact = None, None, None, None
                self._set("docked", t)

        if self.state != "docked":
            self.camera = truth.camera(self.x, self.y, t)
            self.trail.append((round(self.x, 1), round(self.y, 1)))
            self.trail = self.trail[-240:]
        else:
            self.camera, self.trail = [], []
        return check

    def snapshot(self, t: float) -> dict:
        eta = None
        if self.state == "en_route" and self.target:
            eta = round(float(np.hypot(self.target["x"] - self.x, self.target["y"] - self.y)) / H.USV_SPEED, 0)
        elif self.state == "returning":
            eta = round(float(np.hypot(H.USV_DOCK[0] - self.x, H.USV_DOCK[1] - self.y)) / H.USV_SPEED, 0)
        return {
            "state": self.state,
            "state_text": STATE_TEXT[self.state],
            "x": round(self.x, 1), "y": round(self.y, 1), "heading": round(self.heading),
            "target": self.target,
            "event_id": self.event_id,
            "pending_left_s": round(max(0.0, self.pending_until - t), 1) if self.state == "pending" else None,
            "eta_s": eta,
            "waypoints": [[round(a, 1), round(b, 1)] for a, b in self.waypoints[:200]],
            "trail": self.trail[-120:],
            "contact": self.contact,
            "camera": self.camera,
            "sortie": self.sortie,
            "sorties": self.sorties,
            "auto": self.policy.auto,
            "cancel_s": self.policy.cancel_s,
        }
