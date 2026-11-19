// Boeing 777-300ER — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (-4.5) when parked.
//
// Reference numbers (docs/aircraft/b77w.md, Boeing ACAPS 777, photos), body axes, d = distance aft of the nose tip (z = d - 36.3):
//   length 73.86 m (nose z -36.3 … tail-cone blade z 37.56), span 64.8 m over the raked tips, height 18.5 m (fin tip y 14.0).
//   Fuselage: perfect 6.20 m circle centred on y 0 (crown 3.1, keel -3.1) from d ≈ 11 to d ≈ 55; nose tip on y -0.6;
//   long Boeing nose: radome joint d 2.6, windscreen base d 3.95 (y ≈ 1.07), windscreen top d 5.05; the crown reaches full
//   height at d ≈ 11. Six flight-deck windows: two front panes on the nose shoulders (V-shaped centre post), two side
//   windows, two small aft windows whose upper edge slopes down (classic Boeing). Flight-deck floor y 0.25, pilot eye
//   [-0.5, 1.45, -30.8] (refined in geometry.js so the eye sits behind the windscreen with ~15° over-the-nose view).
//   Cabin windows: centre y 0.3, 0.51 m pitch, d 7.5 … 66; doors 1–5 at d 9.5, 19.8, 45.5, 58.0, 66.5 plus an over-wing exit at
//   d ≈ 34; cargo doors on the right (fwd d 17–21, aft d 48–52, bulk d 58).
//   Tail cone: lower line sweeps up from d ≈ 56; the cone ends in a vertical, laterally flattened blade (0.48 m wide,
//   1.9 m tall) with the APU exhaust on its left side. Tail skid under d ≈ 59.
//   Wing (right): root LE at the fuselage side (x 3.1) z -8.5, chord 11.5; Yehudi kink x 12 (LE z -2.3, chord 7.2);
//   main tip x 30 (LE z 8.73, chord 3.2); raked tip to x 32.4 (LE sweep 50°, tip chord 0.94). LE sweep 35° inboard / 31.5°
//   outboard; TE sweep 12° inboard / 21° outboard; dihedral 5.5° from y -1.3 at the root LE; supercritical, t/c 14 → 7.5 %.
//   Slats: one inboard (x 3.6–9.0), seven outboard (x 12.6–29.8, one part with painted joints). Trailing edge: double-slotted
//   inboard flap x 3.3–10.1, flaperon x 10.3–13.7 behind the engine, single-slotted outboard flap x 13.9–24.4, aileron
//   x 24.6–29.8; seven spoilers per wing (2 inboard, 5 outboard); four flap-track fairings per wing.
//   Tailplane span 21.3 m, root LE z 24.7, chord 7.8 → 2.2, LE sweep 36°, dihedral 7°. Fin LE root z 19.7 (crown), chord
//   11.9 → 3.8 at y 14.0, LE sweep 43°; rudder 30 % chord with a geared tab on its lower section.
//   GE90-115B: centre x ±10.9, y -2.0, inlet highlight z -8.6, Ø 3.64 m
//   highlight, Ø 3.9 m max, fan Ø 3.24 m (22 swept, wide-chord composite blades), fan cowl + translating reverser 5.0 m,
//   long core cowl to z -1.0 and a long conical plug; 0.55 m ground clearance (the sim's gear is shorter than the real one).
//   Gear (geometry.js, unchanged): nose twin r 0.55 at z -28.4 retracting forward; main six-wheel bogies (3 axles × 2,
//   1.45 m axle pitch, 1.4 m wheel pitch) centred on x ±5.5, z 2.8, legs hinged in the wing at x ±5.4, retracting inward
//   into the wing-body fairing; bogie hangs 12° toe-up in flight; the rear axle steers.
// The airline liveries are invented for this simulator: they do not reproduce any real operator's name or marks.
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['aurelis', 'kestria', 'house'];

const SCHEMES = {
  aurelis: { name: 'Aurelis', title: 'Aurelis', reg: 'ZZ-AUR', body: '#f5f6f7', belly: '#16264a', accent: '#c99a3e', tail: '#16264a', engine: '#16264a', lipBand: '#c99a3e', tipColor: '#16264a', titleColor: '#16264a', font: 'serif', style: 'sweep', wx: 0.22 },
  kestria: { name: 'Kestria', title: 'KESTRIA', reg: 'ZZ-KST', body: '#f6f6f5', belly: '#c6cbd0', accent: '#d2401f', tail: '#d2401f', engine: '#f3f4f4', lipBand: '#d2401f', tipColor: '#d2401f', titleColor: '#2a2e33', font: 'wide', style: 'cheat', wx: 0.42 },
  house: { name: 'Skyward demonstrator', title: 'SKYWARD', reg: 'ZZ-SKW', body: '#f1f2f3', belly: '#99a1a8', accent: '#2463c4', tail: '#f1f2f3', engine: '#f1f2f3', lipBand: '#2463c4', tipColor: '#2463c4', titleColor: '#1b2a3c', font: 'wide', style: 'house', wx: 0.18 },
};

