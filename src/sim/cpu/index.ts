/** CPU reference solver for small grids and physics tests. */
export type { Grid2D, MirrorAxis } from './grid';
export {
  copyGrid,
  copyGridInto,
  createGrid2D,
  getCell,
  gridIndex,
  hasNonFinite,
  inBounds,
  isMirrorSymmetric,
  maxAbsDiff,
  setCell,
  totalVolume,
} from './grid';
