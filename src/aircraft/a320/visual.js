// Airbus A320neo — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (-3.2) when parked.
//
// Reference numbers (docs/aircraft/a320.md, Airbus AC A320, photos), body axes, d = distance aft of the nose tip (z = d - 17.7):
//   length 37.57 m (nose z -17.7 … APU exhaust z 19.87), span 35.8 m over the sharklets, height 11.76 m (fin tip y 8.56).
//   Fuselage 3.95 m wide × 4.14 m high: half-width 1.975, crown y 2.03, belly y -2.11, widest at y -0.05; constant from
//   d 8 to d 28; nose tip on y -0.42; radome joint d 1.8; blunt Airbus nose, windshield bottom d 2.0 (y 0.55), top d 2.8.
//   Six flight-deck windows: two flat windshields, two sliding side windows, two aft side windows whose upper rear
//   corner is notched. Cabin windows at a 0.533 m pitch; doors 1L/R d 4.75–5.6, 2L/R d 27.85–28.65, two overwing
//   exits per side. Cockpit floor y -0.35, pilot eye y 0.85 (4.05 m above the ground).
//   Wing: root LE (fuselage side x 1.98) z -3.7, root chord 6.3; Yehudi kink at x 6.4 (unswept inboard trailing edge);
//   tip x 16.9 chord 1.25; LE sweep 26.6°; dihedral 5.5° from y -0.75 at the root LE; 2.4 m sharklets bring the span to
//   35.8 m. Slats: inboard x 2.4–5.1, outboard 6.4–16.5 (four panels painted); single-slotted Fowler flaps x 2.2–5.45,
//   6.05–14.1; ailerons 14.3–16.6; five spoilers per wing (1 inboard, 2–5 outboard).
//   Tailplane span 12.45 m, root LE z 14.2, chord 4.2 → 1.25, LE sweep 34°, dihedral 6°. Fin root LE z 10.8 (y 2.0),
//   root chord 7.0, tip chord 2.2 at y 8.56, LE sweep 40°, small dorsal fillet.
//   LEAP-1A nacelles: centre x ±5.75, y -1.5; highlight z -5.0, max Ø 2.38, fan Ø 1.98, fan cowl + reverser 3.35 m,
//   core nozzle exit z -0.45; 0.5 m ground clearance; round intake.
//   Gear (geometry.js, unchanged): nose twin r 0.38 at z -11.5 retracting forward; main twin r 0.57 at x ±3.8, z 1.14,
//   legs hinged in the wing at x ±3.65 retracting inward, wheels stowed in open wells in the belly fairing (as on the
//   real aeroplane, the outboard tyre and hub stay visible from below).
// The airline liveries are invented for this simulator: they do not reproduce any real operator's name or marks.
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['meridia', 'orvanta', 'house'];

const SCHEMES = {
  meridia: { name: 'Meridia', title: 'MERIDIA', reg: 'ZZ-MRD', body: '#f6f7f8', belly: '#cdd1d5', accent: '#a8123c', tail: '#a8123c', engine: '#f3f4f5', lipBand: '#a8123c', sharklet: '#a8123c', titleColor: '#a8123c', font: 'wide', style: 'cheat' },
  orvanta: { name: 'Orvanta', title: 'orvanta', reg: 'ZZ-ORV', body: '#f5f6f4', belly: '#0d4a57', accent: '#e8b23a', tail: '#0d4a57', engine: '#0d4a57', lipBand: '#e8b23a', sharklet: '#e8b23a', titleColor: '#0d4a57', font: 'round', style: 'sweep' },
  house: { name: 'Skyward demonstrator', title: 'SKYWARD', reg: 'ZZ-NEO', body: '#f2f3f4', belly: '#9aa2a9', accent: '#2d6fd0', tail: '#f2f3f4', engine: '#f2f3f4', lipBand: '#2d6fd0', sharklet: '#2d6fd0', titleColor: '#1c2b3d', font: 'wide', style: 'house' },
};

