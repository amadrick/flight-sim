# Clouds: learned light transport (round four + round two of the neural work), integration guide

Owner: neural-lighting engineer (`src/neural/cloud-ms*.js`, `src/neural/cloud-mie-weights.js`, `tools/neural/clouds/`).
Status: wired into `src/clouds/shaders.js` by the cloud-shape engineer (default light model; `clMs=0` falls back).

**Round seven (weights `cloud-ms-weights-r7.js`, `CLOUD_MS_MODEL_R7`, default; `?clMs7=0` = the round-two weights):**

* Data: `gen.py --round 3` path-traces five exported fields of the round-six-c game (`r7fair`, `r7scat`, `r7near`,
  `r7broken` train; `r7scat2` **held out**), exported with `noBub0` so the taps are exactly the shader's (`clMsSigma`
  skips the bubble octave). 188 configurations, 282 k points. Same descriptor, same 14-16-16-3 network.
* Held-out S (combined source, relative RMSE, brightness in brackets; `tools/neural/clouds` evaluation of both exported
  models on the same points):

  | held-out set | round two (v2) | round seven |
  |---|---|---|
  | r7 game field `r7scat2` (6 k points) | 0.270 (1.04) | **0.241** (1.03) |
  | r7 game field, sun < 10 deg | 0.296 (1.06) | **0.276** (1.03) |
  | r7 game field, backlit | 0.176 (1.09) | **0.145** (1.05) |
  | round-one held-out (48 k) | 0.255 (1.02) | 0.257 (1.02) |
  | round-two multi-cloud + r7 (18 k) | 0.235 (1.02) | 0.218 (1.01) |

  An 11 % gain on the game's own clouds (one held-out scene, so read it as "better on game fields, equal elsewhere");
  the seed spread is ~0.01.
* **The bigger error was not the network but where the shader ran it** (SHAPE.md 0d): on the first two dense samples,
  in the skin, whose taps saw almost no cloud. Fed the exported field's taps at the visible depth, both networks reproduce
  the path tracer's top-to-base profile of J_ms; the shader now evaluates at camera optical depth 0.7 / 2.5 (`clMsAt`).
  In-game against the path tracer on a side-lit game cloud: mean 0.54 -> 0.85 of the reference, log-RMSE 0.66 -> 0.29.

**Round two, what changed for the shader (read this first):**

| | before (descriptor v1) | now (descriptor v2) | shader action |
|---|---|---|---|
| function names / signatures | `cloudMsLight(tauSun, tauCam, muSun, cosTheta, tapUp, tapDown, tapFwd)` | **identical** | none |
| what `CLOUD_MS_SIGMA(p)` must return | true (eroded, full) extinction | **0.8 x the cheap base density** in physical units: exactly the light march's un-eroded density, `clDensityBase(p, wx, lod, info) * info.w * uClNoise.w * 0.8` | none: `clMsSigma` in shaders.js already is this |
| tap positions / lengths | 50, 225, 675 m / 100, 250, 650 m | identical | none |
| network | 14-16-16-3, 563 params | same shape, new weights | none |
| version marker | none | `#define CLOUD_MS_DESC_VERSION 2` in `ms.glsl`; `ms.descriptor = {version: 2, tapSource: 'base', tapGain: 0.8, ...}` | optional `#if` check |
| forward peak | `cloudMsForwardPeak(tauSun, phase)` | also `cloudMsForwardPeak(tauSun, phase, cosTheta)`: adds the aureole (2-arg form unchanged) | switch to the 3-arg form |

The lod of the base taps does not matter much: the training emulated the shader's base density from the exported
`base8` field (lod 1); shaders.js taps at `lod + 1.5`. If the base density's definition (`clSat(clShape / 0.06)`) or
the 0.8 gain changes, re-export the game fields and rerun `gen_tap.py --gain <g>` + `train.py final` (section 7).

## 1. What was built

