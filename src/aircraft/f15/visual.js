// McDonnell Douglas F-15E Strike Eagle — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (-1.85) when parked.
//
// Reference numbers (docs/aircraft/f15.md; z = d − 11.95 where d = distance aft of the nose tip):
//   length 19.43 m (nose −11.95 … stab tips / nozzles ≈ 7.3), span 13.05 m (tips ±6.52), height 5.63 m (fin tips y = 3.78)
//   fuselage: radome to d 2.9 (z −9.05), windshield base d 3.7 (z −8.25), canopy aft end d 7.6 (z −4.35)
//   intakes: 1.0 m wide × 1.3 m tall boxes centred x = ±1.12, y = 0.06, raked lip at z ≈ −5.7 (top lip forward)
//   upper deck / spine y ≈ 0.85 behind the canopy, intake tops 0.73, belly −0.6, half-width over the intakes 1.62
//   wing: shoulder mounted, root y 0.5, LE root (x 1.55) z −2.35, LE sweep 38.7°, TE ≈ unswept z 3.35…3.47,
//         −1° anhedral, raked (clipped) tip from x 5.85 to 6.52 (tip chord 1.2), NACA 64A0066 → 64A203, no LE devices,
//         plain flaps x 1.65…3.25, ailerons x 3.3…5.75 (hinge ≈ 0.8 → 0.68 chord)
//   stabilators: all-moving, root x 1.95 (on the tail booms), tips ±4.3, LE sweep ≈ 47° with an inboard dogtooth, pivot z 5.6,
//         −3° anhedral, TE ≈ z 7.2
//   fins: two, upright, x ±1.68, root y 0.7 (chord 4.6, LE z 1.95), tip y 3.78 (chord 1.75), rudders on the lower 2/3, tip pods
//   engines: F100 centres x ±1.0, y 0.2; nozzle exit z 7.25, r 0.55 (featherless, exposed actuators)
//   CFTs: x ±1.75 outside the intake ducts, z −3.7 … 3.7, tangential stub pylons; LANTIRN pods on the intake chin stations
//   gear (geometry.js): nose [0, −1.85, −4.9] r 0.28 single wheel retracting forward; mains [±1.375, −1.85, 0.5] r 0.44,
//         retracting forward and inward under the ducts with the wheel turned flat
//   pilot eye [0, 1.05, −7.15]; WSO eye [0, 1.2, −6.15]
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['seymour', 'heritage', 'lakenheath'];

