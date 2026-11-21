# ADR 0002: 2.5D thin-film model with a per-column layer stack

- **Status:** accepted
- **Date:** 2026-11-21

## Context
A pour painting is a film about 1–3 mm thick spread over about 300 mm. Cells need vertical ordering (what is under the top layer), but a full 3D Navier–Stokes solver is too slow for real time.

## Decision
Model the paint as a height field `h` evolving under the lubrication approximation (gravity from tilt, capillary pressure, Marangoni stress). Each grid column holds an ordered stack of K (4–8) paint layers that is advected with the flow. Cells come from (a) a buoyancy step that swaps lighter layers upward in plumes, and (b) silicone parcels that lower local surface tension when they reach the surface.

## Consequences
- Real-time at 512²–1024² on mid-range GPUs.
- Not a true 3D flow: overturning and deep mixing are approximated. Dirty-pour stream mixing is modeled in the cup/pour stage, not by the film solver.
- Color must use low-diffusion advection (BFECC/MacCormack) or results go muddy.
