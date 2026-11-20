// Boeing 737-800 — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (-2.9) when parked.
//
// Reference numbers (Boeing 737 airport-planning data, photos), body axes, d = distance aft of the nose tip (z = d - 18.4):
//   length 39.47 m (nose z -18.4 … rudder trailing edge z 21.07), span 35.79 m over blended winglets (34.32 m wing), height
//   12.55 m (fin tip y 9.65). Fuselage 3.76 m wide by 4.01 m high (crown y 2.455, keel y -1.555, widest at y 0.70), cabin floor
//   y ≈ 0, flight-deck floor y 0.12. Classic 707-family nose: pointed radome (tip y -0.30, joint d 1.6), windshield base
//   d 1.74 (y 1.0), three windows a side (No. 1 windshield with the V-shaped lower edge, No. 2 sliding window, No. 3 with the
//   sloping upper edge), eyebrow plugs above; pilot eye d 2.75 (refined in geometry.js), ~17° over-the-nose view.
//   Cabin windows 0.25 × 0.36 m at a 0.508 m (20 in) pitch, centre y 0.98, aligned on the two over-wing exits (z -1.16, -0.14);
//   doors L1/R1 z -14.25…-13.4, L2/R2 z 13.05…13.85; cargo doors right side z -10.6…-9.35 and 9.3…10.5.
//   Wing: root LE at the body side (x 1.88) z -3.62, LE sweep 27.5° (25° at quarter chord), 6° dihedral, Yehudi kink x 5.6,
//   tip x 17.16 (LE z 4.32, chord 1.3); 2.45 m blended winglets. Four slats outboard, Krueger flap inboard, double-slotted
//   flaps (inboard x 1.98–5.42, outboard 5.95–12.2), aileron 12.45–16.2, per wing 2 ground + 4 flight spoilers, 3 canoe
//   fairings. Tailplane span 14.35 m (LE sweep 33°), fin LE root z 12.5 with a long dorsal fillet from z 8.7.
//   CFM56-7B: centre x ±4.83, y -1.6, highlight z -5.45, fan Ø 1.55 m, flattened "hamster-pouch" inlet bottom, short pylon,
//   translating sleeve reverser, core cowl + exhaust plug; strake on the inboard side only.
//   Gear (geometry.js, unchanged): nose twin r 0.34 at z -14.4 retracting forward; main twin r 0.57 at x ±2.86, z 1.2,
//   retracting inboard into the wing-body fairing with the wheels left exposed (hub caps, no wheel doors, strut doors only).
// The airline liveries are invented for this simulator: they do not reproduce any real operator's name or marks.
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['aerolume', 'velora', 'house', 'vantaro'];

const SCHEMES = {
  aerolume: { name: 'Aerolume', title: 'AEROLUME', reg: 'ZZ-ALM', body: '#f4f5f3', belly: '#14264d', accent: '#d9a230', tail: '#14264d', engine: '#14264d', lip: '#d9a230', winglet: '#14264d', fair: '#14264d', titleColor: '#14264d', regColor: '#ffffff', font: 'wide', style: 'sweep' },
  velora: { name: 'Velora Air', title: 'velora', reg: 'ZZ-VLR', body: '#f6f6f4', belly: '#f6f6f4', accent: '#f0654a', tail: '#0c7c84', engine: '#0c7c84', lip: '#f0654a', winglet: '#f0654a', fair: '#c9ced2', titleColor: '#0c7c84', regColor: '#ffffff', font: 'round', style: 'ribbon' },
  house: { name: 'Factory demonstrator', title: 'SKYWARD 800', reg: 'ZZ-SKY', body: '#eef0f1', belly: '#8e979f', accent: '#1d6fd1', tail: '#eef0f1', engine: '#eef0f1', lip: '#1d6fd1', winglet: '#1d6fd1', fair: '#8e979f', titleColor: '#1d2a3a', regColor: '#1d2a3a', font: 'wide', style: 'bands' },
  vantaro: { name: 'Vantaro', title: 'VANTARO', reg: 'ZZ-VNT', body: '#f5f5f4', belly: '#2b2f36', accent: '#c4122f', tail: '#c4122f', engine: '#c4122f', lip: '#f5f5f4', winglet: '#c4122f', fair: '#2b2f36', titleColor: '#2b2f36', regColor: '#2b2f36', font: 'wide', style: 'star' },
};

