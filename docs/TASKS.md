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
- **Status:** done ([audit](audits/2026-11-21-M0-01b.md))
- **Depends on:** M0-01
- **Goal:** Close the small gaps found in [the M0-01 audit](audits/2026-11-21-M0-01.md).
- **Acceptance criteria:**
  - [x] `no-restricted-imports` also blocks `react/*` and `react-dom/*` subpaths (e.g. `react-dom/client`) in sim/domain/render. Add a test or a documented probe showing it.
  - [x] `.nvmrc` → `24`, `engines.node` → `>=22`, `@types/node` major matches the `.nvmrc` major
  - [x] Remove `vitest/globals` from `tsconfig.vitest.json` (tests keep explicit imports)
  - [x] `npm run check` passes
- **Handoff notes:**
  - Extended `no-restricted-imports` patterns with `react`, `react/*`, `react-dom`, `react-dom/*` (exact `paths` entries kept for clearer messages).
  - Added `tests/import-boundary.test.ts` using the ESLint API to assert `react-dom/client` and `react/jsx-runtime` are blocked in sim/domain/render.
  - `.nvmrc` → 24; `engines.node` → `>=22`; `@types/node` → `^24` (matches `.nvmrc` major). README requirements line updated to match.
  - Removed `vitest/globals` from `tsconfig.vitest.json`; tests already use explicit vitest imports.
  - `npm run check` passes (9 tests). No new runtime dependencies.

### M0-02 Domain types, physics constants, seeded RNG
- **Status:** done ([audit](audits/2026-11-21-M0-02.md))
- **Depends on:** M0-01
- **Goal:** Pure data types that the sim and UI share.
- **Acceptance criteria:**
  - [x] `src/domain/paint.ts`: `Paint` (id, name, rgb, density g/ml, mediumRatio, waterRatio, siliconeDrops) and a starter preset list of about 12 pigments with plausible relative densities (Titanium White heaviest, then the cadmium-style colors, with phthalos and quinacridones lighter)
  - [x] `src/domain/cup.ts`: `Cup` (type: single | split | funnel | colander | squeeze; ordered layers of {paintId, volume ml})
  - [x] `src/domain/recipe.ts`: `Recipe` (canvas size/shape, paints, cup, technique id, seed, recorded tool actions). JSON serialize/parse with a version field.
  - [x] `src/domain/physics.ts`: every physical constant and default (gravity, base viscosity, surface tension, silicone σ reduction, drying rate) with units in comments
  - [x] `src/sim/rng.ts`: a seeded PRNG (e.g. mulberry32 or PCG); test that the same seed gives the same sequence
  - [x] Unit tests for recipe round-trip
  - [x] _(from M0-01b audit)_ Add a `format:check` script (`prettier --check .`), include it in `check`, and run `npm run format` once so the repo is clean
- **Handoff notes:**
  - Added `paint.ts` (12 presets, Ti white → cadmiums → earths → ultramarine/black → phthalos → quinacridones), `cup.ts`, `recipe.ts` (versioned JSON + typed tool actions), `physics.ts` (g, μ, σ, silicone σ cut, drying, tilt, temp coeffs; units in comments), `sim/rng.ts` (Mulberry32).
  - Tests: recipe round-trip + reject bad version/actions; RNG determinism; preset density ordering.
  - `format:check` added to `check`; ran `npm run format` (touched `eslint.config.js`, `recipe.ts`, `import-boundary.test.ts`). README Commands updated.
  - Barrel exports updated in `src/domain/index.ts` and `src/sim/index.ts`. No new dependencies.
  - `npm run check` passes (19 tests). Densities are plausible relative acrylic values, not lab SG — tune later against real pours if needed.

### M0-02b Unit system, color space, seed and recipe validation
- **Status:** done ([audit](audits/2026-11-21-M0-02b.md))
- **Depends on:** M0-02
- **Goal:** Fix the issues from [the M0-02 audit](audits/2026-11-21-M0-02.md) before any physics code uses `physics.ts`.
- **Acceptance criteria:**
  - [x] `physics.ts` uses one consistent **mm–g–s** sim unit system, stated at the top of the file: length mm, mass g, time s. That gives pressure g/(mm·s²) = Pa, viscosity g/(mm·s) = Pa·s, surface tension g/s² = mN/m, density g/mm³.
  - [x] `SURFACE_TENSION` is expressed in mN/m (≈35), with the silicone and temperature coefficients converted to match; names say the unit (e.g. `SURFACE_TENSION_MN_M`)
  - [x] `Paint.density` stays g/ml for people; add `densityToSim(gPerMl) → g/mm³` (×1e-3) and use it wherever sim code needs ρ
  - [x] Test: capillary length `√(σ/(ρ·g))` with the defaults is 1.5–2.0 mm
  - [x] `Rgb` is documented as **sRGB 0–1**; add `srgbToLinear` in `src/domain` (or `src/render`) with a test at known points (0, 0.04045, 0.5, 1)
  - [x] `createRng` throws on a non-integer seed or one outside [0, 2³²); `parseRecipe` rejects such seeds
  - [x] Golden-value test: the first 5 `next()` outputs for seed 12345 are pinned
  - [x] `validateRecipe` (called by `parseRecipe`) rejects: empty or duplicate paint ids; cup layers or pour actions whose `paintId` isn't in `paints`; canvas width/height ≤ 0; volume ≤ 0; density ≤ 0; rgb outside [0,1]; negative ratios or silicone drops; negative or non-ascending `t`. One test per rule.
  - [x] Decide whether tool coordinates may fall outside [0,1], and document it in `ToolAction`'s comment
  - [x] `npm run check` passes
