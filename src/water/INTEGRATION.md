# Ocean (src/water) — integration notes

API (unchanged): `createWater(ctx) → { update(dt), object3D, heightAt(x, z) }` plus read-only extras
`seaState` (current spectrum parameters), `stats` ({ N, vertices, triangles, floatFFT }), `dispose()`.
`heightAt` is unchanged (FFT components only; the near-shore surf relief is visual and not in it).

## Photorealism pass (round two) — what changed
- `water=classic` restores the previous look verbatim (`shaders-classic.js`, opaque, no rivers, no cloud reflection).
- **Premultiplied output** (blend ONE / ONE_MINUS_SRC_ALPHA, target alpha untouched): alpha = 1 − transmittance.
  Deep water is opaque as before; in the shallows the seabed the terrain drew is seen through the water column
  (two-way extinction along the refracted paths, per-region optics); over the beach the grid is draped up to the top
  of the swash zone and draws the moving swash film, the wet-sand darkening and sheen — no hard plane/terrain line.
- **Surf** (vertex shader, coastal vertices only): seabed slope + 3 seaward taps → shelter (reefs and bars limit what
  reaches a lagoon), depth-limited breaker height, energy dissipation (breaking only where height is lost), bores
  travelling shoreward with the shallow-water celerity (real height, so they read at grazing angles), shoaling swell
  lines, along-shore segmentation, swash run-up in phase with the bores.
- **Glints**: Poisson count of sun-mirroring facets per world cell of ~1 pixel footprint (2 octaves, rotated lattices,
  6 Hz twinkle), mean-preserving, relative fluctuation 1/sqrt(count), exposure-aware clamp (≤ 24 after exposure).
  Density = 0.6·U facets/m² at the lobe peak. Same for the moon path.
- **Reflected clouds**: the reflected ray is traced to the cloud base and `cloudShadowTau()` (clouds module) read
  there; flanks near the horizon, shaded bases overhead. The fragment shader is rebuilt once when `ctx.clouds`
  appears (before the first frame in the sim; `wclouds=0` disables).
- Water body: navy ocean, green turbid temperate coast, clear tropical water (`tropic` = same latitude band as the
  terrain), sand suspended in the surf, caustics on the shallow bed (near only), crest SSS (as before).
- Cat's-paw roughness patches (wind frame, downwind-stretched, light air only), anti-tiling modulation with a second
  non-commensurate noise, whitecap foam spreading (blurred persistent foam), rain roughness + rings (< 120 m),
  downwash / wake streak under a player aircraft < 45 m above water.
- **Rivers** (`inland.js`): a second draped grid shades where the terrain's clipmap marks river water
  (`terrTexH().w`): flow-advected ripples (two-phase flow map along the channel, downhill), reflections incl. clouds,
  glints, turbid green-brown water with a soft bank edge, flow foam, sand bars. Off on `quality=low`, `wriver=0`.
  If the terrain's GLSL no longer defines `terrTexH`/`uTerrWin`/`uTerrLod` it silently does nothing.

## What it needs from other modules
- `ctx.pipeline.atmosphere.{glsl, uniforms}` — `atmSunIlluminance`, `atmSkyRadiance`, `atmAmbient` are called.
  **`atmSunIlluminance` and `atmSkyRadiance` are also called in the VERTEX shader** (per-vertex sun irradiance and
  moon-light reference), so the atmosphere GLSL must compile in a vertex shader (no `dFdx`/`fwidth`, no implicit-LOD
  `texture()` reliance beyond base level — `texture()` in a VS samples LOD 0, which is fine for LUTs).
- `ctx.terrain.heightGLSL` / `heightUniforms` — `terrainHeight(worldXZ)` is called in both VS (wave-amplitude fade
  as depth → 0) and FS (depth colour, shore foam). Must also compile in a vertex shader.
- `ctx.weather.wind`, `ctx.weather.windSpeed`, `ctx.quality.waterDetail`, `ctx.quality.anisotropy`,
  `ctx.env.moonDir`, `ctx.env.nightFactor`, `ctx.world.origin`, `ctx.world.terrainHeightAt`.
- Water is created after terrain (main.js order already does this).

## Rendering
- One `ShaderMaterial` mesh (polar grid, `frustumCulled = false`, positioned entirely in the VS), layer 0, opaque,
  writes depth, `renderOrder = 10` so it draws after terrain/scenery and early-z rejects ocean pixels under land.
- Output is linear HDR radiance; no fog, no tone mapping. Sun glitter peaks are strongly HDR (≫ 1) for bloom.
- Per frame the FFT runs 3 cascades × (1 + 2·log2 N + 1) fullscreen passes into its own small render targets
  (inside `water.update`, before `pipeline.render`; renderer target is restored).
