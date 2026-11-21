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
- **Status:** done ([audit](audits/2026-11-21-M1-01.md), round 2 pass; CI timeout fixed in 8a19f73)
- **Depends on:** M0-02b, M0-05
- **Goal:** The reference physics, written for clarity.
- **Acceptance criteria:**
  - [x] _(from M0-05 audit, do first)_ `maxAbsDiff` returns `NaN` when any compared cell is non-finite, unless both cells are identical non-finite values. `isMirrorSymmetric` returns `false` when a compared pair has a non-finite value. Add tests for both.
  - [x] _(from M0-05 audit)_ `getCell`/`setCell` throw `RangeError` on non-integer indices (out-of-bounds integers keep their current behavior)
  - [x] Explicit finite-volume step for `∂h/∂t = -∇·q`, `q = -(h³/3μ)(∇p − ρ·g∥)`, where `p = ρ·g⊥·h − σ∇²h` and `g∥`/`g⊥` are the in-plane and normal parts of gravity for the current tilt (document the derivation in a comment, following PLAN §2.2)
  - [x] Automatic stable `dt` (advective + h³ diffusion limits), with substeps
  - [x] Edge cells drain: outflow past the border is removed and counted in `drainedVolume`
  - [x] Tests: volume conserved (total + drained) to 1e-4 relative over 500 steps; no NaNs; a centered puddle on a flat canvas stays symmetric; with tilt, the center of mass moves downhill
  - [x] _(audit round 1, finding 1)_ Replace the `h<0 → 0` clamp with a **positivity-preserving flux limiter**: scale each cell's outgoing face fluxes so outflow × dt ≤ the cell's volume, consistently for both cells sharing a face, and apply drain accounting to the limited fluxes. Keep a debug assert `h ≥ −1e-6`. Test: a sharp 8×8 box of 1.5 mm with default params, run 1.0 s; relative volume error (on canvas + drained) < 1e-6.
  - [x] _(audit round 1, finding 2)_ **Upwind** the in-plane gravity term: on each face, mobility for the `ρ·g∥` part uses `h` from the upwind cell (by the sign of g∥ on that face). Pressure terms keep the centered face mobility. Test: the existing tilt config, after 0.2 s; the center row has no interior local minimum deeper than 1e-3 between two higher values (no sawtooth).
  - [x] _(audit round 1, finding 3)_ Stability bounds from analysis: capillary `Δ⁴/(32·M·σ)`, hydrostatic `Δ²/(4·M·ρ·g⊥)`, advective wave speed `h²·ρ·|g∥|/μ`. Document `dtSafety ∈ (0,1]`. Test: a uniform 1 mm film + ±1% checkerboard, capillary only (g⊥ = g∥ = 0), `dtSafety = 0.9`, 200 substeps; the checkerboard amplitude decreases monotonically.
  - [x] _(audit round 1, finding 4)_ Fix the `gravityFromTilt` doc comment (tiltX > 0 means the canvas top tips down, so flow goes toward the canvas top = grid −y), and add a test pinning the sign of g∥ for ±tiltX and ±tiltY.
- **Handoff notes:**
  - Audit round 1 fixes on `task/M1-01-cpu-thin-film`: donor flux limiter (α) + assert `h ≥ −1e-6`; upwind mobility for `ρ·g∥`; capillary dt `Δ⁴/(32 M σ)`, wave speed `h² ρ |g∥| / μ`, `dtSafety ∈ (0,1]`; `gravityFromTilt` comment + sign tests.
  - Needed for 1e-6 box conservation: `Grid2D.data` is now **Float64** (Float32 quantization over ~10⁴ substeps was ~2.5e-5 relative gain). GPU compare paths still cast/read f32 separately.
  - Open edges: Neumann ghosts for pressure/laplacian (no capillary cliff vs `p_ext=0`); exterior faces carry gravity drain only, inward exterior flux zeroed. Fixes checkerboard blow-up at `dtSafety=0.9`.
  - New tests: sharp box 1.0 s rel err < 1e-6; tilt sawtooth local-min probe; capillary checkerboard monotonic decay; tilt sign pins.
  - `npm run check` passes. No new dependencies. ADR 0003 / M1-06 still pending user OK (audit finding 5).

