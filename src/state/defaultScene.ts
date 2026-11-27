// The room on screen when the page opens (spec 10-room-echo 2, "First 10 seconds"): an
// unfurnished bedroom with a window and an open door, the source in the middle.

import type { RoomSize } from '../sim/grid';
import type { FloorMaterialId } from '../sim/materials';
import type { Vec, Wall } from '../sim/walls';

export interface Scene {
  size: RoomSize;
  walls: Wall[];
  floor: FloorMaterialId;
  /** Source position [cm]. */
  source: Vec;
}

/** 3.8 m × 3.2 m between wall centres, in the middle of the 8 m × 6 m domain (size M). */
export function bedroom(): Scene {
  const [left, top, right, bottom] = [210, 140, 590, 460];
  return {
    size: 'M',
    walls: [
      { a: [left, top], b: [330, top], m: 'plaster' },
      { a: [330, top], b: [470, top], m: 'glass' },
      { a: [470, top], b: [right, top], m: 'plaster' },
      { a: [right, top], b: [right, bottom], m: 'plaster' },
      // An 80 cm door opening between x = 420 and 500.
      { a: [right, bottom], b: [500, bottom], m: 'plaster' },
      { a: [420, bottom], b: [left, bottom], m: 'plaster' },
      { a: [left, bottom], b: [left, top], m: 'plaster' },
    ],
    floor: 'wood',
    source: [400, 300],
  };
}
