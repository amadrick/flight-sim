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
