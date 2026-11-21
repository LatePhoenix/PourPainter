# ADR 0003: Semi-implicit capillary step for the real-time GPU solver

- **Status:** accepted (by the user, 2026-11-21)
- **Date:** 2026-11-21

## Context
The thin-film equation's capillary term is fourth order, so an explicit step needs `Δt ≲ Δ⁴/(32·M·σ)`. With realistic paint (μ = 0.4 Pa·s, σ = 35 mN/m, h ≈ 1.5 mm) on a 300 mm canvas, the M1-01 audit measured:

| Grid | Δ (mm) | Stable Δt | Substeps per 60 Hz frame |
|---|---|---|---|
| 512² | 0.59 | ≈ 8e-6 s | ≈ 2,100 |
| 1024² | 0.29 | ≈ 5e-7 s | ≈ 32,000 |

_(Updated after M1-01 round 2, which corrected the capillary bound from Δ⁴/8Mσ to Δ⁴/32Mσ. The round-1 figures were ≈ 525 and ≈ 8,000 substeps.)_

The number of steps needed to simulate a given amount of flow scales as `σ·L/(ρ·g·Δ⁴)`, independent of viscosity, so changing μ doesn't help. The product goal is real time or faster ("realistic but sped up"), at 512² or above.

## Decision
1. **Keep the explicit solver** (M1-01) as the CPU **reference**. It's simple, and easy to trust and test.
2. For the GPU real-time path, treat the capillary term **semi-implicitly**: freeze the mobility at the current step, and solve the linear fourth-order system with a few Jacobi or red-black Gauss–Seidel iterations (or split it into two coupled second-order solves). Gravity and advection stay explicit and upwinded. This lifts the capillary limit, leaving the much looser hydrostatic (≈ 2.6e-3 s) and advective limits.
3. The GPU explicit port (M1-02) is still built first, and validated against the CPU reference at small grids. It reports throughput (sim-seconds per wall-second) instead of being required to hit 60 fps at physical speed.
4. A new task, **M1-06**, adds the semi-implicit capillary step (CPU reference and GPU), validated against the explicit solver at small Δt.

## Alternatives considered
- **Scale σ down** (numerical surface-tension reduction): cheap, but it weakens the edge rounding and lacing that make pours look real. It stays available as a "speed vs realism" slider if needed.
- **Coarser grid** (256²): 16× fewer capillary substeps than 512², but the visible detail loss is too much for cells and lacing.
- **Accept a slow sim** and play back a pre-rendered time-lapse: kills interactivity (tilting, torching).

## Consequences
- One extra task (M1-06) and an iterative solver on the GPU.
- Implicit steps are more diffusive at large Δt, so we must check that lacing and cells aren't smeared (M3 tuning).
- The CPU explicit solver remains the source of truth for correctness tests.
