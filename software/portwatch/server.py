"""FastAPI backend for the officer dashboard and analyst workspace.

Run:  uv run uvicorn portwatch.server:app --port 8000
"""
from __future__ import annotations

import json
import threading
import time
import traceback
import uuid
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import store
from . import harbour
from .audio import SAMPLE_RATE, load_channels, wav_bytes
from .dispatch import DispatchPolicy, SceneTruth
from .evaluate import evaluate, to_markdown
from .features import DISPLAY_FREQ_EDGES
from .model import ModelBundle
from .pipeline import METHODS, SPEC, StreamProcessor, train_bundle
from . import viz_scenario

WEB = store.ROOT / "web"
VIZ = WEB / "viz"  # built 3D visualisation (start.sh builds it from ../viz when Node is available)
app = FastAPI(title="Port acoustic watch")

_state: dict = {"bundle": None}
_jobs: dict[str, dict] = {}
_streams: dict[str, dict] = {}
_lock = threading.Lock()


# --------------------------------------------------------------------------- jobs
def _run_job(kind: str, fn) -> str:
    jid = uuid.uuid4().hex[:8]
    job = {"id": jid, "kind": kind, "status": "running", "progress": None, "message": "", "started": time.time()}
    _jobs[jid] = job

    def progress(done, total):
        job["progress"] = round(done / max(total, 1), 2)
        job["message"] = f"Analysing recordings {done}/{total}"

    def target():
        try:
            job["result"] = fn(progress)
            job["status"] = "done"
        except Exception as e:  # surfaced to the UI
            traceback.print_exc()
            job["status"] = "error"
            job["message"] = str(e)
        job["finished"] = time.time()

    threading.Thread(target=target, daemon=True).start()
    return jid


def _active_job(kind: str) -> dict | None:
    return next((j for j in _jobs.values() if j["kind"] == kind and j["status"] == "running"), None)


def _train(progress) -> dict:
    all_e = store.entries()
    errs = store.check_sessions(all_e)
    if errs:
        raise ValueError("; ".join(errs))
    train, cal = store.entries("train"), store.entries("calibration")
    if not cal:
        raise ValueError("Assign at least one normal-activity session to 'calibration'. Thresholds are set on sessions the model never trained on.")
    bundle = train_bundle(train, cal, progress)
    bundle.save(store.MODEL_PATH)
    _state["bundle"] = bundle
    return bundle.summary()


def _evaluate(sensitivity: float, persistence: float):
    def fn(progress):
        bundle = _bundle()
        rep = evaluate(bundle, store.entries("test"), sensitivity, persistence, progress)
        store.REPORT_DIR.mkdir(parents=True, exist_ok=True)
        (store.REPORT_DIR / "latest.json").write_text(json.dumps(rep, indent=2, default=float))
        (store.REPORT_DIR / "latest.md").write_text(to_markdown(rep))
        return {"ok": True}

    return fn


def _bundle() -> ModelBundle:
    if _state["bundle"] is None:
        _state["bundle"] = ModelBundle.load(store.MODEL_PATH)
    if _state["bundle"] is None:
        raise HTTPException(409, "No trained model yet. Train the baseline in the Analyst view first.")
    return _state["bundle"]


@app.on_event("startup")
def _startup() -> None:
    store.ensure_sample_data()
    _state["bundle"] = ModelBundle.load(store.MODEL_PATH)
    if _state["bundle"] is None:
        _run_job("train", _train)


# ------------------------------------------------------------------------ status
def _public(e: dict) -> dict:
    return {k: v for k, v in e.items() if k not in ("path", "scene")}


@app.get("/api/harbour")
def harbour_layout():
    return harbour.layout()


INSPECTIONS = store.DATA / "inspections.json"


@app.get("/api/inspections")
def inspections():
    return json.loads(INSPECTIONS.read_text()) if INSPECTIONS.exists() else []


@app.get("/api/status")
def status():
    b = _state["bundle"]
    return {
        "model": b.summary() if b else None,
        "training": _active_job("train") is not None,
        "evaluating": _active_job("evaluate") is not None,
        "jobs": [{k: v for k, v in j.items() if k != "result"} for j in _jobs.values()][-5:],
        "methods": list(METHODS),
        "report_available": (store.REPORT_DIR / "latest.json").exists(),
        "session_errors": store.check_sessions(store.entries()),
        "viz_available": (VIZ / "index.html").exists(),
        "window_s": SPEC.window_s,
        "hop_s": SPEC.hop_s,
    }


