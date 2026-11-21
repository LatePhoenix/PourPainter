/**
 * Dense Float64 grid for CPU reference solvers and invariant tests.
 * Float64 (not Float32) so long explicit thin-film runs can conserve volume to
 * ~1e-6 relative; GPU compare paths cast/read back separately.
 * Layout is row-major: index = y * width + x, with (0,0) at the top-left of the
 * array (texture / y-down). Physics that uses canvas y-up converts at the boundary.
 */

export type Grid2D = {
  readonly width: number;
  readonly height: number;
  /** Row-major length width * height. */
  readonly data: Float64Array;
};

export type MirrorAxis = 'x' | 'y';

export function createGrid2D(width: number, height: number, fill = 0): Grid2D {
  assertPositiveInt(width, 'width');
  assertPositiveInt(height, 'height');
  const data = new Float64Array(width * height);
  if (fill !== 0) {
    data.fill(fill);
  }
  return { width, height, data };
}

export function gridIndex(grid: Grid2D, x: number, y: number): number {
  return y * grid.width + x;
}

export function inBounds(grid: Grid2D, x: number, y: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < grid.width &&
    y < grid.height
  );
}

function assertIntegerIndex(x: number, y: number): void {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new RangeError(`Grid indices must be integers (got ${x}, ${y})`);
  }
}

/**
 * Read a cell. Out-of-bounds integer samples return 0 (exterior is empty — no wrap).
 * Non-integer indices throw `RangeError`.
 */
export function getCell(grid: Grid2D, x: number, y: number): number {
  assertIntegerIndex(x, y);
  if (!inBounds(grid, x, y)) {
    return 0;
  }
  return grid.data[gridIndex(grid, x, y)]!;
}

/**
 * Write a cell. Out-of-bounds integer writes are ignored (no wrap, no throw).
 * Non-integer indices throw `RangeError`.
 */
export function setCell(grid: Grid2D, x: number, y: number, value: number): void {
  assertIntegerIndex(x, y);
  if (!inBounds(grid, x, y)) {
    return;
  }
  grid.data[gridIndex(grid, x, y)] = value;
}

/** Deep copy into a new grid. */
export function copyGrid(grid: Grid2D): Grid2D {
  return {
    width: grid.width,
    height: grid.height,
    data: new Float64Array(grid.data),
  };
}

/** Copy `src` into `dst` (same dimensions required). */
export function copyGridInto(src: Grid2D, dst: Grid2D): void {
  assertSameShape(src, dst);
  dst.data.set(src.data);
}

/** Sum of cell values × `cellArea` (default 1). For volume, pass dx*dy in mm². */
export function totalVolume(grid: Grid2D, cellArea = 1): number {
  let sum = 0;
  for (let i = 0; i < grid.data.length; i += 1) {
    sum += grid.data[i]!;
  }
  return sum * cellArea;
}

/** True if any cell is NaN or ±Infinity. */
export function hasNonFinite(grid: Grid2D): boolean {
  for (let i = 0; i < grid.data.length; i += 1) {
    if (!Number.isFinite(grid.data[i]!)) {
      return true;
    }
  }
  return false;
}

function sameNonFinite(a: number, b: number): boolean {
  if (Number.isFinite(a) || Number.isFinite(b)) {
    return false;
  }
  // Both NaN, or both +Inf, or both -Inf.
  if (Number.isNaN(a) && Number.isNaN(b)) {
    return true;
  }
  return a === b;
}

/**
 * Mirror symmetry check.
 * - `'x'`: left–right symmetry (value at (x,y) ≈ (width-1-x, y))
 * - `'y'`: top–bottom symmetry (value at (x,y) ≈ (x, height-1-y))
 * Returns `false` if any compared pair includes a non-finite value.
 */
export function isMirrorSymmetric(grid: Grid2D, axis: MirrorAxis, tol: number): boolean {
  if (!(tol >= 0) || !Number.isFinite(tol)) {
    throw new RangeError('tol must be a non-negative finite number');
  }

  if (axis === 'x') {
    const mid = Math.ceil(grid.width / 2);
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < mid; x += 1) {
        const a = getCell(grid, x, y);
        const b = getCell(grid, grid.width - 1 - x, y);
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
          return false;
        }
        if (Math.abs(a - b) > tol) {
          return false;
        }
      }
    }
    return true;
  }

  const mid = Math.ceil(grid.height / 2);
  for (let y = 0; y < mid; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const a = getCell(grid, x, y);
      const b = getCell(grid, x, grid.height - 1 - y);
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        return false;
      }
      if (Math.abs(a - b) > tol) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Max |a − b| over all cells. Grids must match in size.
 * Returns `NaN` if any cell is non-finite, unless both cells at that index are
 * the same non-finite value (both NaN, or equal ±Infinity).
 */
export function maxAbsDiff(a: Grid2D, b: Grid2D): number {
  assertSameShape(a, b);
  let max = 0;
  for (let i = 0; i < a.data.length; i += 1) {
    const av = a.data[i]!;
    const bv = b.data[i]!;
    if (!Number.isFinite(av) || !Number.isFinite(bv)) {
      if (sameNonFinite(av, bv)) {
        continue;
      }
      return Number.NaN;
    }
    const diff = Math.abs(av - bv);
    if (diff > max) {
      max = diff;
    }
  }
  return max;
}

function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`Grid ${label} must be a positive integer`);
  }
}

function assertSameShape(a: Grid2D, b: Grid2D): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Grid shape mismatch: ${a.width}×${a.height} vs ${b.width}×${b.height}`);
  }
}
