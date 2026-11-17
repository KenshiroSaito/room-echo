# Room Echo

Draw a floor plan and clap: you see the sound waves bounce off the walls and bend through gaps, then hear the clap with that room's acoustics. The site is static, and a 2D acoustic wave simulation runs on the GPU with WebGPU.

## Status

**M0, the computational core, is done.** It includes a CPU reference solver, a WebGPU solver and the `/bench/` measurement page. **Next is M1 (draw and see).**

The milestones are defined in [docs/spec/10-room-echo.md](docs/spec/10-room-echo.md#7-milestones). Results are logged in [docs/measurements.md](docs/measurements.md).

## Requirements

- Node.js 24 or later
- pnpm 11 (the version is pinned in `package.json`)
- A browser with WebGPU, such as a recent Chrome. The GPU tests use the installed Chrome.

## Getting started

```sh
pnpm install
pnpm dev
```

Then open `/bench/` on the dev server. It runs the M0 checks on your GPU and measures simulation speed.

## Commands

| Command                      | What it does                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                   | Dev server. The measurement page is at `/bench/`                                                                              |
| `pnpm test`                  | Unit tests (Vitest). Checks M0 criteria 1–3 with the reference implementation. Takes about 1 minute                           |
| `pnpm test:e2e`              | Playwright. Opens `/bench/` in real Chrome, checks criteria 1–5 with the GPU version, and saves images to `docs/screenshots/` |
| `pnpm build`                 | Type check and production build                                                                                               |
| `pnpm lint` / `pnpm format`  | ESLint / Prettier                                                                                                             |
| `pnpm tsx scripts/<name>.ts` | Measurement scripts (`tune-absorber`, `absorber-2d`, `wall-reflection`, `reference-speed`)                                    |

## Project layout

| Path                | Contents                                                                           |
| ------------------- | ---------------------------------------------------------------------------------- |
| `src/sim/`          | Simulation core: grid, materials, CPU reference solver, sources, analysis (no DOM) |
| `src/gpu/`          | WebGPU solver and view, with WGSL shaders in `src/gpu/shaders/`                    |
| `src/bench/`        | The `/bench/` measurement page                                                     |
| `e2e/`              | Playwright tests                                                                   |
| `scripts/`          | Measurement scripts                                                                |
| `docs/spec/`        | Specifications                                                                     |
| `docs/screenshots/` | Screenshots saved by the Playwright tests                                          |

## Documentation

- [Common specification](docs/spec/00-common.md)
- [Room Echo specification](docs/spec/10-room-echo.md)
- [Measurements](docs/measurements.md)
- [Contributing](CONTRIBUTING.md): how work is organised, implementation rules and decisions made from measurements
