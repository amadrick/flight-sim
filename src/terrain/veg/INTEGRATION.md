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
