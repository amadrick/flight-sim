// F-22A Raptor (2 × F119-PW-100, 2-D pitch-vectoring nozzles) — flight-dynamics configuration. Schema: src/physics/SCHEMA.md.
// Masses, thrust, wing area, gear geometry and limits not listed here come from ./index.js (specs) and ./geometry.js.
// Sources: USAF F-22A fact sheet (dimensions, thrust class, ceiling "above 50 000 ft", M2 class), Lockheed Martin /
// P&W published figures (supercruise ~M1.5–1.8, F119 35 000 lbf class), docs/aircraft/f22.md (data sheet incl. its
// estimates), F-15 / F-16 published inertias and derivatives scaled to the F-22 planform (Roskam / DATCOM methods for
// the low-aspect-ratio lift slope). Most F-22 performance is classified: numbers marked "est." in `targets` are
// open-source estimates and carry the same tolerances as the F-16 reference unless noted.
// Tuned with `node tools/flight-test.mjs f22`.
export default {
  schema: 1,
  mass: {
    // pilot + survival kit (~120 kg), 6 × AIM-120C (~970 kg), 2 × AIM-9X (~170 kg), LAU-142/LAU-141 launchers and
    // trapezes (~300 kg), 480 rds 20 mm (~150 kg)
    payload: 1750,
    fuel: 5550,                          // ~68 % internal fuel -> 27 000 kg "typical" mass of the data sheet
    // Radii of gyration taken from the F-15C (similar twin-engine, twin-fin layout: rx 0.21, ry 0.34, rz 0.45) with a
    // little more roll inertia for the F-22's wing fuel: rx 0.23, ry 0.35, rz 0.45. The data-sheet estimate
    // (Ixx 127 000) implies rx = 0.32, far above any fighter, so it is not used.
    inertia: { ixx: 70000, iyy: 300000, izz: 360000, ixz: 2500, atMass: 27000 },   // kg·m², scaled with mass
  },
  aero: {
    ref: { chord: 6.4 },                 // MAC of the trapezoidal planform (root 9.4 m at centreline, taper 0.19)
    // AR 2.36, LE sweep 42°: DATCOM slope ≈ 2.9/rad, + chine / body lift -> 3.0. Chined forebody + scheduled LEF give
    // a gentle stall (sharpness 9) with CLmax ≈ 1.68 near 32–35° AoA and strong post-stall lift (vortex lift).
    lift: { cl0: 0.03, cla: 3.0, clMax: 1.68, sharpness: 9, clMaxNeg: 1.0, postStallCl: 1.2, cd90: 1.35 },
    mach: {
      m:     [0,      0.4,    0.6,    0.8,    0.9,    0.95,   1.0,    1.05,   1.1,    1.2,    1.4,    1.6,    1.8,    2.0,    2.2,    2.4],
      // lift slope ratio: mild subsonic rise for a 42° low-AR wing, supersonic decay ~4/sqrt(M²-1) capped by the planform
      cla:   [1.00,   1.02,   1.05,   1.10,   1.14,   1.16,   1.17,   1.16,   1.14,   1.08,   0.98,   0.88,   0.80,   0.73,   0.67,   0.62],
      clMax: [1.00,   1.00,   0.98,   0.93,   0.88,   0.85,   0.83,   0.82,   0.80,   0.78,   0.73,   0.67,   0.62,   0.57,   0.53,   0.50],
      // zero-lift drag on 78 m²: clean internal carriage, area-ruled. Subsonic drag area 1.37 m² (F-15C ≈ 1.2 m²);
      // transonic peak 0.0415 (3.2 m²) fixes the sea-level max speed (~M1.2); the gentle supersonic decay together
      // with the F119 lapse gives supercruise ~M1.76 at 11–12 km and the AB top speed ~M2.25.
      cd0:   [0.0175, 0.0175, 0.0176, 0.0180, 0.0195, 0.0240, 0.0325, 0.0390, 0.0410, 0.0415, 0.0410, 0.0400, 0.0390, 0.0382, 0.0376, 0.0372],
      // induced drag factor: 1/(π·AR·e) with e≈0.93 thanks to LEF scheduling, -> ≈1/CLα supersonically (no LE suction)
      k:     [0.145,  0.145,  0.147,  0.150,  0.155,  0.165,  0.185,  0.205,  0.225,  0.26,   0.30,   0.35,   0.40,   0.45,   0.50,   0.54],
      xac:   [0,      0,      0,      0.01,   0.03,   0.06,   0.10,   0.13,   0.15,   0.17,   0.18,   0.18,   0.18,   0.18,   0.18,   0.18],
      ctrl:  [1,      1,      1,      0.98,   0.95,   0.91,   0.87,   0.83,   0.81,   0.78,   0.72,   0.66,   0.61,   0.57,   0.53,   0.50],
    },
    drag: { clMinDrag: 0.02, gear: 0.020, speedbrake: 0.035, beta: 1.1, elevator: 0.05 },   // "speedbrake" = split rudders/flaperons/spoilers
    // relaxed static stability (slightly unstable subsonic, stable supersonic through xac). Large all-moving stabs
    // (Sh/S ≈ 0.17, arm ≈ 7.5 m): tail volume ≈ 0.2 -> cmde ≈ 0.6/rad on the 6.4 m chord. Mild natural nose-down
    // moment when stalled; the vectoring nozzles provide the rest of the high-AoA pitch authority.
    pitch: { cm0: 0.0, staticMargin: -0.01, cmq: -6, cmde: 0.60, clde: 0.40, cmPostStall: -0.30, cmGear: -0.006, cmSpeedbrake: -0.003 },
    side: { cyb: -1.0, cydr: 0.16 },
    // flaperons + ailerons (±25°) and differential stabilators; low-AR wing -> modest roll damping
    roll: { clb: -0.06, clbCl: -0.06, clp: -0.30, clr: 0.03, clrCl: 0.14, clda: 0.075, cldt: 0.04, cldr: 0.010 },
    // twin 27°-canted fins: good directional stability up to ~32° AoA, fading by 55°; the FCS (rudders + differential
    // stab + the AoA-insensitive fins high up) keeps it slightly positive post-stall (no departure, see SCHEMA recipe)
    yaw: { cnb: 0.15, cnp: -0.01, cnpCl: -0.05, cnr: -0.30, cnda: 0.003, cndaCl: 0.010, cndr: 0.075, alphaDir: [32, 55], cnbPostStall: 0.04 },
    stall: { wingDrop: 0.002, clpPost: 0.0, buffetMargin: 12, warnMargin: 3 },   // carefree FBW: almost no wing drop
    flaps: {
      // No flap lever on the F-22: the flaperons droop ~26° (with LEF down) when the gear handle is down (take-off and
      // landing), and retract with it — same scheme as the F-16 TEF. [ / ] still override.
      detents: [
        { name: 'UP', deg: 0, pos: 0 },
        { name: 'DN', deg: 26, pos: 1, dcl0: 0.32, clMax: 1.90, dcd0: 0.035, dcm0: -0.04 },
      ],
      time: 2.5, autoWithGear: true, takeoff: 1, landing: 1,
    },
    // leading-edge flaps, scheduled with AoA and Mach (~20–25° down at high AoA / landing)
    slat: { auto: { alpha: [-2, 24], machFade: [0.9, 1.3], gearDown: 0.8 }, dAlphaStall: 8, dcd0: 0.002 },
  },
  controls: {
    elevator: { max: 25, rate: 70, tau: 0.04 },       // all-moving stabilators ±25°
    aileron: { max: 25, rate: 90, tau: 0.04 },        // ailerons / flaperons
    rudder: { max: 30, rate: 120, tau: 0.04 },        // twin rudders ±30°
    diffTail: { max: 8 },                             // differential stabilator for roll
    speedbrake: { time: 2 },
  },
  hook: true,                                         // emergency arresting hook
  engines: {
    // F119-PW-100: 116 kN dry / 156 kN AB (specs). Fixed caret inlets with good oblique-shock recovery ('ramp').
    // Lapse: θ-break 1.05; steep dry temperature lapse (milLapse 3.0) and a flatter AB lapse (1.5) so that dry thrust
    // alone balances the drag at ~M1.76 at 11–12 km (supercruise) while the AB thrust at altitude reaches M2.25 and
    // the 19.8 km ceiling at M1.7; compressor-face pressure limit 1.4 (burner pressure / duct q limit) caps the
    // thrust at high q (low-altitude climb ~65 000 ft/min, ~M1.2 at sea level). maxMach 2.25: the fixed inlet's
    // design limit (thrust fades quickly above it), which is what limits the real aircraft, not thrust.
    type: 'turbofan-ab', inlet: 'ramp', throttleRatio: 1.05, milLapse: 3.0, abLapse: 1.5, pressureLimit: 1.40, maxMach: 2.25,
    // idle thrust 1.5 % (FADEC idle; the jet does not creep on dry concrete with brakes off)
    n1Idle: 0.32, n2Idle: 0.66, spoolUp: 3.0, spoolDown: 2.3, idleThrust: 0.015, idleFuelFlow: 0.15,
    // dry TSFC ~0.66 static rising with Mach (~1.0 in supercruise: ~13 600 kg/h total at M1.76 / 12 km), AB ~1.85
    tsfc: [0.66, 0.28], tsfcAb: [1.85, 0.25], egt: [400, 900, 980], abLightTime: 0.8, startTime: 15,
    // 2-D nozzles ±20° pitch, ~45°/s, driven by the pitch channel; faded out at high q where the stabs suffice
    vectoring: { pitch: 20, rate: 45, qFade: 35000 },
  },
  gear: {
    nose: { travel: 0.30 }, main: { travel: 0.32 },
    retractTime: 7, steerMax: 45, steerLatG: 0.30, brakeMu: 0.50, maxSinkRate: 3.6, crashSinkRate: 7,
  },
  // nozzle lower lips ~1.4 m above the ground, 7.4 m behind the mains -> ~11°, + strut compression -> 13°
  structure: { tailStrikeDeg: 13, bellyY: -0.85 },
  limits: { vmo: 412, mmo: 2.25 },                    // 800 KCAS / Mach 2.25
  fcs: {
    // fly-by-wire fighter law: G command (+9 / -3), AoA limit 60° — reachable and controllable thanks to the
    // vectoring nozzles (post-stall manoeuvring); roll-rate command around the velocity vector, fading at high AoA
    type: 'fbw-fighter',
    nzMax: 9, nzMin: -3, alphaMax: 60, alphaMin: -15, pitchRateMax: 45, alphaGain: 1.6,
    rollRate: 240, rollAlphaFade: [20, 55],
    gearDown: { nzMax: 5, alphaMax: 20, rollRate: 150, pitchRateMax: 25 },   // power-approach mode (tail-strike safe)
    betaGain: 3, ari: 0.1,
  },
  // flight-test targets (tools/flight-test.mjs): [value, tolerance fraction] — all at 27 000 kg
  targets: {
    stallSpeedLanding: [62, 0.08],            // m/s CAS, gear-down AoA limiter (20°), flaperons drooped
    stallSpeedClean: [56, 0.10],              // m/s CAS, clean CLmax ≈ 1.7 (data sheet: ~60 m/s, est.)
    takeoffRoll: [400, 0.3],                  // m, max AB (data sheet ~450 m; T/W 1.18 -> ~350–450 m)
    landingRoll: [750, 0.35],                 // m, brakes only, no chute
    climbRate: [300, 0.25], climbSpeed: 300,  // m/s at sea level, max AB, M0.88 (est. 60 000+ ft/min)
    maxSpeedSL: [1.21, 0.06],                 // Mach at sea level (~800 KCAS)
    maxSpeedAlt: [2.25, 0.05], maxSpeedAltitude: 12000,
    ceiling: 19800, ceilingMach: 1.7,         // 65 000 ft reached supersonically (subsonic ceiling is lower)
    rollRate: [230, 0.2], rollSpeed: 200,     // deg/s at 200 m/s CAS (est. 200–250)
    sustainedTurn: [15.5, 0.15], sustainedTurnSpeed: 232, sustainedTurnAltitude: 4572,   // M0.88, 15 000 ft (est.)
    instantTurn: [25.5, 0.15], instantTurnSpeed: 185,    // corner ~360 KCAS, 9 g (est.)
    maxG: [9, 0.05], maxGSpeed: 240,
    glideRatio: [10, 0.2], glideSpeed: 127,   // L/Dmax ~10 (est.)
    cruise: { altitude: 10000, mach: 0.9, fuelFlow: [2600, 0.3] },   // kg/h total; no published figure, ±30 % like the F-16
    approachAoA: [11, 0.25],                  // deg (data sheet ~11°; ±25 % because the published value is approximate)
    rotateSpeed: 80,                          // m/s (~155 kt)
  },
};
