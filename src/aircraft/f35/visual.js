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
//   Fins: canted 20° out, root x ±1.05 y 0.36 (on the flat chined booms) LE z 2.3 chord 3.35, tip y 2.78 chord 1.25; rudders.
//   Forebody: narrow core + chine blade (loft `chine`), so below the chine the body is a near-vertical wall with a short
//         shelf under the chine edge: the DSI bump sits on that wall and the inlet cowl continues it aft.
//   Intakes: raked DSI aperture x 0.79…1.35, y -0.5…0.27, lip z -3.3 (top inboard) … -3.85 (bottom outboard); grid skin
//         duct → sharp lip → cowl, the cowl rows drape onto the fuselage skin by z ≈ -1.5 (no separate surface).
//   Nozzle: single axisymmetric, hinge ring z 5.0 (r 0.6), exit z 5.75, exit r 0.44 closed … 0.55 open, 15 serrated petals.
//   Gear: nose [0, -1.6, -5.1] r 0.2 (single wheel, retracts forward); mains [±1.6, -1.6, 0.5] r 0.33 (forward + inward,
//         wheel turned flat). Canopy hinged at the front (z -6.45), eye [0, 0.85, -5.35].
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['usaf', 'lowvis', 'raaf'];

const SCHEMES = {
  usaf: { name: 'USAF 388th FW (HL)', skin: '#58595a', tape: '#6b6d6d', mark: '#3e4245', code: 'HL', serial: 'AF 19-5427', unit: '388 FW', star: 'usaf', tip: '#2c2f31', weather: 1.25 },
  lowvis: { name: 'Low-visibility (sanitised)', skin: '#4f5152', tape: '#5d5f60', mark: '#4a4e51', code: '', serial: '5481', unit: '', star: 'usaf', tip: null, weather: 0.45, halo: '#6f7375' },
  raaf: { name: 'RAAF No. 3 Sqn', skin: '#56585a', tape: '#686a6b', mark: '#3c4043', code: '', serial: 'A35-052', unit: '3SQN', star: 'raaf', tip: null, weather: 0.9 },
};

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'usaf', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const ramF = (c) => ({ color: c, rough: 0.64, metal: 0.06 }), skinF = ramF(SC.skin);
  const seg = Math.max(32, Math.round(88 * detail / 4) * 4);

  // ---- atlas ------------------------------------------------------------------------------------------------------------
  const atlas = K.createAtlas({ size: atlasSize, base: skinF, skin: { weathering: Math.min(0.85, 0.25 + 0.4 * (SC.weather ?? 1)), framePitch: 0.35, waviness: 0.35 } });   // composite LO skin: little oil-canning
  const cFus = atlas.chart('fus', { type: 'unwrap', z: [-9.25, 5.05], girth: 7.4, vScale: 0.9, strips: 2 });
  const cWT = { R: atlas.chart('wingTopR', { type: 'plan', x: [0.95, 5.4], z: [-2.1, 3.5], view: 'top' }), L: atlas.chart('wingTopL', { type: 'plan', x: [-5.4, -0.95], z: [-2.1, 3.5], view: 'top' }) };
  const cWB = { R: atlas.chart('wingBotR', { type: 'plan', x: [0.95, 5.4], z: [-2.1, 3.5], view: 'bottom', density: 0.7 }), L: atlas.chart('wingBotL', { type: 'plan', x: [-5.4, -0.95], z: [-2.1, 3.5], view: 'bottom', density: 0.7 }) };
  const cST = atlas.chart('stabTop', { type: 'plan', x: [1.1, 3.1], z: [3.4, 6.45], view: 'top', mirror: true, density: 0.85 });
  const cSB = atlas.chart('stabBot', { type: 'plan', x: [1.1, 3.1], z: [3.4, 6.45], view: 'bottom', mirror: true, density: 0.65 });
  const finSpec = (view, density = 1) => ({ type: 'side', z: [2.05, 5.85], y: [0.28, 2.85], view, density });
  const cFin = { RO: atlas.chart('finRO', finSpec('right')), LO: atlas.chart('finLO', finSpec('left')), RI: atlas.chart('finRI', finSpec('left', 0.6)), LI: atlas.chart('finLI', finSpec('right', 0.6)) };
  const cBoom = atlas.chart('boom', { type: 'unwrap', z: [1.2, 6.2], girth: 1.6, vScale: 1, density: 0.8 });
  const cowlSpec = (view) => ({ type: 'side', z: [-3.95, -1.35], y: [-0.82, 0.42], view, density: 0.9 });
  const cCowl = { R: atlas.chart('cowlR', cowlSpec('right')), L: atlas.chart('cowlL', cowlSpec('left')) };
  const cPanel = atlas.chart('panel', { type: 'rect', w: 0.72, h: 0.3, density: 3 });
  const cNoz = atlas.chart('nozzle', { type: 'rect', w: 3.8, h: 0.75, density: 0.8 });
  atlas.pack();
  const U = {
    skin: atlas.swatch('skin', skinF), tape: atlas.swatch('tape', ramF(SC.tape)), duct: atlas.swatch('duct', { color: '#a4a6a3', rough: 0.6, metal: 0 }), ductMid: atlas.swatch('ductMid', { color: '#717371', rough: 0.7, metal: 0 }), ductDeep: atlas.swatch('ductDeep', { color: '#353736', rough: 0.8, metal: 0 }),
    dark: atlas.swatch('dark', F.darkGrey), black: atlas.swatch('black', F.black), exhaust: atlas.swatch('exhaust', F.exhaust),
    heat: atlas.swatch('heat', { color: '#7a746e', rough: 0.5, metal: 0.75 }), heat2: atlas.swatch('heat2', { color: '#3e3a37', rough: 0.55, metal: 0.8 }), petalIn: atlas.swatch('petalIn', { color: '#8a857e', rough: 0.62, metal: 0.3 }),
    liner: atlas.swatch('liner', { color: '#78736d', rough: 0.68, metal: 0.12 }), liner2: atlas.swatch('liner2', { color: '#5e574f', rough: 0.7, metal: 0.15 }),
    ceramic: atlas.swatch('ceramic', { color: '#b9b2a6', rough: 0.6, metal: 0.1 }),
    well: atlas.swatch('well', F.gearWhite), interior: atlas.swatch('interior', { color: '#34383b', rough: 0.75, metal: 0 }), console: atlas.swatch('console', { color: '#1b1d1f', rough: 0.6, metal: 0 }),
    seat: atlas.swatch('seat', { color: '#232628', rough: 0.7, metal: 0 }), cushion: atlas.swatch('cushion', { color: '#2e3130', rough: 0.95, metal: 0 }), accent: atlas.swatch('accent', { color: '#d6b21e', rough: 0.5, metal: 0 }),
    suit: atlas.swatch('suit', { color: '#4d5540', rough: 0.9, metal: 0 }), helmet: atlas.swatch('helmet', { color: '#2b2d2f', rough: 0.4, metal: 0.1 }), visor: atlas.swatch('visor', { color: '#0a0b0d', rough: 0.05, metal: 0.5 }),
    glove: atlas.swatch('glove', { color: '#3a3d33', rough: 0.9, metal: 0 }), frame: atlas.swatch('frame', F.ram('#4a4e51')), frameIn: atlas.swatch('frameIn', { color: '#26292b', rough: 0.7, metal: 0.05 }), coaming: atlas.swatch('coaming', { color: '#1a1b1c', rough: 0.85, metal: 0 }), steel: atlas.swatch('steel', F.steel),
    eots: atlas.swatch('eots', { color: '#2a2418', rough: 0.04, metal: 0.65 }), lens: atlas.swatch('lens', F.lens),
  };

  const rig = K.createRig(ctx, { geometry: G, name: 'f35', glassLayer: opts.glassLayer });
  rig.material('paint', null);
  const stat = new K.Mesh();

  // ---- fuselage: chined, flat-bottomed body (sharp chine = side point with aTop/aBot < 90°) ----------------------------------
  //        z      yc     w      top    bot    kTop  kBot  aTop aBot
  const FS = [
    [-9.25, 0.150, 0.000, 0.000, 0.000, 0.5, 0.45, 30, 26],
    [-9.08, 0.150, 0.055, 0.060, 0.055, 0.52, 0.47, 30, 26],
    [-8.70, 0.150, 0.165, 0.190, 0.180, 0.55, 0.5, 32, 28],
    [-8.10, 0.160, 0.305, 0.370, 0.340, 0.57, 0.52, 34, 30],
    [-7.40, 0.180, 0.440, 0.540, 0.500, 0.59, 0.56, 36, 34],
    [-6.70, 0.210, 0.560, 0.650, 0.670, 0.6, 0.6, 38, 40],
    [-6.00, 0.250, 0.710, 0.710, 0.830, 0.62, 0.64, 38, 42],
    [-5.20, 0.300, 0.800, 0.780, 0.980, 0.64, 0.68, 36, 40, [0.87, 0, 0.5, 0.3, 0.06, 1]],
    [-4.40, 0.350, 0.800, 0.950, 1.100, [0.92, 0.66], [0.85, 0.75], 76, 75, [1.03, 0, 1.0, 0.16, 0.06, 1.3]],
    [-3.70, 0.380, 0.740, 1.040, 1.170, [0.92, 0.66], [0.92, 0.8], 78, 88, [1.20, 0, 1.0, 0.08, 0.05, 1.3]],
    [-3.00, 0.350, 0.760, 1.010, 1.160, [0.92, 0.66], [0.92, 0.8], 78, 88, [1.36, 0, 1.0, 0.08, 0.05, 1.3]],
    [-2.10, 0.250, 0.800, 1.000, 1.070, [0.92, 0.66], [0.92, 0.85], 76, 88, [1.45, 0, 1.1, 0.1, 0.06, 1.45]],
    [-1.55, 0.200, 1.200, 0.995, 1.020, [0.86, 0.66], [0.92, 0.86], 62, 84, [1.48, 0, 0.75, 0.1, 0.06, 1.25]],
    [-1.00, 0.160, 1.340, 0.990, 0.980, [0.8, 0.65], 0.88, 50, 74, [1.49, 0, 0.6, 0.12, 0.06, 1.2]],
    [0.60, 0.100, 1.450, 0.980, 0.920, 0.6, 0.88, 24, 72, [1.50, 0, 0.2, 0.12, 0.05, 1]],
    [2.00, 0.100, 1.450, 0.910, 0.890, [0.7, 0.66], 0.86, 30, 72],
    [3.20, 0.100, 1.300, 0.810, 0.820, [0.86, 0.78], 0.8, 52, 72],
    [4.20, 0.100, 1.100, 0.730, 0.700, [0.9, 0.78], 0.72, 64, 70],
    [5.00, 0.100, 0.640, 0.620, 0.620, 0.5523, 0.5523, 90, 90],
  ].map(r => ({ z: r[0], y: r[1], w: r[2], top: r[3], bot: r[4], kTop: r[5], kBot: r[6], aTop: r[7], aBot: r[8], chine: r[9] && { w: r[9][0], y: r[9][1], tu: r[9][2], tl: r[9][3], k: r[9][4], e: r[9][5] } }));
  const T_NG = 0.05, T_MLG = [0.07, 0.16];
  // canopy sill follows a side-view height line (low over the windscreen, rising slightly aft onto the spine); the plan width
  // follows the body, so the canopy is a teardrop that ends wide over the spine, as on the real aircraft
  const probe = K.loft({ stations: FS, segments: 64, step: 0.25 });
  const sillY = K.pchip([-6.45, -6.0, -5.0, -4.0, -3.4], [0.47, 0.52, 0.57, 0.65, 0.76]);
  const sillCache = new Map();
  const tSill = (z) => {
    const key = Math.round(z * 100); let v = sillCache.get(key);
    if (v === undefined) { let lo = 0.25, hi = 0.5; const y = sillY(z); for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (probe.at(z, m).p[1] < y) lo = m; else hi = m; } sillCache.set(key, v = (lo + hi) / 2); }
    return v;
  };
  let tCut = 0.5; for (let z = -6.45; z <= -3.5 + 1e-6; z += 0.05) tCut = Math.min(tCut, tSill(z));
  const fus = K.loft({
    stations: FS, segments: seg, step: 0.09 / detail, chart: cFus, creases: ['side'], capEnd: 'flat', capUV: U.exhaust,
    cutouts: [
      { name: 'cockpit', z: [-6.45, -3.5], t: [tCut, 1 - tCut], shape: (z, t) => (t < 0.5 ? t : 1 - t) >= tSill(z) - 0.004 },
      { name: 'ng', z: [-6.15, -4.75], t: [0, T_NG], mirror: true },
      { name: 'mlg', z: [-0.95, 0.5], t: T_MLG, mirror: true },
    ],
  });
  cFus.body = fus;
  const BUMP = { z: -3.85, y: -0.14, lz: 0.85, ly: 0.42, amp: 0.13 };
  bulge(fus.mesh, BUMP);   // DSI bump on the cheeks, ahead of and inside the inlet
  bulge(fus.mesh, { z: -2.0, y: 0.62, lz: 0.85, ly: 0.14, amp: 0.045, side: -1 });   // GAU-22/A gun blister, left shoulder
  stat.add(fus.mesh);

  // ---- tail booms (carry the fins and stabilators either side of the nozzle) ---------------------------------------------------
  // low, flat-topped, chined shelves (not round tubes): the fuselage chine runs straight on into the boom edge
  const BX = 1.02, BS = (z, y, w, top, bot, extra) => ({ z, x: BX, y, w, top, bot, kTop: [0.82, 0.86], kBot: [0.8, 0.8], aTop: 28, aBot: 34, ...extra });
  const boom = K.loft({
    stations: [
      BS(1.0, 0.1, 0.26, 0.05, 0.05), BS(2.1, 0.13, 0.31, 0.19, 0.15), BS(3.1, 0.15, 0.32, 0.25, 0.19), BS(4.1, 0.15, 0.31, 0.25, 0.2), BS(5.0, 0.14, 0.28, 0.23, 0.2),
      BS(5.75, 0.12, 0.2, 0.16, 0.15), BS(6.35, 0.1, 0.025, 0.02, 0.02),
    ],
    segments: Math.max(16, Math.round(24 * detail / 4) * 4), step: 0.25, chart: cBoom, creases: ['side'],
  });
  stat.add(boom.mesh).add(boom.mesh.clone().mirrorX());

  // ---- canopy (one-piece, forward hinged, thick bow frame) ---------------------------------------------------------------------
  const CZ0 = -6.45, CZ1 = -3.5;
  const canTop = K.pchip([-6.45, -6.2, -5.95, -5.65, -5.35, -5.05, -4.7, -4.35, -4.0, -3.75, -3.5], [fus.topAt(-6.45) + 0.005, 1.12, 1.32, 1.5, 1.625, 1.69, 1.715, 1.7, 1.645, 1.55, fus.topAt(-3.5) + 0.012]);
  const canZ = []; for (let z = CZ0; z < CZ1 - 1e-6; z += 0.15) canZ.push(z); canZ.push(CZ1);
  const canSt = canZ.map(z => { const s = fus.at(z, tSill(z)).p; return { z, y: s[1], w: s[0], top: Math.max(0.004, canTop(z) - s[1]), bot: 0.01, kTop: [0.7, 0.62] }; });
  const cseg = Math.max(16, Math.round(32 * detail / 4) * 4), ct = 1 / cseg;
  const canLoft = (zr, tr, inflate, uv, extra = {}) => K.loft({ stations: canSt, segments: cseg, step: 0.1, tRange: tr, zRange: zr, inflate, uv, ...extra }).mesh;
  const glassMove = canLoft([CZ0, CZ1], [0.25, 0.75], 0, [0, 0]);
  const frameMove = K.merge(
    canLoft([CZ0, CZ1], [0.25, 0.25 + ct * 0.8], 0.006, U.frame), canLoft([CZ0, CZ1], [0.75 - ct * 0.8, 0.75], 0.006, U.frame),
    canLoft([-5.67, -5.56], [0.25, 0.75], 0.012, U.frame),                       // bow frame
    canLoft([CZ0, CZ0 + 0.05], [0.25, 0.75], 0.006, U.frame),                    // windscreen base strip
    canLoft([CZ1 - 0.16, CZ1], [0.25, 0.75], 0.007, U.frame, { capEnd: 'flat', capUV: U.frame }),   // aft arch closing onto the spine
    // the same frames seen from inside the cockpit (the glass is invisible from in there): bow arch, aft arch, rails
    canLoft([-5.67, -5.56], [0.25, 0.75], -0.012, U.frameIn).flip(), canLoft([CZ1 - 0.2, CZ1], [0.25, 0.75], -0.01, U.frameIn).flip(),
    canLoft([CZ0, CZ1], [0.25, 0.25 + ct * 0.9], -0.008, U.frameIn).flip(), canLoft([CZ0, CZ1], [0.75 - ct * 0.9, 0.75], -0.008, U.frameIn).flip(),
    canLoft([CZ0, CZ0 + 0.06], [0.25, 0.75], -0.008, U.frameIn).flip(),
  );

  // ---- cockpit -----------------------------------------------------------------------------------------------------------------
  const eye = G.pilotEye, tubX = 0.42;
  stat.add(K.tub({ x: tubX, y0: 0.17, y1: 0.64, z0: -6.35, z1: -3.6, uv: U.interior, taper: 0.8 }).occlude(0.45));
  {  // sill ledge between the skin cut-out and the tub
    const zs = []; for (let z = CZ0; z <= CZ1 + 1e-6; z += 0.2) zs.push(z); if (zs[zs.length - 1] < CZ1 - 1e-6) zs.push(CZ1);
    for (const sx of [1, -1]) {
      let prev = null;
      for (const z of zs) {
        const o = fus.at(z, sx > 0 ? tSill(z) : 1 - tSill(z)).p, a = stat.vert(o[0], o[1], z, -sx * 0.6, 0.8, 0, U.interior[0], U.interior[1]), b = stat.vert(sx * tubX * 0.92, 0.62, z, -sx * 0.6, 0.8, 0, U.interior[0], U.interior[1]);
        if (prev) { if (sx > 0) stat.quad(prev[0], a, b, prev[1]); else stat.quad(prev[0], prev[1], b, a); }
        prev = [a, b];
      }
    }
  }
  {  // wide flat glare shield over the panoramic display
    const gs = K.prism([[-6.36, 0.81], [-6.36, 0.95], [-5.95, 1.035], [-5.86, 1.03], [-5.86, 1.012], [-5.9, 0.99], [-5.9, 0.81]], -0.46, 0.46, U.coaming);
    for (let i = 0; i < gs.p.length; i += 3) gs.p[i] *= 0.55 + 0.45 * Math.min(1, (gs.p[i + 2] + 6.36) / 0.5);
    stat.add(gs);
  }
  {  // one large panoramic cockpit display (painted chart, emissive), side consoles, side stick, throttle
    const z = -5.9, i0 = stat.vertexCount, q = [[-0.34, 0.72], [0.34, 0.72], [0.34, 0.98], [-0.34, 0.98]];
    for (const p of q) { const uv = cPanel.uv((p[0] + 0.34) / 0.68 * 0.72, (0.98 - p[1]) / 0.26 * 0.3); stat.vert(p[0], p[1], z + 0.02 + (0.98 - p[1]) * 0.3, 0, 0.24, 1, uv[0], uv[1]); }
    stat.quad(i0, i0 + 1, i0 + 2, i0 + 3);
    stat.add(K.box(0.86, 0.66, 0.1, U.console).translate(0, 0.66, -5.96));                       // instrument panel body
    stat.add(K.box(0.05, 0.3, 0.12, U.console).translate(0, 0.42, -5.86));                       // centre pedestal
    for (const sx of [-1, 1]) stat.add(K.box(0.14, 0.12, 1.3, U.console).translate(sx * 0.33, 0.63, -4.95));
    stat.add(K.stick({ base: [0.33, 0.69, -4.98], height: 0.14, uv: U.black, uvGrip: U.dark }));
    stat.add(K.box(0.06, 0.08, 0.12, U.dark).translate(-0.33, 0.73, -5.0));
  }
  stat.add(K.ejectionSeat({ eye, recline: 18, uv: { frame: U.seat, cushion: U.cushion, accent: U.accent } }));
  const pilotMesh = K.pilot({ eye, recline: 16, stick: [0.32, -0.42, 0.25], throttle: [-0.33, -0.39, 0.25], uv: { suit: U.suit, helmet: U.helmet, visor: U.visor, dark: U.dark, glove: U.glove } });
  for (const sx of [-1, 1]) pilotMesh.add(K.box(0.06, 0.05, 0.05, U.dark).translate(sx * 0.11, eye[1] + 0.05, eye[2] + 0.02));   // HMD tracker blocks

  // ---- DSI intakes: fold-over loft (duct → lip → cowl), sheared so the lips sweep forward, plus the cheek bump ----------------
  //   Aperture (front view, right side, CCW): inboard edge against the bump, top edge under the chine, outer wall leaning in.
  //   The lip plane is raked: the lower outboard corner is the most forward point (side and plan sweep).
  //   One grid per side: S-duct (deep → lip, white) | sharp lip band (edge tape) | outer cowl that drapes onto the fuselage
  //   skin (rows converge on the body section along rays from C0), so the cowl and the body read as one surface.
  const INL = { BI: [0.79, -0.5], BO: [1.27, -0.5], TO: [1.35, 0.22], TI: [0.79, 0.27], z: -3.3, rakeY: 0.5, rakeX: 0.34 };
  const lipZ = (x, y) => INL.z - INL.rakeY * (INL.TI[1] - y) - INL.rakeX * (x - INL.TI[0]);
  const NI = Math.max(32, Math.round(48 * detail / 4) * 4);
  const ringI = roundedRing([INL.BI, INL.BO, INL.TO, INL.TI], [0.05, 0.03, 0.03, 0.06], NI);
  const icen = [(INL.BI[0] + INL.BO[0] + INL.TO[0] + INL.TI[0]) / 4, (INL.BI[1] + INL.BO[1] + INL.TO[1] + INL.TI[1]) / 4];
  const C0 = [0.2, -0.08], profCache = new Map();
  const bodyProf = (z) => {   // right half-profile of the (bumped) fuselage at z: [[x, y, t]…] bottom → top
    const key = Math.round(z * 100); let pr = profCache.get(key);
    if (!pr) { pr = []; const zq = key / 100, r = fus.ring(zq), Kr = fus.K; for (let j = 0; j <= Kr / 2; j++) pr.push([r[3 * j] + bumpAt(BUMP, zq, r[3 * j + 1]), r[3 * j + 1], j / Kr]); profCache.set(key, pr); }
    return pr;
  };
  const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  //            dz     outset shrink  cx     cy
  const DUCT = [[1.25, -0.03, 0.72, -0.07, 0.08], [0.85, -0.03, 0.84, -0.04, 0.045], [0.45, -0.028, 0.95, -0.012, 0.012], [0.15, -0.022, 0.99, 0, 0], [0.035, -0.011, 1, 0, 0], [0, 0, 1, 0, 0]];
  const LIP = [[0, 0], [0.012, 0.009], [0.045, 0.017]];
  const COWL = [[0.045, 0.017], [0.16, 0.024], [0.42, 0.028], [0.8, 0.03], [1.2, 0.03], [1.55, 0.03], [1.9, 0.03], [2.3, 0.03]];
  const inletMesh = (sx) => {
    const ductPt = (b, dz, g, sh, cx, cy) => {
      let x = b.p[0] + b.n[0] * g, y = b.p[1] + b.n[1] * g;
      x = icen[0] + (x - icen[0]) * sh + cx; y = icen[1] + (y - icen[1]) * sh + cy;
      return [sx * x, y, lipZ(b.p[0], b.p[1]) + dz];
    };
    const cowlPt = (b, dz, g) => {
      const x0 = b.p[0] + b.n[0] * g, y0 = b.p[1] + b.n[1] * g, z = lipZ(b.p[0], b.p[1]) + dz;
      const inboard = b.n[0] < -0.35, s = inboard ? smooth(0.0, 0.3, dz) : smooth(1.1, 2.3, dz);
      const hit = s > 0 ? rayHit(bodyProf(z), C0, x0, y0) : null;
      let x = x0, y = y0;
      if (hit) { x += (hit[0] - 0.004 - x0) * s; y += (hit[1] - y0) * s; }
      return [sx * x, y, z];
    };
    const fix = (rows) => (sx > 0 ? rows : rows.map(r => r.slice().reverse()));
    const rowsD = DUCT.map(([dz, g, sh, cx, cy]) => ringI.map(b => ductPt(b, dz, g, sh, cx, cy)));
    const rowsL = LIP.map(([dz, g]) => ringI.map(b => ductPt(b, dz, g, 1, 0, 0)));
    const rowsC = COWL.map(([dz, g]) => ringI.map(b => cowlPt(b, dz, g)));
    const ch = sx > 0 ? cCowl.R : cCowl.L;
    const mD = grid(fix(rowsD), { uv: (i) => (i < 1 ? U.ductDeep : i < 3 ? U.ductMid : U.duct) });
    mD.occlude((x, y, z, i) => Math.max(0, 0.85 - 0.16 * Math.floor(i / NI)));       // rows: deep (0.85) → lip (0.05)
    const mL = grid(fix(rowsL), { uv: () => U.tape });
    const mC = grid(fix(rowsC), { uv: (i, j, p) => ch.uv3(p[0], p[1], p[2]) });
    const capRow = fix(rowsD)[0], c0 = capRow.reduce((a, p) => [a[0] + p[0] / capRow.length, a[1] + p[1] / capRow.length, a[2] + p[2] / capRow.length], [0, 0, 0]);
    const cap = new K.Mesh(), ci = cap.vert(c0[0], c0[1], c0[2] + 0.05, 0, 0, -1, U.black[0], U.black[1]);
    const ids = capRow.map(p => cap.vert(p[0], p[1], p[2], 0, 0, -1, U.black[0], U.black[1]));
    for (let j = 0; j < ids.length; j++) cap.tri(ci, ids[(j + 1) % ids.length], ids[j]);
    return K.merge(mD, mL, mC, cap);
  };
  stat.add(inletMesh(1)).add(inletMesh(-1));

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
  const CANT = 20 * DEG, FIN = { x0: 1.05, y0: 0.36, z0: 2.3, c0: 3.35, c1: 1.25, len: (2.78 - 0.36) / Math.cos(20 * DEG) };
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
  const nozzleMesh = K.petalNozzle({ z0: NZ.z0, z1: NZ.z1, r0: 0.635, rClosed: 0.44, rOpen: 0.55, petals: NZ.petals, centre: NZ.c, uvOuter: U.heat, uvInner: U.petalIn, thickness: 0.03, gap: 0.04, chart: cNoz });
  serrate(nozzleMesh, NZ, 0.13);
  // augmentor liner (heat-tinted, corrugated), flameholder spokes + ring, tail cone, dark turbine face behind
  stat.add(K.lathe([[0.6, 5.02], [0.555, 4.75], [0.54, 4.45], [0.53, 4.1], [0, 4.1]], { segments: 32, uv: U.liner }).translate(0, NZ.c[1], 0).occlude((x, y, z) => Math.min(0.8, Math.max(0.15, (5.0 - z) * 0.8))));
  for (let i = 0; i < 24; i++) stat.add(K.box(0.012, 0.02, 0.6, U.liner2).translate(0, 0.525, 4.5).rotateZ((i + 0.5) * Math.PI / 12).translate(0, NZ.c[1], 0));
  for (let i = 0; i < 12; i++) stat.add(K.box(0.035, 0.36, 0.06, U.heat2).translate(0, 0.33, 0).rotateZ(i * Math.PI / 6).translate(0, NZ.c[1], 4.32));
  stat.add(K.lathe([[0.36, 4.28], [0.36, 4.36], [0.32, 4.36], [0.32, 4.28]], { segments: 24, uv: U.heat }).translate(0, NZ.c[1], 0));
  stat.add(K.lathe([[0.17, 4.12], [0.17, 4.3], [0.1, 4.48], [0.0, 4.56]], { segments: 20, uv: U.heat }).translate(0, NZ.c[1], 0));
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
  paint(atlas, { SC, livery, cCowl, fus, W, fins, FIN, finAt, cFus, cWT, cWB, cST, cSB, cFin, cBoom, cPanel, cNoz, skinF, NZ });
  lap('paint');
  const mat = atlas.material(ctx, { envMapIntensity: 0.8 });
  lap('textures');
  rig.material('paint', mat, { shared: true });
  rig.disposables.push(atlas);
  rig.glass('canopy', K.glassMaterial(ctx, { ...K.GLASS.gold, tint: '#5e4a22', opacity: 0.38, edgeOpacity: 0.86 }));
  const glow = rig.material('glow', K.glowMaterial(), { shadow: false });
  rig.addStatic(stat, 'paint');

  // ---- moving parts ------------------------------------------------------------------------------------------------------------------
  const hingeY = fus.at(CZ0, tSill(CZ0)).p[1] + 0.06;
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
    strutR: 0.055, fork: 'fork', steer: true, links: 'front', retract: { to: [0, -0.4, -5.85] }, window: [0.2, 0.86],
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
      pivot: [sx * 1.28, -0.5, 0.3], stroke: 0.3, staticFrac: 0.35, strutR: 0.075, fork: 'axle', links: 'rear',
      retract: { to: [sx * 0.95, -0.58, -0.5], twist: sx * 90 }, window: [0.22, 0.9], brace: [sx * 1.0, -0.6, 0.0],
      doors: [{ name: 'mainDoor' + key, ...doorOf(P['mlg' + key], sx > 0 ? edge.tHi : edge.tLo), open: 100, toward: [0, -1, 0] }],
    });
  }

  // ---- lamps -------------------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.025, 0.01], size: 0.045, squash: [0.6, 0.6, 1.6] });
  rig.lamp('nav', L.navRight, { color: [0.01, 1, 0.22], size: 0.045, squash: [0.6, 0.6, 1.6] });
  rig.lamp('nav', L.tail, { color: [1, 1, 0.95], size: 0.035 });
  rig.lamp('nav', [-L.tail[0], L.tail[1], L.tail[2]], { color: [1, 1, 0.95], size: 0.035 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.065, squash: [1, 0.45, 1.5] });
  // formation strips: electroluminescent tapes on the forward fuselage and the boom sides
  for (const sx of [1, -1]) {
    const q = fus.at(-6.3, sx > 0 ? fus.tAtY(-6.3, 0.05) : 1 - fus.tAtY(-6.3, 0.05));
    rig.lamp('formation', [q.p[0] + q.n[0] * 0.006, q.p[1] + q.n[1] * 0.006, -6.3], { color: [0.5, 1, 0.55], size: 0.018, squash: [0.35, 1, 13] });
    rig.lamp('formation', [sx * (BX + 0.315), 0.15, 3.4], { color: [0.5, 1, 0.55], size: 0.018, squash: [0.35, 1, 13] });
  }
  rig.lamp('beacon', L.beacon, { color: [1, 0.08, 0.02], size: 0.07, squash: [1, 0.45, 1.5] });

  // ---- animation ---------------------------------------------------------------------------------------------------------------------
  rig.onUpdate((S) => {
    const sf = S.sf, e = S.eng[0] || {};
    flR.set((sf.aileronR * 20 - sf.flaps * 25) * DEG); flL.set((sf.aileronL * 20 - sf.flaps * 25) * DEG);
    const lef = Math.max(sf.slats, sf.flaps); lefR.set(-lef * 30 * DEG); lefL.set(-lef * 30 * DEG);
    setStabR(sf.elevatorR * 25 * DEG); setStabL(sf.elevatorL * 25 * DEG);
    rudR.set((sf.rudder * 25 + sf.speedbrake * 30) * DEG); rudL.set((sf.rudder * 25 - sf.speedbrake * 30) * DEG);   // speedbrake = toe-out rudders
    nozzle.morphTargetInfluences[0] = e.nozzle ?? 0;
    K.abGlowColor(glow.color, e, S.night);
    if (!(e.afterburner > 0)) glow.color.multiplyScalar(0.4);          // dry: only a dull turbine-face glow deep in the pipe
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
/** Grid surface: rows[i][j] = [x, y, z]; closed rings. Normal = d/dj × d/di. uv(i, j, p) → [u, v]. (as in f22/visual.js) */
function grid(rows, o = {}) {
  const m = new K.Mesh(), R = rows.length, N = rows[0].length, closed = o.closed !== false;
  const P = (i, j) => rows[i][closed ? ((j % N) + N) % N : Math.max(0, Math.min(N - 1, j))];
  const ids = [];
  for (let i = 0; i < R; i++) {
    const row = [];
    for (let j = 0; j < N; j++) {
      const a = P(i, j - 1), b = P(i, j + 1), c = P(Math.max(0, i - 1), j), d = P(Math.min(R - 1, i + 1), j);
      const dj = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], di = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
      let n = [dj[1] * di[2] - dj[2] * di[1], dj[2] * di[0] - dj[0] * di[2], dj[0] * di[1] - dj[1] * di[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map(v => (o.flip ? -v : v) / l);
      const p = rows[i][j], uv = o.uv ? o.uv(i, j, p) : [0, 0];
      row.push(m.vert(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]));
    }
    ids.push(row);
  }
  const J = closed ? N : N - 1;
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < J; j++) {
    const a = ids[i][j], b = ids[i][(j + 1) % N], c = ids[i + 1][(j + 1) % N], d = ids[i + 1][j];
    if (o.flip) m.quad(a, d, c, b); else m.quad(a, b, c, d);
  }
  return m;
}
/** Closed rounded polygon (corners CCW, x/y) resampled to n points with outward 2D normals. */
function roundedRing(corners, r, n) {
  const pts = [], K4 = corners.length, norm2 = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  for (let k = 0; k < K4; k++) {
    const A = corners[(k + K4 - 1) % K4], B = corners[k], C = corners[(k + 1) % K4];
    const e1 = norm2([B[0] - A[0], B[1] - A[1]]), e2 = norm2([C[0] - B[0], C[1] - B[1]]);
    const n1 = [e1[1], -e1[0]], n2 = [e2[1], -e2[0]];
    const turn = Math.acos(Math.max(-1, Math.min(1, e1[0] * e2[0] + e1[1] * e2[1]))), rk = Array.isArray(r) ? r[k] : r;
    const back = rk * Math.tan(turn / 2), cen = [B[0] - e1[0] * back - n1[0] * rk, B[1] - e1[1] * back - n1[1] * rk];
    const a0 = Math.atan2(n1[1], n1[0]); let a1 = Math.atan2(n2[1], n2[0]); if (a1 < a0) a1 += Math.PI * 2;
    for (let s = 0; s <= 4; s++) { const a = a0 + (a1 - a0) * s / 4; pts.push({ p: [cen[0] + Math.cos(a) * rk, cen[1] + Math.sin(a) * rk], n: [Math.cos(a), Math.sin(a)] }); }
  }
  const cum = [0]; for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1].p, b = pts[i % pts.length].p; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[pts.length], out = []; let s = 0;
  for (let k = 0; k < n; k++) {
    const t = L * k / n; while (cum[s + 1] < t) s++;
    const f = (t - cum[s]) / Math.max(1e-9, cum[s + 1] - cum[s]), a = pts[s], b = pts[(s + 1) % pts.length];
    out.push({ p: [a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f], n: norm2([a.n[0] + (b.n[0] - a.n[0]) * f, a.n[1] + (b.n[1] - a.n[1]) * f]) });
  }
  return out;
}
/** Where the ray from c through (x, y) crosses the right half-profile poly [[x, y, t]…]; returns [x, y, t] or null. */
function rayHit(poly, c, x, y) {
  const dx = x - c[0], dy = y - c[1];
  let best = null, bu = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1], ex = b[0] - a[0], ey = b[1] - a[1], den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const u = ((a[0] - c[0]) * ey - (a[1] - c[1]) * ex) / den, v = ((a[0] - c[0]) * dy - (a[1] - c[1]) * dx) / den;
    if (u > 0 && v >= 0 && v <= 1 && u < bu) { bu = u; best = [a[0] + ex * v, a[1] + ey * v, a[2] + (b[2] - a[2]) * v]; }
  }
  return best;
}
/** Smooth bell used by the DSI bump (same law as bulge()). */
function bumpAt(o, z, y) {
  const c2 = (u) => (Math.abs(u) >= 1 ? 0 : Math.cos(u * Math.PI / 2) ** 2);
  return o.amp * c2((z - o.z) / o.lz) * c2((y - o.y) / o.ly);
}
/** Push a lofted skin outward (±X) by a smooth bell h(z, y) on both sides and tilt the normals to match (DSI bump). */
function bulge(m, o) {
  const { p, n } = m, c2 = (u) => (Math.abs(u) >= 1 ? 0 : Math.cos(u * Math.PI / 2) ** 2), d2 = (u) => (Math.abs(u) >= 1 ? 0 : -Math.PI / 2 * Math.sin(u * Math.PI));
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (Math.abs(x) < 0.2 || (o.side && Math.sign(x) !== o.side)) continue;
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
  const { SC, livery, cCowl, fus, W, fins, FIN, finAt, cFus, cWT, cWB, cST, cSB, cFin, cBoom, cPanel, cNoz, skinF, NZ } = o, F = K.FINISH;
  const tape = { color: SC.tape, rough: 0.52, metal: 0.12, height: 0.12 };
  const mark = SC.mark;
  const rnd = (() => { let a = 4242; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const TP = 2.2;                                                       // tape width on the unwrap chart (px)
  const W8 = SC.weather ?? 1;                                           // weathering amount for this airframe
  const halo = { color: SC.halo || '#7b7f81', rough: 0.68, metal: 0.03 };   // oxidised / chalky coating either side of the RAM tapes
  // blotchy in-service look: soft lighter (oxidised) and darker (fresh touch-up) patches; ra/rb radii in chart units
  const blotch = (Q, n, a0, a1, b0, b1, ra, rb, k = 1) => {
    for (let i = 0; i < n; i++) {
      const a = a0 + rnd() * (a1 - a0), b = b0 + rnd() * (b1 - b0), light = rnd() < 0.62, sz = 0.5 + rnd();
      Q.fill((g) => g.ellipse(a, b, ra * sz, rb * sz * (0.6 + rnd() * 0.8), 0, 0, Math.PI * 2), light ? halo : { color: '#3b3d3e', rough: 0.56, metal: 0.06 }, { alpha: (0.035 + rnd() * 0.06) * W8 * k, feather: 5 });
    }
  };
  const touchUp = (Q, a, b, wa, wb) => Q.fill((g) => g.rect(a, b, wa, wb), { color: SC.skin, rough: 0.55, metal: 0.08 }, { alpha: 0.55 * Math.min(1, W8) });

  // ================= fuselage (unwrap: a = z, b = t) =================
  const P = atlas.pen(cFus);
  P.fill('all', skinF);
  const tl = (pts, px = TP) => {
    const path = (g) => pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    P.stroke(path, 0, halo, { px: px * 4.5, alpha: 0.1 * W8 });
    P.stroke(path, 0, tape, { px });
  };
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
  { sawPanel(-2.65, -2.0, 0.475, 0.525, 1, 0.08); P.fill((g) => g.rect(-2.55, 0.49, 0.45, 0.02), { color: '#4a4e51', rough: 0.6, metal: 0.2 }); }
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
  P.decalOn(-2.0, 0.62, 'L', { layers: ['color', 'height'] }, (g, layer) => {
    if (layer === 'height') { g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.ellipse(0.2, 0, 0.75, 0.09, 0, 0, Math.PI * 2); g.fill(); return; }
    g.fillStyle = '#1d1f20'; g.beginPath(); g.ellipse(-0.45, 0, 0.12, 0.05, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = SC.tape; g.lineWidth = 0.02; g.beginPath(); g.ellipse(0.2, 0, 0.75, 0.09, 0, 0, Math.PI * 2); g.stroke();
  });
  // markings
  if (SC.star === 'usaf') P.textOn('U.S. AIR FORCE', -1.0, 0.5, 'both', 0.075, { color: mark, weight: 700 });
  if (livery === 'raaf') P.textOn('ROYAL AUSTRALIAN AIR FORCE', -1.0, 0.5, 'both', 0.06, { color: mark, weight: 700 });
  P.textOn('RESCUE', -5.6, 0.32, 'both', 0.04, { color: mark });
  P.decalOn(-5.95, 0.32, 'both', (g) => { g.strokeStyle = mark; g.lineWidth = 0.014; g.beginPath(); g.moveTo(-0.12, 0); g.lineTo(0.08, 0); g.moveTo(0.02, -0.045); g.lineTo(0.09, 0); g.lineTo(0.02, 0.045); g.stroke(); });
  if (livery !== 'lowvis') P.textOn(livery === 'raaf' ? 'SQNLDR J. MORGAN' : 'MAJ T. "VAPOR" REYES', -4.6, 0.3, 'L', 0.035, { color: mark });
  // DAS (distributed aperture system) windows: faceted dark glossy apertures with a tape surround
  const das = (g, layer, w = 0.075, h = 0.055) => {
    const hex = () => { g.beginPath(); g.moveTo(-w, 0); g.lineTo(-w * 0.55, -h); g.lineTo(w * 0.55, -h); g.lineTo(w, 0); g.lineTo(w * 0.55, h); g.lineTo(-w * 0.55, h); g.closePath(); };
    if (layer === 'orm') { g.fillStyle = 'rgb(255,30,150)'; hex(); g.fill(); return; }
    if (layer === 'height') { g.fillStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.014; g.strokeStyle = 'rgba(255,255,255,0.35)'; hex(); g.stroke(); return; }
    g.strokeStyle = SC.tape; g.lineWidth = 0.016; hex(); g.stroke(); g.fillStyle = '#16191b'; hex(); g.fill();
    g.fillStyle = 'rgba(120,110,160,0.25)'; g.beginPath(); g.ellipse(-w * 0.2, -h * 0.3, w * 0.35, h * 0.3, 0, 0, Math.PI * 2); g.fill();
  };
  const DL = { layers: ['color', 'orm', 'height'] };
  P.decalOn(-6.95, 0.5, 'both', DL, (g, l) => das(g, l));                 // upper forward, either side of the windscreen
  P.decalOn(-7.55, -0.12, 'both', DL, (g, l) => das(g, l));               // chin, looking down and sideways
  P.decalT(-3.05, 0.5, DL, (g, l) => das(g, l));                          // dorsal, behind the canopy
  P.decalT(2.95, 0.0, DL, (g, l) => das(g, l));                           // ventral, aft of the weapon bays
  // weapon bay door seams (real gaps), centre keel line
  for (const s of [0, 1]) { const a = 0.006, b = 0.068, t0 = s ? 1 - b : a, t1 = s ? 1 - a : b; for (const t of [t0, t1]) P.line([[-1.9, t], [2.7, t]], { px: 1.2, depth: 0.6, dark: 0.22 }); }
  P.line([[-1.9, 0.0], [2.7, 0.0]], { px: 1.6, depth: 0.7, dark: 0.3 }); P.line([[-1.9, 1.0], [2.7, 1.0]], { px: 1.6, depth: 0.7, dark: 0.3 });
  // formation light strips
  for (const [z, y] of [[-6.3, 0.05], [3.4, 0.0]]) P.decalOn(z, y, 'both', { layers: ['color', 'orm'] }, (g, layer) => { g.fillStyle = layer === 'orm' ? 'rgb(255,90,0)' : '#bfc4a0'; g.fillRect(-0.25, -0.02, 0.5, 0.04); });
  // weathering: tonal variation, belly grime, exhaust staining
  P.noise({ alpha: 0.07, scale: 2.2, stretch: [1.6, 1], rough: 0.05 });
  P.noise({ alpha: 0.04, scale: 0.7, mode: 'light' });
  blotch(P, 70, -8.5, 4.9, 0.02, 0.98, 0.3, 0.025);
  for (const [z, t, wz, wt] of [[-1.3, 0.36, 0.5, 0.03], [1.8, 0.62, 0.7, 0.025], [-5.4, 0.28, 0.4, 0.02], [3.3, 0.4, 0.35, 0.03]]) touchUp(P, z, t, wz, wt);
  // boot scuffs on the left upper fuselage behind the canopy (ladder side) and around the refuelling door
  for (let i = 0; i < 9; i++) { const z = -3.3 + rnd() * 1.1, t = 0.56 + rnd() * 0.08; P.fill((g) => g.ellipse(z, t, 0.06 + rnd() * 0.05, 0.006, 0, 0, Math.PI * 2), { color: '#2c2c2b', rough: 0.8, metal: 0 }, { alpha: 0.12 * W8, feather: 3 }); }
  for (let i = 0; i < 22; i++) { const z = -2.5 + rnd() * 6.5, t = (rnd() < 0.5 ? 0.02 : 0.9) + rnd() * 0.08; P.streak(z, t, z + 0.5 + rnd() * 1.2, t, 0.008 + rnd() * 0.012, { alpha: 0.08 + rnd() * 0.1 }); }
  // exhaust heat discolouration of the aft fuselage around the nozzle shroud (bronze → soot)
  P.fill((g) => g.rect(4.2, 0, 0.85, 1), { color: '#5a4a3a', rough: 0.6, metal: 0.25 }, { alpha: 0.18 * W8, feather: 12 });
  P.fill((g) => g.rect(4.65, 0, 0.4, 1), { color: '#2a2622', rough: 0.7, metal: 0.1 }, { alpha: 0.3 * W8, feather: 8 });

  // ================= intake cowls (side projections, one per side so markings read correctly) =================
  for (const key of ['R', 'L']) {
    const Q = atlas.pen(cCowl[key]); Q.fill('all', skinF);
    const ln = (pts, w = 0.03) => Q.stroke((g) => pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))), w, tape);
    ln([[-3.5, 0.215], [-1.4, 0.27]]); ln([[-3.86, -0.56], [-1.4, -0.66]]);
    // saw-tooth access door behind the lip and a small vent panel
    const pts = []; for (let i = 0; i <= 4; i++) pts.push([-3.15 + (i % 2) * 0.07, 0.1 - i * 0.14]); for (let i = 4; i >= 0; i--) pts.push([-2.82 + (i % 2) * 0.07, 0.1 - i * 0.14]); pts.push(pts[0]);
    ln(pts, 0.025);
    ln([[-2.05, -0.38], [-1.7, -0.38], [-1.7, -0.52], [-2.05, -0.52], [-2.05, -0.38]], 0.02);
    if (SC.star === 'usaf') Q.decal(-2.35, -0.12, (g) => K.drawStarBar(g, 0.4, { lowVis: SC.mark })); else Q.decal(-2.35, -0.12, (g) => roundel(g, 0.19, SC.mark));
    Q.text('DANGER', -3.3, -0.2, 0.035, { color: '#7d3a33', weight: 700 });
    Q.decal(-3.3, -0.27, (g) => { g.strokeStyle = '#7d3a33'; g.lineWidth = 0.012; g.beginPath(); g.moveTo(-0.08, 0.03); g.lineTo(0, -0.03); g.lineTo(0.08, 0.03); g.stroke(); });
    Q.noise({ alpha: 0.07, scale: 1.2, rough: 0.05 }); Q.noise({ alpha: 0.04, scale: 0.5, mode: 'light' });
    blotch(Q, 10, -3.6, -1.5, -0.6, 0.2, 0.2, 0.15);
  }
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
      const t2 = (pts, w = 0.035) => { const path = (g) => pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); Q.stroke(path, w * 4, halo, { alpha: 0.1 * W8 }); Q.stroke(path, w, tape); };
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
      blotch(Q, 26, s > 0 ? 1.0 : -5.3, s > 0 ? 5.3 : -1.0, -1.8, 3.4, 0.28, 0.28, isTop ? 1 : 0.6);
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
    const t2 = (pts, w = 0.035) => { const path = (g) => pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); Q.stroke(path, w * 4, halo, { alpha: 0.1 * W8 }); Q.stroke(path, w, tape); };
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
    blotch(Q, 12, 2.3, 5.6, 0.45, 2.7, 0.2, 0.2, outer ? 1 : 0.6);
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
    const Q = atlas.pen(cPanel); Q.fill('all', { color: '#121314', rough: 0.6, metal: 0 });
    const em = (col, k = 0.75) => { const c = parseInt(col.slice(1), 16), f = (v) => Math.round(((c >> v) & 255) * k).toString(16).padStart(2, '0'); return '#' + f(16) + f(8) + f(0); };
    const win = (a, b, w, h, col) => Q.fill((g) => g.rect(a, b, w, h), { color: col, rough: 0.12, metal: 0, emissive: em(col) });
    // two 10 x 8 in portals of the panoramic display, black bezel, glass
    for (const a0 of [0.012, 0.366]) Q.fill((g) => g.rect(a0, 0.01, 0.342, 0.275), { color: '#050506', rough: 0.1, metal: 0 });
    // left portal: moving map (terrain + water + route) and a situation display
    win(0.02, 0.02, 0.2, 0.19, '#3d4a2c'); win(0.06, 0.12, 0.09, 0.05, '#1f3d5a'); win(0.135, 0.03, 0.06, 0.06, '#57553a');
    win(0.226, 0.02, 0.122, 0.12, '#07100c'); win(0.226, 0.146, 0.122, 0.064, '#0b1218'); win(0.02, 0.216, 0.328, 0.062, '#0c1116');
    // right portal: tactical situation display + engine / fuel page
    win(0.374, 0.02, 0.21, 0.258, '#081018'); win(0.59, 0.02, 0.108, 0.125, '#0b0f0c'); win(0.59, 0.152, 0.108, 0.126, '#101418');
    Q.decal(0, 0, { layers: ['color', 'emis'] }, (g) => {
      g.lineWidth = 0.0025; g.strokeStyle = '#d8e4e8'; g.beginPath(); g.moveTo(0.04, 0.19); g.lineTo(0.09, 0.1); g.lineTo(0.17, 0.08); g.lineTo(0.2, 0.04); g.stroke();
      g.strokeStyle = '#3fd36a'; for (const r of [0.03, 0.055, 0.08]) { g.beginPath(); g.arc(0.479, 0.15, r, 0, Math.PI * 2); g.stroke(); }
      g.beginPath(); g.moveTo(0.287, 0.04); g.lineTo(0.287, 0.13); g.moveTo(0.24, 0.08); g.lineTo(0.334, 0.08); g.stroke();
      g.fillStyle = '#e8d24a'; for (const [x, y] of [[0.45, 0.09], [0.52, 0.12], [0.5, 0.2], [0.3, 0.06]]) { g.beginPath(); g.moveTo(x, y - 0.007); g.lineTo(x + 0.007, y + 0.006); g.lineTo(x - 0.007, y + 0.006); g.fill(); }
      g.fillStyle = '#e04a3a'; for (const [x, y] of [[0.43, 0.06], [0.55, 0.07]]) g.fillRect(x - 0.005, y - 0.005, 0.01, 0.01);
      g.fillStyle = '#3fd36a'; for (let i = 0; i < 4; i++) g.fillRect(0.6 + i * 0.024, 0.13 - 0.03 - i * 0.015, 0.012, 0.03 + i * 0.015);
      g.fillStyle = '#8fd0ff'; for (let i = 0; i < 6; i++) g.fillRect(0.03 + i * 0.053, 0.235, 0.04, 0.012);
    });
    for (let i = 0; i < 8; i++) Q.fill((g) => g.rect(0.03 + i * 0.085, 0.286, 0.05, 0.01), { color: '#2e3032', rough: 0.5, metal: 0 });
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
