// Boeing 747-8 Intercontinental — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (5.2 m) when parked.
//
// Reference numbers (docs/aircraft/b748.md; d = distance aft of the nose tip, z = d - 38.5):
//   length 76.25 m, span 68.4 m (raked tips, no winglets), height 19.4 m (fin tip at y = 14.2).
//   Main fuselage: circle R 3.25 centred on y = 0 from d 11 to d 58, belly at y = -3.25 (1.95 m above the ground).
//   Upper deck ("hump"): a separate narrower lobe (half-width 2.42, top y = 4.8) unioned with the main tube; it rises out of
//   the nose behind the radome, carries the flight deck (windshield d 5.3-6.1, eye y 3.2) and fairs back into the crown at
//   d ~ 44 (the 747-8I stretched upper deck).
//   Wing: LE root z -12.4 (x 1.4) / kink x 11.2 (LE z -3.5, chord 9) / x 30.4 (LE z 10.44, chord 4) then a raked tip to
//   x 34.2 (LE z 15.4, chord 1.1); LE sweep 42° inboard, 36° outboard, ~53° on the rake; dihedral 7° from y -2.35 at the
//   body side; supercritical section 13.5 % → 8 %.
//   Engines (GEnx-2B67): fan 2.67 m, nacelle Ø 3.2 m, inlet lip at z -8 (inboard, x ±11.5, y -2.85) and z 0.8 (outboard,
//   x ±23.5, y -1.45); chevroned bypass and core nozzles; translating reverser sleeves.
//   Tail: stab span 22.2 m, LE 37.5°, root LE z 23 at y 1.0, 7° dihedral; fin root LE z 18 (d 56.5) at y 3.2, root chord
//   12.5, tip chord 4.2 at y 14.2, LE sweep 45°, two-segment rudder.
//   Gear: nose (2 wheels, z -27.5), wing gear x ±5.5 z 0.7 and body gear x ±2.5 z 4.7 (4-wheel bogies), 18 wheels.
// The airline liveries are invented for this simulator: they do not reproduce any real operator's name or marks.
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
export const LIVERIES = ['solvane', 'nordhaven', 'house'];

const SCHEMES = {
  solvane: { name: 'Solvane', title: 'SOLVANE', reg: 'ZZ-SLV', body: '#f4f4f1', belly: '#c9ced3', cheat: '#a3192f', accent: '#d6a33a', tail: '#a3192f', engine: '#f4f4f1', tip: '#a3192f', titleColor: '#a3192f', font: 'serif', style: 'sun' },
  nordhaven: { name: 'Nordhaven', title: 'NORDHAVEN', reg: 'ZZ-NHV', body: '#f6f7f8', belly: '#1a2b4c', cheat: '#3fa7d6', accent: '#5fd0a8', tail: '#1a2b4c', engine: '#1a2b4c', tip: '#3fa7d6', titleColor: '#1a2b4c', font: 'wide', style: 'aurora' },
  house: { name: 'Skyward house colours', title: 'SKYWARD', reg: 'ZZ-SKQ', body: '#eef0f1', belly: '#8e979f', cheat: '#1d6fd1', accent: '#1d2a3a', tail: '#eef0f1', engine: '#eef0f1', tip: '#1d6fd1', titleColor: '#1d2a3a', font: 'wide', style: 'bands' },
};

const NZ = -38.5;                      // nose tip z
const D = (d) => d + NZ;               // distance from the nose → body z

// ---- planform helpers (right wing) ------------------------------------------------------------------------------------------
const zLE = (x) => (x <= 11.2 ? -10.7 + 0.9057 * (x - 3.25) : x <= 30.4 ? -3.5 + 0.7261 * (x - 11.2) : 10.44 + (x - 30.4) * 1.30);
const zTE = (x) => (x <= 11.2 ? 4.0 + 0.1887 * (x - 3.25) : x <= 30.4 ? 5.5 + 0.4652 * (x - 11.2) : 14.43 + (x - 30.4) * 0.55);
const wy = (x) => -2.35 + Math.tan(7 * DEG) * (x - 3.25);

// engine centres (inlet highlight plane) — must match geometry.js engines[].intake
const ENG = [[-23.5, -1.6, 0.8], [-11.5, -3.0, -8.0], [11.5, -3.0, -8.0], [23.5, -1.6, 0.8]];
const NAC = { length: 4.7, rHi: 1.33, rMax: 1.55, rThroat: 1.25, rFan: 1.3, zFan: 0.78, rExit: 1.17, sleeve: 0.5, core: { r0: 0.82, r1: 0.52, length: 1.9 }, plug: { r: 0.3, length: 1.05 } };

/** Sawtooth chevron ring at a nozzle exit (kit has none): n triangular teeth from radius r at z, tips `len` aft and `inward` closer to the axis. */
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

