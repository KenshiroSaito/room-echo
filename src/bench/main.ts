// Measurement page (/bench): runs the M0 completion criteria on the GPU solver and measures
// its speed (spec 10-room-echo 7, M0). The results are also exposed as window.__benchResults
// for the Playwright run that records them.

import '../styles/tokens.css';
import './bench.css';

import { FieldRenderer } from '../gpu/render';
import { GpuSim, MAX_BATCH, requestGpu } from '../gpu/solver';
import {
  CLAP_HZ,
  WALL_REFLECTION_ALPHAS,
  freeFieldSetup,
  measureAgreement,
  measureEdgeReflection,
  measureRoomModes,
  measureWallReflection,
  type AgreementResult,
  type EdgeReflectionResult,
  type RoomModesResult,
  type WallReflectionResult,
} from '../sim/experiments';
import { ROOM_SIZES, SAMPLE_RATE, type RoomSize } from '../sim/grid';
import { COMPRESSION, formatGain, formatSimTime, formatSlowdown } from '../sim/display';
import { createGrid } from '../sim/geometry';
import { createReferenceSim } from '../sim/reference';
import { createRng } from '../sim/rng';
import type { SimFactory } from '../sim/sim';
import { ricker } from '../sim/sources';
import { STRINGS } from '../strings';

const S = STRINGS.bench;

/** Spec M0: size M must take 48,000 steps (one second of sound) within 30 s. */
const DECISION_STEPS = 48_000;
const DECISION_LIMIT_SECONDS = 30;

interface ThroughputResult {
  size: RoomSize;
  nx: number;
  ny: number;
  cells: number;
  steps: number;
  seconds: number;
  stepsPerSecond: number;
}

interface BenchResults {
  done: boolean;
  error: string | null;
  gpuErrors: string[];
  adapter: string;
  userAgent: string;
  edge?: EdgeReflectionResult;
  modes?: RoomModesResult;
  wall?: WallReflectionResult[];
  agreement?: AgreementResult;
  throughput: ThroughputResult[];
  decision?: { steps: number; seconds: number; limitSeconds: number; pass: boolean };
}

declare global {
  interface Window {
    __benchResults: BenchResults;
    __bench: { showFreeField(step: number): Promise<void>; resume(): void };
  }
}

const results: BenchResults = {
  done: false,
  error: null,
  gpuErrors: [],
  adapter: '',
  userAgent: navigator.userAgent,
  throughput: [],
};
window.__benchResults = results;

// --- Small DOM helpers -----------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

type State = 'waiting' | 'running' | 'pass' | 'fail';

function setState(cell: HTMLElement, state: State): void {
  const icon = { waiting: '·', running: '…', pass: '✓', fail: '✕' }[state];
  const label = { waiting: S.waiting, running: S.running, pass: S.pass, fail: S.fail }[state];
  const iconClass = state === 'pass' ? 'pass' : state === 'fail' ? 'fail' : 'idle';
  cell.replaceChildren(el('span', `icon ${iconClass}`, icon), document.createTextNode(label));
  cell.dataset.state = state;
}

interface Row {
  measured: HTMLElement;
  state: HTMLElement;
}

function criterionRow(body: HTMLElement, id: string, label: string, limit: string): Row {
  const tr = el('tr');
  tr.dataset.criterion = id;
  const measured = el('td', 'measured', '—');
  const state = el('td', 'state');
  setState(state, 'waiting');
  tr.append(el('td', undefined, label), measured, el('td', 'limit', limit), state);
  body.append(tr);
  return { measured, state };
}

function showMeasured(row: Row, main: string, details: string[] = []): void {
  row.measured.replaceChildren(
    el('div', undefined, main),
    ...details.map((d) => el('div', 'detail', d)),
  );
}

const db = (value: number): string => `${value.toFixed(1).replace('-', '−')} dB`;
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

// --- Free-field preview ----------------------------------------------------------------------

/**
 * A clap in an empty field, slowed down, repeated at a new place every few seconds.
 * What is drawn is the solver's field itself; the slow-down and the gain are shown below it.
 */
