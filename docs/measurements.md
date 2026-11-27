# Measurement log

Measured speed and accuracy values, recorded with the date, device, and browser (common spec, section 3, item 5). When they disagree with the spec's estimates, the measurements are the truth and the spec is corrected.

## M0 The computational core (2026-11-16)

### Conditions

| Item | Details |
|---|---|
| Device | Apple M3 (8-core CPU, 10-core GPU), macOS 27.0.1 |
| Browser | Google Chrome 157.0.8103.79, launched headless from Playwright 1.65.1 |
| GPU | WebGPU adapter `apple / metal-3` (integrated GPU) |
| Reference implementation | Node 24.11.1 |
| Load | A video call was running on the device during measurement (load average 4–6). Speed values are lower than on an idle device |

How to reproduce:

- Criteria 1–3 (reference implementation): `pnpm test`
- Criteria 1–5 (GPU version): `pnpm test:e2e`. Results go to `test-results/bench-results.json` and images to `docs/screenshots/`. To look by hand, run `pnpm dev` and open `/bench/`
- Absorbing-layer comparison: `pnpm tsx scripts/tune-absorber.ts`, `pnpm tsx scripts/absorber-2d.ts`
- Per-band wall reflection coefficients: `pnpm tsx scripts/wall-reflection.ts`
- Reference implementation speed: `pnpm tsx scripts/reference-speed.ts`

### Done-when criteria

| Criterion | Condition | Reference implementation | GPU version | Verdict |
|---|---|---|---|---|
| 1 Outer-edge reflection (head-on) | −30 dB or below | Worst −70.3 dB | Worst −70.3 dB | Met |
| 2 Eigenfrequencies (4.0 m × 3.0 m) | Within 1% | Max error 0.047% | Max error 0.043% | Met |
| 3 Wall reflection coefficient (head-on) | Within ±0.05 | Max error 0.004 | Max error 0.004 | Met |
| 4 GPU version vs. reference (64 × 64, 1,000 steps) | At most 1e-4 of the maximum amplitude | — | 3.9e-6 | Met |
| 5 Speed | Record it | — | Table below | Recorded |
| Decision | 48,000 steps at M within 30 seconds | — | 6.2–6.8 seconds | Proceed as is |

Criterion 1 breakdown (GPU version; the difference from the reference implementation is 1.3 dB in the 63 Hz band and within 0.1 dB elsewhere):

| Incident wave | Reflection |
|---|---|
| Clap (800 Hz Ricker wavelet), peak ratio | −73.6 dB |
| Recording pulse (sinc band-limited at 4 kHz), peak ratio | −77.5 dB |
| 63 / 125 / 250 / 500 Hz bands | −75.3 / −74.1 / −73.9 / −73.8 dB |
| 1 / 2 / 4 kHz bands | −73.3 / −71.8 / −70.3 dB |

The pulse spreads in a circle and vanishes at the outer edge:

- 290 steps after the clap, the wavefront radius is 135.0 cells along the axes and 135.8 cells along the diagonals. The amplitude difference is within 2%.
- After 1,500 steps, the pressure remaining in the field is −89.6 dB relative to the wavefront peak (420 × 420 cells).
- Images: `screenshots/m0-free-field-step-150.png`, `-300.png`, `-450.png`, `-600.png`, `-1400.png`. At 450 it enters the top and bottom edges, at 600 only the four corners remain, and at 1400 nothing is visible.

Criterion 2 breakdown (GPU version, 1.0 s recorded):

| | (1,0) | (0,1) | (1,1) | (2,0) | (2,1) |
|---|---|---|---|---|---|
| Theory [Hz] | 42.88 | 57.17 | 71.46 | 85.75 | 103.06 |
| Measured [Hz] | 42.86 | 57.14 | 71.43 | 85.71 | 103.02 |

The measured values are about 0.04% low because the room is rounded to whole cells (392 × 294 cells = 4.002 m × 3.001 m).

Criterion 3 breakdown (the GPU version and reference implementation give the same values):