// ---- fuselage station table -------------------------------------------------------------------------------------------------
//  d (from the nose)  y top   y keel   half-width  y widest   extra
const NOSE = [
  [0.00, -0.30, -0.30, 0.00, -0.30], [0.07, -0.13, -0.45, 0.16, -0.30], [0.25, 0.07, -0.62, 0.33, -0.28], [0.55, 0.33, -0.82, 0.55, -0.24],
  [0.95, 0.60, -1.00, 0.81, -0.16], [1.35, 0.83, -1.14, 1.03, -0.05, { sub: 3 }], [1.70, 1.00, -1.24, 1.20, 0.06, { sub: 4, kTop: [0.56, 0.6] }],
  [2.00, 1.30, -1.31, 1.33, 0.15, { sub: 4, kTop: [0.56, 0.62] }], [2.35, 1.66, -1.37, 1.46, 0.25, { sub: 4, kTop: [0.56, 0.6] }],
  [2.75, 1.96, -1.42, 1.59, 0.36, { sub: 5 }], [3.25, 2.19, -1.47, 1.70, 0.47, { sub: 6 }], [4.00, 2.36, -1.51, 1.80, 0.58],
  [5.00, 2.43, -1.54, 1.86, 0.66, { kBot: [0.565, 0.54] }], [6.40, 2.455, -1.555, 1.88, 0.70, { kBot: [0.575, 0.535] }],
];
//  z      y widest  half-width  top   bot  (top / bot relative to the widest point)
const TAIL = [
  [8.20, 0.70, 1.88, 1.755, 2.255], [10.50, 0.78, 1.80, 1.67, 2.08], [12.50, 0.93, 1.62, 1.51, 1.72], [14.50, 1.12, 1.33, 1.30, 1.30], [16.50, 1.34, 0.95, 1.04, 0.90],
  [18.30, 1.54, 0.55, 0.74, 0.56], [19.30, 1.62, 0.30, 0.50, 0.36], [19.62, 1.64, 0.19, 0.36, 0.26],
];

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'aerolume', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const rig = K.createRig(ctx, { geometry: G, name: 'b738', glassLayer: opts.glassLayer, cockpitRadius: 1.4 });
  const zd = (d) => G.noseZ + d;

  // CFM56-7B nacelle; a probe build (UVs = raw loft coordinates) measures the cowl / sleeve arc lengths for their charts
  const NAC = { length: 2.62, rHi: 0.83, rMax: 1.05, rThroat: 0.75, rFan: 0.775, zFan: 0.6, rExit: 0.9, flat: 0.3, droop: 0.035, sleeve: 0.55, core: { r0: 0.56, r1: 0.355, length: 1.15 }, plug: { r: 0.215, length: 0.74 } };
  const NS = nacelleArcs(NAC);

  // ---- atlases: A = fuselage + belly fairing + flight deck + gear, B = wings, tail, nacelles ------------------------------------
  const A = K.createAtlas({ size: atlasSize, base: F.gloss(SC.body), swatchRows: 6, skin: { weathering: 0.35, framePitch: 0.51 } });
  const cFus = A.chart('fus', { type: 'unwrap', z: [G.noseZ - 0.05, 19.7], girth: 12.2, vScale: 0.78, strips: 2 });
  const cFair = A.chart('fair', { type: 'plan', x: [-2.3, 2.3], z: [-7.1, 7.3], view: 'bottom', density: 0.55 });
  const cOver = A.chart('overhead', { type: 'rect', w: 0.62, h: 1.0, density: 1.5 });
  const cPed = A.chart('pedestal', { type: 'rect', w: 0.42, h: 0.9, density: 1.5 });
  A.pack();
  const UA = {
    body: A.swatch('body', F.gloss(SC.body)), fair: A.swatch('fair', F.gloss(SC.fair)), dark: A.swatch('dark', F.darkGrey), black: A.swatch('black', F.black),
    well: A.swatch('well', { color: '#8a8f86', rough: 0.68, metal: 0.05 }), wellDirty: A.swatch('wellDirty', { color: '#5d6058', rough: 0.75, metal: 0.05 }),
    liner: A.swatch('liner', { color: '#5d6166', rough: 0.8, metal: 0 }), post: A.swatch('post', { color: '#3a3d41', rough: 0.7, metal: 0 }),
    floor: A.swatch('floor', { color: '#2e3034', rough: 0.95, metal: 0 }), shield: A.swatch('shield', { color: '#1c1d1f', rough: 0.85, metal: 0 }), console: A.swatch('console', { color: '#50555b', rough: 0.75, metal: 0 }),
    seat: A.swatch('seat', { color: '#3e4146', rough: 0.85, metal: 0 }), sheep: A.swatch('sheep', { color: '#a59f8f', rough: 1, metal: 0 }), yoke: A.swatch('yoke', { color: '#141517', rough: 0.45, metal: 0 }),
    knob: A.swatch('knob', { color: '#d8d8d2', rough: 0.4, metal: 0 }), lever: A.swatch('lever', { color: '#9aa0a5', rough: 0.3, metal: 0.8 }),
    exhaust: A.swatch('exhaust', F.exhaust), steel: A.swatch('steel', F.steel), lens: A.swatch('lens', F.lens), antenna: A.swatch('antenna', F.gloss('#e9e9e6')),
    strut: A.swatch('gear.strut', F.gearWhite), hyd: A.swatch('hyd', { color: '#2a2b2d', rough: 0.5, metal: 0.4 }), rubber: A.swatch('rubber', F.rubber),
    dielectric: A.swatch('dielectric', F.composite('#d9dbd8')), skid: A.swatch('skid', { color: '#5a5d60', rough: 0.5, metal: 0.8 }),
  };
  const WG = '#b9bdc0';
  const B = K.createAtlas({ size: atlasSize, base: F.semigloss(WG), swatchRows: 5, skin: { weathering: 0.45, framePitch: 0.55 } });
  const cWT = B.chart('wingTop', { type: 'plan', x: [1.6, 17.4], z: [-4.3, 6.6], view: 'top', mirror: true });
  const cWB = { R: B.chart('wingBotR', { type: 'plan', x: [1.6, 17.4], z: [-4.3, 6.6], view: 'bottom', density: 0.62 }), L: B.chart('wingBotL', { type: 'plan', x: [-17.4, -1.6], z: [-4.3, 6.6], view: 'bottom', density: 0.62 }) };
  const cWl = { L: B.chart('wingletL', { type: 'side', z: [3.9, 8.8], y: [0.3, 3.7], view: 'left' }), R: B.chart('wingletR', { type: 'side', z: [3.9, 8.8], y: [0.3, 3.7], view: 'right' }) };
  const cSt = B.chart('stab', { type: 'plan', x: [0.3, 7.4], z: [15.2, 21.2], view: 'top', mirror: true, density: 0.8 });
  const cFin = { L: B.chart('finL', { type: 'side', z: [8.6, 21.15], y: [2.2, 9.75], view: 'left' }), R: B.chart('finR', { type: 'side', z: [8.6, 21.15], y: [2.2, 9.75], view: 'right' }) };
  const cNac = B.chart('nac', { type: 'unwrap', z: [0, NS.cowlMax], girth: 6.6, vScale: 0.85, density: 0.95 });
  const cSlv = B.chart('sleeve', { type: 'unwrap', z: [0, NS.sleeveMax], girth: 6.4, vScale: 0.85, density: 0.95 });
  B.pack();
  const UB = {
    grey: B.swatch('grey', F.semigloss(WG)), engine: B.swatch('engine', F.gloss(SC.engine)), duct: B.swatch('duct', { color: '#16171a', rough: 0.6, metal: 0.25 }),
    acoustic: B.swatch('acoustic', { color: '#7e8286', rough: 0.6, metal: 0.5 }), core: B.swatch('core', F.semigloss('#a9adb0')), coreMetal: B.swatch('coreMetal', F.titanium),
    plug: B.swatch('plug', F.heatStained), blade: B.swatch('blade', { color: '#6b6f75', rough: 0.26, metal: 0.85 }), spinner: B.swatch('spinner', { color: '#2b2d31', rough: 0.3, metal: 0.6 }),
    swirl: B.swatch('swirl', { color: '#f0f0ee', rough: 0.3, metal: 0 }), inner: B.swatch('inner', F.primer), pylon: B.swatch('pylon', F.semigloss('#c3c6c8')),
    tail: B.swatch('tail', F.gloss(SC.tail)), cascade: B.swatch('cascade', { color: '#3a3c3f', rough: 0.6, metal: 0.7 }), wick: B.swatch('wick', F.black),
    canoe: B.swatch('canoe', F.semigloss('#b3b7ba')), metal: B.swatch('metal', { color: '#c9ccce', rough: 0.28, metal: 0.9 }), soot: B.swatch('soot', { color: '#4a4744', rough: 0.6, metal: 0.4 }),
    lens: B.swatch('lens', F.lens),
  };

  // ---- fuselage ---------------------------------------------------------------------------------------------------------------
  const st = (z, top, bot, w, yc, extra) => ({ z, y: yc, w, top: Math.max(0, top - yc), bot: Math.max(0, yc - bot), ...(extra || {}) });
  const FS = [
    ...NOSE.map(([d, top, bot, w, yc, ex]) => st(zd(d), top, bot, w, yc, ex)),
    ...TAIL.map(([z, yc, w, top, bot], i) => ({ z, y: yc, w, top, bot, ...(i === 0 ? { kBot: [0.575, 0.535] } : {}) })),
  ];
  const fseg = Math.max(40, Math.round(96 * detail / 4) * 4);
  const fus = K.loft({
    stations: FS, segments: fseg, step: 1.3 / detail, chart: cFus, capEnd: 'flat', capUV: UA.exhaust,
    cutouts: [{ name: 'ngd', z: [-15.75, -13.95], t: [0, 0.026], mirror: true }],
  });
  cFus.body = fus;
  let captainMesh = null;
  const stA = new K.Mesh(), stB = new K.Mesh(), glass = new K.Mesh();
  stA.add(K.well(K.merge(fus.patches.ngdR, fus.patches.ngdL), 0.75, UA.well, [0, 1, 0]));
  const tAtXu = (z, x) => { let lo = 0.25, hi = 0.5; for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (fus.at(z, m).p[0] > x) lo = m; else hi = m; } return (lo + hi) / 2; };
  const zy = (d, y) => [zd(d), fus.tAtY(zd(d), y)], zx = (d, x) => [zd(d), tAtXu(zd(d), x)];

  // flight-deck windows (right side, (z, t) corners): No. 1 windshield, No. 2 sliding window, No. 3 with the sloping top
  const WS = { IB: zx(1.74, 0.055), OB: zy(2.14, 1.0), OT: zy(2.5, 1.66), IT: zx(2.3, 0.055) };
  const S1 = { bf: zy(2.24, 1.0), br: zy(2.98, 0.98), tr: zy(2.98, 1.64), tf: zy(2.62, 1.68) };
  const S2 = { bf: zy(3.08, 0.98), br: zy(3.62, 0.99), tr: zy(3.62, 1.42), tf: zy(3.08, 1.64) };
  const WIN = [[WS.IB, WS.OB, WS.OT, WS.IT], [S1.bf, S1.br, S1.tr, S1.tf], [S2.bf, S2.br, S2.tr, S2.tf]];
  // real glass: cut the skin cells that lie wholly inside a window (the painted dark frame keeps the stepped edge invisible)
  // and lay a smooth pane over the opening, so the flight deck shows from outside
  {
    const s0 = cFus.strips[0], S = A.size, m = fus.mesh, idx = m.idx, keep = [];
    const polys = [];
    for (const w of WIN) { polys.push(w); polys.push(w.map(([z, t]) => [z, 1 - t])); }
    const tOf = (i) => ((1 - m.uv[i * 2 + 1]) * S - s0.ty) / s0.sy;
    const zMax = Math.max(...WIN.flat().map(p => p[0])) + 0.05;
    for (let k = 0; k < idx.length; k += 3) {
      const a = idx[k], b = idx[k + 1], c = idx[k + 2];
      let cut = false;
      if (m.p[a * 3 + 2] < zMax && m.p[b * 3 + 2] < zMax && m.p[c * 3 + 2] < zMax) {
        const q = [a, b, c].map(i => [m.p[i * 3 + 2], tOf(i)]);
        for (const pg of polys) if (q.every(pt => inPoly(pt, pg))) { cut = true; break; }
      }
      if (!cut) keep.push(a, b, c);
    }
    m.idx = keep;
    for (const w of WIN) for (const side of [1, -1]) glass.add(skinPatch(fus, side > 0 ? w : w.map(([z, t]) => [z, 1 - t]), 0.004, [0, 0], 6, 6));
  }
  stA.add(fus.mesh);

  // wing-to-body fairing (bulged, flat-bottomed) with the main-gear bays cut into its bottom
  const fairStations = [[-6.9, 0.3, 0.12, 0.16], [-6.0, 1.05, 0.34, 0.4], [-4.9, 1.7, 0.5, 0.56], [-3.6, 2.08, 0.6, 0.62], [-1.0, 2.2, 0.64, 0.63], [2.4, 2.2, 0.64, 0.63], [4.3, 2.0, 0.55, 0.6], [5.9, 1.45, 0.4, 0.52], [7.0, 0.8, 0.26, 0.36], [7.7, 0.3, 0.12, 0.16]]
    .map(r => ({ z: r[0], y: -0.96, w: r[1], top: r[2], bot: r[3], kTop: 0.66, kBot: [0.93, 0.5523] }));
  const fairOpts = { stations: fairStations, segments: Math.max(24, Math.round(44 * detail / 4) * 4), step: 0.7, chart: cFair };
  let fair = K.loft(fairOpts);
  const fAtX = (x) => { let lo = 0, hi = 0.25; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (fair.at(1.2, m).p[0] < x) lo = m; else hi = m; } return (lo + hi) / 2; };
  fair = K.loft({ ...fairOpts, cutouts: [{ name: 'bay', z: [0.52, 1.88], t: [fAtX(0.86), fAtX(2.16)], mirror: true }] });
  stA.add(fair.mesh).add(K.well(fair.patches.bayR, 0.62, UA.well, [0, 1, 0])).add(K.well(fair.patches.bayL, 0.62, UA.well, [0, 1, 0]));
  // wheel-well structure: ribs across the roof, an actuator and hydraulic lines (seen past the exposed tyres)
  for (const sx of [-1, 1]) {
    for (const z of [0.68, 1.2, 1.72]) stA.add(K.box(1.2, 0.05, 0.035, UA.wellDirty).translate(sx * 1.51, -0.43, z));
    stA.add(K.tube([sx * 0.95, -0.5, 0.75], [sx * 2.0, -0.62, 1.55], 0.045, 0.04, { segments: 8, uv: UA.steel }));
    for (const dz of [-0.08, 0.06]) stA.add(K.pipe([[sx * 0.92, -0.46, 1.0 + dz], [sx * 1.5, -0.45, 1.05 + dz], [sx * 2.1, -0.5, 0.9 + dz]], 0.012, { uv: UA.hyd, segments: 5 }));
  }
  // air-conditioning ram-air inlets: shallow scoops in the fairing ahead of the wing
  for (const sx of [-1, 1]) {
    const p = fair.at(-4.6, sx > 0 ? 0.08 : 0.92).p;
    stA.add(K.prism([[-5.05, p[1] - 0.005], [-4.2, p[1] - 0.005], [-4.25, p[1] - 0.075], [-4.55, p[1] - 0.085]], p[0] - 0.2, p[0] + 0.2, UA.fair));
    stA.add(K.box(0.36, 0.06, 0.02, UA.black).translate(p[0], p[1] - 0.045, -4.565));
  }

  // ---- flight deck: three windows a side, lined inside so the pilot looks out through the gaps --------------------------------
  const FLOOR = 0.12, zb = zd(4.0), zP = zd(2.2), eye = G.pilotEye, cab = new K.Mesh();
  {
    const L = (c, uv, nu = 3, nv = 3) => cab.add(K.liner(fus, c, { uv, nu, nv, mirror: true, inset: 0.05 }));
    const lo = (z) => [z, fus.tAtY(z, FLOOR + 0.04)], hi = (z) => [z, 0.5];
    L([WS.IB, WS.OB, lo(WS.OB[0]), lo(WS.IB[0])], UA.liner, 2, 5);                     // below the windshield
    L([WS.IB, hi(WS.IB[0]), hi(WS.IT[0]), WS.IT], UA.post, 4, 1);                       // centre post
    L([hi(WS.IT[0]), WS.IT, WS.OT, hi(WS.OT[0])], UA.liner, 3, 2);                      // roof above the windshield
    L([WS.OB, S1.bf, S1.tf, WS.OT], UA.post, 1, 4);                                      // corner post
    L([WS.OT, S1.tf, hi(S1.tf[0]), hi(WS.OT[0])], UA.liner, 1, 3);
    L([lo(WS.OB[0]), lo(S1.bf[0]), S1.bf, WS.OB], UA.liner, 1, 3);
    L([lo(S1.bf[0]), lo(S1.br[0]), S1.br, S1.bf], UA.liner, 4, 3);                      // No. 2 sill / header, post to No. 3
    L([S1.tf, S1.tr, hi(S1.tr[0]), hi(S1.tf[0])], UA.liner, 3, 3);
    L([S1.br, S2.bf, S2.tf, S1.tr], UA.post, 1, 4);
    L([lo(S1.br[0]), lo(S2.bf[0]), S2.bf, S1.br], UA.liner, 1, 3);
    L([S1.tr, S2.tf, hi(S2.tf[0]), hi(S1.tr[0])], UA.liner, 1, 3);
    L([lo(S2.bf[0]), lo(S2.br[0]), S2.br, S2.bf], UA.liner, 3, 3);                      // No. 3 sill, sloping header, aft wall
    L([S2.tf, S2.tr, hi(S2.tr[0]), hi(S2.tf[0])], UA.liner, 3, 3);
    L([lo(S2.br[0]), lo(zb), hi(zb), hi(S2.br[0])], UA.liner, 3, 6);
    cab.add(K.deck(fus, WS.IB[0] - 0.02, zb, FLOOR, { uv: UA.floor, n: 8 }));
    cab.add(K.bulkhead(fus, zb, { uv: UA.liner, facing: -1 }));                          // flight-deck door wall
    cab.add(K.bulkhead(fus, WS.IB[0] - 0.02, { uv: UA.shield, facing: 1 }));             // forward wall in the nose
    // main instrument panel (kit: PFD outboard + ND inboard per pilot, upper EICAS + standby in the centre, lit by day) under the
    // MCP glareshield; pedestal with thrust / flap / speedbrake levers
    const eL = [-Math.abs(eye[0]), eye[1], eye[2]], eR = [Math.abs(eye[0]), eye[1], eye[2]];
    const panelMesh = K.instrumentPanel({ eyes: [eL, eR], kind: 'airline', hoodTaper: 0.5, dist: 0.62, drop: 0.54, height: 0.5, width: 1.8, uv: UA.shield });
    cab.add(panelMesh);
    cab.add(K.box(0.42, 0.7, 1.0, UA.console).translate(0, FLOOR + 0.35, zP + 0.62));
    { const i0 = cab.vertexCount; for (const [a, b] of [[0, 0], [0.42, 0], [0.42, 0.9], [0, 0.9]]) { const uv = cPed.uv(a, b); cab.vert(a - 0.21, FLOOR + 0.76 - b * 0.067, zP + 0.14 + b * 0.94, 0, 1, 0.07, uv[0], uv[1]); } cab.quad(i0, i0 + 3, i0 + 2, i0 + 1); }
    for (const [x, h, uv] of [[-0.05, 0.2, UA.yoke], [0.05, 0.2, UA.yoke], [-0.17, 0.14, UA.lever], [0.17, 0.14, UA.lever]]) {
      const base = [x, FLOOR + 0.72, zP + 0.42], top = [x, base[1] + h, base[2] + 0.06];
      cab.add(K.tube(base, top, 0.008, 0.008, { segments: 5, uv: UA.lever })).add(K.box(x === -0.05 || x === 0.05 ? 0.07 : 0.05, 0.035, 0.035, uv).translate(top[0], top[1], top[2]));
    }
    cab.add(K.box(0.36, 0.14, 0.08, UA.shield).translate(0, FLOOR + 0.72, zP + 0.34));
    { const i0 = cab.vertexCount, ys = (b) => 1.6 + b * 0.43; for (const [a, b] of [[0, 0], [0.62, 0], [0.62, 1.0], [0, 1.0]]) { const uv = cOver.uv(a, b); cab.vert(a - 0.31, ys(b), zd(2.5) + b, 0, -0.92, 0.4, uv[0], uv[1]); } cab.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    for (const sx of [-1, 1]) {
      const e = [sx * Math.abs(eye[0]), eye[1], eye[2]];
      cab.add(K.crewSeat({ eye: e, uv: { frame: UA.seat, cushion: UA.sheep } }));
      const crew = K.pilot({ eye: e, kind: 'airline', recline: 8, stick: [0.17, -0.44, -0.43], throttle: [-0.17, -0.44, -0.43], uv: { suit: UA.seat, helmet: UA.seat, dark: UA.seat } }); if (sx < 0) captainMesh = crew; else cab.add(crew);   // the captain is its own part, hidden from the cockpit camera   // hands on the yoke horns
      cab.add(K.yoke({ base: [e[0], FLOOR, e[2] - 0.52], top: [e[0], e[1] - 0.5, e[2] - 0.44], uv: UA.yoke }));
      cab.add(K.box(0.26, 0.55, 1.1, UA.console).translate(sx * 1.18, FLOOR + 0.28, e[2] + 0.1));                        // side console
      cab.add(K.box(0.22, 0.03, 0.12, UA.shield).translate(e[0] - 0.1, FLOOR + 0.12, zP + 0.18));            // rudder pedals
      cab.add(K.box(0.22, 0.03, 0.12, UA.shield).translate(e[0] + 0.1, FLOOR + 0.12, zP + 0.18));
      cab.add(K.box(0.04, 0.12, 0.04, UA.yoke).translate(sx * 1.1, FLOOR + 0.62, e[2] - 0.2));                         // tiller
    }
  }
  stA.add(cab.occlude(0.35));
  // windshield wipers parked along the lower frame of each front pane
  for (const sx of [1, -1]) {
    const m = (p) => [p[0], sx > 0 ? p[1] : 1 - p[1]];
    const a = fus.at(...m([WS.OB[0] - 0.06, WS.OB[1] + 0.012])), b = fus.at(...m([WS.IB[0] + 0.12, WS.IB[1] - 0.01]));
    const off = (q, k) => [q.p[0] + q.n[0] * k, q.p[1] + q.n[1] * k, q.p[2] + q.n[2] * k];
    stA.add(K.tube(off(a, 0.03), off(b, 0.02), 0.009, 0.007, { segments: 5, uv: UA.black })).add(K.tube(off(a, 0.0), off(a, 0.035), 0.022, 0.022, { segments: 8, uv: UA.black }));
  }

  // ---- wings ----------------------------------------------------------------------------------------------------------------
  const zLE = (x) => -4.6 + 0.52 * x, zTE = (x) => (x < 5.6 ? 2.7 - 0.043 * x : 2.46 + (x - 5.6) * 0.295), wy = (x) => -1.12 + 0.105 * x;
  const wst = (x, tc, twist) => ({ x, y: wy(x), z: zLE(x), chord: zTE(x) - zLE(x), tc, twist });
  const sc = K.supercritical();
  const SPOIL = { GI: [2.25, 3.72], F1: [3.78, 5.3], F2: [6.1, 7.75], F3: [7.8, 9.45], F4: [9.5, 11.0], GO: [11.06, 12.05] };
  const wingOf = (side) => K.wing({
    side, airfoil: sc, chordPts: Math.round(15 * Math.min(1, detail)), spanAxis: 'x', tip: 'none',
    stations: [wst(1.0, 0.15, 2), wst(1.88, 0.145, 1.8), wst(5.6, 0.125, 0.8), wst(11.4, 0.11, -0.8), wst(17.16, 0.10, -2)],
    lines: { slat: [[1.0, 0.11], [5.6, 0.13], [17.16, 0.17]], spoil: [[1.0, 0.6], [5.6, 0.56], [17.16, 0.58]], flap: [[1.0, 0.74], [5.6, 0.7], [17.16, 0.72]], aft: [[1.0, 0.9], [5.6, 0.88], [17.16, 0.89]] },
    controls: [
      { name: 'flapIn', type: 'flap', span: [1.98, 5.42], from: 'flap', to: 'aft', nose: 1, tail: 0.6 },
      { name: 'aftIn', type: 'flap', span: [1.98, 5.42], from: 'aft', nose: 1 },
      { name: 'flapOut', type: 'flap', span: [5.95, 12.2], from: 'flap', to: 'aft', nose: 1, tail: 0.6 },
      { name: 'aftOut', type: 'flap', span: [5.95, 12.2], from: 'aft', nose: 1 },
      { name: 'aileron', type: 'flap', span: [12.45, 16.2], from: 'flap', nose: 1 },
      { name: 'slat', type: 'flap', span: [6.25, 16.75], to: 'slat', tail: 0.4, cove: true },
      { name: 'krueger', type: 'panel', surface: 'lower', span: [2.1, 4.75], to: 'slat', hinge: 'front', thickness: 0.03 },
      ...Object.entries(SPOIL).map(([k, s]) => ({ name: 'sp' + k, type: 'panel', surface: 'upper', span: s, from: 'spoil', to: 'flap', hinge: 'front' })),
    ],
    charts: { upper: cWT, lower: side > 0 ? cWB.R : cWB.L }, innerUV: UB.inner, edgeUV: UB.grey,
  });
  const W = { R: wingOf(1), L: wingOf(-1) };
  stB.add(W.R.mesh).add(W.L.mesh);
  const tipSt = wst(17.16, 0.10, -2);
  for (const side of [1, -1]) {
    stB.add(K.wing({ side, airfoil: sc, chordPts: 9, spanAxis: 'u', tip: 'round', tipLength: 0.6, charts: side > 0 ? { upper: cWl.L, lower: cWl.R } : { upper: cWl.R, lower: cWl.L }, edgeUV: UB.metal,
      stations: [tipSt, ...K.blendedWinglet(tipSt, { height: 2.45, cant: 12, radius: 0.85, sweep: 58, tipChord: 0.62, tc: 0.075, n: 7, dihedral: 6 })] }).mesh);
  }
  // flap-track fairings ("canoes"): front part fixed under the wing, rear part rides on the flap
  const canoeAt = (x, len, side) => {
    const zf = W.R.at(x, 0.74, 'lower'), z0 = zf[2] - len * 0.45, y = zf[1] - 0.06;
    const s = [[0, 0.01, 0.01], [0.12, 0.1, 0.13], [0.35, 0.15, 0.24], [0.6, 0.15, 0.25], [0.85, 0.1, 0.17], [1, 0.012, 0.03]].map(r => ({ z: z0 + r[0] * len, x: side * x, y: y - r[2] * 0.5 + (r[0] > 0.6 ? (r[0] - 0.6) * 0.25 : 0), w: r[1], top: r[2] * 0.6, bot: r[2] }));
    const split = zf[2] + 0.1;
    return { front: K.loft({ stations: s, segments: 12, step: 0.3, uv: UB.canoe, zRange: [z0, split] }).mesh, rear: K.loft({ stations: s, segments: 12, step: 0.3, uv: UB.canoe, zRange: [split, z0 + len], capStart: 'flat' }).mesh };
  };

  // ---- tail -------------------------------------------------------------------------------------------------------------------
  const sy = (x) => 1.72 + (x - 0.4) * Math.tan(7 * DEG);
  const stabOf = (side) => K.wing({
    side, airfoil: K.naca4('0010'), chordPts: Math.round(11 * Math.min(1, detail)), spanAxis: 'x', tip: 'round', tipLength: 0.5,
    stations: [{ x: 0.4, y: sy(0.4), z: 15.3, chord: 4.0, tc: 0.1 }, { x: 7.17, y: sy(7.17), z: 19.75, chord: 1.3, tc: 0.09 }],
    lines: { hinge: [[0.4, 0.7], [7.17, 0.7]] },
    controls: [{ name: 'elevator', type: 'flap', span: [1.25, 7.0], from: 'hinge', nose: 1 }],
    charts: { upper: cSt, lower: cSt }, edgeUV: UB.metal,
  });
  const stab = { R: stabOf(1), L: stabOf(-1) };
  stB.add(stab.R.mesh).add(stab.L.mesh);
  const fin = K.wing({
    airfoil: K.naca4('0010'), chordPts: Math.round(13 * Math.min(1, detail)), spanAxis: 'y', tip: 'round', tipLength: 0.5,
    stations: [{ x: 0, y: 2.3, z: 12.5, chord: 6.3, tc: 0.11 }, { x: 0, y: 9.65, z: 19.0, chord: 1.9, tc: 0.09 }],
    lines: { hinge: [[2.3, 0.69], [9.65, 0.69]] },
    controls: [{ name: 'rudder', type: 'flap', span: [2.75, 9.45], from: 'hinge', nose: 1 }],
    charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.metal,
  });
  stB.add(fin.mesh);
  stB.add(K.wing({ airfoil: K.naca4('0008'), chordPts: 7, spanAxis: 'y', tip: 'flat', charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.tail,       // dorsal fillet
    stations: [{ x: 0, y: 2.3, z: 8.7, chord: 6.0, tc: 0.02 }, { x: 0, y: 3.35, z: 13.35, chord: 1.4, tc: 0.09 }] }).mesh);

  // ---- engines: CFM56-7B ----------------------------------------------------------------------------------------------------
  const eng = [];
  for (const [i, sx] of [[0, -1], [1, 1]]) {
    const c = [sx * 4.83, -1.6, -5.45];
    const n = K.nacelle({ centre: c, ...NAC, segments: Math.max(28, Math.round(48 * detail / 4) * 4), chart: cNac, sleeveChart: cSlv,
      uvInner: UB.acoustic, uvCore: UB.core, uvPlug: UB.plug, uvCascade: UB.cascade });
    stB.add(n.cowl).add(n.cascade).add(n.core).add(n.plug);
    // bare-metal core nozzle ring and the turbine exhaust case behind it
    { const z1 = NAC.length + NAC.core.length, r1 = NAC.core.r1; stB.add(K.lathe([[r1 * 1.1, z1 - 0.42], [r1 + 0.012, z1 + 0.005, 1], [r1 - 0.02, z1 + 0.005, 1]], { segments: 40, uv: UB.coreMetal }).translate(c[0], c[1], c[2])); }
    stB.add(K.fanBackdrop(NAC.rFan, 0.4, UB.duct).translate(c[0], c[1], n.fanZ));
    // short pylon: aft fairing over the core, strut blended into the wing lower surface
    stB.add(K.pylon([{ y: c[1] + 0.5, z0: c[2] + 3.0, z1: c[2] + 4.95, x: c[0], tc: 0.13 }, { y: c[1] + 0.9, z0: c[2] + 0.55, z1: c[2] + 5.3, x: c[0], tc: 0.1 }, { y: c[1] + 1.12, z0: c[2] + 0.75, z1: c[2] + 5.5, x: c[0], tc: 0.085 }], { uv: UB.pylon }));
    // nacelle strake on the inboard side only
    { const s2 = -sx; stB.add(K.plate([c[0] + s2 * 0.93, c[1] + 0.56, c[2] + 0.8], [c[0] + s2 * 0.93, c[1] + 0.56, c[2] + 1.6], [c[0] + s2 * 1.2, c[1] + 0.74, c[2] + 1.66], [c[0] + s2 * 1.16, c[1] + 0.71, c[2] + 1.0], 0.012, UB.engine)); }
    eng.push({ c, n, fanMesh: cfmFan({ radius: NAC.rFan - 0.012, hub: 0.27, blades: 24, uvBlade: UB.blade, uvSpinner: UB.spinner, uvSwirl: UB.swirl }) });
  }

  // ---- small details ----------------------------------------------------------------------------------------------------------
  const onTop = (z) => [0, fus.topAt(z) - 0.02, z], onBot = (z) => [0, fus.botAt(z) + 0.02, z];
  for (const [z, h, c] of [[-10.6, 0.3, 0.42], [3.2, 0.3, 0.42]]) stA.add(K.bladeAntenna({ pos: onTop(z), height: h, chord: c, sweep: 0.2, uv: UA.antenna }));   // VHF 1 / 3
  stA.add(K.bladeAntenna({ pos: onTop(-12.2), height: 0.1, chord: 0.22, sweep: 0.06, uv: UA.antenna }));                                                    // TCAS
  stA.add(K.ellipsoid(0.42, 0.11, 1.15, { segments: 14, rings: 6, uv: UA.dielectric }).translate(0, fus.topAt(5.6) - 0.03, 5.6));                    // satcom / connectivity radome
  stA.add(K.ellipsoid(0.07, 0.025, 0.1, { segments: 8, rings: 3, uv: UA.antenna }).translate(0, fus.topAt(-3.6) - 0.005, -3.6));                     // GPS
  for (const [z, h, c] of [[-11.2, 0.28, 0.4], [9.0, 0.28, 0.4]]) stA.add(K.bladeAntenna({ pos: onBot(z), height: h, chord: c, sweep: 0.18, down: true, uv: UA.antenna }));
  for (const z of [-12.6, -7.6, 6.8]) stA.add(K.bladeAntenna({ pos: onBot(z), height: 0.1, chord: 0.16, sweep: 0.04, down: true, uv: UA.antenna }));          // ATC / DME / marker
  for (const z of [-8.4, 11.6]) stA.add(K.bladeAntenna({ pos: onBot(z), height: 0.2, chord: 0.12, sweep: 0.14, thickness: 0.025, down: true, uv: UA.steel }));   // drain masts
  // pitot probes, angle-of-attack vanes, TAT probe (left)
  for (const sx of [-1, 1]) {
    const pt = (d, y) => { const z = zd(d), t = fus.tAtY(z, y); return fus.at(z, sx > 0 ? t : 1 - t); };
    for (const [d, y] of [[2.85, 0.42], [3.05, 0.16]]) { const q = pt(d, y), p = q.p, b = [p[0] + q.n[0] * 0.12, p[1] + q.n[1] * 0.12 - 0.01, p[2] + q.n[2] * 0.12]; stA.add(K.tube(p, b, 0.016, 0.01, { segments: 6, uv: UA.steel })).add(K.tube(b, [b[0], b[1], b[2] - 0.17], 0.009, 0.007, { segments: 6, uv: UA.steel })); }
    { const q = pt(3.35, -0.06), p = q.p; stA.add(K.prism([[p[2] - 0.05, 0], [p[2] + 0.05, 0], [p[2] + 0.07, -0.01], [p[2] - 0.02, -0.06]], -0.004, 0.004, UA.black).rotateZ(Math.PI / 2 * sx).translate(p[0], p[1], 0)); }
    if (sx < 0) { const q = pt(3.7, -0.48), p = q.p; stA.add(K.prism([[p[2] - 0.04, 0], [p[2] + 0.07, 0], [p[2] + 0.06, -0.07], [p[2] - 0.0, -0.09]], -0.008, 0.008, UA.steel).rotateZ(-Math.PI / 2).translate(p[0], p[1], 0)); }
  }
  // APU exhaust nozzle at the tail-cone tip; tail skid under the aft body
  stA.add(K.lathe([[0.17, 19.5], [0.175, 19.74, 1], [0.15, 19.74, 1], [0.14, 19.45]], { segments: 18, uv: UA.exhaust }).translate(0, 1.64, 0).occlude(0.5));
  { const z = 12.9, yb = fus.botAt(z); stA.add(K.prism([[z - 0.55, yb + 0.06], [z + 0.6, yb + 0.06], [z + 0.35, yb - 0.17], [z - 0.3, yb - 0.17]], -0.09, 0.09, UA.strut)); stA.add(K.box(0.2, 0.04, 0.5, UA.skid).translate(0, yb - 0.19, z + 0.02)); }
  // elevator-feel pitots on the fin
  for (const sx of [-1, 1]) { const p = fin.at(4.4, 0.18, 'mid'); stB.add(K.tube([sx * 0.18, p[1], p[2] + 0.05], [sx * 0.2, p[1], p[2] - 0.18], 0.01, 0.008, { segments: 5, uv: UB.metal })); }
  { const wicks = [];
    for (const sx of [-1, 1]) {
      for (const x of [13.2, 14.4, 15.6]) { const p = W.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); }
      for (const x of [4.6, 5.8, 6.8]) { const p = stab.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); }
    }
    for (const y of [7.4, 8.6, 9.3]) wicks.push(fin.at(y, 1, 'mid'));
    stB.add(K.staticWicks(wicks, 0.2, UB.wick)); }

  lap('geometry');
  // ---- paint + materials ------------------------------------------------------------------------------------------------------
  const DOORS = { fwd: [-14.25, -13.4], aft: [13.05, 13.85], owe: [[-1.42, -0.9], [-0.4, 0.12]], cargo: [[-10.6, -9.35], [9.3, 10.5]] };
  paintFuselage(A, { SC, fus, cFus, WIN, zd, DOORS });
  paintFairing(A, { SC, fair, cFair });
  paintPanels(A, { cOver, cPed });
  paintSurfaces(B, { SC, W: W.R, fin, stab: stab.R, cWT, cWB, cWl, cSt, cFin, SPOIL });
  paintNacelle(B, { SC, cNac, cSlv, NS, NAC });
  lap('paint');
  const matA = A.material(ctx, { envMapIntensity: 1, emissiveIntensity: 0, skin: { waviness: 1.15 } }), matB = B.material(ctx, { envMapIntensity: 1, emissiveIntensity: 0 });
  lap('textures');
  rig.material('paint', matA, { shared: true }); rig.material('wing', matB, { shared: true });
  const captainNode = captainMesh && rig.part('captain', captainMesh, { pivot: G.pilotEye });
  rig.glass('glass', K.glassMaterial(ctx, { ...K.GLASS.airliner, dust: 0.03 }));
  rig.disposables.push(A, B);

  // ---- moving surfaces --------------------------------------------------------------------------------------------------------
  const drop = (ctrl, d, aft = 0) => { const u = ctrl.up, h = ctrl.hinge, o = [-u[0] * d, -u[1] * d, -u[2] * d + aft]; return { a: [h.a[0] + o[0], h.a[1] + o[1], h.a[2] + o[2]], b: [h.b[0] + o[0], h.b[1] + o[1], h.b[2] + o[2]] }; };
  const hingeOn = (name, mesh, line, ref, toward, parent) => { const node = rig.part(name, mesh, { key: 'wing', pivot: line.a, parent }); return rig.hinge(node, line.a, line.b, { ref, toward }); };
  const DOWN = [0, -1, 0], UP = [0, 1, 0];
  const wingAnim = [];
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const C = W[key].controls, a = {};
    for (const [nm, xs] of [['In', [3.9]], ['Out', [7.4, 10.9]]]) {
      const main = C['flap' + nm], aft = C['aft' + nm], mesh = main.mesh.clone();
      for (const x of xs) { const cn = canoeAt(x, nm === 'In' ? 2.3 : 2.0 - (x - 7) * 0.08, sx); stB.add(cn.front); mesh.add(cn.rear); }
      const line = drop(main, 0.5, 0.05), node = rig.part(`flap${nm}${key}`, mesh, { key: 'wing', pivot: line.a });
      a['flap' + nm] = rig.hinge(node, line.a, line.b, { ref: main.ref, toward: DOWN });
      const l2 = drop(aft, 0.16); a['aft' + nm] = hingeOn(`aftFlap${nm}${key}`, aft.mesh, l2, aft.ref, DOWN, node);
    }
    a.aileron = rig.hingePart('aileron' + key, C.aileron, { key: 'wing' }).set;
    a.slat = hingeOn('slat' + key, C.slat.mesh, drop(C.slat, 0.34, 0.1), C.slat.ref, DOWN);
    a.krueger = hingeOn('krueger' + key, C.krueger.mesh, C.krueger.hinge, C.krueger.ref, DOWN);
    a.spGI = hingeOn('spoilerGroundIn' + key, C.spGI.mesh, C.spGI.hinge, C.spGI.ref, UP);
    a.spGO = hingeOn('spoilerGroundOut' + key, C.spGO.mesh, C.spGO.hinge, C.spGO.ref, UP);
    { const m = new K.Mesh(); for (const k of ['F1', 'F2', 'F3', 'F4']) m.add(C['sp' + k].mesh);
      a.spF = hingeOn('spoilerFlight' + key, m, { a: C.spF1.hinge.a, b: C.spF4.hinge.b }, C.spF2.ref, UP); }
    a.elev = rig.hingePart('elevator' + key, stab[key].controls.elevator, { key: 'wing' }).set;
    a.key = key; wingAnim.push(a);
  }
  const rud = rig.hingePart('rudder', fin.controls.rudder, { key: 'wing', toward: [1, 0, 0] });
  const fans = [], sleeves = [];
  eng.forEach((e, i) => {
    fans.push(rig.part('fan' + i, e.fanMesh.translate(e.c[0], e.c[1], e.n.fanZ), { key: 'wing', pivot: [e.c[0], e.c[1], e.n.fanZ] }));
    sleeves.push({ node: rig.part('reverser' + i, e.n.sleeve, { key: 'wing', pivot: e.c, ao: false }), travel: e.n.sleeveTravel });
  });
  rig.addStatic(stA, 'paint'); rig.addStatic(stB, 'wing'); rig.addStatic(glass, 'glass');

  // ---- landing gear -----------------------------------------------------------------------------------------------------------
  const gp = G.gear, gearUV = { strut: UA.strut };
  const doorOf = (patch, edge) => ({ mesh: K.thicken(patch, 0.025, UA.well), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  K.buildGear(rig, A, {
    name: 'nose', index: 0, contact: gp[0].pos, wheels: [-0.2, 0.2], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.2, pivot: [0, -1.22, -14.25], stroke: 0.3, staticFrac: 0.4,
    strutR: 0.065, steer: true, links: 'front', retract: { to: [0, -1.12, -15.75] }, window: [0.2, 0.9], brace: [0, -1.25, -13.75], uv: gearUV, wheelSegments: 22,
    doors: [{ name: 'noseDoorR', ...doorOf(fus.patches.ngdR, fus.edges.ngdR.tHi), open: 88 }, { name: 'noseDoorL', ...doorOf(fus.patches.ngdL, fus.edges.ngdL.tLo), open: 88 }],
    lamps: [{ kind: 'taxi', pos: [0, -1.72, -14.43], size: 0.06, color: [1, 0.96, 0.9] }, { kind: 'taxi', pos: [0.09, -1.66, -14.42], size: 0.045, color: [1, 0.96, 0.9] }],
  });
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, P = [c[0], -1.0, c[2]], R = gp[i].wheelRadius;
    // strut door: a curved fairing on the outboard face of the leg (white inside, body colour outside)
    const ex = new K.Mesh(), ax = [0, c[1] + R - P[1], 0], f = (k, out, fz) => [P[0] + sx * out, P[1] + ax[1] * k, P[2] + fz];
    for (const [dd, uv] of [[0.16, UA.fair], [0.145, UA.strut]]) {
      const i0 = ex.vertexCount, nx = dd > 0.15 ? sx : -sx, rows = [[0.04, 0.34], [0.3, 0.32], [0.5, 0.28], [0.62, 0.2]];
      for (const [k, hw] of rows) for (const fz of [-hw, 0, hw]) { const bow = 0.035 * (1 - (fz / hw) ** 2); const p = f(k, dd + bow, fz); ex.vert(p[0], p[1], p[2], nx, 0, 0, uv[0], uv[1]); }
      for (let r = 0; r < rows.length - 1; r++) for (let q = 0; q < 2; q++) { const a = i0 + r * 3 + q, b = a + 1, cc = a + 4, d = a + 3; if (nx > 0) ex.quad(a, b, cc, d); else ex.quad(a, d, cc, b); }
    }
    for (const k of [0.2, 0.55]) ex.add(K.tube(f(k, 0.06, 0), f(k, 0.15, 0), 0.012, 0.012, { segments: 5, uv: UA.steel }));
    K.buildGear(rig, A, {
      name: 'main' + key, index: i, contact: c, wheels: [-0.43, 0.43], wheelRadius: R, wheelWidth: 0.33, pivot: P, stroke: 0.36, staticFrac: 0.4,
      strutR: 0.095, links: 'rear', retract: { axis: [0, 0, sx], angle: 90 }, window: [0.2, 0.92], brace: [c[0] - sx * 0.9, -1.0, c[2] - 0.15], uv: gearUV, wheelSegments: 28, extra: ex,
    });
  }

  // ---- lamps ------------------------------------------------------------------------------------------------------------------
  const L = G.lights, tipTE = W.R.at(17.1, 0.97, 'mid');
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.06, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.06, squash: [0.6, 0.6, 1.5] });
  for (const sx of [-1, 1]) rig.lamp('nav', [sx * (tipTE[0] + 0.02), tipTE[1] - 0.02, tipTE[2] + 0.04], { color: [1, 1, 1], size: 0.045 });     // aft white position lights
  for (const sx of [-1, 1]) rig.lamp('strobe', [sx * (tipTE[0] + 0.03), tipTE[1] + 0.03, tipTE[2] - 0.08], { color: [1, 1, 1], size: 0.05 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.05 });
  const beaconTop = [0, fus.topAt(-2) + 0.03, -2], beaconBot = [0, fair.at(-2.6, 0).p[1] - 0.03, -2.6];
  rig.lamp('beacon', beaconTop, { color: [1, 0.05, 0.03], size: 0.08, squash: [1, 0.6, 1] });
  rig.lamp('beacon', beaconBot, { color: [1, 0.05, 0.03], size: 0.08, squash: [1, 0.6, 1] });
  const lampLand = [], lampTurn = [];
  for (const sx of [-1, 1]) {
    const p = W.R.at(2.35, 0.012, 'mid'), q = W.R.at(2.75, 0.014, 'mid');
    lampLand.push([sx * p[0], p[1], p[2] - 0.03]); lampTurn.push([sx * q[0], q[1], q[2] - 0.03]);
    rig.lamp('landing', lampLand[lampLand.length - 1], { color: [1, 0.97, 0.9], size: 0.09, squash: [1.6, 0.8, 0.5] });
    rig.lamp('taxi', lampTurn[lampTurn.length - 1], { color: [1, 0.97, 0.9], size: 0.065, squash: [1.3, 0.8, 0.5] });
    const s = stab.R.at(6.3, 0.3, 'upper'); rig.lamp('nav', [sx * s[0], s[1] + 0.04, s[2]], { color: [1, 0.98, 0.92], size: 0.04, squash: [1, 0.5, 1] });   // logo lights
  }

  // ---- night halos: each external light also gets a soft additive glow sprite (one Points draw call) -------------------------
  const HALO = [
    { p: [L.navLeft[0] - 0.05, L.navLeft[1], L.navLeft[2] - 0.03], c: [1, 0.05, 0.03], k: 'nav', s: 2.2 }, { p: [L.navRight[0] + 0.05, L.navRight[1], L.navRight[2] - 0.03], c: [0.05, 1, 0.3], k: 'nav', s: 2.2 },
    ...[-1, 1].map(sx => ({ p: [sx * (tipTE[0] + 0.03), tipTE[1] - 0.02, tipTE[2] + 0.08], c: [1, 1, 1], k: 'nav', s: 1.5 })),
    ...[-1, 1].map(sx => ({ p: [sx * (tipTE[0] + 0.04), tipTE[1] + 0.03, tipTE[2] - 0.08], c: [1, 1, 1], k: 'strobe', s: 3.4 })),
    { p: [L.strobe[0], L.strobe[1], L.strobe[2] + 0.06], c: [1, 1, 1], k: 'strobe', s: 3.0 },
    { p: [0, beaconTop[1] + 0.05, beaconTop[2]], c: [1, 0.1, 0.05], k: 'beacon', s: 2.6 }, { p: [0, beaconBot[1] - 0.05, beaconBot[2]], c: [1, 0.1, 0.05], k: 'beacon', s: 2.6 },
    ...lampLand.map(p => ({ p: [p[0], p[1], p[2] - 0.06], c: [1, 0.95, 0.85], k: 'landing', s: 3.6 })),
    ...lampTurn.map(p => ({ p: [p[0], p[1], p[2] - 0.05], c: [1, 0.95, 0.85], k: 'taxi', s: 2.4 })),
    { p: [0, -1.72, -14.5], c: [1, 0.95, 0.85], k: 'taxiGear', s: 2.6 },
  ];
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(HALO.flatMap((h) => h.p), 3));
  haloGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(HALO.length * 3).fill(0), 3));
  haloGeo.setAttribute('size', new THREE.Float32BufferAttribute(HALO.map((h) => h.s), 1));
  const haloMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, fog: false,
    vertexShader: 'attribute float size; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * 0.5 * projectionMatrix[1][1] * 360.0 / max(0.5, -mv.z), 2.0, 110.0); }',
    fragmentShader: 'varying vec3 vC; void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard; float a = exp(-r2 * 5.0) + 0.25 * exp(-r2 * 1.4) * (1.0 - r2); gl_FragColor = vec4(vC * a, 1.0); }',
  });
  const halo = new THREE.Points(haloGeo, haloMat); halo.name = 'halos'; halo.frustumCulled = false; halo.renderOrder = 6;
  const haloCol = haloGeo.attributes.color;

  // ---- animation --------------------------------------------------------------------------------------------------------------
  const fanAng = [0, 0];
  rig.onUpdate((S, dt) => {
    if (captainNode) captainNode.visible = !rig.cameraInCockpit;
    const sf = S.sf, f = sf.flaps, sl = Math.max(sf.slats, 0), gnd = S.onGround ? 1 : 0;
    for (const a of wingAnim) {
      const R = a.key === 'R', ail = R ? sf.aileronR : sf.aileronL, sp = R ? sf.spoilerR : sf.spoilerL, el = R ? sf.elevatorR : sf.elevatorL;
      a.flapIn(f * 36 * DEG); a.flapOut(f * 36 * DEG); a.aftIn(f * 24 * DEG); a.aftOut(f * 24 * DEG);
      a.aileron(ail * 20 * DEG); a.slat(sl * 24 * DEG); a.krueger(sl * 128 * DEG);
      a.spF(Math.min(1, Math.max(sp, sf.speedbrake * (gnd ? 1 : 0.55))) * 40 * DEG);
      const g = gnd * Math.max(sf.speedbrake, sp > 0.9 ? sp : 0) * 52 * DEG; a.spGI(g); a.spGO(g);
      a.elev(el * 21 * DEG);
    }
    rud.set(sf.rudder * 26 * DEG);
    for (let i = 0; i < 2; i++) {
      const e = S.eng[i] || {};
      fanAng[i] = (fanAng[i] + (e.n1 || 0) * 26 * dt) % (Math.PI * 2);
      fans[i].quaternion.set(0, 0, Math.sin(fanAng[i] / 2), Math.cos(fanAng[i] / 2));
      sleeves[i].node.position.z = sleeves[i].node.userData.restZ + (e.reverser || 0) * sleeves[i].travel;
    }
    const lt = S.lights || {}, nf = Math.max(0, Math.min(1, (S.night ?? 0) * 1.4 - 0.2)), t = S.t || 0;
    matA.emissiveIntensity = S.night * 2.4;
    matB.emissiveIntensity = (lt.nav ? 1 : 0) * nf * 1.6;                     // logo lights wash the fin
    HALO.forEach((h, i) => {
      let on = 0;
      if (h.k === 'nav') on = lt.nav ? 1 : 0;
      else if (h.k === 'strobe') { const ph = t % 1.1; on = lt.strobe && (ph < 0.055 || (ph > 0.16 && ph < 0.215)) ? 1 : 0; }
      else if (h.k === 'beacon') { const ph = (t + 0.45) % 1.25; on = lt.beacon ? (ph < 0.16 ? Math.sin(ph / 0.16 * Math.PI) : 0) : 0; }
      else if (h.k === 'taxiGear') on = lt.taxi && sf.gear > 0.98 ? 1 : 0;
      else on = lt[h.k] ? 1 : 0;
      const I = on * nf * 0.9; haloCol.setXYZ(i, h.c[0] * I, h.c[1] * I, h.c[2] * I);
    });
    haloCol.needsUpdate = true; halo.visible = nf > 0.01;
  });
  for (const s of sleeves) s.node.userData.restZ = s.node.position.z;
  const visual = rig.build();
  visual.object3D.add(halo);
  rig.disposables.push(haloGeo, haloMat);
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- helpers ------------------------------------------------------------------------------------------------------------------
function inPoly(p, pg) {
  let sgn = 0;
  for (let i = 0; i < pg.length; i++) {
    const a = pg[i], b = pg[(i + 1) % pg.length], c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(c) < 1e-12) continue;
    const s = c > 0 ? 1 : -1; if (!sgn) sgn = s; else if (s !== sgn) return false;
  }
  return true;
}

