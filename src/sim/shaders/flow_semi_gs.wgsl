// One red or black Jacobi color for the semi-implicit capillary step.
// See src/sim/cpu/thinFilmSemi.ts for the discretization and the ω bound.
//
//   h_J = (rhs_i − Δt (∇·q_cap − a_ii h_i)) / (1 + Δt a_ii)
//   h  ← (1 − ω) h + ω h_J
//   rhs_i = hⁿ_i − Δt ∇·q_ex
//
// ω is params.jacobiOmega (SEMI_IMPLICIT_JACOBI_OMEGA). q_ex is already in
// qx/qy. Mobility is frozen from hⁿ (the texture). h* lives in `iterate`.
// Two entry points so the color is not a uniform (a uniform rewrite would
// race inside one command buffer). Width must be even so each row has
// width/2 cells of each color.

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
@group(0) @binding(1) var height0: texture_storage_2d<r32float, read>;
@group(0) @binding(2) var<storage, read_write> iterate: array<f32>;
@group(0) @binding(3) var<storage, read> qx: array<f32>;
@group(0) @binding(4) var<storage, read> qy: array<f32>;

fn h0At(x: i32, y: i32) -> f32 {
  let w = i32(params.width);
  let h = i32(params.height);
  let xx = clamp(x, 0, w - 1);
  let yy = clamp(y, 0, h - 1);
  return max(0.0, textureLoad(height0, vec2i(xx, yy)).r);
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

fn dLapDh(targetX: i32, targetY: i32, varX: i32, varY: i32) -> f32 {
  let w = i32(params.width);
  let h = i32(params.height);
  let cx = clamp(targetX, 0, w - 1);
  let cy = clamp(targetY, 0, h - 1);
  var coeff = 0.0;
  if (cx == varX && cy == varY) {
    coeff -= 4.0;
  }
  if (clamp(cx - 1, 0, w - 1) == varX && cy == varY) {
    coeff += 1.0;
  }
  if (clamp(cx + 1, 0, w - 1) == varX && cy == varY) {
    coeff += 1.0;
  }
  if (cx == varX && clamp(cy - 1, 0, h - 1) == varY) {
    coeff += 1.0;
  }
  if (cx == varX && clamp(cy + 1, 0, h - 1) == varY) {
    coeff += 1.0;
  }
  let dx = params.dx;
  return coeff / (dx * dx);
}

fn mobilityFromH(hv: f32) -> f32 {
  if (hv <= 0.0) {
    return 0.0;
  }
  return (hv * hv * hv) / (3.0 * params.mu);
}

fn faceMX(xFace: i32, y: i32) -> f32 {
  let w = i32(params.width);
  if (xFace <= 0 || xFace >= w) {
    return 0.0;
  }
  return mobilityFromH(0.5 * (h0At(xFace - 1, y) + h0At(xFace, y)));
}

fn faceMY(x: i32, yFace: i32) -> f32 {
  let h = i32(params.height);
  if (yFace <= 0 || yFace >= h) {
    return 0.0;
  }
  return mobilityFromH(0.5 * (h0At(x, yFace - 1) + h0At(x, yFace)));
}

fn capFluxX(xFace: i32, y: i32) -> f32 {
  let w = i32(params.width);
  if (xFace <= 0 || xFace >= w || params.sigma == 0.0) {
    return 0.0;
  }
  let m = faceMX(xFace, y);
  return m * params.sigma * (lapStar(xFace, y) - lapStar(xFace - 1, y)) / params.dx;
}

fn capFluxY(x: i32, yFace: i32) -> f32 {
  let h = i32(params.height);
  if (yFace <= 0 || yFace >= h || params.sigma == 0.0) {
    return 0.0;
  }
  let m = faceMY(x, yFace);
  return m * params.sigma * (lapStar(x, yFace) - lapStar(x, yFace - 1)) / params.dx;
}

fn divCap(x: i32, y: i32) -> f32 {
  let inv = 1.0 / params.dx;
  return (capFluxX(x + 1, y) - capFluxX(x, y)) * inv + (capFluxY(x, y + 1) - capFluxY(x, y)) * inv;
}

fn diagonal(x: i32, y: i32) -> f32 {
  if (params.sigma == 0.0) {
    return 0.0;
  }
  let dx = params.dx;
  let inv = 1.0 / dx;
  var dDiv = 0.0;
  let w = i32(params.width);
  let h = i32(params.height);
  if (x > 0) {
    let m = faceMX(x, y);
    let dLap = dLapDh(x, y, x, y) - dLapDh(x - 1, y, x, y);
    let dq = m * params.sigma * dLap / dx;
    dDiv += -dq * inv;
  }
  if (x + 1 < w) {
    let m = faceMX(x + 1, y);
    let dLap = dLapDh(x + 1, y, x, y) - dLapDh(x, y, x, y);
    let dq = m * params.sigma * dLap / dx;
    dDiv += dq * inv;
  }
  if (y > 0) {
    let m = faceMY(x, y);
    let dLap = dLapDh(x, y, x, y) - dLapDh(x, y - 1, x, y);
    let dq = m * params.sigma * dLap / dx;
    dDiv += -dq * inv;
  }
  if (y + 1 < h) {
    let m = faceMY(x, y + 1);
    let dLap = dLapDh(x, y + 1, x, y) - dLapDh(x, y, x, y);
    let dq = m * params.sigma * dLap / dx;
    dDiv += dq * inv;
  }
  return dDiv;
}

fn divExplicit(x: i32, y: i32) -> f32 {
  let qxm = qx[u32(y) * (params.width + 1u) + u32(x)];
  let qxp = qx[u32(y) * (params.width + 1u) + u32(x + 1)];
  let qym = qy[u32(y) * params.width + u32(x)];
  let qyp = qy[u32(y + 1) * params.width + u32(x)];
  let inv = 1.0 / params.dx;
  return (qxp - qxm) * inv + (qyp - qym) * inv;
}

fn sweep(linear: u32, color: u32) {
  let half = params.width / 2u;
  let n = half * params.height;
  if (linear >= n || half == 0u) {
    return;
  }
  let row = linear / half;
  let col = linear % half;
  let x = i32(col * 2u + ((row + color) % 2u));
  let y = i32(row);
  let idx = row * params.width + u32(x);
  let h0 = h0At(x, y);
  let rhs = h0 - params.dt * divExplicit(x, y);
  let divC = divCap(x, y);
  let a = diagonal(x, y);
  let hi = hStar(x, y);
  let off = divC - a * hi;
  let denom = 1.0 + params.dt * a;
  let jacobi = (rhs - params.dt * off) / denom;
  iterate[idx] = hi + params.jacobiOmega * (jacobi - hi);
}

@compute @workgroup_size(64)
fn sweep_even(@builtin(global_invocation_id) gid: vec3u) {
  sweep(gid.x, 0u);
}

@compute @workgroup_size(64)
fn sweep_odd(@builtin(global_invocation_id) gid: vec3u) {
  sweep(gid.x, 1u);
}
