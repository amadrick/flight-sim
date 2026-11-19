// B-2A Spirit — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight when parked.
//
// Reference numbers (docs/aircraft/b2.md + published three-views):
//   length 20.9 m (nose tip z -9.4 → beaver-tail point z 11.5), span 52.4 m (tips at x ±26.2), height 5.18 m gear down.
//   Leading edges: one straight 33° line per side from the nose point to the tip (tip LE at z 7.61).
//   Trailing edge ("double W"): every edge is parallel to one of the two leading edges (planform alignment):
//     centre point (0, 11.5) → inboard notch (±11.26, 4.19) → outboard point (±21.9, 11.1) → tip (±26.2, 8.31),
//     i.e. the notch→outer edges are parallel to the near leading edge (constant 6.28 m chord there) and the short tip
//     edges carrying the split drag rudders are forward-swept, parallel to the opposite leading edge. Area 470 m².
//   Centre body ≈ 2.3 m thick (11 % of the 20.9 m root) with the flight-deck hump (top y ≈ 1.95) and one engine hump per
//   side carrying two serrated inlets (lips at z ≈ -2.35, centres x ±2.05, ±3.85); outer wing ≈ 8 % thick, sharp tips.
//   Exhaust troughs (aft decks) at x ±1.95 / ±3.95 from z 7.4 / 6.8 to the trailing edge.
//   Controls: GLA "beaver tail" (centre, hinge z 9.3), three elevons per side, split drag rudders at 85–97 % semi-span.
//   Gear: nose twin (contact z -6), main 4-wheel bogies at x ±4.6, z 0.9, retracting forward; ground at y -3.
//
// The whole airframe is ONE lofted surface built here (the kit has no flying-wing primitive): a structured grid over
// (span x, chord fraction f) whose upper / lower heights come from smooth analytic fields (thickness distribution, the
// cockpit and engine humps, inlet ramps and exhaust troughs as true steps). Grid rows are anchored per column on the
// inlet lips, the exhaust slots and the control hinge lines, so those edges are exact; windows, gear doors and the
// auxiliary inlet doors are cut out of the grid by exact polygon clipping.
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['standard', 'weathered'];

const SCHEMES = {
  standard: {
    name: 'Standard AHSS grey', skin: '#34383e', under: '#3a3e44', le: '#4f545a', seam: '#3d4148', patch: '#303439', tile: '#222326',
    rough: 0.6, metal: 0.06, noise: 0.035, chalk: 0, code: 'WM', serial: 'AF 91-0347', acName: 'SPIRIT OF CASCADIA', unit: '509 BW',
  },
  weathered: {
    name: 'Weathered (repaired coating)', skin: '#4b5058', under: '#525760', le: '#6a7077', seam: '#565c64', patch: '#40454c', tile: '#2b2c2f',
    rough: 0.66, metal: 0.04, noise: 0.09, chalk: 0.06, code: 'SK', serial: 'AF 93-1129', acName: 'SPIRIT OF THE HIGH DESERT', unit: '73 TES',
  },
};

