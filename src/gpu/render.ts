// Draws the pressure field of a GpuSim onto a canvas. M0 has the plain Wave view only;
// Relief, Energy, the automatic gain and the wall colours come in M1.

import viewShader from './shaders/view.wgsl?raw';
import type { GpuSim } from './solver';

export class FieldView {
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly params: GPUBuffer;
  private staticGroup: GPUBindGroup | null = null;
  private pressureGroups: GPUBindGroup[] = [];
  private sim: GpuSim | null = null;

  constructor(device: GPUDevice, canvas: HTMLCanvasElement) {
    this.device = device;
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('The canvas has no WebGPU context');
    this.context = context;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    const module = device.createShaderModule({ label: 'view', code: viewShader });
    this.pipeline = device.createRenderPipeline({
      label: 'view',
      layout: 'auto',
      vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format }] },
    });
    this.params = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /** Attach the simulation to draw. The canvas takes one pixel per cell. */
  attach(sim: GpuSim): void {
    this.sim = sim;
    const canvas = this.context.canvas as HTMLCanvasElement;
    canvas.width = sim.nx;
    canvas.height = sim.ny;
    this.staticGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: { buffer: sim.coefficientBuffer } },
      ],
    });
    this.pressureGroups = sim.pressureBuffers.map((buffer) =>
      this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(1),
        entries: [{ binding: 0, resource: { buffer } }],
      }),
    );
  }

  /** Draw the current field with display gain `gain`. */
  draw(gain: number): void {
    const sim = this.sim;
    if (!sim || !this.staticGroup) return;
    const data = new ArrayBuffer(16);
    const view = new DataView(data);
    view.setUint32(0, sim.nx, true);
    view.setUint32(4, sim.ny, true);
    view.setFloat32(8, gain, true);
    this.device.queue.writeBuffer(this.params, 0, data);

    const encoder = this.device.createCommandEncoder();
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
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.staticGroup);
    pass.setBindGroup(1, this.pressureGroups[sim.currentIndex]);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
