// Walls as straight segments in centimetres (spec 10-room-echo 3, 6). The editor works on these
// and the URL stores them (M3). rasterizeWalls() turns them into the cells of geometry.ts.
//
// Coordinates are integer centimetres from the top-left corner of the domain, absorbing layer
// included. A wall is 10 cm thick with round ends, so walls that meet at an end point join
// without a notch, and an opening cut with the eraser is as wide as the gap the screen shows.

import { createGrid, wallCode, type CellGrid } from './geometry';
import { DX, ROOM_SIZES, type RoomSize } from './grid';
import type { WallMaterialId } from './materials';

export type Vec = [number, number];

export interface Wall {
  a: Vec;
  b: Vec;
  m: WallMaterialId;
}

export const WALL_THICKNESS_CM = 10;
/** Width of one cell [cm] ≈ 1.021. */
export const CELL_CM = DX * 100;
/** Pieces shorter than this are dropped when the eraser cuts a wall. */
export const MIN_WALL_CM = 5;
/** Free-angle end points snap to this grid, and axis-locked walls to multiples of it. */
export const SNAP_GRID_CM = 5;
/** A drag within this angle of horizontal or vertical is drawn exactly horizontal or vertical. */
export const AUTO_AXIS_DEGREES = 3;

/** Size of the whole domain [cm], absorbing layer included. */
export function domainCm(size: RoomSize): Vec {
  const { nx, ny } = ROOM_SIZES[size];
  return [nx * CELL_CM, ny * CELL_CM];
}

/** The cell that contains a point. */
export function cellOf(p: Vec): { x: number; y: number } {
  return { x: Math.floor(p[0] / CELL_CM), y: Math.floor(p[1] / CELL_CM) };
}

function sub(p: Vec, q: Vec): Vec {
  return [p[0] - q[0], p[1] - q[1]];
}

