# Clouds: learned light transport (round four), integration guide

Owner: neural-lighting engineer (`src/neural/cloud-ms*.js`, `src/neural/cloud-mie-weights.js`, `tools/neural/clouds/`).
Status: **opt-in**. Nothing here changes what ships today. `cloud-light.js` / `cloud-scatter.js` and the classic path
are untouched; the cloud-shape engineer wires the new functions into `src/clouds/shaders.js` when ready.

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
       the forward full-phase photon histograms within 0.1-2.5 %. The exception is the transmitted bin that contains
       the sun direction at tau = 2: it is 33 % low (aureole, see limits).
2. **Data.** `gen.py`, `gen_tap.py`. There are 116 configurations: 29 cloud volumes x 4 sun elevations (3-85 deg), with
   1500 points each, giving 174 k points. Each point gets 384 + 128 adjoint walks.
   * Points are drawn where a camera actually sees them: one per random ray, with pdf ~ T sigma, weighted by the ray's
     opacity.
   * The volumes are the game's own exported fields (near1 at 0.5/1/1.6x, scattered3, broken3, brokenB) and LES
     cumulus with **microphysical extinction** (sigma = 3 LWC / (2 rho_w r_e), r_e from LWC and N = 100-600 cm^-3).
     The rest are synthetic: spheres, stratiform decks 250-1500 m thick, cumulus heaps with sigma rising as z^(2/3),
     cumulonimbus towers with anvils, and thin wisps.
   * 8 whole scenes are **held out** (one of each family). All "val" numbers below are on clouds the network never saw.
3. **A model.** `train.py`. The descriptor was picked by an ablation over exact and tap-based optical depths in 8
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
float cloudMsForwardPeak(float tauSun, float phase);    // add to the single scattering
vec3  cloudPhaseMie(float cosTheta);                      // tabulated Mie phase, RGB, sr^-1, integral 1
vec3  cloudMsTapSegments(vec3 p, vec3 dir);               // only when CLOUD_MS_SIGMA(p) is #defined
const float CLOUD_MS_F, CLOUD_MS_PC;                      // truncated peak fraction (0.437), phase at 4 deg (2.03)
```

### 2.1 Energy bookkeeping: what to keep, what it replaces (no double counting)

Per lit sample, march with the **full** extinction `sigma` exactly as now (`w = T (1 - exp(-sigma ds))`), and use this
source:

```glsl
vec3  p    = cloudPhaseMie(cosT);                         // or the shader's own fit, per channel or grey
vec3  ms3  = cloudMsLight(tauSun, tauCam, muSun, cosT, tapUp, tapDown, tapFwd);
vec3  Jsun = min(p, vec3(pMax)) * exp(-tauSun)            // single scattering (exact; keep your pMax clamp if any)
           + vec3(cloudMsForwardPeak(tauSun, p.g))        // light carried along the beam by the diffraction peak
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
macro as the physical extinction of the **cheap base density** in the same space as the light march, e.g.
`(clDensityBase(p, wx, lod + 1.0, info) * info.w * uClNoise.w * 0.8)`, with the weather fetch of the sample reused.
Training sampled the true field trilinearly at 10-60 m resolution. A smoother base density is fine; an eroded,
detailed one is not needed.

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
* **Low sun** (< 10 deg) and **LES congestus** remain the weakest regimes: S ~ 0.39-0.40.
* **Aureole.** Within ~4 deg of the sun through thin cloud (tau ~ 1-3), the delta-M split underestimates the multiply
  forward-scattered glow: the slab test is 33 % low in the bin containing the sun. Views straight at the sun disc
  through a veil will be slightly too dark; bloom hides it.
* **Training scope.**
  * The network was trained with the 10 um phase function only. Its dependence on r_eff is expected to be weak
    (g' 0.75-0.77 over 6-16 um) but **was not measured**.
  * The sky and ground are treated as uniform hemispheres.
  * Every cloud volume is isolated in its box. Other clouds and kilometre-scale cloud-to-cloud bounce are only present
    within each field, which spans up to 5.7 km.
  * Ground bounce is an input radiance, not simulated.
* **Taps.** The model expects the tap values of the true field. With the cheap base density the shader will feed
  slightly different values. Shape the macro to stay close to the full density's large-scale structure.
* **tauCam** in training is measured from the cloud volume's boundary. In the game, clouds in front of the sample add to
  it, but the model only uses it near the skin, where it is small. It is clamped at 60.

## 6. Render comparison (192x108, 12 spp, reference noise removed)

Relative RMSE of the cloud pixels (radiance-weighted, the reference's own Monte Carlo noise removed; noise level in
the second column) and brightness ratio vs the path-traced reference. Lighting: sun, mean sky and ground radiances of
a clear day at that sun elevation.

| shot | ref noise | new | shipped (calibrated) | classic |
|---|---|---|---|---|
| cumulus at noon (held-out heap, 65 deg) | 0.045 | 0.156 (x1.07) | 0.165 (x0.86) | 0.383 (x0.79) |
| backlit silver lining (sun 14 deg behind) | 0.048 | 0.117 (x1.00) | 0.172 (x0.93) | 0.456 (x0.62) |
| low sun (game field near1, 6 deg) | 0.042 | 0.204 (x0.99) | 0.284 (x0.99) | 0.406 (x0.71) |
| thick storm cloud base (held-out Cb, from below) | 0.027 | 0.140 (x1.01) | 0.257 (x0.77) | 0.681 (x0.30) |
| thin wisp (held-out, 55 deg) | 0.025 | 0.083 (x1.04) | 0.117 (x1.06) | 0.702 (x1.82) |

The noon cumulus is the one shot where the new model is barely ahead (it is 7 % bright there; the shipped nets are 14 %
dark). The flat vertical faces in the low-sun shot are the edges of the exported game field's box, present in all
columns.

## 7. Reproduce

```sh
VENV=/home/user/wt/neural/tools/neural/.venv/bin/python   # numpy, numba, torch
cd tools/neural/clouds
NUMBA_NUM_THREADS=2 $VENV mie.py            # Mie tables (~1 min)
NUMBA_NUM_THREADS=2 $VENV validate.py       # reference validation (~10 min)
NUMBA_NUM_THREADS=1 $VENV gen.py --pts 1500 --nA 384 --nB 128 --suns 4 --shard 0/2   # and 1/2 (~45 min each)
NUMBA_NUM_THREADS=2 $VENV gen_tap.py
OMP_NUM_THREADS=2 $VENV train.py ablate "S3;S7;S9;ALL;T:e3:up,down,fwd;..."
OMP_NUM_THREADS=2 $VENV train.py final "T:e3:up,down,fwd" 16 20000     # -> src/neural/cloud-ms-weights.js, test vectors
$VENV export_phase.py                         # -> src/neural/cloud-mie-weights.js
$VENV phase_check.py                          # JD fit vs Mie
NUMBA_NUM_THREADS=2 $VENV render.py --res=192x108 --spp=12
node --test src/neural/cloud-ms.test.js
node tools/shot.mjs --entry src/neural/cloud-ms-harness.js --html dist/cloud-ms.html --out shots/cloud-ms.png --size 320x180 --frames 1 --eval "JSON.stringify(sim.results)"
```
