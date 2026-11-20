// F-22A Raptor — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (1.7 m) when parked.
//
// Reference numbers (docs/aircraft/f22.md + proportions from photographs / 3-views; body z = d + noseZ, noseZ = -10.9):
//   length 18.92 m (nose tip z -10.9 → nozzle flap tips z 8.0), span 13.56 m, height 5.08 m (fin tips y +3.38).
//   Fuselage reference line y +0.10 (nose tip, engine axes). Belly y ≈ -0.82 (0.88 m above the ground, flat).
//   Forebody: flattened rounded-diamond section with sharp chines; chine half-width 0.82 at the windshield (z -7.5),
//   1.06 at z -5.5, then a chine shelf runs over the intakes out to the wing leading-edge root (x 1.75, z -2.77).
//   Canopy: one piece, z -7.62 … -3.45 (4.2 m incl. the fairing), peak y 1.32 at z -5.6, max half-width 0.52.
//   Intakes: caret, lip apex (upper inboard corner) at z -4.3, x 0.96 … 1.74, y -0.80 … -0.06, lips swept 29° in side
//            view and 32° in plan; 16° side-wall lean; boundary-layer bleed slot between the inner lip and the body.
//   Wing: LE 42°, TE swept forward 17°, LE root x 1.75 z -2.77, tip x 6.78 LE z 1.76 chord 1.8 (root chord 8.4 at the
//         body side), 2.5° anhedral, NACA 6-series 5 % → 4 %, -2° tip twist. Inboard of x 2.58 the trailing edge turns
//         forward parallel to the stabilator LE (the notch the stab nests in). LEF 12–95 % span, flaperons 2.66–4.0 m,
//         ailerons 4.05–6.1 m.
//   Stabilators: all-moving, root x 1.86 LE z 4.3 chord 3.7, tip x 4.42 chord 0.61, LE 42° ∥ wing LE, TE swept forward
//         17° ∥ wing TE, pivot z 6.0.
//   Fins: canted 27° outboard, root x 1.22 y 0.45 LE z 2.5 chord 4.6, slant height 3.3, tip chord 1.7, LE 28°, rudders.
//   Nozzles: 2D C-D, centres x ±1.15 y 0.10, hinge z 7.02 → sawtooth flap tips z 8.0, 1.1 m wide, 0.82 m high at the
//            hinge. Pitch vectoring ±20° (nozzlePitch), area opening with S.eng[i].nozzle.
//   Gear: nose single wheel r 0.25 at z -5.5 (retracts forward), mains r 0.40 at x ±2.15 z 0.6 (retract forward and
//         twist flat into bays beside the main weapons bay). Wheelbase 6.1, track 4.3.
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['langley', 'elmendorf', 'hickam', 'lowvis', 'aggressor'];

// adversary palette (the rest of the aggressor family code is at the end of the file)
const AGG = { sand: '#b39c72', rust: '#8a623e', earth: '#4a4233', under: '#c4bba4', red: '#c02e1d', ink: '#141617', white: '#ece9df' };

// Real unit markings, invented serials. band: fin-tip band colour, bandText, stripes: thin accent stripes in the band.
const SCHEMES = {
  langley: { name: '1st FW Langley (FF)', base: '#6f747a', camo: '#63686e', under: '#7a7f85', mark: '#53575d', code: 'FF', serial: 'AF 12-4219', unit: '1 FW', band: '#4b4f55', bandText: 'LANGLEY', stripes: ['#5e6a7a'], seed: 777, sheenColor: '#9a978f' },
  elmendorf: { name: '3rd Wing Elmendorf (AK)', base: '#6b7076', camo: '#5e6369', under: '#757a80', mark: '#4c5056', code: 'AK', serial: 'AF 11-4207', unit: '3 WG', band: '#3c4757', bandText: 'ALASKA', stars: '#8f8a6c', seed: 4211, sheenColor: '#959aa3' },
  hickam: { name: '15th Wing / 199th FS Hickam (HH)', base: '#6d7278', camo: '#61666c', under: '#777c82', mark: '#4f5359', code: 'HH', serial: 'AF 13-4236', unit: '15 WG', band: '#34373b', bandText: 'HAWAII', stripes: ['#7a3a32', '#8c7a3c'], seed: 9001, sheenColor: '#a0988a' },
  // the invented adversary air force (AGG block at the end of the file): hard-edged splinter bands in the family colours, laid
  // in the LO coating so the panel lines, RAM tape and sheen stay
  aggressor: { name: 'Adversary desert splinter', base: AGG.sand, camo: AGG.rust, under: AGG.under, mark: '#2b2620', code: '', serial: '', unit: '', band: null, seed: 2222, irid: 0.08, sheen: 0.07, sheenColor: '#a89a7e',
    agg: { seed: 2222, step: 1.7, A: 0.5, Ax: 0.2, B: 0.8, splinter: 0.28 }, num: 22 },
  lowvis: { name: 'Sanitised test aircraft', base: '#74787d', camo: '#6b6f74', under: '#7e8287', mark: '#696d72', code: '', serial: 'AF 14-4240', unit: '', band: null, seed: 1234, irid: 0.2, sheenColor: '#97989a' },
};

// ------------------------------------------------------------------------------------------------------------------------
// local helpers (kit has no free-form grid surface)
// ------------------------------------------------------------------------------------------------------------------------
/** Grid surface: rows[i][j] = [x, y, z]; j runs counter-clockwise (seen from the front, x right / y up) around closed rings.
 *  Normal = d/dj × d/di, so a ring sequence running aft (+z) faces outward. uv(i, j, p) → [u, v]. */
function grid(rows, o = {}) {
  const m = new K.Mesh(), R = rows.length, N = rows[0].length, closed = o.closed !== false;
  const P = (i, j) => rows[i][closed ? ((j % N) + N) % N : Math.max(0, Math.min(N - 1, j))];
  const ids = [];
  for (let i = 0; i < R; i++) {
    const row = [];
    for (let j = 0; j < N; j++) {
      const a = P(i, j - 1), b = P(i, j + 1), c = P(Math.max(0, i - 1), j), d = P(Math.min(R - 1, i + 1), j);
      const dj = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], di = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
      let n = [dj[1] * di[2] - dj[2] * di[1], dj[2] * di[0] - dj[0] * di[2], dj[0] * di[1] - dj[1] * di[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map(v => (o.flip ? -v : v) / l);
      const p = rows[i][j], uv = o.uv ? o.uv(i, j, p) : [0, 0];
      row.push(m.vert(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]));
    }
    ids.push(row);
  }
  const J = closed ? N : N - 1;
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < J; j++) {
    const a = ids[i][j], b = ids[i][(j + 1) % N], c = ids[i + 1][(j + 1) % N], d = ids[i + 1][j];
    if (o.flip) m.quad(a, d, c, b); else m.quad(a, b, c, d);
  }
  return m;
}

