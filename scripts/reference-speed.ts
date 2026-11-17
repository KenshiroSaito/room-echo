// Speed of the CPU reference, for the measurement log.
// Run: pnpm tsx scripts/reference-speed.ts
import { CLAP_HZ, freeFieldSetup } from '../src/sim/experiments';
import { ROOM_SIZES, type RoomSize } from '../src/sim/grid';
import { ReferenceSim } from '../src/sim/reference';
import { ricker } from '../src/sim/sources';

const clap = ricker(CLAP_HZ);
for (const size of ['S', 'M', 'L'] as RoomSize[]) {
  const { nx, ny } = ROOM_SIZES[size];
  const sim = new ReferenceSim(freeFieldSetup(nx, ny));
  for (let i = 0; i < 400; i++) sim.step(i < clap.length ? clap[i] : 0);
  const steps = 400;
  const start = performance.now();
  for (let i = 0; i < steps; i++) sim.step(0);
  const seconds = (performance.now() - start) / 1000;
  const perSecond = steps / seconds;
  console.log(
    `${size} ${nx} × ${ny}: ${perSecond.toFixed(0)} steps/s, ` +
      `${((seconds / steps / (nx * ny)) * 1e9).toFixed(2)} ns per cell`,
  );
}
