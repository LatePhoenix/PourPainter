import type { CanvasPoint } from './coords';

export type GridSize = 256 | 512 | 1024;

export type SimSettings = {
  /** Initial RNG seed (integer in [0, 2³²)). */
  seed: number;
  /** Simulation grid resolution. Default 512. */
  gridSize?: GridSize;
};

export type SimTool = 'pour' | 'torch' | 'air' | 'swipe' | 'string' | 'none';

/** Minimal pointer payload; full `PointerEvent` also satisfies this. */
export type SimPointerEvent = {
  clientX: number;
  clientY: number;
  buttons?: number;
  pointerType?: string;
};

export type SimStats = {
  running: boolean;
  fps: number;
  frameCount: number;
  stepCount: number;
  seed: number;
  gridSize: GridSize;
  tiltX: number;
  tiltY: number;
  lastPointer: CanvasPoint | null;
  lastTexel: { i: number; j: number } | null;
  lastTool: SimTool | null;
  deviceLost: boolean;
  deviceLostMessage: string | null;
};

/**
 * UI ↔ sim boundary. React never touches GPU objects; only this interface.
 * Stubs are fine for unused methods until later milestones fill them in.
 */
export type SimController = {
  init(canvas: HTMLCanvasElement, settings: SimSettings): Promise<void>;
  start(): void;
  pause(): void;
  reset(seed: number): void;
  step(n: number): void;
  setTilt(x: number, y: number): void;
  pointer(tool: SimTool, event: SimPointerEvent): void;
  getStats(): SimStats;
  dispose(): void;
};