// ---- fuselage station table ---------------------------------------------------------------------------------------------
//  d (from the nose)   y of the top   y of the belly   half-width   y of the widest point
const NOSE = [
  [0.00, -0.42, -0.42, 0.00, -0.42], [0.10, -0.15, -0.66, 0.30, -0.42], [0.32, 0.06, -0.86, 0.55, -0.41], [0.68, 0.24, -1.05, 0.80, -0.40],
  [1.10, 0.37, -1.21, 1.01, -0.38], [1.50, 0.46, -1.34, 1.18, -0.36], [2.00, 0.60, -1.49, 1.36, -0.33], [2.45, 1.00, -1.60, 1.51, -0.30],
  [2.85, 1.33, -1.69, 1.63, -0.27], [3.40, 1.58, -1.80, 1.76, -0.22], [4.20, 1.79, -1.93, 1.87, -0.15], [5.20, 1.93, -2.03, 1.94, -0.09],
  [6.50, 2.01, -2.09, 1.97, -0.06], [8.00, 2.03, -2.11, 1.975, -0.05],
];
//  z     top     belly   half-width  widest
const TAIL = [
  [10.00, 2.03, -2.11, 1.975, -0.05], [12.30, 2.02, -1.80, 1.88, 0.05], [14.00, 1.94, -1.40, 1.66, 0.22], [15.80, 1.83, -0.85, 1.33, 0.45],
  [17.60, 1.65, -0.20, 0.92, 0.65], [19.00, 1.37, 0.27, 0.52, 0.75], [19.70, 1.10, 0.50, 0.30, 0.78], [19.87, 1.02, 0.55, 0.26, 0.78],
];

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'meridia', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const rig = K.createRig(ctx, { geometry: G, name: 'a320', glassLayer: opts.glassLayer, cockpitRadius: 1.4 });

  // ---- atlases: A = fuselage + belly + gear + flight deck, B = wings, tail, nacelles ------------------------------------------
  const A = K.createAtlas({ size: atlasSize, base: F.gloss(SC.body) });
  const cFus = A.chart('fus', { type: 'unwrap', z: [G.noseZ - 0.05, G.tailZ + 0.03], girth: 12.8, vScale: 0.78, strips: 2 });
  const cPanel = A.chart('panel', { type: 'rect', w: 2.0, h: 0.55, density: 2.2 });
  const cOver = A.chart('overhead', { type: 'rect', w: 0.7, h: 0.8, density: 1.6 });
  const cPed = A.chart('pedestal', { type: 'rect', w: 0.36, h: 0.9, density: 1.6 });
  A.pack();
  const UA = {
    body: A.swatch('body', F.gloss(SC.body)), fair: A.swatch('fair', F.gloss(SC.style === 'sweep' ? SC.belly : SC.belly)), dark: A.swatch('dark', F.darkGrey), black: A.swatch('black', F.black),
    well: A.swatch('well', { color: '#7a7f78', rough: 0.7, metal: 0 }), liner: A.swatch('liner', { color: '#9a9ea0', rough: 0.8, metal: 0 }), post: A.swatch('post', { color: '#5d6266', rough: 0.7, metal: 0 }),
    floor: A.swatch('floor', { color: '#3a3d42', rough: 0.9, metal: 0 }), shield: A.swatch('shield', { color: '#2a2d31', rough: 0.85, metal: 0 }), console: A.swatch('console', { color: '#5f666d', rough: 0.75, metal: 0 }),
    seat: A.swatch('seat', { color: '#4c5157', rough: 0.9, metal: 0 }), cushion: A.swatch('cushion', { color: '#3b4a63', rough: 1, metal: 0 }), stick: A.swatch('stick', { color: '#17181a', rough: 0.5, metal: 0 }),
    exhaust: A.swatch('exhaust', F.exhaust), steel: A.swatch('steel', F.steel), antenna: A.swatch('antenna', F.gloss('#e9eaea')), lens: A.swatch('lens', F.lens),
  };
  const B = K.createAtlas({ size: atlasSize, base: F.semigloss('#bcc1c6') });
  const cWT = B.chart('wingTop', { type: 'plan', x: [0.9, 17.0], z: [-4.3, 5.2], view: 'top', mirror: true });
  const cWB = B.chart('wingBot', { type: 'plan', x: [0.9, 17.0], z: [-4.3, 5.2], view: 'bottom', mirror: true, density: 0.72 });
  const cSh = B.chart('sharklet', { type: 'side', z: [3.5, 6.6], y: [0.45, 3.25], view: 'right' });
  const cSt = B.chart('stab', { type: 'plan', x: [0.2, 6.6], z: [14.0, 19.8], view: 'top', mirror: true, density: 0.8 });
  const cFin = { L: B.chart('finL', { type: 'side', z: [8.2, 18.9], y: [1.8, 8.7], view: 'left' }), R: B.chart('finR', { type: 'side', z: [8.2, 18.9], y: [1.8, 8.7], view: 'right' }) };
  B.pack();
  const UB = {
    grey: B.swatch('grey', F.semigloss('#bcc1c6')), engine: B.swatch('engine', F.gloss(SC.engine)), lip: B.swatch('lip', F.polished), band: B.swatch('band', F.gloss(SC.lipBand)),
    duct: B.swatch('duct', { color: '#26282b', rough: 0.55, metal: 0.3 }), acoustic: B.swatch('acoustic', { color: '#7f8386', rough: 0.6, metal: 0.55 }), core: B.swatch('core', F.titanium),
    plug: B.swatch('plug', F.heatStained), blade: B.swatch('blade', { color: '#3b3e44', rough: 0.3, metal: 0.9 }), spinner: B.swatch('spinner', { color: '#1d1f22', rough: 0.35, metal: 0.4 }),
    swirl: B.swatch('swirl', { color: '#f2f2f0', rough: 0.3, metal: 0 }), inner: B.swatch('inner', F.primer), pylon: B.swatch('pylon', F.gloss(SC.style === 'sweep' ? SC.engine : '#e9ebec')),
    tail: B.swatch('tail', F.gloss(SC.tail)), cascade: B.swatch('cascade', { color: '#3a3c3f', rough: 0.6, metal: 0.7 }), wick: B.swatch('wick', F.black), canoe: B.swatch('canoe', F.semigloss('#c3c7cb')),
    sharklet: B.swatch('sharkletEdge', F.gloss(SC.sharklet)),
  };

  // ---- fuselage ---------------------------------------------------------------------------------------------------------------
  const st = (z, top, bot, w, yc, extra) => ({ z, y: yc, w, top: Math.max(0, top - yc), bot: Math.max(0, yc - bot), ...extra });
  const FS = [
    ...NOSE.map(([d, top, bot, w, yc]) => st(G.noseZ + d, top, bot, w, yc, {})),
    ...TAIL.map(([z, top, bot, w, yc]) => st(z, top, bot, w, yc, z > 15 ? { kBot: 0.6 } : {})),
  ];
  const fseg = Math.max(32, Math.round(96 * detail / 4) * 4);
  const fus = K.loft({
    stations: FS, segments: fseg, step: 1.3 / detail, chart: cFus, capEnd: 'flat', capUV: UA.exhaust,
    cutouts: [{ name: 'ngf', z: [-13.85, -12.15], t: [0, 0.03], mirror: true }, { name: 'nga', z: [-12.1, -11.2], t: [0, 0.03], mirror: true }],
  });
  cFus.body = fus;
  const stA = new K.Mesh(), stB = new K.Mesh();
  stA.add(fus.mesh);
  stA.add(K.well(K.merge(fus.patches.ngfR, fus.patches.ngfL, fus.patches.ngaR, fus.patches.ngaL), 0.95, UA.well, [0, 1, 0]));
  // APU exhaust pipe in the tail cone
  stA.add(K.lathe([[0.13, G.tailZ - 0.25], [0.15, G.tailZ + 0.06, 1], [0.12, G.tailZ + 0.06, 1], [0.1, G.tailZ - 0.3]], { segments: 16, uv: UA.exhaust }).translate(0, 0.78, 0));
  // ring parameter on the upper half (right side) at half-width x
  const tAtX = (z, x) => { let lo = 0.25, hi = 0.5; for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (fus.at(z, m).p[0] > x) lo = m; else hi = m; } return (lo + hi) / 2; };

  // wing-to-body ("belly") fairing with the main-wheel wells cut into its flat bottom
  const fairStations = [[-6.7, 1.0, 0.25, 0.45], [-5.5, 1.8, 0.55, 0.95], [-3.9, 2.18, 0.75, 1.14], [-1.0, 2.32, 0.8, 1.21], [2.4, 2.5, 0.8, 1.22], [4.2, 2.24, 0.72, 1.14], [6.0, 1.8, 0.52, 1.0], [7.6, 1.15, 0.3, 0.62], [8.6, 0.6, 0.15, 0.3]]
    .map(r => ({ z: r[0], y: -0.95, w: r[1], top: r[2], bot: r[3], kTop: 0.66, kBot: [0.94, 0.5523] }));
  const fairOpts = { stations: fairStations, segments: Math.max(28, Math.round(44 * detail / 4) * 4), step: 0.7, uv: UA.fair };
  let fair = K.loft(fairOpts);
  const fAtX = (x) => { let lo = 0, hi = 0.25; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (fair.at(1.14, m).p[0] < x) lo = m; else hi = m; } return (lo + hi) / 2; };
  fair = K.loft({ ...fairOpts, cutouts: [{ name: 'bay', z: [0.44, 1.84], t: [fAtX(0.85), fAtX(2.38)], mirror: true }] });
  stA.add(fair.mesh).add(K.well(fair.patches.bayR, 1.2, UA.well, [0, 1, 0])).add(K.well(fair.patches.bayL, 1.2, UA.well, [0, 1, 0]));

  // ---- flight deck: six painted windows, lined inside so the pilot looks out through the gaps -------------------------------
  // windows on the right side in (z, t); the left side is the mirror (t → 1 − t)
  const zy = (z, y) => [z, fus.tAtY(z, y)];
  const WS = { IB: [-15.66, tAtX(-15.66, 0.07)], OB: zy(-15.36, 0.5), OT: zy(-14.88, 1.17), IT: [-14.98, tAtX(-14.98, 0.07)] };
  const S1 = { bf: zy(-15.25, 0.5), br: zy(-14.42, 0.53), tr: zy(-14.42, 1.21), tf: zy(-14.77, 1.18) };
  const S2 = { bf: zy(-14.32, 0.53), br: zy(-13.84, 0.56), rt: zy(-13.84, 0.98), nt: zy(-14.04, 1.2), tf: zy(-14.32, 1.22) };
  const WIN = [[WS.IB, WS.OB, WS.OT, WS.IT], [S1.bf, S1.br, S1.tr, S1.tf], [S2.bf, S2.br, S2.rt, S2.nt, S2.tf]];
  const FLOOR = -0.35, zb = -13.2;
  {
    const L = (c, uv, nu = 3, nv = 3) => stA.add(K.liner(fus, c, { uv, nu, nv, mirror: true, inset: 0.05 }));
    const lo = (z) => [z, fus.tAtY(z, FLOOR + 0.04)], hi = (z) => [z, 0.5];
    L([WS.IB, WS.OB, lo(WS.OB[0]), lo(WS.IB[0])], UA.liner, 2, 5);                     // below the windshield
    L([WS.IB, hi(WS.IB[0]), hi(WS.IT[0]), WS.IT], UA.post, 4, 1);                       // centre post
    L([hi(WS.IT[0]), WS.IT, WS.OT, hi(WS.OT[0])], UA.liner, 3, 2);                      // roof above the windshield
    L([WS.OB, S1.bf, S1.tf, WS.OT], UA.post, 1, 4);                                      // corner post
    L([WS.OT, S1.tf, hi(S1.tf[0]), hi(WS.OT[0])], UA.liner, 1, 3);
    L([lo(WS.OB[0]), lo(S1.bf[0]), S1.bf, WS.OB], UA.liner, 1, 3);
    L([lo(S1.bf[0]), lo(S1.br[0]), S1.br, S1.bf], UA.liner, 4, 3);                      // sills
    L([S1.tf, S1.tr, hi(S1.tr[0]), hi(S1.tf[0])], UA.liner, 3, 3);                      // headers
    L([S1.br, S2.bf, S2.tf, S1.tr], UA.post, 1, 4);                                      // post between the side windows
    L([lo(S1.br[0]), lo(S2.bf[0]), S2.bf, S1.br], UA.liner, 1, 3);
    L([S1.tr, S2.tf, hi(S2.tf[0]), hi(S1.tr[0])], UA.liner, 1, 3);
    L([lo(S2.bf[0]), lo(S2.br[0]), S2.br, S2.bf], UA.liner, 3, 3);
    L([S2.tf, S2.nt, hi(S2.nt[0]), hi(S2.tf[0])], UA.liner, 2, 3);
    L([S2.nt, S2.rt, hi(S2.br[0]), hi(S2.nt[0])], UA.liner, 2, 3);                     // the notched corner
    L([lo(S2.br[0]), lo(zb), hi(zb), hi(S2.br[0])], UA.liner, 3, 6);                   // aft side wall
    const fy = FLOOR;
    stA.add(K.deck(fus, WS.IB[0] - 0.02, zb, fy, { uv: UA.floor, n: 8 }));
    stA.add(K.bulkhead(fus, zb, { uv: UA.liner, facing: -1 }));                                  // flight-deck door wall
    stA.add(K.bulkhead(fus, WS.IB[0] - 0.02, { uv: UA.shield, facing: 1 }));                     // forward bulkhead
    // glareshield (FCU face painted on the panel chart), main panel with six displays, pedestal, side consoles, overhead
    { const gs = K.prism([[-15.64, 0.56], [-15.2, 0.6], [-15.17, 0.56], [-15.2, 0.47], [-15.64, 0.47]], -1.05, 1.05, UA.shield); for (let i = 0; i < gs.p.length; i += 3) gs.p[i] *= 0.62 + 0.38 * (gs.p[i + 2] + 15.64) / 0.47; stA.add(gs); }
    { const i0 = stA.vertexCount; for (const [a, b] of [[0, 0.55], [2.0, 0.55], [2.0, 0], [0, 0]]) { const uv = cPanel.uv(a, b); stA.vert(a - 1.0, -0.08 + (0.55 - b), -15.22 + (0.55 - b) * 0.1, 0, 0.18, 1, uv[0], uv[1]); } stA.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    stA.add(K.box(2.0, 0.6, 0.12, UA.shield).translate(0, 0.17, -15.34));                                         // panel body behind the displays
    { // pedestal: sloping top quad mapped to its chart + body
      stA.add(K.box(0.36, 0.42, 0.95, UA.console).translate(0, fy + 0.2, -14.75));
      const i0 = stA.vertexCount; for (const [a, b] of [[0, 0], [0.36, 0], [0.36, 0.9], [0, 0.9]]) { const uv = cPed.uv(a, b); stA.vert(a - 0.18, fy + 0.415 + (0.9 - b) * 0.12, -15.22 + b * 0.95 * 0.99, 0, 1, 0.1, uv[0], uv[1]); } stA.quad(i0, i0 + 3, i0 + 2, i0 + 1);
      for (const sx of [-1, 1]) stA.add(K.box(0.035, 0.11, 0.05, UA.stick).rotateX(-0.35).translate(sx * 0.05, fy + 0.58, -14.86));   // thrust levers
    }
    { const i0 = stA.vertexCount, y = 1.3; for (const [a, b] of [[0, 0], [0.7, 0], [0.7, 0.8], [0, 0.8]]) { const uv = cOver.uv(a, b); stA.vert(a - 0.35, y + b * 0.18, -14.95 + b, 0, -1, -0.2, uv[0], uv[1]); } stA.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    const eye = G.pilotEye;
    for (const sx of [-1, 1]) {
      const e = [sx * Math.abs(eye[0]), eye[1], eye[2]];
      stA.add(K.crewSeat({ eye: e, uv: { frame: UA.seat, cushion: UA.cushion } }));
      stA.add(K.box(0.26, 0.36, 1.05, UA.console).translate(sx * 1.0, fy + 0.18, -14.75));                            // side console
      stA.add(K.box(0.2, 0.05, 0.5, UA.shield).translate(sx * 0.98, fy + 0.385, -14.85));                              // sidestick armrest pad
      stA.add(K.stick({ base: [sx * 0.98, fy + 0.41, -14.98], height: 0.17, uv: UA.stick }));                          // sidestick
      stA.add(K.box(0.18, 0.025, 0.28, UA.shield).translate(sx * 0.42, fy + 0.04, -15.12));                            // rudder pedals
    }
  }

  // ---- wings ----------------------------------------------------------------------------------------------------------------
  const XR = 1.98, XK = 6.4, XT = 16.9;
  const zLE = (x) => -3.7 + 0.5 * (x - XR), zTE = (x) => (x < XK ? 2.6 + 0.0227 * (x - XR) : 2.7 + 0.219 * (x - XK)), wy = (x) => -0.75 + 0.096 * (x - XR);
  const wst = (x, tc, twist) => ({ x, y: wy(x), z: zLE(x), chord: zTE(x) - zLE(x), tc, twist });
  const sc = K.supercritical();
  const SPOILERS = [[2.5, 5.3], [6.15, 8.05], [8.1, 10.0], [10.05, 11.95], [12.0, 13.9]];
  const wingOf = (side) => K.wing({
    side, airfoil: sc, chordPts: Math.round(14 * Math.min(1, detail)), spanAxis: 'x', tip: 'none',
    stations: [wst(1.0, 0.15, 2.5), wst(XR, 0.145, 2.3), wst(XK, 0.12, 1.0), wst(11.6, 0.11, -0.6), wst(XT, 0.10, -2.2)],
    lines: { slat: [[1.0, 0.1], [XK, 0.12], [XT, 0.14]], spoil: [[1.0, 0.6], [XK, 0.585], [XT, 0.6]], flap: [[1.0, 0.765], [XK, 0.745], [XT, 0.76]] },
    controls: [
      { name: 'flapIn', type: 'flap', span: [2.2, 5.45], from: 'flap', nose: 1 },
      { name: 'flapOut', type: 'flap', span: [6.05, 14.1], from: 'flap', nose: 1 },
      { name: 'aileron', type: 'flap', span: [14.3, 16.6], from: 'flap', nose: 1 },
      { name: 'slatIn', type: 'flap', span: [2.4, 5.1], to: 'slat', tail: 0.4, cove: true },
      { name: 'slatOut', type: 'flap', span: [6.4, 16.5], to: 'slat', tail: 0.4, cove: true },
      ...SPOILERS.map((s, i) => ({ name: 'sp' + (i + 1), type: 'panel', surface: 'upper', span: s, from: 'spoil', to: 'flap', hinge: 'front' })),
    ],
    charts: { upper: cWT, lower: cWB }, innerUV: UB.inner, edgeUV: UB.grey,
  });
  const W = { R: wingOf(1), L: wingOf(-1) };
  stB.add(W.R.mesh).add(W.L.mesh);
  // sharklets: a tight upward curve into a tall, swept, slightly canted blade
  const tipSt = wst(XT, 0.10, -2.2);
  const shSt = [tipSt, ...K.blendedWinglet(tipSt, { height: 2.38, cant: 9, radius: 0.62, sweep: 40, tipChord: 0.34, tc: 0.08, n: 6, dihedral: 5.5, taperPow: 0.9 })];
  for (const side of [1, -1]) stB.add(K.wing({ side, airfoil: sc, chordPts: 8, spanAxis: 'u', tip: 'round', tipLength: 0.5, charts: { upper: cSh, lower: cSh }, edgeUV: UB.sharklet, stations: shSt }).mesh);
  const shTip = shSt[shSt.length - 1];
  // flap-track fairings ("canoes"): front half fixed to the wing, rear half rides on the flap
  const canoeAt = (x, len, side) => {
    const zf = W.R.at(x, 0.75, 'lower'), z0 = zf[2] - len * 0.42, y = zf[1] - 0.05;
    const s = [[0, 0.01, 0.01], [0.12, 0.11, 0.14], [0.35, 0.17, 0.27], [0.6, 0.17, 0.28], [0.85, 0.11, 0.19], [1, 0.01, 0.02]].map(r => ({ z: z0 + r[0] * len, x: side * x, y: y - r[2] * 0.5 + (r[0] > 0.6 ? (r[0] - 0.6) * 0.3 : 0), w: r[1], top: r[2] * 0.6, bot: r[2] }));
    const split = zf[2] + 0.12;
    return { front: K.loft({ stations: s, segments: 12, step: 0.3, uv: UB.canoe, zRange: [z0, split] }).mesh, rear: K.loft({ stations: s, segments: 12, step: 0.3, uv: UB.canoe, zRange: [split, z0 + len], capStart: 'flat' }).mesh };
  };

  // ---- tail -------------------------------------------------------------------------------------------------------------------
  const sy = (x) => 0.58 + x * Math.tan(6 * DEG);
  const stabOf = (side) => K.wing({
    side, airfoil: K.naca4('0011'), chordPts: Math.round(10 * Math.min(1, detail)), spanAxis: 'x', tip: 'round', tipLength: 0.5,
    stations: [{ x: 0.3, y: sy(0.3), z: 14.2, chord: 4.2, tc: 0.11 }, { x: 6.22, y: sy(6.22), z: 14.2 + 5.92 * Math.tan(34 * DEG), chord: 1.25, tc: 0.09 }],
    lines: { hinge: [[0.3, 0.7], [6.22, 0.7]] },
    controls: [{ name: 'elevator', type: 'flap', span: [1.35, 6.05], from: 'hinge', nose: 1 }],
    charts: { upper: cSt, lower: cSt }, edgeUV: UB.grey,
  });
  const stab = { R: stabOf(1), L: stabOf(-1) };
  stB.add(stab.R.mesh).add(stab.L.mesh);
  const finLE = (y) => 10.8 + Math.tan(40 * DEG) * (y - 2.0);
  const fin = K.wing({
    airfoil: K.naca4('0010'), chordPts: Math.round(12 * Math.min(1, detail)), spanAxis: 'y', tip: 'round', tipLength: 0.35,
    stations: [{ x: 0, y: 1.4, z: finLE(1.4), chord: 7.62, tc: 0.105 }, { x: 0, y: 8.5, z: finLE(8.5), chord: 2.2, tc: 0.09 }],
    lines: { hinge: [[1.4, 0.71], [8.5, 0.69]] },
    controls: [{ name: 'rudder', type: 'flap', span: [2.15, 8.35], from: 'hinge', nose: 1 }],
    charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.tail,
  });
  stB.add(fin.mesh);
  stB.add(K.wing({ airfoil: K.naca4('0008'), chordPts: 6, spanAxis: 'y', tip: 'flat', charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.tail,       // dorsal fillet
    stations: [{ x: 0, y: 1.9, z: 8.3, chord: 4.2, tc: 0.03 }, { x: 0, y: 2.85, z: finLE(2.85) - 0.12, chord: 1.6, tc: 0.07 }] }).mesh);

  // ---- engines ----------------------------------------------------------------------------------------------------------------
  const eng = [];
  const NAC = { len: 3.35, rHi: 1.0, rMax: 1.19, rThroat: 0.965, rFan: 0.985, zFan: 0.78, rExit: 0.9, sleeve: 0.5 };
  for (const [i, sx] of [[0, -1], [1, 1]]) {
    const c = [sx * 5.75, -1.5, -5.0];
    const n = K.nacelle({ centre: c, length: NAC.len, rHi: NAC.rHi, rMax: NAC.rMax, rThroat: NAC.rThroat, rFan: NAC.rFan, zFan: NAC.zFan, rExit: NAC.rExit, flat: 0, droop: 0, sleeve: NAC.sleeve,
      core: { r0: 0.66, r1: 0.43, length: 1.2 }, plug: { r: 0.25, length: 0.55 }, segments: Math.max(28, Math.round(44 * detail / 4) * 4),
      uv: UB.engine, uvLip: UB.lip, uvInner: UB.acoustic, uvSleeve: UB.engine, uvCore: UB.core, uvPlug: UB.plug, uvCascade: UB.cascade });
    stB.add(n.cowl).add(n.cascade).add(n.core).add(n.plug);
    // coloured intake band just behind the polished lip
    { const L = NAC.len, rA = (z) => NAC.rHi + (NAC.rMax - NAC.rHi) * Math.sqrt(Math.min(1, z / (L * 0.3))) + 0.004;
      stB.add(K.lathe([[rA(0.13) - 0.004, 0.13], [rA(0.14), 0.14], [rA(0.33), 0.33], [rA(0.34) - 0.004, 0.34]], { segments: 44, uv: UB.band }).translate(c[0], c[1] - 0.03 * 0, c[2])); }
    stB.add(K.fanBackdrop(NAC.rFan, 0.42, UB.duct).translate(c[0], c[1], n.fanZ));
    // pylon: deep strut over the nacelle, sloping aft fairing over the core, blended into the wing lower surface
    stB.add(K.pylon([{ y: -1.02, z0: -4.3, z1: -0.35, x: c[0], tc: 0.11 }, { y: -0.62, z0: -4.05, z1: 0.35, x: c[0], tc: 0.1 }, { y: -0.18, z0: -3.55, z1: 1.0, x: c[0], tc: 0.075 }], { uv: UB.pylon }));
    stB.add(K.plate([c[0] - sx * 0.98, c[1] + 0.55, c[2] + 0.75], [c[0] - sx * 0.98, c[1] + 0.55, c[2] + 1.6], [c[0] - sx * 1.24, c[1] + 0.7, c[2] + 1.65], [c[0] - sx * 1.21, c[1] + 0.68, c[2] + 0.95], 0.012, UB.engine));   // inboard nacelle strake
    const fanMesh = K.fan({ radius: NAC.rFan - 0.01, hub: 0.32, blades: 18, chord: 0.36, staggerRoot: 30, staggerTip: 60, sweep: 0.12, uvBlade: UB.blade, uvSpinner: UB.spinner });
    fanMesh.add(K.lathe([[0.075, -0.45], [0.11, -0.4], [0.11, -0.36], [0.075, -0.32]], { segments: 10, uv: UB.swirl }).translate(0, 0, 0));   // spinner swirl mark
    eng.push({ c, n, fanMesh });
  }

  // ---- small details ----------------------------------------------------------------------------------------------------------
  stA.add(K.bladeAntenna({ pos: [0, fus.topAt(-8.5) - 0.02, -8.5], height: 0.3, chord: 0.42, sweep: 0.2, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.topAt(4.0) - 0.02, 4.0], height: 0.3, chord: 0.42, sweep: 0.2, uv: UA.antenna }));
  stA.add(K.ellipsoid(0.45, 0.12, 1.0, { segments: 12, rings: 6, uv: UA.antenna }).translate(0, fus.topAt(-4.5) - 0.02, -4.5));      // satcom / ADS-B fairing
  stA.add(K.bladeAntenna({ pos: [0, fus.botAt(-9.6) + 0.02, -9.6], height: 0.25, chord: 0.38, sweep: 0.18, down: true, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.botAt(8.8) + 0.02, 8.8], height: 0.25, chord: 0.38, sweep: 0.18, down: true, uv: UA.antenna }));
  for (const sx of [-1, 1]) for (const [z, y] of [[-16.25, -0.15], [-16.05, -0.45], [-15.85, 0.05]]) {        // pitot / AoA probes
    const t = fus.tAtY(z, y), p = fus.at(z, sx > 0 ? t : 1 - t).p; stA.add(K.probe(p, [p[0] + sx * 0.12, p[1] - 0.01, p[2] - 0.17], 0.012, UA.steel));
  }
  { const wicks = []; for (const sx of [-1, 1]) { for (const x of [14.6, 15.6, 16.4]) { const p = W.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } for (const x of [3.6, 4.9, 5.9]) { const p = stab.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } } for (const y of [6.8, 8.0]) { const p = fin.at(y, 1, 'mid'); wicks.push(p); } stB.add(K.staticWicks(wicks, 0.2, UB.wick)); }

  lap('geometry');
  // ---- paint + materials ------------------------------------------------------------------------------------------------------
  paintFuselage(A, { SC, fus, cFus, cPanel, cOver, cPed, WIN });
  paintSurfaces(B, { SC, W: W.R, fin, stab: stab.R, cWT, cWB, cSh, cSt, cFin, SPOILERS });
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
    for (const [nm, xs] of [['In', [4.2]], ['Out', [8.3, 11.4]]]) {
      const main = C['flap' + nm], mesh = main.mesh.clone();
      for (const x of xs) { const cn = canoeAt(x, nm === 'In' ? 2.6 : 2.3 - (x - 8) * 0.07, sx); stB.add(cn.front); mesh.add(cn.rear); }
      a['flap' + nm] = hingeOn(`flap${nm}${key}`, mesh, drop(main, 0.95, -0.1), main.ref, DOWN);
    }
    a.aileron = rig.hingePart('aileron' + key, C.aileron, { key: 'wing' }).set;
    a.slatIn = hingeOn('slatIn' + key, C.slatIn.mesh, drop(C.slatIn, 0.4, 0.15), C.slatIn.ref, DOWN);
    a.slatOut = hingeOn('slatOut' + key, C.slatOut.mesh, drop(C.slatOut, 0.34, 0.12), C.slatOut.ref, DOWN);
    // spoilers: 1 (ground only), 2–4 (roll, speedbrake, ground), 5 (roll, ground); each group moves as one part
    const grp = (name, ids) => { const m = new K.Mesh(); for (const i of ids) m.add(C['sp' + i].mesh); const c0 = C['sp' + ids[0]], c1 = C['sp' + ids[ids.length - 1]]; return hingeOn(name + key, m, { a: c0.hinge.a, b: c1.hinge.b }, c0.ref, UP); };
    a.sp1 = grp('spoiler1', [1]); a.sp24 = grp('spoiler2to4', [2, 3, 4]); a.sp5 = grp('spoiler5', [5]);
    a.elev = rig.hingePart('elevator' + key, stab[key].controls.elevator, { key: 'wing' }).set;
    a.key = key; wingAnim.push(a);
  }
  const rud = rig.hingePart('rudder', fin.controls.rudder, { key: 'wing', toward: [1, 0, 0] });
  const fans = [], sleeves = [];
  eng.forEach((e, i) => {
    fans.push(rig.part('fan' + i, e.fanMesh.translate(e.c[0], e.c[1], e.n.fanZ), { key: 'wing', pivot: [e.c[0], e.c[1], e.n.fanZ] }));
    sleeves.push({ node: rig.part('reverser' + i, e.n.sleeve, { key: 'wing', pivot: e.c }), travel: e.n.sleeveTravel });
  });
  rig.addStatic(stA, 'paint'); rig.addStatic(stB, 'wing');

  // ---- landing gear -----------------------------------------------------------------------------------------------------------
  const gp = G.gear, gearUV = { strut: A.swatch('gear.strut', F.gearWhite), hub: A.swatch('gear.hub', { color: '#c9cbc8', rough: 0.4, metal: 0.3 }) };
  const doorOf = (patch, edge) => ({ mesh: K.thicken(patch, 0.025, UA.well), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  K.buildGear(rig, A, {
    name: 'nose', index: 0, contact: gp[0].pos, wheels: [-0.25, 0.25], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.22, pivot: [0, -1.05, -11.55], stroke: 0.32, staticFrac: 0.4,
    strutR: 0.075, steer: true, links: 'front', retract: { to: [0, -1.45, -13.3] }, window: [0.2, 0.88], brace: [0, -1.05, -12.45], uv: gearUV,
    doors: [
      { name: 'noseDoorFR', ...doorOf(fus.patches.ngfR, fus.edges.ngfR.tHi), open: 85, closes: true }, { name: 'noseDoorFL', ...doorOf(fus.patches.ngfL, fus.edges.ngfL.tLo), open: 85, closes: true },
      { name: 'noseDoorAR', ...doorOf(fus.patches.ngaR, fus.edges.ngaR.tHi), open: 80 }, { name: 'noseDoorAL', ...doorOf(fus.patches.ngaL, fus.edges.ngaL.tLo), open: 80 },
    ],
    lamps: [{ kind: 'taxi', pos: [0, -1.95, -11.68], size: 0.06, color: [1, 0.96, 0.9] }, { kind: 'landing', pos: [0, -1.82, -11.66], size: 0.05, color: [1, 0.97, 0.92] }],
  });
  const mains = [];
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, P = [sx * 3.5, -0.4, c[2]], to = [sx * 1.45, -1.55, c[2]];
    const sw = K.swing(P, [c[0], c[1] + gp[i].wheelRadius, c[2]], to);
    mains.push({ sw, g: K.buildGear(rig, A, {
      name: 'main' + key, index: i, contact: c, wheels: [-0.46, 0.46], wheelRadius: gp[i].wheelRadius, wheelWidth: 0.36, pivot: P, stroke: 0.4, staticFrac: 0.4,
      strutR: 0.11, links: 'rear', retract: { to }, window: [0.18, 0.92], brace: [sx * 2.45, -0.75, c[2] + 0.1], uv: gearUV, wheelSegments: 28,
      doors: [{ name: 'mainDoor' + key, onLeg: true, mesh: K.box(0.04, 1.35, 0.7, UA.fair).translate(sx * 3.86, -1.25, c[2]) }],
    }) });
  }
  // the A320 has no main-wheel doors: keep the stowed legs (and their wheels) visible in the open belly wells
  rig.onUpdate((S) => {
    if (S.sf.gear > 0.012) return;
    for (const m of mains) { m.g.leg.visible = true; m.g.leg.quaternion.setFromAxisAngle({ x: m.sw.axis[0], y: m.sw.axis[1], z: m.sw.axis[2] }, m.sw.angle * DEG); }
  });

  // ---- lamps ------------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.06, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.06, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.05 });
  for (const sx of [-1, 1]) rig.lamp('strobe', [sx * L.navRight[0], L.navRight[1] + 0.06, L.navRight[2] + 0.12], { color: [1, 1, 1], size: 0.05 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.05 });
  rig.lamp('beacon', [0, fus.topAt(-1.5) + 0.03, -1.5], { color: [1, 0.05, 0.03], size: 0.08, squash: [1, 0.6, 1] });
  rig.lamp('beacon', L.beacon, { color: [1, 0.05, 0.03], size: 0.08, squash: [1, 0.6, 1] });
  for (const sx of [-1, 1]) rig.lamp('landing', [sx * Math.abs(L.landing[0]), L.landing[1], L.landing[2]], { color: [1, 0.97, 0.9], size: 0.09, squash: [1.4, 0.8, 0.5] });
  for (const sx of [-1, 1]) { const p = fair.at(-4.6, sx > 0 ? 0.2 : 0.8).p; rig.lamp('taxi', [p[0], p[1], p[2]], { color: [1, 0.97, 0.9], size: 0.05 }); }   // runway turn-off lights

  // ---- animation --------------------------------------------------------------------------------------------------------------
  let fanAng = [0, 0];
  rig.onUpdate((S, dt) => {
    const sf = S.sf, f = sf.flaps, sl = Math.max(sf.slats, 0), gnd = S.onGround ? 1 : 0;
    for (const a of wingAnim) {
      const R = a.key === 'R', ail = R ? sf.aileronR : sf.aileronL, sp = R ? sf.spoilerR : sf.spoilerL, el = R ? sf.elevatorR : sf.elevatorL;
      a.flapIn(f * 35 * DEG); a.flapOut(f * 32 * DEG);
      a.aileron((ail * 25 - Math.min(1, f * 3) * 5) * DEG);
      a.slatIn(sl * 23 * DEG); a.slatOut(sl * 27 * DEG);
      const sb = sf.speedbrake, roll = Math.max(0, sp);
      a.sp1((gnd * sb) * 50 * DEG);
      a.sp24(Math.min(1, Math.max(roll, sb * (gnd ? 1 : 0.8))) * 50 * DEG);
      a.sp5(Math.min(1, Math.max(roll, gnd * sb)) * 50 * DEG);
      a.elev((el > 0 ? el * 30 : el * 17) * DEG);
    }
    rud.set(sf.rudder * 25 * DEG);
    for (let i = 0; i < 2; i++) {
      const e = S.eng[i] || {};
      fanAng[i] = (fanAng[i] + (e.n1 || 0) * 24 * dt) % (Math.PI * 2);
      fans[i].quaternion.set(0, 0, Math.sin(fanAng[i] / 2), Math.cos(fanAng[i] / 2));
      sleeves[i].node.position.z = sleeves[i].node.userData.restZ + (e.reverser || 0) * sleeves[i].travel;
    }
    matA.emissiveIntensity = S.night * 2.4;
  });
  for (const s of sleeves) s.node.userData.restZ = s.node.position.z;
  const visual = rig.build();
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES; visual.sharkletTip = [shTip.x, shTip.y, shTip.z];
  return visual;
}

