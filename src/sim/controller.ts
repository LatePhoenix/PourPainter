import { DEFAULT_CELL_SIZE_MM, GRAVITY_MM_S2 } from '../domain/physics';
import { isValidSeed } from '../domain/seed';
import { canvasToTexel, pointerToCanvas, type CanvasPoint } from './coords';
import { gravityFromTilt, DEFAULT_THIN_FILM_PARAMS } from './cpu/thinFilm';
import { requestGpuDevice, type GpuInitError } from './gpu/device';
import { createThinFilmGpu, type ThinFilmGpuResources } from './gpu/thinFilmGpu';
import { createRng } from './rng';
import type {
  CompareToCpuResult,
  GridSize,
  SimController,
  SimPointerEvent,
  SimSettings,
  SimStats,
  SimTool,
  UniformRoundTripResult,
} from './types';

/** Acrylic canvas white as sRGB values for non-sRGB `*8unorm` swapchain clears. */
const CANVAS_WHITE = { r: 0.96, g: 0.94, b: 0.9, a: 1 };

/** Wall-clock frame budget used as the requested sim dt before the substep cap. */
const FRAME_SIM_DT = 1 / 60;

export class SimControllerError extends Error {
  readonly gpuError?: GpuInitError;

  constructor(message: string, gpuError?: GpuInitError) {
    super(message);
    this.name = 'SimControllerError';
    this.gpuError = gpuError;
  }
}

export function createSimController(): SimController {
  return new SimControllerImpl();
}

class SimControllerImpl implements SimController {
  private canvas: HTMLCanvasElement | null = null;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat | null = null;
  private seed = 0;
  private gridSize: GridSize = 512;
  private running = false;
  private rafId: number | null = null;
  private frameCount = 0;
  private stepCount = 0;
  private tiltX = 0;
  private tiltY = 0;
  private lastPointer: CanvasPoint | null = null;
  private lastTool: SimTool | null = null;
  private lastTexel: { i: number; j: number } | null = null;
  private deviceLost = false;
  private deviceLostMessage: string | null = null;
  private fps = 0;
  private fpsFrames = 0;
  private fpsLastTs = 0;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;
  private contextConfigured = false;
  private film: ThinFilmGpuResources | null = null;
  private gpuDeviceName: string | null = null;
  private compareRelative: number | null = null;
  private compareMaxAbs: number | null = null;
  private compareLevelRel: number | null = null;
  private compareMixedRel: number | null = null;
  private compareTiltRel: number | null = null;
  private compareTiltDrainRel: number | null = null;
  private uniformRoundTripOk: boolean | null = null;
  private simSecondsPerWallSecond = 0;
  private lastFrameTs: number | null = null;
  private throughputSim = 0;
  private throughputWallMs = 0;

