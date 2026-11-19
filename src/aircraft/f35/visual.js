// F-35A Lightning II — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (-1.6) when parked.
//
// Reference numbers (docs/aircraft/f35.md, body z = d - 9.25):
//   length 15.67 m (nose z -9.25 … stabilator TE z 6.42), span 10.7 m, height 4.38 m (fin tips at y 2.78).
//   Fuselage: flat-bottomed chined body, belly y ≈ -0.65, chine ≈ y 0.1…0.25, spine 0.85…1.0 behind the canopy,
//   max half-width 1.5 at the wing root (z ≈ 0.6). Nose tip at y 0.10, sharp chines from the tip.
//   Wing: root (x 0.95) LE z -2.05, chord 5.5; tip (x 5.35) LE z 0.81, chord 1.5 → LE sweep 33°, TE sweep -14.5°,
//         ~5 % thick, mid-set at y ≈ 0. LE flaps full span, one flaperon per side (x 1.45 … 4.3).
//   Stabilators: root x 1.15 LE z 3.45 chord 2.95, tip x 3.05 LE z 4.78 chord 1.0, pivot z 4.95, y 0.08.
//   Fins: canted 20° out, root x ±1.05 y 0.3 LE z 2.45 chord 3.3, tip y 2.78 LE z 4.28 chord 1.15; rudders 32 % chord.
//   Intakes: DSI bump on the cheek, lip at z ≈ -3.45 (outer corner swept forward to ≈ -3.8), aperture ≈ 0.55 × 0.72 m.
//   Nozzle: single axisymmetric, hinge ring z 5.0 (r 0.6), exit z 5.75, exit r 0.44 closed … 0.55 open, 15 serrated petals.
//   Gear: nose [0, -1.6, -5.1] r 0.2 (single wheel, retracts forward); mains [±1.6, -1.6, 0.5] r 0.33 (forward + inward,
//         wheel turned flat). Canopy hinged at the front (z -6.45), eye [0, 0.85, -5.35].
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['usaf', 'lowvis', 'raaf'];

