"""Source localisation from a hydrophone array (time difference of arrival).

1. For each hydrophone pair, estimate how much later the sound arrives at one
   than the other: generalised cross-correlation with PHAT weighting, further
   weighted per frequency by how far the current spectrum rises above the
   *background* spectrum measured just before the anomaly began. Frequencies
   where the unusual sound dominates drive the estimate; ship noise that was
   already there is down-weighted.
2. Score every candidate position on a grid over the patrol basin by how well
   its predicted delays match the measured ones (Gaussian timing error, capped
   so one bad pair can't veto a position).
3. Average the per-window position maps over the event. The estimate is the
   peak; the 95% area comes from the spread of the averaged map.
4. Sanity check ("array fix" vs "coarse fix"): the hydrophone nearest the
   array estimate must be the one where the new sound rose most above its
   background, and the fix must lie near the coarse fix below. If not
   (typically the fix locked onto a passing boat instead), the fix sits on an
   AIS-reported vessel, or the area is too large, fall back to a coarse position from the relative
   loudness rise across hydrophones, with a wide uncertainty.

Frequency selection: at onset, the bands whose level jumped most above the
pre-onset background (averaged over hydrophones) are taken as the new
sound's signature and used for the rest of the event, so boats arriving later
in other bands interfere less.

The inspection boat searches around the *best* fix: the one taken when the
new sound stood out most above its background (the source was loudest, the
evidence strongest). Later fixes can be pulled away by boats arriving after
the source falls quiet.

Uses only audio received up to the current time (causal).
"""
from __future__ import annotations

import numpy as np

from . import harbour as H
from .audio import SAMPLE_RATE
from .features import BAND_EDGES

LOC_WIN_S = 2.0
SIGMA_TAU = 0.0015   # s, assumed timing error per pair
GRID_STEP = 10.0
MIN_QUALITY = 3.0    # correlation peak / median |cc|; below this a pair is ignored
ONSET_S = 2.5        # seconds of event audio used to pick its frequency signature
COARSE_R95 = 200.0   # m, uncertainty of the coarse (loudness-based) fix
MAX_ARRAY_R95 = 150.0
ARRAY_FIX_ENABLED = False  # see README: precise fixes proved unreliable in traffic with this 4-hydrophone layout
AIS_REJECT_M = 80.0  # an array fix this close to an AIS vessel has probably locked onto that vessel


