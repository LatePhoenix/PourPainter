import type { CanvasPoint } from './coords';

export type GridSize = 256 | 512 | 1024;

export type CompareCaseResult = {
  name: string;
  maxAbsDiff: number;
  relative: number;
  drainRelative: number | null;
  steps: number;
  gridSize: number;
  ok: boolean;
};

export type FlowMode = 'explicit' | 'semi';

export type CompareToCpuResult = {
  level: CompareCaseResult;
  mixedDt: CompareCaseResult;
  tilted: CompareCaseResult;
  semi: CompareCaseResult;
  /** Pour spike: GPU semi vs CPU semi. */
  spike: CompareCaseResult;
  /** Worst relative height error across explicit cases (overlay summary). */
  relative: number;
  maxAbsDiff: number;
  steps: number;
  gridSize: number;
};

export type UniformRoundTripResult = {
  ok: boolean;
  expected: Float32Array;
  actual: Float32Array;
};

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
  /** Explicit substeps executed in the last animation frame. */
  substepsLastFrame: number;
  /** Sim-seconds advanced per wall-second (throughput; ADR 0003). */
  simSecondsPerWallSecond: number;
  /** GPU adapter / device label when available. */
  gpuDeviceName: string | null;
  /** Last "Compare to CPU" summary (worst rel), if run. */
  compareRelative: number | null;
  compareMaxAbs: number | null;
  compareLevelRel: number | null;
  compareMixedRel: number | null;
  compareTiltRel: number | null;
  compareTiltDrainRel: number | null;
  compareSemiRel: number | null;
  compareSpikeRel: number | null;
  flowMode: FlowMode;
  /** Last uniform round-trip result, if run. */
  uniformRoundTripOk: boolean | null;
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
  /** Debug: 64² CPU↔GPU compare (explicit cases + semi-implicit). */
  compareToCpu(steps?: number): Promise<CompareToCpuResult>;
  setFlowMode(mode: FlowMode): void;
  /** Debug: packUniforms ↔ WGSL FlowParams round-trip. */
  checkUniformRoundTrip(): Promise<UniformRoundTripResult>;
};
