// Boeing F/A-18E Super Hornet — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (1.55) when parked.
//
// Design frame: the airframe is modelled in a frame 0.30 m below the body frame (YB) and lifted after the rig is built,
// so the jet stands on its tall carrier gear (wing underside ≈ 2.0 m above the deck, LEX above head height, canopy sill
// ≈ 2.5 m) while the gear contact points stay exactly at geometry.gear[i].pos. Everything below is in the design frame
// unless it says "body frame" (gear, lamps on legs, halos, values read from geometry.js minus YB).
//
// Reference numbers (docs/aircraft/fa18.md, body z = distance from the nose - 9.5, design-frame y):
//   length 18.31 (nose z -9.5 … tail 8.81), span 13.62 over the AIM-9X fins, height 4.88 (fin tips at body y 3.33).
//   Fuselage: radome to z -7.15, windscreen base z -6.15, canopy peak y 1.43 at z -4.65, eye [0, .85, -5.2].
//   LEX: from the windscreen (z -6.3) to the wing LE at x 2.0 / z -1.35, LE sweep ≈ 72°, sharp edge, at y .56 → .19.
//   Intakes: raked rectangular "caret" boxes under the LEX, lip at z -3.8, centre x ±1.08 / y -.1, .76 × 1.0 m,
//            canted 9° (tops outboard), lip raked 31° in side view and 24° in plan, ducts 2.4 m deep (dark).
//   Wing: root LE z -1.6 at x 1.3, chord 4.7 → tip x 6.25 chord 2.1, LE sweep 20.2°, TE swept forward, y .18, 5.5–4 %.
//         Fold at x 3.75 with a 0.12 m dogtooth on the outer LE flap; LEF 15 %, flaps 30 % inboard, ailerons outboard.
//   Stabilators: root x 1.0 chord 3.5 (LE z 5.0), tip x 4.3 chord 1.2, 35° LE sweep, 2° anhedral, pivot z 6.35.
//   Fins: canted 20° out, root at x ±1.06 (LE z 2.15, chord 3.85), slant span 2.99 → tip at body y 3.33, rudders low.
//   Engines: nacelles r .55 at x ±0.72 / y .05; petal nozzles z 7.35 → 8.55, exit r .40 – .48.
//   Gear (body frame): nose twin wheels r .26 at z -4.85 (launch bar), mains r .36 at x ±1.7 / z .55, all on y -1.55.
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
const YB = 0.3;                       // design frame → body frame lift
export const LIVERIES = ['navy', 'cag', 'jolly'];

// Real unit markings are fine, serials / names invented.
const SCHEMES = {
  navy: {
    name: 'Line jet, VFA-177 "Stormriders", TPS greys, heavily weathered', top: '#5f676e', under: '#868d94', radome: '#6a7278', rough: 0.68, mark: '#3d434a',
    code: 'NX', modex: '211', squadron: 'VFA-177', buno: '169213', pilot: 'LT B. "DOC" HALVERSEN', weather: 1, seed: 1777,
  },
  cag: {
    name: 'CAG bird, VFA-177 "Stormriders"', top: '#646c73', under: '#8b9298', radome: '#6f777d', rough: 0.55, mark: '#1d2430',
    code: 'NX', modex: '200', squadron: 'VFA-177', buno: '169200', pilot: 'CDR J. "SPARKY" MORROW', weather: 0.4, seed: 2024, cag: 'storm',
    finA: '#141a24', finB: '#d4a017', finC: '#b3202a',
  },
  jolly: {
    name: 'CAG bird, VFA-103 "Jolly Rogers"', top: '#61696f', under: '#899096', radome: '#6c7379', rough: 0.6, mark: '#25292e',
    code: 'AG', modex: '200', squadron: 'VFA-103', buno: '169311', pilot: 'CDR K. "BONES" ADAIR', weather: 0.6, seed: 3141, cag: 'jolly',
    finA: '#0c0d0f', finB: '#ecebe4', finC: '#d6ac24',
  },
};

