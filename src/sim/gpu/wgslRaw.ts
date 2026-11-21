import placeholderWgsl from '../shaders/placeholder.wgsl?raw';

/** Proves `*.wgsl?raw` resolves to a string at build time. */
export const PLACEHOLDER_WGSL: string = placeholderWgsl;
