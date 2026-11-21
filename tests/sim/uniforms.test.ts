import { describe, expect, it } from 'vitest';
import { packUniforms, uniformStructSize, type UniformField } from '../../src/sim/gpu/uniforms';

describe('packUniforms', () => {
  it('packs scalars with 16-byte end padding', () => {
    const fields: UniformField[] = [
      { name: 'a', type: 'u32' },
      { name: 'b', type: 'f32' },
    ];
    expect(uniformStructSize(fields)).toBe(16);
    const packed = new Uint32Array(packUniforms(fields, { a: 7, b: 1 }));
    expect(packed[0]).toBe(7);
    expect(new Float32Array(packed.buffer)[1]).toBe(1);
  });

  it('aligns vec3f to 16 and pads the struct', () => {
    const fields: UniformField[] = [
      { name: 'count', type: 'u32' },
      { name: 'color', type: 'vec3f' },
    ];
    // u32 at 0, pad to 16 for vec3, then 12 bytes → end pad to 32
    expect(uniformStructSize(fields)).toBe(32);
    const bytes = new Uint8Array(packUniforms(fields, { count: 3, color: [0.25, 0.5, 0.75] }));
    expect(new DataView(bytes.buffer).getUint32(0, true)).toBe(3);
    expect(new DataView(bytes.buffer).getFloat32(16, true)).toBeCloseTo(0.25);
    expect(new DataView(bytes.buffer).getFloat32(20, true)).toBeCloseTo(0.5);
    expect(new DataView(bytes.buffer).getFloat32(24, true)).toBeCloseTo(0.75);
  });
});
