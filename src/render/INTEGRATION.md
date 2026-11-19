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
| `nightgrade.js` | night-vision (scotopic) grade applied in the composite + the emissive-mask chunk patch (see "Emissive contributors") |

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
* `pipeline.nightGrade = { glsl, uniforms }` — `vec3 ng_grade(vec3 refl, vec3 total)` for POST-layer lit media
  (see "Emissive contributors").
* exported `twilightGain(sunDirY)` (index.js).
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
   **atmosphere only** (no clouds), 0 below the horizon. While the sun is below the horizon its light (sky, aerial
   perspective, `atmSunIlluminance` for things high enough to still see it) is boosted by `twilightGain()` (1 above
   the horizon, ~3 at -3.4 deg, ~10 at -6.5 deg, max 60) so twilight is compressed like the night. Use `atmMoonIlluminance()` + `uMoonDir` for the moon. Night is
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

## Emissive contributors and the night grade (read this if you draw lights, windows, displays or flames)
At night the pipeline shifts dim, naturally lit things (moonlit terrain, sky, clouds, smoke) toward a blue-grey,
desaturated rod-vision look. **Light sources must keep their colour** (sodium / LED town lights, airport lights, aircraft
lamps, lit windows, cockpit displays, afterburner). The grade runs in the composite, scene-referred, so:

1. **`LAYERS.POST` emitters need nothing**: the POST pass is drawn after the composite (airport light sprites, aircraft
   light sprites, plumes, lightning). Lit *media* on POST (smoke, contrails, rain) should grade their reflected part
   themselves: `${ctx.pipeline.nightGrade.glsl}` + `uniforms: { ...ctx.pipeline.nightGrade.uniforms }`, then
   `lit = ng_grade(lit, lit / max(alpha, 1e-3));` on the premultiplied lit radiance, emission added after
   (the effects module does this in `fxFinish`).
2. **MAIN-layer emitters write the "reflected share" into the alpha channel** of the scene target:
   `alpha = 1 - lum(emitted) / lum(total)` (1 = lit surface, 0 = pure emitter, `lum` = Rec.709 luma).
   * Opaque `MeshStandardMaterial` / `MeshPhysicalMaterial` / Lambert / Phong / Toon do this **automatically** from
     `totalEmissiveRadiance` (the pipeline patches three's `opaque_fragment` chunk once at creation). So: add your
     emission to `totalEmissiveRadiance` (the `emissive` colour, an `emissiveMap`, or
     `.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += myLamps;')`)
     and do **not** add it to `diffuseColor`, `outgoingLight` or `gl_FragColor` afterwards. Do not use `emissive` as a
     fake fill light (it would keep its colour at night).
   * Raw `ShaderMaterial`s on MAIN write it themselves: `outColor = vec4(lit + emis, clamp(1.0 - dot(emis, LUMA) /
     max(dot(lit + emis, LUMA), 1e-9), 0.0, 1.0));` (or `1.0` if they emit nothing — the default before this was 1.0).
   * Transparent MAIN materials (blended) cannot carry the mask; keep emitters opaque or move them to POST.
   * Sub-pixel lights painted into a surface (towns seen from altitude) are the reason for the mask: the mask is per
     pixel, so a pixel that is 70 % lamp light keeps 70 % of its colour however dim it is on screen.
3. Surfaces lit by artificial light are not emitters (alpha 1); they keep their colour anyway when they are much
   brighter than moonlit white paint (the grade fades out between 4x and 30x that reference).
4. Emissive levels: emitters no longer need to be over-saturated to survive the grade — author real lamp colours
   (sodium ≈ (1.0, 0.62, 0.28) linear, warm LED ≈ (1.0, 0.85, 0.65), cool LED ≈ (0.9, 0.95, 1.0)).

Debug: `rdebug=emask` shows the mask (orange = emitter, grey = lit surface, dark blue = sky).

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
   At night the tone map lowers the AgX look contrast/saturation (1.5/1.3 → 1.12/1.12, so a moonlit landscape is
   faintly readable instead of crushed) and applies a local adaptation from the 1/16-res bloom level (only where the
   neighbourhood is displayed above white, e.g. a landing-light pool; small lights and the dim landscape untouched).
   The night grade itself runs in the composite (step 5): rods grade the reflected light, emitters keep their colour.

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
Night / twilight switches (each new behaviour has one): `ngrade=classic` (previous display-space night grade in the tone
map: pulls everything dimmer than ~0.7 display toward blue, lights included), `ngrade=0` (no night grade), `emask=0`
(ignore the emissive mask), `nlook=0` (keep the day contrast/saturation at night), `localexp=0` (no night local
adaptation), `twilight=classic` (physical, uncompressed twilight: civil twilight darker than a moonlit night),
`stars=classic` (previous star field: one global fade, larger points).
Feature switches: `ao=0|1` (SSAO off / force on; default on except quality=low), `aoradius`, `aointensity`, `aostrength`;
`envground=0` (generic ground in reflections instead of the measured one); `taa=classic` (previous TAA + sharpen).

## Requests for integrator-owned files (none are blocking)
* `src/core/context.js` sets `renderer.shadowMap.type = PCFSoftShadowMap`; the pipeline overrides it with
  `PCFShadowMap` (its own PCF kernel lives in the patched chunk). No change needed.
* If `ctx.time` grows a real lunar orbit, nothing changes here: the phase comes from the sun–moon elongation.
* `tools/shot.mjs` takes the screenshot before `--eval`; an `--eval-before` hook would make event-driven visuals
  (lightning) testable without module-side debug params.
