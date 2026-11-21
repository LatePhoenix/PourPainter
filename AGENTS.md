# AGENTS.md — PourPainter

Shared instructions for every AI agent working in this repo (Cursor, Claude Code, others).
Humans: see [README.md](README.md). Full design: [docs/PLAN.md](docs/PLAN.md).

## What this is
A browser-based acrylic pour painting simulator. The user picks paints, mediums and silicone, builds a layered cup, chooses a technique (flip cup, dirty pour, swipe, Dutch pour…), then tilts, torches and blows the paint. A GPU thin-film fluid simulation renders the result.

## Roles
| Agent | Role |
|---|---|
| **Cursor** | Primary implementer. Picks tasks from `docs/TASKS.md`, writes code and tests. |
| **Claude Code** | Auditor and project manager. Reviews finished tasks, writes audit reports in `docs/audits/`, maintains `docs/TASKS.md` and ADRs. Writes code only when asked. |

## Tech stack (decided, see `docs/decisions/`)
- TypeScript (strict), Vite, React 18
- WebGPU compute + render, shaders in WGSL (`.wgsl` files imported with `?raw`)
- Zustand for app state
- Vitest for unit tests, Playwright for E2E later
- No backend. Persistence via IndexedDB.

## Repo layout (target, created by task M0-01)
```
src/
  app/        React UI: panels, tools, layout
  state/      Zustand stores (paints, cup, tools, sim settings)
  sim/        Simulation core: no React imports allowed
    gpu/      WebGPU device, buffers, pipelines, ping-pong textures
    shaders/  *.wgsl compute + render shaders
    cpu/      CPU reference solver (small grids, used by tests)
  domain/     Pure types + data: Paint, Pigment presets, Cup, Technique, Recipe
  render/     Composite + lighting passes
tests/        Vitest tests mirroring src/
docs/         PLAN, TASKS, decisions (ADRs), audits
```

## Hard rules
1. **`src/sim` and `src/domain` never import React or anything under `src/app`.** The UI talks to the sim through a typed interface (`SimController`).
2. **Every GPU kernel that does physics has a CPU reference in `src/sim/cpu`** with a Vitest test comparing the two on a small grid (or at least testing the CPU version's invariants: mass conservation, no NaNs, symmetry).
3. **Physical parameters live in one place** (`src/domain/physics.ts`) with units in comments. No magic numbers in shaders: pass them as uniforms.
4. **Determinism:** all randomness goes through a seeded RNG, so a saved Recipe + seed replays identically.
5. Keep TypeScript `strict` on. No `any` without a `// reason:` comment.
6. Small, focused commits. One task per branch: `task/<ID>-short-name` (e.g. `task/M1-02-tilt-gravity`).
7. Don't add dependencies without noting why in the task's handoff notes.

## Workflow for implementing a task (Cursor)
1. Open `docs/TASKS.md` and take the first task with status `todo` whose dependencies are `done`.
2. Set its status to `in-progress`. Create branch `task/<ID>-...`.
3. Implement until every acceptance criterion is met. Run `npm run check` (typecheck + lint + test) before finishing.
4. Fill in the task's **Handoff notes**: what you did, files touched, deviations from the plan, anything left unclear.
5. Set the status to `review`. Commit. Do not mark tasks `done` yourself: the audit does that.

## Workflow for auditing (Claude Code)
1. For each task in `review`, read the diff on its branch against `main`, plus its acceptance criteria and handoff notes.
2. Write `docs/audits/<YYYY-MM-DD>-<ID>.md` using `docs/audits/_TEMPLATE.md`.
3. Verdict `pass`: set the task to `done` (the user merges). Verdict `changes`: set it back to `todo` with a link to the audit, and add follow-up tasks if needed.

## Commands (available after M0-01)
- `npm run dev`: dev server (Chrome/Edge with WebGPU)
- `npm run check`: typecheck + lint + unit tests (must pass before `review`)
- `npm test`: Vitest
- `npm run build`: production build

## Domain glossary
- **Film height `h`**: paint thickness at a grid cell (mm).
- **Layer stack**: the K topmost paint layers in a grid column, top first. Lets cells reveal lower colors.
- **Cell**: a hole in the top layer that shows the layers below it. Comes from density inversion (Rayleigh–Taylor) or silicone lowering surface tension (Marangoni).
- **Lacing**: fine web-like edges at thin flow fronts.
- **Recipe**: the paints, ratios, cup layout, technique, tool actions and seed. Enough to replay a painting.