  async init(canvas: HTMLCanvasElement, settings: SimSettings): Promise<void> {
    if (this.disposed) {
      throw new SimControllerError('Controller was disposed');
    }
    if (this.canvas) {
      throw new SimControllerError('Controller already initialized');
    }
    if (!isValidSeed(settings.seed)) {
      throw new SimControllerError('settings.seed must be an integer in [0, 2^32)');
    }

    const result = await requestGpuDevice();
    if (this.disposed) {
      if (result.ok) {
        result.value.device.destroy();
      }
      return;
    }
    if (!result.ok) {
      throw new SimControllerError(result.error.message, result.error);
    }

    const { device, adapter } = result.value;
    const context = canvas.getContext('webgpu');
    if (!context) {
      device.destroy();
      throw new SimControllerError('Failed to get a WebGPU canvas context');
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.format = format;
    this.seed = settings.seed;
    this.gridSize = settings.gridSize ?? 512;
    const info = 'info' in adapter ? adapter.info : undefined;
    this.gpuDeviceName =
      (info && (info.device || info.description || info.vendor)) || 'WebGPU adapter';
    createRng(this.seed);

    const dx = DEFAULT_CELL_SIZE_MM * (512 / this.gridSize);
    this.film = createThinFilmGpu(device, format, this.gridSize, this.gridSize, {
      ...DEFAULT_THIN_FILM_PARAMS,
      dx,
      gParallelX: 0,
      gParallelY: 0,
      gPerp: GRAVITY_MM_S2,
    });

    this.configureContext();
    this.attachResize();
    this.watchDeviceLoss(device);
  }

  start(): void {
    this.assertReady();
    if (this.deviceLost || this.running) {
      return;
    }
    this.running = true;
    this.fpsLastTs = performance.now();
    this.fpsFrames = 0;
    this.rafId = requestAnimationFrame((ts) => this.frame(ts));
  }

  pause(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  reset(seed: number): void {
    this.assertReady();
    if (!isValidSeed(seed)) {
      throw new SimControllerError('seed must be an integer in [0, 2^32)');
    }
    this.seed = seed;
    createRng(seed);
    this.stepCount = 0;
    this.frameCount = 0;
    this.tiltX = 0;
    this.tiltY = 0;
    this.lastPointer = null;
    this.lastTool = null;
    this.lastTexel = null;
    this.simSecondsPerWallSecond = 0;
    this.lastFrameTs = null;
    this.throughputSim = 0;
    this.throughputWallMs = 0;
    this.applyTiltToParams();
    this.film?.resetPuddle();
  }

  step(n: number): void {
    this.assertReady();
    if (!Number.isFinite(n) || n < 0) {
      throw new SimControllerError('step count must be a non-negative finite number');
    }
    const count = Math.floor(n);
    if (count === 0 || !this.device || !this.film || this.deviceLost) {
      return;
    }
    const encoder = this.device.createCommandEncoder({ label: 'manual-steps' });
    this.film.encodeFrame(encoder, count * FRAME_SIM_DT);
    this.device.queue.submit([encoder.finish()]);
    this.stepCount += this.film.lastSubsteps;
  }

  setTilt(x: number, y: number): void {
    this.assertReady();
    this.tiltX = x;
    this.tiltY = y;
    this.applyTiltToParams();
  }

  pointer(tool: SimTool, event: SimPointerEvent): void {
    this.assertReady();
    if (!this.canvas) {
      return;
    }
    const point = pointerToCanvas(event, this.canvas);
    this.lastPointer = point;
    this.lastTool = tool;
    this.lastTexel = canvasToTexel(point.x, point.y, this.gridSize);
  }

  getStats(): SimStats {
    return {
      running: this.running,
      fps: this.fps,
      frameCount: this.frameCount,
      stepCount: this.stepCount,
      seed: this.seed,
      gridSize: this.gridSize,
      tiltX: this.tiltX,
      tiltY: this.tiltY,
      lastPointer: this.lastPointer,
      lastTexel: this.lastTexel,
      lastTool: this.lastTool,
      deviceLost: this.deviceLost,
      deviceLostMessage: this.deviceLostMessage,
      substepsLastFrame: this.film?.lastSubsteps ?? 0,
      simSecondsPerWallSecond: this.simSecondsPerWallSecond,
      gpuDeviceName: this.gpuDeviceName,
      compareRelative: this.compareRelative,
      compareMaxAbs: this.compareMaxAbs,
      compareLevelRel: this.compareLevelRel,
      compareMixedRel: this.compareMixedRel,
      compareTiltRel: this.compareTiltRel,
      compareTiltDrainRel: this.compareTiltDrainRel,
      uniformRoundTripOk: this.uniformRoundTripOk,
    };
  }

  async compareToCpu(steps = 100): Promise<CompareToCpuResult> {
    this.assertReady();
    if (!this.film) {
      throw new SimControllerError('Controller is not initialized');
    }
    const result = await this.film.compareToCpu(steps);
    this.compareRelative = result.relative;
    this.compareMaxAbs = result.maxAbsDiff;
    this.compareLevelRel = result.level.relative;
    this.compareMixedRel = result.mixedDt.relative;
    this.compareTiltRel = result.tilted.relative;
    this.compareTiltDrainRel = result.tilted.drainRelative;
    return result;
  }

  async checkUniformRoundTrip(): Promise<UniformRoundTripResult> {
    this.assertReady();
    if (!this.film) {
      throw new SimControllerError('Controller is not initialized');
    }
    const result = await this.film.checkUniformRoundTrip();
    this.uniformRoundTripOk = result.ok;
    return result;
  }

  dispose(): void {
    this.pause();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.film?.destroy();
    this.film = null;
    this.device?.destroy();
    this.device = null;
    this.context = null;
    this.format = null;
    this.canvas = null;
    this.contextConfigured = false;
    this.disposed = true;
  }

  private applyTiltToParams(): void {
    if (!this.film) {
      return;
    }
    const g = gravityFromTilt(this.tiltX, this.tiltY);
    this.film.simParams.gParallelX = g.gParallelX;
    this.film.simParams.gParallelY = g.gParallelY;
    this.film.simParams.gPerp = g.gPerp;
  }

  private assertReady(): void {
    if (this.disposed) {
      throw new SimControllerError('Controller was disposed');
    }
    if (!this.canvas || !this.device || !this.context || !this.format || !this.film) {
      throw new SimControllerError('Controller is not initialized');
    }
  }

  private configureContext(): void {
    if (!this.canvas || !this.device || !this.context || !this.format) {
      return;
    }
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    const sizeChanged = this.canvas.width !== width || this.canvas.height !== height;
    if (!sizeChanged && this.contextConfigured) {
      return;
    }
    this.canvas.width = width;
    this.canvas.height = height;
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque',
    });
    this.contextConfigured = true;
  }

