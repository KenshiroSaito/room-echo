// The absorbing layer in two dimensions: reflection at oblique angles, and long-run stability.
// Run: pnpm tsx scripts/absorber-2d.ts
import { toDb } from '../src/sim/analysis';
import { CLAP_HZ, freeFieldSetup } from '../src/sim/experiments';
import {
  DEFAULT_ABSORBER,
  buildCoefficients,
  createGrid,
  fillRect,
  wallCode,
} from '../src/sim/geometry';
import { ReferenceSim } from '../src/sim/reference';
import { createRng } from '../src/sim/rng';
import type { Absorber } from '../src/sim/sim';
import { ricker, tone } from '../src/sim/sources';

const pulse = ricker(CLAP_HZ);
const STEPS = 720;
const DY = 65; // probe row, cells below the source
const ANGLES = [0, 30, 45, 60, 70, 75];
const offsets = ANGLES.map((a) => Math.round(DY * Math.tan((a * Math.PI) / 180)));

/** Pressure over time at the probes; the source is at (sx, sy). */
function record(
  nx: number,
  ny: number,
  sx: number,
  sy: number,
  absorber: Absorber,
): Float32Array[] {
  const setup = freeFieldSetup(nx, ny, absorber);
  setup.source = { x: sx, y: sy };
  const sim = new ReferenceSim(setup);
  const out = offsets.map(() => new Float32Array(STEPS));
  for (let n = 0; n < STEPS; n++) {
    sim.step(n < pulse.length ? pulse[n] : 0);
    offsets.forEach((dx, k) => (out[k][n] = sim.field[(sy + DY) * nx + sx + dx]));
  }
  return out;
}

// Reference: a domain so large that nothing comes back within the run.
const free = record(1500, 1300, 600, 650, DEFAULT_ABSORBER);
const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

console.log('Reflection from the bottom edge, 800 Hz clap, by angle of incidence [dB]');
console.log('layer'.padEnd(34) + ANGLES.map((a) => `${a}°`.padStart(8)).join(''));
const variants: [string, Absorber][] = [
  ['matched, σ_max·Δt = 0.15 (adopted)', DEFAULT_ABSORBER],
  ['matched, σ_max·Δt = 0.10', { ...DEFAULT_ABSORBER, sigmaMaxDt: 0.1 }],
  ['matched, σ_max·Δt = 0.25', { ...DEFAULT_ABSORBER, sigmaMaxDt: 0.25 }],
  ['plain damping, σ_max·Δt = 0.15', { ...DEFAULT_ABSORBER, matched: false }],
  ['none (β = 1 edge only)', { ...DEFAULT_ABSORBER, sigmaMaxDt: 0 }],
];
for (const [name, absorber] of variants) {
  // 500 × 290: the probe row is 10 cells above the bottom layer; the other edges are far.
  const test = record(500, 290, 100, 200, absorber);
  const cols = test.map((t, k) => {
    const diff = t.map((v, n) => v - free[k][n]);
    return toDb(peak(diff) / peak(free[k]))
      .toFixed(1)
      .padStart(8);
  });
  console.log(name.padEnd(34) + cols.join(''));
}

// Long run: walls of every material cross the layer, a clap, then silence. The field must die out.
{
  const n = 120;
  const rng = createRng(7);
  const grid = createGrid(n, n);
  for (let k = 0; k < 14; k++) {
    const x = 1 + Math.floor(rng() * (n - 30));
    const y = 1 + Math.floor(rng() * (n - 30));
    const horizontal = rng() < 0.5;
    const code = 1 + Math.floor(rng() * 6);
    if (horizontal) fillRect(grid, x, y, x + 28, y + 1, code);
    else fillRect(grid, x, y, x + 1, y + 28, code);
  }
  fillRect(grid, 1, 60, 30, 61, wallCode('concrete'));
  fillRect(grid, 57, 57, 64, 64, 0);
  const sim = new ReferenceSim({
    nx: n,
    ny: n,
    coeff: buildCoefficients(grid, { absorber: DEFAULT_ABSORBER }),
    absorber: DEFAULT_ABSORBER,
    source: { x: 60, y: 60 },
    probes: [
      { x: 60, y: 60 },
      { x: 60, y: 60 },
    ],
    recordCapacity: 0,
  });
  console.log('\nLong run, 120 × 120 with walls through the layer: max |p| after a clap');
  let done = 0;
  for (const until of [300, 3000, 30000, 100000]) {
    for (; done < until; done++) sim.step(done < pulse.length ? pulse[done] : 0);
    console.log(`  step ${String(until).padStart(6)}: ${peak(sim.field).toExponential(2)}`);
  }
  // Then a steady tone: the level must settle, not grow.
  const hum = tone(440, 100000);
  console.log('Same scene, steady 440 Hz tone: max |p|');
  for (const until of [120000, 160000, 200000]) {
    for (; done < until; done++) sim.step(hum[done - 100000]);
    console.log(`  step ${String(until).padStart(6)}: ${peak(sim.field).toExponential(2)}`);
  }
}
