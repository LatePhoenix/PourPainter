/**
 * Semi-implicit capillary step (ADR 0003). Explicit solver stays in thinFilm.ts.
 *
 * =====================================================================
 * Discretization
 * =====================================================================
 * Split the lubrication flux at a frozen mobility M^n = hⁿ³/(3μ)
 * (centered on faces for pressure, upwind for g∥ — same as M1-01):
 *
 *   q = q_ex(hⁿ) + q_cap(h)
 *   q_ex  = −M ∇(ρ g⊥ h) + M_up ρ g∥          (explicit, hydrostatic + gravity)
 *   q_cap = −M ∇(−σ ∇²h) = M σ ∇(∇²h)         (capillary, backward-Euler)
 *
 * ∇² is the same 5-point stencil as the explicit solver, with Neumann
 * (copy-edge) ghosts. Exterior faces carry gravity drain only: q_cap = 0
 * and inward exterior q_ex = 0.
 *
 * One step solves the linear system (M frozen, so ∇·(M ∇ ∇² ·) is linear)
 *
 *   h* + Δt ∇·q_cap(h*) = hⁿ − Δt ∇·q_ex
 *
 * The update is always the limited flux form, the same commit as the GPU:
 *
 *   hⁿ⁺¹ = hⁿ − Δt ∇·(q_ex + q_cap(h*))
 *
 * with the M1-01 donor limiter. Exterior q_cap is 0. A converged h*
 * matches that update, and volume (canvas + drained) telescopes.
 * After limiting, h ≥ −1e-6.
 *
 * =====================================================================
 * Iteration: damped two-color Jacobi
 * =====================================================================
 * A pair of constant-coefficient Poisson solves does not apply: M varies
 * in space, so ∇·(M ∇ ∇²h) does not factor into two discrete Laplacians
 * we can invert independently. Red and black are updated in turn. The
 * biharmonic stencil reaches the same color (radius 2), so each color is
 * a Jacobi half-sweep: every cell of that color reads the field from the
 * start of the half-sweep. That matches a parallel GPU dispatch.
 *
 * Undamped Jacobi inverts the diagonal exactly,
 *
 *   h_J = (rhs_i − Δt (∇·q_cap − a_ii h_i)) / (1 + Δt a_ii),
 *
 * which is the Jacobi step for (I + Δt A) h = rhs, A = ∇·(M ∇ ∇² ·).
 * It is only conditionally convergent. For constant M the stencil of ∇⁴
 * is the 13-point biharmonic (center 20, axis distance-1: −8, diagonals:
 * +2, axis distance-2: +1) / dx⁴. Its Fourier symbol runs from 0 to
 * 64/dx⁴ — the checkerboard, where λ(∇²) = −8/dx² so λ(∇⁴) = 64/dx⁴.
 * The matrix diagonal is a_ii = 20 M σ / dx⁴, therefore
 *
 *   ρ(D⁻¹ A) = 64/20 = 3.2.
 *
 * At large Δt the undamped error multiplier on a mode with symbol β is
 * 1 − β, and β reaches 3.2, so the multiplier reaches −2.2. That is the
 * divergence past ~75× the explicit capillary Δt.
 *
 * Damped Jacobi mixes the old value back in:
 *
 *   h ← (1 − ω) h + ω h_J.
 *
 * At large Δt the multiplier is 1 − ω β. |1 − ω β| < 1 for every
 * β ∈ (0, 3.2] if and only if 0 < ω < 2/3.2 = 0.625. At finite Δt the
 * multiplier is a convex combination of 1 and 1 − β, so the same ω
 * still keeps it inside (−1, 1]. The kernel mode β = 0 stays at 1,
 * which is correct: constants are invisible to ∇⁴.
 *
 * ω = 1/2. Worst-mode factor |1 − 0.5 × 3.2| = 0.6 per pair.
 * `SEMI_IMPLICIT_SWEEPS` = 20 pairs, which contracts the stiffest mode
 * by 0.6²⁰ ≈ 4×10⁻⁵. The flux-form commit multiplies leftover residual
 * by Δt a_ii, so 20 pairs are not bounded at 200× or 1000×. The
 * scheduler never chooses those steps: Δt stays at or below
 * `SEMI_IMPLICIT_ACCURACY_FACTOR` (64) × the explicit capillary Δt, and
 * `thinFilmSubstepSemiImplicit` throws past that cap (10% tolerance).
 * 20 pairs keep a 20% noise film bounded at 128×, two times the cap.
 * Neumann ghosts fold off-diagonals into the diagonal, which lowers the
 * local radius. ω = 1/2 sits 0.125 under the 0.625 bound for the cases
 * where M varies from cell to cell.
 *
 * Δt is not limited by Δ⁴/(32 M σ) for convergence. `maxStableDtSemiImplicit`
 * uses the hydrostatic and advective bounds, plus the accuracy factor
 * times the explicit capillary Δt. That factor is only an accuracy cap
 * on the frozen-M linearization.
 */