- Needs `EXT_color_buffer_float` for best FFT precision (falls back to half-float targets automatically).

## Cost (budget, mid-range discrete GPU, 1080p, quality high)
- FFT: N = 256 (high/ultra) or 128 (medium/low). 3 × 18 passes × N² fragments ≈ 3.5 M (N=256) / 0.9 M (N=128)
  small fragments, each 2–4 `texelFetch` of RGBA32F + 2 MRT writes. ≈ 0.6–1.0 ms (N=256), ≈ 0.2 ms (N=128).
- Geometry (measured): high/ultra 320 segments = 149 k vertices / 298 k triangles; medium 256 seg = 96 k / 192 k;
  low 160 seg = 38 k / 76 k. One draw call. Far rings collapse onto 1.5 × horizon distance (degenerate, culled).
  VS: 3 `textureLod` + `terrainHeight` + `atmSunIlluminance` (+ `atmSkyRadiance` only at night).
- Fragment (the important one, ~half the screen): 3 slope fetches (trilinear/aniso), 3 noise fetches,
  2 foam fetches (+1 streak warp, +2 streak fetches), `terrainHeight` ×1, `atmSkyRadiance` ×1, `atmAmbient` ×2,
  ≈ 11 texture fetches + ~250 ALU. Roughly comparable to a PBR terrain material with 3–4 layers.
  On a 1080p frame with 50 % ocean ≈ 1 M pixels ≈ 0.7–1.0 ms on a GTX 1660-class GPU.
- CPU: ≈ 0.05 ms/frame; a sea-state refresh (≈ 4 ms) only while the wind is changing, at most every 0.4 s.
- Boot: ≈ 40–60 ms (gaussian fields, noise/foam textures, shader compile is the GPU driver's).

## Cost of round two (counted, not measured: software GL here)
- Ocean fragment: ≈ 11 → ≈ 19 fetches in open water with clouds (+1 second anti-tiling noise, +2 cat's paws, +2 foam
  spread, +1 surf lace, +2 cloud reflection), +2 caustic fetches in the near shallows; glints/rain are ALU (~60).
  `terrainHeight` per pixel unchanged (1).
- Ocean vertex: coastal vertices only (−14 m < bed < top of the wet beach) add 7 `terrainHeight` + 3 noise fetches.
- Rivers: one extra draw, 22 k vertices / 45 k triangles (2 fetches per vertex); land pixels in reach mostly discard
  on the interpolated vertex mask (0–1 fetch), river pixels ≈ 14 fetches. No new render passes or targets.
- Boot: unchanged (createWater 209 → 213 ms in SwiftShader, i.e. noise; shaders compile lazily on first render).

## Debug URL params (harmless in production)
`wdebug=1..7` (foam / depth+shelter / roughness / normal / Jacobian / glints / reflected-cloud cover),
`wdisp=0` (no vertex displacement), `waniso=N` (force anisotropy), `wwind=<m/s>` (force the sea state, e.g. 0.5 for
glassy calm), `wclouds=0`, `wriver=0`, `water=classic`. Harness extras: `clouds=1` (real clouds), `wake=<h>`
(stand-in aircraft h m above the water 80 m ahead). Harness: `node tools/shot.mjs --entry src/water/harness.js --html dist/water.html
--params "x=0&z=16000&alt=30&hdg=295&pitch=-3&tod=18.6&weather=scattered"` (free camera: x, z, alt, hdg, pitch, fov,
spd, pre=<m> to force a different floating origin).

## Verification hooks
`ctx.water._debug` exposes `{ fft, Spectrum, sea, cascadeDefs, time }`; a GPU-vs-CPU DFT check (read an FFT texel,
compare with `Spectrum.evalHeight` over all components of `Spectrum.buildCascade`) agrees to 4 significant digits.
`node --test src/water/` covers spectrum conventions (Hermitian packing, downwind travel, variance tables).

## Requests to other modules (optional, the water works without them)
- render: the composite multiplies the whole water pixel by the cloud-shadow factor, which also darkens the
  reflected sky; real cloud shadows on the sea are much subtler. A flag (e.g. scene alpha or a stencil bit) that
  limits the re-weighting to the diffuse share would fix it.
- terrain: the sea bed is now visible through shallow water. Under water near the KHVN beach the bed material shows
  a polygon-crack (desiccation) pattern that does not belong under the sea; sand ripples / seagrass would. A
  `riverFlow` (unit downstream direction) in the clipmap would replace the water module's mask-gradient estimate.
- terrain: there are no fresh-water lakes in the world (only dry playas), so "calm lakes" have nothing to draw on.
