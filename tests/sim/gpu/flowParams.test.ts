import { describe, expect, it } from 'vitest';
import { DEFAULT_THIN_FILM_PARAMS, maxStableDt } from '../../../src/sim/cpu/thinFilm';
import {
  SEMI_IMPLICIT_ACCURACY_FACTOR,
  maxStableDtSemiImplicit,
} from '../../../src/sim/cpu/thinFilmSemi';
import { createGrid2D } from '../../../src/sim/cpu/grid';
import {
  FLOW_PARAMS_FIELDS,
  MAX_SUBSTEPS_PER_FRAME,
  UNIFORM_RING_SLOTS,
  UNIFORM_RING_STRIDE,
  flowParamsFromThinFilm,
  flowParamsUniformRecord,
  maxStableDtFromHMax,
  maxStableDtSemiImplicitFromHMax,
} from '../../../src/sim/gpu/flowParams';
import { packUniforms, uniformStructSize } from '../../../src/sim/gpu/uniforms';

describe('flowParams', () => {
  it('packs FlowParams to a 48-byte host-shareable struct', () => {
    expect(uniformStructSize(FLOW_PARAMS_FIELDS)).toBe(48);
    const values = flowParamsFromThinFilm(DEFAULT_THIN_FILM_PARAMS, 1e-4, 512, 512);
    const buf = packUniforms(FLOW_PARAMS_FIELDS, flowParamsUniformRecord(values));
    const view = new DataView(buf);
    expect(view.getFloat32(0, true)).toBeCloseTo(values.mu, 6);
    expect(view.getFloat32(32, true)).toBeCloseTo(values.dt, 6);
    expect(view.getUint32(40, true)).toBe(512);
    expect(view.getUint32(44, true)).toBe(512);
  });

  it('matches CPU maxStableDt for a uniform film', () => {
    const params = { ...DEFAULT_THIN_FILM_PARAMS, dx: 1, dtSafety: 0.5 };
    const grid = createGrid2D(8, 8, 1.25);
    expect(maxStableDtFromHMax(1.25, params)).toBeCloseTo(maxStableDt(grid, params), 12);
  });

  it('matches the CPU semi-implicit timestep (no bare capillary bound)', () => {
    const p = { ...DEFAULT_THIN_FILM_PARAMS, dx: 1, dtSafety: 0.5 };
    const grid = createGrid2D(8, 8, 1.25);
    expect(maxStableDtSemiImplicitFromHMax(1.25, p, SEMI_IMPLICIT_ACCURACY_FACTOR)).toBeCloseTo(
      maxStableDtSemiImplicit(grid, p),
      12,
    );
    expect(maxStableDtSemiImplicit(grid, p)).toBeGreaterThan(maxStableDt(grid, p) * 10);
  });

  it('sizes the uniform ring for dynamic offsets and mixed-dt compares', () => {
    expect(UNIFORM_RING_STRIDE).toBe(256);
    expect(UNIFORM_RING_SLOTS).toBeGreaterThanOrEqual(MAX_SUBSTEPS_PER_FRAME);
    expect(UNIFORM_RING_SLOTS).toBeGreaterThanOrEqual(100);
  });
});
