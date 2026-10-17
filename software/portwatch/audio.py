"""Audio loading, resampling and windowing.

Everything downstream works on mono float32 audio at ``SAMPLE_RATE`` cut into
overlapping analysis windows. Windows are produced causally: a window is only
analysed once all of its samples have "arrived".
"""
from __future__ import annotations

import io
import wave
from dataclasses import dataclass
from math import gcd
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

SAMPLE_RATE = 16_000  # Hz, all audio is converted to this rate
WINDOW_S = 1.0        # analysis window length (seconds)
HOP_S = 0.5           # step between windows (seconds) -> one score every 0.5 s


@dataclass(frozen=True)
class WindowSpec:
    sr: int = SAMPLE_RATE
    window_s: float = WINDOW_S
    hop_s: float = HOP_S

    @property
    def win(self) -> int:
        return int(round(self.window_s * self.sr))

    @property
    def hop(self) -> int:
        return int(round(self.hop_s * self.sr))

    def n_windows(self, n_samples: int) -> int:
        if n_samples < self.win:
            return 0
        return 1 + (n_samples - self.win) // self.hop

    def window(self, x: np.ndarray, i: int) -> np.ndarray:
        s = i * self.hop
        return x[s : s + self.win]

    def end_time(self, i: int) -> float:
        """Time (s) at which window ``i`` is complete, i.e. when it can be scored live."""
        return (i * self.hop + self.win) / self.sr


def _to_float(data: np.ndarray, mono: bool = True) -> np.ndarray:
    if data.dtype == np.int16:
        x = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32:
        x = data.astype(np.float32) / 2147483648.0
    elif data.dtype == np.uint8:
        x = (data.astype(np.float32) - 128.0) / 128.0
    else:
        x = data.astype(np.float32)
    if x.ndim == 2:
        x = x.mean(axis=1) if mono else x.T  # (channels, samples)
    elif not mono:
        x = x[None, :]
    return x


def load_channels(src: str | Path | bytes, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Load a WAV file keeping channels: float32 array (channels, samples) at ``sr``."""
    fh = io.BytesIO(src) if isinstance(src, (bytes, bytearray)) else src
    file_sr, data = wavfile.read(fh)
    x = _to_float(np.asarray(data), mono=False)
    if file_sr != sr:
        g = gcd(int(file_sr), sr)
        x = resample_poly(x, sr // g, int(file_sr) // g, axis=1).astype(np.float32)
    return np.ascontiguousarray(np.nan_to_num(x))


def load_audio(src: str | Path | bytes, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Load a WAV file (path or raw bytes) as mono float32 at ``sr``."""
    return load_channels(src, sr).mean(axis=0).astype(np.float32)


def save_wav(path: str | Path, x: np.ndarray, sr: int = SAMPLE_RATE) -> None:
    """Write mono (n,) or multichannel (channels, n) float audio as 16-bit WAV."""
    x = np.atleast_2d(x)
    pcm = (np.clip(x, -1.0, 1.0) * 32767.0).astype(np.int16).T.copy()
    with wave.open(str(path), "wb") as w:
        w.setnchannels(x.shape[0])
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def wav_bytes(x: np.ndarray, sr: int = SAMPLE_RATE) -> bytes:
    buf = io.BytesIO()
    pcm = (np.clip(x, -1.0, 1.0) * 32767.0).astype(np.int16)
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()
