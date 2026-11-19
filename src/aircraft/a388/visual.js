// Airbus A380-800 — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (-5.7) when parked.
//
// Reference numbers (docs/aircraft/a388.md; d = distance aft of the nose tip, z = d - 37.5):
//   length 72.72 m (nose z -37.5 … APU exhaust z 35.22), span 79.75 m over the tip fences, height 24.09 m (fin tip y 18.39).
//   Fuselage: full-length double deck, an ovoid 7.14 m wide × 8.5 m tall (crown y 4.3, keel y -4.2, widest at y -0.2; the
//   upper deck lobe is visibly narrower than the main deck). Blunt nose on y -1.0, the flight deck set between the decks:
//   windshield bottom d 2.85 (y 1.25), top d 4.4 (y 2.05), below the upper-deck window line, with the tall upper-deck
//   "forehead" rising behind it to the crown at d ≈ 12. Constant section d 15 … 50, aft taper from d 54, upswept tail cone ending in the APU exhaust (y 0.6).
//   The six flight-deck windows are cut out of the skin and glazed (real glass): the flight deck shows from outside.
//   Windows: main deck y -0.85, upper deck y 2.3; doors M1–M5 at d 8.5 / 18.5 / 33 / 52 / 62, U1–U3 at d 12 / 36 / 58.
//   Wing (right): root LE z -11.5 at x 3.6 (chord 17.5), Yehudi kink x 14.5 (LE z -3.9, chord 11.8), tip x 39.88 (LE z 12.4,
//   chord 4.0); LE sweep 35° / 33°; two trailing-edge kinks (x 11.5, x 25); dihedral 10.8° inboard (gull), 5.8° outboard from the
//   root chord line at y -2.6 (tip y 2.05); supercritical section 15 % → 8 %. Wingtip fences: arrow-shaped plates 2.3 m above
//   and 1.4 m below the tip, starting ahead of the tip leading edge.
//   Leading edge: droop nose x 4.4–11.8, slats x 13.6–39.3. Trailing edge: three single-slotted flaps (x 4.3–29.4) with
//   big flap-track fairings, three ailerons (x 29.6–39.4), eight spoilers (x 5–28.8).
//   Engines (Trent 900 class): fan Ø 2.95 m (24 swept blades), nacelle Ø 3.8 m, fan cowl 4.7 m + core 2.2 m; inlet at x ±12.7
//   (y -3.35, z -9.3) and x ±25.2 (y -2.4, z 1.0) on short, thick pylons. Translating reverser sleeves on the inboard pair only.
//   Tail: stabiliser span 30.4 m, root chord 11.6 (LE z 20.2 at x 0.8), tip chord 3.5, LE sweep 38°, dihedral 6°, two
//   elevators a side. Fin LE root z 14.5 at the crown, chord 18 → 5.5 at y 18.39, LE sweep 42°, two-segment rudder.
//   Gear (geometry.js, unchanged): nose twin r 0.55 at z -28.4 (retracts forward); wing gear x ±6.25 z 0.8 (four-wheel
//   bogies, retract inward into the belly fairing); body gear x ±2.65 z 4.9 (six-wheel bogies, retract forward, aft axle
//   steers). 22 wheels.
// The airline liveries are invented for this simulator: they do not reproduce any real operator's name or marks.
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
export const LIVERIES = ['orivane', 'selvara', 'house'];

const SCHEMES = {
  orivane: { name: 'Orivane', title: 'ORIVANE', reg: 'ZZ-ORV', body: '#f5f6f7', belly: '#c9ced3', cheat: '#2b2f86', accent: '#c9a227', tail: '#2b2f86', engine: '#f3f4f5', lipBand: '#2b2f86', tip: '#2b2f86', titleColor: '#2b2f86', font: 'serif', style: 'cheat' },
  selvara: { name: 'Selvara', title: 'Selvara', reg: 'ZZ-SVR', body: '#f6f7f6', belly: '#0f4c4a', cheat: '#e8604c', accent: '#e8604c', tail: '#0f4c4a', engine: '#0f4c4a', lipBand: '#e8604c', tip: '#e8604c', titleColor: '#0f4c4a', font: 'round', style: 'sweep' },
  house: { name: 'Skyward house colours', title: 'SKYWARD', reg: 'ZZ-SKA', body: '#f1f2f3', belly: '#99a1a8', cheat: '#2a64c5', accent: '#1b2a3c', tail: '#f1f2f3', engine: '#f1f2f3', lipBand: '#2a64c5', tip: '#2a64c5', titleColor: '#1b2a3c', font: 'wide', style: 'house' },
};

const NZ = -37.5;
const D = (d) => d + NZ;

// ---- fuselage station tables ------------------------------------------------------------------------------------------------
//  d (from the nose)  y of the crown  y of the keel  half-width  y of the widest point
const NOSE = [
  [0.00, -1.00, -1.00, 0.00, -1.00], [0.06, -0.64, -1.38, 0.38, -1.00], [0.22, -0.34, -1.72, 0.72, -1.00], [0.55, 0.0, -2.08, 1.06, -0.99], [1.00, 0.30, -2.40, 1.40, -0.97],
  [1.80, 0.78, -2.82, 1.86, -0.94], [2.70, 1.20, -3.20, 2.28, -0.89], [3.60, 1.62, -3.50, 2.62, -0.82], [4.40, 2.06, -3.72, 2.88, -0.74],
  [5.20, 2.62, -3.88, 3.10, -0.65], [6.20, 3.28, -4.00, 3.28, -0.55], [7.40, 3.80, -4.08, 3.42, -0.45], [9.00, 4.10, -4.14, 3.52, -0.35],
  [11.0, 4.24, -4.18, 3.56, -0.27], [13.5, 4.28, -4.20, 3.57, -0.22], [15.5, 4.30, -4.20, 3.57, -0.20],
];
//  z      crown   keel   half-width  widest
const TAIL = [
  [12.5, 4.30, -4.20, 3.57, -0.20], [16.5, 4.27, -4.08, 3.55, -0.14], [20.5, 4.17, -3.74, 3.44, -0.02], [24.5, 3.97, -3.14, 3.08, 0.18],
  [28.5, 3.60, -2.38, 2.45, 0.40], [31.8, 2.92, -1.38, 1.62, 0.68], [33.8, 2.18, -0.58, 0.98, 0.82], [34.8, 1.58, -0.06, 0.58, 0.78], [35.22, 1.12, 0.32, 0.37, 0.72],
];

// ---- wing planform (right wing) ---------------------------------------------------------------------------------------------
const XR = 3.6, XK = 14.5, XT = 39.88;
const zLE = (x) => (x <= XK ? -11.5 + 0.6972 * (x - XR) : -3.9 + 0.6422 * (x - XK));
const zTE = (x) => (x <= 11.5 ? 6.0 + 0.1013 * (x - XR) : x <= 25 ? 6.8 + 0.3704 * (x - 11.5) : 11.8 + 0.3091 * (x - 25));
const wy = (x) => (x <= XK ? -2.6 + 0.19 * (x - XR) : -0.529 + 0.1016 * (x - XK));
const FLAPS = [[4.3, 11.3], [11.5, 20.6], [20.8, 29.4]];
const AILS = [[29.6, 32.9], [33.0, 36.3], [36.4, 39.4]];
const SPOILERS = [[5.0, 7.6], [7.7, 10.3], [10.4, 13.0], [13.1, 15.6], [15.7, 18.6], [18.7, 21.8], [21.9, 25.3], [25.4, 28.8]];
const SLATS = [13.6, 17.9, 22.2, 26.6, 30.9, 35.1, 39.3];
const CANOES = [7.6, 17.0, 21.1, 29.0];

// engine inlet-plane centres (geometry.js engines[].intake, order = state.engines order: inboard L, outboard L, inboard R, outboard R)
const NAC = { len: 4.7, rHi: 1.68, rMax: 1.9, rThroat: 1.52, rFan: 1.49, zFan: 1.0, rExit: 1.58, sleeve: 0.55, core: { r0: 1.1, r1: 0.64, length: 2.2 }, plug: { r: 0.44, length: 1.15 } };

// ---- small vector helpers ----------------------------------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** Rotation about the line a→b by `ang`, in the sense that moves `ref` toward `toward`: { P(point), N(direction) }. */
function rotor(a, b, ref, toward, ang) {
  const u = norm(sub(b, a)), s = dot(cross(u, sub(ref, a)), toward) < 0 ? -1 : 1, c = Math.cos(s * ang), sn = Math.sin(s * ang);
  const R = (v) => { const k = dot(u, v), x = cross(u, v); return [v[0] * c + x[0] * sn + u[0] * k * (1 - c), v[1] * c + x[1] * sn + u[1] * k * (1 - c), v[2] * c + x[2] * sn + u[2] * k * (1 - c)]; };
  return { P: (p) => add3(a, R(sub(p, a))), N: R };
}

/**
 * One draw call for several parts that always move together but about different axes (both wings' flaps, all leading-edge
 * devices, the gear doors): the base mesh plus morph targets at evenly spaced fractions of the travel, blended piecewise so
 * the motion follows the arcs instead of cutting chords. groups: [{ mesh, pose(f) → { P, N } }]. Returns set(0..1).
 */
function morphPart(rig, name, groups, n, key) {
  const base = new K.Mesh(), ranges = [];
  for (const g of groups) { const s = base.vertexCount; base.add(g.mesh); ranges.push([s, base.vertexCount, g.pose]); }
  const node = rig.part(name, base, { key, pivot: [0, 0, 0], ao: false }), geo = node.geometry, P = [], N = [];
  for (let k = 1; k <= n; k++) {
    const pa = new Float32Array(base.p.length), na = new Float32Array(base.n.length);
    for (const [s, e, pose] of ranges) {
      const T = pose(k / n);
      for (let i = s; i < e; i++) { pa.set(T.P([base.p[i * 3], base.p[i * 3 + 1], base.p[i * 3 + 2]]), i * 3); na.set(T.N([base.n[i * 3], base.n[i * 3 + 1], base.n[i * 3 + 2]]), i * 3); }
    }
    P.push(new THREE.Float32BufferAttribute(pa, 3)); N.push(new THREE.Float32BufferAttribute(na, 3));
  }
  geo.morphAttributes.position = P; geo.morphAttributes.normal = N; geo.morphTargetsRelative = false;
  node.updateMorphTargets(); node.frustumCulled = false;
  const w = node.morphTargetInfluences;
  return (s) => {
    for (let k = 0; k < n; k++) w[k] = 0;
    const x = Math.min(1, Math.max(0, s)) * n; if (x <= 0) return;
    const k = Math.min(n - 1, Math.floor(x)), fr = x - k;
    if (k === 0) w[0] = fr; else { w[k - 1] = 1 - fr; w[k] = fr; }
  };
}

// ---- flight-deck glazing: the skin around the windows rebuilt with real openings ---------------------------------------------
function glazingBox(W, Kring) {
  let z0 = 1e9, z1 = -1e9, tm = 1;
  for (const w of W) for (const [z, t] of w) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); tm = Math.min(tm, t); }
  const t0 = (Math.floor(tm * Kring) - 1) / Kring;
  return { z: [z0 - 0.14, z1 + 0.14], t: [t0, 1 - t0] };
}
/**
 * Rebuild the skin inside `box` with holes for the convex (z, t) polygons, clipping each skin cell against them; the clipped
 * insides become the glass (`depth` metres in), and a dark seal wall lines each opening. Cells follow the loft's own ring
 * columns so the edges match the main skin.
 */
function glazing(f, chart, polys, box, dzRow, depth = 0.014, uvSeal = null) {
  const skin = new K.Mesh(), glass = new K.Mesh(), Kr = f.K, memo = new Map();
  const area = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const W = polys.map(P => (area(P) > 0 ? P : P.slice().reverse()));
  const bb = W.map(P => [Math.min(...P.map(p => p[0])), Math.max(...P.map(p => p[0])), Math.min(...P.map(p => p[1])), Math.max(...P.map(p => p[1]))]);
  const clip = (poly, a, b, keepIn) => {
    const out = [], side = (p) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * (keepIn ? 1 : -1);
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const k = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]); }
    }
    return out.length >= 3 && Math.abs(area(out)) > 1e-9 ? out : null;
  };
  const emit = (m, poly, off) => {
    const vs = poly.map(([z, t]) => {
      const key = Math.round(z * 1e4) * 1e5 + Math.round(t * 1e5); let q = memo.get(key);
      if (!q) { q = f.at(z, t); q.uv = chart.uvUnwrap(z, t, chart.stripAt(z)); memo.set(key, q); }
      const { p, n } = q; return { p: [p[0] - n[0] * off, p[1] - n[1] * off, p[2] - n[2] * off], n, uv: q.uv };
    });
    for (let i = 1; i < vs.length - 1; i++) {
      const A = vs[0]; let B = vs[i], C = vs[i + 1];
      const c = cross(sub(B.p, A.p), sub(C.p, A.p));
      if (dot(c, A.n) < 0) [B, C] = [C, B];
      const i0 = m.vertexCount;
      for (const v of [A, B, C]) m.vert(v.p[0], v.p[1], v.p[2], v.n[0], v.n[1], v.n[2], v.uv[0], v.uv[1]);
      m.tri(i0, i0 + 1, i0 + 2);
    }
  };
  const zs = [box.z[0], box.z[1]];
  for (let z = box.z[0] + dzRow; z < box.z[1] - dzRow * 0.3; z += dzRow) zs.push(z);
  for (const P of W) for (const p of P) zs.push(p[0]);
  zs.sort((a, b) => a - b);
  const Z = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 0.01);
  const j0 = Math.round(box.t[0] * Kr), j1 = Math.round(box.t[1] * Kr);
  for (let i = 0; i < Z.length - 1; i++) for (let j = j0; j < j1; j++) {
    const za = Z[i], zb = Z[i + 1], ta = j / Kr, tb = (j + 1) / Kr;
    let outside = [[[za, ta], [zb, ta], [zb, tb], [za, tb]]];
    W.forEach((P, w) => {
      const b = bb[w]; if (zb < b[0] || za > b[1] || tb < b[2] || ta > b[3]) return;
      const next = [];
      for (const piece of outside) {
        let rest = piece;
        for (let e = 0; e < P.length && rest; e++) { const a = P[e], c = P[(e + 1) % P.length], o = clip(rest, a, c, false); if (o) next.push(o); rest = clip(rest, a, c, true); }
        if (rest) emit(glass, rest, depth);
      }
      outside = next;
    });
    for (const piece of outside) emit(skin, piece, 0);
  }
  if (uvSeal) for (const P of W) {
    let cz = 0, ct = 0; for (const p of P) { cz += p[0] / P.length; ct += p[1] / P.length; }
    const c3 = f.at(cz, ct).p;
    for (let e = 0; e < P.length; e++) {
      const a = P[e], b = P[(e + 1) % P.length], nSeg = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], (b[1] - a[1]) * 19) / 0.12));
      for (let k = 0; k < nSeg; k++) {
        const pa = f.at(a[0] + (b[0] - a[0]) * k / nSeg, a[1] + (b[1] - a[1]) * k / nSeg), pb = f.at(a[0] + (b[0] - a[0]) * (k + 1) / nSeg, a[1] + (b[1] - a[1]) * (k + 1) / nSeg);
        const a0 = pa.p, b0 = pb.p, a1 = a0.map((v, i) => v - pa.n[i] * depth * 1.15), b1 = b0.map((v, i) => v - pb.n[i] * depth * 1.15);
        let [nx, ny, nz] = cross(sub(b0, a0), sub(a1, a0));
        const flip = nx * (c3[0] - a0[0]) + ny * (c3[1] - a0[1]) + nz * (c3[2] - a0[2]) < 0, l = Math.hypot(nx, ny, nz) * (flip ? -1 : 1) || 1;
        nx /= l; ny /= l; nz /= l;
        const i0 = skin.vertexCount;
        for (const q of [a0, b0, b1, a1]) skin.vert(q[0], q[1], q[2], nx, ny, nz, uvSeal[0], uvSeal[1]);
        if (flip) skin.quad(i0 + 3, i0 + 2, i0 + 1, i0); else skin.quad(i0, i0 + 1, i0 + 2, i0 + 3);
      }
    }
  }
  return { skin, glass };
}

