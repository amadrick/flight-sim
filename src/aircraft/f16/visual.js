// F-16C Block 50 Fighting Falcon — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (-1.55) when parked.
//
// Reference numbers (published + measured from three-views; z = d − 8.5 where d = distance aft of the pitot tip):
//   length 15.03 m (pitot −8.5 … nozzle exit 6.48 / stab tips 6.53), span 9.45 m over the launch rails, ≈ 10.0 m with AIM-120s,
//   height 5.09 m (fin tip); radome joint z −6.47 (radome ≈ 0.85 m base diameter), windscreen base z −5.72,
//   one-piece canopy −5.72 … canopy bow −2.92, opaque canopy fairing to −2.45 (the whole canopy hinges at its rear end);
//   pilot eye [0, 1.05, −4.45] on an ACES II seat reclined 30°; strake (LERX) edge at y 0 from z −6.1 curving out to meet the
//   40° wing leading edge at x 1.3; wing 27.87 m², NACA 64A204, LE root (x 0.95) z −1.92, TE z ≈ 2.28, −2.5° washout;
//   flaperons x 1.17 … 3.62, leading-edge flaps full span; stabilators 5.58 m span, 10° anhedral, pivot z 5.18;
//   fin root chord 3.1 m (LE z 2.2, y 0.8), tip y 3.33, rudder y 1.28 … 3.12; F110 nozzle centre y 0.13, exit z 6.48, r 0.40 … 0.555;
//   chin intake lip z −3.6, 1.0 m wide × 0.55 m, splitter plate y −0.27, nose gear behind it on the duct;
//   main gear track 2.36 m, wheelbase 4.0 m (geometry.js); main legs fold forward, wheels turn flat into the wells.
// Stores (opts.stores or ?stores=clean|a2a|combat; default per livery): wingtip LAU-129 + AIM-120, AIM-9X on stations 2/8,
//   370-gal tanks on 4/6, AN/ALQ-184 on the centreline, Sniper pod on the right chin station, HTS pod on the left.
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['usaf', 'aggressor', 'demo'];
export const LOADOUTS = ['clean', 'a2a', 'combat'];

