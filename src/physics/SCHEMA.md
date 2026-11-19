# Flight-model configuration schema (`src/aircraft/<id>/physics.js`)

One declarative object per aircraft, `export default { schema: 1, ... }`. The engine (`src/physics/`) is generic:
everything aircraft-specific is in this file, in the aircraft's `geometry.js` (gear contact points, `cgHeight`, engine
positions, wing tips, nose/tail stations) and in the published `specs` of its `index.js` (masses, thrust, wing area,
limits). **Nothing geometric or published is duplicated here** — a key is only needed in `physics.js` when the default
derived from `specs`/`geometry` is not good enough. An empty config (`{ schema: 1 }`) already flies: every parameter
has a category-dependent default (`airliner | transport | bomber` = "heavy", everything else = "fighter").

Reference implementations: `src/aircraft/f16/physics.js` (relaxed-stability FBW fighter, afterburning turbofan) and
`src/aircraft/b738/physics.js` (conventional twin airliner, high-bypass turbofans, 6 flap detents, reversers).

Units: SI, degrees for angles in the config, coefficients per **radian**. Body axes in the config are the project's
three.js-style axes (+X right, +Y up, −Z nose). Sign conventions of derivatives are the textbook (aerospace) ones:
positive `cmde` here means "magnitude of pitch authority", see the tables.

## Workflow for a new aircraft

1. Copy the closest reference config. Delete everything you do not know yet (defaults take over).
2. Fill `targets` with the published performance you want to hit (see §Targets). Wrong or missing targets are the
   usual reason a model "feels wrong".
3. `node tools/flight-test.mjs <id>` — prints measured vs target for every test with PASS/FAIL. `--verbose` adds
   time histories, `--only takeoff,climb` restricts the run, `--list` shows the test names, `--json` is machine output.
4. Tune in this order (each step barely disturbs the previous ones):
   1. **Mass & thrust** (specs) → `rest`, engine static thrust.
   2. **Lift**: `clMax` per flap detent from the stall speeds (`CLmax = 2 W / (rho S Vs²)`), `cla` from aspect ratio
      and sweep, `cl0` from the cruise/approach angle of attack → `stall`, `approach`.
   3. **Drag**: `cd0` + `k` from best L/D (`L/Dmax = 1 / (2 sqrt(cd0 k))`) → `glide`; then the `mach.cd0` column and
      the engine lapse (`throttleRatio`, `milLapse`, `abLapse`, `pressureLimit`, `machLapse`) → `climb`,
      `maxSpeedSL`, `maxSpeedAlt`, `ceiling`, `cruise` fuel flow (then `tsfc`).
   4. **Pitch**: `staticMargin`, `cmq`, `cmde` → `dynamics` (short period / phugoid), `takeoff` rotation, `trim`.
   5. **Roll / yaw**: `clda`, `clp` (steady roll rate ≈ `-clda·da / clp · 2V/b`), `cnb`, `cnr`, `clb` → `roll`,
      `dynamics` (dutch roll, spiral), `turn`.
   6. **Gear / brakes** → `takeoff`, `landing`, `rest`.
   7. **FCS limits** (`nzMax`, `alphaMax`, `rollRate`) → `turn`, `roll`, `stall`.
5. `node --test` runs the engine's unit tests plus the flight-test of every aircraft that has a tuned config.

## Top level

| key | meaning |
|---|---|
| `schema` | `1`. (A file with `stub: true` is ignored and pure defaults are used.) |
| `mass`, `aero`, `controls`, `engines`, `gear`, `structure`, `limits`, `fcs`, `autopilot` | sections below |
| `hook: true` | arrestor hook fitted (carrier aircraft); `hookToggle` command, traps on a surface of type `deck` |
| `canopy: false` | no opening canopy (default: fighters have one) |
| `targets` | performance targets for `tools/flight-test.mjs` (not used by the engine) |

## `mass`

