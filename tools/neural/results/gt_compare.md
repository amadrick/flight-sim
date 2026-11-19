# Round two: ground-truth comparison of the real-time clouds

Pipeline (all numpy, no numba / torch; commands at the top of each script):
`src/clouds/harness.js sim.exportDensity` (density fields sampled from the real cloud GLSL) -> `gt_trace.py`
(path-traced reference: sun + analytic sky + Lambertian ground, all orders, TMS: exact single scattering with the
full Mie-fit phase function + delta-M scaled random walk for everything else) -> `gt_march.py` (numpy port of the
march: step logic, refine-on-hit, light march + shadow-map optical depth, tauUp/tauDown proxies, ambient) ->
`gt_compare.py` (images + metrics), `gt_points.py` (point-wise truth at the lit samples) -> `gt_analyze.py`,
`gt_fit.py` (feature study), `gt_train_light.py` (round-two networks).

Fields: `scattered` / `broken` (weather presets, 5.76 x 5.76 km windows picked for ~40 / 60 % cloud cover, 30 m
grid), `scatteredB` / `brokenB` = the same windows after the round-two density changes.
Cases: noon_above (sun 65 deg, above the layer looking down), noon_below (below the base looking up), low_toward /
low_away (sun 8 deg, inside-layer altitude, toward / away from the sun), sunset_base (sun 2.5 deg, below the base,
toward the sun). 160x90, reference 256 paths per pixel.

## Images (metrics on cloud pixels; bias = mean luminance model / reference, contrast = std ln L model / reference)

Models: classic = `scatter=classic`; neural3 / neural4 = round one (`scatter=neural3` / round-one default);
v2 = round two (retrained J + learned ambient, the new default); v2ambOnly = round-one J + round-two ambient.

### scatteredB
| case | model | bias | relMAE | lnRMSE | contrast | chroma |
|---|---|---|---|---|---|---|
| noon_above | classic | 1.103 | 0.294 | 0.399 | 0.986 | 0.098 |
| | neural4 (round-one default) | 0.830 | 0.220 | 0.271 | 0.894 | 0.089 |
| | neural3 | 0.640 | 0.410 | 0.524 | 0.640 | 0.075 |
| | **v2** | 1.055 | **0.181** | **0.267** | 0.856 | 0.051 |
| noon_below | classic | 0.924 | 0.368 | 0.490 | 1.878 | 0.106 |
| | neural4 | 0.750 | 0.256 | 0.333 | 0.977 | 0.102 |
| | neural3 | 0.821 | 0.206 | 0.273 | 0.795 | 0.107 |
| | **v2** | 0.917 | **0.152** | **0.191** | 0.969 | 0.033 |
| low_toward | classic | 0.952 | 0.502 | 0.633 | 1.241 | 0.159 |
| | neural4 | 1.239 | 0.418 | 0.367 | 1.167 | 0.194 |
| | neural3 | 1.266 | 0.477 | 0.437 | 1.200 | 0.191 |
| | **v2** | 1.180 | **0.238** | **0.263** | 0.979 | 0.059 |
| low_away | classic | 1.365 | 0.398 | 0.492 | 0.690 | 0.185 |
| | neural4 | 0.853 | 0.207 | 0.257 | 0.735 | 0.158 |
| | neural3 | 0.815 | 0.293 | 0.370 | 0.577 | 0.156 |
| | **v2** | 1.057 | **0.140** | **0.239** | 0.725 | 0.026 |
| sunset_base | classic | 0.609 | 0.465 | 0.895 | 1.496 | 0.191 |
| | neural4 | 0.655 | 0.370 | 0.627 | 1.204 | 0.248 |
| | neural3 | 0.689 | 0.364 | 0.659 | 1.278 | 0.247 |
| | **v2** | 0.790 | **0.228** | **0.294** | 0.923 | 0.083 |

### brokenB
| case | classic relMAE / lnRMSE | neural4 | neural3 | **v2** | v2 bias / contrast |
|---|---|---|---|---|---|
| noon_above | 0.306 / 0.398 | 0.268 / 0.325 | 0.403 / 0.519 | **0.183 / 0.250** | 0.991 / 0.799 |
| noon_below | 0.389 / 0.429 | 0.276 / 0.360 | 0.223 / 0.303 | **0.138 / 0.171** | 0.929 / 0.961 |
| low_toward | 0.435 / 0.504 | 0.190 / 0.293 | 0.222 / 0.332 | **0.192 / 0.269** | 1.150 / 0.948 |
| low_away | 0.305 / 0.388 | 0.244 / 0.313 | 0.319 / 0.396 | **0.150 / 0.226** | 1.034 / 0.700 |
| sunset_base | 0.509 / 0.983 | 0.436 / 0.759 | 0.432 / 0.757 | **0.306 / 0.420** | 0.713 / 0.969 |

(The same tables for the round-one fields `scattered` / `broken` are within a few per cent of these.)

## Point-wise (the lit samples of the march, importance-weighted, mean over cases of ln RMSE / |bias - 1|)

Sun source function J (truth: path traced, MC noise floor of the truth itself ~0.19 ln):

| model, game features | ln RMSE | mean bias |
|---|---|---|
| classic | 1.04 | ~2x too bright |
| round-one 3-feature | 0.93 | 0.28 |
| round-one 4-feature | 0.92 | 0.36 |
| round-one 4-feature fed TRUE tauUp / tauDown | 0.85 | 0.29 |
| round-one 4-feature, all inputs true | 0.82 | 0.22 |
| **round two, same 3 inputs, trained on game features (held-out field)** | **0.69-0.73** | 0.13-0.18 |
| round two + density / shape excess / view-ray depth / view elevation / sun elevation (best cheap set) | 0.66 | 0.15 |
| oracle features (true tauUp, tauDown, min side depth) | 0.64 | 0.17 |

Light march vs truth: feeding the exact sun optical depth instead of the light-march + shadow-map estimate changes
nothing (0.675 vs 0.688), so the march's numerics are not the limit; the remaining error is geometry the per-sample
features do not carry.

Sky / ground ambient (source per unit hemisphere radiance):

| model | ln RMSE | bias |
|---|---|---|
| hand-written visUp / visDn (round one) | 1.53 / 1.13 | 0.16-0.27 (4-6x too dark) / 0.2-0.5 |
| two-stream slab (cloud-sky.js analytic) with game features | 0.38 | 0.6-1.1 |
| constant 0.5 | 0.44 | ~1 |
| **round-two V net (tauUp, tauDown), held-out field** | **0.31** | 0.13 |
| oracle (true up / down / side depths) | 0.25 | 0.05 |

Feature findings: the march's tauUp proxy (height to the cell's nominal top x density) is ~5x the true optical depth
to the local cloud top at the lit samples (median 10.6 vs 1.9); the round-one networks were trained on true depths.
Visible samples see ~45 % sky and ~55 % ground-hemisphere light (small cumulus, open sides), where the old ambient
assumed a slab and decayed with tauUp.
Image columns: reference | classic | neural3 (round one) | neural4 (round-one default) | v2ambOnly | v2 (round two); rows: noon_above, noon_below, low_toward, low_away, sunset_base.
