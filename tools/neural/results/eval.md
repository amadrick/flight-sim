TEST set: 100000 samples from 50 unseen clouds, 192 paths/sample.
MC noise of the reference: rel. RMS 0.227, median rel. std 0.143; 28696 low-noise samples (<10%, both halves non-zero).
Mean multiple-scattering fraction of J: 0.841. LUT vs direct network: rel. RMS 0.0165, median 0.0047.

| model | display-rel. RMSE | rel. RMSE | energy-wtd RMSE | ln-RMSE (low-noise) | median abs rel. err (low-noise / all) | within 25 % (low-noise / all) | within x2 (low-noise / all) |
|---|---|---|---|---|---|---|---|
| Single scattering only | 0.558 | 0.946 | 0.095 | 2.761 | 0.626 / 0.977 | 22.6 % / 6.5 % | 40.4 % / 12.4 % |
| Beer-powder (Schneider 2015) | 0.545 | 0.939 | 0.493 | 2.523 | 0.576 / 0.968 | 17.7 % / 5.2 % | 45.3 % / 14.2 % |
| Nubis 2017 attenuation clamp | 7.914 | 9.558 | 0.390 | 1.431 | 0.611 / 0.938 | 22.5 % / 7.1 % | 44.4 % / 15.3 % |
| Octaves, stock a=b=c=0.5, N=8 (Wrenninge / Frostbite) | 0.486 | 1.060 | 0.094 | 1.189 | 0.504 / 0.767 | 28.0 % / 14.8 % | 52.4 % / 33.7 % |
| Octaves, (a,b,c,gain) FITTED to our training set | 0.381 | 0.915 | 0.094 | 0.774 | 0.409 / 0.481 | 31.8 % / 24.7 % | 66.4 % / 59.2 % |
| **NEURAL** (3161 params), network evaluated directly | 0.271 | 0.779 | 0.020 | 0.459 | 0.076 / 0.299 | 78.9 % / 45.4 % | 94.4 % / 74.2 % |
| **NEURAL, as deployed** (32^3 half-float LUT, trilinear) | 0.274 | 0.795 | 0.019 | 0.462 | 0.076 / 0.299 | 78.9 % / 45.3 % | 94.3 % / 74.1 % |
| NEURAL, thick-column prior variant (opts.prior = 1), direct | 0.497 | 1.754 | 0.028 | 0.556 | 0.095 / 0.360 | 74.2 % / 41.4 % | 93.3 % / 68.2 % |
| Ablation: NEURAL without tauUp (tauSun, cosTheta only) | 0.288 | 0.879 | 0.028 | 0.471 | 0.109 / 0.315 | 76.3 % / 43.5 % | 94.1 % / 73.1 % |
| Stretch: NEURAL 4-feature (+tauDown, 2665 params), direct | 0.192 | 0.433 | 0.018 | 0.374 | 0.076 / 0.225 | 81.2 % / 53.5 % | 97.8 % / 86.3 % |
| Stretch: NEURAL 4-feature, as deployed (2 textures) | 0.192 | 0.433 | 0.017 | 0.374 | 0.076 / 0.225 | 81.3 % / 53.5 % | 97.8 % / 86.3 % |
| Oracle (not deployed): 9k-param MLP, same 3 features | 0.271 | 0.763 | 0.029 | 0.461 | 0.106 / 0.310 | 75.9 % / 43.9 % | 94.3 % / 74.0 % |
| Oracle (not deployed): 9k-param MLP, 3 features + sun elevation mu0 | 0.275 | 0.756 | 0.028 | 0.457 | 0.109 / 0.299 | 77.1 % / 44.8 % | 94.6 % / 74.5 % |
| Oracle (not deployed): 9k-param MLP, 3 features + local extinction | 0.244 | 0.605 | 0.030 | 0.431 | 0.106 / 0.287 | 77.4 % / 45.8 % | 95.2 % / 77.1 % |
| Oracle (not deployed): 9k-param MLP, 3 features + tauDown | 0.199 | 0.448 | 0.027 | 0.382 | 0.106 / 0.238 | 78.3 % / 51.7 % | 97.7 % / 85.6 % |
| Oracle (not deployed): 9k-param MLP, all 8 recorded features | 0.183 | 0.397 | 0.029 | 0.372 | 0.105 / 0.224 | 79.1 % / 53.8 % | 97.9 % / 87.5 % |

Population-weighted (thick-column prior, weight = clip(tauUp+tauDown, 1, 64)) noise-debiased errors:

