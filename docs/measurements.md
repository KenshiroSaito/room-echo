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
