import { describe, expect, it } from 'vitest';
import { AIR, EDGE, wallCode } from './geometry';
import { ROOM_SIZES } from './grid';
import {
  CELL_CM,
  MIN_WALL_CM,
  centreShift,
  coveredInterval,
  domainCm,
  eraseAlong,
  rasterizeWalls,
  recentre,
  snapEnd,
  snapStart,
  wallAt,
  wallLength,
  type Wall,
} from './walls';

const plaster = (a: [number, number], b: [number, number]): Wall => ({ a, b, m: 'plaster' });

describe('rasterizeWalls', () => {
  it('paints a 10 cm thick wall with the material code and keeps the edge ring', () => {
    const grid = rasterizeWalls([plaster([100, 100], [300, 100])], 400, 300);
    const code = wallCode('plaster');
    const column = Math.floor(200 / CELL_CM);
    const painted: number[] = [];
    for (let y = 0; y < grid.ny; y++) {
      if (grid.cells[y * grid.nx + column] === code) painted.push(y);
    }
    // 10 cm / 1.021 cm ≈ 9.8 cells.
    expect(painted.length).toBeGreaterThanOrEqual(9);
    expect(painted.length).toBeLessThanOrEqual(10);
    // Contiguous, centred on y = 100 cm.
    expect(painted[painted.length - 1] - painted[0]).toBe(painted.length - 1);
    const centre = ((painted[0] + painted[painted.length - 1] + 1) / 2) * CELL_CM;
    expect(Math.abs(centre - 100)).toBeLessThan(CELL_CM);
    expect(grid.cells[0]).toBe(EDGE);
    expect(grid.cells[150 * grid.nx + 20]).toBe(AIR);
  });

  it('never paints over the outermost ring', () => {
    const grid = rasterizeWalls([plaster([0, 50], [500, 50])], 100, 100);
    for (let y = 0; y < grid.ny; y++) {
      expect(grid.cells[y * grid.nx]).toBe(EDGE);
      expect(grid.cells[y * grid.nx + grid.nx - 1]).toBe(EDGE);
    }
  });

  it('joins two walls that share an end point without a gap', () => {
    const grid = rasterizeWalls(
      [plaster([100, 100], [200, 100]), plaster([200, 100], [200, 200])],
      300,
      300,
    );
    // The outer corner cell at (205, 95) cm lies within the round end of both walls.
    const x = Math.floor(203 / CELL_CM);
    const y = Math.floor(97 / CELL_CM);
    expect(grid.cells[y * grid.nx + x]).toBe(wallCode('plaster'));
  });
});

describe('eraseAlong', () => {
  const wall = plaster([0, 0], [100, 0]);

  it('cuts an opening across a wall', () => {
    const out = eraseAlong([wall], [50, -20], [50, 20], 10);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(plaster([0, 0], [40, 0]));
    expect(out[1]).toEqual(plaster([60, 0], [100, 0]));
  });

  it('returns the same array when the eraser misses', () => {
    const walls = [wall];
    expect(eraseAlong(walls, [50, 30], [60, 30], 10)).toBe(walls);
  });

  it('removes a wall traced along its whole length', () => {
    expect(eraseAlong([wall], [-10, 0], [110, 0], 5)).toEqual([]);
  });

  it('drops pieces shorter than the minimum', () => {
    const out = eraseAlong([wall], [0, -20], [MIN_WALL_CM + 8, 20], 1);
    expect(out.every((w) => wallLength(w) >= MIN_WALL_CM)).toBe(true);
  });

  it('finds the covered part of a wall for a slanted eraser path', () => {
    // The path crosses the wall at x = 50 cm; a point (100·t, 0) of the wall lies
    // 100·|t − 0.5|·sin(angle) from it, with sin(angle) = 60 / √(40² + 60²).
    const covered = coveredInterval([0, 0], [100, 0], [30, -30], [70, 30], 2);
    const half = 2 / ((100 * 60) / Math.hypot(40, 60));
    expect(covered).not.toBeNull();
    expect(covered![0]).toBeCloseTo(0.5 - half, 6);
    expect(covered![1]).toBeCloseTo(0.5 + half, 6);
  });
});

describe('wallAt', () => {
  it('picks the nearest wall under the pointer', () => {
    const walls = [plaster([0, 0], [100, 0]), plaster([0, 12], [100, 12])];
    expect(wallAt(walls, [50, 2], 2)).toBe(0);
    expect(wallAt(walls, [50, 10], 2)).toBe(1);
    expect(wallAt(walls, [50, 40], 2)).toBe(-1);
  });
});

describe('snapping', () => {
  const walls = [plaster([100, 100], [400, 100]), plaster([400, 100], [400, 300])];

  it('starts on a nearby end point, then on a wall, then on the grid', () => {
    expect(snapStart([403, 96], walls, 8)).toEqual({ point: [400, 100], kind: 'endpoint' });
    expect(snapStart([250, 104], walls, 8)).toEqual({ point: [250, 100], kind: 'wall' });
    expect(snapStart([251, 152], walls, 8)).toEqual({ point: [250, 150], kind: 'grid' });
  });

  it('closes a room on an existing end point', () => {
    expect(snapEnd([100, 300], [104, 104], walls, 8, false)).toEqual({
      point: [100, 100],
      kind: 'endpoint',
    });
  });

  it('locks a nearly vertical drag to the axis and stops on the wall it reaches', () => {
    const snap = snapEnd([250, 300], [251, 103], walls, 8, false);
    expect(snap).toEqual({ point: [250, 100], kind: 'wall' });
  });

  it('gives axis-locked walls lengths in multiples of 5 cm', () => {
    const snap = snapEnd([100, 300], [100 + 233, 340], [], 8, true);
    expect(snap).toEqual({ point: [335, 300], kind: 'axis' });
  });

  it('leaves free angles on the 5 cm grid', () => {
    const snap = snapEnd([0, 0], [148, 92], [], 8, false);
    expect(snap).toEqual({ point: [150, 90], kind: 'grid' });
  });
});

describe('room sizes', () => {
  it('converts the domain to centimetres', () => {
    const [w, h] = domainCm('M');
    expect(w).toBeCloseTo(ROOM_SIZES.M.nx * CELL_CM, 6);
    expect(Math.round(w)).toBe(800);
    expect(Math.round(h)).toBe(600);
  });

  it('keeps walls centred when the size changes', () => {
    const shift = centreShift('M', 'L');
    // L is 12 × 9 m, M is 8 × 6 m: half the difference.
    expect(shift).toEqual([200, 150]);
    const moved = recentre([plaster([100, 100], [200, 100])], 'M', 'L');
    expect(moved[0].a).toEqual([300, 250]);
    expect(recentre(moved, 'L', 'M')[0].a).toEqual([100, 100]);
  });
});