### M1-02 GPU thin-film flow
- **Status:** done ([audit](audits/2026-11-21-M1-02.md), round 2 pass)
- **Depends on:** M0-04, M1-01
- **Goal:** Port M1-01 to WGSL compute passes.
- **Acceptance criteria:**
  - [x] Flux pass + height-update pass (ping-pong), with parameters from uniforms
  - [x] Debug-overlay button "Compare to CPU": runs 100 steps on a 64×64 grid on both and shows the max abs difference (target < 1e-3 relative)
  - [x] _(changed per ADR 0003)_ Report throughput instead of requiring 60 fps: the debug overlay shows substeps per frame and **sim-seconds per wall-second** at 512² with default paint params. Record the numbers and the GPU model in the handoff notes. Explicit substeps are capped per frame, so the UI stays responsive (the sim runs slower than real time instead of freezing).
  - [x] _(from M0-04 audit)_ Ping-pong bind groups are built once (A→B and B→A) and chosen by parity. No `createBindGroup` in the per-frame or per-substep path.
  - [x] _(from M0-04 audit)_ Uniform layout round-trip check: a tiny compute pass copies every field of the flow-parameter uniform struct into a storage buffer, it's read back, and it's compared with `packUniforms` input. Runs from the same debug-overlay harness as "Compare to CPU".
  - [x] _(audit round 1, finding 1)_ **Per-substep uniforms:** a uniform ring with `MAX_SUBSTEPS_PER_FRAME` slots (256-byte aligned), written in one `writeBuffer` per frame and bound with dynamic offsets. Each substep reads its own `dt`. Remove the per-substep `writeBuffer`.
  - [x] _(audit round 1, finding 2)_ "Compare to CPU" also runs (a) a **mixed-dt** sequence (e.g. 50 × dt then 50 × dt/10) through the real frame-encoding path, in one encoder, and (b) a **tilted** case (`gravityFromTilt(0, 0.3)`, puddle 8 cells from the +x edge, 400 substeps), comparing height (< 1e-3 relative) and drained volume (< 1e-3 relative). The overlay shows all three results.
  - [x] _(audit round 1, finding 3)_ `hMaxHint` comes from a GPU max-reduction of `h`, read back asynchronously at most every ~10 frames, with a 10% margin. CPU-side height writes still raise it immediately. Record the before/after throughput at 512² in the handoff notes.