// ===================================================================================================================
// Shape: planform and surface fields (a = |x|)
// ===================================================================================================================
const T33 = Math.tan(33 * DEG);
const NOSE = -9.4, TAIL = 11.5, TIP = 26.2, XO = 21.9, ZO = 11.1;
const XN = (TAIL - ZO + T33 * XO) / (2 * T33), ZN = TAIL - T33 * XN, XS = 18.8;
const CHART_X = [0, XN, XS, Infinity];
const zLE = (a) => NOSE + T33 * a;
const zTE = (a) => (a <= XN ? TAIL - T33 * a : a <= XO ? ZO - T33 * (XO - a) : ZO - T33 * (a - XO));
const chord = (a) => zTE(a) - zLE(a);
const cl01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ss = (e0, e1, x) => { const t = cl01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const plateau = (d, hw, soft) => 1 - ss(hw - soft / 2, hw + soft / 2, d);

const Tu = K.pchip([0, 1.2, 2.5, 4.0, 5.2, 6.4, 7.8, 9.5, 11.3, 16, 21.9, 24.5, 26.2], [1.12, 1.1, 1.05, 0.94, 0.74, 0.52, 0.38, 0.31, 0.28, 0.25, 0.2, 0.11, 0.02]);
const Tl = K.pchip([0, 1.5, 3.0, 4.5, 5.6, 6.8, 8.2, 10, 11.3, 16, 21.9, 24.5, 26.2], [1.3, 1.28, 1.22, 1.08, 0.86, 0.6, 0.4, 0.27, 0.22, 0.2, 0.16, 0.09, 0.02]);
const yEdge = (a) => 0.3 - 0.0068 * a;
const GU = (() => { const m = Math.pow(0.3605, 0.62) * Math.pow(0.6395, 1.1); return (f) => (f <= 0 || f >= 1 ? 0 : Math.pow(f, 0.62) * Math.pow(1 - f, 1.1) / m); })();
const GL = (() => { const m = Math.pow(0.53125, 0.85) * Math.pow(0.46875, 0.75); return (f) => { if (f <= 0 || f >= 1) return 0; const g = Math.min(1, Math.pow(f, 0.85) * Math.pow(1 - f, 0.75) / m); return 1 - (1 - g) * (1 - g); }; })();

// inlets: two per side on the engine hump, lips with two 33° saw-teeth each
const INLETS = [2.05, 3.85], IHW = 0.8, ZLIP = -2.35, TOOTH = 0.4, TDEP = TOOTH * T33, IDEPTH = 0.6;
function lipZ(a) {
  for (const cx of INLETS) { const u = a - (cx - IHW); if (u >= 0 && u <= 2 * IHW) { const k = (u / TOOTH) % 2; return ZLIP + (1 - Math.abs(k - 1)) * TDEP; } }
  return ZLIP;
}
function inletDepth(a, z) {
  let lat = 0; for (const cx of INLETS) lat = Math.max(lat, plateau(Math.abs(a - cx), IHW, 0.3));
  if (lat <= 0) return 0;
  const zl = lipZ(a); if (z >= zl - 0.004) return 0;
  return IDEPTH * lat * ss(zl - 2.8, zl - 0.12, z);
}
// exhaust troughs: a slot (step down) at the exit, then a recessed deck that runs out at the trailing edge
const ENG = [{ cx: 1.95, z: 7.4 }, { cx: 3.95, z: 6.8 }], EHW = 0.55, EDEPTH = 0.3;
const exitZ = (a) => (a <= 2.6 ? 7.4 : a <= 3.3 ? 7.4 - 0.6 * (a - 2.6) / 0.7 : 6.8);
function exhaustDepth(a, z, thick) {
  for (const e of ENG) {
    const lat = plateau(Math.abs(a - e.cx), EHW, 0.12); if (lat <= 0) continue;
    if (z <= e.z + 0.004) return 0;
    const u = cl01((z - e.z) / (zTE(a) - e.z));
    return Math.min(EDEPTH * lat * Math.pow(1 - u, 1.3), 0.8 * Math.max(0, thick));
  }
  return 0;
}
function humps(a, z) {
  const lc = a < 1.85 ? Math.pow(1 - Math.pow(a / 1.85, 3), 2.5) : 0;
  const hc = 0.75 * lc * ss(-7.35, -5.0, z) * (1 - ss(-4.3, -0.2, z));
  const d = Math.abs(a - 3.0) / 2.4, le = d < 1 ? (1 - d * d) * (1 - d * d) : 0;
  const he = 0.3 * le * ss(-6.0, -2.6, z) * (1 - ss(0.5, 8.5, z));
  return hc + he;
}
function yLow(a, z) { const f = (z - zLE(a)) / chord(a); return yEdge(a) - Tl(a) * GL(f); }
function yUp(a, z) {
  const c = chord(a), s = z - zLE(a), r = zTE(a) - z, f = s / c;
  if (f <= 0 || f >= 1) return yEdge(a);
  const base = yEdge(a) + Tu(a) * GU(f) + humps(a, z) * ss(0, 0.8, s) * ss(0, 0.8, r);
  return base - inletDepth(a, z) - exhaustDepth(a, z, base - yLow(a, z));
}

// control surfaces (right half; the left half is the mirror image)
const CTRL = [
  { name: 'gla', x0: 0, x1: 3.25, hz: () => 9.3 },
  { name: 'elevon1', x0: 5.3, x1: 10.6, hz: (a) => zTE(a) - 2.4 },
  { name: 'elevon2', x0: 11.8, x1: 16.6, hz: (a) => zTE(a) - 1.6 },
  { name: 'elevon3', x0: 16.8, x1: 21.4, hz: (a) => zTE(a) - 1.6 },
  { name: 'rudder', x0: 22.3, x1: 25.4, split: true, hz: (a) => { const t = (a - 22.3) / 3.1; return (zTE(22.3) - 1.9) * (1 - t) + (zTE(25.4) - 0.75) * t; } },
];
const hFrac = (C, a) => (C.hz(a) - zLE(a)) / chord(a);
function hingeFrac(a) {
  for (const C of CTRL) if (a >= C.x0 - 1e-9 && a <= C.x1 + 1e-9) return hFrac(C, a);
  const last = CTRL[CTRL.length - 1];
  if (a > last.x1) return hFrac(last, last.x1);
  for (let k = 1; k < CTRL.length; k++) {
    const P = CTRL[k - 1], N = CTRL[k];
    if (a > P.x1 && a < N.x0) { const t = (a - P.x1) / (N.x0 - P.x1); return hFrac(P, P.x1) * (1 - t) + hFrac(N, N.x0) * t; }
  }
  return 0.8;
}

// grid rows: LE … lip(-3 cm) | lip … exhaust slot | slot(+3 cm) … hinge … TE
const N1 = 40, N3 = 30, N5 = 6, N6 = 5;
const A1 = N1, A2 = N1 + 1, A3 = A2 + N3, A4 = A3 + 1, A5 = A4 + N5, NR = A5 + N6;
function rowFracs(a) {
  const c = chord(a), d = 0.03 / c;
  let fLip;
  if (a <= INLETS[1] + IHW) fLip = (lipZ(a) - zLE(a)) / c;
  else { const f0 = (ZLIP - zLE(a)) / c, w = ss(INLETS[1] + IHW, 6.6, a); fLip = f0 * (1 - w) + 0.3 * w; }
  const fH = hingeFrac(a);
  const fe0 = (exitZ(a) - zLE(a)) / c, fn = fLip + 0.6 * (fH - fLip), w = ss(4.6, 5.4, a);
  const fEx = Math.max(fLip + 0.02, Math.min(fe0 * (1 - w) + fn * w, fH - 0.02 - d));
  const out = [];
  for (let k = 0; k <= N1; k++) out.push((fLip - d) * Math.pow(k / N1, 1.45));
  out.push(fLip);
  for (let k = 1; k <= N3; k++) out.push(fLip + (fEx - fLip) * k / N3);
  out.push(fEx + d);
  for (let k = 1; k <= N5; k++) out.push(fEx + d + (fH - fEx - d) * k / N5);
  for (let k = 1; k <= N6; k++) out.push(fH + (1 - fH) * k / N6);
  return out;
}
function columns(detail) {
  const bp = [0, TIP, XN, XO, XS, 2.85, 3.05, 1.4, 2.5, 3.4, 4.5];
  for (const cx of INLETS) for (let k = -2; k <= 2; k++) bp.push(cx + k * TOOTH);
  for (const C of CTRL) bp.push(C.x0, C.x1);
  const u = [...new Set(bp.map(v => Math.round(v * 1e6) / 1e6))].sort((p, q) => p - q);
  const sp = (a) => (a < 5 ? 0.12 : a < 11.3 ? 0.3 : 0.6) / detail, out = [u[0]];
  for (let k = 1; k < u.length; k++) {
    const g = u[k] - u[k - 1], n = Math.max(1, Math.ceil(g / sp((u[k] + u[k - 1]) / 2) - 0.25));
    for (let s = 1; s <= n; s++) out.push(u[k - 1] + g * s / n);
  }
  return out;
}

export const SHAPE = { zLE, zTE, chord, yUp, yLow, lipZ, XN, ZN, T33, CTRL, INLETS, ENG, exitZ };

// ===================================================================================================================
// small geometry helpers
// ===================================================================================================================
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** Quads between two polylines with flat normals, wound so the normal points along `dir`. */
function strip(m, A, B, uv, dir) {
  for (let k = 0; k < A.length - 1; k++) {
    let q = [A[k], A[k + 1], B[k + 1], B[k]];
    let n = cross(sub(q[1], q[0]), sub(q[3], q[0]));
    if (Math.hypot(...n) < 1e-10) n = cross(sub(q[2], q[1]), sub(q[0], q[1]));
    if (Math.hypot(...n) < 1e-10) continue;
    if (dot(n, dir) < 0) { q = [q[0], q[3], q[2], q[1]]; n = [-n[0], -n[1], -n[2]]; }
    n = norm(n);
    const i0 = m.vertexCount; for (const p of q) m.vert(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]);
    m.quad(i0, i0 + 1, i0 + 2, i0 + 3);
  }
}
/** Planar polygon (convex, ordered) as a fan with one normal facing `dir`. */
function flatPoly(m, pts, uv, dir) {
  let n = [0, 0, 0];
  for (let k = 1; k < pts.length - 1; k++) { const c = cross(sub(pts[k], pts[0]), sub(pts[k + 1], pts[0])); n = [n[0] + c[0], n[1] + c[1], n[2] + c[2]]; }
  let P = pts; if (dot(n, dir) < 0) { P = pts.slice().reverse(); n = [-n[0], -n[1], -n[2]]; }
  n = norm(n); const i0 = m.vertexCount;
  for (const p of P) m.vert(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]);
  for (let k = 1; k < P.length - 1; k++) m.tri(i0, i0 + k, i0 + k + 1);
}

// clipping of grid triangles against convex polygons in the (x, z) plane
const lerpV = (A, B, t) => ({
  x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t,
  p: [A.p[0] + (B.p[0] - A.p[0]) * t, A.p[1] + (B.p[1] - A.p[1]) * t, A.p[2] + (B.p[2] - A.p[2]) * t],
  n: norm([A.n[0] + (B.n[0] - A.n[0]) * t, A.n[1] + (B.n[1] - A.n[1]) * t, A.n[2] + (B.n[2] - A.n[2]) * t]),
  uv: [A.uv[0] + (B.uv[0] - A.uv[0]) * t, A.uv[1] + (B.uv[1] - A.uv[1]) * t],
});
function splitLine(poly, a, b) {
  const side = (v) => { const s = (b[0] - a[0]) * (v.z - a[1]) - (b[1] - a[1]) * (v.x - a[0]); return Math.abs(s) < 1e-10 ? 0 : s; };
  const inn = [], out = [], n = poly.length;
  for (let k = 0; k < n; k++) {
    const A = poly[k], B = poly[(k + 1) % n], sa = side(A), sb = side(B);
    if (sa >= 0) inn.push(A); if (sa <= 0) out.push(A);
    if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) { const I = lerpV(A, B, sa / (sa - sb)); inn.push(I); out.push(I); }
  }
  return [inn, out];
}
function splitConvex(poly, P) {
  let rest = poly; const outside = [];
  for (let k = 0; k < P.length; k++) {
    const [inn, out] = splitLine(rest, P[k], P[(k + 1) % P.length]);
    if (out.length >= 3) outside.push(out);
    rest = inn; if (rest.length < 3) return { inside: null, outside };
  }
  return { inside: rest, outside };
}
const ccw = (P) => { let s = 0; for (let k = 0; k < P.length; k++) { const a = P[k], b = P[(k + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s > 0 ? P : P.slice().reverse(); };
const bboxOf = (pts) => { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of pts) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); } return b; };
const emitPoly = (m, poly) => {
  const i0 = m.vertexCount;
  for (const v of poly) m.vert(v.p[0], v.p[1], v.p[2], v.n[0], v.n[1], v.n[2], v.uv[0], v.uv[1]);
  for (let k = 1; k < poly.length - 1; k++) m.tri(i0, i0 + k, i0 + k + 1);
};

