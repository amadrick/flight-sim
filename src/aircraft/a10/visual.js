// Fairchild Republic A-10C Thunderbolt II — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (-1.65) when parked.
//
// Reference numbers (docs/aircraft/a10.md + photo proportions; z = d − 7.35 where d = distance aft of the gun muzzles):
//   length 16.26 m (muzzles −7.35 … tail cone / rudder TEs ≈ 8.95), span 17.53 m (drooped tips ±8.77), height 4.47 m (fin tips y 2.82)
//   fuselage: nose cap z −6.98 (GAU-8 barrels protrude 0.37 m ahead of it, cluster 0.07 m left of centre, low in the nose),
//     slab-sided "bathtub" forward fuselage, half-width 0.74, belly y −0.63 (≈ 1.0 m above the ground), cockpit sill y ≈ 0.92,
//     windscreen base z −4.95, bubble canopy peak y 1.66 at z −3.6, canopy aft end z −2.55, spine 1.05 … tail cone 0.7
//   wing: low, unswept, constant chord 3.1 m centre section to x ±2.95 (no dihedral), outer panels 7° dihedral, LE sweep 3°,
//     TE swept forward, tip chord 1.6 with a Hoerner drooped tip; LE root z −1.05; t/c 16.5 % → 11 %
//     inboard slats x 0.8 … 2.2, slotted flaps x 0.8 … 2.2 and 3.0 … 4.65 (28 % chord), split ailerons ("decelerons") x 4.75 … 8.15
//   main-gear pods: x ±2.5 under the centre section, z −2.25 … 1.8; wheels retract forward and stay half exposed
//   engines: TF34 pods, centres x ±1.45, y 1.3 (above the aft fuselage, on short canted pylons), highlight z 1.65,
//     fan exit z 4.4, core nozzle 5.1
//   tailplane: straight, span 5.5 (tips ±2.75), y 0.68, LE z 6.4, chord 1.85; twin fins at the tips, y 0.08 … 2.82, TE z ≈ 8.95
//   gear (geometry.js): nose [0.3, −1.65, −4.7] r 0.28 offset right, retracts forward; mains [±2.5, −1.65, 0.4] r 0.45
//   pilot eye [0, 1.3, −3.95]
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['ghost', 'shark', 'europe1'];