| α | Theory √(1 − α) | Measured (energy ratio) | Measured (peak ratio) |
|---|---|---|---|
| 0.1 | 0.9487 | 0.9489 | 0.9419 |
| 0.5 | 0.7071 | 0.7085 | 0.7033 |
| 0.9 | 0.3162 | 0.3197 | 0.3178 |

### Speed (GPU version)

Measured the steps after one clap in a field with no walls. 512 steps are submitted as one batch, waiting for completion after each batch. The values of three runs are listed.

| Size | Cells | Steps/s | Speed relative to real time |
|---|---|---|---|
| S (588 × 441) | 259,308 | 16,909 / 17,297 / 16,407 | 0.34–0.36× |
| M (784 × 588) | 460,992 | 7,080 / 7,148 / 7,774 | 0.15–0.16× |
| L (1176 × 882) | 1,037,232 | 2,987 / 2,691 / 3,042 | 0.06× |

- 48,000 steps at M (a 1.0 s response): 6.78 / 6.71 / 6.17 seconds. About 1/4.5 of the 30-second criterion.
- 48,000 steps at L: expected to take about 16–18 seconds (converted from the values above).
- Against the speed needed for display (1/120 of real time, 400 steps per second), M has about 18× headroom. This is an estimate from batched submission. The value when submitting a few steps per frame while also rendering will be measured in M1.

Reference implementation (CPU, single thread) speed:

| Size | Steps/s |
|---|---|
| S | 340 |
| M | 197 |
| L | 97 |

At M, the GPU version is about 36–39× the reference implementation.

### Outer absorbing layer (the basis for changing spec section 5.3)

Head-on reflection [dB], measured in a 1-cell-wide corridor with a 24-cell layer and a β = 1 wall at the end (reference implementation).

Damping-only layer (the original spec):