@app.get("/api/library")
def library():
    return [_public(e) for e in store.entries()]


@app.post("/api/library/upload")
async def upload(file: UploadFile = File(...), session: str = Form(""), role: str = Form("train"), labels: str = Form("")):
    data = await file.read()
    try:
        entry = store.add_upload(data, file.filename or "recording.wav", session, role, store.parse_labels(labels))
    except Exception as e:
        raise HTTPException(400, f"Could not add {file.filename}: {e}")
    return _public(entry)


class EntryPatch(BaseModel):
    role: str | None = None
    session: str | None = None
    labels: str | None = None


@app.patch("/api/library/{entry_id}")
def patch_entry(entry_id: str, body: EntryPatch):
    if body.role and body.role not in store.ROLES:
        raise HTTPException(400, f"role must be one of {store.ROLES}")
    try:
        labels = store.parse_labels(body.labels) if body.labels is not None else None
        e = store.update(entry_id, role=body.role, session=body.session, labels=labels)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    return _public(e)


@app.delete("/api/library/{entry_id}")
def delete_entry(entry_id: str):
    store.remove(entry_id)
    return {"ok": True}


@app.get("/api/audio/{entry_id}")
def audio(entry_id: str):
    e = store.get(entry_id)
    if not e:
        raise HTTPException(404, "Unknown recording")
    return FileResponse(store.mono_path(e), media_type="audio/wav")


# ------------------------------------------------------------------ train / eval
@app.post("/api/train")
def train():
    j = _active_job("train")
    return {"job": j["id"] if j else _run_job("train", _train)}


class EvalBody(BaseModel):
    sensitivity: float = 50
    persistence: float = 4.0


@app.post("/api/evaluate")
def run_eval(body: EvalBody):
    _bundle()
    j = _active_job("evaluate")
    return {"job": j["id"] if j else _run_job("evaluate", _evaluate(body.sensitivity, body.persistence))}


@app.get("/api/jobs/{jid}")
def job(jid: str):
    j = _jobs.get(jid)
    if not j:
        raise HTTPException(404, "Unknown job")
    return {k: v for k, v in j.items() if k != "result"}


@app.get("/api/report")
def report():
    p = store.REPORT_DIR / "latest.json"
    if not p.exists():
        raise HTTPException(404, "No evaluation has been run yet.")
    return JSONResponse(json.loads(p.read_text()))


# ------------------------------------------------------------------- live replay
class StartBody(BaseModel):
    recording_id: str
    sensitivity: float = 50
    persistence: float = 4.0
    method: str = "spectrogram"
    auto_dispatch: bool = True
    cancel_s: float = 15.0


@app.post("/api/stream/start")
def stream_start(body: StartBody):
    bundle = _bundle()
    e = store.get(body.recording_id)
    if not e:
        raise HTTPException(404, "Unknown recording")
    if e["session"] in set(bundle.train_sessions) | set(bundle.calibration_sessions):
        note = "This recording was used to build the model, so scores on it are optimistic."
    else:
        note = None
    x = load_channels(e["path"])
    truth = SceneTruth.load(e.get("scene"))
    proc = StreamProcessor(bundle, x, body.sensitivity, body.persistence, body.method, truth,
                           DispatchPolicy(auto=body.auto_dispatch, cancel_s=body.cancel_s))
    sid = uuid.uuid4().hex[:10]
    with _lock:
        # keep memory bounded: drop older streams
        for old in list(_streams)[:-3]:
            _streams.pop(old, None)
        _streams[sid] = {"proc": proc, "entry": e, "acks": {}}
    return {
        "stream_id": sid,
        "recording": _public(e),
        "duration": proc.duration,
        "thresholds": proc.thresholds(),
        "freq_edges": DISPLAY_FREQ_EDGES,
        "note": note,
        "hop_s": SPEC.hop_s,
        "channels": proc.channels,
        "array": proc.array,
        "hydrophones": e.get("hydrophones") or [],
        "simulated_world": truth.available,
        "after_end_s": 900,
    }


class AdvanceBody(BaseModel):
    t: float
    sensitivity: float | None = None
    persistence: float | None = None
    method: str | None = None


def _stream(sid: str) -> dict:
    s = _streams.get(sid)
    if not s:
        raise HTTPException(404, "Replay session expired. Start the replay again.")
    return s


