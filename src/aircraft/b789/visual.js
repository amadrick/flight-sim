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

const SCHEMES = {
  halcyra: { name: 'Halcyra', title: 'HALCYRA', reg: 'ZZ-HCA', body: '#f5f6f7', belly: '#1b2a4a', cheat: '#d8a942', tail: '#1b2a4a', engine: '#1b2a4a', spinner: '#d8a942', tip: '#1b2a4a', titleColor: '#1b2a4a', font: 'serif', style: 'wave' },
  tidewind: { name: 'Tidewind', title: 'tidewind', reg: 'ZZ-TDW', body: '#f6f7f6', belly: '#c9cdd1', cheat: '#f06a4f', tail: '#0f7f86', engine: '#f6f7f6', spinner: '#0f7f86', tip: '#f06a4f', titleColor: '#0f7f86', font: 'round', style: 'ribbon' },
  house: { name: 'Skyward demonstrator', title: 'SKYWARD', reg: 'ZZ-SK9', body: '#eef0f1', belly: '#3b4148', cheat: '#19b3a6', tail: '#3b4148', engine: '#eef0f1', spinner: '#3b4148', tip: '#19b3a6', titleColor: '#3b4148', font: 'wide', style: 'bands' },
};

const NZ = -29.9;                      // nose tip z
const D = (d) => d + NZ;               // distance from the nose → body z

// ---- planform helpers (right wing) ------------------------------------------------------------------------------------------
const XT = 30.06;
const zLE = (x) => (x <= 11 ? -7.9 + 0.6914 * (x - 2.9) : x <= 28 ? -2.3 + 0.6249 * (x - 11) : 8.32 + 1.40 * (x - 28));
const zTE = (x) => (x <= 11 ? 2.7 + 0.2222 * (x - 2.9) : x <= 28 ? 4.5 + 0.388 * (x - 11) : 11.1 + 0.70 * (x - 28));
const wy = (x) => -1.25 + Math.tan(6.5 * DEG) * (x - 2.9);
// in-flight wing bending (metres up at 1 g), zero inboard of x = 3.5
const FLEX_TIP = 2.6, FLEX_X0 = 3.5;
const bend = (x) => { const a = Math.abs(x); return a <= FLEX_X0 ? 0 : FLEX_TIP * Math.pow((a - FLEX_X0) / (XT - FLEX_X0), 2); };

