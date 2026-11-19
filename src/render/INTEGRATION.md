# Render pipeline — integration notes

`createPipeline(ctx)` (src/render/index.js) owns the sky/atmosphere, scene lighting, shadows, the frame graph and
post-processing. Nothing outside `src/render/**` was modified.

## Files
| file | what |
|---|---|
| `index.js` | pipeline: capabilities, targets, lighting outputs, shadows fit, frame graph, exposure, TAA/DRS control, events |
| `atmosphere-glsl.js` | `ATMOSPHERE_GLSL` (the public GLSL API, LUT lookups only) + `ATM_MODEL_GLSL` (medium model + ray integration, LUT passes only) |
| `atmosphere.js` | LUT generation passes (transmittance, multi-scattering, sky-view, aerial-perspective volume), weather coupling, CPU transmittance |
| `sky-glsl.js` | sun disc (limb darkening), moon (phase-correct), stars, Milky Way |
| `environment.js` | sky capture → PMREM (`scene.environment`, 256 px faces at high/ultra), refreshed incrementally; lower hemisphere = flat ground at the player's height with the near (runway) / far (terrain) radiance measured from the frame, through the aerial perspective |
| `shadows.js` | `KeyLight` (sun/moon), `FocusShadow` (2 cascades in one atlas), shadow sampling chunk, `sunShadow()` GLSL for raw shaders |
| `post.js` | TAA (motion-adaptive reconstruction filter / clip / history weight, motion in alpha), bloom pyramid, lens + AgX tone map, FXAA / CAS (motion-adaptive, bicubic upscale) + dither |
| `ao.js` | half-res SAO from depth (12 taps, fixed 4x4 Bayer rotation) + 4x4 bilateral blur; composite applies it to the ambient share only (direct share from the shadow map x N.L) |

## Public API
Contract (unchanged): `createPipeline(ctx) → { atmosphere: { uniforms, glsl }, setSize(w, h, dpr), render(dt), sceneTarget, depthTexture }`
with the four GLSL functions `atmSunIlluminance`, `atmSkyRadiance`, `atmAerialPerspective`, `atmAmbient` (exact
names/signatures). `uAtmHaze` from the stub API is still declared and updated.

The GLSL chunk compiles and works in **vertex and fragment** shaders: plain `texture()` on `highp sampler2D`, no
derivatives, no `gl_FragCoord`, no loops, include-guarded (`SKYWARD_ATMOSPHERE_API`). `ctx.pipeline.debug.testGLSL()`
compiles it in both stages and returns the logs. Fetch counts: `atmSunIlluminance` 1, `atmSkyRadiance` 1 (4 below
the horizon), `atmAerialPerspective` 3 (4 below the horizon), `atmAmbient` 0.

Additions (all optional to use):
* GLSL, same chunk: `vec3 atmMoonIlluminance(vec3 renderPos)` (direction `uMoonDir`), `vec4 atmAerialAt(vec3 dir, float distKm)`,
  `vec3 atmLightTransmittance(float altitudeKm, float cosZenith)`.
* `pipeline.shadow = { glsl, uniforms }` — `float sunShadow(vec3 renderPos, vec3 normal)` for raw `ShaderMaterial`s that
  want the key-light shadow (2 cascades, 9 hardware-PCF taps). Bind `{ ...ctx.uniforms.frame, ...ctx.pipeline.shadow.uniforms }`.
  Built-in three materials get the shadow automatically.
* `pipeline.lighting` — `{ keyIsMoon, cloudOcclusion, directShare, sunVisibility, sceneLuminance }`, updated every frame.
* `pipeline.keyLight` (same object as `ctx.env.sunLight`), `pipeline.hdrTarget`, `pipeline.exposure`,
  `pipeline.internalSize` (`{ width, height, scale }`), `pipeline.resetHistory()` (call after a camera cut the
  pipeline cannot see; `camera:mode`, `session:start`, `time:change` are already handled).
* `pipeline.debug` — `{ atmosphere, env, caps, testGLSL(), testPostLayer(), state }`. `testPostLayer()` draws a
  POST-layer object that samples `tSceneDepth` and returns `{ glError, drawn, sameSize, depthAttachmentIsSceneDepth }`
  (expected `0, true, true, false`). Unit tests: `node --test src/render/render.test.js`.

## What other modules need to know
1. **`ctx.env.sunLight` is the key light**: the sun by day, the moon at night (cross-faded through zero, so shadows never
   flip at full strength). It is a `THREE.DirectionalLight` subclass flagged `isSunLight` / `type: 'SunLight'` so three's
   cascade plumbing drives it; its **direction is its `position`** (unit vector toward the light), there is no
   `target`. Do not add other shadow-casting lights.
2. **`THREE.ShaderChunk.shadowmap_pars_fragment` is patched globally** (once, at pipeline creation) to replace
   `getSunShadow()` with a 2-cascade atlas lookup. Standard/Lambert/Phong/Physical materials pick it up; set
   `castShadow` / `receiveShadow` as usual. The tight cascade (≈ aircraft bounding sphere) follows the player; the wide
   one (220–420 m) covers the ground around it. Beyond that nothing is shadowed by geometry.
