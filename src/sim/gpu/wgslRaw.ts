import placeholderWgsl from '../shaders/placeholder.wgsl?raw';
import blurWgsl from '../shaders/blur.wgsl?raw';
import blitGrayscaleWgsl from '../shaders/blit_grayscale.wgsl?raw';
import blitHeightWgsl from '../shaders/blit_height.wgsl?raw';
import flowFluxWgsl from '../shaders/flow_flux.wgsl?raw';
import flowUpdateWgsl from '../shaders/flow_update.wgsl?raw';
import flowUniformsRoundtripWgsl from '../shaders/flow_uniforms_roundtrip.wgsl?raw';

/** Proves `*.wgsl?raw` resolves to a string at build time. */
export const PLACEHOLDER_WGSL: string = placeholderWgsl;
export const BLUR_WGSL: string = blurWgsl;
export const BLIT_GRAYSCALE_WGSL: string = blitGrayscaleWgsl;
export const BLIT_HEIGHT_WGSL: string = blitHeightWgsl;
export const FLOW_FLUX_WGSL: string = flowFluxWgsl;
export const FLOW_UPDATE_WGSL: string = flowUpdateWgsl;
export const FLOW_UNIFORMS_ROUNDTRIP_WGSL: string = flowUniformsRoundtripWgsl;
