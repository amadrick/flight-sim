// McDonnell Douglas F-15E Strike Eagle (F100-PW-229 x2) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./index.js (specs) and ./geometry.js.
// Sources: NASA TM-X-72xxx / TP-1538-class F-15 wind-tunnel and flight data (Nguyen et al., NASA TM 72846 "Simulator
// study of stall/post-stall characteristics of a fighter airplane"), Stevens & Lewis (F-15 class inertias and derivative
// magnitudes), F-15E dash-1 style performance, F100-PW-229 data sheet.
// Control law: `conventional` — the real F-15 is hydro-mechanical with a CAS (pitch/roll/yaw dampers), no envelope limiter:
// the stick moves the stabilators directly (with q-feel), the CAS adds rate damping, there is NO G or AoA limiting, and the
// plain-flap, slatless wing buffets hard and then departs if abused. Tuned with `node tools/flight-test.mjs f15`.
export default {
  schema: 1,
  mass: {
    payload: 6000,                       // WSO, 2 CFT structures, 4 AIM-120/9, bombs, pylons, gun ammo
    fuel: 7700,                          // kg at start (internal + CFT) -> 28 000 kg, typical heavy Strike Eagle
    fuelCapacity: 10000,                 // 6100 internal + ~3900 conformal tanks
    inertia: { ixx: 33000, iyy: 190000, izz: 215000, ixz: 3000, atMass: 25000 },   // F-15 class (Stevens & Lewis: 28 700 / 165 100 / 187 900 at ~18.8 t) scaled up for stores
  },
  aero: {
    ref: { span: 13.05, chord: 5.29 },    // reference MAC 5.29 m
    lift: { cl0: 0.24, cla: 3.6, clMax: 1.40, sharpness: 12, clMaxNeg: 0.9, postStallCl: 1.1, cd90: 1.3 },
    mach: {
      m:     [0,      0.4,    0.6,    0.8,    0.9,    0.95,   1.0,    1.1,    1.2,    1.4,    1.6,    1.8,    2.0,    2.2,    2.5],
      cla:   [1.00,   1.03,   1.08,   1.16,   1.22,   1.26,   1.28,   1.20,   1.10,   0.95,   0.84,   0.75,   0.68,   0.62,   0.55],
      clMax: [1.00,   1.00,   0.97,   0.90,   0.84,   0.80,   0.78,   0.76,   0.74,   0.68,   0.62,   0.57,   0.52,   0.48,   0.44],
      cd0:   [0.0215, 0.0215, 0.0215, 0.0222, 0.0245, 0.0300, 0.0410, 0.0520, 0.0540, 0.0490, 0.0430, 0.0385, 0.0350, 0.0325, 0.0305],
      k:     [0.130,  0.130,  0.133,  0.140,  0.152,  0.166,  0.185,  0.21,   0.24,   0.30,   0.36,   0.42,   0.48,   0.54,   0.62],
      xac:   [0,      0,      0,      0.01,   0.03,   0.06,   0.10,   0.14,   0.16,   0.18,   0.19,   0.19,   0.18,   0.18,   0.18],
      ctrl:  [1,      1,      1,      0.98,   0.95,   0.91,   0.86,   0.80,   0.77,   0.72,   0.66,   0.60,   0.55,   0.50,   0.45],
    },
    drag: { clMinDrag: 0.05, gear: 0.024, speedbrake: 0.055, beta: 1.2, elevator: 0.05 },
    pitch: { cm0: 0.0, staticMargin: 0.03, cmq: -7, cmde: 1.3, clde: 0.4, cmPostStall: -0.5, cmGear: -0.008, cmSpeedbrake: -0.01 },
    side: { cyb: -1.0, cydr: 0.18 },
    roll: { clb: -0.07, clbCl: -0.05, clp: -0.40, clr: 0.03, clrCl: 0.10, clda: 0.10, cldt: 0.05, cldr: 0.010 },
    yaw: { cnb: 0.16, cnp: -0.01, cnpCl: -0.05, cnr: -0.30, cnda: 0.003, cndaCl: 0.012, cndr: 0.075, alphaDir: [20, 35], cnbPostStall: -0.02 },
    stall: { wingDrop: 0.015, clpPost: 0.02, buffetMargin: 8, warnMargin: 4 },
    flaps: {          // plain flaps, no leading-edge devices (fixed conical camber)
      detents: [
        { name: 'UP', deg: 0,  pos: 0 },
        { name: 'TO', deg: 15, pos: 0.5, dcl0: 0.24, clMax: 1.62, dcd0: 0.012, dcm0: 0.0 },
        { name: 'LDG', deg: 30, pos: 1,  dcl0: 0.40, clMax: 1.74, dcd0: 0.030, dcm0: -0.01, kFactor: 1.06 },
      ],
      time: 6, takeoff: 1, landing: 2,
    },
  },
  controls: {
    elevator: { max: 25, rate: 50, tau: 0.06 },        // all-moving stabilators
    aileron: { max: 20, rate: 60, tau: 0.06 },
    rudder: { max: 25, rate: 80, tau: 0.06 },
    diffTail: { max: 6 },                              // differential stabilator assists roll
    speedbrake: { time: 2.5 },
  },
  hook: true,
  engines: {
    type: 'turbofan-ab', inlet: 'ramp', throttleRatio: 1.0, milLapse: 2.3, abLapse: 1.5, pressureLimit: 1.9,
    n1Idle: 0.30, n2Idle: 0.68, spoolUp: 4.0, spoolDown: 3.0, idleThrust: 0.03, idleFuelFlow: 0.15,
    tsfc: [0.85, 0.30], tsfcAb: [1.95, 0.25], egt: [400, 880, 960], abLightTime: 1.2, startTime: 16,
  },
  gear: {
    nose: { travel: 0.30, staticDeflection: 0.08, gasRatio: 8, reboundDamping: 2 }, main: { travel: 0.34, reboundDamping: 1.5 },
    retractTime: 7, steerMax: 45, steerLatG: 0.30, brakeMu: 0.32, maxSinkRate: 3.6, crashSinkRate: 7,
  },
  structure: { tailStrikeDeg: 15, bellyY: -1.2 },
  limits: { vmo: 412, mmo: 2.5 },
  fcs: {
    type: 'conventional',
    feelQ: 7000, feelMin: 0.2, rollFeelQ: 0, trimFollowUp: 0.1,
    stickShape: 0.9, yawDamper: 1, sasAuthority: 0.6, betaGain: 3, ari: 0.1,
  },
  autopilot: { bankMax: 25, vsMax: 25, altGain: 0.12, vsGain: 0.7 },
  targets: {
    stallSpeedLanding: [68, 0.10],
    stallSpeedClean: [76, 0.10],
    takeoffRoll: [600, 0.3],
    landingRoll: [1150, 0.2],
    climbRate: [200, 0.2], climbSpeed: 200,
    maxSpeedSL: [1.2, 0.06],
    maxSpeedAlt: [2.5, 0.06], maxSpeedAltitude: 12500,
    ceiling: 16000, rotateSpeed: 88,
    rollRate: [230, 0.2], rollSpeed: 200,
    sustainedTurn: [11.5, 0.15], sustainedTurnSpeed: 222, sustainedTurnAltitude: 4572,
    instantTurn: [20.5, 0.15], instantTurnSpeed: 225,
    maxG: [9, 0.05], maxGSpeed: 230,
    glideRatio: [9, 0.2], glideSpeed: 125,
    cruise: { altitude: 9000, mach: 0.85, fuelFlow: [3300, 0.2] },
    approachAoA: [11, 0.2],
  },
};