/** Bilinear skin patch over four (z, t) corners of a loft, lifted `off` along the normal, facing outward. */
function skinPatch(body, c, off, uv, nu = 6, nv = 6) {
  const m = new K.Mesh(), base = m.vertexCount;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv;
    const z = (1 - v) * ((1 - u) * c[0][0] + u * c[1][0]) + v * ((1 - u) * c[3][0] + u * c[2][0]);
    const t = (1 - v) * ((1 - u) * c[0][1] + u * c[1][1]) + v * ((1 - u) * c[3][1] + u * c[2][1]);
    const q = body.at(z, t);
    m.vert(q.p[0] + q.n[0] * off, q.p[1] + q.n[1] * off, q.p[2] + q.n[2] * off, q.n[0], q.n[1], q.n[2], uv[0], uv[1]);
  }
  // winding: compare the first cell's geometric normal with the skin normal
  const P = (k) => [m.p[k * 3], m.p[k * 3 + 1], m.p[k * 3 + 2]], a = P(base), b = P(base + 1), d = P(base + nu + 1);
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const flip = cr[0] * m.n[0] + cr[1] * m.n[1] + cr[2] * m.n[2] < 0;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const A = base + j * (nu + 1) + i, B = A + 1, C = A + nu + 2, D = A + nu + 1;
    if (flip) m.quad(A, D, C, B); else m.quad(A, B, C, D);
  }
  return m;
}

