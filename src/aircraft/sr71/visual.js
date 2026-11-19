// Lockheed SR-71A Blackbird — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (-2.0) when parked.
//
// Reference numbers (docs/aircraft/sr71.md; z = d − 20 where d = distance aft of the nose tip):
//   length 32.74 m (pitot −20 … tail-cone tip 12.74), span 16.94 m (tips ±8.47), height 5.64 m (fin tips y ≈ 3.66)
//   fuselage: lenticular core with sharp chines from the nose tip; chine edge (half-width) 0.3 @ z −18, 0.95 @ −14, 1.2 @ −12.5,
//     1.58 @ −9, 1.7 @ −6.5 (spike tips), then the inboard wing LE flares at ~72° to meet the nacelle at x 2.95, z −2.6.
//     The chine "blade" of the fuselage loft carries the whole inboard wing to the nacelle and ends at the straight TE z 9.0.
//     Core: half-width 0.44 @ −14.6 … 0.98 @ 1.2, top 0.52 (windshield base) … 0.9 (RSO fairing) … 0.72 mid, belly −0.5;
//     chine / wing plane y −0.1 (nose tip y 0.15); tail cone to z 12.74 (drag-chute door).
//   cockpits: V windshield z −14.65 … −13.62, pilot canopy … −12.3, RSO canopy … −10.0, canopy roof y ≈ 1.03; pilot eye [0, .72, −13]
//   outer wing: root inside the nacelle (x 3.7, LE z −1.43, chord 10.43), LE sweep 59°, clipped tip x 8.47 (LE 6.5, chord 2.5),
//     straight TE z 9.0, biconvex 3.5 → 2.5 %; outboard elevon x 4.7 … 8.1 (hinge z ≈ 7.6 … 7.85); inboard elevon x 1.47 … 2.8
//   nacelles: x ±3.7, y −0.1; inlet lip z −3.5 (r 0.705), max r 0.905 @ z 4, ejector exit z 10.5 (r 0.6 closed … 0.79 open)
//     translating spikes: tip z −6.5 (forward), 10° cone, travel 0.66 m aft from Mach 1.6 to 3.2
//   fins: all-moving, on the nacelles, canted 15° inward; root LE z 2.7 chord 6.3, slant height 3.05, tip chord 1.35, LE 48°
//   gear (geometry.js): nose [0, −2, −11] r 0.3 twin wheels, retracts forward; mains [±2.5, −2, 1.2] r 0.47, three wheels
//     abreast, retract inward into the fuselage with the wheel stack on its side
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['usaf', 'nasa'];