/** Closed rounded polygon (corners CCW, x/y) resampled to n points with outward 2D normals: [{ p: [x, y], n: [nx, ny] }]. */
function roundedRing(corners, r, n) {
  const pts = [], K4 = corners.length;
  for (let k = 0; k < K4; k++) {
    const A = corners[(k + K4 - 1) % K4], B = corners[k], C = corners[(k + 1) % K4];
    const e1 = norm2([B[0] - A[0], B[1] - A[1]]), e2 = norm2([C[0] - B[0], C[1] - B[1]]);
    const n1 = [e1[1], -e1[0]], n2 = [e2[1], -e2[0]];          // outward normals (CCW polygon)
    const turn = Math.acos(Math.max(-1, Math.min(1, e1[0] * e2[0] + e1[1] * e2[1])));
    const back = r * Math.tan(turn / 2);
    const cen = [B[0] - e1[0] * back - n1[0] * r, B[1] - e1[1] * back - n1[1] * r];
    const a0 = Math.atan2(n1[1], n1[0]); let a1 = Math.atan2(n2[1], n2[0]); if (a1 < a0) a1 += Math.PI * 2;
    for (let s = 0; s <= 4; s++) { const a = a0 + (a1 - a0) * s / 4; pts.push({ p: [cen[0] + Math.cos(a) * r, cen[1] + Math.sin(a) * r], n: [Math.cos(a), Math.sin(a)] }); }
  }
  // resample by arc length
  const cum = [0]; for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1].p, b = pts[i % pts.length].p; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[pts.length], out = []; let s = 0;
  for (let k = 0; k < n; k++) {
    const t = L * k / n; while (cum[s + 1] < t) s++;
    const f = (t - cum[s]) / Math.max(1e-9, cum[s + 1] - cum[s]), a = pts[s], b = pts[(s + 1) % pts.length];
    out.push({ p: [a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f], n: norm2([a.n[0] + (b.n[0] - a.n[0]) * f, a.n[1] + (b.n[1] - a.n[1]) * f]) });
  }
  return out;
}
function norm2(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

/** Flat plate given by a plan outline [[z, x], …] (any winding), thickness t centred on y = 0; returns a Mesh. */
function planPlate(outline, t, uv) {
  return K.prism(outline.map(([z, x]) => [z, -x]), -t / 2, t / 2, uv).rotateZ(Math.PI / 2);
}

/** The F-22's low-observable topcoat is a metallic-pigment grey whose tone slides between warm (bronze) and cool
 *  (blue-grey) with view angle and a soft silky sheen at grazing angles. The kit's atlas material is a
 *  MeshStandardMaterial; when it is a plain one, rebuild it as a MeshPhysicalMaterial on the same maps with a weak
 *  thin-film (iridescence) layer and sheen. Rough surfaces (tyres, cockpit, soot) barely show either effect. */
function loCoating(src, SC) {
  if (!src || !src.isMeshStandardMaterial || src.isMeshPhysicalMaterial || src.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return src;
  const m = new THREE.MeshPhysicalMaterial({
    map: src.map, normalMap: src.normalMap, roughnessMap: src.roughnessMap, metalnessMap: src.metalnessMap, roughness: src.roughness, metalness: src.metalness,
    emissiveMap: src.emissiveMap, emissive: src.emissive, emissiveIntensity: src.emissiveIntensity, envMapIntensity: src.envMapIntensity,
    iridescence: SC.irid ?? 0.16, iridescenceIOR: 1.4, iridescenceThicknessRange: [300, 420],
    sheen: 0.16, sheenRoughness: 0.45, sheenColor: new THREE.Color(SC.sheenColor || '#9a978f'),
  });
  m.normalScale.copy(src.normalScale);
  src.dispose();
  return m;
}

// ------------------------------------------------------------------------------------------------------------------------
export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'langley', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const seg = Math.max(32, Math.round(76 * detail / 4) * 4);
  const coat = (c, k = 1) => ({ color: c, rough: 0.6 - 0.06 * Math.min(1, k), metal: (SC.sheen ?? 0.16) * k });     // LO coating with a metallic sheen

  // ---- atlas ------------------------------------------------------------------------------------------------------------
  const atlas = K.createAtlas({ size: atlasSize, base: coat(SC.base) });
  const cFus = atlas.chart('fus', { type: 'unwrap', z: [-10.95, 7.45], girth: 8.6, vScale: 0.85, strips: 2 });
  const cWT = { R: atlas.chart('wingTopR', { type: 'plan', x: [1.1, 6.86], z: [-3.45, 5.45], view: 'top' }), L: atlas.chart('wingTopL', { type: 'plan', x: [-6.86, -1.1], z: [-3.45, 5.45], view: 'top' }) };
  const cWB = { R: atlas.chart('wingBotR', { type: 'plan', x: [1.1, 6.86], z: [-3.45, 5.45], view: 'bottom', density: 0.6 }), L: atlas.chart('wingBotL', { type: 'plan', x: [-6.86, -1.1], z: [-3.45, 5.45], view: 'bottom', density: 0.6 }) };
  const cST = { R: atlas.chart('stabTopR', { type: 'plan', x: [1.8, 4.5], z: [4.2, 8.1], view: 'top', density: 0.8 }), L: atlas.chart('stabTopL', { type: 'plan', x: [-4.5, -1.8], z: [4.2, 8.1], view: 'top', density: 0.8 }) };
  const cSB = atlas.chart('stabBot', { type: 'plan', x: [1.8, 4.5], z: [4.2, 8.1], view: 'bottom', mirror: true, density: 0.6 });
  const FIN = { x: 1.22, y: 0.45, cant: 27 * DEG };
  const fv = (s) => [s * Math.sin(FIN.cant), Math.cos(FIN.cant), 0];
  const finChart = (name, s, flip, density) => atlas.chart(name, { type: 'proj', origin: [s * FIN.x, FIN.y, 0], u: [0, 0, 1], v: fv(s), a: [2.0, 7.4], b: [-0.45, 3.45], bUp: true, flip, density });
  const cFin = { RO: finChart('finRO', 1, true, 1), RI: finChart('finRI', 1, false, 0.6), LO: finChart('finLO', -1, false, 1), LI: finChart('finLI', -1, true, 0.6) };
  const cInt = { R: atlas.chart('intakeR', { type: 'side', z: [-4.4, -0.7], y: [-0.92, 0.05], view: 'right', density: 0.8 }), L: atlas.chart('intakeL', { type: 'side', z: [-4.4, -0.7], y: [-0.92, 0.05], view: 'left', density: 0.8 }) };
  const cNac = atlas.chart('nacelle', { type: 'unwrap', z: [2.9, 7.05], girth: 3.4, density: 0.7 });
  atlas.pack();
  const U = {
    base: atlas.swatch('base', coat(SC.base)), camo: atlas.swatch('camo', coat(SC.camo)), under: atlas.swatch('under', coat(SC.under, 0.2)),
    duct: atlas.swatch('duct', { color: '#5e6267', rough: 0.6, metal: 0.1 }), ductDark: atlas.swatch('ductDark', { color: '#3a3d40', rough: 0.6, metal: 0 }),
    dark: atlas.swatch('dark', F.darkGrey), black: atlas.swatch('black', F.black),
    exhaust: atlas.swatch('exhaust', F.exhaust), flap: atlas.swatch('flap', { color: '#666a6f', rough: 0.5, metal: 0.4 }), flapIn: atlas.swatch('flapIn', { color: '#857360', rough: 0.42, metal: 0.9 }),
    side: atlas.swatch('nozSide', coat('#6c7176', 0.9)), heat: atlas.swatch('heat', { color: '#6d6058', rough: 0.48, metal: 0.9 }),
    well: atlas.swatch('well', F.gearWhite), interior: atlas.swatch('interior', F.interior), console: atlas.swatch('console', { color: '#2a2d30', rough: 0.62, metal: 0 }),
    seat: atlas.swatch('seat', { color: '#25282a', rough: 0.7, metal: 0 }), cushion: atlas.swatch('cushion', F.fabric), accent: atlas.swatch('accent', { color: '#d6b21e', rough: 0.5, metal: 0 }),
    suit: atlas.swatch('suit', { color: '#4d5540', rough: 0.9, metal: 0 }), helmet: atlas.swatch('helmet', { color: '#5c6166', rough: 0.4, metal: 0 }), visor: atlas.swatch('visor', { color: '#0a0b0d', rough: 0.05, metal: 0.4 }),
    glove: atlas.swatch('glove', { color: '#3a3d33', rough: 0.9, metal: 0 }), frame: atlas.swatch('frame', coat('#4e5257', 0.6)), steel: atlas.swatch('steel', F.steel),
    sill: atlas.swatch('sill', { color: '#2b2e31', rough: 0.6, metal: 0.1 }), lens: atlas.swatch('lens', F.lens),
  };

  const rig = K.createRig(ctx, { geometry: G, name: 'f22', glassLayer: opts.glassLayer });
  rig.material('paint', null);
  const stat = new K.Mesh();

  // ---- fuselage: chined forebody, chine shelf over the intakes, wide flat centre/aft body --------------------------------
  //   z       yc      w      top    bot    kTop          kBot          aTop aBot  chine [w, y, tu, tl, k, e]
  const FS = [
    [-10.90, 0.100, 0.000, 0.000, 0.000],
    [-10.80, 0.096, 0.072, 0.055, 0.045, 0.6, 0.58, 32, 26],
    [-10.55, 0.092, 0.170, 0.128, 0.110, 0.6, 0.58, 32, 26],
    [-10.20, 0.086, 0.280, 0.208, 0.175, 0.6, 0.58, 32, 26],
    [-9.70, 0.080, 0.405, 0.305, 0.245, 0.6, 0.58, 32, 26],
    [-9.10, 0.070, 0.540, 0.410, 0.315, 0.6, 0.6, 32, 27],
    [-8.30, 0.056, 0.690, 0.548, 0.400, 0.6, 0.6, 33, 28],
    [-7.50, 0.042, 0.820, 0.678, 0.478, 0.62, 0.62, 34, 30],
    [-6.80, 0.028, 0.920, 0.750, 0.540, 0.62, 0.64, 36, 34],
    [-6.10, 0.014, 1.000, 0.780, 0.592, 0.62, 0.68, 38, 40],
    [-5.50, 0.000, 1.050, 0.790, 0.640, 0.62, [0.75, 0.75], 40, 52, [1.06, 0, 0.16, 0.12, 0.08, 1]],
    [-4.90, -0.010, 0.980, 0.800, 0.730, 0.6, [0.9, 0.85], 44, 80, [1.24, 0, 0.18, 0.14, 0.08, 1]],
    [-4.30, -0.020, 0.940, 0.815, 0.775, 0.6, [0.9, 0.85], 46, 86, [1.52, -0.02, 0.20, 0.14, 0.08, 1]],
    [-3.95, -0.022, 0.940, 0.822, 0.780, 0.6, [0.9, 0.85], 45, 86, [1.78, -0.025, 0.22, 0.14, 0.08, 1]],
    [-3.60, -0.025, 0.950, 0.830, 0.785, 0.6, [0.9, 0.85], 44, 86, [1.87, -0.03, 0.24, 0.14, 0.08, 1]],
    [-2.90, -0.055, 1.060, 0.800, 0.765, [0.5, 0.75], [0.9, 0.85], 34, 84, [1.9, -0.04, 0.26, 0.14, 0.08, 1]],
    [-2.20, -0.075, 1.500, 0.770, 0.745, [0.5, 0.75], [0.9, 0.85], 26, 78, [1.84, -0.03, 0.24, 0.12, 0.08, 1]],
    [-1.50, -0.090, 1.860, 0.755, 0.730, [0.5, 0.78], [0.9, 0.86], 20, 74, [1.9, -0.02, 0.2, 0.1, 0.08, 1]],
    [-1.00, -0.100, 1.900, 0.745, 0.722, [0.45, 0.8], [0.9, 0.86], 16, 74],
    [0.00, -0.100, 1.900, 0.725, 0.720, [0.45, 0.8], [0.9, 0.86], 14, 74],
    [1.50, -0.095, 1.860, 0.700, 0.720, [0.45, 0.8], [0.9, 0.86], 14, 74],
    [3.00, -0.085, 1.740, 0.640, 0.690, [0.5, 0.8], [0.9, 0.86], 14, 74],
    [4.50, -0.050, 1.600, 0.520, 0.540, [0.6, 0.8], [0.9, 0.86], 18, 72],
    [5.80, -0.030, 1.680, 0.360, 0.340, [0.65, 0.85], [0.9, 0.88], 18, 50],
    [6.60, -0.020, 1.710, 0.260, 0.220, [0.7, 0.85], [0.9, 0.9], 18, 40],
    [7.05, -0.015, 1.710, 0.200, 0.170, [0.7, 0.85], [0.9, 0.9], 18, 40],
  ].map(r => {
    const st = { z: r[0], y: r[1], w: r[2], top: r[3], bot: r[4], kTop: r[5] ?? 0.6, kBot: r[6] ?? 0.6, aTop: r[7] ?? 90, aBot: r[8] ?? 90 };
    if (r[9]) st.chine = { w: r[9][0], y: r[9][1], tu: r[9][2], tl: r[9][3], k: r[9][4], e: r[9][5] };
    return st;
  });
  // probe loft (coarse) to place cut-outs by real x positions
  const probe = K.loft({ stations: FS, segments: 64, step: 0.5 });
  const tAtX = (z, x, lo = 0, hi = 0.25) => { for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (probe.at(z, m).p[0] < x) lo = m; else hi = m; } return (lo + hi) / 2; };
  const tTopAtX = (z, x) => { let lo = 0.25, hi = 0.5; for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (probe.at(z, m).p[0] > x) lo = m; else hi = m; } return (lo + hi) / 2; };

  // canopy plan / profile
  const CZ = [-7.62, -7.45, -7.2, -6.9, -6.5, -6.0, -5.6, -5.0, -4.5, -4.0, -3.7, -3.45];
  const CW = [0.02, 0.16, 0.29, 0.385, 0.47, 0.53, 0.55, 0.54, 0.505, 0.45, 0.39, 0.33];
  const CT = [0, 0.88, 1.04, 1.175, 1.31, 1.395, 1.42, 1.39, 1.29, 1.11, 0.98, 0.87];
  const cwAt = K.pchip(CZ, CW);
  const CUT = { z0: -6.95, z1: -3.8 };
  const sillCache = new Map(), tSillAt = (z) => { const k = Math.round(z * 100); let v = sillCache.get(k); if (v === undefined) sillCache.set(k, v = tTopAtX(z, cwAt(z) - 0.03)); return v; };
  let tCutMin = 0.5; for (let z = CUT.z0; z <= CUT.z1; z += 0.1) tCutMin = Math.min(tCutMin, tSillAt(z));

  // gear bays
  const NG = { z: [-7.15, -5.55], x: 0.2 }, MG = { z: [-0.75, 1.2], x: [0.86, 1.6] };
  const tNG = tAtX(-6.3, NG.x), tMG0 = tAtX(0.2, MG.x[0]), tMG1 = tAtX(0.2, MG.x[1]);

  const fus = K.loft({
    stations: FS, segments: seg, step: 0.13 / detail, chart: cFus, creases: ['side'], capEnd: 'flat', capUV: U.dark,
    cutouts: [
      { name: 'cockpit', z: [CUT.z0, CUT.z1], t: [tCutMin, 1 - tCutMin], shape: (z, t) => { const tt = t < 0.5 ? t : 1 - t; return tt >= tSillAt(z) - 0.002; } },
      { name: 'ng', z: NG.z, t: [0, tNG], mirror: true },
      { name: 'mlg', z: MG.z, t: [tMG0, tMG1], mirror: true },
    ],
  });
  cFus.body = fus;
  stat.add(fus.mesh);
  lap('fuselage');

  // ---- intakes: caret inlets, one fold-over skin each (duct → sharp lip → outer wall), raked lips ---------------------------
  const INT = { z: -4.3, TI: [1.0, -0.11], TO: [1.86, -0.14], BO: [1.64, -0.80], BI: [0.95, -0.80], rakeY: 0.55, rakeX: 0.62, r: 0.05 };
  const lipZ = (x, y) => INT.z + INT.rakeY * (INT.TI[1] - y) + INT.rakeX * (x - INT.TI[0]);
  const NI = Math.max(32, Math.round(48 * detail / 4) * 4);
  const ringBase = roundedRing([INT.BI, INT.BO, INT.TO, INT.TI], INT.r, NI);
  const intakeMesh = (sx) => {
    const cen = [(INT.TI[0] + INT.TO[0] + INT.BO[0] + INT.BI[0]) / 4, (INT.TI[1] + INT.TO[1] + INT.BO[1] + INT.BI[1]) / 4];
    // [dz behind the lip, outset, shrink toward the centre, centre shift x, y, taper (aft outer wall pull-in)]
    const inner = [[2.2, -0.03, 0.7, -0.22, 0.12], [1.2, -0.03, 0.86, -0.1, 0.06], [0.45, -0.028, 0.97, 0, 0], [0.12, -0.022, 1, 0, 0], [0.03, -0.01, 1, 0, 0], [0, 0, 1, 0, 0]];
    const outer = [[0, 0, 0], [0.025, 0.009, 0], [0.12, 0.018, 0], [0.5, 0.026, 0], [1.4, 0.03, 0], [2.4, 0.03, 0], [3.3, 0.03, 0]];
    const pt = (b, dz, g, sh, cx, cy, pull) => {
      let x = b.p[0] + b.n[0] * g, y = b.p[1] + b.n[1] * g;
      x = cen[0] + (x - cen[0]) * sh + cx; y = cen[1] + (y - cen[1]) * sh + cy;
      if (pull) x -= pull * Math.max(0, (x - cen[0]) / 0.4) * (1 - 0.3 * (y - INT.BO[1]));
      const z = lipZ(b.p[0], b.p[1]) + dz;
      return [sx * x, y, z];
    };
    const uvOut = (p) => cInt[sx > 0 ? 'R' : 'L'].uv3(p[0], p[1], p[2]);
    const rowsI = inner.map(([dz, g, sh, cx, cy]) => ringBase.map(b => pt(b, dz, g, sh, cx, cy, 0)));
    const rowsO = outer.map(([dz, g, pull]) => ringBase.map(b => pt(b, dz, g, 1, 0, 0, pull)));
    const fix = (rows) => (sx > 0 ? rows : rows.map(r => r.slice().reverse()));
    const fI = fix(rowsI);
    const mI = K.merge(grid(fI.slice(0, 3), { uv: () => U.ductDark }), grid(fI.slice(2), { uv: () => U.duct }));
    const mO = grid(fix(rowsO), { uv: (i, j, p) => uvOut(p) });
    // dark compressor-face cap deep in the S-duct
    const capRow = fix(rowsI)[0], c0 = capRow.reduce((a, p) => [a[0] + p[0] / capRow.length, a[1] + p[1] / capRow.length, a[2] + p[2] / capRow.length], [0, 0, 0]);
    const cap = new K.Mesh(), ci = cap.vert(c0[0], c0[1], c0[2], 0, 0, -1, U.black[0], U.black[1]);
    const ids = capRow.map(p => cap.vert(p[0], p[1], p[2], 0, 0, -1, U.black[0], U.black[1]));
    for (let j = 0; j < ids.length; j++) cap.tri(ci, ids[(j + 1) % ids.length], ids[j]);
    return K.merge(mI, mO, cap);
  };
  stat.add(intakeMesh(1)).add(intakeMesh(-1));
  lap('intakes');

  // ---- canopy -------------------------------------------------------------------------------------------------------------
  const canSt = CZ.map((z, i) => {
    const w = CW[i], t = tTopAtX(z, w), s = probe.at(z, t).p;
    return { z, y: s[1], w, top: Math.max(0.004, CT[i] - s[1]), bot: 0.004, kTop: [0.6, 0.62] };
  });
  canSt[0].top = 0.004;
  const cseg = Math.max(20, Math.round(36 * detail / 4) * 4), ct = 1 / cseg;
  const canLoft = (zr, tr, inflate, uv) => K.loft({ stations: canSt, segments: cseg, step: 0.1, tRange: tr, zRange: zr, inflate, uv }).mesh;
  const glass = canLoft([-7.62, -3.45], [0.25, 0.75], 0, [0, 0]);
  const canFrame = K.merge(
    canLoft([-7.5, -3.45], [0.25, 0.25 + ct], 0.006, U.frame), canLoft([-7.5, -3.45], [0.75 - ct, 0.75], 0.006, U.frame),
    canLoft([-3.62, -3.45], [0.25, 0.75], 0.008, U.frame),
  );
  { // canopy edge rails (the moving frame's sill members, visible from outside and from the seat)
    const ySill = K.pchip(CZ, canSt.map(c => c.y));
    for (const sx of [1, -1]) { const pts = []; for (let zz = -7.35; zz <= -3.5; zz += 0.35) pts.push([sx * (cwAt(zz) - 0.012), ySill(zz) + 0.012, zz]); canFrame.add(K.pipe(pts, 0.016, { uv: U.frame, segments: 8 })); }
  }

  // ---- cockpit --------------------------------------------------------------------------------------------------------------
  const eye = G.pilotEye;
  stat.add(K.tub({ x: 0.42, y0: 0.02, y1: 0.66, z0: -6.95, z1: -3.8, uv: U.interior, taper: 0.8 }));
  {
    // instrument panel (kit: big tactical displays, up-front display, standby, cautions) with its glareshield, top at ≈ 0.83
    stat.add(K.instrumentPanel({ eye, kind: 'fighter', dist: 0.52, drop: 0.48, height: 0.42, width: 0.74, mfd: 0.16, centreDisplay: 'mfdTsd', pages: ['mfdSA', 'mfdRadar'], uv: U.console, uvPad: U.black }));
    // side consoles, side-stick (right) and twin throttles (left)
    for (const sx of [-1, 1]) {
      stat.add(K.box(0.15, 0.1, 1.7, U.console).translate(sx * 0.335, 0.49, -5.35));
      stat.add(K.box(0.13, 0.012, 1.5, U.interior).translate(sx * 0.335, 0.546, -5.3));
    }
    stat.add(K.stick({ base: [0.345, 0.55, -5.92], height: 0.15, uv: U.dark, uvGrip: U.seat }));
    stat.add(K.box(0.06, 0.03, 0.14, U.dark).translate(0.345, 0.555, -5.9));
    for (const dx of [-0.018, 0.018]) {
      stat.add(K.tube([-0.345 + dx, 0.55, -5.86], [-0.345 + dx, 0.64, -5.92], 0.009, 0.009, { segments: 6, uv: U.dark }));
      stat.add(K.box(0.03, 0.05, 0.06, U.seat).translate(-0.345 + dx * 1.6, 0.655, -5.93));
    }
    // canopy sill rails along both cut edges (what the pilot's elbows rest against) and the inner sill shelf
    for (const sx of [1, -1]) {
      const pts = [];
      for (let zz = CUT.z0 + 0.04; zz <= CUT.z1 - 0.02; zz += 0.25) { const t = tSillAt(zz), p = fus.at(zz, sx > 0 ? t : 1 - t).p; pts.push([p[0] - sx * 0.012, p[1] + 0.008, zz]); }
      stat.add(K.pipe(pts, 0.022, { uv: U.sill, segments: 8 }));
      for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], c = pts[k + 1]; stat.add(K.box(0.05, 0.012, c[2] - a[2], U.interior).translate(a[0] - sx * 0.045, a[1] - 0.03, (a[2] + c[2]) / 2)); }
    }
  }
  stat.add(K.ejectionSeat({ eye, recline: 24, uv: { frame: U.seat, cushion: U.cushion, accent: U.accent } }));
  // wide-angle HUD: big combiner on two slim posts and a low housing sunk into the glareshield
  const hudParts = K.hud({ eye, dist: 0.6, width: 0.27, height: 0.2, drop: 0.05, uv: U.black });
  { const y = eye[1] - 0.05, zH = eye[2] - 0.6, w = 0.27, h = 0.2, fr = new K.Mesh();
    for (const sx of [-1, 1]) fr.add(K.box(0.01, h * 1.02, 0.012, U.black).rotateX(-0.42).translate(sx * (w / 2 + 0.005), y, zH));
    fr.add(K.box(w * 1.08, 0.045, 0.15, U.console).translate(0, y - h / 2 - 0.025, zH - 0.03));
    fr.sidecar('hud').add(hudParts.frame.sidecar('hud'));                              // keep the kit's symbology on the combiner
    hudParts.frame = fr; }
  stat.add(hudParts.frame);
  const pilotMesh = K.pilot({ eye, recline: 20, stick: [0.33, -0.42, -0.04], throttle: [-0.33, -0.42, -0.04], uv: { suit: U.suit, helmet: U.helmet, visor: U.visor, dark: U.dark, glove: U.glove } });

  // ---- wings ---------------------------------------------------------------------------------------------------------------
  const tLE = Math.tan(42 * DEG), tTE = Math.tan(17 * DEG);
  const WG = { xr: 1.2, tip: 6.78, zTipLE: 1.76, tipChord: 1.8, yRoot: -0.1, anh: 2.5 * DEG };
  const zLE = (x) => WG.zTipLE - (WG.tip - x) * tLE, zTE = (x) => WG.zTipLE + WG.tipChord + (WG.tip - x) * tTE;
  const yW = (x) => WG.yRoot - (x - WG.xr) * Math.tan(WG.anh);
  // stabilator: LE 42° (parallel to the wing LE), TE swept forward 17° (parallel to the wing TE), root LE 0.1 m behind the notch
  const ST = { xr: 1.86, zr: 4.3, cr: 3.7, xt: 4.42, y: -0.04, pivotZ: 6.0 };
  ST.ct = ST.cr - (ST.xt - ST.xr) * (tLE + tTE);
  const zNotch = (x) => ST.zr - 0.1 + (x - ST.xr) * tLE;
  WG.xk = (WG.zTipLE + WG.tipChord + WG.tip * tTE - ST.zr + 0.1 + ST.xr * tLE) / (tLE + tTE);   // notch edge meets the main TE
  const mkWing = (side) => K.wing({
    side, airfoil: K.naca6(0.05, 0.003), chordPts: Math.round(13 * detail), spanAxis: 'x', tip: 'flat',
    // inboard of WG.xk the trailing edge turns forward parallel to the stabilator leading edge (the notch the stab nests in)
    stations: [{ x: WG.xr, y: yW(WG.xr), z: zLE(WG.xr), chord: zNotch(WG.xr) - zLE(WG.xr), tc: 0.05 },
      { x: WG.xk, y: yW(WG.xk), z: zLE(WG.xk), chord: zTE(WG.xk) - zLE(WG.xk), tc: 0.048 },
      { x: WG.tip, y: yW(WG.tip), z: zLE(WG.tip), chord: WG.tipChord, tc: 0.038, twist: -2 }],
    lines: { hingeTE: [[2.66, 0.815], [4.0, 0.787], [4.05, 0.787], [6.1, 0.71], [6.78, 0.7]], hingeLE: [[1.75, 0.09], [6.6, 0.3], [6.78, 0.31]] },
    controls: [
      { name: 'flaperon', type: 'flap', span: [2.66, 4.0], from: 'hingeTE', nose: 1 },
      { name: 'aileron', type: 'flap', span: [4.05, 6.1], from: 'hingeTE', nose: 1 },
      { name: 'lef', type: 'flap', span: [1.85, 6.55], to: 'hingeLE', tail: 1 },
    ],
    charts: { upper: side > 0 ? cWT.R : cWT.L, lower: side > 0 ? cWB.R : cWB.L },
  });
  const W = { R: mkWing(1), L: mkWing(-1) };
  stat.add(W.R.mesh).add(W.L.mesh);
  lap('wings');

  // ---- stabilators ---------------------------------------------------------------------------------------------------------
  const mkStab = (side) => K.wing({
    side, airfoil: K.biconvex(0.045), chordPts: Math.round(9 * detail), spanAxis: 'x', tip: 'flat', root: 'flat',
    stations: [{ x: ST.xr, y: ST.y, z: ST.zr, chord: ST.cr, tc: 0.045 }, { x: ST.xt, y: ST.y, z: ST.zr + (ST.xt - ST.xr) * tLE, chord: ST.ct, tc: 0.035 }],
    charts: { upper: side > 0 ? cST.R : cST.L, lower: cSB },
  });
  const stab = { R: mkStab(1), L: mkStab(-1) };

  // ---- fins: canted 27° outboard ---------------------------------------------------------------------------------------------
  const FN = { z: 2.5, c: 4.6, span: 3.3, ct: 1.7, le: Math.tan(28 * DEG), u0: -0.35 };
  const mkFin = (s) => {
    const d = fv(1), st = (u, tc) => ({ x: FIN.x + d[0] * u, y: FIN.y + d[1] * u, z: FN.z + FN.le * u, chord: FN.c - (FN.c - FN.ct) * u / FN.span, tc });
    return K.wing({
      side: s, airfoil: K.biconvex(0.05), chordPts: Math.round(10 * detail), spanAxis: 'u', tip: 'flat',
      stations: [st(FN.u0, 0.05), st(FN.span, 0.032)],
      lines: { hinge: [[0.6, 0.72], [3.0, 0.7]] },
      controls: [{ name: 'rudder', type: 'flap', span: [0.6, 3.0], from: 'hinge', nose: 1 }],
      charts: s > 0 ? { upper: cFin.RI, lower: cFin.RO } : { upper: cFin.LI, lower: cFin.LO },
    });
  };
  const fin = { R: mkFin(1), L: mkFin(-1) };
  stat.add(fin.R.mesh).add(fin.L.mesh);

  // ---- aft body: engine nacelle bulges, stabilator booms, centre tail ---------------------------------------------------------
  const NAC = { x: 1.15, y: 0.1 };
  for (const sx of [1, -1]) {
    stat.add(K.loft({
      stations: [
        { z: 2.9, x: sx * NAC.x, y: NAC.y - 0.02, w: 0.5, top: 0.3, bot: 0.45, kTop: 0.8, kBot: 0.8 },
        { z: 4.2, x: sx * NAC.x, y: NAC.y, w: 0.585, top: 0.37, bot: 0.47, kTop: 0.82, kBot: 0.82 },
        { z: 5.6, x: sx * NAC.x, y: NAC.y, w: 0.6, top: 0.39, bot: 0.45, kTop: [0.9, 0.85], kBot: 0.85, aTop: 60 },
        { z: 6.5, x: sx * NAC.x, y: NAC.y, w: 0.6, top: 0.425, bot: 0.425, kTop: 0.9, kBot: 0.9 },
        { z: 7.04, x: sx * NAC.x, y: NAC.y, w: 0.595, top: 0.415, bot: 0.415, kTop: 0.92, kBot: 0.92 },
      ], segments: Math.max(24, Math.round(40 * detail / 4) * 4), step: 0.25, chart: cNac, capEnd: 'none',
    }).mesh);
    // stabilator boom (pivot housing) outboard of the nacelle
    stat.add(K.loft({
      stations: [
        { z: 3.75, x: sx * 1.68, y: -0.06, w: 0.03, top: 0.02, bot: 0.03, kTop: 0.6, kBot: 0.6 },
        { z: 4.3, x: sx * 1.71, y: -0.04, w: 0.15, top: 0.06, bot: 0.09, kTop: 0.62, kBot: 0.62, aTop: 30, aBot: 30 },
        { z: 5.4, x: sx * 1.74, y: -0.03, w: 0.16, top: 0.1, bot: 0.1, kTop: 0.62, kBot: 0.62, aTop: 30, aBot: 30 },
        { z: 7.0, x: sx * 1.76, y: -0.03, w: 0.16, top: 0.1, bot: 0.1, kTop: 0.62, kBot: 0.62, aTop: 30, aBot: 30 },
        { z: 7.85, x: sx * 1.76, y: -0.03, w: 0.1, top: 0.06, bot: 0.06, kTop: 0.62, kBot: 0.62, aTop: 30, aBot: 30 },
        { z: 8.08, x: sx * 1.76, y: -0.03, w: 0.015, top: 0.015, bot: 0.015 },
      ], segments: 16, step: 0.3, uv: U.base,
    }).mesh);
  }
  // centre "stinger" fairing between the nozzles (houses the hook)
  stat.add(K.loft({
    stations: [{ z: 6.7, y: 0.0, w: 0.56, top: 0.17, bot: 0.22, kTop: 0.92, kBot: 0.9, aTop: 40, aBot: 50 }, { z: 7.35, y: 0.0, w: 0.555, top: 0.11, bot: 0.2, kTop: 0.92, kBot: 0.9, aTop: 40, aBot: 50 }, { z: 7.7, y: -0.03, w: 0.42, top: 0.05, bot: 0.14, kTop: 0.92, kBot: 0.9, aTop: 40, aBot: 50 }, { z: 7.82, y: -0.05, w: 0.22, top: 0.02, bot: 0.08, kTop: 0.92, kBot: 0.9 }],
    segments: 20, step: 0.2, uv: U.under, capEnd: 'flat', capUV: U.dark,
  }).mesh);

  // ---- 2D vectoring nozzles -------------------------------------------------------------------------------------------------
  const NZ = { z0: 7.03, len: 0.95, hw: 0.555, hh: 0.4, rest: 7 * DEG };
  const flapMesh = (sy) => {
    // plan outline with the sawtooth trailing edge (two notches), wedge-thick at the hinge
    const o = [[0, -NZ.hw], [0, NZ.hw], [NZ.len, NZ.hw], [NZ.len - 0.17, NZ.hw * 0.5], [NZ.len, 0], [NZ.len - 0.17, -NZ.hw * 0.5], [NZ.len, -NZ.hw]];
    const m = planPlate(o, 0.055, U.flap);
    for (let i = 0; i < m.p.length; i += 3) { const f = 1 - 0.65 * Math.min(1, m.p[i + 2] / NZ.len); m.p[i + 1] = m.p[i + 1] * f - sy * 0.035 * (1 - f); }
    for (let i = 0; i < m.uv.length; i += 2) { const iy = m.p[(i / 2) * 3 + 1]; if (iy * sy < -0.015) { m.uv[i] = U.flapIn[0]; m.uv[i + 1] = U.flapIn[1]; } }
    return m.rotateX(sy * NZ.rest);   // trailing edge toward the axis (convergent)
  };
  const nozzles = [];
  // side walls: flush with the nacelle sides, top edge flaring slightly aft, raked (planform-aligned) trailing edge;
  // outer face coated, inner face heat-tinted
  const SW = [[0, -NZ.hh], [0, NZ.hh], [0.6, NZ.hh * 1.04], [0.98, NZ.hh * 1.08], [0.7, -NZ.hh]];
  for (const [i, sx] of [[0, -1], [1, 1]]) {
    const cx = sx * NAC.x, cy = NAC.y;
    const fixed = new K.Mesh();
    for (const sg of [-1, 1]) {
      const x0 = sg * NZ.hw, t = sg * 0.032;
      fixed.add(K.prism(SW, Math.min(x0, x0 + t * 0.4), Math.max(x0, x0 + t * 0.4), U.heat));     // inner skin
      fixed.add(K.prism(SW, Math.min(x0 + t * 0.4, x0 + t), Math.max(x0 + t * 0.4, x0 + t), U.side)); // outer skin
    }
    // duct: heat-tinted convergent section → sooty liner → flame holder + turbine cone deep inside
    const ring = (k, z) => roundedRing([[-NZ.hw + 0.02, -NZ.hh + 0.04 + k], [NZ.hw - 0.02, -NZ.hh + 0.04 + k], [NZ.hw - 0.02, NZ.hh - 0.04 - k], [-NZ.hw + 0.02, NZ.hh - 0.04 - k]], 0.1, 28).map(b => [b.p[0], b.p[1], z]);
    const zs = [0.05, -0.25, -0.55, -0.9], dk = [0, 0.02, 0.05, 0.08];
    const rr = zs.map((z, k) => ring(dk[k], z));
    for (const [k, uvk] of [[0, U.flapIn], [1, U.exhaust], [2, U.ductDark]]) fixed.add(grid([rr[k + 1], rr[k]], { flip: true, uv: () => uvk }));
    fixed.add(K.box(2 * NZ.hw - 0.04, 2 * NZ.hh - 0.2, 0.02, U.black).translate(0, 0, -0.9));
    for (const yy of [-0.12, 0, 0.12]) fixed.add(K.box(2 * NZ.hw - 0.12, 0.022, 0.03, U.steel).translate(0, yy, -0.7));       // spray bars
    fixed.add(K.box(0.03, 2 * NZ.hh - 0.22, 0.03, U.steel).translate(0, 0, -0.71));
    fixed.add(K.lathe([[0.0, -0.9], [0.13, -0.88], [0.1, -0.78], [0.0, -0.72]], { segments: 14, uv: U.exhaust }));            // tail cone
    fixed.translate(cx, cy, NZ.z0);
    stat.add(fixed);
    const up = flapMesh(1).translate(cx, cy + NZ.hh - 0.035, NZ.z0), lo = flapMesh(-1).translate(cx, cy - NZ.hh + 0.035, NZ.z0);
    const ha = (sy) => [cx - NZ.hw, cy + sy * (NZ.hh - 0.035), NZ.z0], hb = (sy) => [cx + NZ.hw, cy + sy * (NZ.hh - 0.035), NZ.z0];
    nozzles.push({ i, up, lo, ha, hb, cx, cy });
  }
  // afterburner glow tunnels (uv.x 1 = flame holder … 0 = exit)
  const glowMesh = (cx) => {
    const zs = [6.25, 6.32, 6.7, 7.2, 7.75], hs = [0.0, 0.3, 0.32, 0.27, 0.2], us = [1, 0.95, 0.75, 0.35, 0.05];
    const rows = zs.map((z, k) => roundedRing([[-0.5, -Math.max(0.01, hs[k])], [0.5, -Math.max(0.01, hs[k])], [0.5, Math.max(0.01, hs[k])], [-0.5, Math.max(0.01, hs[k])]], 0.006 + hs[k] * 0.25, 20).map(b => [cx + b.p[0] * (k ? 1 : 0.02), NAC.y + b.p[1], z]));
    return grid(rows, { uv: (i) => [us[i], 0.5] });
  };

  // ---- weapons-bay / gear-bay wells ---------------------------------------------------------------------------------------------
  const P = fus.patches;
  stat.add(K.well(P.ngR, 0.42, U.well, [0, 1, 0])).add(K.well(P.ngL, 0.42, U.well, [0, 1, 0]));
  stat.add(K.well(P.mlgR, 0.34, U.well, [0, 1, 0])).add(K.well(P.mlgL, 0.34, U.well, [0, 1, 0]));

  // ---- small details -----------------------------------------------------------------------------------------------------------
  for (const sx of [1, -1]) {   // flush air-data probes on the nose chines, AoA vanes
    const p = probe.at(-9.6, sx > 0 ? 0.25 : 0.75).p;
    stat.add(K.probe([p[0] - sx * 0.02, p[1], p[2]], [p[0] + sx * 0.03, p[1], p[2] - 0.1], 0.01, U.steel));
  }
  stat.add(K.bladeAntenna({ pos: [0, fus.botAt(-2.5) + 0.02, -2.5], height: 0.16, chord: 0.24, sweep: 0.12, down: true, uv: U.under, thickness: 0.012 }));

  // ---- modelled doors: thin skins conforming to the body, standing proud by a few millimetres so every seam is a
  //      real step in the surface (catches light / shadow) and carrying the fuselage paint (same unwrap UVs) ------------
  const tFus = (z, x, top) => { let lo = top ? 0.25 : 0, hi = top ? 0.5 : 0.25; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2, px = fus.at(z, m).p[0]; if (top ? px > x : px < x) lo = m; else hi = m; } return (lo + hi) / 2; };
  const sawPts = (a, b, n, d, dir) => { const out = []; for (let k = 0; k <= 2 * n; k++) { const f = k / (2 * n), off = k % 2 ? d : 0; out.push([a[0] + (b[0] - a[0]) * f + dir[0] * off, a[1] + (b[1] - a[1]) * f + dir[1] * off]); } return out; };
  const densify = (pts, step) => { const out = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } return out; };
  /** plan outline [[x, z]] on the upper (top) or lower body → conforming plate standing `lift` proud, `th` thick */
  const skinDoor = (outlineXZ, top, lift = 0.002, th = 0.006) => {
    const m = planPlate(densify(outlineXZ, 0.12).map(([x, z]) => [z, x]), th, [0, 0]);
    for (let i = 0, v = 0; i < m.p.length; i += 3, v += 2) {
      const x = m.p[i], z = m.p[i + 2], t = tFus(z, Math.abs(x), top), tt = x >= 0 ? t : 1 - t, sp = fus.at(z, tt).p;
      m.p[i + 1] = sp[1] + (top ? 1 : -1) * (lift + th / 2) + m.p[i + 1];
      const uv = cFus.uvUnwrap(z, tt); m.uv[v] = uv[0]; m.uv[v + 1] = uv[1];
    }
    return m;
  };
  const doors = new K.Mesh();
  for (const s of [1, -1]) {
    // main weapons bay: two long doors each side, sawtooth fore and aft edges (planform-aligned)
    for (const [x0, x1] of [[0.025, 0.4], [0.415, 0.8]]) {
      const front = sawPts([s * x0, -3.35], [s * x1, -3.35], 1, 0.24, [0, 1]), back = sawPts([s * x1, 0.35], [s * x0, 0.35], 1, 0.24, [0, -1]);
      doors.add(skinDoor(front.concat(back), false));
    }
    // air-refuelling receptacle doors (split on the centreline) on the spine
    doors.add(skinDoor([[s * 0.012, -1.9], [s * 0.16, -1.9], [s * 0.16, -1.25], [s * 0.012, -1.25]], true, 0.0015, 0.005));
  }
  // side weapons bays: doors on the intake outer walls (wall plane x = x(y)), sawtooth fore / aft edges
  const wallX = (y) => INT.BO[0] + 0.028 + (y - INT.BO[1] + 0.009) * (INT.TO[0] - INT.BO[0]) / (INT.TO[1] - INT.BO[1]);
  for (const s of [1, -1]) {
    const o = sawPts([-3.2, -0.7], [-3.06, -0.36], 2, 0.13, [1, 0]).concat(sawPts([-1.42, -0.36], [-1.56, -0.7], 2, 0.13, [-1, 0]));
    const m = K.prism(densify(o, 0.15), 0.002, 0.008, [0, 0]);
    for (let i = 0, v = 0; i < m.p.length; i += 3, v += 2) {
      const y = m.p[i + 1], x = (wallX(y) + m.p[i]) * s; m.p[i] = x;
      const uv = cInt[s > 0 ? 'R' : 'L'].uv3(x, y, m.p[i + 2]); m.uv[v] = uv[0]; m.uv[v + 1] = uv[1];
      if (s < 0) m.n[i] = -m.n[i];
    }
    if (s < 0) m.flipWinding();
    doors.add(m);
  }
  stat.add(doors);

  // ---- arresting hook housing: shallow fairing strips either side of the stowed hook under the tail stinger ------------
  { const bot = (z) => Math.min(fus.botAt(Math.min(z, 7.0)), z > 6.7 ? -0.2 - (z - 7.35) * 0.08 : 0);
    const zs = [6.05, 6.5, 6.9, 7.2, 7.42], ol = zs.map(z => [z, bot(z) + 0.03]).concat(zs.slice().reverse().map((z, k) => [z, bot(z) - (k === 0 ? 0.02 : 0.045)]));
    for (const sx of [1, -1]) stat.add(K.prism(ol, sx > 0 ? 0.05 : -0.08, sx > 0 ? 0.08 : -0.05, U.under)); }


  // ---- paint ----------------------------------------------------------------------------------------------------------------------
  lap('details');
  paint(atlas, { SC, fus, W, fin, cFus, cWT, cWB, cST, cSB, cFin, cInt, cNac, coat, INT, lipZ, NG, MG, cwAt, ST, FN, WG });
  lap('paint');
  const mat = loCoating(atlas.material(ctx, { envMapIntensity: 1, emissiveIntensity: 0.9 }), SC);
  lap('textures');
  rig.material('paint', mat, { shared: true });
  rig.disposables.push(atlas);
  rig.glass('canopy', K.glassMaterial(ctx, { tint: '#6a5226', opacity: 0.24, edgeOpacity: 0.9, metalness: 0.72, roughness: 0.03, reflect: 1.15 }));
  rig.glass('hud', K.glassMaterial(ctx, K.GLASS.hud));
  const glowM = [rig.material('glow0', K.glowMaterial(), { shadow: false }), rig.material('glow1', K.glowMaterial(), { shadow: false })];

  rig.addStatic(stat, 'paint');
  rig.addStatic(hudParts.glass, 'hud');

  // ---- moving parts -----------------------------------------------------------------------------------------------------------
  const canPivot = [0, 0.9, -3.4];
  const canopyNode = rig.node('canopy', { pivot: canPivot });
  rig.part('canopyGlass', glass, { parent: canopyNode, key: 'canopy' });
  rig.part('canopyFrame', canFrame, { parent: canopyNode });
  const setCanopy = rig.hinge(canopyNode, [-1, canPivot[1], canPivot[2]], [1, canPivot[1], canPivot[2]], { ref: [0, 1.0, -7.0], toward: [0, 1, 0] });
  const pilotNode = rig.part('pilot', pilotMesh, { pivot: eye });

  const ctl = {};
  for (const k of ['R', 'L']) {
    ctl['fl' + k] = rig.hingePart('flaperon' + k, W[k].controls.flaperon);
    ctl['ai' + k] = rig.hingePart('aileron' + k, W[k].controls.aileron);
    ctl['lef' + k] = rig.hingePart('lef' + k, W[k].controls.lef);
    ctl['rud' + k] = rig.hingePart('rudder' + k, fin[k].controls.rudder, { toward: [1, 0, 0] });
  }
  const mkStabPart = (name, s, sx) => {
    const a = [sx * ST.xr, ST.y, ST.pivotZ], b = [sx * ST.xt, ST.y, ST.pivotZ];
    const node = rig.part(name, s.mesh, { pivot: a });
    return rig.hinge(node, a, b, { ref: [sx * 2.5, ST.y, 7.6], toward: [0, 1, 0] });
  };
  const setStabR = mkStabPart('stabR', stab.R, 1), setStabL = mkStabPart('stabL', stab.L, -1);
  for (const n of nozzles) {
    const { i, up, lo, ha, hb, cx, cy } = n;
    const nU = rig.part('nozU' + i, up, { pivot: ha(1) }), nL = rig.part('nozL' + i, lo, { pivot: ha(-1) });
    n.u = rig.hinge(nU, ha(1), hb(1), { ref: [cx, cy + NZ.hh, NZ.z0 + NZ.len], toward: [0, 1, 0] });
    n.l = rig.hinge(nL, ha(-1), hb(-1), { ref: [cx, cy - NZ.hh, NZ.z0 + NZ.len], toward: [0, 1, 0] });
  }
  rig.part('abGlow0', glowMesh(-NAC.x), { key: 'glow0' });
  rig.part('abGlow1', glowMesh(NAC.x), { key: 'glow1' });
  const hookP = [0, -0.27, 5.7];
  const hookNode = rig.part('hook', K.arrestorHook({ pivot: hookP, length: 1.75, radius: 0.03, uv: U.steel }), { pivot: hookP });
  const setHook = rig.hinge(hookNode, [-1, hookP[1], hookP[2]], [1, hookP[1], hookP[2]], { ref: [0, hookP[1], 7.4], toward: [0, -1, 0] });

  // ---- landing gear ---------------------------------------------------------------------------------------------------------------
  const gp = G.gear;
  const doorOf = (patch, edge, inner = U.well) => ({ mesh: K.thicken(patch, 0.02, inner), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  K.buildGear(rig, atlas, {
    name: 'nose', index: 0, contact: gp[0].pos, wheelRadius: gp[0].wheelRadius, wheelWidth: 0.17, pivot: [0, -0.2, -5.72], stroke: 0.22, staticFrac: 0.35,
    strutR: 0.065, fork: 'fork', steer: true, links: 'front', retract: { to: [0, -0.32, -6.85] }, window: [0.22, 0.88],
    brace: [0, -0.25, -5.2],
    doors: [
      { name: 'noseDoorR', ...doorOf(P.ngR, fus.edges.ngR.tHi), open: 88, toward: [0, -1, 0] },
      { name: 'noseDoorL', ...doorOf(P.ngL, fus.edges.ngL.tLo), open: 88, toward: [0, -1, 0] },
    ],
    lamps: [{ kind: 'landing', pos: [-0.08, -1.12, -5.66], size: 0.075, color: [1, 0.96, 0.88] }, { kind: 'taxi', pos: [0.08, -1.12, -5.66], size: 0.065, color: [1, 0.96, 0.88] }],
  });
  // strut-mounted door on each main leg (coated outside, white inside), sawtooth lower edge; rides on the strut
  const legDoor = (sx) => {
    const P0 = [sx * 1.56, -0.5, 0.88], C0 = [sx * 1.95, gp[1].pos[1] + gp[1].wheelRadius, 0.6], f = (k) => P0.map((v, j) => v + (C0[j] - v) * k);
    const a = f(0.05), b = f(0.66), o = sx * 0.11, m = new K.Mesh();
    const q = [[a[0] + o, a[1], a[2] - 0.26], [a[0] + o, a[1], a[2] + 0.2], [b[0] + o, b[1], b[2] + 0.16], [b[0] + o, b[1] + 0.05, b[2] - 0.04], [b[0] + o, b[1], b[2] - 0.24]];
    for (const [d, uv] of [[0, U.base], [-sx * 0.012, U.well]]) {
      const i0 = m.vertexCount, nx = d === 0 ? sx : -sx;
      for (const p of q) m.vert(p[0] + d, p[1], p[2], nx, 0, 0, uv[0], uv[1]);
      if ((nx > 0) === true) { m.tri(i0, i0 + 1, i0 + 2); m.tri(i0, i0 + 2, i0 + 3); m.tri(i0, i0 + 3, i0 + 4); }
      else { m.tri(i0, i0 + 2, i0 + 1); m.tri(i0, i0 + 3, i0 + 2); m.tri(i0, i0 + 4, i0 + 3); }
    }
    return m;
  };
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, off = 0.2, edge = fus.edges['mlg' + key];
    K.buildGear(rig, atlas, {
      name: 'main' + key, index: i, contact: [c[0] - sx * off, c[1], c[2]], wheels: [sx * off], wheelRadius: gp[i].wheelRadius, wheelWidth: 0.27,
      pivot: [sx * 1.56, -0.5, 0.88], stroke: 0.3, staticFrac: 0.35, strutR: 0.085, fork: 'half', links: 'rear',
      retract: { to: [sx * 1.2, -0.6, -0.2], twist: sx * 90 }, window: [0.22, 0.9], brace: [sx * 1.0, -0.55, 0.7], extra: legDoor(sx),
      doors: [{ name: 'mainDoor' + key, ...doorOf(P['mlg' + key], sx > 0 ? edge.tHi : edge.tLo), open: 95, toward: [0, -1, 0] }],
    });
  }

  // ---- lamps ------------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.075, squash: [0.6, 0.6, 1.6] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.075, squash: [0.6, 0.6, 1.6] });
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.065 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.07 });
  rig.lamp('beacon', L.beacon, { color: [1, 0.08, 0.04], size: 0.075, squash: [1, 0.6, 1] });
  // formation "slime" strip lights: forebody chines, fin outer faces, tail booms
  const strip = (p, d, len, n) => { const m = K.box(0.012, 0.04, len, [0, 0]); if (d) m.rotateZ(d); return m.translate(p[0] + n[0] * 0.006, p[1] + n[1] * 0.006, p[2]); };
  for (const sx of [1, -1]) {
    const z = -6.6, hw = probe.halfWidthAt(z), cp = probe.at(z, sx > 0 ? tAtX(z, hw - 0.002) : 1 - tAtX(z, hw - 0.002)).p;
    rig.lamp('formation', null, { mesh: strip([cp[0] - sx * 0.01, cp[1] + 0.035, z], 0, 0.55, [sx, 0, 0]), color: [0.16, 0.45, 0.14] });
    const fp = fin[sx > 0 ? 'R' : 'L'].at(2.55, 0.42, 'lower'), cn = [sx * Math.cos(FIN.cant), Math.sin(FIN.cant)];
    rig.lamp('formation', null, { mesh: strip(fp, -sx * FIN.cant, 0.55, cn), color: [0.16, 0.45, 0.14] });
    rig.lamp('formation', null, { mesh: strip([sx * 1.905, -0.03, 6.3], 0, 0.5, [sx, 0, 0]), color: [0.16, 0.45, 0.14] });
  }

  // ---- night halos: the lamp lenses are a few pixels wide at chase distance, so each external light also gets a soft
  //      additive glow sprite (one Points draw call), driven by the same switches / flash timing as the rig lamps --------
  const HALO = [
    { p: [L.navLeft[0] - 0.09, L.navLeft[1], L.navLeft[2]], c: [1, 0.05, 0.03], k: 'nav', s: 1.6 }, { p: [L.navRight[0] + 0.09, L.navRight[1], L.navRight[2]], c: [0.05, 1, 0.3], k: 'nav', s: 1.6 },
    { p: [L.tail[0], L.tail[1], L.tail[2] + 0.08], c: [1, 1, 1], k: 'nav', s: 1.2 },
    { p: [L.strobe[0], L.strobe[1] + 0.06, L.strobe[2]], c: [1, 1, 1], k: 'strobe', s: 2.6 }, { p: [L.beacon[0], L.beacon[1] - 0.07, L.beacon[2]], c: [1, 0.1, 0.05], k: 'beacon', s: 2.0 },
    { p: [-0.08, -1.12, -5.74], c: [1, 0.95, 0.85], k: 'landing', s: 2.2 }, { p: [0.08, -1.12, -5.74], c: [1, 0.95, 0.85], k: 'taxi', s: 1.6 },
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
  const haloCol = haloGeo.attributes.color;

  // ---- animation ----------------------------------------------------------------------------------------------------------------
  rig.onUpdate((S) => {
    const sf = S.sf, sb = sf.speedbrake;
    // F-22 speedbrake: flaperons up, ailerons down, rudders splayed outboard
    ctl.flR.set((sf.aileronR * 25 - sf.flaps * 30 + sb * 35) * DEG); ctl.flL.set((sf.aileronL * 25 - sf.flaps * 30 + sb * 35) * DEG);
    ctl.aiR.set((sf.aileronR * 25 - sb * 25 - sf.flaps * 8) * DEG); ctl.aiL.set((sf.aileronL * 25 - sb * 25 - sf.flaps * 8) * DEG);
    const lef = Math.max(sf.slats, sf.flaps * 0.8); ctl.lefR.set(-lef * 25 * DEG); ctl.lefL.set(-lef * 25 * DEG);
    ctl.rudR.set((sf.rudder * 30 + sb * 25) * DEG); ctl.rudL.set((sf.rudder * 30 - sb * 25) * DEG);
    setStabR(sf.elevatorR * 25 * DEG); setStabL(sf.elevatorL * 25 * DEG);
    for (const n of nozzles) {
      // visual flap travel: outward travel (away from the jet axis) is limited to 11° so the sawtooth tips never rise out
      // of the side walls at any vectoring + area combination; inward travel 15°
      const e = S.eng[n.i] || {}, pitch = sf.nozzlePitch * 13, area = (e.nozzle ?? 0) * 5, cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v)) * DEG;
      n.u(cl(pitch + area, -15, 11)); n.l(cl(pitch - area, -11, 15));
      K.abGlowColor(glowM[n.i].color, e, S.night);
    }
    setCanopy(sf.canopy * 38 * DEG);
    setHook(sf.hook * 42 * DEG);
    pilotNode.visible = !rig.cameraInCockpit;
    // halos (night only; landing / taxi only with the gear down and locked)
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
  visual.object3D.add(halo);
  rig.disposables.push(haloGeo, haloMat);
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ---- paint ------------------------------------------------------------------------------------------------------------------------
function paint(atlas, o) {
  const { SC, fus, W, fin, cFus, cWT, cWB, cST, cSB, cFin, cInt, cNac, coat, cwAt, ST, FN } = o, F = K.FINISH;
  const base = coat(SC.base), camo = coat(SC.camo), under = coat(SC.under, 0.2);
  const ram = { color: '#93958f', rough: 0.55, metal: 0.12 };          // RAM tape / edge treatment (slightly lighter, warmer)
  const edgeF = { color: '#8c8f92', rough: 0.52, metal: 0.1 };          // leading-edge RAM treatment: lighter, less metallic
  const fresh = (c) => ({ color: c, rough: 0.46, metal: (SC.sheen ?? 0.16) * 1.2 });   // fresh coating touch-up: a shade darker, smoother
  const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * f)))); return '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''); };
  // weathering for one plan-type pen: panel-to-panel tone variation, touch-up patches, boot scuffs (all very subtle)
  const weather = (Q, x0, x1, z0, z1, n, boots) => {
    for (let i = 0; i < n; i++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0), w = 0.25 + rnd() * 0.6, h = 0.3 + rnd() * 0.8, f = 0.96 + rnd() * 0.08;
      Q.fill([[x, z], [x + w, z], [x + w, z + h], [x, z + h]], coat(shade(SC.base, f)), { alpha: SC.agg ? 0.08 : 0.35, feather: 2 });
    }
    if (!SC.agg) for (let i = 0; i < Math.ceil(n / 3); i++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0), r = 0.06 + rnd() * 0.14, pts = [];
      for (let k = 0; k < 9; k++) { const a = k / 9 * 6.283, q = r * (0.7 + rnd() * 0.5); pts.push([x + Math.cos(a) * q * 1.4, z + Math.sin(a) * q]); }
      Q.fill(pts, fresh(shade(SC.base, 0.93)), { alpha: 0.8, feather: 1 });
    }
    if (boots) for (const [bx, bz, bw, bh] of boots) for (let i = 0; i < 14; i++) {
      const x = bx + (rnd() - 0.5) * bw, z = bz + (rnd() - 0.5) * bh, r = 0.04 + rnd() * 0.05;
      Q.fill([[x - r, z - r * 1.8], [x + r, z - r * 1.8], [x + r * 0.8, z + r * 1.8], [x - r * 0.8, z + r * 1.8]], { color: '#45474a', rough: 0.75, metal: 0 }, { alpha: 0.12 + rnd() * 0.1, feather: 3 });
    }
  };
  const mark = SC.mark, lowVis = mark;
  const rnd = (() => { let a = SC.seed || 777; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const gapL = { px: 2, depth: 0.8, dark: 0.45 }, panelL = { px: 1, depth: 0.32, dark: 0.1 };

  // ---- fuselage ring lookup: ring parameter t on the right side for a given x (bottom or top quadrant) --------------------
  const K4 = fus.K;
  const tx = (z, x, top) => {
    const r = fus.ring(Math.round(z * 20) / 20); let jm = 0, mx = -1;      // quantised station: ring cache hits
    for (let j = 0; j <= K4 / 2; j++) if (r[j * 3] > mx) { mx = r[j * 3]; jm = j; }
    if (x >= mx) return jm / K4;
    if (!top) { for (let j = 0; j < jm; j++) { const a = r[j * 3], b = r[j * 3 + 3]; if (x >= a && x <= b) return (j + (x - a) / Math.max(1e-9, b - a)) / K4; } return 0; }
    for (let j = jm; j < K4 / 2; j++) { const a = r[j * 3], b = r[j * 3 + 3]; if (x <= a && x >= b) return (j + (a - x) / Math.max(1e-9, a - b)) / K4; }
    return 0.5;
  };
  // plan point (x, z) → unwrap (z, t) on the upper / lower surface (x < 0 maps to the left side)
  const upT = (x, z) => { const t = tx(z, Math.abs(x), true); return [z, x >= 0 ? t : 1 - t]; };
  const dnT = (x, z) => { const t = tx(z, Math.abs(x), false); return [z, x >= 0 ? t : 1 - t]; };
  const dens = (pts, n = 4) => { const out = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } return out; };
  const densOpen = (pts, n = 4) => { const out = []; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } out.push(pts[pts.length - 1]); return out; };
  // sawtooth between plan points a → b with n teeth of depth d along `dir` ([dx, dz] unit)
  const saw = (a, b, n, d, dir) => { const out = []; for (let k = 0; k <= 2 * n; k++) { const f = k / (2 * n), off = k % 2 ? d : 0; out.push([a[0] + (b[0] - a[0]) * f + dir[0] * off, a[1] + (b[1] - a[1]) * f + dir[1] * off]); } return out; };

  // ================= fuselage =================
  const P = atlas.pen(cFus);
  const pat = SC.agg ? aggPattern({ ...SC.agg, z: [-11, 8.2] }) : null, num = SC.agg ? aggNumber(SC.num) : null;
  const FIN = { x: 1.22, y: 0.45, cant: 27 * DEG };      // as in createVisual (canted fin plane of the fin charts)
  P.fill('all', base);
  if (pat) aggCamo(P, pat, { c: [0, 1], z: [-10.95, 7.45], pos: (t, z) => fus.at(z, t).p, pt: (t, z) => [z, t], iter: 3, finish: coat, feather: 0.6 });
  P.band(-10.95, 7.45, -Infinity, (z) => (z < -5 ? 0.0 : -0.25), under, { feather: pat ? 3 : 6 });
  P.fill((g) => g.rect(-10.95, 0, 2.62, 1), coat('#868b90', 0.6));                          // radome (dielectric, slightly different tone)
  // disruptive two-tone pattern defined in plan view and projected on every upper surface
  const blobs = [];
  for (const [cx, cz, rx, rz, rot] of [[0.3, -8.6, 0.9, 1.3, 0.3], [-1.2, -4.4, 1.1, 1.6, -0.5], [1.4, -2.2, 1.0, 1.4, 0.6], [-0.4, -0.2, 1.1, 1.5, 0.2], [3.2, 0.6, 1.5, 1.2, -0.7],
    [-3.4, 1.0, 1.6, 1.1, 0.8], [5.3, 2.4, 0.9, 0.8, 0.4], [-5.5, 2.6, 0.8, 0.8, -0.2], [0.9, 3.4, 0.8, 1.6, -0.2], [-1.3, 5.6, 0.7, 1.2, 0.4], [2.9, 6.4, 0.9, 0.7, 0.9], [-3.3, 6.7, 0.9, 0.6, -0.6], [2.6, -5.3, 0.6, 1.0, 0.5]]) {
    // soft, irregular "cloud" patches: several harmonics so no patch reads as an ellipse
    const pts = []; const n = 40, ph = [0, 1, 2, 3, 4].map(() => rnd() * 6.3);
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2, r = 0.82 + 0.24 * Math.sin(2 * a + ph[0]) + 0.16 * Math.sin(3 * a + ph[1]) + 0.1 * Math.sin(5 * a + ph[2]) + 0.06 * Math.sin(7 * a + ph[3]) + 0.035 * Math.sin(11 * a + ph[4]);
      const px = Math.cos(a) * rx * 1.25 * r, pz = Math.sin(a) * rz * 1.2 * r; pts.push([cx + px * Math.cos(rot) - pz * Math.sin(rot), cz + px * Math.sin(rot) + pz * Math.cos(rot)]);
    }
    blobs.push(pts);
  }
  const zMinF = -10.9, zMaxF = 7.4;
  if (!pat) for (const b of blobs) {
    const pts = dens(b, 5).filter(p => p[1] > zMinF && p[1] < zMaxF).map(p => { const hw = fus.halfWidthAt(Math.round(p[1] * 20) / 20) * 0.995; return upT(Math.max(-hw, Math.min(hw, p[0])), p[1]); });
    if (pts.length > 3) P.fill(pts, camo, { feather: 14 });
  }
  // radome joint, frames (few: LO aircraft), longitudinal seams
  P.ring(-8.33, 0, 1, { px: 1.5, depth: 0.45, dark: 0.22 });
  for (const z of [-6.95, -3.8, -1.2, 0.4, 2.2, 4.0, 5.6]) for (const [a, b] of [[0.32, 0.43], [0.57, 0.68]]) P.line([[z, a], [z, b]], panelL);
  // canopy sill / floor under the glass
  { const zs = []; for (let z = -7.62; z <= -3.45; z += 0.1) zs.push(z); zs.push(-3.45);
    const pts = zs.map(z => [z, tx(z, cwAt(z) + 0.01, true)]).concat(zs.slice().reverse().map(z => [z, 1 - tx(z, cwAt(z) + 0.01, true)]));
    P.fill(pts, { color: '#2a2d30', rough: 0.6, metal: 0.1 }); }
  // air-refuelling receptacle door on the spine
  P.fill([upT(-0.16, -1.9), upT(0.16, -1.9), upT(0.16, -1.25), upT(-0.16, -1.25)], coat(SC.camo, 0.8));
  P.line(dens([upT(-0.16, -1.9), upT(0.16, -1.9), upT(0.16, -1.25), upT(-0.16, -1.25)], 1).concat([upT(-0.16, -1.9)]), gapL);
  // sawtooth RAM-treated access panels on the upper body (lighter tape outlines)
  const ramPanel = (x0, x1, z0, z1, n = 2, dz = 0.12, side = 'both') => {
    for (const s of side === 'both' ? [1, -1] : [side]) {
      const front = saw([s * x0, z0], [s * x1, z0], n, dz, [0, 1]), back = saw([s * x1, z1], [s * x0, z1], n, dz, [0, -1]);
      const poly = front.concat(back).map(p => upT(p[0], p[1]));
      P.stroke(poly.concat([poly[0]]), 0, ram, { px: 2.2, alpha: 0.35 });
      P.line(poly.concat([poly[0]]), panelL);
    }
  };
  ramPanel(0.35, 0.8, -2.9, -2.1, 2); ramPanel(0.45, 1.0, 0.6, 1.6, 2); ramPanel(0.3, 0.9, 2.6, 3.6, 3); ramPanel(0.05, 0.4, 4.4, 5.3, 2);
  ramPanel(0.25, 0.6, -9.6, -9.0, 1, 0.1);
  ramPanel(1.12, 1.6, -3.75, -3.15, 3, 0.09); ramPanel(1.18, 1.62, -2.95, -2.55, 2, 0.08);    // serrated bleed / bypass doors on the shelf above the inlets
  // gun door over the right wing root (M61A2), with blast-panel
  P.fill(dens([upT(1.05, -2.6), upT(1.35, -2.6), upT(1.38, -1.7), upT(1.08, -1.7)], 2), coat('#74797f'));
  P.line(dens([upT(1.05, -2.6), upT(1.35, -2.6), upT(1.38, -1.7), upT(1.08, -1.7)], 2).concat([upT(1.05, -2.6)]), gapL);
  // belly: main weapons bay doors (sawtooth front / rear edges), nose and main gear doors
  const bellyDoor = (x0, x1, z0, z1, n, dz) => {
    for (const s of [1, -1]) {
      const pts = saw([s * x0, z0], [s * x1, z0], n, dz, [0, 1]).concat(saw([s * x1, z1], [s * x0, z1], n, dz, [0, -1]));
      const poly = densOpen(pts.concat([pts[0]]), 2).map(p => dnT(p[0], p[1]));
      P.line(poly, gapL);
      P.stroke(poly, 0, ram, { px: 3, alpha: 0.35 });
    }
  };
  bellyDoor(0.0, 0.8, -3.35, 0.35, 2, 0.24);       // main weapons bay (two doors)
  bellyDoor(0.0, 0.2, -7.15, -5.55, 1, 0.12);      // nose gear doors
  { const a = o.MG.x, z = o.MG.z; bellyDoor(a[0], a[1], z[0], z[1], 2, 0.16); }
  P.line([dnT(0, -3.35), dnT(0, 0.35)], gapL);
  // markings
  P.textOn('NO STEP', -2.4, 0.18, 'both', 0.04, { color: mark });
  for (const [z, t] of [[-0.3, 0.33], [-0.3, 0.67]]) P.decalT(z, t, { rot: t < 0.5 ? 180 : 0 }, (g) => K.drawText(g, 'NO STEP', 0.045, { color: mark }));
  P.textOn('RESCUE', -6.9, 0.3, 'both', 0.045, { color: '#7a4a2a' });
  if (num) P.textOn(num, -7.55, 0.16, 'both', 0.4, AGG_NUM);                                                                // side number on the nose
  P.decalOn(-7.3, 0.3, 'both', (g) => { g.strokeStyle = '#7a4a2a'; g.lineWidth = 0.014; g.beginPath(); g.moveTo(-0.1, 0); g.lineTo(0.07, 0); g.moveTo(0.02, -0.04); g.lineTo(0.08, 0); g.lineTo(0.02, 0.04); g.stroke(); });
  // weathering: tonal noise, belly grime, exhaust soot
  // panel tone variation, fresh-coating touch-ups and boot scuffs (spine behind the canopy, left-side boarding area)
  for (let i = 0; i < 26; i++) { const z = -9 + rnd() * 15, t = 0.3 + rnd() * 0.4, w = 0.3 + rnd() * 0.8, h = 0.02 + rnd() * 0.04; P.fill([[z, t], [z + w, t], [z + w, t + h], [z, t + h]], coat(shade(SC.base, 0.96 + rnd() * 0.08)), { alpha: pat ? 0.08 : 0.35, feather: 2 }); }
  if (!pat) for (let i = 0; i < 9; i++) { const z = -8 + rnd() * 13, t = 0.32 + rnd() * 0.36, r = 0.08 + rnd() * 0.12, pts = []; for (let k = 0; k < 9; k++) { const a = k / 9 * 6.283, q = 0.7 + rnd() * 0.5; pts.push([z + Math.cos(a) * r * q, t + Math.sin(a) * r * q * 0.035]); } P.fill(pts, fresh(shade(SC.base, 0.93)), { alpha: 0.8, feather: 1 }); }
  for (const [z0, z1, t0, t1, n] of [[-3.3, -1.4, 0.47, 0.53, 22], [-6.2, -4.0, 0.6, 0.66, 14], [-2.6, -1.4, 0.56, 0.62, 8], [-2.6, -1.4, 0.38, 0.44, 8]]) for (let i = 0; i < n; i++) {
    const z = z0 + rnd() * (z1 - z0), t = t0 + rnd() * (t1 - t0), r = 0.05 + rnd() * 0.05;
    P.fill([[z - r * 1.6, t - 0.004], [z + r * 1.6, t - 0.003], [z + r * 1.4, t + 0.004], [z - r * 1.4, t + 0.003]], { color: '#46484b', rough: 0.75, metal: 0 }, { alpha: 0.1 + rnd() * 0.1, feather: 3 });
  }
  P.noise({ alpha: 0.075, scale: 2.4, stretch: [1.6, 1], rough: 0.05 });
  P.noise({ alpha: 0.045, scale: 0.6, mode: 'light' });
  for (let i = 0; i < 22; i++) { const z = -3 + rnd() * 9, t = (rnd() < 0.5 ? 0.0 : 0.9) + rnd() * 0.1; P.streak(z, t, z + 0.6 + rnd() * 1.2, t, 0.01 + rnd() * 0.012, { alpha: 0.08 + rnd() * 0.1 }); }
  P.fill((g) => g.rect(6.4, 0, 1.05, 1), { color: 'rgba(40,36,32,0.25)' }, { feather: 10 });

  // ================= wings =================
  const tLE42 = Math.tan(42 * DEG);
  for (const key of ['R', 'L']) {
    const s = key === 'R' ? 1 : -1, wg = W.R;
    const at = (x, f) => { const p = wg.at(x, f); return [p[0] * s, p[2]]; };
    const hTE = (x) => wg.lines.hingeTE.at(wg.spanToU(x)), hLE = (x) => wg.lines.hingeLE.at(wg.spanToU(x));
    for (const [chart, fin0, top] of [[cWT[key], base, true], [cWB[key], under, false]]) {
      const Q = atlas.pen(chart);
      Q.fill('all', fin0);
      if (top && pat) aggCamo(Q, pat, { c: s > 0 ? [1.1, 6.86] : [-6.86, -1.1], z: [-3.45, 5.45], pos: (x) => [x, 0], pt: (x, z) => [x, z], finish: coat, feather: 0.6 });
      else if (top) for (const b of blobs) Q.fill(b, camo, { feather: 14 });
      // control surfaces
      Q.line([at(2.66, 1), at(2.66, hTE(2.66)), at(4.0, hTE(4.0)), at(4.0, 1)], gapL);
      Q.line([at(4.05, 1), at(4.05, hTE(4.05)), at(6.1, hTE(6.1)), at(6.1, 1)], gapL);
      Q.line([at(1.85, 0), at(1.85, hLE(1.85)), at(6.55, hLE(6.55)), at(6.55, 0)], gapL);
      // spars / ribs: sparse and faint
      for (const f of [0.35, 0.55]) Q.line([at(2.0, f), at(6.5, f)], panelL);
      for (const x of [2.8, 3.9, 5.0]) Q.line([at(x, hLE(x) + 0.02), at(x, hTE(x) - 0.02)], panelL);
      // RAM-treated sawtooth access panels
      for (const [x0, x1, f0, f1] of [[2.3, 3.2, 0.3, 0.5], [4.0, 4.9, 0.4, 0.58], [2.2, 2.9, 0.6, 0.74]]) {
        const A = at(x0, f0), B = at(x1, f0), C = at(x1, f1), D = at(x0, f1);
        const pts = saw(A, B, 2, 0.1, [0, 1]).concat(saw(C, D, 2, 0.1, [0, -1]));
        Q.stroke(pts.concat([pts[0]]), 0, ram, { px: 2, alpha: 0.3 });
        Q.line(pts.concat([pts[0]]), panelL);
      }
      // leading / trailing edge treatment bands
      Q.stroke((g) => { const a = at(1.75, 0.004), b = at(6.78, 0.004); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }, 0.07, edgeF, { alpha: 0.7 });
      Q.stroke((g) => { const a = at(1.2, 0.995), k = at(o.WG.xk, 0.995), b = at(6.78, 0.995); g.moveTo(a[0], a[1]); g.lineTo(k[0], k[1]); g.lineTo(b[0], b[1]); }, 0.05, edgeF, { alpha: 0.6 });
      weather(Q, s > 0 ? 1.8 : -6.3, s > 0 ? 6.3 : -1.8, -1.6, 4.6, top ? 12 : 6, top ? [[s * 2.1, -0.9, 0.5, 1.4]] : null);
      Q.noise({ alpha: 0.08, scale: 1.4, stretch: [1, 2.2], rough: 0.05 });
      for (let i = 0; i < 10; i++) { const x = 2.0 + rnd() * 4, a = at(x, hTE(x)); Q.streak(a[0], a[1], a[0], a[1] + 0.3 + rnd() * 0.4, 0.04, { alpha: 0.12 }); }
      // markings (USAF practice: star upper left / lower right, USAF upper right / lower left)
      const m = at(4.6, 0.45);
      if (pat) Q.decal(m[0], m[1], (g) => aggDevice(g, 0.9));                                                    // insignia on all four wing faces
      else if ((top && key === 'L') || (!top && key === 'R')) Q.decal(m[0], m[1], { rot: top ? 0 : 180 }, (g) => K.drawStarBar(g, 0.62, { lowVis }));
      else Q.text('USAF', m[0], m[1], 0.42, { color: mark, rot: s > 0 ? (top ? 90 : -90) : (top ? -90 : 90) });
    }
  }
  // ================= stabilators =================
  for (const [chart, f0, top, sx] of [[cST.R, base, true, 1], [cST.L, base, true, -1], [cSB, under, false, 1]]) {
    const Q = atlas.pen(chart); Q.fill('all', f0);
    if (top && pat) aggCamo(Q, pat, { c: sx > 0 ? [1.8, 4.5] : [-4.5, -1.8], z: [4.2, 8.1], pos: (x) => [x, -0.04], pt: (x, z) => [x, z], finish: coat, feather: 0.6 });
    else if (top) for (const b of blobs) Q.fill(b, camo, { feather: 14 });
    const le = (x) => ST.zr + (x - ST.xr) * tLE42, ch = (x) => ST.cr + (ST.ct - ST.cr) * (x - ST.xr) / (ST.xt - ST.xr);
    for (const f of [0.3, 0.6]) Q.line([[sx * (ST.xr + 0.05), le(ST.xr) + ch(ST.xr) * f], [sx * (ST.xt - 0.05), le(ST.xt) + ch(ST.xt) * f]], panelL);
    Q.stroke([[sx * ST.xr, le(ST.xr) + 0.02], [sx * ST.xt, le(ST.xt) + 0.02]], 0.06, edgeF, { alpha: 0.6 });
    Q.noise({ alpha: 0.08, scale: 1.1, stretch: [1, 2], rough: 0.05 });
    Q.fill((g) => g.rect(-5, 7.3, 10, 1), { color: 'rgba(40,36,32,0.18)' }, { feather: 8 });
  }
  // ================= fins (paint coords: a = z, b = distance up the canted span) =================
  for (const key of ['RO', 'RI', 'LO', 'LI']) {
    const Q = atlas.pen(cFin[key]), outer = key[1] === 'O', fz = (u) => FN.z + FN.le * u, fc = (u) => FN.c - (FN.c - FN.ct) * u / FN.span;
    Q.fill('all', base);
    if (pat) aggCamo(Q, pat, { c: [-0.45, 3.45], z: [2.0, 7.4], pos: (u) => [FIN.x + u * Math.sin(FIN.cant), FIN.y + u * Math.cos(FIN.cant)], pt: (u, z) => [z, u], finish: coat, feather: 0.6 });
    if (pat) {   // signal-red fin tip over a thin black line; insignia on the outer faces
      Q.fill([[fz(2.45), 2.45], [fz(3.4), 3.4], [fz(3.4) + fc(3.4) + 0.2, 3.4], [fz(2.45) + fc(2.45) + 0.2, 2.45]], coat(AGG.red, 0.6));
      Q.stroke([[fz(2.42), 2.42], [fz(2.42) + fc(2.42) + 0.2, 2.42]], 0.035, coat(AGG.ink, 0.6));
      if (outer) Q.decal(fz(1.25) + fc(1.25) * 0.42, 1.25, (g) => aggDevice(g, 0.62));
    }
    if (!pat) for (const [cz, cu, rz, ru] of [[3.4, 0.6, 1.0, 0.7], [5.6, 2.2, 0.9, 0.8], [6.5, 0.4, 0.6, 0.5]]) {
      const pts = []; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, r = 0.75 + rnd() * 0.4; pts.push([cz + Math.cos(a) * rz * r, cu + Math.sin(a) * ru * r]); }
      Q.fill(pts, camo, { feather: 3 });
    }
    const hz = (u) => fz(u) + fc(u) * fin.R.lines.hinge.at(fin.R.spanToU(u));
    Q.line([[fz(0.6) + fc(0.6), 0.6], [hz(0.6), 0.6], [hz(3.0), 3.0], [fz(3.0) + fc(3.0), 3.0]], gapL);
    for (const u of [0.9, 1.7, 2.5]) Q.line([[fz(u) + 0.05, u], [hz(u) - 0.03, u]], panelL);
    Q.stroke([[fz(-0.3) + 0.03, -0.3], [fz(3.3) + 0.03, 3.3]], 0.07, edgeF, { alpha: 0.7 });
    if (outer) {
      // fin-tip squadron band, tail code, serial
      if (SC.band) {
        const bandPoly = [[fz(2.7), 2.7], [fz(3.0), 3.0], [fz(3.0) + fc(3.0) * 0.68, 3.0], [fz(2.7) + fc(2.7) * 0.7, 2.7]];
        Q.fill(bandPoly, coat(SC.band, 0.6));
        (SC.stripes || []).forEach((c, k) => { const u = 2.66 - k * 0.05; Q.stroke([[fz(u) + 0.02, u], [fz(u) + fc(u) * 0.7, u]], 0.025, coat(c, 0.5)); });
        if (SC.stars) for (const [dz, du] of [[0.55, 2.9], [0.7, 2.94], [0.86, 2.92], [1.0, 2.86], [1.12, 2.92], [1.25, 2.84], [1.32, 2.76]]) Q.decal(fz(du) + fc(du) * (0.36 + dz * 0.24), du, (g) => { g.fillStyle = SC.stars; g.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.012 : 0.03, a = k * Math.PI / 5 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.fill(); });
        Q.text(SC.bandText, fz(2.85) + fc(2.85) * (SC.stars ? 0.2 : 0.36), 2.85, 0.1, { color: '#9a9ea3' });
      }
      if (SC.code) Q.text(SC.code, fz(1.75) + fc(1.75) * 0.36, 1.75, 0.62, { color: mark, weight: 700 });
      if (SC.serial) Q.text(SC.serial, fz(1.0) + fc(1.0) * 0.38, 1.0, 0.13, { color: mark, weight: 700 });
      if (SC.unit) Q.text(SC.unit, fz(2.38) + fc(2.38) * 0.36, 2.38, 0.12, { color: mark, weight: 700 });
    }
    Q.noise({ alpha: 0.08, scale: 1.2, stretch: [1, 1.5], rough: 0.05 });
  }
  // ================= intake / cheek outer walls (side projection z, y) =================
  for (const key of ['R', 'L']) {
    const Q = atlas.pen(cInt[key]); Q.fill('all', base);
    if (pat) aggCamo(Q, pat, { c: [-0.92, 0.05], z: [-4.4, -0.7], pos: (y) => [1.3, y], pt: (y, z) => [z, y], finish: coat, feather: 0.6 });
    Q.fill((g) => g.rect(-4.4, -0.95, 3.8, 0.4), under, { feather: 8, alpha: 0.7 });
    // side weapons bay door (sawtooth fore / aft edges)
    const sb = saw([-3.2, -0.7], [-3.06, -0.36], 2, 0.13, [1, 0]).concat(saw([-1.42, -0.36], [-1.56, -0.7], 2, 0.13, [-1, 0]));
    Q.line(sb.concat([sb[0]]), gapL); Q.stroke(sb.concat([sb[0]]), 0, ram, { px: 2.5, alpha: 0.45 });
    // lip edge band, intake warning stencil
    Q.stroke((g) => { for (let y = -0.8; y <= -0.06; y += 0.74) { } g.moveTo(o.lipZ(o.INT.BO[0], o.INT.BO[1]) + 0.05, -0.8); g.lineTo(o.lipZ(o.INT.TO[0], o.INT.TO[1]) + 0.05, -0.1); }, 0.08, edgeF, { alpha: 0.7 });
    Q.decal(-3.55, -0.22, (g) => { g.strokeStyle = '#8a2a24'; g.lineWidth = 0.012; g.beginPath(); g.moveTo(-0.07, 0.06); g.lineTo(0.07, 0.06); g.lineTo(0, -0.06); g.closePath(); g.stroke(); });
    Q.text('DANGER', -3.2, -0.22, 0.035, { color: '#8a2a24' });
    // national insignia on the aft cheek
    if (pat) Q.decal(-1.05, -0.4, (g) => aggDevice(g, 0.4));
    else Q.decal(-0.98, -0.5, (g) => K.drawStarBar(g, 0.36, { lowVis }));
    Q.noise({ alpha: 0.07, scale: 1.2, rough: 0.05 });
  }
  // ================= nacelles =================
  { const Q = atlas.pen(cNac); Q.fill('all', base);
    if (pat) aggCamo(Q, pat, { c: [0, 1], z: [2.9, 7.05], pos: (t) => [0.8 + 0.4 * Math.sin(t * 6.283), -0.1 - 0.4 * Math.cos(t * 6.283)], pt: (t, z) => [z, t], finish: coat, feather: 0.6 });
    for (const z of [4.0, 5.2, 6.3]) Q.ring(z, 0.3, 0.7, panelL);
    Q.fill((g) => g.rect(6.2, 0, 0.85, 1), { color: 'rgba(38,34,30,0.35)' }, { feather: 12 });
    Q.noise({ alpha: 0.08, scale: 1, rough: 0.05 }); }
}