// ---- paint: fuselage atlas ---------------------------------------------------------------------------------------------------
function paintFuselage(A, o) {
  const { SC, fus, cFus, cPanel, cOver, cPed, WIN } = o, F = K.FINISH;
  const P = A.pen(cFus), body = F.gloss(SC.body), belly = F.gloss(SC.belly), accent = F.gloss(SC.accent), tail = F.gloss(SC.tail);
  const font = SC.font === 'round' ? K.FONT.round : K.FONT.wide, Z0 = -17.75, Z1 = 19.9;
  P.fill('all', body);
  // --- livery ---
  if (SC.style === 'cheat') {            // grey belly, crimson cheat line under the windows fading out toward the nose
    P.band(Z0, Z1, -Infinity, (z) => -0.95 + Math.max(0, z - 10) * 0.12, belly, { step: 0.3, feather: 2 });
    P.band(-12.0, 19.9, (z) => 0.12 + Math.max(0, z - 10) * 0.1, (z) => 0.2 + Math.max(0, z - 10) * 0.1, accent, { step: 0.25 });
    const k = (z) => Math.pow(Math.max(0, (z + 15.4) / 3.42), 1.4);                      // taper to a point toward the nose
    P.band(-15.4, -11.98, (z) => 0.16 - 0.04 * k(z), (z) => 0.16 + 0.04 * k(z), accent, { step: 0.1 });
    P.textOn(SC.title, -6.6, 1.5, 'both', 0.62, { color: SC.titleColor, font, weight: 700, spacing: 0.1 });
  } else if (SC.style === 'sweep') {     // dark belly sweeping up the aft fuselage into the tail, with a gold pin line
    const edge = (z) => (z < 2 ? -0.75 + (z + 17.7) * 0.008 : -0.59 + Math.pow((z - 2) / 9, 2.0) * 3.1);
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.14, accent, { step: 0.25 });
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.07, body, { step: 0.25 });
    P.band(Z0, Z1, -Infinity, edge, belly, { step: 0.25 });
    P.textOn(SC.title, -7.0, 1.42, 'both', 0.85, { color: SC.titleColor, font, weight: 700 });
  } else {                               // 'house': grey belly, blue stripe pair through the windows, big titles
    P.band(Z0, Z1, -Infinity, -0.7, belly, { step: 0.5 });
    P.band(-14.2, 19.9, -0.42, -0.2, accent, { step: 0.5 });
    P.band(-14.2, 19.9, -0.12, -0.06, F.gloss(SC.titleColor), { step: 0.5 });
    P.textOn(SC.title, -6.8, 1.45, 'both', 0.55, { color: SC.titleColor, font, weight: 700, spacing: 0.12 });
    P.textOn('neo', -1.6, 1.4, 'both', 0.7, { color: SC.accent, font: K.FONT.round, weight: 700 });
  }
  P.textOn(SC.reg, 15.0, 1.35, 'both', 0.3, { color: SC.style === 'sweep' ? '#ffffff' : '#1d2126', font: K.FONT.sans, weight: 700 });
  P.textOn('A320neo', -11.0, -0.45, 'both', 0.14, { color: '#7c8288', font: K.FONT.wide, weight: 700 });
  // radome joint
  P.ring(-15.88, 0, 1, { px: 1.4, depth: 0.5, dark: 0.3 });
  P.ring(-17.15, 0, 1, { px: 1, depth: 0.3, dark: 0.1 });
  // --- flight-deck windows (painted glass with a dark surround) ---
  for (const s of [1, -1]) {
    const m = (p) => [p[0], s > 0 ? p[1] : 1 - p[1]];
    for (const w of WIN) {
      const pts = w.map(m), path = (g) => { pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      P.stroke(path, 0, { color: '#24272b', rough: 0.4, metal: 0 }, { join: 'round', px: 10 });
      P.fill(pts, F.paintedGlass);
      P.groove(path, { px: 1.2, depth: 0.5, dark: 0.2 });
    }
  }
  // centre windshield post
  P.fill([[WIN[0][0][0], WIN[0][0][1]], [WIN[0][3][0], WIN[0][3][1]], [WIN[0][3][0], 1 - WIN[0][3][1]], [WIN[0][0][0], 1 - WIN[0][0][1]]], { color: '#24272b', rough: 0.4, metal: 0 });
  // --- cabin windows, doors, hatches ---
  const zs = []; for (let z = -11.55; z < 9.7; z += 0.533) zs.push(z);
  P.windows(zs, 0.55, { w: 0.23, h: 0.33, r: 0.09, frame: SC.style === 'house' ? '#d5d9dc' : '#c4c8cb' });
  const door = { px: 1.3, depth: 0.6, dark: 0.35 };
  for (const [z0, z1] of [[-12.95, -12.1], [10.15, 10.95]]) { P.doorOn(z0, z1, -0.33, 1.52, { ...door, handle: true }); P.windows([(z0 + z1) / 2], 0.85, { w: 0.18, h: 0.22, r: 0.08, lit: 0 }); }
  for (const zc of [-2.49, -1.42]) P.doorOn(zc - 0.26, zc + 0.26, 0.02, 1.02, door);                        // overwing exits
  P.doorOn(-9.7, -7.9, -1.95, -0.62, { ...door, side: 'R' }); P.doorOn(3.9, 5.7, -1.95, -0.62, { ...door, side: 'R' }); P.doorOn(7.3, 8.1, -1.75, -0.95, { ...door, side: 'R' });   // cargo doors
  P.doorOn(-14.9, -14.25, -1.65, -1.05, { px: 1, depth: 0.4, dark: 0.15, side: 'L' });                                // avionics access
  // skin joints: circumferential every ~1.6 m, lap joints along the crown and above / below the windows
  for (let z = -15.0; z < 19.5; z += 1.6) P.ring(z, 0, 1, { px: 1, depth: 0.3, dark: 0.08 });
  for (const y of [1.55, 0.18, -0.95]) P.yLine(-14.5, 19.2, (z) => Math.min(fus.topAt(z) - 0.25, Math.max(fus.botAt(z) + 0.2, y + Math.max(0, z - 10) * 0.08)), { px: 1, depth: 0.3, dark: 0.08 });
  P.line([[-15.5, 0.5], [19.8, 0.5]], { px: 1, depth: 0.25, dark: 0.06 });
  // static ports, APU intake / exhaust, ram air, grime
  P.decalOn(-14.1, -0.25, 'both', (g) => { g.fillStyle = '#a1a6aa'; g.beginPath(); g.arc(0, 0, 0.07, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#c42a1e'; g.lineWidth = 0.012; g.strokeRect(-0.15, -0.11, 0.3, 0.22); });
  P.decalOn(17.4, 0.95, 'R', (g) => { g.fillStyle = '#3a3d40'; g.fillRect(-0.3, -0.12, 0.6, 0.24); g.strokeStyle = '#8b9095'; g.lineWidth = 0.015; g.strokeRect(-0.33, -0.15, 0.66, 0.3); });
  P.decalOn(-4.6, -1.85, 'both', (g) => { g.fillStyle = '#4a4e52'; g.beginPath(); g.ellipse(0, 0, 0.3, 0.07, 0, 0, Math.PI * 2); g.fill(); });
  const rnd = (() => { let a = 11; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  for (let i = 0; i < 34; i++) { const z = -12 + rnd() * 27, t = rnd() < 0.5 ? rnd() * 0.08 : 1 - rnd() * 0.08; P.streak(z, t, z + 0.8 + rnd() * 2.2, t, 0.004 + rnd() * 0.01, { alpha: 0.05 + rnd() * 0.09 }); }
  for (let i = 0; i < 8; i++) { const z = 16.5 + rnd() * 3; P.streak(z, 0.62 + rnd() * 0.04, z + 1.2, 0.6 + rnd() * 0.04, 0.01, { alpha: 0.08 }); }
  P.noise({ alpha: 0.03, scale: 3, stretch: [2, 1] });
  P.noise({ alpha: 0.025, scale: 9, stretch: [2, 1] });
  // --- flight-deck panels: six displays, FCU strip, ECAM control, pedestal, overhead ---
  {
    const Q = A.pen(cPanel); Q.fill('all', { color: '#59616a', rough: 0.7, metal: 0 });
    const scr = (a, b, w, h, col, fn) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#08090a', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(a + 0.012, b + 0.012, w - 0.024, h - 0.024), { color: col, rough: 0.15, metal: 0, emissive: col }); if (fn) Q.decal(a + w / 2, b + h / 2, { layers: ['color', 'emis'] }, fn); };
    const pfd = (g) => { g.fillStyle = '#2d6fbf'; g.fillRect(-0.06, -0.075, 0.12, 0.07); g.fillStyle = '#8a5a2a'; g.fillRect(-0.06, -0.005, 0.12, 0.07); g.strokeStyle = '#f2d23a'; g.lineWidth = 0.006; g.beginPath(); g.moveTo(-0.04, 0); g.lineTo(0.04, 0); g.stroke(); };
    const nd = (g) => { g.strokeStyle = '#e8e8e8'; g.lineWidth = 0.004; g.beginPath(); g.arc(0, 0.05, 0.075, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); g.strokeStyle = '#3ad16a'; g.beginPath(); g.moveTo(0, 0.05); g.lineTo(0.03, -0.04); g.lineTo(0.05, -0.07); g.stroke(); };
    const ecam = (g) => { g.strokeStyle = '#3ad16a'; g.lineWidth = 0.004; for (const x of [-0.04, 0.04]) { g.beginPath(); g.arc(x, -0.03, 0.026, Math.PI, Math.PI * 1.75); g.stroke(); } g.fillStyle = '#e8e8e8'; g.fillRect(-0.06, 0.02, 0.12, 0.004); g.fillRect(-0.06, 0.035, 0.08, 0.004); };
    for (const [x0, flip] of [[0.1, 0], [1.46, 1]]) { scr(flip ? x0 + 0.22 : x0, 0.14, 0.2, 0.2, '#0c1322', pfd); scr(flip ? x0 : x0 + 0.22, 0.14, 0.2, 0.2, '#0b1220', nd); }
    scr(0.9, 0.06, 0.2, 0.2, '#0b1120', ecam); scr(0.9, 0.29, 0.2, 0.2, '#0b1120', ecam);
    Q.fill((g) => g.rect(0.2, 0.0, 1.6, 0.06), { color: '#3a3f45', rough: 0.6, metal: 0 });                     // FCU on the glareshield face
    for (let i = 0; i < 8; i++) Q.fill((g) => g.rect(0.3 + i * 0.18, 0.015, 0.1, 0.03), { color: '#0a0a0a', rough: 0.2, metal: 0, emissive: i % 3 ? '#3a2408' : '#000000' });
    Q.fill((g) => g.rect(0.75, 0.44, 0.05, 0.1), { color: '#c8c8c4', rough: 0.4, metal: 0 });                    // gear lever
    for (let i = 0; i < 6; i++) Q.fill((g) => g.arc(0.5 + (i % 3) * 0.05, 0.42 + Math.floor(i / 3) * 0.05, 0.016, 0, Math.PI * 2), { color: '#0b0c0d', rough: 0.2, metal: 0 });
  }
  {
    const Q = A.pen(cOver); Q.fill('all', { color: '#69717a', rough: 0.7, metal: 0 });
    for (let j = 0; j < 8; j++) for (let i = 0; i < 7; i++) Q.fill((g) => g.rect(0.04 + i * 0.093, 0.04 + j * 0.093, 0.07, 0.07), { color: (i + j * 2) % 5 ? '#4a5057' : '#24272b', rough: 0.6, metal: 0, emissive: (i * 3 + j) % 7 === 0 ? '#1c1403' : undefined });
  }
  {
    const Q = A.pen(cPed); Q.fill('all', { color: '#5d646c', rough: 0.7, metal: 0 });
    for (const b of [0.32, 0.5]) { Q.fill((g) => g.rect(0.04, b, 0.13, 0.12), { color: '#0b0c0d', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(0.19, b, 0.13, 0.12), { color: '#0b0c0d', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(0.055, b + 0.015, 0.1, 0.05), { color: '#0d1a12', rough: 0.2, metal: 0, emissive: '#0d2414' }); Q.fill((g) => g.rect(0.205, b + 0.015, 0.1, 0.05), { color: '#0d1a12', rough: 0.2, metal: 0, emissive: '#0d2414' }); }
    Q.fill((g) => g.rect(0.06, 0.02, 0.24, 0.24), { color: '#2b2e32', rough: 0.6, metal: 0 });
  }
}

// ---- paint: wings, tail, nacelles ------------------------------------------------------------------------------------------------
function paintSurfaces(B, o) {
  const { SC, W, fin, stab, cWT, cWB, cSh, cSt, cFin, SPOILERS } = o, F = K.FINISH;
  const grey = F.semigloss('#bcc1c6'), dgrey = F.semigloss('#a5abb0'), metal = { color: '#c9ccce', rough: 0.26, metal: 0.9 };
  const line = { px: 1, depth: 0.35, dark: 0.13 }, gap = { px: 1.8, depth: 0.8, dark: 0.5 };
  const at = (x, f) => { const p = W.at(x, f); return [p[0], p[2]]; };
  const L = (name, x) => W.lines[name].at(W.spanToU(x));
  for (const [chart, top] of [[cWT, true], [cWB, false]]) {
    const Q = B.pen(chart); Q.fill('all', grey);
    Q.fill([at(1.9, L('slat', 1.9) + 0.04), at(16.6, L('slat', 16.6) + 0.04), at(16.6, L('spoil', 16.6) - 0.03), at(1.9, L('spoil', 1.9) - 0.03)], dgrey);
    Q.fill([at(1.9, 0), at(16.9, 0), at(16.9, L('slat', 16.9)), at(1.9, L('slat', 1.9))], metal);
    const seg = (name, xs, op) => Q.line(xs.map(x => at(x, L(name, x))), op);
    seg('slat', [2.4, 5.1], gap); seg('slat', [6.4, 16.5], gap);
    for (const x of [2.4, 5.1, 6.4, 8.9, 11.4, 13.95, 16.5]) Q.line([at(x, 0), at(x, L('slat', x))], gap);   // slat 1 | slats 2–5
    if (top) for (const [x0, x1] of SPOILERS) { Q.line([at(x0, L('spoil', x0)), at(x1, L('spoil', x1)), at(x1, L('flap', x1)), at(x0, L('flap', x0)), at(x0, L('spoil', x0))], gap); }
    seg('flap', [2.2, 5.45], gap); seg('flap', [6.05, 14.1], gap); seg('flap', [14.3, 16.6], gap);
    for (const x of [2.2, 5.45, 6.05, 14.1, 14.3, 16.6]) Q.line([at(x, L('flap', x)), at(x, 1)], gap);
    for (const f of [0.18, 0.3, 0.45]) Q.line([at(1.9, f), at(16.8, f)], line);
    for (let x = 2.6; x < 16.8; x += 1.25) Q.line([at(x, L('slat', x) + 0.01), at(x, L('spoil', x) - 0.01)], line);
    for (const f of [0.18, 0.45]) { const a = at(2, f + 0.006), b = at(16.8, f + 0.006); Q.rivets(a[0], a[1], b[0], b[1], 0.06, { px: 1.2, depth: 0.16, dark: 0.05 }); }
    if (top) {
      const a = at(2.1, 0.22), b = at(2.1, 0.57), c = at(4.4, 0.57), d = at(4.4, 0.22);     // walkway
      Q.stroke((g) => { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); }, 0.04, F.matte('#2a2c2e'));
      Q.stroke((g) => { g.moveTo(a[0], a[1]); g.lineTo(d[0], d[1]); }, 0.04, F.matte('#2a2c2e'));
      for (const x of [3.3, 9.5, 13.0]) { const p = at(x, 0.35); Q.decal(p[0], p[1], (g) => { g.fillStyle = '#3c4044'; g.beginPath(); g.arc(0, 0, 0.09, 0, Math.PI * 2); g.fill(); }); }   // fuel caps
    } else {
      for (let i = 0; i < 12; i++) { const x = 3 + i * 1.1, a = at(x, 0.62); Q.streak(a[0], a[1], a[0], a[1] + 1.2, 0.05, { alpha: 0.1 }); }
      for (const x of [7.5, 10.5, 13.5]) { const p = at(x, 0.4); Q.panel(p[0] - 0.25, p[1] - 0.2, p[0] + 0.25, p[1] + 0.2, { r: 0.05 }); }
    }
    Q.noise({ alpha: 0.045, scale: 2.5, stretch: [1, 2.5], rough: 0.04 });
  }
  { const Q = B.pen(cSh); Q.fill('all', F.gloss(SC.sharklet));
    if (SC.style === 'cheat') Q.decal(5.2, 2.3, (g) => drawStar(g, 0.36, '#ffffff'));
    if (SC.style === 'sweep') Q.fill((g) => g.rect(3.5, 0.45, 3.1, 0.55), F.gloss(SC.belly));
    if (SC.style === 'house') Q.text('neo', 5.3, 2.0, 0.28, { color: '#ffffff', font: K.FONT.round, weight: 700 });
  }
  {
    const Q = B.pen(cSt); Q.fill('all', grey);
    const sa = (x, f) => { const p = stab.at(x, f); return [p[0], p[2]]; };
    Q.fill([sa(0.9, 0), sa(6.2, 0), sa(6.2, 0.07), sa(0.9, 0.07)], metal);
    Q.line([sa(1.35, 1), sa(1.35, 0.7), sa(6.05, 0.7), sa(6.05, 1)], gap);
    for (const f of [0.25, 0.48]) Q.line([sa(0.9, f), sa(6.1, f)], line);
    for (const x of [2.3, 3.4, 4.5, 5.5]) Q.line([sa(x, 0.08), sa(x, 0.69)], line);
    Q.noise({ alpha: 0.045, scale: 2.5, stretch: [1, 2], rough: 0.04 });
  }
  for (const key of ['L', 'R']) {
    const Q = B.pen(cFin[key]); Q.fill('all', F.gloss(SC.tail));
    const fa = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    const c = fa(5.4, 0.42);
    if (SC.style === 'cheat') {           // white eight-point compass star inside a ring
      Q.decal(c[0], c[1], (g) => { g.strokeStyle = '#ffffff'; g.lineWidth = 0.14; g.beginPath(); g.arc(0, 0, 1.25, 0, Math.PI * 2); g.stroke(); drawStar(g, 1.05, '#ffffff'); });
    } else if (SC.style === 'sweep') {    // three gold wave arcs rising aft
      Q.decal(c[0] + 0.2, c[1], (g) => { g.strokeStyle = SC.accent; g.lineCap = 'round'; for (const [r, w] of [[1.7, 0.32], [1.15, 0.24], [0.65, 0.17]]) { g.lineWidth = w; g.beginPath(); g.arc(-0.4, 1.4, r, -Math.PI * 0.5, -Math.PI * 0.05); g.stroke(); } g.fillStyle = SC.accent; g.beginPath(); g.arc(-0.4, 1.4, 0.24, 0, Math.PI * 2); g.fill(); });
    } else {                              // house: blue band along the root, grey "neo" mark
      Q.fill([fa(1.9, 0), fa(3.3, 0), fa(3.3, 1), fa(1.9, 1)], F.gloss(SC.accent));
      Q.text('neo', c[0] + 0.4, c[1] + 0.6, 1.1, { color: SC.accent, font: K.FONT.round, weight: 700 });
    }
    Q.fill([fa(2.0, 0), fa(8.5, 0), fa(8.5, 0.03), fa(2.0, 0.03)], metal);
    Q.line([fa(2.15, 1), fa(2.15, 0.71), fa(8.35, 0.69), fa(8.35, 1)], gap);
    for (const y of [4.2, 6.2]) Q.line([fa(y, 0.7), fa(y, 1)], line);
    for (const f of [0.25, 0.47]) Q.line([fa(2.2, f), fa(8.4, f)], line);
    Q.noise({ alpha: 0.03, scale: 3 });
  }
}

/** Eight-point compass star centred on the origin (canvas units = metres). */
function drawStar(g, r, col) {
  g.fillStyle = col; g.beginPath();
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.24 : i % 4 ? r * 0.55 : r; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.closePath(); g.fill();
}
