# Spec: Idea 10 — See and hear how a room sounds (working title: Room Echo)

Common spec: [00-common.md](00-common.md).

Decision: build it with sound, not Wi-Fi.

## 1. Overview

Draw a floor plan and clap: you see sound waves bounce off the walls and bend around through gaps. Press "Listen," and the sound plays with that room's acoustics.

What to build:

- A 2D acoustic wave simulation (WebGPU)
- A floor-plan and material editor
- Three wave views (Wave, Relief, Energy)
- Recording the room's response, and listening through that response

What not to build:

- 3D computation, or computing reflections off the ceiling and floor (the floor and ceiling are approximated as uniform damping)
- Sound transmitted through walls
- Automatic recognition of floor-plan images
- Wi-Fi radio waves

## 2. Experience

### First 10 seconds

1. On opening, the floor plan of an unfurnished bedroom is shown, starting just after an automatic clap in the center. Ripples spread and bounce off the walls.
2. After 5 seconds, "Click anywhere to clap" appears on screen.
3. A new ripple spreads from wherever you click.

### Visitor flow

1. Click to clap. The wave spreads.
2. Draw one wall. The wave bounces off it and bends around its ends.
3. Change the wall's material to acoustic absorber. The reflection weakens.
4. Press "Listen." After a few to a few tens of seconds of recording, a clap plays with that room's acoustics.
5. Switch to a prepared room (bathroom, tatami room, long hallway, and so on) and compare by ear.
6. Switch to "Tone" and move the frequency: a pattern of loud and quiet spots appears in the room.

## 3. Screen