/** Probe build of the nacelle with raw loft coordinates as UVs: arc length of the cowl / sleeve and z → s on their outer skins. */
function nacelleArcs(NAC) {
  const raw = { type: 'unwrap', uvUnwrap: (u, t) => [u, t], stripAt: () => 0 };
  const n = K.nacelle({ centre: [0, 0, 0], ...NAC, segments: 16, chart: raw, sleeveChart: raw });
  const col = (m) => { const out = []; for (let i = 0; i < m.vertexCount; i++) if (Math.abs(m.uv[i * 2 + 1] - 0.25) < 1e-6) out.push([m.uv[i * 2], m.p[i * 3 + 2]]); return out.sort((a, b) => a[0] - b[0]); };
  const mk = (pairs, outer) => {
    let iTurn = 0; for (let i = 0; i < pairs.length; i++) if (outer === 'min' ? pairs[i][1] < pairs[iTurn][1] : pairs[i][1] > pairs[iTurn][1]) iTurn = i;
    const a = pairs.slice(0, iTurn + 1), b = pairs.slice(iTurn);
    const interp = (seg, z) => { const s2 = seg.slice().sort((p, q) => p[1] - q[1]); if (z <= s2[0][1]) return s2[0][0]; for (let i = 1; i < s2.length; i++) if (z <= s2[i][1]) { const f = (z - s2[i - 1][1]) / Math.max(1e-9, s2[i][1] - s2[i - 1][1]); return s2[i - 1][0] + (s2[i][0] - s2[i - 1][0]) * f; } return s2[s2.length - 1][0]; };
    return { first: (z) => interp(a, z), second: (z) => interp(b, z), turn: pairs[iTurn][0], max: pairs[pairs.length - 1][0] };
  };
  const cw = mk(col(n.cowl).filter(p => p[0] > 0 || p[1] !== 0), 'min'), sl = mk(col(n.sleeve), 'max');
  return { cowlMax: cw.max + 0.02, sIn: cw.first, sOut: cw.second, sLip: cw.turn, sleeveMax: sl.max + 0.02, slOut: sl.first, slIn: sl.second, slEnd: sl.turn, zS: NAC.length * NAC.sleeve };
}

