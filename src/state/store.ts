// Application state (spec 10-room-echo 3, 6). React components read it with useRoom(); the
// engine (src/app/engine.ts) subscribes to it outside React. The scene part (size, walls,
// floor, source) has the shape the URL will store in M3.

import { create } from 'zustand';
import { DEFAULT_SLOWDOWN, REDUCED_MOTION_SLOWDOWN } from '../sim/display';
import { ABSORBER_CELLS, type RoomSize } from '../sim/grid';
import type { FloorMaterialId, WallMaterialId } from '../sim/materials';
import { TONE_MAX_HZ, TONE_MIN_HZ } from '../sim/sources';
import { CELL_CM, centreShift, clampToDomain, recentre, type Vec, type Wall } from '../sim/walls';
import type { ViewMode } from '../gpu/render';
import { bedroom } from './defaultScene';

export type Tool = 'wall' | 'erase' | 'source';
export type SourceType = 'clap' | 'tone';

/** A rectangle in CSS pixels. */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The source stays this far inside the domain edge: clear of the absorbing layer. */
export const SOURCE_MARGIN_CM = Math.ceil((ABSORBER_CELLS + 4) * CELL_CM);

const HISTORY_LIMIT = 100;

export interface RoomState {
  size: RoomSize;
  walls: Wall[];
  floor: FloorMaterialId;
  source: Vec;

  tool: Tool;
  /** Material of the next wall drawn. */
  material: WallMaterialId;
  view: ViewMode;
  relief: boolean;
  sourceType: SourceType;
  toneHz: number;
  /** How many times slower than real time the picture runs. */
  slowdown: number;
  playing: boolean;
  panelOpen: boolean;
  /** Where the domain is drawn on screen; set by the stage from the window size. */
  stage: ScreenRect | null;

  /** Bumped to ask the engine for a clap at the source. */
  clapCount: number;
  /** Bumped to ask the engine to silence the field. */
  resetCount: number;
  /** True once the visitor has clapped; hides the "Click anywhere to clap" hint. */
  visitorClapped: boolean;

  past: Wall[][];
  future: Wall[][];

  setTool(tool: Tool): void;
  setMaterial(material: WallMaterialId): void;
  setFloor(floor: FloorMaterialId): void;
  setView(view: ViewMode): void;
  setRelief(relief: boolean): void;
  setSourceType(type: SourceType): void;
  setToneHz(hz: number): void;
  setSlowdown(slowdown: number): void;
  setPlaying(playing: boolean): void;
  setPanelOpen(open: boolean): void;
  setStage(rect: ScreenRect | null): void;
  setSize(size: RoomSize): void;

  /** Replace the walls as part of an edit in progress (an eraser stroke); no undo entry. */
  replaceWalls(walls: Wall[]): void;
  /** Close an edit that started from `before`: one undo entry if anything changed. */
  commitWalls(before: Wall[]): void;
  addWall(wall: Wall): void;
  setWallMaterial(index: number, material: WallMaterialId): void;
  clearWalls(): void;
  resetRoom(): void;
  undo(): void;
  redo(): void;

  moveSource(p: Vec): void;
  /** Clap at the source, or move the source to `at` first. */
  clap(at?: Vec, byVisitor?: boolean): void;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function pushHistory(past: Wall[][], walls: Wall[]): Wall[][] {
  const next = [...past, walls];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

export const useRoom = create<RoomState>()((set, get) => {
  const scene = bedroom();
  return {
    ...scene,
    tool: 'source',
    material: 'plaster',
    view: 'wave',
    relief: true,
    sourceType: 'clap',
    toneHz: 440,
    slowdown: prefersReducedMotion() ? REDUCED_MOTION_SLOWDOWN : DEFAULT_SLOWDOWN,
    playing: true,
    panelOpen: true,
    stage: null,
    clapCount: 0,
    resetCount: 0,
    visitorClapped: false,
    past: [],
    future: [],

    setTool: (tool) => set({ tool }),
    setMaterial: (material) => set({ material }),
    setFloor: (floor) => set({ floor }),
    setView: (view) => set({ view }),
    setRelief: (relief) => set({ relief }),
    setSourceType: (sourceType) => set({ sourceType }),
    setToneHz: (hz) =>
      set({ toneHz: Math.min(TONE_MAX_HZ, Math.max(TONE_MIN_HZ, Math.round(hz * 10) / 10)) }),
    setSlowdown: (slowdown) => set({ slowdown }),
    setPlaying: (playing) => set({ playing }),
    setPanelOpen: (panelOpen) => set({ panelOpen }),
    setStage: (stage) => set({ stage }),
    setSize: (size) => {
      const state = get();
      if (size === state.size) return;
      const shift = centreShift(state.size, size);
      const source = clampToDomain(
        [state.source[0] + shift[0], state.source[1] + shift[1]],
        size,
        SOURCE_MARGIN_CM,
      );
      set({
        size,
        walls: recentre(state.walls, state.size, size),
        past: state.past.map((walls) => recentre(walls, state.size, size)),
        future: state.future.map((walls) => recentre(walls, state.size, size)),
        source,
      });
    },

    replaceWalls: (walls) => set({ walls }),
    commitWalls: (before) => {
      const { walls, past } = get();
      if (walls === before) return;
      set({ past: pushHistory(past, before), future: [] });
    },
    addWall: (wall) => {
      const { walls, past } = get();
      set({ walls: [...walls, wall], past: pushHistory(past, walls), future: [] });
    },
    setWallMaterial: (index, material) => {
      const { walls, past } = get();
      if (!walls[index] || walls[index].m === material) return;
      const next = walls.map((w, i) => (i === index ? { ...w, m: material } : w));
      set({ walls: next, past: pushHistory(past, walls), future: [] });
    },
    // Clearing all walls is starting over: the field is silenced too, so the new room is drawn
    // on a quiet picture. (Erasing single walls keeps the sound, to hear an opening appear.)
    clearWalls: () => {
      const { walls, past, resetCount } = get();
      if (walls.length === 0) return;
      set({
        walls: [],
        past: pushHistory(past, walls),
        future: [],
        resetCount: resetCount + 1,
      });
    },
    resetRoom: () => {
      const { walls, past, size } = get();
      const room = bedroom();
      const fitted = recentre(room.walls, room.size, size);
      const shift = centreShift(room.size, size);
      set({
        walls: fitted,
        floor: room.floor,
        source: clampToDomain(
          [room.source[0] + shift[0], room.source[1] + shift[1]],
          size,
          SOURCE_MARGIN_CM,
        ),
        past: pushHistory(past, walls),
        future: [],
        resetCount: get().resetCount + 1,
      });
    },
    undo: () => {
      const { past, future, walls } = get();
      if (past.length === 0) return;
      set({ walls: past[past.length - 1], past: past.slice(0, -1), future: [walls, ...future] });
    },
    redo: () => {
      const { past, future, walls } = get();
      if (future.length === 0) return;
      set({ walls: future[0], future: future.slice(1), past: pushHistory(past, walls) });
    },

    moveSource: (p) => set({ source: clampToDomain(p, get().size, SOURCE_MARGIN_CM) }),
    clap: (at, byVisitor = false) => {
      const state = get();
      set({
        source: at ? clampToDomain(at, state.size, SOURCE_MARGIN_CM) : state.source,
        sourceType: 'clap',
        playing: true,
        clapCount: state.clapCount + 1,
        visitorClapped: state.visitorClapped || byVisitor,
      });
    },
  };
});
