// Boeing C-17A Globemaster III (4 x F117-PW-100) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./index.js (specs) and ./geometry.js.
// Sources: C-17A flight manual / USAF fact sheet (speeds, weights), Boeing/MDC EBF literature (powered-lift CLmax ~3+),
// PW2040 / F117-PW-100 data (40 440 lbf, BPR 5.9, TSFC ~0.33 static / ~0.57 cruise), Roskam class-II methods for
// derivative magnitudes and radii of gyration. Tuned with `node tools/flight-test.mjs c17`.
export default {
  schema: 1,
  mass: {
    payload: 20000,                      // cargo/pax load for the 200 t typical flying weight
    fuel: 51900,                         // kg at start -> 200 000 kg typical mass
    // Radius-of-gyration estimate from docs/aircraft/c17.md (Ixx 10.5e6, Iyy 22.5e6, Izz 32.4e6 at 200 t): heavy, long
    // cargo box with wing-mounted engines and fuel.
    gyration: { rx: 0.28, ry: 0.40, rz: 0.485 },
  },
  aero: {
    ref: { span: 51.75, chord: 7.6 },    // 353 m2 / 51.75 m ... mean chord ~ 6.8 m geometric, 7.6 m used for moment scaling
    // cla: AR 7.6 (8.4 with winglets), 24 deg sweep -> ~5.2/rad. cl0: wing incidence + camber of the supercritical section.
    lift: { cl0: 0.10, cla: 5.3, clMax: 1.55, sharpness: 34, clMaxNeg: 0.9, postStallCl: 1.0, cd90: 1.3, spoiler: 0.75 },
    mach: {
      // Supercritical wing: drag divergence ~M0.78, steep above 0.80 (max M0.825).
      m:     [0,      0.3,    0.5,    0.6,    0.7,    0.74,   0.77,   0.79,   0.81,   0.83,   0.85,   0.90,   0.95,   1.0],
      cla:   [1.00,   1.03,   1.09,   1.14,   1.20,   1.24,   1.27,   1.29,   1.30,   1.30,   1.27,   1.18,   1.08,   1.00],
      clMax: [1.00,   0.98,   0.90,   0.83,   0.75,   0.70,   0.66,   0.62,   0.57,   0.52,   0.47,   0.42,   0.38,   0.36],
      cd0:   [0.0215, 0.0215, 0.0215, 0.0216, 0.0219, 0.0226, 0.0238, 0.0262, 0.0310, 0.0390, 0.0520, 0.0800, 0.1100, 0.1400],
      k:     [0.0460, 0.0460, 0.0460, 0.0462, 0.0468, 0.0476, 0.0488, 0.0505, 0.0535, 0.0580, 0.0640, 0.0760, 0.0880, 0.1000],
      xac:   [0,      0,      0,      0,      0,      0.004,  0.010,  0.018,  0.030,  0.045,  0.060,  0.085,  0.100,  0.110],
      ctrl:  [1,      1,      1,      1,      0.99,   0.98,   0.97,   0.95,   0.92,   0.89,   0.86,   0.80,   0.74,   0.70],
    },
    drag: { clMinDrag: 0.10, gear: 0.030, spoiler: 0.09, beta: 1.4, elevator: 0.12 },
    pitch: { cm0: 0.02, staticMargin: 0.20, cmq: -18, cmde: 1.10, clde: 0.35, cmPostStall: -1.4, cmGear: -0.015, cmSpoiler: 0.02 },
    side: { cyb: -0.95, cydr: 0.22 },
    roll: { clb: -0.10, clbCl: -0.05, clp: -0.42, clr: 0.08, clrCl: 0.20, clda: 0.055, cldr: 0.012, clSpoiler: 0.035 },
    yaw: { cnb: 0.13, cnp: -0.02, cnpCl: -0.07, cnr: -0.20, cnda: 0.002, cndaCl: 0.012, cndr: 0.095, cnSpoiler: 0.004, alphaDir: [22, 40], cnbPostStall: 0.05 },
    stall: { wingDrop: 0.02, clpPost: 0.02, buffetMargin: 2.5, warnMargin: 2.0 },
    flaps: {
      // Real detents 0 / 16 / 25 / 33 / 40 deg. Externally blown flaps: the engine exhaust over the double-slotted flaps
      // is modelled as generous lift (CLmax ~3.0 at 40 deg) and heavy drag, which gives the steep, slow STOL approach.
      detents: [
        { name: 'UP', deg: 0,  pos: 0.00, slat: 0, dcl0: 0.00, clMax: 1.55 },
        { name: '16', deg: 16, pos: 0.40, slat: 0.6, dcl0: 0.60, clMax: 2.25, dcd0: 0.012, dcm0: -0.05 },
        { name: '25', deg: 25, pos: 0.62, slat: 1, dcl0: 0.85, clMax: 2.55, dcd0: 0.040, dcm0: -0.08, kFactor: 1.05 },
        { name: '33', deg: 33, pos: 0.82, slat: 1, dcl0: 1.00, clMax: 2.80, dcd0: 0.065, dcm0: -0.11, kFactor: 1.08 },
        { name: '40', deg: 40, pos: 1.00, slat: 1, dcl0: 1.12, clMax: 3.00, dcd0: 0.095, dcm0: -0.14, kFactor: 1.12 },
      ],
      time: 22, slatTime: 8, takeoff: 1, landing: 4,
    },
    slat: { dAlphaStall: 4, dcd0: 0.004 },
  },
  controls: {
    elevator: { max: 25, rate: 25, tau: 0.10 },
    aileron: { max: 20, rate: 30, tau: 0.10 },
    rudder: { max: 30, rate: 30, tau: 0.10, qBlowdown: 6000 },
    spoilers: { flightMax: 0.5, rollGain: 1.0, rollDeadband: 0.15, rollMax: 0.45, time: 0.8, autoGround: true },
    trim: { max: 20, rate: 0.03, authority: 1 },
  },
  engines: {
    type: 'turbofan-hb', throttleRatio: 1.06, machLapse: 0.50, altLapse: 0.93,
    n1Idle: 0.22, n2Idle: 0.60, spoolUp: 5, spoolDown: 4, idleThrust: 0.04, idleFuelFlow: 0.17,
    tsfc: [0.34, 0.45], egt: [440, 900, 900], startTime: 18,
    reverser: { fraction: 0.50, time: 2.5, power: 0.85, minSpeed: 30, stowSpeed: 24 },
  },
  gear: {
    nose: { travel: 0.45 }, main: { travel: 0.55 },
    retractTime: 12, steerMax: 60, steerLatG: 0.20, brakeMu: 0.45, maxSinkRate: 4.4, crashSinkRate: 7.0,
  },
  structure: { tailStrikeDeg: 12, bellyY: -2.0 },
  limits: { vmo: 180, mmo: 0.825, gearSpeed: 128 },   // 350 KCAS / M0.825; gear 250 KCAS
  fcs: {
    type: 'fbw-airliner',
    nzMax: 2.5, nzMin: -1, alphaMax: 15, pitchRateMax: 7,
    rollRate: 15, gearDown: { nzMax: 2.0, alphaMax: 15, rollRate: 12, pitchRateMax: 6 },
    betaGain: 3, rollBandwidth: 4.0, rollGainMax: 6, yawBandwidth: 3.0, yawGainMax: 6, ari: 0.3, bankNeutral: 60, pitchBandwidth: 5,
  },
  autopilot: { bankMax: 25, vsMax: 10, turnRate: 3 },
  targets: {
    stallSpeedLanding: [55, 0.07],            // m/s CAS, 40 deg flaps (EBF), 200 t: CLmax ~3.0
    stallSpeedClean: [76, 0.07],              // 200 t, CLmax 1.55
    takeoffRoll: [1300, 0.25],                // m, 16 deg flaps, 200 t (data sheet ~1 100 m is a rough figure; installed thrust loss + 5 s spool-up here)
    landingRoll: [700, 0.3],                  // m touchdown to stop, STOL, reversers + brakes (~900 m incl. flare, data sheet)
    climbRate: [26, 0.2],                    // m/s at sea level, 250 kt, 200 t (T/W 0.30 installed; the quoted 2 400 ft/min is a reduced-power MTOW figure)
    climbSpeed: 128,
    maxSpeedSL: [180, 0.03], maxSpeedSLisCas: true,   // VMO 350 KCAS must be reachable
    maxSpeedAlt: [0.81, 0.04], maxSpeedAltitude: 10668,
    ceiling: 11900, ceilingMach: 0.72,
    rollRate: [14, 0.3], rollSpeed: 75,
    sustainedTurn: [0, 0], instantTurn: [0, 0],
    maxG: [2.5, 0.2], maxGSpeed: 130,
    glideRatio: [15.5, 0.12], glideSpeed: 105,
    cruise: { altitude: 10668, mach: 0.76, fuelFlow: [7800, 0.15] },   // kg/h total
    approachAoA: [5, 0.25],
  },
};
