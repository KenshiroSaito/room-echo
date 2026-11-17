// Head-on reflection of the outer edge as a function of the layer strength (spec 5.3),
// for plain damping and for the matched layer.
// Run: pnpm tsx scripts/tune-absorber.ts
import { measureEdgeReflection } from '../src/sim/experiments';
import { DEFAULT_ABSORBER } from '../src/sim/geometry';
import { createReferenceSim } from '../src/sim/reference';

const values = [0, 0.003, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3];
const f = (db: number) => db.toFixed(1).padStart(6);
for (const matched of [false, true]) {
  console.log(`\n${matched ? 'Matched layer (PML)' : 'Plain damping (spec 5.3 as first written)'}`);
  console.log(
    'sigmaMaxDt |  clap  pulse |' +
      [63, 125, 250, 500, 1000, 2000, 4000].map((h) => String(h).padStart(7)).join(''),
  );
  for (const sigmaMaxDt of values) {
    const r = await measureEdgeReflection(createReferenceSim, {
      ...DEFAULT_ABSORBER,
      sigmaMaxDt,
      matched,
    });
    console.log(
      `${sigmaMaxDt.toFixed(3).padStart(10)} | ${f(r.clapDb)} ${f(r.pulseDb)} | ${r.bands.map((b) => f(b.db)).join(' ')}`,
    );
  }
}