const SCHEMES = {
  seymour: { name: 'USAF Gunship Gray, 4th FW', base: '#50555a', under: '#555a5f', radome: '#5a5f63', mark: '#2a2c2e', code: 'SJ', serial: ['AF 88', '915'], stripe: '#c9a62a', stripe2: '#1d1f21', finTop: null },
  lakenheath: { name: 'USAF Gunship Gray, 48th FW', base: '#52575c', under: '#575c61', radome: '#5c6165', mark: '#2a2c2e', code: 'LN', serial: ['AF 91', '326'], stripe: '#2f5fa8', stripe2: '#c9a62a', finTop: null, checker: true },
  heritage: { name: 'Skyward heritage commander scheme', base: '#4e5358', under: '#53585d', radome: '#585d61', mark: '#24262a', code: 'SW', serial: ['AF 90', '777'], stripe: '#1c2f5e', stripe2: '#d2a937', finTop: '#1c2f5e', heritage: true },
};

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'seymour', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const paintF = (c) => ({ color: c, rough: 0.68, metal: 0.04 });
  const seg = Math.max(24, Math.round(64 * detail / 4) * 4);

  // ---- atlas ------------------------------------------------------------------------------------------------------------
  const atlas = K.createAtlas({ size: atlasSize, base: paintF(SC.base) });
  const cFus = atlas.chart('fus', { type: 'unwrap', z: [-11.95, 6.4], girth: 6.4, vScale: 0.85, strips: 2, density: 1.15 });
  const NSPLIT = 0.6;
  const cNac = { R: atlas.chart('nacR', { type: 'unwrap', z: [-5.8, 2 * NSPLIT + 5.8], girth: 4.6, vScale: 0.8, strips: 2 }), L: atlas.chart('nacL', { type: 'unwrap', z: [-5.8, 2 * NSPLIT + 5.8], girth: 4.6, vScale: 0.8, strips: 2 }) };
  const cCft = atlas.chart('cft', { type: 'unwrap', z: [-3.75, 3.75], girth: 2.4, vScale: 0.8, density: 0.8 });
  const cWT = { R: atlas.chart('wingTopR', { type: 'plan', x: [1.5, 6.6], z: [-2.9, 3.6], view: 'top' }), L: atlas.chart('wingTopL', { type: 'plan', x: [-6.6, -1.5], z: [-2.9, 3.6], view: 'top' }) };
  const cWB = atlas.chart('wingBot', { type: 'plan', x: [1.5, 6.6], z: [-2.9, 3.6], view: 'bottom', mirror: true, density: 0.7 });
  const cST = atlas.chart('stabTop', { type: 'plan', x: [1.85, 4.4], z: [3.6, 7.35], view: 'top', mirror: true, density: 0.85 });
  const cSB = atlas.chart('stabBot', { type: 'plan', x: [1.85, 4.4], z: [3.6, 7.35], view: 'bottom', mirror: true, density: 0.6 });
  const cFin = { L: atlas.chart('finLV', { type: 'side', z: [1.7, 6.75], y: [0.45, 3.85], view: 'left' }), R: atlas.chart('finRV', { type: 'side', z: [1.7, 6.75], y: [0.45, 3.85], view: 'right' }) };
  const cPanel = atlas.chart('panel', { type: 'rect', w: 0.9, h: 0.9, density: 2.2 });
  const cNoz = atlas.chart('nozzle', { type: 'rect', w: 3.8, h: 0.95, density: 0.7 });
  atlas.pack();
  const U = {
    under: atlas.swatch('under', paintF(SC.under)), mid: atlas.swatch('mid', paintF(SC.base)), dark: atlas.swatch('dark', F.darkGrey), black: atlas.swatch('black', F.black),
    duct: atlas.swatch('duct', F.gloss('#dfe0dc')), exhaust: atlas.swatch('exhaust', F.exhaust), heat: atlas.swatch('heat', { color: '#7d756e', rough: 0.5, metal: 0.8 }),
    heat2: atlas.swatch('heat2', { color: '#4a4542', rough: 0.55, metal: 0.8 }), ti: atlas.swatch('ti', F.titanium), well: atlas.swatch('well', F.gearWhite),
    interior: atlas.swatch('interior', F.interior), console: atlas.swatch('console', { color: '#1d1f21', rough: 0.6, metal: 0 }),
    seat: atlas.swatch('seat', { color: '#25282a', rough: 0.7, metal: 0 }), cushion: atlas.swatch('cushion', F.fabric), accent: atlas.swatch('accent', { color: '#d6b21e', rough: 0.5, metal: 0 }),
    suit: atlas.swatch('suit', { color: '#4d5540', rough: 0.9, metal: 0 }), helmet: atlas.swatch('helmet', { color: '#8d9296', rough: 0.35, metal: 0 }), visor: atlas.swatch('visor', { color: '#0a0b0d', rough: 0.05, metal: 0.4 }),
    glove: atlas.swatch('glove', { color: '#3a3d33', rough: 0.9, metal: 0 }), frame: atlas.swatch('frame', paintF('#3f4347')), steel: atlas.swatch('steel', F.steel),
    aim: atlas.swatch('aim', F.semigloss('#c9cccd')), aimNose: atlas.swatch('aimNose', { color: '#1c1e20', rough: 0.15, metal: 0.3 }), lens: atlas.swatch('lens', F.lens),
    pylon: atlas.swatch('pylon', paintF(SC.under)), tank: atlas.swatch('tank', paintF('#5a5f64')), pod: atlas.swatch('pod', paintF('#5d6266')),
    podWin: atlas.swatch('podWin', { color: '#2a2418', rough: 0.05, metal: 0.6 }), bomb: atlas.swatch('bomb', paintF('#5b5e45')), bombNose: atlas.swatch('bombNose', { color: '#4a4c45', rough: 0.4, metal: 0.4 }),
    probe: atlas.swatch('probe', F.bareMetal), nacAft: atlas.swatch('nacAft', { color: '#5f5a55', rough: 0.5, metal: 0.65 }), rampW: atlas.swatch('rampW', F.gloss('#d4d5d1')),
  };

  const rig = K.createRig(ctx, { geometry: G, name: 'f15', glassLayer: opts.glassLayer, cockpitRadius: 1.2 });
  rig.material('paint', null);
  const stat = new K.Mesh();

  // ---- centre fuselage: nose, cockpit, upper deck over the intakes, belly, aft centre body between the engines ------------
  //   z       yW     w      top    bot    kTop  kBot      (yW = height of the widest point; top / bot absolute heights)
  const FSR = [
    [-11.95, 0.200, 0.000, 0.200, 0.200],
    [-11.88, 0.195, 0.075, 0.270, 0.120],
    [-11.60, 0.185, 0.195, 0.395, -0.025],
    [-10.95, 0.165, 0.355, 0.560, -0.180],
    [-10.00, 0.150, 0.490, 0.705, -0.330],
    [-9.05, 0.150, 0.570, 0.815, -0.430],
    [-8.25, 0.170, 0.605, 0.925, -0.500, 0.56, 0.62],
    [-7.20, 0.210, 0.610, 0.975, -0.545, 0.56, 0.72],
    [-6.20, 0.250, 0.585, 1.000, -0.570, 0.56, 0.78],
    [-5.40, 0.300, 0.560, 1.000, -0.585, 0.58, 0.82],
    [-4.80, 0.480, 0.580, 0.985, -0.600, 0.62, 0.86],
    [-4.20, 0.760, 1.040, 0.950, -0.605, 0.78, 0.9],
    [-3.40, 0.740, 1.480, 0.890, -0.605, 0.82, 0.9],
    [-2.00, 0.730, 1.520, 0.870, -0.605, 0.84, 0.9],
    [2.40, 0.720, 1.500, 0.855, -0.600, 0.84, 0.9],
    [3.40, 0.690, 1.360, 0.835, -0.560, 0.8, 0.88],
    [4.40, 0.600, 0.900, 0.780, -0.450, 0.75, 0.82],
    [5.20, 0.480, 0.560, 0.700, -0.320, 0.7, 0.75],
    [6.00, 0.450, 0.300, 0.590, -0.050, 0.65, 0.7],
    [6.40, 0.440, 0.120, 0.520, 0.250, 0.6, 0.6],
  ];
  const FS = FSR.map(r => ({ z: r[0], y: r[1], w: r[2], top: Math.max(0, r[3] - r[1]), bot: Math.max(0, r[1] - r[4]), kTop: r[5] ?? 0.5523, kBot: r[6] ?? 0.5523 }));
  const fus0 = K.loft({ stations: FS, segments: seg, step: 0.4 });
  const KF = fus0.K;
  const T_SILL = Math.round(fus0.tAtY(-6.6, 0.74) * KF) / KF;
  let jSB = KF / 2; while (jSB > 0 && fus0.at(-1.0, jSB / KF).p[0] < 0.6) jSB--;
  const T_SB = jSB / KF;
  const Z_CK = [-8.3, -4.35], Z_SB = [-2.1, 0.35];
  const fus = K.loft({
    stations: FS, segments: seg, step: 0.12 / detail, chart: cFus, capEnd: 'flat', capUV: U.mid,
    cutouts: [
      { name: 'cockpit', z: Z_CK, t: [T_SILL, 1 - T_SILL] },
      { name: 'sb', z: Z_SB, t: [T_SB, 1 - T_SB] },
      { name: 'ng', z: [-6.4, -4.62], t: [0, 0.07], mirror: true },
    ],
  });
  cFus.body = fus;
  stat.add(fus.mesh);

  // ---- intake / duct / engine nacelle (one fold-over skin per side), raked lip -------------------------------------------
  const RAKE = 0.32, ZLIP = -5.72;
  const nacStations = (sx) => {
    const S = (z, x, y, w, top, bot, k, extra) => ({ z, x: sx * x, y, w, top, bot, kTop: k, kBot: k, ...extra });
    return [
      S(-3.40, 1.12, 0.04, 0.38, 0.50, 0.50, 0.8),
      S(-5.62, 1.12, 0.04, 0.455, 0.615, 0.615, 0.94, { hard: true }),
      S(-5.69, 1.12, 0.04, 0.472, 0.632, 0.632, 0.93),
      S(-5.72, 1.12, 0.04, 0.492, 0.652, 0.652, 0.93),
      S(-5.69, 1.12, 0.04, 0.512, 0.672, 0.672, 0.93),
      S(-5.60, 1.12, 0.04, 0.520, 0.684, 0.684, 0.93),
      S(-5.10, 1.12, 0.04, 0.522, 0.690, 0.680, 0.93),
      S(-1.00, 1.12, 0.045, 0.522, 0.690, 0.685, 0.93),
      S(1.50, 1.10, 0.07, 0.525, 0.660, 0.660, 0.86),
      S(3.40, 1.04, 0.15, 0.560, 0.600, 0.610, 0.7),
      S(5.00, 1.00, 0.20, 0.630, 0.630, 0.630, 0.56),
      S(6.32, 1.00, 0.20, 0.612, 0.612, 0.612, 0.5523),
    ];
  };
  const nac = {}, nacPatch = {};
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const ch = cNac[key];
    const nopt = { stations: nacStations(sx), segments: Math.max(24, Math.round(48 * detail / 4) * 4), step: 0.14 / detail };
    const l = K.loft({ ...nopt, zRange: [-6, NSPLIT], capStart: 'flat', capUV: U.black,
      uvFn: (x, y, z, t, ring) => (ring.run === 0 ? U.duct : ch.uvUnwrap(z, t, 0)),
      cutouts: [{ name: 'mlg', z: [-1.02, NSPLIT], t: [0, 0.1], mirror: true }],
    });
    const l2 = K.loft({ ...nopt, zRange: [NSPLIT, 6.4], uvFn: (x, y, z, t) => ch.uvUnwrap(z, t, 1) });
    stat.add(l2.mesh);
    for (const m of [l.mesh, ...Object.values(l.patches)]) {
      for (let i = 0; i < m.p.length; i += 3) { const z = m.p[i + 2], f = Math.min(1, Math.max(0, (-4.3 - z) / 1.3)); m.p[i + 2] = z - (m.p[i + 1] - 0.04) * RAKE * f; }
    }
    ch.body = l; nac[key] = l;
    stat.add(l.mesh);
    nacPatch[key] = K.merge(l.patches.mlgR, l.patches.mlgL);
    stat.add(K.well(nacPatch[key], 0.36, U.well, [0, 1, 0]));
    // splitter / bleed plate along the inner lip, and the boundary-layer gap closure behind it
    const xi = sx * 0.585;
    stat.add(K.prism([[ZLIP - 0.02 - 0.65 * RAKE, 0.69], [ZLIP + 0.2, 0.69], [-4.4, 0.66], [-4.4, -0.56], [ZLIP + 0.2, -0.6], [ZLIP + 0.02 + 0.62 * RAKE, -0.6]], xi - 0.012, xi + 0.012, U.under));
  }

  // ---- conformal fuel tanks ---------------------------------------------------------------------------------------------
  const cftSt = (sx) => [[-3.72, 0, 0, 0], [-3.5, 0.08, 0.2, 0.18], [-3.0, 0.16, 0.38, 0.36], [-2.2, 0.2, 0.44, 0.43], [2.1, 0.2, 0.44, 0.43], [2.9, 0.16, 0.38, 0.37], [3.5, 0.07, 0.2, 0.2], [3.72, 0, 0, 0]]
    .map(([z, w, top, bot]) => ({ z, x: sx * 1.74, y: -0.02, w, top, bot, kTop: 0.72, kBot: 0.8 }));
  const cft = {};
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    cft[key] = K.loft({ stations: cftSt(sx), segments: Math.max(20, Math.round(32 * detail / 4) * 4), step: 0.2 / detail, chart: cCft });
    stat.add(cft[key].mesh);
  }
  cCft.body = cft.R;

  // ---- tail booms (carry the fins and stabilators) -------------------------------------------------------------------------
  for (const sx of [1, -1]) {
    stat.add(K.loft({
      stations: [[2.0, 0.28, 0.02, 0.05, 0.05], [2.8, 0.28, 0.11, 0.26, 0.2], [4.0, 0.28, 0.13, 0.3, 0.26], [5.6, 0.27, 0.13, 0.3, 0.26], [6.7, 0.26, 0.1, 0.22, 0.18], [7.28, 0.26, 0.045, 0.08, 0.07], [7.42, 0.26, 0.0, 0.0, 0.0]]
        .map(([z, y, w, top, bot]) => ({ z, x: sx * 1.75, y, w, top, bot, kTop: 0.7, kBot: 0.65 })),
      segments: 16, step: 0.3, uv: U.mid,
    }).mesh);
  }

  // ---- canopy ----------------------------------------------------------------------------------------------------------
  const canTop = K.pchip([-8.3, -8.1, -7.85, -7.6, -7.25, -6.85, -6.3, -5.8, -5.3, -4.8, -4.35], [0.93, 1.13, 1.34, 1.49, 1.585, 1.625, 1.635, 1.6, 1.46, 1.2, 0.99]);
  const canZ = [-8.3, -8.2, -8.05, -7.85, -7.6, -7.3, -6.95, -6.6, -6.2, -5.8, -5.4, -5.0, -4.65, -4.35];
  const canSt = canZ.map(z => { const s = fus.at(z, T_SILL).p; return { z, y: s[1], w: s[0], top: Math.max(0.002, canTop(z) - s[1]), bot: 0.01, kTop: [0.74, 0.6] }; });
  const cseg = Math.max(16, Math.round(36 * detail / 4) * 4), ct = 1 / cseg;
  const canLoft = (zr, tr, inflate, uv) => K.loft({ stations: canSt, segments: cseg, step: 0.1, tRange: tr, zRange: zr, inflate, uv }).mesh;
  const ZW = -7.6;
  const glassFixed = canLoft([-8.3, ZW], [0.25, 0.75], 0, [0, 0]);
  const glassMove = canLoft([ZW, -4.35], [0.25, 0.75], 0, [0, 0]);
  stat.add(canLoft([-8.3, ZW], [0.25, 0.25 + ct], 0.005, U.frame)).add(canLoft([-8.3, ZW], [0.75 - ct, 0.75], 0.005, U.frame));
  stat.add(canLoft([ZW - 0.07, ZW], [0.25, 0.75], 0.007, U.frame)).add(canLoft([-8.3, -8.24], [0.25, 0.75], 0.004, U.frame));
  const frameMove = K.merge(
    canLoft([ZW, -4.35], [0.25, 0.25 + ct * 0.8], 0.004, U.frame), canLoft([ZW, -4.35], [0.75 - ct * 0.8, 0.75], 0.004, U.frame),
    canLoft([ZW, ZW + 0.05], [0.25, 0.75], 0.006, U.frame), canLoft([-6.66, -6.6], [0.25, 0.75], 0.005, U.frame), canLoft([-4.5, -4.35], [0.25, 0.75], 0.005, U.frame));

  // ---- cockpit (tandem) ---------------------------------------------------------------------------------------------------
  const eye = G.pilotEye, eye2 = [0, 1.2, -6.15];
  const tubX = 0.5;
  stat.add(K.tub({ x: tubX, y0: -0.05, y1: 0.7, z0: -8.2, z1: -4.45, uv: U.interior, taper: 0.85 }));
  {  // sill ledge closing the gap between the skin cut-out and the tub
    const zs = []; for (let z = Z_CK[0]; z <= Z_CK[1] - 0.001; z += 0.2) zs.push(z); zs.push(Z_CK[1]);
    for (const sx of [1, -1]) {
      let prev = null;
      for (const z of zs) {
        const o = fus.at(z, sx > 0 ? T_SILL : 1 - T_SILL).p, a = stat.vert(o[0], o[1], z, -sx * 0.6, 0.8, 0, U.frame[0], U.frame[1]), b = stat.vert(sx * tubX * 0.9, 0.68, z, -sx * 0.6, 0.8, 0, U.frame[0], U.frame[1]);
        if (prev) { if (sx > 0) stat.quad(prev[0], a, b, prev[1]); else stat.quad(prev[0], prev[1], b, a); }
        prev = [a, b];
      }
    }
  }
  const glare = (z0, z1, y0, y1, hw) => { const gs = K.prism([[z0, y0], [z0, y1], [z1 - 0.05, y1 + 0.03], [z1, y1], [z1, y0]], -hw, hw, U.black); for (let i = 0; i < gs.p.length; i += 3) gs.p[i] *= 0.55 + 0.45 * Math.min(1, (gs.p[i + 2] - z0) / (z1 - z0)); return gs; };
  stat.add(glare(-8.12, -7.66, 0.7, 0.79, 0.4));
  stat.add(glare(-6.98, -6.66, 0.9, 0.99, 0.34));
  const panelQuad = (z, y0, y1, hw, b0, b1) => { const i0 = stat.vertexCount; for (const [x, y, b] of [[-hw, y0, b1], [hw, y0, b1], [hw, y1, b0], [-hw, y1, b0]]) { const uv = cPanel.uv(x + 0.45, b); stat.vert(x, y, z, 0, 0.2, 1, uv[0], uv[1]); } stat.quad(i0, i0 + 1, i0 + 2, i0 + 3); };
  panelQuad(-7.75, 0.38, 0.79, 0.42, 0.0, 0.42);           // front panel (top half of the chart)
  panelQuad(-6.71, 0.6, 1.0, 0.36, 0.48, 0.88);           // rear panel (bottom half)
  stat.add(K.box(0.22, 0.3, 0.45, U.console).translate(0, 0.17, -7.5));
  for (const [z0, z1, y] of [[-7.7, -6.6, 0.55], [-6.6, -4.9, 0.62]]) for (const sx of [-1, 1]) stat.add(K.box(0.14, 0.1, z1 - z0, U.console).translate(sx * 0.37, y, (z0 + z1) / 2));
  stat.add(K.stick({ base: [0, 0.3, -7.45], height: 0.32, uv: U.black, uvGrip: U.dark }));
  stat.add(K.box(0.07, 0.07, 0.12, U.dark).translate(-0.36, 0.63, -7.25));
  stat.add(K.stick({ base: [0.33, 0.66, -6.35], height: 0.14, uv: U.black, uvGrip: U.dark }));     // WSO hand controllers
  stat.add(K.stick({ base: [-0.33, 0.66, -6.35], height: 0.14, uv: U.black, uvGrip: U.dark }));
  stat.add(K.ejectionSeat({ eye, recline: 16, uv: { frame: U.seat, cushion: U.cushion, accent: U.accent } }));
  stat.add(K.ejectionSeat({ eye: eye2, recline: 16, uv: { frame: U.seat, cushion: U.cushion, accent: U.accent } }));
  const hudParts = K.hud({ eye, dist: 0.6, width: 0.2, height: 0.17, drop: 0.04, uv: U.black });
  stat.add(hudParts.frame);
  const pilotUV = { suit: U.suit, helmet: U.helmet, visor: U.visor, dark: U.dark, glove: U.glove };
  const pilotMesh = K.pilot({ eye, recline: 14, stick: [0, -0.45, -0.3], throttle: [-0.36, -0.42, -0.1], uv: pilotUV });
  stat.add(K.pilot({ eye: eye2, recline: 14, stick: [0.33, -0.42, -0.18], throttle: [-0.33, -0.42, -0.18], uv: pilotUV }));

  // ---- wings -------------------------------------------------------------------------------------------------------------
  const zLE = (x) => -2.35 + (x - 1.55) * Math.tan(38.7 * DEG), zTE = (x) => 3.35 + (x - 1.55) * 0.024, wy = (x) => 0.5 - (x - 1.0) * Math.tan(1 * DEG);
  const XCUT = 5.85, XTIP = 6.52, TIPC = 1.2;
  const mkWing = (side) => K.wing({
    side, airfoil: K.naca6(0.05, 0.002), chordPts: Math.round(12 * detail), spanAxis: 'x', tip: 'flat',
    stations: [
      { x: 1.0, y: wy(1.0), z: zLE(1.0), chord: zTE(1.0) - zLE(1.0), tc: 0.066 },
      { x: XCUT, y: wy(XCUT), z: zLE(XCUT), chord: zTE(XCUT) - zLE(XCUT), tc: 0.035, twist: -1.5, hard: true },
      { x: XTIP, y: wy(XTIP), z: zTE(XTIP) - TIPC, chord: TIPC, tc: 0.03, twist: -1.5 },
    ],
    lines: { hinge: [[1.6, 0.8], [XCUT, 0.68], [XTIP, 0.5]] },
    controls: [
      { name: 'flap', type: 'flap', span: [1.68, 3.25], from: 'hinge', nose: 1 },
      { name: 'aileron', type: 'flap', span: [3.32, 5.75], from: 'hinge', nose: 1 },
    ],
    charts: { upper: side > 0 ? cWT.R : cWT.L, lower: cWB },
  });
  const W = { R: mkWing(1), L: mkWing(-1) };
  stat.add(W.R.mesh).add(W.L.mesh);

  // ---- stabilators (all-moving, inboard dogtooth) --------------------------------------------------------------------------
  const sty = (x) => 0.03 - (x - 1.95) * Math.tan(3 * DEG), STE = 7.2, XDT = 2.75;
  const mkStab = (side) => K.wing({
    side, airfoil: K.biconvex(0.045), chordPts: Math.round(9 * detail), spanAxis: 'x', tip: 'flat', root: 'flat',
    stations: [
      { x: 1.95, y: sty(1.95), z: 3.78, chord: STE - 3.78, tc: 0.05 },
      { x: XDT, y: sty(XDT), z: 4.5, chord: STE - 4.5, tc: 0.048 },
      { x: XDT + 0.025, y: sty(XDT + 0.025), z: 4.3, chord: STE - 4.3, tc: 0.048, hard: true },
      { x: 4.3, y: sty(4.3), z: 6.0, chord: STE - 6.0, tc: 0.035 },
    ],
    charts: { upper: cST, lower: cSB },
  });
  const stab = { R: mkStab(1), L: mkStab(-1) };

  // ---- fins -----------------------------------------------------------------------------------------------------------------
  const FX = 1.68, FIN = { y0: 0.5, z0: 1.79, c0: 4.68, y1: 3.78, z1: 4.35, c1: 1.75 };
  const mkFin = (sx) => K.wing({
    airfoil: K.biconvex(0.045), chordPts: Math.round(10 * detail), spanAxis: 'y', tip: 'flat',
    stations: [{ x: sx * FX, y: FIN.y0, z: FIN.z0, chord: FIN.c0, tc: 0.045 }, { x: sx * FX, y: FIN.y1, z: FIN.z1, chord: FIN.c1, tc: 0.03 }],
    lines: { hinge: [[0.9, 0.72], [3.78, 0.66]] },
    controls: [{ name: 'rudder', type: 'flap', span: [0.98, 2.75], from: 'hinge', nose: 1 }],
    charts: { upper: cFin.L, lower: cFin.R },
  });
  const fins = { R: mkFin(1), L: mkFin(-1) };
  stat.add(fins.R.mesh).add(fins.L.mesh);
  for (const sx of [1, -1]) {   // fin-tip pods (ECM / RWR antenna fairings) and the root fairing on the boom
    stat.add(K.lathe([[0, 5.3], [0.05, 5.36], [0.09, 5.52], [0.1, 5.8], [0.1, 6.45], [0.08, 6.72], [0, 6.8]], { segments: 12, uv: U.mid }).translate(sx * FX, 3.66, 0));
    stat.add(K.lathe([[0, 6.0], [0.05, 6.2], [0.06, 6.45], [0.03, 6.75], [0, 6.8]], { segments: 8, uv: U.dark }).translate(sx * FX, 1.15, 0));
  }

  // ---- nozzles (featherless F100 C-D nozzles with exposed actuators), afterburner, jet pipe -------------------------------------
  const nozzles = [], glows = [];
  for (const [i, sx] of [[0, -1], [1, 1]]) {
    const c = [sx * 1.0, 0.2, 0];
    nozzles.push(K.petalNozzle({ z0: 6.3, z1: 7.25, r0: 0.6, rClosed: 0.43, rOpen: 0.555, petals: 16, centre: c, uvOuter: U.heat, uvInner: U.heat2, thickness: 0.03, chart: cNoz }));
    stat.add(K.lathe([[0.62, 6.25], [0.625, 6.33, 1], [0.6, 6.42, 1], [0.6, 6.25]], { segments: 28, uv: U.nacAft }).translate(c[0], c[1], 0));      // sync ring
    stat.add(K.lathe([[0.58, 6.3], [0.52, 5.6], [0.52, 5.1], [0, 5.1]], { segments: 24, uv: U.exhaust }).translate(c[0], c[1], 0));             // jet pipe + turbine face
    for (let k = 0; k < 8; k++) {  // exposed nozzle actuators
      const a = (k + 0.5) / 8 * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
      stat.add(K.tube([c[0] + cs * 0.6, c[1] + sn * 0.6, 6.3], [c[0] + cs * 0.565, c[1] + sn * 0.565, 6.78], 0.028, 0.022, { segments: 6, uv: U.steel }));
    }
    for (let k = 0; k < 10; k++) stat.add(K.box(0.025, 0.46, 0.05, U.heat2).translate(0, 0.23, 0).rotateZ(k * Math.PI / 5).translate(c[0], c[1], 5.3));
    glows.push(K.afterburnerGlow({ zDeep: 5.32, zExit: 7.0, rDeep: 0.5, rExit: 0.42, centre: c }));
  }

  // ---- intake ramps (first ramp panel at the top of each duct, schedules a few degrees with AoA) -------------------------------
  const ramps = [];
  for (const sx of [1, -1]) {
    const z0 = ZLIP - 0.62 * RAKE + 0.12, z1 = z0 + 1.15;
    const m = K.prism([[z0, 0.645], [z1, 0.645], [z1, 0.6], [z0 + 0.2, 0.625]], sx * 1.12 - 0.44, sx * 1.12 + 0.44, U.rampW);
    ramps.push({ m, a: [sx * 1.12 - 0.44, 0.645, z0], b: [sx * 1.12 + 0.44, 0.645, z0], ref: [sx * 1.12, 0.62, z1] });
  }

  // ---- speedbrake (large dorsal panel behind the canopy, hinged at its front edge) ----------------------------------------------
  const P = fus.patches;
  const sbMesh = K.thicken(P.sb, 0.03, U.well);
  stat.add(K.well(P.sb, 0.12, U.well, [0, -1, 0]));
  const sbEdge = fus.edges.sb.zLo;

  // ---- landing gear wells ---------------------------------------------------------------------------------------------------
  const ngPatch = K.merge(P.ngR, P.ngL);
  stat.add(K.well(ngPatch, 0.42, U.well, [0, 1, 0]));

  // ---- stores: LANTIRN pods, wing pylons with tanks and AAMs, CFT stub pylons with bombs, probes, antennas --------------------
  {
    const yb = -0.64;
    // AN/AAQ-13 navigation pod (right) and AN/AAQ-14 targeting pod (left) on the intake chin stations
    for (const [sx, len, r, z0] of [[1, 1.99, 0.165, -5.85], [-1, 2.5, 0.19, -6.2]]) {
      const x = sx * 1.12, y = yb - 0.32;
      stat.add(K.prism([[z0 + 0.45, yb + 0.02], [z0 + len - 0.35, yb + 0.02], [z0 + len - 0.5, y + r - 0.02], [z0 + 0.6, y + r - 0.02]], x - 0.04, x + 0.04, U.pylon));
      stat.add(K.lathe([[0, z0 + 0.06], [r * 0.7, z0 + 0.08], [r * 0.95, z0 + 0.18], [r, z0 + 0.35], [r, z0 + len - 0.35], [r * 0.7, z0 + len - 0.08], [0, z0 + len]], { segments: 18, uv: U.pod }).translate(x, y, 0));
      if (sx > 0) {   // FLIR window + terrain-following radar fairing under the nose
        stat.add(K.box(0.2, 0.17, 0.04, U.podWin).translate(x, y + 0.04, z0 + 0.08));
        stat.add(K.ellipsoid(0.14, 0.1, 0.32, { segments: 12, rings: 6, uv: U.pod }).translate(x, y - 0.13, z0 + 0.5));
      } else {        // rotating sensor head
        stat.add(K.ellipsoid(r * 0.98, r * 0.98, 0.22, { segments: 16, rings: 8, uv: U.pod, z0: -1, z1: 0 }).translate(x, y, z0 + 0.3));
        stat.add(K.box(0.16, 0.13, 0.05, U.podWin).translate(x, y - 0.03, z0 + 0.1));
      }
    }
    // inboard wing pylons (station 2 / 8): 610-gal tank, AIM-120 inboard, AIM-9X outboard
    for (const sx of [1, -1]) {
      const xp = 2.95, wl = W.R.at(xp, 0.45, 'lower'), zf = zLE(xp) + 0.5, x = sx * xp, yt = wl[1] - 0.38;
      stat.add(K.pylon([{ y: yt, z0: zf + 0.35, z1: zf + 2.6, x, tc: 0.07 }, { y: wl[1] + 0.06, z0: zf, z1: zf + 2.9, x, tc: 0.07 }], { uv: U.pylon }));
      stat.add(K.tank({ length: 5.3, radius: 0.32, uv: U.tank, fins: 0 }).translate(x, yt - 0.33, zf - 1.0));
      for (const [d, isAim9] of [[-0.27, false], [0.27, true]]) {
        const rx = x + sx * d, ry = yt + 0.2;
        stat.add(K.launchRail({ x: rx, y: ry + 0.06, z0: zf + 0.15, z1: zf + 2.6, w: 0.06, h: 0.08, uv: U.pylon }));
        const msl = isAim9
          ? K.missile({ length: 3.02, radius: 0.064, canards: { z: 0.25, chord: 0.08, span: 0.035 }, wings: { z: 2.55, chord: 0.36, span: 0.12 }, uvBody: U.aim, uvNose: U.aimNose, uvFin: U.aim })
          : K.missile({ length: 3.66, radius: 0.089, canards: { z: 1.35, chord: 0.3, span: 0.13 }, wings: { z: 3.2, chord: 0.36, span: 0.16 }, uvBody: U.aim, uvNose: U.aim, uvFin: U.aim });
        stat.add(msl.translate(rx, ry - 0.05, zf - 0.25));
      }
    }
    // CFT tangential stub pylons (two rows) and GBU-12s on the lower-outboard row
    for (const sx of [1, -1]) {
      for (const z of [-2.4, -0.9, 0.6, 2.0]) {
        for (const [tt, dy] of [[0.17, 0], [0.06, 0]]) {
          const q = cft.R.at(z, tt).p, x = sx * q[0];
          stat.add(K.box(0.07, 0.07, 0.42, U.pylon).translate(x, q[1] - 0.025 + dy, z));
        }
      }
      for (const z0 of [-3.1, 0.35]) {
        const q = cft.R.at(z0 + 1.5, 0.17).p;
        stat.add(K.missile({ length: 3.27, radius: 0.136, canards: { z: 0.28, chord: 0.22, span: 0.09 }, wings: { z: 2.68, chord: 0.55, span: 0.27 }, uvBody: U.bomb, uvNose: U.bombNose, uvFin: U.bomb, roll: 45 })
          .translate(sx * q[0], q[1] - 0.2, z0));
      }
    }
    // pitot / AoA probes, antennas
    for (const sx of [1, -1]) {
      const p = fus.at(-9.6, sx > 0 ? 0.3 : 0.7).p; stat.add(K.probe(p, [p[0] + sx * 0.12, p[1] + 0.01, p[2] - 0.35], 0.014, U.probe));
      const q = fus.at(-8.9, sx > 0 ? 0.22 : 0.78).p; stat.add(K.probe(q, [q[0] + sx * 0.08, q[1] - 0.01, q[2] - 0.18], 0.012, U.probe));
    }
    stat.add(K.bladeAntenna({ pos: [0, fus.topAt(1.4) - 0.02, 1.4], height: 0.18, chord: 0.28, sweep: 0.14, uv: U.mid }));
    stat.add(K.bladeAntenna({ pos: [0, fus.topAt(-3.7) - 0.02, -3.7], height: 0.16, chord: 0.22, sweep: 0.12, uv: U.mid }));
    stat.add(K.bladeAntenna({ pos: [0, fus.botAt(-2.6) + 0.02, -2.6], height: 0.17, chord: 0.24, sweep: 0.12, down: true, uv: U.under }));
    stat.add(K.bladeAntenna({ pos: [0, fus.botAt(-8.0) + 0.02, -8.0], height: 0.12, chord: 0.18, sweep: 0.08, down: true, uv: U.under }));
    // centreline pylon
    stat.add(K.prism([[-2.0, -0.6], [0.6, -0.6], [0.4, -0.78], [-1.6, -0.78]], -0.06, 0.06, U.pylon));
    // M61 gun fairing bump at the right wing root
    stat.add(K.ellipsoid(0.11, 0.08, 0.8, { segments: 10, rings: 6, uv: U.mid }).translate(1.62, 0.68, -2.05));
  }

  // ---- materials ----------------------------------------------------------------------------------------------------------
  lap('geometry');
  paint(atlas, { SC, fus, nac, W, fins, cFus, cNac, cCft, cWT, cWB, cST, cSB, cFin, cPanel, cNoz, paintF, T_SB, Z_SB, T_SILL, zLE, zTE });
  lap('paint');
  const mat = atlas.material(ctx, { envMapIntensity: 1 });
  lap('textures');
  rig.material('paint', mat, { shared: true });
  rig.disposables.push(atlas);
  rig.glass('canopy', K.glassMaterial(ctx, K.GLASS.gold));
  rig.glass('hud', K.glassMaterial(ctx, K.GLASS.hud));
  const glowMat = [rig.material('glowL', K.glowMaterial(), { shadow: false }), rig.material('glowR', K.glowMaterial(), { shadow: false })];

  rig.addStatic(stat, 'paint');
  rig.addStatic(glassFixed, 'canopy');
  rig.addStatic(hudParts.glass, 'hud');

  // ---- moving parts ------------------------------------------------------------------------------------------------------
  const CP = [0, 0.97, -4.38];
  const canopyNode = rig.node('canopy', { pivot: CP });
  rig.part('canopyGlass', glassMove, { parent: canopyNode, key: 'canopy' });
  rig.part('canopyFrame', frameMove, { parent: canopyNode });
  const setCanopy = rig.hinge(canopyNode, [-1, CP[1], CP[2]], [1, CP[1], CP[2]], { ref: [0, 1.5, -7.5], toward: [0, 1, 0] });
  const pilotNode = rig.part('pilot', pilotMesh, { pivot: eye });

  const ail = { R: rig.hingePart('aileronR', W.R.controls.aileron), L: rig.hingePart('aileronL', W.L.controls.aileron) };
  const flp = { R: rig.hingePart('flapR', W.R.controls.flap), L: rig.hingePart('flapL', W.L.controls.flap) };
  const rud = { R: rig.hingePart('rudderR', fins.R.controls.rudder, { toward: [1, 0, 0] }), L: rig.hingePart('rudderL', fins.L.controls.rudder, { toward: [1, 0, 0] }) };
  const ZP = 5.6;
  const mkStabPart = (name, s, sx) => {
    const a = [sx * 1.95, sty(1.95), ZP], b = [sx * 4.3, sty(4.3), ZP];
    const node = rig.part(name, s.mesh, { pivot: a });
    return rig.hinge(node, a, b, { ref: [sx * 3.0, sty(3.0), STE], toward: [0, 1, 0] });
  };
  const setStab = { R: mkStabPart('stabR', stab.R, 1), L: mkStabPart('stabL', stab.L, -1) };
  const sbNode = rig.part('speedbrake', sbMesh, { pivot: sbEdge[0] });
  const setSB = rig.hinge(sbNode, sbEdge[0], sbEdge[1], { ref: K.centroid(P.sb), toward: [0, 1, 0] });
  const nozNodes = nozzles.map((m, i) => rig.part('nozzle' + i, m, { pivot: [G.engines[i].nozzle[0], 0.2, 6.3] }));
  glows.forEach((m, i) => rig.part('abGlow' + i, m, { key: i === 0 ? 'glowL' : 'glowR' }));
  const setRamp = ramps.map((r, i) => { const n = rig.part('ramp' + i, r.m, { pivot: r.a }); return rig.hinge(n, r.a, r.b, { ref: r.ref, toward: [0, -1, 0] }); });
  const HP = [0, -0.36, 4.0];
  const hookNode = rig.part('hook', K.arrestorHook({ pivot: HP, length: 1.75, radius: 0.035, uv: U.steel }), { pivot: HP });
  const setHook = rig.hinge(hookNode, [-1, HP[1], HP[2]], [1, HP[1], HP[2]], { ref: [0, HP[1], HP[2] + 1.7], toward: [0, -1, 0] });

  // ---- landing gear --------------------------------------------------------------------------------------------------------
  const gp = G.gear;
  const doorOf = (patch, edge, inner = U.well) => ({ mesh: K.thicken(patch, 0.02, inner), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  K.buildGear(rig, atlas, {
    name: 'nose', index: 0, contact: gp[0].pos, wheelRadius: gp[0].wheelRadius, wheelWidth: 0.19, pivot: [0, -0.4, -4.74], stroke: 0.26, staticFrac: 0.3,
    strutR: 0.055, fork: 'fork', steer: true, links: 'front', retract: { to: [0, -0.4, -5.95] }, window: [0.22, 0.88],
    brace: [0, -0.45, -4.2],
    doors: [
      { name: 'noseDoorR', ...doorOf(P.ngR, fus.edges.ngR.tHi), open: 88, toward: [0, -1, 0] },
      { name: 'noseDoorL', ...doorOf(P.ngL, fus.edges.ngL.tLo), open: 88, toward: [0, -1, 0] },
    ],
    lamps: [{ kind: 'landing', pos: [0.1, -1.08, -4.86], size: 0.05, color: [1, 0.96, 0.88] }, { kind: 'taxi', pos: [-0.1, -1.08, -4.86], size: 0.045, color: [1, 0.96, 0.88] }],
  });
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, edge = nac[key].edges;
    K.buildGear(rig, atlas, {
      name: 'main' + key, index: i, contact: c, wheelRadius: gp[i].wheelRadius, wheelWidth: 0.25,
      pivot: [sx * 1.33, -0.42, 0.62], stroke: 0.3, staticFrac: 0.35, strutR: 0.07, fork: 'fork', links: 'rear',
      retract: { to: [sx * 1.12, -0.36, -0.6], twist: 90 }, window: [0.2, 0.9], brace: [sx * 1.2, -0.5, 1.15],
      doors: [{ name: 'mainDoor' + key, ...doorOf(nacPatch[key], sx > 0 ? edge.mlgL.tLo : edge.mlgR.tHi), open: 95, toward: [0, -1, 0] }],
    });
  }

  // ---- lamps ---------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.04, squash: [0.7, 0.7, 1.6] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.04, squash: [0.7, 0.7, 1.6] });
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.035 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.045 });
  rig.lamp('strobe', [-L.strobe[0], L.strobe[1], L.strobe[2]], { color: [1, 1, 1], size: 0.045 });
  rig.lamp('beacon', L.beacon, { color: [1, 0.1, 0.05], size: 0.05 });
  for (const sx of [1, -1]) rig.lamp('nav', [sx * 0.62, 0.32, -6.9], { color: sx > 0 ? [0.02, 1, 0.25] : [1, 0.04, 0.02], size: 0.03 });   // forward fuselage position lights

  // ---- animation -----------------------------------------------------------------------------------------------------------
  let rampAng = 0;
  rig.onUpdate((S, dt) => {
    const sf = S.sf;
    ail.R.set(sf.aileronR * 20 * DEG); ail.L.set(sf.aileronL * 20 * DEG);
    flp.R.set(-sf.flaps * 30 * DEG); flp.L.set(-sf.flaps * 30 * DEG);
    setStab.R(sf.elevatorR * 25 * DEG); setStab.L(sf.elevatorL * 25 * DEG);
    rud.R.set(sf.rudder * 25 * DEG); rud.L.set(sf.rudder * 25 * DEG);
    setSB(sf.speedbrake * 45 * DEG);
    for (let i = 0; i < 2; i++) { const e = S.eng[i] || S.eng[0]; nozNodes[i].morphTargetInfluences[0] = e.nozzle ?? 0; K.abGlowColor(glowMat[i].color, e, S.night); }
    const aoa = S.raw && Number.isFinite(S.raw.aoa) ? S.raw.aoa : 0, target = Math.max(-2, Math.min(9, aoa / DEG * 0.35)) * DEG;
    rampAng += (target - rampAng) * Math.min(1, (dt || 0) * 3);
    for (const s of setRamp) s(rampAng);
    setCanopy(sf.canopy * 32 * DEG);
    setHook(sf.hook * 50 * DEG);
    pilotNode.visible = !rig.cameraInCockpit;
  });
  const visual = rig.build();
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- paint -------------------------------------------------------------------------------------------------------------------
function paint(atlas, o) {
  const { SC, fus, nac, W, fins, cFus, cNac, cCft, cWT, cWB, cST, cSB, cFin, cPanel, cNoz, paintF, T_SB, Z_SB, T_SILL, zLE } = o, F = K.FINISH;
  const base = paintF(SC.base), under = paintF(SC.under), mark = SC.mark;
  const slime = { color: '#c9cf8f', rough: 0.35, metal: 0 };
  const rnd = (() => { let a = 4711; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const line = { px: 1, depth: 0.35, dark: 0.13 }, gap = { px: 2, depth: 0.8, dark: 0.5 };

  // ================= centre fuselage =================
  const P = atlas.pen(cFus);
  P.fill('all', base);
  P.band(-11.95, 6.4, -Infinity, (z) => (z < -8 ? 0.05 : -0.2), under, { feather: 4 });
  P.fill((g) => g.rect(-11.95, 0, 2.9, 1), F.semigloss(SC.radome));                                   // radome
  P.ring(-9.05, 0, 1, { px: 1.6, depth: 0.45, dark: 0.3 });
  const frames = [-8.25, -7.4, -4.9, -4.3, -3.6, -2.9, -2.1, -1.3, -0.5, 0.35, 1.2, 2.0, 2.8, 3.6, 4.4, 5.2, 5.9];
  for (const z of frames) P.ring(z, 0, 1, line);
  for (const y of [0.0, -0.35]) P.yLine(-9.0, -4.7, y, line);
  P.line([[-9.0, 0], [6.3, 0]], line);
  for (const s of [1, -1]) {
    const t = (v) => (s > 0 ? v : 1 - v);
    for (const tt of [0.42, 0.455]) P.line([[-4.3, t(tt)], [5.9, t(tt)]], line);
    // speedbrake outline
    P.line([[Z_SB[0], t(T_SB)], [Z_SB[1], t(T_SB)]], gap);
  }
  P.line([[Z_SB[0], T_SB], [Z_SB[0], 1 - T_SB]], gap); P.line([[Z_SB[1], T_SB], [Z_SB[1], 1 - T_SB]], gap);
  P.line([[Z_SB[0] + 0.1, 0.5], [Z_SB[1] - 0.1, 0.5]], { px: 1, depth: 0.25, dark: 0.08 });
  // access panels on the forward fuselage (avionics bays)
  const acc = [[-8.8, 0.05, 0.55, 0.42], [-8.15, 0.05, 0.6, 0.42], [-7.4, 0.0, 0.7, 0.45], [-6.6, 0.0, 0.65, 0.4], [-5.8, 0.15, 0.6, 0.38]];
  for (const [z, y, w, h] of acc) P.decalOn(z, y, 'both', { layers: ['height', 'color'] }, (g, layer) => { g.strokeStyle = layer === 'height' ? 'rgba(0,0,0,0.5)' : 'rgba(10,12,14,0.3)'; g.lineWidth = 0.008; g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, 0.03); g.stroke(); });
  for (const z of [-3.3, -1.2, 1.0, 3.0]) for (const s of [0.43, 0.57]) P.decalT(z, s, {}, (g) => { g.strokeStyle = 'rgba(10,12,14,0.35)'; g.lineWidth = 0.008; g.strokeRect(-0.3, -0.2, 0.6, 0.4); });
  // anti-glare panel ahead of the windscreen, refuelling receptacle door (left wing root / spine), walkway lines
  P.fill([[-9.4, 0.45], [-8.3, 0.4], [-8.3, 0.6], [-9.4, 0.55]], F.matte('#2f3236'));
  P.decalT(-2.8, 0.5 - 0.08, {}, (g) => { g.fillStyle = 'rgba(25,27,29,0.65)'; g.fillRect(-0.18, -0.12, 0.36, 0.24); g.strokeStyle = '#e8e8e2'; g.lineWidth = 0.01; g.strokeRect(-0.24, -0.18, 0.48, 0.36); });
  // markings
  P.textOn('RESCUE', -7.7, 0.45, 'both', 0.04, { color: mark });
  P.decalOn(-8.05, 0.45, 'both', (g) => { g.strokeStyle = mark; g.lineWidth = 0.012; g.beginPath(); g.moveTo(-0.1, 0); g.lineTo(0.07, 0); g.moveTo(0.02, -0.04); g.lineTo(0.08, 0); g.lineTo(0.02, 0.04); g.stroke(); });
  for (const s of [1, -1]) P.decalOn(-8.9, 0.2, s > 0 ? 'R' : 'L', { layers: ['color', 'orm'] }, (g, layer) => { g.fillStyle = layer === 'orm' ? 'rgb(255,90,0)' : slime.color; g.fillRect(-0.3, -0.03, 0.6, 0.06); });   // formation strip
  if (SC.heritage) {
    for (const s of [1, -1]) {
      const t = (v) => (s > 0 ? v : 1 - v);
      P.fill([[-10.5, t(0.3)], [-9.25, t(0.3)], [-9.05, t(0.34)], [-10.4, t(0.34)]], F.semigloss(SC.stripe2));
      P.fill([[-10.5, t(0.34)], [-9.05, t(0.34)], [-8.9, t(0.38)], [-10.4, t(0.38)]], F.semigloss(SC.stripe));
    }
    P.textOn('COL J. "KESTREL" MARSH', -6.0, 0.72, 'both', 0.055, { color: '#e2e2dc', weight: 700 });
  } else {
    P.textOn('CAPT R. VANCE', -6.05, 0.72, 'both', 0.05, { color: '#e2e2dc', weight: 700 });
  }
  // weathering
  P.noise({ alpha: 0.08, scale: 2.2, stretch: [1.6, 1], rough: 0.06 });
  P.noise({ alpha: 0.05, scale: 0.7, mode: 'light' });
  for (let i = 0; i < 20; i++) { const z = -4 + rnd() * 9, t = (rnd() < 0.5 ? 0.02 : 0.92) + rnd() * 0.06; P.streak(z, t, z + 0.6 + rnd(), t, 0.01 + rnd() * 0.012, { alpha: 0.1 + rnd() * 0.12 }); }
  P.fill((g) => g.rect(5.3, 0, 1.1, 1), { color: 'rgba(40,36,32,0.35)' });

  // ================= intake ducts / nacelles =================
  for (const key of ['R', 'L']) {
    const Q = atlas.pen(cNac[key]), side = key, body = nac[key];
    const outer = (v) => (key === 'R' ? v : 1 - v);      // t on the outboard side
    Q.fill('all', base);
    Q.band(-5.8, 6.35, -Infinity, -0.35, under, { feather: 4 });
    Q.fill((g) => g.rect(5.15, 0, 1.2, 1), F.semigloss('#5f5d5a'), { feather: 4 });                       // titanium aft nacelle
    Q.fill((g) => g.rect(5.5, 0, 0.85, 1), { color: '#4a4440', rough: 0.55, metal: 0.7 }, { alpha: 0.7, feather: 8 });
    for (const z of [-5.2, -4.4, -3.5, -2.6, -1.7, -0.8, 0.0, 0.9, 1.8, 2.7, 3.5, 4.3, 5.15, 5.9]) Q.ring(z, 0, 1, line);
    for (const y of [0.45, -0.25]) Q.yLine(-5.4, 4.0, y, line);
    Q.ring(-5.45, 0, 1, { px: 1.5, depth: 0.5, dark: 0.25 });
    // main gear door outline
    Q.line([[-1.02, 0.9], [-1.02, 1.0]], gap); Q.line([[-1.02, 0], [-1.02, 0.1], [0.6, 0.1], [0.6, 0]], gap); Q.line([[-1.02, 0.9], [0.6, 0.9], [0.6, 1.0]], gap);
    // markings: national insignia on the intake outer face, intake danger stencil, rescue/fuel stencils
    Q.decalOn(-3.7, 0.05, side === 'R' ? 'R' : 'L', (g) => K.drawStarBar(g, 0.62, { lowVis: '#2e3134' }));
    Q.decalOn(-5.25, 0.35, side, (g) => { g.fillStyle = '#a02a24'; g.beginPath(); g.moveTo(-0.09, 0.08); g.lineTo(0.09, 0.08); g.lineTo(0, -0.08); g.closePath(); g.fill(); });
    Q.textOn('DANGER', -4.9, 0.35, side, 0.045, { color: '#a02a24', weight: 700 });
    Q.textOn('NO STEP', -2.0, 0.62, side, 0.04, { color: mark });
    Q.decalOn(-1.5, -0.2, side, { layers: ['height', 'color'] }, (g, layer) => { g.strokeStyle = layer === 'height' ? 'rgba(0,0,0,0.5)' : 'rgba(10,12,14,0.3)'; g.lineWidth = 0.008; g.strokeRect(-0.3, -0.2, 0.6, 0.4); });
    Q.decalOn(2.4, 0.3, side, { layers: ['height', 'color'] }, (g, layer) => { g.strokeStyle = layer === 'height' ? 'rgba(0,0,0,0.5)' : 'rgba(10,12,14,0.3)'; g.lineWidth = 0.008; g.strokeRect(-0.5, -0.2, 1.0, 0.4); });
    // weathering: soot on the aft nacelles, grime under the intakes
    Q.noise({ alpha: 0.08, scale: 1.8, stretch: [1.6, 1], rough: 0.06 });
    for (let i = 0; i < 10; i++) { const t = rnd(); Q.streak(4.6 + rnd() * 0.6, t, 6.35, t, 0.05 + rnd() * 0.08, { alpha: 0.18 }); }
    for (let i = 0; i < 10; i++) { const z = -4.5 + rnd() * 8, t = outer(0.05 + rnd() * 0.12); Q.streak(z, t, z + 0.5 + rnd(), t, 0.01, { alpha: 0.12 }); }
    void body;
  }

  // ================= CFTs =================
  {
    const Q = atlas.pen(cCft);
    Q.fill('all', base);
    Q.band(-3.75, 3.75, -Infinity, -0.3, under, { feather: 4 });
    for (const z of [-2.9, -1.6, -0.2, 1.2, 2.5]) Q.ring(z, 0, 1, line);
    for (const tt of [0.12, 0.32, 0.68, 0.88]) Q.line([[-3.4, tt], [3.4, tt]], line);
    Q.decalT(-1.0, 0.36, {}, (g) => { g.strokeStyle = 'rgba(10,12,14,0.35)'; g.lineWidth = 0.008; g.strokeRect(-0.25, -0.1, 0.5, 0.2); });
    Q.noise({ alpha: 0.08, scale: 1.4, rough: 0.05 });
  }

  // ================= wings =================
  for (const key of ['R', 'L']) {
    const s = key === 'R' ? 1 : -1, wg = W.R;
    const at = (x, f) => { const p = wg.at(x, f); return [p[0], p[2]]; };
    for (const [chart, fin2, isTop] of [[cWT[key], base, true], ...(key === 'R' ? [[cWB, under, false]] : [])]) {
      const Q = atlas.pen(chart);
      Q.fill('all', fin2);
      const ln = (pts, op) => Q.line(pts.map(p => [p[0] * s, p[1]]), op);
      for (const f of [0.18, 0.4, 0.6]) ln([at(1.6, f), at(5.8, f)], line);
      for (const x of [2.3, 3.0, 3.6, 4.3, 5.0, 5.85]) ln([at(x, 0.02), at(x, 0.99)], line);
      const hz = (x) => wg.lines.hinge.at(wg.spanToU(x));
      for (const [a, b] of [[1.68, 3.25], [3.32, 5.75]]) ln([at(a, 1), at(a, hz(a)), at(b, hz(b)), at(b, 1)], gap);
      for (const f of [0.18, 0.4, 0.6]) { const a = at(1.7, f + 0.01), b = at(5.7, f + 0.01); Q.rivets(a[0] * s, a[1], b[0] * s, b[1], 0.035, { px: 1.2, depth: 0.16, dark: 0.04 }); }
      const le = [at(1.7, 0.006), at(5.8, 0.006)].map(p => [p[0] * s, p[1]]);
      Q.wear((g) => { g.moveTo(le[0][0], le[0][1]); g.lineTo(le[1][0], le[1][1]); }, 0.035, { color: '#7d8186', rough: 0.45, metal: 0.5 }, { alpha: 0.3 });
      Q.noise({ alpha: 0.09, scale: 1.2, stretch: [1, 2.5], rough: 0.06 });
      for (let i = 0; i < 9; i++) { const x = 1.8 + rnd() * 3.8, a = at(x, hz(x)); Q.streak(a[0] * s, a[1], a[0] * s, a[1] + 0.25 + rnd() * 0.3, 0.03, { alpha: 0.15 }); }
      if (isTop) {
        // walkway outlines at the wing root, NO STEP, insignia (top left), formation light
        const w0 = at(1.75, 0.15), w1 = at(1.75, 0.6), w2 = at(2.3, 0.6), w3 = at(2.3, 0.15);
        ln([w0, w1, w2, w3, w0], { px: 1.5, depth: 0.1, dark: 0.45 });
        const p = at(2.6, 0.35); Q.text('NO STEP', p[0] * s, p[1], 0.06, { color: mark, rot: s > 0 ? -90 : 90 });
        if (key === 'L') { const c = at(4.3, 0.35); Q.decal(c[0] * s, c[1], (g) => K.drawStarBar(g, 0.62, { lowVis: '#2e3134' })); }
        const fl = at(5.5, 0.25); Q.fill((g) => g.rect(fl[0] * s - 0.25, fl[1] - 0.03, 0.5, 0.06), slime);
      }
    }
  }
  // ================= stabilators =================
  for (const [chart, f, isTop] of [[cST, base, true], [cSB, under, false]]) {
    const Q = atlas.pen(chart); Q.fill('all', f);
    for (const zz of [4.8, 5.6, 6.4]) Q.line([[2.0, zz], [4.2, zz + (7.2 - zz) * 0.35]], line);
    for (const x of [2.75, 3.3, 3.85]) Q.line([[x, 3.6], [x, 7.3]], line);
    Q.noise({ alpha: 0.09, scale: 1.0, stretch: [1, 2], rough: 0.06 });
    if (isTop) Q.fill((g) => g.rect(3.6, 6.55, 0.5, 0.05), slime);
  }
  // ================= fins (same paint on both fins; L chart = faces seen from the left) =================
  for (const key of ['L', 'R']) {
    const Q = atlas.pen(cFin[key]); Q.fill('all', base);
    const fin = fins.R;
    const at = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    const hz = (y) => fin.lines.hinge.at(fin.spanToU(y));
    if (SC.heritage) {
      Q.fill([at(2.45, 0), at(3.78, 0), at(3.78, 1), at(2.45, 1)], F.semigloss(SC.stripe));
      Q.fill([at(2.33, 0), at(2.45, 0), at(2.45, 1), at(2.33, 1)], F.semigloss(SC.stripe2));
      for (let i = 0; i < 5; i++) { const c = at(2.75 + (i % 2) * 0.33, 0.25 + i * 0.12); Q.decal(c[0], c[1], (g) => { g.fillStyle = '#e8e6de'; star(g, 0.1); }); }
      const e = at(3.05, 0.62); Q.decal(e[0], e[1], (g) => { if (key === 'L') g.scale(-1, 1); eagle(g, 0.85, SC.stripe2); });
    } else {
      Q.fill([at(3.48, 0), at(3.72, 0), at(3.72, 1), at(3.48, 1)], F.semigloss(SC.stripe));
      if (SC.checker) { for (let i = 0; i < 16; i++) { const a = at(3.48, i / 16), b = at(3.6, (i + 1) / 16); if (i % 2) Q.fill((g) => g.rect(a[0], b[1], b[0] - a[0], 0.12), F.semigloss(SC.stripe2)); } }
      else Q.fill([at(3.44, 0), at(3.48, 0), at(3.48, 1), at(3.44, 1)], F.semigloss(SC.stripe2));
    }
    Q.line([at(0.98, 1), at(0.98, hz(0.98)), at(2.75, hz(2.75)), at(2.75, 1)], gap);
    for (const y of [1.0, 1.6, 2.2, 2.8, 3.35]) Q.line([at(y, 0.02), at(y, Math.min(0.98, hz(y)))], line);
    for (const f of [0.2, 0.45]) Q.line([at(0.8, f), at(3.7, f)], line);
    const c = at(2.05, 0.36), code = SC.heritage ? '#e8e6de' : mark;
    Q.text(SC.code, c[0], c[1], 0.55, { color: SC.heritage ? mark : code, weight: 700 });
    const d = at(1.3, 0.38);
    const fw = key === 'L' ? 1 : -1;     // reading direction along z on this face
    Q.text(SC.serial[0], d[0] - fw * 0.3, d[1] + 0.03, 0.09, { color: mark, weight: 700 });
    Q.text(SC.serial[1], d[0] + fw * 0.3, d[1], 0.24, { color: mark, weight: 700 });
    if (SC.heritage) { const h = at(3.32, 0.35); Q.text('SKYWARD', h[0], h[1] - 0.05, 0.09, { color: '#e8e6de', weight: 700 }); }
    const fl = at(2.6, 0.5); Q.fill((g) => g.rect(fl[0] - 0.3, fl[1] - 0.03, 0.6, 0.06), slime);
    Q.noise({ alpha: 0.08, scale: 1.2, stretch: [1, 1.5], rough: 0.05 });
  }
  // ================= nozzle petals (a = around, b = hinge → exit) =================
  {
    const Q = atlas.pen(cNoz), n = 16, w = 3.8 / n;
    Q.fill('all', { color: '#7f776f', rough: 0.5, metal: 0.8 });
    for (let i = 0; i < n; i++) {
      if (i % 2) Q.fill((g) => g.rect(i * w, 0, w, 0.95), { color: '#726a63', rough: 0.55, metal: 0.8 });
      Q.fill((g) => g.rect(i * w + w * 0.3, 0.05, w * 0.4, 0.85), { color: '#8c837a', rough: 0.45, metal: 0.8 }, { alpha: 0.5 });
      Q.line([[i * w, 0], [i * w, 0.95]], { px: 2, depth: 0.9, dark: 0.6 });
    }
    Q.fill((g) => g.rect(0, 0.6, 3.8, 0.35), { color: '#3f3632', rough: 0.6, metal: 0.8 }, { alpha: 0.5, feather: 6 });
    Q.noise({ alpha: 0.12, scale: 0.8, stretch: [1, 2] });
  }
  // ================= instrument panels (front: top half, rear: bottom half) =================
  {
    const Q = atlas.pen(cPanel); Q.fill('all', { color: '#17191b', rough: 0.6, metal: 0 });
    const scr = (a, b, w, h, col) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#050607', rough: 0.15, metal: 0 }); Q.fill((g) => g.rect(a + 0.008, b + 0.008, w - 0.016, h - 0.016), { color: col, rough: 0.12, metal: 0, emissive: col }); };
    scr(0.06, 0.15, 0.2, 0.2, '#0c2a14'); scr(0.64, 0.15, 0.2, 0.2, '#0c2a14'); scr(0.33, 0.2, 0.24, 0.2, '#14301c');      // front MFDs
    Q.fill((g) => g.rect(0.33, 0.03, 0.24, 0.13), { color: '#202326', rough: 0.5, metal: 0 }); scr(0.36, 0.05, 0.18, 0.05, '#2a3a12');   // UFC
    for (let i = 0; i < 4; i++) Q.fill((g) => { g.arc(0.12 + i * 0.22, 0.39, 0.025, 0, Math.PI * 2); }, { color: '#0b0c0d', rough: 0.2, metal: 0 });
    scr(0.04, 0.52, 0.19, 0.19, '#0c2a14'); scr(0.25, 0.5, 0.19, 0.19, '#2a2410'); scr(0.46, 0.5, 0.19, 0.19, '#0c2a14'); scr(0.67, 0.52, 0.19, 0.19, '#0c2a14');   // WSO MFDs
    scr(0.33, 0.73, 0.24, 0.12, '#0c1e2a');
  }
}

/** Five-pointed star centred on the origin. */
function star(g, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.4 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath(); g.fill();
}
/** Stylised eagle head in profile facing +x (invented heritage tail art). */
function eagle(g, s, gold) {
  const P = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s))); g.closePath(); g.fill(); };
  g.fillStyle = '#ecebe4';
  P([[-0.5, 0.35], [-0.35, 0.05], [-0.15, -0.18], [0.1, -0.28], [0.3, -0.25], [0.42, -0.15], [0.5, -0.05], [0.38, 0.0], [0.2, 0.02], [0.05, 0.12], [-0.1, 0.3], [-0.2, 0.42]]);
  g.fillStyle = gold;
  P([[0.3, -0.25], [0.48, -0.2], [0.6, -0.08], [0.58, 0.04], [0.5, -0.02], [0.42, -0.05], [0.38, 0.0], [0.5, -0.05], [0.42, -0.15]]);
  g.fillStyle = '#1a1c1f';
  g.beginPath(); g.arc(0.24 * s, -0.17 * s, 0.025 * s, 0, Math.PI * 2); g.fill();
  g.strokeStyle = gold; g.lineWidth = 0.02 * s;
  for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo((-0.45 + i * 0.12) * s, (0.38 - i * 0.04) * s); g.lineTo((-0.1 + i * 0.1) * s, (0.0 - i * 0.06) * s); g.stroke(); }
}