/** Trent 900 fan: 24 swept titanium blades with a curved tip, conical spinner with a white spiral. Front face at z = 0. */
function trentFan(o) {
  const R = o.radius, hub = o.hub, nb = o.blades, m = new K.Mesh(), NS = 8, uvLE = o.bladeStrip ? o.bladeStrip.uv(0) : o.uvBlade, uvTE = o.bladeStrip ? o.bladeStrip.uv(1) : o.uvBlade;
  for (let i = 0; i < nb; i++) {
    const phi0 = i / nb * TAU, rows = [];
    for (let k = 0; k <= NS; k++) {
      const f = k / NS, r = hub * 0.97 + (R - hub * 0.97) * f, beta = (24 + 40 * Math.pow(f, 0.85)) * DEG;
      const cc = R * (0.26 + 0.2 * Math.sin(Math.PI * Math.min(1, f * 0.95 + 0.05)) - 0.04 * f * f), sweep = R * (0.04 * f + 0.16 * f * f * f), lean = 0.12 * f * f;
      const phi = phi0 + lean, rad = [Math.cos(phi), Math.sin(phi), 0], tan = [-Math.sin(phi), Math.cos(phi), 0];
      const dir = [tan[0] * Math.sin(beta), tan[1] * Math.sin(beta), Math.cos(beta)], zc = 0.2 + sweep;
      rows.push({ le: [rad[0] * r - dir[0] * cc * 0.45, rad[1] * r - dir[1] * cc * 0.45, zc - dir[2] * cc * 0.45], te: [rad[0] * r + dir[0] * cc * 0.55, rad[1] * r + dir[1] * cc * 0.55, zc + dir[2] * cc * 0.55], n: cross(dir, rad) });
    }
    for (const sg of [1, -1]) {
      const base = m.vertexCount;
      for (const q of rows) { m.vert(...q.le, q.n[0] * sg, q.n[1] * sg, q.n[2] * sg, uvLE[0], uvLE[1]); m.vert(...q.te, q.n[0] * sg, q.n[1] * sg, q.n[2] * sg, uvTE[0], uvTE[1]); }
      for (let k = 0; k < NS; k++) { const a = base + k * 2, b = a + 1, c = a + 3, d = a + 2; if (sg > 0) m.quad(a, b, c, d); else m.quad(a, d, c, b); }
    }
  }
  m.occlude((x, y) => 0.5 - 0.35 * Math.min(1, Math.hypot(x, y) / R));
  const sl = 0.85, prof = [[0, -sl], [hub * 0.08, -sl * 0.94], [hub * 0.4, -sl * 0.62], [hub * 0.74, -sl * 0.3], [hub * 0.97, -0.02], [hub, 0.15], [hub, 0.62, 1], [0, 0.62]];
  m.add(K.lathe(prof, { segments: 28, uv: o.uvSpinner }));
  const pts = []; for (let k = 0; k <= 16; k++) { const f = 0.1 + 0.85 * k / 16, z = -sl * (1 - f), r = hub * (0.1 + 0.9 * f) * 1.012 + 0.01, a = 2.8 * f; pts.push([r * Math.cos(a), r * Math.sin(a), z]); }
  m.add(K.pipe(pts, 0.04, { segments: 6, uv: o.uvSwirl }));
  return m;
}

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'orivane', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const rig = K.createRig(ctx, { geometry: G, name: 'a388', glassLayer: opts.glassLayer, cockpitRadius: 1.6 });

  // ---- atlases: A = fuselage + flight deck + gear, B = wings, tail, nacelles --------------------------------------------------
  // gloss airline paint: a well-kept long-haul jet (light weathering), frames every 0.53 m for the skin waviness
  const A = K.createAtlas({ size: atlasSize, base: F.gloss(SC.body), swatchRows: 6, skin: { weathering: 0.32, framePitch: 0.53 } });
  const cFus = A.chart('fus', { type: 'unwrap', z: [G.noseZ - 0.05, G.tailZ + 0.03], girth: 25.0, vScale: 0.8, strips: 4 });
  const cOver = A.chart('overhead', { type: 'rect', w: 0.8, h: 1.0, density: 1.4 });
  const cPed = A.chart('pedestal', { type: 'rect', w: 0.4, h: 0.9, density: 1.4 });
  A.pack();
  const UA = {
    body: A.swatch('body', F.gloss(SC.body)), fair: A.swatch('fair', F.gloss(SC.belly)), dark: A.swatch('dark', F.darkGrey), black: A.swatch('black', F.black),
    well: A.swatch('well', { color: '#8b9094', rough: 0.7, metal: 0.1 }), liner: A.swatch('liner', { color: '#b9bcbd', rough: 0.8, metal: 0 }), post: A.swatch('post', { color: '#8a8f93', rough: 0.7, metal: 0 }),
    floor: A.swatch('floor', { color: '#34373b', rough: 0.9, metal: 0 }), shield: A.swatch('shield', { color: '#2a2d31', rough: 0.85, metal: 0 }), console: A.swatch('console', { color: '#5a6168', rough: 0.75, metal: 0 }),
    seat: A.swatch('seat', { color: '#45494e', rough: 0.9, metal: 0 }), cushion: A.swatch('cushion', { color: '#3b4658', rough: 1, metal: 0 }), stick: A.swatch('stick', { color: '#17181a', rough: 0.5, metal: 0 }),
    lever: A.swatch('lever', { color: '#8e9194', rough: 0.35, metal: 0.7 }), table: A.swatch('table', { color: '#3e4247', rough: 0.6, metal: 0.1 }),
    exhaust: A.swatch('exhaust', F.exhaust), steel: A.swatch('steel', F.steel), antenna: A.swatch('antenna', F.gloss('#e9eaea')), dome: A.swatch('dome', F.semigloss('#d9dbdc')),
    strut: A.swatch('gear.strut', F.gearWhite), chrome: A.swatch('gear.chrome', F.chrome), tyre: A.swatch('gear.tyre', F.rubber), hub: A.swatch('gear.hub', { color: '#c4c6c2', rough: 0.4, metal: 0.35 }),
    link: A.swatch('gear.link', F.anodised), brake: A.swatch('gear.brake', { color: '#2c2724', rough: 0.58, metal: 0.8 }), hose: A.swatch('gear.hose', { color: '#17181a', rough: 0.55, metal: 0.35 }),
    pipe: A.swatch('pipe', { color: '#9a9e9f', rough: 0.45, metal: 0.7 }), box: A.swatch('wellbox', { color: '#6f7477', rough: 0.6, metal: 0.3 }), wiper: A.swatch('wiper', { color: '#1a1b1d', rough: 0.45, metal: 0.4 }),
    vane: A.swatch('vane', { color: '#b8bcbf', rough: 0.35, metal: 0.8 }), seal: A.swatch('seal', { color: '#1e2023', rough: 0.6, metal: 0 }),
  };
  const strips = K.tyreStrips(A); UA.tyreStrip = strips.tyre; UA.hubStrip = strips.hub;
  const B = K.createAtlas({ size: atlasSize, base: F.semigloss('#babfc4'), swatchRows: 6, skin: { weathering: 0.42, framePitch: 0.6 } });
  const cWT = { i: B.chart('wingTopIn', { type: 'plan', x: [0.9, 14.8], z: [-13.6, 8.4], view: 'top', mirror: true, density: 1.2 }), o: B.chart('wingTopOut', { type: 'plan', x: [14.2, 40.1], z: [-4.6, 16.8], view: 'top', mirror: true, density: 1.2 }) };
  const cWB = { i: B.chart('wingBotIn', { type: 'plan', x: [0.9, 14.8], z: [-13.6, 8.4], view: 'bottom', mirror: true, density: 0.85 }), o: B.chart('wingBotOut', { type: 'plan', x: [14.2, 40.1], z: [-4.6, 16.8], view: 'bottom', mirror: true, density: 0.85 }) };
  const cSt = B.chart('stab', { type: 'plan', x: [0.5, 15.6], z: [19.8, 35.5], view: 'top', mirror: true, density: 0.8 });
  const cFin = { L: B.chart('finL', { type: 'side', z: [12.6, 34.0], y: [2.4, 18.6], view: 'left', density: 0.95 }), R: B.chart('finR', { type: 'side', z: [12.6, 34.0], y: [2.4, 18.6], view: 'right', density: 0.95 }) };
  B.pack();
  const UB = {
    grey: B.swatch('grey', F.semigloss('#babfc4')), engine: B.swatch('engine', F.gloss(SC.engine)), lip: B.swatch('lip', F.polished), band: B.swatch('band', F.gloss(SC.lipBand)),
    duct: B.swatch('duct', { color: '#141518', rough: 0.6, metal: 0.2 }), acoustic: B.swatch('acoustic', { color: '#6a6e72', rough: 0.72, metal: 0.3 }), core: B.swatch('core', F.semigloss('#c5c9cc')),
    coreMetal: B.swatch('coreMetal', F.titanium), plug: B.swatch('plug', F.heatStained), blade: B.swatch('blade', { color: '#4d525a', rough: 0.3, metal: 0.75 }),
    spinner: B.swatch('spinner', { color: '#2a2c30', rough: 0.3, metal: 0.55 }), swirl: B.swatch('swirl', { color: '#f2f2f0', rough: 0.3, metal: 0 }), inner: B.swatch('inner', F.semigloss('#8c9399')),
    pylon: B.swatch('pylon', F.gloss(SC.style === 'sweep' ? '#eceeef' : SC.body)),
    tail: B.swatch('tail', F.gloss(SC.tail)), tip: B.swatch('tip', F.gloss(SC.tip)), cascade: B.swatch('cascade', { color: '#3a3c3f', rough: 0.6, metal: 0.7 }), wick: B.swatch('wick', F.black),
    canoe: B.swatch('canoe', F.semigloss('#c2c7cb')), hot: B.swatch('hot', { color: '#5f5a55', rough: 0.5, metal: 0.9 }), soot: B.swatch('soot', { color: '#66635e', rough: 0.65, metal: 0.4 }),
    seam: B.swatch('seam', { color: '#4a4d50', rough: 0.6, metal: 0.2 }),
  };
  const bandB = (g, a, b, style) => { g.fillStyle = style; g.fillRect(a, 0, b - a, 1); }, ormB = B.ormStyle;
  const SB = {
    blade: B.strip('fanBlade', 4, (g, layer) => {
      if (layer === 'color') { bandB(g, 0, 1, '#4a4f56'); bandB(g, 0, 0.1, '#b4b8bc'); bandB(g, 0.1, 0.14, '#5a5f64'); bandB(g, 0.9, 1, '#3c4045'); }
      else if (layer === 'orm') { bandB(g, 0, 1, ormB(0.32, 0.75)); bandB(g, 0, 0.12, ormB(0.18, 0.95)); }
    }),
  };

  // ---- fuselage ---------------------------------------------------------------------------------------------------------------
  const st = (z, top, bot, w, yc, extra) => ({ z, y: yc, w, top: Math.max(0, top - yc), bot: Math.max(0, yc - bot), ...extra });
  const FS = [
    ...NOSE.map(([d, top, bot, w, yc]) => st(D(d), top, bot, w, yc, d > 4 ? { kTop: [0.56, 0.52], kBot: [0.6, 0.58] } : { kBot: [0.58, 0.56] })),
    ...TAIL.map(([z, top, bot, w, yc]) => st(z, top, bot, w, yc, z > 30 ? { kTop: 0.58, kBot: 0.6 } : { kTop: [0.56, 0.52], kBot: [0.6, 0.58] })),
  ];
  const fseg = Math.max(40, Math.round(100 * detail / 4) * 4);
  // flight-deck window outlines (z, t) — measured on a quick loft of the same stations (rings are exact at any z)
  const WIN = flightDeckWindows(K.loft({ stations: FS, segments: fseg, step: 6 }));
  const fdBox = glazingBox([...WIN.list], fseg);
  const fus = K.loft({
    stations: FS, segments: fseg, step: 1.4 / detail, chart: cFus, capEnd: 'flat', capUV: UA.exhaust,
    cutouts: [{ name: 'ngw', z: [-30.9, -27.3], t: [0, 0.035], mirror: true }, { name: 'fd', z: fdBox.z, t: fdBox.t }],
  });
  cFus.body = fus;
  // the skin around the six flight-deck windows is rebuilt with real openings; glass panes sit 30 mm in from the skin
  const glaz = glazing(fus, cFus, WIN.list.flatMap(w => [w, w.map(p => [p[0], 1 - p[1]]).reverse()]), fdBox, 0.16, 0.03, UA.seal);
  const stA = new K.Mesh(), stB = new K.Mesh();
  stA.add(fus.mesh).add(glaz.skin);
  stA.add(K.well(K.merge(fus.patches.ngwR, fus.patches.ngwL), 1.2, UA.well, [0, 1, 0]));
  // APU exhaust in the tail cone
  stA.add(K.lathe([[0.25, G.tailZ - 0.3], [0.28, G.tailZ + 0.06, 1], [0.22, G.tailZ + 0.06, 1], [0.18, G.tailZ - 0.35]], { segments: 18, uv: UA.exhaust }).occlude(0.5).translate(0, 0.72, 0));

  // wing-to-body ("belly") fairing, long and deep, with the wing- and body-gear bays cut into its flat bottom
  const fairStations = [[-14.8, 1.2, 0.35, 0.55], [-13.0, 2.4, 0.8, 1.0], [-10.5, 3.4, 1.2, 1.2], [-7.5, 4.0, 1.45, 1.3], [-3.0, 4.3, 1.55, 1.33], [3.0, 4.35, 1.55, 1.33],
    [7.5, 4.15, 1.4, 1.3], [10.5, 3.6, 1.1, 1.22], [13.0, 2.6, 0.7, 1.0], [15.0, 1.3, 0.3, 0.55]]
    .map(r => ({ z: r[0], y: -2.95, w: r[1], top: r[2], bot: r[3], kTop: 0.7, kBot: [0.95, 0.5523] }));
  const fairOpts = { stations: fairStations, segments: Math.max(32, Math.round(52 * detail / 4) * 4), step: 0.9, uv: UA.fair };
  let fair = K.loft(fairOpts);
  const fAtX = (z, x) => { let lo = 0, hi = 0.25; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (fair.at(z, m).p[0] < x) lo = m; else hi = m; } return (lo + hi) / 2; };
  const fairCuts = [{ name: 'wgw', z: [-1.0, 2.1], t: [fAtX(0.5, 2.85), fAtX(0.5, 4.1)], mirror: true }, { name: 'bgw', z: [2.2, 7.5], t: [fAtX(5, 1.5), fAtX(5, 3.75)], mirror: true }];
  // the fairing samples the fuselage chart at the same station and height, so the livery (belly colour, lines, grime) runs
  // across the wing-body junction without a seam; one loft per chart strip keeps every triangle inside one strip
  {
    const fz = [fairStations[0].z, ...cFus.splits.filter(s => s > fairStations[0].z && s < fairStations[fairStations.length - 1].z), fairStations[fairStations.length - 1].z];
    const pieces = [];
    for (let i = 0; i + 1 < fz.length; i++) {
      const strip = cFus.stripAt((fz[i] + fz[i + 1]) / 2);
      const uvFn = (x, y, z) => { const t = fus.tAtY(z, y); return cFus.uvUnwrap(z, x >= 0 ? t : 1 - t, strip); };
      pieces.push(K.loft({ ...fairOpts, uvFn, zRange: [fz[i], fz[i + 1]], cutouts: fairCuts }));
    }
    fair = { at: fair.at, patches: Object.assign({}, ...pieces.map(q => q.patches)), edges: Object.assign({}, ...pieces.map(q => q.edges)) };
    for (const q of pieces) stA.add(q.mesh);
  }
  for (const k of ['wgwR', 'wgwL', 'bgwR', 'bgwL']) stA.add(K.well(fair.patches[k], 1.4, UA.well, [0, 1, 0]));
  // wheel-well plumbing: frames, actuators and pipe runs on the well roofs
  for (const sx of [-1, 1]) {
    const yr = -2.95 - 1.33 + 1.4 + 0.02;
    for (const z of [-0.5, 0.5, 1.5]) stA.add(K.box(1.15, 0.12, 0.08, UA.box).translate(sx * 3.48, yr - 0.06, z));
    for (const z of [3.0, 4.4, 5.8, 7.0]) stA.add(K.box(2.1, 0.12, 0.08, UA.box).translate(sx * 2.62, yr - 0.06, z));
    stA.add(K.pipe([[sx * 2.0, yr - 0.15, 2.4], [sx * 2.2, yr - 0.12, 4.6], [sx * 1.9, yr - 0.12, 7.3]], 0.035, { segments: 6, uv: UA.pipe }));
    stA.add(K.pipe([[sx * 3.3, yr - 0.15, 2.4], [sx * 3.5, yr - 0.13, 5.0], [sx * 3.4, yr - 0.12, 7.2]], 0.03, { segments: 6, uv: UA.pipe }));
    stA.add(K.pipe([[sx * 3.0, yr - 0.15, -0.8], [sx * 3.9, yr - 0.12, 1.9]], 0.03, { segments: 6, uv: UA.pipe }));
    stA.add(K.tube([sx * 2.9, yr - 0.2, -0.6], [sx * 3.9, yr - 0.2, 1.6], 0.07, 0.07, { segments: 8, uv: UA.chrome }));
    stA.add(K.tube([sx * 2.6, yr - 0.2, 6.9], [sx * 2.6, yr - 0.25, 4.0], 0.08, 0.08, { segments: 8, uv: UA.chrome }));
  }
  { // nose-gear bay: frames and the steering actuator
    const yr = fus.botAt(-29) + 1.2;
    for (const z of [-30.2, -29.1, -28.0]) stA.add(K.box(0.95, 0.1, 0.07, UA.box).translate(0, yr - 0.05, z));
    stA.add(K.pipe([[0.3, yr - 0.1, -30.6], [0.32, yr - 0.1, -27.5]], 0.03, { segments: 6, uv: UA.pipe }));
  }

  // ---- flight deck ------------------------------------------------------------------------------------------------------------
  const zd = D, eye = G.pilotEye, FLOOR = 0.5, zb = zd(6.9);
  const { WS, S1, S2 } = WIN, IN = new K.Mesh();
  {
    const L = (c, uv, nu = 3, nv = 3) => IN.add(K.liner(fus, c, { uv, nu, nv, mirror: true, inset: 0.05 }));
    const lo = (z) => [z, fus.tAtY(z, FLOOR + 0.04)], hi = (z) => [z, 0.5];
    L([WS.IB, WS.OB, lo(WS.OB[0]), lo(WS.IB[0])], UA.liner, 2, 5);
    L([WS.IB, hi(WS.IB[0]), hi(WS.IT[0]), WS.IT], UA.post, 4, 1);
    L([hi(WS.IT[0]), WS.IT, WS.OT, hi(WS.OT[0])], UA.liner, 3, 2);
    L([WS.OB, S1.bf, S1.tf, WS.OT], UA.post, 1, 4);
    L([WS.OT, S1.tf, hi(S1.tf[0]), hi(WS.OT[0])], UA.liner, 1, 3);
    L([lo(WS.OB[0]), lo(S1.bf[0]), S1.bf, WS.OB], UA.liner, 1, 3);
    L([lo(S1.bf[0]), lo(S1.br[0]), S1.br, S1.bf], UA.liner, 4, 3);
    L([S1.tf, S1.tr, hi(S1.tr[0]), hi(S1.tf[0])], UA.liner, 3, 3);
    L([S1.br, S2.bf, S2.tf, S1.tr], UA.post, 1, 4);
    L([lo(S1.br[0]), lo(S2.bf[0]), S2.bf, S1.br], UA.liner, 1, 3);
    L([S1.tr, S2.tf, hi(S2.tf[0]), hi(S1.tr[0])], UA.liner, 1, 3);
    L([lo(S2.bf[0]), lo(S2.br[0]), S2.br, S2.bf], UA.liner, 3, 3);
    L([S2.tf, S2.nt, hi(S2.nt[0]), hi(S2.tf[0])], UA.liner, 2, 3);
    L([S2.nt, S2.rt, hi(S2.br[0]), hi(S2.nt[0])], UA.liner, 2, 3);
    L([lo(S2.br[0]), lo(zb), hi(zb), hi(S2.br[0])], UA.liner, 3, 6);
    const fy = FLOOR, zP = zd(3.75), yG = 1.32;                                                   // main-panel face station, glareshield top
    IN.add(K.deck(fus, WS.IB[0] - 0.02, zb, fy, { uv: UA.floor, n: 8 }));
    IN.add(K.bulkhead(fus, zb, { uv: UA.liner, facing: -1 }));                                   // flight-deck door wall
    IN.add(K.bulkhead(fus, WS.IB[0] - 0.02, { uv: UA.shield, facing: 1 }));
    // main instrument panel (kit: PFD outboard + ND inboard per pilot, engine / warning display + standby in the centre, lit by
    // day) under the FCU glareshield (top at yG), narrowed toward the nose to stay inside the skin
    const eL = [-Math.abs(eye[0]), eye[1], eye[2]], eR = [Math.abs(eye[0]), eye[1], eye[2]];
    const panelMesh = fitInside(K.instrumentPanel({ eyes: [eL, eR], kind: 'airline', dist: eye[2] - zP - 0.02, drop: eye[1] - yG + 0.337, height: 0.56, width: 2.2, mfd: 0.22, uv: UA.shield }), fus, 1.13);
    IN.add(panelMesh);
    { // pedestal with its sloping top (MFD keyboards, four thrust levers, speedbrake and flap handles)
      IN.add(K.box(0.42, yG - 0.72 - fy, 1.05, UA.console).translate(0, fy + (yG - 0.72 - fy) / 2, zP + 0.6));
      const yp = yG - 0.72, i0 = IN.vertexCount; for (const [a, b] of [[0, 0], [0.4, 0], [0.4, 0.9], [0, 0.9]]) { const uv = cPed.uv(a, b); IN.vert(a - 0.2, yp + 0.01 - b * 0.1, zP + 0.1 + b * 1.05, 0, 1, 0.1, uv[0], uv[1]); } IN.quad(i0, i0 + 3, i0 + 2, i0 + 1);
      for (let k = 0; k < 4; k++) { const x = -0.105 + k * 0.07; IN.add(K.box(0.022, 0.15, 0.035, UA.lever).rotateX(-0.45).translate(x, yp + 0.06, zP + 0.42)); IN.add(K.box(0.05, 0.03, 0.045, UA.stick).translate(x, yp + 0.13, zP + 0.38)); }
      IN.add(K.box(0.025, 0.12, 0.03, UA.lever).rotateX(-0.3).translate(-0.17, yp + 0.05, zP + 0.62)); IN.add(K.box(0.03, 0.12, 0.03, UA.lever).rotateX(-0.3).translate(0.17, yp + 0.05, zP + 0.66));
    }
    { const i0 = IN.vertexCount; for (const [a, b] of [[0, 0], [0.8, 0], [0.8, 1.0], [0, 1.0]]) { const uv = cOver.uv(a, b); IN.vert(a - 0.4, 1.98 + b * 0.3, zd(4.45) + b, 0, -1, -0.25, uv[0], uv[1]); } IN.quad(i0, i0 + 1, i0 + 2, i0 + 3); }   // overhead panel
    for (const sx of [-1, 1]) {
      const e = [sx * Math.abs(eye[0]), eye[1], eye[2]];
      IN.add(K.crewSeat({ eye: e, uv: { frame: UA.seat, cushion: UA.cushion } }));
      // crew: outboard hand on the side-stick, inboard hand resting on the seat's inboard armrest
      const onStick = [sx * (1.0 - Math.abs(eye[0])), fy + 0.82 - eye[1], -0.4], rest = [-sx * 0.28, -0.5, -0.2];
      IN.add(K.pilot({ eye: e, kind: 'airline', recline: 8, stick: sx > 0 ? onStick : rest, throttle: sx > 0 ? rest : onStick, uv: { suit: UA.seat, helmet: UA.seat, dark: UA.seat } }));
      IN.add(K.box(0.3, 0.66, 1.1, UA.console).translate(sx * 1.05, fy + 0.33, e[2] - 0.15));                       // side console (top at elbow height)
      IN.add(K.box(0.2, 0.05, 0.5, UA.shield).translate(sx * 1.0, fy + 0.685, e[2] - 0.3));
      IN.add(K.stick({ base: [sx * 1.0, fy + 0.71, e[2] - 0.42], height: 0.17, uv: UA.stick }));                    // side-stick
      IN.add(K.box(0.2, 0.03, 0.3, UA.shield).translate(e[0], fy + 0.05, zP + 0.14));                               // rudder pedals
      IN.add(K.box(0.56, 0.025, 0.34, UA.table).translate(e[0] + sx * 0.02, yG - 0.79, zP + 0.24));                // pull-out keyboard table
      IN.add(K.box(0.42, 0.012, 0.16, UA.stick).translate(e[0] + sx * 0.02, yG - 0.772, zP + 0.2));                 // keyboard
      IN.add(K.box(0.3, 0.2, 0.03, UA.shield).translate(sx * 0.95, yG - 0.4, zP + 0.18));               // outboard display bezel (clock / EFB)
    }
  }
  IN.occlude((x, y, z) => 0.35 + 0.25 * Math.min(1, Math.max(0, (z - zd(3.4)) / 3)));   // the flight deck is a shaded room seen through the glass
  stA.add(IN);
  // windshield wipers parked along the lower frame of each front pane
  for (const s of [1, -1]) {
    const pt = (d, x) => { const z = zd(d), q = fus.at(z, s > 0 ? tAtXOf(fus, z, x) : 1 - tAtXOf(fus, z, x)); return add3(q.p, q.n.map(v => v * 0.03)); };
    const a = pt(3.02, 0.35), b = pt(3.17, 0.95), c = pt(2.98, 0.42);
    stA.add(K.tube(a, b, 0.012, 0.012, { segments: 5, uv: UA.wiper })).add(K.tube(c, pt(3.12, 0.88), 0.015, 0.012, { segments: 5, uv: UA.wiper })).add(K.tube(c, add3(c, [0, -0.03, 0.04]), 0.028, 0.024, { segments: 6, uv: UA.wiper }));
  }

  // ---- wings ----------------------------------------------------------------------------------------------------------------
  const wst = (x, tc, twist) => ({ x, y: wy(x), z: zLE(x), chord: zTE(x) - zLE(x), tc, twist });
  const sc = K.supercritical();
  const wingOf = (side) => K.wing({
    side, airfoil: sc, chordPts: Math.round(16 * Math.min(1, detail)), spanAxis: 'x', tip: 'flat',
    stations: [wst(1.0, 0.15, 2.0), wst(XR, 0.15, 2.0), wst(8.0, 0.135, 1.2), wst(11.5, 0.122, 0.6), wst(XK, 0.112, 0.2), wst(25, 0.097, -1.5), wst(35, 0.087, -3.0), wst(XT, 0.082, -3.5)],
    lines: {
      slat: [[1.0, 0.1], [XK, 0.12], [XT, 0.14]], spoil: [[1.0, 0.6], [XK, 0.62], [25, 0.64], [XT, 0.66]],
      flap: [[1.0, 0.71], [11.5, 0.71], [25, 0.73], [XT, 0.75]],
    },
    controls: [
      ...FLAPS.map((s, i) => ({ name: 'flap' + i, type: 'flap', span: s, from: 'flap', nose: 1 })),
      ...AILS.map((s, i) => ({ name: 'ail' + i, type: 'flap', span: s, from: 'flap', nose: 1 })),
      { name: 'droop', type: 'flap', span: [4.4, 11.8], to: 'slat', tail: 0.4, hingeDepth: 0.85 },
      { name: 'slat', type: 'flap', span: [SLATS[0], SLATS[SLATS.length - 1]], to: 'slat', tail: 0.4, cove: true },
      ...SPOILERS.map((s, i) => ({ name: 'sp' + i, type: 'panel', surface: 'upper', span: s, from: 'spoil', to: 'flap', hinge: 'front' })),
    ],
    charts: [{ from: 0, upper: cWT.i, lower: cWB.i }, { from: XK, upper: cWT.o, lower: cWB.o }], innerUV: UB.inner, edgeUV: UB.grey,
  });
  const W = { R: wingOf(1), L: wingOf(-1) };
  stB.add(W.R.mesh).add(W.L.mesh);
  // wingtip fences: arrow-shaped plates above and below the tip, starting ahead of the tip leading edge
  const tipY = wy(XT), tipZ = zLE(XT);
  for (const side of [1, -1]) {
    const up = K.wing({ airfoil: K.naca4('0007'), chordPts: 6, spanAxis: 'y', tip: 'flat', uv: UB.tip, edgeUV: UB.tip,
      stations: [{ x: XT + 0.02, y: tipY - 0.05, z: tipZ - 0.9, chord: 4.9, tc: 0.07 }, { x: XT + 0.12, y: tipY + 2.3, z: tipZ + 2.55, chord: 0.75, tc: 0.06 }] }).mesh;
    const dn = K.wing({ airfoil: K.naca4('0007'), chordPts: 6, spanAxis: 'y', tip: 'flat', uv: UB.tip, edgeUV: UB.tip,
      stations: [{ x: XT + 0.02, y: 0.05, z: tipZ - 0.9, chord: 3.3, tc: 0.07 }, { x: XT + 0.1, y: 1.4, z: tipZ + 1.5, chord: 0.6, tc: 0.06 }] }).mesh;
    dn.scale(1, -1, 1).translate(0, tipY, 0);
    if (side < 0) { stB.add(up.mirrorX()).add(dn.mirrorX()); } else stB.add(up).add(dn);
  }
  // flap-track fairings ("canoes"): front part fixed under the wing, rear part rides on the flap
  const canoeAt = (x, len, side, h) => {
    const zf = W.R.at(x, 0.71, 'lower'), z0 = zf[2] - len * 0.45, y = zf[1] - 0.06;
    const s = [[0, 0.01, 0.01], [0.12, 0.17, 0.22], [0.35, 0.26, 0.42], [0.6, 0.26, 0.45], [0.85, 0.17, 0.3], [1, 0.015, 0.03]].map(r => ({ z: z0 + r[0] * len, x: side * x, y: y - r[2] * h * 0.5 + (r[0] > 0.6 ? (r[0] - 0.6) * 0.4 : 0), w: r[1], top: r[2] * h * 0.6, bot: r[2] * h }));
    const split = zf[2] + 0.2;
    return { front: K.loft({ stations: s, segments: 12, step: 0.5, uv: UB.canoe, zRange: [z0, split] }).mesh, rear: K.loft({ stations: s, segments: 12, step: 0.5, uv: UB.canoe, zRange: [split, z0 + len], capStart: 'flat' }).mesh };
  };

  // ---- tail -------------------------------------------------------------------------------------------------------------------
  const sy = (x) => 0.6 + (x - 2.5) * Math.tan(6 * DEG), zLEs = (x) => 21.5 + (x - 2.5) * Math.tan(38 * DEG);
  const stabOf = (side) => K.wing({
    side, airfoil: K.naca4('0011'), chordPts: Math.round(12 * Math.min(1, detail)), spanAxis: 'x', tip: 'round', tipLength: 0.5,
    stations: [{ x: 0.8, y: sy(0.8), z: zLEs(0.8), chord: 11.6, tc: 0.11 }, { x: 15.2, y: sy(15.2), z: zLEs(15.2), chord: 3.5, tc: 0.09 }],
    lines: { hinge: [[0.8, 0.71], [15.2, 0.71]] },
    controls: [{ name: 'elevIn', type: 'flap', span: [3.2, 8.9], from: 'hinge', nose: 1 }, { name: 'elevOut', type: 'flap', span: [9.0, 14.9], from: 'hinge', nose: 1 }],
    charts: { upper: cSt, lower: cSt }, edgeUV: UB.grey,
  });
  const stab = { R: stabOf(1), L: stabOf(-1) };
  stB.add(stab.R.mesh).add(stab.L.mesh);
  const FIN_TOP = G.height - G.cgHeight, finLE = (y) => 14.5 + (y - 4.25) * 0.9;
  const fin = K.wing({
    airfoil: K.naca4('0011'), chordPts: Math.round(13 * Math.min(1, detail)), spanAxis: 'y', tip: 'round', tipLength: 0.4,
    stations: [{ x: 0, y: 2.6, z: finLE(2.6), chord: 18.0, tc: 0.11 }, { x: 0, y: FIN_TOP, z: finLE(FIN_TOP), chord: 5.5, tc: 0.09 }],
    lines: { hinge: [[2.6, 0.7], [FIN_TOP, 0.7]] },
    controls: [{ name: 'rudLo', type: 'flap', span: [4.6, 11.0], from: 'hinge', nose: 1 }, { name: 'rudUp', type: 'flap', span: [11.1, FIN_TOP - 0.35], from: 'hinge', nose: 1 }],
    charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.tail,
  });
  stB.add(fin.mesh);
  stB.add(K.wing({ airfoil: K.naca4('0008'), chordPts: 6, spanAxis: 'y', tip: 'flat', charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.tail,       // dorsal fillet
    stations: [{ x: 0, y: 3.9, z: 10.5, chord: 6.0, tc: 0.03 }, { x: 0, y: 5.3, z: finLE(5.3) - 0.2, chord: 2.6, tc: 0.07 }] }).mesh);

  // ---- engines ----------------------------------------------------------------------------------------------------------------
  const eng = [], sleeveAll = new K.Mesh();
  let sleeveTravel = 0;
  G.engines.forEach((ge) => {
    const c = ge.intake, inboard = Math.abs(c[0]) < 20, sx = Math.sign(c[0]);
    const n = K.nacelle({ centre: c, length: NAC.len, rHi: NAC.rHi, rMax: NAC.rMax, rThroat: NAC.rThroat, rFan: NAC.rFan, zFan: NAC.zFan, rExit: NAC.rExit, flat: 0, droop: 0.04, sleeve: NAC.sleeve,
      core: NAC.core, plug: NAC.plug, segments: Math.max(32, Math.round(52 * detail / 4) * 4),
      uv: UB.engine, uvLip: UB.lip, uvInner: UB.acoustic, uvSleeve: UB.engine, uvCore: UB.core, uvPlug: UB.plug, uvCascade: UB.cascade });
    stB.add(n.cowl).add(n.core).add(n.plug);
    if (inboard) { stB.add(n.cascade); const sl = n.sleeve.clone().enableMorph(); for (let k = 2; k < sl.p2.length; k += 3) sl.p2[k] += n.sleeveTravel; sleeveAll.add(sl); sleeveTravel = n.sleeveTravel; }
    else stB.add(n.sleeve);
    const L = NAC.len, rA = (z) => NAC.rHi + (NAC.rMax - NAC.rHi) * Math.sqrt(Math.min(1, z / (L * 0.3))) + 0.006;
    const rOut = (z) => (z < L * 0.4 ? rA(z) : NAC.rMax - (NAC.rMax - NAC.rExit) * Math.pow(Math.max(0, (z - L * 0.4) / (L * 0.6)), 1.6) + 0.006);
    // coloured intake band behind the polished lip, dark acoustic-liner rings in the inlet, panel seams on the cowl
    stB.add(K.lathe([[rA(0.2) - 0.006, 0.2], [rA(0.21), 0.21], [rA(0.62), 0.62], [rA(0.63) - 0.006, 0.63]], { segments: 52, uv: UB.band }).translate(c[0], c[1] - 0.04, c[2]));
    for (const z of [0.38, 0.62, 0.84]) stB.add(K.lathe([[NAC.rThroat - 0.004, z + 0.035], [NAC.rThroat - 0.004, z]], { segments: 40, uv: UB.duct }).occlude(0.4).translate(c[0], c[1] - 0.03, c[2]));
    for (const z of [1.25, inboard ? L * NAC.sleeve - 0.02 : L * NAC.sleeve + 0.02]) stB.add(K.lathe([[rOut(z), z], [rOut(z + 0.025), z + 0.025]], { segments: 48, uv: UB.seam }).translate(c[0], c[1] - (z < 1.4 ? 0.04 : 0.006), c[2]));
    const exitZ = c[2] + L, coreZ = exitZ + NAC.core.length;
    // heat-stained core nozzle ring, sooty band on the core cowl
    stB.add(K.lathe([[NAC.core.r1 + 0.07, coreZ - 0.6], [NAC.core.r1 + 0.03, coreZ + 0.01, 1], [NAC.core.r1, coreZ + 0.01, 1]], { segments: 36, uv: UB.hot }).translate(c[0], c[1], 0));
    stB.add(K.lathe([[NAC.core.r0 * 0.985 + 0.004, exitZ + 0.05], [NAC.core.r1 * 1.12 + 0.006, exitZ + NAC.core.length * 0.66]], { segments: 40, uv: UB.soot }).translate(c[0], c[1], 0));
    stB.add(K.fanBackdrop(NAC.rFan, 0.5, UB.duct).translate(c[0], c[1], n.fanZ));
    // short, thick pylon: strut over the nacelle into the wing, aft fairing under the wing
    const x = Math.abs(c[0]), yw = wy(x), zl = zLE(x);
    stB.add(K.pylon([{ y: c[1] + NAC.rMax - 0.12, z0: c[2] + 0.9, z1: c[2] + NAC.len + 1.6, x: c[0], tc: 0.13 }, { y: yw - 0.2, z0: Math.min(zl - 0.3, c[2] + 1.6), z1: zl + 4.6, x: c[0], tc: 0.1 }, { y: yw + 0.4, z0: zl + 0.3, z1: zl + 5.6, x: c[0], tc: 0.08 }], { uv: UB.pylon }));
    { const z0 = c[2] + NAC.len + 0.8, len = 6.2, yb = wy(x) - 0.75;
      const s = [[0, 0.02, 0.02], [0.15, 0.36, 0.32], [0.5, 0.42, 0.5], [0.85, 0.26, 0.34], [1, 0.02, 0.04]].map(r => ({ z: z0 + r[0] * len, x: c[0], y: yb + r[0] * 0.45, w: r[1], top: 0.7, bot: r[2] }));
      stB.add(K.loft({ stations: s, segments: 14, step: 0.6, uv: UB.pylon }).mesh); }
    stB.add(K.plate([c[0] - sx * 1.56, c[1] + 0.9, c[2] + 1.1], [c[0] - sx * 1.56, c[1] + 0.9, c[2] + 2.4], [c[0] - sx * 1.86, c[1] + 1.08, c[2] + 2.45], [c[0] - sx * 1.82, c[1] + 1.05, c[2] + 1.3], 0.015, UB.engine));   // inboard nacelle strake
    eng.push({ c, n, fanMesh: trentFan({ radius: NAC.rFan - 0.012, hub: 0.47, blades: 24, uvBlade: UB.blade, bladeStrip: SB.blade, uvSpinner: UB.spinner, uvSwirl: UB.swirl }) });
  });

  // ---- small details ----------------------------------------------------------------------------------------------------------
  for (const [z, h] of [[-24.0, 0.38], [-4.0, 0.38], [9.0, 0.36], [14.5, 0.3]]) stA.add(K.bladeAntenna({ pos: [0, fus.topAt(z) - 0.02, z], height: h, chord: 0.5, sweep: 0.22, uv: UA.antenna }));
  stA.add(K.ellipsoid(0.7, 0.22, 1.9, { segments: 16, rings: 6, uv: UA.dome }).translate(0, fus.topAt(-11) - 0.05, -11));      // satcom radome
  for (const z of [-19.6, -18.6]) stA.add(K.ellipsoid(0.13, 0.04, 0.16, { segments: 10, rings: 4, uv: UA.dome }).translate(0, fus.topAt(z) - 0.005, z));   // GPS antennas
  for (const z of [-20.0, 17.0]) stA.add(K.bladeAntenna({ pos: [0, fus.botAt(z) + 0.02, z], height: 0.32, chord: 0.45, sweep: 0.2, down: true, uv: UA.antenna }));
  for (const [z, x] of [[-22.6, 0.35], [-22.0, -0.35], [17.8, 0.3], [18.5, -0.3]]) stA.add(K.bladeAntenna({ pos: [x, fus.botAt(z) + 0.03, z], height: 0.14, chord: 0.12, sweep: 0.08, down: true, thickness: 0.02, uv: UA.steel }));   // drain masts
  for (const sx of [-1, 1]) {
    for (const [d, y] of [[2.6, -0.4], [3.0, -0.9], [3.3, 0.1]]) {        // pitot probes
      const z = zd(d), t = fus.tAtY(z, y), p = fus.at(z, sx > 0 ? t : 1 - t).p; stA.add(K.probe(p, [p[0] + sx * 0.16, p[1] - 0.01, p[2] - 0.24], 0.018, UA.steel));
    }
    for (const [d, y] of [[4.1, 0.15], [5.8, -1.2]]) {                    // angle-of-attack vanes with their base plates
      const z = zd(d), q = fus.at(z, sx > 0 ? fus.tAtY(z, y) : 1 - fus.tAtY(z, y)), p = q.p, n = q.n;
      const tip = [p[0] + n[0] * 0.13, p[1] + n[1] * 0.13 + 0.02, p[2] + 0.12];
      stA.add(K.plate(p, [p[0], p[1], p[2] + 0.07], [tip[0], tip[1], tip[2] + 0.03], [tip[0], tip[1], tip[2] - 0.05], 0.008, UA.vane));
      stA.add(K.ellipsoid(0.075, 0.075, 0.075, { segments: 10, rings: 3, uv: UA.vane, z0: 0, z1: 1 }).aim(n).translate(p[0] - n[0] * 0.06, p[1] - n[1] * 0.06, p[2] - n[2] * 0.06));
    }
  }
  { const z = zd(4.9), p = fus.at(z, 1 - fus.tAtY(z, -1.6)).p; stA.add(K.probe(p, [p[0] - 0.1, p[1] - 0.02, p[2] - 0.08], 0.022, UA.steel)); }   // TAT probe
  { const wicks = []; for (const sx of [-1, 1]) { for (const x of [31.0, 33.5, 36.0, 38.6]) { const p = W.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } for (const x of [10.0, 12.2, 14.4]) { const p = stab.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } } for (const y of [15.0, 17.2]) wicks.push(fin.at(y, 1, 'mid')); stB.add(K.staticWicks(wicks, 0.3, UB.wick)); }

  lap('geometry');
  // ---- paint + materials ------------------------------------------------------------------------------------------------------
  paintFuselage(A, { SC, fus, cFus, cOver, cPed, WIN: WIN.list });
  paintSurfaces(B, { SC, W: W.R, fin, stab: stab.R, cWT, cWB, cSt, cFin });
  lap('paint');
  const matA = A.material(ctx, { envMapIntensity: 1, emissiveIntensity: 0 }), matB = B.material(ctx, { envMapIntensity: 1, emissiveIntensity: 0 });
  lap('textures');
  rig.material('paint', matA, { shared: true }); rig.material('wing', matB, { shared: true });
  rig.glass('glass', K.glassMaterial(ctx, { ...K.GLASS.airliner, dust: 0.03 }));
  rig.disposables.push(A, B);

  // ---- moving surfaces --------------------------------------------------------------------------------------------------------
  const drop = (ctrl, d, aft = 0) => { const u = ctrl.up, h = ctrl.hinge, o = [-u[0] * d, -u[1] * d, -u[2] * d + aft]; return { a: [h.a[0] + o[0], h.a[1] + o[1], h.a[2] + o[2]], b: [h.b[0] + o[0], h.b[1] + o[1], h.b[2] + o[2]] }; };
  const DOWN = [0, -1, 0], UP = [0, 1, 0];
  // flaps of both wings (with the rear halves of their track fairings) and all leading-edge devices share one morph part each:
  // every panel follows its own Fowler / droop arc, sampled at a few points of the travel
  const flapGroups = [], leGroups = [], wingAnim = [];
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const C = W[key].controls;
    FLAPS.forEach(([x0, x1], i) => {
      const ctrl = C['flap' + i], mesh = ctrl.mesh.clone();
      for (const x of CANOES) if (x > x0 && x < x1) { const cn = canoeAt(x, 7.2 - x * 0.12, sx, 1.15 - x * 0.012); stB.add(cn.front); mesh.add(cn.rear); }
      const ln = drop(ctrl, [1.9, 1.5, 1.1][i], 0.15), ang = [32, 30, 28][i] * DEG;
      flapGroups.push({ mesh, pose: (f) => rotor(ln.a, ln.b, ctrl.ref, DOWN, ang * f) });
    });
    leGroups.push({ mesh: C.droop.mesh, pose: (f) => rotor(C.droop.hinge.a, C.droop.hinge.b, C.droop.ref, DOWN, 24 * DEG * f) });
    { const ln = drop(C.slat, 0.65, 0.22); leGroups.push({ mesh: C.slat.mesh, pose: (f) => rotor(ln.a, ln.b, C.slat.ref, DOWN, 23 * DEG * f) }); }
    const spGroups = []; for (let i = 0; i < SPOILERS.length; i++) { const c = C['sp' + i]; spGroups.push({ mesh: c.mesh, pose: (f) => rotor(c.hinge.a, c.hinge.b, c.ref, UP, 50 * DEG * f) }); }
    const spoil = morphPart(rig, 'spoilers' + key, spGroups, 2, 'wing');
    const ailMesh = K.merge(...AILS.map((_, i) => C['ail' + i].mesh));
    const ail = rig.hingePart('ailerons' + key, { ...C.ail0, hinge: { a: C.ail0.hinge.a, b: C.ail2.hinge.b } }, { key: 'wing', mesh: ailMesh }).set;
    const elev = rig.hingePart('elevator' + key, stab[key].controls.elevIn, { key: 'wing', mesh: K.merge(stab[key].controls.elevIn.mesh, stab[key].controls.elevOut.mesh) }).set;
    wingAnim.push({ key, spoil, ail, elev });
  }
  const setFlaps = morphPart(rig, 'flaps', flapGroups, 3, 'wing'), setSlats = morphPart(rig, 'slats', leGroups, 3, 'wing');
  const rud = rig.hingePart('rudder', fin.controls.rudLo, { key: 'wing', toward: [1, 0, 0], mesh: K.merge(fin.controls.rudLo.mesh, fin.controls.rudUp.mesh) });
  const fans = eng.map((e, i) => rig.part('fan' + i, e.fanMesh.translate(e.c[0], e.c[1], e.n.fanZ), { key: 'wing', pivot: [e.c[0], e.c[1], e.n.fanZ], ao: false }));
  const sleeves = rig.part('reversers', sleeveAll, { key: 'wing' });
  rig.addStatic(stB, 'wing');

  // ---- landing gear -----------------------------------------------------------------------------------------------------------
  const gp = G.gear;
  K.buildGear(rig, A, {
    name: 'nose', index: 0, contact: gp[0].pos, wheels: [-0.4, 0.4], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.38, pivot: [0, -3.35, -28.0], stroke: 0.42, staticFrac: 0.4,
    strutR: 0.14, steer: true, links: 'front', retract: { to: [0, -3.55, -29.95] }, window: [0.2, 0.88], brace: [0, -3.3, -29.6], uv: { strut: UA.strut, piston: UA.chrome, link: UA.link }, wheelSegments: 24,
    lamps: [{ kind: 'taxi', pos: [-0.17, -4.55, -28.62], size: 0.08, color: [1, 0.96, 0.9] }, { kind: 'taxi', pos: [0.17, -4.55, -28.62], size: 0.08, color: [1, 0.96, 0.9] }],
  });
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {          // wing gear: four-wheel bogie, swings inboard into the fairing
    bogieGear(rig, { name: 'wing' + key, index: i, side: sx, contact: gp[i].pos, R: gp[i].wheelRadius, wW: 0.5, pivot: [sx * 6.0, -2.75, 0.6], stow: [sx * 3.62, -3.0, 0.75],
      stroke: 0.5, staticFrac: 0.4, strutR: 0.22, axles: [-0.78, 0.78], track: 0.72, tilt: 9, window: [0.2, 0.88], uv: UA,
      brace: [sx * 4.4, -2.9, 0.9], drag: [sx * 6.1, -2.6, -1.6], legDoor: UA.fair, keepLevel: 0 });
  }
  for (const [i, sx, key] of [[3, -1, 'L'], [4, 1, 'R']]) {          // body gear: six-wheel bogie, swings forward into the belly, aft axle steers
    bogieGear(rig, { name: 'body' + key, index: i, side: sx, contact: gp[i].pos, R: gp[i].wheelRadius, wW: 0.5, pivot: [sx * 2.65, -3.1, 6.9], stow: [sx * 2.65, -3.25, 4.0],
      stroke: 0.5, staticFrac: 0.4, strutR: 0.22, axles: [-1.55, 0, 1.55], track: 0.72, tilt: 7, window: [0.2, 0.88], uv: UA, steerAft: true,
      brace: [sx * 1.4, -3.2, 6.4], drag: [sx * 2.65, -3.0, 8.4], legDoor: UA.fair, keepLevel: 1 });
  }
  // gear-bay doors: one morph part (each door follows its own swing); open while the gear travels, closed at both ends
  const doorGroups = [];
  const door = (patch, edge, deg) => { const ref = K.centroid(patch); doorGroups.push({ mesh: K.thicken(patch, 0.03, UA.well), pose: (f) => rotor(edge[0], edge[1], ref, DOWN, deg * DEG * f) }); };
  door(fus.patches.ngwR, fus.edges.ngwR.tHi, 88); door(fus.patches.ngwL, fus.edges.ngwL.tLo, 88);
  door(fair.patches.wgwR, fair.edges.wgwR.tLo, 95); door(fair.patches.wgwL, fair.edges.wgwL.tHi, 95);
  door(fair.patches.bgwR, fair.edges.bgwR.tHi, 92); door(fair.patches.bgwL, fair.edges.bgwL.tLo, 92);
  const setDoors = morphPart(rig, 'gearDoors', doorGroups, 3, 'paint');
  rig.addStatic(stA, 'paint');
  rig.addStatic(glaz.glass, 'glass');

  // ---- lamps ------------------------------------------------------------------------------------------------------------------
  const Lt = G.lights, fenceAft = [XT + 0.07, tipY + 0.55, tipZ + 3.35];
  rig.lamp('nav', Lt.navLeft, { color: [1, 0.04, 0.02], size: 0.15, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', Lt.navRight, { color: [0.02, 1, 0.25], size: 0.15, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', Lt.tail, { color: [1, 1, 1], size: 0.1 });
  for (const sx of [-1, 1]) rig.lamp('nav', [sx * fenceAft[0], fenceAft[1], fenceAft[2]], { color: [1, 1, 1], size: 0.08 });             // aft-facing white position lights on the fences
  const strobeTip = [Math.abs(Lt.navRight[0]) + 0.03, Lt.navRight[1] + 0.12, Lt.navRight[2] + 0.35];
  for (const sx of [-1, 1]) rig.lamp('strobe', [sx * strobeTip[0], strobeTip[1], strobeTip[2]], { color: [1, 1, 1], size: 0.1 });
  rig.lamp('strobe', Lt.strobe, { color: [1, 1, 1], size: 0.1 });
  const beaconTop = [0, fus.topAt(-6) + 0.05, -6];
  rig.lamp('beacon', beaconTop, { color: [1, 0.05, 0.03], size: 0.16, squash: [1, 0.6, 1] });
  rig.lamp('beacon', Lt.beacon, { color: [1, 0.05, 0.03], size: 0.16, squash: [1, 0.6, 1] });
  const landing = [-1, 1].map(sx => [sx * Math.abs(Lt.landing[0]), Lt.landing[1], Lt.landing[2]]);
  for (const p of landing) rig.lamp('landing', p, { color: [1, 0.97, 0.9], size: 0.2, squash: [1.4, 0.8, 0.5] });
  const turnoff = [-1, 1].map(sx => { const p = fair.at(-12.4, sx > 0 ? 0.2 : 0.8).p; return [p[0], p[1], p[2] - 0.05]; });
  for (const p of turnoff) rig.lamp('taxi', p, { color: [1, 0.97, 0.9], size: 0.1 });   // runway turn-off lights
  // logo lights on the stabiliser (lighting the fin) and wing-scan lights on the fuselage, on with the nav lights
  for (const sx of [-1, 1]) { const p = stab.R.at(5.5, 0.35, 'upper'); rig.lamp('formation', [sx * p[0], p[1] + 0.05, p[2]], { color: [1, 0.95, 0.85], size: 0.11 }); }
  for (const sx of [-1, 1]) { const z = -16.5, t = fus.tAtY(z, 0.4), p = fus.at(z, sx > 0 ? t : 1 - t).p; rig.lamp('formation', [p[0] + sx * 0.03, p[1], p[2]], { color: [1, 0.96, 0.9], size: 0.09 }); }

  // ---- night halos: soft additive sprites so the lamps read at chase distance -------------------------------------------------
  const HALO = [
    { p: [Lt.navLeft[0] - 0.08, Lt.navLeft[1], Lt.navLeft[2]], c: [1, 0.05, 0.03], k: 'nav', s: 2.8 }, { p: [Lt.navRight[0] + 0.08, Lt.navRight[1], Lt.navRight[2]], c: [0.05, 1, 0.3], k: 'nav', s: 2.8 },
    { p: [0, Lt.tail[1], Lt.tail[2] + 0.08], c: [1, 1, 1], k: 'nav', s: 1.8 }, ...[-1, 1].map(sx => ({ p: [sx * (fenceAft[0] + 0.05), fenceAft[1], fenceAft[2] + 0.05], c: [1, 1, 1], k: 'nav', s: 1.6 })),
    ...[-1, 1].map(sx => ({ p: [sx * (strobeTip[0] + 0.08), strobeTip[1], strobeTip[2]], c: [1, 1, 1], k: 'strobe', s: 4.8 })), { p: Lt.strobe, c: [1, 1, 1], k: 'strobe', s: 3.5 },
    { p: [0, beaconTop[1] + 0.08, beaconTop[2]], c: [1, 0.08, 0.04], k: 'beacon', s: 3.4 }, { p: [Lt.beacon[0], Lt.beacon[1] - 0.08, Lt.beacon[2]], c: [1, 0.08, 0.04], k: 'beacon', s: 3.4 },
    ...landing.map(p => ({ p: [p[0], p[1], p[2] - 0.12], c: [1, 0.95, 0.85], k: 'landing', s: 3.8 })), ...turnoff.map(p => ({ p: [p[0], p[1], p[2] - 0.08], c: [1, 0.95, 0.85], k: 'taxi', s: 2.2 })),
    { p: [0, -4.55, -28.75], c: [1, 0.95, 0.85], k: 'taxi', s: 2.8 },
  ];
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(HALO.flatMap((h) => h.p), 3));
  haloGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(HALO.length * 3).fill(0), 3));
  haloGeo.setAttribute('size', new THREE.Float32BufferAttribute(HALO.map((h) => h.s), 1));
  const haloMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, fog: false,
    vertexShader: 'attribute float size; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * 0.5 * projectionMatrix[1][1] * 360.0 / max(0.5, -mv.z), 2.0, 128.0); }',
    fragmentShader: 'varying vec3 vC; void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard; float a = exp(-r2 * 5.0) + 0.25 * exp(-r2 * 1.4) * (1.0 - r2); gl_FragColor = vec4(vC * a, 1.0); }',
  });
  const halo = new THREE.Points(haloGeo, haloMat); halo.name = 'halos'; halo.frustumCulled = false; halo.renderOrder = 6;
  const haloCol = haloGeo.attributes.color;

  // ---- animation --------------------------------------------------------------------------------------------------------------
  const fanAng = [0, 0, 0, 0];
  const flapK = [[0, 0], [0.1, 0], [0.3, 8 / 32], [0.55, 17 / 32], [0.78, 25 / 32], [1, 1]];
  rig.onUpdate((S, dt) => {
    const sf = S.sf, gnd = S.onGround ? 1 : 0;
    setFlaps(K.keys(flapK, sf.flaps));
    setSlats(Math.max(0, sf.slats));
    for (const a of wingAnim) {
      const R = a.key === 'R', ail = R ? sf.aileronR : sf.aileronL, sp = R ? sf.spoilerR : sf.spoilerL, el = R ? sf.elevatorR : sf.elevatorL;
      a.ail((ail * 22 - Math.min(1, sf.flaps * 3) * 5) * DEG);
      a.spoil(Math.min(1, Math.max(Math.max(0, sp), sf.speedbrake * (gnd ? 1 : 0.6))));
      a.elev((el > 0 ? el * 30 : el * 20) * DEG);
    }
    rud.set(sf.rudder * 30 * DEG);
    const g = sf.gear;
    setDoors(Math.min(K.seq(g, 0.02, 0.19), 1 - K.seq(g, 0.9, 0.99)));
    let rev = 0;
    for (let i = 0; i < 4; i++) {
      const e = S.eng[i] || {};
      fanAng[i] = (fanAng[i] + (e.n1 || 0) * 21 * dt) % TAU;
      fans[i].quaternion.set(0, 0, Math.sin(fanAng[i] / 2), Math.cos(fanAng[i] / 2));
      if (Math.abs(G.engines[i].intake[0]) < 20) rev = Math.max(rev, e.reverser || 0);
    }
    sleeves.morphTargetInfluences[0] = rev;
    matA.emissiveIntensity = S.night * 2.4;
    matB.emissiveIntensity = S.night * ((S.lights || {}).nav ? 0.4 : 0);
    const lt = S.lights || {}, nf = Math.max(0, Math.min(1, (S.night ?? 0) * 1.4 - 0.2));
    HALO.forEach((h, i) => {
      let on = 0;
      if (h.k === 'nav') on = lt.nav ? 1 : 0;
      else if (h.k === 'strobe') on = lt.strobe ? K.lampFlash('strobe', S.tLamp) : 0;
      else if (h.k === 'beacon') on = lt.beacon ? K.lampFlash('beacon', S.tLamp) : 0;
      else on = lt[h.k] && (h.k === 'landing' || g > 0.98) ? 1 : 0;
      const I = on * nf * 0.9; haloCol.setXYZ(i, h.c[0] * I, h.c[1] * I, h.c[2] * I);
    });
    haloCol.needsUpdate = true; halo.visible = nf > 0.01;
  });
  const visual = rig.build();
  visual.object3D.add(halo);
  rig.disposables.push(haloGeo, haloMat);
  lap('rig'); visual.stats.phases = lap.out; visual.stats.sleeveTravel = sleeveTravel;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