function lerp(a: Vec, b: Vec, t: number): Vec {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function distance(p: Vec, q: Vec): number {
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

export function wallLength(wall: Wall): number {
  return distance(wall.a, wall.b);
}

/** Parameter t ∈ [0, 1] of the point of segment ab closest to p. */
function closestT(p: Vec, a: Vec, b: Vec): number {
  const [dx, dy] = sub(b, a);
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  return Math.min(1, Math.max(0, t));
}

export function closestPoint(p: Vec, a: Vec, b: Vec): Vec {
  return lerp(a, b, closestT(p, a, b));
}

export function distanceToSegment(p: Vec, a: Vec, b: Vec): number {
  return distance(p, closestPoint(p, a, b));
}

function roundVec(p: Vec): Vec {
  return [Math.round(p[0]), Math.round(p[1])];
}

// ---------------------------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------------------------

/** Paint one wall into the grid: every cell whose centre is within half the thickness. */
export function paintWall(grid: CellGrid, wall: Wall, code = wallCode(wall.m)): void {
  const { nx, ny, cells } = grid;
  const r = WALL_THICKNESS_CM / 2;
  const { a, b } = wall;
  // The outermost ring stays the β = 1 edge.
  const x0 = Math.max(1, Math.floor((Math.min(a[0], b[0]) - r) / CELL_CM));
  const x1 = Math.min(nx - 2, Math.ceil((Math.max(a[0], b[0]) + r) / CELL_CM));
  const y0 = Math.max(1, Math.floor((Math.min(a[1], b[1]) - r) / CELL_CM));
  const y1 = Math.min(ny - 2, Math.ceil((Math.max(a[1], b[1]) + r) / CELL_CM));
  const centre: Vec = [0, 0];
  for (let y = y0; y <= y1; y++) {
    centre[1] = (y + 0.5) * CELL_CM;
    for (let x = x0; x <= x1; x++) {
      centre[0] = (x + 0.5) * CELL_CM;
      if (distanceToSegment(centre, a, b) <= r) cells[y * nx + x] = code;
    }
  }
}

/** An nx × ny grid with the β = 1 edge and every wall painted in. */
export function rasterizeWalls(walls: readonly Wall[], nx: number, ny: number): CellGrid {
  const grid = createGrid(nx, ny);
  for (const wall of walls) paintWall(grid, wall);
  return grid;
}

// ---------------------------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------------------------

/**
 * The part of wall ab within `radius` of segment cd, as an interval [t0, t1] of ab, or null.
 * The distance from a point moving along ab to segment cd is convex in t, so the part is one
 * interval: find the closest t, then the two crossings of `radius` on either side of it.
 */
export function coveredInterval(
  a: Vec,
  b: Vec,
  c: Vec,
  d: Vec,
  radius: number,
): [number, number] | null {
  const f = (t: number): number => distanceToSegment(lerp(a, b, t), c, d);
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 60; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (f(m1) <= f(m2)) hi = m2;
    else lo = m1;
  }
  const tMin = (lo + hi) / 2;
  // A hair of tolerance, so a path that exactly touches the centre line counts.
  if (f(tMin) > radius + 1e-9) return null;
  const crossing = (inside: number, outside: number): number => {
    let i = inside;
    let o = outside;
    for (let k = 0; k < 50; k++) {
      const m = (i + o) / 2;
      if (f(m) <= radius) i = m;
      else o = m;
    }
    return i;
  };
  const t0 = f(0) <= radius ? 0 : crossing(tMin, 0);
  const t1 = f(1) <= radius ? 1 : crossing(tMin, 1);
  return [t0, t1];
}

/**
 * Cut away the parts of all walls within `radius` of the eraser's path from `from` to `to`.
 * Returns the same array when nothing was touched.
 */
export function eraseAlong(walls: readonly Wall[], from: Vec, to: Vec, radius: number): Wall[] {
  let changed = false;
  const out: Wall[] = [];
  for (const wall of walls) {
    const covered = coveredInterval(wall.a, wall.b, from, to, radius);
    if (!covered) {
      out.push(wall);
      continue;
    }
    changed = true;
    const [t0, t1] = covered;
    const pieces: Wall[] = [
      { a: wall.a, b: roundVec(lerp(wall.a, wall.b, t0)), m: wall.m },
      { a: roundVec(lerp(wall.a, wall.b, t1)), b: wall.b, m: wall.m },
    ];
    for (const piece of pieces) {
      if (wallLength(piece) >= MIN_WALL_CM) out.push(piece);
    }
  }
  return changed ? out : (walls as Wall[]);
}

/**
 * Index of the wall under point p, or −1. A wall counts when p is within its half thickness
 * plus `tolerance` of its centre line; the nearest such wall wins.
 */
export function wallAt(walls: readonly Wall[], p: Vec, tolerance: number): number {
  let best = -1;
  let bestDistance = WALL_THICKNESS_CM / 2 + tolerance;
  walls.forEach((wall, i) => {
    const d = distanceToSegment(p, wall.a, wall.b);
    if (d <= bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

export type SnapKind = 'endpoint' | 'wall' | 'axis' | 'grid';

export interface Snap {
  point: Vec;
  kind: SnapKind;
}

function nearestEndpoint(walls: readonly Wall[], p: Vec, radius: number): Vec | null {
  let best: Vec | null = null;
  let bestDistance = radius;
  for (const wall of walls) {
    for (const end of [wall.a, wall.b]) {
      const d = distance(p, end);
      if (d <= bestDistance) {
        best = end;
        bestDistance = d;
      }
    }
  }
  return best;
}

function nearestOnWall(walls: readonly Wall[], p: Vec, radius: number): Vec | null {
  let best: Vec | null = null;
  let bestDistance = radius;
  for (const wall of walls) {
    const q = closestPoint(p, wall.a, wall.b);
    const d = distance(p, q);
    if (d <= bestDistance) {
      best = q;
      bestDistance = d;
    }
  }
  return best;
}

function snapToGrid(p: Vec): Vec {
  return [
    Math.round(p[0] / SNAP_GRID_CM) * SNAP_GRID_CM,
    Math.round(p[1] / SNAP_GRID_CM) * SNAP_GRID_CM,
  ];
}

/** Where a new wall starts: an existing end point, a point on a wall, or the grid. */
export function snapStart(p: Vec, walls: readonly Wall[], radius: number): Snap {
  const end = nearestEndpoint(walls, p, radius);
  if (end) return { point: [end[0], end[1]], kind: 'endpoint' };
  const on = nearestOnWall(walls, p, radius);
  if (on) return { point: roundVec(on), kind: 'wall' };
  return { point: snapToGrid(p), kind: 'grid' };
}

/**
 * Where a wall from `start` ends when the pointer is at p.
 *
 * - With the axis locked (Shift, or a drag within 3° of an axis), the wall is horizontal or
 *   vertical. It stops on an existing wall it reaches, lines up with an end point it passes
 *   near, or else gets a length in whole multiples of 5 cm.
 * - Otherwise it ends on an existing end point or wall near the pointer, or on the 5 cm grid.
 */
export function snapEnd(
  start: Vec,
  p: Vec,
  walls: readonly Wall[],
  radius: number,
  lockAxis: boolean,
): Snap {
  const [dx, dy] = sub(p, start);
  const angle = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
  const nearAxis = angle <= AUTO_AXIS_DEGREES || angle >= 90 - AUTO_AXIS_DEGREES;

  if (!lockAxis) {
    const end = nearestEndpoint(walls, p, radius);
    if (end) return { point: [end[0], end[1]], kind: 'endpoint' };
  }

  if (lockAxis || nearAxis) {
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const free = horizontal ? 0 : 1;
    const fixed = horizontal ? 1 : 0;
    const point: Vec = [0, 0];
    point[fixed] = start[fixed];
    point[free] = p[free];
    // Stop on a wall that crosses the locked line near the pointer.
    for (const wall of walls) {
      const lo = Math.min(wall.a[fixed], wall.b[fixed]);
      const hi = Math.max(wall.a[fixed], wall.b[fixed]);
      if (start[fixed] < lo || start[fixed] > hi || hi === lo) continue;
      const t = (start[fixed] - wall.a[fixed]) / (wall.b[fixed] - wall.a[fixed]);
      const at = wall.a[free] + t * (wall.b[free] - wall.a[free]);
      if (Math.abs(at - p[free]) <= radius && Math.abs(at - start[free]) > MIN_WALL_CM) {
        point[free] = Math.round(at);
        return { point, kind: 'wall' };
      }
    }
    // Line up with an end point the locked line passes near.
    let best: number | null = null;
    let bestDistance = radius;
    for (const wall of walls) {
      for (const end of [wall.a, wall.b]) {
        const d = Math.abs(end[free] - p[free]);
        if (d <= bestDistance) {
          best = end[free];
          bestDistance = d;
        }
      }
    }
    if (best !== null) {
      point[free] = best;
      return { point, kind: 'endpoint' };
    }
    const length = Math.round((p[free] - start[free]) / SNAP_GRID_CM) * SNAP_GRID_CM;
    point[free] = start[free] + length;
    return { point, kind: 'axis' };
  }

  const on = nearestOnWall(walls, p, radius);
  if (on) return { point: roundVec(on), kind: 'wall' };
  return { point: snapToGrid(p), kind: 'grid' };
}

/** Keep a point inside the domain, `margin` cm away from its edge. */
export function clampToDomain(p: Vec, size: RoomSize, margin: number): Vec {
  const [w, h] = domainCm(size);
  return [
    Math.min(w - margin, Math.max(margin, Math.round(p[0]))),
    Math.min(h - margin, Math.max(margin, Math.round(p[1]))),
  ];
}

/**
 * Move walls and a point from one room size to another, keeping them centred. Walls that
 * leave the new domain are clipped by the rasteriser, not removed, so switching back restores
 * them.
 */
export function recentre(walls: readonly Wall[], from: RoomSize, to: RoomSize): Wall[] {
  const shift = centreShift(from, to);
  return walls.map((w) => ({
    a: [w.a[0] + shift[0], w.a[1] + shift[1]],
    b: [w.b[0] + shift[0], w.b[1] + shift[1]],
    m: w.m,
  }));
}

export function centreShift(from: RoomSize, to: RoomSize): Vec {
  const [fw, fh] = domainCm(from);
  const [tw, th] = domainCm(to);
  return [Math.round((tw - fw) / 2), Math.round((th - fh) / 2)];
}
