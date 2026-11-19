// Boeing 747-8 Intercontinental — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (5.2 m) when parked.
//
// Reference numbers (docs/aircraft/b748.md, Boeing ACAPS 747-8, photographs; d = distance aft of the nose tip, z = d - 38.5):
//   length 76.25 m, span 68.4 m (raked tips, no winglets), height 19.4 m (fin tip at y = 14.2).
//   Main fuselage: circle R 3.25 centred on y = 0 from d 11 to d 50, belly at y = -3.25 (1.95 m above the ground).
//   Upper deck ("hump"): a narrower lobe (half-width 2.42, roof y = 4.8) on the main tube. Its own skin is generated here
//   (humpSkin) rather than taken from the loft: the lobe above a concave fillet that fairs it into the main circle along the
//   whole stretched upper deck, so the double-bubble section has no seam; the fillet also smooths the "forehead" where the
//   lobe rises out of the nose. The flight-deck window openings are cut out of that skin and glazed (real glass), so the
//   flight deck shows from outside; windshield d 5.2-6.2 (lower edge ~ y 2.9), pilot eye [-0.55, 3.35, -31.45].
//   Upper deck tapers back into the crown at d ~ 44 (747-8I, ~ 4 m longer than the -400).
//   Doors: main deck 1-5 at d 9.0, 17.5, 26.0, 51.0, 64.0 (L and R), upper-deck exit d 21.3; cargo doors right side.
//   Windows: main deck 0.508 m pitch at y 0.35, upper deck 0.52 m pitch at y 3.2.
//   Wing: LE root z -12.4 (x 1.4) / kink x 11.2 (LE z -3.5, chord 9) / x 30.4 (LE z 10.44, chord 4) then a raked tip to
//   x 34.2 (LE z 15.4, chord 1.1); LE sweep 42° inboard, 36° outboard, ~53° on the rake; dihedral 7° from y -2.35 at the
//   body side; supercritical section 13.5 % → 8 %. Double-slotted inboard flap (x 3.45-10.45), inboard (high-speed) aileron
//   x 11.35-13.85, single-slotted outboard flap x 14.05-23.9, outboard aileron x 24.1-29.9, two flap-track fairings per flap;
//   Krueger flaps inboard, variable-camber Kruegers outboard; 2 + 4 spoiler panels per wing.
//   Engines (GEnx-2B67): fan Ø 2.6 m (18 swept blades, white spinner spiral), nacelle Ø 3.1 m, inlet lip at z -8 (inboard,
//   x ±11.5, y -3.0) and z 0.8 (outboard, x ±23.5, y -1.6); chevroned bypass and core nozzles; translating reverser sleeves.
//   Tail: stab span 22.2 m, LE 37.5°, root LE z 23 at y 1.0, 7° dihedral, split elevators; fin root LE z 17 at y 2.2, root
//   chord 13.25, tip chord 4.2 at y 14.2, two-piece rudder; APU exhaust at the tail-cone tip.
//   Gear: nose (2 wheels, z -27.5, forward retracting), wing gear x ±5.5 z 0.7 (retract inboard) and body gear x ±2.5 z 4.7
//   (retract forward, steer against the nose wheel), 4-wheel bogies that hang toe-up in flight, 18 wheels.
// The airline and government liveries are invented for this simulator: no real operator's name or marks are reproduced.
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
export const LIVERIES = ['solvane', 'nordhaven', 'house', 'state'];

const SCHEMES = {
  solvane: { name: 'Solvane', title: 'SOLVANE', reg: 'ZZ-SLV', body: '#f4f4f1', belly: '#c9ced3', cheat: '#a3192f', accent: '#d6a33a', tail: '#a3192f', engine: '#f4f4f1', lip: '#a3192f', tip: '#a3192f', titleColor: '#a3192f', font: 'serif', style: 'sun' },
  nordhaven: { name: 'Nordhaven', title: 'NORDHAVEN', reg: 'ZZ-NHV', body: '#f6f7f8', belly: '#1a2b4c', cheat: '#3fa7d6', accent: '#5fd0a8', tail: '#1a2b4c', engine: '#1a2b4c', lip: '#3fa7d6', tip: '#3fa7d6', titleColor: '#1a2b4c', font: 'wide', style: 'aurora' },
  house: { name: 'Skyward house colours', title: 'SKYWARD', reg: 'ZZ-SKQ', body: '#eef0f1', belly: '#8e979f', cheat: '#1d6fd1', accent: '#1d2a3a', tail: '#eef0f1', engine: '#eef0f1', lip: '#1d6fd1', tip: '#1d6fd1', titleColor: '#1d2a3a', font: 'wide', style: 'bands' },
  state: { name: 'Republic of Calvessa (state transport)', title: 'REPUBLIC OF CALVESSA', reg: 'ZZ-001', body: '#f7f7f4', belly: '#0f4d5c', cheat: '#0f4d5c', accent: '#c8a24a', tail: '#f7f7f4', engine: '#f7f7f4', lip: '#c8a24a', tip: '#0f4d5c', titleColor: '#0f4d5c', font: 'serif', style: 'state' },
};

const NZ = -38.5;                      // nose tip z
const D = (d) => d + NZ;               // distance from the nose → body z

// ---- planform helpers (right wing) ------------------------------------------------------------------------------------------
const zLE = (x) => (x <= 11.2 ? -10.7 + 0.9057 * (x - 3.25) : x <= 30.4 ? -3.5 + 0.7261 * (x - 11.2) : 10.44 + (x - 30.4) * 1.30);
const zTE = (x) => (x <= 11.2 ? 4.0 + 0.1887 * (x - 3.25) : x <= 30.4 ? 5.5 + 0.4652 * (x - 11.2) : 14.43 + (x - 30.4) * 0.55);
const wy = (x) => -2.35 + Math.tan(7 * DEG) * (x - 3.25);

// engine centres (inlet highlight plane) — must match geometry.js engines[].intake
const ENG = [[-23.5, -1.6, 0.8], [-11.5, -3.0, -8.0], [11.5, -3.0, -8.0], [23.5, -1.6, 0.8]];
const NAC = { length: 4.7, rHi: 1.33, rMax: 1.55, rThroat: 1.25, rFan: 1.3, zFan: 0.98, rExit: 1.17, sleeve: 0.5, core: { r0: 0.82, r1: 0.52, length: 1.9 }, plug: { r: 0.3, length: 1.05 } };

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
const chain = (A, B) => ({ P: (p) => A.P(B.P(p)), N: (n) => A.N(B.N(n)) });   // B first, then A

/**
 * One draw call for several parts that always move together but about different axes (both sides' flaps, all Krueger
 * panels): the base mesh plus morph targets (positions and normals) at evenly spaced fractions of the travel, blended
 * piecewise so the motion follows the arcs. groups: [{ mesh, pose(f) → { P, N } }]. Returns set(0..1).
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

/** Sawtooth chevron ring at a nozzle exit (kit has none): n triangular teeth from radius r at z, tips `len` aft and `inward` closer to the axis. */
function chevrons(c, z, r, n, len, inward, uv) {
  const m = new K.Mesh();
  for (let i = 0; i < n; i++) {
    const a0 = i / n * TAU, a1 = (i + 1) / n * TAU, am = (a0 + a1) / 2;
    const P = (a, rr, zz) => [c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a), zz];
    const p = [P(a0, r, z), P(a1, r, z), P(am, r - inward, z + len)];
    const e1 = sub(p[1], p[0]), e2 = sub(p[2], p[0]);
    let [nx, ny, nz] = norm(cross(e1, e2));
    const out = nx * Math.cos(am) + ny * Math.sin(am) > 0 ? 1 : -1;
    for (const sg of [1, -1]) {
      const s = sg * out, ids = p.map(q => m.vert(q[0], q[1], q[2], nx * s, ny * s, nz * s, uv[0], uv[1]));
      if (sg > 0) { if (out > 0) m.tri(ids[0], ids[1], ids[2]); else m.tri(ids[0], ids[2], ids[1]); }
      else if (out > 0) m.tri(ids[0], ids[2], ids[1]); else m.tri(ids[0], ids[1], ids[2]);
    }
  }
  return m;
}

/** Write a morph target into `m` (enableMorph first): its vertices rotated by `ang` about the line a→b, in the sense that moves `ref` toward `toward`. */
function rotateMorph(m, a, b, ref, toward, ang) {
  const R = rotor(a, b, ref, toward, ang);
  for (let i = 0; i < m.p.length; i += 3) { const q = R.P([m.p[i], m.p[i + 1], m.p[i + 2]]); m.p2[i] = q[0]; m.p2[i + 1] = q[1]; m.p2[i + 2] = q[2]; }
  return m;
}

// ---- 2-D polygon helpers in (z, t) for cutting the flight-deck windows out of the upper-deck skin -----------------------------
const area2 = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
function clipHalf(poly, a, b, keepLeft) {
  const out = [], side = (p) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * (keepLeft ? 1 : -1);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) { const f = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]); }
  }
  return out;
}
/** poly minus the convex CCW polygon win → convex pieces. */
function subtractConvex(poly, win) {
  const out = []; let rest = poly;
  for (let i = 0; i < win.length && rest.length >= 3; i++) {
    const a = win[i], b = win[(i + 1) % win.length], o = clipHalf(rest, a, b, false);
    if (o.length >= 3 && Math.abs(area2(o)) > 1e-9) out.push(o);
    rest = clipHalf(rest, a, b, true);
  }
  return out;
}

/**
 * Upper-deck skin: the hump loft above a concave fillet that fairs it into the main fuselage circle, with the flight-deck
 * windows cut out. UVs: the lobe uses the hump chart (same mapping as the loft), the fillet the fuselage chart (projected
 * by height), so paint continues across both seams. Returns { skin, panes } (panes: window glass, slightly recessed).
 */
function humpSkin(hump, fus, cHump, cFus, wins, detail) {
  const skin = new K.Mesh(), panes = new K.Mesh();
  const [hz0, hz1] = hump.zRange;
  const xh = (z, y) => hump.at(z, hump.tAtY(z, y)).p[0], xf = (z, y) => (y >= fus.topAt(z) ? 0 : fus.at(z, fus.tAtY(z, y)).p[0]);
  const meet = (z) => {
    const ht = hump.topAt(z), ft = fus.topAt(z); if (ht < ft + 0.012) return null;
    let hi = ft - 0.005, lo = null;
    for (let y = ft - 0.02; y > hump.botAt(z); y -= 0.06) { if (xh(z, y) < xf(z, y)) { lo = y; break; } hi = y; }
    if (lo === null) return null;
    for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (xh(z, m) < xf(z, m)) lo = m; else hi = m; }
    return { y: (lo + hi) / 2, ext: ht - ft };
  };
  const zs = [], span = (a, b, s) => { const n = Math.max(1, Math.ceil((b - a) / s)); for (let i = 0; i < n; i++) zs.push(a + (b - a) * i / n); };
  span(hz0 + 0.02, D(9.2), 0.22 / detail); span(D(9.2), D(34), 0.75 / detail); span(D(34), hz1 - 0.02, 0.34 / detail); zs.push(hz1 - 0.02);
  for (const s of [...(cFus.splits || []), ...(cHump.splits || [])]) if (s > zs[0] && s < zs[zs.length - 1] && zs.every(z => Math.abs(z - s) > 1e-4)) zs.push(s);
  zs.sort((a, b) => a - b);
  const NF = 5, NL = Math.max(28, Math.round(48 * detail) & ~1);
  const rings = zs.map((z) => {
    const q = meet(z); if (!q) return null;
    const tI = hump.tAtY(z, q.y), tIf = fus.tAtY(z, q.y), sf = Math.min(0.5, 0.17 + 0.4 * q.ext);
    const tA = Math.min(z > D(5) && z < D(7.6) ? 0.322 : 0.485, tI + sf / Math.max(0.5, hump.girthAt(z, tI))), tB = Math.max(0.01, tIf - sf / Math.max(0.5, fus.girthAt(z, tIf)));
    const A = hump.at(z, tA), B = fus.at(z, tB);
    const tan = (L, t) => { const a = L.at(z, t - 0.003).p, b = L.at(z, t + 0.003).p, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    const dA = tan(hump, tA), dB = tan(fus, tB), h = sf * 0.55;
    const P0 = [B.p[0], B.p[1]], P1 = [B.p[0] + dB[0] * h, B.p[1] + dB[1] * h], P2 = [A.p[0] - dA[0] * h, A.p[1] - dA[1] * h], P3 = [A.p[0], A.p[1]];
    const fil = [];
    for (let k = 0; k <= NF; k++) {
      const s = k / NF, u = 1 - s;
      const x = u * u * u * P0[0] + 3 * u * u * s * P1[0] + 3 * u * s * s * P2[0] + s * s * s * P3[0], y = u * u * u * P0[1] + 3 * u * u * s * P1[1] + 3 * u * s * s * P2[1] + s * s * s * P3[1];
      const tx = 3 * u * u * (P1[0] - P0[0]) + 6 * u * s * (P2[0] - P1[0]) + 3 * s * s * (P3[0] - P2[0]), ty = 3 * u * u * (P1[1] - P0[1]) + 6 * u * s * (P2[1] - P1[1]) + 3 * s * s * (P3[1] - P2[1]);
      const tl = Math.hypot(tx, ty) || 1, nz = B.n[2] * u + A.n[2] * s, k2 = Math.sqrt(Math.max(0, 1 - nz * nz));
      fil.push({ p: k === 0 ? B.p : k === NF ? A.p : [x, y, z], n: [ty / tl * k2, -tx / tl * k2, nz], tf: fus.tAtY(z, y) });
    }
    const lobe = [];
    for (let j = 0; j <= NL; j++) { const t = tA + (1 - 2 * tA) * j / NL, s = hump.at(z, t); lobe.push({ p: s.p, n: s.n, t }); }
    return { z, fil, lobe };
  });
  // emit a quad / polygon with outward winding (decided against the vertex normals)
  const emit = (M, vs) => {
    const ids = vs.map(v => M.vert(v.p[0], v.p[1], v.p[2], v.n[0], v.n[1], v.n[2], v.uv[0], v.uv[1]));
    for (let i = 1; i < vs.length - 1; i++) {
      const fn = cross(sub(vs[i].p, vs[0].p), sub(vs[i + 1].p, vs[0].p)), nn = add3(add3(vs[0].n, vs[i].n), vs[i + 1].n);
      if (dot(fn, nn) >= 0) M.tri(ids[0], ids[i], ids[i + 1]); else M.tri(ids[0], ids[i + 1], ids[i]);
    }
  };
  const W = [];
  for (const w of wins) for (const s of [1, -1]) { let P = w.map(([z, t]) => [z, s > 0 ? t : 1 - t]); if (area2(P) < 0) P = P.slice().reverse(); const zz = P.map(p => p[0]), tt = P.map(p => p[1]); W.push({ P, z0: Math.min(...zz), z1: Math.max(...zz), t0: Math.min(...tt), t1: Math.max(...tt) }); }
  const lobeV = (z, t, strip) => { const s = hump.at(z, t); return { p: s.p, n: s.n, uv: cHump.uvUnwrap(z, t, strip) }; };
  for (let i = 0; i + 1 < rings.length; i++) {
    const r0 = rings[i], r1 = rings[i + 1]; if (!r0 || !r1) continue;
    const zm = (r0.z + r1.z) / 2, sF = cFus.stripAt(zm), sH = cHump.stripAt(zm);
    for (const side of [1, -1]) {             // fillets (fuselage chart)
      const fv = (r, k) => { const f = r.fil[k]; return { p: [f.p[0] * side, f.p[1], f.p[2]], n: [f.n[0] * side, f.n[1], f.n[2]], uv: cFus.uvUnwrap(r.z, side > 0 ? f.tf : 1 - f.tf, sF) }; };
      for (let k = 0; k < NF; k++) emit(skin, [fv(r0, k), fv(r0, k + 1), fv(r1, k + 1), fv(r1, k)]);
    }
    for (let j = 0; j < NL; j++) {            // lobe (hump chart), windows cut out
      const a = r0.lobe[j], b = r0.lobe[j + 1], c = r1.lobe[j + 1], d = r1.lobe[j];
      const cell = [[r0.z, a.t], [r0.z, b.t], [r1.z, c.t], [r1.z, d.t]];
      const tlo = Math.min(a.t, d.t), thi = Math.max(b.t, c.t), hits = W.filter(w => w.z1 > r0.z && w.z0 < r1.z && w.t1 > tlo && w.t0 < thi);
      if (!hits.length) { emit(skin, [a, b, c, d].map((v, k) => ({ p: v.p, n: v.n, uv: cHump.uvUnwrap(k < 2 ? r0.z : r1.z, v.t, sH) }))); continue; }
      let pieces = [cell]; for (const w of hits) pieces = pieces.flatMap(p => subtractConvex(p, w.P));
      for (const pc of pieces) emit(skin, pc.map(([z, t]) => lobeV(z, t, sH)));
    }
  }
  // glazing: each window as a fan from its centre with subdivided edges so the pane follows the skin
  for (const w of W) {
    const P = w.P, c = P.reduce((s, p) => [s[0] + p[0] / P.length, s[1] + p[1] / P.length], [0, 0]), ring = [];
    for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; for (let k = 0; k < 3; k++) ring.push([p[0] + (q[0] - p[0]) * k / 3, p[1] + (q[1] - p[1]) * k / 3]); }
    const V = ([z, t]) => { const s = hump.at(z, t); return { p: sub(s.p, s.n.map(v => v * 0.012)), n: s.n, uv: [0, 0] }; };
    for (let i = 0; i < ring.length; i++) emit(panes, [V(c), V(ring[i]), V(ring[(i + 1) % ring.length])]);
  }
  return { skin, panes };
}

