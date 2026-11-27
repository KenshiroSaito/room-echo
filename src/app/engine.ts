// The display loop (spec 10-room-echo 4, 6). Owns the GPU solver and the renderer, follows the
// store, and every frame runs as many steps as the display speed asks for, then draws.
//
// Changes to walls, floor and source are applied as soon as the store changes, before the next
// frame's steps are submitted, so the very next step already sees the new walls (M1 criterion 2).

import { FieldRenderer, type Exclusion, type FrameOptions } from '../gpu/render';
import { GpuSim, MAX_BATCH, type GpuContext } from '../gpu/solver';
import { COMPRESSION, StepClock, nextGain } from '../sim/display';
import { DEFAULT_ABSORBER, buildCoefficients } from '../sim/geometry';
import { DT, ENERGY_RATE, ROOM_SIZES } from '../sim/grid';
import { floorMaterial, floorSigma } from '../sim/materials';
import { cellChanges, type Point } from '../sim/sim';
import { DisplaySource } from '../sim/sources';
import { CELL_CM, cellOf, rasterizeWalls, type Vec } from '../sim/walls';
import { useStats } from '../state/stats';
import { useRoom, type RoomState } from '../state/store';

/**
 * After a clap or the start of the tone, the gain is held at 1 for this many steps: the clap
 * itself (180 steps) and its travel to 0.5 m. Otherwise the gain would race up while the field
 * is still silent and the arriving wave would flash.
 */
const GAIN_HOLD_STEPS = 260;
/** Cells this close to a playing tone are left out of the loudest-cell search. */
const TONE_EXCLUSION_CM = 30;
/** And from the top of the Energy scale, for clap and tone alike. */
const ENERGY_EXCLUSION_CM = 30;
/**
 * Frames the GPU may be behind before the loop skips one. A frame takes 3 ms of GPU time at
 * size M, but now and then the queue stalls for up to 50 ms (docs/measurements.md); three
 * frames in flight ride that out without dropping frames.
 */
const MAX_IN_FLIGHT = 3;

export class Engine {
  private readonly device: GPUDevice;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: FieldRenderer;
  private readonly source = new DisplaySource();
  private readonly clock = new StepClock(MAX_BATCH);
  private readonly values = new Float32Array(MAX_BATCH);
  private sim: GpuSim;
  /** The cells on screen, to find the ones a removed wall frees. */
  private cells: Uint8Array = new Uint8Array(0);
  /** Compression k of the tone mapping; a property so measurements can compare values. */
  compression = COMPRESSION;
  private gain = 1;
  private eventSteps = 0;
  private holdUntil = GAIN_HOLD_STEPS;
  private inFlight = 0;
  /** Display frames skipped because the GPU was behind (for the measurements). */
  skippedFrames = 0;
  private raf = 0;
  private lastTime = 0;
  private frameTimes: number[] = [];
  private unsubscribe: () => void = () => {};
  private destroyed = false;

  constructor(gpu: GpuContext, canvas: HTMLCanvasElement) {
    this.device = gpu.device;
    this.canvas = canvas;
    this.renderer = new FieldRenderer(gpu.device, canvas);
    this.sim = this.createSim(useRoom.getState());
  }

  /** Start the loop with an automatic clap at the source (spec 2, "First 10 seconds"). */
  start(): void {
    this.unsubscribe = useRoom.subscribe((state, prev) => this.follow(state, prev));
    this.clap();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.unsubscribe();
    this.sim.destroy();
    this.renderer.destroy();
  }

  /** The solver on screen, for the tests. */
  get solver(): GpuSim {
    return this.sim;
  }

  private sourceCell(state: RoomState): Point {
    return cellOf(state.source);
  }

  private build(state: RoomState): { cells: Uint8Array; coeff: Float32Array } {
    const { nx, ny } = ROOM_SIZES[state.size];
    const grid = rasterizeWalls(state.walls, nx, ny);
    const sigma = floorSigma(floorMaterial(state.floor).alpha);
    const coeff = buildCoefficients(grid, {
      absorber: DEFAULT_ABSORBER,
      uniformSigmaDt: sigma * DT,
    });
    return { cells: grid.cells, coeff };
  }

  private createSim(state: RoomState): GpuSim {
    const { nx, ny } = ROOM_SIZES[state.size];
    const { cells, coeff } = this.build(state);
    const at = this.sourceCell(state);
    const sim = new GpuSim(this.device, {
      nx,
      ny,
      coeff,
      absorber: DEFAULT_ABSORBER,
      source: at,
      // The listener's ears arrive in M2.
      probes: [at, at],
      recordCapacity: 0,
      energyRate: ENERGY_RATE,
    });
    this.renderer.attach(sim, cells);
    this.cells = cells;
    return sim;
  }

