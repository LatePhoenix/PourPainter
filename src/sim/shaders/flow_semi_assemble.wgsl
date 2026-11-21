// Commit the semi-implicit step as a limited finite-volume update from hⁿ:
//   q = q_ex + q_cap(h*)
//   hⁿ⁺¹ = hⁿ − Δt ∇·q
// Donor limiter matches M1-01. Exterior capillary flux is 0 (already, faces
// on the border). Drain uses the limited exterior fluxes.

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

struct DrainState {
  micro_mm3: atomic<u32>,
}

@group(0) @binding(0) var<uniform> params: FlowParams;
@group(0) @binding(1) var heightSrc: texture_storage_2d<r32float, read>;
@group(0) @binding(2) var heightDst: texture_storage_2d<r32float, write>;
@group(0) @binding(3) var<storage, read> qx: array<f32>;
@group(0) @binding(4) var<storage, read> qy: array<f32>;
@group(0) @binding(5) var<storage, read_write> drain: DrainState;
@group(0) @binding(6) var<storage, read> iterate: array<f32>;

fn h0At(x: i32, y: i32) -> f32 {
  let w = i32(params.width);
  let h = i32(params.height);
  if (x < 0 || y < 0 || x >= w || y >= h) {
    return 0.0;
  }
  return max(0.0, textureLoad(heightSrc, vec2i(x, y)).r);
}

fn hStar(x: i32, y: i32) -> f32 {
  let w = i32(params.width);
  let h = i32(params.height);
  let xx = clamp(x, 0, w - 1);
  let yy = clamp(y, 0, h - 1);
  return max(0.0, iterate[u32(yy) * params.width + u32(xx)]);
}

fn lapStar(x: i32, y: i32) -> f32 {
  let w = i32(params.width);
  let h = i32(params.height);
  let xx = clamp(x, 0, w - 1);
  let yy = clamp(y, 0, h - 1);
  let c = hStar(xx, yy);
  let l = hStar(xx - 1, yy);
  let r = hStar(xx + 1, yy);
  let d = hStar(xx, yy - 1);
  let u = hStar(xx, yy + 1);
  let dx = params.dx;
  return (l + r + d + u - 4.0 * c) / (dx * dx);
}

fn mobilityFromH(hv: f32) -> f32 {
  if (hv <= 0.0) {
    return 0.0;
  }
  return (hv * hv * hv) / (3.0 * params.mu);
}

fn capFluxX(xFace: i32, y: i32) -> f32 {
  let w = i32(params.width);
  if (xFace <= 0 || xFace >= w || params.sigma == 0.0) {
    return 0.0;
  }
  let m = mobilityFromH(0.5 * (h0At(xFace - 1, y) + h0At(xFace, y)));
  return m * params.sigma * (lapStar(xFace, y) - lapStar(xFace - 1, y)) / params.dx;
}

fn capFluxY(x: i32, yFace: i32) -> f32 {
  let h = i32(params.height);
  if (yFace <= 0 || yFace >= h || params.sigma == 0.0) {
    return 0.0;
  }
  let m = mobilityFromH(0.5 * (h0At(x, yFace - 1) + h0At(x, yFace)));
  return m * params.sigma * (lapStar(x, yFace) - lapStar(x, yFace - 1)) / params.dx;
}

fn qX(xFace: i32, y: i32) -> f32 {
  let raw = qx[u32(y) * (params.width + 1u) + u32(xFace)];
  return raw + capFluxX(xFace, y);
}

fn qY(x: i32, yFace: i32) -> f32 {
  let raw = qy[u32(yFace) * params.width + u32(x)];
  return raw + capFluxY(x, yFace);
}

fn cellAlpha(x: i32, y: i32) -> f32 {
  let w = i32(params.width);
  let h = i32(params.height);
  if (x < 0 || y < 0 || x >= w || y >= h) {
    return 1.0;
  }
  let qxm = qX(x, y);
  let qxp = qX(x + 1, y);
  let qym = qY(x, y);
  let qyp = qY(x, y + 1);
  var outRate = 0.0;
  let dx = params.dx;
  if (qxp > 0.0) { outRate += qxp * dx; }
  if (qxm < 0.0) { outRate += -qxm * dx; }
  if (qyp > 0.0) { outRate += qyp * dx; }
  if (qym < 0.0) { outRate += -qym * dx; }
  let available = h0At(x, y) * dx * dx;
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

  let qxm = limitQx(x, y, qX(x, y));
  let qxp = limitQx(x + 1, y, qX(x + 1, y));
  let qym = limitQy(x, y, qY(x, y));
  let qyp = limitQy(x, y + 1, qY(x, y + 1));

  let dx = params.dx;
  let dt = params.dt;
  if (x == 0) { addDrain(max(0.0, -qxm) * dx * dt); }
  if (x + 1 == w) { addDrain(max(0.0, qxp) * dx * dt); }
  if (y == 0) { addDrain(max(0.0, -qym) * dx * dt); }
  if (y + 1 == h) { addDrain(max(0.0, qyp) * dx * dt); }

  let div = (qxp - qxm) / dx + (qyp - qym) / dx;
  var hNew = h0At(x, y) - dt * div;
  if (hNew < 0.0) {
    hNew = 0.0;
  }
  textureStore(heightDst, vec2i(x, y), vec4f(hNew, 0.0, 0.0, 0.0));
}