| σ_max·Δt | Clap | 63 Hz | 125 Hz | 250 Hz | 500 Hz | 1 kHz | 2 kHz | 4 kHz |
|---|---|---|---|---|---|---|---|---|
| 0 (β = 1 wall only) | −28.2 | −49.9 | −44.0 | −38.0 | −31.9 | −25.9 | −19.9 | −16.0 |
| 0.003 | −27.0 | −30.0 | −29.8 | −29.0 | −27.5 | −24.9 | −20.0 | −16.4 |
| 0.02 | −21.1 | −15.1 | −15.2 | −15.8 | −17.8 | −21.6 | −21.0 | −18.6 |
| 0.05 | −18.4 | −9.2 | −9.4 | −10.2 | −13.1 | −20.5 | −23.5 | −22.8 |
| 0.15 (the spec's initial value) | −17.4 | −4.3 | −4.7 | −6.0 | −10.2 | −23.3 | −35.7 | −37.5 |
| 0.3 | −14.8 | −2.6 | −3.1 | −4.8 | −9.3 | −18.8 | −41.0 | −58.0 |

For every σ_max, some band exceeds −30 dB. There are two reasons.

- A damping-only layer doesn't match the impedance of air. To sound with a wavelength much longer than the layer's thickness (24.5 cm), the whole layer looks like a single wall. This reflection gets stronger the higher σ_max is.
- With only the β = 1 wall, low frequencies are absorbed well but high frequencies bounce back. That's because the wall rule (spec section 5.4) is a first-order formula that treats the wall position as offset by half a cell. The reflection increases in proportion to frequency (6 dB per octave).

Matched layer (adopted):

| σ_max·Δt | Clap | 63 Hz | 125 Hz | 250 Hz | 500 Hz | 1 kHz | 2 kHz | 4 kHz |
|---|---|---|---|---|---|---|---|---|
| 0.02 | −35.3 | −44.4 | −43.8 | −42.0 | −38.1 | −32.9 | −27.2 | −23.4 |
| 0.05 | −43.8 | −47.5 | −47.4 | −47.0 | −45.6 | −42.5 | −37.8 | −34.5 |
| 0.10 | −58.3 | −59.5 | −59.5 | −59.4 | −59.0 | −57.8 | −55.0 | −52.6 |
| **0.15 (adopted)** | −73.5 | −74.0 | −73.9 | −73.8 | −73.8 | −73.3 | −71.8 | −70.3 |
| 0.20 | −89.2 | −88.5 | −88.2 | −88.4 | −89.5 | −89.1 | −88.2 | −87.4 |
| 0.30 | −108.8 | −99.0 | −102.4 | −104.6 | −111.2 | −106.5 | −99.9 | −95.3 |

Oblique reflection [dB]. In a 2D field, a clap hits the bottom edge at an angle, and the difference from the result in a sufficiently large field is taken as the reflection (reference implementation):

| Layer | 0° | 30° | 45° | 60° | 70° | 75° |
|---|---|---|---|---|---|---|
| **Matched layer, σ_max·Δt = 0.15 (adopted)** | −63.7 | −63.9 | −64.1 | −52.8 | −39.3 | −30.6 |
| Matched layer, 0.10 | −52.7 | −53.4 | −50.2 | −39.6 | −28.9 | −22.3 |
| Matched layer, 0.25 | −86.8 | −82.4 | −80.6 | −79.1 | −59.4 | −46.5 |
| Damping only, 0.15 (the original spec) | −17.2 | −15.8 | −13.8 | −10.3 | −7.1 | −5.4 |
| No layer (β = 1 wall only) | −27.5 | −25.8 | −22.1 | −15.5 | −10.4 | −7.8 |

σ_max·Δt was left at the spec's initial value of 0.15. It has 40 dB of headroom against the criterion. Raising it to 0.25 lowers oblique reflection by another 15 dB or more, so if reflections of waves traveling along the edges become noticeable from M1 on, there is room to raise it.

Long-run stability (120 × 120 cells, with 15 walls of different materials, many of them crossing the layer; reference implementation):

| Elapsed | Maximum pressure in the field |
|---|---|
| Right after the clap (300 steps) | 6.4e-2 |
| 3,000 steps | 4.3e-7 |
| 30,000 steps | 4.9e-10 |
| 100,000 steps | 1.5e-10 |
| Then a continuous 440 Hz tone for 20,000 / 60,000 / 100,000 steps | 1.11 / 0.62 / 1.23 |

After the clap it stays silent, and with a continuous tone it doesn't keep growing (the values fluctuate because of the tone's phase). Before the script was shortened, it was also checked once with 300,000 silent steps and 200,000 steps at 440 Hz (about 10 seconds in total). The results were the same: 1.5e-10 at the end of silence, and 1.11–1.23 after the tone.

### Frequency dependence of wall reflection (spec section 5.4)

Head-on reflection coefficient measured per band (reference implementation).

| α | Set value | 63 Hz | 125 Hz | 250 Hz | 500 Hz | 1 kHz | 2 kHz | 4 kHz |
|---|---|---|---|---|---|---|---|---|
| 0 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| 0.02 | 0.990 | 0.990 | 0.990 | 0.990 | 0.990 | 0.990 | 0.990 | 0.991 |
| 0.1 | 0.949 | 0.949 | 0.949 | 0.949 | 0.949 | 0.949 | 0.950 | 0.952 |
| 0.5 | 0.707 | 0.707 | 0.707 | 0.707 | 0.708 | 0.709 | 0.715 | 0.726 |
| 0.9 | 0.316 | 0.316 | 0.316 | 0.317 | 0.318 | 0.321 | 0.336 | 0.363 |
| 1 | 0.000 | 0.003 | 0.006 | 0.013 | 0.025 | 0.051 | 0.101 | 0.158 |

The more absorbent the wall, the more it reflects above its set value at high frequencies. An α = 1 wall is not "the same as an opening" at 4 kHz (reflection coefficient 0.16). Openings are made by erasing walls (Erase), so this difference doesn't show up in practice. If high-frequency reverberation feels too long in M2, suspect this.

### Where the spec's estimates were wrong

