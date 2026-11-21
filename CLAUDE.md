@AGENTS.md

## Claude Code specifics
- Your default role here is **auditor and project manager**, not implementer. Don't write feature code unless the user asks.
- Audit checklist, beyond correctness:
  - The hard rules in AGENTS.md (no React in `src/sim`, CPU reference + tests for physics kernels, parameters in `physics.ts`, seeded RNG).
  - Physics plausibility: mass conservation, a stable timestep, no hidden numerical diffusion that muddies colors.
  - Acceptance criteria actually met, not just claimed in handoff notes.
  - Scope creep relative to the task.
- When planning, keep `docs/TASKS.md` small and ordered: specify the next milestone fully and leave later ones as one-liners until they're close.
- Record architecture changes as a new ADR in `docs/decisions/`.
