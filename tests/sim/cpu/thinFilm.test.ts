import { describe, expect, it } from 'vitest';
import { GRAVITY_MM_S2 } from '../../../src/domain/physics';
import {
  addBoxPuddle,
  addGaussianPuddle,
  createThinFilmState,
  DEFAULT_THIN_FILM_PARAMS,
  getCell,
  gravityFromTilt,
  hasNonFinite,
  heightCenterOfMass,
  isMirrorSymmetric,
  maxStableDt,
  setCell,
  thinFilmStep,
  thinFilmSubstep,
  totalFilmVolumeMm3,
  type ThinFilmParams,
} from '../../../src/sim/cpu';

function testParams(overrides: Partial<ThinFilmParams> = {}): ThinFilmParams {
  return {
    ...DEFAULT_THIN_FILM_PARAMS,
    dx: 1,
    dtSafety: 0.15,
    ...overrides,
  };
}

/** True if an interior sample is lower than both neighbors by more than `depth`. */
function hasInteriorLocalMin(row: readonly number[], depth: number): boolean {
  for (let i = 1; i < row.length - 1; i += 1) {
    const left = row[i - 1]!;
    const mid = row[i]!;
    const right = row[i + 1]!;
    if (Math.min(left, right) - mid > depth) {
      return true;
    }
  }
  return false;
}

