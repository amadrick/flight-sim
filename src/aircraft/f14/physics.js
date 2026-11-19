// Grumman F-14D Tomcat (2 × F110-GE-400) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./specs.js and ./geometry.js.
// Sources: docs/aircraft/f14.md; NAVAIR 01-F14AAD-1 (NATOPS) figures as publicly quoted (speeds, AoA, limits);
// NASA TN D-7985 / TM X-3252 (F-14 variable-sweep wind-tunnel data: lift slope and CLmax vs sweep);
// Roskam class-II methods for derivative magnitudes; F110-GE-400 data sheet.
// Tuned with `node tools/flight-test.mjs f14`.
export default {
  schema: 1,
  mass: {
    payload: 1500,                       // 2 crew, 676 rds of 20 mm, 2 × AIM-9 + 2 × AIM-7 on glove/tunnel stations, pylons
    fuel: 5162,                          // kg internal fuel at start -> 26 500 kg typical mass
    // Estimated inertias (published F-14A values quoted in NASA departure studies, wings 20°, scaled to the D):
    // Ixx ~ 75 000, Iyy ~ 240 000, Izz ~ 305 000 slug·ft²
    inertia: { ixx: 101700, iyy: 325400, izz: 413500, ixz: 2700, atMass: 24000 },
  },
  aero: {
    ref: { span: 19.55, chord: 2.99 },   // reference: 565 ft², 64.1 ft span (20° sweep), MAC 9.8 ft
    lift: { cl0: 0.06, cla: 4.3, clMax: 1.70, sharpness: 12, clMaxNeg: 1.0, postStallCl: 1.15, cd90: 1.35, spoiler: 0.35 },
    // Mach columns are the 20°-sweep wing; `sweep.effects` scale them toward the 68° wing (the auto schedule sweeps
    // the wing aft from M 0.7, so supersonic values are always flown through the sweep multipliers)
    mach: {
      m:     [0,      0.4,    0.6,    0.7,    0.8,    0.9,    0.95,   1.0,    1.1,    1.2,    1.4,    1.6,    1.8,    2.0,    2.2,    2.4],
      cla:   [1.00,   1.04,   1.10,   1.15,   1.22,   1.30,   1.32,   1.30,   1.22,   1.12,   0.98,   0.86,   0.77,   0.70,   0.64,   0.59],
      clMax: [1.00,   1.00,   0.95,   0.90,   0.84,   0.78,   0.76,   0.75,   0.76,   0.76,   0.74,   0.70,   0.66,   0.62,   0.58,   0.55],
      cd0:   [0.0215, 0.0215, 0.0217, 0.0222, 0.0240, 0.0291, 0.0420, 0.0607, 0.0764, 0.0836, 0.0848, 0.0804, 0.0759, 0.0737, 0.0715, 0.0693],
      k:     [0.085,  0.085,  0.086,  0.088,  0.091,  0.096,  0.100,  0.105,  0.108,  0.112,  0.128,  0.145,  0.165,  0.185,  0.205,  0.225],
      xac:   [0,      0,      0,      0,      0,      0.02,   0.05,   0.08,   0.11,   0.12,   0.13,   0.13,   0.13,   0.13,   0.13,   0.13],
      ctrl:  [1,      1,      1,      0.99,   0.97,   0.93,   0.90,   0.86,   0.82,   0.78,   0.72,   0.66,   0.60,   0.55,   0.51,   0.48],
    },
    // Variable sweep 20° (pos 0) .. 68° (pos 1), CADC Mach sweep programme; full travel ~7 s
    sweep: {
      time: 7,
      auto: [[0, 0], [0.7, 0], [0.8, 0.2], [0.9, 0.5], [1.0, 0.75], [1.2, 0.92], [1.4, 1], [3, 1]],
      effects: { cla: 0.62, clMax: 0.75, cd0: 0.002, wave: 0.45, k: 1.9, xac: 0.06, damp: 0.85, span: 0.596 },
    },
    drag: { clMinDrag: 0.03, gear: 0.025, speedbrake: 0.05, spoiler: 0.10, beta: 1.2, elevator: 0.08 },
    pitch: { cm0: 0.0, staticMargin: 0.09, cmq: -12.0, cmde: 1.6, clde: 0.40, cmPostStall: -1.4, cmGear: -0.006, cmSpoiler: 0.01 },
    side: { cyb: -1.0, cydr: 0.18 },
    roll: { clb: -0.08, clbCl: -0.08, clp: -0.40, clr: 0.04, clrCl: 0.18, clda: 0.0, cldt: 0.050, cldr: 0.010, clSpoiler: 0.070 },
    yaw: { cnb: 0.16, cnp: -0.015, cnpCl: -0.06, cnr: -0.30, cnda: 0.004, cndaCl: 0.008, cndr: 0.075, cnSpoiler: 0.010,
      alphaDir: [20, 34], cnbPostStall: -0.06 },
    stall: { wingDrop: 0.014, clpPost: 0.03, buffetMargin: 8, warnMargin: 3 },
    flaps: {
      // UP; MANEUVER (flaps 10°, slats 7°); FULL (flaps 35°, slats 17°) — field and carrier take-off and landing
      detents: [
        { name: 'UP', deg: 0, pos: 0, slat: 0 },
        { name: 'MAN', deg: 10, pos: 0.29, slat: 0.41, dcl0: 0.15, clMax: 1.85, dcd0: 0.008, dcm0: -0.02 },
        { name: 'FULL', deg: 35, pos: 1, slat: 1, dcl0: 0.68, clMax: 2.30, dcd0: 0.060, dcm0: -0.04, kFactor: 1.08 },
      ],
      time: 5, slatTime: 3, takeoff: 2, landing: 2,
    },
    // CADC manoeuvre slats: scheduled with AoA below M 0.85 (retracted supersonic), full with the gear down
    slat: { dAlphaStall: 6, dcd0: 0.003, auto: { alpha: [7, 14], machFade: [0.8, 0.9], gearDown: 1 } },
  },
  controls: {
    elevator: { max: 33, rate: 40, tau: 0.06 },          // stabilators (real travel 33° TE up / 11.5° TE down; symmetric in the engine)
    aileron: { max: 20, rate: 50, tau: 0.06 },           // "aileron" channel = roll command to diff. stabs + spoilers
    rudder: { max: 30, rate: 60, tau: 0.06, qBlowdown: 15000 },
    diffTail: { max: 10 },                                // differential stabilator ±10°
    spoilers: { flightMax: 0.0, rollGain: 1.43, rollDeadband: 0.3, rollMax: 0.8, time: 0.4, autoGround: true },
    trim: { max: 10, rate: 0.06, authority: 0.7 },
    speedbrake: { time: 2 },
  },
  hook: true,
  engines: {
    type: 'turbofan-ab', inlet: 'ramp', throttleRatio: 1.0, milLapse: 2.3, abLapse: 1.7, pressureLimit: 1.9,
    n1Idle: 0.32, n2Idle: 0.68, spoolUp: 3.8, spoolDown: 2.6, idleThrust: 0.025, idleFuelFlow: 0.15,
    tsfc: [0.72, 0.25], tsfcAb: [2.0, 0.25], egt: [400, 900, 960], abLightTime: 1.2, startTime: 18, maxMach: 2.4,
  },
  gear: {
    nose: { travel: 0.35 }, main: { travel: 0.45 },
    retractTime: 6, steerMax: 70, steerLatG: 0.3, brakeMu: 0.45, maxSinkRate: 7.0, crashSinkRate: 9.5,
    catapult: { accel: 30, stroke: 94 },
  },
  structure: { tailStrikeDeg: 15, bellyY: -0.9 },
  limits: { vmo: 411.5, mmo: 2.34 },
  fcs: {
    type: 'conventional',
    feelQ: 4800, feelMin: 0.06, rollFeelQ: 20000, trimFollowUp: 0,
    yawDamper: 1, sasAuthority: 0.7, betaGain: 2, ari: 0.6, stickShape: 0.8,
  },
  autopilot: { bankMax: 25, accelMax: 0.15 },
  targets: {
    stallSpeedLanding: [59, 0.08],
    stallSpeedClean: [69, 0.10],
    takeoffRoll: [460, 0.3], rotatePitch: 10, climbPitch: 14,
    landingRoll: [850, 0.35],
    climbRate: [230, 0.25], climbSpeed: 280,
    maxSpeedSL: [1.2, 0.06],
    maxSpeedAlt: [2.34, 0.06], maxSpeedAltitude: 12200,
    ceiling: 16150, ceilingMach: 1.3,
    rollRate: [60, 0.3], rollSpeed: 75,
    sustainedTurn: [14, 0.15], sustainedTurnSpeed: 210, sustainedTurnAltitude: 3000,
    instantTurn: [20, 0.15], instantTurnSpeed: 180,
    maxG: [7.5, 0.1], maxGSpeed: 200,
    glideRatio: [13, 0.2], glideSpeed: 120,
    cruise: { altitude: 10000, mach: 0.8, fuelFlow: [2300, 0.3] },
    approachAoA: [11.5, 0.25],
  },
};
