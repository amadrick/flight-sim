# Aircraft reference data sheets (wave-2 roster)

Compiled for the modelling and flight-dynamics agents. Each aircraft has a sheet `<id>.md` plus `src/aircraft/<id>/geometry.js` and `src/aircraft/<id>/specs.js` (same shape as the `f16` / `b738` definitions, without the `physics` / `createVisual` glue; the integrator merges `specs.js` into the aircraft `index.js`). The two aircraft already in the sim (`f16`, `b738`) are not repeated here.

| id | name | category | length (m) | span (m) | MTOW (kg) | thrust per engine (kN) | max Mach | wing loading (kg/m², typical) | T/W (max thrust, typical) |
|---|---|---|---|---|---|---|---|---|---|
| [`f22`](f22.md) | F-22A Raptor | fighter | 18.92 | 13.56 | 38,000 | 2 × 156 (dry 116) | 2.25 | 346 | 1.18 |
| [`f35`](f35.md) | F-35A Lightning II | fighter | 15.67 | 10.7 | 31,800 | 1 × 191 (dry 125) | 1.6 | 468 | 0.97 |
| [`fa18`](fa18.md) | F/A-18E Super Hornet | fighter | 18.31 | 13.62 | 29,900 | 2 × 98 (dry 62) | 1.8 | 452 | 0.95 |
| [`f15`](f15.md) | F-15E Strike Eagle | fighter | 19.43 | 13.05 | 36,700 | 2 × 129 (dry 79) | 2.5 | 442 | 1.05 |
| [`f14`](f14.md) | F-14D Tomcat | fighter | 19.1 | 19.55 | 33,720 | 2 × 123 (dry 74) | 2.34 | 505 | 0.95 |
| [`a10`](a10.md) | A-10C Thunderbolt II | attack | 16.26 | 17.53 | 22,950 | 2 × 40 | 0.75 | 330 | 0.53 |
| [`sr71`](sr71.md) | SR-71A Blackbird | recon | 32.74 | 16.94 | 77,100 | 2 × 145 (dry 111) | 3.3 | 371 | 0.48 |
| [`b2`](b2.md) | B-2A Spirit | bomber | 20.9 | 52.4 | 171,000 | 4 × 77 | 0.95 | 293 | 0.22 |
| [`c17`](c17.md) | C-17A Globemaster III | transport | 53.04 | 51.75 | 265,350 | 4 × 180 | 0.77 | 567 | 0.37 |
| [`b748`](b748.md) | Boeing 747-8 Intercontinental | airliner | 76.25 | 68.4 | 447,700 | 4 × 296 | 0.9 | 650 | 0.34 |
| [`b77w`](b77w.md) | Boeing 777-300ER | airliner | 73.86 | 64.8 | 351,500 | 2 × 513 | 0.89 | 641 | 0.37 |
| [`b789`](b789.md) | Boeing 787-9 Dreamliner | airliner | 62.81 | 60.12 | 254,000 | 2 × 330 | 0.9 | 531 | 0.34 |
| [`a320`](a320.md) | Airbus A320neo | airliner | 37.57 | 35.8 | 79,000 | 2 × 121 | 0.82 | 522 | 0.38 |
| [`a388`](a388.md) | Airbus A380-800 | airliner | 72.72 | 79.75 | 575,000 | 4 × 311 | 0.89 | 533 | 0.28 |

Span is the full-extension span (F-14: 20° sweep; F/A-18E: with wingtip rails). Thrust is the maximum (afterburning) value, with the dry value in brackets when different.

## Conventions

- **Body axes** (ARCHITECTURE.md §2): origin at the nominal CG, +X right wing, +Y up, −Z nose, metres. A sheet position is given either in body z or as "d", the distance aft of the nose tip; body z = d + noseZ (noseZ = −(CG distance from the nose), also stated in each sheet). The generated station and wing tables show both.
- **CG placement**: the CG is at about 25–30 % MAC of the tabulated planform (checked numerically; the MAC is computed from the section table of each sheet). The F-14 is the exception: its CG is quoted relative to the movable wing panel only (see the sheet).
- **Fuselage reference line (FRL)** is stated per sheet as a body-y offset; the station table gives the half-width and the heights above and below this line.
- **Gear**: `geometry.gear` is ordered nose, left, right, then extra legs (`bodyLeft`/`bodyRight` on the 747-8 and A380; the 6-wheel bogies of the C-17, 777, 787 are one entry per side at the bogie centre). All contact points satisfy `pos[1] = −cgHeight` (level ground, static compression), the main gear sits ~0.6–1.2 m (fighters) to 2–3 m (airliners) aft of the CG so the nose leg carries ~8–13 % of the weight; wheelbase = distance between the nose contact and the mean of the main contacts.
- **Wing planform tables** are linear sections (y from the centreline, leading-edge d, chord). The area integrated from the table (root chord carried to the centreline) is compared with the published reference area in each sheet (within ±5 % except where noted: F-14 glove area added as a lump, B-2 W-trailing-edge approximated). Do not treat the table as exact outline; use it for proportions, then scale to `geometry.wingArea`.
- **Units**: SI throughout in `specs.js` (N, kg, m, m/s); the sheets quote ft/lbf/kt in brackets where that is how the figure is published. Mass of fuel in `fuelCapacity` is in kg (≈ 0.80 kg/L for Jet A/JP-8; JP-7 0.78 for the SR-71). Thrust is static sea-level thrust per engine.
- **Specs fields**: `stallSpeed` is the 1-g stall speed in the landing configuration at typical landing weight (fighters: not a hard limit because of FBW AoA protection); `approachSpeed` is the threshold/approach speed; `rotateSpeed` is a typical rotation speed at moderate take-off weight; `cruiseSpeed` follows the `f16`/`b738` convention (IAS/EAS-ish, not TAS). `maxSpeedSeaLevel` is limited by structure/q (airliners: Vmo; fighters: roughly Mach 1.2).
- **Moment of inertia**: where the sheet gives numbers they are radius-of-gyration estimates (k = fraction of span or length) at typical mass, **not** published data; derive better values if needed.
- **hudType**: military aircraft with a HUD (all fighters and the A-10) use `'fighter'`. `'airliner'` is used for the transports and airliners, and also for the B-2 and SR-71 (the B-2 cockpit is a large-aircraft glass cockpit; the SR-71 has no HUD, only conventional instruments) and the C-17 (it has HUDs, but the sim's transport-style instrument layout fits it better). The integrator may override any of these.
- **Liveries** are fictional: no real airline names, logos or registrations; the sheets give generic colour zones and layout only.
- Values marked with "~" are estimates. Published figures (manufacturer data, flight manuals, standard references) are limited to length, span, height, wing area, weights, engine thrust ratings and headline performance; station tables, chords, tail/pylon dimensions, gear positions (apart from published wheelbase/track where known) and inertia are estimates from proportions. Each sheet ends with a "Confidence notes" section.
