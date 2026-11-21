/**
 * Central physical constants and defaults for the thin-film sim.
 *
 * Sim unit system (mm–g–s):
 * - length: mm
 * - mass: g
 * - time: s
 *
 * Derived: pressure g/(mm·s²) = Pa, viscosity g/(mm·s) = Pa·s,
 * surface tension g/s² = mN/m, density g/mm³.
 *
 * Human-facing paint density stays g/ml; convert with `densityToSim` before sim math.
 * Pass these as uniforms — no magic numbers in shaders.
 */

/** Standard gravity magnitude, mm/s² (9.81 m/s²). */
export const GRAVITY_MM_S2 = 9810;

/** Default paint density when a mix has no pigments yet, g/ml (human-facing). */
export const DEFAULT_PAINT_DENSITY_G_ML = 1.2;

/**
 * Convert human density (g/ml = g/cm³) to sim density (g/mm³).
 * 1 ml = 1000 mm³, so multiply by 1e-3.
 */
export function densityToSim(gPerMl: number): number {
  return gPerMl * 1e-3;
}

/** Default paint density in sim units, g/mm³. */
export const DEFAULT_PAINT_DENSITY_G_MM3 = densityToSim(DEFAULT_PAINT_DENSITY_G_ML);

/**
 * Base dynamic viscosity for a "warm honey" pour mix.
 * Pa·s ≡ g/(mm·s). Water ≈ 0.001; honey ≈ 2–10; pour mixes sit in between after medium + water.
 */
export const BASE_VISCOSITY_PA_S = 0.4;

/** Ambient surface tension of mixed acrylic pour paint, mN/m = g/s² (water ≈ 72). */
export const SURFACE_TENSION_MN_M = 35;

/**
 * Fractional drop in local σ when silicone concentration is at reference strength (dimensionless).
 * σ_eff = σ * (1 - SILICONE_SIGMA_REDUCTION * clamp(c / c_ref, 0, 1)).
 */
export const SILICONE_SIGMA_REDUCTION = 0.55;

/** Silicone concentration (arbitrary 0–1 field units) that reaches full σ reduction. */
export const SILICONE_REF_CONCENTRATION = 1;

/**
 * Drying rate: viscosity multiplier grows as exp(DRYING_RATE_PER_S * age_s).
 * Tuned for sped-up-but-plausible sessions (not wall-clock hours).
 */
export const DRYING_RATE_PER_S = 0.002;

/** Soft floor on film height to avoid h³ / μ blow-ups, mm. */
export const MIN_FILM_HEIGHT_MM = 1e-4;

/** Typical wet film thickness after a pour settles, mm. */
export const DEFAULT_FILM_HEIGHT_MM = 1.5;

/** Maximum canvas tilt from horizontal, radians (~25°). */
export const MAX_TILT_RAD = (25 * Math.PI) / 180;

/** Default simulation grid cell size on a 300 mm canvas at 512², mm. */
export const DEFAULT_CELL_SIZE_MM = 300 / 512;

/** Reference temperature for viscosity / σ, °C. */
export const REFERENCE_TEMP_C = 22;

/** Torch-driven local temperature rise ceiling, °C above ambient. */
export const MAX_TORCH_DELTA_TEMP_C = 40;

/**
 * How strongly temperature lowers viscosity:
 * μ(T) = μ0 * exp(-VISCOSITY_TEMP_COEFF_PER_C * ΔT).
 */
export const VISCOSITY_TEMP_COEFF_PER_C = 0.04;

/**
 * How strongly temperature lowers surface tension, mN/(m·°C) = g/(s²·°C).
 * σ(T) = σ0 - SURFACE_TENSION_TEMP_COEFF_MN_M_PER_C * ΔT.
 */
export const SURFACE_TENSION_TEMP_COEFF_MN_M_PER_C = 0.15;

/** Capillary length √(σ / (ρ·g)) in mm for the default paint constants. */
export function capillaryLengthMm(
  sigmaMnM: number = SURFACE_TENSION_MN_M,
  densityGMm3: number = DEFAULT_PAINT_DENSITY_G_MM3,
  gravityMmS2: number = GRAVITY_MM_S2,
): number {
  return Math.sqrt(sigmaMnM / (densityGMm3 * gravityMmS2));
}