/** Ring parameter on the upper half (right side) where the body's half-width is x at station z. */
function tAtXOf(f, z, x) { let lo = 0.25, hi = 0.5; for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (f.at(z, m).p[0] > x) lo = m; else hi = m; } return (lo + hi) / 2; }

/** Flight-deck window corners (z, t) on the right side: windshield WS, side window S1, sliding window S2 (five corners). */
function flightDeckWindows(f) {
  const zy = (d, y) => [D(d), f.tAtY(D(d), y)], zx = (d, x) => [D(d), tAtXOf(f, D(d), x)];
  const WS = { IB: zx(2.85, 0.08), OB: zy(3.25, 1.22), OT: zy(4.55, 2.0), IT: zx(4.35, 0.08) };
  const S1 = { bf: zy(3.38, 1.22), br: zy(4.95, 1.25), tr: zy(4.95, 1.98), tf: zy(4.66, 2.0) };
  const S2 = { bf: zy(5.05, 1.26), br: zy(5.9, 1.29), rt: zy(5.9, 1.72), nt: zy(5.68, 1.92), tf: zy(5.05, 1.97) };
  return { WS, S1, S2, list: [[WS.IB, WS.OB, WS.OT, WS.IT], [S1.bf, S1.br, S1.tr, S1.tf], [S2.bf, S2.br, S2.rt, S2.nt, S2.tf]] };
}