1. **The outer absorbing layer couldn't meet the criterion by tuning σ_max.** The layer was changed to a matched layer (PML). Layer cells carry two face velocities, and the update rule gains the E and C terms. Layer thickness, σ profile, σ_max, and the outermost β = 1 are as in the spec. Spec sections 5.2, 5.3, and 6 were rewritten.
2. **Two more GPU arrays.** In addition to the three pressure arrays, there are two arrays of layer velocities (two components per cell). Memory grows by 7.4 MB at M and 16.6 MB at L. The effect on speed is included in the measurements above.
3. **There was headroom in speed.** 48,000 steps at M take about 6.7 seconds, less than 1/4 of the estimate's upper bound (30 seconds). The coarser-grid option isn't needed.
4. **The wall rule turned out to be first-order accurate.** The reflection coefficient drifts from the set value at high frequencies (table above). Criterion 3 is met.
5. **Criterion 3's reflection coefficient is measured by energy ratio, not peak ratio.** The peak ratio comes out 0.7% low because of waveform distortion during the round trip across the grid (0.9926 for a perfectly reflecting wall). Either way of measuring stays within ±0.05.
6. **The handling of the absorbing layer's corners was decided.** The spec didn't define σ at the corners. It was set to the sum of the x- and y-direction σ.
7. **TypeScript was set to 6.0.3.** The current release is 7.0.2, but typescript-eslint (8.72) supports only up to the 6.0 line.

## M1 Draw and see (2026-11-27)

### Conditions

| Item | Details |
|---|---|
| Device | Apple M3 (8-core CPU, 10-core GPU), macOS 27.0.1 |
| Browser | Google Chrome 158.0.8127.88 (updated since M0), launched headless from Playwright 1.65.1, window 1280 × 900 at device pixel ratio 1 |
| GPU | WebGPU adapter `apple / metal-3` |
| Load | Load average 2–3 with other applications open (no video call this time) |

How to reproduce: `pnpm test:e2e`. The values go to `test-results/app-results.json` (the site) and `test-results/bench-results.json` (the M0 checks), and the images to `docs/screenshots/m1-*.png`.

### Done-when criteria

| Criterion | Measured | Verdict |
|---|---|---|
| 1 A floor plan of about 10 walls within 5 minutes | Playwright draws a 10-wall plan (a bedroom with a closet, a window and an entry hall) with 10 mouse drags. Every end lands within 5 cm of where it was aimed, and corners close exactly through snapping. Cutting an 80 cm opening with the eraser and undoing it also works. Whether a person does it within 5 minutes is left to try by hand | Met by script |
| 2 Waves respond from the frame after an edit | Pressure in the cells of a new wall: 0.117 before the edit, exactly 0 in every cell on the first displayed frame after it. Store changes are applied before the next frame's steps are submitted | Met |
| 3 Concrete → acoustic foam visibly weaker | Peak of the reflected wave, 0.6 m in front of the source: 0.0641 from concrete, 0.0307 from foam, a ratio of 0.478. Theory √(1 − 0.7775) / √(1 − 0.0175) = 0.476. Screenshots `m1-reflection-concrete.png` and `m1-reflection-foam.png` | Met |
| 4 Tone at 71.5 Hz in a 4.0 × 3.0 m room | After 1 s of tone (concrete walls, wood floor, source near a corner), the energy in three corners is 29.0 dB above the energy on the two centre lines. At 57.2 Hz (the (0, 1) mode) the same comparison gives 6.9 dB. Screenshots `m1-energy-71hz.png` and `m1-wave-71hz.png` | Met |
| 5 60 fps at size M | 58.0 fps; an empty WebGPU page measured just before gave 56.4 fps. No frame waited for the GPU. GPU time per frame 4.8 ms median, 6.4 ms 95th percentile | Met within what the machine gives (below) |

### Frame rate (criterion 5)

| Page | Frames per second (10 s) | Gaps over 25 ms | GPU time per frame, median / 95th percentile |
|---|---|---|---|
| Empty page that only clears a WebGPU canvas | 56.4 | 8 | — |
| Room Echo, size M, Wave + Relief | 58.0 | 7 | 4.8 / 6.4 ms |
| Room Echo, size M, Energy | — | — | 4.9 / 6.9 ms |
| Room Echo, size L, Wave + Relief (6 s) | 60.0 | 0 | 6.8 / 9.5 ms |

