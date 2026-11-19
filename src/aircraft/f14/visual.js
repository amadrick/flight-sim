// Grumman F-14D Tomcat — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (-1.7) when parked.
//
// Reference numbers (docs/aircraft/f14.md; body z = distance from the nose − 11.5):
//   length 19.1 m: radome tip z −11.5 → beaver tail z 7.6; height 4.88 m (fin tips y 3.18); fuselage width 3.4 m at the intakes
//   wing pivots x ±3.2, z −1.0, y 0.35. The published spans (19.55 m at 20°, 11.65 m at 68°) put the pivot on the 20° leading
//   edge line, so the movable panel is built at 20° (root chord 4.3 at the pivot, tip chord 1.5 at x 9.73) and rotated 48°.
//   glove: leading edge 66° from (0.6, −7.3) to the pivot; its outer edge (the overwing-fairing slot) at x ≈ 3.4 from z −1.3
//   to 3.45, then tapering in to the tail booms. intakes: lip z −3.9, centre x ±1.5, y −0.2, 1.05 × 1.3 m, raked 20° top-forward
//   and swept 15° in plan; ducts converge to the F110 nozzles at x ±1.05, y 0.1, exit z 7.5, r 0.55.
//   fins: x ±1.86 → 2.05 (4° cant), root chord 4.66, tip 1.7, LE 40°; stabilators: span 9.9, root 3.2, tip 1.15, LE 47°,
//   pivot z 5.3 on booms outboard of the nozzles; ventral fins under the booms (15° cant).
//   beaver tail: flat paddle between the nozzles, 0.86 m wide and 7 cm thick at its trailing edge (z 7.6), speedbrakes on
//   its upper and lower faces (the lower one split by the hook).
//   gear: nose twin 0.28 m at z −6.3 with launch bar, mains 0.4 m at x ±1.6, z 0.6 (wheelbase 6.9, track 3.2).
//   cockpit: pilot eye z −6.6 y 1.08, RIO 1.25 m aft and 0.15 m higher; three-piece windscreen (flat centre panel, posts
//   leaning in toward the bow), one-piece canopy hinged at the rear with a bow frame (three mirrors) and a frame between the
//   two cockpits (two RIO mirrors). Boarding ladder (left side, z −5.6) and kick-in steps; the ladder deploys with the canopy.
//   stores (fleet-defence fit): AIM-54 + AIM-9 on each glove pylon, two AIM-54 on the front tunnel pallets, two AIM-7
//   semi-recessed in the aft tunnel.
//
// Liveries (real air-wing practice, invented squadrons / serials / names / emblems):
//   lowvis — tactical paint scheme line jet, FS 36320 / 36375 countershading, heavily carrier-weathered, patchwork touch-ups
//   hivis  — 1970s gloss light gull grey over gloss white, white control surfaces, colourful fins and rudders
//   cag    — the air-wing commander's jet: TPS greys with full-colour insignia, black-and-gold fins, modex 100
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['lowvis', 'hivis', 'cag'];

const SCHEMES = {
  lowvis: {
    name: 'VF-169 "Sky Lancers" line jet, tactical paint scheme (low visibility, carrier-weathered)',
    top: '#6a7278', under: '#8e959a', radome: '#7f8483', finish: 'matte', fin: '#6a7278', accent: '#585e63', mark: '#454a4f',
    code: 'AX', modex: '112', buno: '164611', sqn: 'VF-169', style: 'tps', wx: 0.95, insignia: 'low', seed: 1407,
    pilot: 'LT J. "DOC" BRANNIGAN', rio: 'LT S. "MOOSE" ADEYEMI', stencil: '#3e4348', danger: '#4a4f54',
  },
  hivis: {
    name: 'VF-128 "Starhawks" 1976 (gloss light gull grey over white, high visibility)',
    top: '#aeb0aa', under: '#f0f0ec', radome: '#c9c9c0', finish: 'gloss', fin: '#f0f0ec', accent: '#c62a2a', blue: '#1d3f91', gold: '#f0c52a', mark: '#121314',
    code: 'NE', modex: '201', buno: '159447', sqn: 'VF-128', style: 'gloss', wx: 0.4, insignia: 'full', seed: 2277,
    pilot: 'LT M. "SHOOTER" KAPLAN', rio: 'LTJG D. "BEAKER" ROWE', stencil: '#1a1b1c', danger: '#b0262a',
  },
  cag: {
    name: 'VF-169 "Sky Lancers" CAG bird (TPS greys, full-colour markings)',
    top: '#737b81', under: '#9ca3a8', radome: '#8c908f', finish: 'semigloss', fin: '#141518', accent: '#e2ae22', mark: '#141518',
    code: 'AX', modex: '100', buno: '164599', sqn: 'VF-169', style: 'cag', wx: 0.55, insignia: 'full', seed: 3301,
    pilot: 'CDR R. "SPADE" MORROW', rio: 'LCDR T. "HAWG" OKAFOR', stencil: '#1d1f21', danger: '#b0262a',
  },
};

