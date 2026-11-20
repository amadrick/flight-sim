# Crashes and explosions

What happens on screen, in the speakers and under the hood when an aircraft hits something, and where the neural
network comes in. Code: `src/effects/crash/`, `src/effects/explosion.js`, `src/effects/decals.js`,
`src/effects/debris.js`, `src/neural/fireball*.js`; offline tooling: `tools/neural/fireball/`.

## 1. Sequence

`crash {reason}` from physics (and `crash:impact` for a wreck that falls after an in-flight breakup) →
`createCrashFx().onCrash()` → `classifyCrash()` (pure, node-tested) → per-class effects → `crash:fx` event for the
camera and audio.

| class | when (impact state) | what you see |
|---|---|---|
| `belly` | gear up, sink < 6.5 m/s | long slide (v²/2µg, µ 0.33 pavement / 0.6 grass), scrape decals, a rooster tail of sparks on pavement (150 + 7·v per s), a trail of grey abrasion smoke / dust that lingers 7–15 s and drifts, panels torn off at first contact, dust + turf gouges on grass, no fire |
| `gearCollapse` | gear down, sink < 6.5 m/s | shorter slide, sparks, skid marks; a small fuel fire (and a small fireball) when the wreck stops if it was hard (sink > 4.5 or > 75 m/s) |
| `breakup` | sink 6.5–15 m/s, or a wingtip/nose dig-in at speed | airframe hidden, tumbling pieces with smoke/fire trails, medium fireball (22 % of the fuel), crater, ground fire |
| `impact` | sink > 15 m/s, steep at speed, or mountain at > 60 m/s | full fireball (55 % of the fuel), crater + scorch, ejecta, shock dust ring, debris spray, pool fire, embers |
| `ditch` | water, low energy | spray sheet and wake while sliding, foam decals, no fire |
| `waterImpact` | water, high energy | spray column + ring, debris, foam, no fireball |
| `airburst` | `structural` failure > 25 m AGL | airborne fireball that drifts and disperses; secondary fire where the wreck lands |

Fireball size follows the Roberts / HSE correlation for a hydrocarbon fireball, D = 5.8·m^(1/3) m (m = burning
fuel in kg), so a 1 760 kg burn (F-16 with 3.2 t of fuel, `impact`) gives D ≈ 70 m. Everything about the fireball
runs in Froude units: length D, time t* = √(D/g) (≈ 2.7 s for D = 70 m).

## 2. The neural part

**What is expensive.** The shape of a fuel fireball over its first minute (ignition, buoyant lift-off, the
toroidal roll-up into a mushroom, the soot stem, the bend-over in a sheared wind) is a reacting, non-Boussinesq
3-D flow. Solving it in the browser is out of the question.

**Offline solver** (`tools/neural/fireball/sim.py`, numpy + numba): 104×26×72 cells at 0.1 D on a half domain
(mirror at y = 0), spectral pressure projection with a heat-release dilatation (∇·u = q̇/(1+θ)), non-Boussinesq
buoyancy θ/(1+θ), mixing-limited fuel–air combustion (stoichiometric s = 14.8), soot yield / oxidation, radiative
cooling, an evaporating pool fire, vorticity confinement, a 1/7 power-law wind with shear, an eddy diffusivity
(Smagorinsky-like), semi-Lagrangian RK2 advection. Conditioning: Fw = U_wind/√(gD) ∈ [0, 1.2] and the horizontal
impact momentum Ui = 0.4·|v_h·ŵ|/√(gD) ∈ [0, 2.5]. 48 runs on a space-filling design, 0 … 20 t*, 26 saved times;
about 5 min per run on one core.

**Network** (`train.py`): a coordinate MLP, f(x, y, z, t, Fw, Ui) → (log soot, log θ, log burning rate).
Inputs: position with 3-octave sin/cos features per axis, log-time τ = ln(1 + t/0.25) with 2 octaves, the two
conditions — 28 features. 28 → 64 → 64 → 64 → 3, tanh, **10 371 parameters (57 kB as base64 float32)**. Trained
on 7 000 samples per (run, time), two thirds in active cells, on 42 runs; 6 runs held out entirely.

**Held-out error** (6 unseen simulations, every saved time; `tools/neural/fireball/results/eval.json`):

| | soot | temperature θ | burning |
|---|---|---|---|
| relative L2, all times | **9.1 %** | **9.7 %** | 21.7 % |
| relative L2, 1–10 t* | 4–5 % | 4–5 % | 13–23 % |
| relative L2, first 0.1 t* / last 4 t* | 15 % / 18 % | 12 % / 17 % | 41 % / 20 % |
| Gaussian-blob baseline fitted to the same moments | 52 % | 61 % | — |

Moment errors (mean |error|, in D, against the mean value): soot centroid height 0.18 (of 1.7), downwind
centroid 0.21 (of 2.1), cloud top 0.07 (of 3.4); hot volume 4 %, peak θ 5 %, total soot 4 %.
Side-by-sides (simulation on top, network below, t = 0.17 … 20 t*): `tools/neural/fireball/results/side_run*.png`.

