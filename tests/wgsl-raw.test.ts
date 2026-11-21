import { describe, expect, it } from 'vitest';
import { FLOW_FLUX_WGSL, FLOW_UPDATE_WGSL, PLACEHOLDER_WGSL } from '../src/sim/gpu';

describe('wgsl ?raw import', () => {
  it('loads shader source as a string', () => {
    expect(typeof PLACEHOLDER_WGSL).toBe('string');
    expect(PLACEHOLDER_WGSL).toContain('@compute');
  });

  it('loads thin-film flow shaders', () => {
    expect(FLOW_FLUX_WGSL).toContain('fn fluxQxInterior');
    expect(FLOW_UPDATE_WGSL).toContain('fn cellAlpha');
  });
});