| model | display-rel. RMSE | rel. RMSE |
|---|---|---|
| Single scattering only | 0.581 | 1.008 |
| Beer-powder (Schneider 2015) | 0.570 | 1.000 |
| Nubis 2017 attenuation clamp | 7.899 | 9.398 |
| Octaves, stock a=b=c=0.5, N=8 (Wrenninge / Frostbite) | 0.504 | 0.914 |
| Octaves, (a,b,c,gain) FITTED to our training set | 0.361 | 0.709 |
| **NEURAL** (3161 params), network evaluated directly | 0.266 | 0.628 |
| **NEURAL, as deployed** (32^3 half-float LUT, trilinear) | 0.265 | 0.630 |
| NEURAL, thick-column prior variant (opts.prior = 1), direct | 0.303 | 0.855 |
| Ablation: NEURAL without tauUp (tauSun, cosTheta only) | 0.272 | 0.679 |
| Stretch: NEURAL 4-feature (+tauDown, 2665 params), direct | 0.197 | 0.447 |
| Stretch: NEURAL 4-feature, as deployed (2 textures) | 0.197 | 0.447 |
| Oracle (not deployed): 9k-param MLP, same 3 features | 0.277 | 0.710 |
| Oracle (not deployed): 9k-param MLP, 3 features + sun elevation mu0 | 0.268 | 0.578 |
| Oracle (not deployed): 9k-param MLP, 3 features + local extinction | 0.260 | 0.632 |
| Oracle (not deployed): 9k-param MLP, 3 features + tauDown | 0.205 | 0.493 |
| Oracle (not deployed): 9k-param MLP, all 8 recorded features | 0.177 | 0.359 |

Brightness bias by column optical thickness tau_v = tauUp + tauDown (camera samples, theta > 30 deg): sum of predicted J_ms / sum of path-traced J_ms.

| tau_v | n | mean path-traced J_ms | octaves fitted | NEURAL (LUT) | NEURAL, thick prior | NEURAL-4 |
|---|---|---|---|---|---|---|
| 0 - 1 | 4366 | 0.0299 | 2.09 | 1.77 | 3.38 | 0.86 |
| 1 - 2 | 4694 | 0.0398 | 1.49 | 1.43 | 2.54 | 0.91 |
| 2 - 4 | 6890 | 0.0569 | 0.99 | 1.12 | 1.79 | 0.88 |
| 4 - 8 | 7446 | 0.0762 | 0.68 | 0.89 | 1.32 | 0.85 |
| 8 - 16 | 6245 | 0.0819 | 0.57 | 0.81 | 1.17 | 0.92 |
| 16 - 32 | 3857 | 0.0869 | 0.46 | 0.61 | 0.92 | 0.89 |
| 32 - 64 | 1702 | 0.0697 | 0.48 | 0.60 | 0.87 | 1.05 |
| 64 - inf | 413 | 0.0673 | 0.51 | 0.62 | 0.87 | 1.22 |

Per-subset display-relative RMSE:

| subset | n | single | octaves stock | octaves fitted | NEURAL (LUT) | NEURAL, thick prior | NEURAL-4 (stretch) |
|---|---|---|---|---|---|---|---|
| all | 100000 | 0.558 | 0.486 | 0.381 | 0.274 | 0.497 | 0.192 |
| camera (image-weighted) | 53249 | 0.571 | 0.481 | 0.377 | 0.280 | 0.494 | 0.203 |
| interior | 46751 | 0.541 | 0.492 | 0.387 | 0.267 | 0.501 | 0.178 |
| thin (tauSun<1) | 28762 | 0.425 | 0.408 | 0.383 | 0.317 | 0.698 | 0.203 |
| mid (1<=tauSun<8) | 42678 | 0.629 | 0.512 | 0.424 | 0.266 | 0.447 | 0.187 |
| deep (tauSun>=8) | 28560 | 0.561 | 0.519 | 0.306 | 0.234 | 0.276 | 0.188 |
| forward (theta<10deg) | 26985 | 0.587 | 0.561 | 0.444 | 0.131 | 0.153 | 0.120 |
| side/back (theta>30deg) | 64775 | 0.530 | 0.442 | 0.360 | 0.323 | 0.605 | 0.217 |
| thin column (tauUp+tauDown<2) | 22662 | 0.386 | 0.454 | 0.419 | 0.325 | 0.796 | 0.172 |
| medium column (2..16) | 56892 | 0.601 | 0.485 | 0.372 | 0.249 | 0.401 | 0.199 |
| thick column (>=16) | 20446 | 0.592 | 0.524 | 0.364 | 0.277 | 0.240 | 0.194 |
| family: cumulus | 62000 | 0.552 | 0.492 | 0.385 | 0.289 | 0.526 | 0.196 |
| family: stratus | 16000 | 0.554 | 0.493 | 0.406 | 0.272 | 0.504 | 0.201 |
| family: slab | 4000 | 0.545 | 0.422 | 0.326 | 0.183 | 0.290 | 0.170 |
| family: shape | 18000 | 0.580 | 0.474 | 0.360 | 0.234 | 0.420 | 0.173 |