// ---- CFM56-7B fan: 24 wide-chord titanium blades, pointed spinner with the white de-icing swirl ------------------------------------
function cfmFan(o) {
  const R = o.radius, hub = o.hub, nb = o.blades, m = new K.Mesh(), NS = 7, TAU = Math.PI * 2, uvB = o.uvBlade;
  for (let i = 0; i < nb; i++) {
    const phi0 = i / nb * TAU, rows = [];
    for (let k = 0; k <= NS; k++) {
      const f = k / NS, r = hub * 0.97 + (R - hub * 0.97) * f;
      const beta = (26 + 38 * Math.pow(f, 0.85)) * DEG, cc = R * (0.3 + 0.18 * Math.sin(Math.PI * Math.min(1, f * 0.9 + 0.1)) - 0.06 * f * f);
      const sweep = R * (0.03 * f + 0.1 * f * f * f), lean = 0.08 * f * f;
      const phi = phi0 + lean, rad = [Math.cos(phi), Math.sin(phi), 0], tan = [-Math.sin(phi), Math.cos(phi), 0];
      const dir = [tan[0] * Math.sin(beta), tan[1] * Math.sin(beta), Math.cos(beta)];
      const zc = 0.12 + sweep, le = [rad[0] * r - dir[0] * cc * 0.45, rad[1] * r - dir[1] * cc * 0.45, zc - dir[2] * cc * 0.45], te = [rad[0] * r + dir[0] * cc * 0.55, rad[1] * r + dir[1] * cc * 0.55, zc + dir[2] * cc * 0.55];
      const n = [dir[1] * rad[2] - dir[2] * rad[1], dir[2] * rad[0] - dir[0] * rad[2], dir[0] * rad[1] - dir[1] * rad[0]];
      rows.push({ le, te, n });
    }
    for (const sg of [1, -1]) {
      const base = m.vertexCount;
      for (const q of rows) { m.vert(q.le[0], q.le[1], q.le[2], q.n[0] * sg, q.n[1] * sg, q.n[2] * sg, uvB[0], uvB[1]); m.vert(q.te[0], q.te[1], q.te[2], q.n[0] * sg, q.n[1] * sg, q.n[2] * sg, uvB[0], uvB[1]); }
      for (let k = 0; k < NS; k++) { const a = base + k * 2, b = a + 1, c = a + 3, d = a + 2; if (sg > 0) m.quad(a, b, c, d); else m.quad(a, d, c, b); }
    }
  }
  m.occlude((x, y) => 0.5 - 0.35 * Math.min(1, Math.hypot(x, y) / R));
  const sl = 0.5;
  m.add(K.lathe([[0, -sl], [hub * 0.12, -sl * 0.9], [hub * 0.45, -sl * 0.55], [hub * 0.78, -sl * 0.24], [hub * 0.98, -0.02], [hub, 0.1], [hub, 0.42, 1], [0, 0.42]], { segments: 24, uv: o.uvSpinner }));
  const pts = [];
  for (let k = 0; k <= 14; k++) { const f = 0.1 + 0.85 * k / 14, z = -sl * (1 - f), r = hub * (0.12 + 0.88 * f) * 1.01 + 0.008, a = 2.4 * f; pts.push([r * Math.cos(a), r * Math.sin(a), z]); }
  m.add(K.pipe(pts, 0.028, { segments: 5, uv: o.uvSwirl }));
  return m;
}