// ---- fuselage station table ---------------------------------------------------------------------------------------------
//  d (from the nose)   y of the top   y of the keel   half-width   y of the widest point
const NOSE = [
  [0.00, -0.60, -0.60, 0.00, -0.60], [0.12, -0.32, -0.86, 0.30, -0.60], [0.40, -0.02, -1.12, 0.60, -0.60], [0.90, 0.28, -1.42, 0.94, -0.60],
  [1.60, 0.55, -1.76, 1.32, -0.58], [2.40, 0.78, -2.06, 1.66, -0.55], [3.20, 0.95, -2.32, 1.95, -0.50], [3.90, 1.07, -2.50, 2.17, -0.45],
  [4.45, 1.50, -2.62, 2.33, -0.40], [5.05, 1.98, -2.73, 2.48, -0.34], [5.80, 2.34, -2.84, 2.64, -0.27], [6.80, 2.63, -2.94, 2.80, -0.19],
  [8.00, 2.88, -3.02, 2.94, -0.11], [9.50, 3.03, -3.07, 3.04, -0.05], [11.2, 3.09, -3.10, 3.095, -0.01], [13.0, 3.10, -3.10, 3.10, 0.00],
];
//  z     top     keel    half-width  widest
const TAIL = [
  [19.0, 3.10, -3.10, 3.10, 0.00], [21.7, 3.06, -2.98, 3.05, 0.03], [24.2, 2.95, -2.62, 2.86, 0.12], [26.7, 2.79, -2.15, 2.54, 0.25],
  [29.2, 2.59, -1.66, 2.10, 0.40], [31.7, 2.36, -1.22, 1.56, 0.52], [34.2, 2.05, -0.84, 0.98, 0.58], [36.4, 1.72, -0.58, 0.46, 0.56],
  [37.56, 1.50, -0.42, 0.24, 0.52],
];

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'aurelis', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const rig = K.createRig(ctx, { geometry: G, name: 'b77w', glassLayer: opts.glassLayer, cockpitRadius: 1.6 });

  // ---- atlases: A = fuselage + belly + gear + flight deck, B = wings, tail, nacelles ------------------------------------------
  // gloss airline paint: a clear coat, a little oil-canning between the 0.53 m frames, a lightly used aircraft
  const A = K.createAtlas({ size: atlasSize, base: F.gloss(SC.body), swatchRows: 3, skin: { weathering: SC.wx ?? 0.3, framePitch: 0.53, waviness: 0.85, clearcoat: 0.85 } });
  const cFus = A.chart('fus', { type: 'unwrap', z: [G.noseZ - 0.05, G.tailZ + 0.03], girth: 19.6, vScale: 0.8, strips: 4 });
  const cPanel = A.chart('panel', { type: 'rect', w: 2.4, h: 0.6, density: 2.0 });
  const cOver = A.chart('overhead', { type: 'rect', w: 0.8, h: 1.0, density: 1.5 });
  const cPed = A.chart('pedestal', { type: 'rect', w: 0.5, h: 1.0, density: 1.5 });
  A.pack();
  const UA = {
    body: A.swatch('body', F.gloss(SC.body)), fair: A.swatch('fair', F.gloss(SC.belly)), dark: A.swatch('dark', F.darkGrey), black: A.swatch('black', F.black),
    well: A.swatch('well', { color: '#7b8079', rough: 0.7, metal: 0 }), liner: A.swatch('liner', { color: '#a7a7a1', rough: 0.8, metal: 0 }), post: A.swatch('post', { color: '#8d8e8a', rough: 0.7, metal: 0 }),
    floor: A.swatch('floor', { color: '#34373b', rough: 0.9, metal: 0 }), shield: A.swatch('shield', { color: '#2a2c2f', rough: 0.85, metal: 0 }), console: A.swatch('console', { color: '#5c6166', rough: 0.75, metal: 0 }),
    seat: A.swatch('seat', { color: '#45484c', rough: 0.9, metal: 0 }), cushion: A.swatch('cushion', { color: '#5b5346', rough: 1, metal: 0 }), yoke: A.swatch('yoke', { color: '#17181a', rough: 0.5, metal: 0 }),
    exhaust: A.swatch('exhaust', F.exhaust), steel: A.swatch('steel', F.steel), antenna: A.swatch('antenna', F.gloss('#e9eaea')), lens: A.swatch('lens', F.lens),
    strut: A.swatch('gear.strut', F.gearWhite), chrome: A.swatch('gear.chrome', F.chrome), tyre: A.swatch('gear.tyre', F.rubber), hub: A.swatch('gear.hub', { color: '#c4c6c2', rough: 0.4, metal: 0.35 }),
    link: A.swatch('gear.link', F.anodised), brake: A.swatch('gear.brake', { color: '#2c2724', rough: 0.58, metal: 0.8 }), hose: A.swatch('gear.hose', { color: '#17181a', rough: 0.55, metal: 0.35 }),
    wiper: A.swatch('wiper', { color: '#151617', rough: 0.5, metal: 0.3 }), vane: A.swatch('vane', { color: '#b8bcbf', rough: 0.35, metal: 0.8 }),
  };
  const B = K.createAtlas({ size: atlasSize, base: F.semigloss('#aeb3b7'), swatchRows: 3, skin: { weathering: (SC.wx ?? 0.3) + 0.15, framePitch: 0.5, waviness: 0.7 } });
  const cWT = { i: B.chart('wingTopIn', { type: 'plan', x: [1.0, 12.2], z: [-10.0, 5.6], view: 'top', mirror: true, density: 1.1 }), o: B.chart('wingTopOut', { type: 'plan', x: [11.9, 32.5], z: [-3.0, 12.7], view: 'top', mirror: true, density: 1.1 }) };
  const cWB = { i: B.chart('wingBotIn', { type: 'plan', x: [1.0, 12.2], z: [-10.0, 5.6], view: 'bottom', mirror: true, density: 0.75 }), o: B.chart('wingBotOut', { type: 'plan', x: [11.9, 32.5], z: [-3.0, 12.7], view: 'bottom', mirror: true, density: 0.75 }) };
  const cSt = B.chart('stab', { type: 'plan', x: [0.3, 10.8], z: [24.4, 34.6], view: 'top', mirror: true, density: 0.9 });
  const cFin = { L: B.chart('finL', { type: 'side', z: [18.4, 34.4], y: [1.9, 14.2], view: 'left' }), R: B.chart('finR', { type: 'side', z: [18.4, 34.4], y: [1.9, 14.2], view: 'right' }) };
  B.pack();
  const UB = {
    grey: B.swatch('grey', F.semigloss('#aeb3b7')), engine: B.swatch('engine', F.gloss(SC.engine)), lip: B.swatch('lip', { color: '#c4c8cc', rough: 0.2, metal: 0.92 }), band: B.swatch('band', F.gloss(SC.lipBand)),
    duct: B.swatch('duct', { color: '#0c0d0f', rough: 0.7, metal: 0.1 }), acoustic: B.swatch('acoustic', { color: '#4f5458', rough: 0.62, metal: 0.25 }), core: B.swatch('core', F.semigloss('#bfc3c6')),
    coreMetal: B.swatch('coreMetal', F.titanium), plug: B.swatch('plug', F.heatStained), blade: B.swatch('blade', { color: '#2f3337', rough: 0.3, metal: 0.55 }),
    spinner: B.swatch('spinner', { color: '#1b1d20', rough: 0.25, metal: 0.4 }), swirl: B.swatch('swirl', { color: '#f2f2f0', rough: 0.3, metal: 0 }), inner: B.swatch('inner', F.primer),
    seam: B.swatch('seam', { color: '#5a5f64', rough: 0.6, metal: 0 }), latch: B.swatch('latch', { color: '#9aa0a5', rough: 0.4, metal: 0.6 }),
    pylon: B.swatch('pylon', F.gloss(SC.style === 'sweep' ? '#e9ebec' : '#e9ebec')), tail: B.swatch('tail', F.gloss(SC.tail)), cascade: B.swatch('cascade', { color: '#3a3c3f', rough: 0.6, metal: 0.7 }),
    wick: B.swatch('wick', F.black), canoe: B.swatch('canoe', F.semigloss('#b3b8bc')), tip: B.swatch('tip', F.gloss(SC.tipColor)), metal: B.swatch('metal', { color: '#c9ccce', rough: 0.26, metal: 0.9 }),
    heat: B.swatch('heat', { color: '#8a8f93', rough: 0.45, metal: 0.8 }),
  };
  // 1-D gradient strips: fan blade across its chord (titanium leading-edge sheath on a dark composite blade), core cowl along z
  const ormB = B.ormStyle, bandB = (g, a, b, s) => { g.fillStyle = s; g.fillRect(a, 0, b - a, 1); };
  const SB = {
    blade: B.strip('fanBlade', 4, (g, layer) => {
      if (layer === 'color') { bandB(g, 0, 1, '#2b2f33'); bandB(g, 0, 0.09, '#a3a8ad'); bandB(g, 0.09, 0.13, '#4e5358'); bandB(g, 0.9, 1, '#373b40'); }
      else if (layer === 'orm') { bandB(g, 0, 1, ormB(0.34, 0.3)); bandB(g, 0, 0.11, ormB(0.2, 0.95)); }
    }),
    soot: B.strip('sleeveSoot', 3, (g, layer) => {
      if (layer === 'color') { const gr = g.createLinearGradient(0, 0, 1, 0); gr.addColorStop(0, SC.engine); gr.addColorStop(0.55, SC.engine); gr.addColorStop(1, '#3a3936'); g.fillStyle = gr; g.fillRect(0, 0, 1, 1); }
      else if (layer === 'orm') { bandB(g, 0, 0.5, ormB(0.22, 0)); bandB(g, 0.5, 1, ormB(0.5, 0)); }
    }),
    core: B.strip('coreSoot', 6, (g, layer) => {
      if (layer === 'color') { const gr = g.createLinearGradient(0, 0, 1, 0); gr.addColorStop(0, '#c4c8cb'); gr.addColorStop(0.5, '#b8bcbf'); gr.addColorStop(0.72, '#9a9c9b'); gr.addColorStop(0.83, '#5f605e'); gr.addColorStop(0.9, '#8c877d'); gr.addColorStop(1, '#a39885'); g.fillStyle = gr; g.fillRect(0, 0, 1, 1); }
      else if (layer === 'orm') { bandB(g, 0, 0.6, ormB(0.42, 0)); bandB(g, 0.6, 0.86, ormB(0.6, 0.1)); bandB(g, 0.86, 1, ormB(0.42, 0.85)); }
    }),
  };

  // ---- fuselage ---------------------------------------------------------------------------------------------------------------
  const st = (z, top, bot, w, yc, extra) => ({ z, y: yc, w, top: Math.max(0, top - yc), bot: Math.max(0, yc - bot), ...extra });
  const FS = [
    ...NOSE.map(([d, top, bot, w, yc]) => st(G.noseZ + d, top, bot, w, yc, {})),
    ...TAIL.map(([z, top, bot, w, yc]) => st(z, top, bot, w, yc, z > 33 ? { kTop: 0.6, kBot: 0.62 } : z > 28 ? { kBot: 0.58 } : {})),
  ];
  const fseg = Math.max(40, Math.round(96 * detail / 4) * 4);
  // flight-deck window outlines (z, t) — measured on a quick loft of the same stations (rings are exact at any z)
  const zd = (d) => G.noseZ + d;
  const WIN = flightDeckWindows(K.loft({ stations: FS, segments: fseg, step: 6 }), zd);
  const fdBox = glazingBox(WIN, fseg);
  const fus = K.loft({
    stations: FS, segments: fseg, step: 1.3 / detail, chart: cFus, capEnd: 'flat', capUV: SC.style === 'sweep' ? UA.fair : UA.body,
    cutouts: [{ name: 'ngf', z: [-31.1, -29.35], t: [0, 0.034], mirror: true }, { name: 'nga', z: [-29.3, -27.7], t: [0, 0.034], mirror: true },
      { name: 'fd', z: fdBox.z, t: fdBox.t }],
  });
  cFus.body = fus;
  // the skin around the six flight-deck windows is rebuilt with real openings; glass panes sit 14 mm in from the skin
  const glaz = glazing(fus, cFus, WIN.flatMap(w => [w, w.map(p => [p[0], 1 - p[1]]).reverse()]), fdBox, 0.16, 0.03, UA.wiper);
  const stA = new K.Mesh(), stB = new K.Mesh();
  stA.add(fus.mesh).add(glaz.skin);
  stA.add(K.well(K.merge(fus.patches.ngfR, fus.patches.ngfL, fus.patches.ngaR, fus.patches.ngaL), 1.3, UA.well, [0, 1, 0]));
  // ring parameter on the upper half (right side) at half-width x
  const tAtX = (z, x) => { let lo = 0.25, hi = 0.5; for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (fus.at(z, m).p[0] > x) lo = m; else hi = m; } return (lo + hi) / 2; };
  // APU exhaust: short oval duct on the left side of the tail-cone blade, angled outboard
  stA.add(K.lathe([[0.16, -0.25], [0.17, 0.12, 1], [0.13, 0.12, 1], [0.11, -0.3]], { segments: 16, uv: UA.exhaust, sx: 0.8 }).rotateY(-16 * DEG).translate(-0.16, 0.6, 37.2));

  // wing-to-body fairing with the main-gear bays cut into its flat bottom
  const fairStations = [[-15.0, 2.05, 0.3, 0.75], [-12.5, 2.5, 0.6, 1.0], [-9.5, 3.05, 0.85, 1.15], [-6.0, 3.42, 0.98, 1.22], [-1.0, 3.6, 1.02, 1.25], [4.8, 3.62, 1.0, 1.26], [7.5, 3.3, 0.85, 1.15], [10.0, 2.75, 0.55, 0.98], [12.8, 2.1, 0.3, 0.74]]
    .map(r => ({ z: r[0], y: -2.1, w: r[1], top: r[2], bot: r[3], kTop: 0.7, kBot: [0.95, 0.5523] }));
  const fairOpts = { stations: fairStations, segments: Math.max(32, Math.round(48 * detail / 4) * 4), step: 0.8, uv: UA.fair };
  let fair = K.loft(fairOpts);
  const fAtX = (z, x) => { let lo = 0, hi = 0.25; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (fair.at(z, m).p[0] < x) lo = m; else hi = m; } return (lo + hi) / 2; };
  fair = K.loft({ ...fairOpts, cutouts: [{ name: 'mlg', z: [0.3, 4.9], t: [fAtX(2.6, 1.85), fAtX(2.6, 3.5)], mirror: true }] });
  stA.add(fair.mesh).add(K.well(fair.patches.mlgR, 1.5, UA.well, [0, 1, 0])).add(K.well(fair.patches.mlgL, 1.5, UA.well, [0, 1, 0]));

  // ---- flight deck: six painted windows, lined inside so the pilot looks out through the gaps -------------------------------
  const { WS, S1, S2, S3 } = WIN, IN = new K.Mesh();
  const FLOOR = 0.25, zb = zd(7.9);
  {
    const L = (c, uv, nu = 3, nv = 3) => IN.add(K.liner(fus, c, { uv, nu, nv, mirror: true, inset: 0.05 }));
    const lo = (z) => [z, fus.tAtY(z, FLOOR + 0.04)], hi = (z) => [z, 0.5];
    L([WS.IB, WS.OB, lo(WS.OB[0]), lo(WS.IB[0])], UA.liner, 2, 5);                     // below the windshield
    L([WS.IB, hi(WS.IB[0]), hi(WS.IT[0]), WS.IT], UA.post, 4, 1);                       // centre post
    L([hi(WS.IT[0]), WS.IT, WS.OT, hi(WS.OT[0])], UA.liner, 3, 2);                      // roof above the windshield
    L([WS.OB, S1.bf, S1.tf, WS.OT], UA.post, 1, 4);                                      // corner post
    L([WS.OT, S1.tf, hi(S1.tf[0]), hi(WS.OT[0])], UA.liner, 1, 3);
    L([lo(WS.OB[0]), lo(S1.bf[0]), S1.bf, WS.OB], UA.liner, 1, 3);
    const win4 = (W1, W2, top2) => {                                                     // sill + header of W1, post between W1 and W2
      L([lo(W1.bf[0]), lo(W1.br[0]), W1.br, W1.bf], UA.liner, 4, 3);
      L([W1.tf, W1.tr, hi(W1.tr[0]), hi(W1.tf[0])], UA.liner, 3, 3);
      L([W1.br, W2.bf, W2.tf, W1.tr], UA.post, 1, 4);
      L([lo(W1.br[0]), lo(W2.bf[0]), W2.bf, W1.br], UA.liner, 1, 3);
      L([W1.tr, W2.tf, hi(W2.tf[0]), hi(W1.tr[0])], UA.liner, 1, 3);
    };
    win4(S1, S2); win4(S2, S3);
    L([lo(S3.bf[0]), lo(S3.br[0]), S3.br, S3.bf], UA.liner, 3, 3);
    L([S3.tf, S3.nt, hi(S3.nt[0]), hi(S3.tf[0])], UA.liner, 2, 3);
    L([S3.nt, S3.rt, hi(S3.br[0]), hi(S3.nt[0])], UA.liner, 2, 3);                     // the sloping upper rear corner
    L([lo(S3.br[0]), lo(zb), hi(zb), hi(S3.br[0])], UA.liner, 3, 6);                   // aft side wall
    const fy = FLOOR, zP = zd(4.72);                                                      // panel face station
    IN.add(K.deck(fus, WS.IB[0] - 0.02, zb, fy, { uv: UA.floor, n: 8 }));
    IN.add(K.bulkhead(fus, zb, { uv: UA.liner, facing: -1 }));                          // flight-deck door wall
    IN.add(K.bulkhead(fus, WS.IB[0] - 0.02, { uv: UA.shield, facing: 1 }));             // forward bulkhead
    // glareshield with the MCP face, main panel with six displays, pedestal, overhead panel
    { const gs = K.prism([[zP - 0.6, 1.2], [zP - 0.02, 1.27], [zP + 0.02, 1.24], [zP - 0.02, 1.13], [zP - 0.6, 1.1]], -1.25, 1.25, UA.shield); for (let i = 0; i < gs.p.length; i += 3) gs.p[i] *= 0.6 + 0.4 * (gs.p[i + 2] - (zP - 0.6)) / 0.62; IN.add(gs); }
    { const i0 = IN.vertexCount; for (const [a, b] of [[0, 0.6], [2.4, 0.6], [2.4, 0], [0, 0]]) { const uv = cPanel.uv(a, b); IN.vert(a - 1.2, 0.52 + (0.6 - b), zP + 0.01 + (0.6 - b) * 0.12, 0, 0.12, 1, uv[0], uv[1]); } IN.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    IN.add(K.box(2.4, 0.66, 0.16, UA.shield).translate(0, 0.83, zP - 0.1));
    { // pedestal: sloping top quad mapped to its chart + body
      IN.add(K.box(0.5, 0.5, 1.05, UA.console).translate(0, fy + 0.25, zP + 0.62));
      const i0 = IN.vertexCount; for (const [a, b] of [[0, 0], [0.5, 0], [0.5, 1.0], [0, 1.0]]) { const uv = cPed.uv(a, b); IN.vert(a - 0.25, fy + 0.62 - b * 0.12, zP + 0.08 + b * 1.05, 0, 1, 0.1, uv[0], uv[1]); } IN.quad(i0, i0 + 3, i0 + 2, i0 + 1);
      for (const sx of [-1, 1]) IN.add(K.box(0.04, 0.16, 0.05, UA.yoke).rotateX(-0.4).translate(sx * 0.06, fy + 0.7, zP + 0.3));   // thrust levers
    }
    { const i0 = IN.vertexCount, y = 2.0; for (const [a, b] of [[0, 0], [0.8, 0], [0.8, 1.0], [0, 1.0]]) { const uv = cOver.uv(a, b); IN.vert(a - 0.4, y + b * 0.1, zP + 0.25 + b, 0, -1, -0.15, uv[0], uv[1]); } IN.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    const eye = G.pilotEye;
    for (const sx of [-1, 1]) {
      const e = [sx * Math.abs(eye[0]), eye[1], eye[2]];
      IN.add(K.crewSeat({ eye: e, uv: { frame: UA.seat, cushion: UA.cushion } }));
      IN.add(K.yoke({ base: [e[0], fy, e[2] - 0.55], top: [e[0], e[1] - 0.55, e[2] - 0.45], uv: UA.yoke }));
      IN.add(K.box(0.36, 0.6, 1.2, UA.console).translate(sx * 1.45, fy + 0.3, e[2] - 0.1));                          // side console
      IN.add(K.box(0.2, 0.03, 0.3, UA.shield).translate(e[0], fy + 0.05, zP + 0.08));                                // rudder pedals
    }
  }
  IN.occlude((x, y, z) => 0.35 + 0.25 * Math.min(1, Math.max(0, (z - zd(4.2)) / 3)));   // the flight deck is a shaded room seen through the glass
  stA.add(IN);

  // ---- wings ----------------------------------------------------------------------------------------------------------------
  const XR = 3.1, XK = 12, XT = 30, XE = 32.4, DIH = Math.tan(5.5 * DEG);
  const zLE = (x) => (x < XK ? -8.5 + 0.6966 * (x - XR) : x < XT ? -2.3 + 0.6127 * (x - XK) : 8.73 + 1.19 * (x - XT));
  const zTE = (x) => (x < XK ? 3.0 + 0.2135 * (x - XR) : x < XT ? 4.9 + 0.3906 * (x - XK) : 11.93 + 0.25 * (x - XT));
  const wy = (x) => -1.3 + DIH * (x - XR);
  const wst = (x, tc, twist) => ({ x, y: wy(x), z: zLE(x), chord: zTE(x) - zLE(x), tc, twist });
  const sc = K.supercritical();
  const SP_IN = [[3.7, 6.4], [6.5, 9.3]], SP_OUT = [[13.95, 16.0], [16.05, 18.1], [18.15, 20.2], [20.25, 22.3], [22.35, 24.35]];
  const SLAT_OUT = [12.6, 15.2, 17.7, 20.2, 22.7, 25.1, 27.5, 29.8];
  const wingOf = (side) => K.wing({
    side, airfoil: sc, chordPts: Math.round(15 * Math.min(1, detail)), spanAxis: 'x', tip: 'round', tipLength: 0.4,
    stations: [wst(1.0, 0.14, 2.6), wst(XR, 0.135, 2.3), wst(7.5, 0.122, 1.4), wst(XK, 0.11, 0.4), wst(21, 0.095, -1.5), wst(XT, 0.085, -3.0), wst(31.4, 0.08, -3.3), wst(XE, 0.075, -3.5)],
    lines: { slat: [[1.0, 0.1], [XK, 0.12], [XT, 0.14], [XE, 0.14]], spoil: [[1.0, 0.6], [XK, 0.6], [XT, 0.62], [XE, 0.62]], flap: [[1.0, 0.71], [XK, 0.73], [XT, 0.77], [XE, 0.77]], aft: [[1.0, 0.875], [XK, 0.885], [XT, 0.9], [XE, 0.9]] },
    controls: [
      { name: 'flapIn', type: 'flap', span: [3.3, 10.1], from: 'flap', to: 'aft', nose: 1, tail: 0.6 },
      { name: 'flapInAft', type: 'flap', span: [3.3, 10.1], from: 'aft', nose: 1 },
      { name: 'flaperon', type: 'flap', span: [10.3, 13.7], from: 'flap', nose: 1 },
      { name: 'flapOut', type: 'flap', span: [13.9, 24.4], from: 'flap', nose: 1 },
      { name: 'aileron', type: 'flap', span: [24.6, 29.8], from: 'flap', nose: 1 },
      { name: 'slatIn', type: 'flap', span: [3.6, 9.0], to: 'slat', tail: 0.4, cove: true },
      { name: 'slatOut', type: 'flap', span: [12.6, 29.8], to: 'slat', tail: 0.4, cove: true },
      ...SP_IN.map((s, i) => ({ name: 'sp' + (i + 1), type: 'panel', surface: 'upper', span: s, from: 'spoil', to: 'flap', hinge: 'front' })),
      ...SP_OUT.map((s, i) => ({ name: 'sp' + (i + 3), type: 'panel', surface: 'upper', span: s, from: 'spoil', to: 'flap', hinge: 'front' })),
    ],
    charts: [{ from: 0, upper: cWT.i, lower: cWB.i }, { from: 12.05, upper: cWT.o, lower: cWB.o }], innerUV: UB.inner, edgeUV: UB.grey,
  });
  const W = { R: wingOf(1), L: wingOf(-1) };
  stB.add(W.R.mesh).add(W.L.mesh);
  // flap-track fairings ("canoes"): front half fixed to the wing, rear half rides on the flap
  const canoeAt = (x, len, side, h = 1) => {
    const zf = W.R.at(x, 0.74, 'lower'), z0 = zf[2] - len * 0.42, y = zf[1] - 0.05;
    const s = [[0, 0.01, 0.01], [0.12, 0.11, 0.15], [0.35, 0.17, 0.28], [0.6, 0.17, 0.3], [0.85, 0.11, 0.2], [1, 0.01, 0.02]].map(r => ({ z: z0 + r[0] * len, x: side * x, y: y - r[2] * h * 0.5 + (r[0] > 0.6 ? (r[0] - 0.6) * 0.35 : 0), w: r[1], top: r[2] * h * 0.6, bot: r[2] * h }));
    const split = zf[2] + 0.15;
    return { front: K.loft({ stations: s, segments: 12, step: 0.4, uv: UB.canoe, zRange: [z0, split] }).mesh, rear: K.loft({ stations: s, segments: 12, step: 0.4, uv: UB.canoe, zRange: [split, z0 + len], capStart: 'flat' }).mesh };
  };

  // ---- tail -------------------------------------------------------------------------------------------------------------------
  const sy = (x) => 0.7 + x * Math.tan(7 * DEG);
  const stabOf = (side) => K.wing({
    side, airfoil: K.naca4('0011'), chordPts: Math.round(11 * Math.min(1, detail)), spanAxis: 'x', tip: 'round', tipLength: 0.5,
    stations: [{ x: 0.3, y: sy(0.3), z: 24.6, chord: 7.95, tc: 0.11 }, { x: 10.65, y: sy(10.65), z: 24.6 + 10.35 * Math.tan(36 * DEG), chord: 2.2, tc: 0.09 }],
    lines: { hinge: [[0.3, 0.69], [10.65, 0.69]] },
    controls: [{ name: 'elevator', type: 'flap', span: [2.75, 10.3], from: 'hinge', nose: 1 }],
    charts: { upper: cSt, lower: cSt }, edgeUV: UB.grey,
  });
  const stab = { R: stabOf(1), L: stabOf(-1) };
  stB.add(stab.R.mesh).add(stab.L.mesh);
  const finLE = (y) => 19.7 + Math.tan(43 * DEG) * (y - 3.08);
  const FIN_TOP = G.height - G.cgHeight;
  const fin = K.wing({
    airfoil: K.naca4('0010'), chordPts: Math.round(13 * Math.min(1, detail)), spanAxis: 'y', tip: 'round', tipLength: 0.3,
    stations: [{ x: 0, y: 2.1, z: finLE(2.1), chord: 11.95, tc: 0.1 }, { x: 0, y: FIN_TOP, z: finLE(FIN_TOP), chord: 3.8, tc: 0.09 }],
    lines: { hinge: [[2.1, 0.7], [FIN_TOP, 0.69]], tab: [[2.1, 0.89], [FIN_TOP, 0.89]] },
    controls: [
      { name: 'rudderUp', type: 'flap', span: [7.45, FIN_TOP - 0.25], from: 'hinge', nose: 1 },
      { name: 'rudderLo', type: 'flap', span: [3.05, 7.4], from: 'hinge', to: 'tab', nose: 1, tail: 0.3 },
      { name: 'tab', type: 'flap', span: [3.05, 7.4], from: 'tab', nose: 1 },
    ],
    charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.tail,
  });
  stB.add(fin.mesh);
  stB.add(K.wing({ airfoil: K.naca4('0008'), chordPts: 6, spanAxis: 'y', tip: 'flat', charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.tail,       // dorsal fillet
    stations: [{ x: 0, y: 2.7, z: 16.6, chord: 5.0, tc: 0.03 }, { x: 0, y: 3.75, z: finLE(3.75) - 0.15, chord: 2.4, tc: 0.07 }] }).mesh);

  // ---- engines: GE90-115B -----------------------------------------------------------------------------------------------------
  const eng = [];
  const NAC = { len: 5.0, rHi: 1.82, rMax: 1.95, rThroat: 1.63, rFan: 1.625, zFan: 1.25, rExit: 1.48, sleeve: 0.56 };
  const EC = G.engines.map(e => [e.nozzle[0], e.nozzle[1], e.intake[2]]);
  for (const [i, sx] of [[0, -1], [1, 1]]) {
    const c = EC[i];
    const n = K.nacelle({ centre: c, length: NAC.len, rHi: NAC.rHi, rMax: NAC.rMax, rThroat: NAC.rThroat, rFan: NAC.rFan, zFan: NAC.zFan, rExit: NAC.rExit, flat: 0, droop: 0, sleeve: NAC.sleeve,
      core: { r0: 1.06, r1: 0.64, length: 2.6, z0: NAC.zFan + 0.9 }, plug: { r: 0.5, length: 1.55 }, segments: Math.max(36, Math.round(56 * detail / 4) * 4),
      uv: UB.engine, uvLip: UB.lip, uvInner: UB.acoustic, uvSleeve: UB.engine, uvCore: UB.core, uvPlug: UB.plug, uvCascade: UB.cascade });
    stB.add(n.cowl).add(n.cascade).add(n.plug);
    { // core cowl (same profile as the kit's) with a soot gradient toward the core nozzle
      const L = NAC.len, r0 = 1.06, r1 = 0.64, cl = 2.6, cz0 = NAC.zFan + 0.9, cz1 = L + cl;
      const prof = [[r0 * 0.9, cz0], [r0, cz0 + (L - cz0) * 0.5], [r0 * 0.98, L], [r1 * 1.08, L + cl * 0.7], [r1, cz1, 1], [r1 - 0.03, cz1, 1], [r1 - 0.035, cz1 - cl * 0.5]];
      const uvs = prof.map(p => (SB.core ? SB.core.uv((p[1] - cz0) / (cz1 - cz0)) : UB.core));
      stB.add(K.lathe(prof, { segments: Math.max(36, Math.round(56 * detail / 4) * 4), uv: (k) => uvs[k] }).translate(c[0], c[1], c[2]));
    }
    { // panel joints: inlet cowl / fan cowl ring, fan cowl bottom split line with four latches, reverser blocker-door seam
      const L = NAC.len, rA = (z) => (z < L * 0.3 ? NAC.rHi + (NAC.rMax - NAC.rHi) * Math.sqrt(z / (L * 0.3)) : NAC.rMax);
      const ring = (z) => { const r = rA(z) + 0.003; return K.lathe([[r - 0.006, z - 0.014], [r, z - 0.008], [r, z + 0.008], [r - 0.006, z + 0.014]], { segments: 56, uv: UB.seam }).translate(c[0], c[1], c[2]); };
      stB.add(ring(1.5));
      stB.add(K.box(0.012, 0.006, 1.25, UB.seam).translate(c[0], c[1] - NAC.rMax - 0.001, c[2] + 2.15));
      for (const z of [1.7, 2.05, 2.4, 2.7]) stB.add(K.box(0.07, 0.012, 0.16, UB.latch).translate(c[0], c[1] - NAC.rMax - 0.004, c[2] + z));
    }
    // coloured intake band just behind the polished lip
    { const L = NAC.len, rA = (z) => NAC.rHi + (NAC.rMax - NAC.rHi) * Math.sqrt(Math.min(1, z / (L * 0.3))) + 0.005;
      stB.add(K.lathe([[rA(0.16) - 0.005, 0.16], [rA(0.17), 0.17], [rA(0.5), 0.5], [rA(0.51) - 0.005, 0.51]], { segments: 56, uv: UB.band }).translate(c[0], c[1], c[2])); }
    // metallic core-nozzle ring
    { const z1 = NAC.len + 2.6; stB.add(K.lathe([[0.705, z1 - 0.58], [0.668, z1 + 0.01, 1], [0.645, z1 + 0.01, 1]], { segments: 40, uv: UB.coreMetal }).translate(c[0], c[1], c[2])); }
    stB.add(K.fanBackdrop(NAC.rFan, 0.55, UB.duct).translate(c[0], c[1], n.fanZ));
    { // reverser sleeve: grey acoustic lining inside the fan nozzle, exhaust soot on the outer trailing edge (both move with it)
      const L = NAC.len, zS = L * NAC.sleeve, seg = Math.max(36, Math.round(56 * detail / 4) * 4), rAtS = (z) => NAC.rMax - (NAC.rMax - NAC.rExit) * Math.pow(Math.max(0, (z - L * 0.4) / (L * 0.6)), 1.6);
      n.sleeve.add(K.lathe([[NAC.rExit - 0.042, L - 0.03], [NAC.rFan + 0.024, zS + 0.02]], { segments: seg, uv: UB.acoustic }).occlude(0.4).translate(c[0], c[1], c[2]));
      if (SB.soot) { const zz = [L - 0.6, L - 0.32, L - 0.1, L - 0.02]; n.sleeve.add(K.lathe(zz.map(z => [rAtS(z) + 0.006, z]), { segments: seg, uv: (k) => SB.soot.uv(k / 3) }).translate(c[0], c[1], c[2])); }
    }
    // pylon: aft fairing on the core cowl, main strut, blended into the wing lower surface
    stB.add(K.pylon([{ y: c[1] + 0.92, z0: c[2] + 5.0, z1: c[2] + 9.1, x: c[0], tc: 0.12 }, { y: c[1] + 1.3, z0: c[2] + 1.9, z1: c[2] + 10.2, x: c[0], tc: 0.075 }, { y: c[1] + 1.52, z0: c[2] + 2.3, z1: c[2] + 10.8, x: c[0], tc: 0.07 }], { uv: UB.pylon }));
    stB.add(K.plate([c[0] - sx * 1.36, c[1] + 1.36, c[2] + 1.3], [c[0] - sx * 1.36, c[1] + 1.36, c[2] + 2.65], [c[0] - sx * 1.64, c[1] + 1.64, c[2] + 2.7], [c[0] - sx * 1.6, c[1] + 1.6, c[2] + 1.55], 0.015, UB.engine));   // inboard nacelle strake
    eng.push({ c, n, fanMesh: ge90Fan({ radius: NAC.rFan - 0.015, hub: 0.6, blades: 22, uvBlade: UB.blade, bladeStrip: SB.blade, uvSpinner: UB.spinner, uvSwirl: UB.swirl }) });
  }

  // ---- small details ----------------------------------------------------------------------------------------------------------
  for (const [z, h] of [[-25.5, 0.36], [-5.5, 0.36], [10.0, 0.34]]) stA.add(K.bladeAntenna({ pos: [0, fus.topAt(z) - 0.02, z], height: h, chord: 0.5, sweep: 0.22, uv: UA.antenna }));
  stA.add(K.ellipsoid(0.55, 0.16, 1.4, { segments: 14, rings: 6, uv: UA.antenna }).translate(0, fus.topAt(-14.5) - 0.03, -14.5));      // satcom fairing
  for (const z of [-21.0, 14.0]) stA.add(K.bladeAntenna({ pos: [0, fus.botAt(z) + 0.02, z], height: 0.3, chord: 0.45, sweep: 0.2, down: true, uv: UA.antenna }));
  for (const sx of [-1, 1]) {
    const on = (d, y) => { const z = zd(d), t = fus.tAtY(z, y); return fus.at(z, sx > 0 ? t : 1 - t); };
    for (const [d, y] of [[2.85, 0.15], [3.15, -0.3], [3.45, 0.42]]) {                        // L-shaped pitot probes: mast out, tube forward
      const { p, n } = on(d, y), m = [p[0] + n[0] * 0.13, p[1] + n[1] * 0.13 - 0.02, p[2] + n[2] * 0.13];
      stA.add(K.tube(p, m, 0.022, 0.012, { segments: 6, uv: UA.steel })).add(K.tube(m, [m[0], m[1], m[2] - 0.2], 0.011, 0.008, { segments: 6, uv: UA.steel }));
    }
    for (const [d, y] of [[3.75, 0.0], [5.6, -0.95]]) {                                      // angle-of-attack vane and TAT probe
      const { p, n } = on(d, y), q = [p[0] + n[0] * 0.1, p[1] + n[1] * 0.1, p[2] + n[2] * 0.1];
      stA.add(K.plate(p, [p[0], p[1], p[2] + 0.07], [q[0], q[1], q[2] + 0.03], [q[0], q[1], q[2] - 0.05], 0.008, UA.vane));
      stA.add(K.ellipsoid(0.07, 0.07, 0.07, { segments: 10, rings: 3, uv: UA.vane, z0: 0, z1: 1 }).aim(n).translate(p[0] - n[0] * 0.06, p[1] - n[1] * 0.06, p[2] - n[2] * 0.06));
    }
    { // windshield wiper parked along the bottom of the front pane
      const tt = (t) => (sx > 0 ? t : 1 - t), a = fus.at(WS.IB[0] + 0.01, tt(WS.IB[1] - 0.025)), b = fus.at(WS.OB[0] - 0.13, tt(WS.OB[1] + 0.02));
      const lift = (P, k) => [P.p[0] + P.n[0] * k, P.p[1] + P.n[1] * k, P.p[2] + P.n[2] * k];
      stA.add(K.tube(lift(a, 0.025), lift(b, 0.025), 0.012, 0.01, { segments: 5, uv: UA.wiper })).add(K.tube(lift(b, 0.0), lift(b, 0.03), 0.025, 0.02, { segments: 6, uv: UA.wiper }));
    }
  }
  for (const z of [-17.5, 9.0]) stA.add(K.bladeAntenna({ pos: [0, fus.botAt(z) + 0.02, z], height: 0.24, chord: 0.18, sweep: 0.12, down: true, uv: UA.dark }));   // drain masts
  for (const [z, x] of [[-20.0, 0.35], [-19.0, -0.35], [2.0, 0]]) { const y = fus.topAt(z) - 0.01; stA.add(K.ellipsoid(0.12, 0.035, 0.16, { segments: 10, rings: 3, uv: UA.antenna }).translate(x, y - x * x * 0.16, z)); }   // GPS / TCAS domes
  // tail skid (extends with the gear on the real aircraft; fixed here)
  { const z = 21.0, yb = fus.botAt(z); stA.add(K.prism([[z - 0.9, yb + 0.1], [z + 0.9, yb + 0.1], [z + 0.55, yb - 0.32], [z - 0.4, yb - 0.32]], -0.13, 0.13, UA.strut)); stA.add(K.box(0.3, 0.06, 0.75, UA.dark).translate(0, yb - 0.35, z + 0.07)); }
  { const wicks = []; for (const sx of [-1, 1]) { for (const x of [26.0, 27.6, 29.2, 31.6]) { const p = W.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } for (const x of [7.0, 8.6, 10.0]) { const p = stab.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } } for (const y of [11.5, 13.2]) { const p = fin.at(y, 1, 'mid'); wicks.push(p); } stB.add(K.staticWicks(wicks, 0.26, UB.wick)); }

  lap('geometry');
  // ---- paint + materials ------------------------------------------------------------------------------------------------------
  paintFuselage(A, { SC, fus, cFus, cPanel, cOver, cPed, WIN, zd });
  paintSurfaces(B, { SC, W: W.R, fin, stab: stab.R, cWT, cWB, cSt, cFin, SP_IN, SP_OUT, SLAT_OUT, XE });
  lap('paint');
  const matA = A.material(ctx, { envMapIntensity: 1, emissiveIntensity: 0 }), matB = B.material(ctx, { envMapIntensity: 1 });
  lap('textures');
  rig.material('paint', matA, { shared: true }); rig.material('wing', matB, { shared: true });
  rig.glass('glass', K.glassMaterial(ctx, { tint: '#0e161d', opacity: 0.42, edgeOpacity: 0.9, roughness: 0.03, reflect: 1.05, dust: 0.03 }));
  rig.addStatic(glaz.glass, 'glass');
  rig.disposables.push(A, B);

  // ---- moving surfaces --------------------------------------------------------------------------------------------------------
  const drop = (ctrl, d, aft = 0) => { const u = ctrl.up, h = ctrl.hinge, o = [-u[0] * d, -u[1] * d, -u[2] * d + aft]; return { a: [h.a[0] + o[0], h.a[1] + o[1], h.a[2] + o[2]], b: [h.b[0] + o[0], h.b[1] + o[1], h.b[2] + o[2]] }; };
  const hingeOn = (name, mesh, line, ref, toward, parent) => { const node = rig.part(name, mesh, { key: 'wing', pivot: line.a, parent }); return rig.hinge(node, line.a, line.b, { ref, toward }); };
  const DOWN = [0, -1, 0], UP = [0, 1, 0];
  const wingAnim = [];
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const C = W[key].controls, a = {};
    { // double-slotted inboard flap: main panel on a deep hinge, aft panel riding on it
      const mesh = C.flapIn.mesh.clone(), cn = canoeAt(6.9, 4.6, sx, 1.1); stB.add(cn.front); mesh.add(cn.rear);
      const line = drop(C.flapIn, 1.2, 0.1), node = rig.part('flapIn' + key, mesh, { key: 'wing', pivot: line.a });
      a.flapIn = rig.hinge(node, line.a, line.b, { ref: C.flapIn.ref, toward: DOWN });
      a.flapInAft = hingeOn('flapInAft' + key, C.flapInAft.mesh, drop(C.flapInAft, 0.3), C.flapInAft.ref, DOWN, node);
    }
    { const mesh = C.flapOut.mesh.clone(); for (const x of [15.6, 19.0, 22.4]) { const cn = canoeAt(x, 3.9 - (x - 15) * 0.1, sx, 0.95 - (x - 15) * 0.02); stB.add(cn.front); mesh.add(cn.rear); }
      a.flapOut = hingeOn('flapOut' + key, mesh, drop(C.flapOut, 0.95, -0.05), C.flapOut.ref, DOWN); }
    a.flaperon = rig.hingePart('flaperon' + key, C.flaperon, { key: 'wing' }).set;
    a.aileron = rig.hingePart('aileron' + key, C.aileron, { key: 'wing' }).set;
    a.slatIn = hingeOn('slatIn' + key, C.slatIn.mesh, drop(C.slatIn, 0.7, 0.25), C.slatIn.ref, DOWN);
    a.slatOut = hingeOn('slatOut' + key, C.slatOut.mesh, drop(C.slatOut, 0.5, 0.18), C.slatOut.ref, DOWN);
    // spoilers: inboard pair (ground + speedbrake), outboard five (roll + speedbrake + ground)
    const grp = (name, ids) => { const m = new K.Mesh(); for (const i of ids) m.add(C['sp' + i].mesh); const c0 = C['sp' + ids[0]], c1 = C['sp' + ids[ids.length - 1]]; return hingeOn(name + key, m, { a: c0.hinge.a, b: c1.hinge.b }, c0.ref, UP); };
    a.spIn = grp('spoilerIn', [1, 2]); a.spOut = grp('spoilerOut', [3, 4, 5, 6, 7]);
    a.elev = rig.hingePart('elevator' + key, stab[key].controls.elevator, { key: 'wing' }).set;
    a.key = key; wingAnim.push(a);
  }
  const rudMesh = fin.controls.rudderUp.mesh.clone().add(fin.controls.rudderLo.mesh);
  const rud = rig.hingePart('rudder', fin.controls.rudderUp, { key: 'wing', toward: [1, 0, 0], mesh: rudMesh });
  const tabC = fin.controls.tab, tabSet = hingeOn('rudderTab', tabC.mesh, tabC.hinge, tabC.ref, [1, 0, 0], rud.node);
  const fans = [], sleeves = [];
  eng.forEach((e, i) => {
    fans.push(rig.part('fan' + i, e.fanMesh.translate(e.c[0], e.c[1], e.n.fanZ), { key: 'wing', pivot: [e.c[0], e.c[1], e.n.fanZ] }));
    sleeves.push({ node: rig.part('reverser' + i, e.n.sleeve, { key: 'wing', pivot: e.c }), travel: e.n.sleeveTravel });
  });
  rig.addStatic(stA, 'paint'); rig.addStatic(stB, 'wing');

  // ---- landing gear -----------------------------------------------------------------------------------------------------------
  const gp = G.gear, gearUV = { strut: UA.strut, piston: UA.chrome, link: UA.link };     // tyres / hubs from the kit's shaded strips
  const strips = K.tyreStrips(A);
  const doorOf = (patch, edge) => ({ mesh: K.thicken(patch, 0.03, UA.well), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  K.buildGear(rig, A, {
    name: 'nose', index: 0, contact: gp[0].pos, wheels: [-0.33, 0.33], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.3, pivot: [0, -1.85, -28.15], stroke: 0.4, staticFrac: 0.4,
    strutR: 0.11, steer: true, links: 'front', retract: { to: [0, -2.15, -30.6] }, window: [0.2, 0.88], brace: [0, -1.8, -29.7], uv: gearUV, wheelSegments: 24,
    doors: [
      { name: 'noseDoorFR', ...doorOf(fus.patches.ngfR, fus.edges.ngfR.tHi), open: 85, closes: true }, { name: 'noseDoorFL', ...doorOf(fus.patches.ngfL, fus.edges.ngfL.tLo), open: 85, closes: true },
      { name: 'noseDoorAR', ...doorOf(fus.patches.ngaR, fus.edges.ngaR.tHi), open: 82 }, { name: 'noseDoorAL', ...doorOf(fus.patches.ngaL, fus.edges.ngaL.tLo), open: 82 },
    ],
    lamps: [{ kind: 'taxi', pos: [0, -2.62, -28.32], size: 0.07, color: [1, 0.96, 0.9] }, { kind: 'landing', pos: [0, -2.48, -28.3], size: 0.06, color: [1, 0.97, 0.92] }],
  });
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos;
    bogieGear(rig, {
      name: 'main' + key, index: i, side: sx, contact: c, R: gp[i].wheelRadius, wW: 0.5, pivot: [sx * 5.3, -1.45, 2.1], stow: [sx * 2.75, -2.0, 2.6],
      stroke: 0.5, staticFrac: 0.4, strutR: 0.2, axle: 1.45, track: 0.7, tilt: 12, window: [0.18, 0.9], uv: UA, strips,
      brace: [sx * 3.2, -1.6, 2.2], drag: [sx * 5.4, -1.2, 0.4], legDoor: UA.fair,
      door: { mesh: K.thicken(fair.patches['mlg' + key], 0.03, UA.well), edge: sx > 0 ? fair.edges.mlgR.tLo : fair.edges.mlgL.tHi, ref: K.centroid(fair.patches['mlg' + key]) },
    });
  }

  // ---- lamps ------------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.12, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.12, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.07 });
  for (const sx of [-1, 1]) rig.lamp('strobe', [sx * (Math.abs(L.navRight[0]) + 0.02), L.navRight[1], L.navRight[2] + 0.22], { color: [1, 1, 1], size: 0.07 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.07 });
  rig.lamp('beacon', L.beacon, { color: [1, 0.05, 0.03], size: 0.11, squash: [1, 0.6, 1] });
  rig.lamp('beacon', [0, -3.43, -2.5], { color: [1, 0.05, 0.03], size: 0.11, squash: [1, 0.6, 1] });
  for (const sx of [-1, 1]) rig.lamp('landing', [sx * Math.abs(L.landing[0]), L.landing[1], L.landing[2]], { color: [1, 0.97, 0.9], size: 0.13, squash: [1.4, 0.8, 0.5] });
  const turnoff = [-1, 1].map(sx => fair.at(-9.6, sx > 0 ? 0.21 : 0.79).p);
  for (const p of turnoff) rig.lamp('taxi', [p[0], p[1], p[2]], { color: [1, 0.97, 0.9], size: 0.07 });   // runway turn-off lights
  // night halos: soft additive sprites so the lamps read at chase distance (drawn after the rig, not a kit mesh)
  const strobeW = [-1, 1].map(sx => [sx * (Math.abs(L.navRight[0]) + 0.08), L.navRight[1], L.navRight[2] + 0.22]);
  const HALO = [
    { p: [L.navLeft[0] - 0.08, L.navLeft[1], L.navLeft[2]], c: [1, 0.05, 0.03], k: 'nav', s: 3.2 }, { p: [L.navRight[0] + 0.08, L.navRight[1], L.navRight[2]], c: [0.05, 1, 0.3], k: 'nav', s: 3.2 },
    { p: [L.tail[0], L.tail[1], L.tail[2] + 0.08], c: [1, 1, 1], k: 'nav', s: 2.4 },
    { p: strobeW[0], c: [1, 1, 1], k: 'strobe', s: 6 }, { p: strobeW[1], c: [1, 1, 1], k: 'strobe', s: 6 }, { p: [L.strobe[0], L.strobe[1], L.strobe[2] + 0.08], c: [1, 1, 1], k: 'strobe', s: 4.5 },
    { p: [L.beacon[0], L.beacon[1] + 0.08, L.beacon[2]], c: [1, 0.08, 0.04], k: 'beacon', s: 4 }, { p: [0, -3.5, -2.5], c: [1, 0.08, 0.04], k: 'beacon', s: 4 },
    ...[-1, 1].map(sx => ({ p: [sx * Math.abs(L.landing[0]), L.landing[1] - 0.05, L.landing[2] - 0.15], c: [1, 0.95, 0.85], k: 'landing', s: 6 })),
    ...turnoff.map(p => ({ p: [p[0], p[1], p[2] - 0.1], c: [1, 0.95, 0.85], k: 'taxi', s: 3.5 })),
    { p: [0, -2.62, -28.45], c: [1, 0.95, 0.85], k: 'taxi', s: 4 },
  ];
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(HALO.flatMap(h => h.p), 3));
  haloGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(HALO.length * 3).fill(0), 3));
  haloGeo.setAttribute('size', new THREE.Float32BufferAttribute(HALO.map(h => h.s), 1));
  const haloMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, fog: false,
    vertexShader: 'attribute float size; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * 0.5 * projectionMatrix[1][1] * 360.0 / max(0.5, -mv.z), 2.0, 128.0); }',
    fragmentShader: 'varying vec3 vC; void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard; float a = exp(-r2 * 5.0) + 0.25 * exp(-r2 * 1.4) * (1.0 - r2); gl_FragColor = vec4(vC * a, 1.0); }',
  });
  const halo = new THREE.Points(haloGeo, haloMat); halo.name = 'halos'; halo.frustumCulled = false; halo.renderOrder = 6;
  const haloCol = haloGeo.attributes.color;

  // ---- animation --------------------------------------------------------------------------------------------------------------
  let fanAng = [0, 0];
  rig.onUpdate((S, dt) => {
    const sf = S.sf, f = sf.flaps, sl = Math.max(sf.slats, 0), gnd = S.onGround ? 1 : 0;
    for (const a of wingAnim) {
      const R = a.key === 'R', ail = R ? sf.aileronR : sf.aileronL, sp = R ? sf.spoilerR : sf.spoilerL, el = R ? sf.elevatorR : sf.elevatorL;
      a.flapIn(f * 30 * DEG); a.flapInAft(f * 22 * DEG); a.flapOut(f * 32 * DEG);
      a.flaperon((ail * 18 - f * 28) * DEG);
      a.aileron((ail * 25 - Math.min(1, f * 2) * 10) * DEG);
      a.slatIn(sl * 22 * DEG); a.slatOut(sl * 25 * DEG);
      const sb = sf.speedbrake, roll = Math.max(0, sp);
      a.spIn(gnd * sb * 55 * DEG);
      a.spOut(Math.min(1, Math.max(roll, sb * (gnd ? 1 : 0.6))) * 50 * DEG);
      a.elev((el > 0 ? el * 30 : el * 20) * DEG);
    }
    rud.set(sf.rudder * 27 * DEG); tabSet(sf.rudder * 15 * DEG);
    for (let i = 0; i < 2; i++) {
      const e = S.eng[i] || {};
      fanAng[i] = (fanAng[i] + (e.n1 || 0) * 22 * dt) % (Math.PI * 2);
      fans[i].quaternion.set(0, 0, Math.sin(fanAng[i] / 2), Math.cos(fanAng[i] / 2));
      sleeves[i].node.position.z = sleeves[i].node.userData.restZ + (e.reverser || 0) * sleeves[i].travel;
    }
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
  for (const s of sleeves) s.node.userData.restZ = s.node.position.z;
  const visual = rig.build();
  visual.object3D.add(halo); rig.disposables.push(haloGeo, haloMat);
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- flight-deck glazing ----------------------------------------------------------------------------------------------------------
// The six windows as convex outlines in (z, t) on the right side (t < 0.5): two front panes on the nose shoulders meeting at a
// narrow centre post, two side windows, and the small aft window whose upper edge slopes down. Returns the list with WS/S1/S2/S3.
function flightDeckWindows(f, zd) {
  const tAtX = (z, x) => { let lo = 0.25, hi = 0.5; for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (f.at(z, m).p[0] > x) lo = m; else hi = m; } return (lo + hi) / 2; };
  const zy = (d, y) => [zd(d), f.tAtY(zd(d), y)], zx = (d, x) => [zd(d), tAtX(zd(d), x)];
  const WS = { IB: zx(3.98, 0.06), OB: zx(4.42, 1.36), OT: zx(5.1, 1.3), IT: zx(4.84, 0.06) };
  const S1 = { bf: zy(4.58, 0.98), br: zy(5.5, 0.97), tr: zy(5.5, 1.7), tf: zy(5.2, 1.77) };
  const S2 = { bf: zy(5.62, 0.97), br: zy(6.52, 0.98), tr: zy(6.52, 1.6), tf: zy(5.62, 1.68) };
  const S3 = { bf: zy(6.64, 0.99), br: zy(7.2, 1.03), rt: zy(7.2, 1.36), nt: zy(7.02, 1.5), tf: zy(6.64, 1.57) };
  const W = [[WS.IB, WS.OB, WS.OT, WS.IT], [S1.bf, S1.br, S1.tr, S1.tf], [S2.bf, S2.br, S2.tr, S2.tf], [S3.bf, S3.br, S3.rt, S3.nt, S3.tf]];
  return Object.assign(W, { WS, S1, S2, S3 });
}
/** Grid-aligned (z, t) box around both sides' windows: the main skin is cut there and rebuilt by glazing(). */
function glazingBox(W, Kring) {
  let z0 = 1e9, z1 = -1e9, tm = 1;
  for (const w of W) for (const [z, t] of w) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); tm = Math.min(tm, t); }
  const t0 = (Math.floor(tm * Kring) - 1) / Kring;
  return { z: [z0 - 0.14, z1 + 0.14], t: [t0, 1 - t0] };
}
/**
 * Rebuild the skin inside `box` with holes for the convex (z, t) polygons, clipping each skin cell against them; the clipped
 * insides become the glass (set `depth` metres in). Cells follow the loft's own ring columns so the edges match the main skin.
 */