1. **A reference.** `tools/neural/clouds/` holds the following pieces:
   * `mie.py`: our own Lorenz-Mie solver (Bohren-Huffman BHMIE, numba) for liquid water (Hale & Querry refractive index)
     on a modified-gamma droplet population (v_eff 0.1). It averages over the R/G/B bands for r_eff = 5, 6, 8, 10, 12, 16
     and 20 um. At 10 um it gives g = 0.864, Q_ext = 2.09, co-albedo 3.4e-6 / 4.1e-7 / 2.7e-7 (R/G/B), forward peak
     640 sr^-1, fogbow at 141.6 deg (2.8x the side minimum at ~100 deg) and glory 0.052 sr^-1 (25x the side minimum).
   * `pt.py`: a volumetric path tracer. It uses delta tracking with supercell majorants, the **tabulated** Mie phase
     function, next-event estimation to the sun at every vertex, and escape to a uniform sky (upper hemisphere) and a
     uniform ground (lower hemisphere). One walk carries all three colours (one absorption weight per colour), so
     thousands of scattering orders are kept. The Mie forward peak is handled by delta-M truncation (theta_c = 4 deg,
     f = 0.437), mapped back exactly to the full-extinction medium the shader marches (see 2.1).
   * Validation (`validate.py`, `results/validation.json`):
     * Slab albedo and transmittance from the truncated walk agree with forward photon Monte Carlo using the **full,
       untruncated** Mie phase within 0.2-1.7 % for tau 0.5-100 and mu0 = 1, 0.5, 0.17.
     * Energy is conserved exactly.
     * Delta-Eddington agrees within 1 % at high sun and is 10-25 % low at mu0 = 0.17, which is the known weakness of
       two-stream.
     * Radiance leaving slabs at 4 view angles, computed by the point estimator integrated along the view ray, matches
       the forward full-phase photon histograms within 0.1-2.5 %. The exception was the transmitted bin that contains
       the sun direction at tau = 2: 33 % low. Round two fixes this analytically (aureole, section 4).
2. **Data.** `gen.py`, `gen_tap.py`. There are 116 configurations: 29 cloud volumes x 4 sun elevations (3-85 deg), with
   1500 points each, giving 174 k points. Each point gets 384 + 128 adjoint walks.
   * Points are drawn where a camera actually sees them: one per random ray, with pdf ~ T sigma, weighted by the ray's
     opacity.
   * The volumes are the game's own exported fields (near1 at 0.5/1/1.6x, scattered3, broken3, brokenB) and LES
     cumulus with **microphysical extinction** (sigma = 3 LWC / (2 rho_w r_e), r_e from LWC and N = 100-600 cm^-3).
     The rest are synthetic: spheres, stratiform decks 250-1500 m thick, cumulus heaps with sigma rising as z^(2/3),
     cumulonimbus towers with anvils, and thin wisps.
   * 8 whole scenes are **held out** (one of each family). All "val" numbers below are on clouds the network never saw.
   * **Round two** adds 52 configurations (168 in all, 252 k points), aimed at the weak cases:
     * the game's own round-five exports: r5scattered, r5broken, r5near, r5overcast, r5storm (train) and
       r5scattered2 (**held out**), each with its exported base density;
     * cumulus fields of 7-8 clouds in one 6 km box (`scenes.cumulus_field`) so cloud-to-cloud shadowing and bounce are
       in the data: seeds 0 and 1 train, seed 2 (`cufield2`) **held out**;
     * two more LES congestus snapshots (t-6, t-25) and near1 / scattered3 again;
     * sun elevations drawn from 2, 4, 6, 9, 13, 30, 55 deg (low suns over-represented).
     * Every point has taps of the true field (`tap_*`) and of the base density (`tapb_*`, `gen_tap.py`). For scenes
       without an exported base density the base is emulated by a 40 m box blur. Measured base/true tap ratio: 0.76
       (game fields) and 0.78 (emulated), i.e. close to the 0.8 gain.
3. **A model.** `train.py`. Descriptor v2 (taps of the base density) since round two. The descriptor was picked by an ablation over exact and tap-based optical depths in 8
   directions and 5 ranges (`results/ablation_val.txt`). The network is 14 -> 16 -> 16 -> 3 with ISRU activations
   (563 parameters), outputs ln(J_ms, V_sky, V_gnd), and is trained with a noise-unbiased relative loss.
4. **Runtime.** `src/neural/cloud-ms.js` provides the GLSL generator plus a JS twin. Weights are in
   `cloud-ms-weights.js`, Mie tables in `cloud-mie-weights.js`, and tests in `cloud-ms.test.js` with vectors in
   `test-vectors-ms.json`. `cloud-ms-harness.js` is a WebGL2 check: the GPU matches the JS twin to 1 ppm on the
   network, and the phase LUT is within 0.08 % (half float).

## 2. How the shader calls it

```js
import { createCloudMultiScatter } from '../neural/cloud-ms.js';
const ms = createCloudMultiScatter({ reff: 10 });   // ~7 ms; reff (um) only changes the phase function
// material.uniforms: { ...uniforms, ...ms.uniforms }   (tCloudMie: 512x1 RGBA16F, linear, clamp)
// fragment source:   '#define CLOUD_MS_SIGMA(p) (<physical extinction at p, 1/m>)\n' + ms.glsl + marchSource
```

