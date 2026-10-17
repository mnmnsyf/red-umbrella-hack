# Harbor Handoff

A human-centered harbor response demo for the InnovateLA x Dual-Use Hackathon.

## Workspace

| Folder | Purpose |
| --- | --- |
| [`viz/`](viz/) | 3D visualization, demo UI, and scenario playback |
| [`software/`](software/) | Decision logic, simulation, and evaluation |
| [`docs/`](docs/) | Shared plan and presentation material |

## Run the acoustic detection demo

```bash
cd software
./start.sh        # first start ~3 min (generates simulated data, trains); then open http://localhost:8000
```

Needs [uv](https://docs.astral.sh/uv/). Full instructions and a demo script: [`software/README.md`](software/README.md).
