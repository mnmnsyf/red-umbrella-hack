"""Persistence-based alerting and officer threat levels.

The engine consumes one anomaly score per analysis window, in time order, and
never looks ahead. It does the same thing live and in offline evaluation.

Rules
- A window is "hot" when its score exceeds the threshold.
- Hot windows start a *candidate*. Dips shorter than ``gap_s`` don't reset it.
- When the candidate has been hot for ``persistence_s`` an ALERT event fires.
  The alert time is the end of the window that confirmed it (when a live
  system could actually raise it).
- The event closes after ``clear_s`` with no hot window.
"""
from __future__ import annotations

from dataclasses import dataclass, field

EVENT_LABEL = "Unusual acoustic event (possible intrusion)"

LEVELS = [
    {"level": 0, "name": "NORMAL", "summary": "Acoustic picture consistent with normal port activity."},
    {"level": 1, "name": "WATCH", "summary": "Brief unusual sound(s) detected; monitoring."},
    {"level": 2, "name": "ELEVATED", "summary": "Unusual sound persisting; alert likely if it continues."},
    {"level": 3, "name": "ALERT", "summary": "Persistent unusual acoustic event. Possible intrusion. Not confirmed; verify."},
]


@dataclass
class AlertParams:
    threshold: float
    persistence_s: float = 4.0
    gap_s: float = 1.0
    clear_s: float = 4.0
    hop_s: float = 0.5


@dataclass
class _Candidate:
    start: float        # start time of first hot window
    first_end: float    # end time of first hot window
    last_hot: float     # end time of most recent hot window
    peak: float
    peak_t: float
    peak_band: dict | None
    hot_count: int = 1
    score_sum: float = 0.0


@dataclass
class AlertEngine:
    method: str
    params: AlertParams
    cand: _Candidate | None = None
    active: dict | None = None
    events: list[dict] = field(default_factory=list)
    last_cleared_t: float | None = None
    _next_id: int = 1

    def step(self, t_start: float, t_end: float, score: float, band: dict | None = None) -> dict | None:
        """Process one window. Returns an event dict if one fired or ended this step."""
        p = self.params
        changed = None
        if score > p.threshold:
            if self.cand is None:
                self.cand = _Candidate(t_start, t_end, t_end, score, t_end, band, 1, score)
            else:
                c = self.cand
                c.last_hot = t_end
                c.hot_count += 1
                c.score_sum += score
                if score > c.peak:
                    c.peak, c.peak_t, c.peak_band = score, t_end, band
            c = self.cand
            if self.active is None and self.persisted(t_end) >= p.persistence_s:
                self.active = {
                    "id": f"{self.method[:4].upper()}-{self._next_id:03d}",
                    "method": self.method,
                    "label": EVENT_LABEL,
                    "start": round(c.start, 2),
                    "alert_time": round(t_end, 2),
                    "end": None,
                    "status": "active",
                }
                self._next_id += 1
                self.events.append(self.active)
                changed = self.active
            if self.active is not None:
                self._sync_active()
        elif self.cand is not None:
            quiet = t_end - self.cand.last_hot
            if self.active is None and quiet > p.gap_s:
                self.cand = None  # transient blip, never confirmed
            elif self.active is not None and quiet >= p.clear_s:
                self.active["end"] = round(self.cand.last_hot, 2)
                self.active["status"] = "ended"
                changed = self.active
                self.active, self.cand = None, None
                self.last_cleared_t = t_end
        return changed

    def persisted(self, t_end: float) -> float:
        return 0.0 if self.cand is None else (t_end - self.cand.first_end) + self.params.hop_s

    def _sync_active(self) -> None:
        c = self.cand
        self.active.update(
            peak_score=round(c.peak, 2),
            peak_time=round(c.peak_t, 2),
            mean_score=round(c.score_sum / c.hot_count, 2),
            band=c.peak_band,
            last_hot=round(c.last_hot, 2),
        )

    def threat_level(self, t_end: float) -> dict:
        """Map detector state to the officer-facing threat level."""
        if self.active is not None:
            lvl = 3
        elif self.cand is not None and self.persisted(t_end) >= 0.5 * self.params.persistence_s:
            lvl = 2
        elif self.cand is not None or (self.last_cleared_t is not None and t_end - self.last_cleared_t < 20):
            lvl = 1
        else:
            lvl = 0
        out = dict(LEVELS[lvl])
        if self.cand is not None and self.active is None:
            out["progress"] = round(min(1.0, self.persisted(t_end) / max(self.params.persistence_s, 1e-6)), 2)
        if lvl == 1 and self.cand is None:
            out["summary"] = "Recent unusual event has cleared; continue monitoring."
        return out
