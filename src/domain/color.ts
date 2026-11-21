import type { Rgb } from './paint';

/** Convert one sRGB channel in [0, 1] to linear light (IEC 61966-2-1). */
export function srgbChannelToLinear(channel: number): number {
  if (channel <= 0.04045) {
    return channel / 12.92;
  }
  return ((channel + 0.055) / 1.055) ** 2.4;
}

/** Convert an sRGB triple in [0, 1] to linear RGB. */
export function srgbToLinear(rgb: Rgb): Rgb {
  return [srgbChannelToLinear(rgb[0]), srgbChannelToLinear(rgb[1]), srgbChannelToLinear(rgb[2])];
}
