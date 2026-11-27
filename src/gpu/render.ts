// Draws the field of a GpuSim (spec 10-room-echo 4): Wave with optional Relief, or Energy, and
// the walls. Each frame also finds the loudest cell and the largest energy on the GPU and reads
// them back a frame or two later, for the automatic gain and the dB scale.

import { SERIES, hexToRgb } from '../styles/palette';
import reduceShader from './shaders/reduce.wgsl?raw';
import viewShader from './shaders/view.wgsl?raw';
import type { GpuSim } from './solver';

export type ViewMode = 'wave' | 'energy';

/** A rectangle in device pixels. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Cells around the source left out of a maximum: a circle in cells, or none. */
export interface Exclusion {
  x: number;
  y: number;
  radius: number;
}

export interface FrameOptions {
  /** Where the domain is drawn on the canvas. */
  rect: PixelRect;
  gain: number;
  compression: number;
  mode: ViewMode;
  relief: boolean;
  /** Largest energy, for the top of the dB scale. */
  energyMax: number;
  /** Left out of the loudest-cell search (next to a playing tone). */
  pressureExclusion: Exclusion | null;
  /** Left out of the largest-energy search. */
  energyExclusion: Exclusion | null;
}

/** Size of the View struct of view.wgsl: 48 bytes of numbers, then 8 colours of 16 bytes. */
const VIEW_BYTES = 176;
const INFO_BYTES = 32;
const REDUCE_GROUPS = 128;
const STAGING = 3;
/**
 * The maxima are read back every few frames only: the gain is smoothed over 0.15 s or more
 * anyway, and each read-back is work on the main thread.
 */
const READBACK_EVERY = 4;

export class FieldRenderer {
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly viewPipeline: GPURenderPipeline;
  private readonly reducePipeline: GPUComputePipeline;
  private readonly viewParams: GPUBuffer;
  private readonly pressureInfo: GPUBuffer;
  private readonly energyInfo: GPUBuffer;
  private readonly result: GPUBuffer;
  private readonly staging: GPUBuffer[] = [];
  private readonly viewData = new ArrayBuffer(VIEW_BYTES);
  private readonly viewWriter = new DataView(this.viewData);
  private readonly infoData = [new Int32Array(INFO_BYTES / 4), new Int32Array(INFO_BYTES / 4)];
  private frameCount = 0;
  private cells: GPUBuffer | null = null;
  private sim: GpuSim | null = null;
  private staticGroup: GPUBindGroup | null = null;
  private pressureGroups: GPUBindGroup[] = [];
  private pressureReduceGroups: GPUBindGroup[] = [];
  private energyReduceGroup: GPUBindGroup | null = null;
  /** Bumped on attach(), so read-backs of a replaced simulation are dropped. */
  private generation = 0;

  /** Loudest |p| outside the exclusion, as of the latest read-back. */
  fieldMax = 0;
  /** Largest energy outside the exclusion, as of the latest read-back. */
  energyMax = 0;

  constructor(device: GPUDevice, canvas: HTMLCanvasElement) {
    this.device = device;
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('The canvas has no WebGPU context');
    this.context = context;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    const viewModule = device.createShaderModule({ label: 'view', code: viewShader });
    this.viewPipeline = device.createRenderPipeline({
      label: 'view',
      layout: 'auto',
      vertex: { module: viewModule, entryPoint: 'vertex' },
      fragment: { module: viewModule, entryPoint: 'fragment', targets: [{ format }] },
    });
    const reduceModule = device.createShaderModule({ label: 'reduce', code: reduceShader });
    this.reducePipeline = device.createComputePipeline({
      label: 'reduce',
      layout: 'auto',
      compute: { module: reduceModule, entryPoint: 'main' },
    });

    const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    this.viewParams = device.createBuffer({ label: 'view', size: VIEW_BYTES, usage: uniform });
    this.pressureInfo = device.createBuffer({ size: INFO_BYTES, usage: uniform });
    this.energyInfo = device.createBuffer({ size: INFO_BYTES, usage: uniform });
    this.result = device.createBuffer({
      label: 'maxima',
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    for (let k = 0; k < STAGING; k++) {
      this.staging.push(
        device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        }),
      );
    }

    // Material colours never change. They start at byte 48 of the View struct (view.wgsl).
    const floats = new Float32Array(this.viewData);
    SERIES.forEach((hex, i) => {
      const [r, g, b] = hexToRgb(hex);
      floats.set([r, g, b, 1], 12 + 4 * i);
    });
  }

