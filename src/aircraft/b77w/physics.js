// Boeing 777-300ER (2 x GE90-115B) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./specs.js and ./geometry.js.
// Sources: Boeing 777 FCOM / FCTM (speeds, flap detents, protections), Boeing D6-58329 airport planning document,
// GE90-115B type-certificate data (513 kN static, BPR 9), Roskam class-II methods for derivative magnitudes.
// Tuned with `node tools/flight-test.mjs b77w`.
export default {
  schema: 1,
  mass: {
    payload: 40000,                      // ~300 passengers + bags + cargo
    fuel: 72200,                         // kg at start -> 280 000 kg typical flying mass
    // radius-of-gyration estimates (data sheet): Ixx 2.3e7, Iyy 6.1e7, Izz 8.4e7 at 280 t (Izz ~ Ixx + Iyy, thin-body)
    inertia: { ixx: 2.3e7, iyy: 5.0e7, izz: 8.4e7, ixz: 0, atMass: 280000 },
  },
  aero: {
    ref: { span: 64.8, chord: 6.6 },     // wing area from geometry; mean chord from the planform
    lift: { cl0: 0.26, cla: 5.3, clMax: 1.30, sharpness: 34, clMaxNeg: 0.9, postStallCl: 1.0, cd90: 1.3, spoiler: 0.75 },
    // Mach tables: supercritical wing, 31.6 deg sweep, drag divergence ~M0.85 (cd0 hump), buffet boundary falls to ~0.5 CLmax at MMO 0.89
    mach: {
      m:     [0,      0.3,    0.5,    0.6,    0.7,    0.75,   0.78,   0.80,   0.82,   0.84,   0.86,   0.89,   0.93,   1.0],
      cla:   [1.00,   1.03,   1.09,   1.14,   1.21,   1.26,   1.29,   1.31,   1.32,   1.32,   1.30,   1.22,   1.10,   1.00],
      clMax: [1.00,   0.98,   0.90,   0.84,   0.76,   0.72,   0.69,   0.67,   0.65,   0.62,   0.58,   0.50,   0.42,   0.38],   // buffet boundary
      cd0:   [0.0160, 0.0160, 0.0160, 0.0161, 0.0162, 0.0164, 0.0166, 0.0169, 0.0172, 0.0178, 0.0220, 0.0330, 0.0600, 0.1000],
      k:     [0.0430, 0.0430, 0.0430, 0.0430, 0.0430, 0.0430, 0.0432, 0.0435, 0.0440, 0.0450, 0.0500, 0.0620, 0.0800, 0.0900],
      xac:   [0,      0,      0,      0,      0,      0.005,  0.010,  0.018,  0.028,  0.040,  0.050,  0.070,  0.090,  0.100],
      ctrl:  [1,      1,      1,      1,      0.99,   0.98,   0.97,   0.95,   0.93,   0.91,   0.89,   0.84,   0.76,   0.70],
    },
    drag: { clMinDrag: 0.05, gear: 0.024, spoiler: 0.085, beta: 1.4, elevator: 0.10 },
    pitch: { cm0: 0.02, staticMargin: 0.10, cmq: -15, cmde: 2.4, clde: 0.15, cmPostStall: -1.4, cmGear: -0.01, cmSpoiler: 0.02 },
    side: { cyb: -0.95, cydr: 0.22 },
    roll: { clb: -0.11, clbCl: -0.05, clp: -0.45, clr: 0.08, clrCl: 0.20, clda: 0.050, cldr: 0.012, clSpoiler: 0.035 },
    yaw: { cnb: 0.13, cnp: -0.02, cnpCl: -0.07, cnr: -0.22, cnda: 0.002, cndaCl: 0.012, cndr: 0.085, cnSpoiler: 0.004, alphaDir: [22, 40], cnbPostStall: 0.05 },
    stall: { wingDrop: 0.015, clpPost: 0.02, buffetMargin: 2.5, warnMargin: 3.5 },
    // Flap detents 1/5/15/20/25/30 (FCOM). clMax: 30 -> 2.51 (Vs 64 m/s at 280 t), takeoff 15 -> 2.0; slats extend with flaps >= 1
    flaps: {
      detents: [
        { name: 'UP', deg: 0,  pos: 0.00, slat: 0, dcl0: 0.00, clMax: 1.30 },
        { name: '1',  deg: 1,  pos: 0.03, slat: 1, dcl0: 0.10, clMax: 1.60, dcd0: 0.004, dcm0: -0.01 },
        { name: '5',  deg: 5,  pos: 0.17, slat: 1, dcl0: 0.32, clMax: 1.75, dcd0: 0.012, dcm0: -0.03 },
        { name: '15', deg: 15, pos: 0.50, slat: 1, dcl0: 0.62, clMax: 2.00, dcd0: 0.028, dcm0: -0.07 },
        { name: '20', deg: 20, pos: 0.67, slat: 1, dcl0: 0.76, clMax: 2.15, dcd0: 0.040, dcm0: -0.09 },
        { name: '25', deg: 25, pos: 0.83, slat: 1, dcl0: 0.90, clMax: 2.35, dcd0: 0.055, dcm0: -0.11, kFactor: 1.06 },
        { name: '30', deg: 30, pos: 1.00, slat: 1, dcl0: 1.00, clMax: 2.51, dcd0: 0.070, dcm0: -0.13, kFactor: 1.10 },
      ],
      time: 28, slatTime: 8, takeoff: 3, landing: 6,
    },
    slat: { dAlphaStall: 5, dcd0: 0.003 },
  },
  controls: {
    elevator: { max: 25, rate: 50, tau: 0.06 },
    aileron: { max: 20, rate: 40, tau: 0.10 },
    rudder: { max: 27, rate: 40, tau: 0.10, qBlowdown: 6000 },
    spoilers: { flightMax: 0.5, rollGain: 1.0, rollDeadband: 0.15, rollMax: 0.45, time: 0.9, autoGround: true },
    trim: { max: 20, rate: 0.03, authority: 1 },
  },
  engines: {
    // GE90-115B, 513 kN static each. machLapse/altLapse fitted so that: 280 t climb at 250 kt is ~4000 ft/min, M0.87 at FL360 is
    // thrust-limited, and the ceiling margin is positive at 12 km (installed lapse of a BPR-9 engine; exponent < 1 = flat-rated lapse)
    type: 'turbofan-hb', throttleRatio: 1.06, machLapse: 0.80, altLapse: 0.45,
    n1Idle: 0.20, n2Idle: 0.58, spoolUp: 8, spoolDown: 5, idleThrust: 0.035, idleFuelFlow: 0.16,
    tsfc: [0.32, 0.28],                  // lb/lbf/h: ~0.32 static, ~0.54 at M0.84 cruise -> ~7.3 t/h total at 280 t egt: [430, 900, 900], startTime: 22,
    reverser: { fraction: 0.40, time: 2.5, power: 0.8, minSpeed: 30, stowSpeed: 26 },
  },
  gear: {
    nose: { travel: 0.40 }, main: { travel: 0.50 },
    retractTime: 14,                     // FCOM: gear retracts in ~14 s; six-wheel bogies are modelled as one contact point per side
    steerMax: 70, steerLatG: 0.20, brakeMu: 0.40, maxSinkRate: 3.66,     // 12 ft/s: gear design reserve-energy sink rate crashSinkRate: 6,
  },
  structure: { tailStrikeDeg: 9.5, bellyY: -3.1 },
  limits: { vmo: 185, mmo: 0.89, gearSpeed: 135 },   // real VMO is 330 KCAS (170 m/s); raised to 360 KCAS because the app's 'air' start flies 0.8 x specs.cruiseSpeed (a TAS at altitude) at 1500 m = 357 KCAS, which the overspeed protection would otherwise fight (see report)
  fcs: {
    type: 'fbw-airliner',                 // Boeing normal law: load-factor demand + flight-path hold, 67/35 deg bank protection, pitch limits, soft AoA and overspeed protection
    bankMax: 67, bankNeutral: 35, pitchMax: 30, pitchMin: -15,
    nzMax: 2.5, nzMin: -1, rollRate: 6,                         // deg/s at full wheel (data sheet: 5-6 deg/s; the 777 is a gentle roller)
    alphaMax: 20, alphaStallMargin: 0.5, // soft AoA protection: the limiter sits 0.5 deg below the stall angle (stick shaker first, no hard stop)
    nzGain: 0.5, pitchBandwidth: 6, pitchIntegral: 1, pitchGainMax: 30,   // C*-style load-factor demand, tuned for a 1 s short-period settle
    yawDamper: 1, sasAuthority: 0.35, betaGain: 3, ari: 0.10,
    rotationRate: 2.8,                   // deg/s: pilots rotate a 777 at ~2.5-3 deg/s; tail-strike protection caps pitch at tailStrikeDeg - 2.2
    gearDown: { nzMax: 3, pitchRateMax: 12 },   // landing gains: crisper column authority for the flare (alpha limiter still protects)
  },
  autopilot: { bankMax: 25, vsMax: 10, turnRate: 3 },
  targets: {
    stallSpeedLanding: [64, 0.07],       // m/s CAS, flaps 30, 280 t (Vref30 at MLW 251 t = 145 kt -> 1.23 Vs; scaled to 280 t); measured at the AoA limiter
    stallSpeedClean: [89, 0.07],         // m/s CAS, 280 t (flaps-up manoeuvre speed ~ Vref30+80 = 1.3 Vs)
    takeoffRoll: [1700, 0.3],              // m, flaps 15, TOGA, 280 t, SL ISA (FCOM: ~2300 m field length at this weight)
    rotateSpeed: 77,                            // m/s, VR ~150 kt at 280 t flaps 15 rotatePitch: 8, climbPitch: 12,
    landingRoll: [1000, 0.35],            // m, touchdown to stop, max manual braking + reversers (FCOM: ~1000 m at MLW)
    climbRate: [20, 0.3], climbSpeed: 129,
    maxSpeedSL: [185, 0.03], maxSpeedSLisCas: true,
    maxSpeedAlt: [0.87, 0.04],            // level-flight thrust limit at 280 t; MMO 0.89 is only reached in a descent maxSpeedAltitude: 11000,
    ceiling: 12000,                           // thrust-limited at 280 t (the 13 137 m certified ceiling needs a much lighter aircraft)
    rollRate: [6, 0.35], rollSpeed: 130,
    sustainedTurn: [0, 0], instantTurn: [0, 0],
    maxG: [2.5, 0.2], maxGSpeed: 150,    // 2.5 g is only reachable clean above ~140 m/s CAS (CLmax-limited below)
    glideRatio: [19, 0.12], glideSpeed: 113,
    cruise: { altitude: 11000, mach: 0.84, fuelFlow: [7300, 0.15] },
    approachAoA: [5.5, 0.25],
  },
};