GLSL defined by `ms.glsl` (guarded by `#ifndef CLOUD_MS_GLSL`):

```glsl
vec3  cloudMsLight(float tauSun, float tauCam, float muSun, float cosTheta, vec3 tapUp, vec3 tapDown, vec3 tapFwd);
      // x = J_ms (sr^-1 per unit sun irradiance), y = V_sky, z = V_gnd (per unit hemisphere radiance)
float cloudMsForwardPeak(float tauSun, float phase);    // add to the single scattering (v1 form, still there)
float cloudMsForwardPeak(float tauSun, float phase, float cosTheta);  // the same + aureole within ~5 deg (use this)
vec3  cloudPhaseMie(float cosTheta);                      // tabulated Mie phase, RGB, sr^-1, integral 1
vec3  cloudMsTapSegments(vec3 p, vec3 dir);               // only when CLOUD_MS_SIGMA(p) is #defined
const float CLOUD_MS_F, CLOUD_MS_PC;                      // truncated peak fraction (0.437), phase at 4 deg (2.03)
const float CLOUD_MS_AURV;                                // aureole angular variance per peak scattering (rad^2)
#define CLOUD_MS_DESC_VERSION 2                           // taps of the base density (see the table at the top)
```

### 2.1 Energy bookkeeping: what to keep, what it replaces (no double counting)

Per lit sample, march with the **full** extinction `sigma` exactly as now (`w = T (1 - exp(-sigma ds))`), and use this
source:

```glsl
vec3  p    = cloudPhaseMie(cosT);                         // or the shader's own fit, per channel or grey
vec3  ms3  = cloudMsLight(tauSun, tauCam, muSun, cosT, tapUp, tapDown, tapFwd);
vec3  Jsun = min(p, vec3(pMax)) * exp(-tauSun)            // single scattering (exact; keep your pMax clamp if any)
           + vec3(cloudMsForwardPeak(tauSun, p.g, cosT))  // light carried along the beam by the diffraction peak
           + ms3.x;                                       // all other orders of sunlight
vec3  S    = E * Jsun + ambUp * ms3.y + ambDn * ms3.z;
L += w * S;
```

This **replaces**:
* the multiple-scattering part of `cloudSunScatter`, i.e. the octaves, the diffusion term and the powder term (or
  `cloudSunScatterMulti`);
* `cloudAmbientVis` and the visUp/visDn fallback;
* the round-four calibration `J *= 1 + uClDet5.y (...)` and the `V *= (0.84, 1.17)` factor. These were patches for the
  round-three nets' height-proxy inputs and are not needed with true optical depths.

Keep the single scattering, since it is the only term with the sharp forward lobe, the fogbow and the glory. Use the
sharp lobe **only** there: higher orders are inside `ms.x`. The near-field lobe shading `lam` and the crease occlusion
`occ` are artistic sub-100 m detail that the taps cannot see (the first segment is 100 m). They are not double counted
in principle, but start them at half strength and judge by eye.

`ambUp` / `ambDn` must be the **mean radiance** of the upper / lower hemisphere: a plain average over solid angle, not
irradiance/pi. Training used uniform hemispheres. The existing horizon-band blend (`uClDet3.w`) is a reasonable proxy,
because sky light enters a cloud mostly through its sides.

### 2.2 The descriptor: definitions and units

All optical depths are **physical**: extinction in 1/m times metres. Do not use the height proxy
`sigma1 (0.3 + 0.2 d)(top - h)`, which runs about 5x the true optical depth (RESEARCH.md finding 7). The new model
never sees it.

| input | definition | cost |
|---|---|---|
| `tauSun` | optical depth from the sample toward the sun: the existing light march + shadow-map tail, at physical sigma | 0 extra |
| `tauCam` | optical depth from the camera to the sample along the view ray: `-log(T)` of the march at the sample (the model clamps it at 60) | 0 |
| `muSun` | `uClLightDir.y` (sine of the sun elevation) | 0 |
| `cosTheta` | `dot(uClLightDir, rayDir)`: +1 looking into the sun (the existing `cosT`) | 0 |
| `tapUp` | `cloudMsTapSegments(p, vec3(0,1,0))` | 3 taps |
| `tapDown` | `cloudMsTapSegments(p, vec3(0,-1,0))` | 3 taps |
| `tapFwd` | `cloudMsTapSegments(p, rayDir)`: along the view ray **beyond** the sample, away from the camera | 3 taps |

