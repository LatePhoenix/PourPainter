import { isValidSeed } from '../domain/seed';
import { canvasToTexel, pointerToCanvas, type CanvasPoint } from './coords';
import { requestGpuDevice, type GpuInitError } from './gpu/device';
import { createRng } from './rng';
import type {
  GridSize,
  SimController,
  SimPointerEvent,
  SimSettings,
  SimStats,
  SimTool,
} from './types';

/** Acrylic canvas white in linear-ish sRGB for the clear color. */
const CANVAS_WHITE = { r: 0.96, g: 0.94, b: 0.9, a: 1 };

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
    if (!result.ok) {
      throw new SimControllerError(result.error.message, result.error);
    }

    const { device } = result.value;
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
    createRng(this.seed);

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
  }

  step(n: number): void {
    this.assertReady();
    if (!Number.isFinite(n) || n < 0) {
      throw new SimControllerError('step count must be a non-negative finite number');
    }
    // Physics arrives in M1; count steps so UI/stats stay meaningful.
    this.stepCount += Math.floor(n);
  }

  setTilt(x: number, y: number): void {
    this.assertReady();
    this.tiltX = x;
    this.tiltY = y;
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
    };
  }

  dispose(): void {
    this.pause();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.device?.destroy();
    this.device = null;
    this.context = null;
    this.format = null;
    this.canvas = null;
    this.disposed = true;
  }

  private assertReady(): void {
    if (this.disposed) {
      throw new SimControllerError('Controller was disposed');
    }
    if (!this.canvas || !this.device || !this.context || !this.format) {
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
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque',
    });
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
    if (!this.running || this.deviceLost || !this.device || !this.context) {
      this.running = false;
      return;
    }

    this.configureContext();
    const texture = this.context.getCurrentTexture();
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          clearValue: CANVAS_WHITE,
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    this.frameCount += 1;
    this.fpsFrames += 1;
    const elapsed = timestamp - this.fpsLastTs;
    if (elapsed >= 500) {
      this.fps = (this.fpsFrames * 1000) / elapsed;
      this.fpsFrames = 0;
      this.fpsLastTs = timestamp;
    }

    this.rafId = requestAnimationFrame((ts) => this.frame(ts));
  }
}
