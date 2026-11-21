// Copy every FlowParams field into a tightly packed storage buffer for
// host round-trip checks (M0-04 / M1-02). Layout matches packUniforms order:
// 12 × f32 words (u32 fields bitcast to f32 slots for a uniform Float32 readback).

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

@group(0) @binding(0) var<uniform> params: FlowParams;
@group(0) @binding(1) var<storage, read_write> outWords: array<f32>;

@compute @workgroup_size(1)
fn main() {
  outWords[0] = params.mu;
  outWords[1] = params.sigma;
  outWords[2] = params.rho;
  outWords[3] = params.dx;
  outWords[4] = params.gParallelX;
  outWords[5] = params.gParallelY;
  outWords[6] = params.gPerp;
  outWords[7] = params.hMin;
  outWords[8] = params.dt;
  outWords[9] = params.pad0;
  outWords[10] = bitcast<f32>(params.width);
  outWords[11] = bitcast<f32>(params.height);
}