**What it learned, honestly.** It reproduces the mean evolution well: ignition kernel, lift-off at 2–4 t*, the
cap rising at the right rate, the stem, and how wind bends it over and stretches it downwind, all as smooth
functions of Fw and Ui. It does *not* reproduce individual eddies: the simulation's late-time puffs come out as a
smooth envelope (that is most of the 18 % late error), and the 0.1 D grid itself cannot resolve the fine soot
filaments a real fireball shows. All small-scale structure on screen (cauliflower billows, cracks of flame in the
soot) is procedural noise modulated by the network's fields. The solver is a reduced model (one-step chemistry,
grey soot, no radiation transport) — "physically shaped" rather than validated against a real fuel fire beyond the
D and duration correlation it is scaled to.

**Runtime role** (`src/neural/fireball.js` JS reference, GLSL twin generated from the same packed weights,
test vectors from Python in `fireball-test-vectors.json`, tests in `fireball.test.js`):
1. *Bake*: the network is evaluated on the GPU into a 40×16×40 RGBA16F 3-D texture over a learned time-dependent
   box (one fullscreen draw per slice). Re-baked when log-time moved by 0.02 (≈ 30 bakes over the first minute,
   fewer later) or the sun/moon moved.
2. *Light bake*: a second 3-D texture with transmittance toward the sun/moon, sky visibility and transmittance
   toward the fire (self-shadowing of the fire's own light on its smoke).
3. *March*: a box drawn on the POST layer ray-marches the baked fields (18–56 steps by quality), with domain warp
   and 3-octave turbulence, blackbody emission (Wien) from θ and the burning rate (flame ≥ 1 380 K), single
   scattering of sun/moon with an HG phase, sky and ground ambient, fire light, soot albedo ageing 0.16 → 0.34.
   Output goes through `fxFinish` (aerial perspective, night grade); emission is soft-limited against exposure so
   the HDR bloom of the POST path carries the glow without blowing out.
4. *Probe*: the CPU runs the same network at 32 points per bake for the hottest temperature and the emission
   centroid; they drive the shared fx `PointLight` (colour from the blackbody, power ∝ D²) that lights the
   ground, the airframe and the scenery. After lift-off the light moves down to the pool fire.

Retrain: `cd tools/neural/fireball; .venv/bin/python sim.py --batch 0:48 --stride 2 --out data` (two processes:
`--batch 0:48 --stride 2` and `--batch 1:48 --stride 2`), then `train.py sample`, `train.py fit --epochs 30`,
`train.py eval`, `train.py export` (writes the weights and test vectors), then `npm test`.

## 3. The rest of the crash

* **Debris** (`debris.js`): nose, centre, aft fuselage, wings, fin, engines, panels in the airframe's own paint,
  ballistic with drag, tumbling, bounces and friction, splash and sink on water; smoke/fire trails while flying,
  heat glow (emissive) and soot darkening, burning where they come to rest.
* **Decals** (`decals.js`): deferred projected decals (position reconstructed from the depth buffer, one instanced
  draw, 768 slots): scorch, crater, scrape, turf gouge, foam, skid. They fade slowly; rebased with the floating origin.
* **Particles** (existing GPU particle system): flash, sparks, ejecta, shock dust ring, spray column and ring, wake,
  ground fire flames, the long smoke column (long-lived smoke ring buffer) and night embers.
* **Ground fire**: flames, smoke and embers for 60–120 s; crackle audio.
* **Fire light** (`explosion.js` `LIGHT_K`, `crash/index.js` `light()`): the fx point light carries the fireball's
  visible radiant intensity, ≈ probe power × D² × 4 (≈ 6·10⁴ at the peak of a 70 m fireball, ~10⁴ from the pool fire
  afterwards; the sun is 4 in scene units), so ground, airframes and scenery a few hundred metres away are lit.
* **Air glow** (`crash/glow.js`): single scattering of that light by the haze, closed-form line integral
  σ·p·I/b·[atan] per pixel up to the scene depth (σ from the visibility, isotropic + HG 0.5 phase). At night it is the
  orange dome over the fire; by day it is far below the sky radiance and vanishes without any special casing.
* **Fire-light sheen** (`decals.js` type `FIRELIGHT`): the engine's ground is rough-diffuse, so a fire low on the
  horizon lit the runway only at grazing incidence and it stayed black. One large deferred decal adds a GGX
  (roughness 0.55, F0 0.04) reflection of the fx light plus a little near-field wrap for the fire's size: the orange
  sheen on pavement under a fire in night footage.
* **Camera** (`src/camera/index.js`): on `crash:fx`, the post-crash orbit camera centres between the wreck and the
  fireball and backs off to 1.7 D + 30 m; shake arrives after distance / 340 m/s and falls off with distance.
* **Audio** (`src/audio/index.js`): crunch and scrape for slides, explosion for fire classes, boom on the low bus for
  impact/airburst, all delayed by distance / 340 m/s; fire crackle for two minutes, distance-attenuated.
* Nothing depicts the crew.

## 4. Costs

| item | cost |
|---|---|
| boot warm-up (`effects.stats().crash.warmMs`) | programs compiled + one bake at boot (≈ 70 ms in headless SwiftShader; a few ms on a GPU) — no stall on the first crash |
| bake | 25 600 texels × ~10 400 MAC; ~1–2 ms on a laptop GPU; adaptive, typically every 3–10 frames early, rarely after 20 s |
| light bake | 25 600 texels × 21 field fetches |
| march | 18–56 steps × 5 texture fetches per covered pixel; only the fireball's screen footprint |
| memory | 2 fireballs × 2 × 40×16×40 RGBA16F = 0.8 MB; weights 57 kB in the bundle |
| decals | 1 draw, 768 instances (incl. the fire-light sheen: GGX per covered ground pixel within 400 m of the fire) |
| air glow | 1 draw (sphere, back faces) over its footprint, ~40 ALU per pixel, no texture fetch except the depth |
| debris | ≤ 7 large + 14 small meshes (small ones × quality) for the life of the wreck |

Quality: `ctx.quality.particles` scales the march steps, particle spawn rates and the number of small debris pieces.

## 5. Switches

| param | effect |
|---|---|
| `crash=classic` | the previous crash: particle explosion + wreck fire, old explosion sound, no classification |
| `crashtest=<belly\|collapse\|breakup\|impact\|fireball\|mountain\|ditch\|water\|airburst>` | deterministic synthetic crash ahead of the camera |
| `crashdist=<m>` `crashlat=<m>` `crashside=1` `crashat=<frame>` | where / when the test crash happens |
| `crashrate=<x>` | sim rate once the test crash starts (main.js clamps a frame to 0.1 s; long shots) |
| `fxcam=crash` (`fxdist=<m>` `fxcamh=<m>` `fxcamk=<m>`) | spectator camera: fixed point beside the crash (distance / height / offset along the heading), looking at the fire or the sliding wreck; hides the parked player in `crashtest` shots |
| `fxglow=0` | no air glow |
| `crashdive=1` | push the stick forward until the aircraft hits the ground (real physics crash) |
| `fbtemp=<k>` `fbemis=<k>` | fireball temperature / emission scale |
| `fbbake=<dlogt>` | re-bake threshold |
| `fboff=1` | hide the fireball volume |
| `fbdbg=1..5` | fireball debug views (fields, light, NaN check) |

## 6. Not yet real

* No heat shimmer: the POST layer cannot sample the scene colour, so refraction above the fire needs a pipeline
  hook (a distortion pass after the opaque pass).
* The network has no input for impact direction relative to the wind; Ui uses the along-wind component only.
* Past 20 t* (≈ 55 s for D = 70 m) the field is frozen and the cloud is carried by the wind; the long smoke column
  after that is particles.
* Fine structure is noise, not simulation; up close (< 0.5 D) the billows repeat.
* Debris are rigid primitives in the airframe colour, not pieces of the actual model.
* Water impacts have no steam and no burning slick.
* Clouds are not lit by the fire (the cloud renderer does not read the fx light); the air glow stands in below them.
* A real belly slide of the player shows sparks, smoke, scrape decals and shed panels, but the player's own airframe
  is not deformed (the synthetic `crashtest=belly` ghost lies on its belly with the gear hidden and a list).
* The smoke column without wind is a rising dome; it leans only as much as the weather wind gives it.

## 7. Frame cost

Headless SwiftShader (software GL, 640×360, machine shared with other renders) takes ≈ 8 s per frame for the whole
scene; 10-frame averages before the crash, 1 s into it and 7 s into it were 8.23 / 8.16 / 7.71 s, i.e. the crash
is inside the noise there and cannot be timed this way. Estimated GPU cost from the work done: bake 25 600 texels ×
~10 400 MAC + light bake (≈ 1–2 ms on a laptop GPU, only in bake frames: every few frames in the first seconds,
rarely after 20 s); march 18–56 steps × 6 fetches over the fireball's footprint (≈ 0.5–1.5 ms at 1080p when it
fills a third of the screen); air glow ≈ 40 ALU per covered pixel, no fetch but depth (< 0.2 ms); fire-light sheen
a GGX evaluation per ground pixel within 400 m (< 0.2 ms); particles / debris unchanged. Zero cost when no crash is live.

## 8. Shots

`node tools/neural/fireball/crashseq.mjs --params "tod=23&crashtest=fireball&crashdist=300&fxcam=crash&crashat=4" \
  --times 0.5,2,8 --prefix shots/crashfinal-night_impact` (also `--html <file>` to shoot a frozen build while
others rebuild `dist/`). The `shots/crashfinal-*` set: day / night runway impact at 0.5, 2, 8 s, belly slide, water.
