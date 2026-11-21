import type { GridSize } from '../types';

/** COPY_SRC|COPY_DST|TEXTURE_BINDING|STORAGE_BINDING — numeric so Node tests can import this module. */
const DEFAULT_USAGE = 0x01 | 0x02 | 0x04 | 0x08;

export type PingPongTextures = {
  readonly name: string;
  readonly size: GridSize;
  readonly format: GPUTextureFormat;
  /** Current readable texture (stable name side after swaps). */
  get read(): GPUTexture;
  /** Current writable texture. */
  get write(): GPUTexture;
  get readView(): GPUTextureView;
  get writeView(): GPUTextureView;
  /** Explicit A/B handles (do not assume which is read/write). */
  readonly textureA: GPUTexture;
  readonly textureB: GPUTexture;
  swap(): void;
  destroy(): void;
};

/**
 * Named ping-pong pair of N×N storage textures (N = 256 | 512 | 1024).
 * Use `read`/`write` + `swap()` between compute passes — never read and write the same resource.
 */
export function createPingPongTextures(
  device: GPUDevice,
  name: string,
  size: GridSize,
  format: GPUTextureFormat = 'r32float',
  usage: number = DEFAULT_USAGE,
): PingPongTextures {
  if (size !== 256 && size !== 512 && size !== 1024) {
    throw new RangeError('Ping-pong grid size must be 256, 512, or 1024');
  }

  const textureA = device.createTexture({
    label: `${name}A`,
    size: { width: size, height: size },
    format,
    usage,
  });
  const textureB = device.createTexture({
    label: `${name}B`,
    size: { width: size, height: size },
    format,
    usage,
  });

  let readIsA = true;
  const viewA = textureA.createView({ label: `${name}A-view` });
  const viewB = textureB.createView({ label: `${name}B-view` });

  return {
    name,
    size,
    format,
    textureA,
    textureB,
    get read() {
      return readIsA ? textureA : textureB;
    },
    get write() {
      return readIsA ? textureB : textureA;
    },
    get readView() {
      return readIsA ? viewA : viewB;
    },
    get writeView() {
      return readIsA ? viewB : viewA;
    },
    swap() {
      readIsA = !readIsA;
    },
    destroy() {
      textureA.destroy();
      textureB.destroy();
    },
  };
}