/** GEnx fan: 18 swept composite blades with a curved tip, conical spinner with a white spiral. Front face at z = 0. */
function genxFan(o) {
  const R = o.radius, hub = o.hub, nb = o.blades, m = new K.Mesh(), NS = 8, uvB = o.uvBlade;
  for (let i = 0; i < nb; i++) {
    const phi0 = i / nb * TAU, rows = [];
    for (let k = 0; k <= NS; k++) {
      const f = k / NS, r = hub * 0.97 + (R - hub * 0.97) * f, beta = (26 + 38 * Math.pow(f, 0.85)) * DEG;
      const cc = R * (0.34 + 0.28 * Math.sin(Math.PI * Math.min(1, f * 0.95 + 0.05)) - 0.12 * f * f), sweep = R * (0.05 * f + 0.18 * f * f * f), lean = 0.15 * f * f;
      const phi = phi0 + lean, rad = [Math.cos(phi), Math.sin(phi), 0], tan = [-Math.sin(phi), Math.cos(phi), 0];
      const dir = [tan[0] * Math.sin(beta), tan[1] * Math.sin(beta), Math.cos(beta)], zc = 0.2 + sweep;
      rows.push({ le: [rad[0] * r - dir[0] * cc * 0.45, rad[1] * r - dir[1] * cc * 0.45, zc - dir[2] * cc * 0.45], te: [rad[0] * r + dir[0] * cc * 0.55, rad[1] * r + dir[1] * cc * 0.55, zc + dir[2] * cc * 0.55], n: cross(dir, rad) });
    }
    for (const sg of [1, -1]) {
      const base = m.vertexCount;
      for (const q of rows) { m.vert(...q.le, q.n[0] * sg, q.n[1] * sg, q.n[2] * sg, uvB[0], uvB[1]); m.vert(...q.te, q.n[0] * sg, q.n[1] * sg, q.n[2] * sg, uvB[0], uvB[1]); }
      for (let k = 0; k < NS; k++) { const a = base + k * 2, b = a + 1, c = a + 3, d = a + 2; if (sg > 0) m.quad(a, b, c, d); else m.quad(a, d, c, b); }
    }
  }
  m.occlude((x, y) => 0.5 - 0.35 * Math.min(1, Math.hypot(x, y) / R));
  const sl = 0.78, prof = [[0, -sl], [hub * 0.1, -sl * 0.93], [hub * 0.42, -sl * 0.6], [hub * 0.75, -sl * 0.28], [hub * 0.97, -0.02], [hub, 0.15], [hub, 0.62, 1], [0, 0.62]];
  m.add(K.lathe(prof, { segments: 28, uv: o.uvSpinner }));
  const pts = []; for (let k = 0; k <= 16; k++) { const f = 0.1 + 0.85 * k / 16, z = -sl * (1 - f), r = hub * (0.1 + 0.9 * f) * 1.012 + 0.01, a = 2.8 * f; pts.push([r * Math.cos(a), r * Math.sin(a), z]); }
  m.add(K.pipe(pts, 0.042, { segments: 6, uv: o.uvSwirl }));
  return m;
}

/**
 * Four-wheel main-gear bogie: oleo leg hinged at `pivot`, chrome piston, tilting truck (toe-up when hanging), brake stacks,
 * hydraulic lines, optional truck steering (body gear) and leg door; well door hinged on the fairing.
 * Parts: strut, piston, truck, front and rear wheel pairs, well door.
 */
