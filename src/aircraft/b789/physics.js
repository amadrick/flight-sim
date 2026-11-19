// Boeing 787-9 Dreamliner (GEnx-1B74/75, ~330 kN class) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./index.js (specs) and ./geometry.js.
// Sources: Boeing 787 Airport Planning doc D6-58333 (weights, field lengths), 787 FCOM-style speeds (Vref30 ~ 148 kt at
// 200 t, Vmo 330 kt / Mmo 0.90), GEnx-1B type data (SLS thrust, TSFC ~0.52-0.55 at cruise), Roskam class-II methods
// for derivative magnitudes and radii of gyration. High-aspect-ratio (AR 9.6) composite wing, L/D ~ 20-21 at cruise.
// Tuned with `node tools/flight-test.mjs b789`.
export default {
  schema: 1,
  mass: {
    payload: 10550,                      // ~ 80 pax + bags (light, long-haul tail end) -> 200 t typical mass with 60.6 t fuel
    fuel: 60600,
    gyration: { rx: 0.25, ry: 0.36, rz: 0.46 },
  },
  aero: {
    ref: { chord: 6.2 },                 // mean aerodynamic chord of the 377 m2 wing
    lift: { cl0: 0.17, cla: 5.8, clMax: 1.35, sharpness: 36, clMaxNeg: 0.9, postStallCl: 1.0, cd90: 1.3, spoiler: 0.75 },
    mach: {
      m:     [0,      0.3,    0.5,    0.6,    0.7,    0.75,   0.80,   0.83,   0.85,   0.87,   0.90,   0.95,   1.0],
      cla:   [1.00,   1.03,   1.10,   1.15,   1.22,   1.27,   1.31,   1.32,   1.32,   1.31,   1.26,   1.15,   1.00],
      clMax: [1.00,   0.98,   0.90,   0.83,   0.76,   0.70,   0.62,   0.57,   0.54,   0.50,   0.44,   0.40,   0.38],   // buffet boundary / low-speed CLmax
      cd0:   [0.0170, 0.0170, 0.0170, 0.0170, 0.0170, 0.0165, 0.0160, 0.0158, 0.0160, 0.0180, 0.0270, 0.0700, 0.1000],
      k:     [0.0440, 0.0440, 0.0440, 0.0440, 0.0442, 0.0445, 0.0452, 0.0462, 0.0475, 0.0500, 0.0600, 0.0800, 0.0900],
      xac:   [0,      0,      0,      0,      0,      0.003,  0.012,  0.022,  0.032,  0.045,  0.070,  0.090,  0.100],
      ctrl:  [1,      1,      1,      1,      0.99,   0.98,   0.96,   0.94,   0.92,   0.90,   0.85,   0.76,   0.70],
    },
    drag: { clMinDrag: 0.10, gear: 0.017, spoiler: 0.085, speedbrake: 0.03, beta: 1.4, elevator: 0.10 },
    // clde ~ 0: the all-moving-tail lift is small on a 787, and a non-zero value makes the nose-up elevator cause a sink before the flare bites
    pitch: { cm0: 0.02, staticMargin: 0.20, cmq: -24, cmde: 2.0, clde: 0.0, cmPostStall: -1.4, cmGear: -0.01, cmSpoiler: 0.02 },
    side: { cyb: -0.95, cydr: 0.22 },
    roll: { clb: -0.10, clbCl: -0.05, clp: -0.45, clr: 0.08, clrCl: 0.20, clda: 0.050, cldr: 0.012, clSpoiler: 0.040 },
    yaw: { cnb: 0.14, cnp: -0.02, cnpCl: -0.07, cnr: -0.22, cnda: 0.002, cndaCl: 0.012, cndr: 0.100, cnSpoiler: 0.004, alphaDir: [22, 40], cnbPostStall: 0.05 },
    stall: { wingDrop: 0.015, clpPost: 0.02, buffetMargin: 2.5, warnMargin: 2.0 },
    flaps: {
      // 1/5/10/15/17/18/20/25/30; clMax from Vs at 200 t (CLmax = 2W/(rho S Vs^2))
      detents: [
        { name: 'UP', deg: 0,  pos: 0.00, slat: 0, dcl0: 0.00, clMax: 1.35 },
        { name: '1',  deg: 1,  pos: 0.05, slat: 1, dcl0: 0.10, clMax: 1.65, dcd0: 0.004, dcm0: -0.004 },
        { name: '5',  deg: 5,  pos: 0.17, slat: 1, dcl0: 0.26, clMax: 1.85, dcd0: 0.010, dcm0: -0.012 },
        { name: '10', deg: 10, pos: 0.33, slat: 1, dcl0: 0.38, clMax: 1.98, dcd0: 0.016, dcm0: -0.020 },
        { name: '15', deg: 15, pos: 0.45, slat: 1, dcl0: 0.50, clMax: 2.10, dcd0: 0.024, dcm0: -0.028 },
        { name: '17', deg: 17, pos: 0.52, slat: 1, dcl0: 0.55, clMax: 2.17, dcd0: 0.028, dcm0: -0.030 },
        { name: '18', deg: 18, pos: 0.57, slat: 1, dcl0: 0.58, clMax: 2.22, dcd0: 0.031, dcm0: -0.032 },
        { name: '20', deg: 20, pos: 0.65, slat: 1, dcl0: 0.64, clMax: 2.30, dcd0: 0.037, dcm0: -0.036, kFactor: 1.04 },
        { name: '25', deg: 25, pos: 0.82, slat: 1, dcl0: 0.72, clMax: 2.37, dcd0: 0.038, dcm0: -0.040, kFactor: 1.07 },
        { name: '30', deg: 30, pos: 1.00, slat: 1, dcl0: 0.80, clMax: 2.42, dcd0: 0.045, dcm0: -0.048, kFactor: 1.10 },
      ],
      time: 25, slatTime: 8, takeoff: 2, landing: 9,
    },
    slat: { dAlphaStall: 5, dcd0: 0.003 },
  },
  controls: {
    elevator: { max: 25, rate: 40, tau: 0.10 },
    aileron: { max: 20, rate: 40, tau: 0.10 },
    rudder: { max: 25, rate: 40, tau: 0.10, qBlowdown: 5500 },
    spoilers: { flightMax: 0.5, rollGain: 1.0, rollDeadband: 0.15, rollMax: 0.45, time: 0.8, autoGround: true },
    trim: { max: 22, rate: 0.03, authority: 1 },
  },
  engines: {
    type: 'turbofan-hb', throttleRatio: 1.06, machLapse: 0.55, altLapse: 0.88,
    n1Idle: 0.20, n2Idle: 0.60, spoolUp: 7, spoolDown: 7, idleThrust: 0.035, idleFuelFlow: 0.14,
    tsfc: [0.32, 0.34], egt: [440, 890, 890], startTime: 18,
    reverser: { fraction: 0.40, time: 2, power: 0.8, minSpeed: 30, stowSpeed: 26 },
    thrustLineOffset: 0.15,   // nozzles moved up 0.15 m in geometry.js (engines installed 1.5° nose down): keeps the tuned thrust line
  },
  gear: {
    nose: { travel: 0.40 }, main: { travel: 0.48 },
    retractTime: 12, steerMax: 70, steerLatG: 0.20, brakeMu: 0.30, maxSinkRate: 3.05, crashSinkRate: 6,
  },
  structure: { tailStrikeDeg: 10.5, bellyY: -1.6 },
  limits: { vmo: 170, mmo: 0.90, gearSpeed: 118 },      // 330 KCAS / M0.90; gear 270 kt
  fcs: {
    // Boeing FBW, C*U-style: stick = load-factor demand with speed-stable trim, soft envelope protection (AoA, 2.5 g, bank 67/33,
    // overspeed). pitchGainMax/pitchBandwidth/nzGain are raised so the heavy airframe can flare; the large rate loop plus
    // extra pitch/roll damping (cmq, clp) gives the smooth, gust-suppressed ride.
    type: 'fbw-airliner',
    nzMax: 2.5, nzMin: -1.0, alphaMax: 12.5, alphaStallMargin: 0.8, pitchRateMax: 10, rotationRate: 3,
    pitchGainMax: 12, pitchBandwidth: 4.5, rollRate: 8, yawDamper: 1, betaGain: 3, ari: 0.18,
  },
  autopilot: { bankMax: 25, vsMax: 10, turnRate: 3 },
  targets: {
    stallSpeedLanding: [62, 0.07],            // m/s CAS, flaps 30, 200 t (Vref30 ~148 kt / 1.23)
    stallSpeedClean: [78, 0.07],
    takeoffRoll: [1800, 0.3],                 // m, flaps 5, 200 t, SL ISA
    landingRoll: [1200, 0.35],                // m, max manual braking + reverse
    climbRate: [24, 0.3],                     // m/s at sea level, 200 t
    climbSpeed: 140,
    maxSpeedSL: [170, 0.03], maxSpeedSLisCas: true,
    maxSpeedAlt: [0.90, 0.04], maxSpeedAltitude: 11000,
    ceiling: 12500, ceilingMach: 0.80,   // thrust-limited ceiling at 200 t (13 100 m certified ceiling needs ~ 170 t)
    rollRate: [10, 0.35], rollSpeed: 76,
    sustainedTurn: [0, 0], instantTurn: [0, 0],
    maxG: [2.5, 0.2], maxGSpeed: 130,
    glideRatio: [19, 0.12], glideSpeed: 122,
    cruise: { altitude: 11000, mach: 0.85, fuelFlow: [5400, 0.15] },
    approachAoA: [5.5, 0.25],
  },
};
