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
    fuel: 13600,                         // kg JP-7 at start -> 52 t (see TEST MASS above)
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
    lift: { cl0: 0.03, cla: 3.1, clMax: 0.86, sharpness: 16, clMaxNeg: 0.6, postStallCl: 1.0, cd90: 1.25 },
    mach: {
      //       subsonic ---------------------  transonic drag rise ---------  supersonic decay to the M3.2 design point -----------------
      m:     [0,      0.6,    0.8,    0.9,    0.95,   1.0,    1.05,   1.1,    1.2,    1.4,    1.7,    2.0,    2.5,    3.0,    3.2,    3.3,    3.5],
      cla:   [1.00,   1.03,   1.06,   1.09,   1.10,   1.10,   1.08,   1.05,   0.99,   0.88,   0.77,   0.68,   0.56,   0.48,   0.45,   0.44,   0.41],
      clMax: [1.00,   0.98,   0.95,   0.92,   0.90,   0.88,   0.86,   0.84,   0.80,   0.74,   0.67,   0.62,   0.55,   0.50,   0.48,   0.47,   0.45],
      cd0:   [0.0115, 0.0115, 0.0118, 0.0135, 0.0175, 0.0255, 0.0295, 0.0305, 0.0300, 0.0280, 0.0245, 0.0212, 0.0172, 0.0140, 0.0132, 0.0129, 0.0124],
      k:     [0.28,   0.28,   0.28,   0.29,   0.30,   0.31,   0.33,   0.35,   0.38,   0.42,   0.47,   0.52,   0.58,   0.63,   0.66,   0.67,   0.70],
      // ctrl: trailing-edge elevon / fin effectiveness falls with linear supersonic theory (∝ 1/√(M²−1)) faster than
      // the wing lift slope -> ~0.2 of the subsonic value at M3.2 (roll ~25–30 °/s, ~2 g with full column at cruise)
      // aerodynamic centre moves aft supersonically by ~0.10 c; fuel transfer moves the CG aft by ~0.03 c (§2) -> net
      xac:   [0,      0,      0.005,  0.01,   0.02,   0.035,  0.05,   0.06,   0.07,   0.075,  0.075,  0.075,  0.075,  0.075,  0.075,  0.075,  0.075],
      ctrl:  [1,      1,      0.98,   0.96,   0.93,   0.88,   0.84,   0.80,   0.72,   0.60,   0.48,   0.40,   0.31,   0.25,   0.22,   0.21,   0.20],
    },
    drag: {
      clMinDrag: 0.01, gear: 0.018, beta: 1.0, elevator: 0.08,
      // DRAG CHUTE. There is no speedbrake and no spoiler; the 40-ft ribbon chute is streamed after touchdown. The
      // engine has no chute model, so the chute is the "ground spoiler" channel (controls.spoilers below: no flight
      // or roll function, no lift dump): CD·S ≈ 50 m² -> ΔCD 0.30 on 167 m², ~0.5 g at 150 kt.
      spoiler: 0.30,
    },
    // relaxed but positive subsonic margin; cmq includes the pitch SAS (the conventional law has no pitch damper)
    pitch: { cm0: 0.02, staticMargin: 0.04, cmq: -3.2, cmde: 0.40, clde: 0.55, cmPostStall: -0.25, cmGear: -0.004 },
    side: { cyb: -0.55, cydr: 0.12 },
    // clp includes the roll damper; clda: elevons only (no ailerons), modest roll power on the thin (3 % t/c) wing
    roll: { clb: -0.06, clbCl: -0.10, clp: -0.30, clr: 0.03, clrCl: 0.12, clda: 0.046, cldr: 0.008 },
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
    // afterburning-turbojet lapse 1 − 0.34(θ0 − 1) − 0.1√M on the ram pressure ratio with mixed-compression inlet
    // recovery 1 − 0.075 (M − 1)^1.35, a 1.45 burner-pressure (q) cap at low altitude, and a fuel trim-back above
    // M3.3 (compressor-inlet temperature limit 427 °C), and a low-Reynolds-number loss (δ/δ20km)^0.2 above 20 km — so thrust per unit pressure rises ~16× from static to M3.2
    // (the "turbo-ramjet" bypass), and the dry share falls from 77 % to ~30 % at cruise (cruise is in AB).
    thrustTable: {
      mach: [0, 0.3, 0.6, 0.8, 0.9, 1, 1.1, 1.2, 1.4, 1.7, 2, 2.3, 2.6, 2.9, 3.1, 3.2, 3.3, 3.35, 3.4, 3.5],
      alt: [0, 3000, 6000, 9000, 11000, 14000, 17000, 20000, 23000, 26000, 29000],
      mil: [
        [1.000, 0.9706, 1.078, 1.159, 1.124, 1.069, 1.013, 0.9581, 0.8482, 0.6938, 0.5477, 0.4116, 0.2893, 0.1763, 0.1075, 0.0754, 0.0451, 0.0183, 0.0033, 0.0000],   // 0 m
        [0.7083, 0.6884, 0.7668, 0.8683, 0.9358, 0.9975, 1.049, 0.9939, 0.8845, 0.7312, 0.5863, 0.4515, 0.3306, 0.2185, 0.1499, 0.1178, 0.0874, 0.0437, 0.0117, 0.0000],   // 3000 m
        [0.4877, 0.4748, 0.5301, 0.6016, 0.6493, 0.6932, 0.7417, 0.7956, 0.9207, 0.7686, 0.6249, 0.4914, 0.3718, 0.2606, 0.1923, 0.1601, 0.1297, 0.0690, 0.0201, 0.0000],   // 6000 m
        [0.3251, 0.3171, 0.3548, 0.4035, 0.4361, 0.4662, 0.4997, 0.5370, 0.6245, 0.7953, 0.6635, 0.5312, 0.4130, 0.3027, 0.2346, 0.2024, 0.1720, 0.0943, 0.0286, 0.0000],   // 9000 m
        [0.2430, 0.2373, 0.2659, 0.3028, 0.3275, 0.3505, 0.3760, 0.4046, 0.4719, 0.6043, 0.6892, 0.5577, 0.4404, 0.3308, 0.2628, 0.2306, 0.2001, 0.1112, 0.0342, 0.0000],   // 11000 m
        [0.1517, 0.1481, 0.1660, 0.1891, 0.2045, 0.2188, 0.2348, 0.2526, 0.2946, 0.3773, 0.4813, 0.5579, 0.4407, 0.3310, 0.2631, 0.2309, 0.2004, 0.1114, 0.0342, 0.0000],   // 14000 m
        [0.0948, 0.0925, 0.1037, 0.1181, 0.1277, 0.1367, 0.1466, 0.1578, 0.1840, 0.2356, 0.3006, 0.3753, 0.4407, 0.3310, 0.2631, 0.2309, 0.2004, 0.1114, 0.0342, 0.0000],   // 17000 m
        [0.0592, 0.0578, 0.0648, 0.0738, 0.0798, 0.0854, 0.0916, 0.0986, 0.1150, 0.1472, 0.1878, 0.2345, 0.2841, 0.3234, 0.2631, 0.2309, 0.2004, 0.1114, 0.0342, 0.0000],   // 20000 m
        [0.0338, 0.0330, 0.0369, 0.0421, 0.0455, 0.0487, 0.0522, 0.0561, 0.0654, 0.0837, 0.1066, 0.1328, 0.1603, 0.1815, 0.1877, 0.1871, 0.1771, 0.0982, 0.0301, 0.0000],   // 23000 m
        [0.0194, 0.0189, 0.0212, 0.0241, 0.0261, 0.0279, 0.0299, 0.0322, 0.0375, 0.0479, 0.0608, 0.0756, 0.0910, 0.1024, 0.1053, 0.1046, 0.1024, 0.0603, 0.0196, 0.0000],   // 26000 m
        [0.0112, 0.0109, 0.0122, 0.0139, 0.0151, 0.0161, 0.0173, 0.0186, 0.0216, 0.0276, 0.0350, 0.0434, 0.0520, 0.0582, 0.0595, 0.0589, 0.0574, 0.0337, 0.0109, 0.0000],   // 29000 m
      ],
      ab: [
        [1.000, 0.9996, 1.145, 1.257, 1.233, 1.206, 1.179, 1.149, 1.085, 0.9760, 0.8505, 0.7085, 0.5497, 0.3738, 0.2472, 0.1810, 0.1128, 0.0468, 0.0086, 0.0000],   // 0 m
        [0.7080, 0.7090, 0.8145, 0.9420, 1.026, 1.126, 1.220, 1.192, 1.132, 1.029, 0.9106, 0.7771, 0.6281, 0.4633, 0.3446, 0.2826, 0.2188, 0.1118, 0.0307, 0.0000],   // 3000 m
        [0.4874, 0.4890, 0.5631, 0.6527, 0.7121, 0.7826, 0.8627, 0.9543, 1.178, 1.081, 0.9705, 0.8457, 0.7064, 0.5526, 0.4419, 0.3841, 0.3247, 0.1766, 0.0527, 0.0000],   // 6000 m
        [0.3249, 0.3266, 0.3769, 0.4378, 0.4782, 0.5263, 0.5812, 0.6441, 0.7990, 1.119, 1.030, 0.9142, 0.7847, 0.6419, 0.5392, 0.4856, 0.4305, 0.2414, 0.0748, 0.0000],   // 9000 m
        [0.2429, 0.2444, 0.2824, 0.3285, 0.3592, 0.3957, 0.4374, 0.4853, 0.6037, 0.8500, 1.070, 0.9598, 0.8369, 0.7014, 0.6040, 0.5532, 0.5009, 0.2846, 0.0895, 0.0000],   // 11000 m
        [0.1516, 0.1526, 0.1763, 0.2051, 0.2243, 0.2471, 0.2731, 0.3030, 0.3769, 0.5307, 0.7474, 0.9603, 0.8374, 0.7019, 0.6046, 0.5538, 0.5016, 0.2850, 0.0896, 0.0000],   // 14000 m
        [0.0947, 0.0953, 0.1101, 0.1281, 0.1400, 0.1543, 0.1705, 0.1892, 0.2354, 0.3315, 0.4668, 0.6460, 0.8374, 0.7019, 0.6046, 0.5538, 0.5016, 0.2850, 0.0896, 0.0000],   // 17000 m
        [0.0592, 0.0595, 0.0688, 0.0800, 0.0875, 0.0964, 0.1066, 0.1182, 0.1471, 0.2071, 0.2917, 0.4036, 0.5399, 0.6857, 0.6046, 0.5538, 0.5016, 0.2850, 0.0896, 0.0000],   // 20000 m
        [0.0338, 0.0340, 0.0392, 0.0456, 0.0499, 0.0549, 0.0607, 0.0673, 0.0837, 0.1177, 0.1655, 0.2285, 0.3046, 0.3850, 0.4313, 0.4488, 0.4434, 0.2513, 0.0788, 0.0000],   // 23000 m
        [0.0194, 0.0195, 0.0225, 0.0262, 0.0286, 0.0315, 0.0348, 0.0386, 0.0479, 0.0673, 0.0945, 0.1301, 0.1729, 0.2172, 0.2420, 0.2509, 0.2562, 0.1543, 0.0514, 0.0000],   // 26000 m
        [0.0112, 0.0113, 0.0130, 0.0151, 0.0165, 0.0182, 0.0201, 0.0223, 0.0276, 0.0388, 0.0543, 0.0747, 0.0988, 0.1235, 0.1368, 0.1413, 0.1436, 0.0862, 0.0286, 0.0000],   // 29000 m
      ],
    },
    n1Idle: 0.40, n2Idle: 0.62, spoolUp: 5.5, spoolDown: 4.0, idleThrust: 0.025, idleFuelFlow: 0.28,
    // TSFC (lb/lbf/h) × √θ: J58 dry ~0.9 static; AB ~1.9 static rising to ~2.0 effective at M3.2 / 24 km
    tsfc: [0.90, 0.30], tsfcAb: [1.85, 0.12], egt: [420, 790, 860],
    abMinFraction: 0.10, abLightTime: 2.0, startTime: 25,   // TEB chemical ignition: slow light-off
  },
  gear: {
    nose: { travel: 0.30 }, main: { travel: 0.38 },
    retractTime: 8, steerMax: 40, steerLatG: 0.25,
    brakeMu: 0.33,                                   // small high-pressure tyres, brakes limited at high speed
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
    feelQ: 5000, feelMin: 0.12, rollFeelQ: 12000, trimFollowUp: 0.2,
    yawDamper: 1, sasAuthority: 0.8, betaGain: 3, ari: 0.10, yawBandwidth: 2.5,
    pitchBandwidth: 3.5, pitchIntegral: 1.5, pitchGainMax: 4,    // autopilot pitch servo (heavy-aircraft values: Iyy ~ 2.6e6 kg·m²)
    rotationRate: 4, rotationPitchMax: 11,
  },
  autopilot: { bankMax: 25, vsMax: 25, turnRate: 3, rollRateMax: 8, bankGain: 1.0, accelMax: 0.2, altGain: 0.05, vsGain: 0.3 },
  targets: {
    stallSpeedClean: [73, 0.10],              // m/s CAS: ~70 m/s published at 42 t, scaled to 46 t
    stallSpeedLanding: [73, 0.10],            // no flaps: gear down only
    takeoffRoll: [1100, 0.30],                // m, max AB; ~1,500 m at ~63 t, rotating at a fixed 100 m/s -> ∝ W -> ~1,100 m at 46 t
    rotateSpeed: 100, rotatePitch: 10, climbPitch: 12,   // 195 kt rotation to 10° pitch, lift-off ~205–210 kt
    landingRoll: [1100, 0.35],                // m, chute + brakes (~1,100 m published at ~40 t)
    climbRate: [60, 0.30], climbSpeed: 130,   // 12,000 ft/min initial climb (≈ 250 kt climb-out, gear up)
    maxSpeedSL: [231.5, 0.03], maxSpeedSLisCas: true,   // 450 KEAS is reachable at low level (thrust allows more)
    maxSpeedAlt: [3.3, 0.03], maxSpeedAltitude: 24400,  // M3.3 limit at 80,000 ft (thrust trimmed back by CIT)
    ceiling: 25900, ceilingMach: 3.2,         // 85,000 ft at M3.2 at 52 t
    rollRate: [40, 0.30], rollSpeed: 160,     // deg/s, subsonic, ~310 KCAS
    maxG: [3, 0.2], maxGSpeed: 180,
    glideRatio: [9.0, 0.15], glideSpeed: 155, // subsonic L/D ~9 (estimate)
    cruise: { altitude: 24400, mach: 3.2, fuelFlow: [14400, 0.20] },   // kg/h total; ~38,000 lb/h at ~55 t mid-cruise weight (TSFC ~1.9), ∝ drag -> 46 t
    approachAoA: [11, 0.25],                  // deg; ~10° at 175 KEAS / 42 t
  },
};
