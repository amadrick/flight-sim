// Boeing C-17A Globemaster III — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (3.9 m) when parked.
//
// Reference numbers (docs/aircraft/c17.md; d = distance aft of the nose tip, z = d - 25.5):
//   length 53.04 m, span 51.75 m over the winglets, height 16.79 m (stabiliser / fin cap top at y = 12.89).
//   Fuselage: round-cornered box, half-width 3.4 m, top y 3.25, flat belly y -2.75 from d 10 to d 38; blunt radome
//   (tip y -0.35), windscreen d 2.7-3.85 on the sloping "forehead", eye d 4.4 / y 1.12; belly sweeps up from d 38 to the
//   beaver tail (y 1.7 at d 53) with the cargo ramp (d 40.3-46.3) and door (to d 51.5) on its underside.
//   Flight deck glazing (photos): two big flat windshields either side of a narrow centre post, a wrap-around corner pane,
//   two side windows, eyebrow windows in the roof above the windshields and a lower "chin" window at each pilot's feet.
//   Wing: LE at the body side z -5.5 (x 3.4), chord 10, LE sweep 25°, straight TE ~7° back, tip x 24.27 (chord 2.8),
//   3.5° anhedral (very visible head-on) from y 2.75 at the body side, supercritical 14 % -> 10 %, blended into a dorsal
//   wing-box fairing. Winglets: 3.0 m tall, canted 25° outward, LE ~40°, tip chord 1.2.
//   Engines (F117-PW-100 / PW2040): inlet highlights at geometry.engines[].intake (x ±8 / ±16.5), 36-blade titanium fan
//   Ø 2.1 m, cowl Ø 2.54 m, fan cowl 3.9 m (fixed inlet + fan-cowl doors, translating reverser sleeve over cascades) +
//   exposed core 1.2 m (core exit = geometry nozzle); slim forward-reaching pylons into the wing leading edge.
//   Tail: fin LE z 13.8 at the crown (y 2.9) to z 21.0 at y 12.55 (LE ~37°), root chord 11.6, tip 5.0, two-segment
//   rudder; stabiliser span 19.8, root chord 5.4 at z 21.0, tip chord 2.0, LE 30°, on top of the fin at y 12.65.
//   Gear: twin-wheel nose leg at z -18 retracting forward; each main unit = two tandem legs (z 0.95 / 3.05, i.e. centred
//   on the geometry contact point z 2) with three wheels abreast, swinging forward into the sponsons.
// Liveries: two USAF Air Mobility Command wings (different tail flashes) and a Royal Air Force aircraft. Serial numbers,
// unit names and crests are invented for this simulator.
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
export const LIVERIES = ['amc', 'mcchord', 'raf'];

// FS 36173 "AMC grey" for all three (the RAF aircraft were delivered in the same scheme)
const SCHEMES = {
  amc: { name: 'USAF Air Mobility Command (Charleston)', body: '#6a6f72', radome: '#646a6d', mark: '#2a2d30', nation: 'usaf', serial: '06-6159', band: '#1b2f5e', pin: '#c9a43a', bandText: 'CHARLESTON', crest: 'shield', weather: 0.75 },
  mcchord: { name: 'USAF Air Mobility Command (McChord)', body: '#6c7174', radome: '#666b6e', mark: '#2a2d30', nation: 'usaf', serial: '08-8203', band: '#24553a', pin: '#e2e2dc', bandText: 'McCHORD', crest: 'eagle', weather: 0.55 },
  raf: { name: 'Royal Air Force', body: '#6b7073', radome: '#656a6d', mark: '#33373a', nation: 'raf', serial: 'ZZ179', band: null, crest: 'raf', weather: 0.6 },
};

const NZ = -25.5;
const D = (d) => d + NZ;

// ---- planform helpers (right wing) ------------------------------------------------------------------------------------------
const TIPX = 24.27, ANH = Math.tan(3.5 * DEG);
const zLE = (x) => -5.5 + (x - 3.4) * Math.tan(25 * DEG);
const zTE = (x) => (x <= 3.4 ? 4.5 : 4.5 + (x - 3.4) * 0.127);
const wy = (x) => 2.75 - (x - 3.4) * ANH;
const NAC = { length: 3.9, rHi: 1.08, rMax: 1.27, rThroat: 1.02, rFan: 1.05, zFan: 0.72, rExit: 1.06, sleeve: 0.6, core: { r0: 0.74, r1: 0.5, length: 1.2 }, plug: { r: 0.3, length: 0.8 } };
const NAC_DROOP = 0.04;

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

/** Arc-length parameter of the kit nacelle's fold-over cowl loft at its stations (mirrors propulsion.js nacelle()), so the
 *  shared nacelle chart can be painted by axial position: returns { sIn (inside the lip), sLip, sOut (lip outside), zs, ss, sMax }. */