// ---- bogie main gear: oleo leg hinged in the airframe, tilting bogie beam, one spinning wheel pair per axle ------------------
// o: { name, index, side, contact, R, wW, pivot, stow (stowed bogie-centre position), stroke, staticFrac, strutR, axles: [z offsets],
//      track (wheel x offset from the beam), tilt (deg, toe-up when hanging), window, uv, brace, drag, legDoor, keepLevel (1: the
//      bogie counter-rotates during retraction and stows level), steerAft (the aft axle steers against the nose wheel) }
function bogieGear(rig, o) {
  const ctx = rig.ctx, V = (a) => new THREE.Vector3(a[0], a[1], a[2]), Ar = (v) => [v.x, v.y, v.z], UA = o.uv;
  const P = V(o.pivot), R = o.R, wW = o.wW, stroke = o.stroke, eStatic = stroke * (1 - o.staticFrac);
  const contact = V(o.contact), C = contact.clone().add(new THREE.Vector3(0, R, 0));
  const d = C.clone().sub(P), Lp = d.length(); d.normalize();
  const Lo = Math.max(0.6, Lp - (eStatic + 0.55)), Bt = P.clone().addScaledVector(d, Lo), sr = o.strutR;
  const v1 = d.clone(), v2 = V(o.stow).sub(P).normalize(), rAxis = new THREE.Vector3().crossVectors(v1, v2).normalize(), rAngle = Math.acos(Math.min(1, Math.max(-1, v1.dot(v2))));
  const leg = rig.node(o.name + '.leg', { pivot: Ar(P) });
  const sm = new K.Mesh(), side = new THREE.Vector3(o.side, 0, 0);
  sm.add(K.tube(Ar(P.clone().addScaledVector(d, -0.15)), Ar(Bt), sr, sr * 0.95, { segments: 16, uv: UA.strut }));
  sm.add(K.tube(Ar(Bt.clone().addScaledVector(d, -0.12)), Ar(Bt.clone().addScaledVector(d, 0.02)), sr * 1.15, sr * 1.15, { segments: 16, uv: UA.strut }));
  sm.add(K.tube(Ar(P.clone().addScaledVector(rAxis, -0.5)), Ar(P.clone().addScaledVector(rAxis, 0.5)), sr * 0.8, sr * 0.8, { segments: 12, uv: UA.strut }));
  for (const f of [0.3, 0.72]) sm.add(K.tube(Ar(P.clone().addScaledVector(d, Lo * f - 0.02)), Ar(P.clone().addScaledVector(d, Lo * f + 0.02)), sr * 1.08, sr * 1.08, { segments: 16, uv: UA.link }));
  for (const [end, r] of [[o.brace, 0.08], [o.drag, 0.09]]) {
    const b0 = P.clone().addScaledVector(d, Lo * 0.6), b1 = V(end), mid = b0.clone().lerp(b1, 0.5).addScaledVector(d, 0.1);
    sm.add(K.tube(Ar(b0), Ar(mid), r, r, { segments: 8, uv: UA.link })).add(K.tube(Ar(mid), Ar(b1), r * 0.9, r * 0.9, { segments: 8, uv: UA.link }));
    sm.add(K.ellipsoid(r * 1.5, r * 1.5, r * 1.5, { segments: 8, rings: 4, uv: UA.link }).translate(mid.x, mid.y, mid.z));
  }
  { // brake and hydraulic lines down the aft face of the strut
    const aft = new THREE.Vector3(0, 0, 1).addScaledVector(d, -d.z).normalize();
    for (const [k, r] of [[-0.45, 0.016], [-0.15, 0.012], [0.2, 0.014], [0.5, 0.011]]) {
      const off = aft.clone().addScaledVector(side, k).normalize().multiplyScalar(sr + r * 1.8);
      const q = (f, lift = 0) => Ar(P.clone().addScaledVector(d, Lo * f).add(off).addScaledVector(off, lift));
      sm.add(K.pipe([q(0.04, 0.6), q(0.1), q(0.5), q(0.92), q(1.0, 0.5)], r, { segments: 5, uv: UA.hose }));
    }
  }
  { // leg door on the outboard face of the strut
    const out = side.clone().addScaledVector(d, -d.x * o.side).normalize().multiplyScalar(sr + 0.08), fw = new THREE.Vector3(0, 0, -1).addScaledVector(d, d.z).normalize();
    const q = (s, f) => Ar(P.clone().addScaledVector(d, s).add(out).addScaledVector(fw, f));
    sm.add(K.plate(q(-0.1, 0.7), q(-0.1, -0.6), q(Lo * 0.95, -0.55), q(Lo * 0.95, 0.62), 0.03, o.legDoor));
  }
  rig.part(o.name + '.strut', sm, { parent: leg, pivot: Ar(P), ao: false });
  const pm = new K.Mesh(), yoke = C.clone().addScaledVector(d, -0.25);
  pm.add(K.tube(Ar(Bt.clone().addScaledVector(d, -(stroke + 0.1))), Ar(yoke), sr * 0.62, sr * 0.62, { segments: 14, uv: UA.chrome }));
  pm.add(K.tube(Ar(yoke), Ar(C), sr * 0.75, sr * 0.55, { segments: 12, uv: UA.strut }));
  pm.add(K.tube([C.x - 0.26, C.y, C.z], [C.x + 0.26, C.y, C.z], 0.11, 0.11, { segments: 10, uv: UA.link }));
  { const s0 = Bt.clone().add(new THREE.Vector3(0, 0, -sr * 1.1)), s1 = yoke.clone().add(new THREE.Vector3(0, 0, -sr * 0.8)), apex = s0.clone().lerp(s1, 0.5).add(new THREE.Vector3(0, 0, -0.3));
    pm.add(K.tube(Ar(s1), Ar(apex), 0.04, 0.035, { segments: 6, uv: UA.link })); sm.add(K.tube(Ar(s0), Ar(apex), 0.04, 0.035, { segments: 6, uv: UA.link })); }
  const piston = rig.part(o.name + '.piston', pm, { parent: leg, pivot: Ar(C), ao: false });
  const axz = o.axles, tr = o.track, bm = new K.Mesh(), zMin = Math.min(...axz), zMax = Math.max(...axz);
  bm.add(K.tube([C.x, C.y + 0.03, C.z + zMin - 0.34], [C.x, C.y + 0.03, C.z + zMax + 0.34], 0.14, 0.14, { segments: 12, uv: UA.strut }));
  for (const z of axz) {
    if (!(o.steerAft && z === zMax)) bm.add(K.tube([C.x - tr - wW * 0.3, C.y, C.z + z], [C.x + tr + wW * 0.3, C.y, C.z + z], 0.09, 0.09, { segments: 10, uv: UA.link }));
    if (z !== 0) for (const s of [-1, 1]) bm.add(K.tube([C.x + s * 0.13, C.y + 0.13, C.z + z * 0.45], [C.x + s * 0.13, C.y + 0.05, C.z + z * 0.95], 0.03, 0.03, { segments: 5, uv: UA.link }));
  }
  bm.add(K.tube([C.x + 0.2, C.y + 0.75, C.z - 0.15], [C.x + 0.2, C.y + 0.12, C.z + zMin * 0.7], 0.045, 0.04, { segments: 6, uv: UA.chrome }));   // bogie pitch trimmer
  if (o.steerAft) bm.add(K.tube([C.x - 0.24, C.y + 0.1, C.z + zMax - 0.5], [C.x - 0.1, C.y + 0.08, C.z + zMax - 0.05], 0.04, 0.035, { segments: 6, uv: UA.chrome }));   // steering actuator
  const bogie = rig.part(o.name + '.bogie', bm, { parent: piston, pivot: Ar(C), ao: false });
  const rb = R * 0.56 * 0.72;
  const wheelSet = (z, axle) => {
    const m = new K.Mesh();
    for (const x of [-tr, tr]) {
      const w = K.wheel({ radius: R, width: wW, uvTyre: UA.tyre, uvHub: UA.hub, segments: 22, tyreStrip: UA.tyreStrip, hubStrip: UA.hubStrip });
      const sg = -Math.sign(x), x0 = sg * wW * 0.28, x1 = sg * (tr - 0.14);                       // carbon brake stack on the beam side
      w.add(K.lathe([[rb * 0.45, 0], [rb, 0, 1], [rb, Math.abs(x1 - x0) * 0.75], [rb * 0.8, Math.abs(x1 - x0), 1], [rb * 0.45, Math.abs(x1 - x0)]], { segments: 14, uv: UA.brake }).rotateY(sg * Math.PI / 2).translate(x0, 0, 0));
      m.add(w.translate(C.x + x, C.y, C.z + z));
    }
    if (axle) m.add(K.tube([C.x - tr - wW * 0.3, C.y, C.z + z], [C.x + tr + wW * 0.3, C.y, C.z + z], 0.09, 0.09, { segments: 10, uv: UA.link }));
    return m;
  };
  let yaw = null;
  const wheels = axz.map((z, k) => {
    let parent = bogie;
    if (o.steerAft && z === zMax) { yaw = rig.node(o.name + '.yaw', { parent: bogie, pivot: [C.x, C.y, C.z + z] }); parent = yaw; }
    return rig.part(o.name + '.wheel' + k, wheelSet(z, o.steerAft && z === zMax), { parent, pivot: [C.x, C.y, C.z + z], ao: false });
  });
  const win = o.window, X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), q = new THREE.Quaternion(), qa = new THREE.Quaternion(), qt = new THREE.Quaternion();
  const rest = piston.position.clone();
  let ext = eStatic, spin = 0, rate = 0, first = true;
  rig.onUpdate((S, dt) => {
    const g = S.sf.gear, down = K.seq(g, win[0], win[1]);
    leg.visible = g > 0.012;
    if (!leg.visible) return;
    leg.quaternion.setFromAxisAngle(rAxis, rAngle * (1 - down));
    const gs = S.gear[o.index] || {}, st = S.raw; let target;
    if (gs.onGround && g > 0.98 && ctx?.world?.groundHeightAt && st && st.position && st.quaternion) {
      tmp.copy(contact).applyQuaternion(st.quaternion).add(st.position);
      tmp2.copy(d).applyQuaternion(st.quaternion);
      target = eStatic + (ctx.world.groundHeightAt(tmp.x, tmp.z) - tmp.y) / Math.min(-0.3, tmp2.y);
    } else if (S.hasGearState) target = gs.onGround ? stroke * (1 - gs.compression) : stroke;
    else target = S.onGround ? eStatic : stroke;
    target = Math.min(stroke, Math.max(0, target));
    ext = first || dt <= 0 ? target : ext + (target - ext) * (1 - Math.exp(-30 * dt)); first = false;
    const off = ext - eStatic;
    piston.position.set(rest.x + d.x * off, rest.y + d.y * off, rest.z + d.z * off);
    // toe-up tilt when the oleo hangs extended, level when compressed; optional counter-rotation so the bogie stows level
    const tilt = o.tilt * DEG * K.seq(ext, eStatic + 0.03, stroke - 0.01) * (0.4 + 0.6 * down);
    qt.setFromAxisAngle(X, tilt);
    if (o.keepLevel) { qa.setFromAxisAngle(rAxis, -rAngle * (1 - down)); bogie.quaternion.multiplyQuaternions(qa, qt); } else bogie.quaternion.copy(qt);
    if (yaw) {                                    // aft axle steers against the nose wheel in tight turns
      const ns = (S.gear[0] && S.gear[0].steer) || 0, rs = gs.onGround ? -Math.max(-15 * DEG, Math.min(15 * DEG, ns * 0.5)) * K.seq(Math.abs(ns), 0.1, 0.3) : 0;
      yaw.quaternion.setFromAxisAngle(Y, rs);
    }
    if (gs.onGround) rate = isNaN(gs.wheelSpeed) ? S.groundSpeed / R : gs.wheelSpeed; else if (!isNaN(gs.wheelSpeed) && gs.wheelSpeed !== 0) rate = gs.wheelSpeed; else rate *= Math.exp(-0.6 * dt);
    spin = (spin - rate * dt) % TAU;
    q.setFromAxisAngle(X, spin); for (const w of wheels) w.quaternion.copy(q);
  });
}