```
┌──────────────────────────────────────────────────────────────────┐
│ Room Echo       [Tour] [Explain]        [Copy link] [Save image] │
│ ┌───────┐                                        ┌─────────────┐ │
│ │ Tools │                                        │ Room        │ │
│ │  ✎    │      ┌─────────────────┐               │  preset ▾   │ │
│ │  ⌫    │      │   ((( • )))     │               │  size S M L │ │
│ │  ◉    │      │        ┃        │               │ Wall        │ │
│ │  ☊    │      │        ┃   ☊    │               │  material ▾ │ │
│ └───────┘      └─────────────────┘               │ Floor ▾     │ │
│                                                  │ View        │ │
│  t = 12.4 ms · Slowed 120×      Gain ×8          │  Wave/Energy│ │
│                                                  │  Relief ☑   │ │
│                                                  │ [ Listen ]  │ │
│                                                  └─────────────┘ │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ [Clap|Tone] speed ─●──  │ Response ▁▃█▅▃▂▁▁    RT60 0.82 s   │ │
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

Tools on the left:

| Tool | Action |
|---|---|
| Wall | Drag to draw a straight wall. Shift locks it horizontal or vertical. Thickness is 10 cm |
| Erase | Trace over a wall to erase it. Door and window openings are made with this |
| Source | Move the sound source |
| Listener | Move the listening position and direction |

Right panel:

| Item | Contents |
|---|---|
| Room | Choose a prepared room; room size (S, M, L) |
| Wall material | The material for walls drawn next. Click an existing wall to change its material |
| Floor | The floor material. Sets how fast the whole room decays (section 5.5) |
| View | Switch between Wave and Energy; Relief on/off |
| Listen | Starts recording the response. After recording, it turns into the listening controls |

Bottom strip:

- Left: source type (Clap, Tone), Tone frequency, display speed
- Right: the response waveform at the listening position, the decay curve, the RT60 value

## 4. Visualization

The star of this idea is how the wave field itself looks.

### 4.1 Wave (the default view)

- **Color**: paint sound pressure with the diverging palette. Positive (compression) is on the red side, negative (rarefaction) on the blue side, and 0 is the canvas background. Quiet areas sink into the background, and only the waves appear to glow.
- **Tone mapping**: compress before mapping to color so weak reflections are visible too. `v = sign(p) · (1 − exp(−k·|p|·g))`, where `k` is fixed and `g` is the automatic gain below.
- **Automatic gain**: when the field's amplitude gets small, raise `g` so late reflections stay visible. Raise it quickly and lower it slowly. While `g > 1`, show the factor, as in "Gain ×8."
- Fixed in M1 (`src/sim/display.ts`):
  - `g = 1` means the loudest cell is as loud as a clap 1 m from the source in free field (0.1027, measured by `scripts/display-levels.ts`), and `g` aims at that reference divided by the loudest cell.
  - The gain rises with a time constant of 0.15 s of display time and falls with 0.8 s. A clap or the start of the tone resets it to 1 and holds it there for 260 steps (the clap itself and its travel to 0.5 m), so the gain does not race up while the field is still silent.
  - The gain stops at ×100 (40 dB, the range of the Energy view), so a room that has gone quiet looks quiet. At ×1000 the picture showed whatever was left 60 dB down.
  - `k = 1.5 / 0.1027`: the loudest cell maps to `v ≈ 0.78` and a reflection ten times weaker to 0.14. Chosen by eye: at 1.0 the walls' hit flashes were hard to see; at 3.0 a reverberant room flooded with the brightest colours.
  - Cells within 30 cm of a playing tone are left out of the loudest-cell search: next to the source they are far louder than the room.
- **Time**: show it at about 1/120 of real time (a wave crosses an 8 m room in about 3 seconds). Display the factor and elapsed time as "t = 12.4 ms · Slowed 120×." The speed can be changed.

### 4.2 Relief (relief shading, on by default)

Treat sound pressure as height and shade it with light from above at an angle. It looks like a water surface, so it's instantly recognizable as waves.

- Normals are computed from the pressure difference with neighboring cells.
- Diffuse light and a weak specular light are multiplied into the Wave colors.
- Not used in the Energy view.

### 4.3 Energy

- Paint the moving average of squared sound pressure (time constant 20 ms in simulation time) with the quantity palette (shades of blue). The scale is in dB, ranging from the maximum down to −40 dB.
- With Clap, it shows where sound reaches well and where it doesn't.
- With Tone, standing-wave patterns (antinodes and nodes) appear. This is the view's biggest highlight.

### 4.4 Walls, source, and listening position

- **Walls**: assign a series color per material, and add the material name in small text beside the wall (don't rely only on a legend). The moment a wave hits, the wall brightens where it was hit. Brightness is proportional to the absolute pressure of the neighboring cell.
- **Source**: a small circle. When it sounds, one ring expands.
- **Listening position**: a head-shaped marker, with dots for the left and right ears and a nose showing the direction. The two ear dots are where sound pressure is actually recorded.

### 4.5 Response strip (bottom)

- **Waveform**: the sound pressure recorded at the listening position, drawn from left to right as recording progresses. The left and right ears are drawn one above the other.
- **Decay curve**: the curve of the response energy integrated backward (dB). A separate graph from the waveform.
- **RT60**: computed from the slope of the decay curve between −5 dB and −25 dB, and shown large as the headline number.
- **Playback position**: during listening, a vertical line moves across the waveform.
- Hovering over the waveform shows that moment's time and the distance the sound has traveled (time × speed of sound).

### 4.6 Display while recording

When "Listen" is pressed, the computation runs at top speed. Meanwhile, the canvas draws the field every few hundred steps, with a progress ring and "Recording the room… 37%" in the center. The wait is shown as the room filling with sound.

### 4.7 A/B listening

- One recorded response can be saved as a "Snapshot."
- During listening, you can switch between "Dry," "This room," and "Snapshot." Switching happens without stopping the sound.

## 5. Computational model

### 5.1 Grid and time step

| Quantity | Value | Basis |
|---|---|---|
| Speed of sound c | 343 m/s | Air at room temperature |
| Time step Δt | 1/48000 s | Same as the audio sampling rate, so the recording is directly audio data |
| Courant number λ = cΔt/Δx | 0.70 | Slightly below the 2D stability limit 1/√2 ≈ 0.707 |
| Grid spacing Δx | 343 / (48000 × 0.70) ≈ 1.021 cm | Determined by the three above |
| Frequencies handled correctly | Up to about 4.2 kHz | Rule of thumb: at least 8 cells per wavelength |

Room sizes:

| Name | Actual size | Cells |
|---|---|---|
| S | 6.0 m × 4.5 m | 588 × 441 ≈ 260,000 |
| M (default) | 8.0 m × 6.0 m | 784 × 588 ≈ 460,000 |
| L | 12.0 m × 9.0 m | 1176 × 882 ≈ 1,040,000 |

The outer 24 cells are given over to the absorbing layer of section 5.3.

### 5.2 Update rule

Each cell is either "air" or "wall." A wall cell's pressure is always 0 and is not updated. Air cells are updated with the following rule.

```
p_next = [ (2 − K·λ² − E)·p + λ²·S + C − (1 − B − D)·p_prev ] / (1 + B + D)
```

| Symbol | Meaning |
|---|---|
| p, p_prev, p_next | The cell's current, previous, and next pressure |
| K | The number of the four neighbors (up, down, left, right) that are air (0–4) |
| S | The sum of the pressures of the neighbors that are air |
| B | (λ/2) × "the sum of β over neighbors that are wall." β is the material's absorption strength (section 5.4) |
| D | σ·Δt. σ is the damping strength, the sum of the absorbing layer (section 5.3) and floor (section 5.5) values |
| E, C | Terms used only inside the outer absorbing layer (section 5.3). 0 outside the layer |

Check: where there are no walls and no damping, K = 4 and B = D = E = C = 0, which matches the standard rule `p_next = 2p − p_prev + λ²(S − 4p)`.

K, B, and D are recomputed on the CPU only when walls are redrawn, and sent to the GPU. E and C depend only on the cell's position, so they are computed on the GPU.

S may be computed as the sum of the pressures of all four neighbors, since a wall cell's pressure is always 0.

When walls are redrawn, the pressure field is edited at the same moment, in both the current and the previous field (found in M1; `CellChanges` in `src/sim/sim.ts`):

1. Cells that became wall are set to 0 at once.
2. Cells that became air are filled smoothly from the air around them. From each freed cell, look left, right, up and down for the nearest air cell that was not freed (at most 32 cells, and not through a wall). Take the mean of those values weighted by 1 / distance, then smooth it with 32 sweeps that set every freed cell to the mean of its air neighbours.
3. Steps 1 and 2 change the sum of the field. The difference is spread evenly over all air cells, so the sum stays what it was.

Why: a uniform offset is a steady state of this rule, because D, B and the absorbing layer all act on change over time only. Before these steps, every edit left behind a small offset, from the cut-out wall cells and from one step in which neighbours read a new wall's old pressure. The automatic gain then showed the offset as a tint over the whole picture. A freed cell that started at 0 left a hole of silence in the sound, whose sharp edges rang at the scale of the grid. After a sounding room's walls were cleared, 98% of what remained was that ringing; with the fill, 19%. The CPU reference and the GPU do the same steps, and M0's criterion 4 scene now includes a wall edit (`docs/measurements.md`).

### 5.3 Outer absorbing layer

So that waves leaving the domain don't come back, the outer 24 cells form an absorbing layer.

- `σ(d) = σ_max · (d / 24)²`, where d is the depth (in cells) from the layer's inner edge. Compute it separately for the x and y directions (σx, σy), and put their sum into D. In the corners, both apply.
- `σ_max·Δt = 0.15` (finalized in M0).
- The outermost edge of the domain is treated as a wall with β = 1.
- The layer is a matched layer (PML). Layer cells carry the particle velocity v (multiplied by ρc) through their right and bottom faces, updated half a step offset from the pressure.

```
v_next = [ (1 − s)·v − λ·(p_far − p_near) ] / (1 + s)        s is σ·Δt at that face

