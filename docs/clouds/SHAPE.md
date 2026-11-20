# Clouds: shape, dynamics and light model (rounds five and six)

Owner: cloud-shape engineer (`src/clouds/**`). Numbers come from docs/clouds/RESEARCH.md (section in brackets);
the light transport contract is docs/clouds/NEURAL.md. Every new piece has a URL switch (last column) so old and new
can be compared side by side; all round-four and round-five switches still work.

## 0b. Round six b: running log (newest last)

* Kept the predecessor's uncommitted Cb tweak (turret cells 500-900 m, cascade x0.7): commit 7e7a713.
* **Cover** (ground-shadow cover = share of shadow-map texels with tau > 0.5, harness looking straight down from 9 km,
  `fair`): round five 18 %, round six 14 %; full sim `aircraft=f16&start=air` (fair, the default) 12 %, spawn shifted
  636 m. So the fair preset was NOT too cloudy: shots/r6-after-chase.png was taken with `weather=scattered&tod=13`
  (scratchpad final.sh), which is 3-4 oktas by design. The chase proof below uses the lead's command (fair).
* Bubble volume v2 (`clBubV`, boot-time, 1 = default): domain-warped (2 octaves of tiling gradient noise, ~0.2 cell),
  radii 0.32-0.95 cell with more small ones, plus a satellite sphere (0.35-0.6 x) on the upper side of every bubble.
* **Where the soap-bubble rings come from** (close turret, harness `weather=scattered&tod=15&cx=6000&cz=-3000&cy=1800&
  yaw=20&pitch=6&standoff=400&standoffMin=300`, scratchpad c4/diag*.png): NOT the density (the vertical section,
  `view=slice`, is solid with sharp lobes; the direct-sun-only view `clDbg=1` shows opaque lumpy turrets). Toggling
  `clLam=0`, `clCav=0`, `clLobeSh=0`, `clLobe=0`, `clMsN=80`, `clMsBub=1`, `clSph=0` all left the rings. `scatter=classic`
  and `clMs=0` have NO rings and no veil (opaque, contrasty cauliflower). So it is the lighting inputs of the learned
  MS path: the light march and the network's 9 taps sample the CHEAP density (envelope + at most octave 0), while the
  visible surface is up to ~0.5 cell radii away from it. Bubble parts outside the cheap envelope get tauSun ~ 0 and
  "thin cloud" taps, parts inside get its full shadow: the outline where the envelope cuts each bubble is printed on the
  lit face (rings), and the whole bubble shell outside the envelope reads as a grey translucent veil.
* Fix 1 (`clLOff`, default 1): the light march and the MS taps add the sample's own displacement (visible surface minus
  cheap surface, km) to the cheap density, fading over `clLOffR` / `clMsOffR` x the largest bubble size. Depth toward the
  sun and the taps are then measured from the visible surface. Rings much weaker, veil reduced.
* Fix 2 (`clBubMu`, default 1): lobe orientation from the change of the visible surface function (envelope + cascade)
  over a short step toward the sun, instead of the gradient of the sphere field alone (which lit each whole sphere,
  also where the envelope cuts it: a disc with a dark rim).

## 0. Round six: cauliflower, field variety, cost

The complaint was "smooth rounded cotton puffs". What made them so (each one checked with the vertical density
section of the harness, `view=slice`, and with A/B renders):

* **The detail could not draw a crease.** The erosion was a Worley *fbm* (smooth valleys) turned into caps, from a 32^3
  volume in which the finest Worley cell is 2.7 voxels wide: trilinear filtering rounded every V-shaped crease into a
  dimple. With the octave ratio cut to 0.28 the finer octaves were also too weak to matter.
* **The macro shape was an egg / pillar.** Depth = 1-2 x the diameter (2-3 x in congestus) with a width profile that is
  constant over most of the height: tall smooth columns ("vertical eggs" in the round-five chase shot).
* **Vertical "curtains" were extrusions of the 2-D cell field**: bilinear C0 creases every 80 m up steep walls, a cell
  border where the owner (size, id, *phase*) was blended between two neighbours (the blended phase wrapped through a whole
  life cycle inside one texel and drew thin curved sheets), and the curl offset of the decaying-cell erosion, which
  depends on x and z only and shifts whole vertical columns alike. In shading, the self-shadow of an envelope that is a
  vertical extrusion is itself one: light / dark flutes on sunlit towers.
* **The |gradient| normalisation of the turret term** explodes in the creases of the base Worley; where it did, the
  surface displacement was scaled up along that crease network (swirling "wind-sculpted snow" streaks once real
  bubbles were added).
* **Lobes were not lit as lobes** beyond ~10 m pixels (the surface-orientation term needs the near-camera detailed light
  samples), and the learned MS ignored the sub-cell geometry, at half strength of the crease terms.

