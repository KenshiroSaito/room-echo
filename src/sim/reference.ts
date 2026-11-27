// CPU reference implementation of the update rule (spec 10-room-echo 5.2, 5.3).
//
//   p_next = [ (2 − K·λ² − E)·p + λ²·S + C − (1 − B − D)·p_prev ] / (1 + B + D)
//
// E and C are zero outside the absorbing layer, where this is the plain rule of spec 5.2.
// Slow and plain on purpose: the GPU solver is checked against it. Pressure is stored as 32-bit
// floats, like on the GPU, so the two agree to rounding.
//
// S is the sum over all four neighbours. That equals the sum over the air neighbours because
// the pressure of a wall cell is always 0: when setCoefficients() turns an air cell into a
// wall, its pressure is set to 0 at once (CellChanges in sim.ts).
//
// The absorbing layer
// -------------------
// Damping alone (D) makes the layer look like a wall to low frequencies: measured, it reflects
// −4 dB at 63 Hz (docs/measurements.md). The layer is therefore a perfectly matched layer. Each
// cell of the layer remembers the particle velocity through its right and bottom faces
// (scaled by ρ·c), stepped half a step apart from the pressure:
//
//   v_next = [ (1 − s)·v − λ·(p_far − p_near) ] / (1 + s)        s = σ·Δt at the face
//
// and the pressure rule gains
//
//   E = 4·sx·sy                                                   (non-zero only in corners)
//   C = λ·[ (sx_R − sy)·(v_R + v_R,next) − (sx_L − sy)·(v_L + v_L,next)
//         + (sy_B − sx)·(v_B + v_B,next) − (sy_T − sx)·(v_T + v_T,next) ]
//
// where sx, sy are σ·Δt of the two axes at the cell centre and sx_R … sy_T at its four faces.
// Along one axis this is exactly the classic split-field layer (Berenger) written for a solver
// that stores pressure only. A face that touches a wall carries no velocity; the wall's own
// absorption stays in B.
//
// The Energy view
// ---------------
// When energyRate > 0, every cell also keeps a running average of p² (spec 4.3), updated after
// the source is added:  e ← e + (p_next² − e)·energyRate. It does not feed back into the field.

import { absorberTable } from './geometry';
import { COURANT, LAMBDA2 } from './grid';
import {
  FILL_ITERATIONS,
  FILL_REACH,
  countAir,
  type Absorber,
  type CellChanges,
  type Point,
  type Sim,
  type SimSetup,
} from './sim';
import { SOURCE_FOOTPRINT } from './sources';

// Local copies: reading an imported binding inside the inner loop is slow under some
// module transforms (vitest, tsx).
const LAMBDA = Math.fround(COURANT);
const L2 = LAMBDA2;

export class ReferenceSim implements Sim {
  readonly nx: number;
  readonly ny: number;
  stepCount = 0;

  private coeff: Float32Array;
  private prev: Float32Array;
  private cur: Float32Array;
  private next: Float32Array;
  /** Face velocities of the layer cells, two per cell: right face, bottom face. */
  private velocity: Float32Array;
  private velocityNext: Float32Array;
  private readonly sigmaX: Float32Array;
  private readonly sigmaY: Float32Array;
  private readonly layerColumn: Uint8Array;
  private readonly layerRow: Uint8Array;
  private source: Point;
  private readonly probeIndex: [number, number];
  private readonly recording: [Float32Array, Float32Array];
  private readonly energy: Float32Array;
  private energyRate: number;

  constructor(setup: SimSetup) {
    const { nx, ny } = setup;
    if (setup.coeff.length !== nx * ny * 2) throw new Error('coeff has the wrong size');
    this.nx = nx;
    this.ny = ny;
    this.coeff = setup.coeff;
    this.prev = new Float32Array(nx * ny);
    this.cur = new Float32Array(nx * ny);
    this.next = new Float32Array(nx * ny);
    this.velocity = new Float32Array(nx * ny * 2);
    this.velocityNext = new Float32Array(nx * ny * 2);

    const a: Absorber = setup.absorber;
    this.sigmaX = absorberTable(nx, a.left, a.right, a);
    this.sigmaY = absorberTable(ny, a.top, a.bottom, a);
    this.layerColumn = layerMask(nx, a.left, a.right, a);
    this.layerRow = layerMask(ny, a.top, a.bottom, a);

    this.source = setup.source;
    this.probeIndex = [
      setup.probes[0].y * nx + setup.probes[0].x,
      setup.probes[1].y * nx + setup.probes[1].x,
    ];
    this.recording = [
      new Float32Array(setup.recordCapacity),
      new Float32Array(setup.recordCapacity),
    ];
    this.energy = new Float32Array(nx * ny);
    this.energyRate = Math.fround(setup.energyRate ?? 0);
  }

