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
//   engines: TF34 pods, centres x ±1.2, y 1.45 (from front / rear the gap between the pods is about one pod diameter and
//     the pods sit above the spine), each on a short upright pylon canted ~30° outboard; highlight z 1.65, fan exit z 4.4,
//     core nozzle 5.1; separate-flow exhaust (no mixer)
//   tailplane: straight, span 5.5 (tips ±2.75), y 0.68, LE z 6.4, chord 1.85; twin fins at the tips, y 0.08 … 2.82, TE z ≈ 8.95
//   gear (geometry.js): nose [0.3, −1.65, −4.7] r 0.28 offset right, retracts forward; mains [±2.5, −1.65, 0.4] r 0.45
//   pilot eye [0, 1.3, −3.95]
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['ghost', 'shark', 'europe1'];

const SCHEMES = {   // every serial, tail code, unit and name below is invented
  ghost: { name: 'Compass Ghost two-tone grey, 587th TFS "Ridgebacks" (invented), hard-worked line jet', top: '#5c6267', under: '#8a9196', nose: '#5c6267', mark: '#33373b',
    code: 'QV', serial: ['AF 83', '0962'], band: '#33373b', band2: null, falseCanopy: true, weather: 1, fade: 0.14,
    pilot: 'LT COL R. "TUSK" HALVERSEN', chief: 'SSGT M. OKAFOR', unit: '587 TFS' },
  shark: { name: '696th FS "Makos" shark-mouth (invented unit)', top: '#5a6065', under: '#888f95', nose: '#5a6065', mark: '#2a2d30',
    code: 'XT', serial: ['AF 83', '0247'], band: '#1d3d7a', band2: '#e8e6de', falseCanopy: true, shark: true, weather: 0.75, fade: 0.1,
    pilot: 'MAJ D. "BRISKET" OYELARAN', chief: 'TSGT K. VANTERPOOL', unit: '696 FS' },
  europe1: { name: 'European One wraparound camouflage, 1980s forward-deployed wing (invented)', top: '#3b4836', under: '#3b4836', nose: '#3b4836', mark: '#161816',
    code: 'ZB', serial: ['AF 83', '0184'], band: '#8a2a22', band2: null, falseCanopy: false, camo: ['#3b4836', '#56634b', '#3f4346'], weather: 0.9, fade: 0.08,
    pilot: 'CAPT J. "MOSS" ABERNATHY', chief: 'SGT P. LINDQVIST', unit: '609 TFS' },
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
  const cWB = { R: atlas.chart('wingBotR', { type: 'plan', x: [0.5, 8.85], z: [-1.12, 2.12], view: 'bottom', density: 0.62 }), L: atlas.chart('wingBotL', { type: 'plan', x: [-8.85, -0.5], z: [-1.12, 2.12], view: 'bottom', density: 0.62 }) };
  const cST = atlas.chart('stabTop', { type: 'plan', x: [0, 2.85], z: [6.35, 8.3], view: 'top', mirror: true, density: 0.9 });
  const cSB = atlas.chart('stabBot', { type: 'plan', x: [0, 2.85], z: [6.35, 8.3], view: 'bottom', mirror: true, density: 0.7 });
  const cFin = { L: atlas.chart('finLV', { type: 'side', z: [6.6, 9.0], y: [-0.1, 2.92], view: 'left' }), R: atlas.chart('finRV', { type: 'side', z: [6.6, 9.0], y: [-0.1, 2.92], view: 'right' }) };
  const cPod = atlas.chart('pod', { type: 'unwrap', z: [-2.3, 1.85], girth: 2.0, vScale: 0.8, density: 0.8 });
  const cNac = atlas.chart('nac', { type: 'unwrap', z: [1.6, 4.45], girth: 4.2, vScale: 0.8, density: 0.85 });
  const cPanel = atlas.chart('panel', { type: 'rect', w: 0.9, h: 0.5, density: 2.6 });
  const cCons = atlas.chart('consoles', { type: 'rect', w: 0.52, h: 1.5, density: 1.5 });     // left console a 0..0.25, right 0.27..0.52 (a from the outboard / inboard edge, b = z + 4.3)
  atlas.pack();
  const U = {
    under: atlas.swatch('under', paintF(SC.under)), top: atlas.swatch('top', paintF(SC.top)), dark: atlas.swatch('dark', F.darkGrey), black: atlas.swatch('black', F.black),
    gun: atlas.swatch('gun', { color: '#2b2a29', rough: 0.45, metal: 0.85 }), bore: atlas.swatch('bore', { color: '#050505', rough: 0.9, metal: 0 }),
    steel: atlas.swatch('steel', F.steel), well: atlas.swatch('well', F.gearWhite), wellDark: atlas.swatch('wellDark', { color: '#8e918c', rough: 0.7, metal: 0.05 }), interior: atlas.swatch('interior', F.interior),
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
    hydr: atlas.swatch('hydr', { color: '#2a2b2a', rough: 0.55, metal: 0.3 }), brake: atlas.swatch('brake', { color: '#6b6560', rough: 0.45, metal: 0.85 }), brakeDark: atlas.swatch('brakeDark', { color: '#3a3836', rough: 0.6, metal: 0.6 }),
    coaming: atlas.swatch('coaming', { color: '#1e2022', rough: 0.85, metal: 0 }), bezel: atlas.swatch('bezel', { color: '#151617', rough: 0.55, metal: 0.1 }), grip: atlas.swatch('grip', { color: '#121212', rough: 0.7, metal: 0 }),
    mirror: atlas.swatch('mirror', { color: '#d8dcdf', rough: 0.04, metal: 1 }),
    dispenser: atlas.swatch('dispenser', { color: '#3d4144', rough: 0.6, metal: 0.2 }), radome: atlas.swatch('radome', paintF('#4a4f53')),
    inner: atlas.swatch('inner', paintF('#5f6468')), bombBand: atlas.swatch('bombBand', paintF('#d4b21c')),
    exhaust: atlas.swatch('exhaust', F.exhaust), heat: atlas.swatch('heat', F.heatStained),
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
  // frames are double-skinned so they also read from the seat (a single outward skin is culled from inside)
  const frameLoft = (zr, tr, inf, uv) => { const m = canLoft(zr, tr, inf, uv); return m.add(canLoft(zr, tr, -0.0015, uv).flip()); };
  // windscreen: flat armoured front panel between two corner posts, curved side panels, heavy arch at the canopy joint
  const TW = 0.085;   // half-width of the flat front panel in ring parameter
  stat.add(frameLoft([-4.95, ZW], [0.25, 0.25 + ct], 0.006, U.frame)).add(frameLoft([-4.95, ZW], [0.75 - ct, 0.75], 0.006, U.frame));
  stat.add(frameLoft([ZW - 0.06, ZW], [0.25, 0.75], 0.008, U.frame)).add(frameLoft([-4.95, -4.89], [0.25, 0.75], 0.005, U.frame));
  for (const tc of [0.5 - TW, 0.5 + TW]) stat.add(frameLoft([-4.95, ZW], [tc - ct * 0.3, tc + ct * 0.3], 0.007, U.frame));
  const frameMove = K.merge(
    frameLoft([ZW, -2.55], [0.25, 0.25 + ct * 0.7], 0.004, U.frame), frameLoft([ZW, -2.55], [0.75 - ct * 0.7, 0.75], 0.004, U.frame),
    frameLoft([ZW, ZW + 0.04], [0.25, 0.75], 0.005, U.frame), frameLoft([-2.68, -2.55], [0.25, 0.75], 0.005, U.frame));

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
  // glareshield: padded coaming over the front panel, narrowing toward the windscreen
  {
    const gs = K.prism([[-4.92, 0.9], [-4.92, 0.965], [-4.62, 1.0], [-4.575, 0.995], [-4.56, 0.975], [-4.56, 0.9]], -0.46, 0.46, U.coaming);
    for (let i = 0; i < gs.p.length; i += 3) gs.p[i] *= 0.62 + 0.38 * Math.min(1, (gs.p[i + 2] + 4.92) / 0.36);
    stat.add(gs);
  }
  // front instrument panel: a tilted face mapped onto the 'panel' chart (a = x + 0.45, b = 0 at the top … 0.5 at the bottom)
  const PNL = { yT: 0.95, yB: 0.5, zT: -4.565, zB: -4.475 };
  const pnN = (() => { const dy = PNL.yT - PNL.yB, dz = PNL.zB - PNL.zT, l = Math.hypot(dy, dz); return [0, dz / l, dy / l]; })();   // faces the pilot
  const pnl = (a, b, d = 0) => { const f = b / 0.5; return [a - 0.45, PNL.yT + (PNL.yB - PNL.yT) * f + pnN[1] * d, PNL.zT + (PNL.zB - PNL.zT) * f + pnN[2] * d]; };
  const quadUV = (pts, uvs, nrm) => { const i0 = stat.vertexCount; pts.forEach((p, k) => stat.vert(p[0], p[1], p[2], nrm[0], nrm[1], nrm[2], uvs[k][0], uvs[k][1])); stat.quad(i0, i0 + 1, i0 + 2, i0 + 3); };
  {
    const A = [[0.03, 0.5], [0.87, 0.5], [0.87, 0.0], [0.03, 0.0]];
    quadUV(A.map(([a, b]) => pnl(a, b)), A.map(([a, b]) => cPanel.uv(a, b)), pnN);
    // MFCD bezels (two colour displays), UFC block stand proud of the panel
    const tilt = Math.atan2(PNL.zT - PNL.zB, PNL.yT - PNL.yB);
    const bezel = (a0, b0, w, h) => {
      const c = pnl(a0 + w / 2, b0 + h / 2, 0.012);
      for (const [dx, dy, sx2, sy2] of [[0, h / 2 + 0.012, w + 0.05, 0.024], [0, -h / 2 - 0.012, w + 0.05, 0.024], [w / 2 + 0.012, 0, 0.024, h], [-w / 2 - 0.012, 0, 0.024, h]])
        stat.add(K.box(sx2, sy2, 0.026, U.bezel).translate(dx, dy, 0).rotateX(tilt).translate(c[0], c[1], c[2]));
    };
    bezel(0.04, 0.2, 0.2, 0.2); bezel(0.66, 0.2, 0.2, 0.2);
    const u = pnl(0.45, 0.0725, 0.04); stat.add(K.box(0.25, 0.135, 0.08, U.bezel).rotateX(tilt).translate(u[0], u[1], u[2]));
    const uf = [[0.335, 0.135], [0.565, 0.135], [0.565, 0.01], [0.335, 0.01]];
    quadUV(uf.map(([a, b]) => pnl(a, b, 0.081)), uf.map(([a, b]) => cPanel.uv(a, b)), pnN);
  }
  // side consoles with panels on top (left: throttles, fuel, comms; right: lighting, oxygen, CDU)
  for (const sx of [-1, 1]) {
    stat.add(K.box(0.25, 0.4, 1.5, U.console).translate(sx * 0.425, 0.46, -3.55));
    const y = 0.661, xa = sx < 0 ? -0.55 : 0.3, xb = xa + 0.25, a0 = sx < 0 ? 0 : 0.27;
    const pts = [[xa, y, -4.3], [xa, y, -2.8], [xb, y, -2.8], [xb, y, -4.3]];
    quadUV(pts, pts.map(([x, , z]) => cCons.uv(a0 + (x - xa), z + 4.3)), [0, 1, 0]);
  }
  // throttle quadrant (two TF34 levers with grips), rudder pedals, stick, ACES II seat
  for (const k of [-1, 1]) {
    const x = -0.43 + k * 0.035;
    stat.add(K.box(0.022, 0.12, 0.03, U.dark).translate(x, 0.72, -3.82));
    stat.add(K.box(0.05, 0.05, 0.1, U.grip).translate(x - 0.01, 0.79, -3.84));
  }
  stat.add(K.box(0.1, 0.03, 0.34, U.dark).translate(-0.43, 0.67, -3.8));
  for (const k of [-1, 1]) { stat.add(K.box(0.09, 0.16, 0.03, U.dark).rotateX(-0.35).translate(k * 0.16, 0.32, -4.72)); stat.add(K.box(0.03, 0.03, 0.3, U.steel).translate(k * 0.16, 0.25, -4.58)); }
  stat.add(K.stick({ base: [0, 0.35, -4.1], height: 0.4, uv: U.black, uvGrip: U.grip }));
  stat.add(K.ejectionSeat({ eye, recline: 12, uv: { frame: U.seat, cushion: U.cushion, accent: U.accent } }));
  stat.add(K.box(0.36, 0.2, 0.12, U.seat).translate(0, eye[1] + 0.05, eye[2] + 0.33));              // ACES II headbox / parachute container
  stat.add(K.box(0.06, 0.012, 0.012, U.accent).translate(0, eye[1] - 0.52, eye[2] - 0.12));          // ejection handle
  const hudParts = K.hud({ eye, dist: 0.56, width: 0.2, height: 0.19, drop: 0.08, uv: U.bezel });
  stat.add(hudParts.frame);
  // canopy rails along the sills
  for (const sx of [-1, 1]) {
    const pts = []; for (let z = Z_CK[0] + 0.05; z <= Z_CK[1] - 0.04; z += 0.4) { const p = fus.at(z, sx > 0 ? T_SILL : 1 - T_SILL).p; pts.push([p[0] - sx * 0.035, p[1] + 0.015, z]); }
    stat.add(K.pipe(pts, 0.012, { segments: 6, uv: U.frame }));
  }
  // three rear-view mirrors on the canopy bow (they open with the canopy)
  for (const [x, dy, yaw] of [[0, 0.07, 0], [-0.26, 0.17, 0.35], [0.26, 0.17, -0.35]]) {
    const y = canTop(ZW + 0.06) - dy - (Math.abs(x) > 0 ? 0.0 : 0);
    frameMove.add(K.box(0.15, 0.05, 0.012, U.mirror).rotateX(-0.25).rotateY(yaw).translate(x, y, ZW + 0.07));
    frameMove.add(K.box(0.012, 0.04, 0.012, U.frame).translate(x, y + 0.04, ZW + 0.06));
  }
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
    charts: { upper: side > 0 ? cWT.R : cWT.L, lower: side > 0 ? cWB.R : cWB.L }, innerUV: U.inner,
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
    const segP = Math.max(20, Math.round(32 * detail / 4) * 4);
    pods[key] = K.loft({ stations: podSt(sx), segments: segP, step: 0.12 / detail, chart: cPod,
      cutouts: [{ name: 'slot', z: [-1.42, 0.22], t: [0, 3 / segP], mirror: true }] });       // open wheel slot along the pod belly
    stat.add(pods[key].mesh);
    for (const h of ['slotR', 'slotL']) if (pods[key].patches[h]) stat.add(K.well(pods[key].patches[h], 0.36, U.wellDark, [0, 1, 0]));
  }
  cPod.body = pods.R;

  // ---- tailplane and twin fins ------------------------------------------------------------------------------------------------
  const TY = 0.68, TLE = 6.4, TC = 1.85, FX = 2.75;
  const mkStab = (side) => K.wing({
    side, airfoil: K.naca4('0010'), chordPts: Math.round(9 * detail), spanAxis: 'x', tip: 'none',
    stations: [{ x: 0.1, y: TY, z: TLE, chord: TC, tc: 0.1 }, { x: FX, y: TY, z: TLE + 0.05, chord: TC - 0.1, tc: 0.09 }],
    lines: { eh: [[0.1, 0.62], [FX, 0.6]] },
    controls: [{ name: 'elevator', type: 'flap', span: [0.32, 2.66], from: 'eh', nose: 1 }],
    charts: { upper: cST, lower: cSB }, innerUV: U.inner,
  });
  const stab = { R: mkStab(1), L: mkStab(-1) };
  stat.add(stab.R.mesh).add(stab.L.mesh);
  const FINST = [[-0.05, 7.42, 8.76], [0.05, 7.0, 8.87], [0.25, 6.76, 8.93], [1.5, 6.86, 8.95], [2.5, 7.05, 8.95], [2.7, 7.25, 8.9], [2.82, 7.62, 8.7]];
  const RZ = 8.3;
  const mkFin = (sx) => K.wing({
    airfoil: K.naca4('0008'), chordPts: Math.round(10 * detail), spanAxis: 'y', tip: 'flat', root: 'flat',
    stations: FINST.map(([y, le, te]) => ({ x: sx * FX, y, z: le, chord: te - le, tc: 0.075 })),
    lines: { rh: [[-0.05, (RZ - 7.42) / 1.34], [0.05, (RZ - 7.0) / 1.87], [0.25, (RZ - 6.76) / 2.17], [1.5, (RZ - 6.86) / 2.09], [2.5, (RZ - 7.05) / 1.9], [2.7, (RZ - 7.25) / 1.65]] },
    controls: [{ name: 'rudder', type: 'flap', span: [0.12, 2.62], from: 'rh', nose: 1 }],   // full-height rudder, above and below the tailplane
    charts: { upper: cFin.L, lower: cFin.R }, innerUV: U.inner,
  });
  const fins = { R: mkFin(1), L: mkFin(-1) };
  stat.add(fins.R.mesh).add(fins.L.mesh);

  // ---- TF34 engine pods on short canted pylons ----------------------------------------------------------------------------
  const ENG = G.engines.map(e => e.intake);          // [x, y, z] of each inlet highlight centre (left first)
  const eng = [];
  const pylonR = (() => {   // short, upright pylon canted ~30° outboard: from the aft fuselage shoulder up into the nacelle's inboard belly
    const c = [Math.abs(ENG[1][0]), ENG[1][1]], r0 = [0.2, fus.topAt(3.0) - 0.07];
    const dx = c[0] - r0[0], dy = c[1] - r0[1], l = Math.hypot(dx, dy), tip = [c[0] - dx / l * 0.4, c[1] - dy / l * 0.4];
    return K.wing({
      stations: [{ x: r0[0], y: r0[1], z: 2.2, chord: 2.05, tc: 0.105 }, { x: (r0[0] + tip[0]) / 2, y: (r0[1] + tip[1]) / 2, z: 2.3, chord: 1.88, tc: 0.105 },
        { x: tip[0], y: tip[1], z: 2.38, chord: 1.72, tc: 0.115 }],
      airfoil: K.naca4('0012'), spanAxis: 'u', tip: 'flat', root: 'flat', chordPts: 10, uv: U.top, edgeUV: U.top, side: 1,
    });
  })();
  for (const [i, c] of ENG.entries()) {
    const sx = Math.sign(c[0]);
    const n = K.nacelle({ centre: c, length: 2.75, rHi: 0.54, rMax: 0.618, rThroat: 0.492, rFan: 0.49, zFan: 0.42, rExit: 0.555, sleeve: 0,
      core: { r0: 0.39, r1: 0.285, length: 0.72 }, plug: { r: 0.165, length: 0.4 }, segments: Math.max(28, Math.round(48 * detail / 4) * 4),
      uv: U.nac, uvLip: U.lip, uvInner: U.duct, uvCore: U.core, uvPlug: U.plug });
    // re-map the outer cowl onto the nacelle chart (panel lines + soot), keep the inlet duct and lip swatches
    const m = n.cowl, rx = c[0], ry = c[1];
    for (let v = 0; v < m.vertexCount; v++) {
      const x = m.p[v * 3], y = m.p[v * 3 + 1], z = m.p[v * 3 + 2], r = Math.hypot(x - rx, y - ry);
      if (z > c[2] + 0.07 && r > 0.53 && m.n[v * 3 + 2] > -0.6) {
        let t = Math.atan2(sx * (x - rx), -(y - ry)) / (Math.PI * 2); if (t < 0) t += 1;
        const uv = cNac.uvUnwrap(Math.min(4.44, z), t, 0); m.uv[v * 2] = uv[0]; m.uv[v * 2 + 1] = uv[1];
      }
    }
    stat.add(m).add(n.core).add(n.plug);
    // core nozzle lip: heat-blued ring at the core exit (TF34 is a separate-flow engine: no mixer)
    const zx = c[2] + 2.75;
    stat.add(K.lathe([[0.293, zx + 0.7], [0.3, zx + 0.735, 1], [0.27, zx + 0.74]], { segments: 28, uv: U.heat }).translate(c[0], c[1], 0));
    stat.add(K.fanBackdrop(0.49, n.fanZ + 0.35, U.black).translate(c[0], c[1], 0));
    // inlet: acoustic liner band, anti-ice lip ring, fan-case rub strip
    stat.add(K.lathe([[0.494, c[2] + 0.36], [0.494, c[2] + 0.12]], { segments: 32, uv: U.acoustic }).translate(c[0], c[1], 0));
    stat.add(sx < 0 ? pylonR.mesh.mirrorX() : pylonR.mesh);
    eng.push({ c, n, fanMesh: K.fan({ radius: 0.485, hub: 0.17, blades: 28, spinner: 0.2, uvBlade: U.blade, uvSpinner: U.spinner }) });
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
    const gbu12 = (x, y, z) => K.missile({ length: 3.27, radius: 0.137, canards: { z: 0.32, chord: 0.22, span: 0.09 }, wings: { z: 2.62, chord: 0.6, span: 0.3 }, uvBody: U.bomb, uvNose: U.bombNose, uvFin: U.bomb, roll: 45 })
      .add(K.lathe([[0.139, 0.62], [0.139, 0.7]], { segments: 12, uv: U.bombBand })).translate(x, y, z);   // yellow HE band
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

  // ---- modelled details where the eye goes ----------------------------------------------------------------------------------
  {
    // Pave Penny laser-spot tracker on its short pylon, right side of the nose below the windscreen
    const pp = fus.at(-4.75, 0.31).p;
    stat.add(K.pylon([{ y: pp[1] + 0.06, z0: -4.95, z1: -4.45, x: pp[0] - 0.04, tc: 0.12 }, { y: pp[1] - 0.16, z0: -4.92, z1: -4.5, x: pp[0] + 0.07, tc: 0.12 }], { uv: U.pylon }));
    stat.add(K.tank({ length: 0.82, radius: 0.085, nose: 0.12, tail: 0.25, uv: U.pod }).translate(pp[0] + 0.08, pp[1] - 0.24, -5.2));
    stat.add(K.lathe([[0, -5.215], [0.07, -5.205, 1], [0.072, -5.19]], { segments: 14, uv: U.podWin }).translate(pp[0] + 0.08, pp[1] - 0.24, 0));
    // GAU-8 gun-gas diverter: the slotted shroud ring in front of the gun bay, two purge vents under the nose
    stat.add(K.lathe([[0.215, -6.6], [0.225, -6.56, 1], [0.225, -6.48, 1], [0.205, -6.45]], { segments: 18, uv: U.gun }).translate(GUN[0], GUN[1], 0));
    for (const sx of [-1, 1]) { const v = fus.at(-5.95, sx > 0 ? 0.06 : 0.94).p; stat.add(K.box(0.07, 0.03, 0.26, U.black).translate(v[0], v[1] + 0.01, v[2])); }
    // boarding-ladder door (left side under the canopy) and the kick-in step above it
    { const v = fus.at(-3.6, 0.79).p; stat.add(K.box(0.012, 0.09, 0.16, U.dark).translate(v[0] - 0.004, v[1], v[2])); }
    // AoA / stall-warning vanes on the nose sides
    for (const sx of [-1, 1]) {
      const v = fus.at(-5.35, sx > 0 ? 0.36 : 0.64).p;
      stat.add(K.lathe([[0, -0.012], [0.045, -0.01, 1], [0.045, 0.0, 1], [0, 0]], { segments: 10, uv: U.probe }).rotateY(sx * Math.PI / 2).translate(v[0], v[1], v[2]));
      stat.add(K.prism([[-0.0, 0], [0.09, 0.012], [0.09, 0.03], [0.0, 0.038]], -0.004, 0.004, U.black).translate(v[0] + sx * 0.012, v[1] - 0.02, v[2]));
    }
    // chaff / flare dispensers: under the drooped wingtips and in the tail of each main-gear pod
    for (const sx of [-1, 1]) {
      const q = W.R.at(8.5, 0.4, 'lower');
      stat.add(K.box(0.14, 0.05, 0.42, U.dispenser).translate(sx * q[0], q[1] - 0.02, q[2]));
      stat.add(K.box(0.2, 0.04, 0.36, U.dispenser).translate(sx * PODX, PODY - 0.215, 1.2));
    }
    // sway braces under every wing pylon: four little screw-jack pads either side of the bomb rack
    const braces = (x, y, z) => { for (const dz of [-0.36, 0.36]) for (const dx of [-0.075, 0.075]) stat.add(K.tube([x + dx * 0.6, y + 0.02, z + dz], [x + dx * 1.3, y - 0.07, z + dz], 0.012, 0.016, { segments: 5, uv: U.steel })); };
    for (const x of [-6.35, -4.9, -3.45, -1.55, 1.55, 3.45, 4.9, 6.35]) {
      const ax = Math.abs(x), zf = wLE(ax) + wC(ax) * 0.12, y0 = W.R.at(ax, 0.35, 'lower')[1];
      braces(x, y0 - (ax < 2 ? 0.32 : ax < 4 ? 0.3 : ax < 5.5 ? 0.27 : 0.24), zf + 0.85);
    }
    // more antennas: UHF/TACAN blades on the spine, GPS patch, IFF under the nose, VHF/FM whip fairing behind the canopy
    stat.add(K.bladeAntenna({ pos: [0, fus.topAt(-0.6) - 0.02, -0.6], height: 0.16, chord: 0.22, sweep: 0.08, uv: U.top }));
    stat.add(K.ellipsoid(0.11, 0.025, 0.14, { segments: 10, rings: 4, uv: U.radome, z0: 0, z1: 1 }).rotateX(-Math.PI / 2).translate(0, fus.topAt(0.6) - 0.004, 0.6));
    stat.add(K.bladeAntenna({ pos: [0.12, fus.botAt(-5.2) + 0.02, -5.2], height: 0.09, chord: 0.12, sweep: 0.05, down: true, uv: U.under }));
    stat.add(K.bladeAntenna({ pos: [-0.12, fus.botAt(-5.2) + 0.02, -5.2], height: 0.09, chord: 0.12, sweep: 0.05, down: true, uv: U.under }));
    // radar-warning receiver bumps on the wingtip leading edges and fin tips, tail-cone RWR
    for (const sx of [-1, 1]) {
      const q = W.R.at(8.62, 0.02, 'mid');
      stat.add(K.ellipsoid(0.05, 0.05, 0.14, { segments: 10, rings: 5, uv: U.radome, z0: -1, z1: 0.2 }).translate(sx * q[0], q[1], q[2] + 0.05));
    }
    stat.add(K.ellipsoid(0.07, 0.07, 0.16, { segments: 12, rings: 6, uv: U.radome, z0: -0.2, z1: 1 }).translate(0, 0.6, 8.9));
    // engine-nacelle details: pylon-to-nacelle fairing strake, oil-cooler scoop, start-cart port
    for (const [i, c] of ENG.entries()) {
      const sx = Math.sign(c[0]);
      stat.add(K.box(0.09, 0.07, 0.22, U.nac).translate(c[0] + sx * 0.38, c[1] - 0.46, c[2] + 1.15));
      stat.add(K.box(0.07, 0.04, 0.12, U.black).translate(c[0] + sx * 0.38, c[1] - 0.47, c[2] + 1.03));
      void i;
    }
  }

  // ---- paint + materials ------------------------------------------------------------------------------------------------------------
  lap('geometry');
  paint(atlas, { SC, fus, W, fins, pods, cFus, cWT, cWB, cST, cSB, cFin, cPod, cNac, cPanel, cCons, paintF, wLE, wC, T_NG, Z_NG, T_SILL });
  lap('paint');
  const mat = atlas.material(ctx, { envMapIntensity: 1, emissiveIntensity: 0.7 });
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
    const C = [c[0], c[1] + gp[i].wheelRadius, c[2]];
    const along = (f, ox = 0, oz = 0) => [piv[0] + (C[0] - piv[0]) * f + ox, piv[1] + (C[1] - piv[1]) * f, piv[2] + (C[2] - piv[2]) * f + oz];
    // strut furniture: brake hydraulic line clipped down the aft face, uplock roller, gland nut collar
    const extra = new K.Mesh();
    extra.add(K.pipe([along(0.02, -sx * 0.07, 0.07), along(0.3, -sx * 0.06, 0.1), along(0.62, -sx * 0.05, 0.1)], 0.011, { segments: 5, uv: U.hydr }));
    extra.add(K.pipe([along(0.04, sx * 0.02, 0.1), along(0.6, sx * 0.03, 0.11)], 0.008, { segments: 5, uv: U.steel }));
    for (const f of [0.15, 0.32, 0.5]) extra.add(K.box(0.05, 0.025, 0.05, U.hydr).translate(...along(f, -sx * 0.06, 0.085)));
    extra.add(K.tube(along(0.08, 0, -0.12), along(0.08, 0, -0.2), 0.04, 0.04, { segments: 8, uv: U.steel }));
    const g = K.buildGear(rig, atlas, {
      name: 'main' + (sx > 0 ? 'R' : 'L'), index: i, contact: c, wheelRadius: gp[i].wheelRadius, wheelWidth: 0.3,
      pivot: piv, stroke: 0.32, staticFrac: 0.35, strutR: 0.085, fork: 'half', wheels: [-sx * OFF], links: 'front',
      retract: { to: stow }, window: [0.05, 0.95], brace: [xs - sx * 0.05, -0.82, -1.3], extra,
    });
    // brake: disc pack housing + caliper on the outboard face of the wheel, rides on the oleo piston (does not spin)
    {
      const wc = [gp[i].pos[0], C[1], C[2]], fx = wc[0] + sx * 0.152, b = new K.Mesh();
      b.add(K.lathe([[0.0, -0.035], [0.205, -0.035, 1], [0.215, -0.02], [0.215, 0.0, 1], [0.0, 0.0]], { segments: 22, uv: U.brake }).rotateY(sx * Math.PI / 2).translate(fx, wc[1], wc[2]));
      b.add(K.box(0.07, 0.16, 0.12, U.brakeDark).translate(fx + sx * 0.02, wc[1] + 0.14, wc[2] - 0.08));
      b.add(K.lathe([[0.0, -0.06], [0.07, -0.06, 1], [0.07, 0.0, 1], [0, 0]], { segments: 10, uv: U.steel }).rotateY(sx * Math.PI / 2).translate(fx + sx * 0.035, wc[1], wc[2]));
      b.add(K.pipe([[fx + sx * 0.03, wc[1] + 0.22, wc[2] - 0.1], [fx + sx * 0.05, wc[1] + 0.4, wc[2] - 0.02]], 0.01, { segments: 5, uv: U.hydr }));
      rig.part('brake' + (sx > 0 ? 'R' : 'L'), b, { parent: g.piston, pivot: C });
    }
    const sw = K.swing(piv, C, stow);
    mains.push({ g, axis: new THREE.Vector3(...sw.axis), angle: sw.angle * DEG, stroke: 0.32, eStatic: 0.32 * 0.65 });
  }

  // ---- lamps ---------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.075, squash: [0.75, 0.75, 1.6] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.075, squash: [0.75, 0.75, 1.6] });
  rig.lamp('nav', [L.navLeft[0] + 0.02, L.navLeft[1] - 0.02, L.navLeft[2] + 1.05], { color: [1, 0.04, 0.02], size: 0.05 });      // aft-facing position lamps
  rig.lamp('nav', [L.navRight[0] - 0.02, L.navRight[1] - 0.02, L.navRight[2] + 1.05], { color: [0.02, 1, 0.25], size: 0.05 });
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.065 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.075 });
  rig.lamp('strobe', [-L.strobe[0], L.strobe[1], L.strobe[2]], { color: [1, 1, 1], size: 0.075 });
  rig.lamp('beacon', L.beacon, { color: [1, 0.1, 0.05], size: 0.085, squash: [1, 0.7, 1] });
  rig.lamp('beacon', [0, fus.botAt(1.5) - 0.03, 1.5], { color: [1, 0.1, 0.05], size: 0.085, squash: [1, 0.7, 1] });
  // NVG formation strip lights, on the pale strips painted on the fuselage sides, aft fuselage, wingtips and fins
  {
    const fc = [0.12, 0.22, 0.14];
    for (const sx of [-1, 1]) {
      for (const [z, y, len] of [[-1.2, 0.2, 0.32], [7.4, 0.5, 0.3]]) {
        const t = fus.tAtY(z, y), q = fus.at(z, sx > 0 ? t : 1 - t), p = q.p, n = q.n;
        rig.lamp('formation', [p[0] + n[0] * 0.006, p[1] + n[1] * 0.006, p[2]], { color: fc, size: len, squash: [0.045, 0.09, 1] });
      }
      const w = W.R.at(7.6, 0.3, 'upper');
      rig.lamp('formation', [sx * w[0], w[1] + 0.008, w[2]], { color: fc, size: 0.25, squash: [1, 0.05, 0.12] });
      const f = fins.R.at(2.25, 0.5, 'lower');
      rig.lamp('formation', [sx * (Math.abs(f[0]) + 0.008), f[1], f[2]], { color: fc, size: 0.28, squash: [0.05, 0.11, 1] });
    }
  }

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
    mat.emissiveIntensity = 0.7 + 0.5 * S.night;      // cockpit displays
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
  const { SC, fus, W, fins, cFus, cWT, cWB, cST, cSB, cFin, cPod, cNac, cPanel, cCons, paintF, T_NG, Z_NG } = o, F = K.FINISH;
  const top = paintF(SC.top), under = paintF(SC.under), mark = SC.mark, wx = SC.weather;
  const markLow = SC.camo ? '#141514' : '#3a3e42';
  const slime = { color: '#c9cf8f', rough: 0.35, metal: 0 };
  const soot = { color: '#1b1a19', rough: 0.85, metal: 0 }, oil = { color: '#2a2620', rough: 0.3, metal: 0.05 };
  const touch = (c, k) => { const n = parseInt(c.slice(1), 16), f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
  const rnd = (() => { let a = 9157; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const line = { px: 1, depth: 0.32, dark: 0.11 }, fine = { px: 0.9, depth: 0.22, dark: 0.07 }, gap = { px: 2, depth: 0.8, dark: 0.5 };
  const riv = { px: 1.05, depth: 0.14, dark: 0.035 }, screw = { px: 1.6, depth: 0.25, dark: 0.06 };
  const camo = (Q, a0, a1, b0, b1, scale, sb = 1) => {   // European One wraparound blobs (paint coordinates; sb scales b)
    if (!SC.camo) return;
    for (const [ci, col] of [[1, SC.camo[1]], [2, SC.camo[2]]]) {
      const n = Math.ceil((a1 - a0) / scale * 1.6);
      for (let i = 0; i < n; i++) {
        const ca = a0 + (i + rnd() * 0.8) * (a1 - a0) / n, cb = b0 + rnd() * (b1 - b0), rA = scale * (0.35 + rnd() * 0.3), rB = rA * sb * (0.6 + rnd() * 0.5);
        Q.fill((g) => { const k = 9; for (let j = 0; j <= k; j++) { const t = j / k * Math.PI * 2, f = 0.75 + 0.3 * Math.sin(t * 3 + ci + i) + 0.12 * Math.sin(t * 5 + i); const x = ca + Math.cos(t) * rA * f, y = cb + Math.sin(t) * rB * f; if (j) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); }, paintF(col), { feather: 2.5 });
      }
    }
  };
  // a block of stencil "text" lines (unreadable at chase distance, reads as maintenance stencilling)
  const stencil = (g, w, rows, col = 'rgba(28,30,33,0.75)') => { g.fillStyle = col; for (let r = 0; r < rows; r++) { const lw = w * (0.45 + ((r * 37) % 11) / 20); g.fillRect(-w / 2, -rows * 0.012 + r * 0.024, lw, 0.011); } };
  const touchUps = (Q, n, a0, a1, b0, b1, base, sz) => {   // fresh-paint touch-up patches (slightly darker / bluer than the faded paint)
    for (let i = 0; i < n * wx; i++) { const a = a0 + rnd() * (a1 - a0), b = b0 + rnd() * (b1 - b0), w = sz * (0.4 + rnd()), h = sz * (0.25 + rnd() * 0.6); Q.fill([[a, b], [a + w, b], [a + w, b + h], [a, b + h]], paintF(touch(base, 0.92 + rnd() * 0.04)), { alpha: 0.4 }); }
  };

  // ================= fuselage (paint coords: z, t; t 0 = belly, 0.25 = right side, 0.5 = spine, 0.75 = left) =================
  const P = atlas.pen(cFus);
  P.fill('all', top);
  if (!SC.camo) P.band(-7.0, 8.95, -Infinity, (z) => (z < -5.6 ? -0.05 : z < -4.6 ? -0.05 + (z + 5.6) * 0.38 : 0.33), under, { feather: 6 });
  camo(P, -7.0, 8.95, 0, 1, 2.6, 0.22);
  // false canopy under the nose (dark gloss grey, the A-10's best-known paint trick)
  if (SC.falseCanopy) {
    const shape = (z) => { const f = (z + 6.15) / 1.45; return f <= 0 || f >= 1 ? 0 : 0.42 * Math.sin(Math.PI * Math.pow(f, 0.7)); };
    const pts = []; for (let i = 0; i <= 16; i++) { const z = -6.15 + 1.45 * i / 16; pts.push([z, shape(z) / fus.girthAt(z, 0)]); }
    P.fill(pts.concat([[-4.7, 0], [-6.15, 0]]), { color: '#2f3337', rough: 0.35, metal: 0.05 });
    P.fill(pts.map(([z, t]) => [z, 1 - t]).concat([[-4.7, 1], [-6.15, 1]]), { color: '#2f3337', rough: 0.35, metal: 0.05 });
  }
  // sun-faded upper surfaces: spine and shoulders lighter and chalkier than the sides
  P.fill((g) => g.rect(-6.5, 0.36, 15.3, 0.28), { color: '#c8ccce', rough: 0.85, metal: 0 }, { alpha: SC.fade, feather: 22 });
  // structure: frames, longerons, armour-tub panels, gun-bay and avionics doors
  const frames = [-6.55, -6.1, -5.75, -5.35, -4.95, -2.55, -2.05, -1.6, -1.2, -0.8, -0.35, 0.1, 0.55, 1.0, 1.45, 1.9, 2.35, 2.8, 3.25, 3.7, 4.15, 4.6, 5.05, 5.5, 5.95, 6.4, 6.85, 7.3, 7.75, 8.2, 8.6];
  for (const z of frames) P.ring(z, 0, 1, Math.abs(z * 20 % 9) < 3 ? line : fine);
  for (const y of [0.05, -0.38, 0.62]) P.yLine(-6.5, 2.3, y, line);
  P.yLine(2.3, 8.6, 0.45, line); P.yLine(2.3, 8.6, -0.1, fine);
  const tY = (z, y, side) => { const t = fus.tAtY(z, y); return side === 'L' ? 1 - t : t; };
  const access = (z0, z1, y0, y1, side, o2 = {}) => {           // access panel with a fastener row round its edge
    P.doorOn(z0, z1, y0, y1, { ...line, side, ...(o2.gap ? gap : {}) });
    if (o2.fast === false) return;
    const e = 0.025, sp = o2.sp ?? 0.065;
    for (const [za, ya, zb, yb] of [[z0 + e, y0 + e, z1 - e, y0 + e], [z0 + e, y1 - e, z1 - e, y1 - e]]) P.rivets(za, tY(za, ya, side), zb, tY(zb, yb, side), sp, screw);
    for (const z of [z0 + e, z1 - e]) P.rivets(z, tY(z, y0 + e, side), z, tY(z, y1 - e, side), sp * 0.8, screw);
  };
  for (const side of ['L', 'R']) {
    // titanium bathtub: big armour plates bolted to the cockpit sides
    for (let z = -4.9; z < -2.6; z += 0.58) access(z, z + 0.56, -0.05, 0.62, side, { sp: 0.08 });
    // gun bay / ammunition drum doors, avionics bays, forward equipment bays
    access(-6.45, -5.8, -0.42, 0.02, side); access(-5.75, -5.05, -0.42, 0.02, side);
    access(-2.5, -1.25, -0.45, 0.05, side, { gap: true }); access(-1.15, 0.0, -0.45, 0.05, side);
    access(0.1, 1.3, 0.12, 0.55, side); access(1.45, 2.3, 0.12, 0.5, side); access(4.6, 5.4, -0.05, 0.38, side, { sp: 0.08 });
    for (const zz of [-1.6, -0.8, 0.1, 1.0, 1.9, 2.8, 3.7, 4.6, 5.5, 6.4, 7.3]) P.rivets(zz + 0.02, tY(zz, -0.3, side), zz + 0.02, tY(zz, 0.6, side), 0.055, riv);
    P.rivets(-1.6, tY(-1.6, 0.06, side), 3.7, tY(3.7, 0.06, side), 0.06, riv);
    // stencils: servicing points, ground points, jacking, fuel, oxygen
    for (const [z, y, w, rows] of [[-5.1, 0.3, 0.22, 3], [-4.4, -0.25, 0.18, 2], [-1.9, 0.35, 0.26, 3], [-0.6, -0.15, 0.2, 2], [0.7, 0.4, 0.3, 4], [1.85, 0.36, 0.2, 2], [3.4, 0.15, 0.16, 2], [5.0, 0.18, 0.18, 3], [6.9, 0.36, 0.14, 2]])
      P.decalOn(z, y, side, (g) => stencil(g, w, rows));
    P.decalOn(-3.9, 0.82, side, (g) => { g.fillStyle = '#c9302a'; g.beginPath(); g.moveTo(0, -0.07); g.lineTo(0.075, 0.06); g.lineTo(-0.075, 0.06); g.closePath(); g.fill(); g.fillStyle = '#fff'; g.fillRect(-0.006, -0.03, 0.012, 0.05); });   // ejection-seat warning triangle
  }
  // boarding ladder door and the kick-step on the left side, refuelling receptacle doors on the nose
  P.doorOn(-3.85, -3.35, -0.5, 0.22, { ...gap, side: 'L' });
  P.textOn('BOARDING LADDER', -3.6, 0.3, 'L', 0.022, { color: mark, weight: 700 });
  P.line([[Z_NG[0], T_NG[0]], [Z_NG[1], T_NG[0]], [Z_NG[1], T_NG[1]], [Z_NG[0], T_NG[1]], [Z_NG[0], T_NG[0]]], gap);
  P.decalT(-5.2, 0.5, {}, (g) => { g.fillStyle = 'rgba(28,30,32,0.7)'; g.beginPath(); g.roundRect(-0.16, -0.13, 0.32, 0.26, 0.04); g.fill(); g.strokeStyle = '#e6e6df'; g.lineWidth = 0.012; for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(-0.75, sx * 0.17); g.lineTo(-0.2, sx * 0.17); g.stroke(); } });
  P.fill([[-6.6, 0.47], [-5.35, 0.45], [-5.35, 0.55], [-6.6, 0.53]], F.matte('#30343a'), { alpha: SC.camo ? 0 : 0.6 });
  // spine walkway between the canopy and the engines: anti-skid strip, scuffed edges
  P.fill([[-2.45, 0.47], [-0.3, 0.47], [-0.3, 0.53], [-2.45, 0.53]], { color: '#2d3033', rough: 0.95, metal: 0 }, { alpha: 0.7 });
  P.wear((g) => { g.moveTo(-2.45, 0.465); g.lineTo(-0.3, 0.465); g.moveTo(-2.45, 0.535); g.lineTo(-0.3, 0.535); }, 0.02, { color: '#8b8f92', rough: 0.6, metal: 0.2 }, { alpha: 0.4 * wx });
  touchUps(P, 18, -6, 7.5, 0.05, 0.95, SC.top, 0.35);
  // markings
  P.decalOn(3.3, 0.28, 'both', (g) => K.drawStarBar(g, 0.62, { lowVis: markLow }));
  P.textOn(SC.pilot, -3.5, 0.72, 'L', 0.042, { color: SC.camo ? '#d8d8cf' : '#2a2d30', weight: 700 });
  P.textOn(SC.chief, -3.5, 0.72, 'R', 0.042, { color: SC.camo ? '#d8d8cf' : '#2a2d30', weight: 700 });
  P.textOn('RESCUE', -2.3, 0.65, 'both', 0.045, { color: '#b9332b' });
  P.decalOn(-2.0, 0.55, 'both', (g) => { g.strokeStyle = '#b9332b'; g.lineWidth = 0.012; g.beginPath(); g.moveTo(-0.1, 0); g.lineTo(0.07, 0); g.moveTo(0.02, -0.04); g.lineTo(0.08, 0); g.lineTo(0.02, 0.04); g.stroke(); });
  P.textOn('U.S. AIR FORCE', 5.4, 0.15, 'both', 0.1, { color: mark, weight: 700, spacing: 0.06 });
  P.decalOn(-1.2, 0.2, 'both', { layers: ['color', 'orm'] }, (g, layer) => { g.fillStyle = layer === 'orm' ? 'rgb(255,90,0)' : slime.color; g.fillRect(-0.32, -0.03, 0.64, 0.06); });
  P.decalOn(7.4, 0.5, 'both', { layers: ['color', 'orm'] }, (g, layer) => { g.fillStyle = layer === 'orm' ? 'rgb(255,90,0)' : slime.color; g.fillRect(-0.3, -0.03, 0.6, 0.06); });
  if (SC.shark) {
    P.decalOn(-6.15, -0.08, 'both', {}, (g, layer, side) => {
      if (side === 'R') g.scale(-1, 1);          // the mouth always opens toward the nose
      const lipU = [[-0.8, 0.0], [-0.45, -0.07], [0.0, -0.1], [0.45, -0.17], [0.78, -0.33]], lipL = [[0.78, -0.33], [0.5, -0.08], [0.1, 0.18], [-0.35, 0.3], [-0.8, 0.33]];
      g.fillStyle = '#9e1f1b'; g.beginPath(); [...lipU, ...lipL].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
      g.fillStyle = '#5a0f0d'; g.beginPath(); g.ellipse(-0.1, 0.08, 0.5, 0.12, -0.12, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ecebe4';
      const teeth = (pts, dir) => { for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; for (let k = 0; k < 3; k++) { const f0 = k / 3, f1 = (k + 1) / 3, xa = x0 + (x1 - x0) * f0, ya = y0 + (y1 - y0) * f0, xb = x0 + (x1 - x0) * f1, yb = y0 + (y1 - y0) * f1; g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb, yb); g.lineTo((xa + xb) / 2, (ya + yb) / 2 + dir * 0.085); g.closePath(); g.fill(); } } };
      teeth(lipU, 1); teeth(lipL, -1);
      g.strokeStyle = '#111'; g.lineWidth = 0.025; g.beginPath(); [...lipU, ...lipL].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
      g.fillStyle = '#ecebe4'; g.beginPath(); g.ellipse(0.38, -0.45, 0.11, 0.07, -0.25, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111'; g.beginPath(); g.arc(0.35, -0.45, 0.045, 0, Math.PI * 2); g.fill();
    });
    // squadron badge under the canopy
    P.decalOn(-2.9, 0.25, 'both', (g) => { g.fillStyle = '#1d3d7a'; g.beginPath(); g.arc(0, 0, 0.13, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#e8e6de'; g.lineWidth = 0.014; g.stroke(); g.fillStyle = '#e8e6de'; g.beginPath(); g.moveTo(-0.08, 0.04); g.lineTo(0.09, 0.0); g.lineTo(0.03, -0.07); g.closePath(); g.fill(); });
  }
  // weathering: tonal noise, gun gas, exhaust, oil, rain streaks
  P.noise({ alpha: 0.08, scale: 2.2, stretch: [1.6, 1], rough: 0.06 });
  P.noise({ alpha: 0.05, scale: 0.7, mode: 'light' });
  P.noise({ alpha: 0.04, scale: 5.5, stretch: [2, 1] });
  // GAU-8 gun gas: heavy soot on the lower nose that the slipstream drags aft along both sides (more on the left, where the
  // firing barrel's gas is pulled by the cluster rotation), fading out under the cockpit
  P.fill((g) => { g.rect(-7.0, 0.88, 0.6, 0.12); g.rect(-7.0, 0.0, 0.6, 0.12); }, soot, { alpha: 0.45 * wx, feather: 12 });
  P.fill((g) => { g.rect(-6.9, 0.8, 1.6, 0.12); }, soot, { alpha: 0.22 * wx, feather: 20 });
  P.fill((g) => { g.rect(-6.9, 0.08, 1.3, 0.1); }, soot, { alpha: 0.16 * wx, feather: 20 });
  for (let i = 0; i < 26; i++) { const left = rnd() < 0.62, t = left ? 0.82 + rnd() * 0.12 : 0.06 + rnd() * 0.12, len = 0.6 + rnd() * (left ? 2.4 : 1.5); P.streak(-6.9, t, -6.9 + len, t + (rnd() - 0.5) * 0.025, 0.02 + rnd() * 0.035, { alpha: (0.12 + rnd() * 0.16) * wx }); }
  for (let i = 0; i < 26; i++) { const z = -3 + rnd() * 9, t = (rnd() < 0.5 ? 0.02 : 0.9) + rnd() * 0.08; P.streak(z, t, z + 0.6 + rnd(), t, 0.012 + rnd() * 0.012, { alpha: (0.08 + rnd() * 0.12) * wx }); }
  for (let i = 0; i < 12; i++) { const z = -1.5 + rnd() * 6, t = 0.3 + rnd() * 0.4; P.streak(z, t, z + 0.25 + rnd() * 0.5, t + (t < 0.5 ? -0.03 : 0.03), 0.006, { alpha: 0.12 * wx }); }   // rain / fluid streaks down the sides
  P.fill((g) => g.rect(4.4, 0.38, 3.6, 0.24), { color: '#2e2b28' }, { alpha: 0.3 * wx, feather: 18 });    // engine exhaust staining on the spine and tail cone
  P.fill((g) => g.rect(6.5, 0.3, 2.4, 0.4), { color: '#2e2b28' }, { alpha: 0.15 * wx, feather: 24 });

  // ================= engine nacelles (a = z, b = t around, 0 = bottom, 0.25 outboard) =================
  {
    const Q = atlas.pen(cNac);
    Q.fill('all', paintF(SC.top));
    camo(Q, 1.6, 4.45, 0, 1, 1.2, 0.3);
    Q.fill((g) => g.rect(1.6, 0.35, 2.9, 0.3), { color: '#c8ccce' }, { alpha: SC.fade * 0.8, feather: 14 });
    for (const z of [1.78, 2.05, 2.75, 3.5, 4.1]) Q.ring(z, 0, 1, line);
    for (const t of [0.14, 0.36, 0.64, 0.86]) Q.line([[2.05, t], [4.1, t]], line);
    // fan-cowl doors with latches along the bottom, core-cowl access
    for (const [b0, b1] of [[0.17, 0.33], [0.67, 0.83]]) { Q.panel(2.2, b0, 3.4, b1, { ...line, r: 0.04 }); Q.rivets(2.25, b0 + 0.01, 3.35, b0 + 0.01, 0.06, screw); Q.rivets(2.25, b1 - 0.01, 3.35, b1 - 0.01, 0.06, screw); }
    for (const z of [2.4, 2.9, 3.3]) Q.fill([[z, 0.005], [z + 0.12, 0.005], [z + 0.12, 0.035], [z, 0.035]], F.matte('#2a2c2e'), { alpha: 0.8 });
    for (const z of [2.05, 2.75, 3.5, 4.1]) Q.rivets(z + 0.02, 0, z + 0.02, 1, 0.035, riv);
    Q.fill((g) => g.rect(3.95, 0, 0.5, 1), { color: '#3a3632', rough: 0.6, metal: 0.4 }, { alpha: 0.45, feather: 10 });
    for (let i = 0; i < 12; i++) { const t = rnd(); Q.streak(3.6 + rnd() * 0.4, t, 4.45, t, 0.03 + rnd() * 0.04, { alpha: 0.18 * wx }); }
    for (let i = 0; i < 7; i++) { const t = 0.94 + rnd() * 0.12; Q.streak(2.3 + rnd() * 0.8, t % 1, 4.45, t % 1, 0.012 + rnd() * 0.012, { alpha: 0.3 * wx }); }   // oil weeping from the bottom drains
    Q.decalT(2.3, 0.25, { girth: 3.9 }, (g) => { g.fillStyle = '#a02a24'; g.beginPath(); g.moveTo(-0.07, -0.08); g.lineTo(-0.07, 0.08); g.lineTo(0.08, 0); g.closePath(); g.fill(); });
    Q.decalT(2.6, 0.25, { girth: 3.9 }, (g) => { g.fillStyle = '#a02a24'; g.font = '700 0.07px sans-serif'; g.textAlign = 'center'; g.fillText('DANGER', 0, 0.025); });
    Q.decalT(1.85, 0.5, { girth: 3.9 }, (g) => { g.fillStyle = '#a02a24'; g.fillRect(-0.04, -0.4, 0.08, 0.8); });    // intake danger stripe on top
    Q.decalT(3.0, 0.75, { girth: 3.9 }, (g) => stencil(g, 0.24, 3));
    Q.noise({ alpha: 0.08, scale: 1.4, rough: 0.05 });
  }

  // ================= wings =================
  for (const key of ['R', 'L']) {
    const s = key === 'R' ? 1 : -1, wg = W.R;
    const at = (x, f) => { const p = wg.at(x, f); return [p[0], p[2]]; };
    for (const [chart, fin2, isTop] of [[cWT[key], top, true], [cWB[key], under, false]]) {
      const Q = atlas.pen(chart);
      Q.fill('all', SC.camo ? top : fin2);
      if (isTop) { camo(Q, s > 0 ? 0.5 : -8.85, s > 0 ? 8.85 : -0.5, -1.12, 2.12, 2.8); Q.fill('all', { color: '#c8ccce' }, { alpha: SC.fade * 0.7 }); }
      const ln = (pts, op) => Q.line(pts.map(p => [p[0] * s, p[1]]), op);
      const rv = (a, b, sp, op) => Q.rivets(a[0] * s, a[1], b[0] * s, b[1], sp, op);
      for (const f of [0.15, 0.32, 0.55, 0.72]) ln([at(0.6, f), at(2.95, f), at(8.25, f)], line);
      for (const x of [1.2, 2.2, 2.95, 3.6, 4.7, 5.6, 6.5, 7.4, 8.25]) ln([at(x, 0.01), at(x, 0.99)], line);
      for (const x of [1.7, 2.6, 3.25, 4.15, 5.15, 6.05, 6.95, 7.85]) ln([at(x, 0.15), at(x, 0.55)], fine);
      const hz = (x) => wg.lines.hte.at(wg.spanToU(x));
      for (const [a, b] of [[0.8, 2.2], [3.0, 4.65], [4.75, 8.15]]) ln([at(a, 1), at(a, hz(a)), at(b, hz(b)), at(b, 1)], gap);
      ln([at(0.8, 0), at(0.8, 0.15), at(2.2, 0.15), at(2.2, 0)], gap);
      for (const f of [0.15, 0.55, 0.72]) rv(at(0.7, f + 0.012), at(8.2, f + 0.012), 0.04, riv);
      for (const x of [1.2, 2.2, 3.6, 4.7, 5.6, 6.5, 7.4]) rv(at(x + 0.012, 0.03), at(x + 0.012, 0.7), 0.045, riv);
      // fuel / spar access panels between the spars
      for (const x of [1.45, 2.4, 3.8, 4.9, 5.8, 6.7]) { const a = at(x, 0.24), b = at(x + 0.5, 0.45); Q.panel(Math.min(a[0], b[0]) * s, a[1], Math.max(a[0], b[0]) * s, b[1], { ...line, r: 0.03 }); }
      const le = [at(0.8, 0.006), at(8.6, 0.006)].map(p => [p[0] * s, p[1]]);
      Q.wear((g) => { g.moveTo(le[0][0], le[0][1]); g.lineTo(le[1][0], le[1][1]); }, 0.05, { color: '#7d8186', rough: 0.45, metal: 0.5 }, { alpha: 0.35 * wx });
      Q.noise({ alpha: 0.09, scale: 1.2, stretch: [1, 2.5], rough: 0.06 });
      Q.noise({ alpha: 0.04, scale: 4.5 });
      for (let i = 0; i < 14; i++) { const x = 1 + rnd() * 7, a = at(x, hz(x)); Q.streak(a[0] * s, a[1], a[0] * s, a[1] + 0.25 + rnd() * 0.3, 0.03, { alpha: 0.15 * wx }); }
      touchUps(Q, 6, s > 0 ? 1 : -8, s > 0 ? 8 : -1, -0.8, 1.3, SC.top, 0.4);
      if (isTop) {
        // wing-root walkway: anti-skid grey with worn edges where crews step from the ladder
        const w0 = at(0.75, 0.2), w1 = at(0.75, 0.62), w2 = at(1.5, 0.62), w3 = at(1.5, 0.2);
        Q.fill([w0, w1, w2, w3].map(p => [p[0] * s, p[1]]), { color: '#3d4144', rough: 0.95, metal: 0 }, { alpha: SC.camo ? 0.35 : 0.5 });
        ln([w0, w1, w2, w3, w0], { px: 1.5, depth: 0.1, dark: 0.45 });
        Q.wear((g) => { const a = [w0[0] * s, w0[1]], b = [w3[0] * s, w3[1]]; g.moveTo(a[0], a[1] + 0.05); g.lineTo(b[0], b[1] + 0.05); }, 0.12, { color: '#6e7275', rough: 0.7, metal: 0.25 }, { alpha: 0.35 * wx });
        const p = at(3.6, 0.45); Q.text('NO STEP', p[0] * s, p[1], 0.07, { color: mark, rot: s > 0 ? -90 : 90 });
        for (const x of [5.2, 7.0]) { const q = at(x, 0.35); Q.text('NO STEP', q[0] * s, q[1], 0.05, { color: mark, rot: s > 0 ? -90 : 90 }); }
        if (key === 'L') { const c = at(6.0, 0.4); Q.decal(c[0] * s, c[1], (g) => K.drawStarBar(g, 0.85, { lowVis: markLow })); }
        const fl = at(7.6, 0.3); Q.fill((g) => g.rect(fl[0] * s - 0.25, fl[1] - 0.03, 0.5, 0.06), slime);
      } else {
        if (key === 'R') { const c = at(6.0, 0.4); Q.decal(c[0] * s, c[1], (g) => K.drawStarBar(g, 0.85, { lowVis: markLow })); }
        for (const x of [1.55, 3.45, 4.9, 6.35]) { const q = at(x, 0.5); Q.streak(q[0] * s, q[1], q[0] * s, q[1] + 0.9, 0.08, { alpha: 0.12 * wx }); }   // pylon drag streaks
        const t = at(4.0, 0.4); Q.decal(t[0] * s, t[1], (g) => stencil(g, 0.3, 3));
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
    for (const zz of [6.87, 7.37]) Q.rivets(0.15, zz, 2.7, zz, 0.045, riv);
    Q.noise({ alpha: 0.09, scale: 1.0, stretch: [1, 2], rough: 0.06 });
    // TF34 exhaust plume washes the upper tailplane between the fins: soot band behind the nacelles
    if (isTop) { Q.fill((g) => g.rect(0.6, 6.35, 1.3, 2.0), { color: '#2e2b28', rough: 0.8, metal: 0 }, { alpha: 0.3 * wx, feather: 20 }); for (let i = 0; i < 8; i++) { const x = 0.7 + rnd() * 1.1; Q.streak(x, 6.4, x, 8.3, 0.06, { alpha: 0.12 * wx }); } }
  }
  // ================= fins (L chart = faces seen from the left) =================
  for (const key of ['L', 'R']) {
    const Q = atlas.pen(cFin[key]); Q.fill('all', top);
    camo(Q, 6.6, 9.0, 0, 2.92, 1.6);
    Q.fill([[6.6, 1.6], [9.0, 1.6], [9.0, 2.92], [6.6, 2.92]], { color: '#c8ccce' }, { alpha: SC.fade * 0.6, feather: 20 });
    const fin = fins.R;
    const at = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    const hz = (y) => fin.lines.rh.at(fin.spanToU(y));
    Q.fill([[6.6, 2.5], [9.0, 2.5], [9.0, 2.92], [6.6, 2.92]], F.semigloss(SC.band));
    if (SC.band2) for (let i = 0; i < 5; i++) Q.decal(6.95 + i * 0.36, 2.68, (g) => { g.fillStyle = SC.band2; star(g, 0.07); });
    Q.line([at(0.12, 1), at(0.12, hz(0.12)), at(2.62, hz(2.62)), at(2.62, 1)], gap);
    for (const y of [0.45, 0.88, 1.5, 2.05, 2.5]) Q.line([at(y, 0.02), at(y, Math.min(0.98, hz(Math.max(0.9, y))))], line);
    for (const f of [0.25, 0.5]) Q.line([at(0.3, f), at(2.7, f)], line);
    for (const f of [0.26, 0.51]) { const a = at(0.3, f), b = at(2.7, f); Q.rivets(a[0] + 0.012, a[1], b[0] + 0.012, b[1], 0.045, riv); }
    const c = at(1.85, 0.36);
    Q.text(SC.code, c[0], c[1], 0.5, { color: mark, weight: 700 });
    const d = at(1.2, 0.36), fw = key === 'L' ? 1 : -1;
    Q.text(SC.serial[0], d[0] - fw * 0.3, d[1] + 0.03, 0.085, { color: mark, weight: 700 });
    Q.text(SC.serial[1], d[0] + fw * 0.28, d[1], 0.2, { color: mark, weight: 700 });
    const u = at(0.7, 0.35); Q.text(SC.unit, u[0], u[1], 0.06, { color: mark, weight: 700 });
    const fl = at(2.25, 0.5); Q.fill((g) => g.rect(fl[0] - 0.28, fl[1] - 0.03, 0.56, 0.06), slime);
    Q.noise({ alpha: 0.08, scale: 1.2, stretch: [1, 1.5], rough: 0.05 });
    // exhaust soot on the lower fin around the tailplane junction, rudder hinge grime
    Q.fill((g) => g.rect(6.8, 0.3, 1.6, 0.9), { color: '#2e2b28' }, { alpha: 0.14 * wx, feather: 22 });
    for (let i = 0; i < 6; i++) { const y = 0.3 + rnd() * 2.2; Q.streak(8.25, y, 8.95, y - 0.04, 0.015, { alpha: 0.15 * wx }); }
  }
  // ================= main-gear pods (t: 0 = bottom) =================
  {
    const Q = atlas.pen(cPod);
    Q.fill('all', SC.camo ? top : under);
    camo(Q, -2.3, 1.85, 0, 1, 1.0, 0.3);
    for (const z of [-1.55, -0.5, 0.5, 1.2]) Q.ring(z, 0, 1, line);
    for (const t of [0.25, 0.75]) Q.line([[-1.55, t], [1.2, t]], fine);
    Q.line([[-1.45, 0.1], [0.25, 0.1]], line); Q.line([[-1.45, 0.9], [0.25, 0.9]], line);
    for (const t of [0.12, 0.88]) Q.rivets(-1.4, t, 0.2, t, 0.05, screw);
    Q.noise({ alpha: 0.08, scale: 1.0, rough: 0.05 });
    for (let i = 0; i < 12; i++) { const t = (rnd() < 0.5 ? 0.08 : 0.78) + rnd() * 0.14; Q.streak(-0.2 + rnd(), t, 1.2 + rnd() * 0.5, t, 0.01, { alpha: 0.18 * wx }); }
    Q.fill((g) => { g.rect(0.2, 0.0, 0.5, 0.12); g.rect(0.2, 0.88, 0.5, 0.12); }, oil, { alpha: 0.3 * wx, feather: 12 });   // brake dust and hydraulic grime behind the wheel slot
  }
  // ================= instrument panel (A-10C: two MFCDs, UFC, armament panel, standby instruments) =================
  {
    const Q = atlas.pen(cPanel); Q.fill('all', { color: '#3a3f42', rough: 0.7, metal: 0 });
    const sub = (a, b, w, h) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#1b1d1f', rough: 0.6, metal: 0 }); Q.groove((g) => g.rect(a, b, w, h), { px: 1, depth: 0.4, dark: 0.3 }); };
    const knobs = (a, b, w, h, n, m) => { for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) Q.fill((g) => g.arc(a + (i + 0.5) * w / n, b + (j + 0.5) * h / m, Math.min(w / n, h / m) * 0.22, 0, Math.PI * 2), { color: '#0a0a0b', rough: 0.4, metal: 0.2 }); };
    const labels = (a, b, w, h, n) => { for (let i = 0; i < n; i++) Q.fill((g) => g.rect(a + 0.01, b + (i + 0.7) * h / n, w * (0.3 + (i % 3) * 0.15), 0.003), { color: '#d9d9cf', rough: 0.6, metal: 0 }, { alpha: 0.7 }); };
    // MFCDs with the tactical-awareness map (left) and a targeting-pod picture (right), and the OSB buttons round each bezel
    const mfcd = (a, b, right) => {
      Q.fill((g) => g.rect(a, b, 0.2, 0.2), { color: '#050607', rough: 0.15, metal: 0 });
      Q.fill((g) => g.rect(a + 0.008, b + 0.008, 0.184, 0.184), { color: right ? '#1c2420' : '#0b1a24', rough: 0.1, metal: 0, emissive: right ? '#26302a' : '#0d2a3a' });
      const em = (fn, col) => Q.fill(fn, { color: col, rough: 0.1, metal: 0, emissive: col });
      if (!right) {
        em((g) => { g.moveTo(a + 0.03, b + 0.16); g.bezierCurveTo(a + 0.07, b + 0.1, a + 0.12, b + 0.18, a + 0.18, b + 0.06); g.lineTo(a + 0.181, b + 0.064); g.bezierCurveTo(a + 0.12, b + 0.184, a + 0.07, b + 0.104, a + 0.031, b + 0.165); g.closePath(); }, '#3aa0d8');
        em((g) => { g.moveTo(a + 0.1, b + 0.09); g.lineTo(a + 0.11, b + 0.12); g.lineTo(a + 0.09, b + 0.12); g.closePath(); }, '#e8e8e0');
        for (let k = 0; k < 4; k++) em((g) => g.rect(a + 0.03 + k * 0.04, b + 0.04 + (k % 2) * 0.05, 0.012, 0.012), k % 2 ? '#e03a2a' : '#30d040');
        em((g) => { g.rect(a + 0.012, b + 0.012, 0.176, 0.006); }, '#4ad070');
      } else {
        em((g) => { g.rect(a + 0.098, b + 0.04, 0.004, 0.12); g.rect(a + 0.04, b + 0.098, 0.12, 0.004); }, '#d8e0d0');
        em((g) => { g.rect(a + 0.03, b + 0.13, 0.06, 0.03); }, '#3a4438');
        em((g) => { g.rect(a + 0.012, b + 0.012, 0.176, 0.006); }, '#c8d0c0');
      }
      for (let k = 0; k < 5; k++) for (const [dx, dy] of [[0.02 + k * 0.04, -0.012], [0.02 + k * 0.04, 0.212], [-0.012, 0.02 + k * 0.04], [0.212, 0.02 + k * 0.04]])
        Q.fill((g) => g.rect(a + dx - 0.006, b + dy - 0.006, 0.012, 0.012), { color: '#2a2c2e', rough: 0.5, metal: 0 });
    };
    mfcd(0.04, 0.2, false); mfcd(0.66, 0.2, true);
    // UFC: scratchpad + keypad
    sub(0.335, 0.01, 0.23, 0.125);
    Q.fill((g) => g.rect(0.35, 0.02, 0.2, 0.025), { color: '#0a1206', rough: 0.1, metal: 0, emissive: '#3a5a10' });
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) Q.fill((g) => g.rect(0.35 + i * 0.033, 0.055 + j * 0.026, 0.026, 0.02), { color: '#2e3134', rough: 0.5, metal: 0 });
    // standby ADI, altimeter, airspeed, AoA indexer (centre column); engine instruments (right); armament panel (bottom left)
    sub(0.27, 0.15, 0.36, 0.33);
    for (const [a, b, r] of [[0.33, 0.21, 0.04], [0.45, 0.21, 0.05], [0.57, 0.21, 0.04], [0.33, 0.33, 0.04], [0.45, 0.35, 0.05], [0.57, 0.33, 0.04], [0.33, 0.44, 0.03], [0.57, 0.44, 0.03]]) {
      Q.fill((g) => g.arc(a, b, r, 0, Math.PI * 2), { color: '#070707', rough: 0.2, metal: 0 });
      Q.stroke((g) => g.arc(a, b, r * 0.8, 0, Math.PI * 2), 0.002, { color: '#cfcfc4' });
      Q.stroke((g) => { g.moveTo(a, b); g.lineTo(a + r * 0.7 * Math.cos(a * 40), b + r * 0.7 * Math.sin(a * 40)); }, 0.003, { color: '#f0f0e8' });
    }
    Q.fill((g) => { g.arc(0.45, 0.35, 0.048, Math.PI, 0); }, { color: '#4a6e94', rough: 0.3, metal: 0 });   // ADI sky half
    Q.fill((g) => { g.arc(0.45, 0.35, 0.048, 0, Math.PI); }, { color: '#5a4126', rough: 0.3, metal: 0 });
    sub(0.04, 0.42, 0.22, 0.07); knobs(0.04, 0.42, 0.22, 0.07, 9, 2); labels(0.04, 0.42, 0.22, 0.07, 2);   // armament panel (toggle row)
    sub(0.64, 0.42, 0.22, 0.07); knobs(0.64, 0.42, 0.22, 0.07, 6, 2);
    sub(0.04, 0.03, 0.26, 0.15); knobs(0.04, 0.03, 0.26, 0.15, 5, 3); labels(0.04, 0.03, 0.26, 0.15, 4);
    sub(0.6, 0.03, 0.26, 0.15); knobs(0.6, 0.03, 0.26, 0.15, 4, 2);
    Q.fill((g) => { g.rect(0.62, 0.15, 0.22, 0.008); }, { color: '#e2c22a', rough: 0.5, metal: 0 });
    Q.fill((g) => { for (let k = 0; k < 4; k++) g.rect(0.29 + k * 0.012, 0.005, 0.006, 0.004); }, { color: '#e2c22a', rough: 0.5, metal: 0, emissive: '#806010' });
  }
  // ================= side consoles (a across, b = z from the front) =================
  {
    const Q = atlas.pen(cCons); Q.fill('all', { color: '#3a3f42', rough: 0.7, metal: 0 });
    const blocks = [[0.02, 0.02, 0.21, 0.2], [0.02, 0.25, 0.21, 0.22], [0.02, 0.5, 0.21, 0.18], [0.02, 0.72, 0.21, 0.3], [0.02, 1.05, 0.21, 0.25],
      [0.29, 0.02, 0.21, 0.24], [0.29, 0.3, 0.21, 0.2], [0.29, 0.54, 0.21, 0.3], [0.29, 0.88, 0.21, 0.22], [0.29, 1.14, 0.21, 0.3]];
    for (const [a, b, w, h] of blocks) {
      Q.fill((g) => g.rect(a, b, w, h), { color: '#1b1d1f', rough: 0.6, metal: 0 });
      Q.groove((g) => g.rect(a, b, w, h), { px: 1, depth: 0.4, dark: 0.3 });
      const n = 2 + Math.round(rnd() * 3), m = 2 + Math.round(h * 8);
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) Q.fill((g) => g.arc(a + (i + 0.5) * w / n, b + (j + 0.5) * h / m, 0.008 + rnd() * 0.006, 0, Math.PI * 2), { color: '#080808', rough: 0.4, metal: 0.2 });
      for (let j = 0; j < m; j++) Q.fill((g) => g.rect(a + 0.01, b + (j + 0.9) * h / m, w * 0.4, 0.003), { color: '#d9d9cf', rough: 0.6, metal: 0 }, { alpha: 0.6 });
    }
    Q.fill((g) => g.rect(0.31, 0.58, 0.17, 0.08), { color: '#0a1206', rough: 0.1, metal: 0, emissive: '#2f4a0e' });   // CDU screen
  }
}

/** Five-pointed star centred on the origin. */
function star(g, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.4 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath(); g.fill();
}
