# Terrain — integration notes

Owner: terrain agent. Everything lives in `src/terrain/**`; no integrator-owned file had to change.

## Public API (as in ARCHITECTURE.md)

```js
import { createTerrain } from './terrain/index.js';
const terrain = await createTerrain(ctx);     // adds its meshes to ctx.scene, calls ctx.world.setTerrainHeightFn(heightAt)
terrain.heightAt(x, z)        // metres MSL at world (x, z); deterministic, allocation-free, 1-6 us
terrain.update(dt)            // once per frame, after the camera for this frame is final (reads ctx.camera, ctx.world.origin)
terrain.object3D              // the terrain mesh (one instanced draw call)
terrain.heightGLSL            // GLSL: float terrainHeight(vec2 worldXZ)
terrain.heightUniforms        // uniforms that chunk needs (shared by reference, updated in terrain.update)
```

Extras (optional to use):

- `terrain.sample(x, z, out)` -> `{ height, arid, special }` (aridity 0..1; special > 0 river water, < 0 dry lake bed).
- `terrain.stats` -> `{ patches, triangles, treeTriangles, minLevel, texelsThisFrame, clearance, drawCalls }`.
- `terrain.debug.parity(level, step)` GPU-vs-CPU height check; `terrain.debug.testHook()` evaluates `terrainHeight()`
  in a vertex AND a fragment shader and compares with `heightAt`.
- `import { heightAt } from './terrain/index.js'` (or `./terrain/height.gen.js`) works without a renderer (node tests,
  workers).

## `terrainHeight()` hook

- Valid in **vertex and fragment shaders**: only `textureLod` on a `sampler2DArray`, no derivatives, no
  `gl_FragCoord`. One fetch per call (two inside the narrow blend band between pyramid levels). All uniforms are
  declared `highp` so the same chunk can be pasted in both stages of one program.
