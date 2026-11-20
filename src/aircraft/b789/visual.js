// Boeing 787-9 Dreamliner — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (4.2 m) when parked.
//
// Reference numbers (docs/aircraft/b789.md; d = distance aft of the nose tip, z = d - 29.9):
//   length 62.81 m, span 60.12 m (raked tips), height 17.02 m (fin tip at y = 12.82).
//   Fuselage: oval 5.78 m wide x 5.95 m tall centred on y = 0 (crown 2.95, keel -3.0) from d 11 to d 44; short drooped
//   radome, the flight-deck windows are four swept "cat-eye" panes on the shoulders of the nose (windshield d 2.75-3.95,
//   side panes to d 5.9, eye at d 4.6 / y 1.25); upswept blunt tail cone ending in the APU exhaust (d 62.8, y 0.3-1.5).
//   Wing: LE z -7.9 / chord 10.6 at the body side (x 2.9), kink x 11 (LE z -2.3, chord 6.8), x 28 (LE z 8.3, chord 2.8)
//   then a raked tip to x 30.06 (chord 1.3); LE sweep 35° inboard / 32° outboard / ~54° on the rake; dihedral 6.5° from
//   y -1.25 at the body side (ground shape; it bends up ~2.6 m at the tip at 1 g in flight, morph driven by the load factor).
//   Supercritical section 13 % → 8.5 %. Krueger inboard, slats outboard of the pylon, single-slotted flaps, flaperon
//   behind the engine, outboard aileron, 7 spoilers per side.
//   Engines (GEnx-1B): fan 2.82 m, nacelle Ø 3.25 m, inlet lip at z -8.6 (x ±9.5, y -2.1), fan cowl 4.9 m, chevroned bypass
//   and core nozzles, translating reverser sleeves; installed 1.5° nose down.
//   Tail: stab span 19.2 m, LE 35°, root LE z 20.9 (chord 6.4) at y 0.75, 6° dihedral; fin root LE z 15.6 (chord 9.5),
//   tip chord 3.3 at y 12.82, LE sweep 43°, single rudder.
//   Gear: nose twin wheels (z -23.3, retracts forward), main 6-wheel bogies (x ±5.35, z 2.3, axles 1.4 m apart, tilt
//   toes-up when airborne) retracting inboard into the wing-body fairing.
// The airline liveries are invented for this simulator: they do not reproduce any real operator's name or marks.
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
export const LIVERIES = ['halcyra', 'tidewind', 'house'];

// Emblems are drawn in metres around (0, 0), y down, `k` = scale (1 ≈ the 5 m fin version).
function kingfisher(g, k, col) {            // Halcyra: two swept wing arcs over a dot (a stylised diving kingfisher)
  g.save(); g.scale(k, k); g.fillStyle = col;
  for (const [r0, r1, a0, a1] of [[1.2, 2.6, -2.4, -0.25], [1.6, 2.2, 0.35, 1.2]]) { g.beginPath(); g.arc(0, 0, r1, a0, a1); g.arc(-0.3, 0.25, r0, a1, a0, true); g.closePath(); g.fill(); }
  g.beginPath(); g.arc(0.55, -0.35, 0.38, 0, TAU); g.fill(); g.restore();
}
function waveCrest(g, k, col, foam) {        // Tidewind: a breaking wave ribbon with a foam line
  g.save(); g.scale(k, k); g.lineCap = 'round';
  const rib = (dy, w, c) => { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(-2.6, 1.8 + dy); g.bezierCurveTo(-1.2, 2.8 + dy, 0.3, 1.6 + dy, 0.6, 0.2 + dy); g.bezierCurveTo(0.9, -1.0 + dy, 1.8, -1.5 + dy, 2.7, -1.2 + dy); g.stroke(); };
  rib(0, 0.62, col); rib(0.8, 0.22, foam); g.restore();
}
function skyMark(g, k, col, acc) {           // Skyward: an upswept chevron over a horizon line
  g.save(); g.scale(k, k); g.fillStyle = col;
  g.beginPath(); g.moveTo(-2.2, 1.0); g.lineTo(0, -1.6); g.lineTo(2.2, 1.0); g.lineTo(1.3, 1.0); g.lineTo(0, -0.4); g.lineTo(-1.3, 1.0); g.closePath(); g.fill();
  g.fillStyle = acc; g.fillRect(-2.4, 1.35, 4.8, 0.32); g.restore();
}

const SCHEMES = {
  halcyra: { name: 'Halcyra', title: 'HALCYRA', reg: 'ZZ-HCA', body: '#f5f6f7', belly: '#1b2a4a', cheat: '#d8a942', tail: '#1b2a4a', engine: '#1b2a4a', spinner: '#d8a942', swirl: '#1b2a4a', tip: '#1b2a4a', titleColor: '#1b2a4a', font: 'serif', style: 'wave',
    emblem: (g, k) => kingfisher(g, k, '#d8a942'),
    nacMotif: (Q, sF, sMax) => { Q.fill((g) => g.rect(sMax - 0.42, -1, 0.07, 3), F0.gloss('#d8a942')); for (const t of [0.25, 0.75]) Q.decalT(sF + 1.0, t, { girth: 10.2 }, (g) => kingfisher(g, 0.17, '#d8a942')); } },
  tidewind: { name: 'Tidewind', title: 'tidewind', reg: 'ZZ-TDW', body: '#f6f7f6', belly: '#c9cdd1', cheat: '#f06a4f', tail: '#0f7f86', engine: '#f6f7f6', spinner: '#0f7f86', swirl: '#f6f7f6', tip: '#f06a4f', titleColor: '#0f7f86', font: 'round', style: 'ribbon', engineMark: '#5c6166',
    emblem: (g, k) => waveCrest(g, k, '#f06a4f', '#ffffff'),
    nacMotif: (Q, sF, sMax) => { for (const t of [0.25, 0.75]) Q.decalT(sF + 0.9, t, { girth: 10.2 }, (g) => { waveCrest(g, 0.3, '#0f7f86', '#f06a4f'); }); Q.fill((g) => g.rect(sMax - 0.5, -1, 0.5, 3), F0.gloss('#0f7f86')); } },
  house: { name: 'Skyward demonstrator', title: 'SKYWARD', reg: 'ZZ-SK9', body: '#eef0f1', belly: '#3b4148', cheat: '#19b3a6', tail: '#3b4148', engine: '#eef0f1', spinner: '#3b4148', swirl: '#19b3a6', tip: '#19b3a6', titleColor: '#3b4148', font: 'wide', style: 'bands', engineMark: '#5c6166',
    emblem: (g, k) => skyMark(g, k, '#ffffff', '#19b3a6'),
    nacMotif: (Q, sF, sMax) => { Q.fill((g) => g.rect(sF + 0.05, -1, 0.18, 3), F0.gloss('#19b3a6')); for (const t of [0.25, 0.75]) Q.decalT(sF + 1.1, t, { girth: 10.2 }, (g) => K.drawText(g, '787-9', 0.22, { color: '#3b4148', font: K.FONT.wide, weight: 700 })); } },
};
const F0 = K.FINISH;

const NZ = -29.9;                      // nose tip z
const D = (d) => d + NZ;               // distance from the nose → body z

// ---- planform helpers (right wing) ------------------------------------------------------------------------------------------
const XT = 30.06, KS = 0.646;
const zLE = (x) => (x <= 11 ? -7.9 + 0.6914 * (x - 2.9) : x <= 28 ? -2.3 + 0.6249 * (x - 11) : 8.32 + 1.40 * (x - 28));
const zTE = (x) => (x <= 11 ? 2.7 + 0.2222 * (x - 2.9) : x <= 28 ? 4.5 + 0.388 * (x - 11) : 11.1 + 0.70 * (x - 28));
const wy = (x) => -1.25 + Math.tan(6.5 * DEG) * (x - 2.9);
// in-flight wing bending (metres up at 1 g), zero inboard of x = 3.5
const FLEX_TIP = 2.6, FLEX_X0 = 3.5;
const bend = (x) => { const a = Math.abs(x); return a <= FLEX_X0 ? 0 : FLEX_TIP * Math.pow((a - FLEX_X0) / (XT - FLEX_X0), 2); };

// engine: inlet highlight centre (geometry.js engines[].intake) and nacelle shape
const EX = 9.5, EY = -2.1, EZ = -8.6, TILT = 1.5 * DEG;
const NAC_DROOP = 0.05;
const NAC = { length: 4.9, rHi: 1.44, rMax: 1.62, rThroat: 1.36, rFan: 1.41, zFan: 0.95, rExit: 1.28, sleeve: 0.55, core: { r0: 0.95, r1: 0.58, length: 1.9 }, plug: { r: 0.36, length: 1.15 } };

/** Arc-length parameter of the kit nacelle's fold-over cowl loft at its stations (mirrors propulsion.js nacelle()), so the
 *  nacelle chart can be painted by axial position: { sIn (inside the lip), sLip, sOut, zs, ss, sMax }. */
function nacelleS(N) {
  const L = N.length, zS = L * N.sleeve, rTh = N.rThroat, rAt = (z) => N.rMax - (N.rMax - N.rExit) * Math.pow(Math.max(0, (z - L * 0.4) / (L * 0.6)), 1.6);
  const st = [[N.zFan + L * 0.12, N.rFan, 0], [N.zFan, N.rFan, 0], [N.zFan * 0.6, (rTh + N.rFan) / 2, 0.3], [L * 0.06, rTh, 0.8], [0.012, N.rHi - 0.022, 1], [0, N.rHi, 1], [0.012, N.rHi + 0.022, 1]];
  for (const z of [L * 0.035, L * 0.1, L * 0.22, L * 0.4]) if (z < zS - 0.05) st.push([z, z > L * 0.3 ? rAt(z) : N.rHi + (N.rMax - N.rHi) * Math.sqrt(Math.min(1, z / (L * 0.3))), z < L * 0.3 ? 1 : 0.5]);
  st.push([zS, rAt(zS), 0.15]);
  const s = [0];
  for (let i = 1; i < st.length; i++) { const dz = st[i][0] - st[i - 1][0], dr = st[i][1] - st[i - 1][1], dy = -NAC_DROOP * (st[i][2] - st[i - 1][2]); s.push(s[i - 1] + Math.hypot(dz, dr, dr, dy)); }
  return { sIn: s[4], sLip: s[5], sOut: s[6], zs: st.slice(5).map(r => r[0]), ss: s.slice(5), sMax: s[s.length - 1] };
}

/** Sawtooth chevron ring at a nozzle exit: n triangular teeth from radius r at z, tips `len` aft and `inward` closer to the axis. */
function chevrons(c, z, r, n, len, inward, uv) {
  const m = new K.Mesh();
  for (let i = 0; i < n; i++) {
    const a0 = i / n * TAU, a1 = (i + 1) / n * TAU, am = (a0 + a1) / 2;
    const P = (a, rr, zz) => [c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a), zz];
    const p = [P(a0, r, z), P(a1, r, z), P(am, r - inward, z + len)];
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const out = nx * Math.cos(am) + ny * Math.sin(am) > 0 ? 1 : -1;
    for (const sg of [1, -1]) {
      const s = sg * out, ids = p.map(q => m.vert(q[0], q[1], q[2], nx * s, ny * s, nz * s, uv[0], uv[1]));
      if (sg > 0) { if (out > 0) m.tri(ids[0], ids[1], ids[2]); else m.tri(ids[0], ids[2], ids[1]); }
      else if (out > 0) m.tri(ids[0], ids[2], ids[1]); else m.tri(ids[0], ids[1], ids[2]);
    }
  }
  return m;
}

