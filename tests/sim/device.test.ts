import { describe, expect, it } from 'vitest';
import { requestGpuDevice } from '../../src/sim/gpu/device';

describe('requestGpuDevice', () => {
  it('returns a structured unsupported error when WebGPU is missing', async () => {
    const result = await requestGpuDevice();
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('unsupported');
    expect(result.error.message).toMatch(/WebGPU/i);
    expect(result.error.message).toMatch(/Chrome or Edge/i);
  });
});