- **Handoff notes:**
  - Adopted mm–g–s in `physics.ts`: `SURFACE_TENSION_MN_M = 35`, temp coeff `0.15` mN/(m·°C); `densityToSim` + `DEFAULT_PAINT_DENSITY_G_MM3`; `capillaryLengthMm` helper. Capillary length ≈ 1.72 mm under defaults.
  - `Rgb` documented as sRGB; `src/domain/color.ts` adds `srgbToLinear` / channel helper with known-point tests.
  - `isValidSeed` in `src/domain/seed.ts`; `createRng` throws on bad seeds; `validateRecipe` + `parseRecipe` enforce integer seeds in [0, 2³²). Golden first-5 sequence for seed 12345 pinned.
  - `validateRecipe` covers all listed semantic rules (one test each in `tests/domain/validate-recipe.test.ts`).
  - **Coords decision:** tool coordinates may leave [0,1] (off-canvas strokes allowed); documented on `ToolAction`. Sim should clamp/ignore later.
  - Breaking rename: `SURFACE_TENSION_N_M` → `SURFACE_TENSION_MN_M` (nothing consumed it yet). No new dependencies.
  - `npm run check` passes (37 tests).

### M0-03 WebGPU bootstrap + SimController skeleton
- **Status:** done ([audit](audits/2026-11-21-M0-03.md))
- **Depends on:** M0-01
- **Goal:** Get a GPU device and a canvas on screen, behind the interface the UI will use.
- **Acceptance criteria:**
  - [x] `src/sim/gpu/device.ts`: requests an adapter/device and reports a clear error object if WebGPU is unavailable
  - [x] The app shows a friendly "WebGPU required (use Chrome or Edge)" message instead of crashing
  - [x] `SimController` interface in `src/sim/index.ts`: `init(canvas, settings)`, `start()`, `pause()`, `reset(seed)`, `step(n)`, `setTilt(x, y)`, `pointer(tool, event)`, `getStats()`, `dispose()`. Stubs are fine, but the types must be final-ish.
  - [x] A full-window canvas cleared to a canvas-white color each frame by a rAF loop owned by the controller
  - [x] Handles resize and device loss (logs and offers reload)
  - [x] _(from M0-02b audit)_ `src/sim/coords.ts`: `pointerToCanvas(event, canvasEl)` gives canvas-normalized coords, (0,0) bottom-left and y-up per the `ToolAction` docs. `canvasToTexel(x, y, gridN)` handles the y-flip for y-down textures. Unit tests cover the corners and center. `SimController.pointer` uses it.
- **Handoff notes:**
  - `requestGpuDevice()` returns `{ok, error|value}` with codes `unsupported` / `no-adapter` / `request-failed` (Node test covers unsupported).
  - `SimController` types in `src/sim/types.ts`; impl in `controller.ts` via `createSimController()`. rAF clear to canvas-white; `ResizeObserver` reconfigure; `device.lost` pauses, logs, and App shows Reload.
  - App mounts a full-viewport canvas; friendly WebGPU overlay on init failure; device-lost overlay with reload.
  - `coords.ts`: y-up canvas ↔ y-down texels; `pointer()` uses both. Corner/center unit tests.
  - **Dependency:** `@webgpu/types` (dev) for GPU typings; referenced from `src/vite-env.d.ts`.
  - Removed `isValidSeed` re-export from `src/sim/index.ts` (import from domain instead).
  - `npm run check` (49 tests) and `npm run build` pass. WebGPU path needs Chrome/Edge to visually verify.

### M0-04 Ping-pong compute framework + debug readback
- **Status:** done ([audit](audits/2026-11-21-M0-04.md))
- **Depends on:** M0-03
- **Goal:** Reusable plumbing for grid compute passes.
- **Acceptance criteria:**
  - [x] Helper for a named ping-pong pair of storage textures or buffers at grid resolution N×N (N configurable: 256/512/1024)
  - [x] Helper to build a compute pipeline from a WGSL file plus a typed uniform struct
  - [x] Async readback helper (GPU → `Float32Array`) for debugging and comparisons
  - [x] Demo pass: a compute shader that blurs a test pattern each frame, plus a render pass that shows the grid as a grayscale image
  - [x] A dev-only debug overlay (toggle with backtick) that shows FPS, grid size and step count
  - [x] _(from M0-03 audit)_ `context.configure()` runs only at init and when the canvas pixel size actually changes, never every frame
  - [x] _(from M0-03 audit)_ `SimController.init` rechecks `disposed` after awaiting the device, and if disposed, destroys the device and returns without touching the canvas
