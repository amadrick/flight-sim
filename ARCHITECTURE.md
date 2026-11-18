# Skyward Flight Simulator — architecture contract

A AAA-ambition flight simulator that ships as **one self-contained HTML file** (a claude.ai Artifact).
Many agents build modules in parallel; this document is the contract that makes the pieces fit.
Read all of it before writing code. The source files in `src/core/` are the ground truth for every shape named here.

## 0. Hard platform constraints (non-negotiable)

- **Single file, zero network.** The published page may not fetch anything: no images, models, textures, audio files,
  fonts-by-JS, `fetch()`, XHR, WebSocket, `importScripts` from URLs. *Everything is procedural or embedded in JS.*
  Textures are generated on canvas / on the GPU at boot; audio is synthesised with Web Audio; geometry is built in code.
- **WebGL2 + three.js 0.187** (bundled by esbuild from npm; import as `import * as THREE from 'three'`, addons from
  `three/addons/...`). GLSL ES 3.00 (`glslVersion: THREE.GLSL3` for raw `ShaderMaterial`s). No WebGPU, no TSL/node materials.
- Web Workers are allowed only from `blob:` URLs you build from a string. No service workers, no `alert/confirm/prompt`,
  no downloads, no `window.open`. Pointer lock / fullscreen are optional (handle rejection). Audio starts only after a user gesture.
  Gamepad, device-orientation etc. may be refused: feature-detect and degrade silently.
- **Performance target:** 60 fps at 1080p on a mid-range discrete GPU with quality `high`; playable on an integrated GPU on `low`.
  Honour `ctx.quality` (see `src/core/quality.js`). Zero per-frame allocations in hot paths (reuse vectors).
  **Boot budget: the whole sim must boot in a few seconds** — each module ≤ ~1 s of main-thread work at startup;
  spread heavier generation over frames or move it to a blob worker.
- The page must also work at phone width (~400 px) with touch.

## 1. Repository layout and ownership

```
src/main.js, src/core/**, src/data/airports.js, src/aircraft/registry.js,
src/aircraft/*/index.js, src/index.template.html, tools/build.mjs, tools/shot.mjs      INTEGRATOR ONLY — never edit
src/physics/**      flight dynamics            src/render/**     HDR pipeline, atmosphere, sky, post
src/clouds/**       volumetric clouds          src/terrain/**    terrain
src/water/**        ocean                      src/scenery/**    airports, runways, buildings, lights
src/aircraft/kit/** aircraft modelling kit     src/aircraft/<id>/{geometry,visual,physics}.js  per-aircraft
src/effects/**      particles, plumes, lights  src/camera/**     camera rig
src/input/**        keyboard/mouse/gamepad/touch  src/audio/**   procedural sound
src/ui/hud/**       HUD + instruments          src/ui/menu/**    menus / shell UI
```

**You may only create/modify files inside the paths your task brief assigns to you.** If you need something changed in an
integrator-owned file or another module, do NOT edit it: describe the exact change in your final report (and in an
`INTEGRATION.md` inside your module directory). Every stub module in the scaffold documents the API you must keep.

## 2. Coordinates

- **World space** (simulation truth, JS doubles): metres, **+X east, +Y up, +Z south** (north = −Z). Flat earth.
  `y` = altitude above mean sea level; sea level is `y = 0`. Heading: radians/degrees true, 0 = north, 90° = east,
  so the unit vector for heading ψ is `(sin ψ, 0, −cos ψ)`.
- **Render space** = world − `ctx.world.origin` (a floating origin; `origin.y` is always 0, so render y == altitude).
  The three.js scene graph, the camera and all shaders are in render space. The origin snaps in 1024 m steps to stay
  within ~2 km of the player, so float32 stays exact near the camera.
  - Static objects: `ctx.world.anchor(object3D, worldPosVector3)` once — core repositions them on every shift.
  - Dynamic objects: `ctx.world.toRender(worldPos, outVec)` every frame.
  - Shaders needing absolute world coordinates (noise, tiling): `worldXZ = renderPos.xz + uOrigin.xz` (`uOrigin` frame uniform).
  - The `'originShift'` event `{ delta, origin }` fires when it moves (render coordinates of static things change by −delta).
    Anything with history (temporal reprojection, trails, particles stored in render space) must handle it;
    `uPrevViewProj` is already corrected by core.
