import { describe, expect, it } from 'vitest';
import {
  addGaussianPuddle,
  createThinFilmState,
  DEFAULT_THIN_FILM_PARAMS,
  hasNonFinite,
  heightCenterOfMass,
  isMirrorSymmetric,
  thinFilmStep,
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
});