A tap segment is `sigma(p + dir * m_k) * len_k` for the segments [0, 100], [100, 350] and [350, 1000] m, i.e. taps at
50, 225 and 675 m with lengths 100, 250 and 650 m. The helper writes exactly that from `CLOUD_MS_SIGMA(p)`. Define the
macro as the physical extinction of the **cheap base density** in the same space as the light march:
`(clDensityBase(p, wx, lod, info) * info.w * uClNoise.w * 0.8)`, with the weather fetch of the sample reused (this is
`clMsSigma` in shaders.js today).

**Descriptor versions.**
* **v1** (round four, first delivery): trained on taps of the TRUE field (eroded density, trilinear at 10-60 m).
* **v2** (now): trained on taps of `0.8 x base density` (the exported `base8` of the game fields x info.w x sigma, or a
  40 m blur of the field where no base exists). Only the meaning of `CLOUD_MS_SIGMA` changed; inputs, their encoding,
  order, tap positions, outputs and the GLSL signature are unchanged. A v2 shader runs v1 weights and vice versa without
  a compile error, so check `CLOUD_MS_DESC_VERSION` / `ms.descriptor.version` if you keep both.
* The gap v2 closes turned out to be small (section 3): v1 fed base taps loses mainly brightness (J bias 0.91-0.95 on
  the multi-cloud scenes, 0.86 on the round-five game field), not shape.

### 2.3 Cost per lit sample

* **Density taps:** 9 (cheap base density).
* **Network ALU:** 36 mat4 x vec4 = 576 FMA, 32 `inversesqrt`, 9 `log` for the taps, 3 `log` + 1 `sqrt` for the scalar
  inputs, and 3 `exp`. All weights are compile-time constants, with no uniforms or texture fetches.
* **Phase:** `cloudPhaseMie` is 1 `acos` + 1 `tan` + 1 texture fetch.

If the 9 taps are too expensive, three alternatives exist, all measured on the same held-out set
(`results/ablation_val.txt`; error = combined-source relative RMSE, the S column):
* evaluate the network only on the first ~6 lit samples of a ray (the visible skin) and reuse the last `ms3` deeper in;
* use 2 taps per direction (6 total): S 0.268 instead of 0.265, essentially the same;
* pass the three sums instead of the 9 segments (8 inputs): S 0.260, also within noise of the default.
A LUT is not an option at this dimensionality: a 3-input LUT (the round-three approach) scores S 0.41 even with exact
inputs.

Round-two ablation of spending more (`results/ablation_r2.txt`, `results/compare_r2.txt`; S on round-one held-out /
new multi-cloud held-out, base taps, 2 seeds):

| variant | extra cost | S held-out r1 | S multi-cloud | sun < 10 deg |
|---|---|---|---|---|
| up, down, fwd, 16 wide (shipped v2) | - | 0.258 | 0.215 | 0.321 |
| same, 24 wide | 1.8x network ALU | 0.250 | 0.217 | 0.314 |
| + sun-direction taps (12 taps), 16 wide | +3 taps | 0.252 | 0.209 | 0.320 |
| + sun-direction taps, 24 wide | +3 taps, 2x ALU | 0.250 | 0.207 | 0.318 |
| oracle: 45 exact depths, 32 wide | out of budget | 0.212 | 0.174 | 0.284 |

