// Airbus A320neo (CFM LEAP-1A26, 120.6 kN) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./index.js (specs) and ./geometry.js.
// Sources: Airbus A320 FCOM / FCTM (speeds, Normal Law protections, flap/slat detents), Airbus Airport Planning
// document AC A320 (field lengths, masses), CFM LEAP-1A type-certificate data sheet, Roskam class-II methods for
// derivative magnitudes and radii of gyration. Tuned with `node tools/flight-test.mjs a320`.
export default {
  schema: 1,
  mass: {
    payload: 13700,                      // ~150 pax + bags
    fuel: 6000,                          // kg at start -> 64 000 kg typical flying mass
    gyration: { rx: 0.25, ry: 0.37, rz: 0.46 },
  },
  aero: {
    ref: { chord: 4.29 },                // MAC
    lift: { cl0: 0.22, cla: 5.7, clMax: 1.55, sharpness: 38, clMaxNeg: 0.9, postStallCl: 1.0, cd90: 1.3, spoiler: 0.75 },
    mach: {
      m:     [0,      0.3,    0.5,    0.6,    0.7,    0.74,   0.78,   0.80,   0.82,   0.84,   0.86,   0.90,   0.95,   1.0],
      cla:   [1.00,   1.03,   1.10,   1.15,   1.22,   1.26,   1.30,   1.32,   1.33,   1.33,   1.30,   1.20,   1.10,   1.00],
      clMax: [1.00,   0.98,   0.90,   0.83,   0.74,   0.70,   0.66,   0.63,   0.59,   0.55,   0.50,   0.44,   0.40,   0.38],
      cd0:   [0.0215, 0.0215, 0.0215, 0.0216, 0.0218, 0.0222, 0.0230, 0.0240, 0.0262, 0.0300, 0.0370, 0.0580, 0.0880, 0.1120],
      k:     [0.0400, 0.0400, 0.0400, 0.0400, 0.0405, 0.0410, 0.0415, 0.0425, 0.0445, 0.0480, 0.0530, 0.0650, 0.0780, 0.0880],
      xac:   [0,      0,      0,      0,      0,      0.005,  0.010,  0.018,  0.028,  0.040,  0.050,  0.070,  0.090,  0.100],
      ctrl:  [1,      1,      1,      1,      0.99,   0.98,   0.97,   0.95,   0.93,   0.91,   0.89,   0.84,   0.76,   0.70],
    },
    drag: { clMinDrag: 0.05, gear: 0.021, spoiler: 0.085, speedbrake: 0.04, beta: 1.4, elevator: 0.10 },
    pitch: { cm0: 0.02, staticMargin: 0.20, cmq: -12, cmde: 1.4, clde: 0.20, cmPostStall: -1.4, cmGear: -0.01, cmSpoiler: 0.02 },
    side: { cyb: -0.95, cydr: 0.22 },
    roll: { clb: -0.10, clbCl: -0.05, clp: -0.45, clr: 0.08, clrCl: 0.20, clda: 0.065, cldr: 0.012, clSpoiler: 0.040 },
    yaw: { cnb: 0.15, cnp: -0.02, cnpCl: -0.07, cnr: -0.22, cnda: 0.002, cndaCl: 0.012, cndr: 0.105, cnSpoiler: 0.004, alphaDir: [22, 40], cnbPostStall: 0.05 },
    stall: { wingDrop: 0.01, clpPost: 0.02, buffetMargin: 2.5, warnMargin: 2.0 },
    flaps: {
      // lever positions 1 / 2 / 3 / FULL. Slats extend with every detent (CONF 1 = slats only); flaps 0/15/20/35 deg
      detents: [
        { name: 'UP',   deg: 0,  pos: 0.00, slat: 0,    dcl0: 0.00, clMax: 1.55 },
        { name: '1',    deg: 0,  pos: 0.15, slat: 0.67, dcl0: 0.08, clMax: 1.85, dcd0: 0.004, dcm0: -0.005 },
        { name: '2',    deg: 15, pos: 0.45, slat: 0.80, dcl0: 0.38, clMax: 2.20, dcd0: 0.014, dcm0: -0.04 },
        { name: '3',    deg: 20, pos: 0.60, slat: 0.80, dcl0: 0.52, clMax: 2.40, dcd0: 0.026, dcm0: -0.06, kFactor: 1.05 },
        { name: 'FULL', deg: 35, pos: 1.00, slat: 1.00, dcl0: 0.80, clMax: 2.70, dcd0: 0.060, dcm0: -0.10, kFactor: 1.10 },
      ],
      time: 20, slatTime: 8, takeoff: 2, landing: 4,
    },
    slat: { dAlphaStall: 5, dcd0: 0.003 },
  },
  controls: {
    elevator: { max: 30, rate: 40, tau: 0.08 },
    aileron: { max: 25, rate: 50, tau: 0.08 },
    rudder: { max: 25, rate: 50, tau: 0.08, qBlowdown: 5500 },
    spoilers: { flightMax: 0.5, rollGain: 1.0, rollDeadband: 0.15, rollMax: 0.45, time: 0.7, autoGround: true },
    trim: { max: 13, rate: 0.035, authority: 1 },
  },
  engines: {
    type: 'turbofan-hb', throttleRatio: 1.06, machLapse: 0.68,
    // installed max-climb / max-continuous thrust as a fraction of sea-level static (120.6 kN): ~0.55 at M0.38 SL
    // (initial climb ~3700 ft/min at 64 t), ~0.20 at FL360 M0.78 (CFM LEAP-1A cruise-thrust data)
    thrustTable: {
      mach: [0, 0.2, 0.4, 0.6, 0.8, 0.9],
      alt:  [0, 3000, 6000, 9000, 11000, 12500],
      mil: [
        [1.00, 0.76, 0.55, 0.46, 0.42, 0.41],
        [0.72, 0.58, 0.45, 0.38, 0.35, 0.34],
        [0.50, 0.42, 0.34, 0.30, 0.29, 0.29],
        [0.34, 0.29, 0.25, 0.23, 0.23, 0.23],
        [0.26, 0.23, 0.21, 0.20, 0.20, 0.20],
        [0.20, 0.18, 0.165, 0.16, 0.16, 0.16],
      ],
    },
    n1Idle: 0.21, n2Idle: 0.60, spoolUp: 6, spoolDown: 4.5, idleThrust: 0.035, idleFuelFlow: 0.10,
    tsfc: [0.32, 0.40], egt: [440, 890, 890], startTime: 16,
    reverser: { fraction: 0.40, time: 2, power: 0.8, minSpeed: 30, stowSpeed: 26 },
  },
  gear: {
    nose: { travel: 0.38 }, main: { travel: 0.45 },
    retractTime: 8, steerMax: 70, steerLatG: 0.22, brakeMu: 0.45, maxSinkRate: 3.05, crashSinkRate: 6,
  },
  structure: { tailStrikeDeg: 11.7, bellyY: -1.3 },
  limits: { vmo: 180, mmo: 0.82, gearSpeed: 130 },      // 350 KCAS / M0.82
  fcs: {
    type: 'fbw-airliner',
    pitchRateMax: 10, rollRate: 10, stickShape: 0, nzGain: 2, nzMax: 2.5, nzMin: -1, bankMax: 67, bankNeutral: 33, pitchMax: 30, pitchMin: -15,
    yawDamper: 1, sasAuthority: 0.35, betaGain: 3, ari: 0.12,
  },
  autopilot: { bankMax: 25, vsMax: 10, turnRate: 3 },
  targets: {
    stallSpeedLanding: [55, 0.07],            // m/s CAS, FULL, 64 t (Vref 133 kt / 1.23)
    stallSpeedClean: [74, 0.07],
    rotateSpeed: 72,
    takeoffRoll: [1150, 0.3],
    landingRoll: [700, 0.35],
    climbRate: [19, 0.3],
    climbSpeed: 128,
    maxSpeedSL: [180, 0.03], maxSpeedSLisCas: true,
    maxSpeedAlt: [0.82, 0.04], maxSpeedAltitude: 11000,
    ceiling: 12000, ceilingMach: 0.78,
    rollRate: [10, 0.3], rollSpeed: 130,
    sustainedTurn: [0, 0], instantTurn: [0, 0],
    maxG: [2.5, 0.2], maxGSpeed: 130,
    glideRatio: [17, 0.12], glideSpeed: 115,
    cruise: { altitude: 11000, mach: 0.78, fuelFlow: [2200, 0.15] },
    approachAoA: [5.2, 0.25],
  },
};
