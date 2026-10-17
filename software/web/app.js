/* Harbour Acoustic Watch: client.
 * Playback position drives analysis: every tick we send audio.currentTime and
 * the server scores only windows that have fully "arrived" by then. Alerts and
 * threat levels come back from the server's detector; labels are never used here
 * except as a clearly marked overlay in the Analyst view. */
"use strict";

const $ = (id) => document.getElementById(id);
const METHOD_NAME = { spectrogram: "Spectrogram", emd: "EMD" };
const LEVEL_WORDS = ["NORMAL", "WATCH", "ELEVATED", "ALERT"];
const PX_PER_S = 10; // spectrogram history resolution

const S = {
  status: null, library: [], stream: null, frames: [], events: { spectrogram: [], emd: [] },
  thresholds: {}, method: "spectrogram", sens: 50, pers: 4, inflight: false, timer: null,
  spec: null, dbRange: null, lastT: 0, acks: {}, shownAlertId: null, speed: null,
  harbour: null, map: null, afterEnd: false, virtT: 0, simT: 0, showTruth: false,
};

// ----------------------------------------------------------------- helpers
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {}, ...opts });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.headers.get("content-type")?.includes("json") ? res.json() : res;
}
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtT = (t) => {
  if (t == null || isNaN(t)) return "–";
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const fmtHz = (f) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`);
const bandText = (b) => (!b ? "–" : b.excess_sd < 1 ? "no single band" : `${fmtHz(b.lo)}–${fmtHz(b.hi)}`);
const exceedRate = (s) => Math.pow(10, Math.log10(0.001) + (s / 100) * (Math.log10(0.1) - Math.log10(0.001)));
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function setupCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function banner(msg, kind = "") {
  const b = $("banner");
  if (!msg) { b.hidden = true; return; }
  b.textContent = msg; b.className = `banner ${kind}`; b.hidden = false;
}

// ----------------------------------------------------------------- views
document.querySelectorAll(".view-btn").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".view-btn").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    $("view-officer").hidden = btn.dataset.view !== "officer";
    $("view-analyst").hidden = btn.dataset.view !== "analyst";
    if (btn.dataset.view === "analyst") { renderLibrary(); loadReport(); drawCompare(); loadInspections(); }
    else { drawSpec(); drawScore(); drawMap(); }
  })
);

// ----------------------------------------------------------------- status & library
async function refreshStatus() {
  try {
    S.status = await api("/api/status");
  } catch (e) {
    banner(`Cannot reach the analysis server: ${e.message}`, "error");
    return;
  }
  const st = S.status;
  if (st.training) {
    const j = st.jobs.find((x) => x.kind === "train" && x.status === "running");
    banner(`Learning what normal port activity sounds like from the training sessions${j?.message ? ` (${j.message})` : ""}. The first run takes about a minute.`);
  } else if (!st.model) {
    const err = st.jobs.find((x) => x.kind === "train" && x.status === "error");
    banner(err ? `Training failed: ${err.message}` : "No trained model. Open the Analyst view and retrain the baseline.", "error");
  } else banner(null);
  $("startBtn").disabled = !st.model;
  if (st.model) {
    const m = st.model;
    $("modelLine").textContent = `Baseline trained on ${m.train_sessions.length} sessions, thresholds from ${m.calibration_sessions.length} calibration sessions (${m.data_source.join(" + ")} data).`;
  }
  const errBox = $("sessionErrors");
  errBox.hidden = !st.session_errors.length;
  errBox.textContent = st.session_errors.join(" ");
  return st;
}

async function refreshLibrary() {
  S.library = await api("/api/library");
  const sel = $("recSelect");
  const prev = sel.value;
  sel.innerHTML = "";
  const groups = [
    ["Test recordings (held out from training)", S.library.filter((e) => e.role === "test")],
    ["Used to build the model (scores will be optimistic)", S.library.filter((e) => e.role !== "test")],
  ];
  for (const [label, items] of groups) {
    if (!items.length) continue;
    const og = document.createElement("optgroup");
    og.label = label;
    for (const e of items) {
      const o = document.createElement("option");
      o.value = e.id;
      const tag = e.source === "simulated" ? "simulated" : "real";
      o.textContent = `${e.name} (${tag}, ${fmtT(e.duration)})`;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  const def = S.library.find((e) => e.id === prev) || S.library.find((e) => e.role === "test" && e.labels?.length > 1) || S.library.find((e) => e.role === "test");
  if (def) sel.value = def.id;
  renderLibrary();
}

// ----------------------------------------------------------------- controls
function syncControlLabels() {
  $("sensOut").textContent = S.sens;
  $("sensRate").textContent = `${(exceedRate(S.sens) * 100).toFixed(exceedRate(S.sens) < 0.01 ? 2 : 1)}%`;
  $("persOut").textContent = `${S.pers.toFixed(1)} s`;
  $("detectorName").textContent = METHOD_NAME[S.method];
}
$("sensRange").addEventListener("input", (e) => { S.sens = +e.target.value; syncControlLabels(); });
$("persRange").addEventListener("input", (e) => { S.pers = +e.target.value; syncControlLabels(); });
$("methodSel").addEventListener("change", (e) => {
  S.method = e.target.value; syncControlLabels(); S.shownAlertId = null;
  if (S.frames.length) { updateBoard(); renderEvents(); drawScore(); }
});
$("speedSel").addEventListener("change", (e) => { $("feedAudio").playbackRate = +e.target.value; });

$("startBtn").addEventListener("click", () => startReplay($("recSelect").value));
$("pauseBtn").addEventListener("click", () => {
  const a = $("feedAudio");
  if (a.paused) a.play(); else a.pause();
});
$("feedAudio").addEventListener("play", () => { $("pauseBtn").textContent = "Pause"; });
$("feedAudio").addEventListener("pause", () => { $("pauseBtn").textContent = "Resume"; });
$("feedAudio").addEventListener("ended", () => {
  // recording over: keep the simulated world running while the boat is out
  if (!S.stream) return;
  S.afterEnd = true; S.virtT = S.stream.duration;
});

// ----------------------------------------------------------------- replay
async function startReplay(recId, seekTo = 0) {
  if (!recId) return;
  stopLoop();
  let info;
  try {
    info = await api("/api/stream/start", { method: "POST", body: JSON.stringify({ recording_id: recId, sensitivity: S.sens, persistence: S.pers, method: S.method, auto_dispatch: $("autoDispatch").checked, cancel_s: +$("cancelSel").value }) });
  } catch (e) { banner(e.message, "error"); return; }
  S.stream = info; S.frames = []; S.events = { spectrogram: [], emd: [] }; S.thresholds = info.thresholds;
  S.dbRange = null; S.lastT = 0; S.acks = {}; S.shownAlertId = null; S.map = null; S.afterEnd = false; S.virtT = 0; S.simT = 0;
  const off = document.createElement("canvas");
  off.width = Math.ceil(info.duration * PX_PER_S); off.height = info.freq_edges.length - 1;
  const octx = off.getContext("2d");
  octx.fillStyle = css("--spec-bg"); octx.fillRect(0, 0, off.width, off.height);
  S.spec = { canvas: off, ctx: octx };
  drawFreqAxis(info.freq_edges);
  const rec = info.recording;
  $("feedLine").textContent = `Hydrophone replay of ${rec.name}, session ${rec.session}${info.note ? `. ${info.note}` : ""}`;
  const tag = $("sourceTag");
  tag.hidden = false;
  tag.textContent = rec.source === "simulated" ? "Simulated data" : "Real recording";
  tag.className = `source-tag ${rec.source === "simulated" ? "" : "real"}`;
  document.body.classList.remove("standby");
  document.body.dataset.level = "0";
  $("threatWord").textContent = "NORMAL";
  $("threatSummary").textContent = "Listening. The first score arrives after one second of audio.";
  $("mapHint").textContent = info.array ? `Port of Los Angeles, Terminal Island basin. Simulated ${info.channels}-hydrophone array.` : "Single hydrophone: no location or dispatch for this recording.";
  renderEvents(); updateAlertCard(); drawSpec(); drawScore(); drawCompare(); drawMap(); updateBoat();

  const a = $("feedAudio");
  a.src = `/api/audio/${recId}`;
  a.playbackRate = +$("speedSel").value;
  a.currentTime = seekTo;
  $("pauseBtn").disabled = false;
  try { await a.play(); } catch { banner("Press play on the audio player to start the feed (the browser blocked autoplay)."); }
  S.timer = setInterval(() => tick(false), 200);
}

function stopLoop() { if (S.timer) clearInterval(S.timer); S.timer = null; }

async function tick(final) {
  if (!S.stream || (S.inflight && !final)) return;
  const a = $("feedAudio");
  if (S.afterEnd) S.virtT += 0.2 * (+$("speedSel").value);
  let t = final ? S.stream.duration + 1 : S.afterEnd ? S.virtT : a.currentTime;
  if (!final && !S.afterEnd && t < S.lastT - 1.0) {
    // seeking backwards: a live system can't un-hear audio, so restart the session
    const rec = S.stream.recording.id;
    await startReplay(rec, t);
    return;
  }
  S.inflight = true;
  try {
    const r = await api(`/api/stream/${S.stream.stream_id}/advance`, {
      method: "POST", body: JSON.stringify({ t, sensitivity: S.sens, persistence: S.pers, method: S.method }),
    });
    S.lastT = Math.max(S.lastT, Math.min(t, S.stream.duration));
    S.thresholds = r.state.thresholds;
    S.events = r.state.events;
    S.speed = r.state.speed;
    S.map = r.state.map;
    S.simT = r.state.sim_time;
    drawMap(); updateBoat();
    if (r.state.done && S.afterEnd) { stopLoop(); updateAlertCard(); }
    for (const f of r.frames) {
      f.thr = { ...S.thresholds };
      S.frames.push(f);
      paintSpecFrame(f);
    }
    if (r.frames.length || final) {
      updateBoard(); renderEvents(); drawSpec(); drawScore();
      if (!$("view-analyst").hidden) drawCompare();
    }
    $("feedClock").textContent = fmtT(S.afterEnd ? S.simT : Math.min(t, S.stream.duration));
    if (S.afterEnd && !r.state.done) $("feedLine").textContent = `Recording ended at ${fmtT(S.stream.duration)}. The boat mission continues in the simulated harbour.`;
  } catch (e) {
    banner(e.message, "error"); stopLoop();
  } finally { S.inflight = false; }
}

// ----------------------------------------------------------------- threat board
function updateBoard() {
  const f = S.frames[S.frames.length - 1];
  if (!f) return;
  const lv = f.levels[S.method];
  document.body.dataset.level = String(lv.level);
  $("threatWord").textContent = LEVEL_WORDS[lv.level];
  document.querySelectorAll("#ladder li").forEach((li) => li.classList.toggle("on", +li.dataset.l === lv.level));
  const boatOut = S.map?.boat && S.map.boat.state !== "docked";
  $("threatSummary").textContent = lv.summary + (boatOut && lv.level < 3 ? " Inspection boat is out." : "");
  const progress = lv.level === 3 ? 1 : lv.progress ?? 0;
  $("persistFill").style.width = `${progress * 100}%`;
  $("persistText").textContent = lv.level === 3 ? "alert raised" : lv.progress != null ? `${(progress * S.pers).toFixed(1)} of ${S.pers.toFixed(1)} s` : "quiet";
  const z = f.scores[S.method], thr = S.thresholds[S.method];
  $("scoreNow").textContent = z.toFixed(1);
  $("thrNow").textContent = thr.toFixed(1);
  $("bandNow").textContent = z > thr ? bandText(f.band) : "within normal";
  updateAlertCard();
}

function currentAlert() {
  const evs = S.events[S.method] || [];
  const active = evs.find((e) => e.status === "active");
  if (active) return active;
  if (S.shownAlertId) return evs.find((e) => e.id === S.shownAlertId) || null;
  const unacked = [...evs].reverse().find((e) => !e.acknowledged && !S.acks[e.id]);
  return unacked || null;
}

function updateAlertCard() {
  const ev = currentAlert();
  const card = $("alertCard");
  $("alertEmpty").hidden = !!ev; $("alertBody").hidden = !ev;
  card.classList.toggle("has-alert", !!ev);
  if (!ev) return;
  const acked = ev.acknowledged || S.acks[ev.id];
  card.classList.toggle("ended", ev.status !== "active");
  $("alertId").textContent = `${ev.id}  ${METHOD_NAME[ev.method]} detector`;
  const st = $("alertStatus");
  st.textContent = ev.status === "active" ? (acked ? "Active, acknowledged" : "Active") : acked ? "Ended, acknowledged" : "Ended";
  st.className = `alert-status ${ev.status === "active" ? (acked ? "acked" : "") : "ended"}`;
  $("alertTitle").textContent = "Unusual acoustic event";
  $("aStart").textContent = `T+${fmtT(ev.start)}`;
  $("aRaised").textContent = `T+${fmtT(ev.alert_time)}`;
  const end = ev.end ?? S.lastT;
  $("aDur").textContent = `${Math.max(0, end - ev.start).toFixed(0)} s${ev.status === "active" ? " so far" : ""}`;
  $("aPeak").textContent = ev.peak_score != null ? `${ev.peak_score.toFixed(1)} (threshold ${S.thresholds[ev.method].toFixed(1)})` : "–";
  $("aBand").textContent = !ev.band ? "–" : ev.band.excess_sd < 1 ? "No single band stands out: the change is in the sound's pattern, not its loudness" : `${bandText(ev.band)}, ${ev.band.excess_sd} SD above normal`;
  const loc = ev.location;
  $("aLoc").textContent = !S.stream?.array ? "Not available (single hydrophone)" : !loc ? "Estimating…"
    : `${loc.mode === "array" ? "Array fix" : "Coarse fix"} near ${loc.nearest_hydrophone}, within about ${Math.round(loc.r95)} m`;
  const chk = S.map?.dispatch_check;
  $("aAis").textContent = !S.map?.simulated_world ? "No AIS feed for this recording" : chk?.ais_match
    ? `Likely known vessel: ${chk.ais_match.name} is ${chk.ais_match.distance_m} m from the estimate`
    : (S.map.ais.length ? `No AIS vessel near the estimate (${S.map.ais.length} vessel${S.map.ais.length === 1 ? "" : "s"} in harbour)` : "No AIS vessels in the harbour");
  $("aAck").disabled = !!acked;
  $("aAck").textContent = acked ? `Acknowledged ${acked.at || ""}` : "Acknowledge";
}

function playClip(ev) {
  const end = ev.end ?? S.lastT;
  const a = $("clipAudio");
  const hyd = ev.location?.nearest_hydrophone ? `&hydrophone=${ev.location.nearest_hydrophone}` : "";
  a.src = `/api/stream/${S.stream.stream_id}/clip?start=${ev.start}&end=${end}${hyd}`;
  a.hidden = false;
  $("feedAudio").pause();
  a.play();
}
$("aPlay").addEventListener("click", () => { const ev = currentAlert(); if (ev) playClip(ev); });
$("aAck").addEventListener("click", async () => {
  const ev = currentAlert();
  if (!ev) return;
  const at = new Date().toLocaleTimeString();
  S.acks[ev.id] = { at };
  S.shownAlertId = ev.id;
  updateAlertCard(); renderEvents();
  try { await api(`/api/stream/${S.stream.stream_id}/ack`, { method: "POST", body: JSON.stringify({ event_id: ev.id }) }); } catch {}
});

// ----------------------------------------------------------------- event log
function renderEvents() {
  const evs = [...(S.events[S.method] || [])].reverse();
  $("logCount").textContent = `${evs.length} event${evs.length === 1 ? "" : "s"} (${METHOD_NAME[S.method]} detector)`;
  const tb = $("eventRows");
  if (!evs.length) { tb.innerHTML = `<tr class="placeholder"><td colspan="7">No events yet.</td></tr>`; return; }
  tb.innerHTML = "";
  for (const ev of evs) {
    const acked = ev.acknowledged || S.acks[ev.id];
    const tr = document.createElement("tr");
    if (ev.status === "active") tr.className = "active-row";
    const end = ev.end ?? S.lastT;
    const status = ev.status === "active" ? `<span class="pill active">Active</span>` : acked ? `<span class="pill acked">Acknowledged</span>` : `<span class="pill">Ended</span>`;
    tr.innerHTML = `<td class="num">${ev.id}</td><td class="num">T+${fmtT(ev.alert_time)}</td><td class="num">${Math.max(0, end - ev.start).toFixed(0)} s</td>
      <td class="num">${ev.peak_score?.toFixed(1) ?? "–"}</td><td class="num">${bandText(ev.band)}</td><td>${status}</td>
      <td><button class="btn small">Play clip</button></td>`;
    tr.querySelector("button").addEventListener("click", () => { S.shownAlertId = ev.id; updateAlertCard(); playClip(ev); });
    tb.appendChild(tr);
  }
}

// ----------------------------------------------------------------- spectrogram
const CMAP = (() => {
  const stops = [[0, [9, 22, 36]], [0.3, [22, 70, 110]], [0.55, [30, 140, 150]], [0.78, [150, 205, 140]], [1, [250, 240, 180]]];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 0; while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const [p0, c0] = stops[k], [p1, c1] = stops[k + 1];
    const u = (v - p0) / (p1 - p0);
    for (let j = 0; j < 3; j++) lut[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * u;
  }
  return lut;
})();

function paintSpecFrame(f) {
  const cols = f.spec; if (!cols.length || !S.spec) return;
  if (!S.dbRange) {
    const all = cols.flat().sort((a, b) => a - b);
    S.dbRange = [all[Math.floor(all.length * 0.03)], all[Math.floor(all.length * 0.995)] + 12];
  }
  const [lo, hi] = S.dbRange;
  const nb = cols[0].length;
  const img = new ImageData(cols.length, nb);
  for (let x = 0; x < cols.length; x++) {
    for (let b = 0; b < nb; b++) {
      const v = Math.max(0, Math.min(255, Math.round(((cols[x][b] - lo) / (hi - lo)) * 255)));
      const p = ((nb - 1 - b) * cols.length + x) * 4;
      img.data[p] = CMAP[v * 3]; img.data[p + 1] = CMAP[v * 3 + 1]; img.data[p + 2] = CMAP[v * 3 + 2]; img.data[p + 3] = 255;
    }
  }
  const tmp = document.createElement("canvas");
  tmp.width = cols.length; tmp.height = nb;
  tmp.getContext("2d").putImageData(img, 0, 0);
  const t0 = f.i === 0 ? 0 : f.t - S.stream.hop_s;
  S.spec.ctx.imageSmoothingEnabled = true;
  S.spec.ctx.drawImage(tmp, Math.floor(t0 * PX_PER_S), 0, Math.ceil((f.t - t0) * PX_PER_S), nb);
}

function drawSpec() {
  const c = $("specCanvas");
  const { ctx, w, h } = setupCanvas(c);
  ctx.fillStyle = css("--spec-bg"); ctx.fillRect(0, 0, w, h);
  if (!S.spec) {
    ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.font = `16px ${css("--font")}`;
    ctx.fillText("Waiting for feed", 14, 26);
    return;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(S.spec.canvas, 0, 0, w, h);
  const x = (S.lastT / S.stream.duration) * w;
  ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.fillRect(x, 0, 1.5, h);
}

function drawFreqAxis(edges) {
  const ax = $("freqAxis"); ax.innerHTML = "";
  const lo = edges[0], hi = edges[edges.length - 1];
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000]) {
    const y = 1 - Math.log(f / lo) / Math.log(hi / lo);
    const s = document.createElement("span");
    s.style.top = `${y * 100}%`; s.textContent = fmtHz(f);
    ax.appendChild(s);
  }
}

// ----------------------------------------------------------------- charts
function timeAxis(ctx, w, h, pad, dur) {
  ctx.fillStyle = css("--ink-2"); ctx.font = `12px ${css("--font")}`; ctx.textAlign = "center";
  const step = dur > 300 ? 60 : dur > 120 ? 30 : 15;
  for (let t = 0; t <= dur; t += step) {
    const x = pad.l + (t / dur) * (w - pad.l - pad.r);
    ctx.fillText(fmtT(t), x, h - 4);
  }
  ctx.textAlign = "left";
}

function drawScore() {
  const c = $("scoreCanvas");
  const { ctx, w, h } = setupCanvas(c);
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 34, r: 8, t: 8, b: 18 };
  if (!S.stream) return;
  const dur = S.stream.duration, m = S.method;
  const thr = S.thresholds[m] ?? 1;
  const peak = S.frames.reduce((mx, f) => Math.max(mx, f.scores[m]), 0);
  const yMax = Math.max(thr * 2.2, 4, Math.min(peak * 1.1, thr * 8)), yMin = Math.min(-2, -thr * 0.4);
  const X = (t) => pad.l + (t / dur) * (w - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (Math.min(v, yMax) - yMin) / (yMax - yMin)) * (h - pad.t - pad.b);
  // alert spans
  ctx.fillStyle = "rgba(198,40,40,.16)";
  for (const ev of S.events[m] || []) {
    const x0 = X(ev.start), x1 = X(ev.end ?? S.lastT);
    ctx.fillRect(x0, pad.t, Math.max(2, x1 - x0), h - pad.t - pad.b);
    ctx.fillStyle = css("--l3"); ctx.fillRect(X(ev.alert_time) - 1, pad.t, 2, h - pad.t - pad.b); ctx.fillStyle = "rgba(198,40,40,.16)";
  }
  // y grid
  ctx.strokeStyle = css("--rule"); ctx.lineWidth = 1; ctx.fillStyle = css("--ink-2"); ctx.font = `12px ${css("--font")}`;
  for (const v of [0, Math.round(thr), Math.round(yMax * 0.95)]) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke();
    ctx.fillText(String(v), 4, Y(v) + 4);
  }
  // threshold (stepped, as it was at each moment)
  ctx.strokeStyle = css("--thr"); ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.beginPath();
  S.frames.forEach((f, i) => { const y = Y(f.thr[m]); i ? ctx.lineTo(X(f.t), y) : ctx.moveTo(X(f.t), y); });
  if (!S.frames.length) { ctx.moveTo(pad.l, Y(thr)); ctx.lineTo(w - pad.r, Y(thr)); }
  ctx.stroke(); ctx.setLineDash([]);
  // score
  ctx.strokeStyle = css("--score"); ctx.lineWidth = 1.6; ctx.beginPath();
  S.frames.forEach((f, i) => { const y = Y(f.scores[m]); i ? ctx.lineTo(X(f.t), y) : ctx.moveTo(X(f.t), y); });
  ctx.stroke();
  timeAxis(ctx, w, h, pad, dur);
}

function drawCompare() {
  const c = $("compareCanvas");
  if (c.clientWidth === 0) return;
  const { ctx, w, h } = setupCanvas(c);
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 34, r: 8, t: 8, b: 18 };
  if (!S.stream) { ctx.fillStyle = css("--ink-2"); ctx.font = `15px ${css("--font")}`; ctx.fillText("Start a replay in the Officer view to compare both methods live.", pad.l, 30); return; }
  const dur = S.stream.duration, yMax = 3, yMin = -0.5;
  const X = (t) => pad.l + (t / dur) * (w - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (Math.max(yMin, Math.min(v, yMax)) - yMin) / (yMax - yMin)) * (h - pad.t - pad.b);
  const rec = S.library.find((e) => e.id === S.stream.recording.id);
  ctx.fillStyle = css("--truth");
  for (const lab of rec?.labels || []) ctx.fillRect(X(lab.start), pad.t, X(lab.end) - X(lab.start), h - pad.t - pad.b);
  ctx.strokeStyle = css("--rule"); ctx.fillStyle = css("--ink-2"); ctx.font = `12px ${css("--font")}`;
  for (const v of [0, 1, 2, 3]) { ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke(); ctx.fillText(`${v}×`, 4, Y(v) + 4); }
  ctx.strokeStyle = css("--thr"); ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(pad.l, Y(1)); ctx.lineTo(w - pad.r, Y(1)); ctx.stroke(); ctx.setLineDash([]);
  for (const [m, color] of [["spectrogram", css("--spec-line")], ["emd", css("--emd-line")]]) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
    S.frames.forEach((f, i) => { const y = Y(f.scores[m] / Math.max(f.thr[m], 1e-6)); i ? ctx.lineTo(X(f.t), y) : ctx.moveTo(X(f.t), y); });
    ctx.stroke();
    ctx.fillStyle = color;
    for (const ev of S.events[m] || []) { ctx.beginPath(); ctx.arc(X(ev.alert_time), Y(m === "spectrogram" ? 2.75 : 2.5), 4, 0, Math.PI * 2); ctx.fill(); }
  }
  timeAxis(ctx, w, h, pad, dur);
  for (const [m, el] of [["spectrogram", "cmpSpec"], ["emd", "cmpEmd"]]) {
    const evs = S.events[m] || [];
    $(el).innerHTML = evs.length ? evs.map((e) => `<li class="num">${e.id}: raised T+${fmtT(e.alert_time)}, ${Math.max(0, (e.end ?? S.lastT) - e.start).toFixed(0)} s, peak ${e.peak_score?.toFixed(1) ?? "–"}</li>`).join("") : `<li class="muted">None yet</li>`;
  }
  if (S.speed) $("liveSpeed").textContent = `Live processing: Spectrogram ${S.speed.spectrogram.ms_per_window} ms per window (${S.speed.spectrogram.x_realtime}× real time), EMD ${S.speed.emd.ms_per_window} ms per window (${S.speed.emd.x_realtime}× real time).`;
}

// ----------------------------------------------------------------- analyst: library
function renderLibrary() {
  const tb = $("libRows"); tb.innerHTML = "";
  for (const e of S.library) {
    const tr = document.createElement("tr");
    const roleSel = `<select data-k="role">${["train", "calibration", "test"].map((r) => `<option ${r === e.role ? "selected" : ""}>${r}</option>`).join("")}</select>`;
    tr.innerHTML = `<td>${esc(e.name)}</td><td><input type="text" data-k="session" value="${esc(e.session)}"></td><td>${roleSel}</td>
      <td><span class="pill ${e.source === "simulated" ? "sim" : "real"}">${e.source}</span></td><td class="num">${fmtT(e.duration)}</td>
      <td class="num">${e.role === "test" ? (e.labels?.length ? `${e.labels.length}` : "none") : "n/a (normal only)"}</td>
      <td>${e.source === "real" ? `<button class="btn small" data-del>Remove</button>` : ""}</td>`;
    tr.querySelectorAll("[data-k]").forEach((el) =>
      el.addEventListener("change", async () => {
        try { await api(`/api/library/${e.id}`, { method: "PATCH", body: JSON.stringify({ [el.dataset.k]: el.value }) }); $("trainStatus").textContent = "Roles changed. Retrain to apply."; }
        catch (err) { $("trainStatus").textContent = err.message; }
        await refreshLibrary(); refreshStatus();
      })
    );
    tr.querySelector("[data-del]")?.addEventListener("click", async () => { await api(`/api/library/${e.id}`, { method: "DELETE" }); refreshLibrary(); });
    tb.appendChild(tr);
  }
}

async function pollJob(id, statusEl, done) {
  for (;;) {
    const j = await api(`/api/jobs/${id}`);
    statusEl.textContent = j.status === "running" ? j.message || "Working" : j.status === "error" ? `Failed: ${j.message}` : "Done.";
    if (j.status !== "running") { done?.(j); return j; }
    await new Promise((r) => setTimeout(r, 800));
  }
}

$("trainBtn").addEventListener("click", async () => {
  $("trainBtn").disabled = true;
  try {
    const { job } = await api("/api/train", { method: "POST" });
    await pollJob(job, $("trainStatus"));
    await refreshStatus();
  } catch (e) { $("trainStatus").textContent = e.message; }
  $("trainBtn").disabled = false;
});

$("uploadForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const files = $("upFiles").files;
  let ok = 0;
  for (const f of files) {
    const fd = new FormData();
    fd.append("file", f); fd.append("session", $("upSession").value); fd.append("role", $("upRole").value); fd.append("labels", $("upLabels").value);
    try { await api("/api/library/upload", { method: "POST", body: fd }); ok++; }
    catch (e) { $("upStatus").textContent = e.message; }
  }
  if (ok) $("upStatus").textContent = `Added ${ok} recording${ok > 1 ? "s" : ""}. ${$("upRole").value === "test" ? "Select it in the Officer view to replay." : "Retrain to include it in the baseline."}`;
  ev.target.reset();
  refreshLibrary();
});

// ----------------------------------------------------------------- analyst: evaluation
$("evalBtn").addEventListener("click", async () => {
  $("evalBtn").disabled = true;
  try {
    const { job } = await api("/api/evaluate", { method: "POST", body: JSON.stringify({ sensitivity: S.sens, persistence: S.pers }) });
    await pollJob(job, $("evalStatus"));
    await loadReport();
  } catch (e) { $("evalStatus").textContent = e.message; }
  $("evalBtn").disabled = false;
});

async function loadReport() {
  let r;
  try { r = await api("/api/report"); } catch { return; }
  renderReport(r);
}

function renderReport(r) {
  const box = $("reportBox");
  const sp = r.speed;
  let html = `<p class="hint">Run ${r.generated}, sensitivity ${r.settings.sensitivity}, alert after ${r.settings.persistence_s} s, alerts matched to labelled events within ${r.settings.grace_s} s after they end.</p>`;
  for (const [src, res] of Object.entries(r.by_source)) {
    const a = res.methods.spectrogram, b = res.methods.emd;
    const better = (x, y, lowerIsBetter) => (lowerIsBetter == null || x == null || y == null || x === y ? ["", ""] : (lowerIsBetter ? x < y : x > y) ? ["better", ""] : ["", "better"]);
    const row = (label, x, y, fmt, lower) => { const [cx, cy] = better(x, y, lower); return `<tr><td>${label}</td><td class="num ${cx}">${fmt(x)}</td><td class="num ${cy}">${fmt(y)}</td></tr>`; };
    const n = (v, d = 2) => (v == null ? "n/a" : (+v).toFixed(d));
    const pct = (v) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);
    html += `<div class="report-src"><h3>${src === "simulated" ? "Simulated recordings" : "Real recordings"} <span class="data-flag ${src}">${src === "simulated" ? "Simulated: shows the pipeline works, not real-world performance" : "Real data"}</span></h3>
      <p class="hint">${res.sessions.length} held-out test sessions, ${(res.hours * 60).toFixed(0)} minutes of audio.</p>
      <div class="table-wrap"><table class="cmp"><thead><tr><th>Measure</th><th>Spectrogram</th><th>EMD</th></tr></thead><tbody>
      ${row("False alerts per hour", a.false_alerts_per_hour, b.false_alerts_per_hour, (v) => n(v, 1), true)}
      ${row("95% range for that rate", a.false_alerts_per_hour_ci95, b.false_alerts_per_hour_ci95, (v) => `${v[0]}–${v[1]}`, null)}
      ${row("False alerts (count) over normal audio", a.false_alerts, b.false_alerts, (v) => `${v} in ${(a.normal_hours * 60).toFixed(0)} min`, true)}
      ${res.has_labelled_events ? row("Detection rate", a.detection_rate, b.detection_rate, pct, false) +
        row("Events detected", a.detected, b.detected, (v) => `${v} of ${a.labelled_events}`, false) +
        row("Median time to alert", a.time_to_alert_median_s, b.time_to_alert_median_s, (v) => (v == null ? "n/a" : `${n(v, 1)} s`), true) +
        row("Separation of event vs normal sound (AUC)", a.window_auc, b.window_auc, (v) => n(v, 3), false)
        : `<tr><td>Detection rate</td><td colspan="2">Not measurable: these recordings have no labelled events. Controlled vehicle runs are needed.</td></tr>`}
      ${row("Processing time per 1 s window", sp.spectrogram.ms_per_window, sp.emd.ms_per_window, (v) => `${n(v, 1)} ms`, true)}
      ${row("Speed vs real time", sp.spectrogram.x_realtime, sp.emd.x_realtime, (v) => `${n(v, 0)}×`, false)}
      </tbody></table></div>
      ${verdict(a, b, sp, res, src)}
      ${a.response ? responseTable(a.response, b.response) : ""}
      <div class="sweep-wrap"><div><h3>Detection vs false alerts as sensitivity changes</h3><canvas data-sweep="trade" data-src="${src}"></canvas></div>
      <div><h3>Effect of persistence time</h3><canvas data-sweep="persist" data-src="${src}"></canvas></div></div>
      ${res.has_labelled_events ? `<details><summary>Per-event results</summary><div class="table-wrap"><table><thead><tr><th>Session</th><th>Event (ground truth)</th><th>SNR</th><th>Spectrogram</th><th>EMD</th></tr></thead><tbody>
        ${a.per_event.map((pa, i) => { const pb = b.per_event[i]; const f = (p) => (p.detected ? `alert after ${p.time_to_alert} s` : "missed"); return `<tr><td>${esc(pa.session)}</td><td>${esc(pa.label)}, ${fmtT(pa.start)}–${fmtT(pa.end)}</td><td class="num">${pa.snr_db ?? ""}${pa.snr_db != null ? " dB" : ""}</td><td>${f(pa)}</td><td>${f(pb)}</td></tr>`; }).join("")}
        </tbody></table></div></details>` : ""}
    </div>`;
  }
  box.innerHTML = html;
  box.querySelectorAll("canvas[data-sweep]").forEach((cv) => drawSweep(cv, r.by_source[cv.dataset.src], cv.dataset.sweep));
}

function verdict(a, b, sp, res, src) {
  const lines = [];
  const where = src === "simulated" ? "On this simulated data" : "On these real recordings";
  if (res.has_labelled_events && a.detection_rate != null) {
    const d = b.detection_rate - a.detection_rate;
    lines.push(`${where}, EMD ${Math.abs(d) < 0.005 ? "detected the same share of events as" : d > 0 ? `detected more events than (${Math.round(b.detection_rate * 100)}% vs ${Math.round(a.detection_rate * 100)}%)` : `detected fewer events than (${Math.round(b.detection_rate * 100)}% vs ${Math.round(a.detection_rate * 100)}%)`} the spectrogram method.`);
    if (a.time_to_alert_median_s != null && b.time_to_alert_median_s != null)
      lines.push(`Median time to alert: EMD ${b.time_to_alert_median_s} s, spectrogram ${a.time_to_alert_median_s} s.`);
  }
  lines.push(`False alerts: EMD ${b.false_alerts} vs spectrogram ${a.false_alerts} over ${(a.normal_hours * 60).toFixed(0)} minutes of normal audio. With this little audio, the 95% ranges overlap heavily, so this difference is not conclusive.`);
  lines.push(`EMD costs about ${Math.round(sp.emd.ms_per_window / Math.max(sp.spectrogram.ms_per_window, 0.01))}× more computation, but both run far faster than real time.`);
  return `<div class="verdict">${lines.map((l) => `<p>${l}</p>`).join("")}</div>`;
}

function drawSweep(cv, res, kind) {
  const { ctx, w, h } = setupCanvas(cv);
  const pad = { l: 40, r: 10, t: 10, b: 30 };
  ctx.clearRect(0, 0, w, h);
  ctx.font = `12px ${css("--font")}`;
  const series = [["spectrogram", css("--spec-line")], ["emd", css("--emd-line")]];
  let pts = {}, xLab, yLab, xMax, yMax = 1;
  if (kind === "trade") {
    for (const [m] of series) pts[m] = res.methods[m].sweep_sensitivity.map((p) => [p.false_alerts_per_hour ?? 0, p.detection_rate ?? 0, p.sensitivity]);
    xLab = "False alerts per hour (point labels: sensitivity)"; yLab = res.has_labelled_events ? "Detection rate" : "(no labelled events)";
  } else {
    for (const [m] of series) pts[m] = res.methods[m].sweep_persistence.map((p) => [p.persistence_s, res.has_labelled_events ? p.detection_rate ?? 0 : 0, p.false_alerts_per_hour]);
    xLab = "Persistence (s); labels show false alerts per hour"; yLab = "Detection rate";
  }
  xMax = Math.max(1, ...Object.values(pts).flat().map((p) => p[0])) * 1.08;
  const X = (v) => pad.l + (v / xMax) * (w - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - v / yMax) * (h - pad.t - pad.b);
  ctx.strokeStyle = css("--rule"); ctx.fillStyle = css("--ink-2");
  for (const v of [0, 0.25, 0.5, 0.75, 1]) { ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke(); ctx.fillText(`${v * 100}%`, 4, Y(v) + 4); }
  ctx.textAlign = "center";
  for (let i = 0; i <= 4; i++) { const v = (xMax / 4) * i; ctx.fillText(v.toFixed(v < 10 ? 1 : 0), X(v), h - pad.b + 14); }
  ctx.fillText(xLab, (pad.l + w) / 2, h - 2); ctx.textAlign = "left";
  for (const [m, color] of series) {
    const p = pts[m];
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    p.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke();
    p.forEach(([x, y, lab]) => { ctx.beginPath(); ctx.arc(X(x), Y(y), 3.5, 0, Math.PI * 2); ctx.fill(); if (lab != null) ctx.fillText(kind === "persist" ? lab.toFixed(1) : `s${lab}`, X(x) + 5, Y(y) - 5); });
  }
  ctx.textAlign = "right";
  ctx.fillStyle = css("--spec-line"); ctx.fillText("Spectrogram", w - pad.r - 40, h - pad.b - 8);
  ctx.fillStyle = css("--emd-line"); ctx.fillText("EMD", w - pad.r, h - pad.b - 8);
  ctx.textAlign = "left";
}

// ----------------------------------------------------------------- boot
window.addEventListener("resize", () => { drawSpec(); drawScore(); drawCompare(); drawMap(); });
(async function boot() {
  document.body.classList.add("standby");
  syncControlLabels();
  try { S.harbour = await api("/api/harbour"); } catch {}
  await refreshStatus();
  await refreshLibrary();
  drawSpec(); drawScore(); drawMap();
  // keep status fresh while the baseline trains on first launch
  const poll = setInterval(async () => {
    const st = await refreshStatus();
    if (st && !st.training) { clearInterval(poll); refreshLibrary(); }
  }, 2000);
})();

// ----------------------------------------------------------------- harbour map
function drawMap() {
  const svg = $("mapSvg"), H = S.harbour;
  if (!H) return;
  const [bx0, by0, bx1, by1] = H.bounds;
  // frame the patrol basin, expanded to the panel's aspect ratio, clamped to the image
  const px = H.patrol.map((p) => p[0]), py = H.patrol.map((p) => p[1]);
  let vx0 = Math.min(...px) - 120, vx1 = Math.max(...px) + 120, vy0 = Math.min(...py) - 120, vy1 = Math.max(...py) + 120;
  const aspect = (svg.clientWidth || 1000) / (svg.clientHeight || 500);
  if ((vx1 - vx0) / (vy1 - vy0) < aspect) { const w = (vy1 - vy0) * aspect, c = (vx0 + vx1) / 2; vx0 = c - w / 2; vx1 = c + w / 2; }
  else { const h = (vx1 - vx0) / aspect, c = (vy0 + vy1) / 2; vy0 = c - h / 2; vy1 = c + h / 2; }
  const shift = (a0, a1, lo, hi) => (a0 < lo ? [lo, a1 + lo - a0] : a1 > hi ? [a0 - (a1 - hi), hi] : [a0, a1]);
  [vx0, vx1] = shift(vx0, vx1, bx0, bx1); [vy0, vy1] = shift(vy0, vy1, by0, by1);
  const P = (x, y) => [+(x - bx0).toFixed(1), +(by1 - y).toFixed(1)];  // numbers, so offsets add rather than concatenate
  const pts = (poly) => poly.map(([x, y]) => P(x, y).join(",")).join(" ");
  svg.setAttribute("viewBox", `${vx0 - bx0} ${by1 - vy1} ${vx1 - vx0} ${vy1 - vy0}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const k = (vx1 - vx0) / (svg.clientWidth || 1000);  // metres per screen pixel: marker sizes below are in pixels
  svg.style.fontSize = `${14 * k}px`;
  const M = S.map, out = [];
  out.push(`<image href="${H.basemap.url}" x="0" y="0" width="${bx1 - bx0}" height="${by1 - by0}" preserveAspectRatio="none"/>`);
  out.push(`<rect class="dim" x="0" y="0" width="${bx1 - bx0}" height="${by1 - by0}"/>`);
  out.push(`<polygon class="patrol" points="${pts(H.patrol)}"/>`);
  H.berths.forEach(([x0, y0], i) => { const [x, y] = P(x0, y0); out.push(`<text class="lbl" x="${x - 20 * k}" y="${y - 16 * k}">Berth ${i + 1}</text>`); });
  const [dx, dy] = P(...H.dock);
  out.push(`<rect class="dock" x="${dx - 10 * k}" y="${dy - 10 * k}" width="${20 * k}" height="${20 * k}" rx="${3 * k}"/><text class="lbl" x="${dx + 16 * k}" y="${dy + 8 * k}">Boat dock</text>`);
  // 500 m scale bar + imagery credit (bottom-left of view)
  const sx = vx0 - bx0 + 30 * k, sy = by1 - vy0 - 24 * k;
  out.push(`<line class="scale" x1="${sx}" y1="${sy}" x2="${sx + 500}" y2="${sy}"/><text class="lbl" x="${sx}" y="${sy - 10 * k}">500 m</text>`);
  out.push(`<text class="credit" x="${vx1 - bx0 - 8 * k}" y="${by1 - vy0 - 10 * k}" text-anchor="end">${esc(H.basemap.credit)}. Port of Los Angeles; array, vessels and boat simulated.</text>`);
  // estimated source
  const loc0 = M?.location;
  const loc = loc0 && loc0.best ? { ...loc0, x: loc0.best.x, y: loc0.best.y } : loc0;  // show the fix the boat uses
  if (loc) {
    const [lx, ly] = P(loc.x, loc.y);
    out.push(`<ellipse class="loc" cx="${lx}" cy="${ly}" rx="${loc.major}" ry="${loc.minor}" transform="rotate(${-loc.angle_deg} ${lx} ${ly})"/>`);
    out.push(`<path class="loc-c" d="M${lx - 12 * k} ${ly}h${24 * k}M${lx} ${ly - 12 * k}v${24 * k}"/>`);
  }
  const tg = M?.boat?.target;
  if (!loc && tg && M.boat.state !== "docked") { const [gx, gy] = P(tg.x, tg.y); out.push(`<circle class="loc" cx="${gx}" cy="${gy}" r="${Math.max(tg.r95, 60)}" opacity=".6"/>`); }
  // hydrophones, glowing with the active method's per-hydrophone score
  const f = S.frames[S.frames.length - 1];
  const thr = S.thresholds[S.method] || 1;
  H.hydrophones.forEach((h, i) => {
    const [hx, hy] = P(h.x, h.y);
    const z = f?.ch_scores?.[S.method]?.[i];
    const g = z == null || !S.stream?.array ? 0 : Math.max(0, Math.min(1.5, z / thr));
    if (g > 0.5) out.push(`<circle class="hyd-glow" cx="${hx}" cy="${hy}" r="${(16 + 30 * g) * k}" opacity="${(0.25 + 0.4 * (g - 0.5)).toFixed(2)}"/>`);
    out.push(`<circle class="hyd" cx="${hx}" cy="${hy}" r="${9 * k}"/><text class="lbl" x="${hx + 13 * k}" y="${hy + 7 * k}">${h.id}</text>`);
  });
  // AIS vessels
  for (const v of M?.ais || []) {
    const [vx, vy] = P(v.x, v.y);
    out.push(`<path class="ais" d="M0 ${-18 * k} L${10 * k} ${12 * k} L0 ${6 * k} L${-10 * k} ${12 * k} Z" transform="translate(${vx} ${vy}) rotate(${v.course})"/><text class="lbl ais-label" x="${+vx + 14 * k}" y="${+vy - 10 * k}">${esc(v.name)}</text>`);
  }
  if (S.showTruth) for (const tr of M?.truth || []) { const [tx, ty] = P(tr.x, tr.y); out.push(`<rect class="truth" x="${tx - 9 * k}" y="${ty - 9 * k}" width="${18 * k}" height="${18 * k}" transform="rotate(45 ${tx} ${ty})"/>`); }
  // boat
  const b = M?.boat;
  if (b && b.state !== "docked") {
    if (b.trail.length > 1) out.push(`<polyline class="trail" points="${b.trail.map(([x, y]) => P(x, y).join(",")).join(" ")}"/>`);
    const plan = [[b.x, b.y], ...(b.path || []), ...b.waypoints];
    if (plan.length > 1) out.push(`<polyline class="plan" points="${plan.map(([x, y]) => P(x, y).join(",")).join(" ")}"/>`);
    const [qx, qy] = P(b.x, b.y);
    if (["searching", "inspecting", "awaiting_verdict"].includes(b.state)) out.push(`<circle class="sonar" cx="${qx}" cy="${qy}" r="${H.sonar_range}"/>`);
    out.push(`<path class="boat" d="M0 ${-20 * k} L${11 * k} ${14 * k} L0 ${8 * k} L${-11 * k} ${14 * k} Z" transform="translate(${qx} ${qy}) rotate(${b.heading})"/>`);
  }
  svg.innerHTML = out.join("");
  $("truthLegend").hidden = $("truthLegendText").hidden = !S.showTruth;
}

