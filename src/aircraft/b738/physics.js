// Boeing 737-800 (CFM56-7B27) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./index.js (specs) and ./geometry.js.
// Sources: Boeing 737NG FCOM / FPPM (speeds, distances, fuel flow), Boeing D6-58325 airport planning data, Roskam
// class-II methods for derivative magnitudes and radii of gyration, CFM56-7B type-certificate data.
// Tuned with `node tools/flight-test.mjs b738`.
export default {
  schema: 1,
  mass: {
    payload: 14500,                      // ~150 passengers + bags
    fuel: 9087,                          // kg at start -> 65 000 kg typical mass
    gyration: { rx: 0.25, ry: 0.38, rz: 0.46 },
  },
  aero: {
    ref: { span: 34.32, chord: 3.96 },   // reference span without winglets
    lift: { cl0: 0.20, cla: 5.5, clMax: 1.38, sharpness: 38, clMaxNeg: 0.9, postStallCl: 1.0, cd90: 1.3, spoiler: 0.75 },   // spoiler: fraction of lift dumped with all panels up
    mach: {
      m:     [0,      0.3,    0.5,    0.6,    0.7,    0.75,   0.78,   0.80,   0.82,   0.84,   0.86,   0.90,   0.95,   1.0],
      cla:   [1.00,   1.03,   1.10,   1.15,   1.22,   1.27,   1.30,   1.32,   1.33,   1.33,   1.30,   1.20,   1.10,   1.00],
      clMax: [1.00,   0.98,   0.90,   0.83,   0.74,   0.69,   0.66,   0.63,   0.59,   0.55,   0.50,   0.44,   0.40,   0.38],   // buffet boundary / low-speed CLmax
      cd0:   [0.0185, 0.0185, 0.0185, 0.0186, 0.0188, 0.0192, 0.0197, 0.0206, 0.0226, 0.0262, 0.0330, 0.0550, 0.0850, 0.1100],
      k:     [0.0440, 0.0440, 0.0440, 0.0440, 0.0445, 0.0450, 0.0455, 0.0465, 0.0485, 0.0520, 0.0570, 0.0680, 0.0800, 0.0900],
      xac:   [0,      0,      0,      0,      0,      0.005,  0.010,  0.018,  0.028,  0.040,  0.050,  0.070,  0.090,  0.100],
      ctrl:  [1,      1,      1,      1,      0.99,   0.98,   0.97,   0.95,   0.93,   0.91,   0.89,   0.84,   0.76,   0.70],
    },
    drag: { clMinDrag: 0.05, gear: 0.021, spoiler: 0.085, beta: 1.4, elevator: 0.10 },
    pitch: { cm0: 0.02, staticMargin: 0.20, cmq: -17, cmde: 1.20, clde: 0.35, cmPostStall: -1.4, cmGear: -0.01, cmSpoiler: 0.02 },
    side: { cyb: -0.95, cydr: 0.22 },
    roll: { clb: -0.11, clbCl: -0.05, clp: -0.45, clr: 0.08, clrCl: 0.20, clda: 0.065, cldr: 0.012, clSpoiler: 0.040 },
    yaw: { cnb: 0.15, cnp: -0.02, cnpCl: -0.07, cnr: -0.22, cnda: 0.002, cndaCl: 0.012, cndr: 0.105, cnSpoiler: 0.004, alphaDir: [22, 40], cnbPostStall: 0.05 },
    stall: { wingDrop: 0.02, clpPost: 0.02, buffetMargin: 2.5, warnMargin: 2.0 },
    flaps: {
      detents: [
        { name: 'UP', deg: 0,  pos: 0.00, slat: 0, dcl0: 0.00, clMax: 1.38 },
        { name: '1',  deg: 1,  pos: 0.10, slat: 1, dcl0: 0.08, clMax: 1.80, dcd0: 0.006, dcm0: -0.01 },
        { name: '5',  deg: 5,  pos: 0.25, slat: 1, dcl0: 0.25, clMax: 2.00, dcd0: 0.016, dcm0: -0.03 },
        { name: '15', deg: 15, pos: 0.50, slat: 1, dcl0: 0.45, clMax: 2.18, dcd0: 0.034, dcm0: -0.07 },
        { name: '30', deg: 30, pos: 0.80, slat: 1, dcl0: 0.72, clMax: 2.38, dcd0: 0.062, dcm0: -0.11, kFactor: 1.08 },
        { name: '40', deg: 40, pos: 1.00, slat: 1, dcl0: 0.86, clMax: 2.52, dcd0: 0.092, dcm0: -0.14, kFactor: 1.12 },
      ],
      time: 20, slatTime: 6, takeoff: 2, landing: 4,
    },
    slat: { dAlphaStall: 5, dcd0: 0.003 },
  },
  controls: {
    elevator: { max: 20, rate: 40, tau: 0.08 },
    aileron: { max: 20, rate: 50, tau: 0.08 },
    rudder: { max: 25, rate: 50, tau: 0.08, qBlowdown: 5500 },
    spoilers: { flightMax: 0.5, rollGain: 1.0, rollDeadband: 0.15, rollMax: 0.45, time: 0.7, autoGround: true },
    trim: { max: 22, rate: 0.035, authority: 1 },        // stabiliser, in elevator-equivalent degrees
  },
  engines: {
    type: 'turbofan-hb', throttleRatio: 1.06, machLapse: 0.50,
    n1Idle: 0.21, n2Idle: 0.60, spoolUp: 6.5, spoolDown: 4.5, idleThrust: 0.035, idleFuelFlow: 0.10,
    tsfc: [0.38, 0.43], egt: [440, 890, 890], startTime: 16,
    reverser: { fraction: 0.40, time: 2, power: 0.8, minSpeed: 30, stowSpeed: 26 },
  },
  gear: {
    nose: { travel: 0.38 }, main: { travel: 0.45 },
    retractTime: 8, steerMaxLow: 65, steerMaxHigh: 5, brakeMu: 0.45, maxSinkRate: 3.05, crashSinkRate: 6,
  },
  structure: { tailStrikeDeg: 11, bellyY: -1.45 },
  limits: { vmo: 175, mmo: 0.82, gearSpeed: 139 },      // 340 KCAS / M0.82
  fcs: {
    type: 'conventional',
    feelQ: 3800, feelMin: 0.12, rollFeelQ: 9000, trimFollowUp: 0.3,
    yawDamper: 1, sasAuthority: 0.35, betaGain: 3, ari: 0.12,
  },
  autopilot: { bankMax: 25, vsMax: 10, turnRate: 3 },
  targets: {
    stallSpeedLanding: [57.5, 0.07],          // m/s CAS, flaps 40, 65 t (FCOM Vref40/1.23)
    stallSpeedClean: [78, 0.07],
    takeoffRoll: [1250, 0.3],                 // m ground roll, flaps 5, TOGA, 65 t
    landingRoll: [900, 0.35],                 // m, max manual braking + reverse
    climbRate: [24, 0.3],                     // m/s at sea level, TOGA, 250 kt, 65 t
    climbSpeed: 128,
    maxSpeedSL: [175, 0.03], maxSpeedSLisCas: true,   // VMO must be reachable (thrust-limited speed is higher)
    maxSpeedAlt: [0.82, 0.04], maxSpeedAltitude: 10668,
    ceiling: 11900,                           // thrust-limited ceiling at 65 t (FL410 certified ceiling needs < 62 t)
    rollRate: [25, 0.35], rollSpeed: 77,      // deg/s, approach speed, flaps 30
    sustainedTurn: [0, 0], instantTurn: [0, 0],
    maxG: [2.5, 0.2], maxGSpeed: 130,
    glideRatio: [17.3, 0.12], glideSpeed: 113,
    cruise: { altitude: 10668, mach: 0.785, fuelFlow: [2450, 0.15] },   // kg/h total
    approachAoA: [5.8, 0.25],                 // deg, flaps 30, Vref+5
  },
};