import { copyGrid, createGrid2D, totalVolume, type Grid2D } from './grid';
import { maxStableDt, type ThinFilmParams, type ThinFilmState } from './thinFilm';

/** Full red+black pairs per step. Shared with the GPU port. */
export const SEMI_IMPLICIT_SWEEPS = 20;

/**
 * Damping for the two-color Jacobi solve. Shared with the GPU uniform.
 * Derived above: any ω in (0, 2/3.2) converges; 1/2 leaves the stiffest
 * mode at factor 0.6.
 */
export const SEMI_IMPLICIT_JACOBI_OMEGA = 0.5;

/**
 * Accuracy cap: semi-implicit Δt ≤ this × the explicit capillary Δt.
 * Not a stability limit — damped Jacobi converges at any Δt. It keeps the
 * frozen-mobility linearization from drifting off the nonlinear film.
 */
export const SEMI_IMPLICIT_ACCURACY_FACTOR = 64;

/**
 * Slack on the accuracy cap so a dt taken from a rounded hMax hint is
 * not rejected. A step above `ACCURACY_FACTOR × capillary Δt × this`
 * is refused.
 */
export const SEMI_IMPLICIT_DT_TOLERANCE = 1.1;

/** Throw when `dt` is past the accuracy cap of this capillary Δt. */
export function assertSemiImplicitDt(dt: number, capillaryDt: number): void {
  const limit = SEMI_IMPLICIT_ACCURACY_FACTOR * capillaryDt * SEMI_IMPLICIT_DT_TOLERANCE;
  if (!(dt <= limit)) {
    throw new Error(
      `semi-implicit dt ${dt} s exceeds ${SEMI_IMPLICIT_ACCURACY_FACTOR}× the explicit capillary dt (limit ${limit} s)`,
    );
  }
}

function clampCoord(n: number, i: number): number {
  return Math.min(n - 1, Math.max(0, i));
}

/** Neumann sample: out-of-range indices copy the edge cell. */
function hAt(field: Float64Array, w: number, h: number, x: number, y: number): number {
  const xx = clampCoord(w, x);
  const yy = clampCoord(h, y);
  return Math.max(0, field[yy * w + xx]!);
}

function laplacian(
  field: Float64Array,
  w: number,
  h: number,
  x: number,
  y: number,
  dx: number,
): number {
  const xx = clampCoord(w, x);
  const yy = clampCoord(h, y);
  const c = hAt(field, w, h, xx, yy);
  const l = hAt(field, w, h, xx - 1, yy);
  const r = hAt(field, w, h, xx + 1, yy);
  const d = hAt(field, w, h, xx, yy - 1);
  const u = hAt(field, w, h, xx, yy + 1);
  return (l + r + d + u - 4 * c) / (dx * dx);
}

/**
 * ∂(∇² at target)/∂(h at variable), Neumann ghosts included.
 * A ghost that aliases onto `variable` contributes to the derivative.
 */
function dLapDh(
  w: number,
  h: number,
  targetX: number,
  targetY: number,
  varX: number,
  varY: number,
  dx: number,
): number {
  const tx = clampCoord(w, targetX);
  const ty = clampCoord(h, targetY);
  const samples: readonly (readonly [number, number, number])[] = [
    [tx, ty, -4],
    [tx - 1, ty, 1],
    [tx + 1, ty, 1],
    [tx, ty - 1, 1],
    [tx, ty + 1, 1],
  ];
  let coeff = 0;
  for (const [sx, sy, weight] of samples) {
    if (clampCoord(w, sx) === varX && clampCoord(h, sy) === varY) {
      coeff += weight;
    }
  }
  return coeff / (dx * dx);
}

function mobilityFromH(hv: number, mu: number): number {
  if (hv <= 0) return 0;
  return (hv * hv * hv) / (3 * mu);
}

