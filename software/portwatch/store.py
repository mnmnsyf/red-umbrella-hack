"""Recording library: which files exist, their session, role and data source.

Roles keep data honest:
- train:        normal-only recordings used to learn the baseline
- calibration:  separate normal-only sessions used ONLY to set thresholds
- test:         held-out recordings for live replay and evaluation; may carry
                ground-truth labels of unusual events (used only for scoring)

A session (e.g. one deployment day) may contain several files but always
belongs to exactly one role, so no session leaks across the split.
"""
from __future__ import annotations

import json
import re
import threading
import uuid
from pathlib import Path

from .audio import SAMPLE_RATE, load_audio, save_wav

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SAMPLE_DIR = DATA / "sample"
UPLOAD_DIR = DATA / "uploads"
LIBRARY = DATA / "library.json"
MODEL_PATH = ROOT / "models" / "current.pkl"
REPORT_DIR = ROOT / "reports"
ROLES = ("train", "calibration", "test")
SIM_VERSION = 4  # bump when the simulator changes: sample data is regenerated

_lock = threading.Lock()


def _read() -> list[dict]:
    if not LIBRARY.exists():
        return []
    return json.loads(LIBRARY.read_text())


def _write(entries: list[dict]) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    LIBRARY.write_text(json.dumps(entries, indent=2))


def abs_path(entry: dict) -> str:
    p = Path(entry["path"])
    return str(p if p.is_absolute() else ROOT / p)


def entries(role: str | None = None) -> list[dict]:
    out = []
    for e in _read():
        e = dict(e, path=abs_path(e))
        if e.get("scene"):
            e["scene"] = str(ROOT / e["scene"]) if not Path(e["scene"]).is_absolute() else e["scene"]
        if role is None or e["role"] == role:
            out.append(e)
    return out


def get(entry_id: str) -> dict | None:
    return next((e for e in entries() if e["id"] == entry_id), None)


def check_sessions(all_entries: list[dict]) -> list[str]:
    """Return error messages if any session spans more than one role."""
    roles: dict[str, set[str]] = {}
    for e in all_entries:
        roles.setdefault(e["session"], set()).add(e["role"])
    return [f"Session '{s}' is used in several roles: {sorted(r)}" for s, r in roles.items() if len(r) > 1]


def ensure_sample_data() -> None:
    """Generate the SIMULATED sample dataset on first run."""
    with _lock:
        existing = _read()
        sims = [e for e in existing if e["source"] == "simulated"]
        current = sims and all(e.get("sim_version") == SIM_VERSION for e in sims)
        if current and all(Path(abs_path(e)).exists() for e in existing):
            return
        from .simulate import generate

        print("Generating simulated sample recordings (first run only)...", flush=True)
        for old in SAMPLE_DIR.glob("*") if SAMPLE_DIR.exists() else []:
            old.unlink()
        sims = generate(SAMPLE_DIR)
        for s in sims:
            s["path"] = str(Path(s["path"]).resolve().relative_to(ROOT))
            s["scene"] = str(Path(s["scene"]).resolve().relative_to(ROOT))
            s["sim_version"] = SIM_VERSION
        keep = [e for e in existing if e["source"] != "simulated" and Path(abs_path(e)).exists()]
        _write(sims + keep)


def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s).strip("_")[:80] or "recording"


def add_upload(data: bytes, filename: str, session: str, role: str, labels: list[dict] | None) -> dict:
    if role not in ROLES:
        raise ValueError(f"role must be one of {ROLES}")
    x = load_audio(data)  # validates + converts to mono 16 kHz
    if len(x) < SAMPLE_RATE * 2:
        raise ValueError("Recording is shorter than 2 seconds.")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    eid = f"rec-{uuid.uuid4().hex[:8]}"
    path = UPLOAD_DIR / f"{eid}-{_safe(Path(filename).stem)}.wav"
    save_wav(path, x)
    entry = {
        "id": eid,
        "name": filename,
        "session": _safe(session) if session else eid,
        "role": role,
        "source": "real",
        "duration": round(len(x) / SAMPLE_RATE, 2),
        "labels": labels if role == "test" else None,
        "path": str(path.relative_to(ROOT)),
    }
    with _lock:
        all_e = _read()
        errs = check_sessions(all_e + [entry])
        if errs:
            path.unlink(missing_ok=True)
            raise ValueError("; ".join(errs))
        all_e.append(entry)
        _write(all_e)
    return dict(entry, path=abs_path(entry))


def update(entry_id: str, **fields) -> dict:
    with _lock:
        all_e = _read()
        for e in all_e:
            if e["id"] == entry_id:
                e.update({k: v for k, v in fields.items() if v is not None})
                if e["role"] != "test":
                    e["labels"] = None
        errs = check_sessions(all_e)
        if errs:
            raise ValueError("; ".join(errs))
        _write(all_e)
    return get(entry_id)


def remove(entry_id: str) -> None:
    with _lock:
        all_e = _read()
        keep = [e for e in all_e if e["id"] != entry_id]
        for e in all_e:
            if e["id"] == entry_id and e["source"] == "real":
                Path(abs_path(e)).unlink(missing_ok=True)
        _write(keep)


def parse_labels(text: str | None) -> list[dict] | None:
    """Labels as JSON [{"start":s,"end":s,"label":..}] or CSV lines 'start,end[,label]'."""
    if not text or not text.strip():
        return None
    text = text.strip()
    if text.startswith("["):
        raw = json.loads(text)
        return [{"start": float(r["start"]), "end": float(r["end"]), "label": str(r.get("label", "labelled event"))} for r in raw]
    out = []
    for line in text.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 2 or not parts[0] or parts[0].lower() == "start":
            continue
        out.append({"start": float(parts[0]), "end": float(parts[1]), "label": parts[2] if len(parts) > 2 else "labelled event"})
    return out


def mono_path(entry: dict) -> str:
    """Playable mono mix of a recording (multi-channel files are mixed down and cached)."""
    if entry.get("channels", 1) <= 1:
        return entry["path"]
    out = DATA / "cache" / f"mono-{entry['id']}.wav"
    if not out.exists() or out.stat().st_mtime < Path(entry["path"]).stat().st_mtime:
        out.parent.mkdir(parents=True, exist_ok=True)
        x = load_audio(entry["path"])
        save_wav(out, x / (abs(x).max() + 1e-9) * 0.9)
    return str(out)
