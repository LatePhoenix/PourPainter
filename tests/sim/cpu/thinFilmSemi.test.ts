import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setImmediate } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CELL_SIZE_MM } from '../../../src/domain/physics';
import {
  addGaussianPuddle,
  capillaryDiagonal,
  capillaryDivergence,
  cloneThinFilmState,
  createGrid2D,
  createThinFilmState,
  DEFAULT_THIN_FILM_PARAMS,
  explicitCapillaryDt,
  hasNonFinite,
  maxAbsDiff,
  maxStableDt,
  maxStableDtSemiImplicit,
  SEMI_IMPLICIT_ACCURACY_FACTOR,
  SEMI_IMPLICIT_DT_TOLERANCE,
  SEMI_IMPLICIT_JACOBI_OMEGA,
  setCell,
  thinFilmStep,
  thinFilmStepSemiImplicit,
  thinFilmSubstepSemiImplicit,
  totalFilmVolumeMm3,
  type ThinFilmParams,
} from '../../../src/sim/cpu';
import { commitSemiImplicitSubstep } from '../../../src/sim/cpu/thinFilmSemi';
import { createRng } from '../../../src/sim/rng';

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
  }, 60_000);

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

  it('uses a Jacobi weight inside the constant-M convergence bound', () => {
    expect(SEMI_IMPLICIT_JACOBI_OMEGA).toBeGreaterThan(0);
    expect(SEMI_IMPLICIT_JACOBI_OMEGA).toBeLessThan(2 / 3.2);
  });

  it('damps 20% seeded noise at 128× the capillary limit', () => {
    const n = 32;
    const p = params({
      dx: DEFAULT_CELL_SIZE_MM,
      gPerp: 0,
      gParallelX: 0,
      gParallelY: 0,
      sigma: DEFAULT_THIN_FILM_PARAMS.sigma,
      mu: DEFAULT_THIN_FILM_PARAMS.mu,
      dtSafety: 1,
    });
    const state = createThinFilmState(n, n, 1);
    const rng = createRng(20261121);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        setCell(state.height, x, y, 1 + 0.2 * (2 * rng.next() - 1));
      }
    }
    const std0 = stddev(state.height.data);
    const peak0 = peakOf(state.height.data);
    const v0 = totalFilmVolumeMm3(state, p.dx) + state.drainedVolume;
    // 128× is past the accuracy cap on purpose (2× the scheduler cap).
    const dt = 128 * explicitCapillaryDt(state.height, p);
    for (let step = 0; step < 60; step += 1) {
      commitSemiImplicitSubstep(state, dt, p);
    }
    expect(hasNonFinite(state.height)).toBe(false);
    expect(stddev(state.height.data)).toBeLessThan(std0);
    expect(peakOf(state.height.data)).toBeLessThanOrEqual(peak0);
    const v1 = totalFilmVolumeMm3(state, p.dx) + state.drainedVolume;
    expect(Math.abs(v1 - v0) / v0).toBeLessThan(1e-6);
  }, 60_000);

  it('rejects a dt above the accuracy cap and accepts the 10% tolerance', () => {
    const p = params({ gPerp: 0, gParallelX: 0, gParallelY: 0 });
    const state = createThinFilmState(8, 8, 1);
    const cap = explicitCapillaryDt(state.height, p);
    const limit = SEMI_IMPLICIT_ACCURACY_FACTOR * SEMI_IMPLICIT_DT_TOLERANCE * cap;
    expect(() => thinFilmSubstepSemiImplicit(state, limit, p)).not.toThrow();
    expect(() =>
      thinFilmSubstepSemiImplicit(createThinFilmState(8, 8, 1), limit * 1.001, p),
    ).toThrow(/capillary/);
  });

  it('has no odd/even ripple against the explicit solver at dtSafety 1', () => {
    const n = 64;
    const p = { ...DEFAULT_THIN_FILM_PARAMS, dtSafety: 1 };
    const explicitState = createThinFilmState(n, n);
    addGaussianPuddle(explicitState.height, n / 2 + 0.5, n / 2 + 0.5, 1.2, 5);
    const semiState = cloneThinFilmState(explicitState);
    thinFilmStep(explicitState, 0.5, p);
    thinFilmStepSemiImplicit(semiState, 0.5, p);
    expect(hasNonFinite(semiState.height)).toBe(false);
    const roughExplicit = roughness(explicitState.height.data, n, n);
    const roughSemi = roughness(semiState.height.data, n, n);
    expect(Math.abs(roughSemi - roughExplicit) / roughExplicit).toBeLessThan(0.1);
    expect(interiorRowMaxima(semiState.height.data, n, n / 2)).toBe(1);
  }, 60_000);

  it('stays within 1% of explicit at 64× with default physics', async () => {
    const fixture = loadExplicitFixture('semi-explicit-64x.json');
    const n = 64;
    const p = { ...DEFAULT_THIN_FILM_PARAMS, dx: DEFAULT_CELL_SIZE_MM };
    expect(fixture.n).toBe(n);
    expect(fixture.dx).toBe(p.dx);
    const explicitState = createThinFilmState(n, n);
    addGaussianPuddle(explicitState.height, n / 2 + 0.5, n / 2 + 0.5, 1.2, 5);
    const semiState = cloneThinFilmState(explicitState);
    const dtSemi = 64 * explicitCapillaryDt(explicitState.height, p);
    const steps = Math.max(1, Math.round(0.25 / dtSemi));
    const simTime = steps * dtSemi;
    expect(steps).toBe(fixture.steps);
    expect(simTime).toBe(fixture.simTime);
    for (let i = 0; i < steps; i += 1) {
      thinFilmSubstepSemiImplicit(semiState, dtSemi, p);
      await yieldEvery(i + 1);
    }
    expect(hasNonFinite(semiState.height)).toBe(false);
    const reference = explicitGrid(fixture);
    const diff = maxAbsDiff(reference, semiState.height);
    let peak = 0;
    for (let i = 0; i < reference.data.length; i += 1) {
      peak = Math.max(peak, reference.data[i]!);
    }
    expect(diff / peak).toBeLessThan(0.01);
  }, 120_000);

  it('matches explicit on a pour spike, including a dry corner', async () => {
    const fixture = loadExplicitFixture('semi-explicit-pour-spike.json');
    const n = 64;
    const p = { ...DEFAULT_THIN_FILM_PARAMS, dx: DEFAULT_CELL_SIZE_MM };
    expect(fixture.n).toBe(n);
    expect(fixture.dx).toBe(p.dx);
    const semiState = createThinFilmState(n, n);
    addGaussianPuddle(semiState.height, n / 2, n / 2, 1, 8);
    addGaussianPuddle(semiState.height, n / 2 + 6, n / 2, 3, 1.5);

    let simTime = 0;
    let steps = 0;
    while (simTime < 0.25) {
      const dt = Math.min(64 * explicitCapillaryDt(semiState.height, p), 0.25 - simTime);
      thinFilmSubstepSemiImplicit(semiState, dt, p);
      simTime += dt;
      steps += 1;
      await yieldEvery(steps);
    }
    expect(steps).toBe(fixture.steps);
    expect(simTime).toBe(fixture.simTime);

    expect(hasNonFinite(semiState.height)).toBe(false);
    const reference = explicitGrid(fixture);
    const diff = maxAbsDiff(reference, semiState.height);
    let peak = 0;
    for (let i = 0; i < reference.data.length; i += 1) {
      peak = Math.max(peak, reference.data[i]!);
    }
    expect(diff / peak).toBeLessThan(0.01);
    expect(Math.abs(semiState.height.data[0]! - reference.data[0]!)).toBeLessThan(1e-6);
  }, 180_000);
});