| key | default | how to get it |
|---|---|---|
| `empty` | `specs.emptyMass` | operating empty mass, kg |
| `payload` | `specs.typicalMass − empty − fuel` | crew, stores, passengers, kg |
| `fuel` | 60 % of capacity | fuel at start, kg (`init.fuel` overrides: ≤1 = fraction, >1 = kg) |
| `fuelCapacity` | `specs.fuelCapacity` | kg |
| `inertia: { ixx, iyy, izz, ixz, atMass }` | from `gyration` | kg·m² about body axes at mass `atMass`; scaled linearly with current mass. Use published values when they exist (Stevens & Lewis, NASA CR reports). |
| `gyration: { rx, ry, rz }` | .25/.37/.45 heavy, .24/.36/.47 fighter | non-dimensional radii (Roskam/Raymer tables): `Ixx = m (b·rx/2)²`, `Iyy = m (L·ry/2)²`, `Izz = m ((b+L)/2 · rz/2)²` |
| `mtow` | `specs.maxTakeoffMass` | informational |

## `aero`

Coefficient build-up on reference area `S`, span `b`, chord `c`. Lift blends between an attached-flow line and a
flat-plate post-stall model with a sigmoid in angle of attack; the blend centre is solved at load time so that the
peak equals the `clMax` you specify, for every flap detent and Mach number.

`ref: { area, span, chord }` — default `geometry.wingArea`, `geometry.span`, mean chord `1.08 S/b`.

`lift`

| key | default | notes |
|---|---|---|
| `cla` | Helmbold from aspect ratio | lift-curve slope per rad at low Mach. Airliners 5–6, fighters 3–4, slender deltas 2–2.8 |
| `cl0` | 0.2 heavy / 0.05 fighter | CL at zero body AoA (camber + wing incidence) |
| `clMax` | 1.4 / 1.5 | clean maximum lift, from the clean 1 g stall speed |
| `clMaxNeg` | 0.7 clMax | inverted |
| `sharpness` | 40 / 12 | stall abruptness. 30–45 = airliner wing (sharp break, wing drop), 8–14 = strakes/delta (gentle, lift well past 30°) |
| `postStallCl` | 1.1 | flat-plate lift amplitude (`CL = k sin 2α`) |
| `cd90` | 1.25 | drag coefficient broadside-on |
| `spoiler` | 0 | fraction of wing lift dumped by full spoilers |

`drag`: `cd0` (0.02; used only if `mach.cd0` is absent), `k` or `oswald` (induced drag factor, default
`1/(π AR 0.8)`), `clMinDrag`, `gear` (0.02), `speedbrake` (0.04), `spoiler` (0.05), `beta` (cross-flow drag, 1.1),
`elevator`/`aileron`/`rudder` (trim-drag terms per rad²-ish), `splitRudder` (drag of fully opened split rudders).

`mach: { m: [...], cla, clMax, cd0, k, xac, ctrl }` — optional columns over the Mach breakpoints `m` (linear
interpolation, clamped). Any missing column uses a generic compressibility model driven by `mcrit`, `cdWave`,
`sweepDeg`.

| column | meaning |
|---|---|
| `cla` | **ratio** to the low-speed slope (Prandtl–Glauert rise, transonic peak, supersonic decay `4/sqrt(M²−1)`) |
| `clMax` | **ratio** `CLmax(M)/CLmax(0)` — buffet/shock-stall boundary. Airliners fall to ~0.4–0.5 at MMO |
| `cd0` | **absolute** zero-lift drag incl. wave drag. Tune the transonic hump with `maxSpeedSL`/`maxSpeedAlt` |
| `k` | **absolute** induced-drag factor (grows supersonically ≈ `1/CLα`) |
| `xac` | aft shift of the aerodynamic centre in chords (0 → ~0.15–0.2 supersonic): adds to the static margin (Mach tuck) |
| `ctrl` | control-power ratio (shock-induced loss) |

`pitch`: `staticMargin` (fraction of chord, + = stable; airliners 0.15–0.3, relaxed-stability fighters −0.02…0.05),
`cm0`, `cmq` (pitch damping, −5…−8 fighters, −15…−25 airliners), `cmde` (elevator/stabilator power per rad,
positive number, 0.6–1.3), `clde` (lift of the tail), `cmPostStall` (nose-down moment when stalled: −0.3 gentle,
−1.4 = strong natural recovery; near 0 or positive = deep-stall tendency), `cmGear`, `cmSpeedbrake`, `cmSpoiler`.

