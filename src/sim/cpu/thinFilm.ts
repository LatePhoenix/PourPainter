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
 * character. Edges are open for **gravity drain** only: pressure uses Neumann
 * ghosts (no capillary cliff against p_ext = 0); outward g∥ flux leaves the
 * system and is accumulated as drainedVolume (mm³). Inward exterior flux is 0.
 *
 * Discretization notes (audit round 1):
 * - Pressure / capillary / hydrostatic flux uses **centered** face mobility.
 * - In-plane gravity flux uses **upwind** mobility (donor cell by sign of g∥)
 *   to avoid dispersive sawtooth at kinematic-wave fronts.
 * - A positivity-preserving **flux limiter** scales each cell's outgoing face
 *   fluxes so outflow·dt ≤ cell volume (donor α applied to shared faces),
 *   so we do not create mass by clamping h<0.
 *
 * ---------------------------------------------------------------------
 * Explicit stable Δt (substepped)
 * ---------------------------------------------------------------------
 * With mobility scale M = h_max³ / (3μ) and cell size Δ:
 *
 *   Capillary (2D biharmonic, FE):  Δt ≤ Δ⁴ / (32 M σ)
 *   Hydrostatic (∇²):               Δt ≤ Δ² / (4 M ρ |g⊥|)
 *   Advective (kinematic wave):     Δt ≤ Δ / c ,
 *                                   c = h_max² ρ |g∥| / μ   (= dq/dh for q∝h³)
 *
 * `dtSafety` ∈ (0, 1] multiplies that bound; a requested frame dt is split into
 * substeps of size ≤ the limited Δt.
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
  /** CFL / diffusion safety factor; must be in (0, 1]. */
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
 *
 * - tiltX > 0 tips the **canvas top** (+canvas-Y) down → paint flows toward the
 *   canvas top, which is **grid −y** (so gParallelY < 0).
 * - tiltY > 0 tips the **+X** side down → flow toward grid +x (gParallelX > 0).
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
  if (!(dx > 0) || !(mu > 0)) {
    throw new RangeError('dx and mu must be positive');
  }
  if (!(dtSafety > 0) || dtSafety > 1) {
    throw new RangeError('dtSafety must be in (0, 1]');
  }

  let hMax = hMin;
  for (let i = 0; i < height.data.length; i += 1) {
    const h = height.data[i]!;
    if (h > hMax) {
      hMax = h;
    }
  }

  const M = (hMax * hMax * hMax) / (3 * mu);
  // Von Neumann FE bound for 2D biharmonic (5-point Laplacian applied twice).
  const dtCap = sigma > 0 ? (dx * dx * dx * dx) / (32 * M * sigma) : Number.POSITIVE_INFINITY;
  const dtGrav =
    rho > 0 && gPerp !== 0 ? (dx * dx) / (4 * M * rho * Math.abs(gPerp)) : Number.POSITIVE_INFINITY;
  const gPar = Math.hypot(gParallelX, gParallelY);
  // Kinematic-wave speed dq/dh for q = (h³/3μ) ρ |g∥| → c = h² ρ |g∥| / μ.
  const waveSpeed = (hMax * hMax * rho * gPar) / mu;
  const dtAdv = waveSpeed > 0 ? dx / waveSpeed : Number.POSITIVE_INFINITY;

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

/** Neumann (copy-edge) sample for capillary / hydrostatic operators. */
function sampleHNeumann(height: Grid2D, x: number, y: number): number {
  const xx = Math.min(height.width - 1, Math.max(0, x));
  const yy = Math.min(height.height - 1, Math.max(0, y));
  return Math.max(0, getCell(height, xx, yy));
}

function laplacianH(height: Grid2D, x: number, y: number, dx: number): number {
  const hC = sampleHNeumann(height, x, y);
  const hL = sampleHNeumann(height, x - 1, y);
  const hR = sampleHNeumann(height, x + 1, y);
  const hD = sampleHNeumann(height, x, y - 1);
  const hU = sampleHNeumann(height, x, y + 1);
  return (hL + hR + hD + hU - 4 * hC) / (dx * dx);
}

function pressureAt(height: Grid2D, x: number, y: number, params: ThinFilmParams): number {
  // Neumann ghosts at the border (no artificial capillary cliff against p_ext = 0).
  const xx = Math.min(height.width - 1, Math.max(0, x));
  const yy = Math.min(height.height - 1, Math.max(0, y));
  const h = sampleHNeumann(height, xx, yy);
  const lap = laplacianH(height, xx, yy, params.dx);
  return params.rho * params.gPerp * h - params.sigma * lap;
}

function mobilityFromH(h: number, mu: number): number {
  if (h <= 0) {
    return 0;
  }
  return (h * h * h) / (3 * mu);
}

function faceMobilityCentered(hLeft: number, hRight: number, mu: number): number {
  return mobilityFromH(0.5 * (hLeft + hRight), mu);
}

