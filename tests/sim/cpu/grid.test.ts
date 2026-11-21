import { describe, expect, it } from 'vitest';
import {
  copyGrid,
  copyGridInto,
  createGrid2D,
  getCell,
  hasNonFinite,
  inBounds,
  isMirrorSymmetric,
  maxAbsDiff,
  setCell,
  totalVolume,
} from '../../../src/sim/cpu/grid';

describe('createGrid2D / getCell / setCell', () => {
  it('creates a zero-filled grid of the requested size', () => {
    const grid = createGrid2D(4, 3);
    expect(grid.width).toBe(4);
    expect(grid.height).toBe(3);
    expect(grid.data).toHaveLength(12);
    expect(totalVolume(grid)).toBe(0);
  });

  it('get/set round-trip inside bounds', () => {
    const grid = createGrid2D(3, 2);
    setCell(grid, 2, 1, 1.5);
    expect(getCell(grid, 2, 1)).toBe(1.5);
    expect(getCell(grid, 0, 0)).toBe(0);
  });

  it('treats out-of-bounds get as 0 and ignores out-of-bounds set', () => {
    const grid = createGrid2D(2, 2, 1);
    expect(inBounds(grid, -1, 0)).toBe(false);
    expect(getCell(grid, -1, 0)).toBe(0);
    expect(getCell(grid, 2, 0)).toBe(0);
    setCell(grid, -1, 0, 99);
    setCell(grid, 0, 2, 99);
    expect(totalVolume(grid)).toBe(4);
  });

  it('rejects non-positive dimensions', () => {
    expect(() => createGrid2D(0, 2)).toThrow(RangeError);
    expect(() => createGrid2D(2, -1)).toThrow(RangeError);
  });
});

describe('copyGrid / copyGridInto', () => {
  it('deep-copies so mutations do not alias', () => {
    const src = createGrid2D(2, 2, 1);
    const dst = copyGrid(src);
    setCell(src, 0, 0, 9);
    expect(getCell(dst, 0, 0)).toBe(1);
    expect(getCell(src, 0, 0)).toBe(9);
  });

  it('copyGridInto requires matching shapes', () => {
    const a = createGrid2D(2, 2, 3);
    const b = createGrid2D(2, 2);
    copyGridInto(a, b);
    expect(maxAbsDiff(a, b)).toBe(0);
    expect(() => copyGridInto(a, createGrid2D(3, 2))).toThrow(/shape mismatch/i);
  });
});

describe('totalVolume', () => {
  it('sums cells and scales by cell area', () => {
    const grid = createGrid2D(2, 2);
    setCell(grid, 0, 0, 1);
    setCell(grid, 1, 0, 2);
    setCell(grid, 0, 1, 3);
    setCell(grid, 1, 1, 4);
    expect(totalVolume(grid)).toBe(10);
    expect(totalVolume(grid, 0.5)).toBe(5);
  });
});

describe('hasNonFinite', () => {
  it('detects NaN and Infinity', () => {
    const grid = createGrid2D(2, 1, 1);
    expect(hasNonFinite(grid)).toBe(false);
    setCell(grid, 0, 0, Number.NaN);
    expect(hasNonFinite(grid)).toBe(true);
    const inf = createGrid2D(1, 1, Number.POSITIVE_INFINITY);
    expect(hasNonFinite(inf)).toBe(true);
  });
});

describe('isMirrorSymmetric', () => {
  it('detects left–right (x) symmetry', () => {
    const grid = createGrid2D(4, 2);
    setCell(grid, 0, 0, 1);
    setCell(grid, 3, 0, 1);
    setCell(grid, 1, 1, 2);
    setCell(grid, 2, 1, 2);
    expect(isMirrorSymmetric(grid, 'x', 0)).toBe(true);
    setCell(grid, 0, 1, 9);
    expect(isMirrorSymmetric(grid, 'x', 0)).toBe(false);
    expect(isMirrorSymmetric(grid, 'x', 9)).toBe(true);
  });

  it('detects top–bottom (y) symmetry', () => {
    const grid = createGrid2D(2, 4);
    setCell(grid, 0, 0, 3);
    setCell(grid, 0, 3, 3);
    setCell(grid, 1, 1, 4);
    setCell(grid, 1, 2, 4);
    expect(isMirrorSymmetric(grid, 'y', 1e-6)).toBe(true);
    setCell(grid, 1, 0, 8);
    expect(isMirrorSymmetric(grid, 'y', 1e-6)).toBe(false);
  });
});

describe('maxAbsDiff', () => {
  it('returns the maximum absolute cell difference', () => {
    const a = createGrid2D(2, 2, 1);
    const b = copyGrid(a);
    expect(maxAbsDiff(a, b)).toBe(0);
    setCell(b, 1, 1, 4);
    expect(maxAbsDiff(a, b)).toBe(3);
  });
});
