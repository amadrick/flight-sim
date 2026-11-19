// F/A-18E Super Hornet (2 x F414-GE-400) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./index.js (specs) and ./geometry.js.
// Sources: published F/A-18E/F data (Boeing/USN: 500 ft2, 14.4 klb internal fuel, 7.5 g limiter, 8.1 deg on-speed AoA),
// F/A-18A-D inertias scaled by mass (Stevens & Lewis / NASA HARV reports), F414-GE-400 data sheet (22 klbf class).
// Tuned with `node tools/flight-test.mjs fa18`.
export default {
  schema: 1,
  mass: {
    payload: 1900,                       // pilot, gun + ammo, 2 x AIM-9 on wingtip rails, 2 x AIM-120, pylons
    fuel: 4600,                          // internal fuel at start (kg) -> 21 000 kg typical mass
    inertia: { ixx: 52000, iyy: 265000, izz: 295000, ixz: 2000, atMass: 21000 },   // kg·m² (the sheet's 100k/341k/406k are high)
  },
  aero: {
    ref: { span: 13.62, chord: 3.9 },
    lift: { cl0: 0.10, cla: 3.7, clMax: 1.9, sharpness: 9, clMaxNeg: 1.0, postStallCl: 1.25, cd90: 1.3 },   // LERX: gentle stall, lift to 40 deg
    mach: {
      m:     [0,      0.4,    0.6,    0.8,    0.9,    0.95,   1.0,    1.05,   1.1,    1.2,    1.4,    1.6,    1.8,    2.0,    2.2],
      cla:   [1.00,   1.03,   1.08,   1.16,   1.22,   1.26,   1.28,   1.25,   1.20,   1.10,   0.95,   0.84,   0.75,   0.68,   0.62],
      clMax: [1.00,   1.00,   0.98,   0.93,   0.88,   0.85,   0.83,   0.82,   0.80,   0.78,   0.72,   0.65,   0.60,   0.55,   0.50],
      cd0:   [0.0210, 0.0210, 0.0215, 0.0225, 0.0265, 0.0360, 0.0500, 0.0570, 0.0590, 0.0580, 0.0550, 0.0525, 0.0500, 0.0480, 0.0465],
      k:     [0.118,  0.118,  0.122,  0.130,  0.145,  0.165,  0.200,  0.225,  0.245,  0.275,  0.340,  0.400,  0.460,  0.520,  0.580],
      xac:   [0,      0,      0,      0.01,   0.03,   0.06,   0.10,   0.14,   0.16,   0.18,   0.19,   0.19,   0.18,   0.18,   0.18],
      ctrl:  [1,      1,      1,      0.98,   0.95,   0.90,   0.85,   0.80,   0.78,   0.75,   0.68,   0.60,   0.54,   0.50,   0.46],
    },
    drag: { clMinDrag: 0.05, gear: 0.025, speedbrake: 0.05, beta: 1.1, elevator: 0.06 },
    pitch: { cm0: 0.0, staticMargin: -0.01, cmq: -6.5, cmde: 0.80, clde: 0.40, cmPostStall: -0.5, cmGear: -0.008, cmSpeedbrake: -0.004 },
    side: { cyb: -1.1, cydr: 0.18 },
    roll: { clb: -0.07, clbCl: -0.04, clp: -0.38, clr: 0.03, clrCl: 0.12, clda: 0.075, cldt: 0.045, cldr: 0.015 },
    yaw: { cnb: 0.20, cnp: -0.01, cnpCl: -0.04, cnr: -0.40, cnda: 0.003, cndaCl: 0.010, cndr: 0.10, alphaDir: [35, 50], cnbPostStall: 0.0 },
    stall: { wingDrop: 0.004, clpPost: 0.0, buffetMargin: 14, warnMargin: 12 },
    flaps: {            // AUTO / HALF / FULL; LE flaps and flaperons schedule automatically
      detents: [
        { name: 'AUTO', deg: 0, pos: 0 },
        { name: 'HALF', deg: 30, pos: 0.65, slat: 1, dcl0: 0.50, clMax: 2.15, dcd0: 0.020, dcm0: -0.04 },
        { name: 'FULL', deg: 45, pos: 1, slat: 1, dcl0: 0.74, clMax: 2.40, dcd0: 0.035, dcm0: -0.06 },
      ],
      time: 3, slatTime: 2, takeoff: 1, landing: 2,
    },
    slat: { auto: { alpha: [0, 20], machFade: [0.8, 1.2], gearDown: 0.6 }, dAlphaStall: 8, dcd0: 0.003 },   // scheduled LE flaps
  },
  controls: {
    elevator: { max: 24, rate: 60, tau: 0.05 },        // all-moving stabilators
    aileron: { max: 25, rate: 100, tau: 0.045 },       // ailerons / flaperons
    rudder: { max: 30, rate: 100, tau: 0.045 },
    diffTail: { max: 6 },
    speedbrake: { time: 2 },
  },
  hook: true,
  engines: {
    type: 'turbofan-ab', inlet: 'pitot', throttleRatio: 0.95, milLapse: 2.3, abLapse: 1.69, pressureLimit: 1.9,
    n1Idle: 0.32, n2Idle: 0.68, spoolUp: 3.5, spoolDown: 2.6, idleThrust: 0.025, idleFuelFlow: 0.17,
    tsfc: [0.90, 0.25], tsfcAb: [1.85, 0.25], egt: [400, 880, 960], abLightTime: 1.2, startTime: 16,
  },
  gear: {
    nose: { travel: 0.30 }, main: { travel: 0.35 },
    retractTime: 8, steerMax: 35, steerLatG: 0.30, brakeMu: 0.60, maxSinkRate: 6.7, crashSinkRate: 9,
    catapult: { accel: 40, stroke: 94 },
  },
  structure: { tailStrikeDeg: 14, bellyY: -0.9 },
  limits: { gMax: 7.5, gMin: -3, vmo: 340, mmo: 1.8 },   // 660 KCAS
  fcs: {
    type: 'fbw-fighter',
    nzMax: 7.5, nzMin: -3, alphaMax: 35, alphaMin: -10, pitchRateMax: 35, alphaGain: 1.8,
    rollRate: 200, rollAlphaFade: [25, 40],
    gearDown: { nzMax: 5, alphaMax: 30, rollRate: 120, pitchRateMax: 20 },
    betaGain: 3, ari: 0.1,
  },
  autopilot: { bankMax: 45, vsMax: 45 },
  targets: {
    stallSpeedLanding: [58, 0.08],
    stallSpeedClean: [64, 0.10],
    takeoffRoll: [430, 0.35],
    landingRoll: [650, 0.35],
    climbRate: [230, 0.25],
    climbSpeed: 280,
    maxSpeedSL: [1.15, 0.06],
    maxSpeedAlt: [1.8, 0.06], maxSpeedAltitude: 12200,
    ceiling: 15000,
    rollRate: [200, 0.2], rollSpeed: 200,
    sustainedTurn: [12, 0.15], sustainedTurnSpeed: 222, sustainedTurnAltitude: 4572,
    instantTurn: [23, 0.15], instantTurnSpeed: 185,
    maxG: [7.5, 0.05], maxGSpeed: 200,
    glideRatio: [9, 0.2], glideSpeed: 115,
    cruise: { altitude: 9000, mach: 0.85, fuelFlow: [2800, 0.3] },
    approachAoA: [8.1, 0.2],
  },
};