/** Write a morph target into `m` (enableMorph first): its vertices rotated by `ang` about the line a→b, in the sense that moves `ref` toward `toward`. */
function rotateMorph(m, a, b, ref, toward, ang) {
  let ax = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const l = Math.hypot(...ax); ax = ax.map(v => v / l);
  const r = [ref[0] - a[0], ref[1] - a[1], ref[2] - a[2]], cr = [ax[1] * r[2] - ax[2] * r[1], ax[2] * r[0] - ax[0] * r[2], ax[0] * r[1] - ax[1] * r[0]];
  const th = (cr[0] * toward[0] + cr[1] * toward[1] + cr[2] * toward[2] < 0 ? -1 : 1) * ang, c = Math.cos(th), s = Math.sin(th);
  for (let i = 0; i < m.p.length; i += 3) {
    const v = [m.p[i] - a[0], m.p[i + 1] - a[1], m.p[i + 2] - a[2]], d = v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2];
    const x = [ax[1] * v[2] - ax[2] * v[1], ax[2] * v[0] - ax[0] * v[2], ax[0] * v[1] - ax[1] * v[0]];
    for (let k = 0; k < 3; k++) m.p2[i + k] = a[k] + v[k] * c + x[k] * s + ax[k] * d * (1 - c);
  }
  return m;
}

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'solvane', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const rig = K.createRig(ctx, { geometry: G, name: 'b748', glassLayer: opts.glassLayer, cockpitRadius: 1.4 });

  // ---- atlases: A = fuselage + upper deck + flight deck + gear, B = wings, tail, nacelles --------------------------------------
  const A = K.createAtlas({ size: atlasSize, base: F.gloss(SC.body) });
  const cFus = A.chart('fus', { type: 'unwrap', z: [-38.5, 37.8], girth: 20.6, vScale: 0.8, strips: 2 });
  const cHump = A.chart('hump', { type: 'unwrap', z: [-35.95, 5.6], girth: 14.2, vScale: 0.62, strips: 2 });
  const cPanel = A.chart('panel', { type: 'rect', w: 2.4, h: 0.6, density: 2.2 });
  const cOver = A.chart('overhead', { type: 'rect', w: 0.7, h: 1.0, density: 1.6 });
  A.pack();
  const UA = {
    body: A.swatch('body', F.gloss(SC.body)), belly: A.swatch('belly', F.gloss(SC.style === 'aurora' ? SC.belly : '#c9ced3')), fair: A.swatch('fair', F.gloss(SC.style === 'aurora' ? SC.belly : '#c9ced3')),
    dark: A.swatch('dark', F.darkGrey), black: A.swatch('black', F.black), well: A.swatch('well', { color: '#8b9094', rough: 0.7, metal: 0.1 }), liner: A.swatch('liner', { color: '#b3afa6', rough: 0.8, metal: 0 }),
    post: A.swatch('post', { color: '#4b4a48', rough: 0.7, metal: 0 }), floor: A.swatch('floor', { color: '#34363a', rough: 0.9, metal: 0 }), shield: A.swatch('shield', { color: '#1b1c1e', rough: 0.85, metal: 0 }),
    seat: A.swatch('seat', { color: '#5b5e63', rough: 0.9, metal: 0 }), sheep: A.swatch('sheep', { color: '#a59f8f', rough: 1, metal: 0 }), yoke: A.swatch('yoke', { color: '#17181a', rough: 0.5, metal: 0 }),
    exhaust: A.swatch('exhaust', F.exhaust), steel: A.swatch('steel', F.steel), antenna: A.swatch('antenna', F.gloss('#e9e9e6')),
  };
  const B = K.createAtlas({ size: atlasSize, base: F.semigloss('#b9bec3') });
  const cWT = B.chart('wingTop', { type: 'plan', x: [1.3, 34.4], z: [-12.6, 17.0], view: 'top', mirror: true });
  const cWB = B.chart('wingBot', { type: 'plan', x: [1.3, 34.4], z: [-12.6, 17.0], view: 'bottom', mirror: true, density: 0.7 });
  const cSt = B.chart('stab', { type: 'plan', x: [1.0, 11.4], z: [21.6, 32.6], view: 'top', mirror: true, density: 0.85 });
  const cFin = { L: B.chart('finL', { type: 'side', z: [16.6, 34.0], y: [2.0, 14.5], view: 'left' }), R: B.chart('finR', { type: 'side', z: [16.6, 34.0], y: [2.0, 14.5], view: 'right' }) };
  B.pack();
  const UB = {
    grey: B.swatch('grey', F.semigloss('#b9bec3')), engine: B.swatch('engine', F.gloss(SC.engine)), lip: B.swatch('lip', F.polished), duct: B.swatch('duct', { color: '#2a2c2f', rough: 0.55, metal: 0.3 }),
    acoustic: B.swatch('acoustic', { color: '#8a8d8f', rough: 0.6, metal: 0.6 }), core: B.swatch('core', { color: '#9a9c9e', rough: 0.35, metal: 0.85 }), plug: B.swatch('plug', F.heatStained), blade: B.swatch('blade', { color: '#3a3d43', rough: 0.3, metal: 0.8 }),
    spinner: B.swatch('spinner', { color: '#c8cacb', rough: 0.3, metal: 0.8 }), inner: B.swatch('inner', F.primer), pylon: B.swatch('pylon', F.gloss(SC.style === 'aurora' ? '#e8eaec' : SC.body)),
    tail: B.swatch('tail', F.gloss(SC.tail)), cascade: B.swatch('cascade', { color: '#3a3c3f', rough: 0.6, metal: 0.7 }), wick: B.swatch('wick', F.black), canoe: B.swatch('canoe', F.semigloss('#c3c7cb')),
    chevron: B.swatch('chevron', { color: '#8d9298', rough: 0.4, metal: 0.8 }), hot: B.swatch('hot', { color: '#5f5a55', rough: 0.5, metal: 0.9 }),
  };

  // ---- main fuselage --------------------------------------------------------------------------------------------------------
  //          d      yc      w     top    bot
  const FS = [
    [0.00, -0.78, 0.00, 0.00, 0.00], [0.08, -0.78, 0.40, 0.36, 0.33], [0.40, -0.72, 0.90, 0.84, 0.74], [1.20, -0.58, 1.55, 1.42, 1.24], [2.20, -0.41, 2.10, 1.92, 1.72],
    [3.40, -0.25, 2.56, 2.34, 2.20], [4.80, -0.12, 2.90, 2.74, 2.66], [6.50, -0.04, 3.11, 3.04, 3.02], [8.50, -0.01, 3.23, 3.22, 3.21], [11.0, 0, 3.25, 3.25, 3.25],
    [50.0, 0, 3.25, 3.25, 3.25], [54.0, 0.0, 3.23, 3.23, 3.22], [58.0, 0.03, 3.13, 3.17, 3.13], [64.0, 0.16, 2.70, 2.69, 2.68], [70.0, 0.34, 1.80, 1.92, 1.93],
    [73.5, 0.85, 0.96, 0.96, 0.90], [75.9, 1.10, 0.40, 0.36, 0.34], [76.3, 1.13, 0.31, 0.27, 0.26],
  ].map(r => ({ z: D(r[0]), y: r[1], w: r[2], top: r[3], bot: r[4] }));
  const fseg = Math.max(40, Math.round(96 * detail / 4) * 4);
  const fus = K.loft({
    stations: FS, segments: fseg, step: 1.3 / detail, chart: cFus, capEnd: 'flat', capUV: UA.exhaust,
    cutouts: [{ name: 'ngd', z: [-30.7, -26.6], t: [0, 0.034], mirror: true }, { name: 'deck', z: [D(5.4), D(9.5)], t: [0.39, 0.61] }],   // 'deck': crown hidden inside the hump (keeps it out of the flight deck)
  });
  cFus.body = fus;
  const stA = new K.Mesh(), stB = new K.Mesh();
  stA.add(fus.mesh);
  stA.add(K.well(K.merge(fus.patches.ngdR, fus.patches.ngdL), 1.35, UA.well, [0, 1, 0]));

  // ---- upper deck lobe ("hump") ------------------------------------------------------------------------------------------------
  //          d      yc     w     top   bot
  const HS = [
    [2.60, 1.00, 0.00, 0.00, 0.00], [3.20, 1.12, 0.90, 0.55, 0.60], [4.20, 1.45, 1.55, 0.95, 0.90], [5.20, 1.75, 2.00, 1.15, 1.00], [6.20, 1.95, 2.25, 1.72, 1.05],
    [7.40, 2.10, 2.36, 2.12, 1.20], [9.00, 2.20, 2.40, 2.33, 1.30], [12.0, 2.25, 2.42, 2.50, 1.30], [16.0, 2.25, 2.42, 2.55, 1.30], [32.0, 2.25, 2.42, 2.55, 1.30],
    [35.5, 2.20, 2.38, 2.43, 1.30], [38.5, 2.02, 2.22, 2.13, 1.25], [41.3, 1.72, 1.92, 1.75, 1.15], [44.1, 1.38, 1.52, 1.55, 1.00],
  ].map(r => ({ z: D(r[0]), y: r[1], w: r[2], top: r[3], bot: r[4], kTop: [0.62, 0.6] }));
  const hump = K.loft({ stations: HS, segments: Math.max(32, Math.round(72 * detail / 4) * 4), step: 0.9 / detail, chart: cHump });
  cHump.body = hump;
  stA.add(hump.mesh);

  // wing-to-body fairing (belly) with the four main-gear bays cut into its flat bottom
  const fairStations = [[-18.0, 1.6, 0.5, 0.5], [-15.0, 2.1, 0.75, 0.7], [-12.0, 2.6, 0.85, 0.8], [-9.5, 3.4, 0.9, 0.85], [-6.5, 4.25, 0.9, 0.85], [2.5, 4.3, 0.9, 0.85], [5.0, 3.9, 0.9, 0.85], [7.0, 3.55, 0.85, 0.85], [9.2, 2.8, 0.7, 0.75], [11.6, 1.9, 0.45, 0.5]]
    .map(r => ({ z: r[0], y: -2.6, w: r[1], top: r[2], bot: r[3], kTop: 0.62, kBot: [0.9, 0.62] }));
  const fairOpts = { stations: fairStations, segments: Math.max(28, Math.round(48 * detail / 4) * 4), step: 0.9, uv: UA.fair };
  let fair = K.loft(fairOpts);
  const tAtX = (z, x) => { let lo = 0, hi = 0.25; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (fair.at(z, m).p[0] < x) lo = m; else hi = m; } return (lo + hi) / 2; };
  fair = K.loft({ ...fairOpts, cutouts: [{ name: 'wgw', z: [-1.75, 1.55], t: [tAtX(0, 2.25), tAtX(0, 4.15)], mirror: true }, { name: 'bgw', z: [1.85, 6.15], t: [tAtX(4, 1.3), tAtX(4, 3.4)], mirror: true }] });
  stA.add(fair.mesh);
  for (const k of ['wgwR', 'wgwL', 'bgwR', 'bgwL']) stA.add(K.well(fair.patches[k], 1.45, UA.well, [0, 1, 0]));

  // ---- flight deck (painted windows on the hump; the lining leaves them open for the pilot's view) ---------------------------
  const ZB = D(8.6);
  // window corners as distances from the nose (d) and hump ring parameters (t): windshield W1, No. 2 window W2, sliding window W3
  const w1 = { fi: 5.18, fo: 5.40, bo: 6.10, bi: 6.24, ti: 0.492, to: 0.40, tb: 0.432 };
  const w2 = { fl: 5.48, bl: 6.55, fu: 6.17, tfl: 0.393, tbl: 0.352, tbu: 0.405, tfu: 0.426 };
  const w3 = { f: 6.65, bl: 7.40, bu: 7.30, tfl: 0.35, tbl: 0.343, tbu: 0.385, tfu: 0.40 };
  const WIN = [   // right-hand window polygons (z, t) on the hump skin
    [[D(w1.fi), w1.ti], [D(w1.fo), w1.to], [D(w1.bo), w1.tb], [D(w1.bi), w1.ti]],
    [[D(w2.fl), w2.tfl], [D(w2.bl), w2.tbl], [D(w2.bl), w2.tbu], [D(w2.fu), w2.tfu]],
    [[D(w3.f), w3.tfl], [D(w3.bl), w3.tbl], [D(w3.bu), w3.tbu], [D(w3.f), w3.tfu]],
  ];
  const eye = G.pilotEye, FY = 2.0, DF = w1.fi - 0.03;
  {
    const L = (c, uv, nu = 3, nv = 3) => stA.add(K.liner(hump, c.map(([d, t]) => [D(d), t]), { uv, nu, nv, mirror: true, inset: 0.05 }));
    const lo = 0.245, hi = w1.tb, zb = 8.6;
    L([[DF, 0.5], [DF, w1.ti], [w1.bi, w1.ti], [w1.bi, 0.5]], UA.post, 1, 4);                                  // centre post
    L([[w1.bi, 0.5], [w1.bo, hi], [zb, hi], [zb, 0.5]], UA.liner, 5, 5);                                       // roof
    L([[w1.bo, hi], [w2.fu, w2.tfu], [w2.bl, w2.tbu], [w2.bl, hi]], UA.liner);                                // above the side windows
    L([[w2.bl, hi], [w2.bl, w2.tbu], [w3.f, w3.tfu], [w3.f, hi]], UA.liner, 1, 2);
    L([[w3.f, hi], [w3.f, w3.tfu], [w3.bu, w3.tbu], [w3.bu, hi]], UA.liner);
    L([[w3.bu, hi], [w3.bu, w3.tbu], [w3.bl, w3.tbl], [zb, hi]], UA.liner);
    L([[w1.fo, w1.to], [w2.fl, w2.tfl], [w2.fu, w2.tfu], [w1.bo, hi]], UA.post, 1, 4);                         // posts
    L([[w2.bl, w2.tbl], [w3.f, w3.tfl], [w3.f, w3.tfu], [w2.bl, w2.tbu]], UA.post, 1, 3);
    L([[DF, lo], [w1.fo, lo], [w1.fo, w1.to], [w1.fi, w1.ti]], UA.liner, 3, 6);                               // sills and side walls
    L([[w1.fo, lo], [w2.fl, lo], [w2.fl, w2.tfl], [w1.fo, w1.to]], UA.liner, 1, 4);
    L([[w2.fl, lo], [w2.bl, lo], [w2.bl, w2.tbl], [w2.fl, w2.tfl]], UA.liner, 4, 4);
    L([[w2.bl, lo], [w3.f, lo], [w3.f, w3.tfl], [w2.bl, w2.tbl]], UA.liner, 1, 4);
    L([[w3.f, lo], [w3.bl, lo], [w3.bl, w3.tbl], [w3.f, w3.tfl]], UA.liner, 3, 4);
    L([[w3.bl, lo], [zb, lo], [zb, hi], [w3.bl, w3.tbl]], UA.liner, 3, 4);
    stA.add(K.deck(hump, D(DF), ZB, FY, { uv: UA.floor, n: 8, inset: 0.15 }));                   // floor
    stA.add(K.bulkhead(hump, ZB, { uv: UA.liner, facing: -1 }));                                   // flight-deck door wall
    stA.add(K.bulkhead(hump, D(DF + 0.01), { uv: UA.shield, facing: 1 }));                               // forward wall under the windshield
    const zp = eye[2] - 0.82;                                                                       // main instrument panel plane
    { const gs = K.prism([[zp - 0.22, 2.92], [zp + 0.17, 2.96], [zp + 0.2, 2.93], [zp + 0.17, 2.89], [zp - 0.22, 2.86]], -1.15, 1.15, UA.shield); stA.add(gs); }   // glareshield
    { const i0 = stA.vertexCount; for (const [a, b] of [[0, 0.6], [2.4, 0.6], [2.4, 0], [0, 0]]) { const uv = cPanel.uv(a, b); stA.vert(a - 1.2, 2.3 + (0.6 - b), zp + (0.6 - b) * 0.1, 0, 0.1, 1, uv[0], uv[1]); } stA.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    stA.add(K.box(0.5, 0.5, 1.05, UA.shield).translate(0, FY + 0.32, zp + 0.55));                  // pedestal
    { const i0 = stA.vertexCount, y = 3.72; for (const [a, b] of [[0, 0], [0.7, 0], [0.7, 1.0], [0, 1.0]]) { const uv = cOver.uv(a, b); stA.vert(a - 0.35, y + b * 0.2, zp + 0.25 + b, 0, -1, -0.2, uv[0], uv[1]); } stA.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    for (const sx of [-1, 1]) {
      const e = [sx * Math.abs(eye[0]), eye[1], eye[2]];
      stA.add(K.crewSeat({ eye: e, uv: { frame: UA.seat, cushion: UA.sheep } }));
      stA.add(K.yoke({ base: [e[0], FY, e[2] - 0.5], top: [e[0], e[1] - 0.52, e[2] - 0.42], uv: UA.yoke }));
    }
  }

  // ---- wings ----------------------------------------------------------------------------------------------------------------
  const wst = (x, tc, twist) => ({ x, y: wy(x), z: zLE(x), chord: zTE(x) - zLE(x), tc, twist });
  const sc = K.supercritical();
  const wingOf = (side) => K.wing({
    side, airfoil: sc, chordPts: Math.round(16 * Math.min(1, detail)), spanAxis: 'x', tip: 'round', tipLength: 0.5,
    stations: [wst(1.4, 0.135, 2), wst(11.2, 0.105, 0.3), wst(30.4, 0.085, -2.5), wst(34.2, 0.08, -3)],
    lines: { kru: [[1.4, 0.12], [11.2, 0.12], [34.2, 0.14]], spoil: [[1.4, 0.6], [11.2, 0.6], [34.2, 0.62]], flap: [[1.4, 0.72], [11.2, 0.72], [34.2, 0.74]], aft: [[1.4, 0.87], [11.2, 0.87], [34.2, 0.885]] },
    controls: [
      { name: 'flapIn', type: 'flap', span: [3.45, 10.45], from: 'flap', to: 'aft', nose: 1, tail: 0.6 },
      { name: 'aftIn', type: 'flap', span: [3.45, 10.45], from: 'aft', nose: 1 },
      { name: 'ailIn', type: 'flap', span: [11.35, 13.85], from: 'flap', nose: 1 },
      { name: 'flapOut', type: 'flap', span: [14.05, 23.9], from: 'flap', to: 'aft', nose: 1, tail: 0.6 },
      { name: 'aftOut', type: 'flap', span: [14.05, 23.9], from: 'aft', nose: 1 },
      { name: 'ailOut', type: 'flap', span: [24.1, 29.9], from: 'flap', nose: 1 },
      { name: 'kruIn', type: 'panel', surface: 'lower', span: [3.5, 10.6], to: 'kru', hinge: 'front', thickness: 0.04 },
      { name: 'kruOutA', type: 'panel', surface: 'lower', span: [12.3, 22.6], to: 'kru', hinge: 'front', thickness: 0.04 },
      { name: 'kruOutB', type: 'panel', surface: 'lower', span: [24.4, 30.2], to: 'kru', hinge: 'front', thickness: 0.04 },
      { name: 'spIn1', type: 'panel', surface: 'upper', span: [4.1, 7.15], from: 'spoil', to: 'flap', hinge: 'front' },
      { name: 'spIn2', type: 'panel', surface: 'upper', span: [7.25, 10.3], from: 'spoil', to: 'flap', hinge: 'front' },
      { name: 'spOut1', type: 'panel', surface: 'upper', span: [14.2, 16.55], from: 'spoil', to: 'flap', hinge: 'front' },
      { name: 'spOut2', type: 'panel', surface: 'upper', span: [16.65, 19.0], from: 'spoil', to: 'flap', hinge: 'front' },
      { name: 'spOut3', type: 'panel', surface: 'upper', span: [19.1, 21.4], from: 'spoil', to: 'flap', hinge: 'front' },
      { name: 'spOut4', type: 'panel', surface: 'upper', span: [21.5, 23.75], from: 'spoil', to: 'flap', hinge: 'front' },
    ],
    charts: { upper: cWT, lower: cWB }, innerUV: UB.inner, edgeUV: UB.grey,
  });
  const W = { R: wingOf(1), L: wingOf(-1) };
  stB.add(W.R.mesh).add(W.L.mesh);
  // flap-track fairings ("canoes"): front part fixed under the wing, rear part rides on the main flap
  const canoeAt = (x, len, side) => {
    const zf = W.R.at(x, 0.72, 'lower'), z0 = zf[2] - len * 0.42, y = zf[1] - 0.08;
    const st = [[0, 0.01, 0.01], [0.1, 0.17, 0.2], [0.32, 0.27, 0.42], [0.6, 0.27, 0.45], [0.86, 0.17, 0.28], [1, 0.015, 0.03]].map(r => ({ z: z0 + r[0] * len, x: side * x, y: y - r[2] * 0.5 + (r[0] > 0.6 ? (r[0] - 0.6) * 0.35 : 0), w: r[1], top: r[2] * 0.6, bot: r[2] }));
    const split = zf[2] + 0.15;
    return { front: K.loft({ stations: st, segments: 12, step: 0.45, uv: UB.canoe, zRange: [z0, split] }).mesh, rear: K.loft({ stations: st, segments: 12, step: 0.45, uv: UB.canoe, zRange: [split, z0 + len], capStart: 'flat' }).mesh };
  };

  // ---- tail -------------------------------------------------------------------------------------------------------------------
  const sy = (x) => 1.0 + (x - 2.9) * Math.tan(7 * DEG), zLEs = (x) => 23.0 + (x - 2.9) * Math.tan(37.5 * DEG);
  const stabOf = (side) => K.wing({
    side, airfoil: K.naca4('0011'), chordPts: Math.round(11 * Math.min(1, detail)), spanAxis: 'x', tip: 'round', tipLength: 0.5,
    stations: [{ x: 1.2, y: sy(1.2), z: zLEs(1.2), chord: 8.2, tc: 0.11 }, { x: 11.1, y: sy(11.1), z: zLEs(11.1), chord: 2.6, tc: 0.09 }],
    lines: { hinge: [[1.2, 0.7], [11.1, 0.7]] },
    controls: [{ name: 'elevIn', type: 'flap', span: [2.95, 6.7], from: 'hinge', nose: 1 }, { name: 'elevOut', type: 'flap', span: [6.8, 10.8], from: 'hinge', nose: 1 }],
    charts: { upper: cSt, lower: cSt }, edgeUV: UB.grey,
  });
  const stab = { R: stabOf(1), L: stabOf(-1) };
  stB.add(stab.R.mesh).add(stab.L.mesh);
  const fin = K.wing({
    airfoil: K.naca4('0011'), chordPts: Math.round(12 * Math.min(1, detail)), spanAxis: 'y', tip: 'round', tipLength: 0.5,
    stations: [{ x: 0, y: 2.2, z: 17.0, chord: 13.25, tc: 0.11 }, { x: 0, y: 14.2, z: 29.0, chord: 4.2, tc: 0.09 }],
    lines: { hinge: [[2.2, 0.7], [14.2, 0.7]] },
    controls: [{ name: 'rudLo', type: 'flap', span: [3.55, 8.65], from: 'hinge', nose: 1 }, { name: 'rudUp', type: 'flap', span: [8.75, 13.85], from: 'hinge', nose: 1 }],
    charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.tail,
  });
  stB.add(fin.mesh);
  stB.add(K.wing({ airfoil: K.naca4('0008'), chordPts: 6, spanAxis: 'y', tip: 'flat', uv: UB.tail, edgeUV: UB.tail,       // dorsal fillet
    stations: [{ x: 0, y: 2.9, z: 13.2, chord: 6.8, tc: 0.025 }, { x: 0, y: 3.95, z: 18.6, chord: 1.6, tc: 0.08 }] }).mesh);

  // ---- engines ----------------------------------------------------------------------------------------------------------------
  const eng = [], sleeveAll = new K.Mesh();
  let sleeveTravel = 0;
  for (const c of ENG) {
    const n = K.nacelle({ centre: c, ...NAC, droop: 0.05, segments: Math.max(28, Math.round(44 * detail / 4) * 4),
      uv: UB.engine, uvLip: UB.lip, uvInner: UB.acoustic, uvSleeve: UB.engine, uvCore: UB.core, uvPlug: UB.plug, uvCascade: UB.cascade });
    stB.add(n.cowl).add(n.cascade).add(n.core).add(n.plug);
    stB.add(K.fanBackdrop(NAC.rFan, 0.4, UB.duct).translate(c[0], c[1], n.fanZ));
    const exitZ = c[2] + NAC.length, coreZ = exitZ + NAC.core.length;
    stB.add(chevrons(c, coreZ - 0.01, NAC.core.r1, 14, 0.2, 0.05, UB.hot));                          // core nozzle chevrons
    const sl = n.sleeve.clone().add(chevrons(c, exitZ - 0.01, NAC.rExit - 0.012, 18, 0.34, 0.07, UB.chevron));   // bypass chevrons ride on the sleeve
    sl.enableMorph(); for (let i = 2; i < sl.p2.length; i += 3) sl.p2[i] += n.sleeveTravel;            // reverser: sleeve slides aft (morph target)
    sleeveAll.add(sl); sleeveTravel = n.sleeveTravel;
    // pylon: from the top of the fan cowl back into the wing leading edge and under the wing to the aft fairing
    { const x = Math.abs(c[0]), yw = wy(x), zl = zLE(x);
      stB.add(K.pylon([{ y: c[1] + 1.2, z0: c[2] + 1.1, z1: c[2] + 7.3, x: c[0], tc: 0.11 }, { y: yw + 0.1, z0: zl - 1.6, z1: zl + 5.2, x: c[0], tc: 0.08 }], { uv: UB.pylon }));
      const z0 = c[2] + 6.4, len = 5.2, yb = yw - 0.62;                                                 // aft pylon fairing under the wing
      const st = [[0, 0.02, 0.02], [0.15, 0.3, 0.3], [0.5, 0.36, 0.4], [0.85, 0.22, 0.28], [1, 0.02, 0.04]].map(r => ({ z: z0 + r[0] * len, x: c[0], y: yb + r[0] * 0.3, w: r[1], top: 0.55, bot: r[2] }));
      stB.add(K.loft({ stations: st, segments: 14, step: 0.5, uv: UB.pylon }).mesh); }
    eng.push({ c, n, fanMesh: K.fan({ radius: NAC.rFan - 0.01, hub: 0.42, blades: 18, chord: 0.5, staggerRoot: 30, staggerTip: 64, sweep: 0.22, uvBlade: UB.blade, uvSpinner: UB.spinner }) });
  }

  // ---- small details ----------------------------------------------------------------------------------------------------------
  stA.add(K.bladeAntenna({ pos: [0, hump.topAt(-24) - 0.02, -24], height: 0.32, chord: 0.45, sweep: 0.2, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.topAt(12) - 0.02, 12], height: 0.32, chord: 0.45, sweep: 0.2, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.botAt(-20) + 0.02, -20], height: 0.3, chord: 0.42, sweep: 0.18, down: true, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.botAt(14) + 0.02, 14], height: 0.3, chord: 0.42, sweep: 0.18, down: true, uv: UA.antenna }));
  stA.add(K.box(0.3, 0.12, 1.6, UA.steel).translate(0, fus.botAt(30.5) + 0.02, 30.5));               // tail-strike skid
  for (const sx of [-1, 1]) for (const dy of [0.35, 0.75]) { const z = D(3.6), p = fus.at(z, fus.tAtY(z, dy - 0.6)).p; stA.add(K.probe([sx * p[0], p[1], p[2]], [sx * (p[0] + 0.16), p[1], p[2] - 0.25], 0.016, UA.steel)); }
  { const wicks = []; for (const sx of [-1, 1]) { for (const x of [27, 29, 31, 33.2]) { const p = W.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } for (const x of [8, 9.6, 10.9]) { const p = stab.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } } stB.add(K.staticWicks(wicks, 0.25, UB.wick)); }

  lap('geometry');
  // ---- paint + materials ------------------------------------------------------------------------------------------------------
  paintFuselage(A, { SC, fus, hump, cFus, cHump, cPanel, cOver, WIN });
  paintSurfaces(B, { SC, W: W.R, fin, stab: stab.R, cWT, cWB, cSt, cFin });
  lap('paint');
  const matA = A.material(ctx, { envMapIntensity: 1, emissiveIntensity: 0 }), matB = B.material(ctx, { envMapIntensity: 1 });
  lap('textures');
  rig.material('paint', matA, { shared: true }); rig.material('wing', matB, { shared: true });
  rig.disposables.push(A, B);

  // ---- moving surfaces --------------------------------------------------------------------------------------------------------
  const drop = (ctrl, d, aft = 0) => { const u = ctrl.up, h = ctrl.hinge, o = [-u[0] * d, -u[1] * d, -u[2] * d + aft]; return { a: [h.a[0] + o[0], h.a[1] + o[1], h.a[2] + o[2]], b: [h.b[0] + o[0], h.b[1] + o[1], h.b[2] + o[2]] }; };
  const hingeOn = (name, mesh, line, ref, toward, parent) => { const node = rig.part(name, mesh, { key: 'wing', pivot: line.a, parent }); return rig.hinge(node, line.a, line.b, { ref, toward }); };
  const DOWN = [0, -1, 0], UP = [0, 1, 0];
  const wingAnim = [];
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const C = W[key].controls, a = {};
    for (const [nm, xs] of [['In', [6.4, 9.7]], ['Out', [15.4, 19.4, 23.3]]]) {
      const main = C['flap' + nm], aft = C['aft' + nm], mesh = main.mesh.clone();
      for (const x of xs) { const cn = canoeAt(x, nm === 'In' ? 6.2 : 5.6 - (x - 15) * 0.12, sx); stB.add(cn.front); mesh.add(cn.rear); }
      // the aft segment rides on the main flap and folds a further 22° down as a morph target (saves a draw call per segment)
      const aftM = aft.mesh.clone().enableMorph(), al = drop(aft, 0.3);
      rotateMorph(aftM, al.a, al.b, aft.ref, DOWN, 22 * DEG);
      mesh.add(aftM);
      const line = drop(main, nm === 'In' ? 2.3 : 1.9, 0.1), node = rig.part(`flap${nm}${key}`, mesh, { key: 'wing', pivot: line.a });
      a['flap' + nm] = rig.hinge(node, line.a, line.b, { ref: main.ref, toward: DOWN });
      a['aft' + nm] = (ang) => { node.morphTargetInfluences[0] = ang; };
    }
    a.ailIn = rig.hingePart('aileronIn' + key, C.ailIn, { key: 'wing' }).set;
    a.ailOut = rig.hingePart('aileronOut' + key, C.ailOut, { key: 'wing' }).set;
    a.kruIn = hingeOn('kruegerIn' + key, C.kruIn.mesh, C.kruIn.hinge, C.kruIn.ref, DOWN);
    a.kruOut = hingeOn('kruegerOut' + key, K.merge(C.kruOutA.mesh, C.kruOutB.mesh), C.kruOutA.hinge, C.kruOutA.ref, DOWN);
    a.spIn = hingeOn('spoilerIn' + key, K.merge(C.spIn1.mesh, C.spIn2.mesh), C.spIn1.hinge, C.spIn1.ref, UP);
    a.spOut = hingeOn('spoilerOut' + key, K.merge(C.spOut1.mesh, C.spOut2.mesh, C.spOut3.mesh, C.spOut4.mesh), C.spOut1.hinge, C.spOut1.ref, UP);
    a.elev = rig.hingePart('elevator' + key, stab[key].controls.elevIn, { key: 'wing', mesh: K.merge(stab[key].controls.elevIn.mesh, stab[key].controls.elevOut.mesh) }).set;
    a.key = key; wingAnim.push(a);
  }
  const rud = rig.hingePart('rudder', fin.controls.rudLo, { key: 'wing', toward: [1, 0, 0], mesh: K.merge(fin.controls.rudLo.mesh, fin.controls.rudUp.mesh) });
  const fans = eng.map((e, i) => rig.part('fan' + i, e.fanMesh.translate(e.c[0], e.c[1], e.n.fanZ), { key: 'wing', pivot: [e.c[0], e.c[1], e.n.fanZ] }));
  const sleeves = rig.part('reversers', sleeveAll, { key: 'wing' });
  rig.addStatic(stB, 'wing');

  // ---- landing gear -----------------------------------------------------------------------------------------------------------
  const gp = G.gear, gearUV = { strut: A.swatch('gear.strut', F.gearWhite), hub: A.swatch('gear.hub', { color: '#c9cbc8', rough: 0.35, metal: 0.4 }) };
  const doorOf = (patch, edge) => ({ mesh: K.thicken(patch, 0.03, UA.well), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  K.buildGear(rig, A, {
    name: 'nose', index: 0, contact: gp[0].pos, wheels: [-0.36, 0.36], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.4, pivot: [0, -2.0, -27.05], stroke: 0.42, staticFrac: 0.4,
    strutR: 0.13, steer: true, links: 'front', retract: { to: [0, -2.3, -30.2] }, window: [0.2, 0.86], brace: [0, -2.1, -25.6], uv: gearUV, wheelSegments: 24,
    doors: [{ name: 'noseDoorR', ...doorOf(fus.patches.ngdR, fus.edges.ngdR.tHi), open: 86, closes: true }, { name: 'noseDoorL', ...doorOf(fus.patches.ngdL, fus.edges.ngdL.tLo), open: 86, closes: true }],
    lamps: [{ kind: 'taxi', pos: [0, -3.55, -27.35], size: 0.1, color: [1, 0.96, 0.9] }],
  });
  const legDoor = (P, bottom, sx, w) => K.plate([P[0] + sx * 0.24, P[1] - 0.2, P[2] - w], [P[0] + sx * 0.24, P[1] - 0.2, P[2] + w], [bottom[0] + sx * 0.24, bottom[1], bottom[2] + w], [bottom[0] + sx * 0.24, bottom[1], bottom[2] - w], 0.03, UA.fair);
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {                       // wing gear: swings inboard into the belly fairing
    const c = gp[i].pos, P = [c[0], -2.15, c[2] + 0.2];
    K.buildGear(rig, A, {
      name: 'wing' + key, index: i, contact: c, wheels: [-0.56, 0.56], axles: [-0.74, 0.74], wheelRadius: gp[i].wheelRadius, wheelWidth: 0.42, pivot: P, stroke: 0.5, staticFrac: 0.4,
      strutR: 0.19, links: 'none', retract: { to: [sx * 3.05, -2.45, -0.15] }, window: [0.2, 0.86], brace: [c[0] - sx * 1.4, -2.4, c[2] - 0.6], uv: gearUV, wheelSegments: 22,
      extra: legDoor(P, [c[0], -3.6, c[2]], sx, 0.62),
      doors: [{ name: 'wingDoor' + key, ...doorOf(fair.patches['wgw' + key], sx > 0 ? fair.edges['wgw' + key].tLo : fair.edges['wgw' + key].tHi), open: 95, closes: true }],
    });
  }
  for (const [i, sx, key] of [[3, -1, 'L'], [4, 1, 'R']]) {                       // body gear: swings forward into the belly
    const c = gp[i].pos, P = [c[0], -1.55, c[2] + 0.85];
    K.buildGear(rig, A, {
      name: 'body' + key, index: i, contact: c, wheels: [-0.56, 0.56], axles: [-0.74, 0.74], wheelRadius: gp[i].wheelRadius, wheelWidth: 0.42, pivot: P, stroke: 0.5, staticFrac: 0.4,
      strutR: 0.19, links: 'none', retract: { to: [c[0], -1.85, 2.3] }, window: [0.2, 0.86], brace: [c[0], -1.8, c[2] + 2.4], uv: gearUV, wheelSegments: 22,
      doors: [{ name: 'bodyDoor' + key, ...doorOf(fair.patches['bgw' + key], sx > 0 ? fair.edges['bgw' + key].tHi : fair.edges['bgw' + key].tLo), open: 95, closes: true }],
    });
  }
  rig.addStatic(stA, 'paint');

  // ---- lamps ------------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.14, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.14, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.12 });
  for (const sx of [-1, 1]) { const p = W.R.at(34.0, 0.88, 'mid'); rig.lamp('strobe', [sx * (p[0] + 0.05), p[1], p[2]], { color: [1, 1, 1], size: 0.12 }); }
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.12 });
  rig.lamp('beacon', [0, hump.topAt(-14) + 0.04, -14], { color: [1, 0.05, 0.03], size: 0.18, squash: [1, 0.6, 1] });
  rig.lamp('beacon', L.beacon, { color: [1, 0.05, 0.03], size: 0.18, squash: [1, 0.6, 1] });
  for (const sx of [-1, 1]) rig.lamp('landing', [sx * Math.abs(L.landing[0]), L.landing[1], L.landing[2]], { color: [1, 0.97, 0.9], size: 0.22, squash: [1.6, 0.8, 0.5] });

  // ---- animation --------------------------------------------------------------------------------------------------------------
  const fanAng = [0, 0, 0, 0];
  rig.onUpdate((S, dt) => {
    const sf = S.sf, f = sf.flaps, sl = Math.max(sf.slats, 0);
    for (const a of wingAnim) {
      const R = a.key === 'R', ail = R ? sf.aileronR : sf.aileronL, sp = R ? sf.spoilerR : sf.spoilerL, el = R ? sf.elevatorR : sf.elevatorL;
      a.flapIn(f * 32 * DEG); a.flapOut(f * 30 * DEG); a.aftIn(f); a.aftOut(f);
      a.ailIn(ail * 18 * DEG - f * 8 * DEG); a.ailOut((S.onGround || f > 0.05 ? 1 : 0.35) * ail * 22 * DEG);
      a.kruIn(sl * 115 * DEG); a.kruOut(sl * 105 * DEG);
      a.spOut(Math.max(sp, sf.speedbrake * (S.onGround ? 1 : 0.6)) * 45 * DEG);
      a.spIn((S.onGround ? Math.max(sf.speedbrake, sp > 0.9 ? sp : 0) : sf.speedbrake * 0.4) * 50 * DEG);
      a.elev(el * 22 * DEG);
    }
    rud.set(sf.rudder * 28 * DEG);
    let rev = 0;
    for (let i = 0; i < 4; i++) {
      const e = S.eng[i] || {};
      fanAng[i] = (fanAng[i] + (e.n1 || 0) * 22 * dt) % TAU;
      fans[i].quaternion.set(0, 0, Math.sin(fanAng[i] / 2), Math.cos(fanAng[i] / 2));
      rev = Math.max(rev, e.reverser || 0);
    }
    sleeves.morphTargetInfluences[0] = rev;
    matA.emissiveIntensity = S.night * 2.4;
  });
  const visual = rig.build();
  lap('rig'); visual.stats.phases = lap.out; visual.stats.sleeveTravel = sleeveTravel;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- paint: fuselage atlas ---------------------------------------------------------------------------------------------------