E = 4·sx·sy
C = λ·[ (sx_R − sy)·(v_R + v_R,next) − (sx_L − sy)·(v_L + v_L,next)
      + (sy_B − sx)·(v_B + v_B,next) − (sy_T − sx)·(v_T + v_T,next) ]
```

| Symbol | Meaning |
|---|---|
| sx, sy | σ·Δt in the x and y directions at the cell center |
| sx_R, sx_L, sy_B, sy_T | σ·Δt at the cell's right, left, bottom, and top faces |
| v_R, v_L, v_B, v_T | The velocity through the four faces. 0 on faces touching a wall (the wall's absorption is handled entirely by B) |
| p_far − p_near | The pressure difference between the two cells on either side of the face (right or bottom cell − left or top cell) |

For a layer in only one direction, this rule is exactly the same as Berenger's split-field PML. Cells touching the layer's inner edge (the first cell outside the layer) are also updated with this rule, since one of their faces lies in the layer.

What M0 found (numbers in `docs/measurements.md`):

- The original plan was a layer with damping (D) only. That can't meet −30 dB. To low frequencies, a damping-only layer looks just like a wall: with σ_max·Δt = 0.15 it reflects as much as −4 dB at 63 Hz. Lowering σ_max makes high frequencies bounce off the β = 1 wall instead (−16 dB at 4 kHz, because the wall rule in section 5.4 is first-order accurate). For every σ_max, some band exceeded −30 dB.
- With a matched layer of the same thickness and the same σ_max, normal-incidence reflection is −70 dB or below across all bands. Oblique reflection is −64 dB up to 45°, −53 dB at 60°, and −31 dB at 75°.
- It stays stable even with walls crossing the layer (confirmed over 200,000+ steps).

### 5.4 Wall materials

Materials are defined by the absorption coefficient α (0–1). The reflection coefficient for a wave hitting head-on is `R = √(1 − α)`, and the value used in the update rule is `β = (1 − R) / (1 + R)`.

α = 0 is a perfectly reflecting wall; α = 1 is the same as an opening that lets the wave through.

Values from M1, with sources in `THIRD_PARTY.md`. Each α is the mean of the published octave-band values at 250, 500, 1000 and 2000 Hz (the bands of the NRC, without its rounding to 0.05):

| Material | Display name | α | Measured specimen |
|---|---|---|---|
| concrete | Concrete / tile | 0.0175 | Smooth unpainted concrete |
| glass | Glass | 0.0375 | Glass window, 0.68 kg/m² |
| plaster | Plasterboard | 0.06 | 2 × 13 mm plasterboard on steel frame, mineral wool in cavity, painted |
| wood | Wood panel | 0.175 | Wooden lining, 12 mm, on frame |
| curtain | Heavy curtain | 0.5625 | Cotton curtains, 0.5 kg/m², draped, 130 mm from the wall |
| foam | Acoustic foam | 0.7775 | Wedge-shaped melamine foam |

The provisional values were 0.02, 0.05, 0.08, 0.10, 0.55 and 0.90. Acoustic foam moved the most (0.90 → 0.78), and its reflection coefficient goes from 0.32 to 0.47.

Absorption actually varies with frequency, but this idea represents it with a single value.

M0 measurement: the wall rule is first-order accurate, and the reflection coefficient drifts from the set value as the wavelength approaches the grid spacing. Up to 1 kHz the drift is 0.005 or less. At 4 kHz, the reflection coefficient of an α = 0.9 wall is 0.36 (set value 0.32), and even α = 1 leaves 0.16. This is within the ±0.05 criterion.

### 5.5 Approximating the floor and ceiling

The 2D computation has no floor or ceiling, so as-is the reverberation would be far too long. Add the absorption by the floor and ceiling as damping uniform over the whole room.

```
σ_floor = 42.9 × (α_floor + α_ceiling) / H    [1/s]
```

- H is the ceiling height, fixed at 2.4 m.
- α_ceiling is fixed at 0.05.
- α_floor is set by the "Floor" choice: Tile 0.015, Wood 0.0525, Carpet 0.4325, Tatami 0.395 (M1; sources in `THIRD_PARTY.md`). The provisional values were 0.02, 0.08 and 0.30. Tatami is read off a chart in a Kumamoto Prefecture report (tatami with a 50 mm rice-straw core), to about ±0.01.
- This formula is the floor-and-ceiling part extracted from Sabine's reverberation-time formula.

### 5.6 Sound sources

- Add values into the source cell and the cells within a radius of 2 cells around it, with Gaussian weights. The weights have a standard deviation of 1 cell and are normalized so the 13 cells sum to 1. Nothing is added into wall cells.
- **Clap (for display)**: one Ricker wavelet with a center frequency of 800 Hz.
- **Tone**: a continuous sine wave. Frequency via a 50–2000 Hz slider. On start, the volume ramps up over 20 ms.
  - M1: a box next to the slider takes an exact frequency (71.5 Hz for the M1 check). The tone also fades out over 20 ms, and keeps its phase when the frequency changes.
  - The source value is `3.0·√(ω·Δt)·sin(ω·t)`. A 2D source of amplitude ω·Δt gives a field that grows as √f (measured: 50 Hz is 6.2 times weaker than 2 kHz), so this keeps the tone near the level of a clap at 1 m at every frequency.
- **For recording the response**: a short pulse band-limited at 4 kHz (windowed sinc, 129 points).

### 5.7 Recording the response

- Every step, write the pressure at the listening position's left and right ears (two cells 17 cm apart) to a buffer on the GPU. Read it back to the CPU only once, at the end of recording.
- The default length is 1.0 s (48,000 steps). Stop early once the energy drops −60 dB from its maximum. The cap is 2.0 s.
- During recording, the display source and Tone are stopped.

### 5.8 Correcting the response

In a 2D computation, even a sharp pulse produces a received waveform with a trailing tail (this doesn't happen in 3D space). There is also a timbral bias from how the source is added in. Both are removed together by a free-field calibration.

1. In a field with only the absorbing boundary and no walls, record the response at a point 1 m from the source.
2. Find the filter that, "applied to this response, turns it back into the recording pulse of section 5.6 itself" (division in the frequency domain over 200 Hz–4 kHz, with regularization to avoid dividing by 0).
3. Bundle this filter as a constant, and apply it to every recorded response.

Calibration is done once, at development time. Redo it if the grid spacing changes.

### 5.9 Listening

- Audio is handled with Web Audio. The `AudioContext` is created at 48 kHz.
- Split the source sound into two bands at 3.5 kHz.
  - **Low band**: convolve with the corrected response using a `ConvolverNode`. Set `normalize` to false and match levels myself (so the direct sound at 1 m in free field has a constant level).
  - **High band**: this band can't be computed, so use a synthesized response: the direct sound (with delay and attenuation by distance) plus exponentially decaying noise. The decay rate is 0.8 times the 2–4 kHz decay time of the computed response.
- Make the high-band fill-in switchable, and decide the default by listening comparisons in M2.
- Place a limiter (`DynamicsCompressorNode`) just before the output.
- Source sounds: bundle four — a clap, a snare, a short spoken phrase, and a guitar. Make them myself or use only CC0 sounds. With "Your mic," a 3-second recording from the microphone can also be used.

## 6. Structure

```
src/
  sim/                 Computation that never touches the DOM
    grid.ts            Constants, sizes
    sim.ts             Interface shared by the reference implementation and the GPU version
    reference.ts       CPU version of the update rule (reference implementation)
    geometry.ts        Cells → K, B, and D; σ of the absorbing layer
    walls.ts           Wall lines in cm: cells, erasing, snapping, hit tests
    materials.ts       Material table with sourced band values, α → β
    display.ts         Automatic gain, display speed, readout text
    sources.ts         Source signals and weights
    analysis.ts        FFT, peak detection
    experiments.ts     Scenes that check M0's "Done when" criteria (shared by the reference and GPU versions)
    rng.ts             Seeded random numbers
    ir.ts              Calibration filter, band splitting, decay curve, RT60 (M2)
  gpu/
    solver.ts          WebGPU computation
    render.ts          Display (Wave, Relief, Energy), loudest-cell search for the gain
    shaders/*.wgsl     step (update rule), edit (wall changes), view, reduce
    fallback/          WebGL2 version (display only)
  bench/               Measurement page (/bench)
  app/engine.ts        Display loop: follows the store, steps the solver, draws (M1)
  audio/engine.ts      Playback, convolution, recording
  ui/                  React components
  state/               store.ts, stats.ts, defaultScene.ts, url.ts (M3)
public/presets/*.json  Prepared rooms
```

Data flow:

```
Wall lines, materials ──▶ geometry.ts ──▶ K, B buffers ─┐
                                                        ▼
Source signal ───────────────────────────────────▶ solver (GPU) ──▶ render ──▶ canvas
                                                        │
                                                        └▶ ear pressure recording ──▶ ir.ts ──▶ audio ──▶ speakers
```

Decisions to fix for the GPU implementation:

- Sound pressure is held in three 32-bit float arrays (previous, current, next), whose roles rotate each step.
- The face velocities of the absorbing layer (section 5.3) are held in two arrays of two components per cell, swapped each step. Combined with the three pressure arrays, that makes six combinations. Only layer cells read and write these values.
- While displaying, run a few steps per frame; while recording, run a few hundred steps per frame in one batch.
- Values that change each step (the step number, the source value) must be passed correctly even when steps are batched. Note that rewriting the same uniform midway is not reflected in a batched run. M0 implementation: write ahead into a buffer laid out as one 256-byte slot per step, and select the slot each step with a dynamic offset. At most 512 steps per batch.
- On devices without WebGPU, use WebGL2 at half the grid resolution for display only, and show "Listening needs WebGPU."

State stored in the URL:

```json
{ "v": 1, "size": "M",
  "walls": [ { "a": [x, y], "b": [x, y], "m": "plaster" } ],
  "floor": "wood", "src": [x, y], "lis": [x, y, angleDeg],
  "view": "wave", "relief": true }
```

Coordinates are integers in cm.

## 7. Milestones

### M0 The computational core

What to build: the reference implementation, the WebGPU implementation, and a measurement page (`/bench`). No UI components.

Done when:

1. In a field with no walls, a pulse spreads in a circle and vanishes at the outer edge. Reflection from the outer edge is −30 dB or below for waves entering head-on.
2. In a 4.0 m × 3.0 m room enclosed by perfectly reflecting walls, the lowest five eigenfrequencies match the theoretical `f = (c/2)·√((m/Lx)² + (n/Ly)²)` within 1% (theoretical values: 42.9, 57.2, 71.5, 85.8, 103.1 Hz).
3. The reflection coefficient of a wave hitting a wall of absorption α head-on matches `√(1 − α)` within ±0.05 (α = 0.1, 0.5, 0.9).
4. The GPU version and the reference implementation agree on a 64 × 64 grid after 1,000 steps (the maximum difference is at most 1e-4 of the maximum amplitude).
5. Steps per second are measured and recorded for S, M, and L.

Decision: if 48,000 steps at size M take 30 seconds or less, proceed as is. If they take longer, consider coarsening the grid for listening only (Δx doubled, band about 2 kHz) and correct the spec.

Results (2026-11-16, Apple M3, Chrome 157; details in `docs/measurements.md`):

| Criterion | Measured | Verdict |
|---|---|---|
| 1 Outer-edge reflection | −70 dB or below head-on (all bands, 63 Hz–4 kHz). The absorbing layer was changed to a matched layer (section 5.3) | Met |
| 2 Eigenfrequencies | 42.86, 57.14, 71.43, 85.71, 103.02 Hz. Maximum error 0.05% | Met |
| 3 Wall reflection coefficient | 0.949, 0.708, 0.320 for α = 0.1, 0.5, 0.9 (theory 0.949, 0.707, 0.316) | Met |
| 4 GPU version vs. reference | Maximum difference is 3.9e-6 of the maximum amplitude | Met |
| 5 Speed | S about 17,000, M about 7,100, L about 2,700–3,000 steps/s | Recorded |

Outcome of the decision: 48,000 steps at M take about 6.7 seconds. Proceed as is without coarsening the grid.

Notes on how it was checked:

- "Head-on" in criteria 1 and 3 is measured in a 1-cell-wide corridor between perfectly reflecting walls. The wave in the corridor becomes a plane wave hitting the end wall head-on.
- Criterion 3's reflection coefficient is the square root of the ratio of reflected to incident energy of the 800 Hz clap waveform. The ratio of waveform peaks comes out about 0.7% lower because of waveform distortion during the round trip across the grid.

### M1 Draw and see

What to build: the wall editor, materials, floor, Wave and Relief and Energy, Clap and Tone, automatic gain.

Done when:

1. A floor plan about the size of my own room (about 10 walls) can be drawn within 5 minutes.
2. From the frame right after walls are redrawn, waves respond to the new walls.
3. Changing a material from Concrete to Acoustic foam makes the weaker reflection visibly clear in the Wave view.
4. Playing Tone at 71.5 Hz in a 4.0 m × 3.0 m room makes a diagonal standing-wave pattern appear in the Energy view.
5. At size M, the display holds 60 fps (on the development machine).

Results (2026-11-27, Apple M3, Chrome 158; details in `docs/measurements.md`):

| Criterion | Measured | Verdict |
|---|---|---|
| 1 Drawing a room | A 10-wall plan (bedroom, closet, entry hall) is 10 drags with the mouse. Ends snap to existing ends, onto walls, to horizontal/vertical, and to 5 cm. Corners close exactly. To be confirmed by hand | Met (by script) |
| 2 New walls respond at once | Store changes apply before the next frame's steps. The first frame after drawing a wall reads exactly 0 in every cell of the wall (pressure there was 0.117 just before) | Met |
| 3 Concrete vs. foam | The reflected peak from foam is 0.478 of concrete's (theory √(1 − 0.7775) / √(1 − 0.0175) = 0.476). Screenshots side by side | Met |
| 4 Tone at 71.5 Hz in 4.0 × 3.0 m | After 1 s the (1, 1) mode stands: corners 29 dB louder than the two nodal lines. The Wave view shows the diagonal checkerboard (opposite corners in phase). At 57.2 Hz the same comparison gives 7 dB | Met |
| 5 60 fps at M | 58–59 fps, equal to or above a page that only clears a WebGPU canvas (56–58 fps on the same machine at the same time); 0 frames waited for the GPU; GPU time 5 ms per 16.7 ms frame. Size L: 60 fps | Met within what the machine gives |

Notes on how it was checked:

- Criterion 4: "diagonal" is read as the (1, 1) mode. Its pressure has the same sign in opposite corners (the diagonal pattern of the Wave view), and its energy is high in the four corners with a dark cross through the middle (the Energy view).
- Criterion 5: on this machine at the time, even an empty WebGPU page dropped to 56–58 fps. In both cases the drops are pauses of the browser's main thread of 50–170 ms, a few per 10 seconds. The app never waits for the GPU, and its per-frame work takes 5 ms of GPU and about 1 ms of main thread. M1 takes care to keep that work small: the readout is written straight into the DOM rather than through React, the maxima are read back every 4th frame, and the loop reuses its objects.

### M2 Listen

What to build: response recording, calibration, listening, the high-band fill-in, left and right ears, the four source sounds, microphone recording, the response strip.

Done when:

1. After calibration, the frequency response in free field at 0.5 m, 1 m, and 2 m stays within ±3 dB over 200 Hz–4 kHz.
2. A room with a Tile floor and a room with a Carpet floor show different RT60 values and sound audibly different.
3. Putting a wall between the source and the listening position weakens the direct sound.
4. "Dry," "This room," and "Snapshot" can be switched without stopping the sound.
5. The sound doesn't clip (the limiter is working).

### M3 Finishing

What to build: six prepared rooms (Empty box, Bedroom, Bathroom, Tatami room, Long corridor, Two rooms with a door), Tour, Explain, URL sharing, an image underlay (load a floor-plan image, click two points and enter the real distance, then trace), mobile support, the WebGL2 fallback display, launch.

Done when:

1. A first-time visitor can make their first wave within 1 minute without reading any instructions.
2. Opening a shared URL on another device gives the same floor plan, materials, source, and listening position.
3. On a 360px-wide phone, you can draw walls and clap.

## 8. Limits stated on screen (Explain → "What is simplified")

- The computation is 2D, with no reflections off the ceiling and floor. The floor and ceiling are approximated as uniform damping.
- It computes correctly only up to about 4 kHz. Higher frequencies are filled in with synthesized reverberation.
- Wall absorption is represented by a single value independent of frequency.
- Sound transmitted through walls is not computed.
- Results are approximate and don't match measurements of real rooms.

## 9. Extensions (outside the MVP)

- Drag along the response waveform to replay the wave field at that moment (recomputing the first 100 ms).
- Put two floor plans side by side and play them at the same time.