`side`: `cyb` (−0.6…−1.2), `cydr`, `cyCross`.

`roll`: `clb` (dihedral effect, −0.05…−0.15), `clbCl` (extra per CL — swept wings), `clp` (roll damping −0.3…−0.5),
`clr`, `clrCl`, `clda` (aileron power per rad), `cldt` (differential tail), `cldr`, `clSpoiler` (roll spoilers),
`qReversal` (dynamic pressure of aileron reversal, Pa; 0 = never).

`yaw`: `cnb` (weathercock stability 0.1–0.25), `cnr` (−0.15…−0.4), `cnp`, `cnpCl`, `cnda` + `cndaCl`
(adverse yaw, grows with CL), `cndr` (rudder power), `cnSpoiler`, `alphaDir: [a0, a1]` (deg; directional stability
fades between these angles of attack — fin blanketing), `cnbPostStall` (value beyond `a1`; negative = departs/spins),
`cnbMach`, `rudderLoss`.

`stall`: `wingDrop` (random roll-off moment near CLmax; 0.02 airliner, 0.01 fighter, 0 = none), `aileronLoss`,
`clpPost` (positive = autorotation tendency), `buffetMargin` (deg before CLmax where buffet starts), `buffetCl`,
`warnMargin` (deg before CLmax for `state.stallWarning`).

`flaps: { detents: [...], time, slatTime, takeoff, landing, autoWithGear }` — each detent
`{ name, deg, pos (0..1 for the visual), slat (0..1), dcl0, dcd0, dcm0, kFactor, clMax }`. `clMax` is the total
CLmax in that configuration (from the stall speed at that flap setting); `dcl0` is the lift increment at constant
AoA (≈ 0.9·ΔCLmax for Fowler flaps). `takeoff`/`landing` are detent indices used for ground / approach starts.
`autoWithGear: true` ties the flaps to the gear handle (F-16 style TEF).

`slat: { dAlphaStall, dcd0, auto: { alpha: [a0, a1], machFade: [m0, m1], gearDown } }` — leading-edge devices.
`dAlphaStall` is the stall-angle gain (deg) when fully extended; `auto` schedules them with AoA (LEF/automatic
slats), otherwise they follow the flap detents' `slat` value.

`sweep: { time, auto: [[mach, pos], ...], effects: { cla, clMax, cd0, wave, k, xac, damp, span } }` — variable
geometry (F-14, B-1, Tornado). `effects` are the multipliers/shifts at full sweep; `auto` is the Mach schedule;
`wingSweepToggle` cycles auto → forward → mid → aft.

`mcrit`, `cdWave`, `sweepDeg` — generic compressibility model inputs. `groundEffect: false` disables ground effect.

## `controls`

`elevator | aileron | rudder: { max (deg), rate (deg/s), tau (s) }`, `rudder.qBlowdown` (Pa; rudder authority falls
as 1/q above it), `rudder.split: true` (B-2 style drag rudders: yaw power still comes from `yaw.cndr`, each deflection costs
`drag.rudder`, and both sides open together with the speedbrake, adding `drag.splitRudder`),
`diffTail: { max }` (tailerons), `trim: { max (deg), rate (1/s), authority }`, `speedbrake: { time }`,
`spoilers: { flightMax, rollGain, rollDeadband, rollMax, time, ground, autoGround }`.

State output convention (`state.surfaces`): `elevatorL/R` + = trailing edge up, `aileronR` + / `aileronL` − = roll
right, `rudder` + = nose right, everything else 0..1.

## `engines`

`type`: `turbofan-hb` (airliners), `turbofan-lb`, `turbofan-ab` (fighters), `turbojet-ab` (J58/J79 class). Default
from `specs.engineType`. `count` from `specs.engineCount`; positions/nozzle radii from `geometry.engines` (cycled if
fewer are listed). Any key can be overridden per engine with `each: [{...}, {...}]`.

