import { describe, expect, it } from 'vitest';
import { srgbChannelToLinear, srgbToLinear } from '../../src/domain/color';

describe('srgbToLinear', () => {
  it('matches known sRGB → linear points', () => {
    expect(srgbChannelToLinear(0)).toBe(0);
    expect(srgbChannelToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 12);
    expect(srgbChannelToLinear(0.5)).toBeCloseTo(((0.5 + 0.055) / 1.055) ** 2.4, 12);
    expect(srgbChannelToLinear(1)).toBe(1);

    expect(srgbToLinear([0, 0.04045, 0.5])).toEqual([
      srgbChannelToLinear(0),
      srgbChannelToLinear(0.04045),
      srgbChannelToLinear(0.5),
    ]);
    expect(srgbToLinear([1, 1, 1])).toEqual([1, 1, 1]);
  });
});
