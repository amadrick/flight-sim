// Grumman F-14D Tomcat (2 × F110-GE-400) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./specs.js and ./geometry.js.
// Sources: docs/aircraft/f14.md (reference data sheet); publicly quoted NATOPS-style figures for the F-14 (speeds,
// on-speed AoA, limits, sweep programme); Roskam / Raymer class-II methods for derivative magnitudes; F110-GE-400
// public data (thrust, SFC). Values that are engineering estimates are marked "est." below.
// Tuned with `node tools/flight-test.mjs f14` (follow the SCHEMA.md tuning order).
//
// Special features
//  - Variable-sweep wing 20°..68° on the CADC Mach programme (`aero.sweep.auto`, state.surfaces.wingSweep 0..1);
//    lift slope, CLmax, zero-lift / wave drag, induced drag, aerodynamic centre, damping and span change with sweep.
//  - Conventional hydro-mechanical controls (`fcs.type: 'conventional'`): q-feel bellows on the stick, stabilizer trim,
//    yaw damper + aileron-rudder interconnect (the F-14 SAS / ARI). No G or AoA limiter: the aircraft can be over-G'd
//    and, held at full aft stick at low speed, departs with wing rock and yaw (stable spin is not modelled); it
//    recovers promptly when the stick is released.
//  - Roll: differential stabilators + spoilers (4 per wing, with a stick deadband as on the real aircraft); the
//    spoilers double as ground-roll spoilers after touchdown and as the speedbrake (see note at controls.spoilers).
//  - Carrier aircraft: arrestor hook, catapult, long-stroke gear rated for ~7 m/s (23 ft/s) sink.
export default {
  schema: 1,
  mass: {
    payload: 1500,                       // 2 crew, 676 rds of 20 mm, 2 × AIM-9 + 2 × AIM-7 + pylons/launchers
    fuel: 5162,                          // kg internal fuel at start -> 26 500 kg typical mass (data sheet)
    // est. inertias, wings forward (order of the F-14A values used in NASA high-AoA / departure studies:
    // Ixx ~ 75 000, Iyy ~ 240 000, Izz ~ 305 000 slug·ft²); the data-sheet gyration estimate is ~2× too high in roll
    inertia: { ixx: 101700, iyy: 325400, izz: 413500, ixz: 2700, atMass: 24000 },
  },
  aero: {
    ref: { span: 19.55, chord: 2.99 },   // reference: 565 ft² (incl. glove), 64.1 ft span at 20°, MAC 9.8 ft
    // cla: AR 7.3 at 20° sweep plus the lifting "pancake" body. clMax 1.70 = clean 1 g stall ~131 kt at 26.5 t with the
    // manoeuvre slats out. spoiler: fraction of lift dumped by fully raised spoilers (inboard panels only).
    lift: { cl0: 0.06, cla: 4.3, clMax: 1.70, sharpness: 12, clMaxNeg: 1.0, postStallCl: 1.15, cd90: 1.35, spoiler: 0.2 },
    // Mach columns describe the 20°-sweep wing; `sweep.effects` scale them toward the 68° wing. The auto programme
    // sweeps the wing aft from M 0.7, so above M 1 the effective values are table × sweep multipliers:
    // effective CD0 ~0.023 subsonic, ~0.054 at M 1.2, ~0.046 at M 2.2; L/Dmax ~12 wings forward.
    mach: {
      m:     [0,      0.4,    0.6,    0.7,    0.8,    0.9,    0.95,   1.0,    1.1,    1.2,    1.4,    1.6,    1.8,    2.0,    2.2,    2.4],
      cla:   [1.00,   1.04,   1.10,   1.15,   1.22,   1.30,   1.32,   1.30,   1.22,   1.12,   0.98,   0.86,   0.77,   0.70,   0.64,   0.59],
      clMax: [1.00,   1.00,   0.95,   0.90,   0.84,   0.78,   0.76,   0.75,   0.76,   0.76,   0.74,   0.70,   0.66,   0.62,   0.58,   0.55],
      cd0:   [0.0215, 0.0215, 0.0217, 0.0222, 0.0240, 0.0291, 0.0420, 0.0607, 0.0764, 0.0836, 0.0848, 0.0804, 0.0759, 0.0737, 0.0715, 0.0693],
      k:     [0.085,  0.085,  0.086,  0.088,  0.091,  0.096,  0.100,  0.105,  0.108,  0.112,  0.128,  0.145,  0.165,  0.185,  0.205,  0.225],
      xac:   [0,      0,      0,      0,      0,      0.02,   0.05,   0.08,   0.11,   0.12,   0.13,   0.13,   0.13,   0.13,   0.13,   0.13],
      ctrl:  [1,      1,      1,      0.99,   0.97,   0.93,   0.90,   0.86,   0.82,   0.78,   0.72,   0.66,   0.60,   0.55,   0.51,   0.48],
    },
    // Variable sweep: pos 0 = 20°, pos 1 = 68° (sweep = 20° + 48°·pos). Mach programme: 20° to M 0.7, ~30° at M 0.8,
    // ~44° at M 0.9, ~56° at M 1.0, 68° from M 1.4. Full travel ~7 s (~7°/s). wingSweepToggle gives manual positions.
    // effects at 68°: lift slope ×0.62 (AR 7.3 -> 2.6), stall-angle factor ×0.75, wave drag ×0.45, induced drag ×1.9,
    // aerodynamic centre +6 % MAC aft (the glove keeps the shift small), damping ×0.85, span 11.65/19.55.
    sweep: {
      time: 7,
      auto: [[0, 0], [0.7, 0], [0.8, 0.2], [0.9, 0.5], [1.0, 0.75], [1.2, 0.92], [1.4, 1], [3, 1]],
      effects: { cla: 0.62, clMax: 0.75, cd0: 0, wave: 0.45, k: 1.9, xac: 0.06, damp: 0.85, span: 0.596 },
    },
    // k (induced drag) is high for AR 7.3 (e ~0.5): it stands for the loss of leading-edge suction and the pancake body
    // at manoeuvring CL — sustained-turn and cruise fuel flow both need it.
    drag: { clMinDrag: 0.03, gear: 0.025, spoiler: 0.10, beta: 1.2, elevator: 0.08 },
    // Stable airframe (static margin ~9 % MAC wings forward, growing with Mach and sweep). cmde: large all-moving
    // stabilators (~13 m², long arm). cmq includes the pitch-SAS contribution. Strong natural nose-down when stalled.
    pitch: { cm0: 0.0, staticMargin: 0.09, cmq: -15.0, cmde: 1.6, clde: 0.40, cmPostStall: -1.4, cmGear: -0.006, cmSpoiler: 0.01 },
    side: { cyb: -1.0, cydr: 0.18 },
    // roll: no ailerons; cldt = differential stabilator (per rad of diff. deflection), clSpoiler = full one-side spoiler
    roll: { clb: -0.08, clbCl: -0.08, clp: -0.40, clr: 0.04, clrCl: 0.18, clda: 0.0, cldt: 0.050, cldr: 0.010, clSpoiler: 0.070 },
    // twin fins: good directional stability until ~20° AoA, then blanketed by the wide body; directionally unstable
    // beyond ~34° (departure / spin entry with yaw). Spoilers give proverse yaw, the diff. tail mild adverse yaw.
    yaw: { cnb: 0.16, cnp: -0.015, cnpCl: -0.06, cnr: -0.30, cnda: 0.004, cndaCl: 0.008, cndr: 0.075, cnSpoiler: 0.010,
      alphaDir: [20, 34], cnbPostStall: -0.06 },
    stall: { wingDrop: 0.014, clpPost: 0.03, buffetMargin: 8, warnMargin: 3 },
    flaps: {
      // UP; MAN (manoeuvre flaps 10°, slats 7°); FULL (flaps 35°, slats 17°, DLC) — used for field and carrier take-off
      // and landing. clMax FULL 2.30 = landing-configuration stall ~115 kt at 26.5 t (approach ~125-135 kt at ~23.5 t).
      detents: [
        { name: 'UP', deg: 0, pos: 0, slat: 0 },
        { name: 'MAN', deg: 10, pos: 0.29, slat: 0.41, dcl0: 0.15, clMax: 1.85, dcd0: 0.008, dcm0: -0.02 },
        { name: 'FULL', deg: 35, pos: 1, slat: 1, dcl0: 0.68, clMax: 2.30, dcd0: 0.060, dcm0: -0.04, kFactor: 1.08 },
      ],
      time: 5, slatTime: 3, takeoff: 2, landing: 2,
    },
    // CADC manoeuvre slats: scheduled with AoA (7°..14°) below M ~0.85, retracted above M 0.9; full with the gear down
    slat: { dAlphaStall: 6, dcd0: 0.003, auto: { alpha: [7, 14], machFade: [0.8, 0.9], gearDown: 1 } },
  },
  controls: {
    elevator: { max: 33, rate: 40, tau: 0.06 },          // stabilators: 33° TE up (real TE-down travel is smaller; symmetric here)
    aileron: { max: 20, rate: 50, tau: 0.06 },           // lateral channel: drives the diff. stabs and the spoilers
    rudder: { max: 30, rate: 60, tau: 0.06, qBlowdown: 15000 },   // twin rudders ±30°, authority limited at high q
    diffTail: { max: 10 },                                // ±10° differential stabilator for roll
    // Spoilers: roll spoilers with a deadband (they start at ~30 % lateral stick; the diff. tail alone below that),
    // ground-roll spoilers after touchdown. NOTE: the engine routes the speedbrake command to the spoilers whenever
    // spoilers are configured, so the F-14's dorsal speedbrake is represented by 50 % symmetric spoiler (ΔCD ~0.05,
    // small lift dump); state.surfaces.speedbrake still animates for the visual.
    spoilers: { flightMax: 0.5, rollGain: 1.43, rollDeadband: 0.3, rollMax: 0.8, time: 0.4, autoGround: true },
    trim: { max: 10, rate: 0.06, authority: 0.7 },        // stabilizer trim, ±7° effective
    speedbrake: { time: 2 },
  },
  hook: true,
  engines: {
    // F110-GE-400: 73.9 kN dry / 122.8 kN AB (specs). Variable-ramp 2-D inlets. The lapse puts max speed at M 1.2 at
    // sea level (burner-pressure limit + transonic drag) and M ~2.35 at 40 000 ft; maxMach = inlet/T2 limit.
    type: 'turbofan-ab', inlet: 'ramp', throttleRatio: 1.0, milLapse: 2.3, abLapse: 1.7, pressureLimit: 1.9, maxMach: 2.4,
    n1Idle: 0.32, n2Idle: 0.68, spoolUp: 3.8, spoolDown: 2.6, idleThrust: 0.025, idleFuelFlow: 0.15,
    tsfc: [0.72, 0.25], tsfcAb: [2.0, 0.25], egt: [400, 900, 960], abLightTime: 1.2, startTime: 18,
  },
  gear: {
    // long-stroke carrier gear: designed for ~7 m/s (23 ft/s) sink; a 9° unflared descent (~12 m/s) is still a crash
    nose: { travel: 0.35 }, main: { travel: 0.45 },
    retractTime: 6, steerMax: 70, steerLatG: 0.3, brakeMu: 0.45, maxSinkRate: 7.0, crashSinkRate: 9.5,
    catapult: { accel: 30, stroke: 94 },                  // C-13 class: ~3 g, 0 -> ~150 kt over ~94 m
  },
  structure: { tailStrikeDeg: 15, bellyY: -0.9 },
  limits: { vmo: 411.5, mmo: 2.34 },                     // 800 KCAS / M 2.34 (gMax 7.5 / gMin -3 from specs)
  fcs: {
    type: 'conventional',
    // q-feel: full aft stick ~ +7.5 g at and above corner speed (no limiter: it can over-G higher up the envelope),
    // full authority below ~90 m/s. stickShape 0.8: soft centre for keyboard flying. No trim follow-up (a sustained
    // pull must not wind in nose-up trim).
    feelQ: 4800, feelMin: 0.06, rollFeelQ: 20000, trimFollowUp: 0, stickShape: 0.8,
    // SAS: yaw damper + sideslip feedback, aileron-rudder interconnect (strong at low speed, washed out by blowdown)
    yawDamper: 1, sasAuthority: 0.7, betaGain: 2, ari: 0.6,
  },
  autopilot: { bankMax: 25, accelMax: 0.15 },             // AFCS heading mode bank limit; gentle altitude capture
  // flight-test targets (tools/flight-test.mjs): [value, tolerance fraction]
  targets: {
    stallSpeedLanding: [59, 0.08],            // m/s CAS, FULL flaps/slats, gear down, 26.5 t (data sheet ~115 kt)
    stallSpeedClean: [69, 0.10],              // m/s CAS, clean 20°, slats auto (~134 kt)
    takeoffRoll: [460, 0.3],                  // m, max AB, FULL flaps, 26.5 t (data sheet ~500 m)
    rotatePitch: 10, climbPitch: 14,          // NATOPS-style field take-off: rotate to ~10° nose up
    landingRoll: [850, 0.35],                 // m, field landing, max braking + ground spoilers, no chute
    climbRate: [230, 0.25], climbSpeed: 280,  // m/s at sea level, max AB, M 0.82 (45 000 ft/min)
    maxSpeedSL: [1.2, 0.06],                  // Mach at sea level (~800 KCAS placard)
    maxSpeedAlt: [2.34, 0.06], maxSpeedAltitude: 12200,      // M 2.34 at 40 000 ft, wings 68°
    ceiling: 16150, ceilingMach: 1.3,         // 53 000 ft is a supersonic (AB) ceiling: at M 0.92 the 26.5 t jet tops out lower
    // conventional-law roll test is flown in the landing configuration: FULL flaps at approach speed. No published
    // figure (MIL-F-8785C Class IV / cat. C asks 30° in 1.1 s); est. ~65°/s — tolerance as wide as the 737's.
    // Clean (not tested here): ~190°/s at 200 m/s CAS, ~150°/s at M 0.87 (wings ~40°), ~110-140°/s supersonic.
    rollRate: [65, 0.3], rollSpeed: 75,
    sustainedTurn: [14, 0.15], sustainedTurnSpeed: 210, sustainedTurnAltitude: 3000,   // deg/s at 10 000 ft, M 0.73
    instantTurn: [20, 0.15], instantTurnSpeed: 180,           // deg/s, ~350 kt corner at 1500 m (~21°/s quoted)
    maxG: [7.5, 0.1], maxGSpeed: 200,                         // informational for the conventional law
    glideRatio: [12, 0.2], glideSpeed: 120,   // L/Dmax wings forward, est. (no published figure)
    cruise: { altitude: 10000, mach: 0.8, fuelFlow: [2200, 0.3] },   // kg/h total, est. ~2 400 lb/h per engine
    // on-speed AoA is "15 units"; quoted conversions put it at ~10-12° body AoA. The test flies 1.08 × 70 m/s at 26.5 t.
    approachAoA: [10.5, 0.25],
  },
};
