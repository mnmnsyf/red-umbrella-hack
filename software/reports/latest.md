# Detector comparison: Spectrogram vs EMD

Generated 2026-10-17 13:05:44. Settings: sensitivity 50, persistence 4.0 s, matching grace 10.0 s.

Trained on 12 sessions, thresholds calibrated on 4 separate sessions (data: simulated).

## Processing speed

| Method | ms / window | x real-time |
|---|---|---|
| spectrogram | 0.67 | 745.6x |
| emd | 16.95 | 29.5x |

## Results on SIMULATED DATA: demonstrates the pipeline only, not real-world performance

14 test sessions, 0.633 h.

| Metric | Spectrogram | EMD |
|---|---|---|
| False alerts / hour | 2.26 | 2.26 |
|   95% interval | 0.06–12.58 | 0.06–12.58 |
|   false alerts (count) | 1 | 1 |
| Detection rate | 73% | 36% |
|   events detected | 8 | 4 |
| Median time to alert (s) | 4.25 | 8.75 |
| Window AUC | 0.8879 | 0.7625 |

Response loop on array sessions (location + inspection boat, simulated officer):

| Measure | Spectrogram | EMD |
|---|---|---|
| Median location error (m) | 37.5 | 51.0 |
| 90th pct location error (m) | 93.8 | 122.3 |
| Truth inside stated 95% area | 1.0 | 1.0 |
| Inspection sorties | 8 | 4 |
| Sorties on false alerts | 1 | 1 |
| Events reached by boat (sonar contact) | 5 | 2 |
| Median event start to contact (s) | 51.5 | 253.8 |
| Alerts explained by AIS | 0 | 0 |

Per event:

| Session | Event | SNR dB | Spectrogram | EMD |
|---|---|---|---|---|
| sim-test-event-01 | simulated uuv | 12 | 1.5 s | 4.0 s |
| sim-test-event-02 | simulated uuv | 6 | 4.5 s | missed |
| sim-test-event-02 | simulated diver | 9 | missed | missed |
| sim-test-event-03 | simulated uuv | 3 | 4.0 s | missed |
| sim-test-event-04 | simulated diver | 6 | 3.0 s | 3.0 s |
| sim-test-event-05 | simulated uuv | 9 | 27.5 s | missed |
| sim-test-event-05 | simulated uuv | 0 | 19.5 s | missed |
| sim-test-event-06 | simulated diver | 0 | missed | missed |
| sim-test-event-07 | simulated uuv | -3 | 35.5 s | 58.5 s |
| sim-test-event-08 | simulated diver | 3 | missed | missed |
| sim-test-event-08 | simulated uuv | 6 | 3.5 s | 13.5 s |