function glazing(f, chart, polys, box, dzRow, depth = 0.014, uvSeal = null) {
  const skin = new K.Mesh(), glass = new K.Mesh(), Kr = f.K, memo = new Map();
  const area = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const W = polys.map(P => (area(P) > 0 ? P : P.slice().reverse()));
  const bb = W.map(P => [Math.min(...P.map(p => p[0])), Math.max(...P.map(p => p[0])), Math.min(...P.map(p => p[1])), Math.max(...P.map(p => p[1]))]);
  const clip = (poly, a, b, keepIn) => {
    const out = [], side = (p) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * (keepIn ? 1 : -1);
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const k = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]); }
    }
    return out.length >= 3 && Math.abs(area(out)) > 1e-9 ? out : null;
  };
  const emit = (m, poly, off) => {
    const vs = poly.map(([z, t]) => {
      const key = Math.round(z * 1e4) * 1e5 + Math.round(t * 1e5); let q = memo.get(key);
      if (!q) { q = f.at(z, t); q.uv = chart.uvUnwrap(z, t, chart.stripAt(z)); memo.set(key, q); }
      const { p, n } = q; return { p: [p[0] - n[0] * off, p[1] - n[1] * off, p[2] - n[2] * off], n, uv: q.uv };
    });
    for (let i = 1; i < vs.length - 1; i++) {
      const A = vs[0]; let B = vs[i], C = vs[i + 1];
      const e1 = [B.p[0] - A.p[0], B.p[1] - A.p[1], B.p[2] - A.p[2]], e2 = [C.p[0] - A.p[0], C.p[1] - A.p[1], C.p[2] - A.p[2]];
      const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
      if (cx * A.n[0] + cy * A.n[1] + cz * A.n[2] < 0) [B, C] = [C, B];
      const i0 = m.vertexCount;
      for (const v of [A, B, C]) m.vert(v.p[0], v.p[1], v.p[2], v.n[0], v.n[1], v.n[2], v.uv[0], v.uv[1]);
      m.tri(i0, i0 + 1, i0 + 2);
    }
  };
  const zs = [box.z[0], box.z[1]];
  for (let z = box.z[0] + dzRow; z < box.z[1] - dzRow * 0.3; z += dzRow) zs.push(z);
  for (const P of W) for (const p of P) zs.push(p[0]);
  zs.sort((a, b) => a - b);
  const Z = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 0.01);
  const j0 = Math.round(box.t[0] * Kr), j1 = Math.round(box.t[1] * Kr);
  for (let i = 0; i < Z.length - 1; i++) for (let j = j0; j < j1; j++) {
    const za = Z[i], zb = Z[i + 1], ta = j / Kr, tb = (j + 1) / Kr;
    let outside = [[[za, ta], [zb, ta], [zb, tb], [za, tb]]];
    W.forEach((P, w) => {
      const b = bb[w]; if (zb < b[0] || za > b[1] || tb < b[2] || ta > b[3]) return;
      const next = [];
      for (const piece of outside) {
        let rest = piece;
        for (let e = 0; e < P.length && rest; e++) { const a = P[e], c = P[(e + 1) % P.length], o = clip(rest, a, c, false); if (o) next.push(o); rest = clip(rest, a, c, true); }
        if (rest) emit(glass, rest, depth);
      }
      outside = next;
    });
    for (const piece of outside) emit(skin, piece, 0);
  }
  // reveal: a dark seal wall around each opening, from the skin down to the pane
  if (uvSeal) for (const P of W) {
    let cz = 0, ct = 0; for (const p of P) { cz += p[0] / P.length; ct += p[1] / P.length; }
    const c3 = f.at(cz, ct).p;
    for (let e = 0; e < P.length; e++) {
      const a = P[e], b = P[(e + 1) % P.length], nSeg = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], (b[1] - a[1]) * 19) / 0.12));
      for (let k = 0; k < nSeg; k++) {
        const pa = f.at(a[0] + (b[0] - a[0]) * k / nSeg, a[1] + (b[1] - a[1]) * k / nSeg), pb = f.at(a[0] + (b[0] - a[0]) * (k + 1) / nSeg, a[1] + (b[1] - a[1]) * (k + 1) / nSeg);
        const a0 = pa.p, b0 = pb.p, a1 = a0.map((v, i) => v - pa.n[i] * depth * 1.15), b1 = b0.map((v, i) => v - pb.n[i] * depth * 1.15);
        const u = [b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]], v = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]];
        let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
        const flip = nx * (c3[0] - a0[0]) + ny * (c3[1] - a0[1]) + nz * (c3[2] - a0[2]) < 0, l = Math.hypot(nx, ny, nz) * (flip ? -1 : 1) || 1;
        nx /= l; ny /= l; nz /= l;
        const i0 = skin.vertexCount;
        for (const q of [a0, b0, b1, a1]) skin.vert(q[0], q[1], q[2], nx, ny, nz, uvSeal[0], uvSeal[1]);
        if (flip) skin.quad(i0 + 3, i0 + 2, i0 + 1, i0); else skin.quad(i0, i0 + 1, i0 + 2, i0 + 3);
      }
    }
  }
  return { skin, glass };
}