const SCHEMES = {
  usaf: { name: 'USAF operational black', base: '#0d0f13', hi: '#1a1e26', lo: '#060709', mark: '#9c2a24', white: '#c8c8c2', serial: '17985', nasa: false },
  nasa: { name: 'NASA research (invented markings)', base: '#0e1014', hi: '#1b1f27', lo: '#07080a', mark: '#9c2a24', white: '#d9d9d2', serial: '871', nasa: true, band: '#e3b21f' },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'usaf', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const paintF = (c) => ({ color: c, rough: 0.74, metal: 0.07 });
  const seg = Math.max(48, Math.round(96 * detail / 4) * 4);

  // ---- atlas ------------------------------------------------------------------------------------------------------------
  const atlas = K.createAtlas({ size: atlasSize, base: paintF(SC.base) });
  const cFus = atlas.chart('fus', { type: 'unwrap', z: [-19.7, 12.8], girth: 13.6, vScale: 0.78, strips: 2 });
  const cNac = atlas.chart('nac', { type: 'unwrap', z: [-3.7, 9.75], girth: 5.8, vScale: 0.85 });
  const cWT = { R: atlas.chart('wingTopR', { type: 'plan', x: [3.6, 8.6], z: [-1.6, 9.1], view: 'top' }), L: atlas.chart('wingTopL', { type: 'plan', x: [-8.6, -3.6], z: [-1.6, 9.1], view: 'top' }) };
  const cWB = atlas.chart('wingBot', { type: 'plan', x: [3.6, 8.6], z: [-1.6, 9.1], view: 'bottom', mirror: true, density: 0.7 });
  const cFin = { L: atlas.chart('finL', { type: 'side', z: [2.5, 9.25], y: [0.55, 3.8], view: 'left' }), R: atlas.chart('finR', { type: 'side', z: [2.5, 9.25], y: [0.55, 3.8], view: 'right' }) };
  const cPanel = atlas.chart('panel', { type: 'rect', w: 0.8, h: 0.9, density: 2.2 });
  const cNoz = atlas.chart('nozzle', { type: 'rect', w: 5.0, h: 0.9, density: 0.7 });
  atlas.pack();
  const U = {
    body: atlas.swatch('body', paintF(SC.base)), frame: atlas.swatch('frame', paintF('#111318')), dark: atlas.swatch('dark', F.darkGrey), black: atlas.swatch('black', F.black),
    duct: atlas.swatch('duct', { color: '#1c1d20', rough: 0.55, metal: 0.6 }), spike: atlas.swatch('spike', { color: '#16181c', rough: 0.5, metal: 0.55 }),
    bleed: atlas.swatch('bleed', { color: '#0b0c0e', rough: 0.7, metal: 0.4 }), spikeTip: atlas.swatch('spikeTip', { color: '#3a3d42', rough: 0.35, metal: 0.9 }),
    exhaust: atlas.swatch('exhaust', F.exhaust), heat: atlas.swatch('heat', { color: '#3b3a3c', rough: 0.5, metal: 0.85 }), heat2: atlas.swatch('heat2', { color: '#2a2624', rough: 0.55, metal: 0.85 }),
    ti: atlas.swatch('ti', F.titanium), well: atlas.swatch('well', { color: '#5d625c', rough: 0.6, metal: 0.3 }), steel: atlas.swatch('steel', F.steel),
    interior: atlas.swatch('interior', { color: '#23272b', rough: 0.75, metal: 0 }), console: atlas.swatch('console', { color: '#16181a', rough: 0.6, metal: 0 }),
    seat: atlas.swatch('seat', { color: '#2b2d2c', rough: 0.7, metal: 0 }), cushion: atlas.swatch('cushion', { color: '#5a4e3a', rough: 0.95, metal: 0 }), accent: atlas.swatch('accent', { color: '#d6b21e', rough: 0.5, metal: 0 }),
    suit: atlas.swatch('suit', { color: '#b7964f', rough: 0.85, metal: 0 }), helmet: atlas.swatch('helmet', { color: '#e6e6e0', rough: 0.3, metal: 0 }), visor: atlas.swatch('visor', { color: '#8a6624', rough: 0.06, metal: 0.95 }),
    glove: atlas.swatch('glove', { color: '#d8d4c4', rough: 0.85, metal: 0 }), suitDark: atlas.swatch('suitDark', { color: '#4a4232', rough: 0.8, metal: 0 }),
    probe: atlas.swatch('probe', F.bareMetal), lens: atlas.swatch('lens', F.lens), chute: atlas.swatch('chute', paintF('#14161a')),
  };

  const rig = K.createRig(ctx, { geometry: G, name: 'sr71', glassLayer: opts.glassLayer, cockpitRadius: 1.0 });
  rig.material('paint', null);
  const stat = new K.Mesh();

  // ---- fuselage + chines + inboard wing (one loft) -------------------------------------------------------------------------
  //   z       top     bot     w(core) yS(chine)  chW    tu    tl    k     e     kTop  kBot
  const FW = { f: [0.14, 0.1, 0.12, 1.0], m: [0.3, 0.24, 0.2, 1.15], r: [0.34, 0.3, 0.22, 1.3] };
  const FSR = [
    [-19.65, 0.150, 0.150, 0.000, 0.150, 0.00, FW.f, 0.5, 0.5],
    [-19.25, 0.200, 0.095, 0.050, 0.140, 0.09, FW.f, 0.5, 0.5],
    [-18.50, 0.275, 0.010, 0.135, 0.115, 0.24, FW.f, 0.52, 0.5],
    [-17.50, 0.345, -0.085, 0.220, 0.085, 0.40, FW.f, 0.54, 0.5],
    [-16.50, 0.405, -0.170, 0.300, 0.055, 0.565, FW.f, 0.55, 0.52],
    [-15.50, 0.465, -0.245, 0.375, 0.025, 0.735, FW.f, 0.56, 0.53],
    [-14.60, 0.520, -0.310, 0.440, 0.000, 0.895, FW.f, 0.57, 0.54],
    [-13.60, 0.570, -0.380, 0.500, -0.030, 1.065, FW.f, 0.58, 0.55],
    [-12.50, 0.620, -0.450, 0.550, -0.050, 1.220, FW.f, 0.58, 0.56],
    [-11.50, 0.700, -0.495, 0.595, -0.070, 1.360, FW.f, 0.6, 0.57],
    [-10.50, 0.840, -0.505, 0.635, -0.080, 1.470, FW.f, 0.62, 0.58],
    [-10.00, 0.895, -0.505, 0.655, -0.090, 1.520, FW.f, 0.62, 0.58],
    [-9.00, 0.870, -0.505, 0.685, -0.100, 1.580, FW.m, 0.62, 0.6],
    [-8.00, 0.815, -0.505, 0.715, -0.100, 1.625, FW.m, 0.62, 0.6],
    [-6.50, 0.775, -0.500, 0.760, -0.100, 1.700, FW.m, 0.62, 0.6],
    [-5.50, 0.765, -0.500, 0.790, -0.100, 1.950, FW.m, 0.62, 0.6],
    [-4.50, 0.755, -0.500, 0.820, -0.100, 2.300, FW.m, 0.62, 0.6],
    [-3.50, 0.750, -0.505, 0.850, -0.100, 2.650, FW.r, 0.62, 0.6],
    [-2.60, 0.745, -0.515, 0.880, -0.100, 2.950, FW.r, 0.62, 0.6],
    [-1.80, 0.740, -0.530, 0.910, -0.100, 3.150, FW.r, 0.62, 0.6],
    [0.00, 0.730, -0.555, 0.960, -0.100, 3.200, FW.r, 0.62, 0.62],
    [1.20, 0.720, -0.565, 0.980, -0.100, 3.200, FW.r, 0.62, 0.62],
    [3.00, 0.690, -0.545, 0.920, -0.100, 3.200, FW.r, 0.62, 0.62],
    [5.00, 0.635, -0.480, 0.820, -0.100, 3.200, FW.r, 0.6, 0.6],
    [7.60, 0.555, -0.395, 0.680, -0.100, 3.200, FW.r, 0.58, 0.58, true],
    [7.62, 0.555, -0.395, 0.680, -0.100, 1.450, FW.r, 0.58, 0.58],
    [9.00, 0.500, -0.345, 0.600, -0.100, 1.450, FW.r, 0.57, 0.57, true],
    [9.02, 0.500, -0.345, 0.600, -0.100, 0.000, FW.r, 0.57, 0.57],
    [10.50, 0.400, -0.250, 0.460, -0.080, 0.000, FW.r, 0.56, 0.56],
    [11.80, 0.270, -0.110, 0.260, -0.040, 0.000, FW.r, 0.55, 0.55],
    [12.74, 0.160, -0.020, 0.090, 0.050, 0.000, FW.r, 0.55, 0.55],
  ];
  const FS = FSR.map((r) => {
    const yS = r[4], st = { z: r[0], y: yS, w: r[3], top: Math.max(0, r[1] - yS), bot: Math.max(0, yS - r[2]), kTop: r[7], kBot: r[8] };
    const c = r[6];
    st.chine = { w: r[5], y: 0, tu: c[0], tl: c[1], k: c[2], e: c[3] };
    if (r[9]) st.hard = true;
    return st;
  });
  const fus0 = K.loft({ stations: FS, segments: seg, step: 0.5, creases: ['side'] });
  const KF = fus0.K;
  const snapT = (t) => Math.round(t * KF) / KF;
  const tAtX = (body, z, x, upper) => {     // ring parameter on the right half where the skin passes half-width x
    let lo = upper ? 0.25 : 0, hi = upper ? 0.5 : 0.25;
    for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2, px = body.at(z, m).p[0]; if (upper ? px > x : px < x) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const T_SILL = snapT(fus0.tAtY(-12.6, 0.44));
  const Z_CK = [-13.62, -10.0];
  const tW0 = snapT(tAtX(fus0, 1.2, 0.07, false)), tW1 = snapT(tAtX(fus0, 1.2, 1.3, false)), tW2 = snapT(tAtX(fus0, 1.2, 2.36, false));
  const Z_MLG = [0.68, 1.74];
  const tN = snapT(tAtX(fus0, -11.8, 0.31, false)), Z_NG = [-12.9, -10.55];
  const fus = K.loft({
    stations: FS, segments: seg, step: 0.2 / detail, chart: cFus, creases: ['side'], capEnd: 'flat', capUV: U.chute,
    cutouts: [
      { name: 'cockpit', z: Z_CK, t: [T_SILL, 1 - T_SILL] },
      { name: 'ng', z: Z_NG, t: [0, tN], mirror: true },
      { name: 'mlw', z: Z_MLG, t: [Math.max(tW0, 1 / KF), tW1], mirror: true },
      { name: 'mll', z: Z_MLG, t: [tW1, tW2], mirror: true },
    ],
  });
  cFus.body = fus;
  stat.add(fus.mesh);
  // the centreline strip between the two main wheel wells stays (keel); wells
  const P = fus.patches;
  stat.add(K.well(P.mlwR, 0.5, U.well, [0, 1, 0])).add(K.well(P.mlwL, 0.5, U.well, [0, 1, 0]));
  stat.add(K.well(P.mllR, 0.14, U.well, [0, 1, 0])).add(K.well(P.mllL, 0.14, U.well, [0, 1, 0]));
  const ngPatch = K.merge(P.ngR, P.ngL);
  stat.add(K.well(ngPatch, 0.45, U.well, [0, 1, 0]));

  // ---- pitot / sensor probe at the nose tip ----------------------------------------------------------------------------------
  stat.add(K.tube([0, 0.15, -19.62], [0, 0.15, -20.0], 0.022, 0.009, { segments: 8, uv: U.probe }));

  // ---- inboard elevons (between the fuselage and the nacelles; the chine blade ends at their hinge line) ---------------------
  const wedge = { tc: 1, camber: () => 0, thick: (x) => 0.5 * (1 - x) * Math.sqrt(Math.min(1, x / 0.07)) + 0.0006 };
  const blade = (x) => { const c = FW.r, chW = 3.2, f = Math.pow(Math.max(0, 1 - Math.pow(x / chW, c[3])), 1 / c[3]); return { up: c[0] * 0.5 * f, lo: c[1] * 0.5 * f }; };
  const mkInElevon = (side) => {
    const st = [1.47, 2.8].map((x) => { const b = blade(x); return { x, y: -0.1 + (b.up - b.lo) * 0.5, z: 7.6, chord: 1.4, tc: (b.up + b.lo) / 1.4 }; });
    return K.wing({ side, airfoil: wedge, chordPts: 5, spanAxis: 'x', tip: 'flat', root: 'flat', stations: st, uv: U.body });
  };
  const inElev = { R: mkInElevon(1), L: mkInElevon(-1) };

  // ---- nacelles (fold-over skins: duct → sharp inlet lip → cowl → ejector shroud) ----------------------------------------------
  const NX = 3.7, NY = -0.1;
  const nacSt = (sx) => [
    [-0.8, 0.6], [-3.25, 0.665, true], [-3.46, 0.69], [-3.5, 0.705], [-3.46, 0.718], [-3.3, 0.735], [-2.4, 0.79], [-1.0, 0.85],
    [1.0, 0.893], [4.0, 0.905], [6.5, 0.887], [8.5, 0.85], [9.65, 0.81],
  ].map(([z, r, hard]) => ({ z, x: sx * NX, y: NY, w: r, top: r, bot: r, hard: !!hard }));
  const nac = {};
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const l = K.loft({
      stations: nacSt(sx), segments: Math.max(32, Math.round(56 * detail / 4) * 4), step: 0.22 / detail, capStart: 'flat', capUV: U.black,
      uvFn: (x, y, z, t, ring) => (ring.run === 0 ? U.duct : cNac.uvUnwrap(z, sx > 0 ? t : 1 - t)),
    });
    nac[key] = l; stat.add(l.mesh);
  }
  cNac.body = nac.R;

  // inlet spikes (translating): sharp 10° cone, porous bleed band at the throat shoulder, closed behind the throat
  const spikeProf = [[0, -6.5], [0.025, -6.36], [0.2, -5.36], [0.4, -4.22], [0.53, -3.5], [0.565, -3.15], [0.585, -2.75], [0.59, -2.4], [0.575, -1.9], [0.5, -1.2], [0.3, -0.75], [0, -0.6]];
  const spikeUV = (k) => (k <= 1 ? U.spikeTip : k >= 5 && k <= 7 ? U.bleed : U.spike);
  const spikes = [];
  for (const sx of [1, -1]) spikes.push(K.lathe(spikeProf, { segments: Math.max(20, Math.round(32 * detail)), uv: spikeUV }).translate(sx * NX, NY, 0));
  for (const sx of [1, -1]) {   // spike support struts in the duct, centre-body cone behind
    for (let k = 0; k < 4; k++) stat.add(K.box(0.03, 0.62, 0.5, U.duct).translate(0, 0.31, 0).rotateZ(Math.PI / 4 + k * Math.PI / 2).translate(sx * NX, NY, -1.0));
  }

  // ejector nozzles: ring of free-floating trailing-edge flaps (morph: closed boat-tail → open), primary nozzle, AB liner, plume
  const nozzles = [], glows = [], plumes = [];
  for (const [i, sx] of [[0, -1], [1, 1]]) {
    const c = [sx * NX, NY, 0];
    nozzles.push(K.petalNozzle({ z0: 9.6, z1: 10.5, r0: 0.815, rClosed: 0.6, rOpen: 0.79, petals: 28, thickness: 0.02, gap: 0.06, centre: c, uvInner: U.heat2, chart: cNoz }));
    stat.add(K.lathe([[0.79, 9.66], [0.7, 9.4], [0.62, 9.1], [0.56, 8.6], [0.52, 8.25], [0.0, 8.25]], { segments: 28, uv: U.exhaust }).translate(c[0], c[1], 0));     // jet pipe + turbine face (inward)
    stat.add(K.lathe([[0.56, 9.25], [0.555, 9.95, 1], [0.5, 9.98, 1], [0.47, 9.85], [0.5, 9.3]], { segments: 28, uv: U.heat }).translate(c[0], c[1], 0));        // primary nozzle ring
    for (let k = 0; k < 10; k++) stat.add(K.box(0.03, 0.45, 0.06, U.heat2).translate(0, 0.25, 0).rotateZ(k * Math.PI / 5).translate(c[0], c[1], 8.4));        // flame holder
    glows.push(K.afterburnerGlow({ zDeep: 8.32, zExit: 9.9, rDeep: 0.5, rExit: 0.45, centre: c }));
    // exhaust plume with shock diamonds (additive, only lit in afterburner)
    const pm = new K.Mesh();
    pm.add(K.lathe([[0.44, 10.0], [0.4, 10.8], [0.33, 12.0], [0.2, 13.6], [0.0, 15.0]], { segments: 18, uv: (k) => [[0.5, 0.42, 0.3, 0.15, 0.05][k], 0.5] }));
    for (let d = 0; d < 5; d++) {
      const z0 = 10.35 + d * 0.92, r = 0.3 * (1 - d * 0.14), L = 0.62 - d * 0.04;
      pm.add(K.lathe([[0, z0], [r * 0.7, z0 + L * 0.3], [r, z0 + L * 0.5], [r * 0.6, z0 + L * 0.75], [0, z0 + L]], { segments: 14, uv: (k) => [[0.4, 0.8, 1, 0.8, 0.4][k] * (1 - d * 0.12), 0.5] }));
    }
    plumes.push(pm.translate(c[0], c[1], 0));
  }

  // ---- outboard wings -------------------------------------------------------------------------------------------------------
  const zLE = (x) => 6.5 - (8.47 - x) * Math.tan(59 * DEG), WY = -0.1, ZTE = 9.0;
  const hingeZ = (x) => 7.55 + (x - 4.7) / 3.4 * 0.3;
  const hf = (x) => (hingeZ(x) - zLE(x)) / (ZTE - zLE(x));
  const mkWing = (side) => K.wing({
    side, airfoil: K.biconvex(0.03), chordPts: Math.round(14 * detail), spanAxis: 'x', tip: 'flat',
    stations: [
      { x: 3.7, y: WY, z: zLE(3.7), chord: ZTE - zLE(3.7), tc: 0.034 },
      { x: 6.2, y: WY, z: zLE(6.2), chord: ZTE - zLE(6.2), tc: 0.03, twist: -0.5 },
      { x: 8.47, y: WY, z: zLE(8.47), chord: ZTE - zLE(8.47), tc: 0.026, twist: -1.2 },
    ],
    lines: { hinge: [[4.6, hf(4.6)], [5.8, hf(5.8)], [7.0, hf(7.0)], [8.2, hf(8.2)], [8.47, hf(8.47)]] },
    controls: [{ name: 'elevon', type: 'flap', span: [4.72, 8.1], from: 'hinge', nose: 1 }],
    charts: { upper: side > 0 ? cWT.R : cWT.L, lower: cWB },
  });
  const W = { R: mkWing(1), L: mkWing(-1) };
  stat.add(W.R.mesh).add(W.L.mesh);

  // ---- fins (all-moving, canted 15° inward on the nacelles) ---------------------------------------------------------------------
  const CANT = 15 * DEG, FSPAN = 3.05, FROOT = { y: 0.74, z: 2.7, c: 6.3 }, FTIP = { z: 2.7 + FSPAN * Math.tan(48 * DEG), c: 1.35 };
  const finTip = (sx) => [sx * (NX - FSPAN * Math.sin(CANT)), FROOT.y + FSPAN * Math.cos(CANT), FTIP.z];
  const mkFin = (sx) => K.wing({
    airfoil: K.biconvex(0.04), chordPts: Math.round(10 * detail), spanAxis: 'u', tip: 'flat', root: 'flat',
    stations: [{ x: sx * NX, y: FROOT.y, z: FROOT.z, chord: FROOT.c, tc: 0.04 }, { x: finTip(sx)[0], y: finTip(sx)[1], z: FTIP.z, chord: FTIP.c, tc: 0.03 }],
    charts: { upper: cFin.L, lower: cFin.R },
  });
  const fins = { R: mkFin(1), L: mkFin(-1) };
  for (const sx of [1, -1]) {   // fixed fin base fairing (actuator housing) on the nacelle top
    stat.add(K.loft({
      stations: [[4.2, 0.0, 0.0], [4.8, 0.09, 0.05], [5.6, 0.13, 0.08], [7.2, 0.13, 0.08], [8.0, 0.08, 0.05], [8.5, 0.0, 0.0]]
        .map(([z, w, h]) => ({ z, x: sx * NX, y: NY + 0.89, w, top: h, bot: 0.04, kTop: 0.6 })),
      segments: 12, step: 0.3, uv: U.body,
    }).mesh);
  }

  // ---- cockpits -----------------------------------------------------------------------------------------------------------------
  const eye = G.pilotEye, eye2 = [0, eye[1] - 0.04, -11.25];
  // canopy loft standing on the cut-out sill (rear-hinged clamshells; the front station is a flat-sided tent for the V windshield)
  const canTop = K.pchip([-13.62, -13.3, -12.8, -12.3, -11.6, -11.0, -10.5, -10.0], [0.99, 1.02, 1.035, 1.035, 1.025, 1.0, 0.955, 0.905]);
  const canZ = [-13.62, -13.5, -13.3, -13.0, -12.7, -12.3, -12.0, -11.6, -11.2, -10.8, -10.4, -10.0];
  const canSt = canZ.map((z) => {
    const s = fus.at(z, T_SILL).p, h = Math.max(0.01, canTop(z) - s[1]), f = clamp((z + 13.62) / 0.5, 0, 1);
    const tent = Math.atan2(h, s[0]) / DEG;
    return { z, y: s[1], w: s[0], top: h, bot: 0.01, kTop: [0.33 + f * 0.4, f * 0.62], aTop: tent + f * (72 - tent) };
  });
  const cseg = Math.max(16, Math.round(36 * detail / 4) * 4), ct = 1 / cseg;
  const canLoft = (zr, tr, inflate, uv) => K.loft({ stations: canSt, segments: cseg, step: 0.08, tRange: tr, zRange: zr, inflate, uv }).mesh;
  const ZP1 = -12.3;     // pilot / RSO canopy split
  // pilot canopy: glazed with a centre frame; RSO canopy: opaque with small side windows
  const glassP = canLoft([-13.62, -12.42], [0.25, 0.75], 0, [0, 0]);
  const frameP = K.merge(
    canLoft([-13.62, -13.54], [0.25, 0.75], 0.008, U.frame), canLoft([-12.5, ZP1], [0.25, 0.75], 0.004, U.frame),
    canLoft([-13.62, ZP1], [0.25, 0.25 + ct], 0.006, U.frame), canLoft([-13.62, ZP1], [0.75 - ct, 0.75], 0.006, U.frame),
    canLoft([-13.62, ZP1], [0.5 - ct * 0.5, 0.5 + ct * 0.5], 0.006, U.frame), canLoft([-13.0, -12.95], [0.25, 0.75], 0.005, U.frame));
  const WZ = [-11.95, -11.35], WT = [0.29, 0.39];
  const glassR = K.merge(canLoft(WZ, WT, 0, [0, 0]), canLoft(WZ, [1 - WT[1], 1 - WT[0]], 0, [0, 0]));
  const frameR = K.merge(
    canLoft([ZP1, WZ[0]], [0.25, 0.75], 0.003, U.frame), canLoft([WZ[1], -10.0], [0.25, 0.75], 0.003, U.frame),
    canLoft(WZ, [0.25, WT[0]], 0.003, U.frame), canLoft(WZ, [WT[1], 1 - WT[1]], 0.003, U.frame), canLoft(WZ, [1 - WT[0], 0.75], 0.003, U.frame),
    canLoft([ZP1, ZP1 + 0.06], [0.25, 0.75], 0.007, U.frame), canLoft([-10.08, -10.0], [0.25, 0.75], 0.007, U.frame));
  // V windshield: two flat panes from a point on the nose top to the canopy's front arch, centre post and side frames
  const ZA = -14.68, A = [0, fus.topAt(ZA) - 0.005, ZA];
  const S0 = fus.at(Z_CK[0], T_SILL).p, SR = [S0[0] + 0.004, S0[1], Z_CK[0]], SL = [-SR[0], SR[1], SR[2]], RT = [0, canTop(Z_CK[0]) + 0.004, Z_CK[0]];
  const windshield = new K.Mesh();
  const tri = (m, a, b, c, uv) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; n = n.map((q) => q / l);
    const i = m.vertexCount; for (const p of [a, b, c]) m.vert(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]); m.tri(i, i + 1, i + 2);
  };
  tri(windshield, A, RT, SR, [0, 0]); tri(windshield, A, SL, RT, [0, 0]);
  stat.add(K.tube(A, RT, 0.03, 0.03, { segments: 6, uv: U.frame }));
  stat.add(K.tube(A, SR, 0.025, 0.025, { segments: 6, uv: U.frame })).add(K.tube(A, SL, 0.025, 0.025, { segments: 6, uv: U.frame }));
  stat.add(K.tube(SR, RT, 0.03, 0.03, { segments: 6, uv: U.frame })).add(K.tube(SL, RT, 0.03, 0.03, { segments: 6, uv: U.frame }));
  stat.add(K.ellipsoid(0.04, 0.03, 0.05, { segments: 8, rings: 4, uv: U.frame }).translate(...A));

  // interior: tubs, bulkhead, panels, seats, crew in pressure suits
  const tubX = 0.4;
  stat.add(K.tub({ x: tubX, y0: -0.26, y1: 0.42, z0: -13.6, z1: -10.1, uv: U.interior, taper: 0.88 }));
  {  // sill ledge between the skin cut-out and the tub
    const zs = []; for (let z = Z_CK[0]; z <= Z_CK[1] - 0.001; z += 0.2) zs.push(z); zs.push(Z_CK[1]);
    for (const sx of [1, -1]) {
      let prev = null;
      for (const z of zs) {
        const o = fus.at(z, sx > 0 ? T_SILL : 1 - T_SILL).p, a = stat.vert(o[0], o[1], z, -sx * 0.6, 0.8, 0, U.frame[0], U.frame[1]), b = stat.vert(sx * tubX * 0.92, 0.4, z, -sx * 0.6, 0.8, 0, U.frame[0], U.frame[1]);
        if (prev) { if (sx > 0) stat.quad(prev[0], a, b, prev[1]); else stat.quad(prev[0], prev[1], b, a); }
        prev = [a, b];
      }
    }
  }
  const glare = (z0, z1, y0, y1, hw) => { const gs = K.prism([[z0, y0], [z0, y1], [z1 - 0.05, y1 + 0.02], [z1, y1], [z1, y0]], -hw, hw, U.black); for (let i = 0; i < gs.p.length; i += 3) gs.p[i] *= 0.6 + 0.4 * clamp((gs.p[i + 2] - z0) / (z1 - z0), 0, 1); return gs; };
  stat.add(glare(-13.62, -13.32, 0.36, 0.56, 0.36));
  stat.add(K.box(0.8, 0.7, 0.06, U.interior).translate(0, 0.1, -11.98));                                 // bulkhead between the cockpits
  stat.add(glare(-11.98, -11.78, 0.33, 0.46, 0.34));
  const panelQuad = (z, y0, y1, hw, b0, b1) => { const i0 = stat.vertexCount; for (const [x, y, b] of [[-hw, y0, b1], [hw, y0, b1], [hw, y1, b0], [-hw, y1, b0]]) { const uv = cPanel.uv(x + 0.4, b); stat.vert(x, y, z, 0, 0.25, 1, uv[0], uv[1]); } stat.quad(i0, i0 + 1, i0 + 2, i0 + 3); };
  panelQuad(-13.34, 0.0, 0.38, 0.37, 0.02, 0.42);
  panelQuad(-11.77, 0.0, 0.34, 0.34, 0.48, 0.86);
  stat.add(K.box(0.2, 0.28, 0.4, U.console).translate(0, -0.1, -13.1));
  for (const [z0, z1] of [[-13.3, -12.2], [-11.7, -10.3]]) for (const sx of [-1, 1]) stat.add(K.box(0.13, 0.1, z1 - z0, U.console).translate(sx * 0.32, 0.2, (z0 + z1) / 2));
  stat.add(K.stick({ base: [0, -0.05, -13.2], height: 0.36, uv: U.black, uvGrip: U.dark }));
  stat.add(K.box(0.07, 0.08, 0.14, U.dark).translate(-0.32, 0.29, -12.95));
  const seatUV = { frame: U.seat, cushion: U.cushion, accent: U.accent };
  stat.add(K.ejectionSeat({ eye, recline: 14, uv: seatUV })).add(K.ejectionSeat({ eye: eye2, recline: 14, uv: seatUV }));
  const crewUV = { suit: U.suit, helmet: U.helmet, visor: U.visor, dark: U.suitDark, glove: U.glove };
  const crew = (e, stick, thr) => {
    const m = K.pilot({ eye: e, recline: 12, stick, throttle: thr, uv: crewUV, scale: 1.08 });
    m.add(K.lathe([[0.15, -0.06], [0.16, 0.0], [0.15, 0.06]], { segments: 14, uv: U.helmet }).rotateX(Math.PI / 2).translate(e[0], e[1] - 0.16, e[2] + 0.1));   // helmet neck ring
    m.add(K.ellipsoid(0.13, 0.04, 0.05, { segments: 10, rings: 4, uv: U.suitDark }).translate(e[0], e[1] - 0.4, e[2] - 0.06));                           // ventilation hose bundle
    return m;
  };
  const crewMesh = K.merge(crew(eye, [0, -0.5, -0.33], [-0.32, -0.42, 0.05]), crew(eye2, [0.25, -0.5, -0.3], [-0.25, -0.5, -0.3]));

  // ---- antennas, probes, drag-chute doors -------------------------------------------------------------------------------------
  stat.add(K.bladeAntenna({ pos: [0, fus.botAt(-7.5) + 0.02, -7.5], height: 0.2, chord: 0.3, sweep: 0.15, down: true, uv: U.body }));
  stat.add(K.bladeAntenna({ pos: [0, fus.botAt(3.5) + 0.02, 3.5], height: 0.18, chord: 0.28, sweep: 0.14, down: true, uv: U.body }));
  stat.add(K.bladeAntenna({ pos: [0, fus.topAt(-4.0) - 0.015, -4.0], height: 0.14, chord: 0.24, sweep: 0.12, uv: U.body }));
  {  // drag-chute compartment doors on the spine just ahead of the fins
    const z0 = 4.4, z1 = 6.2;
    const doorM = fus.at((z0 + z1) / 2, 0.5).p;
    stat.add(K.box(0.42, 0.02, z1 - z0, U.chute).translate(0, doorM[1] + 0.004, (z0 + z1) / 2));
  }

  // ---- paint ------------------------------------------------------------------------------------------------------------------
  lap('geometry');
  paint(atlas, { SC, fus, nac, W, fins, cFus, cNac, cWT, cWB, cFin, cPanel, cNoz, paintF, tAtX, T_SILL, Z_CK, zLE, hingeZ, Z_MLG, Z_NG, tW0, tW1, tW2, tN });
  lap('paint');
  const mat = atlas.material(ctx, { envMapIntensity: 1, normalScale: 1 });
  lap('textures');
  rig.material('paint', mat, { shared: true });
  rig.disposables.push(atlas);
  rig.glass('canopy', K.glassMaterial(ctx, { tint: '#26313d', opacity: 0.16, edgeOpacity: 0.82, roughness: 0.03, reflect: 1 }));
  const glowMat = [rig.material('glowL', K.glowMaterial(), { shadow: false }), rig.material('glowR', K.glowMaterial(), { shadow: false })];
  const plumeMat = [rig.material('plumeL', K.glowMaterial(), { shadow: false }), rig.material('plumeR', K.glowMaterial(), { shadow: false })];

  rig.addStatic(stat, 'paint');
  rig.addStatic(windshield, 'canopy');

  // ---- moving parts ------------------------------------------------------------------------------------------------------------
  // canopies hinge at their rear edges and open upward
  const mkCanopy = (name, glassM, frameM, zh, zf) => {
    const yh = canTop(zh), node = rig.node(name, { pivot: [0, yh, zh] });
    rig.part(name + 'Glass', glassM, { parent: node, key: 'canopy' });
    rig.part(name + 'Frame', frameM, { parent: node });
    return rig.hinge(node, [-1, yh, zh], [1, yh, zh], { ref: [0, canTop(zf), zf], toward: [0, 1, 0] });
  };
  const setCanP = mkCanopy('canopyP', glassP, frameP, ZP1 + 0.02, -13.5);
  const setCanR = mkCanopy('canopyR', glassR, frameR, -10.02, -12.2);
  const crewNode = rig.part('crew', crewMesh, { pivot: eye });

  const elevO = { R: rig.hingePart('elevonOR', W.R.controls.elevon), L: rig.hingePart('elevonOL', W.L.controls.elevon) };
  const mkIn = (name, w, sx) => {
    const a = [sx * 1.47, -0.1, 7.6], b = [sx * 2.8, -0.1, 7.6];
    const node = rig.part(name, w.mesh, { pivot: a });
    return rig.hinge(node, a, b, { ref: [sx * 2.1, -0.1, 9.0], toward: [0, 1, 0] });
  };
  const elevI = { R: mkIn('elevonIR', inElev.R, 1), L: mkIn('elevonIL', inElev.L, -1) };
  const finNodes = {}, setFin = {};
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const a = [sx * NX, FROOT.y, 5.4], tp = finTip(sx), b = [tp[0], tp[1], 6.7];
    finNodes[key] = rig.part('fin' + key, fins[key].mesh, { pivot: a });
    setFin[key] = rig.hinge(finNodes[key], a, b, { ref: [sx * NX, FROOT.y + 0.3, 8.8], toward: [1, 0, 0] });
  }
  const spikeNodes = spikes.map((m, i) => rig.part('spike' + i, m, { pivot: [i === 0 ? NX : -NX, NY, -3.5] }));
  const nozNodes = nozzles.map((m, i) => rig.part('nozzle' + i, m, { pivot: [G.engines[i].nozzle[0], NY, 9.6] }));
  glows.forEach((m, i) => rig.part('abGlow' + i, m, { key: i === 0 ? 'glowL' : 'glowR' }));
  const plumeNodes = plumes.map((m, i) => rig.part('plume' + i, m, { key: i === 0 ? 'plumeL' : 'plumeR' }));

  // ---- landing gear --------------------------------------------------------------------------------------------------------------
  const gp = G.gear;
  const doorOf = (patch, edge, inner = U.well) => ({ mesh: K.thicken(patch, 0.02, inner), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  K.buildGear(rig, atlas, {
    name: 'nose', index: 0, contact: gp[0].pos, wheelRadius: gp[0].wheelRadius, wheelWidth: 0.16, wheels: [-0.165, 0.165],
    pivot: [0, -0.1, -10.86], stroke: 0.28, staticFrac: 0.3, strutR: 0.06, fork: 'axle', steer: true, links: 'front',
    retract: { to: [0, -0.2, -12.5] }, window: [0.22, 0.88], brace: [0, -0.2, -10.2],
    doors: [
      { name: 'noseDoorR', ...doorOf(P.ngR, fus.edges.ngR.tHi), open: 86, toward: [0, -1, 0] },
      { name: 'noseDoorL', ...doorOf(P.ngL, fus.edges.ngL.tLo), open: 86, toward: [0, -1, 0] },
    ],
    lamps: [{ kind: 'landing', pos: [0.1, -1.05, -11.12], size: 0.05, color: [1, 0.96, 0.88] }, { kind: 'taxi', pos: [-0.1, -1.05, -11.12], size: 0.045, color: [1, 0.96, 0.88] }],
  });
  const MWIN = [0.2, 0.9];
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, Pv = [sx * 2.12, -0.12, c[2]], to = [sx * 0.67, 0.045, c[2]];
    // retraction axis/angle (same as the kit computes) for the strut door that follows the leg
    const C = new THREE.Vector3(c[0], c[1] + gp[i].wheelRadius, c[2]), PV = new THREE.Vector3(...Pv);
    const v1 = C.clone().sub(PV).normalize(), v2 = new THREE.Vector3(...to).sub(PV).normalize();
    const ax = new THREE.Vector3().crossVectors(v1, v2).normalize(), ang = Math.acos(clamp(v1.dot(v2), -1, 1));
    const wellEdge = fus.edges['mlw' + key];
    K.buildGear(rig, atlas, {
      name: 'main' + key, index: i, contact: c, wheelRadius: gp[i].wheelRadius, wheelWidth: 0.24, wheels: [-0.31, 0, 0.31],
      pivot: Pv, stroke: 0.3, staticFrac: 0.35, strutR: 0.085, fork: 'fork', links: 'none',
      retract: { to }, window: MWIN, brace: [sx * 1.55, -0.2, c[2] - 0.6],
      doors: [
        { name: 'mainDoor' + key, ...doorOf(P['mlw' + key], sx > 0 ? wellEdge.tLo : wellEdge.tHi), open: 92, toward: [0, -1, 0] },
        { name: 'strutDoor' + key, mesh: K.thicken(P['mll' + key], 0.02, U.well), hinge: { a: Pv, b: [Pv[0] + ax.x, Pv[1] + ax.y, Pv[2] + ax.z] }, ref: K.centroid(P['mll' + key]), toward: [0, -1, 0], open: ang / DEG, fn: (g) => K.seq(g, MWIN[0], MWIN[1]) },
      ],
    });
  }

  // ---- lamps ---------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.04, squash: [0.7, 0.7, 1.6] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.04, squash: [0.7, 0.7, 1.6] });
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.04 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.045, parent: finNodes.L });
  rig.lamp('strobe', [-L.strobe[0], L.strobe[1], L.strobe[2]], { color: [1, 1, 1], size: 0.045, parent: finNodes.R });
  rig.lamp('beacon', L.beacon, { color: [1, 0.1, 0.05], size: 0.05 });
  rig.lamp('beacon', [0, fus.botAt(-3.0) - 0.02, -3.0], { color: [1, 0.1, 0.05], size: 0.05 });

  // ---- animation -----------------------------------------------------------------------------------------------------------
  let spikePos = 0, first = true;
  rig.onUpdate((S, dt) => {
    const sf = S.sf;
    // elevons: pitch + roll mixed; inboard pairs favour pitch, outboard pairs favour roll (+ = trailing edge up)
    for (const [key, side] of [['R', 'R'], ['L', 'L']]) {
      const el = sf['elevator' + side] ?? 0, ai = sf['aileron' + side] ?? 0;
      elevI[key](clamp(el + 0.6 * ai, -1, 1) * 20 * DEG);
      elevO[key].set(clamp(0.8 * el + ai, -1, 1) * 20 * DEG);
    }
    setFin.R(sf.rudder * 20 * DEG); setFin.L(sf.rudder * 20 * DEG);
    // inlet spikes translate aft above Mach 1.6 (0.66 m at Mach 3.2)
    const mach = S.raw && Number.isFinite(S.raw.mach) ? S.raw.mach : 0, target = clamp((mach - 1.6) / 1.6, 0, 1) * 0.66;
    spikePos = first || !(dt > 0) ? target : spikePos + (target - spikePos) * Math.min(1, dt * 1.5); first = false;
    for (const n of spikeNodes) n.position.z = n.userData.pivot[2] + spikePos;
    for (let i = 0; i < 2; i++) {
      const e = S.eng[i] || S.eng[0] || {}, ab = e.afterburner ?? 0;
      nozNodes[i].morphTargetInfluences[0] = clamp(Math.max(e.nozzle ?? 0, ab, (mach - 0.9) / 1.5), 0, 1);
      K.abGlowColor(glowMat[i].color, e, S.night);
      const k = ab * (1 - 0.5 * S.night);
      plumeMat[i].color.setRGB(2.2 * k, 1.05 * k, 1.1 * k);
      plumeNodes[i].visible = ab > 0.02;
    }
    setCanP(sf.canopy * 42 * DEG); setCanR(sf.canopy * 42 * DEG);
    crewNode.visible = !rig.cameraInCockpit;
  });
  const visual = rig.build();
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- paint -------------------------------------------------------------------------------------------------------------------
/** Thermal-expansion corrugations: soft raised ridges along the given polylines, clipped to a region (height layer only). */
function corrugate(pen, clip, lines, o = {}) {
  const amp = o.amp ?? 0.4, w = o.width ?? 0.07;
  pen.each('height', (g, setT, s, L) => {
    g.beginPath(); pen._path(clip)(g, s); g.clip();
    const pxw = Math.max(1, w * Math.sqrt(Math.abs(s.sx * s.sy)) * L.scale);
    g.filter = `blur(${Math.max(0.6, pxw * 0.45).toFixed(2)}px)`;
    g.lineCap = 'round';
    for (const pts of lines) {
      setT(); g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.setTransform(1, 0, 0, 1, 0, 0); g.lineWidth = pxw; g.strokeStyle = `rgba(255,255,255,${amp})`; g.stroke();
    }
    g.filter = 'none';
  });
}

