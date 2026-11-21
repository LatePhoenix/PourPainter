import { describe, expect, it } from 'vitest';
import { canvasToTexel, pointerToCanvas } from '../../src/sim/coords';

function fakeCanvas(width: number, height: number, left = 0, top = 0) {
  return {
    getBoundingClientRect: () => ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    }),
  };
}

describe('pointerToCanvas', () => {
  const canvas = fakeCanvas(200, 100, 10, 20);

  it('maps the bottom-left DOM corner to canvas (0, 0)', () => {
    expect(pointerToCanvas({ clientX: 10, clientY: 120 }, canvas)).toEqual({ x: 0, y: 0 });
  });

  it('maps the top-left DOM corner to canvas (0, 1)', () => {
    expect(pointerToCanvas({ clientX: 10, clientY: 20 }, canvas)).toEqual({ x: 0, y: 1 });
  });

  it('maps the top-right DOM corner to canvas (1, 1)', () => {
    expect(pointerToCanvas({ clientX: 210, clientY: 20 }, canvas)).toEqual({ x: 1, y: 1 });
  });

  it('maps the bottom-right DOM corner to canvas (1, 0)', () => {
    expect(pointerToCanvas({ clientX: 210, clientY: 120 }, canvas)).toEqual({ x: 1, y: 0 });
  });

  it('maps the center to canvas (0.5, 0.5)', () => {
    expect(pointerToCanvas({ clientX: 110, clientY: 70 }, canvas)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('canvasToTexel', () => {
  const n = 8;

  it('maps canvas bottom-left (0,0) to the bottom texture row', () => {
    expect(canvasToTexel(0, 0, n)).toEqual({ i: 0, j: n - 1 });
  });

  it('maps canvas top-left (0,1) to the top texture row', () => {
    expect(canvasToTexel(0, 1, n)).toEqual({ i: 0, j: 0 });
  });

  it('maps canvas top-right (1,1) to the top-right texel', () => {
    expect(canvasToTexel(1, 1, n)).toEqual({ i: n - 1, j: 0 });
  });

  it('maps canvas bottom-right (1,0) to the bottom-right texel', () => {
    expect(canvasToTexel(1, 0, n)).toEqual({ i: n - 1, j: n - 1 });
  });

  it('maps the center near the middle texel', () => {
    expect(canvasToTexel(0.5, 0.5, n)).toEqual({ i: 4, j: 4 });
  });

  it('clamps out-of-range canvas points to the grid edge', () => {
    expect(canvasToTexel(-0.2, 1.2, n)).toEqual({ i: 0, j: 0 });
    expect(canvasToTexel(1.2, -0.2, n)).toEqual({ i: n - 1, j: n - 1 });
  });
});