  /** One step. `sourceValue` is added around the source cell with the Gaussian footprint. */
  step(sourceValue = 0): void {
    const { nx, ny, coeff, prev, cur, next, velocity, velocityNext, sigmaX, sigmaY } = this;
    const { layerRow, layerColumn } = this;
    for (let y = 1; y < ny - 1; y++) {
      const rowInLayer = layerRow[y] === 1;
      let i = y * nx + 1;
      for (let x = 1; x < nx - 1; x++, i++) {
        const inLayer = rowInLayer || layerColumn[x] === 1;
        const bd = coeff[2 * i + 1];
        if (bd < 0) {
          next[i] = 0;
          if (inLayer) {
            velocityNext[2 * i] = 0;
            velocityNext[2 * i + 1] = 0;
          }
          continue;
        }
        const p = cur[i];
        const s = cur[i - 1] + cur[i + 1] + cur[i - nx] + cur[i + nx];
        if (!inLayer) {
          next[i] = (coeff[2 * i] * p + L2 * s - (1 - bd) * prev[i]) / (1 + bd);
          continue;
        }

        const sx = sigmaX[2 * x];
        const sy = sigmaY[2 * y];
        const sxR = sigmaX[2 * x + 1];
        const sxL = sigmaX[2 * x - 1];
        const syB = sigmaY[2 * y + 1];
        const syT = sigmaY[2 * y - 1];
        const airR = coeff[2 * (i + 1) + 1] >= 0;
        const airL = coeff[2 * (i - 1) + 1] >= 0;
        const airB = coeff[2 * (i + nx) + 1] >= 0;
        const airT = coeff[2 * (i - nx) + 1] >= 0;
        // Velocity through the four faces, now and half a step ahead.
        const vR = airR ? velocity[2 * i] : 0;
        const vL = airL ? velocity[2 * (i - 1)] : 0;
        const vB = airB ? velocity[2 * i + 1] : 0;
        const vT = airT ? velocity[2 * (i - nx) + 1] : 0;
        const vRn = airR ? ((1 - sxR) * vR - LAMBDA * (cur[i + 1] - p)) / (1 + sxR) : 0;
        const vLn = airL ? ((1 - sxL) * vL - LAMBDA * (p - cur[i - 1])) / (1 + sxL) : 0;
        const vBn = airB ? ((1 - syB) * vB - LAMBDA * (cur[i + nx] - p)) / (1 + syB) : 0;
        const vTn = airT ? ((1 - syT) * vT - LAMBDA * (p - cur[i - nx])) / (1 + syT) : 0;
        const c =
          LAMBDA *
          ((sxR - sy) * (vR + vRn) -
            (sxL - sy) * (vL + vLn) +
            (syB - sx) * (vB + vBn) -
            (syT - sx) * (vT + vTn));
        const e = 4 * sx * sy;
        next[i] = ((coeff[2 * i] - e) * p + L2 * s + c - (1 - bd) * prev[i]) / (1 + bd);
        velocityNext[2 * i] = vRn;
        velocityNext[2 * i + 1] = vBn;
      }
    }

    if (sourceValue !== 0) {
      for (const { dx, dy, weight } of SOURCE_FOOTPRINT) {
        const x = this.source.x + dx;
        const y = this.source.y + dy;
        if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
        const i = y * nx + x;
        if (coeff[2 * i + 1] >= 0) next[i] += weight * sourceValue;
      }
    }

    if (this.stepCount < this.recording[0].length) {
      this.recording[0][this.stepCount] = next[this.probeIndex[0]];
      this.recording[1][this.stepCount] = next[this.probeIndex[1]];
    }

    const rate = this.energyRate;
    if (rate > 0) {
      const energy = this.energy;
      for (let i = 0; i < nx * ny; i++) {
        const e = energy[i];
        energy[i] = e + (next[i] * next[i] - e) * rate;
      }
    }

    this.prev = cur;
    this.cur = next;
    this.next = prev;
    this.velocity = velocityNext;
    this.velocityNext = velocity;
    this.stepCount++;
  }

  async run(steps: number, source?: Float32Array): Promise<void> {
    for (let i = 0; i < steps; i++) {
      this.step(source && i < source.length ? source[i] : 0);
    }
  }