/** Morph target = vertices raised by fn(x, z) (wing bending). */
function flexMorph(m, fn) {
  m.enableMorph();
  for (let i = 0; i < m.p.length; i += 3) m.p2[i + 1] = m.p[i + 1] + fn(m.p[i], m.p[i + 2]);
  return m;
}

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'halcyra', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const rig = K.createRig(ctx, { geometry: G, name: 'b789', glassLayer: opts.glassLayer, cockpitRadius: 1.4 });

  // ---- atlases: A = fuselage + flight deck + gear, B = wings, tail, nacelles ---------------------------------------------------
  // composite barrels: almost no oil-canning, fine frame pitch only shows in grazing light; a clean, well-kept gloss finish
  const skinA = { weathering: 0.22, waviness: 0.12, framePitch: 0.5, orangePeel: 0.6, clearcoat: 0.85 };
  const A = K.createAtlas({ size: atlasSize, base: F.gloss(SC.body), swatchRows: 3, skin: skinA });
  const cFus = A.chart('fus', { type: 'unwrap', z: [-29.95, 33.0], girth: 18.6, vScale: 0.8, strips: 2 });
  const cPed = A.chart('pedestal', { type: 'rect', w: 0.5, h: 1.1, density: 1.6, ao: false });
  const cOver = A.chart('overhead', { type: 'rect', w: 0.7, h: 1.0, density: 1.6, ao: false });
  A.pack();
  const fairCol = SC.style === 'wave' ? SC.belly : SC.style === 'bands' ? SC.belly : '#c9cdd1';
  const UA = {
    fair: A.swatch('fair', F.gloss(fairCol)),
    dark: A.swatch('dark', F.darkGrey), black: A.swatch('black', F.black), well: A.swatch('well', { color: '#8b9094', rough: 0.7, metal: 0.1 }), liner: A.swatch('liner', { color: '#b8b4ab', rough: 0.8, metal: 0 }),
    post: A.swatch('post', { color: '#4b4a48', rough: 0.7, metal: 0 }), floor: A.swatch('floor', { color: '#34363a', rough: 0.9, metal: 0 }), shield: A.swatch('shield', { color: '#1b1c1e', rough: 0.85, metal: 0 }),
    seat: A.swatch('seat', { color: '#5b5e63', rough: 0.9, metal: 0 }), sheep: A.swatch('sheep', { color: '#a59f8f', rough: 1, metal: 0 }), yoke: A.swatch('yoke', { color: '#17181a', rough: 0.5, metal: 0 }),
    frame: A.swatch('frame', { color: '#3a3c3f', rough: 0.6, metal: 0.1 }), wiper: A.swatch('wiper', { color: '#141516', rough: 0.5, metal: 0.3 }),
    exhaust: A.swatch('exhaust', F.exhaust), steel: A.swatch('steel', F.steel), antenna: A.swatch('antenna', F.gloss('#e9e9e6')), door: A.swatch('door', F.gloss(fairCol)),
  };
  const B = K.createAtlas({ size: atlasSize, base: F.semigloss('#b8bdc2'), swatchRows: 3, skin: { weathering: 0.3, waviness: 0.2, framePitch: 0.55, orangePeel: 0.6, clearcoat: 0.85 } });
  // wing charts are sheared along the leading-edge sweep (paint coords a = x, b = z - KS x): half the texels of a plan box
  const cWT = B.chart('wingTop', { type: 'proj', u: [1, 0, 0], v: [-KS, 0, 1], a: [0.9, 30.3], b: [-10.2, 2.0], mirror: true });
  const cWB = B.chart('wingBot', { type: 'proj', u: [1, 0, 0], v: [-KS, 0, 1], a: [0.9, 30.3], b: [-10.2, 2.0], mirror: true, flip: true, density: 0.7 });
  const cSt = B.chart('stab', { type: 'plan', x: [0.4, 9.9], z: [20.2, 29.4], view: 'top', mirror: true, density: 0.85 });
  const NS = nacelleS(NAC);
  const cNac = B.chart('nac', { type: 'unwrap', z: [0, NS.sMax], girth: 10.2, vScale: 0.8, density: 1.25 });
  const cSlv = B.chart('sleeve', { type: 'unwrap', z: [0, 4.6], girth: 8.6, vScale: 0.8, density: 0.75 });
  const cFin = { L: B.chart('finL', { type: 'side', z: [11.6, 28.6], y: [2.1, 13.0], view: 'left' }), R: B.chart('finR', { type: 'side', z: [11.6, 28.6], y: [2.1, 13.0], view: 'right' }) };
  B.pack();
  const UB = {
    grey: B.swatch('grey', F.semigloss('#b8bdc2')), engine: B.swatch('engine', F.gloss(SC.engine)), lip: B.swatch('lip', F.polished), duct: B.swatch('duct', { color: '#2a2c2f', rough: 0.55, metal: 0.3 }),
    acoustic: B.swatch('acoustic', { color: '#8a8d8f', rough: 0.6, metal: 0.6 }), core: B.swatch('core', F.semigloss('#c4c7c9')), plug: B.swatch('plug', { color: '#6b655d', rough: 0.45, metal: 0.85 }), blade: B.swatch('blade', { color: '#2f3237', rough: 0.3, metal: 0.7 }),
    spinner: B.swatch('spinner', F.gloss(SC.spinner)), swirl: B.swatch('swirl', F.gloss(SC.swirl || '#f2f2ee')), inner: B.swatch('inner', F.primer), pylon: B.swatch('pylon', F.gloss(SC.style === 'bands' ? SC.body : '#e9ebec')),
    tail: B.swatch('tail', F.gloss(SC.tail)), cascade: B.swatch('cascade', { color: '#3a3c3f', rough: 0.6, metal: 0.7 }), wick: B.swatch('wick', F.black), canoe: B.swatch('canoe', F.semigloss('#c9cdd0')),
    chevron: B.swatch('chevron', F.gloss(SC.engine)), hot: B.swatch('hot', { color: '#7a7068', rough: 0.42, metal: 0.9 }),
  };

  // ---- fuselage -------------------------------------------------------------------------------------------------------------
  //          d      top    bot    w        (top / bot = absolute body heights of crown and keel, w = half-width)
  // The nose: a short drooped radome whose crown line rises in one smooth S from the tip through the windshield to the cabin
  // crown (no eyebrow, no break at the radome joint); dense rings ahead of d 7.5 keep the flush windshield panels exact.
  const FS = [
    [0.00, -0.42, -0.42, 0.00, 4], [0.10, -0.15, -0.73, 0.32, 4], [0.40, 0.11, -1.02, 0.64, 4], [1.00, 0.43, -1.39, 1.05, 5], [1.80, 0.71, -1.77, 1.45, 5],
    [2.60, 0.99, -2.05, 1.785, 5], [3.30, 1.34, -2.27, 2.03, 5], [4.00, 1.72, -2.45, 2.24, 6], [5.00, 2.16, -2.64, 2.46, 6], [6.20, 2.50, -2.80, 2.65, 5],
    [7.50, 2.74, -2.90, 2.78], [9.00, 2.88, -2.96, 2.86], [10.5, 2.94, -2.99, 2.885], [12.0, 2.95, -3.00, 2.89],
    [44.0, 2.95, -3.00, 2.89], [46.5, 2.93, -2.93, 2.87], [49.0, 2.86, -2.68, 2.72], [52.0, 2.70, -2.15, 2.40], [55.0, 2.48, -1.55, 1.98],
    [57.5, 2.25, -1.05, 1.52], [60.0, 1.96, -0.45, 1.00], [61.8, 1.70, 0.02, 0.62], [62.81, 1.48, 0.30, 0.38],
  ].map(r => { const yc = (r[1] + r[2]) / 2 - (r[3] > 0 && r[0] < 12 ? 0.08 * (1 - r[0] / 12) : 0); const s = { z: D(r[0]), y: yc, w: r[3], top: r[1] - yc, bot: yc - r[2] }; if (r[4]) s.sub = Math.max(2, Math.round(r[4] * detail)); return s; });
  const fseg = Math.max(40, Math.round(96 * detail / 4) * 4);
  const fus0 = K.loft({ stations: FS, segments: 32, step: 2 });
  const tY = (d, y) => fus0.tAtY(D(d), y);
  // ---- flight-deck glazing: four flush panes (two windshields, two swept side windows) ------------------------------------------
  // right-hand panes in (d, t): W1 windshield [inner-low, outer-low, outer-top, inner-top], W2 side [front-low, aft-low, aft-top, front-top]
  const T0 = 0.4935, DF = 2.45, ZBd = 6.0;
  const w1 = { a: [2.6, T0], b: [3.02, tY(3.02, 0.76)], c: [3.86, tY(3.86, 1.44)], e: [3.36, T0] };
  const w2 = { p: [3.15, tY(3.15, 0.76)], q: [5.55, tY(5.55, 0.84)], r: [4.98, tY(4.98, 1.46)], s: [3.99, tY(3.99, 1.5)] };
  const WIN = [[w1.a, w1.b, w1.c, w1.e], [w2.p, w2.q, w2.r, w2.s]].map(w => w.map(([d, t]) => [D(d), t]));
  const tLoFD = Math.floor(tY(4.0, 0.05) * fseg) / fseg;                 // bottom edge of the rebuilt skin, on a loft column
  const fus = K.loft({
    stations: FS, segments: fseg, step: 1.3 / detail, chart: cFus, capEnd: 'flat', capUV: UA.exhaust,
    cutouts: [{ name: 'ngd', z: [-26.3, -22.4], t: [0, 0.04], mirror: true }, { name: 'fd', z: [D(DF), D(ZBd)], t: [tLoFD, 1 - tLoFD] }],
  });
  cFus.body = fus;
  let captainMesh = null;
  const stA = new K.Mesh(), stB = new K.Mesh();
  stA.add(fus.mesh);
  stA.add(K.well(K.merge(fus.patches.ngdR, fus.patches.ngdL), 1.15, UA.well, [0, 1, 0]));

  // long, smooth wing-to-body fairing with the main-gear bays cut into its flat bottom
  //                     z     w     top   bot   yc
  const fairStations = [[-12.5, 1.0, 0.3, 0.42, -2.45], [-10.0, 2.1, 0.5, 0.72, -2.4], [-7.0, 2.85, 0.6, 0.86, -2.36], [-3.5, 3.2, 0.62, 0.9, -2.36], [0.0, 3.3, 0.62, 0.92, -2.36], [3.5, 3.32, 0.62, 0.92, -2.36],
    [6.0, 3.0, 0.75, 0.84, -2.3], [8.0, 2.5, 0.85, 0.7, -2.2], [10.0, 1.85, 0.8, 0.52, -2.12], [11.8, 0.9, 0.5, 0.3, -2.1]]
    .map(r => ({ z: r[0], y: r[4], w: r[1], top: r[2], bot: r[3], kTop: [0.42, 0.5], kBot: [0.86, 0.6] }));
  const fairOpts = { stations: fairStations, segments: Math.max(28, Math.round(48 * detail / 4) * 4), step: 0.9, uv: UA.fair };
  let fair = K.loft(fairOpts);
  const tAtX = (z, x) => { let lo = 0, hi = 0.25; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (fair.at(z, m).p[0] < x) lo = m; else hi = m; } return (lo + hi) / 2; };
  fair = K.loft({ ...fairOpts, cutouts: [{ name: 'mgw', z: [0.4, 4.6], t: [tAtX(2.5, 2.05), tAtX(2.5, 3.3)], mirror: true }] });
  stA.add(fair.mesh);
  for (const k of ['mgwR', 'mgwL']) stA.add(K.well(fair.patches[k], 1.9, UA.well, [0, 1, 0]));

  // ---- flight deck: the glazed part of the nose is rebuilt from (z, t) pieces — painted skin around the panes, real glass in
  // them, a lining inside and window reveals between — so the flight deck shows from outside and the pilot sees out ------------
  const eye = G.pilotEye, FY = eye[1] - 1.17, EY0 = eye[1];
  const fdGlass = new K.Mesh();
  {
    const z0 = D(DF), z1 = D(ZBd), tA = tLoFD, tB = 1 - tLoFD;
    const area = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
    const ccw = (P) => (area(P) > 0 ? P : P.slice().reverse());
    const wins = [];
    for (const w of WIN) { wins.push(ccw(w)); wins.push(ccw(w.map(([z, t]) => [z, 1 - t]))); }
    const clip = (poly, a, b, left) => {
      const out = [], side = (p) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * (left ? 1 : -1);
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length], sp = side(p), sq = side(q);
        if (sp >= 0) out.push(p);
        if ((sp >= 0) !== (sq >= 0)) { const f = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]); }
      }
      return out.length >= 3 && Math.abs(area(out)) > 1e-9 ? out : null;
    };
    const nz = Math.max(12, Math.round((z1 - z0) / 0.12 * detail)), jA = Math.round(tA * fseg), jB = Math.round(tB * fseg), nt = jB - jA;
    const skin = [], glass = [];
    for (let i = 0; i < nz; i++) for (let j = 0; j < nt; j++) {
      const za = z0 + (z1 - z0) * i / nz, zb = z0 + (z1 - z0) * (i + 1) / nz, ta = (jA + j) / fseg, tb = (jA + j + 1) / fseg;
      let pcs = [[[za, ta], [zb, ta], [zb, tb], [za, tb]]];
      for (const W of wins) {
        const next = [];
        for (const pc of pcs) {
          let rem = pc;
          for (let k = 0; k < W.length && rem; k++) { const o = clip(rem, W[k], W[(k + 1) % W.length], false); if (o) next.push(o); rem = clip(rem, W[k], W[(k + 1) % W.length], true); }
          if (rem) glass.push(rem);
        }
        pcs = next;
      }
      skin.push(...pcs);
    }
    // emit convex (z, t) polygons as a fan, offset `inset` inward along the normal, facing out (dir 1) or in (dir -1)
    const emit = (m, poly, inset, uvFn, dir) => {
      const v = poly.map(([z, t]) => { const s = fus.at(z, t); return { p: [s.p[0] - s.n[0] * inset, s.p[1] - s.n[1] * inset, s.p[2] - s.n[2] * inset], n: s.n, uv: uvFn(z, t) }; });
      const e1 = v[1].p.map((x, k) => x - v[0].p[k]), e2 = v[2].p.map((x, k) => x - v[0].p[k]);
      const gn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const flip = (gn[0] * v[0].n[0] + gn[1] * v[0].n[1] + gn[2] * v[0].n[2]) * dir < 0;
      const i0 = m.vertexCount;
      for (const q of v) m.vert(q.p[0], q.p[1], q.p[2], q.n[0] * dir, q.n[1] * dir, q.n[2] * dir, q.uv[0], q.uv[1]);
      for (let k = 1; k < v.length - 1; k++) if (flip) m.tri(i0, i0 + k + 1, i0 + k); else m.tri(i0, i0 + k, i0 + k + 1);
    };
    const skinUV = (z, t) => cFus.uvUnwrap(z, t), lin = new K.Mesh();
    for (const pc of skin) { emit(stA, pc, 0, skinUV, 1); emit(lin, pc, 0.07, () => UA.liner, -1); }
    for (const pc of glass) emit(fdGlass, pc, 0.004, () => [0, 0], 1);
    stA.add(lin.occlude(0.3));
    // window reveals: the frame depth between the skin and the lining, seen round every pane from inside and outside
    for (const W of wins) {
      for (let k = 0; k < W.length; k++) {
        const A0 = W[k], B0 = W[(k + 1) % W.length], n = 6;
        for (let i = 0; i < n; i++) {
          const P = [i / n, (i + 1) / n].map((f) => fus.at(A0[0] + (B0[0] - A0[0]) * f, A0[1] + (B0[1] - A0[1]) * f));
          const q = [P[0].p, P[1].p, P[1].p.map((x, kk) => x - P[1].n[kk] * 0.07), P[0].p.map((x, kk) => x - P[0].n[kk] * 0.07)];
          stA.add(K.plate(q[0], q[1], q[2], q[3], 0.004, UA.frame));
        }
      }
    }
    stA.add(K.deck(fus, z0 + 0.1, z1, FY, { uv: UA.floor, n: 8 }));                                         // floor
    stA.add(K.bulkhead(fus, z1, { uv: UA.liner, facing: -1 }));                                                 // flight-deck door wall
    stA.add(K.bulkhead(fus, z0 + 0.03, { uv: UA.shield, facing: 1 }));                                          // forward wall in the nose
    const zp = eye[2] - 0.82;                                                                                   // main instrument panel plane
    // main instrument panel (kit: PFD outboard + ND inboard per pilot, EICAS + standby in the centre, lit by day) under the MCP
    // glareshield, whose top stays below the sight line over the nose; narrowed toward the nose to stay inside the skin
    const eL = [-Math.abs(eye[0]), eye[1], eye[2]], eR = [Math.abs(eye[0]), eye[1], eye[2]];
    const panelMesh = K.instrumentPanel({ eyes: [eL, eR], kind: 'airline', hoodTaper: 0.75, dist: 0.68, drop: 0.69, height: 0.58, width: 2.2, mfd: 0.23, uv: UA.shield });
    stA.add(panelMesh);
    // centre pedestal: thrust levers, flap and speedbrake handles, two control-display units
    { const pz0 = zp + 0.22, pz1 = pz0 + 1.1, top = FY + 0.72;
      stA.add(K.box(0.52, top - FY, pz1 - pz0, UA.shield).translate(0, (top + FY) / 2, (pz0 + pz1) / 2));
      const i0 = stA.vertexCount; for (const [a, b] of [[0, 0], [0.5, 0], [0.5, 1.1], [0, 1.1]]) { const uv = cPed.uv(a, b); stA.vert(a - 0.25, top + 0.004 - b * 0.06, pz0 + b, 0, 1, 0.05, uv[0], uv[1]); } stA.quad(i0, i0 + 3, i0 + 2, i0 + 1);
      for (const x of [-0.07, 0.07]) stA.add(K.box(0.035, 0.18, 0.04, UA.yoke).rotateX(0.5).translate(x, top + 0.08, pz0 + 0.42));
      stA.add(K.box(0.03, 0.14, 0.03, UA.yoke).rotateX(0.4).translate(0.19, top + 0.06, pz0 + 0.45)); stA.add(K.box(0.03, 0.14, 0.03, UA.yoke).rotateX(0.4).translate(-0.2, top + 0.06, pz0 + 0.5)); }
    // overhead panel following the roof line
    { const i0 = stA.vertexCount; for (const [a, b] of [[0, 0], [0.7, 0], [0.7, 1.0], [0, 1.0]]) { const uv = cOver.uv(a, b), z = D(4.45) + b * 1.15; stA.vert(a - 0.35, fus.topAt(z) - 0.13, z, 0, -1, -0.25, uv[0], uv[1]); } stA.quad(i0, i0 + 1, i0 + 2, i0 + 3);
 }
    const hudG = new K.Mesh();
    for (const sx of [-1, 1]) {
      const e = [sx * Math.abs(eye[0]), eye[1], eye[2]];
      stA.add(K.crewSeat({ eye: e, uv: { frame: UA.seat, cushion: UA.sheep } }));
      const crew = K.pilot({ eye: e, kind: 'airline', recline: 8, stick: [0.18, -0.49, -0.45], throttle: [-0.18, -0.49, -0.45], uv: { suit: UA.seat, helmet: UA.seat, dark: UA.seat } }); if (sx < 0) captainMesh = crew; else stA.add(crew);   // the captain is its own part, hidden from the cockpit camera   // hands on the yoke horns
      stA.add(K.yoke({ base: [e[0], FY, e[2] - 0.56], top: [e[0], e[1] - 0.55, e[2] - 0.46], width: 0.36, uv: UA.yoke }));
      stA.add(K.box(0.34, 0.5, 1.15, UA.shield).translate(sx * 1.2, FY + 0.25, e[2] - 0.1));                        // side console (tiller, oxygen mask box)
      stA.add(K.box(0.24, 0.05, 0.3, UA.post).translate(sx * 1.2, FY + 0.52, e[2] - 0.45));
      for (const dz of [-0.06, 0.06]) stA.add(K.box(0.07, 0.05, 0.22, UA.yoke).rotateX(-0.6).translate(e[0] + dz * 2, FY + 0.18, zp + 0.05));   // rudder pedals
      // head-up display: combiner glass on a hinged arm hanging from the overhead projector
      const hz = e[2] - 0.43, hy = e[1] + 0.01, top = fus.topAt(hz + 0.31) - 0.24;
      hudG.add(K.box(0.2, 0.16, 0.006, [0, 0]).rotateX(-0.3).translate(e[0], hy, hz));
      stA.add(K.box(0.22, 0.018, 0.03, UA.yoke).translate(e[0], hy + 0.085, hz + 0.02));
      for (const s2 of [-1, 1]) stA.add(K.box(0.014, 0.17, 0.016, UA.yoke).rotateX(-0.3).translate(e[0] + s2 * 0.107, hy, hz));
      for (const s2 of [-1, 1]) stA.add(K.tube([e[0] + s2 * 0.1, hy + 0.09, hz + 0.03], [e[0] + s2 * 0.08, top, hz + 0.36], 0.008, 0.008, { segments: 5, uv: UA.yoke }));
      stA.add(K.box(0.18, 0.12, 0.28, UA.post).translate(e[0], top + 0.02, hz + 0.45));
    }
    rig.glass('hud', K.glassMaterial(ctx, K.GLASS.hud)); rig.addStatic(hudG, 'hud');
    // windshield wipers parked along the foot of each windshield
    for (const s of [1, -1]) {
      const T = (t) => (s > 0 ? t : 1 - t), A0 = WIN[0][0], B0 = WIN[0][1];
      const on = (f, h) => { const q = fus.at(A0[0] + (B0[0] - A0[0]) * f, T(A0[1] + (B0[1] - A0[1]) * f)); return q.p.map((x, k) => x + q.n[k] * h); };
      stA.add(K.tube(on(0.12, 0.03), on(0.86, 0.03), 0.009, 0.009, { segments: 5, uv: UA.wiper }));
      stA.add(K.tube(on(0.9, 0.02), on(0.55, 0.045), 0.012, 0.01, { segments: 5, uv: UA.wiper }));
      stA.add(K.box(0.06, 0.05, 0.06, UA.wiper).translate(...on(0.92, 0.02)));
    }
  }
  rig.glass('fdglass', K.glassMaterial(ctx, { ...K.GLASS.airliner, opacity: 0.38, dust: 0.02 })); rig.addStatic(fdGlass, 'fdglass');

  // ---- wings ----------------------------------------------------------------------------------------------------------------
  const wst = (x, tc, twist) => ({ x, y: wy(x), z: zLE(x), chord: zTE(x) - zLE(x), tc, twist });
  const sc = K.supercritical();
  const SPOIL = [[3.4, 6.9], [7.0, 10.5], [13.1, 14.95], [15.05, 16.9], [17.0, 18.85], [18.95, 20.75], [20.85, 22.4]];
  const wingOf = (side) => K.wing({
    side, airfoil: sc, chordPts: Math.round(16 * Math.min(1, detail)), spanAxis: 'x', tip: 'round', tipLength: 0.35,
    stations: [wst(1.0, 0.135, 2.5), wst(2.9, 0.13, 2.2), wst(11, 0.11, 0.5), wst(28, 0.09, -2.5), wst(XT, 0.085, -3)],
    lines: { slat: [[1.0, 0.12], [11, 0.12], [XT, 0.13]], spoil: [[1.0, 0.62], [11, 0.62], [XT, 0.64]], flap: [[1.0, 0.76], [11, 0.75], [22.6, 0.76], [XT, 0.78]] },
    controls: [
      { name: 'flapIn', type: 'flap', span: [3.1, 10.75], from: 'flap', nose: 1, tail: 0.3 },
      { name: 'flaperon', type: 'flap', span: [10.95, 12.85], from: 'flap', nose: 1 },
      { name: 'flapOut', type: 'flap', span: [13.05, 22.5], from: 'flap', nose: 1, tail: 0.3 },
      { name: 'aileron', type: 'flap', span: [22.7, 27.7], from: 'flap', nose: 1 },
      { name: 'slat', type: 'flap', span: [11.3, 27.9], to: 'slat', tail: 0.4, cove: true },
      { name: 'krueger', type: 'panel', surface: 'lower', span: [3.4, 8.2], to: 'slat', hinge: 'front', thickness: 0.04 },
      ...SPOIL.map((s, i) => ({ name: 'sp' + i, type: 'panel', surface: 'upper', span: s, from: 'spoil', to: 'flap', hinge: 'front' })),
    ],
    charts: { upper: cWT, lower: cWB }, innerUV: UB.inner, edgeUV: UB.grey,
  });
  const W = { R: wingOf(1), L: wingOf(-1) };
  const wingFlex = (x, z) => (z < 14.5 ? bend(x) : 0);
  stB.add(flexMorph(W.R.mesh, wingFlex)).add(flexMorph(W.L.mesh, wingFlex));
  // flap-track fairings ("canoes"): small pods, the front part fixed under the wing, the rear part rides on the flap
  const canoeAt = (x, len, side) => {
    const zf = W.R.at(x, 0.76, 'lower'), z0 = zf[2] - len * 0.45, y = zf[1] - 0.06;
    const st = [[0, 0.008, 0.008], [0.14, 0.06, 0.07], [0.38, 0.1, 0.15], [0.62, 0.1, 0.16], [0.86, 0.065, 0.1], [1, 0.008, 0.015]].map(r => ({ z: z0 + r[0] * len, x: side * x, y: y - r[2] * 0.45 + (r[0] > 0.62 ? (r[0] - 0.62) * 0.22 : 0), w: r[1], top: r[2] * 0.55, bot: r[2], kBot: 0.62 }));
    const split = zf[2] + 0.12;
    return { front: K.loft({ stations: st, segments: 12, step: 0.4, uv: UB.canoe, zRange: [z0, split] }).mesh, rear: K.loft({ stations: st, segments: 12, step: 0.4, uv: UB.canoe, zRange: [split, z0 + len], capStart: 'flat' }).mesh };
  };

  // ---- tail -------------------------------------------------------------------------------------------------------------------
  const sy = (x) => 0.75 + (x - 0.6) * Math.tan(6 * DEG), zLEs = (x) => 20.9 + (x - 0.6) * Math.tan(35 * DEG);
  const stabOf = (side) => K.wing({
    side, airfoil: K.naca4('0011'), chordPts: Math.round(11 * Math.min(1, detail)), spanAxis: 'x', tip: 'round', tipLength: 0.4,
    stations: [{ x: 0.6, y: sy(0.6), z: zLEs(0.6), chord: 6.4, tc: 0.11 }, { x: 9.6, y: sy(9.6), z: zLEs(9.6), chord: 1.9, tc: 0.09 }],
    lines: { hinge: [[0.6, 0.7], [9.6, 0.7]] },
    controls: [{ name: 'elevator', type: 'flap', span: [2.2, 9.3], from: 'hinge', nose: 1 }],
    charts: { upper: cSt, lower: cSt }, edgeUV: UB.grey,
  });
  const stab = { R: stabOf(1), L: stabOf(-1) };
  stB.add(stab.R.mesh).add(stab.L.mesh);
  const finLE = (y) => 15.6 + (y - 2.95) * Math.tan(43 * DEG), finTE = (y) => 25.1 + (y - 2.95) * (3.0 / 9.87);
  const fin = K.wing({
    airfoil: K.naca4('0011'), chordPts: Math.round(12 * Math.min(1, detail)), spanAxis: 'y', tip: 'round', tipLength: 0.45,
    stations: [{ x: 0, y: 2.1, z: finLE(2.1), chord: finTE(2.1) - finLE(2.1), tc: 0.11 }, { x: 0, y: 12.82, z: finLE(12.82), chord: finTE(12.82) - finLE(12.82), tc: 0.09 }],
    lines: { hinge: [[2.1, 0.7], [12.82, 0.7]] },
    controls: [{ name: 'rudder', type: 'flap', span: [2.75, 12.4], from: 'hinge', nose: 1 }],
    charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.tail,
  });
  stB.add(fin.mesh);
  stB.add(K.wing({ airfoil: K.naca4('0008'), chordPts: 6, spanAxis: 'y', tip: 'flat', uv: UB.tail, edgeUV: UB.tail,       // dorsal fillet
    stations: [{ x: 0, y: 2.7, z: 11.8, chord: 5.4, tc: 0.022 }, { x: 0, y: 3.75, z: 16.3, chord: 1.6, tc: 0.08 }] }).mesh);

  // ---- engines ----------------------------------------------------------------------------------------------------------------
  const eng = [], sleeveAll = new K.Mesh(), ENGB = bend(EX);
  let sleeveTravel = 0;
  for (const sx of [-1, 1]) {
    const c = [sx * EX, EY, EZ], fanZ = EZ + NAC.zFan;
    const tilt = (m) => m.translate(-c[0], -EY, -fanZ).rotateX(-TILT).translate(c[0], EY, fanZ);      // 1.5° nose down about the fan face
    const n = K.nacelle({ centre: c, ...NAC, droop: NAC_DROOP, segments: Math.max(28, Math.round(48 * detail / 4) * 4), chart: cNac, sleeveChart: cSlv,
      uv: UB.engine, uvInner: UB.acoustic, uvCore: UB.core, uvPlug: UB.plug, uvCascade: UB.cascade });
    const fixed = new K.Mesh().add(n.cowl).add(n.cascade).add(n.core).add(n.plug);
    fixed.add(K.fanBackdrop(NAC.rFan, 0.4, UB.duct).translate(c[0], c[1], n.fanZ));
    const exitZ = EZ + NAC.length, coreZ = exitZ + NAC.core.length, r1 = NAC.core.r1;
    // the painted core cowl ends in a band of heat-stained bare metal ahead of the chevroned core nozzle
    fixed.add(K.lathe([[r1 * 1.12 + 0.004, coreZ - EZ - 0.55], [r1 * 1.03 + 0.004, coreZ - EZ - 0.12], [r1 + 0.005, coreZ - EZ - 0.01, 1], [r1 - 0.03, coreZ - EZ - 0.01, 1]], { segments: 32, uv: UB.hot }).translate(c[0], c[1], c[2]));
    fixed.add(chevrons(c, coreZ - 0.012, r1 + 0.003, 16, 0.17, 0.04, UB.hot));                              // core nozzle chevrons
    const sl = n.sleeve.clone().add(chevrons(c, exitZ - 0.012, NAC.rExit - 0.008, 18, 0.34, 0.06, UB.chevron));   // bypass chevrons ride on the sleeve
    sl.enableMorph(); for (let i = 2; i < sl.p2.length; i += 3) sl.p2[i] += n.sleeveTravel;            // reverser: sleeve slides aft (morph target)
    sleeveAll.add(tilt(sl)); sleeveTravel = n.sleeveTravel;
    // pylon aft fairing over the core exhaust, its underside a titanium heat shield
    { const z0 = exitZ - 0.25, z1 = coreZ + 0.4, yc = EY;
      fixed.add(K.prism([[z0, yc + 1.2], [z1, yc + 1.08], [z1 - 0.3, yc + 0.8], [z0 + 1.1, yc + 0.66], [z0 + 0.35, yc + 0.78], [z0, yc + 1.0]], c[0] - 0.16, c[0] + 0.16, UB.pylon));
      fixed.add(K.prism([[z0 + 0.35, yc + 0.775], [z0 + 1.1, yc + 0.655], [z1 - 0.3, yc + 0.795], [z1 - 0.32, yc + 0.84], [z0 + 1.1, yc + 0.7], [z0 + 0.4, yc + 0.82]], c[0] - 0.165, c[0] + 0.165, UB.hot)); }
    // pylon: a slim fairing on top of the fan cowl running back into the wing leading edge, and the aft fairing under the wing
    const yw = wy(EX), zl = zLE(EX);
    fixed.add(K.pylon([{ y: EY + NAC.rMax - 0.3, z0: EZ + 1.0, z1: zl + 1.2, x: c[0], tc: 0.13 }, { y: yw + 0.28, z0: EZ + 1.6, z1: zl + 0.7, x: c[0], tc: 0.1 }], { uv: UB.pylon }));
    tilt(fixed);
    { const z0 = exitZ - 0.6, len = 6.2, yb = yw - 0.45;
      const st = [[0, 0.02, 0.02], [0.12, 0.26, 0.32], [0.45, 0.3, 0.42], [0.8, 0.2, 0.3], [1, 0.02, 0.04]].map(r => ({ z: z0 + r[0] * len, x: c[0], y: yb + r[0] * 0.35, w: r[1], top: 0.5, bot: r[2] + 0.1 * (1 - r[0]) }));
      fixed.add(K.loft({ stations: st, segments: 14, step: 0.5, uv: UB.pylon }).mesh); }
    stB.add(flexMorph(fixed, () => ENGB));
    const fanMesh = K.fan({ radius: NAC.rFan - 0.01, hub: 0.44, blades: 18, chord: 0.6, staggerRoot: 30, staggerTip: 64, sweep: 0.3, uvBlade: UB.blade, uvSpinner: UB.spinner });
    { const R = NAC.rFan - 0.01, hub = 0.44, sp = R * 0.55, prof = [[0, -sp], [hub * 0.35, -sp * 0.82], [hub * 0.72, -sp * 0.42], [hub, 0.02]];      // spinner spiral
      const rAt = (z) => { for (let i = 1; i < prof.length; i++) if (z <= prof[i][1]) { const a = prof[i - 1], b = prof[i], f = (z - a[1]) / (b[1] - a[1]); return a[0] + (b[0] - a[0]) * f; } return hub; };
      const pts = []; for (let k = 0; k <= 26; k++) { const f = 0.05 + 0.92 * k / 26, z = -sp * (1 - f), r = rAt(z) + 0.012, a = 6.3 * f; pts.push([r * Math.cos(a), r * Math.sin(a), z]); }
      fanMesh.add(K.pipe(pts, 0.028, { segments: 5, uv: UB.swirl })); }
    eng.push({ c, fanZ, fanMesh });
  }

  // ---- small details ----------------------------------------------------------------------------------------------------------
  stA.add(K.bladeAntenna({ pos: [0, fus.topAt(-17) - 0.02, -17], height: 0.3, chord: 0.42, sweep: 0.2, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.topAt(8) - 0.02, 8], height: 0.3, chord: 0.42, sweep: 0.2, uv: UA.antenna }));
  { const z = -6, y = fus.topAt(z); stA.add(K.ellipsoid(0.75, 0.14, 1.6, { segments: 16, rings: 6, uv: UA.antenna }).translate(0, y - 0.03, z)); }   // satcom radome
  stA.add(K.bladeAntenna({ pos: [0, fus.botAt(-16) + 0.02, -16], height: 0.28, chord: 0.4, sweep: 0.18, down: true, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.botAt(15) + 0.02, 15], height: 0.28, chord: 0.4, sweep: 0.18, down: true, uv: UA.antenna }));
  stA.add(K.box(0.28, 0.1, 1.4, UA.steel).translate(0, fus.botAt(23.5) + 0.03, 23.5));                // tail-strike skid
  // air-data probes on the nose: two pitots per side, an AoA vane, a total-air-temperature probe on the left
  for (const sx of [-1, 1]) {
    const T = (t) => (sx > 0 ? t : 1 - t), onF = (d, y, h = 0) => { const z = D(d), q = fus.at(z, T(fus.tAtY(z, y))); return q.p.map((v, k) => v + q.n[k] * h); };
    for (const [d, y] of [[3.55, -0.2], [3.8, -0.62]]) { const p = onF(d, y); stA.add(K.probe(p, [p[0] + sx * 0.13, p[1] - 0.01, p[2] - 0.2], 0.014, UA.steel)); stA.add(K.box(0.04, 0.09, 0.14, UA.steel).translate(p[0], p[1], p[2] + 0.03)); }
    { const p = onF(2.95, 0.25, 0.005), v = K.prism([[-0.07, 0], [0.05, 0], [0.03, 0.11], [-0.05, 0.09]], -0.006, 0.006, UA.dark); v.rotateZ(-sx * Math.PI / 2).translate(p[0], p[1], p[2]); stA.add(v); }
    if (sx < 0) { const p = onF(5.6, -1.2); stA.add(K.probe(p, [p[0] - 0.1, p[1] - 0.03, p[2] - 0.08], 0.012, UA.steel)); }
  }
  // drain masts and the static-discharge / VHF blades on the belly
  for (const z of [-11.5, 7.5]) stA.add(K.bladeAntenna({ pos: [0, fus.botAt(z) + 0.02, z], height: 0.13, chord: 0.16, sweep: 0.12, down: true, uv: UA.steel }));
  { const sw = []; for (const sx of [-1, 1]) for (const x of [6.5, 8, 9.2]) { const p = stab.R.at(x, 1, 'mid'); sw.push([sx * p[0], p[1], p[2]]); } for (const y of [10.6, 11.9]) sw.push(fin.at(y, 1, 'mid')); stB.add(K.staticWicks(sw, 0.22, UB.wick)); }
  { const ww = new K.Mesh(); for (const sx of [-1, 1]) { const pts = []; for (const x of [24.5, 26.2, 27.5]) { const p = W.R.at(x, 1, 'mid'); pts.push([sx * p[0], p[1], p[2]]); } ww.add(K.staticWicks(pts, 0.22, UB.wick)); } stB.add(flexMorph(ww, wingFlex)); }

  lap('geometry');
  // ---- paint + materials ------------------------------------------------------------------------------------------------------
  paintFuselage(A, { SC, fus, cFus, cOver, cPed, WIN });
  paintSurfaces(B, { SC, W: W.R, fin, stab: stab.R, cWT, cWB, cSt, cFin, SPOIL, cNac, cSlv, NS });
  lap('paint');
  const matA = A.material(ctx, { envMapIntensity: 1, emissiveIntensity: 0 }), matB = B.material(ctx, { envMapIntensity: 1 });
  lap('textures');
  rig.material('paint', matA, { shared: true }); rig.material('wing', matB, { shared: true });
  const captainNode = captainMesh && rig.part('captain', captainMesh, { pivot: G.pilotEye });
  rig.disposables.push(A, B);

  // ---- moving surfaces --------------------------------------------------------------------------------------------------------
  // Each wing control hangs from a "flex" node that follows the bent wing rigidly (offset + roll over the control's span);
  // the remaining curvature is a morph target on the control itself, so hinge rotations stay clean.
  const flexNodes = [], morphParts = [];
  const flexNode = (name, x0, x1, sx, pivot) => {
    const b0 = bend(x0), slope = (bend(x1) - b0) / (x1 - x0);
    const node = rig.node(name, { pivot });
    flexNodes.push({ node, dy: b0 + slope * (Math.abs(pivot[0]) - x0), ang: Math.atan(slope) * sx, rest: pivot.slice() });
    return { node, res: (x) => { const a = Math.abs(x); return bend(a) - (b0 + slope * (a - x0)); } };
  };
  const drop = (ctrl, d, aft = 0) => { const u = ctrl.up, h = ctrl.hinge, o = [-u[0] * d, -u[1] * d, -u[2] * d + aft]; return { a: [h.a[0] + o[0], h.a[1] + o[1], h.a[2] + o[2]], b: [h.b[0] + o[0], h.b[1] + o[1], h.b[2] + o[2]] }; };
  const DOWN = [0, -1, 0], UP = [0, 1, 0];
  const ctl = (name, mesh, line, ref, toward, span, sx) => {
    const fx = flexNode(name + '.flex', span[0], span[1], sx, line.a);
    const m = flexMorph(mesh.clone(), (x) => fx.res(x));
    const node = rig.part(name, m, { key: 'wing', pivot: line.a, parent: fx.node });
    morphParts.push(node);
    return rig.hinge(node, line.a, line.b, { ref, toward });
  };
  const wingAnim = [];
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const C = W[key].controls, a = {};
    for (const [nm, xs, span, dd] of [['In', [7.2], [3.1, 10.75], 1.25], ['Out', [14.6, 18.0, 21.3], [13.05, 22.5], 1.0]]) {
      const main = C['flap' + nm], mesh = main.mesh.clone();
      for (const x of xs) { const cn = canoeAt(x, nm === 'In' ? 4.2 : 3.9 - (x - 14) * 0.12, sx); stB.add(flexMorph(cn.front, wingFlex)); mesh.add(cn.rear); }
      a['flap' + nm] = ctl(`flap${nm}${key}`, mesh, drop(main, dd, 0.1), main.ref, DOWN, span, sx);
    }
    a.flaperon = ctl('flaperon' + key, C.flaperon.mesh, C.flaperon.hinge, C.flaperon.ref, UP, [10.95, 12.85], sx);
    a.aileron = ctl('aileron' + key, C.aileron.mesh, C.aileron.hinge, C.aileron.ref, UP, [22.7, 27.7], sx);
    a.slat = ctl('slat' + key, C.slat.mesh, drop(C.slat, 0.4, 0.12), C.slat.ref, DOWN, [11.3, 27.9], sx);
    a.krueger = ctl('krueger' + key, C.krueger.mesh, C.krueger.hinge, C.krueger.ref, DOWN, [3.4, 8.2], sx);
    a.spIn = ctl('spoilerIn' + key, K.merge(C.sp0.mesh, C.sp1.mesh), C.sp0.hinge, C.sp0.ref, UP, [3.4, 10.5], sx);
    a.spOut = ctl('spoilerOut' + key, K.merge(C.sp2.mesh, C.sp3.mesh, C.sp4.mesh, C.sp5.mesh, C.sp6.mesh), C.sp2.hinge, C.sp2.ref, UP, [13.1, 22.4], sx);
    a.elev = rig.hingePart('elevator' + key, stab[key].controls.elevator, { key: 'wing' }).set;
    a.key = key; wingAnim.push(a);
  }
  const rud = rig.hingePart('rudder', fin.controls.rudder, { key: 'wing', toward: [1, 0, 0] });
  const qTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -TILT);
  const fans = eng.map((e, i) => rig.part('fan' + i, e.fanMesh.translate(e.c[0], e.c[1], e.fanZ), { key: 'wing', pivot: [e.c[0], e.c[1], e.fanZ] }));
  const sleeves = rig.part('reversers', sleeveAll, { key: 'wing' });
  rig.addStatic(stB, 'wing');

  // ---- landing gear -----------------------------------------------------------------------------------------------------------
  const gp = G.gear, gearUV = { strut: A.swatch('gear.strut', F.gearWhite), hub: A.swatch('gear.hub', { color: '#c9cbc8', rough: 0.35, metal: 0.4 }) };
  const doorOf = (patch, edge) => ({ mesh: K.thicken(patch, 0.03, UA.well), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  const hyd = A.swatch('gear.hyd', { color: '#1c1d1f', rough: 0.5, metal: 0.4 }), chromeUV = A.swatch('gear.chrome', F.chrome), linkUV = A.swatch('gear.link', F.anodised);
  {
    const ex = new K.Mesh();                                                   // nose leg: steering actuators, light bracket, spray deflector
    for (const dx of [-0.17, 0.17]) ex.add(K.tube([dx, -1.85, -23.0], [dx * 1.15, -2.55, -23.25], 0.04, 0.034, { segments: 7, uv: UA.steel }));
    ex.add(K.box(0.62, 0.07, 0.1, UA.dark).translate(0, -2.93, -23.36));
    ex.add(K.pipe([[0.14, -1.6, -23.0], [0.15, -2.4, -23.18], [0.3, -3.05, -23.27]], 0.012, { segments: 5, uv: hyd }));
    K.buildGear(rig, A, {
      name: 'nose', index: 0, contact: gp[0].pos, wheels: [-0.31, 0.31], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.34, pivot: [0, -1.5, -23.05], stroke: 0.4, staticFrac: 0.4,
      strutR: 0.12, steer: true, links: 'front', retract: { to: [0, -1.85, -26.2] }, window: [0.2, 0.86], brace: [0, -1.55, -21.6], uv: gearUV, wheelSegments: 26, extra: ex,
      doors: [{ name: 'noseDoorR', ...doorOf(fus.patches.ngdR, fus.edges.ngdR.tHi), open: 86, closes: true }, { name: 'noseDoorL', ...doorOf(fus.patches.ngdL, fus.edges.ngdL.tLo), open: 86, closes: true }],
      lamps: [{ kind: 'taxi', pos: [0, -2.95, -23.43], size: 0.07, color: [1, 0.96, 0.9] }, { kind: 'landing', pos: [-0.2, -2.95, -23.42], size: 0.06, color: [1, 0.97, 0.9] }, { kind: 'landing', pos: [0.2, -2.95, -23.42], size: 0.06, color: [1, 0.97, 0.9] },
        { kind: 'taxi', pos: [-0.28, -2.93, -23.4], size: 0.045, color: [1, 0.97, 0.92] }, { kind: 'taxi', pos: [0.28, -2.93, -23.4], size: 0.045, color: [1, 0.97, 0.92] }],
    });
  }
  // outboard leg door riding on the main strut: a slightly curved fairing panel with a stiffening lip
  const legDoor = (P, bottom, sx, w) => { const m = K.plate([P[0] + sx * 0.3, P[1] - 0.55, P[2] - w], [P[0] + sx * 0.3, P[1] - 0.55, P[2] + w], [bottom[0] + sx * 0.3, bottom[1], bottom[2] + w * 0.9], [bottom[0] + sx * 0.3, bottom[1], bottom[2] - w * 0.9], 0.035, UA.door);
    m.add(K.tube([bottom[0] + sx * 0.3, bottom[1], bottom[2] - w * 0.9], [bottom[0] + sx * 0.3, bottom[1], bottom[2] + w * 0.9], 0.03, 0.03, { segments: 6, uv: UA.door })); return m; };
  const bogies = [];
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, R = gp[i].wheelRadius, P = [sx * 5.1, -1.1, 1.6], Cc = [c[0], c[1] + R, c[2]];
    const on = (f) => [P[0] + (Cc[0] - P[0]) * f, P[1] + (Cc[1] - P[1]) * f, P[2] + (Cc[2] - P[2]) * f];
    // side brace (folding, two links with a lock-link knee) to the wing-body joint, retraction actuator, brake and sensor lines
    const ex = legDoor(P, [c[0], -3.0, c[2] - 0.2], sx, 0.55), kb = on(0.42), sb = [sx * 3.3, -1.55, 1.75], knee = [sx * 4.2, -2.2, 1.85];
    ex.add(K.tube(kb, knee, 0.075, 0.07, { segments: 8, uv: linkUV })); ex.add(K.tube(knee, sb, 0.08, 0.075, { segments: 8, uv: linkUV }));
    ex.add(K.ellipsoid(0.1, 0.1, 0.1, { segments: 8, rings: 4, uv: linkUV }).translate(...knee));
    ex.add(K.tube([knee[0] + sx * 0.05, knee[1] + 0.05, knee[2] - 0.12], on(0.62), 0.03, 0.03, { segments: 6, uv: linkUV }));
    ex.add(K.tube(on(0.12).map((v, k) => v + [sx * -0.25, 0.05, -0.2][k]), [sx * 4.0, -1.35, 0.9], 0.07, 0.06, { segments: 8, uv: UA.steel }));
    for (const dz of [-0.06, 0.06]) ex.add(K.pipe([on(0.1).map((v, k) => v + [sx * 0.22, 0, dz][k]), on(0.5).map((v, k) => v + [sx * 0.23, 0, dz - 0.12][k]), on(0.86).map((v, k) => v + [sx * 0.2, 0, dz - 0.15][k])], 0.016, { segments: 5, uv: hyd }));
    const g = K.buildGear(rig, A, {
      name: 'main' + key, index: i, contact: c, wheels: [-0.69, 0.69], axles: [-0.73, 0.73], wheelRadius: R, wheelWidth: 0.46, pivot: P, stroke: 0.48, staticFrac: 0.4,
      strutR: 0.2, links: 'none', retract: { to: [sx * 2.4, -2.0, 2.6] }, window: [0.2, 0.86], brace: [sx * 5.0, -1.45, -0.7], uv: gearUV, wheelSegments: 26, brakes: true,
      extra: ex,
      doors: [{ name: 'mainDoor' + key, ...doorOf(fair.patches['mgw' + key], sx > 0 ? fair.edges['mgw' + key].tLo : fair.edges['mgw' + key].tHi), open: 95, closes: true }],
    });
    // bogie tilt: replace the kit's level bogie beam by a beam that pitches with the wheels about its pivot pin
    const dv = [Cc[0] - P[0], Cc[1] - P[1], Cc[2] - P[2]], dl = Math.hypot(...dv), d = dv.map(v => v / dl);
    const pr = 0.2 * 0.62, rod = rig.parts['main' + key + '.rod'];
    const at = (q) => [Cc[0] + d[0] * q, Cc[1] + d[1] * q, Cc[2] + d[2] * q];
    const pm = K.tube(at(-1.3), at(-0.12), pr, pr, { segments: 12, uv: chromeUV });
    pm.add(K.tube(at(-0.2), at(-0.02), pr * 1.5, pr * 1.6, { segments: 12, uv: gearUV.strut }));                       // pivot yoke
    rod.geometry.dispose(); rod.geometry = pm.translate(-Cc[0], -Cc[1], -Cc[2]).toGeometry();
    const beam = new K.Mesh();
    beam.add(K.tube([Cc[0], Cc[1] - 0.04, Cc[2] - 0.98], [Cc[0], Cc[1] - 0.04, Cc[2] + 0.98], pr * 1.25, pr * 1.25, { segments: 12, uv: gearUV.strut }));
    beam.add(K.tube([Cc[0] - 0.14, Cc[1], Cc[2]], [Cc[0] + 0.14, Cc[1], Cc[2]], pr * 0.9, pr * 0.9, { segments: 10, uv: linkUV }));      // pivot pin
    for (const z of [-0.73, 0.73]) {
      beam.add(K.tube([Cc[0] - 0.92, Cc[1], Cc[2] + z], [Cc[0] + 0.92, Cc[1], Cc[2] + z], pr * 0.72, pr * 0.72, { segments: 10, uv: linkUV }));
      beam.add(K.box(0.3, 0.2, 0.22, gearUV.strut).translate(Cc[0], Cc[1] - 0.02, Cc[2] + z));                      // axle sleeve
      for (const xs of [-1, 1]) beam.add(K.pipe([[Cc[0] + xs * 0.1, Cc[1] + 0.06, Cc[2] + z * 0.2], [Cc[0] + xs * 0.16, Cc[1] + 0.09, Cc[2] + z * 0.8], [Cc[0] + xs * 0.42, Cc[1] + 0.05, Cc[2] + z]], 0.012, { segments: 5, uv: hyd }));
    }
    beam.add(K.tube([Cc[0] + sx * 0.18, Cc[1] + 0.1, Cc[2] - 0.75], at(-0.95).map((v, k) => v + [sx * 0.18, 0, 0][k]), 0.045, 0.04, { segments: 7, uv: UA.steel }));   // pitch trimmer
    const bnode = rig.part('main' + key + '.bogie', beam, { parent: g.piston, pivot: Cc });
    for (const w of g.wheels) { g.piston.remove(w); bnode.add(w); const p = w.userData.pivot; w.position.set(p[0] - Cc[0], p[1] - Cc[1], p[2] - Cc[2]); }
    const set = rig.hinge(bnode, Cc, [Cc[0] + 1, Cc[1], Cc[2]], { ref: [Cc[0], Cc[1], Cc[2] - 0.73], toward: UP });
    bogies.push({ i, set, v: 0 });
  }
  rig.addStatic(stA, 'paint');

  // ---- lamps ------------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  const tipNode = (sx) => { const p = W.R.at(XT - 0.1, 0.5, 'mid'); const n = rig.node('tip' + (sx > 0 ? 'R' : 'L'), { pivot: [sx * p[0], p[1], p[2]] }); flexNodes.push({ node: n, dy: bend(XT), ang: 0, rest: n.userData.pivot.slice() }); return n; };
  const tipL = tipNode(-1), tipR = tipNode(1);
  { const p = W.R.at(XT - 0.12, 0.04, 'mid');
    rig.lamp('nav', [-p[0] - 0.04, p[1], p[2]], { color: [1, 0.04, 0.02], size: 0.12, squash: [0.6, 0.6, 1.5], parent: tipL });
    rig.lamp('nav', [p[0] + 0.04, p[1], p[2]], { color: [0.02, 1, 0.25], size: 0.12, squash: [0.6, 0.6, 1.5], parent: tipR }); }
  for (const [sx, n] of [[-1, tipL], [1, tipR]]) { const p = W.R.at(XT - 0.15, 0.93, 'mid'); rig.lamp('strobe', [sx * (p[0] + 0.05), p[1], p[2]], { color: [1, 1, 1], size: 0.1, parent: n }); rig.lamp('nav', [sx * (p[0] + 0.05), p[1], p[2] + 0.12], { color: [1, 1, 1], size: 0.07, parent: n }); }
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.1 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.1 });
  rig.lamp('beacon', [0, fus.topAt(-1) + 0.04, -1], { color: [1, 0.05, 0.03], size: 0.16, squash: [1, 0.6, 1] });   // upper anti-collision
  rig.lamp('beacon', L.beacon, { color: [1, 0.05, 0.03], size: 0.16, squash: [1, 0.6, 1] });
  for (const sx of [-1, 1]) rig.lamp('landing', [sx * Math.abs(L.landing[0]), L.landing[1], L.landing[2]], { color: [1, 0.97, 0.9], size: 0.2, squash: [1.6, 0.8, 0.5] });
  for (const sx of [-1, 1]) { const p = stab.R.at(3.2, 0.25, 'upper'); rig.lamp('nav', [sx * p[0], p[1] + 0.04, p[2]], { color: [1, 0.98, 0.92], size: 0.07 }); }       // logo lights (fin floodlights)
  for (const sx of [-1, 1]) { const z = -10.5, p = fus.at(z, fus.tAtY(z, 0.2)).p; rig.lamp('landing', [sx * (p[0] + 0.02), p[1], p[2]], { color: [1, 0.97, 0.9], size: 0.07 }); }   // wing inspection lights
  const turnoff = [-1, 1].map((sx) => { const x = Math.abs(L.landing[0]) + 0.55; return [sx * x, wy(x) - 0.06, zLE(x) - 0.04]; });
  for (const p of turnoff) rig.lamp('taxi', p, { color: [1, 0.97, 0.92], size: 0.11, squash: [1.4, 0.8, 0.5] });                   // runway turnoff lights in the wing roots
  const pTipNav = W.R.at(XT - 0.12, 0.04, 'mid'), pTipStr = W.R.at(XT - 0.15, 0.93, 'mid'), beaconTop = [0, fus.topAt(-1) + 0.04, -1];

  // ---- night halos: soft additive sprites so the lamps read at chase distance --------------------------------------------------
  const HALO = [
    { p: [-pTipNav[0] - 0.1, pTipNav[1], pTipNav[2]], c: [1, 0.05, 0.03], k: 'nav', s: 2.8, tip: 1 }, { p: [pTipNav[0] + 0.1, pTipNav[1], pTipNav[2]], c: [0.05, 1, 0.3], k: 'nav', s: 2.8, tip: 1 },
    { p: [-pTipStr[0] - 0.08, pTipStr[1], pTipStr[2] + 0.05], c: [1, 1, 1], k: 'strobe', s: 5, tip: 1 }, { p: [pTipStr[0] + 0.08, pTipStr[1], pTipStr[2] + 0.05], c: [1, 1, 1], k: 'strobe', s: 5, tip: 1 },
    { p: [L.tail[0], L.tail[1], L.tail[2] + 0.1], c: [1, 1, 1], k: 'nav', s: 2.2 }, { p: [L.strobe[0], L.strobe[1], L.strobe[2] + 0.1], c: [1, 1, 1], k: 'strobe', s: 4.2 },
    { p: [beaconTop[0], beaconTop[1] + 0.1, beaconTop[2]], c: [1, 0.1, 0.05], k: 'beacon', s: 3.4 }, { p: [L.beacon[0], L.beacon[1] - 0.1, L.beacon[2]], c: [1, 0.1, 0.05], k: 'beacon', s: 3.4 },
    ...[-1, 1].map((sx) => ({ p: [sx * Math.abs(L.landing[0]), L.landing[1], L.landing[2] - 0.15], c: [1, 0.95, 0.85], k: 'landing', s: 4 })),
    ...turnoff.map((p) => ({ p: [p[0], p[1], p[2] - 0.12], c: [1, 0.95, 0.88], k: 'taxi', s: 3 })),
    { p: [0, -2.95, -23.6], c: [1, 0.95, 0.85], k: 'taxi', s: 3, gear: 1 },
  ];
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(HALO.flatMap((h) => h.p), 3));
  haloGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(HALO.length * 3).fill(0), 3));
  haloGeo.setAttribute('size', new THREE.Float32BufferAttribute(HALO.map((h) => h.s), 1));
  const haloMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, fog: false,
    vertexShader: 'attribute float size; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * 0.5 * projectionMatrix[1][1] * 360.0 / max(0.5, -mv.z), 2.0, 96.0); }',
    fragmentShader: 'varying vec3 vC; void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard; float a = exp(-r2 * 5.0) + 0.25 * exp(-r2 * 1.4) * (1.0 - r2); gl_FragColor = vec4(vC * a, 1.0); }',
  });
  const halo = new THREE.Points(haloGeo, haloMat); halo.name = 'halos'; halo.frustumCulled = false; halo.renderOrder = 6;
  const haloCol = haloGeo.attributes.color, haloPos = haloGeo.attributes.position;

  // ---- animation --------------------------------------------------------------------------------------------------------------
  const fanAng = [0, 0];
  let flex = null;
  const qa = new THREE.Quaternion(), za = new THREE.Vector3(0, 0, 1);
  let wingMesh = null;
  for (const f of flexNodes) f.restPos = f.node.position.clone();
  for (const f of fans) f.userData.restPos = f.position.clone();
  sleeves.userData.restPos = sleeves.position.clone();
  rig.onUpdate((S, dt) => {
    if (captainNode) captainNode.visible = !rig.cameraInCockpit;
    const sf = S.sf, f = sf.flaps, sl = Math.max(sf.slats, 0), raw = S.raw || {};
    // wing bending: load factor in flight, lift building up with speed on the take-off / landing roll
    const ias = Number(raw.ias) || Number(raw.tas) || S.groundSpeed || 0, gl = Number.isFinite(raw.gLoad) ? raw.gLoad : 1;
    const target = S.onGround ? Math.min(1, (ias / 82) ** 2) * 0.85 : Math.max(-0.6, Math.min(2.6, gl));
    flex = flex === null || dt <= 0 ? target : flex + (target - flex) * (1 - Math.exp(-dt / 0.35));
    if (wingMesh) wingMesh.morphTargetInfluences[0] = flex;
    for (const n of flexNodes) { n.node.position.set(n.restPos.x, n.restPos.y + n.dy * flex, n.restPos.z); qa.setFromAxisAngle(za, n.ang * flex); n.node.quaternion.copy(qa); }
    for (const m of morphParts) m.morphTargetInfluences[0] = flex;
    for (const a of wingAnim) {
      const R = a.key === 'R', ail = R ? sf.aileronR : sf.aileronL, sp = R ? sf.spoilerR : sf.spoilerL, el = R ? sf.elevatorR : sf.elevatorL;
      a.flapIn(f * 34 * DEG); a.flapOut(f * 32 * DEG);
      a.flaperon(ail * 18 * DEG - f * 24 * DEG);
      a.aileron((S.onGround || f > 0.05 ? 1 : 0.4) * ail * 22 * DEG - f * 8 * DEG);
      a.slat(sl * 24 * DEG); a.krueger(sl * 110 * DEG);
      a.spOut(Math.max(sp, sf.speedbrake * (S.onGround ? 1 : 0.6)) * 45 * DEG);
      a.spIn((S.onGround ? Math.max(sf.speedbrake, sp > 0.9 ? sp : 0) : sf.speedbrake * 0.4) * 50 * DEG);
      a.elev(el * 25 * DEG);
    }
    rud.set(sf.rudder * 27 * DEG);
    let rev = 0;
    const ey = ENGB * flex;
    for (let i = 0; i < 2; i++) {
      const e = S.eng[i] || {};
      fanAng[i] = (fanAng[i] + (e.n1 || 0) * 20 * dt) % TAU;
      qa.setFromAxisAngle(za, fanAng[i]); fans[i].quaternion.multiplyQuaternions(qTilt, qa);
      fans[i].position.y = fans[i].userData.restPos.y + ey;
      rev = Math.max(rev, e.reverser || 0);
    }
    sleeves.morphTargetInfluences[0] = rev; sleeves.position.y = sleeves.userData.restPos.y + ey;
    // main bogies pitch toes-up when the gear hangs free, level on the ground and while retracting
    for (const b of bogies) {
      const gs = S.gear[b.i] || {}, tgt = gs.onGround ? 0 : K.seq(sf.gear, 0.88, 1) * 13 * DEG;
      b.v = dt <= 0 ? tgt : b.v + (tgt - b.v) * (1 - Math.exp(-dt / (gs.onGround ? 0.08 : 0.6)));
      b.set(b.v);
    }
    matA.emissiveIntensity = S.night * 2.4;
    const lt = S.lights || {}, nf = Math.max(0, Math.min(1, (S.night ?? 0) * 1.4 - 0.2)), tipDy = bend(XT) * flex;
    HALO.forEach((h, i) => {
      let on = 0;
      if (h.k === 'nav') on = lt.nav ? 1 : 0;
      else if (h.k === 'strobe') on = lt.strobe ? K.lampFlash('strobe', S.tLamp) : 0;
      else if (h.k === 'beacon') on = lt.beacon ? K.lampFlash('beacon', S.tLamp) : 0;
      else on = lt[h.k] && (!h.gear || sf.gear > 0.98) ? 1 : 0;
      const I = on * nf * 0.9; haloCol.setXYZ(i, h.c[0] * I, h.c[1] * I, h.c[2] * I);
      if (h.tip) haloPos.setY(i, h.p[1] + tipDy);
    });
    haloCol.needsUpdate = true; haloPos.needsUpdate = true; halo.visible = nf > 0.01;
  });
  const visual = rig.build();
  visual.object3D.add(halo);
  rig.disposables.push(haloGeo, haloMat);
  wingMesh = visual.object3D.children.find(o => o.name === 'static:wing');
  lap('rig'); visual.stats.phases = lap.out; visual.stats.sleeveTravel = sleeveTravel;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- paint: fuselage atlas ---------------------------------------------------------------------------------------------------
