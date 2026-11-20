# Effects module — integration notes

API (unchanged): `createEffects(ctx) → { update(dt), stats(), dispose() }`.
Attaches to the player on `session:start`, detaches and clears all live particles/trails on `session:end`
(verified: scene children / geometry counts are identical after repeated restarts and aircraft swaps).

## Files
| file | what |
|---|---|
| `index.js` | orchestration: session attach/detach, emitter logic (contrail physics, vapour thresholds, ground/crash), fx light, debug params |
| `fxglsl.js` | shared uniforms + GLSL header (frame uniforms, depth helpers, atmosphere API, cloud shadow, media lighting, `fxFinish`) |
| `particles.js` | GPU particle system (instanced quads, analytic motion in the VS, ring buffer, one draw) |
| `trails.js` | volumetric tube trails (contrails, wingtip vortices, display smoke): analytic gaussian-tube optical depth per segment |
| `plume.js` | ray-marched afterburner plume (body-fixed). Dry thrust draws nothing (the aircraft's modelled nozzle interiors carry the dull EGT glow); AB = potential core + shock diamonds/Mach discs + blue lip sheath + turbulent mixing layer + faint wide outer plume, log-compressed in display units against `ctx.env.exposure` (restrained by day, blooms at dusk/night) |
| `vapor.js` | ray-marched body-fixed condensation: over-wing sheet, LERX vortices, transonic vapour cone |
| `lights.js` | nav / strobe / beacon / landing-lamp HDR sprites (one draw): lens-sized (3–20 cm), energy-conserving (`cover = rp²/r²`, 0.9 px minimum), exposure-aware soft limit, halo + spikes only at night and not when the visual has its own `halos` object (f22, fa18) + landing/taxi `SpotLight` + beam shaft |
| `weatherfx.js` | rain streaks around the camera, lightning bolts, canopy rain overlay (cockpit view) |
| `emitters.js` | CPU spawn recipes (tyre smoke, dust, spray, sparks, explosion, wreck fire/smoke column, shock ring…) |
| `anchor.js` | anchored float32 storage that survives `originShift` (rebases only every ~12 km) |
| `crash/index.js` | crash orchestration: classify, fireball, debris, decals, ground fire, sparks/dust/spray, fx light, `crash:fx`; test harness (`crashtest=`) — see `docs/effects/CRASH.md` |
| `crash/classify.js` | pure crash classification (belly / gear collapse / breakup / impact / ditch / water impact / airburst) and fireball scaling |
| `explosion.js` | neural fireball: GPU bake of `src/neural/fireball.js` into a 3-D texture, light bake, ray-marched volume on POST, CPU probe for the fx light |
| `decals.js` | deferred projected ground decals (scorch, crater, scrape, turf, foam, skid), one instanced draw |
| `debris.js` | tumbling wreck pieces with smoke/fire trails |
| `noise.js` | 32³ tileable 3D noise + 128² smoke-puff atlas, generated at boot (~20 ms) |

## Rendering contract notes / requests for the render pipeline
1. **Everything is on `LAYERS.POST`**, outputs linear HDR radiance with **premultiplied alpha**
   (blend `ONE, ONE_MINUS_SRC_ALPHA`): lit media write `(L·a, a)`, pure emitters `(E, 0)`. Emissive radiance is
   10–300 (plume core/diamonds, strobes, lightning, explosion flash) so bloom picks it up.
2. **Depth**: every effect does its own occlusion + soft fade by reading scene depth through `DEPTH_GLSL`
   (`sceneDistance`). The sampler is `tFxDepth`, bound to the *same uniform holder* as `ctx.uniforms.frame.tSceneDepth`
   (or `ctx.pipeline.postDepthUniform` if the pipeline provides one). **The POST pass must not have that depth texture
   attached to the bound framebuffer** (WebGL2 feedback loop). Either copy depth for the POST pass and expose the copy
   as `ctx.pipeline.postDepthUniform = { value: copyTexture }`, or draw POST into a colour-only attachment — my shaders
   occlude themselves, so a hardware depth test is optional. `depthTest: true, depthWrite: false` is set on all materials.
3. **Aerial perspective**: POST objects are drawn after the composite, so the pipeline cannot fog them by depth. My
   shaders apply `atmAerialPerspective()` themselves (contrails 10+ km away need it). If the pipeline ever fogs POST
   objects itself, set `ctx.pipeline.postAerialPerspective = true` **before** effects are created and I skip it.
4. Screen uv for depth reads = `gl_FragCoord.xy / uResolution` → the POST pass must render at the `uResolution`
   size (the main HDR target size).
5. Cloud shadows: if `ctx.clouds.shadowGLSL/shadowUniforms` exist at effects creation, contrails/smoke are shadowed by
   clouds (`cloudShadow()`); otherwise unshadowed.
6. Two lights are added to `ctx.scene` **once at boot and never removed** (`fx-light` PointLight for afterburner glow,
   wreck fire, explosion flash and lightning; `fx-landing-light` SpotLight). Intensity is 0 when unused, so the light
   count — and therefore every material's program — never changes. Both are on layer 0 (MAIN). No shadows.
   Units follow the contract (irradiance = intensity / d²).

## Known stub artefacts (not effects bugs)
* The stub pipeline tone-maps before drawing POST, so HDR values clip in raw screenshots — use `fxtm=1` to preview.
* The stub never lowers `ctx.env.ambientSky` at night, so rain/contrails look bluish-bright at night in stub shots;
  with the real atmosphere (`atmAmbient`) they darken correctly.

## Events consumed
`session:start`, `session:end`, `touchdown {verticalSpeed, gear}` (per-gear tyre smoke; a fallback fires on the
ground-contact transition until physics emits a real `touchdown`), `crash {reason}` (classified crash sequence, `crash/index.js`;
with `crash=classic` the previous explosion + wreck fire + smoke column / splash), `sonicBoom` (shock ring + vapour-cone flash),
`crash:impact` (wreck of an in-flight breakup reaching the ground), `lightning {worldPos, intensity}` (bolt + flash), `cmd {name:'smokeToggle'}` (airshow smoke trail — not bound to a key
yet; input/menu may bind it).

## Events emitted
`crash:fx {kind, label, worldPos, energy (MJ), D (fireball m), fire, water, surface, synthetic}` once per crash (and
`kind:'secondary'` for a later fire) — the camera (focus + distance-delayed shake) and audio (distance-delayed boom,
scrape, crackle) consume it. `synthetic` is true for `crashtest=` crashes.

## State fields read (all optional / defensive)
`state.position, quaternion, velocity, tas, mach, aoa, gLoad, altitude, verticalSpeed, groundSpeed, onGround,
crashed, engines[i].{running, thrust, afterburner, egt, n1}, gear[i].{onGround, skid}, surfaces.gear, lights.{nav,
strobe, beacon, landing, taxi}`; `def.geometry.{engines[].nozzle/nozzleRadius, wingtips, lights, gear, span, length,
height, wingArea, noseZ, tailZ, cgHeight, pilotEye}`, `def.specs.{engineType, thrustDry, thrustMax}`, `def.category`.
`ctx.weather.{cloudCoverage, cloudBase, cloudTop, cirrus, precipitation, visibility, wind, windAt}`,
`ctx.env.{nightFactor, sunDir}`, `ctx.water?.heightAt`, `ctx.world.groundAt`, `ctx.cameraRig?.mode` (canopy rain only in
`'cockpit'`), `ctx.quality.particles`.

## Budgets (worst case: twin-engine AB jet, everything active)
* **Draw calls**: particles 1 + long-smoke 1 + plume ×engines + contrail ×engines + wingtip 2 + display smoke 1 +
  vapour 3 + lights 1 + beam 1 + rain 1 + lightning 1 + canopy 1 → **≤ 17**, typically **3–6** in cruise
  (each system hides itself when nothing is alive).
* **Particles**: 12 288 general + 3 072 long-lived smoke instances (allocated once; ~1.2 MB). Spawn rates × `quality.particles`.
  Only the slice written this frame is uploaded (`addUpdateRange`); zero per-frame allocations.
* **Trails**: 2 048 segments per engine contrail (≈ 80+ km of trail at cruise), 384 per wingtip, 1 024 display smoke.
  Fragment cost: one analytic erf integral + 1 noise fetch per covered pixel.
* **Ray-marched volumes**: plume 14–32 steps (2 noise fetches/step), vapour 10–24 steps (2–3 fetches/step); only drawn
  when their amount > 0 and only over their screen footprint. Step counts scale with `quality.particles`.
* **Rain**: ≤ 9 000 streak quads × precipitation × quality. Canopy rain: 1 fullscreen triangle, ~40 ALU ops/pixel.
* **Lights**: ≤ 12 sprites (1 draw); 1 SpotLight + 1 PointLight shared by the scene.
* **Beam** (night, lamp on): 1 draw over the cone's screen footprint, 6–16 samples × ~25 ALU per pixel.

* **Crash** (only while a crash is live): fireball volume 1 draw per fireball (≤ 2) over its footprint, 18–56 steps × 5
  fetches; bake 40 draws + light bake 40 draws when re-baked (adaptive); decals 1 draw; ≤ 21 debris meshes. Boot
  warm-up ≈ 70 ms (SwiftShader) in `stats().crash.warmMs`. Details: `docs/effects/CRASH.md`.

## Feature switches
`plume=classic` previous plume incl. the dry nozzle-exit glow; `acl=classic` previous aircraft-light sprites.
Night pass: `lamp=classic` landing/taxi spot at the real lamp position with the old hard cone (it lit the cockpit
and the inside of the forward fuselage through the skin: the spot has no shadow map); `beam=classic` previous
murk-only additive cone instead of the scattering beam; `beaconlight=0` beacons do not light the airframe/ground;
`fxmoon=0` smoke/contrails/vapour not lit by the moon.
`crash=classic` previous crash (particle explosion + wreck fire, old explosion sound).

## Night behaviour (night pass)
* **Landing / taxi spot**: when the lamp is behind the nose the source is moved to just ahead of the nose with the
  same aim, and falls off as `I'/d^p` (`p = 2·40/(40+t)`, `I' = I·40^p/(40+t)²`) so the pool keeps the real lamp's
  length and brightness from ~12 to 150 m. Wide cone, long penumbra (soft pool edges). Combined landing+taxi = one
  wider cone.
* **Beam**: single scattering of the spot by the air along each view ray (analytic ray/cone entry, 6–16 jittered
  samples by `quality.particles`), scattering coefficient from `weather.visibility` (Koschmieder minus Rayleigh) +
  rain; forward-peaked aerosol phase. Faint in clear air, strong in mist/rain. Back faces of a 350 m cone proxy,
  no depth test (own depth read), drawn only while the spot is on.
* **Beacon light**: when nothing else uses the shared fx PointLight (lightning > explosion > fire > afterburner),
  it follows the flashing beacon (top or belly) at ~0.5 cd-units × night (30 m range): a red wash on the skin and the ground.
* **Media lighting**: `fxSun()` = sun (cloud shadow) + moon; phase/wrap use `uFxKeyDir` (= `pipeline.lighting.keyDir`).
  `fxFinish/fxFinishAP` apply the pipeline night grade (`pipeline.nightGrade`) to the lit part only.
`uFxExposure` (shared uniform) carries `ctx.env.exposure` to every effects shader.

## Debug URL params (headless testing only; harmless in production)
`fx=ab,contrail,vapor,cone,crash,touchdown,rain,lights,lightning,spray,sparks,smoke,boom,all` forces effects;
`fxtm=1` tone-maps in-shader (the stub pipeline draws POST after its tone map); `fxexp=<x>` preview exposure;
`fxcam=side|front|rear|far|low|top|cockpit`, `fxdist=<m>` debug camera; `fxthr=<0..1>` force throttle; `fxab=<0..1>` force the afterburner stage of the plume (visual only);
`fxlevel=1` hold altitude (stub physics sinks); `fxwater=1&fxagl=<m>` teleport low over the nearest water (spray).
Example: `node tools/shot.mjs --params "aircraft=f16&start=air&tod=23&fx=ab&fxtm=1&fxcam=side&fxdist=9"`.
Crash: `crashtest=<belly|collapse|breakup|impact|fireball|mountain|ditch|water|airburst>`, `crashdist=<m>`,
`crashlat=<m>`, `crashside=1`, `crashat=<frame>`, `crashrate=<x>`, `crashshore=1`, `crashdive=1`; fireball `fbtemp`,
`fbemis`, `fbbake`, `fboff=1`, `fbdbg=1..5` (see `docs/effects/CRASH.md`).
