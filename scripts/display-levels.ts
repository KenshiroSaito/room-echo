// Free-field levels used by the display (spec 10-room-echo 4.1, 5.6), measured with the CPU
// reference: the peak of a clap 1 m from the source (the reference of the automatic gain) and
// the amplitude of the tone at 1 m for several frequencies (to scale the tone so that its
// level does not depend on frequency).
//
//   pnpm tsx scripts/display-levels.ts

import { maxAbs } from '../src/sim/analysis';
import { freeFieldSetup } from '../src/sim/experiments';
import { DT, metersToCells } from '../src/sim/grid';
import { ReferenceSim } from '../src/sim/reference';
import { ricker } from '../src/sim/sources';

const n = 320;
const oneMetre = metersToCells(1);

function run(signal: Float32Array, steps: number): Float32Array {
  const setup = freeFieldSetup(n, n, undefined, steps);
  const centre = setup.source;
  setup.probes = [{ x: centre.x + oneMetre, y: centre.y }, centre];
  const sim = new ReferenceSim(setup);
  for (let i = 0; i < steps; i++) sim.step(i < signal.length ? signal[i] : 0);
  const recording = (sim as unknown as { recording: [Float32Array, Float32Array] }).recording;
  return recording[0];
}

const clapPeak = maxAbs(run(ricker(800), 600));
console.log(`clap (Ricker 800 Hz, amplitude 1): peak at 1 m = ${clapPeak.toExponential(4)}`);

console.log('tone with source value ω·Δt·sin(ω·t): amplitude at 1 m, last 20 ms of 100 ms');
for (const hz of [50, 100, 200, 400, 1000, 2000]) {
  const steps = 4800;
  const w = 2 * Math.PI * hz * DT;
  const signal = new Float32Array(steps);
  for (let i = 0; i < steps; i++) signal[i] = w * Math.sin(w * i);
  const rec = run(signal, steps);
  const amplitude = maxAbs(rec, steps - 960, steps);
  console.log(
    `  ${String(hz).padStart(5)} Hz: ${amplitude.toExponential(4)}  (${(amplitude / clapPeak).toFixed(3)} × clap peak)`,
  );
}