// ----------------------------------------------------------------- inspection boat
function updateBoat() {
  const M = S.map, b = M?.boat;
  const array = S.stream?.array;
  $("dispatchBtn").disabled = true; $("recallBtn").hidden = true;
  $("countdownBox").hidden = true; $("verdictBox").hidden = true; $("contactBox").hidden = true; $("checkList").hidden = true;
  if (!S.stream || !b) { $("boatState").textContent = "Docked, ready"; $("boatDetail").textContent = "Start a replay of an array recording to enable dispatch."; return; }
  if (!array) { $("boatState").textContent = "Docked"; $("boatDetail").textContent = "This recording has one hydrophone, so the sound can't be located. Dispatch needs the array."; return; }
  const st = $("boatState");
  st.textContent = b.state_text; st.classList.toggle("active", b.state !== "docked");
  const dist = b.target ? Math.round(Math.hypot(b.target.x - b.x, b.target.y - b.y)) : null;
  const detail = {
    docked: M.dispatch_check.ok ? "Alert located. Ready to launch." : "Waiting for a located alert.",
    pending: `Target ${M.boat.event_id}: search area ${Math.round(b.target?.r95 ?? 0)} m around the estimate.`,
    en_route: `${dist} m to search area, about ${fmtT(b.eta_s)} to arrive.`,
    searching: `Sweeping a ${Math.round(Math.max(b.target?.r95 ?? 60, 60))} m area with sonar, ${b.waypoints.length} legs left.`,
    inspecting: "Holding station on the contact and observing.",
    awaiting_verdict: b.contact ? "Observation complete. Record what was found." : "Search complete. Sonar found nothing in the area.",
    returning: `About ${fmtT(b.eta_s)} to dock.`,
  }[b.state];
  $("boatDetail").textContent = detail;
  if (b.state === "pending") { $("countdownBox").hidden = false; $("countdownNum").textContent = Math.ceil(b.pending_left_s); }
  if (b.state === "docked") {
    const active = (S.events[S.method] || []).find((e) => e.status === "active");
    $("dispatchBtn").disabled = !(active && M.location);
    const reasons = M.dispatch_check.reasons.filter((r) => r !== "No active alert.");
    if (active && reasons.length) {
      $("checkList").hidden = false;
      $("checkList").innerHTML = `<li><strong>${b.auto ? "Auto-dispatch held:" : "Auto-dispatch is off."}</strong></li>` + reasons.map((r) => `<li>${esc(r)}</li>`).join("");
    } else if (active && !b.auto) {
      $("checkList").hidden = false; $("checkList").innerHTML = "<li>Auto-dispatch is off. Dispatch manually if needed.</li>";
    }
  }
  if (["en_route", "searching", "inspecting", "awaiting_verdict"].includes(b.state)) $("recallBtn").hidden = false;
  if (b.contact || (b.state !== "docked" && b.camera.length)) {
    const c = b.contact, lines = [];
    if (c) lines.push(`<p><strong>Sonar:</strong> ${esc(c.sonar)}, ${c.range_m} m, bearing ${String(c.bearing_deg).padStart(3, "0")}°</p>`);
    if (c && c.close_range_acoustic_db != null) lines.push(`<p><strong>Close-range hydrophone:</strong> unusual sound ${c.close_range_acoustic_db > 0 ? "+" : ""}${c.close_range_acoustic_db} dB above ambient</p>`);
    else if (c) lines.push(`<p><strong>Close-range hydrophone:</strong> object is silent now</p>`);
    lines.push(`<p><strong>Camera:</strong> ${b.camera.length ? b.camera.map((x) => esc(`${x.what} at ${x.range_m} m`)).join("; ") : "no surface vessel in view"}</p>`);
    $("contactBox").innerHTML = lines.join(""); $("contactBox").hidden = false;
  }
  if (["inspecting", "awaiting_verdict"].includes(b.state)) $("verdictBox").hidden = false;
}

