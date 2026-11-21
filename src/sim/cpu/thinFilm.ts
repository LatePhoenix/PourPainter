/**
 * CPU reference: single-fluid thin-film (lubrication) solver.
 *
 * =====================================================================
 * Derivation (mm–g–s; see docs/PLAN.md §2.2 and src/domain/physics.ts)
 * =====================================================================
 *
 * Units: length mm, mass g, time s
 *   → pressure p : g/(mm·s²) = Pa
 *   → viscosity μ : g/(mm·s) = Pa·s
 *   → surface tension σ : g/s² = mN/m
 *   → density ρ : g/mm³
 *   → gravity g : mm/s²
 *
 * A paint film of thickness h(x,y,t) ≪ horizontal scale sits on a flat canvas.
 * With no-slip at the substrate and a free surface, the lubrication (Reynolds)
 * approximation integrates Stokes flow across the film and yields a depth-
 * averaged horizontal flux (volume per time per transverse width):
 *
 *   q = − (h³ / 3μ) (∇p − ρ · g∥)          [mm²/s]
 *
 * Gauge pressure in the film combines hydrostatic head from the canvas-normal
 * gravity component g⊥ with capillary (Young–Laplace) pressure from surface
 * curvature ≈ ∇²h:
 *
 *   p = ρ · g⊥ · h − σ ∇²h                 [g/(mm·s²)]
 *
 * Here g∥ = (g_x, g_y) is gravity projected into the canvas plane (drives
 * downhill flow under tilt) and g⊥ ≥ 0 is the magnitude of the normal
 * component (restoring / spreading). On a level canvas, g∥ = 0 and
 * g⊥ = |g|; tilting rotates g into the plane.
 *
 * Mass conservation for an incompressible film is
 *
 *   ∂h/∂t + ∇·q = 0    ⇒    ∂h/∂t = −∇·q.
 *
 * Capillary terms make this a nonlinear fourth-order PDE; hydrostatic tilt
 * adds second-order nonlinear diffusion; in-plane gravity adds an advective
 * character. Edges are open: flux through the domain border leaves the
 * system and is accumulated as drainedVolume (mm³).
 *
 * ---------------------------------------------------------------------
 * Explicit stable Δt (substepped)
 * ---------------------------------------------------------------------
 * With mobility scale M = h_max³ / (3μ) and cell size Δ:
 *
 *   Capillary (∇⁴):     Δt ≲ Δ⁴ / (8 M σ)
 *   Hydrostatic (∇²):   Δt ≲ Δ² / (4 M ρ |g⊥|)
 *   Advective (|u|~M ρ |g∥| / h):
 *                       Δt ≲ Δ / u_max ,  u_max = h_max² ρ |g∥| / (3μ)
 *
 * A safety factor (< 1) is applied; a requested frame dt is split into
 * uniform substeps of size ≤ that limit.
 */

import {
  BASE_VISCOSITY_PA_S,
  DEFAULT_PAINT_DENSITY_G_MM3,
  GRAVITY_MM_S2,
  MIN_FILM_HEIGHT_MM,
  SURFACE_TENSION_MN_M,
} from '../../domain/physics';
import { copyGrid, createGrid2D, getCell, setCell, totalVolume, type Grid2D } from './grid';

export type ThinFilmParams = {
  /** Dynamic viscosity μ, Pa·s = g/(mm·s). */
  mu: number;
  /** Surface tension σ, mN/m = g/s². */
  sigma: number;
  /** Density ρ, g/mm³. */
  rho: number;
  /** Cell size Δ, mm (uniform, square cells). */
  dx: number;
  /**
   * In-plane gravity in **grid** coordinates (y-down), mm/s².
   * Paint accelerates in the +g∥ direction.
   */
  gParallelX: number;
  gParallelY: number;
  /** Canvas-normal gravity magnitude g⊥ ≥ 0, mm/s² (hydrostatic spreading). */
  gPerp: number;
  /** Soft floor for mobility, mm. */
  hMin: number;
  /** CFL / diffusion safety factor in (0, 1]. */
  dtSafety: number;
};

export type ThinFilmState = {
  height: Grid2D;
  /** Cumulative volume that left through the border, mm³. */
  drainedVolume: number;
};

export const DEFAULT_THIN_FILM_PARAMS: ThinFilmParams = {
  mu: BASE_VISCOSITY_PA_S,
  sigma: SURFACE_TENSION_MN_M,
  rho: DEFAULT_PAINT_DENSITY_G_MM3,
  dx: 1,
  gParallelX: 0,
  gParallelY: 0,
  gPerp: GRAVITY_MM_S2,
  hMin: MIN_FILM_HEIGHT_MM,
  dtSafety: 0.2,
};

