# Harbour Acoustic Watch

A local demo that learns what normal underwater port activity sounds like, replays a test recording as if it were a live hydrophone feed, scores how unusual each moment is, and raises an officer-facing alert when unusual sound persists. The setting is a real section of the **Port of Los Angeles** (Terminal Island container basin) on USGS aerial imagery. A simulated 6-hydrophone array estimates where the sound is coming from, and the system can auto-dispatch an inspection boat to check it up close. It compares two methods on identical data: a conventional **spectrogram** model and an **EMD** (empirical mode decomposition) model.

Inspired by the Phinorm discussion. This does **not** implement Phinorm's proprietary algorithm. Part of the Harbor Handoff workspace: decision logic, simulation and evaluation (see the [project plan](../docs/Harbor_Handoff_Plan.md)).

## Run the demo

### 1. Install uv (one time)

[uv](https://docs.astral.sh/uv/) installs the right Python and every dependency for you. For the 3D view (the team's `viz/` project) also install [Node.js 18+](https://nodejs.org/); without Node the dashboard still runs, just without the 3D button.

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

### 2. Start the app

```bash
git clone https://github.com/mnmnsyf/red-umbrella-hack.git
cd red-umbrella-hack/software
./start.sh
```

On Windows, or if `./start.sh` won't run:

```bash
uv sync
uv run uvicorn portwatch.server:app --host 127.0.0.1 --port 8000
```

Then open **http://localhost:8000** in Chrome, Edge or Firefox.

**First start takes about 4–5 minutes.** It builds the 3D view (when Node is installed), generates the simulated recordings (~600 MB of 6-channel audio, in `data/`, not in git) and trains the model. A banner shows progress. Later starts take seconds. **Do the first start before the demo.**

To use a different port: `PORT=8001 ./start.sh`. To stop: `Ctrl+C`.

### 3. Demo script (about 3 minutes)

1. **Officer** view (default). In *Recording to replay* pick `sim-test-event-01.wav` (a simulated underwater vehicle heading for Berth 1). Set *Speed* to **4×**.
2. Click **Start live replay**. If the audio doesn't start, press play on the audio bar (browsers block autoplay).
3. Talk over the screen as it changes:
   - **Threat board** climbs NORMAL, WATCH, ELEVATED, ALERT as the unusual sound persists.
   - **Harbour picture**: the real Port of Los Angeles basin. The hydrophones near the sound glow red, a red area shows the estimated source location, and AIS-reporting ships move through.
   - **Alert card**: "Unusual acoustic event, possible intrusion, not confirmed", with location and AIS cross-check. **Play clip** replays the audio.
   - **Inspection boat**: a 15 s cancel countdown (**Cancel launch** / **Launch now**), then the boat drives out from its dock by the middle pier and sweeps the area with sonar. The search continues after the recording ends (about 1 more minute at 4×).
   - Once the alert is raised, click **View 3D reconstruction** on the alert card. The dashboard moves to the left half and the 3D view opens on the right, replaying the same incident in sync with the feed clock: the hydrophones that heard it, the location estimate, the boat's route and sonar scan. The camera drifts slowly so it always feels live.
4. When it reports a contact, click **Confirmed intrusion**. The boat returns, the verdict is logged, and the 3D view shows the confirmed outcome.
5. Optional: switch to **Analyst**. Show both methods side by side, tick *Show true source positions* (then go back to the Officer map to see the estimate against the truth), and scroll to the evaluation report.

Other recordings: `sim-test-event-08.wav` (diver, then a vehicle: the boat finds the vehicle), `sim-test-event-03.wav` (quiet vehicle, slower search), `sim-test-normal-01.wav` (normal traffic, which should stay NORMAL). Some events are missed or mislocated on purpose. That's part of the honest evaluation. Controls at the bottom change sensitivity, persistence time and detection method live.

All data, vessels, the boat and its sensors are **simulated**, and the screen says so.

### Recording the demo video

```bash
cd software/tools && npm install --no-save playwright-core && npx playwright-core install ffmpeg
node record_demo.mjs        # with the app running; drives your Chrome, records the page at 1920x1080 (~90 s)
ffmpeg -i demo-recording/*.webm -c:v libx264 -crf 20 -pix_fmt yuv420p demo.mp4
```

It records only the demo page (no screen-recording permission needed). Options: `RECORDING=sim-test-event-08 SPEED=4 node record_demo.mjs`.

### Troubleshooting

| Problem | Fix |
|---|---|
| `uv: command not found` | Open a new terminal after installing uv |
| Port 8000 already in use | `PORT=8001 ./start.sh`, then open http://localhost:8001 |
| "No trained model" banner | Wait for first-run training, or click **Analyst > Retrain baseline** |
| Replay falls behind at 8× | Use 4× (six hydrophones take more processing) |
| No "View 3D reconstruction" button | Install Node.js 18+ and restart `./start.sh` (it builds `../viz` into `web/viz`) |
| Start fresh | Stop the app, delete `data/` and `models/`, start again |

### Command line

```bash
uv run python -m portwatch.evaluate --sensitivity 50 --persistence 4   # retrain + full evaluation -> reports/latest.md
uv run pytest -q                                                        # tests
```

## What it does

| Requirement | Where |
|---|---|
| Upload normal recordings | Analyst > Add recordings (WAV, any rate or channel count, converted to 16 kHz mono), role *train* or *calibration* |
| Learn normal patterns | Analyst > Retrain baseline. Both models train on the same windows |
| Replay a test recording as live | Officer > Start live replay. The browser's playback position drives analysis, and only audio that has "arrived" is scored |
| Continuous anomaly score | Officer score chart, threat board readout |
| Alert on persistent anomaly, replay clip | Alert card and event log. Clip = event ±2 s |
| Sensitivity and persistence controls | Officer control strip. Apply live |
| Officer-facing threat level | Threat board: NORMAL / WATCH / ELEVATED / ALERT, build-up meter, current alert, acknowledge |
| Locate the source | Harbour map over real aerial imagery: estimated position with 95% area (array recordings only) |
| Inspection boat | Auto-dispatch with officer cancel window, manual dispatch, recall, sonar/camera report, verdicts. All simulated |

### Method

Audio is cut into 1 s windows every 0.5 s. Each window becomes a feature vector:

- **Spectrogram**: STFT power in 24 log-spaced bands (20 Hz–7.6 kHz). Per band: mean level, variability and tonality (narrowband lines), plus spectral flatness and centroid.
- **EMD**: sifting EMD (implemented in `portwatch/emd.py`) gives up to 7 IMFs. A Hilbert transform gives each IMF's instantaneous frequency and amplitude. Features: the Hilbert–Huang marginal spectrum in the same 24 bands, plus per-IMF energy, mean instantaneous frequency, frequency spread and envelope modulation.

Both then use the **same** detector and alert logic. The detector is standardise, then PCA, then a Gaussian mixture fitted to normal windows. The score is negative log-likelihood, expressed as a robust z-score against calibration sessions. The threshold is the calibration-score quantile chosen by sensitivity. An alert fires when the score stays over threshold for the persistence time (dips under 1 s are tolerated) and clears after 4 s quiet.

### Locate and dispatch (simulated)

```
alert (array score) ─▶ locate ─▶ dispatch check ─▶ cancel window ─▶ boat transit ─▶ sonar search ─▶ officer verdict
                         │            │
                 delay + loudness   AIS vessel nearby? location too vague?
                 across 4 hydrophones  outside patrol area? boat busy?
```

- **Harbour** (`harbour.py`): the Terminal Island container basin, Port of Los Angeles, traced by hand from USGS aerial imagery and stored as latitude/longitude: water outline, finger piers, berths, entrance route. The 6 hydrophones, the boat dock and all vessels are simulated. Boats and ships route around piers with A* over a 10 m water grid. The basemap comes from `tools/fetch_basemap.py` (USGS The National Map, public domain).
- **Array score**: every hydrophone is scored by the same detector. The alert score is the mean of the two highest, so a second hydrophone must agree. Its threshold is calibrated separately on multi-channel calibration sessions.
- **Location** (`localize.py`): the bands that jumped most above the pre-onset background at the moment the event began become its frequency signature. Two estimates are formed. An *array fix* comes from the delays between hydrophones: weighted cross-correlation (GCC-PHAT) and a grid search over the basin. A *coarse fix* comes from how much the signature rose at each hydrophone, with a 200 m uncertainty. The boat searches around the *best* fix, taken when the sound stood out most.
- **Dispatch rules** (`dispatch.py`): auto-launch only if there is an active alert, the location is precise enough, the spot is inside the patrol area, no AIS-broadcasting vessel is near the estimate, and the boat is free. The officer then has 15 s to cancel. Otherwise they can dispatch manually or recall the boat.
- **Boat**: transits at 10 m/s (about 20 kn) along water routes, then sweeps a sonar spiral (60 m range, 3.5 m/s) sized to the uncertainty. On contact it holds station, reports sonar, close-range hydrophone and camera readings, and waits for the officer's verdict. Verdicts go to `data/inspections.json`.
- **3D reconstruction** (`viz_scenario.py`): the dashboard turns the current incident into a scenario for the team's 3D viz and sends it to the embedded view (browser messages), along with the feed clock. The viz runs in its external mode (`/viz/?external=1`): it follows the dashboard's clock and replaces the scenario as the incident develops. True positions come from the simulation; the alert, estimate, boat route and verdict come from the live session.
- **What uses ground truth**: only the simulated world, meaning the AIS feed (AIS vessels only), the boat's sonar and camera, the Analyst "true position" overlay, and the evaluator. Alerts and the boat's destination come only from the acoustic model and location estimate.

### Honest-testing safeguards

- Train, calibration and test are separate roles, assigned **per session**. A session can't span roles (enforced on upload, on edit, at training and at evaluation).
- Thresholds come only from calibration sessions the model never trained on.
- Ground-truth labels are stored with test recordings and used **only** by the evaluator and the Analyst overlay. The detector and alert engine never see them, and nothing is triggered at a scripted time.
- An alert counts as a detection only if it is raised *during* the labelled event (or within 10 s after). An alert that was already running doesn't count.
- Results are reported separately for simulated and real recordings, never pooled. Simulated results carry a "shows the pipeline works, not real-world performance" flag.
- Events are worded "Unusual acoustic event (possible intrusion). Not confirmed", never as an identified drone.

## Current results (SIMULATED data only)

Sensitivity 50, persistence 4 s, 14 held-out simulated 6-hydrophone test sessions in the Port of Los Angeles basin (38 min, 11 labelled events):

| | Spectrogram | EMD |
|---|---|---|
| False alerts / hour | 4.5 (2 alerts; 95% range 0.6–16.3) | 4.5 (2 alerts; 0.6–16.3) |
| Detection rate | 64% (7/11) | 18% (2/11) |
| Median time to alert | 3 s | 47 s |
| Window AUC | 0.93 | 0.71 |
| Processing per hydrophone | 0.9 ms/window (~540× real time) | 19 ms/window (~27× real time) |
| Median location error (fix the boat uses) | 76 m | 500 m |
| True source inside stated 95% area | 71% | 50% |
| Boat sorties (on false alerts) | 8 (3) | 3 (2) |
| Labelled events reached by the boat | 3 of 11 | 0 of 11 |
| Median event start to sonar contact | 238 s | n/a |
| Alerts held back by an AIS match | 4 | 2 |

**On this simulated data, EMD did not improve detection, speed or false alerts.** The false-alert figures rest on 2 alerts each in about 26 minutes of normal audio, which is far too little to compare.

**Location and response in a real-sized basin:** the basin is about 2.5 × 1 km, and the 6 hydrophones are about 450 m apart. In an earlier invented 1 km harbour with 4 hydrophones 250 m apart, the median location error was 38 m and the boat reached 5 of 11 events. Here it's 76 m (with some fixes off by 450 m or more), and the boat reaches 3 of 11 after a median of 4 minutes. Precise timing-based fixes are switched off (`ARRAY_FIX_ENABLED` in `localize.py`) because passing boats dominate the cross-correlations; the system uses the loudness-based coarse fix with a stated 300 m uncertainty. Some alerts are also held back because an AIS ship is near the estimate, which is correct behaviour when the ship may explain the sound, but it can mask a real intruder near a busy berth. A denser array (more hydrophones nearer the berths) is the main improvement a real deployment would need.

These numbers come from a simulator I wrote, so they mainly show the pipeline works end to end. They are not evidence about real harbours.

## What still needs real-world testing

1. **Real normal recordings.** Many hours over different days, tides, weather and traffic, from the actual hydrophone and gain chain. Session-to-session variation is the main driver of false alerts here.
2. **Controlled intrusion runs.** Detection rate and time-to-alert are meaningless without labelled runs of real vehicles or divers at known ranges, speeds and aspects, including runs masked by passing ships.
3. **False-alert rate at operational scale.** A credible false-alerts-per-hour figure needs tens to hundreds of hours of normal audio. The 95% range in the report shows how wide the uncertainty still is.
4. **Sample rate and bandwidth.** The demo works at 16 kHz (content up to 8 kHz). Real small-vehicle signatures may need a wider band.
5. **Array geometry and localisation.** Precise fixes need more hydrophones, closer together, or directional sensors, plus surveyed positions and clock sync. The array layout and harbour outline are in `harbour.py` (traced by hand from imagery, so the outline is approximate). Real array uploads aren't supported yet (uploads are mixed to mono).
6. **Dispatch integration.** The boat is simulated. A real one needs a mission interface (for example MAVLink/ArduPilot or ROS 2), collision avoidance, a geofence, lost-link behaviour, port-authority approval, and a way for the detector to ignore the boat's own noise.
7. **AIS fusion on real feeds.** Real AIS is delayed and sometimes missing. Small craft and anyone hostile often don't broadcast.
8. **EMD variants.** Only plain EMD was tested. EEMD/CEEMDAN (less mode mixing), different IMF features, or a hybrid with the spectrogram may perform differently. Phinorm's own method is unknown.
9. **Model drift.** No retraining schedule or seasonal baseline yet.

## Layout

```
portwatch/   audio.py emd.py features.py model.py alerting.py pipeline.py
             localize.py dispatch.py harbour.py
             evaluate.py simulate.py store.py server.py
web/         index.html styles.css app.js   (no build step), basemap.jpg + .json (USGS aerial imagery)
tools/       fetch_basemap.py   (re-download or move the basemap)
data/        sample/ (simulated, generated), uploads/ (yours), library.json, cache/
models/      current.pkl (trained baseline)
reports/     latest.md, latest.json
tests/       test_core.py
```

To start again from scratch: delete `data/` (keep `data/uploads` if you added recordings), `models/` and `reports/`.

## Credits

Aerial imagery: USGS The National Map (public domain). Harbour outline traced from it; hydrophones, vessels, the inspection boat and all audio are simulated.
