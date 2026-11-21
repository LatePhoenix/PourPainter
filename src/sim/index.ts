/** Simulation core entry. No React imports allowed. */
export type { CanvasPoint, TexelCoord } from './coords';
export { canvasToTexel, pointerToCanvas } from './coords';
export { createSimController, SimControllerError } from './controller';
export type { GpuInitError, GpuInitErrorCode, GpuInitResult, GpuInitSuccess } from './gpu/device';
export { requestGpuDevice } from './gpu/device';
export type { PingPongTextures } from './gpu/pingPong';
export { createPingPongTextures } from './gpu/pingPong';
export { alignedBytesPerRow, readBufferToFloat32, readTextureToFloat32 } from './gpu/readback';
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
  GridSize,
  SimController,
  SimPointerEvent,
  SimSettings,
  SimStats,
  SimTool,
} from './types';
