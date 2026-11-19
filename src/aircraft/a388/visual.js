// Airbus A380-800 — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (-5.7) when parked.
//
// Reference numbers (docs/aircraft/a388.md; d = distance aft of the nose tip, z = d - 37.5):
//   length 72.72 m (nose z -37.5 … APU exhaust z 35.22), span 79.75 m over the tip fences, height 24.09 m (fin tip y 18.39).
//   Fuselage: full-length double deck, an ovoid 7.14 m wide × 8.5 m tall (crown y 4.3, keel y -4.2, widest at y -0.2; the
//   upper deck lobe is visibly narrower than the main deck). Blunt nose on y -1.0, the flight deck set between the decks:
//   windshield bottom d 3.55 (y 1.80), top d 5.0 (y 2.65), with the upper-deck "forehead" rising behind it to the crown at
//   d ≈ 13. Constant section d 15 … 50, aft taper from d 54, upswept tail cone ending in the APU exhaust (y 0.6).
//   Windows: main deck y -0.85, upper deck y 2.3; doors M1–M5 at d 8.5 / 18.5 / 33 / 52 / 62, U1–U3 at d 12 / 36 / 58.
//   Wing (right): root LE z -11.5 at x 3.6 (chord 17.5), Yehudi kink x 14.5 (LE z -3.9, chord 11.8), tip x 39.88 (LE z 12.4,
//   chord 4.0); LE sweep 35° / 33°; two trailing-edge kinks (x 11.5, x 25); dihedral 8° inboard, 7° outboard from the root
//   chord line at y -2.6 (tip y 2.05); supercritical section 15 % → 8 %. Wingtip fences: arrow-shaped plates 2.3 m above
//   and 1.4 m below the tip, starting ahead of the tip leading edge.
//   Leading edge: droop nose x 4.4–11.8, slats x 13.6–39.3. Trailing edge: three single-slotted flaps (x 4.3–29.4) with
//   big flap-track fairings, three ailerons (x 29.6–39.4), eight spoilers (x 5–28.8).
//   Engines (Trent 900 class): fan Ø 2.95 m, nacelle Ø 3.56 m, fan cowl 4.7 m + core 2.2 m; inlet at x ±12.7 (y -3.2,
//   z -9.3) and x ±25.2 (y -2.6, z 1.0) on short, thick pylons. Translating reverser sleeves on the inboard pair only.
//   Tail: stabiliser span 30.4 m, root chord 11.6 (LE z 20.2 at x 0.8), tip chord 3.5, LE sweep 38°, dihedral 6°, two
//   elevators a side. Fin LE root z 14.5 at the crown, chord 18 → 5.5 at y 18.39, LE sweep 42°, two-segment rudder.
//   Gear (geometry.js, unchanged): nose twin r 0.55 at z -28.4 (retracts forward); wing gear x ±6.25 z 0.8 (four-wheel
//   bogies, retract inward into the belly fairing); body gear x ±2.65 z 4.9 (six-wheel bogies, retract forward). 22 wheels.
// The airline liveries are invented for this simulator: they do not reproduce any real operator's name or marks.
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
export const LIVERIES = ['orivane', 'selvara', 'house'];

const SCHEMES = {
  orivane: { name: 'Orivane', title: 'ORIVANE', reg: 'ZZ-ORV', body: '#f5f6f7', belly: '#c9ced3', cheat: '#2b2f86', accent: '#c9a227', tail: '#2b2f86', engine: '#f3f4f5', lipBand: '#2b2f86', tip: '#2b2f86', titleColor: '#2b2f86', font: 'serif', style: 'cheat' },
  selvara: { name: 'Selvara', title: 'Selvara', reg: 'ZZ-SVR', body: '#f6f7f6', belly: '#0f4c4a', cheat: '#e8604c', accent: '#e8604c', tail: '#0f4c4a', engine: '#0f4c4a', lipBand: '#e8604c', tip: '#e8604c', titleColor: '#0f4c4a', font: 'round', style: 'sweep' },
  house: { name: 'Skyward house colours', title: 'SKYWARD', reg: 'ZZ-SKA', body: '#f1f2f3', belly: '#99a1a8', cheat: '#2a64c5', accent: '#1b2a3c', tail: '#f1f2f3', engine: '#f1f2f3', lipBand: '#2a64c5', tip: '#2a64c5', titleColor: '#1b2a3c', font: 'wide', style: 'house' },
};

const NZ = -37.5;
const D = (d) => d + NZ;

// ---- fuselage station tables ------------------------------------------------------------------------------------------------
//  d (from the nose)  y of the crown  y of the keel  half-width  y of the widest point
const NOSE = [
  [0.00, -1.00, -1.00, 0.00, -1.00], [0.15, -0.60, -1.40, 0.42, -1.00], [0.45, -0.20, -1.78, 0.78, -0.99], [1.00, 0.28, -2.22, 1.20, -0.97],
  [1.80, 0.85, -2.72, 1.70, -0.94], [2.70, 1.38, -3.15, 2.18, -0.89], [3.60, 1.85, -3.48, 2.58, -0.82], [4.40, 2.30, -3.72, 2.88, -0.74],
  [5.20, 2.80, -3.88, 3.10, -0.65], [6.20, 3.28, -4.00, 3.28, -0.55], [7.40, 3.68, -4.08, 3.42, -0.45], [9.00, 3.99, -4.14, 3.52, -0.35],
  [11.0, 4.18, -4.18, 3.56, -0.27], [13.5, 4.28, -4.20, 3.57, -0.22], [15.5, 4.30, -4.20, 3.57, -0.20],
];
//  z      crown   keel   half-width  widest
const TAIL = [
  [12.5, 4.30, -4.20, 3.57, -0.20], [16.5, 4.27, -4.08, 3.55, -0.14], [20.5, 4.17, -3.74, 3.44, -0.02], [24.5, 3.97, -3.14, 3.08, 0.18],
  [28.5, 3.60, -2.38, 2.45, 0.40], [31.8, 3.08, -1.60, 1.70, 0.55], [34.2, 2.40, -1.02, 0.92, 0.62], [35.22, 1.95, -0.78, 0.42, 0.58],
];

// ---- wing planform (right wing) ---------------------------------------------------------------------------------------------
const XR = 3.6, XK = 14.5, XT = 39.88;
const zLE = (x) => (x <= XK ? -11.5 + 0.6972 * (x - XR) : -3.9 + 0.6422 * (x - XK));
const zTE = (x) => (x <= 11.5 ? 6.0 + 0.1013 * (x - XR) : x <= 25 ? 6.8 + 0.3704 * (x - 11.5) : 11.8 + 0.3091 * (x - 25));
const wy = (x) => (x <= XK ? -2.6 + 0.1405 * (x - XR) : -1.069 + 0.1228 * (x - XK));
const FLAPS = [[4.3, 11.3], [11.5, 20.6], [20.8, 29.4]];
const AILS = [[29.6, 32.9], [33.0, 36.3], [36.4, 39.4]];
const SPOILERS = [[5.0, 7.6], [7.7, 10.3], [10.4, 13.0], [13.1, 15.6], [15.7, 18.6], [18.7, 21.8], [21.9, 25.3], [25.4, 28.8]];
const SLATS = [13.6, 17.9, 22.2, 26.6, 30.9, 35.1, 39.3];
const CANOES = [7.6, 17.0, 21.1, 29.0];

