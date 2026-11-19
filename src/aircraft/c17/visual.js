// Boeing C-17A Globemaster III — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (3.9 m) when parked.
//
// Reference numbers (docs/aircraft/c17.md; d = distance aft of the nose tip, z = d - 25.5):
//   length 53.04 m, span 51.75 m over the winglets, height 16.79 m (stabiliser / fin cap top at y = 12.89).
//   Fuselage: round-cornered box, half-width 3.4 m, top y 2.9, flat belly y -2.4 from d 10 to d 38; blunt radome
//   (tip y -0.3), windscreen d 2.9-3.8 on the sloping "forehead", eye d 4.4 / y 1.0; belly sweeps up from d 38 to the
//   beaver tail (y 1.5 at d 53) with the cargo ramp (d 40.3-46.3) and door (to d 51.5) on its underside.
//   Wing: LE at the body side z -5.5 (x 3.4), chord 10, LE sweep 25°, straight TE ~7° back, tip x 24.27 (chord 2.8),
//   2.5° anhedral from y 2.3 at the body side, supercritical 14 % -> 10 %, blended into a dorsal wing-box fairing.
//   Winglets: 3.0 m tall, canted 25° outward, LE ~38°, tip chord 1.0, tip at x 25.88.
//   Engines (F117-PW-100): inlet highlights at geometry.engines[].intake (x ±8 / ±16.5), fan Ø 2.1 m, cowl Ø 2.54 m,
//   fan cowl 3.9 m + exposed core 1.2 m (core exit = geometry nozzle), long pylons into the wing LE.
//   Tail: fin LE z 13.8 at the crown (y 2.9) to z 21.0 at y 12.55 (LE ~37°), root chord 11.6, tip 5.0, two-segment
//   rudder; stabiliser span 19.8, root chord 5.4 at z 21.0, tip chord 2.0, LE 30°, on top of the fin at y 12.65.
//   Gear: twin-wheel nose leg at z -18 retracting forward; each main unit = two tandem legs (z 0.95 / 3.05, i.e. centred
//   on the geometry contact point z 2) with three wheels abreast, swinging forward into the sponsons.
// Serial numbers, unit names and crests are invented for this simulator.
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
export const LIVERIES = ['amc', 'euro1'];

const SCHEMES = {
  amc: { name: 'Air Mobility Command grey', body: '#7d848a', radome: '#5a5f64', mark: '#2a2e32', band: '#1d3768', bandText: 'BRANDT FIELD', serial: '12-9217', style: 'grey' },
  euro1: { name: 'European One (early delivery)', body: '#4b5449', alt: '#3c4140', radome: '#3d4140', mark: '#16181a', band: null, serial: '91-0388', style: 'camo' },
};

const NZ = -25.5;
const D = (d) => d + NZ;