const SCHEMES = {
  ghost: { name: 'USAF two-tone Compass Ghost grey', top: '#5d6368', under: '#878e94', nose: '#5d6368', mark: '#2c3034', code: 'DM', serial: ['AF 81', '0962'], band: '#2c3034', band2: null, falseCanopy: true },
  shark: { name: '917th FS "Tigersharks" shark-mouth (invented unit)', top: '#5b6166', under: '#868d93', nose: '#5b6166', mark: '#26292c', code: 'TS', serial: ['AF 80', '0247'], band: '#1d3d7a', band2: '#e8e6de', falseCanopy: true, shark: true },
  europe1: { name: 'European One wraparound camouflage', top: '#3b4836', under: '#3b4836', nose: '#3b4836', mark: '#1a1c1a', code: 'WR', serial: ['AF 79', '0184'], band: '#8a2a22', band2: null, falseCanopy: false, camo: ['#3b4836', '#53604a', '#3e4245'] },
};

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'ghost', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const paintF = (c) => ({ color: c, rough: 0.72, metal: 0.03 });
  const seg = Math.max(24, Math.round(64 * detail / 4) * 4);

  // ---- atlas ------------------------------------------------------------------------------------------------------------
  const atlas = K.createAtlas({ size: atlasSize, base: paintF(SC.top) });
  const cFus = atlas.chart('fus', { type: 'unwrap', z: [-7.0, 8.95], girth: 5.5, vScale: 0.85, strips: 3, density: 1.1 });
  const cWT = { R: atlas.chart('wingTopR', { type: 'plan', x: [0.5, 8.85], z: [-1.12, 2.12], view: 'top' }), L: atlas.chart('wingTopL', { type: 'plan', x: [-8.85, -0.5], z: [-1.12, 2.12], view: 'top' }) };
  const cWB = atlas.chart('wingBot', { type: 'plan', x: [0.5, 8.85], z: [-1.12, 2.12], view: 'bottom', mirror: true, density: 0.75 });
  const cST = atlas.chart('stabTop', { type: 'plan', x: [0, 2.85], z: [6.35, 8.3], view: 'top', mirror: true, density: 0.9 });
  const cSB = atlas.chart('stabBot', { type: 'plan', x: [0, 2.85], z: [6.35, 8.3], view: 'bottom', mirror: true, density: 0.7 });
  const cFin = { L: atlas.chart('finLV', { type: 'side', z: [6.6, 9.0], y: [-0.1, 2.92], view: 'left' }), R: atlas.chart('finRV', { type: 'side', z: [6.6, 9.0], y: [-0.1, 2.92], view: 'right' }) };
  const cPod = atlas.chart('pod', { type: 'unwrap', z: [-2.3, 1.85], girth: 2.0, vScale: 0.8, density: 0.8 });
  const cNac = atlas.chart('nac', { type: 'unwrap', z: [1.6, 4.45], girth: 4.2, vScale: 0.8, density: 0.85 });
  const cPanel = atlas.chart('panel', { type: 'rect', w: 0.9, h: 0.5, density: 2.2 });
  atlas.pack();
  const U = {
    under: atlas.swatch('under', paintF(SC.under)), top: atlas.swatch('top', paintF(SC.top)), dark: atlas.swatch('dark', F.darkGrey), black: atlas.swatch('black', F.black),
    gun: atlas.swatch('gun', { color: '#2b2a29', rough: 0.45, metal: 0.85 }), bore: atlas.swatch('bore', { color: '#050505', rough: 0.9, metal: 0 }),
    steel: atlas.swatch('steel', F.steel), well: atlas.swatch('well', F.gearWhite), interior: atlas.swatch('interior', F.interior),
    console: atlas.swatch('console', { color: '#1d1f21', rough: 0.6, metal: 0 }), seat: atlas.swatch('seat', { color: '#25282a', rough: 0.7, metal: 0 }),
    cushion: atlas.swatch('cushion', F.fabric), accent: atlas.swatch('accent', { color: '#d6b21e', rough: 0.5, metal: 0 }),
    suit: atlas.swatch('suit', { color: '#4d5540', rough: 0.9, metal: 0 }), helmet: atlas.swatch('helmet', { color: '#8d9296', rough: 0.35, metal: 0 }),
    visor: atlas.swatch('visor', { color: '#0a0b0d', rough: 0.05, metal: 0.4 }), glove: atlas.swatch('glove', { color: '#3a3d33', rough: 0.9, metal: 0 }),
    frame: atlas.swatch('frame', paintF('#3c4044')), lens: atlas.swatch('lens', F.lens), probe: atlas.swatch('probe', F.bareMetal),
    pylon: atlas.swatch('pylon', paintF(SC.under)), aim: atlas.swatch('aim', F.semigloss('#b9bcbd')), aimNose: atlas.swatch('aimNose', { color: '#1c1e20', rough: 0.15, metal: 0.3 }),
    mav: atlas.swatch('mav', F.semigloss('#b4b6ae')), mavNose: atlas.swatch('mavNose', { color: '#141618', rough: 0.05, metal: 0.5 }),
    bomb: atlas.swatch('bomb', paintF('#59603f')), bombNose: atlas.swatch('bombNose', { color: '#474a42', rough: 0.4, metal: 0.4 }),
    rocket: atlas.swatch('rocket', paintF('#6d726b')), rocketNose: atlas.swatch('rocketNose', paintF('#8a8f88')),
    pod: atlas.swatch('pod', paintF('#6a7075')), podWin: atlas.swatch('podWin', { color: '#2a2418', rough: 0.05, metal: 0.6 }),
    nac: atlas.swatch('nac', paintF(SC.top)), lip: atlas.swatch('lip', { color: '#a7abae', rough: 0.35, metal: 0.8 }),
    duct: atlas.swatch('duct', F.semigloss('#c9cbc8')), acoustic: atlas.swatch('acoustic', { color: '#55595c', rough: 0.7, metal: 0.2 }),
    core: atlas.swatch('core', { color: '#5e5b57', rough: 0.5, metal: 0.7 }), plug: atlas.swatch('plug', { color: '#3e3b38', rough: 0.55, metal: 0.75 }),
    blade: atlas.swatch('blade', { color: '#8d9194', rough: 0.3, metal: 0.9 }), spinner: atlas.swatch('spinner', { color: '#2c2e30', rough: 0.4, metal: 0.3 }),
    exhaust: atlas.swatch('exhaust', F.exhaust),
  };

  const rig = K.createRig(ctx, { geometry: G, name: 'a10', glassLayer: opts.glassLayer, cockpitRadius: 1.0 });
  rig.material('paint', null);
  const stat = new K.Mesh();

  // ---- fuselage: blunt gun nose, slab-sided armoured cockpit section, long tapering tail cone ----------------------------
  //   z       yW     w      top    bot    kTop  kBot      (yW = height of the widest point; top / bot absolute heights)
  const FSR = [
    [-6.99, 0.10, 0.000, 0.100, 0.100],
    [-6.95, 0.10, 0.140, 0.240, -0.040, 0.6, 0.6],
    [-6.84, 0.10, 0.270, 0.375, -0.160, 0.62, 0.64],
    [-6.55, 0.11, 0.420, 0.535, -0.330, 0.66, 0.7],
    [-6.00, 0.13, 0.565, 0.705, -0.500, 0.7, 0.76],
    [-5.50, 0.15, 0.655, 0.830, -0.585, 0.72, 0.8],
    [-5.00, 0.18, 0.710, 0.935, -0.620, 0.74, 0.83],
    [-4.40, 0.20, 0.730, 0.990, -0.620, 0.76, 0.85],
    [-3.50, 0.21, 0.740, 1.010, -0.630, 0.76, 0.86],
    [-2.50, 0.21, 0.740, 1.040, -0.630, 0.74, 0.86],
    [-1.20, 0.20, 0.730, 1.065, -0.630, 0.72, 0.86],
    [0.50, 0.20, 0.700, 1.050, -0.620, 0.7, 0.85],
    [2.00, 0.22, 0.640, 0.985, -0.560, 0.68, 0.8],
    [3.50, 0.26, 0.550, 0.905, -0.420, 0.66, 0.74],
    [5.00, 0.32, 0.450, 0.830, -0.220, 0.62, 0.68],
    [6.50, 0.40, 0.350, 0.770, 0.050, 0.6, 0.64],
    [7.80, 0.50, 0.250, 0.735, 0.300, 0.58, 0.6],
    [8.60, 0.56, 0.150, 0.705, 0.450],
    [8.91, 0.60, 0.040, 0.660, 0.540],
  ];
  const FS = FSR.map(r => ({ z: r[0], y: r[1], w: r[2], top: Math.max(0, r[3] - r[1]), bot: Math.max(0, r[1] - r[4]), kTop: r[5] ?? 0.5523, kBot: r[6] ?? 0.5523 }));
  const fus0 = K.loft({ stations: FS, segments: seg, step: 0.4 });
  const KF = fus0.K;
  const T_SILL = Math.round(fus0.tAtY(-3.8, 0.9) * KF) / KF;
  const tAtX = (z, x) => { let j = 0; while (j < KF / 2 && fus0.at(z, j / KF).p[0] < x) j++; return j / KF; };
  const T_NG = [tAtX(-5.0, 0.07), tAtX(-5.0, 0.53)];
  const Z_CK = [-4.95, -2.55], Z_NG = [-5.75, -4.25];
  const fus = K.loft({
    stations: FS, segments: seg, step: 0.12 / detail, chart: cFus, capEnd: 'flat', capUV: U.top,
    cutouts: [
      { name: 'cockpit', z: Z_CK, t: [T_SILL, 1 - T_SILL] },
      { name: 'ng', z: Z_NG, t: T_NG },
    ],
  });
  cFus.body = fus;
  stat.add(fus.mesh);

  // ---- GAU-8/A Avenger: seven barrels low in the nose, cluster offset left so the firing barrel is on the centreline -------
  const GUN = [-0.07, -0.2], GZ = [-6.55, -7.35];
  {
    const [gx, gy] = GUN;
    stat.add(K.lathe([[0, -7.04], [0.17, -7.02], [0.185, -6.98, 1], [0.19, -6.55]], { segments: 18, uv: U.gun }).translate(gx, gy, 0));    // muzzle shroud / front bearing
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2 + 0.2, bx = gx + Math.cos(a) * 0.112, by = gy + Math.sin(a) * 0.112;
      stat.add(K.tube([bx, by, GZ[0]], [bx, by, GZ[1]], 0.034, 0.033, { segments: 8, uv: U.gun }));
      stat.add(K.lathe([[0.019, GZ[1] + 0.12], [0.019, GZ[1] + 0.002], [0, GZ[1] + 0.002]], { segments: 8, uv: U.bore }).translate(bx, by, 0));
    }
    stat.add(K.lathe([[0, -7.26], [0.165, -7.25, 1], [0.165, -7.17, 1], [0, -7.16]], { segments: 18, uv: U.gun }).translate(gx, gy, 0));     // mid-barrel clamp
    stat.add(K.lathe([[0.03, -7.36], [0.03, -6.9], [0, -6.9]], { segments: 10, uv: U.gun }).translate(gx, gy, 0));                              // centre spindle
  }

  // ---- canopy: fixed windscreen + frameless bubble hinged at the rear --------------------------------------------------------
  const canTop = K.pchip([-4.95, -4.75, -4.5, -4.25, -4.0, -3.6, -3.2, -2.9, -2.7, -2.55], [0.94, 1.2, 1.42, 1.56, 1.635, 1.66, 1.615, 1.5, 1.3, 1.07]);
  const canZ = [-4.95, -4.85, -4.7, -4.5, -4.25, -4.0, -3.7, -3.4, -3.1, -2.85, -2.7, -2.55];
  const canSt = canZ.map(z => { const s = fus.at(z, T_SILL).p; return { z, y: s[1], w: s[0], top: Math.max(0.002, canTop(z) - s[1]), bot: 0.01, kTop: [0.7, 0.58] }; });
  const cseg = Math.max(16, Math.round(36 * detail / 4) * 4), ct = 1 / cseg;
  const canLoft = (zr, tr, inflate, uv) => K.loft({ stations: canSt, segments: cseg, step: 0.08, tRange: tr, zRange: zr, inflate, uv }).mesh;
  const ZW = -4.45;
  const glassFixed = canLoft([-4.95, ZW], [0.25, 0.75], 0, [0, 0]);
  const glassMove = canLoft([ZW, -2.55], [0.25, 0.75], 0, [0, 0]);
  stat.add(canLoft([-4.95, ZW], [0.25, 0.25 + ct], 0.006, U.frame)).add(canLoft([-4.95, ZW], [0.75 - ct, 0.75], 0.006, U.frame));
  stat.add(canLoft([ZW - 0.08, ZW], [0.25, 0.75], 0.008, U.frame)).add(canLoft([-4.95, -4.89], [0.25, 0.75], 0.005, U.frame));
  stat.add(canLoft([-4.95, ZW], [0.5 - ct * 0.4, 0.5 + ct * 0.4], 0.006, U.frame));           // windscreen centre post (flat armoured panel joint)
  const frameMove = K.merge(
    canLoft([ZW, -2.55], [0.25, 0.25 + ct * 0.7], 0.004, U.frame), canLoft([ZW, -2.55], [0.75 - ct * 0.7, 0.75], 0.004, U.frame),
    canLoft([ZW, ZW + 0.04], [0.25, 0.75], 0.005, U.frame), canLoft([-2.68, -2.55], [0.25, 0.75], 0.005, U.frame));

  // ---- cockpit: armoured tub, ACES II seat, pilot, HUD, glareshield, panel ---------------------------------------------------
  const eye = G.pilotEye;
  const tubX = 0.56;
  stat.add(K.tub({ x: tubX, y0: 0.15, y1: 0.9, z0: -4.9, z1: -2.6, uv: U.interior, taper: 0.9 }));
  {  // sill ledge closing the gap between the skin cut-out and the tub
    const zs = []; for (let z = Z_CK[0]; z <= Z_CK[1] - 0.001; z += 0.2) zs.push(z); zs.push(Z_CK[1]);
    for (const sx of [1, -1]) {
      let prev = null;
      for (const z of zs) {
        const o = fus.at(z, sx > 0 ? T_SILL : 1 - T_SILL).p, a = stat.vert(o[0], o[1], z, -sx * 0.6, 0.8, 0, U.frame[0], U.frame[1]), b = stat.vert(sx * tubX * 0.92, 0.88, z, -sx * 0.6, 0.8, 0, U.frame[0], U.frame[1]);
        if (prev) { if (sx > 0) stat.quad(prev[0], a, b, prev[1]); else stat.quad(prev[0], prev[1], b, a); }
        prev = [a, b];
      }
    }
  }
  {
    const gs = K.prism([[-4.9, 0.9], [-4.9, 0.97], [-4.58, 1.0], [-4.52, 0.985], [-4.52, 0.9]], -0.44, 0.44, U.black);
    for (let i = 0; i < gs.p.length; i += 3) gs.p[i] *= 0.6 + 0.4 * Math.min(1, (gs.p[i + 2] + 4.9) / 0.4);
    stat.add(gs);
  }
  {
    const i0 = stat.vertexCount;
    for (const [x, y, b] of [[-0.42, 0.5, 0.5], [0.42, 0.5, 0.5], [0.42, 0.97, 0], [-0.42, 0.97, 0]]) { const uv = cPanel.uv(x + 0.45, b); stat.vert(x, y, -4.5, 0, 0.25, 1, uv[0], uv[1]); }
    stat.quad(i0, i0 + 1, i0 + 2, i0 + 3);
  }
  for (const sx of [-1, 1]) stat.add(K.box(0.14, 0.1, 1.5, U.console).translate(sx * 0.42, 0.62, -3.55));
  stat.add(K.stick({ base: [0, 0.35, -4.1], height: 0.38, uv: U.black, uvGrip: U.dark }));
  stat.add(K.box(0.07, 0.08, 0.14, U.dark).translate(-0.4, 0.72, -3.8));
  stat.add(K.ejectionSeat({ eye, recline: 12, uv: { frame: U.seat, cushion: U.cushion, accent: U.accent } }));
  const hudParts = K.hud({ eye, dist: 0.6, width: 0.18, height: 0.16, drop: 0.12, uv: U.black });
  stat.add(hudParts.frame);
  const pilotMesh = K.pilot({ eye, recline: 10, stick: [0, -0.55, -0.15], throttle: [-0.4, -0.5, 0.15], uv: { suit: U.suit, helmet: U.helmet, visor: U.visor, dark: U.dark, glove: U.glove } });

  // ---- wings: straight, thick, low; flat centre section, 7° dihedral outer panels, drooped Hoerner tips -----------------------
  const XB = 2.95, XT = 8.77, WY0 = -0.42, LE0 = -1.05, C0 = 3.1, CT = 1.6;
  const wLE = (x) => LE0 + Math.max(0, x - XB) * Math.tan(3 * DEG);
  const wC = (x) => (x <= XB ? C0 : C0 + (CT - C0) * (x - XB) / (XT - XB));
  const wY = (x) => WY0 + Math.max(0, x - XB) * Math.tan(7 * DEG);
  const XD = 8.3;   // start of the droop
  const mkWing = (side) => K.wing({
    side, airfoil: K.naca6(0.16, 0.022), chordPts: Math.round(13 * detail), spanAxis: 'x', tip: 'flat',
    stations: [
      { x: 0.5, y: WY0, z: LE0, chord: C0, tc: 0.165 },
      { x: XB, y: WY0, z: LE0, chord: C0, tc: 0.16, hard: true },
      { x: XD, y: wY(XD), z: wLE(XD), chord: wC(XD), tc: 0.125, twist: -1 },
      { x: 8.58, y: wY(XD) - 0.035, z: wLE(8.58) + 0.02, chord: wC(8.58) - 0.04, tc: 0.12, twist: -1 },
      { x: XT, y: wY(XD) - 0.14, z: wLE(XT) + 0.06, chord: CT - 0.12, tc: 0.1, twist: -1 },
    ],
    lines: { hte: [[0.5, 0.72], [XB, 0.72], [8.2, 0.73]], slat: [[0.5, 0.15], [XB, 0.15]] },
    controls: [
      { name: 'slat', type: 'flap', span: [0.8, 2.2], to: 'slat', cove: true, tail: 1 },
      { name: 'flapIn', type: 'flap', span: [0.8, 2.2], from: 'hte', nose: 1 },
      { name: 'flapOut', type: 'flap', span: [3.0, 4.65], from: 'hte', nose: 1 },
      { name: 'aileron', type: 'split', span: [4.75, 8.15], from: 'hte' },
    ],
    charts: { upper: side > 0 ? cWT.R : cWT.L, lower: cWB }, innerUV: U.dark,
  });
  const W = { R: mkWing(1), L: mkWing(-1) };
  stat.add(W.R.mesh).add(W.L.mesh);

  // ---- main-gear pods under the centre section ----------------------------------------------------------------------------
  const PODX = 2.5, PODY = -0.72;
  const podSt = (sx) => [[-2.25, 0, 0, 0], [-2.17, 0.13, 0.1, 0.12], [-1.95, 0.24, 0.19, 0.22], [-1.55, 0.3, 0.24, 0.27], [-0.6, 0.32, 0.26, 0.28],
    [0.4, 0.32, 0.26, 0.28], [1.05, 0.27, 0.24, 0.23], [1.55, 0.15, 0.2, 0.12], [1.8, 0.02, 0.16, 0.02]]
    .map(([z, w, top, bot]) => ({ z, x: sx * PODX, y: PODY, w, top, bot, kTop: 0.6, kBot: [0.72, 0.8] }));
  const pods = {};
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    pods[key] = K.loft({ stations: podSt(sx), segments: Math.max(20, Math.round(32 * detail / 4) * 4), step: 0.12 / detail, chart: cPod });
    stat.add(pods[key].mesh);
  }
  cPod.body = pods.R;

  // ---- tailplane and twin fins ------------------------------------------------------------------------------------------------
  const TY = 0.68, TLE = 6.4, TC = 1.85, FX = 2.75;
  const mkStab = (side) => K.wing({
    side, airfoil: K.naca4('0010'), chordPts: Math.round(9 * detail), spanAxis: 'x', tip: 'none',
    stations: [{ x: 0.1, y: TY, z: TLE, chord: TC, tc: 0.1 }, { x: FX, y: TY, z: TLE + 0.05, chord: TC - 0.1, tc: 0.09 }],
    lines: { eh: [[0.1, 0.62], [FX, 0.6]] },
    controls: [{ name: 'elevator', type: 'flap', span: [0.32, 2.66], from: 'eh', nose: 1 }],
    charts: { upper: cST, lower: cSB }, innerUV: U.dark,
  });
  const stab = { R: mkStab(1), L: mkStab(-1) };
  stat.add(stab.R.mesh).add(stab.L.mesh);
  const FINST = [[-0.05, 7.42, 8.76], [0.05, 7.0, 8.87], [0.25, 6.76, 8.93], [1.5, 6.86, 8.95], [2.5, 7.05, 8.95], [2.7, 7.25, 8.9], [2.82, 7.62, 8.7]];
  const RZ = 8.3;
  const mkFin = (sx) => K.wing({
    airfoil: K.naca4('0008'), chordPts: Math.round(10 * detail), spanAxis: 'y', tip: 'flat', root: 'flat',
    stations: FINST.map(([y, le, te]) => ({ x: sx * FX, y, z: le, chord: te - le, tc: 0.075 })),
    lines: { rh: [[0.25, (RZ - 6.76) / 2.17], [1.5, (RZ - 6.86) / 2.09], [2.5, (RZ - 7.05) / 1.9], [2.7, (RZ - 7.25) / 1.65]] },
    controls: [{ name: 'rudder', type: 'flap', span: [0.88, 2.62], from: 'rh', nose: 1 }],
    charts: { upper: cFin.L, lower: cFin.R }, innerUV: U.dark,
  });
  const fins = { R: mkFin(1), L: mkFin(-1) };
  stat.add(fins.R.mesh).add(fins.L.mesh);

  // ---- TF34 engine pods on short canted pylons ----------------------------------------------------------------------------
  const ENG = [[-1.45, 1.3, 1.65], [1.45, 1.3, 1.65]];
  const eng = [];
  for (const [i, c] of ENG.entries()) {
    const sx = Math.sign(c[0]);
    const n = K.nacelle({ centre: c, length: 2.75, rHi: 0.555, rMax: 0.655, rThroat: 0.5, rFan: 0.5, zFan: 0.42, rExit: 0.585, sleeve: 0,
      core: { r0: 0.4, r1: 0.29, length: 0.72 }, plug: { r: 0.17, length: 0.38 }, segments: Math.max(24, Math.round(40 * detail / 4) * 4),
      uv: U.nac, uvLip: U.lip, uvInner: U.duct, uvCore: U.core, uvPlug: U.plug });
    // re-map the outer cowl onto the nacelle chart (panel lines + soot), keep the inlet duct and lip swatches
    const m = n.cowl, rx = c[0], ry = c[1];
    for (let v = 0; v < m.vertexCount; v++) {
      const x = m.p[v * 3], y = m.p[v * 3 + 1], z = m.p[v * 3 + 2], r = Math.hypot(x - rx, y - ry);
      if (z > c[2] + 0.1 && r > 0.6 && m.n[v * 3 + 2] > -0.6) {
        let t = Math.atan2(sx * (x - rx), -(y - ry)) / (Math.PI * 2); if (t < 0) t += 1;
        const uv = cNac.uvUnwrap(Math.min(4.44, z), t, 0); m.uv[v * 2] = uv[0]; m.uv[v * 2 + 1] = uv[1];
      }
    }
    stat.add(m).add(n.core).add(n.plug);
    stat.add(K.fanBackdrop(0.5, n.fanZ + 0.35, U.black).translate(c[0], c[1], 0));
    stat.add(K.wing({   // pylon: from the upper fuselage shoulder up and out to the nacelle's inboard underside
      stations: [{ x: sx * 0.28, y: 0.86, z: 1.75, chord: 2.45, tc: 0.13 }, { x: sx * 1.12, y: 0.98, z: 2.0, chord: 1.95, tc: 0.15 }],
      airfoil: K.naca4('0012'), spanAxis: 'u', tip: 'flat', root: 'flat', chordPts: 8, uv: U.top, edgeUV: U.top, side: 1,
    }).mesh);
    eng.push({ c, n, fanMesh: K.fan({ radius: 0.495, hub: 0.17, blades: 28, spinner: 0.2, uvBlade: U.blade, uvSpinner: U.spinner }) });
  }

  // ---- landing-gear wells -------------------------------------------------------------------------------------------------------
  const P = fus.patches;
  stat.add(K.well(P.ng, 0.5, U.well, [0, 1, 0]));

  // ---- stores: 11 hardpoints, typical CAS load ---------------------------------------------------------------------------------
  {
    const wl = (x, f) => W.R.at(Math.abs(x), f, 'lower');
    const pyl = (x, depth = 0.3, len = 1.75, f0 = 0.12) => {   // returns the pylon bottom height and front z
      const ax = Math.abs(x), zf = wLE(ax) + wC(ax) * f0, y0 = wl(ax, 0.35)[1];
      stat.add(K.pylon([{ y: y0 - depth, z0: zf + 0.12, z1: zf + len - 0.05, x, tc: 0.09 }, { y: y0 + 0.08, z0: zf, z1: zf + len, x, tc: 0.08 }], { uv: U.pylon }));
      return { y: y0 - depth, zf };
    };
    const mav = (x, y, z, roll = 45) => K.missile({ length: 2.49, radius: 0.152, canards: { z: 0.75, chord: 1.05, span: 0.17 }, wings: { z: 2.2, chord: 0.26, span: 0.18 }, uvBody: U.mav, uvNose: U.mavNose, uvFin: U.mav, roll }).translate(x, y, z);
    const gbu12 = (x, y, z) => K.missile({ length: 3.27, radius: 0.137, canards: { z: 0.32, chord: 0.22, span: 0.09 }, wings: { z: 2.62, chord: 0.6, span: 0.3 }, uvBody: U.bomb, uvNose: U.bombNose, uvFin: U.bomb, roll: 45 }).translate(x, y, z);
    for (const sx of [-1, 1]) {
      // st 4 / 8 (between the fuselage and the gear pod): GBU-12
      { const p = pyl(sx * 1.55, 0.32); stat.add(gbu12(sx * 1.55, p.y - 0.15, p.zf - 0.85)); }
    }
    // st 3 (left): LAU-88 triple rail with three AGM-65 Mavericks
    {
      const x = -3.45, p = pyl(x, 0.3, 1.9);
      stat.add(K.box(0.2, 0.14, 1.5, U.pylon).translate(x, p.y - 0.06, p.zf + 0.85));
      stat.add(K.launchRail({ x, y: p.y - 0.17, z0: p.zf + 0.1, z1: p.zf + 1.6, w: 0.06, h: 0.07, uv: U.pylon }));
      stat.add(mav(x, p.y - 0.35, p.zf - 0.5));
      for (const s2 of [-1, 1]) {
        stat.add(K.box(0.07, 0.07, 1.4, U.pylon).translate(x + s2 * 0.15, p.y - 0.1, p.zf + 0.85));
        stat.add(mav(x + s2 * 0.31, p.y - 0.13, p.zf - 0.4, 0));
      }
    }
    // st 9 (right): LAU-117 with one AGM-65
    { const x = 3.45, p = pyl(x, 0.3, 1.9); stat.add(K.launchRail({ x, y: p.y - 0.05, z0: p.zf + 0.0, z1: p.zf + 1.7, w: 0.08, h: 0.1, uv: U.pylon })); stat.add(mav(x, p.y - 0.25, p.zf - 0.45)); }
    // st 2 (left): LAU-131 rocket pod
    {
      const x = -4.9, p = pyl(x, 0.28, 1.6);
      stat.add(K.tank({ length: 1.75, radius: 0.21, nose: 0.12, tail: 0.06, uv: U.rocket }).translate(x, p.y - 0.21, p.zf - 0.1));
      stat.add(K.lathe([[0, p.zf - 0.11], [0.12, p.zf - 0.1], [0.12, p.zf - 0.08]], { segments: 14, uv: U.rocketNose }).translate(x, p.y - 0.21, 0));
    }
    // st 10 (right): AN/AAQ-33 Sniper targeting pod
    {
      const x = 4.9, p = pyl(x, 0.26, 1.6), y = p.y - 0.17;
      stat.add(K.tank({ length: 2.39, radius: 0.152, nose: 0.05, tail: 0.18, uv: U.pod }).translate(x, y, p.zf - 0.55));
      stat.add(K.ellipsoid(0.15, 0.15, 0.3, { segments: 16, rings: 8, uv: U.pod, z0: -1, z1: 0 }).translate(x, y, p.zf - 0.45));
      stat.add(K.box(0.14, 0.12, 0.04, U.podWin).translate(x, y - 0.04, p.zf - 0.73));
    }
    // st 11 (right): AN/ALQ-184 ECM pod
    { const x = 6.35, p = pyl(x, 0.24, 1.5); stat.add(K.tank({ length: 3.95, radius: 0.165, nose: 0.12, tail: 0.12, uv: U.pod }).translate(x, p.y - 0.17, p.zf - 1.2)); stat.add(K.box(0.16, 0.16, 0.6, U.pod).translate(x, p.y - 0.12, p.zf + 0.4)); }
    // st 1 (left): LAU-105 dual rail with two AIM-9M
    {
      const x = -6.35, p = pyl(x, 0.24, 1.5);
      stat.add(K.box(0.42, 0.08, 1.2, U.pylon).translate(x, p.y - 0.04, p.zf + 0.7));
      for (const s2 of [-1, 1]) {
        const rx = x + s2 * 0.2;
        stat.add(K.launchRail({ x: rx, y: p.y - 0.12, z0: p.zf + 0.05, z1: p.zf + 1.6, w: 0.05, h: 0.07, uv: U.pylon }));
        stat.add(K.missile({ length: 2.87, radius: 0.0635, uvBody: U.aim, uvNose: U.aimNose, uvFin: U.aim }).translate(rx, p.y - 0.22, p.zf - 0.9));
      }
    }
    // st 5 / 7: empty fuselage pylons; st 6 (centreline): clean adapter
    for (const sx of [-1, 1]) stat.add(K.pylon([{ y: -0.88, z0: -0.35, z1: 0.95, x: sx * 0.52, tc: 0.08 }, { y: -0.55, z0: -0.5, z1: 1.15, x: sx * 0.52, tc: 0.07 }], { uv: U.pylon }));
    stat.add(K.prism([[-0.3, -0.6], [0.9, -0.6], [0.75, -0.72], [-0.15, -0.72]], -0.05, 0.05, U.pylon));
    // probes, antennas, formation lights, refuelling slipway, IFF / UHF blades
    { const p = W.R.at(7.2, 0.0, 'mid'); stat.add(K.probe([-p[0], p[1], p[2] + 0.05], [-p[0], p[1] + 0.01, p[2] - 0.55], 0.018, U.probe)); }    // pitot on the left wing LE
    stat.add(K.bladeAntenna({ pos: [0, fus.topAt(-1.8) - 0.02, -1.8], height: 0.22, chord: 0.3, sweep: 0.14, uv: U.top }));
    stat.add(K.bladeAntenna({ pos: [0, fus.topAt(4.6) - 0.02, 4.6], height: 0.18, chord: 0.26, sweep: 0.12, uv: U.top }));
    stat.add(K.bladeAntenna({ pos: [0, fus.botAt(-2.6) + 0.02, -2.6], height: 0.2, chord: 0.28, sweep: 0.12, down: true, uv: U.under }));
    stat.add(K.bladeAntenna({ pos: [-0.25, fus.botAt(3.6) + 0.02, 3.6], height: 0.16, chord: 0.22, sweep: 0.1, down: true, uv: U.under }));
    { const p = fus.at(-6.3, 0.72).p; stat.add(K.probe(p, [p[0] - 0.06, p[1], p[2] - 0.2], 0.012, U.probe)); }
    { const p = fus.at(-6.3, 0.28).p; stat.add(K.probe(p, [p[0] + 0.06, p[1], p[2] - 0.2], 0.012, U.probe)); }
    { const wicks = []; for (const sx of [-1, 1]) { for (const x of [5.6, 7.0, 8.1]) { const q = W.R.at(x, 1, 'mid'); wicks.push([sx * q[0], q[1], q[2]]); } } stat.add(K.staticWicks(wicks, 0.16, U.dark)); }
  }

  // ---- paint + materials ------------------------------------------------------------------------------------------------------------
  lap('geometry');
  paint(atlas, { SC, fus, W, fins, pods, cFus, cWT, cWB, cST, cSB, cFin, cPod, cNac, cPanel, paintF, wLE, wC, T_NG, Z_NG, T_SILL });
  lap('paint');
  const mat = atlas.material(ctx, { envMapIntensity: 1 });
  lap('textures');
  rig.material('paint', mat, { shared: true });
  rig.disposables.push(atlas);
  rig.glass('canopy', K.glassMaterial(ctx, K.GLASS.clear));
  rig.glass('hud', K.glassMaterial(ctx, K.GLASS.hud));
  rig.addStatic(stat, 'paint');
  rig.addStatic(glassFixed, 'canopy');
  rig.addStatic(hudParts.glass, 'hud');

  // ---- moving parts --------------------------------------------------------------------------------------------------------------
  const CP = [0, 1.06, -2.58];
  const canopyNode = rig.node('canopy', { pivot: CP });
  rig.part('canopyGlass', glassMove, { parent: canopyNode, key: 'canopy' });
  rig.part('canopyFrame', frameMove, { parent: canopyNode });
  const setCanopy = rig.hinge(canopyNode, [-1, CP[1], CP[2]], [1, CP[1], CP[2]], { ref: [0, 1.5, -4.4], toward: [0, 1, 0] });
  const pilotNode = rig.part('pilot', pilotMesh, { pivot: eye });

  const drop = (ctrl, d, aft = 0) => { const u = ctrl.up, h = ctrl.hinge, o = [-u[0] * d, -u[1] * d, -u[2] * d + aft]; return { a: [h.a[0] + o[0], h.a[1] + o[1], h.a[2] + o[2]], b: [h.b[0] + o[0], h.b[1] + o[1], h.b[2] + o[2]] }; };
  const hingeOn = (name, mesh, line, ref, toward, parent) => { const node = rig.part(name, mesh, { pivot: line.a, parent }); return rig.hinge(node, line.a, line.b, { ref, toward }); };
  const DOWN = [0, -1, 0], UP = [0, 1, 0];
  const wingAnim = {};
  for (const key of ['R', 'L']) {
    const C = W[key].controls, a = {};
    a.flapIn = hingeOn('flapIn' + key, C.flapIn.mesh, drop(C.flapIn, 0.16, 0.06), C.flapIn.ref, DOWN);
    a.flapOut = hingeOn('flapOut' + key, C.flapOut.mesh, drop(C.flapOut, 0.14, 0.05), C.flapOut.ref, DOWN);
    a.slat = hingeOn('slat' + key, C.slat.mesh, drop(C.slat, 0.32, 0.12), C.slat.ref, DOWN);
    // split aileron: the pair rotates as an aileron, and the halves open like a clamshell as the speedbrake
    const A = C.aileron, node = rig.node('aileron' + key, { pivot: A.hinge.a });
    a.ail = rig.hinge(node, A.hinge.a, A.hinge.b, { ref: A.ref, toward: UP });
    a.decU = hingeOn('decelU' + key, A.parts.upper.mesh, A.parts.upper.hinge, A.parts.upper.ref, UP, node);
    a.decL = hingeOn('decelL' + key, A.parts.lower.mesh, A.parts.lower.hinge, A.parts.lower.ref, DOWN, node);
    a.elev = rig.hingePart('elevator' + key, stab[key].controls.elevator).set;
    a.rud = rig.hingePart('rudder' + key, fins[key].controls.rudder, { toward: [1, 0, 0] }).set;
    wingAnim[key] = a;
  }
  const fans = eng.map((e, i) => rig.part('fan' + i, e.fanMesh.translate(e.c[0], e.c[1], e.n.fanZ), { pivot: [e.c[0], e.c[1], e.n.fanZ] }));

  // ---- landing gear --------------------------------------------------------------------------------------------------------
  const gp = G.gear;
  const ngEdge = fus.edges.ng;
  K.buildGear(rig, atlas, {
    name: 'nose', index: 0, contact: gp[0].pos, wheelRadius: gp[0].wheelRadius, wheelWidth: 0.2, pivot: [0.3, -0.5, -4.45], stroke: 0.3, staticFrac: 0.35,
    strutR: 0.06, fork: 'fork', steer: true, links: 'front', retract: { to: [0.3, -0.28, -5.33] }, window: [0.2, 0.9], brace: [0.3, -0.55, -3.95],
    doors: [{ name: 'noseDoor', mesh: K.thicken(P.ng, 0.02, U.well), hinge: { a: ngEdge.tHi[0], b: ngEdge.tHi[1] }, ref: K.centroid(P.ng), open: 95, toward: [0, -1, 0] }],
    lamps: [{ kind: 'landing', pos: G.lights.landing, size: 0.055, color: [1, 0.96, 0.88] }, { kind: 'taxi', pos: [0.3, -1.0, -4.76], size: 0.045, color: [1, 0.96, 0.88] }],
  });
  const MG = { stow: [-0.85, -0.98], pivot: [-0.14, -0.62] };
  const mains = [];
  for (const [i, sx] of [[1, -1], [2, 1]]) {
    // single wheel on a cantilever axle: the strut runs 0.2 m outboard of the tyre, the tyre sits on the contact point
    const OFF = 0.2, c = [gp[i].pos[0] + sx * OFF, gp[i].pos[1], gp[i].pos[2]], xs = sx * (PODX + OFF);
    const piv = [xs, MG.pivot[1], MG.pivot[0]], stow = [xs, MG.stow[1], MG.stow[0]];
    const g = K.buildGear(rig, atlas, {
      name: 'main' + (sx > 0 ? 'R' : 'L'), index: i, contact: c, wheelRadius: gp[i].wheelRadius, wheelWidth: 0.3,
      pivot: piv, stroke: 0.32, staticFrac: 0.35, strutR: 0.085, fork: 'half', wheels: [-sx * OFF], links: 'front',
      retract: { to: stow }, window: [0.05, 0.95],
    });
    const C = [c[0], c[1] + gp[i].wheelRadius, c[2]], sw = K.swing(piv, C, stow);
    mains.push({ g, axis: new THREE.Vector3(...sw.axis), angle: sw.angle * DEG, stroke: 0.32, eStatic: 0.32 * 0.65 });
  }

  // ---- lamps ---------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.045, squash: [0.7, 0.7, 1.5] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.045, squash: [0.7, 0.7, 1.5] });
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.04 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.05 });
  rig.lamp('strobe', [-L.strobe[0], L.strobe[1], L.strobe[2]], { color: [1, 1, 1], size: 0.05 });
  rig.lamp('beacon', L.beacon, { color: [1, 0.1, 0.05], size: 0.06 });
  rig.lamp('beacon', [0, fus.botAt(1.5) - 0.03, 1.5], { color: [1, 0.1, 0.05], size: 0.06 });

  // ---- animation -----------------------------------------------------------------------------------------------------------
  const fanSpin = [0, 0];
  rig.onUpdate((S, dt) => {
    const sf = S.sf, sb = sf.speedbrake;
    for (const key of ['R', 'L']) {
      const a = wingAnim[key];
      a.ail((key === 'R' ? sf.aileronR : sf.aileronL) * 20 * DEG);
      a.decU(sb * 32 * DEG); a.decL(sb * 32 * DEG);
      a.flapIn(-sf.flaps * 28 * DEG); a.flapOut(-sf.flaps * 28 * DEG);
      a.slat(-sf.slats * 18 * DEG);
      a.elev((key === 'R' ? sf.elevatorR : sf.elevatorL) * 25 * DEG);
      a.rud(sf.rudder * 25 * DEG);
    }
    for (let i = 0; i < 2; i++) {
      const e = S.eng[i] || S.eng[0] || {};
      fanSpin[i] = (fanSpin[i] + (e.n1 || 0) * 70 * (dt || 0)) % (Math.PI * 2);
      fans[i].quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), (i ? -1 : 1) * fanSpin[i]);
    }
    // main wheels stay half exposed in the pods when retracted: keep the legs visible in the stowed pose
    if (sf.gear <= 0.012) {
      for (const m of mains) {
        const g = m.g; g.leg.visible = true;
        g.leg.quaternion.setFromAxisAngle(m.axis, m.angle);
        const off = m.stroke - m.eStatic, r = g.piston.userData.rest, d = g.axis;
        g.piston.position.set(r.x + d.x * off, r.y + d.y * off, r.z + d.z * off);
        g.steer.quaternion.identity();
      }
    }
    setCanopy(sf.canopy * 28 * DEG);
    pilotNode.visible = !rig.cameraInCockpit;
  });
  const visual = rig.build();
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- paint -------------------------------------------------------------------------------------------------------------------
function paint(atlas, o) {
  const { SC, fus, W, fins, cFus, cWT, cWB, cST, cSB, cFin, cPod, cNac, cPanel, paintF, wLE, wC, T_NG, Z_NG, T_SILL } = o, F = K.FINISH;
  const top = paintF(SC.top), under = paintF(SC.under), mark = SC.mark;
  const slime = { color: '#c9cf8f', rough: 0.35, metal: 0 };
  const rnd = (() => { let a = 9157; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const line = { px: 1, depth: 0.35, dark: 0.12 }, gap = { px: 2, depth: 0.8, dark: 0.5 }, riv = { px: 1.1, depth: 0.15, dark: 0.04 };
  const camo = (Q, a0, a1, b0, b1, scale, sb = 1) => {   // European One wraparound blobs (paint coordinates; sb scales b)
    if (!SC.camo) return;
    for (const [ci, col] of [[1, SC.camo[1]], [2, SC.camo[2]]]) {
      const n = Math.ceil((a1 - a0) / scale * 1.6);
      for (let i = 0; i < n; i++) {
        const ca = a0 + (i + rnd() * 0.8) * (a1 - a0) / n, cb = b0 + rnd() * (b1 - b0), rA = scale * (0.35 + rnd() * 0.3), rB = rA * sb * (0.6 + rnd() * 0.5);
        Q.fill((g) => { const k = 7; for (let j = 0; j <= k; j++) { const t = j / k * Math.PI * 2, f = 0.75 + 0.45 * Math.sin(t * 3 + ci + i); const x = ca + Math.cos(t) * rA * f, y = cb + Math.sin(t) * rB * f; if (j) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); }, paintF(col), { feather: 3 });
      }
    }
  };

  // ================= fuselage =================
  const P = atlas.pen(cFus);
  P.fill('all', top);
  if (!SC.camo) P.band(-7.0, 8.95, -Infinity, (z) => (z < -5.5 ? 0.0 : 0.38), under, { feather: 5 });
  camo(P, -7.0, 8.95, 0, 1, 2.6, 0.22);
  // false canopy under the nose (dark gloss grey, the A-10's best-known paint trick)
  if (SC.falseCanopy) {
    const shape = (z) => { const f = (z + 6.15) / 1.45; return f <= 0 || f >= 1 ? 0 : 0.42 * Math.sin(Math.PI * Math.pow(f, 0.7)); };
    const pts = []; for (let i = 0; i <= 16; i++) { const z = -6.15 + 1.45 * i / 16; pts.push([z, shape(z) / fus.girthAt(z, 0)]); }
    P.fill(pts.concat([[-4.7, 0], [-6.15, 0]]), { color: '#2f3337', rough: 0.35, metal: 0.05 });
    P.fill(pts.map(([z, t]) => [z, 1 - t]).concat([[-4.7, 1], [-6.15, 1]]), { color: '#2f3337', rough: 0.35, metal: 0.05 });
  }
  // structure: frames, longerons, armour-tub panels, gun-bay and avionics doors
  for (const z of [-6.55, -5.75, -4.95, -2.55, -1.6, -0.8, 0.1, 1.0, 1.9, 2.8, 3.7, 4.6, 5.5, 6.4, 7.3, 8.2]) P.ring(z, 0, 1, line);
  for (const y of [0.05, -0.38, 0.62]) P.yLine(-6.5, 2.3, y, line);
  P.yLine(2.3, 8.6, 0.45, line);
  for (const s of [1, -1]) {
    const t = (v) => (s > 0 ? v : 1 - v);
    for (let z = -4.9; z < -2.6; z += 0.58) P.decalOn(z + 0.29, 0.3, s > 0 ? 'R' : 'L', { layers: ['height', 'color'] }, (g, layer) => { g.strokeStyle = layer === 'height' ? 'rgba(0,0,0,0.45)' : 'rgba(10,12,14,0.22)'; g.lineWidth = 0.008; g.strokeRect(-0.27, -0.28, 0.54, 0.56); });
    for (const z0 of [-6.4, -5.7]) P.decalOn(z0 + 0.32, -0.2, s > 0 ? 'R' : 'L', { layers: ['height', 'color'] }, (g, layer) => { g.strokeStyle = layer === 'height' ? 'rgba(0,0,0,0.5)' : 'rgba(10,12,14,0.25)'; g.lineWidth = 0.008; g.beginPath(); g.roundRect(-0.3, -0.18, 0.6, 0.36, 0.03); g.stroke(); });
    for (const zz of [-1.6, -0.8, 0.1, 1.0, 1.9, 2.8, 3.7]) P.rivets(zz + 0.02, t(0.3), zz + 0.02, t(0.45), 0.06, riv);
    P.line([[-1.6, t(0.42)], [3.7, t(0.42)]], line);
  }
  // nose-gear door outline, gun-bay access, refuelling slipway on the nose
  P.line([[Z_NG[0], T_NG[0]], [Z_NG[1], T_NG[0]], [Z_NG[1], T_NG[1]], [Z_NG[0], T_NG[1]], [Z_NG[0], T_NG[0]]], gap);
  P.decalT(-5.2, 0.5, {}, (g) => { g.fillStyle = 'rgba(28,30,32,0.7)'; g.beginPath(); g.roundRect(-0.16, -0.13, 0.32, 0.26, 0.04); g.fill(); g.strokeStyle = '#e6e6df'; g.lineWidth = 0.012; for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(-0.75, sx * 0.17); g.lineTo(-0.2, sx * 0.17); g.stroke(); } });
  P.fill([[-6.6, 0.47], [-5.35, 0.45], [-5.35, 0.55], [-6.6, 0.53]], F.matte('#30343a'), { alpha: SC.camo ? 0 : 0.6 });
  // gun gas soot on the lower nose
  P.fill((g) => { g.rect(-7.0, 0.9, 0.55, 0.1); g.rect(-7.0, 0.0, 0.55, 0.1); }, { color: '#1c1c1b', rough: 0.85, metal: 0 }, { alpha: 0.4, feather: 12 });
  for (let i = 0; i < 14; i++) { const t = (rnd() < 0.5 ? 0.03 : 0.85) + rnd() * 0.12; P.streak(-6.9, t, -6.9 + 0.6 + rnd() * 1.2, t + (rnd() - 0.5) * 0.03, 0.02 + rnd() * 0.03, { alpha: 0.15 + rnd() * 0.15 }); }
  // markings
  P.decalOn(3.3, 0.28, 'both', (g) => K.drawStarBar(g, 0.62, { lowVis: SC.camo ? '#141514' : '#3a3e42' }));
  P.textOn('LT COL R. "TUSK" HALVERSEN', -3.5, 0.72, 'L', 0.042, { color: SC.camo ? '#d8d8cf' : '#2a2d30', weight: 700 });
  P.textOn('SSGT M. OKAFOR', -3.5, 0.72, 'R', 0.042, { color: SC.camo ? '#d8d8cf' : '#2a2d30', weight: 700 });
  P.textOn('RESCUE', -2.3, 0.65, 'both', 0.045, { color: '#b9332b' });
  P.decalOn(-2.0, 0.55, 'both', (g) => { g.strokeStyle = '#b9332b'; g.lineWidth = 0.012; g.beginPath(); g.moveTo(-0.1, 0); g.lineTo(0.07, 0); g.moveTo(0.02, -0.04); g.lineTo(0.08, 0); g.lineTo(0.02, 0.04); g.stroke(); });
  P.decalOn(-1.2, 0.2, 'both', { layers: ['color', 'orm'] }, (g, layer) => { g.fillStyle = layer === 'orm' ? 'rgb(255,90,0)' : slime.color; g.fillRect(-0.32, -0.03, 0.64, 0.06); });
  P.decalOn(7.4, 0.5, 'both', { layers: ['color', 'orm'] }, (g, layer) => { g.fillStyle = layer === 'orm' ? 'rgb(255,90,0)' : slime.color; g.fillRect(-0.3, -0.03, 0.6, 0.06); });
  if (SC.shark) {
    P.decalOn(-6.15, -0.08, 'both', {}, (g, layer, side) => {
      if (side === 'R') g.scale(-1, 1);          // the mouth always opens toward the nose
      const lipU = [[-0.8, 0.0], [-0.45, -0.07], [0.0, -0.1], [0.45, -0.17], [0.78, -0.33]], lipL = [[0.78, -0.33], [0.5, -0.08], [0.1, 0.18], [-0.35, 0.3], [-0.8, 0.33]];
      g.fillStyle = '#b3241f'; g.beginPath(); [...lipU, ...lipL].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
      g.fillStyle = '#efeee8';
      const teeth = (pts, dir) => { for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; for (let k = 0; k < 3; k++) { const f0 = k / 3, f1 = (k + 1) / 3, xa = x0 + (x1 - x0) * f0, ya = y0 + (y1 - y0) * f0, xb = x0 + (x1 - x0) * f1, yb = y0 + (y1 - y0) * f1; g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb, yb); g.lineTo((xa + xb) / 2, (ya + yb) / 2 + dir * 0.085); g.closePath(); g.fill(); } } };
      teeth(lipU, 1); teeth(lipL, -1);
      g.strokeStyle = '#111'; g.lineWidth = 0.025; g.beginPath(); [...lipU, ...lipL].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
      g.fillStyle = '#efeee8'; g.beginPath(); g.ellipse(0.38, -0.45, 0.11, 0.07, -0.25, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111'; g.beginPath(); g.arc(0.35, -0.45, 0.045, 0, Math.PI * 2); g.fill();
    });
  }
  // weathering
  P.noise({ alpha: 0.08, scale: 2.2, stretch: [1.6, 1], rough: 0.06 });
  P.noise({ alpha: 0.05, scale: 0.7, mode: 'light' });
  for (let i = 0; i < 22; i++) { const z = -3 + rnd() * 9, t = (rnd() < 0.5 ? 0.02 : 0.9) + rnd() * 0.08; P.streak(z, t, z + 0.6 + rnd(), t, 0.012 + rnd() * 0.012, { alpha: 0.1 + rnd() * 0.12 }); }
  P.fill((g) => g.rect(4.6, 0.38, 2.4, 0.24), { color: '#2e2b28' }, { alpha: 0.25, feather: 18 });    // engine exhaust staining on the spine
  void T_SILL;

  // ================= engine nacelles (a = z, b = t around, 0 = bottom, 0.25 outboard) =================
  {
    const Q = atlas.pen(cNac);
    Q.fill('all', paintF(SC.top));
    camo(Q, 1.6, 4.45, 0, 1, 1.2, 0.3);
    for (const z of [2.05, 2.75, 3.5, 4.1]) Q.ring(z, 0, 1, line);
    for (const t of [0.14, 0.36, 0.64, 0.86]) Q.line([[2.05, t], [4.1, t]], line);
    Q.panel(2.2, 0.17, 3.4, 0.33, { ...line, r: 0.04 });
    Q.panel(2.2, 0.67, 3.4, 0.83, { ...line, r: 0.04 });
    Q.fill((g) => g.rect(3.95, 0, 0.5, 1), { color: '#3a3632', rough: 0.6, metal: 0.4 }, { alpha: 0.45, feather: 10 });
    for (let i = 0; i < 10; i++) { const t = rnd(); Q.streak(3.6 + rnd() * 0.4, t, 4.45, t, 0.03 + rnd() * 0.04, { alpha: 0.18 }); }
    Q.decalT(2.3, 0.25, { girth: 4.1 }, (g) => { g.fillStyle = '#a02a24'; g.beginPath(); g.moveTo(-0.07, -0.08); g.lineTo(-0.07, 0.08); g.lineTo(0.08, 0); g.closePath(); g.fill(); });
    Q.decalT(2.6, 0.25, { girth: 4.1 }, (g) => { g.fillStyle = '#a02a24'; g.font = '700 0.07px sans-serif'; g.textAlign = 'center'; g.fillText('DANGER', 0, 0.025); });
    Q.noise({ alpha: 0.08, scale: 1.4, rough: 0.05 });
  }

  // ================= wings =================
  for (const key of ['R', 'L']) {
    const s = key === 'R' ? 1 : -1, wg = W.R;
    const at = (x, f) => { const p = wg.at(x, f); return [p[0], p[2]]; };
    for (const [chart, fin2, isTop] of [[cWT[key], top, true], ...(key === 'R' ? [[cWB, under, false]] : [])]) {
      const Q = atlas.pen(chart);
      Q.fill('all', SC.camo ? top : fin2);
      if (isTop) camo(Q, s > 0 ? 0.5 : -8.85, s > 0 ? 8.85 : -0.5, -1.12, 2.12, 2.8);
      const ln = (pts, op) => Q.line(pts.map(p => [p[0] * s, p[1]]), op);
      for (const f of [0.15, 0.32, 0.55, 0.72]) ln([at(0.6, f), at(2.95, f), at(8.25, f)], line);
      for (const x of [1.2, 2.2, 2.95, 3.6, 4.7, 5.6, 6.5, 7.4, 8.25]) ln([at(x, 0.01), at(x, 0.99)], line);
      const hz = (x) => wg.lines.hte.at(wg.spanToU(x));
      for (const [a, b] of [[0.8, 2.2], [3.0, 4.65], [4.75, 8.15]]) ln([at(a, 1), at(a, hz(a)), at(b, hz(b)), at(b, 1)], gap);
      ln([at(0.8, 0), at(0.8, 0.15), at(2.2, 0.15), at(2.2, 0)], gap);
      for (const f of [0.15, 0.55]) { const a = at(0.7, f + 0.012), b = at(8.2, f + 0.012); Q.rivets(a[0] * s, a[1], b[0] * s, b[1], 0.04, riv); }
      const le = [at(0.8, 0.006), at(8.6, 0.006)].map(p => [p[0] * s, p[1]]);
      Q.wear((g) => { g.moveTo(le[0][0], le[0][1]); g.lineTo(le[1][0], le[1][1]); }, 0.04, { color: '#7d8186', rough: 0.45, metal: 0.5 }, { alpha: 0.3 });
      Q.noise({ alpha: 0.09, scale: 1.2, stretch: [1, 2.5], rough: 0.06 });
      for (let i = 0; i < 10; i++) { const x = 1 + rnd() * 7, a = at(x, hz(x)); Q.streak(a[0] * s, a[1], a[0] * s, a[1] + 0.25 + rnd() * 0.3, 0.03, { alpha: 0.15 }); }
      if (isTop) {
        const w0 = at(0.75, 0.2), w1 = at(0.75, 0.62), w2 = at(1.5, 0.62), w3 = at(1.5, 0.2);
        ln([w0, w1, w2, w3, w0], { px: 1.5, depth: 0.1, dark: 0.45 });
        const p = at(3.6, 0.45); Q.text('NO STEP', p[0] * s, p[1], 0.07, { color: mark, rot: s > 0 ? -90 : 90 });
        if (key === 'L') { const c = at(6.0, 0.4); Q.decal(c[0] * s, c[1], (g) => K.drawStarBar(g, 0.7, { lowVis: SC.camo ? '#141514' : '#3a3e42' })); }
        const fl = at(7.6, 0.3); Q.fill((g) => g.rect(fl[0] * s - 0.25, fl[1] - 0.03, 0.5, 0.06), slime);
      }
    }
  }
  // ================= tailplane =================
  for (const [chart, f, isTop] of [[cST, top, true], [cSB, under, false]]) {
    const Q = atlas.pen(chart); Q.fill('all', SC.camo ? top : f);
    if (isTop) camo(Q, 0, 2.85, 6.35, 8.3, 1.0);
    for (const zz of [6.85, 7.35]) Q.line([[0.1, zz], [2.75, zz]], line);
    for (const x of [0.7, 1.4, 2.1]) Q.line([[x, 6.4], [x, 8.25]], line);
    Q.line([[0.32, 8.3], [0.32, 6.4 + 1.85 * 0.62], [2.66, 6.45 + 1.75 * 0.6], [2.66, 8.3]], gap);
    Q.noise({ alpha: 0.09, scale: 1.0, stretch: [1, 2], rough: 0.06 });
    Q.fill((g) => g.rect(2.4, 7.7, 0.3, 0.6), { color: '#2e2b28' }, { alpha: isTop ? 0.0 : 0.0 });
  }
  // ================= fins (L chart = faces seen from the left) =================
  for (const key of ['L', 'R']) {
    const Q = atlas.pen(cFin[key]); Q.fill('all', top);
    camo(Q, 6.6, 9.0, 0, 2.92, 1.6);
    const fin = fins.R;
    const at = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    const hz = (y) => fin.lines.rh.at(fin.spanToU(y));
    Q.fill([[6.6, 2.5], [9.0, 2.5], [9.0, 2.92], [6.6, 2.92]], F.semigloss(SC.band));
    if (SC.band2) for (let i = 0; i < 5; i++) Q.decal(6.95 + i * 0.36, 2.68, (g) => { g.fillStyle = SC.band2; star(g, 0.07); });
    Q.line([at(0.88, 1), at(0.88, hz(0.88)), at(2.62, hz(2.62)), at(2.62, 1)], gap);
    for (const y of [0.45, 0.88, 1.5, 2.05, 2.5]) Q.line([at(y, 0.02), at(y, Math.min(0.98, hz(Math.max(0.9, y))))], line);
    for (const f of [0.25, 0.5]) Q.line([at(0.3, f), at(2.7, f)], line);
    const c = at(1.85, 0.36);
    Q.text(SC.code, c[0], c[1], 0.5, { color: mark, weight: 700 });
    const d = at(1.2, 0.36), fw = key === 'L' ? 1 : -1;
    Q.text(SC.serial[0], d[0] - fw * 0.3, d[1] + 0.03, 0.085, { color: mark, weight: 700 });
    Q.text(SC.serial[1], d[0] + fw * 0.28, d[1], 0.2, { color: mark, weight: 700 });
    const fl = at(2.25, 0.5); Q.fill((g) => g.rect(fl[0] - 0.28, fl[1] - 0.03, 0.56, 0.06), slime);
    Q.noise({ alpha: 0.08, scale: 1.2, stretch: [1, 1.5], rough: 0.05 });
  }
  // ================= main-gear pods (t: 0 = bottom) =================
  {
    const Q = atlas.pen(cPod);
    Q.fill('all', SC.camo ? top : under);
    camo(Q, -2.3, 1.85, 0, 1, 1.0, 0.3);
    Q.fill([[-1.42, 0], [0.2, 0], [0.2, 0.07], [-1.42, 0.07]], { color: '#16181a', rough: 0.9, metal: 0 });
    Q.fill([[-1.42, 1], [0.2, 1], [0.2, 0.93], [-1.42, 0.93]], { color: '#16181a', rough: 0.9, metal: 0 });
    for (const z of [-1.55, -0.5, 0.5, 1.2]) Q.ring(z, 0, 1, line);
    Q.line([[-1.42, 0.07], [0.2, 0.07]], gap); Q.line([[-1.42, 0.93], [0.2, 0.93]], gap);
    Q.noise({ alpha: 0.08, scale: 1.0, rough: 0.05 });
    for (let i = 0; i < 8; i++) { const t = 0.08 + rnd() * 0.14; Q.streak(-0.2 + rnd(), t, 1.2 + rnd() * 0.4, t, 0.01, { alpha: 0.15 }); }
  }
  // ================= instrument panel (A-10C: two MFCDs, UFC, standby instruments) =================
  {
    const Q = atlas.pen(cPanel); Q.fill('all', { color: '#2a2e31', rough: 0.6, metal: 0 });
    const scr = (a, b, w, h, col) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#050607', rough: 0.15, metal: 0 }); Q.fill((g) => g.rect(a + 0.008, b + 0.008, w - 0.016, h - 0.016), { color: col, rough: 0.12, metal: 0, emissive: col }); };
    scr(0.04, 0.2, 0.2, 0.2, '#0c2a14'); scr(0.66, 0.2, 0.2, 0.2, '#0c2a14');
    Q.fill((g) => g.rect(0.33, 0.02, 0.24, 0.12), { color: '#1a1c1e', rough: 0.5, metal: 0 }); scr(0.36, 0.04, 0.18, 0.04, '#2a3a12');
    for (let i = 0; i < 6; i++) Q.fill((g) => { g.arc(0.33 + (i % 3) * 0.08, 0.22 + Math.floor(i / 3) * 0.1, 0.03, 0, Math.PI * 2); }, { color: '#0b0c0d', rough: 0.2, metal: 0 });
  }
}

/** Five-pointed star centred on the origin. */
function star(g, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.4 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath(); g.fill();
}