function paint(atlas, o) {
  const { SC, fus, nac, W, fins, cFus, cNac, cWT, cWB, cFin, cPanel, cNoz, paintF, tAtX, T_SILL, Z_CK, zLE, hingeZ, Z_MLG, Z_NG, tW0, tW1, tW2, tN } = o, F = K.FINISH;
  const base = paintF(SC.base), mark = SC.mark, white = SC.white;
  const tiWear = { color: '#6f6c66', rough: 0.42, metal: 0.9 };
  const rnd = (() => { let a = 7177; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const line = { px: 1, depth: 0.4, dark: 0.0 }, gap = { px: 2, depth: 0.85, dark: 0.35 };
  const tone = (Q, path, k) => Q.fill(path, { color: k > 0 ? SC.hi : SC.lo }, { alpha: Math.abs(k) });
  const red = { color: mark, rough: 0.6, metal: 0 };

  // ================= fuselage / chines / inboard wing =================
  const P = atlas.pen(cFus);
  P.fill('all', base);
  const frames = [-19.0, -17.8, -16.4, -14.9, -13.62, -12.3, -10.0, -9.0, -7.9, -6.8, -5.6, -4.5, -3.3, -2.2, -1.0, 0.2, 1.4, 2.6, 3.8, 5.0, 6.2, 7.6, 9.0, 10.2, 11.4];
  const bands = [0, 0.06, 0.13, 0.19, 0.25, 0.31, 0.37, 0.44, 0.5, 0.56, 0.63, 0.69, 0.75, 0.81, 0.87, 0.94, 1];
  // iron-ball paint: panel-to-panel tone variation
  for (let i = 0; i < frames.length - 1; i++) for (let j = 0; j < bands.length - 1; j++) {
    const k = (rnd() - 0.5) * 0.5; tone(P, (g) => g.rect(frames[i], bands[j], frames[i + 1] - frames[i], bands[j + 1] - bands[j]), k);
  }
  P.fill((g) => g.rect(-19.7, 0, 4.8, 1), { color: '#1a2020' }, { alpha: 0.45 });                         // slightly greenish nose section
  for (const z of frames) P.ring(z, 0, 1, z === -14.9 ? { px: 1.6, depth: 0.6, dark: 0.2 } : line);
  for (const tt of [0.06, 0.13, 0.19, 0.31, 0.37, 0.44, 0.5]) for (const s of [1, -1]) P.line([[-14.9, s > 0 ? tt : 1 - tt], [12.7, s > 0 ? tt : 1 - tt]], line);
  P.line([[-19.6, 0], [12.7, 0]], line);
  // inboard wing (blade) upper surface: chordwise corrugated skin panels between spanwise ribs
  const xLEin = (x) => (x <= 1.7 ? -6.5 - (1.7 - x) * 5 : -6.5 + (x - 1.7) / 1.25 * 3.9);
  for (const s of [1, -1]) {
    const tt = (z, x) => { const t = tAtX(fus, z, x, true); return s > 0 ? t : 1 - t; };
    const poly = (x, z0, z1) => { const pts = []; for (let z = z0; z <= z1 + 1e-6; z += (z1 - z0) / 8) pts.push([z, tt(z, x)]); return pts; };
    const lines = [];
    for (let x = 1.12; x <= 2.72; x += 0.16) lines.push(poly(x, Math.max(-2.2, xLEin(x) + 0.9), 7.35));
    const clipPts = [...poly(1.05, -2.2, 7.4), ...poly(2.78, -2.2, 7.4).reverse()];
    corrugate(P, clipPts, lines, { amp: 0.45, width: 0.07 });
    for (const x of [1.05, 2.78]) P.line(poly(x, -2.2, 7.4), line);
    for (const z of [-2.2, 0.2, 2.6, 5.0, 7.4]) P.line([[z, tt(z, 1.05)], [z, tt(z, 2.78)]], line);
    // red walkway / NO STEP lines
    P.stroke((g) => { const a = poly(0.98, -1.8, 7.0); a.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); }, 0, red, { px: 1.6 });
    P.stroke((g) => { const a = poly(2.86, -1.4, 7.0); a.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); }, 0, red, { px: 1.6 });
    for (const z of [-0.4, 3.8]) P.decalT(z, tt(z, 1.9), { rot: s > 0 ? 0 : 180 }, (g) => K.drawText(g, 'NO STEP', 0.07, { color: mark }));
    // inboard elevon hinge gap and TE wear
    P.line([[7.6, tt(7.6, 1.45)], [7.6, tt(7.6, 3.0)]], gap);
    // chine edge: worn titanium showing through
    P.wear((g) => { g.moveTo(-19.5, s > 0 ? 0.25 : 0.75); g.lineTo(-3.0, s > 0 ? 0.25 : 0.75); }, 0.03, tiWear, { alpha: 0.4 });
    P.stroke((g) => { g.moveTo(-19.5, s > 0 ? 0.25 : 0.75); g.lineTo(-2.6, s > 0 ? 0.25 : 0.75); }, 0, { color: '#2a2c30' }, { px: 1.2, alpha: 0.5 });
  }
  // gear doors outlines (lower surface)
  for (const s of [1, -1]) {
    const t = (v) => (s > 0 ? v : 1 - v);
    P.line([[Z_MLG[0], t(tW0)], [Z_MLG[0], t(tW2)], [Z_MLG[1], t(tW2)], [Z_MLG[1], t(tW0)], [Z_MLG[0], t(tW0)]], gap);
    P.line([[Z_MLG[0], t(tW1)], [Z_MLG[1], t(tW1)]], gap);
    P.line([[Z_NG[0], t(0.002)], [Z_NG[0], t(tN)], [Z_NG[1], t(tN)], [Z_NG[1], t(0.002)]], gap);
  }
  P.line([[Z_NG[0], 0], [Z_NG[1], 0]], gap);
  // air-refuelling receptacle on the spine behind the RSO, drag-chute doors
  P.decalT(-6.2, 0.5, {}, (g) => { g.fillStyle = '#050607'; g.fillRect(-0.25, -0.12, 0.5, 0.24); g.strokeStyle = white; g.lineWidth = 0.012; g.strokeRect(-0.32, -0.18, 0.64, 0.36); for (const d of [-1, 1]) { g.beginPath(); g.moveTo(-1.6, d * 0.04); g.lineTo(-0.36, d * 0.04); g.stroke(); } });
  P.decalT(5.3, 0.5, { layers: ['height', 'color'] }, (g, layer) => { g.strokeStyle = layer === 'height' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)'; g.lineWidth = 0.012; g.strokeRect(-0.92, -0.22, 1.84, 0.44); });
  // walkway stencils, rescue markings, fuel
  P.textOn('RESCUE', -12.9, 0.12, 'both', 0.045, { color: mark });
  P.decalOn(-13.35, 0.12, 'both', (g) => { g.strokeStyle = mark; g.lineWidth = 0.014; g.beginPath(); g.moveTo(-0.13, 0); g.lineTo(0.09, 0); g.moveTo(0.03, -0.05); g.lineTo(0.1, 0); g.lineTo(0.03, 0.05); g.stroke(); });
  P.decalOn(-12.2, 0.05, 'both', (g) => { g.fillStyle = mark; g.beginPath(); g.moveTo(-0.08, 0.07); g.lineTo(0.08, 0.07); g.lineTo(0, -0.07); g.closePath(); g.fill(); g.fillStyle = white; g.font = '700 0.06px sans-serif'; g.textAlign = 'center'; g.fillText('!', 0, 0.05); });
  P.textOn('DANGER', -11.9, 0.05, 'both', 0.032, { color: mark });
  P.decalT(-8.4, 0.5, {}, (g) => K.drawText(g, 'TOP FILL', 0.05, { color: mark }));
  if (SC.nasa) {
    P.textOn('NASA', -16.2, 0.12, 'both', 0.2, { color: white, font: K.FONT.wide, spacing: 0.1 });
    P.decalOn(-15.2, 0.15, 'both', (g) => emblem(g, 0.3, SC));
  } else {
    P.textOn('U.S. AIR FORCE', -16.4, 0.12, 'both', 0.075, { color: mark, font: K.FONT.wide, spacing: 0.08 });
  }
  // weathering: JP-7 seepage streaks on the belly, heat at the tail, soot
  P.noise({ alpha: 0.07, scale: 2.4, stretch: [1.8, 1], rough: 0.07 });
  P.noise({ alpha: 0.05, scale: 0.8, mode: 'light' });
  for (let i = 0; i < 40; i++) { const z = -9 + rnd() * 18, t = (rnd() < 0.5 ? 0.02 : 0.83) + rnd() * 0.15; P.streak(z, t, z + 0.8 + rnd() * 2.0, t + (rnd() - 0.5) * 0.01, 0.015 + rnd() * 0.03, { alpha: 0.12 + rnd() * 0.12, color: '2,2,3' }); }
  P.fill((g) => g.rect(10.5, 0, 2.4, 1), { color: '#2a2a2e', rough: 0.55, metal: 0.35 }, { alpha: 0.25, feather: 10 });

  // ================= nacelles (shared chart; t = 0.25 is the outboard side on both) =================
  {
    const Q = atlas.pen(cNac);
    Q.fill('all', base);
    const nz = [-3.35, -2.6, -1.6, -0.4, 0.9, 2.2, 3.5, 4.8, 6.1, 7.4, 8.6, 9.65], nb = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
    for (let i = 0; i < nz.length - 1; i++) for (let j = 0; j < nb.length - 1; j++) tone(Q, (g) => g.rect(nz[i], nb[j], nz[i + 1] - nz[i], 0.125), (rnd() - 0.5) * 0.5);
    for (const z of nz) Q.ring(z, 0, 1, z === -2.6 ? { px: 1.5, depth: 0.6, dark: 0.2 } : line);
    for (const t of nb) Q.line([[-2.6, t], [9.6, t]], line);
    Q.fill((g) => g.rect(-3.7, 0, 0.35, 1), { color: '#202226', rough: 0.45, metal: 0.6 });                // inlet lip
    Q.wear((g) => { g.moveTo(-3.55, 0); g.lineTo(-3.55, 1); }, 0.04, tiWear, { alpha: 0.5 });
    // forward bypass doors / shock-trap louvres on the outboard-lower side, aft bypass louvres
    for (const [z0, z1, t0, t1] of [[-1.5, -0.6, 0.15, 0.22], [-1.5, -0.6, 0.28, 0.35], [1.1, 1.9, 0.18, 0.32], [1.1, 1.9, 0.68, 0.82]]) {
      Q.fill((g) => g.rect(z0, t0, z1 - z0, t1 - t0), { color: SC.lo }, { alpha: 0.6 });
      Q.panel(z0, t0, z1, t1, gap);
      for (let k = 1; k < 6; k++) Q.line([[z0 + (z1 - z0) * k / 6, t0], [z0 + (z1 - z0) * k / 6, t1]], { px: 1, depth: 0.4, dark: 0.3 });
    }
    // heat-worn titanium on the aft shroud
    Q.fill((g) => g.rect(7.6, 0, 2.2, 1), { color: '#2b2a2d', rough: 0.5, metal: 0.55 }, { alpha: 0.5, feather: 14 });
    for (let i = 0; i < 26; i++) { const t = rnd(); Q.streak(9.65, t, 7.4 + rnd(), t, 0.02 + rnd() * 0.04, { alpha: 0.25, color: '70,66,62' }); }
    if (!SC.nasa) Q.decalT(-1.9, 0.25, { girth: 5.2 }, (g) => { g.scale(1, -1); K.drawStarBar(g, 0.5, { lowVis: mark }); });
    Q.noise({ alpha: 0.07, scale: 1.8, stretch: [1.6, 1], rough: 0.07 });
    for (let i = 0; i < 12; i++) { const z = -2 + rnd() * 9, t = 0.02 + rnd() * 0.08; Q.streak(z, t, z + 1 + rnd(), t, 0.02, { alpha: 0.15, color: '2,2,3' }); }
  }

  // ================= outboard wings =================
  for (const key of ['R', 'L']) {
    const s = key === 'R' ? 1 : -1, wg = W.R;
    const at = (x, f) => { const p = wg.at(x, f); return [p[0], p[2]]; };
    for (const [chart, isTop] of [[cWT[key], true], ...(key === 'R' ? [[cWB, false]] : [])]) {
      const Q = atlas.pen(chart);
      Q.fill('all', base);
      const ln = (pts, op) => Q.line(pts.map((p) => [p[0] * s, p[1]]), op);
      const ribs = [4.6, 5.3, 6.0, 6.7, 7.4, 8.1];
      const spars = [0.12, 0.34, 0.55];
      // panel tone variation
      for (let i = 0; i < ribs.length - 1; i++) for (let j = 0; j < 3; j++) {
        const fA = [0.0, ...spars][j], fB = [...spars, 0.99][j + 1] ?? 0.99, x0 = ribs[i], x1 = ribs[i + 1];
        const poly = [at(x0, fA), at(x1, fA), at(x1, Math.min(fB, 0.99)), at(x0, Math.min(fB, 0.99))].map((p) => [p[0] * s, p[1]]);
        tone(Q, poly, (rnd() - 0.5) * 0.55);
      }
      for (const f of spars) ln([at(4.6, f), at(8.4, f)], line);
      for (const x of ribs) ln([at(x, 0.01), at(x, 0.99)], line);
      // elevon gaps
      ln([[4.72, 9.0], [4.72, hingeZ(4.72)], [8.1, hingeZ(8.1)], [8.1, 9.0]], gap);
      if (isTop) {
        const lines = [];
        for (let x = 4.75; x <= 8.3; x += 0.15) lines.push([[x * s, zLE(x) + 0.55], [x * s, hingeZ(x) - 0.12]]);
        const clip = [[4.65 * s, zLE(4.65) + 0.5], [8.35 * s, zLE(8.35) + 0.5], [8.35 * s, hingeZ(8.35) - 0.1], [4.65 * s, hingeZ(4.65) - 0.1]];
        corrugate(Q, clip, lines, { amp: 0.45, width: 0.065 });
        // red no-step line along the nacelle side
        Q.stroke((g) => { g.moveTo(4.72 * s, zLE(4.72) + 0.4); g.lineTo(4.72 * s, 7.3); }, 0, red, { px: 1.6 });
        const p = at(5.6, 0.62); Q.text('NO STEP', p[0] * s, p[1], 0.07, { color: mark, rot: s > 0 ? -90 : 90 });
      }
      const le = [at(4.55, 0.004), at(8.45, 0.004)].map((p) => [p[0] * s, p[1]]);
      Q.wear((g) => { g.moveTo(le[0][0], le[0][1]); g.lineTo(le[1][0], le[1][1]); }, 0.05, tiWear, { alpha: 0.45 });
      Q.wear((g) => { g.moveTo(8.45 * s, zLE(8.45)); g.lineTo(8.45 * s, 9.0); }, 0.04, tiWear, { alpha: 0.4 });
      Q.noise({ alpha: 0.08, scale: 1.5, stretch: [1, 2.5], rough: 0.07 });
      if (!isTop) for (let i = 0; i < 14; i++) { const x = 4.8 + rnd() * 3.4, z = zLE(x) + rnd() * 2; Q.streak(x * s, z, x * s, z + 1.2 + rnd() * 2, 0.04 + rnd() * 0.05, { alpha: 0.18, color: '2,2,3' }); }
    }
  }

  // ================= fins (one paint for both fins; L chart = faces seen from the left) =================
  for (const key of ['L', 'R']) {
    const Q = atlas.pen(cFin[key]); Q.fill('all', base);
    const fin = fins.R, at = (u, f) => { const p = fin.at(u, f); return [p[2], p[1]]; };
    const span = 3.05;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) tone(Q, [at(i * span / 4, j / 3), at((i + 1) * span / 4, j / 3), at((i + 1) * span / 4, (j + 1) / 3), at(i * span / 4, (j + 1) / 3)], (rnd() - 0.5) * 0.5);
    for (const u of [0.76, 1.52, 2.29]) Q.line([at(u, 0.01), at(u, 0.99)], line);
    for (const f of [0.33, 0.66]) Q.line([at(0.05, f), at(span - 0.05, f)], line);
    Q.wear((g) => { const a = at(0, 0.004), b = at(span, 0.004); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }, 0.04, tiWear, { alpha: 0.45 });
    if (SC.nasa) {
      const band = (u0, u1, f) => Q.fill([at(u0, 0), at(u1, 0), at(u1, 1), at(u0, 1)], f);
      band(1.45, 2.15, { color: white, rough: 0.55, metal: 0 }); band(1.52, 2.08, { color: SC.band, rough: 0.55, metal: 0 });
      const c = at(2.55, 0.55); Q.text('NASA', c[0], c[1], 0.17, { color: white, font: K.FONT.wide, spacing: 0.08 });
      const d = at(0.95, 0.55); Q.text(SC.serial, d[0], d[1], 0.42, { color: white, font: K.FONT.wide });
      const e = at(1.8, 0.28); Q.decal(e[0], e[1], (g) => emblem(g, 0.28, SC));
    } else {
      const d = at(1.85, 0.5); Q.text(SC.serial, d[0], d[1], 0.3, { color: mark, font: K.FONT.wide, spacing: 0.04 });
      const e = at(1.45, 0.5); Q.text('U.S. AIR FORCE', e[0], e[1], 0.07, { color: mark, font: K.FONT.wide, spacing: 0.06 });
    }
    Q.noise({ alpha: 0.08, scale: 1.2, stretch: [1, 1.5], rough: 0.06 });
  }

  // ================= ejector flaps (a = around, b = hinge → exit) =================
  {
    const Q = atlas.pen(cNoz), n = 28, w = 5.0 / n;
    Q.fill('all', { color: '#26262a', rough: 0.5, metal: 0.75 });
    for (let i = 0; i < n; i++) {
      Q.fill((g) => g.rect(i * w + w * 0.25, 0.05, w * 0.5, 0.8), { color: i % 2 ? '#2f2e31' : '#343236', rough: 0.45, metal: 0.8 }, { alpha: 0.6 });
      Q.line([[i * w, 0], [i * w, 0.9]], { px: 2, depth: 0.9, dark: 0.6 });
    }
    Q.fill((g) => g.rect(0, 0.55, 5.0, 0.35), { color: '#3d3a40', rough: 0.45, metal: 0.85 }, { alpha: 0.55, feather: 6 });     // heat-blued tips
    Q.noise({ alpha: 0.12, scale: 0.8, stretch: [1, 2] });
  }

  // ================= instrument panels (pilot: top half, RSO: bottom half) =================
  {
    const Q = atlas.pen(cPanel); Q.fill('all', { color: '#141618', rough: 0.6, metal: 0 });
    const dial = (a, b, r, lit) => {
      Q.fill((g) => g.arc(a, b, r + 0.006, 0, Math.PI * 2), { color: '#2a2d30', rough: 0.4, metal: 0.5 });
      Q.fill((g) => g.arc(a, b, r, 0, Math.PI * 2), { color: '#070809', rough: 0.15, metal: 0, emissive: lit ? '#1a1408' : undefined });
      Q.decal(a, b, (g) => { g.strokeStyle = '#d8d8d0'; g.lineWidth = r * 0.06; for (let k = 0; k < 12; k++) { const t = k / 12 * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(t) * r * 0.8, Math.sin(t) * r * 0.8); g.lineTo(Math.cos(t) * r * 0.95, Math.sin(t) * r * 0.95); g.stroke(); } g.lineWidth = r * 0.08; g.beginPath(); g.moveTo(0, 0); g.lineTo(r * 0.6, -r * 0.4); g.stroke(); });
    };
    // pilot: ADI + HSI in the centre, engine tapes, round dials
    Q.fill((g) => g.arc(0.4, 0.17, 0.075, 0, Math.PI * 2), { color: '#3b3125' });
    Q.fill((g) => { g.moveTo(0.325, 0.17); g.arc(0.4, 0.17, 0.075, Math.PI, 0); g.closePath(); }, { color: '#2a4d78', emissive: '#08121e' });
    dial(0.4, 0.33, 0.06, true);
    for (const [a, b] of [[0.2, 0.12], [0.2, 0.27], [0.6, 0.12], [0.6, 0.27], [0.08, 0.2], [0.72, 0.2]]) dial(a, b, 0.045, true);
    for (let k = 0; k < 4; k++) Q.fill((g) => g.rect(0.27 + k * 0.03, 0.04, 0.018, 0.08), { color: '#0a0b0c', emissive: k % 2 ? '#201206' : '#0c1a0a' });
    for (let k = 0; k < 6; k++) Q.fill((g) => g.rect(0.05 + k * 0.12, 0.38, 0.05, 0.025), { color: k === 2 ? '#5a1810' : '#3c3418', emissive: k === 2 ? '#3a0a04' : undefined });
    // RSO: sensor display and nav dials
    Q.fill((g) => g.rect(0.25, 0.5, 0.3, 0.2), { color: '#06100a', rough: 0.1, metal: 0, emissive: '#0a2412' });
    for (const [a, b] of [[0.12, 0.56], [0.12, 0.72], [0.68, 0.56], [0.68, 0.72], [0.4, 0.79]]) dial(a, b, 0.045, true);
  }
}

/** Invented research-programme emblem: yellow star inside a white orbit ring with a dark field (not an agency logo). */
function emblem(g, s, SC) {
  const r = s / 2;
  g.fillStyle = '#111a2e'; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = SC.white; g.lineWidth = r * 0.12; g.beginPath(); g.ellipse(0, 0, r * 0.95, r * 0.38, -0.45, 0, Math.PI * 2); g.stroke();
  g.fillStyle = SC.band || '#e3b21f'; g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.22 : r * 0.55; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath(); g.fill();
  g.strokeStyle = SC.white; g.lineWidth = r * 0.06; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
}
