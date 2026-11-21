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

## Airfield ground (round 4): runway surface, near grass, low sun

All inside the owned files (`src/terrain/**`, `src/scenery/pavement.js`, `textures.js`, `src/neural/ground-*`,
`tools/neural/ground/**`). No hook elsewhere was needed.

Runway (`scenery/pavement.js`, `textures.js`):
- **Rubber map** (`simulateRubber`): a simulation, not noise. ~1 700 landings of a traffic mix (gear track, tyres per
  side, tyre width, deposit strength) touch down lognormally past the threshold with lateral scatter and de-crab drift;
  each tyre lays a short black spin-up skid and a long faint smear. ~340 departures enter from the threshold taxiway
  (main gear arcs; the inner wheel scrubs hard in a tight turn), line up and spool up against the brakes. R = all
  deposits (1 - exp), G = the last 10 % (crisp black marks over the grey). 512 x 512 RG8 x 2 layers (one per runway
  end, picked by runway size), v stretched toward the threshold (0.75 m texels there, 5 m at 1.5 km). Paint reads the
  same map (rubber over the markings).
- **Defect map** (`makeDefectTexture`, canvas 1024 / 2048 px for 64 x 32 m): hand-poured sealant over-banding on
  transverse / longitudinal / block cracks, fresh (black) and old (pale) patches with sealed borders, oil drips. Cut
  into one strip per paving lane so cracks end at the lane joints; the paint shader reads the same strips so cracks
  run on through the markings.
- Paving lanes with tar-sealed longitudinal joints and ravelled edges, the odd transverse construction joint, keel
  darkened and polished, edges oxidised pale, nose-gear line with oil drips, crazed / streaky paint, shoulders with a
  crumbling margin, soil wash, edge-light bases and a sealed cable slot (`aEdge` attribute), new close-range
  aggregate (512^2 convex stones of several rock types, 0.62 m tile).
- Concrete (KRDR): slabs one lane wide x 6 m, tone continuous along each slip-formed lane (per-slab random tone read
  as floor tiles), thinner joints, keel staining.