// engine: inlet highlight centre (geometry.js engines[].intake) and nacelle shape
const EX = 9.5, EY = -2.1, EZ = -8.6, TILT = 1.5 * DEG;
const NAC = { length: 4.9, rHi: 1.44, rMax: 1.62, rThroat: 1.36, rFan: 1.41, zFan: 0.95, rExit: 1.28, sleeve: 0.55, core: { r0: 0.95, r1: 0.58, length: 1.9 }, plug: { r: 0.36, length: 1.15 } };

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
  const A = K.createAtlas({ size: atlasSize, base: F.gloss(SC.body) });
  const cFus = A.chart('fus', { type: 'unwrap', z: [-29.95, 33.0], girth: 18.6, vScale: 0.8, strips: 2 });
  const cPanel = A.chart('panel', { type: 'rect', w: 2.2, h: 0.6, density: 2.2 });
  const cOver = A.chart('overhead', { type: 'rect', w: 0.7, h: 1.0, density: 1.6 });
  A.pack();
  const fairCol = SC.style === 'wave' ? SC.belly : SC.style === 'bands' ? SC.belly : '#c9cdd1';
  const UA = {
    fair: A.swatch('fair', F.gloss(fairCol)),
    dark: A.swatch('dark', F.darkGrey), black: A.swatch('black', F.black), well: A.swatch('well', { color: '#8b9094', rough: 0.7, metal: 0.1 }), liner: A.swatch('liner', { color: '#b8b4ab', rough: 0.8, metal: 0 }),
    post: A.swatch('post', { color: '#4b4a48', rough: 0.7, metal: 0 }), floor: A.swatch('floor', { color: '#34363a', rough: 0.9, metal: 0 }), shield: A.swatch('shield', { color: '#1b1c1e', rough: 0.85, metal: 0 }),
    seat: A.swatch('seat', { color: '#5b5e63', rough: 0.9, metal: 0 }), sheep: A.swatch('sheep', { color: '#a59f8f', rough: 1, metal: 0 }), yoke: A.swatch('yoke', { color: '#17181a', rough: 0.5, metal: 0 }),
    exhaust: A.swatch('exhaust', F.exhaust), steel: A.swatch('steel', F.steel), antenna: A.swatch('antenna', F.gloss('#e9e9e6')), door: A.swatch('door', F.gloss(fairCol)),
  };
  const B = K.createAtlas({ size: atlasSize, base: F.semigloss('#b8bdc2') });
  const cWT = B.chart('wingTop', { type: 'plan', x: [0.9, 30.3], z: [-9.4, 12.8], view: 'top', mirror: true });
  const cWB = B.chart('wingBot', { type: 'plan', x: [0.9, 30.3], z: [-9.4, 12.8], view: 'bottom', mirror: true, density: 0.7 });
  const cSt = B.chart('stab', { type: 'plan', x: [0.4, 9.9], z: [20.2, 29.4], view: 'top', mirror: true, density: 0.85 });
  const cFin = { L: B.chart('finL', { type: 'side', z: [11.6, 28.6], y: [2.1, 13.0], view: 'left' }), R: B.chart('finR', { type: 'side', z: [11.6, 28.6], y: [2.1, 13.0], view: 'right' }) };
  B.pack();
  const UB = {
    grey: B.swatch('grey', F.semigloss('#b8bdc2')), engine: B.swatch('engine', F.gloss(SC.engine)), lip: B.swatch('lip', F.polished), duct: B.swatch('duct', { color: '#2a2c2f', rough: 0.55, metal: 0.3 }),
    acoustic: B.swatch('acoustic', { color: '#8a8d8f', rough: 0.6, metal: 0.6 }), core: B.swatch('core', { color: '#9a9c9e', rough: 0.35, metal: 0.85 }), plug: B.swatch('plug', F.heatStained), blade: B.swatch('blade', { color: '#2f3237', rough: 0.3, metal: 0.7 }),
    spinner: B.swatch('spinner', F.gloss(SC.spinner)), inner: B.swatch('inner', F.primer), pylon: B.swatch('pylon', F.gloss(SC.style === 'bands' ? SC.body : '#e9ebec')),
    tail: B.swatch('tail', F.gloss(SC.tail)), cascade: B.swatch('cascade', { color: '#3a3c3f', rough: 0.6, metal: 0.7 }), wick: B.swatch('wick', F.black), canoe: B.swatch('canoe', F.semigloss('#c3c7cb')),
    chevron: B.swatch('chevron', { color: '#8d9298', rough: 0.4, metal: 0.8 }), hot: B.swatch('hot', { color: '#5f5a55', rough: 0.5, metal: 0.9 }),
  };

  // ---- fuselage -------------------------------------------------------------------------------------------------------------
  //          d      top    bot    w        (top / bot = absolute body heights of crown and keel, w = half-width)
  const FS = [
    [0.00, -0.45, -0.45, 0.00], [0.10, -0.10, -0.82, 0.38], [0.40, 0.18, -1.10, 0.70], [1.00, 0.50, -1.42, 1.08], [1.80, 0.85, -1.80, 1.48],
    [2.60, 1.15, -2.08, 1.80], [3.30, 1.45, -2.28, 2.03], [4.00, 1.80, -2.45, 2.24], [5.00, 2.18, -2.64, 2.46], [6.20, 2.50, -2.80, 2.65],
    [7.50, 2.74, -2.90, 2.78], [9.00, 2.88, -2.96, 2.86], [10.5, 2.94, -2.99, 2.885], [12.0, 2.95, -3.00, 2.89],
    [44.0, 2.95, -3.00, 2.89], [46.5, 2.93, -2.93, 2.87], [49.0, 2.86, -2.68, 2.72], [52.0, 2.70, -2.15, 2.40], [55.0, 2.48, -1.55, 1.98],
    [57.5, 2.25, -1.05, 1.52], [60.0, 1.96, -0.45, 1.00], [61.8, 1.70, 0.02, 0.62], [62.81, 1.48, 0.30, 0.38],
  ].map(r => { const yc = (r[1] + r[2]) / 2 - (r[3] > 0 && r[0] < 12 ? 0.08 * (1 - r[0] / 12) : 0); return { z: D(r[0]), y: yc, w: r[3], top: r[1] - yc, bot: yc - r[2] }; });
  const fseg = Math.max(40, Math.round(96 * detail / 4) * 4);
  const fus = K.loft({
    stations: FS, segments: fseg, step: 1.3 / detail, chart: cFus, capEnd: 'flat', capUV: UA.exhaust,
    cutouts: [{ name: 'ngd', z: [-26.3, -22.4], t: [0, 0.04], mirror: true }],
  });
  cFus.body = fus;
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

  // ---- flight deck (painted windows; the lining leaves them open for the pilot's view) ---------------------------------------
  const tY = (d, y) => fus.tAtY(D(d), y);
  const T0 = 0.493;                                                       // ring parameter of the centre post edge
  // right-hand windows: W1 windshield [inner-low, outer-low, outer-top, inner-top], W2 side "cat-eye" [front-low, aft-low, aft-top, front-top]
  const w1 = { a: [2.76, T0], b: [3.25, tY(3.25, 0.86)], c: [3.95, tY(3.95, 1.64)], e: [3.66, T0] };
  const w2 = { p: [3.36, tY(3.36, 0.85)], q: [5.9, tY(5.9, 1.04)], r: [5.28, tY(5.28, 1.56)], s: [4.06, tY(4.06, 1.63)] };
  const HI = w1.c[1], LO = 0.215, ZBd = 6.6, DF = 2.73;
  const WIN = [[w1.a, w1.b, w1.c, w1.e], [w2.p, w2.q, w2.r, w2.s]].map(w => w.map(([d, t]) => [D(d), t]));
  const eye = G.pilotEye, FY = eye[1] - 1.15, EY0 = eye[1];
  {
    const L = (c, uv, nu = 3, nv = 3) => stA.add(K.liner(fus, c.map(([d, t]) => [D(d), t]), { uv, nu, nv, mirror: true, inset: 0.05 }));
    L([[DF, 0.5], [DF, T0], [w1.e[0], T0], [w1.e[0], 0.5]], UA.post, 1, 4);                                  // centre post
    L([[w1.e[0], 0.5], w1.c, [ZBd, HI], [ZBd, 0.5]], UA.liner, 5, 5);                                          // roof
    L([w1.c, w2.s, w2.r, [w2.r[0], HI]], UA.liner, 3, 2);                                                      // above the side window
    L([[w2.r[0], HI], w2.r, w2.q, [ZBd, HI]], UA.liner, 2, 3);                                                 // behind the side window
    L([w1.b, w2.p, w2.s, w1.c], UA.post, 1, 4);                                                                // corner post
    L([[DF, LO], [w1.b[0], LO], w1.b, w1.a], UA.liner, 3, 6);                                                  // sills and side walls
    L([[w1.b[0], LO], [w2.p[0], LO], w2.p, w1.b], UA.liner, 1, 4);
    L([[w2.p[0], LO], [w2.q[0], LO], w2.q, w2.p], UA.liner, 5, 4);
    L([[w2.q[0], LO], [ZBd, LO], [ZBd, HI], w2.q], UA.liner, 2, 4);
    stA.add(K.deck(fus, D(DF), D(ZBd), FY, { uv: UA.floor, n: 8 }));                                         // floor
    stA.add(K.bulkhead(fus, D(ZBd), { uv: UA.liner, facing: -1 }));                                            // flight-deck door wall
    stA.add(K.bulkhead(fus, D(DF + 0.01), { uv: UA.shield, facing: 1 }));                                     // forward wall under the windshield
    const zp = eye[2] - 0.8;                                                                                   // main instrument panel plane
    { const gy = EY0 - 0.36, gs = K.prism([[zp - 0.3, gy - 0.05], [zp + 0.15, gy], [zp + 0.18, gy - 0.03], [zp + 0.15, gy - 0.08], [zp - 0.3, gy - 0.13]], -1.05, 1.05, UA.shield); stA.add(gs); }   // glareshield
    { const i0 = stA.vertexCount; for (const [a, b] of [[0, 0.6], [2.2, 0.6], [2.2, 0], [0, 0]]) { const uv = cPanel.uv(a, b); stA.vert(a - 1.1, EY0 - 1.07 + (0.6 - b), zp + 0.12 + (0.6 - b) * 0.08, 0, 0.1, 1, uv[0], uv[1]); } stA.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    stA.add(K.box(0.48, 0.45, 1.0, UA.shield).translate(0, FY + 0.3, zp + 0.6));                              // pedestal
    { const i0 = stA.vertexCount, y = EY0 + 0.82; for (const [a, b] of [[0, 0], [0.7, 0], [0.7, 1.0], [0, 1.0]]) { const uv = cOver.uv(a, b); stA.vert(a - 0.35, y + b * 0.2, zp + 0.3 + b, 0, -1, -0.2, uv[0], uv[1]); } stA.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    for (const sx of [-1, 1]) {
      const e = [sx * Math.abs(eye[0]), eye[1], eye[2]];
      stA.add(K.crewSeat({ eye: e, uv: { frame: UA.seat, cushion: UA.sheep } }));
      stA.add(K.yoke({ base: [e[0], FY, e[2] - 0.5], top: [e[0], e[1] - 0.52, e[2] - 0.42], uv: UA.yoke }));
    }
  }

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
    const st = [[0, 0.01, 0.01], [0.15, 0.09, 0.1], [0.4, 0.13, 0.2], [0.65, 0.13, 0.21], [0.88, 0.08, 0.12], [1, 0.01, 0.02]].map(r => ({ z: z0 + r[0] * len, x: side * x, y: y - r[2] * 0.5 + (r[0] > 0.65 ? (r[0] - 0.65) * 0.25 : 0), w: r[1], top: r[2] * 0.6, bot: r[2] }));
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
    const n = K.nacelle({ centre: c, ...NAC, droop: 0.05, segments: Math.max(28, Math.round(44 * detail / 4) * 4),
      uv: UB.engine, uvLip: UB.lip, uvInner: UB.acoustic, uvSleeve: UB.engine, uvCore: UB.core, uvPlug: UB.plug, uvCascade: UB.cascade });
    const fixed = new K.Mesh().add(n.cowl).add(n.cascade).add(n.core).add(n.plug);
    fixed.add(K.fanBackdrop(NAC.rFan, 0.4, UB.duct).translate(c[0], c[1], n.fanZ));
    const exitZ = EZ + NAC.length, coreZ = exitZ + NAC.core.length;
    fixed.add(chevrons(c, coreZ - 0.01, NAC.core.r1, 14, 0.2, 0.05, UB.hot));                             // core nozzle chevrons
    const sl = n.sleeve.clone().add(chevrons(c, exitZ - 0.01, NAC.rExit - 0.012, 16, 0.4, 0.075, UB.chevron));   // bypass chevrons ride on the sleeve
    sl.enableMorph(); for (let i = 2; i < sl.p2.length; i += 3) sl.p2[i] += n.sleeveTravel;            // reverser: sleeve slides aft (morph target)
    sleeveAll.add(tilt(sl)); sleeveTravel = n.sleeveTravel;
    // pylon: a slim fairing on top of the fan cowl running back into the wing leading edge, and the aft fairing under the wing
    const yw = wy(EX), zl = zLE(EX);
    fixed.add(K.pylon([{ y: EY + NAC.rMax - 0.3, z0: EZ + 1.0, z1: zl + 1.2, x: c[0], tc: 0.13 }, { y: yw + 0.28, z0: EZ + 1.6, z1: zl + 0.7, x: c[0], tc: 0.1 }], { uv: UB.pylon }));
    tilt(fixed);
    { const z0 = exitZ - 0.6, len = 6.2, yb = yw - 0.45;
      const st = [[0, 0.02, 0.02], [0.12, 0.26, 0.32], [0.45, 0.3, 0.42], [0.8, 0.2, 0.3], [1, 0.02, 0.04]].map(r => ({ z: z0 + r[0] * len, x: c[0], y: yb + r[0] * 0.35, w: r[1], top: 0.5, bot: r[2] + 0.1 * (1 - r[0]) }));
      fixed.add(K.loft({ stations: st, segments: 14, step: 0.5, uv: UB.pylon }).mesh); }
    stB.add(flexMorph(fixed, () => ENGB));
    const fanMesh = K.fan({ radius: NAC.rFan - 0.01, hub: 0.44, blades: 18, chord: 0.55, staggerRoot: 30, staggerTip: 64, sweep: 0.28, uvBlade: UB.blade, uvSpinner: UB.spinner });
    eng.push({ c, fanZ, fanMesh });
  }

  // ---- small details ----------------------------------------------------------------------------------------------------------
  stA.add(K.bladeAntenna({ pos: [0, fus.topAt(-17) - 0.02, -17], height: 0.3, chord: 0.42, sweep: 0.2, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.topAt(8) - 0.02, 8], height: 0.3, chord: 0.42, sweep: 0.2, uv: UA.antenna }));
  { const z = -6, y = fus.topAt(z); stA.add(K.ellipsoid(0.75, 0.14, 1.6, { segments: 16, rings: 6, uv: UA.antenna }).translate(0, y - 0.03, z)); }   // satcom radome
  stA.add(K.bladeAntenna({ pos: [0, fus.botAt(-16) + 0.02, -16], height: 0.28, chord: 0.4, sweep: 0.18, down: true, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.botAt(15) + 0.02, 15], height: 0.28, chord: 0.4, sweep: 0.18, down: true, uv: UA.antenna }));
  stA.add(K.box(0.28, 0.1, 1.4, UA.steel).translate(0, fus.botAt(23.5) + 0.03, 23.5));                // tail-strike skid
  for (const sx of [-1, 1]) for (const dy of [-0.35, -0.75]) { const z = D(3.4), p = fus.at(z, fus.tAtY(z, dy)).p; stA.add(K.probe([sx * p[0], p[1], p[2]], [sx * (p[0] + 0.15), p[1], p[2] - 0.24], 0.016, UA.steel)); }
  { const sw = []; for (const sx of [-1, 1]) for (const x of [6.5, 8, 9.2]) { const p = stab.R.at(x, 1, 'mid'); sw.push([sx * p[0], p[1], p[2]]); } stB.add(K.staticWicks(sw, 0.22, UB.wick)); }
  { const ww = new K.Mesh(); for (const sx of [-1, 1]) { const pts = []; for (const x of [24.5, 26.2, 27.5]) { const p = W.R.at(x, 1, 'mid'); pts.push([sx * p[0], p[1], p[2]]); } ww.add(K.staticWicks(pts, 0.22, UB.wick)); } stB.add(flexMorph(ww, wingFlex)); }

  lap('geometry');
  // ---- paint + materials ------------------------------------------------------------------------------------------------------
  paintFuselage(A, { SC, fus, cFus, cPanel, cOver, WIN });
  paintSurfaces(B, { SC, W: W.R, fin, stab: stab.R, cWT, cWB, cSt, cFin, SPOIL });
  lap('paint');
  const matA = A.material(ctx, { envMapIntensity: 1, emissiveIntensity: 0 }), matB = B.material(ctx, { envMapIntensity: 1 });
  lap('textures');
  rig.material('paint', matA, { shared: true }); rig.material('wing', matB, { shared: true });
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
      for (const x of xs) { const cn = canoeAt(x, nm === 'In' ? 4.8 : 4.4 - (x - 14) * 0.12, sx); stB.add(flexMorph(cn.front, wingFlex)); mesh.add(cn.rear); }
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
  K.buildGear(rig, A, {
    name: 'nose', index: 0, contact: gp[0].pos, wheels: [-0.33, 0.33], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.3, pivot: [0, -1.5, -23.05], stroke: 0.4, staticFrac: 0.4,
    strutR: 0.12, steer: true, links: 'front', retract: { to: [0, -1.85, -26.2] }, window: [0.2, 0.86], brace: [0, -1.55, -21.6], uv: gearUV, wheelSegments: 24,
    doors: [{ name: 'noseDoorR', ...doorOf(fus.patches.ngdR, fus.edges.ngdR.tHi), open: 86, closes: true }, { name: 'noseDoorL', ...doorOf(fus.patches.ngdL, fus.edges.ngdL.tLo), open: 86, closes: true }],
    lamps: [{ kind: 'taxi', pos: [0, -2.95, -23.42], size: 0.09, color: [1, 0.96, 0.9] }, { kind: 'landing', pos: [-0.22, -3.0, -23.4], size: 0.08, color: [1, 0.97, 0.9] }, { kind: 'landing', pos: [0.22, -3.0, -23.4], size: 0.08, color: [1, 0.97, 0.9] }],
  });
  const legDoor = (P, bottom, sx, w) => K.plate([P[0] + sx * 0.26, P[1] - 0.6, P[2] - w], [P[0] + sx * 0.26, P[1] - 0.6, P[2] + w], [bottom[0] + sx * 0.26, bottom[1], bottom[2] + w], [bottom[0] + sx * 0.26, bottom[1], bottom[2] - w], 0.03, UA.door);
  const bogies = [];
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, R = gp[i].wheelRadius, P = [sx * 5.1, -1.1, 1.6];
    const g = K.buildGear(rig, A, {
      name: 'main' + key, index: i, contact: c, wheels: [-0.71, 0.71], axles: [-1.4, 0, 1.4], wheelRadius: R, wheelWidth: 0.42, pivot: P, stroke: 0.48, staticFrac: 0.4,
      strutR: 0.2, links: 'none', retract: { to: [sx * 2.4, -2.0, 2.6] }, window: [0.2, 0.86], brace: [sx * 5.0, -1.45, -0.7], uv: gearUV, wheelSegments: 22,
      extra: legDoor(P, [c[0], -3.0, c[2] - 0.2], sx, 0.55),
      doors: [{ name: 'mainDoor' + key, ...doorOf(fair.patches['mgw' + key], sx > 0 ? fair.edges['mgw' + key].tLo : fair.edges['mgw' + key].tHi), open: 95, closes: true }],
    });
    // bogie tilt: replace the kit's level bogie beam by a beam that pitches with the wheels about the centre axle
    const Cc = [c[0], c[1] + R, c[2]], dv = [Cc[0] - P[0], Cc[1] - P[1], Cc[2] - P[2]], dl = Math.hypot(...dv), d = dv.map(v => v / dl);
    const pr = 0.2 * 0.62, rod = rig.parts['main' + key + '.rod'];
    const at = (s) => [Cc[0] + d[0] * s, Cc[1] + d[1] * s, Cc[2] + d[2] * s];
    const pm = K.tube(at(-1.3), at(-0.12), pr, pr, { segments: 12, uv: A.swatch('gear.chrome', F.chrome) });
    rod.geometry.dispose(); rod.geometry = pm.translate(-Cc[0], -Cc[1], -Cc[2]).toGeometry();
    const beam = new K.Mesh();
    beam.add(K.tube([Cc[0], Cc[1], Cc[2] - 1.48], [Cc[0], Cc[1], Cc[2] + 1.48], pr * 1.3, pr * 1.3, { segments: 10, uv: gearUV.strut }));
    beam.add(K.tube(at(-0.16), Cc, pr * 1.35, pr * 1.5, { segments: 10, uv: gearUV.strut }));
    for (const z of [-1.4, 0, 1.4]) beam.add(K.tube([Cc[0] - 0.95, Cc[1], Cc[2] + z], [Cc[0] + 0.95, Cc[1], Cc[2] + z], pr * 0.75, pr * 0.75, { segments: 10, uv: A.swatch('gear.link', F.anodised) }));
    const bnode = rig.part('main' + key + '.bogie', beam, { parent: g.piston, pivot: Cc });
    for (const w of g.wheels) { g.piston.remove(w); bnode.add(w); const p = w.userData.pivot; w.position.set(p[0] - Cc[0], p[1] - Cc[1], p[2] - Cc[2]); }
    const set = rig.hinge(bnode, Cc, [Cc[0] + 1, Cc[1], Cc[2]], { ref: [Cc[0], Cc[1], Cc[2] - 1.4], toward: UP });
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
  rig.lamp('beacon', [0, fus.topAt(-1) + 0.04, -1], { color: [1, 0.05, 0.03], size: 0.16, squash: [1, 0.6, 1] });
  rig.lamp('beacon', L.beacon, { color: [1, 0.05, 0.03], size: 0.16, squash: [1, 0.6, 1] });
  for (const sx of [-1, 1]) rig.lamp('landing', [sx * Math.abs(L.landing[0]), L.landing[1], L.landing[2]], { color: [1, 0.97, 0.9], size: 0.2, squash: [1.6, 0.8, 0.5] });
  for (const sx of [-1, 1]) { const p = stab.R.at(3.2, 0.25, 'upper'); rig.lamp('nav', [sx * p[0], p[1] + 0.04, p[2]], { color: [1, 0.98, 0.92], size: 0.07 }); }       // logo lights (fin floodlights)
  for (const sx of [-1, 1]) { const z = -10.5, p = fus.at(z, fus.tAtY(z, 0.2)).p; rig.lamp('landing', [sx * (p[0] + 0.02), p[1], p[2]], { color: [1, 0.97, 0.9], size: 0.07 }); }   // wing inspection lights

  // ---- animation --------------------------------------------------------------------------------------------------------------
  const fanAng = [0, 0];
  let flex = null;
  const qa = new THREE.Quaternion(), za = new THREE.Vector3(0, 0, 1);
  let wingMesh = null;
  for (const f of flexNodes) f.restPos = f.node.position.clone();
  for (const f of fans) f.userData.restPos = f.position.clone();
  sleeves.userData.restPos = sleeves.position.clone();
  rig.onUpdate((S, dt) => {
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
  });
  const visual = rig.build();
  wingMesh = visual.object3D.children.find(o => o.name === 'static:wing');
  lap('rig'); visual.stats.phases = lap.out; visual.stats.sleeveTravel = sleeveTravel;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- paint: fuselage atlas ---------------------------------------------------------------------------------------------------
