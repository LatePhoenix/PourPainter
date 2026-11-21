/**
 * Central physical constants and defaults for the thin-film sim.
 * Units: mm, s, Pa·s (N·s/m²), N/m, unless noted. Pass these as uniforms — no magic numbers in shaders.
 */

/** Standard gravity magnitude, mm/s² (9.81 m/s²). */
export const GRAVITY_MM_S2 = 9810;

/** Default paint density when a mix has no pigments yet, g/ml (= g/cm³). */
export const DEFAULT_PAINT_DENSITY_G_ML = 1.2;

/**
 * Base dynamic viscosity for a "warm honey" pour mix, Pa·s.
 * Water ≈ 0.001; honey ≈ 2–10; pour mixes sit in between after medium + water.
 */
export const BASE_VISCOSITY_PA_S = 0.4;

/** Ambient surface tension of mixed acrylic pour paint, N/m (water ≈ 0.072). */
export const SURFACE_TENSION_N_M = 0.035;

/**
 * Fractional drop in local σ when silicone concentration is at reference strength.
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
 * How strongly temperature lowers surface tension, N/(m·°C).
 * σ(T) = σ0 - SURFACE_TENSION_TEMP_COEFF_N_M_PER_C * ΔT.
 */
export const SURFACE_TENSION_TEMP_COEFF_N_M_PER_C = 0.00015;
