/** Simulation core entry. No React imports allowed. */
export type { CanvasPoint, TexelCoord } from './coords';
export { canvasToTexel, pointerToCanvas } from './coords';
export type { Grid2D, MirrorAxis } from './cpu/grid';
export {
  copyGrid,
  copyGridInto,
  createGrid2D,
  getCell,
  hasNonFinite,
  isMirrorSymmetric,
  maxAbsDiff,
  setCell,
  totalVolume,
} from './cpu/grid';
export { createSimController, SimControllerError } from './controller';
export type { GpuInitError, GpuInitErrorCode, GpuInitResult, GpuInitSuccess } from './gpu/device';
export { requestGpuDevice } from './gpu/device';
export type { PingPongTextures } from './gpu/pingPong';
export { createPingPongTextures } from './gpu/pingPong';
export { alignedBytesPerRow, readBufferToFloat32, readTextureToFloat32 } from './gpu/readback';
export type { ThinFilmGpuCompareResult, ThinFilmGpuResources } from './gpu/thinFilmGpu';
export { createThinFilmGpu } from './gpu/thinFilmGpu';
export {
  FLOW_PARAMS_FIELDS,
  HMAX_SAFETY_MARGIN,
  MAX_SUBSTEPS_PER_FRAME,
  UNIFORM_RING_SLOTS,
  UNIFORM_RING_STRIDE,
  flowParamsFromThinFilm,
  maxStableDtFromHMax,
} from './gpu/flowParams';
export type { UniformField, UniformValue } from './gpu/uniforms';
export {
  createComputePipelineFromWgsl,
  createUniformBuffer,
  packUniforms,
  uniformStructSize,
} from './gpu/uniforms';
export type { Rng } from './rng';
export { createRng } from './rng';
export type {
  CompareToCpuResult,
  GridSize,
  SimController,
  SimPointerEvent,
  SimSettings,
  SimStats,
  SimTool,
  UniformRoundTripResult,
} from './types';
export type { ThinFilmParams, ThinFilmState } from './cpu/thinFilm';
export {
  DEFAULT_THIN_FILM_PARAMS,
  addGaussianPuddle,
  createThinFilmState,
  gravityFromTilt,
  maxStableDt,
  thinFilmStep,
  thinFilmSubstep,
} from './cpu/thinFilm';
