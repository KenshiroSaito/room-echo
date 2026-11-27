// WebGPU solver. Same rule and same interface as the CPU reference (src/sim/reference.ts).
//
// Pressure lives in three buffers (previous, current, next) whose roles rotate every step. The
// face velocities of the absorbing layer live in two buffers that swap every step. Together
// that gives six arrangements, one bind group each.
//
// Many steps are encoded into one command buffer. Values that change per step (the source
// value, the recording index) cannot go into one uniform that is rewritten between steps: all
// writes would land before the batch runs. They are written into consecutive 256-byte slots of
// one buffer instead, and each step selects its slot with a dynamic offset.

import { COURANT, LAMBDA2 } from '../sim/grid';
import {
  FILL_ITERATIONS,
  FILL_REACH,
  countAir,
  type CellChanges,
  type Point,
  type Sim,
  type SimSetup,
} from '../sim/sim';
import { SOURCE_WEIGHTS } from '../sim/sources';
import editShader from './shaders/edit.wgsl?raw';
import stepShader from './shaders/step.wgsl?raw';

const WORKGROUP = 8;
/** Steps per command buffer. */
export const MAX_BATCH = 512;
const STEP_SLOT_BYTES = 256;
const PARAMS_BYTES = 48;

export interface GpuContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  /** Short description of the adapter for the measurement log. */
  description: string;
}

/** Returns null when WebGPU is not available. */
export async function requestGpu(): Promise<GpuContext | null> {
  if (typeof navigator === 'undefined' || !navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const info = adapter.info;
  const description = [info.vendor, info.architecture, info.device, info.description]
    .filter((part) => part && part.length > 0)
    .join(' / ');
  return { adapter, device, description: description || 'unknown adapter' };
}

interface Pipeline {
  pipeline: GPUComputePipeline;
  staticLayout: GPUBindGroupLayout;
  fieldLayout: GPUBindGroupLayout;
  edit: Record<EditPass, GPUComputePipeline>;
  editLayout: GPUBindGroupLayout;
}

const EDIT_PASSES = [
  'mark',
  'sumWalled',
  'clearWalled',
  'guess',
  'gather',
  'scatter',
  'sumFreed',
  'shift',
] as const;
type EditPass = (typeof EDIT_PASSES)[number];

const pipelines = new WeakMap<GPUDevice, Pipeline>();

function getPipeline(device: GPUDevice): Pipeline {
  const cached = pipelines.get(device);
  if (cached) return cached;

  const code = stepShader.replace(
    'SOURCE_WEIGHT_VALUES',
    SOURCE_WEIGHTS.map((w) => w.toExponential(9)).join(', '),
  );
  const module = device.createShaderModule({ label: 'step', code });
  const staticLayout = device.createBindGroupLayout({
    label: 'step static',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 },
      },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const fieldLayout = device.createBindGroupLayout({
    label: 'step fields',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const pipeline = device.createComputePipeline({
    label: 'step',
    layout: device.createPipelineLayout({ bindGroupLayouts: [staticLayout, fieldLayout] }),
    compute: { module, entryPoint: 'main' },
  });
  const editModule = device.createShaderModule({ label: 'edit', code: editShader });
  const storage = (binding: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: GPUShaderStage.COMPUTE,
    buffer: { type },
  });
  const editLayout = device.createBindGroupLayout({
    label: 'edit',
    entries: [
      storage(0, 'uniform'),
      storage(1, 'read-only-storage'),
      storage(2, 'read-only-storage'),
      storage(3, 'storage'),
      storage(4, 'storage'),
      storage(5, 'storage'),
      storage(6, 'read-only-storage'),
      storage(7, 'storage'),
    ],
  });
  const editPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [editLayout] });
  const edit = Object.fromEntries(
    EDIT_PASSES.map((entryPoint) => [
      entryPoint,
      device.createComputePipeline({
        label: `edit ${entryPoint}`,
        layout: editPipelineLayout,
        compute: { module: editModule, entryPoint },
      }),
    ]),
  ) as Record<EditPass, GPUComputePipeline>;
  const created = { pipeline, staticLayout, fieldLayout, edit, editLayout };
  pipelines.set(device, created);
  return created;
}

