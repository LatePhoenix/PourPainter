// Explicit hydrostatic + upwind-gravity fluxes for the semi-implicit step.
// Capillary (−σ ∇²h) is omitted here and solved by flow_semi_gs.wgsl.
//
//   q_ex = −M ∇(ρ g⊥ h) + M_up ρ g∥
//
// Exterior faces: gravity drain only; inward exterior flux zeroed.
//
// Each cell thread owns its +x and +y faces, and also the −x/−y exterior
// faces when on the border. Writes unlimited fluxes into storage buffers.

// FlowParams — keep in sync with src/sim/gpu/flowParams.ts
// offsets: mu@0 sigma@4 rho@8 dx@12 gParX@16 gParY@20 gPerp@24 hMin@28
//          dt@32 jacobiOmega@36 width@40 height@44  (size 48)
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
@group(0) @binding(2) var<storage, read_write> qx: array<f32>; // (width+1)*height
@group(0) @binding(3) var<storage, read_write> qy: array<f32>; // width*(height+1)

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
  return max(0.0, textureLoad(heightTex, vec2i(x, y)).r);
}

fn sampleHNeumann(x: i32, y: i32) -> f32 {
  let w = i32(params.width);
  let h = i32(params.height);
  let xx = clamp(x, 0, w - 1);
  let yy = clamp(y, 0, h - 1);
  return max(0.0, textureLoad(heightTex, vec2i(xx, yy)).r);
}

fn laplacianH(x: i32, y: i32) -> f32 {
  let hC = sampleHNeumann(x, y);
  let hL = sampleHNeumann(x - 1, y);
  let hR = sampleHNeumann(x + 1, y);
  let hD = sampleHNeumann(x, y - 1);
  let hU = sampleHNeumann(x, y + 1);
  let dx = params.dx;
  return (hL + hR + hD + hU - 4.0 * hC) / (dx * dx);
}

fn pressureAt(x: i32, y: i32) -> f32 {
  let w = i32(params.width);
  let h = i32(params.height);
  let xx = clamp(x, 0, w - 1);
  let yy = clamp(y, 0, h - 1);
  // Hydrostatic only. Capillary pressure is implicit.
  return params.rho * params.gPerp * sampleHNeumann(xx, yy);
}

fn mobilityFromH(h: f32) -> f32 {
  if (h <= 0.0) {
    return 0.0;
  }
  return (h * h * h) / (3.0 * params.mu);
}

fn faceMobilityCentered(hL: f32, hR: f32) -> f32 {
  return mobilityFromH(0.5 * (hL + hR));
}

fn upwindH(hMinus: f32, hPlus: f32, gParallel: f32) -> f32 {
  if (gParallel > 0.0) {
    return hMinus;
  }
  if (gParallel < 0.0) {
    return hPlus;
  }
  return 0.5 * (hMinus + hPlus);
}

fn fluxQxInterior(xFace: i32, y: i32) -> f32 {
  let hL = sampleH(xFace - 1, y);
  let hR = sampleH(xFace, y);
  let Mcenter = faceMobilityCentered(hL, hR);
  let Mgrav = mobilityFromH(upwindH(hL, hR, params.gParallelX));
  let pL = pressureAt(xFace - 1, y);
  let pR = pressureAt(xFace, y);
  let dpdx = (pR - pL) / params.dx;
  return -Mcenter * dpdx + Mgrav * params.rho * params.gParallelX;
}

fn fluxQyInterior(x: i32, yFace: i32) -> f32 {
  let hD = sampleH(x, yFace - 1);
  let hU = sampleH(x, yFace);
  let Mcenter = faceMobilityCentered(hD, hU);
  let Mgrav = mobilityFromH(upwindH(hD, hU, params.gParallelY));
  let pD = pressureAt(x, yFace - 1);
  let pU = pressureAt(x, yFace);
  let dpdy = (pU - pD) / params.dx;
  return -Mcenter * dpdy + Mgrav * params.rho * params.gParallelY;
}

fn fluxQxExterior(xFace: i32, y: i32) -> f32 {
  let w = i32(params.width);
  var hB: f32;
  if (xFace == 0) {
    hB = sampleH(0, y);
  } else {
    hB = sampleH(w - 1, y);
  }
  let Mgrav = mobilityFromH(hB);
  var q = Mgrav * params.rho * params.gParallelX;
  if (xFace == 0 && q > 0.0) {
    q = 0.0;
  }
  if (xFace == w && q < 0.0) {
    q = 0.0;
  }
  return q;
}

fn fluxQyExterior(x: i32, yFace: i32) -> f32 {
  let h = i32(params.height);
  var hB: f32;
  if (yFace == 0) {
    hB = sampleH(x, 0);
  } else {
    hB = sampleH(x, h - 1);
  }
  let Mgrav = mobilityFromH(hB);
  var q = Mgrav * params.rho * params.gParallelY;
  if (yFace == 0 && q > 0.0) {
    q = 0.0;
  }
  if (yFace == h && q < 0.0) {
    q = 0.0;
  }
  return q;
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

  // Right face of this cell (interior or right exterior).
  let xRight = x + 1;
  if (xRight == w) {
    qx[qxIndex(u32(xRight), u32(y))] = fluxQxExterior(xRight, y);
  } else {
    qx[qxIndex(u32(xRight), u32(y))] = fluxQxInterior(xRight, y);
  }

  // Bottom face of this cell (interior or bottom exterior).
  let yBottom = y + 1;
  if (yBottom == h) {
    qy[qyIndex(u32(x), u32(yBottom))] = fluxQyExterior(x, yBottom);
  } else {
    qy[qyIndex(u32(x), u32(yBottom))] = fluxQyInterior(x, yBottom);
  }

  // Left / top exterior faces (owned by border cells).
  if (x == 0) {
    qx[qxIndex(0u, u32(y))] = fluxQxExterior(0, y);
  }
  if (y == 0) {
    qy[qyIndex(u32(x), 0u)] = fluxQyExterior(x, 0);
  }
}
