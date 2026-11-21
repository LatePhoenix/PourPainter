import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_WGSL } from '../src/sim/gpu';

describe('wgsl ?raw import', () => {
  it('loads shader source as a string', () => {
    expect(typeof PLACEHOLDER_WGSL).toBe('string');
    expect(PLACEHOLDER_WGSL).toContain('@compute');
  });
});