class Preview {
  private static readonly PERIOD = 1500; // steps between claps
  /** Gain ×1: the loudest part of the picture is a clap at 1 m (src/sim/display.ts). */
  private static readonly GAIN = 1;
  private readonly clap = ricker(CLAP_HZ);
  private readonly view: FieldRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly slowdown: number;
  private sim: GpuSim;
  private rng = createRng(10);
  private pending = 0;
  private lastTime = 0;
  private frame = 0;

  constructor(
    private readonly device: GPUDevice,
    canvas: HTMLCanvasElement,
    private readonly caption: HTMLElement,
  ) {
    this.canvas = canvas;
    this.view = new FieldRenderer(device, canvas);
    this.slowdown = matchMedia('(prefers-reduced-motion: reduce)').matches ? 240 : 120;
    this.sim = this.createSim();
  }

  private createSim(): GpuSim {
    const { nx, ny } = ROOM_SIZES.S;
    const setup = freeFieldSetup(nx, ny);
    const sim = new GpuSim(this.device, setup);
    // One pixel per cell.
    this.canvas.width = nx;
    this.canvas.height = ny;
    this.view.attach(sim, createGrid(nx, ny).cells);
    return sim;
  }

  private restart(): void {
    this.sim.destroy();
    this.sim = this.createSim();
    this.rng = createRng(10);
    this.pending = 0;
  }