- **Aircraft body axes** (visual models, geometry files, anchors): origin at the nominal CG, **+X right wing, +Y up, −Z nose**.
  `state.quaternion` maps body → world. (Physics may use aerospace axes internally but everything it exports uses these.)
- **Earth curvature** is faked: far geometry (terrain/water/far scenery) drops by `d²/(2·R)` in the vertex shader
  (`CURVATURE_GLSL` in `core/glsl.js`); the atmosphere is computed on a spherical planet. Physics is flat.

## 3. `ctx` — the object every module receives (`src/core/context.js`)

```
ctx.renderer, ctx.scene, ctx.camera        three.js (PerspectiveCamera in render space; near 0.5, far 600 km, reversed-Z depth)
ctx.canvas, ctx.hudCanvas, ctx.uiRoot      <canvas id=view>, 2D overlay canvas, DOM root for UI (position:absolute; inset:0)
ctx.params                                 parsed URL params (core/params.js); ctx.params.test = headless stepping mode
ctx.events                                 event bus: on(name, fn) → unsubscribe, emit(name, payload)
ctx.time      { now, dt, real, realDt, frame, paused, timeScale, timeOfDay (h), dayOfYear, latitude, dayRate, setTimeOfDay(h) }
ctx.weather   { preset, cloudCoverage, cloudBase, cloudTop, cirrus, precipitation, visibility, windFrom, windSpeed,
                turbulence, lightning, wind: Vector3, windAt(worldPos, out), setPreset(name, instant) }   (core/weather.js)
ctx.quality   { level, renderScale, cloudSteps, cloudScale, shadows, shadowMapSize, terrainDetail, waterDetail, bloom, taa,
                particles, anisotropy, set(level) }                                                      (core/quality.js)
ctx.world     { origin, toRender, toWorld, anchor, unanchor, setTerrainHeightFn, terrainHeightAt, addSurfaceProvider,
                groundAt(x, z, out) → { height, type, friction? }, groundHeightAt, groundNormalAt }       (core/world.js)
ctx.env       { sunDir, moonDir (unit, TOWARD the body), sunColor, ambientSky, ambientGround (THREE.Color, linear),
                sunLight (DirectionalLight), exposure, nightFactor (0 day … 1 night) }
ctx.uniforms.frame                         shared per-frame uniforms (core/glsl.js) — spread into your ShaderMaterial uniforms
ctx.controls                               pilot inputs (core/state.js createControls) — written by input, read by physics
ctx.player    { id, def, sim, state, visual, airport, runway } | null   — the aircraft being flown (set by ctx.session.start)
ctx.session   { start(opts), restart(), end(), active, options }        — opts: { aircraft, airport, runway, end, start:
                'runway'|'air'|'approach', alt, spd, hdg }
ctx.pipeline, ctx.terrain, ctx.water, ctx.scenery, ctx.clouds, ctx.input, ctx.cameraRig, ctx.effects, ctx.audio, ctx.hud, ctx.menu
```

Every module exports one async factory `createXxx(ctx)` (see the stub in your directory for the exact name and the API of
the returned object) and may have `update(dt)`. **Frame order** (`src/main.js`):

```
time.advance → input.update → weather.update → session.update (physics.step → origin → aircraft visual.update)
→ cameraRig.update → frame uniforms refreshed → terrain/water/scenery/clouds/effects/audio/hud/menu .update(dt) → pipeline.render(dt)
```
`dt` is simulated seconds (0 while paused); use `ctx.time.realDt` for UI animation.

