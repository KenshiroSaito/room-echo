import { describe, expect, it } from 'vitest';
import {
  AIR,
  DEFAULT_ABSORBER,
  EDGE,
  absorberAxis,
  buildCoefficients,
  createGrid,
  fillRect,
  wallCode,
} from './geometry';
import { ABSORBER_CELLS, ABSORBER_SIGMA_MAX_DT, COURANT, DX, LAMBDA2, ROOM_SIZES } from './grid';
import { betaFromAlpha, floorSigma, reflectionFromAlpha } from './materials';

describe('grid', () => {
  it('has the spacing and the cell counts of spec 5.1', () => {
    expect(DX * 100).toBeCloseTo(1.021, 3);
    expect([ROOM_SIZES.S.nx, ROOM_SIZES.S.ny]).toEqual([588, 441]);
    expect([ROOM_SIZES.M.nx, ROOM_SIZES.M.ny]).toEqual([784, 588]);
    expect([ROOM_SIZES.L.nx, ROOM_SIZES.L.ny]).toEqual([1176, 882]);
  });

  it('stays below the 2D stability limit', () => {
    expect(COURANT).toBeLessThan(Math.SQRT1_2);
  });
});

describe('materials', () => {
  it('maps absorption to reflection and admittance', () => {
    expect(reflectionFromAlpha(0)).toBe(1);
    expect(betaFromAlpha(0)).toBe(0);
    expect(betaFromAlpha(1)).toBe(1);
    const beta = betaFromAlpha(0.5);
    expect((1 - beta) / (1 + beta)).toBeCloseTo(Math.sqrt(0.5), 12);
  });

  it('gives the Sabine reverberation time for floor and ceiling alone', () => {
    // RT60 = 0.161·V/A with V = area·H and A = area·(α_floor + α_ceiling); energy falls as
    // exp(−2σt), so RT60 = 6·ln(10) / (2σ).
    const sigma = floorSigma(0.3);
    const rt60 = (6 * Math.LN10) / (2 * sigma);
    expect(rt60).toBeCloseTo((0.161 * 2.4) / (0.3 + 0.05), 2);
  });
});

describe('buildCoefficients', () => {
  it('reduces to the standard rule away from walls', () => {
    const grid = createGrid(8, 8);
    const coeff = buildCoefficients(grid);
    const i = 4 * 8 + 4;
    expect(coeff[2 * i]).toBeCloseTo(2 - 4 * LAMBDA2, 6);
    expect(coeff[2 * i + 1]).toBe(0);
  });

  it('counts air neighbours and sums the admittance of wall neighbours', () => {
    const grid = createGrid(8, 8);
    fillRect(grid, 3, 4, 4, 5, wallCode('foam'));
    fillRect(grid, 4, 3, 5, 4, wallCode('curtain'));
    const coeff = buildCoefficients(grid);
    const i = 4 * 8 + 4; // foam on the left, curtain above
    expect(coeff[2 * i]).toBeCloseTo(2 - 2 * LAMBDA2, 6);
    expect(coeff[2 * i + 1]).toBeCloseTo(
      (COURANT / 2) * (betaFromAlpha(0.9) + betaFromAlpha(0.55)),
      6,
    );
    const wall = 4 * 8 + 3;
    expect(coeff[2 * wall + 1]).toBeLessThan(0);
  });

  it('treats the outermost ring as a β = 1 wall', () => {
    const grid = createGrid(8, 8);
    expect(grid.cells[0]).toBe(EDGE);
    const coeff = buildCoefficients(grid);
    const i = 1 * 8 + 1; // corner cell: edge on the left and above
    expect(coeff[2 * i + 1]).toBeCloseTo((COURANT / 2) * 2, 6);
  });

  it('adds the absorbing layer and the floor to D', () => {
    const grid = createGrid(100, 80);
    const coeff = buildCoefficients(grid, { absorber: DEFAULT_ABSORBER, uniformSigmaDt: 0.001 });
    const inside = 40 * 100 + 50;
    expect(coeff[2 * inside + 1]).toBeCloseTo(0.001, 7);
    const depth = ABSORBER_CELLS - 6;
    const expected = ABSORBER_SIGMA_MAX_DT * (depth / ABSORBER_CELLS) ** 2;
    const inLayer = 40 * 100 + 6;
    expect(coeff[2 * inLayer + 1]).toBeCloseTo(expected + 0.001, 6);
    const corner = 6 * 100 + 6; // both axes
    expect(coeff[2 * corner + 1]).toBeCloseTo(2 * expected + 0.001, 6);
  });

  it('refuses a grid whose outermost ring has air', () => {
    const grid = createGrid(8, 8);
    grid.cells[3] = AIR;
    expect(() => buildCoefficients(grid)).toThrow();
  });
});

describe('absorberAxis', () => {
  it('is zero inside the room and σ_max at the outer end', () => {
    expect(absorberAxis(ABSORBER_CELLS, 200, true, true, DEFAULT_ABSORBER)).toBe(0);
    expect(absorberAxis(100, 200, true, true, DEFAULT_ABSORBER)).toBe(0);
    expect(absorberAxis(0, 200, true, true, DEFAULT_ABSORBER)).toBeCloseTo(
      ABSORBER_SIGMA_MAX_DT,
      12,
    );
    expect(absorberAxis(199, 200, true, true, DEFAULT_ABSORBER)).toBeCloseTo(
      ABSORBER_SIGMA_MAX_DT,
      12,
    );
    expect(absorberAxis(0, 200, false, true, DEFAULT_ABSORBER)).toBe(0);
  });
});