function paintFuselage(A, o) {
  const { SC, fus, cFus, cPanel, cOver, WIN } = o, F = K.FINISH;
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
  // radome joint (the composite barrels have no lap joints or rivet rows)
  P.ring(D(2.1), 0, 1, { px: 1.2, depth: 0.4, dark: 0.1 });
  // --- flight-deck windows: painted glass inside a black mask ---
  for (const s of [1, -1]) {
    const m = (p) => [p[0], s > 0 ? p[1] : 1 - p[1]];
    for (const w of WIN) {
      const pts = w.map(m), path = (g) => { pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      P.stroke(path, 0, { color: '#16171a', rough: 0.4, metal: 0 }, { join: 'round', px: 10 });
      P.fill(pts, F.paintedGlass);
      P.groove(path, { px: 1.2, depth: 0.5, dark: 0.2 });
    }
  }
  // --- cabin windows (large), doors ---
  const doorsD = [7.5, 18.0, 38.5, 53.5];
  const zs = []; for (let d = 9.0; d < 55.6; d += 0.53) if (doorsD.every(dd => Math.abs(d - dd) > 1.05)) zs.push(D(d));
  const frame = SC.style === 'bands' ? '#d9dde0' : '#c2c6c9';
  P.windows(zs, 0.5, { w: 0.29, h: 0.49, r: 0.13, frame });
  const door = { px: 1.3, depth: 0.6, dark: 0.35 };
  for (const dd of doorsD) { P.doorOn(D(dd) - 0.55, D(dd) + 0.55, -1.0, 1.0, { ...door, handle: true }); P.windows([D(dd)], 0.55, { w: 0.2, h: 0.28, r: 0.08, lit: 0 }); }
  P.doorOn(D(15.0), D(17.7), -2.65, -1.0, { ...door, side: 'R' }); P.doorOn(D(40.5), D(43.0), -2.62, -1.0, { ...door, side: 'R' }); P.doorOn(D(46.6), D(47.8), -2.45, -1.3, { ...door, side: 'R' });   // cargo doors
  // static ports, APU intake, outflow valve, grime
  P.decalOn(D(4.2), -0.95, 'both', (g) => { g.fillStyle = '#9aa0a5'; g.beginPath(); g.ellipse(0, 0, 0.12, 0.08, 0, 0, TAU); g.fill(); g.strokeStyle = '#c42a1e'; g.lineWidth = 0.014; g.strokeRect(-0.19, -0.13, 0.38, 0.26); });
  P.decalOn(D(58.5), 1.6, 'R', (g) => { g.fillStyle = '#3a3d41'; g.fillRect(-0.4, -0.18, 0.8, 0.36); g.fillStyle = '#2b2d30'; for (let i = 0; i < 5; i++) g.fillRect(-0.36 + i * 0.15, -0.14, 0.08, 0.28); });
  P.decalOn(D(49.5), -1.6, 'L', (g) => { g.fillStyle = '#2b2d30'; g.beginPath(); g.ellipse(0, 0, 0.3, 0.16, 0, 0, TAU); g.fill(); });
  const rnd = (() => { let a = 13; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  for (let i = 0; i < 30; i++) { const z = -14 + rnd() * 40, t = rnd() < 0.5 ? rnd() * 0.06 : 1 - rnd() * 0.06; P.streak(z, t, z + 1 + rnd() * 3, t, 0.005 + rnd() * 0.01, { alpha: 0.04 + rnd() * 0.06 }); }
  P.noise({ alpha: 0.025, scale: 4, stretch: [2, 1] });
  // --- flight-deck panels: five large displays ---
  {
    const Q = A.pen(cPanel); Q.fill('all', { color: '#4f504f', rough: 0.7, metal: 0 });
    const scr = (a, b, w, h, col) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#08090a', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(a + 0.012, b + 0.012, w - 0.024, h - 0.024), { color: col, rough: 0.15, metal: 0, emissive: col }); };
    for (const x0 of [0.1, 0.5, 1.3, 1.7]) scr(x0, 0.14, 0.38, 0.28, x0 < 1 ? (x0 < 0.3 ? '#0d2238' : '#101a14') : (x0 < 1.5 ? '#101a14' : '#0d2238'));
    scr(0.92, 0.2, 0.36, 0.24, '#0f1a12');
    Q.fill((g) => g.rect(0.3, 0.005, 1.6, 0.08), { color: '#3a3b3d', rough: 0.6, metal: 0 });
    for (let i = 0; i < 11; i++) Q.fill((g) => g.rect(0.38 + i * 0.135, 0.022, 0.08, 0.04), { color: '#0a0a0a', rough: 0.2, metal: 0, emissive: i % 2 ? '#3a2a08' : '#000000' });
  }
  {
    const Q = A.pen(cOver); Q.fill('all', { color: '#77746c', rough: 0.7, metal: 0 });
    for (let j = 0; j < 10; j++) for (let i = 0; i < 7; i++) Q.fill((g) => g.rect(0.04 + i * 0.093, 0.04 + j * 0.095, 0.07, 0.07), { color: (i + j * 2) % 5 ? '#55534e' : '#2a2a28', rough: 0.6, metal: 0, emissive: (i * 3 + j) % 7 === 0 ? '#1c1403' : undefined });
  }
}

// ---- paint: wings, tail -------------------------------------------------------------------------------------------------------
function paintSurfaces(B, o) {
  const { SC, W, fin, stab, cWT, cWB, cSt, cFin, SPOIL } = o, F = K.FINISH;
  const grey = F.semigloss('#b8bdc2'), dgrey = F.semigloss('#a3a8ad'), metal = { color: '#c9ccce', rough: 0.28, metal: 0.9 }, white = F.gloss('#e6e9eb');
  const line = { px: 1, depth: 0.3, dark: 0.1 }, gap = { px: 1.8, depth: 0.8, dark: 0.45 };
  const at = (x, f) => { const p = W.at(x, f); return [p[0], p[2]]; };
  const Ln = (name, x) => W.lines[name].at(W.spanToU(x));
  const tipFill = F.gloss(SC.tip);
  for (const [chart, top] of [[cWT, true], [cWB, false]]) {
    const Q = B.pen(chart); Q.fill('all', top ? grey : white);
    if (top) Q.fill([at(3.2, Ln('slat', 3.2) + 0.05), at(27.5, Ln('slat', 27.5) + 0.05), at(27.5, Ln('spoil', 27.5) - 0.03), at(3.2, Ln('spoil', 3.2) - 0.03)], dgrey);
    Q.fill([at(1.0, 0), at(28, 0), at(28, 0.03), at(1.0, 0.03)], metal);
    Q.fill([[27.95, zLE(27.95) - 0.15], [30.5, zLE(30.5) - 0.4], [30.5, zTE(30.5) + 0.3], [27.95, zTE(27.95) + 0.15]], tipFill);          // painted raked tips
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
      const r = at(19, 0.42); Q.text(SC.reg, r[0], r[1], 1.0, { color: '#2a2e33', font: K.FONT.sans, weight: 700, rot: 90 });
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
    if (SC.style === 'wave') {           // stylised kingfisher: gold wing arcs and a dot
      Q.decal(c[0], c[1], (g) => {
        g.fillStyle = SC.cheat;
        for (const [r0, r1, a0, a1] of [[1.2, 2.6, -2.4, -0.25], [1.6, 2.2, 0.35, 1.2]]) { g.beginPath(); g.arc(0, 0, r1, a0, a1); g.arc(-0.3, 0.25, r0, a1, a0, true); g.closePath(); g.fill(); }
        g.beginPath(); g.arc(0.55, -0.35, 0.38, 0, TAU); g.fill();
      });
    } else if (SC.style === 'ribbon') {  // coral wave crest with a white foam line
      Q.decal(c[0], c[1], (g) => {
        const rib = (dy, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(-2.6, 1.8 + dy); g.bezierCurveTo(-1.2, 2.8 + dy, 0.3, 1.6 + dy, 0.6, 0.2 + dy); g.bezierCurveTo(0.9, -1.0 + dy, 1.8, -1.5 + dy, 2.7, -1.2 + dy); g.stroke(); };
        rib(0, 0.62, SC.cheat); rib(0.8, 0.22, '#ffffff');
      });
    } else {
      for (const [y0, y1] of [[3.0, 3.6], [3.9, 4.2]]) Q.fill([fa(y0, 0), fa(y1, 0), fa(y1, 1), fa(y0, 1)], F.gloss(SC.cheat));
      Q.text('787', c[0], c[1] + 0.6, 1.9, { color: '#ffffff', font: K.FONT.wide, weight: 700 });
      Q.text('-9', c[0] + 1.0, c[1] - 1.1, 1.1, { color: SC.cheat, font: K.FONT.wide, weight: 700 });
    }
    Q.fill([fa(2.6, 0), fa(12.6, 0), fa(12.6, 0.03), fa(2.6, 0.03)], metal);
    const fg = { px: 1.6, depth: 0.5, dark: 0.3 };
    Q.line([fa(2.75, 1), fa(2.75, 0.7), fa(12.4, 0.7), fa(12.4, 1)], fg);
    const fl = { px: 1, depth: 0.18, dark: 0.06 };
    for (const f of [0.22, 0.46]) Q.line([fa(2.8, f), fa(12.5, f)], fl);
    Q.noise({ alpha: 0.03, scale: 3 });
  }
}
