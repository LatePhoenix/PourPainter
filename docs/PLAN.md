# PourPainter — Project Plan

An interactive acrylic pour painting simulator. You pick paints, mediums, and additives such as silicone, choose a pour technique, then tilt, torch, swipe, and blow the paint around. The simulation models how the paint flows, layers, forms cells, and dries.

---

## 1. Research summary

### 1.1 Pour techniques to support

| Technique | What happens physically | Sim requirements |
|---|---|---|
| **Dirty pour** (open cup) | Colors are layered in one cup and poured out. The stream mixes the layers into streaks. | Cup with a vertical layer stack, a pour stream that follows the cursor |
| **Flip cup** | The layered cup is turned upside down onto the canvas and lifted. The layers spread radially in reverse order. | Instant "release" of the cup column, radial spreading |
| **Puddle pour** | Each color is poured into the previous puddle, making concentric rings. | Sequential pours at one point |
| **Tree ring / ring pour** | Paint goes through a spout or squeeze cup in a slow circular or wobbling motion, then the canvas is tilted. | Pour path tool (spiral, wobble), then tilt |
| **Split cup / hourglass / funnel** | A divided cup, or paint dripping through a funnel or bottle, gives symmetric radial patterns. | Cup presets with multiple compartments |
| **Colander / strainer** | Paint is poured through holes, giving many small streams that make flower-like patterns. | Multiple point sources from a mask |
| **Swipe** | A thin "swipe color" (often white) is put down, then the top layer is dragged across with a damp paper towel or card. This reveals and stretches cells. | Drag tool that moves only the *top* layer, a thin-film shear |
| **Dutch pour** | Thin paint is pushed with a hair dryer or straw. Very thin mixes make lacy edges. | Air-jet surface stress tool, low viscosity |
| **Bloom** | A Dutch-pour variant: a ring of base paint is blown outward from the center, making petals. | Air tool + radial preset |
| **String pull** | A paint-loaded string is laid in a curl and pulled out, making wing or flower shapes. | Line-segment drag tool (a polyline with pickup and deposit) |
| **Balloon smash / Ghost / Wing pour** | Variants of drag and press tools. | Stretch goal: stamp-and-lift tool |

### 1.2 Paint and additive model

- **Paint**: pigment color plus **density**. Density matters most. Titanium white and other heavy pigments sink, and lighter pigments rise through them.
- **Pouring medium** (Floetrol, Liquitex, PVA glue): sets **viscosity** and slows drying. The usual target is "warm honey" consistency.
- **Water**: lowers viscosity. It also lowers binder strength (crazing risk), which could be modeled as a lower-quality dry finish.
- **Silicone oil / dimethicone**: lowers local **surface tension**. Droplets rise, burst at the surface, and open holes that show the layers underneath. These holes are the cells. More silicone and less mixing gives bigger cells.
- **Torch / heat gun**: lowers viscosity and surface tension in one spot and helps silicone rise, which brings cells to the surface fast. It also pops air bubbles.
- **Drying**: viscosity rises over minutes, and that stops the motion in place.

### 1.3 Physics of cells

Two mechanisms show up in the sources and in practice:

1. **Density inversion (Rayleigh–Taylor instability)**: a heavier layer sits on a lighter one, so the lighter paint rises in plumes and breaks through. This can make cells **without silicone**. Some sources suggest density matters more than surface tension.
2. **Surface-tension gradients (Marangoni flow)**: a silicone droplet lowers the local surface tension, so the surface flows *away* from it. That opens a hole and shows the color below.

The simulator should model **both**, with a "realism" slider that lets you exaggerate either one.

---

## 2. Simulation approach

A full 3D Navier–Stokes solver is overkill and too slow. A paint film is about 1–3 mm thick on a canvas around 300 mm wide, so the **thin-film (lubrication) approximation** fits the physics and runs in real time.

### 2.1 Representation: layered height field (2.5D)

Each grid cell (e.g. 512×512 to 1024×1024 on the GPU) stores:

- `h`: total film height
- a **vertical stack of K layers** (K≈4–8), each with a paint ID or mix weights and a thickness fraction. This is what lets cells "reveal" what is underneath.
- `silicone`: concentration per cell, plus its depth position (it rises over time)
- `T`: local temperature (from the torch)
- `age`: drying progress, which feeds into viscosity

### 2.2 Flow (per frame, on the GPU)

1. **Film flow**: lubrication-equation flux `q = -(h³ / 3μ) · ∇p`. Here `p` includes gravity along the canvas tilt (the gravity vector comes from the tilt control) plus capillary pressure `-σ∇²h`.
2. **Marangoni term**: adds a surface flux `(h² / 2μ) · ∇σ`, where `σ` drops with silicone concentration and temperature.
3. **Buoyancy within the stack**: in each column, layers that are much less dense than the layer above them gradually swap upward (a simplified Rayleigh–Taylor model). Swaps are seeded with noise, so they form discrete plumes and not a uniform blend.
4. **Color advection**: move the layer stack with the film velocity. Use a high-order, low-diffusion scheme (MacCormack or BFECC) so thin color filaments and lacing stay sharp. Diffusion is what makes a sim look like mud.
5. **Cell events**: a silicone parcel that reaches the surface creates a local σ drop. The Marangoni outflow then thins the top layer around it, which shows layer 2, 3, and so on. Overlapping events give the classic cell-inside-cell look.
6. **Edge handling**: paint runs off the canvas edges into a "drip" sink, and the tilt drains it.
7. **Drying**: `μ` rises exponentially with `age` and finally freezes the state.

### 2.3 Rendering

