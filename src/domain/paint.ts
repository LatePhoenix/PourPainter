/**
 * Color channels in **sRGB 0–1** (matches pickers / CSS).
 * Convert with `srgbToLinear` before lighting math in the render pass.
 */
export type Rgb = readonly [number, number, number];

/**
 * A mixed paint ready for the cup / pour tools.
 * Densities are relative acrylic-pigment values (g/ml), not pure pigment SG.
 * Sim code must use `densityToSim(density)` (g/mm³), never raw g/ml.
 */
export type Paint = {
  id: string;
  name: string;
  /** sRGB 0–1. */
  rgb: Rgb;
  /** Pigment/binder density, g/ml (human-facing). */
  density: number;
  /** Parts pouring medium per 1 part paint (by volume). */
  mediumRatio: number;
  /** Parts water per 1 part paint (by volume). */
  waterRatio: number;
  /** Silicone / dimethicone drops mixed into this paint. */
  siliconeDrops: number;
};

const DEFAULT_MIX = {
  mediumRatio: 1,
  waterRatio: 0.1,
  siliconeDrops: 0,
} as const;

/**
 * Starter shelf (~12). Ordered heaviest → lighter for readability.
 * Relative densities: Titanium White heaviest; cadmiums next; phthalos / quinacridones lightest.
 */
export const PAINT_PRESETS: readonly Paint[] = [
  {
    id: 'titanium-white',
    name: 'Titanium White',
    rgb: [0.96, 0.96, 0.94],
    density: 1.42,
    ...DEFAULT_MIX,
  },
  {
    id: 'cadmium-red',
    name: 'Cadmium Red',
    rgb: [0.86, 0.16, 0.12],
    density: 1.34,
    ...DEFAULT_MIX,
  },
  {
    id: 'cadmium-orange',
    name: 'Cadmium Orange',
    rgb: [0.92, 0.42, 0.1],
    density: 1.31,
    ...DEFAULT_MIX,
  },
  {
    id: 'cadmium-yellow',
    name: 'Cadmium Yellow',
    rgb: [0.96, 0.82, 0.12],
    density: 1.29,
    ...DEFAULT_MIX,
  },
  {
    id: 'yellow-ochre',
    name: 'Yellow Ochre',
    rgb: [0.78, 0.58, 0.22],
    density: 1.26,
    ...DEFAULT_MIX,
  },
  {
    id: 'burnt-sienna',
    name: 'Burnt Sienna',
    rgb: [0.55, 0.24, 0.14],
    density: 1.24,
    ...DEFAULT_MIX,
  },
  {
    id: 'ultramarine-blue',
    name: 'Ultramarine Blue',
    rgb: [0.18, 0.22, 0.62],
    density: 1.2,
    ...DEFAULT_MIX,
  },
  {
    id: 'carbon-black',
    name: 'Carbon Black',
    rgb: [0.06, 0.06, 0.07],
    density: 1.16,
    ...DEFAULT_MIX,
  },
  {
    id: 'phthalo-blue',
    name: 'Phthalo Blue',
    rgb: [0.02, 0.16, 0.42],
    density: 1.12,
    ...DEFAULT_MIX,
  },
  {
    id: 'phthalo-green',
    name: 'Phthalo Green',
    rgb: [0.02, 0.35, 0.28],
    density: 1.1,
    ...DEFAULT_MIX,
  },
  {
    id: 'quinacridone-magenta',
    name: 'Quinacridone Magenta',
    rgb: [0.72, 0.08, 0.38],
    density: 1.08,
    ...DEFAULT_MIX,
  },
  {
    id: 'quinacridone-gold',
    name: 'Quinacridone Gold',
    rgb: [0.82, 0.55, 0.12],
    density: 1.06,
    ...DEFAULT_MIX,
  },
] as const;

export function getPaintPreset(id: string): Paint | undefined {
  return PAINT_PRESETS.find((paint) => paint.id === id);
}
