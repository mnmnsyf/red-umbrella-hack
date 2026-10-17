"""Normal-activity model and threshold calibration (shared by both methods).

Detector = StandardScaler -> PCA (whitened, 99% variance) -> Gaussian
mixture, components picked by BIC. The anomaly score is the negative
log-likelihood under the "normal port" model, expressed as a robust z-score
against held-out *calibration* sessions. A score of 0 is typical; larger
means more unusual.

Sensitivity -> threshold: sensitivity picks the fraction of calibration
windows we accept as over-threshold (0.1% at sensitivity 0, 10% at 100), and
the threshold is that quantile of the calibration scores. The persistence
rule in ``alerting`` then cuts single-window blips.
"""
from __future__ import annotations

import pickle
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from sklearn.decomposition import PCA
from sklearn.mixture import GaussianMixture
from sklearn.preprocessing import StandardScaler

from .features import FEATURE_VERSION, N_BANDS


def fuse(z_channels: np.ndarray) -> np.ndarray:
    """Array score: mean of the two highest per-hydrophone scores (axis 0 = channel).

    Requiring a second hydrophone to agree suppresses single-sensor noise
    (a clank right next to one hydrophone) at some cost in range."""
    z = np.atleast_2d(z_channels)
    if z.shape[0] == 1:
        return z[0]
    top = np.sort(z, axis=0)[-2:]
    return top.mean(axis=0)


def sensitivity_to_exceed_rate(sensitivity: float) -> float:
    s = float(np.clip(sensitivity, 0, 100)) / 100.0
    return 10 ** (np.log10(0.001) + s * (np.log10(0.10) - np.log10(0.001)))


@dataclass
class Detector:
    method: str
    scaler: StandardScaler | None = None
    pca: PCA | None = None
    gmm: GaussianMixture | None = None
    cal_median: float = 0.0
    cal_scale: float = 1.0
    cal_z_sorted: np.ndarray | None = None
    cal_fused_sorted: np.ndarray | None = None  # calibration distribution of the fused array score
    n_train: int = 0
    n_cal: int = 0

    def fit(self, X: np.ndarray, seed: int = 0) -> "Detector":
        self.scaler = StandardScaler().fit(X)
        Xs = self.scaler.transform(X)
        self.pca = PCA(n_components=0.99, whiten=True, random_state=seed).fit(Xs)
        Z = self.pca.transform(Xs)
        best, best_bic = None, np.inf
        for k in (1, 2, 3, 4, 6, 8):
            if k * 10 > len(Z):
                break
            g = GaussianMixture(k, covariance_type="full", reg_covar=1e-2, random_state=seed, n_init=2).fit(Z)
            bic = g.bic(Z)
            if bic < best_bic:
                best, best_bic = g, bic
        self.gmm = best
        self.n_train = len(X)
        return self

    def raw_score(self, X: np.ndarray) -> np.ndarray:
        X = np.atleast_2d(X)
        return -self.gmm.score_samples(self.pca.transform(self.scaler.transform(X)))

    def calibrate(self, X_cal: np.ndarray) -> "Detector":
        s = self.raw_score(X_cal)
        self.cal_median = float(np.median(s))
        mad = float(np.median(np.abs(s - self.cal_median)))
        self.cal_scale = 1.4826 * mad + 1e-9
        self.cal_z_sorted = np.sort((s - self.cal_median) / self.cal_scale)
        self.n_cal = len(X_cal)
        return self

    def score(self, X: np.ndarray) -> np.ndarray:
        return (self.raw_score(X) - self.cal_median) / self.cal_scale

    def calibrate_fused(self, X_cal_channels: list[np.ndarray]) -> "Detector":
        """X_cal_channels: per multi-channel calibration session, array (channels, windows, features)."""
        fused = [fuse(np.stack([self.score(ch) for ch in Xs])) for Xs in X_cal_channels]
        if fused:
            self.cal_fused_sorted = np.sort(np.concatenate(fused))
        return self

    def threshold(self, sensitivity: float, fused: bool = False) -> float:
        dist = self.cal_fused_sorted if fused and self.cal_fused_sorted is not None else self.cal_z_sorted
        return float(np.quantile(dist, 1 - sensitivity_to_exceed_rate(sensitivity)))


@dataclass
class ModelBundle:
    detectors: dict[str, Detector]
    band_mu: np.ndarray            # training mean of spectrogram band levels (dB)
    band_sd: np.ndarray
    train_sessions: list[str]
    calibration_sessions: list[str]
    sources: dict[str, str]        # session -> simulated|real
    fit_seconds: dict[str, float] = field(default_factory=dict)
    created: float = field(default_factory=time.time)
    feature_version: int = FEATURE_VERSION

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            pickle.dump(self, f)

    @staticmethod
    def load(path: Path) -> "ModelBundle | None":
        if not path.exists():
            return None
        # Only ever loads the bundle this app wrote to its own models/ folder;
        # never point this at model files from an untrusted source.
        with open(path, "rb") as f:
            bundle = pickle.load(f)
        if getattr(bundle, "feature_version", None) != FEATURE_VERSION:
            return None  # trained on an older feature definition: must retrain
        return bundle

    def summary(self) -> dict:
        return {
            "train_sessions": self.train_sessions,
            "calibration_sessions": self.calibration_sessions,
            "data_source": sorted(set(self.sources.values())),
            "methods": {
                m: {
                    "train_windows": d.n_train,
                    "calibration_windows": d.n_cal,
                    "array_calibrated": d.cal_fused_sorted is not None,
                    "pca_dims": int(d.pca.n_components_),
                    "gmm_components": int(d.gmm.n_components),
                    "fit_seconds": round(self.fit_seconds.get(m, 0.0), 2),
                }
                for m, d in self.detectors.items()
            },
            "created": self.created,
        }


def describe_band(spec_feat: np.ndarray, bundle: ModelBundle) -> dict:
    """Which frequency band deviates most from normal (descriptive aid for the officer)."""
    from .features import BAND_EDGES

    z = (spec_feat[:N_BANDS] - bundle.band_mu) / (bundle.band_sd + 1e-6)
    k = int(np.argmax(z))
    return {"lo": round(float(BAND_EDGES[k])), "hi": round(float(BAND_EDGES[k + 1])), "excess_sd": round(float(z[k]), 1)}