// wing pivot and sweep range
const PIV = [3.2, 0.35, -1.0], SWEEP0 = 20, SWEEP1 = 68;
const T_SILL = 0.385;

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'lowvis', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, paintF = F[SC.finish], lap = K.stopwatch();
  const seg = Math.max(32, Math.round(64 * detail / 4) * 4);

  // ---- atlas ------------------------------------------------------------------------------------------------------------
  // aluminium semi-monocoque fighter: frames ~0.38 m apart, full oil-canning; weathering per livery (gloss gets 60 % of it)
  const atlas = K.createAtlas({ size: atlasSize, base: paintF(SC.top), skin: { weathering: SC.wx, framePitch: 0.38 } });
  const C = {
    fus: atlas.chart('fus', { type: 'unwrap', z: [-11.5, 7.6], girth: 4.7, vScale: 0.95, strips: 2, density: 1.3 }),
    nacR: atlas.chart('nacR', { type: 'unwrap', z: [-4.0, 6.6], girth: 4.5, vScale: 0.9, density: 1.15 }),
    nacL: atlas.chart('nacL', { type: 'unwrap', z: [-4.0, 6.6], girth: 4.5, vScale: 0.9, density: 1.15 }),
    gloveT: atlas.chart('gloveTop', { type: 'plan', x: [0.4, 3.5], z: [-4.7, 5.7], view: 'top', mirror: true, density: 0.95 }),
    gloveB: atlas.chart('gloveBot', { type: 'plan', x: [0.4, 3.5], z: [-4.7, 5.7], view: 'bottom', mirror: true, density: 0.55 }),
    wTR: atlas.chart('wingTopR', { type: 'plan', x: [2.2, 9.86], z: [-1.42, 3.42], view: 'top' }),
    wTL: atlas.chart('wingTopL', { type: 'plan', x: [-9.86, -2.2], z: [-1.42, 3.42], view: 'top' }),
    wBR: atlas.chart('wingBotR', { type: 'plan', x: [2.2, 9.86], z: [-1.42, 3.42], view: 'bottom', density: 0.65 }),
    wBL: atlas.chart('wingBotL', { type: 'plan', x: [-9.86, -2.2], z: [-1.42, 3.42], view: 'bottom', density: 0.65 }),
    sTR: atlas.chart('stabTopR', { type: 'plan', x: [2.05, 5.0], z: [3.5, 7.8], view: 'top', density: 0.75 }),
    sTL: atlas.chart('stabTopL', { type: 'plan', x: [-5.0, -2.05], z: [3.5, 7.8], view: 'top', density: 0.75 }),
    sB: atlas.chart('stabBot', { type: 'plan', x: [2.05, 5.0], z: [3.5, 7.8], view: 'bottom', mirror: true, density: 0.55 }),
    fRO: atlas.chart('finRO', { type: 'side', z: [0.85, 7.3], y: [0.4, 3.22], view: 'right', density: 0.9 }),
    fRI: atlas.chart('finRI', { type: 'side', z: [0.85, 7.3], y: [0.4, 3.22], view: 'left', density: 0.6 }),
    fLO: atlas.chart('finLO', { type: 'side', z: [0.85, 7.3], y: [0.4, 3.22], view: 'left', density: 0.9 }),
    fLI: atlas.chart('finLI', { type: 'side', z: [0.85, 7.3], y: [0.4, 3.22], view: 'right', density: 0.6 }),
    noz: atlas.chart('nozzle', { type: 'rect', w: 3.6, h: 0.95, density: 0.7, ao: false }),
  };
  atlas.pack();
  const sw = (k, f) => atlas.swatch(k, f);
  const U = {
    top: sw('top', paintF(SC.top)), under: sw('under', paintF(SC.under)),
    duct: sw('duct', F.semigloss('#cfd0cc')), dark: sw('dark', F.darkGrey), black: sw('black', F.black), exhaust: sw('exhaust', F.exhaust),
    heat: sw('heat', { color: '#9b9289', rough: 0.5, metal: 0.55 }), heat2: sw('heat2', { color: '#4a433e', rough: 0.55, metal: 0.85 }),
    liner: sw('liner', { color: '#5b544d', rough: 0.5, metal: 0.9 }),
    well: sw('well', F.gearWhite), interior: sw('interior', { color: '#3f4447', rough: 0.72, metal: 0 }), console: sw('console', { color: '#1d1f21', rough: 0.6, metal: 0 }),
    consoleTop: sw('consoleTop', { color: '#2b2e30', rough: 0.55, metal: 0 }), knob: sw('knob', { color: '#0d0e0f', rough: 0.4, metal: 0 }),
    seat: sw('seat', { color: '#272a2c', rough: 0.7, metal: 0 }), cushion: sw('cushion', F.fabric), accent: sw('accent', { color: '#d6b21e', rough: 0.5, metal: 0 }),
    suit: sw('suit', { color: '#5a6047', rough: 0.9, metal: 0 }), helmet: sw('helmet', { color: SC.style === 'gloss' ? '#e9e9e4' : '#8d9296', rough: 0.35, metal: 0 }),
    helmetR: sw('helmetR', { color: SC.style === 'gloss' ? '#c9a52a' : '#7d8286', rough: 0.35, metal: 0 }),
    visor: sw('visor', { color: '#0a0b0d', rough: 0.05, metal: 0.4 }), glove: sw('glove', { color: '#3a3d33', rough: 0.9, metal: 0 }),
    frame: sw('frame', paintF(SC.top)), frameIn: sw('frameIn', { color: '#1c1e20', rough: 0.65, metal: 0 }), sill: sw('sill', { color: '#2b2e31', rough: 0.6, metal: 0.1 }),
    mirror: sw('mirror', { color: '#d8dce0', rough: 0.04, metal: 1 }), seal: sw('seal', { color: '#2c2e2f', rough: 0.82, metal: 0 }),
    steel: sw('steel', F.steel), lens: sw('lens', F.lens), probe: sw('probe', F.bareMetal),
    aim9: sw('aim9', F.semigloss('#c8cbcc')), aim7: sw('aim7', F.semigloss('#e2e3e0')), seeker: sw('seeker', { color: '#1c1e20', rough: 0.15, metal: 0.3 }),
    a54: sw('a54', F.semigloss('#d9dad4')), a54nose: sw('a54nose', { color: '#d8d2bf', rough: 0.45, metal: 0 }), band: sw('band', F.semigloss('#c9a227')), bandB: sw('bandB', F.semigloss('#6b4a2a')),
    pylon: sw('pylon', paintF(SC.under)), irst: sw('irst', { color: '#20262c', rough: 0.08, metal: 0.5 }), hook: sw('hook', { color: '#202224', rough: 0.45, metal: 0.4 }),
    hookShoe: sw('hookShoe', F.steel), radome: sw('radome', F.semigloss(SC.radome)), fan: sw('fan', { color: '#3c3f41', rough: 0.45, metal: 0.85 }),
    ladder: sw('ladder', { color: '#c9cbc6', rough: 0.45, metal: 0.2 }), tread: sw('tread', { color: '#1b1c1d', rough: 0.95, metal: 0 }),
  };

  const rig = K.createRig(ctx, { geometry: G, name: 'f14', glassLayer: opts.glassLayer });
  rig.material('paint', null);                        // placeholder; the atlas material is attached after painting
  const stat = new K.Mesh();

  // ---- centre fuselage: radome, cockpit, spine, the "pancake" centre body between the nacelles, beaver tail ------------------
  //        z       top     bot     w      kTop  kBot
  const FS = [
    [-11.5, 0.150, 0.150, 0.000, 0.55, 0.55],
    [-11.43, 0.192, 0.113, 0.042, 0.55, 0.55],
    [-11.22, 0.285, 0.035, 0.125, 0.55, 0.55],
    [-10.8, 0.400, -0.075, 0.240, 0.55, 0.56],
    [-10.3, 0.505, -0.165, 0.350, 0.55, 0.58],
    [-9.6, 0.625, -0.265, 0.470, 0.56, 0.6],
    [-8.9, 0.712, -0.340, 0.580, 0.57, 0.63],
    [-8.2, 0.780, -0.405, 0.670, 0.58, 0.66],
    [-7.65, 0.835, -0.445, 0.730, 0.6, 0.68],
    [-7.0, 0.910, -0.485, 0.775, 0.6, 0.7],
    [-6.0, 0.950, -0.530, 0.805, 0.6, 0.72],
    [-5.0, 0.990, -0.570, 0.825, 0.6, 0.72],
    [-4.0, 1.090, -0.600, 0.835, 0.62, 0.72],
    [-3.3, 1.030, -0.615, 0.835, 0.62, 0.72],
    [-2.5, 0.935, -0.620, 0.825, 0.64, 0.72],
    [-1.5, 0.845, -0.600, 0.805, 0.66, 0.72],
    [-0.5, 0.785, -0.550, 0.770, 0.68, 0.72],
    [0.8, 0.735, -0.470, 0.710, 0.7, 0.74],
    [2.2, 0.695, -0.400, 0.650, 0.72, 0.76],
    [3.6, 0.655, -0.350, 0.590, 0.74, 0.78],
    [4.8, 0.605, -0.310, 0.545, 0.76, 0.8],
    [5.8, 0.535, -0.255, 0.505, 0.8, 0.84],
    [6.5, 0.430, -0.150, 0.475, 0.86, 0.88],          // beaver tail: the body flattens into a paddle between the nozzles
    [7.1, 0.285, 0.010, 0.455, 0.93, 0.93],
    [7.6, 0.178, 0.108, 0.430, 0.97, 0.97],
  ].map(r => { const yc = (r[1] + r[2]) / 2, h = (r[1] - r[2]) / 2; return { z: r[0], y: yc, w: r[3], top: h, bot: h, kTop: r[4], kBot: r[5] }; });
  const fus = K.loft({
    stations: FS, segments: seg, step: 0.12 / detail, chart: C.fus, capEnd: 'flat', capUV: U.top,
    cutouts: [
      { name: 'cockpit', z: [-7.65, -3.95], t: [T_SILL, 1 - T_SILL] },
      { name: 'ngw', z: [-7.8, -6.05], t: [0, 0.07], mirror: true },
      { name: 'sbU', z: [5.0, 6.3], t: [0.43, 0.57] },
      { name: 'sbD', z: [5.0, 6.3], t: [0.03, 0.125], mirror: true },
    ],
  });
  C.fus.body = fus;
  stat.add(fus.mesh);

  // ---- canopy (fixed three-piece windscreen + one-piece tandem canopy hinged at the rear) -----------------------------------
  const canTop = K.pchip([-7.65, -7.3, -6.95, -6.6, -6.2, -5.8, -5.3, -4.8, -4.4, -4.15, -3.95], [0.845, 1.08, 1.3, 1.445, 1.505, 1.53, 1.545, 1.505, 1.405, 1.28, 1.135]);
  const canZ = [-7.65, -7.5, -7.3, -7.1, -6.95, -6.75, -6.5, -6.2, -5.9, -5.6, -5.3, -5.0, -4.7, -4.4, -4.2, -4.05, -3.95];
  const canSt = canZ.map(z => { const s = fus.at(z, T_SILL).p; return { z, y: s[1], w: s[0], top: Math.max(0.002, canTop(z) - s[1]), bot: 0.01, kTop: [0.72, 0.62] }; });
  const cseg = Math.max(16, Math.round(32 * detail / 4) * 4), ct = 1 / cseg;
  const canLoft = (zr, tr, inflate, uv, sg = cseg) => K.loft({ stations: canSt, segments: sg, step: 0.1, tRange: tr, zRange: zr, inflate, uv }).mesh;
  const canFull = K.loft({ stations: canSt, segments: cseg, step: 0.1, tRange: [0.25, 0.75], uv: [0, 0] });
  const tCanX = (z, x) => { let lo = 0.25, hi = 0.5; for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (canFull.at(z, m).p[0] > x) lo = m; else hi = m; } return (lo + hi) / 2; };
  const onCan = (z, t, d) => { const q = canFull.at(z, t); return [q.p[0] + q.n[0] * d, q.p[1] + q.n[1] * d, q.p[2] + q.n[2] * d]; };
  const glassFixed = canLoft([-7.65, -6.95], [0.25, 0.75], 0, [0, 0]);
  const glassMove = canLoft([-6.95, -3.95], [0.25, 0.75], 0, [0, 0]);
  // windscreen: base strip, arch, side sills and the two posts of the three-piece screen. The posts bound a flat centre panel
  // that is 0.56 m wide at the base and 0.46 m at the arch, so seen from the seat they lean in toward the bow ("A", not "V").
  const wsFrame = K.merge(canLoft([-7.0, -6.93], [0.25, 0.75], 0.007, U.frame), canLoft([-7.65, -6.95], [0.25, 0.25 + ct], 0.004, U.frame), canLoft([-7.65, -6.95], [0.75 - ct, 0.75], 0.004, U.frame),
    canLoft([-7.65, -7.6], [0.25, 0.75], 0.004, U.frame));
  for (const sx of [1, -1]) {
    // each post is a 5 cm wide frame strip lying on the glass: outer face (paint), a side wall, inner face added below (dark)
    const N = 8, m = new K.Mesh(), ids = [];
    for (let k = 0; k <= N; k++) {
      const z = -7.62 + 0.64 * k / N, x = 0.28 - 0.05 * k / N, t0 = tCanX(z, x + 0.02), t1 = tCanX(z, x - 0.02), row = [];
      for (const [t, d] of [[t0, 0.0], [t0, 0.012], [t1, 0.012], [t1, 0.0]]) { const tt = sx > 0 ? t : 1 - t, q = canFull.at(z, tt), p = onCan(z, tt, d); row.push(m.vert(p[0], p[1], p[2], q.n[0], q.n[1], q.n[2], U.frame[0], U.frame[1])); }
      ids.push(row);
    }
    for (let k = 0; k < N; k++) for (let j = 0; j < 3; j++) { const a = ids[k][j], b = ids[k][j + 1], c = ids[k + 1][j + 1], d = ids[k + 1][j]; if (sx > 0) m.quad(a, d, c, b); else m.quad(a, b, c, d); }
    m.smooth(50);
    wsFrame.add(m);
  }
  const wsIn = wsFrame.clone().flip().setUV(U.frameIn);
  stat.add(wsFrame).add(wsIn);
  const frameMove = K.merge(
    canLoft([-6.95, -3.95], [0.25, 0.25 + ct], 0.005, U.frame), canLoft([-6.95, -3.95], [0.75 - ct, 0.75], 0.005, U.frame),
    canLoft([-6.93, -6.84], [0.25, 0.75], 0.008, U.frame), canLoft([-5.95, -5.85], [0.25, 0.75], 0.007, U.frame), canLoft([-4.14, -3.95], [0.25, 0.75], 0.008, U.frame, cseg),
  );
  frameMove.add(frameMove.clone().flip().setUV(U.frameIn));     // the frames seen from inside the cockpit (dark interior paint)
  {  // canopy-bow mirrors (three for the pilot) and two on the inter-cockpit frame for the RIO, on short stalks
    for (const [z, ts] of [[-6.83, [0.37, 0.5, 0.63]], [-5.84, [0.39, 0.61]]]) for (const t of ts) {
      const p = onCan(z, t, -0.045), q = canFull.at(z, t), m = K.box(0.11, 0.045, 0.012, U.mirror);
      m.add(K.box(0.115, 0.05, 0.008, U.frameIn).translate(0, 0, -0.008));
      const roll = Math.atan2(q.n[0], q.n[1]);
      m.rotateX(-0.35).rotateZ(-roll).translate(p[0], p[1], p[2] + 0.02);
      frameMove.add(m).add(K.tube(onCan(z, t, -0.005), p, 0.006, 0.006, { segments: 5, uv: U.frameIn }));
    }
  }
  {  // canopy sill rails on the moving canopy (seen from outside and from both seats)
    for (const sx of [1, -1]) { const pts = []; for (let z = -6.9; z <= -4.0; z += 0.29) pts.push(onCan(z, sx > 0 ? 0.25 + ct * 0.5 : 0.75 - ct * 0.5, -0.008)); frameMove.add(K.pipe(pts, 0.018, { uv: U.frameIn, segments: 6 })); }
  }

  // ---- cockpit: tandem tubs, pilot + RIO, seats, panels, HUD, glareshield -----------------------------------------------------
  const eye = G.pilotEye, eyeR = [0, eye[1] + 0.15, eye[2] + 1.25];
  const tubX = 0.52;
  stat.add(K.tub({ x: tubX, y0: 0.12, y1: 0.8, z0: -7.55, z1: -4.0, uv: U.interior, taper: 0.85 }).occlude(0.45));
  {  // sill ledge closing the gap between the skin cut-out and the tub
    const zs = []; for (let z = -7.65; z <= -3.951; z += 0.15) zs.push(z); zs.push(-3.95);
    const ledge = new K.Mesh();
    for (const sx of [1, -1]) {
      let prev = null;
      for (const z of zs) {
        const o = fus.at(z, sx > 0 ? T_SILL : 1 - T_SILL).p, a = ledge.vert(o[0], o[1], z, -sx * 0.5, 0.86, 0, U.sill[0], U.sill[1]), b = ledge.vert(sx * tubX * 0.92, Math.min(0.8, o[1] - 0.05), z, -sx * 0.5, 0.86, 0, U.sill[0], U.sill[1]);
        if (prev) { if (sx > 0) ledge.quad(prev[0], a, b, prev[1]); else ledge.quad(prev[0], prev[1], b, a); }
        prev = [a, b];
      }
      const pts = []; for (let z = -7.5; z <= -4.05; z += 0.3) { const o = fus.at(z, sx > 0 ? T_SILL : 1 - T_SILL).p; pts.push([o[0] - sx * 0.015, o[1] + 0.01, z]); }
      ledge.add(K.pipe(pts, 0.02, { uv: U.sill, segments: 6 }));       // fixed sill rail the canopy closes onto
    }
    stat.add(ledge.occlude(0.2));
  }
  // instrument panels (kit): pilot (F-14D: two MFDs, up-front display) under a glareshield whose top stays at ≈ 0.82, and the RIO's
  // panel on the back of the pilot's bulkhead (tactical displays, its own coaming)
  stat.add(K.instrumentPanel({ eye, kind: 'fighter', dist: 0.5, drop: 0.54, height: 0.4, width: 0.82, uv: U.console, uvPad: U.black }));
  stat.add(K.instrumentPanel({ eye: eyeR, kind: 'fighter', dist: 0.48, drop: 0.48, height: 0.42, width: 0.8, mfd: 0.16, pages: ['mfdSA', 'mfdRadar'], uv: U.console, uvPad: U.black }));
  {
    const ck = new K.Mesh();
    ck.add(K.box(0.9, 0.04, 0.1, U.console).translate(0, 0.36, -7.02));                    // pilot panel lower lip
    for (const [z0, z1, y, x] of [[-7.0, -5.95, 0.52, 0.41], [-5.75, -4.15, 0.62, 0.42]]) for (const sx of [-1, 1]) {
      const L = z1 - z0, zc = (z0 + z1) / 2;
      ck.add(K.box(0.14, 0.12, L, U.console).translate(sx * x, y, zc));                    // side consoles
      ck.add(K.box(0.13, 0.006, L - 0.04, U.consoleTop).translate(sx * x, y + 0.063, zc));
      for (let k = 0; k < 7; k++) ck.add(K.box(0.018, 0.016, 0.018, U.knob).translate(sx * x + (k % 2 ? 0.03 : -0.03), y + 0.072, z0 + 0.1 + k * (L - 0.2) / 6));
    }
    ck.add(K.box(0.2, 0.3, 0.3, U.console).translate(0, 0.32, -6.95));                     // pilot's centre pedestal
    ck.add(K.stick({ base: [0, 0.32, -6.82], height: 0.32, uv: U.black, uvGrip: U.dark }));
    for (const dx of [-0.02, 0.02]) {                                                    // twin throttles in the left console quadrant
      ck.add(K.tube([-0.4 + dx, 0.58, -6.55], [-0.4 + dx, 0.67, -6.62], 0.009, 0.009, { segments: 5, uv: U.dark }));
      ck.add(K.box(0.035, 0.05, 0.07, U.seat).translate(-0.4 + dx * 1.5, 0.685, -6.63));
    }
    ck.add(K.box(0.07, 0.06, 0.1, U.dark).translate(0.42, 0.715, -5.1));                   // RIO hand controller (right console)
    ck.add(K.box(0.84, 0.36, 0.04, U.interior).translate(0, 0.32, -7.5));                 // forward bulkhead / rudder-pedal well
    for (const sx of [-1, 1]) ck.add(K.box(0.1, 0.03, 0.2, U.dark).translate(sx * 0.15, 0.28, -7.3));      // rudder pedals
    stat.add(ck.occlude(0.25));
  }
  for (const e of [eye, eyeR]) stat.add(K.ejectionSeat({ eye: e, recline: 16, width: 0.5, uv: { frame: U.seat, cushion: U.cushion, accent: U.accent } }));
  const hudParts = K.hud({ eye, dist: 0.5, width: 0.16, height: 0.14, drop: 0.035, uv: U.black });
  stat.add(hudParts.frame);
  const crewMesh = K.pilot({ eye, recline: 14, stick: [0.03, -0.55, -0.33], throttle: [-0.37, -0.42, -0.3], uv: { suit: U.suit, helmet: U.helmet, visor: U.visor, dark: U.dark, glove: U.glove } });
  crewMesh.add(K.pilot({ eye: eyeR, recline: 14, stick: [0.17, -0.56, -0.36], throttle: [-0.17, -0.56, -0.36], uv: { suit: U.suit, helmet: U.helmetR, visor: U.visor, dark: U.dark, glove: U.glove } }));

  // ---- nacelles: raked 2-D box intake (fold-over lip) → duct → round F110 nacelle, main-gear well cut from the skin -------------
  const nac = {};
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const NS = (z, x, y, w, h, k, extra) => ({ z, x: sx * x, y, w, top: h, bot: h, kTop: k, kBot: k, ...extra });
    const chart = C['nac' + key];
    const n = K.loft({
      stations: [
        NS(-2.35, 1.47, -0.22, 0.44, 0.555, 0.82),
        NS(-3.82, 1.5, -0.2, 0.505, 0.625, 0.95, { hard: true }),
        NS(-3.885, 1.5, -0.2, 0.512, 0.632, 0.95),
        NS(-3.9, 1.5, -0.2, 0.525, 0.645, 0.95),
        NS(-3.885, 1.5, -0.2, 0.538, 0.658, 0.95),
        NS(-3.7, 1.5, -0.2, 0.55, 0.67, 0.94),
        NS(-2.6, 1.47, -0.19, 0.57, 0.685, 0.9),
        NS(-1.2, 1.40, -0.16, 0.59, 0.67, 0.83),
        NS(0.3, 1.32, -0.11, 0.607, 0.648, 0.76),
        NS(1.8, 1.24, -0.06, 0.62, 0.635, 0.67),
        NS(3.3, 1.165, 0.0, 0.628, 0.628, 0.59),
        NS(4.6, 1.105, 0.05, 0.624, 0.624, 0.5523),
        NS(5.7, 1.068, 0.085, 0.612, 0.612, 0.5523),
        NS(6.55, 1.05, 0.1, 0.6, 0.6, 0.5523),
      ],
      segments: Math.max(28, Math.round(48 * detail / 4) * 4), step: 0.14 / detail, capStart: 'flat', capUV: U.black,
      uvFn: (x, y, z, t, ring) => (ring.run === 0 ? U.duct : chart.uvUnwrap(z, t)),
      cutouts: [{ name: 'mlg', z: [-0.5, 1.1], t: sx > 0 ? [0.07, 0.2] : [0.8, 0.93] }],
    });
    // variable ramp: the upper duct wall slopes down from the lip to the throat (hides most of the compressor face)
    n.mesh.add(K.prism([[-3.78, 0.43], [-2.48, -0.1], [-2.42, -0.08], [-2.42, 0.44]], sx > 0 ? 1.5 - 0.46 : -1.5 - 0.46, sx > 0 ? 1.5 + 0.46 : -1.5 + 0.46, U.duct));
    // rake the lip (top forward), sweep it in plan (outer wall aft) and lean the box slightly outward; fades out by z −2.6
    const p = n.mesh.p;
    for (let i = 0; i < p.length; i += 3) {
      const z = p[i + 2]; if (z > -2.6) continue;
      const f = K.smooth01((-2.6 - z) / 1.3), dy = p[i + 1] + 0.2, dx = sx * p[i] - 1.5;
      p[i + 2] = z - 0.36 * dy * f + 0.27 * dx * f;
      p[i] += sx * 0.07 * dy * f;
    }
    // duct darkens with depth (only the inside of the box: the outer cowl is wider than the duct everywhere)
    n.mesh.occlude((x, y, z) => (Math.abs(sx * x - 1.48) < 0.5 && Math.abs(y + 0.2) < 0.61 && z > -3.6 && z < -2.0 ? Math.min(0.85, Math.max(0, (z + 3.55) * 0.62)) : 0));
    stat.add(n.mesh);
    stat.add(K.well(n.patches.mlg, 0.42, U.well));
    nac[key] = n;
    // compressor face backdrop and the (static) F110 fan behind the ramp
    stat.add(K.lathe([[0.47, -2.36], [0.47, -2.2], [0, -2.2]], { segments: 20, uv: U.black }).translate(sx * 1.47, -0.22, 0).occlude(0.9));
    stat.add(K.fan({ radius: 0.43, hub: 0.12, blades: 22, uvBlade: U.fan, uvSpinner: U.dark }).translate(sx * 1.47, -0.22, -2.4));
    // boundary-layer splitter plate standing off the fuselage side, on two struts
    stat.add(K.prism([[-3.82, 0.36], [-2.2, 0.36], [-1.2, 0.2], [-1.2, -0.5], [-2.2, -0.75], [-3.65, -0.83]], sx * 0.955 - 0.012, sx * 0.955 + 0.012, U.top));
    for (const [z, y] of [[-2.9, 0.1], [-2.3, -0.4]]) stat.add(K.box(0.12, 0.04, 0.3, U.top).translate(sx * 0.89, y, z));
    // F110 jet pipe (darkening toward the turbine), turbine face and flame holder inside the nozzle
    const nc = [sx * 1.05, 0.1, 0];
    stat.add(K.lathe([[0.585, 6.62], [0.53, 5.8], [0.5, 5.3], [0, 5.3]], { segments: 24, uv: U.liner }).translate(nc[0], nc[1], 0).occlude((x, y, z) => Math.min(0.8, Math.max(0.1, (6.6 - z) * 0.6))));
    for (let i = 0; i < 12; i++) stat.add(K.box(0.025, 0.48, 0.05, U.heat2).translate(0, 0.24, 0).rotateZ(i * Math.PI / 6).translate(nc[0], nc[1], 5.5));
    stat.add(K.lathe([[0.2, 5.42], [0.2, 5.5], [0.17, 5.5], [0.17, 5.42]], { segments: 20, uv: U.heat2 }).translate(nc[0], nc[1], 0));
  }

  // ---- glove + overwing fairing: a thick fixed "wing" blended into the body, the movable panel slides into its outer edge ------
  const gloveAF = (tc, chord, a, b, lift = 0) => ({
    tc, camber: (f) => (lift / chord) * Math.pow(Math.max(0, 1 - f / 0.55), 2),
    thick: (f) => { const u = Math.min(1, f / a); return 0.5 * tc * Math.sqrt(Math.max(0, u * (2 - u))) * Math.pow(Math.min(1, (1 - f) / b), 0.85) + 0.0008; },
  });
  // glove leading edge: from the intake's outer top corner (just behind the raked lip) out to the pivot at ~66°
  const gLE = (x) => (x <= 1.75 ? -4.62 + (x - 0.45) * (0.42 / 1.3) : x <= 2.0 ? -4.2 + (x - 1.75) * 0.4 : -4.1 + (x - 2.0) * (2.75 / 1.25));
  const gStations = [[0.45, 5.6, 0.42, 0.7, 0.22, 0.45, 0.06], [1.75, 5.6, 0.4, 0.6, 0.18, 0.36, 0.06], [2.35, 4.75, 0.38, 0.5, 0.12, 0.24, 0.04], [3.25, 3.45, 0.36, 0.41, 0.06, 0.1, 0]]
    .map(([x, te, y, th, a, b, lift]) => { const z = gLE(x), chord = te - z; return { x, y, z, chord, tc: th / chord, airfoil: gloveAF(th / chord, chord, a, b, lift) }; });
  const glove = {};
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    glove[key] = K.wing({ side: sx, chordPts: Math.round(16 * detail), spanAxis: 'x', tip: 'round', stations: gStations, charts: { upper: C.gloveT, lower: C.gloveB } });
    stat.add(glove[key].mesh);
  }
  // wing-glove seals: the flexible overwing-fairing "bag" seal on top and the lower seal plate along the slot the wing slides
  // into (dark rubberised strips standing a few millimetres off the glove skin)
  for (const sx of [1, -1]) for (const [s, d] of [['upper', 0.012], ['lower', -0.012]]) {
    const pts = []; for (let k = 0; k <= 10; k++) { const p = glove.R.at(3.15, 0.2 + 0.72 * k / 10, s); pts.push([sx * (p[0] + 0.03), p[1] + d, p[2]]); }
    stat.add(K.pipe(pts, s === 'upper' ? 0.028 : 0.02, { uv: U.seal, segments: 7 }));
  }

  // ---- tail booms (stabilator pivots, fins above, ventral fins below) -----------------------------------------------------------
  for (const sx of [1, -1]) {
    stat.add(K.loft({
      stations: [
        { z: 3.1, x: sx * 1.97, y: 0.3, w: 0.04, top: 0.04, bot: 0.04 },
        { z: 3.8, x: sx * 1.97, y: 0.28, w: 0.16, top: 0.25, bot: 0.23, kTop: 0.6, kBot: 0.6 },
        { z: 4.9, x: sx * 1.96, y: 0.275, w: 0.21, top: 0.32, bot: 0.31, kTop: 0.64, kBot: 0.64 },
        { z: 6.4, x: sx * 1.95, y: 0.27, w: 0.2, top: 0.31, bot: 0.3, kTop: 0.64, kBot: 0.64 },
        { z: 7.15, x: sx * 1.95, y: 0.27, w: 0.15, top: 0.22, bot: 0.2 },
        { z: 7.5, x: sx * 1.95, y: 0.27, w: 0.05, top: 0.07, bot: 0.06 },
      ], segments: 20, step: 0.25, uv: U.top,
    }).mesh);
    stat.add(K.wing({ side: sx, airfoil: K.biconvex(0.05), chordPts: 6, spanAxis: 'u', tip: 'flat', uv: U.under, edgeUV: U.under,
      stations: [{ x: 1.96, y: 0.02, z: 4.05, chord: 1.75, tc: 0.05 }, { x: 1.96 + 0.52 * Math.sin(15 * DEG), y: 0.02 - 0.52 * Math.cos(15 * DEG), z: 4.55, chord: 0.95, tc: 0.04 }] }).mesh);
  }
  // hook fairing under the beaver tail (houses the arrestor hook) and the fuel-dump mast at the paddle's trailing edge
  stat.add(K.loft({ stations: [{ z: 5.5, y: -0.12, w: 0.02, top: 0.02, bot: 0.02 }, { z: 6.0, y: -0.13, w: 0.09, top: 0.08, bot: 0.1 }, { z: 7.0, y: -0.04, w: 0.1, top: 0.08, bot: 0.1 }, { z: 7.55, y: 0.06, w: 0.06, top: 0.04, bot: 0.05 }], segments: 12, step: 0.3, uv: U.under, capEnd: 'flat', capUV: U.dark }).mesh);
  stat.add(K.lathe([[0.035, 7.5], [0.035, 7.62], [0.025, 7.66, 1], [0, 7.66]], { segments: 10, uv: U.dark }).translate(0, 0.143, 0));

  // ---- movable wing panels (built at 20° sweep, rotated about the pivots) ------------------------------------------------------
  const wLE = (x) => PIV[2] + (x - PIV[0]) * Math.tan(SWEEP0 * DEG), wTE = (x) => 3.3 + (x - 3.2) * (-0.4 / 6.53);
  const mkWing = (side) => K.wing({
    side, airfoil: K.naca6(0.08, 0.006), chordPts: Math.round(14 * detail), spanAxis: 'x', tip: 'round',
    stations: [2.25, 3.2, 9.73].map((x, i) => ({ x, y: PIV[1], z: wLE(x), chord: wTE(x) - wLE(x), tc: [0.08, 0.078, 0.064][i], twist: [0, 0, -2][i] })),
    lines: { slatLine: [[3.4, 0.15], [9.73, 0.15]], spLine: [[3.4, 0.5], [9.73, 0.5]], flapLine: [[3.4, 0.7], [9.73, 0.7]] },
    controls: [
      { name: 'slat', type: 'flap', span: [3.5, 9.5], to: 'slatLine', tail: 1, cove: true },
      { name: 'spoiler', type: 'panel', span: [3.55, 7.1], from: 'spLine', to: 'flapLine', surface: 'upper', hinge: 'front' },
      { name: 'flap', type: 'flap', span: [3.45, 8.75], from: 'flapLine', nose: 1 },
    ],
    charts: { upper: side > 0 ? C.wTR : C.wTL, lower: side > 0 ? C.wBR : C.wBL },
  });
  const W = { R: mkWing(1), L: mkWing(-1) };
  // static dischargers on the wingtip trailing edge (move with the panel)
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const pts = [9.0, 9.45].map(x => { const p = W.R.at(x, 0.99, 'mid'); return [sx * p[0], p[1], p[2]]; });
    W[key].mesh.add(K.staticWicks(pts, 0.12, U.dark));
  }

  // ---- vertical tails (4° outward cant) with dorsal extensions, rudders ----------------------------------------------------------
  const finRoot = { x: 1.86, y: 0.42, z: 2.56, chord: 4.66 }, finTip = { y: 3.18, chord: 1.7 };
  finTip.x = finRoot.x + (finTip.y - finRoot.y) * Math.tan(4 * DEG); finTip.z = finRoot.z + (finTip.y - finRoot.y) * Math.tan(40 * DEG);
  const finSpan = Math.hypot(finTip.x - finRoot.x, finTip.y - finRoot.y);
  const fins = {};
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const charts = sx > 0 ? { upper: C.fRI, lower: C.fRO } : { upper: C.fLI, lower: C.fLO };
    fins[key] = K.wing({
      side: sx, airfoil: K.naca4('0005'), chordPts: Math.round(11 * detail), spanAxis: 'u', tip: 'round', tipLength: 0.6,
      stations: [{ ...finRoot, tc: 0.055 }, { ...finTip, tc: 0.035 }],
      lines: { hinge: [[0.3, 0.7], [finSpan - 0.25, 0.63]] },
      controls: [{ name: 'rudder', type: 'flap', span: [0.42, finSpan - 0.25], from: 'hinge', nose: 1 }],
      charts,
    });
    stat.add(fins[key].mesh);
    stat.add(K.wing({ side: sx, airfoil: K.naca4('0006'), chordPts: 6, spanAxis: 'u', tip: 'flat', charts,
      stations: [{ x: 1.85, y: 0.42, z: 0.95, chord: 2.0, tc: 0.06 }, { x: 1.895, y: 1.0, z: 2.98, chord: 0.45, tc: 0.05 }] }).mesh);
    // fin-cap antenna fairing (dielectric) and the rudder-top dischargers
    const cap = fins[key].at(finSpan - 0.05, 0.62, 'mid');
    stat.add(K.lathe([[0, -0.32], [0.03, -0.28], [0.035, -0.15], [0.035, 0.12], [0.02, 0.2], [0, 0.22]], { segments: 8, uv: U.dark }).translate(cap[0], cap[1] + 0.005, cap[2] + 0.42));
  }

  // ---- stabilators ---------------------------------------------------------------------------------------------------------------
  const STAB_Y = 0.05, STAB_PZ = 5.3;
  const mkStab = (side) => K.wing({
    side, airfoil: K.biconvex(0.045), chordPts: Math.round(10 * detail), spanAxis: 'x', tip: 'flat', root: 'flat',
    stations: [{ x: 2.1, y: STAB_Y, z: 3.55, chord: 3.2, tc: 0.045 }, { x: 4.95, y: STAB_Y, z: 3.55 + 2.85 * Math.tan(47 * DEG), chord: 1.15, tc: 0.03 }],
    charts: { upper: side > 0 ? C.sTR : C.sTL, lower: C.sB },
  });
  const stab = { R: mkStab(1), L: mkStab(-1) };

  // ---- nozzles, afterburner glow -----------------------------------------------------------------------------------------------
  const nozMesh = G.engines.map(e => K.petalNozzle({ z0: 6.55, z1: 7.5, r0: 0.605, rClosed: 0.42, rOpen: 0.555, petals: 18, centre: [e.nozzle[0], e.nozzle[1], 0], uvOuter: U.heat, uvInner: U.heat2, thickness: 0.03, chart: C.noz }));
  const glowMesh = new K.Mesh();
  for (const e of G.engines) glowMesh.add(K.afterburnerGlow({ zDeep: 5.56, zExit: 7.35, rDeep: 0.48, rExit: 0.42, centre: [e.nozzle[0], e.nozzle[1], 0] }));

  // ---- chin pod, probes, antennas ----------------------------------------------------------------------------------------------
  {  // F-14D twin chin pod (TCS + IRST side by side)
    const yb = fus.botAt(-8.6);
    stat.add(K.loft({ stations: [{ z: -9.15, y: yb + 0.02, w: 0.03, top: 0.02, bot: 0.02 }, { z: -8.95, y: yb - 0.04, w: 0.19, top: 0.07, bot: 0.09, kBot: 0.7 }, { z: -8.3, y: yb - 0.04, w: 0.21, top: 0.08, bot: 0.1, kBot: 0.7 }, { z: -7.95, y: yb + 0.02, w: 0.04, top: 0.03, bot: 0.03 }], segments: 16, step: 0.12, uv: U.under }).mesh);
    for (const sx of [-1, 1]) {
      stat.add(K.lathe([[0, -9.22], [0.06, -9.215], [0.072, -9.2, 1], [0.08, -9.12, 1], [0.08, -8.9]], { segments: 14, uv: U.irst }).translate(sx * 0.095, yb - 0.075, 0));
      stat.add(K.lathe([[0.082, -9.18], [0.085, -8.6], [0.05, -8.4], [0, -8.4]], { segments: 14, uv: U.under }).translate(sx * 0.095, yb - 0.075, 0));
    }
  }
  for (const sx of [-1, 1]) {
    const p = fus.at(-8.75, sx > 0 ? 0.3 : 0.7).p;
    stat.add(K.probe(p, [p[0] + sx * 0.06, p[1] + 0.02, p[2] - 0.3], 0.013, U.probe));           // pitot-static probes
  }
  { const p = fus.at(-7.9, 0.72).p; stat.add(K.probe(p, [p[0] - 0.08, p[1] - 0.02, p[2] - 0.12], 0.01, U.probe)); }   // AoA probe
  stat.add(K.bladeAntenna({ pos: [0, fus.topAt(-2.6) - 0.01, -2.6], height: 0.2, chord: 0.24, sweep: 0.14, uv: U.top }));
  stat.add(K.bladeAntenna({ pos: [0, fus.topAt(1.6) - 0.01, 1.6], height: 0.12, chord: 0.18, sweep: 0.08, uv: U.top }));
  stat.add(K.bladeAntenna({ pos: [0, fus.botAt(-4.8) + 0.01, -4.8], height: 0.18, chord: 0.22, sweep: 0.12, down: true, uv: U.under }));
  stat.add(K.bladeAntenna({ pos: [0.22, fus.botAt(-2.9) + 0.01, -2.9], height: 0.12, chord: 0.15, sweep: 0.06, down: true, uv: U.under }));
  // refuelling-probe door (right, ahead of the windscreen) and the canopy external release / step handholds: raised plates
  for (const [z, t, w, l] of [[-7.85, 0.31, 0.1, 0.9], [-5.55, 0.79, 0.05, 0.1], [-5.55, 0.71, 0.05, 0.1]]) {
    const q = fus.at(z, t), m = K.box(w, 0.006, l, U.top), roll = Math.atan2(q.n[0], q.n[1]);
    stat.add(m.rotateZ(-roll).translate(q.p[0] + q.n[0] * 0.002, q.p[1] + q.n[1] * 0.002, z));
  }

  // ---- stores: fleet-defence fit -------------------------------------------------------------------------------------------------
  const aim54 = () => {     // AIM-54C: 3.96 m, 0.38 m body, off-white radome, long-chord cruciform wings, tail controls, X roll
    const L = 3.96, r = 0.19, sg = Math.max(14, Math.round(20 * detail / 2) * 2);
    const m = K.lathe([[0, 0], [0.05, 0.05], [0.11, 0.18], [0.155, 0.38], [0.182, 0.58], [r, 0.72, 1]], { segments: sg, uv: U.a54nose });
    m.add(K.lathe([[r, 0.72], [r, L - 0.14], [0.165, L - 0.02, 1], [0.11, L], [0, L]], { segments: sg, uv: U.a54 }));
    for (const [z, uv] of [[0.8, U.band], [0.9, U.band], [1.5, U.bandB]]) m.add(K.lathe([[r + 0.002, z], [r + 0.002, z + 0.04]], { segments: sg, uv }));
    for (let i = 0; i < 4; i++) {
      m.add(K.prism([[1.95, r * 0.95], [2.85, r + 0.25], [3.15, r + 0.25], [3.2, r * 0.95]], -0.007, 0.007, U.a54).rotateZ((45 + 90 * i) * DEG));
      m.add(K.prism([[3.5, r * 0.95], [3.78, r + 0.24], [3.93, r + 0.24], [3.93, r * 0.95]], -0.006, 0.006, U.a54).rotateZ((45 + 90 * i) * DEG));
    }
    return m;
  };
  const aim7 = () => K.missile({ length: 3.66, radius: 0.1, uvBody: U.aim7, uvNose: U.aim7, uvFin: U.aim7, wings: { z: 1.35, chord: 0.62, span: 0.32 }, canards: null });
  for (const sx of [-1, 1]) {
    // glove pylon: AIM-9 on the shoulder rail, AIM-54 underneath on the LAU-93 launcher
    stat.add(K.prism([[-2.5, 0.22], [-0.3, 0.22], [-0.55, -0.12], [-2.2, -0.12]], sx * 2.7 - 0.06, sx * 2.7 + 0.06, U.pylon));
    stat.add(K.prism([[-2.6, -0.1], [-0.6, -0.1], [-0.75, -0.17], [-2.45, -0.17]], sx * 2.7 - 0.045, sx * 2.7 + 0.045, U.pylon));
    stat.add(K.launchRail({ x: sx * 2.84, y: 0.03, z0: -2.15, z1: -0.6, w: 0.07, h: 0.08, uv: U.pylon }));
    stat.add(K.box(0.1, 0.05, 1.0, U.pylon).translate(sx * 2.78, 0.06, -1.4));
    stat.add(K.missile({ uvBody: U.aim9, uvNose: U.seeker, uvFin: U.aim9 }).translate(sx * 2.97, 0.0, -2.55));
    stat.add(aim54().translate(sx * 2.7, -0.37, -3.25));
  }
  // tunnel: two AIM-54 on the front pallets, two AIM-7 semi-recessed aft
  for (const sx of [-1, 1]) {
    const x = sx * 0.42, yb = Math.min(fus.botAt(-1.6), fus.botAt(0.4));
    stat.add(K.prism([[-2.75, yb + 0.03], [0.55, yb + 0.03], [0.4, yb - 0.15], [-2.45, yb - 0.15]], x - 0.12, x + 0.12, U.pylon));
    stat.add(aim54().translate(x, yb - 0.15 - 0.2, -3.1));
    const y7 = fus.botAt(3.2) - 0.06;
    stat.add(aim7().translate(x, y7, 1.25));
  }

  // ---- wells / bays -----------------------------------------------------------------------------------------------------------
  const P = fus.patches, E = fus.edges;
  stat.add(K.well(K.merge(P.ngwR, P.ngwL), 0.62, U.well, [0, 1, 0]));
  for (const k of ['sbU', 'sbDR', 'sbDL']) stat.add(K.well(P[k], 0.12, U.well));

  // ---- boarding ladder (left side): telescoping ladder with a top platform step; deploys when the canopy opens on the ground --
  const LAD = { x: -fus.halfWidthAt(-5.6) - 0.02, y0: -0.25, y1: -1.58, z: -5.6 };
  const ladderMesh = new K.Mesh();
  {
    const dx = -0.16, top = [LAD.x, LAD.y0, LAD.z], bot = [LAD.x + dx, LAD.y1, LAD.z];
    for (const dz of [-0.17, 0.17]) ladderMesh.add(K.tube([top[0], top[1], top[2] + dz], [bot[0], bot[1], bot[2] + dz], 0.018, 0.018, { segments: 6, uv: U.ladder }));
    for (let k = 1; k <= 5; k++) { const f = k / 5.6, x = top[0] + dx * f, y = top[1] + (bot[1] - top[1]) * f; ladderMesh.add(K.box(0.09, 0.022, 0.34, U.tread).translate(x - 0.02, y, LAD.z)); }
    ladderMesh.add(K.box(0.2, 0.025, 0.36, U.tread).translate(LAD.x - 0.1, LAD.y0 + 0.04, LAD.z));          // top platform step
    ladderMesh.add(K.box(0.04, 0.12, 0.38, U.ladder).translate(bot[0], bot[1] + 0.05, LAD.z));               // foot bar
  }

  // ---- paint + materials ----------------------------------------------------------------------------------------------------------
  lap('geometry');
  paint(atlas, { SC, C, fus, W, fins, glove, paintF, finSpan });
  lap('paint');
  const mat = atlas.material(ctx, { envMapIntensity: 1 });
  lap('textures');
  rig.material('paint', mat, { shared: true });
  rig.disposables.push(atlas);
  rig.glass('canopy', K.glassMaterial(ctx, { ...K.GLASS.clear, dust: SC.wx > 0.7 ? 0.05 : 0.035 }));
  rig.glass('hud', K.glassMaterial(ctx, K.GLASS.hud));
  const glow = rig.material('glow', K.glowMaterial(), { shadow: false });
  rig.addStatic(stat, 'paint');
  rig.addStatic(glassFixed, 'canopy');
  rig.addStatic(hudParts.glass, 'hud');

  // ---- moving parts -----------------------------------------------------------------------------------------------------------
  const canopyNode = rig.node('canopy', { pivot: [0, 1.06, -3.98] });
  rig.part('canopyGlass', glassMove, { parent: canopyNode, key: 'canopy' });
  rig.part('canopyFrame', frameMove, { parent: canopyNode, ao: false });
  const setCanopy = rig.hinge(canopyNode, [-1, 1.06, -3.98], [1, 1.06, -3.98], { ref: [0, 1.3, -6.9], toward: [0, 1, 0] });
  const crewNode = rig.part('crew', crewMesh, { pivot: eye, ao: false });
  const ladderNode = rig.part('ladder', ladderMesh, { pivot: [LAD.x, LAD.y0, LAD.z], ao: false });

  const drop = (ctrl, d, aft = 0) => { const u = ctrl.up, h = ctrl.hinge, o = [-u[0] * d, -u[1] * d, -u[2] * d + aft]; return { a: [h.a[0] + o[0], h.a[1] + o[1], h.a[2] + o[2]], b: [h.b[0] + o[0], h.b[1] + o[1], h.b[2] + o[2]] }; };
  const hingeOn = (name, mesh, line, ref, toward, parent) => { const node = rig.part(name, mesh, { pivot: line.a, parent, ao: false }); return rig.hinge(node, line.a, line.b, { ref, toward }); };
  const DOWN = [0, -1, 0], UP = [0, 1, 0];
  const wingA = {};
  const tipP = W.R.at(9.73, 0.62, 'mid');
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const piv = [sx * PIV[0], PIV[1], PIV[2]];
    const node = rig.node('wing' + key, { pivot: piv });
    const sweep = rig.hinge(node, piv, [piv[0], piv[1] + 1, piv[2]], { ref: [sx * 9.7, PIV[1], 1.4], toward: [0, 0, 1] });
    rig.part('wingPanel' + key, W[key].mesh, { parent: node, ao: false });
    const c = W[key].controls;
    wingA[key] = {
      sweep,
      slat: hingeOn('slat' + key, c.slat.mesh, drop(c.slat, 0.3, 0.06), c.slat.ref, DOWN, node),
      flap: hingeOn('flap' + key, c.flap.mesh, drop(c.flap, 0.22, 0.04), c.flap.ref, DOWN, node),
      spoiler: hingeOn('spoiler' + key, c.spoiler.mesh, c.spoiler.hinge, c.spoiler.ref, UP, node),
      node,
    };
    rig.lamp('nav', [sx * (tipP[0] + 0.04), tipP[1], tipP[2]], { color: sx > 0 ? [0.02, 1, 0.25] : [1, 0.04, 0.02], size: 0.035, squash: [0.8, 0.7, 1.6], parent: node });
  }
  const rud = { R: rig.hingePart('rudderR', fins.R.controls.rudder, { toward: [1, 0, 0] }), L: rig.hingePart('rudderL', fins.L.controls.rudder, { toward: [1, 0, 0] }) };
  const mkStabPart = (key, sx) => {
    const a = [sx * 2.1, STAB_Y, STAB_PZ], b = [sx * 4.95, STAB_Y, STAB_PZ];
    const node = rig.part('stab' + key, stab[key].mesh, { pivot: a, ao: false });
    return rig.hinge(node, a, b, { ref: [sx * 3.0, STAB_Y, 6.6], toward: UP });
  };
  const setStab = { R: mkStabPart('R', 1), L: mkStabPart('L', -1) };
  // speedbrakes: one dorsal panel; the two ventral panels either side of the hook move together (one part, one hinge line)
  const sbUe = E.sbU.zLo, sbUnode = rig.part('speedbrakeU', K.thicken(P.sbU, 0.02, U.well), { pivot: sbUe[0], ao: false });
  const setSbU = rig.hinge(sbUnode, sbUe[0], sbUe[1], { ref: K.centroid(P.sbU), toward: UP });
  const yD = (E.sbDR.zLo[0][1] + E.sbDR.zLo[1][1]) / 2, zD = E.sbDR.zLo[0][2];
  const sbDmesh = K.merge(K.thicken(P.sbDR, 0.02, U.well), K.thicken(P.sbDL, 0.02, U.well));
  const sbDnode = rig.part('speedbrakeD', sbDmesh, { pivot: [0, yD, zD], ao: false });
  const setSbD = rig.hinge(sbDnode, [-1, yD, zD], [1, yD, zD], { ref: K.centroid(sbDmesh), toward: DOWN });
  const nozzles = nozMesh.map((m, i) => rig.part('nozzle' + i, m, { pivot: [G.engines[i].nozzle[0], G.engines[i].nozzle[1], 6.55], ao: false }));
  rig.part('abGlow', glowMesh, { key: 'glow', ao: false });
  const HOOK = [0, -0.2, 4.95];
  const hookNode = rig.part('hook', K.arrestorHook({ pivot: HOOK, length: 2.45, radius: 0.04, uv: U.hook, uvShoe: U.hookShoe }), { pivot: HOOK, ao: false });
  const setHook = rig.hinge(hookNode, [-1, HOOK[1], HOOK[2]], [1, HOOK[1], HOOK[2]], { ref: [0, HOOK[1], 7], toward: DOWN });

  // ---- landing gear ------------------------------------------------------------------------------------------------------------
  const gp = G.gear;
  const doorOf = (patch, edge, inner = U.well) => ({ mesh: K.thicken(patch, 0.02, inner), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  const launchBar = K.merge(
    K.tube([0, -1.2, -6.36], [0, -0.86, -6.72], 0.035, 0.03, { segments: 8, uv: U.well }),
    K.box(0.12, 0.05, 0.08, U.well).translate(0, -0.86, -6.73),
    K.box(0.16, 0.04, 0.05, U.steel).translate(0, -0.85, -6.78),                                  // launch-bar shuttle fitting
    K.tube([0, -1.08, -6.2], [0, -1.22, -5.96], 0.025, 0.025, { segments: 6, uv: U.well }),     // holdback fitting
    K.box(0.06, 0.24, 0.06, U.well).translate(0, -0.98, -6.4),                                   // launch-bar actuator
  );
  K.buildGear(rig, atlas, {
    name: 'nose', index: 0, contact: gp[0].pos, wheels: [-0.19, 0.19], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.17, pivot: [0, -0.12, -6.14],
    stroke: 0.35, staticFrac: 0.32, strutR: 0.07, fork: 'axle', steer: true, links: 'rear', retract: { to: [0, -0.06, -7.45] }, window: [0.2, 0.88],
    brace: [0, -0.18, -6.95], extra: launchBar,
    doors: [{ name: 'noseDoorR', ...doorOf(P.ngwR, E.ngwR.tHi), open: 88 }, { name: 'noseDoorL', ...doorOf(P.ngwL, E.ngwL.tLo), open: 88 }],
    lamps: [{ kind: 'landing', pos: G.lights.landing, size: 0.05, color: [1, 0.96, 0.88] }, { kind: 'taxi', pos: [-0.09, -0.88, -6.38], size: 0.04, color: [1, 0.96, 0.88] }],
  });
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, off = 0.2, n = nac[key], edge = sx > 0 ? n.edges.mlg.tHi : n.edges.mlg.tLo;
    K.buildGear(rig, atlas, {
      name: 'main' + key, index: i, contact: [c[0] + sx * off, c[1], c[2]], wheels: [-sx * off], wheelRadius: gp[i].wheelRadius, wheelWidth: 0.28,
      pivot: [sx * 1.8, -0.4, 0.88], stroke: 0.45, staticFrac: 0.32, strutR: 0.075, fork: 'half', links: 'front',
      retract: { to: [sx * 1.48, -0.5, -0.1], twist: -sx * 90 }, window: [0.22, 0.9], brace: [sx * 1.86, -0.45, 0.05],
      doors: [{ name: 'mainDoor' + key, ...doorOf(n.patches.mlg, edge), open: 100 }],
    });
  }

  // ---- lamps ------------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.02 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.04 });
  rig.lamp('strobe', [-L.strobe[0], L.strobe[1], L.strobe[2]], { color: [1, 1, 1], size: 0.04 });
  rig.lamp('beacon', L.beacon, { color: [1, 0.05, 0.03], size: 0.06, squash: [1, 0.55, 1] });
  rig.lamp('beacon', [0, fus.botAt(-3.6) - 0.02, -3.6], { color: [1, 0.05, 0.03], size: 0.06, squash: [1, 0.55, 1] });
  const gloveNav = (sx) => [sx * 2.02, glove.R.at(2.0, 0.08, 'mid')[1], gLE(2.0) + 0.25];
  for (const sx of [-1, 1]) {
    rig.lamp('nav', gloveNav(sx), { color: sx > 0 ? [0.02, 1, 0.25] : [1, 0.04, 0.02], size: 0.03 });   // glove position lights
    const fp = fus.at(-8.4, sx > 0 ? 0.27 : 0.73).p;
    rig.lamp('formation', [fp[0] + sx * 0.005, fp[1], fp[2]], { color: [0.75, 1, 0.55], size: 0.025, squash: [0.3, 0.5, 2.4] });
    rig.lamp('formation', [sx * (finRoot.x + 0.15), 1.42, 3.75], { color: [0.75, 1, 0.55], size: 0.025, squash: [0.3, 0.5, 2.4] });
  }

  // ---- night halos: the lenses are a few pixels wide at chase distance, so each external light also gets a soft additive
  //      glow sprite (one Points draw call), driven by the same switches / flash timing as the lamps; the wingtip halos follow
  //      the sweep ------------------------------------------------------------------------------------------------------------------
  const HALO = [
    { p: [-tipP[0] - 0.1, tipP[1], tipP[2]], c: [1, 0.05, 0.03], k: 'nav', s: 1.5, tip: -1 }, { p: [tipP[0] + 0.1, tipP[1], tipP[2]], c: [0.05, 1, 0.3], k: 'nav', s: 1.5, tip: 1 },
    { p: gloveNav(-1), c: [1, 0.05, 0.03], k: 'nav', s: 1.1 }, { p: gloveNav(1), c: [0.05, 1, 0.3], k: 'nav', s: 1.1 },
    { p: [L.tail[0], L.tail[1], L.tail[2] + 0.08], c: [1, 1, 1], k: 'nav', s: 1.1 },
    { p: [L.strobe[0], L.strobe[1] + 0.06, L.strobe[2]], c: [1, 1, 1], k: 'strobe', s: 2.4 }, { p: [-L.strobe[0], L.strobe[1] + 0.06, L.strobe[2]], c: [1, 1, 1], k: 'strobe', s: 2.4 },
    { p: [L.beacon[0], L.beacon[1] + 0.06, L.beacon[2]], c: [1, 0.1, 0.05], k: 'beacon', s: 2.0 }, { p: [0, fus.botAt(-3.6) - 0.08, -3.6], c: [1, 0.1, 0.05], k: 'beacon', s: 2.0 },
    { p: [L.landing[0], L.landing[1] - 0.04, L.landing[2] - 0.06], c: [1, 0.95, 0.85], k: 'landing', s: 2.2 }, { p: [-0.09, -0.92, -6.44], c: [1, 0.95, 0.85], k: 'taxi', s: 1.6 },
  ];
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(HALO.flatMap(h => h.p), 3));
  haloGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(HALO.length * 3).fill(0), 3));
  haloGeo.setAttribute('size', new THREE.Float32BufferAttribute(HALO.map(h => h.s), 1));
  const haloMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, fog: false,
    vertexShader: 'attribute float size; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * 0.5 * projectionMatrix[1][1] * 360.0 / max(0.5, -mv.z), 2.0, 96.0); }',
    fragmentShader: 'varying vec3 vC; void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard; float a = exp(-r2 * 5.0) + 0.25 * exp(-r2 * 1.4) * (1.0 - r2); gl_FragColor = vec4(vC * a, 1.0); }',
  });
  const halo = new THREE.Points(haloGeo, haloMat); halo.name = 'halos'; halo.frustumCulled = false; halo.renderOrder = 6;
  const haloCol = haloGeo.attributes.color, haloPos = haloGeo.attributes.position;

  // ---- animation --------------------------------------------------------------------------------------------------------------
  rig.onUpdate((S) => {
    const sf = S.sf, sweepDeg = (SWEEP1 - SWEEP0) * Math.min(1, Math.max(0, sf.wingSweep));
    const spOK = 1 - K.seq(sf.wingSweep, 0.74, 0.8);        // spoilers lock out beyond ~57° sweep
    for (const [key, ail] of [['R', sf.aileronR], ['L', sf.aileronL]]) {
      const a = wingA[key];
      a.sweep(sweepDeg * DEG);
      a.slat(Math.max(sf.slats, sf.flaps) * 17 * DEG);
      a.flap(sf.flaps * 35 * DEG);
      const roll = key === 'R' ? sf.spoilerR : sf.spoilerL;
      const sp = Math.max(roll, Math.max(0, ail) * 0.9, S.onGround ? sf.speedbrake : 0) * spOK;
      a.spoiler(sp * 55 * DEG);
    }
    setStab.R(sf.elevatorR * 24 * DEG); setStab.L(sf.elevatorL * 24 * DEG);
    rud.R.set(sf.rudder * 30 * DEG); rud.L.set(sf.rudder * 30 * DEG);
    setSbU(sf.speedbrake * 60 * DEG); setSbD(sf.speedbrake * 55 * DEG);
    for (let i = 0; i < 2; i++) nozzles[i].morphTargetInfluences[0] = (S.eng[i] || {}).nozzle ?? 0;
    const e0 = S.eng[0] || {}, e1 = S.eng[1] || e0;
    K.abGlowColor(glow.color, (e1.afterburner || 0) > (e0.afterburner || 0) ? e1 : e0, S.night);
    setCanopy(sf.canopy * 30 * DEG);
    setHook(sf.hook * 38 * DEG);
    crewNode.visible = !rig.cameraInCockpit;
    // ladder: extends (slides down out of its well) over the first 40 % of the canopy travel, only on the ground
    const lad = S.onGround ? K.smooth01(sf.canopy / 0.4) : 0;
    ladderNode.visible = lad > 0.01; ladderNode.scale.y = Math.max(0.01, lad);       // telescopes down from its top fitting
    // halos (night only; landing / taxi only with the gear down and locked); wingtip halos follow the sweep
    const lt = S.lights || {}, nf = Math.max(0, Math.min(1, (S.night ?? 0) * 1.4 - 0.2));
    const sa = sweepDeg * DEG, cs = Math.cos(sa), sn = Math.sin(sa);
    HALO.forEach((h, i) => {
      if (h.tip) { const dx = Math.abs(h.p[0]) - PIV[0], dz = h.p[2] - PIV[2]; haloPos.setXYZ(i, h.tip * (PIV[0] + dx * cs - dz * sn), h.p[1], PIV[2] + dx * sn + dz * cs); }
      let on = 0;
      if (h.k === 'nav') on = lt.nav ? 1 : 0;
      else if (h.k === 'strobe') on = lt.strobe ? K.lampFlash('strobe', S.tLamp) : 0;
      else if (h.k === 'beacon') on = lt.beacon ? K.lampFlash('beacon', S.tLamp) : 0;
      else on = lt[h.k] && sf.gear > 0.98 ? 1 : 0;
      const I = on * nf * 0.9; haloCol.setXYZ(i, h.c[0] * I, h.c[1] * I, h.c[2] * I);
    });
    haloCol.needsUpdate = true; haloPos.needsUpdate = true; halo.visible = nf > 0.01;
  });
  const visual = rig.build();
  visual.object3D.add(halo);
  rig.disposables.push(haloGeo, haloMat);
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- paint ---------------------------------------------------------------------------------------------------------------------
function paint(atlas, o) {
  const { SC, C, fus, W, fins, glove, paintF, finSpan } = o, F = K.FINISH;
  const top = paintF(SC.top), under = paintF(SC.under), mark = SC.mark, WX = SC.wx;
  const hi = SC.style === 'gloss', cag = SC.style === 'cag', lowVis = SC.insignia === 'low' ? mark : false;
  const slime = { color: '#c9cf8f', rough: 0.35, metal: 0 };
  const red = '#b0262a', stc = SC.stencil;
  const rnd = (() => { let a = SC.seed; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * k)))); return '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''); };
  const panelL = { px: 1, depth: 0.36, dark: hi ? 0.085 : 0.12 }, fineL = { px: 1, depth: 0.25, dark: hi ? 0.06 : 0.09 }, gapL = { px: 2, depth: 0.8, dark: 0.45 };
  const rivL = { px: 1.1, depth: 0.16, dark: hi ? 0.025 : 0.04 };
  const grime = '28,26,24', hyd = '72,58,30', fuel = '60,52,40';
  // patchwork touch-ups (the classic carrier Tomcat look): fresh paint is a shade darker and smoother, old panels chalky and
  // lighter; gloss jets get only a few faint ones. Patches follow panel shapes (rectangles), a few are blotchy sprays.
  const touchUp = (Q, n, a0, a1, b0, b1, sz, base = SC.top) => {
    for (let i = 0; i < n; i++) {
      const a = a0 + rnd() * (a1 - a0), b = b0 + rnd() * (b1 - b0), w = sz[0] * (0.5 + rnd()), h = sz[1] * (0.5 + rnd()), fresh = rnd() < 0.6;
      const f = fresh ? { color: shade(base, 0.88 + rnd() * 0.07), rough: hi ? 0.2 : 0.5, metal: 0 } : { color: shade(base, 1.04 + rnd() * 0.06), rough: hi ? 0.3 : 0.74, metal: 0 };
      if (rnd() < 0.75) Q.fill((g) => g.rect(a, b, w, h), f, { alpha: 0.5 + rnd() * 0.4 });
      else { const pts = []; for (let k = 0; k < 9; k++) { const t = k / 9 * 6.283, q = 0.6 + rnd() * 0.5; pts.push([a + w / 2 + Math.cos(t) * w * 0.5 * q, b + h / 2 + Math.sin(t) * h * 0.5 * q]); } Q.fill(pts, f, { alpha: 0.6 + rnd() * 0.3, feather: 2 }); }
    }
  };
  const boots = (Q, a0, a1, b0, b1, n, ka = 1, kb = 1) => {          // boot scuffs: dark rubber smudges, soft edges
    for (let i = 0; i < n; i++) {
      const a = a0 + rnd() * (a1 - a0), b = b0 + rnd() * (b1 - b0), r = 0.05 + rnd() * 0.05;
      Q.fill([[a - r * ka, b - r * 1.7 * kb], [a + r * ka, b - r * 1.7 * kb], [a + r * 0.8 * ka, b + r * 1.7 * kb], [a - r * 0.8 * ka, b + r * 1.7 * kb]], { color: '#3c3e40', rough: 0.78, metal: 0 }, { alpha: (0.06 + rnd() * 0.1) * (0.5 + WX), feather: 3 });
    }
  };

  // ================= centre fuselage (unwrap: z, t) =================
  const P = atlas.pen(C.fus);
  P.fill('all', top);
  if (hi) P.band(-11.5, 7.6, -Infinity, (z) => (z < -7.7 ? 0.02 : z < -3.9 ? -0.08 : -0.18), under, { feather: 1 });
  else P.band(-11.5, 7.6, -Infinity, (z) => (z < -8 ? -0.02 : -0.16), under, { feather: 6 });
  P.fill((g) => g.rect(-11.5, 0, 2.92, 1), F.semigloss(SC.radome));
  if (!hi) {   // radome: dielectric paint weathers differently (blotchy, tan-grey erosion toward the tip)
    for (let i = 0; i < 9; i++) { const z = -11.3 + rnd() * 2.5, t = rnd(); P.fill((g) => g.ellipse(z, t, 0.25 + rnd() * 0.4, 0.04 + rnd() * 0.06, 0, 0, 6.283), { color: shade(SC.radome, 0.93 + rnd() * 0.12), rough: 0.5, metal: 0 }, { alpha: 0.5, feather: 6 }); }
    P.fill((g) => g.rect(-11.5, 0, 0.5, 1), { color: '#9c978a', rough: 0.55, metal: 0 }, { alpha: 0.45 * WX, feather: 10 });
  }
  if (cag) {   // squadron radome stripe: black band with gold edges and a chevron on top
    for (const [z0, z1, c] of [[-8.58, -8.22, SC.fin], [-8.62, -8.58, SC.accent], [-8.22, -8.18, SC.accent]]) P.fill((g) => g.rect(z0, 0, z1 - z0, 1), F.semigloss(c));
    P.fill([[-8.2, 0.42], [-7.75, 0.5], [-8.2, 0.58], [-8.05, 0.5]], F.semigloss(SC.accent));
  } else if (hi) {   // blue nose band with gold pinstripes and a row of white stars
    for (const [z0, z1, c] of [[-8.56, -8.26, SC.blue], [-8.6, -8.56, SC.gold], [-8.26, -8.22, SC.gold]]) P.fill((g) => g.rect(z0, 0, z1 - z0, 1), F.gloss(c));
    for (let k = 0; k < 14; k++) P.decalT(-8.41, (k + 0.5) / 14, { girth: 4.2 }, (g) => { g.fillStyle = '#f2f2ee'; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.024 : 0.06, a = i * Math.PI / 5 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.fill(); });
  }
  // anti-glare panel ahead of the windscreen
  P.fill([[-8.62, 0.455], [-7.65, 0.415], [-7.65, 0.585], [-8.62, 0.545]], F.matte(hi || cag ? '#151619' : '#3d4247'));
  P.ring(-8.6, 0, 1, { px: 1.6, depth: 0.45, dark: 0.3 });
  // ---- panel layout: frames, longerons, doors, access panels
  const frames = [-7.65, -6.95, -5.9, -3.95, -3.2, -2.4, -1.6, -0.8, 0, 0.8, 1.6, 2.4, 3.2, 4.0, 4.95, 6.3, 6.9];
  for (const z of frames) { P.ring(z, 0.3, 0.42, panelL); P.ring(z, 0.58, 0.7, panelL); P.ring(z, 0.0, 0.1, panelL); P.ring(z, 0.9, 1.0, panelL); }
  for (const z of [-10.2, -9.4]) P.ring(z, 0, 1, fineL);
  for (const yy of [0.15, 0.5]) P.yLine(-8.55, -3.9, yy, panelL);
  for (const tt of [0.06, 0.15, 0.85, 0.94]) P.line([[-8.5, tt], [7.5, tt]], panelL);
  for (const tt of [0.35, 0.65]) P.line([[-3.9, tt], [6.3, tt]], fineL);
  P.line([[-3.9, 0.5], [7.6, 0.5]], fineL); P.line([[-8.6, 0], [7.6, 0]], fineL);
  // forward fuselage doors (radar / avionics bays, both sides) with hinge and latch details
  for (const [z0, z1, y0, y1] of [[-8.5, -7.75, 0.0, 0.45], [-7.6, -6.3, -0.05, 0.45], [-6.2, -4.6, 0.0, 0.48], [-4.5, -3.95, -0.1, 0.5], [-7.6, -6.3, -0.42, -0.12], [-6.2, -4.6, -0.45, -0.12]]) {
    P.doorOn(z0, z1, y0, y1, { ...panelL, dark: panelL.dark * 1.2 });
    for (const zz of [z0 + 0.12, z1 - 0.12]) P.decalOn(zz, y0 + 0.04, 'both', { layers: ['height', 'color'] }, (g, l) => { g.fillStyle = l === 'height' ? 'rgba(0,0,0,0.45)' : 'rgba(15,17,19,0.25)'; g.fillRect(-0.03, -0.006, 0.06, 0.012); });
    P.rivets(z0 + 0.02, fus.tAtY(z0, y0), z0 + 0.02, fus.tAtY(z0, y1), 0.008, rivL); P.rivets(z1 - 0.02, fus.tAtY(z1, y0), z1 - 0.02, fus.tAtY(z1, y1), 0.008, rivL);
    P.rivets(z0 + 0.02, 1 - fus.tAtY(z0, y0), z0 + 0.02, 1 - fus.tAtY(z0, y1), 0.008, rivL); P.rivets(z1 - 0.02, 1 - fus.tAtY(z1, y0), z1 - 0.02, 1 - fus.tAtY(z1, y1), 0.008, rivL);
  }
  // small access panels (unwrap z, t; both sides)
  const acc = [[-8.0, 0.1, 0.32, 0.03], [-6.9, 0.035, 0.3, 0.025], [-5.4, 0.04, 0.4, 0.025], [-3.5, 0.3, 0.45, 0.04], [-2.0, 0.33, 0.6, 0.035], [-0.4, 0.36, 0.5, 0.03], [1.2, 0.37, 0.7, 0.03], [2.8, 0.38, 0.55, 0.03], [4.3, 0.38, 0.45, 0.03], [-1.2, 0.08, 0.6, 0.03], [1.9, 0.07, 0.5, 0.025], [3.6, 0.09, 0.6, 0.03], [-3.4, 0.44, 0.35, 0.03]];
  for (const [z, t, w, h] of acc) for (const tt of [t, 1 - t - h]) { P.panel(z, tt, z + w, tt + h, { ...fineL, r: 0.01 }); P.rivets(z + 0.02, tt + 0.003, z + w - 0.02, tt + 0.003, 0.04, rivL); P.rivets(z + 0.02, tt + h - 0.003, z + w - 0.02, tt + h - 0.003, 0.04, rivL); }
  // rivet rows on the frames and the upper longerons
  for (const z of frames) if (z > -3.9 && z < 6.3) { P.rivets(z + 0.03, 0.31, z + 0.03, 0.42, 0.007, rivL); P.rivets(z + 0.03, 0.58, z + 0.03, 0.69, 0.007, rivL); }
  for (const tt of [0.355, 0.645]) P.rivets(-3.85, tt, 6.2, tt, 0.045, rivL);
  // M61 gun (left side): muzzle port, blast vents, gun-bay door and soot
  P.doorOn(-8.45, -6.75, -0.38, -0.08, { side: 'L', ...panelL, dark: 0.16 });
  P.decalOn(-8.05, -0.13, 'L', { layers: ['color', 'height', 'orm'] }, (g, layer) => {
    if (layer === 'height') { g.fillStyle = 'rgba(0,0,0,0.7)'; g.beginPath(); g.ellipse(-0.15, 0, 0.09, 0.045, 0, 0, Math.PI * 2); g.fill(); for (let i = 0; i < 6; i++) g.fillRect(0.12 + i * 0.075, -0.045, 0.04, 0.09); return; }
    if (layer === 'orm') { g.fillStyle = 'rgb(255,150,0)'; g.fillRect(-0.3, -0.12, 0.85, 0.24); return; }
    g.fillStyle = '#121314'; g.beginPath(); g.ellipse(-0.15, 0, 0.09, 0.045, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#26282a'; for (let i = 0; i < 6; i++) g.fillRect(0.12 + i * 0.075, -0.045, 0.04, 0.09);
  });
  for (let i = 0; i < 4; i++) P.streak(-8.0, 0.775 + i * 0.006, -6.2 - rnd() * 0.8, 0.77 + i * 0.012, 0.03, { alpha: 0.3 + 0.3 * WX, color: '22,20,18' });
  // refuelling-probe door outline (right, ahead of the windscreen), boarding ladder door and kick-in steps (left)
  P.decalOn(-7.85, 0.56, 'R', { layers: ['height', 'color'] }, (g, l) => { g.strokeStyle = l === 'height' ? 'rgba(0,0,0,0.6)' : 'rgba(10,12,14,0.35)'; g.lineWidth = 0.01; g.strokeRect(-0.46, -0.06, 0.92, 0.12); });
  P.doorOn(-5.79, -5.41, -0.32, -0.05, { side: 'L', ...gapL, dark: 0.35 });
  for (const y of [0.2, 0.5]) P.decalOn(-5.55, y, 'L', { layers: ['height', 'color', 'orm'] }, (g, l) => {
    if (l === 'height') { g.fillStyle = 'rgba(0,0,0,0.8)'; g.fillRect(-0.07, -0.035, 0.14, 0.07); return; }
    if (l === 'orm') { g.fillStyle = 'rgb(255,200,0)'; g.fillRect(-0.07, -0.035, 0.14, 0.07); return; }
    g.fillStyle = '#17181a'; g.fillRect(-0.07, -0.035, 0.14, 0.07); g.strokeStyle = hi ? red : stc; g.lineWidth = 0.008; g.strokeRect(-0.085, -0.05, 0.17, 0.1);
  });
  P.textOn('STEP', -5.55, 0.32, 'L', 0.025, { color: stc });
  // modex, crew names, rescue / ejection markings, stencils
  P.textOn(SC.modex, -9.05, 0.08, 'both', 0.27, { color: mark, weight: 700, outline: hi ? '#f0f0ec' : undefined });
  P.textOn(SC.pilot, -6.55, 0.64, 'both', 0.033, { color: hi || cag ? '#141518' : mark, weight: 700 });
  P.textOn(SC.rio, -5.25, 0.7, 'both', 0.033, { color: hi || cag ? '#141518' : mark, weight: 700 });
  P.textOn('RESCUE', -7.55, 0.5, 'both', 0.04, { color: SC.danger, weight: 700 });
  for (const z of [-7.15, -5.85]) P.decalOn(z, 0.38, 'both', (g) => { g.strokeStyle = SC.danger; g.lineWidth = 0.012; g.beginPath(); g.moveTo(-0.075, 0.06); g.lineTo(0.075, 0.06); g.lineTo(0, -0.065); g.closePath(); g.stroke(); g.fillStyle = SC.danger; g.fillRect(-0.006, -0.02, 0.012, 0.05); });
  P.textOn('DANGER', -6.85, 0.38, 'both', 0.022, { color: SC.danger, weight: 700 });
  const stencils = [['JACK PT', -7.9, -0.28], ['GND', -6.0, -0.48], ['OXYGEN', -4.3, -0.05], ['ELEC PWR', -3.6, -0.4], ['NO STEP', -2.9, 0.62], ['NO STEP', 0.5, 0.58], ['FUEL', 1.4, 0.45], ['HYD', 3.0, 0.38], ['VENT', 4.4, 0.32], ['LIFT HERE', -4.9, -0.35], ['ARM', -6.9, -0.36]];
  for (const [s, z, y] of stencils) P.textOn(s, z, y, 'both', 0.022, { color: stc });
  // formation strip lights on the nose and the spine walkway behind the canopy
  P.decalOn(-8.4, 0.12, 'both', { layers: ['color', 'orm'] }, (g, layer) => { g.fillStyle = layer === 'orm' ? 'rgb(255,90,0)' : slime.color; g.fillRect(-0.3, -0.03, 0.6, 0.06); });
  P.fill((g) => g.rect(-3.9, 0.47, 3.4, 0.06), F.matte(hi ? '#2a2c2e' : '#555b60'), { alpha: 0.85 });
  if (hi) for (const tt of [0.468, 0.532]) P.line([[-3.9, tt], [-0.5, tt]], { px: 1.5, depth: 0, dark: 0, color: '#f0f0ec' });
  // ---- weathering
  P.noise({ alpha: 0.05 + 0.05 * WX, scale: 2.2, stretch: [1.6, 1], rough: 0.06 });
  P.noise({ alpha: 0.03 + 0.03 * WX, scale: 0.7, mode: 'light' });
  touchUp(P, Math.round(4 + 30 * WX), -7.5, 6, 0.3, 0.7, [0.3, 0.035]);
  touchUp(P, Math.round(2 + 14 * WX), -8.5, 5, 0.12, 0.3, [0.35, 0.04]);
  touchUp(P, Math.round(2 + 14 * WX), -8.5, 5, 0.7, 0.88, [0.35, 0.04]);
  boots(P, -3.9, -0.6, 0.44, 0.56, Math.round(10 + 20 * WX), 1, 0.02);                // spine walkway behind the cockpit
  boots(P, -5.9, -5.2, 0.75, 0.86, Math.round(6 + 10 * WX), 0.6, 0.03);               // kick steps / boarding side
  for (let i = 0; i < Math.round(14 + 26 * WX); i++) { const z = -6 + rnd() * 12, t = (rnd() < 0.5 ? 0.02 : 0.88) + rnd() * 0.1; P.streak(z, t, z + 0.5 + rnd() * 1.4, t, 0.006 + rnd() * 0.012, { alpha: (0.08 + rnd() * 0.12) * (0.6 + WX), color: grime }); }
  for (let i = 0; i < Math.round(4 + 8 * WX); i++) { const z = -7.5 + rnd() * 1.5, t = rnd() < 0.5 ? 0.02 + rnd() * 0.06 : 0.92 + rnd() * 0.06; P.streak(z, t, z + 1.2 + rnd(), t, 0.012, { alpha: 0.15 + 0.15 * WX, color: hyd }); }   // nose-gear well leaks
  if (WX > 0.7) P.noise({ alpha: 0.09, scale: 4.5, stretch: [2.5, 1], mode: 'dark', rough: 0.08 });
  P.fill((g) => g.rect(6.3, 0, 1.3, 1), { color: 'rgba(40,36,32,0.3)' }, { feather: 6 });
  for (const s of [0.3, 0.7]) P.streak(7.6, s, 5.8, s, 0.12, { alpha: 0.2 + 0.15 * WX });
  for (let i = 0; i < 5; i++) { const t = 0.44 + rnd() * 0.12; P.streak(6.2, t, 7.6, t + (rnd() - 0.5) * 0.02, 0.02, { alpha: 0.18 + 0.2 * WX, color: fuel }); }   // fuel-dump stain on the paddle
  for (const t of [0.04, 0.08, 0.92, 0.96]) P.streak(6.3, t, 7.5, t, 0.02, { alpha: 0.2 + 0.2 * WX, color: hyd });                                          // speedbrake hydraulics
  P.shade((g) => g.rect(-7.65, 0.37, 3.7, 0.26), 0.35, { feather: 4 });              // canopy sill shadow

  // ================= nacelles (unwrap: z, t). Outer side t = .25 (right) / .75 (left) =================
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const Q = atlas.pen(C['nac' + key]), T = (t) => (sx > 0 ? t : 1 - t), rot = sx > 0 ? 180 : 0, gir = 4.5;
    const lnT = (pts, op) => Q.line(pts.map(([z, t]) => [z, T(t)]), op);
    Q.fill('all', top);
    Q.fill([[-4.0, T(0)], [6.6, T(0)], [6.6, T(0.19)], [-4.0, T(hi ? 0.24 : 0.205)]], under, { feather: hi ? 1 : 5 });
    Q.fill([[-4.0, T(0.81)], [6.6, T(0.81)], [6.6, T(1)], [-4.0, T(1)]], under, { feather: hi ? 1 : 5 });
    // panel lines, doors (engine access on the lower nacelle, accessory bay), rivets
    for (const z of [-3.3, -2.2, -1.1, 1.3, 2.3, 3.4, 4.5, 5.5, 6.3]) Q.line([[z, 0], [z, 1]], panelL);
    for (const t of [0.12, 0.25, 0.38]) lnT([[-3.7, t], [6.5, t]], fineL);
    Q.line([[6.48, 0], [6.48, 1]], { px: 1.5, depth: 0.6, dark: 0.3 });
    for (const [z0, z1, t0, t1] of [[1.4, 3.3, 0.02, 0.11], [3.5, 5.4, 0.02, 0.11], [-2.1, -1.2, 0.27, 0.36], [1.4, 2.2, 0.27, 0.36], [3.5, 4.4, 0.26, 0.37]]) {
      Q.panel(z0, T(t0), z1, T(t1), { ...panelL, r: 0.02 });
      for (const t of [t0 + 0.004, t1 - 0.004]) Q.rivets(z0 + 0.04, T(t), z1 - 0.04, T(t), 0.04, rivL);
    }
    for (const z of [-3.3, -2.2, -1.1, 1.3, 2.3, 3.4, 4.5, 5.5]) Q.rivets(z + 0.03, T(0.13), z + 0.03, T(0.37), 0.006, rivL);
    // intake warning: red DANGER chevron + text behind the lip, red lip outline
    const decal = (z, t, fn) => Q.decalT(z, T(t), { rot, girth: gir }, fn);
    decal(-3.15, 0.27, (g) => { g.fillStyle = red; g.beginPath(); g.moveTo(-0.12, -0.16); g.lineTo(0.05, 0); g.lineTo(-0.12, 0.16); g.lineTo(-0.07, 0.16); g.lineTo(0.1, 0); g.lineTo(-0.07, -0.16); g.closePath(); g.fill(); });
    decal(-2.75, 0.27, (g) => K.drawText(g, 'DANGER', 0.05, { color: red, weight: 700 }));
    decal(-2.75, 0.315, (g) => K.drawText(g, 'INTAKE', 0.04, { color: red, weight: 700 }));
    // national insignia on the intake side, NAVY + BuNo aft, squadron name
    decal(-1.55, 0.255, (g) => K.drawStarBar(g, hi ? 0.56 : 0.5, { lowVis }));
    decal(2.85, 0.215, (g) => K.drawText(g, 'NAVY', 0.2, { color: mark, weight: 700, font: K.FONT.sans }));
    decal(2.85, 0.27, (g) => K.drawText(g, SC.buno, 0.08, { color: mark, weight: 700 }));
    if (hi) decal(0.55, 0.3, (g) => K.drawText(g, 'STARHAWKS', 0.11, { color: SC.blue, weight: 700, italic: true }));
    if (cag) decal(0.6, 0.3, (g) => K.drawText(g, 'SKY LANCERS', 0.09, { color: '#141518', weight: 700, italic: true }));
    decal(-0.6, 0.18, (g) => { g.fillStyle = slime.color; g.fillRect(-0.3, -0.025, 0.6, 0.05); });
    for (const [s, z, t] of [['NO STEP', 0.0, 0.42], ['ENG OIL', 4.0, 0.31], ['FUEL', 1.8, 0.31], ['HOIST', -1.6, 0.07], ['GND', 5.0, 0.07]]) decal(z, t, (g) => K.drawText(g, s, 0.025, { color: stc }));
    // weathering: exhaust soot on the aft nacelle, grime, leaks, touch-ups
    Q.noise({ alpha: 0.05 + 0.05 * WX, scale: 2.0, stretch: [1.6, 1], rough: 0.05 });
    Q.fill((g) => g.rect(5.4, 0, 1.2, 1), { color: 'rgba(38,34,30,0.45)' }, { feather: 8 });
    for (let i = 0; i < Math.round(8 + 18 * WX); i++) { const z = -2.5 + rnd() * 7, t = T(0.02 + rnd() * 0.17); Q.streak(z, t, z + 0.6 + rnd() * 1.2, t, 0.008 + rnd() * 0.01, { alpha: (0.1 + rnd() * 0.12) * (0.6 + WX), color: grime }); }
    for (let i = 0; i < Math.round(3 + 6 * WX); i++) { const z = 0.9 + rnd() * 0.3, t = T(0.08 + rnd() * 0.12); Q.streak(z, t, z + 1.5 + rnd(), t, 0.015, { alpha: 0.2 + 0.2 * WX, color: hyd }); }    // main-gear well leaks
    touchUp(Q, Math.round(2 + 14 * WX), -3, 5.5, Math.min(T(0.2), T(0.4)), Math.max(T(0.2), T(0.4)), [0.35, 0.03]);
    if (WX > 0.7) Q.noise({ alpha: 0.09, scale: 4, stretch: [2.5, 1], mode: 'dark', rough: 0.08 });
  }

  // ================= glove / overwing fairing (plan, mirrored: x, z) =================
  {
    const at = (x, f, s) => { const p = glove.R.at(x, f, s); return [p[0], p[2]]; };
    for (const [chart, isTop] of [[C.gloveT, true], [C.gloveB, false]]) {
      const Q = atlas.pen(chart);
      Q.fill('all', isTop ? top : under);
      for (const f of [0.08, 0.3, 0.55, 0.78]) Q.line([at(0.6, f), at(3.25, f)], panelL);
      for (const x of [1.2, 1.9, 2.6]) Q.line([at(x, 0.01), at(x, 0.98)], panelL);
      for (const f of [0.085, 0.305, 0.555]) { const a = at(0.65, f), b = at(3.1, f); Q.rivets(a[0], a[1], b[0], b[1], 0.04, rivL); }
      Q.line([[3.12, -1.2], [3.12, 3.35], [2.3, 4.7]], gapL);         // overwing fairing seal (wing slot)
      for (const [x0, z0, x1, z1] of [[1.3, -0.6, 1.8, 0.4], [2.0, 0.8, 2.6, 1.8], [0.7, 2.2, 1.3, 3.4], [1.6, 3.0, 2.2, 3.8], [2.2, -2.6, 2.6, -1.9]]) {
        Q.panel(x0, z0, x1, z1, { ...fineL, r: 0.02 });
        for (const z of [z0 + 0.03, z1 - 0.03]) Q.rivets(x0 + 0.04, z, x1 - 0.04, z, 0.04, rivL);
      }
      if (isTop) {
        // black non-skid walkways beside the canopy (outlined white on the gloss scheme), NO STEP, slime light
        const wk = [[0.85, -3.6], [1.45, -3.6], [1.45, -1.2], [0.85, -1.2]];
        Q.fill(wk, { color: hi ? '#222426' : '#4f555a', rough: 0.95, metal: 0 }, { alpha: 0.92 });
        if (hi) Q.stroke((g) => { wk.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); }, 0.025, F.gloss('#f2f2ee'));
        boots(Q, 0.85, 1.45, -3.6, -1.2, Math.round(16 + 24 * WX));
        Q.text('NO STEP', 2.4, 1.6, 0.07, { color: hi ? '#2a2c2e' : stc, rot: 90 });
        Q.text('NO STEP', 2.75, -0.6, 0.05, { color: hi ? '#2a2c2e' : stc, rot: 90 });
        Q.fill((g) => g.rect(2.2, -2.6, 0.06, 0.6), slime);
        if (cag) Q.fill([at(0.6, 0.0), at(3.25, 0.0), at(3.25, 0.03), at(0.6, 0.05)], F.semigloss(SC.accent));
        if (hi) Q.fill([at(0.6, 0.0), at(3.25, 0.0), at(3.25, 0.03), at(0.6, 0.05)], F.gloss(SC.blue));
        // worn seal area along the slot: rubbed, scuffed paint where the wing slides under the fairing
        Q.stroke([[3.05, -1.0], [3.05, 3.3]], 0.12, { color: shade(SC.top, 1.1), rough: 0.5, metal: 0.1 }, { alpha: 0.25 + 0.35 * WX });
        Q.wear((g) => { g.moveTo(3.08, -1.0); g.lineTo(3.08, 3.3); }, 0.05, { color: '#a4a8aa', rough: 0.35, metal: 0.7 }, { alpha: 0.2 + 0.3 * WX });
      }
      Q.wear((g) => { const a = at(0.7, 0.004), b = at(3.2, 0.004); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }, 0.03, { color: '#9a9ea2', rough: 0.4, metal: 0.6 }, { alpha: 0.2 + 0.25 * WX });
      Q.noise({ alpha: 0.05 + 0.05 * WX, scale: 1.4, stretch: [1, 2], rough: 0.06 });
      if (isTop) touchUp(Q, Math.round(2 + 16 * WX), 0.7, 3.0, -4, 3, [0.25, 0.35]);
      if (WX > 0.7 && isTop) Q.noise({ alpha: 0.09, scale: 3, stretch: [1, 2.5], mode: 'dark', rough: 0.08 });
      if (!isTop) for (let i = 0; i < Math.round(6 + 10 * WX); i++) { const x = 1.9 + rnd() * 1.3, z = -2 + rnd() * 4; Q.streak(x, z, x, z + 0.8 + rnd(), 0.04, { alpha: 0.15, color: grime }); }
    }
  }

  // ================= movable wing panels (plan at 20° sweep) =================
  for (const key of ['R', 'L']) {
    const s = key === 'R' ? 1 : -1, wg = W.R;
    const at = (x, f) => { const a = wg.at(x, 0, 'mid'), b = wg.at(x, 1, 'mid'); return [a[0] + (b[0] - a[0]) * f, a[2] + (b[2] - a[2]) * f]; };
    for (const [chart, isTop] of [[key === 'R' ? C.wTR : C.wTL, true], [key === 'R' ? C.wBR : C.wBL, false]]) {
      const Q = atlas.pen(chart);
      const ln = (pts, op) => Q.line(pts.map(p => [p[0] * s, p[1]]), op);
      const poly = (pts) => pts.map(p => [p[0] * s, p[1]]);
      Q.fill('all', isTop ? top : under);
      // the sector that slides under the overwing fairing as the wing sweeps (wing frame: arc 42°…90° about the pivot):
      // protected from sun and deck grime, rubbed by the seals — a cleaner, smoother tone with fine arc scratches
      if (isTop) {
        const sector = (g) => { g.moveTo(s * 3.2, -1.0); g.arc(s * 3.2, -1.0, 4.3, s > 0 ? 42 * DEG : Math.PI - 90 * DEG, s > 0 ? 90 * DEG : Math.PI - 42 * DEG); g.closePath(); };
        Q.fill(sector, { color: shade(SC.top, hi ? 1.02 : 1.06), rough: hi ? 0.18 : 0.5, metal: 0.05 }, { alpha: 0.5 + 0.3 * WX, feather: 3 });
        for (let i = 0; i < 26; i++) { const r = 0.4 + rnd() * 3.8, a0 = (44 + rnd() * 20) * DEG, a1 = a0 + (10 + rnd() * 20) * DEG; Q.stroke((g) => (s > 0 ? g.arc(3.2, -1.0, r, a0, a1) : g.arc(-3.2, -1.0, r, Math.PI - a1, Math.PI - a0)), 0, { color: shade(SC.top, 1.2), rough: 0.4, metal: 0.3 }, { px: 1, alpha: 0.2 + 0.3 * WX }); }
      }
      if (hi) {
        // white flaps, slats and spoilers, squadron-blue wingtips with a gold pinstripe
        Q.fill(poly([at(3.45, 0.7), at(8.75, 0.7), at(8.75, 1.02), at(3.45, 1.02)]), F.gloss('#f0f0ec'));
        if (isTop) Q.fill(poly([at(3.5, -0.02), at(9.5, -0.02), at(9.5, 0.15), at(3.5, 0.15)]), F.gloss('#f0f0ec'));
        if (isTop) Q.fill(poly([at(3.55, 0.5), at(7.1, 0.5), at(7.1, 0.7), at(3.55, 0.7)]), F.gloss('#f0f0ec'));
        if (isTop) { Q.fill(poly([at(9.0, -0.05), at(9.9, -0.05), at(9.9, 1.05), at(9.0, 1.05)]), F.gloss(SC.blue)); Q.fill(poly([at(8.9, -0.05), at(9.0, -0.05), at(9.0, 1.05), at(8.9, 1.05)]), F.gloss(SC.gold)); }
      }
      if (cag && isTop) { Q.fill(poly([at(9.0, -0.05), at(9.9, -0.05), at(9.9, 1.05), at(9.0, 1.05)]), F.semigloss(SC.fin)); Q.fill(poly([at(8.9, -0.05), at(9.0, -0.05), at(9.0, 1.05), at(8.9, 1.05)]), F.semigloss(SC.accent)); }
      // spars, ribs and control-surface gaps
      for (const f of [0.28, 0.42, 0.6]) ln([at(3.3, f), at(9.6, f)], panelL);
      for (const x of [4.2, 5.0, 5.8, 6.6, 7.4, 8.2, 9.0]) ln([at(x, 0.15), at(x, 0.7)], fineL);
      ln([at(3.45, 1), at(3.45, 0.7), at(8.75, 0.7), at(8.75, 1)], gapL);
      ln([at(6.1, 0.7), at(6.1, 1)], { px: 1.5, depth: 0.6, dark: 0.35 });
      ln([at(3.5, 0), at(3.5, 0.15), at(9.5, 0.15), at(9.5, 0)], gapL);
      for (const x of [5.5, 7.5]) ln([at(x, 0), at(x, 0.15)], { px: 1.5, depth: 0.6, dark: 0.35 });
      if (isTop) {
        ln([at(3.55, 0.7), at(3.55, 0.5), at(7.1, 0.5), at(7.1, 0.7)], gapL);
        for (const x of [4.44, 5.33, 6.22]) ln([at(x, 0.5), at(x, 0.7)], { px: 1.5, depth: 0.6, dark: 0.4 });
      }
      for (const f of [0.28, 0.42, 0.6]) { const a = at(3.4, f + 0.012), b = at(9.5, f + 0.012); Q.rivets(a[0] * s, a[1], b[0] * s, b[1], 0.03, rivL); }
      for (const x of [4.2, 5.0, 5.8, 6.6, 7.4, 8.2, 9.0]) { const a = at(x + 0.02, 0.16), b = at(x + 0.02, 0.69); Q.rivets(a[0] * s, a[1], b[0] * s, b[1], 0.04, rivL); }
      for (const [x0, x1, f0, f1] of [[4.4, 4.9, 0.3, 0.4], [6.0, 6.5, 0.3, 0.4], [7.6, 8.0, 0.3, 0.39], [5.1, 5.6, 0.44, 0.56]]) {
        const A = at(x0, f0), B = at(x1, f0), Cc = at(x1, f1), D = at(x0, f1);
        ln([A, B, Cc, D, A], fineL);
      }
      // leading-edge wear, tonal variation, hinge-line grime, touch-ups
      const le = poly([at(3.5, 0.004), at(9.6, 0.004)]);
      Q.wear((g) => { g.moveTo(le[0][0], le[0][1]); g.lineTo(le[1][0], le[1][1]); }, 0.035, { color: '#9a9ea2', rough: 0.4, metal: 0.6 }, { alpha: 0.2 + 0.3 * WX });
      Q.noise({ alpha: 0.05 + 0.05 * WX, scale: 1.2, stretch: [1, 2.5], rough: 0.06 });
      for (let i = 0; i < Math.round(5 + 9 * WX); i++) { const x = 3.6 + rnd() * 5, a = at(x, 0.7); Q.streak(a[0] * s, a[1], a[0] * s, a[1] + 0.3 + rnd() * 0.4, 0.03, { alpha: 0.12 + 0.1 * WX, color: grime }); }
      if (!isTop) for (let i = 0; i < Math.round(3 + 6 * WX); i++) { const x = 4 + rnd() * 4.5, a = at(x, 0.62); Q.streak(a[0] * s, a[1], a[0] * s + s * 0.3, a[1] + 1.0 + rnd(), 0.03, { alpha: 0.12 + 0.1 * WX, color: fuel }); }
      if (isTop) touchUp(Q, Math.round(2 + 10 * WX), s > 0 ? 3.6 : -9, s > 0 ? 9 : -3.6, -0.5, 2.5, [0.25, 0.3]);
      if (WX > 0.7) Q.noise({ alpha: 0.09, scale: 3, stretch: [1, 2.5], mode: 'dark', rough: 0.08 });
      // markings: insignia upper left / lower right, NAVY lower left, modex on the right flap / slat
      const c = at(7.2, 0.4);
      if (isTop && key === 'L') Q.decal(-c[0], c[1], { rot: -20 }, (g) => K.drawStarBar(g, 0.75, { lowVis }));
      if (!isTop && key === 'R') Q.decal(c[0], c[1], { rot: 20 }, (g) => K.drawStarBar(g, 0.75, { lowVis }));
      if (!isTop && key === 'L') Q.text('NAVY', -c[0], c[1], 0.45, { color: mark, weight: 700, rot: 70 });
      if (isTop && key === 'R') { const m = at(5.0, 0.85); Q.text(SC.modex, m[0], m[1], 0.22, { color: hi || cag ? '#141518' : mark, weight: 700, rot: 20 }); }
      if (isTop) { const p = at(5.2, 0.6); Q.text('NO STEP', p[0] * s, p[1], 0.05, { color: hi ? '#2a2c2e' : stc, rot: s * 20 }); }
      if (isTop) { const p = at(4.0, 0.08); Q.text('NO STEP', p[0] * s, p[1], 0.035, { color: hi ? '#2a2c2e' : stc, rot: s * 20 }); }
    }
  }

  // ================= stabilators =================
  for (const [chart, isTop, sx] of [[C.sTR, true, 1], [C.sTL, true, -1], [C.sB, false, 1]]) {
    const Q = atlas.pen(chart); Q.fill('all', isTop ? top : under);
    if (hi && isTop) { Q.fill([[sx * 4.3, 3.5], [sx * 5.0, 3.5], [sx * 5.0, 7.8], [sx * 4.3, 7.8]], F.gloss(SC.blue)); Q.fill([[sx * 4.2, 3.5], [sx * 4.3, 3.5], [sx * 4.3, 7.8], [sx * 4.2, 7.8]], F.gloss(SC.accent)); }
    if (cag && isTop) { Q.fill([[sx * 4.3, 3.5], [sx * 5.0, 3.5], [sx * 5.0, 7.8], [sx * 4.3, 7.8]], F.semigloss(SC.fin)); Q.fill([[sx * 4.2, 3.5], [sx * 4.3, 3.5], [sx * 4.3, 7.8], [sx * 4.2, 7.8]], F.semigloss(SC.accent)); }
    for (const x of [2.6, 3.2, 3.8, 4.4]) Q.line([[sx * x, 3.5], [sx * x, 7.8]], fineL);
    for (const zz of [5.0, 6.0]) Q.line([[sx * 2.1, zz], [sx * 5.0, zz + 1.6]], fineL);
    for (const x of [2.62, 3.22, 3.82]) Q.rivets(sx * x, 3.6, sx * x, 7.6, 0.05, rivL);
    Q.noise({ alpha: 0.06 + 0.04 * WX, scale: 1.0, stretch: [1, 2], rough: 0.06 });
    if (isTop) { touchUp(Q, Math.round(1 + 5 * WX), sx > 0 ? 2.3 : -4.6, sx > 0 ? 4.6 : -2.3, 4, 7, [0.3, 0.4]); Q.fill((g) => g.rect(-5, 6.9, 10, 1), { color: 'rgba(40,36,32,0.2)' }, { feather: 8 }); }
  }

  // ================= fins (side views: z, y) =================
  for (const [chart, outboard] of [[C.fRO, true], [C.fRI, false], [C.fLO, true], [C.fLI, false]]) {
    const Q = atlas.pen(chart), fn = fins.R;
    const at = (u, f) => { const a = fn.at(u, 0, 'mid'), b = fn.at(u, 1, 'mid'); return [a[2] + (b[2] - a[2]) * f, a[1] + (b[1] - a[1]) * f]; };   // chord line, extrapolates past LE / TE
    const span = finSpan;
    const hz = (u) => fn.lines.hinge.at(fn.spanToU(u));
    const finF = hi ? F.gloss(SC.fin) : cag ? F.semigloss(SC.fin) : paintF(SC.fin);
    Q.fill('all', finF);
    const band = (f0, f1, u0 = 0.05) => [at(u0, f0), at(u0, f1), at(span + 0.1, f1 + 0.62), at(span + 0.1, f0 + 0.62)];
    const rudder = [at(0.42, 1.05), at(0.42, hz(0.42)), at(span - 0.25, hz(span - 0.25)), at(span - 0.25, 1.05)];
    if (cag) {
      Q.fill(band(-0.02, 0.2), F.semigloss(SC.accent));
      for (const f of [-0.05, 0.23]) Q.fill(band(f, f + 0.018), F.semigloss('#f2f2ee'));
      Q.fill([at(span - 0.12, 0), at(span + 0.1, 0), at(span + 0.1, 1.05), at(span - 0.12, 1.05)], F.semigloss(SC.accent));
    } else if (hi) {
      // blue upper fin with a row of white stars, red sweep stripe with gold pinstripe, red-and-white striped rudder
      Q.fill([at(1.55, -0.02), at(span + 0.1, -0.02), at(span + 0.1, 1.05), at(1.2, 1.05)], F.gloss(SC.blue));
      Q.fill([at(1.36, -0.02), at(1.55, -0.02), at(1.2, 1.05), at(1.01, 1.05)], F.gloss(SC.accent));
      Q.fill([at(1.3, -0.02), at(1.36, -0.02), at(1.01, 1.05), at(0.95, 1.05)], F.gloss(SC.gold));
      for (let k = 0; k < 5; k++) { const p = at(2.05 + 0.04 * k, 0.12 + k * 0.1); Q.decal(p[0], p[1], (g) => { g.fillStyle = '#f2f2ee'; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.035 : 0.09, a = i * Math.PI / 5 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.fill(); }); }
      for (let k = 0; k < 7; k++) { const u0 = 0.42 + k * (span - 0.67) / 7, u1 = u0 + (span - 0.67) / 14; Q.fill([at(u0, hz(u0)), at(u0, 1.05), at(u1, 1.05), at(u1, hz(u1))], F.gloss(SC.accent)); }
    } else {
      Q.stroke((g) => { const b = band(-0.02, 0.2); b.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); }, 0.025, F.matte(SC.accent));
    }
    Q.line(rudder, gapL);
    for (const u of [0.6, 1.2, 1.8, 2.4]) Q.line([at(u, 0.02), at(u, hz(u))], fineL);
    for (const f of [0.25, 0.48]) Q.line([at(0.05, f), at(span - 0.1, f)], fineL);
    for (const f of [0.255, 0.485]) { const a = at(0.1, f), b = at(span - 0.15, f); Q.rivets(a[0], a[1], b[0], b[1], 0.045, rivL); }
    Q.panel(...at(0.25, 0.32), ...at(0.55, 0.45), { ...fineL, r: 0.02 });
    // tail code, squadron, BuNo; the emblem disc on the outer face
    const tc = hi ? '#141518' : cag ? '#f2f2ee' : mark;
    const cc = hi ? at(0.78, 0.36) : at(1.55, 0.3);
    Q.text(SC.code, cc[0], cc[1], hi ? 0.5 : 0.62, { color: tc, weight: 700, font: K.FONT.sans });
    const sq = hi ? at(0.4, 0.42) : at(0.78, 0.3); Q.text(SC.sqn, sq[0], sq[1], 0.11, { color: tc, weight: 700, italic: true });
    const bn = at(0.25, 0.62); Q.text('NAVY ' + SC.buno, bn[0], bn[1], 0.05, { color: tc, weight: 700 });
    if (outboard) {   // invented squadron emblem: a lance over a star in a disc (low-vis: outline only)
      const e = at(2.25, hi ? 0.66 : 0.6), col = cag ? SC.accent : hi ? '#f2f2ee' : mark;
      Q.decal(e[0], e[1], (g) => {
        g.lineWidth = 0.02; g.strokeStyle = col; g.beginPath(); g.arc(0, 0, 0.2, 0, Math.PI * 2); g.stroke();
        g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.05 : 0.13, a = i * Math.PI / 5 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath();
        if (lowVis) g.stroke(); else { g.fillStyle = col; g.fill(); }
        g.beginPath(); g.moveTo(-0.24, 0.17); g.lineTo(0.22, -0.2); g.stroke(); g.beginPath(); g.moveTo(0.26, -0.24); g.lineTo(0.16, -0.2); g.lineTo(0.22, -0.13); g.closePath(); g.fillStyle = col; g.fill();
      });
      if (cag) { const m = at(1.0, 0.85); Q.text('100', m[0], m[1], 0.12, { color: SC.accent, weight: 700 }); }
    }
    const fl = at(1.0, 0.1); Q.fill((g) => g.rect(fl[0] - 0.3, fl[1] - 0.03, 0.6, 0.06), slime);
    Q.noise({ alpha: 0.06 + 0.04 * WX, scale: 1.2, stretch: [1, 1.5], rough: 0.05 });
    if (!hi) touchUp(Q, Math.round(1 + 5 * WX), 2.2, 5.5, 0.8, 2.6, [0.3, 0.25], SC.fin);
    for (let i = 0; i < Math.round(2 + 4 * WX); i++) { const p = at(0.45 + rnd() * 1.8, hz(0.45) - 0.02); Q.streak(p[0], p[1], p[0] + 0.15, p[1] - 0.4 - rnd() * 0.4, 0.03, { alpha: 0.15 + 0.1 * WX, color: hyd }); }
  }

  // ================= nozzle petals (a = around, b = hinge → exit): heat-stained Inconel, darker toward the exit =================
  {
    const Q = atlas.pen(C.noz), n = 18, w = 3.6 / n;
    Q.fill('all', { color: '#a0978d', rough: 0.5, metal: 0.55 });
    for (let i = 0; i < n; i++) {
      Q.fill((g) => g.rect(i * w, 0, w, 0.95), { color: shade('#958c83', 0.9 + rnd() * 0.18), rough: 0.46 + rnd() * 0.12, metal: 0.55 }, { alpha: 0.7 });
      Q.fill((g) => g.rect(i * w + w * 0.32, 0.05, w * 0.36, 0.85), { color: '#9a9086', rough: 0.4, metal: 0.92 }, { alpha: 0.45 });
      Q.line([[i * w, 0], [i * w, 0.95]], { px: 2, depth: 0.9, dark: 0.6 });
      Q.rivets(i * w + w * 0.15, 0.05, i * w + w * 0.15, 0.9, 0.08, { px: 1.2, depth: 0.3, dark: 0.12 });
    }
    Q.fill((g) => g.rect(0, 0.0, 3.6, 0.18), { color: '#6f5e55', rough: 0.45, metal: 0.95 }, { alpha: 0.55, feather: 8 });   // straw / bronze temper near the hinge
    Q.fill((g) => g.rect(0, 0.55, 3.6, 0.4), { color: '#4a433e', rough: 0.58, metal: 0.8 }, { alpha: 0.4, feather: 8 });
    Q.fill((g) => g.rect(0, 0, 3.6, 0.05), { color: '#5d5853', rough: 0.5, metal: 0.8 });
    Q.noise({ alpha: 0.12, scale: 0.8, stretch: [1, 2] });
  }
}
