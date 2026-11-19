// Airbus A380-800 (Trent 972-84 / GP7270 class, 4 x ~311 kN) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./index.js (specs) and ./geometry.js.
// Sources: Airbus A380 Aircraft Characteristics for Airport Planning (AC), FCOM speeds (Vref/VLS ~ 140 kt at MLW 391 t),
// EASA TCDS A.110 (limits, Vmo 340 / Mmo 0.89), Rolls-Royce Trent 900 data, Roskam class-II methods for derivatives.
// Tuned with `node tools/flight-test.mjs a388`. All performance targets are for the test mass of 450 t (typical flying
// weight); the sheet's MTOW-based figures (take-off ~2,900 m at 575 t, climb 8 m/s at MTOW) scale to these.
export default {
  schema: 1,
  mass: {
    payload: 19600,                      // crew + pax/bags/cargo as in the typical-mass loading
    fuel: 153600,                        // kg at start -> 450 000 kg typical flying mass
    // published-class estimates at 450 t (data sheet section 9): Ixx 5.6e7, Iyy 9.5e7, Izz 1.37e8 kg m^2
    inertia: { ixx: 5.61e7, iyy: 9.52e7, izz: 1.371e8, ixz: 0, atMass: 450000 },
  },
  aero: {
    ref: { span: 79.75, chord: 12.0 },   // MAC ~12 m
    lift: { cl0: 0.20, cla: 5.7, clMax: 1.15, sharpness: 38, clMaxNeg: 0.7, postStallCl: 1.0, cd90: 1.3, spoiler: 0.7 },
    mach: {
      m:     [0,      0.3,    0.5,    0.6,    0.7,    0.75,   0.78,   0.80,   0.82,   0.84,   0.86,   0.89,   0.95,   1.0],
      cla:   [1.00,   1.03,   1.10,   1.15,   1.22,   1.27,   1.30,   1.32,   1.33,   1.33,   1.30,   1.22,   1.10,   1.00],
      clMax: [1.00,   0.98,   0.92,   0.87,   0.83,   0.80,   0.78,   0.76,   0.74,   0.71,   0.68,   0.60,   0.50,   0.45],   // buffet boundary / low-speed CLmax
      cd0:   [0.0146, 0.0146, 0.0146, 0.0146, 0.0146, 0.0146, 0.0146, 0.0147, 0.0148, 0.0150, 0.0158, 0.0200, 0.0600, 0.1100],
      k:     [0.0420, 0.0420, 0.0420, 0.0420, 0.0420, 0.0420, 0.0420, 0.0422, 0.0430, 0.0440, 0.0450, 0.0500, 0.0800, 0.0900],
      xac:   [0,      0,      0,      0,      0,      0,      0.003,  0.006,  0.010,  0.015,  0.020,  0.030,  0.040,  0.050],
      ctrl:  [1,      1,      1,      1,      0.99,   0.98,   0.97,   0.95,   0.93,   0.91,   0.89,   0.84,   0.76,   0.70],
    },
    drag: { clMinDrag: 0.05, gear: 0.022, spoiler: 0.06, speedbrake: 0.05, beta: 1.4, elevator: 0.10 },
    pitch: { cm0: 0.02, staticMargin: 0.20, cmq: -16, cmde: 2.7, clde: 0.0, cmPostStall: -1.4, cmGear: -0.01, cmSpoiler: 0.02 },
    side: { cyb: -0.95, cydr: 0.22 },
    roll: { clb: -0.10, clbCl: -0.05, clp: -0.45, clr: 0.08, clrCl: 0.20, clda: 0.065, cldr: 0.012, clSpoiler: 0.040 },
    yaw: { cnb: 0.14, cnp: -0.02, cnpCl: -0.07, cnr: -0.22, cnda: 0.002, cndaCl: 0.012, cndr: 0.095, cnSpoiler: 0.004, alphaDir: [22, 40], cnbPostStall: 0.05 },
    stall: { wingDrop: 0.015, clpPost: 0.02, buffetMargin: 2.5, warnMargin: 2.0 },
    flaps: {
      // CONF 1 / 1+F / 2 / 3 / FULL (slats 18/18/20/20/24 deg, flaps 0/8/17/25/32 deg)
      detents: [
        { name: '0',    deg: 0,  pos: 0.00, slat: 0, dcl0: 0.00, clMax: 1.15 },
        { name: '1',    deg: 0,  pos: 0.10, slat: 1, dcl0: 0.06, clMax: 1.45, dcd0: 0.004, dcm0: -0.01 },
        { name: '1+F',  deg: 8,  pos: 0.30, slat: 1, dcl0: 0.28, clMax: 1.62, dcd0: 0.012, dcm0: -0.03 },
        { name: '2',    deg: 17, pos: 0.55, slat: 1, dcl0: 0.45, clMax: 1.78, dcd0: 0.022, dcm0: -0.06 },
        { name: '3',    deg: 25, pos: 0.78, slat: 1, dcl0: 0.60, clMax: 1.92, dcd0: 0.036, dcm0: -0.09, kFactor: 1.06 },
        { name: 'FULL', deg: 32, pos: 1.00, slat: 1, dcl0: 0.58, clMax: 2.05, dcd0: 0.052, dcm0: -0.12, kFactor: 1.10 },
      ],
      time: 30, slatTime: 10, takeoff: 2, landing: 5,
    },
    slat: { dAlphaStall: 4, dcd0: 0.003 },
  },
  controls: {
    elevator: { max: 25, rate: 60, tau: 0.07 },
    aileron: { max: 25, rate: 40, tau: 0.12 },
    rudder: { max: 30, rate: 40, tau: 0.12, qBlowdown: 5500 },
    spoilers: { flightMax: 0.5, rollGain: 1.0, rollDeadband: 0.15, rollMax: 0.45, time: 1.2, autoGround: true },
    trim: { max: 22, rate: 0.03, authority: 1 },
  },
  engines: {
    type: 'turbofan-hb', throttleRatio: 1.06, machLapse: 0.58, altLapse: 0.8,
    n1Idle: 0.20, n2Idle: 0.60, spoolUp: 8, spoolDown: 5, idleThrust: 0.035, idleFuelFlow: 0.20,
    tsfc: [0.29, 0.36], egt: [440, 890, 890], startTime: 20,
    // Only the two INBOARD engines have reversers. The simulator decides the auto-deploy from engine index 0, so the
    // engine order here is [inboard L, outboard L, inboard R, outboard R] (positions overridden accordingly).
    each: [
      { pos: [-12.7, -3.2, -2.5], reverser: { fraction: 0.40, time: 2.5, power: 0.8, minSpeed: 30, stowSpeed: 26 } },
      { pos: [-25.2, -3.4, 7.8], reverser: null },
      { pos: [12.7, -3.2, -2.5], reverser: { fraction: 0.40, time: 2.5, power: 0.8, minSpeed: 30, stowSpeed: 26 } },
      { pos: [25.2, -3.4, 7.8], reverser: null },
    ],
  },
  gear: {
    nose: { travel: 0.45 }, main: { travel: 0.5 },
    retractTime: 14, steerMax: 70, steerLatG: 0.20, brakeMu: 0.36, maxSinkRate: 3.05, crashSinkRate: 6,
  },
  structure: { tailStrikeDeg: 10, bellyY: -3.5 },
  limits: { vmo: 175, mmo: 0.89, gearSpeed: 133 },       // 340 KCAS / M0.89; VLE 250 kt
  fcs: {
    type: 'fbw-airliner',
    nzMax: 2.5, nzMin: -1, pitchRateMax: 9, pitchGainMax: 20, pitchBandwidth: 7, stickShape: 0.0, nzGain: 2.5, rotationRate: 3.5, rotationPitchMax: 8.6,
    gearDown: { nzMax: 2.5, rollRate: 8 },
    rollRate: 12,
    betaGain: 3, yawDamper: 1,
  },
  autopilot: { bankMax: 25, vsMax: 10, turnRate: 3 },
  targets: {
    stallSpeedLanding: [65, 0.08],            // m/s CAS, CONF FULL, 450 t (CLmax 2.05)
    stallSpeedClean: [86, 0.10],
    takeoffRoll: [1850, 0.3],                 // m ground roll, CONF 1+F, TOGA, 450 t (2 900 m at 575 t)
    rotateSpeed: 75,
    landingRoll: [1150, 0.35],                // m
    climbRate: [17, 0.3],                     // m/s, sea level, TOGA, 250 kt, 450 t
    climbSpeed: 129,
    maxSpeedSL: [175, 0.03], maxSpeedSLisCas: true,
    maxSpeedAlt: [0.88, 0.04], maxSpeedAltitude: 11000,
    ceiling: 12500, ceilingMach: 0.83,
    rollRate: [12, 0.3], rollSpeed: 130,
    maxG: [2.5, 0.2], maxGSpeed: 150,
    glideRatio: [21, 0.12], glideSpeed: 125,
    cruise: { altitude: 10700, mach: 0.85, fuelFlow: [11800, 0.15] },
    approachAoA: [6.5, 0.25],
  },
};
