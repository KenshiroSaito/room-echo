// Wall and floor materials (spec 10-room-echo 5.4, 5.5).
// Display names live in src/strings.ts.

export type WallMaterialId = 'concrete' | 'glass' | 'plaster' | 'wood' | 'curtain' | 'foam';

export interface WallMaterial {
  id: WallMaterialId;
  /** Absorption coefficient α, 0 (fully reflecting) to 1 (same as an opening). */
  alpha: number;
}

/**
 * Provisional values. M1 replaces them with sourced values and records the sources in
 * THIRD_PARTY.md. The order is fixed: a wall's colour is tied to its position in this list.
 */
export const WALL_MATERIALS: readonly WallMaterial[] = [
  { id: 'concrete', alpha: 0.02 },
  { id: 'glass', alpha: 0.05 },
  { id: 'plaster', alpha: 0.08 },
  { id: 'wood', alpha: 0.1 },
  { id: 'curtain', alpha: 0.55 },
  { id: 'foam', alpha: 0.9 },
];

/** Pressure reflection factor of a wave that hits the wall head-on. */
export function reflectionFromAlpha(alpha: number): number {
  return Math.sqrt(1 - alpha);
}

/** Wall admittance β used by the update rule: β = (1 − R) / (1 + R). */
export function betaFromAlpha(alpha: number): number {
  const r = reflectionFromAlpha(alpha);
  return (1 - r) / (1 + r);
}

export type FloorMaterialId = 'tile' | 'wood' | 'carpet';

/** Provisional. Tatami is added in M1 once a sourced value is found. */
export const FLOOR_ALPHA: Record<FloorMaterialId, number> = {
  tile: 0.02,
  wood: 0.08,
  carpet: 0.3,
};

export const CEILING_ALPHA = 0.05;
export const CEILING_HEIGHT_M = 2.4;

/**
 * Uniform damping σ [1/s] that stands in for the floor and the ceiling, which a 2D simulation
 * does not have. Derived from Sabine's formula restricted to those two surfaces.
 */
export function floorSigma(alphaFloor: number): number {
  return (42.9 * (alphaFloor + CEILING_ALPHA)) / CEILING_HEIGHT_M;
}