function upwindH(hMinus: number, hPlus: number, gParallel: number): number {
  if (gParallel > 0) return hMinus;
  if (gParallel < 0) return hPlus;
  return 0.5 * (hMinus + hPlus);
}

function fieldFromGrid(grid: Grid2D): Float64Array {
  return Float64Array.from(grid.data);
}

/** Explicit hydrostatic + upwind-gravity face fluxes (no capillary). */
function explicitFluxes(
  h0: Float64Array,
  w: number,
  gridH: number,
  params: ThinFilmParams,
): { qx: Float64Array; qy: Float64Array } {
  const { dx, mu, rho, gParallelX, gParallelY, gPerp } = params;
  const invDx = 1 / dx;
  const qx = new Float64Array((w + 1) * gridH);
  const qy = new Float64Array(w * (gridH + 1));

  const pHydro = (x: number, y: number): number => {
    const xx = clampCoord(w, x);
    const yy = clampCoord(gridH, y);
    return rho * gPerp * hAt(h0, w, gridH, xx, yy);
  };

  for (let y = 0; y < gridH; y += 1) {
    for (let x = 0; x <= w; x += 1) {
      if (x === 0 || x === w) {
        const hB = hAt(h0, w, gridH, x === 0 ? 0 : w - 1, y);
        let q = mobilityFromH(hB, mu) * rho * gParallelX;
        if (x === 0 && q > 0) q = 0;
        if (x === w && q < 0) q = 0;
        qx[y * (w + 1) + x] = q;
        continue;
      }
      const hL = hAt(h0, w, gridH, x - 1, y);
      const hR = hAt(h0, w, gridH, x, y);
      const Mc = mobilityFromH(0.5 * (hL + hR), mu);
      const Mg = mobilityFromH(upwindH(hL, hR, gParallelX), mu);
      const dp = (pHydro(x, y) - pHydro(x - 1, y)) * invDx;
      qx[y * (w + 1) + x] = -Mc * dp + Mg * rho * gParallelX;
    }
  }

  for (let y = 0; y <= gridH; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (y === 0 || y === gridH) {
        const hB = hAt(h0, w, gridH, x, y === 0 ? 0 : gridH - 1);
        let q = mobilityFromH(hB, mu) * rho * gParallelY;
        if (y === 0 && q > 0) q = 0;
        if (y === gridH && q < 0) q = 0;
        qy[y * w + x] = q;
        continue;
      }
      const hD = hAt(h0, w, gridH, x, y - 1);
      const hU = hAt(h0, w, gridH, x, y);
      const Mc = mobilityFromH(0.5 * (hD + hU), mu);
      const Mg = mobilityFromH(upwindH(hD, hU, gParallelY), mu);
      const dp = (pHydro(x, y) - pHydro(x, y - 1)) * invDx;
      qy[y * w + x] = -Mc * dp + Mg * rho * gParallelY;
    }
  }

  return { qx, qy };
}

function faceMobilityX(
  h0: Float64Array,
  w: number,
  gridH: number,
  xFace: number,
  y: number,
  mu: number,
): number {
  if (xFace <= 0 || xFace >= w) return 0;
  const hL = hAt(h0, w, gridH, xFace - 1, y);
  const hR = hAt(h0, w, gridH, xFace, y);
  return mobilityFromH(0.5 * (hL + hR), mu);
}

function faceMobilityY(
  h0: Float64Array,
  w: number,
  gridH: number,
  x: number,
  yFace: number,
  mu: number,
): number {
  if (yFace <= 0 || yFace >= gridH) return 0;
  const hD = hAt(h0, w, gridH, x, yFace - 1);
  const hU = hAt(h0, w, gridH, x, yFace);
  return mobilityFromH(0.5 * (hD + hU), mu);
}

/** q_cap on an interior vertical face; 0 on the border. */
function capFluxX(
  field: Float64Array,
  h0: Float64Array,
  w: number,
  gridH: number,
  xFace: number,
  y: number,
  params: ThinFilmParams,
): number {
  if (xFace <= 0 || xFace >= w || params.sigma === 0) return 0;
  const M = faceMobilityX(h0, w, gridH, xFace, y, params.mu);
  const lapL = laplacian(field, w, gridH, xFace - 1, y, params.dx);
  const lapR = laplacian(field, w, gridH, xFace, y, params.dx);
  return (M * params.sigma * (lapR - lapL)) / params.dx;
}