- Rubber is black and matte to the sky (its sheen is the sun's); asphalt gets its lighting factors from the learned
  pavement reflectance (next section); `pavebrdf=0` = classic shading with a fixed grazing sky occlusion.
- Debug: `pavedbg=1` no rubber, `2..5` defect channels off, `6` patch map, `7` rubber map (grey), `8` no sky
  reflection.

## Pavement reflectance network

Reference: `tools/neural/ground/pave/trace.py` (numpy). 114 mm periodic tiles, 256^2 height texels (0.45 mm):
crushed stones 2-14 mm (convex polygons, worn tops, three rock types) in a binder of sand fines whose level sets the
exposure; 6 x 6 mm saw grooves every 38 mm (60 % of tiles); rubber filling the texture (albedo -> 0.022, smoother);
wetness (porous darkening and a facet film, then free water filling from the bottom: a flat water plane). Facets:
Lambert + GGX / Smith / Schlick. Macro: exact cast shadows and masking from 24-azimuth horizon maps; sky: one
importance-sampled direction per texel and lobe with horizon visibility. Single scattering. 72 tiles x 2 688
(sun, view) configurations + 96 views under a unit sky; `train.py` (numpy MLPs, Adam): SUN net 11-32-32-2
(ln Kd, ln Ks), SKY net 6-8-8-2 (ln Hd, ln Hs), 1 584 + 154 parameters; 12 whole tiles held out.

| held-out tiles, ln RMSE of the total reflectance | sun (BRF) | unit sky |
|---|---|---|
| classic (three.js Lambert + GGX at the shader's roughness 0.6) | 0.626 | 0.289 |
| classic fitted per held-out tile (roughness, F0, diffuse scale; oracle) | 0.484 | 0.095 |
| **network** (knows only groove / exposure / rubber / wetness) | **0.115** | **0.071** |
| network, grazing views (mu_v < 0.2) vs classic | 0.149 vs 0.850 | 0.103 vs 0.373 |
| Monte Carlo noise of the reference (noise.py; the sun term is deterministic) | 0 | 0.003 |

What it learned: at grazing view the eye sees the stone tops, so the visible albedo is higher than the tile mean and
the surface brightens down-sun (Kd up to ~1.7) and darkens looking into the sun; the stones and grooves hide about half
the sky's mirror image that a flat GGX surface shows (Hs / DFG ~0.5 at grazing), more looking across the grooves
than along them; seen from above the shadows between the stones make it ~10-15 % darker than Lambert. Limits: single
scattering (the missing second bounce is a few per cent in the grooves), horizon maps quantised to 24 azimuths, one
synthetic aggregate gradation. Runtime (`src/neural/ground-pave.js`): per airport a 32 (view azimuth about the first
runway's axis) x 16 (mu_v) x 4 (groove x rubber) RGBA32F LUT of the factors the pavement shader multiplies three.js'
four lighting terms by; baked for the current sun and wetness (capped at damp: standing water keeps the classic
glint, which a 32 x 16 LUT cannot hold), ~2 k evaluations / ~10-20 ms, only when the sun moves > 0.25 deg (at most
every 2 s unless it jumps). Off on low quality.

Near grass (`veg/blades.js`, `veg/turf.js`, `surface.glsl.js`):
- Instanced blade geometry (one draw, 7 vertices / 5 triangles per blade, two world-anchored jittered rings: medium
  2.8 m / 7.5 m, high 3.8 / 10, ultra 5 / 13; off on low; `blades=0`). Blades narrower than 1.3 px are widened to it
  and thinned in proportion (dithered, no popping), so the covered area and colour stay right with distance. Rounded
  cross-section normal, dark base / lit tip, waxy sheen (weak: sub-pixel tips sparkle), translucency toward the sun.
  Fixed: the two-sided normal handling left most blades facing away from the sun (black); the normal is now kept in
  the upper hemisphere. The shells' upper layers
  give way and the sward floor darkens under the blades, ramped over 0.35-1 x R1 so there is no ring.
- Low sun: on vegetation the detail normal and the one-tap micro shadow are reduced (they doubled the self-shadowing
  the turf reflectance already has and drew streaks along the sun azimuth); the 20-100 m clump terms are gentler.

## Costs added in round 4

| item | per frame | memory | boot |
|---|---|---|---|
| rubber map | +1 fetch per runway and paint pixel (replaces 2 noise fetches on runways) | 1 MB | ~150-300 ms (JS sim, 2 layers) |
| defect map | +1 fetch per asphalt pixel, +1 per paint pixel | 8 / 2 MB (high / medium) | canvas raster, ~50 ms |
| pavement reflectance | +2 bilinear fetches per asphalt pixel | 4 x 8 kB per airport | ~10-20 ms per rebake |
| other pavement detail | +1-2 noise fetches (drips / striations / crumbled edge), +2 on paint (crazing, film) | - | - |
| aggregate 512^2 | same 2 fetches | 1 MB (was 256 kB) | ~0.3-0.6 s (JS; was ~80 ms) |
| grass blades | +1 draw within 25 m AGL at an airport; medium 156 k instances (~70 % culled in the vertex shader), 5 fetches per vertex, no textures in the fragment | - | - |

Night / lamp and fire light on grass (round 4 fix): the turf reflectance's sun factor (`canopyK`) and its reduced
specular (`specK`) were applied to every direct light, so with the sun down a low fire or lamp got the "sheen into a
low sun" and the detail normals turned it into glitter. Now the sun factor fades out below the horizon, the canopy
is fully matte to direct light at night, the shells have no specular, and the blades' sheen is the sun's only.
Hook for `src/effects/decals.js` (not owned here): the crash fire-light sheen decal uses a GGX lobe (roughness 0.3)
with a normal from depth derivatives on every surface; on turf it should be skipped or made diffuse (e.g. only where
`ctx.terrain.airfield.distanceAt(x, z)[0] < 0`, i.e. on pavement).

## Ground vegetation (round 5): grass, crops, fields, scrub

All inside the owned files (`surface.glsl.js`, `material.js`, `index.js`, `airfield.js`, `veg/turf.js`, `veg/blades.js`,
`veg/grass.js`, `veg/placement.js`, new `veg/cover-crop.js`, `src/neural/ground-crop*`, `tools/neural/ground/crop/**`).

Two old bugs were behind most of what looked wrong up close:
- **Grass map empty everywhere.** `veg/grass.js`'s map pass reads the cover, which reads the settlements
  (`tSetGrid` is a `usampler2D`); the pass never bound those textures, so the integer sampler sat on a unit with a float
  texture and every draw failed with INVALID_OPERATION, silently. No grass tufts, no meadow blades, no crops grew.
  The pass now binds them, as `placement.js` already did.
- **Black blades.** The blade geometry had no `normal` attribute, so three compiled the Standard material
  `FLAT_SHADED`, lighting every standing blade by its horizontal face normal: every blade seen toward the sun went
  near black, and the final sharpen made specks of them. Blades and crop plants now carry a (dummy) normal attribute.
  Any instanced Standard-material mesh that builds its normal in the vertex shader needs one.

Near grass (`veg/blades.js`): an instance is a tuft of 7 blades (3 segments). Kinds by hash: living blades (young
yellow-green to old blue-green, olive in the rough, browning tips), dead straw, seed stems with heads, clover / plantain
leaves lying nearly flat in weedy patches, the odd flower (white / yellow / mauve). Clumps and bare scuffs from the 4 m
and 0.7 m noise, thinning toward the pavement, widening to 1.2 px with hash dropping (no speckle), translucency to the
sun, sun-only sheen. Off the airfield the blades grow where the grass map says meadow (kind 0 carries the meadow share).
Turf shells vanish inside the blade radius; the ground between blades is shaded green thatch, never black.

Airfield turf (`airfield.js turfPlan`, `surface.glsl.js`): mostly rough (long grass from ~26 m off the pavement plus
random long panels); mowing passes faint and irregular; ground turf less saturated and olive, stronger clumps, hollows,
seed-head haze, dry patches.

Fields (`surface.glsl.js terrFieldColor`, `terrFieldT`): 11 classes from one per-field number (green / ripe cereal,
plough, seedbed, pasture, stubble, ley, maize, flowering rape, beet / potatoes, fallow), soil zones, a 12-24 m headland
worked parallel to the edge, drill rows, tramlines every 18-30 m plus one round the headland, lodging, combining with a
stubble cut, plough lands with dead furrows, straw swaths and bales, pasture tussocks / dung / buttercups / poached gate,
wet and dry patches, rough grass margins with a sterile strip; far colours desaturated toward olive.

Crop plants (`veg/cover-crop.js`): near-field 3-D crop within 16 / 20 / 26 m (medium / high / ultra), snapped to drill
rows, per-m^2 density by crop: cereal stalks with ears and leaves, stubble with weeds, maize stem + 5 leaves across
the row, rape with flower clusters, beet rosettes, hay grass. Read from the grass map (kind 3 + class / 10, r =
height, b = row angle / pi, a = cover). They sink toward the ring edge. Not drawn within ~130 m of airfield pavement.

Crop reflectance network (`src/neural/ground-crop.js`): see the file header. Held-out ln-RMSE of the sun BRDF 0.216
vs 0.311 for a fitted RPV vegetation BRDF and 0.455 for Lambert with the oracle albedo (per crop: cereal 0.178 / 0.313,
maize 0.293 / 0.333, rape 0.322 / 0.404, meadow 0.127 / 0.236, stubble 0.153 / 0.228). Multiplies the direct-sun
diffuse of field pixels (hot spot, row shading, into-sun darkening), 1 trilinear fetch.

Scrub (`veg/placement.js`): more solitary bushes in open country, bramble / thorn scrub along field margins with no
hedge, willow / alder scrub on river banks (drawn by the tree agent's renderers).

Forests (requested by the tree agent): with `VEG_CANOPY` the surface's own painted crown modulation is dropped (the
canopy draws its crown relief); floor shade under 3-D trees 0.5 -> 0.7 (trees draw contact shadows); a stand mosaic
(410 m / 110 m noise: older taller stands darker, young ones lighter, yellower) and a shaded stand edge from afar.

Low-eye grain (`surface.glsl.js terrSward`, round 5b): beyond (and under) the 3-D blades and crop plants the ground
draws the blades / stalks as a grain in camera-centred (azimuth, log range) cells - an upright blade of height H at
range r hides the ground from r to r hc / (hc - H), so in log range every blade is one cell high; 2 staggered layers x
2 rows composited far to near, filtered against the pixel, normalised to mean 1 (the far colour does not change).
Applied to airfield turf (H = sward height), natural grass (0.3 m) and standing crops (H = crop height as the grass map
gives it, `gCropH`; ears on ripe cereal and hay). It fades where a blade is under ~2 px high and with range (a cell many
plants wide), only below 60 m above the ground. Into a low sun the crop grain darkens (shaded stalk sides, as the
3-D plants show). Because the grain stands as high as the plants, the crop plants now keep ~full height to the ring
edge (no dome, no rim). The grain is fixed to the camera's frame: it does not swim when the view turns, only with
travel (pixel-scale, under the world-anchored clumps). Uniform `uTerrNear` (x = radians per pixel, set by index.js).
Cost: ~4 integer hashes, 1 atan, 1 log, 2 pow per turf / grass / crop fragment near the ground; nothing from altitude.
Also: crop gap fraction follows the view, (gap from above)^(1 / cos view zenith) - no soil between the rows seen across
a field; rows, drill passes and tramlines are filtered against the footprint across them (sharp converging lines
looking along them instead of a blur); bales scattered irregularly (no stipple lattice from altitude); field-margin
tufts (veg/grass.js) shaded in their own depth.

Switches: `cropbrdf=0` (classic Lambert crops), `cropPlants=0` (no 3-D crop), `blades=0`, `turf=0`, `turfbrdf=0`,
`sward=0` (no low-eye grain), `ground=classic`. Debug (tools only): `blDbg=1|2|3` (blades: normal up / albedo / lighting panels), `cropDbg=1|2` (crop
everywhere / show the grass map), `grDbg=1..4` (grass map forced outputs).