function paintFuselage(A, o) {
  const { SC, fus, hump, cFus, cHump, cPanel, cOver, WIN } = o, F = K.FINISH;
  const P = A.pen(cFus), H = A.pen(cHump), body = F.gloss(SC.body), belly = F.gloss(SC.belly), cheat = F.gloss(SC.cheat), accent = F.gloss(SC.accent), tail = F.gloss(SC.tail);
  const font = SC.font === 'serif' ? K.FONT.serif : SC.font === 'round' ? K.FONT.round : K.FONT.wide;
  const Z0 = -38.5, Z1 = 37.8;
  P.fill('all', body); H.fill('all', body);
  // --- livery ---
  if (SC.style === 'sun') {             // grey belly, crimson cheatline with a gold pinstripe, crimson tail cone
    P.band(Z0, Z1, -Infinity, -1.45, belly, { step: 0.5, feather: 2 });
    P.band(-34.5, 30, (z) => -0.62 + Math.max(0, z - 18) * 0.06, (z) => -0.26 + Math.max(0, z - 18) * 0.06, cheat, { step: 0.4 });
    P.band(-34.5, 30, (z) => -0.8 + Math.max(0, z - 18) * 0.06, (z) => -0.7 + Math.max(0, z - 18) * 0.06, accent, { step: 0.4 });
    P.band(29.5, Z1, -Infinity, Infinity, tail, { step: 0.3 });
    P.textOn(SC.title, -17.5, 1.62, 'both', 0.78, { color: SC.titleColor, font, weight: 700, spacing: 0.12 });
  } else if (SC.style === 'aurora') {   // navy belly rising into the tail, light-blue and green accent lines
    const edge = (z) => (z < 8 ? -0.95 + (z + 38.5) * 0.003 : -0.81 + Math.pow((z - 8) / 22, 2.0) * 4.6);
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.36, accent, { step: 0.25 });
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.2, cheat, { step: 0.25 });
    P.band(Z0, Z1, -Infinity, edge, belly, { step: 0.25 });
    P.textOn(SC.title, -16.5, 1.6, 'both', 0.72, { color: SC.titleColor, font, weight: 700, spacing: 0.1 });
  } else {                              // 'bands': grey belly, a blue stripe through the main-deck windows, a thin one on the hump
    P.band(Z0, Z1, -Infinity, -1.25, belly, { step: 0.5 });
    P.band(-35.5, 30, -0.1, 0.8, cheat, { step: 0.5 });
    P.band(-35.5, 30, -0.3, -0.18, F.gloss(SC.accent), { step: 0.5 });
    H.band(-33.0, 3.5, 3.72, 3.86, cheat, { step: 0.5 });
    P.textOn(SC.title, -17, 1.62, 'both', 0.66, { color: SC.titleColor, font, weight: 700, spacing: 0.14 });
    P.textOn('747-8 INTERCONTINENTAL', 14, 1.3, 'both', 0.3, { color: SC.titleColor, font: K.FONT.sans, weight: 700, spacing: 0.06 });
  }
  P.textOn(SC.reg, 24.5, 1.25, 'both', 0.45, { color: SC.style === 'sun' ? '#ffffff' : SC.style === 'aurora' ? '#ffffff' : SC.titleColor, font: K.FONT.sans, weight: 700 });
  // radome joint
  P.ring(D(3.0), 0, 1, { px: 1.4, depth: 0.5, dark: 0.25 });
  // --- flight-deck windows (painted glass with dark surround) on the hump ---
  for (const s of [1, -1]) {
    const m = (p) => [p[0], s > 0 ? p[1] : 1 - p[1]];
    for (const w of WIN) {
      const pts = w.map(m), path = (g) => { pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      H.stroke(path, 0, { color: '#2a2c30', rough: 0.45, metal: 0 }, { join: 'round', px: 6 });
      H.fill(pts, F.paintedGlass);
      H.groove(path, { px: 1.2, depth: 0.5, dark: 0.2 });
    }
  }
  // --- cabin windows, doors ---
  const doorsZ = [D(9.0), D(17.5), D(26.0), D(51.0), D(64.0)];
  const zs = []; for (let z = -31.6; z < 27.2; z += 0.508) if (doorsZ.every(dz => Math.abs(z - dz) > 0.85)) zs.push(z);
  const frame = SC.style === 'bands' ? '#d9dde0' : '#c2c6c9';
  P.windows(zs, 0.35, { w: 0.25, h: 0.36, r: 0.1, frame });
  const zu = []; for (let z = -29.6; z < -10.5; z += 0.52) if (Math.abs(z + 17.2) > 0.7) zu.push(z);
  H.windows(zu, 3.2, { w: 0.25, h: 0.36, r: 0.1, frame, seed: 77 });
  const door = { px: 1.3, depth: 0.6, dark: 0.35 };
  for (const dz of doorsZ) { P.doorOn(dz - 0.54, dz + 0.54, -0.95, 0.98, { ...door, handle: true }); P.windows([dz], 0.55, { w: 0.2, h: 0.24, r: 0.08, lit: 0 }); }
  H.doorOn(-17.65, -16.75, 2.55, 3.85, { ...door, handle: true });                                       // upper-deck exit
  P.doorOn(D(18.2), D(21.0), -2.55, -1.0, { ...door, side: 'R' }); P.doorOn(D(47.8), D(50.6), -2.55, -1.0, { ...door, side: 'R' }); P.doorOn(D(55.6), D(56.8), -2.3, -1.15, { ...door, side: 'R' });   // cargo doors
  // skin joints: circumferential every ~1.6 m, lap joints along the crown and above / below the windows
  for (let z = -35; z < 36; z += 1.62) P.ring(z, 0, 1, { px: 1, depth: 0.3, dark: 0.07 });
  for (let z = -33; z < 5; z += 1.62) H.ring(z, 0.2, 0.8, { px: 1, depth: 0.3, dark: 0.07 });
  for (const y of [1.25, -0.45, -1.9]) P.yLine(-34, 34, (z) => Math.min(fus.topAt(z) - 0.3, Math.max(fus.botAt(z) + 0.25, y + Math.max(0, z - 20) * 0.08)), { px: 1, depth: 0.3, dark: 0.07 });
  H.yLine(-33, 2, (z) => Math.min(hump.topAt(z) - 0.2, 3.75), { px: 1, depth: 0.3, dark: 0.07 });
  // static ports, outflow valve, APU exhaust surround, grime
  P.decalOn(D(4.6), -0.6, 'both', (g) => { g.fillStyle = '#9aa0a5'; g.beginPath(); g.ellipse(0, 0, 0.12, 0.08, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#c42a1e'; g.lineWidth = 0.014; g.strokeRect(-0.19, -0.13, 0.38, 0.26); });
  P.decalOn(33.0, 0.9, 'R', (g) => { g.fillStyle = '#2b2d30'; g.beginPath(); g.ellipse(0, 0, 0.32, 0.17, 0, 0, Math.PI * 2); g.fill(); });
  const rnd = (() => { let a = 11; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  for (let i = 0; i < 40; i++) { const z = -20 + rnd() * 50, t = rnd() < 0.5 ? rnd() * 0.06 : 1 - rnd() * 0.06; P.streak(z, t, z + 1 + rnd() * 3, t, 0.005 + rnd() * 0.01, { alpha: 0.05 + rnd() * 0.08 }); }
  P.noise({ alpha: 0.03, scale: 4, stretch: [2, 1] }); H.noise({ alpha: 0.025, scale: 4, stretch: [2, 1] });
  // --- flight-deck panels ---
  {
    const Q = A.pen(cPanel); Q.fill('all', { color: '#5d5c58', rough: 0.7, metal: 0 });
    const scr = (a, b, w, h, col) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#08090a', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(a + 0.012, b + 0.012, w - 0.024, h - 0.024), { color: col, rough: 0.15, metal: 0, emissive: col }); };
    for (const x0 of [0.12, 1.5]) { scr(x0, 0.16, 0.24, 0.24, '#0d2238'); scr(x0 + 0.27, 0.16, 0.24, 0.24, '#101a14'); }
    scr(0.94, 0.14, 0.24, 0.24, '#0f1a12'); scr(1.21, 0.14, 0.24, 0.24, '#0f1a12');
    Q.fill((g) => g.rect(0.35, 0.005, 1.7, 0.08), { color: '#3a3b3d', rough: 0.6, metal: 0 });
    for (let i = 0; i < 11; i++) Q.fill((g) => g.rect(0.42 + i * 0.145, 0.022, 0.09, 0.04), { color: '#0a0a0a', rough: 0.2, metal: 0, emissive: i % 2 ? '#3a2a08' : '#000000' });
    Q.fill((g) => g.rect(1.12, 0.44, 0.07, 0.14), { color: '#c8c8c4', rough: 0.4, metal: 0 });
  }
  {
    const Q = A.pen(cOver); Q.fill('all', { color: '#77746c', rough: 0.7, metal: 0 });
    for (let j = 0; j < 10; j++) for (let i = 0; i < 7; i++) Q.fill((g) => g.rect(0.04 + i * 0.093, 0.04 + j * 0.095, 0.07, 0.07), { color: (i + j * 2) % 5 ? '#55534e' : '#2a2a28', rough: 0.6, metal: 0, emissive: (i * 3 + j) % 7 === 0 ? '#1c1403' : undefined });
  }
}

// ---- paint: wings, tail ---------------------------------------------------------------------------------------------------------
function paintSurfaces(B, o) {
  const { SC, W, fin, stab, cWT, cWB, cSt, cFin } = o, F = K.FINISH;
  const grey = F.semigloss('#b9bec3'), dgrey = F.semigloss('#a1a6ab'), metal = { color: '#c9ccce', rough: 0.28, metal: 0.9 }, white = F.gloss('#e9ecee');
  const line = { px: 1, depth: 0.35, dark: 0.12 }, gap = { px: 1.8, depth: 0.8, dark: 0.45 };
  const at = (x, f) => { const p = W.at(x, f); return [p[0], p[2]]; };
  const Ln = (name, x) => W.lines[name].at(W.spanToU(x));
  const tipFill = F.gloss(SC.tip);
  for (const [chart, top] of [[cWT, true], [cWB, false]]) {
    const Q = B.pen(chart); Q.fill('all', top ? grey : white);
    if (top) Q.fill([at(1.6, Ln('kru', 1.6) + 0.05), at(30, Ln('kru', 30) + 0.05), at(30, Ln('spoil', 30) - 0.03), at(1.6, Ln('spoil', 1.6) - 0.03)], dgrey);
    Q.fill([at(1.4, 0), at(30.4, 0), at(30.4, 0.035), at(1.4, 0.035)], metal);
    Q.fill([[30.35, zLE(30.35) - 0.15], [34.45, zLE(34.45) - 0.4], [34.45, zTE(34.45) + 0.3], [30.35, zTE(30.35) + 0.15]], tipFill);                    // painted raked tips
    const seg = (name, xs, op) => Q.line(xs.map(x => at(x, Ln(name, x))), op);
    if (top) {
      for (const [a, b] of [[4.1, 7.15], [7.25, 10.3], [14.2, 16.55], [16.65, 19.0], [19.1, 21.4], [21.5, 23.75]]) { Q.line([at(a, Ln('flap', a)), at(a, Ln('spoil', a)), at(b, Ln('spoil', b)), at(b, Ln('flap', b))], gap); }
    } else {
      for (const [a, b] of [[3.5, 10.6], [12.3, 22.6], [24.4, 30.2]]) { Q.line([at(a, 0.005), at(a, Ln('kru', a)), at(b, Ln('kru', b)), at(b, 0.005)], gap); for (let x = a + 1.8; x < b - 0.5; x += 1.8) Q.line([at(x, 0.005), at(x, Ln('kru', x))], line); }
    }
    for (const [a, b] of [[3.45, 10.45], [14.05, 23.9]]) { seg('flap', [a, b], gap); seg('aft', [a, b], gap); Q.line([at(a, Ln('flap', a)), at(a, 1)], gap); Q.line([at(b, Ln('flap', b)), at(b, 1)], gap); }
    for (const [a, b] of [[11.35, 13.85], [24.1, 29.9]]) { Q.line([at(a, 1), at(a, Ln('flap', a)), at(b, Ln('flap', b)), at(b, 1)], gap); }
    for (const f of [0.2, 0.42]) Q.line([at(1.6, f), at(30.2, f)], line);
    for (let x = 3; x < 30; x += 1.6) Q.line([at(x, Ln('kru', x) + 0.01), at(x, Ln('spoil', x) - 0.01)], line);
    for (const f of [0.2, 0.42]) { const a = at(2, f + 0.006), b = at(30, f + 0.006); Q.rivets(a[0], a[1], b[0], b[1], 0.07, { px: 1.2, depth: 0.15, dark: 0.04 }); }
    if (top) {
      const a = at(3.4, 0.22), b = at(3.4, 0.58), c = at(9.5, 0.58);
      Q.stroke((g) => { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); }, 0.06, F.matte('#1e2022'));      // walkway outline
      for (const x of [11.5, 23.5]) { const p = at(x, 0.08); Q.text('NO STEP', p[0], p[1] + 0.9, 0.12, { color: '#7a2a24', font: K.FONT.sans }); }
    } else {
      for (let i = 0; i < 16; i++) { const x = 4 + i * 1.6, a = at(x, 0.66); Q.streak(a[0], a[1], a[0], a[1] + 1.6, 0.07, { alpha: 0.1 }); }
      const r = at(26, 0.4); Q.text(SC.reg, r[0], r[1], 1.0, { color: '#2a2e33', font: K.FONT.sans, weight: 700, rot: 90 });
    }
    Q.noise({ alpha: 0.045, scale: 3, stretch: [1, 2.5], rough: 0.04 });
  }
  {
    const Q = B.pen(cSt); Q.fill('all', grey);
    const sa = (x, f) => { const p = stab.at(x, f); return [p[0], p[2]]; };
    Q.fill([sa(1.2, 0), sa(11.1, 0), sa(11.1, 0.06), sa(1.2, 0.06)], metal);
    Q.line([sa(2.95, 1), sa(2.95, 0.7), sa(6.7, 0.7), sa(6.7, 1)], gap); Q.line([sa(6.8, 1), sa(6.8, 0.7), sa(10.8, 0.7), sa(10.8, 1)], gap);
    for (const f of [0.22, 0.46]) Q.line([sa(1.5, f), sa(11, f)], line);
    for (const x of [4, 5.5, 7, 8.5, 10]) Q.line([sa(x, 0.07), sa(x, 0.69)], line);
    Q.noise({ alpha: 0.045, scale: 3, stretch: [1, 2], rough: 0.04 });
  }
  for (const key of ['L', 'R']) {
    const Q = B.pen(cFin[key]); Q.fill('all', F.gloss(SC.tail));
    const fa = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    const c = fa(8.6, 0.45);
    if (SC.style === 'sun') {            // gold sun disc with rays
      Q.decal(c[0], c[1], (g) => {
        g.fillStyle = SC.accent; g.beginPath(); g.arc(0, 0, 1.25, 0, TAU); g.fill();
        for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; g.save(); g.rotate(a); g.beginPath(); g.moveTo(1.5, -0.16); g.lineTo(2.6, 0); g.lineTo(1.5, 0.16); g.closePath(); g.fill(); g.restore(); }
        g.fillStyle = SC.tail; g.beginPath(); g.arc(0, 0, 0.82, 0, TAU); g.fill(); g.fillStyle = SC.accent; g.beginPath(); g.arc(0, 0, 0.55, 0, TAU); g.fill();
      });
    } else if (SC.style === 'aurora') {  // aurora ribbons
      Q.decal(c[0], c[1], (g) => {
        const rib = (dy, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(-2.6, 2.2 + dy); g.bezierCurveTo(-1.2, 0.6 + dy, 0.2, 2.0 + dy, 1.0, 0.2 + dy); g.bezierCurveTo(1.5, -0.9 + dy, 2.0, -1.6 + dy, 2.8, -2.6 + dy); g.stroke(); };
        rib(0, 0.55, SC.accent); rib(0.85, 0.32, SC.cheat); rib(1.5, 0.14, '#ffffff');
      });
      Q.text('N', c[0] - 0.4, c[1] + 2.6, 1.2, { color: '#ffffff', font: K.FONT.wide, weight: 700 });
    } else {
      Q.fill([fa(2.2, 0), fa(5.0, 0), fa(5.0, 1), fa(2.2, 1)], F.gloss(SC.cheat));
      Q.fill([fa(5.0, 0), fa(5.4, 0), fa(5.4, 1), fa(5.0, 1)], F.gloss(SC.accent));
      Q.text('747', c[0], c[1], 1.7, { color: SC.cheat, font: K.FONT.wide, weight: 700 });
    }
    Q.text(SC.reg, fa(4.2, 0.62)[0], fa(4.2, 0.62)[1], 0.36, { color: SC.style === 'bands' ? SC.titleColor : '#ffffff', font: K.FONT.sans, weight: 700 });
    Q.fill([fa(2.6, 0), fa(14.1, 0), fa(14.1, 0.03), fa(2.6, 0.03)], metal);
    const fg = { px: 1.6, depth: 0.5, dark: 0.3 };
    Q.line([fa(3.55, 1), fa(3.55, 0.7), fa(8.65, 0.7), fa(8.65, 1)], fg); Q.line([fa(8.75, 1), fa(8.75, 0.7), fa(13.85, 0.7), fa(13.85, 1)], fg);
    const fl = { px: 1, depth: 0.18, dark: 0.07 };
    for (const y of [5.2, 7.0, 10.5, 12.2]) Q.line([fa(y, 0.7), fa(y, 1)], fl);
    for (const f of [0.22, 0.46]) Q.line([fa(2.8, f), fa(13.9, f)], fl);
    Q.noise({ alpha: 0.03, scale: 3 });
  }
}