  setCoefficients(coeff: Float32Array, changes?: CellChanges): void {
    if (coeff.length !== this.nx * this.ny * 2) throw new Error('coeff has the wrong size');
    this.coeff = coeff;
    if (changes && (changes.freed.length > 0 || changes.walled.length > 0)) {
      const air = countAir(coeff);
      editField(this.cur, changes, coeff, this.nx, air);
      editField(this.prev, changes, coeff, this.nx, air);
    }
  }

  setSource(source: Point): void {
    this.source = source;
  }

  setEnergyRate(rate: number): void {
    this.energyRate = Math.fround(rate);
  }

  async readRecording(): Promise<[Float32Array, Float32Array]> {
    const n = Math.min(this.stepCount, this.recording[0].length);
    return [this.recording[0].slice(0, n), this.recording[1].slice(0, n)];
  }

  async readField(): Promise<Float32Array> {
    return this.cur.slice();
  }

  async readEnergy(): Promise<Float32Array> {
    return this.energy.slice();
  }

  /** The current field without a copy. Valid until the next step. */
  get field(): Float32Array {
    return this.cur;
  }

  destroy(): void {}
}

/**
 * Edit one pressure field after the walls changed (CellChanges in sim.ts): clear the walled
 * cells, fill the freed ones, and spread the change of the field's sum over all air cells.
 * The GPU solver does the same steps in the same order (edit.wgsl).
 */
export function editField(
  field: Float32Array,
  changes: CellChanges,
  coeff: Float32Array,
  nx: number,
  air: number,
): void {
  let removed = 0;
  for (const i of changes.walled) {
    removed += field[i];
    field[i] = 0;
  }
  if (changes.freed.length > 0) fillFreed(field, changes.freed, coeff, nx);
  let added = 0;
  for (const i of changes.freed) added += field[i];
  if (air === 0) return;
  const shift = (added - removed) / air;
  for (let i = 0; i < field.length; i++) if (coeff[2 * i + 1] >= 0) field[i] -= shift;
}

/**
 * Fill the freed cells of one pressure field from the air around them (see FILL_REACH in
 * sim.ts). The GPU solver does exactly the same (fill.wgsl): the same walks, the same order of
 * the four directions (left, right, up, down), the same sweeps.
 */
export function fillFreed(
  field: Float32Array,
  freed: Uint32Array,
  coeff: Float32Array,
  nx: number,
): void {
  const isFreed = new Uint8Array(field.length);
  for (const i of freed) isFreed[i] = 1;
  const steps = [-1, 1, -nx, nx];
  const next = new Float32Array(freed.length);

  // First guess, from the nearest known air in the four directions.
  for (let j = 0; j < freed.length; j++) {
    const i = freed[j];
    let sum = 0;
    let weight = 0;
    for (const step of steps) {
      for (let k = 1; k <= FILL_REACH; k++) {
        const at = i + k * step;
        if (coeff[2 * at + 1] < 0) break;
        if (isFreed[at] === 0) {
          sum += field[at] / k;
          weight += 1 / k;
          break;
        }
      }
    }
    next[j] = weight > 0 ? sum / weight : 0;
  }
  for (let j = 0; j < freed.length; j++) field[freed[j]] = next[j];

  // Smoothing sweeps.
  for (let k = 0; k < FILL_ITERATIONS; k++) {
    for (let j = 0; j < freed.length; j++) {
      const i = freed[j];
      let sum = 0;
      let n = 0;
      for (const step of steps) {
        if (coeff[2 * (i + step) + 1] >= 0) {
          sum += field[i + step];
          n++;
        }
      }
      next[j] = n > 0 ? sum / n : 0;
    }
    for (let j = 0; j < freed.length; j++) field[freed[j]] = next[j];
  }
}

/**
 * Cells along one axis that take the layer form of the rule: the layer itself plus one cell,
 * because the first cell inside the room still has a layer face on one side.
 */
export function layerMask(
  count: number,
  low: boolean,
  high: boolean,
  absorber: Absorber,
): Uint8Array {
  const mask = new Uint8Array(count);
  if (!absorber.matched || absorber.cells <= 0 || absorber.sigmaMaxDt <= 0) return mask;
  for (let i = 0; i < count; i++) {
    if ((low && i <= absorber.cells) || (high && i >= count - 1 - absorber.cells)) mask[i] = 1;
  }
  return mask;
}

export const createReferenceSim = (setup: SimSetup): ReferenceSim => new ReferenceSim(setup);
