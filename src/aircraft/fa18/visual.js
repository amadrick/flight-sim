// Boeing F/A-18E Super Hornet — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (1.55) when parked.
//
// Reference numbers (docs/aircraft/fa18.md, body z = distance from the nose - 9.5):
//   length 18.31 (nose z -9.5 … tail 8.81), span 13.62 over the AIM-9X fins, height 4.88 (fin tips at y 3.33).
//   Fuselage: radome to z -7.1, windscreen base z -6.3, canopy peak y 1.36 at z -4.8, eye [0, .85, -5.2].
//   LERX: from the windscreen (z -6.3) to the wing LE at x 2.0 / z -1.35, LE sweep ≈ 72°, at y ≈ .2.
//   Intakes: raked rectangular "caret" boxes under the LERX, lip at z -3.8, centre x ±1.02 / y -.24, .66 × .76 m,
//            canted 10° (tops outboard), lip raked 27° in side view and 20° in plan.
//   Wing: root LE z -1.6 at x 1.3, chord 4.7 → tip x 6.25 chord 2.1, LE sweep 20.2°, TE swept forward, y .12, 5.5–4 %.
//         Fold at x 3.75 with a 0.12 m dogtooth on the outer LE flap; LEF 15 %, flaps 30 % inboard, ailerons outboard.
//   Stabilators: root x 1.0 chord 3.5 (LE z 5.0), tip x 4.3 chord 1.2, 35° LE sweep, 2° anhedral, pivot z 6.35.
//   Fins: canted 20° out, root at x ±1.06 (LE z 2.55, chord 3.85), tip y 3.32 (LE z 4.95, chord 1.35), rudders low.
//   Engines: nacelles r .55 at x ±0.72 / y .05; petal nozzles z 7.35 → 8.55, exit r .40 – .48.
//   Gear: nose twin wheels r .26 at z -4.85 (launch bar), mains r .36 at x ±1.7 / z .55, all on y -1.55.
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['navy', 'cag'];