## 4. Data shapes (`src/core/state.js` — read it)

- **`AircraftState`** (`ctx.player.state`): position/quaternion/velocity (world), `bodyRates {p,q,r}`, air data (`tas, ias, mach,
  aoa, beta, altitude, agl, verticalSpeed, groundSpeed, heading, track, pitch, roll, gLoad`), `throttle`, `engines[] { running,
  n1, n2, thrust, afterburner, nozzle, fuelFlow, egt, reverser }`, `surfaces { aileronL/R, elevatorL/R, rudder, flaps, slats,
  spoilerL/R, speedbrake, gear, hook, wingSweep, canopy, nozzlePitch }` (normalised; sign conventions in the file),
  `gear[] { onGround, compression, wheelSpeed, steer, skid }`, `onGround, brakes, parkingBrake, flapsIndex, mass, fuel,
  stalled, stallWarning, overspeed, overG, crashed, crashReason, ap {...}, lights {...}`.
- **`Controls`** (`ctx.controls`): `pitch` (+ = stick back), `roll` (+ = right), `yaw` (+ = nose right), `throttle` 0..1
  (afterburning aircraft: 0..0.9 idle→MIL, 0.9..1 afterburner), `brakes`, `speedbrake`, `lookX/lookY`, `zoom`.
- **Aircraft definition** `def` (`src/aircraft/<id>/index.js`): `{ id, name, manufacturer, category ('fighter'|'attack'|'bomber'|
  'recon'|'transport'|'airliner'), hudType ('fighter'|'airliner'), specs {...published numbers}, sound {...}, geometry, physics,
  createVisual(ctx) }`. `def.geometry` (`geometry.js`): body-axes reference points — `length, span, height, wingArea, noseZ, tailZ,
  cgHeight, pilotEye, gear[{name,pos,wheelRadius,steerable,braked}], engines[{nozzle,intake,nozzleRadius}], wingtips, lights{}`.
  Gear contact points and `cgHeight` there are the single source of truth for both physics and visuals.
- **Visual**: `createVisual(ctx) → { object3D (THREE.Group in body axes), update(state, dt), dispose() }`. Core sets the group's
  position/quaternion each frame; `update` animates surfaces, gear, nozzles etc. from `state`.
- **Physics**: `createSim(ctx, def, init) → { state, step(dt, controls), reset(init), dispose() }` (`src/physics/index.js`).
- **Airports**: `src/data/airports.js` (`AIRPORTS`, `CARRIER`, `runwayEnd()`, `runwayLocal()`, `headingVector()`).

## 5. Events (`ctx.events`)

| event | payload | emitted by |
|---|---|---|
| `ready` | – | core, once after boot |
| `resize` | `{ width, height }` (CSS px) | core |
| `originShift` | `{ delta: Vector3, origin }` | core/world |
| `session:start` / `session:end` | `ctx.player` | core/session |
| `cmd` | `{ name, value? }` | input, UI (see below) |
| `pause` | `boolean` | core |
| `camera:mode` | mode string | camera |
| `weather:change` | `{ preset, instant }` | core/weather |
| `time:change` | hours | core/time |
| `quality:change` | `ctx.quality` | core/quality |
| `crash` | `{ reason, speed? }` | physics |
| `touchdown` | `{ verticalSpeed, gear: index }` | physics |
| `gear:moved`, `flaps:moved` | `{ target }` | physics |
| `sonicBoom` | – | physics (Mach 1 crossing) |
| `lightning` | `{ worldPos, intensity }` | clouds |
| `menu:open` / `menu:close` | – | menu |

**Commands** (`ctx.events.emit('cmd', { name })`): `gearToggle, flapsDown, flapsUp, speedbrakeToggle, parkingBrakeToggle,
hookToggle, engineToggle, apToggle, apAltHold, apHdgHold, apSpdHold, trimUp, trimDown, trimReset, lightsToggle, canopyToggle,
wingSweepToggle, cameraNext, cameraPrev, camera:<mode>, pause, reset, menu, hudToggle, timeFaster, timeSlower`.
Physics consumes the flight ones, camera the camera ones, core `pause`/`reset`, the menu `menu`.

