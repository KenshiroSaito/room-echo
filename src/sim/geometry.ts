// Cells → per-cell coefficients of the update rule (spec 10-room-echo 5.2, 5.3).
//
// Every cell is either air or wall. A wall cell carries a material code that selects its
// admittance β. The update rule needs, for each air cell:
//   K = number of air neighbours (0–4)
//   B = (λ/2) · Σ β over wall neighbours
//   D = σ·Δt (absorbing layer + floor)
// These are packed as two 32-bit floats per cell:
//   air:  [ 2 − K·λ²,  B + D ]
//   wall: [ 0,        −1     ]   (a negative second value marks a wall)
//
// The absorbing layer needs two more terms inside the layer. They depend only on the position
// of the cell, so the solvers compute them from the Absorber settings (see reference.ts).

import { ABSORBER_CELLS, ABSORBER_SIGMA_MAX_DT, COURANT, LAMBDA2 } from './grid';
import type { Absorber } from './sim';
import { WALL_MATERIALS, betaFromAlpha, type WallMaterialId } from './materials';

export const AIR = 0;
/** Fully reflecting wall (β = 0). Used by the validation scenes. */
export const RIGID = 254;
/** The outermost ring of the domain (β = 1). */
export const EDGE = 255;

export interface CellGrid {
  nx: number;
  ny: number;
  /** One material code per cell, row by row. 0 is air. */
  cells: Uint8Array;
}

export function wallCode(id: WallMaterialId): number {
  const index = WALL_MATERIALS.findIndex((m) => m.id === id);
  if (index < 0) throw new Error(`Unknown wall material: ${id}`);
  return index + 1;
}

const BETA_BY_CODE = new Float64Array(256).fill(Number.NaN);
WALL_MATERIALS.forEach((m, i) => {
  BETA_BY_CODE[i + 1] = betaFromAlpha(m.alpha);
});
BETA_BY_CODE[RIGID] = 0;
BETA_BY_CODE[EDGE] = 1;

/**
 * Codes 128–253 are reserved for tests and tuning scripts: they select β directly through
 * `customBeta`. Regular scenes never contain them.
 */
export const CUSTOM_CODE_MIN = 128;
export const CUSTOM_CODE_MAX = 253;

export function betaForCode(code: number, customBeta?: ReadonlyMap<number, number>): number {
  const custom = customBeta?.get(code);
  if (custom !== undefined) return custom;
  const beta = BETA_BY_CODE[code];
  if (Number.isNaN(beta)) throw new Error(`Cell code ${code} has no material`);
  return beta;
}

/** An all-air grid whose outermost ring is the β = 1 edge. */
export function createGrid(nx: number, ny: number): CellGrid {
  if (nx < 3 || ny < 3) throw new Error('The grid must be at least 3 × 3');
  const grid: CellGrid = { nx, ny, cells: new Uint8Array(nx * ny) };
  strokeRect(grid, 0, 0, nx, ny, 1, EDGE);
  return grid;
}

/** Fill [x0, x1) × [y0, y1), clipped to the grid. */
export function fillRect(
  grid: CellGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  code: number,
): void {
  const xa = Math.max(0, x0);
  const xb = Math.min(grid.nx, x1);
  const ya = Math.max(0, y0);
  const yb = Math.min(grid.ny, y1);
  for (let y = ya; y < yb; y++) {
    grid.cells.fill(code, y * grid.nx + xa, y * grid.nx + xb);
  }
}

/** Outline of [x0, x1) × [y0, y1), drawn inward with the given thickness. */
export function strokeRect(
  grid: CellGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness: number,
  code: number,
): void {
  fillRect(grid, x0, y0, x1, y0 + thickness, code);
  fillRect(grid, x0, y1 - thickness, x1, y1, code);
  fillRect(grid, x0, y0, x0 + thickness, y1, code);
  fillRect(grid, x1 - thickness, y0, x1, y1, code);
}

/** The absorbing layer of a regular scene: 24 cells on all four edges (spec 5.3). */
export const DEFAULT_ABSORBER: Absorber = {
  cells: ABSORBER_CELLS,
  sigmaMaxDt: ABSORBER_SIGMA_MAX_DT,
  left: true,
  right: true,
  top: true,
  bottom: true,
  matched: true,
};

