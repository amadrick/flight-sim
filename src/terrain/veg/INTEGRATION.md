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
| high | 416 (1.3 km) | 90 m | 128^2 | 757 k (~580 k) | 3 + shadow + 2 offscreen |
| ultra | 512 (1.6 km) | 130 m | 160^2 | 1.4 M | 3 + shadow + 2 offscreen |

*Instances of empty cells and cells outside the layer's ring collapse to degenerate triangles in the vertex shader;
"max rasterised" assumes 100 % forest cover. Vegetation is off above ~1.6 km clearance (0 triangles).
Texture memory: impostor atlases 2 x 2016 x 1512 RGBA8 with mips (32.5 MB; 2 x 1536^2 x 4/3 at frame 64 on low),
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

## Distant forest in the surface shader (needs the integrator)

The painted forest beyond the 3-D trees should use the learned canopy reflectance so the hand-over from impostors
to paint keeps the forest's angular behaviour (hotspot down-sun, dark toward the sun, cover / species dependence).
Everything it needs is exported and its uniforms are ALREADY merged into the terrain's shared `uniforms` object by
`createTrees()` (`tVegCanopyLUT`, `uVegCanopyAlb`, `tVegCrownLUT`, `uVegNeural`) and re-baked as the sun moves.

1. `material.js` — include the chunks before `SURFACE_GLSL` in the fragment shader:
   ```js
   import { VEG_NEURAL_GLSL } from '../neural/veg.js';
   import { VEG_CANOPY_GLSL } from './veg/canopy.js';
   ...
   ${COVER_GLSL}
   ${VEG_NEURAL_GLSL}
   ${VEG_CANOPY_GLSL}
   ${SURFACE_GLSL}
   ```
2. `surface.glsl.js` — add `vec3 canopyK;` to `struct TerrSurf`; after the forest colour `fcol` is built (after the
   crown modulation line, before the `t3d` floor mix):
   ```glsl
   VegCanopy vegK = vegCanopy(rp, clamp(forest * 1.1 - 0.05, 0.0, 1.0), conifer);
   fcol *= vegK.albedo / mix(vec3(0.044, 0.078, 0.027), vec3(0.027, 0.049, 0.023), conifer);   // keep the painted variation, take the stand's albedo
   ```
   and when filling the struct: `S.canopyK = mix(vec3(1.0), vegK.directK, forest * (1.0 - t3d));`
   (`clamp(forest * 1.1 - 0.05)` is exactly the tree-cell occupancy the placement uses, i.e. the network's `cover`.)
3. `material.js` `aomap_fragment`: `reflectedLight.directDiffuse *= tSurf.shadow * tSurf.canopyK;`

Cost: 2 trilinear fetches of a 16 x 16 x 24 RGBA16F 3-D texture + a few ALU per forest pixel. I verified the patch in a
scratch copy (screenshot `shots/v5_khvn_500_canopy.png` vs `shots/v3_khvn_500.png`). If the ground agent changes
the forest colour constants, change the divisor in step 2 to the new base colour.

## Contract with the ground agent

Placement calls `terrCover()` from `COVER_GLSL` and uses `forest`, `conifer`, `treeline`, `tropic`, `crop`, `pad`.
It also reads `terrHash2`, `terrUV`, `terrTexD`, `terrDecodeN`, `ss`, `terrShadow`, `TILE_CONSTS_GLSL`, `TERR_TILE0..4`
and the uniforms `tTerrNoise`, `uTerrTile`, `uTerrRw(L)`. Cover is evaluated on clipmap level max(4, finest valid)
so it never depends on the camera (stable trees). The surface shader's `uTerrTree` (x = on, y = full radius,
z = end radius) is set to the impostor fade band.
