# Clouds: research compendium (physics, optics, rendering, morphology)

Reference for the cloud engineers. Units are SI unless stated: extinction in 1/m, LWC in g/m^3, radii in micrometres (um).

**Source tags.** `[V]` means I fetched and checked the source in this research pass (Nov 2026). `[K]` means a standard
textbook or literature value, cited to its primary source but not re-fetched in this pass: treat it as reliable but check
before you depend on a specific digit. `[UNVERIFIED]` means my best recollection with no source I could confirm, so use it
as a starting value only.

**Shader notes.** Each item ends with a `-> shader:` line on how to use it in the real-time march.

Context: the game already has (src/clouds/shaders.js, src/neural/cloud-light.js) a single-scatter + octave multiple
scattering term, a powder term, neural J/V LUTs fed by (tauSun, tauUp, cosTheta), a two-stream fallback with g = 0.864,
and a life-cycle phase per cell. The numbers below are meant to calibrate those inputs, not to replace the architecture.

---

## 0. The ten numbers to know (cheat sheet)

| Quantity | Value | Source |
|---|---|---|
| Extinction from microphysics | beta = 3 LWC / (2 rho_w r_e) (geometric-optics limit, Q_ext ~ 2) | Stephens 1978 [K] https://doi.org/10.1175/1520-0469(1978)035<2123:RPIEWC>2.0.CO;2 |
| Typical cumulus extinction | 0.03 to 0.15 1/m (mean free path 7 to 30 m) | derived below |
| Fog extinction | 0.004 to 0.04 1/m (visibility 3.9/beta: 100 m to 1 km) | Koschmieder, WMO fog def. < 1 km [K] |
| Asymmetry parameter, water droplets, visible | g = 0.85 to 0.87 | Hansen & Travis 1974 [K] https://doi.org/10.1007/BF00168069 |
| Asymmetry parameter, ice crystals | g = 0.73 to 0.80 (rough/aggregates lower, pristine columns higher) | Yang et al. 2013 [K] https://doi.org/10.1175/JAS-D-12-039.1 |
| Single-scattering albedo, visible | 0.99999+ (co-albedo 1e-6 to 1e-5 at 550 nm) | Hale & Querry 1973 water n,k [K] https://doi.org/10.1364/AO.12.000555 |
| Effective radius | maritime Cu/Sc 10 to 15 um, continental 5 to 8 um, fog 3 to 10 um, cirrus ice 20 to 60 um | see 1.2 |
| Adiabatic LWC gradient | ~1.5 to 2.5 g/m^3 per km (warm bases), ~1 g/m^3/km at 0 C | see 1.3 |
| Cloud base (LCL) | z_LCL ~ 125 m per K of dew-point depression (T - T_d) | Lawrence 2005 [K] https://doi.org/10.1175/BAMS-86-2-225 |
| Cloud perimeter fractal dimension | D ~ 1.35 (area-perimeter, 1 to 1000 km) | Lovejoy 1982 [K] https://doi.org/10.1126/science.216.4542.185 |

---

## 1. Microphysics

### 1.1 Droplet size distributions

Two forms are used in practice:

* **Modified gamma** (Hansen & Travis 1974; Deirmendjian 1969), written with effective radius r_e and effective variance v_e:
  `n(r) = C * r^((1-3 v_e)/v_e) * exp(-r / (r_e v_e))`.
  Cloud values: v_e ~ 0.1 (narrow, continental, young) to 0.2 (broad, maritime, drizzling). The classic "C1" cumulus
  model of Deirmendjian has r_mode = 4 um and r_e ~ 6 um. [K] https://doi.org/10.1007/BF00168069
* **Lognormal**: `n(r) = N / (sqrt(2 pi) ln(sigma_g) r) * exp(-ln^2(r/r_m) / (2 ln^2 sigma_g))`, where
  r_e = r_m * exp(2.5 ln^2 sigma_g). In stratus the median radius is 1 to 10 um and the geometric standard deviation
  sigma_g is 1.2 to 2.2 (Miles et al. 2000, quoted by Kato et al. 2001). [V] https://kcg.chpc.utah.edu/group_page/jas20011001.pdf
  The Jendersie & d'Eon Mie fit (section 2.2) assumes a lognormal in **diameter** with a log-standard deviation of 0.25. [V]

**Effective radius definition:** r_e = <r^3> / <r^2> (ratio of third to second moment). It sets the optics, because
extinction scales with total cross-section (r^2) and water mass with r^3.

**Relation to volume-mean radius:** r_v^3 = k r_e^3, with k = 0.67 +/- 0.07 for maritime and 0.80 +/- 0.07 for
continental air masses (Martin, Johnson & Spice 1994). [K] https://doi.org/10.1175/1520-0469(1994)051<1823:TMAPOE>2.0.CO;2
That gives `r_e = (3 LWC / (4 pi rho_w k N))^(1/3)`.

-> shader: no shader needs a distribution, only r_e (or droplet diameter d = 2 r_e) per cloud type, which feeds the phase function
fit (2.2) and extinction (1.5). Store r_e per weather preset or per genus in the weather texture. If you want variety,
let r_e grow with height above base: r_e ∝ (z - z_base)^(1/3) (adiabatic, N constant), from ~4 um at base to the
values in the table at the top.

### 1.2 Number concentration and effective radius by cloud type

| Cloud type | N (cm^-3) | r_e (um) | LWC typical / max (g/m^3) | Notes / source |
|---|---|---|---|---|
| Maritime cumulus (trade Cu) | 50 to 150 | 10 to 16 (top), drizzle above r_e ~ 14 | 0.2 to 0.5 / 1.0 | RICO obs. N ~ 70 [K] https://arxiv.org/pdf/1205.3313 ; Freud & Rosenfeld 2012 drizzle threshold r_e ~ 14 um [K] https://doi.org/10.1029/2011JD016457 |
| Continental cumulus | 300 to 1000 (polluted 1000 to 3000) | 5 to 8 | 0.3 to 1.0 / 2.5 | Squires 1958, Pruppacher & Klett ch. 2 [K] |
| Maritime stratocumulus | 40 to 150 | 9 to 14 | 0.1 to 0.5 | Martin et al. 1994 [K]; Miles et al. 2000 [K] |
| Continental stratus / Sc | 200 to 600 | 5 to 7 (mean 5.4 for continental stratus) | 0.1 to 0.4 | Miles et al. 2000 via Kato 2001 [V] |
| Cumulonimbus (liquid part) | 200 to 1000 | 10 to 15 + rain | 1 to 3 (cores 4+) | Wikipedia LWC table, from Thompson 2007 [V] https://en.wikipedia.org/wiki/Liquid_water_content |
| Fog (radiation) | 50 to 500 | 3 to 10 | 0.02 to 0.2 (0.05 typical) | Gultepe et al. 2007 [K] https://doi.org/10.1007/s00024-007-0211-x |
| Altocumulus / altostratus (supercooled) | 50 to 300 | 5 to 10 | 0.05 to 0.3 | [K] Pruppacher & Klett |
| Cirrus (ice) | 0.01 to 1 crystals/cm^3 (10 to 1000 per litre) | 15 to 60 (effective), long dimension 100 um to 1 mm | IWC 0.001 to 0.1 (0.03 typical) | Heymsfield & McFarquhar 2002 [K]; LWC table 0.03 [V] |

The LWC table from Wikipedia (Thompson 2007) lists cirrus 0.03, fog 0.05, stratus 0.25 to 0.30, cumulus 0.25 to 0.30,
stratocumulus 0.45 and cumulonimbus 1.0 to 3.0 g/m^3. [V] https://en.wikipedia.org/wiki/Liquid_water_content

-> shader: these give extinction per type via 1.5. Maritime clouds look softer and more translucent, with a more
noticeable silver lining, because r_e is larger. Continental clouds look denser and harder, because beta is higher at
the same LWC.

### 1.3 Vertical profile of LWC (adiabatic and sub-adiabatic)

