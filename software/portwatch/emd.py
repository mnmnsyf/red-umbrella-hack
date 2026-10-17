"""Empirical Mode Decomposition (EMD), implemented from scratch.

EMD splits a signal into Intrinsic Mode Functions (IMFs): oscillatory
components whose frequency and amplitude may drift over time. IMF 1 holds the
fastest oscillations, each later IMF slower ones, and a residual trend is left
at the end. Unlike a fixed Fourier basis, the components adapt to the data,
which is the property Phinorm-style methods try to exploit for non-stationary
sounds.

Implementation notes
- Classic sifting (Huang et al., 1998): repeatedly subtract the mean of the
  upper/lower cubic-spline envelopes through local maxima/minima.
- Stopping rule: fixed "S-number" style cap of ``max_sifts`` iterations plus
  a Cauchy-type SD criterion; this keeps cost bounded for real-time use.
- Envelopes are mirrored at the edges to reduce end effects.
"""
from __future__ import annotations

import numpy as np
from scipy.interpolate import CubicSpline


def _extrema(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    d = np.diff(x)
    # sign changes of the derivative; treat flat runs as non-extrema
    maxima = np.flatnonzero((d[:-1] > 0) & (d[1:] <= 0)) + 1
    minima = np.flatnonzero((d[:-1] < 0) & (d[1:] >= 0)) + 1
    return maxima, minima


def _mirror(idx: np.ndarray, vals: np.ndarray, n: int, n_mirror: int = 2):
    """Reflect the first/last few extrema about the signal ends."""
    left_i = -idx[:n_mirror][::-1]
    right_i = 2 * (n - 1) - idx[-n_mirror:][::-1]
    left_v = vals[:n_mirror][::-1]
    right_v = vals[-n_mirror:][::-1]
    return (
        np.concatenate([left_i, idx, right_i]),
        np.concatenate([left_v, vals, right_v]),
    )


def _envelope_mean(x: np.ndarray, t: np.ndarray) -> np.ndarray | None:
    maxima, minima = _extrema(x)
    if len(maxima) < 2 or len(minima) < 2:
        return None
    n = len(x)
    ui, uv = _mirror(maxima, x[maxima], n)
    li, lv = _mirror(minima, x[minima], n)
    upper = CubicSpline(ui, uv, bc_type="not-a-knot")(t)
    lower = CubicSpline(li, lv, bc_type="not-a-knot")(t)
    return 0.5 * (upper + lower)


def emd(x: np.ndarray, max_imfs: int = 6, max_sifts: int = 8, sd_tol: float = 0.2) -> np.ndarray:
    """Decompose ``x`` into IMFs.

    Returns an array of shape (k, len(x)) where rows 0..k-2 are IMFs (fast to
    slow) and the last row is the residual. ``k <= max_imfs + 1``.
    """
    x = np.asarray(x, dtype=np.float64)
    t = np.arange(len(x), dtype=np.float64)
    residual = x.copy()
    imfs: list[np.ndarray] = []
    scale = np.std(x) + 1e-12

    for _ in range(max_imfs):
        h = residual.copy()
        produced = False
        for _ in range(max_sifts):
            m = _envelope_mean(h, t)
            if m is None:
                break
            h_new = h - m
            sd = np.sum((h - h_new) ** 2) / (np.sum(h**2) + 1e-12)
            h = h_new
            produced = True
            if sd < sd_tol:
                break
        if not produced:
            break  # residual is monotonic / too few extrema: decomposition complete
        imfs.append(h)
        residual = residual - h
        if np.std(residual) < 1e-3 * scale:
            break

    imfs.append(residual)
    return np.vstack(imfs)
