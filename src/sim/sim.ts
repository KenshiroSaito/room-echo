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
  /** Replace the coefficients (after the walls change). Takes effect from the next step. */
  setCoefficients(coeff: Float32Array): void;
  setSource(source: Point): void;
  /** The pressure recorded at the two probes, one value per recorded step. */
  readRecording(): Promise<[Float32Array, Float32Array]>;
  /** The current pressure field, row by row. */
  readField(): Promise<Float32Array>;
  destroy(): void;
}

export type SimFactory = (setup: SimSetup) => Sim | Promise<Sim>;
