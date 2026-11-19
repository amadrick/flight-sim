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
//   gear: nose twin 0.28 m at z −6.3 with launch bar, mains 0.4 m at x ±1.6, z 0.6 (wheelbase 6.9, track 3.2).
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['hivis', 'lowvis'];

const SCHEMES = {
  hivis: {
    name: 'VF-169 "Sky Lancers" CAG bird (high visibility)', top: '#b4b7b2', under: '#ecede9', radome: '#c3c4bc', finish: 'semigloss',
    fin: '#151619', accent: '#e2ae22', mark: '#141518', code: 'AX', modex: '100', buno: '169021', sqn: 'VF-169', hivis: true, weather: 0.45,
    pilot: 'CDR R. "SPADE" MORROW', rio: 'LCDR T. "HAWG" OKAFOR',
  },
  lowvis: {
    name: 'VF-169 tactical paint scheme (low visibility, carrier-weathered)', top: '#6d757b', under: '#959ca1', radome: '#8f9493', finish: 'matte',
    fin: '#6d757b', accent: '#4f555a', mark: '#41464b', code: 'AX', modex: '112', buno: '169044', sqn: 'VF-169', hivis: false, weather: 1,
    pilot: 'LT J. "DOC" BRANNIGAN', rio: 'LT S. "MOOSE" ADEYEMI',
  },
};