  private follow(state: RoomState, prev: RoomState): void {
    if (this.destroyed) return;
    if (state.size !== prev.size) {
      this.sim.destroy();
      this.sim = this.createSim(state);
      this.restartEvent();
    } else if (state.walls !== prev.walls || state.floor !== prev.floor) {
      const { cells, coeff } = this.build(state);
      this.sim.setCoefficients(coeff, cellChanges(this.cells, cells));
      this.renderer.setCells(cells);
      this.cells = cells;
    }
    if (state.source !== prev.source) this.sim.setSource(this.sourceCell(state));
    if (state.resetCount !== prev.resetCount) {
      this.sim.clear();
      this.source.silence();
      this.restartEvent();
    }
    if (state.sourceType !== prev.sourceType || state.toneHz !== prev.toneHz) {
      const tone = state.sourceType === 'tone';
      this.source.setTone(tone, state.toneHz);
      if (tone && prev.sourceType !== 'tone') this.restartEvent();
    }
    if (state.clapCount !== prev.clapCount) this.clap();
    if (state.playing && !prev.playing) this.clock.reset();
  }

  private clap(): void {
    this.source.clap();
    this.restartEvent();
  }

  /** A clap or tone start: the time readout starts from 0 and the gain is held at 1. */
  private restartEvent(): void {
    this.eventSteps = 0;
    this.holdUntil = GAIN_HOLD_STEPS;
    this.gain = 1;
  }

  /** Reused every frame, so the loop allocates (almost) nothing: less garbage to collect. */
  private readonly toneExclusion: Exclusion = { x: 0, y: 0, radius: TONE_EXCLUSION_CM / CELL_CM };
  private readonly energyExclusion: Exclusion = {
    x: 0,
    y: 0,
    radius: ENERGY_EXCLUSION_CM / CELL_CM,
  };
  private readonly options: FrameOptions = {
    rect: { x: 0, y: 0, width: 1, height: 1 },
    gain: 1,
    compression: COMPRESSION,
    mode: 'wave',
    relief: true,
    energyMax: 0,
    pressureExclusion: null,
    energyExclusion: null,
  };

  private readonly frame = (now: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.lastTime ? (now - this.lastTime) / 1000 : 0;
    this.lastTime = now;
    if (this.inFlight >= MAX_IN_FLIGHT) {
      this.skippedFrames++;
      return;
    }

    const state = useRoom.getState();
    const stage = state.stage;
    if (!stage) return;

    if (state.playing) {
      const steps = this.clock.advance(dt, state.slowdown);
      if (steps > 0) {
        this.source.fill(this.values, steps);
        this.sim.submit(steps, this.values);
        this.eventSteps += steps;
      }
      if (this.eventSteps >= this.holdUntil) {
        this.gain = nextGain(this.gain, this.renderer.fieldMax, dt);
      }
    }

    const scale = this.canvas.clientWidth > 0 ? this.canvas.width / this.canvas.clientWidth : 1;
    const at = this.sourceCell(state);
    this.toneExclusion.x = this.energyExclusion.x = at.x;
    this.toneExclusion.y = this.energyExclusion.y = at.y;
    const options = this.options;
    options.rect.x = stage.x * scale;
    options.rect.y = stage.y * scale;
    options.rect.width = stage.width * scale;
    options.rect.height = stage.height * scale;
    options.gain = this.gain;
    options.compression = this.compression;
    options.mode = state.view;
    options.relief = state.relief;
    options.energyMax = this.renderer.energyMax;
    options.pressureExclusion = state.sourceType === 'tone' ? this.toneExclusion : null;
    options.energyExclusion = this.energyExclusion;
    this.renderer.frame(options);
    this.inFlight++;
    this.device.queue.onSubmittedWorkDone().then(() => {
      this.inFlight--;
    });

    this.frameTimes.push(now);
    while (this.frameTimes.length > 0 && this.frameTimes[0] < now - 1000) this.frameTimes.shift();
    useStats.setState({
      eventSteps: this.eventSteps,
      gain: this.gain,
      fps: this.frameTimes.length,
      stepCount: this.sim.stepCount,
    });
  };

  /** Read the field on screen (tests and measurements). */
  readField(): Promise<Float32Array> {
    return this.sim.readField();
  }

  readEnergy(): Promise<Float32Array> {
    return this.sim.readEnergy();
  }

  /**
   * Run `steps` steps now, as fast as the GPU goes, with the current source (tests and
   * measurements: letting a standing wave build up without waiting at display speed).
   */
  async fastForward(steps: number): Promise<void> {
    let done = 0;
    while (done < steps) {
      const n = Math.min(MAX_BATCH, steps - done);
      this.source.fill(this.values, n);
      this.sim.submit(n, this.values);
      this.eventSteps += n;
      done += n;
      await this.device.queue.onSubmittedWorkDone();
    }
  }

  /** The cell that holds a point of the domain [cm]. */
  cellAt(p: Vec): Point {
    return cellOf(p);
  }
}
