// Head-on reflection of a wall per octave band, against the nominal √(1 − α) (spec 5.4).
// The wall rule is first-order accurate: it drifts from the nominal value as the wavelength
// approaches the grid spacing.
// Run: pnpm tsx scripts/wall-reflection.ts
import {
  OCTAVE_BANDS_HZ,
  RECORD_CUTOFF_HZ,
  bandReflection,
  measureReflection,
} from '../src/sim/experiments';
import { betaFromAlpha, reflectionFromAlpha } from '../src/sim/materials';
import { createReferenceSim } from '../src/sim/reference';
import { windowedSinc } from '../src/sim/sources';

console.log('alpha  nominal |' + OCTAVE_BANDS_HZ.map((h) => String(h).padStart(7)).join(''));
for (const alpha of [0, 0.02, 0.1, 0.5, 0.9, 1]) {
  const m = await measureReflection(
    createReferenceSim,
    { beta: betaFromAlpha(alpha) },
    windowedSinc(RECORD_CUTOFF_HZ),
  );
  const bands = bandReflection(m, OCTAVE_BANDS_HZ, RECORD_CUTOFF_HZ);
  console.log(
    `${alpha.toFixed(2).padStart(5)}  ${reflectionFromAlpha(alpha).toFixed(3).padStart(7)} |` +
      bands.map((b) => b.ratio.toFixed(3).padStart(7)).join(''),
  );
}