// ===================================================================================================================
// the airframe skin (right half), its control surfaces and cut-outs
// ===================================================================================================================
function buildAirframe(o) {
  const { cols, cTop, cBot, U: SW, regions, cockpitBox } = o;
  const NI = cols.length;
  const G = { U: [], L: [], cols };
  for (let i = 0; i < NI; i++) {
    const a = cols[i], zl = zLE(a), c = chord(a), fr = rowFracs(a), ue = [], le = [];
    for (let j = 0; j <= NR; j++) {
      const z = zl + fr[j] * c;
      const yu = j === 0 || j === NR ? yEdge(a) : yUp(a, z), yl = j === 0 || j === NR ? yEdge(a) : yLow(a, z);
      ue.push({ x: a, z, p: [a, yu, z], n: null, uv: cTop[0].uv3(a, yu, z), uvs: cTop.map(c => c.uv3(a, yu, z)) });
      le.push({ x: a, z, p: [a, yl, z], n: null, uv: cBot[0].uv3(a, yl, z), uvs: cBot.map(c => c.uv3(a, yl, z)) });
    }
    G.U.push(ue); G.L.push(le);
  }
  for (const [P, up] of [[G.U, true], [G.L, false]]) {
    for (let i = 0; i < NI; i++) for (let j = 0; j <= NR; j++) {
      const ip = Math.min(i + 1, NI - 1), im = Math.max(i - 1, 0);
      let jp = Math.min(j + 1, NR), jm = Math.max(j - 1, 0);
      if (j === A1 || j === A3) jp = j; if (j === A2 || j === A4) jm = j;
      const du = sub(P[ip][j].p, P[im][j].p), dv = sub(P[i][jp].p, P[i][jm].p);
      let n = up ? cross(dv, du) : cross(du, dv);
      if (i === 0) n[0] = 0;
      if (Math.hypot(...n) < 1e-12) n = [0, up ? 1 : -1, 0];
      P[i][j].n = norm(n);
    }
  }
  const U = G.U, L = G.L, mid3 = (i, j) => mid(U[i][j].p, L[i][j].p);

  const skin = new K.Mesh(), liner = new K.Mesh(), faces = new K.Mesh(), voids = new K.Mesh();
  const caches = new Map();
  const vid = (m, P, i, j, sd) => {
    let c = caches.get(m); if (!c) caches.set(m, c = new Map());
    const key = (P === U ? 0 : 1e7) + sd * 5e6 + i * 1000 + j; let id = c.get(key);
    if (id === undefined) { const v = P[i][j], uv = v.uvs[sd]; id = m.vert(v.p[0], v.p[1], v.p[2], v.n[0], v.n[1], v.n[2], uv[0], uv[1]); c.set(key, id); }
    return id;
  };
  const quad = (m, P, i, j, up) => {
    const xm = (cols[i] + cols[i + 1]) / 2, sd = CHART_X.findIndex((x, k) => xm < CHART_X[k + 1]);      // wing chart by span
    const a = vid(m, P, i, j, sd), b = vid(m, P, i, j + 1, sd), c = vid(m, P, i + 1, j + 1, sd), d = vid(m, P, i + 1, j, sd);
    if (up) m.quad(a, b, c, d); else m.quad(a, d, c, b);
  };
  const inBox = (x, z) => cockpitBox && x >= cockpitBox[0] && x <= cockpitBox[1] && z >= cockpitBox[2] && z <= cockpitBox[3];
  const linerPoly = (poly) => { const cx = poly.reduce((s, v) => s + v.x, 0) / poly.length, cz = poly.reduce((s, v) => s + v.z, 0) / poly.length; if (inBox(cx, cz)) emitPoly(liner, poly); };

  // controls
  const ctrlCell = new Int16Array(NI).fill(-1);
  const CM = CTRL.map((C, k) => {
    const ia = cols.findIndex(v => Math.abs(v - C.x0) < 1e-6), ib = cols.findIndex(v => Math.abs(v - C.x1) < 1e-6);
    for (let i = ia; i < ib; i++) ctrlCell[i] = k;
    return { C, ia, ib, upper: new K.Mesh(), lower: new K.Mesh() };
  });
  const regFor = (surf, i, j) => {
    const x0 = Math.min(cols[i], cols[i + 1]), x1 = Math.max(cols[i], cols[i + 1]);
    const P = surf === 'U' ? U : L, zs = [P[i][j].z, P[i][j + 1].z, P[i + 1][j].z, P[i + 1][j + 1].z], z0 = Math.min(...zs), z1 = Math.max(...zs);
    return regions.filter(R => R.surf === surf && R.bbox[0] < x1 && R.bbox[2] > x0 && R.bbox[1] < z1 && R.bbox[3] > z0);
  };
  const cell = (P, i, j, up) => {
    const regs = regFor(up ? 'U' : 'L', i, j);
    if (!regs.length) {
      quad(skin, P, i, j, up);
      if (up && inBox((cols[i] + cols[i + 1]) / 2, (P[i][j].z + P[i + 1][j + 1].z) / 2)) quad(liner, P, i, j, true);
      return;
    }
    const a = P[i][j], b = P[i][j + 1], c = P[i + 1][j + 1], d = P[i + 1][j];
    const tris = up ? [[a, b, c], [a, c, d]] : [[a, d, c], [a, c, b]];
    for (const t of tris) {
      let rest = [t];
      for (const R of regs) for (const poly of R.polys) {
        const next = [];
        for (const pc of rest) { const s = splitConvex(pc, poly); if (s.inside) emitPoly(R.mesh, s.inside); next.push(...s.outside); }
        rest = next;
      }
      for (const pc of rest) { emitPoly(skin, pc); if (up) linerPoly(pc); }
    }
  };
  const inletCol = (i) => cols[i] >= INLETS[0] - IHW - 0.2 && cols[i + 1] <= INLETS[1] + IHW + 0.2;
  const slotCol = (i) => cols[i] >= ENG[0].cx - EHW - 0.08 && cols[i + 1] <= ENG[1].cx + EHW + 0.08;
  for (let i = 0; i < NI - 1; i++) for (let j = 0; j < NR; j++) {
    const ci = j >= A5 ? ctrlCell[i] : -1;
    if (ci >= 0) { quad(CM[ci].upper, U, i, j, true); quad(CM[ci].lower, L, i, j, false); continue; }
    if ((j === A1 && inletCol(i)) || (j === A3 && slotCol(i))) {
      const pts = [U[i][j].p, U[i][j + 1].p, U[i + 1][j + 1].p, U[i + 1][j].p];
      flatPoly(j === A1 ? voids : faces, pts, j === A1 ? SW.duct : SW.slot, [0, 0, j === A1 ? -1 : 1]);
    } else cell(U, i, j, true);
    cell(L, i, j, false);
  }
  // tip closure
  { const i = NI - 1, A = [], B = []; for (let j = 0; j <= NR; j++) { A.push(U[i][j].p); B.push(L[i][j].p); } strip(skin, A, B, SW.le, [1, 0, 0]); }

  // control blocks: front face, end caps, the fixed cove and side walls
  const ctrls = {};
  for (const cm of CM) {
    const { C, ia, ib } = cm, colsIn = []; for (let i = ia; i <= ib; i++) colsIn.push(i);
    const rowU = colsIn.map(i => U[i][A5].p), rowL = colsIn.map(i => L[i][A5].p), rowM = colsIn.map(i => mid3(i, A5));
    const capPts = (i, P) => { const r = []; for (let j = A5; j <= NR; j++) r.push(P === 'M' ? mid3(i, j) : (P === 'U' ? U : L)[i][j].p); return r; };
    strip(faces, rowL, rowU, SW.cove, [0, 0, 1]);                                            // fixed cove (faces aft)
    if (ia > 0) strip(faces, capPts(ia, 'L'), capPts(ia, 'U'), SW.cove, [1, 0, 0]);         // walls of the cut-out
    strip(faces, capPts(ib, 'L'), capPts(ib, 'U'), SW.cove, [-1, 0, 0]);
    const ax = { a: mid3(ia, A5), b: mid3(ib, A5), ref: mid3((ia + ib) >> 1, NR) };
    if (!C.split) {
      const m = cm.upper.add(cm.lower);
      strip(m, rowL, rowU, SW.cove, [0, 0, -1]);
      if (ia > 0) strip(m, capPts(ia, 'L'), capPts(ia, 'U'), SW.cove, [-1, 0, 0]);
      strip(m, capPts(ib, 'L'), capPts(ib, 'U'), SW.cove, [1, 0, 0]);
      ctrls[C.name] = { mesh: m, ...ax };
    } else {
      const up = cm.upper, lo = cm.lower;
      for (let i = ia; i < ib; i++) for (let j = A5; j < NR; j++) {
        const q = [mid3(i, j), mid3(i + 1, j), mid3(i + 1, j + 1), mid3(i, j + 1)];
        flatPoly(up, q, SW.cove, [0, -1, 0]); flatPoly(lo, q, SW.cove, [0, 1, 0]);
      }
      strip(up, rowM, rowU, SW.cove, [0, 0, -1]); strip(lo, rowL, rowM, SW.cove, [0, 0, -1]);
      strip(up, capPts(ia, 'M'), capPts(ia, 'U'), SW.cove, [-1, 0, 0]); strip(up, capPts(ib, 'M'), capPts(ib, 'U'), SW.cove, [1, 0, 0]);
      strip(lo, capPts(ia, 'L'), capPts(ia, 'M'), SW.cove, [-1, 0, 0]); strip(lo, capPts(ib, 'L'), capPts(ib, 'M'), SW.cove, [1, 0, 0]);
      ctrls[C.name] = { upper: up, lower: lo, ...ax };
    }
  }
  return { G, skin, faces, voids, liner, ctrls };
}

