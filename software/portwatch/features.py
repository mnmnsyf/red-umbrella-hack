"""Feature extraction for the two compared methods.

Both extractors map one analysis window (1 s of audio) to a fixed-length
vector. They feed the *same* detector, threshold calibration and alert logic,
so any difference in results comes from the representation alone.

A. Spectrogram (conventional)
   STFT -> power in 24 log-spaced bands (20 Hz-7.6 kHz). Per band: mean level
   (dB), frame-to-frame variability, and tonality (peak-to-mean bin ratio,
   the narrowband-line cue used in LOFAR-style analysis). Plus spectral
   flatness and centroid.

B. EMD (Phinorm-inspired; not the proprietary algorithm)
   EMD -> up to 7 IMFs + residual -> Hilbert transform of each IMF.
   Hilbert-Huang marginal spectrum: IMF energy binned by *instantaneous*
   frequency into the same 24 bands (the EMD analogue of a spectrum). Per
   IMF: log energy, amplitude-weighted mean instantaneous frequency,
   instantaneous-frequency spread, envelope modulation depth. Plus residual
   energy.
"""
from __future__ import annotations

import numpy as np
from scipy.signal import hilbert, stft

from .audio import SAMPLE_RATE
from .emd import emd

EPS = 1e-12
# bump whenever a feature definition changes: invalidates cached features and saved models
FEATURE_VERSION = 5

# ------------------------------------------------------------------ spectrogram
N_FFT = 1024
N_BANDS = 24
F_LO, F_HI = 20.0, 7600.0
_FREQS = np.fft.rfftfreq(N_FFT, 1 / SAMPLE_RATE)
BAND_EDGES = np.geomspace(F_LO, F_HI, N_BANDS + 1)
_BAND_IDX = [np.flatnonzero((_FREQS >= lo) & (_FREQS < hi)) for lo, hi in zip(BAND_EDGES[:-1], BAND_EDGES[1:])]
# guarantee at least one FFT bin per band (low bands are narrower than a bin)
_BAND_IDX = [idx if len(idx) else np.array([np.argmin(np.abs(_FREQS - np.sqrt(lo * hi)))])
             for idx, lo, hi in zip(_BAND_IDX, BAND_EDGES[:-1], BAND_EDGES[1:])]
BAND_CENTERS = np.sqrt(BAND_EDGES[:-1] * BAND_EDGES[1:])