A sun tap or a wider net buys 2-4 % relative, close to the seed spread (up to 0.01), and nothing at low sun. **It does
not pay for itself**; v2 keeps 9 taps and 16 wide. (`tauSun` already carries the sun direction's information.)

## 3. Accuracy: path tracer vs models, held-out clouds

Metric definitions:
* **J**, **V_sky**, **V_gnd**: image-weighted relative RMSE (denominator true + 0.05), with the reference's Monte Carlo
  variance removed. The value in parentheses is the brightness bias (sum of predicted / sum of true).
* **S**: the combined source `E J + 0.06 V_sky + 0.025 V_gnd` (noon-like weights), relative RMSE.
* **within x1.25**: share of points with S within 25 % of the reference, image-weighted, noise **not** removed. It is
  capped by the reference noise (~0.15 relative), so read it comparatively.
* "shipped" = round-three networks fed exactly what the march computes (exact tauSun, height-proxy tauUp/tauDown) plus
  the clCal calibration. "raw" = the same nets without calibration. "tuned analytic" = octaves x powder + two-stream with
  **true** optical depths, all 8 parameters fitted to the training set.

| held-out (48 k points, 8 scenes) | J | V_sky | V_gnd | S | within x1.25 |
|---|---|---|---|---|---|
| classic analytic | 0.86 (1.56) | 0.71 (0.45) | 0.71 (0.44) | 0.73 (1.16) | 0.27 |
| tuned analytic, true taus | 0.38 (0.98) | 0.93 (1.24) | 0.89 (1.28) | 0.40 (1.08) | 0.47 |
| shipped, calibrated | 0.42 (0.91) | 0.47 (0.81) | 0.95 (1.17) | 0.37 (0.91) | 0.42 |
| shipped, raw nets | 0.37 (0.77) | 0.54 (0.96) | 0.79 (1.00) | 0.33 (0.84) | 0.40 |
| **new (9 taps)** | **0.29 (1.02)** | **0.40 (1.01)** | **0.41 (1.00)** | **0.26 (1.02)** | **0.64** |
| oracle: 45 exact multi-scale depths, 32 wide | 0.23 | 0.35 | 0.34 | 0.21 | 0.74 |

Combined-source S by regime (held out), new vs shipped (calibrated / raw):

| regime | new | shipped cal. | shipped raw | tuned analytic |
|---|---|---|---|---|
| game fields (near1 x1.6, broken3 x2.5) | 0.29 | 0.31 | 0.29 | 0.38 |
| cumulus heap | 0.21 | 0.28 | 0.23 | 0.30 |
| LES congestus (microphysics) | 0.40 | 0.52 | 0.42 | 0.56 |
| storm tower | 0.24 | 0.30 | 0.30 | 0.38 |
| thin deck | 0.14 | 0.29 | 0.25 | 0.31 |
| thin wisp | 0.17 | 0.61 | 0.57 | 0.47 |
| sun 0-10 deg | 0.39 | 0.48 | 0.38 | 0.56 |
| sun 10-30 deg | 0.22 | 0.34 | 0.29 | 0.38 |
| sun 30-90 deg | 0.24 | 0.36 | 0.36 | 0.33 |
| backlit (cos > 0.7) | 0.26 | 0.34 | 0.30 | 0.34 |
| front-lit (cos < -0.3) | 0.27 | 0.39 | 0.37 | 0.38 |

Takeaways:
* **The new model is unbiased in every regime** (brightness 0.96-1.08 vs 0.57-1.52 for shipped).
* It is clearly better on thin clouds, storms, ambient light and mid/high sun.
* **On the game's own cumulus fields and at sun < 10 deg it is no better than the raw round-three nets** (0.29 vs 0.29;
  0.39 vs 0.38). Its gain there is the ambient terms (V_gnd 0.35 vs 0.43-0.52) and the removed brightness bias (1.00 vs
  0.75-0.81), not the sun term.
* A tuned analytic model with true optical depths is worse than both networks overall. Its sun term matches the raw
  nets (J 0.38 vs 0.37), but its ambient terms are far worse. A network is warranted.

### 3.1 Round two: before / after on identical points

"v1 in game" is the round-four network fed the base-density taps the shader actually gives it; "v1 as evaluated" is
the same network fed true-field taps (the round-four tables above). v2 is the exported round-two network
(`results/compare_final.txt`). S relative RMSE (brightness in parentheses).

| held-out set | v1 as evaluated | **v1 in game** | **v2 (now)** | shipped raw nets | tuned analytic |
|---|---|---|---|---|---|
| round-one held-out, 8 scenes (48 k points) | 0.262 (1.02) | 0.255 (0.98) | 0.255 (1.02) | 0.334 (0.84) | 0.400 (1.08) |
| **new** multi-cloud held-out (r5scattered2 + cufield2, 12 k) | 0.205 (0.98) | 0.210 (0.94) | 0.215 (1.01) | 0.258 (0.79) | 0.341 (1.10) |
| game fields near1 x1.6, broken3 x2.5 | 0.292 (1.00) | 0.289 (0.95) | **0.272** (0.99) | 0.292 (0.75) | 0.372 (1.08) |
| game field r5scattered2 (new) | 0.211 (0.97) | 0.229 (0.91) | 0.225 (1.00) | 0.271 (0.74) | 0.327 (1.06) |
| cumulus field cufield2, 8 clouds (new) | 0.199 (1.00) | **0.189** (0.97) | 0.205 (1.02) | 0.244 (0.85) | 0.355 (1.14) |
| LES congestus | 0.401 (0.99) | 0.381 (0.97) | 0.391 (0.99) | 0.415 (0.88) | 0.549 (1.12) |
| sun < 10 deg, all held-out | 0.324 (1.01) | 0.307 (0.98) | 0.318 (1.03) | 0.321 (0.87) | 0.482 (1.20) |
| sun 10-30 deg | 0.214 (0.99) | 0.209 (0.96) | 0.215 (1.01) | 0.288 (0.83) | 0.379 (1.10) |
| sun >= 30 deg | 0.235 (1.02) | 0.238 (0.98) | 0.227 (1.02) | 0.343 (0.81) | 0.335 (1.02) |