// ===================================================================================================================
export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'standard', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const Gm = geometry, F = K.FINISH, lap = K.stopwatch();
  const coat = (c) => ({ color: c, rough: SC.rough, metal: SC.metal });

  // ---- atlas --------------------------------------------------------------------------------------------------------
  const atlas = K.createAtlas({ size: atlasSize, base: coat(SC.skin) });
  // wing charts are sheared along the leading edge (paint b = z - x·tan33) and split at the notch: the inner chart holds
  // the centre body, the outer one the constant-chord outer wing and tip — far less wasted atlas than a plain plan view
  const wchart = (name, a, b, flip, density) => atlas.chart(name, { type: 'proj', origin: [0, 0, 0], u: [1, 0, 0], v: [-T33, 0, 1], a, b, flip, mirror: true, density });
  const cTop = [wchart('topIn', [0, XN + 0.05], [-9.5, 11.6], false, 1), wchart('topMid', [XN - 0.05, XS + 0.05], [-9.5, -3.0], false, 1.1), wchart('topOut', [XS - 0.05, 26.3], [-9.5, -3.0], false, 1.1)];
  const cBot = [wchart('botIn', [0, XN + 0.05], [-9.5, 11.6], true, 0.8), wchart('botMid', [XN - 0.05, XS + 0.05], [-9.5, -3.0], true, 0.85), wchart('botOut', [XS - 0.05, 26.3], [-9.5, -3.0], true, 0.85)];
  const cND = { R: atlas.chart('ndoorR', { type: 'rect', w: 3.4, h: 0.5, density: 2.2 }), L: atlas.chart('ndoorL', { type: 'rect', w: 3.4, h: 0.5, density: 2.2 }) };
  const cMD = { R: atlas.chart('mdoorR', { type: 'rect', w: 4.6, h: 1.05, density: 1.4 }), L: atlas.chart('mdoorL', { type: 'rect', w: 4.6, h: 1.05, density: 1.4 }) };
  const cPanel = atlas.chart('panel', { type: 'rect', w: 2.3, h: 0.45, density: 2.4 });
  atlas.pack();
  const sw = (k, f) => atlas.swatch(k, f);
  const U = {
    duct: sw('duct', { color: '#040405', rough: 0.95, metal: 0 }), slot: sw('slot', { color: '#1d1a19', rough: 0.6, metal: 0.6 }), cove: sw('cove', { color: '#2b2e33', rough: 0.6, metal: 0.1 }),
    le: sw('le', coat(SC.le)), skin: sw('skin', coat(SC.skin)), under: sw('under', coat(SC.under)),
    well: sw('well', { color: '#c9cbc7', rough: 0.55, metal: 0 }), doorIn: sw('doorIn', { color: '#bfc1bd', rough: 0.55, metal: 0 }),
    interior: sw('interior', F.interior), console: sw('console', { color: '#1e2023', rough: 0.6, metal: 0 }), black: sw('black', F.black),
    seat: sw('seat', { color: '#2a2c2e', rough: 0.7, metal: 0 }), cushion: sw('cushion', { color: '#3b3f34', rough: 0.95, metal: 0 }), accent: sw('accent', { color: '#c8a21c', rough: 0.5, metal: 0 }),
    suit: sw('suit', { color: '#4a5240', rough: 0.9, metal: 0 }), helmet: sw('helmet', { color: '#8d9296', rough: 0.35, metal: 0 }), visor: sw('visor', { color: '#0a0b0d', rough: 0.05, metal: 0.4 }),
    glove: sw('glove', { color: '#2e2f2a', rough: 0.9, metal: 0 }), dark: sw('dark', F.darkGrey), steel: sw('steel', F.steel),
    plate: sw('plate', coat(SC.skin)), tile: sw('tile', { color: SC.tile, rough: 0.7, metal: 0.05 }),
  };

  const rig = K.createRig(ctx, { geometry: Gm, name: 'b2', glassLayer: opts.glassLayer });
  rig.material('paint', null);
  const stat = new K.Mesh();

  // ---- cut-out regions (right half, (x, z) polygons) ----------------------------------------------------------------
  const EYE = Gm.pilotEye, EYEY = EYE[1], EYEZ = EYE[2];
  const WIN = {
    front: [[0.07, -6.95], [0.98, -6.6], [1.12, -5.85], [0.07, -5.8]],
    side: [[1.1, -6.45], [1.52, -5.75], [1.55, -4.85], [1.25, -5.55]],
  };
  const MB = { xi: 3.85, xm: 4.3, xo: 5.35, zf: -2.6, za: 2.0 };          // main gear bay: trapezoid with LE-parallel ends
  const mbF = (x) => MB.zf + (x - MB.xi) * T33, mbA = (x) => MB.za - (x - MB.xi) * T33;
  const NB = [[0.0, -7.9], [0.5, -7.58], [0.5, -5.22], [0.0, -4.9]];
  const AUX = INLETS.map(cx => [[cx - 0.3, -1.6], [cx + 0.3, -1.6], [cx + 0.3, -1.12], [cx - 0.3, -1.12]]);
  const mkReg = (name, surf, polys) => { const P = polys.map(ccw); return { name, surf, polys: P, bbox: bboxOf(P.flat()), mesh: new K.Mesh() }; };
  const regions = [
    mkReg('winFront', 'U', [WIN.front]), mkReg('winSide', 'U', [WIN.side]),
    mkReg('mainIn', 'L', [[[MB.xi, mbF(MB.xi)], [MB.xm, mbF(MB.xm)], [MB.xm, mbA(MB.xm)], [MB.xi, mbA(MB.xi)]]]),
    mkReg('mainOut', 'L', [[[MB.xm, mbF(MB.xm)], [MB.xo, mbF(MB.xo)], [MB.xo, mbA(MB.xo)], [MB.xm, mbA(MB.xm)]]]),
    mkReg('nose', 'L', [NB]),
    mkReg('aux0', 'U', [AUX[0]]), mkReg('aux1', 'U', [AUX[1]]),
  ];
  const REG = Object.fromEntries(regions.map(r => [r.name, r]));
  const CPX = 1.62, CPZ0 = -7.0, CPZ1 = -3.9, FLOOR = EYEY - 1.12;

  // ---- airframe ------------------------------------------------------------------------------------------------------
  const cols = columns(detail);
  const AF = buildAirframe({ cols, cTop, cBot, U, regions, cockpitBox: [0, CPX, CPZ0, CPZ1] });
  const half = new K.Mesh().add(AF.skin).add(AF.faces);
  stat.add(half).add(half.mirrorX());

  // ---- inlet details: splitter plates, dividers, duct backdrop ---------------------------------------------------------
  const det = new K.Mesh();
  for (const cx of INLETS) {
    // boundary-layer splitter plate ahead of the lip with a serrated leading edge
    const n = 8, zf = ZLIP - 0.95, zb = ZLIP - 0.06;
    for (let k = 0; k < n; k++) {
      const xa = cx - IHW + 0.04 + (2 * IHW - 0.08) * k / n, xb = cx - IHW + 0.04 + (2 * IHW - 0.08) * (k + 1) / n, xm = (xa + xb) / 2;
      const zt = zf, tip = zt - (xb - xa) * 0.5 * T33;
      const P = (x, z) => [x, yUp(x, z) + 0.07, z];
      flatPoly(det, [P(xa, zt), P(xm, tip), P(xb, zt), P(xb, zb), P(xa, zb)], U.plate, [0, 1, 0]);
      flatPoly(det, [P(xa, zt), P(xm, tip), P(xb, zt), P(xb, zb), P(xa, zb)].map(p => [p[0], p[1] - 0.025, p[2]]), U.plate, [0, -1, 0]);
    }
  }
  { // vertical divider between the two inlets of a pair
    const xd = (INLETS[0] + INLETS[1]) / 2, A = [], B = [];
    for (let z = ZLIP - 1.6; z <= ZLIP + 0.01; z += 0.2) { A.push([xd, yUp(xd, z) - 0.02, z]); B.push([xd, yUp(xd, ZLIP + 0.02) + 0.02 - (ZLIP - z) * 0.05, z]); }
    const t = 0.05; const A2 = A.map(p => [p[0] - t, p[1], p[2]]), B2 = B.map(p => [p[0] - t, p[1], p[2]]);
    for (const [aa, bb, dx] of [[A, B, 1], [A2, B2, -1]]) strip(det, aa, bb, U.plate, [dx, 0, 0]);
  }
  stat.add(det).add(det.mirrorX());

  // ---- exhaust glow at the slot faces ---------------------------------------------------------------------------------
  const glowMesh = new K.Mesh();
  for (const e of ENG) {
    const A = [], B = [];
    for (let x = e.cx - EHW + 0.05; x <= e.cx + EHW - 0.049; x += 0.1) { const yt = yUp(x, e.z - 0.001) - 0.03; A.push([x, yt - EDEPTH * 0.85, e.z + 0.012]); B.push([x, yt, e.z + 0.012]); }
    const i0 = glowMesh.vertexCount;
    for (let k = 0; k < A.length; k++) { glowMesh.vert(...A[k], 0, 0, 1, 0.75, 0.5); glowMesh.vert(...B[k], 0, 0, 1, 0.75, 0.5); }
    for (let k = 0; k < A.length - 1; k++) glowMesh.quad(i0 + 2 * k, i0 + 2 * k + 2, i0 + 2 * k + 3, i0 + 2 * k + 1);
  }
  const glowAll = new K.Mesh().add(glowMesh).add(glowMesh.mirrorX());

  // ---- flight deck ----------------------------------------------------------------------------------------------------
  const glassR = REG.winFront.mesh.add(REG.winSide.mesh), glass = new K.Mesh().add(glassR).add(glassR.mirrorX());
  const cab = new K.Mesh();
  cab.add(AF.liner.clone().flip().inflate(0.025).setUV(U.interior));
  { // side wall, front and rear bulkheads, floor (right half), closing the lined volume
    const A = [], B = [];
    for (let z = CPZ0; z <= CPZ1 + 1e-6; z += 0.1) { A.push([CPX, FLOOR, z]); B.push([CPX, yUp(CPX, z) - 0.02, z]); }
    strip(cab, A, B, U.interior, [-1, 0, 0]);
    for (const [z, dz] of [[CPZ0, 1], [CPZ1, -1]]) { const A2 = [], B2 = []; for (let x = 0; x <= CPX + 1e-6; x += CPX / 8) { A2.push([x, FLOOR, z]); B2.push([x, yUp(x, z) - 0.02, z]); } strip(cab, A2, B2, U.interior, [0, 0, dz]); }
    strip(cab, [[0, FLOOR, CPZ0], [CPX, FLOOR, CPZ0]], [[0, FLOOR, CPZ1], [CPX, FLOOR, CPZ1]], U.console, [0, 1, 0]);
  }
  const cabAll = new K.Mesh().add(cab).add(cab.mirrorX());
  // instrument panel, glareshield, consoles, seats
  const eyes = [[-Math.abs(EYE[0]), EYEY, EYEZ], [Math.abs(EYE[0]), EYEY, EYEZ]];
  const PZ = EYEZ - 0.78, PT = EYEY - 0.2, PB = FLOOR + 0.45;
  {
    const i0 = cabAll.vertexCount, q = [[-1.15, PB, PZ + 0.08], [1.15, PB, PZ + 0.08], [1.15, PT, PZ], [-1.15, PT, PZ]], uvs = [[0, 0.45], [2.3, 0.45], [2.3, 0], [0, 0]];
    q.forEach((p, k) => { const uv = cPanel.uv(uvs[k][0], uvs[k][1]); cabAll.vert(p[0], p[1], p[2], 0, 0.2, 1, uv[0], uv[1]); });
    cabAll.quad(i0, i0 + 1, i0 + 2, i0 + 3);
    cabAll.add(K.prism([[PZ + 0.02, PT - 0.02], [PZ - 0.02, PT + 0.06], [PZ - 0.32, PT + 0.04], [PZ - 0.32, PT - 0.08]], -0.95, 0.95, U.black));   // glareshield
    cabAll.add(K.boxBetween([-0.22, FLOOR, PZ + 0.05], [0.22, PB + 0.15, EYEZ + 0.3], U.console));                                              // centre console
    for (const e of eyes) {
      cabAll.add(K.ejectionSeat({ eye: e, recline: 13, width: 0.5, uv: { frame: U.seat, cushion: U.cushion, accent: U.accent } }));
      cabAll.add(K.stick({ base: [e[0], FLOOR + 0.25, e[2] - 0.45], height: 0.3, uv: U.black, uvGrip: U.dark }));
      cabAll.add(K.boxBetween([e[0] - 0.3, FLOOR, e[2] - 0.7], [e[0] + 0.3, FLOOR + 0.06, e[2] - 0.2], U.console));   // rudder-pedal floor
    }
  }
  const pilots = new K.Mesh();
  for (const e of eyes) pilots.add(K.pilot({ eye: e, recline: 13, stick: [0, -0.5, -0.4], throttle: [e[0] < 0 ? 0.3 : -0.3, -0.5, -0.3], uv: { suit: U.suit, helmet: U.helmet, visor: U.visor, dark: U.dark, glove: U.glove } }));
  stat.add(cabAll);

  // ---- materials -----------------------------------------------------------------------------------------------------
  lap('geometry');
  paint(atlas, { SC, cTop, cBot, cND, cMD, cPanel, WIN, MB, mbF, mbA, NB, AUX, coat });
  lap('paint');
  const mat = atlas.material(ctx, { envMapIntensity: 0.9 });
  lap('textures');
  rig.material('paint', mat, { shared: true });
  rig.disposables.push(atlas);
  rig.glass('glass', K.glassMaterial(ctx, { tint: '#0e1216', opacity: 0.5, edgeOpacity: 0.9, metalness: 0.35, roughness: 0.04 }));
  rig.material('void', new THREE.MeshBasicMaterial({ color: 0x000000 }));
  const glow = rig.material('glow', K.glowMaterial(), { shadow: false });
  rig.addStatic(stat, 'paint');
  rig.addStatic(glass, 'glass');
  rig.addStatic(new K.Mesh().add(AF.voids).add(AF.voids.mirrorX()), 'void');
  rig.part('engineGlow', glowAll, { key: 'glow' });
  const pilotNode = rig.part('crew', pilots, { pivot: eyes[0] });

  // ---- control surfaces ------------------------------------------------------------------------------------------------
  const C = AF.ctrls, mx = (p) => [-p[0], p[1], p[2]];
  const gla = C.gla, glaMesh = new K.Mesh().add(gla.mesh).add(gla.mesh.mirrorX());
  const glaNode = rig.part('gla', glaMesh, { pivot: gla.a });
  const setGla = rig.hinge(glaNode, [-1, gla.a[1], gla.a[2]], [1, gla.a[1], gla.a[2]], { ref: [0, gla.ref[1], 11.4], toward: [0, 1, 0] });
  const elev = {};
  for (const name of ['elevon1', 'elevon2', 'elevon3']) {
    const c = C[name];
    for (const [side, sx] of [['R', 1], ['L', -1]]) {
      const m = sx > 0 ? c.mesh : c.mesh.mirrorX(), a = sx > 0 ? c.a : mx(c.a), b = sx > 0 ? c.b : mx(c.b), ref = sx > 0 ? c.ref : mx(c.ref);
      const node = rig.part(name + side, m, { pivot: a });
      elev[name + side] = rig.hinge(node, a, b, { ref, toward: [0, 1, 0] });
    }
  }
  const rud = {};
  {
    const c = C.rudder;
    for (const [side, sx] of [['R', 1], ['L', -1]]) for (const [half2, dy] of [['U', 1], ['D', -1]]) {
      const src = half2 === 'U' ? c.upper : c.lower, m = sx > 0 ? src : src.mirrorX();
      const a = sx > 0 ? c.a : mx(c.a), b = sx > 0 ? c.b : mx(c.b), ref = sx > 0 ? c.ref : mx(c.ref);
      const node = rig.part('dragRudder' + side + half2, m, { pivot: a });
      rud[side + half2] = rig.hinge(node, a, b, { ref, toward: [0, dy, 0] });
    }
  }

  // ---- landing gear ------------------------------------------------------------------------------------------------------
  const gp = Gm.gear;
  const doorFrom = (reg, uvFn) => {
    const d = K.thicken(reg.mesh, 0.035, U.doorIn);
    if (uvFn) for (let i = 0; i < reg.mesh.vertexCount; i++) { const uv = uvFn(d.p[i * 3], d.p[i * 3 + 2]); d.uv[i * 2] = uv[0]; d.uv[i * 2 + 1] = uv[1]; }
    return d;
  };
  const yl = (x, z) => yLow(Math.abs(x), z);
  // wells (both sides)
  const wellsR = new K.Mesh().add(K.well(K.merge(REG.mainIn.mesh, REG.mainOut.mesh), 1.05, U.well)).add(K.well(REG.nose.mesh, 0.7, U.well));
  rig.addStatic(new K.Mesh().add(wellsR).add(wellsR.mirrorX()), 'paint');
  const auxW = new K.Mesh(); for (const r of [REG.aux0, REG.aux1]) auxW.add(K.well(r.mesh, 0.35, U.duct));
  rig.addStatic(new K.Mesh().add(auxW).add(auxW.mirrorX()), 'void');
  // door meshes (right) with door-chart UVs on the outer faces
  const ndUV = (side) => (x, z) => cND[side].uv(side === 'R' ? (NB[3][1] + 0.2) - z : z - (NB[0][1] - 0.2) , 0.5 - Math.abs(x));
  const mdUV = (side) => (x, z) => cMD[side].uv(side === 'R' ? (MB.za + 0.1) - z : z - (MB.zf - 0.1), MB.xo - Math.abs(x));
  const noseDoorR = doorFrom(REG.nose, ndUV('R'));
  const noseDoorL = (() => { const d = doorFrom(REG.nose).mirrorX(); const f = ndUV('L'); for (let i = 0; i < REG.nose.mesh.vertexCount; i++) { const uv = f(d.p[i * 3], d.p[i * 3 + 2]); d.uv[i * 2] = uv[0]; d.uv[i * 2 + 1] = uv[1]; } return d; })();
  const mainOutR = doorFrom(REG.mainOut, mdUV('R')), mainInR = doorFrom(REG.mainIn);
  const mainOutL = (() => { const d = doorFrom(REG.mainOut).mirrorX(); const f = mdUV('L'); for (let i = 0; i < REG.mainOut.mesh.vertexCount; i++) { const uv = f(d.p[i * 3], d.p[i * 3 + 2]); d.uv[i * 2] = uv[0]; d.uv[i * 2 + 1] = uv[1]; } return d; })();
  const mainInL = doorFrom(REG.mainIn).mirrorX();

  const nzA = NB[1][1], nzB = NB[2][1];
  K.buildGear(rig, atlas, {
    name: 'nose', index: 0, contact: gp[0].pos, wheelRadius: gp[0].wheelRadius, wheelWidth: 0.26, wheels: [-0.21, 0.21],
    pivot: [0, -0.2, -5.35], stroke: 0.32, staticFrac: 0.4, strutR: 0.085, fork: 'axle', steer: true, links: 'front',
    retract: { to: [0, -0.25, -7.4] }, window: [0.25, 0.9], brace: [0, -0.3, -4.6],
    doors: [
      { name: 'noseDoorR', mesh: noseDoorR, hinge: { a: [0.5, yl(0.5, nzA), nzA], b: [0.5, yl(0.5, nzB), nzB] }, ref: [0.25, yl(0.25, -6.4), -6.4], open: 88, toward: [0, -1, 0], window: [0.02, 0.24] },
      { name: 'noseDoorL', mesh: noseDoorL, hinge: { a: [-0.5, yl(0.5, nzA), nzA], b: [-0.5, yl(0.5, nzB), nzB] }, ref: [-0.25, yl(0.25, -6.4), -6.4], open: 88, toward: [0, -1, 0], window: [0.02, 0.24] },
    ],
    lamps: [{ kind: 'landing', pos: [-0.16, -1.15, -5.62], size: 0.07, color: [1, 0.96, 0.88] }, { kind: 'taxi', pos: [0.16, -1.15, -5.62], size: 0.06, color: [1, 0.96, 0.88] }],
  });
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, X = (v) => sx * v;
    const bogie = K.buildGear(rig, atlas, {
      name: 'main' + key, index: i, contact: c, wheelRadius: gp[i].wheelRadius, wheelWidth: 0.36, wheels: [-0.3, 0.3], axles: [-0.72, 0.72],
      pivot: [c[0], -0.2, 1.5], stroke: 0.42, staticFrac: 0.4, strutR: 0.12, fork: 'axle', links: 'rear',
      retract: { to: [c[0], -0.32, 1.5 - 2.25] }, window: [0.25, 0.9], brace: [X(4.0), -0.35, 2.3],
      doors: [
        { name: 'mainDoorOut' + key, mesh: sx > 0 ? mainOutR : mainOutL, hinge: { a: [X(MB.xo), yl(MB.xo, mbF(MB.xo)), mbF(MB.xo)], b: [X(MB.xo), yl(MB.xo, mbA(MB.xo)), mbA(MB.xo)] }, ref: [X(4.8), yl(4.8, 0), 0], open: 92, toward: [0, -1, 0], window: [0.02, 0.24] },
        { name: 'mainDoorIn' + key, mesh: sx > 0 ? mainInR : mainInL, hinge: { a: [X(MB.xi), yl(MB.xi, mbF(MB.xi)), mbF(MB.xi)], b: [X(MB.xi), yl(MB.xi, mbA(MB.xi)), mbA(MB.xi)] }, ref: [X(4.1), yl(4.1, 0), 0], open: 92, toward: [0, -1, 0], window: [0.02, 0.24] },
      ],
    });
    // the bogie rotates level with the leg while it folds forward into the bay
    rig.onUpdate((S) => { const down = K.seq(S.sf.gear, 0.25, 0.9); bogie.piston.quaternion.setFromAxisAngle(bogie.axle, -(1 - down) * 88 * DEG); });
  }

  // ---- auxiliary inlet doors (blow-in, open with the gear down) -------------------------------------------------------
  const aux = [];
  for (const [k, r] of [[0, REG.aux0], [1, REG.aux1]]) {
    const pts = AUX[k], za = pts[0][1], x0 = pts[0][0], x1 = pts[1][0];
    const m = K.thicken(r.mesh, 0.02, U.duct);
    for (const [sx, side] of [[1, 'R'], [-1, 'L']]) {
      const mm = sx > 0 ? m : m.mirrorX(), a = [sx * x0, yUp(x0, za), za], b = [sx * x1, yUp(x1, za), za];
      const node = rig.part('auxDoor' + side + k, mm, { pivot: a });
      aux.push(rig.hinge(node, a, b, { ref: [sx * (x0 + x1) / 2, yUp((x0 + x1) / 2, za + 0.6), za + 0.6], toward: [0, -1, 0] }));
    }
  }

  // ---- lamps -------------------------------------------------------------------------------------------------------------
  const Lt = Gm.lights;
  rig.lamp('nav', Lt.navLeft, { color: [1, 0.04, 0.02], size: 0.06, squash: [0.6, 0.5, 1.4] });
  rig.lamp('nav', Lt.navRight, { color: [0.02, 1, 0.25], size: 0.06, squash: [0.6, 0.5, 1.4] });
  rig.lamp('nav', Lt.tail, { color: [1, 1, 1], size: 0.05, parent: glaNode });
  rig.lamp('strobe', Lt.strobe, { color: [1, 1, 1], size: 0.06, squash: [1, 0.5, 1] });
  rig.lamp('beacon', Lt.beacon, { color: [1, 0.05, 0.03], size: 0.08, squash: [1, 0.5, 1] });

  // ---- animation ---------------------------------------------------------------------------------------------------------
  rig.onUpdate((S) => {
    const sf = S.sf, gearDown = K.seq(sf.gear, 0.3, 0.9);
    const droop = Math.max(sf.flaps, 0) * 10;                                          // elevon "flap" droop with the gear
    const E = (e, a, ke, ka) => Math.max(-30, Math.min(30, e * ke + a * ka - droop)) * DEG;
    elev.elevon1R(E(sf.elevatorR, sf.aileronR, 22, 10)); elev.elevon1L(E(sf.elevatorL, sf.aileronL, 22, 10));
    elev.elevon2R(E(sf.elevatorR, sf.aileronR, 16, 20)); elev.elevon2L(E(sf.elevatorL, sf.aileronL, 16, 20));
    elev.elevon3R(E(sf.elevatorR, sf.aileronR, 10, 25)); elev.elevon3L(E(sf.elevatorL, sf.aileronL, 10, 25));
    setGla(((sf.elevatorL + sf.elevatorR) / 2) * 20 * DEG);
    // split drag rudders: symmetric speedbrake, differential for yaw (the side the rudder points to opens),
    // cracked open on the ground and on approach (gear down)
    const base = Math.max(sf.speedbrake * 45, gearDown * 15);
    const openR = Math.min(60, base + Math.max(0, sf.rudder) * 45), openL = Math.min(60, base + Math.max(0, -sf.rudder) * 45);
    rud.RU(openR * DEG); rud.RD(openR * DEG); rud.LU(openL * DEG); rud.LD(openL * DEG);
    for (const s of aux) s(gearDown * 30 * DEG);
    // faint exhaust glow on the slot faces
    let n1 = 0; for (const e of S.eng) n1 += e.running ? e.n1 : 0; n1 /= Math.max(1, S.eng.length);
    const hot = Math.max(0, (n1 - 0.3) / 0.7), k = (0.05 + 0.25 * S.night) * hot;
    glow.color.setRGB(1.6 * k, 0.45 * k, 0.12 * k);
    pilotNode.visible = !rig.cameraInCockpit;
  });
  const visual = rig.build();
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES;
  return visual;
}

