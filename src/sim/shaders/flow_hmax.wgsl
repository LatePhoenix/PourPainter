// GPU max-reduction of film height (positive IEEE floats → atomicMax on bit pattern).
// One thread per cell; result in hMaxBits (reinterpret as f32 on the host).

struct FlowParams {
  mu: f32,
  sigma: f32,
  rho: f32,
  dx: f32,
  gParallelX: f32,
  gParallelY: f32,
  gPerp: f32,
  hMin: f32,
  dt: f32,
  pad0: f32,
  width: u32,
  height: u32,
}

struct HMaxState {
  bits: atomic<u32>,
}

@group(0) @binding(0) var<uniform> params: FlowParams;
@group(0) @binding(1) var heightTex: texture_storage_2d<r32float, read>;
@group(0) @binding(2) var<storage, read_write> hMax: HMaxState;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.width || gid.y >= params.height) {
    return;
  }
  let h = max(0.0, textureLoad(heightTex, vec2i(gid.xy)).r);
  atomicMax(&hMax.bits, bitcast<u32>(h));
}