// ---- paint: fuselage atlas ---------------------------------------------------------------------------------------------------
function paintFuselage(A, o) {
  const { SC, fus, cFus, cOver, cPed, WIN } = o, F = K.FINISH;
  const P = A.pen(cFus), body = F.gloss(SC.body), belly = F.gloss(SC.belly), cheat = F.gloss(SC.cheat), accent = F.gloss(SC.accent);
  const font = SC.font === 'serif' ? K.FONT.serif : SC.font === 'round' ? K.FONT.round : K.FONT.wide, Z0 = -37.6, Z1 = 35.3;
  P.fill('all', body);
  // --- livery ---
  if (SC.style === 'cheat') {            // grey belly; broad blue band between the decks sweeping up the tail cone, gold pinstripe
    P.band(Z0, Z1, -Infinity, (z) => -2.55 + Math.max(0, z - 14) * 0.1, belly, { step: 0.4, feather: 2 });
    const lo = (z) => 0.05 + Math.max(0, z - 10) * 0.075 + Math.pow(Math.max(0, z - 22) / 13, 2) * 0.6, hi = (z) => 1.05 + Math.max(0, z - 10) * 0.075 + Math.pow(Math.max(0, z - 22) / 13, 2) * 0.6;
    const k = (z) => Math.pow(Math.min(1, Math.max(0, (z + 33.5) / 6.5)), 0.8);         // the band tapers to a point toward the nose
    P.band(-33.5, Z1, (z) => (lo(z) + hi(z)) / 2 - (hi(z) - lo(z)) / 2 * k(z), (z) => (lo(z) + hi(z)) / 2 + (hi(z) - lo(z)) / 2 * k(z), cheat, { step: 0.25 });
    P.band(-32.0, Z1, (z) => lo(z) - 0.2 * k(z + 1.5), (z) => lo(z) - 0.1 * k(z + 1.5), accent, { step: 0.25 });
    P.textOn(SC.title, -12.0, 3.25, 'both', 1.05, { color: SC.titleColor, font, weight: 700, spacing: 0.16 });
    P.decalOn(-21.4, 3.2, 'both', (g) => drawStarMark(g, 0.62, SC.accent, SC.cheat));
  } else if (SC.style === 'sweep') {     // deep teal belly sweeping up the aft fuselage into the tail, coral pin line
    const edge = (z) => (z < 4 ? -1.95 + (z + 37.5) * 0.004 : -1.78 + Math.pow((z - 4) / 31, 2.0) * 6.2);
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.32, accent, { step: 0.25 });
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.16, body, { step: 0.25 });
    P.band(Z0, Z1, -Infinity, edge, belly, { step: 0.25 });
    P.textOn(SC.title, -12.5, 3.2, 'both', 1.35, { color: SC.titleColor, font, weight: 700 });
    P.decalOn(-22.6, 3.25, 'both', (g, layer, side) => drawLeaf(g, 0.8, SC.accent, side === 'R'));
  } else {                               // house: grey belly, a blue stripe pair between the decks, big titles
    P.band(Z0, Z1, -Infinity, -2.4, belly, { step: 0.5 });
    P.band(-33.0, Z1, (z) => 0.35 + Math.max(0, z - 18) * 0.08, (z) => 0.75 + Math.max(0, z - 18) * 0.08, cheat, { step: 0.4 });
    P.band(-33.0, Z1, (z) => 0.95 + Math.max(0, z - 18) * 0.08, (z) => 1.05 + Math.max(0, z - 18) * 0.08, F.gloss(SC.accent), { step: 0.4 });
    P.textOn(SC.title, -13.0, 3.25, 'both', 0.95, { color: SC.titleColor, font, weight: 700, spacing: 0.16 });
    P.textOn('A380', 13.5, 3.15, 'both', 0.95, { color: SC.cheat, font: K.FONT.wide, weight: 700, spacing: 0.08 });
  }
  P.textOn(SC.reg, 24.0, 0.5, 'both', 0.5, { color: SC.style === 'sweep' ? '#ffffff' : SC.style === 'cheat' ? SC.cheat : '#1d2126', font: K.FONT.sans, weight: 700 });
  P.textOn('A380-800', D(9.6), 1.75, 'both', 0.16, { color: SC.style === 'house' ? SC.cheat : '#80868c', font: K.FONT.wide, weight: 700, spacing: 0.06 });
  // radome joint, lightning-diverter strips, nose access panels
  P.ring(D(2.9), 0, 1, { px: 1.4, depth: 0.5, dark: 0.25 });
  for (const t of [0.1, 0.22, 0.34, 0.66, 0.78, 0.9]) P.line([[D(0.6), t], [D(2.85), t]], { px: 1, depth: 0.15, dark: 0.07 });
  P.ring(D(0.9), 0, 1, { px: 1, depth: 0.3, dark: 0.08 });
  // --- flight-deck windows: dark seal around each opening (the openings themselves are cut out and glazed) ---
  for (const s of [1, -1]) {
    const m = (p) => [p[0], s > 0 ? p[1] : 1 - p[1]];
    for (const w of WIN) {
      const pts = w.map(m), path = (g) => { pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      P.stroke(path, 0, { color: '#2a2c30', rough: 0.45, metal: 0 }, { join: 'round', px: 1.4 });
      P.groove(path, { px: 1.0, depth: 0.5, dark: 0.12 });
    }
  }
  P.fill([[WIN[0][0][0], WIN[0][0][1]], [WIN[0][3][0], WIN[0][3][1]], [WIN[0][3][0], 1 - WIN[0][3][1]], [WIN[0][0][0], 1 - WIN[0][0][1]]], { color: '#2a2c30', rough: 0.45, metal: 0 });   // centre post
  // --- cabin windows, doors, hatches ---
  const mainDoors = [8.5, 18.5, 33, 52, 62].map(D), upDoors = [12, 36, 58].map(D);
  const frame = SC.style === 'house' ? '#d5d9dc' : '#c4c8cb';
  const zm = []; for (let z = D(9.6); z < D(66.5); z += 0.53) if (mainDoors.every(dz => Math.abs(z - dz) > 0.95)) zm.push(z);
  P.windows(zm, -0.85, { w: 0.27, h: 0.4, r: 0.11, frame });
  const zu = []; for (let z = D(10.6); z < D(63.0); z += 0.53) if (upDoors.every(dz => Math.abs(z - dz) > 0.95)) zu.push(z);
  P.windows(zu, 2.3, { w: 0.26, h: 0.38, r: 0.11, frame, seed: 77 });
  // passenger doors: rounded outline groove, the door window, handle recess with a red arming placard, door number, slide seam
  const doorR = (zc, y0, y1, label, deck) => {
    const ym = (y0 + y1) / 2, w = 1.07, h = y1 - y0;
    P.decalOn(zc, ym, 'both', { layers: ['height', 'color'] }, (g, layer) => {
      g.lineWidth = 0.03; g.strokeStyle = layer === 'height' ? 'rgba(0,0,0,0.6)' : 'rgba(12,14,16,0.34)';
      g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, 0.2); g.stroke();
    });
    P.windows([zc], ym + h * 0.18, { w: 0.2, h: 0.25, r: 0.08, lit: 0 });
    P.decalOn(zc + 0.2, ym - h * 0.08, 'both', (g) => { g.fillStyle = '#5a5e62'; g.fillRect(-0.09, -0.035, 0.18, 0.07); g.fillStyle = '#b8231c'; g.fillRect(-0.06, 0.06, 0.12, 0.045); g.fillStyle = '#e8e8e8'; g.fillRect(-0.045, 0.075, 0.09, 0.012); });
    for (const side of ['L', 'R']) P.textOn(label + side, zc - 0.25, y1 + 0.12, side, 0.085, { color: deck === 'U' && SC.style === 'cheat' ? '#d8dbe8' : '#6f757b', font: K.FONT.sans, weight: 700 });
    P.yLine(zc - 0.5, zc + 0.5, y0 - 0.18, { px: 1, depth: 0.3, dark: 0.07 });
  };
  mainDoors.forEach((dz, i) => doorR(dz, -1.95, 0.0, 'M' + (i + 1), 'M'));
  upDoors.forEach((dz, i) => doorR(dz, 1.3, 3.2, 'U' + (i + 1), 'U'));
  const dr = { px: 1.3, depth: 0.6, dark: 0.3 };
  P.doorOn(D(18.0), D(21.0), -3.55, -2.1, { ...dr, side: 'R' }); P.doorOn(D(53.0), D(56.0), -3.45, -2.05, { ...dr, side: 'R' }); P.doorOn(D(59.6), D(60.8), -3.1, -2.1, { ...dr, side: 'R' });   // cargo doors
  P.doorOn(D(2.4), D(3.1), -2.9, -2.3, { px: 1, depth: 0.4, dark: 0.12, side: 'L' });                                                                // avionics access
  // skin joints: circumferential every ~1.6 m with a faint rivet row, lap joints above / below the window rows
  for (let z = -34.0; z < 34.6; z += 1.6) P.ring(z, 0, 1, { px: 1, depth: 0.3, dark: 0.06 });
  const lapY = (y) => (z) => Math.min(fus.topAt(z) - 0.3, Math.max(fus.botAt(z) + 0.25, y + Math.max(0, z - 18) * 0.06));
  for (const y of [3.15, 1.35, -0.1, -1.7, -3.0]) { P.yLine(-33.5, 33.5, lapY(y), { px: 1, depth: 0.3, dark: 0.06 }); P.yLine(-33.5, 33.5, lapY(y + 0.06), { px: 1, depth: 0.12, dark: 0.02 }); }
  P.line([[-34.5, 0.5], [35.0, 0.5]], { px: 1, depth: 0.22, dark: 0.04 });
  for (const y of [1.35, -1.7]) for (let z = -30; z < 30; z += 4) for (const side of [0, 1]) {    // rivet rows along the window-belt lap joints
    const ta = fus.tAtY(z, lapY(y + 0.09)(z)), tb = fus.tAtY(z + 4, lapY(y + 0.09)(z + 4));
    P.rivets(z, side ? 1 - ta : ta, z + 4, side ? 1 - tb : tb, 0.09, { px: 1, depth: 0.12, dark: 0.03 });
  }
  // static ports, outflow valves, APU door, stencils
  P.decalOn(D(4.5), -0.9, 'both', (g) => { g.fillStyle = '#a1a6aa'; g.beginPath(); g.arc(0, 0, 0.09, 0, TAU); g.fill(); g.strokeStyle = '#c42a1e'; g.lineWidth = 0.014; g.strokeRect(-0.18, -0.13, 0.36, 0.26); });
  P.decalOn(D(6.6), -1.5, 'both', (g) => { g.fillStyle = '#a1a6aa'; g.beginPath(); g.arc(0, 0, 0.07, 0, TAU); g.fill(); g.strokeStyle = '#c42a1e'; g.lineWidth = 0.012; g.strokeRect(-0.15, -0.11, 0.3, 0.22); });
  P.decalOn(31.5, 0.4, 'R', (g) => { g.fillStyle = '#3a3d40'; g.fillRect(-0.4, -0.15, 0.8, 0.3); g.strokeStyle = '#8b9095'; g.lineWidth = 0.02; g.strokeRect(-0.43, -0.18, 0.86, 0.36); });
  for (const z of [-17.5, 18.0]) P.decalOn(z, -3.3, 'L', (g) => { g.fillStyle = '#5a5e62'; g.beginPath(); g.roundRect(-0.38, -0.12, 0.76, 0.24, 0.1); g.fill(); g.strokeStyle = 'rgba(20,20,22,0.5)'; g.lineWidth = 0.012; for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * 0.12, -0.1); g.lineTo(i * 0.12, 0.1); g.stroke(); } });   // outflow valves
  P.textOn('NO STEP', D(4.4), -2.4, 'both', 0.05, { color: '#c42a1e', font: K.FONT.sans, weight: 700 });
  P.textOn('RESCUE', D(8.5) + 0.75, -0.6, 'both', 0.05, { color: '#c42a1e', font: K.FONT.sans, weight: 700 });
  for (const z of [-25.5, -21.0]) P.textOn('GROUND POWER', z, -3.3, 'R', 0.04, { color: '#4a4f54', font: K.FONT.sans, weight: 700 });
  // grime: belly streaks from the drain masts and gear bays, APU soot, nose-gear spray, general weathering
  const rnd = (() => { let a = 11; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  for (let i = 0; i < 46; i++) { const z = -16 + rnd() * 46, t = rnd() < 0.5 ? rnd() * 0.07 : 1 - rnd() * 0.07; P.streak(z, t, z + 1 + rnd() * 3, t, 0.004 + rnd() * 0.01, { alpha: 0.05 + rnd() * 0.08 }); }
  for (const z0 of [-22.4, 17.9]) for (let k = 0; k < 4; k++) P.streak(z0, 0.004 + k * 0.004, z0 + 3 + k * 1.3, 0.003 + k * 0.006, 0.006, { alpha: 0.12 - k * 0.02 });
  for (const s of [1, -1]) for (let k = 0; k < 6; k++) { const t = s > 0 ? 0.05 + k * 0.01 : 0.95 - k * 0.01; P.streak(7.6, t, 12 + k * 1.5, t + s * 0.008, 0.01, { alpha: 0.07 }); }
  P.streak(-30.8, 0.02, -24, 0.03, 0.12, { alpha: 0.08 }); P.streak(-30.8, 0.98, -24, 0.97, 0.12, { alpha: 0.08 });
  for (let i = 0; i < 10; i++) { const z = 31 + rnd() * 3.5; P.streak(z, 0.6 + rnd() * 0.04, z + 1.4, 0.58 + rnd() * 0.04, 0.012, { alpha: 0.08 }); }
  P.noise({ alpha: 0.028, scale: 4, stretch: [2, 1] });
  P.noise({ alpha: 0.02, scale: 12, stretch: [2, 1] });
  // --- flight-deck panels: overhead, pedestal ---
  {
    const Q = A.pen(cOver); Q.fill('all', { color: '#69717a', rough: 0.7, metal: 0 });
    for (let j = 0; j < 9; j++) for (let i = 0; i < 7; i++) Q.fill((g) => g.rect(0.05 + i * 0.105, 0.04 + j * 0.105, 0.075, 0.075), { color: (i + j * 2) % 5 ? '#4a5057' : '#24272b', rough: 0.6, metal: 0, emissive: (i * 3 + j) % 7 === 0 ? '#1c1403' : undefined });
    for (let j = 0; j < 9; j++) Q.fill((g) => g.rect(0.02, 0.08 + j * 0.105, 0.76, 0.004), { color: '#e2e2dc', rough: 0.6, metal: 0 });
  }
  {
    const Q = A.pen(cPed); Q.fill('all', { color: '#5d646c', rough: 0.7, metal: 0 });
    for (const b of [0.34, 0.54]) for (const a of [0.04, 0.21]) { Q.fill((g) => g.rect(a, b, 0.15, 0.14), { color: '#0b0c0d', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(a + 0.015, b + 0.015, 0.12, 0.06), { color: '#0d1a12', rough: 0.2, metal: 0, emissive: '#0d2414' }); }
    Q.fill((g) => g.rect(0.06, 0.03, 0.28, 0.25), { color: '#2b2e32', rough: 0.6, metal: 0 });
    for (let k = 0; k < 4; k++) Q.fill((g) => g.rect(0.095 + k * 0.07, 0.07, 0.018, 0.18), { color: '#0c0d0e', rough: 0.5, metal: 0 });
  }
}

// ---- paint: wings, tail -------------------------------------------------------------------------------------------------------
function paintSurfaces(B, o) {
  const { SC, W, fin, stab, cWT, cWB, cSt, cFin } = o, F = K.FINISH;
  const grey = F.semigloss('#babfc4'), dgrey = F.semigloss('#a6acb1'), white = F.gloss('#e4e7e9'), metal = { color: '#c6cacd', rough: 0.34, metal: 0.55 };
  const line = { px: 1, depth: 0.35, dark: 0.11 }, gap = { px: 1.8, depth: 0.8, dark: 0.45 };
  const at = (x, f) => { const p = W.at(x, f); return [p[0], p[2]]; };
  const Ln = (name, x) => W.lines[name].at(W.spanToU(x));
  const pl = (name, x0, x1) => { const pts = []; for (let x = x0; x < x1; x += 1.5) pts.push(at(x, Ln(name, x))); pts.push(at(x1, Ln(name, x1))); return pts; };
  for (const [chart, top] of [[cWT.i, true], [cWT.o, true], [cWB.i, false], [cWB.o, false]]) {
    const Q = B.pen(chart); Q.fill('all', top ? grey : white);
    if (top) Q.fill([...pl('slat', 3.8, 39.4).map(p => [p[0], p[1] + 0.25]), ...pl('spoil', 3.8, 39.4).reverse().map(p => [p[0], p[1] - 0.15])], dgrey);   // wing box: darker grey
    { const pts = []; for (let x = 3.8; x < XT; x += 1.5) pts.push(at(x, 0)); pts.push(at(XT, 0)); for (let x = XT; x > 3.8; x -= 1.5) pts.push(at(x, 0.016)); pts.push(at(3.8, 0.016)); Q.fill(pts, metal); }   // polished leading edge
    // leading-edge devices
    Q.line(pl('slat', 4.4, 11.8), gap); Q.line(pl('slat', SLATS[0], SLATS[SLATS.length - 1]), gap);
    for (const x of [4.4, 7.0, 9.4, 11.8, ...SLATS]) Q.line([at(x, 0), at(x, Ln('slat', x))], gap);
    // spoilers, flaps, ailerons
    if (top) for (const [x0, x1] of SPOILERS) Q.line([at(x0, Ln('spoil', x0)), at(x1, Ln('spoil', x1)), at(x1, Ln('flap', x1)), at(x0, Ln('flap', x0)), at(x0, Ln('spoil', x0))], gap);
    for (const [x0, x1] of [...FLAPS, ...AILS]) { Q.line(pl('flap', x0, x1), gap); Q.line([at(x0, Ln('flap', x0)), at(x0, 1)], gap); Q.line([at(x1, Ln('flap', x1)), at(x1, 1)], gap); }
    for (const f of [0.2, 0.32, 0.46]) Q.line([at(3.8, f), at(11.5, f), at(XK, f), at(25, f), at(39.6, f)], line);
    for (let x = 4.6; x < 39.5; x += 1.4) Q.line([at(x, Ln('slat', x) + 0.01), at(x, Ln('spoil', x) - 0.01)], line);
    for (const f of [0.2, 0.46]) for (let x = 4; x < 39; x += 4) { const a = at(x, f + 0.006), b = at(Math.min(39.4, x + 4), f + 0.006); Q.rivets(a[0], a[1], b[0], b[1], 0.08, { px: 1.2, depth: 0.15, dark: 0.04 }); }
    if (top) {
      const a = at(4.4, 0.24), b = at(4.4, 0.58), c = at(11.0, 0.58), d = at(11.0, 0.24);     // walkway
      Q.stroke((g) => { g.moveTo(d[0], d[1]); g.lineTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); }, 0.06, F.matte('#2a2c2e'));
      for (const x of [6.5, 9.0]) { const p = at(x, 0.41); Q.text('WALKWAY', p[0], p[1], 0.12, { color: '#2a2c2e', font: K.FONT.sans, rot: -90 }); }
      for (const x of [9, 18, 27, 34]) { const p = at(x, 0.36); Q.decal(p[0], p[1], (g) => { g.fillStyle = '#3c4044'; g.beginPath(); g.arc(0, 0, 0.11, 0, TAU); g.fill(); g.strokeStyle = '#c42a1e'; g.lineWidth = 0.015; g.beginPath(); g.arc(0, 0, 0.17, 0, TAU); g.stroke(); }); }   // fuel caps
      for (const x of [16, 30]) { const p = at(x, 0.1); Q.text('NO STEP', p[0], p[1] + 1.1, 0.16, { color: '#7a2a24', font: K.FONT.sans }); }
      for (const x of [12.7, 25.2]) { const a2 = at(x - 1.4, 0.0), b2 = at(x + 1.4, 0.0); Q.streak(a2[0], a2[1] + 1.2, b2[0], b2[1] + 3.0, 0.9, { alpha: 0.05 }); }
    } else {
      for (let i = 0; i < 22; i++) { const x = 5 + i * 1.55, a = at(x, 0.66); Q.streak(a[0], a[1], a[0], a[1] + 2.0, 0.08, { alpha: 0.1 }); }
      for (const x of [8, 16, 22, 30, 35]) { const p = at(x, 0.4); Q.panel(p[0] - 0.35, p[1] - 0.25, p[0] + 0.35, p[1] + 0.25, { r: 0.06, px: 1, depth: 0.3, dark: 0.1 }); }
      for (const x of [12.7, 25.2]) { const p = at(x, 0.55); for (const dx of [-0.5, 0.5]) Q.streak(p[0] + dx, p[1], p[0] + dx, p[1] + 4.0, 1.5, { alpha: 0.13 }); }   // exhaust / reverser soot
    }
    Q.noise({ alpha: 0.045, scale: 3, stretch: [1, 2.5], rough: 0.04 });
  }
  {
    const Q = B.pen(cSt); Q.fill('all', grey);
    const sa = (x, f) => { const p = stab.at(x, f); return [p[0], p[2]]; };
    Q.fill([sa(0.8, 0), sa(15.2, 0), sa(15.2, 0.06), sa(0.8, 0.06)], metal);
    Q.line([sa(3.2, 1), sa(3.2, 0.71), sa(8.9, 0.71), sa(8.9, 1)], gap); Q.line([sa(9.0, 1), sa(9.0, 0.71), sa(14.9, 0.71), sa(14.9, 1)], gap);
    for (const f of [0.22, 0.46]) Q.line([sa(1.5, f), sa(15, f)], line);
    for (const x of [4.5, 6.5, 8.5, 10.5, 12.5]) Q.line([sa(x, 0.07), sa(x, 0.7)], line);
    Q.noise({ alpha: 0.045, scale: 3, stretch: [1, 2], rough: 0.04 });
  }
  for (const key of ['L', 'R']) {
    const Q = B.pen(cFin[key]); Q.fill('all', F.gloss(SC.tail));
    const fa = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    const c = fa(11.0, 0.42), flip = key === 'R' ? -1 : 1;
    if (SC.style === 'cheat') {            // large white swoosh with a gold pinstripe, crossed by a stylised star
      Q.decal(c[0], c[1], (g) => {
        g.scale(flip, 1);                  // the swoosh follows the leading edge on both sides
        g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(-5.2, 5.6); g.bezierCurveTo(-1.5, 2.2, 1.0, 1.2, 5.4, -4.8); g.bezierCurveTo(1.8, -0.6, -1.2, 1.6, -5.2, 6.6); g.closePath(); g.fill();
        g.strokeStyle = SC.accent; g.lineWidth = 0.18; g.beginPath(); g.moveTo(-5.0, 7.2); g.bezierCurveTo(-1.0, 2.6, 1.8, 0.8, 5.6, -3.8); g.stroke();
        g.translate(-1.6, -1.9); drawStarMark(g, 1.2, SC.accent, null);
      });
    } else if (SC.style === 'sweep') {     // coral leaf with white veins
      Q.decal(c[0] + 0.4 * flip, c[1], (g) => { g.scale(flip, 1); drawLeaf(g, 4.0, SC.accent, false); });
    } else {                               // house: blue root band and fin-top flash, "380" mark
      Q.fill([fa(2.6, 0), fa(6.2, 0), fa(6.2, 1), fa(2.6, 1)], F.gloss(SC.cheat));
      Q.fill([fa(6.2, 0), fa(6.6, 0), fa(6.6, 1), fa(6.2, 1)], F.gloss(SC.accent));
      Q.fill([fa(16.6, 0), fa(FIN_H, 0), fa(FIN_H, 1), fa(16.6, 1)], F.gloss(SC.cheat));
      Q.text('380', c[0], c[1], 2.4, { color: SC.cheat, font: K.FONT.wide, weight: 700 });
    }
    Q.text(SC.reg, fa(5.6, 0.62)[0], fa(5.6, 0.62)[1], 0.42, { color: '#ffffff', font: K.FONT.sans, weight: 700 });
    { const p = fa(4.2, 0.45); Q.decal(p[0], p[1], { layers: ['emis'] }, (g) => {          // pool of the logo lights on the fin (lit at night)
      const h = parseInt(SC.tail.slice(1), 16), t = [(h >> 16) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255], k = 0.35, c = `${Math.round(255 * (t[0] * (1 - k) + k))},${Math.round(238 * (t[1] * (1 - k) + k))},${Math.round(210 * (t[2] * (1 - k) + k))}`;   // the lamp's warm light on the fin's own colour
      const gr = g.createRadialGradient(0, -1.5, 0.5, 0, -1.5, 9); gr.addColorStop(0, `rgba(${c},0.85)`); gr.addColorStop(0.45, `rgba(${c},0.3)`); gr.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = gr; g.fillRect(-10, -11, 20, 20); }); }
    Q.fill([fa(3.5, 0), fa(18.2, 0), fa(18.2, 0.03), fa(3.5, 0.03)], metal);
    const fg = { px: 1.6, depth: 0.5, dark: 0.3 };
    Q.line([fa(4.6, 1), fa(4.6, 0.7), fa(11.0, 0.7), fa(11.0, 1)], fg); Q.line([fa(11.1, 1), fa(11.1, 0.7), fa(18.0, 0.7), fa(18.0, 1)], fg);
    const fl = { px: 1, depth: 0.18, dark: 0.06 };
    for (const y of [7.0, 9.0, 13.5, 15.8]) Q.line([fa(y, 0.7), fa(y, 1)], fl);
    for (const f of [0.22, 0.46]) Q.line([fa(3.6, f), fa(18.0, f)], fl);
    Q.noise({ alpha: 0.03, scale: 3 });
  }
}
const FIN_H = geometry.height - geometry.cgHeight - 0.05;

/** Orivane star: ten-point star (canvas units = metres, centred on the origin), optional disc behind it. */
function drawStarMark(g, r, col, bg) {
  if (bg) { g.fillStyle = bg; g.beginPath(); g.arc(0, 0, r * 1.25, 0, TAU); g.fill(); }
  g.fillStyle = col; g.beginPath();
  for (let i = 0; i < 10; i++) { const a = i / 10 * TAU - Math.PI / 2, rr = i % 2 ? r * 0.4 : r; if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath(); g.fill();
}
/** Selvara leaf: a coral leaf with white veins, size s (metres), pointing up and forward. */
function drawLeaf(g, s, col, flip) {
  const k = s / 4; g.save(); if (flip) g.scale(-1, 1); g.scale(k, k);
  g.fillStyle = col; g.beginPath(); g.moveTo(-3.4, 3.6); g.bezierCurveTo(-3.6, -0.6, -0.6, -3.6, 3.6, -4.2); g.bezierCurveTo(3.2, 0.2, 0.4, 3.4, -3.4, 3.6); g.closePath(); g.fill();
  g.strokeStyle = '#ffffff'; g.lineWidth = 0.16; g.lineCap = 'round'; g.beginPath(); g.moveTo(-3.0, 3.2); g.quadraticCurveTo(0, 0.4, 3.2, -3.8); g.stroke();
  for (const t of [0.25, 0.45, 0.65]) { const x = -3 + 6.2 * t, y = 3.2 - 7 * t + 0.6; g.beginPath(); g.moveTo(x, y - 0.4); g.lineTo(x + 1.1, y - 0.2); g.stroke(); g.beginPath(); g.moveTo(x, y - 0.4); g.lineTo(x - 0.2, y - 1.4); g.stroke(); }
  g.restore();
}

/** Narrow a cockpit part toward the nose so it stays inside the skin: every vertex's x is scaled by
 *  (inner half-width of `body` at its own z and height − margin) / hwRef wherever that is below 1 (the kit glareshield is a
 *  straight-sided hood; airliner noses taper under it). Returns the mesh. */
function fitInside(m, body, hwRef, margin = 0.08) {
  const p = m.p;
  for (let i = 0; i < p.length; i += 3) {
    const y = p[i + 1], z = p[i + 2];
    if (z < body.zRange[0] || y >= body.topAt(z) || y <= body.botAt(z)) continue;
    const k = (body.at(z, body.tAtY(z, y)).p[0] - margin) / hwRef;
    if (k < 1) p[i] *= Math.max(0.15, k);
  }
  return m;
}
