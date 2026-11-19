# Clouds: shape, dynamics and light model (round five)

Owner: cloud-shape engineer (`src/clouds/**`). Numbers come from docs/clouds/RESEARCH.md (section in brackets);
the light transport contract is docs/clouds/NEURAL.md. Every new piece has a URL switch (last column) so old and new
can be compared side by side; all round-four switches still work.

## 1. Density in real units

| piece | model | switch |
| --- | --- | --- |
| liquid water | `LWC = Gamma_ad * (z - z_base) * f_ad`, Gamma_ad = 2 g m^-3 per km [1.3], adiabatic fraction 0.8 at the base falling to 0.3 at the cloud's own top, x0.45 in dissolving cells; capped at 3 g m^-3 (cumulus) and 0.6 g m^-3 for decks (2.5 in Cb cores) | `clLwc` (g m^-3 per km), `clLwcCap`, `clPhys=0` = round four |
| extinction | `sigma = 0.119 (N/150)^(1/3) LWC^(2/3)` 1/m: Q_ext = 2, r_e from LWC and N [1.1, 1.5]. N = 150 cm^-3 (cumulus), 250 (stratus), 400 (convective) | `clN` |
| ice (anvil) | `sigma = 0.041 IWC`, r_e 40 um, IWC 0.04 (rim) .. 0.3 (core) g m^-3 [1.4] | with `clPhys` |
| base | shared flat condensation level, 30 m density ramp (was 90 m) [4.1]; still no billow erosion in the lowest 8 % | `P.baseRamp` |
| edges | entrainment dilution of the outer skin: growing turrets keep 60 % of their water to 20 m inside, dissolving cells 30 % over 80 m [1.3, 4.4] | with `clPhys` |
| cauliflower | detail octave amplitude ratio 0.5 -> 0.28 (amplitude ~ wavelength): lobes on lobes instead of fuzz | `clDetA` |

All of it goes through `info.w` (= sigma / uClNoise.w), so the march, the light march, the shadow map and the
learned-MS taps all see the same physical optical depths. Typical values: fair cumulus core 0.03 (100 m above the
base) .. 0.11 1/m (top); overcast 0.06-0.08 1/m; anvil 0.002-0.012 1/m.

## 2. Dynamics

* **Life cycle** (`clLife=0` freezes it, `clLifeT` = nominal lifetime, s): every cumulus cell has an age that runs at
  its own rate (lifetime ~1400 s for a 1.2 km cell, ~15 min for small ones [4.3]). Born at 60 % radius and 25 %
  height with no water; the tower rises (top climbs 1-3 m/s) and the radius fills in during the first third; mature;
  from 62 % of its life it frays (wispy noise, soft edge, diluted skin), from 70 % its water evaporates and the radius
  shrinks; at the wrap it has no water, so nothing pops. Selection threshold is raised by 25 % so the visible cloud
  fraction stays the same. The CPU mirror (`densityAt`) follows the same ages.
* **Wind**: air-mass advection with the wind at 35 % of the layer (unchanged), towers lean downwind with the
  base-to-top shear (now one function for the GPU and the CPU mirror), streets along the wind (unchanged).

## 3. Light (shape side)

* **Learned multiple scattering** (default; `clMs=0` = round-three nets from main.js, `scatter=classic` = analytic).
  Wired per NEURAL.md 2.1: `S = E (p_Mie e^-tauSun + forwardPeak + J_ms) + ambUp V_sky + ambDn V_gnd`, physical tauSun,
  tauCam = -log T, 9 taps of the cheap base density (`clMsSigma`). The network runs on the first `clMsN` (4) lit
  samples of a ray; deeper samples reuse its last output. lam / occ at `clMsDetail` (0.5).
* **Sun and moon**: the pipeline's own sun / moon illuminance through the atmosphere transmittance at the cloud's true
  altitude and with the sun elevation measured against the cloud's LOCAL vertical (earth curvature), evaluated at
  the base and the top of the layer at both ends of the lit interval (bilinear per sample). Moon = `uAtmMoonIllum`
  (phase, tint) instead of the round-four artistic 0.05: moonlit clouds now have the energy of moonlit white paint.
  `clLight=0` = round four.
* **Classic path**: Jendersie-d'Eon HG+Draine phase (d from N) for single scattering, angle-dependent powder.
* **Cirrus**: 22 degree halo (sharp red inner edge, nothing inside) [2.3]; cirrus ambient from the raw sky probe.

## 4. Fixes

* **Sunlit spawn** (`clSpawn=0` off): target weather, GPU lean, life cycle, 90 s wind look-ahead (`clSpawnAhead`),
  re-run on time/weather changes while the player is still at the spawn point, and a GPU read-back of the baked
  shadow map at the player (4x4 texels) that shifts the field again with a wider margin if tau > 0.03.
  `clouds.debug.spawnInfo` reports shift, candidates, gpuTau.
* **Anvil rings**: the shadow-map bake spends its last 8 steps evenly over the anvil's height range (the u^1.5 steps
  cut the slab with 1-3 samples, so its optical depth came in steps around every core).
* **Twilight**: see the local-vertical sun above; low clouds go into the Earth's shadow at the right time, high and
  distant sunward clouds keep their orange.

## 5. Cost (quality high, 80 steps, 1/2 res)

Per lit sample, learned MS: 9 cheap density taps (1 cell fetch + 1 base-noise fetch each = 18 fetches), ~600 FMA,
1 Mie LUT fetch per ray; only on the first 4 lit samples of a ray. Twilight light: 4 transmittance LUT fetches per ray
(was 2 atmosphere calls). Shadow bake: +1 weather fetch per texel with an anvil. No new passes, no new render targets.