| piece | model | switch |
| --- | --- | --- |
| bubble volume | new 64^3 RGBA8 3-D texture, `tClBubble` (noise.js `BUBBLE_FRAG`, ~30 ms at boot): each channel is the signed distance field of a union of spheres, `S = max_i (r_i - abs(p - c_i))`, one sphere per Worley cell (5 cells per axis, jittered centres, radii 0.5-0.95 cell): round bubbles that meet in sharp V creases, 12.8 voxels per cell so filtering keeps them | - |
| bubble cascade | `clBubbles()`: up to 4 octaves, cell size `lam_k = lam_0 0.42^k` (radius ratio 0.35-0.5 per level [4.3]), `lam_0 = 0.45 x` the cell's thermal radius (22-650 m), amplitude ~ size. Octave 0 is signed (big turrets and the deep creases between them); finer octaves only bulge OUTWARD with a spherical-cap profile `sqrt(x)` (they rise vertically from the surface they sit on, domed on top); each is gated by its parent (sub-turrets ride on the domes, creases stay clean folds), rotated and warped by the parent; they rise through the cloud at ~1-2 m/s (boiling). Octaves stop at ~3 pixel footprints | `clBub` (amplitude, 0 = round-five detail), `clBubR`, `clBubL`, `clBubN` (octaves) |
| growing vs dissolving | the cascade weight is `1 - decay` per cell: growing / mature cells are crisp cauliflower, dissolving ones blend back to the round-five wispy erosion (ragged, translucent) [4.4]. Entrainment skin of growing turrets 6 m (was 20 m) | `clSkin` |
| smooth envelope | with the cascade on, the base-noise turrets are lowered to 0.4 x and the |gradient| normalisation is off (the envelope is close to a distance field), the envelope radius saturates at 1.2 cell radii so a cell never reaches the border of its territory | `clPtK` |
| lobe self-shadowing | octave 0 of the cascade is also in the cheap density (light march, shadow map): each big turret shades the next | `clLobeSh` |
| lobe orientation | Lambert-like term of the two largest octaves from the change of the sphere field toward the light (the field has unit gradient), at every distance where the bubbles span a few pixels (round four's estimate only ran within ~10 m pixels); crease occlusion and the orientation term at full strength on bubbly cells in the learned-MS path | `clLobe` |
| curtains | height-dependent warp of the cell lookup (45 m), C1 (smoothstepped) cell-field fetch near the camera, owner cell's size / id / phase by `texelFetch` (no blend of two neighbours), curl offset slides with height, turret noise of cells with vertical frequency 0.9 (was 0.55) | `clWall` (0 = all off), `clVs` |
| macro shape | fair-weather aspect (depth / diameter) 0.6 (humilis / mediocris) .. 1.7 (congestus), convective 1.1 .. 3.0 (round five 1.0 .. 2.0) [4.2] | `clAspLo`, `clAspHi` |
| sharp ramps | the growing edge keeps round five's ramp of max(footprint, 4 m), now on a surface that has creases; sphere tracing through the shell the cascade can reach (the miss distance bounds the step) | `clBubE` |

### Field variety

| piece | model | switch |
| --- | --- | --- |
| sizes | broken power law: number density ~ D^-1.7 up to a break at 1.1 km, D^-3.2 above [4.3]; giant (>3 km) cells fall from 25 % to 7 % of the cloud area, 0.8-3 km cells carry most of it | `clField` (0 = round five) |
| clustering | darts land with a probability from a smooth tiling cluster field (patches a few km across, small cells more strongly): groups of clouds with clear gaps | `clField` |
| border taper | half as steep, up to 1.6 radii on the border (was 2 x, 1.25) | `clField` |
| congestus among humilis | 30 % of the cells above ~1 km get +0.35 development: a few towers in a field of small cumulus | `clCong` |
| streets | unchanged (weather map: rows along the wind, 2-12 km apart) | - |

### Temporal stability

* Far away, cells smaller than 3-6 low-res pixels fade out (`clFar`): a jittered coarse step hits or misses them from
  frame to frame, which was the dark "confetti" on the horizon. A non-finite march result is dropped.
* Measured with two consecutive frames of a moving, turning camera (`shots/r6-temporal.png`, harness 480x270,
  120 m/s + 2 deg/s, frames 30 / 31): mean |difference| 1.83 -> 1.64 (8-bit), speckles (pixels > 25 above their 5x5
  median difference) 469 -> 238.

### Cost

Means per ray, quality `high` (80 steps, march at 1/2 resolution), harness tour tiles 480x270, 10 frames each
(`shots/r6-cost-*.log`). Fetches = 2-D + 3-D texture fetches counted in the shader (`clCount=2`, new this round; the
round-five column is this build with every round-six switch off: `clBub=0&clLobeSh=0&clMsN=4&clTmin=0.004&clFarL=0&
clField=0&clWall=0&clCong=0&clFar=0&clVs=0&clAspLo=1&clAspHi=2&clMsBub=1`). Iterations from the real round-five build.
Wall time = whole harness frame under SwiftShader on a shared 4-CPU machine (noisy, +-10 %).

| view | loop iterations r5 -> r6 | fetches r5 -> r6 | ms / frame r5 -> r6 |
| --- | --- | --- | --- |
| scattered, 1500 m, horizontal | 36.9 -> 26.4 | 478 -> 201 | 5217 -> 5004 |
| scattered, from 6 km, 30 deg down | 24.1 -> 21.7 | 184 -> 126 | 2646 -> 2587 |
| storm, 5200 m | 45.0 -> 51.1 | 312 -> 430 (before the analytic anvil light, see below) | 2857 -> 3958 |
| scattered, 2200 m, 4 deg down | 56.4 -> 40.1 | 609 -> 271 | 3457 -> 3395 |

Where the fetches went: learned MS on 2 lit samples instead of 4 (each evaluation is 9 taps x 2 fetches), MS taps without
the bubble octave, rays stop at T = 0.01 (0.004), far-field light from the shadow map (4 fetches instead of ~16 per lit
sample beyond 40 m pixels), wider cumulus with fewer, shorter rays through them. Added: up to 4 bubble fetches per
full-density sample (replacing 1 curl + 1-3 detail fetches on growing cells), 1 per cheap-density sample in cells
(lobe self-shadowing), 4 per lit sample near the surface for the lobe orientation. The storm is the exception: its
towers now carry the cascade and its light samples the big octave. The analytic anvil light (`clAnvL`) takes
anvil samples from ~16 to 4 fetches afterwards.

Quality tiers (round six, fetches per ray in the same four views): high 201 / 126 / 430 / 271, medium 168 / 82 / 317 /
223, low 108 / 41 / 188 / 147 (low: 2 bubble octaves, far light from 25 m pixels, plus its lower step count and scale).
The wall time barely follows the fetch count under SwiftShader (the resolve, the terrain and the network's ~600 FMA
per evaluation weigh as much); on a GPU the fetches are the march's main cost.

### What still does not look real

LIMITS


## 1. Density in real units

| piece | model | switch |
| --- | --- | --- |
| liquid water | `LWC = Gamma_ad * (z - z_base) * f_ad`, Gamma_ad = 2 g m^-3 per km [1.3], adiabatic fraction 0.8 at the base falling to 0.3 at the cloud's own top, x0.45 in dissolving cells; capped at 3 g m^-3 (cumulus) and 0.45 g m^-3 for decks (2.5 in Cb cores); decks x0.5..1.5 with the shape noise (thick and thin patches) | `clLwc` (g m^-3 per km), `clLwcCap`, `clPhys=0` = round four |
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
  from 62 % of its life it frays partly (at most 45 % of the round-four decay look: soft edge, diluted skin), from
  66 % the radius shrinks to 45 % and from 70 % its water evaporates; at the wrap it has no water, so nothing pops. Selection threshold is raised by 25 % so the visible cloud
  fraction stays the same. The CPU mirror (`densityAt`) follows the same ages.
* **Wind**: air-mass advection with the wind at 35 % of the layer (unchanged), towers lean downwind with the
  base-to-top shear (now one function for the GPU and the CPU mirror), streets along the wind (unchanged).

## 3. Light (shape side)

* **Learned multiple scattering** (default; `clMs=0` = round-three nets from main.js, `scatter=classic` = analytic).
  Wired per NEURAL.md 2.1: `S = E (p_Mie e^-tauSun + forwardPeak + J_ms) + ambUp V_sky + ambDn V_gnd`, physical tauSun,
  tauCam = -log T, 9 taps of the cheap base density (`clMsSigma`). The network runs on the first `clMsN` (4; 2 since round six) lit
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
* **Anvil rings**: with an anvil the shadow-map bake spends half its steps evenly over the top 40 % of the layer, jittered per texel (the u^1.5 steps
  cut the slab with 1-3 samples, so its optical depth came in steps around every core).
* **Twilight**: see the local-vertical sun above; low clouds go into the Earth's shadow at the right time, high and
  distant sunward clouds keep their orange.

## 5. Cost (quality high, 80 steps, 1/2 res)

Per lit sample, learned MS: 9 cheap density taps (1 cell fetch + 1 base-noise fetch each = 18 fetches), ~600 FMA,
1 Mie LUT fetch per ray; only on the first 4 lit samples of a ray. Twilight light: 4 transmittance LUT fetches per ray
(was 2 atmosphere calls). Shadow bake: +1 weather fetch per texel with an anvil. No new passes, no new render targets.
