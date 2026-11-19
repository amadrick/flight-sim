// Northrop Grumman B-2A Spirit (4 × F118-GE-100) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./index.js (specs) and ./geometry.js.
// Sources: docs/aircraft/b2.md (reference sheet), USAF B-2 fact sheet (dimensions, weights, ceiling, range),
// GE F118-GE-100 published data (17 300 lbf, BPR 0.87, non-afterburning), Roskam / Nickel & Wohlfahrt "Tailless
// Aircraft" for the derivative magnitudes of a tailless swept wing. Most handling numbers of the B-2 are classified:
// everything not published is derived from the planform and from the published range / speed / weight figures, and
// is marked as an estimate in the comments.
// Tuned with `node tools/flight-test.mjs b2`.
//
// Type notes
// - Pure flying wing: no fin. Natural directional stability is close to zero (centre-body side area and the 33° LE
//   sweep only); yaw is controlled by the clamshell split drag rudders at 80–97 % semispan (`controls.rudder.split`),
//   and the quadruplex FBW supplies the missing weathercock stability (strong beta feedback + yaw-rate damping).
// - Pitch/roll: four elevons per side + the centre "beaver tail". Elevon lift is large compared with the pitching
//   moment they make (short arm on a tailless wing), so `clde` is high relative to `cmde`.
// - No flaps / slats / spoilers. The elevons droop ~10° symmetrically with the gear down (modelled as an automatic
//   "DROOP" flap detent tied to the gear handle). The split rudders open together as the speedbrake.
// - Very low wing loading (≈ 290 kg/m² at 140 t) and a huge span at a low height → long float in ground effect.
export default {
  schema: 1,
  mass: {
    payload: 6300,                       // 2 crew + 16 × Mk 82 class stores (~3.7 t) + rotary launchers / racks
    fuel: 62000,                         // kg at start -> 140 000 kg typical mission mass (sheet: 130–150 t)
    // Inertia estimate (classified): mass is concentrated in the centre body (engines, bays, inboard fuel) with fuel
    // spread along the wing. Roll radius ≈ 0.15 b, pitch ≈ 5 m (the swept wing spreads mass fore and aft of the CG),
    // and Izz ≈ Ixx + Iyy as for any flat planform. (The sheet's Izz = 3.8e6 from k = 0.25 L is too small for a
    // 52 m wing — a flying wing's yaw inertia is dominated by the span.)
    inertia: { ixx: 8.6e6, iyy: 3.5e6, izz: 11.9e6, ixz: 0, atMass: 140000 },
  },
  aero: {
    ref: { area: 478, span: 52.4, chord: 12.4 },   // MAC 12.4 m integrated from the planform table in the sheet
    // Low aspect ratio (5.74), 33° LE sweep: CLα ≈ 3.9 /rad. Reflexed, self-trimming section → small cl0.
    // CLmax ≈ 1.0 at the ~14° FBW AoA limiter (trimmed: up-elevon trim costs lift on a tailless wing). This sits
    // between the sheet's two (mutually inconsistent) estimates: stall 65 m/s at 110 t (CLmax 0.87) and approach
    // 75 m/s at ~120 t (which would need CLmax ≥ 1.1 for a 1.2 Vs margin). → Vs ≈ 69 m/s at 140 t, approach ≈ 140 kt
    // at a normal ~90–100 t landing weight.
    lift: { cl0: 0.03, cla: 3.9, clMax: 1.00, sharpness: 36, clMaxNeg: 0.6, postStallCl: 1.0, cd90: 1.2 },
    mach: {
      m:     [0,      0.3,    0.5,    0.6,    0.7,    0.75,   0.80,   0.85,   0.88,   0.90,   0.92,   0.95,   0.98,   1.0,    1.1,    1.2],
      cla:   [1.00,   1.03,   1.10,   1.15,   1.22,   1.26,   1.30,   1.33,   1.33,   1.32,   1.28,   1.20,   1.10,   1.05,   0.95,   0.88],
      clMax: [1.00,   0.98,   0.92,   0.87,   0.80,   0.76,   0.71,   0.65,   0.61,   0.58,   0.55,   0.50,   0.46,   0.44,   0.42,   0.40],   // buffet boundary (≈ 1.6 g margin at the M 0.85 cruise)
      // very clean airframe (no fuselage, no tail, wetted/reference area ≈ 2.3): cd0 ≈ 0.0088; the thick centre body
      // gives a drag rise from M 0.85 and a wall just above the published M 0.95 maximum
      cd0:   [0.0088, 0.0088, 0.0088, 0.0088, 0.0089, 0.0090, 0.0091, 0.0095, 0.0102, 0.0111, 0.0126, 0.0150, 0.0200, 0.0280, 0.0450, 0.0500],
      k:     [0.0660, 0.0660, 0.0660, 0.0660, 0.0662, 0.0665, 0.0670, 0.0680, 0.0695, 0.0710, 0.0735, 0.0780, 0.0850, 0.0920, 0.1100, 0.1250],
      xac:   [0,      0,      0,      0,      0,      0,      0.005,  0.012,  0.018,  0.025,  0.032,  0.045,  0.060,  0.070,  0.100,  0.120],
      ctrl:  [1,      1,      1,      1,      1,      0.99,   0.98,   0.95,   0.93,   0.91,   0.88,   0.82,   0.77,   0.75,   0.70,   0.68],
    },
    // L/Dmax = 1 / (2 sqrt(cd0 k)) ≈ 21 (sheet: ~20 aircraft, ~22 wing)
    // speedbrake = both clamshells open (splitRudder); each yaw deflection costs drag.rudder at full opening.
    drag: { clMinDrag: 0.02, gear: 0.010, speedbrake: 0, splitRudder: 0.045, rudder: 0.02, beta: 0.5, elevator: 0.06, aileron: 0.006 },
    // Near-neutral static margin (the real aircraft is FCS-stabilised, slightly unstable at aft CG). Elevon arm is short:
    // ~0.25–0.35 MAC behind the CG, so elevon lift (clde) is as large as the pitching moment (cmde) → non-minimum-phase
    // pitch response, low pitch damping (no tail).
    pitch: { cm0: 0.005, staticMargin: 0.02, cmq: -4.5, cmde: 0.45, clde: 0.45, cmPostStall: -0.2, cmGear: -0.004 },
    side: { cyb: -0.15, cydr: 0.0 },                  // tiny side area, drag rudders make no side force
    // swept wing: dihedral effect grows with CL; elevon roll power over 13–80 % semispan
    roll: { clb: -0.02, clbCl: -0.10, clp: -0.40, clr: 0.05, clrCl: 0.15, clda: 0.08, cldr: 0 },
    // no fin: weathercock stability ~0 (centre body + sweep), weak yaw damping; split-rudder yaw power ≈ ΔCD 0.02 per
    // side at ~23 m arm: Cn ≈ 0.02·23/52.4 ≈ 0.009 at full opening → cndr 0.012 /rad over the 45° normalised range
    yaw: { cnb: 0.015, cnp: -0.01, cnpCl: -0.04, cnr: -0.03, cnda: 0.0, cndaCl: 0.008, cndr: 0.012, alphaDir: [20, 35], cnbPostStall: 0, rudderLoss: 0.2 },
    stall: { wingDrop: 0.008, clpPost: 0.02, buffetMargin: 3, warnMargin: 2.5 },
    flaps: {            // no flaps: the elevons droop ~10° symmetrically with the gear handle
      detents: [
        { name: 'UP', deg: 0, pos: 0 },
        { name: 'DROOP', deg: 10, pos: 1, dcl0: 0.05, clMax: 1.06, dcd0: 0.004, dcm0: -0.015 },
      ],
      time: 4, autoWithGear: true, takeoff: 1, landing: 1,
    },
  },
  controls: {
    elevator: { max: 25, rate: 40, tau: 0.06 },        // elevons + beaver tail, pitch share
    aileron: { max: 25, rate: 50, tau: 0.06 },         // elevons, roll share
    rudder: { max: 45, rate: 60, tau: 0.08, split: true },   // clamshell drag rudders (normalised opening)
    speedbrake: { time: 3 },
  },
  engines: {
    // F118-GE-100: low-bypass (0.87) non-afterburning turbofan; the sheet / specs call it "high bypass", which is wrong.
    type: 'turbofan-lb', thrustMil: 77000, thrustMax: 77000,
    thrustLineOffset: -0.165,            // visual model moved the nozzles 0.165 m down (average); keeps the tuned thrust line
    // Mixed-flow lapse; machLapse 0.2 = installed loss with speed (buried engines, serpentine S-ducts, trough exhausts):
    // 96 % of SLS at M 0.44 / sea level. altLapse 0.9 keeps ~29 % of SLS at FL390 / M 0.85 so that the published cruise
    // (M 0.85 at 12 km, ~88 % lever at 140 t) and the M 0.95 maximum at altitude are reachable.
    throttleRatio: 1.05, milLapse: 3.8, machLapse: 0.20, altLapse: 0.9, inlet: 'subsonic',
    n1Idle: 0.30, n2Idle: 0.62, spoolUp: 5.5, spoolDown: 4, idleThrust: 0.04, idleFuelFlow: 0.12,
    tsfc: [0.62, 0.37], egt: [420, 880, 880], startTime: 30,   // ≈ 0.81 lb/lbf/h at cruise -> 11 000 km on ~70 t fuel
  },
  gear: {
    // twin-wheel nose, 4-wheel bogie mains; carbon brakes with antiskid; no reversers (the sheet's drag chute is not
    // modelled by the engine). Strong rebound damping: the low wing loading makes the aircraft skip on touchdown.
    nose: { travel: 0.35 }, main: { travel: 0.45, reboundDamping: 2 },
    retractTime: 12, extendTime: 15, steerMax: 60, steerLatG: 0.2, brakeMu: 0.42, maxSinkRate: 3.05, crashSinkRate: 6,
  },
  // beaver-tail point (d = 20.9 m, ~3.4 m above the ground, 10.6 m behind the mains) → ~15° with struts compressed
  structure: { tailStrikeDeg: 15, tailZ: 11.5, bellyY: -1.05, noseY: 0.1 },
  limits: { vmo: 280, mmo: 0.95, gearSpeed: 116 },   // ~545 KCAS (sheet), M 0.95, gear 225 KCAS (estimate)
  // Quadruplex FBW, airliner-style protected law (SCHEMA recipe for the B-2): 2.5 g / −1 g, ~14° AoA limiter, bank
  // protection (returns to 40°, hard limit 55°), strong beta feedback + yaw damping through the drag rudders in place
  // of the missing fin. Higher pitch-loop bandwidth because elevon pitch power is low and the response is
  // non-minimum-phase; takeoff-mode stick gain (groundPitchGain) and a 9.5° rotation / flare attitude aid.
  fcs: {
    type: 'fbw-airliner',
    nzMax: 2.5, nzMin: -1, alphaMax: 14, alphaMin: -5, alphaStallMargin: 1.0,
    pitchRateMax: 10, rollRate: 18,
    bankMax: 55, bankNeutral: 40,
    betaGain: 4, yawGainMax: 6, yawBandwidth: 2.5,
    rotationRate: 2.5, rotationPitchMax: 9.5, groundPitchGain: 1.8, pitchBandwidth: 8, pitchGainMax: 10, stickShape: 0.2,
  },
  autopilot: { bankMax: 25, vsMax: 12 },
  targets: {
    stallSpeedLanding: [68, 0.08],            // m/s CAS at 140 t, gear down (elevon droop); sheet: 65 m/s at 110 t
    stallSpeedClean: [71, 0.08],              // 65 m/s at 110 t scaled to 140 t
    rotateSpeed: 78, rotatePitch: 9, climbPitch: 12,
    takeoffRoll: [2100, 0.25],                // m at 140 t (sheet: ~2 300 m heavy)
    landingRoll: [1400, 0.35],                // m, brakes only (no reversers, no spoilers)
    // sheet: ~15 m/s at MTOW; at 140 t, T/W 0.22 and L/D ~20 give V·(T/W − D/W) ≈ 22 m/s at 290 KTAS
    climbRate: [22, 0.25], climbSpeed: 150,   // m/s at sea level, 140 t
    maxSpeedSL: [280, 0.03], maxSpeedSLisCas: true,   // ~545 KCAS placard (sheet); thrust-limited speed is higher
    maxSpeedAlt: [0.95, 0.04], maxSpeedAltitude: 11000,   // published M 0.95 maximum
    ceiling: 13500, ceilingMach: 0.82,        // thrust-limited at 140 t; the published 15 200 m applies at light weight
    rollRate: [18, 0.35], rollSpeed: 150,     // deg/s, FBW roll-rate command (classified; sheet ~12, estimate 15–20)
    sustainedTurn: [0, 0], instantTurn: [0, 0],
    maxG: [2.5, 0.1], maxGSpeed: 160,         // +2.5 g design limit
    glideRatio: [21, 0.12], glideSpeed: 113,  // best L/D speed at 140 t (CL ≈ 0.36)
    cruise: { altitude: 12000, mach: 0.85, fuelFlow: [5700, 0.15] },   // kg/h: 11 100 km range on ~70 t at 250 m/s
    approachAoA: [9.5, 0.25],                 // deg at 157 kt / 140 t (estimate; real value classified)
  },
};
