// McDonnell Douglas F-15C Eagle (and the F-15E Strike Eagle as the 'strike' livery) — procedural visual model built with
// the aircraft kit (src/aircraft/kit). Body axes: origin = CG, +X right wing, +Y up, -Z nose. Parked, the ground is at
// y = -geometry.cgHeight (-1.85).
//
// Reference numbers (docs/aircraft/f15.md + F-15 three-views; z = d − 11.95 where d = distance aft of the nose tip):
//   length 19.43 m (radome tip z −11.95 … boom tails 7.45), span 13.05 m (tips ±6.52), height 5.63 m (fin tips y 3.78)
//   radome to d 2.85 (z −9.1), windscreen base d 3.6 (z −8.35), windscreen arch z −7.6, canopy aft end z −4.5;
//   canopy top y 1.56 (≈ 3.4 m above the ground), sill y 0.78, upper deck behind the canopy y 0.88
//   intakes: 1.0 × 1.34 m boxes centred x ±1.16, y 0.01, lip plane z −5.72 at mid height, raked 0.4 (top lip 0.27 forward);
//     the front capsule (lip → z −4.85) nods −4 … +11° about a lower pivot with speed / AoA (full down when parked)
//   wing: shoulder mounted, cropped delta, no leading-edge devices. Theoretical root chord 6.93 at the centreline, taper 0.25,
//     LE sweep 45° (quarter chord 38.7°), TE sweep ≈ 11°: LE(x) = −4.05 + x, TE(x) = 2.88 + 0.2 x; LE meets the duct at
//     z −2.39; chamfered tip from x 5.78 (LE) to x 6.52 (streamwise tip chord 1.15); −1° anhedral; conical camber
//     (64A006.6 → 64A203 with LE droop toward the tip); plain flaps x 1.68…3.3, ailerons 3.38…5.7
//   stabilators: all-moving on the tail booms, span 8.6 (tips ±4.3), root chord 3.42, LE 48° with the inboard dog-tooth at
//     x 2.75, pivot z 5.6, −3° anhedral, TE z 7.2
//   fins: two, upright on the booms at x ±1.72, root y 0.55 (LE z 1.85, chord 4.6), tip y 3.78 (LE z 4.3, chord 1.75), rudders
//     on the lower half; ECM antenna pod on the left fin tip, shorter pod + mass-balance boom on the right
//   engines: F100 centres x ±1.0, y 0.2; featherless C-D nozzles, exit z 7.25, r 0.45 … 0.56, exposed actuator links;
//     bare titanium engine-bay skin from z ≈ 4.4 aft
//   gear (geometry.js): nose [0, −1.85, −4.9] r 0.28, retracting forward; mains [±1.375, −1.85, 0.5] r 0.44 on cantilever
//     axles outboard of tall single oleos, retracting forward with the wheel turned flat under the ducts
//   pilot eye [0, 1.05, −7.15]
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['strike', 'eagle', 'ghost', 'guard'];   // the hangar lists this aircraft as the F-15E, so the E is the default

// Colours are the FS 595 greys as they read under the sim's tone mapping (a touch lighter than the chips).
const SCHEMES = {
  eagle: {
    name: 'F-15C "Mod Eagle" (FS 36251 / 36176), invented 405th FS "Kestrels"', variant: 'C', camo: 'mod',
    light: '#7c8388', dark: '#5d646a', radome: '#6a7176', mark: '#40454a', code: 'KW', serial: ['AF 84', '021'],
    band: '#2b4f8e', band2: '#e3e4e0', bandText: 'KESTRELS', pilot: 'MAJ D. "RAZOR" ABERNATHY', chief: 'SSGT L. ORTEGA',
    weather: 1, stores: { centre: true, wingTanks: false },
  },
  ghost: {
    name: 'F-15C "Compass Ghost" (FS 36375 / 36320), late 1980s, invented 77th TFW', variant: 'C', camo: 'ghost',
    light: '#969da1', dark: '#787f84', radome: '#979c9f', mark: '#71777c', code: 'ZR', serial: ['AF 80', '013'],
    band: '#a4262c', band2: '#e8e8e2', bandText: null, pilot: 'CAPT S. "FANG" MILLER', chief: 'SGT P. KOWALSKI',
    weather: 0.75, stores: { centre: true, wingTanks: true },
  },
  guard: {
    name: 'F-15C "Mod Eagle", invented "Cascade" Air National Guard wing, fin flash', variant: 'C', camo: 'mod',
    light: '#7a8186', dark: '#5b6268', radome: '#687075', mark: '#3c4145', code: null, serial: ['AF 85', '114'],
    band: '#14243f', band2: '#d9b443', bandText: 'CASCADE', guard: true, pilot: 'LT COL K. "BIGFOOT" HANSEN', chief: 'TSGT A. NGUYEN',
    weather: 0.85, stores: { centre: false, wingTanks: true },
  },
  strike: {
    name: 'F-15E Strike Eagle, Gunship Gray (FS 36118), invented 4th FW markings', variant: 'E', camo: null,
    light: '#565b60', dark: '#565b60', radome: '#5a5f63', mark: '#2c2f32', code: 'SJ', serial: ['AF 89', '487'],
    band: '#c9a62a', band2: '#1d1f21', bandText: null, pilot: 'CAPT R. VANCE', wso: 'CAPT M. "DOC" ITO', chief: 'SSGT B. HOLLOWAY',
    weather: 1, stores: { centre: false, wingTanks: true },
  },
};

