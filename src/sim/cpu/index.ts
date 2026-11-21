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
export type { ThinFilmParams, ThinFilmState } from './thinFilm';
export {
  addGaussianPuddle,
  cloneThinFilmState,
  createThinFilmState,
  DEFAULT_THIN_FILM_PARAMS,
  gravityFromTilt,
  heightCenterOfMass,
  maxStableDt,
  thinFilmStep,
  thinFilmSubstep,
  totalFilmVolumeMm3,
} from './thinFilm';
