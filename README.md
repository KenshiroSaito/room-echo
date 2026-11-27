# Room Echo

Draw a floor plan and clap: you see the sound waves bounce off the walls and bend through gaps, then hear the clap with that room's acoustics. The site is static, and a 2D acoustic wave simulation runs on the GPU with WebGPU.

## Status

**M1, draw and see, is done.** You can draw walls of six materials, erase openings, choose the floor, clap or play a tone, and watch the waves in the Wave, Relief and Energy views. M0, the computational core, includes a CPU reference solver, a WebGPU solver and the `/bench/` measurement page. **Next is M2 (listen).**

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

Then open the dev server's address. The room editor opens on a bedroom that has just been clapped in. `/bench/` runs the M0 checks on your GPU and measures simulation speed.

### Using the editor

| Tool or key | What it does                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Source (S)  | Click anywhere to clap there; drag the source to move it                                                                          |
| Wall (W)    | Drag to draw a wall; Shift keeps it straight. Ends snap to other walls and to 5 cm. Click a wall to give it the selected material |
| Erase (E)   | Trace over a wall to erase it or cut an opening                                                                                   |
| C / Space   | Clap at the source / pause or play                                                                                                |
| ⌘Z / Ctrl+Z | Undo (⇧⌘Z or Ctrl+Y to redo)                                                                                                      |

## Commands

| Command                      | What it does                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`                   | Dev server. The measurement page is at `/bench/`                                                                               |
| `pnpm test`                  | Unit tests (Vitest). Checks M0 criteria 1–3 with the reference implementation, and the editor's geometry. About 1 minute       |
| `pnpm test:e2e`              | Playwright in real Chrome with WebGPU: the M1 criteria on the site and the M0 criteria on `/bench/`. Saves `docs/screenshots/` |
| `pnpm build`                 | Type check and production build                                                                                                |
| `pnpm lint` / `pnpm format`  | ESLint / Prettier                                                                                                              |
| `pnpm tsx scripts/<name>.ts` | Measurement scripts (`tune-absorber`, `absorber-2d`, `wall-reflection`, `reference-speed`, `display-levels`, `palette`)        |

## Project layout

| Path                | Contents                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `src/sim/`          | Simulation core: grid, walls, materials, CPU reference solver, sources, display rules (no DOM) |
| `src/gpu/`          | WebGPU solver and renderer, with WGSL shaders in `src/gpu/shaders/`                            |
| `src/app/`          | The display loop that runs the solver and the renderer                                         |
| `src/state/`        | Application state (Zustand)                                                                    |
| `src/ui/`           | React components of the page                                                                   |
| `src/bench/`        | The `/bench/` measurement page                                                                 |
| `e2e/`              | Playwright tests                                                                               |
| `scripts/`          | Measurement scripts                                                                            |
| `docs/spec/`        | Specifications                                                                                 |
| `docs/screenshots/` | Screenshots saved by the Playwright tests                                                      |

## Documentation

- [Common specification](docs/spec/00-common.md)
- [Room Echo specification](docs/spec/10-room-echo.md)
- [Measurements](docs/measurements.md)
- [Third-party data](THIRD_PARTY.md): sources of the absorption coefficients
- [Contributing](CONTRIBUTING.md): how work is organised, implementation rules and decisions made from measurements

## License

The code is released under the [MIT License](LICENSE).
