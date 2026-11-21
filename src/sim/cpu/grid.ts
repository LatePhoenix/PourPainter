/**
 * Dense Float32 grid for CPU reference solvers and invariant tests.
 * Layout is row-major: index = y * width + x, with (0,0) at the top-left of the
 * array (texture / y-down). Physics that uses canvas y-up converts at the boundary.
 */

export type Grid2D = {
  readonly width: number;
  readonly height: number;
  /** Row-major length width * height. */
  readonly data: Float32Array;
};

export type MirrorAxis = 'x' | 'y';

export function createGrid2D(width: number, height: number, fill = 0): Grid2D {
  assertPositiveInt(width, 'width');
  assertPositiveInt(height, 'height');
  const data = new Float32Array(width * height);
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

/**
 * Read a cell. Out-of-bounds samples return 0 (exterior is empty — no wrap).
 */
export function getCell(grid: Grid2D, x: number, y: number): number {
  if (!inBounds(grid, x, y)) {
    return 0;
  }
  return grid.data[gridIndex(grid, x, y)]!;
}

/**
 * Write a cell. Out-of-bounds writes are ignored (no wrap, no throw).
 */
export function setCell(grid: Grid2D, x: number, y: number, value: number): void {
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
    data: new Float32Array(grid.data),
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

/**
 * Mirror symmetry check.
 * - `'x'`: left–right symmetry (value at (x,y) ≈ (width-1-x, y))
 * - `'y'`: top–bottom symmetry (value at (x,y) ≈ (x, height-1-y))
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
      if (Math.abs(a - b) > tol) {
        return false;
      }
    }
  }
  return true;
}

/** Max |a − b| over all cells. Grids must match in size. */
export function maxAbsDiff(a: Grid2D, b: Grid2D): number {
  assertSameShape(a, b);
  let max = 0;
  for (let i = 0; i < a.data.length; i += 1) {
    const diff = Math.abs(a.data[i]! - b.data[i]!);
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
