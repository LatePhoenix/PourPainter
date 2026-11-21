import type { Cup } from './cup';
import type { Paint } from './paint';
import { isValidSeed } from './seed';

export const RECIPE_VERSION = 1 as const;

export type CanvasShape = 'square' | 'rectangle' | 'round';

export type CanvasSpec = {
  /** Width in mm. */
  widthMm: number;
  /** Height in mm. */
  heightMm: number;
  shape: CanvasShape;
};

/** Known technique presets; string keeps room for user-defined ids later. */
export type TechniqueId =
  | 'dirty-pour'
  | 'flip-cup'
  | 'puddle'
  | 'tree-ring'
  | 'swipe'
  | 'dutch'
  | 'bloom'
  | 'string-pull'
  | (string & {});

/**
 * Timed tool events for replay.
 *
 * Spatial coordinates are canvas-normalized with (0,0) at the bottom-left of the
 * canvas rectangle and (1,1) at the top-right. Values **may fall outside [0,1]**
 * (tools can start or stroke off-canvas); the sim clamps or ignores out-of-bounds
 * samples rather than rejecting the recipe.
 *
 * Extend with new `type` variants; keep old ones for forward-compatible JSON.
 */
export type ToolAction =
  | { t: number; type: 'tilt'; x: number; y: number }
  | { t: number; type: 'pour'; x: number; y: number; paintId: string; rateMlPerS: number }
  | { t: number; type: 'torch'; x: number; y: number; intensity: number }
  | { t: number; type: 'air'; x: number; y: number; dirX: number; dirY: number; strength: number }
  | { t: number; type: 'swipe'; x0: number; y0: number; x1: number; y1: number }
  | { t: number; type: 'string'; points: readonly { x: number; y: number }[] };

export type Recipe = {
  version: typeof RECIPE_VERSION;
  canvas: CanvasSpec;
  paints: readonly Paint[];
  cup: Cup;
  techniqueId: TechniqueId;
  /** Seed for the sim RNG; integer in [0, 2³²). Same recipe + seed → identical replay. */
  seed: number;
  actions: readonly ToolAction[];
};

export class RecipeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecipeParseError';
  }
}

export function serializeRecipe(recipe: Recipe): string {
  return JSON.stringify(recipe);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RecipeParseError(`Recipe ${label} must be a finite number`);
  }
  return value;
}

function parsePaint(value: unknown, index: number): Paint {
  if (!isRecord(value)) {
    throw new RecipeParseError(`Recipe paints[${index}] must be an object`);
  }
  const rgb = value.rgb;
  if (!Array.isArray(rgb) || rgb.length !== 3) {
    throw new RecipeParseError(`Recipe paints[${index}].rgb must be [r,g,b]`);
  }
  return {
    id: String(value.id ?? ''),
    name: String(value.name ?? ''),
    rgb: [
      assertFiniteNumber(rgb[0], `paints[${index}].rgb[0]`),
      assertFiniteNumber(rgb[1], `paints[${index}].rgb[1]`),
      assertFiniteNumber(rgb[2], `paints[${index}].rgb[2]`),
    ],
    density: assertFiniteNumber(value.density, `paints[${index}].density`),
    mediumRatio: assertFiniteNumber(value.mediumRatio, `paints[${index}].mediumRatio`),
    waterRatio: assertFiniteNumber(value.waterRatio, `paints[${index}].waterRatio`),
    siliconeDrops: assertFiniteNumber(value.siliconeDrops, `paints[${index}].siliconeDrops`),
  };
}

function parseCup(value: unknown): Cup {
  if (!isRecord(value)) {
    throw new RecipeParseError('Recipe cup must be an object');
  }
  const type = value.type;
  if (
    type !== 'single' &&
    type !== 'split' &&
    type !== 'funnel' &&
    type !== 'colander' &&
    type !== 'squeeze'
  ) {
    throw new RecipeParseError('Recipe cup.type is invalid');
  }
  if (!Array.isArray(value.layers)) {
    throw new RecipeParseError('Recipe cup.layers must be an array');
  }
  return {
    type,
    layers: value.layers.map((layer, index) => {
      if (!isRecord(layer)) {
        throw new RecipeParseError(`Recipe cup.layers[${index}] must be an object`);
      }
      return {
        paintId: String(layer.paintId ?? ''),
        volumeMl: assertFiniteNumber(layer.volumeMl, `cup.layers[${index}].volumeMl`),
      };
    }),
  };
}