/**
 * Map canvas tilt angles (radians) to gravity in **grid** coordinates (y-down).
 * tiltX > 0 tips the +canvas-Y (up) side down → flow toward grid +y (down the texture).
 * tiltY > 0 tips the +X side down → flow toward grid +x.
 */
export function gravityFromTilt(
  tiltXRad: number,
  tiltYRad: number,
  g: number = GRAVITY_MM_S2,
): Pick<ThinFilmParams, 'gParallelX' | 'gParallelY' | 'gPerp'> {
  const gParallelX = g * Math.sin(tiltYRad);
  const gParallelYCanvasUp = g * Math.sin(tiltXRad);
  const gParallelY = -gParallelYCanvasUp;
  const tiltMag = Math.hypot(tiltXRad, tiltYRad);
  const gPerp = g * Math.cos(Math.min(tiltMag, Math.PI / 2));
  return { gParallelX, gParallelY, gPerp };
}

export function createThinFilmState(width: number, height: number, fill = 0): ThinFilmState {
  return {
    height: createGrid2D(width, height, fill),
    drainedVolume: 0,
  };
}

/** Maximum explicit substep from advective + h³ diffusion (capillary / hydrostatic) limits. */
export function maxStableDt(height: Grid2D, params: ThinFilmParams): number {
  const { mu, sigma, rho, dx, gParallelX, gParallelY, gPerp, hMin, dtSafety } = params;
  if (!(dx > 0) || !(mu > 0) || !(dtSafety > 0)) {
    throw new RangeError('dx, mu, and dtSafety must be positive');
  }

  let hMax = hMin;
  for (let i = 0; i < height.data.length; i += 1) {
    const h = height.data[i]!;
    if (h > hMax) {
      hMax = h;
    }
  }

  const M = (hMax * hMax * hMax) / (3 * mu);
  const dtCap = sigma > 0 ? (dx * dx * dx * dx) / (8 * M * sigma) : Number.POSITIVE_INFINITY;
  const dtGrav =
    rho > 0 && gPerp !== 0 ? (dx * dx) / (4 * M * rho * Math.abs(gPerp)) : Number.POSITIVE_INFINITY;
  const gPar = Math.hypot(gParallelX, gParallelY);
  const uMax = (hMax * hMax * rho * gPar) / (3 * mu);
  const dtAdv = uMax > 0 ? dx / uMax : Number.POSITIVE_INFINITY;

  const dt = dtSafety * Math.min(dtCap, dtGrav, dtAdv);
  if (!Number.isFinite(dt) || dt <= 0) {
    // Degenerate (empty) film: any modest step is fine.
    return dtSafety * 1e-3;
  }
  return dt;
}

function sampleH(height: Grid2D, x: number, y: number): number {
  return Math.max(0, getCell(height, x, y));
}

function laplacianH(height: Grid2D, x: number, y: number, dx: number): number {
  const hC = sampleH(height, x, y);
  const hL = sampleH(height, x - 1, y);
  const hR = sampleH(height, x + 1, y);
  const hD = sampleH(height, x, y - 1);
  const hU = sampleH(height, x, y + 1);
  return (hL + hR + hD + hU - 4 * hC) / (dx * dx);
}

function pressureAt(height: Grid2D, x: number, y: number, params: ThinFilmParams): number {
  // Open border: exterior gauge pressure is ambient (0). Interior uses p = ρ g⊥ h − σ ∇²h.
  if (x < 0 || y < 0 || x >= height.width || y >= height.height) {
    return 0;
  }
  const h = sampleH(height, x, y);
  const lap = laplacianH(height, x, y, params.dx);
  return params.rho * params.gPerp * h - params.sigma * lap;
}

function faceMobility(hLeft: number, hRight: number, mu: number): number {
  const hFace = 0.5 * (hLeft + hRight);
  if (hFace <= 0) {
    return 0;
  }
  return (hFace * hFace * hFace) / (3 * mu);
}

/**
 * One explicit finite-volume substep. Mutates `state.height` and adds to `drainedVolume`.
 */
