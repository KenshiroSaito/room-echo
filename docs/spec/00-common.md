# Common specification

Applies to all six ideas. Where it disagrees with an individual spec, the individual spec takes precedence.

## 1. Assumptions

- The six are independent static sites. Each idea gets its own repository and its own Vercel project.
- Parts used by several ideas (evolution strategies, the Worker pool, the 2D simulation) are copied in from whichever idea built them first. They are not made into a shared package, so that each idea can be published and changed independently. For an idea in a different language, they are ported.
- This common spec and the individual spec are copied into each repository's `docs/spec/` and used from there.
- The UI language is English. Localizing into Japanese will be considered after launch. No i18n mechanism is built, but all UI text is kept in one place, `src/strings.ts`.
- Cost is 0 yen. No server-side processing, databases, per-user external APIs, or analytics tools.
- No theme switching (light/dark). Each idea is fixed to one color scheme.

## 2. Tech stack

| Item | Decision |
|---|---|
| Language and build | UI and rendering in TypeScript (strict) with Vite. The language of the computational core is decided per idea (section 2.1) |
| UI components | React. State in Zustand |
| Rendering | Specified per idea (Canvas 2D, WebGL2, WebGPU). Simulation rendering happens outside React |
| Styling | CSS variable tokens (section 4.2) and CSS Modules |
| Tests | Vitest (unit), Playwright (screens and GPU) |
| Formatting and linting | ESLint, Prettier |
| Package management | pnpm. Node is the current LTS |
| Hosting | Vercel free plan, `*.vercel.app` |

Check library APIs and versions in the official documentation when starting. If the spec and the official documentation disagree, follow the official documentation.

### 2.1 Languages per idea

Several languages are used across the six. The UI experience stays the same; only the computational core is written in another language and converted into a form that runs in the browser (WebAssembly or JavaScript).

| Idea | Computational core | Other languages |
|---|---|---|
| 10 | TypeScript | WGSL (GPU computation), GLSL (fallback display) |
| 1 | TypeScript (the Rapier physics engine is WebAssembly built from Rust) | None |
| A | Java (converted to JavaScript with TeaVM) | None |
| 6 | C (converted to WebAssembly) | Verilog (circuit), C and RISC-V assembly (game), GLSL (rendering) |
| C | TypeScript | GLSL (simulation), Python (M0 validation) |
| B | Decided when starting | Undecided |

Rules:

- Parts written in languages other than TypeScript are built locally, and the build output is committed to the repository. Vercel builds only the TypeScript part. Do not assume compilers for other languages exist in Vercel's build environment.
- Calls that cross a language boundary are limited to a few per frame. Data is passed in bulk as numeric arrays.
- Switching to another language does not change the "Experience," "Screen," "Visualization," or "Computational model" of the individual spec.

## 3. Design rules

1. **Separate computation from rendering**: the computational core is a module that never touches the DOM. Whatever the language, it also runs outside the browser (Node, the JVM, a native build for my PC), so the same code is used for tests, speed measurements, and precomputation. For TypeScript, it lives in `src/sim/`.
2. **Reproducible**: use only seeded random number generators. Never use `Math.random` in computation. The same seed and settings give the same result.
3. **Keep a reference implementation**: for computation written for the GPU or in WASM, provide a slow TypeScript version of the same rules. Test that the two agree on small inputs.
4. **State goes in the URL**: settings and creations go in the URL hash, in the form `#v1=<JSON deflated and encoded as base64url>`. Always include the version number. Compress with the browser's built-in `CompressionStream`.
5. **Record measurements**: record measured speed and convergence values in `docs/measurements.md`, with the date, device, and browser. If the spec's estimates and the measurements disagree, the measurements are the truth and the spec is corrected.
6. **Adapt to the device**: run a short measurement at startup to decide grid size and population. The target is 60 fps on the integrated GPU of a laptop from around 2020.
7. **Record sources and rights**: list external data, models, and audio in `THIRD_PARTY.md` with where they came from and their license. Do not bundle anything whose license can't be confirmed.

## 4. Visual design

### 4.1 Principles

1. **One canvas is the star**. It fills the screen, and controls are overlaid as semi-transparent panels.
2. **Moving within 2 seconds of opening**. The first screen is a prepared scene already playing automatically. Don't start from an empty screen and a start button.
3. **The highlight arrives within 10 seconds**. Follow the individual spec's "First 10 seconds."
4. **What you see is the real computation**. Don't present decorative animation as if it were computed results. When something is amplified or slowed for display, show the factor on screen.
5. **Put numbers near the picture**. Don't make people hunt for a legend; label things directly next to them.
6. **Color is assigned by role** (section 4.2). Never distinguish by color alone; always pair it with a label or shape.
7. **Motion carries meaning**. Connect state changes with a 150–300 ms ease-out. No purely decorative motion. Under `prefers-reduced-motion`, slow down autoplay and avoid flashing.
8. **Easy to clip and share**. Every idea has "Copy link" and "Save image." Saving video (`canvas.captureStream` and `MediaRecorder`) is optional.

### 4.2 Color tokens

Use a palette that has passed the checking script. The script checks distinguishability under color-vision-deficiency simulation, distinguishability with normal vision, and contrast against the background. Re-run the check whenever a value changes.

Dark screens (ideas 10, A, 6, C, B):

