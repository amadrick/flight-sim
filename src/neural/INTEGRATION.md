# src/neural — integration notes

Neural multiple scattering for the volumetric clouds. Nothing here touches integrator-owned files; wiring it in is
three lines in whoever creates the clouds (the clouds module itself, or `src/main.js`).

## Wiring

```js
import { createNeuralCloudScatter } from './neural/cloud-scatter.js';

const scatter = createNeuralCloudScatter();          // ~6 ms at boot (bakes the network into a 32^3 LUT)
clouds.setScatterModel({ glsl: scatter.glsl, uniforms: scatter.uniforms });
```

`scatter.glsl` declares `uniform highp sampler3D tCloudScatterLUT;` and defines

```glsl
float cloudSunScatter(float tauSun, float tauUp, float cosTheta);       // J, sr^-1 per unit sun irradiance
float cloudSunScatterMulti(float tauSun, float tauUp, float cosTheta);  // multiple-scattering part only
float cloudScatterPhase(float cosTheta);                                 // the cloud phase function (sr^-1)
float cloudScatterHG(float cosTheta, float g);                           // helper
```

`scatter.uniforms` is `{ tCloudScatterLUT: { value: THREE.Data3DTexture } }` (R16F, 32x32x32, linear filtering,
clamp to edge — core WebGL2, no extensions needed). Spread it into the cloud material's uniforms.
The cloud shader accumulates, per ray-march sample,

```glsl
radiance += sunIrradiance * cloudSunScatter(tauSun, tauUp, cosTheta) * sigma_s * stepLength * viewTransmittance;
```

- `tauSun` — optical depth (integral of extinction, dimensionless) from the sample toward the sun.
- `tauUp` — optical depth from the sample straight up to the cloud top.
- `cosTheta = dot(sunTravelDir, towardViewerDir) = dot(-uSunDir, -rayDir) = dot(uSunDir, rayDir)` where `rayDir`
  is the camera ray direction: **+1 when the camera looks straight at the sun through the cloud**.
- `sunIrradiance` — `atmSunIlluminance(pos)` / `uSunColor` (irradiance on a plane facing the sun, at the cloud).
- J already contains the phase function and the Beer-Lambert sun attenuation: do **not** multiply by a phase
  function or `exp(-tauSun)` again, and do not add a powder / octave term. Sky ambient and ground bounce are
  not included (the renderer adds those).
- Extinction scale matters now: the model was trained on real optical depths (extinction 0.004-0.12 1/m). If the
  ray-marcher uses an artistically reduced density, pass optical depths computed with the *physical* extinction.

Cost in the shader: one `texture()` fetch of a 64 kB 3-D texture, two `log`, one `sqrt`, two `exp`, plus the
analytic phase function (two `sqrt`).

## Options

```js
createNeuralCloudScatter({
  lutSize: 32,          // LUT resolution per axis (bake time scales with n^2 for the network, n^3 for the contraction)
  phaseMax: Infinity,   // clamp (sr^-1) of the single-scattering forward peak; see below
  functionName: 'cloudSunScatter',
  prior: 'dataset',     // 'dataset' (default) | 'thick' | number in [0,1]; see "Accuracy and limits"
});
```

The phase function is a Mie fit with a real diffraction peak: ~587 sr^-1 within about one degree of the sun
(a thin cloud in front of the sun is physically blinding). If that aureole overwhelms bloom / auto-exposure, pass
`phaseMax: 20` (or so) — it only clips the single-scattering peak.

## Optional: 4-feature model (recommended if the renderer has tauDown)

```js
import { createNeuralCloudScatter, createNeuralCloudScatter4 } from './neural/cloud-scatter.js';
const s3 = createNeuralCloudScatter(), s4 = createNeuralCloudScatter4();     // 6 ms + 18 ms
clouds.setScatterModel({ glsl: s3.glsl + s4.glsl, uniforms: { ...s3.uniforms, ...s4.uniforms } });
```

`s4.glsl` declares `uniform highp sampler3D tCloudScatterBody4_0; uniform highp sampler2D tCloudScatterAng4_0;`
and defines

```glsl
float cloudSunScatter4(float tauSun, float tauUp, float cosTheta, float tauDown);   // J, sr^-1, same meaning
```

`tauDown` = optical depth from the sample straight down to the cloud base. It lets the model tell a thin veil from
the top of a thick cloud, which removes most of the remaining error (test RMSE 0.274 -> 0.192, see below). Two
texture fetches (RGBA16F 24x24x12 3-D + RGBA16F 32x48 2-D) and a dot product. The shared phase-function helpers are
guarded by `#ifndef CLOUD_SCATTER_PHASE`, so both chunks can go into one shader. `s4.sample(tauSun, tauUp,
cosTheta, tauDown)` is the CPU twin. Using it needs a one-line change in the cloud march (call `cloudSunScatter4`
with the `tauDn` the march already computes for its ambient term); the 3-argument contract stays available.

## Optional: sky-light visibility