// ---- GE90 fan: 22 wide-chord composite blades with a swept, curved tip, conical spinner with a white swirl -------------------
function ge90Fan(o) {
  const R = o.radius, hub = o.hub, nb = o.blades, m = new K.Mesh(), NS = 10, TAU = Math.PI * 2, uvB = o.uvBlade, SBl = o.bladeStrip;
  const uvLE = SBl ? SBl.uv(0) : uvB, uvTE = SBl ? SBl.uv(1) : uvB;
  for (let i = 0; i < nb; i++) {
    const phi0 = i / nb * TAU, rows = [];
    for (let k = 0; k <= NS; k++) {
      const f = k / NS, r = hub * 0.97 + (R - hub * 0.97) * f;
      const beta = (26 + 40 * Math.pow(f, 0.85)) * DEG;                         // stagger from the axis
      const cc = R * (0.38 + 0.3 * Math.sin(Math.PI * Math.min(1, f * 0.95 + 0.05)) - 0.03 * f * f);   // very wide chord: the blades overlap seen from ahead
      const sweep = R * (0.05 * f + 0.2 * f * f * f);                           // leading edge sweeps aft toward the tip
      const lean = 0.16 * f * f;                                                // scimitar curve in the direction of rotation
      const phi = phi0 + lean, rad = [Math.cos(phi), Math.sin(phi), 0], tan = [-Math.sin(phi), Math.cos(phi), 0];
      const dir = [tan[0] * Math.sin(beta), tan[1] * Math.sin(beta), Math.cos(beta)];
      const zc = 0.22 + sweep, le = [rad[0] * r - dir[0] * cc * 0.45, rad[1] * r - dir[1] * cc * 0.45, zc - dir[2] * cc * 0.45], te = [rad[0] * r + dir[0] * cc * 0.55, rad[1] * r + dir[1] * cc * 0.55, zc + dir[2] * cc * 0.55];
      const n = [dir[1] * rad[2] - dir[2] * rad[1], dir[2] * rad[0] - dir[0] * rad[2], dir[0] * rad[1] - dir[1] * rad[0]];
      rows.push({ le, te, n });
    }
    for (const sg of [1, -1]) {
      const base = m.vertexCount;
      for (const q of rows) { m.vert(q.le[0], q.le[1], q.le[2], q.n[0] * sg, q.n[1] * sg, q.n[2] * sg, uvLE[0], uvLE[1]); m.vert(q.te[0], q.te[1], q.te[2], q.n[0] * sg, q.n[1] * sg, q.n[2] * sg, uvTE[0], uvTE[1]); }
      for (let k = 0; k < NS; k++) { const a = base + k * 2, b = a + 1, c = a + 3, d = a + 2; if (sg > 0) m.quad(a, b, c, d); else m.quad(a, d, c, b); }
    }
  }
  const sl = 0.95;
  const prof = [[0, -sl], [hub * 0.1, -sl * 0.93], [hub * 0.42, -sl * 0.6], [hub * 0.75, -sl * 0.28], [hub * 0.97, -0.02], [hub, 0.15], [hub, 0.75, 1], [0, 0.75]];
  m.add(K.lathe(prof, { segments: 28, uv: o.uvSpinner }));
  // white swirl: a spiral stripe on the spinner cone
  const pts = [];
  for (let k = 0; k <= 14; k++) { const f = 0.12 + 0.82 * k / 14, z = -sl * (1 - f), r = hub * (0.1 + 0.9 * f) * 1.012 + 0.012, a = 2.6 * f; pts.push([r * Math.cos(a), r * Math.sin(a), z]); }
  m.add(K.pipe(pts, 0.05, { segments: 6, uv: o.uvSwirl }));
  return m;
}

