// Constants of the simulation grid (spec 10-room-echo 5.1).

/** Speed of sound in air at room temperature [m/s]. */
export const SPEED_OF_SOUND = 343;

/** Steps per second. Equal to the audio sample rate, so a recording is audio data as is. */
export const SAMPLE_RATE = 48_000;

/** Time step [s]. */
export const DT = 1 / SAMPLE_RATE;

/** Courant number λ = c·Δt/Δx. The 2D stability limit is 1/√2 ≈ 0.707. */
export const COURANT = 0.7;

/** λ², rounded to 32-bit float so the CPU reference and the GPU use the same value. */
export const LAMBDA2 = Math.fround(COURANT * COURANT);

/** Grid spacing [m] ≈ 1.021 cm. */
export const DX = SPEED_OF_SOUND / (SAMPLE_RATE * COURANT);

/** Thickness of the absorbing layer along the outer edge [cells] (spec 5.3). */
export const ABSORBER_CELLS = 24;

/**
 * Strength of the absorbing layer, σ_max·Δt (spec 5.3).
 *
 * Measured in M0 (docs/measurements.md): with the matched layer this value keeps reflection
 * from the edge below −70 dB head-on and below −30 dB up to 75° from head-on.
 */
export const ABSORBER_SIGMA_MAX_DT = 0.15;

export type RoomSize = 'S' | 'M' | 'L';

export interface RoomDimensions {
  widthM: number;
  heightM: number;
  nx: number;
  ny: number;
}

export function metersToCells(meters: number): number {
  return Math.round(meters / DX);
}

function dimensions(widthM: number, heightM: number): RoomDimensions {
  return { widthM, heightM, nx: metersToCells(widthM), ny: metersToCells(heightM) };
}

/** Domain sizes. The outer ABSORBER_CELLS cells on every side are the absorbing layer. */
export const ROOM_SIZES: Record<RoomSize, RoomDimensions> = {
  S: dimensions(6.0, 4.5),
  M: dimensions(8.0, 6.0),
  L: dimensions(12.0, 9.0),
};