function capFluxY(
  field: Float64Array,
  h0: Float64Array,
  w: number,
  gridH: number,
  x: number,
  yFace: number,
  params: ThinFilmParams,
): number {
  if (yFace <= 0 || yFace >= gridH || params.sigma === 0) return 0;
  const M = faceMobilityY(h0, w, gridH, x, yFace, params.mu);
  const lapD = laplacian(field, w, gridH, x, yFace - 1, params.dx);
  const lapU = laplacian(field, w, gridH, x, yFace, params.dx);
  return (M * params.sigma * (lapU - lapD)) / params.dx;
}

export function capillaryDivergence(
  field: Float64Array,
  h0: Float64Array,
  w: number,
  gridH: number,
  x: number,
  y: number,
  params: ThinFilmParams,
): number {
  const invDx = 1 / params.dx;
  const qxm = capFluxX(field, h0, w, gridH, x, y, params);
  const qxp = capFluxX(field, h0, w, gridH, x + 1, y, params);
  const qym = capFluxY(field, h0, w, gridH, x, y, params);
  const qyp = capFluxY(field, h0, w, gridH, x, y + 1, params);
  return (qxp - qxm) * invDx + (qyp - qym) * invDx;
}

/** ∂(∇·q_cap)/∂h_(x,y) with frozen M and Neumann ghosts. */
export function capillaryDiagonal(
  h0: Float64Array,
  w: number,
  gridH: number,
  x: number,
  y: number,
  params: ThinFilmParams,
): number {
  const { dx, sigma, mu } = params;
  if (sigma === 0) return 0;
  const invDx = 1 / dx;
  let dDiv = 0;

  const facesX: readonly number[] = [x, x + 1];
  for (const xFace of facesX) {
    if (xFace <= 0 || xFace >= w) continue;
    const M = faceMobilityX(h0, w, gridH, xFace, y, mu);
    const dLap = dLapDh(w, gridH, xFace, y, x, y, dx) - dLapDh(w, gridH, xFace - 1, y, x, y, dx);
    const dq = (M * sigma * dLap) / dx;
    const sign = xFace === x + 1 ? 1 : -1;
    dDiv += sign * dq * invDx;
  }

  const facesY: readonly number[] = [y, y + 1];
  for (const yFace of facesY) {
    if (yFace <= 0 || yFace >= gridH) continue;
    const M = faceMobilityY(h0, w, gridH, x, yFace, mu);
    const dLap = dLapDh(w, gridH, x, yFace, x, y, dx) - dLapDh(w, gridH, x, yFace - 1, x, y, dx);
    const dq = (M * sigma * dLap) / dx;
    const sign = yFace === y + 1 ? 1 : -1;
    dDiv += sign * dq * invDx;
  }
  return dDiv;
}

function applyLimiter(
  qx: Float64Array,
  qy: Float64Array,
  h0: Float64Array,
  w: number,
  gridH: number,
  dx: number,
  dt: number,
): void {
  const alpha = new Float64Array(w * gridH);
  for (let y = 0; y < gridH; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const qxm = qx[y * (w + 1) + x]!;
      const qxp = qx[y * (w + 1) + x + 1]!;
      const qym = qy[y * w + x]!;
      const qyp = qy[(y + 1) * w + x]!;
      let outRate = 0;
      if (qxp > 0) outRate += qxp * dx;
      if (qxm < 0) outRate += -qxm * dx;
      if (qyp > 0) outRate += qyp * dx;
      if (qym < 0) outRate += -qym * dx;
      const available = Math.max(0, h0[y * w + x]!) * dx * dx;
      const outVol = outRate * dt;
      alpha[y * w + x] = outVol > available && outRate > 0 ? available / outVol : 1;
    }
  }
  for (let y = 0; y < gridH; y += 1) {
    for (let x = 0; x <= w; x += 1) {
      const idx = y * (w + 1) + x;
      let q = qx[idx]!;
      if (q > 0 && x > 0) q *= alpha[y * w + (x - 1)]!;
      else if (q < 0 && x < w) q *= alpha[y * w + x]!;
      qx[idx] = q;
    }
  }
  for (let y = 0; y <= gridH; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      let q = qy[idx]!;
      if (q > 0 && y > 0) q *= alpha[(y - 1) * w + x]!;
      else if (q < 0 && y < gridH) q *= alpha[y * w + x]!;
      qy[idx] = q;
    }
  }
}

