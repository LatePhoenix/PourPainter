/** Pure types and data: Paint, Cup, Technique, Recipe, physics constants. */
export type { Cup, CupLayer, CupType } from './cup';
export { totalCupVolumeMl } from './cup';
export { srgbChannelToLinear, srgbToLinear } from './color';
export type { Paint, Rgb } from './paint';
export { getPaintPreset, PAINT_PRESETS } from './paint';
export * from './physics';
export type { CanvasShape, CanvasSpec, Recipe, TechniqueId, ToolAction } from './recipe';
export {
  parseRecipe,
  RECIPE_VERSION,
  RecipeParseError,
  serializeRecipe,
  validateRecipe,
} from './recipe';
export { isValidSeed } from './seed';
