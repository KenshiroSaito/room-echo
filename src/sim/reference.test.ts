// The M0 completion criteria (spec 10-room-echo 7), checked on the CPU reference.
// The GPU solver runs the same scenes on /bench (see e2e/bench.spec.ts).

import { describe, expect, it } from 'vitest';
import { argMaxAbs, maxAbs, toDb } from './analysis';
import {
  AGREEMENT_STEPS,
  CLAP_HZ,
  WALL_REFLECTION_ALPHAS,
  agreementScene,
  freeFieldSetup,
  measureEdgeReflection,
  measureRoomModes,
  measureWallReflection,
} from './experiments';
import {
  AIR,
  DEFAULT_ABSORBER,
  RIGID,
  buildCoefficients,
  createGrid,
  fillRect,
  strokeRect,
  wallCode,
} from './geometry';
import { COURANT, DT } from './grid';
import { floorSigma } from './materials';
import { cellChanges, countAir } from './sim';
import { ReferenceSim, createReferenceSim, editField, fillFreed } from './reference';
import { ricker } from './sources';

describe('criterion 1: free field', () => {
  it('reflects a head-on wave from the edge by −30 dB or less', async () => {
    const r = await measureEdgeReflection(createReferenceSim);
    console.log(
      `edge reflection: clap ${r.clapDb.toFixed(1)} dB, pulse ${r.pulseDb.toFixed(1)} dB, bands ` +
        r.bands.map((b) => `${b.hz}:${b.db.toFixed(1)}`).join(' '),
    );
    expect(r.worstDb).toBeLessThanOrEqual(-30);
    expect(r.pass).toBe(true);
  });

  it('shows why plain damping was replaced: it fails at low frequencies', async () => {
    const r = await measureEdgeReflection(createReferenceSim, {
      ...DEFAULT_ABSORBER,
      matched: false,
    });
    expect(r.bands[0].db).toBeGreaterThan(-10);
    expect(r.pass).toBe(false);
  });

  it('spreads a clap in a circle and lets it leave through the edge', () => {
    const n = 420;
    const sim = new ReferenceSim(freeFieldSetup(n, n));
    const clap = ricker(CLAP_HZ);
    const centre = n >> 1;

    // After 290 steps the front is well inside the room. Its radius along the axis and along
    // the diagonal must agree: the front is a circle.
    for (let i = 0; i < 290; i++) sim.step(i < clap.length ? clap[i] : 0);
    const field = sim.field;
    const along = (dx: number, dy: number): { radius: number; peak: number } => {
      const values: number[] = [];
      for (let k = 0; centre + k * Math.max(dx, dy) < n - 1; k++) {
        values.push(field[(centre + k * dy) * n + centre + k * dx]);
      }
      const k = argMaxAbs(values, 20);
      return { radius: k * Math.hypot(dx, dy), peak: Math.abs(values[k]) };
    };
    const axis = along(1, 0);
    const vertical = along(0, 1);
    const diagonal = along(1, 1);
    // The clap peaks 1.5 periods after it starts. In two dimensions the pulse changes shape as
    // it spreads (its peak falls about an eighth of a wavelength behind), hence the tolerance
    // of a quarter wavelength.
    const stepsPerPeriod = 48000 / CLAP_HZ;
    const expectedRadius = (290 - 1.5 * stepsPerPeriod) * COURANT;
    const quarterWavelength = (stepsPerPeriod * COURANT) / 4;
    console.log(
      `front radius at step 290: axis ${axis.radius.toFixed(1)}, diagonal ${diagonal.radius.toFixed(1)} cells ` +
        `(sound travels ${expectedRadius.toFixed(0)} cells in that time)`,
    );
    expect(Math.abs(axis.radius - expectedRadius)).toBeLessThan(quarterWavelength);
    expect(vertical.radius).toBe(axis.radius);
    expect(Math.abs(diagonal.radius - axis.radius)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(diagonal.peak / axis.peak - 1)).toBeLessThan(0.02);

    // Long after the front has reached the edge, almost nothing is left.
    const frontPeak = axis.peak;
    for (let i = 290; i < 1500; i++) sim.step(0);
    const residual = maxAbs(sim.field) / frontPeak;
    console.log(`field left at step 1500: ${toDb(residual).toFixed(1)} dB relative to the front`);
    expect(toDb(residual)).toBeLessThan(-40);
  });
});

