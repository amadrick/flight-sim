# Ocean (src/water) — integration notes

API (unchanged): `createWater(ctx) → { update(dt), object3D, heightAt(x, z) }` plus read-only extras
`seaState` (current spectrum parameters), `stats` ({ N, vertices, triangles, floatFFT }), `dispose()`.

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
- Geometry: polar grid 320 segments (high) ≈ 120 k vertices / 240 k triangles; 256 seg (medium) ≈ 96 k; 160 (low) ≈ 40 k.
  VS: 3 `textureLod` + `terrainHeight` + `atmSunIlluminance` (+ `atmSkyRadiance` only at night).
- Fragment (the important one, ~half the screen): 3 slope fetches (trilinear/aniso), 3 noise fetches,
  2 foam fetches (+1 streak warp, +2 streak fetches), `terrainHeight` ×1, `atmSkyRadiance` ×1, `atmAmbient` ×2,
  ≈ 11 texture fetches + ~250 ALU. Roughly comparable to a PBR terrain material with 3–4 layers.
  On a 1080p frame with 50 % ocean ≈ 1 M pixels ≈ 0.7–1.0 ms on a GTX 1660-class GPU.
- CPU: ≈ 0.05 ms/frame; a sea-state refresh (≈ 4 ms) only while the wind is changing, at most every 0.4 s.
- Boot: ≈ 40–60 ms (gaussian fields, noise/foam textures, shader compile is the GPU driver's).

## Debug URL params (harmless in production)
`wdebug=1..5` (foam / depth / roughness / normal / Jacobian views), `wdisp=0` (no vertex displacement),
`waniso=N` (force anisotropy). Harness: `node tools/shot.mjs --entry src/water/harness.js --html dist/water.html
--params "x=0&z=16000&alt=30&hdg=295&pitch=-3&tod=18.6&weather=scattered"` (free camera: x, z, alt, hdg, pitch, fov,
spd, pre=<m> to force a different floating origin).

## Requests to the integrator
None required. Optional: a `ctx.quality.waterDetail` value is already used; nothing else to add.