- Composite the visible top layer, with optional semi-transparency for thin top films so lower layers glow through.
- Compute normals from `h` for glossy lighting, specular highlights, and lacing edges.
- Optional "dried" render mode: matte or gloss finish and slight crazing based on water ratio.
- Export to high-res PNG, and optionally a time-lapse video of the pour.

---

## 3. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Platform | **Web app** (desktop browser first) | Runs anywhere, easy to share paintings, GPU access |
| Language | **TypeScript** | Type safety for a complex simulation state |
| GPU compute | **WebGPU** (compute shaders, WGSL) | Real-time fluid sim at high resolution; WebGL2 fallback only if needed |
| UI | **React + Vite** | Paint mixer, cup builder, tool palette |
| State | Zustand | Simple and fast |
| Tests | Vitest (CPU reference solver), Playwright (UI) | Check GPU kernels against a small CPU version |
| Storage | IndexedDB (saved recipes and paintings), JSON recipe export | Offline, no backend needed at first |

Alternative if browser performance falls short: a native app in Rust + wgpu, which uses the same WGSL shaders and so ports with little rework.

---

## 4. App features and UX

1. **Paint shelf**: choose colors (color picker plus real pigment presets such as Titanium White, Phthalo Blue, and Quinacridone Magenta, with realistic relative densities). Each paint has sliders for medium:paint ratio, water, and silicone drops.
2. **Cup builder**: drag paints into a cup in layers, set the amount of each, and pick the cup type (single, split, funnel, colander, squeeze bottle).
3. **Technique picker**: presets set up the cup and tools for Dirty Pour, Flip Cup, Puddle, Tree Ring, Swipe, Dutch, Bloom, and String Pull.
4. **Canvas**: size and shape (square, rectangle, round), plus an optional base coat.
5. **Live tools**: Pour (follows the cursor), Tilt (drag a gimbal or use the arrow keys), Torch, Hair Dryer/Straw, Swipe, String, Spatula.
6. **Playback**: pause, slow motion, reset to the same seed, time-lapse export.
7. **Gallery**: save the painting along with its *recipe* (paints, ratios, technique, seed) so it can be replayed or tweaked.

---

## 5. Milestones

### M0: Foundations (1–2 weeks)
- Vite + React + TS scaffold, WebGPU init, and a full-screen canvas render
- Ping-pong texture framework for compute passes
- CPU reference solver for a 64×64 grid, used for tests

### M1: Single-fluid thin film (2 weeks)
- Height-field lubrication flow with gravity and a tilt control
- Pour tool that adds height under the cursor
- Lit, glossy rendering from normals
- **Done when:** you can pour a puddle and tilt it off the canvas edge, and it looks like liquid

### M2: Multi-color, low-diffusion advection (2 weeks)
- K-layer stack, advected with BFECC
- Cup with layered colors; dirty pour and flip cup
- **Done when:** a flip cup gives recognizable color rings that tilt into streaks without going muddy

### M3: Cells (2–3 weeks), the core feature
- Density per paint, plus the column buoyancy/plume step
- Silicone parcels, Marangoni flux, and the cell-reveal events
- Torch tool (temperature field)
- **Done when:** a dirty pour with silicone, after torching, shows cell-inside-cell patterns, and the same pour without silicone shows few or no cells (unless there is a density inversion)

### M4: Technique tools (2–3 weeks)
- Swipe (shears only the top layer), Air jet (Dutch/Bloom), String pull, Puddle and Tree-ring pour paths
- Technique presets

### M5: Drying, finish, export (1 week)
- Viscosity ramp and freeze, finish modes, PNG and time-lapse export

### M6: Polish (ongoing)
- Gallery and recipe saving, pigment preset library, mobile/tablet with gyroscope tilt, and tuning sessions where sim output is compared to your real pours

---

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Colors blur into mud from numerical diffusion | BFECC/MacCormack advection plus discrete layer IDs instead of only RGB blending; optional particle-based color tracers for filaments |
| Thin-film equation is stiff (`h³` and capillary terms) | Smaller substeps, or a semi-implicit capillary step; clamp `h` |
| Cells look procedural or fake | Tune with photos of real pours; let cell size come from silicone amount × mixing × torch time, not from a fixed noise pattern |
| WebGPU support | Chrome/Edge have it; Safari and Firefox are improving. Keep a reduced-resolution fallback path |
| Scope creep from too many techniques | Every technique comes from a few core tools (pour path, tilt, heat, air, drag). Add presets, not new physics |

---

## 7. Open decisions for you

1. Desktop browser only to start, or should tablet with gyroscope tilt be in scope early?
2. **Realism or fun**: should the default be physically faithful, with slower pours and real drying times, or stylized and fast?
3. Pigment presets: real brand-specific paints (densities from manufacturer data), or generic pigment names?
4. Is time-lapse video export a must-have for v1?

---

## Sources
- [Flow Visualization course reports on acrylic pour cells (CU Boulder flowvis.org)](https://www.flowvis.org/wp-content/uploads/2019/10/Team-First-Report-Dimario-Cancanon.pdf)
- [flowvis.org Team Second Report (2023)](https://www.flowvis.org/wp-content/uploads/2023/11/Team-Second-Report.pdf)
- [Just Paint (Golden) on cells and surface tension](https://justpaint.org/?p=8117)
- [The Complete Acrylic Pouring Techniques Guide](https://acrylicpouring.com/the-complete-acrylic-pouring-techniques-guide/)
- [Acrylic Painting School: pouring techniques](https://acrylicpaintingschool.com/acrylic-pouring-techniques/)
- [Mont Marte: acrylic pouring techniques](https://www.montmarte.com/blogs/tips-techniques/acrylic-pouring-techniques)