## 6. Rendering contract

**Frame** (owned by `src/render/`):
1. Shadow pass (sun `DirectionalLight` in `ctx.env.sunLight`, fitted around the player aircraft).
2. Main pass: `ctx.scene` with `LAYERS.MAIN` (0) → HDR `RGBA16F` target + float depth texture. No sky is drawn here.
3. `ctx.clouds.render(frame)` (clouds ray-march against the scene depth into their own target).
4. Composite: sky radiance where depth is empty; cloud shadows + aerial perspective on geometry; clouds over everything.
5. `LAYERS.POST` (1) objects drawn after the composite, depth-tested against the scene (particles, contrails, flares, glass).
6. Post: bloom, exposure, tone map, AA, grading → canvas.

**Rules for anything that draws:**
- Lit surfaces: prefer `MeshStandardMaterial`/`MeshPhysicalMaterial` (customise with `onBeforeCompile`) so sun light, shadows
  and image-based lighting (`scene.environment`, provided by the pipeline) work for free. A raw `ShaderMaterial` must do its own
  lighting from the frame uniforms (`uSunDir`, `uSunColor`, `uAmbientSky`, `uAmbientGround`) and/or the atmosphere API below.
- **Do not apply fog / aerial perspective / tone mapping / gamma in your materials.** Output linear scene-referred HDR radiance.
  The pipeline fogs by depth. Do not draw a sky, sun or stars. Set `material.fog = false`, `toneMapped = false` on raw shaders.
- **Lighting units:** a white Lambertian surface facing the noon sun has radiance ≈ 1.0. `uSunColor` is the sun's irradiance at
  the camera (≈ 4.0 at noon; BRDF_diffuse = albedo/π ⇒ radiance = albedo·uSunColor·N·L/π). Emissive things (lights, flames,
  HUD glass) should use radiance well above 1 (10–200) so bloom picks them up; scale emissives by context (`ctx.env.nightFactor`).
- **Depth:** reversed-Z float depth (EXT_clip_control) with automatic fallback. Never read depth by hand — use `DEPTH_GLSL`
  from `core/glsl.js` (`sceneDistance(uv)`, `renderPosFromDepth(uv, d)`, `depthIsSky(d)`, `viewRay(uv)`), plus the frame uniforms.
  Use the standard `projectionMatrix * modelViewMatrix * vec4(position, 1.0)` so depth is consistent. `polygonOffset` is fine.
- **Fullscreen passes:** use `FullscreenPass` + `FULLSCREEN_VERT` from `core/glsl.js` (a bare `THREE.Camera` crashes with reversed depth).
- Always restore renderer state you change (render target, autoClear, viewport, layers).
- Shadows: set `castShadow`/`receiveShadow` on meshes near the aircraft (aircraft parts, runway, buildings).
- Transparent / additive effects that should not be fogged twice go on layer `LAYERS.POST`.

**Atmosphere API** (GLSL, exported by `src/render/atmosphere-glsl.js`, uniforms in `ctx.pipeline.atmosphere.uniforms`):
```glsl
vec3 atmSunIlluminance(vec3 renderPos);          // direct sun irradiance reaching a point (atmosphere only)
vec3 atmSkyRadiance(vec3 dir);                   // sky radiance from the camera along dir (no sun disc / clouds)
vec4 atmAerialPerspective(vec3 renderPos);       // rgb = in-scatter, a = transmittance:  c = c * ap.a + ap.rgb
vec3 atmAmbient(vec3 renderPos, vec3 normal);    // ambient irradiance/π: radiance = albedo * atmAmbient(...)
```
Use: `uniforms: { ...ctx.uniforms.frame, ...ctx.pipeline.atmosphere.uniforms, ...mine }` and in the shader
`${FRAME_UNIFORMS_GLSL} ${ctx.pipeline.atmosphere.glsl}` (read the glsl string at material-creation time, after the pipeline exists).

