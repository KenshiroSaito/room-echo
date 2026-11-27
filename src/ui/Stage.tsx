// The layer over the canvas: drawing and erasing walls, moving the source and clapping, and
// the labels and numbers next to the picture (spec 10-room-echo 3, 4.1, 4.4; spec 00-common
// 4.1). The picture itself is drawn by the GPU underneath.

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { formatGain, formatLength, formatSimTime, formatSlowdown } from '../sim/display';
import { WALL_MATERIALS, type WallMaterialId } from '../sim/materials';
import {
  WALL_THICKNESS_CM,
  distance,
  domainCm,
  eraseAlong,
  snapEnd,
  snapStart,
  wallAt,
  type SnapKind,
  type Vec,
  type Wall,
} from '../sim/walls';
import { useStats, type Stats } from '../state/stats';
import { useRoom, type ScreenRect } from '../state/store';
import { STRINGS } from '../strings';
import { SERIES } from '../styles/palette';
import controls from './controls.module.css';
import styles from './Stage.module.css';

/** Pointer distances in CSS pixels. */
const SNAP_PX = 10;
const HIT_PX = 6;
const DRAG_PX = 4;
const ERASER_PX = 12;
const SOURCE_HIT_PX = 14;
/** Walls shorter than this on screen get no name label (their colour still tells). */
const LABEL_MIN_PX = 56;
/** The eraser is never smaller than this [cm]. */
const ERASER_MIN_CM = 8;
/** New walls shorter than this are dropped as slips of the hand [cm]. */
const MIN_NEW_WALL_CM = 10;
/** "Click anywhere to clap" appears this long after opening (spec 2). */
const HINT_DELAY_MS = 5000;
/** Size of a wall label, for keeping labels apart: marker and gap, then text at 12 px. */
const LABEL_MARKER_PX = 18;
const LABEL_CHAR_PX = 6.8;
const LABEL_HEIGHT_PX = 16;
/** Space kept between two labels. */
const LABEL_GAP_PX = 4;

/** x0, y0, x1, y1 in CSS pixels. */
type Box = [number, number, number, number];

function overlaps(a: Box, b: Box): boolean {
  return (
    a[0] < b[2] + LABEL_GAP_PX &&
    b[0] < a[2] + LABEL_GAP_PX &&
    a[1] < b[3] + LABEL_GAP_PX &&
    b[1] < a[3] + LABEL_GAP_PX
  );
}

interface Label {
  key: number;
  x: number;
  y: number;
  angle: number;
  material: WallMaterialId;
}

type Drag =
  | { kind: 'draw'; start: Vec; hit: number; moved: boolean; downX: number; downY: number }
  | { kind: 'erase'; before: Wall[]; last: Vec }
  | { kind: 'source'; onMarker: boolean; moved: boolean; downX: number; downY: number };

interface Preview {
  start: Vec;
  end: Vec;
  snap: SnapKind;
}

function materialColour(id: WallMaterialId): string {
  return SERIES[WALL_MATERIALS.findIndex((m) => m.id === id)];
}