// ---- six-wheel main gear: oleo leg hinged in the wing, tilting bogie with three axles, steering rear axle, doors --------------
function bogieGear(rig, o) {
  const ctx = rig.ctx, V = (a) => new THREE.Vector3(a[0], a[1], a[2]), Ar = (v) => [v.x, v.y, v.z], UA = o.uv;
  const P = V(o.pivot), R = o.R, wW = o.wW, stroke = o.stroke, eStatic = stroke * (1 - o.staticFrac);
  const contact = V(o.contact), C = contact.clone().add(new THREE.Vector3(0, R, 0));
  const d = C.clone().sub(P), Lp = d.length(); d.normalize();
  const Lo = Lp - (eStatic + 0.62), Bt = P.clone().addScaledVector(d, Lo), sr = o.strutR;
  const v1 = d.clone(), v2 = V(o.stow).sub(P).normalize(), rAxis = new THREE.Vector3().crossVectors(v1, v2).normalize(), rAngle = Math.acos(Math.min(1, Math.max(-1, v1.dot(v2))));
  // leg: outer cylinder, trunnion, side brace, drag brace, leg door
  const leg = rig.node(o.name + '.leg', { pivot: Ar(P) });
  const sm = new K.Mesh();
  sm.add(K.tube(Ar(P), Ar(Bt), sr, sr * 0.95, { segments: 16, uv: UA.strut }));
  sm.add(K.tube(Ar(Bt.clone().addScaledVector(d, -0.1)), Ar(Bt.clone().addScaledVector(d, 0.02)), sr * 1.14, sr * 1.14, { segments: 16, uv: UA.strut }));
  sm.add(K.tube(Ar(P.clone().addScaledVector(rAxis, -0.55)), Ar(P.clone().addScaledVector(rAxis, 0.55)), sr * 0.8, sr * 0.8, { segments: 12, uv: UA.strut }));
  for (const [end, r] of [[o.brace, 0.075], [o.drag, 0.085]]) {
    const b0 = P.clone().addScaledVector(d, Lo * 0.55), b1 = V(end), mid = b0.clone().lerp(b1, 0.5).addScaledVector(d, 0.12);
    sm.add(K.tube(Ar(b0), Ar(mid), r, r, { segments: 8, uv: UA.link })).add(K.tube(Ar(mid), Ar(b1), r * 0.9, r * 0.9, { segments: 8, uv: UA.link }));
    sm.add(K.ellipsoid(r * 1.5, r * 1.5, r * 1.5, { segments: 8, rings: 4, uv: UA.link }).translate(mid.x, mid.y, mid.z));
  }
  { // leg door on the outboard face of the strut
    const out = new THREE.Vector3(o.side, 0, 0).addScaledVector(d, -d.x * o.side).normalize().multiplyScalar(sr + 0.08), fw = new THREE.Vector3(0, 0, -1).addScaledVector(d, d.z).normalize();
    const q = (s, f) => Ar(P.clone().addScaledVector(d, s).add(out).addScaledVector(fw, f));
    sm.add(K.plate(q(0.05, 0.62), q(0.05, -0.55), q(Lo * 0.97, -0.5), q(Lo * 0.97, 0.55), 0.03, o.legDoor));
  }
  { // brake and hydraulic lines down the aft face of the strut, clamped at two collars
    const aft = new THREE.Vector3(0, 0, 1).addScaledVector(d, -d.z).normalize(), lat = new THREE.Vector3().crossVectors(d, aft).normalize();
    for (const [k, r] of [[-0.3, 0.018], [0, 0.014], [0.3, 0.016]]) {
      const off = aft.clone().addScaledVector(lat, k).normalize().multiplyScalar(sr + r * 1.4);
      const q = (s, lift = 0) => Ar(P.clone().addScaledVector(d, s).add(off).addScaledVector(off, lift));
      sm.add(K.pipe([q(0.15, 0.6), q(0.3), q(Lo * 0.5), q(Lo * 0.92), q(Lo + 0.05, 0.8)], r, { segments: 5, uv: UA.hose }));
    }
    for (const f of [0.35, 0.75]) sm.add(K.tube(Ar(P.clone().addScaledVector(d, Lo * f - 0.02)), Ar(P.clone().addScaledVector(d, Lo * f + 0.02)), sr * 1.08, sr * 1.08, { segments: 16, uv: UA.link }));
  }
  rig.part(o.name + '.strut', sm, { parent: leg, pivot: Ar(P) });
  // piston (chrome) + bogie pivot yoke
  const pm = new K.Mesh(), yoke = C.clone().addScaledVector(d, -0.22);
  pm.add(K.tube(Ar(Bt.clone().addScaledVector(d, -(stroke + 0.1))), Ar(yoke), sr * 0.62, sr * 0.62, { segments: 14, uv: UA.chrome }));
  pm.add(K.tube(Ar(yoke), Ar(C), sr * 0.75, sr * 0.55, { segments: 12, uv: UA.strut }));
  pm.add(K.tube([C.x - 0.24, C.y, C.z], [C.x + 0.24, C.y, C.z], 0.1, 0.1, { segments: 10, uv: UA.link }));
  // torque links (front)
  { const s0 = Bt.clone().add(new THREE.Vector3(0, 0, -sr * 1.1)), s1 = yoke.clone().add(new THREE.Vector3(0, 0, -sr * 0.8)), apex = s0.clone().lerp(s1, 0.5).add(new THREE.Vector3(0, 0, -0.32));
    pm.add(K.tube(Ar(s1), Ar(apex), 0.035, 0.035, { segments: 6, uv: UA.link })); sm.add(K.tube(Ar(s0), Ar(apex), 0.035, 0.035, { segments: 6, uv: UA.link })); }
  const piston = rig.part(o.name + '.piston', pm, { parent: leg, pivot: Ar(C) });
  // bogie beam + axles + brake rods
  const ax = o.axle, tr = o.track, bm = new K.Mesh();
  bm.add(K.tube([C.x, C.y + 0.02, C.z - ax - 0.32], [C.x, C.y + 0.02, C.z + ax + 0.32], 0.13, 0.13, { segments: 12, uv: UA.strut }));
  for (const z of [-ax, 0, ax]) {
    bm.add(K.tube([C.x - tr - wW * 0.3, C.y, C.z + z], [C.x + tr + wW * 0.3, C.y, C.z + z], 0.085, 0.085, { segments: 10, uv: UA.link }));
    for (const s of [-1, 1]) bm.add(K.tube([C.x + s * 0.12, C.y + 0.12, C.z + z * 0.5], [C.x + s * 0.12, C.y + 0.05, C.z + z], 0.03, 0.03, { segments: 5, uv: UA.link }));
  }
  const bogie = rig.part(o.name + '.bogie', bm, { parent: piston, pivot: Ar(C) });
  const S = o.strips || {}, rb = R * 0.56 * 0.72;
  const wheelSet = (z) => {
    const m = new K.Mesh();
    for (const x of [-tr, tr]) {
      const w = K.wheel({ radius: R, width: wW, uvTyre: UA.tyre, uvHub: UA.hub, segments: 24, tyreStrip: S.tyre, hubStrip: S.hub });
      const sg = -Math.sign(x), x0 = sg * wW * 0.28, x1 = sg * (tr - 0.13);                    // carbon brake stack on the inboard side
      w.add(K.lathe([[rb * 0.45, 0], [rb, 0, 1], [rb, Math.abs(x1 - x0) * 0.75], [rb * 0.8, Math.abs(x1 - x0), 1], [rb * 0.45, Math.abs(x1 - x0)]], { segments: 14, uv: UA.brake }).rotateY(sg * Math.PI / 2).translate(x0, 0, 0));
      m.add(w.translate(C.x + x, C.y, C.z + z));
    }
    return m;
  };
  const wf = rig.part(o.name + '.wheelF', wheelSet(-ax), { parent: bogie, pivot: [C.x, C.y, C.z - ax] });
  const wm = rig.part(o.name + '.wheelM', wheelSet(0), { parent: bogie, pivot: [C.x, C.y, C.z] });
  const yaw = rig.node(o.name + '.yaw', { parent: bogie, pivot: [C.x, C.y, C.z + ax] });
  const wr = rig.part(o.name + '.wheelR', wheelSet(ax), { parent: yaw, pivot: [C.x, C.y, C.z + ax] });
  // well door in the belly fairing, hinged on its inboard edge
  const dn = rig.part(o.name + '.door', o.door.mesh, { pivot: o.door.edge[0] });
  const setDoor = rig.hinge(dn, o.door.edge[0], o.door.edge[1], { ref: o.door.ref, toward: [0, -1, 0] });
  // animation
  const win = o.window, X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), q = new THREE.Quaternion();
  const rest = piston.position.clone();
  let ext = eStatic, spin = 0, rate = 0, first = true;
  rig.onUpdate((S, dt) => {
    const g = S.sf.gear, down = K.seq(g, win[0], win[1]);
    setDoor((Math.min(K.seq(g, 0.02, win[0] - 0.01), 1 - K.seq(g, win[1] + 0.02, 0.99))) * 88 * DEG);
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
    // toe-up tilt when the oleo is extended (hanging), level when compressed on the ground
    const tilt = o.tilt * DEG * K.seq(ext, eStatic + 0.03, stroke - 0.01) * (0.4 + 0.6 * down);
    bogie.quaternion.setFromAxisAngle(X, tilt);
    // rear axle steers against the nose wheel in tight turns
    const ns = (S.gear[0] && S.gear[0].steer) || 0, rs = gs.onGround ? Math.max(-8 * DEG, Math.min(8 * DEG, ns * 0.5)) * K.seq(Math.abs(ns), 0.1, 0.25) : 0;
    yaw.quaternion.setFromAxisAngle(Y, rs);
    if (gs.onGround) rate = isNaN(gs.wheelSpeed) ? S.groundSpeed / R : gs.wheelSpeed; else if (!isNaN(gs.wheelSpeed) && gs.wheelSpeed !== 0) rate = gs.wheelSpeed; else rate *= Math.exp(-0.6 * dt);
    spin = (spin - rate * dt) % (Math.PI * 2);
    q.setFromAxisAngle(X, spin); wf.quaternion.copy(q); wm.quaternion.copy(q); wr.quaternion.copy(q);
  });
}

