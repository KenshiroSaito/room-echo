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

## Implementation rules (not in the spec)

- The reference implementation (`src/sim/reference.ts`) and the GPU version (`src/gpu/shaders/step.wgsl`) write the same formulas with the operations in the same order. If you change one, change the other. Both implement the `Sim` interface (`src/sim/sim.ts`), and both are checked with the same scenes in `src/sim/experiments.ts`.
- Cell coefficients are two 32-bit floats per cell: `[2 − K·λ², B + D]` for air and `[0, −1]` for walls. The outermost ring of the domain must always be wall, and `buildCoefficients` checks this.
- `src/sim/` never touches the DOM. It doesn't use `Math.random` either, and ESLint bans it there. Random numbers come from `src/sim/rng.ts`.
- UI text lives in `src/strings.ts`.
- The WebGPU tests run the installed Chrome headless from Playwright (`channel: 'chrome'`), because the headless shell bundled with Playwright has no GPU.
- TypeScript is pinned to the 6.0 line, because typescript-eslint doesn't support the 7 line yet (as of November 2026). Upgrade once it does.
- pnpm is set to skip versions published very recently. Installing a pinned version bypasses this protection. If `minimumReleaseAgeExclude` entries appear in `pnpm-workspace.yaml`, downgrade to an older stable version and remove the entries.