```js
import { createAnalyticCloudSkyVisibility, createNeuralCloudSkyVisibility } from './neural/cloud-sky.js';
const sky = createAnalyticCloudSkyVisibility();      // { glsl, uniforms: {} }  - closed form, no texture
// or createNeuralCloudSkyVisibility()               // { glsl, uniforms: { tCloudSkyVisLUT }, texture, sample, ... }
```

Both define `float cloudSkyVisibility(float tauUp, float tauDown)`: the fraction (0..1) of a uniform sky dome's
light that reaches the sample through the cloud, all scattering orders; multiply the sky-dome irradiance term by
it. By symmetry `cloudSkyVisibility(tauDown, tauUp)` is the same thing for light entering through the base (ground
bounce). The analytic version is the two-stream slab solution
`(tauDown (1-g) + 0.71) / ((tauUp + tauDown)(1-g) + 1.42)`, g = 0.864; against the path tracer it has RMSE 0.045
where `exp(-tauUp)` has 0.34, and the 337-parameter network only improves it to 0.041 — prefer the analytic one.

## Fallback / A-B

```js
import { createAnalyticCloudScatter, analyticScatterGLSL } from './neural/cloud-scatter.js';
clouds.setScatterModel(createAnalyticCloudScatter());   // { glsl, uniforms: {} } — no texture
```

Same signature, same phase function; multiple scattering by the Wrenninge/Frostbite octave sum with parameters
fitted to the same path-traced data. For a side-by-side in one shader:
`neural.glsl + analyticScatterGLSL(undefined, { functionName: 'cloudSunScatterAnalytic' })`.

`scatter.sample(tauSun, tauUp, cosTheta)` is the CPU twin of the GLSL (same LUT, trilinear) — e.g. for lighting
aircraft inside cloud or for tests. `scatter.info` has parameter count, bake time and training metadata.
`scatter.dispose()` frees the texture.

## Accuracy and limits (what to expect)

Held-out test: 100,000 samples in 50 clouds the network never saw, path-traced reference (192 paths per sample,
errors noise-debiased). "display-rel." = error relative to J + 0.05 sr^-1. Full tables, per-subset breakdowns and
the oracle / ablation rows: `tools/neural/results/eval.md`; solver validation: `tools/neural/results/validation.json`.

| model (same three inputs unless noted) | display-rel. RMSE | rel. RMSE | ln-RMSE (low-noise) | within x2 (low-noise / all) |
|---|---|---|---|---|
| single scattering only | 0.558 | 0.946 | 2.76 | 40 % / 12 % |
| Beer-powder | 0.545 | 0.939 | 2.52 | 45 % / 14 % |
| octaves, stock a=b=c=0.5 (Wrenninge / Frostbite) | 0.486 | 1.060 | 1.19 | 52 % / 34 % |
| octaves fitted to our data (= `createAnalyticCloudScatter`) | 0.381 | 0.915 | 0.77 | 66 % / 59 % |
| **neural, as deployed (default)** | **0.274** | **0.795** | **0.46** | **94 % / 74 %** |
| neural, `prior: 'thick'` | 0.497 | 1.754 | 0.56 | 93 % / 68 % |
| 9k-parameter oracle network, same three inputs | 0.271 | 0.763 | 0.46 | 94 % / 74 % |
| neural 4-feature (+tauDown), as deployed | 0.192 | 0.433 | 0.37 | 98 % / 86 % |

- The default network sits at the information limit of (tauSun, tauUp, cosTheta): a three times larger network on
  the same inputs is not better. The remaining error is real cloud-to-cloud variation the inputs do not encode.
- The dominant hidden variable is the optical thickness of the column, tauUp + tauDown: just below a sun-lit top a
  thin veil and a thick cumulus have identical inputs but differ several-fold in brightness. The default network
  answers with the average over its training population (median column thickness ~5), so it renders veils and
  cloud edges 1.4-1.8x too bright and the sun-lit side of thick clouds (column thickness > 16) about 40 % too
  dark; an infinite thick layer seen from above saturates at a reflectance of ~0.21 where the truth is 0.57-0.93
  (`tools/neural/results/slab_render.md`). Transmitted light (bases, the view from below) is within 4-26 %.
- `prior: 'thick'` is a second set of weights trained on a population re-weighted toward thick columns: nearly
  unbiased for column thickness > 16 (thick-layer reflectance 0.40) but 2.5-3.4x too bright on thin columns, and
  worse than fitted octaves on the overall test metrics. A number (e.g. `prior: 0.5`) blends ln J of the two
  networks at bake time. It is a dial for scenes dominated by thick overcast, not a free improvement.
- The real fix is the 4-feature model: brightness bias 0.85-1.22 across all column thicknesses.
- Trained for: liquid droplets (10 um), albedo 0.9999, white light (scale by the sun colour), single layer, no
  ground bounce, no sun-elevation input. Optical depths must be physical (extinction in 1/m times metres).

## Verification entry points