What the drops are:

- Every drop was a pause of the browser's main thread of 50–170 ms, a few times per 10 seconds. A Chrome trace showed them inside the frame callback, but no WebGPU call took longer than 3.7 ms. Even pure arithmetic once took 10 ms, a 2 MB garbage collection took 12–30 ms (normally about 1 ms), and laying out the page took 38 ms. The whole main thread was being slowed down.
- The same drops appear in a visible Chrome window: 56.5–58.5 fps, with gaps of 100–200 ms.
- An empty WebGPU page drops frames the same way on this machine, as in the table. So the app is judged against it: the app must keep the machine's frame rate and never wait for its own GPU work.

Changes made while measuring:

| Change | Before | After |
|---|---|---|
| The readout under the picture is written straight into the DOM, not re-rendered by React 60 times a second | 9 gaps per 8 s | 5–6 |
| Maxima for the gain are read back every 4th frame, and the loop reuses its objects | | |
| Up to 3 frames may be in flight before the loop skips one (it was 2). Queue stalls of up to 55 ms happened, while a frame takes about 3–5 ms | frames skipped for the GPU | none |
| Result | the app at 55–61 fps, below the empty page | the app equal to or above the empty page (58.0 vs. 56.4; earlier runs 58.5 vs. 58.3–58.8) |

### Display levels (`scripts/display-levels.ts`)

Free field, CPU reference, 320 × 320 cells, recorded 1 m from the source.

| Source | Value at 1 m |
|---|---|
| Clap (Ricker 800 Hz, amplitude 1), peak | 0.1027. This is the reference of the automatic gain: "Gain ×1" |
| Tone with source value ω·Δt·sin(ω·t), amplitude | 50 Hz 0.00274 · 100 Hz 0.00396 · 200 Hz 0.00561 · 400 Hz 0.00793 · 1 kHz 0.0124 · 2 kHz 0.0169 |

The tone's level grows as √f (2 kHz / 50 Hz = 6.16, against √40 = 6.32). The tone's source value is therefore `3.0·√(ω·Δt)·sin(ω·t)`, which gives about 0.10 at 1 m at every frequency, the same as a clap.

### Wall edits while sound plays (spec 5.2)

Found while checking the screenshots: after "Clear walls" in the sounding bedroom, the picture filled with a striped texture and a uniform tint, at Gain ×26.

Roughness: the share of the field's energy at the scale of the grid (the 5-point Laplacian of p, squared, over p squared), size M on the GPU. The walls were cleared 600 steps after a clap.

| Scenario | After 1000 steps | After 2600 steps |
|---|---|---|
| Bedroom, no edit | 0.12 % (max 0.178) | 0.12 % (max 0.062) |
| Walls cleared, freed cells start at 0 (before) | 0.25 % (max 0.055) | 98 % (max 0.0013) |
| Walls cleared, freed cells filled (after) | 0.007 % (max 0.064) | 19 % (max 0.00014) |
| Walls added instead | 0.18 % | 0.24 % |

Uniform offset: CPU reference, 180 × 180 cells, a closed plasterboard box with a clap inside. After 400 steps the box is removed and a concrete wall is drawn where the sound is. Values relative to the peak at the moment of the edit:

| Edit | After 1000 steps: max / mean | After 4000 | After 12000 |
|---|---|---|---|
| Clear, fill, keep the sum (adopted) | 5.5e-3 / 9.1e-4 | 1.6e-3 / 3.0e-4 | 4.9e-4 / 1.0e-4 |
| Clear and fill, sum not kept | 7.5e-3 / 3.6e-3 | 2.0e-3 / 8.4e-4 | 6.5e-4 / 2.7e-4 |
| As in M0 (stale read for one step, freed cells at 0) | 1.4e-2 / 6.5e-4 | 5.7e-3 / 1.5e-4 | 1.3e-3 / 5.0e-5 |
| No walls at all, for comparison | 1.2e-3 | 3.3e-5 | 1.4e-6 |