/**
 * Stable Δt without the capillary Δ⁴ bound: hydrostatic, advective, and
 * an accuracy cap of `SEMI_IMPLICIT_ACCURACY_FACTOR` × the explicit
 * capillary Δt. Damping makes the inner solve convergent past that cap.
 */
export function maxStableDtSemiImplicit(height: Grid2D, params: ThinFilmParams): number {
  const { mu, sigma, rho, dx, gParallelX, gParallelY, gPerp, hMin, dtSafety } = params;
  if (!(dx > 0) || !(mu > 0)) throw new RangeError('dx and mu must be positive');
  if (!(dtSafety > 0) || dtSafety > 1) throw new RangeError('dtSafety must be in (0, 1]');

  let hMax = hMin;
  for (let i = 0; i < height.data.length; i += 1) {
    const hv = height.data[i]!;
    if (hv > hMax) hMax = hv;
  }
  const M = (hMax * hMax * hMax) / (3 * mu);
  const dtCap =
    sigma > 0
      ? (SEMI_IMPLICIT_ACCURACY_FACTOR * (dx * dx * dx * dx)) / (32 * M * sigma)
      : Number.POSITIVE_INFINITY;
  const dtGrav =
    rho > 0 && gPerp !== 0 ? (dx * dx) / (4 * M * rho * Math.abs(gPerp)) : Number.POSITIVE_INFINITY;
  const gPar = Math.hypot(gParallelX, gParallelY);
  const waveSpeed = (hMax * hMax * rho * gPar) / mu;
  const dtAdv = waveSpeed > 0 ? dx / waveSpeed : Number.POSITIVE_INFINITY;
  const dt = dtSafety * Math.min(dtCap, dtGrav, dtAdv);
  if (!Number.isFinite(dt) || dt <= 0) return dtSafety * 1e-3;
  return dt;
}

/** Explicit capillary Δt (Δ⁴/32Mσ) for tests that scale it. */
export function explicitCapillaryDt(height: Grid2D, params: ThinFilmParams): number {
  const onlyCap: ThinFilmParams = {
    ...params,
    dtSafety: 1,
    gPerp: 0,
    gParallelX: 0,
    gParallelY: 0,
  };
  return maxStableDt(height, onlyCap);
}

/** Same capillary Δt from an hMax hint, without a full grid. */
export function explicitCapillaryDtFromHMax(hMax: number, params: ThinFilmParams): number {
  return explicitCapillaryDt(createGrid2D(1, 1, hMax), params);
}

/**
 * One semi-implicit step of size `dt`. Refuses a dt above the accuracy
 * cap of the current field (see `assertSemiImplicitDt`). Mutates height
 * and drainedVolume.
 */
export function thinFilmSubstepSemiImplicit(
  state: ThinFilmState,
  dt: number,
  params: ThinFilmParams,
): void {
  if (!(dt > 0) || !Number.isFinite(dt)) {
    throw new RangeError('dt must be a positive finite number');
  }
  assertSemiImplicitDt(dt, explicitCapillaryDt(state.height, params));
  commitSemiImplicitSubstep(state, dt, params);
}

/**
 * Limited-flux semi-implicit step with no accuracy-cap check.
 * `thinFilmSubstepSemiImplicit` is the caller-facing entry. The 128×
 * regression calls this directly because 128× is past the cap on purpose.
 */