3. **Lighting units.** `ctx.env.sunColor` / `uSunColor` / `atmSunIlluminance()` are the direct sun through the
   **atmosphere only** (no clouds), 0 below the horizon. Use `atmMoonIlluminance()` + `uMoonDir` for the moon. Night is
   compressed: full moon = 0.004 × sun, and the auto-exposure reaches **40×**. Emissive things meant to be seen at night
   (runway lights, strobes, windows) should be authored in scene-referred radiance and, if they must look the same
   brightness day and night, be divided by `ctx.env.exposure`.
4. **Clouds darken the scene in the composite**, not in the materials: the key light is dimmed by the cloud shadow
   measured at the player, ambient/IBL are raised to compensate, and the composite re-weights every opaque pixel by
   `cloudShadow()` at that pixel. Raw shaders therefore must NOT call `cloudShadow()` for opaque MAIN-layer surfaces
   (it would be applied twice). POST-layer effects may (they are drawn after the composite).
   `ctx.env.ambientSky/ambientGround` already contain that compensation and the lightning flash.
5. **Haze under an overcast** is part of the atmosphere LUTs (mean light below `cloudBase` drops with `cloudCoverage`),
   so `atmAerialPerspective()` is consistent for terrain, water, clouds and effects. It is only enabled when the clouds
   module provides a real `cloudShadow()`.
6. `scene.environment` is a PMREM of the sky (overcast tint, cloud-deck floor when above the layer, ground bounce) and
   `scene.environmentIntensity` is driven every frame; do not add a `HemisphereLight`/`AmbientLight`.
7. Extra lights in the scene are fine as long as their **count is constant** (the effects module's two lights are).
   The pipeline enables `LAYERS.POST` on every light it finds in the scene (re-scanned every 120 frames) so the MAIN
   and POST passes see the same light set and three never re-resolves material programs mid-frame.

## Frame graph (what `render(dt)` does)
1. LUTs: sky-view 256×128 + aerial volume 256×128 every frame; transmittance 256×64 + multi-scattering 32×32 only when
   the haze changes by > 0.4 %.
2. Lighting outputs (`ctx.env.*`, key light, IBL step), shadow fit.
3. MAIN layer → `sceneTarget` (RGBA16F + 32F reversed-Z depth, published as `tSceneDepth`; `uResolution` = internal size).
   TAA sub-pixel jitter is applied to `camera.projectionMatrix` for this pass and the POST pass and removed afterwards.
4. `ctx.clouds.render({ renderer, camera, depthTexture, width, height, dt })`.
5. Composite → `hdrTarget`: sky + sun/moon/stars on sky pixels; cloud-shadow re-weighting + aerial perspective on
   geometry; `scene * clouds.a + clouds.rgb`; lightning flash. It also **copies depth** into `hdrTarget`'s own depth
   texture.
6. **POST layer → `hdrTarget`**, same size as `uResolution`, linear HDR, before TAA/bloom/tone map, hardware depth-tested
   against the depth *copy*. `tSceneDepth` is **not** attached to the bound framebuffer, so POST shaders may sample
   it freely (no feedback loop). POST objects are not fogged by the pipeline (`pipeline.postAerialPerspective` is
   unset): apply `atmAerialPerspective()` yourself. Blend premultiplied.
3b. SSAO (half res, after the main pass; see `ao.js`), applied in the composite before cloud shadows / aerial perspective.
7. TAA → bloom pyramid → 6×1 probe (metering, sky irradiance, sun visibility, cloud shadow at the player, measured near / far
   ground radiance for the reflection environment; async read-back)
   → lens + tone map (AgX) → final FXAA/CAS + dither to the canvas.

## Quality / capability handling
`ctx.quality.renderScale`, `dynamicResolution` (0.5–1.0 in steps of 0.08, off in test mode), `bloom`, `taa` (off → FXAA),
`shadows`, `shadowMapSize` (per-cascade tile, capped at 2048) are honoured live (`quality:change`). Without
float colour buffers the LUTs fall back to 8-bit sqrt encoding and the scene to RGBA8 with a fixed exposure estimate;
if three's sun-shadow chunks are ever renamed the pipeline logs a warning and falls back to one standard cascade.

## Events
Listens: `quality:change`, `time:change`, `weather:change {instant}`, `session:start`, `camera:mode`,
`lightning {worldPos?, intensity?}` (stroke + re-strikes: extra ambient light, haze and cloud glow toward the strike).
Emits nothing.

## Debug URL params (read from `ctx.params.raw`)
`nofloat=1`, `notaa=1`, `nodrs=1`, `noflare=1`, `exposure=<v>`, `dbgshadow=<0..1>` (fake uniform cloud shadow),
`dbgflash=<frame>` (fire a lightning event), `moonaz=<deg>&moonel=<deg>`, `lookyaw=<deg>&lookpitch=<deg>` (use with
`notaa=1`), `rdebug=notonemap|scene|hdr`.
Feature switches: `ao=0|1` (SSAO off / force on; default on except quality=low), `aoradius`, `aointensity`, `aostrength`;
`envground=0` (generic ground in reflections instead of the measured one); `taa=classic` (previous TAA + sharpen).

## Requests for integrator-owned files (none are blocking)
* `src/core/context.js` sets `renderer.shadowMap.type = PCFSoftShadowMap`; the pipeline overrides it with
  `PCFShadowMap` (its own PCF kernel lives in the patched chunk). No change needed.
* If `ctx.time` grows a real lunar orbit, nothing changes here: the phase comes from the sun–moon elongation.
* `tools/shot.mjs` takes the screenshot before `--eval`; an `--eval-before` hook would make event-driven visuals
  (lightning) testable without module-side debug params.
