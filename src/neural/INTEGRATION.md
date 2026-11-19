# src/neural — integration notes

Neural multiple scattering for the volumetric clouds. Nothing here touches integrator-owned files; wiring it in is
three lines in whoever creates the clouds (the clouds module itself, or `src/main.js`).

## Wiring

```js
import { createNeuralCloudScatter } from './neural/cloud-scatter.js';

const scatter = createNeuralCloudScatter();          // ~5-10 ms at boot (bakes the network into a 32^3 LUT)
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
});
```

The phase function is a Mie fit with a real diffraction peak: ~587 sr^-1 within about one degree of the sun
(a thin cloud in front of the sun is physically blinding). If that aureole overwhelms bloom / auto-exposure, pass
`phaseMax: 20` (or so) — it only clips the single-scattering peak.

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

## Verification entry points

- `node --test src/neural/cloud-scatter.test.js` — JS forward pass == Python (stored vectors), LUT limits, build time.
- `node tools/shot.mjs --entry src/neural/harness.js --html dist/neural.html --out shots/neural.png --frames 1 --eval "sim.results"`
  compiles the GLSL in WebGL2 and compares GPU output with the CPU twin (agreement ~2 ppm).
- Method, validation and the comparison table: `src/neural/REPORT.md`. Reproduce training: `tools/neural/README` section there.

## Request to the integrator

None required. Optional: `package.json`'s `"test": "node --test tests/ src/"` does not find tests under Node 22
(directories are not expanded); `node --test "src/**/*.test.js"` does.
