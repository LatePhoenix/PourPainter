/**
 * Uniform field descriptors for packing a WGSL-compatible struct into an ArrayBuffer.
 * Alignment follows WGSL host-shareable layout (std140-ish): scalars 4, vec2 8, vec3/vec4 16.
 */
export type UniformFieldType = 'u32' | 'i32' | 'f32' | 'vec2f' | 'vec3f' | 'vec4f';

export type UniformField = {
  name: string;
  type: UniformFieldType;
};

export type UniformValue =
  | number
  | readonly [number, number]
  | readonly [number, number, number]
  | readonly [number, number, number, number];

const ALIGN: Record<UniformFieldType, number> = {
  u32: 4,
  i32: 4,
  f32: 4,
  vec2f: 8,
  vec3f: 16,
  vec4f: 16,
};

const SIZE: Record<UniformFieldType, number> = {
  u32: 4,
  i32: 4,
  f32: 4,
  vec2f: 8,
  vec3f: 12,
  vec4f: 16,
};

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

/** Byte size of a packed uniform struct (including end padding to 16). */
export function uniformStructSize(fields: readonly UniformField[]): number {
  let offset = 0;
  for (const field of fields) {
    offset = alignUp(offset, ALIGN[field.type]);
    offset += SIZE[field.type];
  }
  return alignUp(offset, 16);
}

/** Pack field values into a ArrayBuffer matching WGSL struct layout. */
export function packUniforms(
  fields: readonly UniformField[],
  values: Record<string, UniformValue>,
): ArrayBuffer {
  const buffer = new ArrayBuffer(uniformStructSize(fields));
  const view = new DataView(buffer);
  let offset = 0;

  for (const field of fields) {
    offset = alignUp(offset, ALIGN[field.type]);
    const value = values[field.name];
    if (value === undefined) {
      throw new Error(`Missing uniform value for "${field.name}"`);
    }

    switch (field.type) {
      case 'u32':
        view.setUint32(offset, Number(value), true);
        break;
      case 'i32':
        view.setInt32(offset, Number(value), true);
        break;
      case 'f32':
        view.setFloat32(offset, Number(value), true);
        break;
      case 'vec2f': {
        const v = value as readonly [number, number];
        view.setFloat32(offset, v[0], true);
        view.setFloat32(offset + 4, v[1], true);
        break;
      }
      case 'vec3f': {
        const v = value as readonly [number, number, number];
        view.setFloat32(offset, v[0], true);
        view.setFloat32(offset + 4, v[1], true);
        view.setFloat32(offset + 8, v[2], true);
        break;
      }
      case 'vec4f': {
        const v = value as readonly [number, number, number, number];
        view.setFloat32(offset, v[0], true);
        view.setFloat32(offset + 4, v[1], true);
        view.setFloat32(offset + 8, v[2], true);
        view.setFloat32(offset + 12, v[3], true);
        break;
      }
    }
    offset += SIZE[field.type];
  }

  return buffer;
}

export type ComputePipelineFromWgslOptions = {
  label?: string;
  entryPoint?: string;
  /** When provided, forces an explicit pipeline layout; otherwise auto layout is used. */
  layout?: GPUPipelineLayout | 'auto';
};

/** Build a compute pipeline from a WGSL source string plus optional entry metadata. */
export function createComputePipelineFromWgsl(
  device: GPUDevice,
  wgsl: string,
  options: ComputePipelineFromWgslOptions = {},
): GPUComputePipeline {
  const module = device.createShaderModule({
    label: options.label ? `${options.label}-module` : undefined,
    code: wgsl,
  });
  return device.createComputePipeline({
    label: options.label,
    layout: options.layout ?? 'auto',
    compute: {
      module,
      entryPoint: options.entryPoint ?? 'main',
    },
  });
}

/**
 * Convenience: create a uniform GPUBuffer sized for `fields`, optionally filled from `values`.
 * Bind as a uniform buffer; rewrite with `device.queue.writeBuffer` + `packUniforms`.
 */
export function createUniformBuffer(
  device: GPUDevice,
  fields: readonly UniformField[],
  values?: Record<string, UniformValue>,
  label?: string,
): GPUBuffer {
  const size = Math.max(16, uniformStructSize(fields));
  const buffer = device.createBuffer({
    label,
    size,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  if (values) {
    device.queue.writeBuffer(buffer, 0, packUniforms(fields, values));
  }
  return buffer;
}
