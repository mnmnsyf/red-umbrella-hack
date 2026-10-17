# Harbor Handoff

A human-centered harbor response demo for the InnovateLA x Dual-Use Hackathon.

## Workspace

| Folder | Purpose |
| --- | --- |
| [`viz/`](viz/) | 3D visualization, demo UI, and scenario playback |
| [`software/`](software/) | Decision logic, simulation, and evaluation |
| [`docs/`](docs/) | Shared plan, visualization spec, and presentation material |

Start with the [project plan](docs/Harbor_Handoff_Plan.md) and [visualization spec](docs/Visualization_Spec.md).

## Working together

- Keep visualization code in `viz/` and simulation code in `software/`.
- Put shared scenario inputs and their format in a location both parts agree on; document any interface changes in `docs/`.
- Make changes on a short-lived branch and open a pull request before merging to `main`.
- Do not commit credentials, generated builds, or personal meeting notes.

## Setup

Each component should add its own setup instructions as it is implemented.