- `node --test src/neural/cloud-scatter.test.js src/neural/cloud-sky.test.js` — 13 tests: JS forward pass == Python
  (stored vectors, max difference 3e-15 in ln J), LUT limits / finiteness / fidelity, prior option, build time.
- `node tools/shot.mjs --entry src/neural/harness.js --html dist/neural.html --out shots/neural.png --frames 1 --eval "sim.results"`
  compiles all GLSL (3-feature, analytic, 4-feature, sky) in WebGL2 and compares GPU output with the CPU twins
  (agreement ~2 ppm, no console errors).
- Reproduce data / training / tables: the command list at the top of each script in `tools/neural/`
  (`validate.py`, `gen_dataset.py`, `train.py`, `evaluate.py`, `render_slab.py`, `export.py`, `gen_sky.py`,
  `train_sky.py`), run from `tools/neural` with `.venv` (numpy, numba, torch) and `OMP_NUM_THREADS=2
  NUMBA_NUM_THREADS=2`. Result tables are kept in `tools/neural/results/`.

## Request to the integrator

None required for the default model. Optional:
- 4-feature model: in the cloud march, call `cloudSunScatter4(tauSun, tauUp, cosT, tauDn)` (move the `tauDn` line
  above the `J` line) when the scatter model provides it.
- `package.json`'s `"test": "node --test tests/ src/"` does not find tests under Node 22 (directories are not
  expanded); `node --test "src/**/*.test.js"` or plain `node --test` does.

---

# Neural lens flare (`flare.js`)

Already wired: `src/render/post.js` builds it in `createPostPasses` (`post.flare`), the tone-map pass calls
`lens()` which dispatches to `flareNeural()` (default) or the old analytic `lensClassic()`; `src/render/index.js`
calls `post.flare.update(sunFrameX, sunFrameY, tan(fov/2), ghostGain)` once per frame next to `uLensSun`.
URL switch: `flare=classic` (old hand-tuned flare), `flare=off` (none; `noflare=1` still works).

## What is simulated, what is learned, what is set by hand

Reference (tools/neural/flare, numpy): the 50 mm f/2 double-Gauss of Tronnier (US 2,673,491; Smith, *Modern Lens
Design* p. 312, the pbrt `dgauss.50mm` table), stopped to f/4, Cauchy dispersion per glass, single-layer MgF2
quarter-wave coatings (thin-film reflectance, s+p averaged) on the 8 air-glass surfaces, uncoated cemented
surfaces, element rims as apertures, 6 straight iris blades.
- Ghosts: all 45 two-reflection paths traced (sequential exact ray tracing, 8 wavelength bands, ~40k rays per band
  per sun position); the 12 most visible kept (flux per area). Per ghost and sun radius: centre, scale, flux,
  RGB image on a 32x16 grid in ghost coordinates, blurred by the sun's disc.
- Starburst + veil: FFT (4096^2) of the hexagonal iris with 73 dust specks (0.2 % of the area) and 3 hairline
  scratches, 31 wavelengths 400-700 nm (pattern scaled with lambda), convolved with the limb-darkened sun disc;
  beyond 0.139 frame units (FFT trust radius at 400 nm) power-law extrapolation (slope clamped to <= -2, checked
  against the exact polygon transform); plus Harvey-Shack micro-roughness scatter (2 nm rms) of all 10 surfaces.

Learned (three MLPs, ISRU, 27.4k parameters total, weights in `flare-weights.js`):
- `meta`: r -> per ghost (centre, |scale| along/across, scale signs, log flux) — 3.5k params.
- `ghost` x12: (r, q_al, q_ac) -> RGB ghost image (sqrt-normalised) — 1.5k params each.
- `star`: (r, angle from the nearest spike) -> log10 RGB density of starburst + veil — 2.8k params.

Baked directly (not learned): the iris polygon outline is applied analytically to the ghosts (the networks see the
circular-iris images; ghost flux is rescaled by circle/hexagon area 1.209), the sun colour/brightness
(`uLensColor`, real HDR irradiance) and visibility (`uLensSun.z`, the existing occlusion probe), the conversion to
radiance `L = E * density / tan^2(fov/2)`, and two taste gains `FLARE_GAINS = { ghost: 5, star: 0.5 }` relative
to the simulated lens (ghost gain x0.35 more in interior cameras).

## Cost

Boot: ~0.3-0.5 s of JS to bake (ghost texture 32x16x204 RGBA16F = 0.8 MB, starburst 128x32 RGBA16F) — the
dominant item is 104k ghost-network evaluations. Per pixel in the existing tone-map pass: one 2-D fetch
(starburst) + for each of the 12 ghosts a bounds test and, inside its footprint only, one `atan` and one 3-D fetch.
No extra passes. Per frame CPU: 12 LUT interpolations.

## Verification

`node --test src/neural/flare.test.js` (JS == Python on exported vectors to 1e-14; bake finite/fast; physics
sanity). Reproduce: `tools/neural/flare/{ghosts.py survey|data|merge, diffraction.py, train.py meta|ghost|star,
export.py, validate.py}`; numbers in `tools/neural/flare/results/`.
