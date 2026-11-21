import blurWgsl from '../shaders/blur.wgsl?raw';
import blitWgsl from '../shaders/blit_grayscale.wgsl?raw';
import type { GridSize } from '../types';
import { createPingPongTextures, type PingPongTextures } from './pingPong';
import { createComputePipelineFromWgsl } from './uniforms';

export type BlurDemoResources = {
  grid: PingPongTextures;
  blurPipeline: GPUComputePipeline;
  blitPipeline: GPURenderPipeline;
  destroy(): void;
};

/** Seed a high-contrast test pattern (bright center disk + checker) into a packed Float32Array. */
export function createBlurTestPattern(size: number): Float32Array {
  const data = new Float32Array(size * size);
  const cx = (size - 1) * 0.5;
  const cy = (size - 1) * 0.5;
  const radius = size * 0.22;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const checker = ((x >> 4) + (y >> 4)) % 2 === 0 ? 0.15 : 0.35;
      const dx = x - cx;
      const dy = y - cy;
      const disk = dx * dx + dy * dy <= radius * radius ? 1 : checker;
      data[y * size + x] = disk;
    }
  }
  return data;
}

export function createBlurDemo(
  device: GPUDevice,
  canvasFormat: GPUTextureFormat,
  gridSize: GridSize,
): BlurDemoResources {
  const grid = createPingPongTextures(device, 'height', gridSize, 'r32float');
  const pattern = createBlurTestPattern(gridSize);
  device.queue.writeTexture(
    { texture: grid.read },
    pattern,
    { bytesPerRow: gridSize * 4 },
    { width: gridSize, height: gridSize },
  );

  const blurPipeline = createComputePipelineFromWgsl(device, blurWgsl, {
    label: 'demo-blur',
    entryPoint: 'main',
  });

  const blitModule = device.createShaderModule({
    label: 'demo-blit-module',
    code: blitWgsl,
  });
  const blitPipeline = device.createRenderPipeline({
    label: 'demo-blit',
    layout: 'auto',
    vertex: { module: blitModule, entryPoint: 'vs_main' },
    fragment: {
      module: blitModule,
      entryPoint: 'fs_main',
      targets: [{ format: canvasFormat }],
    },
    primitive: { topology: 'triangle-list' },
  });

  return {
    grid,
    blurPipeline,
    blitPipeline,
    destroy() {
      grid.destroy();
    },
  };
}

export function encodeBlurPass(
  encoder: GPUCommandEncoder,
  demo: BlurDemoResources,
  device: GPUDevice,
): void {
  const bindGroup = device.createBindGroup({
    label: 'demo-blur-bind',
    layout: demo.blurPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: demo.grid.readView },
      { binding: 1, resource: demo.grid.writeView },
    ],
  });
  const pass = encoder.beginComputePass({ label: 'demo-blur-pass' });
  pass.setPipeline(demo.blurPipeline);
  pass.setBindGroup(0, bindGroup);
  const groups = Math.ceil(demo.grid.size / 8);
  pass.dispatchWorkgroups(groups, groups);
  pass.end();
  demo.grid.swap();
}

export function encodeBlitPass(
  encoder: GPUCommandEncoder,
  demo: BlurDemoResources,
  device: GPUDevice,
  targetView: GPUTextureView,
  clearValue: GPUColor,
): void {
  const bindGroup = device.createBindGroup({
    label: 'demo-blit-bind',
    layout: demo.blitPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: demo.grid.readView }],
  });
  const pass = encoder.beginRenderPass({
    label: 'demo-blit-pass',
    colorAttachments: [
      {
        view: targetView,
        clearValue,
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  pass.setPipeline(demo.blitPipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
}

/** Reset the readable grid to the test pattern (destroys prior blur state). */
export function resetBlurDemoPattern(device: GPUDevice, demo: BlurDemoResources): void {
  const pattern = createBlurTestPattern(demo.grid.size);
  device.queue.writeTexture(
    { texture: demo.grid.read },
    pattern,
    { bytesPerRow: demo.grid.size * 4 },
    { width: demo.grid.size, height: demo.grid.size },
  );
}