def power_spectrogram(x: np.ndarray) -> np.ndarray:
    """|STFT|^2, shape (n_freq, n_frames)."""
    _, _, Z = stft(x, fs=SAMPLE_RATE, nperseg=N_FFT, noverlap=N_FFT // 2, boundary=None, padded=False)
    return np.abs(Z) ** 2


def band_levels_db(P: np.ndarray) -> np.ndarray:
    """Band levels in dB, shape (N_BANDS, n_frames)."""
    return np.stack([10 * np.log10(P[idx].mean(axis=0) + EPS) for idx in _BAND_IDX])


def spectrogram_features(x: np.ndarray) -> np.ndarray:
    P = power_spectrogram(x)
    B = band_levels_db(P)
    mean_db = B.mean(axis=1)
    var_db = B.std(axis=1)
    Pm = P.mean(axis=1)  # time-averaged spectrum: stable tonal lines stand out
    tonal = np.array([10 * np.log10((Pm[idx].max() + EPS) / (Pm[idx].mean() + EPS)) if len(idx) > 1
                      else 10 * np.log10((Pm[idx[0]] + EPS) / (Pm[max(idx[0] - 2, 0): idx[0] + 3].mean() + EPS))
                      for idx in _BAND_IDX])
    p = P[1:] + EPS
    flatness = np.mean(np.exp(np.mean(np.log(p), axis=0)) / np.mean(p, axis=0))
    centroid = np.mean((_FREQS[1:, None] * p).sum(0) / p.sum(0))
    return np.concatenate([mean_db, var_db, tonal, [10 * np.log10(flatness + EPS), np.log10(centroid + EPS)]]).astype(np.float32)


SPEC_FEATURE_NAMES = (
    [f"band{int(c)}Hz_mean_db" for c in BAND_CENTERS]
    + [f"band{int(c)}Hz_var_db" for c in BAND_CENTERS]
    + [f"band{int(c)}Hz_tonality_db" for c in BAND_CENTERS]
    + ["flatness_db", "log_centroid"]
)

# ------------------------------------------------------------------------- EMD
MAX_IMFS = 7


def emd_features(x: np.ndarray) -> np.ndarray:
    imfs = emd(x, max_imfs=MAX_IMFS)
    comps, residual = imfs[:-1], imfs[-1]
    trim = len(x) // 20  # discard Hilbert/spline edge effects
    feats = np.zeros((MAX_IMFS, 4), dtype=np.float64)
    feats[:, 0] = -120.0  # "absent IMF" energy floor
    marginal = np.zeros(N_BANDS)
    for k, c in enumerate(comps[:MAX_IMFS]):
        a = hilbert(c)
        amp = np.abs(a)[trim:-trim]
        phase = np.unwrap(np.angle(a))
        inst_f = np.diff(phase)[trim : -trim + 1] * SAMPLE_RATE / (2 * np.pi)
        inst_f = np.clip(inst_f, 1.0, SAMPLE_RATE / 2)
        w = amp**2 + EPS
        band = np.clip(np.searchsorted(BAND_EDGES, inst_f) - 1, 0, N_BANDS - 1)
        marginal += np.bincount(band, weights=w, minlength=N_BANDS) / len(w)
        mean_f = np.sum(w * inst_f) / w.sum()
        spread = np.sqrt(np.sum(w * (inst_f - mean_f) ** 2) / w.sum()) / mean_f
        feats[k] = [
            10 * np.log10(np.mean(c[trim:-trim] ** 2) + EPS),
            np.log10(mean_f),
            np.log1p(spread),
            np.std(amp) / (np.mean(amp) + EPS),  # envelope modulation depth
        ]
    res_db = 10 * np.log10(np.mean(residual**2) + EPS)
    return np.concatenate([10 * np.log10(marginal + EPS), feats.ravel(), [res_db]]).astype(np.float32)


EMD_FEATURE_NAMES = [f"hht_band{int(c)}Hz_db" for c in BAND_CENTERS] + [
    f"imf{k + 1}_{n}" for k in range(MAX_IMFS) for n in ("energy_db", "log_mean_if", "if_spread", "env_mod")
] + ["residual_db"]

EXTRACTORS = {"spectrogram": spectrogram_features, "emd": emd_features}
METHOD_LABELS = {"spectrogram": "Spectrogram", "emd": "EMD"}

# ------------------------------------------------------------- display helpers
N_DISPLAY_BINS = 96
_DISP_EDGES = np.geomspace(20, 8000, N_DISPLAY_BINS + 1)
_DISP_IDX = [np.flatnonzero((_FREQS >= lo) & (_FREQS < hi)) for lo, hi in zip(_DISP_EDGES[:-1], _DISP_EDGES[1:])]
_DISP_IDX = [idx if len(idx) else np.array([np.argmin(np.abs(_FREQS - np.sqrt(lo * hi)))])
             for idx, lo, hi in zip(_DISP_IDX, _DISP_EDGES[:-1], _DISP_EDGES[1:])]


def display_columns(x_hop: np.ndarray) -> list[list[float]]:
    """Log-frequency spectrogram columns (dB) for the waterfall display."""
    P = power_spectrogram(x_hop)
    cols = np.stack([10 * np.log10(P[idx].mean(axis=0) + EPS) for idx in _DISP_IDX])  # (bins, frames)
    return np.round(cols.T, 1).tolist()


DISPLAY_FREQ_EDGES = _DISP_EDGES.tolist()
