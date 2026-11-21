# Task Backlog

Statuses: `todo` → `in-progress` → `review` → `done` (or back to `todo` after an audit asks for changes).
Rules: take the first `todo` whose dependencies are `done`. One branch per task: `task/<ID>-short-name`.
Only the current and next milestone are fully specified. Later ones get filled in by Claude Code as they come up.

---

## M0: Foundations

### M0-01 Project scaffold
- **Status:** done ([audit](audits/2026-11-21-M0-01.md))
- **Depends on:** none
- **Goal:** A working Vite + React + TypeScript project with the tooling every later task relies on.
- **Acceptance criteria:**
  - [x] Vite + React 18 + TypeScript with `strict: true` (and `noUncheckedIndexedAccess`)
  - [x] ESLint (typescript-eslint, react-hooks) and Prettier configured
  - [x] Vitest configured; one trivial passing test
  - [x] Scripts: `dev`, `build`, `test`, `lint`, `typecheck`, `check` (= typecheck + lint + test)
  - [x] Folder layout from AGENTS.md created, each folder with an `index.ts` (or `.gitkeep` for `shaders/`)
  - [x] `.wgsl` files importable as strings (`?raw`) with a type declaration
  - [x] An ESLint rule (e.g. `no-restricted-imports`) that blocks `react` and `src/app` imports from `src/sim`, `src/domain` and `src/render`
  - [x] GitHub Actions workflow running `npm ci && npm run check` on push/PR
  - [x] README "Commands" section updated if anything differs
- **Handoff notes:**
  - Scaffolded Vite 6 + React 18 + TS 5.8 with `strict` and `noUncheckedIndexedAccess` in app/node/vitest tsconfigs.
  - Tooling: ESLint 9 flat config (typescript-eslint, react-hooks, react-refresh, prettier), Prettier, Vitest 3.
  - Scripts match the task list; `check` = typecheck + lint + test. Also added `format` and `test:watch`.
  - Folder layout under `src/` with barrel `index.ts` files; `src/sim/shaders/` uses `.gitkeep` plus a `placeholder.wgsl` to prove `?raw` imports (`src/vite-env.d.ts`, `src/sim/gpu/wgslRaw.ts`, vitest coverage).
  - `no-restricted-imports` on `src/sim`, `src/domain`, `src/render` blocks `react`/`react-dom` and `src/app` (verified with a probe file).
  - CI: `.github/workflows/check.yml` runs `npm ci && npm run check` on push/PR (`ubuntu-latest`, concurrency cancel-in-progress).
  - README Commands section added. `.nvmrc` = 20.
  - **Dependency note:** added `zustand` early (listed in AGENTS.md / PLAN stack) even though no store is wired yet; added `@types/node` for Vite/Vitest path resolution.
  - `npm run check` and `npm run build` pass locally (Node 26 host; engines/CI pin ≥20).
  - No plan deviations. Next tasks (M0-02 / M0-03) can start once this is audited.

### M0-01b Tooling follow-ups from M0-01 audit
- **Status:** todo
- **Depends on:** M0-01
- **Goal:** Close the small gaps found in [the M0-01 audit](audits/2026-11-21-M0-01.md).
- **Acceptance criteria:**
  - [ ] `no-restricted-imports` also blocks `react/*` and `react-dom/*` subpaths (e.g. `react-dom/client`) in sim/domain/render. Add a test or a documented probe showing it.
  - [ ] `.nvmrc` → `24`, `engines.node` → `>=22`, `@types/node` major matches the `.nvmrc` major
  - [ ] Remove `vitest/globals` from `tsconfig.vitest.json` (tests keep explicit imports)
  - [ ] `npm run check` passes
- **Handoff notes:**

### M0-02 Domain types, physics constants, seeded RNG
- **Status:** todo
- **Depends on:** M0-01
- **Goal:** Pure data types that the sim and UI share.
- **Acceptance criteria:**
  - [ ] `src/domain/paint.ts`: `Paint` (id, name, rgb, density g/ml, mediumRatio, waterRatio, siliconeDrops) and a starter preset list of about 12 pigments with plausible relative densities (Titanium White heaviest, then the cadmium-style colors, with phthalos and quinacridones lighter)
  - [ ] `src/domain/cup.ts`: `Cup` (type: single | split | funnel | colander | squeeze; ordered layers of {paintId, volume ml})
  - [ ] `src/domain/recipe.ts`: `Recipe` (canvas size/shape, paints, cup, technique id, seed, recorded tool actions). JSON serialize/parse with a version field.
  - [ ] `src/domain/physics.ts`: every physical constant and default (gravity, base viscosity, surface tension, silicone σ reduction, drying rate) with units in comments
  - [ ] `src/sim/rng.ts`: a seeded PRNG (e.g. mulberry32 or PCG); test that the same seed gives the same sequence
  - [ ] Unit tests for recipe round-trip
- **Handoff notes:**

### M0-03 WebGPU bootstrap + SimController skeleton
- **Status:** todo
- **Depends on:** M0-01
- **Goal:** Get a GPU device and a canvas on screen, behind the interface the UI will use.
- **Acceptance criteria:**
  - [ ] `src/sim/gpu/device.ts`: requests an adapter/device and reports a clear error object if WebGPU is unavailable
  - [ ] The app shows a friendly "WebGPU required (use Chrome or Edge)" message instead of crashing
  - [ ] `SimController` interface in `src/sim/index.ts`: `init(canvas, settings)`, `start()`, `pause()`, `reset(seed)`, `step(n)`, `setTilt(x, y)`, `pointer(tool, event)`, `getStats()`, `dispose()`. Stubs are fine, but the types must be final-ish.
  - [ ] A full-window canvas cleared to a canvas-white color each frame by a rAF loop owned by the controller
  - [ ] Handles resize and device loss (logs and offers reload)
