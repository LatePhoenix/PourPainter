import { describe, expect, it } from 'vitest';
import { PAINT_PRESETS } from '../../src/domain/paint';
import {
  parseRecipe,
  RECIPE_VERSION,
  RecipeParseError,
  serializeRecipe,
  type Recipe,
} from '../../src/domain/recipe';

function sampleRecipe(): Recipe {
  const white = PAINT_PRESETS[0];
  const magenta = PAINT_PRESETS[10];
  if (!white || !magenta) {
    throw new Error('expected paint presets');
  }
  return {
    version: RECIPE_VERSION,
    canvas: { widthMm: 300, heightMm: 300, shape: 'square' },
    paints: [
      { ...white, siliconeDrops: 2 },
      { ...magenta, mediumRatio: 1.2, waterRatio: 0.15 },
    ],
    cup: {
      type: 'single',
      layers: [
        { paintId: white.id, volumeMl: 40 },
        { paintId: magenta.id, volumeMl: 25 },
      ],
    },
    techniqueId: 'flip-cup',
    seed: 0xc0ffee,
    actions: [
      { t: 0, type: 'tilt', x: 0.1, y: -0.2 },
      { t: 1.5, type: 'pour', x: 0.5, y: 0.5, paintId: white.id, rateMlPerS: 8 },
      { t: 3, type: 'torch', x: 0.4, y: 0.6, intensity: 0.8 },
      { t: 4, type: 'air', x: 0.5, y: 0.5, dirX: 1, dirY: 0, strength: 0.5 },
      { t: 5, type: 'swipe', x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.5 },
      {
        t: 6,
        type: 'string',
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.5, y: 0.7 },
          { x: 0.8, y: 0.3 },
        ],
      },
    ],
  };
}

describe('recipe serialize/parse', () => {
  it('round-trips a full recipe', () => {
    const original = sampleRecipe();
    const restored = parseRecipe(serializeRecipe(original));
    expect(restored).toEqual(original);
  });

  it('rejects unsupported versions', () => {
    const json = serializeRecipe(sampleRecipe()).replace(
      `"version":${RECIPE_VERSION}`,
      '"version":999',
    );
    expect(() => parseRecipe(json)).toThrow(RecipeParseError);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseRecipe('{')).toThrow(RecipeParseError);
  });

  it('rejects unknown tool action types', () => {
    const broken = serializeRecipe(sampleRecipe()).replace('"type":"tilt"', '"type":"teleport"');
    expect(() => parseRecipe(broken)).toThrow(/unknown type/i);
  });
});