function paintFuselage(A, o) {
  const { SC, fus, cFus, cOver, cPed, WIN } = o, F = K.FINISH;
  const P = A.pen(cFus), body = F.gloss(SC.body), belly = F.gloss(SC.belly), cheat = F.gloss(SC.cheat), tail = F.gloss(SC.tail);
  const font = SC.font === 'serif' ? K.FONT.serif : SC.font === 'round' ? K.FONT.round : K.FONT.wide;
  const Z0 = -29.95, Z1 = 33.0;
  P.fill('all', body);
  // --- livery ---
  if (SC.style === 'wave') {             // navy belly sweeping up over the tail cone, gold pinstripe on its edge
    const edge = (z) => (z < 6 ? -1.25 + (z + 29.9) * 0.008 : -0.96 + Math.pow((z - 6) / 22, 2.1) * 4.4);
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.16, cheat, { step: 0.25 });
    P.band(Z0, Z1, -Infinity, edge, belly, { step: 0.25 });
    P.textOn(SC.title, -14.5, 1.55, 'both', 0.78, { color: SC.titleColor, font, weight: 700, spacing: 0.16 });
  } else if (SC.style === 'ribbon') {    // teal tail cone wrapped behind two slanted coral / white ribbons
    P.band(Z0, Z1, -Infinity, -1.75, belly, { step: 0.5 });
    const cut = (z0) => (z) => (z < z0 ? -Infinity : z > z0 + 4.5 ? Infinity : -3.1 + (z - z0) / 4.5 * 6.2);
    P.band(13.2, Z1, -Infinity, cut(13.2), cheat, { step: 0.2 });
    P.band(14.1, Z1, -Infinity, cut(14.1), body, { step: 0.2 });
    P.band(14.7, Z1, -Infinity, cut(14.7), tail, { step: 0.2 });
    P.textOn(SC.title, -15.0, 1.45, 'both', 0.95, { color: SC.titleColor, font, weight: 700 });
  } else {                               // 'bands': charcoal lower fuselage with a teal line, demonstrator titles
    P.band(Z0, Z1, -Infinity, (z) => -0.75 + Math.max(0, z - 12) * 0.1, belly, { step: 0.4 });
    P.band(-25.5, Z1, (z) => -0.62 + Math.max(0, z - 12) * 0.1, (z) => -0.5 + Math.max(0, z - 12) * 0.1, cheat, { step: 0.4 });
    P.textOn(SC.title, -14.5, 1.6, 'both', 0.7, { color: SC.titleColor, font, weight: 700, spacing: 0.18 });
    P.textOn('787-9', 4.5, 1.6, 'both', 0.55, { color: SC.cheat, font: K.FONT.wide, weight: 700, spacing: 0.08 });
  }
  P.textOn(SC.reg, 20.5, 1.3, 'both', 0.42, { color: SC.style === 'ribbon' ? '#ffffff' : SC.titleColor, font: K.FONT.sans, weight: 700 });
  if (SC.style !== 'bands') P.decalOn(D(9.6), 1.5, 'both', (g) => SC.emblem(g, 0.24));                                          // emblem behind door 1
  else P.decalOn(D(9.6), 1.5, 'both', (g) => skyMark(g, 0.22, SC.tail, SC.cheat));
  P.textOn('787-9', D(2.0) + 1.6, -1.55, 'both', 0.12, { color: '#6a6e72', font: K.FONT.sans, weight: 700 });
  // service panels: avionics bay, ground power, potable water and lavatory service, E/E bay hatch, APU access
  const panelOn = (z0, z1, y0, y1, side = 'both') => P.doorOn(z0, z1, y0, y1, { px: 0.8, depth: 0.28, dark: 0.08, side, r: 0.04 });
  for (const [d0, d1, y0, y1, sd] of [[4.9, 5.6, -2.2, -1.75, 'both'], [6.0, 6.5, -2.35, -2.05, 'R'], [11.3, 11.7, -2.2, -1.95, 'L'], [49.3, 49.7, -1.4, -1.15, 'L'], [51.0, 51.4, -1.15, -0.9, 'R'], [58.0, 59.6, -0.3, 0.6, 'both']]) panelOn(D(d0), D(d1), y0, y1, sd);
  P.decalT(D(9.0), 0.0, { layers: ['color', 'height'] }, (g, layer) => { g.strokeStyle = layer === 'height' ? 'rgba(0,0,0,0.45)' : 'rgba(40,42,46,0.4)'; g.lineWidth = 0.02; g.strokeRect(-0.45, -0.35, 0.9, 0.7); });
  // APU exhaust soot on the tail cone, grime trails aft of the belly drain masts
  P.band(D(61.2), Z1, -Infinity, Infinity, { color: '#34302c', rough: 0.6, metal: 0 }, { step: 0.1, alpha: 0.35, feather: 18 });
  for (const z of [-11.5, 7.5]) for (const dt of [-0.004, 0, 0.004]) P.streak(z + 0.2, dt < 0 ? 1 + dt : dt, z + 4.5, dt < 0 ? 1 + dt * 2 : dt * 2, 0.01, { alpha: 0.08 });
  // radome joint (the composite barrels have no lap joints or rivet rows)
  P.ring(D(2.1), 0, 1, { px: 0.8, depth: 0.25, dark: 0.04 });
  // --- flight-deck windows: painted glass inside a black mask ---
  for (const s of [1, -1]) {
    const m = (p) => [p[0], s > 0 ? p[1] : 1 - p[1]];
    for (const w of WIN) {
      const pts = w.map(m), path = (g) => { pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      P.stroke(path, 0, { color: '#1d1f22', rough: 0.45, metal: 0 }, { join: 'round', px: 4.5 });      // black sealant bead round the flush pane
      P.fill(pts, F.paintedGlass);
      P.groove(path, { px: 1.1, depth: 0.45, dark: 0.15 });
    }
  }
  // --- cabin windows (large), doors ---
  const doorsD = [7.5, 18.0, 38.5, 53.5];
  const zs = []; for (let d = 9.0; d < 55.6; d += 0.53) if (doorsD.every(dd => Math.abs(d - dd) > 1.05)) zs.push(D(d));
  // 787 cabin windows: tall rounded panes behind a grey gasket and a shallow reveal; electrochromic glass dimmed by the
  // passengers to different shades of blue (no blinds), warm cabin light behind them at night
  const wrnd = (() => { let a = 99; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const cabinWin = (z, y, side, w, h, r, lit) => {
    const dim = wrnd(), on = wrnd() < lit, glow = 0.55 + 0.45 * wrnd();
    const rr = (g, k) => { g.beginPath(); g.roundRect(-w / 2 - k, -h / 2 - k, w + 2 * k, h + 2 * k, r + k); };
    P.decalOn(z, y, side, { layers: lit > 0 ? ['color', 'orm', 'height', 'emis'] : ['color', 'orm', 'height'] }, (g, layer) => {
      if (layer === 'color') {
        g.fillStyle = SC.winRing || '#a4a9ad'; rr(g, 0.03); g.fill();
        g.fillStyle = '#3d434a'; rr(g, 0.012); g.fill();
        const gr = g.createLinearGradient(0, -h / 2, 0, h / 2), c0 = dim < 0.3 ? '#28405e' : dim < 0.55 ? '#33475a' : '#3f4a55';
        gr.addColorStop(0, c0); gr.addColorStop(0.55, '#1b242e'); gr.addColorStop(1, '#10161c'); g.fillStyle = gr; rr(g, 0); g.fill();
      } else if (layer === 'orm') { g.fillStyle = 'rgb(255,110,0)'; rr(g, 0.03); g.fill(); g.fillStyle = 'rgb(255,14,0)'; rr(g, 0); g.fill(); }
      else if (layer === 'height') { g.fillStyle = 'rgba(0,0,0,0.18)'; rr(g, 0.03); g.fill(); g.fillStyle = 'rgba(0,0,0,0.42)'; rr(g, 0.01); g.fill(); }
      else if (on) { g.fillStyle = '#ffd9a8'; g.globalAlpha = glow * (dim < 0.3 ? 0.45 : 1); rr(g, -0.012); g.fill(); g.globalAlpha = 1; }
    });
  };
  for (const side of ['L', 'R']) for (const z of zs) cabinWin(z, 0.52, side, 0.28, 0.47, 0.12, 0.75);
  const door = { px: 1.3, depth: 0.6, dark: 0.35 };
  for (const dd of doorsD) {
    P.doorOn(D(dd) - 0.55, D(dd) + 0.55, -1.02, 0.98, { ...door, r: 0.12, handle: true });
    for (const side of ['L', 'R']) cabinWin(D(dd), 0.55, side, 0.2, 0.3, 0.09, 0);
    P.textOn('EXIT', D(dd), 1.18, 'both', 0.07, { color: '#b42a20', font: K.FONT.sans, weight: 700 });
    P.decalOn(D(dd), -0.35, 'both', (g) => { g.strokeStyle = '#b42a20'; g.lineWidth = 0.012; g.strokeRect(-0.16, -0.06, 0.32, 0.12); });     // emergency open placard
    P.doorOn(D(dd) - 0.62, D(dd) + 0.62, -1.08, 1.04, { px: 0.7, depth: 0.15, dark: 0.04 });                                                  // door surround seal
  }
  P.doorOn(D(15.0), D(17.7), -2.65, -1.0, { ...door, side: 'R' }); P.doorOn(D(40.5), D(43.0), -2.62, -1.0, { ...door, side: 'R' }); P.doorOn(D(46.6), D(47.8), -2.45, -1.3, { ...door, side: 'R' });   // cargo doors
  // static ports, APU intake, outflow valve, grime
  P.decalOn(D(4.2), -0.95, 'both', (g) => { g.fillStyle = '#9aa0a5'; g.beginPath(); g.ellipse(0, 0, 0.12, 0.08, 0, 0, TAU); g.fill(); g.strokeStyle = '#c42a1e'; g.lineWidth = 0.014; g.strokeRect(-0.19, -0.13, 0.38, 0.26); });
  P.decalOn(D(58.5), 1.6, 'R', (g) => { g.fillStyle = '#3a3d41'; g.fillRect(-0.4, -0.18, 0.8, 0.36); g.fillStyle = '#2b2d30'; for (let i = 0; i < 5; i++) g.fillRect(-0.36 + i * 0.15, -0.14, 0.08, 0.28); });
  P.decalOn(D(49.5), -1.6, 'L', (g) => { g.fillStyle = '#2b2d30'; g.beginPath(); g.ellipse(0, 0, 0.3, 0.16, 0, 0, TAU); g.fill(); });
  const rnd = (() => { let a = 13; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  for (let i = 0; i < 30; i++) { const z = -14 + rnd() * 40, t = rnd() < 0.5 ? rnd() * 0.06 : 1 - rnd() * 0.06; P.streak(z, t, z + 1 + rnd() * 3, t, 0.005 + rnd() * 0.01, { alpha: 0.04 + rnd() * 0.06 }); }
  P.noise({ alpha: 0.025, scale: 4, stretch: [2, 1] });
  // --- flight-deck panels: pedestal, overhead ---
  {
    const Q = A.pen(cPed); Q.fill('all', { color: '#3e4042', rough: 0.72, metal: 0 });
    for (const a0 of [0.03, 0.27]) { Q.fill((g) => g.rect(a0, 0.62, 0.2, 0.32), { color: '#232426', rough: 0.5, metal: 0 }); Q.fill((g) => g.rect(a0 + 0.02, 0.64, 0.16, 0.12), { color: '#0a1016', rough: 0.15, metal: 0, emissive: '#0d1a20' });
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) Q.fill((g) => g.rect(a0 + 0.02 + i * 0.042, 0.79 + j * 0.035, 0.03, 0.025), { color: '#58595b', rough: 0.6, metal: 0 }); }
    Q.fill((g) => g.rect(0.1, 0.12, 0.3, 0.42), { color: '#2a2b2d', rough: 0.6, metal: 0 });                       // thrust-lever quadrant
    for (const a0 of [0.17, 0.3]) Q.fill((g) => g.rect(a0, 0.16, 0.025, 0.34), { color: '#0d0d0e', rough: 0.6, metal: 0 });
  }
  {
    const Q = A.pen(cOver); Q.fill('all', { color: '#77746c', rough: 0.7, metal: 0 });
    for (let j = 0; j < 10; j++) for (let i = 0; i < 7; i++) Q.fill((g) => g.rect(0.04 + i * 0.093, 0.04 + j * 0.095, 0.07, 0.07), { color: (i + j * 2) % 5 ? '#55534e' : '#2a2a28', rough: 0.6, metal: 0, emissive: (i * 3 + j) % 7 === 0 ? '#1c1403' : undefined });
  }
}

// ---- paint: wings, tail -------------------------------------------------------------------------------------------------------
function paintSurfaces(B, o) {
  const { SC, W, fin, stab, cWT, cWB, cSt, cFin, SPOIL, cNac, cSlv, NS } = o, F = K.FINISH;
  const grey = F.semigloss('#b8bdc2'), dgrey = F.semigloss('#a3a8ad'), metal = { color: '#c9ccce', rough: 0.28, metal: 0.9 }, white = F.semigloss('#d3d7da');
  const line = { px: 1, depth: 0.3, dark: 0.1 }, gap = { px: 1.8, depth: 0.8, dark: 0.45 };
  const at = (x, f) => { const p = W.at(x, f); return [p[0], p[2] - KS * p[0]]; }, pw = (x, z) => [x, z - KS * x];
  const Ln = (name, x) => W.lines[name].at(W.spanToU(x));
  const tipFill = F.gloss(SC.tip);
  for (const [chart, top] of [[cWT, true], [cWB, false]]) {
    const Q = B.pen(chart); Q.fill('all', top ? grey : white);
    if (top) Q.fill([at(3.2, Ln('slat', 3.2) + 0.05), at(27.5, Ln('slat', 27.5) + 0.05), at(27.5, Ln('spoil', 27.5) - 0.03), at(3.2, Ln('spoil', 3.2) - 0.03)], dgrey);
    Q.fill([at(1.0, 0), at(28, 0), at(28, 0.03), at(1.0, 0.03)], metal);
    Q.fill([pw(27.95, zLE(27.95) - 0.15), pw(30.5, zLE(30.5) - 0.4), pw(30.5, zTE(30.5) + 0.3), pw(27.95, zTE(27.95) + 0.15)], tipFill);          // painted raked tips
    const seg = (name, xs, op) => Q.line(xs.map(x => at(x, Ln(name, x))), op);
    seg('slat', [11.3, 27.9], gap); for (const x of [11.3, 14.0, 16.8, 19.6, 22.4, 25.2, 27.9]) Q.line([at(x, 0), at(x, Ln('slat', x))], gap);
    if (top) { for (const [a, b] of SPOIL) Q.line([at(a, Ln('flap', a)), at(a, Ln('spoil', a)), at(b, Ln('spoil', b)), at(b, Ln('flap', b))], gap); }
    else { Q.line([at(3.4, 0.005), at(3.4, Ln('slat', 3.4)), at(8.2, Ln('slat', 8.2)), at(8.2, 0.005)], gap); }
    for (const [a, b] of [[3.1, 10.75], [10.95, 12.85], [13.05, 22.5], [22.7, 27.7]]) Q.line([at(a, 1), at(a, Ln('flap', a)), at(b, Ln('flap', b)), at(b, 1)], gap);
    for (const f of [0.18, 0.55]) Q.line([at(1.6, f), at(27.6, f)], line);
    if (top) {
      const a = at(3.3, 0.2), b = at(3.3, 0.58), c = at(8.5, 0.58);
      Q.stroke((g) => { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); }, 0.05, F.matte('#2a2c2e'));       // thin walkway outline
      for (const x of [12.5, 22.0]) { const p = at(x, 0.08); Q.text('NO STEP', p[0], p[1] + 0.8, 0.11, { color: '#7a2a24', font: K.FONT.sans }); }
    } else {
      for (let i = 0; i < 14; i++) { const x = 4 + i * 1.7, a = at(x, 0.66); Q.streak(a[0], a[1], a[0], a[1] + 1.4, 0.06, { alpha: 0.08 }); }
      for (let x = 4.2; x < 26; x += 1.65) { const c = at(x, 0.4); Q.panel(c[0] - 0.24, c[1] - 0.16, c[0] + 0.24, c[1] + 0.16, { r: 0.12, px: 0.9, depth: 0.3, dark: 0.1 }); }   // fuel-tank access doors
      for (const x of [6, 15, 24]) { const c = at(x, 0.2); Q.text('NO STEP', c[0], c[1], 0.08, { color: '#5a5e62', font: K.FONT.sans }); }
    }
    Q.noise({ alpha: 0.035, scale: 3, stretch: [1, 2.5], rough: 0.04 });
  }
  {
    const Q = B.pen(cSt); Q.fill('all', grey);
    const sa = (x, f) => { const p = stab.at(x, f); return [p[0], p[2]]; };
    Q.fill([sa(0.6, 0), sa(9.6, 0), sa(9.6, 0.05), sa(0.6, 0.05)], metal);
    Q.line([sa(2.2, 1), sa(2.2, 0.7), sa(9.3, 0.7), sa(9.3, 1)], gap);
    for (const f of [0.22, 0.46]) Q.line([sa(1.0, f), sa(9.4, f)], line);
    Q.noise({ alpha: 0.035, scale: 3, stretch: [1, 2], rough: 0.04 });
  }
  for (const key of ['L', 'R']) {
    const Q = B.pen(cFin[key]); Q.fill('all', F.gloss(SC.tail));
    const fa = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    const c = fa(7.6, 0.45);
    if (SC.style === 'wave') Q.decal(c[0], c[1], (g) => kingfisher(g, 1, SC.cheat));          // stylised kingfisher: gold wing arcs and a dot
    else if (SC.style === 'ribbon') Q.decal(c[0], c[1], (g) => waveCrest(g, 1, SC.cheat, '#ffffff'));   // coral wave crest with a white foam line
    else {                               // demonstrator: teal root bands, white chevron mark, type number
      for (const [y0, y1] of [[3.0, 3.6], [3.9, 4.2]]) Q.fill([fa(y0, 0), fa(y1, 0), fa(y1, 1), fa(y0, 1)], F.gloss(SC.cheat));
      Q.decal(c[0], c[1] + 0.9, (g) => skyMark(g, 0.9, '#ffffff', SC.cheat));
      const c2 = fa(5.3, 0.42); Q.text('787-9', c2[0], c2[1], 0.75, { color: '#ffffff', font: K.FONT.wide, weight: 700 });
    }
    Q.fill([fa(2.6, 0), fa(12.6, 0), fa(12.6, 0.03), fa(2.6, 0.03)], metal);
    const fg = { px: 1.6, depth: 0.5, dark: 0.3 };
    Q.line([fa(2.75, 1), fa(2.75, 0.7), fa(12.4, 0.7), fa(12.4, 1)], fg);
    const fl = { px: 1, depth: 0.18, dark: 0.06 };
    for (const f of [0.22, 0.46]) Q.line([fa(2.8, f), fa(12.5, f)], fl);
    Q.noise({ alpha: 0.03, scale: 3 });
  }
  // ---- nacelles: one chart shared by both cowls (u = arc length along the fold-over loft, t round the ring, 0 = bottom) ------------
  {
    const Q = B.pen(cNac), zOf = (z) => { const { zs, ss } = NS; for (let i = 1; i < zs.length; i++) if (z <= zs[i]) return ss[i - 1] + (ss[i] - ss[i - 1]) * (z - zs[i - 1]) / (zs[i] - zs[i - 1]); return ss[ss.length - 1]; };
    const eng = F.gloss(SC.engine), line = { px: 1, depth: 0.3, dark: 0.1 }, seam = { px: 1.4, depth: 0.55, dark: 0.3 };
    Q.fill('all', eng);
    Q.fill((g) => g.rect(-1, -1, NS.sIn - 0.1 + 1, 3), { color: '#64686b', rough: 0.62, metal: 0.35 });                        // acoustic liner
    for (let s = 0.3; s < NS.sIn - 0.2; s += 0.34) Q.line([[s, 0], [s, 1]], { px: 0.8, depth: 0.3, dark: 0.18 });
    for (let i = 0; i < 12; i++) Q.line([[0, i / 12], [NS.sIn - 0.12, i / 12]], { px: 0.7, depth: 0.25, dark: 0.14 });
    const sL = zOf(0.34), sF = zOf(1.9);
    Q.fill((g) => g.rect(NS.sIn - 0.1, -1, sL - NS.sIn + 0.1, 3), { color: '#c3c6c8', rough: 0.2, metal: 0.95 });                // polished inlet lip
    Q.ring(sL, 0, 1, line); Q.rivets(sL + 0.02, 0, sL + 0.02, 1, 0.07, { px: 0.8, depth: 0.1, dark: 0.03 });
    Q.ring(sF, 0, 1, seam);                                                                                                       // inlet cowl / fan cowl joint
    for (const t of [0.455, 0.545]) Q.line([[sF, t], [NS.sMax, t]], seam);                                                          // fan-cowl hinges either side of the pylon
    Q.line([[sF, 0.0], [NS.sMax, 0.0]], seam); Q.line([[sF, 1.0], [NS.sMax, 1.0]], seam);
    for (let i = 0; i < 4; i++) { const s = sF + 0.35 + i * 0.45; for (const t of [0.012, 0.988]) Q.fill((g) => g.rect(s, t - 0.007, 0.18, 0.014), { color: '#3c3f42', rough: 0.6, metal: 0.3 }); }   // latches
    for (const t of [0.2, 0.8]) Q.panel(sF + 0.5, t - 0.025, sF + 0.85, t + 0.025, { px: 0.9, depth: 0.35, dark: 0.12 });
    Q.panel(zOf(0.9), 0.31, zOf(1.3), 0.35, { px: 0.9, depth: 0.3, dark: 0.1 });
    const txt = (str, s0, t, h, col, rot = 0) => Q.decalT(s0, t, { girth: 10.2, rot }, (g) => K.drawText(g, str, h, { color: col, weight: 700 }));
    const mark = SC.engineMark || (SC.engine === SC.body ? '#4a4e52' : '#e8e8e4');
    for (const t of [0.3, 0.7]) txt('DANGER', (sL + sF) / 2, t, 0.06, '#b0281e');
    for (const t of [0.25, 0.75]) txt('NO STEP', sF + 1.2, t, 0.05, mark, 90);
    for (const t of [0.1, 0.9]) txt('HOLD OPEN ROD', sF + 0.7, t, 0.035, mark);
    // inlet danger zone: red chevron arcs on the inlet cowl, ahead of the joint
    for (const t of [0.27, 0.73]) Q.decalT((sL + sF) / 2 + 0.25, t, { girth: 10.2 }, (g) => { g.strokeStyle = '#b0281e'; g.lineWidth = 0.025; g.beginPath(); g.moveTo(-0.12, -0.1); g.lineTo(0, 0); g.lineTo(-0.12, 0.1); g.stroke(); });
    if (SC.nacMotif) SC.nacMotif(Q, sF, NS.sMax);
    Q.fill((g) => g.rect(sF + 0.2, 0.42, NS.sMax - sF, 0.16), { color: '#3a3836' }, { alpha: 0.05, feather: 20 });               // pylon-drip grime
    Q.noise({ alpha: 0.025, scale: 2, rough: 0.04 });
  }
  {
    const Q = B.pen(cSlv), so = 2.2;
    Q.fill('all', F.gloss(SC.engine));
    Q.fill((g) => g.rect(so + 0.03, -1, 3, 3), { color: '#4b4f52', rough: 0.6, metal: 0.4 });                                  // inner face of the sleeve
    for (const t of [0.455, 0.545, 0.0, 1.0]) Q.line([[0, t], [so, t]], { px: 1.2, depth: 0.5, dark: 0.25 });
    Q.ring(0.04, 0, 1, { px: 1.4, depth: 0.6, dark: 0.35 });
    for (const t of [0.17, 0.33, 0.67, 0.83]) Q.fill((g) => g.rect(0.25, t - 0.01, 1.0, 0.02), { color: SC.engine, rough: 0.3, metal: 0, height: 0.35 });   // actuator fairings
    const rr = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
    for (let i = 0; i < 14; i++) { const t = rr(); Q.streak(1.0, t, so, t, 0.015, { color: '40,36,32', alpha: 0.06 }); }
    Q.fill((g) => g.rect(so - 0.35, -1, 0.35, 3), { color: '#4a4642' }, { alpha: 0.12, feather: 12 });                          // light exhaust staining at the nozzle lip
    Q.noise({ alpha: 0.025, scale: 2, rough: 0.04 });
  }

}
