// Fairchild Republic A-10C Thunderbolt II (2 x GE TF34-GE-100A) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./index.js (specs) and ./geometry.js.
// Sources: A-10C Flight Manual (T.O. 1A-10C-1) performance charts and speeds, Fairchild Republic A-10A data (NASA TM-81,
// Wilson/Hoerner-type wing data for NACA 6716/6713 sections), TF34-GE-100A data sheet (BPR 6.2, 9065 lbf), Roskam class-II
// derivative magnitudes, radii of gyration from Raymer/Roskam attack-aircraft tables.
// Straight thick wing, no leading-edge devices, slotted flaps; conventional hydraulic controls with manual reversion.
// Tuned with `node tools/flight-test.mjs a10`.
export default {
  schema: 1,
  mass: {
    payload: 1269,                       // pilot, ~1000 rds 30 mm, light external stores
    fuel: 2910,                          // internal fuel at start (kg) -> 15 500 kg typical mass
    gyration: { rx: 0.22, ry: 0.27, rz: 0.30 },
  },
  aero: {
    ref: { span: 17.53, chord: 3.0 },
    lift: { cl0: 0.28, cla: 4.9, clMax: 1.42, sharpness: 14, clMaxNeg: 0.9, postStallCl: 1.1, cd90: 1.3 },   // thick cambered wing, gentle stall
    mach: {
      m:     [0,      0.3,    0.5,    0.6,    0.65,   0.7,    0.75,   0.8,    0.9,    1.0],
      cla:   [1.00,   1.03,   1.10,   1.16,   1.20,   1.25,   1.30,   1.30,   1.20,   1.00],
      clMax: [1.00,   0.99,   0.95,   0.88,   0.82,   0.74,   0.65,   0.55,   0.45,   0.40],   // thick straight wing: early shock stall
      cd0:   [0.0365, 0.0365, 0.0367, 0.0375, 0.0400, 0.0400, 0.0600, 0.1000, 0.1600, 0.2000],   // incl. pylons/gun/tank drag, steep drag rise above M0.65
      k:     [0.062,  0.062,  0.063,  0.065,  0.068,  0.075,  0.090,  0.110,  0.150,  0.20],
      xac:   [0,      0,      0,      0,      0.005,  0.015,  0.04,   0.07,   0.10,   0.12],
      ctrl:  [1,      1,      1,      0.98,   0.95,   0.90,   0.82,   0.70,   0.55,   0.45],
    },
    drag: { clMinDrag: 0.15, gear: 0.018, speedbrake: 0.06, beta: 1.2, elevator: 0.06 },   // split ailerons at 60 deg = big brake
    pitch: { cm0: 0.12, staticMargin: 0.08, cmq: -11, cmde: 1.4, clde: 0.30, cmPostStall: -1.4, cmGear: -0.005, cmSpeedbrake: 0.01 },
    side: { cyb: -0.75, cydr: 0.16 },
    roll: { clb: -0.09, clbCl: -0.01, clp: -0.46, clr: 0.05, clrCl: 0.10, clda: 0.15, cldr: 0.010 },
    yaw: { cnb: 0.12, cnp: -0.02, cnpCl: -0.04, cnr: -0.30, cnda: 0.003, cndaCl: 0.010, cndr: 0.075, alphaDir: [22, 38], cnbPostStall: 0.03 },
    stall: { wingDrop: 0.008, clpPost: 0.0, buffetMargin: 3, warnMargin: 3 },
    flaps: {            // slotted flaps: UP / 7 / 10 / 20 / 28 (landing)
      detents: [
        { name: 'UP', deg: 0,  pos: 0.00, slat: 0, dcl0: 0.00, clMax: 1.42 },
        { name: '7',  deg: 7,  pos: 0.25, slat: 0, dcl0: 0.15, clMax: 1.50, dcd0: 0.006, dcm0: -0.015 },
        { name: '10', deg: 10, pos: 0.36, slat: 0, dcl0: 0.25, clMax: 1.56, dcd0: 0.010, dcm0: -0.025 },
        { name: '20', deg: 20, pos: 0.71, slat: 0, dcl0: 0.40, clMax: 1.64, dcd0: 0.024, dcm0: -0.045 },
        { name: '28', deg: 28, pos: 1.00, slat: 0, dcl0: 0.50, clMax: 1.72, dcd0: 0.040, dcm0: -0.060, kFactor: 1.06 },
      ],
      time: 8, slatTime: 1, takeoff: 2, landing: 4,
    },
  },
  controls: {
    elevator: { max: 25, rate: 40, tau: 0.08 },
    aileron: { max: 25, rate: 70, tau: 0.07 },
    rudder: { max: 25, rate: 50, tau: 0.08, qBlowdown: 7000 },
    trim: { max: 15, rate: 0.04, authority: 1 },
    speedbrake: { time: 1.5 },
  },
  engines: {
    type: 'turbofan-hb', throttleRatio: 1.0, machLapse: 0.60,
    thrustLineOffset: 0.60,   // geometry.js nozzles moved up 0.85 → 1.45 to match the visual pods; keeps the tuned thrust line
    n1Idle: 0.30, n2Idle: 0.62, spoolUp: 5.5, spoolDown: 4.0, idleThrust: 0.02, idleFuelFlow: 0.08,
    tsfc: [0.40, 0.45], egt: [420, 820, 820], startTime: 20,
  },
  gear: {
    nose: { travel: 0.40 }, main: { travel: 0.45 },   // tough long-stroke gear
    retractTime: 7, extendTime: 7, steerMax: 50, steerLatG: 0.25, brakeMu: 0.50, maxSinkRate: 3.7, crashSinkRate: 7,
  },
  structure: { tailStrikeDeg: 14, bellyY: -1.2 },
  limits: { vmo: 225, mmo: 0.75, gMax: 7.33, gMin: -3, gearSpeed: 128 },   // ~437 KCAS / M0.75
  fcs: {
    type: 'conventional',
    nzMax: 7.33, nzMin: -3, pitchRateMax: 8, pitchBandwidth: 2, pitchIntegral: 1.0, pitchGainMax: 1.2,
    feelQ: 3500, feelMin: 0.15, rollFeelQ: 8000, trimFollowUp: 0.1,
    yawDamper: 1, sasAuthority: 0.3, betaGain: 2, ari: 0.1,
  },
  autopilot: { bankMax: 25, vsMax: 10, accelMax: 0.3, altGain: 0.12, vsGain: 0.6 },
  targets: {
    stallSpeedLanding: [54, 0.08],            // m/s CAS, flaps 28, ~15.5 t
    stallSpeedClean: [60.5, 0.07],              // ~120 kt at typical weight
    takeoffRoll: [700, 0.35],                 // m, flaps 10 (maneuver), max thrust, 15.5 t
    landingRoll: [650, 0.35],                 // m
    climbRate: [27, 0.2],                     // m/s at sea level, max thrust, 90 m/s
    climbSpeed: 90,
    maxSpeedSL: [0.573, 0.06],                // Mach (~195 m/s, 380 kt)
    maxSpeedAlt: [0.62, 0.06], maxSpeedAltitude: 6000,
    ceiling: 10500, ceilingMach: 0.55,
    rollRate: [120, 0.25], rollSpeed: 120,
    sustainedTurn: [12, 0.2], sustainedTurnSpeed: 120, sustainedTurnAltitude: 1000,
    instantTurn: [18, 0.2], instantTurnSpeed: 125,
    maxG: [7.33, 0.05], maxGSpeed: 150,
    glideRatio: [12, 0.2], glideSpeed: 75,
    cruise: { altitude: 3000, mach: 0.45, fuelFlow: [1150, 0.2] },   // kg/h total (~300 kt loiter ~1,300-1,600 kg/h)
    approachAoA: [4.5, 0.2],
  },
};