export class GpuSim implements Sim {
  readonly nx: number;
  readonly ny: number;
  stepCount = 0;

  private readonly device: GPUDevice;
  private readonly pipeline: GPUComputePipeline;
  private readonly pressure: GPUBuffer[];
  private readonly velocity: GPUBuffer[];
  private readonly coeff: GPUBuffer;
  private readonly params: GPUBuffer;
  private readonly stepParams: GPUBuffer;
  private readonly recording: GPUBuffer;
  private readonly energy: GPUBuffer;
  private freedFlags: GPUBuffer | null = null;
  private readonly staticGroup: GPUBindGroup;
  /** Indexed by stepCount mod 6. */
  private readonly fieldGroups: GPUBindGroup[];
  private readonly stepData = new ArrayBuffer(MAX_BATCH * STEP_SLOT_BYTES);
  private readonly stepInts = new Int32Array(this.stepData);
  private readonly stepFloats = new Float32Array(this.stepData);
  private readonly recordCapacity: number;
  private source: Point;
  private destroyed = false;

  constructor(device: GPUDevice, setup: SimSetup) {
    const { nx, ny } = setup;
    if (setup.coeff.length !== nx * ny * 2) throw new Error('coeff has the wrong size');
    this.device = device;
    this.nx = nx;
    this.ny = ny;
    this.source = setup.source;
    this.recordCapacity = setup.recordCapacity;

    const { pipeline, staticLayout, fieldLayout } = getPipeline(device);
    this.pipeline = pipeline;

    const cells = nx * ny;
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    // New buffers are filled with zeros: silence everywhere.
    this.pressure = [0, 1, 2].map((k) =>
      device.createBuffer({ label: `pressure ${k}`, size: cells * 4, usage: storage }),
    );
    this.velocity = [0, 1].map((k) =>
      device.createBuffer({ label: `velocity ${k}`, size: cells * 8, usage: storage }),
    );
    this.coeff = device.createBuffer({ label: 'coeff', size: cells * 8, usage: storage });
    device.queue.writeBuffer(this.coeff, 0, setup.coeff as Float32Array<ArrayBuffer>);

    this.params = device.createBuffer({
      label: 'params',
      size: PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const a = setup.absorber;
    const layerOn = a.matched && a.cells > 0 && a.sigmaMaxDt > 0;
    const edges = layerOn
      ? (a.left ? 1 : 0) | (a.right ? 2 : 0) | (a.top ? 4 : 0) | (a.bottom ? 8 : 0)
      : 0;
    const paramData = new ArrayBuffer(PARAMS_BYTES);
    const view = new DataView(paramData);
    view.setUint32(0, nx, true);
    view.setUint32(4, ny, true);
    view.setFloat32(8, COURANT, true);
    view.setFloat32(12, LAMBDA2, true);
    view.setInt32(16, setup.probes[0].x, true);
    view.setInt32(20, setup.probes[0].y, true);
    view.setInt32(24, setup.probes[1].x, true);
    view.setInt32(28, setup.probes[1].y, true);
    view.setFloat32(32, a.cells, true);
    view.setFloat32(36, a.sigmaMaxDt, true);
    view.setUint32(40, edges, true);
    view.setFloat32(44, setup.energyRate ?? 0, true);
    device.queue.writeBuffer(this.params, 0, paramData);

    this.stepParams = device.createBuffer({
      label: 'step params',
      size: MAX_BATCH * STEP_SLOT_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.recording = device.createBuffer({
      label: 'recording',
      size: Math.max(1, setup.recordCapacity) * 8,
      usage: storage,
    });
    this.energy = device.createBuffer({ label: 'energy', size: cells * 4, usage: storage });

    this.staticGroup = device.createBindGroup({
      layout: staticLayout,
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: { buffer: this.stepParams, size: 16 } },
        { binding: 2, resource: { buffer: this.coeff } },
        { binding: 3, resource: { buffer: this.recording } },
        { binding: 4, resource: { buffer: this.energy } },
      ],
    });
    this.fieldGroups = [0, 1, 2, 3, 4, 5].map((phase) =>
      device.createBindGroup({
        layout: fieldLayout,
        entries: [
          { binding: 0, resource: { buffer: this.pressure[phase % 3] } },
          { binding: 1, resource: { buffer: this.pressure[(phase + 1) % 3] } },
          { binding: 2, resource: { buffer: this.pressure[(phase + 2) % 3] } },
          { binding: 3, resource: { buffer: this.velocity[phase % 2] } },
          { binding: 4, resource: { buffer: this.velocity[(phase + 1) % 2] } },
        ],
      }),
    );
  }

  /** The buffer that holds the current pressure field (for rendering). */
  get currentPressure(): GPUBuffer {
    return this.pressure[(this.stepCount + 1) % 3];
  }

  /** Index (0–2) of the buffer that holds the current pressure field. */
  get currentIndex(): number {
    return (this.stepCount + 1) % 3;
  }

  get pressureBuffers(): readonly GPUBuffer[] {
    return this.pressure;
  }

  get coefficientBuffer(): GPUBuffer {
    return this.coeff;
  }

  get energyBuffer(): GPUBuffer {
    return this.energy;
  }

  /**
   * Encode and submit `steps` steps without waiting for them to finish. Use run() unless the
   * caller paces itself (the display loop does, one batch per frame).
   */
  submit(steps: number, source?: Float32Array, sourceOffset = 0): void {
    if (steps > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} steps per batch`);
    const { stepInts, stepFloats } = this;
    const stride = STEP_SLOT_BYTES / 4;
    for (let k = 0; k < steps; k++) {
      const at = k * stride;
      const step = this.stepCount + k;
      const j = sourceOffset + k;
      stepInts[at] = this.source.x;
      stepInts[at + 1] = this.source.y;
      stepFloats[at + 2] = source && j < source.length ? source[j] : 0;
      stepInts[at + 3] = step < this.recordCapacity ? step : -1;
    }
    this.device.queue.writeBuffer(this.stepParams, 0, this.stepData, 0, steps * STEP_SLOT_BYTES);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    const gx = Math.ceil(this.nx / WORKGROUP);
    const gy = Math.ceil(this.ny / WORKGROUP);
    for (let k = 0; k < steps; k++) {
      pass.setBindGroup(0, this.staticGroup, [k * STEP_SLOT_BYTES]);
      pass.setBindGroup(1, this.fieldGroups[(this.stepCount + k) % 6]);
      pass.dispatchWorkgroups(gx, gy);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.stepCount += steps;
  }

  async run(steps: number, source?: Float32Array): Promise<void> {
    let done = 0;
    while (done < steps) {
      const n = Math.min(MAX_BATCH, steps - done);
      this.submit(n, source, done);
      done += n;
      // Wait for each batch, so the queue never holds more than one.
      await this.device.queue.onSubmittedWorkDone();
    }
  }

  setCoefficients(coeff: Float32Array, changes?: CellChanges): void {
    if (coeff.length !== this.nx * this.ny * 2) throw new Error('coeff has the wrong size');
    this.device.queue.writeBuffer(this.coeff, 0, coeff as Float32Array<ArrayBuffer>);
    if (changes && (changes.freed.length > 0 || changes.walled.length > 0)) {
      this.edit(changes, countAir(coeff));
    }
  }

  /** Edit the current and the previous field after the walls changed (edit.wgsl). */
  private edit(changes: CellChanges, air: number): void {
    const { device } = this;
    const { edit, editLayout } = getPipeline(device);
    const { freed, walled } = changes;
    const list = (label: string, cells: Uint32Array) => {
      const buffer = device.createBuffer({
        label,
        size: Math.max(4, cells.byteLength),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      if (cells.length > 0) device.queue.writeBuffer(buffer, 0, cells as Uint32Array<ArrayBuffer>);
      return buffer;
    };
    const freedList = list('freed cells', freed);
    const walledList = list('walled cells', walled);
    const scratch = device.createBuffer({
      size: Math.max(4, freed.byteLength),
      usage: GPUBufferUsage.STORAGE,
    });
    const sums = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE });
    const params = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const paramData = new ArrayBuffer(32);
    const view = new DataView(paramData);
    view.setUint32(0, freed.length, true);
    view.setUint32(4, this.nx, true);
    view.setUint32(8, FILL_REACH, true);
    view.setUint32(12, walled.length, true);
    view.setUint32(16, this.nx * this.ny, true);
    view.setFloat32(20, Math.max(1, air), true);
    device.queue.writeBuffer(params, 0, paramData);
    // One flag per cell, kept for the life of the solver (an eraser stroke edits every frame).
    this.freedFlags ??= device.createBuffer({
      label: 'freed flags',
      size: this.nx * this.ny * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const isFreed = this.freedFlags;

    const fields = [this.pressure[this.stepCount % 3], this.currentPressure];
    const groups = fields.map((field) =>
      device.createBindGroup({
        layout: editLayout,
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: freedList } },
          { binding: 2, resource: { buffer: this.coeff } },
          { binding: 3, resource: { buffer: field } },
          { binding: 4, resource: { buffer: scratch } },
          { binding: 5, resource: { buffer: isFreed } },
          { binding: 6, resource: { buffer: walledList } },
          { binding: 7, resource: { buffer: sums } },
        ],
      }),
    );
    const over = (count: number) => Math.max(1, Math.ceil(count / 256));
    const encoder = device.createCommandEncoder();
    encoder.clearBuffer(isFreed);
    const pass = encoder.beginComputePass();
    const run = (name: EditPass, groupsNeeded: number) => {
      pass.setPipeline(edit[name]);
      pass.dispatchWorkgroups(groupsNeeded);
    };
    pass.setBindGroup(0, groups[0]);
    run('mark', over(freed.length));
    for (const group of groups) {
      pass.setBindGroup(0, group);
      run('sumWalled', 1);
      run('clearWalled', over(walled.length));
      if (freed.length > 0) {
        run('guess', over(freed.length));
        run('scatter', over(freed.length));
        for (let k = 0; k < FILL_ITERATIONS; k++) {
          run('gather', over(freed.length));
          run('scatter', over(freed.length));
        }
      }
      run('sumFreed', 1);
      run('shift', over(this.nx * this.ny));
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
    device.queue.onSubmittedWorkDone().then(() => {
      for (const buffer of [freedList, walledList, scratch, sums, params]) buffer.destroy();
    });
  }

  setSource(source: Point): void {
    this.source = source;
  }

  setEnergyRate(rate: number): void {
    this.device.queue.writeBuffer(this.params, 44, new Float32Array([rate]));
  }

  /** Silence the field: pressure, layer velocities and the energy average back to zero. */
  clear(): void {
    const encoder = this.device.createCommandEncoder();
    for (const buffer of [...this.pressure, ...this.velocity, this.energy]) {
      encoder.clearBuffer(buffer);
    }
    this.device.queue.submit([encoder.finish()]);
  }

  private async read(buffer: GPUBuffer, bytes: number): Promise<Float32Array> {
    const staging = this.device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, 0, staging, 0, bytes);
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return data;
  }

  async readRecording(): Promise<[Float32Array, Float32Array]> {
    const n = Math.min(this.stepCount, this.recordCapacity);
    const a = new Float32Array(n);
    const b = new Float32Array(n);
    if (n === 0) return [a, b];
    const data = await this.read(this.recording, n * 8);
    for (let i = 0; i < n; i++) {
      a[i] = data[2 * i];
      b[i] = data[2 * i + 1];
    }
    return [a, b];
  }

  async readField(): Promise<Float32Array> {
    return this.read(this.currentPressure, this.nx * this.ny * 4);
  }

  async readEnergy(): Promise<Float32Array> {
    return this.read(this.energy, this.nx * this.ny * 4);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const buffer of [
      ...this.pressure,
      ...this.velocity,
      this.coeff,
      this.params,
      this.stepParams,
      this.recording,
      this.energy,
    ]) {
      buffer.destroy();
    }
    this.freedFlags?.destroy();
  }
}