function nacelleS(N) {
  const L = N.length, sl = N.sleeve, zS = L * sl, rTh = N.rThroat, rAt = (z) => N.rMax - (N.rMax - N.rExit) * Math.pow(Math.max(0, (z - L * 0.4) / (L * 0.6)), 1.6);
  const st = [[N.zFan + L * 0.12, N.rFan, 0], [N.zFan, N.rFan, 0], [N.zFan * 0.6, (rTh + N.rFan) / 2, 0.3], [L * 0.06, rTh, 0.8], [0.012, N.rHi - 0.022, 1], [0, N.rHi, 1], [0.012, N.rHi + 0.022, 1]];
  for (const z of [L * 0.035, L * 0.1, L * 0.22, L * 0.4]) if (z < zS - 0.05) st.push([z, z > L * 0.3 ? rAt(z) : N.rHi + (N.rMax - N.rHi) * Math.sqrt(Math.min(1, z / (L * 0.3))), z < L * 0.3 ? 1 : 0.5]);
  st.push([zS, rAt(zS), 0.15]);
  const s = [0];
  for (let i = 1; i < st.length; i++) { const dz = st[i][0] - st[i - 1][0], dr = st[i][1] - st[i - 1][1], dy = -NAC_DROOP * (st[i][2] - st[i - 1][2]); s.push(s[i - 1] + Math.hypot(dz, dr, dr, dy)); }
  return { sIn: s[4], sLip: s[5], sOut: s[6], zs: st.slice(5).map(r => r[0]), ss: s.slice(5), sMax: s[s.length - 1] };
}

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'amc', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const rig = K.createRig(ctx, { geometry: G, name: 'c17', glassLayer: opts.glassLayer, cockpitRadius: 1.4 });
  const skin = F.matte(SC.body), NS = nacelleS(NAC);
  // big transport: frames ~0.5 m apart, thin skins that oil-can visibly in grazing light; line aircraft are well used
  const skinOpts = { weathering: SC.weather, framePitch: 0.5, waviness: 1.2 };

  // ---- atlases: A = fuselage, sponsons, flight deck, gear; B = wings, winglets, tail, nacelles ----------------------------------
  const A = K.createAtlas({ size: atlasSize, base: skin, swatchRows: 3, skin: skinOpts });
  const cFus = A.chart('fus', { type: 'unwrap', z: [NZ, 27.6], girth: 20.4, vScale: 0.85, strips: 2 });
  const cSpon = A.chart('spon', { type: 'unwrap', z: [-9.5, 11.6], girth: 10, vScale: 0.8, density: 0.8 });
  const cPanel = A.chart('panel', { type: 'rect', w: 2.6, h: 0.7, density: 1.8 });
  const cOver = A.chart('over', { type: 'rect', w: 0.9, h: 1.1, density: 1.2, ao: false });
  A.pack();
  const UA = {
    body: A.swatch('body', skin), dark: A.swatch('dark', F.darkGrey), black: A.swatch('black', F.black), well: A.swatch('well', { color: '#83888a', rough: 0.72, metal: 0.1 }),
    liner: A.swatch('liner', { color: '#6e716c', rough: 0.85, metal: 0 }), floor: A.swatch('floor', { color: '#2f3134', rough: 0.9, metal: 0 }), shield: A.swatch('shield', { color: '#1b1c1e', rough: 0.85, metal: 0 }),
    seat: A.swatch('seat', { color: '#3e4245', rough: 0.9, metal: 0 }), cushion: A.swatch('cushion', { color: '#4f4a3e', rough: 1, metal: 0 }), stick: A.swatch('stick', { color: '#151617', rough: 0.5, metal: 0 }),
    console: A.swatch('console', { color: '#3c4043', rough: 0.75, metal: 0 }), steel: A.swatch('steel', F.steel), antenna: A.swatch('antenna', F.matte(SC.body)), hud: A.swatch('hud', { color: '#26282a', rough: 0.5, metal: 0.3 }),
    wiper: A.swatch('wiper', { color: '#121314', rough: 0.55, metal: 0.2 }), lens: A.swatch('lens', F.lens), recv: A.swatch('recv', { color: '#2a2c2e', rough: 0.6, metal: 0.3 }),
    strut: A.swatch('gear.strut', F.gearWhite), hyd: A.swatch('hyd', { color: '#1d1e20', rough: 0.5, metal: 0.4 }), slime: A.swatch('slime', { color: '#b9c7a6', rough: 0.4, metal: 0 }),
  };
  const B = K.createAtlas({ size: atlasSize, base: skin, swatchRows: 3, skin: { ...skinOpts, weathering: SC.weather * 0.65 } });   // sun-facing wing tops chalk less than they grime
  const cWT = B.chart('wingTop', { type: 'plan', x: [0.5, 26.0], z: [-7.0, 8.4], view: 'top', mirror: true, density: 1.2 });
  const cWB = B.chart('wingBot', { type: 'plan', x: [0.5, 26.0], z: [-7.0, 8.4], view: 'bottom', mirror: true, density: 0.75 });
  const cWl = B.chart('winglet', { type: 'side', z: [4.2, 8.6], y: [0.9, 4.9], view: 'right', density: 0.9 });
  const cSt = B.chart('stab', { type: 'plan', x: [0, 10.4], z: [20.8, 28.9], view: 'top', mirror: true, density: 0.8 });
  const cFin = { L: B.chart('finL', { type: 'side', z: [12.6, 27.0], y: [2.5, 13.0], view: 'left' }), R: B.chart('finR', { type: 'side', z: [12.6, 27.0], y: [2.5, 13.0], view: 'right' }) };
  const cNac = B.chart('nac', { type: 'unwrap', z: [0, NS.sMax], girth: 8.0, vScale: 0.8, density: 0.9 });
  const cSlv = B.chart('sleeve', { type: 'unwrap', z: [0, 3.4], girth: 7.0, vScale: 0.8, density: 0.7 });
  B.pack();
  const UB = {
    grey: B.swatch('grey', skin), duct: B.swatch('duct', { color: '#232527', rough: 0.6, metal: 0.25 }),
    acoustic: B.swatch('acoustic', { color: '#5d6063', rough: 0.65, metal: 0.45 }), core: B.swatch('core', { color: '#5f6366', rough: 0.55, metal: 0.45 }), plug: B.swatch('plug', { color: '#5a5048', rough: 0.5, metal: 0.8 }),
    blade: B.swatch('blade', { color: '#6c7075', rough: 0.36, metal: 0.9 }), spinner: B.swatch('spinner', { color: '#26282b', rough: 0.35, metal: 0.4 }), swirl: B.swatch('swirl', { color: '#e8e8e4', rough: 0.4, metal: 0 }),
    inner: B.swatch('inner', { color: '#5d6264', rough: 0.75, metal: 0.15 }), cascade: B.swatch('cascade', { color: '#3a3c3f', rough: 0.6, metal: 0.7 }), wick: B.swatch('wick', F.black), canoe: B.swatch('canoe', skin),
    hot: B.swatch('hot', { color: '#6b6158', rough: 0.45, metal: 0.85 }), soot: B.swatch('soot', { color: '#3c3d3d', rough: 0.8, metal: 0.1 }), slime: B.swatch('slime', { color: '#b9c7a6', rough: 0.4, metal: 0 }),
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
  // flight-deck windows as (z, t) rectangles on the right half (t from 0 bottom centre .. 0.5 top centre); posts ~0.1 m
  const fus0 = K.loft({ stations: FS, segments: 32, step: 1.5 });
  const tAtX = (z, x) => { let lo = 0.25, hi = 0.5; for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (fus0.at(z, m).p[0] > x) lo = m; else hi = m; } return (lo + hi) / 2; };
  const tY = (z, y) => fus0.tAtY(z, y);
  const WIN = {
    front: { z: [D(2.72), D(3.8)], t: [tAtX(D(3.26), 0.98), tAtX(D(3.26), 0.06)] },
    corner: { z: [D(2.84), D(3.9)], t: [tAtX(D(3.37), 1.84), tAtX(D(3.37), 1.08)] },
    side: { z: [D(4.02), D(4.86)], t: [tY(D(4.44), 0.56), tY(D(4.44), 1.5)] },
    aft: { z: [D(4.96), D(5.5)], t: [tY(D(5.23), 0.72), tY(D(5.23), 1.42)] },
    brow: { z: [D(3.98), D(4.44)], t: [tAtX(D(4.21), 1.42), tAtX(D(4.21), 0.32)] },
    chin: { z: [D(4.04), D(4.62)], t: [tY(D(4.33), -0.12), tY(D(4.33), 0.36)] },
  };
  const fus = K.loft({
    stations: FS, segments: fseg, step: 1.25 / detail, chart: cFus, capEnd: 'flat', capUV: UA.dark,
    cutouts: [{ name: 'ngd', z: [-20.7, -17.0], t: [0, 0.042], mirror: true }],
  });
  cFus.body = fus;
  const stA = new K.Mesh(), stB = new K.Mesh();
  stA.add(fus.mesh);
  stA.add(K.well(K.merge(fus.patches.ngdR, fus.patches.ngdL), 1.2, UA.well, [0, 1, 0]));
  const onFus = (z, t, out = 0) => { const q = fus.at(z, t); return [q.p[0] + q.n[0] * out, q.p[1] + q.n[1] * out, q.p[2] + q.n[2] * out]; };

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
    .map(([z, x, y, w, top, bot]) => ({ z, x: sx * x, y, w, top: top * 1.4, bot, kTop: 0.47, kBot: [0.78, 0.95] }));
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
    const lin = K.loft({ stations: FS, segments: fseg, step: 0.25, tRange: [0.21, 0.79], zRange: [D(2.66), ZB], inflate: -0.07, flip: true, uv: UA.liner, cutouts: cuts });
    stA.add(lin.mesh.occlude(0.25));
    stA.add(K.deck(fus, D(2.7), ZB, FY, { uv: UA.floor, n: 8, inset: 0.08 }));
    stA.add(K.bulkhead(fus, ZB, { uv: UA.liner, facing: -1 }));
    stA.add(K.bulkhead(fus, D(2.7), { uv: UA.shield, facing: 1 }));
    const zp = eye[2] - 0.95;                                                             // main instrument panel plane
    stA.add(K.prism([[zp - 0.32, 0.6], [zp + 0.16, 0.68], [zp + 0.2, 0.65], [zp + 0.16, 0.6], [zp - 0.32, 0.52]], -1.3, 1.3, UA.shield));   // glareshield
    { const i0 = stA.vertexCount; for (const [a, b] of [[0, 0.7], [2.6, 0.7], [2.6, 0], [0, 0]]) { const uv = cPanel.uv(a, b); stA.vert(a - 1.3, -0.12 + (0.7 - b), zp + (0.7 - b) * 0.1, 0, 0.1, 1, uv[0], uv[1]); } stA.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    // overhead panel sloping up and aft from the windshield header
    { const i0 = stA.vertexCount, y0 = 1.72; for (const [a, b] of [[0, 0], [0.9, 0], [0.9, 1.1], [0, 1.1]]) { const uv = cOver.uv(a, b); stA.vert(a - 0.45, y0 + b * 0.22, zp + 0.42 + b, 0, -1, -0.2, uv[0], uv[1]); } stA.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    stA.add(K.box(0.95, 0.06, 1.15, UA.console).translate(0, 1.74 + 0.11, zp + 0.97));
    // centre console with the four throttle levers, side consoles, rudder pedals
    stA.add(K.box(0.5, 0.62, 1.15, UA.console).translate(0, FY + 0.31, zp + 0.68));
    for (let i = 0; i < 4; i++) stA.add(K.box(0.035, 0.17, 0.05, UA.stick).rotateX(-0.35).translate(-0.12 + i * 0.08, FY + 0.7, zp + 0.42));
    const huds = new K.Mesh();
    for (const sx of [-1, 1]) {
      const e = [sx * Math.abs(eye[0]), eye[1], eye[2]];
      stA.add(K.crewSeat({ eye: e, uv: { frame: UA.seat, cushion: UA.cushion } }));
      stA.add(K.stick({ base: [e[0], FY + 0.05, e[2] - 0.45], height: 0.55, uv: UA.stick, uvGrip: UA.stick }));    // centre sticks, not yokes
      stA.add(K.box(0.34, 0.55, 1.1, UA.console).translate(sx * 1.55, FY + 0.28, e[2] - 0.05));
      stA.add(K.box(0.22, 0.03, 0.3, UA.shield).translate(e[0], FY + 0.06, zp + 0.1));
      const h = K.hud({ eye: e, dist: 0.55, width: 0.2, height: 0.16, uv: UA.hud });
      stA.add(h.frame); huds.add(h.glass);
    }
    rig.glass('hud', K.glassMaterial(ctx, K.GLASS.hud));
    rig.addStatic(huds, 'hud');
    // windshield wipers parked at the foot of each windshield
    for (const sx of [-1, 1]) for (const xb of [0.34, 0.72]) {
      const za = D(2.76), zb = D(3.0), ta = tAtX(za, xb), tb = tAtX(zb, xb - 0.08), T = (t) => (sx > 0 ? t : 1 - t);
      stA.add(K.tube(onFus(za, T(ta), 0.022), onFus(zb, T(tb), 0.02), 0.008, 0.006, { segments: 5, uv: UA.wiper }));
      stA.add(K.box(0.05, 0.04, 0.07, UA.wiper).translate(...onFus(za - 0.04, T(ta), 0.02)));
    }
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
  const wlStations = [tipSt, ...K.blendedWinglet(tipSt, { height: 3.0, cant: 25, radius: 0.32, sweep: 40, tipChord: 1.2, tc: 0.085, n: 3, dihedral: -3.5 })];
  for (const side of [1, -1]) stB.add(K.wing({ side, airfoil: K.naca4('0010'), chordPts: 9, spanAxis: 'u', tip: 'round', tipLength: 0.5, charts: { upper: cWl, lower: cWl }, edgeUV: UB.grey, stations: wlStations }).mesh);
  const wlTop = wlStations[wlStations.length - 1];
  // vortex generators ahead of the ailerons (outboard upper surface, just behind the slat)
  for (const sx of [1, -1]) { const a = W.R.at(17.2, 0.16, 'upper'), b = W.R.at(23.4, 0.16, 'upper'); stB.add(K.vortexGenerators({ a: [sx * a[0], a[1] + 0.005, a[2]], b: [sx * b[0], b[1] + 0.005, b[2]], n: Math.round(26 * Math.min(1, detail)), height: 0.045, chord: 0.09, up: [sx * ANH, 1, 0], uv: UB.grey })); }
  // flap-track fairings ("canoes"): front part fixed under the wing, rear part rides on the main flap
  const canoeAt = (x, len, side) => {
    const zf = W.R.at(x, 0.7, 'lower'), z0 = zf[2] - len * 0.4, y = zf[1] - 0.06;
    const st = [[0, 0.01, 0.01], [0.12, 0.1, 0.12], [0.35, 0.15, 0.26], [0.62, 0.15, 0.27], [0.86, 0.09, 0.17], [1, 0.012, 0.02]].map(r => ({ z: z0 + r[0] * len, x: side * x, y: y - r[2] * 0.5 + (r[0] > 0.6 ? (r[0] - 0.6) * 0.3 : 0), w: r[1], top: r[2] * 0.6, bot: r[2] }));
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
  for (const e of G.engines) {
    const c = e.intake;
    const n = K.nacelle({ centre: c, ...NAC, droop: NAC_DROOP, segments: Math.max(28, Math.round(40 * detail / 4) * 4),
      chart: cNac, sleeveChart: cSlv, uv: UB.grey, uvInner: UB.acoustic, uvCore: UB.core, uvPlug: UB.plug, uvCascade: UB.cascade });
    stB.add(n.cowl).add(n.cascade).add(n.core).add(n.plug);
    stB.add(K.fanBackdrop(NAC.rFan, 0.4, UB.duct).translate(c[0], c[1], n.fanZ));
    // heat-stained core nozzle ring (the exposed core cowl ends in bare metal)
    { const z1 = NAC.length + NAC.core.length, r1 = NAC.core.r1; stB.add(K.lathe([[r1 * 1.08 + 0.004, z1 - 0.36], [r1 + 0.006, z1 + 0.004, 1], [r1 - 0.03, z1 + 0.004, 1]], { segments: 28, uv: UB.hot }).translate(c[0], c[1], c[2])); }
    const sl = n.sleeve.clone(); sl.enableMorph(); for (let i = 2; i < sl.p2.length; i += 3) sl.p2[i] += n.sleeveTravel;
    sleeveAll.add(sl);
    // pylon: slim strut from the fan cowl up and forward of the leading edge, under the wing to an aft fairing
    { const x = Math.abs(c[0]), yl = W.R.at(x, 0.25, 'lower')[1], zl = zLE(x);
      stB.add(K.pylon([{ y: c[1] + 1.12, z0: c[2] + 0.75, z1: c[2] + 5.3, x: c[0] }, { y: yl + 0.05, z0: zl - 1.75, z1: zl + 3.2, x: c[0] }], { uv: UB.grey, tc: 0.1 }));
      const z0 = zl + 2.2, len = (zTE(x) - zl) * 0.72, yb = W.R.at(x, 0.4, 'lower')[1] - 0.05;
      const st = [[0, 0.02, 0.02], [0.18, 0.24, 0.3], [0.5, 0.27, 0.36], [0.82, 0.16, 0.22], [1, 0.02, 0.04]].map(r => ({ z: z0 + r[0] * len, x: c[0], y: yb + r[0] * 0.25, w: r[1], top: 0.5, bot: r[2] }));
      stB.add(K.loft({ stations: st, segments: 14, step: 0.5, uv: UB.grey }).mesh);
      // pylon aft fairing closing the gap down onto the exposed core, with a heat-shield skin where the core exhaust passes
      { const z0 = c[2] + NAC.length - 0.15, z1 = c[2] + NAC.length + 1.45, yc = c[1];
        stB.add(K.prism([[z0, yc + 1.13], [z1, yc + 1.13], [z1 - 0.25, yc + 0.78], [z0 + 0.95, yc + 0.6], [z0 + 0.3, yc + 0.7], [z0, yc + 0.9]], c[0] - 0.13, c[0] + 0.13, UB.soot)); } }
    eng.push({ c, n, fanMesh: f117Fan({ radius: NAC.rFan - 0.012, hub: 0.38, uvBlade: UB.blade, uvSpinner: UB.spinner, uvSwirl: UB.swirl }) });
  }

  // ---- small details ----------------------------------------------------------------------------------------------------------
  for (const [z, h] of [[-15.4, 0.35], [-11.0, 0.25], [10.5, 0.3], [-2.0, 0.22]]) stA.add(K.bladeAntenna({ pos: [0, (z > -12 && z < 12 ? hump.topAt(z) : fus.topAt(z)) - 0.02, z], height: h, chord: 0.45, sweep: 0.2, uv: UA.antenna }));
  for (const z of [-12, 8, -19]) stA.add(K.bladeAntenna({ pos: [0, fus.botAt(z) + 0.02, z], height: 0.28, chord: 0.42, sweep: 0.18, down: true, uv: UA.antenna }));
  stA.add(K.ellipsoid(0.62, 0.24, 1.35, { segments: 16, rings: 7, uv: UA.antenna }).translate(0, fus.topAt(-13.1) - 0.02, -13.1));            // SATCOM fairing
  stA.add(K.ellipsoid(0.3, 0.09, 0.5, { segments: 10, rings: 4, uv: UA.antenna }).translate(0, hump.topAt(5.5) - 0.02, 5.5));               // GPS / UHF SATCOM puck aft of the wing box
  // dorsal air-refuelling receptacle (UARRSI) on the crown behind the flight deck: a recessed bowl with its doors open slightly
  { const z = D(7.6), y = fus.topAt(z); stA.add(K.box(0.62, 0.05, 0.9, UA.recv).translate(0, y - 0.015, z)); stA.add(K.box(0.5, 0.03, 0.1, UA.dark).translate(0, y + 0.01, z - 0.45)); }
  for (const sx of [-1, 1]) {                                                                         // pitot probes and AoA vanes on the nose
    const T = (t) => (sx > 0 ? t : 1 - t);
    for (const dy of [-0.5, -0.15]) { const z = D(2.0), p = fus.at(z, T(fus.tAtY(z, dy))).p; stA.add(K.probe(p, [p[0] + sx * 0.16, p[1], p[2] - 0.22], 0.016, UA.steel)); }
    { const z = D(2.5), p = onFus(z, T(fus.tAtY(z, 0.25))); stA.add(K.prism([[z - 0.08, p[1]], [z + 0.06, p[1]], [z + 0.03, p[1] + 0.12], [z - 0.06, p[1] + 0.1]], p[0] - 0.006, p[0] + 0.006, UA.dark).translate(sx * 0.04, 0, 0)); }   // AoA vane
    { const z = D(5.6), p = fus.at(z, T(fus.tAtY(z, -1.2))).p; stA.add(K.probe(p, [p[0] + sx * 0.08, p[1] - 0.02, p[2] - 0.08], 0.012, UA.steel)); }   // total-temperature probe
    // missile-warning / IR countermeasure fairings on the sponson fronts and the aft fuselage
    stA.add(K.ellipsoid(0.16, 0.16, 0.42, { segments: 10, rings: 5, uv: UA.antenna }).translate(sx * 4.95, -0.85, -6.4));
    { const z = 15.2, t = fus.tAtY(z, 0.4), p = onFus(z, T(t)); stA.add(K.ellipsoid(0.14, 0.18, 0.4, { segments: 10, rings: 5, uv: UA.antenna }).translate(p[0], p[1], p[2])); }
    // aft-fuselage strakes: two shallow vanes per side on the lower upswept body, ahead of the ramp hinge
    for (const [z0, y0] of [[12.6, -1.75], [13.2, -2.15]]) {
      const z1 = z0 + 3.4, ta = fus.tAtY(z0, y0), tb = fus.tAtY(z1, y0 + 0.55), a = onFus(z0, T(ta)), b = onFus(z1, T(tb)), na = fus.at(z0, T(ta)).n, nb = fus.at(z1, T(tb)).n, h = 0.32;
      const q = [a, b, [b[0] + nb[0] * h * 0.4, b[1] + nb[1] * h * 0.4, b[2]], [a[0] + na[0] * h, a[1] + na[1] * h, a[2] + 0.5]];
      stA.add(K.plate(q[0], q[1], q[2], q[3], 0.025, UA.body));
    }
  }
  { const wicks = []; for (const sx of [-1, 1]) { for (const x of [20, 21.8, 23.4]) { const p = W.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } for (const x of [6.5, 8.2, 9.6]) { const p = stab.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } } for (const y of [10.5, 12.0]) { const p = fin.at(y, 1, 'mid'); wicks.push(p); } stB.add(K.staticWicks(wicks, 0.25, UB.wick)); }

  lap('geometry');
  // ---- paint + materials ------------------------------------------------------------------------------------------------------
  paintFuselage(A, { SC, fus, cFus, cSpon, cPanel, cOver, WIN, hump });
  paintSurfaces(B, { SC, W: W.R, fin, stab: stab.R, cWT, cWB, cWl, cSt, cFin, cNac, cSlv, NS });
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
      const line = drop(main, nm === 'In' ? 1.5 : 1.15, 0.1), node = rig.part(`flap${nm}${key}`, mesh, { key: 'wing', pivot: line.a, ao: false });
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
  // both rudder segments move together on the common hinge line: one part
  const rud = rig.hingePart('rudder', fin.controls.rudUp, { key: 'wing', toward: [1, 0, 0], mesh: fin.controls.rudUp.mesh.clone().add(fin.controls.rudLo.mesh) });
  const fans = eng.map((e, i) => rig.part('fan' + i, e.fanMesh.translate(e.c[0], e.c[1], e.n.fanZ), { key: 'wing', pivot: [e.c[0], e.c[1], e.n.fanZ], ao: false }));
  const sleeves = rig.part('reversers', sleeveAll, { key: 'wing' });
  rig.addStatic(stB, 'wing');

  // ---- landing gear -----------------------------------------------------------------------------------------------------------
  const gp = G.gear, gearUV = { strut: UA.strut, hub: A.swatch('gear.hub', { color: '#8e9396', rough: 0.45, metal: 0.4 }) };
  const doorOf = (patch, edge) => ({ mesh: K.thicken(patch, 0.03, UA.well), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  {
    const ex = new K.Mesh();                                                   // nose-leg furniture: taxi-light bar, steering actuators
    ex.add(K.box(0.7, 0.08, 0.1, UA.dark).translate(0, -2.72, -18.36));
    for (const dx of [-0.16, 0.16]) ex.add(K.tube([dx, -1.75, -17.85], [dx * 1.2, -2.35, -18.05], 0.035, 0.03, { segments: 6, uv: UA.steel }));
    K.buildGear(rig, A, {
      name: 'nose', index: 0, contact: gp[0].pos, wheels: [-0.33, 0.33], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.36, pivot: [0, -1.45, -17.7], stroke: 0.4, staticFrac: 0.4,
      strutR: 0.12, steer: true, links: 'front', retract: { to: [0, -1.55, -19.75] }, window: [0.2, 0.86], brace: [0, -1.65, -19.1], uv: gearUV, wheelSegments: 24, extra: ex,
      doors: [{ name: 'noseDoorR', ...doorOf(fus.patches.ngdR, fus.edges.ngdR.tHi), open: 88, closes: true }, { name: 'noseDoorL', ...doorOf(fus.patches.ngdL, fus.edges.ngdL.tLo), open: 88, closes: true }],
      lamps: [{ kind: 'taxi', pos: [-0.22, -2.74, -18.42], size: 0.07, color: [1, 0.96, 0.9] }, { kind: 'taxi', pos: [0.22, -2.74, -18.42], size: 0.07, color: [1, 0.96, 0.9] }],
    });
  }
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {               // two tandem legs per side, three wheels abreast each
    const c = gp[i].pos;
    [-1.05, 1.05].forEach((dz, j) => {
      const zc = c[2] + dz, P = [c[0] - sx * 0.1, -1.6, zc + 0.12];
      // drag-brace actuator and the axle beam's hydraulic manifold ride on the leg
      const ex = new K.Mesh();
      ex.add(K.tube([c[0] - sx * 0.55, -1.75, zc - 0.7], [c[0] - sx * 0.2, -2.55, zc - 0.05], 0.06, 0.05, { segments: 8, uv: UA.steel }));
      ex.add(K.box(1.25, 0.12, 0.2, UA.strut).translate(c[0], -3.3 + 0.02, zc));
      ex.add(K.pipe([[P[0] + sx * 0.18, -1.7, zc + 0.12], [P[0] + sx * 0.2, -2.4, zc + 0.15], [c[0] + sx * 0.5, -3.18, zc + 0.12]], 0.018, { segments: 5, uv: UA.hyd }));
      K.buildGear(rig, A, {
        name: `main${key}${j}`, index: i, contact: [c[0], c[1], zc], wheels: [-0.56, 0, 0.56], wheelRadius: gp[i].wheelRadius, wheelWidth: 0.44, pivot: P, stroke: 0.45, staticFrac: 0.4,
        strutR: 0.17, links: j ? 'rear' : 'front', retract: { to: [sx * 4.8, -1.68, zc - 1.9] }, window: [0.2, 0.86], brace: [c[0] - sx * 0.9, -1.75, zc - 0.85], uv: gearUV, wheelSegments: 22, extra: ex,
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
  const wStrobe = [1, -1].map((sx) => { const p = W.R.at(TIPX - 0.05, 0.97, 'mid'); return [sx * p[0], p[1], p[2] + 0.05]; });
  for (const p of wStrobe) rig.lamp('strobe', p, { color: [1, 1, 1], size: 0.12 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.12 });
  const beaconTop = [0, hump.topAt(0) + 0.03, 0];
  rig.lamp('beacon', beaconTop, { color: [1, 0.05, 0.03], size: 0.18, squash: [1, 0.6, 1] });
  rig.lamp('beacon', L.beacon, { color: [1, 0.05, 0.03], size: 0.18, squash: [1, 0.6, 1] });
  for (const sx of [-1, 1]) rig.lamp('landing', [sx * 0.75, L.landing[1], L.landing[2]], { color: [1, 0.97, 0.9], size: 0.2, squash: [1.4, 0.8, 0.5] });
  const sponLand = [['L', -1], ['R', 1]].map(([k, sx]) => { const t = spon[k].tAtY(-8.3, -1.5), q = spon[k].at(-8.3, sx > 0 ? t : 1 - t); return [q.p[0] + q.n[0] * 0.03, q.p[1], q.p[2] + q.n[2] * 0.03]; });
  for (const p of sponLand) rig.lamp('landing', p, { color: [1, 0.97, 0.9], size: 0.18, squash: [1.2, 0.9, 0.5] });   // sponson nose lights
  // electroluminescent formation strips: forward fuselage below the flight deck, aft fuselage under the fin, winglet outer faces
  const slime = [0.18, 0.5, 0.16];
  const stripOn = (z, y, sx, len) => { const t = fus.tAtY(z, y), q = fus.at(z, sx > 0 ? t : 1 - t), m = K.box(0.012, 0.09, len, [0, 0]); m.rotateZ(Math.atan2(q.n[1], q.n[0])); return m.translate(q.p[0] + q.n[0] * 0.008, q.p[1] + q.n[1] * 0.008, q.p[2]); };
  for (const sx of [-1, 1]) {
    rig.lamp('formation', null, { mesh: stripOn(D(8.6), 0.15, sx, 0.9), color: slime });
    rig.lamp('formation', null, { mesh: stripOn(15.0, 1.9, sx, 0.9), color: slime });
    const a = wlStations[wlStations.length - 2], b = wlTop, nx = Math.cos(25 * DEG), ny = -Math.sin(25 * DEG), m = K.box(0.012, 0.09, 0.85, [0, 0]).rotateZ(Math.atan2(ny, sx * nx));
    rig.lamp('formation', null, { mesh: m.translate(sx * ((a.x + b.x) / 2 + nx * 0.07), (a.y + b.y) / 2 + ny * 0.07, (a.z + b.z) / 2 + 0.55), color: slime });
  }

  // ---- night halos: soft additive sprites so the lamps read at chase distance --------------------------------------------------
  const HALO = [
    { p: [L.navLeft[0] - 0.08, L.navLeft[1], L.navLeft[2]], c: [1, 0.05, 0.03], k: 'nav', s: 2.6 }, { p: [L.navRight[0] + 0.08, L.navRight[1], L.navRight[2]], c: [0.05, 1, 0.3], k: 'nav', s: 2.6 },
    { p: [L.tail[0], L.tail[1], L.tail[2] + 0.08], c: [1, 1, 1], k: 'nav', s: 2.0 },
    { p: wStrobe[0], c: [1, 1, 1], k: 'strobe', s: 4.5 }, { p: wStrobe[1], c: [1, 1, 1], k: 'strobe', s: 4.5 }, { p: L.strobe, c: [1, 1, 1], k: 'strobe', s: 4.0 },
    { p: [beaconTop[0], beaconTop[1] + 0.08, beaconTop[2]], c: [1, 0.1, 0.05], k: 'beacon', s: 3.2 }, { p: [L.beacon[0], L.beacon[1] - 0.08, L.beacon[2]], c: [1, 0.1, 0.05], k: 'beacon', s: 3.2 },
    { p: [-0.75, L.landing[1], L.landing[2] - 0.1], c: [1, 0.95, 0.85], k: 'landing', s: 3.5 }, { p: [0.75, L.landing[1], L.landing[2] - 0.1], c: [1, 0.95, 0.85], k: 'landing', s: 3.5 },
    { p: [sponLand[0][0], sponLand[0][1], sponLand[0][2] - 0.1], c: [1, 0.95, 0.85], k: 'landing', s: 3.2 }, { p: [sponLand[1][0], sponLand[1][1], sponLand[1][2] - 0.1], c: [1, 0.95, 0.85], k: 'landing', s: 3.2 },
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
  const haloCol = haloGeo.attributes.color;

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
    rud.set(sf.rudder * 30 * DEG);
    let rev = 0;
    for (let i = 0; i < 4; i++) {
      const e = S.eng[i] || {};
      fanAng[i] = (fanAng[i] + (e.n1 || 0) * 22 * dt) % TAU;
      fans[i].quaternion.set(0, 0, Math.sin(fanAng[i] / 2), Math.cos(fanAng[i] / 2));
      rev = Math.max(rev, e.reverser || 0);
    }
    sleeves.morphTargetInfluences[0] = rev;
    matA.emissiveIntensity = S.night * 2.4;
    const lt = S.lights || {}, nf = Math.max(0, Math.min(1, (S.night ?? 0) * 1.4 - 0.2)), t = S.t || 0;
    HALO.forEach((h, i) => {
      let on = 0;
      if (h.k === 'nav') on = lt.nav ? 1 : 0;
      else if (h.k === 'strobe') { const ph = t % 1.1; on = lt.strobe && (ph < 0.055 || (ph > 0.16 && ph < 0.215)) ? 1 : 0; }
      else if (h.k === 'beacon') { const ph = (t + 0.45) % 1.25; on = lt.beacon ? (ph < 0.16 ? Math.sin(ph / 0.16 * Math.PI) : 0) : 0; }
      else on = lt[h.k] && sf.gear > 0.98 ? 1 : 0;
      const I = on * nf * 0.9; haloCol.setXYZ(i, h.c[0] * I, h.c[1] * I, h.c[2] * I);
    });
    haloCol.needsUpdate = true; halo.visible = nf > 0.01;
  });
  const visual = rig.build();
  visual.object3D.add(halo);
  rig.disposables.push(haloGeo, haloMat);
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- F117 fan: 36 narrow titanium blades with a part-span look, conical black spinner with a white spiral -------------------
function f117Fan(o) {
  const m = K.fan({ radius: o.radius, hub: o.hub, blades: 36, chord: 0.3, staggerRoot: 32, staggerTip: 64, sweep: 0.1, uvBlade: o.uvBlade, uvSpinner: o.uvSpinner });
  const sl = o.radius * 0.55, hub = o.hub, prof = [[0, -sl], [hub * 0.35, -sl * 0.82], [hub * 0.72, -sl * 0.42], [hub, 0.02]];
  const rAt = (z) => { for (let i = 1; i < prof.length; i++) if (z <= prof[i][1]) { const a = prof[i - 1], b = prof[i], f = (z - a[1]) / (b[1] - a[1]); return a[0] + (b[0] - a[0]) * f; } return hub; };
  const pts = [];
  for (let k = 0; k <= 16; k++) { const f = 0.08 + 0.88 * k / 16, z = -sl * (1 - f), r = rAt(z) + 0.012, a = 3.2 * f; pts.push([r * Math.cos(a), r * Math.sin(a), z]); }
  m.add(K.pipe(pts, 0.03, { segments: 5, uv: o.uvSwirl }));
  return m;
}

// ---- paint: fuselage atlas ---------------------------------------------------------------------------------------------------
function paintFuselage(A, o) {
  const { SC, fus, cFus, cSpon, cPanel, cOver, WIN } = o, F = K.FINISH;
  const P = A.pen(cFus), S = A.pen(cSpon), body = F.matte(SC.body), mark = SC.mark, Z0 = NZ, Z1 = 27.6, wx = SC.weather;
  const rnd = (() => { let a = 17 + SC.serial.length * 31; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const line = { px: 1, depth: 0.3, dark: 0.07 }, fine = { px: 0.8, depth: 0.22, dark: 0.05 }, riv = { px: 1, depth: 0.12, dark: 0.03 };
  const door = { px: 1.4, depth: 0.6, dark: 0.38 }, gap = { px: 2, depth: 0.8, dark: 0.5 };
  P.fill('all', body); S.fill('all', body);
  // touched-up / faded panels: a patchwork of slightly different greys, the signature of a well-used AMC jet
  for (let i = 0; i < 26; i++) {
    const z = -19 + rnd() * 38, t = 0.08 + rnd() * 0.36, w = 0.8 + rnd() * 2.2, h = 0.012 + rnd() * 0.03, sd = rnd() < 0.5 ? 1 : -1;
    const tt = sd > 0 ? t : 1 - t - h;
    P.fill([[z, tt], [z + w, tt], [z + w, tt + h], [z, tt + h]], F.matte(rnd() < 0.5 ? '#767b7e' : '#62676a'), { alpha: (0.25 + rnd() * 0.35) * wx });
  }
  // radome (slightly darker, smoother composite) and its joint
  P.band(Z0, D(2.45), -Infinity, Infinity, { color: SC.radome, rough: 0.64, metal: 0 }, { step: 0.1 });
  P.ring(D(2.45), 0, 1, { px: 1.6, depth: 0.5, dark: 0.3 });
  P.ring(D(0.9), 0, 1, { px: 0.8, depth: 0.2, dark: 0.08 });
  // flight-deck windows: dark painted glass, black sealant edge, thin grey frames between the panes
  for (const s of [1, -1]) {
    for (const w of Object.values(WIN)) {
      const t0 = s > 0 ? w.t[0] : 1 - w.t[1], t1 = s > 0 ? w.t[1] : 1 - w.t[0];
      const pts = [[w.z[0], t0], [w.z[1], t0], [w.z[1], t1], [w.z[0], t1]], path = (g) => { pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      P.stroke(path, 0, { color: '#1c1e20', rough: 0.5, metal: 0 }, { join: 'round', px: 3.2 });
      P.fill(pts, F.paintedGlass);
      P.groove(path, { px: 1.1, depth: 0.55, dark: 0.25 });
      // frame fasteners around the pane
      P.rivets(w.z[0] - 0.035, t0 - 0.004 * s, w.z[1] + 0.035, t0 - 0.004 * s, 0.06, riv); P.rivets(w.z[0] - 0.035, t1 + 0.004 * s, w.z[1] + 0.035, t1 + 0.004 * s, 0.06, riv);
    }
  }
  // doors: crew entry door (left, under the flight deck) with its step, paratroop doors (both sides, aft of the sponsons),
  // overwing / flight-deck escape hatches, emergency exits
  P.doorOn(D(6.35), D(7.3), -2.45, -0.3, { ...door, side: 'L', handle: true });
  P.windows([D(6.82)], -1.0, { w: 0.24, h: 0.24, r: 0.12, lit: 0, side: 'L' });
  P.doorOn(D(6.2), D(7.45), -2.62, -2.48, { ...fine, side: 'L' });
  P.doorOn(11.0, 12.05, -2.5, -0.25, { ...door, handle: true });
  P.windows([11.52], -0.85, { w: 0.3, h: 0.3, r: 0.15, lit: 0 });
  P.doorOn(10.3, 10.9, -2.45, -0.6, { ...fine });                                                       // retracted air deflector
  for (const z of [-12.5, 6.5]) P.windows([z], 1.0, { w: 0.34, h: 0.34, r: 0.17, lit: 0.2 });
  P.doorOn(-12.95, -12.05, 0.45, 1.6, { px: 1, depth: 0.4, dark: 0.25 }); P.doorOn(6.05, 6.95, 0.45, 1.6, { px: 1, depth: 0.4, dark: 0.25 });
  for (const z of [-16.2, -12.5, 8.0]) P.decalT(z, 0.5, { layers: ['color', 'height'] }, (g, layer) => { g.strokeStyle = layer === 'height' ? 'rgba(0,0,0,0.5)' : 'rgba(20,22,24,0.45)'; g.lineWidth = 0.025; g.strokeRect(-0.45, -0.38, 0.9, 0.76); });   // top hatches
  // cargo ramp and aft door outline on the upswept underside (t wraps through 0 at the bottom centre), hinge line, lock seams
  { const tr = 0.105, zh = D(40.3), zm = D(46.3), ze = D(51.5);
    for (const s of [1, -1]) {
      const T = (t) => (s > 0 ? t : 1 - t);
      P.line([[zh, T(0)], [zh, T(tr)], [ze, T(tr * 1.12)], [ze, T(0)]], gap);
      P.line([[zm, T(0)], [zm, T(tr * 1.05)]], gap);
      P.line([[zh + 0.12, T(0)], [zh + 0.12, T(tr * 0.95)]], fine);
      for (const f of [0.35, 0.7]) P.line([[zh + 0.3, T(tr * f)], [zm - 0.3, T(tr * f)]], fine);
      for (const z of [zh + 1.2, zh + 2.6, zh + 4.0]) P.line([[z, T(0.01)], [z, T(tr * 0.9)]], fine);
      P.fill([[zh + 0.3, T(0)], [zm - 0.2, T(0)], [zm - 0.2, T(tr * 0.85)], [zh + 0.3, T(tr * 0.85)]], { color: SC.body, rough: 0.8, metal: 0, height: 0.45 }, { alpha: 0.5 });
      P.rivets(zh + 0.05, T(tr + 0.006), ze, T(tr * 1.12 + 0.006), 0.07, riv);
    } }
  // skin joints: circumferential butt joints with rivet rows, longitudinal laps, frames as faint fastener lines
  for (let z = -21; z < 26; z += 1.55) { P.ring(z, 0, 1, line); P.rivets(z + 0.03, 0.02, z + 0.03, 0.98, 0.075, riv); }
  for (let z = -20.2; z < 22; z += 0.52) P.rivets(z, 0.07, z, 0.43, 0.11, { px: 0.8, depth: 0.08, dark: 0.02 });
  for (const y of [2.1, 0.8, -0.9, -1.8]) P.yLine(-19, 19, y, line);
  P.yLine(-19, 26, (z) => Math.min(fus.topAt(z) - 0.25, 2.9), line);
  // access panels: avionics bays under the flight deck, around the nose gear, below the wing root, aft equipment bays
  const panelOn = (z0, z1, y0, y1, side = 'both') => P.doorOn(z0, z1, y0, y1, { px: 0.9, depth: 0.35, dark: 0.12, side });
  for (const [z0, z1, y0, y1] of [[-22.4, -21.6, -1.6, -1.0], [-20.2, -19.2, -2.2, -1.6], [-16.2, -15.4, -2.3, -1.8], [-14.6, -13.2, -2.4, -2.0], [-9.2, -8.6, 1.6, 2.0], [9.0, 9.8, -2.3, -1.6], [13.5, 14.6, 0.6, 1.2], [17.5, 18.4, 1.4, 2.0], [20.0, 21.2, 1.9, 2.4]]) panelOn(z0, z1, y0, y1);
  for (let i = 0; i < 12; i++) { const z = -19 + rnd() * 36, y = -2.0 + rnd() * 3.5; P.doorOn(z, z + 0.25 + rnd() * 0.3, y, y + 0.2 + rnd() * 0.15, { px: 0.7, depth: 0.25, dark: 0.08 }); }
  // walkway on the crown from the flight-deck hatch aft to the wing box (two black lines), NO STEP warnings beside it
  for (const dt of [-0.016, 0.016]) P.stroke((g) => { g.moveTo(-17, 0.5 + dt); g.lineTo(-11.4, 0.5 + dt); }, 0, F.matte('#1e2022'), { px: 1.6 });
  for (const z of [-15, -12.5]) for (const s of [1, -1]) P.decalT(z, 0.5 + s * 0.032, { rot: 90 * s }, (g) => K.drawText(g, 'NO STEP', 0.07, { color: mark, weight: 700 }));
  // dorsal air-refuelling receptacle: slipway outline, dark receptacle doors, white lead-in lines forward along the crown
  { const z = D(7.6);
    P.decalT(z, 0.5, { layers: ['color', 'height', 'orm'] }, (g, layer) => {
      if (layer === 'color') { g.fillStyle = '#2a2c2e'; g.fillRect(-0.48, -0.33, 0.96, 0.66); g.strokeStyle = '#d8dad6'; g.lineWidth = 0.04; g.strokeRect(-0.62, -0.47, 1.24, 0.94); }
      else if (layer === 'height') { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(-0.48, -0.33, 0.96, 0.66); }
      else { g.fillStyle = 'rgb(255,150,60)'; g.fillRect(-0.48, -0.33, 0.96, 0.66); }
    });
    P.decalT(z - 1.45, 0.5, (g) => { g.fillStyle = '#d8dad6'; g.fillRect(-0.6, -0.025, 0.5, 0.05); g.fillRect(0.05, -0.025, 0.7, 0.05); for (const y of [-0.3, 0.3]) g.fillRect(-0.3, y - 0.02, 1.0, 0.04); }); }
  // markings
  const title = (str, z, y, h) => P.textOn(str, z, y, 'both', h, { color: mark, font: K.FONT.sans, weight: 700, spacing: 0.1 });
  if (SC.nation === 'usaf') {
    title('U.S. AIR FORCE', -13.8, 2.0, 0.62);
    P.decalOn(8.6, 0.9, 'both', (g) => K.drawStarBar(g, 1.35, { lowVis: mark }));
    P.textOn(`AF ${SC.serial}`, D(8.4), -1.35, 'R', 0.12, { color: mark, weight: 700 });
    P.textOn(SC.serial.slice(-4), D(6.0), -2.15, 'both', 0.2, { color: mark, weight: 700 });                 // last four on the nose-gear doors' side
  } else {
    title('ROYAL AIR FORCE', -13.8, 2.0, 0.55);
    P.decalOn(-9.6, 0.9, 'both', (g) => roundel(g, 0.85));
    P.textOn(SC.serial, 15.5, 0.2, 'both', 0.42, { color: mark, font: K.FONT.sans, weight: 700 });
    P.textOn(SC.serial, D(6.0), -2.15, 'both', 0.18, { color: mark, weight: 700 });
  }
  // stencils: danger zones, rescue access, ground / jacking points, static ports, placards
  const red = '#7a2622';
  P.textOn('DANGER', D(4.2), -1.25, 'both', 0.08, { color: red, weight: 700 });
  P.decalOn(D(4.2), -1.4, 'both', (g) => { g.fillStyle = red; g.fillRect(-0.4, -0.012, 0.8, 0.024); });
  for (const [z, y] of [[10.0, -1.0], [-14.6, 0.2]]) {
    P.decalOn(z, y - 0.15, 'both', (g) => { g.strokeStyle = red; g.lineWidth = 0.02; g.beginPath(); g.moveTo(-0.35, 0); g.lineTo(0.25, 0); g.moveTo(0.12, -0.08); g.lineTo(0.27, 0); g.lineTo(0.12, 0.08); g.stroke(); });
    P.textOn('RESCUE', z, y, 'both', 0.07, { color: red, weight: 700 });
    P.textOn('PULL HANDLE  OPEN DOOR', z, y - 0.3, 'both', 0.035, { color: mark, weight: 700 });
  }
  for (const [z, y] of [[D(4.6), -0.95], [D(5.0), -0.95]]) P.decalOn(z, y, 'both', (g) => { g.fillStyle = '#5a5f62'; g.beginPath(); g.ellipse(0, 0, 0.1, 0.07, 0, 0, TAU); g.fill(); g.strokeStyle = red; g.lineWidth = 0.012; g.strokeRect(-0.17, -0.13, 0.34, 0.26); });
  for (const [z, y, s] of [[-17.2, -2.3, 'GROUND HERE'], [1.5, -2.0, 'JACK PAD'], [-6.0, 1.2, 'NO STEP'], [12.8, 1.8, 'NO STEP'], [-20.5, 0.4, 'OXYGEN SERVICE'], [-10.5, -2.2, 'EXTERNAL POWER'], [7.0, -2.25, 'SINGLE POINT REFUEL'], [-3.0, -2.25, 'WATER SERVICE']]) {
    P.textOn(s, z, y, 'both', 0.045, { color: mark, weight: 700 });
    P.decalOn(z, y - 0.1, 'both', (g) => { g.fillStyle = mark; g.globalAlpha = 0.7; for (let i = 0; i < 3; i++) g.fillRect(-0.2, i * 0.03, 0.4 - i * 0.08, 0.012); });
  }
  for (let i = 0; i < 26; i++) { const z = -20 + rnd() * 40, y = -2.3 + rnd() * 4.2; P.decalOn(z, y, rnd() < 0.5 ? 'L' : 'R', (g) => { g.fillStyle = mark; g.globalAlpha = 0.55; g.fillRect(-0.08, -0.012, 0.16, 0.01); g.fillRect(-0.08, 0.006, 0.11, 0.008); }); }
  P.decalOn(-1.0, 2.75, 'both', (g) => { g.fillStyle = 'rgba(20,22,24,0.35)'; g.fillRect(-0.5, -0.02, 1.0, 0.04); });
  // weathering: grime streaks from the belly drains and the sponson tops, hydraulic stains behind the wing root and gear,
  // dirt around the crew door and paratroop doors, exhaust-free but sun-faded crown
  for (let i = 0; i < 46; i++) { const z = -18 + rnd() * 38, t = rnd() < 0.5 ? rnd() * 0.08 : 1 - rnd() * 0.08; P.streak(z, t, z + 1.2 + rnd() * 3.5, t, 0.006 + rnd() * 0.012, { alpha: (0.06 + rnd() * 0.1) * (0.5 + wx) }); }
  for (let i = 0; i < 20; i++) { const z = 4 + rnd() * 6, t = 0.22 + rnd() * 0.06, s = rnd() < 0.5; P.streak(z, s ? t : 1 - t, z + 2 + rnd() * 3, s ? t - 0.02 : 1 - t + 0.02, 0.008 + rnd() * 0.01, { color: '34,30,24', alpha: (0.1 + rnd() * 0.1) * wx, rough: 0.06 }); }
  P.fill((g) => { g.rect(D(6.2), 0.86, 1.4, 0.06); }, { color: '#3a3936' }, { alpha: 0.18 * wx, feather: 14 });
  for (const s of [1, -1]) P.fill((g) => g.rect(10.9, s > 0 ? 0.13 : 0.79, 1.3, 0.08), { color: '#3a3936' }, { alpha: 0.15 * wx, feather: 14 });
  P.fill((g) => g.rect(-19, 0.44, 38, 0.12), { color: '#8a8f92' }, { alpha: 0.12 * wx, feather: 30 });
  P.noise({ alpha: 0.05, scale: 3, stretch: [2, 1], rough: 0.06 }); P.noise({ alpha: 0.035, scale: 12, stretch: [2, 1] });
  // sponsons: gear-door outlines, panel lines, recessed landing-light lens, brake / hydraulic grime around the wells
  for (const z of [-7.0, -5.4, -1.85, 3.95, 5.6, 7.6, 9.6]) { S.ring(z, 0, 1, line); S.rivets(z + 0.03, 0.02, z + 0.03, 0.98, 0.07, riv); }
  for (const t of [0.12, 0.3, 0.42, 0.58, 0.7, 0.88]) S.line([[-7.0, t], [9.6, t]], fine);
  for (const s of [1, -1]) {
    const T = (t) => (s > 0 ? t : 1 - t);
    S.line([[4.0, T(0.08)], [9.0, T(0.08)], [9.0, T(0.2)], [4.0, T(0.2)], [4.0, T(0.08)]], door);          // aft gear doors
    S.line([[-4.6, T(0.08)], [-2.0, T(0.08)], [-2.0, T(0.2)], [-4.6, T(0.2)], [-4.6, T(0.08)]], door);      // forward gear doors
    for (const z of [-4.2, 4.5, 8.4]) S.panel(z, T(0.3), z + 0.5, T(0.36), { px: 0.8, depth: 0.3, dark: 0.1 });
  }
  S.decalOn(-8.3, -1.5, 'both', { layers: ['color', 'orm', 'height'] }, (g, layer) => {
    g.beginPath(); g.ellipse(0, 0, 0.22, 0.17, 0, 0, TAU);
    if (layer === 'color') { g.fillStyle = '#1d2024'; g.fill(); g.strokeStyle = '#2a2c2e'; g.lineWidth = 0.03; g.stroke(); }
    else if (layer === 'orm') { g.fillStyle = 'rgb(255,25,0)'; g.fill(); }
    else { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fill(); }
  });
  S.textOn('NO STEP', 0.5, -0.1, 'both', 0.06, { color: mark, weight: 700 });
  for (let i = 0; i < 18; i++) { const z = -2 + rnd() * 10, t = 0.04 + rnd() * 0.14, s = rnd() < 0.5; S.streak(z, s ? t : 1 - t, z + 1 + rnd() * 2.5, s ? t : 1 - t, 0.01, { color: '30,27,22', alpha: (0.12 + rnd() * 0.12) * wx, rough: 0.05 }); }
  S.fill((g) => { g.rect(-2.2, 0.0, 6.6, 0.24); g.rect(-2.2, 0.76, 6.6, 0.24); }, { color: '#34322e' }, { alpha: 0.22 * wx, feather: 18 });
  S.noise({ alpha: 0.05, scale: 3, stretch: [2, 1], rough: 0.05 });
  // instrument panel: five large multifunction displays, standby instruments, annunciator strip
  {
    const Q = A.pen(cPanel); Q.fill('all', { color: '#3b3d3f', rough: 0.7, metal: 0 });
    const scr = (a, b, w, h, col, sym) => {
      Q.fill((g) => g.rect(a, b, w, h), { color: '#08090a', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(a + 0.012, b + 0.012, w - 0.024, h - 0.024), { color: col, rough: 0.15, metal: 0, emissive: col });
      const em = (fn, c) => Q.fill(fn, { color: c, rough: 0.1, metal: 0, emissive: c });
      if (sym === 'adi') { em((g) => g.rect(a + 0.03, b + h * 0.5, w - 0.06, h * 0.4), '#3a2a12'); em((g) => g.rect(a + 0.03, b + h * 0.5 - 0.003, w - 0.06, 0.006), '#e8e8e0'); em((g) => g.rect(a + w / 2 - 0.04, b + h * 0.48, 0.08, 0.008), '#e0c020'); }
      else if (sym === 'map') { for (let k = 0; k < 3; k++) em((g) => { g.arc(a + w / 2, b + h * 0.85, 0.06 + k * 0.06, Math.PI, TAU); g.arc(a + w / 2, b + h * 0.85, 0.055 + k * 0.06, TAU, Math.PI, true); }, '#40c0e0'); em((g) => g.rect(a + w / 2 - 0.006, b + h * 0.7, 0.012, 0.04), '#e8e8e0'); }
      else for (let k = 0; k < 6; k++) em((g) => g.rect(a + 0.03, b + 0.03 + k * h * 0.13, w * (0.3 + (k % 3) * 0.15), 0.006), k % 2 ? '#30d060' : '#e8e8e0');
      for (let k = 0; k < 5; k++) for (const bb of [b - 0.012, b + h + 0.004]) Q.fill((g) => g.rect(a + 0.03 + k * (w - 0.06) / 4.2, bb, 0.022, 0.008), { color: '#151617', rough: 0.4, metal: 0 });
    };
    for (const x0 of [0.15, 1.68]) { scr(x0, 0.2, 0.36, 0.3, '#0d1d30', 'adi'); scr(x0 + 0.4, 0.2, 0.36, 0.3, '#0c1a14', 'map'); }
    scr(1.12, 0.22, 0.36, 0.28, '#0f1a12', 'eng');
    Q.fill((g) => g.rect(0.3, 0.02, 2.0, 0.1), { color: '#2a2b2d', rough: 0.6, metal: 0 });
    for (let i = 0; i < 12; i++) Q.fill((g) => g.rect(0.36 + i * 0.16, 0.04, 0.1, 0.05), { color: '#0a0a0a', rough: 0.2, metal: 0, emissive: i % 2 ? '#3a2a08' : '#000000' });
    for (const a of [0.98, 1.52]) Q.fill((g) => g.arc(a, 0.58, 0.045, 0, TAU), { color: '#0a0b0c', rough: 0.2, metal: 0, emissive: '#101418' });
  }
  // overhead panel: rows of switch panels with white legends and a few amber annunciators
  {
    const Q = A.pen(cOver); Q.fill('all', { color: '#3a3d40', rough: 0.75, metal: 0 });
    for (let r = 0; r < 7; r++) for (let c = 0; c < 4; c++) {
      const a = 0.04 + c * 0.215, b = 0.05 + r * 0.15;
      Q.fill((g) => g.rect(a, b, 0.2, 0.13), { color: '#2b2e31', rough: 0.7, metal: 0 }); Q.groove((g) => g.rect(a, b, 0.2, 0.13), { px: 1, depth: 0.4, dark: 0.3 });
      for (let k = 0; k < 4; k++) { Q.fill((g) => g.arc(a + 0.03 + k * 0.045, b + 0.07, 0.011, 0, TAU), { color: '#0c0c0d', rough: 0.4, metal: 0.3 }); Q.fill((g) => g.rect(a + 0.02 + k * 0.045, b + 0.1, 0.022, 0.004), { color: '#d0d0c8', rough: 0.6, metal: 0, emissive: '#2a2a26' }); }
      if ((r + c) % 3 === 0) Q.fill((g) => g.rect(a + 0.05, b + 0.015, 0.1, 0.025), { color: '#2a2008', rough: 0.2, metal: 0, emissive: '#3a2a06' });
    }
  }
}

/** RAF low-visibility roundel (pink-red / pale blue) at the origin, diameter 2r. */
function roundel(g, r) {
  g.fillStyle = '#5a6d8c'; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  g.fillStyle = '#b06a70'; g.beginPath(); g.arc(0, 0, r * 0.5, 0, TAU); g.fill();
}

// ---- paint: wings, tail, nacelles -------------------------------------------------------------------------------------------------
function paintSurfaces(B, o) {
  const { SC, W, fin, stab, cWT, cWB, cWl, cSt, cFin, cNac, cSlv, NS } = o, F = K.FINISH;
  const body = F.matte(SC.body), walk = F.matte('#1f2123'), mark = SC.mark, wx = SC.weather;
  const line = { px: 1, depth: 0.35, dark: 0.11 }, fine = { px: 0.8, depth: 0.22, dark: 0.06 }, gap = { px: 1.8, depth: 0.8, dark: 0.45 }, riv = { px: 1.1, depth: 0.14, dark: 0.035 };
  const rnd = (() => { let a = 91 + SC.serial.length * 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const at = (x, f) => { const p = W.at(x, f); return [p[0], p[2]]; };
  const Ln = (name, x) => W.lines[name].at(W.spanToU(x));
  const ENG = [8, 16.5];
  for (const [chart, top] of [[cWT, true], [cWB, false]]) {
    const Q = B.pen(chart); Q.fill('all', body);
    // faded / re-sprayed skin panels between the spars
    for (let i = 0; i < 14; i++) { const x = 3.5 + rnd() * 18, f = 0.2 + rnd() * 0.3, a = at(x, f), b = at(x + 1 + rnd() * 2, f + 0.1 + rnd() * 0.12); Q.fill([[a[0], a[1]], [b[0], a[1] + (b[0] - a[0]) * 0.466], [b[0], b[1]], [a[0], b[1] - (b[0] - a[0]) * 0.0]], F.matte(rnd() < 0.5 ? '#777c7f' : '#606568'), { alpha: (0.2 + rnd() * 0.3) * wx }); }
    Q.fill([at(0.6, 0), at(TIPX, 0), at(TIPX, 0.02), at(0.6, 0.02)], { color: '#6f7477', rough: 0.55, metal: 0.25 });   // LE erosion strip
    Q.wear((g) => { const a = at(0.6, 0.004), b = at(TIPX, 0.004); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }, 0.05, F.bareMetal, { alpha: 0.4 * wx });
    const seg = (name, xs, op) => Q.line(xs.map(x => at(x, Ln(name, x))), op);
    for (const [a, b] of [[3.55, 10.95], [11.15, 18.1]]) { seg('flap', [a, b], gap); seg('aft', [a, b], gap); Q.line([at(a, Ln('flap', a)), at(a, 1)], gap); Q.line([at(b, Ln('flap', b)), at(b, 1)], gap); }
    Q.line([at(18.3, 1), at(18.3, 0.7), at(23.85, 0.7), at(23.85, 1)], gap);
    Q.line([at(20.9, 0.86), at(22.6, 0.86), at(22.6, 1)], fine);                                                   // aileron trim tab
    for (const [a, b] of [[3.75, 7.55], [8.45, 16.05], [16.95, 23.95]]) Q.line([at(a, 0), at(a, 0.12), at(b, 0.12), at(b, 0)], gap);
    // structure: front and rear spar lines, ribs every ~0.85 m with rivet rows, stringer fastener lines on top
    for (const f of [0.15, 0.55]) { Q.line([at(1.2, f), at(TIPX - 0.2, f)], line); const a = at(1.5, f + 0.006), b = at(TIPX - 0.3, f + 0.006); Q.rivets(a[0], a[1], b[0], b[1], 0.07, riv); }
    for (let x = 4.2; x < TIPX; x += 0.85) { Q.line([at(x, 0.13), at(x, 0.55)], fine); const a = at(x + 0.03, 0.14), b = at(x + 0.03, 0.54); Q.rivets(a[0], a[1], b[0], b[1], 0.09, { ...riv, dark: 0.025 }); }
    for (const f of [0.25, 0.35, 0.45]) { const a = at(3.6, f), b = at(TIPX - 0.4, f); Q.rivets(a[0], a[1], b[0], b[1], 0.16, { px: 0.8, depth: 0.08, dark: 0.02 }); }
    if (top) {
      for (const [a, b] of [[3.8, 5.55], [5.65, 7.4], [7.5, 9.2], [9.3, 10.9], [11.3, 14.6], [14.7, 17.95]]) Q.line([at(a, 0.7), at(a, 0.56), at(b, 0.56), at(b, 0.7)], gap);
      // walkway: black-bordered non-slip strip over the inboard wing from the root to the outboard engine, NO STEP outside it
      const w0 = at(3.4, 0.2), w1 = at(3.4, 0.5), w2 = at(17.2, 0.5), w3 = at(17.2, 0.2);
      Q.fill([w0, w3, w2, w1], { color: SC.body, rough: 0.92, metal: 0 }, { alpha: 0.6 });
      Q.stroke((g) => { g.moveTo(w0[0], w0[1]); g.lineTo(w3[0], w3[1]); g.moveTo(w1[0], w1[1]); g.lineTo(w2[0], w2[1]); }, 0.05, walk);
      // (the wing charts are mirrored, so no lettering here: NO STEP bars only, which read the same on both wings)
      for (const x of [6, 12, 20]) { const p = at(x, 0.62); Q.fill((g) => { g.rect(p[0] - 0.4, p[1] - 0.04, 0.8, 0.025); g.rect(p[0] - 0.4, p[1] + 0.015, 0.8, 0.025); }, F.matte(mark), { alpha: 0.8 }); }
      // fuel filler caps / tank access on top, overwing gravity filler
      for (const x of [6.2, 13.8, 19.5]) { const p = at(x, 0.4); Q.fill((g) => { g.arc(p[0], p[1], 0.07, 0, TAU); }, { color: '#585d60', rough: 0.5, metal: 0.4 }); Q.groove((g) => g.arc(p[0], p[1], 0.075, 0, TAU), { px: 1, depth: 0.4, dark: 0.2 }); }
      // externally blown flaps: soot and heat discolouration on the flap tops behind each engine, worst at the slots
      for (const x of ENG) {
        const a = at(x, 0.7), b = at(x, 1);
        for (let i = 0; i < 6; i++) { const dx = (rnd() - 0.5) * 2.2, p = at(x + dx, 0.72); Q.streak(p[0], p[1], p[0] + 0.1, p[1] + 2.0, 0.5 + rnd() * 0.4, { color: '44,41,37', alpha: 0.12 * (0.5 + wx), rough: 0.08 }); }
        for (let i = 0; i < 9; i++) { const dx = (rnd() - 0.5) * 2.4, f0 = 0.7 + rnd() * 0.1; const p = at(x + dx, f0); Q.streak(p[0], p[1], p[0] + 0.15, p[1] + 1.4 + rnd(), 0.12 + rnd() * 0.15, { color: '30,28,25', alpha: 0.18 * (0.5 + wx) }); }
        const s0 = at(x, 0.86); Q.stroke((g) => { g.moveTo(s0[0] - 1.2, s0[1] - 0.56); g.lineTo(s0[0] + 1.2, s0[1] + 0.56); }, 0.12, { color: '#2e2c2a', rough: 0.85, metal: 0 }, { alpha: 0.35 * (0.5 + wx) });
      }
      // hydraulic seepage aft of the spoiler actuators
      for (let i = 0; i < 10; i++) { const x = 4 + rnd() * 13, a = at(x, 0.58); Q.streak(a[0], a[1], a[0] + 0.05, a[1] + 0.8, 0.05, { color: '42,36,26', alpha: 0.12 * wx, rough: 0.05 }); }
    } else {
      // lower surface: fuel tank access panels (rounded), drain masts' stains, flap-track stains, full-width soot under the flaps
      for (let x = 5.0; x < 21; x += 1.7) { const p = at(x, 0.36); Q.panel(p[0] - 0.28, p[1] - 0.16, p[0] + 0.28, p[1] + 0.16, { r: 0.12, px: 1, depth: 0.4, dark: 0.12 }); Q.rivets(p[0] - 0.24, p[1] - 0.2, p[0] + 0.24, p[1] - 0.2, 0.05, riv); }
      for (let i = 0; i < 18; i++) { const x = 4 + i * 1.1, a = at(x, 0.62); Q.streak(a[0], a[1], a[0] + 0.05, a[1] + 1.8, 0.07, { alpha: (0.07 + rnd() * 0.06) * (0.5 + wx) }); }
      for (const x of ENG) {
        const a = at(x, 0.66);
        for (let i = 0; i < 7; i++) { const dx = (rnd() - 0.5) * 2.6; Q.streak(a[0] + dx, a[1] - 0.5, a[0] + dx + 0.15, a[1] + 3.0, 0.6 + rnd() * 0.5, { color: '38,36,33', alpha: 0.16 * (0.5 + wx), rough: 0.08 }); }
        for (let i = 0; i < 12; i++) { const dx = (rnd() - 0.5) * 2.6; Q.streak(a[0] + dx, a[1] - 0.3, a[0] + dx + 0.1, a[1] + 3.2, 0.1 + rnd() * 0.2, { color: '26,24,22', alpha: 0.2 * (0.5 + wx) }); }
      }
    }
    Q.noise({ alpha: 0.05, scale: 3, stretch: [1, 2.5], rough: 0.06 }); Q.noise({ alpha: 0.035, scale: 11 });
  }
  { const Q = B.pen(cWl); Q.fill('all', body);
    for (const y of [2.3, 3.4]) Q.line([[4.4, y], [8.4, y + 0.4]], fine);
    Q.noise({ alpha: 0.045, scale: 3 }); }
  {
    const Q = B.pen(cSt); Q.fill('all', body);
    const sa = (x, f) => { const p = stab.at(x, f); return [p[0], p[2]]; };
    Q.fill([sa(0, 0), sa(9.9, 0), sa(9.9, 0.04), sa(0, 0.04)], { color: '#6f7477', rough: 0.55, metal: 0.25 });
    Q.line([sa(0.75, 1), sa(0.75, 0.68), sa(9.6, 0.68), sa(9.6, 1)], gap);
    for (const x of [3.2, 6.4]) Q.line([sa(x, 0.68), sa(x, 1)], fine);
    for (const f of [0.22, 0.46]) { Q.line([sa(0.3, f), sa(9.7, f)], line); const a = sa(0.4, f + 0.008), b = sa(9.6, f + 0.008); Q.rivets(a[0], a[1], b[0], b[1], 0.07, riv); }
    for (const x of [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]) Q.line([sa(x, 0.05), sa(x, 0.67)], fine);
    Q.noise({ alpha: 0.045, scale: 3, stretch: [1, 2], rough: 0.04 });
  }
  for (const key of ['L', 'R']) {
    const Q = B.pen(cFin[key]); Q.fill('all', body);
    const fa = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; }, k = key === 'L' ? 1 : -1;
    if (SC.band) {                                                                // AMC wing tail flash near the top of the fin
      Q.fill([[12.6, 10.3], [27, 10.3], [27, 11.25], [12.6, 11.25]], F.matte(SC.band));
      for (const y of [10.18, 11.25]) Q.fill([[12.6, y], [27, y], [27, y + 0.12], [12.6, y + 0.12]], F.matte(SC.pin));
      const c = fa(10.78, 0.42); Q.text(SC.bandText, c[0], c[1], 0.44, { color: '#e8e8e2', font: K.FONT.sans, weight: 700, spacing: 0.08 });
    }
    if (SC.nation === 'usaf') {
      // flag (low-vis outline), "AF 06" + last four serial digits, AMC command shield / wing crest
      { const c = fa(9.0, 0.22); Q.decal(c[0], c[1], (g) => { g.strokeStyle = mark; g.lineWidth = 0.03; g.strokeRect(-0.55, -0.3, 1.1, 0.6); for (let i = 1; i < 7; i++) { g.beginPath(); g.moveTo(-0.08, -0.3 + i * 0.086); g.lineTo(0.55, -0.3 + i * 0.086); g.stroke(); } g.strokeRect(-0.55, -0.3, 0.47, 0.32); }); }
      { const c = fa(7.2, 0.33); Q.text('AF', c[0] - k * 1.45, c[1] + 0.18, 0.26, { color: mark, font: K.FONT.sans, weight: 700 }); Q.text(SC.serial.slice(0, 2), c[0] - k * 1.45, c[1] - 0.18, 0.26, { color: mark, font: K.FONT.sans, weight: 700 }); Q.text(SC.serial.replace('-', '').slice(-4), c[0] + k * 0.15, c[1], 0.72, { color: mark, font: K.FONT.sans, weight: 700 }); }
      { const c = fa(5.0, 0.35); Q.decal(c[0], c[1], (g) => crest(g, SC.crest, mark)); }
      { const c = fa(4.0, 0.36); Q.text('AIR MOBILITY COMMAND', c[0], c[1], 0.08, { color: mark, weight: 700 }); }
    } else {
      // RAF: low-vis fin flash, squadron badge, serial
      { const c = fa(10.6, 0.45); Q.decal(c[0], c[1], (g) => { g.fillStyle = '#5a6d8c'; g.fillRect(-0.45, -0.5, 0.45, 1.0); g.fillStyle = '#b06a70'; g.fillRect(0, -0.5, 0.45, 1.0); }); }
      { const c = fa(7.0, 0.38); Q.decal(c[0], c[1], (g) => crest(g, 'raf', mark)); }
      { const c = fa(4.2, 0.4); Q.text(SC.serial, c[0], c[1], 0.4, { color: mark, font: K.FONT.sans, weight: 700 }); }
    }
    Q.fill([fa(2.6, 0), fa(12.6, 0), fa(12.6, 0.025), fa(2.6, 0.025)], { color: '#6f7477', rough: 0.55, metal: 0.25 });
    const fg = { px: 1.6, depth: 0.5, dark: 0.3 };
    Q.line([fa(3.3, 1), fa(3.3, 0.7), fa(7.75, 0.69), fa(7.75, 1)], fg); Q.line([fa(7.85, 1), fa(7.85, 0.69), fa(12.15, 0.68), fa(12.15, 1)], fg);
    for (const y of [4.6, 6.2, 9.4, 11.0]) Q.line([fa(y, 0.7), fa(y, 1)], fine);
    for (const f of [0.22, 0.46]) { Q.line([fa(2.8, f), fa(12.4, f)], fine); const a = fa(2.9, f + 0.01), b = fa(12.3, f + 0.01); Q.rivets(a[0], a[1], b[0], b[1], 0.07, riv); }
    for (let y = 3.6; y < 12.4; y += 0.9) Q.line([fa(y, 0.03), fa(y, 0.68)], { px: 0.7, depth: 0.15, dark: 0.04 });
    Q.panel(...fa(3.4, 0.08), ...fa(4.1, 0.2), { px: 0.9, depth: 0.3, dark: 0.1 });
    // hinge-line grime on the rudders
    for (let i = 0; i < 8; i++) { const y = 3.4 + rnd() * 8.6, p = fa(y, 0.71); Q.streak(p[0], p[1], p[0] + 1.2, p[1] - 0.15, 0.03, { color: '36,32,26', alpha: 0.14 * wx }); }
    Q.noise({ alpha: 0.04, scale: 3 }); Q.noise({ alpha: 0.03, scale: 10 });
  }
  // ---- nacelles: one chart shared by all four cowls (u = arc length along the fold-over loft, t round the ring) -------------------
  {
    const Q = B.pen(cNac), zOf = (z) => { const { zs, ss } = NS; for (let i = 1; i < zs.length; i++) if (z <= zs[i]) return ss[i - 1] + (ss[i] - ss[i - 1]) * (z - zs[i - 1]) / (zs[i] - zs[i - 1]); return ss[ss.length - 1]; };
    Q.fill('all', body);
    Q.fill((g) => g.rect(-1, -1, NS.sIn + 1, 3), { color: '#565a5d', rough: 0.62, metal: 0.4 });                         // acoustic inlet liner
    for (let s = 0.2; s < NS.sIn - 0.1; s += 0.22) Q.line([[s, 0], [s, 1]], { px: 0.8, depth: 0.3, dark: 0.15 });
    Q.fill((g) => g.rect(NS.sIn, -1, zOf(0.28) - NS.sIn, 3), { color: '#8d9193', rough: 0.38, metal: 0.85 });                // bare inlet lip (satin, not polished)
    const sJ = zOf(0.28), sF = zOf(1.25);
    Q.ring(sJ, 0, 1, line); Q.rivets(sJ + 0.02, 0, sJ + 0.02, 1, 0.06, riv);
    Q.ring(sF, 0, 1, { px: 1.4, depth: 0.55, dark: 0.3 });                                                                  // inlet cowl / fan cowl doors joint
    for (const t of [0.44, 0.56]) Q.line([[sF, t], [NS.sMax, t]], { px: 1.2, depth: 0.5, dark: 0.25 });                     // fan-cowl hinge lines either side of the pylon
    Q.line([[sF, 0.0], [NS.sMax, 0.0]], { px: 1.4, depth: 0.55, dark: 0.3 }); Q.line([[sF, 1.0], [NS.sMax, 1.0]], { px: 1.4, depth: 0.55, dark: 0.3 });
    for (let i = 0; i < 4; i++) { const s = sF + 0.3 + i * 0.4; for (const t of [0.012, 0.988]) Q.fill((g) => g.rect(s, t - 0.008, 0.16, 0.016), { color: '#3c3f42', rough: 0.6, metal: 0.3 }); }
    for (const t of [0.22, 0.78]) Q.panel(sF + 0.4, t - 0.03, sF + 0.75, t + 0.03, { px: 0.9, depth: 0.35, dark: 0.12 });
    for (const t of [0.25, 0.75]) Q.text('NO STEP', sF + 1.1, t, 0.05, { color: mark, weight: 700, rot: 90 });
    for (const t of [0.3, 0.7]) Q.text('DANGER', (sJ + sF) / 2, t, 0.045, { color: '#7a2622', weight: 700 });
    Q.fill((g) => g.rect(sF + 0.2, 0.3, NS.sMax - sF, 0.4), { color: '#2e2c2a' }, { alpha: 0.08 * wx, feather: 20 });
    for (let i = 0; i < 6; i++) { const t = 0.02 + rnd() * 0.06; Q.streak(sF, t, NS.sMax, t, 0.01, { color: '40,34,26', alpha: 0.15 * wx }); }
    Q.noise({ alpha: 0.04, scale: 2, rough: 0.05 });
  }
  {
    const Q = B.pen(cSlv); Q.fill('all', body);
    Q.fill((g) => g.rect(1.6, -1, 3, 3), { color: '#4b4f52', rough: 0.6, metal: 0.4 });                                     // inner face of the sleeve
    for (const t of [0.44, 0.56, 0.0, 1.0]) Q.line([[0, t], [1.6, t]], { px: 1.2, depth: 0.5, dark: 0.25 });
    for (const t of [0.16, 0.34, 0.66, 0.84]) Q.fill((g) => g.rect(0.2, t - 0.012, 1.1, 0.024), { color: SC.body, rough: 0.7, metal: 0, height: 0.4 });    // actuator fairings
    Q.ring(0.05, 0, 1, { px: 1.4, depth: 0.6, dark: 0.35 });
    for (let i = 0; i < 18; i++) { const t = rnd(); Q.streak(0.4, t, 1.6, t, 0.02, { color: '30,28,25', alpha: 0.14 * (0.5 + wx) }); }
    Q.fill((g) => g.rect(1.2, -1, 0.4, 3), { color: '#3a3836' }, { alpha: 0.3 * (0.5 + wx), feather: 10 });               // exhaust staining at the trailing edge
    Q.noise({ alpha: 0.04, scale: 2, rough: 0.05 });
  }
}

/** Fin crests (invented): AMC-style command shield, a wing eagle disc, an RAF squadron badge frame. */
function crest(g, kind, col) {
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 0.035;
  if (kind === 'shield') {
    g.beginPath(); g.moveTo(-0.45, -0.5); g.lineTo(0.45, -0.5); g.lineTo(0.45, 0.1); g.quadraticCurveTo(0.4, 0.45, 0, 0.62); g.quadraticCurveTo(-0.4, 0.45, -0.45, 0.1); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(-0.3, 0.1); g.lineTo(0, -0.3); g.lineTo(0.3, 0.1); g.moveTo(-0.2, 0.25); g.lineTo(0.2, 0.25); g.stroke();
  } else if (kind === 'eagle') {
    g.beginPath(); g.arc(0, 0, 0.5, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, 0.42, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(-0.32, -0.05); g.quadraticCurveTo(0, -0.3, 0.32, -0.05); g.lineTo(0.05, 0.05); g.lineTo(0, 0.3); g.lineTo(-0.05, 0.05); g.closePath(); g.fill();
  } else {
    g.beginPath(); g.ellipse(0, 0.02, 0.36, 0.44, 0, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(-0.16, -0.48); g.lineTo(0, -0.62); g.lineTo(0.16, -0.48); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(-0.2, 0.15); g.lineTo(0, -0.22); g.lineTo(0.2, 0.15); g.stroke();
  }
}