/** Let the Vitest worker answer onTaskUpdate during a long synchronous solve. */
const YIELD_EVERY_STEPS = 8;

async function yieldEvery(step: number): Promise<void> {
  if (step % YIELD_EVERY_STEPS === 0) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

type ExplicitFixture = {
  sourceCommit: string;
  n: number;
  dx: number;
  steps: number;
  simTime: number;
  height: number[];
};

function loadExplicitFixture(name: string): ExplicitFixture {
  const path = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures', name);
  return JSON.parse(readFileSync(path, 'utf8')) as ExplicitFixture;
}

function explicitGrid(fixture: ExplicitFixture) {
  const grid = createGrid2D(fixture.n, fixture.n);
  grid.data.set(fixture.height);
  return grid;
}

function stddev(data: ArrayLike<number>): number {
  let mean = 0;
  for (let i = 0; i < data.length; i += 1) mean += data[i]!;
  mean /= data.length;
  let v = 0;
  for (let i = 0; i < data.length; i += 1) {
    const d = data[i]! - mean;
    v += d * d;
  }
  return Math.sqrt(v / data.length);
}

function peakOf(data: ArrayLike<number>): number {
  let peak = -Infinity;
  for (let i = 0; i < data.length; i += 1) {
    if (data[i]! > peak) peak = data[i]!;
  }
  return peak;
}

function roughness(data: ArrayLike<number>, w: number, h: number): number {
  let sum = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const c = data[y * w + x]!;
      const avg =
        (data[y * w + x - 1]! +
          data[y * w + x + 1]! +
          data[(y - 1) * w + x]! +
          data[(y + 1) * w + x]!) /
        4;
      sum += Math.abs(c - avg);
      count += 1;
    }
  }
  return sum / count;
}

function interiorRowMaxima(data: ArrayLike<number>, w: number, y: number): number {
  let count = 0;
  for (let x = 1; x < w - 1; x += 1) {
    const c = data[y * w + x]!;
    if (c > data[y * w + x - 1]! && c > data[y * w + x + 1]!) count += 1;
  }
  return count;
}