- **Handoff notes:**

### M0-04 Ping-pong compute framework + debug readback
- **Status:** todo
- **Depends on:** M0-03
- **Goal:** Reusable plumbing for grid compute passes.
- **Acceptance criteria:**
  - [ ] Helper for a named ping-pong pair of storage textures or buffers at grid resolution N×N (N configurable: 256/512/1024)
  - [ ] Helper to build a compute pipeline from a WGSL file plus a typed uniform struct
  - [ ] Async readback helper (GPU → `Float32Array`) for debugging and comparisons
  - [ ] Demo pass: a compute shader that blurs a test pattern each frame, plus a render pass that shows the grid as a grayscale image
  - [ ] A dev-only debug overlay (toggle with backtick) that shows FPS, grid size and step count
- **Handoff notes:**

### M0-05 CPU reference grid utilities
- **Status:** todo
- **Depends on:** M0-02
- **Goal:** The base for the CPU reference solvers and physics tests.
- **Acceptance criteria:**
  - [ ] `src/sim/cpu/grid.ts`: a `Grid2D` Float32 grid with get/set, bounds handling and copy
  - [ ] Invariant helpers: `totalVolume`, `hasNonFinite`, `isMirrorSymmetric(axis, tol)`, `maxAbsDiff(a, b)`
  - [ ] Tests for each helper
- **Handoff notes:**

---

## M1: Single-fluid thin film

**Milestone done when:** you can pour a puddle of a single color, tilt the canvas, and it flows and runs off the edge looking like glossy liquid.

### M1-01 CPU thin-film solver
- **Status:** todo
- **Depends on:** M0-02, M0-05
- **Goal:** The reference physics, written for clarity.
- **Acceptance criteria:**
  - [ ] Explicit finite-volume step for `∂h/∂t = -∇·q`, `q = -(h³/3μ)(∇p − ρ·g∥)`, where `p = ρ·g⊥·h − σ∇²h` and `g∥`/`g⊥` are the in-plane and normal parts of gravity for the current tilt (document the derivation in a comment, following PLAN §2.2)
  - [ ] Automatic stable `dt` (advective + h³ diffusion limits), with substeps
  - [ ] Edge cells drain: outflow past the border is removed and counted in `drainedVolume`
  - [ ] Tests: volume conserved (total + drained) to 1e-4 relative over 500 steps; no NaNs; a centered puddle on a flat canvas stays symmetric; with tilt, the center of mass moves downhill
- **Handoff notes:**

### M1-02 GPU thin-film flow
- **Status:** todo
- **Depends on:** M0-04, M1-01
- **Goal:** Port M1-01 to WGSL compute passes.
- **Acceptance criteria:**
  - [ ] Flux pass + height-update pass (ping-pong), with parameters from uniforms
  - [ ] Debug-overlay button "Compare to CPU": runs 100 steps on a 64×64 grid on both and shows the max abs difference (target < 1e-3 relative)
  - [ ] 512×512 runs at ≥ 60 fps with substeps on a mid-range GPU (note the GPU used in the handoff notes)
- **Handoff notes:**

### M1-03 Tilt control
- **Status:** todo
- **Depends on:** M1-02
- **Acceptance criteria:**
  - [ ] Arrow keys / WASD tilt the canvas (max angle in physics.ts), and it eases back when released (toggleable "hold tilt")
  - [ ] On-screen gimbal widget showing and setting the tilt
  - [ ] The tilt maps to the gravity vector in the solver
- **Handoff notes:**

### M1-04 Pour tool
- **Status:** todo
- **Depends on:** M1-02
- **Acceptance criteria:**
  - [ ] Pointer down/drag adds film height with a Gaussian footprint, using a flow rate (ml/s) and stream radius from a small tool panel
  - [ ] The cup has a finite volume; pouring stops when it's empty, and the UI shows how much is left
  - [ ] Added volume is accounted for in stats (poured = on canvas + drained)
- **Handoff notes:**

### M1-05 Lit film rendering
- **Status:** todo
- **Depends on:** M1-02
- **Acceptance criteria:**
  - [ ] Normals from the `h` gradient; a Blinn-Phong or GGX specular "wet gloss" look with a fixed studio light
  - [ ] Paint color × slight thickness darkening; bare canvas shows a subtle weave texture
  - [ ] A toggle between the "height debug" view and the "lit" view
- **Handoff notes:**

---

## Later milestones (to be specified)
- **M2:** multi-color layer stack, BFECC advection, layered cup, flip cup and dirty pour
- **M3:** cells: density buoyancy, silicone + Marangoni, torch tool
- **M4:** technique tools: swipe, air jet (Dutch/Bloom), string pull, puddle/tree-ring paths, presets
- **M5:** drying, finish modes, PNG + time-lapse export
- **M6:** gallery/recipes, pigment library, tablet gyro tilt, realism tuning

## Open product decisions (from PLAN §7)
Defaults assumed until the user decides: desktop first, a realistic-but-sped-up default, generic pigment names, time-lapse export not in v1.

---

## Discovered
_Implementers: add work found mid-task here (one line each). Don't do it in the current task._