// ---- planform helpers (right wing) ------------------------------------------------------------------------------------------
const TIPX = 24.27, ANH = Math.tan(2.5 * DEG);
const zLE = (x) => -5.5 + (x - 3.4) * Math.tan(25 * DEG);
const zTE = (x) => (x <= 3.4 ? 4.5 : 4.5 + (x - 3.4) * 0.127);
const wy = (x) => 2.75 - (x - 3.4) * ANH;
const NAC = { length: 3.9, rHi: 1.08, rMax: 1.27, rThroat: 1.02, rFan: 1.05, zFan: 0.72, rExit: 1.06, sleeve: 0.6, core: { r0: 0.74, r1: 0.5, length: 1.2 }, plug: { r: 0.3, length: 0.8 } };

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
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'amc', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const rig = K.createRig(ctx, { geometry: G, name: 'c17', glassLayer: opts.glassLayer, cockpitRadius: 1.4 });
  const skin = F.matte(SC.body);

  // ---- atlases: A = fuselage, sponsons, flight deck, gear; B = wings, winglets, tail ----------------------------------------
  const A = K.createAtlas({ size: atlasSize, base: skin });
  const cFus = A.chart('fus', { type: 'unwrap', z: [NZ, 27.6], girth: 20.4, vScale: 0.85, strips: 2 });
  const cSpon = A.chart('spon', { type: 'unwrap', z: [-9.5, 11.4], girth: 10, vScale: 0.8, density: 0.8 });
  const cPanel = A.chart('panel', { type: 'rect', w: 2.6, h: 0.7, density: 2.0 });
  A.pack();
  const UA = {
    body: A.swatch('body', skin), dark: A.swatch('dark', F.darkGrey), black: A.swatch('black', F.black), well: A.swatch('well', { color: '#8d9190', rough: 0.7, metal: 0.1 }),
    liner: A.swatch('liner', { color: '#7d8079', rough: 0.85, metal: 0 }), floor: A.swatch('floor', { color: '#2f3134', rough: 0.9, metal: 0 }), shield: A.swatch('shield', { color: '#1b1c1e', rough: 0.85, metal: 0 }),
    seat: A.swatch('seat', { color: '#3e4245', rough: 0.9, metal: 0 }), cushion: A.swatch('cushion', { color: '#5a5040', rough: 1, metal: 0 }), stick: A.swatch('stick', { color: '#151617', rough: 0.5, metal: 0 }),
    exhaust: A.swatch('exhaust', F.exhaust), steel: A.swatch('steel', F.steel), antenna: A.swatch('antenna', F.matte(SC.body)), hud: A.swatch('hud', { color: '#26282a', rough: 0.5, metal: 0.3 }),
  };
  const B = K.createAtlas({ size: atlasSize, base: skin });
  const cWT = B.chart('wingTop', { type: 'plan', x: [0.5, 26.0], z: [-7.0, 8.4], view: 'top', mirror: true });
  const cWB = B.chart('wingBot', { type: 'plan', x: [0.5, 26.0], z: [-7.0, 8.4], view: 'bottom', mirror: true, density: 0.7 });
  const cWl = B.chart('winglet', { type: 'side', z: [4.2, 8.6], y: [1.3, 4.9], view: 'right', density: 0.9 });
  const cSt = B.chart('stab', { type: 'plan', x: [0, 10.4], z: [20.8, 28.9], view: 'top', mirror: true, density: 0.8 });
  const cFin = { L: B.chart('finL', { type: 'side', z: [12.6, 27.0], y: [2.5, 13.0], view: 'left' }), R: B.chart('finR', { type: 'side', z: [12.6, 27.0], y: [2.5, 13.0], view: 'right' }) };
  B.pack();
  const UB = {
    grey: B.swatch('grey', skin), lip: B.swatch('lip', F.polished), duct: B.swatch('duct', { color: '#2a2c2f', rough: 0.55, metal: 0.3 }),
    acoustic: B.swatch('acoustic', { color: '#6f7274', rough: 0.6, metal: 0.5 }), core: B.swatch('core', { color: '#7b7e80', rough: 0.4, metal: 0.8 }), plug: B.swatch('plug', F.heatStained),
    blade: B.swatch('blade', { color: '#3a3d43', rough: 0.3, metal: 0.8 }), spinner: B.swatch('spinner', { color: '#2b2d30', rough: 0.4, metal: 0.4 }), inner: B.swatch('inner', F.primer),
    cascade: B.swatch('cascade', { color: '#3a3c3f', rough: 0.6, metal: 0.7 }), wick: B.swatch('wick', F.black), canoe: B.swatch('canoe', skin), hot: B.swatch('hot', { color: '#4f4b47', rough: 0.5, metal: 0.85 }),
  };

  // ---- fuselage -------------------------------------------------------------------------------------------------------------
  //          d      topY   botY    w     kTop  kBot
  const FS = [
    [0.00, -0.35, -0.35, 0.00, 0.56, 0.58], [0.10, 0.14, -0.84, 0.58, 0.56, 0.58], [0.40, 0.42, -1.16, 1.02, 0.56, 0.6], [0.95, 0.60, -1.47, 1.38, 0.57, 0.62],
    [1.80, 0.70, -1.75, 1.72, 0.58, 0.65], [2.60, 0.74, -1.93, 1.98, 0.6, 0.68], [3.00, 0.98, -2.00, 2.10, 0.6, 0.7], [3.40, 1.42, -2.10, 2.25, 0.62, 0.72],
    [3.85, 1.86, -2.20, 2.42, 0.64, 0.75], [4.50, 2.25, -2.32, 2.66, 0.66, 0.78], [5.50, 2.62, -2.46, 2.92, 0.68, 0.82], [7.00, 2.95, -2.60, 3.20, 0.7, 0.86],
    [8.80, 3.18, -2.71, 3.36, 0.71, 0.88], [10.5, 3.25, -2.75, 3.40, 0.72, 0.9], [38.0, 3.25, -2.75, 3.40, 0.72, 0.9], [40.0, 3.25, -2.55, 3.36, 0.72, 0.9],
    [42.5, 3.22, -1.90, 3.15, 0.71, 0.9], [45.5, 3.16, -1.05, 2.74, 0.7, 0.9], [48.3, 3.06, -0.20, 2.12, 0.68, 0.88], [50.6, 2.92, 0.50, 1.42, 0.66, 0.85],
    [52.3, 2.72, 1.20, 0.72, 0.62, 0.8], [53.04, 2.55, 1.70, 0.30, 0.6, 0.75],
  ].map(([d, t, b, w, kt, kb]) => { const y = b + (t - b) * (d < 10.5 ? 0.48 : d > 38 ? 0.5 : 0.453); return { z: D(d), y, w, top: t - y, bot: y - b, kTop: kt, kBot: kb }; });
  const fseg = Math.max(40, Math.round(88 * detail / 4) * 4);
  // flight-deck windows as (z, t) rectangles on the right half (t from 0 bottom centre .. 0.5 top centre)
  const fus0 = K.loft({ stations: FS, segments: 32, step: 1.5 });
  const tAtX = (z, x) => { let lo = 0.25, hi = 0.5; for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (fus0.at(z, m).p[0] > x) lo = m; else hi = m; } return (lo + hi) / 2; };
  const tY = (z, y) => fus0.tAtY(z, y);
  const WIN = {
    front: { z: [D(2.94), D(3.76)], t: [tAtX(D(3.35), 0.8), tAtX(D(3.35), 0.07)] },
    corner: { z: [D(3.02), D(3.84)], t: [tAtX(D(3.43), 1.52), tAtX(D(3.43), 0.9)] },
    side: { z: [D(3.98), D(4.88)], t: [tY(D(4.43), 0.62), tY(D(4.43), 1.52)] },
    brow: { z: [D(3.95), D(4.5)], t: [tAtX(D(4.2), 1.15), tAtX(D(4.2), 0.25)] },
  };
  const fus = K.loft({
    stations: FS, segments: fseg, step: 1.25 / detail, chart: cFus, capEnd: 'flat', capUV: UA.dark,
    cutouts: [{ name: 'ngd', z: [-20.7, -17.0], t: [0, 0.042], mirror: true }],
  });
  cFus.body = fus;
  const stA = new K.Mesh(), stB = new K.Mesh();
  stA.add(fus.mesh);
  stA.add(K.well(K.merge(fus.patches.ngdR, fus.patches.ngdL), 1.2, UA.well, [0, 1, 0]));

  // dorsal wing-box fairing: a low hump on the crown that blends the wing roots into the fuselage
  const hump = K.loft({
    stations: [[-11.5, 0.6, 0.02], [-9.5, 2.0, 0.22], [-7.5, 2.85, 0.38], [-5.0, 3.25, 0.5], [3.0, 3.3, 0.52], [6.0, 3.2, 0.46], [8.5, 2.7, 0.3], [10.5, 1.7, 0.14], [12.0, 0.5, 0.02]]
      .map(([z, w, h]) => ({ z, y: 2.6, w, top: 0.75 + h, bot: 0.3, kTop: [0.5, 0.75], kBot: 0.6 })),
    segments: Math.max(24, Math.round(40 * detail / 4) * 4), step: 0.9, uv: UA.body, tRange: [0.15, 0.85],
  });
  stA.add(hump.mesh);

  // ---- main-gear sponsons (one loft per side; gear well cut into the flat bottom) ------------------------------------------
  const sponSt = (sx) => [[-8.75, 3.55, -1.75, 0.05, 0.05, 0.05], [-8.55, 3.6, -1.72, 0.75, 0.62, 0.62], [-8.0, 3.75, -1.66, 1.25, 1.05, 0.92], [-7.0, 3.95, -1.6, 1.62, 1.38, 1.1], [-5.4, 4.1, -1.55, 1.8, 1.55, 1.2],
    [5.6, 4.1, -1.55, 1.8, 1.55, 1.2], [7.6, 3.95, -1.5, 1.62, 1.42, 1.08], [9.6, 3.7, -1.38, 1.15, 1.08, 0.78], [11.0, 3.45, -1.22, 0.45, 0.5, 0.3], [11.5, 3.4, -1.15, 0.05, 0.06, 0.05]]
    .map(([z, x, y, w, top, bot]) => ({ z, x: sx * x, y, w, top, bot, kTop: 0.55, kBot: [0.78, 0.95] }));
  const sponOpts = (sx) => ({ stations: sponSt(sx), segments: Math.max(28, Math.round(44 * detail / 4) * 4), step: 0.8, chart: cSpon });
  const sp0 = K.loft(sponOpts(1));
  const tSp = (x) => { let lo = 0, hi = 0.25; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (sp0.at(1.0, m).p[0] < x) lo = m; else hi = m; } return (lo + hi) / 2; };
  const tw0 = tSp(4.3), tw1 = tSp(5.75), WZ = [-1.85, 3.95];
  const spon = { R: K.loft({ ...sponOpts(1), cutouts: [{ name: 'well', z: WZ, t: [tw0, tw1] }] }), L: K.loft({ ...sponOpts(-1), cutouts: [{ name: 'well', z: WZ, t: [1 - tw1, 1 - tw0] }] }) };
  cSpon.body = spon.R;
  for (const k of ['R', 'L']) stA.add(spon[k].mesh).add(K.well(spon[k].patches.well, 1.25, UA.well, [0, 1, 0]));

  // ---- flight deck: painted windows outside, an inner lining with the window openings cut out --------------------------------
  {
    const ZB = D(6.1), FY = -0.25, eye = G.pilotEye;
    const cuts = Object.entries(WIN).map(([name, w]) => ({ name, z: w.z, t: w.t, mirror: true }));
    const lin = K.loft({ stations: FS, segments: fseg, step: 0.25, tRange: [0.21, 0.79], zRange: [D(2.86), ZB], inflate: -0.07, flip: true, uv: UA.liner, cutouts: cuts });
    stA.add(lin.mesh);
    stA.add(K.deck(fus, D(2.9), ZB, FY, { uv: UA.floor, n: 8, inset: 0.08 }));
    stA.add(K.bulkhead(fus, ZB, { uv: UA.liner, facing: -1 }));
    stA.add(K.bulkhead(fus, D(2.92), { uv: UA.shield, facing: 1 }));
    const zp = eye[2] - 0.95;                                                             // main instrument panel plane
    stA.add(K.prism([[zp - 0.3, 0.62], [zp + 0.16, 0.68], [zp + 0.2, 0.65], [zp + 0.16, 0.6], [zp - 0.3, 0.54]], -1.3, 1.3, UA.shield));   // glareshield
    { const i0 = stA.vertexCount; for (const [a, b] of [[0, 0.7], [2.6, 0.7], [2.6, 0], [0, 0]]) { const uv = cPanel.uv(a, b); stA.vert(a - 1.3, -0.12 + (0.7 - b), zp + (0.7 - b) * 0.1, 0, 0.1, 1, uv[0], uv[1]); } stA.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    stA.add(K.box(0.55, 0.55, 1.1, UA.shield).translate(0, FY + 0.3, zp + 0.6));       // centre pedestal
    const huds = new K.Mesh();
    for (const sx of [-1, 1]) {
      const e = [sx * Math.abs(eye[0]), eye[1], eye[2]];
      stA.add(K.crewSeat({ eye: e, uv: { frame: UA.seat, cushion: UA.cushion } }));
      stA.add(K.stick({ base: [e[0] + sx * 0.0, FY + 0.05, e[2] - 0.45], height: 0.55, uv: UA.stick, uvGrip: UA.stick }));
      const h = K.hud({ eye: e, dist: 0.55, width: 0.2, height: 0.16, uv: UA.hud });
      stA.add(h.frame); huds.add(h.glass);
    }
    rig.glass('hud', K.glassMaterial(ctx, K.GLASS.hud));
    rig.addStatic(huds, 'hud');
  }

  // ---- wings ----------------------------------------------------------------------------------------------------------------
  const wst = (x, tc, twist) => ({ x, y: wy(x), z: zLE(x), chord: zTE(x) - zLE(x), tc, twist });
  const sc = K.supercritical();
  const SLATS = [[3.75, 7.55], [8.45, 16.05], [16.95, 23.95]], SPOIL = [[3.8, 5.55], [5.65, 7.4], [7.5, 9.2], [9.3, 10.9], [11.3, 14.6], [14.7, 17.95]];
  const wingOf = (side) => K.wing({
    side, airfoil: sc, chordPts: Math.round(16 * Math.min(1, detail)), spanAxis: 'x', tip: 'none',
    stations: [wst(0.6, 0.14, 2), wst(3.4, 0.14, 2), wst(12, 0.12, 0), wst(TIPX, 0.10, -3)],
    lines: { slat: [[0.6, 0.12], [TIPX, 0.12]], spoil: [[0.6, 0.56], [TIPX, 0.56]], flap: [[0.6, 0.7], [TIPX, 0.7]], aft: [[0.6, 0.86], [TIPX, 0.86]] },
    controls: [
      { name: 'flapIn', type: 'flap', span: [3.55, 10.95], from: 'flap', to: 'aft', nose: 1, tail: 0.6 },
      { name: 'aftIn', type: 'flap', span: [3.55, 10.95], from: 'aft', nose: 1 },
      { name: 'flapOut', type: 'flap', span: [11.15, 18.1], from: 'flap', to: 'aft', nose: 1, tail: 0.6 },
      { name: 'aftOut', type: 'flap', span: [11.15, 18.1], from: 'aft', nose: 1 },
      { name: 'aileron', type: 'flap', span: [18.3, 23.85], from: 'flap', nose: 1 },
      ...SLATS.map((s, i) => ({ name: 'slat' + i, type: 'flap', span: s, to: 'slat', tail: 0.4, cove: true })),
      ...SPOIL.map((s, i) => ({ name: 'sp' + i, type: 'panel', surface: 'upper', span: s, from: 'spoil', to: 'flap', hinge: 'front' })),
    ],
    charts: { upper: cWT, lower: cWB }, innerUV: UB.inner, edgeUV: UB.grey,
  });
  const W = { R: wingOf(1), L: wingOf(-1) };
  stB.add(W.R.mesh).add(W.L.mesh);
  const tipSt = wst(TIPX, 0.10, -3);
  for (const side of [1, -1]) {
    stB.add(K.wing({ side, airfoil: K.naca4('0010'), chordPts: 9, spanAxis: 'u', tip: 'round', tipLength: 0.5, charts: { upper: cWl, lower: cWl }, edgeUV: UB.grey,
      stations: [tipSt, ...K.blendedWinglet(tipSt, { height: 3.0, cant: 25, radius: 0.32, sweep: 38, tipChord: 1.0, tc: 0.085, n: 3, dihedral: -2.5 })] }).mesh);
  }
  // flap-track fairings ("canoes"): front part fixed under the wing, rear part rides on the main flap
  const canoeAt = (x, len, side) => {
    const zf = W.R.at(x, 0.7, 'lower'), z0 = zf[2] - len * 0.4, y = zf[1] - 0.06;
    const st = [[0, 0.01, 0.01], [0.12, 0.1, 0.12], [0.35, 0.14, 0.24], [0.62, 0.14, 0.25], [0.86, 0.09, 0.16], [1, 0.012, 0.02]].map(r => ({ z: z0 + r[0] * len, x: side * x, y: y - r[2] * 0.5 + (r[0] > 0.6 ? (r[0] - 0.6) * 0.3 : 0), w: r[1], top: r[2] * 0.6, bot: r[2] }));
    const split = zf[2] + 0.15;
    return { front: K.loft({ stations: st, segments: 12, step: 0.45, uv: UB.canoe, zRange: [z0, split] }).mesh, rear: K.loft({ stations: st, segments: 12, step: 0.45, uv: UB.canoe, zRange: [split, z0 + len], capStart: 'flat' }).mesh };
  };

  // ---- tail -------------------------------------------------------------------------------------------------------------------
  const finLE = (y) => 13.8 + (y - 2.9) * 0.746, finTE = (y) => 25.4 + (y - 2.9) * 0.062;
  const fin = K.wing({
    airfoil: K.naca4('0012'), chordPts: Math.round(12 * Math.min(1, detail)), spanAxis: 'y', tip: 'flat',
    stations: [{ x: 0, y: 2.5, z: finLE(2.5), chord: finTE(2.5) - finLE(2.5), tc: 0.12 }, { x: 0, y: 12.6, z: finLE(12.6), chord: finTE(12.6) - finLE(12.6), tc: 0.11 }],
    lines: { hinge: [[2.2, 0.7], [12.6, 0.68]] },
    controls: [{ name: 'rudLo', type: 'flap', span: [3.3, 7.75], from: 'hinge', nose: 1 }, { name: 'rudUp', type: 'flap', span: [7.85, 12.15], from: 'hinge', nose: 1 }],
    charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.grey,
  });
  stB.add(fin.mesh);
  stB.add(K.wing({ airfoil: K.naca4('0008'), chordPts: 6, spanAxis: 'y', tip: 'flat', uv: UB.grey, edgeUV: UB.grey,          // dorsal fillet
    stations: [{ x: 0, y: 2.95, z: 9.6, chord: 5.0, tc: 0.03 }, { x: 0, y: 3.95, z: 14.1, chord: 1.6, tc: 0.1 }] }).mesh);
  const SY = 12.65;
  const stabOf = (side) => K.wing({
    side, airfoil: K.naca4('0011'), chordPts: Math.round(11 * Math.min(1, detail)), spanAxis: 'x', tip: 'round', tipLength: 0.5,
    stations: [{ x: 0, y: SY, z: 21.0, chord: 5.4, tc: 0.11 }, { x: 9.9, y: SY, z: 21.0 + 9.9 * Math.tan(30 * DEG), chord: 2.0, tc: 0.09 }],
    lines: { hinge: [[0, 0.68], [9.9, 0.68]] },
    controls: [{ name: 'elev', type: 'flap', span: [0.75, 9.6], from: 'hinge', nose: 1 }],
    charts: { upper: cSt, lower: cSt }, edgeUV: UB.grey,
  });
  const stab = { R: stabOf(1), L: stabOf(-1) };
  stB.add(stab.R.mesh).add(stab.L.mesh);
  // fin cap / stabiliser bullet fairing
  stB.add(K.loft({ stations: [[19.6, 0.0, 0.0], [20.3, 0.22, 0.2], [21.4, 0.36, 0.3], [24.5, 0.38, 0.32], [26.6, 0.28, 0.24], [27.5, 0.05, 0.05]]
    .map(([z, w, h]) => ({ z, y: SY + 0.02, w, top: h, bot: h * 1.3 })), segments: 16, step: 0.6, uv: UB.grey }).mesh);

  // ---- engines ----------------------------------------------------------------------------------------------------------------
  const eng = [], sleeveAll = new K.Mesh();
  let sleeveTravel = 0;
  for (const e of G.engines) {
    const c = e.intake;
    const n = K.nacelle({ centre: c, ...NAC, droop: 0.04, segments: Math.max(28, Math.round(40 * detail / 4) * 4),
      uv: UB.grey, uvLip: UB.lip, uvInner: UB.acoustic, uvSleeve: UB.grey, uvCore: UB.core, uvPlug: UB.plug, uvCascade: UB.cascade });
    stB.add(n.cowl).add(n.cascade).add(n.core).add(n.plug);
    stB.add(K.fanBackdrop(NAC.rFan, 0.4, UB.duct).translate(c[0], c[1], n.fanZ));
    const sl = n.sleeve.clone(); sl.enableMorph(); for (let i = 2; i < sl.p2.length; i += 3) sl.p2[i] += n.sleeveTravel;
    sleeveAll.add(sl); sleeveTravel = n.sleeveTravel;
    // pylon: long strut from the fan cowl up and forward of the leading edge, under the wing to an aft fairing
    { const x = Math.abs(c[0]), yl = W.R.at(x, 0.25, 'lower')[1], zl = zLE(x);
      stB.add(K.pylon([{ y: c[1] + 1.12, z0: c[2] + 0.55, z1: c[2] + 5.4, x: c[0] }, { y: yl + 0.05, z0: zl - 1.9, z1: zl + 3.4, x: c[0] }], { uv: UB.grey, tc: 0.11 }));
      const z0 = zl + 2.2, len = (zTE(x) - zl) * 0.75, yb = W.R.at(x, 0.4, 'lower')[1] - 0.05;
      const st = [[0, 0.02, 0.02], [0.18, 0.3, 0.32], [0.5, 0.34, 0.4], [0.82, 0.2, 0.26], [1, 0.02, 0.04]].map(r => ({ z: z0 + r[0] * len, x: c[0], y: yb + r[0] * 0.25, w: r[1], top: 0.5, bot: r[2] }));
      stB.add(K.loft({ stations: st, segments: 14, step: 0.5, uv: UB.grey }).mesh); }
    eng.push({ c, n, fanMesh: K.fan({ radius: NAC.rFan - 0.01, hub: 0.36, blades: 22, chord: 0.42, staggerRoot: 30, staggerTip: 62, sweep: 0.18, uvBlade: UB.blade, uvSpinner: UB.spinner }) });
  }

  // ---- small details ----------------------------------------------------------------------------------------------------------
  stA.add(K.bladeAntenna({ pos: [0, fus.topAt(-14) - 0.02, -14], height: 0.35, chord: 0.5, sweep: 0.2, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.topAt(-17.5) - 0.02, -17.5], height: 0.25, chord: 0.4, sweep: 0.2, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.topAt(10.5) - 0.02, 10.5], height: 0.3, chord: 0.45, sweep: 0.2, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.botAt(-12) + 0.02, -12], height: 0.3, chord: 0.42, sweep: 0.18, down: true, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.botAt(8) + 0.02, 8], height: 0.3, chord: 0.42, sweep: 0.18, down: true, uv: UA.antenna }));
  stA.add(K.ellipsoid(0.55, 0.22, 1.1, { segments: 14, rings: 6, uv: UA.antenna }).translate(0, fus.topAt(-8.8) + 0.02, -8.8));            // SATCOM fairing
  for (const sx of [-1, 1]) {                                                                         // pitot probes and AoA vanes on the nose
    for (const dy of [-0.5, -0.15]) { const z = D(2.0), p = fus.at(z, fus.tAtY(z, dy)).p; stA.add(K.probe([sx * p[0], p[1], p[2]], [sx * (p[0] + 0.16), p[1], p[2] - 0.22], 0.016, UA.steel)); }
    // missile-warning / IR countermeasure fairings on the sponson fronts and the tail
    stA.add(K.ellipsoid(0.16, 0.16, 0.42, { segments: 10, rings: 5, uv: UA.antenna }).translate(sx * 4.95, -0.85, -6.4));
  }
  { const wicks = []; for (const sx of [-1, 1]) { for (const x of [20, 21.8, 23.4]) { const p = W.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } for (const x of [6.5, 8.2, 9.6]) { const p = stab.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } } stB.add(K.staticWicks(wicks, 0.25, UB.wick)); }

  lap('geometry');
  // ---- paint + materials ------------------------------------------------------------------------------------------------------
  paintFuselage(A, { SC, fus, cFus, cSpon, cPanel, WIN });
  paintSurfaces(B, { SC, W: W.R, fin, stab: stab.R, cWT, cWB, cWl, cSt, cFin });
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
    for (const [nm, xs] of [['In', [5.6, 9.9]], ['Out', [13.0, 16.6]]]) {
      const main = C['flap' + nm], aft = C['aft' + nm], mesh = main.mesh.clone();
      for (const x of xs) { const cn = canoeAt(x, nm === 'In' ? 3.4 : 2.9, sx); stB.add(cn.front); mesh.add(cn.rear); }
      // double-slotted flap: the aft vane rides on the main flap and folds a further 20° down as a morph target
      const aftM = aft.mesh.clone().enableMorph(), al = drop(aft, 0.25);
      rotateMorph(aftM, al.a, al.b, aft.ref, DOWN, 20 * DEG);
      mesh.add(aftM);
      const line = drop(main, nm === 'In' ? 1.5 : 1.15, 0.1), node = rig.part(`flap${nm}${key}`, mesh, { key: 'wing', pivot: line.a });
      a['flap' + nm] = rig.hinge(node, line.a, line.b, { ref: main.ref, toward: DOWN });
      a['aft' + nm] = (v) => { node.morphTargetInfluences[0] = v; };
    }
    a.ail = rig.hingePart('aileron' + key, C.aileron, { key: 'wing' }).set;
    a.slat = hingeOn('slat' + key, K.merge(C.slat0.mesh, C.slat1.mesh, C.slat2.mesh), drop(C.slat1, 0.4, 0.15), C.slat1.ref, DOWN);
    a.spIn = hingeOn('spoilerIn' + key, K.merge(C.sp0.mesh, C.sp1.mesh, C.sp2.mesh, C.sp3.mesh), C.sp0.hinge, C.sp0.ref, UP);
    a.spOut = hingeOn('spoilerOut' + key, K.merge(C.sp4.mesh, C.sp5.mesh), C.sp4.hinge, C.sp4.ref, UP);
    a.elev = rig.hingePart('elevator' + key, stab[key].controls.elev, { key: 'wing' }).set;
    a.key = key; wingAnim.push(a);
  }
  const rudLo = rig.hingePart('rudderLower', fin.controls.rudLo, { key: 'wing', toward: [1, 0, 0] });
  const rudUp = rig.hingePart('rudderUpper', fin.controls.rudUp, { key: 'wing', toward: [1, 0, 0] });
  const fans = eng.map((e, i) => rig.part('fan' + i, e.fanMesh.translate(e.c[0], e.c[1], e.n.fanZ), { key: 'wing', pivot: [e.c[0], e.c[1], e.n.fanZ] }));
  const sleeves = rig.part('reversers', sleeveAll, { key: 'wing' });
  rig.addStatic(stB, 'wing');

  // ---- landing gear -----------------------------------------------------------------------------------------------------------
  const gp = G.gear, gearUV = { strut: A.swatch('gear.strut', F.gearWhite), hub: A.swatch('gear.hub', { color: '#8e9396', rough: 0.45, metal: 0.4 }) };
  const doorOf = (patch, edge) => ({ mesh: K.thicken(patch, 0.03, UA.well), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  K.buildGear(rig, A, {
    name: 'nose', index: 0, contact: gp[0].pos, wheels: [-0.33, 0.33], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.36, pivot: [0, -1.45, -17.7], stroke: 0.4, staticFrac: 0.4,
    strutR: 0.12, steer: true, links: 'front', retract: { to: [0, -1.55, -19.75] }, window: [0.2, 0.86], brace: [0, -1.65, -19.1], uv: gearUV, wheelSegments: 24,
    doors: [{ name: 'noseDoorR', ...doorOf(fus.patches.ngdR, fus.edges.ngdR.tHi), open: 88, closes: true }, { name: 'noseDoorL', ...doorOf(fus.patches.ngdL, fus.edges.ngdL.tLo), open: 88, closes: true }],
    lamps: [{ kind: 'taxi', pos: [0, -2.75, -18.42], size: 0.09, color: [1, 0.96, 0.9] }],
  });
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {               // two tandem legs per side, three wheels abreast each
    const c = gp[i].pos;
    [-1.05, 1.05].forEach((dz, j) => {
      const zc = c[2] + dz, P = [c[0] - sx * 0.1, -1.6, zc + 0.12];
      K.buildGear(rig, A, {
        name: `main${key}${j}`, index: i, contact: [c[0], c[1], zc], wheels: [-0.56, 0, 0.56], wheelRadius: gp[i].wheelRadius, wheelWidth: 0.44, pivot: P, stroke: 0.45, staticFrac: 0.4,
        strutR: 0.17, links: 'none', retract: { to: [sx * 4.8, -1.68, zc - 1.9] }, window: [0.2, 0.86], brace: [c[0] - sx * 0.9, -1.75, zc - 0.85], uv: gearUV, wheelSegments: 22,
        doors: j ? [] : [{ name: 'mainDoor' + key, ...doorOf(spon[key].patches.well, sx > 0 ? spon[key].edges.well.tHi : spon[key].edges.well.tLo), open: 100, closes: true }],
      });
    });
  }
  rig.addStatic(stA, 'paint');

  // ---- lamps ------------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.13, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.13, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.12 });
  for (const sx of [-1, 1]) { const p = W.R.at(TIPX - 0.05, 0.97, 'mid'); rig.lamp('strobe', [sx * p[0], p[1], p[2] + 0.05], { color: [1, 1, 1], size: 0.12 }); }
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.12 });
  rig.lamp('beacon', [0, hump.topAt(0) + 0.03, 0], { color: [1, 0.05, 0.03], size: 0.18, squash: [1, 0.6, 1] });
  rig.lamp('beacon', L.beacon, { color: [1, 0.05, 0.03], size: 0.18, squash: [1, 0.6, 1] });
  for (const sx of [-1, 1]) rig.lamp('landing', [sx * 0.75, L.landing[1], L.landing[2]], { color: [1, 0.97, 0.9], size: 0.2, squash: [1.4, 0.8, 0.5] });
  for (const sx of [-1, 1]) rig.lamp('landing', [sx * 4.3, -1.55, -8.0], { color: [1, 0.97, 0.9], size: 0.18, squash: [1.2, 0.9, 0.5] });   // sponson nose lights

  // ---- animation --------------------------------------------------------------------------------------------------------------
  const fanAng = [0, 0, 0, 0];
  rig.onUpdate((S, dt) => {
    const sf = S.sf, f = sf.flaps, sl = Math.max(sf.slats, 0);
    for (const a of wingAnim) {
      const R = a.key === 'R', ail = R ? sf.aileronR : sf.aileronL, sp = R ? sf.spoilerR : sf.spoilerL, el = R ? sf.elevatorR : sf.elevatorL;
      a.flapIn(f * 30 * DEG); a.flapOut(f * 30 * DEG); a.aftIn(f); a.aftOut(f);
      a.ail(ail * 22 * DEG - f * 6 * DEG);
      a.slat(sl * 25 * DEG);
      const sb = sf.speedbrake;
      a.spOut(Math.max(sp, sb * (S.onGround ? 1 : 0.7)) * 45 * DEG);
      a.spIn(Math.max(sp * 0.8, sb * (S.onGround ? 1 : 0.7)) * (S.onGround ? 55 : 45) * DEG);
      a.elev(el * 25 * DEG);
    }
    rudLo.set(sf.rudder * 30 * DEG); rudUp.set(sf.rudder * 30 * DEG);
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
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- paint: fuselage atlas ---------------------------------------------------------------------------------------------------
function paintFuselage(A, o) {
  const { SC, fus, cFus, cSpon, cPanel, WIN } = o, F = K.FINISH;
  const P = A.pen(cFus), S = A.pen(cSpon), body = F.matte(SC.body), mark = SC.mark, Z0 = NZ, Z1 = 27.6;
  P.fill('all', body); S.fill('all', body);
  if (SC.style === 'camo') camo(P, [Z0, Z1], [0, 1], SC.alt, 7, 1.0);
  // radome (dark grey) and its joint
  P.band(Z0, D(2.45), -Infinity, Infinity, F.matte(SC.radome), { step: 0.1 });
  P.ring(D(2.45), 0, 1, { px: 1.6, depth: 0.5, dark: 0.3 });
  // flight-deck windows: dark painted glass with a black surround
  for (const s of [1, -1]) {
    for (const w of Object.values(WIN)) {
      const t0 = s > 0 ? w.t[0] : 1 - w.t[1], t1 = s > 0 ? w.t[1] : 1 - w.t[0];
      const pts = [[w.z[0], t0], [w.z[1], t0], [w.z[1], t1], [w.z[0], t1]], path = (g) => { pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      P.stroke(path, 0, { color: '#202225', rough: 0.5, metal: 0 }, { join: 'round', px: 7 });
      P.fill(pts, F.paintedGlass);
      P.groove(path, { px: 1.2, depth: 0.5, dark: 0.2 });
    }
  }
  // doors: crew entry door (left, under the flight deck), paratroop doors (both sides, aft of the sponsons), escape hatches
  const door = { px: 1.4, depth: 0.6, dark: 0.4 };
  P.doorOn(D(6.35), D(7.3), -2.45, -0.3, { ...door, side: 'L', handle: true });
  P.windows([D(6.82)], -1.0, { w: 0.24, h: 0.24, r: 0.12, lit: 0, side: 'L' });
  P.doorOn(11.0, 12.05, -2.5, -0.25, { ...door, handle: true });
  P.windows([11.52], -0.85, { w: 0.3, h: 0.3, r: 0.15, lit: 0 });
  for (const z of [-12.5, 6.5]) P.windows([z], 1.0, { w: 0.34, h: 0.34, r: 0.17, lit: 0.2 });           // troop windows / emergency exits
  P.doorOn(-12.95, -12.05, 0.45, 1.6, { px: 1, depth: 0.4, dark: 0.25 }); P.doorOn(6.05, 6.95, 0.45, 1.6, { px: 1, depth: 0.4, dark: 0.25 });
  // cargo ramp and aft door outline on the upswept underside (t wraps through 0 at the bottom centre)
  { const tr = 0.105, zh = D(40.3), zm = D(46.3), ze = D(51.5), gap = { px: 2, depth: 0.8, dark: 0.5 };
    for (const s of [1, -1]) {
      const T = (t) => (s > 0 ? t : 1 - t);
      P.line([[zh, T(0)], [zh, T(tr)], [ze, T(tr * 1.12)], [ze, T(0)]], gap);
      P.line([[zm, T(0)], [zm, T(tr * 1.05)]], gap);
      P.fill([[zh + 0.3, T(0)], [zm - 0.2, T(0)], [zm - 0.2, T(tr * 0.85)], [zh + 0.3, T(tr * 0.85)]], { color: SC.body, rough: 0.8, metal: 0, height: 0.45 }, { alpha: 0.5 });
    } }
  // skin joints
  for (let z = -21; z < 26; z += 1.55) P.ring(z, 0, 1, { px: 1, depth: 0.3, dark: 0.07 });
  for (const y of [2.1, -1.8]) P.yLine(-19, 19, y, { px: 1, depth: 0.3, dark: 0.08 });
  P.yLine(-19, 26, (z) => Math.min(fus.topAt(z) - 0.25, 2.9), { px: 1, depth: 0.3, dark: 0.08 });
  // markings
  const lowVis = SC.mark;
  P.textOn('U.S. AIR FORCE', -14.2, 1.95, 'both', 0.62, { color: mark, font: K.FONT.sans, weight: 700, spacing: 0.1 });
  P.decalOn(-9.5, 0.35, 'both', (g) => K.drawStarBar(g, 1.25, { lowVis }));
  P.textOn('DANGER', D(4.2), -1.25, 'both', 0.08, { color: '#7a2622', weight: 700 });
  P.decalOn(10.0, -1.15, 'both', (g) => { g.strokeStyle = '#7a2622'; g.lineWidth = 0.02; g.beginPath(); g.moveTo(-0.35, 0); g.lineTo(0.25, 0); g.moveTo(0.12, -0.08); g.lineTo(0.27, 0); g.lineTo(0.12, 0.08); g.stroke(); });
  P.textOn('RESCUE', 10.0, -1.0, 'both', 0.07, { color: '#7a2622', weight: 700 });
  P.textOn(`AF ${SC.serial}`, D(6.8), 0.4, 'R', 0.12, { color: mark, weight: 700 });
  P.decalOn(D(4.6), -0.95, 'both', (g) => { g.fillStyle = '#5f6468'; g.beginPath(); g.ellipse(0, 0, 0.1, 0.07, 0, 0, TAU); g.fill(); });   // static ports
  P.decalOn(-1.0, 2.75, 'both', (g) => { g.fillStyle = 'rgba(20,22,24,0.35)'; g.fillRect(-0.5, -0.02, 1.0, 0.04); });
  // weathering
  const rnd = (() => { let a = 17; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  for (let i = 0; i < 36; i++) { const z = -15 + rnd() * 36, t = rnd() < 0.5 ? rnd() * 0.07 : 1 - rnd() * 0.07; P.streak(z, t, z + 1 + rnd() * 3, t, 0.006 + rnd() * 0.01, { alpha: 0.05 + rnd() * 0.07 }); }
  P.noise({ alpha: 0.04, scale: 3, stretch: [2, 1], rough: 0.05 }); P.noise({ alpha: 0.03, scale: 12, stretch: [2, 1] });
  // sponsons: gear-door outline, panel lines, landing-light window
  if (SC.style === 'camo') camo(S, [-9.5, 11.4], [0, 1], SC.alt, 3, 0.9);
  for (const z of [-7.0, -5.4, 5.6, 7.6]) S.ring(z, 0, 1, { px: 1, depth: 0.3, dark: 0.08 });
  S.decalOn(-8.0, -1.55, 'both', (g) => { g.fillStyle = '#d8dcd8'; g.beginPath(); g.ellipse(0, 0, 0.22, 0.16, 0, 0, TAU); g.fill(); });
  S.noise({ alpha: 0.04, scale: 3, stretch: [2, 1], rough: 0.05 });
  // instrument panel: five large multifunction displays
  {
    const Q = A.pen(cPanel); Q.fill('all', { color: '#3b3d3f', rough: 0.7, metal: 0 });
    const scr = (a, b, w, h, col) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#08090a', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(a + 0.012, b + 0.012, w - 0.024, h - 0.024), { color: col, rough: 0.15, metal: 0, emissive: col }); };
    for (const x0 of [0.15, 1.68]) { scr(x0, 0.2, 0.36, 0.3, '#0d2238'); scr(x0 + 0.4, 0.2, 0.36, 0.3, '#101a14'); }
    scr(1.12, 0.22, 0.36, 0.28, '#0f1a12');
    Q.fill((g) => g.rect(0.3, 0.02, 2.0, 0.1), { color: '#2a2b2d', rough: 0.6, metal: 0 });
    for (let i = 0; i < 12; i++) Q.fill((g) => g.rect(0.36 + i * 0.16, 0.04, 0.1, 0.05), { color: '#0a0a0a', rough: 0.2, metal: 0, emissive: i % 2 ? '#3a2a08' : '#000000' });
  }
}

/** Disruptive camouflage blobs of `col` on any pen (coordinates a in range ra, b in range rb). */
function camo(P, ra, rb, col, seed, scale) {
  let s = seed * 9301 + 49297; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const da = ra[1] - ra[0], db = rb[1] - rb[0], n = Math.round(da / (4 * scale)) + 4;
  for (let i = 0; i < n; i++) {
    const ca = ra[0] + rnd() * da, cb = rb[0] + rnd() * db, ra0 = (1.6 + rnd() * 2.4) * scale, rb0 = (0.12 + rnd() * 0.18) * db * (scale < 1 ? 1.4 : 1);
    const pts = []; for (let k = 0; k < 9; k++) { const a = k / 9 * TAU, r = 0.65 + rnd() * 0.5; pts.push([ca + Math.cos(a) * ra0 * r, cb + Math.sin(a) * rb0 * r]); }
    P.fill(pts, F_matte(col));
  }
}
const F_matte = (c) => K.FINISH.matte(c);

// ---- paint: wings, tail ---------------------------------------------------------------------------------------------------------
function paintSurfaces(B, o) {
  const { SC, W, fin, stab, cWT, cWB, cWl, cSt, cFin } = o, F = K.FINISH;
  const body = F.matte(SC.body), dark = F.matte(SC.radome), walk = F.matte('#1f2123');
  const line = { px: 1, depth: 0.35, dark: 0.12 }, gap = { px: 1.8, depth: 0.8, dark: 0.45 };
  const at = (x, f) => { const p = W.at(x, f); return [p[0], p[2]]; };
  const Ln = (name, x) => W.lines[name].at(W.spanToU(x));
  for (const [chart, top] of [[cWT, true], [cWB, false]]) {
    const Q = B.pen(chart); Q.fill('all', body);
    if (SC.style === 'camo') camo(Q, [0.5, 26], [-7, 8.4], SC.alt, top ? 11 : 12, 0.9);
    Q.fill([at(0.6, 0), at(TIPX, 0), at(TIPX, 0.02), at(0.6, 0.02)], { color: '#73787c', rough: 0.55, metal: 0.25 });   // LE erosion strip
    const seg = (name, xs, op) => Q.line(xs.map(x => at(x, Ln(name, x))), op);
    for (const [a, b] of [[3.55, 10.95], [11.15, 18.1]]) { seg('flap', [a, b], gap); seg('aft', [a, b], gap); Q.line([at(a, Ln('flap', a)), at(a, 1)], gap); Q.line([at(b, Ln('flap', b)), at(b, 1)], gap); }
    Q.line([at(18.3, 1), at(18.3, 0.7), at(23.85, 0.7), at(23.85, 1)], gap);
    for (const [a, b] of [[3.75, 7.55], [8.45, 16.05], [16.95, 23.95]]) Q.line([at(a, 0), at(a, 0.12), at(b, 0.12), at(b, 0)], gap);
    if (top) {
      for (const [a, b] of [[3.8, 5.55], [5.65, 7.4], [7.5, 9.2], [9.3, 10.9], [11.3, 14.6], [14.7, 17.95]]) Q.line([at(a, 0.7), at(a, 0.56), at(b, 0.56), at(b, 0.7)], gap);
      // walkway on the wing root and over the inboard wing
      const w0 = at(3.6, 0.2), w1 = at(3.6, 0.52), w2 = at(12, 0.52), w3 = at(12, 0.2);
      Q.stroke((g) => { g.moveTo(w0[0], w0[1]); g.lineTo(w3[0], w3[1]); g.moveTo(w1[0], w1[1]); g.lineTo(w2[0], w2[1]); }, 0.05, walk);
      for (const x of [9, 20]) { const p = at(x, 0.62); Q.text('NO STEP', p[0], p[1], 0.14, { color: SC.mark, font: K.FONT.sans }); }
      // exhaust soot behind the engines over the flaps
      for (const x of [8, 16.5]) { const a = at(x, 0.62); Q.streak(a[0], a[1], a[0], a[1] + 3.2, 1.2, { alpha: 0.12 }); }
    } else {
      for (let i = 0; i < 14; i++) { const x = 4 + i * 1.45, a = at(x, 0.66); Q.streak(a[0], a[1], a[0], a[1] + 1.6, 0.07, { alpha: 0.09 }); }
    }
    for (const f of [0.18, 0.42]) Q.line([at(1.2, f), at(TIPX - 0.2, f)], line);
    for (let x = 4.2; x < TIPX; x += 1.7) Q.line([at(x, 0.13), at(x, 0.55)], line);
    for (const f of [0.18, 0.42]) { const a = at(2, f + 0.006), b = at(23.5, f + 0.006); Q.rivets(a[0], a[1], b[0], b[1], 0.08, { px: 1.2, depth: 0.15, dark: 0.04 }); }
    Q.noise({ alpha: 0.05, scale: 3, stretch: [1, 2.5], rough: 0.05 }); Q.noise({ alpha: 0.03, scale: 11 });
  }
  { const Q = B.pen(cWl); Q.fill('all', body); if (SC.style === 'camo') camo(Q, [4.2, 8.6], [1.3, 4.9], SC.alt, 5, 0.5); Q.noise({ alpha: 0.04, scale: 3 }); }
  {
    const Q = B.pen(cSt); Q.fill('all', body);
    if (SC.style === 'camo') camo(Q, [0, 10.4], [20.8, 28.9], SC.alt, 21, 0.7);
    const sa = (x, f) => { const p = stab.at(x, f); return [p[0], p[2]]; };
    Q.fill([sa(0, 0), sa(9.9, 0), sa(9.9, 0.04), sa(0, 0.04)], { color: '#73787c', rough: 0.55, metal: 0.25 });
    Q.line([sa(0.75, 1), sa(0.75, 0.68), sa(9.6, 0.68), sa(9.6, 1)], gap);
    for (const f of [0.22, 0.46]) Q.line([sa(0.3, f), sa(9.7, f)], line);
    for (const x of [2.5, 4.5, 6.5, 8.5]) Q.line([sa(x, 0.05), sa(x, 0.67)], line);
    Q.noise({ alpha: 0.045, scale: 3, stretch: [1, 2], rough: 0.04 });
  }
  for (const key of ['L', 'R']) {
    const Q = B.pen(cFin[key]); Q.fill('all', body);
    if (SC.style === 'camo') camo(Q, [12.6, 27], [2.5, 13], SC.alt, key === 'L' ? 31 : 32, 0.9);
    const fa = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    if (SC.band) {                                                                // AMC base tail band near the top of the fin
      Q.fill([fa(10.3, -0.1), fa(11.25, -0.1), fa(11.25, 1.1), fa(10.3, 1.1)], F.matte(SC.band));
      Q.fill([fa(10.2, -0.1), fa(10.3, -0.1), fa(10.3, 1.1), fa(10.2, 1.1)], F.matte('#c8a234'));
      const c = fa(10.78, 0.4); Q.text(SC.bandText, c[0], c[1], 0.42, { color: '#e8e8e2', font: K.FONT.sans, weight: 700, spacing: 0.08 });
    }
    // flag (low-vis outline), serial, unit crest
    { const c = fa(9.0, 0.22); Q.decal(c[0], c[1], (g) => { g.strokeStyle = SC.mark; g.lineWidth = 0.03; g.strokeRect(-0.55, -0.3, 1.1, 0.6); for (let i = 1; i < 7; i++) { g.beginPath(); g.moveTo(-0.08, -0.3 + i * 0.086); g.lineTo(0.55, -0.3 + i * 0.086); g.stroke(); } g.strokeRect(-0.55, -0.3, 0.47, 0.32); }); }
    { const c = fa(7.2, 0.33); Q.text(`AF ${SC.serial.slice(0, 2)}`, c[0] - 0.9, c[1] + 0.2, 0.3, { color: SC.mark, font: K.FONT.sans, weight: 700 }); Q.text(SC.serial.replace('-', '').slice(1), c[0] + 0.5, c[1] - 0.2, 0.7, { color: SC.mark, font: K.FONT.sans, weight: 700 }); }
    { const c = fa(5.0, 0.35); Q.decal(c[0], c[1], (g) => { g.strokeStyle = SC.mark; g.lineWidth = 0.035; g.beginPath(); g.moveTo(-0.45, -0.5); g.lineTo(0.45, -0.5); g.lineTo(0.45, 0.1); g.quadraticCurveTo(0.4, 0.45, 0, 0.62); g.quadraticCurveTo(-0.4, 0.45, -0.45, 0.1); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(-0.3, 0.1); g.lineTo(0, -0.3); g.lineTo(0.3, 0.1); g.moveTo(-0.2, 0.25); g.lineTo(0.2, 0.25); g.stroke(); }); }
    Q.fill([fa(2.6, 0), fa(12.6, 0), fa(12.6, 0.025), fa(2.6, 0.025)], { color: '#73787c', rough: 0.55, metal: 0.25 });
    const fg = { px: 1.6, depth: 0.5, dark: 0.3 };
    Q.line([fa(3.3, 1), fa(3.3, 0.7), fa(7.75, 0.69), fa(7.75, 1)], fg); Q.line([fa(7.85, 1), fa(7.85, 0.69), fa(12.15, 0.68), fa(12.15, 1)], fg);
    const fl = { px: 1, depth: 0.18, dark: 0.07 };
    for (const y of [4.6, 6.2, 9.4, 11.0]) Q.line([fa(y, 0.7), fa(y, 1)], fl);
    for (const f of [0.22, 0.46]) Q.line([fa(2.8, f), fa(12.4, f)], fl);
    Q.noise({ alpha: 0.035, scale: 3 }); Q.noise({ alpha: 0.025, scale: 10 });
  }
}