const SCHEMES = {
  navy: {
    name: 'US Navy TPS two-tone grey', top: '#5f666c', under: '#888e93', radome: '#72787c', finish: 'matte', mark: '#3c4044',
    code: 'NX', modex: '211', squadron: 'VFA-177', buno: '169213', weather: 1,
  },
  cag: {
    name: 'CAG bird, VFA-177 "Stormriders"', top: '#6c7379', under: '#959ba0', radome: '#7e8488', finish: 'semigloss', mark: '#1d2430',
    code: 'NX', modex: '200', squadron: 'VFA-177', buno: '169200', weather: 0.45, cag: true,
    finA: '#141a24', finB: '#d4a017', finC: '#b3202a',
  },
};

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'navy', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, paintF = F[SC.finish], lap = K.stopwatch();
  const seg = Math.max(32, Math.round(72 * detail / 4) * 4);
  const ENG_X = Math.abs(G.engines[0].nozzle[0]), ENG_Y = G.engines[0].nozzle[1];

  // ---- atlas ------------------------------------------------------------------------------------------------------------
  const atlas = K.createAtlas({ size: atlasSize, base: paintF(SC.top) });
  const cFus = atlas.chart('fus', { type: 'unwrap', z: [-9.5, 7.95], girth: 7.4, vScale: 0.9, strips: 2 });
  const WX = [0.9, 6.3], WZ = [-1.9, 3.25];
  const cWT = { R: atlas.chart('wingTopR', { type: 'plan', x: WX, z: WZ, view: 'top' }), L: atlas.chart('wingTopL', { type: 'plan', x: [-WX[1], -WX[0]], z: WZ, view: 'top' }) };
  const cWB = { R: atlas.chart('wingBotR', { type: 'plan', x: WX, z: WZ, view: 'bottom', density: 0.7 }), L: atlas.chart('wingBotL', { type: 'plan', x: [-WX[1], -WX[0]], z: WZ, view: 'bottom', density: 0.7 }) };
  const SX = [0.95, 4.35], SZ = [4.95, 8.65];
  const cST = { R: atlas.chart('stabTopR', { type: 'plan', x: SX, z: SZ, view: 'top', density: 0.8 }), L: atlas.chart('stabTopL', { type: 'plan', x: [-SX[1], -SX[0]], z: SZ, view: 'top', density: 0.8 }) };
  const cSB = atlas.chart('stabBot', { type: 'plan', x: SX, z: SZ, view: 'bottom', mirror: true, density: 0.6 });
  const FZ = [2.05, 6.15], FY = [0.15, 3.45];
  const cFin = {
    Rout: atlas.chart('finRout', { type: 'side', z: FZ, y: FY, view: 'right' }), Lout: atlas.chart('finLout', { type: 'side', z: FZ, y: FY, view: 'left' }),
    Rin: atlas.chart('finRin', { type: 'side', z: FZ, y: FY, view: 'left', density: 0.65 }), Lin: atlas.chart('finLin', { type: 'side', z: FZ, y: FY, view: 'right', density: 0.65 }),
  };
  const cNac = { R: atlas.chart('nacR', { type: 'rect', w: 5.8, h: 3.5, density: 0.6 }), L: atlas.chart('nacL', { type: 'rect', w: 5.8, h: 3.5, density: 0.6 }) };
  const IZ = [-4.45, -0.8], IY = [-0.8, 0.5];
  const cIn = { R: atlas.chart('inR', { type: 'side', z: IZ, y: IY, view: 'right', density: 0.9 }), L: atlas.chart('inL', { type: 'side', z: IZ, y: IY, view: 'left', density: 0.9 }) };
  const cPanel = atlas.chart('panel', { type: 'rect', w: 0.86, h: 0.42, density: 2.5 });
  const cNoz = atlas.chart('nozzle', { type: 'rect', w: 3.2, h: 1.2, density: 0.7 });
  atlas.pack();
  const U = {
    top: atlas.swatch('top', paintF(SC.top)), under: atlas.swatch('under', paintF(SC.under)), mid: atlas.swatch('mid', paintF(mixHex(SC.top, SC.under, 0.5))),
    duct: atlas.swatch('duct', F.gloss('#e2e3e0')), dark: atlas.swatch('dark', F.darkGrey), black: atlas.swatch('black', F.black),
    exhaust: atlas.swatch('exhaust', F.exhaust), heat: atlas.swatch('heat', { color: '#7f776f', rough: 0.5, metal: 0.75 }), heat2: atlas.swatch('heat2', { color: '#45403c', rough: 0.55, metal: 0.8 }),
    well: atlas.swatch('well', F.gearWhite), interior: atlas.swatch('interior', F.interior), console: atlas.swatch('console', { color: '#1d1f21', rough: 0.6, metal: 0 }),
    seat: atlas.swatch('seat', { color: '#25282a', rough: 0.7, metal: 0 }), cushion: atlas.swatch('cushion', F.fabric), accent: atlas.swatch('accent', { color: '#d6b21e', rough: 0.5, metal: 0 }),
    suit: atlas.swatch('suit', { color: '#4d5540', rough: 0.9, metal: 0 }), helmet: atlas.swatch('helmet', { color: '#8d9296', rough: 0.35, metal: 0 }), visor: atlas.swatch('visor', { color: '#0a0b0d', rough: 0.05, metal: 0.4 }),
    glove: atlas.swatch('glove', { color: '#3a3d33', rough: 0.9, metal: 0 }), frame: atlas.swatch('frame', paintF('#4d5257')), steel: atlas.swatch('steel', F.steel),
    aim: atlas.swatch('aim', F.semigloss('#a9adb0')), aimNose: atlas.swatch('aimNose', { color: '#24272a', rough: 0.2, metal: 0.3 }), rail: atlas.swatch('rail', paintF(SC.top)),
    probe: atlas.swatch('probe', F.bareMetal), hookY: atlas.swatch('hookY', F.semigloss('#d9b21c')), hookK: atlas.swatch('hookK', F.semigloss('#141516')),
    lbar: atlas.swatch('lbar', F.gearWhite), red: atlas.swatch('red', F.semigloss('#b3202a')),
  };

  const rig = K.createRig(ctx, { geometry: G, name: 'fa18', glassLayer: opts.glassLayer });
  rig.material('paint', null);
  const stat = new K.Mesh();

  // ---- fuselage: one loft from the radome to the beaver tail; the LERX and the aft shelf are a chine -------------------------
  //        z      top     bot     w      chW   chY(abs)
  const FT = [
    [-9.50, 0.150, 0.150, 0.000],
    [-9.46, 0.190, 0.114, 0.045],
    [-9.32, 0.258, 0.058, 0.122],
    [-9.05, 0.345, -0.022, 0.222],
    [-8.60, 0.450, -0.122, 0.330],
    [-8.00, 0.560, -0.232, 0.425],
    [-7.40, 0.645, -0.328, 0.488],
    [-6.80, 0.708, -0.405, 0.528],
    [-6.30, 0.745, -0.460, 0.552, 0.57, 0.56],
    [-5.80, 0.735, -0.500, 0.564, 0.76, 0.56],
    [-5.20, 0.715, -0.525, 0.574, 0.98, 0.55],
    [-4.60, 0.725, -0.545, 0.584, 1.20, 0.53],
    [-4.10, 0.820, -0.560, 0.594, 1.37, 0.50],
    [-3.70, 1.000, -0.575, 0.604, 1.50, 0.47],
    [-3.20, 1.075, -0.600, 0.620, 1.63, 0.43],
    [-2.60, 1.000, -0.640, 0.820, 1.77, 0.37],
    [-2.00, 0.935, -0.680, 1.180, 1.90, 0.30],
    [-1.40, 0.890, -0.700, 1.330, 1.98, 0.245],
    [-0.80, 0.865, -0.705, 1.375, 1.70, 0.205],
    [0.00, 0.840, -0.700, 1.385, 1.50, 0.19],
    [1.00, 0.810, -0.680, 1.370, 1.47, 0.19],
    [2.00, 0.780, -0.645, 1.340, 1.45, 0.19],
    [3.00, 0.745, -0.595, 1.290, 1.42, 0.2],
    [4.00, 0.705, -0.535, 1.210, 1.38, 0.21],
    [5.00, 0.655, -0.465, 1.080, 1.34, 0.235],
    [6.00, 0.590, -0.380, 0.880, 1.30, 0.24],
    [6.80, 0.520, -0.300, 0.660, 1.24, 0.235],
    [7.40, 0.430, -0.210, 0.440, 1.02, 0.22],
    [7.95, 0.290, -0.120, 0.200, 0.30, 0.18],
  ];
  const FS = FT.map((r) => {
    const yc = (r[1] + r[2]) / 2, top = (r[1] - r[2]) / 2, z = r[0];
    const st = { z, y: yc, w: r[3], top, bot: top };
    if (z < -6.5) { st.kTop = 0.6; st.kBot = 0.62; st.aTop = 78; st.aBot = 80; }
    else if (z < -3.5) { st.kTop = 0.62; st.kBot = 0.7; }
    else { st.kTop = [0.42, 0.66]; st.kBot = [0.78, 0.86]; }
    if (r[4]) st.chine = { w: r[4], y: r[5] - yc, tu: z < -1.5 ? 0.06 : 0.1, tl: z < -1.5 ? 0.05 : 0.09, k: 0.12, e: z < -1.5 ? 1.0 : 1.4 };
    return st;
  });
  const probe = K.loft({ stations: FS, segments: seg, step: 0.2 });
  const tAtX = (z, x, lo = 0, hi = 0.25) => { for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2, px = probe.at(z, m).p[0]; if ((px < x) === (lo < hi ? true : false)) lo = m; else hi = m; } return (lo + hi) / 2; };
  const T_SILL = probe.tAtY(-4.4, 0.62);
  const tMlg0 = tAtX(-0.3, 0.6), tMlg1 = tAtX(-0.3, 1.36);
  const fus = K.loft({
    stations: FS, segments: seg, step: 0.11 / detail, chart: cFus, creases: ['side'], capEnd: 'flat', capUV: U.dark,
    cutouts: [
      { name: 'cockpit', z: [-6.15, -3.2], t: [T_SILL, 1 - T_SILL] },
      { name: 'ng', z: [-6.35, -4.55], t: [0, 0.07], mirror: true },
      { name: 'mlg', z: [-1.55, 0.12], t: [tMlg0, tMlg1], mirror: true },
    ],
  });
  cFus.body = fus;
  stat.add(fus.mesh);
  // y of the upper skin at (x, z) — for parts that sit on the LERX / spine
  const upperAt = (z, x) => { let lo = 0.25, hi = 0.5; for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2; if (fus.at(z, m).p[0] > x) lo = m; else hi = m; } return fus.at(z, (lo + hi) / 2).p[1]; };

  // ---- canopy: fixed windscreen + rear-hinged bubble with one arch -------------------------------------------------------------
  const canTop = K.pchip([-6.15, -6.0, -5.8, -5.55, -5.25, -4.95, -4.65, -4.3, -3.95, -3.6, -3.35, -3.2], [0.0, 0.88, 1.06, 1.22, 1.34, 1.41, 1.43, 1.41, 1.33, 1.21, 1.125, 1.085]);
  const canZ = [-6.15, -6.06, -5.92, -5.74, -5.52, -5.25, -4.95, -4.65, -4.3, -3.95, -3.6, -3.35, -3.2];
  const canSt = canZ.map((z) => { const s = fus.at(z, T_SILL).p; const top = z <= -6.15 ? 0.02 : canTop(z) - s[1]; return { z, y: s[1], w: s[0], top: Math.max(0.02, top), bot: 0.01, kTop: [0.6, 0.62] }; });
  const cseg = Math.max(16, Math.round(32 * detail / 4) * 4), ct = 1 / cseg;
  const canLoft = (zr, tr, inflate, uv) => K.loft({ stations: canSt, segments: cseg, step: 0.1, tRange: tr, zRange: zr, inflate, uv }).mesh;
  const Z_WS = -5.6;
  const Z_C0 = -6.15, Z_C1 = -3.2;
  const glassFixed = canLoft([Z_C0, Z_WS], [0.25, 0.75], 0, [0, 0]);
  const glassMove = canLoft([Z_WS, Z_C1], [0.25, 0.75], 0, [0, 0]);
  stat.add(canLoft([Z_WS - 0.07, Z_WS], [0.25, 0.75], 0.006, U.frame));                               // windscreen arch
  stat.add(canLoft([Z_C0, Z_WS], [0.25, 0.25 + ct], 0.004, U.frame)).add(canLoft([Z_C0, Z_WS], [0.75 - ct, 0.75], 0.004, U.frame));
  const frameMove = K.merge(
    canLoft([Z_WS, Z_C1], [0.25, 0.25 + ct], 0.004, U.frame), canLoft([Z_WS, Z_C1], [0.75 - ct, 0.75], 0.004, U.frame),
    canLoft([Z_WS, Z_WS + 0.05], [0.25, 0.75], 0.005, U.frame),                                         // front bow
    canLoft([-4.5, -4.42], [0.25, 0.75], 0.006, U.frame),                                              // single arch behind the pilot
    canLoft([Z_C1 - 0.1, Z_C1], [0.25, 0.75], 0.005, U.frame),                                              // rear frame
  );

  // ---- cockpit -----------------------------------------------------------------------------------------------------------
  const eye = G.pilotEye, tubX = 0.44;
  stat.add(K.tub({ x: tubX, y0: 0.05, y1: 0.66, z0: -6.05, z1: -3.3, uv: U.interior, taper: 0.85 }));
  stat.add(K.prism([[-4.6, 0.6], [-4.6, 0.92], [-3.25, 0.98], [-3.25, 0.6]], -0.3, 0.3, U.dark));        // avionics deck under the rear canopy
  {  // sill ledge between the skin cut-out and the tub
    const zs = []; for (let z = -6.15; z <= -3.201; z += 0.2) zs.push(z); zs.push(-3.2);
    for (const sx of [1, -1]) {
      let prev = null;
      for (const z of zs) {
        const o = fus.at(z, sx > 0 ? T_SILL : 1 - T_SILL).p, a = stat.vert(o[0], o[1], z, -sx * 0.6, 0.8, 0, U.frame[0], U.frame[1]), b = stat.vert(sx * tubX * 0.9, 0.6, z, -sx * 0.6, 0.8, 0, U.frame[0], U.frame[1]);
        if (prev) { if (sx > 0) stat.quad(prev[0], a, b, prev[1]); else stat.quad(prev[0], prev[1], b, a); }
        prev = [a, b];
      }
    }
  }
  {  // glareshield
    const gs = K.prism([[-6.05, 0.6], [-6.05, 0.66], [-5.64, 0.735], [-5.58, 0.715], [-5.58, 0.6]], -0.33, 0.33, U.black);
    for (let i = 0; i < gs.p.length; i += 3) gs.p[i] *= 0.6 + 0.4 * (gs.p[i + 2] + 6.05) / 0.47;
    stat.add(gs);
  }
  {  // instrument panel (painted chart), consoles, centre stick, throttles
    const z = -5.6, i0 = stat.vertexCount, q = [[-0.43, 0.3], [0.43, 0.3], [0.43, 0.72], [-0.43, 0.72]];
    for (const p of q) { const uv = cPanel.uv(p[0] + 0.43, 0.72 - p[1]); stat.vert(p[0], p[1], z, 0, 0, 1, uv[0], uv[1]); }
    stat.quad(i0, i0 + 1, i0 + 2, i0 + 3);
    for (const sx of [-1, 1]) stat.add(K.box(0.14, 0.1, 1.3, U.console).translate(sx * 0.34, 0.42, -4.75));
    stat.add(K.stick({ base: [0, 0.3, -4.95], height: 0.26, uv: U.black, uvGrip: U.dark }));
    stat.add(K.box(0.07, 0.08, 0.12, U.dark).translate(-0.33, 0.51, -5.0)).add(K.box(0.07, 0.08, 0.12, U.dark).translate(-0.25, 0.51, -5.0));
  }
  stat.add(K.ejectionSeat({ eye, recline: 20, uv: { frame: U.seat, cushion: U.cushion, accent: U.accent } }));
  const hudParts = K.hud({ eye, dist: 0.6, width: 0.17, height: 0.14, drop: 0.03, uv: U.black });
  stat.add(hudParts.frame);
  const pilotMesh = K.pilot({ eye, recline: 16, stick: [0, -0.47, -0.3], throttle: [-0.29, -0.4, -0.22], uv: { suit: U.suit, helmet: U.helmet, visor: U.visor, dark: U.dark, glove: U.glove } });

  // ---- intakes: raked rectangular boxes under the LERX (duct → lip → outer skin), canted 10° -------------------------------------
  const IN = { z: G.engines[0].intake[2], x: Math.abs(G.engines[0].intake[0]), y: G.engines[0].intake[1], w: 0.38, h: 0.5, lean: 0.16, rakeY: 0.6, rakeX: 0.45 };
  const inSt = (() => {
    const k = 0.985, lip = 0.022, z0 = IN.z;
    const st = (z, x, y, w, h) => ({ z, x, y, w, h, kTop: k, kBot: k });
    return [
      st(z0 + 1.0, 0, 0, (IN.w - lip * 1.3) * 0.86, (IN.h - lip * 1.3) * 0.86), st(z0 + lip * 3, 0, 0, IN.w - lip * 1.3, IN.h - lip * 1.3), st(z0 + lip * 0.6, 0, 0, IN.w - lip * 0.9, IN.h - lip * 0.9),
      st(z0, 0, 0, IN.w, IN.h), st(z0 + lip * 0.6, 0, 0, IN.w + lip * 0.9, IN.h + lip * 0.9), st(z0 + lip * 3, 0, 0, IN.w + lip * 1.6, IN.h + lip * 1.6),
      st(z0 + 0.8, 0, -0.035, IN.w + 0.04, 0.505), st(z0 + 1.6, -0.02, -0.085, IN.w + 0.03, 0.465), st(z0 + 2.4, -0.05, -0.135, IN.w, 0.425), st(z0 + 2.9, -0.08, -0.145, IN.w - 0.08, 0.395),
    ];
  })();
  for (const sx of [1, -1]) {
    const L = K.loft({ stations: inSt, segments: Math.max(32, Math.round(64 * detail / 4) * 4), step: 0.14, capStart: 'flat', capUV: U.black,
      uvFn: (x, y, z, t, ring) => (ring.k < 2.3 ? U.duct : cIn[sx > 0 ? 'R' : 'L'].uv(z, y + IN.y)) });
    // lean (tops outboard), rake (top lip forward, inner edge forward), then move into place
    const m = new THREE.Matrix4().set(
      1, IN.lean, 0, 0,
      0, 1, 0, 0,
      IN.rakeX, -IN.rakeY, 1, 0,
      0, 0, 0, 1);
    const mesh = L.mesh.transform(m).translate(IN.x, IN.y, 0);
    if (sx < 0) stat.add(mesh.mirrorX()); else stat.add(mesh);
  }

  // ---- wings ------------------------------------------------------------------------------------------------------------
  const WY = 0.18, X_FOLD = 3.75, DT = 0.12;
  const zLE = (x) => -1.6 + (x - 1.3) * Math.tan(20.2 * DEG), zTE = (x) => 3.1 - (x - 1.3) * (0.9 / 4.9);
  const zLEo = (x) => zLE(x) - DT;
  const cFold = zTE(X_FOLD) - zLE(X_FOLD), fLEo = (0.15 * cFold + DT) / (cFold + DT);
  const X_TIP = 6.25;
  const mkWing = (side) => K.wing({
    side, airfoil: K.naca6(0.05, 0.004), chordPts: Math.round(12 * detail), spanAxis: 'x', tip: 'flat',
    stations: [
      { x: 0.9, y: WY, z: zLE(0.9), chord: zTE(0.9) - zLE(0.9), tc: 0.055 },
      { x: X_FOLD, y: WY, z: zLE(X_FOLD), chord: cFold, tc: 0.047, twist: -1.5, hard: true },
      { x: X_FOLD + 0.012, y: WY, z: zLEo(X_FOLD + 0.012), chord: zTE(X_FOLD + 0.012) - zLEo(X_FOLD + 0.012), tc: 0.045, twist: -1.5, hard: true },
      { x: X_TIP, y: WY, z: zLEo(X_TIP), chord: zTE(X_TIP) - zLEo(X_TIP), tc: 0.04, twist: -3 },
    ],
    lines: {
      hingeLE: [[0.9, 0.15], [X_FOLD, 0.15], [X_FOLD + 0.012, fLEo], [X_TIP, 0.18]],
      hingeTE: [[0.9, 0.7], [X_FOLD, 0.69], [X_FOLD + 0.012, 0.73], [X_TIP, 0.74]],
    },
    controls: [
      { name: 'lefIn', type: 'flap', span: [1.95, X_FOLD - 0.008], to: 'hingeLE', tail: 1 },
      { name: 'lefOut', type: 'flap', span: [X_FOLD + 0.02, X_TIP - 0.05], to: 'hingeLE', tail: 1 },
      { name: 'flap', type: 'flap', span: [1.5, X_FOLD - 0.03], from: 'hingeTE', nose: 1 },
      { name: 'aileron', type: 'flap', span: [X_FOLD + 0.06, 6.0], from: 'hingeTE', nose: 1 },
    ],
    charts: { upper: side > 0 ? cWT.R : cWT.L, lower: side > 0 ? cWB.R : cWB.L },
  });
  const W = { R: mkWing(1), L: mkWing(-1) };
  stat.add(W.R.mesh).add(W.L.mesh);

  // ---- stabilators, fins ----------------------------------------------------------------------------------------------------
  const ST = { x0: 1.0, x1: 4.3, y0: 0.03, z0: 5.0, c0: 3.5, c1: 1.2, sweep: 35, pivotZ: 6.35 };
  const stabY = (x) => ST.y0 - (x - ST.x0) * Math.tan(2 * DEG);
  const mkStab = (side) => K.wing({
    side, airfoil: K.biconvex(0.045), chordPts: Math.round(9 * detail), spanAxis: 'x', tip: 'flat', root: 'flat',
    stations: [{ x: ST.x0, y: stabY(ST.x0), z: ST.z0, chord: ST.c0, tc: 0.05 }, { x: ST.x1, y: stabY(ST.x1), z: ST.z0 + (ST.x1 - ST.x0) * Math.tan(ST.sweep * DEG), chord: ST.c1, tc: 0.035 }],
    charts: { upper: side > 0 ? cST.R : cST.L, lower: cSB },
  });
  const stab = { R: mkStab(1), L: mkStab(-1) };
  const FN = { x: 1.06, y: 0.22, z: 2.15, c0: 3.85, len: 3.3, zt: 4.55, c1: 1.4, cant: 20 };
  const cantS = Math.sin(FN.cant * DEG), cantC = Math.cos(FN.cant * DEG);
  const mkFin = (side) => K.wing({
    side, airfoil: K.biconvex(0.05), chordPts: Math.round(10 * detail), spanAxis: 'u', tip: 'flat',
    stations: [{ x: FN.x, y: FN.y, z: FN.z, chord: FN.c0, tc: 0.05 }, { x: FN.x + FN.len * cantS, y: FN.y + FN.len * cantC, z: FN.zt, chord: FN.c1, tc: 0.035 }],
    lines: { hinge: [[0.4, 0.7], [2.15, 0.66]] },
    controls: [{ name: 'rudder', type: 'flap', span: [0.42, 2.12], from: 'hinge', nose: 1 }],
    charts: side > 0 ? { upper: cFin.Rin, lower: cFin.Rout } : { upper: cFin.Lin, lower: cFin.Lout },
  });
  const fin = { R: mkFin(1), L: mkFin(-1) };
  stat.add(fin.R.mesh).add(fin.L.mesh);

  // ---- engine nacelles, petal nozzles, afterburner -------------------------------------------------------------------------
  const nacProf = [[0.5, 1.6], [0.545, 3.0], [0.555, 4.6], [0.548, 5.8], [0.535, 6.7], [0.522, 7.36]];
  const NZ = { z0: 7.35, z1: G.engines[0].nozzle[2], r0: 0.522 };
  const nozzles = [], glows = [];
  for (const [i, sx] of [[0, -1], [1, 1]]) {
    const cx = sx * ENG_X;
    stat.add(K.lathe(nacProf, { segments: Math.round(28 * detail), uv: (k, j, r, z) => cNac[sx > 0 ? 'R' : 'L'].uv(z - 1.6, j * 3.5) }).translate(cx, ENG_Y, 0));
    stat.add(K.lathe([[0.5, 7.38], [0.45, 6.9], [0.45, 6.2], [0, 6.2]], { segments: 24, uv: U.exhaust }).translate(cx, ENG_Y, 0));
    for (let k = 0; k < 10; k++) stat.add(K.box(0.025, 0.44, 0.05, U.heat2).translate(0, 0.22, 0).rotateZ(k * Math.PI / 5).translate(cx, ENG_Y, 6.32));
    nozzles.push(K.petalNozzle({ z0: NZ.z0, z1: NZ.z1, r0: NZ.r0, rClosed: 0.40, rOpen: 0.475, petals: 12, centre: [cx, ENG_Y, 0], uvOuter: U.heat, uvInner: U.heat2, thickness: 0.03, chart: cNoz }));
    glows.push(K.afterburnerGlow({ zDeep: 6.36, zExit: NZ.z1 - 0.15, rDeep: 0.43, rExit: 0.38, centre: [cx, ENG_Y, 0] }));
  }

  // ---- wingtip rails + AIM-9X, probes, antennas ---------------------------------------------------------------------------
  for (const sx of [1, -1]) {
    stat.add(K.launchRail({ x: sx * (X_TIP + 0.06), y: WY, z0: zLEo(X_TIP) - 0.55, z1: zTE(X_TIP) - 0.15, w: 0.12, h: 0.13, uv: U.rail }));
    stat.add(K.missile({ length: 3.02, radius: 0.0635, uvBody: U.aim, uvNose: U.aimNose, uvFin: U.aim, canards: { z: 1.0, chord: 0.55, span: 0.035 }, wings: { z: 2.7, chord: 0.3, span: 0.14 } })
      .translate(sx * (X_TIP + 0.165), WY - 0.06, zLEo(X_TIP) - 1.1));
  }
  stat.add(K.probe([0, 0.15, -9.46], [0, 0.15, -9.78], 0.018, U.probe));                                      // nose pitot
  for (const sx of [1, -1]) stat.add(K.probe([sx * 0.4, 0.36, -7.9], [sx * 0.47, 0.36, -8.12], 0.013, U.probe));   // AoA probes
  stat.add(K.bladeAntenna({ pos: [0, upperAt(-1.0, 0.01) - 0.02, -1.0], height: 0.16, chord: 0.24, sweep: 0.12, uv: U.top }));
  stat.add(K.bladeAntenna({ pos: [0, upperAt(2.6, 0.01) - 0.02, 2.6], height: 0.12, chord: 0.2, sweep: 0.1, uv: U.top }));
  stat.add(K.bladeAntenna({ pos: [0, -0.64, -2.6], height: 0.16, chord: 0.22, sweep: 0.1, down: true, uv: U.under }));
  stat.add(K.bladeAntenna({ pos: [0, -0.6, 2.8], height: 0.12, chord: 0.18, sweep: 0.08, down: true, uv: U.under }));
  // underwing pylons (toed out 4°, the Super Hornet signature) and the centreline station
  for (const sx of [1, -1]) for (const [x, len] of [[2.45, 2.3], [3.3, 2.1], [4.75, 1.9]]) {
    const zc = zLE(x) + (x > X_FOLD ? -DT : 0) + (zTE(x) - zLE(x)) * 0.42;
    const py = K.pylon([{ y: WY + 0.02, z0: zc - len / 2, z1: zc + len / 2 }, { y: WY - 0.3, z0: zc - len / 2 + 0.25, z1: zc + len / 2 - 0.12 }], { tc: 0.09, uv: U.under });
    py.translate(0, 0, -zc).rotateY(sx * 4 * DEG).translate(sx * x, 0, zc);
    stat.add(py).add(K.box(0.05, 0.03, len * 0.5, U.dark).translate(sx * x, WY - 0.31, zc));
  }
  stat.add(K.pylon([{ y: -0.6, z0: -0.4, z1: 1.6 }, { y: -0.92, z0: -0.15, z1: 1.45 }], { tc: 0.1, uv: U.under }));

  // ---- gear wells ---------------------------------------------------------------------------------------------------------
  const P = fus.patches;
  stat.add(K.well(P.mlgR, 0.3, U.well)).add(K.well(P.mlgL, 0.3, U.well));
  const ngPatch = K.merge(P.ngR, P.ngL);
  stat.add(K.well(ngPatch, 0.4, U.well, [0, 1, 0]));

  // ---- LERX spoilers (speedbrake) -----------------------------------------------------------------------------------------
  const lerxSpoiler = (sx) => {
    const zA = -2.75, zB = -2.15, xA = 1.02, xB = 1.42;
    const c = [[xA, zA], [xB, zA], [xB, zB], [xA, zB]].map(([x, z]) => [sx * x, upperAt(z, x) + 0.004, z]);
    return { mesh: K.plate(c[0], c[1], c[2], c[3], 0.015, U.top), hingeA: [sx * xA, c[0][1], zA], hingeB: [sx * xB, c[1][1], zA], ref: [sx * (xA + xB) / 2, c[2][1], zB] };
  };

  // ---- materials ---------------------------------------------------------------------------------------------------------
  lap('geometry');
  paint(atlas, { SC, fus, W, fin, cFus, cWT, cWB, cST, cSB, cFin, cNac, cIn, cPanel, cNoz, paintF, X_FOLD, X_TIP, zLE, zLEo, zTE, ST, T_SILL, chY: K.pchip(FT.filter((r) => r[4]).map((r) => r[0]), FT.filter((r) => r[4]).map((r) => r[5])) });
  lap('paint');
  const mat = atlas.material(ctx, { envMapIntensity: 1 });
  lap('textures');
  rig.material('paint', mat, { shared: true });
  rig.disposables.push(atlas);
  rig.glass('canopy', K.glassMaterial(ctx, K.GLASS.gold));
  rig.glass('hud', K.glassMaterial(ctx, K.GLASS.hud));
  const glowMats = [0, 1].map((i) => rig.material('glow' + i, K.glowMaterial(), { shadow: false }));

  rig.addStatic(stat, 'paint');
  rig.addStatic(glassFixed, 'canopy');
  rig.addStatic(hudParts.glass, 'hud');

  // ---- moving parts ------------------------------------------------------------------------------------------------------
  const CP = [0, 1.04, -3.24];
  const canopyNode = rig.node('canopy', { pivot: CP });
  rig.part('canopyGlass', glassMove, { parent: canopyNode, key: 'canopy' });
  rig.part('canopyFrame', frameMove, { parent: canopyNode });
  const setCanopy = rig.hinge(canopyNode, [-1, CP[1], CP[2]], [1, CP[1], CP[2]], { ref: [0, 1.2, -5.6], toward: [0, 1, 0] });
  const pilotNode = rig.part('pilot', pilotMesh, { pivot: eye });

  const hp = (name, c, o) => rig.hingePart(name, c, o);
  const flapR = hp('flapR', W.R.controls.flap), flapL = hp('flapL', W.L.controls.flap);
  const ailR = hp('aileronR', W.R.controls.aileron), ailL = hp('aileronL', W.L.controls.aileron);
  const lefIR = hp('lefInR', W.R.controls.lefIn), lefIL = hp('lefInL', W.L.controls.lefIn);
  const lefOR = hp('lefOutR', W.R.controls.lefOut), lefOL = hp('lefOutL', W.L.controls.lefOut);
  const rudR = hp('rudderR', fin.R.controls.rudder, { toward: [1, 0, 0] }), rudL = hp('rudderL', fin.L.controls.rudder, { toward: [1, 0, 0] });
  const mkStabPart = (name, s, sx) => {
    const a = [sx * ST.x0, stabY(ST.x0), ST.pivotZ], b = [sx * ST.x1, stabY(ST.x1), ST.pivotZ];
    const node = rig.part(name, s.mesh, { pivot: a });
    return rig.hinge(node, a, b, { ref: [sx * 2.2, stabY(2.2), 8.2], toward: [0, 1, 0] });
  };
  const setStabR = mkStabPart('stabR', stab.R, 1), setStabL = mkStabPart('stabL', stab.L, -1);
  const spoilers = [1, -1].map((sx) => { const s = lerxSpoiler(sx); const node = rig.part(sx > 0 ? 'lerxSpoilerR' : 'lerxSpoilerL', s.mesh, { pivot: s.hingeA }); return rig.hinge(node, s.hingeA, s.hingeB, { ref: s.ref, toward: [0, 1, 0] }); });
  const nozNodes = nozzles.map((m, i) => rig.part('nozzle' + i, m, { pivot: [G.engines[i].nozzle[0], ENG_Y, NZ.z0] }));
  glows.forEach((m, i) => rig.part('abGlow' + i, m, { key: 'glow' + i }));
  // arrestor hook: striped bar in a slot under the beaver tail
  const HK = { p: [0, -0.37, 5.5], len: 2.3 };
  const hookMesh = new K.Mesh();
  { const n = 7, dir = [0, 0.035, 1], dl = Math.hypot(...dir), d = dir.map((v) => v / dl);
    for (let k = 0; k < n; k++) { const a = HK.p.map((v, j) => v + d[j] * HK.len * k / n), b = HK.p.map((v, j) => v + d[j] * HK.len * (k + 1) / n); hookMesh.add(K.tube(a, b, 0.045 - 0.012 * k / n, 0.045 - 0.012 * (k + 1) / n, { segments: 8, uv: k % 2 ? U.hookK : U.hookY })); }
    const e = HK.p.map((v, j) => v + d[j] * HK.len);
    hookMesh.add(K.prism([[e[2] - 0.08, e[1] + 0.03], [e[2] + 0.12, e[1] + 0.02], [e[2] + 0.14, e[1] - 0.08], [e[2] + 0.02, e[1] - 0.1], [e[2] - 0.1, e[1] - 0.04]], -0.05, 0.05, U.hookK));
    hookMesh.add(K.box(0.16, 0.08, 0.2, U.dark).translate(HK.p[0], HK.p[1] + 0.02, HK.p[2]));
  }
  const hookNode = rig.part('hook', hookMesh, { pivot: HK.p });
  const setHook = rig.hinge(hookNode, [-1, HK.p[1], HK.p[2]], [1, HK.p[1], HK.p[2]], { ref: [0, HK.p[1], HK.p[2] + 2], toward: [0, -1, 0] });

  // ---- landing gear --------------------------------------------------------------------------------------------------------
  const gp = G.gear;
  const doorOf = (patch, edge, inner = U.well) => ({ mesh: K.thicken(patch, 0.02, inner), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  {  // nose: twin wheels, forward retracting, launch bar
    const c = gp[0].pos, piv = [0, -0.2, -4.72];
    const lb = new K.Mesh();
    lb.add(K.tube([0, -0.86, -4.92], [0, -1.08, -5.62], 0.03, 0.025, { segments: 8, uv: U.lbar }));
    lb.add(K.box(0.12, 0.05, 0.08, U.lbar).translate(0, -1.09, -5.64));
    lb.add(K.box(0.14, 0.1, 0.12, U.lbar).translate(0, -0.84, -4.9));
    lb.add(K.tube([0, -0.58, -4.86], [0, -0.66, -5.05], 0.02, 0.02, { segments: 6, uv: U.lbar }));
    K.buildGear(rig, atlas, {
      name: 'nose', index: 0, contact: c, wheels: [-0.165, 0.165], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.16, pivot: piv, stroke: 0.3, staticFrac: 0.4,
      strutR: 0.065, fork: 'axle', steer: true, links: 'front', retract: { to: [0, -0.24, -5.85] }, window: [0.2, 0.86],
      brace: [0, -0.32, -5.5], extra: lb,
      doors: [
        { name: 'noseDoorR', ...doorOf(P.ngR, fus.edges.ngR.tHi), open: 85, closes: true },
        { name: 'noseDoorL', ...doorOf(P.ngL, fus.edges.ngL.tLo), open: 85, closes: true },
      ],
      lamps: [{ kind: 'landing', pos: G.lights.landing, size: 0.05, color: [1, 0.96, 0.88] }, { kind: 'taxi', pos: [0.07, -0.66, -4.86], size: 0.035, color: [1, 0.96, 0.88] }],
    });
  }
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, edge = fus.edges['mlg' + key];
    K.buildGear(rig, atlas, {
      name: 'main' + key, index: i, contact: c, wheelRadius: gp[i].wheelRadius, wheelWidth: 0.25, pivot: [sx * 1.2, -0.46, -0.05], stroke: 0.35, staticFrac: 0.4,
      strutR: 0.07, fork: 'axle', links: 'rear', retract: { to: [sx * 0.95, -0.46, -1.15], twist: sx * 90 }, window: [0.2, 0.9], brace: [sx * 0.95, -0.52, 0.75],
      doors: [{ name: 'mainDoor' + key, ...doorOf(P['mlg' + key], sx > 0 ? edge.tHi : edge.tLo), open: 95, closes: true }],
    });
  }

  // ---- lamps ---------------------------------------------------------------------------------------------------------------
  const Lt = G.lights;
  rig.lamp('nav', Lt.navLeft, { color: [1, 0.04, 0.02], size: 0.035, squash: [0.7, 0.7, 1.6] });
  rig.lamp('nav', Lt.navRight, { color: [0.02, 1, 0.25], size: 0.035, squash: [0.7, 0.7, 1.6] });
  rig.lamp('nav', Lt.tail, { color: [1, 1, 1], size: 0.03 });
  rig.lamp('strobe', Lt.strobe, { color: [1, 1, 1], size: 0.035 });
  rig.lamp('strobe', [-Lt.strobe[0], Lt.strobe[1], Lt.strobe[2]], { color: [1, 1, 1], size: 0.035 });
  rig.lamp('beacon', Lt.beacon, { color: [1, 0.1, 0.05], size: 0.04 });
  rig.lamp('beacon', [0, -0.66, 1.2], { color: [1, 0.1, 0.05], size: 0.04 });

  // ---- animation -----------------------------------------------------------------------------------------------------------
  rig.onUpdate((S) => {
    const sf = S.sf;
    const flapDeg = sf.flaps * 45, droop = sf.flaps * 42;
    flapR.set(-flapDeg * DEG); flapL.set(-flapDeg * DEG);
    ailR.set((sf.aileronR * 25 - droop) * DEG); ailL.set((sf.aileronL * 25 - droop) * DEG);
    const lef = Math.max(sf.slats, sf.flaps * 0.8) * 30;
    lefIR.set(-lef * DEG); lefIL.set(-lef * DEG); lefOR.set(-lef * DEG); lefOL.set(-lef * DEG);
    setStabR(sf.elevatorR * 24 * DEG); setStabL(sf.elevatorL * 24 * DEG);
    const toe = sf.speedbrake * 25;
    rudR.set(Math.max(-30, Math.min(30, sf.rudder * 30 - toe)) * DEG); rudL.set(Math.max(-30, Math.min(30, sf.rudder * 30 + toe)) * DEG);
    for (const s of spoilers) s(sf.speedbrake * 55 * DEG);
    nozNodes.forEach((n, i) => { n.morphTargetInfluences[0] = (S.eng[i] || {}).nozzle ?? 0; K.abGlowColor(glowMats[i].color, S.eng[i] || {}, S.night); });
    setCanopy(sf.canopy * 45 * DEG);
    setHook(sf.hook * 58 * DEG);
    pilotNode.visible = !rig.cameraInCockpit;
  });
  const visual = rig.build();
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

function mixHex(a, b, f) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = [16, 8, 0].map((s) => Math.round(((pa >> s) & 255) * (1 - f) + ((pb >> s) & 255) * f));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// ---- paint -------------------------------------------------------------------------------------------------------------------
function paint(atlas, o) {
  const { SC, fus, W, fin, cFus, cWT, cWB, cST, cSB, cFin, cNac, cIn, cPanel, cNoz, paintF, X_FOLD, X_TIP, chY } = o, F = K.FINISH;
  const top = paintF(SC.top), under = paintF(SC.under), mark = SC.mark, cag = !!SC.cag, wx = SC.weather;
  const rnd = (() => { let a = 1777; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const tone = (hex, d) => mixHex(hex, d > 0 ? '#ffffff' : '#000000', Math.abs(d));
  const slime = { color: '#cfd48f', rough: 0.35, metal: 0 };
  const lowVis = cag ? false : mark;
  // touch-up patches: rectangles of slightly different grey, the hallmark of a hard-worked carrier jet
  const touchUps = (Q, n, a0, a1, b0, b1, base, sa, sb) => {
    for (let i = 0; i < n * wx; i++) {
      const a = a0 + rnd() * (a1 - a0), b = b0 + rnd() * (b1 - b0), w = sa * (0.4 + rnd()), h = sb * (0.4 + rnd());
      Q.fill((g) => g.rect(a, b, w, h), { color: tone(base, (rnd() - 0.45) * 0.1), rough: 0.6 + rnd() * 0.12, metal: 0 }, { alpha: 0.3 + rnd() * 0.4, feather: 1 });
    }
  };
  const yBand = (z) => (z < -6.3 ? 0.12 + (z + 9.5) * 0.08 * 0 : chY(Math.min(z, 7.9)) - 0.035);

  // ================= fuselage =================
  const P = atlas.pen(cFus), tt = (s, v) => (s > 0 ? v : 1 - v);
  P.fill('all', top);
  P.band(-9.5, 7.95, -Infinity, yBand, under, { feather: 5 });
  touchUps(P, 70, -7, 7.6, 0.08, 0.92, SC.top, 0.5, 0.05);
  P.fill((g) => g.rect(-9.5, 0, 2.36, 1), F.semigloss(SC.radome));
  if (wx > 0.5) for (let i = 0; i < 18; i++) { const z = -9.3 + rnd() * 2.0, t = rnd(); P.fill((g) => g.rect(z, t, 0.05 + rnd() * 0.12, 0.004 + rnd() * 0.01), { color: tone(SC.radome, 0.18), rough: 0.5, metal: 0 }, { alpha: 0.6 }); }
  // anti-glare panel ahead of the windscreen
  P.fill([[-7.1, 0.47], [-6.15, 0.43], [-6.15, 0.57], [-7.1, 0.53]], F.matte(tone(SC.top, -0.25)), { feather: 1 });
  if (cag) {
    // black spine with a gold pinstripe, from the canopy to the fins
    P.fill([[-3.2, 0.465], [-1.5, 0.45], [3.8, 0.45], [6.8, 0.47], [6.8, 0.53], [3.8, 0.55], [-1.5, 0.55], [-3.2, 0.535]], F.semigloss(SC.finA));
    for (const s of [1, -1]) P.line([[-3.2, tt(s, 0.465)], [-1.5, tt(s, 0.45)], [3.8, tt(s, 0.45)], [6.8, tt(s, 0.47)]], { px: 2.5, depth: 0, dark: 0, color: SC.finB });
  }
  // panel lines: frames and longerons
  const frames = [-8.1, -7.15, -6.7, -6.15, -5.1, -4.3, -3.2, -2.5, -1.75, -1.0, -0.25, 0.5, 1.3, 2.1, 2.9, 3.7, 4.5, 5.3, 6.1, 6.9, 7.45];
  for (const z of frames) P.ring(z, 0, 1, { px: z === -7.15 ? 1.7 : 1, depth: 0.4, dark: z === -7.15 ? 0.3 : 0.12 });
  for (const s of [1, -1]) {
    for (const tv of [0.32, 0.4, 0.46]) P.line([[-3.2, tt(s, tv)], [7.4, tt(s, tv)]], { px: 1, depth: 0.3, dark: 0.12 });
    for (const tv of [0.05, 0.12, 0.19]) P.line([[-6.15, tt(s, tv)], [7.4, tt(s, tv)]], { px: 1, depth: 0.3, dark: 0.12 });
    // big avionics doors on the forward fuselage
    for (const [z0, z1, t0, t1] of [[-7.0, -6.25, 0.16, 0.3], [-6.1, -5.25, 0.13, 0.27], [-5.15, -4.4, 0.12, 0.26], [-2.4, -1.85, 0.36, 0.44], [-1.6, -0.6, 0.34, 0.44], [0.6, 1.9, 0.36, 0.45], [2.2, 3.5, 0.35, 0.45], [4.6, 5.9, 0.34, 0.43]])
      P.panel(z0, tt(s, t0), z1, tt(s, t1), { px: 1, depth: 0.45, dark: 0.15 });
    for (let k = 0; k < 6; k++) { const z = -2.6 + k * 1.6; P.rivets(z, tt(s, 0.3), z + 1.3, tt(s, 0.3), 0.06, { px: 1.1, depth: 0.15, dark: 0.04 }); }
  }
  P.line([[-9.4, 0], [7.9, 0]], { px: 1, depth: 0.3, dark: 0.12 }); P.line([[-3.2, 0.5], [7.9, 0.5]], { px: 1, depth: 0.3, dark: 0.12 });
  // gun port and gas vents on top of the nose, AoA / pitot bases
  P.decalT(-8.05, 0.5, (g) => { g.fillStyle = '#16181a'; g.beginPath(); g.ellipse(0, 0, 0.16, 0.05, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = 'rgba(25,24,22,0.5)'; g.fillRect(0.1, -0.09, 0.9, 0.18); });
  for (let i = 0; i < 6; i++) P.decalT(-7.6 + i * 0.09, 0.47, (g) => { g.fillStyle = '#2a2c2e'; g.fillRect(-0.025, -0.02, 0.05, 0.04); });
  // cockpit sill: ejection-seat warning triangle and rescue arrow
  for (const s of ['L', 'R']) {
    P.decalOn(-6.55, 0.58, s, (g) => { g.fillStyle = '#c0262b'; g.beginPath(); g.moveTo(-0.08, -0.07); g.lineTo(0.08, -0.07); g.lineTo(0, 0.07); g.closePath(); g.fill(); g.fillStyle = '#e8e8e8'; g.font = '700 0.07px sans-serif'; g.textAlign = 'center'; g.fillText('!', 0, -0.0); });
    P.textOn('RESCUE', -6.3, 0.18, s, 0.045, { color: cag ? '#b3202a' : mark });
  }
  // formation strip lights
  for (const [z, y, w] of [[-7.55, 0.2, 0.5], [5.3, 0.3, 0.55]]) P.decalOn(z, y, 'both', { layers: ['color', 'orm'] }, (g, layer) => { g.fillStyle = layer === 'orm' ? 'rgb(255,90,0)' : slime.color; g.fillRect(-w / 2, -0.03, w, 0.06); });
  // modex on the nose, squadron on the aft body
  const modexCol = cag ? '#101318' : mark;
  P.textOn(SC.modex, -7.55, 0.08, 'both', 0.32, { color: modexCol, font: K.FONT.sans, weight: 700, outline: cag ? SC.finB : null, outlineWidth: 9 });
  if (cag) {
    P.textOn('STORMRIDERS', 1.4, 0.48, 'both', 0.13, { color: SC.finB, italic: true, font: K.FONT.wide, outline: '#101318', outlineWidth: 10 });
    P.decalOn(-4.9, 0.66, 'both', (g) => { g.fillStyle = SC.finB; g.fillRect(-0.8, -0.012, 1.6, 0.024); });
    P.textOn('CDR J. "SPARKY" MORROW', -5.0, 0.63, 'both', 0.035, { color: '#101318' });
  } else P.textOn('LT B. "DOC" HALVERSEN', -5.0, 0.635, 'both', 0.032, { color: mark });
  // LERX top: NO STEP, walkway outline, fence slots
  for (const s of [1, -1]) {
    P.decalT(-3.3, tt(s, 0.32), { rot: s > 0 ? 90 : -90 }, (g) => K.drawText(g, 'NO STEP', 0.045, { color: cag ? '#101318' : mark }));
    P.line([[-2.2, tt(s, 0.37)], [-0.8, tt(s, 0.38)], [-0.8, tt(s, 0.43)], [-2.2, tt(s, 0.42)], [-2.2, tt(s, 0.37)]], { px: 1.3, depth: 0, dark: 0.45 });
  }
  // weathering: tonal variation, grime trails, belly fluids, exhaust soot on the aft body
  P.noise({ alpha: 0.07 + 0.04 * wx, scale: 2.4, stretch: [1.7, 1], rough: 0.07 });
  P.noise({ alpha: 0.05, scale: 0.8, mode: 'light' });
  for (let i = 0; i < 40 * wx; i++) { const z = -6 + rnd() * 12.5, t = rnd(); P.streak(z, t, z + 0.6 + rnd() * 1.4, t + (rnd() - 0.5) * 0.01, 0.006 + rnd() * 0.014, { alpha: 0.08 + rnd() * 0.14 }); }
  for (let i = 0; i < 26 * wx; i++) { const z = -4 + rnd() * 10, t = (rnd() < 0.5 ? 0.0 : 0.93) + rnd() * 0.07; P.streak(z, t, z + 0.8 + rnd() * 1.5, t, 0.01 + rnd() * 0.02, { alpha: 0.12 + rnd() * 0.2, color: '42,36,28' }); }
  if (wx > 0.7) {   // carrier grime: dark maintenance smudges around the LERX / spine access panels, hydraulic weeps on the belly
    for (let i = 0; i < 30; i++) { const z = -3.5 + rnd() * 9, t = 0.3 + rnd() * 0.4; P.fill((g) => { g.ellipse(z, t, 0.15 + rnd() * 0.35, 0.006 + rnd() * 0.012, 0, 0, Math.PI * 2); }, { color: 'rgba(30,30,28,0.16)' }, { feather: 6 }); }
    for (let i = 0; i < 16; i++) { const z = -2 + rnd() * 7, t = rnd() < 0.5 ? rnd() * 0.08 : 0.92 + rnd() * 0.08; P.streak(z, t, z + 1.5 + rnd() * 2, t, 0.03, { alpha: 0.25, color: '58,46,30', rough: 0.1 }); }
    P.noise({ alpha: 0.06, scale: 3.5, stretch: [2, 1], mode: 'light' });
  }
  P.fill((g) => g.rect(6.6, 0, 1.35, 1), { color: 'rgba(38,34,30,0.4)' }, { feather: 10 });
  for (const tv of [0.0, 0.5]) P.streak(7.9, tv, 5.8, tv, 0.12, { alpha: 0.3 * wx + 0.1 });
  P.streak(-7.9, 0.53, -6.2, 0.53, 0.05, { alpha: 0.35 * wx });          // gun gas soot

  // ================= intake trunk sides =================
  for (const key of ['R', 'L']) {
    const Q = atlas.pen(cIn[key]);
    Q.fill('all', top);
    Q.fill([[-4.45, -0.8], [-0.8, -0.8], [-0.8, -0.32], [-4.45, -0.18]], under, { feather: 6 });
    touchUps(Q, 10, -4.3, -1.2, -0.6, 0.35, SC.top, 0.4, 0.15);
    for (const z of [-3.1, -2.2, -1.4]) Q.line([[z, -0.75], [z, 0.45]], { px: 1, depth: 0.4, dark: 0.13 });
    Q.panel(-3.6, -0.45, -2.6, 0.2, { px: 1, depth: 0.45, dark: 0.15, r: 0.03 });
    Q.line([[-4.4, 0.32], [-0.9, 0.12]], { px: 1, depth: 0.35, dark: 0.12 });
    if (!cag) Q.decal(-2.1, -0.05, (g) => K.drawStarBar(g, 0.56, { lowVis }));
    else Q.decal(-2.1, -0.05, (g) => K.drawStarBar(g, 0.56, {}));
    Q.text('DANGER', -3.85, 0.1, 0.05, { color: '#b3202a' });
    Q.decal(-3.85, -0.05, (g) => { g.strokeStyle = '#b3202a'; g.lineWidth = 0.02; g.beginPath(); g.moveTo(-0.15, 0.06); g.lineTo(0, -0.08); g.lineTo(0.15, 0.06); g.closePath(); g.stroke(); });
    Q.noise({ alpha: 0.08, scale: 1.2, rough: 0.06 });
    for (let i = 0; i < 8 * wx; i++) { const z = -3.8 + rnd() * 2.5, y = -0.5 + rnd() * 0.9; Q.streak(z, y, z + 0.6 + rnd(), y - 0.05, 0.02, { alpha: 0.12 }); }
  }

  // ================= nacelles (a = z - 1.6 along the body, b = around: 0 bottom, .875 outboard on the right) =================
  for (const key of ['R', 'L']) {
    const Q = atlas.pen(cNac[key]), out = key === 'R' ? 0.875 : 2.625;
    Q.fill('all', under);
    Q.fill((g) => g.rect(0, out - 0.6, 5.8, 1.6), top, { feather: 8 });
    for (const a of [1.2, 2.3, 3.4, 4.5, 5.3]) Q.line([[a, 0], [a, 3.5]], { px: 1, depth: 0.4, dark: 0.12 });
    for (const b of [0.4, 1.4, 2.1, 3.1]) Q.line([[0, b], [5.8, b]], { px: 1, depth: 0.3, dark: 0.1 });
    Q.panel(3.5, out - 0.35, 4.4, out + 0.3, { px: 1, depth: 0.45, dark: 0.15 });
    const rot = key === 'R' ? 180 : 0;
    Q.text('NAVY', 2.4, out - 0.05, 0.2, { color: cag ? '#101318' : mark, rot, font: K.FONT.wide });
    Q.text(`BuNo ${SC.buno}`, 2.4, out + (key === 'R' ? 0.22 : -0.22), 0.05, { color: cag ? '#101318' : mark, rot });
    Q.fill((g) => g.rect(4.4, 0, 1.4, 3.5), { color: 'rgba(34,30,26,0.55)' }, { feather: 14 });
    Q.noise({ alpha: 0.1, scale: 1.0, stretch: [2, 1], rough: 0.08 });
    for (let i = 0; i < 12; i++) { const b = rnd() * 3.5, a = 3 + rnd() * 2; Q.streak(a, b, a + 1.2, b, 0.04, { alpha: 0.2 }); }
  }

  // ================= wings =================
  for (const key of ['R', 'L']) {
    const s = key === 'R' ? 1 : -1, wg = W.R;
    const at = (x, f) => { const p = wg.at(x, f); return [p[0] * s, p[2]]; };
    const hTE = (x) => wg.lines.hingeTE.at(wg.spanToU(x)), hLE = (x) => wg.lines.hingeLE.at(wg.spanToU(x));
    for (const [chart, fin2, isTop] of [[cWT[key], top, true], [cWB[key], under, false]]) {
      const Q = atlas.pen(chart), ln = (pts, op) => Q.line(pts, op);
      Q.fill('all', fin2);
      touchUps(Q, 22, s > 0 ? 1.2 : -6.0, s > 0 ? 6.0 : -1.2, -1.5, 2.8, isTop ? SC.top : SC.under, 0.5, 0.3);
      if (cag && isTop) { Q.fill([at(X_TIP - 0.6, 0.02), at(X_TIP, 0.02), at(X_TIP, 0.98), at(X_TIP - 0.6, 0.98)], F.semigloss(SC.finA)); Q.fill([at(X_TIP - 0.68, 0.02), at(X_TIP - 0.6, 0.02), at(X_TIP - 0.6, 0.98), at(X_TIP - 0.68, 0.98)], F.semigloss(SC.finB)); }
      for (const f of [0.08, 0.33, 0.55]) ln([at(1.3, f), at(X_TIP - 0.05, f)], { px: 1, depth: 0.35, dark: 0.14 });
      for (const x of [1.9, 2.6, 3.2, 4.4, 5.1, 5.7]) ln([at(x, 0.03), at(x, 0.97)], { px: 1, depth: 0.35, dark: 0.14 });
      ln([at(X_FOLD + 0.006, 0), at(X_FOLD + 0.006, 1)], { px: 2, depth: 0.8, dark: 0.45 });                                // fold joint
      ln([at(1.5, hTE(1.5)), at(X_FOLD - 0.03, hTE(X_FOLD - 0.03)), at(X_FOLD - 0.03, 1)], { px: 2, depth: 0.8, dark: 0.55 });  // flap
      ln([at(1.5, hTE(1.5)), at(1.5, 1)], { px: 2, depth: 0.8, dark: 0.55 });
      ln([at(X_FOLD + 0.06, 1), at(X_FOLD + 0.06, hTE(X_FOLD + 0.06)), at(6.0, hTE(6.0)), at(6.0, 1)], { px: 2, depth: 0.8, dark: 0.55 });  // aileron
      ln([at(1.95, 0), at(1.95, hLE(1.95)), at(X_FOLD, hLE(X_FOLD))], { px: 2, depth: 0.8, dark: 0.55 });                    // LEFs
      ln([at(X_FOLD + 0.02, hLE(X_FOLD + 0.02)), at(X_TIP - 0.05, hLE(X_TIP - 0.05)), at(X_TIP - 0.05, 0)], { px: 2, depth: 0.8, dark: 0.55 });
      for (const f of [0.08, 0.33, 0.55]) { const a = at(1.4, f + 0.012), b = at(X_TIP - 0.1, f + 0.012); Q.rivets(a[0], a[1], b[0], b[1], 0.04, { px: 1.1, depth: 0.15, dark: 0.04 }); }
      if (isTop) {   // walkway outline near the root, leading-edge wear, hinge-line grime
        ln([at(1.45, 0.2), at(2.5, 0.2), at(2.5, 0.52), at(1.45, 0.52), at(1.45, 0.2)], { px: 1.4, depth: 0, dark: 0.5 });
        Q.fill([at(1.45, 0.2), at(2.5, 0.2), at(2.5, 0.52), at(1.45, 0.52)], { color: 'rgba(40,40,40,0.18)' });
        const le = [at(1.95, 0.006), at(X_TIP - 0.1, 0.006)];
        Q.wear((g) => { g.moveTo(le[0][0], le[0][1]); g.lineTo(le[1][0], le[1][1]); }, 0.035, { color: tone(SC.top, 0.25), rough: 0.5, metal: 0.2 }, { alpha: 0.5 });
        const p = at(2.2, 0.62); Q.text('NO STEP', p[0], p[1], 0.05, { color: cag ? '#101318' : mark });
        Q.fill((g) => { const a = at(X_TIP - 0.4, 0.25); g.rect(a[0] - 0.02, a[1], 0.04, 0.5); }, slime);
      }
      Q.noise({ alpha: 0.07 + 0.03 * wx, scale: 1.6, stretch: [1, 2.2], rough: 0.06 });
      Q.noise({ alpha: 0.04, scale: 0.5, mode: 'light' });
      for (let i = 0; i < 14 * wx; i++) { const x = 1.6 + rnd() * 4.2, f = x < X_FOLD ? hTE(x) : hTE(x), a = at(x, f - 0.25 * rnd()); Q.streak(a[0], a[1], a[0], a[1] + 0.3 + rnd() * 0.5, 0.025 + rnd() * 0.03, { alpha: 0.16 }); }
      if (isTop && key === 'L') Q.decal(-4.6, 1.1, (g) => K.drawStarBar(g, 0.62, { lowVis }));
      if (!isTop && key === 'R') { Q.decal(4.6, 1.1, (g) => K.drawStarBar(g, 0.62, { lowVis })); }
      if (!isTop && key === 'L') Q.text('NAVY', -4.3, 1.1, 0.42, { color: cag ? '#101318' : mark, font: K.FONT.wide, rot: -90 });
    }
  }
  // ================= stabilators =================
  for (const [chart, f, isTop, sx] of [[cST.R, top, true, 1], [cST.L, top, true, -1], [cSB, under, false, 1]]) {
    const Q = atlas.pen(chart); Q.fill('all', f);
    touchUps(Q, 8, sx > 0 ? 1.2 : -4.2, sx > 0 ? 4.2 : -1.2, 5.2, 8.4, isTop ? SC.top : SC.under, 0.4, 0.3);
    if (cag && isTop) Q.fill((g) => g.rect(sx > 0 ? 3.75 : -4.35, 4.95, 0.6, 3.7), F.semigloss(SC.finA));
    for (const zz of [6.0, 6.9, 7.7]) Q.line([[sx * 1.05, zz], [sx * 4.25, zz + 0.9]], { px: 1, depth: 0.35, dark: 0.13 });
    for (const x of [1.8, 2.6, 3.4]) Q.line([[sx * x, 4.95], [sx * x, 8.65]], { px: 1, depth: 0.3, dark: 0.12 });
    Q.noise({ alpha: 0.09, scale: 1.0, stretch: [1, 2], rough: 0.06 });
    if (isTop) Q.fill((g) => g.rect(sx * 1.3 - 0.4, 7.6, 0.8, 1.0), { color: 'rgba(36,32,28,0.4)' }, { feather: 10 });
  }
  // ================= fins (side charts: a = z, b = y) =================
  for (const key of ['Rout', 'Lout', 'Rin', 'Lin']) {
    const Q = atlas.pen(cFin[key]), outer = key.endsWith('out'), fr = fin.R;
    const at = (u, f) => { const p = fr.at(u, f); return [p[2], p[1]]; };
    const hz = (u) => fr.lines.hinge.at(fr.spanToU(u));
    Q.fill('all', top);
    touchUps(Q, 6, 2.3, 5.6, 0.6, 3.0, SC.top, 0.3, 0.2);
    if (cag) {
      Q.fill([at(1.1, 0), at(3.4, 0), at(3.4, 1), at(1.1, 1)], F.semigloss(SC.finA));
      Q.fill([at(1.0, 0), at(1.1, 0), at(1.1, 1), at(1.0, 1)], F.semigloss(SC.finB));
      // lightning bolt
      const b = [at(3.12, 0.16), at(3.12, 0.36), at(2.42, 0.56), at(2.5, 0.68), at(1.18, 0.93), at(2.05, 0.5), at(1.97, 0.38)];
      Q.fill(b, F.semigloss(SC.finB)); Q.stroke((g) => { b.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); }, 0.03, F.semigloss(SC.finC));
      Q.fill([at(3.18, 0), at(3.4, 0), at(3.4, 1), at(3.18, 1)], F.semigloss(SC.finB));
    }
    Q.line([at(0.42, 1), at(0.42, hz(0.42)), at(2.12, hz(2.12)), at(2.12, 1)], { px: 2, depth: 0.8, dark: 0.55 });
    for (const u of [0.9, 1.5, 2.6, 3.0]) Q.line([at(u, 0.03), at(u, u < 2.12 ? hz(u) : 0.97)], { px: 1, depth: 0.35, dark: 0.14 });
    for (const f of [0.2, 0.45]) Q.line([at(0.3, f), at(3.25, f)], { px: 1, depth: 0.35, dark: 0.14 });
    Q.fill([at(3.1, 0.0), at(3.3, 0.0), at(3.3, 0.18), at(3.1, 0.18)], F.composite(tone(SC.top, -0.15)));
    if (outer) {
      const c = at(2.45, 0.42), d = at(1.2, 0.36);
      Q.text(SC.code, c[0], c[1], 0.5, { color: cag ? SC.finB : mark, weight: 700, outline: cag ? '#101318' : null, outlineWidth: 6 });
      if (!cag) { Q.decal(d[0], d[1], (g) => { g.strokeStyle = mark; g.lineWidth = 0.02; g.beginPath(); g.arc(0, 0, 0.2, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(-0.05, -0.17); g.lineTo(0.08, -0.03); g.lineTo(-0.01, -0.01); g.lineTo(0.06, 0.16); g.lineTo(-0.08, 0.0); g.lineTo(0.01, -0.02); g.closePath(); g.stroke(); }); }
      const m = at(0.75, 0.5); Q.text(SC.squadron, m[0], m[1], 0.07, { color: cag ? SC.finB : mark });
      const fl = at(2.75, 0.5); Q.fill((g) => g.rect(fl[0] - 0.25, fl[1] - 0.03, 0.5, 0.06), slime);
    }
    Q.noise({ alpha: 0.08, scale: 1.2, stretch: [1, 1.5], rough: 0.05 });
  }
  // ================= nozzle petals (a = around, b = hinge → exit) =================
  {
    const Q = atlas.pen(cNoz), n = 12, w = 3.2 / n;
    Q.fill('all', { color: '#80786f', rough: 0.5, metal: 0.8 });
    for (let i = 0; i < n; i++) {
      if (i % 2) Q.fill((g) => g.rect(i * w, 0, w, 1.2), { color: '#71695f', rough: 0.55, metal: 0.8 });
      Q.fill((g) => g.rect(i * w + w * 0.3, 0.06, w * 0.4, 1.05), { color: '#968b80', rough: 0.45, metal: 0.8 }, { alpha: 0.5 });
      Q.line([[i * w, 0], [i * w, 1.2]], { px: 2, depth: 0.9, dark: 0.6 });
      Q.rivets(i * w + w * 0.15, 0.1, i * w + w * 0.15, 1.1, 0.08, { px: 1.2, depth: 0.2, dark: 0.1 });
    }
    Q.fill((g) => g.rect(0, 0.75, 3.2, 0.45), { color: '#4a3f38', rough: 0.6, metal: 0.8 }, { alpha: 0.5, feather: 6 });
    Q.fill((g) => g.rect(0, 0, 3.2, 0.09), { color: '#5a5550', rough: 0.5, metal: 0.8 });
    Q.noise({ alpha: 0.12, scale: 0.8, stretch: [1, 2] });
  }
  // ================= instrument panel (a = across, b = down from the top) =================
  {
    const Q = atlas.pen(cPanel); Q.fill('all', { color: '#191b1d', rough: 0.6, metal: 0 });
    const scr = (a, b, w, h, col) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#050607', rough: 0.15, metal: 0 }); Q.fill((g) => g.rect(a + 0.01, b + 0.01, w - 0.02, h - 0.02), { color: col, rough: 0.12, metal: 0, emissive: col }); };
    scr(0.06, 0.12, 0.2, 0.2, '#2e7a46'); scr(0.6, 0.12, 0.2, 0.2, '#3a6e8a'); scr(0.32, 0.18, 0.22, 0.22, '#4a7a3a'); scr(0.33, 0.02, 0.2, 0.1, '#6a8a3a');
    for (let i = 0; i < 10; i++) for (const a of [0.035, 0.29, 0.585, 0.825]) Q.fill((g) => g.rect(a, 0.13 + i * 0.019, 0.012, 0.01), { color: '#5a5c5e', rough: 0.5, metal: 0 });
  }
}