| key | meaning / tuning |
|---|---|
| `thrustMil`, `thrustMax` | sea-level static thrust per engine, N (default `specs.thrustDry` / `specs.thrustMax`) |
| `throttleRatio` | Mattingly θ-break: ratio of total temperature below which the engine is pressure-limited. >1 keeps thrust up at speed/altitude; <1 gives an installed static loss |
| `machLapse` | high-bypass only: thrust loss per Mach (0.45–0.6) |
| `milLapse`, `abLapse` | temperature lapse above the θ-break, dry / afterburning |
| `pressureLimit` | cap on the ram pressure ratio (burner-pressure / q limit at low altitude, high Mach) |
| `altLapse` | exponent on density ratio (1 = thrust ∝ δ) |
| `inlet` | `subsonic`, `pitot` (normal-shock loss), `ramp` (variable geometry, MIL-E-5008B recovery) |
| `maxMach` | hard thrust fade above this Mach (inlet limit) |
| `thrustTable: { mach, alt, mil: [[...]], ab: [[...]] }` | optional 2-D table (rows = altitude, factors of SLS thrust); replaces the analytic lapse |
| `n1Idle`, `n2Idle`, `spoolUp`, `spoolDown` | idle speeds and spool time constants (s); spool-up is slower from idle |
| `idleThrust`, `thrustExp` | idle thrust fraction; thrust ∝ N1^exp |
| `tsfc: [static, perMach]`, `tsfcAb` | 1/h (lb/lbf/h); `idleFuelFlow` kg/s |
| `egt: [idle, mil, ab]` | °C |
| `abMinFraction`, `abLightTime` | afterburner: lever 0.9→1.0 = min→max AB, light-off delay |
| `reverser: { fraction, time, power, minSpeed, stowSpeed }` | thrust reversers: deploy automatically after touchdown together with the ground spoilers (lever at idle, above `minSpeed`), stow below `stowSpeed` or when the lever is advanced. Needs `controls.spoilers` |
| `vectoring: { pitch (deg), rate, qFade }` | pitch thrust vectoring driven by the pitch channel |
| `pos`, `thrustLineOffset`, `cantDeg`, `startTime` | geometry overrides, start sequence duration |

## `gear`

Wheel positions, radii, `steerable`, `braked` come from `geometry.gear`. `nose: {...}` / `main: {...}` (or
`wheels: { <name>: {...} }`) accept `travel`, `staticDeflection`, `damping`, `reboundDamping`, `gasRatio`
(air-spring static/extended force ratio, 4), `relaxation` (tyre relaxation length).

`retractTime`, `extendTime`, `steerMax` (deg at walking pace), `steerLatG` (the steering angle is reduced with speed
to this lateral acceleration), `steerRate`, `brakeMu`, `antiskid`, `rollingMu`, `corneringStiffness`,
`maxSinkRate` (touchdown flagged `hard` above it), `crashSinkRate`, `arrestDecel`, `catapult: { accel, stroke }`.

## `structure`

Contact points are generated from the geometry (nose, tail, belly, wing tips, underslung nacelles).
`tailStrikeDeg` (pitch attitude at which the tail touches with the struts compressed), `tailZ`, `bellyY`, `noseY`,
`points: [{ name, type: 'belly'|'tail'|'nose'|'wingtip'|'nacelle', pos: [x, y, z] }]` for extra points.

## `limits`

`gMax`, `gMin` (specs), `vmo` (CAS m/s), `mmo`, `ultimateFactor` (structural failure at `gMax × factor`),
`overspeedFactor`, `gearSpeed`.

## `fcs`

`type`: `fbw-fighter` (G / AoA-limited rate command, roll-rate command, departure resistance), `fbw-airliner`
(normal law: load-factor demand with flight-path hold, 67°/33° bank, pitch, AoA and overspeed protections),
`conventional` (direct surfaces + q-feel, stabiliser trim, trim follow-up, yaw damper).

Common: `nzMax`, `nzMin`, `alphaMax`, `alphaMin`, `alphaStallMargin`, `alphaGain`, `nzGain`, `pitchRateMax`,
`pitchBandwidth`, `pitchIntegral`, `pitchGainMax`, `rollRate`, `rollBandwidth`, `rollGainMax`, `rollAlphaFade`,
`gearDown: { nzMax, alphaMax, rollRate, pitchRateMax }` (landing gains), `stickShape`, `yawDamper`, `yawBandwidth`,
`yawGainMax`, `betaGain`, `sasAuthority`, `ari` (aileron–rudder interconnect), `pedalAuthority`.
FBW-airliner: `bankMax`, `bankNeutral`, `pitchMax`, `pitchMin`. Conventional: `feelQ`, `feelMin`, `rollFeelQ`,
`trimFollowUp`.

