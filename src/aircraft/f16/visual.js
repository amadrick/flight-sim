// F-16C Block 50 — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight when parked.
// Reference dimensions: length 15.03 m (pitot tip to tail), span 9.45 m over the launchers (9.96 with AIM-9s),
// wing 27.87 m² / 40° LE sweep / NACA 64A204, tailplane span 5.58 m with 10° anhedral, wheelbase 4.0 m, track 2.36 m.
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['usaf', 'aggressor', 'demo'];

const SCHEMES = {
  usaf: { name: 'USAF two-tone grey', top: '#5d6165', mid: '#7d8489', under: '#a0a6aa', radome: '#70777c', fin: '#7d8489', finish: 'matte', code: 'SW', serial: 'AF 93 548', tip: '#b8872a', mark: '#3c4044' },
  aggressor: { name: 'Aggressor blue splinter', top: '#2d4a73', mid: '#7f9fc4', under: '#b9c4cf', radome: '#5a6f8c', fin: '#7f9fc4', finish: 'semigloss', code: 'WA', serial: 'AF 86 291', tip: '#b02a26', mark: '#1b2533', splinter: ['#2d4a73', '#56789f', '#1f2c40', '#c9d3dd'] },
  demo: { name: 'Skyward Demo Team', top: '#f1f1ee', mid: '#f1f1ee', under: '#f1f1ee', radome: '#16254a', fin: '#16254a', finish: 'gloss', code: 'SKY', serial: '01', tip: '#c81e2c', mark: '#16254a', demo: true },
};

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'usaf', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, paintF = F[SC.finish];
  const seg = Math.max(24, Math.round(64 * detail / 4) * 4);

  // ---- atlas ------------------------------------------------------------------------------------------------------------
  const atlas = K.createAtlas({ size: atlasSize, base: paintF(SC.mid) });
  const cFus = atlas.chart('fus', { type: 'unwrap', z: [-8.25, 5.65], girth: 5.6, vScale: 0.9, strips: 2 });
  const cWT = { R: atlas.chart('wingTopR', { type: 'plan', x: [0.9, 4.62], z: [-2.0, 2.4], view: 'top' }), L: atlas.chart('wingTopL', { type: 'plan', x: [-4.62, -0.9], z: [-2.0, 2.4], view: 'top' }) };
  const cWB = { R: atlas.chart('wingBotR', { type: 'plan', x: [0.9, 4.62], z: [-2.0, 2.4], view: 'bottom', density: 0.8 }), L: atlas.chart('wingBotL', { type: 'plan', x: [-4.62, -0.9], z: [-2.0, 2.4], view: 'bottom', density: 0.8 }) };
  const cST = { R: atlas.chart('stabTopR', { type: 'plan', x: [0.9, 2.85], z: [3.9, 6.45], view: 'top', density: 0.8 }), L: atlas.chart('stabTopL', { type: 'plan', x: [-2.85, -0.9], z: [3.9, 6.45], view: 'top', density: 0.8 }) };
  const cSB = atlas.chart('stabBot', { type: 'plan', x: [0.9, 2.85], z: [3.9, 6.45], view: 'bottom', mirror: true, density: 0.7 });
  const cFin = { L: atlas.chart('finL', { type: 'side', z: [2.1, 6.12], y: [0.75, 3.4], view: 'left' }), R: atlas.chart('finR', { type: 'side', z: [2.1, 6.12], y: [0.75, 3.4], view: 'right' }) };
  const cPanel = atlas.chart('panel', { type: 'rect', w: 0.8, h: 0.6, density: 2.5 });
  atlas.pack();
  const U = {
    under: atlas.swatch('under', paintF(SC.under)), mid: atlas.swatch('mid', paintF(SC.mid)), top: atlas.swatch('top', paintF(SC.top)),
    duct: atlas.swatch('duct', F.gloss('#e4e5e2')), dark: atlas.swatch('dark', F.darkGrey), black: atlas.swatch('black', F.black),
    exhaust: atlas.swatch('exhaust', F.exhaust), heat: atlas.swatch('heat', { color: '#8a8078', rough: 0.5, metal: 0.75 }), heat2: atlas.swatch('heat2', { color: '#4a4542', rough: 0.55, metal: 0.8 }), ti: atlas.swatch('ti', F.titanium),
    well: atlas.swatch('well', F.gearWhite), interior: atlas.swatch('interior', F.interior), console: atlas.swatch('console', { color: '#1d1f21', rough: 0.6, metal: 0 }),
    seat: atlas.swatch('seat', { color: '#25282a', rough: 0.7, metal: 0 }), cushion: atlas.swatch('cushion', F.fabric), accent: atlas.swatch('accent', { color: '#d6b21e', rough: 0.5, metal: 0 }),
    suit: atlas.swatch('suit', { color: '#4d5540', rough: 0.9, metal: 0 }), helmet: atlas.swatch('helmet', { color: '#8d9296', rough: 0.35, metal: 0 }), visor: atlas.swatch('visor', { color: '#0a0b0d', rough: 0.05, metal: 0.4 }),
    glove: atlas.swatch('glove', { color: '#3a3d33', rough: 0.9, metal: 0 }), frame: atlas.swatch('frame', paintF(SC.demo ? SC.radome : '#3b3f43')), steel: atlas.swatch('steel', F.steel),
    aim: atlas.swatch('aim', F.semigloss('#c9cccd')), aimNose: atlas.swatch('aimNose', { color: '#1c1e20', rough: 0.15, metal: 0.3 }), rail: atlas.swatch('rail', paintF(SC.under)), lens: atlas.swatch('lens', F.lens),
    radome: atlas.swatch('radome', F.semigloss(SC.radome)), probe: atlas.swatch('probe', F.bareMetal),
  };

  const rig = K.createRig(ctx, { geometry: G, name: 'f16', glassLayer: opts.glassLayer });

  // ---- fuselage (blended body with forebody strakes and the wing shelf as a chine) ------------------------------------------
  //        z      top     bot     w      chine  tu    tl    k     e    kTop  kBot
  const FS = [
    [-8.22, 0.220, 0.220, 0.000, 0],
    [-8.14, 0.256, 0.184, 0.036, 0],
    [-7.90, 0.326, 0.114, 0.106, 0],
    [-7.50, 0.426, 0.016, 0.205, 0],
    [-7.00, 0.530, -0.070, 0.305, 0],
    [-6.50, 0.625, -0.135, 0.385, 0],
    [-6.10, 0.690, -0.170, 0.435, 0],
    [-5.75, 0.740, -0.190, 0.470, 0],
    [-5.30, 0.760, -0.205, 0.500, 0.50, 0.06, 0.05, 0.10, 0.9],
    [-4.80, 0.760, -0.215, 0.520, 0.575, 0.06, 0.05, 0.10, 0.9],
    [-4.20, 0.760, -0.225, 0.535, 0.665, 0.07, 0.06, 0.12, 0.9],
    [-3.60, 0.770, -0.235, 0.555, 0.785, 0.08, 0.06, 0.13, 0.9],
    [-3.30, 0.790, -0.240, 0.575, 0.845, 0.08, 0.07, 0.14, 0.95],
    [-3.00, 0.860, -0.250, 0.610, 0.910, 0.10, 0.08, 0.16, 1.0, 0.58, 0.6],
    [-2.60, 1.000, -0.270, 0.660, 1.000, 0.14, 0.10, 0.20, 1.2, 0.6, 0.62],
    [-2.20, 1.020, -0.480, 0.700, 1.090, 0.22, 0.16, 0.26, 1.6, 0.6, 0.66],
    [-1.80, 1.010, -0.640, 0.740, 1.150, 0.30, 0.24, 0.30, 2.0, 0.6, 0.70],
    [-1.00, 0.985, -0.700, 0.780, 1.150, 0.30, 0.26, 0.30, 2.0, 0.6, 0.72],
    [0.00, 0.950, -0.685, 0.800, 1.150, 0.30, 0.26, 0.30, 2.0, 0.6, 0.72],
    [1.50, 0.915, -0.640, 0.780, 1.150, 0.30, 0.26, 0.30, 2.0, 0.6, 0.70],
    [2.30, 0.895, -0.610, 0.750, 1.150, 0.28, 0.26, 0.28, 2.0, 0.6, 0.68],
    [3.00, 0.870, -0.570, 0.720, 1.120, 0.24, 0.24, 0.22, 1.7, 0.58, 0.64],
    [4.00, 0.820, -0.520, 0.680, 1.050, 0.22, 0.22, 0.18, 1.6, 0.56, 0.6],
    [5.00, 0.760, -0.465, 0.630, 0.980, 0.21, 0.21, 0.15, 1.6, 0.5523, 0.5523],
    [5.60, 0.705, -0.440, 0.590, 0.950, 0.20, 0.20, 0.13, 1.6, 0.5523, 0.5523],
  ].map(r => {
    const yc = (r[1] + r[2]) / 2, h = (r[1] - r[2]) / 2;
    const st = { z: r[0], y: yc, w: r[3], top: h, bot: h, kTop: r[9] ?? 0.5523, kBot: r[10] ?? 0.5523 };
    if (r[4] > 0) st.chine = { w: r[4], y: -yc, tu: r[5], tl: r[6], k: r[7], e: r[8] };
    return st;
  });
  const T_SILL = 0.375;
  const fus = K.loft({
    stations: FS, segments: seg, step: 0.11 / detail, chart: cFus, creases: ['side'], capEnd: 'flat', capUV: U.exhaust,
    cutouts: [
      { name: 'cockpit', z: [-5.72, -3.32], t: [T_SILL, 1 - T_SILL] },
      { name: 'mlg', z: [-0.78, 0.86], t: [0.045, 0.19], mirror: true },
    ],
  });
  cFus.body = fus;
  rig.material('paint', null);                        // placeholder; the atlas material is attached after painting
  const stat = new K.Mesh();                          // all static atlas geometry
  stat.add(fus.mesh);

  // ---- canopy -----------------------------------------------------------------------------------------------------------
  const canTop = K.pchip([-5.72, -5.55, -5.3, -5.0, -4.6, -4.2, -3.8, -3.4, -3.0, -2.7, -2.45], [0.742, 0.87, 1.03, 1.16, 1.27, 1.325, 1.33, 1.295, 1.2, 1.105, 1.02]);
  const canZ = [-5.72, -5.62, -5.48, -5.3, -5.05, -4.75, -4.4, -4.05, -3.7, -3.4, -3.32, -3.24, -3.05, -2.8, -2.6, -2.45];
  const canSt = canZ.map(z => { const s = fus.at(z, T_SILL).p; return { z, y: s[1], w: s[0], top: Math.max(0.002, canTop(z) - s[1]), bot: 0.01, kTop: [0.66, 0.6] }; });
  const cseg = Math.max(16, Math.round(32 * detail / 4) * 4), ct = 1 / cseg;
  const canLoft = (zr, tr, inflate, uv) => K.loft({ stations: canSt, segments: cseg, step: 0.12, tRange: tr, zRange: zr, inflate, uv }).mesh;
  const glassMove = canLoft([-5.72, -3.32], [0.25, 0.75], 0, [0, 0]);
  const glassFixed = canLoft([-3.32, -2.45], [0.25, 0.75], 0, [0, 0]);
  const frameMove = K.merge(canLoft([-5.72, -3.32], [0.25, 0.25 + ct], 0.004, U.frame), canLoft([-5.72, -3.32], [0.75 - ct, 0.75], 0.004, U.frame), canLoft([-3.42, -3.32], [0.25, 0.75], 0.005, U.frame), canLoft([-5.72, -5.66], [0.25, 0.75], 0.004, U.frame));
  stat.add(canLoft([-3.32, -3.24], [0.25, 0.75], 0.005, U.frame));
  stat.add(canLoft([-3.32, -2.45], [0.25, 0.25 + ct], 0.004, U.frame)).add(canLoft([-3.32, -2.45], [0.75 - ct, 0.75], 0.004, U.frame));

  // ---- cockpit -----------------------------------------------------------------------------------------------------------
  const eye = G.pilotEye;
  const tubX = 0.4;
  stat.add(K.tub({ x: tubX, y0: -0.1, y1: 0.52, z0: -5.6, z1: -3.3, uv: U.interior, taper: 0.9 }));
  {  // sill ledge closing the gap between the skin cut-out and the tub
    const zs = []; for (let z = -5.72; z <= -3.319; z += 0.2) zs.push(z); zs.push(-3.32);
    for (const sx of [1, -1]) {
      let prev = null;
      for (const z of zs) {
        const o = fus.at(z, sx > 0 ? T_SILL : 1 - T_SILL).p, a = stat.vert(o[0], o[1], z, -sx * 0.6, 0.8, 0, U.frame[0], U.frame[1]), b = stat.vert(sx * tubX * 0.92, 0.5, z, -sx * 0.6, 0.8, 0, U.frame[0], U.frame[1]);
        if (prev) { if (sx > 0) stat.quad(prev[0], a, b, prev[1]); else stat.quad(prev[0], prev[1], b, a); }
        prev = [a, b];
      }
    }
  }
  {  // glareshield / coaming, tapering forward with the canopy plan
    const gs = K.prism([[-5.7, 0.5], [-5.7, 0.705], [-5.15, 0.85], [-5.1, 0.83], [-5.1, 0.5]], -0.4, 0.4, U.black);
    for (let i = 0; i < gs.p.length; i += 3) gs.p[i] *= 0.45 + 0.55 * (gs.p[i + 2] + 5.7) / 0.6;
    stat.add(gs);
  }
  {  // instrument panel (painted chart) + pedestal + side consoles
    const z = -5.095, i0 = stat.vertexCount, q = [[-0.4, 0.2], [0.4, 0.2], [0.4, 0.8], [-0.4, 0.8]];
    for (const p of q) { const uv = cPanel.uv(p[0] + 0.4, 0.8 - p[1]); stat.vert(p[0], p[1], z, 0, 0, 1, uv[0], uv[1]); }
    stat.quad(i0, i0 + 1, i0 + 2, i0 + 3);
    stat.add(K.box(0.2, 0.34, 0.5, U.console).translate(0, 0.06, -4.95));
    for (const sx of [-1, 1]) stat.add(K.box(0.15, 0.1, 1.5, U.console).translate(sx * 0.32, 0.36, -4.4));
    stat.add(K.stick({ base: [0.3, 0.4, -4.75], height: 0.2, uv: U.black, uvGrip: U.dark }));
    stat.add(K.box(0.07, 0.07, 0.12, U.dark).translate(-0.31, 0.45, -4.8));     // throttle
  }
  stat.add(K.ejectionSeat({ eye, recline: 28, uv: { frame: U.seat, cushion: U.cushion, accent: U.accent } }));
  const hudParts = K.hud({ eye, dist: 0.6, width: 0.16, height: 0.13, drop: 0.035, uv: U.black });
  stat.add(hudParts.frame);
  const pilotMesh = K.pilot({ eye, recline: 22, stick: [0.3, -0.46, -0.3], throttle: [-0.31, -0.56, -0.36], uv: { suit: U.suit, helmet: U.helmet, visor: U.visor, dark: U.dark, glove: U.glove } });

  // ---- intake (one skin: duct → lip → outer cowl), splitter plate, diverter ------------------------------------------------
  const IS = (z, yc, w, top, bot, extra) => ({ z, y: yc, w, top, bot, kTop: 0.86, kBot: 0.62, ...extra });
  let intakeRun = 0;
  const intake = K.loft({
    stations: [
      IS(-1.3, -0.26, 0.40, 0.24, 0.30), IS(-2.6, -0.385, 0.45, 0.13, 0.30), IS(-3.40, -0.42, 0.463, 0.12, 0.297, { hard: true }),
      IS(-3.575, -0.42, 0.482, 0.133, 0.315), IS(-3.6, -0.42, 0.5, 0.15, 0.33), IS(-3.575, -0.42, 0.518, 0.166, 0.346),
      IS(-3.3, -0.42, 0.545, 0.175, 0.36), IS(-2.6, -0.42, 0.60, 0.22, 0.35), IS(-1.9, -0.36, 0.69, 0.3, 0.37), IS(-1.45, -0.3, 0.74, 0.3, 0.39),
    ],
    segments: Math.max(24, Math.round(40 * detail / 4) * 4), step: 0.16, capStart: 'flat', capUV: U.black,
    uvFn: (x, y, z, t, ring) => (ring.run === 0 ? U.duct : U.under),
    cutouts: [{ name: 'ng', z: [-3.44, -2.46], t: [0, 0.075], mirror: true, shape: () => intakeRun++ >= 0 }],
  });
  stat.add(intake.mesh);
  stat.add(K.prism([[-3.88, -0.268], [-3.6, -0.262], [-3.3, -0.262], [-3.3, -0.285], [-3.6, -0.285], [-3.88, -0.276]], -0.47, 0.47, U.under));   // splitter plate
  stat.add(K.prism([[-3.62, -0.265], [-3.05, -0.23], [-3.05, -0.275]], -0.03, 0.03, U.under).scale(1, 1, 1));                                 // diverter wedge (centre)
  for (const sx of [-1, 1]) stat.add(K.prism([[-3.5, -0.262], [-3.05, -0.24], [-3.05, -0.275]], sx * 0.3 - 0.015, sx * 0.3 + 0.015, U.under));

  // ---- wings ------------------------------------------------------------------------------------------------------------
  const zLE = (x) => -2.72 + x * Math.tan(40 * DEG), zTE = (x) => 2.31 - 0.0271 * x;
  const mkWing = (side) => K.wing({
    side, airfoil: K.naca6(0.04, 0.004), chordPts: Math.round(12 * detail), spanAxis: 'x', tip: 'flat',
    stations: [{ x: 0.95, y: 0, z: zLE(0.95), chord: zTE(0.95) - zLE(0.95), tc: 0.042, twist: 0 }, { x: 4.572, y: 0, z: zLE(4.572), chord: zTE(4.572) - zLE(4.572), tc: 0.04, twist: -2.5 }],
    lines: { hingeTE: [[1.17, 0.805], [3.62, 0.745], [4.572, 0.745]], hingeLE: [[1.17, 0.13], [4.572, 0.265]] },
    controls: [
      { name: 'flaperon', type: 'flap', span: [1.17, 3.62], from: 'hingeTE', nose: 1 },
      { name: 'lef', type: 'flap', span: [1.17, 4.572], to: 'hingeLE', tail: 1 },
    ],
    charts: { upper: side > 0 ? cWT.R : cWT.L, lower: side > 0 ? cWB.R : cWB.L },
  });
  const W = { R: mkWing(1), L: mkWing(-1) };
  stat.add(W.R.mesh).add(W.L.mesh);

  // ---- tail surfaces -------------------------------------------------------------------------------------------------------
  const stabY = (x) => -0.02 - (x - 0.96) * Math.tan(10 * DEG);
  const mkStab = (side) => K.wing({
    side, airfoil: K.biconvex(0.05), chordPts: Math.round(9 * detail), spanAxis: 'x', tip: 'flat', root: 'flat',
    stations: [{ x: 0.9, y: stabY(0.9), z: 3.93, chord: 2.37, tc: 0.06 }, { x: 2.79, y: stabY(2.79), z: 5.516, chord: 0.864, tc: 0.035 }],
    charts: { upper: side > 0 ? cST.R : cST.L, lower: cSB },
  });
  const stab = { R: mkStab(1), L: mkStab(-1) };
  const fin = K.wing({
    airfoil: K.biconvex(0.05), chordPts: Math.round(10 * detail), spanAxis: 'y', tip: 'flat',
    stations: [{ x: 0, y: 0.80, z: 2.20, chord: 3.10, tc: 0.055 }, { x: 0, y: 3.33, z: 4.96, chord: 1.08, tc: 0.032 }],
    lines: { hinge: [[1.28, 0.775], [3.12, 0.62]] },
    controls: [{ name: 'rudder', type: 'flap', span: [1.28, 3.12], from: 'hinge', nose: 1 }],
    charts: { upper: cFin.L, lower: cFin.R },
  });
  stat.add(fin.mesh);
  // fin root fairing (houses the rudder actuator; ends in the tail light fairing above the nozzle)
  stat.add(K.loft({
    stations: [{ z: 0.9, y: 0.84, w: 0.01, h: 0.02 }, { z: 1.6, y: 0.86, w: 0.07, top: 0.08, bot: 0.1 }, { z: 2.4, y: 0.88, w: 0.115, top: 0.17, bot: 0.2 }, { z: 4.2, y: 0.9, w: 0.14, top: 0.22, bot: 0.3 },
      { z: 5.3, y: 0.92, w: 0.14, top: 0.22, bot: 0.35 }, { z: 5.9, y: 0.96, w: 0.11, top: 0.17, bot: 0.3 }, { z: 6.12, y: 1.0, w: 0.05, top: 0.08, bot: 0.1 }],
    segments: 16, step: 0.3, uv: U.mid, capEnd: 'flat',
  }).mesh);
  for (const sx of [1, -1]) {  // ventral fins, canted 15° outward
    stat.add(K.wing({ side: sx, airfoil: K.biconvex(0.045), chordPts: 6, spanAxis: 'u', tip: 'flat', uv: U.under, edgeUV: U.under,
      stations: [{ x: 0.5, y: -0.36, z: 3.5, chord: 1.5, tc: 0.045 }, { x: 0.5 + 0.6 * Math.sin(15 * DEG), y: -0.36 - 0.6 * Math.cos(15 * DEG), z: 3.98, chord: 0.86, tc: 0.04 }] }).mesh);
  }

  // ---- nozzle, afterburner interior, speedbrakes ----------------------------------------------------------------------------
  const NZ = { c: [0, 0.133, 0], z0: 5.6, z1: 6.48 };
  const nozzleMesh = K.petalNozzle({ z0: NZ.z0, z1: NZ.z1, r0: 0.588, rClosed: 0.395, rOpen: 0.555, petals: 15, centre: NZ.c, uvOuter: U.heat, uvInner: U.heat2, thickness: 0.03 });
  stat.add(K.lathe([[0.56, 5.62], [0.5, 5.0], [0.5, 4.6], [0, 4.6]], { segments: 24, uv: U.exhaust }).translate(0, NZ.c[1], 0));      // jet pipe + turbine face
  for (let i = 0; i < 12; i++) stat.add(K.box(0.025, 0.5, 0.05, U.heat2).translate(0, 0.25, 0).rotateZ(i * Math.PI / 6).translate(0, NZ.c[1], 4.75));   // flame-holder spokes
  stat.add(K.lathe([[0.2, 4.7], [0.2, 4.78], [0.17, 4.78], [0.17, 4.7]], { segments: 20, uv: U.heat2 }).translate(0, NZ.c[1], 0));
  const glowMesh = K.afterburnerGlow({ zDeep: 4.82, zExit: 6.3, rDeep: 0.48, rExit: 0.4, centre: NZ.c });
  const sbMesh = (sx, sy) => K.prism([[5.6, 0], [5.6, sy * 0.115], [5.95, sy * 0.1], [6.3, sy * 0.014], [6.3, 0]], sx > 0 ? 0.625 : -0.975, sx > 0 ? 0.975 : -0.625, sy > 0 ? U.top : U.under);

  // ---- stores: wingtip rails + AIM-9, pitot, antennas ------------------------------------------------------------------------
  for (const sx of [1, -1]) {
    stat.add(K.launchRail({ x: sx * 4.635, y: 0, z0: 0.15, z1: 2.5, w: 0.12, h: 0.1, uv: U.rail }));
    stat.add(K.missile({ uvBody: U.aim, uvNose: U.aimNose, uvFin: U.aim }).translate(sx * 4.775, -0.005, -0.42));
  }
  stat.add(K.probe([0, 0.22, -8.2], [0, 0.22, -8.5], 0.016, U.probe));
  for (const sx of [1, -1]) stat.add(K.probe([sx * 0.3, 0.26, -7.02], [sx * 0.36, 0.26, -7.2], 0.012, U.probe));   // AoA probes
  for (let i = 0; i < 4; i++) stat.add(K.bladeAntenna({ pos: [(i - 1.5) * 0.11, fus.topAt(-6.0) - 0.02, -6.0], height: 0.075, chord: 0.05, sweep: 0.03, thickness: 0.006, uv: U.dark }));   // IFF "bird slicers"
  stat.add(K.bladeAntenna({ pos: [0, fus.topAt(-1.4) - 0.02, -1.4], height: 0.22, chord: 0.3, sweep: 0.18, uv: U.top }));
  stat.add(K.bladeAntenna({ pos: [0, -0.74, -2.2], height: 0.2, chord: 0.26, sweep: 0.14, down: true, uv: U.under }));
  stat.add(K.ellipsoid(0.03, 0.03, 0.05, { segments: 8, rings: 5, uv: U.lens }).translate(0, 3.36, 5.55));

  // ---- gear wells -------------------------------------------------------------------------------------------------------
  const P = fus.patches, IP = intake.patches;
  stat.add(K.well(P.mlgR, 0.34, U.well)).add(K.well(P.mlgL, 0.34, U.well));
  const ngPatch = K.merge(IP.ngR, IP.ngL);
  stat.add(K.well(ngPatch, 0.2, U.well, [0, 1, 0]));

  // ---- materials ---------------------------------------------------------------------------------------------------------
  paint(atlas, { SC, livery, fus, W, fin, cFus, cWT, cWB, cST, cSB, cFin, cPanel, paintF });
  const mat = atlas.material(ctx, { envMapIntensity: 1 });
  rig.material('paint', mat, { shared: true });
  rig.disposables.push(atlas);
  rig.glass('canopy', K.glassMaterial(ctx, SC.demo ? K.GLASS.smoke : K.GLASS.gold));
  rig.glass('hud', K.glassMaterial(ctx, K.GLASS.hud));
  const glow = rig.material('glow', K.glowMaterial(), { shadow: false });

  rig.addStatic(stat, 'paint');
  rig.addStatic(glassFixed, 'canopy');
  rig.addStatic(hudParts.glass, 'hud');

  // ---- moving parts ------------------------------------------------------------------------------------------------------
  const canopyNode = rig.node('canopy', { pivot: [0, 0.86, -3.3] });
  rig.part('canopyGlass', glassMove, { parent: canopyNode, key: 'canopy' });
  rig.part('canopyFrame', frameMove, { parent: canopyNode });
  const setCanopy = rig.hinge(canopyNode, [-1, 0.86, -3.3], [1, 0.86, -3.3], { ref: [0, 0.9, -5.7], toward: [0, 1, 0] });
  const pilotNode = rig.part('pilot', pilotMesh, { pivot: eye });

  const flR = rig.hingePart('flaperonR', W.R.controls.flaperon), flL = rig.hingePart('flaperonL', W.L.controls.flaperon);
  const lefR = rig.hingePart('lefR', W.R.controls.lef), lefL = rig.hingePart('lefL', W.L.controls.lef);
  const rud = rig.hingePart('rudder', fin.controls.rudder, { toward: [1, 0, 0] });
  const mkStabPart = (name, s, sx) => {
    const a = [sx * 0.9, stabY(0.9), 5.18], b = [sx * 2.79, stabY(2.79), 5.18];
    const node = rig.part(name, s.mesh, { pivot: a });
    return rig.hinge(node, a, b, { ref: [sx * 1.8, stabY(1.8), 6.3], toward: [0, 1, 0] });
  };
  const setStabR = mkStabPart('stabR', stab.R, 1), setStabL = mkStabPart('stabL', stab.L, -1);
  const sb = [];
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    const node = rig.part(`speedbrake${sx > 0 ? 'R' : 'L'}${sy > 0 ? 'U' : 'D'}`, sbMesh(sx, sy), { pivot: [sx * 0.8, sy * 0.1, 5.6] });
    sb.push(rig.hinge(node, [sx * 0.625, sy * 0.1, 5.6], [sx * 0.975, sy * 0.1, 5.6], { ref: [sx * 0.8, 0, 6.3], toward: [0, sy, 0] }));
  }
  const nozzle = rig.part('nozzle', nozzleMesh, { pivot: [0, NZ.c[1], NZ.z0] });
  rig.part('abGlow', glowMesh, { key: 'glow' });
  const hookMesh = K.arrestorHook({ pivot: [0, -0.5, 3.35], length: 1.95, radius: 0.03, uv: U.steel });
  const hookNode = rig.part('hook', hookMesh, { pivot: [0, -0.5, 3.35] });
  const setHook = rig.hinge(hookNode, [-1, -0.5, 3.35], [1, -0.5, 3.35], { ref: [0, -0.5, 5.3], toward: [0, -1, 0] });

  // ---- landing gear --------------------------------------------------------------------------------------------------------
  const gp = G.gear;
  const doorOf = (patch, edge, inner = U.well) => ({ mesh: K.thicken(patch, 0.02, inner), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  K.buildGear(rig, atlas, {
    name: 'nose', index: 0, contact: gp[0].pos, wheelRadius: gp[0].wheelRadius, wheelWidth: 0.145, pivot: [0, -0.66, -3.4], stroke: 0.2, staticFrac: 0.35,
    strutR: 0.042, fork: 'fork', steer: true, links: 'front', retract: { to: [0, -0.62, -2.78], twist: 90 }, window: [0.22, 0.88],
    brace: [0, -0.66, -2.95],
    doors: [{ name: 'noseDoor', ...doorOf(ngPatch, intake.edges.ngR.tHi), open: 92, toward: [0, -1, 0] }],
    lamps: [{ kind: 'landing', pos: [-0.07, -0.86, -3.47], size: 0.045, color: [1, 0.96, 0.88] }, { kind: 'taxi', pos: [0.07, -0.86, -3.47], size: 0.04, color: [1, 0.96, 0.88] }],
  });
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, off = 0.15, edge = fus.edges['mlg' + key];
    K.buildGear(rig, atlas, {
      name: 'main' + key, index: i, contact: [c[0] - sx * off, c[1], c[2]], wheels: [sx * off], wheelRadius: gp[i].wheelRadius, wheelWidth: 0.21,
      pivot: [sx * 0.6, -0.4, 0.42], stroke: 0.28, staticFrac: 0.35, strutR: 0.05, fork: 'half', links: 'rear',
      retract: { to: [sx * 0.46, -0.4, -0.62] }, window: [0.22, 0.9], brace: [sx * 0.45, -0.5, -0.35],
      doors: [{ name: 'mainDoor' + key, ...doorOf(P['mlg' + key], sx > 0 ? edge.tLo : edge.tHi), open: 100, toward: [0, -1, 0] }],
    });
  }

  // ---- lamps ---------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.035, squash: [0.7, 0.7, 1.6] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.035, squash: [0.7, 0.7, 1.6] });
  rig.lamp('nav', [-0.575, -0.36, -2.9], { color: [1, 0.04, 0.02], size: 0.03 }); rig.lamp('nav', [0.575, -0.36, -2.9], { color: [0.02, 1, 0.25], size: 0.03 });
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.03 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.04 });

  // ---- animation -----------------------------------------------------------------------------------------------------------
  rig.onUpdate((S) => {
    const sf = S.sf, e = S.eng[0] || {};
    flR.set((sf.aileronR * 21 - sf.flaps * 20) * DEG); flL.set((sf.aileronL * 21 - sf.flaps * 20) * DEG);
    const lef = Math.max(sf.slats, sf.flaps * 0.6); lefR.set(-lef * 25 * DEG); lefL.set(-lef * 25 * DEG);
    setStabR(sf.elevatorR * 22 * DEG); setStabL(sf.elevatorL * 22 * DEG);
    rud.set(sf.rudder * 30 * DEG);
    for (const s of sb) s(sf.speedbrake * 43 * DEG);
    nozzle.morphTargetInfluences[0] = e.nozzle ?? 0;
    K.abGlowColor(glow.color, e, S.night);
    setCanopy(sf.canopy * 32 * DEG);
    setHook(sf.hook * 38 * DEG);
    pilotNode.visible = !rig.cameraInCockpit;
  });
  const visual = rig.build();
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- paint -------------------------------------------------------------------------------------------------------------------
function paint(atlas, o) {
  const { SC, fus, W, fin, cFus, cWT, cWB, cST, cSB, cFin, cPanel, paintF } = o, F = K.FINISH;
  const top = paintF(SC.top), mid = paintF(SC.mid), under = paintF(SC.under);
  const mark = SC.mark, lowVis = SC.demo ? false : mark;
  const slime = { color: '#c9cf8f', rough: 0.35, metal: 0 };
  const rnd = (() => { let a = 99; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();

  // ================= fuselage =================
  const P = atlas.pen(cFus);
  P.fill('all', mid);
  P.band(-8.25, 5.65, -Infinity, (z) => (z < -6.4 ? 0.2 : z < -5.4 ? 0.2 - (z + 6.4) * 0.2 : 0.0), under, { feather: 3 });
  for (const s of [1, -1]) {            // dark upper surfaces from behind the cockpit to the tail (soft diagonal front edge)
    const t = (v) => (s > 0 ? v : 1 - v);
    P.fill([[-1.9, t(0.25)], [-2.9, t(0.36)], [-3.25, t(0.5)], [5.65, t(0.5)], [5.65, t(0.25)]], top, { feather: 3 });
  }
  P.fill((g) => g.rect(-8.25, 0, 1.75, 1), F.semigloss(SC.radome));                                     // radome
  if (SC.splinter) splinter(P, SC, rnd, [-6.4, 5.65], [0.26, 0.74]);
  if (SC.demo) {
    P.band(-6.5, 5.65, 0.02, 0.24, F.gloss('#16254a'), {}); P.band(-6.5, 5.65, 0.24, 0.3, F.gloss('#c81e2c'), {});
    for (const s of [1, -1]) { const t = (v) => (s > 0 ? v : 1 - v); P.fill([[-2.6, t(0.5)], [-0.6, t(0.5)], [1.6, t(0.27)], [0.2, t(0.27)]], F.gloss('#16254a')); P.fill([[-0.45, t(0.5)], [0.0, t(0.5)], [2.2, t(0.27)], [1.75, t(0.27)]], F.gloss('#c81e2c')); }
  }
  // anti-glare panel ahead of the windscreen
  P.fill([[-6.45, 0.46], [-5.72, 0.385], [-5.72, 0.615], [-6.45, 0.54]], F.matte(SC.demo ? '#16254a' : '#33373a'));
  // panel lines: frames and longerons
  const frames = [-7.6, -6.5, -6.1, -5.75, -5.3, -4.8, -4.2, -3.6, -3.0, -2.45, -1.8, -1.1, -0.4, 0.3, 0.95, 1.6, 2.3, 3.0, 3.6, 4.2, 4.8, 5.35];
  for (const z of frames) P.ring(z, 0, 1, { px: z === -6.5 ? 1.6 : 1, depth: 0.4, dark: z === -6.5 ? 0.3 : 0.11 });
  for (const y of [0.45, 0.62]) P.yLine(-6.5, 5.6, (z) => fus.botAt(z) + (fus.topAt(z) - fus.botAt(z)) * y, { px: 1, depth: 0.35, dark: 0.15 });
  for (const tt of [0.03, 0.08, 0.14, 0.2]) for (const s of [1, -1]) P.line([[-1.8, s > 0 ? tt : 1 - tt], [5.6, s > 0 ? tt : 1 - tt]], { px: 1, depth: 0.3, dark: 0.13 });
  for (const tt of [0.31, 0.4, 0.47]) for (const s of [1, -1]) P.line([[-2.4, s > 0 ? tt : 1 - tt], [5.6, s > 0 ? tt : 1 - tt]], { px: 1, depth: 0.3, dark: 0.13 });
  P.line([[-8.2, 0], [5.6, 0]], { px: 1, depth: 0.3, dark: 0.12 }); P.line([[-2.4, 0.5], [5.6, 0.5]], { px: 1, depth: 0.3, dark: 0.12 });
  // rivet rows along the frames on the mid/aft body
  for (const z of frames) if (z > -5.5) { P.rivets(z + 0.035, 0.27, z + 0.035, 0.49, 0.007, { px: 1.2, depth: 0.16, dark: 0.045 }); P.rivets(z + 0.035, 0.51, z + 0.035, 0.73, 0.007, { px: 1.2, depth: 0.16, dark: 0.045 }); }
  // access panels
  const acc = [[-5.2, 0.2, 0.5, 0.2], [-4.5, 0.15, 0.45, 0.22], [-2.0, 0.55, 0.5, 0.25], [-0.9, 0.6, 0.6, 0.22], [0.55, 0.62, 0.55, 0.2], [2.5, 0.5, 0.5, 0.22], [3.7, 0.42, 0.6, 0.2], [4.6, 0.3, 0.45, 0.2]];
  for (const [z, y, w, h] of acc) P.decalOn(z, y, 'both', { layers: ['height', 'color'] }, (g, layer) => { g.strokeStyle = layer === 'height' ? 'rgba(0,0,0,0.5)' : 'rgba(10,12,14,0.3)'; g.lineWidth = 0.008; g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, 0.03); g.stroke(); });
  // gun port and gas vents (left strake root), formation strip lights, markings
  P.decalOn(-3.95, 0.3, 'L', (g) => { g.fillStyle = '#1b1c1d'; g.beginPath(); g.ellipse(0, 0, 0.34, 0.06, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#3a3c3e'; for (let i = 0; i < 4; i++) g.fillRect(0.45 + i * 0.09, -0.05, 0.05, 0.1); });
  P.fill((g) => g.rect(-3.32, 0.375, 0.86, 0.25), F.black);                                             // deck under the fixed rear transparency
  for (const [z, y, w] of [[-6.05, 0.3, 0.55], [3.9, 0.42, 0.6]]) P.decalOn(z, y, 'both', { layers: ['color', 'orm'] }, (g, layer) => { g.fillStyle = layer === 'orm' ? 'rgb(255,90,0)' : slime.color; g.fillRect(-w / 2, -0.03, w, 0.06); });
  if (!SC.demo) {
    P.decalOn(-1.75, 0.52, 'both', (g) => K.drawStarBar(g, 0.42, { lowVis }));
    P.textOn('DANGER', -4.9, 0.6, 'both', 0.035, { color: '#a02a24', weight: 700 });
    P.decalOn(-4.55, 0.6, 'both', (g) => { g.fillStyle = '#a02a24'; g.beginPath(); g.moveTo(-0.07, 0.06); g.lineTo(0.07, 0.06); g.lineTo(0, -0.06); g.closePath(); g.fill(); });
    P.textOn('RESCUE', -5.35, 0.45, 'both', 0.04, { color: mark });
    P.decalOn(-5.6, 0.45, 'both', (g) => { g.strokeStyle = mark; g.lineWidth = 0.012; g.beginPath(); g.moveTo(-0.1, 0); g.lineTo(0.07, 0); g.moveTo(0.02, -0.04); g.lineTo(0.08, 0); g.lineTo(0.02, 0.04); g.stroke(); });
  } else {
    P.textOn('SKYWARD', -3.0, 0.5, 'both', 0.3, { color: '#f1f1ee', italic: true, font: K.FONT.wide });
    P.textOn('DEMO TEAM', 3.2, 0.48, 'both', 0.13, { color: '#16254a', italic: true, font: K.FONT.wide });
  }
  for (const [z, txt] of [[-1.2, 'NO STEP'], [1.0, 'NO STEP']]) for (const s of [0.29, 0.71]) P.decalT(z, s, { rot: s < 0.5 ? 180 : 0 }, (g) => K.drawText(g, txt, 0.04, { color: SC.top === '#f1f1ee' ? '#16254a' : '#2b2e31' }));
  // weathering: tonal variation, belly grime, exhaust staining, gun soot
  P.noise({ alpha: 0.085, scale: 2.2, stretch: [1.6, 1], rough: 0.06 });
  P.noise({ alpha: 0.05, scale: 0.7, mode: 'light' });
  for (let i = 0; i < 26; i++) { const z = -2.5 + rnd() * 7, t = (rnd() < 0.5 ? 0.02 : 0.9) + rnd() * 0.08; P.streak(z, t, z + 0.5 + rnd() * 1.2, t, 0.008 + rnd() * 0.012, { alpha: 0.1 + rnd() * 0.14 }); }
  P.fill((g) => g.rect(5.15, 0, 0.5, 1), { color: 'rgba(40,36,32,0.35)' });
  for (const s of [0.25, 0.75]) P.streak(5.65, s, 4.3, s, 0.2, { alpha: 0.2 });
  P.streak(-3.6, 0.7, -2.2, 0.705, 0.05, { alpha: 0.4 });

  // ================= wings =================
  for (const key of ['R', 'L']) {
    const s = key === 'R' ? 1 : -1, wg = W.R;
    const at = (x, f) => { const p = wg.at(x, f); return [p[0], p[2]]; };
    for (const [chart, fin2, isTop] of [[cWT[key], top, true], [cWB[key], under, false]]) {
      const Q = atlas.pen(chart);
      Q.fill('all', fin2);
      if (isTop && SC.splinter) splinter(Q, SC, rnd, [s > 0 ? 0.9 : -4.62, s > 0 ? 4.62 : -0.9], [-2, 2.4], true);
      if (isTop && SC.demo) { Q.fill([at(1, 0.55), at(4.57, 0.55), at(4.57, 1), at(1, 1)].map(p => [p[0] * s, p[1]]), F.gloss('#16254a')); Q.fill([at(1, 0.5), at(4.57, 0.5), at(4.57, 0.55), at(1, 0.55)].map(p => [p[0] * s, p[1]]), F.gloss('#c81e2c')); }
      const ln = (pts, op) => Q.line(pts.map(p => [p[0] * s, p[1]]), op);
      // spars / ribs / control surface gaps
      for (const f of [0.3, 0.5, 0.64]) ln([at(1.0, f), at(4.57, f)], { px: 1, depth: 0.35, dark: 0.15 });
      for (const x of [1.6, 2.3, 3.0, 3.62, 4.1]) ln([at(x, 0.02), at(x, 0.99)], { px: 1, depth: 0.35, dark: 0.15 });
      const hTE = (x) => wg.lines.hingeTE.at(wg.spanToU(x)), hLE = (x) => wg.lines.hingeLE.at(wg.spanToU(x));
      ln([at(1.17, hTE(1.17)), at(3.62, hTE(3.62)), at(3.62, 1)], { px: 2, depth: 0.8, dark: 0.55 });
      ln([at(1.17, hTE(1.17)), at(1.17, 1)], { px: 2, depth: 0.8, dark: 0.55 });
      ln([at(1.17, 0), at(1.17, hLE(1.17)), at(4.57, hLE(4.57))], { px: 2, depth: 0.8, dark: 0.55 });
      for (const f of [0.3, 0.5, 0.64]) for (let i = 0; i < 2; i++) { const a = at(1.05, f + 0.012 * (i ? 1 : -1)), b = at(4.5, f + 0.012 * (i ? 1 : -1)); Q.rivets(a[0] * s, a[1], b[0] * s, b[1], 0.03, { px: 1.2, depth: 0.16, dark: 0.045 }); }
      // leading-edge wear, tonal variation, hinge-line grime
      const le = [at(1.2, 0.006), at(4.55, 0.006)].map(p => [p[0] * s, p[1]]);
      if (!SC.demo) Q.wear((g) => { g.moveTo(le[0][0], le[0][1]); g.lineTo(le[1][0], le[1][1]); }, 0.03, { color: '#9a9ea2', rough: 0.4, metal: 0.6 }, { alpha: 0.35 });
      Q.noise({ alpha: 0.1, scale: 1.2, stretch: [1, 2.5], rough: 0.06 });
      for (let i = 0; i < 9; i++) { const x = 1.3 + rnd() * 2.2, a = at(x, hTE(x)); Q.streak(a[0] * s, a[1], a[0] * s, a[1] + 0.25 + rnd() * 0.3, 0.03, { alpha: 0.18 }); }
      // markings
      if (!SC.demo) {
        if (isTop && key === 'L') Q.decal(-3.0, 0.75, (g) => K.drawStarBar(g, 0.5, { lowVis }));
        if (!isTop && key === 'R') Q.decal(3.0, 0.75, (g) => K.drawStarBar(g, 0.5, { lowVis }));
      } else if (!isTop) Q.text(key === 'L' ? 'SKY' : 'WARD', s * 2.7, 0.6, 0.55, { color: '#16254a', font: K.FONT.wide, rot: s > 0 ? 90 : -90 });
      if (isTop) { Q.fill((g) => g.rect(s > 0 ? 4.3 : -4.55, at(4.4, 0.3)[1], 0.25, 0.05), slime); const p = at(1.5, 0.45); Q.text('NO STEP', p[0] * s, p[1], 0.045, { color: SC.demo ? '#16254a' : '#2b2e31' }); }
    }
  }
  // ================= tailplanes =================
  for (const [chart, f, isTop, sx] of [[cST.R, top, true, 1], [cST.L, top, true, -1], [cSB, under, false, 1]]) {
    const Q = atlas.pen(chart); Q.fill('all', f);
    if (isTop && SC.splinter) splinter(Q, SC, rnd, [sx > 0 ? 0.9 : -2.85, sx > 0 ? 2.85 : -0.9], [3.9, 6.45], true);
    if (isTop && SC.demo) Q.fill((g) => g.rect(sx > 0 ? 0.9 : -2.85, 5.75, 1.95, 0.7), F.gloss('#16254a'));
    for (const zz of [4.9, 5.5, 5.95]) Q.line([[sx * 0.95, zz], [sx * 2.8, zz + (6.2 - zz) * 0.15]], { px: 1, depth: 0.35, dark: 0.15 });
    for (const x of [1.4, 1.9, 2.4]) Q.line([[sx * x, 3.9], [sx * x, 6.45]], { px: 1, depth: 0.3, dark: 0.13 });
    Q.noise({ alpha: 0.1, scale: 1.0, stretch: [1, 2], rough: 0.06 });
  }
  // ================= fin =================
  for (const key of ['L', 'R']) {
    const Q = atlas.pen(cFin[key]); Q.fill('all', paintF(SC.fin));
    if (SC.splinter) splinter(Q, SC, rnd, [2.1, 6.12], [0.75, 3.4], true);
    const at = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    const hz = (y) => fin.lines.hinge.at(fin.spanToU(y));
    Q.line([at(1.28, 1), at(1.28, hz(1.28)), at(3.12, hz(3.12)), at(3.12, 1)], { px: 2, depth: 0.8, dark: 0.55 });
    for (const y of [1.3, 1.9, 2.5, 3.05]) Q.line([at(y, 0.02), at(y, hz(y))], { px: 1, depth: 0.35, dark: 0.15 });
    for (const f of [0.25, 0.5]) Q.line([at(0.85, f), at(3.3, f)], { px: 1, depth: 0.35, dark: 0.15 });
    // fin cap band, tail code, serial, formation light
    Q.fill([at(3.12, 0), at(3.33, 0), at(3.33, 1), at(3.12, 1)], paintF(SC.tip));
    const c = at(2.3, 0.36), code = SC.demo ? '#f1f1ee' : mark;
    Q.text(SC.code, c[0], c[1], SC.demo ? 0.36 : 0.42, { color: code, font: SC.demo ? K.FONT.wide : K.FONT.sans, weight: 700, italic: !!SC.demo });
    const d = at(1.66, 0.4);
    Q.text(SC.serial, d[0], d[1], 0.2, { color: code, weight: 700 });
    if (!SC.demo) Q.text('AF', d[0] - 0.72, d[1] + 0.06, 0.07, { color: code, weight: 700 });
    if (SC.demo) { Q.fill([at(0.8, 0), at(1.15, 0), at(1.15, 1), at(0.8, 1)], F.gloss('#c81e2c')); }
    const fl = at(2.92, 0.5); Q.fill((g) => g.rect(fl[0] - 0.25, fl[1] - 0.03, 0.5, 0.06), slime);
    Q.noise({ alpha: 0.09, scale: 1.2, stretch: [1, 1.5], rough: 0.05 });
  }
  // ================= instrument panel =================
  {
    const Q = atlas.pen(cPanel); Q.fill('all', { color: '#17191b', rough: 0.6, metal: 0 });
    const scr = (a, b, w, h, col) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#050607', rough: 0.15, metal: 0 }); Q.fill((g) => g.rect(a + 0.008, b + 0.008, w - 0.016, h - 0.016), { color: col, rough: 0.12, metal: 0, emissive: col }); };
    scr(0.1, 0.2, 0.17, 0.17, '#0c2a14'); scr(0.53, 0.2, 0.17, 0.17, '#0c2a14'); scr(0.33, 0.05, 0.14, 0.09, '#1a2a12');
    for (let i = 0; i < 5; i++) Q.fill((g) => { g.arc(0.3 + (i % 3) * 0.1, 0.24 + Math.floor(i / 3) * 0.1 + 0.02, 0.036, 0, Math.PI * 2); }, { color: '#0b0c0d', rough: 0.2, metal: 0 });
    for (let i = 0; i < 5; i++) Q.stroke((g) => { g.arc(0.3 + (i % 3) * 0.1, 0.24 + Math.floor(i / 3) * 0.1 + 0.02, 0.03, 0, Math.PI * 2); }, 0.003, { color: '#9a9c9a' });
    for (let i = 0; i < 12; i++) Q.fill((g) => g.rect(0.12 + i * 0.05, 0.47, 0.03, 0.02), { color: i % 3 ? '#3a3c3e' : '#7a6a2a', rough: 0.5, metal: 0 });
  }
}

/** Hard-edged splinter camouflage: random convex shards over a chart region. */
function splinter(P, SC, rnd, ar, br, planar) {
  const cols = SC.splinter, n = planar ? 9 : 26, F = K.FINISH;
  for (let i = 0; i < n; i++) {
    const a = ar[0] + rnd() * (ar[1] - ar[0]), b = br[0] + rnd() * (br[1] - br[0]), la = (ar[1] - ar[0]) * (planar ? 0.4 : 0.16), lb = (br[1] - br[0]) * (planar ? 0.4 : 0.3);
    const ang = rnd() * Math.PI, pts = [];
    const k = 3 + Math.floor(rnd() * 2);
    for (let j = 0; j < k; j++) { const q = ang + j / k * Math.PI * 2 + rnd() * 0.6, r = 0.5 + rnd() * 0.6; pts.push([a + Math.cos(q) * la * r, b + Math.sin(q) * lb * r]); }
    P.fill(pts, F.semigloss(cols[i % cols.length]));
  }
}