- NOTE: the sampler is a `highp sampler2DArray` (the height clipmap pyramid), not a plain `sampler2D`. Materials that
  use the chunk must be WebGL2/GLSL3-compatible (three's `ShaderMaterial` and `onBeforeCompile` are fine) and must
  merge `terrain.heightUniforms` into their uniforms **by reference** (do not clone: `Object.assign(shader.uniforms,
  terrain.heightUniforms)`). If a `ShaderMaterial` declares `precision mediump sampler2DArray` itself, the chunk's
  explicit `highp` still applies.
- Accuracy: reads the same heights the terrain is drawn from. Within ~0.5 km of the camera it is exact to
  millimetres; it coarsens with distance like the rendered mesh (level l texels are 2^l m on medium, 2^l / 2 m on
  high). Beyond the pyramid (> ~1000 km from the camera) it returns -2000.
- The values are only valid after the first `terrain.update()`; pyramid levels finer than the camera's clearance
  needs are not kept up to date (the hook then answers from the finest valid level).

## Frame order

`terrain.update()` must run after the camera transform of the frame is known and before rendering. It renders into
its own render targets (clipmap strips, tree placement map) and restores the previous render target and
`renderer.autoClear`; it does not touch other renderer state.

## Rendering contract

- Material: `MeshStandardMaterial` + `onBeforeCompile` (engine sun / ambient / IBL / aircraft shadow map apply
  unchanged). `receiveShadow = true`, `castShadow = false`. No fog, no tone mapping; linear HDR output.
- Earth curvature: vertex y is lowered by `curvatureDrop(distance)` from `CURVATURE_GLSL`. Anything that must sit on
  the terrain far from the camera (ocean plane, scenery) has to apply the same drop or it will float / sink.
  The stub flat water of the scaffold does not, which is why far coasts look wrong against the stub (the real ocean
  applies the drop).
- Terrain self-shadowing (ray-march through the height pyramid toward `uSunDir`) and valley AO are applied inside the
  terrain material. Other objects are not shadowed by mountains.
- River water and the bed of the sea are part of the terrain surface. Rivers are drawn as flat dark water in the
  terrain shader (they are 20-40 m wide); the sea itself is the ocean module's.
- Land cover keeps clear of every runway listed in `AIRPORTS` (max 8 runways): mown turf / natural ground within
  ~0.8-1 km of the centre lines, no forest, no fields; 3D trees are never placed there.

## Quality

`ctx.quality.level`: low -> 256^2 x 13 pyramid, medium 512^2, high / ultra 1024^2 (normals at twice the mesh
resolution). `ctx.quality.terrainDetail` scales the LOD range (triangle count ~ detail^2). 3D trees: off on low,
88^2 / 104^2 / 128^2 cells (7 m) on medium / high / ultra, drawn only below ~900 m clearance. The module rebuilds
itself on `quality:change`.

## Debug URL parameters (read from `ctx.params.raw`)

| param | effect |
|---|---|
| `terrCam=dx,dy,dz,pitch,yaw` | camera at player + offset (m), looking pitch / true heading (deg); for screenshots |
| `terrCurv=0` | disable the curvature drop |
| `terrN=256\|512\|1024\|2048` | pyramid resolution override |
| `terrShadow=<steps>` | self-shadow ray-march steps (0 = off) |
| `terrTrees=<cells>` | tree grid size override (0 = off) |
| `terrHideWater=1` | hide `ctx.water.object3D` (look at the sea bed) |
| `towns=0` | no settlements (painted towns, 3-D buildings, street lamps) |
| `roads=0` | no road network (and no bridges, verges, road clearings) |
| `bldg=0` / `bldgR=<m>` | no 3-D buildings (the painted town stays) / override their draw radius |
| `micro=0` | no learned micro-relief shading in the far field |

## Tests and tools

- `node --test src/terrain/height.test.js` — airport flatness, approach clearance, carrier depth, geography,
  continuity, determinism, performance.
- `node src/terrain/tools/gen-height.mjs` — regenerate `height.gen.js` after editing `height.glsl.js` (the test fails
  if it is stale).
- `node src/terrain/tools/map.mjs --out shots/map.png --size 800 --cx 0 --cz 0 --span 640` — shaded-relief map.

## Measured budgets (software GL, `tools/shot.mjs`)

| quality | pyramid | LOD range k | patches / triangles on the KHVN runway | trees (below ~900 m clearance) | draw calls |
|---|---|---|---|---|---|
| low | 256^2 x 13 | 81 | 153 / 0.31 M | off | 1 |
| medium (test mode) | 512^2 x 13 | 160 | ~380 / 0.78 M | 88^2 cells, 0.23 M | 1 + 1 |
| high | 1024^2 x 13 | 200 | 529 / 1.08 M | 104^2 cells, 0.32 M | 1 + 1 |
| ultra | 1024^2 x 13 | 216 | 604 / 1.24 M | 128^2 cells, 0.49 M | 1 + 1 |

Triangle counts fall quickly with altitude (medium: 0.63 M at 300 m, 0.23-0.47 M at 3 km, 0.35 M at 11 km, 0.29 M at
25 km). GPU memory of the pyramid: 12 bytes per texel -> 10 MB / 41 MB / 163 MB (low / medium / high+ultra).
Per-frame clipmap work while flying is the new L-shaped strips only (4-16 k texels per frame at Mach 2 low level);
whole-level refills (boot, teleport, quality change) are rationed to 5 levels on the first frame and 2 per frame after
that (in `test=1` mode: up to 4.2 M texels per frame, i.e. everything at once on medium, 4 levels per frame on high —
give `quality=high` screenshots at least 4 frames).
`heightAt`: 1.5-3.5 us on the plain, 1-2 us at sea, 4-7 us in the mountains, 5-9 us in the desert (node, one core).

## Settlements and roads (round 2)

- `tools/gen-settle.mjs` (offline, ~30 s, `nice -n 10 node src/terrain/tools/gen-settle.mjs [--map shots/x.ppm]`) reads
  `heightAt` on a 500 m grid, scores suitability (flat, low, not arid, off water, off the airports), sows 2 cities,
  13 towns, 217 villages and 583 hamlets, grows a highway tree between the big places with a slope-aware Dijkstra,
  links everything else with rural roads and lanes, and writes `settle-data.js` (154 kB, quantised). Rerun it after
  any change of the height function that moves coasts or valleys.
- `settle.js` decodes that at boot into a 512 m lookup grid (RGBA16UI: segment list offset/count, town index), a
  segment texture and a town texture, and holds the JS twin of the GLSL town layout (`blockAt`, `lotAt`; the hash is
  an integer hash that is bit-identical in both). `roadClear(x, z)` and `townAt(x, z)` are exported for other
  modules (nothing outside terrain uses them yet).
- `surface.glsl.js` paints roads (carriageway, markings, verges, bridge decks over water) and towns (streets, lots,
  yards, drives, roofs with gable normals, an analytic box shadow, garden trees) into the ground material at every
  distance; beyond the 3-D radius the town fades to its area mean. `ground=classic` turns all of it off.
- `buildings.js` draws the same lots as one instanced mesh (box + gable roof, 14 triangles each) inside
  650 / 1000 / 1400 / 2000 m (low / medium / high / ultra), capped at 2600 / 6000 / 10500 / 16000 instances
  (36 k / 84 k / 147 k / 224 k triangles), one draw call plus one in the shadow pass. Chunks (one grid cell) are
  generated at most two per frame (~6 ms each on the test box).
- Night: street lamps are pools of emissive on the painted streets (they merge analytically into lit streets and then
  into the town glow with distance, so the total emitted light is the same at every scale), windows are emissive on
  the instanced walls. `index.js` scales both by `nightFactor * 40 / exposure`.

## Dunes, rills, micro-relief (round 2)

- Dune fields are part of the height function (`height.glsl.js`, after `gSpec`): transverse dunes with slip faces,
  up to 21 m, only in the driest basins. The dune mask rides on the arid channel as `arid > 1`; every reader clamps
  (`min(arid, 1)`).
- Erosion rills and avalanche chutes: three fixed downslope-stretched noise lookups on slopes, steering scree, rock,
  snow and colour. No height change.
- `src/neural/ground-micro.js`: a 4-20-20-1 MLP (541 weights) trained on an offline numpy heightfield renderer
  (`tools/neural/ground/micro/`) gives the mean brightness of a rough surface with self-shadowing as a function of
  sun elevation, view elevation, relative azimuth and roughness; baked at boot into a 16x16x8 RGBA16F 3-D LUT and
  read once per fragment in the far field. Held-out RMSE 0.0136 against 0.126 for Lambert and 0.059 for a fitted
  Oren-Nayar.

## Shader cost added in round 2 (per terrain fragment)

- 1 integer fetch (settlement grid) everywhere; +2 fetches per road segment in the cell (at most 14 segments,
  typically 0-3); +2 town texels and one more grid fetch inside a settlement.
- up to 3 `textureGrad` on slopes steeper than ~12 degrees (rills).
- micro self-shadow: +1 fetch on medium, +2 on high, near field only; micro LUT: 1 trilinear 3-D fetch.
- Boot: settlement decode 47 ms, micro LUT bake 13 ms (software GL box under load).

## Airfield ground (round 3)

What the player sees from the runway: pavement (scenery/pavement.js), the turf around it, the fence line and the land
beyond. New pieces, all inside `src/terrain/**` plus the owned scenery/neural files; no integrator change needed.

- `airfield.js` — **airfield map**: signed distance field of the pavement of the airport nearest the camera, baked on
  the GPU from `ctx.scenery.airports[].layout` (read lazily, rebuilt when the nearest airport changes) into one
  RGBA16F texture: r = distance to any pavement (runway, taxiway, apron, shoulder, blast pad, fillet, road, car park),
  g = to runway pavement, b = to the airside perimeter fence (layout's `perimeter` box; 230 m iso-line of r without
  one). 2 m texels capped at 1536^2 (medium / low: 4 m) or 2048^2 (high / ultra): ~10-18 MB, ~5 ms. Exposed as
  `ctx.terrain.airfield` (`stats`, `distanceAt(x, z)` CPU twin). GLSL `airMap(rxz)`, `airSide(rxz)`, `turfPlan(...)`.
- Land cover: around the mapped airport the airside now ends at the perimeter fence (fields, hedges, woods and 3-D
  trees come up to it) instead of a 760-1000 m ring of featureless turf; approach corridors (runway ends + 1.1 km,
  +-150 m) stay open. Other airports keep the old ring.
- Turf (surface.glsl.js): mown in 6.4 m passes parallel to the primary runway with alternate lay, blocks of passes at
  different times since mowing, short sward in the graded strip and long grass beyond ~55-120 m from pavement,
  clumps, dry knolls, seed heads, clover, mower wheel tracks, a worn gritty verge and the shadowed drop at the pavement
  edge. The stripes are not painted: they come out of the learned turf reflectance (below).
- `veg/turf.js` — **near-field 3-D turf**: N alpha-blended shells (one instanced draw) over the turf within R
  (medium 6 x 40 m, high 8 x 60 m, ultra 12 x 84 m, off on low), blade cross-sections from a baked mip-mapped
  RG8 array (256^2 x 8, two lookups), leaning with the pass lay and swaying in travelling gusts (`uVegWind`), fading
  out with distance and at grazing angles into the ground (which darkens under the shells to thatch). Cells entirely
  on pavement are dropped from the index buffer on recentre; the fragment stops at the pavement edge. `turf=0` off.
- `veg/grass.js` tufts on the airfield only in the long-grass zone (seed heads), sparse; the mown sward is the shells'.
- `src/neural/ground-turf.js` — **learned turf reflectance**, see the next section. `turfbrdf=0` = Lambertian grass.

## Turf reflectance network

Reference: `tools/neural/ground/turf/trace.py`, a blade-level Monte Carlo path tracer of mown turf (0.24 m periodic
tiles, ~25 000 tapered two-segment blades per m^2 in clumps, lay 0-1, sward 2.5-14 cm; Lambertian reflection +
transmission, GGX cuticle sheen, thatch / soil floor; sun next-event estimation, sky escape, 6 bounces). 44 swards,
12 400 (sun, view) configurations at 1536-2048 rays. `train.py`: SUN net 9-32-32-3 (ln BRF) and SKY net 4-16-16-3
(ln HDRF), 1 878 parameters; 6 swards held out.

| held-out swards | ln RMSE | rel. luminance RMSE |
|---|---|---|
| Lambert, oracle albedo per sward | 0.582 | 0.524 |
| RPV (standard vegetation BRDF, fitted per channel, linear in lay / height) | 0.304 | 0.266 |
| **network** | **0.124** | **0.100** |
| Monte Carlo noise of one sample (noise.py) | 0.062 | 0.051 |

What it learned: the hot spot (upright long grass ~2x brighter looking down-sun than into the sun), the dark nadir of
upright grass (soil between the blades), the waxy sheen toward a low sun, and lay-dependent brightness: a mown,
laid sward is ~1.5x brighter viewed along the lay than against it (mowing stripes that flip as you look the other
way). RPV cannot know the lay direction, which is most of its error. Runtime: only the sun elevation is baked
(12 x 16 x 16 RGBA16F per corner, mown A / long B; ~45 ms at boot, then a few slices per frame as the sun moves);
terrain cost 2 trilinear fetches on grass pixels. Applied to airfield turf and natural grass: brightness from the
networks, 30 % of their chroma change, colour from the painted albedo.

## Costs added in round 3

| item | per frame | memory | boot |
|---|---|---|---|
| airfield map | 1 bilinear fetch per ground pixel near the airport | 10-18 MB (1 airport) | ~5 ms GPU pass on change |
| turf reflectance | 2 trilinear fetches on grass pixels | 2 x 24 kB | ~45 ms (JS bake) |
| turf shells | 1 draw, N x (grid cells off pavement) x 2 triangles (~3-20 k), 2 fetches per shell fragment | 1 MB blade array | ~45 ms (blade raster) |
| pavement aggregate | 2 fetches per pavement pixel | 256 kB | ~80 ms (JS) |
