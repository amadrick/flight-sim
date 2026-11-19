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
