import { describe, expect, it } from 'vitest';
import { createBlurTestPattern } from '../../src/sim/gpu/demoBlur';

describe('createBlurTestPattern', () => {
  it('writes a finite pattern with a bright center and darker field', () => {
    const size = 64;
    const data = createBlurTestPattern(size);
    expect(data).toHaveLength(size * size);
    expect(data.every((v) => Number.isFinite(v))).toBe(true);
    const mid = data[((size / 2) | 0) * size + ((size / 2) | 0)];
    const corner = data[0];
    expect(mid).toBe(1);
    expect(corner).toBeLessThan(mid!);
  });
});
