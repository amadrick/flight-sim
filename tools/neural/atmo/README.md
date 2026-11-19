# Neural air + sun: reference, validation, networks

Pipeline (numpy only; run with `OMP_NUM_THREADS=1 nice -n 10`):

| step | script | output |
|---|---|---|
| reference medium, spectra, colour | `common.py` | |
| spectral Monte Carlo path tracer | `pathtracer.py` | |
| port of the real-time LUT model | `classic.py` | |
| validation against known values | `validate.py` | `validation.json` |
| sky dataset (300 x 512 train, 12 x 512 test) | `gen_data.py train 0 300`, `gen_data.py test 0 12` | `data/` (git-ignored, checkpointed per batch) |
| near-sun aerosol column (deterministic) | `gen_aureole.py train 0 30`, `... test 0 2` | `data/` |
| sun network + limb darkening | `train_sun.py` | `data/sun_net.npz` |
| sky network | `train_sky.py 48,48` | `data/sky_net.npz` |
| export | `export.py` | `src/neural/atmo-weights.js`, `src/neural/atmo-test-vectors.json` |

## Reference

Spherical shell (R = 6371 km, 100 km atmosphere), the same medium as `src/render/atmosphere.js`: Rayleigh
13.558e-3 (550/λ)^4 /km (through the classic 680/550/440 nm values), H = 8 km; grey aerosol from the weather
visibility (Koschmieder), SSA 0.92, H = 1.2 km, realistic forward-peaked phase 0.12 HG(0.97) + 0.82 HG(0.75) +
0.06 HG(-0.3) (asymmetry 0.71; the classic Cornette-Shanks g = 0.78 has 0.83 and no diffraction peak); ozone tent
(25 ± 15 km) with Serdyuchenko cross-sections scaled to the classic peak density; Lambertian ground albedo 0.14.
30 wavelengths 385-747.5 nm, solar spectrum, CIE 1931 (multi-lobe fit) to linear sRGB. All orders of scattering:
backward paths, per-segment quadrature with next-event estimation to the sun at every node (single scattering
noise free), phase-mixture sampling, Russian roulette. Earth shadow from the geometry, finite solar disc at the
shadow edge. Not modelled: refraction, polarisation, airglow, stratospheric aerosol.

Colour normalisation: the reference is multiplied per channel by k so that the overhead sun at sea level has
exactly the classic colour (the sim's sun is white outside the atmosphere).

## Validation (fair weather, 80 km visibility, sea level)

| quantity | reference | known |
|---|---|---|
| sun normal illuminance, overhead (clear / fair) | 112.9 / 110.7 klx | ~100-110 klx (extraterrestrial 132.5 klx over the band) |
| sun CCT overhead / 30° / 10° / 5° / 2° / 0° | 5490 / 5060 / 4010 / 3200 / 2300 / 1640 K | ~5500-5800 overhead, ~4000 at 10°, ~2000 at the horizon (refraction ignored) |
| global horizontal illuminance, sun 90° / 60° / 30° | 123 / 105 / 56 klx | ~120 / ~100 / ~55 klx clear sky |
| diffuse sky illuminance, sun 60° | 11.5 klx | 10-20 klx |
| zenith luminance, sun 60° / 30° / 10° | 2690 / 1340 / 810 cd/m² | 2-6 kcd/m² at high sun (Preetham T=2 formula 5.9k) |
| horizontal illuminance, sun 0° / -2° / -4° / -6° | 1022 / 310 / 55 / 7.0 lx | ~700 / ~300 / ~40 / 3.4 lx |
| horizontal illuminance, sun -8° / -10° / -12° / -15° / -18° | 0.76 / 0.093 / 0.013 / 1.1e-3 / 4e-5 lx | ~0.5 / ~0.08 / 0.008 / ~1e-3 / (starlight 6e-4) |
| zenith luminance, sun -6° | 0.85 cd/m² | ~1-3 cd/m² |

Twilight falls by 5 orders of magnitude between 0 and -12°, as it should. Single scattering is 70-80 % of the
zenith radiance by day and vanishes below -9° (the zenith ray is then fully in the Earth's shadow).

Sun colour (Rayleigh + ozone only, sea level): CCT reference / network / classic three-wavelength

| elevation | 90° | 30° | 10° | 5° | 2° | 1° |
|---|---|---|---|---|---|---|
| reference | 5488 | 5061 | 4014 | 3195 | 2304 | 1927 |
| sun network | 5490 | 5061 | 4014 | 3197 | 2302 | 1938 |
| classic | 5488 | 4934 | 3650 | 2750 | 1922 | 1672 |

The classic sun is 350-450 K too warm (too red) between 2 and 10°.

## Networks (held-out errors)

**Sun** `2 -> 24 -> 24 -> 3` (747 params): ln rgb of the band-integrated Rayleigh + ozone transmittance from the
two column amounts. Held-out colour error |rgb - ref| / max(ref) < 1 % (max 0.98 %, where the sun keeps > 1 %),
classic three-wavelength: up to 4x. Limb darkening (Eddington-Barbier, grey atmosphere, band-integrated):
u = 0.605 / 0.673 / 0.770 (classic hand-set 0.44 / 0.58 / 0.74).

**Sky** `6 -> 48 -> 48 -> 6` (2982 params): inputs sun elevation, view elevation above the dipped horizon,
cos azimuth from the sun, altitude (0-26 km), aerosol extinction (0.018-0.1 /km, i.e. clear to broken), cos angle
to the sun; outputs ln R (reference without the diffraction lobe / classic LUT sky) and ln Cm (aerosol column for
the aureole). Train 153 600 + 112 027 samples, test 6144 (64 paths, 192 in twilight) + 7446. RMS of ln rgb sky
radiance against the reference (includes the test set's own Monte Carlo noise):

| sun elevation | classic | neural | chroma classic | chroma neural |
|---|---|---|---|---|
| > 15° | 0.108 | 0.060 | 0.079 | 0.033 |
| 0..15° | 0.115 | 0.072 | 0.083 | 0.040 |
| -6..0° | 0.413 | 0.168 | 0.301 | 0.083 |
| -12..-6° | 0.952 | 0.892 | 0.588 | 0.354 |

Aureole column within 25° of the sun: RMS ln 0.147 (p99 0.34). In -12..-6° the luminance is not better than the
classic (reference noise dominated); the runtime fades the correction out between -7° and -11°, where the sky is
anyway 1e-4 of the sim's artistic airglow. Above 20° sun elevation the correction is eased out (zero above 45°) so
the tuned noon sky does not change: the reference noon sky is less saturated with a whiter horizon, which the
brief ruled out.