What round two did and did not achieve, honestly:
* **The train/run-time gap was smaller than feared.** v1 fed base taps scores the same RMSE as with true taps; what it
  loses is brightness: J 3-9 % dark on game fields (r5scattered2 0.86). v2 removes that bias everywhere (0.98-1.03).
* **v2 does not lower the error overall.** It is better on the game fields (0.272 vs 0.289) and at high sun, equal on
  the round-one set, and 0.01-0.016 worse on the cumulus field, congestus and low sun, where the in-game v1's darker
  bias happened to sit closer to the reference. These differences are about one to two seed spreads.
* **The weak regimes did not move**: adding low suns, multi-cloud boxes, round-five game exports and congestus
  snapshots changed sun < 10 deg and congestus by < 0.02. The oracle at 0.28 / 0.35 says most of the remaining error is
  structure that 9 point taps cannot see.
* Feeding v2 the true-field taps (wrong macro) costs 0.03 S and makes it 5-8 % bright: keep `CLOUD_MS_SIGMA` on the
  base density.

Renders (`tools/neural/clouds/results/renders/*.png`): columns are reference | new | shipped | classic; the row below
shows |error| x 2. The per-image errors (relative RMSE with the reference noise removed, plus brightness ratio) are in
the `.json` files next to them and are summarised in section 6.

## 4. Physics that needs no network

* **Phase function.** Use `cloudPhaseMie` (true Mie, RGB). It includes the forward peak, the coloured corona/glory rings
  and the fogbow at 141-143 deg (it moves outward for small droplets). `createCloudMultiScatter({ reff })` interpolates
  log p between the 6, 10 and 16 um tables.
  * The Jendersie-d'Eon fit (RESEARCH.md 2.2) was checked against our Mie tables (`results/phase_check.json`). At
    d = 2 r_eff it is good between 20 and 120 deg (within 5 %). It puts the forward peak **4x too high** (2743 vs 639
    sr^-1 at 10 um) and g 0.015 too high. It has no fogbow (3x too low at 141 deg) and no glory (5x too low at 180 deg).
    Prefer the LUT for single scattering. If you keep the fit, a smaller effective diameter (d ~ 1.5 r_eff) fits better
    overall (ln-RMSE 0.32 vs 0.33), but no d fixes the bow and glory.
  * Keep a `pMax` clamp on the single-scattering peak only if bloom demands it.
* **Silver lining.** This is the single scattering with the sharp lobe plus `cloudMsForwardPeak`. Sunlight scattered
  inside the 4 deg diffraction cone stays in the beam, so a sunlit edge in front of the sun is lit by
  `exp(-(1 - f) tauSun)` rather than `exp(-tauSun)`. At tauSun = 3 that is 5x brighter. The network handles everything
  outside the cone.
* **Aureole (round two, analytic).** Delta-M puts all peak-scattered light exactly on the beam, so the glow within a
  few degrees of the sun seen through a thin veil was too dark (33 % low in the 0-4 deg bin at tau 2). The 3-argument
  `cloudMsForwardPeak(tauSun, phase, cosTheta)` adds the small-angle multiple-scattering spread of the excised peak:
  `A = f * sum_{n=1..6} e^-tau (f tau)^n / n! * G_{(n+1) v}(theta)`, `G_v(theta) = exp(-theta^2 / 2v) / (2 pi v)`, with
  v = half the mean-square angle of the excised peak (1.75e-4 rad^2 at 10 um; 3.2e-4 at 6 um, 1.06e-4 at 16 um, from the
  Mie tables, `CLOUD_MS_AURV`). It costs one early-out beyond ~5 deg and a 6-term loop inside it.
  Checked against forward photon Monte Carlo with the full Mie phase (`validate.py --aureole`, `results/aureole.json`),
  slab, sun overhead:

  | tau | 0-4 deg radiance, delta-M only | with aureole | worst 0.5-deg bin, delta-M only | with aureole |
  |---|---|---|---|---|
  | 0.5 | 0.94 | 1.03 | -23 % | +8 % |
  | 1 | 0.85 | 1.02 | -36 % | +6 % |
  | 2 | 0.70 | 1.02 | -54 % | +10 % |
  | 4 | 0.49 | 1.01 | -70 % | +13 % |