describe('criterion 2: room resonances', () => {
  it('matches the five lowest modes of a 4.0 m × 3.0 m room within 1 %', async () => {
    const r = await measureRoomModes(createReferenceSim, 0.5);
    console.log(
      `modes: ${r.measuredHz.map((f) => f.toFixed(2)).join(', ')} Hz; theory ` +
        `${r.theoryHz.map((f) => f.toFixed(2)).join(', ')} Hz; largest error ` +
        `${(r.maxRelativeError * 100).toFixed(3)} %`,
    );
    expect(r.theoryHz.map((f) => Number(f.toFixed(1)))).toEqual([42.9, 57.2, 71.5, 85.8, 103.1]);
    expect(r.measuredHz).toHaveLength(5);
    expect(r.maxRelativeError).toBeLessThanOrEqual(0.01);
  });
});

describe('criterion 3: wall reflection', () => {
  it.each(WALL_REFLECTION_ALPHAS)('reflects √(1 − α) for α = %s within ±0.05', async (alpha) => {
    const r = await measureWallReflection(createReferenceSim, alpha);
    console.log(
      `α = ${alpha}: measured ${r.measured.toFixed(4)} (from peaks ${r.peakRatio.toFixed(4)}), ` +
        `expected ${r.expected.toFixed(4)}`,
    );
    expect(Math.abs(r.error)).toBeLessThanOrEqual(0.05);
  });

  it('reflects everything from a rigid wall', async () => {
    const r = await measureWallReflection(createReferenceSim, 0);
    expect(r.measured).toBeCloseTo(1, 3);
  });
});

