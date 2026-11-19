# Clouds module: integration notes

Owner: clouds agent. Files: `src/clouds/**` only. Nothing outside this directory was changed.

## Public API (`createClouds(ctx)`)

| member | notes |
| --- | --- |
| `update(dt)` | advects the air mass with `ctx.weather.wind`, eases cloud parameters, schedules lightning, updates `cameraInCloud` |
| `render(frame)` | `frame = { renderer, camera, depthTexture, width, height, dt }` (as the stub pipeline passes it). Restores render target and `autoClear`. Must run after the scene depth is written and after the frame uniforms (incl. `uPrevViewProj`) were updated |
| `texture` | getter. **Full resolution** RGBA16F (same size as `frame.width x frame.height`), rgb = premultiplied in-scattered radiance (already includes aerial perspective and lightning glow), a = transmittance. Composite: `scene * a + rgb`. The object is stable between frames (re-created only on resize / quality change, so re-read the getter each frame as the stub pipeline does) |
| `shadowGLSL` | defines `float cloudShadow(vec3 renderPos)` (direct-sun transmittance, 1 = clear) and, as an extra, `float cloudDiffuseTransmittance(vec3 renderPos)` (two-stream estimate for scaling sky/ambient light under cloud, always >= `cloudShadow`) and `float cloudShadowTau(vec2 worldXZ, float altitude)`. Needs `FRAME_UNIFORMS_GLSL` (`uCameraPos`, `uOrigin`) in the same shader |
| `shadowUniforms` | `tCloudShadowMap, uCloudShadowA, uCloudShadowB, uCloudShadowC`. The uniform objects are stable; spread them into the material once. Strength is 0 when there are no clouds (`cloudShadow` returns 1) |
| `setScatterModel(model)` | `model = { glsl, uniforms }` or `null` (default). `glsl` must define exactly `float cloudSunScatter(float tauSun, float tauUp, float cosTheta)` returning J in sr^-1 (single + multiple scattering). A sample's sun term is `sunIrradiance * cloudSunScatter(...) * sigma_s * stepLength * viewTransmittance`. `tauSun` = optical depth from the sample towards the sun, `tauUp` = optical-depth proxy towards the cloud top (how deep inside the cloud the sample sits), `cosTheta` = dot(view ray, light direction). The helper `float clHG(float cosTheta, float g)` is available to the replacement (it is prepended when the replacement does not define it). Recompiles the march material and resets the temporal history |
| `densityAt(worldPos)` | CPU mirror of the low-frequency density, 0..1 (no detail erosion); for IFR checks, icing, turbulence |
| `cameraInCloud` | 0..1, smoothed (about 0.2 s) |
| extras | `weatherAt(worldX, worldZ, out)` -> `{ m, dev, rain, vari }` large-scale field (coverage potential, vertical development, precipitation, variation) under a point, `windOffset` (accumulated air-mass offset, Vector2 xz), `params` (current derived cloud parameters), `debug` (render targets, uniforms, `spawnFlash(worldX, worldZ)`) |

Events: listens to `quality:change`, `weather:change`, `camera:mode`, `session:start`; emits `lightning` with
`{ worldPos: Vector3, intensity: 0..1 }` at the first stroke of each flash (audio can delay thunder by distance / 343 m/s).

## Round three (cloud shapes)

The density model now draws cumulus as **individual clouds** instead of thresholded 3-D noise; the decks and the
storm keep the noise model. Fitted to a small cumulus LES (`tools/neural/les_cumulus.py`, `les_stats.py`, `les_fit.py`).

- **Cell field** (`noise.js createCellField`, CPU, ~40 ms at boot, 512^2 RGBA8, 20.48 km tile): disks with a power-law
  size distribution n(D) ~ D^-2.5, 240 m .. 4.2 km, placed with clear air between them. One extra 2-D fetch
  (`tClCells`) per density evaluation.
- **Per cell** (`clShape`): flat base at the condensation level; depth = diameter x aspect (1.0 undeveloped .. 2.0
  developed, 3.0 in convective weather); width profile g(h) fitted to the LES (`uClProf`, `uClProf2`, mixed by the
  local development; results in `tools/neural/results/profile_fit.json`); turrets from the base volume sampled at
  a frequency that follows the cell size (self-similar: 300 m humilis get 100 m bulges, congestus 1-2 km towers
  with sub-turrets), Worley cones turned into spherical caps (round bubbles, sharp creases); the detail volume
  is scaled with the cell as well; towers lean downwind (`LEAN_TIME` x the shear between base and top).
- **Life cycle**: each cell has a random phase; decaying cells (and weak cells at low coverage) get a wider density
  ramp, more and wispier erosion and less water (soft frayed fragments); growing cells stay crisp.