* **Droplet size (round two, measured).** The same 36 k points (near1, wisp configs) were path traced with the 6, 10
  and 16 um phase functions (`reff_eval.py`, `results/reff_sensitivity.json`):
  * J_ms (2+ orders outside the 4 deg cone) differs from 10 um by +1.0 % (6 um) and -0.4 % (16 um) in the mean and by
    0.4 % / 0.0 % point-wise once the reference noise is removed; V_sky and V_gnd by < 0.05 %.
  * The total sun + sky source (with each size's own single scattering and forward peak) differs by 2.4 % / 1.4 % in
    brightness and 3.6 % / 2.2 % point-wise: all of it from the phase function and peak, which the per-size Mie table
    already supplies.
  * The 10 um network scores the same against each size's reference (S 0.240 at 6 um, 0.249 at 16 um, 0.245 at 10 um
    on these points).
  * **One network serves 6-16 um.** Change `createCloudMultiScatter({ reff })` (phase LUT, f, pC, aureole width) and keep
    the weights.
* **Reddening.** Cloud extinction is grey: Q_ext varies < 1 % across the visible. The measured water-absorption tint is
  below 0.05 % at the visible skin of every training cloud, up to tau 200. Ratios R/G: 0.9996-1.0000. Not shipped.
  Sunset colour must come from the sun's own transmittance (`atmSunIlluminance` / `clLightE`), which the march already
  applies.
  * Bluish storm bases are skylight fill (`V_sky` x blue `ambUp`) plus aerial perspective, as RESEARCH.md 1.6 concludes.
* **Sky and ground fill.** This is `ms.y` / `ms.z`, all orders, with physical optical depths. Bases go dark under thick
  columns because `V_sky` falls (deck val V_sky bias 0.97).

## 5. Honest limits

* **Information limit.** Even an oracle network with 45 exact optical depths reaches only S ~ 0.21. The rest is
  cloud-scale structure that a point descriptor does not encode: where the light actually enters, and the shape behind
  the sample. A Deep-Scattering-sized stencil (hundreds of taps) would be needed to go further. Out of budget.
* **Low sun** (< 10 deg) and **LES congestus** remain the weakest regimes after round two: S ~ 0.32 and ~ 0.39. More
  low-sun data, multi-cloud boxes, a sun-direction tap and wider nets did not move them by more than 0.01-0.02; the
  oracle (45 exact depths) is at 0.28 / 0.35, so most of what is left is beyond any point descriptor.
* **Aureole.** Fixed analytically in round two (section 4); the remaining error near the sun is within +-13 % per
  0.5-deg bin and +-3 % integrated over 0-4 deg. It is a slab-calibrated small-angle model: in a broken cloud the
  forward-scattered glow also depends on what is beside the beam, which it ignores.
* **Training scope.**
  * The network was trained with the 10 um phase function; measured to serve 6-16 um (section 4).
  * The sky and ground are treated as uniform hemispheres.
  * Multi-cloud fields (8 cumuli per 6 km box, game exports up to ~6 km) are now in the data and in the held-out set,
    but bounce from clouds further than ~3 km away is not.
  * Ground bounce is an input radiance, not simulated.
* **Reference noise.** Each point has 384 + 128 walks (relative noise ~0.15 per point). All RMSE figures have that
  noise subtracted; the "within x1.25" share does not. More walks would sharpen the comparison, not the model: the
  training loss is noise-unbiased and the oracle gap is not noise.
* **Taps.** Descriptor v2 expects 0.8 x the base density. If the base density is redefined, retrain (section 7);
  feeding the v2 net the full field instead costs 0.03 S and makes it 5-8 % bright (measured, section 3.1).
* **tauCam** in training is measured from the cloud volume's boundary. In the game, clouds in front of the sample add to
  it, but the model only uses it near the skin, where it is small. It is clamped at 60.

## 6. Render comparison (192x108, 12 spp, reference noise removed)

Relative RMSE of the cloud pixels (radiance-weighted, the reference's own Monte Carlo noise removed; noise level in
the second column) and brightness ratio vs the path-traced reference. Lighting: sun, mean sky and ground radiances of
a clear day at that sun elevation. All columns share the same single scattering + forward peak + aureole. The images
show reference | new (v2) | shipped | classic; the v1 columns are in the `.json` files only.

