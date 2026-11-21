import placeholderWgsl from '../shaders/placeholder.wgsl?raw';
import blurWgsl from '../shaders/blur.wgsl?raw';
import blitGrayscaleWgsl from '../shaders/blit_grayscale.wgsl?raw';

/** Proves `*.wgsl?raw` resolves to a string at build time. */
export const PLACEHOLDER_WGSL: string = placeholderWgsl;
export const BLUR_WGSL: string = blurWgsl;
export const BLIT_GRAYSCALE_WGSL: string = blitGrayscaleWgsl;