- **Coverage** switches cells on by their random id and grows them past their rim when it is high (they merge).
- **Broken** skies add a ~600 m stratocumulus sheet at the base from the shape noise (`uClCell.w`); **overcast** and
  **storm** use the round-two layer model (stratus deck with ragged base; Cb towers + anvil).
- **Light march**: the shadow-map lookup beyond the 4 near samples uses the cubic B-spline fetch (4 taps, was 1
  jittered tap) with a jitter of +-3 map texels along the light slope (was up to +-10 texels). The B-spline alone
  still printed the map's texel-scale structure as fine horizontal bands on faces lit at grazing sun (checked:
  `clLS=1` banded, `clLS=3` clean); the smaller jitter is less noisy than round two's. The 4 light samples reuse
  the sample's weather fetch (the field varies over kilometres), which pays for their cell fetch.
  Debug A/B: `clLS=0` = round-two single jittered tap, `clLS=k` = B-spline with +-k texels.
- **Resolve**: while a pixel's history holds fewer than ~6 samples (boot, cut, disocclusion) the current frame is
  reconstructed from a depth-aware 4x4 Gaussian of the low-res samples instead of the nearest 4: no dots in thin
  cloud in a 6-frame capture. Converged pixels are unchanged.
- **Ambient**: the march uses `ctx.pipeline.lighting.ambientRaw` (clear-sky probe) and builds its own ground bounce
  (sun x cloud-field transmittance + sky, x ground albedo) instead of `uAmbientSky / uAmbientGround`, which the
  pipeline divides by the player's cloud shadow. Falls back to the uniforms without `lighting`. `clRawAmb=0` = old.
- **Cirrus**: the baked texture is ridged anisotropic noise (thin fibres in bundles, uncinus heads) and the layer
  adds a finer second octave of it (1 extra 2-D fetch per pixel); little haze between fibres.

Cost vs round two: per loop iteration +1 2-D fetch where the column is not empty (cell field); per lit sample +3
(B-spline shadow-map fetch); light march unchanged (cell fetch replaces the weather fetch); same step counts.
New debug parameters: `clLean` (s), `clSheet`, `clAspLo`, `clAspHi`, `clPt` (turret), `clPl` (lobes), `clLS`, `clRawAmb`.
Harness: `view=cirrus` shows the cirrus texture.

## Round two (neural clouds 2) changes

- `setScatterModel`: a model whose GLSL also defines `vec2 cloudAmbientVis(float tauUp, float tauDown)` replaces the
  hand-written sky / ground-bounce visibility (`#define CL_AMBIENT_VIS`): `S = E J + ambUp V.x + ambDown V.y`. The
  round-two neural model (src/neural/cloud-light.js) provides it; `scatter=classic` keeps the old formula.
- `cloudShadow()` / `cloudDiffuseTransmittance()` (the pipeline-facing lookups) use a cubic B-spline filtered fetch
  (4 bilinear taps instead of 1): no more square / diamond facets along shadow edges on the ground. The march's own
  `cloudShadowTau()` stays at one fetch.
- Density: all three octaves of the detail volume from the one fetch, detail period 1900 -> 1350 m, erosion 0.24 ->
  0.28 (cumulus), almost no erosion in the lowest ~8 % of a cell (flat condensation level), crisper density ramp
  (`edge = clamp(ds * 0.0005, 0.009, 0.05)`), light-march samples one half mip finer (sharper turret self-shadows).
  Same step counts, no extra fetches in the march.
- Dev harness: `sim.exportDensity({ size, nxy, find, edge })` samples the real density GLSL on a grid for the
  ground-truth comparison (tools/neural/gt_*.py), e.g.
  `node tools/shot.mjs --entry src/clouds/harness.js --html dist/clouds.html --frames 4 --size 320x180 --params "weather=scattered&tod=12&cy=4200" --eval "sim.exportDensity({size:5760,nxy:192})" > tools/neural/gt_data/export_scattered.txt`.

## Contract deviations / things to know

1. `texture` is full resolution (the module does its own depth-aware temporal upsample), so the composite can use a
   plain `texture(tClouds, vUv)` fetch; no bilateral filter is needed in the pipeline.
2. The atmosphere GLSL is read once from `ctx.pipeline.atmosphere.glsl` when the module is created (pipeline first, as
   in `main.js`). If the pipeline ever swaps the atmosphere GLSL at run time, emit `quality:change` or tell me.
   Atmosphere functions are called outside all loops: 2x `atmSunIlluminance`, 2x `atmAmbient`, 1-2x
   `atmAerialPerspective` per ray.
