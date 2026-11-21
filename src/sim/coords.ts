export type CanvasPoint = {
  /** Canvas-normalized x; 0 = left, 1 = right. May fall outside [0, 1]. */
  x: number;
  /** Canvas-normalized y; 0 = bottom, 1 = top (y-up). May fall outside [0, 1]. */
  y: number;
};

export type TexelCoord = {
  /** Column index, x-right, in [0, gridN). */
  i: number;
  /** Row index, y-down (texture space), in [0, gridN). */
  j: number;
};

type PointerLike = {
  clientX: number;
  clientY: number;
};

type RectLike = {
  getBoundingClientRect(): DOMRect | { left: number; top: number; width: number; height: number };
};

/**
 * Map a DOM pointer event to canvas-normalized coords.
 * Origin is bottom-left, y-up — matches `ToolAction` docs.
 */
export function pointerToCanvas(event: PointerLike, canvasEl: RectLike): CanvasPoint {
  const rect = canvasEl.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { x: 0, y: 0 };
  }
  const x = (event.clientX - rect.left) / rect.width;
  const y = 1 - (event.clientY - rect.top) / rect.height;
  return { x, y };
}

/**
 * Map canvas-normalized (y-up) coords to integer texel indices (y-down textures).
 * Out-of-range canvas points clamp to the grid edge.
 */
export function canvasToTexel(x: number, y: number, gridN: number): TexelCoord {
  if (!Number.isInteger(gridN) || gridN <= 0) {
    throw new RangeError('gridN must be a positive integer');
  }
  const max = gridN - 1;
  const i = Math.min(max, Math.max(0, Math.floor(x * gridN)));
  const j = Math.min(max, Math.max(0, Math.floor((1 - y) * gridN)));
  return { i, j };
}
