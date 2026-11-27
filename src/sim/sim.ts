// The interface shared by the CPU reference and the GPU solver. The validation scenes in
// experiments.ts are written against it, so the same scenes check both implementations.

export interface Point {
  x: number;
  y: number;
}

/** The absorbing layer along the outer edge of the domain (spec 10-room-echo 5.3). */
export interface Absorber {
  /** Thickness [cells]. */
  cells: number;
  /** σ_max·Δt at the outer end of the layer. */
  sigmaMaxDt: number;
  /** Which edges carry the layer. */
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
  /**
   * true: the layer is matched to the air in front of it (a perfectly matched layer), which
   * needs the two memory terms of the update rule. false: plain damping only. The plain form
   * reflects low frequencies and exists only so the tuning script can show the difference.
   */
  matched: boolean;
}

export interface SimSetup {
  nx: number;
  ny: number;
  /** Two floats per cell, from buildCoefficients(). */
  coeff: Float32Array;
  /** Must be the absorber the coefficients were built with. */
  absorber: Absorber;
  /** Cell at the centre of the source. */
  source: Point;
  /** Two cells whose pressure is recorded every step (the listener's ears from M2 on). */
  probes: [Point, Point];
  /** The first `recordCapacity` steps are recorded. 0 turns recording off. */
  recordCapacity: number;
  /**
   * Weight of the newest step in the running average of p² that the Energy view shows
   * (spec 4.3): Δt / τ. 0, the default, turns the average off.
   */
  energyRate?: number;
}

export interface Sim {
  readonly nx: number;
  readonly ny: number;
  /** Steps taken so far. */
  readonly stepCount: number;
  /**
   * Advance by `steps`. `source[i]` is the source value of the i-th step of this call;
   * steps beyond the end of `source` use 0.
   */
  run(steps: number, source?: Float32Array): Promise<void>;
  /**
   * Replace the coefficients (after the walls change). Takes effect from the next step.
   * `changes` lists the cells that changed between air and wall; the field is then edited as
   * described at CellChanges, in both the current and the previous field.
   */
  setCoefficients(coeff: Float32Array, changes?: CellChanges): void;
  setSource(source: Point): void;
  /** Change the weight of the running average of p². 0 freezes it. */
  setEnergyRate(rate: number): void;
  /** The pressure recorded at the two probes, one value per recorded step. */
  readRecording(): Promise<[Float32Array, Float32Array]>;
  /** The current pressure field, row by row. */
  readField(): Promise<Float32Array>;
  /** The running average of p², row by row. */
  readEnergy(): Promise<Float32Array>;
  destroy(): void;
}

export type SimFactory = (setup: SimSetup) => Sim | Promise<Sim>;

/**
 * The fill of freed cells (CellChanges, step 2). First guess: from each freed cell, walk left,
 * right, up and down to the nearest air cell that is not freed (at most FILL_REACH cells, and
 * not through a wall), and take the mean of what was found weighted by 1 / distance. Across a
 * straight wall that is linear interpolation between its two faces. Then FILL_ITERATIONS
 * sweeps in which every freed cell becomes the mean of its air neighbours, all at once
 * (Jacobi), smooth what the first guess leaves.
 */
export const FILL_REACH = 32;
export const FILL_ITERATIONS = 32;

/**
 * Cells that changed between air and wall in an edit, as indices. setCoefficients() edits the
 * field (now and one step back) so the change neither rings nor shifts the whole field:
 *
 * 1. `walled` cells (air → wall) are set to 0 at once, so no neighbour reads their old pressure.
 * 2. `freed` cells (wall → air) are filled smoothly from the air around them (FILL_REACH),
 *    instead of starting as a hole of silence whose sharp edges ring at the scale of the grid.
 * 3. Steps 1 and 2 change the sum of the field. The difference is spread evenly over all air
 *    cells, so the sum stays what it was. A uniform offset is a steady state of the update rule
 *    (damping acts on change over time only), so without this every edit would leave behind a
 *    small offset, and the automatic gain would show it as a tint over the whole picture.
 */
export interface CellChanges {
  freed: Uint32Array;
  walled: Uint32Array;
}

/** The cells that changed between two grids of material codes (0 = air). */
export function cellChanges(before: Uint8Array, after: Uint8Array): CellChanges {
  const freed: number[] = [];
  const walled: number[] = [];
  for (let i = 0; i < after.length; i++) {
    const wasAir = before[i] === 0;
    const isAir = after[i] === 0;
    if (!wasAir && isAir) freed.push(i);
    else if (wasAir && !isAir) walled.push(i);
  }
  return { freed: Uint32Array.from(freed), walled: Uint32Array.from(walled) };
}

/** Number of air cells in a coefficient array. */
export function countAir(coeff: Float32Array): number {
  let n = 0;
  for (let i = 1; i < coeff.length; i += 2) if (coeff[i] >= 0) n++;
  return n;
}