export const NO_ABSORBER: Absorber = {
  cells: 0,
  sigmaMaxDt: 0,
  left: false,
  right: false,
  top: false,
  bottom: false,
  matched: true,
};

/**
 * σ·Δt of the layer along one axis: σ_max·Δt · (d / cells)², where d is the depth from the inner
 * end of the layer. `position` is in cells; cell centres are at whole numbers and the faces
 * between cells at halves. `count` is the number of cells along the axis.
 */
export function absorberAxis(
  position: number,
  count: number,
  low: boolean,
  high: boolean,
  absorber: Absorber,
): number {
  const { cells, sigmaMaxDt } = absorber;
  if (cells <= 0 || sigmaMaxDt <= 0) return 0;
  let depth = 0;
  if (low) depth = Math.max(depth, cells - position);
  if (high) depth = Math.max(depth, cells - (count - 1 - position));
  const u = Math.min(depth, cells) / cells;
  return sigmaMaxDt * u * u;
}

/**
 * σ·Δt of the layer sampled at every half cell along one axis: index 2·x is the centre of cell
 * x, index 2·x + 1 the face between x and x + 1. Index −1 does not exist; cell 0 is always wall.
 */
export function absorberTable(
  count: number,
  low: boolean,
  high: boolean,
  absorber: Absorber,
): Float32Array {
  const table = new Float32Array(2 * count);
  for (let k = 0; k < table.length; k++) {
    table[k] = absorberAxis(k / 2, count, low, high, absorber);
  }
  return table;
}

export interface CoefficientOptions {
  /** The absorbing layer. Its σ·Δt is the sum of the two axes, so corners get both. */
  absorber?: Absorber;
  /** σ·Δt added to every air cell (floor and ceiling, spec 5.5). */
  uniformSigmaDt?: number;
  /** β for the reserved custom codes. */
  customBeta?: ReadonlyMap<number, number>;
}

/**
 * Pack the coefficients of the update rule, two floats per cell (see the top of this file).
 * The outermost ring must be wall, so that no air cell reads outside the grid.
 */
export function buildCoefficients(grid: CellGrid, options: CoefficientOptions = {}): Float32Array {
  const { nx, ny, cells } = grid;
  const { absorber = NO_ABSORBER, uniformSigmaDt = 0, customBeta } = options;
  const sigmaX = absorberTable(nx, absorber.left, absorber.right, absorber);
  const sigmaY = absorberTable(ny, absorber.top, absorber.bottom, absorber);

  for (let x = 0; x < nx; x++) {
    if (cells[x] === AIR || cells[(ny - 1) * nx + x] === AIR) {
      throw new Error('The outermost ring of the grid must be wall');
    }
  }
  for (let y = 0; y < ny; y++) {
    if (cells[y * nx] === AIR || cells[y * nx + nx - 1] === AIR) {
      throw new Error('The outermost ring of the grid must be wall');
    }
  }

  const betaCache = new Float64Array(256).fill(Number.NaN);
  const betaOf = (code: number): number => {
    let beta = betaCache[code];
    if (Number.isNaN(beta)) {
      beta = betaForCode(code, customBeta);
      betaCache[code] = beta;
    }
    return beta;
  };

  const coeff = new Float32Array(nx * ny * 2);
  const neighbours = [-1, 1, -nx, nx];
  for (let i = 0; i < nx * ny; i++) {
    if (cells[i] !== AIR) {
      coeff[2 * i] = 0;
      coeff[2 * i + 1] = -1;
      continue;
    }
    let airCount = 0;
    let betaSum = 0;
    for (const offset of neighbours) {
      const code = cells[i + offset];
      if (code === AIR) airCount++;
      else betaSum += betaOf(code);
    }
    const b = (COURANT / 2) * betaSum;
    const d = sigmaX[2 * (i % nx)] + sigmaY[2 * Math.floor(i / nx)] + uniformSigmaDt;
    coeff[2 * i] = 2 - airCount * LAMBDA2;
    coeff[2 * i + 1] = b + d;
  }
  return coeff;
}