// wing pivot and sweep range
const PIV = [3.2, 0.35, -1.0], SWEEP0 = 20, SWEEP1 = 68;
const T_SILL = 0.385;

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'hivis', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, paintF = F[SC.finish], lap = K.stopwatch();
  const seg = Math.max(32, Math.round(64 * detail / 4) * 4);

  // ---- atlas ------------------------------------------------------------------------------------------------------------
  const atlas = K.createAtlas({ size: atlasSize, base: paintF(SC.top) });
  const C = {
    fus: atlas.chart('fus', { type: 'unwrap', z: [-11.5, 7.6], girth: 4.7, vScale: 0.95, strips: 2, density: 1.3 }),
    nacR: atlas.chart('nacR', { type: 'unwrap', z: [-4.0, 6.6], girth: 4.5, vScale: 0.9, density: 1.15 }),
    nacL: atlas.chart('nacL', { type: 'unwrap', z: [-4.0, 6.6], girth: 4.5, vScale: 0.9, density: 1.15 }),
    gloveT: atlas.chart('gloveTop', { type: 'plan', x: [0.4, 3.5], z: [-4.7, 5.7], view: 'top', mirror: true, density: 0.9 }),
    gloveB: atlas.chart('gloveBot', { type: 'plan', x: [0.4, 3.5], z: [-4.7, 5.7], view: 'bottom', mirror: true, density: 0.55 }),
    wTR: atlas.chart('wingTopR', { type: 'plan', x: [2.2, 9.86], z: [-1.42, 3.42], view: 'top' }),
    wTL: atlas.chart('wingTopL', { type: 'plan', x: [-9.86, -2.2], z: [-1.42, 3.42], view: 'top' }),
    wBR: atlas.chart('wingBotR', { type: 'plan', x: [2.2, 9.86], z: [-1.42, 3.42], view: 'bottom', density: 0.65 }),
    wBL: atlas.chart('wingBotL', { type: 'plan', x: [-9.86, -2.2], z: [-1.42, 3.42], view: 'bottom', density: 0.65 }),
    sTR: atlas.chart('stabTopR', { type: 'plan', x: [2.05, 5.0], z: [3.5, 7.8], view: 'top', density: 0.75 }),
    sTL: atlas.chart('stabTopL', { type: 'plan', x: [-5.0, -2.05], z: [3.5, 7.8], view: 'top', density: 0.75 }),
    sB: atlas.chart('stabBot', { type: 'plan', x: [2.05, 5.0], z: [3.5, 7.8], view: 'bottom', mirror: true, density: 0.55 }),
    fRO: atlas.chart('finRO', { type: 'side', z: [0.85, 7.3], y: [0.4, 3.22], view: 'right', density: 0.85 }),
    fRI: atlas.chart('finRI', { type: 'side', z: [0.85, 7.3], y: [0.4, 3.22], view: 'left', density: 0.6 }),
    fLO: atlas.chart('finLO', { type: 'side', z: [0.85, 7.3], y: [0.4, 3.22], view: 'left', density: 0.85 }),
    fLI: atlas.chart('finLI', { type: 'side', z: [0.85, 7.3], y: [0.4, 3.22], view: 'right', density: 0.6 }),
    panel: atlas.chart('panel', { type: 'rect', w: 0.84, h: 0.4, density: 2.4 }),
    rio: atlas.chart('rio', { type: 'rect', w: 0.8, h: 0.44, density: 2.0 }),
    noz: atlas.chart('nozzle', { type: 'rect', w: 3.6, h: 0.95, density: 0.7 }),
  };
  atlas.pack();
  const sw = (k, f) => atlas.swatch(k, f);
  const U = {
    top: sw('top', paintF(SC.top)), under: sw('under', paintF(SC.under)), fin: sw('fin', paintF(SC.fin)),
    duct: sw('duct', F.semigloss('#c9cbc7')), dark: sw('dark', F.darkGrey), black: sw('black', F.black), exhaust: sw('exhaust', F.exhaust),
    heat: sw('heat', { color: '#7f7871', rough: 0.48, metal: 0.8 }), heat2: sw('heat2', { color: '#45403d', rough: 0.55, metal: 0.8 }),
    well: sw('well', F.gearWhite), interior: sw('interior', { color: '#3f4447', rough: 0.72, metal: 0 }), console: sw('console', { color: '#1d1f21', rough: 0.6, metal: 0 }),
    seat: sw('seat', { color: '#272a2c', rough: 0.7, metal: 0 }), cushion: sw('cushion', F.fabric), accent: sw('accent', { color: '#d6b21e', rough: 0.5, metal: 0 }),
    suit: sw('suit', { color: '#5a6047', rough: 0.9, metal: 0 }), helmet: sw('helmet', { color: SC.hivis ? '#e9e9e4' : '#8d9296', rough: 0.35, metal: 0 }),
    visor: sw('visor', { color: '#0a0b0d', rough: 0.05, metal: 0.4 }), glove: sw('glove', { color: '#3a3d33', rough: 0.9, metal: 0 }),
    frame: sw('frame', paintF(SC.top)), steel: sw('steel', F.steel), lens: sw('lens', F.lens), probe: sw('probe', F.bareMetal),
    aim9: sw('aim9', F.semigloss('#c8cbcc')), aim7: sw('aim7', F.semigloss('#e2e3e0')), seeker: sw('seeker', { color: '#1c1e20', rough: 0.15, metal: 0.3 }),
    pylon: sw('pylon', paintF(SC.under)), irst: sw('irst', { color: '#20262c', rough: 0.08, metal: 0.5 }), hook: sw('hook', { color: '#202224', rough: 0.45, metal: 0.4 }),
    hookShoe: sw('hookShoe', F.steel), radome: sw('radome', F.semigloss(SC.radome)), tyre: sw('tyre', F.rubber), fan: sw('fan', { color: '#5b5e60', rough: 0.4, metal: 0.9 }),
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
    [5.8, 0.545, -0.270, 0.505, 0.78, 0.82],
    [6.5, 0.475, -0.200, 0.470, 0.8, 0.84],
    [7.1, 0.395, -0.075, 0.440, 0.84, 0.86],
    [7.6, 0.300, 0.075, 0.355, 0.86, 0.86],
  ].map(r => { const yc = (r[1] + r[2]) / 2, h = (r[1] - r[2]) / 2; return { z: r[0], y: yc, w: r[3], top: h, bot: h, kTop: r[4], kBot: r[5] }; });
  const fus = K.loft({
    stations: FS, segments: seg, step: 0.12 / detail, chart: C.fus, capEnd: 'flat', capUV: U.dark,
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
  const glassFixed = canLoft([-7.65, -6.95], [0.25, 0.75], 0, [0, 0]);
  const glassMove = canLoft([-6.95, -3.95], [0.25, 0.75], 0, [0, 0]);
  // windscreen arch and the two posts of the three-piece windscreen
  const wsFrame = K.merge(canLoft([-7.0, -6.93], [0.25, 0.75], 0.006, U.frame), canLoft([-7.65, -6.95], [0.25, 0.25 + ct], 0.004, U.frame), canLoft([-7.65, -6.95], [0.75 - ct, 0.75], 0.004, U.frame));
  for (const t of [0.4, 0.6 - 1 / 80]) wsFrame.add(canLoft([-7.65, -6.95], [t, t + 1 / 80], 0.004, U.frame, 80));
  stat.add(wsFrame).add(wsFrame.clone().flip());
  const frameMove = K.merge(
    canLoft([-6.95, -3.95], [0.25, 0.25 + ct], 0.005, U.frame), canLoft([-6.95, -3.95], [0.75 - ct, 0.75], 0.005, U.frame),
    canLoft([-6.93, -6.86], [0.25, 0.75], 0.006, U.frame), canLoft([-5.93, -5.86], [0.25, 0.75], 0.005, U.frame), canLoft([-4.12, -3.95], [0.25, 0.75], 0.006, U.frame),
  );
  frameMove.add(frameMove.clone().flip());            // frames are seen from inside the cockpit too

  // ---- cockpit: tandem tubs, pilot + RIO, seats, panels, HUD, glareshield -----------------------------------------------------
  const eye = G.pilotEye, eyeR = [0, eye[1] + 0.15, eye[2] + 1.25];
  const tubX = 0.52;
  stat.add(K.tub({ x: tubX, y0: 0.12, y1: 0.8, z0: -7.55, z1: -4.0, uv: U.interior, taper: 0.85 }));
  {  // sill ledge closing the gap between the skin cut-out and the tub
    const zs = []; for (let z = -7.65; z <= -3.951; z += 0.15) zs.push(z); zs.push(-3.95);
    for (const sx of [1, -1]) {
      let prev = null;
      for (const z of zs) {
        const o = fus.at(z, sx > 0 ? T_SILL : 1 - T_SILL).p, a = stat.vert(o[0], o[1], z, -sx * 0.5, 0.86, 0, U.frame[0], U.frame[1]), b = stat.vert(sx * tubX * 0.92, Math.min(0.8, o[1] - 0.05), z, -sx * 0.5, 0.86, 0, U.frame[0], U.frame[1]);
        if (prev) { if (sx > 0) stat.quad(prev[0], a, b, prev[1]); else stat.quad(prev[0], prev[1], b, a); }
        prev = [a, b];
      }
    }
  }
  {  // glareshield / coaming over the pilot's panel
    const gs = K.prism([[-7.62, 0.6], [-7.62, 0.8], [-7.1, 0.875], [-7.06, 0.86], [-7.06, 0.6]], -0.46, 0.46, U.black);
    for (let i = 0; i < gs.p.length; i += 3) gs.p[i] *= 0.6 + 0.4 * Math.min(1, (gs.p[i + 2] + 7.62) / 0.58);
    stat.add(gs);
  }
  const panelQuad = (chart, z, x0, x1, y0, y1, w, h) => {
    const i0 = stat.vertexCount;
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) { const uv = chart.uv((x - x0) / (x1 - x0) * w, (y1 - y) / (y1 - y0) * h); stat.vert(x, y, z, 0, 0, 1, uv[0], uv[1]); }
    stat.quad(i0, i0 + 1, i0 + 2, i0 + 3);
  };
  panelQuad(C.panel, -7.055, -0.42, 0.42, 0.46, 0.86, 0.84, 0.4);           // pilot's instrument panel
  panelQuad(C.rio, -5.86, -0.4, 0.4, 0.58, 1.02, 0.8, 0.44);             // RIO's panel (TID) behind the pilot's seat
  stat.add(K.box(0.84, 0.42, 0.05, U.console).translate(0, 0.79, -5.84));  // RIO panel housing
  for (const z of [-6.45, -5.0]) for (const sx of [-1, 1]) stat.add(K.box(0.14, 0.1, 1.0, U.console).translate(sx * 0.4, 0.5, z));   // side consoles
  stat.add(K.box(0.2, 0.3, 0.3, U.console).translate(0, 0.32, -6.95));   // pedestal
  stat.add(K.stick({ base: [0, 0.32, -6.82], height: 0.3, uv: U.black, uvGrip: U.dark }));
  stat.add(K.box(0.07, 0.07, 0.14, U.dark).translate(-0.38, 0.6, -6.6));   // throttles
  for (const e of [eye, eyeR]) stat.add(K.ejectionSeat({ eye: e, recline: 16, width: 0.5, uv: { frame: U.seat, cushion: U.cushion, accent: U.accent } }));
  const hudParts = K.hud({ eye, dist: 0.5, width: 0.17, height: 0.15, drop: 0.04, uv: U.black });
  stat.add(hudParts.frame);
  const crewMesh = K.pilot({ eye, recline: 14, stick: [0.03, -0.55, -0.33], throttle: [-0.37, -0.42, -0.3], uv: { suit: U.suit, helmet: U.helmet, visor: U.visor, dark: U.dark, glove: U.glove } });
  crewMesh.add(K.pilot({ eye: eyeR, recline: 14, stick: [0.17, -0.56, -0.36], throttle: [-0.17, -0.56, -0.36], uv: { suit: U.suit, helmet: U.helmet, visor: U.visor, dark: U.dark, glove: U.glove } }));

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
    n.mesh.add(K.prism([[-3.8, 0.43], [-2.5, 0.02], [-2.45, 0.04], [-2.45, 0.44]], sx > 0 ? 1.5 - 0.46 : -1.5 - 0.46, sx > 0 ? 1.5 + 0.46 : -1.5 + 0.46, U.duct));
    // rake the lip (top forward), sweep it in plan (outer wall aft) and lean the box slightly outward; fades out by z −2.6
    const p = n.mesh.p;
    for (let i = 0; i < p.length; i += 3) {
      const z = p[i + 2]; if (z > -2.6) continue;
      const f = K.smooth01((-2.6 - z) / 1.3), dy = p[i + 1] + 0.2, dx = sx * p[i] - 1.5;
      p[i + 2] = z - 0.36 * dy * f + 0.27 * dx * f;
      p[i] += sx * 0.07 * dy * f;
    }
    stat.add(n.mesh);
    stat.add(K.well(n.patches.mlg, 0.42, U.well));
    nac[key] = n;
    // compressor face backdrop behind the fan
    stat.add(K.lathe([[0.47, -2.36], [0.47, -2.2], [0, -2.2]], { segments: 20, uv: U.black }).translate(sx * 1.47, -0.22, 0));
    // boundary-layer splitter plate standing off the fuselage side
    stat.add(K.prism([[-3.82, 0.36], [-2.2, 0.36], [-1.2, 0.2], [-1.2, -0.5], [-2.2, -0.75], [-3.65, -0.83]], sx * 0.955 - 0.012, sx * 0.955 + 0.012, U.top));
    // F110 jet pipe, turbine face and flame holder inside the nozzle
    const nc = [sx * 1.05, 0.1, 0];
    stat.add(K.lathe([[0.585, 6.62], [0.53, 5.8], [0.5, 5.3], [0, 5.3]], { segments: 24, uv: U.exhaust }).translate(nc[0], nc[1], 0));
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
  // stinger under the beaver tail (houses the arrestor hook)
  stat.add(K.loft({ stations: [{ z: 5.5, y: -0.12, w: 0.02, top: 0.02, bot: 0.02 }, { z: 6.0, y: -0.13, w: 0.09, top: 0.08, bot: 0.1 }, { z: 7.2, y: -0.07, w: 0.1, top: 0.1, bot: 0.12 }, { z: 7.68, y: -0.02, w: 0.05, top: 0.05, bot: 0.06 }], segments: 12, step: 0.3, uv: U.under, capEnd: 'flat', capUV: U.dark }).mesh);

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
  }

  // ---- stabilators ---------------------------------------------------------------------------------------------------------------
  const STAB_Y = 0.05, STAB_PZ = 5.3;
  const mkStab = (side) => K.wing({
    side, airfoil: K.biconvex(0.045), chordPts: Math.round(10 * detail), spanAxis: 'x', tip: 'flat', root: 'flat',
    stations: [{ x: 2.1, y: STAB_Y, z: 3.55, chord: 3.2, tc: 0.045 }, { x: 4.95, y: STAB_Y, z: 3.55 + 2.85 * Math.tan(47 * DEG), chord: 1.15, tc: 0.03 }],
    charts: { upper: side > 0 ? C.sTR : C.sTL, lower: C.sB },
  });
  const stab = { R: mkStab(1), L: mkStab(-1) };

  // ---- nozzles, afterburner glow, fans -------------------------------------------------------------------------------------------
  const nozMesh = G.engines.map(e => K.petalNozzle({ z0: 6.55, z1: 7.5, r0: 0.605, rClosed: 0.42, rOpen: 0.555, petals: 18, centre: [e.nozzle[0], e.nozzle[1], 0], uvOuter: U.heat, uvInner: U.heat2, thickness: 0.03, chart: C.noz }));
  const glowMesh = new K.Mesh();
  for (const e of G.engines) glowMesh.add(K.afterburnerGlow({ zDeep: 5.56, zExit: 7.35, rDeep: 0.48, rExit: 0.42, centre: [e.nozzle[0], e.nozzle[1], 0] }));
  const fanC = [[-1.47, -0.22, -2.4], [1.47, -0.22, -2.4]];
  const fanMesh = fanC.map(c => K.fan({ radius: 0.43, hub: 0.12, blades: 22, uvBlade: U.fan, uvSpinner: U.dark }).translate(c[0], c[1], c[2]));

  // ---- chin pod, probes, antennas, stores ------------------------------------------------------------------------------------------
  {  // F-14D twin chin pod (TCS + IRST side by side)
    const yb = fus.botAt(-8.6);
    stat.add(K.loft({ stations: [{ z: -9.15, y: yb + 0.02, w: 0.03, top: 0.02, bot: 0.02 }, { z: -8.95, y: yb - 0.04, w: 0.19, top: 0.07, bot: 0.09, kBot: 0.7 }, { z: -8.3, y: yb - 0.04, w: 0.21, top: 0.08, bot: 0.1, kBot: 0.7 }, { z: -7.95, y: yb + 0.02, w: 0.04, top: 0.03, bot: 0.03 }], segments: 16, step: 0.12, uv: U.under }).mesh);
    for (const sx of [-1, 1]) {
      stat.add(K.lathe([[0, -9.3], [0.055, -9.28], [0.078, -9.18, 1], [0.08, -8.9]], { segments: 14, uv: U.irst }).translate(sx * 0.095, yb - 0.075, 0));
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
  for (const sx of [-1, 1]) {
    // glove pylon: AIM-9 on the shoulder rail, AIM-7 below
    stat.add(K.prism([[-2.45, 0.22], [-0.3, 0.22], [-0.55, -0.12], [-2.15, -0.12]], sx * 2.7 - 0.06, sx * 2.7 + 0.06, U.pylon));
    stat.add(K.launchRail({ x: sx * 2.8, y: -0.03, z0: -2.15, z1: -0.65, w: 0.07, h: 0.08, uv: U.pylon }));
    stat.add(K.missile({ uvBody: U.aim9, uvNose: U.seeker, uvFin: U.aim9 }).translate(sx * 2.87, -0.06, -2.55));
    stat.add(K.missile({ length: 3.66, radius: 0.1, uvBody: U.aim7, uvNose: U.aim7, uvFin: U.aim7, wings: { z: 1.35, chord: 0.62, span: 0.32 }, canards: null }).rotateZ(0).translate(sx * 2.7, -0.25, -2.8));
    stat.add(K.prism([[-2.3, -0.12], [-0.9, -0.12], [-0.9, -0.15], [-2.3, -0.15]], sx * 2.7 - 0.03, sx * 2.7 + 0.03, U.dark));
  }
  for (const [x, z] of [[-0.3, -1.3], [0.3, 1.2]]) {   // AIM-7s semi-recessed in the tunnel between the nacelles
    const y = fus.botAt(z + 1.8) - 0.06;
    stat.add(K.missile({ length: 3.66, radius: 0.1, uvBody: U.aim7, uvNose: U.aim7, uvFin: U.aim7, wings: { z: 1.35, chord: 0.62, span: 0.32 }, canards: null }).translate(x, y, z));
  }

  // ---- wells / bays -----------------------------------------------------------------------------------------------------------
  const P = fus.patches, E = fus.edges;
  stat.add(K.well(K.merge(P.ngwR, P.ngwL), 0.62, U.well, [0, 1, 0]));
  for (const k of ['sbU', 'sbDR', 'sbDL']) stat.add(K.well(P[k], 0.12, U.well));

  // ---- paint + materials ----------------------------------------------------------------------------------------------------------
  lap('geometry');
  paint(atlas, { SC, C, fus, W, fins, glove, paintF });
  lap('paint');
  const mat = atlas.material(ctx, { envMapIntensity: 1 });
  lap('textures');
  rig.material('paint', mat, { shared: true });
  rig.disposables.push(atlas);
  rig.glass('canopy', K.glassMaterial(ctx, K.GLASS.clear));
  rig.glass('hud', K.glassMaterial(ctx, K.GLASS.hud));
  const glow = rig.material('glow', K.glowMaterial(), { shadow: false });
  rig.addStatic(stat, 'paint');
  rig.addStatic(glassFixed, 'canopy');
  rig.addStatic(hudParts.glass, 'hud');

  // ---- moving parts -----------------------------------------------------------------------------------------------------------
  const canopyNode = rig.node('canopy', { pivot: [0, 1.06, -3.98] });
  rig.part('canopyGlass', glassMove, { parent: canopyNode, key: 'canopy' });
  rig.part('canopyFrame', frameMove, { parent: canopyNode });
  const setCanopy = rig.hinge(canopyNode, [-1, 1.06, -3.98], [1, 1.06, -3.98], { ref: [0, 1.3, -6.9], toward: [0, 1, 0] });
  const crewNode = rig.part('crew', crewMesh, { pivot: eye });

  const drop = (ctrl, d, aft = 0) => { const u = ctrl.up, h = ctrl.hinge, o = [-u[0] * d, -u[1] * d, -u[2] * d + aft]; return { a: [h.a[0] + o[0], h.a[1] + o[1], h.a[2] + o[2]], b: [h.b[0] + o[0], h.b[1] + o[1], h.b[2] + o[2]] }; };
  const hingeOn = (name, mesh, line, ref, toward, parent) => { const node = rig.part(name, mesh, { pivot: line.a, parent }); return rig.hinge(node, line.a, line.b, { ref, toward }); };
  const DOWN = [0, -1, 0], UP = [0, 1, 0];
  const wingA = {};
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const piv = [sx * PIV[0], PIV[1], PIV[2]];
    const node = rig.node('wing' + key, { pivot: piv });
    const sweep = rig.hinge(node, piv, [piv[0], piv[1] + 1, piv[2]], { ref: [sx * 9.7, PIV[1], 1.4], toward: [0, 0, 1] });
    rig.part('wingPanel' + key, W[key].mesh, { parent: node });
    const c = W[key].controls;
    wingA[key] = {
      sweep,
      slat: hingeOn('slat' + key, c.slat.mesh, drop(c.slat, 0.3, 0.06), c.slat.ref, DOWN, node),
      flap: hingeOn('flap' + key, c.flap.mesh, drop(c.flap, 0.22, 0.04), c.flap.ref, DOWN, node),
      spoiler: hingeOn('spoiler' + key, c.spoiler.mesh, c.spoiler.hinge, c.spoiler.ref, UP, node),
      node,
    };
    const tip = W.R.at(9.73, 0.62, 'mid');
    rig.lamp('nav', [sx * (tip[0] + 0.04), tip[1], tip[2]], { color: sx > 0 ? [0.02, 1, 0.25] : [1, 0.04, 0.02], size: 0.035, squash: [0.8, 0.7, 1.6], parent: node });
    rig.lamp('formation', [sx * 7.6, PIV[1] + 0.03, wLE(7.6) + 0.7], { color: [0.75, 1, 0.55], size: 0.03, squash: [2.2, 0.3, 0.6], parent: node });
  }
  const rud = { R: rig.hingePart('rudderR', fins.R.controls.rudder, { toward: [1, 0, 0] }), L: rig.hingePart('rudderL', fins.L.controls.rudder, { toward: [1, 0, 0] }) };
  const mkStabPart = (key, sx) => {
    const a = [sx * 2.1, STAB_Y, STAB_PZ], b = [sx * 4.95, STAB_Y, STAB_PZ];
    const node = rig.part('stab' + key, stab[key].mesh, { pivot: a });
    return rig.hinge(node, a, b, { ref: [sx * 3.0, STAB_Y, 6.6], toward: UP });
  };
  const setStab = { R: mkStabPart('R', 1), L: mkStabPart('L', -1) };
  // speedbrakes: one dorsal panel, two ventral panels either side of the hook
  const sb = [];
  for (const [k, dir] of [['sbU', 1], ['sbDR', -1], ['sbDL', -1]]) {
    const e = E[k].zLo, node = rig.part('speedbrake' + k.slice(2), K.thicken(P[k], 0.02, U.well), { pivot: e[0] });
    sb.push(rig.hinge(node, e[0], e[1], { ref: K.centroid(P[k]), toward: [0, dir, 0] }));
  }
  const nozzles = nozMesh.map((m, i) => rig.part('nozzle' + i, m, { pivot: [G.engines[i].nozzle[0], G.engines[i].nozzle[1], 6.55] }));
  rig.part('abGlow', glowMesh, { key: 'glow' });
  const fans = fanMesh.map((m, i) => rig.part('fan' + i, m, { pivot: fanC[i] }));
  const HOOK = [0, -0.2, 4.95];
  const hookNode = rig.part('hook', K.arrestorHook({ pivot: HOOK, length: 2.45, radius: 0.04, uv: U.hook, uvShoe: U.hookShoe }), { pivot: HOOK });
  const setHook = rig.hinge(hookNode, [-1, HOOK[1], HOOK[2]], [1, HOOK[1], HOOK[2]], { ref: [0, HOOK[1], 7], toward: DOWN });

  // ---- landing gear ------------------------------------------------------------------------------------------------------------
  const gp = G.gear;
  const doorOf = (patch, edge, inner = U.well) => ({ mesh: K.thicken(patch, 0.02, inner), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  const launchBar = K.merge(
    K.tube([0, -1.2, -6.36], [0, -0.86, -6.72], 0.035, 0.03, { segments: 8, uv: U.well }),
    K.box(0.12, 0.05, 0.08, U.well).translate(0, -0.86, -6.73),
    K.tube([0, -1.08, -6.2], [0, -1.22, -5.96], 0.025, 0.025, { segments: 6, uv: U.well }),     // holdback fitting
  );
  K.buildGear(rig, atlas, {
    name: 'nose', index: 0, contact: gp[0].pos, wheels: [-0.19, 0.19], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.17, pivot: [0, -0.12, -6.14],
    stroke: 0.35, staticFrac: 0.32, strutR: 0.07, fork: 'axle', steer: true, links: 'rear', retract: { to: [0, -0.06, -7.45] }, window: [0.2, 0.88],
    brace: [0, -0.18, -6.95], extra: launchBar, uv: { tyre: U.tyre },
    doors: [{ name: 'noseDoorR', ...doorOf(P.ngwR, E.ngwR.tHi), open: 88 }, { name: 'noseDoorL', ...doorOf(P.ngwL, E.ngwL.tLo), open: 88 }],
    lamps: [{ kind: 'landing', pos: G.lights.landing, size: 0.05, color: [1, 0.96, 0.88] }, { kind: 'taxi', pos: [-0.09, -0.88, -6.38], size: 0.04, color: [1, 0.96, 0.88] }],
  });
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, off = 0.2, n = nac[key], edge = sx > 0 ? n.edges.mlg.tHi : n.edges.mlg.tLo;
    K.buildGear(rig, atlas, {
      name: 'main' + key, index: i, contact: [c[0] + sx * off, c[1], c[2]], wheels: [-sx * off], wheelRadius: gp[i].wheelRadius, wheelWidth: 0.28,
      pivot: [sx * 1.8, -0.4, 0.88], stroke: 0.45, staticFrac: 0.32, strutR: 0.075, fork: 'half', links: 'front',
      retract: { to: [sx * 1.48, -0.5, -0.1], twist: -sx * 90 }, window: [0.22, 0.9], brace: [sx * 1.86, -0.45, 0.05], uv: { tyre: U.tyre },
      doors: [{ name: 'mainDoor' + key, ...doorOf(n.patches.mlg, edge), open: 100 }],
    });
  }

  // ---- lamps ------------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.035 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.04 });
  rig.lamp('strobe', [-L.strobe[0], L.strobe[1], L.strobe[2]], { color: [1, 1, 1], size: 0.04 });
  rig.lamp('beacon', L.beacon, { color: [1, 0.05, 0.03], size: 0.06, squash: [1, 0.55, 1] });
  rig.lamp('beacon', [0, fus.botAt(-3.6) - 0.02, -3.6], { color: [1, 0.05, 0.03], size: 0.06, squash: [1, 0.55, 1] });
  for (const sx of [-1, 1]) {
    rig.lamp('nav', [sx * 2.02, glove.R.at(2.0, 0.08, 'mid')[1], gLE(2.0) + 0.25], { color: sx > 0 ? [0.02, 1, 0.25] : [1, 0.04, 0.02], size: 0.03 });   // glove position lights
    const fp = fus.at(-8.4, sx > 0 ? 0.27 : 0.73).p;
    rig.lamp('formation', [fp[0] + sx * 0.005, fp[1], fp[2]], { color: [0.75, 1, 0.55], size: 0.025, squash: [0.3, 0.5, 2.4] });
    rig.lamp('formation', [sx * (finRoot.x + 0.15), 1.42, 3.75], { color: [0.75, 1, 0.55], size: 0.025, squash: [0.3, 0.5, 2.4] });
  }

  // ---- animation --------------------------------------------------------------------------------------------------------------
  const fanAng = [0, 0];
  rig.onUpdate((S, dt) => {
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
    sb[0](sf.speedbrake * 60 * DEG); sb[1](sf.speedbrake * 55 * DEG); sb[2](sf.speedbrake * 55 * DEG);
    for (let i = 0; i < 2; i++) {
      const e = S.eng[i] || {};
      nozzles[i].morphTargetInfluences[0] = e.nozzle ?? 0;
      fanAng[i] = (fanAng[i] + (e.n1 || 0) * 30 * dt * (i ? 1 : -1)) % (Math.PI * 2);
      fans[i].quaternion.set(0, 0, Math.sin(fanAng[i] / 2), Math.cos(fanAng[i] / 2));
    }
    const e0 = S.eng[0] || {}, e1 = S.eng[1] || e0;
    K.abGlowColor(glow.color, (e1.afterburner || 0) > (e0.afterburner || 0) ? e1 : e0, S.night);
    setCanopy(sf.canopy * 30 * DEG);
    setHook(sf.hook * 38 * DEG);
    crewNode.visible = !rig.cameraInCockpit;
  });
  const visual = rig.build();
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- paint ---------------------------------------------------------------------------------------------------------------------
function paint(atlas, o) {
  const { SC, C, fus, W, fins, glove, paintF } = o, F = K.FINISH;
  const top = paintF(SC.top), under = paintF(SC.under), mark = SC.mark, lowVis = SC.hivis ? false : mark, WX = SC.weather;
  const slime = { color: '#c9cf8f', rough: 0.35, metal: 0 };
  const red = '#b0262a', yellow = '#d9b51f';
  const rnd = (() => { let a = 1407; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * k)))); return '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''); };
  const touchUp = (Q, n, a0, a1, b0, b1, sz) => {      // fresh touch-up paint patches (carrier maintenance)
    for (let i = 0; i < n; i++) {
      const a = a0 + rnd() * (a1 - a0), b = b0 + rnd() * (b1 - b0), w = sz[0] * (0.5 + rnd()), h = sz[1] * (0.5 + rnd());
      Q.fill((g) => g.rect(a, b, w, h), paintF(shade(SC.top, 0.93 + rnd() * 0.14)), { alpha: 0.55 + rnd() * 0.35 });
    }
  };

  // ================= centre fuselage (unwrap: z, t) =================
  const P = atlas.pen(C.fus);
  P.fill('all', top);
  P.band(-11.5, 7.6, -Infinity, (z) => (z < -8 ? 0.0 : -0.12), under, { feather: SC.hivis ? 1 : 4 });
  P.fill((g) => g.rect(-11.5, 0, 2.92, 1), F.semigloss(SC.radome));
  if (SC.hivis) {   // squadron radome stripe: black band with gold edges and a chevron on top
    for (const [z0, z1, c] of [[-8.58, -8.22, SC.fin], [-8.62, -8.58, SC.accent], [-8.22, -8.18, SC.accent]]) P.fill((g) => g.rect(z0, 0, z1 - z0, 1), F.gloss(c));
    P.fill([[-8.2, 0.42], [-7.75, 0.5], [-8.2, 0.58], [-8.05, 0.5]], F.gloss(SC.accent));
  }
  // anti-glare panel ahead of the windscreen
  P.fill([[-8.62, 0.455], [-7.65, 0.42], [-7.65, 0.58], [-8.62, 0.545]], F.matte(SC.hivis ? '#151619' : '#3b4045'));
  P.ring(-8.6, 0, 1, { px: 1.6, depth: 0.45, dark: 0.3 });
  // panel lines
  const frames = [-10.2, -9.4, -7.65, -6.95, -5.9, -3.95, -3.2, -2.4, -1.6, -0.8, 0, 0.8, 1.6, 2.4, 3.2, 4.0, 4.95, 5.0, 6.3, 6.9];
  for (const z of frames) if (z > -8.6) P.ring(z, 0, 1, { px: 1, depth: 0.4, dark: 0.11 });
  for (const yy of [0.15, 0.5]) P.yLine(-8.55, 6.4, yy, { px: 1, depth: 0.35, dark: 0.12 });
  for (const tt of [0.06, 0.15, 0.85, 0.94]) P.line([[-8.5, tt], [7.5, tt]], { px: 1, depth: 0.3, dark: 0.12 });
  P.line([[-3.9, 0.5], [7.6, 0.5]], { px: 1, depth: 0.3, dark: 0.11 }); P.line([[-8.6, 0], [7.6, 0]], { px: 1, depth: 0.3, dark: 0.11 });
  const acc = [[-8.0, 0.1, 0.45, 0.22], [-7.3, 0.05, 0.4, 0.18], [-6.4, 0.25, 0.55, 0.2], [-5.2, 0.2, 0.5, 0.18], [-4.4, 0.3, 0.6, 0.22], [-3.5, 0.55, 0.45, 0.2], [-2.0, 0.45, 0.7, 0.18]];
  for (const [z, y, w, h] of acc) P.decalOn(z, y, 'both', { layers: ['height', 'color'] }, (g, layer) => { g.strokeStyle = layer === 'height' ? 'rgba(0,0,0,0.5)' : 'rgba(10,12,14,0.28)'; g.lineWidth = 0.008; g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, 0.025); g.stroke(); });
  for (const z of frames) if (z > -3.9 && z < 6.3) { P.rivets(z + 0.03, 0.35, z + 0.03, 0.48, 0.007, { px: 1.1, depth: 0.15, dark: 0.04 }); P.rivets(z + 0.03, 0.52, z + 0.03, 0.65, 0.007, { px: 1.1, depth: 0.15, dark: 0.04 }); }
  // M61 gun bay (left side): port, vents and soot
  P.decalOn(-8.05, 0.02, 'L', { layers: ['color', 'height'] }, (g, layer) => {
    if (layer === 'height') { g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.ellipse(0, 0, 0.16, 0.05, 0, 0, Math.PI * 2); g.fill(); for (let i = 0; i < 5; i++) g.fillRect(0.3 + i * 0.1, -0.05, 0.05, 0.1); return; }
    g.fillStyle = '#18191a'; g.beginPath(); g.ellipse(0, 0, 0.16, 0.05, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2c2e30'; for (let i = 0; i < 5; i++) g.fillRect(0.3 + i * 0.1, -0.05, 0.05, 0.1);
    g.strokeStyle = 'rgba(10,12,14,0.35)'; g.lineWidth = 0.01; g.strokeRect(-0.3, -0.16, 1.3, 0.3);
  });
  P.streak(-8.0, 0.75 + 0.01, -6.4, 0.75 + 0.02, 0.02, { alpha: 0.35 + 0.25 * WX });
  // in-flight refuelling probe door (right side, ahead of the windscreen)
  P.decalOn(-8.2, 0.55, 'R', { layers: ['height', 'color'] }, (g, layer) => { g.strokeStyle = layer === 'height' ? 'rgba(0,0,0,0.55)' : 'rgba(10,12,14,0.3)'; g.lineWidth = 0.009; g.strokeRect(-0.5, -0.06, 1.0, 0.12); });
  // modex, crew names, rescue / ejection markings
  const modexCol = SC.hivis ? SC.mark : mark;
  P.textOn(SC.modex, -9.0, 0.1, 'both', 0.27, { color: modexCol, weight: 700 });
  P.textOn(SC.pilot, -6.5, 0.66, 'both', 0.035, { color: SC.hivis ? '#141518' : mark, weight: 700 });
  P.textOn(SC.rio, -5.25, 0.72, 'both', 0.035, { color: SC.hivis ? '#141518' : mark, weight: 700 });
  P.textOn('RESCUE', -7.6, 0.52, 'both', 0.04, { color: SC.hivis ? red : mark, weight: 700 });
  P.decalOn(-7.2, 0.4, 'both', (g) => { g.fillStyle = SC.hivis ? red : mark; g.beginPath(); g.moveTo(-0.07, 0.06); g.lineTo(0.07, 0.06); g.lineTo(0, -0.06); g.closePath(); g.fill(); });
  // formation strip lights and walkway on the spine
  P.decalOn(-8.4, 0.12, 'both', { layers: ['color', 'orm'] }, (g, layer) => { g.fillStyle = layer === 'orm' ? 'rgb(255,90,0)' : slime.color; g.fillRect(-0.3, -0.03, 0.6, 0.06); });
  P.fill((g) => g.rect(-3.9, 0.47, 3.4, 0.06), F.matte(SC.hivis ? '#2a2c2e' : '#5c6267'), { alpha: 0.8 });
  // weathering
  P.noise({ alpha: 0.06 + 0.04 * WX, scale: 2.2, stretch: [1.6, 1], rough: 0.06 });
  P.noise({ alpha: 0.04 + 0.03 * WX, scale: 0.7, mode: 'light' });
  for (let i = 0; i < Math.round(14 + 26 * WX); i++) { const z = -6 + rnd() * 12, t = (rnd() < 0.5 ? 0.02 : 0.88) + rnd() * 0.1; P.streak(z, t, z + 0.5 + rnd() * 1.4, t, 0.006 + rnd() * 0.012, { alpha: (0.08 + rnd() * 0.12) * (0.6 + WX) }); }
  if (WX > 0.7) { touchUp(P, 26, -7, 6, 0.3, 0.7, [0.25, 0.04]); P.noise({ alpha: 0.1, scale: 4.5, stretch: [2.5, 1], mode: 'dark', rough: 0.08 }); }
  P.fill((g) => g.rect(6.3, 0, 1.3, 1), { color: 'rgba(40,36,32,0.35)' }, { feather: 6 });
  for (const s of [0.3, 0.7]) P.streak(7.6, s, 5.8, s, 0.12, { alpha: 0.25 + 0.15 * WX });

  // ================= nacelles (unwrap: z, t). Outer side t = .25 (right) / .75 (left) =================
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const Q = atlas.pen(C['nac' + key]), T = (t) => (sx > 0 ? t : 1 - t), rot = sx > 0 ? 180 : 0, gir = 4.5;
    Q.fill('all', top);
    Q.fill([[-4.0, T(0)], [6.6, T(0)], [6.6, T(0.19)], [-4.0, T(0.205)]], under, { feather: SC.hivis ? 1 : 4 });
    Q.fill([[-4.0, T(0.81)], [6.6, T(0.81)], [6.6, T(1)], [-4.0, T(1)]], under, { feather: SC.hivis ? 1 : 4 });
    // panel lines
    for (const z of [-3.3, -2.2, -1.1, 1.3, 2.3, 3.4, 4.5, 5.5, 6.3]) Q.line([[z, 0], [z, 1]], { px: 1, depth: 0.4, dark: 0.12 });
    for (const t of [0.12, 0.25, 0.38]) Q.line([[-3.7, T(t)], [6.5, T(t)]], { px: 1, depth: 0.3, dark: 0.11 });
    Q.line([[6.48, 0], [6.48, 1]], { px: 1.5, depth: 0.6, dark: 0.3 });
    // intake warning: red DANGER chevron + text behind the lip
    const decal = (z, t, fn) => Q.decalT(z, T(t), { rot, girth: gir }, fn);
    decal(-3.15, 0.27, (g) => { g.fillStyle = red; g.beginPath(); g.moveTo(-0.12, -0.16); g.lineTo(0.05, 0); g.lineTo(-0.12, 0.16); g.lineTo(-0.07, 0.16); g.lineTo(0.1, 0); g.lineTo(-0.07, -0.16); g.closePath(); g.fill(); });
    decal(-2.75, 0.27, (g) => K.drawText(g, 'DANGER', 0.05, { color: red, weight: 700 }));
    decal(-2.75, 0.315, (g) => K.drawText(g, 'INTAKE', 0.04, { color: red, weight: 700 }));
    // national insignia on the intake side, NAVY + BuNo aft
    decal(-1.55, 0.255, (g) => K.drawStarBar(g, 0.5, { lowVis }));
    decal(2.85, 0.215, (g) => K.drawText(g, 'NAVY', 0.2, { color: mark, weight: 700, font: K.FONT.sans }));
    decal(2.85, 0.27, (g) => K.drawText(g, SC.buno, 0.08, { color: mark, weight: 700 }));
    if (SC.hivis) decal(0.6, 0.3, (g) => K.drawText(g, SC.sqn, 0.09, { color: SC.fin, weight: 700, italic: true }));
    decal(-0.6, 0.18, (g) => { g.fillStyle = slime.color; g.fillRect(-0.3, -0.025, 0.6, 0.05); });
    // weathering: exhaust soot on the aft nacelle, grime, leaks
    Q.noise({ alpha: 0.06 + 0.05 * WX, scale: 2.0, stretch: [1.6, 1], rough: 0.05 });
    Q.fill((g) => g.rect(5.4, 0, 1.2, 1), { color: 'rgba(38,34,30,0.45)' }, { feather: 8 });
    for (let i = 0; i < Math.round(8 + 18 * WX); i++) { const z = -2.5 + rnd() * 7, t = T(0.02 + rnd() * 0.17); Q.streak(z, t, z + 0.6 + rnd() * 1.2, t, 0.008 + rnd() * 0.01, { alpha: (0.1 + rnd() * 0.12) * (0.6 + WX) }); }
    if (WX > 0.7) { touchUp(Q, 12, -3, 5, Math.min(T(0.2), T(0.32)), Math.max(T(0.2), T(0.32)), [0.25, 0.03]); Q.noise({ alpha: 0.1, scale: 4, stretch: [2.5, 1], mode: 'dark', rough: 0.08 }); }
  }

  // ================= glove / overwing fairing (plan, mirrored: x, z) =================
  {
    const at = (x, f, s) => { const p = glove.R.at(x, f, s); return [p[0], p[2]]; };
    for (const [chart, isTop] of [[C.gloveT, true], [C.gloveB, false]]) {
      const Q = atlas.pen(chart);
      Q.fill('all', isTop ? top : under);
      for (const f of [0.08, 0.3, 0.55]) Q.line([at(0.6, f), at(3.25, f)], { px: 1, depth: 0.35, dark: 0.13 });
      for (const x of [1.2, 1.9, 2.6]) Q.line([at(x, 0.01), at(x, 0.98)], { px: 1, depth: 0.3, dark: 0.12 });
      Q.line([[3.12, -1.2], [3.12, 3.35], [2.3, 4.7]], { px: 2, depth: 0.7, dark: 0.45 });         // overwing fairing seal (wing slot)
      if (isTop) {
        // black non-skid walkways beside the canopy, outlined for the hi-vis scheme
        const wk = [[0.85, -3.6], [1.45, -3.6], [1.45, -1.2], [0.85, -1.2]];
        Q.fill(wk, F.matte(SC.hivis ? '#222426' : '#5a6065'), { alpha: 0.9 });
        if (SC.hivis) Q.stroke((g) => { wk.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); }, 0.025, F.gloss('#f2f2ee'));
        Q.text('NO STEP', 2.4, 1.6, 0.07, { color: SC.hivis ? '#2a2c2e' : mark, rot: 90 });
        Q.fill((g) => g.rect(2.2, -2.6, 0.06, 0.6), slime);
        if (SC.hivis) Q.fill([at(0.6, 0.0), at(3.25, 0.0), at(3.25, 0.03), at(0.6, 0.05)], F.gloss(SC.accent));
      }
      Q.wear((g) => { const a = at(0.7, 0.004), b = at(3.2, 0.004); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }, 0.03, { color: '#9a9ea2', rough: 0.4, metal: 0.6 }, { alpha: 0.2 + 0.25 * WX });
      Q.noise({ alpha: 0.06 + 0.05 * WX, scale: 1.4, stretch: [1, 2], rough: 0.06 });
      if (WX > 0.7 && isTop) { touchUp(Q, 14, 0.7, 3.0, -4, 3, [0.2, 0.3]); Q.noise({ alpha: 0.1, scale: 3, stretch: [1, 2.5], mode: 'dark', rough: 0.08 }); }
      if (!isTop) for (let i = 0; i < Math.round(6 + 10 * WX); i++) { const x = 1.9 + rnd() * 1.3, z = -2 + rnd() * 4; Q.streak(x, z, x, z + 0.8 + rnd(), 0.04, { alpha: 0.15 }); }
    }
  }

  // ================= movable wing panels (plan at 20° sweep) =================
  for (const key of ['R', 'L']) {
    const s = key === 'R' ? 1 : -1, wg = W.R;
    const at = (x, f) => { const p = wg.at(x, f); return [p[0], p[2]]; };
    for (const [chart, isTop] of [[key === 'R' ? C.wTR : C.wTL, true], [key === 'R' ? C.wBR : C.wBL, false]]) {
      const Q = atlas.pen(chart);
      const ln = (pts, op) => Q.line(pts.map(p => [p[0] * s, p[1]]), op);
      const poly = (pts) => pts.map(p => [p[0] * s, p[1]]);
      Q.fill('all', isTop ? top : under);
      if (SC.hivis) {
        // white flaps and slats, squadron-coloured wingtips
        Q.fill(poly([at(3.45, 0.7), at(8.75, 0.7), at(8.75, 1.02), at(3.45, 1.02)]), F.semigloss('#eeefeb'));
        if (isTop) Q.fill(poly([at(3.5, -0.02), at(9.5, -0.02), at(9.5, 0.15), at(3.5, 0.15)]), F.semigloss('#eeefeb'));
        if (isTop) { Q.fill(poly([at(9.0, -0.05), at(9.9, -0.05), at(9.9, 1.05), at(9.0, 1.05)]), F.gloss(SC.fin)); Q.fill(poly([at(8.9, -0.05), at(9.0, -0.05), at(9.0, 1.05), at(8.9, 1.05)]), F.gloss(SC.accent)); }
      }
      // spars, ribs and control-surface gaps
      for (const f of [0.28, 0.42, 0.6]) ln([at(3.3, f), at(9.6, f)], { px: 1, depth: 0.35, dark: 0.14 });
      for (const x of [4.2, 5.0, 5.8, 6.6, 7.4, 8.2, 9.0]) ln([at(x, 0.15), at(x, 0.7)], { px: 1, depth: 0.3, dark: 0.12 });
      ln([at(3.45, 1), at(3.45, 0.7), at(8.75, 0.7), at(8.75, 1)], { px: 2, depth: 0.8, dark: 0.5 });
      ln([at(6.1, 0.7), at(6.1, 1)], { px: 1.5, depth: 0.6, dark: 0.35 });
      ln([at(3.5, 0), at(3.5, 0.15), at(9.5, 0.15), at(9.5, 0)], { px: 2, depth: 0.8, dark: 0.5 });
      for (const x of [5.5, 7.5]) ln([at(x, 0), at(x, 0.15)], { px: 1.5, depth: 0.6, dark: 0.35 });
      if (isTop) {
        ln([at(3.55, 0.7), at(3.55, 0.5), at(7.1, 0.5), at(7.1, 0.7)], { px: 2, depth: 0.8, dark: 0.5 });
        for (const x of [4.44, 5.33, 6.22]) ln([at(x, 0.5), at(x, 0.7)], { px: 1.5, depth: 0.6, dark: 0.4 });
      }
      for (const f of [0.28, 0.42, 0.6]) { const a = at(3.4, f + 0.012), b = at(9.5, f + 0.012); Q.rivets(a[0] * s, a[1], b[0] * s, b[1], 0.03, { px: 1.1, depth: 0.15, dark: 0.04 }); }
      // leading-edge wear, tonal variation, hinge-line grime
      const le = poly([at(3.5, 0.004), at(9.6, 0.004)]);
      Q.wear((g) => { g.moveTo(le[0][0], le[0][1]); g.lineTo(le[1][0], le[1][1]); }, 0.035, { color: '#9a9ea2', rough: 0.4, metal: 0.6 }, { alpha: 0.2 + 0.3 * WX });
      Q.noise({ alpha: 0.06 + 0.05 * WX, scale: 1.2, stretch: [1, 2.5], rough: 0.06 });
      for (let i = 0; i < Math.round(5 + 9 * WX); i++) { const x = 3.6 + rnd() * 5, a = at(x, 0.7); Q.streak(a[0] * s, a[1], a[0] * s, a[1] + 0.3 + rnd() * 0.4, 0.03, { alpha: 0.12 + 0.1 * WX }); }
      if (WX > 0.7) { if (isTop) touchUp(Q, 10, s > 0 ? 3.6 : -9, s > 0 ? 9 : -3.6, -0.5, 2.5, [0.2, 0.25]); Q.noise({ alpha: 0.1, scale: 3, stretch: [1, 2.5], mode: 'dark', rough: 0.08 }); }
      // markings: insignia upper left / lower right, NAVY lower left, modex on the right flap
      const c = at(7.2, 0.4);
      if (isTop && key === 'L') Q.decal(-c[0], c[1], { rot: -20 }, (g) => K.drawStarBar(g, 0.75, { lowVis }));
      if (!isTop && key === 'R') Q.decal(c[0], c[1], { rot: 20 }, (g) => K.drawStarBar(g, 0.75, { lowVis }));
      if (!isTop && key === 'L') Q.text('NAVY', -c[0], c[1], 0.45, { color: mark, weight: 700, rot: 70 });
      if (isTop && key === 'R') { const m = at(5.0, 0.85); Q.text(SC.modex, m[0], m[1], 0.22, { color: SC.hivis ? '#141518' : mark, weight: 700, rot: 20 }); }
      if (isTop) { const p = at(5.2, 0.6); Q.text('NO STEP', p[0] * s, p[1], 0.05, { color: SC.hivis ? '#2a2c2e' : mark, rot: s * 20 }); }
    }
  }

  // ================= stabilators =================
  for (const [chart, isTop, sx] of [[C.sTR, true, 1], [C.sTL, true, -1], [C.sB, false, 1]]) {
    const Q = atlas.pen(chart); Q.fill('all', isTop ? top : under);
    if (SC.hivis && isTop) { Q.fill([[sx * 4.3, 3.5], [sx * 5.0, 3.5], [sx * 5.0, 7.8], [sx * 4.3, 7.8]], F.gloss(SC.fin)); Q.fill([[sx * 4.2, 3.5], [sx * 4.3, 3.5], [sx * 4.3, 7.8], [sx * 4.2, 7.8]], F.gloss(SC.accent)); }
    for (const x of [2.6, 3.2, 3.8, 4.4]) Q.line([[sx * x, 3.5], [sx * x, 7.8]], { px: 1, depth: 0.3, dark: 0.12 });
    for (const zz of [5.0, 6.0]) Q.line([[sx * 2.1, zz], [sx * 5.0, zz + 1.6]], { px: 1, depth: 0.3, dark: 0.12 });
    Q.noise({ alpha: 0.07 + 0.04 * WX, scale: 1.0, stretch: [1, 2], rough: 0.06 });
  }

  // ================= fins (side views: z, y) =================
  for (const [chart, key, outboard] of [[C.fRO, 'R', true], [C.fRI, 'R', false], [C.fLO, 'L', true], [C.fLI, 'L', false]]) {
    const Q = atlas.pen(chart), fn = fins.R;
    const at = (u, f) => { const p = fn.at(u, f); return [p[2], p[1]]; };
    const span = Math.hypot(...[0, 1].map(i => fn.at(10, 0)[i] - fn.at(0, 0)[i]));
    const hz = (u) => fn.lines.hinge.at(fn.spanToU(u));
    Q.fill('all', paintF(SC.fin));
    // squadron flash: a broad diagonal band from the fin root LE to the rudder top, pin-striped
    const band = (f0, f1) => [at(0.05, f0), at(0.05, f1), at(span + 0.1, f1 + 0.62), at(span + 0.1, f0 + 0.62)];
    if (SC.hivis) {
      Q.fill(band(-0.02, 0.2), F.gloss(SC.accent));
      for (const f of [-0.05, 0.23]) Q.fill(band(f, f + 0.018), F.gloss('#f2f2ee'));
      Q.fill([at(span - 0.12, 0), at(span + 0.1, 0), at(span + 0.1, 1.05), at(span - 0.12, 1.05)], F.gloss(SC.accent));
    } else {
      Q.stroke((g) => { const b = band(-0.02, 0.2); b.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); }, 0.025, F.matte(SC.accent));
    }
    Q.line([at(0.42, 1), at(0.42, hz(0.42)), at(span - 0.25, hz(span - 0.25)), at(span - 0.25, 1)], { px: 2, depth: 0.8, dark: 0.5 });
    for (const u of [0.6, 1.2, 1.8, 2.4]) Q.line([at(u, 0.02), at(u, hz(u))], { px: 1, depth: 0.3, dark: 0.12 });
    for (const f of [0.25, 0.48]) Q.line([at(0.05, f), at(span - 0.1, f)], { px: 1, depth: 0.3, dark: 0.12 });
    const tc = SC.hivis ? '#f2f2ee' : mark;
    const cc = at(1.55, 0.3);
    if (outboard || true) Q.text(SC.code, cc[0], cc[1], 0.62, { color: tc, weight: 700, font: K.FONT.sans });
    const sq = at(0.78, 0.3); Q.text(SC.sqn, sq[0], sq[1], 0.13, { color: tc, weight: 700, italic: true });
    const bn = at(0.3, 0.4); Q.text('NAVY ' + SC.buno, bn[0], bn[1], 0.06, { color: tc, weight: 700 });
    const fl = at(1.0, 0.1); Q.fill((g) => g.rect(fl[0] - 0.3, fl[1] - 0.03, 0.6, 0.06), slime);
    Q.noise({ alpha: 0.07 + 0.04 * WX, scale: 1.2, stretch: [1, 1.5], rough: 0.05 });
    void key;
  }

  // ================= nozzle petals (a = around, b = hinge → exit) =================
  {
    const Q = atlas.pen(C.noz), n = 18, w = 3.6 / n;
    Q.fill('all', { color: '#837b73', rough: 0.48, metal: 0.8 });
    for (let i = 0; i < n; i++) {
      if (i % 2) Q.fill((g) => g.rect(i * w, 0, w, 0.95), { color: '#766e67', rough: 0.55, metal: 0.8 });
      Q.fill((g) => g.rect(i * w + w * 0.32, 0.05, w * 0.36, 0.85), { color: '#91877e', rough: 0.45, metal: 0.8 }, { alpha: 0.55 });
      Q.line([[i * w, 0], [i * w, 0.95]], { px: 2, depth: 0.9, dark: 0.6 });
    }
    Q.fill((g) => g.rect(0, 0.6, 3.6, 0.35), { color: '#47403b', rough: 0.6, metal: 0.8 }, { alpha: 0.5, feather: 6 });
    Q.fill((g) => g.rect(0, 0, 3.6, 0.07), { color: '#5d5853', rough: 0.5, metal: 0.8 });
    Q.noise({ alpha: 0.12, scale: 0.8, stretch: [1, 2] });
  }

  // ================= instrument panels =================
  const scr = (Q, a, b, w, h, col) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#050607', rough: 0.15, metal: 0 }); Q.fill((g) => g.rect(a + 0.008, b + 0.008, w - 0.016, h - 0.016), { color: col, rough: 0.12, metal: 0, emissive: col }); };
  {
    const Q = atlas.pen(C.panel); Q.fill('all', { color: '#191b1d', rough: 0.6, metal: 0 });
    scr(Q, 0.08, 0.16, 0.17, 0.17, '#1a4a26'); scr(Q, 0.59, 0.16, 0.17, 0.17, '#1a4a26'); scr(Q, 0.33, 0.1, 0.18, 0.15, '#24421c');
    for (let i = 0; i < 6; i++) { const cx = 0.3 + (i % 3) * 0.12, cy = 0.3 + Math.floor(i / 3) * 0.05; Q.stroke((g) => g.arc(cx, cy, 0.022, 0, Math.PI * 2), 0.003, { color: '#9a9c9a' }); }
    for (let i = 0; i < 12; i++) Q.fill((g) => g.rect(0.12 + i * 0.05, 0.05, 0.03, 0.02), { color: i % 3 ? '#3a3c3e' : '#7a6a2a', rough: 0.5, metal: 0 });
  }
  {
    const Q = atlas.pen(C.rio); Q.fill('all', { color: '#191b1d', rough: 0.6, metal: 0 });
    Q.fill((g) => g.arc(0.4, 0.2, 0.15, 0, Math.PI * 2), { color: '#050607', rough: 0.15, metal: 0 });
    Q.fill((g) => g.arc(0.4, 0.2, 0.135, 0, Math.PI * 2), { color: '#10301a', rough: 0.12, metal: 0, emissive: '#10301a' });   // tactical information display
    scr(Q, 0.06, 0.08, 0.13, 0.13, '#0c2a14'); scr(Q, 0.61, 0.08, 0.13, 0.13, '#0c2a14');
    for (let i = 0; i < 14; i++) Q.fill((g) => g.rect(0.06 + i * 0.05, 0.38, 0.03, 0.02), { color: i % 4 ? '#3a3c3e' : '#7a6a2a', rough: 0.5, metal: 0 });
  }
}
