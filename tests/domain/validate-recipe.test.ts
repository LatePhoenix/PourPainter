import { describe, expect, it } from 'vitest';
import { PAINT_PRESETS } from '../../src/domain/paint';
import {
  parseRecipe,
  RECIPE_VERSION,
  RecipeParseError,
  serializeRecipe,
  validateRecipe,
  type Recipe,
} from '../../src/domain/recipe';

function baseRecipe(): Recipe {
  const white = PAINT_PRESETS[0];
  const magenta = PAINT_PRESETS[10];
  if (!white || !magenta) {
    throw new Error('expected paint presets');
  }
  return {
    version: RECIPE_VERSION,
    canvas: { widthMm: 300, heightMm: 300, shape: 'square' },
    paints: [white, magenta],
    cup: {
      type: 'single',
      layers: [
        { paintId: white.id, volumeMl: 40 },
        { paintId: magenta.id, volumeMl: 25 },
      ],
    },
    techniqueId: 'flip-cup',
    seed: 42,
    actions: [
      { t: 0, type: 'tilt', x: 0.1, y: -0.2 },
      { t: 1, type: 'pour', x: 0.5, y: 0.5, paintId: white.id, rateMlPerS: 8 },
    ],
  };
}

function expectInvalid(recipe: Recipe, pattern: RegExp): void {
  expect(() => validateRecipe(recipe)).toThrow(RecipeParseError);
  expect(() => validateRecipe(recipe)).toThrow(pattern);
  expect(() => parseRecipe(serializeRecipe(recipe))).toThrow(pattern);
}

describe('validateRecipe', () => {
  it('accepts a valid recipe, including off-canvas coordinates', () => {
    expect(() => validateRecipe(baseRecipe())).not.toThrow();
    expect(parseRecipe(serializeRecipe(baseRecipe())).actions[0]).toMatchObject({
      type: 'tilt',
      y: -0.2,
    });
  });

  it('rejects empty paint ids', () => {
    const recipe = baseRecipe();
    const paint = recipe.paints[0];
    if (!paint) throw new Error('missing paint');
    expectInvalid(
      {
        ...recipe,
        paints: [{ ...paint, id: '' }, ...recipe.paints.slice(1)],
      },
      /non-empty/i,
    );
  });

  it('rejects duplicate paint ids', () => {
    const recipe = baseRecipe();
    const paint = recipe.paints[0];
    if (!paint) throw new Error('missing paint');
    expectInvalid({ ...recipe, paints: [paint, { ...paint }] }, /duplicate/i);
  });

  it('rejects cup layers whose paintId is missing from paints', () => {
    const recipe = baseRecipe();
    expectInvalid(
      {
        ...recipe,
        cup: { ...recipe.cup, layers: [{ paintId: 'no-such-paint', volumeMl: 10 }] },
      },
      /not in paints/i,
    );
  });

  it('rejects pour actions whose paintId is missing from paints', () => {
    const recipe = baseRecipe();
    expectInvalid(
      {
        ...recipe,
        actions: [{ t: 0, type: 'pour', x: 0.5, y: 0.5, paintId: 'ghost', rateMlPerS: 1 }],
      },
      /not in paints/i,
    );
  });

  it('rejects non-positive canvas width/height', () => {
    const recipe = baseRecipe();
    expectInvalid(
      { ...recipe, canvas: { ...recipe.canvas, widthMm: 0 } },
      /width and height must be > 0/i,
    );
  });

  it('rejects non-positive layer volume', () => {
    const recipe = baseRecipe();
    const layer = recipe.cup.layers[0];
    if (!layer) throw new Error('missing layer');
    expectInvalid(
      { ...recipe, cup: { ...recipe.cup, layers: [{ ...layer, volumeMl: 0 }] } },
      /volumeMl must be > 0/i,
    );
  });

  it('rejects non-positive density', () => {
    const recipe = baseRecipe();
    const paint = recipe.paints[0];
    if (!paint) throw new Error('missing paint');
    expectInvalid(
      { ...recipe, paints: [{ ...paint, density: 0 }, ...recipe.paints.slice(1)] },
      /density must be > 0/i,
    );
  });

  it('rejects rgb outside [0, 1]', () => {
    const recipe = baseRecipe();
    const paint = recipe.paints[0];
    if (!paint) throw new Error('missing paint');
    expectInvalid(
      { ...recipe, paints: [{ ...paint, rgb: [1.2, 0, 0] }, ...recipe.paints.slice(1)] },
      /rgb\[0] must be in \[0, 1]/i,
    );
  });

  it('rejects negative ratios or silicone drops', () => {
    const recipe = baseRecipe();
    const paint = recipe.paints[0];
    if (!paint) throw new Error('missing paint');
    expectInvalid(
      { ...recipe, paints: [{ ...paint, waterRatio: -0.1 }, ...recipe.paints.slice(1)] },
      /must be >= 0/i,
    );
  });

  it('rejects negative action times', () => {
    const recipe = baseRecipe();
    expectInvalid(
      { ...recipe, actions: [{ t: -1, type: 'tilt', x: 0, y: 0 }] },
      /non-descending|>= 0/i,
    );
  });

  it('rejects non-ascending action times', () => {
    const recipe = baseRecipe();
    expectInvalid(
      {
        ...recipe,
        actions: [
          { t: 2, type: 'tilt', x: 0, y: 0 },
          { t: 1, type: 'tilt', x: 0, y: 0 },
        ],
      },
      /non-descending/i,
    );
  });

  it('rejects non-integer or out-of-range seeds via parseRecipe', () => {
    expect(() => parseRecipe(serializeRecipe({ ...baseRecipe(), seed: 1.2 }))).toThrow(
      /seed must be an integer/i,
    );
    expect(() => parseRecipe(serializeRecipe({ ...baseRecipe(), seed: 2 ** 32 }))).toThrow(
      /seed must be an integer/i,
    );
  });
});
