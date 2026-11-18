// F-16C Block 50 (F110-GE-129) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./index.js (specs) and ./geometry.js.
// Sources: NASA TP-1538 (F-16 low-speed aero), Stevens & Lewis "Aircraft Control and Simulation" (inertias, derivative
// magnitudes), T.O. 1F-16C-1 performance charts (speeds, turn and climb performance), F110-GE-129 data sheet.
// Tuned with `node tools/flight-test.mjs f16`.
export default {
  schema: 1,
  mass: {
    payload: 1030,                       // pilot, gun ammunition, 2 × AIM-9 + rails, pylons
    fuel: 2400,                          // internal fuel at start (kg) -> 12 000 kg typical mass
    inertia: { ixx: 12875, iyy: 75674, izz: 85552, ixz: 1331, atMass: 9300 },   // kg·m² (scaled with mass)
  },
  aero: {
    ref: { span: 9.45, chord: 3.45 },
    lift: { cl0: 0.04, cla: 3.6, clMax: 1.66, sharpness: 9, clMaxNeg: 1.0, postStallCl: 1.15, cd90: 1.3 },
    mach: {
      m:     [0,      0.4,    0.6,    0.8,    0.9,    0.95,   1.0,    1.05,   1.1,    1.2,    1.4,    1.6,    1.8,    2.0,    2.2],
      cla:   [1.00,   1.03,   1.08,   1.16,   1.22,   1.26,   1.28,   1.25,   1.20,   1.10,   0.95,   0.84,   0.75,   0.68,   0.62],
      clMax: [1.00,   1.00,   0.98,   0.93,   0.88,   0.85,   0.83,   0.82,   0.80,   0.78,   0.72,   0.65,   0.60,   0.55,   0.50],
      cd0:   [0.0190, 0.0190, 0.0190, 0.0194, 0.0212, 0.0265, 0.0370, 0.0435, 0.0452, 0.0448, 0.0425, 0.0405, 0.0388, 0.0372, 0.0362],
      k:     [0.117,  0.117,  0.120,  0.128,  0.140,  0.155,  0.175,  0.20,   0.22,   0.25,   0.31,   0.37,   0.43,   0.50,   0.56],
      xac:   [0,      0,      0,      0.01,   0.03,   0.06,   0.10,   0.14,   0.16,   0.18,   0.19,   0.19,   0.18,   0.18,   0.18],
      ctrl:  [1,      1,      1,      0.98,   0.95,   0.90,   0.85,   0.80,   0.78,   0.75,   0.68,   0.60,   0.54,   0.50,   0.46],
    },
    drag: { clMinDrag: 0.02, gear: 0.022, speedbrake: 0.045, beta: 0.9, elevator: 0.06 },
    pitch: { cm0: 0.0, staticMargin: -0.015, cmq: -5.5, cmde: 0.65, clde: 0.45, cmPostStall: -0.35, cmGear: -0.008, cmSpeedbrake: -0.004 },
    side: { cyb: -1.1, cydr: 0.18 },
    roll: { clb: -0.07, clbCl: -0.06, clp: -0.36, clr: 0.03, clrCl: 0.15, clda: 0.092, cldt: 0.045, cldr: 0.012 },
    yaw: { cnb: 0.20, cnp: -0.01, cnpCl: -0.05, cnr: -0.38, cnda: 0.003, cndaCl: 0.012, cndr: 0.086, alphaDir: [28, 42], cnbPostStall: -0.06 },
    stall: { wingDrop: 0.012, clpPost: 0.02, buffetMargin: 12, warnMargin: 3 },
    flaps: {            // flaperons droop 20° with the gear handle (and retract with it); [ / ] still override
      detents: [
        { name: 'UP', deg: 0, pos: 0 },
        { name: 'DN', deg: 20, pos: 1, dcl0: 0.45, clMax: 1.86, dcd0: 0.032, dcm0: -0.05 },
      ],
      time: 2.5, autoWithGear: true, takeoff: 1, landing: 1,
    },
    slat: { auto: { alpha: [-2, 22], machFade: [0.9, 1.3], gearDown: 0.6 }, dAlphaStall: 8, dcd0: 0.002 },   // leading-edge flaps
  },
  controls: {
    elevator: { max: 25, rate: 60, tau: 0.045 },       // all-moving stabilators
    aileron: { max: 21.5, rate: 80, tau: 0.045 },      // flaperons
    rudder: { max: 30, rate: 120, tau: 0.045 },
    diffTail: { max: 5.4 },                            // differential stabilator for roll
    speedbrake: { time: 2 },
  },
  hook: true,
  engines: {
    type: 'turbofan-ab', inlet: 'pitot', throttleRatio: 1.09,
    n1Idle: 0.32, n2Idle: 0.68, spoolUp: 3.2, spoolDown: 2.4, idleThrust: 0.022, idleFuelFlow: 0.13,
    tsfc: [0.70, 0.25], tsfcAb: [1.90, 0.25], egt: [390, 880, 955], abLightTime: 1.0, startTime: 14,
  },
  gear: {
    nose: { travel: 0.26 }, main: { travel: 0.30 },
    retractTime: 5, steerMaxLow: 32, steerMaxHigh: 3, brakeMu: 0.42, maxSinkRate: 3.6, crashSinkRate: 7,
  },
  structure: { tailStrikeDeg: 14.5, bellyY: -0.75 },
  limits: { vmo: 411.5, mmo: 2.05 },                   // 800 KCAS / Mach 2.05
  fcs: {
    type: 'fbw-fighter',
    nzMax: 9, nzMin: -3, alphaMax: 25.5, alphaMin: -10, pitchRateMax: 40, alphaGain: 1.8,
    rollRate: 290, rollAlphaFade: [15, 29],
    gearDown: { nzMax: 5, alphaMax: 19, rollRate: 165, pitchRateMax: 25 },
    betaGain: 3, ari: 0.1,
  },
  autopilot: { bankMax: 45, vsMax: 45 },
  // flight-test targets (tools/flight-test.mjs): [value, tolerance fraction]
  targets: {
    stallSpeedLanding: [62, 0.08],            // m/s CAS, AoA-limiter minimum speed, gear + flaps
    stallSpeedClean: [69, 0.10],
    takeoffRoll: [430, 0.35],                 // m, max AB at 12 t
    landingRoll: [800, 0.35],                 // m
    climbRate: [254, 0.25],                   // m/s at sea level, max AB (best speed ~ M0.9)
    climbSpeed: 300,                          // m/s TAS used for the climb test
    maxSpeedSL: [1.2, 0.06],                  // Mach at sea level (placard 800 KCAS)
    maxSpeedAlt: [2.05, 0.06], maxSpeedAltitude: 12200,
    ceiling: 15240,
    rollRate: [270, 0.2], rollSpeed: 200,     // deg/s at 200 m/s
    sustainedTurn: [18.0, 0.15], sustainedTurnSpeed: 240,   // deg/s at sea level
    instantTurn: [25, 0.15], instantTurnSpeed: 200,
    maxG: [9, 0.05],
    glideRatio: [10.5, 0.2], glideSpeed: 115,
    cruise: { altitude: 9000, mach: 0.85, fuelFlow: [3000, 0.3] },   // kg/h
    approachAoA: [13, 0.2],                   // deg
  },
};