async function boatCmd(command, extra = {}) {
  if (!S.stream) return;
  try { await api(`/api/stream/${S.stream.stream_id}/boat`, { method: "POST", body: JSON.stringify({ command, ...extra }) }); }
  catch (e) { banner(e.message, "error"); }
  if (command === "verdict") loadInspections();
  if (!S.timer) tick(false);  // apply immediately even if paused at the end
}
$("dispatchBtn").addEventListener("click", () => boatCmd("dispatch"));
$("cancelLaunch").addEventListener("click", () => boatCmd("cancel"));
$("launchNow").addEventListener("click", () => boatCmd("launch_now"));
$("recallBtn").addEventListener("click", () => boatCmd("recall"));
document.querySelectorAll("[data-verdict]").forEach((btn) => btn.addEventListener("click", () => boatCmd("verdict", { verdict: btn.dataset.verdict })));
async function sendPolicy() {
  if (!S.stream) return;
  try { await api(`/api/stream/${S.stream.stream_id}/policy`, { method: "POST", body: JSON.stringify({ auto: $("autoDispatch").checked, cancel_s: +$("cancelSel").value }) }); } catch {}
}
$("autoDispatch").addEventListener("change", sendPolicy);
$("cancelSel").addEventListener("change", sendPolicy);
$("showTruth").addEventListener("change", (e) => { S.showTruth = e.target.checked; drawMap(); });