function parseAction(value: unknown, index: number): ToolAction {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new RecipeParseError(`Recipe actions[${index}] must be an object with type`);
  }
  const t = assertFiniteNumber(value.t, `actions[${index}].t`);
  switch (value.type) {
    case 'tilt':
      return {
        t,
        type: 'tilt',
        x: assertFiniteNumber(value.x, `actions[${index}].x`),
        y: assertFiniteNumber(value.y, `actions[${index}].y`),
      };
    case 'pour':
      return {
        t,
        type: 'pour',
        x: assertFiniteNumber(value.x, `actions[${index}].x`),
        y: assertFiniteNumber(value.y, `actions[${index}].y`),
        paintId: String(value.paintId ?? ''),
        rateMlPerS: assertFiniteNumber(value.rateMlPerS, `actions[${index}].rateMlPerS`),
      };
    case 'torch':
      return {
        t,
        type: 'torch',
        x: assertFiniteNumber(value.x, `actions[${index}].x`),
        y: assertFiniteNumber(value.y, `actions[${index}].y`),
        intensity: assertFiniteNumber(value.intensity, `actions[${index}].intensity`),
      };
    case 'air':
      return {
        t,
        type: 'air',
        x: assertFiniteNumber(value.x, `actions[${index}].x`),
        y: assertFiniteNumber(value.y, `actions[${index}].y`),
        dirX: assertFiniteNumber(value.dirX, `actions[${index}].dirX`),
        dirY: assertFiniteNumber(value.dirY, `actions[${index}].dirY`),
        strength: assertFiniteNumber(value.strength, `actions[${index}].strength`),
      };
    case 'swipe':
      return {
        t,
        type: 'swipe',
        x0: assertFiniteNumber(value.x0, `actions[${index}].x0`),
        y0: assertFiniteNumber(value.y0, `actions[${index}].y0`),
        x1: assertFiniteNumber(value.x1, `actions[${index}].x1`),
        y1: assertFiniteNumber(value.y1, `actions[${index}].y1`),
      };
    case 'string': {
      if (!Array.isArray(value.points)) {
        throw new RecipeParseError(`Recipe actions[${index}].points must be an array`);
      }
      return {
        t,
        type: 'string',
        points: value.points.map((point, pointIndex) => {
          if (!isRecord(point)) {
            throw new RecipeParseError(
              `Recipe actions[${index}].points[${pointIndex}] must be an object`,
            );
          }
          return {
            x: assertFiniteNumber(point.x, `actions[${index}].points[${pointIndex}].x`),
            y: assertFiniteNumber(point.y, `actions[${index}].points[${pointIndex}].y`),
          };
        }),
      };
    }
    default:
      throw new RecipeParseError(`Recipe actions[${index}] has unknown type "${value.type}"`);
  }
}

/**
 * Semantic checks after structural parse. Throws `RecipeParseError` on the first failure.
 */
export function validateRecipe(recipe: Recipe): void {
  if (!isValidSeed(recipe.seed)) {
    throw new RecipeParseError('Recipe seed must be an integer in [0, 2^32)');
  }

  if (!(recipe.canvas.widthMm > 0) || !(recipe.canvas.heightMm > 0)) {
    throw new RecipeParseError('Recipe canvas width and height must be > 0');
  }

  const paintIds = new Set<string>();
  for (const [index, paint] of recipe.paints.entries()) {
    if (paint.id.length === 0) {
      throw new RecipeParseError(`Recipe paints[${index}].id must be non-empty`);
    }
    if (paintIds.has(paint.id)) {
      throw new RecipeParseError(`Recipe paints has duplicate id "${paint.id}"`);
    }
    paintIds.add(paint.id);

    if (!(paint.density > 0)) {
      throw new RecipeParseError(`Recipe paints[${index}].density must be > 0`);
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const value = paint.rgb[channel];
      if (value === undefined || value < 0 || value > 1) {
        throw new RecipeParseError(`Recipe paints[${index}].rgb[${channel}] must be in [0, 1]`);
      }
    }
    if (paint.mediumRatio < 0 || paint.waterRatio < 0 || paint.siliconeDrops < 0) {
      throw new RecipeParseError(
        `Recipe paints[${index}] mediumRatio, waterRatio and siliconeDrops must be >= 0`,
      );
    }
  }

  for (const [index, layer] of recipe.cup.layers.entries()) {
    if (!paintIds.has(layer.paintId)) {
      throw new RecipeParseError(
        `Recipe cup.layers[${index}].paintId "${layer.paintId}" is not in paints`,
      );
    }
    if (!(layer.volumeMl > 0)) {
      throw new RecipeParseError(`Recipe cup.layers[${index}].volumeMl must be > 0`);
    }
  }

  let previousT = Number.NEGATIVE_INFINITY;
  for (const [index, action] of recipe.actions.entries()) {
    if (!(action.t >= 0) || action.t < previousT) {
      throw new RecipeParseError(
        `Recipe actions[${index}].t must be >= 0 and non-descending (got ${action.t})`,
      );
    }
    previousT = action.t;

    if (action.type === 'pour' && !paintIds.has(action.paintId)) {
      throw new RecipeParseError(
        `Recipe actions[${index}].paintId "${action.paintId}" is not in paints`,
      );
    }
  }
}

export function parseRecipe(json: string): Recipe {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch {
    throw new RecipeParseError('Recipe JSON is invalid');
  }
  if (!isRecord(raw)) {
    throw new RecipeParseError('Recipe must be an object');
  }
  if (raw.version !== RECIPE_VERSION) {
    throw new RecipeParseError(`Unsupported recipe version: ${String(raw.version)}`);
  }
  if (!isRecord(raw.canvas)) {
    throw new RecipeParseError('Recipe canvas must be an object');
  }
  const shape = raw.canvas.shape;
  if (shape !== 'square' && shape !== 'rectangle' && shape !== 'round') {
    throw new RecipeParseError('Recipe canvas.shape is invalid');
  }
  if (!Array.isArray(raw.paints)) {
    throw new RecipeParseError('Recipe paints must be an array');
  }
  if (!Array.isArray(raw.actions)) {
    throw new RecipeParseError('Recipe actions must be an array');
  }
  if (typeof raw.techniqueId !== 'string' || raw.techniqueId.length === 0) {
    throw new RecipeParseError('Recipe techniqueId must be a non-empty string');
  }

  const recipe: Recipe = {
    version: RECIPE_VERSION,
    canvas: {
      widthMm: assertFiniteNumber(raw.canvas.widthMm, 'canvas.widthMm'),
      heightMm: assertFiniteNumber(raw.canvas.heightMm, 'canvas.heightMm'),
      shape,
    },
    paints: raw.paints.map(parsePaint),
    cup: parseCup(raw.cup),
    techniqueId: raw.techniqueId,
    seed: assertFiniteNumber(raw.seed, 'seed'),
    actions: raw.actions.map(parseAction),
  };

  validateRecipe(recipe);
  return recipe;
}