// FS 36118 gunship grey / FS 36270 medium grey / FS 36375 light ghost grey ("Hill Gray II")
const SCHEMES = {
  usaf: {
    name: 'USAF Hill Gray II, 20th FW style', top: '#5a5f63', mid: '#7c8286', under: '#9da2a5', radome: '#868b8c', fin: '#7c8286',
    finish: 'matte', code: 'SW', serial: ['AF 93', '548'], band: '#1f3c78', band2: '#e0bf45', mark: '#3b3f43', stores: 'combat',
    crew: ['CAPT R. "BLAZE" KOVAC', 'SSGT D. MORALES'], weather: 1,
  },
  aggressor: {
    name: 'Aggressor "Flanker" blue', top: '#3e5d88', mid: '#7c9bbd', under: '#b9c6d1', radome: '#56677a', fin: '#b2c2d0',
    finish: 'semigloss', code: 'WA', serial: ['AF 86', '291'], band: '#b3262a', band2: '#151719', mark: '#1b2533', stores: 'a2a',
    crew: ['MAJ T. "VODKA" HALE', 'TSGT L. PARK'], weather: 0.7, flanker: ['#3e5d88', '#7c9bbd', '#b2c2d0', '#5f7fa6'],
  },
  demo: {
    name: 'Skyward Demo Team', top: '#f2f2ef', mid: '#f2f2ef', under: '#14244b', radome: '#14244b', fin: '#14244b',
    finish: 'gloss', code: '1', serial: ['AF 92', '3880'], band: '#c61d2b', band2: '#f2f2ef', mark: '#14244b', stores: 'clean',
    crew: ['LT COL A. REYES', 'MSGT J. OKAFOR'], weather: 0.25, demo: true, red: '#c61d2b', navy: '#14244b',
  },
};

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'usaf', SC = SCHEMES[livery];
  const reqLoad = opts.stores ?? ctx?.params?.raw?.stores, load = LOADOUTS.includes(reqLoad) ? reqLoad : SC.stores;
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const paintF = SC.finish === 'matte' ? (c) => ({ color: c, rough: 0.68, metal: 0.03 }) : F[SC.finish];
  const seg = Math.max(28, Math.round(72 * detail / 4) * 4);

  // ---- atlas ------------------------------------------------------------------------------------------------------------
  const atlas = K.createAtlas({ size: atlasSize, base: paintF(SC.mid) });
  const cFus = atlas.chart('fus', { type: 'unwrap', z: [-8.25, 5.65], girth: 5.8, vScale: 0.9, strips: 2, density: 1.1 });
  const cInt = atlas.chart('intake', { type: 'unwrap', z: [-3.75, -1.3], girth: 2.5, vScale: 0.8, density: 0.85 });
  const cWT = { R: atlas.chart('wingTopR', { type: 'plan', x: [0.9, 4.62], z: [-2.0, 2.4], view: 'top' }), L: atlas.chart('wingTopL', { type: 'plan', x: [-4.62, -0.9], z: [-2.0, 2.4], view: 'top' }) };
  const cWB = { R: atlas.chart('wingBotR', { type: 'plan', x: [0.9, 4.62], z: [-2.0, 2.4], view: 'bottom', density: 0.75 }), L: atlas.chart('wingBotL', { type: 'plan', x: [-4.62, -0.9], z: [-2.0, 2.4], view: 'bottom', density: 0.75 }) };
  const cST = { R: atlas.chart('stabTopR', { type: 'plan', x: [0.9, 2.85], z: [3.9, 6.45], view: 'top', density: 0.8 }), L: atlas.chart('stabTopL', { type: 'plan', x: [-2.85, -0.9], z: [3.9, 6.45], view: 'top', density: 0.8 }) };
  const cSB = atlas.chart('stabBot', { type: 'plan', x: [0.9, 2.85], z: [3.9, 6.45], view: 'bottom', mirror: true, density: 0.6 });
  const cFin = { L: atlas.chart('finL', { type: 'side', z: [2.1, 6.12], y: [0.75, 3.4], view: 'left' }), R: atlas.chart('finR', { type: 'side', z: [2.1, 6.12], y: [0.75, 3.4], view: 'right' }) };
  const cNoz = atlas.chart('nozzle', { type: 'rect', w: 3.5, h: 0.9, density: 0.8 });
  const cTank = load === 'combat' ? atlas.chart('tank', { type: 'rect', w: 2.1, h: 4.7, density: 0.45 }) : null;
  atlas.pack();
  const U = {
    under: atlas.swatch('under', paintF(SC.under)), mid: atlas.swatch('mid', paintF(SC.mid)), top: atlas.swatch('top', paintF(SC.top)), fin: atlas.swatch('finc', paintF(SC.fin)),
    duct: atlas.swatch('duct', F.gloss('#e2e3df')), ductDeep: atlas.swatch('ductDeep', { color: '#8d8f8c', rough: 0.4, metal: 0 }), dark: atlas.swatch('dark', F.darkGrey), black: atlas.swatch('black', F.black),
    exhaust: atlas.swatch('exhaust', F.exhaust), heat: atlas.swatch('heat', { color: '#8a8078', rough: 0.5, metal: 0.75 }), heat2: atlas.swatch('heat2', { color: '#4a4542', rough: 0.55, metal: 0.8 }), ti: atlas.swatch('ti', F.titanium),
    well: atlas.swatch('well', F.gearWhite), interior: atlas.swatch('interior', { color: '#40464a', rough: 0.7, metal: 0 }), console: atlas.swatch('console', { color: '#26292c', rough: 0.6, metal: 0 }),
    consoleLt: atlas.swatch('consoleLt', { color: '#3a3e41', rough: 0.55, metal: 0 }),
    seat: atlas.swatch('seat', { color: '#25282a', rough: 0.7, metal: 0 }), cushion: atlas.swatch('cushion', F.fabric), accent: atlas.swatch('accent', { color: '#d6b21e', rough: 0.5, metal: 0 }),
    suit: atlas.swatch('suit', { color: '#556048', rough: 0.9, metal: 0 }), helmet: atlas.swatch('helmet', { color: '#8d9296', rough: 0.35, metal: 0 }), visor: atlas.swatch('visor', { color: '#0a0b0d', rough: 0.05, metal: 0.4 }),
    glove: atlas.swatch('glove', { color: '#3a3d33', rough: 0.9, metal: 0 }), frame: atlas.swatch('frame', paintF(SC.demo ? SC.navy : '#45494d')), steel: atlas.swatch('steel', F.steel),
    aim: atlas.swatch('aim', F.semigloss('#c4c8ca')), aimNose: atlas.swatch('aimNose', { color: '#d9dad5', rough: 0.3, metal: 0 }), aim9Nose: atlas.swatch('aim9Nose', { color: '#1c1e20', rough: 0.15, metal: 0.3 }),
    rail: atlas.swatch('rail', paintF(SC.demo ? SC.top : SC.under)), lens: atlas.swatch('lens', F.lens), probe: atlas.swatch('probe', F.bareMetal),
    pylon: atlas.swatch('pylon', paintF(SC.demo ? SC.top : SC.under)), tank: atlas.swatch('tankc', paintF(SC.demo ? SC.top : SC.under)), pod: atlas.swatch('pod', paintF('#6b7074')),
    podWin: atlas.swatch('podWin', { color: '#2b2416', rough: 0.05, metal: 0.65 }), ecm: atlas.swatch('ecm', paintF('#8d9296')), radomeS: atlas.swatch('radomeS', F.semigloss(SC.radome)),
    gunPort: atlas.swatch('gunPort', { color: '#151617', rough: 0.8, metal: 0.2 }), ant: atlas.swatch('ant', paintF(SC.demo ? SC.top : '#6c7175')),
    coaming: atlas.swatch('coaming', { color: '#1e2023', rough: 0.75, metal: 0 }),
  };

  const rig = K.createRig(ctx, { geometry: G, name: 'f16', glassLayer: opts.glassLayer });

  // ---- fuselage: blended body; the strakes and the wing-body fillet are one chine ------------------------------------------
  // The side point sits on the strake/wing plane (y 0) from the wing root aft, and the upper surface leaves it at a shallow
  // angle (aTop) so the spine flows into the strakes and wings without a vertical fuselage side (the F-16 "blended" look).
  //        z      top     bot     w      chW   tu    tl    k     e     kTop          kBot  aTop  blend
  const FS = [
    [-8.22, 0.215, 0.215, 0.000, 0],
    [-8.14, 0.256, 0.176, 0.040, 0],
    [-7.90, 0.333, 0.103, 0.118, 0],
    [-7.50, 0.445, -0.004, 0.226, 0],
    [-7.00, 0.557, -0.096, 0.330, 0],
    [-6.50, 0.652, -0.160, 0.410, 0],
    [-6.10, 0.708, -0.186, 0.450, 0.455, 0.03, 0.03, 0.03, 0.9],
    [-5.75, 0.745, -0.200, 0.476, 0.505, 0.05, 0.04, 0.05, 0.9],
    [-5.30, 0.765, -0.210, 0.496, 0.565, 0.07, 0.05, 0.07, 0.9],
    [-4.80, 0.770, -0.218, 0.512, 0.625, 0.09, 0.06, 0.09, 0.9],
    [-4.20, 0.772, -0.226, 0.528, 0.700, 0.12, 0.07, 0.11, 0.95],
    [-3.60, 0.782, -0.235, 0.548, 0.790, 0.16, 0.08, 0.13, 1.0],
    [-3.00, 0.862, -0.250, 0.598, 0.890, 0.23, 0.10, 0.17, 1.1, [0.58, 0.6], 0.6, 90, 0],
    [-2.60, 0.990, -0.270, 0.650, 0.990, 0.36, 0.13, 0.24, 1.25, [0.5, 0.72], 0.62, 70, 0.45],
    [-2.20, 1.018, -0.480, 0.705, 1.110, 0.50, 0.18, 0.32, 1.35, [0.55, 0.82], 0.66, 68, 1],
    [-1.80, 1.012, -0.640, 0.745, 1.230, 0.62, 0.24, 0.4, 1.3, [0.62, 0.86], 0.70, 72, 1],
    [-1.00, 0.992, -0.700, 0.780, 1.290, 0.7, 0.26, 0.44, 1.25, [0.66, 0.88], 0.72, 75, 1],
    [0.00, 0.956, -0.688, 0.795, 1.290, 0.7, 0.26, 0.44, 1.25, [0.66, 0.88], 0.72, 75, 1],
    [1.50, 0.920, -0.643, 0.780, 1.240, 0.6, 0.26, 0.4, 1.3, [0.62, 0.84], 0.70, 72, 1],
    [2.30, 0.898, -0.612, 0.752, 1.120, 0.40, 0.25, 0.3, 1.45, [0.55, 0.74], 0.68, 72, 1],
    [3.00, 0.872, -0.572, 0.722, 1.080, 0.27, 0.23, 0.2, 1.55, [0.55, 0.62], 0.64, 72, 0.8],
    [4.00, 0.822, -0.522, 0.682, 1.040, 0.23, 0.22, 0.17, 1.6, 0.56, 0.6, 84, 0.45],
    [5.00, 0.762, -0.467, 0.632, 0.980, 0.21, 0.21, 0.15, 1.6, 0.5523, 0.5523, 90, 0.15],
    [5.60, 0.705, -0.440, 0.592, 0.950, 0.20, 0.20, 0.13, 1.6, 0.5523, 0.5523, 90, 0],
  ].map(r => {
    const yc = (r[1] + r[2]) / 2, h = (r[1] - r[2]) / 2, blend = r[12] ?? 0;
    const st = { z: r[0], y: yc, w: r[3], top: h, bot: h, kTop: r[9] ?? 0.5523, kBot: r[10] ?? 0.5523, aTop: r[11] ?? 90, sideY: -yc * blend };
    if (r[4] > 0) st.chine = { w: r[4], y: -yc, tu: r[5], tl: r[6], k: r[7], e: r[8] };
    return st;
  });
  const T_SILL = 0.375;
  const fus = K.loft({
    stations: FS, segments: seg, step: 0.1 / detail, chart: cFus, creases: ['side'], capEnd: 'flat', capUV: U.exhaust,
    cutouts: [
      { name: 'cockpit', z: [-5.72, -3.32], t: [T_SILL, 1 - T_SILL] },
      { name: 'mlg', z: [-0.78, 0.86], t: [0.045, 0.19], mirror: true },
    ],
  });
  cFus.body = fus;
  rig.material('paint', null);                        // placeholder; the atlas material is attached after painting
  const stat = new K.Mesh();                          // all static atlas geometry
  stat.add(fus.mesh);

  // ---- canopy: frameless one-piece transparency + opaque aft fairing, the whole unit hinges at its rear end ------------------
  const Z_BOW = -2.92, Z_CEND = -2.45;
  const canTop = K.pchip([-5.72, -5.55, -5.3, -5.0, -4.6, -4.2, -3.8, -3.4, -3.0, -2.7, -2.45], [0.742, 0.875, 1.04, 1.175, 1.285, 1.345, 1.35, 1.31, 1.21, 1.11, 1.022]);
  const canZ = [-5.72, -5.62, -5.48, -5.3, -5.05, -4.75, -4.4, -4.05, -3.7, -3.4, -3.32, -3.24, -3.05, Z_BOW, -2.8, -2.6, Z_CEND];
  const canSt = canZ.map(z => { const s = fus.at(z, T_SILL).p; return { z, y: s[1], w: s[0], top: Math.max(0.002, canTop(z) - s[1]), bot: 0.01, kTop: [0.7, 0.62] }; });
  const cseg = Math.max(20, Math.round(40 * detail / 4) * 4), ct = 1 / cseg;
  const canLoft = (zr, tr, inflate, uv) => K.loft({ stations: canSt, segments: cseg, step: 0.1, tRange: tr, zRange: zr, inflate, uv }).mesh;
  const glassMove = canLoft([-5.72, Z_BOW], [0.25, 0.75], 0, [0, 0]);
  const frameMove = K.merge(
    canLoft([-5.72, Z_BOW], [0.25, 0.25 + ct * 0.45], 0.004, U.top), canLoft([-5.72, Z_BOW], [0.75 - ct * 0.45, 0.75], 0.004, U.top),   // sill rails
    canLoft([Z_BOW - 0.05, Z_BOW + 0.03], [0.25, 0.75], 0.008, U.top),                                                                   // canopy bow
    canLoft([Z_BOW + 0.03, Z_CEND], [0.25, 0.75], 0.003, U.top),                                                                           // opaque aft fairing
    canLoft([-5.72, -5.69], [0.25, 0.75], 0.004, U.frame),
  );
  // inside of the canopy: mirror arch and canopy actuator fairing behind the seat
  frameMove.add(K.box(0.5, 0.025, 0.03, U.dark).translate(0, 1.27, -3.55));
  for (const sx of [1, -1]) frameMove.add(K.box(0.07, 0.03, 0.025, U.dark).translate(sx * 0.17, 1.24, -3.56));

  // ---- cockpit -----------------------------------------------------------------------------------------------------------
  const eye = G.pilotEye;
  const tubX = 0.4;
  stat.add(K.tub({ x: tubX, y0: -0.1, y1: 0.52, z0: -5.6, z1: -3.3, uv: U.interior, taper: 0.9 }));
  {  // sill ledge closing the gap between the skin cut-out and the tub
    const zs = []; for (let z = -5.72; z <= -3.319; z += 0.2) zs.push(z); zs.push(-3.32);
    for (const sx of [1, -1]) {
      let prev = null;
      for (const z of zs) {
        const o = fus.at(z, sx > 0 ? T_SILL : 1 - T_SILL).p, a = stat.vert(o[0], o[1], z, -sx * 0.6, 0.8, 0, U.consoleLt[0], U.consoleLt[1]), b = stat.vert(sx * tubX * 0.92, 0.5, z, -sx * 0.6, 0.8, 0, U.consoleLt[0], U.consoleLt[1]);
        if (prev) { if (sx > 0) stat.quad(prev[0], a, b, prev[1]); else stat.quad(prev[0], prev[1], b, a); }
        prev = [a, b];
      }
    }
  }
  // instrument panel: kit panel (two MFDs, up-front display under the HUD, standby, caution lights) and its glareshield,
  // kept low (top ≈ 0.8) — the F-16 pilot sees over the nose
  const panelMesh = K.instrumentPanel({ eye, kind: 'fighter', dist: 0.64, drop: 0.54, height: 0.42, width: 0.66, pages: ['mfdRadar', 'mfdHsd'], uv: U.console, uvPad: U.coaming });
  stat.add(panelMesh);
  {  // pedestal + side consoles
    stat.add(K.box(0.22, 0.3, 0.45, U.console).translate(0, 0.06, -4.86));
    for (const sx of [-1, 1]) {
      stat.add(K.box(0.15, 0.1, 1.45, U.console).translate(sx * 0.31, 0.36, -4.45));
      for (let i = 0; i < 6; i++) stat.add(K.box(0.11, 0.008, 0.16, i % 2 ? U.consoleLt : U.dark).translate(sx * 0.31, 0.413, -5.0 + i * 0.2));   // console panels
    }
    stat.add(K.stick({ base: [0.31, 0.415, -4.72], height: 0.12, uv: U.black, uvGrip: U.dark }));          // side-stick
    stat.add(K.box(0.05, 0.03, 0.12, U.consoleLt).translate(0.31, 0.43, -4.62));                            // arm rest
    stat.add(K.box(0.06, 0.09, 0.1, U.dark).translate(-0.31, 0.46, -4.78));                                 // throttle grip
    stat.add(K.box(0.025, 0.05, 0.25, U.console).translate(-0.31, 0.43, -4.8));
  }
  stat.add(K.ejectionSeat({ eye, recline: 30, uv: { frame: U.seat, cushion: U.cushion, accent: U.accent } }));
  const hudParts = K.hud({ eye, dist: 0.58, width: 0.17, height: 0.14, drop: 0.035, uv: U.coaming });
  stat.add(hudParts.frame);
  const pilotMesh = K.pilot({ eye, recline: 26, stick: [0.31, -0.55, -0.27], throttle: [-0.31, -0.56, -0.33], uv: { suit: U.suit, helmet: U.helmet, visor: U.visor, dark: U.dark, glove: U.glove } });

  // ---- intake (one skin: duct → lip → outer cowl, lower lip raked forward), splitter plate, diverter -------------------------
  const IS = (z, yc, w, top, bot, extra) => ({ z, y: yc, w, top, bot, kTop: 0.88, kBot: 0.62, ...extra });
  const intake = K.loft({
    stations: [
      IS(-1.3, -0.27, 0.40, 0.24, 0.31), IS(-2.6, -0.39, 0.45, 0.13, 0.32), IS(-3.40, -0.425, 0.463, 0.12, 0.318, { hard: true }),
      IS(-3.575, -0.425, 0.482, 0.133, 0.336), IS(-3.6, -0.425, 0.5, 0.15, 0.352), IS(-3.575, -0.425, 0.518, 0.166, 0.368),
      IS(-3.3, -0.425, 0.545, 0.175, 0.38), IS(-2.6, -0.42, 0.60, 0.22, 0.37), IS(-1.9, -0.36, 0.69, 0.3, 0.385), IS(-1.45, -0.3, 0.73, 0.3, 0.395), IS(-1.0, -0.3, 0.68, 0.26, 0.37),
    ],
    segments: Math.max(28, Math.round(44 * detail / 4) * 4), step: 0.14, capStart: 'flat', capUV: U.black,
    uvFn: (x, y, z, t, ring) => (ring.run === 0 ? (z > -2.3 ? U.ductDeep : U.duct) : cInt.uvUnwrap(z, t)),
    cutouts: [{ name: 'ng', z: [-3.44, -2.46], t: [0, 0.075], mirror: true }],
  });
  const rake = (m) => { for (let i = 0; i < m.p.length; i += 3) { const z = m.p[i + 2], f = Math.min(1, Math.max(0, (-3.25 - z) / 0.35)); m.p[i + 2] = z - Math.max(0, -0.27 - m.p[i + 1]) * 0.16 * f; } return m; };
  rake(intake.mesh); for (const k in intake.patches) rake(intake.patches[k]);
  cInt.body = intake;
  stat.add(intake.mesh);
  stat.add(K.prism([[-3.9, -0.266], [-3.62, -0.26], [-3.3, -0.26], [-3.3, -0.283], [-3.62, -0.283], [-3.9, -0.274]], -0.47, 0.47, U.under));   // splitter plate
  stat.add(K.prism([[-3.62, -0.262], [-3.05, -0.228], [-3.05, -0.272]], -0.03, 0.03, U.under));                                              // diverter wedge (centre)
  for (const sx of [-1, 1]) stat.add(K.prism([[-3.5, -0.262], [-3.05, -0.24], [-3.05, -0.273]], sx * 0.3 - 0.015, sx * 0.3 + 0.015, U.under));
  {  // engine face deep in the S-duct (only its glint is visible from ahead)
    const fan = K.fan({ radius: 0.3, hub: 0.1, blades: 22, uvBlade: U.ti, uvSpinner: U.dark });
    stat.add(fan.scale(1.25, 0.95, 1).translate(0, -0.29, -1.36));
  }

  // ---- wings ------------------------------------------------------------------------------------------------------------
  const zLE = (x) => -2.72 + x * Math.tan(40 * DEG), zTE = (x) => 2.31 - 0.0271 * x;
  const mkWing = (side) => K.wing({
    side, airfoil: K.naca6(0.04, 0.004), chordPts: Math.round(14 * detail), spanAxis: 'x', tip: 'flat',
    stations: [
      { x: 0.95, y: 0, z: zLE(0.95), chord: zTE(0.95) - zLE(0.95), tc: 0.042, twist: 0 },
      { x: 2.6, y: 0, z: zLE(2.6), chord: zTE(2.6) - zLE(2.6), tc: 0.041, twist: -1.2 },
      { x: 4.572, y: 0, z: zLE(4.572), chord: zTE(4.572) - zLE(4.572), tc: 0.04, twist: -2.5 },
    ],
    lines: { hingeTE: [[1.17, 0.805], [3.62, 0.745], [4.572, 0.745]], hingeLE: [[1.17, 0.13], [4.572, 0.265]] },
    controls: [
      { name: 'flaperon', type: 'flap', span: [1.17, 3.62], from: 'hingeTE', nose: 1 },
      { name: 'lef', type: 'flap', span: [1.17, 4.572], to: 'hingeLE', tail: 1 },
    ],
    charts: { upper: side > 0 ? cWT.R : cWT.L, lower: side > 0 ? cWB.R : cWB.L },
  });
  const W = { R: mkWing(1), L: mkWing(-1) };
  stat.add(W.R.mesh).add(W.L.mesh);

  // ---- tail surfaces -------------------------------------------------------------------------------------------------------
  const stabY = (x) => -0.02 - (x - 0.96) * Math.tan(10 * DEG);
  const mkStab = (side) => K.wing({
    side, airfoil: K.biconvex(0.05), chordPts: Math.round(9 * detail), spanAxis: 'x', tip: 'flat', root: 'flat',
    stations: [{ x: 0.9, y: stabY(0.9), z: 3.93, chord: 2.37, tc: 0.06 }, { x: 2.79, y: stabY(2.79), z: 5.516, chord: 0.864, tc: 0.035 }],
    charts: { upper: side > 0 ? cST.R : cST.L, lower: cSB },
  });
  const stab = { R: mkStab(1), L: mkStab(-1) };
  const fin = K.wing({
    airfoil: K.biconvex(0.05), chordPts: Math.round(10 * detail), spanAxis: 'y', tip: 'flat',
    stations: [{ x: 0, y: 0.80, z: 2.20, chord: 3.10, tc: 0.055 }, { x: 0, y: 3.33, z: 4.96, chord: 1.08, tc: 0.032 }],
    lines: { hinge: [[1.28, 0.775], [3.12, 0.62]] },
    controls: [{ name: 'rudder', type: 'flap', span: [1.28, 3.12], from: 'hinge', nose: 1 }],
    charts: { upper: cFin.L, lower: cFin.R },
  });
  stat.add(fin.mesh);
  // dorsal fin fillet + extended base fairing (Block 50: ECM / drag-chute housing) running aft over the nozzle
  stat.add(K.loft({
    stations: [{ z: 0.9, y: 0.86, w: 0.01, top: 0.01, bot: 0.03 }, { z: 1.7, y: 0.875, w: 0.07, top: 0.06, bot: 0.1 }, { z: 2.6, y: 0.89, w: 0.105, top: 0.13, bot: 0.17 },
      { z: 3.8, y: 0.92, w: 0.125, top: 0.17, bot: 0.24 }, { z: 5.0, y: 0.95, w: 0.13, top: 0.18, bot: 0.3 }, { z: 5.7, y: 0.97, w: 0.12, top: 0.16, bot: 0.27 },
      { z: 6.08, y: 0.99, w: 0.095, top: 0.12, bot: 0.17 }, { z: 6.14, y: 0.99, w: 0.08, top: 0.1, bot: 0.12 }],
    segments: 20, step: 0.25, uv: U.fin, capEnd: 'flat', capUV: U.dark,
  }).mesh);
  for (const sx of [1, -1]) {  // ventral fins, canted 15° outward
    stat.add(K.wing({ side: sx, airfoil: K.biconvex(0.045), chordPts: 6, spanAxis: 'u', tip: 'flat', uv: U.under, edgeUV: U.under,
      stations: [{ x: 0.5, y: -0.36, z: 3.45, chord: 1.55, tc: 0.045 }, { x: 0.5 + 0.62 * Math.sin(15 * DEG), y: -0.36 - 0.62 * Math.cos(15 * DEG), z: 3.98, chord: 0.86, tc: 0.04 }] }).mesh);
  }

  // ---- nozzle, afterburner interior, speedbrakes ----------------------------------------------------------------------------
  const NZ = { c: [0, 0.133, 0], z0: 5.6, z1: 6.48 };
  const nozzleMesh = K.petalNozzle({ z0: NZ.z0, z1: NZ.z1, r0: 0.588, rClosed: 0.395, rOpen: 0.555, petals: 15, centre: NZ.c, uvOuter: U.heat, uvInner: U.heat2, thickness: 0.03, chart: cNoz });
  stat.add(K.lathe([[0.6, 5.52], [0.605, 5.58, 1], [0.59, 5.66, 1], [0.58, 5.52]], { segments: 30, uv: U.ti }).translate(0, NZ.c[1], 0));          // sync ring
  stat.add(K.lathe([[0.56, 5.62], [0.52, 5.2], [0.5, 4.6], [0, 4.6]], { segments: 26, uv: U.exhaust }).translate(0, NZ.c[1], 0));                  // liner + turbine face
  stat.add(K.lathe([[0, 4.62], [0.12, 4.64], [0.14, 4.75, 1], [0.05, 4.95], [0, 4.98]], { segments: 14, uv: U.heat2 }).translate(0, NZ.c[1], 0));  // tail cone
  for (let i = 0; i < 12; i++) stat.add(K.box(0.025, 0.36, 0.05, U.heat2).translate(0, 0.32, 0).rotateZ(i * Math.PI / 6).translate(0, NZ.c[1], 4.82));   // flame-holder spokes
  for (const r of [0.22, 0.36]) stat.add(K.lathe([[r, 4.78], [r, 4.86], [r - 0.03, 4.86], [r - 0.03, 4.78]], { segments: 22, uv: U.heat2 }).translate(0, NZ.c[1], 0));
  const glowMesh = K.afterburnerGlow({ zDeep: 4.86, zExit: 6.3, rDeep: 0.48, rExit: 0.4, centre: NZ.c });
  const sbMesh = (sx, sy) => K.prism([[5.6, 0], [5.6, sy * 0.115], [5.95, sy * 0.1], [6.3, sy * 0.014], [6.3, 0]], sx > 0 ? 0.625 : -0.975, sx > 0 ? 0.975 : -0.625, sy > 0 ? U.top : U.under);

  // ---- probes, antennas, gun, small details ----------------------------------------------------------------------------------
  stat.add(K.probe([0, 0.215, -8.2], [0, 0.215, -8.55], 0.018, U.probe));                                                   // nose pitot boom
  for (const sx of [1, -1]) {
    const a = fus.at(-7.05, sx > 0 ? 0.31 : 0.69).p; stat.add(K.probe(a, [a[0] + sx * 0.05, a[1] + 0.005, a[2] - 0.17], 0.011, U.probe));   // AoA vanes
    const b = fus.at(-7.6, sx > 0 ? 0.2 : 0.8).p; stat.add(K.probe(b, [b[0] + sx * 0.035, b[1] - 0.01, b[2] - 0.1], 0.008, U.probe));       // total temperature probes
  }
  for (let i = 0; i < 4; i++) {   // AN/APX-113 IFF "bird slicer" blades ahead of the windscreen
    const x = (i - 1.5) * 0.105, z = -6.12;
    stat.add(K.bladeAntenna({ pos: [x, fus.topAt(z) - 0.012 - Math.abs(x) * 0.12, z], height: 0.07, chord: 0.055, sweep: 0.035, thickness: 0.005, uv: U.dark }));
  }
  stat.add(K.bladeAntenna({ pos: [0, fus.topAt(-1.15) - 0.015, -1.15], height: 0.2, chord: 0.28, sweep: 0.16, thickness: 0.014, uv: U.ant }));   // UHF/IFF upper
  stat.add(K.bladeAntenna({ pos: [0, -0.73, -2.15], height: 0.19, chord: 0.25, sweep: 0.13, down: true, thickness: 0.014, uv: U.under }));       // UHF lower
  stat.add(K.bladeAntenna({ pos: [0, fus.botAt(1.6) + 0.01, 1.6], height: 0.1, chord: 0.15, sweep: 0.06, down: true, thickness: 0.012, uv: U.under }));
  {  // M61A1 muzzle port and gas purge louvres in the left strake root
    const tg = 1 - fus.tAtY(-3.62, 0.24), g0 = fus.at(-3.7, tg).p;
    stat.add(K.ellipsoid(0.05, 0.03, 0.15, { segments: 10, rings: 5, uv: U.gunPort }).translate(g0[0] + 0.01, g0[1] + 0.004, g0[2]));
    for (let i = 0; i < 4; i++) { const p = fus.at(-3.42 + i * 0.08, tg).p; stat.add(K.box(0.015, 0.012, 0.045, U.gunPort).translate(p[0] + 0.004, p[1] + 0.006, p[2])); }
  }
  // air-refuelling receptacle door on the spine (a slipway recessed into the paint is painted; the door seam is modelled)
  stat.add(K.box(0.24, 0.006, 0.42, U.top).translate(0, fus.topAt(-1.65) + 0.0025, -1.65));
  // chaff / flare dispensers under the aft fuselage, either side of the ventral fins
  for (const sx of [1, -1]) { const p = fus.at(3.3, sx > 0 ? 0.08 : 0.92).p; stat.add(K.box(0.18, 0.025, 0.42, U.dark).translate(p[0], p[1] + 0.008, 3.3)); }
  // static dischargers: wing tips, flaperons, stabilator tips, fin tip
  {
    const wp = [];
    for (const sx of [1, -1]) {
      for (const x of [3.3, 4.3]) { const p = W.R.at(x, 0.99, 'mid'); wp.push([sx * p[0], p[1], p[2]]); }
      wp.push([sx * 2.6, stabY(2.6), 5.62], [sx * 2.2, stabY(2.2), 5.92]);
    }
    wp.push([0, 3.25, 5.65], [0, 3.05, 5.55]);
    stat.add(K.staticWicks(wp, 0.13, U.dark));
  }

  // ---- stores ------------------------------------------------------------------------------------------------------------
  const aim120 = () => K.missile({ length: 3.65, radius: 0.089, canards: { z: 1.32, chord: 0.3, span: 0.135 }, wings: { z: 3.25, chord: 0.36, span: 0.16 }, uvBody: U.aim, uvNose: U.aimNose, uvFin: U.aim });
  const aim9x = () => K.missile({ length: 3.02, radius: 0.064, canards: { z: 0.3, chord: 0.07, span: 0.035 }, wings: { z: 2.62, chord: 0.3, span: 0.1 }, uvBody: U.aim, uvNose: U.aim9Nose, uvFin: U.aim });
  const aim9m = () => K.missile({ uvBody: U.aim, uvNose: U.aim9Nose, uvFin: U.aim });
  for (const sx of [1, -1]) {   // LAU-129 wingtip launchers (always fitted)
    stat.add(K.launchRail({ x: sx * 4.66, y: -0.005, z0: 0.12, z1: 2.55, w: 0.1, h: 0.12, uv: U.rail }));
    stat.add(K.prism([[0.2, 0.0], [2.4, 0.0], [2.3, -0.06], [0.35, -0.06]], sx * 4.6 - 0.02, sx * 4.6 + 0.02, U.rail));
  }
  if (load !== 'clean') {
    for (const sx of [1, -1]) {
      if (load === 'a2a' && sx < 0) {   // ACMI pod on the left tip, captive AIM-9M on the right
        stat.add(K.tank({ length: 2.8, radius: 0.065, nose: 0.12, tail: 0.1, uv: U.aim, fins: 4, finRoll: 45 }).translate(sx * 4.735, -0.11, -0.2));
        stat.add(K.probe([sx * 4.735, -0.11, -0.2], [sx * 4.735, -0.11, -0.45], 0.01, U.probe));
      } else stat.add((load === 'a2a' ? aim9m() : aim120()).translate(sx * 4.735, -0.115, load === 'a2a' ? -0.25 : -0.6));
    }
  }
  if (load === 'combat') {
    const lowerY = (x, f) => W.R.at(x, f, 'lower')[1];
    for (const sx of [1, -1]) {
      // stations 2 / 8: AIM-9X on a LAU-129 under a short pylon
      { const x = 3.55, zf = zLE(x) + 0.32, yl = lowerY(x, 0.4);
        stat.add(K.pylon([{ y: yl - 0.15, z0: zf + 0.2, z1: zf + 1.55, x: sx * x, tc: 0.08 }, { y: yl + 0.03, z0: zf, z1: zf + 1.7, x: sx * x, tc: 0.08 }], { uv: U.pylon }));
        stat.add(K.launchRail({ x: sx * x, y: yl - 0.19, z0: zf - 0.1, z1: zf + 1.95, w: 0.07, h: 0.08, uv: U.rail }));
        stat.add(aim9x().translate(sx * x, yl - 0.3, zf - 0.45)); }
      // stations 4 / 6: 370-gal tanks with sway braces
      { const x = 2.05, zf = zLE(x) + 0.55, yl = lowerY(x, 0.45), yt = yl - 0.36, rT = 0.33, Lt = 4.6;
        stat.add(K.pylon([{ y: yt, z0: zf + 0.3, z1: zf + 2.1, x: sx * x, tc: 0.09 }, { y: yl + 0.04, z0: zf, z1: zf + 2.35, x: sx * x, tc: 0.09 }], { uv: U.pylon }));
        const tk = K.tank({ length: Lt, radius: rT, nose: 0.3, tail: 0.36, uv: U.tank, fins: 0, segments: 24 });
        if (cTank) for (let i = 0; i < tk.p.length; i += 3) { const ang = Math.atan2(tk.p[i], tk.p[i + 1]) / Math.PI * 0.5 + 0.5, uv = cTank.uv(ang * 2.1, tk.p[i + 2]); tk.uv[i / 3 * 2] = uv[0]; tk.uv[i / 3 * 2 + 1] = uv[1]; }
        stat.add(tk.translate(sx * x, yt - rT, zf - 0.85));
        for (const dz of [0.45, 1.75]) for (const dx of [-1, 1]) stat.add(K.tube([sx * x + dx * 0.05, yt + 0.01, zf + dz], [sx * x + dx * 0.15, yt - 0.06, zf + dz], 0.012, 0.012, { segments: 5, uv: U.steel })); }
    }
    // centreline AN/ALQ-184 ECM pod
    { const yb = fus.botAt(-0.2), yp = yb - 0.16;
      stat.add(K.prism([[-1.1, yb + 0.03], [0.65, yb + 0.03], [0.5, yp], [-0.9, yp]], -0.05, 0.05, U.pylon));
      stat.add(K.tank({ length: 3.95, radius: 0.15, nose: 0.14, tail: 0.12, uv: U.ecm, segments: 16 }).translate(0, yp - 0.15, -2.2));
      for (const z of [-2.15, 1.55]) stat.add(K.ellipsoid(0.13, 0.13, 0.16, { segments: 10, rings: 5, uv: U.dark }).translate(0, yp - 0.15, z));
      stat.add(K.box(0.36, 0.12, 0.5, U.ecm).translate(0, yp - 0.15, -0.3)); }
    // chin stations: AN/AAQ-33 Sniper (right), AN/ASQ-213 HTS (left)
    for (const [sx, len, r, z0] of [[1, 2.39, 0.152, -3.25], [-1, 1.42, 0.105, -2.55]]) {
      const x = sx * 0.6, yP = -0.78, y = yP - r - 0.02;
      stat.add(K.prism([[z0 + 0.35, yP + 0.1], [z0 + len - 0.35, yP + 0.1], [z0 + len - 0.45, y + r - 0.01], [z0 + 0.45, y + r - 0.01]], x - 0.035, x + 0.035, U.pylon));
      stat.add(K.lathe([[0, z0 + len], [r * 0.7, z0 + len - 0.05], [r, z0 + len - 0.25], [r, z0 + 0.3], [r * 0.98, z0 + 0.2]], { segments: 18, uv: U.pod }).translate(x, y, 0));
      if (sx > 0) {
        stat.add(K.ellipsoid(r * 0.97, r * 0.97, 0.2, { segments: 16, rings: 8, uv: U.pod, z0: -1, z1: 0 }).translate(x, y, z0 + 0.22));
        stat.add(K.box(0.13, 0.12, 0.04, U.podWin).translate(x, y - 0.02, z0 + 0.06));
      } else stat.add(K.ellipsoid(r, r, 0.22, { segments: 14, rings: 6, uv: U.dark, z0: -1, z1: 0 }).translate(x, y, z0 + 0.22));
    }
  }

  // ---- gear wells -------------------------------------------------------------------------------------------------------
  const P = fus.patches, IP = intake.patches;
  stat.add(K.well(P.mlgR, 0.42, U.well)).add(K.well(P.mlgL, 0.42, U.well));
  const ngPatch = K.merge(IP.ngR, IP.ngL);
  stat.add(K.well(ngPatch, 0.2, U.well, [0, 1, 0]));

  // ---- materials ---------------------------------------------------------------------------------------------------------
  lap('geometry');
  paint(atlas, { SC, livery, load, fus, intake, W, fin, cFus, cInt, cWT, cWB, cST, cSB, cFin, cNoz, cTank, paintF, zLE });
  lap('paint');
  const mat = atlas.material(ctx, { envMapIntensity: 1 });
  lap('textures');
  rig.material('paint', mat, { shared: true });
  rig.disposables.push(atlas);
  rig.glass('canopy', K.glassMaterial(ctx, SC.demo ? K.GLASS.smoke : K.GLASS.gold));
  rig.glass('hud', K.glassMaterial(ctx, K.GLASS.hud));
  const glow = rig.material('glow', K.glowMaterial(), { shadow: false });

  rig.addStatic(stat, 'paint');
  rig.addStatic(hudParts.glass, 'hud');

  // ---- moving parts ------------------------------------------------------------------------------------------------------
  const CP = [0, fus.topAt(Z_CEND) - 0.02, Z_CEND];
  const canopyNode = rig.node('canopy', { pivot: CP });
  rig.part('canopyGlass', glassMove, { parent: canopyNode, key: 'canopy' });
  rig.part('canopyFrame', frameMove, { parent: canopyNode });
  const setCanopy = rig.hinge(canopyNode, [-1, CP[1], CP[2]], [1, CP[1], CP[2]], { ref: [0, 0.9, -5.7], toward: [0, 1, 0] });
  const pilotNode = rig.part('pilot', pilotMesh, { pivot: eye });

  const flR = rig.hingePart('flaperonR', W.R.controls.flaperon), flL = rig.hingePart('flaperonL', W.L.controls.flaperon);
  const lefR = rig.hingePart('lefR', W.R.controls.lef), lefL = rig.hingePart('lefL', W.L.controls.lef);
  const rud = rig.hingePart('rudder', fin.controls.rudder, { toward: [1, 0, 0] });
  const mkStabPart = (name, s, sx) => {
    const a = [sx * 0.9, stabY(0.9), 5.18], b = [sx * 2.79, stabY(2.79), 5.18];
    const node = rig.part(name, s.mesh, { pivot: a });
    return rig.hinge(node, a, b, { ref: [sx * 1.8, stabY(1.8), 6.3], toward: [0, 1, 0] });
  };
  const setStabR = mkStabPart('stabR', stab.R, 1), setStabL = mkStabPart('stabL', stab.L, -1);
  const sb = [];
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    const node = rig.part(`speedbrake${sx > 0 ? 'R' : 'L'}${sy > 0 ? 'U' : 'D'}`, sbMesh(sx, sy), { pivot: [sx * 0.8, sy * 0.1, 5.6] });
    sb.push(rig.hinge(node, [sx * 0.625, sy * 0.1, 5.6], [sx * 0.975, sy * 0.1, 5.6], { ref: [sx * 0.8, 0, 6.3], toward: [0, sy, 0] }));
  }
  const nozzle = rig.part('nozzle', nozzleMesh, { pivot: [0, NZ.c[1], NZ.z0] });
  rig.part('abGlow', glowMesh, { key: 'glow' });
  const hookMesh = K.arrestorHook({ pivot: [0, -0.5, 3.35], length: 1.95, radius: 0.03, uv: U.steel });
  const hookNode = rig.part('hook', hookMesh, { pivot: [0, -0.5, 3.35] });
  const setHook = rig.hinge(hookNode, [-1, -0.5, 3.35], [1, -0.5, 3.35], { ref: [0, -0.5, 5.3], toward: [0, -1, 0] });

  // ---- landing gear --------------------------------------------------------------------------------------------------------
  const gp = G.gear;
  const doorOf = (patch, edge, inner = U.well) => ({ mesh: K.thicken(patch, 0.02, inner), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  K.buildGear(rig, atlas, {
    name: 'nose', index: 0, contact: gp[0].pos, wheelRadius: gp[0].wheelRadius, wheelWidth: 0.145, pivot: [0, -0.66, -3.4], stroke: 0.2, staticFrac: 0.35,
    strutR: 0.045, fork: 'fork', steer: true, links: 'front', retract: { to: [0, -0.62, -2.78], twist: 90 }, window: [0.22, 0.88],
    brace: [0, -0.66, -2.95],
    doors: [{ name: 'noseDoor', ...doorOf(ngPatch, intake.edges.ngR.tHi), open: 92, toward: [0, -1, 0] }],
  });
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, off = 0.15, edge = fus.edges['mlg' + key];
    const lampPos = [sx * 0.9, -1.0, 0.56];
    K.buildGear(rig, atlas, {
      name: 'main' + key, index: i, contact: [c[0] - sx * off, c[1], c[2]], wheels: [sx * off], wheelRadius: gp[i].wheelRadius, wheelWidth: 0.21,
      pivot: [sx * 0.6, -0.4, 0.42], stroke: 0.28, staticFrac: 0.35, strutR: 0.055, fork: 'half', links: 'rear',
      retract: { to: [sx * 0.5, -0.5, -0.62], twist: -sx * 90 }, window: [0.22, 0.9], brace: [sx * 0.45, -0.5, -0.35],
      extra: K.box(0.09, 0.08, 0.07, U.well).translate(lampPos[0], lampPos[1], lampPos[2] + 0.03),   // lamp housing on the strut
      doors: [{ name: 'mainDoor' + key, ...doorOf(P['mlg' + key], sx > 0 ? edge.tLo : edge.tHi), open: 100, toward: [0, -1, 0] }],
      lamps: [{ kind: sx < 0 ? 'landing' : 'taxi', pos: [lampPos[0], lampPos[1], lampPos[2] - 0.006], size: 0.032, color: [1, 0.96, 0.88], squash: [1, 1, 0.4] }],
    });
  }

  // ---- lamps ---------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.035, squash: [0.7, 0.7, 1.6] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.035, squash: [0.7, 0.7, 1.6] });
  rig.lamp('nav', [-0.58, -0.37, -2.9], { color: [1, 0.04, 0.02], size: 0.028 }); rig.lamp('nav', [0.58, -0.37, -2.9], { color: [0.02, 1, 0.25], size: 0.028 });   // intake position lights
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.03 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.04 });
  {  // electroluminescent formation strips: forward fuselage, aft fuselage, fin (conformal plates)
    const strip = (z, t, len, hw) => {
      const dt = hw / fus.girthAt(z, t), lift = (zz, tt) => { const q = fus.at(zz, tt); return [q.p[0] + q.n[0] * 0.003, q.p[1] + q.n[1] * 0.003, q.p[2] + q.n[2] * 0.003]; };
      return K.plate(lift(z - len / 2, t - dt), lift(z + len / 2, t - dt), lift(z + len / 2, t + dt), lift(z - len / 2, t + dt), 0.002, [0, 0]);
    };
    const fc = [0.16, 0.22, 0.1];
    for (const s of [1, -1]) {
      const tf = fus.tAtY(-5.95, 0.4), ta = fus.tAtY(3.9, 0.42);
      rig.lamp('formation', null, { mesh: strip(-5.95, s > 0 ? tf : 1 - tf, 0.5, 0.03), color: fc });
      rig.lamp('formation', null, { mesh: strip(3.9, s > 0 ? ta : 1 - ta, 0.6, 0.03), color: fc });
      const fy = 2.92, fz0 = fin.at(fy, 0.5)[2] - 0.25, fx = s * 0.024;
      rig.lamp('formation', null, { mesh: K.plate([fx, fy - 0.03, fz0], [fx, fy - 0.03, fz0 + 0.5], [fx, fy + 0.03, fz0 + 0.5], [fx, fy + 0.03, fz0], 0.002, [0, 0]), color: fc });
    }
  }

  // ---- animation -----------------------------------------------------------------------------------------------------------
  rig.onUpdate((S) => {
    const sf = S.sf, e = S.eng[0] || {};
    flR.set((sf.aileronR * 21 - sf.flaps * 20) * DEG); flL.set((sf.aileronL * 21 - sf.flaps * 20) * DEG);
    const lef = Math.max(sf.slats, sf.flaps * 0.6); lefR.set(-lef * 25 * DEG); lefL.set(-lef * 25 * DEG);
    setStabR(sf.elevatorR * 22 * DEG); setStabL(sf.elevatorL * 22 * DEG);
    rud.set(sf.rudder * 30 * DEG);
    for (const s of sb) s(sf.speedbrake * 43 * DEG);
    nozzle.morphTargetInfluences[0] = e.nozzle ?? 0;
    K.abGlowColor(glow.color, e, S.night);
    setCanopy(sf.canopy * 28 * DEG);
    setHook(sf.hook * 38 * DEG);
    pilotNode.visible = !rig.cameraInCockpit;
  });
  const visual = rig.build();
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES; visual.stores = load;
  return visual;
}

