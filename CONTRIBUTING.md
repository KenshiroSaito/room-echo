# Contributing

## How work is organised

- The specifications are [docs/spec/00-common.md](docs/spec/00-common.md) (common to all ideas) and [docs/spec/10-room-echo.md](docs/spec/10-room-echo.md) (this project). Read both before you start.
- Work goes one milestone at a time. One change covers only one milestone. The current milestone is shown in the [README](README.md#status).
- From M1 on, each milestone is developed on its own branch (for example `m1-draw-and-see`) and merged into `main` through a pull request. Vercel builds a preview of each pull request.
- When the spec and the measurements disagree, the measurements win, and the spec is corrected to match. Measurements are recorded in [docs/measurements.md](docs/measurements.md).
- A milestone is done when it meets the definition of done in the common spec (section 5): its criteria are met, `pnpm test` and `pnpm build` pass, screenshots are saved and checked, measurements are recorded, and the work is committed.

## Decisions changed by measurement

- **The outer absorbing layer is a matched layer (PML)** (spec 5.3). A damping-only layer reflected low frequencies, and no setting of σ_max met −30 dB. Layer cells carry two face velocities, and the update rule gained the E and C terms (spec 5.2). Approved on 2026-11-26.
- **σ_max·Δt = 0.15 is final.** The layer stays 24 cells thick.
- **The grid is not coarsened.** 48,000 steps at size M take about 6.7 seconds (Apple M3).
- **Criterion 3's reflection coefficient is measured as an energy ratio.** The peak ratio comes out 0.7% low because of grid dispersion.
- **Wall edits also edit the field** (M1, spec 5.2). New wall cells are cleared at once, freed cells are filled from the air around them, and the field's sum is kept. Otherwise every edit left a uniform offset that the automatic gain showed as a tint, and cleared walls rang at the scale of the grid.
- **The automatic gain stops at ×100** and is measured against a clap 1 m away (M1, spec 4.1). At ×1000 a quiet room never looked quiet.
- **Materials use sourced values** (M1, spec 5.4, 5.5; `THIRD_PARTY.md`). The biggest change is acoustic foam, 0.90 → 0.78.
- **60 fps at M is judged against the machine** (M1). An empty WebGPU page drops frames on this machine too, so the check is that the app keeps that rate and never waits for its own GPU work.

## Implementation rules (not in the spec)

- The reference implementation (`src/sim/reference.ts`) and the GPU version (`src/gpu/shaders/step.wgsl`) write the same formulas with the operations in the same order. If you change one, change the other. The same goes for the field edit after a wall change (`editField` in `reference.ts`, `edit.wgsl`). Both implement the `Sim` interface (`src/sim/sim.ts`), and both are checked with the same scenes in `src/sim/experiments.ts`.
- Cell coefficients are two 32-bit floats per cell: `[2 − K·λ², B + D]` for air and `[0, −1]` for walls. The outermost ring of the domain must always be wall, and `buildCoefficients` checks this.
- `src/sim/` never touches the DOM. It doesn't use `Math.random` either, and ESLint bans it there. Random numbers come from `src/sim/rng.ts`.
- UI text lives in `src/strings.ts`.
- Colours that code needs as numbers live in `src/styles/palette.ts` and must match `src/styles/tokens.css`.
- The display loop runs on every frame, so keep it light on the main thread: no React re-render per frame (write per-frame text straight into the DOM) and no new objects per frame where they can be reused.
- The Playwright tests reach the page through `window.__roomEcho`, which exists only when the URL has `?test`.
- The WebGPU tests run the installed Chrome headless from Playwright (`channel: 'chrome'`), because the headless shell bundled with Playwright has no GPU.
- TypeScript is pinned to the 6.0 line, because typescript-eslint doesn't support the 7 line yet (as of November 2026). Upgrade once it does.
- pnpm is set to skip versions published very recently. Installing a pinned version bypasses this protection. If `minimumReleaseAgeExclude` entries appear in `pnpm-workspace.yaml`, downgrade to an older stable version and remove the entries.
