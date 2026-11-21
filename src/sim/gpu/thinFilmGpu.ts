import { createGrid2D, maxAbsDiff } from '../cpu/grid';
import {
  addGaussianPuddle,
  createThinFilmState,
  DEFAULT_THIN_FILM_PARAMS,
  thinFilmSubstep,
  type ThinFilmParams,
} from '../cpu/thinFilm';
import blitHeightWgsl from '../shaders/blit_height.wgsl?raw';
import flowFluxWgsl from '../shaders/flow_flux.wgsl?raw';
import flowUpdateWgsl from '../shaders/flow_update.wgsl?raw';
import flowRoundtripWgsl from '../shaders/flow_uniforms_roundtrip.wgsl?raw';
import {
  FLOW_PARAMS_FIELDS,
  MAX_SUBSTEPS_PER_FRAME,
  flowParamsFromThinFilm,
  flowParamsUniformRecord,
  maxStableDtFromHMax,
} from './flowParams';
import { readBufferToFloat32, readTextureToFloat32 } from './readback';
import {
  createComputePipelineFromWgsl,
  createUniformBuffer,
  packUniforms,
  type UniformField,
} from './uniforms';

const BLIT_PARAMS_FIELDS: readonly UniformField[] = [
  { name: 'hScale', type: 'f32' },
  { name: 'pad0', type: 'f32' },
  { name: 'pad1', type: 'f32' },
  { name: 'pad2', type: 'f32' },
];

/** COPY_SRC|COPY_DST|TEXTURE_BINDING|STORAGE_BINDING — numeric so Node tests can import. */
const HEIGHT_USAGE = 0x01 | 0x02 | 0x04 | 0x08;

export type ThinFilmGpuCompareResult = {
  maxAbsDiff: number;
  relative: number;
  steps: number;
  gridSize: number;
};

export type ThinFilmGpuRoundTripResult = {
  ok: boolean;
  expected: Float32Array;
  actual: Float32Array;
};

export type ThinFilmGpuResources = {
  readonly width: number;
  readonly height: number;
  simParams: ThinFilmParams;
  hMaxHint: number;
  drainedVolume: number;
  lastSubsteps: number;
  simTimeAdvanced: number;
  wallTimeAccumMs: number;
  destroy(): void;
  writeHeight(data: ArrayLike<number>): void;
  readHeight(): Promise<Float32Array>;
  encodeSubstep(encoder: GPUCommandEncoder, dt: number): void;
  encodeFrame(encoder: GPUCommandEncoder, frameDt: number): { substeps: number; simDt: number };
  encodeBlit(encoder: GPUCommandEncoder, targetView: GPUTextureView, clearValue: GPUColor): void;
  resetPuddle(): void;
  syncDrainFromGpu(): Promise<void>;
  compareToCpu(steps: number): Promise<ThinFilmGpuCompareResult>;
  checkUniformRoundTrip(): Promise<ThinFilmGpuRoundTripResult>;
};

function createHeightTexture(device: GPUDevice, label: string, w: number, h: number): GPUTexture {
  return device.createTexture({
    label,
    size: { width: w, height: h },
    format: 'r32float',
    usage: HEIGHT_USAGE,
  });
}

function maxOf(data: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i]!;
    if (v > m) m = v;
  }
  return m;
}

/**
 * GPU explicit thin-film solver matching M1-01 (limiter, upwind g∥, Neumann edges).
 * Ping-pong bind groups for A→B / B→A are built once at creation.
 */