// engine inlet-plane centres (geometry.js engines[].intake, order = state.engines order: inboard L, outboard L, inboard R, outboard R)
const NAC = { len: 4.7, rHi: 1.6, rMax: 1.78, rThroat: 1.5, rFan: 1.475, zFan: 0.95, rExit: 1.5, sleeve: 0.55, core: { r0: 1.05, r1: 0.62, length: 2.2 }, plug: { r: 0.42, length: 1.15 } };

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
const morphed = (mesh, line, ref, toward, ang) => rotateMorph(mesh.clone().enableMorph(), line.a, line.b, ref, toward, ang);

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'orivane', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const rig = K.createRig(ctx, { geometry: G, name: 'a388', glassLayer: opts.glassLayer, cockpitRadius: 1.6 });

  // ---- atlases: A = fuselage + flight deck + gear, B = wings, tail, nacelles --------------------------------------------------
  const A = K.createAtlas({ size: atlasSize, base: F.gloss(SC.body) });
  const cFus = A.chart('fus', { type: 'unwrap', z: [G.noseZ - 0.05, G.tailZ + 0.03], girth: 25.0, vScale: 0.8, strips: 4 });
  const cPanel = A.chart('panel', { type: 'rect', w: 2.4, h: 0.6, density: 1.8 });
  const cOver = A.chart('overhead', { type: 'rect', w: 0.8, h: 1.0, density: 1.4 });
  const cPed = A.chart('pedestal', { type: 'rect', w: 0.4, h: 0.9, density: 1.4 });
  A.pack();
  const UA = {
    body: A.swatch('body', F.gloss(SC.body)), fair: A.swatch('fair', F.gloss(SC.belly)), dark: A.swatch('dark', F.darkGrey), black: A.swatch('black', F.black),
    well: A.swatch('well', { color: '#7b8079', rough: 0.7, metal: 0 }), liner: A.swatch('liner', { color: '#b4bac0', rough: 0.8, metal: 0 }), post: A.swatch('post', { color: '#7d858c', rough: 0.7, metal: 0 }),
    floor: A.swatch('floor', { color: '#383b40', rough: 0.9, metal: 0 }), shield: A.swatch('shield', { color: '#2a2d31', rough: 0.85, metal: 0 }), console: A.swatch('console', { color: '#5f666d', rough: 0.75, metal: 0 }),
    seat: A.swatch('seat', { color: '#4c5157', rough: 0.9, metal: 0 }), cushion: A.swatch('cushion', { color: '#3b4658', rough: 1, metal: 0 }), stick: A.swatch('stick', { color: '#17181a', rough: 0.5, metal: 0 }),
    exhaust: A.swatch('exhaust', F.exhaust), steel: A.swatch('steel', F.steel), antenna: A.swatch('antenna', F.gloss('#e9eaea')),
    strut: A.swatch('gear.strut', F.gearWhite), chrome: A.swatch('gear.chrome', F.chrome), tyre: A.swatch('gear.tyre', F.rubber), hub: A.swatch('gear.hub', { color: '#c4c6c2', rough: 0.4, metal: 0.35 }),
    link: A.swatch('gear.link', F.anodised),
  };
  const B = K.createAtlas({ size: atlasSize, base: F.semigloss('#babfc4') });
  const cWT = { i: B.chart('wingTopIn', { type: 'plan', x: [0.9, 14.8], z: [-13.6, 8.4], view: 'top', mirror: true }), o: B.chart('wingTopOut', { type: 'plan', x: [14.2, 40.1], z: [-4.6, 16.8], view: 'top', mirror: true }) };
  const cWB = { i: B.chart('wingBotIn', { type: 'plan', x: [0.9, 14.8], z: [-13.6, 8.4], view: 'bottom', mirror: true, density: 0.7 }), o: B.chart('wingBotOut', { type: 'plan', x: [14.2, 40.1], z: [-4.6, 16.8], view: 'bottom', mirror: true, density: 0.7 }) };
  const cSt = B.chart('stab', { type: 'plan', x: [0.5, 15.6], z: [19.8, 35.5], view: 'top', mirror: true, density: 0.8 });
  const cFin = { L: B.chart('finL', { type: 'side', z: [12.6, 34.0], y: [2.4, 18.6], view: 'left', density: 0.95 }), R: B.chart('finR', { type: 'side', z: [12.6, 34.0], y: [2.4, 18.6], view: 'right', density: 0.95 }) };
  B.pack();
  const UB = {
    grey: B.swatch('grey', F.semigloss('#babfc4')), engine: B.swatch('engine', F.gloss(SC.engine)), lip: B.swatch('lip', F.polished), band: B.swatch('band', F.gloss(SC.lipBand)),
    duct: B.swatch('duct', { color: '#1a1b1e', rough: 0.6, metal: 0.2 }), acoustic: B.swatch('acoustic', { color: '#7d8185', rough: 0.6, metal: 0.55 }), core: B.swatch('core', F.semigloss('#c5c9cc')),
    coreMetal: B.swatch('coreMetal', F.titanium), plug: B.swatch('plug', F.heatStained), blade: B.swatch('blade', { color: '#4d525a', rough: 0.3, metal: 0.75 }),
    spinner: B.swatch('spinner', { color: '#d0d2d4', rough: 0.3, metal: 0.6 }), inner: B.swatch('inner', F.primer), pylon: B.swatch('pylon', F.gloss(SC.style === 'sweep' ? '#eceeef' : SC.body)),
    tail: B.swatch('tail', F.gloss(SC.tail)), tip: B.swatch('tip', F.gloss(SC.tip)), cascade: B.swatch('cascade', { color: '#3a3c3f', rough: 0.6, metal: 0.7 }), wick: B.swatch('wick', F.black),
    canoe: B.swatch('canoe', F.semigloss('#c2c7cb')),
  };

  // ---- fuselage ---------------------------------------------------------------------------------------------------------------
  const st = (z, top, bot, w, yc, extra) => ({ z, y: yc, w, top: Math.max(0, top - yc), bot: Math.max(0, yc - bot), ...extra });
  const FS = [
    ...NOSE.map(([d, top, bot, w, yc]) => st(D(d), top, bot, w, yc, d > 4 ? { kTop: [0.56, 0.52], kBot: [0.6, 0.58] } : { kBot: [0.58, 0.56] })),
    ...TAIL.map(([z, top, bot, w, yc]) => st(z, top, bot, w, yc, z > 30 ? { kTop: 0.58, kBot: 0.6 } : { kTop: [0.56, 0.52], kBot: [0.6, 0.58] })),
  ];
  const fseg = Math.max(40, Math.round(100 * detail / 4) * 4);
  const fus = K.loft({
    stations: FS, segments: fseg, step: 1.4 / detail, chart: cFus, capEnd: 'flat', capUV: UA.exhaust,
    cutouts: [{ name: 'ngw', z: [-30.9, -27.3], t: [0, 0.035], mirror: true }],
  });
  cFus.body = fus;
  const stA = new K.Mesh(), stB = new K.Mesh();
  stA.add(fus.mesh);
  stA.add(K.well(K.merge(fus.patches.ngwR, fus.patches.ngwL), 1.2, UA.well, [0, 1, 0]));
  const tAtX = (z, x) => { let lo = 0.25, hi = 0.5; for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (fus.at(z, m).p[0] > x) lo = m; else hi = m; } return (lo + hi) / 2; };
  // APU exhaust in the tail cone
  stA.add(K.lathe([[0.22, G.tailZ - 0.3], [0.25, G.tailZ + 0.05, 1], [0.2, G.tailZ + 0.05, 1], [0.17, G.tailZ - 0.35]], { segments: 18, uv: UA.exhaust }).translate(0, 0.58, 0));

  // wing-to-body ("belly") fairing, long and deep, with the wing- and body-gear bays cut into its flat bottom
  const fairStations = [[-14.8, 1.2, 0.35, 0.55], [-13.0, 2.4, 0.8, 1.0], [-10.5, 3.4, 1.2, 1.2], [-7.5, 4.0, 1.45, 1.3], [-3.0, 4.3, 1.55, 1.33], [3.0, 4.35, 1.55, 1.33],
    [7.5, 4.15, 1.4, 1.3], [10.5, 3.6, 1.1, 1.22], [13.0, 2.6, 0.7, 1.0], [15.0, 1.3, 0.3, 0.55]]
    .map(r => ({ z: r[0], y: -2.95, w: r[1], top: r[2], bot: r[3], kTop: 0.7, kBot: [0.95, 0.5523] }));
  const fairOpts = { stations: fairStations, segments: Math.max(32, Math.round(52 * detail / 4) * 4), step: 0.9, uv: UA.fair };
  let fair = K.loft(fairOpts);
  const fAtX = (z, x) => { let lo = 0, hi = 0.25; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (fair.at(z, m).p[0] < x) lo = m; else hi = m; } return (lo + hi) / 2; };
  fair = K.loft({ ...fairOpts, cutouts: [{ name: 'wgw', z: [-1.0, 2.1], t: [fAtX(0.5, 2.85), fAtX(0.5, 4.1)], mirror: true }, { name: 'bgw', z: [2.2, 7.5], t: [fAtX(5, 1.5), fAtX(5, 3.75)], mirror: true }] });
  stA.add(fair.mesh);
  for (const k of ['wgwR', 'wgwL', 'bgwR', 'bgwL']) stA.add(K.well(fair.patches[k], 1.4, UA.well, [0, 1, 0]));

  // ---- flight deck: six painted windows, lined inside so the pilot looks out through the gaps -------------------------------
  const zd = D, zy = (d, y) => [zd(d), fus.tAtY(zd(d), y)], zx = (d, x) => [zd(d), tAtX(zd(d), x)];
  const WS = { IB: zx(3.55, 0.08), OB: zy(3.95, 1.80), OT: zy(5.25, 2.62), IT: zx(4.96, 0.08) };
  const S1 = { bf: zy(4.08, 1.80), br: zy(5.75, 1.83), tr: zy(5.75, 2.55), tf: zy(5.36, 2.57) };
  const S2 = { bf: zy(5.86, 1.84), br: zy(6.75, 1.87), rt: zy(6.75, 2.28), nt: zy(6.52, 2.5), tf: zy(5.86, 2.55) };
  const WIN = [[WS.IB, WS.OB, WS.OT, WS.IT], [S1.bf, S1.br, S1.tr, S1.tf], [S2.bf, S2.br, S2.rt, S2.nt, S2.tf]];
  const FLOOR = 1.05, zb = zd(7.6), eye = G.pilotEye;
  {
    const L = (c, uv, nu = 3, nv = 3) => stA.add(K.liner(fus, c, { uv, nu, nv, mirror: true, inset: 0.05 }));
    const lo = (z) => [z, fus.tAtY(z, FLOOR + 0.04)], hi = (z) => [z, 0.5];
    L([WS.IB, WS.OB, lo(WS.OB[0]), lo(WS.IB[0])], UA.liner, 2, 5);
    L([WS.IB, hi(WS.IB[0]), hi(WS.IT[0]), WS.IT], UA.post, 4, 1);
    L([hi(WS.IT[0]), WS.IT, WS.OT, hi(WS.OT[0])], UA.liner, 3, 2);
    L([WS.OB, S1.bf, S1.tf, WS.OT], UA.post, 1, 4);
    L([WS.OT, S1.tf, hi(S1.tf[0]), hi(WS.OT[0])], UA.liner, 1, 3);
    L([lo(WS.OB[0]), lo(S1.bf[0]), S1.bf, WS.OB], UA.liner, 1, 3);
    L([lo(S1.bf[0]), lo(S1.br[0]), S1.br, S1.bf], UA.liner, 4, 3);
    L([S1.tf, S1.tr, hi(S1.tr[0]), hi(S1.tf[0])], UA.liner, 3, 3);
    L([S1.br, S2.bf, S2.tf, S1.tr], UA.post, 1, 4);
    L([lo(S1.br[0]), lo(S2.bf[0]), S2.bf, S1.br], UA.liner, 1, 3);
    L([S1.tr, S2.tf, hi(S2.tf[0]), hi(S1.tr[0])], UA.liner, 1, 3);
    L([lo(S2.bf[0]), lo(S2.br[0]), S2.br, S2.bf], UA.liner, 3, 3);
    L([S2.tf, S2.nt, hi(S2.nt[0]), hi(S2.tf[0])], UA.liner, 2, 3);
    L([S2.nt, S2.rt, hi(S2.br[0]), hi(S2.nt[0])], UA.liner, 2, 3);
    L([lo(S2.br[0]), lo(zb), hi(zb), hi(S2.br[0])], UA.liner, 3, 6);
    const fy = FLOOR, zP = zd(4.05);
    stA.add(K.deck(fus, WS.IB[0] - 0.02, zb, fy, { uv: UA.floor, n: 8 }));
    stA.add(K.bulkhead(fus, zb, { uv: UA.liner, facing: -1 }));
    stA.add(K.bulkhead(fus, WS.IB[0] - 0.02, { uv: UA.shield, facing: 1 }));
    { const y0 = fy + 0.62, gs = K.prism([[zP - 0.5, y0 + 0.08], [zP - 0.02, y0 + 0.12], [zP + 0.02, y0 + 0.08], [zP - 0.02, y0 - 0.02], [zP - 0.5, y0 - 0.02]], -1.2, 1.2, UA.shield); for (let i = 0; i < gs.p.length; i += 3) gs.p[i] *= 0.62 + 0.38 * (gs.p[i + 2] - (zP - 0.5)) / 0.52; stA.add(gs); }
    { const i0 = stA.vertexCount; for (const [a, b] of [[0, 0.6], [2.4, 0.6], [2.4, 0], [0, 0]]) { const uv = cPanel.uv(a, b); stA.vert(a - 1.2, fy + 0.04 + (0.6 - b), zP + 0.01 + (0.6 - b) * 0.12, 0, 0.18, 1, uv[0], uv[1]); } stA.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    stA.add(K.box(2.4, 0.6, 0.12, UA.shield).translate(0, fy + 0.34, zP - 0.1));
    {
      stA.add(K.box(0.4, 0.45, 1.0, UA.console).translate(0, fy + 0.22, zP + 0.62));
      const i0 = stA.vertexCount; for (const [a, b] of [[0, 0], [0.4, 0], [0.4, 0.9], [0, 0.9]]) { const uv = cPed.uv(a, b); stA.vert(a - 0.2, fy + 0.45 + (0.9 - b) * 0.12, zP + 0.1 + b * 1.0, 0, 1, 0.1, uv[0], uv[1]); } stA.quad(i0, i0 + 3, i0 + 2, i0 + 1);
      for (const sx of [-1, 1]) stA.add(K.box(0.035, 0.12, 0.05, UA.stick).rotateX(-0.35).translate(sx * 0.06, fy + 0.62, zP + 0.35));
    }
    { const i0 = stA.vertexCount, y = eye[1] + 0.32; for (const [a, b] of [[0, 0], [0.8, 0], [0.8, 1.0], [0, 1.0]]) { const uv = cOver.uv(a, b); stA.vert(a - 0.4, y + b * 0.18, zP + 0.45 + b, 0, -1, -0.2, uv[0], uv[1]); } stA.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    for (const sx of [-1, 1]) {
      const e = [sx * Math.abs(eye[0]), eye[1], eye[2]];
      stA.add(K.crewSeat({ eye: e, uv: { frame: UA.seat, cushion: UA.cushion } }));
      stA.add(K.box(0.3, 0.42, 1.1, UA.console).translate(sx * 1.15, fy + 0.21, e[2] - 0.15));
      stA.add(K.box(0.2, 0.05, 0.5, UA.shield).translate(sx * 1.12, fy + 0.44, e[2] - 0.3));
      stA.add(K.stick({ base: [sx * 1.12, fy + 0.47, e[2] - 0.42], height: 0.17, uv: UA.stick }));
      stA.add(K.box(0.2, 0.03, 0.3, UA.shield).translate(e[0], fy + 0.05, zP + 0.12));
    }
  }

  // ---- wings ----------------------------------------------------------------------------------------------------------------
  const wst = (x, tc, twist) => ({ x, y: wy(x), z: zLE(x), chord: zTE(x) - zLE(x), tc, twist });
  const sc = K.supercritical();
  const wingOf = (side) => K.wing({
    side, airfoil: sc, chordPts: Math.round(16 * Math.min(1, detail)), spanAxis: 'x', tip: 'flat',
    stations: [wst(1.0, 0.15, 2.0), wst(XR, 0.15, 2.0), wst(8.0, 0.135, 1.2), wst(11.5, 0.122, 0.6), wst(XK, 0.112, 0.2), wst(25, 0.097, -1.5), wst(35, 0.087, -3.0), wst(XT, 0.082, -3.5)],
    lines: {
      slat: [[1.0, 0.1], [XK, 0.12], [XT, 0.14]], spoil: [[1.0, 0.6], [XK, 0.62], [25, 0.64], [XT, 0.66]],
      flap: [[1.0, 0.71], [11.5, 0.71], [25, 0.73], [XT, 0.75]],
    },
    controls: [
      ...FLAPS.map((s, i) => ({ name: 'flap' + i, type: 'flap', span: s, from: 'flap', nose: 1 })),
      ...AILS.map((s, i) => ({ name: 'ail' + i, type: 'flap', span: s, from: 'flap', nose: 1 })),
      { name: 'droop', type: 'flap', span: [4.4, 11.8], to: 'slat', tail: 0.4, hingeDepth: 0.85 },
      { name: 'slat', type: 'flap', span: [SLATS[0], SLATS[SLATS.length - 1]], to: 'slat', tail: 0.4, cove: true },
      ...SPOILERS.map((s, i) => ({ name: 'sp' + i, type: 'panel', surface: 'upper', span: s, from: 'spoil', to: 'flap', hinge: 'front' })),
    ],
    charts: [{ from: 0, upper: cWT.i, lower: cWB.i }, { from: XK, upper: cWT.o, lower: cWB.o }], innerUV: UB.inner, edgeUV: UB.grey,
  });
  const W = { R: wingOf(1), L: wingOf(-1) };
  stB.add(W.R.mesh).add(W.L.mesh);
  // wingtip fences: arrow-shaped plates above and below the tip, starting ahead of the tip leading edge
  const tipY = wy(XT), tipZ = zLE(XT);
  for (const side of [1, -1]) {
    const up = K.wing({ airfoil: K.naca4('0007'), chordPts: 6, spanAxis: 'y', tip: 'flat', uv: UB.tip, edgeUV: UB.tip,
      stations: [{ x: XT + 0.02, y: tipY - 0.05, z: tipZ - 0.9, chord: 4.9, tc: 0.07 }, { x: XT + 0.12, y: tipY + 2.3, z: tipZ + 2.55, chord: 0.75, tc: 0.06 }] }).mesh;
    const dn = K.wing({ airfoil: K.naca4('0007'), chordPts: 6, spanAxis: 'y', tip: 'flat', uv: UB.tip, edgeUV: UB.tip,
      stations: [{ x: XT + 0.02, y: 0.05, z: tipZ - 0.9, chord: 3.3, tc: 0.07 }, { x: XT + 0.1, y: 1.4, z: tipZ + 1.5, chord: 0.6, tc: 0.06 }] }).mesh;
    dn.scale(1, -1, 1).translate(0, tipY, 0);
    if (side < 0) { stB.add(up.mirrorX()).add(dn.mirrorX()); } else stB.add(up).add(dn);
  }
  // flap-track fairings ("canoes"): front part fixed under the wing, rear part rides on the flap
  const canoeAt = (x, len, side, h) => {
    const zf = W.R.at(x, 0.71, 'lower'), z0 = zf[2] - len * 0.45, y = zf[1] - 0.06;
    const s = [[0, 0.01, 0.01], [0.12, 0.17, 0.22], [0.35, 0.26, 0.42], [0.6, 0.26, 0.45], [0.85, 0.17, 0.3], [1, 0.015, 0.03]].map(r => ({ z: z0 + r[0] * len, x: side * x, y: y - r[2] * h * 0.5 + (r[0] > 0.6 ? (r[0] - 0.6) * 0.4 : 0), w: r[1], top: r[2] * h * 0.6, bot: r[2] * h }));
    const split = zf[2] + 0.2;
    return { front: K.loft({ stations: s, segments: 12, step: 0.5, uv: UB.canoe, zRange: [z0, split] }).mesh, rear: K.loft({ stations: s, segments: 12, step: 0.5, uv: UB.canoe, zRange: [split, z0 + len], capStart: 'flat' }).mesh };
  };

  // ---- tail -------------------------------------------------------------------------------------------------------------------
  const sy = (x) => 0.6 + (x - 2.5) * Math.tan(6 * DEG), zLEs = (x) => 21.5 + (x - 2.5) * Math.tan(38 * DEG);
  const stabOf = (side) => K.wing({
    side, airfoil: K.naca4('0011'), chordPts: Math.round(12 * Math.min(1, detail)), spanAxis: 'x', tip: 'round', tipLength: 0.5,
    stations: [{ x: 0.8, y: sy(0.8), z: zLEs(0.8), chord: 11.6, tc: 0.11 }, { x: 15.2, y: sy(15.2), z: zLEs(15.2), chord: 3.5, tc: 0.09 }],
    lines: { hinge: [[0.8, 0.71], [15.2, 0.71]] },
    controls: [{ name: 'elevIn', type: 'flap', span: [3.2, 8.9], from: 'hinge', nose: 1 }, { name: 'elevOut', type: 'flap', span: [9.0, 14.9], from: 'hinge', nose: 1 }],
    charts: { upper: cSt, lower: cSt }, edgeUV: UB.grey,
  });
  const stab = { R: stabOf(1), L: stabOf(-1) };
  stB.add(stab.R.mesh).add(stab.L.mesh);
  const FIN_TOP = G.height - G.cgHeight, finLE = (y) => 14.5 + (y - 4.25) * 0.9;
  const fin = K.wing({
    airfoil: K.naca4('0011'), chordPts: Math.round(13 * Math.min(1, detail)), spanAxis: 'y', tip: 'round', tipLength: 0.4,
    stations: [{ x: 0, y: 2.6, z: finLE(2.6), chord: 18.0, tc: 0.11 }, { x: 0, y: FIN_TOP, z: finLE(FIN_TOP), chord: 5.5, tc: 0.09 }],
    lines: { hinge: [[2.6, 0.7], [FIN_TOP, 0.7]] },
    controls: [{ name: 'rudLo', type: 'flap', span: [4.6, 11.0], from: 'hinge', nose: 1 }, { name: 'rudUp', type: 'flap', span: [11.1, FIN_TOP - 0.35], from: 'hinge', nose: 1 }],
    charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.tail,
  });
  stB.add(fin.mesh);
  stB.add(K.wing({ airfoil: K.naca4('0008'), chordPts: 6, spanAxis: 'y', tip: 'flat', charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.tail,       // dorsal fillet
    stations: [{ x: 0, y: 3.9, z: 10.5, chord: 6.0, tc: 0.03 }, { x: 0, y: 5.3, z: finLE(5.3) - 0.2, chord: 2.6, tc: 0.07 }] }).mesh);

  // ---- engines ----------------------------------------------------------------------------------------------------------------
  const eng = [], sleeveAll = new K.Mesh();
  let sleeveTravel = 0;
  G.engines.forEach((ge, i) => {
    const c = ge.intake, inboard = Math.abs(c[0]) < 20, sx = Math.sign(c[0]);
    const n = K.nacelle({ centre: c, length: NAC.len, rHi: NAC.rHi, rMax: NAC.rMax, rThroat: NAC.rThroat, rFan: NAC.rFan, zFan: NAC.zFan, rExit: NAC.rExit, flat: 0, droop: 0.04, sleeve: NAC.sleeve,
      core: NAC.core, plug: NAC.plug, segments: Math.max(32, Math.round(52 * detail / 4) * 4),
      uv: UB.engine, uvLip: UB.lip, uvInner: UB.acoustic, uvSleeve: UB.engine, uvCore: UB.core, uvPlug: UB.plug, uvCascade: UB.cascade });
    stB.add(n.cowl).add(n.core).add(n.plug);
    if (inboard) { stB.add(n.cascade); const sl = n.sleeve.clone().enableMorph(); for (let k = 2; k < sl.p2.length; k += 3) sl.p2[k] += n.sleeveTravel; sleeveAll.add(sl); sleeveTravel = n.sleeveTravel; }
    else stB.add(n.sleeve);
    // coloured intake band behind the polished lip
    { const L = NAC.len, rA = (z) => NAC.rHi + (NAC.rMax - NAC.rHi) * Math.sqrt(Math.min(1, z / (L * 0.3))) + 0.006;
      stB.add(K.lathe([[rA(0.2) - 0.006, 0.2], [rA(0.21), 0.21], [rA(0.62), 0.62], [rA(0.63) - 0.006, 0.63]], { segments: 52, uv: UB.band }).translate(c[0], c[1], c[2])); }
    { const z1 = NAC.len + NAC.core.length; stB.add(K.lathe([[NAC.core.r1 + 0.07, z1 - 0.6], [NAC.core.r1 + 0.03, z1 + 0.01, 1], [NAC.core.r1, z1 + 0.01, 1]], { segments: 36, uv: UB.coreMetal }).translate(c[0], c[1], c[2])); }
    stB.add(K.fanBackdrop(NAC.rFan, 0.5, UB.duct).translate(c[0], c[1], n.fanZ));
    // short, thick pylon: strut over the nacelle into the wing, aft fairing under the wing
    const x = Math.abs(c[0]), yw = wy(x), zl = zLE(x);
    stB.add(K.pylon([{ y: c[1] + NAC.rMax - 0.12, z0: c[2] + 0.9, z1: c[2] + NAC.len + 1.6, x: c[0], tc: 0.13 }, { y: yw - 0.2, z0: Math.min(zl - 0.3, c[2] + 1.6), z1: zl + 4.6, x: c[0], tc: 0.1 }, { y: yw + 0.4, z0: zl + 0.3, z1: zl + 5.6, x: c[0], tc: 0.08 }], { uv: UB.pylon }));
    { const z0 = c[2] + NAC.len + 0.8, len = 6.2, yb = wy(x) - 0.75;
      const s = [[0, 0.02, 0.02], [0.15, 0.36, 0.32], [0.5, 0.42, 0.5], [0.85, 0.26, 0.34], [1, 0.02, 0.04]].map(r => ({ z: z0 + r[0] * len, x: c[0], y: yb + r[0] * 0.45, w: r[1], top: 0.7, bot: r[2] }));
      stB.add(K.loft({ stations: s, segments: 14, step: 0.6, uv: UB.pylon }).mesh); }
    stB.add(K.plate([c[0] - sx * 1.56, c[1] + 0.9, c[2] + 1.1], [c[0] - sx * 1.56, c[1] + 0.9, c[2] + 2.4], [c[0] - sx * 1.86, c[1] + 1.08, c[2] + 2.45], [c[0] - sx * 1.82, c[1] + 1.05, c[2] + 1.3], 0.015, UB.engine));   // inboard nacelle strake
    eng.push({ c, n, fanMesh: K.fan({ radius: NAC.rFan - 0.012, hub: 0.46, blades: 24, chord: 0.5, staggerRoot: 30, staggerTip: 62, sweep: 0.2, uvBlade: UB.blade, uvSpinner: UB.spinner }) });
  });

  // ---- small details ----------------------------------------------------------------------------------------------------------
  for (const [z, h] of [[-24.0, 0.38], [-4.0, 0.38], [9.0, 0.36]]) stA.add(K.bladeAntenna({ pos: [0, fus.topAt(z) - 0.02, z], height: h, chord: 0.5, sweep: 0.22, uv: UA.antenna }));
  stA.add(K.ellipsoid(0.7, 0.2, 1.7, { segments: 14, rings: 6, uv: UA.antenna }).translate(0, fus.topAt(-13) - 0.04, -13));      // satcom fairing
  for (const z of [-20.0, 17.0]) stA.add(K.bladeAntenna({ pos: [0, fus.botAt(z) + 0.02, z], height: 0.32, chord: 0.45, sweep: 0.2, down: true, uv: UA.antenna }));
  for (const sx of [-1, 1]) for (const [d, y] of [[2.6, -0.4], [3.0, -0.9], [3.3, 0.1]]) {        // pitot / AoA probes
    const z = zd(d), t = fus.tAtY(z, y), p = fus.at(z, sx > 0 ? t : 1 - t).p; stA.add(K.probe(p, [p[0] + sx * 0.16, p[1] - 0.01, p[2] - 0.24], 0.018, UA.steel));
  }
  { const wicks = []; for (const sx of [-1, 1]) { for (const x of [31.0, 33.5, 36.0, 38.6]) { const p = W.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } for (const x of [10.0, 12.2, 14.4]) { const p = stab.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } } for (const y of [15.0, 17.2]) wicks.push(fin.at(y, 1, 'mid')); stB.add(K.staticWicks(wicks, 0.3, UB.wick)); }

  lap('geometry');
  // ---- paint + materials ------------------------------------------------------------------------------------------------------
  paintFuselage(A, { SC, fus, cFus, cPanel, cOver, cPed, WIN });
  paintSurfaces(B, { SC, W: W.R, fin, stab: stab.R, cWT, cWB, cSt, cFin });
  lap('paint');
  const matA = A.material(ctx, { envMapIntensity: 1, emissiveIntensity: 0 }), matB = B.material(ctx, { envMapIntensity: 1 });
  lap('textures');
  rig.material('paint', matA, { shared: true }); rig.material('wing', matB, { shared: true });
  rig.disposables.push(A, B);

  // ---- moving surfaces --------------------------------------------------------------------------------------------------------
  const drop = (ctrl, d, aft = 0) => { const u = ctrl.up, h = ctrl.hinge, o = [-u[0] * d, -u[1] * d, -u[2] * d + aft]; return { a: [h.a[0] + o[0], h.a[1] + o[1], h.a[2] + o[2]], b: [h.b[0] + o[0], h.b[1] + o[1], h.b[2] + o[2]] }; };
  const DOWN = [0, -1, 0], UP = [0, 1, 0];
  // all flaps (both wings, with the rear halves of their track fairings) and all leading-edge devices share one morph part each:
  // every panel's morph target is its own Fowler / droop rotation, driven by one influence (flaps resp. slats)
  const flapAll = new K.Mesh(), lePart = new K.Mesh(), wingAnim = [];
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const C = W[key].controls;
    FLAPS.forEach(([x0, x1], i) => {
      const ctrl = C['flap' + i], mesh = ctrl.mesh.clone();
      for (const x of CANOES) if (x > x0 && x < x1) { const cn = canoeAt(x, 7.2 - x * 0.12, sx, 1.15 - x * 0.012); stB.add(cn.front); mesh.add(cn.rear); }
      flapAll.add(morphed(mesh, drop(ctrl, [1.9, 1.5, 1.1][i], 0.15), ctrl.ref, DOWN, [32, 30, 28][i] * DEG));
    });
    lePart.add(morphed(C.droop.mesh, C.droop.hinge, C.droop.ref, DOWN, 24 * DEG));
    lePart.add(morphed(C.slat.mesh, drop(C.slat, 0.65, 0.22), C.slat.ref, DOWN, 23 * DEG));
    const sp = new K.Mesh(); for (let i = 0; i < SPOILERS.length; i++) { const c = C['sp' + i]; sp.add(morphed(c.mesh, c.hinge, c.ref, UP, 50 * DEG)); }
    const spoil = rig.part('spoilers' + key, sp, { key: 'wing' });
    const ailMesh = K.merge(...AILS.map((_, i) => C['ail' + i].mesh));
    const ail = rig.hingePart('ailerons' + key, { ...C.ail0, hinge: { a: C.ail0.hinge.a, b: C.ail2.hinge.b } }, { key: 'wing', mesh: ailMesh }).set;
    const elev = rig.hingePart('elevator' + key, stab[key].controls.elevIn, { key: 'wing', mesh: K.merge(stab[key].controls.elevIn.mesh, stab[key].controls.elevOut.mesh) }).set;
    wingAnim.push({ key, spoil, ail, elev });
  }
  const flaps = rig.part('flaps', flapAll, { key: 'wing' }), slats = rig.part('slats', lePart, { key: 'wing' });
  const rud = rig.hingePart('rudder', fin.controls.rudLo, { key: 'wing', toward: [1, 0, 0], mesh: K.merge(fin.controls.rudLo.mesh, fin.controls.rudUp.mesh) });
  const fans = eng.map((e, i) => rig.part('fan' + i, e.fanMesh.translate(e.c[0], e.c[1], e.n.fanZ), { key: 'wing', pivot: [e.c[0], e.c[1], e.n.fanZ] }));
  const sleeves = rig.part('reversers', sleeveAll, { key: 'wing' });
  rig.addStatic(stB, 'wing');

  // ---- landing gear -----------------------------------------------------------------------------------------------------------
  const gp = G.gear, gearUV = { strut: UA.strut, hub: UA.hub, tyre: UA.tyre, piston: UA.chrome, link: UA.link };
  K.buildGear(rig, A, {
    name: 'nose', index: 0, contact: gp[0].pos, wheels: [-0.4, 0.4], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.38, pivot: [0, -3.35, -28.0], stroke: 0.42, staticFrac: 0.4,
    strutR: 0.14, steer: true, links: 'none', retract: { to: [0, -3.55, -29.95] }, window: [0.2, 0.88], brace: [0, -3.3, -29.6], uv: gearUV, wheelSegments: 24,
    lamps: [{ kind: 'taxi', pos: [0, -4.55, -28.62], size: 0.09, color: [1, 0.96, 0.9] }],
  });
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {          // wing gear: four-wheel bogie, swings inboard into the fairing
    const c = gp[i].pos;
    bogieGear(rig, { name: 'wing' + key, index: i, side: sx, contact: c, R: gp[i].wheelRadius, wW: 0.5, pivot: [sx * 6.0, -2.75, 0.6], stow: [sx * 3.62, -3.0, 0.75],
      stroke: 0.5, staticFrac: 0.4, strutR: 0.22, axles: [-0.78, 0.78], track: 0.72, tilt: 9, window: [0.2, 0.88], uv: UA,
      brace: [sx * 4.4, -2.9, 0.9], drag: [sx * 6.1, -2.6, -1.6], legDoor: UA.fair, keepLevel: 0 });
  }
  for (const [i, sx, key] of [[3, -1, 'L'], [4, 1, 'R']]) {          // body gear: six-wheel bogie, swings forward into the belly
    const c = gp[i].pos;
    bogieGear(rig, { name: 'body' + key, index: i, side: sx, contact: c, R: gp[i].wheelRadius, wW: 0.5, pivot: [sx * 2.65, -3.1, 6.9], stow: [sx * 2.65, -3.25, 4.0],
      stroke: 0.5, staticFrac: 0.4, strutR: 0.22, axles: [-1.55, 0, 1.55], track: 0.72, tilt: 7, window: [0.2, 0.88], uv: UA,
      brace: [sx * 1.4, -3.2, 6.4], drag: [sx * 2.65, -3.0, 8.4], legDoor: UA.fair, keepLevel: 1 });
  }
  // gear-bay doors: one morph part (each door's target is its own swing open); open while the gear travels, closed at both ends
  const doorAll = new K.Mesh();
  const door = (patch, edge, deg) => doorAll.add(morphed(K.thicken(patch, 0.03, UA.well), { a: edge[0], b: edge[1] }, K.centroid(patch), DOWN, deg * DEG));
  door(fus.patches.ngwR, fus.edges.ngwR.tHi, 88); door(fus.patches.ngwL, fus.edges.ngwL.tLo, 88);
  door(fair.patches.wgwR, fair.edges.wgwR.tLo, 95); door(fair.patches.wgwL, fair.edges.wgwL.tHi, 95);
  door(fair.patches.bgwR, fair.edges.bgwR.tHi, 92); door(fair.patches.bgwL, fair.edges.bgwL.tLo, 92);
  const doors = rig.part('gearDoors', doorAll, { key: 'paint' });
  rig.addStatic(stA, 'paint');

  // ---- lamps ------------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.15, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.15, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.1 });
  for (const sx of [-1, 1]) rig.lamp('strobe', [sx * (Math.abs(L.navRight[0]) + 0.03), L.navRight[1] + 0.12, L.navRight[2] + 0.35], { color: [1, 1, 1], size: 0.1 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.1 });
  rig.lamp('beacon', [0, fus.topAt(-6) + 0.05, -6], { color: [1, 0.05, 0.03], size: 0.16, squash: [1, 0.6, 1] });
  rig.lamp('beacon', L.beacon, { color: [1, 0.05, 0.03], size: 0.16, squash: [1, 0.6, 1] });
  for (const sx of [-1, 1]) rig.lamp('landing', [sx * Math.abs(L.landing[0]), L.landing[1], L.landing[2]], { color: [1, 0.97, 0.9], size: 0.2, squash: [1.4, 0.8, 0.5] });
  for (const sx of [-1, 1]) { const p = fair.at(-12.4, sx > 0 ? 0.2 : 0.8).p; rig.lamp('taxi', [p[0], p[1], p[2] - 0.05], { color: [1, 0.97, 0.9], size: 0.1 }); }   // runway turn-off lights
  // logo lights on the stabiliser (lighting the fin) and wing-scan lights on the fuselage, on with the nav lights
  for (const sx of [-1, 1]) { const p = stab.R.at(5.5, 0.35, 'upper'); rig.lamp('formation', [sx * p[0], p[1] + 0.05, p[2]], { color: [1, 0.95, 0.85], size: 0.11 }); }
  for (const sx of [-1, 1]) { const z = -16.5, t = fus.tAtY(z, 0.4), p = fus.at(z, sx > 0 ? t : 1 - t).p; rig.lamp('formation', [p[0] + sx * 0.03, p[1], p[2]], { color: [1, 0.96, 0.9], size: 0.09 }); }

  // ---- animation --------------------------------------------------------------------------------------------------------------
  const fanAng = [0, 0, 0, 0];
  const flapK = [[0, 0], [0.1, 0], [0.3, 8 / 32], [0.55, 17 / 32], [0.78, 25 / 32], [1, 1]];
  rig.onUpdate((S, dt) => {
    const sf = S.sf, gnd = S.onGround ? 1 : 0;
    flaps.morphTargetInfluences[0] = K.keys(flapK, sf.flaps);
    slats.morphTargetInfluences[0] = Math.max(0, sf.slats);
    for (const a of wingAnim) {
      const R = a.key === 'R', ail = R ? sf.aileronR : sf.aileronL, sp = R ? sf.spoilerR : sf.spoilerL, el = R ? sf.elevatorR : sf.elevatorL;
      a.ail((ail * 22 - Math.min(1, sf.flaps * 3) * 5) * DEG);
      a.spoil.morphTargetInfluences[0] = Math.min(1, Math.max(Math.max(0, sp), sf.speedbrake * (gnd ? 1 : 0.6)));
      a.elev((el > 0 ? el * 30 : el * 20) * DEG);
    }
    rud.set(sf.rudder * 30 * DEG);
    const g = sf.gear;
    doors.morphTargetInfluences[0] = Math.min(K.seq(g, 0.02, 0.19), 1 - K.seq(g, 0.9, 0.99));
    let rev = 0;
    for (let i = 0; i < 4; i++) {
      const e = S.eng[i] || {};
      fanAng[i] = (fanAng[i] + (e.n1 || 0) * 21 * dt) % TAU;
      fans[i].quaternion.set(0, 0, Math.sin(fanAng[i] / 2), Math.cos(fanAng[i] / 2));
      if (Math.abs(G.engines[i].intake[0]) < 20) rev = Math.max(rev, e.reverser || 0);
    }
    sleeves.morphTargetInfluences[0] = rev;
    matA.emissiveIntensity = S.night * 2.4;
  });
  const visual = rig.build();
  lap('rig'); visual.stats.phases = lap.out; visual.stats.sleeveTravel = sleeveTravel;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- bogie main gear: oleo leg hinged in the airframe, tilting bogie beam, one spinning wheel pair per axle ------------------
// o: { name, index, side, contact, R, wW, pivot, stow (stowed bogie-centre position), stroke, staticFrac, strutR, axles: [z offsets],
//      track (wheel x offset from the beam), tilt (deg, toe-up when hanging), window, uv, brace, drag, legDoor, keepLevel (1: the
//      bogie counter-rotates during retraction and stows level) }
function bogieGear(rig, o) {
  const ctx = rig.ctx, V = (a) => new THREE.Vector3(a[0], a[1], a[2]), Ar = (v) => [v.x, v.y, v.z], UA = o.uv;
  const P = V(o.pivot), R = o.R, wW = o.wW, stroke = o.stroke, eStatic = stroke * (1 - o.staticFrac);
  const contact = V(o.contact), C = contact.clone().add(new THREE.Vector3(0, R, 0));
  const d = C.clone().sub(P), Lp = d.length(); d.normalize();
  const Lo = Math.max(0.6, Lp - (eStatic + 0.55)), Bt = P.clone().addScaledVector(d, Lo), sr = o.strutR;
  const v1 = d.clone(), v2 = V(o.stow).sub(P).normalize(), rAxis = new THREE.Vector3().crossVectors(v1, v2).normalize(), rAngle = Math.acos(Math.min(1, Math.max(-1, v1.dot(v2))));
  const leg = rig.node(o.name + '.leg', { pivot: Ar(P) });
  const sm = new K.Mesh();
  sm.add(K.tube(Ar(P.clone().addScaledVector(d, -0.15)), Ar(Bt), sr, sr * 0.95, { segments: 16, uv: UA.strut }));
  sm.add(K.tube(Ar(Bt.clone().addScaledVector(d, -0.12)), Ar(Bt.clone().addScaledVector(d, 0.02)), sr * 1.15, sr * 1.15, { segments: 16, uv: UA.strut }));
  sm.add(K.tube(Ar(P.clone().addScaledVector(rAxis, -0.5)), Ar(P.clone().addScaledVector(rAxis, 0.5)), sr * 0.8, sr * 0.8, { segments: 12, uv: UA.strut }));
  for (const [end, r] of [[o.brace, 0.08], [o.drag, 0.09]]) {
    const b0 = P.clone().addScaledVector(d, Lo * 0.6), b1 = V(end), mid = b0.clone().lerp(b1, 0.5).addScaledVector(d, 0.1);
    sm.add(K.tube(Ar(b0), Ar(mid), r, r, { segments: 8, uv: UA.link })).add(K.tube(Ar(mid), Ar(b1), r * 0.9, r * 0.9, { segments: 8, uv: UA.link }));
    sm.add(K.ellipsoid(r * 1.5, r * 1.5, r * 1.5, { segments: 8, rings: 4, uv: UA.link }).translate(mid.x, mid.y, mid.z));
  }
  { // leg door on the outboard face of the strut
    const out = new THREE.Vector3(o.side, 0, 0).addScaledVector(d, -d.x * o.side).normalize().multiplyScalar(sr + 0.08), fw = new THREE.Vector3(0, 0, -1).addScaledVector(d, d.z).normalize();
    const q = (s, f) => Ar(P.clone().addScaledVector(d, s).add(out).addScaledVector(fw, f));
    sm.add(K.plate(q(-0.1, 0.7), q(-0.1, -0.6), q(Lo * 0.95, -0.55), q(Lo * 0.95, 0.62), 0.03, o.legDoor));
  }
  rig.part(o.name + '.strut', sm, { parent: leg, pivot: Ar(P) });
  const pm = new K.Mesh(), yoke = C.clone().addScaledVector(d, -0.25);
  pm.add(K.tube(Ar(Bt.clone().addScaledVector(d, -(stroke + 0.1))), Ar(yoke), sr * 0.62, sr * 0.62, { segments: 14, uv: UA.chrome }));
  pm.add(K.tube(Ar(yoke), Ar(C), sr * 0.75, sr * 0.55, { segments: 12, uv: UA.strut }));
  pm.add(K.tube([C.x - 0.26, C.y, C.z], [C.x + 0.26, C.y, C.z], 0.11, 0.11, { segments: 10, uv: UA.link }));
  { const s0 = Bt.clone().add(new THREE.Vector3(0, 0, -sr * 1.1)), s1 = yoke.clone().add(new THREE.Vector3(0, 0, -sr * 0.8)), apex = s0.clone().lerp(s1, 0.5).add(new THREE.Vector3(0, 0, -0.3));
    pm.add(K.tube(Ar(s1), Ar(apex), 0.035, 0.035, { segments: 6, uv: UA.link })); sm.add(K.tube(Ar(s0), Ar(apex), 0.035, 0.035, { segments: 6, uv: UA.link })); }
  const piston = rig.part(o.name + '.piston', pm, { parent: leg, pivot: Ar(C) });
  const axz = o.axles, tr = o.track, bm = new K.Mesh(), zMin = Math.min(...axz), zMax = Math.max(...axz);
  bm.add(K.tube([C.x, C.y + 0.03, C.z + zMin - 0.34], [C.x, C.y + 0.03, C.z + zMax + 0.34], 0.14, 0.14, { segments: 12, uv: UA.strut }));
  for (const z of axz) {
    bm.add(K.tube([C.x - tr - wW * 0.3, C.y, C.z + z], [C.x + tr + wW * 0.3, C.y, C.z + z], 0.09, 0.09, { segments: 10, uv: UA.link }));
    if (z !== 0) for (const s of [-1, 1]) bm.add(K.tube([C.x + s * 0.13, C.y + 0.13, C.z + z * 0.45], [C.x + s * 0.13, C.y + 0.05, C.z + z], 0.03, 0.03, { segments: 5, uv: UA.link }));
  }
  const bogie = rig.part(o.name + '.bogie', bm, { parent: piston, pivot: Ar(C) });
  const wheelSet = (z) => { const m = new K.Mesh(); for (const x of [-tr, tr]) m.add(K.wheel({ radius: R, width: wW, uvTyre: UA.tyre, uvHub: UA.hub, segments: 24 }).translate(C.x + x, C.y, C.z + z)); return m; };
  const wheels = axz.map((z, k) => rig.part(o.name + '.wheel' + k, wheelSet(z), { parent: bogie, pivot: [C.x, C.y, C.z + z] }));
  const win = o.window, X = new THREE.Vector3(1, 0, 0), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), q = new THREE.Quaternion(), qa = new THREE.Quaternion(), qt = new THREE.Quaternion();
  const rest = piston.position.clone();
  let ext = eStatic, spin = 0, rate = 0, first = true;
  rig.onUpdate((S, dt) => {
    const g = S.sf.gear, down = K.seq(g, win[0], win[1]);
    leg.visible = g > 0.012;
    if (!leg.visible) return;
    leg.quaternion.setFromAxisAngle(rAxis, rAngle * (1 - down));
    const gs = S.gear[o.index] || {}, st = S.raw; let target;
    if (gs.onGround && g > 0.98 && ctx?.world?.groundHeightAt && st && st.position && st.quaternion) {
      tmp.copy(contact).applyQuaternion(st.quaternion).add(st.position);
      tmp2.copy(d).applyQuaternion(st.quaternion);
      target = eStatic + (ctx.world.groundHeightAt(tmp.x, tmp.z) - tmp.y) / Math.min(-0.3, tmp2.y);
    } else if (S.hasGearState) target = gs.onGround ? stroke * (1 - gs.compression) : stroke;
    else target = S.onGround ? eStatic : stroke;
    target = Math.min(stroke, Math.max(0, target));
    ext = first || dt <= 0 ? target : ext + (target - ext) * (1 - Math.exp(-30 * dt)); first = false;
    const off = ext - eStatic;
    piston.position.set(rest.x + d.x * off, rest.y + d.y * off, rest.z + d.z * off);
    // toe-up tilt when the oleo hangs extended, level when compressed; optional counter-rotation so the bogie stows level
    const tilt = o.tilt * DEG * K.seq(ext, eStatic + 0.03, stroke - 0.01) * (0.4 + 0.6 * down);
    qt.setFromAxisAngle(X, tilt);
    if (o.keepLevel) { qa.setFromAxisAngle(rAxis, -rAngle * (1 - down)); bogie.quaternion.multiplyQuaternions(qa, qt); } else bogie.quaternion.copy(qt);
    if (gs.onGround) rate = isNaN(gs.wheelSpeed) ? S.groundSpeed / R : gs.wheelSpeed; else if (!isNaN(gs.wheelSpeed) && gs.wheelSpeed !== 0) rate = gs.wheelSpeed; else rate *= Math.exp(-0.6 * dt);
    spin = (spin - rate * dt) % TAU;
    q.setFromAxisAngle(X, spin); for (const w of wheels) w.quaternion.copy(q);
  });
}