/** Upwind height for gravity drive along a face (donor cell by sign of g∥). */
function upwindH(hMinus: number, hPlus: number, gParallel: number): number {
  if (gParallel > 0) {
    return hMinus;
  }
  if (gParallel < 0) {
    return hPlus;
  }
  return 0.5 * (hMinus + hPlus);
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
      const exterior = x === 0 || x === width;
      if (exterior) {
        // Open edge: Neumann pressure (no capillary/hydro flux across border).
        // Gravity may drain out; inward gravity flux is zeroed (no mass from outside).
        const hB = sampleH(height, x === 0 ? 0 : width - 1, y);
        const Mgrav = mobilityFromH(hB, mu);
        let q = Mgrav * rho * gParallelX;
        if (x === 0 && q > 0) {
          q = 0;
        }
        if (x === width && q < 0) {
          q = 0;
        }
        qx[y * (width + 1) + x] = q;
        continue;
      }
      const hL = sampleH(height, x - 1, y);
      const hR = sampleH(height, x, y);
      const Mcenter = faceMobilityCentered(hL, hR, mu);
      const Mgrav = mobilityFromH(upwindH(hL, hR, gParallelX), mu);
      const pL = pressureAt(height, x - 1, y, params);
      const pR = pressureAt(height, x, y, params);
      const dpdx = (pR - pL) * invDx;
      // q = −M_c ∇p + M_up ρ g∥
      qx[y * (width + 1) + x] = -Mcenter * dpdx + Mgrav * rho * gParallelX;
    }
  }

  for (let y = 0; y <= gridH; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const exterior = y === 0 || y === gridH;
      if (exterior) {
        const hB = sampleH(height, x, y === 0 ? 0 : gridH - 1);
        const Mgrav = mobilityFromH(hB, mu);
        let q = Mgrav * rho * gParallelY;
        if (y === 0 && q > 0) {
          q = 0;
        }
        if (y === gridH && q < 0) {
          q = 0;
        }
        qy[y * width + x] = q;
        continue;
      }
      const hD = sampleH(height, x, y - 1);
      const hU = sampleH(height, x, y);
      const Mcenter = faceMobilityCentered(hD, hU, mu);
      const Mgrav = mobilityFromH(upwindH(hD, hU, gParallelY), mu);
      const pD = pressureAt(height, x, y - 1, params);
      const pU = pressureAt(height, x, y, params);
      const dpdy = (pU - pD) * invDx;
      qy[y * width + x] = -Mcenter * dpdy + Mgrav * rho * gParallelY;
    }
  }

  // Per-cell positivity scales: α = min(1, available / (outgoing·dt)).
  const alpha = new Float64Array(width * gridH);
  for (let y = 0; y < gridH; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const qxm = qx[y * (width + 1) + x]!;
      const qxp = qx[y * (width + 1) + x + 1]!;
      const qym = qy[y * width + x]!;
      const qyp = qy[(y + 1) * width + x]!;
      let outRate = 0; // mm³/s
      if (qxp > 0) {
        outRate += qxp * dx;
      }
      if (qxm < 0) {
        outRate += -qxm * dx;
      }
      if (qyp > 0) {
        outRate += qyp * dx;
      }
      if (qym < 0) {
        outRate += -qym * dx;
      }
      const available = sampleH(height, x, y) * dx * dx;
      const outVol = outRate * dt;
      alpha[y * width + x] = outVol > available && outRate > 0 ? available / outVol : 1;
    }
  }

  // Apply donor α to each face (consistent for both cells sharing the face).
  for (let y = 0; y < gridH; y += 1) {
    for (let x = 0; x <= width; x += 1) {
      const idx = y * (width + 1) + x;
      let q = qx[idx]!;
      if (q > 0 && x > 0) {
        q *= alpha[y * width + (x - 1)]!;
      } else if (q < 0 && x < width) {
        q *= alpha[y * width + x]!;
      }
      qx[idx] = q;
    }
  }
  for (let y = 0; y <= gridH; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      let q = qy[idx]!;
      if (q > 0 && y > 0) {
        q *= alpha[(y - 1) * width + x]!;
      } else if (q < 0 && y < gridH) {
        q *= alpha[y * width + x]!;
      }
      qy[idx] = q;
    }
  }

  // Drain from limited exterior-face fluxes.
  // qx>0 is flow toward +x; outward on right is +qx, on left is -qx.
  let drained = 0;
  for (let y = 0; y < gridH; y += 1) {
    const qLeft = qx[y * (width + 1)]!;
    const qRight = qx[y * (width + 1) + width]!;
    drained += Math.max(0, -qLeft) * dx * dt;
    drained += Math.max(0, qRight) * dx * dt;
  }
  for (let x = 0; x < width; x += 1) {
    const qTop = qy[x]!;
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
      if (!(hNew >= -1e-6)) {
        throw new Error(`thinFilmSubstep: height ${hNew} < -1e-6 at (${x},${y})`);
      }
      // Float dust in [-1e-6, 0] → 0; limiter should keep mass-conserving updates ≥ 0.
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

/** Seed a sharp rectangular slab (for positivity / conservation probes). */
export function addBoxPuddle(
  height: Grid2D,
  x0: number,
  y0: number,
  boxW: number,
  boxH: number,
  amplitude: number,
): void {
  for (let y = y0; y < y0 + boxH; y += 1) {
    for (let x = x0; x < x0 + boxW; x += 1) {
      setCell(height, x, y, sampleH(height, x, y) + amplitude);
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