// fixed layout numbers shared by the geometry and the paint
const IC = 1.16, IY = 0.01, IW = 0.5, IH = 0.67, ZLIP = -5.72, RAKE = 0.4, ZCAP = -4.85, ZR0 = -4.95, NSPLIT = 0.7;
const zLE = (x) => -4.05 + x, zTE = (x) => 2.88 + 0.2 * x, wy = (x) => 0.53 - (x - 1.2) * Math.tan(1 * DEG);
const XCUT = 5.78, XTIP = 6.52, TIPC = 1.15;
const Z_CK = [-8.35, -4.5], Z_SB = [-4.3, -2.0], Z_NG = [-6.45, -4.62];
const FX = 1.72, FIN = { y0: 0.55, z0: 1.85, c0: 4.6, y1: 3.78, z1: 4.3, c1: 1.75 };
const STE = 7.2, XDT = 2.75, ZP = 5.6;
const sty = (x) => 0.1 - (x - 1.95) * Math.tan(3 * DEG);

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'strike', SC = SCHEMES[livery], isE = SC.variant === 'E';
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const paintF = (c) => ({ color: c, rough: 0.6, metal: 0.03 });
  const seg = Math.max(32, Math.round(72 * detail / 4) * 4);

  // ---- atlas ------------------------------------------------------------------------------------------------------------
  const atlas = K.createAtlas({ size: atlasSize, base: paintF(SC.light), swatchRows: 6, skin: { weathering: 0.45 + 0.35 * SC.weather, framePitch: 0.36 } });
  const cFus = atlas.chart('fus', { type: 'unwrap', z: [-11.95, 6.6], girth: 6.6, vScale: 0.85, strips: 2, density: 1.2 });
  const cNac = {
    R: atlas.chart('nacR', { type: 'unwrap', z: [-5.9, 2 * NSPLIT + 5.9], girth: 4.7, vScale: 0.8, strips: 2, density: 1.05 }),
    L: atlas.chart('nacL', { type: 'unwrap', z: [-5.9, 2 * NSPLIT + 5.9], girth: 4.7, vScale: 0.8, strips: 2, density: 1.05 }),
  };
  const cCft = isE ? atlas.chart('cft', { type: 'unwrap', z: [-3.75, 3.75], girth: 2.4, vScale: 0.8, density: 0.8 }) : null;
  const cWT = { R: atlas.chart('wingTopR', { type: 'plan', x: [1.1, 6.6], z: [-3.0, 4.3], view: 'top', density: 1.1 }), L: atlas.chart('wingTopL', { type: 'plan', x: [-6.6, -1.1], z: [-3.0, 4.3], view: 'top', density: 1.1 }) };
  const cWB = { R: atlas.chart('wingBotR', { type: 'plan', x: [1.1, 6.6], z: [-3.0, 4.3], view: 'bottom', density: 0.6 }), L: atlas.chart('wingBotL', { type: 'plan', x: [-6.6, -1.1], z: [-3.0, 4.3], view: 'bottom', density: 0.6 }) };
  const cST = atlas.chart('stabTop', { type: 'plan', x: [1.85, 4.4], z: [3.6, 7.35], view: 'top', mirror: true, density: 0.85 });
  const cSB = atlas.chart('stabBot', { type: 'plan', x: [1.85, 4.4], z: [3.6, 7.35], view: 'bottom', mirror: true, density: 0.6 });
  const cFin = { L: atlas.chart('finLV', { type: 'side', z: [1.7, 6.9], y: [0.45, 3.95], view: 'left', density: 0.95 }), R: atlas.chart('finRV', { type: 'side', z: [1.7, 6.9], y: [0.45, 3.95], view: 'right', density: 0.95 }) };
  const cBoom = atlas.chart('boom', { type: 'unwrap', z: [1.8, 7.5], girth: 1.5, vScale: 0.9, density: 0.7 });
  const cNoz = atlas.chart('nozzle', { type: 'rect', w: 3.8, h: 0.95, density: 0.7 });
  atlas.pack();
  const U = {
    under: atlas.swatch('under', paintF(SC.light)), mid: atlas.swatch('mid', paintF(SC.light)), darkPaint: atlas.swatch('darkPaint', paintF(SC.dark)),
    dark: atlas.swatch('dark', F.darkGrey), black: atlas.swatch('black', F.black),
    duct: atlas.swatch('duct', { color: '#cfd0cc', rough: 0.55, metal: 0 }), ductMid: atlas.swatch('ductMid', { color: '#a9aba7', rough: 0.6, metal: 0 }), ductDeep: atlas.swatch('ductDeep', { color: '#6f716f', rough: 0.65, metal: 0 }),
    exhaust: atlas.swatch('exhaust', F.exhaust), heat: atlas.swatch('heat', { color: '#7a726a', rough: 0.48, metal: 0.85 }),
    heat2: atlas.swatch('heat2', { color: '#6a6157', rough: 0.62, metal: 0.55 }), soot: atlas.swatch('soot', { color: '#3a3532', rough: 0.7, metal: 0.4 }),
    well: atlas.swatch('well', F.gearWhite), wellDark: atlas.swatch('wellDark', { color: '#b9bbb7', rough: 0.5, metal: 0 }),
    interior: atlas.swatch('interior', { color: '#43484b', rough: 0.75, metal: 0 }), console: atlas.swatch('console', { color: '#1c1e20', rough: 0.6, metal: 0 }),
    seat: atlas.swatch('seat', { color: '#2b2e2f', rough: 0.7, metal: 0 }), cushion: atlas.swatch('cushion', { color: '#525843', rough: 0.95, metal: 0 }),
    accent: atlas.swatch('accent', { color: '#d9b51e', rough: 0.5, metal: 0 }), chute: atlas.swatch('chute', { color: '#3f4a3a', rough: 0.9, metal: 0 }),
    suit: atlas.swatch('suit', { color: '#4d5540', rough: 0.9, metal: 0 }), helmet: atlas.swatch('helmet', { color: '#8d9296', rough: 0.35, metal: 0 }),
    visor: atlas.swatch('visor', { color: '#0a0b0d', rough: 0.05, metal: 0.4 }), glove: atlas.swatch('glove', { color: '#3a3d33', rough: 0.9, metal: 0 }),
    frame: atlas.swatch('frame', paintF('#4a4f53')), frameIn: atlas.swatch('frameIn', { color: '#26292b', rough: 0.7, metal: 0 }),
    seal: atlas.swatch('seal', { color: '#18191a', rough: 0.8, metal: 0 }), mirror: atlas.swatch('mirror', { color: '#c8d0d6', rough: 0.05, metal: 1 }),
    steel: atlas.swatch('steel', F.steel), chrome: atlas.swatch('chrome', F.chrome), probe: atlas.swatch('probe', F.bareMetal),
    aim: atlas.swatch('aim', F.semigloss('#c8cbcb')), aimNose: atlas.swatch('aimNose', { color: '#2a2c2e', rough: 0.25, metal: 0.2 }),
    aim9: atlas.swatch('aim9', F.semigloss('#a9adae')), seeker: atlas.swatch('seeker', { color: '#1a1d22', rough: 0.05, metal: 0.5 }),
    lens: atlas.swatch('lens', F.lens), pylon: atlas.swatch('pylon', paintF(SC.light)), tank: atlas.swatch('tank', paintF(SC.light)),
    pod: atlas.swatch('pod', paintF('#5d6266')), podWin: atlas.swatch('podWin', { color: '#2a2418', rough: 0.05, metal: 0.6 }),
    bomb: atlas.swatch('bomb', paintF('#5b5e45')), bombNose: atlas.swatch('bombNose', { color: '#4a4c45', rough: 0.4, metal: 0.4 }),
    nacAft: atlas.swatch('nacAft', { color: '#6f6a64', rough: 0.42, metal: 0.9 }), ti: atlas.swatch('ti', { color: '#85807a', rough: 0.4, metal: 1 }),
    dielectric: atlas.swatch('dielectric', { color: '#4c5155', rough: 0.45, metal: 0 }), dielLight: atlas.swatch('dielLight', { color: '#b8bab5', rough: 0.45, metal: 0 }),
    brake: atlas.swatch('brake', { color: '#4b4744', rough: 0.55, metal: 0.8 }), hyd: atlas.swatch('hyd', { color: '#2b2b2a', rough: 0.4, metal: 0.3 }),
    tyre: atlas.swatch('tyre', { color: '#1a1a1b', rough: 0.88, metal: 0 }), hub: atlas.swatch('hub', { color: '#c9cac6', rough: 0.4, metal: 0.2 }),
    strut: atlas.swatch('strut', F.gearWhite), gun: atlas.swatch('gun', { color: '#151515', rough: 0.6, metal: 0.5 }),
  };

  const rig = K.createRig(ctx, { geometry: G, name: 'f15', glassLayer: opts.glassLayer, cockpitRadius: 1.2 });
  rig.material('paint', null);
  const stat = new K.Mesh();

  // ---- centre fuselage: radome, cockpit, upper deck between and over the intake trunks, belly, aft centre body ----------
  //   z       yW     w      top    bot     kTop  kBot      (yW = height of the widest point; top / bot absolute heights)
  const FSR = [
    [-11.95, 0.200, 0.000, 0.200, 0.200],
    [-11.86, 0.198, 0.082, 0.278, 0.120],
    [-11.60, 0.190, 0.190, 0.390, -0.010],
    [-11.10, 0.175, 0.330, 0.535, -0.170],
    [-10.30, 0.160, 0.462, 0.684, -0.322, 0.55, 0.57],
    [-9.10, 0.155, 0.565, 0.812, -0.445, 0.56, 0.6],
    [-8.35, 0.170, 0.605, 0.885, -0.505, 0.58, 0.68],
    [-7.40, 0.210, 0.625, 0.930, -0.550, 0.6, 0.76],
    [-6.40, 0.250, 0.612, 0.950, -0.580, 0.62, 0.82],
    [-5.60, 0.280, 0.584, 0.950, -0.600, 0.64, 0.85],
    [-4.90, 0.400, 0.640, 0.952, -0.615, 0.7, 0.88],
    [-4.30, 0.580, 1.040, 0.930, -0.620, 0.8, 0.9],
    [-3.60, 0.620, 1.450, 0.900, -0.620, 0.84, 0.9],
    [-2.60, 0.620, 1.530, 0.885, -0.620, 0.86, 0.9],
    [2.20, 0.620, 1.510, 0.870, -0.615, 0.86, 0.9],
    [3.30, 0.600, 1.360, 0.850, -0.570, 0.82, 0.88],
    [4.30, 0.520, 0.920, 0.800, -0.450, 0.76, 0.82],
    [5.20, 0.450, 0.560, 0.710, -0.300, 0.7, 0.74],
    [6.10, 0.420, 0.300, 0.600, -0.050, 0.65, 0.7],
    [6.55, 0.420, 0.120, 0.520, 0.220, 0.6, 0.6],
  ];
  const FS = FSR.map(r => ({ z: r[0], y: r[1], w: r[2], top: Math.max(0, r[3] - r[1]), bot: Math.max(0, r[1] - r[4]), kTop: r[5] ?? 0.5523, kBot: r[6] ?? 0.5523 }));
  const fus0 = K.loft({ stations: FS, segments: seg, step: 0.4 });
  const KF = fus0.K;
  const T_SILL = Math.round(fus0.tAtY(-6.6, 0.78) * KF) / KF;
  let jSB = KF / 2; while (jSB > 0 && fus0.at(-3.0, jSB / KF).p[0] < 0.62) jSB--;
  const T_SB = (jSB + 1) / KF;
  const fus = K.loft({
    stations: FS, segments: seg, step: 0.12 / detail, chart: cFus, capEnd: 'flat', capUV: U.soot,
    cutouts: [
      { name: 'cockpit', z: Z_CK, t: [T_SILL, 1 - T_SILL] },
      { name: 'sb', z: Z_SB, t: [T_SB, 1 - T_SB] },
      { name: 'ng', z: Z_NG, t: [0, 0.07], mirror: true },
    ],
  });
  cFus.body = fus;
  stat.add(fus.mesh);

  // ---- intake trunks: fold-over skin (duct → sharp lip → outer wall → engine nacelle), raked lip, nodding front capsule -----
  const nacStations = (sx, outerOnly) => {
    const S = (z, x, y, w, top, bot, k, extra) => ({ z, x: sx * x, y, w, top, bot, kTop: k, kBot: k, ...extra });
    const outer = [
      S(-5.70, IC, IY, IW, IH + 0.01, IH + 0.01, 0.955),
      S(-5.62, IC, IY, IW + 0.006, IH + 0.016, IH + 0.016, 0.955),
      S(-5.20, IC, IY, IW + 0.008, IH + 0.018, IH + 0.018, 0.95),
      S(-1.00, IC, IY + 0.005, IW + 0.008, IH + 0.018, IH + 0.012, 0.94),
      S(1.40, 1.13, 0.06, 0.52, 0.65, 0.65, 0.88),
      S(3.30, 1.05, 0.15, 0.56, 0.60, 0.61, 0.72),
      S(4.90, 1.00, 0.20, 0.625, 0.625, 0.625, 0.58),
      S(6.32, 1.00, 0.20, 0.612, 0.612, 0.612, 0.5523),
    ];
    if (outerOnly) return [S(-5.72, IC, IY, IW - 0.01, IH, IH, 0.955), ...outer];
    return [
      S(-3.20, IC, IY + 0.02, 0.40, 0.55, 0.55, 0.9),
      S(-5.62, IC, IY, IW - 0.032, IH - 0.03, IH - 0.03, 0.96, { hard: true }),
      S(-5.69, IC, IY, IW - 0.022, IH - 0.02, IH - 0.02, 0.96),
      S(-5.72, IC, IY, IW - 0.01, IH - 0.006, IH - 0.006, 0.958),
      ...outer,
    ];
  };
  const rake = (m) => {
    for (let i = 0; i < m.p.length; i += 3) {
      const z = m.p[i + 2]; if (z >= ZR0) continue;
      const f = K.smooth01((ZR0 - z) / 0.7);
      m.p[i + 2] = z - (m.p[i + 1] - IY) * RAKE * f;
      if (m.p2) m.p2[i + 2] = m.p[i + 2];
    }
    return m;
  };
  const nac = {}, nacPB = {}, nacPatch = {}, capsules = {};
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const ch = cNac[key];
    const nopt = { stations: nacStations(sx), segments: Math.max(28, Math.round(52 * detail / 4) * 4), step: 0.14 / detail };
    const uvF = (strip) => (x, y, z, t, ring) => (ring.run === 0 ? (z > -4.4 ? U.ductDeep : z > -5.15 ? U.ductMid : U.duct) : ch.uvUnwrap(z, t, strip));
    // front capsule (moves) — overlaps the fixed trunk by 0.22 m so no gap opens when it nods
    const cap = K.loft({ ...nopt, zRange: [-6.5, ZCAP + 0.22], inflate: 0.004, uvFn: uvF(0) });
    const l = K.loft({ ...nopt, zRange: [ZCAP, NSPLIT], capStart: 'flat', capUV: U.black, uvFn: uvF(0),
      cutouts: [{ name: 'mlg', z: [-1.0, 0.65], t: [0, 0.1], mirror: true }] });
    const l2 = K.loft({ ...nopt, zRange: [NSPLIT, 6.4], uvFn: uvF(1) });
    l.mesh.occlude((x, y, z) => (z < 0 && Math.abs(x - sx * IC) < IW - 0.01 && Math.abs(y - IY) < IH - 0.01 ? Math.min(0.75, Math.max(0, (z + 5.4) * 0.35)) : 0));
    stat.add(l.mesh).add(l2.mesh);
    // first ramp: hangs from the capsule roof, slopes down toward the throat; second ramp + throat in the fixed duct
    const xa = sx * IC - (IW - 0.075), xb = sx * IC + (IW - 0.075);
    const ramp1 = K.prism([[ZLIP + 0.1, IY + IH - 0.035], [ZCAP + 0.2, IY + IH - 0.035], [ZCAP + 0.2, IY + 0.5], [ZLIP + 0.16, IY + IH - 0.055]], Math.min(xa, xb), Math.max(xa, xb), U.ductMid);
    cap.mesh.occlude((x, y, z) => (Math.abs(x - sx * IC) < IW - 0.01 && Math.abs(y - IY) < IH - 0.01 ? Math.min(0.3, Math.max(0, (z + 5.5) * 0.35)) : 0));
    capsules[key] = { mesh: rake(K.merge(cap.mesh, ramp1)), sx };
    const xa2 = sx * IC - 0.36, xb2 = sx * IC + 0.36;
    stat.add(K.prism([[ZCAP + 0.15, IY + 0.5], [-3.6, IY - 0.05], [-3.22, IY - 0.03], [-3.22, IY + 0.55], [ZCAP + 0.15, IY + 0.6]], Math.min(xa2, xb2), Math.max(xa2, xb2), U.ductDeep));
    // boundary-layer gap: diverter wedge between the forward fuselage and the splitter (inner duct wall)
    const xi0 = sx * 0.55, xi1 = sx * (IC - IW + 0.02);
    stat.add(K.prism([[-5.15, IY + 0.55], [-4.35, IY + 0.62], [-4.35, IY - 0.6], [-5.15, IY - 0.56]], Math.min(xi0, xi1), Math.max(xi0, xi1), U.mid));
    nac[key] = l;
    nacPB[key] = K.loft({ stations: nacStations(sx, true), segments: nopt.segments, step: 0.6 });     // outer skin only, for painting
    ch.body = nacPB[key];
    nacPatch[key] = K.merge(l.patches.mlgR, l.patches.mlgL);
    stat.add(K.well(nacPatch[key], 0.36, U.well, [0, 1, 0]));
  }

  // ---- conformal fuel tanks (F-15E) -----------------------------------------------------------------------------------------
  const cft = {};
  if (isE) {
    const cftSt = (sx) => [[-3.72, 0, 0, 0], [-3.5, 0.08, 0.2, 0.18], [-3.0, 0.16, 0.38, 0.36], [-2.2, 0.2, 0.44, 0.43], [2.1, 0.2, 0.44, 0.43], [2.9, 0.16, 0.38, 0.37], [3.5, 0.07, 0.2, 0.2], [3.72, 0, 0, 0]]
      .map(([z, w, top, bot]) => ({ z, x: sx * (IC + IW + 0.16), y: -0.02, w, top, bot, kTop: 0.72, kBot: 0.8 }));
    for (const [key, sx] of [['R', 1], ['L', -1]]) {
      cft[key] = K.loft({ stations: cftSt(sx), segments: Math.max(20, Math.round(32 * detail / 4) * 4), step: 0.2 / detail, chart: cCft });
      stat.add(cft[key].mesh);
    }
    cCft.body = cft.R;
  }

  // ---- tail booms (carry the fins and stabilators) -------------------------------------------------------------------------
  for (const sx of [1, -1]) {
    stat.add(K.loft({
      stations: [[1.9, 0.29, 0.02, 0.04, 0.04], [2.6, 0.29, 0.1, 0.24, 0.18], [3.6, 0.29, 0.135, 0.28, 0.25], [5.6, 0.28, 0.135, 0.28, 0.25], [6.8, 0.27, 0.11, 0.2, 0.17], [7.3, 0.27, 0.06, 0.09, 0.08], [7.46, 0.27, 0.0, 0.0, 0.0]]
        .map(([z, y, w, top, bot]) => ({ z, x: sx * 1.77, y, w, top, bot, kTop: 0.7, kBot: 0.66 })),
      segments: 20, step: 0.25, chart: cBoom,
    }).mesh);
  }
  // tail-hook fairing between the nozzles
  stat.add(K.loft({ stations: [{ z: 4.2, y: -0.05, w: 0.02, top: 0.02, bot: 0.02 }, { z: 4.7, y: -0.1, w: 0.1, top: 0.08, bot: 0.09, kBot: 0.7 }, { z: 6.2, y: -0.08, w: 0.11, top: 0.1, bot: 0.1, kBot: 0.7 }, { z: 6.9, y: 0.0, w: 0.06, top: 0.06, bot: 0.05 }],
    segments: 12, step: 0.3, uv: U.ti, capEnd: 'flat', capUV: U.soot }).mesh);

  // ---- canopy: fixed one-piece windscreen + one-piece bubble hinged at the rear --------------------------------------------
  const canTop = K.pchip([-8.35, -8.1, -7.85, -7.6, -7.3, -6.95, -6.5, -6.0, -5.5, -5.0, -4.7, -4.5], [0.89, 1.08, 1.26, 1.395, 1.485, 1.54, 1.56, 1.537, 1.445, 1.245, 1.075, 0.965]);
  const canZ = [-8.35, -8.25, -8.1, -7.9, -7.6, -7.3, -6.95, -6.6, -6.2, -5.8, -5.4, -5.0, -4.75, -4.5];
  const canSt = canZ.map(z => { const s = fus.at(z, T_SILL).p; return { z, y: s[1], w: s[0], top: Math.max(0.002, canTop(z) - s[1]), bot: 0.01, kTop: [0.74, 0.62] }; });
  const cseg = Math.max(16, Math.round(36 * detail / 4) * 4), ct = 1 / cseg;
  const canLoft = (zr, tr, inflate, uv, sg = cseg) => K.loft({ stations: canSt, segments: sg, step: 0.1, tRange: tr, zRange: zr, inflate, uv }).mesh;
  const canBody = K.loft({ stations: canSt, segments: cseg, step: 0.3 });
  const ZW = -7.6;
  const glassFixed = canLoft([-8.35, ZW], [0.25, 0.75], 0, [0, 0]);
  const glassMove = canLoft([ZW, -4.5], [0.25, 0.75], 0, [0, 0]);
  const wsFrame = K.merge(canLoft([ZW - 0.075, ZW], [0.25, 0.75], 0.007, U.frame), canLoft([-8.35, ZW], [0.25, 0.25 + ct * 0.7], 0.005, U.frame),
    canLoft([-8.35, ZW], [0.75 - ct * 0.7, 0.75], 0.005, U.frame), canLoft([-8.35, -8.29], [0.25, 0.75], 0.004, U.frame));
  stat.add(wsFrame).add(wsFrame.clone().flip().setUV(U.frameIn));
  const frameMove = K.merge(
    canLoft([ZW, -4.5], [0.25, 0.25 + ct * 0.8], 0.005, U.frame), canLoft([ZW, -4.5], [0.75 - ct * 0.8, 0.75], 0.005, U.frame),
    canLoft([ZW, ZW + 0.065], [0.25, 0.75], 0.007, U.frame), canLoft([-4.68, -4.5], [0.25, 0.75], 0.006, U.frame));
  frameMove.add(frameMove.clone().flip().setUV(U.frameIn));
  {  // rear-view mirrors on the canopy bow, canopy seal along the sill, canopy actuator fairing at the rear
    for (const t of [0.39, 0.5, 0.61]) {
      const q = canBody.at(ZW + 0.04, t), p = q.p, n = q.n;
      frameMove.add(K.box(t === 0.5 ? 0.16 : 0.11, 0.05, 0.012, U.mirror).translate(p[0] - n[0] * 0.05, p[1] - n[1] * 0.05, p[2] + 0.025));
      frameMove.add(K.box(0.02, 0.02, 0.03, U.frameIn).translate(p[0] - n[0] * 0.025, p[1] - n[1] * 0.025, p[2] + 0.01));
    }
  }

  // ---- cockpit ------------------------------------------------------------------------------------------------------------
  const eye = G.pilotEye, eye2 = [0, 1.2, -6.15];
  const tubX = 0.5, tubZ1 = isE ? -4.62 : -6.25;
  stat.add(K.tub({ x: tubX, y0: -0.05, y1: 0.74, z0: -8.25, z1: tubZ1, uv: U.interior, taper: 0.85 }).occlude((x, y) => Math.max(0, 0.55 - y * 0.6)));
  {  // sill ledge closing the gap between the skin cut-out and the tub
    const zs = []; for (let z = Z_CK[0]; z <= Z_CK[1] - 0.001; z += 0.2) zs.push(z); zs.push(Z_CK[1]);
    for (const sx of [1, -1]) {
      let prev = null;
      for (const z of zs) {
        const o = fus.at(z, sx > 0 ? T_SILL : 1 - T_SILL).p, a = stat.vert(o[0], o[1], z, -sx * 0.6, 0.8, 0, U.interior[0], U.interior[1]), b = stat.vert(sx * tubX * 0.9, Math.min(0.72, o[1] - 0.04), z, -sx * 0.6, 0.8, 0, U.interior[0], U.interior[1]);
        if (prev) { if (sx > 0) stat.quad(prev[0], a, b, prev[1]); else stat.quad(prev[0], prev[1], b, a); }
        prev = [a, b];
      }
      // canopy rail / seal strip along the sill
      const r0 = fus.at(Z_CK[0] + 0.05, sx > 0 ? T_SILL : 1 - T_SILL).p, r1 = fus.at(Z_CK[1] - 0.05, sx > 0 ? T_SILL : 1 - T_SILL).p;
      stat.add(K.tube([r0[0] - sx * 0.02, r0[1] + 0.005, r0[2]], [r1[0] - sx * 0.02, r1[1] + 0.005, r1[2]], 0.008, 0.008, { segments: 6, uv: U.frame }));
    }
  }
  if (!isE) {   // F-15C: avionics bay under the rear of the canopy, behind the seat
    stat.add(K.box(0.86, 0.06, 1.7, U.console).translate(0, 0.84, -5.4));
    stat.add(K.box(0.9, 0.62, 0.05, U.interior).translate(0, 0.52, -6.24));
    for (const [x, z, w, h, d] of [[-0.22, -5.9, 0.3, 0.1, 0.42], [0.2, -5.75, 0.34, 0.08, 0.5], [0, -5.0, 0.6, 0.07, 0.4]]) stat.add(K.box(w, h, d, U.dark).translate(x, 0.87 + h / 2, z));
  }
  // instrument panel + glareshield (kit): top of the coaming at ≈ 0.83 as on the real jet; the F-15C keeps its radar scope (VSD)
  // and an attitude indicator, the E multi-purpose displays
  stat.add(K.instrumentPanel({ eye, kind: 'fighter', dist: 0.62, drop: 0.51, height: 0.42, width: 0.8, analogue: !isE, centreDisplay: isE ? 'mfdHsd' : undefined, pages: isE ? ['mfdSA', 'mfdRadar'] : ['mfdRadar', 'standby'], uv: U.console }));
  stat.add(K.box(0.22, 0.32, 0.45, U.console).translate(0, 0.16, -7.5));                   // centre pedestal
  for (const sx of [-1, 1]) stat.add(K.box(0.15, 0.1, 1.2, U.console).translate(sx * 0.38, 0.52, -6.95));   // side consoles
  stat.add(K.stick({ base: [0, 0.32, -7.42], height: 0.32, uv: U.black, uvGrip: U.dark }));
  stat.add(K.box(0.06, 0.1, 0.1, U.dark).translate(-0.37, 0.64, -7.22)).add(K.box(0.06, 0.1, 0.1, U.dark).translate(-0.31, 0.64, -7.22));   // throttles
  const aces = (e) => {   // ACES II: kit seat + headrest drogue pitots, yellow-black handles, survival kit
    const m = K.ejectionSeat({ eye: e, recline: 15, width: 0.5, uv: { frame: U.seat, cushion: U.cushion, accent: U.accent } });
    for (const sx of [-1, 1]) {
      m.add(K.tube([e[0] + sx * 0.2, e[1] + 0.2, e[2] + 0.45], [e[0] + sx * 0.2, e[1] + 0.26, e[2] + 0.28], 0.012, 0.008, { segments: 6, uv: U.probe }));
      m.add(K.box(0.03, 0.12, 0.05, U.accent).translate(e[0] + sx * 0.27, e[1] - 0.72, e[2] - 0.12));
    }
    m.add(K.box(0.36, 0.3, 0.12, U.chute).rotateX(15 * DEG).translate(e[0], e[1] - 0.05, e[2] + 0.36));
    return m;
  };
  stat.add(aces(eye));
  const hudParts = K.hud({ eye, dist: 0.6, width: 0.22, height: 0.19, drop: 0.035, uv: U.console });
  stat.add(hudParts.frame);
  const pilotUV = { suit: U.suit, helmet: U.helmet, visor: U.visor, dark: U.dark, glove: U.glove };
  const pilotMesh = K.pilot({ eye, recline: 14, stick: [0, -0.43, -0.3], throttle: [-0.34, -0.42, -0.08], uv: pilotUV });
  if (isE) {   // WSO cockpit
    stat.add(K.instrumentPanel({ eye: eye2, kind: 'fighter', dist: 0.56, drop: 0.45, height: 0.36, width: 0.72, mfd: 0.15, centreDisplay: 'mfdTgp', pages: ['mfdStores', 'mfdSA'], uv: U.console }));
    for (const sx of [-1, 1]) stat.add(K.stick({ base: [sx * 0.33, 0.66, -6.35], height: 0.14, uv: U.black, uvGrip: U.dark }));
    stat.add(aces(eye2));
    stat.add(K.pilot({ eye: eye2, recline: 14, stick: [0.33, -0.42, -0.18], throttle: [-0.33, -0.42, -0.18], uv: pilotUV }));
  }

  // ---- wings (cropped delta, conical camber, chamfered tips) ------------------------------------------------------------------
  const mkWing = (side) => K.wing({
    side, airfoil: K.naca6(0.05, 0.002), chordPts: Math.round(13 * detail), spanAxis: 'x', tip: 'flat',
    stations: [
      { x: 1.2, y: wy(1.2), z: zLE(1.2), chord: zTE(1.2) - zLE(1.2), tc: 0.064, airfoil: K.naca6(0.064, 0.0) },
      { x: 3.4, y: wy(3.4), z: zLE(3.4), chord: zTE(3.4) - zLE(3.4), tc: 0.05, twist: -0.6, airfoil: K.naca6(0.05, 0.004) },
      { x: XCUT, y: wy(XCUT), z: zLE(XCUT), chord: zTE(XCUT) - zLE(XCUT), tc: 0.034, twist: -2.2, hard: true, airfoil: K.naca6(0.034, 0.01) },
      { x: XTIP, y: wy(XTIP), z: zTE(XTIP) - TIPC, chord: TIPC, tc: 0.03, twist: -2.2, airfoil: K.naca6(0.03, 0.008) },
    ],
    lines: { hinge: [[1.6, 0.84], [3.3, 0.79], [XCUT, 0.75], [XTIP, 0.55]] },
    controls: [
      { name: 'flap', type: 'flap', span: [1.68, 3.3], from: 'hinge', nose: 1 },
      { name: 'aileron', type: 'flap', span: [3.38, 5.7], from: 'hinge', nose: 1 },
    ],
    charts: { upper: side > 0 ? cWT.R : cWT.L, lower: side > 0 ? cWB.R : cWB.L },
  });
  const W = { R: mkWing(1), L: mkWing(-1) };
  stat.add(W.R.mesh).add(W.L.mesh);
  // wingtip: ALR-56 RWR antenna fairing at the forward end of the chamfer, nav-light lens
  for (const sx of [1, -1]) {
    const x = sx * (XCUT + 0.42), z = zLE(XCUT) + 0.85, y = wy(XCUT + 0.42);
    stat.add(K.lathe([[0, -0.28], [0.03, -0.24], [0.045, -0.15], [0.045, 0.2], [0.03, 0.3], [0, 0.34]], { segments: 10, uv: U.dielectric }).translate(x, y, z));
  }

  // ---- stabilators (all-moving, inboard dog-tooth) --------------------------------------------------------------------------
  const mkStab = (side) => K.wing({
    side, airfoil: K.biconvex(0.045), chordPts: Math.round(9 * detail), spanAxis: 'x', tip: 'flat', root: 'flat',
    stations: [
      { x: 1.95, y: sty(1.95), z: 3.78, chord: STE - 3.78, tc: 0.05 },
      { x: XDT, y: sty(XDT), z: 4.5, chord: STE - 4.5, tc: 0.048 },
      { x: XDT + 0.025, y: sty(XDT + 0.025), z: 4.28, chord: STE - 4.28, tc: 0.048, hard: true },
      { x: 4.3, y: sty(4.3), z: 6.0, chord: STE - 6.0, tc: 0.035 },
    ],
    charts: { upper: cST, lower: cSB },
  });
  const stab = { R: mkStab(1), L: mkStab(-1) };

  // ---- fins -----------------------------------------------------------------------------------------------------------------
  const mkFin = (sx) => K.wing({
    airfoil: K.biconvex(0.045), chordPts: Math.round(10 * detail), spanAxis: 'y', tip: 'flat',
    stations: [{ x: sx * FX, y: FIN.y0, z: FIN.z0, chord: FIN.c0, tc: 0.045 }, { x: sx * FX, y: FIN.y1, z: FIN.z1, chord: FIN.c1, tc: 0.03 }],
    lines: { hinge: [[0.9, 0.73], [FIN.y1, 0.66]] },
    controls: [{ name: 'rudder', type: 'flap', span: [0.98, 2.5], from: 'hinge', nose: 1 }],
    charts: { upper: cFin.L, lower: cFin.R },
  });
  const fins = { R: mkFin(1), L: mkFin(-1) };
  stat.add(fins.R.mesh).add(fins.L.mesh);
  const finTE = FIN.z1 + FIN.c1;   // TE z at the tip
  {
    // left fin tip: AN/ALQ-135 ECM antenna pod (long, dielectric ends); right: short pod with a forward mass-balance boom
    const yt = FIN.y1 - 0.01;
    stat.add(K.lathe([[0, 3.95], [0.04, 4.02], [0.075, 4.18], [0.088, 4.4]], { segments: 14, uv: U.dielLight }).translate(-FX, yt, 0));
    stat.add(K.lathe([[0.088, 4.4], [0.088, 6.25]], { segments: 14, uv: U.mid }).translate(-FX, yt, 0));
    stat.add(K.lathe([[0.088, 6.25], [0.08, 6.5], [0.055, 6.7], [0, 6.78]], { segments: 14, uv: U.dielectric }).translate(-FX, yt, 0));
    stat.add(K.lathe([[0, 4.55], [0.04, 4.62], [0.066, 4.8], [0.066, 5.9], [0.05, 6.15], [0, finTE + 0.22]], { segments: 12, uv: U.mid }).translate(FX, yt, 0));
    stat.add(K.tube([FX, yt, 4.62], [FX, yt, 3.95], 0.018, 0.008, { segments: 6, uv: U.steel }));
    stat.add(K.ellipsoid(0.03, 0.03, 0.09, { segments: 8, rings: 5, uv: U.steel }).translate(FX, yt, 4.05));
    // fin-root fairings on the booms
    for (const sx of [1, -1]) stat.add(K.lathe([[0, 6.05], [0.05, 6.2], [0.06, 6.45], [0.035, 6.75], [0, 6.85]], { segments: 8, uv: U.dark }).translate(sx * FX, 1.12, 0));
  }

  // ---- nozzles (featherless F100 C-D nozzles, exposed actuator links), afterburner, jet pipe ---------------------------------
  const nozzles = [], glows = [];
  for (const [i, sx] of [[0, -1], [1, 1]]) {
    const c = [sx * 1.0, 0.2, 0], z0 = 6.25, z1 = 7.25, r0 = 0.6, rC = 0.45, rO = 0.56;
    const nz = K.petalNozzle({ z0, z1, r0, rClosed: rC, rOpen: rO, petals: 18, centre: c, uvOuter: U.heat, uvInner: U.heat2, thickness: 0.03, chart: cNoz, throat: 0.84 });
    // actuator links: ring → mid-petal, morphing with the petals
    const prof = (u, rE) => r0 + (rE - r0) * (0.25 * u + 0.75 * u * u);
    const links = (rE) => { const m = new K.Mesh(); for (let k = 0; k < 18; k++) { const a = (k + 0.5) / 18 * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a), r1 = prof(0.55, rE) + 0.022; m.add(K.tube([c[0] + cs * 0.625, c[1] + sn * 0.625, 6.33], [c[0] + cs * r1, c[1] + sn * r1, z0 + 0.55], 0.012, 0.01, { segments: 5, uv: U.steel })); } return m; };
    const lc = links(rC), lo = links(rO); lc.p2 = lo.p.slice();
    nz.add(lc);
    nozzles.push(nz);
    stat.add(K.lathe([[0.63, 6.22], [0.635, 6.3, 1], [0.615, 6.4, 1], [0.6, 6.22]], { segments: 30, uv: U.nacAft }).translate(c[0], c[1], 0));      // sync ring
    for (let k = 0; k < 5; k++) {   // main nozzle actuators along the nacelle end
      const a = (k + 0.2) / 5 * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
      stat.add(K.tube([c[0] + cs * 0.62, c[1] + sn * 0.62, 5.85], [c[0] + cs * 0.64, c[1] + sn * 0.64, 6.3], 0.03, 0.026, { segments: 6, uv: U.steel }));
    }
    stat.add(K.lathe([[0.58, 6.3], [0.53, 5.7], [0.52, 5.1], [0, 5.1]], { segments: 24, uv: U.exhaust }).translate(c[0], c[1], 0).occlude((x, y, z) => Math.min(0.8, (6.4 - z) * 0.6)));             // jet pipe + turbine face
    for (let k = 0; k < 10; k++) stat.add(K.box(0.025, 0.46, 0.05, U.soot).translate(0, 0.23, 0).rotateZ(k * Math.PI / 5).translate(c[0], c[1], 5.3));
    stat.add(K.lathe([[0.22, 5.24], [0.22, 5.34], [0.18, 5.34], [0.18, 5.24]], { segments: 20, uv: U.soot }).translate(c[0], c[1], 0));
    glows.push(K.afterburnerGlow({ zDeep: 5.32, zExit: 7.0, rDeep: 0.5, rExit: 0.42, centre: c }));
  }

  // ---- speedbrake (large dorsal panel behind the canopy, hinged at its front edge) ----------------------------------------------
  const P = fus.patches;
  const sbMesh = K.thicken(P.sb, 0.035, U.wellDark);
  stat.add(K.well(P.sb, 0.16, U.wellDark, [0, -1, 0]));
  const sbEdge = fus.edges.sb.zLo;
  {  // well structure: ribs and the actuator
    const y0 = fus.topAt(-3.1) - 0.15;
    for (const z of [-3.9, -3.3, -2.7]) stat.add(K.box(1.05, 0.05, 0.03, U.well).translate(0, y0 + 0.03, z));
    stat.add(K.tube([0, y0 + 0.02, -2.25], [0, y0 + 0.09, -3.4], 0.04, 0.03, { segments: 8, uv: U.steel }));
  }

  // ---- nose gear well -------------------------------------------------------------------------------------------------------
  const ngPatch = K.merge(P.ngR, P.ngL);
  stat.add(K.well(ngPatch, 0.42, U.well, [0, 1, 0]));

  // ---- stores ---------------------------------------------------------------------------------------------------------------
  const aim120 = () => K.missile({ length: 3.66, radius: 0.089, canards: { z: 1.35, chord: 0.3, span: 0.12 }, wings: { z: 3.22, chord: 0.36, span: 0.15 }, uvBody: U.aim, uvNose: U.aim, uvFin: U.aim });
  const aim9x = () => {
    const m = K.missile({ length: 3.02, radius: 0.064, canards: { z: 0.28, chord: 0.07, span: 0.03 }, wings: { z: 2.7, chord: 0.24, span: 0.09 }, uvBody: U.aim9, uvNose: U.aim9, uvFin: U.aim9 });
    return m.add(K.ellipsoid(0.05, 0.05, 0.06, { segments: 10, rings: 5, uv: U.seeker, z0: -1, z1: 0 }).translate(0, 0, 0.07));
  };
  const SS = SC.stores;
  {
    // inboard wing pylons (stations 2 / 8): LAU-128 rails both sides (AIM-120 inboard, AIM-9X outboard), optional 610-gal tank
    for (const sx of [1, -1]) {
      const xp = 2.95, wl = W.R.at(xp, 0.45, 'lower'), zf = zLE(xp) + 0.65, x = sx * xp, yt = wl[1] - 0.36;
      stat.add(K.pylon([{ y: yt, z0: zf + 0.25, z1: zf + 2.75, x, tc: 0.085 }, { y: wl[1] + 0.06, z0: zf - 0.1, z1: zf + 3.05, x, tc: 0.085 }], { uv: U.pylon }));
      stat.add(K.box(0.36, 0.07, 1.6, U.pylon).translate(x, yt + 0.16, zf + 1.4));          // rail adapter crossbar
      if (SS.wingTanks) stat.add(K.tank({ length: 5.4, radius: 0.33, uv: U.tank, fins: 0 }).translate(x, yt - 0.35, zf - 1.05));
      for (const [d, isAim9] of [[-0.21, false], [0.21, true]]) {
        const rx = x + sx * d, ry = yt + 0.14;
        stat.add(K.launchRail({ x: rx, y: ry, z0: zf + 0.1, z1: zf + 2.75, w: 0.06, h: 0.09, uv: U.pylon }));
        const msl = isAim9 ? aim9x() : aim120();
        stat.add(msl.translate(rx, ry - 0.045 - (isAim9 ? 0.064 : 0.089), zf - 0.25));
      }
    }
    if (!isE) {   // four AIM-120s semi-recessed on the lower corners of the intake trunks / aft fuselage
      for (const sx of [1, -1]) {
        for (const [z0, xx, yy] of [[-4.35, IC + IW - 0.08, IY - IH - 0.06], [1.5, 1.33, -0.62]]) {
          const m = aim120().translate(sx * xx, yy, z0);
          stat.add(m);
          stat.add(K.box(0.05, 0.05, 1.6, U.pylon).translate(sx * xx, yy + 0.1, z0 + 1.3));
        }
      }
    } else {     // F-15E: CFT stub pylons, GBU-12s, LANTIRN pods on the intake chin stations
      for (const sx of [1, -1]) {
        for (const z of [-2.4, -0.9, 0.6, 2.0]) for (const tt of [0.17, 0.06]) { const q = cft.R.at(z, tt).p; stat.add(K.box(0.07, 0.07, 0.42, U.pylon).translate(sx * q[0], q[1] - 0.025, z)); }
        for (const z0 of [-3.1, 0.35]) {
          const q = cft.R.at(z0 + 1.5, 0.17).p;
          stat.add(K.missile({ length: 3.27, radius: 0.136, canards: { z: 0.28, chord: 0.22, span: 0.09 }, wings: { z: 2.68, chord: 0.55, span: 0.27 }, uvBody: U.bomb, uvNose: U.bombNose, uvFin: U.bomb, roll: 45 }).translate(sx * q[0], q[1] - 0.2, z0));
        }
      }
      const yb = IY - IH - 0.02;
      for (const [sx, len, r, z0] of [[1, 1.99, 0.165, -5.6], [-1, 2.5, 0.19, -5.95]]) {
        const x = sx * IC, y = yb - 0.32;
        stat.add(K.prism([[z0 + 0.45, yb + 0.02], [z0 + len - 0.35, yb + 0.02], [z0 + len - 0.5, y + r - 0.02], [z0 + 0.6, y + r - 0.02]], x - 0.04, x + 0.04, U.pylon));
        stat.add(K.lathe([[0, z0 + 0.06], [r * 0.7, z0 + 0.08], [r * 0.95, z0 + 0.18], [r, z0 + 0.35], [r, z0 + len - 0.35], [r * 0.7, z0 + len - 0.08], [0, z0 + len]], { segments: 18, uv: U.pod }).translate(x, y, 0));
        if (sx > 0) { stat.add(K.box(0.2, 0.17, 0.04, U.podWin).translate(x, y + 0.04, z0 + 0.08)); stat.add(K.ellipsoid(0.14, 0.1, 0.32, { segments: 12, rings: 6, uv: U.pod }).translate(x, y - 0.13, z0 + 0.5)); }
        else { stat.add(K.ellipsoid(r * 0.98, r * 0.98, 0.22, { segments: 16, rings: 8, uv: U.pod, z0: -1, z1: 0 }).translate(x, y, z0 + 0.3)); stat.add(K.box(0.16, 0.13, 0.05, U.podWin).translate(x, y - 0.03, z0 + 0.1)); }
      }
    }
    // centreline pylon (+ 610-gal tank)
    stat.add(K.pylon([{ y: -0.83, z0: -1.9, z1: 0.5, x: 0, tc: 0.07 }, { y: -0.6, z0: -2.2, z1: 0.75, x: 0, tc: 0.07 }], { uv: U.pylon }));
    if (SS.centre) stat.add(K.tank({ length: 5.6, radius: 0.35, uv: U.tank, fins: 0 }).translate(0, -1.2, -3.55));
  }

  // ---- small details: air-data probes, AoA vanes, antennas, gun port, wicks ------------------------------------------------------
  {
    for (const sx of [1, -1]) {
      // L-shaped pitot-static probes just aft of the radome, below the side
      const p = fus.at(-8.95, sx > 0 ? 0.2 : 0.8).p, a = [p[0] + sx * 0.1, p[1] - 0.02, p[2] - 0.02];
      stat.add(K.tube(p, a, 0.02, 0.014, { segments: 6, uv: U.probe })).add(K.probe(a, [a[0], a[1], a[2] - 0.32], 0.013, U.probe));
      // AoA transmitter vane on a flush disc
      const q = fus.at(-8.15, sx > 0 ? 0.3 : 0.7), qp = q.p, qn = q.n;
      stat.add(K.lathe([[0, 0], [0.05, 0], [0.05, 0.006], [0, 0.008]], { segments: 10, uv: U.steel }).aim(qn).translate(qp[0], qp[1], qp[2]));
      stat.add(K.prism([[qp[2] - 0.02, qp[1] + 0.01], [qp[2] + 0.1, qp[1] + 0.015], [qp[2] + 0.09, qp[1] - 0.015], [qp[2] - 0.02, qp[1] - 0.01]], qp[0] + sx * 0.002, qp[0] + sx * 0.06, U.steel));
    }
    stat.add(K.probe(fus.at(-7.3, 0.12).p, [0.12, fus.botAt(-7.3) - 0.03, -7.42], 0.009, U.probe));        // total temperature probe
    // AN/APX-114 "bird slicer" IFF blades ahead of the windscreen
    for (const x of [-0.15, -0.05, 0.05, 0.15]) stat.add(K.bladeAntenna({ pos: [x, fus.topAt(-9.0) - 0.006 - Math.abs(x) * 0.25, -9.0], height: 0.07, chord: 0.05, sweep: 0.02, thickness: 0.006, uv: U.darkPaint }));
    stat.add(K.bladeAntenna({ pos: [0, fus.topAt(-1.3) - 0.01, -1.3], height: 0.2, chord: 0.3, sweep: 0.16, uv: U.mid }));         // UHF
    stat.add(K.bladeAntenna({ pos: [0, fus.topAt(1.5) - 0.01, 1.5], height: 0.13, chord: 0.2, sweep: 0.1, uv: U.mid }));          // TACAN
    stat.add(K.bladeAntenna({ pos: [0, fus.botAt(-7.6) + 0.01, -7.6], height: 0.14, chord: 0.2, sweep: 0.09, down: true, uv: U.under }));
    stat.add(K.bladeAntenna({ pos: [0.3, fus.botAt(-3.0) + 0.01, -3.0], height: 0.16, chord: 0.22, sweep: 0.12, down: true, uv: U.under }));
    stat.add(K.bladeAntenna({ pos: [-0.3, fus.botAt(3.2) + 0.01, 3.2], height: 0.12, chord: 0.16, sweep: 0.08, down: true, uv: U.under }));
    // M61A1 gun: muzzle fairing on the right wing root, just aft of the intake trunk top
    const gz = -2.9, gx = IC + IW - 0.12, gy = IY + IH + 0.02;
    stat.add(K.loft({ stations: [{ z: gz - 0.05, x: gx, y: gy, w: 0.01, top: 0.01, bot: 0.01 }, { z: gz + 0.15, x: gx, y: gy, w: 0.08, top: 0.06, bot: 0.04 }, { z: gz + 1.0, x: gx, y: gy - 0.03, w: 0.07, top: 0.03, bot: 0.02 }, { z: gz + 1.5, x: gx, y: gy - 0.05, w: 0.01, top: 0.01, bot: 0.01 }], segments: 12, step: 0.2, uv: U.mid }).mesh);
    stat.add(K.ellipsoid(0.045, 0.035, 0.02, { segments: 10, rings: 4, uv: U.gun }).translate(gx, gy + 0.005, gz + 0.04));
    // static dischargers on the wing, stabilator and fin trailing edges
    const wicks = [];
    for (const sx of [1, -1]) {
      for (const x of [4.6, 5.4, 6.2]) { const p = W.R.at(Math.min(x, XTIP - 0.05), 0.995, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); }
      for (const x of [3.3, 4.1]) wicks.push([sx * x, sty(x), STE]);
      for (const y of [2.9, 3.6]) { const p = fins.R.at(y, 0.995, 'mid'); wicks.push([sx * FX, p[1], p[2]]); }
    }
    stat.add(K.staticWicks(wicks.filter((w, i) => i % 7 < 3), 0.14, U.dark));
  }

  // ---- materials ----------------------------------------------------------------------------------------------------------
  lap('geometry');
  paint(atlas, { SC, isE, fus, nacPB, W, fins, cFus, cNac, cCft, cWT, cWB, cST, cSB, cFin, cBoom, cNoz, paintF, T_SB, T_SILL, cft });
  lap('paint');
  const mat = atlas.material(ctx, { envMapIntensity: 1 });
  lap('textures');
  rig.material('paint', mat, { shared: true });
  rig.disposables.push(atlas);
  rig.glass('canopy', K.glassMaterial(ctx, { tint: '#3c3a2e', opacity: 0.1, edgeOpacity: 0.62, metalness: 0.25, roughness: 0.04, reflect: 1 }));
  rig.glass('hud', K.glassMaterial(ctx, K.GLASS.hud));
  const glowMat = [rig.material('glowL', K.glowMaterial(), { shadow: false }), rig.material('glowR', K.glowMaterial(), { shadow: false })];

  rig.addStatic(stat, 'paint');
  rig.addStatic(glassFixed, 'canopy');
  rig.addStatic(hudParts.glass, 'hud');

  // ---- moving parts ------------------------------------------------------------------------------------------------------
  const CP = [0, 0.94, -4.52];
  const canopyNode = rig.node('canopy', { pivot: CP });
  rig.part('canopyGlass', glassMove, { parent: canopyNode, key: 'canopy' });
  rig.part('canopyFrame', frameMove, { parent: canopyNode });
  const setCanopy = rig.hinge(canopyNode, [-1, CP[1], CP[2]], [1, CP[1], CP[2]], { ref: [0, 1.5, -7.5], toward: [0, 1, 0] });
  const pilotNode = rig.part('pilot', pilotMesh, { pivot: eye });

  const ail = { R: rig.hingePart('aileronR', W.R.controls.aileron), L: rig.hingePart('aileronL', W.L.controls.aileron) };
  const flp = { R: rig.hingePart('flapR', W.R.controls.flap), L: rig.hingePart('flapL', W.L.controls.flap) };
  const rud = { R: rig.hingePart('rudderR', fins.R.controls.rudder, { toward: [1, 0, 0] }), L: rig.hingePart('rudderL', fins.L.controls.rudder, { toward: [1, 0, 0] }) };
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
  // intake capsules: hinge across the duct at the lower aft corner of the capsule; + angle = lip down
  const setCap = ['R', 'L'].map((key) => {
    const { mesh, sx } = capsules[key], py = IY - IH + 0.32, a = [sx * IC - 0.6, py, ZCAP], b = [sx * IC + 0.6, py, ZCAP];
    const node = rig.part('intake' + key, mesh, { pivot: a });
    return rig.hinge(node, a, b, { ref: [sx * IC, IY + IH, ZLIP - 0.3], toward: [0, -1, 0] });
  });
  const HP = [0, -0.15, 4.45];
  const hookNode = rig.part('hook', K.arrestorHook({ pivot: HP, length: 1.7, radius: 0.035, uv: U.steel }), { pivot: HP });
  const setHook = rig.hinge(hookNode, [-1, HP[1], HP[2]], [1, HP[1], HP[2]], { ref: [0, HP[1], HP[2] + 1.7], toward: [0, -1, 0] });

  // ---- landing gear --------------------------------------------------------------------------------------------------------
  const gp = G.gear;
  const gearUV = { strut: U.strut, piston: U.chrome, tyre: U.tyre, hub: U.hub };
  const doorOf = (patch, edge, inner = U.well) => ({ mesh: K.thicken(patch, 0.02, inner), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  {
    const extra = new K.Mesh();   // nose leg: lamp bracket, hydraulic line, small leg door
    extra.add(K.box(0.24, 0.05, 0.06, U.strut).translate(0, -1.07, -4.8));
    extra.add(K.tube([0.07, -0.45, -4.76], [0.07, -1.0, -4.84], 0.009, 0.009, { segments: 5, uv: U.hyd }));
    extra.add(K.plate([-0.2, -0.5, -4.82], [0.2, -0.5, -4.82], [0.2, -0.95, -4.86], [-0.2, -0.95, -4.86], 0.015, U.mid));
    K.buildGear(rig, atlas, {
      name: 'nose', index: 0, contact: gp[0].pos, wheelRadius: gp[0].wheelRadius, wheelWidth: 0.19, pivot: [0, -0.4, -4.72], stroke: 0.26, staticFrac: 0.3,
      strutR: 0.06, fork: 'fork', steer: true, links: 'rear', retract: { to: [0, -0.3, -5.95] }, window: [0.22, 0.88],
      brace: [0, -0.45, -4.15], uv: gearUV, extra,
      doors: [
        { name: 'noseDoorR', ...doorOf(P.ngR, fus.edges.ngR.tHi), open: 88, toward: [0, -1, 0] },
        { name: 'noseDoorL', ...doorOf(P.ngL, fus.edges.ngL.tLo), open: 88, toward: [0, -1, 0] },
      ],
      lamps: [{ kind: 'landing', pos: [0.08, -1.07, -4.84], size: 0.05, color: [1, 0.96, 0.88] }, { kind: 'taxi', pos: [-0.08, -1.07, -4.84], size: 0.045, color: [1, 0.96, 0.88] }],
    });
  }
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, edge = nac[key].edges, off = 0.2, ax = [c[0] - sx * off, c[1], c[2]], P0 = [sx * 1.2, -0.4, 0.62];
    const extra = new K.Mesh();
    // outboard leg door riding on the strut, hydraulic brake line
    extra.add(K.plate([sx * 1.04, -0.47, 0.49], [sx * 1.33, -0.47, 0.49], [sx * 1.33, -0.86, 0.45], [sx * 1.04, -0.86, 0.45], 0.015, U.mid));
    extra.add(K.tube([sx * 1.25, -0.45, 0.68], [sx * 1.25, -1.15, 0.6], 0.01, 0.01, { segments: 5, uv: U.hyd }));
    const g = K.buildGear(rig, atlas, {
      name: 'main' + key, index: i, contact: ax, wheels: [sx * off], wheelRadius: gp[i].wheelRadius, wheelWidth: 0.24,
      pivot: P0, stroke: 0.3, staticFrac: 0.35, strutR: 0.085, fork: 'half', links: 'rear',
      retract: { to: [sx * 1.08, -0.3, -0.55], twist: 90 }, window: [0.2, 0.9], brace: [sx * 1.15, -0.45, 1.3], uv: gearUV, extra,
      doors: [{ name: 'mainDoor' + key, ...doorOf(nacPatch[key], sx > 0 ? edge.mlgL.tLo : edge.mlgR.tHi), open: 95, toward: [0, -1, 0] }],
    });
    // brake housing between the strut and the wheel (rides on the piston, does not spin)
    const C = [ax[0], ax[1] + gp[i].wheelRadius, ax[2]], bx = C[0] + sx * 0.06;
    const br = K.lathe([[0.05, -0.04], [0.2, -0.04, 1], [0.2, 0.04, 1], [0.05, 0.04]], { segments: 16, uv: U.brake }).rotateY(Math.PI / 2).translate(bx, C[1], C[2]);
    br.add(K.box(0.05, 0.06, 0.3, U.brake).translate(bx, C[1] + 0.08, C[2] + 0.1));
    rig.part('brake' + key, br, { parent: g.piston, pivot: C });
  }

  // ---- lamps ---------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.04, squash: [0.7, 0.7, 1.6] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.04, squash: [0.7, 0.7, 1.6] });
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.035 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.045 });
  rig.lamp('strobe', [FX, FIN.y1 - 0.01, finTE + 0.24], { color: [1, 1, 1], size: 0.04 });
  for (const sx of [1, -1]) rig.lamp('nav', [sx * (IC + IW + 0.025), IY + 0.25, -5.0], { color: sx > 0 ? [0.02, 1, 0.25] : [1, 0.04, 0.02], size: 0.03 });   // intake-side position lights
  // electroluminescent formation strips (painted pale green; glow with the nav lights)
  for (const sx of [1, -1]) {
    const tf = fus.tAtY(-8.6, 0.14), f = fus.at(-8.6, sx > 0 ? tf : 1 - tf).p;
    rig.lamp('formation', [f[0] + sx * 0.004, f[1], f[2]], { color: [0.12, 0.22, 0.08], size: 0.3, squash: [0.02, 0.09, 1] });
    const ff = fins.R.at(2.75, 0.47, 'upper');
    rig.lamp('formation', [sx * (FX + Math.abs(ff[0] - FX) + 0.004), ff[1], ff[2]], { color: [0.12, 0.22, 0.08], size: 0.3, squash: [0.02, 0.09, 1] });
    const wt = W.R.at(5.35, 0.3, 'upper');
    rig.lamp('formation', [sx * wt[0], wt[1] + 0.006, wt[2]], { color: [0.12, 0.22, 0.08], size: 0.25, squash: [1, 0.02, 0.11] });
  }

  // ---- animation -----------------------------------------------------------------------------------------------------------
  let capAng = 11 * DEG, first = true;
  rig.onUpdate((S, dt) => {
    const sf = S.sf;
    ail.R.set(sf.aileronR * 20 * DEG); ail.L.set(sf.aileronL * 20 * DEG);
    flp.R.set(-sf.flaps * 30 * DEG); flp.L.set(-sf.flaps * 30 * DEG);
    setStab.R(sf.elevatorR * 25 * DEG); setStab.L(sf.elevatorL * 25 * DEG);
    rud.R.set(sf.rudder * 25 * DEG); rud.L.set(sf.rudder * 25 * DEG);
    setSB(sf.speedbrake * 45 * DEG);
    for (let i = 0; i < 2; i++) { const e = S.eng[i] || S.eng[0]; nozNodes[i].morphTargetInfluences[0] = e.nozzle ?? 0; K.abGlowColor(glowMat[i].color, e, S.night); }
    // variable-capture intakes: full down (+11°) parked / slow, schedule with AoA in flight, −4° supersonic
    const raw = S.raw || {}, aoa = Number.isFinite(raw.aoa) ? raw.aoa / DEG : 0, mach = Number.isFinite(raw.mach) ? raw.mach : 0;
    let target;
    if (S.onGround && S.groundSpeed < 45) target = 11;
    else target = Math.max(-4, Math.min(11, -1.5 + aoa * 0.85 - Math.max(0, mach - 0.9) * 6));
    capAng += (target * DEG - capAng) * (first || !(dt > 0) ? 1 : Math.min(1, dt * 2.5)); first = false;
    for (const s of setCap) s(capAng);
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
/** Ring parameter t in [t0, t1] where the skin of `body` at station z is at lateral position x (bisection; x clamped). */
function tAtX(body, z, x, t0, t1) {
  let a = t0, b = t1; const xa = body.at(z, a).p[0], xb = body.at(z, b).p[0];
  if ((x - xa) * (x - xb) > 0) return Math.abs(x - xa) < Math.abs(x - xb) ? a : b;
  for (let i = 0; i < 16; i++) { const m = (a + b) / 2, xm = body.at(z, m).p[0]; if ((xm - x) * (xa - xb) > 0) a = m; else b = m; }
  return (a + b) / 2;
}
/** Densify a closed plan polygon [[x, z], ...] so its edges stay straight after a non-linear mapping. */
function densify(poly, step = 0.2) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}

// Camouflage patterns (plan view, right side; x ≥ 0, z). Dark colour on the upper surfaces.
const CAMO = {
  mod: {
    spine: [[0, -4.55], [0.5, -4.55], [0.74, -3.9], [0.98, -2.7], [0.72, -1.6], [0.86, -0.2], [1.12, 1.1], [0.95, 2.6], [0.62, 3.6], [0.42, 4.7], [0, 6.2]],
    intake: [[0.64, -6.2], [1.75, -6.2], [1.75, -4.4], [1.55, -3.3], [1.3, -3.7], [1.0, -4.6], [0.64, -5.0]],
    nacAft: [[0.9, 0.9], [1.7, 0.4], [1.7, 3.0], [1.25, 3.4], [0.95, 2.4]],
    wing: [[1.1, -3.0], [1.66, -2.39], [3.15, -0.9], [4.25, 0.2], [3.95, 0.95], [3.05, 1.45], [2.45, 3.5], [1.1, 3.5]],
    wingTip: [[4.85, 0.8], [XCUT, zLE(XCUT)], [6.25, 2.55], [5.95, 3.4], [5.15, 3.05], [4.65, 1.9]],
    stab: [[1.85, 3.7], [2.75, 4.42], [3.35, 5.1], [3.05, 6.25], [2.3, 7.3], [1.85, 7.3]],
  },
  ghost: {
    spine: [[0, -8.2], [0.45, -8.0], [0.7, -6.8], [0.9, -4.4], [1.0, -2.0], [0.8, 0.5], [1.05, 2.5], [0.6, 4.2], [0, 6.2]],
    intake: [[0.64, -6.2], [1.75, -6.2], [1.75, -3.6], [1.2, -3.0], [0.64, -4.2]],
    nacAft: [[0.9, 1.5], [1.7, 1.0], [1.7, 3.6], [1.0, 3.2]],
    wing: [[1.1, -3.0], [1.66, -2.39], [2.6, -1.45], [3.6, 0.6], [2.9, 1.8], [2.2, 3.5], [1.1, 3.5]],
    wingTip: [[4.1, 0.05], [5.3, 1.25], [5.0, 2.6], [4.2, 3.3], [3.6, 2.2]],
    stab: [[1.85, 3.7], [2.75, 4.42], [3.0, 5.5], [2.2, 7.3], [1.85, 7.3]],
  },
};

function paint(atlas, o) {
  const { SC, isE, fus, nacPB, W, fins, cFus, cNac, cCft, cWT, cWB, cST, cSB, cFin, cBoom, cNoz, paintF, T_SB, T_SILL } = o, F = K.FINISH;
  const light = paintF(SC.light), dark = paintF(SC.dark), mark = SC.mark, wx = SC.weather;
  const camo = SC.camo ? CAMO[SC.camo] : null;
  const slime = { color: '#c4cc95', rough: 0.35, metal: 0 };
  const rnd = (() => { let a = 4711; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const line = { px: 1, depth: 0.35, dark: 0.11 }, faint = { px: 1, depth: 0.25, dark: 0.06 }, gap = { px: 2, depth: 0.8, dark: 0.45 };
  const riv = { px: 1.1, depth: 0.14, dark: 0.035 };
  const tone = (hex, k) => { const n = parseInt(hex.slice(1), 16), f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
  const touchUp = (Q, a0, b0, a1, b1, base) => Q.fill((g) => g.rect(a0, b0, a1 - a0, b1 - b0), { color: tone(base, 0.93 + rnd() * 0.16), rough: 0.5 + rnd() * 0.15, metal: 0.03 }, { alpha: 0.35 + 0.3 * rnd() });

  // ================= centre fuselage (unwrap: z, t) =================
  const P = atlas.pen(cFus);
  const gF = 6.6;    // nominal girth: t units per metre ≈ 1 / gF
  P.fill('all', light);
  if (camo) {
    const toT = (poly, side) => densify(poly).map(([x, z]) => { const zz = Math.min(6.5, Math.max(-11.9, z)), t = tAtX(fus, zz, Math.min(x, fus.halfWidthAt(zz) - 0.002), 0.25, 0.5); return [zz, side > 0 ? t : 1 - t]; });
    for (const s of [1, -1]) {
      const sp = camo.spine.slice(); P.fill(toT(sp.concat([[0, sp[sp.length - 1][1]]]), s), dark, { feather: 3 });
      P.fill(toT(camo.intake, s), dark, { feather: 3 });
    }
  }
  for (let i = 0; i < 14; i++) { const z = -9 + rnd() * 14, t = 0.36 + rnd() * 0.28, w = 0.3 + rnd() * 0.6; touchUp(P, z, t, z + w, t + 0.03 + rnd() * 0.05, rnd() < 0.5 && camo ? SC.dark : SC.light); }
  // radome: dielectric, slightly glossier; joint ring
  P.fill((g) => g.rect(-11.95, 0, 2.85, 1), { color: SC.radome, rough: 0.45, metal: 0 });
  P.fill((g) => g.rect(-11.95, 0, 0.22, 1), { color: tone(SC.radome, 0.8), rough: 0.4, metal: 0 });     // erosion cap
  P.ring(-9.1, 0, 1, { px: 1.8, depth: 0.5, dark: 0.3 });
  P.ring(-11.73, 0, 1, faint);
  // structure: frames on the forward fuselage, longerons, access doors (avionics bays both sides under the cockpit)
  for (const z of [-8.35, -7.6, -6.95, -6.25, -5.6, -4.9]) { P.ring(z, 0.03, T_SILL - 0.01, line); P.ring(z, 1 - T_SILL + 0.01, 0.97, line); }
  for (const y of [0.42, -0.3]) P.yLine(-9.1, -4.9, y, line);
  P.line([[-9.1, 0], [6.5, 0]], line);
  for (const s of ['L', 'R']) {
    for (const [z0, z1, y0, y1] of [[-9.0, -8.42, -0.26, 0.38], [-8.36, -7.66, -0.26, 0.38], [-7.55, -7.0, -0.26, 0.38], [-6.88, -6.32, -0.26, 0.38], [-6.2, -5.65, -0.2, 0.36]]) {
      P.doorOn(z0, z1, y0, y1, { ...line, side: s, r: 0.03 });
      P.yLine(z0 + 0.03, z1 - 0.03, y0 + 0.03, { ...riv, side: s });
    }
    P.doorOn(-9.0, -7.66, -0.42, -0.31, { ...faint, side: s });
  }
  // upper deck / spine: frames, panels, fuel tank access, speedbrake surround (riveted)
  for (const z of [-4.3, -3.6, -2.95, -2.0, -1.2, -0.45, 0.35, 1.15, 1.95, 2.8, 3.6, 4.4, 5.2, 5.9]) { P.ring(z, 0.38, 0.62, z > -2.1 && z < -1.95 ? gap : line); P.ring(z, 0.04, 0.2, faint); P.ring(z, 0.8, 0.96, faint); }
  for (const tt of [0.4, 0.6]) P.line([[-2.0, tt], [5.9, tt]], line);
  P.line([[-4.5, 0.47], [-4.3, 0.47]], faint);
  for (const s of [1, -1]) {
    const t = (v) => (s > 0 ? v : 1 - v);
    P.line([[Z_SB[0], t(T_SB)], [Z_SB[1], t(T_SB)]], gap);
    P.rivets(Z_SB[0], t(T_SB - 0.012), Z_SB[1], t(T_SB - 0.012), 0.06, riv);
    for (const z of [-1.2, 0.35, 1.95, 3.6]) P.rivets(z + 0.04, t(0.405), z + 0.76, t(0.405), 0.06, riv);
  }
  P.line([[Z_SB[0], T_SB], [Z_SB[0], 1 - T_SB]], gap); P.line([[Z_SB[1], T_SB], [Z_SB[1], 1 - T_SB]], gap);
  P.line([[Z_SB[0] + 0.12, 0.5], [Z_SB[1] - 0.12, 0.5]], faint);
  for (const z of [-0.9, 1.6, 3.2]) P.decalT(z, 0.5, { layers: ['height', 'color'] }, (g, layer) => { g.strokeStyle = layer === 'height' ? 'rgba(0,0,0,0.45)' : 'rgba(10,12,14,0.18)'; g.lineWidth = 0.008; g.beginPath(); g.roundRect(-0.28, -0.18, 0.56, 0.36, 0.04); g.stroke(); });
  // belly: nose-gear door outlines, centre-line panels, drain marks
  P.line([[Z_NG[0], 0.07], [Z_NG[1], 0.07]], gap); P.line([[Z_NG[0], 0.93], [Z_NG[1], 0.93]], gap); P.line([[Z_NG[0], 0], [Z_NG[1], 0]], gap);
  P.ring(Z_NG[0], 0.93, 1, gap); P.ring(Z_NG[0], 0, 0.07, gap); P.ring(Z_NG[1], 0.93, 1, gap); P.ring(Z_NG[1], 0, 0.07, gap);
  for (const z of [-3.8, -2.5, -1.2, 0.2, 1.5, 2.8, 4.0]) P.ring(z, 0.94, 1.0, line), P.ring(z, 0, 0.06, line);
  // markings: canopy-area stencils, rescue arrow, pilot / crew chief names, formation strips
  for (const s of ['L', 'R']) {
    P.decalOn(-8.75, 0.62, s, (g) => { g.fillStyle = '#b52a25'; g.beginPath(); g.moveTo(0, -0.07); g.lineTo(0.075, 0.06); g.lineTo(-0.075, 0.06); g.closePath(); g.fill(); g.fillStyle = '#e9e5d8'; g.beginPath(); g.moveTo(0, -0.035); g.lineTo(0.04, 0.04); g.lineTo(-0.04, 0.04); g.closePath(); g.fill(); });
    P.textOn('RESCUE', -8.3, 0.62, s, 0.035, { color: '#b52a25' });
    P.decalOn(-7.95, 0.62, s, (g) => { g.strokeStyle = '#b52a25'; g.lineWidth = 0.012; g.beginPath(); g.moveTo(-0.14, 0); g.lineTo(0.1, 0); g.moveTo(0.05, -0.04); g.lineTo(0.11, 0); g.lineTo(0.05, 0.04); g.stroke(); });
    P.textOn('CANOPY JETTISON', -7.25, 0.62, s, 0.022, { color: mark, weight: 400 });
    for (let k = 0; k < 6; k++) P.textOn('=== ==== ==', -6.9 + k * 0.42, 0.1 - (k % 2) * 0.08, s, 0.018, { color: mark, weight: 400 });
    P.decalOn(-8.6, 0.38 - 0.24, s, { layers: ['color', 'orm'] }, (g, layer) => { g.fillStyle = layer === 'orm' ? 'rgb(255,90,0)' : slime.color; g.fillRect(-0.3, -0.028, 0.6, 0.056); });
  }
  const name = (s, txt) => P.textOn(txt, -6.85, 0.71, s, 0.042, { color: SC.camo === 'ghost' ? '#5c6267' : '#e1e2de', weight: 700 });
  name('L', SC.pilot); name('R', SC.chief);
  if (isE) P.textOn(SC.wso, -5.6, 0.73, 'L', 0.04, { color: '#e1e2de', weight: 700 });
  P.textOn('NO STEP', -3.1, 0.5 + 0.14, 'R', 0.035, { color: mark });
  // refuelling receptacle (UARRSI) door on the left upper deck at the wing root, with guide lines
  P.decalT(-2.45, 0.5 + 0.118, { layers: ['color', 'height'] }, (g, layer) => {
    if (layer === 'height') { g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.012; g.strokeRect(-0.16, -0.1, 0.32, 0.2); return; }
    g.fillStyle = 'rgba(20,22,24,0.55)'; g.fillRect(-0.16, -0.1, 0.32, 0.2);
    g.strokeStyle = '#e9e9e2'; g.lineWidth = 0.014; g.strokeRect(-0.22, -0.15, 0.44, 0.3);
    g.beginPath(); g.moveTo(-1.1, 0); g.lineTo(-0.3, 0); g.stroke();
  });
  // weathering: touched-up panels, hydraulic streaks on the belly / lower sides, grime, exhaust soot at the tail
  P.noise({ alpha: 0.05 * wx, scale: 2.6, stretch: [1.6, 1], rough: 0.05 });
  P.noise({ alpha: 0.035 * wx, scale: 0.8, mode: 'light' });
  for (let i = 0; i < 26; i++) { const z = -6 + rnd() * 11.5, t = (rnd() < 0.5 ? 0.03 : 0.91) + rnd() * 0.06; P.streak(z, t, z + 0.5 + rnd() * 1.4, t + (rnd() - 0.5) * 0.01, 0.006 + rnd() * 0.01, { alpha: (0.08 + rnd() * 0.12) * wx }); }
  for (let i = 0; i < 8; i++) { const z = -8.6 + rnd() * 3.5, t = rnd() < 0.5 ? 0.12 + rnd() * 0.06 : 0.82 + rnd() * 0.06; P.streak(z, t, z + 0.9, t, 0.008, { alpha: 0.12 * wx }); }
  P.fill((g) => g.rect(5.4, 0, 1.2, 1), { color: 'rgba(42,38,34,1)' }, { alpha: 0.2, feather: 6 });
  P.wear((g) => { g.moveTo(-6.0, 0.5); g.lineTo(-4.6, 0.5); }, 0.25, { color: tone(SC.light, 1.08), rough: 0.5, metal: 0 }, { alpha: 0.25 * wx });

  // ================= intake trunks / nacelles =================
  for (const key of ['R', 'L']) {
    const Q = atlas.pen(cNac[key]), body = nacPB[key], side = key, sgn = key === 'R' ? 1 : -1;
    const outer = (v) => (key === 'R' ? v : 1 - v);      // t on the outboard side
    Q.fill('all', light);
    if (camo) {
      const toT = (poly) => densify(poly).map(([x, z]) => { const zz = Math.min(6.3, Math.max(-5.72, z)); return [zz, tAtX(body, zz, sgn * x, 0.25, 0.75)]; });
      Q.fill(toT(camo.intake), dark, { feather: 3 });
      Q.fill(toT(camo.nacAft), dark, { feather: 3 });
      // the dark wraps down the outer face of the intake trunk behind the lip
      Q.band(-5.75, -3.9, (z) => 0.18 + (z + 5.75) * 0.12, Infinity, dark, { side: key === 'R' ? 'R' : 'L', feather: 3 });
    }
    for (let i = 0; i < 10; i++) { const z = -5 + rnd() * 8, t = outer(0.18 + rnd() * 0.25); touchUp(Q, z, t, z + 0.3 + rnd() * 0.6, t + 0.04, rnd() < 0.4 && camo ? SC.dark : SC.light); }
    // lip: worn bare edge; capsule joint (arc) behind it
    Q.fill((g) => g.rect(-5.9, 0, 0.12, 1), { color: tone(SC.light, 1.12), rough: 0.4, metal: 0.4 }, { alpha: 0.6 });
    Q.ring(ZCAP, 0, 1, { px: 1.6, depth: 0.6, dark: 0.3 });
    Q.ring(ZCAP + 0.22, 0, 1, faint);
    // bare titanium engine bays: heat-blued and straw-tinted, fastener rows
    const ti = { color: '#a19a90', rough: 0.36, metal: 1 };
    Q.fill((g) => { g.moveTo(4.45, 0); g.lineTo(4.45, 1); g.lineTo(6.4, 1); g.lineTo(6.4, 0); }, ti, { feather: 2 });
    Q.fill((g) => g.rect(3.3, 0, 1.2, 0.16), ti); Q.fill((g) => g.rect(3.3, 0.84, 1.2, 0.16), ti);
    for (let i = 0; i < 22; i++) { const z = 4.5 + rnd() * 1.8, t = rnd(); Q.fill((g) => { g.ellipse(z, t, 0.25 + rnd() * 0.4, 0.03 + rnd() * 0.05, 0, 0, Math.PI * 2); }, { color: ['#8a8590', '#9a8f78', '#848a98', '#9c9488', '#8c8274'][i % 5], rough: 0.4, metal: 1 }, { alpha: 0.3, feather: 5 }); }
    Q.fill((g) => g.rect(5.8, 0, 0.6, 1), { color: '#5d554e', rough: 0.5, metal: 0.85 }, { alpha: 0.4, feather: 10 });
    for (const z of [4.45, 5.1, 5.75, 6.25]) { Q.ring(z, 0, 1, line); Q.rivets(z + 0.03, 0.02, z + 0.03, 0.98, 0.012, { px: 1.1, depth: 0.2, dark: 0.08 }); }
    for (const t of [0.16, 0.36, 0.64, 0.84]) Q.line([[3.3, t], [6.3, t]], line);
    // painted section: frames, longerons, doors
    for (const z of [-5.25, -4.4, -3.5, -2.6, -1.7, -0.8, 0.0, 0.9, 1.8, 2.7, 3.5]) { Q.ring(z, 0, 1, line); Q.rivets(z + 0.025, outer(0.12), z + 0.025, outer(0.42), 0.012, riv); }
    for (const y of [0.42, -0.22]) Q.yLine(-5.4, 3.3, y, { ...line, side });
    Q.doorOn(-3.3, -1.95, -0.18, 0.38, { ...line, side, r: 0.04 });
    Q.doorOn(-1.6, -0.95, 0.02, 0.36, { ...faint, side });
    Q.doorOn(1.0, 2.5, -0.05, 0.36, { ...line, side, r: 0.04 });
    // main gear door outline
    Q.line([[-1.0, 0.9], [-1.0, 1.0]], gap); Q.line([[-1.0, 0], [-1.0, 0.1], [0.65, 0.1], [0.65, 0]], gap); Q.line([[-1.0, 0.9], [0.65, 0.9], [0.65, 1.0]], gap);
    // markings: national insignia on the trunk side behind the intake, intake warning, unit badge, NO STEP, stencils
    Q.decalOn(-3.2, IY - 0.05, side, (g) => K.drawStarBar(g, 0.64, { lowVis: mark }));
    Q.decalOn(-5.35, 0.47, side, (g) => { g.fillStyle = '#a22a24'; g.beginPath(); g.moveTo(-0.08, -0.07); g.lineTo(0.08, -0.07); g.lineTo(0, 0.07); g.closePath(); g.fill(); });
    Q.textOn('DANGER', -5.0, 0.47, side, 0.04, { color: '#a22a24', weight: 700 });
    Q.textOn('ENGINE INTAKE', -4.5, 0.47, side, 0.025, { color: '#a22a24', weight: 400 });
    if (!SC.guard) Q.decalOn(-4.55, 0.0, side, (g) => badge(g, 0.34, SC.band, SC.band2));
    Q.textOn('NO STEP', -2.6, 0.6, side, 0.035, { color: mark });
    for (let k = 0; k < 5; k++) Q.textOn('==== = ===', -1.7 + k * 0.7, -0.35 + (k % 2) * 0.1, side, 0.018, { color: mark, weight: 400 });
    Q.decalOn(-0.55, 0.15, side, { layers: ['color', 'height'] }, (g, layer) => { g.fillStyle = layer === 'height' ? 'rgba(0,0,0,0.5)' : 'rgba(22,24,26,0.7)'; g.beginPath(); g.arc(0, 0, 0.045, 0, Math.PI * 2); g.fill(); if (layer === 'color') { g.strokeStyle = '#b52a25'; g.lineWidth = 0.01; g.beginPath(); g.arc(0, 0, 0.07, 0, Math.PI * 2); g.stroke(); } });   // fuel filler
    // weathering
    Q.noise({ alpha: 0.05 * wx, scale: 1.8, stretch: [1.6, 1], rough: 0.05 });
    for (let i = 0; i < 14; i++) { const t = rnd(); Q.streak(3.8 + rnd() * 0.6, t, 6.35, t, 0.02 + rnd() * 0.04, { alpha: 0.22 * wx }); }
    for (let i = 0; i < 12; i++) { const z = -4.5 + rnd() * 8, t = outer(0.03 + rnd() * 0.14); Q.streak(z, t, z + 0.5 + rnd(), t - (key === 'R' ? 1 : -1) * 0.004, 0.007, { alpha: 0.13 * wx }); }
    for (let i = 0; i < 4; i++) { const z = -2.8 + rnd() * 2; Q.streak(z, outer(0.25), z + 0.4, outer(0.12), 0.01, { alpha: 0.15 * wx, color: '60,50,30' }); }   // gun gas / hydraulic weeps
  }

  // ================= CFTs (F-15E) =================
  if (isE) {
    const Q = atlas.pen(cCft);
    Q.fill('all', light);
    for (const z of [-2.9, -1.6, -0.2, 1.2, 2.5]) Q.ring(z, 0, 1, line);
    for (const tt of [0.12, 0.32, 0.68, 0.88]) Q.line([[-3.4, tt], [3.4, tt]], line);
    Q.noise({ alpha: 0.06, scale: 1.4, rough: 0.05 });
  }

  // ================= booms =================
  {
    const Q = atlas.pen(cBoom); Q.fill('all', light);
    if (camo) Q.fill((g) => g.rect(1.8, 0.35, 3.2, 0.3), dark, { feather: 4 });
    for (const z of [2.6, 3.6, 4.6, 5.6, 6.6]) Q.ring(z, 0, 1, line);
    Q.fill((g) => g.rect(6.85, 0, 0.7, 1), { color: '#77726b', rough: 0.4, metal: 1 });
    Q.noise({ alpha: 0.06 * wx, scale: 1.0, rough: 0.05 });
    Q.streak(5.5, 0.1, 7.4, 0.1, 0.15, { alpha: 0.2 * wx });
  }

  // ================= wings =================
  for (const key of ['R', 'L']) {
    const s = key === 'R' ? 1 : -1, wg = W.R;
    const at = (x, f) => { const p = wg.at(x, f); return [p[0], p[2]]; };
    const hz = (x) => wg.lines.hinge.at(wg.spanToU(x));
    for (const [chart, isTop] of [[cWT[key], true], [cWB[key], false]]) {
      const Q = atlas.pen(chart);
      Q.fill('all', light);
      const M = (p) => [p[0] * s, p[1]];
      if (isTop && camo) {
        const jit = key === 'L' ? 0.12 : 0;    // the pattern is not quite symmetrical
        Q.fill(camo.wing.map(([x, z]) => M([x, z + jit * Math.sin(x * 2)])), dark, { feather: 3 });
        Q.fill(camo.wingTip.map(([x, z]) => M([x - jit, z + jit])), dark, { feather: 3 });
      }
      for (let i = 0; i < 5; i++) { const x = 1.9 + rnd() * 3.5, f = 0.15 + rnd() * 0.5, a = at(x, f); touchUp(Q, a[0] * s - 0.2, a[1], a[0] * s + 0.2, a[1] + 0.3 + rnd() * 0.3, isTop && camo && rnd() < 0.5 ? SC.dark : SC.light); }
      const ln = (pts, op) => Q.line(pts.map(M), op);
      // spars, ribs, flap / aileron gaps, access panels, fasteners
      for (const f of [0.12, 0.42, 0.66]) ln([at(1.6, f), at(5.7, f)], line);
      for (const x of [2.2, 2.85, 3.5, 4.15, 4.8, 5.4]) ln([at(x, 0.12), at(x, Math.min(0.98, hz(x) - 0.005))], faint);
      ln([at(XCUT, 0.0), at(XCUT, 1.0)], line);
      for (const [a, b] of [[1.68, 3.3], [3.38, 5.7]]) ln([at(a, 1), at(a, hz(a)), at(b, hz(b)), at(b, 1)], gap);
      for (const f of [0.12, 0.42, 0.66]) { const a = at(1.7, f + 0.008), b = at(5.6, f + 0.008); Q.rivets(a[0] * s, a[1], b[0] * s, b[1], 0.045, riv); }
      for (const [x0, x1, f0, f1] of isTop ? [[2.3, 2.75, 0.2, 0.36], [3.6, 4.0, 0.2, 0.34], [4.9, 5.25, 0.24, 0.38]] : [[2.0, 2.6, 0.16, 0.38], [2.9, 3.4, 0.46, 0.6], [3.7, 4.2, 0.2, 0.36], [4.5, 5.0, 0.46, 0.6], [5.2, 5.5, 0.2, 0.34]]) {
        ln([at(x0, f0), at(x1, f0), at(x1, f1), at(x0, f1), at(x0, f0)], line);
      }
      const le = [at(1.66, 0.004), at(XCUT, 0.004)].map(M);
      Q.wear((g) => { g.moveTo(le[0][0], le[0][1]); g.lineTo(le[1][0], le[1][1]); }, 0.04, { color: '#7e8388', rough: 0.4, metal: 0.55 }, { alpha: 0.32 * wx });
      Q.noise({ alpha: 0.06 * wx, scale: 1.4, stretch: [1, 2.5], rough: 0.05 });
      for (let i = 0; i < 9; i++) { const x = 1.8 + rnd() * 3.8, a = at(x, hz(x)); Q.streak(a[0] * s, a[1], a[0] * s, a[1] + 0.3 + rnd() * 0.4, 0.03, { alpha: 0.12 * wx }); }
      if (isTop) {
        // walkway at the wing root (black outline + non-slip texture), NO STEP, insignia (top left), formation strip
        const w0 = at(1.72, 0.18), w1 = at(1.72, 0.58), w2 = at(2.25, 0.58), w3 = at(2.25, 0.18);
        Q.fill([w0, w1, w2, w3].map(M), { color: tone(SC.light, 0.9), rough: 0.85, metal: 0 }, { alpha: 0.5 });
        ln([w0, w1, w2, w3, w0], { px: 1.6, depth: 0.1, dark: 0.55 });
        const p = at(2.55, 0.3); Q.text('NO STEP', p[0] * s, p[1], 0.06, { color: mark, rot: s > 0 ? -90 : 90 });
        const p2 = at(4.2, 0.78); Q.text('NO STEP', p2[0] * s, p2[1], 0.05, { color: mark });
        if (key === 'L') { const c = at(4.2, 0.36); Q.decal(c[0] * s, c[1], (g) => K.drawStarBar(g, 0.76, { lowVis: mark })); }
        const fl = at(5.35, 0.3); Q.fill((g) => g.rect(fl[0] * s - 0.25, fl[1] - 0.028, 0.5, 0.056), slime);
      } else {
        if (key === 'R') { const c = at(4.2, 0.36); Q.decal(c[0] * s, c[1], (g) => K.drawStarBar(g, 0.76, { lowVis: mark })); }
        for (let i = 0; i < 6; i++) { const x = 2.2 + rnd() * 3, a = at(x, 0.3 + rnd() * 0.3); Q.streak(a[0] * s, a[1], a[0] * s, a[1] + 0.9, 0.015, { alpha: 0.18 * wx }); }
      }
    }
  }
  // ================= stabilators (mirrored chart: x ≥ 0) =================
  for (const [chart, isTop] of [[cST, true], [cSB, false]]) {
    const Q = atlas.pen(chart); Q.fill('all', light);
    if (isTop && camo) Q.fill(camo.stab, dark, { feather: 3 });
    for (const zz of [4.85, 5.6, 6.4]) Q.line([[2.0, zz], [4.2, zz + (7.2 - zz) * 0.35]], line);
    for (const x of [2.75, 3.3, 3.85]) Q.line([[x, 3.6], [x, 7.3]], faint);
    Q.wear((g) => { g.moveTo(2.78, 4.32); g.lineTo(4.28, 6.02); }, 0.03, { color: '#7e8388', rough: 0.4, metal: 0.55 }, { alpha: 0.3 * wx });
    Q.noise({ alpha: 0.06 * wx, scale: 1.0, stretch: [1, 2], rough: 0.05 });
    if (isTop) Q.fill((g) => g.rect(3.55, 6.5, 0.5, 0.05), slime);
    else for (let i = 0; i < 4; i++) { const x = 2.1 + rnd() * 1.8; Q.streak(x, 5.0, x, 7.2, 0.05, { alpha: 0.15 * wx }); }
  }
  // ================= fins (L chart = faces seen from the left: left fin outer + right fin inner) =================
  for (const key of ['L', 'R']) {
    const Q = atlas.pen(cFin[key]); Q.fill('all', light);
    const fin = fins.R;
    const at = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    const hz = (y) => fin.lines.hinge.at(fin.spanToU(y));
    const fw = key === 'L' ? 1 : -1;     // reading direction along z on this face
    for (let i = 0; i < 4; i++) { const y = 1 + rnd() * 2.4, f = 0.1 + rnd() * 0.4, a = at(y, f); touchUp(Q, a[0], a[1] - 0.15, a[0] + 0.5, a[1] + 0.12, SC.light); }
    if (SC.guard) {
      // ANG fin flash: dark band with gold edge across the upper fin, unit name and a stylised mountain
      Q.fill([at(2.35, 0), at(3.78, 0), at(3.78, 1), at(2.35, 1)], F.semigloss(SC.band));
      Q.fill([at(2.27, 0), at(2.35, 0), at(2.35, 1), at(2.27, 1)], F.semigloss(SC.band2));
      const m = at(3.0, 0.42); Q.decal(m[0], m[1], (g) => { if (key === 'R') g.scale(-1, 1); mountain(g, 0.9, SC.band2); });
      const tx = at(2.55, 0.5); Q.text(SC.bandText, tx[0], tx[1], 0.13, { color: SC.band2, weight: 700, spacing: 0.08 });
    } else {
      Q.fill([at(3.46, 0), at(3.74, 0), at(3.74, 1), at(3.46, 1)], F.semigloss(SC.band));
      Q.fill([at(3.42, 0), at(3.46, 0), at(3.46, 1), at(3.42, 1)], F.semigloss(SC.band2));
      if (SC.bandText) { const b = at(3.6, 0.45); Q.text(SC.bandText, b[0], b[1], 0.11, { color: SC.band2, weight: 700, spacing: 0.1 }); }
      if (SC.code) { const c = at(2.15, 0.37); Q.text(SC.code, c[0], c[1], 0.58, { color: mark, weight: 700 }); }
      const e = at(1.6, 0.18); Q.decal(e[0], e[1], (g) => shield(g, 0.22, mark));
    }
    Q.line([at(0.98, 1), at(0.98, hz(0.98)), at(2.5, hz(2.5)), at(2.5, 1)], gap);
    for (const y of [1.0, 1.6, 2.2, 2.8, 3.35]) Q.line([at(y, 0.04), at(y, Math.min(0.97, hz(y) - 0.01))], faint);
    for (const f of [0.18, 0.45]) { Q.line([at(0.7, f), at(3.7, f)], line); const a = at(0.75, f + 0.01), b = at(3.65, f + 0.01); Q.rivets(a[0], a[1], b[0], b[1], 0.05, riv); }
    Q.line([at(0.66, 0), at(0.66, 1)], line);
    const d = at(1.32, 0.42);
    Q.text(SC.serial[0], d[0] - fw * 0.34, d[1] + 0.03, 0.085, { color: mark, weight: 700 });
    Q.text(SC.serial[1], d[0] + fw * 0.28, d[1], 0.22, { color: mark, weight: 700 });
    const fl = at(2.75, 0.47); Q.fill((g) => g.rect(fl[0] - 0.3, fl[1] - 0.028, 0.6, 0.056), slime);
    Q.wear((g) => { const a = at(0.7, 0.004), b = at(3.75, 0.004); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }, 0.03, { color: '#7e8388', rough: 0.4, metal: 0.55 }, { alpha: 0.25 * wx });
    Q.noise({ alpha: 0.05 * wx, scale: 1.2, stretch: [1, 1.5], rough: 0.05 });
    Q.streak(at(0.7, 0.85)[0], 0.7, at(0.7, 0.85)[0] + 0.8, 0.62, 0.15, { alpha: 0.12 * wx });
  }
  // ================= nozzle petals (a = around, b = hinge → exit) =================
  {
    const Q = atlas.pen(cNoz), n = 18, w = 3.8 / n;
    Q.fill('all', { color: '#7b736b', rough: 0.45, metal: 0.85 });
    Q.fill((g) => g.rect(0, 0, 3.8, 0.3), { color: '#6b6670', rough: 0.4, metal: 0.9 }, { alpha: 0.6, feather: 8 });       // heat-blued roots
    Q.fill((g) => g.rect(0, 0.25, 3.8, 0.25), { color: '#8b7c62', rough: 0.45, metal: 0.85 }, { alpha: 0.35, feather: 8 });   // straw band
    for (let i = 0; i < n; i++) {
      if (i % 2) Q.fill((g) => g.rect(i * w, 0, w, 0.95), { color: '#6c655e', rough: 0.5, metal: 0.85 }, { alpha: 0.6 });
      Q.fill((g) => g.rect(i * w + w * 0.38, 0.04, w * 0.24, 0.86), { color: '#8a8178', rough: 0.4, metal: 0.85 }, { alpha: 0.6 });   // centre rib
      Q.line([[i * w, 0], [i * w, 0.95]], { px: 2, depth: 0.9, dark: 0.6 });
      Q.rivets(i * w + w * 0.2, 0.1, i * w + w * 0.2, 0.85, 0.08, { px: 1.2, depth: 0.2, dark: 0.15 });
      Q.rivets(i * w + w * 0.8, 0.1, i * w + w * 0.8, 0.85, 0.08, { px: 1.2, depth: 0.2, dark: 0.15 });
    }
    Q.fill((g) => g.rect(0, 0.62, 3.8, 0.33), { color: '#3e3632', rough: 0.6, metal: 0.7 }, { alpha: 0.55, feather: 8 });
    Q.noise({ alpha: 0.12, scale: 0.8, stretch: [1, 2] });
  }
}

/** Five-pointed star centred on the origin. */
function star(g, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.4 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath(); g.fill();
}
/** Invented squadron badge: disc in the unit colour, light ring, a stylised bird (kestrel) silhouette. */
function badge(g, d, col, col2) {
  const r = d / 2;
  g.fillStyle = col2; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(0, 0, r * 0.86, 0, Math.PI * 2); g.fill();
  g.fillStyle = col2; g.beginPath();
  g.moveTo(-r * 0.62, -r * 0.05); g.quadraticCurveTo(-r * 0.2, -r * 0.35, 0, -r * 0.08); g.quadraticCurveTo(r * 0.2, -r * 0.35, r * 0.62, -r * 0.05);
  g.quadraticCurveTo(r * 0.2, -r * 0.05, r * 0.08, r * 0.1); g.lineTo(0, r * 0.5); g.lineTo(-r * 0.08, r * 0.1); g.quadraticCurveTo(-r * 0.2, -r * 0.05, -r * 0.62, -r * 0.05); g.fill();
  g.fillStyle = col2; star(g, r * 0.1);
}
/** Command shield (low-vis) for the fin. */
function shield(g, s, col) {
  g.strokeStyle = col; g.lineWidth = s * 0.06; g.fillStyle = col;
  g.beginPath(); g.moveTo(-s / 2, -s / 2); g.lineTo(s / 2, -s / 2); g.lineTo(s / 2, 0); g.quadraticCurveTo(s / 2, s * 0.45, 0, s * 0.6); g.quadraticCurveTo(-s / 2, s * 0.45, -s / 2, 0); g.closePath(); g.stroke();
  g.save(); g.translate(0, -s * 0.05); star(g, s * 0.22); g.restore();
}
/** Stylised volcano / mountain peak for the invented ANG fin flash (faces +x). */
function mountain(g, s, col) {
  g.fillStyle = '#e9e8e2';
  g.beginPath(); g.moveTo(-0.5 * s, 0.25 * s); g.lineTo(-0.12 * s, -0.3 * s); g.lineTo(-0.02 * s, -0.22 * s); g.lineTo(0.08 * s, -0.34 * s); g.lineTo(0.5 * s, 0.25 * s); g.closePath(); g.fill();
  g.fillStyle = col;
  g.beginPath(); g.moveTo(-0.5 * s, 0.25 * s); g.lineTo(0.5 * s, 0.25 * s); g.lineTo(0.5 * s, 0.3 * s); g.lineTo(-0.5 * s, 0.3 * s); g.closePath(); g.fill();
  g.strokeStyle = col; g.lineWidth = 0.025 * s;
  g.beginPath(); g.moveTo(-0.3 * s, 0.05 * s); g.lineTo(-0.12 * s, -0.1 * s); g.lineTo(0.0, 0.0); g.lineTo(0.12 * s, -0.12 * s); g.lineTo(0.3 * s, 0.05 * s); g.stroke();
}