| shot | ref noise | **v2 (now)** | v1 in game (base taps) | v1 as evaluated (true taps) | shipped (calibrated) | classic |
|---|---|---|---|---|---|---|
| cumulus at noon (held-out heap, 65 deg) | 0.045 | 0.160 (x1.09) | 0.155 (x1.08) | 0.156 (x1.07) | 0.165 (x0.86) | 0.383 (x0.79) |
| backlit silver lining (sun 14 deg behind) | 0.048 | 0.122 (x1.01) | 0.123 (x1.02) | 0.117 (x1.00) | 0.172 (x0.93) | 0.456 (x0.62) |
| low sun (game field near1, 6 deg) | 0.042 | 0.212 (x1.00) | 0.204 (x0.98) | 0.204 (x0.99) | 0.284 (x0.99) | 0.406 (x0.71) |
| thick storm cloud base (held-out Cb, from below) | 0.027 | 0.142 (x1.04) | 0.147 (x1.02) | 0.140 (x1.01) | 0.257 (x0.77) | 0.681 (x0.30) |
| thin wisp (held-out, 55 deg) | 0.025 | 0.059 (x1.01) | 0.071 (x1.02) | 0.083 (x1.04) | 0.117 (x1.06) | 0.702 (x1.82) |
| **new:** held-out 8-cloud field, sun 8 deg | 0.040 | **0.170 (x1.00)** | 0.190 (x0.99) | 0.202 (x1.00) | 0.203 (x0.94) | 0.417 (x0.58) |

v2 is clearly better on the multi-cloud low-sun field and the wisp, and within +-0.008 of v1 on the other four shots.
The noon cumulus is the one shot where the networks are barely ahead of the shipped nets (they are 8-9 % bright
there; the shipped nets are 14 % dark). The flat vertical faces in the low-sun shot are the edges of the exported game field's box, present in all
columns.

## 7. Reproduce

```sh
VENV=/home/user/wt/neural/tools/neural/.venv/bin/python   # numpy, numba, torch
cd tools/neural/clouds
NUMBA_NUM_THREADS=2 $VENV mie.py            # Mie tables (~1 min)
NUMBA_NUM_THREADS=2 $VENV validate.py       # reference validation (~10 min)
NUMBA_NUM_THREADS=1 $VENV gen.py --pts 1500 --nA 384 --nB 128 --suns 4 --shard 0/2   # and 1/2 (~45 min each)
NUMBA_NUM_THREADS=1 $VENV gen.py --round 2 --pts 1500 --nA 384 --nB 128 --suns 4 --shard 0/2   # and 1/2 (round two)
NUMBA_NUM_THREADS=2 $VENV gen_tap.py --gain 0.8 --blur 40     # true-field and base-density taps -> data/tap2
OMP_NUM_THREADS=2 $VENV train.py ablate "S3;S7;S9;ALL;T:e3:up,down,fwd;B:e3:up,down,fwd;B:e3:up,down,fwd,sun"
OMP_NUM_THREADS=2 SEEDS=3 $VENV train.py final "B:e3:up,down,fwd" 16 20000   # -> cloud-ms-weights.js (v2), vectors
OMP_NUM_THREADS=2 $VENV compare.py --out=compare_final  # before/after per regime (v1 weights: results/model_v1.json)
for r in 6 16; do for o in near1 wisp; do NUMBA_NUM_THREADS=1 $VENV gen.py --only $o --pts 1500 --nA 384 --nB 128 --suns 4 --reff $r --out data/pts_r$r; done; done
$VENV reff_eval.py                                       # droplet-size sensitivity
NUMBA_NUM_THREADS=2 $VENV validate.py --aureole          # aureole vs full-phase photon MC
# round seven: game fields of the round-six-c shader (harness exportDensity with noBub0, see the scratch exports in SHAPE.md 0d)
NUMBA_NUM_THREADS=1 $VENV gen.py --round 3 --pts 1500 --nA 384 --nB 128 --suns 4 --shard 0/2   # and 1/2, then gen_tap.py as above
OMP_NUM_THREADS=2 SEEDS=3 MS_SUFFIX=-r7 $VENV train.py final "B:e3:up,down,fwd" 16 20000      # -> cloud-ms-weights-r7.js
$VENV eval_models.py data/model_final.json data/model_final-r7.json                            # held-out table above
$VENV export_phase.py                         # -> src/neural/cloud-mie-weights.js
$VENV phase_check.py                          # JD fit vs Mie
NUMBA_NUM_THREADS=2 $VENV render.py --res=192x108 --spp=12
node --test src/neural/cloud-ms.test.js
node tools/shot.mjs --entry src/neural/cloud-ms-harness.js --html dist/cloud-ms.html --out shots/cloud-ms.png --size 320x180 --frames 1 --eval "JSON.stringify(sim.results)"
```