  /** Draw this simulation from now on. `cells` holds one material code per cell. */
  attach(sim: GpuSim, cells: Uint8Array): void {
    this.generation++;
    this.sim = sim;
    this.fieldMax = 0;
    this.energyMax = 0;
    this.cells?.destroy();
    this.cells = this.device.createBuffer({
      label: 'cells',
      size: Math.ceil(cells.length / 4) * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.setCells(cells);

    const viewLayout0 = this.viewPipeline.getBindGroupLayout(0);
    const viewLayout1 = this.viewPipeline.getBindGroupLayout(1);
    this.staticGroup = this.device.createBindGroup({
      layout: viewLayout0,
      entries: [
        { binding: 0, resource: { buffer: this.viewParams } },
        { binding: 1, resource: { buffer: this.cells } },
        { binding: 2, resource: { buffer: sim.energyBuffer } },
      ],
    });
    this.pressureGroups = sim.pressureBuffers.map((buffer) =>
      this.device.createBindGroup({
        layout: viewLayout1,
        entries: [{ binding: 0, resource: { buffer } }],
      }),
    );
    const reduceLayout = this.reducePipeline.getBindGroupLayout(0);
    this.pressureReduceGroups = sim.pressureBuffers.map((buffer) =>
      this.device.createBindGroup({
        layout: reduceLayout,
        entries: [
          { binding: 0, resource: { buffer: this.pressureInfo } },
          { binding: 1, resource: { buffer } },
          { binding: 2, resource: { buffer: this.result } },
        ],
      }),
    );
    this.energyReduceGroup = this.device.createBindGroup({
      layout: reduceLayout,
      entries: [
        { binding: 0, resource: { buffer: this.energyInfo } },
        { binding: 1, resource: { buffer: sim.energyBuffer } },
        { binding: 2, resource: { buffer: this.result } },
      ],
    });
  }

  /** New wall cells (after an edit). Takes effect from the next frame. */
  setCells(cells: Uint8Array): void {
    if (!this.cells) return;
    const padded =
      cells.length % 4 === 0
        ? cells
        : (() => {
            const copy = new Uint8Array(Math.ceil(cells.length / 4) * 4);
            copy.set(cells);
            return copy;
          })();
    this.device.queue.writeBuffer(this.cells, 0, padded as Uint8Array<ArrayBuffer>);
  }

  private writeInfo(buffer: GPUBuffer, slot: number, exclusion: Exclusion | null): void {
    const sim = this.sim!;
    const data = this.infoData[slot];
    data[0] = sim.nx * sim.ny;
    data[1] = sim.nx;
    data[2] = exclusion ? Math.round(exclusion.x) : 0;
    data[3] = exclusion ? Math.round(exclusion.y) : 0;
    data[4] = exclusion ? Math.round(exclusion.radius * exclusion.radius) : -1;
    data[5] = slot;
    this.device.queue.writeBuffer(buffer, 0, data);
  }

  /** Measure the maxima and draw one frame. */
  frame(options: FrameOptions): void {
    const sim = this.sim;
    if (!sim || !this.staticGroup || !this.energyReduceGroup) return;

    this.writeInfo(this.pressureInfo, 0, options.pressureExclusion);
    this.writeInfo(this.energyInfo, 1, options.energyExclusion);

    const view = this.viewWriter;
    const { rect } = options;
    view.setFloat32(0, rect.x, true);
    view.setFloat32(4, rect.y, true);
    view.setFloat32(8, rect.width, true);
    view.setFloat32(12, rect.height, true);
    view.setUint32(16, sim.nx, true);
    view.setUint32(20, sim.ny, true);
    view.setFloat32(24, options.gain, true);
    view.setFloat32(28, options.compression, true);
    view.setUint32(32, options.mode === 'energy' ? 1 : 0, true);
    view.setUint32(36, options.relief ? 1 : 0, true);
    view.setFloat32(40, options.energyMax > 0 ? 1 / options.energyMax : 0, true);
    this.device.queue.writeBuffer(this.viewParams, 0, this.viewData);

    const encoder = this.device.createCommandEncoder();
    encoder.clearBuffer(this.result);
    const compute = encoder.beginComputePass();
    compute.setPipeline(this.reducePipeline);
    compute.setBindGroup(0, this.pressureReduceGroups[sim.currentIndex]);
    compute.dispatchWorkgroups(REDUCE_GROUPS);
    compute.setBindGroup(0, this.energyReduceGroup);
    compute.dispatchWorkgroups(REDUCE_GROUPS);
    compute.end();
    const staging = this.frameCount++ % READBACK_EVERY === 0 ? this.staging.pop() : undefined;
    if (staging) encoder.copyBufferToBuffer(this.result, 0, staging, 0, 16);

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.051, g: 0.051, b: 0.051, a: 1 },
        },
      ],
    });
    pass.setPipeline(this.viewPipeline);
    pass.setBindGroup(0, this.staticGroup);
    pass.setBindGroup(1, this.pressureGroups[sim.currentIndex]);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    if (staging) {
      const generation = this.generation;
      staging
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const values = new Float32Array(staging.getMappedRange());
          if (generation === this.generation) {
            this.fieldMax = values[0];
            this.energyMax = values[1];
          }
          staging.unmap();
          this.staging.push(staging);
        })
        .catch(() => {
          // The device was lost or the buffer destroyed; nothing to read.
        });
    }
  }

  destroy(): void {
    this.cells?.destroy();
    for (const buffer of [
      this.viewParams,
      this.pressureInfo,
      this.energyInfo,
      this.result,
      ...this.staging,
    ]) {
      buffer.destroy();
    }
  }
}
