// Wall and floor materials (spec 10-room-echo 5.4, 5.5). Sources: THIRD_PARTY.md.
// Display names live in src/strings.ts.
//
// The simulation gives every material one absorption coefficient α. It is the mean of the
// published octave-band values at 250, 500, 1000 and 2000 Hz: the four bands of the noise
// reduction coefficient (NRC), without the NRC's rounding to 0.05. The band values are kept
// here so the single value can be checked against the source.

export type WallMaterialId = 'concrete' | 'glass' | 'plaster' | 'wood' | 'curtain' | 'foam';
export type FloorMaterialId = 'tile' | 'wood' | 'carpet' | 'tatami';

/** Octave bands of the band values below [Hz]. */
export const BANDS_HZ = [125, 250, 500, 1000, 2000, 4000] as const;

export interface MaterialSource {
  /** Absorption coefficients at BANDS_HZ. */
  bands: readonly [number, number, number, number, number, number];
  /** What was measured, as the source describes it. */
  specimen: string;
  /** Key of the source in THIRD_PARTY.md. */
  source: 'vorlaender-2008' | 'kumamoto-2014';
}

/** Mean of the 250, 500, 1000 and 2000 Hz bands. */
export function singleAlpha(bands: MaterialSource['bands']): number {
  return (bands[1] + bands[2] + bands[3] + bands[4]) / 4;
}

export interface WallMaterial extends MaterialSource {
  id: WallMaterialId;
  /** Absorption coefficient α, 0 (fully reflecting) to 1 (same as an opening). */
  alpha: number;
}

function wall(id: WallMaterialId, source: MaterialSource): WallMaterial {
  return { id, ...source, alpha: singleAlpha(source.bands) };
}

/** The order is fixed: a wall's colour is tied to its position in this list. */
export const WALL_MATERIALS: readonly WallMaterial[] = [
  wall('concrete', {
    bands: [0.01, 0.01, 0.02, 0.02, 0.02, 0.05],
    specimen: 'Smooth unpainted concrete',
    source: 'vorlaender-2008',
  }),
  wall('glass', {
    bands: [0.1, 0.05, 0.04, 0.03, 0.03, 0.03],
    specimen: 'Glass window, 0.68 kg/m²',
    source: 'vorlaender-2008',
  }),
  wall('plaster', {
    bands: [0.15, 0.1, 0.06, 0.04, 0.04, 0.05],
    specimen: '2 × 13 mm plasterboard on steel frame, 50 mm mineral wool in cavity, painted',
    source: 'vorlaender-2008',
  }),
  wall('wood', {
    bands: [0.27, 0.23, 0.22, 0.15, 0.1, 0.07],
    specimen: 'Wooden lining, 12 mm, fixed on frame',
    source: 'vorlaender-2008',
  }),
  wall('curtain', {
    bands: [0.3, 0.45, 0.65, 0.56, 0.59, 0.71],
    specimen: 'Cotton curtains, 0.5 kg/m², draped to 3/4 area, about 130 mm from the wall',
    source: 'vorlaender-2008',
  }),
  wall('foam', {
    bands: [0.12, 0.33, 0.83, 0.97, 0.98, 0.95],
    specimen: 'Wedge-shaped melamine foam tile',
    source: 'vorlaender-2008',
  }),
];

export function wallMaterial(id: WallMaterialId): WallMaterial {
  const material = WALL_MATERIALS.find((m) => m.id === id);
  if (!material) throw new Error(`Unknown wall material: ${id}`);
  return material;
}

export interface FloorMaterial extends MaterialSource {
  id: FloorMaterialId;
  alpha: number;
}

function floor(id: FloorMaterialId, source: MaterialSource): FloorMaterial {
  return { id, ...source, alpha: singleAlpha(source.bands) };
}

export const FLOOR_MATERIALS: readonly FloorMaterial[] = [
  floor('tile', {
    bands: [0.01, 0.01, 0.01, 0.02, 0.02, 0.02],
    specimen: 'Ceramic tiles with a smooth surface',
    source: 'vorlaender-2008',
  }),
  floor('wood', {
    bands: [0.09, 0.06, 0.05, 0.05, 0.05, 0.04],
    specimen: 'Wood floor, 2 layers, 33 mm on sleepers over concrete',
    source: 'vorlaender-2008',
  }),
  floor('carpet', {
    bands: [0.08, 0.08, 0.3, 0.6, 0.75, 0.8],
    specimen: '9 mm tufted pile carpet on felt underlay',
    source: 'vorlaender-2008',
  }),
  floor('tatami', {
    // Read off a chart (figure 3 of the source), to about ±0.01.
    bands: [0.3, 0.345, 0.295, 0.43, 0.51, 0.49],
    specimen: 'Tatami with a 50 mm rice-straw core',
    source: 'kumamoto-2014',
  }),
];

export function floorMaterial(id: FloorMaterialId): FloorMaterial {
  const material = FLOOR_MATERIALS.find((m) => m.id === id);
  if (!material) throw new Error(`Unknown floor material: ${id}`);
  return material;
}

/** Pressure reflection factor of a wave that hits the wall head-on. */
export function reflectionFromAlpha(alpha: number): number {
  return Math.sqrt(1 - alpha);
}

/** Wall admittance β used by the update rule: β = (1 − R) / (1 + R). */
export function betaFromAlpha(alpha: number): number {
  const r = reflectionFromAlpha(alpha);
  return (1 - r) / (1 + r);
}

export const CEILING_ALPHA = 0.05;
export const CEILING_HEIGHT_M = 2.4;

/**
 * Uniform damping σ [1/s] that stands in for the floor and the ceiling, which a 2D simulation
 * does not have. Derived from Sabine's formula restricted to those two surfaces.
 */
export function floorSigma(alphaFloor: number): number {
  return (42.9 * (alphaFloor + CEILING_ALPHA)) / CEILING_HEIGHT_M;
}