3. Moonlight uses an artistic irradiance (`0.05 * (0.62, 0.78, 1.0)` in `uSunColor` units, scaled by the moon's
   elevation; phase is not known to this module). If the sky module exports a moon illuminance uniform, wire it into
   `uClMoonE` in `index.js`.
4. Lightning glow is added on top of the temporally filtered result (it is not accumulated), so a flash is one
   frame sharp. Flash colour is `uClFlashColor` (18, 21, 26) in scene radiance units; auto-exposure at night will make
   it very bright, which is intended.
5. Terrain / water / aircraft shaders should multiply direct sun by `cloudShadow(renderPos)` and, ideally, sky ambient
   by `cloudDiffuseTransmittance(renderPos)` (otherwise the ground under a storm stays too bright). The harness
   composite in `harness.js` shows both in use.
6. `cloudShadow` covers 82 km around the camera; beyond the map it fades to a uniform value derived from the coverage.
7. The camera is treated as cut when it moves more than 600 m or turns more than about 72 degrees in one frame; other
   cuts should emit `camera:mode` (already in the contract) so the history is dropped.

## Cost budget (quality `high`: 80 steps, march at 1/2 resolution = 1/4 of the pixels per frame)

Passes per frame: march (1/N res, 2 MRT RGBA16F), resolve (full res, 2 MRT: 8 fetches of the low-res targets + 2 history
fetches + 1 depth), output copy (full res, 2 fetches), shadow map strip (1/8 of 512^2..1024^2, 12-24 samples each of
weather + base), weather map (1024^2, about once per second).

March, measured in the harness (averages over all rays):

| view | loop iterations / ray | lit samples / ray |
| --- | --- | --- |
| scattered, from 300 m looking up | 18.3 (max 80) | 1.2 (max 14) |
| scattered, inside the layer, horizontal | 47.8 (max 80) | 1.45 (max 29) |
| broken, from 6 km looking down | 16.0 (max 65) | 2.3 (max 11) |
| storm, under the base | 29.9 (max 80) | 8.9 (max 29) |

One loop iteration = 1 weather-map fetch (2D) and, when the column is not empty, 1 base-noise fetch (3D, mip-biased).
One lit sample adds: 1 detail 3D + 1 curl 2D (+1 detail 3D near the camera), the light march (4 steps at `high`, 6 at
`ultra`, 3 at `low`: each 1 weather + 1 base fetch) and 1 shadow-map fetch: about 12 fetches at `high`. Rain samples
cost 1 shadow-map fetch. Per ray, once: blue noise, depth, cirrus (1 fetch), atmosphere functions as listed above.
Clear sky: the volumetric loop is skipped by a uniform branch; with cirrus = 0 as well the module renders nothing.

Quality mapping: steps = `quality.cloudSteps`, N = round(1 / `quality.cloudScale`) (1..4), shadow map 256/512/1024,
view distance 150 km (`low`) / 200 km, reduced in low visibility (never below 60 km).

Boot: noise volumes (128^3 Perlin-Worley + 32^3 Worley, GPU slices) + 2D noise + blue noise: about 1.1 s under
SwiftShader in the test harness, expected well under 0.3 s on a real GPU.

## Debug URL parameters (read from `ctx.params.raw`, all optional)

`cloudSteps, cloudScale, cloudDist, clBase, clDetail, clErosion, clSigma, clA, clB, clD, clTaper, clKf, clMinFine,
clMinCoarse, clAlpha, clAlphaExact, clCount`. `clCount=1` makes the march write the lit-sample count (instead of the
iteration count) to its aux target for profiling.

## Dev harness (not shipped)

`src/clouds/harness.js` is a stand-alone entry with a free camera:
`node tools/shot.mjs --entry src/clouds/harness.js --html dist/clouds.html --out shots/x.png --params "weather=broken&tod=16&cy=2600&yaw=292&pitch=2&hud=0&quality=high"`.
Parameters: `cx, cy, cz, yaw, pitch, fov, vx, vy, vz, yawRate, ac=1 (chase camera on the player aircraft), view=march|weather|shadow|base|detail,
wx=<preset>&wxAt=<frame> (switch weather mid-run), flashAt=<frame> (force a lightning flash ahead of the camera), exp, noclouds=1`.

## Requests to the integrator

- None are blocking. Nice to have: (a) a moon illuminance in the frame uniforms, (b) the final pipeline applying
  `cloudShadow` to the sun disc/bloom is NOT needed (the cloud texture's transmittance already occludes the sky),
  (c) if TAA jitter is ever added to the scene projection, pass the unjittered `uPrevViewProj` / tell this module,
  since the cloud history assumes an unjittered camera.
