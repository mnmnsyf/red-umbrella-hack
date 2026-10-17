# Detector comparison: Spectrogram vs EMD

Generated 2026-10-17 14:31:19. Settings: sensitivity 50, persistence 4.0 s, matching grace 10.0 s.

Trained on 12 sessions, thresholds calibrated on 4 separate sessions (data: simulated).

## Processing speed

| Method | ms / window | x real-time |
|---|---|---|
| spectrogram | 0.92 | 544.0x |
| emd | 18.51 | 27.0x |

## Results on SIMULATED DATA: demonstrates the pipeline only, not real-world performance

14 test sessions, 0.633 h.

| Metric | Spectrogram | EMD |
|---|---|---|
| False alerts / hour | 4.51 | 4.51 |
|   95% interval | 0.55–16.31 | 0.55–16.31 |
|   false alerts (count) | 2 | 2 |
| Detection rate | 64% | 18% |
|   events detected | 7 | 2 |
| Median time to alert (s) | 3.0 | 47.25 |
| Window AUC | 0.9348 | 0.7066 |

Response loop on array sessions (location + inspection boat, simulated officer):

| Measure | Spectrogram | EMD |
|---|---|---|
| Median location error (m) | 76.0 | 500.0 |
| 90th pct location error (m) | 478.8 | 836.8 |
| Truth inside stated 95% area | 0.71 | 0.5 |
| Inspection sorties | 8 | 3 |
| Sorties on false alerts | 3 | 2 |
| Events reached by boat (sonar contact) | 3 | 0 |
| Median event start to contact (s) | 238.0 | n/a |
| Alerts explained by AIS | 4 | 2 |

Per event:

| Session | Event | SNR dB | Spectrogram | EMD |
|---|---|---|---|---|
| sim-test-event-01 | simulated uuv | 12 | 1.5 s | missed |
| sim-test-event-02 | simulated uuv | 6 | missed | missed |
| sim-test-event-02 | simulated diver | 9 | missed | missed |
| sim-test-event-03 | simulated uuv | 3 | 3.0 s | missed |
| sim-test-event-04 | simulated diver | 6 | 21.5 s | 59.0 s |
| sim-test-event-05 | simulated uuv | 9 | 22.0 s | missed |
| sim-test-event-05 | simulated uuv | 0 | 3.0 s | missed |
| sim-test-event-06 | simulated diver | 0 | 32.5 s | 35.5 s |
| sim-test-event-07 | simulated uuv | -3 | missed | missed |
| sim-test-event-08 | simulated diver | 3 | missed | missed |
| sim-test-event-08 | simulated uuv | 6 | 2.5 s | missed |
