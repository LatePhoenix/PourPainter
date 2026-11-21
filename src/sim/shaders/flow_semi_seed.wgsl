// Copy the current height texture into the GS iterate buffer (h* ← hⁿ).

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
  jacobiOmega: f32,
  width: u32,
  height: u32,
}

@group(0) @binding(0) var<uniform> params: FlowParams;
@group(0) @binding(1) var heightTex: texture_storage_2d<r32float, read>;
@group(0) @binding(2) var<storage, read_write> iterate: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.width || gid.y >= params.height) {
    return;
  }
  let h = max(0.0, textureLoad(heightTex, vec2i(gid.xy)).r);
  iterate[gid.y * params.width + gid.x] = h;
}