export function Stage() {
  const stage = useRoom((s) => s.stage);
  const size = useRoom((s) => s.size);
  const walls = useRoom((s) => s.walls);
  const tool = useRoom((s) => s.tool);
  const material = useRoom((s) => s.material);
  const source = useRoom((s) => s.source);
  const sourceType = useRoom((s) => s.sourceType);
  const toneHz = useRoom((s) => s.toneHz);
  const clapCount = useRoom((s) => s.clapCount);
  const view = useRoom((s) => s.view);

  const drag = useRef<Drag | null>(null);
  const pending = useRef<Vec[]>([]);
  const frame = useRef(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pointer, setPointer] = useState<Vec | null>(null);
  const [hovered, setHovered] = useState(-1);

  const scale = stage ? stage.width / domainCm(size)[0] : 1;
  const toCm = (e: PointerEvent): Vec =>
    stage ? [(e.clientX - stage.x) / scale, (e.clientY - stage.y) / scale] : [0, 0];
  const toPx = (p: Vec): Vec => (stage ? [stage.x + p[0] * scale, stage.y + p[1] * scale] : p);
  const inside = (e: PointerEvent): boolean =>
    !!stage &&
    e.clientX >= stage.x &&
    e.clientX < stage.x + stage.width &&
    e.clientY >= stage.y &&
    e.clientY < stage.y + stage.height;
  const eraserCm = Math.max(ERASER_MIN_CM, ERASER_PX / scale);

  // Erasing rebuilds the cells; do it at most once per frame however fast the pointer moves.
  const flushErase = (stroke: Drag | null = drag.current) => {
    frame.current = 0;
    const d = stroke;
    if (!d || d.kind !== 'erase' || pending.current.length === 0) return;
    let current = useRoom.getState().walls;
    for (const p of pending.current) {
      current = eraseAlong(current, d.last, p, eraserCm);
      d.last = p;
    }
    pending.current = [];
    if (current !== useRoom.getState().walls) useRoom.getState().replaceWalls(current);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drag.current?.kind === 'draw') {
        drag.current = null;
        setPreview(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !inside(e)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toCm(e);
    const state = useRoom.getState();
    if (tool === 'wall') {
      const hit = wallAt(state.walls, p, HIT_PX / scale);
      const start = snapStart(p, state.walls, SNAP_PX / scale).point;
      drag.current = { kind: 'draw', start, hit, moved: false, downX: e.clientX, downY: e.clientY };
    } else if (tool === 'erase') {
      drag.current = { kind: 'erase', before: state.walls, last: p };
      pending.current = [p];
      flushErase();
    } else {
      const [sx, sy] = toPx(state.source);
      const onMarker = Math.hypot(e.clientX - sx, e.clientY - sy) <= SOURCE_HIT_PX;
      drag.current = {
        kind: 'source',
        onMarker,
        moved: false,
        downX: e.clientX,
        downY: e.clientY,
      };
      if (!onMarker) {
        if (state.sourceType === 'tone') state.moveSource(p);
        else state.clap(p, true);
      }
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = toCm(e);
    setPointer(inside(e) ? p : null);
    const d = drag.current;
    const state = useRoom.getState();
    if (!d) {
      setHovered(tool === 'wall' && inside(e) ? wallAt(state.walls, p, HIT_PX / scale) : -1);
      return;
    }
    if (d.kind === 'draw') {
      if (!d.moved && Math.hypot(e.clientX - d.downX, e.clientY - d.downY) < DRAG_PX) return;
      d.moved = true;
      const end = snapEnd(d.start, p, state.walls, SNAP_PX / scale, e.shiftKey);
      setPreview({ start: d.start, end: end.point, snap: end.kind });
    } else if (d.kind === 'erase') {
      pending.current.push(p);
      if (!frame.current) frame.current = requestAnimationFrame(() => flushErase());
    } else {
      if (!d.moved && Math.hypot(e.clientX - d.downX, e.clientY - d.downY) < DRAG_PX) return;
      d.moved = true;
      state.moveSource(p);
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const state = useRoom.getState();
    if (d.kind === 'draw') {
      setPreview(null);
      if (!d.moved) {
        if (d.hit >= 0) state.setWallMaterial(d.hit, state.material);
        return;
      }
      const end = snapEnd(d.start, toCm(e), state.walls, SNAP_PX / scale, e.shiftKey).point;
      if (distance(d.start, end) >= MIN_NEW_WALL_CM) {
        state.addWall({ a: d.start, b: end, m: state.material });
      }
    } else if (d.kind === 'erase') {
      cancelAnimationFrame(frame.current);
      flushErase(d);
      state.commitWalls(d.before);
    } else if (d.onMarker && !d.moved && state.sourceType === 'clap') {
      state.clap(undefined, true);
    }
  };

  const labels = useMemo(() => {
    if (!stage) return [];
    const px = (p: Vec): Vec => [stage.x + p[0] * scale, stage.y + p[1] * scale];
    // Labels go on the side of each wall away from the middle of the drawing.
    let cx = 0;
    let cy = 0;
    for (const w of walls) {
      cx += (w.a[0] + w.b[0]) / 2;
      cy += (w.a[1] + w.b[1]) / 2;
    }
    const centre = px(walls.length ? [cx / walls.length, cy / walls.length] : [0, 0]);
    const offset = (WALL_THICKNESS_CM * scale) / 2 + 11;
    // No two labels may overlap (spec 00-common 5). Walls drawn later are on top, so their
    // labels are placed first; each label tries the middle of its wall, then a quarter and
    // three quarters along it, and is left out if all three collide.
    const placed: Box[] = [];
    const out: Label[] = [];
    for (let i = walls.length - 1; i >= 0; i--) {
      const w = walls[i];
      const [ax, ay] = px(w.a);
      const [bx, by] = px(w.b);
      const length = Math.hypot(bx - ax, by - ay);
      if (length < LABEL_MIN_PX) continue;
      let angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle <= -90) angle += 180;
      const nx = -(by - ay) / length;
      const ny = (bx - ax) / length;
      const width = LABEL_MARKER_PX + LABEL_CHAR_PX * STRINGS.materials[w.m].length;
      const cos = Math.abs(Math.cos((angle * Math.PI) / 180));
      const sin = Math.abs(Math.sin((angle * Math.PI) / 180));
      const halfW = (cos * width + sin * LABEL_HEIGHT_PX) / 2;
      const halfH = (sin * width + cos * LABEL_HEIGHT_PX) / 2;
      for (const t of [0.5, 0.25, 0.75]) {
        const mx = ax + (bx - ax) * t;
        const my = ay + (by - ay) * t;
        const away = (mx - centre[0]) * nx + (my - centre[1]) * ny >= 0 ? 1 : -1;
        const x = mx + away * nx * offset;
        const y = my + away * ny * offset;
        const box: Box = [x - halfW, y - halfH, x + halfW, y + halfH];
        if (placed.some((b) => overlaps(b, box))) continue;
        placed.push(box);
        out.push({ key: i, x, y, angle, material: w.m });
        break;
      }
    }
    return out;
  }, [walls, stage, scale]);

  if (!stage) return null;

  const [sx, sy] = toPx(source);
  const thicknessPx = WALL_THICKNESS_CM * scale;
  const cursor =
    tool === 'wall'
      ? styles.drawCursor
      : tool === 'erase'
        ? styles.eraseCursor
        : styles.sourceCursor;

  return (
    <div
      className={`${styles.surface} ${cursor}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        setPointer(null);
        setHovered(-1);
      }}
      data-testid="stage"
    >
      <svg className={styles.svg} aria-hidden="true">
        {tool === 'wall' && hovered >= 0 && walls[hovered] && !preview && (
          <line
            x1={toPx(walls[hovered].a)[0]}
            y1={toPx(walls[hovered].a)[1]}
            x2={toPx(walls[hovered].b)[0]}
            y2={toPx(walls[hovered].b)[1]}
            className={styles.hover}
            strokeWidth={thicknessPx + 5}
          />
        )}
        {preview && (
          <>
            <line
              x1={toPx(preview.start)[0]}
              y1={toPx(preview.start)[1]}
              x2={toPx(preview.end)[0]}
              y2={toPx(preview.end)[1]}
              stroke={materialColour(material)}
              strokeWidth={Math.max(thicknessPx, 3)}
              className={styles.preview}
            />
            {(preview.snap === 'endpoint' || preview.snap === 'wall') && (
              <circle
                cx={toPx(preview.end)[0]}
                cy={toPx(preview.end)[1]}
                r={6}
                className={styles.snap}
              />
            )}
          </>
        )}
        {tool === 'erase' && pointer && (
          <circle
            cx={toPx(pointer)[0]}
            cy={toPx(pointer)[1]}
            r={eraserCm * scale}
            className={styles.eraser}
          />
        )}
        <circle key={clapCount} cx={sx} cy={sy} r={7} className={styles.ring} />
        <circle cx={sx} cy={sy} r={7} className={styles.source} />
        <circle cx={sx} cy={sy} r={2.5} className={styles.sourceDot} />
      </svg>

      {labels.map((label) => (
        <div
          key={label.key}
          className={styles.wallLabel}
          style={{
            left: label.x,
            top: label.y,
            transform: `translate(-50%, -50%) rotate(${label.angle}deg)`,
          }}
        >
          <span
            className={controls.swatch}
            style={{ background: materialColour(label.material) }}
          />
          {STRINGS.materials[label.material]}
        </div>
      ))}

      {preview && (
        <div
          className={styles.length}
          style={{ left: toPx(preview.end)[0] + 14, top: toPx(preview.end)[1] - 26 }}
        >
          {formatLength(distance(preview.start, preview.end))}
        </div>
      )}

      {sourceType === 'tone' && (
        <div className={styles.toneLabel} style={{ left: sx + 12, top: sy + 8 }}>
          {STRINGS.stage.toneLabel(toneHz)}
        </div>
      )}

      <Readout stage={stage} />
      <Hint stage={stage} />
      {view === 'energy' && <EnergyScale stage={stage} />}
    </div>
  );
}

/**
 * "t = 12.4 ms · Slowed 120×" and "Gain ×8" under the picture (spec 4.1). They change every
 * frame, so they are written straight into the DOM instead of re-rendering React 60 times a
 * second: the display loop stays light on the main thread.
 */
function Readout({ stage }: { stage: ScreenRect }) {
  const slowdown = useRoom((s) => s.slowdown);
  const playing = useRoom((s) => s.playing);
  const view = useRoom((s) => s.view);
  const time = useRef<HTMLSpanElement>(null);
  const gain = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const paint = (stats: Stats) => {
      const timeText = `${formatSimTime(stats.eventSteps)} · ${
        playing ? formatSlowdown(slowdown) : STRINGS.stage.paused
      }`;
      if (time.current && time.current.textContent !== timeText) {
        time.current.textContent = timeText;
      }
      const gainText = (view === 'wave' ? formatGain(stats.gain) : null) ?? '';
      if (gain.current && gain.current.textContent !== gainText) {
        gain.current.textContent = gainText;
      }
    };
    paint(useStats.getState());
    return useStats.subscribe(paint);
  }, [playing, slowdown, view]);
  return (
    <div
      className={styles.readout}
      style={{ left: stage.x + 12, top: stage.y + stage.height - 12 }}
      data-testid="readout"
    >
      <span ref={time} />
      <span ref={gain} className={styles.gain} />
    </div>
  );
}

function Hint({ stage }: { stage: ScreenRect }) {
  const visitorClapped = useRoom((s) => s.visitorClapped);
  const tool = useRoom((s) => s.tool);
  const [due, setDue] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDue(true), HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!due || visitorClapped || tool !== 'source') return null;
  return (
    <div className={styles.hint} style={{ left: stage.x + stage.width / 2, top: stage.y + 16 }}>
      {STRINGS.stage.hint}
    </div>
  );
}

function EnergyScale({ stage }: { stage: ScreenRect }) {
  return (
    <div
      className={styles.energyScale}
      style={{ left: stage.x + stage.width - 12, top: stage.y + stage.height - 12 }}
      title={STRINGS.stage.energyScale}
    >
      <span>{STRINGS.stage.energyBottom}</span>
      <span className={styles.energyBar} />
      <span>{STRINGS.stage.energyTop}</span>
    </div>
  );
}
