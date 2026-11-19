// F-35A Lightning II (F135-PW-100) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./index.js (specs) and ./geometry.js.
// Sources: published F-35A data (Lockheed Martin / USAF fact sheets: 42.7 m2 wing, 9 g, M1.6, 50 deg AoA capability),
// F135 data (28 000 lbf dry / 43 000 lbf AB), NASA/AIAA open papers on F-35 handling (approach AoA 13 deg), and
// radius-of-gyration estimates for the inertias (no public values). Tuned with `node tools/flight-test.mjs f35`.
export default {
  schema: 1,
  mass: {
    payload: 1743,                       // pilot, 2 x AIM-120 + 2 x 2000 lb bombs in the internal bays are NOT carried: clean
    fuel: 4967,                          // ~60 % internal fuel at start -> 20 000 kg typical mass
    inertia: { ixx: 30000, iyy: 190000, izz: 218000, ixz: 1500, atMass: 20000 },   // kg·m² (estimates, scaled with mass)
  },
  aero: {
    ref: { span: 10.7, chord: 4.6 },
    lift: { cl0: 0.05, cla: 3.3, clMax: 1.8, sharpness: 8, clMaxNeg: 0.9, postStallCl: 1.1, cd90: 1.3 },
    mach: {
      m:     [0,      0.4,    0.6,    0.8,    0.9,    0.95,   1.0,    1.05,   1.1,    1.2,    1.4,    1.6,    1.8,    2.0],
      cla:   [1.00,   1.03,   1.08,   1.16,   1.22,   1.26,   1.28,   1.25,   1.20,   1.10,   0.95,   0.84,   0.75,   0.68],
      clMax: [1.00,   1.00,   0.98,   0.93,   0.88,   0.85,   0.83,   0.82,   0.80,   0.78,   0.72,   0.65,   0.60,   0.55],
      cd0:   [0.0185, 0.0185, 0.0185, 0.0192, 0.0215, 0.0280, 0.0400, 0.0480, 0.0520, 0.0540, 0.0560, 0.0580, 0.0580, 0.0580],
      k:     [0.10,   0.10,   0.105,  0.115,  0.13,   0.19,   0.21,   0.24,   0.26,   0.29,   0.35,   0.41,   0.47,   0.53],
      xac:   [0,      0,      0,      0.01,   0.03,   0.06,   0.10,   0.14,   0.16,   0.18,   0.19,   0.19,   0.18,   0.18],
      ctrl:  [1,      1,      1,      0.98,   0.95,   0.90,   0.85,   0.80,   0.78,   0.75,   0.68,   0.60,   0.54,   0.50],
    },
    drag: { clMinDrag: 0.02, gear: 0.025, speedbrake: 0.04, beta: 1.1, elevator: 0.06 },
    pitch: { cm0: 0.0, staticMargin: 0.0, cmq: -6.0, cmde: 0.80, clde: 0.40, cmPostStall: -0.4, cmGear: -0.008, cmSpeedbrake: -0.004 },
    side: { cyb: -1.0, cydr: 0.18 },
    roll: { clb: -0.07, clbCl: -0.06, clp: -0.38, clr: 0.03, clrCl: 0.15, clda: 0.075, cldt: 0.045, cldr: 0.012 },
    yaw: { cnb: 0.20, cnp: -0.01, cnpCl: -0.05, cnr: -0.38, cnda: 0.003, cndaCl: 0.012, cndr: 0.086, alphaDir: [35, 50], cnbPostStall: -0.02 },
    stall: { wingDrop: 0.008, clpPost: 0.02, buffetMargin: 12, warnMargin: 6 },
    flaps: {            // LE flaps + flaperons scheduled automatically; detents are what the pilot can override
      detents: [
        { name: 'UP', deg: 0, pos: 0, slat: 0 },
        { name: 'T/O', deg: 10, pos: 0.4, slat: 0.5, dcl0: 0.2, clMax: 2.0, dcd0: 0.015, dcm0: -0.03 },
        { name: 'LAND', deg: 25, pos: 1, slat: 1, dcl0: 0.55, clMax: 2.3, dcd0: 0.035, dcm0: -0.05 },
      ],
      time: 3, slatTime: 3, takeoff: 1, landing: 2, autoWithGear: true,
    },
    slat: { auto: { alpha: [0, 20], machFade: [0.9, 1.3], gearDown: 0.8 }, dAlphaStall: 5, dcd0: 0.002 },
  },
  controls: {
    elevator: { max: 25, rate: 60, tau: 0.045 },       // all-moving stabilators
    aileron: { max: 25, rate: 80, tau: 0.045 },        // flaperons
    rudder: { max: 30, rate: 100, tau: 0.045 },
    diffTail: { max: 5 },
    speedbrake: { time: 2 },
  },
  hook: true,
  engines: {
    type: 'turbofan-ab', inlet: 'pitot', maxMach: 1.65, throttleRatio: 0.95, milLapse: 2.3, abLapse: 1.69, pressureLimit: 1.9,
    n1Idle: 0.32, n2Idle: 0.68, spoolUp: 4.0, spoolDown: 3.0, idleThrust: 0.022, idleFuelFlow: 0.17,
    tsfc: [0.70, 0.25], tsfcAb: [1.90, 0.25], egt: [400, 880, 960], abLightTime: 1.2, startTime: 16,
  },
  gear: {
    nose: { travel: 0.30 }, main: { travel: 0.38, damping: 1.3 },
    retractTime: 8, steerMax: 40, steerLatG: 0.30, brakeMu: 0.50, maxSinkRate: 3.6, crashSinkRate: 7,
  },
  structure: { tailStrikeDeg: 14, bellyY: -0.8 },
  limits: { gMax: 9, gMin: -3, vmo: 400, mmo: 1.6 },
  fcs: {
    type: 'fbw-fighter',
    nzMax: 9, nzMin: -3, alphaMax: 50, alphaMin: -15, pitchRateMax: 35, alphaGain: 1.8,
    rollRate: 220, rollAlphaFade: [20, 40],
    gearDown: { nzMax: 5, alphaMax: 26, rollRate: 120, pitchRateMax: 28 },
    betaGain: 3, ari: 0.1,
  },
  autopilot: { bankMax: 45, vsMax: 45 },
  targets: {
    stallSpeedLanding: [62, 0.10],
    stallSpeedClean: [64, 0.10],
    takeoffRoll: [520, 0.35],
    landingRoll: [700, 0.35],
    climbRate: [210, 0.25], climbSpeed: 200,
    maxSpeedSL: [1.2, 0.06],
    maxSpeedAlt: [1.6, 0.06], maxSpeedAltitude: 11000,
    ceiling: 15240,
    rollRate: [200, 0.2], rollSpeed: 200,
    sustainedTurn: [13.5, 0.15], sustainedTurnSpeed: 222, sustainedTurnAltitude: 4572,
    instantTurn: [25, 0.15], instantTurnSpeed: 205,
    maxG: [9, 0.05], maxGSpeed: 240,
    glideRatio: [11, 0.2], glideSpeed: 115,
    cruise: { altitude: 9000, mach: 0.85, fuelFlow: [1900, 0.3] },
    approachAoA: [13, 0.2],
  },
};
