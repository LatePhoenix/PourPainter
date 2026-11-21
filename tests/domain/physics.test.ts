import { describe, expect, it } from 'vitest';
import {
  capillaryLengthMm,
  DEFAULT_PAINT_DENSITY_G_ML,
  DEFAULT_PAINT_DENSITY_G_MM3,
  densityToSim,
  GRAVITY_MM_S2,
  SURFACE_TENSION_MN_M,
} from '../../src/domain/physics';

describe('mm–g–s physics defaults', () => {
  it('converts g/ml density to g/mm³', () => {
    expect(densityToSim(1.2)).toBeCloseTo(0.0012, 12);
    expect(DEFAULT_PAINT_DENSITY_G_MM3).toBe(densityToSim(DEFAULT_PAINT_DENSITY_G_ML));
  });

  it('gives a capillary length of 1.5–2.0 mm for the defaults', () => {
    const length = capillaryLengthMm(
      SURFACE_TENSION_MN_M,
      DEFAULT_PAINT_DENSITY_G_MM3,
      GRAVITY_MM_S2,
    );
    expect(length).toBeGreaterThanOrEqual(1.5);
    expect(length).toBeLessThanOrEqual(2.0);
  });
});
