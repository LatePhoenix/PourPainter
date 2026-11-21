import { describe, expect, it } from 'vitest';
import { alignedBytesPerRow } from '../../src/sim/gpu/readback';

describe('alignedBytesPerRow', () => {
  it('rounds up to multiples of 256', () => {
    expect(alignedBytesPerRow(4)).toBe(256);
    expect(alignedBytesPerRow(256)).toBe(256);
    expect(alignedBytesPerRow(257)).toBe(512);
    expect(alignedBytesPerRow(512 * 4)).toBe(2048);
  });
});