describe('thinFilmStep', () => {
  it('conserves volume (on canvas + drained) over 500 steps and stays finite', () => {
    const n = 32;
    const params = testParams({
      gParallelX: 0,
      gParallelY: 0,
      // Milder capillary for a larger stable dt on this coarse grid.
      sigma: 5,
    });
    const state = createThinFilmState(n, n);
    addGaussianPuddle(state.height, (n - 1) / 2, (n - 1) / 2, 1.2, 4);

    const v0 = totalFilmVolumeMm3(state, params.dx);
    expect(v0).toBeGreaterThan(0);

    const frameDt = 2e-4;
    for (let i = 0; i < 500; i += 1) {
      thinFilmStep(state, frameDt, params);
    }

    expect(hasNonFinite(state.height)).toBe(false);
    const v1 = totalFilmVolumeMm3(state, params.dx) + state.drainedVolume;
    const rel = Math.abs(v1 - v0) / v0;
    expect(rel).toBeLessThan(1e-4);
  });

  it('keeps a centered puddle mirror-symmetric on a flat canvas', () => {
    const n = 33; // odd → geometric center on a cell center at n/2
    const params = testParams({
      gParallelX: 0,
      gParallelY: 0,
      sigma: 5,
      gPerp: DEFAULT_THIN_FILM_PARAMS.gPerp,
    });
    const state = createThinFilmState(n, n);
    const c = n / 2;
    addGaussianPuddle(state.height, c, c, 1.0, 3.5);
    expect(isMirrorSymmetric(state.height, 'x', 1e-5)).toBe(true);
    expect(isMirrorSymmetric(state.height, 'y', 1e-5)).toBe(true);

    for (let i = 0; i < 80; i += 1) {
      thinFilmStep(state, 1e-4, params);
    }

    expect(hasNonFinite(state.height)).toBe(false);
    expect(isMirrorSymmetric(state.height, 'x', 1e-4)).toBe(true);
    expect(isMirrorSymmetric(state.height, 'y', 1e-4)).toBe(true);
  });

  it('moves the center of mass downhill under tilt', () => {
    const n = 64;
    // Pure in-plane drive (no capillary / hydrostatic) so CoM motion is unambiguous.
    const params = testParams({
      gParallelX: 500,
      gParallelY: 0,
      gPerp: 0,
      sigma: 0,
      mu: 0.05,
    });
    const state = createThinFilmState(n, n);
    addGaussianPuddle(state.height, n / 2, n / 2, 2.0, 5);

    const before = heightCenterOfMass(state.height, params.dx);
    for (let i = 0; i < 200; i += 1) {
      thinFilmStep(state, 1e-3, params);
    }
    const after = heightCenterOfMass(state.height, params.dx);

    expect(hasNonFinite(state.height)).toBe(false);
    // Downhill is +g∥; remaining-film CoM must shift that way before edge drain dominates.
    expect(after.x - before.x).toBeGreaterThan(0.5);
  });

  it('conserves volume for a sharp box without mass-creating clamps', () => {
    const n = 32;
    const params = testParams({
      // Default-like physics; positivity limiter must hold mass to 1e-6 relative.
      // dtSafety 1.0 (max allowed) keeps the substep count CI-friendly.
      dtSafety: 1.0,
    });
    const state = createThinFilmState(n, n);
    addBoxPuddle(state.height, 12, 12, 8, 8, 1.5);

    const v0 = totalFilmVolumeMm3(state, params.dx) + state.drainedVolume;
    thinFilmStep(state, 1.0, params);

    expect(hasNonFinite(state.height)).toBe(false);
    const v1 = totalFilmVolumeMm3(state, params.dx) + state.drainedVolume;
    expect(Math.abs(v1 - v0) / v0).toBeLessThan(1e-6);
  }, 30_000);

  it('avoids sawtooth local minima under tilted advection', () => {
    const n = 48;
    const params = testParams({
      gParallelX: 500,
      gParallelY: 0,
      gPerp: 0,
      sigma: 0,
      mu: 0.05,
      dtSafety: 0.2,
    });
    const state = createThinFilmState(n, n);
    addGaussianPuddle(state.height, n / 2, n / 2, 2.0, 5);

    thinFilmStep(state, 0.2, params);

    const midY = Math.floor(n / 2);
    const row: number[] = [];
    for (let x = 0; x < n; x += 1) {
      row.push(getCell(state.height, x, midY));
    }
    expect(hasInteriorLocalMin(row, 1e-3)).toBe(false);
  });

  it('decays a capillary checkerboard at dtSafety 0.9', () => {
    const n = 32;
    const params = testParams({
      gParallelX: 0,
      gParallelY: 0,
      gPerp: 0,
      sigma: DEFAULT_THIN_FILM_PARAMS.sigma,
      dtSafety: 0.9,
    });
    const state = createThinFilmState(n, n, 1);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const sign = (x + y) % 2 === 0 ? 1 : -1;
        setCell(state.height, x, y, 1 + 0.01 * sign);
      }
    }

    const amp = (): number => {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < state.height.data.length; i += 1) {
        const h = state.height.data[i]!;
        if (h < min) min = h;
        if (h > max) max = h;
      }
      return max - min;
    };

    // Freeze Δt from the initial field so the bound under test is exactly the FE one.
    const dt = maxStableDt(state.height, params);
    let prev = amp();
    expect(prev).toBeGreaterThan(0);
    for (let i = 0; i < 200; i += 1) {
      thinFilmSubstep(state, dt, params);
      const next = amp();
      expect(next).toBeLessThanOrEqual(prev * (1 + 1e-9));
      prev = next;
    }
    expect(prev).toBeLessThan(0.01);
  });
});

describe('gravityFromTilt', () => {
  it('pins g∥ signs for ±tiltX and ±tiltY', () => {
    const g = GRAVITY_MM_S2;

    const posX = gravityFromTilt(0.2, 0, g);
    expect(posX.gParallelY).toBeLessThan(0); // canvas top tips down → grid −y
    expect(posX.gParallelX).toBeCloseTo(0, 12);

    const negX = gravityFromTilt(-0.2, 0, g);
    expect(negX.gParallelY).toBeGreaterThan(0);

    const posY = gravityFromTilt(0, 0.2, g);
    expect(posY.gParallelX).toBeGreaterThan(0); // +X tips down → grid +x
    expect(posY.gParallelY).toBeCloseTo(0, 12);

    const negY = gravityFromTilt(0, -0.2, g);
    expect(negY.gParallelX).toBeLessThan(0);
  });
});
