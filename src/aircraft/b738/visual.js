// Boeing 737-800 — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight when parked.
// Reference dimensions: length 39.47 m, span 35.79 m over blended winglets (34.32 m wing), height 12.55 m, fuselage 3.76 m wide
// by 4.01 m high, wheelbase 15.6 m, track 5.72 m, CFM56-7B engines 4.83 m off the centreline.
// The airline liveries are invented for this simulator: they do not reproduce any real operator's name or marks.
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['aerolume', 'velora', 'house'];

const SCHEMES = {
  aerolume: { name: 'Aerolume', title: 'AEROLUME', reg: 'ZZ-ALM', body: '#f4f5f3', belly: '#14264d', accent: '#d9a230', tail: '#14264d', engine: '#14264d', winglet: '#14264d', titleColor: '#14264d', font: 'wide', style: 'sweep' },
  velora: { name: 'Velora Air', title: 'velora', reg: 'ZZ-VLR', body: '#f6f6f4', belly: '#f6f6f4', accent: '#f0654a', tail: '#0c7c84', engine: '#0c7c84', winglet: '#f0654a', titleColor: '#0c7c84', font: 'round', style: 'ribbon' },
  house: { name: 'Factory demonstrator', title: 'SKYWARD 800', reg: 'ZZ-SKY', body: '#eef0f1', belly: '#8e979f', accent: '#1d6fd1', tail: '#eef0f1', engine: '#eef0f1', winglet: '#1d6fd1', titleColor: '#1d2a3a', font: 'wide', style: 'bands' },
};

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'aerolume', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const rig = K.createRig(ctx, { geometry: G, name: 'b738', glassLayer: opts.glassLayer, cockpitRadius: 1.4 });

  // ---- atlases: A = fuselage + belly + gear + flight deck, B = wings, tail, nacelles ------------------------------------------
  const A = K.createAtlas({ size: atlasSize, base: F.gloss(SC.body) });
  const cFus = A.chart('fus', { type: 'unwrap', z: [-18.45, 19.7], girth: 12.2, vScale: 0.78, strips: 2 });
  const cPanel = A.chart('panel', { type: 'rect', w: 1.9, h: 0.55, density: 2.2 });
  const cOver = A.chart('overhead', { type: 'rect', w: 0.6, h: 0.9, density: 1.6 });
  A.pack();
  const UA = {
    body: A.swatch('body', F.gloss(SC.body)), belly: A.swatch('belly', F.gloss(SC.belly === SC.body ? '#c9ced2' : SC.belly)), fair: A.swatch('fair', F.gloss(SC.style === 'sweep' ? SC.belly : '#c3c8cc')),
    dark: A.swatch('dark', F.darkGrey), black: A.swatch('black', F.black), well: A.swatch('well', { color: '#6d7366', rough: 0.7, metal: 0 }), liner: A.swatch('liner', { color: '#8f8c86', rough: 0.8, metal: 0 }),
    post: A.swatch('post', { color: '#4b4a48', rough: 0.7, metal: 0 }), floor: A.swatch('floor', { color: '#34363a', rough: 0.9, metal: 0 }), shield: A.swatch('shield', { color: '#1b1c1e', rough: 0.85, metal: 0 }),
    seat: A.swatch('seat', { color: '#5b5e63', rough: 0.9, metal: 0 }), sheep: A.swatch('sheep', { color: '#a59f8f', rough: 1, metal: 0 }), yoke: A.swatch('yoke', { color: '#17181a', rough: 0.5, metal: 0 }),
    exhaust: A.swatch('exhaust', F.exhaust), steel: A.swatch('steel', F.steel), lens: A.swatch('lens', F.lens), antenna: A.swatch('antenna', F.gloss('#e9e9e6')),
  };
  const B = K.createAtlas({ size: atlasSize, base: F.semigloss('#b6babd') });
  const cWT = B.chart('wingTop', { type: 'plan', x: [1.6, 17.4], z: [-4.3, 6.6], view: 'top', mirror: true });
  const cWB = B.chart('wingBot', { type: 'plan', x: [1.6, 17.4], z: [-4.3, 6.6], view: 'bottom', mirror: true, density: 0.72 });
  const cWl = B.chart('winglet', { type: 'side', z: [3.9, 8.7], y: [0.4, 3.6], view: 'right' });
  const cSt = B.chart('stab', { type: 'plan', x: [0.3, 7.35], z: [15.2, 21.2], view: 'top', mirror: true, density: 0.8 });
  const cFin = { L: B.chart('finL', { type: 'side', z: [12.3, 21.15], y: [2.2, 9.75], view: 'left' }), R: B.chart('finR', { type: 'side', z: [12.3, 21.15], y: [2.2, 9.75], view: 'right' }) };
  B.pack();
  const UB = {
    grey: B.swatch('grey', F.semigloss('#b6babd')), engine: B.swatch('engine', F.gloss(SC.engine)), lip: B.swatch('lip', F.polished), duct: B.swatch('duct', { color: '#2a2c2f', rough: 0.55, metal: 0.3 }),
    acoustic: B.swatch('acoustic', { color: '#8a8d8f', rough: 0.6, metal: 0.6 }), core: B.swatch('core', F.titanium), plug: B.swatch('plug', F.heatStained), blade: B.swatch('blade', { color: '#3d4046', rough: 0.3, metal: 0.9 }),
    spinner: B.swatch('spinner', { color: '#c8cacb', rough: 0.3, metal: 0.8 }), black: B.swatch('black', F.black), inner: B.swatch('inner', F.primer), pylon: B.swatch('pylon', F.semigloss('#b6babd')),
    tail: B.swatch('tail', F.gloss(SC.tail)), cascade: B.swatch('cascade', { color: '#3a3c3f', rough: 0.6, metal: 0.7 }), wick: B.swatch('wick', F.black), canoe: B.swatch('canoe', F.semigloss('#aeb3b7')),
  };

  // ---- fuselage ---------------------------------------------------------------------------------------------------------------
  //         z       yc     w     top    bot      (yc = height of the widest point; top / bot = heights above / below it)
  const FS = [
    [-18.40, -0.30, 0.00, 0.00, 0.00], [-18.33, -0.30, 0.20, 0.20, 0.19], [-18.10, -0.29, 0.47, 0.46, 0.43], [-17.70, -0.25, 0.80, 0.75, 0.68],
    [-17.20, -0.15, 1.10, 0.95, 0.90], [-16.95, -0.08, 1.23, 1.04, 1.00], [-16.65, 0.02, 1.37, 1.34, 1.13], [-16.35, 0.12, 1.48, 1.60, 1.26], [-16.00, 0.22, 1.58, 1.73, 1.40],
    [-15.60, 0.33, 1.67, 1.79, 1.56], [-15.00, 0.47, 1.76, 1.82, 1.78], [-14.20, 0.59, 1.83, 1.81, 2.00], [-13.20, 0.67, 1.87, 1.775, 2.16], [-12.00, 0.70, 1.88, 1.755, 2.255],
    [8.20, 0.70, 1.88, 1.755, 2.255], [10.50, 0.78, 1.80, 1.67, 2.08], [12.50, 0.93, 1.62, 1.51, 1.72], [14.50, 1.12, 1.33, 1.30, 1.30], [16.50, 1.34, 0.95, 1.04, 0.90],
    [18.30, 1.54, 0.55, 0.74, 0.56], [19.30, 1.62, 0.30, 0.50, 0.36], [19.62, 1.64, 0.19, 0.36, 0.26],
  ].map(r => ({ z: r[0], y: r[1], w: r[2], top: r[3], bot: r[4] }));
  const fseg = Math.max(32, Math.round(88 * detail / 4) * 4);
  const fus = K.loft({
    stations: FS, segments: fseg, step: 1.4 / detail, chart: cFus, capEnd: 'flat', capUV: UA.exhaust,
    cutouts: [{ name: 'ngd', z: [-15.75, -13.95], t: [0, 0.026], mirror: true }],
  });
  cFus.body = fus;
  const stA = new K.Mesh(), stB = new K.Mesh();
  stA.add(fus.mesh);
  stA.add(K.well(K.merge(fus.patches.ngdR, fus.patches.ngdL), 0.75, UA.well, [0, 1, 0]));

  // wing-to-body fairing (belly) with the main-gear bays cut into its flat bottom
  const fairStations = [[-7.0, 1.0, 0.25, 0.4], [-5.8, 1.75, 0.45, 0.55], [-4.3, 2.12, 0.6, 0.6], [-1.0, 2.2, 0.64, 0.61], [2.4, 2.2, 0.64, 0.61], [4.3, 2.0, 0.55, 0.6], [5.9, 1.55, 0.4, 0.55], [7.2, 1.0, 0.25, 0.4]]
    .map(r => ({ z: r[0], y: -0.96, w: r[1], top: r[2], bot: r[3], kTop: 0.66, kBot: [0.93, 0.5523] }));
  const fairOpts = { stations: fairStations, segments: Math.max(24, Math.round(40 * detail / 4) * 4), step: 0.8, uv: UA.fair };
  let fair = K.loft(fairOpts);
  const tAtX = (x) => { let lo = 0, hi = 0.25; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (fair.at(1.2, m).p[0] < x) lo = m; else hi = m; } return (lo + hi) / 2; };
  fair = K.loft({ ...fairOpts, cutouts: [{ name: 'bay', z: [0.52, 1.88], t: [tAtX(0.86), tAtX(2.16)], mirror: true }] });
  stA.add(fair.mesh).add(K.well(fair.patches.bayR, 0.62, UA.well, [0, 1, 0])).add(K.well(fair.patches.bayL, 0.62, UA.well, [0, 1, 0]));

  // ---- flight deck (windows are painted; the lining leaves them open for the pilot's view) -----------------------------------
  // right-hand window polygons in (z, t) on the fuselage skin: windshield, sliding side window, aft side window
  const WIN = [
    [[-16.92, 0.4945], [-16.55, 0.365], [-16.2, 0.392], [-16.38, 0.4945]],
    [[-16.47, 0.355], [-15.72, 0.318], [-15.72, 0.365], [-16.12, 0.384]],
    [[-15.62, 0.316], [-15.05, 0.305], [-15.2, 0.34], [-15.62, 0.362]],
  ];
  {
    const L = (c, uv, nu = 3, nv = 3) => stA.add(K.liner(fus, c, { uv, nu, nv, mirror: true, inset: 0.05 }));
    const lo = 0.2, hi = 0.392, zb = -14.75;
    L([[-16.95, 0.5], [-16.95, 0.4945], [-16.38, 0.4945], [-16.38, 0.5]], UA.post, 1, 4);                       // centre post
    L([[-16.38, 0.5], [-16.2, 0.392], [zb, 0.392], [zb, 0.5]], UA.liner, 5, 5);                                 // roof
    L([[-16.2, 0.392], [-16.12, 0.384], [-15.72, 0.365], [-15.72, 0.392]], UA.liner);                           // above the side windows
    L([[-15.72, 0.392], [-15.72, 0.365], [-15.62, 0.362], [-15.62, 0.392]], UA.liner, 1, 2);
    L([[-15.62, 0.392], [-15.62, 0.362], [-15.2, 0.34], [-15.2, 0.392]], UA.liner);
    L([[-15.2, 0.392], [-15.2, 0.34], [-15.05, 0.305], [zb, 0.392]], UA.liner);
    L([[-16.55, 0.365], [-16.47, 0.355], [-16.12, 0.384], [-16.2, 0.392]], UA.post, 1, 4);                      // posts
    L([[-15.72, 0.318], [-15.62, 0.316], [-15.62, 0.362], [-15.72, 0.365]], UA.post, 1, 3);
    L([[-16.95, lo], [-16.55, lo], [-16.55, 0.365], [-16.92, 0.4945]], UA.liner, 3, 6);                         // sills and side walls
    L([[-16.55, lo], [-16.47, lo], [-16.47, 0.355], [-16.55, 0.365]], UA.liner, 1, 4);
    L([[-16.47, lo], [-15.72, lo], [-15.72, 0.318], [-16.47, 0.355]], UA.liner, 4, 4);
    L([[-15.72, lo], [-15.62, lo], [-15.62, 0.316], [-15.72, 0.318]], UA.liner, 1, 4);
    L([[-15.62, lo], [-15.05, lo], [-15.05, 0.305], [-15.62, 0.316]], UA.liner, 3, 4);
    L([[-15.05, lo], [zb, lo], [zb, 0.392], [-15.05, 0.305]], UA.liner, 2, 4);
    const eye = G.pilotEye, fy = 0.12;
    stA.add(K.deck(fus, -16.95, zb, fy, { uv: UA.floor, n: 8 }));                                               // floor
    stA.add(K.bulkhead(fus, zb, { uv: UA.liner, facing: -1 }));                                                 // flight-deck door wall
    stA.add(K.bulkhead(fus, -16.94, { uv: UA.shield, facing: 1 }));                                             // forward bulkhead under the windshield
    // glareshield, main panel, pedestal, overhead panel
    { const gs = K.prism([[-16.93, 0.98], [-16.4, 1.07], [-16.37, 1.045], [-16.4, 1.0], [-16.93, 0.92]], -1.15, 1.15, UA.shield); for (let i = 0; i < gs.p.length; i += 3) gs.p[i] *= 0.5 + 0.5 * (gs.p[i + 2] + 16.93) / 0.56; stA.add(gs); }
    { const z = -16.41, i0 = stA.vertexCount; for (const [a, b] of [[0, 0.55], [1.9, 0.55], [1.9, 0], [0, 0]]) { const uv = cPanel.uv(a, b); stA.vert(a - 0.95, 0.47 + (0.55 - b), z + (0.55 - b) * 0.08, 0, 0.1, 1, uv[0], uv[1]); } stA.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    stA.add(K.box(0.42, 0.42, 1.0, UA.shield).translate(0, 0.33, -15.95));
    { const i0 = stA.vertexCount, y = 1.98; for (const [a, b] of [[0, 0], [0.6, 0], [0.6, 0.9], [0, 0.9]]) { const uv = cOver.uv(a, b); stA.vert(a - 0.3, y + b * 0.22, -16.25 + b, 0, -1, -0.2, uv[0], uv[1]); } stA.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    for (const sx of [-1, 1]) {
      const e = [sx * Math.abs(eye[0]), eye[1], eye[2]];
      stA.add(K.crewSeat({ eye: e, uv: { frame: UA.seat, cushion: UA.sheep } }));
      stA.add(K.yoke({ base: [e[0], fy, e[2] - 0.5], top: [e[0], e[1] - 0.52, e[2] - 0.42], uv: UA.yoke }));
    }
  }

  // ---- wings ----------------------------------------------------------------------------------------------------------------
  const zLE = (x) => -4.6 + 0.52 * x, zTE = (x) => (x < 5.6 ? 2.7 - 0.043 * x : 2.46 + (x - 5.6) * 0.295), wy = (x) => -1.12 + 0.105 * x;
  const wst = (x, tc, twist) => ({ x, y: wy(x), z: zLE(x), chord: zTE(x) - zLE(x), tc, twist });
  const sc = K.supercritical();
  const wingOf = (side) => K.wing({
    side, airfoil: sc, chordPts: Math.round(14 * Math.min(1, detail)), spanAxis: 'x', tip: 'none',
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
      { name: 'spGround', type: 'panel', surface: 'upper', span: [2.25, 5.3], from: 'spoil', to: 'flap', hinge: 'front' },
      { name: 'spFlight', type: 'panel', surface: 'upper', span: [6.1, 12.05], from: 'spoil', to: 'flap', hinge: 'front' },
    ],
    charts: { upper: cWT, lower: cWB }, innerUV: UB.inner, edgeUV: UB.grey,
  });
  const W = { R: wingOf(1), L: wingOf(-1) };
  stB.add(W.R.mesh).add(W.L.mesh);
  const tipSt = wst(17.16, 0.10, -2);
  for (const side of [1, -1]) {
    stB.add(K.wing({ side, airfoil: sc, chordPts: 8, spanAxis: 'u', tip: 'round', tipLength: 0.6, charts: { upper: cWl, lower: cWl }, edgeUV: UB.grey,
      stations: [tipSt, ...K.blendedWinglet(tipSt, { height: 2.45, cant: 12, radius: 0.85, sweep: 58, tipChord: 0.62, tc: 0.075, n: 6, dihedral: 6 })] }).mesh);
  }
  // flap-track fairings ("canoes"): front half fixed, rear half rides on the flap
  const canoeAt = (x, len, side) => {
    const zf = W.R.at(x, 0.74, 'lower'), z0 = zf[2] - len * 0.45, y = zf[1] - 0.06;
    const st = [[0, 0.01, 0.01], [0.12, 0.1, 0.13], [0.35, 0.15, 0.24], [0.6, 0.15, 0.25], [0.85, 0.1, 0.17], [1, 0.01, 0.02]].map(r => ({ z: z0 + r[0] * len, x: side * x, y: y - r[2] * 0.5 + (r[0] > 0.6 ? (r[0] - 0.6) * 0.25 : 0), w: r[1], top: r[2] * 0.6, bot: r[2] }));
    const split = zf[2] + 0.1;
    return { front: K.loft({ stations: st, segments: 12, step: 0.3, uv: UB.canoe, zRange: [z0, split] }).mesh, rear: K.loft({ stations: st, segments: 12, step: 0.3, uv: UB.canoe, zRange: [split, z0 + len], capStart: 'flat' }).mesh };
  };

  // ---- tail -------------------------------------------------------------------------------------------------------------------
  const sy = (x) => 1.72 + (x - 0.4) * Math.tan(7 * DEG);
  const stabOf = (side) => K.wing({
    side, airfoil: K.naca4('0010'), chordPts: Math.round(10 * Math.min(1, detail)), spanAxis: 'x', tip: 'round', tipLength: 0.5,
    stations: [{ x: 0.4, y: sy(0.4), z: 15.3, chord: 4.0, tc: 0.1 }, { x: 7.17, y: sy(7.17), z: 19.75, chord: 1.3, tc: 0.09 }],
    lines: { hinge: [[0.4, 0.7], [7.17, 0.7]] },
    controls: [{ name: 'elevator', type: 'flap', span: [1.25, 7.0], from: 'hinge', nose: 1 }],
    charts: { upper: cSt, lower: cSt }, edgeUV: UB.grey,
  });
  const stab = { R: stabOf(1), L: stabOf(-1) };
  stB.add(stab.R.mesh).add(stab.L.mesh);
  const fin = K.wing({
    airfoil: K.naca4('0010'), chordPts: Math.round(12 * Math.min(1, detail)), spanAxis: 'y', tip: 'round', tipLength: 0.5,
    stations: [{ x: 0, y: 2.3, z: 12.5, chord: 6.3, tc: 0.11 }, { x: 0, y: 9.65, z: 19.0, chord: 1.9, tc: 0.09 }],
    lines: { hinge: [[2.3, 0.69], [9.65, 0.69]] },
    controls: [{ name: 'rudder', type: 'flap', span: [2.75, 9.45], from: 'hinge', nose: 1 }],
    charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.tail,
  });
  stB.add(fin.mesh);
  stB.add(K.wing({ airfoil: K.naca4('0008'), chordPts: 6, spanAxis: 'y', tip: 'flat', uv: UB.tail, edgeUV: UB.tail,       // dorsal fin
    stations: [{ x: 0, y: 2.3, z: 8.7, chord: 6.0, tc: 0.02 }, { x: 0, y: 3.35, z: 13.35, chord: 1.4, tc: 0.09 }] }).mesh);

  // ---- engines ----------------------------------------------------------------------------------------------------------------
  const eng = [];
  for (const [i, sx] of [[0, -1], [1, 1]]) {
    const c = [sx * 4.83, -1.6, -5.45];
    const n = K.nacelle({ centre: c, length: 2.62, rHi: 0.83, rMax: 1.04, rThroat: 0.755, rFan: 0.775, zFan: 0.62, rExit: 0.89, flat: 0.2, droop: 0.04, sleeve: 0.52,
      core: { r0: 0.52, r1: 0.33, length: 1.12 }, segments: Math.max(24, Math.round(40 * detail / 4) * 4),
      uv: UB.engine, uvLip: UB.lip, uvInner: UB.acoustic, uvSleeve: UB.engine, uvCore: UB.core, uvPlug: UB.plug, uvCascade: UB.cascade });
    stB.add(n.cowl).add(n.cascade).add(n.core).add(n.plug);
    stB.add(K.fanBackdrop(0.775, 0.35, UB.duct).translate(c[0], c[1], n.fanZ));
    stB.add(K.pylon([{ y: -1.3, z0: -4.75, z1: -0.75, x: c[0], tc: 0.1 }, { y: -0.6, z0: -5.05, z1: -0.5, x: c[0], tc: 0.075 }], { uv: UB.pylon }));
    for (const s2 of [-1, 1]) stB.add(K.plate([c[0] + s2 * 0.95, c[1] + 0.52, c[2] + 0.75], [c[0] + s2 * 0.95, c[1] + 0.52, c[2] + 1.55], [c[0] + s2 * 1.2, c[1] + 0.68, c[2] + 1.6], [c[0] + s2 * 1.17, c[1] + 0.66, c[2] + 0.95], 0.012, UB.engine));   // nacelle chines
    eng.push({ c, n, fanMesh: K.fan({ radius: 0.77, hub: 0.25, blades: 24, uvBlade: UB.blade, uvSpinner: UB.spinner }) });
  }

  // ---- small details ----------------------------------------------------------------------------------------------------------
  stA.add(K.bladeAntenna({ pos: [0, fus.topAt(-9.5) - 0.02, -9.5], height: 0.3, chord: 0.42, sweep: 0.2, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.topAt(2.5) - 0.02, 2.5], height: 0.3, chord: 0.42, sweep: 0.2, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.botAt(-10.5) + 0.02, -10.5], height: 0.28, chord: 0.4, sweep: 0.18, down: true, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.botAt(9.5) + 0.02, 9.5], height: 0.28, chord: 0.4, sweep: 0.18, down: true, uv: UA.antenna }));
  for (const sx of [-1, 1]) for (const yy of [0.25, 0.5]) { const p = fus.at(-17.25, 0.25 + (sx > 0 ? 0 : 0.5) + (sx > 0 ? 1 : -1) * yy * 0.06).p; stA.add(K.probe(p, [p[0] + sx * 0.12, p[1], p[2] - 0.2], 0.012, UA.steel)); }   // pitot probes
  { const wicks = []; for (const sx of [-1, 1]) { for (const x of [13, 14.2, 15.4, 16.5]) { const p = W.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } for (const x of [4.5, 5.8, 6.9]) { const p = stab.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } } stB.add(K.staticWicks(wicks, 0.2, UB.wick)); }

  lap('geometry');
  // ---- paint + materials ------------------------------------------------------------------------------------------------------
  paintFuselage(A, { SC, fus, cFus, cPanel, cOver, WIN });
  paintSurfaces(B, { SC, W: W.R, fin, stab: stab.R, cWT, cWB, cWl, cSt, cFin });
  lap('paint');
  const matA = A.material(ctx, { envMapIntensity: 1, emissiveIntensity: 0 }), matB = B.material(ctx, { envMapIntensity: 1 });
  lap('textures');
  rig.material('paint', matA, { shared: true }); rig.material('wing', matB, { shared: true });
  rig.disposables.push(A, B);
  rig.addStatic(stA, 'paint'); rig.addStatic(stB, 'wing');

  // ---- moving surfaces --------------------------------------------------------------------------------------------------------
  const drop = (ctrl, d, aft = 0) => { const u = ctrl.up, h = ctrl.hinge, o = [-u[0] * d, -u[1] * d, -u[2] * d + aft]; return { a: [h.a[0] + o[0], h.a[1] + o[1], h.a[2] + o[2]], b: [h.b[0] + o[0], h.b[1] + o[1], h.b[2] + o[2]] }; };
  const hingeOn = (name, mesh, line, ref, toward, parent) => { const node = rig.part(name, mesh, { key: 'wing', pivot: line.a, parent }); return rig.hinge(node, line.a, line.b, { ref, toward }); };
  const DOWN = [0, -1, 0], UP = [0, 1, 0];
  const wingAnim = [];
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const C = W[key].controls, a = {};
    for (const [nm, xs] of [['In', [3.9]], ['Out', [7.4, 10.9]]]) {
      const main = C['flap' + nm], aft = C['aft' + nm], mesh = main.mesh.clone();
      for (const x of xs) { const cn = canoeAt(x, nm === 'In' ? 2.3 : 2.0 - (x - 7) * 0.08, sx); rig.addStatic(cn.front, 'wing'); mesh.add(cn.rear); }
      const line = drop(main, 0.5, 0.05), node = rig.part(`flap${nm}${key}`, mesh, { key: 'wing', pivot: line.a });
      a['flap' + nm] = rig.hinge(node, line.a, line.b, { ref: main.ref, toward: DOWN });
      const l2 = drop(aft, 0.16); a['aft' + nm] = hingeOn(`aftFlap${nm}${key}`, aft.mesh, l2, aft.ref, DOWN, node);
    }
    a.aileron = rig.hingePart('aileron' + key, C.aileron, { key: 'wing' }).set;
    a.slat = hingeOn('slat' + key, C.slat.mesh, drop(C.slat, 0.34, 0.1), C.slat.ref, DOWN);
    a.krueger = hingeOn('krueger' + key, C.krueger.mesh, C.krueger.hinge, C.krueger.ref, DOWN);
    a.spG = hingeOn('spoilerGround' + key, C.spGround.mesh, C.spGround.hinge, C.spGround.ref, UP);
    a.spF = hingeOn('spoilerFlight' + key, C.spFlight.mesh, C.spFlight.hinge, C.spFlight.ref, UP);
    a.elev = rig.hingePart('elevator' + key, stab[key].controls.elevator, { key: 'wing' }).set;
    a.key = key; wingAnim.push(a);
  }
  const rud = rig.hingePart('rudder', fin.controls.rudder, { key: 'wing', toward: [1, 0, 0] });
  const fans = [], sleeves = [];
  eng.forEach((e, i) => {
    fans.push(rig.part('fan' + i, e.fanMesh.translate(e.c[0], e.c[1], e.n.fanZ), { key: 'wing', pivot: [e.c[0], e.c[1], e.n.fanZ] }));
    sleeves.push({ node: rig.part('reverser' + i, e.n.sleeve, { key: 'wing', pivot: e.c }), travel: e.n.sleeveTravel });
  });

  // ---- landing gear -----------------------------------------------------------------------------------------------------------
  const gp = G.gear, gearUV = { strut: A.swatch('gear.strut', F.gearWhite), hub: A.swatch('gear.hub', F.gearWhite) };
  const doorOf = (patch, edge) => ({ mesh: K.thicken(patch, 0.025, UA.well), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  K.buildGear(rig, A, {
    name: 'nose', index: 0, contact: gp[0].pos, wheels: [-0.2, 0.2], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.2, pivot: [0, -1.22, -14.25], stroke: 0.3, staticFrac: 0.4,
    strutR: 0.065, steer: true, links: 'front', retract: { to: [0, -1.12, -15.75] }, window: [0.2, 0.9], brace: [0, -1.25, -13.75], uv: gearUV,
    doors: [{ name: 'noseDoorR', ...doorOf(fus.patches.ngdR, fus.edges.ngdR.tHi), open: 88 }, { name: 'noseDoorL', ...doorOf(fus.patches.ngdL, fus.edges.ngdL.tLo), open: 88 }],
    lamps: [{ kind: 'taxi', pos: [0, -1.7, -14.42], size: 0.07, color: [1, 0.96, 0.9] }],
  });
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, P = [c[0], -1.0, c[2]];
    K.buildGear(rig, A, {
      name: 'main' + key, index: i, contact: c, wheels: [-0.43, 0.43], wheelRadius: gp[i].wheelRadius, wheelWidth: 0.33, pivot: P, stroke: 0.36, staticFrac: 0.4,
      strutR: 0.095, links: 'rear', retract: { axis: [0, 0, sx], angle: 90 }, window: [0.2, 0.92], brace: [c[0] - sx * 0.9, -1.0, c[2] - 0.15], uv: gearUV, wheelSegments: 28,
      doors: [{ name: 'mainDoor' + key, onLeg: true, mesh: K.box(0.04, 0.95, 0.55, UA.body).translate(c[0] + sx * 0.14, -1.5, c[2]) }],
    });
  }

  // ---- lamps ------------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.06, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.06, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.05 });
  for (const sx of [-1, 1]) rig.lamp('strobe', [sx * 17.28, 0.72, 5.6], { color: [1, 1, 1], size: 0.05 });
  rig.lamp('strobe', [0, 1.66, 19.66], { color: [1, 1, 1], size: 0.05 });
  rig.lamp('beacon', [0, fus.topAt(-2) + 0.03, -2], { color: [1, 0.05, 0.03], size: 0.08, squash: [1, 0.6, 1] });
  rig.lamp('beacon', [0, -1.6, -2.5], { color: [1, 0.05, 0.03], size: 0.08, squash: [1, 0.6, 1] });
  for (const sx of [-1, 1]) { const p = W.R.at(2.5, 0.01, 'mid'); rig.lamp('landing', [sx * p[0], p[1], p[2] - 0.03], { color: [1, 0.97, 0.9], size: 0.09, squash: [1.6, 0.8, 0.5] }); }

  // ---- animation --------------------------------------------------------------------------------------------------------------
  let fanAng = [0, 0];
  rig.onUpdate((S, dt) => {
    const sf = S.sf, f = sf.flaps, sl = Math.max(sf.slats, 0);
    for (const a of wingAnim) {
      const R = a.key === 'R', ail = R ? sf.aileronR : sf.aileronL, sp = R ? sf.spoilerR : sf.spoilerL, el = R ? sf.elevatorR : sf.elevatorL;
      a.flapIn(f * 36 * DEG); a.flapOut(f * 36 * DEG); a.aftIn(f * 24 * DEG); a.aftOut(f * 24 * DEG);
      a.aileron(ail * 20 * DEG); a.slat(sl * 24 * DEG); a.krueger(sl * 128 * DEG);
      a.spF(Math.max(sp, sf.speedbrake * (S.onGround ? 1 : 0.55)) * 40 * DEG);
      a.spG((S.onGround ? Math.max(sf.speedbrake, sp > 0.9 ? sp : 0) : 0) * 52 * DEG);
      a.elev(el * 21 * DEG);
    }
    rud.set(sf.rudder * 26 * DEG);
    for (let i = 0; i < 2; i++) {
      const e = S.eng[i] || {};
      fanAng[i] = (fanAng[i] + (e.n1 || 0) * 26 * dt) % (Math.PI * 2);
      fans[i].quaternion.set(0, 0, Math.sin(fanAng[i] / 2), Math.cos(fanAng[i] / 2));
      sleeves[i].node.position.z = sleeves[i].node.userData.restZ + (e.reverser || 0) * sleeves[i].travel;
    }
    matA.emissiveIntensity = S.night * 2.4;
  });
  for (const s of sleeves) s.node.userData.restZ = s.node.position.z;
  const visual = rig.build();
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- paint: fuselage atlas ---------------------------------------------------------------------------------------------------
function paintFuselage(A, o) {
  const { SC, fus, cFus, cPanel, cOver, WIN } = o, F = K.FINISH;
  const P = A.pen(cFus), body = F.gloss(SC.body), belly = F.gloss(SC.belly), accent = F.gloss(SC.accent), tail = F.gloss(SC.tail);
  const font = SC.font === 'round' ? K.FONT.round : K.FONT.wide;
  P.fill('all', body);
  // --- livery ---
  if (SC.style === 'sweep') {            // dark belly sweeping up over the whole tail, with a thin accent line
    const edge = (z) => (z < 4 ? -0.62 + (z + 18.4) * 0.012 : -0.35 + Math.pow((z - 4) / 9.5, 2.2) * 3.4);
    P.band(-18.45, 19.7, -Infinity, (z) => edge(z) + 0.2, accent, { step: 0.25 });
    P.band(-18.45, 19.7, -Infinity, edge, belly, { step: 0.25 });
    P.textOn(SC.title, -9.2, 1.62, 'both', 0.62, { color: SC.titleColor, font, weight: 700, spacing: 0.06 });
  } else if (SC.style === 'ribbon') {    // tail colour wrapping the aft fuselage behind a pair of slanted ribbons
    const cut = (z0) => (z) => (z < z0 ? -Infinity : z > z0 + 3.2 ? Infinity : -1.6 + (z - z0) / 3.2 * 4.2);
    P.band(8.2, 19.7, -Infinity, cut(8.2), accent, { step: 0.2 });
    P.band(8.9, 19.7, -Infinity, cut(8.9), body, { step: 0.2 });
    P.band(9.5, 19.7, -Infinity, cut(9.5), tail, { step: 0.2 });
    P.textOn(SC.title, -10.2, 1.5, 'both', 0.78, { color: SC.titleColor, font, weight: 700 });
    P.band(-18.45, 19.7, -Infinity, -1.05, F.gloss('#c9ced2'), { step: 0.5 });
  } else {                               // 'bands': grey belly, a broad accent stripe through the window line
    P.band(-18.45, 19.7, -Infinity, -0.55, belly, { step: 0.5 });
    P.band(-15.2, 19.7, 0.58, 1.3, accent, { step: 0.5 });
    P.band(-15.2, 19.7, 0.42, 0.5, F.gloss(SC.titleColor), { step: 0.5 });
    P.textOn(SC.title, -8.2, 1.78, 'both', 0.5, { color: SC.titleColor, font, weight: 700, spacing: 0.08 });
  }
  P.textOn(SC.reg, 15.2, 1.45, 'both', 0.3, { color: SC.style === 'bands' ? SC.titleColor : SC.style === 'ribbon' ? '#ffffff' : '#ffffff', font: K.FONT.sans, weight: 700 });
  // radome joint, nose
  P.ring(-17.75, 0, 1, { px: 1.4, depth: 0.5, dark: 0.3 });
  // --- flight-deck windows (painted glass with dark surround) ---
  for (const s of [1, -1]) {
    const m = (p) => [p[0], s > 0 ? p[1] : 1 - p[1]];
    for (const w of WIN) {
      const pts = w.map(m), path = (g) => { pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      P.stroke(path, 0, { color: '#2a2c30', rough: 0.45, metal: 0 }, { join: 'round', px: 9 });
      P.fill(pts, F.paintedGlass);
      P.groove(path, { px: 1.2, depth: 0.5, dark: 0.2 });
    }
  }
  // --- cabin windows, doors, hatches ---
  const zs = []; for (let z = -13.1; z < 12.7; z += 0.508) if (Math.abs(z + 5.7) > 0.3 && Math.abs(z - 4.9) > 0.3) zs.push(z);
  P.windows(zs, 0.98, { w: 0.25, h: 0.35, r: 0.1, frame: SC.style === 'bands' ? '#d9dde0' : '#c2c6c9' });
  const door = { px: 1.3, depth: 0.6, dark: 0.35 };
  for (const [z0, z1] of [[-14.25, -13.4], [13.05, 13.85]]) { P.doorOn(z0, z1, -0.28, 1.62, { ...door, handle: true }); P.windows([(z0 + z1) / 2], 1.02, { w: 0.2, h: 0.24, r: 0.08, lit: 0 }); }
  for (const z0 of [-1.42, -0.4]) P.doorOn(z0, z0 + 0.52, 0.42, 1.38, door);                              // overwing exits
  P.doorOn(-10.6, -9.35, -1.12, -0.18, { ...door, side: 'R' }); P.doorOn(9.3, 10.5, -0.95, -0.1, { ...door, side: 'R' });   // cargo doors
  // skin joints: circumferential every ~1.5 m, lap joints along the crown and above / below the windows
  for (let z = -16.2; z < 19; z += 1.52) P.ring(z, 0, 1, { px: 1, depth: 0.3, dark: 0.08 });
  for (const y of [1.62, 0.3, -0.75]) P.yLine(-15.5, 18.5, (z) => Math.min(fus.topAt(z) - 0.25, Math.max(fus.botAt(z) + 0.2, y + Math.max(0, z - 9) * 0.07)), { px: 1, depth: 0.3, dark: 0.08 });
  P.line([[-16.3, 0.5], [19.6, 0.5]], { px: 1, depth: 0.25, dark: 0.06 });
  // static ports / outflow / APU details, grime
  P.decalOn(-15.1, -0.2, 'both', (g) => { g.fillStyle = '#9aa0a5'; g.beginPath(); g.ellipse(0, 0, 0.11, 0.07, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#c42a1e'; g.lineWidth = 0.012; g.strokeRect(-0.17, -0.12, 0.34, 0.24); });
  P.decalOn(18.6, 1.75, 'R', (g) => { g.fillStyle = '#2b2d30'; g.beginPath(); g.ellipse(0, 0, 0.22, 0.12, 0, 0, Math.PI * 2); g.fill(); });
  const rnd = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  for (let i = 0; i < 30; i++) { const z = -12 + rnd() * 26, t = rnd() < 0.5 ? rnd() * 0.07 : 1 - rnd() * 0.07; P.streak(z, t, z + 0.8 + rnd() * 2, t, 0.004 + rnd() * 0.01, { alpha: 0.06 + rnd() * 0.1 }); }
  P.noise({ alpha: 0.035, scale: 3, stretch: [2, 1] });
  // --- flight-deck panels ---
  {
    const Q = A.pen(cPanel); Q.fill('all', { color: '#6d6a63', rough: 0.7, metal: 0 });
    const scr = (a, b, w, h, col) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#08090a', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(a + 0.012, b + 0.012, w - 0.024, h - 0.024), { color: col, rough: 0.15, metal: 0, emissive: col }); };
    for (const x0 of [0.12, 1.34]) { scr(x0, 0.12, 0.2, 0.2, '#0d2238'); scr(x0 + 0.22, 0.12, 0.2, 0.2, '#101a14'); }
    scr(0.74, 0.1, 0.2, 0.2, '#0f1a12'); scr(0.96, 0.1, 0.2, 0.2, '#0f1a12');
    Q.fill((g) => g.rect(0.3, 0.005, 1.3, 0.075), { color: '#3a3b3d', rough: 0.6, metal: 0 });                    // mode control panel under the glareshield
    for (let i = 0; i < 9; i++) Q.fill((g) => g.rect(0.36 + i * 0.135, 0.022, 0.08, 0.035), { color: '#0a0a0a', rough: 0.2, metal: 0, emissive: i % 2 ? '#3a2a08' : '#000000' });
    for (let i = 0; i < 6; i++) Q.fill((g) => g.arc(0.76 + (i % 3) * 0.07, 0.38 + Math.floor(i / 3) * 0.07, 0.025, 0, Math.PI * 2), { color: '#0b0c0d', rough: 0.2, metal: 0 });
    Q.fill((g) => g.rect(0.9, 0.34, 0.06, 0.16), { color: '#c8c8c4', rough: 0.4, metal: 0 });                     // gear lever plate
  }
  {
    const Q = A.pen(cOver); Q.fill('all', { color: '#77746c', rough: 0.7, metal: 0 });
    for (let j = 0; j < 9; j++) for (let i = 0; i < 6; i++) Q.fill((g) => g.rect(0.04 + i * 0.09, 0.04 + j * 0.095, 0.07, 0.07), { color: (i + j * 2) % 5 ? '#55534e' : '#2a2a28', rough: 0.6, metal: 0, emissive: (i * 3 + j) % 7 === 0 ? '#1c1403' : undefined });
  }
}

// ---- paint: wings, tail, nacelles ------------------------------------------------------------------------------------------------
function paintSurfaces(B, o) {
  const { SC, W, fin, stab, cWT, cWB, cWl, cSt, cFin } = o, F = K.FINISH;
  const grey = F.semigloss('#b6babd'), dgrey = F.semigloss('#989da1'), metal = { color: '#c9ccce', rough: 0.28, metal: 0.9 };
  const line = { px: 1, depth: 0.35, dark: 0.14 }, gap = { px: 1.8, depth: 0.8, dark: 0.5 };
  const at = (x, f) => { const p = W.at(x, f); return [p[0], p[2]]; };
  const L = (name, x) => W.lines[name].at(W.spanToU(x));
  for (const [chart, top] of [[cWT, true], [cWB, false]]) {
    const Q = B.pen(chart); Q.fill('all', grey);
    // inspar skin panel (darker corrosion-resistant grey), polished leading edge, control gaps
    Q.fill([at(1.9, L('slat', 1.9) + 0.04), at(16.6, L('slat', 16.6) + 0.04), at(16.6, L('spoil', 16.6) - 0.03), at(1.9, L('spoil', 1.9) - 0.03)], dgrey);
    Q.fill([at(1.9, 0), at(17.16, 0), at(17.16, L('slat', 17.16)), at(1.9, L('slat', 1.9))], metal);
    const seg = (name, xs, op) => Q.line(xs.map(x => at(x, L(name, x))), op);
    seg('slat', [1.9, 5.6, 17.16], gap);
    if (top) { seg('spoil', [2.25, 5.3], gap); seg('spoil', [6.1, 12.05], gap); for (const x of [2.25, 3.8, 5.3, 6.1, 7.6, 9.1, 10.6, 12.05]) Q.line([at(x, L('spoil', x)), at(x, L('flap', x))], gap); }
    else for (const x of [2.1, 4.75]) Q.line([at(x, 0.01), at(x, L('slat', x))], gap);
    seg('flap', [1.98, 5.42], gap); seg('flap', [5.95, 12.2], gap); seg('flap', [12.45, 16.2], gap); seg('aft', [1.98, 5.42], gap); seg('aft', [5.95, 12.2], gap);
    for (const x of [1.98, 5.42, 5.95, 12.2]) Q.line([at(x, L('flap', x)), at(x, 1)], gap);
    for (const x of [12.45, 16.2]) Q.line([at(x, L('flap', x)), at(x, 1)], gap);
    for (const x of [6.25, 8.9, 11.5, 14.1, 16.75]) Q.line([at(x, 0), at(x, L('slat', x))], gap);
    for (const f of [0.3, 0.44]) Q.line([at(1.9, f), at(17.1, f)], line);
    for (let x = 2.6; x < 17; x += 1.3) Q.line([at(x, L('slat', x) + 0.01), at(x, L('spoil', x) - 0.01)], line);
    for (const f of [0.3, 0.44]) { const a = at(2, f + 0.006), b = at(17, f + 0.006); Q.rivets(a[0], a[1], b[0], b[1], 0.06, { px: 1.2, depth: 0.16, dark: 0.05 }); }
    if (top) { const a = at(2.1, 0.2), b = at(2.1, 0.56), c = at(4.6, 0.56); Q.stroke((g) => { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); }, 0.05, F.matte('#1e2022')); }   // walkway outline
    else for (let i = 0; i < 12; i++) { const x = 3 + i * 1.05, a = at(x, 0.62); Q.streak(a[0], a[1], a[0], a[1] + 1.2, 0.05, { alpha: 0.12 }); }
    Q.noise({ alpha: 0.05, scale: 2.5, stretch: [1, 2.5], rough: 0.04 });
  }
  { const Q = B.pen(cWl); Q.fill('all', F.gloss(SC.winglet)); if (SC.style === 'sweep') Q.fill((g) => g.rect(3.9, 0.4, 4.8, 0.75), F.gloss(SC.accent)); }
  {
    const Q = B.pen(cSt); Q.fill('all', grey);
    const sa = (x, f) => { const p = stab.at(x, f); return [p[0], p[2]]; };
    Q.fill([sa(0.9, 0), sa(7.1, 0), sa(7.1, 0.07), sa(0.9, 0.07)], metal);
    Q.line([sa(1.25, 1), sa(1.25, 0.7), sa(7.0, 0.7), sa(7.0, 1)], gap);
    for (const f of [0.25, 0.48]) Q.line([sa(0.9, f), sa(7.1, f)], line);
    for (const x of [2.2, 3.4, 4.6, 5.8]) Q.line([sa(x, 0.08), sa(x, 0.69)], line);
    Q.noise({ alpha: 0.05, scale: 2.5, stretch: [1, 2], rough: 0.04 });
  }
  for (const key of ['L', 'R']) {
    const Q = B.pen(cFin[key]); Q.fill('all', F.gloss(SC.tail));
    const fa = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    const c = fa(6.6, 0.42);
    if (SC.style === 'sweep') {          // rising-sun arc: concentric gold rings clipped by a horizon line
      Q.decal(c[0], c[1], (g) => { g.fillStyle = SC.accent; for (const [r0, r1] of [[0, 0.62], [0.82, 1.0], [1.2, 1.34], [1.54, 1.63]]) { g.beginPath(); g.arc(0, 0.55, r1, Math.PI, 0); g.arc(0, 0.55, r0, 0, Math.PI, true); g.closePath(); g.fill(); } g.fillRect(-1.75, 0.68, 3.5, 0.07); });
    } else if (SC.style === 'ribbon') {  // two flowing ribbons
      Q.decal(c[0], c[1] - 0.4, (g) => { const rib = (dy, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(-1.5, 1.6 + dy); g.bezierCurveTo(-0.6, 1.2 + dy, -0.6, -0.2 + dy, 0.4, -0.6 + dy); g.bezierCurveTo(0.9, -0.8 + dy, 1.3, -1.3 + dy, 1.5, -1.9 + dy); g.stroke(); }; rib(0, 0.42, SC.accent); rib(0.62, 0.2, '#ffffff'); });
    } else {
      Q.fill([fa(2.3, 0), fa(4.2, 0), fa(4.2, 1), fa(2.3, 1)], F.gloss(SC.accent));
      Q.text('800', c[0], c[1], 1.1, { color: SC.accent, font: K.FONT.wide, weight: 700 });
    }
    Q.fill([fa(2.4, 0), fa(9.6, 0), fa(9.6, 0.035), fa(2.4, 0.035)], metal);
    Q.line([fa(2.75, 1), fa(2.75, 0.69), fa(9.45, 0.69), fa(9.45, 1)], gap);
    for (const y of [4.4, 6.1, 7.8]) Q.line([fa(y, 0.69), fa(y, 1)], line);
    for (const f of [0.25, 0.47]) Q.line([fa(2.5, f), fa(9.5, f)], line);
    Q.noise({ alpha: 0.03, scale: 3 });
  }
}
