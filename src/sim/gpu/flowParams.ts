import type { ThinFilmParams } from '../cpu/thinFilm';
import type { UniformField, UniformValue } from './uniforms';

/**
 * Host-shareable layout for WGSL `FlowParams` (see flow_flux.wgsl).
 * Offsets: mu..hMin @ 0..28, dt @ 32, pad0 @ 36, width @ 40, height @ 44; size 48.
 */
export const FLOW_PARAMS_FIELDS: readonly UniformField[] = [
  { name: 'mu', type: 'f32' },
  { name: 'sigma', type: 'f32' },
  { name: 'rho', type: 'f32' },
  { name: 'dx', type: 'f32' },
  { name: 'gParallelX', type: 'f32' },
  { name: 'gParallelY', type: 'f32' },
  { name: 'gPerp', type: 'f32' },
  { name: 'hMin', type: 'f32' },
  { name: 'dt', type: 'f32' },
  { name: 'pad0', type: 'f32' },
  { name: 'width', type: 'u32' },
  { name: 'height', type: 'u32' },
] as const;

export type FlowParamsValues = {
  mu: number;
  sigma: number;
  rho: number;
  dx: number;
  gParallelX: number;
  gParallelY: number;
  gPerp: number;
  hMin: number;
  dt: number;
  pad0: number;
  width: number;
  height: number;
};

export function flowParamsFromThinFilm(
  params: ThinFilmParams,
  dt: number,
  width: number,
  height: number,
): FlowParamsValues {
  return {
    mu: params.mu,
    sigma: params.sigma,
    rho: params.rho,
    dx: params.dx,
    gParallelX: params.gParallelX,
    gParallelY: params.gParallelY,
    gPerp: params.gPerp,
    hMin: params.hMin,
    dt,
    pad0: 0,
    width,
    height,
  };
}

export function flowParamsUniformRecord(values: FlowParamsValues): Record<string, UniformValue> {
  return {
    mu: values.mu,
    sigma: values.sigma,
    rho: values.rho,
    dx: values.dx,
    gParallelX: values.gParallelX,
    gParallelY: values.gParallelY,
    gPerp: values.gPerp,
    hMin: values.hMin,
    dt: values.dt,
    pad0: values.pad0,
    width: values.width,
    height: values.height,
  };
}

/** Same capillary / hydrostatic / advective bounds as CPU `maxStableDt`, given hMax. */
export function maxStableDtFromHMax(hMax: number, params: ThinFilmParams): number {
  const { mu, sigma, rho, dx, gParallelX, gParallelY, gPerp, hMin, dtSafety } = params;
  if (!(dx > 0) || !(mu > 0)) {
    throw new RangeError('dx and mu must be positive');
  }
  if (!(dtSafety > 0) || dtSafety > 1) {
    throw new RangeError('dtSafety must be in (0, 1]');
  }
  const h = Math.max(hMax, hMin);
  const M = (h * h * h) / (3 * mu);
  const dtCap = sigma > 0 ? (dx * dx * dx * dx) / (32 * M * sigma) : Number.POSITIVE_INFINITY;
  const dtGrav =
    rho > 0 && gPerp !== 0 ? (dx * dx) / (4 * M * rho * Math.abs(gPerp)) : Number.POSITIVE_INFINITY;
  const gPar = Math.hypot(gParallelX, gParallelY);
  const waveSpeed = (h * h * rho * gPar) / mu;
  const dtAdv = waveSpeed > 0 ? dx / waveSpeed : Number.POSITIVE_INFINITY;
  const dt = dtSafety * Math.min(dtCap, dtGrav, dtAdv);
  if (!Number.isFinite(dt) || dt <= 0) {
    return dtSafety * 1e-3;
  }
  return dt;
}

/** Cap explicit substeps per animation frame so the UI stays responsive (ADR 0003). */
export const MAX_SUBSTEPS_PER_FRAME = 64;

/**
 * Uniform ring capacity (256-byte slots). Must be ≥ MAX_SUBSTEPS_PER_FRAME.
 * Larger than the frame cap so compare harnesses can pack >64 mixed-dt steps
 * into one encoder without a mid-encoder writeBuffer race.
 */
export const UNIFORM_RING_SLOTS = 128;

/** WebGPU min dynamic uniform offset alignment. */
export const UNIFORM_RING_STRIDE = 256;

/** Async hMax reduction cadence (frames between readbacks). */
export const HMAX_READBACK_INTERVAL_FRAMES = 10;

/** Safety margin applied to GPU-measured hMax before using it for Δt. */
export const HMAX_SAFETY_MARGIN = 1.1;
