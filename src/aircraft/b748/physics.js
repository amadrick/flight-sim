// Boeing 747-8 Intercontinental (4 x GEnx-2B67) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./index.js (specs) and ./geometry.js.
// Sources / basis: Boeing 747-8 airport-planning document D6-58326 (dimensions, MTOW/MLW, gear), 747-8 FCOM-class
// speeds (Vref30 ~150 kt at 300 t, Vmo 365 KCAS / Mmo 0.90), GEnx-2B67 type-certificate data (66,500 lbf), and
// Heffley-Jewell / NASA CR-2144 747-100/-400 derivative magnitudes for inertias and stability derivatives.
// Test mass of tools/flight-test.mjs is the typical 360 t (OEW 220.1 t + 114.6 t fuel + 25.3 t payload), ISA, calm.
// Tuned with `node tools/flight-test.mjs b748`.
export default {
  schema: 1,
  mass: {
    payload: 25300,                      // ~ 300 pax + bags (mid-mission, 360 t total with fuel below)
    fuel: 114600,                        // kg at start -> 360 000 kg typical mass
    // 747-400 published inertias (Heffley & Jewell, 288 t: Ixx 24.7e6, Iyy 44.9e6, Izz 67.4e6 kg m^2) scaled to 360 t
    // and +8 % for the stretched -8 (the data sheet's gyration-method Iyy of 84e6 is ~ 40 % too high for a 747).
    inertia: { ixx: 33.0e6, iyy: 60.0e6, izz: 90.0e6, ixz: 1.5e6, atMass: 360000 },
  },
  aero: {
    ref: { chord: 8.3 },                 // MAC of the 554 m^2 / 68.4 m reference wing (8.3 m)
    lift: { cl0: 0.28, cla: 5.7, clMax: 1.25, sharpness: 34, clMaxNeg: 0.8, postStallCl: 1.0, cd90: 1.3, spoiler: 0.55 },
    mach: {
      // swept supercritical wing: drag rise beyond M 0.86, MMO 0.90; buffet boundary (clMax ratio) falls steeply
      m:     [0,      0.3,    0.5,    0.6,    0.7,    0.78,   0.82,   0.85,   0.87,   0.89,   0.91,   0.95,   1.0],
      cla:   [1.00,   1.02,   1.08,   1.12,   1.18,   1.24,   1.27,   1.30,   1.30,   1.28,   1.22,   1.12,   1.00],
      clMax: [1.00,   0.98,   0.92,   0.86,   0.78,   0.70,   0.64,   0.58,   0.53,   0.47,   0.42,   0.38,   0.36],
      cd0:   [0.0172, 0.0172, 0.0172, 0.0173, 0.0175, 0.0179, 0.0183, 0.0188, 0.0215, 0.0290, 0.0420, 0.0800, 0.1100],
      k:     [0.0440, 0.0440, 0.0440, 0.0440, 0.0442, 0.0447, 0.0455, 0.0470, 0.0510, 0.0610, 0.0720, 0.0850, 0.0950],
      xac:   [0,      0,      0,      0,      0,      0.005,  0.012,  0.025,  0.040,  0.055,  0.075,  0.095,  0.100],
      ctrl:  [1,      1,      1,      1,      0.99,   0.97,   0.95,   0.93,   0.91,   0.88,   0.83,   0.75,   0.70],
    },
    drag: { clMinDrag: 0.05, gear: 0.024, spoiler: 0.075, beta: 1.4, elevator: 0.10 },
    pitch: { cm0: 0.02, staticMargin: 0.22, cmq: -20, cmde: 2.0, clde: 0.35, cmPostStall: -1.2, cmGear: -0.01, cmSpoiler: 0.02 },
    side: { cyb: -0.95, cydr: 0.20 },
    roll: { clb: -0.10, clbCl: -0.05, clp: -0.50, clr: 0.08, clrCl: 0.20, clda: 0.06, cldr: 0.010, clSpoiler: 0.045 },
    yaw: { cnb: 0.14, cnp: -0.02, cnpCl: -0.07, cnr: -0.28, cnda: 0.002, cndaCl: 0.012, cndr: 0.10, cnSpoiler: 0.004, alphaDir: [22, 40], cnbPostStall: 0.05 },
    stall: { wingDrop: 0.02, clpPost: 0.02, buffetMargin: 2.5, warnMargin: 2.0 },
    flaps: {
      // 1/5/10/20/25/30; Krueger (inboard) + variable-camber slats extend from detent 1; triple-slotted Fowler flaps
      detents: [
        { name: 'UP', deg: 0,  pos: 0.00, slat: 0, dcl0: 0.00, clMax: 1.25 },
        { name: '1',  deg: 1,  pos: 0.10, slat: 1, dcl0: 0.06, clMax: 1.55, dcd0: 0.004, dcm0: -0.01 },
        { name: '5',  deg: 5,  pos: 0.25, slat: 1, dcl0: 0.25, clMax: 1.75, dcd0: 0.010, dcm0: -0.03 },
        { name: '10', deg: 10, pos: 0.40, slat: 1, dcl0: 0.38, clMax: 1.90, dcd0: 0.016, dcm0: -0.05 },
        { name: '20', deg: 20, pos: 0.60, slat: 1, dcl0: 0.58, clMax: 2.05, dcd0: 0.030, dcm0: -0.08 },
        { name: '25', deg: 25, pos: 0.80, slat: 1, dcl0: 0.70, clMax: 2.15, dcd0: 0.044, dcm0: -0.10, kFactor: 1.05 },
        { name: '30', deg: 30, pos: 1.00, slat: 1, dcl0: 0.80, clMax: 2.20, dcd0: 0.058, dcm0: -0.12, kFactor: 1.08 },
      ],
      time: 30, slatTime: 8, takeoff: 4, landing: 6,
    },
    slat: { dAlphaStall: 4, dcd0: 0.003 },
  },
  controls: {
    elevator: { max: 25, rate: 30, tau: 0.12 },
    aileron: { max: 20, rate: 30, tau: 0.12 },
    rudder: { max: 25, rate: 30, tau: 0.12, qBlowdown: 6000 },
    spoilers: { flightMax: 0.5, rollGain: 1.0, rollDeadband: 0.15, rollMax: 0.45, time: 1.0, autoGround: true },
    trim: { max: 15, rate: 0.03, authority: 1 },         // stabiliser, elevator-equivalent degrees
  },
  engines: {
    type: 'turbofan-hb', throttleRatio: 1.10, machLapse: 0.50,
    n1Idle: 0.20, n2Idle: 0.58, spoolUp: 8, spoolDown: 6.5, idleThrust: 0.035, idleFuelFlow: 0.20,
    tsfc: [0.30, 0.30], egt: [450, 900, 900], startTime: 22,
    reverser: { fraction: 0.35, time: 2.5, power: 0.75, minSpeed: 30, stowSpeed: 25 },
  },
  gear: {
    nose: { travel: 0.45 }, main: { travel: 0.55 },
    retractTime: 14, extendTime: 14, steerMax: 70, steerLatG: 0.18, brakeMu: 0.38, maxSinkRate: 3.05, crashSinkRate: 6,
  },
  structure: { tailStrikeDeg: 11.5, bellyY: -3.2 },
  limits: { vmo: 188, mmo: 0.90, gMax: 2.5, gMin: -1.0, gearSpeed: 128 },     // 365 KCAS / M0.90; gear 250 KCAS
  fcs: {
    type: 'conventional',
    feelQ: 4500, feelMin: 0.12, rollFeelQ: 7000, trimFollowUp: 0.3,          // rollFeelQ: outboard-aileron lock-out at speed
    yawDamper: 1, sasAuthority: 0.35, betaGain: 3, ari: 0.10,
    pitchRateMax: 7, rotationRate: 3.5, nzMax: 2.5, gearDown: { nzMax: 2.0 },
  },
  autopilot: { bankMax: 25, vsMax: 12, turnRate: 2.5 },
  targets: {
    stallSpeedLanding: [68, 0.07],            // m/s CAS, flaps 30, 360 t (Vref30 = 1.23 Vs = 84 m/s; 150 kt at 300 t)
    stallSpeedClean: [91, 0.07],              // CLmax 1.25 at 360 t
    takeoffRoll: [1800, 0.3],                 // m ground roll at full thrust, flaps 20, 360 t (derated 3 000+ m field length at MTOW)
    rotateSpeed: 77, rotatePitch: 9,                          // m/s (150 kt at 360 t; 84 m/s at MTOW)
    landingRoll: [1200, 0.35],                // m, max manual braking + reversers at ~360 t (the 2 100 m of the data sheet is the factored certified distance)
    climbRate: [24, 0.3],                     // m/s at SL, full thrust, 250 kt (~ 3 900 ft/min at 360 t; 10 m/s data-sheet figure is MTOW, derated)
    climbSpeed: 128,
    maxSpeedSL: [188, 0.03], maxSpeedSLisCas: true,   // VMO 365 KCAS must be reachable
    maxSpeedAlt: [0.87, 0.04], maxSpeedAltitude: 10668,
    ceiling: 10700,
    ceilingMach: 0.85,
    rollRate: [10, 0.3], rollSpeed: 80,      // deg/s, approach speed, flaps 30 (real max ~ 8-10; the 30° bank test needs >= 11)
    maxG: [2.5, 0.2], maxGSpeed: 165,
    glideRatio: [18, 0.12], glideSpeed: 125,
    cruise: { altitude: 10668, mach: 0.855, fuelFlow: [10300, 0.15] },   // kg/h total, ~ 360 t
    approachAoA: [5.5, 0.25],                 // deg, flaps 30
  },
};