// ---- paint: fuselage --------------------------------------------------------------------------------------------------------------
function paintFuselage(A, o) {
  const { SC, fus, cFus, WIN, zd, DOORS } = o, F = K.FINISH;
  const P = A.pen(cFus), body = F.gloss(SC.body), belly = F.gloss(SC.belly), accent = F.gloss(SC.accent), tail = F.gloss(SC.tail);
  const font = K.FONT[SC.font] || K.FONT.wide, Z0 = -18.5, Z1 = 19.75;
  P.fill('all', body);
  // --- livery ---
  if (SC.style === 'sweep') {            // navy belly sweeping up over the whole tail, gold pin line, rising-sun emblem
    const edge = (z) => (z < 4 ? -0.62 + (z + 18.4) * 0.012 : -0.35 + Math.pow((z - 4) / 9.5, 2.2) * 3.4);
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.2, accent, { step: 0.25 });
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.13, body, { step: 0.25 });
    P.band(Z0, Z1, -Infinity, edge, belly, { step: 0.25 });
    P.textOn(SC.title, -8.6, 1.62, 'both', 0.62, { color: SC.titleColor, font, weight: 700, spacing: 0.06 });
    P.decalOn(-12.4, 1.58, 'both', (g) => drawSunArcs(g, 0.62, SC.accent));
  } else if (SC.style === 'ribbon') {    // tail colour wrapping the aft fuselage behind a pair of slanted ribbons
    const cut = (z0) => (z) => (z < z0 ? -Infinity : z > z0 + 3.2 ? Infinity : -1.6 + (z - z0) / 3.2 * 4.2);
    P.band(-18.45, 19.7, -Infinity, -1.05, F.gloss('#c9ced2'), { step: 0.5 });
    P.band(8.2, Z1, -Infinity, cut(8.2), accent, { step: 0.2 });
    P.band(8.9, Z1, -Infinity, cut(8.9), body, { step: 0.2 });
    P.band(9.5, Z1, -Infinity, cut(9.5), tail, { step: 0.2 });
    P.textOn(SC.title, -9.6, 1.5, 'both', 0.78, { color: SC.titleColor, font, weight: 700 });
    P.decalOn(-13.2, 1.5, 'both', (g, l, side) => drawRibbonMark(g, 0.5, SC.accent, SC.tail, side === 'R'));
  } else if (SC.style === 'star') {      // charcoal belly with a crimson cheat line rising into a crimson tail, star emblem
    const up = (z) => Math.max(0, z - 4) * 0.035 + Math.pow(Math.max(0, z - 9) / 10.6, 2.0) * 2.4;
    const nose = (z) => (z < -14.6 ? Math.pow((-14.6 - z) / 2.2, 1.4) * 0.95 : 0);
    P.band(Z0, Z1, -Infinity, (z) => -0.64 + up(z) - nose(z), belly, { step: 0.2 });
    const thick = (z) => Math.pow(Math.max(0, z - 6) / 13.6, 2.2) * 3.2;
    P.band(-16.6, Z1, (z) => -0.58 + up(z) - nose(z) * 0.95, (z) => -0.42 + up(z) - nose(z) * 0.9 + thick(z), accent, { step: 0.2 });
    P.textOn(SC.title, -8.4, 1.6, 'both', 0.66, { color: SC.titleColor, font, weight: 700, italic: true, spacing: 0.1 });
    P.decalOn(-12.3, 1.6, 'both', (g) => drawStar(g, 0.42, SC.accent));
  } else {                               // 'bands': grey belly, a broad accent stripe through the window line
    P.band(Z0, Z1, -Infinity, -0.55, belly, { step: 0.5 });
    P.band(-15.2, Z1, 0.58, 1.3, accent, { step: 0.5 });
    P.band(-15.2, Z1, 0.42, 0.5, F.gloss(SC.titleColor), { step: 0.5 });
    P.textOn(SC.title, -8.2, 1.78, 'both', 0.5, { color: SC.titleColor, font, weight: 700, spacing: 0.08 });
  }
  P.textOn(SC.reg, 15.4, 1.5, 'both', 0.3, { color: SC.regColor, font: K.FONT.sans, weight: 700 });
  P.textOn('737-800', zd(3.3), 0.62, 'both', 0.075, { color: '#6c7278', font: K.FONT.wide, weight: 700 });
  // radome joint and the forward access panels
  P.ring(zd(1.62), 0, 1, { px: 1.4, depth: 0.5, dark: 0.26 });
  P.doorOn(zd(2.6), zd(3.3), -1.25, -0.85, { px: 1, depth: 0.35, dark: 0.12, side: 'L' });
  // --- flight-deck windows: dark frame, glass (the cut-out shows through), eyebrow plugs ---
  for (const s of [1, -1]) {
    const m = (p) => [p[0], s > 0 ? p[1] : 1 - p[1]];
    for (const w of WIN) {
      const pts = w.map(m), path = (g) => { pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      P.stroke(path, 0, { color: '#2a2d31', rough: 0.4, metal: 0 }, { join: 'round', px: 7 });
      P.fill(pts, F.paintedGlass);
      P.groove(path, { px: 1.2, depth: 0.5, dark: 0.2 });
    }
    for (const [d0, d1, yl, yh] of [[2.36, 2.94, 1.83, 1.98], [3.04, 3.56, 1.78, 1.93]]) {      // plugged eyebrow windows
      const z0 = zd(d0), z1 = zd(d1), pts = [[z0, fus.tAtY(z0, yl)], [z1, fus.tAtY(z1, yl)], [z1, fus.tAtY(z1, yh)], [z0 + 0.08, fus.tAtY(z0 + 0.08, yh)]].map(m);
      P.line([...pts, pts[0]], { px: 1, depth: 0.3, dark: 0.1 });
    }
  }
  P.fill([[WIN[0][0][0], WIN[0][0][1]], [WIN[0][3][0], WIN[0][3][1]], [WIN[0][3][0], 1 - WIN[0][3][1]], [WIN[0][0][0], 1 - WIN[0][0][1]]], { color: '#2a2d31', rough: 0.4, metal: 0 });   // centre post
  // --- cabin windows (aligned on the over-wing exits), doors, hatches ---
  const zs = []; for (let z = -12.844; z < 12.7; z += 0.508) zs.push(z);
  P.windows(zs, 0.98, { w: 0.25, h: 0.36, r: 0.1, frame: SC.style === 'bands' ? '#d9dde0' : '#c2c6c9' });
  const door = { px: 1.3, depth: 0.6, dark: 0.32 };
  for (const [z0, z1] of [DOORS.fwd, DOORS.aft]) {
    P.doorOn(z0, z1, -0.28, 1.62, { ...door, handle: true, r: 0.08 }); P.windows([(z0 + z1) / 2], 1.12, { w: 0.18, h: 0.22, r: 0.08, lit: 0 });
    P.doorOn(z0 + 0.06, z1 - 0.06, 1.66, 1.78, { px: 1, depth: 0.3, dark: 0.1 });                                       // slide-bustle / gutter
    P.decalOn((z0 + z1) / 2, 0.05, 'both', (g) => { g.fillStyle = '#b8261c'; g.fillRect(-0.15, -0.012, 0.3, 0.024); K.drawText(g, 'PULL', 0.04, { color: '#3a3d41', font: K.FONT.wide }); });
  }
  for (const [z0, z1] of DOORS.owe) {
    P.doorOn(z0, z1, 0.42, 1.38, door);
    P.decalOn((z0 + z1) / 2, 1.5, 'both', (g) => K.drawText(g, 'EXIT', 0.05, { color: '#c42a1e', font: K.FONT.wide }));
    P.decalOn((z0 + z1) / 2, 0.55, 'both', (g) => { g.fillStyle = 'rgba(40,42,46,0.85)'; g.fillRect(-0.06, -0.02, 0.12, 0.04); });
  }
  for (const [z0, z1] of DOORS.cargo) P.doorOn(z0, z1, -1.12, -0.18, { ...door, side: 'R', r: 0.06 });
  P.doorOn(zd(4.6), zd(5.3), -1.4, -1.05, { px: 1, depth: 0.35, dark: 0.12, side: 'R' });                                   // E&E access
  // skin joints: circumferential every ~1.5 m (fine rivet rows beside them), lap joints along the crown and window belt
  const rv = { px: 1, depth: 0.12, dark: 0.025 };
  for (let z = -16.2; z < 19; z += 1.52) { P.ring(z, 0, 1, { px: 1, depth: 0.28, dark: 0.07 }); const g = fus.girthAt(z, 0.25) || 12; P.rivets(z + 0.03, 0.02, z + 0.03, 0.98, 0.04 / g, rv); }
  const lapY = (y) => (z) => Math.min(fus.topAt(z) - 0.25, Math.max(fus.botAt(z) + 0.2, y + Math.max(0, z - 9) * 0.07));
  for (const y of [1.62, 0.3, -0.75]) {
    P.yLine(-15.5, 18.5, lapY(y), { px: 1, depth: 0.28, dark: 0.07 });
    for (const side of [1, -1]) { const pts = []; for (let z = -15.4; z < 18.4; z += 1.0) { const t = fus.tAtY(z, lapY(y)(z) + 0.025); pts.push([z, side > 0 ? t : 1 - t]); } for (let i = 1; i < pts.length; i++) P.rivets(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], 0.045, rv); }
  }
  P.line([[-16.3, 0.5], [19.6, 0.5]], { px: 1, depth: 0.22, dark: 0.05 });
  P.line([[-15.0, 0.0], [15.0, 0.0]], { px: 1, depth: 0.22, dark: 0.05 });
  // static ports, outflow valve, APU inlet and exhaust surround, drain-mast and gear grime
  P.decalOn(zd(5.6), -0.25, 'both', (g) => { g.fillStyle = '#9aa0a5'; for (const x of [-0.06, 0.06]) { g.beginPath(); g.arc(x, 0, 0.035, 0, Math.PI * 2); g.fill(); } g.strokeStyle = '#c42a1e'; g.lineWidth = 0.012; g.strokeRect(-0.16, -0.09, 0.32, 0.18); });
  P.decalOn(11.4, -1.2, 'R', (g) => { g.fillStyle = '#3a3c3f'; g.beginPath(); g.ellipse(0, 0, 0.26, 0.17, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#8b9095'; g.lineWidth = 0.02; g.stroke(); });
  P.decalOn(17.7, 1.62, 'R', (g) => { g.fillStyle = '#2b2d30'; g.beginPath(); g.roundRect(-0.28, -0.12, 0.56, 0.24, 0.06); g.fill(); g.strokeStyle = '#8b9095'; g.lineWidth = 0.015; g.stroke(); });
  P.ring(19.35, 0, 1, { px: 1.4, depth: 0.4, dark: 0.2 });
  const rnd = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  for (let i = 0; i < 34; i++) { const z = -12 + rnd() * 26, t = rnd() < 0.5 ? rnd() * 0.07 : 1 - rnd() * 0.07; P.streak(z, t, z + 0.8 + rnd() * 2, t, 0.004 + rnd() * 0.01, { alpha: 0.05 + rnd() * 0.08 }); }
  for (const z of [-8.4, 11.6]) for (const dt of [-0.004, 0.004]) P.streak(z + 0.1, dt < 0 ? 1 + dt : dt, z + 3.2, dt < 0 ? 1 + dt * 3 : dt * 3, 0.012, { alpha: 0.16, color: '58,50,40' });
  for (let i = 0; i < 9; i++) { const z = 18.5 + rnd() * 0.9, tt = 0.3 + rnd() * 0.4; P.streak(z, tt, 19.7, tt + (rnd() - 0.5) * 0.06, 0.02, { alpha: 0.12 }); }
  P.noise({ alpha: 0.03, scale: 3, stretch: [2, 1] });
  P.noise({ alpha: 0.02, scale: 11, stretch: [2, 1] });
}

// ---- paint: belly fairing (bottom projection) -------------------------------------------------------------------------------------
function paintFairing(A, o) {
  const { SC, cFair } = o, F = K.FINISH, Q = A.pen(cFair);
  Q.fill('all', F.gloss(SC.fair));
  const ln = { px: 1, depth: 0.3, dark: 0.1 };
  for (const z of [-5.6, -3.6, -1.6, 0.4, 2.4, 4.4, 6.0]) Q.line([[-2.3, z], [2.3, z]], ln);
  Q.line([[0, -7.1], [0, 7.3]], ln);
  for (const sx of [-1, 1]) {
    Q.line([[sx * 1.2, -6.5], [sx * 1.2, 6.8]], ln);
    Q.panel(sx * 0.55, -4.0, sx * 1.05, -2.6, { r: 0.05, ...ln });
    Q.stroke((g) => g.rect(Math.min(sx * 0.86, sx * 2.16) - 0.02, 0.5, 1.34, 1.42), 0.035, F.rubber);          // wheel-well seal
    Q.streak(sx * 1.5, 1.9, sx * 1.6, 4.8, 0.7, { alpha: 0.12, color: '50,44,38' });                            // gear grime
    Q.fill((g) => g.rect(sx * 0.9 - 0.2, -5.05, 0.4, 0.82), { color: '#2a2c2f', rough: 0.6, metal: 0.2 });      // ram-air inlet throat
  }
  Q.noise({ alpha: 0.04, scale: 2, rough: 0.04 });
}

// ---- paint: flight-deck panels -----------------------------------------------------------------------------------------------------
function paintPanels(A, o) {
  const { cOver, cPed } = o;
  {
    const Q = A.pen(cOver); Q.fill('all', { color: '#5a5f65', rough: 0.7, metal: 0 });
    for (let j = 0; j < 9; j++) for (let i = 0; i < 6; i++) Q.fill((g) => g.rect(0.03 + i * 0.096, 0.04 + j * 0.105, 0.08, 0.085), { color: (i + j * 2) % 5 ? '#454a50' : '#26292d', rough: 0.6, metal: 0, emissive: (i * 3 + j) % 7 === 0 ? '#1c1403' : undefined });
    for (let j = 0; j < 9; j++) for (let i = 0; i < 6; i++) if ((i + j) % 2) Q.fill((g) => g.arc(0.07 + i * 0.096, 0.08 + j * 0.105, 0.012, 0, Math.PI * 2), { color: '#d8d8d2', rough: 0.4, metal: 0 });
  }
  {
    const Q = A.pen(cPed); Q.fill('all', { color: '#4f555c', rough: 0.7, metal: 0 });
    Q.fill((g) => g.rect(0.03, 0.02, 0.36, 0.3), { color: '#2c3034', rough: 0.6, metal: 0 });                     // throttle quadrant
    for (const b of [0.38, 0.6]) for (const a of [0.03, 0.22]) { Q.fill((g) => g.rect(a, b, 0.17, 0.18), { color: '#0b0c0d', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(a + 0.02, b + 0.02, 0.13, 0.08), { color: '#0d1a12', rough: 0.2, metal: 0, emissive: '#0d2414' }); }
    Q.fill((g) => g.rect(0.05, 0.81, 0.32, 0.07), { color: '#222528', rough: 0.6, metal: 0 });
  }
}

// ---- paint: wings, tail -----------------------------------------------------------------------------------------------------------
function paintSurfaces(B, o) {
  const { SC, W, fin, stab, cWT, cWB, cWl, cSt, cFin, SPOIL } = o, F = K.FINISH;
  const grey = F.semigloss('#b9bdc0'), dgrey = F.semigloss('#a5aaae'), metal = { color: '#c9ccce', rough: 0.28, metal: 0.9 };
  const line = { px: 1, depth: 0.32, dark: 0.12 }, gap = { px: 1.8, depth: 0.8, dark: 0.48 }, rv = { px: 1.1, depth: 0.14, dark: 0.04 };
  const L = (name, x) => W.lines[name].at(W.spanToU(x));
  for (const [chart, top, s] of [[cWT, true, 1], [cWB.R, false, 1], [cWB.L, false, -1]]) {
    const at = (x, f) => { const p = W.at(x, f); return [s * p[0], p[2]]; };
    const Q = B.pen(chart); Q.fill('all', grey);
    const span = (x0, x1, f0, f1, fin) => { const xs = []; for (let x = x0; x < x1; x += 1.2) xs.push(x); xs.push(x1); Q.fill([...xs.map(x => at(x, typeof f0 === 'string' ? L(f0, x) + 0.03 : f0)), ...xs.slice().reverse().map(x => at(x, typeof f1 === 'string' ? L(f1, x) - 0.02 : f1))], fin); };
    if (top) span(1.9, 16.6, 'slat', 'spoil', dgrey);                                                  // wing box skin
    span(1.9, 17.16, 0, 'slat', metal);                                                                 // bare-metal leading edge / slats
    const seg = (name, xs, op) => { const pts = []; for (let x = xs[0]; x < xs[1]; x += 1.0) pts.push(at(x, L(name, x))); pts.push(at(xs[1], L(name, xs[1]))); Q.line(pts, op); };
    seg('slat', [1.9, 17.16], gap);
    if (top) for (const [x0, x1] of Object.values(SPOIL)) Q.line([at(x0, L('spoil', x0)), at(x1, L('spoil', x1)), at(x1, L('flap', x1)), at(x0, L('flap', x0)), at(x0, L('spoil', x0))], gap);
    else for (const x of [2.1, 3.42, 4.75]) Q.line([at(x, 0.01), at(x, L('slat', x))], gap);
    for (const sp of [[1.98, 5.42], [5.95, 12.2], [12.45, 16.2]]) { seg('flap', sp, gap); for (const x of sp) Q.line([at(x, L('flap', x)), at(x, 1)], gap); }
    seg('aft', [1.98, 5.42], gap); seg('aft', [5.95, 12.2], gap);
    { const x0 = 14.6, x1 = 16.0; Q.line([at(x0, 1), at(x0, 0.9), at(x1, 0.9), at(x1, 1)], line); }                                  // aileron tab
    for (const x of [6.25, 8.9, 11.5, 14.1, 16.75]) Q.line([at(x, 0), at(x, L('slat', x))], gap);
    for (const f of [0.3, 0.44, 0.56]) { const pts = []; for (let x = 1.95; x < 17; x += 1.5) pts.push(at(x, f)); pts.push(at(17.0, f)); Q.line(pts, line); }
    for (let x = 2.6; x < 17; x += 1.3) Q.line([at(x, L('slat', x) + 0.01), at(x, L('spoil', x) - 0.01)], line);
    for (const f of [0.3, 0.44]) { const a = at(2, f + 0.006), b = at(17, f + 0.006); Q.rivets(a[0], a[1], b[0], b[1], 0.06, rv); }
    if (top) {
      // over-wing escape route + walkway: black outline from the exits to the flap, "no step" areas left unmarked
      const ol = F.matte('#1e2022');
      const a = at(1.95, 0.22), b = at(2.25, 0.22), c = at(3.5, 0.5), d = at(3.5, 0.68), e = at(1.95, 0.68);
      Q.stroke((g) => { g.moveTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.lineTo(e[0], e[1]); }, 0.05, ol);
      Q.stroke((g) => { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }, 0.05, ol);
      for (const x of [2.3, 2.7, 3.1]) { const p = at(x, 0.62); Q.decal(p[0], p[1], (g) => { g.fillStyle = '#2a2c2e'; g.beginPath(); g.moveTo(0, -0.12); g.lineTo(0.08, 0.02); g.lineTo(-0.08, 0.02); g.closePath(); g.fill(); }); }
      for (const x of [6.0, 11.5]) { const p = at(x, 0.38); Q.decal(p[0], p[1], (g) => { g.fillStyle = '#4a4f54'; g.beginPath(); g.arc(0, 0, 0.07, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#c42a1e'; g.lineWidth = 0.012; g.stroke(); }); }   // fuel caps
      for (const x of [4.0, 8.6]) { const p = at(x, L('spoil', x) - 0.06); Q.decal(p[0], p[1], (g) => { g.fillStyle = '#c42a1e'; g.fillRect(-0.18, -0.012, 0.36, 0.024); }); }   // no-step bars
    } else {
      for (let i = 0; i < 12; i++) { const x = 3 + i * 1.05, a = at(x, 0.62); Q.streak(a[0], a[1], a[0], a[1] + 1.2, 0.05, { alpha: 0.1 }); }
      for (const x of [7.5, 10.0, 12.5, 15.0]) { const p = at(x, 0.4); Q.panel(p[0] - 0.25, p[1] - 0.18, p[0] + 0.25, p[1] + 0.18, { r: 0.04, ...line }); }
      { const p = at(4.83, 0.5); Q.streak(p[0], p[1] - 0.6, p[0], p[1] + 2.4, 0.9, { alpha: 0.14, color: '40,36,32' }); }                  // core exhaust soot behind the engine
      if (s < 0) { const p = at(9.2, 0.42); Q.text(SC.reg, p[0], p[1], 1.0, { color: '#2a2d31', font: K.FONT.sans, weight: 700 }); }   // registration under the left wing
      else { const p = at(6.6, 0.32); Q.panel(p[0] - 0.3, p[1] - 0.15, p[0] + 0.3, p[1] + 0.15, { r: 0.03, ...line }); Q.text('FUEL', p[0], p[1], 0.07, { color: '#3a3d41', font: K.FONT.wide }); }
    }
    Q.noise({ alpha: 0.045, scale: 2.5, stretch: [1, 2.5], rough: 0.04 });
  }
  // winglets: livery colour, polished leading edge strip, emblem on both faces
  for (const key of ['L', 'R']) {
    const Q = B.pen(cWl[key]); Q.fill('all', F.gloss(SC.winglet));
    if (SC.style === 'sweep') Q.decal(6.9, 2.3, (g) => drawSunArcs(g, 0.85, SC.accent));
    else if (SC.style === 'ribbon') Q.fill((g) => { g.moveTo(3.9, 3.7); g.lineTo(8.8, 3.7); g.lineTo(8.8, 2.4); g.closePath(); }, F.gloss(SC.tail));
    else if (SC.style === 'star') Q.decal(7.0, 2.35, (g) => drawStar(g, 0.55, '#ffffff'));
    else Q.text('800', 7.1, 2.2, 0.42, { color: '#ffffff', font: K.FONT.wide, weight: 700 });
    Q.noise({ alpha: 0.025, scale: 2 });
  }
  {
    const Q = B.pen(cSt); Q.fill('all', grey);
    const sa = (x, f) => { const p = stab.at(x, f); return [p[0], p[2]]; };
    Q.fill([sa(0.9, 0), sa(7.1, 0), sa(7.1, 0.07), sa(0.9, 0.07)], metal);
    Q.line([sa(1.25, 1), sa(1.25, 0.7), sa(7.0, 0.7), sa(7.0, 1)], gap);
    for (const f of [0.25, 0.48]) Q.line([sa(0.9, f), sa(7.1, f)], line);
    for (const x of [2.2, 3.4, 4.6, 5.8]) Q.line([sa(x, 0.08), sa(x, 0.69)], line);
    { const a = sa(0.9, 0.25), b = sa(7.1, 0.25); Q.rivets(a[0], a[1] + 0.02, b[0], b[1] + 0.02, 0.06, rv); }
    Q.noise({ alpha: 0.045, scale: 2.5, stretch: [1, 2], rough: 0.04 });
  }
  for (const key of ['L', 'R']) {
    const Q = B.pen(cFin[key]); Q.fill('all', F.gloss(SC.tail));
    const fa = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    const c = fa(6.6, 0.42);
    if (SC.style === 'sweep') {          // rising-sun arcs clipped by a horizon line
      Q.decal(c[0], c[1], (g) => drawSunArcs(g, 1.63, SC.accent));
    } else if (SC.style === 'ribbon') {  // two flowing ribbons
      Q.decal(c[0], c[1] - 0.4, (g) => { const rib = (dy, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(-1.5, 1.6 + dy); g.bezierCurveTo(-0.6, 1.2 + dy, -0.6, -0.2 + dy, 0.4, -0.6 + dy); g.bezierCurveTo(0.9, -0.8 + dy, 1.3, -1.3 + dy, 1.5, -1.9 + dy); g.stroke(); }; rib(0, 0.42, SC.accent); rib(0.62, 0.2, '#ffffff'); });
    } else if (SC.style === 'star') {    // big white star breaking out of the leading edge over a charcoal root band
      Q.fill([fa(2.2, -0.2), fa(3.2, -0.2), fa(3.2, 1.1), fa(2.2, 1.1)], F.gloss(SC.belly));
      Q.decal(c[0] - 0.2, c[1] + 0.3, (g) => drawStar(g, 2.0, '#ffffff'));
    } else {
      Q.fill([fa(2.3, 0), fa(4.2, 0), fa(4.2, 1), fa(2.3, 1)], F.gloss(SC.accent));
      Q.text('800', c[0], c[1], 1.1, { color: SC.accent, font: K.FONT.wide, weight: 700 });
    }
    Q.fill([fa(2.4, 0), fa(9.6, 0), fa(9.6, 0.035), fa(2.4, 0.035)], metal);
    Q.line([fa(2.75, 1), fa(2.75, 0.69), fa(9.45, 0.69), fa(9.45, 1)], gap);
    for (const y of [4.4, 6.1, 7.8]) Q.line([fa(y, 0.69), fa(y, 1)], line);
    for (const f of [0.25, 0.47]) Q.line([fa(2.5, f), fa(9.5, f)], line);
    Q.line([fa(9.0, 0.04), fa(9.0, 0.6)], line);                                                          // VOR / LOC antenna cap at the tip
    // logo lights: a faint wash on the lower half of the fin at night (emissive layer, scaled by the material)
    const lit = mixHex(SC.tail, '#ffffff', 0.35);
    B.pen(cFin[key]).each('emis', (g) => { const gr = g.createLinearGradient(0, 2.4, 0, 7.5); gr.addColorStop(0, scaleHex(lit, 0.32)); gr.addColorStop(1, '#000000'); g.fillStyle = gr; g.fillRect(8.6, 2.2, 12.6, 7.6); });
    Q.noise({ alpha: 0.03, scale: 3 });
  }
}

// ---- paint: nacelle cowl + reverser sleeve (unwrap charts in loft arc length) -------------------------------------------------------
function paintNacelle(B, o) {
  const { SC, cNac, cSlv, NS, NAC } = o, F = K.FINISH, eng = F.gloss(SC.engine);
  const Q = B.pen(cNac), sOut = NS.sOut, sIn = NS.sIn;
  Q.fill('all', eng);
  // inlet duct: acoustic liner panels darkening toward the fan, polished lip
  Q.fill((g) => g.rect(-0.1, -0.1, NS.sLip + 0.1, 1.2), { color: '#7e8286', rough: 0.58, metal: 0.5 });
  for (let k = 0; k < 6; k++) Q.line([[0, k / 6], [NS.sLip, k / 6]], { px: 1, depth: 0.3, dark: 0.18 });
  Q.line([[sIn(NAC.zFan * 0.55), 0], [sIn(NAC.zFan * 0.55), 1]], { px: 1, depth: 0.3, dark: 0.2 });
  Q.each('color', (g) => { const gr = g.createLinearGradient(0, 0, NS.sLip, 0); gr.addColorStop(0, 'rgba(10,10,12,0.75)'); gr.addColorStop(0.55, 'rgba(10,10,12,0.25)'); gr.addColorStop(1, 'rgba(10,10,12,0)'); g.fillStyle = gr; g.fillRect(-0.1, -0.1, NS.sLip + 0.1, 1.2); });
  const s0 = sIn(0.07), s1 = sOut(0.14);
  Q.fill((g) => g.rect(s0, -0.1, s1 - s0, 1.2), F.polished);
  if (SC.lip !== SC.engine) Q.fill((g) => g.rect(sOut(0.16), -0.1, sOut(0.36) - sOut(0.16), 1.2), F.gloss(SC.lip));
  // inlet / fan-cowl joint, fan-cowl latch line along the bottom, hinge line at the top, access doors, stencils
  const ln = { px: 1.2, depth: 0.45, dark: 0.22 };
  Q.line([[sOut(0.7), 0], [sOut(0.7), 1]], ln);
  Q.line([[sOut(0.72), 0.0], [NS.cowlMax, 0.0]], ln); Q.line([[sOut(0.72), 0.5], [NS.cowlMax, 0.5]], { px: 1, depth: 0.3, dark: 0.12 });
  for (const t of [0.012, 0.988]) for (const z of [0.9, 1.1, 1.3]) { const s = sOut(z); Q.fill((g) => g.rect(s - 0.05, t - 0.006, 0.1, 0.012), { color: '#33363a', rough: 0.5, metal: 0.3 }); }   // latches
  for (const t of [0.16, 0.84]) { const s = sOut(1.35); Q.panel(s - 0.14, t - 0.025, s + 0.14, t + 0.025, { px: 1, depth: 0.3, dark: 0.12 }); }
  const sideMark = (t, rot) => {
    const s = sOut(0.95);
    if (SC.style === 'star') Q.decalT(s, t, { girth: 6.6, rot }, (g) => drawStar(g, 0.32, '#ffffff'));
    else if (SC.style === 'sweep') Q.decalT(s, t, { girth: 6.6, rot }, (g) => drawSunArcs(g, 0.34, SC.accent));
    else if (SC.style === 'ribbon') Q.decalT(s, t, { girth: 6.6, rot }, (g) => drawRibbonMark(g, 0.34, SC.accent, '#ffffff', false));
    else Q.decalT(s, t, { girth: 6.6, rot }, (g) => drawText(g, 'SKYWARD', 0.09, { color: SC.accent, font: K.FONT.wide }));
    Q.decalT(sOut(1.45), t + (rot ? -0.06 : 0.06), { girth: 6.6, rot }, (g) => K.drawText(g, 'NO STEP', 0.03, { color: '#3a3d41', font: K.FONT.wide }));
  };
  sideMark(0.75, 0); sideMark(0.25, 180);
  Q.noise({ alpha: 0.03, scale: 1.5, rough: 0.03 });
  // reverser sleeve: body colour outside, sooted toward the exit (heaviest underneath), dark inner fold
  const R = B.pen(cSlv), slEnd = NS.slEnd;
  R.fill('all', eng);
  R.fill((g) => g.rect(slEnd, -0.1, NS.sleeveMax - slEnd + 0.1, 1.2), { color: '#3c3e41', rough: 0.55, metal: 0.4 });
  R.line([[slEnd - 0.01, 0], [slEnd - 0.01, 1]], { px: 1.4, depth: 0.5, dark: 0.3 });
  R.line([[0.02, 0], [0.02, 1]], { px: 1.4, depth: 0.5, dark: 0.35 });
  R.line([[0.05, 0.0], [slEnd, 0.0]], { px: 1, depth: 0.4, dark: 0.2 }); R.line([[0.05, 0.5], [slEnd, 0.5]], { px: 1, depth: 0.3, dark: 0.12 });
  R.each('color', (g) => { const gr = g.createLinearGradient(slEnd * 0.45, 0, slEnd, 0); gr.addColorStop(0, 'rgba(46,40,34,0)'); gr.addColorStop(1, 'rgba(46,40,34,0.42)'); g.fillStyle = gr; g.fillRect(0, -0.1, slEnd, 1.2); });
  for (let i = 0; i < 10; i++) { const t = (i + 0.5) / 10; R.streak(slEnd * 0.5, t, slEnd, t, 0.012, { alpha: 0.18, color: '40,34,28' }); }
  R.noise({ alpha: 0.03, scale: 1.5 });
}

// ---- emblems (canvas units = metres, centred on the origin) --------------------------------------------------------------------
/** Aerolume: concentric half-rings of a rising sun clipped by a horizon bar. */
function drawSunArcs(g, r, col) {
  g.fillStyle = col; const k = r / 1.63;
  for (const [r0, r1] of [[0, 0.62], [0.82, 1.0], [1.2, 1.34], [1.54, 1.63]]) { g.beginPath(); g.arc(0, 0.34 * k, r1 * k, Math.PI, 0); g.arc(0, 0.34 * k, r0 * k, 0, Math.PI, true); g.closePath(); g.fill(); }
  g.fillRect(-1.75 * k, 0.47 * k, 3.5 * k, 0.07 * k);
}
/** Vantaro: four-point star with long vertical rays. */
function drawStar(g, r, col) {
  g.fillStyle = col; g.beginPath();
  const pts = [[0, -1], [0.16, -0.16], [0.62, 0], [0.16, 0.16], [0, 1], [-0.16, 0.16], [-0.62, 0], [-0.16, -0.16]];
  pts.forEach(([x, y], i) => (i ? g.lineTo(x * r, y * r) : g.moveTo(x * r, y * r))); g.closePath(); g.fill();
}
/** Velora: two interlocking ribbon strokes (small mark). flip mirrors it so it always flows aft. */
function drawRibbonMark(g, s, c1, c2, flip) {
  g.save(); if (flip) g.scale(-1, 1); g.lineCap = 'round';
  for (const [dy, w, col] of [[0, 0.3, c1], [0.32, 0.14, c2]]) { g.strokeStyle = col; g.lineWidth = w * s; g.beginPath(); g.moveTo(-0.9 * s, (0.6 + dy) * s); g.bezierCurveTo(-0.3 * s, (0.2 + dy) * s, 0.1 * s, (-0.3 + dy) * s, 0.9 * s, (-0.7 + dy) * s); g.stroke(); }
  g.restore();
}
function drawText(g, str, h, o) { K.drawText(g, str, h, o); }
function mixHex(a, b, f) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = [16, 8, 0].map((s) => Math.round(((pa >> s) & 255) * (1 - f) + ((pb >> s) & 255) * f));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
function scaleHex(a, k) { return mixHex(a, '#000000', 1 - k); }