// ---- "aggressor": the adversary paint family ------------------------------------------------------------------------------
// One invented air force across the whole adversary fleet (this block is repeated verbatim in every fighter visual that has an
// `aggressor` livery): a three-tone sand / rust / dark-earth disruptive camouflage over pale-sand undersides, signal-red fin
// tips and two-digit side numbers, and an invented insignia — a red chevron on a white-rimmed black hexagon. The pattern
// changes per type (band width, slant, wavy or hard splinter edges); palette and markings do not. No real nation, unit or text.
let aggSpawn = 0;
/** Side number for the next adversary airframe of this type (each spawn wears a different one). */
function aggNumber(base) { aggSpawn++; return String(10 + ((base + aggSpawn * 37) % 90)); }
/**
 * Camouflage field shared by every chart of one airframe, so bands run on from the fuselage onto wings, tails and fins:
 * boundary k lies at z = c_k + A·|x| + Ax·x + B·y + an edge term (wavy sine or hard zigzag "splinter"). Colour 0 is the sand
 * base (left unpainted), 1 rust, 2 earth; neighbouring bands never share a colour.
 * o: { seed, step (mean band width, m), A, Ax, B, wave (0..0.2, of step) | splinter (0..0.3, of step), z: [zMin, zMax] }
 */
function aggPattern(o) {
  let s = o.seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const cs = [], ci = [], ph = []; let z = o.z[0] - o.step * 6, c = 1;
  while (z < o.z[1] + o.step * 6) { cs.push(z); ci.push(c); ph.push(rnd() * 6.283); z += o.step * (0.65 + rnd() * 0.7); c = (c + 1 + (rnd() < 0.5 ? 0 : 1)) % 3; }
  cs.push(z); ph.push(rnd() * 6.283);
  const w = (o.wave ?? 0) * o.step, sp = (o.splinter ?? 0) * o.step, f = 1.5 / o.step;
  const tri = (u) => { const v = ((u % 2) + 2) % 2; return v < 1 ? v : 2 - v; };
  const zb = (k, x, y) => {
    const ax = Math.abs(x); let d = cs[k] + o.A * ax + (o.Ax ?? 0) * x + o.B * y;
    if (w) d += w * (Math.sin(ax * f + y * f * 0.7 + ph[k]) + 0.35 * Math.sin(ax * f * 2.6 - y * f * 1.9 + ph[k] * 1.7));
    if (sp) d += sp * (2 * tri((ax + y * 0.6) * f * 0.45 + ph[k]) - 1);
    return d;
  };
  return { cs, ci, zb, n: cs.length - 1 };
}
/**
 * Paint a pattern onto one chart. o: { c: [c0, c1] range of the chart's cross coordinate, z: [z0, z1] its range along the body,
 * pos(c, z) → body [x, y], pt(c, z) → paint coordinates, iter (refinement passes when pos depends on z, e.g. unwrap charts),
 * n (samples across), finish(colour) → finish, feather (px) }
 */
