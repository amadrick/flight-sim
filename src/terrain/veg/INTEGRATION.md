# Vegetation — integration notes

Owner: vegetation agent. Files: `src/terrain/trees.js`, `src/terrain/veg/**`, `src/neural/veg*.js`,
`src/neural/test-vectors-veg.json`, `tools/neural/veg/**`. `src/terrain/index.js` has a 6-line change (trees are on at
every quality, `createTrees(ctx, { L, uniforms })`, `stats.veg`).

## What draws (per frame)

| pass | what | draw calls |
|---|---|---|
| placement map (offscreen) | toroidal G x G map of 6.5 m cells; only newly exposed rows/columns + a rolling band of G/24 rows | 1-5 small viewport renders |
| grass map (offscreen) | Gg x Gg cells of 1 m around the camera (only below 150 m clearance) | 1 |
| `veg-near` | procedural tree meshes within `near` m (vertex pulling: any species mix, one call) | 1 (+ shadow depth) |
| `veg-far` | hemi-octahedral impostors out to ~0.48 x G x 6.5 m | 1 |
| `veg-grass` | grass / turf / reed tufts (2 crossed cards each) | 1 |

All three meshes are `MeshStandardMaterial` + `onBeforeCompile` (engine sun, shadow map, IBL), linear HDR, no fog,
alpha-tested with depth write, no blending. Near trees cast into the sun shadow map (`customDepthMaterial`) when
`ctx.quality.shadows`; impostors and grass receive only. The sun-dependent terrain shadow per tree comes from the
placement map; tree-to-tree shading from the crown transfer network.

## Per-quality budgets (`TIERS` in trees.js)

| quality | far map G (radius) | near mesh radius | grass cells | triangles submitted (max rasterised*) | draws |
|---|---|---|---|---|---|
| low | 176 (550 m) | none | none | 62 k (47 k) | 1 + 1 offscreen |
| medium | 320 (1.0 km) | 70 m | 96^2 | 463 k (~360 k) | 3 + shadow + 2 offscreen |
| high | 384 (1.2 km) | 80 m | 112^2 | 650 k (~500 k) | 3 + shadow + 2 offscreen |
| ultra | 512 (1.6 km) | 130 m | 160^2 | 1.4 M | 3 + shadow + 2 offscreen |

*Instances of empty cells and cells outside the layer's ring collapse to degenerate triangles in the vertex shader;
"max rasterised" assumes 100 % forest cover. Vegetation is off above ~1.6 km clearance (0 triangles).
Texture memory: impostor atlases (7 x 7 views per species, frame 72 px) 2 x 2016 x 1512 RGBA8 with mips (32.5 MB; 2 x 1792 x 1344 at frame 64 on low),
foliage atlas 1024^2 RGBA8 (5.6 MB), vertex texture 0.7 MB, maps < 2 MB, neural LUTs 50 kB.
Boot: foliage atlas 50-140 ms (JS rasteriser), meshes 30 ms, impostor bake 2 draw calls, neural LUT bake ~15 ms
(measured 200-370 ms in total on the loaded build box; `ctx.terrain.stats.veg.bootMs`, `.parts`).

## URL parameters (read from `ctx.params.raw`)

| param | effect |
|---|---|
| `veg=classic` | non-neural lighting: crown transfer by Beer-Lambert through the envelope + fixed neighbour term; the canopy LUT becomes a flat Lambertian green with the same albedo |
| `vegG=<cells>` | far map size override |
| `vegNear=<m>` | near mesh radius override (0 = impostors only) |
| `terrTrees=0` | no vegetation at all |
| `vegDbg=1` / `2` | debug (tools only, use `notaa=1`): interleaved columns of albedo x 4, sun factor, N.L / h_rel, d_rel, crown-network T_sun |

## Distant forest in the surface shader (wired in)

The painted forest beyond the 3-D trees uses the learned canopy reflectance, so the hand-over from impostors to paint
keeps the forest's brightness and angular behaviour (hotspot down-sun, dark toward the sun, cover / species).
The LUT uniforms (`tVegCanopyLUT`, `uVegCanopyAlb`, `tVegCrownLUT`, `uVegNeural`) are merged into the terrain's shared
`uniforms` by `createTrees()` and re-baked as the sun moves. The hooks (neural ground only; `ground=classic` and
`terrTrees=0` keep the Lambertian forest):

1. `material.js`: when `uniforms.tVegCanopyLUT` exists, the fragment shader gets `#define VEG_CANOPY` +
   `VEG_NEURAL_GLSL` + `VEG_CANOPY_GLSL` between the cover and surface chunks (program cache key includes the flag),
   and `aomap_fragment` multiplies `directDiffuse` by `tSurf.canopyK`.
2. `surface.glsl.js`: `TerrSurf.canopyK`; after the forest colour base:
   `fcol *= vegK.albedo / mix(vec3(0.036, 0.066, 0.022), vec3(0.024, 0.045, 0.021), conifer)` (the painted base
   colours; change the divisor if they change), `S.canopyK = mix(1, vegK.directK, paint * (1 - snow))`, and the forest
   floor under 3-D trees is `t3d x tree-cell occupancy` (so sparse stand edges show their meadow, not bare floor).