// ---- paint: fuselage atlas ---------------------------------------------------------------------------------------------------
function paintFuselage(A, o) {
  const { SC, fus, cFus, cPanel, cOver, cPed, WIN, zd } = o, F = K.FINISH;
  const P = A.pen(cFus), body = F.gloss(SC.body), belly = F.gloss(SC.belly), accent = F.gloss(SC.accent);
  const font = K.FONT[SC.font] || K.FONT.wide, Z0 = -36.4, Z1 = 37.7;
  P.fill('all', body);
  // --- livery ---
  if (SC.style === 'cheat') {            // light grey belly, vermilion + charcoal cheat line under the windows tapering to the nose
    P.band(Z0, Z1, -Infinity, (z) => -1.35 + Math.max(0, z - 18) * 0.11, belly, { step: 0.4, feather: 2 });
    const up = (z) => Math.max(0, z - 29.6) * 0.16 + Math.max(0, z - 22) * 0.02;
    P.band(-27.6, Z1, (z) => -0.3 + up(z), (z) => -0.05 + up(z), accent, { step: 0.3 });
    P.band(-27.6, Z1, (z) => -0.46 + up(z), (z) => -0.38 + up(z), F.gloss('#2a2e33'), { step: 0.3 });
    const k = (z) => Math.pow(Math.max(0, (z + 33.2) / 5.6), 1.3);
    P.band(-33.2, -27.58, (z) => -0.175 - 0.125 * k(z), (z) => -0.175 + 0.125 * k(z), accent, { step: 0.1 });
    P.band(-32.2, -27.58, (z) => -0.42 - 0.04 * k(z), (z) => -0.42 + 0.04 * k(z), F.gloss('#2a2e33'), { step: 0.1 });
    P.textOn(SC.title, -14.0, 1.72, 'both', 1.3, { color: SC.titleColor, font, weight: 700, spacing: 0.12 });
    P.decalOn(-21.8, 1.75, 'both', (g, layer, side) => drawFalcon(g, 0.85, SC.accent, side === 'R'));
  } else if (SC.style === 'sweep') {     // navy belly sweeping up the aft fuselage into the tail, with a gold pin line
    const edge = (z) => (z < 8 ? -1.25 + (z + 36.3) * 0.006 : -0.98 + Math.pow((z - 8) / 22, 2.0) * 4.2);
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.2, accent, { step: 0.3 });
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.1, body, { step: 0.3 });
    P.band(Z0, Z1, -Infinity, edge, belly, { step: 0.3 });
    P.textOn(SC.title, -14.0, 1.7, 'both', 1.45, { color: SC.titleColor, font, weight: 700, spacing: 0.04 });
    P.decalOn(-21.2, 1.65, 'both', (g) => drawSun(g, 0.75, SC.accent, SC.tail));
  } else {                               // 'house': grey belly, blue stripe pair through the windows, big titles
    P.band(Z0, Z1, -Infinity, -1.15, belly, { step: 0.5 });
    P.band(-30.5, Z1, -0.5, -0.24, accent, { step: 0.5 });
    P.band(-30.5, Z1, -0.16, -0.09, F.gloss(SC.titleColor), { step: 0.5 });
    P.textOn(SC.title, -15.5, 1.75, 'both', 0.95, { color: SC.titleColor, font, weight: 700, spacing: 0.12 });
    P.textOn('777', -6.0, 1.7, 'both', 1.3, { color: SC.accent, font: K.FONT.round, weight: 700 });
  }
  P.textOn(SC.reg, 20.5, 1.45, 'both', 0.45, { color: SC.style === 'sweep' ? SC.belly : '#1d2126', font: K.FONT.sans, weight: 700 });
  P.textOn('777-300ER', -25.5, -0.7, 'both', 0.2, { color: '#7c8288', font: K.FONT.wide, weight: 700 });
  // radome joint
  P.ring(zd(2.6), 0, 1, { px: 1.4, depth: 0.5, dark: 0.28 });
  // --- flight-deck windows (painted glass with a dark surround) ---
  for (const s of [1, -1]) {
    const m = (p) => [p[0], s > 0 ? p[1] : 1 - p[1]];
    for (const w of WIN) {
      const pts = w.map(m), path = (g) => { pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      P.stroke(path, 0, { color: '#2a2d30', rough: 0.5, metal: 0 }, { join: 'round', px: 2.5 });           // seal edge
      P.fill(pts, F.paintedGlass);
      P.groove(path, { px: 1.2, depth: 0.5, dark: 0.2 });
    }
  }
  // --- cabin windows, doors, hatches ---
  const DOORS = [9.5, 19.8, 45.5, 58.0, 66.5].map(zd), OWE = zd(34.0);
  const zs = []; for (let z = zd(7.6); z < zd(66.2); z += 0.51) if (DOORS.every(dz => Math.abs(z - dz) > 0.85) && Math.abs(z - OWE) > 0.55) zs.push(z);
  P.windows(zs, 0.3, { w: 0.25, h: 0.38, r: 0.1, frame: SC.style === 'house' ? '#d3d7da' : '#c3c7ca' });
  const door = { px: 1.4, depth: 0.6, dark: 0.35 };
  for (const zc of DOORS) { P.doorOn(zc - 0.54, zc + 0.54, -0.95, 1.0, { ...door, handle: true }); P.windows([zc], 0.62, { w: 0.2, h: 0.24, r: 0.08, lit: 0 }); }
  P.doorOn(OWE - 0.3, OWE + 0.3, -0.45, 0.95, door);                                                                    // over-wing exit
  P.doorOn(zd(17.0), zd(20.8), -2.75, -1.1, { ...door, side: 'R' }); P.doorOn(zd(48.0), zd(51.7), -2.7, -1.1, { ...door, side: 'R' }); P.doorOn(zd(57.4), zd(58.6), -2.15, -1.15, { ...door, side: 'R' });   // cargo doors
  P.doorOn(zd(3.4), zd(4.2), -2.0, -1.4, { px: 1, depth: 0.4, dark: 0.15, side: 'L' });                                  // avionics access
  // skin joints: circumferential every ~2 m, lap joints along the crown and above / below the windows
  for (let z = -33.0; z < 37; z += 2.05) P.ring(z, 0, 1, { px: 1, depth: 0.3, dark: 0.07 });
  for (const y of [2.15, 0.85, -0.55, -1.75]) P.yLine(-33.5, 37.0, (z) => Math.min(fus.topAt(z) - 0.25, Math.max(fus.botAt(z) + 0.2, y + Math.max(0, z - 20) * 0.075)), { px: 1, depth: 0.3, dark: 0.07 });
  P.line([[-34.0, 0.5], [37.4, 0.5]], { px: 1, depth: 0.25, dark: 0.05 });
  // static ports, APU inlet / exhaust surround, belly air-conditioning inlets, grime
  P.decalOn(zd(3.0), -0.6, 'both', (g) => { g.fillStyle = '#a1a6aa'; g.beginPath(); g.arc(0, 0, 0.08, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#c42a1e'; g.lineWidth = 0.014; g.strokeRect(-0.18, -0.13, 0.36, 0.26); });
  P.decalOn(35.4, 1.25, 'R', (g) => { g.fillStyle = '#3a3d40'; g.fillRect(-0.4, -0.15, 0.8, 0.3); g.strokeStyle = '#8b9095'; g.lineWidth = 0.02; g.strokeRect(-0.43, -0.18, 0.86, 0.36); });
  P.decalOn(37.0, 0.62, 'L', (g) => { g.fillStyle = 'rgba(40,36,34,0.85)'; g.beginPath(); g.ellipse(0, 0, 0.36, 0.26, 0, 0, Math.PI * 2); g.fill(); });
  P.decalOn(-9.5, -2.6, 'both', (g) => { g.fillStyle = '#4a4e52'; g.beginPath(); g.ellipse(0, 0, 0.4, 0.09, 0, 0, Math.PI * 2); g.fill(); });
  // door furniture: handle recess with a red arming placard, the door number above, slide-bustle seam below the sill
  DOORS.forEach((zc, i) => {
    P.decalOn(zc + 0.22, 0.05, 'both', (g) => { g.fillStyle = '#5a5e62'; g.fillRect(-0.09, -0.035, 0.18, 0.07); g.fillStyle = '#b8231c'; g.fillRect(-0.06, 0.06, 0.12, 0.045); g.fillStyle = '#e8e8e8'; g.fillRect(-0.045, 0.075, 0.09, 0.012); });
    P.textOn(String(i + 1) + 'L', zc - 0.3, 1.18, 'L', 0.09, { color: '#6f757b', font: K.FONT.sans, weight: 700 });
    P.textOn(String(i + 1) + 'R', zc - 0.3, 1.18, 'R', 0.09, { color: '#6f757b', font: K.FONT.sans, weight: 700 });
    P.yLine(zc - 0.5, zc + 0.5, -1.15, { px: 1, depth: 0.3, dark: 0.08 });
  });
  P.textOn('EMERGENCY EXIT', OWE, 1.1, 'both', 0.06, { color: '#b8231c', font: K.FONT.sans, weight: 700 });
  // grime trails from the drain masts and the gear bays along the belly
  for (const z0 of [-17.4, 9.1]) for (let k = 0; k < 4; k++) P.streak(z0, 0.004 + k * 0.004, z0 + 3 + k * 1.3, 0.003 + k * 0.006, 0.006, { alpha: 0.12 - k * 0.02 });
  for (const s of [1, -1]) for (let k = 0; k < 6; k++) { const t = s > 0 ? 0.06 + k * 0.012 : 0.94 - k * 0.012; P.streak(4.8, t, 9 + k * 1.5, t + s * 0.01, 0.012, { alpha: 0.07 }); }
  const rnd = (() => { let a = 17; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  for (let i = 0; i < 46; i++) { const z = -26 + rnd() * 55, t = rnd() < 0.5 ? rnd() * 0.07 : 1 - rnd() * 0.07; P.streak(z, t, z + 1.0 + rnd() * 3, t, 0.004 + rnd() * 0.01, { alpha: 0.05 + rnd() * 0.08 }); }
  for (let i = 0; i < 10; i++) { const z = 33.5 + rnd() * 3.5; P.streak(z, 0.62 + rnd() * 0.05, z + 1.4, 0.6 + rnd() * 0.05, 0.012, { alpha: 0.08 }); }
  P.noise({ alpha: 0.028, scale: 4, stretch: [2, 1] });
  P.noise({ alpha: 0.022, scale: 12, stretch: [2, 1] });
  // --- flight-deck panels: six displays, MCP strip, pedestal, overhead ---
  {
    const Q = A.pen(cPanel); Q.fill('all', { color: '#4c5157', rough: 0.7, metal: 0 });
    const scr = (a, b, w, h, col, fn) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#08090a', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(a + 0.012, b + 0.012, w - 0.024, h - 0.024), { color: col, rough: 0.15, metal: 0, emissive: col }); if (fn) Q.decal(a + w / 2, b + h / 2, { layers: ['color', 'emis'] }, fn); };
    const pfd = (g) => { g.fillStyle = '#2d6fbf'; g.fillRect(-0.07, -0.09, 0.14, 0.085); g.fillStyle = '#8a5a2a'; g.fillRect(-0.07, -0.005, 0.14, 0.085); g.strokeStyle = '#f2d23a'; g.lineWidth = 0.006; g.beginPath(); g.moveTo(-0.045, 0); g.lineTo(0.045, 0); g.stroke(); };
    const nd = (g) => { g.strokeStyle = '#e8e8e8'; g.lineWidth = 0.004; g.beginPath(); g.arc(0, 0.06, 0.09, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); g.strokeStyle = '#d65cd6'; g.beginPath(); g.moveTo(0, 0.06); g.lineTo(0.03, -0.04); g.lineTo(0.06, -0.08); g.stroke(); };
    const eicas = (g) => { g.strokeStyle = '#e8e8e8'; g.lineWidth = 0.004; for (const x of [-0.05, 0.05]) { g.beginPath(); g.arc(x, -0.04, 0.03, Math.PI, Math.PI * 1.8); g.stroke(); } g.fillStyle = '#3ad16a'; g.fillRect(-0.07, 0.03, 0.14, 0.004); g.fillStyle = '#f2a53a'; g.fillRect(-0.07, 0.05, 0.09, 0.004); };
    for (const [x0, flip] of [[0.12, 0], [1.58, 1]]) { scr(flip ? x0 + 0.36 : x0, 0.17, 0.34, 0.26, '#0c1322', pfd); scr(flip ? x0 : x0 + 0.36, 0.17, 0.34, 0.26, '#0b1220', nd); }
    scr(1.03, 0.08, 0.34, 0.24, '#0b1120', eicas); scr(1.03, 0.34, 0.34, 0.24, '#0b1120', nd);
    Q.fill((g) => g.rect(0.25, 0.0, 1.9, 0.07), { color: '#2e3236', rough: 0.6, metal: 0 });                     // MCP on the glareshield face
    for (let i = 0; i < 9; i++) Q.fill((g) => g.rect(0.35 + i * 0.19, 0.018, 0.1, 0.034), { color: '#0a0a0a', rough: 0.2, metal: 0, emissive: i % 3 ? '#3a2408' : '#000000' });
    Q.fill((g) => g.rect(0.85, 0.47, 0.06, 0.1), { color: '#c8c8c4', rough: 0.4, metal: 0 });                    // gear lever
  }
  {
    const Q = A.pen(cOver); Q.fill('all', { color: '#5f666d', rough: 0.7, metal: 0 });
    for (let j = 0; j < 9; j++) for (let i = 0; i < 8; i++) Q.fill((g) => g.rect(0.04 + i * 0.095, 0.04 + j * 0.104, 0.07, 0.075), { color: (i + j * 2) % 5 ? '#41474d' : '#202327', rough: 0.6, metal: 0, emissive: (i * 3 + j) % 7 === 0 ? '#1c1403' : undefined });
  }
  {
    const Q = A.pen(cPed); Q.fill('all', { color: '#4f555c', rough: 0.7, metal: 0 });
    for (const b of [0.36, 0.56]) for (const a of [0.04, 0.26]) { Q.fill((g) => g.rect(a, b, 0.2, 0.17), { color: '#0b0c0d', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(a + 0.02, b + 0.02, 0.16, 0.08), { color: '#0d1a12', rough: 0.2, metal: 0, emissive: '#0d2414' }); }
    Q.fill((g) => g.rect(0.08, 0.03, 0.34, 0.28), { color: '#25282c', rough: 0.6, metal: 0 });
  }
}

// ---- paint: wings, tail -----------------------------------------------------------------------------------------------------------
function paintSurfaces(B, o) {
  const { SC, W, fin, stab, cWT, cWB, cSt, cFin, SP_IN, SP_OUT, SLAT_OUT, XE } = o, F = K.FINISH;
  const grey = F.semigloss('#aeb3b7'), dgrey = F.semigloss('#9fa5aa'), metal = { color: '#c9ccce', rough: 0.26, metal: 0.9 };
  const line = { px: 1, depth: 0.3, dark: 0.08 }, gap = { px: 1.8, depth: 0.8, dark: 0.5 };
  const at = (x, f) => { const p = W.at(x, f); return [p[0], p[2]]; };
  const L = (name, x) => W.lines[name].at(W.spanToU(x));
  for (const [chart, top] of [[cWT.i, true], [cWT.o, true], [cWB.i, false], [cWB.o, false]]) {
    const Q = B.pen(chart); Q.fill('all', grey);
    const span = (x0, x1, f0, f1, fin) => { const xs = []; for (let x = x0; x < x1; x += 1.5) xs.push(x); xs.push(x1); Q.fill([...xs.map(x => at(x, typeof f0 === 'string' ? L(f0, x) + 0.03 : f0)), ...xs.reverse().map(x => at(x, typeof f1 === 'string' ? L(f1, x) - 0.02 : f1))], fin); };
    if (top) span(2.2, 30.5, 'slat', 'spoil', dgrey);
    span(2.2, XE, 0, 'slat', F.semigloss('#c3c7cb'));                                                      // painted slats
    span(2.2, XE, 0, 0.014, metal);                                                                        // polished erosion strip on the very leading edge
    const seg = (name, xs, op) => { const pts = []; for (let x = xs[0]; x < xs[1]; x += 1.0) pts.push(at(x, L(name, x))); pts.push(at(xs[1], L(name, xs[1]))); Q.line(pts, op); };
    seg('slat', [3.6, 9.0], gap); seg('slat', [12.6, 29.8], gap);
    for (const x of [3.6, 9.0, ...SLAT_OUT]) Q.line([at(x, 0), at(x, L('slat', x))], gap);
    if (top) for (const [x0, x1] of [...SP_IN, ...SP_OUT]) Q.line([at(x0, L('spoil', x0)), at(x1, L('spoil', x1)), at(x1, L('flap', x1)), at(x0, L('flap', x0)), at(x0, L('spoil', x0))], gap);
    for (const s of [[3.3, 10.1], [10.3, 13.7], [13.9, 24.4], [24.6, 29.8]]) { seg('flap', s, gap); for (const x of s) Q.line([at(x, L('flap', x)), at(x, 1)], gap); }
    seg('aft', [3.3, 10.1], gap);
    for (const f of [0.18, 0.3, 0.45]) seg2(Q, at, 2.4, 31, f, line);
    for (let x = 3.6; x < 30; x += 1.4) Q.line([at(x, L('slat', x) + 0.01), at(x, L('spoil', x) - 0.01)], line);
    for (const f of [0.18, 0.45]) { const a = at(2.5, f + 0.006), b = at(30, f + 0.006); Q.rivets(a[0], a[1], b[0], b[1], 0.07, { px: 1.2, depth: 0.16, dark: 0.045 }); }
    Q.fill([at(30.3, 0), at(XE + 0.2, 0), at(XE + 0.2, 1), at(30.3, 1)], F.gloss(SC.tipColor));             // raked tip in the accent colour
    if (top) {
      const a = at(3.2, 0.2), b = at(3.2, 0.58), c = at(6.6, 0.58), d = at(6.6, 0.2);     // walkway
      Q.stroke((g) => { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); }, 0.05, F.matte('#2a2c2e'));
      Q.stroke((g) => { g.moveTo(a[0], a[1]); g.lineTo(d[0], d[1]); }, 0.05, F.matte('#2a2c2e'));
      for (const x of [5.0, 14.5, 21.0, 26.0]) { const p = at(x, 0.36); Q.decal(p[0], p[1], (g) => { g.strokeStyle = '#7d8388'; g.lineWidth = 0.015; g.beginPath(); g.arc(0, 0, 0.09, 0, Math.PI * 2); g.stroke(); }); }   // fuel caps
    } else {
      for (let i = 0; i < 16; i++) { const x = 4 + i * 1.6, a = at(x, 0.62); Q.streak(a[0], a[1], a[0], a[1] + 1.6, 0.06, { alpha: 0.05 }); }
      for (const x of [14, 18, 22, 26]) { const p = at(x, 0.4); Q.panel(p[0] - 0.3, p[1] - 0.22, p[0] + 0.3, p[1] + 0.22, { r: 0.05 }); }
    }
    Q.noise({ alpha: 0.045, scale: 2.5, stretch: [1, 2.5], rough: 0.04 });
  }
  {
    const Q = B.pen(cSt); Q.fill('all', grey);
    const sa = (x, f) => { const p = stab.at(x, f); return [p[0], p[2]]; };
    Q.fill([sa(1.5, 0), sa(10.6, 0), sa(10.6, 0.02), sa(1.5, 0.02)], metal);
    Q.line([sa(2.75, 1), sa(2.75, 0.69), sa(10.3, 0.69), sa(10.3, 1)], gap);
    for (const f of [0.25, 0.48]) Q.line([sa(1.5, f), sa(10.4, f)], line);
    for (const x of [4.0, 5.6, 7.2, 8.8]) Q.line([sa(x, 0.08), sa(x, 0.68)], line);
    Q.noise({ alpha: 0.045, scale: 2.5, stretch: [1, 2], rough: 0.04 });
  }
  for (const key of ['L', 'R']) {
    const Q = B.pen(cFin[key]); Q.fill('all', F.gloss(SC.tail));
    const fa = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    const c = fa(8.2, 0.42);
    if (SC.style === 'cheat') {           // white stylised falcon over a charcoal root band
      Q.fill([fa(1.9, 0), fa(3.6, 0), fa(3.6, 1.02), fa(1.9, 1.02)], F.gloss('#2a2e33'));
      Q.decal(c[0], c[1], (g) => drawFalcon(g, 3.4, '#ffffff', key === 'R'));
    } else if (SC.style === 'sweep') {    // gold sun with long rays rising out of the navy
      Q.decal(c[0] + 0.3, c[1] + 0.2, (g) => drawSun(g, 2.6, SC.accent, SC.tail));
    } else {                              // house: blue band along the root, big '777'
      Q.fill([fa(1.9, 0), fa(4.4, 0), fa(4.4, 1.02), fa(1.9, 1.02)], F.gloss(SC.accent));
      Q.text('777', c[0] + 0.6, c[1] + 0.5, 2.6, { color: SC.accent, font: K.FONT.round, weight: 700 });
    }
    Q.fill([fa(2.6, 0), fa(14.0, 0), fa(14.0, 0.015), fa(2.6, 0.015)], metal);
    Q.line([fa(3.05, 1), fa(3.05, 0.7), fa(13.75, 0.69), fa(13.75, 1)], gap);
    Q.line([fa(7.42, 0.7), fa(7.42, 1)], gap);
    Q.line([fa(3.05, 0.89), fa(7.4, 0.89)], gap);
    for (const y of [5.5, 9.5, 11.6]) Q.line([fa(y, 0.7), fa(y, 1)], line);
    for (const f of [0.25, 0.47]) Q.line([fa(3.0, f), fa(13.8, f)], line);
    Q.noise({ alpha: 0.03, scale: 3 });
  }
}
function seg2(Q, at, x0, x1, f, op) { const pts = []; for (let x = x0; x < x1; x += 1.2) pts.push(at(x, f)); pts.push(at(x1, f)); Q.line(pts, op); }

/** Gold sun disc with long swept rays (Aurelis). Canvas units = metres, centred on the origin. */
function drawSun(g, r, col, bg) {
  g.fillStyle = col;
  for (let i = 0; i < 9; i++) { const a = -Math.PI * 0.95 + i * Math.PI * 0.85 / 8; g.beginPath(); g.moveTo(Math.cos(a - 0.05) * r * 0.62, Math.sin(a - 0.05) * r * 0.62); g.lineTo(Math.cos(a) * r * 1.9, Math.sin(a) * r * 1.9); g.lineTo(Math.cos(a + 0.07) * r * 0.62, Math.sin(a + 0.07) * r * 0.62); g.closePath(); g.fill(); }
  g.beginPath(); g.arc(0, 0, r * 0.55, 0, Math.PI * 2); g.fill();
  g.fillStyle = bg; g.beginPath(); g.arc(0, 0, r * 0.4, 0, Math.PI * 2); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(0, 0, r * 0.3, 0, Math.PI * 2); g.fill();
}
/** Stylised falcon in a stoop: swept wings and a pointed tail (Kestria). flip mirrors it so it always flies forward. */
function drawFalcon(g, s, col, flip) {
  g.save(); if (flip) g.scale(-1, 1);
  g.fillStyle = col; g.beginPath();
  g.moveTo(-1.0 * s, -0.05 * s); g.quadraticCurveTo(-0.3 * s, -0.25 * s, 0.25 * s, -0.95 * s); g.quadraticCurveTo(0.1 * s, -0.3 * s, 0.35 * s, -0.12 * s);
  g.quadraticCurveTo(0.7 * s, -0.4 * s, 1.15 * s, -0.45 * s); g.quadraticCurveTo(0.75 * s, -0.1 * s, 0.45 * s, 0.08 * s); g.lineTo(0.9 * s, 0.42 * s);
  g.lineTo(0.3 * s, 0.18 * s); g.quadraticCurveTo(-0.3 * s, 0.25 * s, -1.0 * s, -0.05 * s); g.closePath(); g.fill();
  g.restore();
}