@app.post("/api/stream/{sid}/advance")
def stream_advance(sid: str, body: AdvanceBody):
    s = _stream(sid)
    proc: StreamProcessor = s["proc"]
    with _lock:
        proc.set_params(body.sensitivity, body.persistence, body.method)
        frames = proc.advance(body.t)
        st = proc.state()
    for evs in st["events"].values():
        for ev in evs:
            ack = s["acks"].get(ev["id"])
            if ack:
                ev["acknowledged"] = ack
    return {"frames": frames, "state": st}


class BoatBody(BaseModel):
    command: str  # dispatch | cancel | launch_now | recall | verdict
    verdict: str | None = None
    note: str = ""


@app.post("/api/stream/{sid}/boat")
def stream_boat(sid: str, body: BoatBody):
    s = _stream(sid)
    proc: StreamProcessor = s["proc"]
    if body.command not in ("dispatch", "cancel", "launch_now", "recall", "verdict"):
        raise HTTPException(400, "Unknown command")
    with _lock:
        proc.boat.command(body.command, verdict=body.verdict, note=body.note)
        if body.command == "verdict":
            boat = proc.boat
            rec = {
                "logged_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "recording": s["entry"]["name"],
                "session": s["entry"]["session"],
                "source": s["entry"]["source"],
                "event_id": boat.event_id,
                "verdict": body.verdict,
                "note": body.note,
                "contact": boat.contact,
                "feed_time_s": round(proc.now(), 1),
            }
            log = json.loads(INSPECTIONS.read_text()) if INSPECTIONS.exists() else []
            log.append(rec)
            INSPECTIONS.write_text(json.dumps(log, indent=2))
    return {"ok": True}


class PolicyBody(BaseModel):
    auto: bool | None = None
    cancel_s: float | None = None


@app.post("/api/stream/{sid}/policy")
def stream_policy(sid: str, body: PolicyBody):
    proc: StreamProcessor = _stream(sid)["proc"]
    if body.auto is not None:
        proc.boat.policy.auto = body.auto
    if body.cancel_s is not None:
        proc.boat.policy.cancel_s = max(0.0, body.cancel_s)
    return {"ok": True}


@app.get("/api/stream/{sid}/viz")
def stream_viz(sid: str, show_truth: bool = False):
    """Scenario of the current incident for the embedded 3D visualisation."""
    s = _stream(sid)
    proc: StreamProcessor = s["proc"]
    if not proc.array:
        raise HTTPException(409, "The 3D reconstruction needs a hydrophone-array recording.")
    with _lock:
        return viz_scenario.build(proc, s["entry"], show_truth=show_truth)


class AckBody(BaseModel):
    event_id: str
    note: str = ""


@app.post("/api/stream/{sid}/ack")
def stream_ack(sid: str, body: AckBody):
    s = _stream(sid)
    s["acks"][body.event_id] = {"at": time.strftime("%H:%M:%S"), "note": body.note}
    return {"ok": True}


@app.get("/api/stream/{sid}/clip")
def stream_clip(sid: str, start: float, end: float, pad: float = 2.0, hydrophone: str | None = None):
    """Event clip from the hydrophone nearest the event (array) or the mono feed."""
    s = _stream(sid)
    proc: StreamProcessor = s["proc"]
    ids = s["entry"].get("hydrophones") or []
    x = proc.audio[ids.index(hydrophone)] if hydrophone in ids else proc.mono
    a = max(0, int((start - pad) * SAMPLE_RATE))
    b = min(len(x), int((end + pad) * SAMPLE_RATE))
    if b <= a:
        raise HTTPException(400, "Empty clip range")
    clip = x[a:b]
    peak = float(np.max(np.abs(clip))) or 1.0
    return Response(wav_bytes(clip / peak * 0.9), media_type="audio/wav",
                    headers={"Content-Disposition": f'inline; filename="event_{start:.0f}-{end:.0f}s.wav"'})


@app.middleware("http")
async def _no_stale_assets(request, call_next):
    """Always revalidate the dashboard files, so a git pull is picked up on the next reload."""
    resp = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


if (VIZ / "index.html").exists():
    app.mount("/viz", StaticFiles(directory=VIZ, html=True), name="viz")
app.mount("/static", StaticFiles(directory=WEB), name="static")


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")