async function loadInspections() {
  let rows;
  try { rows = await api("/api/inspections"); } catch { return; }
  const tb = $("inspRows");
  if (!rows.length) { tb.innerHTML = `<tr class="placeholder"><td colspan="5">No inspections yet.</td></tr>`; return; }
  tb.innerHTML = rows.slice().reverse().map((r) => `<tr><td class="num">${esc(r.logged_at)}</td><td>${esc(r.recording)} <span class="pill ${r.source === "simulated" ? "sim" : "real"}">${esc(r.source)}</span></td>
    <td class="num">${esc(r.event_id ?? "–")}</td><td>${esc(r.verdict)}</td><td>${r.contact ? esc(`${r.contact.sonar}, ${r.contact.range_m} m`) : "none"}</td></tr>`).join("");
}

function responseTable(ra, rb) {
  const v = (x, suf = "") => (x == null ? "n/a" : `${x}${suf}`);
  const pct = (x) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);
  const rows = [
    ["Median location error", v(ra.loc_error_median_m, " m"), v(rb.loc_error_median_m, " m")],
    ["90% of location errors under", v(ra.loc_error_p90_m, " m"), v(rb.loc_error_p90_m, " m")],
    ["True source inside the stated 95% area", pct(ra.loc_inside_95_rate), pct(rb.loc_inside_95_rate)],
    ["Fix type (array / coarse)", `${ra.loc_modes.array} / ${ra.loc_modes.coarse}`, `${rb.loc_modes.array} / ${rb.loc_modes.coarse}`],
    ["Boat sorties launched", v(ra.sorties), v(rb.sorties)],
    ["Sorties on false alerts", v(ra.sorties_on_false_alerts), v(rb.sorties_on_false_alerts)],
    ["Labelled events reached (sonar contact)", `${ra.events_reached} of ${ra.per_event.length}`, `${rb.events_reached} of ${rb.per_event.length}`],
    ["Median time, event start to contact", v(ra.contact_after_median_s, " s"), v(rb.contact_after_median_s, " s")],
    ["Alerts held back by AIS match", v(ra.alerts_explained_by_ais), v(rb.alerts_explained_by_ais)],
  ];
  return `<h3 style="margin-top:16px">Response loop on array recordings</h3>
    <p class="hint">Full live loop: alert, location, auto-dispatch after a 15 s cancel window, sonar search. A simulated officer confirms a sonar contact or records "nothing found". Boat, sensors and AIS are simulated.</p>
    <div class="table-wrap"><table class="cmp"><thead><tr><th>Measure</th><th>Spectrogram</th><th>EMD</th></tr></thead><tbody>
    ${rows.map(([n, x, y]) => `<tr><td>${n}</td><td class="num">${x}</td><td class="num">${y}</td></tr>`).join("")}</tbody></table></div>`;
}