// ---- paint: fuselage atlas ---------------------------------------------------------------------------------------------------
function paintFuselage(A, o) {
  const { SC, fus, cFus, cPanel, cOver, cPed, WIN } = o, F = K.FINISH;
  const P = A.pen(cFus), body = F.gloss(SC.body), belly = F.gloss(SC.belly), cheat = F.gloss(SC.cheat), accent = F.gloss(SC.accent);
  const font = SC.font === 'serif' ? K.FONT.serif : SC.font === 'round' ? K.FONT.round : K.FONT.wide, Z0 = -37.6, Z1 = 35.3;
  P.fill('all', body);
  // --- livery ---
  if (SC.style === 'cheat') {            // grey belly; broad blue band between the decks sweeping up the tail cone, gold pinstripe
    P.band(Z0, Z1, -Infinity, (z) => -2.55 + Math.max(0, z - 14) * 0.1, belly, { step: 0.4, feather: 2 });
    const lo = (z) => 0.05 + Math.max(0, z - 10) * 0.075 + Math.pow(Math.max(0, z - 22) / 13, 2) * 0.6, hi = (z) => 1.05 + Math.max(0, z - 10) * 0.075 + Math.pow(Math.max(0, z - 22) / 13, 2) * 0.6;
    const k = (z) => Math.pow(Math.min(1, Math.max(0, (z + 33.5) / 6.5)), 0.8);         // the band tapers to a point toward the nose
    P.band(-33.5, Z1, (z) => (lo(z) + hi(z)) / 2 - (hi(z) - lo(z)) / 2 * k(z), (z) => (lo(z) + hi(z)) / 2 + (hi(z) - lo(z)) / 2 * k(z), cheat, { step: 0.25 });
    P.band(-32.0, Z1, (z) => lo(z) - 0.2 * k(z + 1.5), (z) => lo(z) - 0.1 * k(z + 1.5), accent, { step: 0.25 });
    P.textOn(SC.title, -12.0, 3.25, 'both', 1.05, { color: SC.titleColor, font, weight: 700, spacing: 0.16 });
  } else if (SC.style === 'sweep') {     // deep teal belly sweeping up the aft fuselage into the tail, coral pin line
    const edge = (z) => (z < 4 ? -1.95 + (z + 37.5) * 0.004 : -1.78 + Math.pow((z - 4) / 31, 2.0) * 6.2);
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.32, accent, { step: 0.25 });
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.16, body, { step: 0.25 });
    P.band(Z0, Z1, -Infinity, edge, belly, { step: 0.25 });
    P.textOn(SC.title, -12.5, 3.2, 'both', 1.35, { color: SC.titleColor, font, weight: 700 });
  } else {                               // house: grey belly, a blue stripe pair between the decks, big titles
    P.band(Z0, Z1, -Infinity, -2.4, belly, { step: 0.5 });
    P.band(-33.0, Z1, (z) => 0.35 + Math.max(0, z - 18) * 0.08, (z) => 0.75 + Math.max(0, z - 18) * 0.08, cheat, { step: 0.4 });
    P.band(-33.0, Z1, (z) => 0.95 + Math.max(0, z - 18) * 0.08, (z) => 1.05 + Math.max(0, z - 18) * 0.08, F.gloss(SC.accent), { step: 0.4 });
    P.textOn(SC.title, -13.0, 3.25, 'both', 0.95, { color: SC.titleColor, font, weight: 700, spacing: 0.16 });
    P.textOn('A380', 13.5, 3.15, 'both', 0.95, { color: SC.cheat, font: K.FONT.wide, weight: 700, spacing: 0.08 });
  }
  P.textOn(SC.reg, 24.0, 0.5, 'both', 0.5, { color: SC.style === 'sweep' ? '#ffffff' : SC.style === 'cheat' ? '#ffffff' : '#1d2126', font: K.FONT.sans, weight: 700 });
  // radome joint and nose access panels
  P.ring(D(2.9), 0, 1, { px: 1.4, depth: 0.5, dark: 0.28 });
  P.ring(D(0.9), 0, 1, { px: 1, depth: 0.3, dark: 0.1 });
  // --- flight-deck windows (painted glass with a dark surround) ---
  for (const s of [1, -1]) {
    const m = (p) => [p[0], s > 0 ? p[1] : 1 - p[1]];
    for (const w of WIN) {
      const pts = w.map(m), path = (g) => { pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      P.stroke(path, 0, { color: '#202327', rough: 0.4, metal: 0 }, { join: 'round', px: 10 });
      P.fill(pts, F.paintedGlass);
      P.groove(path, { px: 1.2, depth: 0.5, dark: 0.2 });
    }
  }
  P.fill([[WIN[0][0][0], WIN[0][0][1]], [WIN[0][3][0], WIN[0][3][1]], [WIN[0][3][0], 1 - WIN[0][3][1]], [WIN[0][0][0], 1 - WIN[0][0][1]]], { color: '#202327', rough: 0.4, metal: 0 });
  // --- cabin windows, doors, hatches ---
  const mainDoors = [8.5, 18.5, 33, 52, 62].map(D), upDoors = [12, 36, 58].map(D);
  const frame = SC.style === 'house' ? '#d5d9dc' : '#c4c8cb';
  const zm = []; for (let z = D(9.6); z < D(66.5); z += 0.53) if (mainDoors.every(dz => Math.abs(z - dz) > 0.95)) zm.push(z);
  P.windows(zm, -0.85, { w: 0.27, h: 0.4, r: 0.11, frame });
  const zu = []; for (let z = D(10.6); z < D(63.0); z += 0.53) if (upDoors.every(dz => Math.abs(z - dz) > 0.95)) zu.push(z);
  P.windows(zu, 2.3, { w: 0.26, h: 0.38, r: 0.11, frame, seed: 77 });
  const dr = { px: 1.3, depth: 0.6, dark: 0.35 };
  for (const dz of mainDoors) { P.doorOn(dz - 0.54, dz + 0.54, -1.95, 0.0, { ...dr, handle: true }); P.windows([dz], -0.55, { w: 0.2, h: 0.25, r: 0.08, lit: 0 }); }
  for (const dz of upDoors) { P.doorOn(dz - 0.54, dz + 0.54, 1.3, 3.2, { ...dr, handle: true }); P.windows([dz], 2.55, { w: 0.2, h: 0.25, r: 0.08, lit: 0 }); }
  P.doorOn(D(18.0), D(21.0), -3.55, -2.1, { ...dr, side: 'R' }); P.doorOn(D(53.0), D(56.0), -3.45, -2.05, { ...dr, side: 'R' }); P.doorOn(D(59.6), D(60.8), -3.1, -2.1, { ...dr, side: 'R' });
  P.doorOn(D(2.4), D(3.1), -2.9, -2.3, { px: 1, depth: 0.4, dark: 0.15, side: 'L' });
  // skin joints: circumferential every ~1.6 m, lap joints above / below the window rows
  for (let z = -34.0; z < 34.6; z += 1.6) P.ring(z, 0, 1, { px: 1, depth: 0.3, dark: 0.07 });
  for (const y of [3.15, 1.35, -0.1, -1.7, -3.0]) P.yLine(-33.5, 33.5, (z) => Math.min(fus.topAt(z) - 0.3, Math.max(fus.botAt(z) + 0.25, y + Math.max(0, z - 18) * 0.06)), { px: 1, depth: 0.3, dark: 0.07 });
  P.line([[-34.5, 0.5], [35.0, 0.5]], { px: 1, depth: 0.25, dark: 0.06 });
  // static ports, outflow valves, APU door, grime
  P.decalOn(D(4.5), -0.9, 'both', (g) => { g.fillStyle = '#a1a6aa'; g.beginPath(); g.arc(0, 0, 0.09, 0, TAU); g.fill(); g.strokeStyle = '#c42a1e'; g.lineWidth = 0.014; g.strokeRect(-0.18, -0.13, 0.36, 0.26); });
  P.decalOn(31.5, 0.4, 'R', (g) => { g.fillStyle = '#3a3d40'; g.fillRect(-0.4, -0.15, 0.8, 0.3); g.strokeStyle = '#8b9095'; g.lineWidth = 0.02; g.strokeRect(-0.43, -0.18, 0.86, 0.36); });
  for (const z of [-17.5, 18.0]) P.decalOn(z, -3.3, 'L', (g) => { g.fillStyle = '#4a4e52'; g.beginPath(); g.ellipse(0, 0, 0.38, 0.12, 0, 0, TAU); g.fill(); });
  const rnd = (() => { let a = 11; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  for (let i = 0; i < 46; i++) { const z = -16 + rnd() * 46, t = rnd() < 0.5 ? rnd() * 0.07 : 1 - rnd() * 0.07; P.streak(z, t, z + 1 + rnd() * 3, t, 0.005 + rnd() * 0.012, { alpha: 0.05 + rnd() * 0.08 }); }
  for (let i = 0; i < 10; i++) { const z = 31 + rnd() * 3.5; P.streak(z, 0.6 + rnd() * 0.04, z + 1.4, 0.58 + rnd() * 0.04, 0.012, { alpha: 0.08 }); }
  P.noise({ alpha: 0.03, scale: 4, stretch: [2, 1] });
  P.noise({ alpha: 0.022, scale: 11, stretch: [2, 1] });
  // --- flight-deck panels: eight displays, FCU strip, pedestal, overhead ---
  {
    const Q = A.pen(cPanel); Q.fill('all', { color: '#59616a', rough: 0.7, metal: 0 });
    const scr = (a, b, w, h, col) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#08090a', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(a + 0.012, b + 0.012, w - 0.024, h - 0.024), { color: col, rough: 0.15, metal: 0, emissive: col }); };
    for (const x0 of [0.08, 1.48]) { scr(x0, 0.14, 0.2, 0.27, '#0c1626'); scr(x0 + 0.22, 0.14, 0.2, 0.27, '#0b1520'); scr(x0 + 0.44, 0.14, 0.2, 0.27, '#0d1a14'); }
    scr(1.02, 0.08, 0.2, 0.27, '#0b1120'); scr(1.02, 0.36, 0.2, 0.2, '#0b1120');
    Q.fill((g) => g.rect(0.2, 0.0, 2.0, 0.07), { color: '#3a3f45', rough: 0.6, metal: 0 });
    for (let i = 0; i < 10; i++) Q.fill((g) => g.rect(0.3 + i * 0.19, 0.018, 0.1, 0.032), { color: '#0a0a0a', rough: 0.2, metal: 0, emissive: i % 3 ? '#3a2408' : '#000000' });
  }
  {
    const Q = A.pen(cOver); Q.fill('all', { color: '#69717a', rough: 0.7, metal: 0 });
    for (let j = 0; j < 9; j++) for (let i = 0; i < 7; i++) Q.fill((g) => g.rect(0.05 + i * 0.105, 0.04 + j * 0.105, 0.075, 0.075), { color: (i + j * 2) % 5 ? '#4a5057' : '#24272b', rough: 0.6, metal: 0, emissive: (i * 3 + j) % 7 === 0 ? '#1c1403' : undefined });
  }
  {
    const Q = A.pen(cPed); Q.fill('all', { color: '#5d646c', rough: 0.7, metal: 0 });
    for (const b of [0.34, 0.54]) for (const a of [0.04, 0.21]) { Q.fill((g) => g.rect(a, b, 0.15, 0.14), { color: '#0b0c0d', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(a + 0.015, b + 0.015, 0.12, 0.06), { color: '#0d1a12', rough: 0.2, metal: 0, emissive: '#0d2414' }); }
    Q.fill((g) => g.rect(0.06, 0.03, 0.28, 0.25), { color: '#2b2e32', rough: 0.6, metal: 0 });
  }
}

// ---- paint: wings, tail -------------------------------------------------------------------------------------------------------
function paintSurfaces(B, o) {
  const { SC, W, fin, stab, cWT, cWB, cSt, cFin } = o, F = K.FINISH;
  const grey = F.semigloss('#babfc4'), dgrey = F.semigloss('#a6acb1'), white = F.gloss('#e4e7e9'), metal = { color: '#c9ccce', rough: 0.26, metal: 0.9 };
  const line = { px: 1, depth: 0.35, dark: 0.12 }, gap = { px: 1.8, depth: 0.8, dark: 0.5 };
  const at = (x, f) => { const p = W.at(x, f); return [p[0], p[2]]; };
  const Ln = (name, x) => W.lines[name].at(W.spanToU(x));
  const pl = (name, x0, x1) => { const pts = []; for (let x = x0; x < x1; x += 1.5) pts.push(at(x, Ln(name, x))); pts.push(at(x1, Ln(name, x1))); return pts; };
  for (const [chart, top] of [[cWT.i, true], [cWT.o, true], [cWB.i, false], [cWB.o, false]]) {
    const Q = B.pen(chart); Q.fill('all', top ? grey : white);
    if (top) Q.fill([...pl('slat', 3.8, 39.4).map(p => [p[0], p[1] + 0.25]), ...pl('spoil', 3.8, 39.4).reverse().map(p => [p[0], p[1] - 0.15])], dgrey);
    Q.fill([at(3.8, 0), at(XT, 0), at(XT, 0.03), at(3.8, 0.03)], metal);
    // leading-edge devices
    Q.line(pl('slat', 4.4, 11.8), gap); Q.line(pl('slat', SLATS[0], SLATS[SLATS.length - 1]), gap);
    for (const x of [4.4, 7.0, 9.4, 11.8, ...SLATS]) Q.line([at(x, 0), at(x, Ln('slat', x))], gap);
    // spoilers, flaps, ailerons
    if (top) for (const [x0, x1] of SPOILERS) Q.line([at(x0, Ln('spoil', x0)), at(x1, Ln('spoil', x1)), at(x1, Ln('flap', x1)), at(x0, Ln('flap', x0)), at(x0, Ln('spoil', x0))], gap);
    for (const [x0, x1] of [...FLAPS, ...AILS]) { Q.line(pl('flap', x0, x1), gap); Q.line([at(x0, Ln('flap', x0)), at(x0, 1)], gap); Q.line([at(x1, Ln('flap', x1)), at(x1, 1)], gap); }
    for (const f of [0.2, 0.32, 0.46]) Q.line([at(3.8, f), at(11.5, f), at(XK, f), at(25, f), at(39.6, f)], line);
    for (let x = 4.6; x < 39.5; x += 1.4) Q.line([at(x, Ln('slat', x) + 0.01), at(x, Ln('spoil', x) - 0.01)], line);
    for (const f of [0.2, 0.46]) { const a = at(4, f + 0.006), b = at(39.4, f + 0.006); Q.rivets(a[0], a[1], b[0], b[1], 0.08, { px: 1.2, depth: 0.15, dark: 0.04 }); }
    if (top) {
      const a = at(4.4, 0.24), b = at(4.4, 0.58), c = at(11.0, 0.58), d = at(11.0, 0.24);     // walkway
      Q.stroke((g) => { g.moveTo(d[0], d[1]); g.lineTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); }, 0.07, F.matte('#2a2c2e'));
      for (const x of [9, 18, 27, 34]) { const p = at(x, 0.36); Q.decal(p[0], p[1], (g) => { g.fillStyle = '#3c4044'; g.beginPath(); g.arc(0, 0, 0.12, 0, TAU); g.fill(); }); }
      for (const x of [16, 30]) { const p = at(x, 0.1); Q.text('NO STEP', p[0], p[1] + 1.1, 0.16, { color: '#7a2a24', font: K.FONT.sans }); }
    } else {
      for (let i = 0; i < 22; i++) { const x = 5 + i * 1.55, a = at(x, 0.66); Q.streak(a[0], a[1], a[0], a[1] + 2.0, 0.08, { alpha: 0.1 }); }
      for (const x of [8, 16, 22, 30, 35]) { const p = at(x, 0.4); Q.panel(p[0] - 0.35, p[1] - 0.25, p[0] + 0.35, p[1] + 0.25, { r: 0.06 }); }
      const r = at(30, 0.42); Q.text(SC.reg, r[0], r[1], 1.6, { color: '#2a2e33', font: K.FONT.sans, weight: 700, rot: 90 });
    }
    Q.noise({ alpha: 0.045, scale: 3, stretch: [1, 2.5], rough: 0.04 });
  }
  {
    const Q = B.pen(cSt); Q.fill('all', grey);
    const sa = (x, f) => { const p = stab.at(x, f); return [p[0], p[2]]; };
    Q.fill([sa(0.8, 0), sa(15.2, 0), sa(15.2, 0.06), sa(0.8, 0.06)], metal);
    Q.line([sa(3.2, 1), sa(3.2, 0.71), sa(8.9, 0.71), sa(8.9, 1)], gap); Q.line([sa(9.0, 1), sa(9.0, 0.71), sa(14.9, 0.71), sa(14.9, 1)], gap);
    for (const f of [0.22, 0.46]) Q.line([sa(1.5, f), sa(15, f)], line);
    for (const x of [4.5, 6.5, 8.5, 10.5, 12.5]) Q.line([sa(x, 0.07), sa(x, 0.7)], line);
    Q.noise({ alpha: 0.045, scale: 3, stretch: [1, 2], rough: 0.04 });
  }
  for (const key of ['L', 'R']) {
    const Q = B.pen(cFin[key]); Q.fill('all', F.gloss(SC.tail));
    const fa = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    const c = fa(11.0, 0.42);
    if (SC.style === 'cheat') {            // large white swoosh with a gold pinstripe, crossed by a stylised star
      Q.decal(c[0], c[1], (g) => {
        g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(-5.2, 5.6); g.bezierCurveTo(-1.5, 2.2, 1.0, 1.2, 5.4, -4.8); g.bezierCurveTo(1.8, -0.6, -1.2, 1.6, -5.2, 6.6); g.closePath(); g.fill();
        g.strokeStyle = SC.accent; g.lineWidth = 0.18; g.beginPath(); g.moveTo(-5.0, 7.2); g.bezierCurveTo(-1.0, 2.6, 1.8, 0.8, 5.6, -3.8); g.stroke();
        g.fillStyle = SC.accent; g.beginPath();
        for (let i = 0; i < 10; i++) { const a = i / 10 * TAU - Math.PI / 2, r = i % 2 ? 0.45 : 1.15, x = -1.6 + Math.cos(a) * r, y = -1.9 + Math.sin(a) * r; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
        g.closePath(); g.fill();
      });
    } else if (SC.style === 'sweep') {     // coral leaf with white veins
      Q.decal(c[0] + 0.4, c[1], (g) => {
        g.fillStyle = SC.accent; g.beginPath(); g.moveTo(-3.4, 3.6); g.bezierCurveTo(-3.6, -0.6, -0.6, -3.6, 3.6, -4.2); g.bezierCurveTo(3.2, 0.2, 0.4, 3.4, -3.4, 3.6); g.closePath(); g.fill();
        g.strokeStyle = '#ffffff'; g.lineWidth = 0.16; g.lineCap = 'round'; g.beginPath(); g.moveTo(-3.0, 3.2); g.quadraticCurveTo(0, 0.4, 3.2, -3.8); g.stroke();
        for (const t of [0.25, 0.45, 0.65]) { const x = -3 + 6.2 * t, y = 3.2 - 7 * t + 0.6; g.beginPath(); g.moveTo(x, y - 0.4); g.lineTo(x + 1.1, y - 0.2); g.stroke(); g.beginPath(); g.moveTo(x, y - 0.4); g.lineTo(x - 0.2, y - 1.4); g.stroke(); }
      });
    } else {                               // house: blue root band and fin-top flash, "380" mark
      Q.fill([fa(2.6, 0), fa(6.2, 0), fa(6.2, 1), fa(2.6, 1)], F.gloss(SC.cheat));
      Q.fill([fa(6.2, 0), fa(6.6, 0), fa(6.6, 1), fa(6.2, 1)], F.gloss(SC.accent));
      Q.fill([fa(16.6, 0), fa(FIN_H, 0), fa(FIN_H, 1), fa(16.6, 1)], F.gloss(SC.cheat));
      Q.text('380', c[0], c[1], 2.4, { color: SC.cheat, font: K.FONT.wide, weight: 700 });
    }
    Q.text(SC.reg, fa(5.6, 0.62)[0], fa(5.6, 0.62)[1], 0.42, { color: SC.style === 'house' ? '#ffffff' : '#ffffff', font: K.FONT.sans, weight: 700 });
    Q.fill([fa(3.5, 0), fa(18.2, 0), fa(18.2, 0.03), fa(3.5, 0.03)], metal);
    const fg = { px: 1.6, depth: 0.5, dark: 0.3 };
    Q.line([fa(4.6, 1), fa(4.6, 0.7), fa(11.0, 0.7), fa(11.0, 1)], fg); Q.line([fa(11.1, 1), fa(11.1, 0.7), fa(18.0, 0.7), fa(18.0, 1)], fg);
    const fl = { px: 1, depth: 0.18, dark: 0.07 };
    for (const y of [7.0, 9.0, 13.5, 15.8]) Q.line([fa(y, 0.7), fa(y, 1)], fl);
    for (const f of [0.22, 0.46]) Q.line([fa(3.6, f), fa(18.0, f)], fl);
    Q.noise({ alpha: 0.03, scale: 3 });
  }
}
const FIN_H = geometry.height - geometry.cgHeight - 0.05;