- A uniform offset is a steady state of the update rule: D, B and the absorbing layer act on change over time only. So every edit that changes the field's sum leaves an offset that never leaves. The adopted edit keeps the sum.
- What still drains slowly is low sound that was stored in the closed box. It halves about every 3000–8000 steps.
- On screen, with the gain capped at ×100, the remainder after clearing a sounding room fades to near-black within a few seconds of display time.
- "Clear walls" also silences the field now, as a fresh start.

GPU against the CPU reference, criterion 4's scene with a wall edit at step 500 (a block removed and another added): the largest difference is 2.3e-6 of the peak, and 2.6e-6 for the energy average (limit 1e-4).

### Materials (spec 5.4, 5.5)

| Material | Provisional α | Sourced α (`THIRD_PARTY.md`) | Reflection head-on, √(1 − α) |
|---|---|---|---|
| Concrete / tile | 0.02 | 0.0175 | 0.991 |
| Glass | 0.05 | 0.0375 | 0.981 |
| Plasterboard | 0.08 | 0.06 | 0.970 |
| Wood panel | 0.10 | 0.175 | 0.908 |
| Heavy curtain | 0.55 | 0.5625 | 0.661 |
| Acoustic foam | 0.90 | 0.7775 | 0.472 |
| Floor: Tile | 0.02 | 0.015 | |
| Floor: Wood | 0.08 | 0.0525 | |
| Floor: Carpet | 0.30 | 0.4325 | |
| Floor: Tatami | (none) | 0.395 | |

### Picture settings chosen by eye

- Compression `k`: 1.0, 1.5 and 3.0 times 1 / 0.1027 were compared on the same frames (12 ms and 50 ms after a clap in the bedroom). 1.5 was chosen. At 1.0 the walls' hit flashes were hard to see; at 3.0 the reverberant room flooded with the brightest colours.
- Gain ceiling: ×1000 showed the remains of a cleared room 60 dB down as a full-contrast texture. ×100 lets a quiet room look quiet.

### M0 criteria with the M1 code (`/bench/`)

| Check | M1 run |
|---|---|
| 1 Edge reflection, head-on | worst −70.3 dB (clap −73.6, pulse −77.5) |
| 2 Room resonances | 42.86, 57.14, 71.43, 85.71, 103.02 Hz; largest error 0.043 % |
| 3 Wall reflection | 0.949, 0.708, 0.320 for α = 0.1, 0.5, 0.9 |
| 4 GPU vs reference | 2.3e-6 of peak, energy 2.6e-6 (now with the Energy average and a wall edit) |
| 5 Speed | S 17,462 · M 7,786 · L 3,339 steps/s; 48,000 steps at M in 6.17 s |

### Where the spec's estimates were wrong (M1)

1. **"Only for one step, a new wall's old pressure is read" was not harmless** (spec 5.2). Together with cutting out the wall cells, it left a uniform offset in the field after every edit, and freed cells starting at 0 rang at the scale of the grid. Edits now clear walled cells at once, fill freed cells, and keep the field's sum.
2. **The automatic gain needed a ceiling** (spec 4.1). The spec gave the direction (rise fast, fall slowly) but no limits. It is now measured against a clap at 1 m, capped at ×100, and held at 1 for 260 steps after a clap or tone start.
3. **The material values moved**, most of all acoustic foam (0.90 → 0.78) and carpet (0.30 → 0.43). Tatami is 0.395, from a chart in a Kumamoto Prefecture report; the report doesn't say how it was measured.
4. **The tone's level depends on frequency** (as √f) unless its source value is scaled; it now is.
5. **60 fps at M is not decided by the app on this machine.** The app's own work is about 5 ms of GPU and 1 ms of main thread per frame, but even an empty WebGPU page drops to 56–58 fps here.
6. **"Diagonal pattern"** (criterion 4) is read as the (1, 1) mode: diagonal in the Wave view (opposite corners in phase), four bright corners with a dark cross in the Energy view.
7. **Criterion 1 needs a person**: the script shows that 10 drags make a 10-wall plan with closed corners, but the 5 minutes are for a human to confirm.