export function commitSemiImplicitSubstep(
  state: ThinFilmState,
  dt: number,
  params: ThinFilmParams,
): void {
  if (!(dt > 0) || !Number.isFinite(dt)) {
    throw new RangeError('dt must be a positive finite number');
  }
  const { height } = state;
  const w = height.width;
  const gridH = height.height;
  const h0 = fieldFromGrid(height);
  const { qx, qy } = explicitFluxes(h0, w, gridH, params);
  const invDx = 1 / params.dx;

  const rhs = new Float64Array(w * gridH);
  for (let y = 0; y < gridH; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const qxm = qx[y * (w + 1) + x]!;
      const qxp = qx[y * (w + 1) + x + 1]!;
      const qym = qy[y * w + x]!;
      const qyp = qy[(y + 1) * w + x]!;
      const divEx = (qxp - qxm) * invDx + (qyp - qym) * invDx;
      rhs[y * w + x] = h0[y * w + x]! - dt * divEx;
    }
  }

  const diag = new Float64Array(w * gridH);
  for (let y = 0; y < gridH; y += 1) {
    for (let x = 0; x < w; x += 1) {
      diag[y * w + x] = capillaryDiagonal(h0, w, gridH, x, y, params);
    }
  }

  const hStar = Float64Array.from(h0);
  const updated = new Float64Array(hStar.length);
  for (let sweep = 0; sweep < SEMI_IMPLICIT_SWEEPS; sweep += 1) {
    for (const color of [0, 1]) {
      updated.set(hStar);
      for (let y = 0; y < gridH; y += 1) {
        for (let x = 0; x < w; x += 1) {
          if ((x + y) % 2 !== color) continue;
          const i = y * w + x;
          const divC = capillaryDivergence(hStar, h0, w, gridH, x, y, params);
          const a = diag[i]!;
          const hi = hStar[i]!;
          const off = divC - a * hi;
          const denom = 1 + dt * a;
          const jacobi = denom !== 0 ? (rhs[i]! - dt * off) / denom : rhs[i]!;
          updated[i] = hi + SEMI_IMPLICIT_JACOBI_OMEGA * (jacobi - hi);
        }
      }
      hStar.set(updated);
    }
  }

  const dx = params.dx;
  for (let y = 0; y < gridH; y += 1) {
    for (let x = 0; x <= w; x += 1) {
      qx[y * (w + 1) + x]! += capFluxX(hStar, h0, w, gridH, x, y, params);
    }
  }
  for (let y = 0; y <= gridH; y += 1) {
    for (let x = 0; x < w; x += 1) {
      qy[y * w + x]! += capFluxY(hStar, h0, w, gridH, x, y, params);
    }
  }
  applyLimiter(qx, qy, h0, w, gridH, dx, dt);

  let drained = 0;
  for (let y = 0; y < gridH; y += 1) {
    const qLeft = qx[y * (w + 1)]!;
    const qRight = qx[y * (w + 1) + w]!;
    drained += Math.max(0, -qLeft) * dx * dt;
    drained += Math.max(0, qRight) * dx * dt;
  }
  for (let x = 0; x < w; x += 1) {
    const qTop = qy[x]!;
    const qBottom = qy[gridH * w + x]!;
    drained += Math.max(0, -qTop) * dx * dt;
    drained += Math.max(0, qBottom) * dx * dt;
  }
  state.drainedVolume += drained;

  const next = createGrid2D(w, gridH);
  for (let y = 0; y < gridH; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const qxm = qx[y * (w + 1) + x]!;
      const qxp = qx[y * (w + 1) + x + 1]!;
      const qym = qy[y * w + x]!;
      const qyp = qy[(y + 1) * w + x]!;
      const div = (qxp - qxm) * invDx + (qyp - qym) * invDx;
      const hNew = h0[y * w + x]! - dt * div;
      if (!(hNew >= -1e-6)) {
        throw new Error(`thinFilmSubstepSemiImplicit: height ${hNew} < -1e-6 at (${x},${y})`);
      }
      next.data[y * w + x] = hNew > 0 ? hNew : 0;
    }
  }
  height.data.set(next.data);
}

/** Advance `dt` seconds with hydrostatic / advective / accuracy substeps. */
export function thinFilmStepSemiImplicit(
  state: ThinFilmState,
  dt: number,
  params: ThinFilmParams,
): number {
  if (!(dt >= 0) || !Number.isFinite(dt)) {
    throw new RangeError('dt must be a non-negative finite number');
  }
  if (dt === 0) return 0;
  let remaining = dt;
  let substeps = 0;
  const maxSubsteps = 100_000;
  while (remaining > 0) {
    if (substeps >= maxSubsteps) {
      throw new Error(`thinFilmStepSemiImplicit exceeded ${maxSubsteps} substeps`);
    }
    const dtMax = maxStableDtSemiImplicit(state.height, params);
    const sub = Math.min(remaining, dtMax);
    thinFilmSubstepSemiImplicit(state, sub, params);
    remaining -= sub;
    substeps += 1;
  }
  return substeps;
}

export function cloneState(state: ThinFilmState): ThinFilmState {
  return { height: copyGrid(state.height), drainedVolume: state.drainedVolume };
}

export function volumeOf(state: ThinFilmState, dx: number): number {
  return totalVolume(state.height, dx * dx) + state.drainedVolume;
}