// ---- paint -------------------------------------------------------------------------------------------------------------------
function paint(atlas, o) {
  const { SC, livery, fus, cFus, cInt, cNoz, cTank, paintF } = o, F = K.FINISH;
  const top = paintF(SC.top), mid = paintF(SC.mid), under = paintF(SC.under);
  const mark = SC.mark, lowVis = SC.demo ? false : mark, WX = SC.weather;
  const slime = { color: '#c3cb8a', rough: 0.35, metal: 0 };
  const rnd = (() => { let a = 99; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const line = { px: 1, depth: 0.4, dark: 0.11 }, seam = { px: 1, depth: 0.32, dark: 0.08 }, gap = { px: 2, depth: 0.8, dark: 0.5 }, riv = { px: 1.1, depth: 0.14, dark: 0.04 };
  const tY = (z, y) => fus.tAtY(z, y);
  const stencil = (P, z, y, side, w, h, rot = 0) => P.decalOn(z, y, side, { rot }, (g) => { g.fillStyle = SC.demo ? 'rgba(20,36,75,0.55)' : 'rgba(30,32,34,0.55)'; for (let i = 0; i < 3; i++) g.fillRect(-w / 2, -h / 2 + i * h * 0.38, w * (0.55 + 0.45 * ((i * 7 + Math.round(z * 10)) % 3) / 2), h * 0.18); });

  // ================= fuselage =================
  const P = atlas.pen(cFus);
  P.fill('all', mid);
  if (SC.demo) {
    // white upper body, navy belly with a red pin-stripe, swoosh on the intake sides
    P.band(-8.25, 5.65, -Infinity, (z) => (z < -6.5 ? 0.12 : z < -4 ? 0.12 - (z + 6.5) * 0.06 : -0.03), under, { feather: 0 });
    P.band(-6.4, 5.65, (z) => (z < -4 ? 0.12 - (z + 6.5) * 0.06 : -0.03), (z) => (z < -4 ? 0.17 - (z + 6.5) * 0.06 : 0.02), F.gloss(SC.red));
    for (const s of [1, -1]) {
      const t = (v) => (s > 0 ? v : 1 - v);
      P.fill([[-5.4, t(tY(-5.4, 0.14))], [-2.0, t(tY(-2.0, 0.5))], [-0.6, t(tY(-0.6, 0.62))], [0.6, t(tY(0.6, 0.6))], [-1.2, t(tY(-1.2, 0.36))], [-3.0, t(tY(-3.0, 0.06))]], F.gloss(SC.navy));
      P.fill([[-0.3, t(tY(-0.3, 0.64))], [0.2, t(tY(0.2, 0.66))], [1.4, t(tY(1.4, 0.58))], [0.9, t(tY(0.9, 0.56))]], F.gloss(SC.red));
    }
  } else {
    P.band(-8.25, 5.65, -Infinity, (z) => (z < -6.4 ? 0.2 : z < -5.4 ? 0.2 - (z + 6.4) * 0.2 : z < 4.5 ? 0.0 : 0.0 + (z - 4.5) * 0.08), under, { feather: 4 });
    if (SC.flanker) flanker(P, SC, rnd, [-6.4, 5.65], [0.2, 0.8], fus);
    else {
      // FS 36118 over the spine, around the canopy and across the strake tops (wavy sprayed edge)
      const edge = [[-6.65, 0.5], [-6.25, 0.452], [-5.7, 0.4], [-5.0, 0.345], [-4.3, 0.31], [-3.5, 0.285], [-2.7, 0.272], [-2.05, 0.285], [-1.6, 0.33], [-0.9, 0.385], [0.2, 0.41], [1.6, 0.418], [3.2, 0.428], [4.6, 0.44], [5.65, 0.45]];
      for (const s of [1, -1]) P.fill(edge.map(([z, t]) => [z, s > 0 ? t : 1 - t]).concat([[5.65, 0.5]]), top, { feather: 4 });
    }
  }
  // radome (separate composite finish) and its joint
  P.fill((g) => g.rect(-8.25, 0, 1.78, 1), F.semigloss(SC.radome));
  P.ring(-6.47, 0, 1, { px: 1.6, depth: 0.45, dark: 0.3 });
  P.noise({ alpha: 0.05, scale: 0.4, path: (g) => g.rect(-8.25, 0, 1.78, 1), rough: 0.05 });
  // anti-glare panel ahead of the windscreen
  P.fill([[-6.47, 0.455], [-5.72, 0.375], [-5.72, 0.625], [-6.47, 0.545]], F.matte(SC.demo ? SC.navy : '#3a3e42'));

  // ---- panel lines -----------------------------------------------------------------------------------------------------
  for (const z of [-6.0, -5.72, -3.32, -2.45, -1.15, 0.3, 1.6, 3.0, 4.2, 5.35]) P.ring(z, 0, 1, line);
  for (const z of [-5.0, -4.2, -1.8, -0.4, 0.95, 2.3, 3.6, 4.8]) for (const s of [1, -1]) { const t0 = tY(z, -0.05), t1 = tY(z, 0.25); P.line([[z, s > 0 ? 0.03 : 0.97], [z, s > 0 ? t0 : 1 - t0]], line); if (z > -2) P.line([[z, s > 0 ? t1 : 1 - t1], [z, s > 0 ? 0.47 : 0.53]], line); }
  P.line([[-8.2, 0], [5.6, 0]], line); P.line([[-2.45, 0.5], [5.6, 0.5]], seam);
  for (const s of [1, -1]) {
    const T = (v) => (s > 0 ? v : 1 - v), side = s > 0 ? 'R' : 'L';
    P.yLine(-6.1, 5.0, 0.0, { ...line, side });                                                                         // upper / lower skin join along the strake edge
    P.yLine(-6.4, -3.4, -0.12, { ...seam, side });
    for (const tt of [0.06, 0.13, 0.19]) P.line([[-1.8, T(tt)], [5.6, T(tt)]], seam);
    for (const tt of [0.36, 0.44]) P.line([[-2.4, T(tt)], [5.6, T(tt)]], seam);
    // forward avionics bays (both sides below the canopy) with fastener rows
    for (const [z0, z1, y0, y1] of [[-6.38, -5.3, -0.1, 0.36], [-5.22, -4.28, -0.12, 0.3], [-4.2, -3.45, -0.14, -0.02]]) {
      P.doorOn(z0, z1, y0, y1, { ...line, side, handle: true });
      const a0 = T(tY(z0, y0)), a1 = T(tY(z0, y1));
      P.rivets(z0 + 0.03, a0, z1 - 0.03, T(tY(z1, y0)), 0.035, riv); P.rivets(z0 + 0.03, a1, z1 - 0.03, T(tY(z1, y1)), 0.035, riv);
    }
    // strake top panels, spine panels, upper aft fuselage
    for (const [z0, z1, t0, t1] of [[-4.0, -2.65, 0.29, 0.34], [-2.55, -1.6, 0.3, 0.36], [-1.4, -0.2, 0.33, 0.42], [-0.1, 1.4, 0.34, 0.42], [1.6, 2.9, 0.37, 0.44], [3.1, 4.1, 0.39, 0.46], [4.3, 5.2, 0.4, 0.47]]) {
      P.panel(z0, T(t0), z1, T(t1), line);
      P.rivets(z0 + 0.03, T(t0 + 0.004), z1 - 0.03, T(t0 + 0.004), 0.04, riv); P.rivets(z0 + 0.03, T(t1 - 0.004), z1 - 0.03, T(t1 - 0.004), 0.04, riv);
    }
    for (const [z0, z1] of [[-2.3, -1.25], [-1.0, 0.1], [0.4, 1.5], [1.75, 2.85], [3.15, 4.1]]) P.panel(z0, T(0.455), z1, T(0.497), line);
    // lower fuselage: fuel / engine access doors
    for (const [z0, z1, t0, t1] of [[-0.95, 0.3, 0.2, 0.235], [0.95, 2.2, 0.04, 0.175], [2.35, 3.55, 0.04, 0.17], [3.75, 4.8, 0.06, 0.2]]) {
      P.panel(z0, T(t0), z1, T(t1), line); P.rivets(z0 + 0.03, T(t0 + 0.004), z1 - 0.03, T(t0 + 0.004), 0.04, riv);
    }
    // rivet rows on the frames of the aft body
    for (const z of [-1.15, 0.3, 1.6, 3.0, 4.2]) P.rivets(z + 0.03, T(0.26), z + 0.03, T(0.49), 0.006, riv);
  }
  // per-panel tonal variation (touch-up paint) — subtle
  if (!SC.demo) for (let i = 0; i < 22; i++) {
    const z = -6 + rnd() * 11, t = 0.05 + rnd() * 0.9, w = 0.3 + rnd() * 0.6, h = 0.02 + rnd() * 0.05;
    P.fill((g) => g.rect(z, t, w, h), { color: rnd() < 0.5 ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)' }, { alpha: 0.025 + rnd() * 0.03 });
  }
  // deck under the rear canopy
  P.fill((g) => g.rect(-3.32, 0.375, 0.42, 0.25), F.black);
  P.fill((g) => g.rect(-2.9, 0.375, 0.45, 0.25), F.darkGrey);
  // air-refuelling receptacle: slipway (dark with white guide lines) on the spine
  P.decalT(-1.65, 0.5, { layers: ['color', 'orm'] }, (g, layer) => {
    if (layer === 'orm') { g.fillStyle = 'rgb(255,120,0)'; g.fillRect(-0.24, -0.15, 0.48, 0.3); return; }
    g.fillStyle = SC.demo ? '#d7d8d5' : '#3c4044'; g.fillRect(-0.24, -0.13, 0.48, 0.26);
    g.strokeStyle = SC.demo ? '#14244b' : '#d8d9d4'; g.lineWidth = 0.012; g.beginPath(); g.moveTo(-0.6, 0); g.lineTo(-0.26, 0); g.moveTo(-0.6, -0.12); g.lineTo(-0.3, -0.06); g.moveTo(-0.6, 0.12); g.lineTo(-0.3, 0.06); g.stroke();
  });
  // formation lights (painted base under the lamps)
  for (const [z, y, w] of [[-5.95, 0.4, 0.5], [3.9, 0.42, 0.6]]) P.decalOn(z, y, 'both', { layers: ['color', 'orm'] }, (g, layer) => { g.fillStyle = layer === 'orm' ? 'rgb(255,90,0)' : slime.color; g.fillRect(-w / 2, -0.03, w, 0.06); });
  // gun port surround + gas vents (left strake root)
  P.decalOn(-3.62, 0.24, 'L', (g) => { g.fillStyle = '#26282a'; g.beginPath(); g.ellipse(0.05, 0, 0.26, 0.055, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#1a1b1c'; for (let i = 0; i < 4; i++) g.fillRect(0.2 + i * 0.08, -0.035, 0.045, 0.07); });
  // markings
  for (const s of ['L', 'R']) {
    const left = s === 'L';
    P.textOn(SC.crew[0], -4.65, 0.47, s, 0.034, { color: SC.demo ? SC.navy : '#2c2f32', font: K.FONT.sans });
    if (!SC.demo) {
      P.textOn('RESCUE', -5.25, 0.36, s, 0.04, { color: mark });
      P.decalOn(-5.5, 0.36, s, (g) => { g.strokeStyle = mark; g.lineWidth = 0.012; g.beginPath(); g.moveTo(-0.11, 0); g.lineTo(0.06, 0); g.moveTo(0.01, -0.045); g.lineTo(0.07, 0); g.lineTo(0.01, 0.045); g.stroke(); });
      P.decalOn(-4.15, 0.47, s, (g) => { g.fillStyle = '#a02a24'; g.beginPath(); g.moveTo(-0.07, 0.06); g.lineTo(0.07, 0.06); g.lineTo(0, -0.06); g.closePath(); g.fill(); g.fillStyle = '#f0f0ea'; g.fillRect(-0.008, -0.02, 0.016, 0.05); });
      P.textOn('DANGER', -3.95, 0.33, s, 0.03, { color: '#a02a24', weight: 700 });
      for (const [z, y] of [[-5.9, 0.08], [-4.8, 0.02], [-2.2, 0.18], [0.0, 0.45], [2.6, 0.5], [4.4, 0.3], [-1.0, -0.38], [1.9, -0.25]]) stencil(P, z, y, s, 0.16 + rnd() * 0.1, 0.06);
      P.textOn(left ? 'FUEL' : 'OXYGEN', left ? 0.6 : -5.0, left ? -0.32 : -0.06, s, 0.035, { color: '#2c2f32' });
    }
  }
  if (SC.demo) {
    P.textOn('SKYWARD', -0.15, 0.3, 'both', 0.2, { color: SC.navy, italic: true, font: K.FONT.wide });
  } else {
    P.decalOn(-0.95, -0.34, 'both', (g) => K.drawStarBar(g, 0.38, { lowVis }));
  }
  for (const z of [-1.0, 1.0]) for (const s of [0.31, 0.69]) P.decalT(z, s, { rot: s < 0.5 ? 180 : 0 }, (g) => K.drawText(g, 'NO STEP', 0.04, { color: SC.demo ? SC.navy : '#2b2e31' }));
  // ---- weathering ------------------------------------------------------------------------------------------------------
  P.noise({ alpha: 0.05 * (0.5 + WX), scale: 2.4, stretch: [1.6, 1], rough: 0.05 });
  P.noise({ alpha: 0.03 * (0.5 + WX), scale: 0.6, mode: 'light' });
  P.noise({ alpha: 0.06 * WX, scale: 1.4, mode: 'light', path: (g) => g.rect(-6.4, 0.32, 12, 0.36) });                  // sun-faded upper surfaces
  for (let i = 0; i < Math.round(30 * WX); i++) { const z = -2.5 + rnd() * 7.5, t = (rnd() < 0.5 ? 0.0 : 0.9) + rnd() * 0.1; P.streak(z, t, z + 0.6 + rnd() * 1.4, t + (rnd() - 0.5) * 0.01, 0.006 + rnd() * 0.012, { alpha: 0.08 + rnd() * 0.14 }); }   // hydraulic streaks
  for (let i = 0; i < Math.round(8 * WX); i++) { const z = 0.9 + rnd() * 3, t = 0.04 + rnd() * 0.14; P.streak(z, t, z + 0.5, t, 0.04, { alpha: 0.12, color: '60,52,40' }); P.streak(z, 1 - t, z + 0.5, 1 - t, 0.04, { alpha: 0.12, color: '60,52,40' }); }
  P.fill((g) => g.rect(5.1, 0, 0.55, 1), { color: 'rgba(40,34,30,1)' }, { alpha: 0.18 + 0.2 * WX, feather: 10 });   // exhaust staining
  for (const s of [0.25, 0.75, 0.12, 0.88]) P.streak(5.65, s, 4.4, s, 0.18, { alpha: 0.12 + 0.12 * WX });
  { const tg = 1 - tY(-3.6, 0.24); P.streak(-3.62, tg, -1.6, tg + 0.01, 0.12, { alpha: 0.35 * WX + 0.1 }); P.streak(-3.62, tg, -2.4, tg - 0.02, 0.06, { alpha: 0.45 * WX + 0.1 }); }   // gun soot
  for (const s of [1, -1]) for (const z of [-3.2, -2.6]) { const t = s > 0 ? 0.31 : 0.69; P.wear((g) => { g.moveTo(z, t - 0.015); g.lineTo(z + 0.35, t + 0.015); }, 0.08, { color: SC.demo ? '#dcdcd8' : '#6b7074', rough: 0.75, metal: 0 }, { alpha: 0.25 * WX }); }   // worn walkways

  // ================= intake =================
  {
    const Q = atlas.pen(cInt);
    Q.fill('all', SC.demo ? paintF(SC.navy) : under);
    Q.fill((g) => g.rect(-3.75, 0, 0.36, 1), SC.demo ? paintF(SC.navy) : under);
    for (const z of [-3.3, -2.85, -2.2, -1.75]) Q.ring(z, 0, 1, line);
    Q.line([[-3.3, 0], [-1.3, 0]], line);
    for (const tt of [0.12, 0.2, 0.8, 0.88]) Q.line([[-3.3, tt], [-1.3, tt]], seam);
    Q.ring(-3.42, 0, 1, { px: 1.5, depth: 0.5, dark: 0.2 });
    if (!SC.demo) {
      for (const tt of [0.2, 0.8]) Q.decalT(-3.15, tt, { girth: 2.5, rot: tt < 0.5 ? -90 : 90 }, (g) => { g.fillStyle = '#a02a24'; g.fillRect(-0.2, -0.04, 0.4, 0.08); g.fillStyle = '#ece9e0'; g.font = '700 0.05px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('DANGER', 0, 0); });
    } else for (const tt of [0.2, 0.8]) Q.decalT(-2.5, tt, { girth: 2.5, rot: tt < 0.5 ? -90 : 90 }, (g) => K.drawText(g, SC.code, 0.3, { color: '#f2f2ef', font: K.FONT.wide, italic: true }));
    Q.noise({ alpha: 0.05 * (0.5 + WX), scale: 1.2, rough: 0.05 });
    for (let i = 0; i < Math.round(10 * WX); i++) { const z = -3.3 + rnd() * 1.8, t = rnd() < 0.5 ? 0.02 + rnd() * 0.06 : 0.92 + rnd() * 0.06; Q.streak(z, t, z + 0.5, t, 0.01, { alpha: 0.12 }); }
  }

  // ================= wings =================
  const { W, fin, cWT, cWB, cST, cSB, cFin } = o;
  for (const key of ['R', 'L']) {
    const s = key === 'R' ? 1 : -1, wg = W.R;
    const at = (x, f) => { const p = wg.at(x, f); return [p[0], p[2]]; };
    for (const [chart, fin2, isTop] of [[cWT[key], SC.demo ? paintF(SC.top) : mid, true], [cWB[key], SC.demo ? paintF(SC.navy) : under, false]]) {
      const Q = atlas.pen(chart);
      Q.fill('all', fin2);
      const M = (pts) => pts.map(p => [p[0] * s, p[1]]);
      if (isTop && SC.flanker) flanker(Q, SC, rnd, [s > 0 ? 0.9 : -4.62, s > 0 ? 4.62 : -0.9], [-2, 2.4], null);
      if (isTop && SC.demo) { Q.fill(M([at(1, 0.0), at(4.57, 0.0), at(4.57, 0.22), at(1, 0.3)]), F.gloss(SC.navy)); Q.fill(M([at(1, 0.3), at(4.57, 0.22), at(4.57, 0.27), at(1, 0.36)]), F.gloss(SC.red)); }
      if (!isTop && SC.demo) { Q.fill(M([at(1, 0.6), at(4.57, 0.6), at(4.57, 0.66), at(1, 0.66)]), F.gloss(SC.red)); Q.fill(M([at(1, 0.66), at(4.57, 0.66), at(4.57, 0.74), at(1, 0.74)]), F.gloss('#f2f2ef')); }
      const ln = (pts, op) => Q.line(M(pts), op);
      // spars / ribs / control surface gaps
      for (const f of [0.3, 0.5, 0.64]) ln([at(1.0, f), at(4.57, f)], line);
      for (const x of [1.6, 2.3, 3.0, 3.62, 4.1]) ln([at(x, 0.02), at(x, 0.99)], line);
      const hTE = (x) => wg.lines.hingeTE.at(wg.spanToU(x)), hLE = (x) => wg.lines.hingeLE.at(wg.spanToU(x));
      ln([at(1.17, hTE(1.17)), at(3.62, hTE(3.62)), at(3.62, 1)], gap);
      ln([at(1.17, hTE(1.17)), at(1.17, 1)], gap);
      ln([at(1.17, 0), at(1.17, hLE(1.17)), at(4.57, hLE(4.57))], gap);
      for (const x of [2.4, 3.6]) ln([at(x, 0.002), at(x, hLE(x))], { px: 1.2, depth: 0.6, dark: 0.3 });
      // fuel-access panels between the spars
      for (const [x0, x1] of [[1.7, 2.2], [2.4, 2.9], [3.1, 3.5]]) { const a = at(x0, 0.34), b = at(x1, 0.46); Q.panel(a[0] * s, a[1], b[0] * s, b[1] + (b[1] - a[1]) * 0, { ...line, r: 0.02 }); }
      for (const f of [0.3, 0.5, 0.64]) for (let i = 0; i < 2; i++) { const a = at(1.05, f + 0.012 * (i ? 1 : -1)), b = at(4.5, f + 0.012 * (i ? 1 : -1)); Q.rivets(a[0] * s, a[1], b[0] * s, b[1], 0.03, riv); }
      for (const x of [1.6, 2.3, 3.0, 3.62]) { const a = at(x + 0.012, 0.03), b = at(x + 0.012, 0.95); Q.rivets(a[0] * s, a[1], b[0] * s, b[1], 0.035, riv); }
      // leading-edge wear, tonal variation, hinge-line grime
      const le = M([at(1.2, 0.006), at(4.55, 0.006)]);
      Q.wear((g) => { g.moveTo(le[0][0], le[0][1]); g.lineTo(le[1][0], le[1][1]); }, 0.03, { color: '#9a9ea2', rough: 0.4, metal: 0.6 }, { alpha: 0.12 + 0.3 * WX });
      Q.noise({ alpha: 0.05 * (0.5 + WX), scale: 1.2, stretch: [1, 2.5], rough: 0.05 });
      if (isTop) Q.noise({ alpha: 0.05 * WX, scale: 1.6, mode: 'light' });
      for (let i = 0; i < Math.round(10 * WX); i++) { const x = 1.3 + rnd() * 2.2, a = at(x, hTE(x)); Q.streak(a[0] * s, a[1], a[0] * s, a[1] + 0.25 + rnd() * 0.3, 0.03, { alpha: 0.16 }); }
      if (!isTop) for (let i = 0; i < Math.round(6 * WX); i++) { const x = 1.3 + rnd() * 1.4, a = at(x, 0.2 + rnd() * 0.4); Q.streak(a[0] * s, a[1], a[0] * s, a[1] + 0.6 + rnd() * 0.6, 0.035, { alpha: 0.12 }); }
      // markings
      if (!SC.demo) {
        if (isTop && key === 'L') Q.decal(-3.0, 0.75, (g) => K.drawStarBar(g, 0.5, { lowVis }));
        if (!isTop && key === 'R') Q.decal(3.0, 0.75, (g) => K.drawStarBar(g, 0.5, { lowVis }));
      } else if (!isTop) Q.decal(s * 2.6, 0.5, (g) => { g.fillStyle = '#f2f2ef'; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.17 : 0.42, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); });
      if (isTop) { Q.fill((g) => g.rect(s > 0 ? 4.3 : -4.55, at(4.4, 0.3)[1], 0.25, 0.05), slime); const p = at(1.5, 0.45); Q.text('NO STEP', p[0] * s, p[1], 0.045, { color: SC.demo ? SC.navy : '#2b2e31' }); const q = at(2.6, 0.86); Q.text('NO STEP', q[0] * s, q[1], 0.035, { color: SC.demo ? SC.navy : '#2b2e31' }); }
      if (!isTop && !SC.demo) { const p = at(2.05, 0.4); Q.text('NO STEP', p[0] * s, p[1] - 0.25, 0.03, { color: '#3a3d40' }); }
    }
  }
  // ================= tailplanes =================
  for (const [chart, f, isTop, sx] of [[cST.R, SC.demo ? paintF(SC.top) : mid, true, 1], [cST.L, SC.demo ? paintF(SC.top) : mid, true, -1], [cSB, SC.demo ? paintF(SC.navy) : under, false, 1]]) {
    const Q = atlas.pen(chart); Q.fill('all', f);
    if (isTop && SC.flanker) flanker(Q, SC, rnd, [sx > 0 ? 0.9 : -2.85, sx > 0 ? 2.85 : -0.9], [3.9, 6.45], null);
    if (isTop && SC.demo) { Q.fill([[sx * 0.9, 3.9], [sx * 2.85, 5.45], [sx * 2.85, 5.62], [sx * 0.9, 4.25]], F.gloss(SC.navy)); Q.fill([[sx * 0.9, 4.25], [sx * 2.85, 5.62], [sx * 2.85, 5.72], [sx * 0.9, 4.45]], F.gloss(SC.red)); }
    for (const zz of [4.9, 5.5, 5.95]) Q.line([[sx * 0.95, zz], [sx * 2.8, zz + (6.2 - zz) * 0.15]], line);
    for (const x of [1.4, 1.9, 2.4]) Q.line([[sx * x, 3.9], [sx * x, 6.45]], seam);
    Q.rivets(sx * 0.98, 4.1, sx * 0.98, 6.2, 0.04, riv);
    Q.noise({ alpha: 0.05 * (0.5 + WX), scale: 1.0, stretch: [1, 2], rough: 0.05 });
  }
  // ================= fin =================
  for (const key of ['L', 'R']) {
    const Q = atlas.pen(cFin[key]); Q.fill('all', paintF(SC.fin));
    const at = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    if (SC.flanker) flanker(Q, SC, rnd, [2.1, 6.12], [0.75, 3.4], null, true);
    if (SC.demo) {   // navy fin with white stars and red/white diagonal stripes
      for (let i = 0; i < 4; i++) { const y0 = 0.85 + i * 0.32; Q.fill([at(y0, 0), at(y0 + 0.14, 0), at(y0 + 0.7, 1), at(y0 + 0.56, 1)], F.gloss(i % 2 ? '#f2f2ef' : SC.red)); }
      for (let i = 0; i < 9; i++) { const c = at(2.3 + (i % 3) * 0.28, 0.25 + Math.floor(i / 3) * 0.17); Q.decal(c[0], c[1], (g) => { g.fillStyle = '#f2f2ef'; g.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.025 : 0.06, a = -Math.PI / 2 + k * Math.PI / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); }); }
    }
    const hz = (y) => fin.lines.hinge.at(fin.spanToU(y));
    Q.line([at(1.28, 1), at(1.28, hz(1.28)), at(3.12, hz(3.12)), at(3.12, 1)], gap);
    for (const y of [1.3, 1.9, 2.5, 3.05]) Q.line([at(y, 0.02), at(y, hz(y))], line);
    for (const f of [0.25, 0.5]) Q.line([at(0.85, f), at(3.3, f)], line);
    for (const f of [0.26, 0.51]) { const a = at(0.9, f), b = at(3.25, f); Q.rivets(a[0], a[1], b[0], b[1], 0.035, riv); }
    // fin-tip antenna cap (dielectric), unit band, tail code, serial, formation light
    Q.fill([at(3.2, 0), at(3.33, 0), at(3.33, 1), at(3.2, 1)], F.semigloss(SC.demo ? '#f2f2ef' : '#5d6266'));
    if (!SC.demo) {
      Q.fill([at(2.98, 0), at(3.2, 0), at(3.2, 0.62), at(2.98, 0.65)], paintF(SC.band));
      Q.line([at(2.97, 0), at(2.97, 0.65)], { px: 2, depth: 0, dark: 0, color: SC.band2 });
      if (livery === 'usaf') for (let i = 0; i < 9; i++) { const c = at(3.09, 0.04 + i * 0.065); Q.decal(c[0], c[1], (g) => { g.fillStyle = SC.band2; g.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.013 : 0.032, a = -Math.PI / 2 + k * Math.PI / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); }); }
    }
    const c = at(2.32, 0.36), code = SC.demo ? '#f2f2ef' : mark;
    if (!SC.demo) Q.text(SC.code, c[0], c[1], 0.43, { color: code, font: K.FONT.sans, weight: 700 });
    else { const cc = at(2.05, 0.6); Q.text(SC.code, cc[0], cc[1], 0.5, { color: '#f2f2ef', font: K.FONT.wide, weight: 700, italic: true }); }
    const d = at(1.62, 0.42);
    const fwd = key === 'L' ? -1 : 1;   // reading direction runs aft on the left, forward on the right
    Q.text(SC.serial[0], d[0] + fwd * 0.3, d[1] - 0.03, 0.09, { color: code, weight: 700 });
    Q.text(SC.serial[1], d[0] - fwd * 0.12, d[1], 0.19, { color: code, weight: 700 });
    const fl = at(2.92, 0.5); Q.fill((g) => g.rect(fl[0] - 0.25, fl[1] - 0.03, 0.5, 0.06), slime);
    Q.noise({ alpha: 0.05 * (0.5 + WX), scale: 1.2, stretch: [1, 1.5], rough: 0.05 });
    Q.streak(at(1.0, 0.9)[0], at(1.0, 0.9)[1], at(1.0, 0.9)[0] + 0.6, at(1.0, 0.9)[1] - 0.1, 0.06, { alpha: 0.1 * WX });
  }
  // ================= nozzle petals (a = around, b = hinge → exit) =================
  {
    const Q = atlas.pen(cNoz), n = 15, w = 3.5 / n;
    Q.fill('all', { color: '#857b72', rough: 0.5, metal: 0.8 });
    for (let i = 0; i < n; i++) {
      if (i % 2) Q.fill((g) => g.rect(i * w, 0, w, 0.9), { color: '#7a7069', rough: 0.55, metal: 0.8 });
      Q.fill((g) => g.rect(i * w + w * 0.3, 0.05, w * 0.4, 0.8), { color: '#958b82', rough: 0.45, metal: 0.8 }, { alpha: 0.5 });
      Q.line([[i * w, 0], [i * w, 0.9]], { px: 2, depth: 0.9, dark: 0.6 });
      for (let k = 0; k < 6; k++) Q.fill((g) => g.rect(i * w + w * 0.15, 0.12 + k * 0.12, w * 0.7, 0.012), { color: '#5c544e', rough: 0.5, metal: 0.8 }, { alpha: 0.6 });
    }
    Q.fill((g) => g.rect(0, 0.35, 3.5, 0.25), { color: '#6a6d7a', rough: 0.45, metal: 0.85 }, { alpha: 0.25, feather: 8 });          // bluish heat tint
    Q.fill((g) => g.rect(0, 0.2, 3.5, 0.2), { color: '#8a7550', rough: 0.45, metal: 0.85 }, { alpha: 0.2, feather: 8 });            // straw heat tint
    Q.fill((g) => g.rect(0, 0.62, 3.5, 0.28), { color: '#3d3430', rough: 0.6, metal: 0.8 }, { alpha: 0.55, feather: 6 });          // heat-stained exit
    Q.fill((g) => g.rect(0, 0, 3.5, 0.07), { color: '#5f5a55', rough: 0.5, metal: 0.8 });
    Q.line([[0, 0.07], [3.5, 0.07]], { px: 1.5, depth: 0.7, dark: 0.5 });
    Q.noise({ alpha: 0.12, scale: 0.8, stretch: [1, 2] });
  }
  // ================= wing tanks =================
  if (cTank) {
    const Q = atlas.pen(cTank);   // a = around (0 bottom … 1.05 top … 2.1 bottom), b = body z
    Q.fill('all', SC.demo ? paintF(SC.top) : under);
    for (const z of [1.15, 2.0, 2.9, 3.4]) Q.line([[0, z], [2.1, z]], seam);
    Q.line([[1.05, 0], [1.05, 4.7]], line);
    Q.text('370 GAL', 0.55, 2.4, 0.06, { color: '#3a3d40', rot: 90 }); Q.text('370 GAL', 1.55, 2.4, 0.06, { color: '#3a3d40', rot: -90 });
    Q.noise({ alpha: 0.06, scale: 0.9, rough: 0.05 });
    for (let i = 0; i < 5; i++) { const a = 0.1 + rnd() * 0.3; Q.streak(a, 0.5 + rnd() * 2, a, 3 + rnd(), 0.03, { alpha: 0.12 }); }
  }
}

/** Su-27 style "Flanker" camouflage: soft-edged wavy bands of three blues slanting across a chart region (aggressor scheme). */
function flanker(P, SC, rnd, ar, br, body, side) {
  const cols = SC.flanker, F = K.FINISH, span = ar[1] - ar[0], bw = br[1] - br[0];
  const stepMin = body ? 1.2 : side ? 0.6 : 0.95, slope = (body ? 9 : side ? 0.7 : 0.9) * (rnd() < 0.5 ? 1 : -1);
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6], edge = (a, b, k) => a + slope * (b - (br[0] + bw / 2)) * (body ? 0.12 : 1) + Math.sin((b - br[0]) / bw * 5.5 + ph[k % 3] + k) * stepMin * 0.18 + Math.sin((b - br[0]) / bw * 13 + k * 2.1) * stepMin * 0.06;
  const bounds = []; let a = ar[0] - span * 0.3;
  while (a < ar[1] + span * 0.3) { bounds.push(a); a += stepMin * (0.7 + rnd() * 0.8); }
  for (let k = 0; k < bounds.length - 1; k++) {
    const ci = k % 4; if (ci === 3) continue;                     // every fourth band leaves the base colour showing
    const n = 14, l = [], r = [];
    for (let i = 0; i <= n; i++) { const b = br[0] - bw * 0.05 + (bw * 1.1) * i / n; l.push([edge(bounds[k], b, k), b]); r.push([edge(bounds[k + 1], b, k + 1), b]); }
    P.fill(l.concat(r.reverse()), F.semigloss(cols[(ci + (side ? 1 : 0)) % cols.length]), { feather: 3 });
  }
}