| Role | CSS variable | Value |
|---|---|---|
| Canvas background | `--canvas` | `#0d0d0d` |
| Panel background | `--surface` | `#1a1a19` |
| Text (primary) | `--text-1` | `#f0efec` |
| Text (secondary) | `--text-2` | `#c3c2b7` |
| Text (muted), axes | `--text-3` | `#898781` |
| Rules | `--grid` | `#2c2c2a` |
| Series 1–8 | `--series-1` – `--series-8` | `#3987e5` `#d95926` `#199e70` `#c98500` `#d55181` `#0ca30c` `#9085e9` `#e66767` |
| Quantity (shades of one hue, small → large) | `--seq-1` – `--seq-5` | `#0d366b` `#256abf` `#3987e5` `#86b6ef` `#cde2fb` |
| Diverging, negative side | `--div-neg` | The same blues as the quantity shades |
| Diverging, midpoint | `--div-mid` | The same as the canvas background |
| Diverging, positive side | `--div-pos` | Shades of red with `#e66767` in the middle. Match each step's lightness to the blue side |
| Status | `--good` `--warn` `--serious` `--critical` | `#0ca30c` `#fab219` `#ec835a` `#d03b3b` |

Light screen (idea 1's paper look):

| Role | CSS variable | Value |
|---|---|---|
| Canvas background (paper) | `--canvas` | `#f9f9f7` |
| Panel background | `--surface` | `#fcfcfb` |
| Text (primary, secondary, muted) | `--text-1` `--text-2` `--text-3` | `#0b0b0b` `#52514e` `#898781` |
| Rules | `--grid` | `#e1e0d9` |
| Series 1–3 | `--series-1` – `--series-3` | `#2a78d6` `#eb6834` `#1baf7a` |

Color rules:

- A series color is fixed to its subject. Don't repaint when rankings or the number shown change.
- Assign series in order starting from 1, and don't reorder them. This order is what keeps neighbors distinguishable even with color-vision deficiency.
- In displays where any two can sit next to each other, such as scatter plots, distinguish at most 3 series by color. From the fourth on, group them as "Other" (in `--text-3`) or distinguish them by label and shape.
- Don't create a new color for a ninth series.
- Don't use a rainbow for quantities. Quantities use shades of one hue; diverging values use two hues with a neutral midpoint.
- Don't use series colors for text. Put a colored marker next to the text.
- Status colors always come with an icon and text.

### 4.3 Type

- Use the system font: `system-ui, -apple-system, "Segoe UI", sans-serif`. Load no external fonts.
- Code and hex values use `ui-monospace, Menlo, Consolas, monospace`.
- Numbers aligned in columns get `font-variant-numeric: tabular-nums`.
- Sizes: body 14px, notes 12px, headings 20px, headline numbers 32px.

### 4.4 Screen skeleton

Every idea puts the same components in the same places.

```
┌──────────────────────────────────────────────────────────────────┐
│ Title           [Tour] [Explain]        [Copy link] [Save image] │  Top bar (48px tall, semi-transparent)
│                                                                  │
│                                                  ┌─────────────┐ │
│               Canvas (full screen)               │ Controls    │ │  Right panel (280px wide, collapsible)
│                                                  │ panel       │ │
│                                                  └─────────────┘ │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ Time strip: play/pause, speed, time-series graph             │ │  Bottom strip (96px tall)
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

- **Tour**: a 3–5 step guide. Each step is one short explanation pointing at something on the canvas, plus one action for the visitor to take. It can be closed at any time. It starts automatically on the first visit.
- **Explain**: a drawer that slides in from the right, with three sections: "How it works," "What is simplified," and "Credits." "What is simplified" states the model's limits without omission.
- Below 768px wide, the right panel becomes a sheet that slides up from the bottom, and the bottom strip becomes 64px tall. The minimum width is 360px. Touch input is supported.

### 4.5 Graphs

- Lines are 2px thick. Axes and rules stay unobtrusive.
- Two or more series get a legend. With four series or fewer, also label each line directly at its end. A single series gets no legend; the title says what it is.
- Only one vertical axis. Two quantities on different scales go in two separate graphs.
- On hover, show a vertical line and a value tooltip. Make the hit area wider than the line.

## 5. Definition of done (for every milestone)

- Every "Done when" criterion in the individual spec is met.
- `pnpm test` and `pnpm build` pass. Parts written in languages other than TypeScript also pass that language's tests.
- Take screenshots of the main screens with Playwright and save them in `docs/screenshots/`. Look at those images and confirm there is no overlapping text, overflow, or wrong coloring.
- Record measurements in `docs/measurements.md`.
- Commit at each milestone. From M1 on, keep the site published on Vercel.

## 6. Workflow

- One piece of work covers only one milestone.
- Each repository's `README.md` shows the current milestone. Its `CONTRIBUTING.md` records where the specs are and the decisions changed by measurement.
- Items marked "needs measuring" or "needs confirming" in a spec are checked within that milestone, and the spec is rewritten with the results.

Example of the first request (for idea 10):

```
Read docs/spec/00-common.md and docs/spec/10-room-echo.md.
Implement only M0.
Once the "Done when" criteria are met, write the measurements to docs/measurements.md,
report where they differed from the spec's estimates, and stop. Do not move on to M1.
```