/** Flat plate from a plan outline [[z, x], …], thickness t centred on y = 0. */
function planPlate(outline, t, uv) { return K.prism(outline.map(([z, x]) => [z, -x]), -t / 2, t / 2, uv); }

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'navy', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const paintF = (c) => ({ color: c, rough: SC.rough, metal: 0 });
  const seg = Math.max(32, Math.round(76 * detail / 4) * 4);
  const ENG_X = Math.abs(G.engines[0].nozzle[0]), ENG_Y = G.engines[0].nozzle[1] - YB;
  const D = (p) => [p[0], p[1] - YB, p[2]];           // body frame → design frame

  // ---- atlas ------------------------------------------------------------------------------------------------------------
  const atlas = K.createAtlas({ size: atlasSize, base: paintF(SC.top), skin: { weathering: 0.25 + 0.5 * SC.weather, framePitch: 0.38 } });
  const cFus = atlas.chart('fus', { type: 'unwrap', z: [-9.5, 7.95], girth: 7.4, vScale: 0.9, strips: 2 });
  const WX = [0.9, 6.3], WZ = [-1.9, 3.25];
  const cWT = { R: atlas.chart('wingTopR', { type: 'plan', x: WX, z: WZ, view: 'top' }), L: atlas.chart('wingTopL', { type: 'plan', x: [-WX[1], -WX[0]], z: WZ, view: 'top' }) };
  const cWB = { R: atlas.chart('wingBotR', { type: 'plan', x: WX, z: WZ, view: 'bottom', density: 0.7 }), L: atlas.chart('wingBotL', { type: 'plan', x: [-WX[1], -WX[0]], z: WZ, view: 'bottom', density: 0.7 }) };
  const SX = [0.95, 4.35], SZ = [4.95, 8.65];
  const cST = { R: atlas.chart('stabTopR', { type: 'plan', x: SX, z: SZ, view: 'top', density: 0.8 }), L: atlas.chart('stabTopL', { type: 'plan', x: [-SX[1], -SX[0]], z: SZ, view: 'top', density: 0.8 }) };
  const cSB = atlas.chart('stabBot', { type: 'plan', x: SX, z: SZ, view: 'bottom', mirror: true, density: 0.6 });
  const FZ = [2.05, 5.95], FY = [0.15, 3.1];
  const cFin = {
    Rout: atlas.chart('finRout', { type: 'side', z: FZ, y: FY, view: 'right' }), Lout: atlas.chart('finLout', { type: 'side', z: FZ, y: FY, view: 'left' }),
    Rin: atlas.chart('finRin', { type: 'side', z: FZ, y: FY, view: 'left', density: 0.65 }), Lin: atlas.chart('finLin', { type: 'side', z: FZ, y: FY, view: 'right', density: 0.65 }),
  };
  const cNac = { R: atlas.chart('nacR', { type: 'rect', w: 5.8, h: 3.5, density: 0.6 }), L: atlas.chart('nacL', { type: 'rect', w: 5.8, h: 3.5, density: 0.6 }) };
  const IZ = [-4.45, -0.8], IY = [-0.8, 0.5];
  const cIn = { R: atlas.chart('inR', { type: 'side', z: IZ, y: IY, view: 'right', density: 0.9 }), L: atlas.chart('inL', { type: 'side', z: IZ, y: IY, view: 'left', density: 0.9 }) };
  const cNoz = atlas.chart('nozzle', { type: 'rect', w: 3.2, h: 1.2, density: 0.7 });
  const cTank = atlas.chart('tank', { type: 'rect', w: 4.7, h: 2.3, density: 0.45 });
  atlas.pack();
  const sw = (k, f) => atlas.swatch(k, f);
  const U = {
    top: sw('top', paintF(SC.top)), under: sw('under', paintF(SC.under)),
    duct: sw('duct', { color: '#8d8f8c', rough: 0.5, metal: 0 }), ductMid: sw('ductMid', { color: '#5a5d5c', rough: 0.6, metal: 0 }), ductDeep: sw('ductDeep', { color: '#25282a', rough: 0.7, metal: 0 }),
    lip: sw('lip', paintF(mixHex(SC.under, SC.top, 0.35))), dark: sw('dark', F.darkGrey), black: sw('black', F.black),
    exhaust: sw('exhaust', F.exhaust), heat: sw('heat', { color: '#7f776f', rough: 0.5, metal: 0.75 }), heat2: sw('heat2', { color: '#45403c', rough: 0.55, metal: 0.8 }),
    ceramic: sw('ceramic', { color: '#7e776d', rough: 0.62, metal: 0.3 }),
    well: sw('well', F.gearWhite), wellDirty: sw('wellDirty', { color: '#b9b8b0', rough: 0.55, metal: 0 }), interior: sw('interior', F.interior),
    console: sw('console', { color: '#1d1f21', rough: 0.6, metal: 0 }), consoleTop: sw('consoleTop', { color: '#2c2f32', rough: 0.55, metal: 0 }),
    seat: sw('seat', { color: '#25282a', rough: 0.7, metal: 0 }), cushion: sw('cushion', F.fabric), accent: sw('accent', { color: '#d6b21e', rough: 0.5, metal: 0 }),
    suit: sw('suit', { color: '#4d5540', rough: 0.9, metal: 0 }), helmet: sw('helmet', { color: '#8d9296', rough: 0.35, metal: 0 }), visor: sw('visor', { color: '#0a0b0d', rough: 0.05, metal: 0.4 }),
    glove: sw('glove', { color: '#3a3d33', rough: 0.9, metal: 0 }), frame: sw('frame', paintF('#4d5257')), steel: sw('steel', F.steel), mirror: sw('mirror', { color: '#c8ccd0', rough: 0.05, metal: 1 }),
    aim: sw('aim', F.semigloss('#a9adb0')), aimNose: sw('aimNose', { color: '#24272a', rough: 0.2, metal: 0.3 }), rail: sw('rail', paintF(SC.under)),
    amraam: sw('amraam', F.semigloss('#c4c7c8')), pod: sw('pod', paintF('#7b8288')), podGlass: sw('podGlass', { color: '#1a1d22', rough: 0.05, metal: 0.6 }),
    probe: sw('probe', F.bareMetal), hookW: sw('hookW', F.semigloss('#d8d8d2')), hookK: sw('hookK', F.semigloss('#141516')), hookShoe: sw('hookShoe', F.steel),
    lbar: sw('lbar', F.gearWhite), red: sw('red', F.semigloss('#b3202a')), hyd: sw('hyd', { color: '#3b3d3c', rough: 0.45, metal: 0.6 }),
    ladder: sw('ladder', { color: '#c9cbc6', rough: 0.4, metal: 0.4 }), vent: sw('vent', { color: '#202224', rough: 0.7, metal: 0.1 }),
    lens: sw('lens', F.lens), lensRed: sw('lensRed', { color: '#6a1010', rough: 0.1, metal: 0.2 }), lensGrn: sw('lensGrn', { color: '#0e5a24', rough: 0.1, metal: 0.2 }),
    tank: sw('tankGrey', paintF(mixHex(SC.under, '#7f878e', 0.5))),
  };

  const rig = K.createRig(ctx, { geometry: G, name: 'fa18', glassLayer: opts.glassLayer });
  rig.material('paint', null);
  const stat = new K.Mesh();

  // ---- fuselage: one loft from the radome to the beaver tail; the LEX and the aft shelf are a chine -------------------------
  //        z      top     bot     w      chW   chY(abs)
  const FT = [
    [-9.50, 0.150, 0.150, 0.000],
    [-9.46, 0.192, 0.112, 0.046],
    [-9.32, 0.262, 0.054, 0.126],
    [-9.05, 0.352, -0.030, 0.228],
    [-8.60, 0.458, -0.132, 0.338],
    [-8.00, 0.568, -0.242, 0.432],
    [-7.40, 0.650, -0.338, 0.494],
    [-6.80, 0.710, -0.412, 0.534],
    [-6.30, 0.745, -0.465, 0.556, 0.58, 0.565],
    [-5.80, 0.735, -0.505, 0.566, 0.78, 0.56],
    [-5.20, 0.715, -0.530, 0.576, 1.00, 0.55],
    [-4.60, 0.725, -0.550, 0.586, 1.21, 0.53],
    [-4.10, 0.820, -0.565, 0.596, 1.37, 0.50],
    [-3.70, 1.000, -0.580, 0.606, 1.50, 0.47],
    [-3.20, 1.075, -0.605, 0.622, 1.63, 0.43],
    [-2.60, 1.000, -0.645, 0.820, 1.77, 0.37],
    [-2.00, 0.935, -0.685, 1.180, 1.90, 0.30],
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
    if (z < -6.5) { st.kTop = 0.6; st.kBot = [0.66, 0.6]; st.aTop = 78; st.aBot = 74; }
    else if (z < -3.5) { st.kTop = 0.62; st.kBot = [0.78, 0.72]; st.aBot = 84; }
    else { st.kTop = [0.42, 0.66]; st.kBot = [0.8, 0.86]; }
    // LEX: thin, sharp-edged blade with a tight root fillet so it reads as a separate surface from the forebody
    if (r[4]) st.chine = { w: r[4], y: r[5] - yc, tu: z < -1.5 ? 0.042 : 0.1, tl: z < -1.5 ? 0.032 : 0.09, k: z < -1.5 ? 0.05 : 0.12, e: z < -1.5 ? 1.0 : 1.4 };
    return st;
  });
  const probe = K.loft({ stations: FS, segments: seg, step: 0.2 });
  const tAtX = (z, x, lo = 0, hi = 0.25) => { for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2, px = probe.at(z, m).p[0]; if ((px < x) === (lo < hi)) lo = m; else hi = m; } return (lo + hi) / 2; };
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
  // y of the upper skin at (x, z) — for parts that sit on the LEX / spine; t of the upper / lower skin at x
  const tUp = (z, x) => { let lo = 0.25, hi = 0.5; for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (fus.at(z, m).p[0] > x) lo = m; else hi = m; } return (lo + hi) / 2; };
  const upperAt = (z, x) => fus.at(z, tUp(z, x)).p[1];
  const lowerAt = (z, x) => { let lo = 0, hi = 0.25; for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (fus.at(z, m).p[0] < x) lo = m; else hi = m; } return fus.at(z, (lo + hi) / 2).p[1]; };
  lap('fuselage');

  // ---- canopy: fixed windscreen + rear-hinged bubble with one bow ---------------------------------------------------------------
  const canTop = K.pchip([-6.15, -6.0, -5.8, -5.55, -5.25, -4.95, -4.65, -4.3, -3.95, -3.6, -3.35, -3.2], [0.0, 0.88, 1.06, 1.22, 1.34, 1.41, 1.43, 1.41, 1.33, 1.21, 1.125, 1.085]);
  const canZ = [-6.15, -6.06, -5.92, -5.74, -5.52, -5.25, -4.95, -4.65, -4.3, -3.95, -3.6, -3.35, -3.2];
  const canSt = canZ.map((z) => { const s = fus.at(z, T_SILL).p; const top = z <= -6.15 ? 0.02 : canTop(z) - s[1]; return { z, y: s[1], w: s[0], top: Math.max(0.02, top), bot: 0.01, kTop: [0.6, 0.62] }; });
  const cseg = Math.max(16, Math.round(36 * detail / 4) * 4), ct = 1 / cseg;
  const canLoftR = (zr, tr, inflate, uv) => K.loft({ stations: canSt, segments: cseg, step: 0.08, tRange: tr, zRange: zr, inflate, uv });
  const canLoft = (zr, tr, inflate, uv) => canLoftR(zr, tr, inflate, uv).mesh;
  const frameShell = (zr, tr, out = 0.006) => K.merge(canLoft(zr, tr, out, U.frame), canLoft(zr, tr, -0.012, U.frame).flip());   // outer skin + inward-facing inner skin
  const Z_WS = -5.6, Z_C0 = -6.15, Z_C1 = -3.2, Z_BOW = -4.47;
  const glassFixed = canLoft([Z_C0, Z_WS], [0.25, 0.75], 0, [0, 0]);
  const glassMove = canLoft([Z_WS, Z_C1], [0.25, 0.75], 0, [0, 0]);
  stat.add(frameShell([Z_WS - 0.075, Z_WS], [0.25, 0.75], 0.007));                                       // windscreen arch
  stat.add(frameShell([Z_C0, Z_WS], [0.25, 0.25 + ct])).add(frameShell([Z_C0, Z_WS], [0.75 - ct, 0.75]));
  const frameMove = K.merge(
    frameShell([Z_WS, Z_C1], [0.25, 0.25 + ct]), frameShell([Z_WS, Z_C1], [0.75 - ct, 0.75]),
    frameShell([Z_WS, Z_WS + 0.055], [0.25, 0.75]),                                                      // front bow
    frameShell([Z_BOW - 0.05, Z_BOW + 0.05], [0.25, 0.75], 0.007),                                       // bow behind the pilot
    frameShell([Z_C1 - 0.12, Z_C1], [0.25, 0.75]),                                                       // rear frame
  );
  {  // canopy sill rails on the moving frame + the three rear-view mirrors on the windscreen arch + canopy actuator
    for (const sx of [1, -1]) { const pts = []; for (let zz = Z_WS + 0.02; zz <= Z_C1 - 0.02; zz += 0.3) { const s = fus.at(zz, sx > 0 ? T_SILL : 1 - T_SILL).p; pts.push([s[0] - sx * 0.015, s[1] + 0.02, zz]); } frameMove.add(K.pipe(pts, 0.017, { uv: U.frame, segments: 8 })); }
    const yA = canTop(Z_WS) - 0.05;
    for (const [x, ry] of [[-0.2, 0.35], [0, 0], [0.2, -0.35]]) {
      stat.add(K.box(0.11, 0.045, 0.012, U.mirror).rotateX(-0.25).rotateY(ry).translate(x, yA - 0.05 - Math.abs(x) * 0.25, Z_WS + 0.05));
      stat.add(K.box(0.02, 0.03, 0.03, U.dark).translate(x, yA - 0.015 - Math.abs(x) * 0.25, Z_WS + 0.025));
    }
    frameMove.add(K.tube([0, 0.95, -3.35], [0, 1.08, -3.9], 0.022, 0.018, { segments: 8, uv: U.steel }));
  }

  // ---- cockpit -----------------------------------------------------------------------------------------------------------
  const eye = D(G.pilotEye), tubX = 0.44;
  stat.add(K.tub({ x: tubX, y0: 0.05, y1: 0.66, z0: -6.1, z1: -3.3, uv: U.interior, taper: 0.94 }).occlude(0.45));
  stat.add(K.prism([[-4.6, 0.6], [-4.6, 0.9], [-3.25, 0.98], [-3.25, 0.6]], -0.3, 0.3, U.dark));        // avionics deck under the rear canopy
  stat.add(K.box(0.5, 0.02, 1.1, U.consoleTop).translate(0, 0.91, -3.95));
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
  const Z_PNL = -5.84;
  {  // instrument panel (kit: two DDIs, up-front controller, standby, cautions) under a glareshield topping out at ≈ 0.70
    stat.add(K.instrumentPanel({ eye, kind: 'fighter', dist: 0.64, drop: 0.43, height: 0.4, width: 0.8, centreDisplay: 'mfdHsd', pages: ['mfdStores', 'mfdRadar'], uv: U.console, uvPad: U.black }));
    stat.add(K.box(0.84, 0.04, 0.12, U.console).translate(0, 0.25, Z_PNL + 0.1));
    // side consoles with their panels, left throttles, centre stick, map case / canopy handle
    for (const sx of [-1, 1]) {
      stat.add(K.box(0.15, 0.12, 1.45, U.console).translate(sx * 0.345, 0.43, -4.75));
      stat.add(K.box(0.135, 0.008, 1.35, U.consoleTop).translate(sx * 0.345, 0.494, -4.72));
      for (let k = 0; k < 5; k++) stat.add(K.box(0.12, 0.006, 0.006, U.dark).translate(sx * 0.345, 0.5, -5.3 + k * 0.27));
    }
    stat.add(K.stick({ base: [0, 0.32, -4.98], height: 0.27, uv: U.black, uvGrip: U.dark }));
    stat.add(K.ellipsoid(0.06, 0.02, 0.06, { segments: 10, rings: 4, uv: U.dark }).translate(0, 0.32, -4.98));
    for (const dx of [-0.02, 0.02]) {
      stat.add(K.tube([-0.33 + dx, 0.5, -5.04], [-0.33 + dx, 0.58, -5.1], 0.01, 0.01, { segments: 6, uv: U.dark }));
      stat.add(K.box(0.035, 0.06, 0.07, U.seat).translate(-0.33 + dx * 1.7, 0.6, -5.12));
    }
    stat.add(K.box(0.05, 0.08, 0.05, U.accent).translate(0.31, 0.63, -4.3));
  }
  stat.add(K.ejectionSeat({ eye, recline: 18, uv: { frame: U.seat, cushion: U.cushion, accent: U.accent } }));
  const hudParts = K.hud({ eye, dist: 0.6, width: 0.2, height: 0.15, drop: 0.035, uv: U.black });
  {  // HUD: low housing sunk into the glareshield, twin combiner glasses on slim posts
    const y = eye[1] - 0.035, zH = eye[2] - 0.6, w = 0.2, h = 0.15, fr = new K.Mesh();
    for (const sx of [-1, 1]) fr.add(K.box(0.01, h * 1.02, 0.012, U.black).rotateX(-0.42).translate(sx * (w / 2 + 0.005), y, zH));
    fr.add(K.box(w * 1.1, 0.05, 0.2, U.console).translate(0, 0.71, zH - 0.08));
    fr.add(K.box(w * 0.9, 0.012, 0.05, U.dark).translate(0, 0.737, zH - 0.01));
    fr.sidecar('hud').add(hudParts.frame.sidecar('hud'));                              // keep the kit's symbology on the combiner
    hudParts.frame = fr;
  }
  stat.add(hudParts.frame);
  const pilotMesh = K.pilot({ eye, recline: 16, stick: [0, -0.43, -0.25], throttle: [-0.33, -0.33, 0.12], uv: { suit: U.suit, helmet: U.helmet, visor: U.visor, dark: U.dark, glove: U.glove } });

  // ---- intakes: raked rectangular boxes under the LEX (duct → lip → outer skin), canted 9° ---------------------------------------
  const IN = { z: G.engines[0].intake[2], x: Math.abs(G.engines[0].intake[0]), y: G.engines[0].intake[1] - YB, w: 0.38, h: 0.5, lean: 0.16, rakeY: 0.6, rakeX: 0.45 };
  const inSt = (() => {
    const k = 0.985, lip = 0.022, z0 = IN.z;
    const st = (z, x, y, w, h, kk = k) => ({ z, x, y, w, h, kTop: kk, kBot: kk });
    return [
      st(z0 + 2.5, -0.16, 0.04, (IN.w - lip * 1.3) * 0.7, (IN.h - lip * 1.3) * 0.74, 0.8),
      st(z0 + 1.3, -0.05, 0.01, (IN.w - lip * 1.3) * 0.88, (IN.h - lip * 1.3) * 0.9, 0.93),
      st(z0 + lip * 3, 0, 0, IN.w - lip * 1.3, IN.h - lip * 1.3), st(z0 + lip * 0.6, 0, 0, IN.w - lip * 0.9, IN.h - lip * 0.9),
      st(z0, 0, 0, IN.w, IN.h), st(z0 + lip * 0.6, 0, 0, IN.w + lip * 0.9, IN.h + lip * 0.9), st(z0 + lip * 3, 0, 0, IN.w + lip * 1.6, IN.h + lip * 1.6),
      st(z0 + 0.8, 0, -0.035, IN.w + 0.04, 0.505), st(z0 + 1.6, -0.02, -0.085, IN.w + 0.03, 0.465), st(z0 + 2.4, -0.05, -0.135, IN.w, 0.425), st(z0 + 2.9, -0.08, -0.145, IN.w - 0.08, 0.395),
    ];
  })();
  const inMat = new THREE.Matrix4().set(1, IN.lean, 0, 0, 0, 1, 0, 0, IN.rakeX, -IN.rakeY, 1, 0, 0, 0, 0, 1);
  for (const sx of [1, -1]) {
    const L = K.loft({ stations: inSt, segments: Math.max(32, Math.round(64 * detail / 4) * 4), step: 0.14, capStart: 'flat', capUV: U.black,
      uvFn: (x, y, z, t, ring) => (ring.k < 0.7 ? U.ductDeep : ring.k < 1.5 ? U.ductMid : ring.k < 3.3 ? U.duct : ring.k < 6.2 ? U.lip : cIn[sx > 0 ? 'R' : 'L'].uv(z, y + IN.y)) });
    L.mesh.occlude((x, y, z) => (Math.abs(x) < IN.w * 0.99 && Math.abs(y) < IN.h * 0.99 && z > IN.z + 0.01 ? Math.min(0.92, 0.25 + (z - IN.z) * 0.6) : 0));   // duct goes dark quickly
    const mesh = L.mesh.transform(inMat).translate(IN.x, IN.y, 0);
    // boundary-layer splitter: the inner wall carried forward of the lip as a thin plate, with the bleed gap behind it
    const zi = IN.z - IN.rakeX * IN.w, pl = new K.Mesh();
    pl.add(K.prism([[zi - 0.1 + IN.rakeY * 0.46, 0.46], [zi + 0.6, 0.46], [zi + 0.6, -0.48], [zi - 0.1 - IN.rakeY * 0.48, -0.48]], -0.009, 0.009, U.lip));
    pl.transform(new THREE.Matrix4().set(1, IN.lean, 0, IN.x - IN.w - 0.035, 0, 1, 0, IN.y, 0, 0, 1, 0, 0, 0, 0, 1));
    mesh.add(pl);
    if (sx < 0) stat.add(mesh.mirrorX()); else stat.add(mesh);
  }
  lap('intakes');

  // ---- wings ------------------------------------------------------------------------------------------------------------
  const WY = 0.18, X_FOLD = 3.75, DT = 0.12;
  const zLE = (x) => -1.6 + (x - 1.3) * Math.tan(20.2 * DEG), zTE = (x) => 3.1 - (x - 1.3) * (0.9 / 4.9);
  const zLEo = (x) => zLE(x) - DT;
  const cFold = zTE(X_FOLD) - zLE(X_FOLD), fLEo = (0.15 * cFold + DT) / (cFold + DT);
  const X_TIP = 6.25;
  const mkWing = (side) => K.wing({
    side, airfoil: K.naca6(0.05, 0.004), chordPts: Math.round(13 * detail), spanAxis: 'x', tip: 'flat',
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
  // wing-fold hinge fairings under the fold line, flap-hinge / actuator fairings under the trailing edge
  for (const sx of [1, -1]) {
    for (const f of [0.3, 0.55]) { const p = W.R.at(X_FOLD, f, 'lower'); stat.add(K.ellipsoid(0.035, 0.025, 0.3, { segments: 8, rings: 4, uv: U.under }).translate(sx * p[0], p[1] - 0.01, p[2])); }
    for (const x of [2.1, 3.3, 4.6, 5.6]) { const p = W.R.at(x, 0.7, 'lower'); stat.add(K.ellipsoid(0.03, 0.03, 0.26, { segments: 8, rings: 4, uv: U.under }).translate(sx * p[0], p[1] - 0.012, p[2])); }
  }

  // ---- stabilators, fins ----------------------------------------------------------------------------------------------------
  const ST = { x0: 1.0, x1: 4.3, y0: 0.03, z0: 5.0, c0: 3.5, c1: 1.2, sweep: 35, pivotZ: 6.35 };
  const stabY = (x) => ST.y0 - (x - ST.x0) * Math.tan(2 * DEG);
  const mkStab = (side) => K.wing({
    side, airfoil: K.biconvex(0.045), chordPts: Math.round(9 * detail), spanAxis: 'x', tip: 'flat', root: 'flat',
    stations: [{ x: ST.x0, y: stabY(ST.x0), z: ST.z0, chord: ST.c0, tc: 0.05 }, { x: ST.x1, y: stabY(ST.x1), z: ST.z0 + (ST.x1 - ST.x0) * Math.tan(ST.sweep * DEG), chord: ST.c1, tc: 0.035 }],
    charts: { upper: side > 0 ? cST.R : cST.L, lower: cSB },
  });
  const stab = { R: mkStab(1), L: mkStab(-1) };
  const FN = { x: 1.06, y: 0.22, z: 2.15, c0: 3.85, len: 2.99, c1: 1.4, cant: 20 };
  FN.zt = FN.z + FN.len * (2.4 / 3.3);
  const cantS = Math.sin(FN.cant * DEG), cantC = Math.cos(FN.cant * DEG);
  const mkFin = (side) => K.wing({
    side, airfoil: K.biconvex(0.05), chordPts: Math.round(10 * detail), spanAxis: 'u', tip: 'flat',
    stations: [{ x: FN.x, y: FN.y, z: FN.z, chord: FN.c0, tc: 0.05 }, { x: FN.x + FN.len * cantS, y: FN.y + FN.len * cantC, z: FN.zt, chord: FN.c1, tc: 0.035 }],
    lines: { hinge: [[0.4, 0.7], [1.95, 0.665]] },
    controls: [{ name: 'rudder', type: 'flap', span: [0.42, 1.93], from: 'hinge', nose: 1 }],
    charts: side > 0 ? { upper: cFin.Rin, lower: cFin.Rout } : { upper: cFin.Lin, lower: cFin.Lout },
  });
  const fin = { R: mkFin(1), L: mkFin(-1) };
  stat.add(fin.R.mesh).add(fin.L.mesh);
  // fin-tip ECM / light fairings (the square-cut Super Hornet fin tip carries an antenna cap)
  for (const sx of [1, -1]) {
    const a = fin.R.at(FN.len - 0.005, 0.02, 'mid'), b = fin.R.at(FN.len - 0.005, 0.98, 'mid');
    stat.add(K.tube([sx * a[0], a[1] - 0.01, a[2] - 0.03], [sx * b[0], b[1] - 0.01, b[2] + 0.02], 0.028, 0.02, { segments: 8, uv: U.dark }));
  }
  lap('surfaces');

  // ---- engine nacelles, petal nozzles, afterburner -------------------------------------------------------------------------
  const nacProf = [[0.5, 1.6], [0.545, 3.0], [0.555, 4.6], [0.548, 5.8], [0.535, 6.7], [0.522, 7.36]];
  const NZ = { z0: 7.35, z1: G.engines[0].nozzle[2], r0: 0.522 };
  const nozzles = [], glows = [];
  for (const [i, sx] of [[0, -1], [1, 1]]) {
    const cx = sx * ENG_X;
    stat.add(K.lathe(nacProf, { segments: Math.round(32 * detail), uv: (k, j, r, z) => cNac[sx > 0 ? 'R' : 'L'].uv(z - 1.6, j * 3.5) }).translate(cx, ENG_Y, 0));
    // jet pipe: heat-stained liner with cooling rings, flame holder rings and the turbine cone deep inside
    stat.add(K.lathe([[0.5, 7.38], [0.47, 7.0], [0.455, 6.6], [0.45, 6.15], [0.3, 6.08], [0, 6.04]], { segments: 24, uv: U.exhaust }).occlude(0.6).translate(cx, ENG_Y, 0));
    for (const zr of [6.9, 6.6]) stat.add(K.lathe([[0.46, zr - 0.02], [0.43, zr], [0.46, zr + 0.02]], { segments: 24, uv: U.heat2 }).translate(cx, ENG_Y, 0));
    for (const rr of [0.33, 0.2]) stat.add(K.lathe([[rr + 0.02, 6.28], [rr, 6.24], [rr - 0.02, 6.28]], { segments: 20, uv: U.steel }).translate(cx, ENG_Y, 0));
    for (let k = 0; k < 10; k++) stat.add(K.box(0.025, 0.42, 0.05, U.heat2).translate(0, 0.22, 0).rotateZ(k * Math.PI / 5).translate(cx, ENG_Y, 6.3));
    stat.add(K.lathe([[0, 6.0], [0.16, 6.08], [0.12, 6.24], [0, 6.36]], { segments: 14, uv: U.exhaust }).translate(cx, ENG_Y, 0));
    nozzles.push(K.petalNozzle({ z0: NZ.z0, z1: NZ.z1, r0: NZ.r0, rClosed: 0.40, rOpen: 0.475, petals: 12, centre: [cx, ENG_Y, 0], uvOuter: U.heat, uvInner: U.ceramic, thickness: 0.03, chart: cNoz }));
    glows.push(K.afterburnerGlow({ zDeep: 6.36, zExit: NZ.z1 - 0.15, rDeep: 0.43, rExit: 0.38, centre: [cx, ENG_Y, 0] }));
  }

  // ---- wingtip rails + AIM-9X, probes, antennas ---------------------------------------------------------------------------
  for (const sx of [1, -1]) {
    stat.add(K.launchRail({ x: sx * (X_TIP + 0.06), y: WY, z0: zLEo(X_TIP) - 0.55, z1: zTE(X_TIP) - 0.15, w: 0.12, h: 0.13, uv: U.rail }));
    stat.add(K.missile({ length: 3.02, radius: 0.0635, uvBody: U.aim, uvNose: U.aimNose, uvFin: U.aim, canards: { z: 1.0, chord: 0.12, span: 0.035 }, wings: { z: 2.72, chord: 0.28, span: 0.14 } })
      .translate(sx * (X_TIP + 0.165), WY - 0.06, zLEo(X_TIP) - 1.1));
  }
  // L-shaped pitot-static probes on the forebody sides ahead of the windscreen, AoA vanes below them, total-temperature probe
  for (const sx of [1, -1]) {
    const pt = fus.at(-7.6, sx > 0 ? probe.tAtY(-7.6, 0.28) : 1 - probe.tAtY(-7.6, 0.28)).p;
    stat.add(K.tube([pt[0] - sx * 0.02, pt[1], -7.6], [pt[0] + sx * 0.1, pt[1] + 0.02, -7.62], 0.013, 0.011, { segments: 6, uv: U.probe }));
    stat.add(K.probe([pt[0] + sx * 0.1, pt[1] + 0.02, -7.6], [pt[0] + sx * 0.1, pt[1] + 0.02, -7.9], 0.011, U.probe));
    const pa = fus.at(-7.95, sx > 0 ? probe.tAtY(-7.95, 0.05) : 1 - probe.tAtY(-7.95, 0.05)).p;
    stat.add(K.prism([[-7.95, 0], [-7.99, 0.0], [-8.1, -0.06], [-8.02, -0.06]], 0, 0.006, U.steel).translate(pa[0] - (sx > 0 ? 0 : 0.006), pa[1], 0).rotateZ(0));
  }
  // gun muzzle port on the nose centreline (M61A2) and the gun-gas vent louvres behind it
  { const gz = -8.15, gy = upperAt(gz, 0.0);
    stat.add(K.lathe([[0.045, -0.01], [0.055, 0.0], [0.05, 0.08], [0.03, 0.08], [0.02, 0.0]], { segments: 12, uv: U.black }).rotateX(0.05).translate(0, gy - 0.012, gz));
    for (let i = 0; i < 6; i++) { const z = -7.62 + i * 0.075; stat.add(K.box(0.07, 0.008, 0.03, U.vent).translate(0, upperAt(z, 0) + 0.002, z)); } }
  // refuelling probe door bulge on the upper right forebody
  { const pts = []; for (let z = -7.25; z <= -6.3; z += 0.19) pts.push([0.16, upperAt(z, 0.16) + 0.012, z]);
    stat.add(K.pipe(pts, [0.02, 0.04, 0.045, 0.045, 0.04, 0.03], { uv: U.top, segments: 10 })); }
  stat.add(K.bladeAntenna({ pos: [0, upperAt(-1.0, 0.01) - 0.02, -1.0], height: 0.16, chord: 0.24, sweep: 0.12, uv: U.top }));
  stat.add(K.bladeAntenna({ pos: [0, upperAt(2.6, 0.01) - 0.02, 2.6], height: 0.12, chord: 0.2, sweep: 0.1, uv: U.top }));
  stat.add(K.bladeAntenna({ pos: [0, upperAt(-2.4, 0.01) - 0.02, -2.4], height: 0.08, chord: 0.14, sweep: 0.06, uv: U.top }));
  stat.add(K.bladeAntenna({ pos: [0, lowerAt(-2.6, 0.01) + 0.02, -2.6], height: 0.16, chord: 0.22, sweep: 0.1, down: true, uv: U.under }));
  stat.add(K.bladeAntenna({ pos: [0, lowerAt(2.8, 0.01) + 0.02, 2.8], height: 0.12, chord: 0.18, sweep: 0.08, down: true, uv: U.under }));
  stat.add(K.bladeAntenna({ pos: [0.25, lowerAt(-6.9, 0.25) + 0.015, -6.9], height: 0.1, chord: 0.14, sweep: 0.05, down: true, uv: U.under }));
  // LEX vents: slatted grilles in the LEX top beside the fuselage (fin-buffet relief), modelled slats over a dark recess
  for (const sx of [1, -1]) {
    for (let k = 0; k < 9; k++) {
      const z = -3.1 + k * 0.075, x = 0.72 + (z + 3.1) * 0.05;
      const y0 = upperAt(z, x + 0.12);
      stat.add(K.box(0.3, 0.005, 0.05, U.vent).translate(sx * (x + 0.12), y0 + 0.001, z));
      stat.add(K.box(0.3, 0.012, 0.012, U.top).rotateX(0.5).translate(sx * (x + 0.12), y0 + 0.007, z + 0.02));
    }
  }
  // underwing pylons (toed out 4°, the Super Hornet signature) with stores: 480-gal tanks inboard, AIM-120 mid, empty outboard
  const toe = (m, sx, x, zc) => m.translate(-sx * x, 0, -zc).rotateY(sx * 4 * DEG).translate(sx * x, 0, zc);
  for (const sx of [1, -1]) for (const [x, len, store] of [[2.45, 2.3, 'tank'], [3.3, 2.1, 'aim120'], [4.75, 1.9, 'empty']]) {
    const zc = zLE(x) + (x > X_FOLD ? -DT : 0) + (zTE(x) - zLE(x)) * 0.42;
    const py = K.pylon([{ y: WY + 0.02, z0: zc - len / 2, z1: zc + len / 2 }, { y: WY - 0.3, z0: zc - len / 2 + 0.25, z1: zc + len / 2 - 0.12 }], { tc: 0.09, uv: U.under });
    py.translate(sx * x, 0, 0);
    py.add(K.box(0.07, 0.04, len * 0.55, U.dark).translate(sx * x, WY - 0.31, zc));                      // BRU-32 rack
    for (const dz of [-0.36, 0.36]) py.add(K.box(0.05, 0.06, 0.05, U.dark).translate(sx * x, WY - 0.34, zc + dz));
    if (store === 'tank') {
      py.add(K.tank({ length: 4.7, radius: 0.36, nose: 0.3, tail: 0.32, segments: 20, uv: (k, j, r, z) => cTank.uv(z, j * 2.3) }).translate(sx * x, WY - 0.72, zc - 2.25));
      // tank's own sway braces
      for (const dz of [-0.36, 0.36]) for (const sg of [-1, 1]) py.add(K.tube([sx * x + sg * 0.12, WY - 0.38, zc + dz], [sx * x + sg * 0.06, WY - 0.33, zc + dz], 0.012, 0.012, { segments: 5, uv: U.dark }));
    } else if (store === 'aim120') {
      py.add(K.launchRail({ x: sx * x, y: WY - 0.36, z0: zc - 1.1, z1: zc + 0.9, w: 0.08, h: 0.08, uv: U.under }));
      py.add(K.missile({ length: 3.66, radius: 0.089, uvBody: U.amraam, uvNose: U.aimNose, uvFin: U.amraam, canards: { z: 1.15, chord: 0.32, span: 0.13 }, wings: { z: 3.25, chord: 0.38, span: 0.16 }, roll: 45 }).translate(sx * x, WY - 0.49, zc - 1.9));
    }
    stat.add(toe(py, sx, x, zc));
  }
  // centreline pylon with a 480-gal tank; fuselage corner stations: ATFLIR pod (left), AIM-120 (right)
  stat.add(K.pylon([{ y: -0.6, z0: -0.4, z1: 1.6 }, { y: -0.84, z0: -0.15, z1: 1.45 }], { tc: 0.1, uv: U.under }));
  stat.add(K.tank({ length: 4.7, radius: 0.35, nose: 0.3, tail: 0.32, segments: 20, uv: (k, j, r, z) => cTank.uv(z, j * 2.3) }).translate(0, -1.2, -1.75));
  {
    const zs = -3.35;
    stat.add(K.pylon([{ x: -1.02, y: -0.56, z0: zs + 0.1, z1: zs + 1.5 }, { x: -1.06, y: -0.7, z0: zs + 0.2, z1: zs + 1.4 }], { tc: 0.12, uv: U.under }));
    const pod = K.lathe([[0, 0], [0.1, 0.02], [0.15, 0.1], [0.165, 0.3], [0.165, 1.6], [0.12, 1.8], [0, 1.84]], { segments: 18, uv: U.pod }).translate(-1.06, -0.86, zs - 0.3);
    pod.add(K.ellipsoid(0.15, 0.15, 0.15, { segments: 14, rings: 8, uv: U.pod }).translate(-1.06, -0.86, zs - 0.25));
    pod.add(K.ellipsoid(0.07, 0.08, 0.04, { segments: 10, rings: 4, uv: U.podGlass }).translate(-1.06, -0.9, zs - 0.385));
    stat.add(pod);
    stat.add(K.pylon([{ x: 1.04, y: -0.56, z0: -3.1, z1: -1.2 }, { x: 1.08, y: -0.68, z0: -3.0, z1: -1.3 }], { tc: 0.12, uv: U.under }));
    stat.add(K.launchRail({ x: 1.08, y: -0.7, z0: -3.3, z1: -1.0, w: 0.07, h: 0.06, uv: U.under }));
    stat.add(K.missile({ length: 3.66, radius: 0.089, uvBody: U.amraam, uvNose: U.aimNose, uvFin: U.amraam, canards: { z: 1.15, chord: 0.32, span: 0.13 }, wings: { z: 3.25, chord: 0.38, span: 0.16 }, roll: 45 }).translate(1.08, -0.82, -3.85));
  }
  lap('details');

  // ---- gear wells ---------------------------------------------------------------------------------------------------------
  const P = fus.patches;
  stat.add(K.well(P.mlgR, 0.32, U.wellDirty)).add(K.well(P.mlgL, 0.32, U.wellDirty));
  const ngPatch = K.merge(P.ngR, P.ngL);
  stat.add(K.well(ngPatch, 0.42, U.wellDirty, [0, 1, 0]));
  // plumbing in the main wells (actuator, hydraulic lines) so an open bay does not read as an empty white box
  for (const sx of [1, -1]) {
    for (const dz of [0, 0.05, 0.1]) stat.add(K.pipe([[sx * 0.75, -0.42, -1.45 + dz], [sx * 0.95, -0.4, -0.7 + dz], [sx * 1.15, -0.44, -0.05 + dz]], 0.012, { uv: U.hyd, segments: 5 }));
    stat.add(K.tube([sx * 1.2, -0.42, -0.1], [sx * 0.85, -0.38, -1.25], 0.04, 0.035, { segments: 8, uv: U.steel }));
  }

  // ---- LERX spoilers (speedbrake) -----------------------------------------------------------------------------------------
  const lerxSpoiler = (sx) => {
    const zA = -2.75, zB = -2.15, xA = 1.02, xB = 1.42;
    const c = [[xA, zA], [xB, zA], [xB, zB], [xA, zB]].map(([x, z]) => [sx * x, upperAt(z, x) + 0.004, z]);
    return { mesh: K.plate(c[0], c[1], c[2], c[3], 0.015, U.top), hingeA: [sx * xA, c[0][1], zA], hingeB: [sx * xB, c[1][1], zA], ref: [sx * (xA + xB) / 2, c[2][1], zB] };
  };

  // ---- boarding ladder under the left LEX (deployed with the canopy open on the ground) ------------------------------------------
  const ladder = new K.Mesh();
  { const top = [-1.02, lowerAt(-3.55, 1.02) + 0.05, -3.55], bot = [-1.12, -1.84, -4.25];
    const dir = top.map((v, j) => bot[j] - v), along = (f, dx) => [top[0] + dir[0] * f + dx, top[1] + dir[1] * f, top[2] + dir[2] * f];
    for (const dx of [-0.17, 0.17]) ladder.add(K.tube(along(0, dx), along(1, dx), 0.016, 0.016, { segments: 6, uv: U.ladder }));
    for (let k = 1; k <= 8; k++) ladder.add(K.box(0.34, 0.02, 0.07, U.ladder).translate(...along(k / 8.6, 0)));
    ladder.add(K.box(0.42, 0.02, 0.2, U.ladder).translate(...along(1, 0)));
    // stowage door hanging open beside it
    ladder.add(K.box(0.012, 0.3, 0.55, U.wellDirty).translate(top[0] - 0.22, top[1] - 0.16, top[2] - 0.05)); }

  // ---- paint ---------------------------------------------------------------------------------------------------------------
  paint(atlas, { SC, fus, W, fin, cFus, cWT, cWB, cST, cSB, cFin, cNac, cIn, cNoz, cTank, paintF, X_FOLD, X_TIP, zLE, zLEo, zTE, FN, T_SILL, upperAt,
    chY: K.pchip(FT.filter((r) => r[4]).map((r) => r[0]), FT.filter((r) => r[4]).map((r) => r[5])) });
  lap('paint');
  const mat = atlas.material(ctx, { envMapIntensity: 1 });
  lap('textures');
  rig.material('paint', mat, { shared: true });
  rig.disposables.push(atlas);
  rig.glass('canopy', K.glassMaterial(ctx, { tint: '#6b5a33', opacity: 0.2, edgeOpacity: 0.85, metalness: 0.6, roughness: 0.03, reflect: 1.1 }));
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
  const ladderNode = rig.part('ladder', ladder, { pivot: [-1.02, 0.3, -3.55] });

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
  // arrestor hook: long shank with black / white bands and a steel point, in a slot under the beaver tail
  const HK = { p: [0, -0.37, 5.5], len: 2.3 };
  const hookMesh = new K.Mesh();
  { const n = 8, dir = [0, 0.035, 1], dl = Math.hypot(...dir), d = dir.map((v) => v / dl);
    for (let k = 0; k < n; k++) { const a = HK.p.map((v, j) => v + d[j] * HK.len * k / n), b = HK.p.map((v, j) => v + d[j] * HK.len * (k + 1) / n); hookMesh.add(K.tube(a, b, 0.045 - 0.012 * k / n, 0.045 - 0.012 * (k + 1) / n, { segments: 10, uv: k % 2 ? U.hookK : U.hookW })); }
    const e = HK.p.map((v, j) => v + d[j] * HK.len);
    hookMesh.add(K.prism([[e[2] - 0.08, e[1] + 0.03], [e[2] + 0.12, e[1] + 0.02], [e[2] + 0.14, e[1] - 0.08], [e[2] + 0.02, e[1] - 0.1], [e[2] - 0.1, e[1] - 0.04]], -0.05, 0.05, U.hookShoe));
    hookMesh.add(K.box(0.16, 0.08, 0.2, U.dark).translate(HK.p[0], HK.p[1] + 0.02, HK.p[2]));
    hookMesh.add(K.tube([0, HK.p[1] + 0.05, HK.p[2] + 0.1], [0, HK.p[1] + 0.02, HK.p[2] + 0.9], 0.022, 0.022, { segments: 6, uv: U.steel }));   // damper
  }
  const hookNode = rig.part('hook', hookMesh, { pivot: HK.p });
  const setHook = rig.hinge(hookNode, [-1, HK.p[1], HK.p[2]], [1, HK.p[1], HK.p[2]], { ref: [0, HK.p[1], HK.p[2] + 2], toward: [0, -1, 0] });

  // ---- landing gear (body frame: the legs are not lifted with the airframe) -----------------------------------------------------
  const gp = G.gear, B = (p) => [p[0], p[1] + YB, p[2]];
  const doorOf = (patch, edge, inner = U.well) => ({ mesh: K.thicken(patch, 0.02, inner), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  {  // nose: twin wheels on a long carrier strut, forward retracting, launch bar, holdback fitting, approach lights
    const c = gp[0].pos, piv = B([0, -0.2, -4.72]);
    const ex = new K.Mesh();
    ex.add(K.tube([0, -1.07, -4.93], [0, -0.92, -5.56], 0.032, 0.026, { segments: 8, uv: U.lbar }));             // launch bar (stowed, up)
    ex.add(K.box(0.13, 0.05, 0.09, U.lbar).translate(0, -0.915, -5.58));
    ex.add(K.box(0.15, 0.1, 0.12, U.lbar).translate(0, -1.07, -4.9));
    ex.add(K.tube([0, -0.62, -4.84], [0, -0.85, -5.02], 0.018, 0.018, { segments: 6, uv: U.lbar }));             // launch-bar actuator
    ex.add(K.box(0.08, 0.07, 0.1, U.dark).translate(0, -1.0, -4.72));                                               // holdback fitting
    ex.add(K.box(0.11, 0.09, 0.05, U.dark).translate(0, -0.47, -4.84));                                             // approach-light housing
    for (const dx of [-1, 1]) ex.add(K.pipe([[dx * 0.07, -0.05, -4.76], [dx * 0.075, -0.6, -4.81], [dx * 0.06, -1.0, -4.84]], 0.008, { uv: U.hyd, segments: 5 }));
    ex.add(K.box(0.1, 0.05, 0.06, U.lens).translate(0, -0.72, -4.88));                                              // landing / taxi lamp body
    K.buildGear(rig, atlas, {
      name: 'nose', index: 0, contact: c, wheels: [-0.165, 0.165], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.16, pivot: piv, stroke: 0.3, staticFrac: 0.4,
      strutR: 0.07, fork: 'axle', steer: true, links: 'front', retract: { to: B([0, -0.24, -5.85]) }, window: [0.2, 0.86],
      brace: B([0, -0.32, -5.5]), extra: ex,
      doors: [
        { name: 'noseDoorR', ...doorOf(P.ngR, fus.edges.ngR.tHi), open: 85, closes: true },
        { name: 'noseDoorL', ...doorOf(P.ngL, fus.edges.ngL.tLo), open: 85, closes: true },
      ],
      lamps: [
        { kind: 'landing', pos: G.lights.landing, size: 0.045, color: [1, 0.96, 0.88] }, { kind: 'taxi', pos: [0.04, -0.72, -4.91], size: 0.03, color: [1, 0.96, 0.88] },
        { kind: 'taxi', pos: [-0.035, -0.45, -4.87], size: 0.016, color: [0.1, 1, 0.2] }, { kind: 'taxi', pos: [0, -0.45, -4.87], size: 0.016, color: [1, 0.6, 0.05] }, { kind: 'taxi', pos: [0.035, -0.45, -4.87], size: 0.016, color: [1, 0.05, 0.02] },
      ],
    });
  }
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, edge = fus.edges['mlg' + key], piv = B([sx * 1.2, -0.46, -0.05]);
    // strut-mounted door outboard of the leg (grey outside, white inside), hydraulic lines down the strut
    const ax = [c[0] - piv[0], c[1] + gp[i].wheelRadius - piv[1], c[2] - piv[2]], f = (k, o = 0) => [piv[0] + ax[0] * k + sx * o, piv[1] + ax[1] * k, piv[2] + ax[2] * k];
    const ex = new K.Mesh();
    { const a = f(0.06, 0.13), b = f(0.62, 0.13), q = [[a[0], a[1], a[2] - 0.3], [a[0], a[1], a[2] + 0.22], [b[0], b[1], b[2] + 0.2], [b[0], b[1] - 0.05, b[2] - 0.05], [b[0], b[1], b[2] - 0.28]];
      for (const [dd, uv] of [[0, U.under], [-sx * 0.014, U.well]]) {
        const i0 = ex.vertexCount, nx = dd === 0 ? sx : -sx;
        for (const p of q) ex.vert(p[0] + dd, p[1], p[2], nx, 0, 0, uv[0], uv[1]);
        if (nx > 0) { ex.tri(i0, i0 + 1, i0 + 2); ex.tri(i0, i0 + 2, i0 + 3); ex.tri(i0, i0 + 3, i0 + 4); } else { ex.tri(i0, i0 + 2, i0 + 1); ex.tri(i0, i0 + 3, i0 + 2); ex.tri(i0, i0 + 4, i0 + 3); }
      }
      for (const k of [0.15, 0.5]) ex.add(K.tube(f(k, 0.0), f(k, 0.12), 0.012, 0.012, { segments: 5, uv: U.steel }));
    }
    ex.add(K.pipe([f(0.02, -0.06), f(0.4, -0.075), f(0.75, -0.07)], 0.009, { uv: U.hyd, segments: 5 }));
    ex.add(K.pipe([f(0.02, 0.05), f(0.45, 0.075), f(0.78, 0.07)], 0.008, { uv: U.hyd, segments: 5 }));
    K.buildGear(rig, atlas, {
      name: 'main' + key, index: i, contact: c, wheelRadius: gp[i].wheelRadius, wheelWidth: 0.27, pivot: piv, stroke: 0.35, staticFrac: 0.4,
      strutR: 0.085, fork: 'axle', links: 'rear', retract: { to: B([sx * 0.95, -0.46, -1.15]), twist: sx * 90 }, window: [0.2, 0.9], brace: B([sx * 0.95, -0.52, 0.75]), extra: ex,
      doors: [{ name: 'mainDoor' + key, ...doorOf(P['mlg' + key], sx > 0 ? edge.tHi : edge.tLo), open: 95, closes: true }],
    });
  }

  // ---- lamps (design frame on the airframe) -----------------------------------------------------------------------------------
  const Lt = G.lights;
  rig.lamp('nav', D(Lt.navLeft), { color: [1, 0.04, 0.02], size: 0.035, squash: [0.7, 0.7, 1.6] });
  rig.lamp('nav', D(Lt.navRight), { color: [0.02, 1, 0.25], size: 0.035, squash: [0.7, 0.7, 1.6] });
  rig.lamp('nav', D(Lt.tail), { color: [1, 1, 1], size: 0.03 });
  const strobeR = [-Lt.strobe[0], Lt.strobe[1], Lt.strobe[2]];
  rig.lamp('strobe', D(Lt.strobe), { color: [1, 1, 1], size: 0.035 });
  rig.lamp('strobe', D(strobeR), { color: [1, 1, 1], size: 0.035 });
  rig.lamp('beacon', D(Lt.beacon), { color: [1, 0.1, 0.05], size: 0.04 });
  rig.lamp('beacon', [0, lowerAt(1.2, 0) - 0.01, 1.2], { color: [1, 0.1, 0.05], size: 0.04 });
  // formation "slime" light strips: forebody sides, fin outer faces, aft fuselage sides
  const strip = (p, rz, len, n) => { const m = K.box(0.012, 0.045, len, [0, 0]); if (rz) m.rotateZ(rz); return m.translate(p[0] + n[0] * 0.007, p[1] + n[1] * 0.007, p[2]); };
  const slime = [0.18, 0.5, 0.16];
  for (const sx of [1, -1]) {
    const pz = -7.3, tf = probe.tAtY(pz, 0.24), pf = probe.at(pz, sx > 0 ? tf : 1 - tf).p;
    rig.lamp('formation', null, { mesh: strip(pf, 0, 0.5, [sx, 0, 0]), color: slime });
    const fp = fin[sx > 0 ? 'R' : 'L'].at(1.9, 0.42, 'lower');
    rig.lamp('formation', null, { mesh: strip(fp, -sx * FN.cant * DEG, 0.55, [sx * cantC, -cantS, 0]), color: slime });
    const az = 5.4, ta = probe.tAtY(az, 0.12), pa = probe.at(az, sx > 0 ? ta : 1 - ta).p;
    rig.lamp('formation', null, { mesh: strip(pa, 0, 0.5, [sx, 0, 0]), color: slime });
  }

  // ---- night halos (body frame): soft additive sprites so lamps read at chase distance --------------------------------------------
  const HALO = [
    { p: [Lt.navLeft[0] - 0.05, Lt.navLeft[1], Lt.navLeft[2]], c: [1, 0.05, 0.03], k: 'nav', s: 1.5 }, { p: [Lt.navRight[0] + 0.05, Lt.navRight[1], Lt.navRight[2]], c: [0.05, 1, 0.3], k: 'nav', s: 1.5 },
    { p: [Lt.tail[0], Lt.tail[1], Lt.tail[2] + 0.06], c: [1, 1, 1], k: 'nav', s: 1.1 },
    { p: Lt.strobe, c: [1, 1, 1], k: 'strobe', s: 2.4 }, { p: strobeR, c: [1, 1, 1], k: 'strobe', s: 2.4 },
    { p: [Lt.beacon[0], Lt.beacon[1] + 0.05, Lt.beacon[2]], c: [1, 0.1, 0.05], k: 'beacon', s: 1.8 },
    { p: [0, lowerAt(1.2, 0) - 0.05 + YB, 1.2], c: [1, 0.1, 0.05], k: 'beacon', s: 1.8 },
    { p: [Lt.landing[0], Lt.landing[1], Lt.landing[2] - 0.05], c: [1, 0.95, 0.85], k: 'landing', s: 2.2 },
  ];
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(HALO.flatMap((h) => h.p), 3));
  haloGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(HALO.length * 3).fill(0), 3));
  haloGeo.setAttribute('size', new THREE.Float32BufferAttribute(HALO.map((h) => h.s), 1));
  const haloMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, fog: false,
    vertexShader: 'attribute float size; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * 0.5 * projectionMatrix[1][1] * 360.0 / max(0.5, -mv.z), 2.0, 96.0); }',
    fragmentShader: 'varying vec3 vC; void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard; float a = exp(-r2 * 5.0) + 0.25 * exp(-r2 * 1.4) * (1.0 - r2); gl_FragColor = vec4(vC * a, 1.0); }',
  });
  const halo = new THREE.Points(haloGeo, haloMat); halo.name = 'halos'; halo.frustumCulled = false; halo.renderOrder = 6;
  const haloCol = haloGeo.attributes.color;

  // ---- animation -----------------------------------------------------------------------------------------------------------
  rig.onUpdate((S) => {
    const sf = S.sf;
    const flapDeg = sf.flaps * 45, droop = sf.flaps * 42;
    flapR.set(-flapDeg * DEG); flapL.set(-flapDeg * DEG);
    ailR.set((sf.aileronR * 25 - droop) * DEG); ailL.set((sf.aileronL * 25 - droop) * DEG);
    const lef = Math.max(sf.slats, sf.flaps * 0.8) * 30;
    lefIR.set(-lef * DEG); lefIL.set(-lef * DEG); lefOR.set(-lef * DEG); lefOL.set(-lef * DEG);
    setStabR(sf.elevatorR * 24 * DEG); setStabL(sf.elevatorL * 24 * DEG);
    const toeIn = sf.speedbrake * 25;
    rudR.set(Math.max(-30, Math.min(30, sf.rudder * 30 - toeIn)) * DEG); rudL.set(Math.max(-30, Math.min(30, sf.rudder * 30 + toeIn)) * DEG);
    for (const s of spoilers) s(sf.speedbrake * 55 * DEG);
    nozNodes.forEach((n, i) => { n.morphTargetInfluences[0] = (S.eng[i] || {}).nozzle ?? 0; K.abGlowColor(glowMats[i].color, S.eng[i] || {}, S.night); });
    setCanopy(sf.canopy * 45 * DEG);
    setHook(sf.hook * 58 * DEG);
    pilotNode.visible = !rig.cameraInCockpit;
    ladderNode.visible = sf.canopy > 0.6 && sf.gear > 0.98 && S.onGround && S.groundSpeed < 1;
    const lt = S.lights || {}, nf = Math.max(0, Math.min(1, (S.night ?? 0) * 1.4 - 0.2));
    HALO.forEach((h, i) => {
      let on = 0;
      if (h.k === 'nav') on = lt.nav ? 1 : 0;
      else if (h.k === 'strobe') on = lt.strobe ? K.lampFlash('strobe', S.tLamp) : 0;
      else if (h.k === 'beacon') on = lt.beacon ? K.lampFlash('beacon', S.tLamp) : 0;
      else on = lt[h.k] && sf.gear > 0.98 ? 1 : 0;
      const I = on * nf * 0.9; haloCol.setXYZ(i, h.c[0] * I, h.c[1] * I, h.c[2] * I);
    });
    haloCol.needsUpdate = true; halo.visible = nf > 0.01;
  });
  const visual = rig.build();
  // lift the airframe from the design frame onto the gear (gear legs were built in the body frame)
  for (const c of visual.object3D.children) if (!c.name.endsWith('.leg')) c.position.y += YB;
  visual.object3D.add(halo);
  rig.disposables.push(haloGeo, haloMat);
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
// Navy TPS greys. A carrier jet is never one grey: whole panels resprayed in slightly different greys, rectangles of fresh
// touch-up around fasteners, boot-scuffed LEX walkways, hydraulic weeps running aft from belly seams, soot behind the gun and
// nozzles, and a chalky salt fade on the upper surfaces. Weather scale SC.weather (1 = line jet, ~.4 = freshly painted CAG bird).
function paint(atlas, o) {
  const { SC, fus, W, fin, cFus, cWT, cWB, cST, cSB, cFin, cNac, cIn, cNoz, cTank, paintF, X_FOLD, X_TIP, FN, chY } = o, F = K.FINISH;
  const top = paintF(SC.top), under = paintF(SC.under), mark = SC.mark, cag = SC.cag, wx = SC.weather;
  const rnd = (() => { let a = SC.seed; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const tone = (hex, d) => mixHex(hex, d > 0 ? '#ffffff' : '#000000', Math.abs(d));
  const markCol = cag ? '#121519' : mark;
  // mismatched greys for resprayed panels: darker fresh paint, bluer, greener, browner (old primer ghosting), chalkier
  const variant = (hex) => { const r = rnd(); return r < 0.35 ? tone(hex, -0.08 - rnd() * 0.08) : r < 0.55 ? mixHex(tone(hex, -0.04), '#4f6075', 0.3) : r < 0.7 ? mixHex(hex, '#5f6a60', 0.32) : r < 0.82 ? mixHex(hex, '#6e655a', 0.28) : tone(hex, 0.08 + rnd() * 0.07); };
  const respray = (Q, path, base, a = 1) => Q.fill(path, { color: variant(base), rough: SC.rough - 0.08 - rnd() * 0.08, metal: 0 }, { alpha: (0.45 + rnd() * 0.45) * a });
  // fastener dots: all points of a pen in one pass per layer (Pen.rivets costs a canvas pass per row)
  const dotQ = new Map();
  const dot = (Q, a, b) => { let l = dotQ.get(Q); if (!l) dotQ.set(Q, l = []); l.push(a, b); };
  const dotRow = (Q, a0, b0, a1, b1, n) => { for (let i = 0; i <= n; i++) dot(Q, a0 + (a1 - a0) * i / n, b0 + (b1 - b0) * i / n); };
  const flushDots = (Q) => { const l = dotQ.get(Q); if (!l) return; for (const [layer, style] of [['height', 'rgba(0,0,0,0.16)'], ['color', 'rgba(10,12,14,0.06)']]) Q.each(layer, (g, setT, st, L) => { g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = style; const w = Math.max(1, 1.1 * L.scale); for (let i = 0; i < l.length; i += 2) g.fillRect((st.tx + l[i] * st.sx) * L.scale - w / 2, (st.ty + l[i + 1] * st.sy) * L.scale - w / 2, w, w); }); dotQ.delete(Q); };
  const gap = { px: 2, depth: 0.8, dark: 0.5 }, seam = { px: 1, depth: 0.42, dark: 0.13 };
  const riv = (Q, a0, b0, a1, b1, sp) => dotRow(Q, a0, b0, a1, b1, Math.max(1, Math.round(Math.hypot(a1 - a0, b1 - b0) / sp)));
  const stencil = (Q, a, b, rot = 0) => { const L = ['JACK PT', 'GND', 'NO STEP', 'FUEL', 'H-PT', 'O2', 'ACCESS', 'VENT', 'DRAIN']; Q.text(L[Math.floor(rnd() * L.length)], a, b, 0.022, { color: markCol, rot }); };

  // ================= fuselage (unwrap: z, t) =================
  const P = atlas.pen(cFus), tt = (s, v) => (s > 0 ? v : 1 - v);
  const K4 = fus.K;
  const tx = (z, x, topSide) => {             // ring parameter on the right side at half-width x (upper or lower quadrant)
    const r = fus.ring(Math.round(z * 20) / 20); let jm = 0, mx = -1;
    for (let j = 0; j <= K4 / 2; j++) if (r[j * 3] > mx) { mx = r[j * 3]; jm = j; }
    if (x >= mx) return jm / K4;
    if (!topSide) { for (let j = 0; j < jm; j++) { const a = r[j * 3], b = r[j * 3 + 3]; if (x >= a && x <= b) return (j + (x - a) / Math.max(1e-9, b - a)) / K4; } return 0; }
    for (let j = jm; j < K4 / 2; j++) { const a = r[j * 3], b = r[j * 3 + 3]; if (x <= a && x >= b) return (j + (a - x) / Math.max(1e-9, a - b)) / K4; }
    return 0.5;
  };
  const dens = (pts, n = 4) => { const out = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } return out; };
  const up = (pts, s) => dens(pts).map(([x, z]) => [z, tt(s, tx(z, x, true))]);            // plan (x, z) outline on the upper skin
  const dn = (pts, s) => dens(pts).map(([x, z]) => [z, tt(s, tx(z, x, false))]);           // … on the lower skin
  const sideT = (pts, s) => dens(pts).map(([z, y]) => [z, tt(s, fus.tAtY(z, y))]);         // side (z, y) outline
  const closed = (pts) => pts.concat([pts[0]]);
  const fastenOutline = (pts) => { const g = fus.girthAt(pts[0][0], pts[0][1]); for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b[0] - a[0], (b[1] - a[1]) * g); dotRow(P, a[0], a[1], b[0], b[1], Math.max(1, Math.round(len / 0.07))); } };
  const yBand = (z) => chY(Math.min(Math.max(z, -6.3), 7.9)) - 0.035;
  P.fill('all', top);
  P.band(-9.5, 7.95, -Infinity, (z) => (z < -6.3 ? 0.16 : yBand(z)), under, { feather: 4 });
  P.fill((g) => g.rect(-9.5, 0, 2.35, 1), { color: SC.radome, rough: 0.55, metal: 0 });                 // radome
  P.fill([[-7.15, 0.44], [-6.15, 0.42], [-6.15, 0.58], [-7.15, 0.56]], F.matte(tone(SC.top, -0.18)), { feather: 1 });   // anti-glare
  // panel layout -------------------------------------------------------------------------------------------------------
  const sidePanels = [   // [z0, z1, y0, y1] on both sides: avionics bays, gun / ammo access, LEX underside, aft body
    [-8.9, -7.25, -0.08, 0.3], [-7.05, -6.35, -0.3, 0.42], [-6.25, -5.35, -0.36, 0.47], [-5.25, -4.5, -0.4, 0.46], [-4.4, -3.95, -0.42, 0.44],
    [-6.9, -6.4, -0.42, -0.31], [-6.25, -5.0, -0.48, -0.4],
    [0.25, 1.4, -0.45, -0.2], [1.55, 2.9, -0.48, -0.2], [3.05, 4.2, -0.44, -0.18], [4.35, 5.5, -0.38, -0.15], [5.6, 6.55, -0.32, -0.12],
  ];
  const topPanels = [    // [[x, z] outline] on the right upper skin (mirrored for the left)
    [[0.05, -3.15], [0.32, -3.15], [0.32, -2.1], [0.05, -2.1]], [[0.05, -1.95], [0.36, -1.95], [0.36, -0.55], [0.05, -0.55]], [[0.05, -0.4], [0.38, -0.4], [0.38, 1.0], [0.05, 1.0]],
    [[0.05, 1.15], [0.4, 1.15], [0.4, 2.35], [0.05, 2.35]], [[0.05, 2.5], [0.38, 2.5], [0.38, 3.8], [0.05, 3.8]], [[0.05, 3.95], [0.32, 3.95], [0.32, 5.2], [0.05, 5.2]], [[0.05, 5.35], [0.28, 5.35], [0.28, 6.5], [0.05, 6.5]],
    [[0.62, -5.3], [0.82, -5.0], [0.86, -4.3], [0.66, -4.3]], [[0.66, -4.15], [1.05, -4.15], [1.18, -3.3], [0.66, -3.3]], [[0.7, -2.0], [1.2, -2.0], [1.3, -1.3], [0.75, -1.3]],
    [[0.5, -0.4], [0.95, -0.4], [0.95, 0.9], [0.5, 0.9]], [[0.5, 1.05], [1.0, 1.05], [1.0, 2.4], [0.5, 2.4]], [[0.48, 2.55], [0.9, 2.55], [0.9, 3.9], [0.48, 3.9]], [[0.45, 4.05], [0.85, 4.05], [0.8, 5.3], [0.45, 5.3]],
  ];
  const botPanels = [
    [[0.05, -3.4], [0.35, -3.4], [0.35, -2.2], [0.05, -2.2]], [[0.05, 0.4], [0.4, 0.4], [0.4, 1.9], [0.05, 1.9]], [[0.05, 2.1], [0.42, 2.1], [0.42, 3.6], [0.05, 3.6]], [[0.05, 3.8], [0.38, 3.8], [0.38, 5.3], [0.05, 5.3]],
    [[0.55, 2.0], [1.0, 2.0], [1.0, 3.3], [0.55, 3.3]], [[0.55, 3.5], [0.95, 3.5], [0.9, 4.8], [0.55, 4.8]],
  ];
  const outlines = [];
  for (const s of [1, -1]) {
    for (const [z0, z1, y0, y1] of sidePanels) outlines.push({ pts: sideT([[z0, y0], [z1, y0], [z1, y1], [z0, y1]], s), side: true });
    for (const p of topPanels) outlines.push({ pts: up(p, s), top: true });
    for (const p of botPanels) outlines.push({ pts: dn(p, s), bot: true });
  }
  // patchwork: whole panels resprayed in mismatched greys (before the seams are cut so the seams stay crisp)
  for (const ol of outlines) if (rnd() < 0.45 * wx + 0.08) respray(P, ol.pts, ol.bot || (ol.side && ol.pts[0][1] < 0.2) ? SC.under : SC.top);
  // fresh-paint rectangles over fastener rows / seams (tight edges, darker, smoother)
  for (let i = 0; i < 110 * wx; i++) {
    const z = -7 + rnd() * 14, t = 0.04 + rnd() * 0.42, s = rnd() < 0.5 ? 1 : -1, wz = 0.12 + rnd() * 0.5, wt = 0.006 + rnd() * 0.02;
    respray(P, (g) => g.rect(z, tt(s, t), wz, wt), t < 0.2 ? SC.under : SC.top, 0.8);
  }
  if (cag === 'storm' || cag === 'jolly') {   // black spine with a gold pinstripe, canopy to fins
    const c = cag === 'storm' ? SC.finB : SC.finC;
    P.fill([[-3.2, 0.465], [-1.5, 0.45], [3.8, 0.45], [6.8, 0.47], [6.8, 0.53], [3.8, 0.55], [-1.5, 0.55], [-3.2, 0.535]], { color: SC.finA, rough: 0.5, metal: 0 });
    for (const s of [1, -1]) P.line([[-3.2, tt(s, 0.465)], [-1.5, tt(s, 0.45)], [3.8, tt(s, 0.45)], [6.8, tt(s, 0.47)]], { px: 2.5, depth: 0, dark: 0, color: c });
  }
  for (const ol of outlines) { P.line(closed(ol.pts), seam); if (rnd() < 0.8) fastenOutline(ol.pts); }
  // frames and longerons
  for (const z of [-7.15, -6.15, -3.2, -1.55, 0.12, 6.9, 7.45]) P.ring(z, 0, 1, { px: z === -7.15 ? 1.7 : 1, depth: 0.45, dark: z === -7.15 ? 0.3 : 0.12 });
  for (const s of [1, -1]) {
    P.line([[-9.0, tt(s, 0.25)], [7.6, tt(s, 0.25)]], { px: 1, depth: 0.3, dark: 0.08 });
    P.line(sideT([[-7.15, 0.0], [-3.9, 0.02]], s), seam);
    for (let k = 0; k < 7; k++) { const z = -2.8 + k * 1.45; dotRow(P, z, tt(s, 0.33), z + 1.2, tt(s, 0.33), 20); }
  }
  P.line([[-9.4, 0], [7.9, 0]], seam); P.line([[-3.2, 0.5], [7.9, 0.5]], seam);
  // gun port soot, gun-gas vents, refuelling-probe door outline
  P.decalT(-8.15, 0.5, (g) => { g.fillStyle = '#121314'; g.beginPath(); g.ellipse(0, 0, 0.07, 0.05, 0, 0, Math.PI * 2); g.fill(); });
  P.streak(-8.1, 0.5, -6.6, 0.5, 0.14, { alpha: 0.2 + 0.35 * wx });
  P.streak(-8.1, 0.5, -7.1, 0.5, 0.06, { alpha: 0.3 + 0.3 * wx, color: '12,10,9' });
  P.line(closed(up([[0.1, -7.35], [0.23, -7.35], [0.23, -6.25], [0.1, -6.25]], 1)), gap);
  // cockpit sill: ejection-seat warning triangle and rescue arrow, canopy jettison stencil, pilot name under the rail
  for (const s of ['L', 'R']) {
    P.decalOn(-6.6, 0.58, s, (g) => { g.fillStyle = '#c0262b'; g.beginPath(); g.moveTo(-0.08, -0.07); g.lineTo(0.08, -0.07); g.lineTo(0, 0.07); g.closePath(); g.fill(); g.fillStyle = '#e8e8e8'; g.font = '700 0.07px sans-serif'; g.textAlign = 'center'; g.fillText('!', 0, -0.0); });
    P.decalOn(-6.25, 0.3, s, (g) => { g.strokeStyle = cag ? '#b3202a' : markCol; g.lineWidth = 0.012; g.beginPath(); g.moveTo(-0.25, 0); g.lineTo(0.2, 0); g.stroke(); g.beginPath(); g.moveTo(0.2, -0.04); g.lineTo(0.28, 0); g.lineTo(0.2, 0.04); g.fill(); });
    P.textOn('RESCUE', -6.3, 0.22, s, 0.04, { color: cag ? '#b3202a' : markCol });
    P.textOn(SC.pilot, -5.05, 0.6, s, 0.034, { color: markCol });
    if (cag) P.decalOn(-5.05, 0.665, s, (g) => { g.fillStyle = cag === 'storm' ? SC.finB : SC.finC; g.fillRect(-0.8, -0.01, 1.6, 0.02); });
    P.textOn('DANGER', -3.7, -0.62 + 0.2, s, 0.03, { color: '#a82228' });
  }
  // modex on the nose: big, slightly offset toward the radome joint
  P.textOn(SC.modex, -7.75, 0.06, 'both', 0.34, { color: markCol, font: K.FONT.sans, weight: 700, outline: cag === 'storm' ? SC.finB : cag === 'jolly' ? SC.finC : null, outlineWidth: 9 });
  if (cag === 'storm') P.textOn('STORMRIDERS', 1.4, 0.4, 'both', 0.12, { color: SC.finB, italic: true, font: K.FONT.wide, outline: '#101318', outlineWidth: 10 });
  if (cag === 'jolly') P.textOn('JOLLY ROGERS', 1.4, 0.4, 'both', 0.12, { color: '#101215', font: K.FONT.wide, outline: SC.finC, outlineWidth: 8 });
  // LEX top: walkway outline (black), NO STEP, LEX-vent outlines, spoiler gaps
  for (const s of [1, -1]) {
    P.line(closed(up([[0.66, -4.9], [0.95, -4.9], [1.25, -3.5], [1.4, -2.85], [0.7, -2.85]], s)), { px: 1.4, depth: 0, dark: 0.55 });
    P.decalT(-3.0, tt(s, tx(-3.0, 1.45, true)), { rot: s > 0 ? 90 : -90 }, (g) => K.drawText(g, 'NO STEP', 0.04, { color: markCol }));
    P.fill(up([[0.7, -3.13], [1.05, -3.13], [1.06, -2.42], [0.73, -2.42]], s), { color: '#1e2022', rough: 0.7, metal: 0 }, { alpha: 0.75 });
    P.line(closed(up([[1.02, -2.75], [1.42, -2.75], [1.42, -2.15], [1.02, -2.15]], s)), gap);
    for (let i = 0; i < 4; i++) stencil(P, -5.5 + rnd() * 9, tt(s, 0.08 + rnd() * 0.3));
  }
  for (let i = 0; i < 14; i++) stencil(P, -6 + rnd() * 12, rnd() < 0.5 ? 0.02 + rnd() * 0.15 : 0.83 + rnd() * 0.15);
  // boarding ladder door under the left LEX, kick-in steps
  P.line(closed(dn([[0.85, -3.7], [1.2, -3.7], [1.2, -3.15], [0.85, -3.15]], -1)), { px: 1.4, depth: 0.6, dark: 0.3 });
  for (const [z, y] of [[-4.6, -0.1], [-4.6, 0.25]]) P.decalOn(z, y, 'L', (g) => { g.fillStyle = '#1b1c1e'; g.fillRect(-0.06, -0.025, 0.12, 0.05); });
  // weathering --------------------------------------------------------------------------------------------------------------
  // boot scuffs along the LEX walkways and the spine (crew climb out of the cockpit onto the LEX and walk aft to the wing)
  for (const s of [1, -1]) for (let i = 0; i < 70 * wx + 10; i++) {
    const z = -4.9 + rnd() * 3.6, x = 0.62 + rnd() * (0.3 + (z + 4.9) * 0.18), t = tt(s, tx(z, x, true)), r = 0.035 + rnd() * 0.05;
    P.fill((g) => { g.ellipse(z, t, r * 1.7, r / fus.girthAt(z, t), rnd() * 0.6, 0, Math.PI * 2); }, { color: rnd() < 0.7 ? '#3a3b3c' : '#7d8084', rough: 0.75, metal: 0 }, { alpha: 0.1 + rnd() * 0.14 });
  }
  for (let i = 0; i < 40 * wx; i++) { const z = -3 + rnd() * 9, t = 0.47 + rnd() * 0.06; P.fill((g) => g.ellipse(z, t, 0.06, 0.004, 0, 0, Math.PI * 2), { color: '#3d3e40', rough: 0.75, metal: 0 }, { alpha: 0.13 }); }
  P.noise({ alpha: 0.035 + 0.025 * wx, scale: 2.6, stretch: [1.8, 1], rough: 0.06 });
  P.noise({ alpha: 0.03, scale: 0.7, mode: 'light' });
  // salt fade: a chalky lightening on the upper surfaces, strongest along the spine
  if (wx > 0.3) { P.fill((g) => g.rect(-7, 0.38, 14.5, 0.24), { color: 'rgba(205,210,214,1)' }, { alpha: 0.06 * wx, feather: 20 }); P.noise({ alpha: 0.05 * wx, scale: 4, stretch: [3, 1], mode: 'light', path: (g) => g.rect(-7, 0.3, 14.5, 0.4) }); }
  // grime streaks running aft from seams; hydraulic weeps from the belly; brown oil from the engine-bay drains
  for (let i = 0; i < 46 * wx; i++) { const z = -6 + rnd() * 12.5, t = rnd(); P.streak(z, t, z + 0.6 + rnd() * 1.6, t + (rnd() - 0.5) * 0.008, 0.006 + rnd() * 0.012, { alpha: 0.07 + rnd() * 0.12 }); }
  for (let i = 0; i < 30 * wx; i++) { const z = -4 + rnd() * 10, t = (rnd() < 0.5 ? 0.0 : 0.92) + rnd() * 0.08; P.streak(z, t, z + 0.8 + rnd() * 1.8, t, 0.008 + rnd() * 0.02, { alpha: 0.12 + rnd() * 0.2, color: '52,42,28', rough: 0.08 }); }
  for (const s of [1, -1]) for (const z of [1.4, 2.9, 4.2]) P.streak(z, tt(s, 0.12), z + 2.2, tt(s, 0.12), 0.06, { alpha: 0.3 * wx + 0.05, color: '46,36,24', rough: 0.12 });
  P.fill((g) => g.rect(6.7, 0, 1.25, 1), { color: 'rgba(38,34,30,0.3)' }, { feather: 12 });       // exhaust soot on the beaver tail
  for (const tv of [0.0, 0.5]) P.streak(7.9, tv, 5.6, tv, 0.12, { alpha: 0.3 * wx + 0.1 });
  // formation light housings (the lamps are modelled; this is their surround)
  for (const [z, y] of [[-7.3, 0.24], [5.4, 0.12]]) P.decalOn(z, y, 'both', (g) => { g.fillStyle = '#3a3e3c'; g.fillRect(-0.27, -0.035, 0.54, 0.07); });

  // ================= intake trunk sides (side charts: z, y) =================
  for (const key of ['R', 'L']) {
    const Q = atlas.pen(cIn[key]);
    Q.fill('all', top);
    Q.fill([[-4.45, -0.8], [-0.8, -0.8], [-0.8, -0.3], [-4.45, -0.16]], under, { feather: 6 });
    const pans = [[-3.65, -0.5, -2.75, 0.15], [-2.6, -0.55, -1.75, 0.1], [-1.6, -0.55, -0.95, 0.05]];
    for (const [a0, b0, a1, b1] of pans) { if (rnd() < 0.6 * wx + 0.1) respray(Q, (g) => g.rect(a0, b0, a1 - a0, b1 - b0), b0 < -0.3 ? SC.under : SC.top); }
    for (let i = 0; i < 18 * wx; i++) { const a = -4.2 + rnd() * 3.2, b = -0.6 + rnd() * 0.9; respray(Q, (g) => g.rect(a, b, 0.1 + rnd() * 0.3, 0.02 + rnd() * 0.06), SC.top, 0.8); }
    for (const [a0, b0, a1, b1] of pans) { Q.panel(a0, b0, a1, b1, { ...seam, r: 0.03 }); for (const [p, q2] of [[[a0 + 0.03, b0 + 0.03], [a1 - 0.03, b0 + 0.03]], [[a0 + 0.03, b1 - 0.03], [a1 - 0.03, b1 - 0.03]], [[a0 + 0.03, b0 + 0.03], [a0 + 0.03, b1 - 0.03]], [[a1 - 0.03, b0 + 0.03], [a1 - 0.03, b1 - 0.03]]]) riv(Q, p[0], p[1], q2[0], q2[1], 0.065); }
    Q.line([[-4.4, 0.32], [-0.9, 0.12]], seam);
    // national insignia: low-vis on the line jet, full colour on the CAG birds
    Q.decal(-2.15, -0.12, (g) => K.drawStarBar(g, 0.6, cag ? {} : { lowVis: markCol }));
    // intake danger chevron + warning, red / white hazard band just behind the lip
    Q.text('DANGER', -3.95, 0.12, 0.05, { color: '#b3202a' });
    Q.decal(-3.95, -0.05, (g) => { g.strokeStyle = '#b3202a'; g.lineWidth = 0.022; g.beginPath(); g.moveTo(-0.16, 0.07); g.lineTo(0, -0.08); g.lineTo(0.16, 0.07); g.closePath(); g.stroke(); g.font = '700 0.06px sans-serif'; g.fillStyle = '#b3202a'; g.textAlign = 'center'; g.fillText('!', 0, 0.05); });
    for (let i = 0; i < 6; i++) stencil(Q, -3.5 + rnd() * 2.5, -0.5 + rnd() * 0.8);
    Q.noise({ alpha: 0.05 + 0.03 * wx, scale: 1.2, rough: 0.06 });
    for (let i = 0; i < 10 * wx; i++) { const z = -3.8 + rnd() * 2.5, y = -0.5 + rnd() * 0.9; Q.streak(z, y, z + 0.6 + rnd(), y - 0.05, 0.02, { alpha: 0.12 }); }
  }

  // ================= nacelles (a = z - 1.6 along the body, b = around: 0 bottom, .875 outboard on the right) =================
  for (const key of ['R', 'L']) {
    const Q = atlas.pen(cNac[key]), out = key === 'R' ? 0.875 : 2.625;
    Q.fill('all', under);
    Q.fill((g) => g.rect(0, out - 0.6, 5.8, 1.6), top, { feather: 8 });
    for (let i = 0; i < 6; i++) { const a = 0.4 + i * 0.9; if (rnd() < 0.5 * wx + 0.1) respray(Q, (g) => g.rect(a + 0.04, rnd() * 2.5, 0.8, 0.5 + rnd()), SC.under); }
    for (const a of [1.2, 2.3, 3.4, 4.5, 5.3]) Q.line([[a, 0], [a, 3.5]], seam);
    for (const b of [0.4, 1.4, 2.1, 3.1]) Q.line([[0, b], [5.8, b]], { ...seam, dark: 0.1 });
    for (const a of [1.24, 2.26, 3.44, 4.46]) riv(Q, a, 0.05, a, 3.45, 0.07);
    Q.panel(3.5, out - 0.35, 4.4, out + 0.3, { ...seam, r: 0.03 });
    const rot = key === 'R' ? 180 : 0;
    Q.text('NAVY', 2.4, out - 0.05, 0.22, { color: markCol, rot, font: K.FONT.wide });
    Q.text(`BuNo ${SC.buno}`, 2.4, out + (key === 'R' ? 0.22 : -0.22), 0.05, { color: markCol, rot });
    Q.text('F/A-18E', 2.4, out + (key === 'R' ? 0.3 : -0.3), 0.04, { color: markCol, rot });
    Q.fill((g) => g.rect(4.4, 0, 1.4, 3.5), { color: 'rgba(34,30,26,0.32)' }, { feather: 16 });       // heat / soot toward the nozzles
    Q.fill((g) => g.rect(5.3, 0, 0.5, 3.5), { color: '#5b5a55', rough: 0.5, metal: 0.4 }, { alpha: 0.5, feather: 6 });   // bare-metal heat shield ring
    Q.noise({ alpha: 0.08, scale: 1.0, stretch: [2, 1], rough: 0.08 });
    for (let i = 0; i < 14; i++) { const b = rnd() * 3.5, a = 2.8 + rnd() * 2; Q.streak(a, b, a + 1.2, b, 0.04, { alpha: 0.2 }); }
  }

  // ================= wings =================
  for (const key of ['R', 'L']) {
    const s = key === 'R' ? 1 : -1, wg = W.R;
    const at = (x, f) => { const p = wg.at(x, f); return [p[0] * s, p[2]]; };
    const hTE = (x) => wg.lines.hingeTE.at(wg.spanToU(x)), hLE = (x) => wg.lines.hingeLE.at(wg.spanToU(x));
    const quadW = (x0, f0, x1, f1) => [at(x0, f0), at(x1, f0), at(x1, f1), at(x0, f1)];
    for (const [chart, fin2, isTop] of [[cWT[key], top, true], [cWB[key], under, false]]) {
      const Q = atlas.pen(chart), ln = (pts, op) => Q.line(pts, op), base = isTop ? SC.top : SC.under;
      Q.fill('all', fin2);
      // access panels (fastener-lined), resprayed at random
      const pans = [[1.4, 0.2, 2.2, 0.36], [1.4, 0.38, 2.2, 0.55], [2.3, 0.2, 3.1, 0.36], [2.3, 0.38, 3.1, 0.55], [3.2, 0.22, 3.65, 0.5], [3.9, 0.24, 4.7, 0.5], [4.8, 0.25, 5.6, 0.5], [1.6, 0.58, 3.5, 0.66], [4.0, 0.56, 5.8, 0.66]];
      for (const [x0, f0, x1, f1] of pans) if (rnd() < 0.5 * wx + 0.1) respray(Q, quadW(x0, f0, x1, f1), base);
      for (let i = 0; i < 26 * wx; i++) { const x = 1.4 + rnd() * 4.4, f = 0.05 + rnd() * 0.85; respray(Q, quadW(x, f, x + 0.1 + rnd() * 0.5, f + 0.02 + rnd() * 0.06), base, 0.8); }
      if (cag && isTop) {   // CAG wingtip bands
        const cA = SC.finA, cB = cag === 'storm' ? SC.finB : SC.finC;
        Q.fill(quadW(X_TIP - 0.55, 0.0, X_TIP, 1.0), { color: cA, rough: 0.5, metal: 0 }); Q.fill(quadW(X_TIP - 0.63, 0.0, X_TIP - 0.55, 1.0), { color: cB, rough: 0.5, metal: 0 });
      }
      for (const [x0, f0, x1, f1] of pans) { Q.line(closed(quadW(x0, f0, x1, f1)), seam); for (const [a, b] of [[[x0 + 0.03, f0 + 0.01], [x1 - 0.03, f0 + 0.01]], [[x0 + 0.03, f1 - 0.01], [x1 - 0.03, f1 - 0.01]]]) { const p = at(...a), q2 = at(...b); riv(Q, p[0], p[1], q2[0], q2[1], 0.06); } }
      for (const f of [0.08, 0.18]) ln([at(1.3, f), at(X_TIP - 0.05, f)], seam);
      ln([at(X_FOLD + 0.006, 0), at(X_FOLD + 0.006, 1)], gap);                                                      // fold joint
      ln([at(1.5, hTE(1.5)), at(X_FOLD - 0.03, hTE(X_FOLD - 0.03)), at(X_FOLD - 0.03, 1)], gap);                    // flap
      ln([at(1.5, hTE(1.5)), at(1.5, 1)], gap);
      ln([at(X_FOLD + 0.06, 1), at(X_FOLD + 0.06, hTE(X_FOLD + 0.06)), at(6.0, hTE(6.0)), at(6.0, 1)], gap);      // aileron
      ln([at(1.95, 0), at(1.95, hLE(1.95)), at(X_FOLD, hLE(X_FOLD))], gap);                                         // LEFs
      ln([at(X_FOLD + 0.02, hLE(X_FOLD + 0.02)), at(X_TIP - 0.05, hLE(X_TIP - 0.05)), at(X_TIP - 0.05, 0)], gap);
      for (const f of [0.085, 0.185]) { const a = at(1.4, f + 0.01), b = at(X_TIP - 0.1, f + 0.01); riv(Q, a[0], a[1], b[0], b[1], 0.05); }
      for (const x of [2.0, 2.9, 4.4, 5.3]) { const a = at(x, 0.2), b = at(x, hTE(x) - 0.01); riv(Q, a[0], a[1], b[0], b[1], 0.06); }
      if (isTop) {
        // root walkway outline, LE erosion, hinge-line grime, fold-line warning stripe
        ln(closed(quadW(1.35, 0.22, 2.3, 0.55)), { px: 1.4, depth: 0, dark: 0.5 });
        for (let i = 0; i < 30 * wx; i++) { const x = 1.35 + rnd() * 0.95, f = 0.22 + rnd() * 0.33, p = at(x, f); Q.fill((g) => g.ellipse(p[0], p[1], 0.05, 0.09, rnd(), 0, Math.PI * 2), { color: '#3a3b3c', rough: 0.75, metal: 0 }, { alpha: 0.1 + rnd() * 0.12 }); }
        const le = [at(1.95, 0.006), at(X_TIP - 0.1, 0.006)];
        Q.wear((g) => { g.moveTo(le[0][0], le[0][1]); g.lineTo(le[1][0], le[1][1]); }, 0.03, { color: tone(SC.top, 0.22), rough: 0.5, metal: 0.15 }, { alpha: 0.5 });
        const p = at(2.6, 0.62); Q.text('NO STEP', p[0], p[1], 0.05, { color: markCol });
        { const a = at(X_FOLD - 0.05, 0.25), b = at(X_FOLD - 0.05, 0.6); Q.line([a, b], { px: 3, depth: 0, dark: 0, color: '#b3202a' }); }
        // modex on the outer leading-edge flap
        { const m = at(4.95, 0.09); Q.text(SC.modex, m[0], m[1], 0.17, { color: markCol, weight: 700, rot: s > 0 ? 0 : 0 }); }
        for (let i = 0; i < 5; i++) { const q = at(1.6 + rnd() * 4, 0.3 + rnd() * 0.3); stencil(Q, q[0], q[1]); }
        // salt-faded upper surface
        Q.noise({ alpha: 0.05 * wx, scale: 3, stretch: [1, 2], mode: 'light' });
      }
      Q.noise({ alpha: 0.04 + 0.03 * wx, scale: 1.6, stretch: [1, 2.2], rough: 0.06 });
      Q.noise({ alpha: 0.03, scale: 0.5, mode: 'light' });
      for (let i = 0; i < 16 * wx; i++) { const x = 1.6 + rnd() * 4.2, f = hTE(x), a = at(x, f - 0.25 * rnd()); Q.streak(a[0], a[1], a[0], a[1] + 0.3 + rnd() * 0.5, 0.025 + rnd() * 0.03, { alpha: 0.14 }); }
      if (!isTop) for (let i = 0; i < 10 * wx; i++) { const x = 1.6 + rnd() * 3, a = at(x, 0.3 + rnd() * 0.3); Q.streak(a[0], a[1], a[0], a[1] + 0.8 + rnd(), 0.03, { alpha: 0.18, color: '50,40,28' }); }
      if (isTop && key === 'L') Q.decal(-4.65, 1.05, (g) => K.drawStarBar(g, 0.82, cag ? {} : { lowVis: markCol }));
      if (!isTop && key === 'R') Q.decal(4.65, 1.05, (g) => K.drawStarBar(g, 0.82, cag ? {} : { lowVis: markCol }));
      if (!isTop && key === 'L') Q.text('NAVY', -4.3, 1.1, 0.42, { color: markCol, font: K.FONT.wide, rot: -90 });
    }
  }
  // ================= stabilators =================
  for (const [chart, f, isTop, sx] of [[cST.R, top, true, 1], [cST.L, top, true, -1], [cSB, under, false, 1]]) {
    const Q = atlas.pen(chart); Q.fill('all', f);
    for (let i = 0; i < 10 * wx; i++) { const x = sx * (1.2 + rnd() * 2.8), z = 5.4 + rnd() * 2.8; respray(Q, (g) => g.rect(x, z, 0.3 + rnd() * 0.5, 0.2 + rnd() * 0.5), isTop ? SC.top : SC.under, 0.7); }
    if (cag && isTop) Q.fill((g) => g.rect(sx > 0 ? 3.75 : -4.35, 4.95, 0.6, 3.7), { color: SC.finA, rough: 0.5, metal: 0 });
    for (const zz of [6.0, 6.9, 7.7]) Q.line([[sx * 1.05, zz], [sx * 4.25, zz + 0.9]], seam);
    for (const x of [1.8, 2.6, 3.4]) Q.line([[sx * x, 4.95], [sx * x, 8.65]], { ...seam, dark: 0.1 });
    for (const x of [1.83, 2.63, 3.43]) riv(Q, sx * x, 5.3, sx * x, 8.3, 0.07);
    Q.noise({ alpha: 0.07, scale: 1.0, stretch: [1, 2], rough: 0.06 });
    if (isTop) Q.fill((g) => g.rect(sx * 1.3 - 0.45, 7.4, 0.9, 1.2), { color: 'rgba(36,32,28,0.4)' }, { feather: 12 });
  }
  // ================= fins (side charts: a = z, b = y) =================
  const skull = (g, sc, white, dark) => {   // Jolly Rogers skull and crossbones, centred, size sc metres
    g.save(); g.scale(sc, sc); g.fillStyle = white;
    for (const r of [-0.6, 0.6]) { g.save(); g.rotate(r); g.fillRect(-0.62, -0.055, 1.24, 0.11); for (const e of [-0.62, 0.62]) { g.beginPath(); g.arc(e, -0.06, 0.07, 0, Math.PI * 2); g.arc(e, 0.06, 0.07, 0, Math.PI * 2); g.fill(); } g.restore(); }
    g.beginPath(); g.ellipse(0, -0.12, 0.32, 0.3, 0, 0, Math.PI * 2); g.fill(); g.fillRect(-0.18, 0.05, 0.36, 0.22);
    g.fillStyle = dark; for (const e of [-0.12, 0.12]) { g.beginPath(); g.ellipse(e, -0.1, 0.085, 0.075, 0, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.moveTo(0, 0.0); g.lineTo(-0.04, 0.07); g.lineTo(0.04, 0.07); g.fill();
    for (let k = -2; k <= 2; k++) g.fillRect(k * 0.065 - 0.008, 0.17, 0.016, 0.1);
    g.restore();
  };
  for (const key of ['Rout', 'Lout', 'Rin', 'Lin']) {
    const Q = atlas.pen(cFin[key]), outer = key.endsWith('out'), fr = fin.R;
    const at = (u, f) => { const p = fr.at(u, f); return [p[2], p[1]]; };
    const hz = (u) => fr.lines.hinge.at(fr.spanToU(u));
    const L = FN.len, all = [at(0, 0), at(L, 0), at(L, 1), at(0, 1)];
    Q.fill('all', top);
    for (let i = 0; i < 8 * wx; i++) { const u = 0.5 + rnd() * 2.2, f = 0.1 + rnd() * 0.6; respray(Q, [at(u, f), at(u, f + 0.1 + rnd() * 0.15), at(u + 0.2 + rnd() * 0.3, f + 0.1), at(u + 0.2, f)], SC.top, 0.8); }
    if (cag === 'storm') {
      Q.fill([at(1.0, 0), at(L, 0), at(L, 1), at(1.0, 1)], { color: SC.finA, rough: 0.5, metal: 0 });
      Q.fill([at(0.9, 0), at(1.0, 0), at(1.0, 1), at(0.9, 1)], { color: SC.finB, rough: 0.5, metal: 0 });
      const b = [at(2.85, 0.16), at(2.85, 0.36), at(2.2, 0.56), at(2.28, 0.68), at(1.08, 0.93), at(1.87, 0.5), at(1.8, 0.38)];
      Q.fill(b, { color: SC.finB, rough: 0.5, metal: 0 }); Q.stroke((g) => { b.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); }, 0.03, { color: SC.finC, rough: 0.5, metal: 0 });
      Q.fill([at(L - 0.2, 0), at(L, 0), at(L, 1), at(L - 0.2, 1)], { color: SC.finB, rough: 0.5, metal: 0 });
    } else if (cag === 'jolly') {
      Q.fill(all, { color: SC.finA, rough: 0.48, metal: 0 });
      Q.fill([at(L - 0.16, 0), at(L, 0), at(L, 1), at(L - 0.16, 1)], { color: SC.finC, rough: 0.5, metal: 0 });
      if (outer) { const c = at(1.45, 0.42); Q.decal(c[0], c[1], (g) => skull(g, 0.95, SC.finB, SC.finA)); }
    }
    Q.line([at(0.42, 1), at(0.42, hz(0.42)), at(1.93, hz(1.93)), at(1.93, 1)], gap);
    for (const u of [0.9, 1.45, 2.3, 2.7]) Q.line([at(u, 0.03), at(u, u < 1.93 ? hz(u) : 0.97)], seam);
    for (const f of [0.2, 0.45]) Q.line([at(0.3, f), at(L - 0.05, f)], seam);
    for (const f of [0.215, 0.465]) { const a = at(0.35, f), b = at(L - 0.1, f); riv(Q, a[0], a[1], b[0], b[1], 0.07); }
    Q.fill([at(L - 0.25, 0.0), at(L - 0.02, 0.0), at(L - 0.02, 0.2), at(L - 0.25, 0.2)], F.composite(tone(SC.top, -0.15)));     // dielectric LE cap
    if (outer) {
      const c = at(2.2, 0.4), d = at(1.15, 0.36);
      const codeCol = cag === 'storm' ? SC.finB : cag === 'jolly' ? SC.finB : markCol;
      Q.text(SC.code, c[0], c[1], cag === 'jolly' ? 0.36 : 0.48, { color: codeCol, weight: 700, outline: cag === 'storm' ? '#101318' : cag === 'jolly' ? SC.finC : null, outlineWidth: 6 });
      if (!cag) { Q.decal(d[0], d[1], (g) => { g.strokeStyle = markCol; g.lineWidth = 0.02; g.beginPath(); g.arc(0, 0, 0.2, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(-0.05, -0.17); g.lineTo(0.08, -0.03); g.lineTo(-0.01, -0.01); g.lineTo(0.06, 0.16); g.lineTo(-0.08, 0.0); g.lineTo(0.01, -0.02); g.closePath(); g.stroke(); }); }
      const m = at(0.7, 0.5); Q.text(SC.squadron, m[0], m[1], 0.07, { color: cag ? (cag === 'storm' ? SC.finB : SC.finC) : markCol });
      const r = at(0.25, 0.8); Q.text(SC.modex, r[0], r[1], 0.12, { color: cag ? SC.finB : markCol, weight: 700 });
    }
    Q.noise({ alpha: 0.06, scale: 1.2, stretch: [1, 1.5], rough: 0.05 });
    for (let i = 0; i < 6 * wx; i++) { const a = at(0.5 + rnd() * 2, 0.6 + rnd() * 0.3); Q.streak(a[0], a[1], a[0] + 0.8, a[1] - 0.1, 0.03, { alpha: 0.12 }); }
  }
  // ================= nozzle petals (a = around, b = hinge → exit) =================
  {
    const Q = atlas.pen(cNoz), n = 12, w = 3.2 / n;
    Q.fill('all', { color: '#7c746b', rough: 0.52, metal: 0.8 });
    for (let i = 0; i < n; i++) {
      Q.fill((g) => g.rect(i * w, 0, w, 1.2), { color: i % 2 ? '#6d655c' : '#857b70', rough: 0.5 + rnd() * 0.1, metal: 0.8 });
      Q.fill((g) => g.rect(i * w + w * 0.3, 0.06, w * 0.4, 1.05), { color: '#9a8f82', rough: 0.45, metal: 0.8 }, { alpha: 0.4 });
      Q.fill((g) => g.rect(i * w, 0.55 + rnd() * 0.2, w, 0.4), { color: rnd() < 0.5 ? '#5f5a6b' : '#6b5a48', rough: 0.5, metal: 0.85 }, { alpha: 0.35, feather: 5 });   // blue / straw heat tint
      Q.line([[i * w, 0], [i * w, 1.2]], { px: 2, depth: 0.9, dark: 0.6 });
      Q.rivets(i * w + w * 0.15, 0.1, i * w + w * 0.15, 1.1, 0.08, { px: 1.2, depth: 0.2, dark: 0.1 });
    }
    Q.fill((g) => g.rect(0, 0.8, 3.2, 0.4), { color: '#3e3631', rough: 0.6, metal: 0.8 }, { alpha: 0.55, feather: 6 });
    Q.fill((g) => g.rect(0, 0, 3.2, 0.09), { color: '#5a5550', rough: 0.5, metal: 0.8 });
    Q.noise({ alpha: 0.12, scale: 0.8, stretch: [1, 2] });
  }
  // ================= drop tanks (a = along 0..4.7 nose → tail, b = around 0..2.3) =================
  {
    const Q = atlas.pen(cTank), base = mixHex(SC.under, '#7f878e', 0.5);
    Q.fill('all', paintF(base));
    Q.fill((g) => g.rect(0, 0, 4.7, 2.3), paintF(variant(base)), { alpha: 0.5 });
    for (const a of [0.95, 3.6]) Q.line([[a, 0], [a, 2.3]], seam);
    for (const a of [0.98, 3.57]) riv(Q, a, 0, a, 2.3, 0.05);
    Q.line([[0, 1.15], [4.7, 1.15]], { ...seam, dark: 0.08 });
    Q.text('480 GAL', 2.3, 0.6, 0.05, { color: markCol }); Q.text('NO STEP', 2.3, 1.7, 0.04, { color: markCol });
    Q.text('JP-5', 1.4, 0.65, 0.04, { color: markCol });
    Q.noise({ alpha: 0.08, scale: 1, stretch: [2, 1], rough: 0.06 });
    for (let i = 0; i < 10; i++) { const b = rnd() * 2.3, a = 1 + rnd() * 2; Q.streak(a, b, a + 1.5, b, 0.04, { alpha: 0.15 }); }
    if (cag) Q.fill((g) => g.rect(0.02, 0, 0.6, 2.3), { color: cag === 'storm' ? SC.finB : SC.finA, rough: 0.5, metal: 0 }, { alpha: 0.9 });
  }
  for (const Q of [...dotQ.keys()]) flushDots(Q);
}