const SCHEMES = {
  usaf: { name: 'USAF 388th FW (HL)', skin: '#666a6d', tape: '#777c7f', mark: '#3e4245', code: 'HL', serial: 'AF 19-5427', unit: '388 FW', star: 'usaf', tip: '#2c2f31' },
  lowvis: { name: 'Low-visibility (sanitised)', skin: '#5d6063', tape: '#696d70', mark: '#4a4e51', code: '', serial: '5481', unit: '', star: 'usaf', tip: null },
  raaf: { name: 'RAAF No. 3 Sqn', skin: '#64686b', tape: '#75797c', mark: '#3c4043', code: '', serial: 'A35-052', unit: '3SQN', star: 'raaf', tip: null },
};

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'usaf', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const ramF = (c) => ({ color: c, rough: 0.55, metal: 0.12 }), skinF = ramF(SC.skin);
  const seg = Math.max(32, Math.round(72 * detail / 4) * 4);

  // ---- atlas ------------------------------------------------------------------------------------------------------------
  const atlas = K.createAtlas({ size: atlasSize, base: skinF });
  const cFus = atlas.chart('fus', { type: 'unwrap', z: [-9.25, 5.05], girth: 7.4, vScale: 0.9, strips: 2 });
  const cWT = { R: atlas.chart('wingTopR', { type: 'plan', x: [0.95, 5.4], z: [-2.1, 3.5], view: 'top' }), L: atlas.chart('wingTopL', { type: 'plan', x: [-5.4, -0.95], z: [-2.1, 3.5], view: 'top' }) };
  const cWB = { R: atlas.chart('wingBotR', { type: 'plan', x: [0.95, 5.4], z: [-2.1, 3.5], view: 'bottom', density: 0.7 }), L: atlas.chart('wingBotL', { type: 'plan', x: [-5.4, -0.95], z: [-2.1, 3.5], view: 'bottom', density: 0.7 }) };
  const cST = atlas.chart('stabTop', { type: 'plan', x: [1.1, 3.1], z: [3.4, 6.45], view: 'top', mirror: true, density: 0.85 });
  const cSB = atlas.chart('stabBot', { type: 'plan', x: [1.1, 3.1], z: [3.4, 6.45], view: 'bottom', mirror: true, density: 0.65 });
  const finSpec = (view, density = 1) => ({ type: 'side', z: [2.35, 5.85], y: [0.7, 2.82], view, density });
  const cFin = { RO: atlas.chart('finRO', finSpec('right')), LO: atlas.chart('finLO', finSpec('left')), RI: atlas.chart('finRI', finSpec('left', 0.6)), LI: atlas.chart('finLI', finSpec('right', 0.6)) };
  const cBoom = atlas.chart('boom', { type: 'unwrap', z: [1.2, 6.2], girth: 1.6, vScale: 1, density: 0.8 });
  const cPanel = atlas.chart('panel', { type: 'rect', w: 0.72, h: 0.3, density: 3 });
  const cNoz = atlas.chart('nozzle', { type: 'rect', w: 3.8, h: 0.75, density: 0.8 });
  atlas.pack();
  const U = {
    skin: atlas.swatch('skin', skinF), tape: atlas.swatch('tape', ramF(SC.tape)), duct: atlas.swatch('duct', F.gloss('#e2e3df')),
    dark: atlas.swatch('dark', F.darkGrey), black: atlas.swatch('black', F.black), exhaust: atlas.swatch('exhaust', F.exhaust),
    heat: atlas.swatch('heat', { color: '#7a746e', rough: 0.5, metal: 0.75 }), heat2: atlas.swatch('heat2', { color: '#3e3a37', rough: 0.55, metal: 0.8 }),
    ceramic: atlas.swatch('ceramic', { color: '#b9b2a6', rough: 0.6, metal: 0.1 }),
    well: atlas.swatch('well', F.gearWhite), interior: atlas.swatch('interior', { color: '#34383b', rough: 0.75, metal: 0 }), console: atlas.swatch('console', { color: '#1b1d1f', rough: 0.6, metal: 0 }),
    seat: atlas.swatch('seat', { color: '#232628', rough: 0.7, metal: 0 }), cushion: atlas.swatch('cushion', { color: '#2e3130', rough: 0.95, metal: 0 }), accent: atlas.swatch('accent', { color: '#d6b21e', rough: 0.5, metal: 0 }),
    suit: atlas.swatch('suit', { color: '#4d5540', rough: 0.9, metal: 0 }), helmet: atlas.swatch('helmet', { color: '#2b2d2f', rough: 0.4, metal: 0.1 }), visor: atlas.swatch('visor', { color: '#0a0b0d', rough: 0.05, metal: 0.5 }),
    glove: atlas.swatch('glove', { color: '#3a3d33', rough: 0.9, metal: 0 }), frame: atlas.swatch('frame', F.ram('#4a4e51')), steel: atlas.swatch('steel', F.steel),
    eots: atlas.swatch('eots', { color: '#2a2418', rough: 0.04, metal: 0.65 }), lens: atlas.swatch('lens', F.lens),
  };

  const rig = K.createRig(ctx, { geometry: G, name: 'f35', glassLayer: opts.glassLayer });
  rig.material('paint', null);
  const stat = new K.Mesh();

  // ---- fuselage: chined, flat-bottomed body (sharp chine = side point with aTop/aBot < 90°) ----------------------------------
  //        z      yc     w      top    bot    kTop  kBot  aTop aBot
  const FS = [
    [-9.25, 0.150, 0.000, 0.000, 0.000, 0.5, 0.45, 30, 26],
    [-9.05, 0.150, 0.050, 0.050, 0.050, 0.5, 0.45, 30, 26],
    [-8.70, 0.150, 0.140, 0.160, 0.160, 0.52, 0.47, 32, 28],
    [-8.10, 0.160, 0.270, 0.330, 0.310, 0.55, 0.5, 34, 30],
    [-7.40, 0.180, 0.410, 0.510, 0.480, 0.58, 0.55, 36, 34],
    [-6.70, 0.210, 0.560, 0.650, 0.670, 0.6, 0.6, 38, 40],
    [-6.00, 0.250, 0.710, 0.710, 0.830, 0.62, 0.64, 38, 42],
    [-5.20, 0.300, 0.870, 0.780, 0.980, 0.64, 0.68, 36, 40],
    [-4.40, 0.350, 1.030, 0.950, 1.100, 0.66, 0.7, 34, 22],
    [-3.70, 0.380, 1.180, 1.040, 1.170, 0.66, 0.66, 32, 12],
    [-3.00, 0.350, 1.360, 1.010, 1.160, 0.64, 0.7, 30, 16],
    [-2.20, 0.260, 1.450, 1.000, 1.080, 0.62, 0.85, 28, 56],
    [-1.00, 0.160, 1.490, 0.990, 0.980, 0.6, 0.88, 26, 68],
    [0.60, 0.100, 1.500, 0.980, 0.920, 0.6, 0.88, 24, 72],
    [2.00, 0.100, 1.450, 0.910, 0.890, 0.6, 0.86, 26, 72],
    [3.20, 0.100, 1.300, 0.820, 0.820, 0.66, 0.8, 30, 72],
    [4.20, 0.100, 1.080, 0.740, 0.700, 0.68, 0.72, 38, 70],
    [5.00, 0.100, 0.640, 0.620, 0.620, 0.5523, 0.5523, 90, 90],
  ].map(r => ({ z: r[0], y: r[1], w: r[2], top: r[3], bot: r[4], kTop: r[5], kBot: r[6], aTop: r[7], aBot: r[8] }));
  const T_SILL = 0.385, T_NG = 0.05, T_MLG = [0.07, 0.16];
  const fus = K.loft({
    stations: FS, segments: seg, step: 0.11 / detail, chart: cFus, creases: ['side'], capEnd: 'flat', capUV: U.exhaust,
    cutouts: [
      { name: 'cockpit', z: [-6.45, -3.5], t: [T_SILL, 1 - T_SILL] },
      { name: 'ng', z: [-6.15, -4.75], t: [0, T_NG], mirror: true },
      { name: 'mlg', z: [-0.95, 0.5], t: T_MLG, mirror: true },
    ],
  });
  cFus.body = fus;
  bulge(fus.mesh, { z: -3.78, y: -0.1, lz: 0.85, ly: 0.36, amp: 0.13 });   // DSI bump on the cheeks, ahead of the inlet
  stat.add(fus.mesh);

  // ---- tail booms (carry the fins and stabilators either side of the nozzle) ---------------------------------------------------
  const BX = 1.0, BS = (z, y, w, top, bot, extra) => ({ z, x: BX, y, w, top, bot, kTop: [0.86, 0.8], kBot: [0.8, 0.74], aTop: 55, aBot: 80, ...extra });
  const boom = K.loft({
    stations: [
      BS(2.0, 0.4, 0.05, 0.05, 0.05), BS(2.8, 0.38, 0.27, 0.36, 0.32), BS(3.8, 0.37, 0.31, 0.39, 0.37), BS(5.0, 0.36, 0.29, 0.36, 0.36),
      BS(5.7, 0.3, 0.2, 0.22, 0.22), BS(6.15, 0.18, 0.02, 0.02, 0.02),
    ],
    segments: Math.max(16, Math.round(24 * detail / 4) * 4), step: 0.25, chart: cBoom, creases: ['side'],
  });
  stat.add(boom.mesh).add(boom.mesh.clone().mirrorX());

  // ---- canopy (one-piece, forward hinged, thick bow frame) ---------------------------------------------------------------------
  const CZ0 = -6.45, CZ1 = -3.5;
  const canTop = K.pchip([-6.45, -6.2, -5.95, -5.65, -5.35, -5.05, -4.7, -4.35, -4.0, -3.75, -3.5], [fus.topAt(-6.45) + 0.005, 1.07, 1.24, 1.405, 1.515, 1.575, 1.595, 1.585, 1.545, 1.48, fus.topAt(-3.5) + 0.012]);
  const canZ = []; for (let z = CZ0; z < CZ1 - 1e-6; z += 0.15) canZ.push(z); canZ.push(CZ1);
  const canSt = canZ.map(z => { const s = fus.at(z, T_SILL).p; return { z, y: s[1], w: s[0], top: Math.max(0.004, canTop(z) - s[1]), bot: 0.01, kTop: [0.7, 0.62] }; });
  const cseg = Math.max(16, Math.round(32 * detail / 4) * 4), ct = 1 / cseg;
  const canLoft = (zr, tr, inflate, uv, extra = {}) => K.loft({ stations: canSt, segments: cseg, step: 0.1, tRange: tr, zRange: zr, inflate, uv, ...extra }).mesh;
  const glassMove = canLoft([CZ0, CZ1], [0.25, 0.75], 0, [0, 0]);
  const frameMove = K.merge(
    canLoft([CZ0, CZ1], [0.25, 0.25 + ct * 1.5], 0.006, U.frame), canLoft([CZ0, CZ1], [0.75 - ct * 1.5, 0.75], 0.006, U.frame),
    canLoft([-5.68, -5.55], [0.25, 0.75], 0.012, U.frame),                       // bow frame
    canLoft([CZ0, CZ0 + 0.05], [0.25, 0.75], 0.006, U.frame),                    // windscreen base strip
    canLoft([CZ1 - 0.16, CZ1], [0.25, 0.75], 0.007, U.frame, { capEnd: 'flat', capUV: U.frame }),   // aft arch closing onto the spine
  );

  // ---- cockpit -----------------------------------------------------------------------------------------------------------------
  const eye = G.pilotEye, tubX = 0.42;
  stat.add(K.tub({ x: tubX, y0: 0.17, y1: 0.85, z0: -6.35, z1: -3.6, uv: U.interior, taper: 0.8 }));
  {  // sill ledge between the skin cut-out and the tub
    const zs = []; for (let z = CZ0; z <= CZ1 + 1e-6; z += 0.2) zs.push(z); if (zs[zs.length - 1] < CZ1 - 1e-6) zs.push(CZ1);
    for (const sx of [1, -1]) {
      let prev = null;
      for (const z of zs) {
        const o = fus.at(z, sx > 0 ? T_SILL : 1 - T_SILL).p, a = stat.vert(o[0], o[1], z, -sx * 0.6, 0.8, 0, U.interior[0], U.interior[1]), b = stat.vert(sx * tubX * 0.92, 0.83, z, -sx * 0.6, 0.8, 0, U.interior[0], U.interior[1]);
        if (prev) { if (sx > 0) stat.quad(prev[0], a, b, prev[1]); else stat.quad(prev[0], prev[1], b, a); }
        prev = [a, b];
      }
    }
  }
  {  // wide flat glare shield over the panoramic display
    const gs = K.prism([[-6.32, 0.77], [-6.32, 0.91], [-5.95, 1.005], [-5.86, 1.0], [-5.86, 0.96], [-5.9, 0.77]], -0.34, 0.34, U.black);
    for (let i = 0; i < gs.p.length; i += 3) gs.p[i] *= 0.62 + 0.38 * Math.min(1, (gs.p[i + 2] + 6.32) / 0.46);
    stat.add(gs);
  }
  {  // one large panoramic cockpit display (painted chart, emissive), side consoles, side stick, throttle
    const z = -5.9, i0 = stat.vertexCount, q = [[-0.3, 0.72], [0.3, 0.72], [0.3, 0.98], [-0.3, 0.98]];
    for (const p of q) { const uv = cPanel.uv((p[0] + 0.3) * 1.2, (0.98 - p[1]) / 0.26 * 0.3); stat.vert(p[0], p[1], z + (0.98 - p[1]) * 0.25, 0, 0.24, 1, uv[0], uv[1]); }
    stat.quad(i0, i0 + 1, i0 + 2, i0 + 3);
    stat.add(K.box(0.62, 0.5, 0.08, U.console).translate(0, 0.47, -5.93));
    for (const sx of [-1, 1]) stat.add(K.box(0.14, 0.12, 1.3, U.console).translate(sx * 0.33, 0.63, -4.95));
    stat.add(K.stick({ base: [0.33, 0.69, -4.98], height: 0.14, uv: U.black, uvGrip: U.dark }));
    stat.add(K.box(0.06, 0.08, 0.12, U.dark).translate(-0.33, 0.73, -5.0));
  }
  stat.add(K.ejectionSeat({ eye, recline: 18, uv: { frame: U.seat, cushion: U.cushion, accent: U.accent } }));
  const pilotMesh = K.pilot({ eye, recline: 16, stick: [0.32, -0.42, 0.25], throttle: [-0.33, -0.39, 0.25], uv: { suit: U.suit, helmet: U.helmet, visor: U.visor, dark: U.dark, glove: U.glove } });
  for (const sx of [-1, 1]) pilotMesh.add(K.box(0.06, 0.05, 0.05, U.dark).translate(sx * 0.11, eye[1] + 0.05, eye[2] + 0.02));   // HMD tracker blocks

  // ---- DSI intakes: fold-over loft (duct → lip → cowl), sheared so the lips sweep forward, plus the cheek bump ----------------
  const IX = 0.95, IY = -0.14;
  const IS = (z, w, top, bot, extra) => ({ z, x: IX, y: IY, w, top, bot, kTop: [0.93, 0.88], kBot: [0.9, 0.84], ...extra });
  const intake = K.loft({
    stations: [
      IS(-1.7, 0.21, 0.3, 0.3, { x: 0.74, y: -0.14 }), IS(-2.6, 0.25, 0.39, 0.39, { x: 0.9, y: -0.17 }), IS(-3.33, 0.262, 0.41, 0.415, { hard: true }),
      IS(-3.43, 0.272, 0.42, 0.425), IS(-3.46, 0.285, 0.433, 0.438), IS(-3.43, 0.298, 0.446, 0.451),
      IS(-3.3, 0.306, 0.47, 0.459, { kTop: [0.97, 0.9] }), IS(-2.8, 0.316, 0.5, 0.467, { kTop: [0.98, 0.9] }), IS(-2.0, 0.322, 0.52, 0.47, { kTop: [0.98, 0.9] }), IS(-1.5, 0.322, 0.52, 0.47, { kTop: [0.98, 0.9] }),
    ],
    segments: Math.max(24, Math.round(40 * detail / 4) * 4), step: 0.14, capStart: 'flat', capUV: U.black,
    uvFn: (x, y, z, t, ring) => (ring.run === 0 ? (ring.k < 1.6 ? U.duct : U.skin) : ring.k < 4.3 ? U.tape : U.skin),
  });
  const shear = new THREE.Matrix4().set(1, 0.25, 0, -0.25 * IY, 0, 1, 0, 0, -0.38, -0.25, 1, 0.38 * 0.7 + 0.25 * IY, 0, 0, 0, 1);
  const intakeR = intake.mesh.transform(shear);
  stat.add(intakeR).add(intakeR.clone().mirrorX());

  // ---- wings ---------------------------------------------------------------------------------------------------------------------
  const zLE = (x) => -2.05 + (x - 0.95) * Math.tan(33 * DEG), zTE = (x) => 3.45 - (x - 0.95) * 0.259;
  const WTIP = 5.35;
  const mkWing = (side) => K.wing({
    side, airfoil: K.naca6(0.05, 0.006), chordPts: Math.round(12 * detail), spanAxis: 'x', tip: 'flat',
    stations: [{ x: 1.0, y: 0.0, z: zLE(1.0), chord: zTE(1.0) - zLE(1.0), tc: 0.052 }, { x: WTIP, y: 0.03, z: zLE(WTIP), chord: zTE(WTIP) - zLE(WTIP), tc: 0.04, twist: -2 }],
    lines: { hingeTE: [[1.45, 0.83], [4.3, 0.72], [WTIP, 0.72]], hingeLE: [[1.45, 0.11], [WTIP, 0.22]] },
    controls: [
      { name: 'flaperon', type: 'flap', span: [1.45, 4.3], from: 'hingeTE', nose: 1 },
      { name: 'lef', type: 'flap', span: [1.5, 5.3], to: 'hingeLE', tail: 1 },
    ],
    charts: { upper: side > 0 ? cWT.R : cWT.L, lower: side > 0 ? cWB.R : cWB.L },
  });
  const W = { R: mkWing(1), L: mkWing(-1) };
  stat.add(W.R.mesh).add(W.L.mesh);

  // ---- stabilators and canted fins -----------------------------------------------------------------------------------------------
  const STY = 0.08, ST = { x0: 1.15, x1: 3.05, z0: 3.45, c0: 2.95, c1: 1.0, pivot: 4.95 };
  const stLE = (x) => ST.z0 + (x - ST.x0) * Math.tan(35 * DEG);
  const mkStab = (side) => K.wing({
    side, airfoil: K.biconvex(0.045), chordPts: Math.round(9 * detail), spanAxis: 'x', tip: 'flat', root: 'flat',
    stations: [{ x: ST.x0, y: STY, z: ST.z0, chord: ST.c0, tc: 0.045 }, { x: ST.x1, y: STY, z: stLE(ST.x1), chord: ST.c1, tc: 0.035 }],
    charts: { upper: cST, lower: cSB },
  });
  const stab = { R: mkStab(1), L: mkStab(-1) };
  const CANT = 20 * DEG, FIN = { x0: 1.05, y0: 0.78, z0: 2.45, c0: 3.3, c1: 1.3, len: (2.78 - 0.78) / Math.cos(20 * DEG) };
  const finAt = (u) => [FIN.x0 + u * Math.sin(CANT), FIN.y0 + u * Math.cos(CANT), FIN.z0 + u * Math.tan(35 * DEG)];
  const mkFin = (side) => {
    const a = finAt(0), b = finAt(FIN.len);
    return K.wing({
      side, airfoil: K.biconvex(0.045), chordPts: Math.round(10 * detail), spanAxis: 'u', tip: 'flat',
      stations: [{ x: a[0], y: a[1], z: a[2], chord: FIN.c0, tc: 0.045 }, { x: b[0], y: b[1], z: b[2], chord: FIN.c1, tc: 0.03 }],
      lines: { hinge: [[0.12, 0.67], [FIN.len - 0.08, 0.64]] },
      controls: [{ name: 'rudder', type: 'flap', span: [0.12, FIN.len - 0.08], from: 'hinge', nose: 1 }],
      charts: side > 0 ? { upper: cFin.RI, lower: cFin.RO } : { upper: cFin.LI, lower: cFin.LO },
    });
  };
  const fins = { R: mkFin(1), L: mkFin(-1) };
  stat.add(fins.R.mesh).add(fins.L.mesh);

  // ---- nozzle (serrated petals), jet pipe, afterburner glow ------------------------------------------------------------------------
  const NZ = { c: [0, 0.1, 0], z0: 4.98, z1: 5.75, petals: 15 };
  const nozzleMesh = K.petalNozzle({ z0: NZ.z0, z1: NZ.z1, r0: 0.635, rClosed: 0.44, rOpen: 0.55, petals: NZ.petals, centre: NZ.c, uvOuter: U.heat, uvInner: U.heat2, thickness: 0.03, gap: 0.04, chart: cNoz });
  serrate(nozzleMesh, NZ, 0.13);
  stat.add(K.lathe([[0.6, 5.02], [0.54, 4.6], [0.52, 4.2], [0, 4.2]], { segments: 28, uv: U.exhaust }).translate(0, NZ.c[1], 0));
  for (let i = 0; i < 14; i++) stat.add(K.box(0.03, 0.5, 0.05, U.heat2).translate(0, 0.25, 0).rotateZ(i * Math.PI / 7).translate(0, NZ.c[1], 4.4));
  stat.add(K.lathe([[0.18, 4.32], [0.18, 4.42], [0.15, 4.42], [0.15, 4.32]], { segments: 20, uv: U.heat2 }).translate(0, NZ.c[1], 0));
  const glowMesh = K.afterburnerGlow({ zDeep: 4.45, zExit: 5.55, rDeep: 0.5, rExit: 0.42, centre: NZ.c });

  // ---- EOTS: faceted sapphire window under the chin --------------------------------------------------------------------------------
  {
    const zc = -6.55, yb = fus.botAt(zc) + 0.02, m = new K.Mesh();
    const Fp = [0, yb, -6.98], Rp = [0, yb, -6.12], Lp = [-0.16, yb, -6.5], Rr = [0.16, yb, -6.5];
    const B1 = [-0.085, yb - 0.085, -6.66], B2 = [0.085, yb - 0.085, -6.66], B3 = [0.085, yb - 0.085, -6.42], B4 = [-0.085, yb - 0.085, -6.42];
    const c = [0, yb - 0.03, -6.54];
    for (const [pts, uv] of [[[B1, B2, B3, B4], U.eots], [[Fp, B2, B1], U.eots], [[Fp, Rr, B2], U.eots], [[Fp, B1, Lp], U.eots], [[Rp, B4, B3], U.skin], [[Rp, B3, Rr], U.skin], [[Rp, Lp, B4], U.skin], [[Rr, B3, B2], U.eots], [[Lp, B1, B4], U.eots]]) facet(m, pts, c, uv);
    stat.add(m);
  }

  // ---- small details: flush antennas, air-data probes, refuelling door lip ------------------------------------------------------------
  for (const sx of [1, -1]) stat.add(K.probe([sx * 0.3, fus.at(-7.9, sx > 0 ? 0.3 : 0.7).p[1], -7.9], [sx * 0.33, fus.at(-7.9, sx > 0 ? 0.3 : 0.7).p[1] + 0.01, -8.02], 0.008, U.steel));
  stat.add(K.bladeAntenna({ pos: [0, fus.botAt(-1.2) + 0.01, -1.2], height: 0.09, chord: 0.22, sweep: 0.08, down: true, uv: U.skin }));
  stat.add(K.bladeAntenna({ pos: [0, fus.topAt(0.8) - 0.01, 0.8], height: 0.07, chord: 0.2, sweep: 0.08, uv: U.skin }));

  // ---- gear wells ----------------------------------------------------------------------------------------------------------------
  const P = fus.patches;
  stat.add(K.well(P.mlgR, 0.36, U.well, [0, 1, 0])).add(K.well(P.mlgL, 0.36, U.well, [0, 1, 0]));
  stat.add(K.well(K.merge(P.ngR, P.ngL), 0.42, U.well, [0, 1, 0]));

  // ---- paint + materials -----------------------------------------------------------------------------------------------------------
  lap('geometry');
  paint(atlas, { SC, livery, fus, W, fins, FIN, finAt, cFus, cWT, cWB, cST, cSB, cFin, cBoom, cPanel, cNoz, skinF, NZ });
  lap('paint');
  const mat = atlas.material(ctx, { envMapIntensity: 1 });
  lap('textures');
  rig.material('paint', mat, { shared: true });
  rig.disposables.push(atlas);
  rig.glass('canopy', K.glassMaterial(ctx, { ...K.GLASS.gold, tint: '#6a5426', opacity: 0.2, edgeOpacity: 0.78 }));
  const glow = rig.material('glow', K.glowMaterial(), { shadow: false });
  rig.addStatic(stat, 'paint');

  // ---- moving parts ------------------------------------------------------------------------------------------------------------------
  const hingeY = fus.at(CZ0, T_SILL).p[1] + 0.06;
  const canopyNode = rig.node('canopy', { pivot: [0, hingeY, CZ0 - 0.02] });
  rig.part('canopyGlass', glassMove, { parent: canopyNode, key: 'canopy' });
  rig.part('canopyFrame', frameMove, { parent: canopyNode });
  const setCanopy = rig.hinge(canopyNode, [-1, hingeY, CZ0 - 0.02], [1, hingeY, CZ0 - 0.02], { ref: [0, 1.0, CZ1], toward: [0, 1, 0] });
  const pilotNode = rig.part('pilot', pilotMesh, { pivot: eye });

  const flR = rig.hingePart('flaperonR', W.R.controls.flaperon), flL = rig.hingePart('flaperonL', W.L.controls.flaperon);
  const lefR = rig.hingePart('lefR', W.R.controls.lef), lefL = rig.hingePart('lefL', W.L.controls.lef);
  const rudR = rig.hingePart('rudderR', fins.R.controls.rudder, { toward: [1, 0, 0] }), rudL = rig.hingePart('rudderL', fins.L.controls.rudder, { toward: [1, 0, 0] });
  const mkStabPart = (name, s, sx) => {
    const a = [sx * ST.x0, STY, ST.pivot], b = [sx * ST.x1, STY, ST.pivot];
    const node = rig.part(name, s.mesh, { pivot: a });
    return rig.hinge(node, a, b, { ref: [sx * 2.0, STY, 6.1], toward: [0, 1, 0] });
  };
  const setStabR = mkStabPart('stabR', stab.R, 1), setStabL = mkStabPart('stabL', stab.L, -1);
  const nozzle = rig.part('nozzle', nozzleMesh, { pivot: [0, NZ.c[1], NZ.z0] });
  rig.part('abGlow', glowMesh, { key: 'glow' });
  const HK = [0, -0.68, 3.2];
  const hookMesh = K.arrestorHook({ pivot: HK, length: 1.7, radius: 0.03, uv: U.steel, uvShoe: U.dark });
  hookMesh.translate(0, -HK[1], -HK[2]).transform(new THREE.Matrix4().makeRotationX(-5 * DEG)); hookMesh.translate(0, HK[1], HK[2]);
  const hookNode = rig.part('hook', hookMesh, { pivot: HK });
  const setHook = rig.hinge(hookNode, [-1, HK[1], HK[2]], [1, HK[1], HK[2]], { ref: [0, HK[1], HK[2] + 1.8], toward: [0, -1, 0] });

  // ---- landing gear ----------------------------------------------------------------------------------------------------------------
  const gp = G.gear;
  const doorOf = (patch, edge) => ({ mesh: K.thicken(patch, 0.02, U.well), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  K.buildGear(rig, atlas, {
    name: 'nose', index: 0, contact: gp[0].pos, wheelRadius: gp[0].wheelRadius, wheelWidth: 0.15, pivot: [0, -0.52, -4.92], stroke: 0.24, staticFrac: 0.35,
    strutR: 0.045, fork: 'fork', steer: true, links: 'front', retract: { to: [0, -0.4, -5.85] }, window: [0.2, 0.86],
    brace: [0, -0.55, -5.6],
    doors: [
      { name: 'noseDoorR', ...doorOf(P.ngR, fus.edges.ngR.tHi), open: 88, toward: [0, -1, 0] },
      { name: 'noseDoorL', ...doorOf(P.ngL, fus.edges.ngL.tLo), open: 88, toward: [0, -1, 0] },
    ],
    lamps: [{ kind: 'landing', pos: [-0.06, -1.02, -5.03], size: 0.04, color: [1, 0.96, 0.88] }, { kind: 'taxi', pos: [0.06, -1.02, -5.03], size: 0.036, color: [1, 0.96, 0.88] }],
  });
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, edge = fus.edges['mlg' + key];
    K.buildGear(rig, atlas, {
      name: 'main' + key, index: i, contact: c, wheelRadius: gp[i].wheelRadius, wheelWidth: 0.24,
      pivot: [sx * 1.28, -0.5, 0.3], stroke: 0.3, staticFrac: 0.35, strutR: 0.058, fork: 'axle', links: 'rear',
      retract: { to: [sx * 0.95, -0.58, -0.5], twist: sx * 90 }, window: [0.22, 0.9], brace: [sx * 1.0, -0.6, 0.0],
      doors: [{ name: 'mainDoor' + key, ...doorOf(P['mlg' + key], sx > 0 ? edge.tHi : edge.tLo), open: 100, toward: [0, -1, 0] }],
    });
  }

  // ---- lamps -------------------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.035, squash: [0.6, 0.6, 1.6] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.035, squash: [0.6, 0.6, 1.6] });
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.03 });
  rig.lamp('nav', [-L.tail[0], L.tail[1], L.tail[2]], { color: [1, 1, 1], size: 0.03 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.04, squash: [1, 0.5, 1.4] });
  rig.lamp('beacon', L.beacon, { color: [1, 0.12, 0.05], size: 0.045, squash: [1, 0.5, 1.4] });

  // ---- animation ---------------------------------------------------------------------------------------------------------------------
  rig.onUpdate((S) => {
    const sf = S.sf, e = S.eng[0] || {};
    flR.set((sf.aileronR * 20 - sf.flaps * 25) * DEG); flL.set((sf.aileronL * 20 - sf.flaps * 25) * DEG);
    const lef = Math.max(sf.slats, sf.flaps); lefR.set(-lef * 30 * DEG); lefL.set(-lef * 30 * DEG);
    setStabR(sf.elevatorR * 25 * DEG); setStabL(sf.elevatorL * 25 * DEG);
    rudR.set((sf.rudder * 25 + sf.speedbrake * 30) * DEG); rudL.set((sf.rudder * 25 - sf.speedbrake * 30) * DEG);   // speedbrake = toe-out rudders
    nozzle.morphTargetInfluences[0] = e.nozzle ?? 0;
    K.abGlowColor(glow.color, e, S.night);
    setCanopy(sf.canopy * 34 * DEG);
    setHook(sf.hook * 42 * DEG);
    pilotNode.visible = !rig.cameraInCockpit;
  });
  const visual = rig.build();
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- local geometry helpers
/** Push a lofted skin outward (±X) by a smooth bell h(z, y) on both sides and tilt the normals to match (DSI bump). */
function bulge(m, o) {
  const { p, n } = m, c2 = (u) => (Math.abs(u) >= 1 ? 0 : Math.cos(u * Math.PI / 2) ** 2), d2 = (u) => (Math.abs(u) >= 1 ? 0 : -Math.PI / 2 * Math.sin(u * Math.PI));
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (Math.abs(x) < 0.2) continue;
    const uz = (z - o.z) / o.lz, uy = (y - o.y) / o.ly, h = o.amp * c2(uz) * c2(uy);
    if (h <= 0) continue;
    const sx = Math.sign(x), hz = o.amp * d2(uz) / o.lz * c2(uy), hy = o.amp * c2(uz) * d2(uy) / o.ly;
    p[i] += sx * h;
    const nx = n[i] * sx;
    if (nx < 0.2) continue;
    const a = [1, n[i + 1] / nx - hy, n[i + 2] / nx - hz], l = Math.hypot(a[0], a[1], a[2]);
    n[i] = sx * a[0] / l; n[i + 1] = a[1] / l; n[i + 2] = a[2] / l;
  }
}
/** Flat polygon (convex, any winding) facing away from the point `c`. */
function facet(m, pts, c, uv) {
  const [a, b, d] = pts, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1; n = n.map(q => q / l);
  const mid = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0]);
  let order = pts;
  if ((mid[0] - c[0]) * n[0] + (mid[1] - c[1]) * n[1] + (mid[2] - c[2]) * n[2] < 0) { order = pts.slice().reverse(); n = n.map(q => -q); }
  const i0 = m.vertexCount;
  for (const p of order) m.vert(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]);
  for (let i = 1; i < order.length - 1; i++) m.tri(i0, i0 + i, i0 + i + 1);
}

