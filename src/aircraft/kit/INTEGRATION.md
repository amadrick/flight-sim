# Aircraft kit — integration notes (for the integrator and the render / camera owners)

Nothing outside `src/aircraft/kit/**`, `src/aircraft/f16/{visual,geometry}.js` and `src/aircraft/b738/{visual,geometry}.js`
was changed. The items below are requests / facts for integrator-owned code.

## Contract
* `createVisual(ctx, opts?)` — the session calls it with one argument, which gives the default livery. To expose
  liveries, pass `{ livery }` (each visual module exports `LIVERIES`; unknown names fall back to the default) —
  e.g. from a URL param `livery=` in `core/session.js`, or `def.liveries = LIVERIES` in the aircraft `index.js`.
* The returned object also carries `stats = { triangles, drawCalls, buildMs, phases }`, `parts`, `livery`, `liveries`.
  `update(state, dt)` tolerates missing / extra fields; `dispose()` frees geometry, materials, atlas textures and canvases.

## Render pipeline
* **Glass** (canopies, HUD combiners) is placed on `LAYERS.POST` with `depthWrite: false`, premultiplied
  `ONE / ONE_MINUS_SRC_ALPHA` blending and `renderOrder 5`. It needs the post pass to (1) **depth-test against the scene
  depth** (the stub composites layer 1 without depth, so glass shows through the airframe from behind) and
  (2) ideally have the scene lights and `scene.environment` bound. Without lights / env map the material falls back to
  `ctx.env.sunDir / sunColor / ambientSky / ambientGround` (read once at build: please keep those objects and mutate
  them in place). Pass `createVisual(ctx, { glassLayer: LAYERS.MAIN })` to draw glass in the main pass instead.
* **Lamps and afterburner glow** are `MeshBasicMaterial`s with HDR colours (nav ≈ 22, landing ≈ 700, strobe ≈ 900,
  afterburner core ≈ 16) on layer 0; they rely on the HDR target + tone mapping, and look right with bloom.
  They are scaled down at night via `ctx.env.nightFactor`.
* Cabin windows / instrument screens use the atlas emissive map; the 737 drives `emissiveIntensity` from `nightFactor`.
* Atlas materials are plain `MeshStandardMaterial` (map, normalMap, roughness/metalness map): they pick up
  `scene.environment`, shadows and fog like any other mesh. All meshes cast and receive shadows (glass, lamps and glow
  do not cast).

## Camera
* The pilot figure is hidden when a perspective camera is within 0.75 m of `geometry.pilotEye` (detected in
  `onBeforeRender`, one frame late).
* **Cockpit near plane**: the stub camera uses `near = 0.5`. In the 737 the side posts and the roof lining are
  0.45–0.6 m from the eye, so they are clipped; `near ≤ 0.1` in cockpit view fixes it (the F-16 is fine down to 0.3).
* Canopy / windshield glass is single-sided (invisible from inside) so the pilot's view is clear; the airframe skin is
  also back-face culled, so interior liners are what the pilot sees.

## geometry.js changes (field names and gear order unchanged; gear contact points and cgHeight untouched)
* `f16`: `engines[0].nozzle → [0, 0.13, 6.48]`, `intake → [0, -0.42, -3.6]`, `nozzleRadius 0.5`; `wingtips`
  (missile rail ends) `[±4.78, 0, 1.6]`; light positions moved onto the model (intake-side / wingtip nav lights, fin-tip strobe).
* `b738`: `wingtips → [±17.9, 3.1, 8.4]` (winglet tips); nav lights at the wingtip leading edge, tail light / strobe on
  the tail cone, beacon on the crown.

## Budgets measured in the harness (software GL container, `quality=high`)
| | triangles | draw calls | atlases | build (geometry / paint / textures / rig) |
|---|---|---|---|---|
| F-16C | 34.9 k | 42 | 1 × 2048² | ≈ 350 ms (160 / 105 / 45 / 45) |
| 737-800 | 35.1 k | 51 | 2 × 2048² | ≈ 340 ms (150 / 105 / 45 / 40) |

Build times are from the shared software-rendering container; expect roughly a third on a desktop.