export function createThinFilmGpu(
  device: GPUDevice,
  canvasFormat: GPUTextureFormat,
  width: number,
  height: number,
  params: ThinFilmParams = { ...DEFAULT_THIN_FILM_PARAMS },
): ThinFilmGpuResources {
  if (!(width > 0) || !(height > 0)) {
    throw new RangeError('thin-film grid size must be positive');
  }

  const simParams: ThinFilmParams = { ...params };
  const textureA = createHeightTexture(device, 'thinFilmA', width, height);
  const textureB = createHeightTexture(device, 'thinFilmB', width, height);
  const viewA = textureA.createView({ label: 'thinFilmA-view' });
  const viewB = textureB.createView({ label: 'thinFilmB-view' });
  const sampleA = textureA.createView({ label: 'thinFilmA-sample' });
  const sampleB = textureB.createView({ label: 'thinFilmB-sample' });

  const qxBuffer = device.createBuffer({
    label: 'thinFilm-qx',
    size: (width + 1) * height * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const qyBuffer = device.createBuffer({
    label: 'thinFilm-qy',
    size: width * (height + 1) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const drainBuffer = device.createBuffer({
    label: 'thinFilm-drain',
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(drainBuffer, 0, new Uint32Array([0]));

  const uniformBuffer = createUniformBuffer(
    device,
    FLOW_PARAMS_FIELDS,
    flowParamsUniformRecord(flowParamsFromThinFilm(simParams, 1e-4, width, height)),
    'thinFilm-params',
  );

  const fluxPipeline = createComputePipelineFromWgsl(device, flowFluxWgsl, {
    label: 'thinFilm-flux',
  });
  const updatePipeline = createComputePipelineFromWgsl(device, flowUpdateWgsl, {
    label: 'thinFilm-update',
  });

  const fluxBindA = device.createBindGroup({
    label: 'thinFilm-flux-A',
    layout: fluxPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: viewA },
      { binding: 2, resource: { buffer: qxBuffer } },
      { binding: 3, resource: { buffer: qyBuffer } },
    ],
  });
  const fluxBindB = device.createBindGroup({
    label: 'thinFilm-flux-B',
    layout: fluxPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: viewB },
      { binding: 2, resource: { buffer: qxBuffer } },
      { binding: 3, resource: { buffer: qyBuffer } },
    ],
  });
  const updateBindAtoB = device.createBindGroup({
    label: 'thinFilm-update-AtoB',
    layout: updatePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: viewA },
      { binding: 2, resource: viewB },
      { binding: 3, resource: { buffer: qxBuffer } },
      { binding: 4, resource: { buffer: qyBuffer } },
      { binding: 5, resource: { buffer: drainBuffer } },
    ],
  });
  const updateBindBtoA = device.createBindGroup({
    label: 'thinFilm-update-BtoA',
    layout: updatePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: viewB },
      { binding: 2, resource: viewA },
      { binding: 3, resource: { buffer: qxBuffer } },
      { binding: 4, resource: { buffer: qyBuffer } },
      { binding: 5, resource: { buffer: drainBuffer } },
    ],
  });

  const blitUniform = createUniformBuffer(
    device,
    BLIT_PARAMS_FIELDS,
    { hScale: 2, pad0: 0, pad1: 0, pad2: 0 },
    'thinFilm-blit-params',
  );
  const blitModule = device.createShaderModule({
    label: 'thinFilm-blit-module',
    code: blitHeightWgsl,
  });
  const blitPipeline = device.createRenderPipeline({
    label: 'thinFilm-blit',
    layout: 'auto',
    vertex: { module: blitModule, entryPoint: 'vs_main' },
    fragment: {
      module: blitModule,
      entryPoint: 'fs_main',
      targets: [{ format: canvasFormat }],
    },
    primitive: { topology: 'triangle-list' },
  });
  const blitBindA = device.createBindGroup({
    label: 'thinFilm-blit-A',
    layout: blitPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sampleA },
      { binding: 1, resource: { buffer: blitUniform } },
    ],
  });
  const blitBindB = device.createBindGroup({
    label: 'thinFilm-blit-B',
    layout: blitPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sampleB },
      { binding: 1, resource: { buffer: blitUniform } },
    ],
  });

  const roundtripPipeline = createComputePipelineFromWgsl(device, flowRoundtripWgsl, {
    label: 'thinFilm-uniform-roundtrip',
  });
  const roundtripOut = device.createBuffer({
    label: 'thinFilm-roundtrip-out',
    size: 12 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const roundtripBind = device.createBindGroup({
    label: 'thinFilm-roundtrip-bind',
    layout: roundtripPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: roundtripOut } },
    ],
  });

  let readIsA = true;
  const state = {
    hMaxHint: 2,
    drainedVolume: 0,
    lastSubsteps: 0,
    simTimeAdvanced: 0,
    wallTimeAccumMs: 0,
  };

  const workgroupsX = Math.ceil(width / 8);
  const workgroupsY = Math.ceil(height / 8);

  const writeUniforms = (dt: number): void => {
    device.queue.writeBuffer(
      uniformBuffer,
      0,
      packUniforms(
        FLOW_PARAMS_FIELDS,
        flowParamsUniformRecord(flowParamsFromThinFilm(simParams, dt, width, height)),
      ),
    );
  };

  const currentReadTexture = (): GPUTexture => (readIsA ? textureA : textureB);

  const seedPuddleData = (): Float32Array => {
    const grid = createGrid2D(width, height);
    addGaussianPuddle(grid, width / 2, height / 2, 1.5, Math.max(3, width * 0.08));
    const data = new Float32Array(width * height);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = grid.data[i]!;
    }
    state.hMaxHint = Math.max(state.hMaxHint, maxOf(data) * 1.05);
    return data;
  };

  const writeHeight = (data: ArrayLike<number>): void => {
    const packed = data instanceof Float32Array ? data : Float32Array.from(data);
    device.queue.writeTexture(
      { texture: currentReadTexture() },
      packed,
      { bytesPerRow: width * 4 },
      { width, height },
    );
    state.hMaxHint = Math.max(state.hMaxHint, maxOf(packed) * 1.05);
  };

  const encodeSubstep = (encoder: GPUCommandEncoder, dt: number): void => {
    writeUniforms(dt);
    const fluxBg = readIsA ? fluxBindA : fluxBindB;
    const updateBg = readIsA ? updateBindAtoB : updateBindBtoA;

    const fluxPass = encoder.beginComputePass({ label: 'thinFilm-flux-pass' });
    fluxPass.setPipeline(fluxPipeline);
    fluxPass.setBindGroup(0, fluxBg);
    fluxPass.dispatchWorkgroups(workgroupsX, workgroupsY);
    fluxPass.end();

    const updatePass = encoder.beginComputePass({ label: 'thinFilm-update-pass' });
    updatePass.setPipeline(updatePipeline);
    updatePass.setBindGroup(0, updateBg);
    updatePass.dispatchWorkgroups(workgroupsX, workgroupsY);
    updatePass.end();

    readIsA = !readIsA;
  };

  const resources: ThinFilmGpuResources = {
    width,
    height,
    simParams,
    get hMaxHint() {
      return state.hMaxHint;
    },
    set hMaxHint(v: number) {
      state.hMaxHint = v;
    },
    get drainedVolume() {
      return state.drainedVolume;
    },
    set drainedVolume(v: number) {
      state.drainedVolume = v;
    },
    get lastSubsteps() {
      return state.lastSubsteps;
    },
    set lastSubsteps(v: number) {
      state.lastSubsteps = v;
    },
    get simTimeAdvanced() {
      return state.simTimeAdvanced;
    },
    set simTimeAdvanced(v: number) {
      state.simTimeAdvanced = v;
    },
    get wallTimeAccumMs() {
      return state.wallTimeAccumMs;
    },
    set wallTimeAccumMs(v: number) {
      state.wallTimeAccumMs = v;
    },

    destroy() {
      textureA.destroy();
      textureB.destroy();
      qxBuffer.destroy();
      qyBuffer.destroy();
      drainBuffer.destroy();
      uniformBuffer.destroy();
      blitUniform.destroy();
      roundtripOut.destroy();
    },

    writeHeight,
    async readHeight() {
      return readTextureToFloat32(device, currentReadTexture(), { width, height });
    },
    encodeSubstep,

    encodeFrame(encoder: GPUCommandEncoder, frameDt: number) {
      const t0 = performance.now();
      let remaining = Math.max(0, frameDt);
      let substeps = 0;
      let simDt = 0;
      while (remaining > 0 && substeps < MAX_SUBSTEPS_PER_FRAME) {
        const dtMax = maxStableDtFromHMax(state.hMaxHint, simParams);
        const sub = Math.min(remaining, dtMax);
        encodeSubstep(encoder, sub);
        remaining -= sub;
        simDt += sub;
        substeps += 1;
      }
      state.lastSubsteps = substeps;
      state.simTimeAdvanced += simDt;
      state.wallTimeAccumMs += performance.now() - t0;
      return { substeps, simDt };
    },

    encodeBlit(encoder: GPUCommandEncoder, targetView: GPUTextureView, clearValue: GPUColor) {
      const bind = readIsA ? blitBindA : blitBindB;
      const pass = encoder.beginRenderPass({
        label: 'thinFilm-blit-pass',
        colorAttachments: [
          {
            view: targetView,
            clearValue,
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(blitPipeline);
      pass.setBindGroup(0, bind);
      pass.draw(3);
      pass.end();
    },

    resetPuddle() {
      readIsA = true;
      state.drainedVolume = 0;
      state.simTimeAdvanced = 0;
      state.wallTimeAccumMs = 0;
      device.queue.writeBuffer(drainBuffer, 0, new Uint32Array([0]));
      writeHeight(seedPuddleData());
    },

    async syncDrainFromGpu() {
      const words = await readBufferToFloat32(device, drainBuffer, 4);
      const bits = new Uint32Array(words.buffer, words.byteOffset, 1)[0]!;
      state.drainedVolume = bits / 1e6;
    },

    async compareToCpu(steps: number): Promise<ThinFilmGpuCompareResult> {
      const n = 64;
      const compareParams: ThinFilmParams = {
        ...DEFAULT_THIN_FILM_PARAMS,
        dx: 300 / n,
        dtSafety: 0.2,
        gParallelX: 0,
        gParallelY: 0,
      };
      const cpu = createThinFilmState(n, n);
      addGaussianPuddle(cpu.height, n / 2, n / 2, 1.2, 4);
      const initial = new Float32Array(n * n);
      for (let i = 0; i < initial.length; i += 1) {
        initial[i] = cpu.height.data[i]!;
      }

      // Freeze Δt from the initial field so GPU and CPU share identical substeps.
      const dt0 = maxStableDtFromHMax(maxOf(initial), compareParams);
      const dts = Array.from({ length: steps }, () => dt0);

      const gpu = createThinFilmGpu(device, canvasFormat, n, n, compareParams);
      try {
        gpu.writeHeight(initial);
        const encoder = device.createCommandEncoder({ label: 'compare-batch' });
        for (const dt of dts) {
          gpu.encodeSubstep(encoder, dt);
        }
        device.queue.submit([encoder.finish()]);
        for (const dt of dts) {
          thinFilmSubstep(cpu, dt, compareParams);
        }
        await device.queue.onSubmittedWorkDone();
        const gpuH = await gpu.readHeight();
        const cpuF32 = createGrid2D(n, n);
        const gpuGrid = createGrid2D(n, n);
        for (let i = 0; i < n * n; i += 1) {
          cpuF32.data[i] = cpu.height.data[i]!;
          gpuGrid.data[i] = gpuH[i]!;
        }
        const abs = maxAbsDiff(cpuF32, gpuGrid);
        const peak = Math.max(maxOf(cpuF32.data), maxOf(gpuH), 1e-6);
        return { maxAbsDiff: abs, relative: abs / peak, steps, gridSize: n };
      } finally {
        gpu.destroy();
      }
    },

    async checkUniformRoundTrip(): Promise<ThinFilmGpuRoundTripResult> {
      const values = flowParamsFromThinFilm(simParams, 1.25e-4, width, height);
      const packedBuf = packUniforms(FLOW_PARAMS_FIELDS, flowParamsUniformRecord(values));
      const packed = new Float32Array(packedBuf);
      device.queue.writeBuffer(uniformBuffer, 0, packedBuf);
      const encoder = device.createCommandEncoder({ label: 'uniform-roundtrip' });
      const pass = encoder.beginComputePass({ label: 'uniform-roundtrip-pass' });
      pass.setPipeline(roundtripPipeline);
      pass.setBindGroup(0, roundtripBind);
      pass.dispatchWorkgroups(1);
      pass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      const actual = await readBufferToFloat32(device, roundtripOut, 12 * 4);
      const expected = packed.slice(0, 12);
      let ok = true;
      for (let i = 0; i < 12; i += 1) {
        if (i >= 10) {
          if (actual[i] !== expected[i]) ok = false;
        } else if (
          !(Math.abs(actual[i]! - expected[i]!) <= 1e-6 * Math.max(1, Math.abs(expected[i]!)))
        ) {
          ok = false;
        }
      }
      return { ok, expected, actual };
    },
  };

  resources.resetPuddle();
  return resources;
}