Cost: 2 trilinear fetches of a 16 x 16 x 24 RGBA16F 3-D texture + a few ALU per forest pixel.

## Contract with the ground agent

Placement calls `terrCover()` from `COVER_GLSL` and uses `forest`, `conifer`, `treeline`, `tropic`, `crop`, `pad`.
It also reads `terrHash2`, `terrUV`, `terrTexD`, `terrDecodeN`, `ss`, `terrShadow`, `TILE_CONSTS_GLSL`, `TERR_TILE0..4`
and the uniforms `tTerrNoise`, `uTerrTile`, `uTerrRw(L)`. Cover is evaluated on clipmap level max(4, finest valid)
so it never depends on the camera (stable trees). The surface shader's `uTerrTree` (x = on, y = full radius,
z = end radius) is set to the impostor fade band.

## Trees, second generation (trees / hedges / woods / bushes)

What changed (all switchable, see URL parameters below):

- **Skeletons** (`tree-skeleton.js`, `treegen.js`): broadleaf trees, pines and bushes grow a space-colonisation
  skeleton inside the species envelope (attraction points denser toward the surface, a few empty pockets), pipe-model
  limb radii, limbs emitted thickest first up to a bark budget, leaf-cluster cards at the twig tips with a minimum
  spacing (no stacked cards). Spruce / fir: whorls of rising-then-drooping boughs clad in overlapping shoot-spray
  cards, missing boughs, dead stubs on the bole. 2560 vertices (853 triangles) per species (was 1152 / 384).
- **Atlas** (`foliage.js`): new spray tiles 0, 1, 2, 6, 7 (curving twigs with alternate side twigs, leaves alternate
  along every twig, per-leaf tilt brightness), furrowed bark tile 11, conifer shoot spray tile 12. Grass tiles 9 / 10 are
  byte-identical to before (the old random stream is still consumed).
- **Baked light per tree**: a leaf-area voxel grid of every tree, 32 rays per card / bark quad, visibility stored as
  L1 SH in a 4th vertex texel and in a third impostor atlas (C). Meshes and impostors use the same term, so the
  hand-over keeps the crown's shading. Neighbours: the crown network's stand term at the crown surface (transfer for
  this cover / transfer for an open-grown tree). Bark uses the bake too (trunks inside the crown are in its shade).
- **Leaf tint** (`species.js` `LEAF_TINT`): foliage about 30-40 % darker and less saturated than the path tracer's
  single-leaf reflectance; `canopy.js` applies the same factor to the painted canopy (uniform `uVegLeafTint`).
- **Per-tree colour variety** (`common.js` `vegTreeColour`): about 2:1 brightness, yellower / bluer / greyish individuals.
- **Understory and stand-edge mantle** (`common.js` `vegUnder`, a second near mesh and impostor layer): bushes and
  saplings between the trees, denser and bigger at stand edges; casts no shadow-map shadow.
- **Ground shadows and contact darkening** (`forest-shadow.js`): one instanced draw of 8-triangle ground grids per
  placement cell, multiplied into the scene (crown shadow projected along the sun, soft contact disc); the cast part
  fades where the engine's shadow map covers the ground.
- **Crown relief in the painted canopy** (`canopy.js` `vegCrownRelief`): the painted forest beyond the 3-D trees shows
  the crowns of the SAME tree cells (same hashes as placement.js), as domes with sun-facing sides, darker edges and
  shaded gaps, normalised to keep the network's stand reflectance; fades out once a pixel is wider than ~3 m.

| param | effect |
|---|---|
| `vegGen=classic` | previous generation: envelope-scattered cards, first atlas, crown-network lighting, no tint / understory / ground shadows / relief |
| `vegLight=crown` | new trees, but lit by the crown network instead of the bake |
| `vegTint=0` | no leaf darkening |
| `vegUnder=0` | no understory layers |
| `vegShadow=0` | no ground-shadow decals |
| `vegRelief=0` | no crown relief in the painted canopy |

Budgets (high, 100 % forest): near 729 instances x 853 triangles x 2 layers + 1 shadow pass, far 2 x 147 k quads,
ground shadows 147 k x 8 triangles (degenerate when empty). Draw calls +3 (understory near, understory far, ground
shadows). Texture memory +16 MB (impostor atlas C) +1 MB (vertex texture): 55 MB on high (was 38).

### Requests to the ground agent (surface.glsl.js)

1. With `VEG_CANOPY` defined, drop the painted crown modulation inside `if (forest > 0.004)` (`fcol *= mix(1.0, (0.62 +
   0.76 * cn.a) * ...)` and `canopyAO = mix(1.0, 0.30 + 0.92 * crown, fine)`): `vegCanopy()` now draws crowns aligned
   with the 3-D trees and the two patterns multiply.
2. The forest-floor darkening under 3-D trees (`ao *= mix(1.0, 0.5, floorAmt)`) can be reduced to ~0.7 now that every
   tree draws its own contact shadow (`forest-shadow.js`).