// ===================================================================================================================
// paint
// ===================================================================================================================
/** Forwards world-plan (x, z) painting to the sheared inner + outer wing charts (paint coords a = x, b = z - x·tan33). */
function dualPen(pens) {
  const S = (pts) => pts.map(p => [p[0], p[1] - T33 * p[0]]);
  const open = (pts) => { const q = S(pts); return (g) => q.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); };
  return {
    fill: (path, f, o) => pens.forEach(P => P.fill(path === 'all' ? 'all' : S(path), f, o)),
    stroke: (pts, w, f, o) => pens.forEach(P => P.stroke(open(pts), w, f, o)),
    line: (pts, o) => pens.forEach(P => P.line(S(pts), o)),
    panel: (a0, b0, a1, b1, o) => pens.forEach(P => P.line(S([[a0, b0], [a1, b0], [a1, b1], [a0, b1], [a0, b0]]), o)),
    streak: (a0, b0, a1, b1, w, o) => pens.forEach(P => P.streak(a0, b0 - T33 * a0, a1, b1 - T33 * a1, w, o)),
    noise: (o) => pens.forEach(P => P.noise(o)),
    wear: (pts, w, f, o) => pens.forEach(P => P.wear(open(pts), w, f, o)),
  };
}

function paint(atlas, o) {
  const { SC, cTop, cBot, cND, cMD, cPanel, WIN, MB, mbF, mbA, NB, AUX, coat } = o, F = K.FINISH;
  const rnd = (() => { let s = SC.chalk ? 977 : 4711; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  const at = (a, f) => [a, zLE(a) + f * chord(a)];
  const fLine = (f, a0 = 0, a1 = TIP - 0.25, n = 44) => { const r = []; for (let k = 0; k <= n; k++) r.push(at(a0 + (a1 - a0) * k / n, f)); return r; };
  const lePoly = (w) => { const pts = []; for (let k = 0; k <= 26; k++) { const a = k / 26 * TIP; pts.push([a, zLE(a)]); } for (let k = 26; k >= 0; k--) { const a = k / 26 * TIP; pts.push([a, zLE(a) + w * (1 - 0.6 * a / TIP)]); } return pts; };
  const weathered = !!SC.chalk;
  const FR = [0, 0.07, 0.19, 0.33, 0.48, 0.63, 0.8, 1], SP = [0, 0.95, 2.0, 3.05, 4.4, 5.9, 7.5, 9.3, XN, 13.6, 16.1, 18.8, XO, 24.0, TIP];
  const seamF = coat(SC.seam), patchF = coat(SC.patch);
  const tape = (P, pts, w = 0.055, alpha = weathered ? 0.7 : 0.45) => P.stroke(pts, w, seamF, { alpha });
  const joint = (P, pts) => P.line(pts, { px: 1, depth: 0.14, dark: 0.045 });
  const zig = (x0, x1, z, n, dir) => { const r = [], w = (x1 - x0) / n; for (let k = 0; k <= 2 * n; k++) r.push([x0 + w * k / 2, z + (k % 2) * dir * (w / 2) * T33]); return r; };

  for (const [charts, top] of [[cTop, true], [cBot, false]]) {
    const P = dualPen(charts.map(c => atlas.pen(c)));
    P.fill('all', coat(top ? SC.skin : SC.under));
    // panel patchwork: large skin panels in faintly different tones (the coating is applied and repaired panel by panel)
    for (let k = 0; k < FR.length - 1; k++) for (let m = 0; m < SP.length - 1; m++) {
      const q = [at(SP[m], FR[k]), at(SP[m + 1], FR[k]), at(SP[m + 1], FR[k + 1]), at(SP[m], FR[k + 1])], r = rnd();
      P.fill(q, r < 0.5 ? patchF : seamF, { alpha: (weathered ? 0.14 : 0.1) + rnd() * (weathered ? 0.24 : 0.14) });
    }
    if (weathered) for (let k = 0; k < 22; k++) {                     // fresh repair patches
      const a = 0.4 + rnd() * 23, z = zLE(a) + 0.5 + rnd() * Math.max(0.3, chord(a) - 1.4), w = 0.25 + rnd() * 1.1, h = 0.2 + rnd() * 0.8;
      P.fill([[a, z], [a + w, z], [a + w, z + h], [a, z + h]], coat(rnd() < 0.6 ? '#40454c' : '#53585f'), { alpha: 0.3 + rnd() * 0.3 });
    }
    // panel joints (barely visible) with taped seams on the main joints
    for (let k = 1; k < FR.length - 1; k++) { const L = fLine(FR[k]); joint(P, L); if (k === 2 || k === 5) tape(P, L); }
    for (let m = 1; m < SP.length - 1; m++) { const L = [at(SP[m], 0.02), at(SP[m], 0.995)]; joint(P, L); if (m % 3 === 1) tape(P, L, 0.05); }
    // leading-edge strip (lighter edge treatment) and its seam
    P.fill(lePoly(0.3), coat(SC.le), { alpha: 0.85 });
    tape(P, lePoly(0.3).slice(27), 0.04);
    // control-surface gaps and the taped hinge line ahead of them
    for (const C of CTRL) {
      const pts = []; for (let k = 0; k <= 10; k++) { const a = C.x0 + (C.x1 - C.x0) * k / 10; pts.push([a, C.hz(a)]); }
      P.line([[C.x0, zTE(C.x0)], ...pts, [C.x1, zTE(C.x1)]], { px: 2, depth: 0.7, dark: 0.45 });
      tape(P, pts.map(p => [p[0], p[1] - 0.12]), 0.07);
    }
    if (top) {
      // exhaust decks: heat-resistant tiles, sooty towards the trailing edge
      for (const e of ENG) {
        const x0 = e.cx - EHW, x1 = e.cx + EHW, poly = [[x0, e.z], [x1, e.z], [x1, zTE(x1)], [x0, zTE(x0)]];
        P.fill(poly, { color: SC.tile, rough: 0.74, metal: 0.05 });
        for (let z = e.z + 0.16; z < zTE(x0); z += 0.16) P.line([[x0, z], [x1, z]], { px: 1, depth: 0.3, dark: 0.22 });
        for (let x = x0 + 0.157; x < x1; x += 0.157) P.line([[x, e.z], [x, zTE(x)]], { px: 1, depth: 0.3, dark: 0.22 });
        P.fill(poly, { color: '#1a1614' }, { alpha: 0.3 });
        P.streak(e.cx, e.z + 0.1, e.cx, zTE(e.cx) + 0.3, EHW * 1.6, { alpha: 0.35, color: '12,10,9' });
        P.fill([[x0 - 0.12, e.z - 0.15], [x1 + 0.12, e.z - 0.15], [x1 + 0.12, zTE(x1 + 0.12)], [x0 - 0.12, zTE(x0 - 0.12)]], { color: '#2b2522' }, { alpha: 0.22, feather: 8 });
        tape(P, [[x0 - 0.08, zTE(x0 - 0.08)], [x0 - 0.08, e.z - 0.1], [x1 + 0.08, e.z - 0.1], [x1 + 0.08, zTE(x1 + 0.08)]], 0.06);
      }
      // inlet ramps darken into the ducts; taped outline round each inlet; engine access panels behind
      for (const cx of INLETS) {
        P.fill([[cx - IHW, ZLIP - 1.1], [cx + IHW, ZLIP - 1.1], [cx + IHW, ZLIP + 0.3], [cx - IHW, ZLIP + 0.3]], { color: '#16181b' }, { alpha: 0.55, feather: 10 });
        tape(P, [[cx - IHW - 0.25, ZLIP - 2.2], [cx - IHW - 0.25, ZLIP + 0.9], [cx + IHW + 0.25, ZLIP + 0.9], [cx + IHW + 0.25, ZLIP - 2.2]], 0.06);
        for (const [z0, z1] of [[0.2, 2.4], [2.7, 5.4]]) P.panel(cx - 0.62, z0, cx + 0.62, z1, { px: 1, depth: 0.2, dark: 0.07, r: 0.08 });
      }
      for (const a of AUX) { P.stroke(a.concat([a[0]]), 0.035, { color: '#22252a' }); tape(P, [[a[0][0] - 0.08, a[0][1] - 0.08], [a[1][0] + 0.08, a[1][1] - 0.08], [a[2][0] + 0.08, a[2][1] + 0.08], [a[3][0] - 0.08, a[3][1] + 0.08], [a[0][0] - 0.08, a[0][1] - 0.08]], 0.04); }
      // flight-deck windows: dark frames and the taped seam round the hump
      for (const w of [WIN.front, WIN.side]) { P.fill(w, F.paintedGlass); P.stroke(w.concat([w[0]]), 0.08, { color: '#24272b', rough: 0.55, metal: 0 }); }
      { const r = []; for (let k = 0; k <= 24; k++) { const t = k / 24 * Math.PI; r.push([Math.sin(t) * 1.95, -5.3 - Math.cos(t) * 2.3]); } tape(P, r, 0.06); }
      // dorsal air-refuelling receptacle (slipway doors) behind the cockpit, with its lead-in stripes
      P.fill([[0, -3.45], [0.24, -3.4], [0.24, -2.4], [0, -2.35]], { color: '#26292d', rough: 0.6, metal: 0 });
      P.line([[0, -3.45], [0.24, -3.4], [0.24, -2.4], [0, -2.35]], { px: 1.5, depth: 0.5, dark: 0.3 });
      P.fill([[0, -3.25], [0.1, -3.22], [0.1, -2.6], [0, -2.58]], { color: '#121315', rough: 0.6, metal: 0 });
      for (const x of [0.33, 0.42]) P.stroke([[x, -5.0 + (x - 0.33) * 0.4], [x - 0.08, -3.55]], 0.025, coat('#6c7176'), { alpha: 0.6 });
      // flush air-data ports on the nose
      for (const [x, z] of [[0.55, -8.45], [0.95, -7.95], [1.35, -7.45]]) P.fill([0, 1, 2, 3, 4, 5, 6, 7].map(k => [x + 0.035 * Math.cos(k * Math.PI / 4), z + 0.035 * Math.sin(k * Math.PI / 4)]), { color: '#1a1c1f', rough: 0.4, metal: 0.3 });
    } else {
      // weapon-bay doors: two bays side by side, saw-toothed ends, each closed by two doors
      const zf = -3.1, za = 3.3, x0 = 0.22, x1 = 2.55;
      const front = zig(x0, x1, zf, 3, -1), aft = zig(x0, x1, za, 3, 1);
      const out = front.concat(aft.slice().reverse()); out.push(out[0]);
      P.line(out, { px: 1.6, depth: 0.55, dark: 0.32 }); tape(P, out, 0.07);
      P.line([[(x0 + x1) / 2, zf], [(x0 + x1) / 2, za]], { px: 1.3, depth: 0.45, dark: 0.25 });
      P.line([[0, zf - 0.4], [0, za + 0.4]], { px: 1, depth: 0.2, dark: 0.08 });
      // gear doors: exact outlines plus tape
      const md = [[MB.xi, mbF(MB.xi)], [MB.xo, mbF(MB.xo)], [MB.xo, mbA(MB.xo)], [MB.xi, mbA(MB.xi)], [MB.xi, mbF(MB.xi)]];
      P.line(md, { px: 1.6, depth: 0.55, dark: 0.35 }); tape(P, md.map(p => [p[0] + (p[0] > 4.5 ? 0.1 : -0.1), p[1] + (p[1] > 0 ? 0.1 : -0.1)]), 0.06);
      P.line(NB.concat([NB[0]]), { px: 1.6, depth: 0.55, dark: 0.35 });
      // access panels and flush antennas
      for (const [xa, za2, xb, zb] of [[0.6, -6.6, 1.3, -5.6], [5.8, -1.4, 6.6, -0.2], [7.2, 0.5, 8.0, 1.6], [3.0, 4.2, 4.2, 5.4], [0.3, 4.4, 1.6, 6.0]]) P.panel(xa, za2, xb, zb, { px: 1, depth: 0.25, dark: 0.08, r: 0.06 });
      for (const [x, z] of [[1.9, -6.2], [6.2, 2.4], [0.8, 7.0]]) P.fill([[x, z], [x + 0.35, z], [x + 0.35, z + 0.18], [x, z + 0.18]], { color: '#2c2f33', rough: 0.5, metal: 0 }, { alpha: 0.8 });
    }
    // weathering: tonal variation, chalking, dirt along the leading edge
    P.noise({ alpha: SC.noise, scale: 3.4, stretch: [1, 1.3] });
    if (weathered) P.noise({ alpha: SC.chalk, scale: 6, mode: 'light', rough: 0.06 });
    P.wear([[0.3, zLE(0.3) + 0.03], [TIP - 0.4, zLE(TIP - 0.4) + 0.03]], 0.05, coat('#6d7277'), { alpha: weathered ? 0.5 : 0.25 });
  }
  // door charts: nose-gear doors carry the aircraft name and serial, main outer doors the tail code and serial
  for (const side of ['R', 'L']) {
    const P = atlas.pen(cND[side]); P.fill('all', coat(SC.under));
    P.text(SC.acName, 1.75, 0.19, 0.075, { color: '#18191c', weight: 700 });
    P.text(SC.serial, 1.75, 0.33, 0.055, { color: '#18191c', weight: 700 });
    P.noise({ alpha: SC.noise, scale: 1.2 });
    const M = atlas.pen(cMD[side]); M.fill('all', coat(SC.under));
    M.text(SC.code, 2.25, 0.4, 0.4, { color: '#1b1c20', weight: 700, spacing: 0.04 });
    M.text(SC.serial, 2.25, 0.76, 0.12, { color: '#1b1c20', weight: 700 });
    M.text(SC.unit, 2.25, 0.92, 0.06, { color: '#1b1c20', weight: 700 });
    M.noise({ alpha: SC.noise, scale: 1.5 }); if (weathered) M.noise({ alpha: SC.chalk, scale: 3, mode: 'light' });
  }
  { // instrument panel: eight colour MFDs
    const Q = atlas.pen(cPanel); Q.fill('all', { color: '#1b1d20', rough: 0.6, metal: 0 });
    const scr = (a, b, w, h, col) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#050607', rough: 0.15, metal: 0 }); Q.fill((g) => g.rect(a + 0.012, b + 0.012, w - 0.024, h - 0.024), { color: col, rough: 0.12, metal: 0, emissive: col }); };
    for (let k = 0; k < 4; k++) { scr(0.08 + k * 0.26, 0.1, 0.22, 0.22, k % 2 ? '#10283a' : '#0f2d1a'); scr(1.22 + k * 0.26, 0.1, 0.22, 0.22, k % 2 ? '#0f2d1a' : '#10283a'); }
    for (let i = 0; i < 16; i++) Q.fill((g) => g.rect(0.1 + i * 0.13, 0.36, 0.06, 0.03), { color: i % 4 ? '#3a3c3e' : '#7a6a2a', rough: 0.5, metal: 0 });
  }
}
