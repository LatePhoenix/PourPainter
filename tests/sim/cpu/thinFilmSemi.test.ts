import { describe, expect, it } from 'vitest';
import {
  addGaussianPuddle,
  capillaryDiagonal,
  capillaryDivergence,
  cloneThinFilmState,
  createThinFilmState,
  DEFAULT_THIN_FILM_PARAMS,
  explicitCapillaryDt,
  hasNonFinite,
  maxAbsDiff,
  maxStableDt,
  maxStableDtSemiImplicit,
  setCell,
  thinFilmStep,
  thinFilmStepSemiImplicit,
  thinFilmSubstepSemiImplicit,
  totalFilmVolumeMm3,
  type ThinFilmParams,
} from '../../../src/sim/cpu';

function params(overrides: Partial<ThinFilmParams> = {}): ThinFilmParams {
  return { ...DEFAULT_THIN_FILM_PARAMS, dx: 1, dtSafety: 1, ...overrides };
}

function amp(data: ArrayLike<number>): number {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i += 1) {
    const h = data[i]!;
    if (h < min) min = h;
    if (h > max) max = h;
  }
  return max - min;
}

describe('thinFilmStepSemiImplicit', () => {
  it('matches a finite-difference diagonal on an interior cell', () => {
    const n = 12;
    const p = params({ gPerp: 0, gParallelX: 0, gParallelY: 0 });
    const state = createThinFilmState(n, n, 1);
    addGaussianPuddle(state.height, n / 2, n / 2, 0.4, 3);
    const h0 = Float64Array.from(state.height.data);
    const x = 4;
    const y = 5;
    const eps = 1e-6;
    const base = capillaryDivergence(h0, h0, n, n, x, y, p);
    const bumped = Float64Array.from(h0);
    bumped[y * n + x]! += eps;
    const plus = capillaryDivergence(bumped, h0, n, n, x, y, p);
    const fd = (plus - base) / eps;
    const analytic = capillaryDiagonal(h0, n, n, x, y, p);
    expect(Math.abs(fd - analytic) / Math.max(1, Math.abs(fd))).toBeLessThan(1e-4);
  });

  it('does not use the explicit capillary Δ⁴ bound', () => {
    const n = 16;
    const p = params({ gParallelX: 0, gParallelY: 0 });
    const state = createThinFilmState(n, n, 1.2);
    const explicit = maxStableDt(state.height, p);
    const semi = maxStableDtSemiImplicit(state.height, p);
    const cap = explicitCapillaryDt(state.height, p);
    expect(semi).toBeGreaterThan(cap * 10);
    expect(semi).toBeGreaterThan(explicit * 10);
  });

  it('stays within 2% of the explicit solver at 20× the capillary limit', () => {
    const n = 64;
    const p = params({
      gParallelX: 0,
      gParallelY: 0,
      gPerp: DEFAULT_THIN_FILM_PARAMS.gPerp,
      sigma: 8,
      mu: 0.4,
      dtSafety: 0.5,
    });
    const explicitState = createThinFilmState(n, n);
    addGaussianPuddle(explicitState.height, n / 2, n / 2, 1.2, 5);
    const semiState = cloneThinFilmState(explicitState);

    const capDt = explicitCapillaryDt(explicitState.height, { ...p, dtSafety: 1 });
    const dtSemi = 20 * capDt;
    const steps = 4;
    const simTime = steps * dtSemi;

    thinFilmStep(explicitState, simTime, { ...p, dtSafety: 1 });
    for (let i = 0; i < steps; i += 1) {
      thinFilmSubstepSemiImplicit(semiState, dtSemi, p);
    }

    expect(hasNonFinite(semiState.height)).toBe(false);
    const diff = maxAbsDiff(explicitState.height, semiState.height);
    let peak = 0;
    for (let i = 0; i < explicitState.height.data.length; i += 1) {
      peak = Math.max(peak, explicitState.height.data[i]!);
    }
    expect(diff / peak).toBeLessThan(0.02);
  });

  it('conserves volume over 1 s to 1e-6 relative', () => {
    const n = 32;
    const p = params({ sigma: 8, dtSafety: 0.5 });
    const state = createThinFilmState(n, n);
    addGaussianPuddle(state.height, n / 2, n / 2, 1.2, 4);
    const v0 = totalFilmVolumeMm3(state, p.dx) + state.drainedVolume;
    thinFilmStepSemiImplicit(state, 1, p);
    expect(hasNonFinite(state.height)).toBe(false);
    const v1 = totalFilmVolumeMm3(state, p.dx) + state.drainedVolume;
    expect(Math.abs(v1 - v0) / v0).toBeLessThan(1e-6);
  }, 30_000);

  it('decays a checkerboard at 50× the explicit capillary limit without growing', () => {
    const n = 24;
    const p = params({
      gParallelX: 0,
      gParallelY: 0,
      gPerp: 0,
      sigma: DEFAULT_THIN_FILM_PARAMS.sigma,
      dtSafety: 1,
    });
    const state = createThinFilmState(n, n, 1);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const sign = (x + y) % 2 === 0 ? 1 : -1;
        setCell(state.height, x, y, 1 + 0.01 * sign);
      }
    }
    const dt = 50 * explicitCapillaryDt(state.height, p);
    let prev = amp(state.height.data);
    for (let i = 0; i < 8; i += 1) {
      thinFilmSubstepSemiImplicit(state, dt, p);
      const next = amp(state.height.data);
      expect(next).toBeLessThanOrEqual(prev * (1 + 1e-6));
      prev = next;
    }
    expect(prev).toBeLessThan(0.02);
    expect(hasNonFinite(state.height)).toBe(false);
  });
});