  /** Advance by `steps`, starting a new clap at each period boundary. */
  private advance(steps: number): void {
    let left = steps;
    while (left > 0) {
      const phase = this.sim.stepCount % Preview.PERIOD;
      if (phase === 0 && this.sim.stepCount > 0) {
        const { nx, ny } = this.sim;
        this.sim.setSource({
          x: Math.round(nx * (0.25 + 0.5 * this.rng())),
          y: Math.round(ny * (0.25 + 0.5 * this.rng())),
        });
      }
      const n = Math.min(left, Preview.PERIOD - phase, MAX_BATCH);
      const signal = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        if (phase + k < this.clap.length) signal[k] = this.clap[phase + k];
      }
      this.sim.submit(n, signal);
      left -= n;
    }
  }

  private draw(): void {
    const { nx, ny } = this.sim;
    this.view.frame({
      rect: { x: 0, y: 0, width: nx, height: ny },
      gain: Preview.GAIN,
      compression: COMPRESSION,
      mode: 'wave',
      relief: false,
      energyMax: 0,
      pressureExclusion: null,
      energyExclusion: null,
    });
    const parts = [
      formatSimTime(this.sim.stepCount % Preview.PERIOD),
      formatSlowdown(this.slowdown),
      formatGain(Preview.GAIN),
    ];
    this.caption.textContent = parts.filter((part) => part !== null).join(' · ');
  }

  start(): void {
    if (this.frame !== 0) return;
    this.lastTime = performance.now();
    const tick = (now: number): void => {
      const elapsed = Math.min(0.05, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.pending += (elapsed * SAMPLE_RATE) / this.slowdown;
      const steps = Math.floor(this.pending);
      this.pending -= steps;
      if (steps > 0) this.advance(steps);
      this.draw();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Stop the loop and show the first clap exactly `step` steps after it started. */
  async showAt(step: number): Promise<void> {
    this.stop();
    this.restart();
    await this.sim.run(step, this.clap);
    this.draw();
    await this.device.queue.onSubmittedWorkDone();
  }

  resume(): void {
    this.restart();
    this.start();
  }
}

// --- Measurements ----------------------------------------------------------------------------

async function measureThroughput(
  device: GPUDevice,
  size: RoomSize,
  steps: number,
): Promise<ThroughputResult> {
  const { nx, ny } = ROOM_SIZES[size];
  const sim = new GpuSim(device, freeFieldSetup(nx, ny));
  try {
    // Warm up with a clap so the field is not all zeros, then time `steps` more steps.
    await sim.run(MAX_BATCH, ricker(CLAP_HZ));
    await sim.readField();
    const start = performance.now();
    await sim.run(steps);
    await sim.readField();
    const seconds = (performance.now() - start) / 1000;
    return { size, nx, ny, cells: nx * ny, steps, seconds, stepsPerSecond: steps / seconds };
  } finally {
    sim.destroy();
  }
}

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;

  const bar = el('header', 'bar');
  bar.append(
    el('h1', undefined, `${STRINGS.appTitle} · ${S.title}`),
    el('p', undefined, S.subtitle),
  );
  const layout = el('main', 'layout');
  const left = el('div');
  const right = el('div');
  layout.append(left, right);
  app.append(bar, layout);

  const status = el('p', 'status', S.running);
  status.id = 'status';
  right.append(status);

  const gpu = await requestGpu();
  if (!gpu) {
    status.textContent = S.noWebGpu;
    results.error = 'no-webgpu';
    results.done = true;
    return;
  }
  const { device } = gpu;
  results.adapter = gpu.description;
  device.addEventListener('uncapturederror', (event) => {
    results.gpuErrors.push(event.error.message);
    console.error(event.error.message);
  });

  // Preview panel.
  const previewPanel = el('section', 'panel');
  const canvas = el('canvas');
  canvas.id = 'preview';
  const caption = el('div', 'caption');
  previewPanel.append(
    el('h2', undefined, S.previewHeading),
    canvas,
    caption,
    el('p', 'note', S.previewNote),
  );
  left.append(previewPanel);
  const preview = new Preview(device, canvas, caption);
  window.__bench = {
    showFreeField: (step) => preview.showAt(step),
    resume: () => preview.resume(),
  };

  // Decision panel: the one number this page exists for.
  const decisionPanel = el('section', 'panel');
  const hero = el('div', 'hero', '—');
  hero.id = 'decision';
  decisionPanel.append(
    hero,
    el('div', 'hero-label', `${S.throughput} (${S.limit.toLowerCase()} ${S.throughputLimit})`),
  );
  right.append(decisionPanel);

  // Criteria table.
  const checksPanel = el('section', 'panel');
  const checksTable = el('table');
  const checksHead = el('thead');
  const headRow = el('tr');
  headRow.append(
    el('th', undefined, S.criterion),
    el('th', undefined, S.measured),
    el('th', undefined, S.limit),
    el('th', undefined, S.result),
  );
  checksHead.append(headRow);
  const checksBody = el('tbody');
  checksTable.append(checksHead, checksBody);
  checksPanel.append(el('h2', undefined, S.checksHeading), checksTable);
  right.append(checksPanel);

  const rows = {
    edge: criterionRow(checksBody, 'edge', S.edge, S.edgeLimit),
    modes: criterionRow(checksBody, 'modes', S.modes, S.modesLimit),
    wall: criterionRow(checksBody, 'wall', S.wall, S.wallLimit),
    agreement: criterionRow(checksBody, 'agreement', S.agreement, S.agreementLimit),
    throughput: criterionRow(checksBody, 'throughput', S.throughput, S.throughputLimit),
  };

  // Speed table.
  const speedPanel = el('section', 'panel');
  const speedTable = el('table');
  const speedHead = el('thead');
  const speedHeadRow = el('tr');
  speedHeadRow.append(
    el('th', undefined, S.size),
    el('th', 'number', S.cells),
    el('th', 'number', S.stepsPerSecond),
    el('th', 'number', S.realTime),
  );
  speedHead.append(speedHeadRow);
  const speedBody = el('tbody');
  speedTable.append(speedHead, speedBody);
  speedPanel.append(
    el('h2', undefined, S.speedHeading),
    speedTable,
    el('p', 'note', `${S.adapter}: ${gpu.description}`),
  );
  right.append(speedPanel);

  const jsonPanel = el('details', 'panel');
  const jsonText = el('pre');
  jsonText.id = 'json';
  jsonPanel.append(el('summary', undefined, S.json), jsonText);
  right.append(jsonPanel);

  const skipChecks = new URLSearchParams(location.search).get('checks') === '0';
  preview.start();
  if (skipChecks) {
    status.textContent = S.waiting;
    return;
  }

  const gpuFactory: SimFactory = (setup) => new GpuSim(device, setup);

  // 4 · GPU vs reference
  setState(rows.agreement.state, 'running');
  const agreement = await measureAgreement(createReferenceSim, gpuFactory);
  results.agreement = agreement;
  showMeasured(
    rows.agreement,
    `${agreement.relative.toExponential(1)} of peak · energy ${agreement.energyRelative.toExponential(1)}`,
  );
  setState(rows.agreement.state, agreement.pass ? 'pass' : 'fail');

  // 3 · Wall reflection
  setState(rows.wall.state, 'running');
  const wall: WallReflectionResult[] = [];
  for (const alpha of WALL_REFLECTION_ALPHAS)
    wall.push(await measureWallReflection(gpuFactory, alpha));
  results.wall = wall;
  showMeasured(rows.wall, wall.map((w) => `α ${w.alpha}: ${w.measured.toFixed(3)}`).join(' · '), [
    `${S.expected} ${wall.map((w) => w.expected.toFixed(3)).join(' · ')}`,
  ]);
  setState(rows.wall.state, wall.every((w) => w.pass) ? 'pass' : 'fail');

  // 1 · Edge reflection
  setState(rows.edge.state, 'running');
  const edge = await measureEdgeReflection(gpuFactory);
  results.edge = edge;
  showMeasured(rows.edge, `${S.worst} ${db(edge.worstDb)}`, [
    `${S.clap} ${db(edge.clapDb)} · ${S.pulse} ${db(edge.pulseDb)}`,
    edge.bands.map((b) => `${b.hz} Hz ${b.db.toFixed(0).replace('-', '−')}`).join(' · '),
  ]);
  setState(rows.edge.state, edge.pass ? 'pass' : 'fail');

  // 2 · Room resonances
  setState(rows.modes.state, 'running');
  const modes = await measureRoomModes(gpuFactory, 1.0);
  results.modes = modes;
  showMeasured(rows.modes, `${modes.measuredHz.map((f) => f.toFixed(2)).join(' · ')} Hz`, [
    `${S.theory} ${modes.theoryHz.map((f) => f.toFixed(2)).join(' · ')} Hz`,
    `${S.maxError} ${(modes.maxRelativeError * 100).toFixed(3)} %`,
  ]);
  setState(rows.modes.state, modes.pass ? 'pass' : 'fail');

  // 5 · Speed. The preview is paused so it does not take GPU time from the measurement.
  preview.stop();
  setState(rows.throughput.state, 'running');
  const plan: [RoomSize, number][] = [
    ['S', 24_000],
    ['M', DECISION_STEPS],
    ['L', 24_000],
  ];
  for (const [size, steps] of plan) {
    const t = await measureThroughput(device, size, steps);
    results.throughput.push(t);
    const tr = el('tr');
    tr.append(
      el('td', undefined, `${size} · ${t.nx} × ${t.ny}`),
      el('td', 'number', integer.format(t.cells)),
      el('td', 'number', integer.format(t.stepsPerSecond)),
      el('td', 'number', `${(t.stepsPerSecond / SAMPLE_RATE).toFixed(2)}×`),
    );
    speedBody.append(tr);
    if (size === 'M') {
      const pass = t.seconds <= DECISION_LIMIT_SECONDS;
      results.decision = {
        steps: t.steps,
        seconds: t.seconds,
        limitSeconds: DECISION_LIMIT_SECONDS,
        pass,
      };
      hero.textContent = `${t.seconds.toFixed(2)} s`;
      showMeasured(rows.throughput, `${t.seconds.toFixed(2)} s`);
      setState(rows.throughput.state, pass ? 'pass' : 'fail');
    }
  }

  results.done = true;
  status.textContent = S.done;
  jsonText.textContent = JSON.stringify(results, null, 2);
  preview.resume();
}

main().catch((error: unknown) => {
  results.error = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  results.done = true;
  const status = document.querySelector('#status');
  if (status) status.textContent = `${S.failed}: ${results.error}`;
  console.error(error);
});