Per-subset relative RMSE:

| subset | n | single | octaves stock | octaves fitted | NEURAL (LUT) | NEURAL, thick prior | NEURAL-4 (stretch) |
|---|---|---|---|---|---|---|---|
| all | 100000 | 0.946 | 1.060 | 0.915 | 0.795 | 1.754 | 0.433 |
| camera (image-weighted) | 53249 | 1.005 | 1.066 | 0.922 | 0.784 | 1.742 | 0.470 |
| interior | 46751 | 0.874 | 1.052 | 0.906 | 0.808 | 1.767 | 0.387 |
| thin (tauSun<1) | 28762 | 0.840 | 1.433 | 1.273 | 1.033 | 2.639 | 0.486 |
| mid (1<=tauSun<8) | 42678 | 0.934 | 0.784 | 0.739 | 0.702 | 1.446 | 0.362 |
| deep (tauSun>=8) | 28560 | 1.058 | 0.973 | 0.695 | 0.634 | 0.796 | 0.472 |
| forward (theta<10deg) | 26985 | 0.775 | 0.737 | 0.598 | 0.283 | 0.316 | 0.237 |
| side/back (theta>30deg) | 64775 | 1.017 | 1.198 | 1.055 | 0.964 | 2.166 | 0.506 |
| thin column (tauUp+tauDown<2) | 22662 | 0.821 | 1.665 | 1.534 | 1.282 | 3.258 | 0.505 |
| medium column (2..16) | 56892 | 0.954 | 0.737 | 0.596 | 0.570 | 1.025 | 0.400 |
| thick column (>=16) | 20446 | 1.047 | 0.952 | 0.704 | 0.605 | 0.597 | 0.435 |
| family: cumulus | 62000 | 0.959 | 1.087 | 0.912 | 0.808 | 1.791 | 0.443 |
| family: stratus | 16000 | 0.958 | 1.303 | 1.231 | 1.007 | 2.267 | 0.492 |
| family: slab | 4000 | 1.066 | 0.801 | 0.690 | 0.525 | 0.894 | 0.388 |
| family: shape | 18000 | 0.858 | 0.722 | 0.574 | 0.549 | 1.141 | 0.340 |

Per-subset fraction within a factor 2 (all samples):

| subset | n | single | octaves stock | octaves fitted | NEURAL (LUT) | NEURAL, thick prior | NEURAL-4 (stretch) |
|---|---|---|---|---|---|---|---|
| all | 100000 | 0.124 | 0.337 | 0.592 | 0.741 | 0.682 | 0.863 |
| camera (image-weighted) | 53249 | 0.094 | 0.339 | 0.604 | 0.731 | 0.679 | 0.864 |
| interior | 46751 | 0.158 | 0.335 | 0.579 | 0.753 | 0.687 | 0.863 |
| thin (tauSun<1) | 28762 | 0.294 | 0.612 | 0.617 | 0.646 | 0.537 | 0.853 |
| mid (1<=tauSun<8) | 42678 | 0.092 | 0.350 | 0.554 | 0.789 | 0.736 | 0.894 |
| deep (tauSun>=8) | 28560 | 0.000 | 0.041 | 0.625 | 0.766 | 0.748 | 0.827 |
| forward (theta<10deg) | 26985 | 0.336 | 0.348 | 0.599 | 0.942 | 0.938 | 0.956 |
| side/back (theta>30deg) | 64775 | 0.036 | 0.343 | 0.566 | 0.632 | 0.544 | 0.813 |
| thin column (tauUp+tauDown<2) | 22662 | 0.316 | 0.501 | 0.548 | 0.601 | 0.461 | 0.849 |
| medium column (2..16) | 56892 | 0.087 | 0.366 | 0.638 | 0.810 | 0.729 | 0.874 |
| thick column (>=16) | 20446 | 0.014 | 0.074 | 0.514 | 0.707 | 0.799 | 0.849 |
| family: cumulus | 62000 | 0.126 | 0.323 | 0.575 | 0.713 | 0.666 | 0.858 |
| family: stratus | 16000 | 0.158 | 0.340 | 0.551 | 0.727 | 0.680 | 0.842 |
| family: slab | 4000 | 0.049 | 0.276 | 0.660 | 0.852 | 0.789 | 0.897 |
| family: shape | 18000 | 0.100 | 0.396 | 0.672 | 0.827 | 0.719 | 0.890 |

