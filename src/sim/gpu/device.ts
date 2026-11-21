export type GpuInitErrorCode = 'unsupported' | 'no-adapter' | 'request-failed';

/** Structured failure from `requestGpuDevice` — never throws for missing WebGPU. */
export type GpuInitError = {
  code: GpuInitErrorCode;
  message: string;
  cause?: unknown;
};

export type GpuInitSuccess = {
  adapter: GPUAdapter;
  device: GPUDevice;
};

export type GpuInitResult =
  { ok: true; value: GpuInitSuccess } | { ok: false; error: GpuInitError };

/**
 * Request a WebGPU adapter + device.
 * Returns a clear error object when the API is missing or the request fails.
 */
export async function requestGpuDevice(
  options: GPURequestAdapterOptions = { powerPreference: 'high-performance' },
): Promise<GpuInitResult> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return {
      ok: false,
      error: {
        code: 'unsupported',
        message: 'WebGPU is not available in this browser. Use Chrome or Edge.',
      },
    };
  }

  let adapter: GPUAdapter | null;
  try {
    adapter = await navigator.gpu.requestAdapter(options);
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: 'request-failed',
        message: 'Failed to request a WebGPU adapter.',
        cause,
      },
    };
  }

  if (!adapter) {
    return {
      ok: false,
      error: {
        code: 'no-adapter',
        message: 'No WebGPU adapter was returned. Use Chrome or Edge with GPU access enabled.',
      },
    };
  }

  try {
    const device = await adapter.requestDevice();
    return { ok: true, value: { adapter, device } };
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: 'request-failed',
        message: 'Failed to create a WebGPU device.',
        cause,
      },
    };
  }
}