/** Cut a saw-tooth trailing edge into a petal nozzle (and its morph target): petal centres stay, petal edges are pulled forward. */
function serrate(m, NZ, depth) {
  const TAU = Math.PI * 2, len = NZ.z1 - NZ.z0;
  const apply = (arr) => {
    for (let i = 0; i < arr.length; i += 3) {
      const u = (arr[i + 2] - NZ.z0) / len;
      if (u <= 0.3) continue;
      const a = Math.atan2(arr[i + 1] - NZ.c[1], arr[i] - NZ.c[0]), f = ((a / TAU * NZ.petals) % 1 + 1) % 1, tooth = 1 - Math.abs(f - 0.5) * 2;
      arr[i + 2] -= depth * (1 - tooth) * Math.pow((u - 0.3) / 0.7, 2);
    }
  };
  const before = m.p.slice();
  apply(m.p);
  if (m.p2) {   // shift the morph target by the same amount as the base positions
    for (let i = 0; i < m.p2.length; i += 3) m.p2[i + 2] += m.p[i + 2] - before[i + 2];
  }
}

// ---- paint ---------------------------------------------------------------------------------------------------------------------------
function paint(atlas, o) {
  const { SC, livery, fus, W, fins, FIN, finAt, cFus, cWT, cWB, cST, cSB, cFin, cBoom, cPanel, cNoz, skinF, NZ } = o, F = K.FINISH;
  const tape = { color: SC.tape, rough: 0.48, metal: 0.2, height: 0.12 };
  const mark = SC.mark;
  const rnd = (() => { let a = 4242; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const TP = 2.2;                                                       // tape width on the unwrap chart (px)

  // ================= fuselage (unwrap: a = z, b = t) =================
  const P = atlas.pen(cFus);
  P.fill('all', skinF);
  const tl = (pts, px = TP) => P.stroke((g) => pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))), 0, tape, { px });
  const both = (t) => [t, 1 - t];
  // saw-tooth panel: z0..z1 × t0..t1 with chevron ends (teeth along t)
  const sawPanel = (z0, z1, t0, t1, teeth = 2, amp = 0.12) => {
    const pts = [], n = teeth * 2;
    for (let i = 0; i <= n; i++) pts.push([z0 + (i % 2 ? amp : 0), t0 + (t1 - t0) * i / n]);
    for (let i = n; i >= 0; i--) pts.push([z1 + (i % 2 ? amp : 0), t0 + (t1 - t0) * i / n]);
    pts.push(pts[0]);
    tl(pts);
  };
  // chines (light edge treatment along the sharp side edge)
  for (const t of [0.25, 0.75]) tl([[-9.2, t], [5.0, t]], 2.6);
  // radome joint: chevron ring
  { const pts = []; for (let i = 0; i <= 16; i++) pts.push([-7.55 + (i % 2 ? 0.16 : 0), i / 16]); tl(pts); }
  // canopy surround and spine treatment
  for (const t of both(0.365)) tl([[-6.55, t], [-3.4, t]]);
  tl([[-6.55, 0.365], [-6.55, 0.635]]);
  for (const t of both(0.47)) tl([[-3.45, t], [4.9, t]]);
  // refuelling receptacle door behind the canopy (USAF)
  if (SC.star === 'usaf') { sawPanel(-2.65, -2.0, 0.475, 0.525, 1, 0.08); P.fill((g) => g.rect(-2.55, 0.49, 0.45, 0.02), { color: '#4a4e51', rough: 0.6, metal: 0.2 }); }
  // upper shoulder access panels
  for (const [z0, z1, ta, tb] of [[-5.9, -5.0, 0.28, 0.34], [-4.6, -3.8, 0.28, 0.35], [-2.9, -2.1, 0.3, 0.4], [-1.6, -0.6, 0.31, 0.42], [-0.2, 0.9, 0.31, 0.43], [1.3, 2.4, 0.32, 0.44], [2.8, 3.8, 0.33, 0.44]]) for (const s of [0, 1]) sawPanel(z0, z1, s ? 1 - tb : ta, s ? 1 - ta : tb, 2, 0.1);
  // engine bay doors on the aft top
  for (const s of [0, 1]) sawPanel(3.9, 4.75, s ? 0.53 : 0.38, s ? 0.62 : 0.47, 2, 0.1);
  // weapon bay doors (belly), saw-tooth front / rear edges
  for (const s of [0, 1]) { const a = 0.006, b = 0.068; sawPanel(-1.9, 2.7, s ? 1 - b : a, s ? 1 - a : b, 2, 0.16); }
  tl([[-1.9, 0], [2.7, 0]]); tl([[-1.9, 1], [2.7, 1]]);
  // nose gear bay and main bay outlines
  sawPanel(-6.2, -4.7, 0.95, 1.0, 1, 0.1); sawPanel(-6.2, -4.7, 0.0, 0.05, 1, 0.1);
  for (const s of [0, 1]) sawPanel(-1.0, 0.55, s ? 1 - 0.165 : 0.065, s ? 1 - 0.065 : 0.165, 2, 0.12);
  // lower-side longitudinal treatment and frame lines (subtle grooves)
  for (const t of both(0.12)) tl([[-8.0, t], [4.8, t]], 1.6);
  for (const z of [-7.0, -6.0, -2.9, -1.4, 0.2, 1.6, 3.0, 4.3]) P.ring(z, 0, 1, { px: 1, depth: 0.25, dark: 0.06 });
  // gun (left upper shoulder, F-35A GAU-22/A): blister fairing + port
  P.decalOn(-2.4, 0.62, 'L', { layers: ['color', 'height'] }, (g, layer) => {
    if (layer === 'height') { g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.ellipse(0.2, 0, 0.75, 0.09, 0, 0, Math.PI * 2); g.fill(); return; }
    g.fillStyle = '#1d1f20'; g.beginPath(); g.ellipse(-0.45, 0, 0.12, 0.05, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = SC.tape; g.lineWidth = 0.02; g.beginPath(); g.ellipse(0.2, 0, 0.75, 0.09, 0, 0, Math.PI * 2); g.stroke();
  });
  // markings
  const starAt = [-1.55, -0.12];
  if (SC.star === 'usaf') P.decalOn(starAt[0], starAt[1], 'both', (g) => K.drawStarBar(g, 0.5, { lowVis: mark }));
  else P.decalOn(starAt[0], starAt[1], 'both', (g) => roundel(g, 0.24, mark));
  if (SC.star === 'usaf') P.textOn('U.S.AIR FORCE', 1.6, -0.18, 'both', 0.07, { color: mark, weight: 700 });
  if (livery === 'raaf') P.textOn('ROYAL AUSTRALIAN AIR FORCE', 1.6, -0.18, 'both', 0.06, { color: mark, weight: 700 });
  P.textOn('DANGER', -3.95, 0.4, 'both', 0.04, { color: '#8d3a32', weight: 700 });
  P.textOn('RESCUE', -5.6, 0.32, 'both', 0.04, { color: mark });
  P.decalOn(-5.95, 0.32, 'both', (g) => { g.strokeStyle = mark; g.lineWidth = 0.014; g.beginPath(); g.moveTo(-0.12, 0); g.lineTo(0.08, 0); g.moveTo(0.02, -0.045); g.lineTo(0.09, 0); g.lineTo(0.02, 0.045); g.stroke(); });
  if (livery !== 'lowvis') P.textOn(livery === 'raaf' ? 'SQNLDR J. MORGAN' : 'MAJ T. "VAPOR" REYES', -4.6, 0.3, 'L', 0.035, { color: mark });
  // formation light strips
  for (const [z, y] of [[-6.3, 0.05], [3.4, 0.0]]) P.decalOn(z, y, 'both', { layers: ['color', 'orm'] }, (g, layer) => { g.fillStyle = layer === 'orm' ? 'rgb(255,90,0)' : '#bfc4a0'; g.fillRect(-0.25, -0.02, 0.5, 0.04); });
  // weathering: tonal variation, belly grime, exhaust staining
  P.noise({ alpha: 0.07, scale: 2.2, stretch: [1.6, 1], rough: 0.05 });
  P.noise({ alpha: 0.04, scale: 0.7, mode: 'light' });
  for (let i = 0; i < 22; i++) { const z = -2.5 + rnd() * 6.5, t = (rnd() < 0.5 ? 0.02 : 0.9) + rnd() * 0.08; P.streak(z, t, z + 0.5 + rnd() * 1.2, t, 0.008 + rnd() * 0.012, { alpha: 0.08 + rnd() * 0.1 }); }
  P.fill((g) => g.rect(4.5, 0, 0.55, 1), { color: 'rgba(40,36,32,0.3)' }, { feather: 8 });
  // duct-visible region of the skin just behind the intake lips (inside the inlets): paint it duct white
  P.fill((g) => { g.rect(-3.42, 0.13, 1.22, 0.105); g.rect(-3.42, 0.765, 1.22, 0.105); }, F.gloss('#e2e3df'));

  // ================= booms =================
  { const Q = atlas.pen(cBoom); Q.fill('all', skinF); for (const t of [0.25, 0.75]) Q.stroke((g) => { g.moveTo(1.3, t); g.lineTo(6.1, t); }, 0, tape, { px: 2 }); Q.fill((g) => g.rect(5.2, 0, 1.0, 1), { color: 'rgba(40,36,32,0.25)' }, { feather: 6 }); Q.noise({ alpha: 0.07, scale: 1.2, rough: 0.05 }); }

  // ================= wings (plan: a = x, b = z) =================
  for (const key of ['R', 'L']) {
    const s = key === 'R' ? 1 : -1, wg = W.R;
    const at = (x, f) => { const p = wg.at(x, f); return [p[0] * s, p[2]]; };
    const hTE = (x) => wg.lines.hingeTE.at(wg.spanToU(x)), hLE = (x) => wg.lines.hingeLE.at(wg.spanToU(x));
    for (const [chart, isTop] of [[cWT[key], true], [cWB[key], false]]) {
      const Q = atlas.pen(chart);
      Q.fill('all', skinF);
      const t2 = (pts, w = 0.035) => Q.stroke((g) => pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))), w, tape);
      // leading edge band and LE-flap hinge, flaperon outline, tip edge
      t2([at(1.3, 0.004), at(5.35, 0.004)], 0.07);
      t2([at(1.5, hLE(1.5)), at(5.3, hLE(5.3))]);
      t2([at(1.45, 1), at(1.45, hTE(1.45)), at(4.3, hTE(4.3)), at(4.3, 1)]);
      t2([at(5.33, 0), at(5.33, 1)], 0.05);
      t2([at(1.4, 0.995), at(5.35, 0.995)], 0.04);
      // saw-tooth access panels
      const sp = (x0, x1, f0, f1) => { const pts = []; const n = 4; for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n; pts.push(at(x, f0 + (i % 2 ? 0.03 : 0))); } for (let i = n; i >= 0; i--) { const x = x0 + (x1 - x0) * i / n; pts.push(at(x, f1 + (i % 2 ? 0.03 : 0))); } pts.push(pts[0]); t2(pts, 0.03); };
      if (isTop) { sp(1.6, 2.6, 0.3, 0.45); sp(2.8, 3.8, 0.32, 0.5); sp(1.7, 2.4, 0.55, 0.7); }
      else { sp(1.6, 3.0, 0.28, 0.5); sp(3.2, 4.2, 0.3, 0.5); sp(1.7, 2.6, 0.58, 0.72); }
      // control surface gaps (grooves)
      Q.line([at(1.45, hTE(1.45)), at(4.3, hTE(4.3))], { px: 1.5, depth: 0.7, dark: 0.4 });
      Q.line([at(1.5, hLE(1.5)), at(5.3, hLE(5.3))], { px: 1.5, depth: 0.7, dark: 0.4 });
      for (const f of [0.35, 0.6]) Q.line([at(1.2, f), at(5.2, f)], { px: 1, depth: 0.25, dark: 0.07 });
      Q.noise({ alpha: 0.08, scale: 1.2, stretch: [1, 2.5], rough: 0.05 });
      for (let i = 0; i < 6; i++) { const x = 1.6 + rnd() * 2.4, a = at(x, hTE(x)); Q.streak(a[0], a[1], a[0], a[1] + 0.25 + rnd() * 0.3, 0.03, { alpha: 0.12 }); }
      if (SC.star === 'usaf') {
        if (isTop && key === 'L') Q.decal(-3.4, 1.0, (g) => K.drawStarBar(g, 0.55, { lowVis: mark }));
        if (!isTop && key === 'R') Q.decal(3.4, 1.0, (g) => K.drawStarBar(g, 0.55, { lowVis: mark }));
      } else if (SC.star === 'raaf' && isTop) Q.decal(s * 3.4, 1.0, (g) => roundel(g, 0.3, mark));
      if (isTop) { const p = at(1.8, 0.4); Q.text('NO STEP', p[0], p[1], 0.04, { color: mark }); }
    }
  }
  // ================= stabilators (plan, mirrored) =================
  for (const [chart, isTop] of [[cST, true], [cSB, false]]) {
    const Q = atlas.pen(chart); Q.fill('all', skinF);
    const le = (x) => 3.45 + (x - 1.15) * Math.tan(35 * DEG), te = (x) => 6.4 - (x - 1.15) * (6.4 - 5.78) / 1.9;
    Q.stroke((g) => { g.moveTo(1.2, le(1.2) + 0.02); g.lineTo(3.05, le(3.05) + 0.02); }, 0.06, tape);
    Q.stroke((g) => { g.moveTo(1.2, te(1.2) - 0.02); g.lineTo(3.05, te(3.05) - 0.02); }, 0.04, tape);
    Q.stroke((g) => { g.moveTo(3.03, le(3.05)); g.lineTo(3.03, te(3.05)); }, 0.04, tape);
    const pts = []; for (let i = 0; i <= 4; i++) pts.push([1.5 + i * 0.25, le(1.5 + i * 0.25) + 0.5 + (i % 2) * 0.1]); for (let i = 4; i >= 0; i--) pts.push([1.5 + i * 0.25, le(1.5 + i * 0.25) + 1.2 + (i % 2) * 0.1]);
    pts.push(pts[0]); Q.stroke((g) => pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))), 0.03, tape);
    Q.noise({ alpha: 0.08, scale: 1.0, stretch: [1, 2], rough: 0.05 });
    void isTop;
  }
  // ================= fins (side: a = z, b = y) =================
  for (const key of ['RO', 'LO', 'RI', 'LI']) {
    const Q = atlas.pen(cFin[key]), outer = key[1] === 'O', fin = key[0] === 'R' ? fins.R : fins.L;
    Q.fill('all', skinF);
    const at = (u, f) => { const p = fin.at(u, f); return [p[2], p[1]]; };
    const hz = (u) => fin.lines.hinge.at(fin.spanToU(u));
    const t2 = (pts, w = 0.035) => Q.stroke((g) => pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))), w, tape);
    t2([at(0.15, 0.004), at(FIN.len, 0.004)], 0.07);
    t2([at(FIN.len - 0.02, 0), at(FIN.len - 0.02, 1)], 0.05);
    t2([at(0.12, 1), at(0.12, hz(0.12)), at(FIN.len - 0.08, hz(FIN.len - 0.08)), at(FIN.len - 0.08, 1)]);
    Q.line([at(0.12, hz(0.12)), at(FIN.len - 0.08, hz(FIN.len - 0.08))], { px: 1.5, depth: 0.7, dark: 0.4 });
    { const pts = []; for (let i = 0; i <= 4; i++) pts.push(at(0.5 + i * 0.3, 0.2 + (i % 2) * 0.04)); for (let i = 4; i >= 0; i--) pts.push(at(0.5 + i * 0.3, 0.45 + (i % 2) * 0.04)); pts.push(pts[0]); t2(pts, 0.03); }
    if (outer) {
      if (SC.tip) Q.fill([at(FIN.len - 0.3, 0), at(FIN.len, 0), at(FIN.len, 1), at(FIN.len - 0.3, 1)], { color: SC.tip, rough: 0.55, metal: 0.1 });
      if (SC.code) { const c = at(1.25, 0.42); Q.text(SC.code, c[0], c[1], 0.5, { color: mark, weight: 700 }); }
      const d = at(0.62, 0.5); Q.text(SC.serial, d[0], d[1], SC.code ? 0.1 : 0.12, { color: mark, weight: 700 });
      if (SC.unit) { const u = at(1.95, 0.4); Q.text(SC.unit, u[0], u[1], 0.09, { color: mark, weight: 700 }); }
      if (livery === 'raaf') { const c = at(1.3, 0.4); Q.decal(c[0], c[1], (g) => roundel(g, 0.22, mark, true)); }
    }
    Q.noise({ alpha: 0.08, scale: 1.2, stretch: [1, 1.5], rough: 0.05 });
  }
  // ================= nozzle petals (a = around, b = hinge → exit) =================
  {
    const Q = atlas.pen(cNoz), n = NZ.petals, w = 3.8 / n;
    Q.fill('all', { color: '#77716b', rough: 0.5, metal: 0.8 });
    for (let i = 0; i < n; i++) {
      if (i % 2) Q.fill((g) => g.rect(i * w, 0, w, 0.75), { color: '#6c6660', rough: 0.55, metal: 0.8 });
      Q.fill((g) => g.rect(i * w + w * 0.3, 0.04, w * 0.4, 0.66), { color: '#837c75', rough: 0.45, metal: 0.8 }, { alpha: 0.5 });
      Q.line([[i * w, 0], [i * w, 0.75]], { px: 2, depth: 0.9, dark: 0.6 });
    }
    Q.fill((g) => g.rect(0, 0, 3.8, 0.22), { color: SC.skin, rough: 0.6, metal: 0.2 });           // RAM-coated forward flap section
    Q.fill((g) => g.rect(0, 0.5, 3.8, 0.25), { color: '#4a3f3a', rough: 0.6, metal: 0.8 }, { alpha: 0.45, feather: 6 });
    Q.line([[0, 0.22], [3.8, 0.22]], { px: 1.5, depth: 0.7, dark: 0.5 });
    Q.noise({ alpha: 0.12, scale: 0.8, stretch: [1, 2] });
  }
  // ================= panoramic cockpit display (rect: a 0..0.72, b 0..0.3 down) =================
  {
    const Q = atlas.pen(cPanel); Q.fill('all', { color: '#141618', rough: 0.6, metal: 0 });
    const scr = (a, b, w, h, col) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#050607', rough: 0.15, metal: 0 }); Q.fill((g) => g.rect(a + 0.006, b + 0.006, w - 0.012, h - 0.012), { color: col, rough: 0.12, metal: 0, emissive: col }); };
    scr(0.1, 0.05, 0.255, 0.2, '#10222c'); scr(0.365, 0.05, 0.255, 0.2, '#10222c');
    Q.fill((g) => g.rect(0.12, 0.07, 0.11, 0.08), { color: '#2a6a4a', emissive: '#1a4a32', rough: 0.2 });
    Q.fill((g) => g.rect(0.25, 0.07, 0.09, 0.08), { color: '#3d4d6a', emissive: '#28344a', rough: 0.2 });
    Q.fill((g) => g.rect(0.385, 0.07, 0.215, 0.16), { color: '#3a3020', emissive: '#2c2416', rough: 0.2 });
    Q.fill((g) => g.rect(0.12, 0.17, 0.22, 0.06), { color: '#1c3a5a', emissive: '#14304a', rough: 0.2 });
    for (let i = 0; i < 6; i++) Q.fill((g) => g.rect(0.11 + i * 0.085, 0.265, 0.05, 0.016), { color: '#3a3c3e', rough: 0.5, metal: 0 });
  }
}

/** Low-visibility roundel (RAAF style): ring + kangaroo silhouette in the marking colour. */
function roundel(g, r, color, small) {
  g.strokeStyle = color; g.lineWidth = r * 0.12; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
  g.fillStyle = color; g.beginPath();
  const k = r * (small ? 0.9 : 0.85);
  const pts = [[-0.55, 0.45], [-0.2, 0.2], [0.05, 0.25], [0.3, 0.05], [0.35, -0.3], [0.5, -0.5], [0.42, -0.55], [0.25, -0.32], [0.15, -0.05], [-0.05, -0.05], [-0.15, 0.1], [-0.6, 0.55]];
  pts.forEach((p, i) => (i ? g.lineTo(p[0] * k, p[1] * k) : g.moveTo(p[0] * k, p[1] * k))); g.closePath(); g.fill();
}
