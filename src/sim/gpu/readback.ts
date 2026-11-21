/** WebGPU copy row pitch must be a multiple of 256 bytes. */
export function alignedBytesPerRow(unpaddedBytesPerRow: number): number {
  return Math.ceil(unpaddedBytesPerRow / 256) * 256;
}

export type ReadTextureOptions = {
  width: number;
  height: number;
  /** Bytes per texel in the source texture (r32float = 4). */
  bytesPerTexel?: number;
  /** Origin of the copy rectangle. Default (0,0). */
  origin?: GPUOrigin3D;
};

/**
 * Async GPU → CPU readback of a texture region into a tightly packed Float32Array
 * (row padding from the staging buffer is stripped).
 */
export async function readTextureToFloat32(
  device: GPUDevice,
  texture: GPUTexture,
  options: ReadTextureOptions,
): Promise<Float32Array> {
  const bytesPerTexel = options.bytesPerTexel ?? 4;
  const { width, height } = options;
  const unpadded = width * bytesPerTexel;
  const bytesPerRow = alignedBytesPerRow(unpadded);
  const bufferSize = bytesPerRow * height;

  const staging = device.createBuffer({
    label: 'readback-staging',
    size: bufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const encoder = device.createCommandEncoder({ label: 'readback-encoder' });
  encoder.copyTextureToBuffer(
    { texture, origin: options.origin ?? { x: 0, y: 0, z: 0 } },
    { buffer: staging, bytesPerRow, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 },
  );
  device.queue.submit([encoder.finish()]);

  await staging.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(staging.getMappedRange());
  const floatsPerRow = width;
  const out = new Float32Array(width * height);

  if (bytesPerRow === unpadded) {
    out.set(new Float32Array(mapped.buffer, mapped.byteOffset, out.length));
  } else {
    const rowFloats = bytesPerRow / 4;
    const src = new Float32Array(mapped.buffer, mapped.byteOffset, rowFloats * height);
    for (let y = 0; y < height; y += 1) {
      out.set(src.subarray(y * rowFloats, y * rowFloats + floatsPerRow), y * floatsPerRow);
    }
  }

  staging.unmap();
  staging.destroy();
  return out;
}

/** Async GPU → CPU readback of a storage/uniform buffer into a Float32Array copy. */
export async function readBufferToFloat32(
  device: GPUDevice,
  buffer: GPUBuffer,
  byteLength: number = buffer.size,
  byteOffset = 0,
): Promise<Float32Array> {
  const staging = device.createBuffer({
    label: 'readback-buffer-staging',
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: 'readback-buffer-encoder' });
  encoder.copyBufferToBuffer(buffer, byteOffset, staging, 0, byteLength);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const data = new Float32Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  return data;
}