Keyboard aids (all types, on by default): `rotationAssist` + `rotationRate` + `rotationPitchMax` (a held-back stick
on the wheels / in the flare is kept to a sensible rotation rate and short of the tail-strike attitude),
`groundYawAssist` (pedals command yaw rate on the runway, heading held against crosswind and asymmetric thrust).

## `autopilot`

`vsMax`, `accelMax`, `altGain`, `vsGain`, `bankMax`, `turnRate`, `bankGain`, `rollRateMax`, `throttleKp`,
`throttleKi`, `throttleMax`, `stickDisengage`.

## `targets`

`[value, relativeTolerance]` pairs unless noted: `stallSpeedLanding`, `stallSpeedClean` (m/s CAS), `takeoffRoll`,
`landingRoll` (m), `climbRate` (m/s at `climbSpeed`), `maxSpeedSL` (Mach, or CAS with `maxSpeedSLisCas`),
`maxSpeedAlt` at `maxSpeedAltitude`, `ceiling` (m), `ceilingMach`, `rollRate` (deg/s at `rollSpeed`),
`sustainedTurn` (deg/s at `sustainedTurnSpeed`, `sustainedTurnAltitude`), `instantTurn` at `instantTurnSpeed`,
`maxG` at `maxGSpeed`, `glideRatio` at `glideSpeed`, `cruise: { altitude, mach, fuelFlow: [kg/h, tol] }`,
`approachAoA` (deg), `rotateSpeed`, `rotatePitch`, `climbPitch`.

## Recipes for the rest of the roster

- **Twin / quad jets (F-15, F-22, 747, B-52)**: only `specs.engineCount` and `geometry.engines`. Engine-out yaw,
  windmilling drag and the rudder needed follow from the positions. Per-engine differences via `engines.each`.
- **Thrust vectoring (F-22, Su-30)**: `engines.vectoring: { pitch: 20, rate: 40 }`; raise `fcs.alphaMax` (the nozzles
  keep pitch authority where the tail has none) and set `yaw.cnbPostStall` ≥ 0 for controlled post-stall flight.
- **Variable sweep (F-14, B-1B)**: `aero.sweep` with the Mach schedule; tune the forward-sweep aircraft first, then
  `effects` against the swept performance (max Mach, supersonic L/D).
- **Flying wing with split drag rudders (B-2)**: `controls.rudder.split: true`, `drag.splitRudder`, `drag.rudder`
  ≈ 0.02, small `cnb` (≈0.01–0.03), `cnr` ≈ −0.03, modest `cndr`, `cldr: 0`; `fcs.type: 'fbw-airliner'` with a
  strong `betaGain` (the FCS supplies the directional stability the airframe lacks).
- **Mach 3 delta (SR-71, XB-70)**: `turbojet-ab` with `inlet: 'ramp'`, `throttleRatio` ≈ 1.25–1.3 (thrust rises with
  Mach), `maxMach`, or a `thrustTable` from the flight manual; full `mach` tables to M 3.5 with `xac` shift;
  low `cla` (≈2.3), `sharpness` ≈ 8, no flaps; `limits.vmo` in KEAS, `mmo` 3.3.
- **Heavy transports (747, C-5, B-52)**: `gyration` radii, long `spoolUp` (7–8 s), `fcs.pitchRateMax` ≈ 5,
  `rotationRate` ≈ 2.5, `autopilot.bankMax` 25. Multi-bogie gear: list every bogie in `geometry.gear`.
- **Carrier aircraft (F/A-18, F-14)**: `hook: true`, `gear.catapult`, high `gear.maxSinkRate` / `crashSinkRate`
  (7–8 m/s), stiff struts (`main.staticDeflection`). The deck is any surface whose `groundAt().type` is `deck`; its
  `velocity` is honoured.
