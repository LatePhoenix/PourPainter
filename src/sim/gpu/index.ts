/** WebGPU device, buffers, pipelines, ping-pong textures. */
export type { BlurDemoResources } from './demoBlur';
export {
  createBlurDemo,
  createBlurTestPattern,
  encodeBlitPass,
  encodeBlurPass,
  resetBlurDemoPattern,
} from './demoBlur';
export type { GpuInitError, GpuInitErrorCode, GpuInitResult, GpuInitSuccess } from './device';
export { requestGpuDevice } from './device';
export {
  FLOW_PARAMS_FIELDS,
  HMAX_READBACK_INTERVAL_FRAMES,
  HMAX_SAFETY_MARGIN,
  MAX_SUBSTEPS_PER_FRAME,
  UNIFORM_RING_SLOTS,
  UNIFORM_RING_STRIDE,
  flowParamsFromThinFilm,
  flowParamsUniformRecord,
  maxStableDtFromHMax,
} from './flowParams';
export type { PingPongTextures } from './pingPong';
export { createPingPongTextures } from './pingPong';
export { alignedBytesPerRow, readBufferToFloat32, readTextureToFloat32 } from './readback';
export type {
  ThinFilmGpuCompareResult,
  ThinFilmGpuResources,
  ThinFilmGpuRoundTripResult,
} from './thinFilmGpu';
export { createThinFilmGpu } from './thinFilmGpu';
export type {
  ComputePipelineFromWgslOptions,
  UniformField,
  UniformFieldType,
  UniformValue,
} from './uniforms';
export {
  createComputePipelineFromWgsl,
  createUniformBuffer,
  packUniforms,
  uniformStructSize,
} from './uniforms';
export {
  BLIT_GRAYSCALE_WGSL,
  BLIT_HEIGHT_WGSL,
  BLUR_WGSL,
  FLOW_FLUX_WGSL,
  FLOW_HMAX_WGSL,
  FLOW_UPDATE_WGSL,
  FLOW_UNIFORMS_ROUNDTRIP_WGSL,
  PLACEHOLDER_WGSL,
} from './wgslRaw';