- **Handoff notes:**
  - Audit r1: uniform **ring** (`UNIFORM_RING_SLOTS=128`, stride 256) + `hasDynamicOffset`; one `writeBuffer` per `encodeSubsteps` / frame. Frame still caps at 64 substeps.
  - Compare harness: level (equal dt) + mixed-dt (50×dt + 50×dt/10, one encoder) + tilted (`gravityFromTilt(0,0.3)`, puddle 8 from +x, 400 steps, height + drain). Overlay shows all three. Fixed `return await` so `finally` doesn't destroy textures before readback.
  - `flow_hmax.wgsl` atomic max-reduction; async readback every 10 frames × 1.1 margin; CPU `writeHeight` still raises hint immediately.
  - Throughput @ 512² nvidia: **before** hMax refresh ~1.2e-2 sim-s/wall-s (pessimistic frozen hint); **after** spreading + reduction ~2.4–2.6e-2 (still 64 substeps/frame while requested frame dt isn't finished — ADR 0003 / M1-06).
  - `npm run check` passes (78 tests). No new dependencies.

### M1-06 Semi-implicit capillary step (ADR 0003)
- **Status:** done ([audit](audits/2026-11-21-M1-06.md); follow-up M1-06b required)
- **Depends on:** M1-01, M1-02
- **Goal:** Remove the Δ⁴ capillary timestep limit, so 512² can run at real time or faster. See [ADR 0003](decisions/0003-semi-implicit-capillary.md).
- **Acceptance criteria:**
  - [x] CPU reference `thinFilmStepSemiImplicit`: freeze the mobility at the step start, treat `−∇·(M∇(−σ∇²h))` implicitly, and solve with a fixed number of iterations (Jacobi or red-black Gauss–Seidel, or a split into two coupled 2nd-order solves; document which and why). Gravity and advection stay explicit, upwinded and flux-limited, as in M1-01.
  - [x] The step size is limited only by the hydrostatic and advective bounds (and a cap for accuracy), not by `Δ⁴/(32Mσ)`
  - [x] Accuracy test: on a 64² puddle, the semi-implicit result at Δt = 20× the explicit limit stays within 2% (relative L∞) of the explicit solver run at its own stable Δt for the same sim time
  - [x] Conservation: volume (on canvas + drained) conserved to 1e-6 relative over 1 s of sim time
  - [x] Stability test: the checkerboard from M1-01, at Δt = 50× the explicit capillary limit, decays without oscillating
  - [x] GPU port behind a toggle (explicit / semi-implicit), with "Compare to CPU" covering both modes
  - [x] Throughput at 512² recorded in the handoff notes. Target: ≥ 1 sim-second per wall-second with default params.
- **Handoff notes:**
  - Scheme (commented at the top of `src/sim/cpu/thinFilmSemi.ts`): freeze Mⁿ = hⁿ³/(3μ); q = q_ex(hⁿ) + q_cap(h*) with q_cap = M σ ∇(∇²h) backward-Euler; commit an FV update from hⁿ using the M1-01 donor limiter. Exterior capillary flux is 0. Iteration is **two-color Jacobi, 20 red/black pairs** (`SEMI_IMPLICIT_SWEEPS`). Each color reads the field from the start of that half-sweep, because the biharmonic stencil has radius 2 and reaches the same color — a parallel GPU dispatch of one color is Jacobi-within-color, not sequential Gauss–Seidel. Not a Poisson split: M varies in space. Diagonal a_ii = ∂(∇·q_cap)/∂h_i with Neumann ghosts. Δt = dtSafety × min(64 × explicit capillary Δt, hydrostatic, advective). The 64× factor is an accuracy cap on the frozen-M linearization, not a stability bound.
  - CPU tests: FD diagonal < 1e-4; Δt > 10× the explicit capillary bound; 64² puddle, 4 steps at 20× capillary Δt, rel L∞ < 2% vs explicit over the same sim time (σ = 8 mN/m, dtSafety 0.5); 32² volume (canvas + drained) < 1e-6 over 1 s; 24² checkerboard, 8 steps at 50× capillary Δt, amplitude monotone and < 0.02.
  - GPU: `flowMode` `'explicit' | 'semi'`. Semi substep (one encoder slot): seed texture→storage, explicit-only flux (`flow_semi_explicit.wgsl`, σ omitted), 20× even then odd (`flow_semi_gs.wgsl`), assemble limited FV into the ping-pong write texture (`flow_semi_assemble.wgsl`). Overlay toggle. Compare-to-CPU adds a semi case (64², 4 steps at 20× `explicitCapillaryDt`).
  - Browser (nvidia, 512², default params): semi mode 60 fps, 15–29 substeps/frame (under the 64 cap), **sim/wall 1.00e+0 s/s** — the 1/60 s frame dt finishes, so the ratio saturates at real time. Explicit on the same view stays at 64 substeps/frame and 2.47e-2 s/s. Compare: level 1.71e-7, mixed-dt 2.63e-7, tilt 3.89e-7 / drain 1.77e-5, **semi 1.82e-6**.
  - `npm run check` passes (84 tests). No new dependencies. Explicit solver unchanged. Drain counter and hMax epoch still belong to M1-04.

### M1-06b Unconditionally convergent semi-implicit solve
- **Status:** todo ([audit round 2](audits/2026-11-21-M1-06b.md): fixes verified; the user chose 20 sweeps). Continue on the existing branch `task/M1-06b-damped-jacobi`.
- **Depends on:** M1-06
- **Goal:** Remove the ~75× divergence cliff found in the [M1-06 audit](audits/2026-11-21-M1-06.md), so the 64× cap really is just an accuracy limit.
- **Acceptance criteria:**
  - [x] The inner iteration converges for any Δt. Use **damped Jacobi** (ω from the stencil bound; document the derivation, ω ≈ 0.5 expected) or another scheme you can show is convergent (document it). Apply it in both the CPU reference and the GPU shaders.
  - [x] Stability test: a 1 mm film + 20% white noise (seeded), capillary only, dx = 300/512, Δt = **200×** and **1000×** the explicit capillary Δt, 60 steps. The std of the noise decreases and the peak stays ≤ the initial peak.
  - [x] No odd/even ripple: a Gaussian puddle (64², default params), 0.5 s at `dtSafety = 1.0`. The 2D roughness (mean |h − 4-neighbour average| over the interior) is within 10% of the explicit solver's, and the center row has exactly one interior maximum.
  - [x] Accuracy test with **default** params (σ from physics.ts, no overrides beyond dx): 64² puddle, 0.25 s, at 64× the explicit capillary Δt, relative L∞ vs explicit < 1%
  - [x] Fix the `SEMI_IMPLICIT_ACCURACY_FACTOR` comment so it matches reality once stability no longer depends on it. If sweep count or ω changes throughput, record the new 512² sim-s/wall-s in the handoff notes (target still ≥ 1).
  - [x] GPU "Compare to CPU" semi case still < 1e-3 relative
  - [x] _(audit round 1, finding 1)_ **Remove the uniform-shift fallback** (`SEMI_IMPLICIT_FLUX_RESIDUAL_MM` and the "keep h\* + shift + rescale" branch). The CPU always commits the limited flux form, exactly like the GPU. Restore the `h ≥ −1e-6` assert after limiting.
  - [x] _(audit round 1, finding 2)_ The 200× and 1000× noise tests pass on the flux path. Hard requirements: finite, peak ≤ initial, volume (canvas + drained) within 1e-6. Noise std should decrease; if 1000× doesn't, report the numbers in the handoff notes.
  - [x] _(audit round 1, finding 3)_ **Pour-spike test:** a 1 mm Gaussian puddle (radius 8) plus a 3 mm spike (radius 1.5) at +6 cells; 64², dx = 300/512, default params, 0.25 s, dt = 64 × the current explicit capillary Δt. CPU semi vs explicit rel L∞ < 1%, and the corner height within 1e-6 of explicit. The same case is in the GPU "Compare to CPU" harness: GPU semi vs CPU semi < 1e-3.
  - [x] _(audit round 1, finding 4)_ The heavy semi tests get explicit timeouts (≥ 60 s), or are slimmed, so CI keeps headroom. Note the suite runtime in the handoff notes.
  - [ ] _(audit round 2, user decision 2026-11-21)_ Set `SEMI_IMPLICIT_SWEEPS` back to **20** (CPU and GPU share it). This **supersedes** the 200×/1000× requirement above: replace those noise tests with one at **128×** the explicit capillary Δt (2× the scheduler cap), 60 steps. It must be finite, peak ≤ start, volume within 1e-6, std decreasing.
  - [ ] _(audit round 2)_ Guard: `thinFilmSubstepSemiImplicit` and the GPU semi path reject (throw / assert in dev) any dt above `SEMI_IMPLICIT_ACCURACY_FACTOR` × the explicit capillary Δt of the current field, with a 10% tolerance for hint rounding. Add a test.
  - [ ] _(audit round 2)_ Re-measure thick-film throughput at 512² in semi mode (right after reset), and once spread. Record FPS, substeps/frame and sim/wall in the handoff notes. Target: 60 fps / 1.00 sim-s/wall-s in both phases. Note the new suite runtime.
- **Handoff notes:**
  - Removed `SEMI_IMPLICIT_FLUX_RESIDUAL_MM` and the CPU-only "keep h* + uniform shift + rescale" branch. Every step commits the limited flux form hⁿ − Δt ∇·(q_ex + q_cap(h*)), same as the GPU, then asserts h ≥ −1e-6 and clamps tiny negatives to 0. No residual threshold, no second commit path.
  - Damping derivation is unchanged at the top of `src/sim/cpu/thinFilmSemi.ts` (ρ(D⁻¹A) = 3.2, ω = 1/2 < 0.625, worst-mode factor 0.6). Sweep count is now **70** pairs (`SEMI_IMPLICIT_SWEEPS`), shared with the GPU. Twenty pairs contract the stiff mode but the flux commit multiplies the leftover by Δt a_ii. On the 1000× noise case that left peak 6.3 mm (start 1.20); 60 pairs still overshot at 1.35 mm; 70 pairs keep the peak at 1.14 mm. Std decreases at both 200× and 1000×, so there is no std-failure caveat. Volume (canvas + drained) stays within 1e-6.
  - Pour-spike: 64², dx = 300/512, default params, 1 mm Gaussian (radius 8) plus a 3 mm spike (radius 1.5) at +6 cells, 0.25 s, dt = 64 × the current explicit capillary Δt. CPU semi vs explicit rel L∞ < 1% and the corner matches explicit within 1e-6 (test 29.3 s). GPU Compare to CPU, same case, GPU semi vs CPU semi **spike rel 5.70e-6** (limit 1e-3). Other compares: level 1.71e-7, mixed-dt 2.63e-7, tilt 3.40e-7 / drain 1.77e-5, semi 2.05e-6.
  - Timeouts: conservation, noise, and ripple 60 s; 64× accuracy 120 s; pour-spike 180 s. `npm run check` 50.9 s wall, vitest 46.2 s, semi file 45.8 s, 89 tests. No new dependencies. Explicit solver unchanged.
  - Throughput, nvidia, 512², semi mode, 70 sweeps: while the film is still thick (25 substeps/frame) **FPS 32, sim/wall 5.33e-1 s/s**. After it spreads (14 substeps/frame) the frame fits again: **FPS 60, sim/wall 1.00e+0 s/s**. Was 1.00e+0 at 20 sweeps and ~22 substeps. No sweep-count special case by timestep.

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
  - [ ] _(from M1-02 audit, finding 4)_ Replace the `atomic<u32>` micro-mm³ drain counter (it wraps at ≈ 4.3 ml and truncates every add) with per-border-face `f32` accumulators, one slot per border face, owned by one thread. Sum them in float64 on the CPU at sync, then clear. Sync at least once a second, and on demand for stats. Test: tilted drain of > 10 ml matches the CPU reference within 1e-3 relative.
  - [ ] _(from M1-02 audit, finding 3)_ Pour deposits raise `hMaxHint` immediately (by at least the deposited peak), so the timestep stays stable while pouring
  - [ ] _(from M1-02 audit r2)_ A stale hMax readback must not lower the hint below a pour bump made after that reduction was scheduled (epoch-tag each reduction; `hint = max(measured × 1.1, bumps since epoch)`). Test: schedule a reduction, pour, resolve the reduction; the hint stays ≥ the post-pour peak.
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
- _(M1-01 audit r2)_ Bump `actions/checkout` and `actions/setup-node` to v5 in `.github/workflows/check.yml` (v4 targets the deprecated Node 20 runtime).
- _(M1-02 audit, finding 5)_ GPU `flow_update.wgsl`: count `hNew < −1e-6` events in a debug atomic, and show it in the overlay (it should always be 0, as a tripwire for the flux limiter).
- _(M1-02 audit r2)_ Guard `ThinFilmGpu.encodeSubsteps` against being called twice on the same `GPUCommandEncoder` (it would overwrite the uniform ring and silently bring back the mixed-dt bug). Throw, or document it loudly.
- _(M1-01 audit fix, resolved in M1-02)_ CPU↔GPU compares quantize the CPU `Grid2D` (Float64) to f32 before `maxAbsDiff`.