export function thinFilmSubstep(state: ThinFilmState, dt: number, params: ThinFilmParams): void {
  if (!(dt > 0) || !Number.isFinite(dt)) {
    throw new RangeError('dt must be a positive finite number');
  }

  const { height } = state;
  const { width, height: gridH } = height;
  const { dx, mu, rho, gParallelX, gParallelY } = params;
  const invDx = 1 / dx;

  // Face fluxes: qx[x=0..width][y=0..gridH), qy[x=0..width)[y=0..gridH]
  const qx = new Float64Array((width + 1) * gridH);
  const qy = new Float64Array(width * (gridH + 1));

  for (let y = 0; y < gridH; y += 1) {
    for (let x = 0; x <= width; x += 1) {
      const hL = sampleH(height, x - 1, y);
      const hR = sampleH(height, x, y);
      const M = faceMobility(hL, hR, mu);
      const pL = pressureAt(height, x - 1, y, params);
      const pR = pressureAt(height, x, y, params);
      const dpdx = (pR - pL) * invDx;
      qx[y * (width + 1) + x] = -M * (dpdx - rho * gParallelX);
    }
  }

  for (let y = 0; y <= gridH; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const hD = sampleH(height, x, y - 1);
      const hU = sampleH(height, x, y);
      const M = faceMobility(hD, hU, mu);
      const pD = pressureAt(height, x, y - 1, params);
      const pU = pressureAt(height, x, y, params);
      const dpdy = (pU - pD) * invDx;
      qy[y * width + x] = -M * (dpdy - rho * gParallelY);
    }
  }

  // Drain: flux through exterior faces leaves the domain.
  // qx>0 is flow toward +x; outward on right is +qx, on left is -qx.
  let drained = 0;
  for (let y = 0; y < gridH; y += 1) {
    const qLeft = qx[y * (width + 1)]!;
    const qRight = qx[y * (width + 1) + width]!;
    drained += Math.max(0, -qLeft) * dx * dt;
    drained += Math.max(0, qRight) * dx * dt;
  }
  for (let x = 0; x < width; x += 1) {
    const qTop = qy[x]!; // y=0 face (grid top / smaller y)
    const qBottom = qy[gridH * width + x]!;
    drained += Math.max(0, -qTop) * dx * dt;
    drained += Math.max(0, qBottom) * dx * dt;
  }
  state.drainedVolume += drained;

  const next = createGrid2D(width, gridH);
  for (let y = 0; y < gridH; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const qxm = qx[y * (width + 1) + x]!;
      const qxp = qx[y * (width + 1) + x + 1]!;
      const qym = qy[y * width + x]!;
      const qyp = qy[(y + 1) * width + x]!;
      const div = (qxp - qxm) * invDx + (qyp - qym) * invDx;
      const hNew = sampleH(height, x, y) - dt * div;
      setCell(next, x, y, hNew > 0 ? hNew : 0);
    }
  }

  height.data.set(next.data);
}

/**
 * Advance the film by `dt` seconds using automatic stable substeps.
 * Returns the number of substeps taken.
 */
export function thinFilmStep(state: ThinFilmState, dt: number, params: ThinFilmParams): number {
  if (!(dt >= 0) || !Number.isFinite(dt)) {
    throw new RangeError('dt must be a non-negative finite number');
  }
  if (dt === 0) {
    return 0;
  }

  let remaining = dt;
  let substeps = 0;
  const maxSubsteps = 100_000;

  while (remaining > 0) {
    if (substeps >= maxSubsteps) {
      throw new Error(`thinFilmStep exceeded ${maxSubsteps} substeps`);
    }
    const dtMax = maxStableDt(state.height, params);
    const sub = Math.min(remaining, dtMax);
    thinFilmSubstep(state, sub, params);
    remaining -= sub;
    substeps += 1;
  }

  return substeps;
}

/** Center of mass in grid coordinates (cell centers, y-down), weighted by height. */
export function heightCenterOfMass(
  height: Grid2D,
  dx: number,
): { x: number; y: number; mass: number } {
  let m = 0;
  let mx = 0;
  let my = 0;
  for (let y = 0; y < height.height; y += 1) {
    for (let x = 0; x < height.width; x += 1) {
      const h = sampleH(height, x, y);
      if (h <= 0) {
        continue;
      }
      const cx = (x + 0.5) * dx;
      const cy = (y + 0.5) * dx;
      m += h;
      mx += h * cx;
      my += h * cy;
    }
  }
  if (m <= 0) {
    return { x: 0, y: 0, mass: 0 };
  }
  return { x: mx / m, y: my / m, mass: m };
}

/** Seed a smooth radial puddle (for tests). */
export function addGaussianPuddle(
  height: Grid2D,
  cx: number,
  cy: number,
  amplitude: number,
  radius: number,
): void {
  const r2 = radius * radius;
  for (let y = 0; y < height.height; y += 1) {
    for (let x = 0; x < height.width; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const w = Math.exp((-0.5 * (dx * dx + dy * dy)) / r2);
      setCell(height, x, y, sampleH(height, x, y) + amplitude * w);
    }
  }
}

export function cloneThinFilmState(state: ThinFilmState): ThinFilmState {
  return {
    height: copyGrid(state.height),
    drainedVolume: state.drainedVolume,
  };
}

export function totalFilmVolumeMm3(state: ThinFilmState, dx: number): number {
  return totalVolume(state.height, dx * dx);
}