**Clouds ↔ pipeline:** `ctx.clouds.texture` (RGBA16F; rgb = premultiplied in-scattered radiance including the clouds' own aerial
perspective, a = transmittance; composite is `scene * a + rgb`), `ctx.clouds.shadowGLSL` (GLSL defining
`float cloudShadow(vec3 renderPos)` → sun transmittance through the cloud layer, 1 = clear) and `ctx.clouds.shadowUniforms`.
The pipeline compiles its composite lazily on first render so it can include `shadowGLSL`.

## 7. UI conventions

- DOM UI goes inside `ctx.uiRoot`; inject one `<style>` per module with class names prefixed by the module (`.menu-…`, `.hud-…`,
  `.inp-…`). Use the design tokens defined in `src/index.template.html` (`--bg, --panel, --panel-2, --line, --fg, --fg-dim,
  --accent` amber, `--hud` green, `--warn`, `--ok`, fonts `--font-display` Saira Condensed, `--font-body` Saira, `--font-mono`
  B612 Mono — the fonts may be missing offline; always keep the fallback stacks). Single dark "flight deck" look.
- Keep a ≥16 px side gutter with `padding-left: max(16px, env(safe-area-inset-left, 0px))` (same for right); nothing may make
  the page scroll. Visible keyboard focus, `prefers-reduced-motion` respected. Toggle visibility with `el.hidden`.
- Copy: plain, direct, aviation-literate. Units pilots use: knots, feet, feet/min, degrees, Mach, G.

## 8. Building and testing (headless, software GL — SLOW)

```
node tools/build.mjs                 # → dist/index.html (single file). --dev for unminified + sourcemap
node tools/shot.mjs --out shots/x.png --params "aircraft=f16&start=air&tod=17.5&weather=scattered&cam=chase" \
     --size 640x360 --frames 20 --eval "ctx.player.state.altitude"
```
`shot.mjs` builds, loads the page with `?test=1&autostart=1&…`, steps `--frames` frames of `--dt` seconds deterministically
(`window.__sim.step(n, dt)`), writes a PNG, prints console errors (exit code 1 if any) and the `--eval` result.
**Look at your screenshots** (Read tool on the PNG) — visual quality is the product. URL params: `src/core/params.js`.
- Rendering is software (SwiftShader) on a 4-core box shared by ~16 agents, and `shot.mjs` queues behind a 2-slot semaphore.
  Use small frames (`--size 480x270` or `640x360`), few frames, and batch what you check per run. Budget shots thoughtfully.
  You cannot measure real GPU performance here — design for it (count texture fetches / ray steps / draw calls) and say so.
- Pure-logic code (physics, data, math) should have `node --test` tests next to it (`*.test.js`); three's math classes work in node.
- For an isolated harness, make your own entry (e.g. `src/<module>/harness.js`) and build it with
  `node tools/shot.mjs --entry src/<module>/harness.js --html dist/<module>.html …` (it must set `window.__sim = { ready, step, ctx }`).

## 9. Working agreement for agents

- You work in your own git worktree on your own branch; other agents' work is NOT visible to you — you see the scaffold stubs.
  Code against the contracts above, not against stub internals. Commit early and often (`git add -A && git commit -m …`);
  **your final state must be committed on your branch** and must build (`node tools/build.mjs`) and boot with no console errors.
- Do not spawn sub-agents. Do not install new npm dependencies (three + esbuild only) unless your brief says so.
- No TODO-stubs presented as done. If something is out of reach, ship the best working subset and list what is missing.
- Final report (your last message, it is read by the integrator, not the user): (1) what you built, (2) public API and any
  contract deviations, (3) how you verified it (tests run, screenshots you looked at — give paths), (4) known issues / what you
  would do next, (5) any change you need in integrator-owned files.