describe('reference solver', () => {
  it('is reproducible: the same scene gives the same field', async () => {
    const run = async (): Promise<Float32Array> => {
      const { setup, source } = agreementScene();
      const sim = new ReferenceSim(setup);
      await sim.run(AGREEMENT_STEPS, source);
      return sim.readField();
    };
    const a = await run();
    const b = await run();
    expect(maxAbs(a)).toBeGreaterThan(0.01);
    expect(a).toEqual(b);
  });

  it('keeps the running average of p² that the Energy view shows', async () => {
    const { setup, source } = agreementScene();
    const sim = new ReferenceSim(setup);
    await sim.run(AGREEMENT_STEPS, source);
    const [recorded] = await sim.readRecording();
    const rate = setup.energyRate!;
    let expected = 0;
    for (const p of recorded) expected += (p * p - expected) * rate;
    const energy = await sim.readEnergy();
    const probe = setup.probes[0];
    expect(expected).toBeGreaterThan(0);
    // The stored average is rounded to 32 bits every step.
    const stored = energy[probe.y * setup.nx + probe.x];
    expect(Math.abs(stored - expected) / expected).toBeLessThan(1e-6);
  });

  it('fills the cells of a removed wall smoothly from the air around them', () => {
    // A field that rises linearly from left to right, with a 10-cell wall strip removed.
    const nx = 40;
    const ny = 12;
    const grid = createGrid(nx, ny);
    const coeff = buildCoefficients(grid);
    const field = new Float32Array(nx * ny);
    const freed: number[] = [];
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const i = y * nx + x;
        if (x >= 15 && x < 25) freed.push(i);
        else field[i] = x;
      }
    }
    fillFreed(field, Uint32Array.from(freed), coeff, nx);
    // A linear field is harmonic, so the fill reproduces it inside the strip: within 1 % of
    // the strip's range in the middle rows.
    for (let x = 15; x < 25; x++) {
      expect(Math.abs(field[6 * nx + x] - x)).toBeLessThan(0.1);
    }
  });

  it('edits the field without changing its sum: walled cells cleared, freed cells filled', () => {
    const nx = 30;
    const ny = 20;
    const before = createGrid(nx, ny);
    fillRect(before, 10, 1, 14, ny - 1, RIGID);
    const after = createGrid(nx, ny);
    fillRect(after, 20, 5, 22, 15, RIGID);
    const coeff = buildCoefficients(after);
    const field = new Float32Array(nx * ny);
    for (let i = 0; i < field.length; i++) {
      if (before.cells[i] === AIR) field[i] = Math.sin(i * 0.37) + 0.5;
    }
    const sum = (f: Float32Array) => f.reduce((a, b) => a + b, 0);
    const total = sum(field);
    const changes = cellChanges(before.cells, after.cells);
    expect(changes.freed.length).toBeGreaterThan(0);
    expect(changes.walled.length).toBeGreaterThan(0);
    editField(field, changes, coeff, nx, countAir(coeff));
    for (const i of changes.walled) expect(field[i]).toBe(0);
    expect(Math.abs(sum(field) - total)).toBeLessThan(1e-3);
  });

  it('leaves no offset behind when walls change while the room sounds', async () => {
    // A closed box with a clap inside. Halfway through the sound, the box is removed and a new
    // wall is drawn across where the sound is. The low sound stored in the box then drains out
    // of the domain; no uniform offset may stay behind (an offset is a steady state of the
    // update rule, so it would never leave).
    const n = 180;
    const box = createGrid(n, n);
    strokeRect(box, 40, 40, 140, 140, 10, wallCode('plaster'));
    const open = createGrid(n, n);
    fillRect(open, 60, 100, 120, 110, wallCode('concrete'));
    const options = { absorber: DEFAULT_ABSORBER, uniformSigmaDt: floorSigma(0.05) * DT };
    const sim = new ReferenceSim({
      nx: n,
      ny: n,
      coeff: buildCoefficients(box, options),
      absorber: DEFAULT_ABSORBER,
      source: { x: 90, y: 75 },
      probes: [
        { x: 90, y: 75 },
        { x: 90, y: 75 },
      ],
      recordCapacity: 0,
    });
    await sim.run(400, ricker(800));
    const peak = maxAbs(sim.field);
    sim.setCoefficients(buildCoefficients(open, options), cellChanges(box.cells, open.cells));
    const mean = () => sim.field.reduce((a, b) => a + b, 0) / sim.field.length;
    await sim.run(4000);
    const early = { max: maxAbs(sim.field), mean: mean() };
    await sim.run(8000);
    const late = { max: maxAbs(sim.field), mean: mean() };
    // Measured: max 1.6e-3 and mean 3.0e-4 of the peak after 4000 steps, then 4.9e-4 and
    // 1.0e-4 after 12000. Without the sum correction the mean is about three times larger.
    expect(Math.abs(early.mean)).toBeLessThan(5e-4 * peak);
    expect(late.max).toBeLessThan(early.max / 2);
    expect(Math.abs(late.mean)).toBeLessThan(Math.abs(early.mean) / 2);
  });

  it('keeps wall cells silent', async () => {
    const { setup, source } = agreementScene();
    const sim = new ReferenceSim(setup);
    await sim.run(300, source);
    const field = sim.field;
    for (let i = 0; i < field.length; i++) {
      if (setup.coeff[2 * i + 1] < 0) expect(field[i]).toBe(0);
    }
  });

  it('stays stable with walls through the absorbing layer', () => {
    const n = 96;
    const grid = createGrid(n, n);
    for (let x = 1; x < 40; x++) grid.cells[30 * n + x] = 1; // concrete, from the edge inward
    for (let y = 50; y < n - 1; y++) grid.cells[y * n + 70] = 6; // foam, down to the edge
    const sim = new ReferenceSim({
      nx: n,
      ny: n,
      coeff: buildCoefficients(grid, { absorber: DEFAULT_ABSORBER }),
      absorber: DEFAULT_ABSORBER,
      source: { x: 48, y: 48 },
      probes: [
        { x: 48, y: 48 },
        { x: 48, y: 48 },
      ],
      recordCapacity: 0,
    });
    const clap = ricker(CLAP_HZ);
    let early = 0;
    for (let i = 0; i < 20000; i++) {
      sim.step(i < clap.length ? clap[i] : 0);
      if (i === 300) early = maxAbs(sim.field);
    }
    expect(early).toBeGreaterThan(1e-3);
    expect(maxAbs(sim.field)).toBeLessThan(early * 1e-4);
  });
});