class Localizer:
    def __init__(self, hyd_xy: np.ndarray = H.HYD_XY, sr: int = SAMPLE_RATE):
        self.sr = sr
        self.hyd = hyd_xy
        self.grid = H.water_grid(GRID_STEP)
        self.pairs = [(i, j) for i in range(len(hyd_xy)) for j in range(i + 1, len(hyd_xy))]
        d = np.linalg.norm(self.grid[:, None, :] - hyd_xy[None, :, :], axis=2) / H.SOUND_SPEED  # (cells, hyd)
        self.pred = np.stack([d[:, i] - d[:, j] for i, j in self.pairs], axis=1)               # (cells, pairs)
        self.max_lag = [np.linalg.norm(hyd_xy[i] - hyd_xy[j]) / H.SOUND_SPEED + 0.01 for i, j in self.pairs]
        self.L = int(LOC_WIN_S * sr)
        self.nfft = 2 * self.L
        self.win = np.hanning(self.L)
        self.freqs = np.fft.rfftfreq(self.nfft, 1 / sr)
        self.in_band = (self.freqs >= BAND_EDGES[0]) & (self.freqs < BAND_EDGES[-1])
        self.band_of = np.clip(np.searchsorted(BAND_EDGES, self.freqs) - 1, 0, len(BAND_EDGES) - 2)

    def spectra(self, chunk: np.ndarray) -> np.ndarray:
        return np.fft.rfft(chunk * self.win, self.nfft, axis=1)

    def background(self, audio: np.ndarray, t_from: float, t_to: float) -> np.ndarray | None:
        """Mean power spectrum per channel over [t_from, t_to] (seconds)."""
        a, b = max(0, int(t_from * self.sr)), int(t_to * self.sr)
        if b - a < self.L:
            return None
        starts = range(a, b - self.L + 1, self.L // 2)
        return np.mean([np.abs(self.spectra(audio[:, s : s + self.L])) ** 2 for s in starts], axis=0)

    def band_excess_db(self, P: np.ndarray, bg: np.ndarray) -> np.ndarray:
        """Level rise over background per channel and band (dB), shape (ch, bands)."""
        nb = len(BAND_EDGES) - 1
        out = np.zeros((P.shape[0], nb))
        for k in range(nb):
            m = self.in_band & (self.band_of == k)
            out[:, k] = 10 * np.log10((P[:, m].sum(1) + 1e-20) / (bg[:, m].sum(1) + 1e-20))
        return out

    def tdoas(self, X: np.ndarray, W: np.ndarray) -> list[dict]:
        """Weighted GCC-PHAT delay per pair. ``W`` is a per-channel frequency weight (ch, F)."""
        out = []
        for k, (i, j) in enumerate(self.pairs):
            G = X[i] * np.conj(X[j])
            G = G / (np.abs(G) + 1e-20) * W[i] * W[j]
            cc = np.fft.irfft(G, self.nfft)
            m = int(self.max_lag[k] * self.sr)
            seg = np.concatenate([cc[-m:], cc[: m + 1]])  # lags -m..m
            p = int(np.argmax(seg))
            q = float(seg[p] / (np.median(np.abs(seg)) + 1e-12))
            if 0 < p < len(seg) - 1:  # sub-sample peak by parabolic interpolation
                y0, y1, y2 = seg[p - 1], seg[p], seg[p + 1]
                p = p + 0.5 * (y0 - y2) / ((y0 - 2 * y1 + y2) or 1e-12)
            out.append({"pair": (i, j), "tau": (p - m) / self.sr, "quality": q})
        return out

    def window_map(self, tds: list[dict]) -> np.ndarray | None:
        """Normalised probability over grid cells for one window, or None if too few good pairs."""
        good = [(k, d) for k, d in enumerate(tds) if d["quality"] >= MIN_QUALITY]
        if len(good) < 3:
            return None
        ll = np.zeros(len(self.grid))
        for k, d in good:
            ll -= np.minimum(((self.pred[:, k] - d["tau"]) / SIGMA_TAU) ** 2 / 2, 8.0)
        p = np.exp(ll - ll.max())
        return p / p.sum()

    def summarise(self, pmap: np.ndarray, n_windows: int) -> dict:
        k = int(np.argmax(pmap))
        mu = self.grid[k]
        d = self.grid - mu
        cov = (pmap[:, None, None] * d[:, :, None] * d[:, None, :]).sum(0) + np.eye(2) * (GRID_STEP**2 / 12)
        ev, evec = np.linalg.eigh(cov)
        s95 = np.sqrt(5.991 * np.maximum(ev, 1e-6))  # 95% ellipse semi-axes
        return {
            "x": round(float(mu[0]), 1), "y": round(float(mu[1]), 1),
            "major": round(float(s95[1]), 1), "minor": round(float(s95[0]), 1),
            "angle_deg": round(float(np.degrees(np.arctan2(evec[1, 1], evec[0, 1]))), 1),
            "r95": round(float(s95[1]), 1),
            "windows": n_windows,
        }


class EventTrack:
    """Accumulates position evidence for one detected event (causal)."""

    def __init__(self, loc: Localizer, keep: int = 12):
        self.loc = loc
        self.maps: list[np.ndarray] = []
        self.keep = keep  # recent windows only: the source moves
        self.bg = None
        self.sel = None          # selected frequency bands (signature)
        self.rise = None         # smoothed per-channel level rise in signature bands (dB)
        self.n_total = 0
        self.ais_xy = None
        self.best: dict | None = None   # fix taken when the new sound stood out most (most reliable)
        self.best_rise = -np.inf

    def update(self, audio: np.ndarray, t_end: float, onset: float, ais_xy: np.ndarray | None = None) -> dict | None:
        self.ais_xy = ais_xy
        L = self.loc.L
        if self.bg is None:
            self.bg = self.loc.background(audio, onset - 22.0, onset - 1.0)
            if self.bg is None:  # event near recording start: use whatever came before
                self.bg = self.loc.background(audio, 0.0, max(onset, LOC_WIN_S))
        b = int(t_end * self.loc.sr)
        if b < L or t_end < onset + ONSET_S:
            return self.estimate()
        X = self.loc.spectra(audio[:, b - L : b])
        P = np.abs(X) ** 2 + 1e-20
        ex = self.loc.band_excess_db(P, self.bg)
        if self.sel is None:
            mean_ex = ex.mean(0)
            self.sel = mean_ex >= max(mean_ex.max() - 6.0, 3.0)
            if not self.sel.any():
                self.sel = mean_ex >= mean_ex.max()
        rise = np.array([ex[c, self.sel].max() for c in range(ex.shape[0])])
        self.rise = rise if self.rise is None else 0.7 * self.rise + 0.3 * rise
        W = (self.loc.in_band & self.sel[self.loc.band_of])[None, :] * np.clip((P - self.bg) / P, 0, 1)
        pm = self.loc.window_map(self.loc.tdoas(X, W))
        if pm is not None:
            self.maps.append(pm)
            self.maps = self.maps[-self.keep :]
            self.n_total += 1
        est = self.estimate()
        if est is not None and rise.max() > self.best_rise:
            self.best_rise = float(rise.max())
            self.best = {"x": est["x"], "y": est["y"], "r95": est["r95"], "t": round(t_end, 1)}
        if est is not None and self.best is not None:
            est["best"] = self.best
        return est

    def coarse(self) -> dict:
        w = 10 ** (self.rise / 10)
        w = w / w.sum()
        top = np.argsort(self.rise)[::-1][:2]
        xy = (self.loc.hyd[top] * w[top, None]).sum(0) / w[top].sum()
        return {"x": round(float(xy[0]), 1), "y": round(float(xy[1]), 1), "major": COARSE_R95, "minor": COARSE_R95,
                "angle_deg": 0.0, "r95": COARSE_R95, "windows": self.n_total, "mode": "coarse",
                "nearest_hydrophone": H.HYDROPHONES[int(top[0])]["id"]}

    def estimate(self) -> dict | None:
        if self.rise is None:
            return None
        loudest = int(np.argmax(self.rise))
        if len(self.maps) >= 2:
            est = self.loc.summarise(np.mean(self.maps, axis=0), self.n_total)
            nearest = int(np.argmin(np.hypot(*(self.loc.hyd - [est["x"], est["y"]]).T)))
            coarse = self.coarse()
            agrees = np.hypot(est["x"] - coarse["x"], est["y"] - coarse["y"]) <= 0.6 * COARSE_R95
            peaks = self.loc.grid[[int(np.argmax(m)) for m in self.maps]]
            stable = np.mean(np.hypot(*(peaks - [est["x"], est["y"]]).T) <= max(est["r95"], 30.0)) >= 0.7
            on_ais = self.ais_xy is not None and len(self.ais_xy) and np.min(np.hypot(*(self.ais_xy - [est["x"], est["y"]]).T)) < AIS_REJECT_M
            if ARRAY_FIX_ENABLED and nearest == loudest and agrees and stable and not on_ais and len(self.maps) >= 4 and est["r95"] <= MAX_ARRAY_R95:
                return est | {"mode": "array", "nearest_hydrophone": H.HYDROPHONES[nearest]["id"]}
            return coarse
        return self.coarse()