* **Adiabatic LWC rises linearly above base:** LWC_ad(z) = Gamma_ad * (z - z_base), where Gamma_ad = rho_air * (c_p/L_v)(Gamma_d - Gamma_s)
  depends on base temperature and pressure (formula: Curry & Webster ch. 6.5, as quoted in the Warsaw University cloud physics
  course notes [V] https://www.igf.fuw.edu.pl/en/courses/d/7ZLY5MFPN4LGKAWSLQXZEKDPIH6WI47MDQB7XDQ4MHWUZELURTHA/adiabaticlwc.pdf).
  I integrated a moist adiabat numerically (Bolton e_s, mean gradient over the first km above base) [derived]:

  | Base T | 950 hPa | 850 hPa | 700 hPa |
  |---|---|---|---|
  | +20 C | 2.2 g/m^3/km | 2.05 | 1.8 |
  | +10 C | 1.85 | 1.75 | 1.55 |
  | 0 C | 1.35 | 1.3 | 1.2 |
  | -10 C | 0.85 | 0.85 | 0.8 |

  Liquid water path is then LWP = 0.5 Gamma_ad H^2 for a cloud of depth H (1 km Cu: ~900 g/m^2 adiabatic, ~300-500 real).
* **Sub-adiabatic factor** f_ad = LWC_obs / LWC_ad. It is 0.6 to 0.9 in stratocumulus (nearly adiabatic) and 0.2 to 0.5 averaged over
  cumulus, and it falls with height in Cu as entrainment accumulates (Warner 1955; Gerber 2000). Cumulus cores near the
  base can be close to adiabatic. [K] https://doi.org/10.1175/1520-0469(1955)012<0436:TWCOCC>2.0.CO;2
* **Horizontal profile in a cumulus:** a near-adiabatic core and diluted edges. The LWC falls to 0 over the outer
  50 to 200 m, and the transition is patchy because entrainment is inhomogeneous: holes and filaments, not a smooth gradient.
  N stays roughly constant while LWC drops (inhomogeneous mixing removes droplets). [K] Burnet & Brenguier 2007 https://doi.org/10.1175/JAS3920.1
* **Stratocumulus:** LWC rises linearly to a maximum about 20 to 50 m below the top, then drops sharply in the
  entrainment interface layer, which is tens of metres thick. [K]

Worked numbers: fair-weather Cu of 1 km depth, Gamma_ad = 2 g/m^3/km, f_ad = 0.5, so LWC at top ~ 1 g/m^3 x 0.5 = 0.5 g/m^3.

-> shader: density(z) inside a cumulus should **increase with height above base**, roughly linearly, to ~70-90% of
cloud height, then fall off in the turret top. Most procedural cloud systems do the opposite (dense base, wispy top).
Bases should still look sharp: the LCL gives a crisp flat edge, but density just above the base is *low*, so bases are
less opaque per metre and the top half dominates optical depth. Multiply the edge density by a dilution term
`(1 - edgeFactor)` driven by distance-to-envelope, with noise-modulated holes rather than a smooth fade.

### 1.4 Ice, mixed phase, precipitation

* **Cirrus crystals:** bullet rosettes, columns, plates and aggregates. Sizes range from 10 um to over 1 mm. Fall speeds are
  0.1 to 1 m/s for large crystals, which together with wind shear makes fall streaks (cirrus uncinus "hooks"). [K]
  Heymsfield & Iaquinta 2000 https://doi.org/10.1175/1520-0469(2000)057<0916:CCTV>2.0.CO;2
* **Ice optical depth:** visible tau for cirrus is 0.03 to 3. Subvisual cirrus has tau < 0.03 and thin cirrus tau < 0.3
  (Sassen & Cho 1992). [K] https://doi.org/10.1175/1520-0450(1992)031<1275:STCLDF>2.0.CO;2
  Ice extinction is beta = 3 IWC / (2 rho_i r_e) with rho_i = 917 kg/m^3. For IWC 0.01 g/m^3 and r_e 30 um,
  beta ~ 5e-4 1/m (0.5 per km), so a 2 km layer gives tau ~ 1.
* **Mixed phase (-38 to 0 C):** supercooled liquid is common down to -20 C (Ac/As/Sc tops are often liquid). The
  Wegener-Bergeron-Findeisen process glaciates clouds once ice appears, and glaciated tops look *fibrous and soft* instead of
  crisp (the "anvil" or "calvus to capillatus" transition in Cb). Homogeneous freezing happens at -38 C. [K] Korolev et al. 2017
  https://doi.org/10.1175/AMSMONOGRAPHS-D-17-0001.1
* **Rain:** drops of 0.1 to 5 mm, Marshall-Palmer distribution N(D) = N0 exp(-Lambda D), N0 = 8000 m^-3 mm^-1,
  Lambda = 4.1 R^-0.21 mm^-1 (R in mm/h). [K] https://doi.org/10.1175/1520-0469(1948)005<0165:TDORWS>2.0.CO;2
  Rain visible extinction in geometric optics is beta = (pi/2) ∫ N(D) D^2 dD = pi N0 / Lambda^3. That gives
  ~0.36/km at R = 1 mm/h, ~1.6/km at 10 mm/h and ~4.3/km at 50 mm/h (computed from MP; so visibility 3.9/beta is ~11 km, 2.5 km
  and 0.9 km; drop spectra in Cb downpours deviate from MP). [derived]
  Rain is *much less extinguishing per gram* than cloud (r_e ~ 0.5 to 1 mm vs 10 um, so 50 to 100x less per unit water).
  Rain shafts look like translucent grey curtains, not opaque columns.
* **Virga:** precipitation evaporating before it reaches the ground, typical below high-based Ac/Cu in dry air (bases 3 to 5 km,
  dew-point depression > 15 K). It shows as hanging streaks, often curved by shear, fading out downward. [K] https://cloudatlas.wmo.int/en/virga.html

-> shader: rain shafts get their own low extinction (~4e-4 to 4e-3 1/m, from the rain rate as above) with a phase function of g ~ 0.88 (big drops,
strong forward peak, plus a rainbow at 138 deg scattering angle). Let them hang from bases, tilt them with the shear
vector, and fade them with exp(-(z_base - z)/H_evap) where H_evap ~ 500 m (dry) to infinity (saturated).

### 1.5 Extinction, optical depth, albedo per type

`beta_ext = (3/2) * LWC / (rho_w * r_e)` (LWC in kg/m^3, r_e in m, rho_w = 1000 kg/m^3), from Q_ext ~ 2
(Stephens 1978). [K] Equivalently, tau = (3/2) LWP / (rho_w r_e) for vertically uniform r_e. For an adiabatic cloud,
tau = (9/5) LWP / (rho_w r_e,top) (Szczodrak et al. 2001). [K] https://doi.org/10.1175/1520-0469(2001)058<2912:VOCEBO>2.0.CO;2

| Type | LWC (g/m^3) | r_e (um) | beta (1/m) | mean free path | typical tau (vertical) |
|---|---|---|---|---|---|
| Fog | 0.05 | 6 | 0.0125 | 80 m | 1 to 10 |
| Fair-weather Cu (maritime) | 0.3 | 12 | 0.0375 | 27 m | 5 to 30 |
| Fair-weather Cu (continental) | 0.4 | 7 | 0.086 | 12 m | 10 to 60 |
| Stratocumulus | 0.3 | 10 | 0.045 | 22 m | 5 to 20 |
| Stratus | 0.25 | 7 | 0.054 | 19 m | 5 to 30 |
| Cumulus congestus | 0.8 | 10 | 0.12 | 8 m | 50 to 150 |
| Cumulonimbus core | 2.0 | 12 | 0.25 | 4 m | 100 to 400+ |
| Altostratus / nimbostratus | 0.2 / 0.5 | 8 / 10 | 0.04 / 0.075 | 25 / 13 m | 10 to 100 |
| Cirrus | IWC 0.01 | 30 (ice) | 0.0005 | 2 km | 0.03 to 3 |

(beta computed from the formula. Ranges of tau are from ISCCP-style classification, where tau 3.6 to 23 is "middle" and
> 23 "thick" [K] https://isccp.giss.nasa.gov/cloudtypes.html.)

### 1.6 Single-scattering albedo by wavelength; why clouds are white, and why bases go grey or blue

* Liquid water imaginary refractive index (Hale & Querry 1973) is about 1e-9 at 450 nm, 2e-9 at 550 nm and 1.6e-8 at 700 nm.
  It jumps to ~1e-4 at 1.6 um and 2.5e-4 near 2.1 um. [K] https://doi.org/10.1364/AO.12.000555
* Co-albedo is 1 - omega_0 ~ (approximately) 0.85 * (4 pi k / lambda) * 2 r_e * ... (geometric-optics absorption); for r_e = 10 um:
  ~2e-7 (450 nm), ~5e-7 (550 nm), ~3e-6 (700 nm), ~0.01 (1.6 um). [UNVERIFIED exact digits; the order of magnitude and
  the red > green > blue ordering are standard; see Bohren & Clothiaux 2006, ch. 5]
* **White:** visible absorption is negligible and Mie scattering by 10 um droplets is almost wavelength-independent
  (size parameter x = 2 pi r / lambda ~ 100). So the reflected spectrum equals the incident spectrum. [K] Bohren & Clothiaux,
  *Fundamentals of Atmospheric Radiation*, 2006.
* **Grey bases:** the cause is *mostly* geometry, not absorption: little light gets transmitted through tau 50+
  (T = 2/(2 + (1-g)tau) ~ 20% for tau = 50, g = 0.85; see 2.5), and that light is diffuse. Bases look grey because they are dim
  against a bright sky (contrast), not because they are a grey material. [K] Bohren "Clouds in a glass of beer" (1987).
* **Blue/green tint in very thick clouds (Cb):** light diffusing through tau of hundreds makes N ~ (1-g) tau^2
  scatterings (thousands). The path length becomes kilometres of water-laden air, so the slight red absorption of liquid
  water plus ice turns transmitted and deep-reflected light faintly blue-green. Green thunderstorms combine this with
  reddened (sunset) illumination. Bohren & Fraser 1993. [K] https://doi.org/10.1175/1520-0477(1993)074<2185:GT>2.0.CO;2
* Rough per-colour co-albedo to use for the spectral tint of deep paths: 1 - omega ~ (3e-6, 6e-7, 3e-7) for (R, G, B)
  [UNVERIFIED, derived from the k values above]. With N ~ 2000 scatterings, the transmitted R/G/B ratio is
  ~ exp(-N (1-w)) = (0.994, 0.999, 0.9994), which is tiny. **The real blue in cloud bases is mostly skylight fill**
  (blue sky illuminating the cloud's sides and underside) **plus aerial perspective between viewer and cloud.**

-> shader: keep omega_0 = 1 (or 0.9999) in the visible. Get grey bases from correct transmission plus a **blue
ambient term from the sky dome** and a **warm/green-brown ground bounce term from below** (section 2.6). Only add a spectral
absorption tint when tau_path > 100 (Cb cores), as a mild per-channel extinction offset of
`sigma_a = beta * (3e-6, 6e-7, 3e-7) * N_eff`. That is effectively a slight cyan shift deep in storm cores.

---

## 2. Optics

### 2.1 The Mie phase function of cloud droplets: features and angles

For r_e ~ 5 to 15 um at visible wavelengths (size parameter 60 to 170), the phase function has:

| Feature | Scattering angle theta | Strength / width | Visual | Source |
|---|---|---|---|---|
| Diffraction peak | 0 deg, width ~ lambda/(2 r) ~ 1-3 deg | p(0) ~ 1e3 to 1e4 sr^-1 times isotropic; ~50% of scattered energy within a few degrees | silver lining, glare around the sun through thin cloud | Bohren & Huffman 1983 [K] |
| Corona | 1 to 10 deg rings around sun/moon | ring radius ∝ lambda/r: first red ring at ~ 0.6 * lambda / r rad (~2.5 deg for r = 8 um) | coloured rings round the moon through thin Ac/Cs; small *uniform* drops required | Les Cowley, atoptics [K] https://atoptics.co.uk/droplets/corona.htm |
| Iridescence | 10 to 30 deg from sun | pastel pinks and greens on thin, young cloud edges (lenticulars, pileus) | | atoptics [K] https://atoptics.co.uk/droplets/irid1.htm |
| Side-scatter minimum | ~ 90 to 120 deg | ~0.03 to 0.05 sr^-1 (lowest) | | Mie [K] |
| Cloudbow / fogbow | 138 deg scattering (= 42 deg from antisolar point); for small drops broad, white, radius ~ 33 to 41 deg | 1.5 to 2x the side minimum | white arc opposite the sun | atoptics fogbow [K] https://atoptics.co.uk/droplets/fogbow.htm |
| Glory | 180 deg, rings out to ~ 2 to 5 deg | backscatter rise to ~0.2 to 1 sr^-1 at 180 deg | coloured rings round the aircraft shadow on cloud below: **very relevant for a flight sim** | atoptics [K] https://atoptics.co.uk/droplets/glory.htm |

Asymmetry parameter g = 0.85 to 0.87 (r = 4 to 16 um, visible). [K] Hansen & Travis 1974.

-> shader: (a) Use a phase function that captures the diffraction peak *and* the 140-180 deg rise (2.2). (b) A glory decal
is cheap and dramatic in a flight sim: when the anti-solar point falls on a cloud surface below the aircraft, draw
coloured rings around the aircraft's shadow point with the first red ring at ~ 1.5-2.5 deg angular radius for r_e = 10 um
(angle ∝ 1/r_e). Weight it by surface opacity (tau > 1 in the top 50 m). (c) A white fogbow arc at 138 deg (radius ~ 40
deg around the antisolar point, width ~ 5-10 deg), added only on single-scatter samples.

### 2.2 Analytic phase function fits

| Model | Formula | Use |
|---|---|---|
| Henyey-Greenstein (HG) | p_HG(theta; g) = (1/4pi) (1 - g^2) / (1 + g^2 - 2 g cos theta)^(3/2) | one-parameter; misses diffraction peak and backscatter |
| Double HG | p = w p_HG(g1) + (1-w) p_HG(g2), e.g. g1 = 0.8 to 0.9, g2 = -0.2 to -0.5, w = 0.7 to 0.9 | common in games (Frostbite, Nubis, UE) [UNVERIFIED exact values per engine] |
| Cornette-Shanks (1992) | p_CS = (3/(8pi)) (1-g^2)(1+cos^2 theta) / ((2+g^2)(1+g^2-2g cos theta)^(3/2)) | slight backscatter boost; = Draine with alpha=1 [V via JdE paper] https://doi.org/10.1364/AO.31.003152 |
| Draine (2003) | p_D(theta; g, alpha) = (1/4pi) (1-g^2)/(1+g^2-2g cos theta)^(3/2) * (1 + alpha cos^2 theta) / (1 + alpha (1 + 2 g^2)/3) | alpha = 0 gives HG; g=0, alpha=1 gives Rayleigh [V] |
| **Jendersie & d'Eon 2023 "Approximate Mie"** | p = (1 - w_D) p_D(theta; g_HG, 0) + w_D p_D(theta; g_D, alpha) | **best published analytic fit for droplets, 0.1 to 50 um diameter** [V] |

**Jendersie & d'Eon fit (SIGGRAPH 2023 Talks), d = droplet diameter in um.** Paper: [V]
https://research.nvidia.com/labs/rtr/approximate-mie/publications/approximate-mie.pdf ; supplemental [V]
https://research.nvidia.com/labs/rtr/approximate-mie/publications/approximate-mie-supplemental.pdf ; project page
https://research.nvidia.com/labs/rtr/approximate-mie

Fits (all `log` natural; constants transcribed from text extraction of the PDF, please double-check against the PDF figure of eqs. 4-7 and S11-S22):

* 5 <= d <= 50 um (clouds and fog; main paper eqs. 4-7):
  * g_HG = exp(-0.0990567 / (d - 1.67154))
  * g_D = exp(-2.20679 / (d + 3.91029) - 0.428934)
  * alpha = exp(3.62489 - 8.29288 / (d + 5.52825))
  * w_D = exp(-0.599085 / (d - 0.641583) - 0.665888)
* 1.5 <= d < 5 um (supplemental):
  * g_HG = 0.0604931 * log(log(d)) + 0.940256
  * g_D = 0.500411 - 0.081287 / (-2 log(d) + tan(log(d)) + 1.27551)
  * alpha = 7.30354 * log(d) + 6.31675
  * w_D = 0.026914 * (log(d) - cos(5.68947 * (log(log(d)) - 0.0292149))) + 0.376475
* 0.1 < d < 1.5 um (supplemental; haze):
  * g_HG = 0.862 - 0.143 * log(d)^2   (the extraction read "log2"; log-squared is the reading that stays within [0,1] at d=0.1 and matches the
    small-d branch, so use log(d)*log(d))
  * g_D = 0.379685 * cos(1.19692 * cos((log(d) - 0.238604) * (log(d) + 1.00667) / (0.507522 - 0.15677 * log(d))) + 1.37932 * log(d) + 0.0625835) + 0.344213
  * alpha = 250
  * w_D = 0.146209 * cos(3.38707 * log(d) + 2.11193) + 0.316072 + 0.0778917 * log(d)
* d <= 0.1 um: g_HG = 13.8 d^2, g_D = 1.1456 d sin(9.29044 d), alpha = 250, w_D = 0.252977 - 312.983 d^4.3

Sanity check (my arithmetic on the fits): at d = 20 um, g_HG = exp(-0.0991/18.33) = 0.9946, g_D = exp(-2.2068/23.91 - 0.4289) = 0.594,
alpha = exp(3.6249 - 8.2929/25.53) = 27.1, w_D = exp(-0.5991/19.36 - 0.6659) = 0.498. So for cloud droplets the fit is a
very sharp forward HG lobe (g ~ 0.99, which models the diffraction peak) blended about 50/50 with a broad Draine lobe
(g ~ 0.6, alpha ~ 27, which models the body plus the backscatter rise). The two branches are continuous at d = 5:
g_HG = 0.9707 vs 0.969.

Limitations stated by the authors: the reference is lognormal (sigma 0.25), averaged uniformly over 400-700 nm,
refractive index 1.333. The fit does **not** reproduce fogbow or glory peaks, but it captures the forward half, which
is about 95% of the scattered energy. [V]

-> shader: compute the four parameters on the CPU per cloud type (d = 2 r_e: maritime Cu d ~ 25, continental d ~ 12,
fog d ~ 10) and upload them as uniforms; the GPU evaluates two Draine lobes, which takes about 15 ALU. **Caution for the
march:** the g_HG ~ 0.99 lobe is a near-delta. With a coarse step march and *sun-only* single scattering it creates a
correct, very bright silver lining when looking near the sun, but it can alias at the sun disc. For the
multiple-scattering octaves use the effective g of the whole function (about 0.86) or the Draine lobe alone (delta-scaling:
treat the HG(0.99) part as unscattered and reduce extinction by `w_forward * (1 - w_D)` for the MS term, as Kallweit
did with "chopped" Mie). The game's existing two-stream G_MEAN = 0.864 is consistent with this.

### 2.3 Ice phase functions and halos

* Hexagonal ice prisms refract through 60 deg prism faces with minimum deviation 21.84 deg (n = 1.31), hence the **22 deg halo**.
  The 90 deg faces give the **46 deg halo**. Sun dogs (parhelia) appear at 22 deg+ to the side at the sun's altitude, from horizontally
  oriented plates. The circumzenithal arc appears when the sun is below 32 deg elevation. [K] https://atoptics.co.uk/halo/common.htm
* Phase function: there is a forward peak (smaller than droplets' for the same g), a 22 deg peak (a sharp inner edge, red
  inside), a weaker 46 deg peak, a flat side and back, and no glory or rainbow. g ~ 0.75 to 0.80. Roughened or aggregate
  crystals (the dominant case in real cirrus) wash the halo peaks out to a smooth curve with g ~ 0.75. [K] Yang et al. 2013;
  Baum et al. 2014 https://doi.org/10.1016/j.jqsrt.2014.02.023
* Fit for shaders: p_ice = 0.85 p_HG(0.8) + 0.15 p_HG(-0.2)? plus a halo term `h(theta) = A * exp(-((theta - 22 deg)/1 deg)^2)`
  with A ~ 0.3 to 1 times the local p, multiplied by a sharp inner cut-off (no light inside 21.8 deg). [UNVERIFIED parametrisation; shapes from atoptics]

-> shader: cirrus layers are optically thin (tau < 1), so single scattering dominates and halos are directly visible.
A 22 deg ring on the cirrus deck is a major realism win at low cost.

### 2.4 Edges: silver lining, dark edges, bright edges, "powder"

* **Silver lining:** when the sun is behind a cloud, its thin edge (tau ~ 0.5 to 3 along the view ray) scatters the
  diffraction peak (theta < 5-10 deg) towards the viewer, so the edge glows brighter than the open sky next to the sun.
  This needs both the strong forward peak and a sharp optical-depth gradient at the edge. [K] https://atoptics.co.uk/droplets/silverl.htm [UNVERIFIED URL path]
* **Dark edges with the sun behind the observer (side- or front-lit cumulus):** a real effect. The outer shell of a cloud
  (depth < ~1-2 transport mean free paths ~ (1-g)^-1 / beta ~ 50-200 m) has not been "filled" by multiply scattered light
  from all directions, and light that enters there leaks out of the nearby boundary. In the diffusion picture
  the source function (in-scattered radiance) is low near a free surface (Milne problem: the surface value is about 1/sqrt(3) of
  the extrapolated interior value) and rises inward. Crevices between turrets, where the viewer sees "shallow" volume
  that is surrounded by more cloud on the sun side, look dark. The bulging lit turrets look bright. Schneider's "powder"
  term is an empirical version: `E = 2 exp(-d) (1 - exp(-2 d))` (Beer-powder), applied to view-facing lit regions.
  [K] Schneider 2015 https://www.guerrilla-games.com/read/the-real-time-volumetric-cloudscapes-of-horizon-zero-dawn
  Nubis3 (2023) replaces it with a probability field: in-scatter weight ∝ dimensional_profile (0 at the envelope, 1 deep
  inside), attenuated by the summed sun-ray density and relaxed near the sun direction to give "inner glow" (see 3.1). [V]
* **What is physically real:** (1) the radiance field near any boundary is weaker than in the interior (Milne), so
  thin lit edges are slightly darker than deep lit faces when viewed *away* from the sun; (2) near the sun direction
  the thin edge is the *brightest* part (forward peak). So the powder term must be **angle-dependent**: apply it with weight
  ~ (1 - forward-lobe weight), so it is strong at theta > 90 deg and vanishes at theta < 30 deg. Schneider also notes this. [K]

-> shader: drive "powder" from the true optical depth to the cloud surface along the *sun* direction and the *view*
direction, not from local density. Use `powder = 1 - exp(-2 tau_sun_local)` with the strength fading as cos theta → 1.

### 2.5 Multiple scattering in optically thick clouds

* **Regimes:** tau < 1 is single scattering. For 1 < tau < ~5 low orders matter. For tau > ~5-10 / (1-g) the field is diffusive.
  The transport mean free path is l* = 1 / (beta (1-g)) ≈ 7 / beta for g = 0.86, about 150-200 m in Cu with beta = 0.04. [K]
* **Two-stream (Eddington / delta-Eddington) for a conservative, non-absorbing slab, collimated sun at cos mu0:**
  * Reflectance (diffuse incidence, "hemispheric"): R = (1-g) tau / (2 + (1-g) tau)   [Bohren 1987; Bohren & Clothiaux 2006 eq. 5.x] [K]
  * Collimated beam (Eddington, mu0): R(mu0) = [ (1-g) tau + (2/3 - mu0)(1 - exp(-tau/mu0)) ] / [ 4/3 + (1-g) tau ]
    (Eddington, conservative case: Shettle & Weinman 1970; delta-scaled version Joseph, Wiscombe & Weinman 1976; replace tau, g by tau(1-g^2), g/(1+g) for delta-Eddington). [K] https://doi.org/10.1175/1520-0469(1976)033<2452:TDEAFR>2.0.CO;2
  * Transmission T = 1 - R (conservative). Example, g = 0.85: tau = 5 gives R ≈ 0.27, T ≈ 0.73; tau = 20: R ≈ 0.6;
    tau = 50: R ≈ 0.79, T ≈ 0.21; tau = 100: R ≈ 0.88, T ≈ 0.12.
  * The game's `twoStream(u, d) = (d (1-g) + 0.71) / ((u+d)(1-g) + 1.42)` is the diffusion solution with extrapolation length
    0.71 l* (Milne). It is consistent with the formula above (1.42 = 2 x 0.71).
* **Mean number of scatterings:** reflected photons have a broad, heavy-tailed distribution with mean ~ tau for thick clouds and
  median a few. Transmitted photons need ~ (1-g) tau^2 scatterings (random walk with ((1-g)tau)^2 transport steps, each
  ~1/(1-g) scatterings): ~400 for tau = 50, g = 0.85. [K] Davis & Marshak 2002, https://doi.org/10.1175/1520-0469(2002)059<2713:SDOSPL>2.0.CO;2 ;
  diffusion theory, Bohren & Clothiaux ch. 6.
* **Why tops are bright and bases dark:** in the diffusive regime the cloud is a "light pipe": irradiance enters the top,
  random-walks, and the fraction leaving the base falls as ~2/(2 + (1-g) tau). Sides lit by a low sun leak light
  sideways. The radiance seen at the base is diffuse (Lambertian-like) and ~10-30% of the top. Combined with blue
  skylight fill from the side and ground bounce, the bases come out grey-blue to grey-brown. [K]
* **3D effects:** finite clouds leak light from their sides (channelling), so a cumulus with aspect ratio ~1 is
  *less* reflective than a slab of the same tau, and its shadowed side is lit by diffuse light from the lit side through the
  cloud (Davis & Marshak 2010 review https://doi.org/10.1088/0034-4885/73/2/026801 [K]).

-> shader: the octave approximation (3.2) gets the order of magnitude right for tau up to ~10. For deep cumulus the
diffusion two-stream term (already present) should be anchored on the *true* optical depth to the top and the bottom
along the vertical (the code comment notes a 5x overestimate of tauUp: fix the feature, do not compensate in the network).

### 2.6 Inter-reflection: cloud-to-cloud, ground-to-cloud

* Ground albedo (broadband visible): ocean 0.03 to 0.10 (sun high), forest 0.05 to 0.15, grass 0.15 to 0.25, desert 0.3 to 0.4,
  fresh snow 0.8 to 0.9. [K] https://en.wikipedia.org/wiki/Albedo (table, citing multiple sources)
* The base irradiance from the ground ≈ albedo_ground × (global irradiance at the ground). For cloud cover > 50% this
  includes multiple cloud-ground bounces, which boost the irradiance factor by 1/(1 - albedo_ground × R_cloud_base).
  Over snow with overcast skies this can double the brightness of bases ("snow blink"; also "water sky", dark bases over open water
  in polar regions). [K] https://glossary.ametsoc.org/wiki/Snow_blink
* Cloud-to-cloud: in broken Cu fields, sides facing a sunlit neighbour receive ~ R_neighbour × solid angle of
  neighbour × E_sun. Typical additional side irradiance is 5-20% of direct. [UNVERIFIED magnitude]

-> shader: the ambient term should have **three** parts: sky (blue, from above), ground (albedo × ground irradiance,
tinted by the terrain under the cloud, from below), and a cheap cloud-bounce term (the regional cloud coverage
fraction × ~0.5 × sun luminance, from the horizontal directions). The game's V net (Vsky, Vground) already has the first two, so
feed the ground term with the actual terrain albedo below the cloud (snow, sea, forest).

### 2.7 Sunset, Earth shadow, moonlight, lightning

* **Reddened sunlight:** sunlight reaching a cloud at altitude h along a grazing path has Rayleigh optical depth ~ 0.1 (blue 450
  nm 0.2, red 650 nm 0.05) × air mass, plus aerosols. Air mass at the horizon is ~38 (Kasten & Young 1989). [K]
  https://doi.org/10.1364/AO.28.004735 . Clouds at 10 km stay sunlit ~ 20-30 min after ground sunset (geometric: sunset at
  altitude h comes when the sun is ~ sqrt(2h/R_E) rad ≈ 3.2 deg below the horizon for 10 km, 1.4 deg for 2 km). [derived]
* **Clouds lit from below:** after ground sunset, the sun illuminates high clouds from *below*, so the bases are bright
  orange/red and the tops are in shadow. That is the classic sunset look and requires sun directions below the cloud's local
  horizon to be handled (light march going *upward* through the cloud).
* **Earth shadow and Belt of Venus:** the antisolar sky has a blue-grey band (Earth's shadow) under a pink band, rising about 1 deg
  per 4 min after sunset. Low clouds in the shadow are blue-grey while high ones are pink. [K] https://atoptics.co.uk/highsky/eshad.htm
* **Moonlight:** full moon illuminance ~ 0.1-0.3 lux vs sun ~ 1e5 lux, a ratio of ~1/400,000 (magnitude -12.7 vs -26.7).
  The spectrum is solar, slightly reddened (lunar albedo rises toward red), but humans see it blue-shifted (Purkinje effect,
  scotopic vision). Renderers usually apply a blue tint and desaturation in tone mapping, not in the light. [K]
  https://doi.org/10.1145/566654.566612 (Jensen et al. 2001 "A physically-based night sky model")
* **Lightning inside Cb:** a stroke channel is 5-10 km long, flashes last 0.2-0.5 s with 3-4 return strokes ~ 40-60 ms apart, and
  intracloud flashes outnumber cloud-to-ground ones about 3:1. Inside the cloud the channel acts as a line light source
  embedded at tau >> 1, so the cloud glows diffusely over a radius of ~ l* sqrt(tau)... in practice a 1-3 km soft blob.
  [K] https://www.nssl.noaa.gov/education/svrwx101/lightning/ ; Nubis3 uses `glow = pow(1 - d/radius, 12) * (1 - saturate(5 density))`. [V]

-> shader: lightning is a point or line light inside the volume. Use a diffusion-like falloff `exp(-r / L) / r` with
L ~ 300-800 m, modulated by local density, plus flicker timing as above.

---

## 3. Rendering literature distilled

### 3.1 Schneider / Guerrilla "Nubis" (2015, 2017, 2022, 2023)

**2015 (HZD, Advances).** [V] https://d3d3g8mu99pzk9.cloudfront.net/AndrewSchneider/The-Real-time-Volumetric-Cloudscapes-of-Horizon-Zero-Dawn.pdf
* Modelling: a 2.5D weather map (coverage, precipitation, cloud type). Three height-gradient presets (stratus, cumulus,
  cumulonimbus) blended by type shape the vertical density profile. Precipitation pushes the map toward Cb at 70% coverage.
* Noise: a 128^3 RGBA base texture (Perlin-Worley in R, Worley at increasing frequency in GBA), a 32^3 RGB Worley detail
  texture that *erodes* the base shape (wispy at the bottom, billowy at the top), and a 128^2 curl noise for turbulent distortion.
* Volumetric low clouds sit at 1500-4000 m; alto and cirro above 4000 m are 2D. The cloudscape radius is 35 km, with
  transitions from 15 km.
* Lighting: Beer's law × HG × a "powder sugar" darkening that depends on depth and the view-light angle. The combined
  form usually quoted from the talk is `2 exp(-d)(1 - exp(-2d))` [K]. Light samples: 5-6 in a cone toward the sun plus one
  long-distance sample. Absorption is raised in rain clouds. Ambient grows with height.
* March: 64 samples, rising to 128 at the horizon; cheap sampling once alpha > 0.3 (2× faster); early exit.
* Performance: a quarter-resolution buffer updates 1 of 16 pixels per 4×4 block per frame, with reprojection for the rest.
  ~2 ms and ~20 MB on PS4 (down from ~20 ms before the optimisations).

**2017 (Nubis "in a nutshell"):** combined HG with a 'silver lining' lobe as a max() of two HG lobes plus an
eccentricity/intensity control; added "in-scatter probability" based on height and density. [UNVERIFIED details]

**2022 "Nubis Evolved" (Forbidden West).** [K] https://www.guerrilla-games.com/read/nubis-evolved
Fly-through clouds, superstorms, 1080p without temporal upscaling, "near zero cost" internal lighting. (I could not fetch
the slide PDF in this pass.)

**2023 "Nubis Cubed" / Nubis3 voxel clouds.** [V] https://d3d3g8mu99pzk9.cloudfront.net/AndrewSchneider/Nubis%20Cubed.pdf
* Data: a 512×512×64 voxel grid at 8 m precision with channels: *dimensional profile* (0 at the envelope to 1 deep inside),
  density type (wispy↔billowy), density scale, and a compressed SDF (-256 m..4096 m). The volume is up-rezed to 0.5 m with a
  128^3 RGBA noise (low/high "Curly-Alligator" and "Alligator" noise).
* Density: `wispy = lerp(n.r, n.g, profile)`, `billowy = lerp(n.b*0.3, n.a*0.3, pow(profile, 0.25))`,
  `noise = lerp(wispy, billowy, type)`, value-erode the profile by the noise, multiply by `pow(saturate(densityScale), 4)`,
  sharpen with `pow(density, lerp(0.3, 0.6, poweredScale))`.
* March: step = `max(sdf, max(1, sqrt(dist) * 0.08)) + jitter`, sphere-tracing empty space; samples only where SDF < 0.
  Jitter is animated within 250 m and static beyond.
* Light: the first 2 light samples are direct, the rest are read from a 256×256×32 light voxel grid updated over 8 frames
  (0.1-0.2 ms). That gives about 40% faster, long-range inter-cloud shadows.
* Ambient: `pow(1 - profile, 0.5) * exp(-summed_ambient_density)`.
* Multiple scattering: `ms = profile * exp(-sunDensity * Remap(sun_dot, 0, 0.9, 0.25, Remap(cloud_distance, -128, 0, 0.05, 0.25)))`.
  The extinction coefficient for MS is *reduced* toward the sun and inside the cloud, which gives inner glow.
* Lightning: `pow(1 - d/r, 12) * (1 - saturate(density*5))`.
* Cost on PS5 at 960×540: 2.2-4 ms for the march. Split resolution: below 200 m at 480×270.

-> shader: the **dimensional profile** (normalised distance from the envelope) is the key idea: one scalar field gives
erosion type, ambient occlusion, and MS probability. The game can derive it from its cell / envelope field.

### 3.2 Hillaire 2016 (Frostbite PBS course) and the Wrenninge octave approximation

[K] https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/s2016_pbs_frostbite_sky_clouds.pdf (fetch failed in this pass)
* **Energy-conserving integration** of the in-scattered light over a step of length dx with constant sigma_t, S:
  `S_int = (S - S * exp(-sigma_t dx)) / sigma_t`; `L += T * S_int`; `T *= exp(-sigma_t dx)`. This is exact for constant
  coefficients and removes the energy gain or loss that depends on step size. [K] Hillaire 2015 (unified volumetrics)
  https://www.frostbite.com/2015/08/physically-based-unified-volumetric-rendering-in-frostbite/
* **Multiple scattering octaves (Wrenninge et al. 2013, "Oz: The Great and Volumetric"):** [V]
  https://fpsunflower.github.io/ckulla/data/oz_volumes.pdf
  `L = sum_{i=0}^{N-1} b^i * sigma_s * L_light * p(theta, c^i g) * exp(-a^i * tau_sun)`
  with N ("octaves"), a (attenuation), b (contribution), c (eccentricity attenuation). Oz defaults: **N = 8,
  a = b = c = 1/2**. Energy conservation requires a <= b. [V for the defaults; the a <= b condition is from Hillaire 2016 [K]]
  Hillaire 2016 used **N = 2 or 3** octaves in real time. [UNVERIFIED exact Frostbite values]
* Frostbite temporal: clouds rendered at 1/4 resolution with temporal reprojection over 16 frames (4×4). [UNVERIFIED]

-> shader: the game already uses octaves. Check a <= b, and use c^i g with g = 0.86 (not the near-delta 0.99 lobe).

### 3.3 Kallweit et al. 2017 "Deep Scattering" (RPNN)

[V] https://arxiv.org/pdf/1709.05418
* Predicts the **indirect (multiply scattered) in-scattered radiance** at a point, for a directional light. Direct light is
  done by next-event estimation. (Predicting total radiance was harder because of the high-frequency direct component.)
* **Descriptor:** a hierarchical stencil of K = 10 levels × 225 points (5×5×9) in a box from [-1,-1,-1] to [1,1,3] in a
  light-aligned frame (z towards the light, x perpendicular to the plane of z and view). Level k is scaled by 2^(k-1).
  Density is in units of mean free paths at the cloud's mean density and is read from a Gaussian-filtered mip pyramid
  (sigma_i = 2^i). The input adds gamma = angle between view and light.
* **Network:** 10 residual blocks (one per level, 2 FC layers of 200 each, ReLU), each consuming its stencil level
  plus the previous block's output, with the coarsest level first. Then 3 FC layers: 23 layers in total, ~1.4 M parameters.
* Training: 80 clouds (75 train/val), 15 M samples, chopped Lorenz-Mie and HG (g = 0.857). Loss is the squared error on
  log(1 + L). Adam, batch 1000, ~12 h on one GPU.
* Results: up to 4000× faster than path tracing (directional light); a few seconds per frame on a Titan X. Weak spots:
  thin clouds and back-lit contrast (the training set is mostly cumulus), non-cloud shapes, sharp distant shadows (the stencil
  is too coarse). **Descriptor construction is the bottleneck.**
* What it learns: essentially a learned "diffusion kernel" from the local density neighbourhood in a light-aligned frame.
  The hierarchical levels encode how much cloud lies between the point and the light at every scale, and how much
  surrounds it laterally (leakage).

### 3.4 Follow-ups: learned multiple scattering for real time

* **MRPNN, Hu et al. SIGGRAPH 2023, "Deep real-time volumetric rendering using multi-feature fusion"** [V]
  https://sites.cs.ucsb.edu/~lingqi/publications/paper_mrpnn.pdf
  * 12 stencil layers: 8 low-frequency (uniform spherical) and 4 high-frequency (in a cone toward the light, aimed at shadow
    boundaries). Per point: density, **precomputed transmittance** (ray-marched over density mips with a per-level scale
    beta^(i+1), beta = 0.578), and phase. Plus albedo, g and the view-light angle.
  * About 50 k parameters (vs 1.3 M for RPNN), Squeeze-and-Excitation blocks; the albedo stage runs 3× for RGB.
  * Under 33 ms per frame at 1024² on an RTX 2080 with 1024³ volumes. Trained on 26 cloud models, 5 M samples, ~4 days.
  * Key lesson: **feed the network transmittance (optical depth) features, not raw density**. The network then does not
    have to learn visibility. This is what the game's J net already does (tauSun, tauUp).
* Fang, Feng & Cui 2024, "A real-time rendering method for high albedo anisotropic materials with multiple scattering": a
  3D-CNN over hierarchical transmittance fields plus attention. [V abstract only] https://arxiv.org/abs/2401.14051

-> shader / training: for a browser budget the useful recipe is: inputs = a handful of optical depths along light, up,
down, and a few lateral directions at 2-3 scales (from mips), plus cos theta and g. Small MLP (2-3 layers of 16-32), baked
into a LUT where possible. Train on path-traced ground truth of *the game's own density field*. Predict log(1 + L_ms).

### 3.5 Bouthors et al. 2008, "Interactive multiple anisotropic scattering in clouds" (I3D)

[K] https://evasion.inrialpes.fr/Publications/2008/BNMBC08 (the abstract page and HAL copy were not readable in this pass;
the summary below is from my reading of the paper and Bouthors' 2008 PhD thesis, so check the details.)
* Representation: a cloud is a closed **surface mesh plus a hypertexture** (a thin noisy boundary layer) around a homogeneous
  interior. Density is uniform inside, so the optical distance depends only on geometry.
* Key physical insight: in a thick, forward-scattering cloud, the light reaching an exit point P comes mostly through a
  "**collector**": a disc-shaped area on the lit surface around the point closest to P along the light direction, whose size
  grows with depth. Transport from the collector to P is precomputed by Monte Carlo on a **plane-parallel slab** and
  parameterised by slab thickness, depth of P, and the angles (view, light, normal). The result is stored as fitted functions or
  tables.
* At runtime they find the collector per pixel iteratively (it grows), integrate incoming light over it, and apply the
  slab transfer function. Low orders (single plus double scattering through the hypertexture skin) are handled separately.
* Results: they reproduce the glory, fogbow, pseudo-specular reflection and "light pipe" channelling, interactively
  (~2-10 fps on 2008 GPUs). [UNVERIFIED fps]
* Bouthors' thesis also gives the slab statistics: most of the reflected light comes from the first ~ 1-3 transport mean free
  paths. [K] Bouthors PhD thesis 2008, https://theses.hal.science/tel-00332994 [UNVERIFIED URL id]

-> shader: the useful idea for us is to **parameterise the multiple-scattering lookup by the distance to the lit surface along
the sun direction and the local "slab thickness"**, not by raw tau along a straight line. The game's (tauSun, tauUp) features
are a version of this; adding a "thickness along the sun ray through the whole cloud" feature (tau_sun_total) lets the
network tell a thin sheet from a deep tower.

### 3.6 Disney cloud dataset

Walt Disney Animation Studios released a production cumulus VDB (CC BY-SA 3.0), used in Kallweit 2017 and many
follow-ups as a reference for density structure and for path-traced ground truth. Recommended render settings: albedo ~ 1, a
Mie or high-g HG phase function. [K] https://disneyanimation.com/resources/clouds/ [UNVERIFIED exact URL path and voxel
dims ~ 2k^3]
-> use: an offline reference to compare the game's density histograms and edge profiles against: the density gradient
across the boundary, the proportion of near-zero voxels, and the turret size spectrum.

### 3.7 Unreal Engine volumetric clouds

[V] https://dev.epicgames.com/documentation/unreal-engine/volumetric-cloud-component-properties-in-unreal-engine
* Material outputs: Phase G, Phase G2, Phase Blend (dual HG). Multi-scattering *Contribution*, *Occlusion* and *Eccentricity*
  all default to 0.5 (these are Wrenninge's b, a, c), with **at most 2 octaves**. There is optional "Ground Contribution"
  (shadowed ground light, single scattered) and a "Conservative Density" used for empty-space skipping.
* Clouds are a layer with a bottom altitude and height in km. View rays are capped by
  `r.VolumetricCloud.ViewRaySampleMaxCount`, and the shadow tracing distance is in km.
* Based on Hillaire's 2016/2020 work. [K] https://blog.selfshadow.com/publications/s2020-shading-course/hillaire/s2020_pbs_hillaire_slides.pdf

### 3.8 Microsoft Flight Simulator 2020/2024

No public technical talk on MSFS cloud rendering turned up in this pass (searches returned only forums and press). From
public statements, they use voxel-based volumetric clouds driven by live weather (Meteoblue) data. Treat any specifics as
**unverified**. https://www.techspot.com/news/103545-microsoft-flight-simulator-2024-presentation-outlines-ray-tracing.html

### 3.9 Temporal reprojection and noise

* **HZD/Nubis 2015:** at quarter resolution, update 1 of 16 pixels per frame in a 4×4 Bayer order and reproject the rest using
  the cloud depth. [K] (Schneider 2015, link in 3.1)
* **Nubis3 (2023):** no temporal upscaling for voxel clouds. It splits resolution by distance (480×270 under 200 m,
  960×540 beyond) and uses a jitter that is animated within 250 m and static beyond. [V]
* **Cloud depth for reprojection:** use the transmittance-weighted mean depth `z = Σ T_i z_i α_i / Σ T_i α_i`, or the depth
  where T crosses 0.5. Hillaire 2016 uses a transmittance-weighted depth. [V via a 2022 CTU Prague thesis citing it] https://dcgi.fel.cvut.cz/wp-content/wpallimport-dist/theses/pdf/theses-2022-sakmamat-thesis.pdf
* **Blue noise:** jitter the ray start by a blue-noise value (with a golden-ratio temporal offset per frame:
  `fract(bn + frame * 0.61803)`) instead of white noise. That halves perceived noise at equal sample count. Spatio-temporal
  blue noise (Wolfe et al. 2022, NVIDIA STBN) is optimised for TAA-style accumulation. [K]
  https://research.nvidia.com/publication/2022-07_spatiotemporal-blue-noise-masks ; Heitz & Belcour 2019 [K]
* Neighbourhood clamping on reprojected cloud colour (a 3×3 min/max in YCoCg) prevents ghosting with fast camera rotation. For
  a flight sim with fast translation, reject history by depth disocclusion and blend faster near the camera.

### 3.10 Cloud shadows on the ground and on other clouds; crepuscular rays

* **Beer shadow map (Frostbite 2016):** render from the sun into a 2D map storing (front depth, mean extinction, max optical
  depth). Transmittance at depth z is `T = exp(-min(max_od, mean_ext * max(0, z - front_depth)))`. This gives soft,
  filterable, cheap shadows on terrain and on clouds. [K, Hillaire 2016 course notes, link in 3.2; UNVERIFIED exact channel layout]
* **Cheaper alternative:** a top-down 2D optical-depth map (integrate the density vertically, or along the sun ray, at 50-100 m
  resolution) reprojected along the sun direction. That is enough for terrain shadows and for "inter-cloud shadows" as in the
  Nubis3 light voxel grid (256×256×32, amortised over 8 frames). [V]
* Real cloud shadows on the ground are **sharp-edged** for low clouds (sun angular size 0.53 deg: the penumbra width is
  ~0.0093 × height above ground, about 10 m for a 1 km base) and soft only because the cloud edge itself is soft. [derived]
* **Crepuscular rays (god rays):** light shafts between cloud gaps, visible when aerosol or haze is present. Implement as the
  atmospheric in-scatter integral × the cloud shadow map along the view ray (epipolar sampling: Engelhardt & Dachsbacher 2010
  https://doi.org/10.1145/1730804.1730823 [K]) or as a screen-space radial blur (Mitchell, GPU Gems 3 ch. 13 [K]
  https://developer.nvidia.com/gpugems/gpugems3/part-ii-light-and-shadows/chapter-13-volumetric-light-scattering-post-process).
  Rays appear to converge at the sun *and* at the antisolar point (anticrepuscular rays) by perspective.

---

## 4. Morphology and dynamics

### 4.1 Cloud base: the lifting condensation level

* `z_LCL ≈ 125 m/K × (T - T_d)` (Espy, coefficient by Lawrence 2005; max error ~ 665 m against the exact formula). [V]
  https://www.romps.berkeley.edu/papers/pubdata/2016/lcl/16lcl.pdf
* Better: Lawrence eq. 24, `z_LCL = (20 + (T - 273.15)/5) × 100 m × (1 - RH)` (±130 m for 0-30 C, RH 0.5-1). [V]
* Physical reason for flat bases: all thermals rising from a well-mixed boundary layer have about the same T and T_d, so they
  saturate at the same height. A field of cumulus shares one base, varying by ±50-100 m. [K]
* Dry adiabatic lapse 9.8 K/km. The dew point falls ~1.8 K/km in rising air, so the depression shrinks ~8 K/km. [V, derived]

-> shader: one base altitude per weather region (from the game's T and T_d). Give the base a sharp density ramp
(10-30 m), a slight concavity or upward bulge at the centre of large Cu, and ±50 m noise. Do **not** erode bases with the same
billowy noise as tops: real bases are flat and "smudged", with ragged scud only in decaying or rainy cells.

### 4.2 Genera: what to model

| Genus / species | Base (km) | Thickness | Horizontal size | Look and physical cause | Source |
|---|---|---|---|---|---|
| Cumulus humilis | 0.5-2 (deserts up to 3-4) | 0.2-0.5 km | 0.2-1 km | flat, wider than tall; capped by an inversion | WMO Atlas [K] https://cloudatlas.wmo.int/en/cumulus.html |
| Cu mediocris | 0.5-2 | 0.5-1.5 km | 0.5-2 km | height ~ width, a few turrets | WMO [K] |
| Cu congestus | 0.5-2 | 2-6 km | 1-5 km | taller than wide, hard cauliflower tops, strong updraught 5-10 m/s | WMO [K] |
| Cumulonimbus (calvus to capillatus, incus) | 0.5-2 | to the tropopause, 8-16 km | 10-50 km (anvil to 100+ km) | glaciated fibrous top, anvil spreading at the tropopause, overshooting top dome 0.5-2 km above the anvil for 10-20 min; updraughts 10-40 m/s | NSSL [K] https://www.nssl.noaa.gov/education/svrwx101/thunderstorms/ |
| Stratocumulus | 0.3-2 | 0.2-0.8 km | cells 5-40 km (aspect ~35:1) | lumpy layer, open/closed cells, dark bases with light gaps | Wood & Hartmann 2006 [V] |
| Stratus | 0-0.5 | 0.1-0.5 km | 10s-100s km | uniform grey, no structure; drizzle | WMO [K] |
| Nimbostratus | 0.5-2 (ragged scud below) | 2-5 km | 100s km | dark, diffuse, featureless with rain; no sun disc visible | WMO [K] |
| Altocumulus | 2-6 | 0.1-0.5 km | elements 0.5-1 deg apparent (1-5 deg of sky) | rolls or patches, often supercooled liquid, iridescence and corona | WMO [K] |
| Altostratus | 2-6 | 1-3 km | 100s km | grey sheet, sun visible as through ground glass, no halo | WMO [K] |
| Cirrus fibratus / uncinus | 6-12 | 0.1-2 km (tau 0.03-3) | streaks 10-100s km | ice fibres; fall streaks curved by shear (hooks: generating head with a trailing tail); halos | Heymsfield 2000 [K] |
| Cirrostratus | 6-12 | 0.5-2 km | 100s km | transparent veil, 22 deg halo | WMO [K] |
| Cirrocumulus | 6-12 | thin | grains < 1 deg apparent | small ripples, often supercooled liquid | WMO [K] |
| Lenticular (Acsl, Ccsl, Scsl) | 2-12 | 0.1-1 km | 1-10 km, stacked "pile of plates" | stationary at wave crests downwind of ridges; smooth, laminar, crisp edges, iridescent; air flows *through* them | WMO [K] https://cloudatlas.wmo.int/en/altocumulus-lenticularis.html |
| Cap / pileus | just above the summit or tower | thin | | smooth hood above a rising turret or a mountain summit | WMO [K] |
| Mammatus | under anvils | lobes extend 0.3-1.1 km down (most ~0.5 km) | lobes 0.25-8 km, mostly 1-3 km | smooth pouches, mostly ice, lit dramatically by a low sun; each lobe lives ~10 min, the field 15 min to hours | Schultz et al. 2006 [V] https://data-ww3.ifremer.fr/BIB/Schultz_etal_MWR2006.pdf |
| Shelf / arcus | 0.3-1 | | along the gust front, 10s of km | wedge-shaped, smooth layered underside, ragged leading edge, ahead of a Cb outflow | NSSL [K] |

### 4.3 Thermals, turrets and the size spectrum

* Shallow Cu (stereo-photogrammetry, Oklahoma): median maximum base radius 240 ± 20 m, maximum thickness 500 ± 100 m, volume
  0.11 km^3, **median lifetime 15 ± 2 min** (minimum tracked 5 min), cloud-base updraught 0.7 m/s (lidar). Observed clouds
  behave mostly like **bubbles** (B ~ 0.8) rather than steady plumes. [V] Romps et al. 2019
  https://www.romps.berkeley.edu/papers/pubdata/2019/lifecycle/19lifecycle.pdf
* Size distribution: N(l) ∝ l^-1.7 up to a scale break at 400-1250 m (growing through the day), steeper beyond. Literature
  exponents are -1.7 (Neggers 2003), -1.89 (Cahalan & Joseph 1989) and -1.98 (Benner & Curry 1998). Cloud fraction for shallow Cu is
  14-27% projected (the maximum at any one level is only ~6%: clouds are narrower than their projected shadow). [V]
  https://cdn.knmi.nl/system/data_center_publications/files/000/066/549/original/neggers_03_jas.pdf
* Turret (sub-thermal) sizes scale with cloud size: a congestus is built of bubbles of 0.2-1 km diameter, each with smaller
  bulges in a roughly self-similar cascade (perimeter fractal dimension ~1.35 over 1-1000 km). [K] Lovejoy 1982.
  Individual turrets rise for 5-10 min and then decay while new ones emerge on the upshear/updraught side. [UNVERIFIED timing]
* Cauliflower texture: it comes from the toroidal circulation of a rising thermal (vortex ring). The top is crisp and convex
  because cloudy air is pushed into dry air by buoyancy; the sides and wake are entrained and evaporate. [K] Scorer 1957;
  Damiani et al. 2006 https://doi.org/10.1175/JAS3710.1 [UNVERIFIED DOI]

-> shader: build cumulus as a sum of spherical-ish "bubbles" with radii drawn from a power law (exponent ~ -1.7 to -2),
2-3 levels of recursion with a radius ratio of ~0.35-0.5 per level. The top surfaces should be convex and sharp (density
ramp ~ 5-20 m), and the base flat. Animate: each bubble rises at 1-3 m/s (Cu) or 5-15 m/s (congestus/Cb) for 5-10 min, then
erodes.

### 4.4 Edges: growing vs decaying, hard vs wispy

* **Growing (actively rising) parts:** sharp, well-defined, bright cauliflower edges with high LWC right up to the boundary
  (buoyant cloudy air, near-adiabatic). The boundary is ~ 1-10 m thick optically. [K] (WMO Atlas descriptions of cumulus as
  "sharp outlines"; LES entrainment studies)
* **Decaying parts:** ragged, fibrous, translucent edges. Evaporation and mixing dilute the LWC over 100s of m, number concentration
  drops in filaments, and holes appear. The species name *fractus* means torn fragments. A dissipating Cu goes from crisp to
  ragged in ~5 min and evaporates in another 5-10 min. [K] https://cloudatlas.wmo.int/en/cumulus-fractus.html
* **Glaciated parts (Cb tops, anvils, cirrus):** soft, fibrous, *striated* edges (ice crystals survive in subsaturated air
  much longer than droplets do, so ice edges are diffuse over km). [K] Korolev 2017
* **Downshear side:** detrained, more ragged and wispy. The upshear side is crisp. [K]

-> shader: the edge sharpness of the density remap should be driven by the **life-cycle phase** (the game already has a
per-cell phase): growing means a steep remap (Nubis-style `pow(d, 0.3)` sharpening) and billowy noise; decaying means a soft
remap, wispy/curly noise, and lower peak density. For ice, use a long soft falloff and stretched (anisotropic, wind-aligned)
noise.

### 4.5 Wind shear, streets, cells

* **Shear tilt:** towers lean downshear at angle `atan(Δu / w)`. With 10 m/s of shear over the cloud depth and a 5 m/s updraught,
  the lean is ~ 60 deg from vertical in the upper part, which is why strong shear kills small Cu and makes Cb anvils
  stretch downwind 50-200 km. [derived]
* **Cloud streets (horizontal convective rolls):** in a 1-2 km deep boundary layer, the wavelength/depth aspect ratio is 2:1 to
  6:1 (up to 10:1), so streets are spaced 2-12 km apart. They are near-parallel to the mean wind in convective conditions (up to 18-30 deg to the left
  in neutral or stable conditions), need moderate wind with shear, and last hours. [V] https://en.wikipedia.org/wiki/Horizontal_convective_rolls
* **Mesoscale cellular convection (Sc):** the cell diameter / boundary-layer depth is ~30:1 to 40:1 (open and closed alike),
  with BL depth 0.6-1.5 km, so cells are 10-40 km across. Closed cells: cloud fraction 0.86-0.88, cloudy cell centres with clear narrow
  rims. Open cells: cloud fraction ~0.3, cloud rings around clear centres; they are favoured for zi 1-1.5 km, especially with
  drizzle. [V] https://atmos.washington.edu/~robwood/papers/my_papers/Wood_Hartmann_JCLI_2006.pdf
* **Life cycle times:** small Cu median 15 min [V]. Ordinary single-cell thunderstorm ~30-60 min, a multicell lasts hours
  (each cell 30-60 min), supercell hours. [K] https://www.nssl.noaa.gov/education/svrwx101/thunderstorms/types/
* **Orographic clouds:** lee-wave lenticulars sit at wave crests with lee-wave wavelengths of ~ 5-25 km [UNVERIFIED range] and are
  stationary relative to the ground while the wind blows 10-40 m/s through them. Cap clouds sit on summits, with a "Föhn wall" on
  the lee side. Rotor clouds are ragged, low and turbulent under the wave crests. [K] https://cloudatlas.wmo.int/en/orographic-clouds.html [UNVERIFIED path]

### 4.6 Cover, base and thickness by weather type (preset table)

| Weather preset | Low cloud | Base (m AGL) | Top (m AGL) | Cover (oktas) | Notes |
|---|---|---|---|---|---|
| Fair weather (anticyclone, summer afternoon) | Cu hum/med | 800-1500 (rising through the day) | base + 300-1500 | 1-3 (projected CF 14-27%) | inversion caps tops; size break 400-1250 m |
| Trade-wind maritime | Cu + Sc | 500-700 | 1500-2500 | 2-4 | larger r_e, softer, some drizzle shafts |
| Marine Sc deck | Sc closed cells | 300-800 | 600-1500 | 6-8 | cells 10-40 km; dark undersides; gaps on cell rims |
| Pre-frontal (warm front) | Ci → Cs → As → Ns | Ci 8000+, As 3000-5000, Ns 500-1500 | to 6-8 km | 8 | progression over 12-24 h; 22 deg halo in the Cs stage |
| Cold front / unstable | Cu con + Cb | 800-1500 | to 9-14 km | 3-7 | lines and clusters, shelf clouds, rain shafts |
| Summer thunderstorm afternoon | Cb | 1000-2000 | 10-16 km | 2-6 | anvils, mammatus, overshooting tops |
| Overcast stratus / fog | St | 0-300 | 300-800 | 8 | uniform; fog visibility < 1 km |
| Mountain wave | Acsl | 3000-8000 | thin | 1-3 | stationary lenses, stacks |

Sources: WMO Cloud Atlas genus pages [K] https://cloudatlas.wmo.int/en/clouds-genera.html ; Neggers 2003, Wood & Hartmann 2006,
Romps 2019 [V]. Base and top ranges are typical mid-latitude values [K/UNVERIFIED per row].

---

## 5. Checklist: what a photo of real clouds has that renders usually lack

Ranked by visual impact for a flight sim seen from the air and from the ground.

1. **Correct vertical density profile (dense upper middle, thin base).** Cause: adiabatic LWC grows linearly above the
   LCL (1.3). Remedy: density ∝ (z - base) × f_ad, peaking at 70-90% of the height, with the turret top falling off sharply. This makes
   tops bright and opaque and bases grey but with a crisp outline.
2. **Hard, sharp, flat bases at a common altitude.** Cause: the LCL (4.1). Remedy: one base height per region and a 10-30 m
   ramp, no billowy erosion underneath.
3. **Sharp edges on growing turrets, ragged on decaying ones.** Cause: entrainment (4.4). Remedy: tie the density-remap
   sharpness and the noise type to the life-cycle phase; aim for density ramps of ~5-20 m on growing tops.
4. **The silver lining and a bright forward-scatter halo around the sun through thin cloud.** Cause: the diffraction peak (2.1).
   Remedy: the Jendersie-d'Eon phase with g_HG ~ 0.99 on direct single scattering, sampled with enough resolution near
   the sun direction.
5. **Blue-tinted shadows and sides, warm or green-brown underside bounce.** Cause: sky fill and ground albedo (2.6). Remedy: a
   three-part ambient (sky, ground with terrain albedo, cloud bounce), with real sky radiance from the atmosphere model.
6. **Contrast range.** Lit tops are ~ 5-10× brighter than the shaded bases of the same cloud, and the sun-side edge on a
   backlit cloud is brighter than the sky. Cause: diffusion (2.5). Remedy: no artificial ambient floor, HDR plus a filmic
   tone map, and an albedo of 1.
7. **Dark crevices between bright turrets, with the inner glow not uniform.** Cause: boundary depletion (Milne) and
   occlusion (2.4). Remedy: an angle-dependent powder/probability term (Nubis3 dimensional-profile MS) driven by the optical
   depth to the surface.
8. **Aerial perspective on distant clouds.** Distant clouds are lower contrast, bluer or hazier, and their bases blend into
   the horizon haze. Cause: Rayleigh and Mie in-scatter between viewer and cloud. Remedy: apply the atmosphere's
   transmittance and in-scatter at the cloud's transmittance-weighted depth (per pixel, not per scene).
9. **Correct sunset lighting from below.** High clouds are lit orange from under after ground sunset, and the Earth's shadow
   creeps up (2.7). Remedy: compute the sun colour per sample with the atmosphere transmittance *at the sample's altitude*,
   and allow sun directions below the horizon.
10. **Size spectrum and clustering.** Cause: a power law with exponent ~ -1.7 up to a ~1 km break, plus streets and cells (4.3,
    4.5). Remedy: no uniformly sized blobs; organise into streets aligned with the wind or cells with aspect ~35:1.
11. **Cloud shadows on terrain, and on other clouds.** Sharp-edged for low bases (10 m penumbra at 1 km). Remedy: a beer shadow map
    or a vertical optical-depth map; inter-cloud shadows via a coarse light grid.
12. **Rain shafts and virga** as translucent curtains tilted by shear (1.4).
13. **Optical phenomena:** glory around the aircraft shadow on the cloud tops below, fogbow, 22 deg halo in cirrostratus, corona
    round the moon (2.1, 2.3). Cheap decals or analytic terms, high "wow" for a flight sim.
14. **Ice clouds look different from water clouds:** soft, fibrous, wind-stretched, translucent, halos (1.4, 4.4).
15. **Temporal behaviour:** cumulus grow and die in 15 min. Turrets boil upward at 1-3 m/s. Lenticulars stay put while air
    streams through them. Shadows move with the cloud speed (wind at cloud level, not surface wind).
16. **Spectral deep-storm tint:** slight blue-green in Cb cores and the dark "green thunderstorm" look (1.6). A subtle and
    optional per-channel absorption only at tau > 100.

---

## Appendix A: formulas, ready to paste

```glsl
// Henyey-Greenstein
float hg(float c, float g){ float g2=g*g; return 0.0795775*(1.0-g2)/pow(1.0+g2-2.0*g*c,1.5); }
// Draine (alpha=0 -> HG)
float draine(float c, float g, float a){
  float g2=g*g; return 0.0795775*(1.0-g2)/pow(1.0+g2-2.0*g*c,1.5)*(1.0+a*c*c)/(1.0+a*(1.0+2.0*g2)/3.0); }
// Jendersie & d'Eon 2023, d = droplet diameter um, valid 5..50 (params computed on CPU, see 2.2)
float mieApprox(float c, vec4 p /* gHG, gD, alpha, wD */){
  return mix(draine(c,p.x,0.0), draine(c,p.y,p.z), p.w); }
// Extinction from microphysics: lwc g/m3, re um -> 1/m
float betaExt(float lwc, float re){ return 1.5*lwc/re; }   // 1.5*(lwc*1e-3)/(1000*re*1e-6) = 1.5*lwc/re
// Energy-conserving step (Hillaire 2015)
// Sint = (S - S*exp(-st*dx))/st ; L += T*Sint ; T *= exp(-st*dx)
// Two-stream slab reflectance, conservative
float slabR(float tau, float g){ float t=(1.0-g)*tau; return t/(2.0+t); }
// LCL (m above the parcel level), Lawrence 2005
float lcl(float T_C, float Td_C){ return 125.0*(T_C-Td_C); }
```

Note `betaExt(0.3, 10) = 0.045 1/m`, matching the table in 1.5. (Units check: 1.5 × 3e-4 kg/m^3 / (1000 kg/m^3 × 1e-5 m) = 0.045.)

```js
// CPU: Jendersie-d'Eon parameters for 5 <= d <= 50 um
function mieParams(d){
  return { gHG: Math.exp(-0.0990567/(d-1.67154)),
           gD:  Math.exp(-2.20679/(d+3.91029) - 0.428934),
           alpha: Math.exp(3.62489 - 8.29288/(d+5.52825)),
           wD:  Math.exp(-0.599085/(d-0.641583) - 0.665888) };
}
```

## Appendix B: what could not be verified in this pass

* The Hillaire 2016 course notes PDF (the EA CDN refused the fetch): its exact octave count and a, b, c, the beer shadow map channel layout, and
  the temporal scheme are given from memory and marked.
* The Nubis 2017 and 2022 slide content (the CDN PDF refused); only the 2023 Nubis3 deck was read.
* The Bouthors 2008 paper text (HAL bot wall): the summary is from memory.
* MSFS cloud internals: no public technical source found.
* The exact per-wavelength co-albedo digits (1.6) and the ice halo parametrisation (2.3).