function aggCamo(P, pat, o) {
  const n = o.n ?? 28, it = o.iter ?? 1, cols = [null, o.finish(AGG.rust), o.finish(AGG.earth)];
  const edge = (k) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const c = o.c[0] + (o.c[1] - o.c[0]) * i / n; let z = pat.cs[k];
      for (let r = 0; r < it; r++) { const p = o.pos(c, Math.min(o.z[1], Math.max(o.z[0], z))); z = pat.zb(k, p[0], p[1]); }
      out.push([c, z]);
    }
    return out;
  };
  let prev = edge(0), lo = Math.min(...prev.map((q) => q[1]));
  for (let k = 0; k < pat.n; k++) {
    const next = edge(k + 1), hi = Math.max(...next.map((q) => q[1]));
    if (pat.ci[k] && hi > o.z[0] && lo < o.z[1]) P.fill(prev.concat(next.slice().reverse()).map(([c, z]) => o.pt(c, z)), cols[pat.ci[k]], { feather: o.feather ?? 1 });
    prev = next; lo = Math.min(...next.map((q) => q[1]));
  }
}
/** The insignia, centred on the decal origin: red chevron (pointing up / forward) on a black hexagon with a white rim. s = height (m). */
function aggDevice(g, s) {
  const r = s / 2, hex = (k) => { g.beginPath(); for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; g.lineTo(Math.cos(a) * r * k, Math.sin(a) * r * k); } g.closePath(); g.fill(); };
  g.fillStyle = AGG.white; hex(1); g.fillStyle = AGG.ink; hex(0.85);
  g.fillStyle = AGG.red; g.beginPath();
  g.moveTo(0, -0.6 * r); g.lineTo(0.56 * r, 0.44 * r); g.lineTo(0.27 * r, 0.44 * r); g.lineTo(0, -0.05 * r); g.lineTo(-0.27 * r, 0.44 * r); g.lineTo(-0.56 * r, 0.44 * r);
  g.closePath(); g.fill();
}
/** Side number style: signal red with a thin black outline. */
const AGG_NUM = { color: AGG.red, outline: AGG.ink, outlineWidth: 7, weight: 700, font: K.FONT.sans };
