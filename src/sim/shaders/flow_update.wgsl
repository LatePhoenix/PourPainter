// Explicit thin-film height update with positivity-preserving flux limiter.
//
//   ∂h/∂t = −∇·q
//
// For each cell, α = min(1, available / (outgoing·dt)). Donor α scales each
// shared face (recomputed for the neighbor when the face is an inflow).
// Drain uses limited exterior fluxes. Assert-equivalent: h_new clamped from
// float dust in [-1e-6, 0] → 0.

// FlowParams — keep in sync with src/sim/gpu/flowParams.ts / flow_flux.wgsl
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

struct DrainState {
  // Fixed-point mm³ * 1e6 (micro-mm³), accumulated with atomicAdd.
  micro_mm3: atomic<u32>,
}

@group(0) @binding(0) var<uniform> params: FlowParams;
@group(0) @binding(1) var heightSrc: texture_storage_2d<r32float, read>;
@group(0) @binding(2) var heightDst: texture_storage_2d<r32float, write>;
@group(0) @binding(3) var<storage, read> qx: array<f32>;
@group(0) @binding(4) var<storage, read> qy: array<f32>;
@group(0) @binding(5) var<storage, read_write> drain: DrainState;

fn qxIndex(x: u32, y: u32) -> u32 {
  return y * (params.width + 1u) + x;
}

fn qyIndex(x: u32, y: u32) -> u32 {
  return y * params.width + x;
}

fn sampleH(x: i32, y: i32) -> f32 {
  let w = i32(params.width);
  let h = i32(params.height);
  if (x < 0 || y < 0 || x >= w || y >= h) {
    return 0.0;
  }
  return max(0.0, textureLoad(heightSrc, vec2i(x, y)).r);
}

fn cellAlpha(x: i32, y: i32) -> f32 {
  let w = i32(params.width);
  let h = i32(params.height);
  if (x < 0 || y < 0 || x >= w || y >= h) {
    return 1.0;
  }
  let qxm = qx[qxIndex(u32(x), u32(y))];
  let qxp = qx[qxIndex(u32(x + 1), u32(y))];
  let qym = qy[qyIndex(u32(x), u32(y))];
  let qyp = qy[qyIndex(u32(x), u32(y + 1))];
  var outRate = 0.0;
  let dx = params.dx;
  if (qxp > 0.0) {
    outRate += qxp * dx;
  }
  if (qxm < 0.0) {
    outRate += -qxm * dx;
  }
  if (qyp > 0.0) {
    outRate += qyp * dx;
  }
  if (qym < 0.0) {
    outRate += -qym * dx;
  }
  let available = sampleH(x, y) * dx * dx;
  let outVol = outRate * params.dt;
  if (outVol > available && outRate > 0.0) {
    return available / outVol;
  }
  return 1.0;
}

fn limitQx(xFace: i32, y: i32, q: f32) -> f32 {
  let w = i32(params.width);
  if (q > 0.0 && xFace > 0) {
    return q * cellAlpha(xFace - 1, y);
  }
  if (q < 0.0 && xFace < w) {
    return q * cellAlpha(xFace, y);
  }
  return q;
}

fn limitQy(x: i32, yFace: i32, q: f32) -> f32 {
  let h = i32(params.height);
  if (q > 0.0 && yFace > 0) {
    return q * cellAlpha(x, yFace - 1);
  }
  if (q < 0.0 && yFace < h) {
    return q * cellAlpha(x, yFace);
  }
  return q;
}

fn addDrain(volumeMm3: f32) {
  if (volumeMm3 <= 0.0) {
    return;
  }
  let micro = u32(clamp(volumeMm3 * 1e6, 0.0, 4e9));
  atomicAdd(&drain.micro_mm3, micro);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  let w = i32(params.width);
  let h = i32(params.height);
  if (x >= w || y >= h) {
    return;
  }

  let qxmRaw = qx[qxIndex(u32(x), u32(y))];
  let qxpRaw = qx[qxIndex(u32(x + 1), u32(y))];
  let qymRaw = qy[qyIndex(u32(x), u32(y))];
  let qypRaw = qy[qyIndex(u32(x), u32(y + 1))];

  let qxm = limitQx(x, y, qxmRaw);
  let qxp = limitQx(x + 1, y, qxpRaw);
  let qym = limitQy(x, y, qymRaw);
  let qyp = limitQy(x, y + 1, qypRaw);

  // Exterior drain (limited), owned by the adjacent border cell.
  let dx = params.dx;
  let dt = params.dt;
  if (x == 0) {
    addDrain(max(0.0, -qxm) * dx * dt);
  }
  if (x + 1 == w) {
    addDrain(max(0.0, qxp) * dx * dt);
  }
  if (y == 0) {
    addDrain(max(0.0, -qym) * dx * dt);
  }
  if (y + 1 == h) {
    addDrain(max(0.0, qyp) * dx * dt);
  }

  let invDx = 1.0 / dx;
  let div = (qxp - qxm) * invDx + (qyp - qym) * invDx;
  var hNew = sampleH(x, y) - dt * div;
  // Match CPU: reject catastrophic negatives; float dust → 0.
  if (hNew < -1e-6) {
    hNew = 0.0;
  } else if (hNew < 0.0) {
    hNew = 0.0;
  }

  textureStore(heightDst, vec2i(x, y), vec4f(hNew, 0.0, 0.0, 0.0));
}
