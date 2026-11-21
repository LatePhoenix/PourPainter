import { createGrid2D, maxAbsDiff } from '../cpu/grid';
import {
  SEMI_IMPLICIT_ACCURACY_FACTOR,
  SEMI_IMPLICIT_SWEEPS,
  explicitCapillaryDt,
  thinFilmSubstepSemiImplicit,
} from '../cpu/thinFilmSemi';
import {
  addGaussianPuddle,
  createThinFilmState,
  DEFAULT_THIN_FILM_PARAMS,
  gravityFromTilt,
  thinFilmSubstep,
  type ThinFilmParams,
} from '../cpu/thinFilm';
import blitHeightWgsl from '../shaders/blit_height.wgsl?raw';
import flowFluxWgsl from '../shaders/flow_flux.wgsl?raw';
import flowHmaxWgsl from '../shaders/flow_hmax.wgsl?raw';
import flowSemiAssembleWgsl from '../shaders/flow_semi_assemble.wgsl?raw';
import flowSemiExplicitWgsl from '../shaders/flow_semi_explicit.wgsl?raw';
import flowSemiGsWgsl from '../shaders/flow_semi_gs.wgsl?raw';
import flowSemiSeedWgsl from '../shaders/flow_semi_seed.wgsl?raw';
import flowUpdateWgsl from '../shaders/flow_update.wgsl?raw';
import flowRoundtripWgsl from '../shaders/flow_uniforms_roundtrip.wgsl?raw';
import {
  FLOW_PARAMS_FIELDS,
  HMAX_READBACK_INTERVAL_FRAMES,
  HMAX_SAFETY_MARGIN,
  MAX_SUBSTEPS_PER_FRAME,
  UNIFORM_RING_SLOTS,
  UNIFORM_RING_STRIDE,
  flowParamsFromThinFilm,
  flowParamsUniformRecord,
  maxStableDtFromHMax,
  maxStableDtSemiImplicitFromHMax,
} from './flowParams';
import { readBufferToFloat32, readTextureToFloat32 } from './readback';
import {
  createComputePipelineFromWgsl,
  createUniformBuffer,
  packUniforms,
  uniformStructSize,
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

const FLOW_PARAMS_BYTES = uniformStructSize(FLOW_PARAMS_FIELDS);

export type ThinFilmGpuCaseResult = {
  name: string;
  maxAbsDiff: number;
  relative: number;
  drainRelative: number | null;
  steps: number;
  gridSize: number;
  ok: boolean;
};

export type ThinFilmFlowMode = 'explicit' | 'semi';

export type ThinFilmGpuCompareResult = {
  /** Level canvas, equal dt (legacy single-number summary = this case). */
  level: ThinFilmGpuCaseResult;
  mixedDt: ThinFilmGpuCaseResult;
  tilted: ThinFilmGpuCaseResult;
  /** Semi-implicit vs CPU semi-implicit reference. */
  semi: ThinFilmGpuCaseResult;
  /** Convenience: worst relative height error across explicit cases. */
  relative: number;
  maxAbsDiff: number;
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
  /** Explicit M1-02 step, or semi-implicit capillary (ADR 0003). */
  flowMode: ThinFilmFlowMode;
  hMaxHint: number;
  drainedVolume: number;
  lastSubsteps: number;
  simTimeAdvanced: number;
  wallTimeAccumMs: number;
  /** Frames since last hMax reduction was kicked off. */
  framesSinceHMaxReadback: number;
  destroy(): void;
  writeHeight(data: ArrayLike<number>): void;
  readHeight(): Promise<Float32Array>;
  /**
   * Encode `dts.length` substeps (≤ UNIFORM_RING_SLOTS) into `encoder`.
   * Writes the uniform ring once, then binds each slot with a dynamic offset.
   */
  encodeSubsteps(encoder: GPUCommandEncoder, dts: readonly number[]): void;
  encodeFrame(encoder: GPUCommandEncoder, frameDt: number): { substeps: number; simDt: number };
  /** Kick off async hMax reduction when due; non-blocking. */
  maybeScheduleHMaxReadback(encoder: GPUCommandEncoder): void;
  encodeBlit(encoder: GPUCommandEncoder, targetView: GPUTextureView, clearValue: GPUColor): void;
  resetPuddle(): void;
  syncDrainFromGpu(): Promise<void>;
  compareToCpu(steps?: number): Promise<ThinFilmGpuCompareResult>;
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

function relativeDiff(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-12);
  return Math.abs(a - b) / denom;
}

/**
 * GPU explicit thin-film solver matching M1-01 (limiter, upwind g∥, Neumann edges).
 * Uniform ring + dynamic offsets so each substep in a frame sees its own `dt`.
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

  const hMaxBuffer = device.createBuffer({
    label: 'thinFilm-hMax',
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(hMaxBuffer, 0, new Uint32Array([0]));

  // Uniform ring: one 256-byte slot per substep (dynamic offset).
  const uniformRing = device.createBuffer({
    label: 'thinFilm-params-ring',
    size: UNIFORM_RING_SLOTS * UNIFORM_RING_STRIDE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const ringScratch = new ArrayBuffer(UNIFORM_RING_SLOTS * UNIFORM_RING_STRIDE);

  const fluxLayout = device.createBindGroupLayout({
    label: 'thinFilm-flux-bgl',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: FLOW_PARAMS_BYTES },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'read-only', format: 'r32float' },
      },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const updateLayout = device.createBindGroupLayout({
    label: 'thinFilm-update-bgl',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: FLOW_PARAMS_BYTES },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'read-only', format: 'r32float' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: 'r32float' },
      },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  // Dedicated uniforms for hMax (avoids clobbering the per-frame dt ring).
  const hMaxUniform = createUniformBuffer(
    device,
    FLOW_PARAMS_FIELDS,
    flowParamsUniformRecord(flowParamsFromThinFilm(simParams, 1e-4, width, height)),
    'thinFilm-hmax-params',
  );
  const hMaxLayout = device.createBindGroupLayout({
    label: 'thinFilm-hmax-bgl',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform', minBindingSize: FLOW_PARAMS_BYTES },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'read-only', format: 'r32float' },
      },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });

  const fluxPipeline = createComputePipelineFromWgsl(device, flowFluxWgsl, {
    label: 'thinFilm-flux',
    layout: device.createPipelineLayout({ bindGroupLayouts: [fluxLayout] }),
  });
  const updatePipeline = createComputePipelineFromWgsl(device, flowUpdateWgsl, {
    label: 'thinFilm-update',
    layout: device.createPipelineLayout({ bindGroupLayouts: [updateLayout] }),
  });
  const hMaxPipeline = createComputePipelineFromWgsl(device, flowHmaxWgsl, {
    label: 'thinFilm-hmax',
    layout: device.createPipelineLayout({ bindGroupLayouts: [hMaxLayout] }),
  });

  const iterateBuffer = device.createBuffer({
    label: 'thinFilm-iterate',
    size: width * height * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const semiExplicitPipeline = createComputePipelineFromWgsl(device, flowSemiExplicitWgsl, {
    label: 'thinFilm-semi-explicit',
    layout: device.createPipelineLayout({ bindGroupLayouts: [fluxLayout] }),
  });
  const seedLayout = device.createBindGroupLayout({
    label: 'thinFilm-semi-seed-bgl',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: FLOW_PARAMS_BYTES },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'read-only', format: 'r32float' },
      },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const gsLayout = device.createBindGroupLayout({
    label: 'thinFilm-semi-gs-bgl',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: FLOW_PARAMS_BYTES },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'read-only', format: 'r32float' },
      },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    ],
  });
  const assembleLayout = device.createBindGroupLayout({
    label: 'thinFilm-semi-assemble-bgl',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: FLOW_PARAMS_BYTES },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'read-only', format: 'r32float' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: 'r32float' },
      },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    ],
  });
  const semiSeedPipeline = createComputePipelineFromWgsl(device, flowSemiSeedWgsl, {
    label: 'thinFilm-semi-seed',
    layout: device.createPipelineLayout({ bindGroupLayouts: [seedLayout] }),
  });
  const semiGsEven = createComputePipelineFromWgsl(device, flowSemiGsWgsl, {
    label: 'thinFilm-semi-gs-even',
    entryPoint: 'sweep_even',
    layout: device.createPipelineLayout({ bindGroupLayouts: [gsLayout] }),
  });
  const semiGsOdd = createComputePipelineFromWgsl(device, flowSemiGsWgsl, {
    label: 'thinFilm-semi-gs-odd',
    entryPoint: 'sweep_odd',
    layout: device.createPipelineLayout({ bindGroupLayouts: [gsLayout] }),
  });
  const semiAssemblePipeline = createComputePipelineFromWgsl(device, flowSemiAssembleWgsl, {
    label: 'thinFilm-semi-assemble',
    layout: device.createPipelineLayout({ bindGroupLayouts: [assembleLayout] }),
  });

  const ringBinding = { buffer: uniformRing, offset: 0, size: UNIFORM_RING_STRIDE };

  const fluxBindA = device.createBindGroup({
    label: 'thinFilm-flux-A',
    layout: fluxLayout,
    entries: [
      { binding: 0, resource: ringBinding },
      { binding: 1, resource: viewA },
      { binding: 2, resource: { buffer: qxBuffer } },
      { binding: 3, resource: { buffer: qyBuffer } },
    ],
  });
  const fluxBindB = device.createBindGroup({
    label: 'thinFilm-flux-B',
    layout: fluxLayout,
    entries: [
      { binding: 0, resource: ringBinding },
      { binding: 1, resource: viewB },
      { binding: 2, resource: { buffer: qxBuffer } },
      { binding: 3, resource: { buffer: qyBuffer } },
    ],
  });
  const updateBindAtoB = device.createBindGroup({
    label: 'thinFilm-update-AtoB',
    layout: updateLayout,
    entries: [
      { binding: 0, resource: ringBinding },
      { binding: 1, resource: viewA },
      { binding: 2, resource: viewB },
      { binding: 3, resource: { buffer: qxBuffer } },
      { binding: 4, resource: { buffer: qyBuffer } },
      { binding: 5, resource: { buffer: drainBuffer } },
    ],
  });
  const updateBindBtoA = device.createBindGroup({
    label: 'thinFilm-update-BtoA',
    layout: updateLayout,
    entries: [
      { binding: 0, resource: ringBinding },
      { binding: 1, resource: viewB },
      { binding: 2, resource: viewA },
      { binding: 3, resource: { buffer: qxBuffer } },
      { binding: 4, resource: { buffer: qyBuffer } },
      { binding: 5, resource: { buffer: drainBuffer } },
    ],
  });
  const hMaxBindA = device.createBindGroup({
    label: 'thinFilm-hmax-A',
    layout: hMaxLayout,
    entries: [
      { binding: 0, resource: { buffer: hMaxUniform } },
      { binding: 1, resource: viewA },
      { binding: 2, resource: { buffer: hMaxBuffer } },
    ],
  });
  const seedBindA = device.createBindGroup({
    label: 'thinFilm-semi-seed-A',
    layout: seedLayout,
    entries: [
      { binding: 0, resource: ringBinding },
      { binding: 1, resource: viewA },
      { binding: 2, resource: { buffer: iterateBuffer } },
    ],
  });
  const seedBindB = device.createBindGroup({
    label: 'thinFilm-semi-seed-B',
    layout: seedLayout,
    entries: [
      { binding: 0, resource: ringBinding },
      { binding: 1, resource: viewB },
      { binding: 2, resource: { buffer: iterateBuffer } },
    ],
  });
  const gsBindA = device.createBindGroup({
    label: 'thinFilm-semi-gs-A',
    layout: gsLayout,
    entries: [
      { binding: 0, resource: ringBinding },
      { binding: 1, resource: viewA },
      { binding: 2, resource: { buffer: iterateBuffer } },
      { binding: 3, resource: { buffer: qxBuffer } },
      { binding: 4, resource: { buffer: qyBuffer } },
    ],
  });
  const gsBindB = device.createBindGroup({
    label: 'thinFilm-semi-gs-B',
    layout: gsLayout,
    entries: [
      { binding: 0, resource: ringBinding },
      { binding: 1, resource: viewB },
      { binding: 2, resource: { buffer: iterateBuffer } },
      { binding: 3, resource: { buffer: qxBuffer } },
      { binding: 4, resource: { buffer: qyBuffer } },
    ],
  });
  const assembleBindAtoB = device.createBindGroup({
    label: 'thinFilm-semi-assemble-AtoB',
    layout: assembleLayout,
    entries: [
      { binding: 0, resource: ringBinding },
      { binding: 1, resource: viewA },
      { binding: 2, resource: viewB },
      { binding: 3, resource: { buffer: qxBuffer } },
      { binding: 4, resource: { buffer: qyBuffer } },
      { binding: 5, resource: { buffer: drainBuffer } },
      { binding: 6, resource: { buffer: iterateBuffer } },
    ],
  });
  const assembleBindBtoA = device.createBindGroup({
    label: 'thinFilm-semi-assemble-BtoA',
    layout: assembleLayout,
    entries: [
      { binding: 0, resource: ringBinding },
      { binding: 1, resource: viewB },
      { binding: 2, resource: viewA },
      { binding: 3, resource: { buffer: qxBuffer } },
      { binding: 4, resource: { buffer: qyBuffer } },
      { binding: 5, resource: { buffer: drainBuffer } },
      { binding: 6, resource: { buffer: iterateBuffer } },
    ],
  });
  const hMaxBindB = device.createBindGroup({
    label: 'thinFilm-hmax-B',
    layout: hMaxLayout,
    entries: [
      { binding: 0, resource: { buffer: hMaxUniform } },
      { binding: 1, resource: viewB },
      { binding: 2, resource: { buffer: hMaxBuffer } },
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

  // Round-trip uses slot 0 of the ring (static bind, no dynamic offset needed).
  const roundtripLayout = device.createBindGroupLayout({
    label: 'thinFilm-roundtrip-bgl',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform', minBindingSize: FLOW_PARAMS_BYTES },
      },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const roundtripPipeline = createComputePipelineFromWgsl(device, flowRoundtripWgsl, {
    label: 'thinFilm-uniform-roundtrip',
    layout: device.createPipelineLayout({ bindGroupLayouts: [roundtripLayout] }),
  });
  const roundtripOut = device.createBuffer({
    label: 'thinFilm-roundtrip-out',
    size: 12 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const roundtripBind = device.createBindGroup({
    label: 'thinFilm-roundtrip-bind',
    layout: roundtripLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformRing, offset: 0, size: UNIFORM_RING_STRIDE } },
      { binding: 1, resource: { buffer: roundtripOut } },
    ],
  });

  let readIsA = true;
  let flowMode: ThinFilmFlowMode = 'explicit';
  let hMaxReadbackInFlight = false;
  const state = {
    hMaxHint: 2,
    drainedVolume: 0,
    lastSubsteps: 0,
    simTimeAdvanced: 0,
    wallTimeAccumMs: 0,
    framesSinceHMaxReadback: 0,
  };

  const workgroupsX = Math.ceil(width / 8);
  const workgroupsY = Math.ceil(height / 8);
  const gsCells = (width / 2) * height;
  const gsWorkgroups = Math.ceil(gsCells / 64);

  const packRingSlots = (dts: readonly number[]): void => {
    if (dts.length > UNIFORM_RING_SLOTS) {
      throw new RangeError(
        `dts length ${dts.length} exceeds UNIFORM_RING_SLOTS ${UNIFORM_RING_SLOTS}`,
      );
    }
    const bytes = new Uint8Array(ringScratch);
    bytes.fill(0);
    for (let i = 0; i < dts.length; i += 1) {
      const packed = new Uint8Array(
        packUniforms(
          FLOW_PARAMS_FIELDS,
          flowParamsUniformRecord(flowParamsFromThinFilm(simParams, dts[i]!, width, height)),
        ),
      );
      bytes.set(packed, i * UNIFORM_RING_STRIDE);
    }
    device.queue.writeBuffer(uniformRing, 0, ringScratch, 0, dts.length * UNIFORM_RING_STRIDE);
  };

  const currentReadTexture = (): GPUTexture => (readIsA ? textureA : textureB);

  const seedPuddleData = (): Float32Array => {
    const grid = createGrid2D(width, height);
    addGaussianPuddle(grid, width / 2, height / 2, 1.5, Math.max(3, width * 0.08));
    const data = new Float32Array(width * height);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = grid.data[i]!;
    }
    state.hMaxHint = Math.max(state.hMaxHint, maxOf(data) * HMAX_SAFETY_MARGIN);
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
    // CPU-side deposits raise the hint immediately (safe for pouring later).
    state.hMaxHint = Math.max(state.hMaxHint, maxOf(packed) * HMAX_SAFETY_MARGIN);
  };

  const encodeSubsteps = (encoder: GPUCommandEncoder, dts: readonly number[]): void => {
    if (dts.length === 0) {
      return;
    }
    packRingSlots(dts);

    for (let i = 0; i < dts.length; i += 1) {
      const offset = i * UNIFORM_RING_STRIDE;
      if (flowMode === 'semi') {
        if (width % 2 !== 0) {
          throw new RangeError('semi-implicit GS requires an even grid width');
        }
        const seedBg = readIsA ? seedBindA : seedBindB;
        const fluxBg = readIsA ? fluxBindA : fluxBindB;
        const gsBg = readIsA ? gsBindA : gsBindB;
        const assembleBg = readIsA ? assembleBindAtoB : assembleBindBtoA;

        const seedPass = encoder.beginComputePass({ label: `thinFilm-semi-seed-${i}` });
        seedPass.setPipeline(semiSeedPipeline);
        seedPass.setBindGroup(0, seedBg, [offset]);
        seedPass.dispatchWorkgroups(workgroupsX, workgroupsY);
        seedPass.end();

        const exPass = encoder.beginComputePass({ label: `thinFilm-semi-ex-${i}` });
        exPass.setPipeline(semiExplicitPipeline);
        exPass.setBindGroup(0, fluxBg, [offset]);
        exPass.dispatchWorkgroups(workgroupsX, workgroupsY);
        exPass.end();

        for (let sweep = 0; sweep < SEMI_IMPLICIT_SWEEPS; sweep += 1) {
          const even = encoder.beginComputePass({ label: `thinFilm-gs-even-${i}-${sweep}` });
          even.setPipeline(semiGsEven);
          even.setBindGroup(0, gsBg, [offset]);
          even.dispatchWorkgroups(gsWorkgroups);
          even.end();
          const odd = encoder.beginComputePass({ label: `thinFilm-gs-odd-${i}-${sweep}` });
          odd.setPipeline(semiGsOdd);
          odd.setBindGroup(0, gsBg, [offset]);
          odd.dispatchWorkgroups(gsWorkgroups);
          odd.end();
        }

        const asm = encoder.beginComputePass({ label: `thinFilm-semi-asm-${i}` });
        asm.setPipeline(semiAssemblePipeline);
        asm.setBindGroup(0, assembleBg, [offset]);
        asm.dispatchWorkgroups(workgroupsX, workgroupsY);
        asm.end();
      } else {
        const fluxBg = readIsA ? fluxBindA : fluxBindB;
        const updateBg = readIsA ? updateBindAtoB : updateBindBtoA;

        const fluxPass = encoder.beginComputePass({ label: `thinFilm-flux-${i}` });
        fluxPass.setPipeline(fluxPipeline);
        fluxPass.setBindGroup(0, fluxBg, [offset]);
        fluxPass.dispatchWorkgroups(workgroupsX, workgroupsY);
        fluxPass.end();

        const updatePass = encoder.beginComputePass({ label: `thinFilm-update-${i}` });
        updatePass.setPipeline(updatePipeline);
        updatePass.setBindGroup(0, updateBg, [offset]);
        updatePass.dispatchWorkgroups(workgroupsX, workgroupsY);
        updatePass.end();
      }

      readIsA = !readIsA;
    }
  };

  const pollHMaxReadback = (): void => {
    if (!hMaxReadbackInFlight) {
      return;
    }
    // Fire-and-forget: map via helper, apply margin when ready.
    hMaxReadbackInFlight = false;
    void (async () => {
      try {
        const words = await readBufferToFloat32(device, hMaxBuffer, 4);
        const bits = new Uint32Array(words.buffer, words.byteOffset, 1)[0]!;
        const measured = new Float32Array(new Uint32Array([bits]).buffer)[0]!;
        if (Number.isFinite(measured) && measured > 0) {
          state.hMaxHint = measured * HMAX_SAFETY_MARGIN;
        }
      } catch {
        // Device lost / destroyed mid-readback — ignore.
      }
    })();
  };

  const resources: ThinFilmGpuResources = {
    width,
    height,
    simParams,
    get flowMode() {
      return flowMode;
    },
    set flowMode(mode: ThinFilmFlowMode) {
      flowMode = mode;
    },
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
    get framesSinceHMaxReadback() {
      return state.framesSinceHMaxReadback;
    },
    set framesSinceHMaxReadback(v: number) {
      state.framesSinceHMaxReadback = v;
    },

    destroy() {
      textureA.destroy();
      textureB.destroy();
      qxBuffer.destroy();
      qyBuffer.destroy();
      drainBuffer.destroy();
      hMaxBuffer.destroy();
      uniformRing.destroy();
      iterateBuffer.destroy();
      hMaxUniform.destroy();
      blitUniform.destroy();
      roundtripOut.destroy();
    },

    writeHeight,
    async readHeight() {
      return readTextureToFloat32(device, currentReadTexture(), { width, height });
    },
    encodeSubsteps,

    encodeFrame(encoder: GPUCommandEncoder, frameDt: number) {
      const t0 = performance.now();
      let remaining = Math.max(0, frameDt);
      const dts: number[] = [];
      while (remaining > 0 && dts.length < MAX_SUBSTEPS_PER_FRAME) {
        const dtMax =
          flowMode === 'semi'
            ? maxStableDtSemiImplicitFromHMax(
                state.hMaxHint,
                simParams,
                SEMI_IMPLICIT_ACCURACY_FACTOR,
              )
            : maxStableDtFromHMax(state.hMaxHint, simParams);
        const sub = Math.min(remaining, dtMax);
        dts.push(sub);
        remaining -= sub;
      }
      encodeSubsteps(encoder, dts);
      const simDt = dts.reduce((a, b) => a + b, 0);
      state.lastSubsteps = dts.length;
      state.simTimeAdvanced += simDt;
      state.wallTimeAccumMs += performance.now() - t0;
      state.framesSinceHMaxReadback += 1;
      return { substeps: dts.length, simDt };
    },

    maybeScheduleHMaxReadback(encoder: GPUCommandEncoder) {
      if (hMaxReadbackInFlight) {
        return;
      }
      if (state.framesSinceHMaxReadback < HMAX_READBACK_INTERVAL_FRAMES) {
        return;
      }
      device.queue.writeBuffer(
        hMaxUniform,
        0,
        packUniforms(
          FLOW_PARAMS_FIELDS,
          flowParamsUniformRecord(flowParamsFromThinFilm(simParams, 1e-4, width, height)),
        ),
      );
      device.queue.writeBuffer(hMaxBuffer, 0, new Uint32Array([0]));
      const bg = readIsA ? hMaxBindA : hMaxBindB;
      const pass = encoder.beginComputePass({ label: 'thinFilm-hmax-pass' });
      pass.setPipeline(hMaxPipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(workgroupsX, workgroupsY);
      pass.end();
      state.framesSinceHMaxReadback = 0;
      hMaxReadbackInFlight = true;
      queueMicrotask(() => {
        void device.queue.onSubmittedWorkDone().then(() => {
          pollHMaxReadback();
        });
      });
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
      state.framesSinceHMaxReadback = 0;
      hMaxReadbackInFlight = false;
      device.queue.writeBuffer(drainBuffer, 0, new Uint32Array([0]));
      device.queue.writeBuffer(hMaxBuffer, 0, new Uint32Array([0]));
      writeHeight(seedPuddleData());
    },

    async syncDrainFromGpu() {
      const words = await readBufferToFloat32(device, drainBuffer, 4);
      const bits = new Uint32Array(words.buffer, words.byteOffset, 1)[0]!;
      state.drainedVolume = bits / 1e6;
    },

    async compareToCpu(steps = 100): Promise<ThinFilmGpuCompareResult> {
      const n = 64;
      const level = await runLevelCompare(device, canvasFormat, n, steps);
      const mixedDt = await runMixedDtCompare(device, canvasFormat, n);
      const tilted = await runTiltedCompare(device, canvasFormat, n);
      const semi = await runSemiCompare(device, canvasFormat, n);
      const worst = [level, mixedDt, tilted].reduce((a, b) => (b.relative > a.relative ? b : a));
      return {
        level,
        mixedDt,
        tilted,
        semi,
        relative: worst.relative,
        maxAbsDiff: worst.maxAbsDiff,
        steps,
        gridSize: n,
      };
    },

    async checkUniformRoundTrip(): Promise<ThinFilmGpuRoundTripResult> {
      const values = flowParamsFromThinFilm(simParams, 1.25e-4, width, height);
      const packedBuf = packUniforms(FLOW_PARAMS_FIELDS, flowParamsUniformRecord(values));
      const packed = new Float32Array(packedBuf);
      // Write into slot 0 of the ring.
      const slot = new Uint8Array(UNIFORM_RING_STRIDE);
      slot.set(new Uint8Array(packedBuf));
      device.queue.writeBuffer(uniformRing, 0, slot);
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

async function finishCompareCase(
  device: GPUDevice,
  gpu: ThinFilmGpuResources,
  cpu: ReturnType<typeof createThinFilmState>,
  name: string,
  steps: number,
  gridSize: number,
  compareDrain: boolean,
): Promise<ThinFilmGpuCaseResult> {
  await device.queue.onSubmittedWorkDone();
  const gpuH = await gpu.readHeight();
  if (compareDrain) {
    await gpu.syncDrainFromGpu();
  }
  const cpuF32 = createGrid2D(gridSize, gridSize);
  const gpuGrid = createGrid2D(gridSize, gridSize);
  for (let i = 0; i < gridSize * gridSize; i += 1) {
    cpuF32.data[i] = cpu.height.data[i]!;
    gpuGrid.data[i] = gpuH[i]!;
  }
  const abs = maxAbsDiff(cpuF32, gpuGrid);
  const peak = Math.max(maxOf(cpuF32.data), maxOf(gpuH), 1e-6);
  const relative = abs / peak;
  const drainRel = compareDrain ? relativeDiff(gpu.drainedVolume, cpu.drainedVolume) : null;
  return {
    name,
    maxAbsDiff: abs,
    relative,
    drainRelative: drainRel,
    steps,
    gridSize,
    ok: relative < 1e-3 && (drainRel === null || drainRel < 1e-3),
  };
}

async function runLevelCompare(
  device: GPUDevice,
  canvasFormat: GPUTextureFormat,
  n: number,
  steps: number,
): Promise<ThinFilmGpuCaseResult> {
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
  const dt0 = maxStableDtFromHMax(maxOf(initial), compareParams);
  const dts = Array.from({ length: steps }, () => dt0);

  const gpu = createThinFilmGpu(device, canvasFormat, n, n, compareParams);
  try {
    gpu.writeHeight(initial);
    // Batch in ring-sized chunks (one writeBuffer + one encoder submit each).
    for (let start = 0; start < dts.length; start += UNIFORM_RING_SLOTS) {
      const chunk = dts.slice(start, start + UNIFORM_RING_SLOTS);
      const encoder = device.createCommandEncoder({ label: 'compare-level' });
      gpu.encodeSubsteps(encoder, chunk);
      device.queue.submit([encoder.finish()]);
      for (const dt of chunk) {
        thinFilmSubstep(cpu, dt, compareParams);
      }
    }
    return await finishCompareCase(device, gpu, cpu, 'level', steps, n, false);
  } finally {
    gpu.destroy();
  }
}

async function runMixedDtCompare(
  device: GPUDevice,
  canvasFormat: GPUTextureFormat,
  n: number,
): Promise<ThinFilmGpuCaseResult> {
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
  const dt0 = maxStableDtFromHMax(maxOf(initial), compareParams);
  const dts = [
    ...Array.from({ length: 50 }, () => dt0),
    ...Array.from({ length: 50 }, () => dt0 / 10),
  ];

  const gpu = createThinFilmGpu(device, canvasFormat, n, n, compareParams);
  try {
    gpu.writeHeight(initial);
    // Real frame path: one encoder, one ring write, mixed dts (fits in 128 slots).
    const encoder = device.createCommandEncoder({ label: 'compare-mixed' });
    gpu.encodeSubsteps(encoder, dts);
    device.queue.submit([encoder.finish()]);
    for (const dt of dts) {
      thinFilmSubstep(cpu, dt, compareParams);
    }
    return await finishCompareCase(device, gpu, cpu, 'mixed-dt', dts.length, n, false);
  } finally {
    gpu.destroy();
  }
}

async function runTiltedCompare(
  device: GPUDevice,
  canvasFormat: GPUTextureFormat,
  n: number,
): Promise<ThinFilmGpuCaseResult> {
  const g = gravityFromTilt(0, 0.3);
  const compareParams: ThinFilmParams = {
    ...DEFAULT_THIN_FILM_PARAMS,
    dx: 300 / n,
    dtSafety: 0.2,
    ...g,
  };
  const cpu = createThinFilmState(n, n);
  // Puddle 8 cells from the +x edge.
  addGaussianPuddle(cpu.height, n - 1 - 8, n / 2, 1.5, 3);
  const initial = new Float32Array(n * n);
  for (let i = 0; i < initial.length; i += 1) {
    initial[i] = cpu.height.data[i]!;
  }
  const dt0 = maxStableDtFromHMax(maxOf(initial) * HMAX_SAFETY_MARGIN, compareParams);
  const steps = 400;
  const dts = Array.from({ length: steps }, () => dt0);

  const gpu = createThinFilmGpu(device, canvasFormat, n, n, compareParams);
  try {
    gpu.resetPuddle();
    gpu.writeHeight(initial);
    for (let start = 0; start < dts.length; start += UNIFORM_RING_SLOTS) {
      const chunk = dts.slice(start, start + UNIFORM_RING_SLOTS);
      const encoder = device.createCommandEncoder({ label: 'compare-tilt' });
      gpu.encodeSubsteps(encoder, chunk);
      device.queue.submit([encoder.finish()]);
      for (const dt of chunk) {
        thinFilmSubstep(cpu, dt, compareParams);
      }
    }
    return await finishCompareCase(device, gpu, cpu, 'tilted', steps, n, true);
  } finally {
    gpu.destroy();
  }
}

async function runSemiCompare(
  device: GPUDevice,
  canvasFormat: GPUTextureFormat,
  n: number,
): Promise<ThinFilmGpuCaseResult> {
  const compareParams: ThinFilmParams = {
    ...DEFAULT_THIN_FILM_PARAMS,
    dx: 300 / n,
    dtSafety: 1,
    gParallelX: 0,
    gParallelY: 0,
  };
  const cpu = createThinFilmState(n, n);
  addGaussianPuddle(cpu.height, n / 2, n / 2, 1.2, 5);
  const initial = new Float32Array(n * n);
  for (let i = 0; i < initial.length; i += 1) {
    initial[i] = cpu.height.data[i]!;
  }
  const dt = 20 * explicitCapillaryDt(cpu.height, compareParams);
  const steps = 4;
  const dts = Array.from({ length: steps }, () => dt);

  const gpu = createThinFilmGpu(device, canvasFormat, n, n, compareParams);
  try {
    gpu.flowMode = 'semi';
    gpu.resetPuddle();
    gpu.writeHeight(initial);
    const encoder = device.createCommandEncoder({ label: 'compare-semi' });
    gpu.encodeSubsteps(encoder, dts);
    device.queue.submit([encoder.finish()]);
    for (const stepDt of dts) {
      thinFilmSubstepSemiImplicit(cpu, stepDt, compareParams);
    }
    return await finishCompareCase(device, gpu, cpu, 'semi', steps, n, false);
  } finally {
    gpu.destroy();
  }
}
