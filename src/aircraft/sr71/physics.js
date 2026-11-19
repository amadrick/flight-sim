// Lockheed SR-71A Blackbird (2 × P&W J58 / JT11D-20) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./specs.js and ./geometry.js.
// Sources: docs/aircraft/sr71.md; SR-71A flight manual (T.O. 1SR-71A-1) speeds/limits as published in the open
// literature (450 KEAS, M3.2 normal / M3.3 max, CIT 427 °C, 175 KEAS approach, 155 kt touchdown, drag chute);
// NASA YF-12 research reports (TM X-3288 / TN D-7832 class) for derivative magnitudes and supersonic L/D;
// Polhamus vortex-lift estimates for the chined slender delta; MIL-E-5008B inlet recovery for the thrust table.
// Tuned with `node tools/flight-test.mjs sr71`.
//
// TEST MASS. The flight-test bench flies every test at one mass (empty + payload + fuel below = 52 t). The SR-71
// took off with a partial load (~20 t of JP-7, then tanked to ~77 t) and landed at ~38–42 t, so 52 t sits between the
// take-off and the landing references; every target below is the published figure scaled to 52 t where it depends
// on weight (said so in the comment).
export default {
  schema: 1,
  mass: {
    payload: 1800,                       // 2 crew in pressure suits, sensors (OBC / TEOC / SLR), drag chute, LN2 / TEB
    fuel: 19600,                         // kg JP-7 at start -> 52 t (see TEST MASS above)
    // radius-of-gyration estimate (docs/aircraft/sr71.md §9) scaled to the test mass; the long fuel-filled fuselage
    // makes pitch and yaw inertia ~10× the roll inertia
    inertia: { ixx: 255000, iyy: 2600000, izz: 2900000, ixz: 25000, atMass: 62000 },
  },
  aero: {
    // reference: 1,800 ft² incl. chines, span 55.6 ft; MAC of the chined planform ~ 11 m
    ref: { area: 167, span: 16.94, chord: 11.0 },
    // cla: slender-wing theory π·AR/2 ≈ 2.7 plus the chine / leading-edge vortex lift (Polhamus) linearised over the
    // 0–12° range used in flight -> ~2.9 per rad; cl0 from the conical camber of the outer leading edge.
    // clMax 0.85: the usable maximum (pitch-up boundary ~ 16–18° AoA) behind the published ~70 m/s stall at 42 t.
    // A slender delta has no sharp break — soft sharpness, lift is still carried far past the peak.
    lift: { cl0: 0.03, cla: 2.9, clMax: 0.85, sharpness: 12, clMaxNeg: 0.6, postStallCl: 1.0, cd90: 1.25 },
    mach: {
      //       subsonic ---------------------  transonic drag rise ---------  supersonic decay to the M3.2 design point -----------------
      m:     [0,      0.6,    0.8,    0.9,    0.95,   1.0,    1.05,   1.1,    1.2,    1.4,    1.7,    2.0,    2.5,    3.0,    3.2,    3.3,    3.5],
      cla:   [1.00,   1.03,   1.06,   1.09,   1.11,   1.12,   1.11,   1.09,   1.04,   0.94,   0.82,   0.73,   0.60,   0.51,   0.48,   0.47,   0.44],
      clMax: [1.00,   0.98,   0.95,   0.92,   0.90,   0.88,   0.86,   0.84,   0.80,   0.74,   0.67,   0.62,   0.55,   0.50,   0.48,   0.47,   0.45],
      cd0:   [0.0115, 0.0115, 0.0118, 0.0135, 0.0175, 0.0255, 0.0295, 0.0305, 0.0300, 0.0280, 0.0245, 0.0212, 0.0170, 0.0130, 0.0120, 0.0117, 0.0112],
      k:     [0.28,   0.28,   0.28,   0.29,   0.30,   0.31,   0.33,   0.35,   0.38,   0.42,   0.47,   0.51,   0.56,   0.60,   0.62,   0.63,   0.66],
      // aerodynamic centre moves aft supersonically by ~0.10 c; fuel transfer moves the CG aft by ~0.03 c (§2) -> net
      xac:   [0,      0,      0.005,  0.01,   0.02,   0.035,  0.05,   0.06,   0.07,   0.075,  0.075,  0.075,  0.075,  0.075,  0.075,  0.075,  0.075],
      ctrl:  [1,      1,      0.98,   0.96,   0.94,   0.90,   0.87,   0.85,   0.82,   0.77,   0.71,   0.67,   0.61,   0.56,   0.54,   0.53,   0.51],
    },
    drag: {
      clMinDrag: 0.02, gear: 0.018, beta: 1.0, elevator: 0.08,
      // DRAG CHUTE. There is no speedbrake and no spoiler; the 40-ft ribbon chute is streamed after touchdown. The
      // engine has no chute model, so the chute is the "ground spoiler" channel (controls.spoilers below: no flight
      // or roll function, no lift dump): CD·S ≈ 50 m² -> ΔCD 0.30 on 167 m², ~0.5 g at 150 kt.
      spoiler: 0.30,
    },
    // relaxed but positive subsonic margin; cmq includes the pitch SAS (the conventional law has no pitch damper)
    pitch: { cm0: 0.0, staticMargin: 0.025, cmq: -3.2, cmde: 0.36, clde: 0.45, cmPostStall: -0.25, cmGear: -0.004 },
    side: { cyb: -0.55, cydr: 0.12 },
    // clp includes the roll damper; clda: elevons only (no ailerons), modest roll power on the thin (3 % t/c) wing
    roll: { clb: -0.06, clbCl: -0.10, clp: -0.30, clr: 0.03, clrCl: 0.12, clda: 0.032, cldr: 0.008 },
    // twin all-moving canted fins; directional stability fades supersonically (cnbMach) — the yaw SAS is essential
    yaw: { cnb: 0.12, cnbMach: 0.45, cnp: -0.01, cnpCl: -0.05, cnr: -0.22, cnda: 0.002, cndaCl: 0.008, cndr: 0.075, alphaDir: [18, 32], cnbPostStall: -0.02 },
    stall: { wingDrop: 0.004, clpPost: 0.01, buffetMargin: 5, warnMargin: 3, aileronLoss: 0.4 },
    // no flaps, no slats: single clean "detent"
    flaps: { detents: [{ name: 'UP', deg: 0, pos: 0 }], takeoff: 0, landing: 0 },
  },
  controls: {
    elevator: { max: 20, rate: 30, tau: 0.08 },        // elevons ±20° (pitch share), hydraulic, SAS-driven
    aileron: { max: 15, rate: 30, tau: 0.08 },         // elevon differential
    rudder: { max: 20, rate: 30, tau: 0.08, qBlowdown: 30000 },   // all-moving fins ±20°
    trim: { max: 20, rate: 0.03, authority: 1 },       // pitch trim through the elevons (Mach trim)
    // drag chute (see aero.drag.spoiler): deploys on the ground with the throttles at idle, jettisoned when stopped
    spoilers: { flightMax: 0, rollGain: 0, rollMax: 0, time: 2.0, ground: true, autoGround: true },
  },
  engines: {
    type: 'turbojet-ab', inlet: 'ramp', maxMach: 3.3,
    // Net installed thrust, factor of sea-level static (mil: of 111 kN, ab: of 144.6 kN). Generated from the
    // afterburning-turbojet lapse 1 − 0.3(θ0 − 1) − 0.1√M on the ram pressure ratio with mixed-compression inlet
    // recovery 1 − 0.075 (M − 1)^1.35, a 1.45 burner-pressure (q) cap at low altitude, and a fuel trim-back above
    // M3.3 (compressor-inlet temperature limit 427 °C) — so thrust per unit pressure rises ~16× from static to M3.2
    // (the "turbo-ramjet" bypass), and the dry share falls from 77 % to ~30 % at cruise (cruise is in AB).
    thrustTable: {
      mach: [0, 0.3, 0.6, 0.8, 0.9, 1, 1.1, 1.2, 1.4, 1.7, 2, 2.3, 2.6, 2.9, 3.1, 3.2, 3.3, 3.35, 3.4, 3.5],
      alt: [0, 3000, 6000, 9000, 11000, 14000, 17000, 20000, 23000, 26000, 29000],
      mil: [
        [1.000, 0.9713, 1.082, 1.166, 1.133, 1.079, 1.025, 0.9720, 0.8660, 0.7177, 0.5775, 0.4473, 0.3306, 0.2223, 0.1560, 0.1249, 0.0955, 0.0570, 0.0270, 0.0000],   // 0 m
        [0.7064, 0.6870, 0.7668, 0.8703, 0.9394, 1.003, 1.057, 1.004, 0.8980, 0.7507, 0.6116, 0.4825, 0.3670, 0.2595, 0.1935, 0.1623, 0.1329, 0.0831, 0.0419, 0.0000],   // 3000 m
        [0.4851, 0.4725, 0.5285, 0.6010, 0.6495, 0.6944, 0.7442, 0.7999, 0.9300, 0.7837, 0.6457, 0.5176, 0.4034, 0.2967, 0.2308, 0.1997, 0.1702, 0.1092, 0.0568, 0.0000],   // 6000 m
        [0.3226, 0.3147, 0.3527, 0.4018, 0.4347, 0.4654, 0.4995, 0.5377, 0.6278, 0.8058, 0.6798, 0.5527, 0.4397, 0.3338, 0.2682, 0.2370, 0.2075, 0.1352, 0.0717, 0.0000],   // 9000 m
        [0.2408, 0.2351, 0.2638, 0.3009, 0.3258, 0.3491, 0.3750, 0.4041, 0.4729, 0.6099, 0.7024, 0.5761, 0.4639, 0.3586, 0.2930, 0.2619, 0.2323, 0.1526, 0.0816, 0.0000],   // 11000 m
        [0.1503, 0.1468, 0.1647, 0.1879, 0.2034, 0.2179, 0.2341, 0.2523, 0.2953, 0.3808, 0.4905, 0.5764, 0.4642, 0.3588, 0.2933, 0.2621, 0.2326, 0.1528, 0.0817, 0.0000],   // 14000 m
        [0.0939, 0.0917, 0.1029, 0.1173, 0.1270, 0.1361, 0.1462, 0.1576, 0.1844, 0.2378, 0.3063, 0.3877, 0.4642, 0.3588, 0.2933, 0.2621, 0.2326, 0.1528, 0.0817, 0.0000],   // 17000 m
        [0.0587, 0.0573, 0.0643, 0.0733, 0.0794, 0.0850, 0.0914, 0.0984, 0.1152, 0.1486, 0.1914, 0.2422, 0.2993, 0.3505, 0.2933, 0.2621, 0.2326, 0.1528, 0.0817, 0.0000],   // 20000 m
        [0.0367, 0.0358, 0.0402, 0.0458, 0.0496, 0.0531, 0.0570, 0.0615, 0.0719, 0.0926, 0.1191, 0.1505, 0.1854, 0.2164, 0.2304, 0.2342, 0.2270, 0.1489, 0.0795, 0.0000],   // 23000 m
        [0.0231, 0.0225, 0.0253, 0.0288, 0.0312, 0.0334, 0.0359, 0.0386, 0.0451, 0.0581, 0.0746, 0.0941, 0.1156, 0.1344, 0.1425, 0.1445, 0.1451, 0.1012, 0.0574, 0.0000],   // 26000 m
        [0.0146, 0.0143, 0.0160, 0.0182, 0.0197, 0.0211, 0.0227, 0.0244, 0.0285, 0.0367, 0.0471, 0.0592, 0.0726, 0.0840, 0.0887, 0.0897, 0.0898, 0.0625, 0.0354, 0.0000],   // 29000 m
      ],
      ab: [
        [1.000, 1.000, 1.149, 1.265, 1.242, 1.218, 1.193, 1.166, 1.108, 1.010, 0.8969, 0.7699, 0.6281, 0.4714, 0.3586, 0.2997, 0.2392, 0.1458, 0.0708, 0.0000],   // 0 m
        [0.7061, 0.7075, 0.8145, 0.9442, 1.030, 1.132, 1.229, 1.204, 1.149, 1.056, 0.9499, 0.8304, 0.6973, 0.5503, 0.4446, 0.3894, 0.3327, 0.2126, 0.1097, 0.0000],   // 3000 m
        [0.4849, 0.4867, 0.5614, 0.6520, 0.7122, 0.7839, 0.8656, 0.9594, 1.190, 1.102, 1.003, 0.8909, 0.7664, 0.6292, 0.5305, 0.4790, 0.4261, 0.2794, 0.1487, 0.0000],   // 6000 m
        [0.3225, 0.3241, 0.3746, 0.4359, 0.4767, 0.5253, 0.5809, 0.6449, 0.8031, 1.134, 1.056, 0.9514, 0.8355, 0.7079, 0.6163, 0.5685, 0.5194, 0.3461, 0.1876, 0.0000],   // 9000 m
        [0.2407, 0.2422, 0.2802, 0.3265, 0.3573, 0.3940, 0.4361, 0.4846, 0.6050, 0.8579, 1.091, 0.9916, 0.8815, 0.7604, 0.6735, 0.6282, 0.5816, 0.3905, 0.2135, 0.0000],   // 11000 m
        [0.1503, 0.1512, 0.1749, 0.2038, 0.2231, 0.2460, 0.2723, 0.3026, 0.3778, 0.5357, 0.7617, 0.9920, 0.8819, 0.7609, 0.6740, 0.6287, 0.5822, 0.3909, 0.2138, 0.0000],   // 14000 m
        [0.0938, 0.0944, 0.1093, 0.1273, 0.1393, 0.1536, 0.1701, 0.1890, 0.2359, 0.3345, 0.4757, 0.6673, 0.8819, 0.7609, 0.6740, 0.6287, 0.5822, 0.3909, 0.2138, 0.0000],   // 17000 m
        [0.0586, 0.0590, 0.0683, 0.0795, 0.0870, 0.0960, 0.1063, 0.1181, 0.1474, 0.2090, 0.2972, 0.4169, 0.5686, 0.7433, 0.6740, 0.6287, 0.5822, 0.3909, 0.2138, 0.0000],   // 20000 m
        [0.0367, 0.0369, 0.0427, 0.0497, 0.0544, 0.0600, 0.0663, 0.0737, 0.0920, 0.1303, 0.1850, 0.2590, 0.3523, 0.4588, 0.5295, 0.5617, 0.5682, 0.3809, 0.2079, 0.0000],   // 23000 m
        [0.0231, 0.0232, 0.0268, 0.0312, 0.0342, 0.0377, 0.0417, 0.0463, 0.0578, 0.0817, 0.1159, 0.1620, 0.2197, 0.2850, 0.3276, 0.3467, 0.3631, 0.2590, 0.1503, 0.0000],   // 26000 m
        [0.0146, 0.0147, 0.0170, 0.0198, 0.0216, 0.0239, 0.0264, 0.0293, 0.0365, 0.0516, 0.0731, 0.1019, 0.1379, 0.1781, 0.2039, 0.2153, 0.2248, 0.1600, 0.0927, 0.0000],   // 29000 m
      ],
    },
    n1Idle: 0.40, n2Idle: 0.62, spoolUp: 5.5, spoolDown: 4.0, idleThrust: 0.025, idleFuelFlow: 0.28,
    // TSFC (lb/lbf/h) × √θ: J58 dry ~0.9 static; AB ~1.9 static rising to ~2.0 effective at M3.2 / 24 km
    tsfc: [0.90, 0.30], tsfcAb: [1.85, 0.12], egt: [420, 790, 860],
    abMinFraction: 0.25, abLightTime: 2.0, startTime: 25,   // TEB chemical ignition: slow light-off
  },
  gear: {
    nose: { travel: 0.30 }, main: { travel: 0.38 },
    retractTime: 8, steerMax: 40, steerLatG: 0.25,
    brakeMu: 0.38,                                   // small high-pressure tyres, brakes limited at high speed
    maxSinkRate: 3.05, crashSinkRate: 6,            // 10 ft/s design touchdown sink (not a carrier gear)
  },
  structure: { tailStrikeDeg: 12.5, bellyY: -1.0 },
  canopy: true,
  limits: {
    gMax: 3.0, gMin: -1.0, ultimateFactor: 1.5,
    vmo: 231.5,                                       // 450 KEAS (= KCAS at low altitude); the engine's VMO is CAS
    overspeedFactor: 1.3,                             // the 450-KEAS climb schedule reads ~545 KCAS at M2.5
    mmo: 3.3,                                         // M3.2 normal, M3.3 with CIT ≤ 427 °C
    gearSpeed: 154,                                   // 300 KEAS gear limit
  },
  fcs: {
    type: 'conventional',
    // irreversible hydraulic elevons with artificial feel; pitch / roll / yaw SAS (dampers in cmq / clp, yaw SAS
    // here at high authority); trim follow-up stands in for the Mach-trim / autopilot pitch trim
    feelQ: 9000, feelMin: 0.12, rollFeelQ: 12000, trimFollowUp: 0.3,
    yawDamper: 1, sasAuthority: 0.5, betaGain: 3, ari: 0.10, yawBandwidth: 2.5,
    rotationRate: 4, rotationPitchMax: 10,
  },
  autopilot: { bankMax: 25, vsMax: 25, turnRate: 3, rollRateMax: 10, accelMax: 0.25 },
  targets: {
    stallSpeedClean: [78, 0.10],              // m/s CAS: ~70 m/s published at 42 t, scaled to 52 t (CLmax 0.85)
    stallSpeedLanding: [78, 0.10],            // no flaps: gear down only
    takeoffRoll: [1250, 0.30],                // m, max AB; ~1,500 m at 63 t published, ∝ W² -> ~1,050–1,250 m at 52 t
    rotateSpeed: 100, rotatePitch: 10, climbPitch: 12,   // 195 kt rotation to 10° pitch, lift-off ~205–210 kt
    landingRoll: [1100, 0.35],                // m, chute + brakes (~1,100 m published at ~40 t)
    climbRate: [60, 0.30], climbSpeed: 130,   // 12,000 ft/min initial climb (≈ 250 kt climb-out, gear up)
    maxSpeedSL: [231.5, 0.03], maxSpeedSLisCas: true,   // 450 KEAS is reachable at low level (thrust allows more)
    maxSpeedAlt: [3.3, 0.03], maxSpeedAltitude: 24400,  // M3.3 limit at 80,000 ft (thrust trimmed back by CIT)
    ceiling: 25900, ceilingMach: 3.2,         // 85,000 ft at M3.2 at 52 t
    rollRate: [40, 0.30], rollSpeed: 160,     // deg/s, subsonic, ~310 KCAS
    maxG: [3, 0.2], maxGSpeed: 180,
    glideRatio: [9.0, 0.15], glideSpeed: 155, // subsonic L/D ~9 (estimate)
    cruise: { altitude: 24400, mach: 3.2, fuelFlow: [17000, 0.20] },   // kg/h total, ~37,500 lb/h (TSFC ~1.9)
    approachAoA: [11, 0.25],                  // deg; ~10° at 175 KEAS / 42 t
  },
};
