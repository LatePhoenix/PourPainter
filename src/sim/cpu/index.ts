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
  addBoxPuddle,
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
export {
  SEMI_IMPLICIT_ACCURACY_FACTOR,
  SEMI_IMPLICIT_DT_TOLERANCE,
  SEMI_IMPLICIT_JACOBI_OMEGA,
  SEMI_IMPLICIT_SWEEPS,
  assertSemiImplicitDt,
  capillaryDiagonal,
  capillaryDivergence,
  explicitCapillaryDt,
  explicitCapillaryDtFromHMax,
  maxStableDtSemiImplicit,
  thinFilmStepSemiImplicit,
  thinFilmSubstepSemiImplicit,
} from './thinFilmSemi';