- **Handoff notes:**
  - GPU plumbing: `pingPong.ts` (`heightA`/`heightB` r32float), `uniforms.ts` (`packUniforms` / `createComputePipelineFromWgsl` / `createUniformBuffer`), `readback.ts` (`readTextureToFloat32`, `readBufferToFloat32`, 256-byte row align).
  - Demo: `blur.wgsl` 3×3 box blur + `blit_grayscale.wgsl`; `demoBlur.ts` seeds a disk/checker pattern; controller runs blur+blit each frame; `step(n)` runs N blurs immediately.
  - Dev overlay in `App.tsx` (`import.meta.env.DEV`): backtick toggles FPS / grid / step count.
  - M0-03 fixes: `configureContext` only on init/size change (no per-frame configure); `init` destroys device and returns if `disposed` after await.
  - Unit tests: uniform packing, row alignment, test pattern. Full GPU path needs Chrome/Edge (not exercised in Vitest).
  - `npm run check` (53 tests) and `npm run build` pass. No new dependencies.

### M0-05 CPU reference grid utilities
- **Status:** done ([audit](audits/2026-11-21-M0-05.md))
- **Depends on:** M0-02
- **Goal:** The base for the CPU reference solvers and physics tests.
- **Acceptance criteria:**
  - [x] `src/sim/cpu/grid.ts`: a `Grid2D` Float32 grid with get/set, bounds handling and copy
  - [x] Invariant helpers: `totalVolume`, `hasNonFinite`, `isMirrorSymmetric(axis, tol)`, `maxAbsDiff(a, b)`
  - [x] Tests for each helper
- **Handoff notes:**
  - `Grid2D`: row-major Float32, `getCell`/`setCell` with OOB get→0 and OOB set ignored (no wrap). `copyGrid` / `copyGridInto`.
  - Helpers: `totalVolume(cellArea?)`, `hasNonFinite`, `isMirrorSymmetric('x'|'y', tol)`, `maxAbsDiff`.
  - Tests in `tests/sim/cpu/grid.test.ts` cover create/get/set/bounds, copy, and each invariant helper (11 cases).
  - Exported from `src/sim/cpu` and `src/sim`. No new dependencies. `npm run check` passes (64 tests).
  - Note: array (0,0) is top-left / y-down (texture space); canvas y-up conversion stays at the coords boundary for M1.

---

## M1: Single-fluid thin film

**Milestone done when:** you can pour a puddle of a single color, tilt the canvas, and it flows and runs off the edge looking like glossy liquid.

### M1-01 CPU thin-film solver
- **Status:** todo
- **Depends on:** M0-02b, M0-05
- **Goal:** The reference physics, written for clarity.
- **Acceptance criteria:**
  - [ ] _(from M0-05 audit, do first)_ `maxAbsDiff` returns `NaN` when any compared cell is non-finite, unless both cells are identical non-finite values. `isMirrorSymmetric` returns `false` when a compared pair has a non-finite value. Add tests for both.
  - [ ] _(from M0-05 audit)_ `getCell`/`setCell` throw `RangeError` on non-integer indices (out-of-bounds integers keep their current behavior)
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
  - [ ] _(from M0-04 audit)_ Ping-pong bind groups are built once (A→B and B→A) and chosen by parity. No `createBindGroup` in the per-frame or per-substep path.
  - [ ] _(from M0-04 audit)_ Uniform layout round-trip check: a tiny compute pass copies every field of the flow-parameter uniform struct into a storage buffer, it's read back, and it's compared with `packUniforms` input. Runs from the same debug-overlay harness as "Compare to CPU".
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
  - [ ] _(from M0-04 audit)_ Aspect-correct display: the square sim grid is letterboxed (or the grid matches the canvas aspect), so circles stay circles at any window shape. Pointer mapping stays consistent with the letterbox.
- **Handoff notes:**

---

## Later milestones (to be specified)
- **M2:** multi-color layer stack, BFECC advection, layered cup, flip cup and dirty pour. Note from M0-02 audit: `CupLayer` needs a compartment/slot field for split cups.
- **M3:** cells: density buoyancy, silicone + Marangoni, torch tool
- **M4:** technique tools: swipe, air jet (Dutch/Bloom), string pull, puddle/tree-ring paths, presets
- **M5:** drying, finish modes, PNG + time-lapse export
- **M6:** gallery/recipes, pigment library, tablet gyro tilt, realism tuning

## Open product decisions (from PLAN §7)
Defaults assumed until the user decides: desktop first, a realistic-but-sped-up default, generic pigment names, time-lapse export not in v1.

---

## Discovered
_Implementers: add work found mid-task here (one line each). Don't do it in the current task._
- _(M0-02b audit)_ `serializeRecipe` should call `validateRecipe`, so the app can't save a recipe it would refuse to load. Do it when the save/gallery flow is built (M6) or sooner if convenient.
- _(M0-04 audit)_ `readBufferToFloat32` should check `buffer.usage & GPUBufferUsage.COPY_SRC` and throw a clear error (right now it raises a GPU validation error). Document that requirement on the helper.