function bogieGear(rig, o) {
  const ctx = rig.ctx, V = (a) => new THREE.Vector3(a[0], a[1], a[2]), Ar = (v) => [v.x, v.y, v.z], U = o.uv;
  const P = V(o.pivot), R = o.R, wW = o.wW, stroke = o.stroke, eStatic = stroke * (1 - o.staticFrac);
  const contact = V(o.contact), C = contact.clone().add(new THREE.Vector3(0, R, 0));
  const d = C.clone().sub(P), Lp = d.length(); d.normalize();
  const Lo = Lp - (eStatic + 0.7), Bt = P.clone().addScaledVector(d, Lo), sr = o.strutR;
  const v1 = d.clone(), v2 = V(o.stow).sub(P).normalize(), rAxis = new THREE.Vector3().crossVectors(v1, v2).normalize(), rAngle = Math.acos(Math.min(1, Math.max(-1, v1.dot(v2))));
  const leg = rig.node(o.name + '.leg', { pivot: Ar(P) });
  const sm = new K.Mesh(), side = new THREE.Vector3(o.side, 0, 0);
  sm.add(K.tube(Ar(P), Ar(Bt), sr, sr * 0.95, { segments: 16, uv: U.strut }));
  sm.add(K.tube(Ar(Bt.clone().addScaledVector(d, -0.12)), Ar(Bt.clone().addScaledVector(d, 0.02)), sr * 1.16, sr * 1.16, { segments: 16, uv: U.strut }));
  sm.add(K.tube(Ar(P.clone().addScaledVector(rAxis, -0.6)), Ar(P.clone().addScaledVector(rAxis, 0.6)), sr * 0.8, sr * 0.8, { segments: 12, uv: U.strut }));
  for (const f of [0.28, 0.7]) sm.add(K.tube(Ar(P.clone().addScaledVector(d, Lo * f - 0.02)), Ar(P.clone().addScaledVector(d, Lo * f + 0.02)), sr * 1.08, sr * 1.08, { segments: 16, uv: U.link }));
  for (const [end, r] of [[o.brace, 0.075], [o.drag, 0.085]]) {
    if (!end) continue;
    const b0 = P.clone().addScaledVector(d, Lo * 0.55), b1 = V(end), mid = b0.clone().lerp(b1, 0.5).addScaledVector(d, 0.12);
    sm.add(K.tube(Ar(b0), Ar(mid), r, r, { segments: 8, uv: U.link })).add(K.tube(Ar(mid), Ar(b1), r * 0.9, r * 0.9, { segments: 8, uv: U.link }));
    sm.add(K.ellipsoid(r * 1.5, r * 1.5, r * 1.5, { segments: 8, rings: 4, uv: U.link }).translate(mid.x, mid.y, mid.z));
  }
  { // hydraulic and brake lines down the aft face of the strut
    const aft = new THREE.Vector3(0, 0, 1).addScaledVector(d, -d.z).normalize();
    for (const [k, r] of [[-0.45, 0.014], [-0.15, 0.011], [0.25, 0.012]]) {
      const off = aft.clone().addScaledVector(side, k).normalize().multiplyScalar(sr + r * 1.8);
      const q = (f, lift = 0) => Ar(P.clone().addScaledVector(d, Lo * f).add(off).addScaledVector(off, lift));
      sm.add(K.pipe([q(0.04, 0.6), q(0.1), q(0.5), q(0.92), q(1.0, 0.5)], r, { segments: 5, uv: U.hose }));
    }
  }
  if (o.legDoor) { // leg door on the outboard face of the strut
    const out = side.clone().addScaledVector(d, -d.x * o.side).normalize().multiplyScalar(sr + 0.08), fw = new THREE.Vector3(0, 0, -1).addScaledVector(d, d.z).normalize();
    const q = (s, f) => Ar(P.clone().addScaledVector(d, s).add(out).addScaledVector(fw, f));
    sm.add(K.plate(q(0.05, 0.62), q(0.05, -0.55), q(Lo * 0.97, -0.5), q(Lo * 0.97, 0.55), 0.03, o.legDoor));
  }
  rig.part(o.name + '.strut', sm, { parent: leg, pivot: Ar(P), ao: false });
  // piston + truck yoke + torque links
  const pm = new K.Mesh(), yoke = C.clone().addScaledVector(d, -0.24);
  pm.add(K.tube(Ar(Bt.clone().addScaledVector(d, -(stroke + 0.12))), Ar(yoke), sr * 0.62, sr * 0.62, { segments: 14, uv: U.chrome }));
  pm.add(K.tube(Ar(yoke), Ar(C), sr * 0.78, sr * 0.6, { segments: 12, uv: U.strut }));
  pm.add(K.tube([C.x - 0.26, C.y, C.z], [C.x + 0.26, C.y, C.z], 0.11, 0.11, { segments: 10, uv: U.link }));
  { const s0 = Bt.clone().add(new THREE.Vector3(0, 0, -sr * 1.1)), s1 = yoke.clone().add(new THREE.Vector3(0, 0, -sr * 0.85)), apex = s0.clone().lerp(s1, 0.5).add(new THREE.Vector3(0, 0, -0.34));
    pm.add(K.tube(Ar(s1), Ar(apex), 0.04, 0.035, { segments: 6, uv: U.link })); sm.add(K.tube(Ar(s0), Ar(apex), 0.04, 0.035, { segments: 6, uv: U.link })); }
  const piston = rig.part(o.name + '.piston', pm, { parent: leg, pivot: Ar(C), ao: false });
  const yaw = rig.node(o.name + '.yaw', { parent: piston, pivot: Ar(C) });
  // truck: beam, axles, brake rods, pitch damper
  const ax = o.axle, tr = o.track, bm = new K.Mesh();
  bm.add(K.tube([C.x, C.y + 0.02, C.z - ax - 0.34], [C.x, C.y + 0.02, C.z + ax + 0.34], 0.14, 0.14, { segments: 12, uv: U.strut }));
  for (const z of [-ax, ax]) {
    bm.add(K.tube([C.x - tr - wW * 0.3, C.y, C.z + z], [C.x + tr + wW * 0.3, C.y, C.z + z], 0.09, 0.09, { segments: 10, uv: U.link }));
    for (const s of [-1, 1]) bm.add(K.tube([C.x + s * 0.13, C.y + 0.14, C.z + z * 0.45], [C.x + s * 0.13, C.y + 0.05, C.z + z * 0.95], 0.032, 0.032, { segments: 5, uv: U.link }));
  }
  bm.add(K.tube([C.x + 0.2, C.y + 0.75, C.z - 0.15], [C.x + 0.2, C.y + 0.12, C.z - ax * 0.7], 0.045, 0.04, { segments: 6, uv: U.chrome }));   // truck pitch damper
  const truck = rig.part(o.name + '.truck', bm, { parent: yaw, pivot: Ar(C), ao: false });
  const wheelSet = (z) => {
    const m = new K.Mesh();
    for (const x of [-tr, tr]) {
      const one = K.wheel({ radius: R, width: wW, uvTyre: U.tyre, uvHub: U.hub, segments: o.segments ?? 22, tyreStrip: U.tyreStrip, hubStrip: U.hubStrip });
      const sg = -Math.sign(x), rb = R * 0.56 * 0.7, x0 = sg * wW * 0.28, x1 = sg * Math.min(wW * 0.62, Math.abs(x) - 0.12);     // brake stack on the beam side
      if (Math.abs(x1) > Math.abs(x0) + 0.01) one.add(K.lathe([[rb * 0.45, 0], [rb, 0, 1], [rb, Math.abs(x1 - x0) * 0.75], [rb * 0.8, Math.abs(x1 - x0), 1], [rb * 0.45, Math.abs(x1 - x0)]], { segments: 14, uv: U.brake }).rotateY(sg * Math.PI / 2).translate(x0, 0, 0));
      m.add(one.translate(C.x + x, C.y, C.z + z));
    }
    return m;
  };
  const wf = rig.part(o.name + '.wheelF', wheelSet(-ax), { parent: truck, pivot: [C.x, C.y, C.z - ax], ao: false });
  const wr = rig.part(o.name + '.wheelR', wheelSet(ax), { parent: truck, pivot: [C.x, C.y, C.z + ax], ao: false });
  const dn = rig.part(o.name + '.door', o.door.mesh, { pivot: o.door.edge[0], ao: false });
  const setDoor = rig.hinge(dn, o.door.edge[0], o.door.edge[1], { ref: o.door.ref, toward: [0, -1, 0] });
  const win = o.window, X = new THREE.Vector3(1, 0, 0), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), qT = new THREE.Quaternion(), qL = new THREE.Quaternion();
  const rest = piston.position.clone();
  let ext = eStatic, spin = 0, rate = 0, first = true;
  rig.onUpdate((S, dt) => {
    const g = S.sf.gear, down = K.seq(g, win[0], win[1]);
    setDoor(Math.min(K.seq(g, 0.02, win[0] - 0.01), 1 - K.seq(g, win[1] + 0.02, 0.99)) * o.doorOpen * DEG);
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
    // toe-up tilt while the oleo hangs extended; a forward-retracting truck also folds flat against the leg for stowage
    const tilt = o.tilt * DEG * K.seq(ext, eStatic + 0.03, stroke - 0.01) * (0.4 + 0.6 * down);
    qT.setFromAxisAngle(X, tilt);
    if (o.fold) { qL.setFromAxisAngle(rAxis, -rAngle * (1 - down) * o.fold); qT.premultiply(qL); }
    truck.quaternion.copy(qT);
    // body gear: the truck steers against the nose wheel in tight turns
    const ns = (S.gear[0] && S.gear[0].steer) || 0;
    const rs = o.steer && gs.onGround ? -Math.max(-13 * DEG, Math.min(13 * DEG, ns * 0.45)) * K.seq(Math.abs(ns), 0.2, 0.4) : 0;
    yaw.quaternion.setFromAxisAngle(d, rs);
    if (gs.onGround) rate = isNaN(gs.wheelSpeed) ? S.groundSpeed / R : gs.wheelSpeed; else if (!isNaN(gs.wheelSpeed) && gs.wheelSpeed !== 0) rate = gs.wheelSpeed; else rate *= Math.exp(-0.6 * dt);
    spin = (spin - rate * dt) % TAU;
    wf.quaternion.setFromAxisAngle(X, spin); wr.quaternion.copy(wf.quaternion);
  });
}

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'solvane', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const rig = K.createRig(ctx, { geometry: G, name: 'b748', glassLayer: opts.glassLayer, cockpitRadius: 1.4 });

  // ---- atlases: A = fuselage + upper deck + flight deck + gear, B = wings, tail, nacelles --------------------------------------
  // gloss airline paint: light weathering (a well-kept long-haul jet), frames every 0.53 m for the skin waviness
  const A = K.createAtlas({ size: atlasSize, base: F.gloss(SC.body), swatchRows: 6, skin: { weathering: 0.32, framePitch: 0.53 } });
  const cFus = A.chart('fus', { type: 'unwrap', z: [-38.5, 37.8], girth: 20.6, vScale: 0.8, strips: 2 });
  const cHump = A.chart('hump', { type: 'unwrap', z: [-35.95, 5.6], girth: 14.2, vScale: 0.62, strips: 2 });
  const cPanel = A.chart('panel', { type: 'rect', w: 2.4, h: 0.68, density: 2.2 });
  const cOver = A.chart('overhead', { type: 'rect', w: 0.8, h: 1.0, density: 1.5 });
  const cPed = A.chart('pedestal', { type: 'rect', w: 0.5, h: 1.0, density: 1.5 });
  A.pack();
  const UA = {
    body: A.swatch('body', F.gloss(SC.body)), fair: A.swatch('fair', F.gloss(SC.style === 'aurora' || SC.style === 'state' ? SC.belly : '#c9ced3')),
    dark: A.swatch('dark', F.darkGrey), black: A.swatch('black', F.black), well: A.swatch('well', { color: '#8b9094', rough: 0.7, metal: 0.1 }), liner: A.swatch('liner', { color: '#b9b6ae', rough: 0.8, metal: 0 }),
    post: A.swatch('post', { color: '#8d8e8a', rough: 0.7, metal: 0 }), floor: A.swatch('floor', { color: '#34363a', rough: 0.9, metal: 0 }), shield: A.swatch('shield', { color: '#2a2c2f', rough: 0.85, metal: 0 }),
    console: A.swatch('console', { color: '#5c6166', rough: 0.75, metal: 0 }), seat: A.swatch('seat', { color: '#45484c', rough: 0.9, metal: 0 }), cushion: A.swatch('cushion', { color: '#5b5346', rough: 1, metal: 0 }),
    yoke: A.swatch('yoke', { color: '#17181a', rough: 0.5, metal: 0 }), lever: A.swatch('lever', { color: '#8e9194', rough: 0.35, metal: 0.7 }),
    exhaust: A.swatch('exhaust', F.exhaust), steel: A.swatch('steel', F.steel), antenna: A.swatch('antenna', F.gloss('#e9e9e6')), dome: A.swatch('dome', F.semigloss('#d9dbdc')),
    strut: A.swatch('gear.strut', F.gearWhite), chrome: A.swatch('gear.chrome', F.chrome), tyre: A.swatch('gear.tyre', F.rubber), hub: A.swatch('gear.hub', { color: '#c4c6c2', rough: 0.4, metal: 0.35 }),
    link: A.swatch('gear.link', F.anodised), brake: A.swatch('gear.brake', { color: '#2c2724', rough: 0.58, metal: 0.8 }), hose: A.swatch('gear.hose', { color: '#17181a', rough: 0.55, metal: 0.35 }),
    pipe: A.swatch('pipe', { color: '#9a9e9f', rough: 0.45, metal: 0.7 }), box: A.swatch('wellbox', { color: '#6f7477', rough: 0.6, metal: 0.3 }), wiper: A.swatch('wiper', { color: '#1c1d1f', rough: 0.45, metal: 0.4 }),
  };
  const strips = K.tyreStrips(A); UA.tyreStrip = strips.tyre; UA.hubStrip = strips.hub;
  const B = K.createAtlas({ size: atlasSize, base: F.semigloss('#b9bec3'), swatchRows: 5, skin: { weathering: 0.42, framePitch: 0.6 } });
  const cWT = { i: B.chart('wingTopIn', { type: 'plan', x: [1.2, 11.7], z: [-12.7, 6.2], view: 'top', mirror: true, density: 1.1 }), o: B.chart('wingTopOut', { type: 'plan', x: [11.1, 34.5], z: [-4.3, 17.0], view: 'top', mirror: true, density: 1.1 }) };
  const cWB = { i: B.chart('wingBotIn', { type: 'plan', x: [1.2, 11.7], z: [-12.7, 6.2], view: 'bottom', mirror: true, density: 0.75 }), o: B.chart('wingBotOut', { type: 'plan', x: [11.1, 34.5], z: [-4.3, 17.0], view: 'bottom', mirror: true, density: 0.75 }) };
  const cSt = B.chart('stab', { type: 'plan', x: [1.0, 11.4], z: [21.6, 32.6], view: 'top', mirror: true, density: 0.85 });
  const cFin = { L: B.chart('finL', { type: 'side', z: [16.6, 34.0], y: [2.0, 14.5], view: 'left' }), R: B.chart('finR', { type: 'side', z: [16.6, 34.0], y: [2.0, 14.5], view: 'right' }) };
  B.pack();
  const UB = {
    grey: B.swatch('grey', F.semigloss('#b9bec3')), engine: B.swatch('engine', F.gloss(SC.engine)), lip: B.swatch('lip', F.polished), band: B.swatch('band', F.gloss(SC.lip)),
    duct: B.swatch('duct', { color: '#101113', rough: 0.6, metal: 0.2 }), acoustic: B.swatch('acoustic', { color: '#7d8185', rough: 0.6, metal: 0.55 }), core: B.swatch('core', F.semigloss('#c3c7ca')),
    coreMetal: B.swatch('coreMetal', F.titanium), plug: B.swatch('plug', F.heatStained), blade: B.swatch('blade', { color: '#4d5259', rough: 0.3, metal: 0.65 }),
    spinner: B.swatch('spinner', { color: '#26282c', rough: 0.3, metal: 0.5 }), swirl: B.swatch('swirl', { color: '#f2f2f0', rough: 0.3, metal: 0 }), inner: B.swatch('inner', F.semigloss('#8c9399')),
    pylon: B.swatch('pylon', F.gloss(SC.style === 'aurora' ? '#e8eaec' : SC.body)), tail: B.swatch('tail', F.gloss(SC.tail)), cascade: B.swatch('cascade', { color: '#3a3c3f', rough: 0.6, metal: 0.7 }),
    wick: B.swatch('wick', F.black), canoe: B.swatch('canoe', F.semigloss('#c3c7cb')), chevron: B.swatch('chevron', { color: '#8d9298', rough: 0.4, metal: 0.8 }), hot: B.swatch('hot', { color: '#5f5a55', rough: 0.5, metal: 0.9 }),
    soot: B.swatch('soot', { color: '#3b3936', rough: 0.7, metal: 0.3 }),
  };

  // ---- main fuselage --------------------------------------------------------------------------------------------------------
  //          d      yc      w     top    bot
  const FS = [
    [0.00, -0.78, 0.00, 0.00, 0.00], [0.08, -0.78, 0.40, 0.36, 0.33], [0.40, -0.72, 0.90, 0.84, 0.74], [1.20, -0.58, 1.55, 1.42, 1.24], [2.20, -0.41, 2.10, 1.92, 1.72],
    [3.40, -0.25, 2.56, 2.34, 2.20], [4.80, -0.12, 2.90, 2.74, 2.66], [6.50, -0.04, 3.11, 3.04, 3.02], [8.50, -0.01, 3.23, 3.22, 3.21], [11.0, 0, 3.25, 3.25, 3.25],
    [50.0, 0, 3.25, 3.25, 3.25], [54.0, 0.0, 3.23, 3.23, 3.22], [58.0, 0.03, 3.13, 3.17, 3.13], [64.0, 0.16, 2.70, 2.69, 2.68], [70.0, 0.34, 1.80, 1.92, 1.93],
    [73.5, 0.85, 0.96, 0.96, 0.90], [75.9, 1.10, 0.40, 0.36, 0.34], [76.3, 1.13, 0.31, 0.27, 0.26],
  ].map(r => ({ z: D(r[0]), y: r[1], w: r[2], top: r[3], bot: r[4], sub: r[0] >= 0.4 && r[0] < 11 ? 3 : r[0] >= 54 && r[0] < 76 ? 2 : undefined }));
  const fseg = Math.max(40, Math.round(96 * detail / 4) * 4);
  const fus = K.loft({
    stations: FS, segments: fseg, step: 1.3 / detail, chart: cFus, capEnd: 'flat', capUV: UA.exhaust,
    cutouts: [{ name: 'ngd', z: [-30.7, -26.6], t: [0, 0.034], mirror: true }, { name: 'deck', z: [D(4.8), D(9.5)], t: [0.4, 0.6] }],   // 'deck': crown hidden inside the hump (keeps it out of the flight deck)
  });
  cFus.body = fus;
  const stA = new K.Mesh(), stB = new K.Mesh();
  stA.add(fus.mesh);
  stA.add(K.well(K.merge(fus.patches.ngdR, fus.patches.ngdL), 1.35, UA.well, [0, 1, 0]));
  // APU exhaust: short pipe at the tail-cone tip
  stA.add(K.lathe([[0.2, 37.55], [0.21, 37.83, 1], [0.165, 37.83, 1], [0.15, 37.4]], { segments: 18, uv: UA.exhaust }).occlude(0.5).translate(0, 1.13, 0));

  // ---- upper deck lobe ("hump") ------------------------------------------------------------------------------------------------
  //          d      yc     w     top   bot
  const HS = [
    [2.60, 1.00, 0.00, 0.00, 0.00], [3.20, 1.12, 0.90, 0.55, 0.60], [4.20, 1.45, 1.55, 0.95, 0.90], [5.20, 1.75, 2.00, 1.15, 1.00], [6.20, 1.95, 2.25, 1.72, 1.05],
    [7.40, 2.10, 2.36, 2.12, 1.20], [9.00, 2.20, 2.40, 2.33, 1.30], [12.0, 2.25, 2.42, 2.50, 1.30], [16.0, 2.25, 2.42, 2.55, 1.30], [32.0, 2.25, 2.42, 2.55, 1.30],
    [35.5, 2.20, 2.38, 2.43, 1.30], [38.5, 2.02, 2.22, 2.13, 1.25], [41.3, 1.72, 1.92, 1.75, 1.15], [44.1, 1.38, 1.52, 1.55, 1.00],
  ].map(r => ({ z: D(r[0]), y: r[1], w: r[2], top: r[3], bot: r[4], kTop: [0.62, 0.6] }));
  const hump = K.loft({ stations: HS, segments: Math.max(32, Math.round(72 * detail / 4) * 4), step: 0.9 / detail, chart: cHump });
  cHump.body = hump;

  // wing-to-body fairing (belly) with the four main-gear bays cut into its flat bottom
  const fairStations = [[-18.0, 1.6, 0.5, 0.5], [-15.0, 2.1, 0.75, 0.7], [-12.0, 2.6, 0.85, 0.8], [-9.5, 3.4, 0.9, 0.85], [-6.5, 4.25, 0.9, 0.85], [2.5, 4.3, 0.9, 0.85], [5.0, 3.9, 0.9, 0.85], [7.0, 3.55, 0.85, 0.85], [9.2, 2.8, 0.7, 0.75], [11.6, 1.9, 0.45, 0.5]]
    .map(r => ({ z: r[0], y: -2.6, w: r[1], top: r[2], bot: r[3], kTop: 0.62, kBot: [0.9, 0.62] }));
  const fairOpts = { stations: fairStations, segments: Math.max(28, Math.round(48 * detail / 4) * 4), step: 0.9, uv: UA.fair };
  let fair = K.loft(fairOpts);
  const tAtX = (z, x) => { let lo = 0, hi = 0.25; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (fair.at(z, m).p[0] < x) lo = m; else hi = m; } return (lo + hi) / 2; };
  fair = K.loft({ ...fairOpts, cutouts: [{ name: 'wgw', z: [-1.75, 1.55], t: [tAtX(0, 2.25), tAtX(0, 4.15)], mirror: true }, { name: 'bgw', z: [1.85, 6.15], t: [tAtX(4, 1.3), tAtX(4, 3.4)], mirror: true }] });
  stA.add(fair.mesh);
  for (const k of ['wgwR', 'wgwL', 'bgwR', 'bgwL']) stA.add(K.well(fair.patches[k], 1.45, UA.well, [0, 1, 0]));
  // wheel-well plumbing: a few frames, actuators and pipe runs on the well roofs
  for (const sx of [-1, 1]) {
    const yr = -2.6 + 0.85 - 1.45 + 0.05;
    for (const z of [-1.2, -0.2, 0.9]) stA.add(K.box(1.7, 0.12, 0.08, UA.box).translate(sx * 3.2, yr + 0.06, z));
    for (const z of [2.6, 4.0, 5.4]) stA.add(K.box(1.9, 0.12, 0.08, UA.box).translate(sx * 2.35, yr + 0.06, z));
    stA.add(K.pipe([[sx * 2.4, yr + 0.15, -1.6], [sx * 2.6, yr + 0.1, 0.2], [sx * 2.2, yr + 0.1, 2.2], [sx * 2.0, yr + 0.12, 6.0]], 0.035, { segments: 6, uv: UA.pipe }));
    stA.add(K.pipe([[sx * 3.9, yr + 0.15, -1.6], [sx * 3.7, yr + 0.12, 1.4]], 0.03, { segments: 6, uv: UA.pipe }));
    stA.add(K.tube([sx * 3.0, yr + 0.18, -1.5], [sx * 4.0, yr + 0.18, 1.2], 0.07, 0.07, { segments: 8, uv: UA.chrome }));
  }

  // ---- flight deck ------------------------------------------------------------------------------------------------------------
  const ZB = D(8.6);
  // window corners as distances from the nose (d) and hump ring parameters (t): windshield W1, No. 2 window W2, sliding window W3
  const w1 = { fi: 5.16, fo: 5.40, bo: 6.10, bi: 6.24, ti: 0.492, to: 0.388, tb: 0.432 };
  const w2 = { fl: 5.48, bl: 6.55, fu: 6.17, tfl: 0.381, tbl: 0.341, tbu: 0.405, tfu: 0.426 };
  const w3 = { f: 6.65, bl: 7.40, bu: 7.30, tfl: 0.339, tbl: 0.333, tbu: 0.385, tfu: 0.40 };
  const WIN = [   // right-hand window polygons (z, t) on the hump skin
    [[D(w1.fi), w1.ti], [D(w1.fo), w1.to], [D(w1.bo), w1.tb], [D(w1.bi), w1.ti]],
    [[D(w2.fl), w2.tfl], [D(w2.bl), w2.tbl], [D(w2.bl), w2.tbu], [D(w2.fu), w2.tfu]],
    [[D(w3.f), w3.tfl], [D(w3.bl), w3.tbl], [D(w3.bu), w3.tbu], [D(w3.f), w3.tfu]],
  ];
  const HK = humpSkin(hump, fus, cHump, cFus, WIN, detail);
  stA.add(HK.skin);
  const eye = G.pilotEye, FY = 2.0, DF = w1.fi - 0.03;
  {
    const L = (c, uv, nu = 3, nv = 3) => stA.add(K.liner(hump, c.map(([d, t]) => [D(d), t]), { uv, nu, nv, mirror: true, inset: 0.05 }));
    const lo = 0.245, hi = w1.tb, zb = 8.6;
    L([[DF, 0.5], [DF, w1.ti], [w1.bi, w1.ti], [w1.bi, 0.5]], UA.post, 1, 4);                                  // centre post
    L([[w1.bi, 0.5], [w1.bo, hi], [zb, hi], [zb, 0.5]], UA.liner, 5, 5);                                       // roof
    L([[w1.bo, hi], [w2.fu, w2.tfu], [w2.bl, w2.tbu], [w2.bl, hi]], UA.liner);                                // above the side windows
    L([[w2.bl, hi], [w2.bl, w2.tbu], [w3.f, w3.tfu], [w3.f, hi]], UA.liner, 1, 2);
    L([[w3.f, hi], [w3.f, w3.tfu], [w3.bu, w3.tbu], [w3.bu, hi]], UA.liner);
    L([[w3.bu, hi], [w3.bu, w3.tbu], [w3.bl, w3.tbl], [zb, hi]], UA.liner);
    L([[w1.fo, w1.to], [w2.fl, w2.tfl], [w2.fu, w2.tfu], [w1.bo, hi]], UA.post, 1, 4);                         // posts
    L([[w2.bl, w2.tbl], [w3.f, w3.tfl], [w3.f, w3.tfu], [w2.bl, w2.tbu]], UA.post, 1, 3);
    L([[DF, lo], [w1.fo, lo], [w1.fo, w1.to], [w1.fi, w1.ti]], UA.liner, 3, 6);                               // sills and side walls
    L([[w1.fo, lo], [w2.fl, lo], [w2.fl, w2.tfl], [w1.fo, w1.to]], UA.liner, 1, 4);
    L([[w2.fl, lo], [w2.bl, lo], [w2.bl, w2.tbl], [w2.fl, w2.tfl]], UA.liner, 4, 4);
    L([[w2.bl, lo], [w3.f, lo], [w3.f, w3.tfl], [w2.bl, w2.tbl]], UA.liner, 1, 4);
    L([[w3.f, lo], [w3.bl, lo], [w3.bl, w3.tbl], [w3.f, w3.tfl]], UA.liner, 3, 4);
    L([[w3.bl, lo], [zb, lo], [zb, hi], [w3.bl, w3.tbl]], UA.liner, 3, 4);
    stA.add(K.deck(hump, D(DF), ZB, FY, { uv: UA.floor, n: 8, inset: 0.15 }));                   // floor
    stA.add(K.bulkhead(hump, ZB, { uv: UA.liner, facing: -1 }));                                   // flight-deck door wall
    stA.add(K.bulkhead(hump, D(DF + 0.01), { uv: UA.shield, facing: 1 }));                               // forward wall under the windshield
    const zp = eye[2] - 0.8;                                                                        // main instrument panel face
    // glareshield: deep, tapering toward the windshield, with the mode-control panel on its aft face (panel chart top strip)
    { const gs = K.prism([[zp - 0.55, 2.93], [zp - 0.02, 2.985], [zp + 0.05, 2.96], [zp + 0.03, 2.9], [zp - 0.55, 2.86]], -1.2, 1.2, UA.shield);
      for (let i = 0; i < gs.p.length; i += 3) gs.p[i] *= 0.62 + 0.38 * (gs.p[i + 2] - (zp - 0.55)) / 0.6; stA.add(gs); }
    { const i0 = stA.vertexCount; for (const [a, b] of [[0, 0.68], [2.4, 0.68], [2.4, 0], [0, 0]]) { const uv = cPanel.uv(a, b); stA.vert(a - 1.2, 2.22 + (0.68 - b), zp + 0.04 + (0.68 - b) * 0.1, 0, 0.1, 1, uv[0], uv[1]); } stA.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    stA.add(K.box(2.4, 0.7, 0.14, UA.shield).translate(0, 2.56, zp - 0.04));
    { // pedestal with its sloping top (CDUs, four thrust levers, speedbrake and flap handles)
      stA.add(K.box(0.52, 0.55, 1.05, UA.console).translate(0, FY + 0.275, zp + 0.6));
      const i0 = stA.vertexCount; for (const [a, b] of [[0, 0], [0.5, 0], [0.5, 1.0], [0, 1.0]]) { const uv = cPed.uv(a, b); stA.vert(a - 0.25, FY + 0.69 - b * 0.12, zp + 0.08 + b * 1.05, 0, 1, 0.1, uv[0], uv[1]); } stA.quad(i0, i0 + 3, i0 + 2, i0 + 1);
      for (let k = 0; k < 4; k++) { const x = -0.105 + k * 0.07; stA.add(K.box(0.022, 0.16, 0.035, UA.lever).rotateX(-0.45).translate(x, FY + 0.78, zp + 0.36)); stA.add(K.box(0.05, 0.03, 0.04, UA.yoke).translate(x, FY + 0.86, zp + 0.32)); }
      stA.add(K.box(0.025, 0.14, 0.03, UA.lever).rotateX(-0.3).translate(-0.2, FY + 0.76, zp + 0.42)); stA.add(K.box(0.03, 0.14, 0.03, UA.lever).rotateX(-0.3).translate(0.2, FY + 0.76, zp + 0.48));
    }
    { const i0 = stA.vertexCount, y = 3.74; for (const [a, b] of [[0, 0], [0.8, 0], [0.8, 1.0], [0, 1.0]]) { const uv = cOver.uv(a, b); stA.vert(a - 0.4, y + b * 0.16, zp + 0.3 + b, 0, -1, -0.2, uv[0], uv[1]); } stA.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    for (const sx of [-1, 1]) {
      const e = [sx * Math.abs(eye[0]), eye[1], eye[2]];
      stA.add(K.crewSeat({ eye: e, uv: { frame: UA.seat, cushion: UA.cushion } }));
      stA.add(K.yoke({ base: [e[0], FY, e[2] - 0.52], top: [e[0], e[1] - 0.55, e[2] - 0.44], uv: UA.yoke }));
      stA.add(K.box(0.34, 0.62, 1.15, UA.console).translate(sx * 1.38, FY + 0.31, e[2] - 0.05));                         // side console
      stA.add(K.box(0.24, 0.03, 0.3, UA.shield).translate(e[0], FY + 0.06, zp + 0.1));                                   // rudder pedals
    }
  }
  // windshield wipers parked along the lower frame of each front pane
  for (const s of [1, -1]) {
    const pt = (d, t) => { const q = hump.at(D(d), s > 0 ? t : 1 - t); return add3(q.p, q.n.map(v => v * 0.035)); };
    const a = pt(5.24, 0.485), b = pt(5.38, 0.415);
    stA.add(K.tube(a, b, 0.012, 0.012, { segments: 5, uv: UA.wiper })).add(K.tube(pt(5.28, 0.47), pt(5.44, 0.462), 0.015, 0.012, { segments: 5, uv: UA.wiper }));
  }

  // ---- wings ----------------------------------------------------------------------------------------------------------------
  const wst = (x, tc, twist) => ({ x, y: wy(x), z: zLE(x), chord: zTE(x) - zLE(x), tc, twist });
  const sc = K.supercritical();
  const SP_IN = [[4.1, 7.15], [7.25, 10.3]], SP_OUT = [[14.2, 16.55], [16.65, 19.0], [19.1, 21.4], [21.5, 23.75]];
  const wingOf = (side) => K.wing({
    side, airfoil: sc, chordPts: Math.round(16 * Math.min(1, detail)), spanAxis: 'x', tip: 'round', tipLength: 0.5,
    stations: [wst(1.4, 0.135, 2), wst(5.5, 0.125, 1.5), wst(11.2, 0.105, 0.3), wst(21, 0.094, -1.2), wst(30.4, 0.085, -2.5), wst(34.2, 0.08, -3)],
    lines: { kru: [[1.4, 0.12], [11.2, 0.12], [34.2, 0.14]], spoil: [[1.4, 0.6], [11.2, 0.6], [34.2, 0.62]], flap: [[1.4, 0.72], [11.2, 0.72], [34.2, 0.74]], aft: [[1.4, 0.87], [11.2, 0.87], [34.2, 0.885]] },
    controls: [
      { name: 'flapIn', type: 'flap', span: [3.45, 10.45], from: 'flap', to: 'aft', nose: 1, tail: 0.6 },
      { name: 'aftIn', type: 'flap', span: [3.45, 10.45], from: 'aft', nose: 1 },
      { name: 'ailIn', type: 'flap', span: [11.35, 13.85], from: 'flap', nose: 1 },
      { name: 'flapOut', type: 'flap', span: [14.05, 23.9], from: 'flap', nose: 1 },
      { name: 'ailOut', type: 'flap', span: [24.1, 29.9], from: 'flap', nose: 1 },
      { name: 'kruIn', type: 'panel', surface: 'lower', span: [3.5, 10.6], to: 'kru', hinge: 'front', thickness: 0.04 },
      { name: 'kruOutA', type: 'panel', surface: 'lower', span: [12.3, 22.6], to: 'kru', hinge: 'front', thickness: 0.04 },
      { name: 'kruOutB', type: 'panel', surface: 'lower', span: [24.4, 30.2], to: 'kru', hinge: 'front', thickness: 0.04 },
      ...SP_IN.map((s, i) => ({ name: 'spIn' + (i + 1), type: 'panel', surface: 'upper', span: s, from: 'spoil', to: 'flap', hinge: 'front' })),
      ...SP_OUT.map((s, i) => ({ name: 'spOut' + (i + 1), type: 'panel', surface: 'upper', span: s, from: 'spoil', to: 'flap', hinge: 'front' })),
    ],
    charts: [{ from: 0, upper: cWT.i, lower: cWB.i }, { from: 11.4, upper: cWT.o, lower: cWB.o }], innerUV: UB.inner, edgeUV: UB.grey,
  });
  const W = { R: wingOf(1), L: wingOf(-1) };
  stB.add(W.R.mesh).add(W.L.mesh);
  // flap-track fairings ("canoes"): front part fixed under the wing, rear part rides on the flap
  const canoeAt = (x, len, side, h = 1) => {
    const zf = W.R.at(x, 0.72, 'lower'), z0 = zf[2] - len * 0.42, y = zf[1] - 0.08;
    const st = [[0, 0.01, 0.01], [0.1, 0.17, 0.2], [0.32, 0.26, 0.42], [0.6, 0.26, 0.45], [0.86, 0.16, 0.28], [1, 0.015, 0.03]].map(r => ({ z: z0 + r[0] * len, x: side * x, y: y - r[2] * h * 0.5 + (r[0] > 0.6 ? (r[0] - 0.6) * 0.35 : 0), w: r[1], top: r[2] * h * 0.6, bot: r[2] * h }));
    const split = zf[2] + 0.15;
    return { front: K.loft({ stations: st, segments: 12, step: 0.45, uv: UB.canoe, zRange: [z0, split] }).mesh, rear: K.loft({ stations: st, segments: 12, step: 0.45, uv: UB.canoe, zRange: [split, z0 + len], capStart: 'flat' }).mesh };
  };

  // ---- tail -------------------------------------------------------------------------------------------------------------------
  const sy = (x) => 1.0 + (x - 2.9) * Math.tan(7 * DEG), zLEs = (x) => 23.0 + (x - 2.9) * Math.tan(37.5 * DEG);
  const stabOf = (side) => K.wing({
    side, airfoil: K.naca4('0011'), chordPts: Math.round(11 * Math.min(1, detail)), spanAxis: 'x', tip: 'round', tipLength: 0.5,
    stations: [{ x: 1.2, y: sy(1.2), z: zLEs(1.2), chord: 8.2, tc: 0.11 }, { x: 11.1, y: sy(11.1), z: zLEs(11.1), chord: 2.6, tc: 0.09 }],
    lines: { hinge: [[1.2, 0.7], [11.1, 0.7]] },
    controls: [{ name: 'elevIn', type: 'flap', span: [2.95, 6.7], from: 'hinge', nose: 1 }, { name: 'elevOut', type: 'flap', span: [6.8, 10.8], from: 'hinge', nose: 1 }],
    charts: { upper: cSt, lower: cSt }, edgeUV: UB.grey,
  });
  const stab = { R: stabOf(1), L: stabOf(-1) };
  stB.add(stab.R.mesh).add(stab.L.mesh);
  const fin = K.wing({
    airfoil: K.naca4('0011'), chordPts: Math.round(12 * Math.min(1, detail)), spanAxis: 'y', tip: 'round', tipLength: 0.5,
    stations: [{ x: 0, y: 2.2, z: 17.0, chord: 13.25, tc: 0.11 }, { x: 0, y: 14.2, z: 29.0, chord: 4.2, tc: 0.09 }],
    lines: { hinge: [[2.2, 0.7], [14.2, 0.7]] },
    controls: [{ name: 'rudLo', type: 'flap', span: [3.55, 8.65], from: 'hinge', nose: 1 }, { name: 'rudUp', type: 'flap', span: [8.75, 13.85], from: 'hinge', nose: 1 }],
    charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.tail,
  });
  stB.add(fin.mesh);
  stB.add(K.wing({ airfoil: K.naca4('0008'), chordPts: 6, spanAxis: 'y', tip: 'flat', charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.tail,       // dorsal fillet
    stations: [{ x: 0, y: 2.9, z: 13.2, chord: 6.8, tc: 0.025 }, { x: 0, y: 3.95, z: 18.6, chord: 1.6, tc: 0.08 }] }).mesh);

  // ---- engines ----------------------------------------------------------------------------------------------------------------
  const eng = [], sleeveAll = new K.Mesh();
  let sleeveTravel = 0;
  for (const c of ENG) {
    const n = K.nacelle({ centre: c, ...NAC, droop: 0.05, segments: Math.max(28, Math.round(48 * detail / 4) * 4),
      uv: UB.engine, uvLip: UB.lip, uvInner: UB.acoustic, uvSleeve: UB.engine, uvCore: UB.core, uvPlug: UB.plug, uvCascade: UB.cascade });
    stB.add(n.cowl).add(n.cascade).add(n.core).add(n.plug);
    stB.add(K.fanBackdrop(NAC.rFan, 0.5, UB.duct).translate(c[0], c[1], n.fanZ));
    // coloured band behind the polished lip, dark acoustic-liner rings in the inlet
    { const L = NAC.length, rA = (z) => NAC.rHi + (NAC.rMax - NAC.rHi) * Math.sqrt(Math.min(1, z / (L * 0.3))) + 0.006;
      stB.add(K.lathe([[rA(0.17) - 0.006, 0.17], [rA(0.18), 0.18], [rA(0.62), 0.62], [rA(0.63) - 0.006, 0.63]], { segments: 48, uv: UB.band }).translate(c[0], c[1], c[2]));
      for (const z of [0.42, 0.7]) stB.add(K.lathe([[NAC.rThroat - 0.004, z + 0.03], [NAC.rThroat - 0.004, z]], { segments: 40, uv: UB.duct }).occlude(0.4).translate(c[0], c[1] - 0.05, c[2])); }
    const exitZ = c[2] + NAC.length, coreZ = exitZ + NAC.core.length;
    // heat-stained titanium core nozzle ring with its chevrons, sooty band on the core cowl
    stB.add(K.lathe([[NAC.core.r1 + 0.075, coreZ - 0.55], [NAC.core.r1 + 0.018, coreZ + 0.005, 1], [NAC.core.r1 - 0.01, coreZ + 0.005, 1]], { segments: 40, uv: UB.coreMetal }).translate(c[0], c[1], 0));
    stB.add(chevrons(c, coreZ - 0.01, NAC.core.r1 + 0.012, 14, 0.2, 0.05, UB.hot));
    stB.add(K.lathe([[NAC.core.r0 * 0.985 + 0.004, exitZ + 0.05], [NAC.core.r1 * 1.15 + 0.006, exitZ + NAC.core.length * 0.62]], { segments: 40, uv: UB.soot }).translate(c[0], c[1], 0));
    const sl = n.sleeve.clone().add(chevrons(c, exitZ - 0.01, NAC.rExit - 0.012, 18, 0.34, 0.07, UB.chevron));   // bypass chevrons ride on the sleeve
    sl.enableMorph(); for (let i = 2; i < sl.p2.length; i += 3) sl.p2[i] += n.sleeveTravel;            // reverser: sleeve slides aft (morph target)
    sleeveAll.add(sl); sleeveTravel = n.sleeveTravel;
    // pylon: from the top of the fan cowl back into the wing leading edge and under the wing to the aft fairing
    { const x = Math.abs(c[0]), yw = wy(x), zl = zLE(x);
      stB.add(K.pylon([{ y: c[1] + 1.2, z0: c[2] + 1.1, z1: c[2] + 7.3, x: c[0], tc: 0.11 }, { y: yw + 0.1, z0: zl - 1.6, z1: zl + 5.2, x: c[0], tc: 0.08 }], { uv: UB.pylon }));
      const z0 = c[2] + 6.4, len = 5.2, yb = yw - 0.62;                                                 // aft pylon fairing under the wing
      const st = [[0, 0.02, 0.02], [0.15, 0.3, 0.3], [0.5, 0.36, 0.4], [0.85, 0.22, 0.28], [1, 0.02, 0.04]].map(r => ({ z: z0 + r[0] * len, x: c[0], y: yb + r[0] * 0.3, w: r[1], top: 0.55, bot: r[2] }));
      stB.add(K.loft({ stations: st, segments: 14, step: 0.5, uv: UB.pylon }).mesh); }
    eng.push({ c, n, fanMesh: genxFan({ radius: NAC.rFan - 0.012, hub: 0.44, blades: 18, uvBlade: UB.blade, uvSpinner: UB.spinner, uvSwirl: UB.swirl }) });
  }

  // ---- small details ----------------------------------------------------------------------------------------------------------
  for (const [z, top] of [[-24, true], [-6, true], [12, false], [19, false]]) stA.add(K.bladeAntenna({ pos: [0, (top ? hump.topAt(z) : fus.topAt(z)) - 0.02, z], height: 0.34, chord: 0.48, sweep: 0.22, uv: UA.antenna }));
  for (const z of [-21, -19.6]) stA.add(K.ellipsoid(0.13, 0.04, 0.16, { segments: 10, rings: 4, uv: UA.dome }).translate(0, hump.topAt(z) - 0.005, z));   // GPS antennas
  stA.add(K.ellipsoid(0.55, 0.19, 1.45, { segments: 16, rings: 6, uv: UA.dome }).translate(0, fus.topAt(8.2) - 0.04, 8.2));                             // satcom radome behind the upper deck
  for (const z of [-21, 14]) stA.add(K.bladeAntenna({ pos: [0, fus.botAt(z) + 0.02, z], height: 0.3, chord: 0.42, sweep: 0.18, down: true, uv: UA.antenna }));
  for (const [z, x] of [[-23.2, 0.35], [-22.6, -0.35], [14.8, 0.3], [15.5, -0.3]]) stA.add(K.bladeAntenna({ pos: [x, fus.botAt(z) + 0.03, z], height: 0.13, chord: 0.12, sweep: 0.08, down: true, thickness: 0.02, uv: UA.steel }));   // drain masts
  stA.add(K.box(0.3, 0.12, 1.6, UA.steel).translate(0, fus.botAt(30.5) + 0.02, 30.5));               // tail-strike skid
  for (const sx of [-1, 1]) {
    for (const [d, dy] of [[3.6, -0.25], [3.6, 0.15], [3.9, -0.6]]) { const z = D(d), p = fus.at(z, fus.tAtY(z, dy)).p; stA.add(K.probe([sx * p[0], p[1], p[2]], [sx * (p[0] + 0.16), p[1] - 0.01, p[2] - 0.25], 0.017, UA.steel)); }   // pitots
    { const z = D(4.3), p = fus.at(z, fus.tAtY(z, 0.55)).p; stA.add(K.box(0.11, 0.012, 0.1, UA.dark).translate(sx * (p[0] + 0.05), p[1], z)); }   // AoA vanes
  }
  { const z = D(4.6), p = fus.at(z, fus.tAtY(z, -1.1)).p; stA.add(K.probe([-p[0], p[1], p[2]], [-(p[0] + 0.1), p[1] - 0.02, p[2] - 0.08], 0.02, UA.steel)); }                                     // TAT probe
  { const wicks = []; for (const sx of [-1, 1]) { for (const x of [27, 29, 31, 33.2]) { const p = W.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } for (const x of [8, 9.6, 10.9]) { const p = stab.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } } for (const y of [11.6, 13.4]) wicks.push(fin.at(y, 1, 'mid')); stB.add(K.staticWicks(wicks, 0.25, UB.wick)); }

  lap('geometry');
  // ---- paint + materials ------------------------------------------------------------------------------------------------------
  paintFuselage(A, { SC, fus, hump, cFus, cHump, cPanel, cOver, cPed, WIN });
  paintSurfaces(B, { SC, W: W.R, fin, stab: stab.R, cWT, cWB, cSt, cFin, SP_IN, SP_OUT });
  lap('paint');
  const matA = A.material(ctx, { envMapIntensity: 1, emissiveIntensity: 0 }), matB = B.material(ctx, { envMapIntensity: 1 });
  lap('textures');
  rig.material('paint', matA, { shared: true }); rig.material('wing', matB, { shared: true });
  rig.glass('glass', K.glassMaterial(ctx, { ...K.GLASS.airliner, dust: 0.03 }));
  rig.disposables.push(A, B);

  // ---- moving surfaces --------------------------------------------------------------------------------------------------------
  const drop = (ctrl, d, aft = 0) => { const u = ctrl.up, h = ctrl.hinge, o = [-u[0] * d, -u[1] * d, -u[2] * d + aft]; return { a: [h.a[0] + o[0], h.a[1] + o[1], h.a[2] + o[2]], b: [h.b[0] + o[0], h.b[1] + o[1], h.b[2] + o[2]] }; };
  const hingeOn = (name, mesh, line, ref, toward) => { const node = rig.part(name, mesh, { key: 'wing', pivot: line.a }); return rig.hinge(node, line.a, line.b, { ref, toward }); };
  const DOWN = [0, -1, 0], UP = [0, 1, 0];
  // flaps of both wings in one part: Fowler motion (rotation about a hinge line well below the wing) with the inboard aft
  // segment folding a further 20°; the canoe tails ride on their flap
  const flapGroups = [], kruGroups = [], spInGroups = [], wingAnim = [];
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const C = W[key].controls;
    const lIn = drop(C.flapIn, 2.3, 0.1), lAft = drop(C.aftIn, 0.3), lOut = drop(C.flapOut, 1.6, 0.05);
    const poseIn = (f) => rotor(lIn.a, lIn.b, C.flapIn.ref, DOWN, 30 * DEG * f);
    const inMesh = C.flapIn.mesh.clone(), outMesh = C.flapOut.mesh.clone();
    for (const x of [5.4, 8.9]) { const cn = canoeAt(x, 6.0, sx); stB.add(cn.front); inMesh.add(cn.rear); }
    for (const x of [16.6, 21.2]) { const cn = canoeAt(x, 5.2 - (x - 15) * 0.1, sx, 0.92 - (x - 15) * 0.015); stB.add(cn.front); outMesh.add(cn.rear); }
    flapGroups.push({ mesh: inMesh, pose: poseIn }, { mesh: C.aftIn.mesh, pose: (f) => chain(poseIn(f), rotor(lAft.a, lAft.b, C.aftIn.ref, DOWN, 20 * DEG * f)) }, { mesh: outMesh, pose: (f) => rotor(lOut.a, lOut.b, C.flapOut.ref, DOWN, 28 * DEG * f) });
    kruGroups.push({ mesh: C.kruIn.mesh, pose: (f) => rotor(C.kruIn.hinge.a, C.kruIn.hinge.b, C.kruIn.ref, DOWN, 115 * DEG * f) });
    for (const k of ['kruOutA', 'kruOutB']) kruGroups.push({ mesh: C[k].mesh, pose: (f) => rotor(C[k].hinge.a, C[k].hinge.b, C[k].ref, DOWN, 105 * DEG * f) });
    for (const k of ['spIn1', 'spIn2']) spInGroups.push({ mesh: C[k].mesh, pose: (f) => rotor(C[k].hinge.a, C[k].hinge.b, C[k].ref, UP, 50 * DEG * f) });
    const a = { key };
    a.ailIn = rig.hingePart('aileronIn' + key, C.ailIn, { key: 'wing' }).set;
    a.ailOut = rig.hingePart('aileronOut' + key, C.ailOut, { key: 'wing' }).set;
    const spo = K.merge(...SP_OUT.map((s, i) => C['spOut' + (i + 1)].mesh));
    a.spOut = hingeOn('spoilerOut' + key, spo, { a: C.spOut1.hinge.a, b: C.spOut4.hinge.b }, C.spOut1.ref, UP);
    a.elev = rig.hingePart('elevator' + key, stab[key].controls.elevIn, { key: 'wing', mesh: K.merge(stab[key].controls.elevIn.mesh, stab[key].controls.elevOut.mesh) }).set;
    wingAnim.push(a);
  }
  const setFlaps = morphPart(rig, 'flaps', flapGroups, 3, 'wing');
  const setKrueger = morphPart(rig, 'kruegers', kruGroups, 4, 'wing');
  const setSpIn = morphPart(rig, 'spoilersIn', spInGroups, 2, 'wing');
  const rud = rig.hingePart('rudder', fin.controls.rudLo, { key: 'wing', toward: [1, 0, 0], mesh: K.merge(fin.controls.rudLo.mesh, fin.controls.rudUp.mesh) });
  const fans = eng.map((e, i) => rig.part('fan' + i, e.fanMesh.translate(e.c[0], e.c[1], e.n.fanZ), { key: 'wing', pivot: [e.c[0], e.c[1], e.n.fanZ], ao: false }));
  const sleeves = rig.part('reversers', sleeveAll, { key: 'wing' });
  rig.addStatic(stB, 'wing');

  // ---- landing gear -----------------------------------------------------------------------------------------------------------
  const gp = G.gear;
  const doorOf = (patch, edge) => ({ mesh: K.thicken(patch, 0.03, UA.well), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  K.buildGear(rig, A, {
    name: 'nose', index: 0, contact: gp[0].pos, wheels: [-0.36, 0.36], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.4, pivot: [0, -2.0, -27.05], stroke: 0.42, staticFrac: 0.4,
    strutR: 0.13, steer: true, links: 'front', retract: { to: [0, -2.3, -30.2] }, window: [0.2, 0.86], brace: [0, -2.1, -25.6], uv: { strut: UA.strut, piston: UA.chrome, link: UA.link }, wheelSegments: 24,
    doors: [{ name: 'noseDoorR', ...doorOf(fus.patches.ngdR, fus.edges.ngdR.tHi), open: 86, closes: true }, { name: 'noseDoorL', ...doorOf(fus.patches.ngdL, fus.edges.ngdL.tLo), open: 86, closes: true }],
    lamps: [{ kind: 'taxi', pos: [-0.16, -3.5, -27.42], size: 0.075, color: [1, 0.96, 0.9] }, { kind: 'taxi', pos: [0.16, -3.5, -27.42], size: 0.075, color: [1, 0.96, 0.9] }],
  });
  const gearUV = { ...UA };
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {                       // wing gear: swings inboard into the belly fairing
    const c = gp[i].pos;
    bogieGear(rig, {
      name: 'wing' + key, index: i, side: sx, contact: c, R: gp[i].wheelRadius, wW: 0.42, pivot: [c[0], -2.15, c[2] + 0.2], stow: [sx * 3.05, -2.45, -0.15],
      stroke: 0.5, staticFrac: 0.4, strutR: 0.19, axle: 0.74, track: 0.56, tilt: 9, window: [0.2, 0.86], uv: gearUV, segments: 22,
      brace: [c[0] - sx * 1.4, -2.4, c[2] - 0.6], drag: [c[0] + sx * 0.1, -2.2, c[2] - 1.5], legDoor: UA.fair, doorOpen: 95,
      door: { mesh: K.thicken(fair.patches['wgw' + key], 0.03, UA.well), edge: sx > 0 ? fair.edges['wgw' + key].tLo : fair.edges['wgw' + key].tHi, ref: K.centroid(fair.patches['wgw' + key]) },
    });
  }
  for (const [i, sx, key] of [[3, -1, 'L'], [4, 1, 'R']]) {                       // body gear: swings forward into the belly, steers
    const c = gp[i].pos;
    bogieGear(rig, {
      name: 'body' + key, index: i, side: sx, contact: c, R: gp[i].wheelRadius, wW: 0.42, pivot: [c[0], -1.55, c[2] + 0.85], stow: [c[0], -1.85, 2.3],
      stroke: 0.5, staticFrac: 0.4, strutR: 0.19, axle: 0.74, track: 0.56, tilt: 9, fold: 1, steer: true, window: [0.2, 0.86], uv: gearUV, segments: 22,
      brace: [c[0], -1.8, c[2] + 2.4], doorOpen: 95,
      door: { mesh: K.thicken(fair.patches['bgw' + key], 0.03, UA.well), edge: sx > 0 ? fair.edges['bgw' + key].tHi : fair.edges['bgw' + key].tLo, ref: K.centroid(fair.patches['bgw' + key]) },
    });
  }
  rig.addStatic(stA, 'paint');
  rig.addStatic(HK.panes, 'glass');

  // ---- lamps ------------------------------------------------------------------------------------------------------------------
  const L = G.lights, tipAft = W.R.at(34.1, 0.92, 'mid');
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.13, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.13, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.1 });
  for (const sx of [-1, 1]) rig.lamp('nav', [sx * (tipAft[0] + 0.03), tipAft[1], tipAft[2]], { color: [1, 1, 1], size: 0.08 });          // aft-facing white position lights
  for (const sx of [-1, 1]) { const p = stab.R.at(9.8, 0.2, 'upper'); rig.lamp('nav', [sx * p[0], p[1] + 0.03, p[2]], { color: [1, 0.98, 0.92], size: 0.06, squash: [1, 0.5, 1] }); }   // logo lights
  const strobeTip = W.R.at(34.0, 0.7, 'mid');
  for (const sx of [-1, 1]) rig.lamp('strobe', [sx * (strobeTip[0] + 0.05), strobeTip[1], strobeTip[2]], { color: [1, 1, 1], size: 0.1 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.1 });
  const beaconTop = [0, hump.topAt(-14) + 0.04, -14];
  rig.lamp('beacon', beaconTop, { color: [1, 0.05, 0.03], size: 0.17, squash: [1, 0.6, 1] });
  rig.lamp('beacon', L.beacon, { color: [1, 0.05, 0.03], size: 0.17, squash: [1, 0.6, 1] });
  const landing = [], turnoff = [];
  for (const sx of [-1, 1]) for (const x of [3.95, 4.7]) { const p = W.R.at(x, 0.004, 'mid'); landing.push([sx * p[0], p[1] - 0.05, p[2] - 0.02]); }
  for (const sx of [-1, 1]) { const p = fair.at(-13.6, sx > 0 ? 0.2 : 0.8).p; turnoff.push([p[0], p[1], p[2] - 0.02]); }
  for (const p of landing) rig.lamp('landing', p, { color: [1, 0.97, 0.9], size: 0.14, squash: [1.4, 0.8, 0.5] });
  for (const p of turnoff) rig.lamp('taxi', p, { color: [1, 0.97, 0.9], size: 0.08 });
  for (const sx of [-1, 1]) { const z = -13.0, p = fus.at(z, fus.tAtY(z, 0.9)).p; rig.lamp('nav', [sx * (p[0] + 0.01), p[1], p[2]], { color: [1, 0.98, 0.94], size: 0.05 }); }    // wing inspection lights

  // ---- night halos: soft additive sprites so the lamps read at chase distance -------------------------------------------------
  const HALO = [
    { p: [L.navLeft[0] - 0.06, L.navLeft[1], L.navLeft[2]], c: [1, 0.05, 0.03], k: 'nav', s: 2.6 }, { p: [L.navRight[0] + 0.06, L.navRight[1], L.navRight[2]], c: [0.05, 1, 0.3], k: 'nav', s: 2.6 },
    { p: [0, L.tail[1], L.tail[2] + 0.08], c: [1, 1, 1], k: 'nav', s: 1.8 }, { p: [-tipAft[0] - 0.06, tipAft[1], tipAft[2] + 0.05], c: [1, 1, 1], k: 'nav', s: 1.6 }, { p: [tipAft[0] + 0.06, tipAft[1], tipAft[2] + 0.05], c: [1, 1, 1], k: 'nav', s: 1.6 },
    { p: [-strobeTip[0] - 0.08, strobeTip[1], strobeTip[2]], c: [1, 1, 1], k: 'strobe', s: 4.5 }, { p: [strobeTip[0] + 0.08, strobeTip[1], strobeTip[2]], c: [1, 1, 1], k: 'strobe', s: 4.5 }, { p: L.strobe, c: [1, 1, 1], k: 'strobe', s: 3.5 },
    { p: [0, beaconTop[1] + 0.08, beaconTop[2]], c: [1, 0.08, 0.04], k: 'beacon', s: 3.2 }, { p: [L.beacon[0], L.beacon[1] - 0.08, L.beacon[2]], c: [1, 0.08, 0.04], k: 'beacon', s: 3.2 },
    ...landing.map(p => ({ p: [p[0], p[1], p[2] - 0.1], c: [1, 0.95, 0.85], k: 'landing', s: 3.4 })), ...turnoff.map(p => ({ p: [p[0], p[1], p[2] - 0.08], c: [1, 0.95, 0.85], k: 'taxi', s: 2.2 })),
    { p: [0, -3.5, -27.55], c: [1, 0.95, 0.85], k: 'taxi', s: 2.6 },
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
  rig.onUpdate((S, dt) => {
    const sf = S.sf, f = sf.flaps, sl = Math.max(sf.slats, 0);
    setFlaps(f); setKrueger(sl);
    setSpIn((S.onGround ? Math.max(sf.speedbrake, Math.min(sf.spoilerL, sf.spoilerR) > 0.9 ? 1 : 0) : sf.speedbrake * 0.4));
    for (const a of wingAnim) {
      const R = a.key === 'R', ail = R ? sf.aileronR : sf.aileronL, sp = R ? sf.spoilerR : sf.spoilerL, el = R ? sf.elevatorR : sf.elevatorL;
      a.ailIn(ail * 18 * DEG - f * 8 * DEG); a.ailOut((S.onGround || f > 0.05 ? 1 : 0.35) * ail * 22 * DEG);
      a.spOut(Math.max(sp, sf.speedbrake * (S.onGround ? 1 : 0.6)) * 45 * DEG);
      a.elev(el * 22 * DEG);
    }
    rud.set(sf.rudder * 28 * DEG);
    let rev = 0;
    for (let i = 0; i < 4; i++) {
      const e = S.eng[i] || {};
      fanAng[i] = (fanAng[i] + (e.n1 || 0) * 22 * dt) % TAU;
      fans[i].quaternion.set(0, 0, Math.sin(fanAng[i] / 2), Math.cos(fanAng[i] / 2));
      rev = Math.max(rev, e.reverser || 0);
    }
    sleeves.morphTargetInfluences[0] = rev;
    matA.emissiveIntensity = S.night * 2.4;
    const lt = S.lights || {}, nf = Math.max(0, Math.min(1, (S.night ?? 0) * 1.4 - 0.2)), t = S.t || 0;
    HALO.forEach((h, i) => {
      let on = 0;
      if (h.k === 'nav') on = lt.nav ? 1 : 0;
      else if (h.k === 'strobe') { const ph = t % 1.1; on = lt.strobe && (ph < 0.055 || (ph > 0.16 && ph < 0.215)) ? 1 : 0; }
      else if (h.k === 'beacon') { const ph = (t + 0.45) % 1.25; on = lt.beacon ? (ph < 0.16 ? Math.sin(ph / 0.16 * Math.PI) : 0) : 0; }
      else on = lt[h.k] && sf.gear > 0.98 ? 1 : (lt[h.k] && h.k === 'landing' ? 1 : 0);
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

// ---- paint: fuselage atlas ---------------------------------------------------------------------------------------------------
function paintFuselage(A, o) {
  const { SC, fus, hump, cFus, cHump, cPanel, cOver, cPed, WIN } = o, F = K.FINISH;
  const P = A.pen(cFus), H = A.pen(cHump), body = F.gloss(SC.body), belly = F.gloss(SC.belly), cheat = F.gloss(SC.cheat), accent = F.gloss(SC.accent), tail = F.gloss(SC.tail);
  const font = K.FONT[SC.font] || K.FONT.wide;
  const Z0 = -38.5, Z1 = 37.8;
  P.fill('all', body); H.fill('all', body);
  // --- livery ---
  if (SC.style === 'sun') {             // grey belly, crimson cheatline with a gold pinstripe, crimson tail cone
    P.band(Z0, Z1, -Infinity, -1.45, belly, { step: 0.5, feather: 2 });
    P.band(-34.5, 30, (z) => -0.62 + Math.max(0, z - 18) * 0.06, (z) => -0.26 + Math.max(0, z - 18) * 0.06, cheat, { step: 0.4 });
    P.band(-34.5, 30, (z) => -0.8 + Math.max(0, z - 18) * 0.06, (z) => -0.7 + Math.max(0, z - 18) * 0.06, accent, { step: 0.4 });
    { const k = (z) => Math.pow(Math.max(0, (z + 36.2) / 1.7), 1.2); P.band(-36.2, -34.45, (z) => -0.44 - 0.18 * Math.min(1, k(z)), (z) => -0.44 + 0.18 * Math.min(1, k(z)), cheat, { step: 0.1 }); }
    P.band(29.5, Z1, -Infinity, Infinity, tail, { step: 0.3 });
    P.textOn(SC.title, -17.5, 1.62, 'both', 0.78, { color: SC.titleColor, font, weight: 700, spacing: 0.12 });
    P.decalOn(-25.4, 1.62, 'both', (g) => drawSunMark(g, 0.42, SC.accent, SC.tail));
  } else if (SC.style === 'aurora') {   // navy belly rising into the tail, light-blue and green accent lines
    const edge = (z) => (z < 8 ? -0.95 + (z + 38.5) * 0.003 : -0.81 + Math.pow((z - 8) / 22, 2.0) * 4.6);
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.36, accent, { step: 0.25 });
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.2, cheat, { step: 0.25 });
    P.band(Z0, Z1, -Infinity, edge, belly, { step: 0.25 });
    P.textOn(SC.title, -16.5, 1.6, 'both', 0.72, { color: SC.titleColor, font, weight: 700, spacing: 0.1 });
  } else if (SC.style === 'state') {    // state transport: teal lower body, gold pinstripes, full nation title, flag and crest
    const edge = (z) => -0.55 + Math.max(0, z - 20) * 0.05;
    P.band(Z0, Z1, -Infinity, edge, belly, { step: 0.3 });
    P.band(-35.8, Z1, (z) => edge(z) + 0.1, (z) => edge(z) + 0.17, accent, { step: 0.3 });
    P.band(-35.8, Z1, (z) => edge(z) - 0.09, (z) => edge(z) - 0.05, accent, { step: 0.3 });
    { const k = (z) => Math.min(1, Math.pow(Math.max(0, (z + 38.2) / 2.4), 0.8)); P.band(-38.2, -35.8, (z) => -0.55 - 0.6 * (1 - k(z)), (z) => edge(z) - 0.09 + 0.0 * k(z), belly, { step: 0.1 }); }
    P.textOn(SC.title, -15.0, 1.66, 'both', 0.62, { color: SC.titleColor, font, weight: 700, spacing: 0.16 });
    P.decalOn(-26.6, 1.55, 'both', (g) => drawCrest(g, 0.55, SC));
    P.decalOn(20.5, 1.6, 'both', (g, layer, side) => drawFlag(g, 1.15, SC, side === 'R'));
  } else {                              // 'bands': grey belly, a blue stripe through the main-deck windows, a thin one on the hump
    P.band(Z0, Z1, -Infinity, -1.25, belly, { step: 0.5 });
    P.band(-35.5, 30, -0.1, 0.8, cheat, { step: 0.5 });
    P.band(-35.5, 30, -0.3, -0.18, F.gloss(SC.accent), { step: 0.5 });
    H.band(-33.0, 3.5, 3.72, 3.86, cheat, { step: 0.5 });
    P.textOn(SC.title, -17, 1.62, 'both', 0.66, { color: SC.titleColor, font, weight: 700, spacing: 0.14 });
    P.textOn('747-8 INTERCONTINENTAL', 14, 1.3, 'both', 0.3, { color: SC.titleColor, font: K.FONT.sans, weight: 700, spacing: 0.06 });
  }
  const regCol = SC.style === 'sun' || SC.style === 'aurora' ? '#ffffff' : SC.style === 'state' ? SC.belly : SC.titleColor;
  P.textOn(SC.reg, SC.style === 'state' ? 27.5 : 24.5, SC.style === 'state' ? 1.45 : 1.25, 'both', 0.45, { color: regCol, font: K.FONT.sans, weight: 700 });
  P.textOn('747-8', -31.5, -0.9, 'both', 0.17, { color: SC.style === 'state' || SC.style === 'aurora' ? '#d8dde0' : '#80868c', font: K.FONT.wide, weight: 700 });
  // radome joint and its lightning-diverter strips
  P.ring(D(3.0), 0, 1, { px: 1.4, depth: 0.5, dark: 0.25 });
  for (const t of [0.12, 0.25, 0.38, 0.62, 0.75, 0.88]) P.line([[D(0.6), t], [D(2.95), t]], { px: 1, depth: 0.15, dark: 0.08 });
  // --- flight-deck windows: dark gasket around each opening (the openings themselves are cut out and glazed) ---
  for (const s of [1, -1]) {
    const m = (p) => [p[0], s > 0 ? p[1] : 1 - p[1]];
    for (const w of WIN) {
      const pts = w.map(m), path = (g) => { pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      H.stroke(path, 0, { color: '#2a2c30', rough: 0.45, metal: 0 }, { join: 'round', px: 5 });
      H.fill(pts, F.paintedGlass);
      H.groove(path, { px: 1.0, depth: 0.5, dark: 0.15 });
    }
  }
  H.fill([[WIN[0][0][0], WIN[0][0][1]], [WIN[0][3][0], WIN[0][3][1]], [WIN[0][3][0], 1 - WIN[0][3][1]], [WIN[0][0][0], 1 - WIN[0][0][1]]], { color: '#2a2c30', rough: 0.45, metal: 0 });   // centre post
  // --- cabin windows, doors ---
  const doorsZ = [D(9.0), D(17.5), D(26.0), D(51.0), D(64.0)];
  const zs = []; for (let z = -31.6; z < 27.2; z += 0.508) if (doorsZ.every(dz => Math.abs(z - dz) > 0.85)) zs.push(z);
  const frame = SC.style === 'bands' ? '#d9dde0' : SC.style === 'state' || SC.style === 'aurora' ? '#d3d7da' : '#c2c6c9';
  P.windows(zs, 0.35, { w: 0.25, h: 0.36, r: 0.1, frame });
  const zu = []; for (let z = -29.6; z < -10.5; z += 0.52) if (Math.abs(z + 17.2) > 0.7) zu.push(z);
  H.windows(zu, 3.2, { w: 0.25, h: 0.36, r: 0.1, frame, seed: 77 });
  const door = { px: 1.3, depth: 0.6, dark: 0.3 };
  doorsZ.forEach((dz, i) => {
    P.doorOn(dz - 0.54, dz + 0.54, -0.95, 0.98, { ...door, handle: true }); P.windows([dz], 0.55, { w: 0.2, h: 0.24, r: 0.08, lit: 0 });
    for (const side of ['L', 'R']) {
      P.textOn(`${i + 1}${side}`, dz + (side === 'L' ? -0.3 : 0.3), 0.75, side, 0.06, { color: '#5a6066', font: K.FONT.sans, weight: 700 });
      P.decalOn(dz, -0.75, side, (g) => { g.fillStyle = 'rgba(40,44,48,0.75)'; g.fillRect(-0.18, -0.05, 0.36, 0.1); g.fillStyle = '#c42a1e'; g.fillRect(-0.16, -0.035, 0.08, 0.07); });   // door-arming placard
    }
  });
  H.doorOn(-17.65, -16.75, 2.55, 3.85, { ...door, handle: true });                                       // upper-deck exit
  P.doorOn(D(18.2), D(21.0), -2.55, -1.0, { ...door, side: 'R' }); P.doorOn(D(47.8), D(50.6), -2.55, -1.0, { ...door, side: 'R' }); P.doorOn(D(55.6), D(56.8), -2.3, -1.15, { ...door, side: 'R' });   // cargo doors
  P.doorOn(D(3.4), D(4.1), -2.05, -1.45, { px: 1, depth: 0.4, dark: 0.14 });                                                       // E/E bay access
  // skin joints: circumferential every ~1.6 m with rivet rows either side, lap joints along the crown and above / below the windows
  const lapY = (y) => (z) => Math.min(fus.topAt(z) - 0.3, Math.max(fus.botAt(z) + 0.25, y + Math.max(0, z - 20) * 0.08));
  for (let z = -35; z < 36; z += 1.62) P.ring(z, 0, 1, { px: 1, depth: 0.3, dark: 0.06 });
  for (let z = -33; z < 5; z += 1.62) H.ring(z, 0.2, 0.8, { px: 1, depth: 0.3, dark: 0.06 });
  for (const y of [1.25, -0.45, -1.9]) { P.yLine(-34, 34, lapY(y), { px: 1, depth: 0.3, dark: 0.06 }); P.yLine(-34, 34, lapY(y + 0.06), { px: 1, depth: 0.12, dark: 0.025 }); }
  H.yLine(-33, 2, (z) => Math.min(hump.topAt(z) - 0.2, 3.75), { px: 1, depth: 0.3, dark: 0.06 });
  P.line([[-34, 0.5], [36.5, 0.5]], { px: 1, depth: 0.22, dark: 0.04 });
  // static ports, outflow valves, APU exhaust surround, grime
  P.decalOn(D(4.6), -0.6, 'both', (g) => { g.fillStyle = '#9aa0a5'; g.beginPath(); g.ellipse(0, 0, 0.12, 0.08, 0, 0, TAU); g.fill(); g.strokeStyle = '#c42a1e'; g.lineWidth = 0.014; g.strokeRect(-0.19, -0.13, 0.38, 0.26); });
  P.decalOn(33.0, 0.9, 'R', (g) => { g.fillStyle = '#2b2d30'; g.beginPath(); g.ellipse(0, 0, 0.32, 0.17, 0, 0, TAU); g.fill(); });
  for (const z of [D(46), D(55)]) P.decalOn(z, -2.6, 'L', (g) => { g.fillStyle = '#5a5e62'; g.beginPath(); g.roundRect(-0.35, -0.12, 0.7, 0.24, 0.1); g.fill(); g.strokeStyle = 'rgba(20,20,22,0.5)'; g.lineWidth = 0.012; for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * 0.12, -0.1); g.lineTo(i * 0.12, 0.1); g.stroke(); } });   // outflow valves
  P.textOn('NO STEP', D(4.2), -2.3, 'both', 0.05, { color: '#c42a1e', font: K.FONT.sans, weight: 700 });
  const rnd = (() => { let a = 11; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  for (let i = 0; i < 46; i++) { const z = -26 + rnd() * 55, t = rnd() < 0.5 ? rnd() * 0.07 : 1 - rnd() * 0.07; P.streak(z, t, z + 1.0 + rnd() * 3, t, 0.004 + rnd() * 0.01, { alpha: 0.05 + rnd() * 0.08 }); }
  for (let i = 0; i < 10; i++) { const z = 34 + rnd() * 3; P.streak(z, 0.55 + rnd() * 0.06, z + 1.6, 0.56 + rnd() * 0.05, 0.012, { alpha: 0.08 }); }          // APU soot
  for (const z of [-21.6, 15.2]) P.streak(z, 0.0, z + 4.5, 0.0, 0.18, { alpha: 0.12 });                                                                    // drain-mast streaks
  P.streak(-29.6, 0.02, -24, 0.03, 0.12, { alpha: 0.09 }); P.streak(-29.6, 0.98, -24, 0.97, 0.12, { alpha: 0.09 });                                          // nose-gear grime
  P.noise({ alpha: 0.028, scale: 4, stretch: [2, 1] }); P.noise({ alpha: 0.02, scale: 12, stretch: [2, 1] });
  H.noise({ alpha: 0.025, scale: 4, stretch: [2, 1] });
  // --- flight-deck panels: six displays, MCP strip, pedestal, overhead ---
  {
    const Q = A.pen(cPanel); Q.fill('all', { color: '#4c5157', rough: 0.7, metal: 0 });
    const scr = (a, b, w, h, col, fn) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#08090a', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(a + 0.012, b + 0.012, w - 0.024, h - 0.024), { color: col, rough: 0.15, metal: 0, emissive: col }); if (fn) Q.decal(a + w / 2, b + h / 2, { layers: ['color', 'emis'] }, fn); };
    const pfd = (g) => { g.fillStyle = '#2d6fbf'; g.fillRect(-0.07, -0.09, 0.14, 0.085); g.fillStyle = '#8a5a2a'; g.fillRect(-0.07, -0.005, 0.14, 0.085); g.strokeStyle = '#f2d23a'; g.lineWidth = 0.006; g.beginPath(); g.moveTo(-0.045, 0); g.lineTo(0.045, 0); g.stroke(); g.fillStyle = '#20252b'; g.fillRect(-0.13, -0.09, 0.04, 0.18); g.fillRect(0.09, -0.09, 0.04, 0.18); };
    const nd = (g) => { g.strokeStyle = '#e8e8e8'; g.lineWidth = 0.004; g.beginPath(); g.arc(0, 0.06, 0.09, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); g.strokeStyle = '#d65cd6'; g.beginPath(); g.moveTo(0, 0.06); g.lineTo(0.03, -0.04); g.lineTo(0.06, -0.08); g.stroke(); g.fillStyle = '#3ad16a'; g.fillRect(-0.07, -0.06, 0.02, 0.02); };
    const eicas = (g) => { g.strokeStyle = '#e8e8e8'; g.lineWidth = 0.004; for (const x of [-0.075, -0.025, 0.025, 0.075]) { g.beginPath(); g.arc(x, -0.04, 0.02, Math.PI, Math.PI * 1.8); g.stroke(); } g.fillStyle = '#3ad16a'; g.fillRect(-0.07, 0.03, 0.14, 0.004); g.fillStyle = '#f2a53a'; g.fillRect(-0.07, 0.05, 0.09, 0.004); };
    for (const [x0, flip] of [[0.12, 0], [1.58, 1]]) { scr(flip ? x0 + 0.36 : x0, 0.2, 0.34, 0.26, '#0c1322', pfd); scr(flip ? x0 : x0 + 0.36, 0.2, 0.34, 0.26, '#0b1220', nd); }
    scr(1.03, 0.11, 0.34, 0.24, '#0b1120', eicas); scr(1.03, 0.37, 0.34, 0.24, '#0b1120', nd);
    Q.fill((g) => g.rect(0.2, 0.0, 2.0, 0.085), { color: '#2e3236', rough: 0.6, metal: 0 });                     // MCP on the glareshield face
    for (let i = 0; i < 10; i++) Q.fill((g) => g.rect(0.3 + i * 0.185, 0.022, 0.1, 0.036), { color: '#0a0a0a', rough: 0.2, metal: 0, emissive: i % 3 ? '#3a2408' : '#000000' });
    for (let i = 0; i < 9; i++) Q.fill((g) => g.rect(0.42 + i * 0.185, 0.064, 0.03, 0.012), { color: '#9aa0a4', rough: 0.4, metal: 0 });
    Q.fill((g) => g.rect(0.85, 0.52, 0.06, 0.12), { color: '#c8c8c4', rough: 0.4, metal: 0 });                    // gear lever
    for (const x of [0.02, 2.22]) Q.fill((g) => g.rect(x, 0.2, 0.08, 0.26), { color: '#3a3e43', rough: 0.6, metal: 0 });   // clock / standby
  }
  {
    const Q = A.pen(cOver); Q.fill('all', { color: '#5f666d', rough: 0.7, metal: 0 });
    for (let j = 0; j < 9; j++) for (let i = 0; i < 8; i++) Q.fill((g) => g.rect(0.04 + i * 0.095, 0.04 + j * 0.104, 0.07, 0.075), { color: (i + j * 2) % 5 ? '#41474d' : '#202327', rough: 0.6, metal: 0, emissive: (i * 3 + j) % 7 === 0 ? '#1c1403' : undefined });
    for (let j = 0; j < 9; j++) Q.fill((g) => g.rect(0.02, 0.08 + j * 0.104, 0.76, 0.004), { color: '#e2e2dc', rough: 0.6, metal: 0 });
  }
  {
    const Q = A.pen(cPed); Q.fill('all', { color: '#4f555c', rough: 0.7, metal: 0 });
    for (const b of [0.56, 0.76]) for (const a of [0.04, 0.26]) { Q.fill((g) => g.rect(a, b, 0.2, 0.17), { color: '#0b0c0d', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(a + 0.02, b + 0.02, 0.16, 0.08), { color: '#0d1a12', rough: 0.2, metal: 0, emissive: '#0d2414' }); }
    Q.fill((g) => g.rect(0.08, 0.05, 0.34, 0.4), { color: '#25282c', rough: 0.6, metal: 0 });
    for (let k = 0; k < 4; k++) Q.fill((g) => g.rect(0.13 + k * 0.07, 0.1, 0.02, 0.3), { color: '#0c0d0e', rough: 0.5, metal: 0 });
  }
}

// ---- paint: wings, tail ---------------------------------------------------------------------------------------------------------
function paintSurfaces(B, o) {
  const { SC, W, fin, stab, cWT, cWB, cSt, cFin, SP_IN, SP_OUT } = o, F = K.FINISH;
  const grey = F.semigloss('#b9bec3'), dgrey = F.semigloss('#a4a9ae'), metal = { color: '#c9ccce', rough: 0.26, metal: 0.9 }, white = F.gloss('#e9ecee');
  const line = { px: 1, depth: 0.35, dark: 0.11 }, gap = { px: 1.8, depth: 0.8, dark: 0.45 };
  const at = (x, f) => { const p = W.at(x, f); return [p[0], p[2]]; };
  const Ln = (name, x) => W.lines[name].at(W.spanToU(x));
  const tipFill = F.gloss(SC.tip);
  const seg = (Q, name, xs, op) => { const pts = []; for (let x = xs[0]; x < xs[1]; x += 1.0) pts.push(at(x, Ln(name, x))); pts.push(at(xs[1], Ln(name, xs[1]))); Q.line(pts, op); };
  const spanFill = (Q, x0, x1, f0, f1, fin) => { const xs = []; for (let x = x0; x < x1; x += 1.5) xs.push(x); xs.push(x1); Q.fill([...xs.map(x => at(x, typeof f0 === 'string' ? Ln(f0, x) + 0.03 : f0)), ...xs.reverse().map(x => at(x, typeof f1 === 'string' ? Ln(f1, x) - 0.02 : f1))], fin); };
  for (const [chart, top] of [[cWT.i, true], [cWT.o, true], [cWB.i, false], [cWB.o, false]]) {
    const Q = B.pen(chart); Q.fill('all', top ? grey : white);
    if (top) spanFill(Q, 1.6, 30.2, 'kru', 'spoil', dgrey);                                                  // wing box: darker grey
    spanFill(Q, 1.4, 30.4, 0, 0.035, metal);                                                                 // polished leading edge
    Q.fill([[30.35, zLE(30.35) - 0.15], [34.45, zLE(34.45) - 0.4], [34.45, zTE(34.45) + 0.3], [30.35, zTE(30.35) + 0.15]], tipFill);    // painted raked tips
    if (top) {
      for (const [a, b] of [...SP_IN, ...SP_OUT]) Q.line([at(a, Ln('flap', a)), at(a, Ln('spoil', a)), at(b, Ln('spoil', b)), at(b, Ln('flap', b))], gap);
    } else {
      for (const [a, b] of [[3.5, 10.6], [12.3, 22.6], [24.4, 30.2]]) { Q.line([at(a, 0.005), at(a, Ln('kru', a)), at(b, Ln('kru', b)), at(b, 0.005)], gap); for (let x = a + 1.8; x < b - 0.5; x += 1.8) Q.line([at(x, 0.005), at(x, Ln('kru', x))], line); }
    }
    seg(Q, 'flap', [3.45, 10.45], gap); seg(Q, 'aft', [3.45, 10.45], gap); seg(Q, 'flap', [14.05, 23.9], gap);
    for (const x of [3.45, 10.45, 14.05, 23.9]) Q.line([at(x, Ln('flap', x)), at(x, 1)], gap);
    for (const [a, b] of [[11.35, 13.85], [24.1, 29.9]]) Q.line([at(a, 1), at(a, Ln('flap', a)), at(b, Ln('flap', b)), at(b, 1)], gap);
    for (const f of [0.2, 0.42]) { const pts = []; for (let x = 1.6; x < 30.2; x += 1.2) pts.push(at(x, f)); pts.push(at(30.2, f)); Q.line(pts, line); }
    for (let x = 3; x < 30; x += 1.6) Q.line([at(x, Ln('kru', x) + 0.01), at(x, Ln('spoil', x) - 0.01)], line);
    for (const f of [0.2, 0.42]) for (let x = 2; x < 30; x += 4) { const a = at(x, f + 0.006), b = at(Math.min(30, x + 4), f + 0.006); Q.rivets(a[0], a[1], b[0], b[1], 0.07, { px: 1.2, depth: 0.15, dark: 0.04 }); }
    if (top) {
      const a = at(3.4, 0.22), b = at(3.4, 0.58), c = at(9.5, 0.58), d = at(9.5, 0.22);                       // walkway outline
      Q.stroke((g) => { g.moveTo(d[0], d[1]); g.lineTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); }, 0.05, F.matte('#1e2022'));
      for (const x of [5.5, 7.5]) { const p = at(x, 0.4); Q.text('WALKWAY', p[0], p[1], 0.11, { color: '#2a2c2e', font: K.FONT.sans, rot: -90 }); }
      for (const x of [11.5, 23.5]) { const p = at(x, 0.08); Q.text('NO STEP', p[0], p[1] + 0.9, 0.12, { color: '#7a2a24', font: K.FONT.sans }); }
      for (const x of [6.0, 14.5, 21.0, 26.5]) { const p = at(x, 0.36); Q.decal(p[0], p[1], (g) => { g.fillStyle = '#3c4044'; g.beginPath(); g.arc(0, 0, 0.1, 0, TAU); g.fill(); g.strokeStyle = '#c42a1e'; g.lineWidth = 0.015; g.beginPath(); g.arc(0, 0, 0.16, 0, TAU); g.stroke(); }); }   // fuel caps
      for (const x of [11.5, 23.5]) { const a2 = at(x - 1.2, 0.0), b2 = at(x + 1.2, 0.0); Q.streak(a2[0], a2[1] + 1.0, b2[0], b2[1] + 2.6, 0.8, { alpha: 0.05 }); }
    } else {
      for (let i = 0; i < 16; i++) { const x = 4 + i * 1.6, a = at(x, 0.66); Q.streak(a[0], a[1], a[0], a[1] + 1.6, 0.07, { alpha: 0.1 }); }
      for (const x of [14, 18, 22, 26]) { const p = at(x, 0.4); Q.panel(p[0] - 0.3, p[1] - 0.22, p[0] + 0.3, p[1] + 0.22, { r: 0.05, px: 1, depth: 0.3, dark: 0.1 }); }
      for (const x of [11.5, 23.5]) { const p = at(x, 0.55); Q.streak(p[0] - 0.4, p[1], p[0] - 0.4, p[1] + 3.5, 1.4, { alpha: 0.14 }); Q.streak(p[0] + 0.4, p[1], p[0] + 0.4, p[1] + 3.5, 1.4, { alpha: 0.14 }); }   // exhaust / reverser soot
    }
    Q.noise({ alpha: 0.045, scale: 3, stretch: [1, 2.5], rough: 0.04 });
  }
  {
    const Q = B.pen(cSt); Q.fill('all', grey);
    const sa = (x, f) => { const p = stab.at(x, f); return [p[0], p[2]]; };
    Q.fill([sa(1.2, 0), sa(11.1, 0), sa(11.1, 0.06), sa(1.2, 0.06)], metal);
    Q.line([sa(2.95, 1), sa(2.95, 0.7), sa(6.7, 0.7), sa(6.7, 1)], gap); Q.line([sa(6.8, 1), sa(6.8, 0.7), sa(10.8, 0.7), sa(10.8, 1)], gap);
    for (const f of [0.22, 0.46]) Q.line([sa(1.5, f), sa(11, f)], line);
    for (const x of [4, 5.5, 7, 8.5, 10]) Q.line([sa(x, 0.07), sa(x, 0.69)], line);
    Q.noise({ alpha: 0.045, scale: 3, stretch: [1, 2], rough: 0.04 });
  }
  for (const key of ['L', 'R']) {
    const Q = B.pen(cFin[key]); Q.fill('all', F.gloss(SC.tail));
    const fa = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    const c = fa(8.6, 0.45);
    if (SC.style === 'sun') {            // gold sun disc with rays
      Q.decal(c[0], c[1], (g) => drawSunMark(g, 1.25, SC.accent, SC.tail));
    } else if (SC.style === 'aurora') {  // aurora ribbons
      Q.decal(c[0], c[1], (g) => {
        const rib = (dy, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(-2.6, 2.2 + dy); g.bezierCurveTo(-1.2, 0.6 + dy, 0.2, 2.0 + dy, 1.0, 0.2 + dy); g.bezierCurveTo(1.5, -0.9 + dy, 2.0, -1.6 + dy, 2.8, -2.6 + dy); g.stroke(); };
        rib(0, 0.55, SC.accent); rib(0.85, 0.32, SC.cheat); rib(1.5, 0.14, '#ffffff');
      });
      Q.text('N', c[0] - 0.4, c[1] + 2.6, 1.2, { color: '#ffffff', font: K.FONT.wide, weight: 700 });
    } else if (SC.style === 'state') {   // national flag across the fin, crest below it
      const fl = (y0, y1, f0, f1, col) => Q.fill([fa(y0, f0), fa(y1, f0), fa(y1, f1), fa(y0, f1)], F.gloss(col));
      fl(7.4, 12.2, 0.02, 0.36, SC.belly); fl(7.4, 12.2, 0.36, 0.66, '#f7f7f4'); fl(7.4, 12.2, 0.66, 1.0, SC.accent);
      const s = fa(9.8, 0.51); Q.decal(s[0], s[1], (g) => drawStar(g, 0.62, SC.belly));
      Q.fill([fa(2.2, 0), fa(3.3, 0), fa(3.3, 1.02), fa(2.2, 1.02)], F.gloss(SC.belly));
      Q.fill([fa(3.3, 0), fa(3.45, 0), fa(3.45, 1.02), fa(3.3, 1.02)], F.gloss(SC.accent));
      const cr = fa(5.6, 0.42); Q.decal(cr[0], cr[1], (g) => drawCrest(g, 0.75, SC));
    } else {
      Q.fill([fa(2.2, 0), fa(5.0, 0), fa(5.0, 1), fa(2.2, 1)], F.gloss(SC.cheat));
      Q.fill([fa(5.0, 0), fa(5.4, 0), fa(5.4, 1), fa(5.0, 1)], F.gloss(SC.accent));
      Q.text('747', c[0], c[1], 1.7, { color: SC.cheat, font: K.FONT.wide, weight: 700 });
    }
    const rp = SC.style === 'state' ? fa(13.0, 0.5) : fa(4.2, 0.62);
    Q.text(SC.reg, rp[0], rp[1], 0.36, { color: SC.style === 'bands' || SC.style === 'state' ? SC.titleColor : '#ffffff', font: K.FONT.sans, weight: 700 });
    Q.fill([fa(2.6, 0), fa(14.1, 0), fa(14.1, 0.03), fa(2.6, 0.03)], metal);
    const fg = { px: 1.6, depth: 0.5, dark: 0.3 };
    Q.line([fa(3.55, 1), fa(3.55, 0.7), fa(8.65, 0.7), fa(8.65, 1)], fg); Q.line([fa(8.75, 1), fa(8.75, 0.7), fa(13.85, 0.7), fa(13.85, 1)], fg);
    const fl = { px: 1, depth: 0.18, dark: 0.06 };
    for (const y of [5.2, 7.0, 10.5, 12.2]) Q.line([fa(y, 0.7), fa(y, 1)], fl);
    for (const f of [0.22, 0.46]) Q.line([fa(2.8, f), fa(13.9, f)], fl);
    Q.noise({ alpha: 0.03, scale: 3 });
  }
}

/** Sun disc with rays (Solvane). Canvas units = metres, centred on the origin. */
function drawSunMark(g, r, col, bg) {
  g.fillStyle = col; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; g.save(); g.rotate(a); g.beginPath(); g.moveTo(r * 1.2, -r * 0.13); g.lineTo(r * 2.08, 0); g.lineTo(r * 1.2, r * 0.13); g.closePath(); g.fill(); g.restore(); }
  g.fillStyle = bg; g.beginPath(); g.arc(0, 0, r * 0.66, 0, TAU); g.fill(); g.fillStyle = col; g.beginPath(); g.arc(0, 0, r * 0.44, 0, TAU); g.fill();
}
/** Five-pointed star. */
function drawStar(g, r, col) {
  g.fillStyle = col; g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.4 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath(); g.fill();
}
/** Calvessa flag (teal / white / gold vertical bands, teal star): width w, flies toward the nose on either side. */
function drawFlag(g, w, SC, flip) {
  const h = w * 0.62; g.save(); if (flip) g.scale(-1, 1);
  const cols = [SC.belly, '#f7f7f4', SC.accent];
  for (let i = 0; i < 3; i++) { g.fillStyle = cols[i]; g.fillRect(-w / 2 + i * w / 3, -h / 2, w / 3 + 0.002, h); }
  g.strokeStyle = 'rgba(30,34,38,0.35)'; g.lineWidth = 0.01; g.strokeRect(-w / 2, -h / 2, w, h);
  drawStar(g, h * 0.24, SC.belly); g.restore();
}
/** Calvessa crest: gold ring, teal field, white star over three waves. */
function drawCrest(g, r, SC) {
  g.fillStyle = SC.accent; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  g.fillStyle = SC.belly; g.beginPath(); g.arc(0, 0, r * 0.84, 0, TAU); g.fill();
  drawStar(g, r * 0.38, '#f7f7f4');
  g.strokeStyle = SC.accent; g.lineWidth = r * 0.07;
  for (let i = 0; i < 3; i++) { const y = r * (0.36 + i * 0.13); g.beginPath(); for (let k = 0; k <= 12; k++) { const x = -r * 0.55 + k * r * 0.092; g.lineTo(x, y + Math.sin(k * 1.4) * r * 0.035); } g.stroke(); }
}