  private attachResize(): void {
    if (!this.canvas) {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.deviceLost) {
        this.configureContext();
      }
    });
    this.resizeObserver.observe(this.canvas);
  }

  private watchDeviceLoss(device: GPUDevice): void {
    void device.lost.then((info) => {
      if (this.disposed) {
        return;
      }
      this.deviceLost = true;
      this.deviceLostMessage = info.message || 'WebGPU device was lost';
      this.pause();
      console.error('[PourPainter] WebGPU device lost — reload the page to continue.', info);
    });
  }

  private frame(timestamp: number): void {
    this.rafId = null;
    if (!this.running || this.deviceLost || !this.device || !this.context || !this.film) {
      this.running = false;
      return;
    }

    const encoder = this.device.createCommandEncoder({ label: 'frame' });
    const { substeps, simDt } = this.film.encodeFrame(encoder, FRAME_SIM_DT);
    this.film.maybeScheduleHMaxReadback(encoder);
    this.stepCount += substeps;

    const swapView = this.context.getCurrentTexture().createView();
    this.film.encodeBlit(encoder, swapView, CANVAS_WHITE);
    this.device.queue.submit([encoder.finish()]);

    this.frameCount += 1;
    this.fpsFrames += 1;
    const elapsed = timestamp - this.fpsLastTs;
    if (elapsed >= 500) {
      this.fps = (this.fpsFrames * 1000) / elapsed;
      this.fpsFrames = 0;
      this.fpsLastTs = timestamp;
    }

    if (this.lastFrameTs !== null) {
      this.throughputSim += simDt;
      this.throughputWallMs += timestamp - this.lastFrameTs;
      if (this.throughputWallMs >= 500) {
        this.simSecondsPerWallSecond = this.throughputSim / (this.throughputWallMs / 1000);
        this.throughputSim = 0;
        this.throughputWallMs = 0;
      }
    }
    this.lastFrameTs = timestamp;

    this.rafId = requestAnimationFrame((ts) => this.frame(ts));
  }
}
