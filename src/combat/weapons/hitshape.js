// Hit shapes in body axes (+X right wing, +Y up, −Z nose) built from def.geometry, and swept-segment tests against them.
// An aircraft is a fuselage capsule (nose → tail), engine-pod capsules when the engines sit outside the fuselage, two
// boxes per wing (inner/outer, sheared along the sweep and dihedral), a vertical fin and horizontal tails. A hit reports
// the entry parameter along the segment, the body-space point and the part: 'cockpit' | 'fuselage' | 'engine' (index) |
// 'wingL' | 'wingR' | 'tail'. Non-aircraft entities (ground units) are spheres. Pure functions.
import * as THREE from 'three';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** Build the shape of an aircraft definition (or a sphere of `radius` when there is no geometry). */
export function buildShape(def, radius = 5) {
  const g = def?.geometry;
  if (!g || !g.length) return { sphere: radius, bound: radius, capsules: [], boxes: [], cockpit: null, engines: [] };
  const L = g.length, span = g.span || L * 0.7;
  const cat = def.category || 'fighter';
  const big = cat === 'airliner' || cat === 'transport' || cat === 'bomber';
  const rf = clamp((cat === 'transport' ? 0.065 : cat === 'airliner' ? 0.05 : 0.055) * L, 0.5, 4);
  const noseZ = g.noseZ ?? -0.5 * L, tailZ = g.tailZ ?? 0.5 * L;
  const capsules = [];
  // fuselage: the capsule's hemispherical ends sit on the nose and tail points
  capsules.push({ a: [0, 0, noseZ + rf * 0.7], b: [0, 0, tailZ - rf * 0.7], r: rf, part: 'fuselage' });
  const engines = [];
  (g.engines || []).forEach((en, i) => {
    const n = en.nozzle || [0, 0, tailZ];
    const off = Math.hypot(n[0], n[1]);
    const len = big ? 0.12 * L : 0.3 * L;
    const pod = off > rf + 0.3;
    const zFront = en.intake && pod ? en.intake[2] : n[2] - len;
    engines.push({ x: n[0], y: n[1], z0: zFront, z1: n[2] + 0.3, r: Math.max(0.6, (en.nozzleRadius || 0.5) * 1.6), pod });
    if (pod) {
      const r = Math.max(0.5, (en.nozzleRadius || 0.5) * (big ? 2.2 : 1.7));
      capsules.push({ a: [n[0], n[1], zFront + r], b: [n[0], n[1], n[2] - r * 0.5], r, part: 'engine', index: i });
    }
  });
  const boxes = [];
  const tip = (g.wingtips && g.wingtips[1]) || [span / 2, 0, 0.1 * L];
  const tipX = Math.abs(tip[0]), tipY = tip[1], tipZ = tip[2];
  if (tipX > rf + 0.5) {
    const c = (g.wingArea || span * L * 0.15) / span;      // mean chord
    const cr = 1.45 * c, ct = 0.55 * c;
    const x0 = rf * 0.8, x1 = tipX + 0.2;
    const zr = big ? tipZ * 0.25 : tipZ * 0.05;            // root mid-chord
    const szx = (tipZ - zr) / (tipX - x0), syx = tipY / Math.max(tipX, 1);
    const hy = clamp(0.06 * cr, 0.22, 1.2);
    const xm = 0.5 * (x0 + x1);
    for (const sx of [-1, 1]) {
      const part = sx < 0 ? 'wingL' : 'wingR';
      // inner and outer panels; z' = z − szx·(x' − x0), y' = y − syx·x'   (x' = sx·x)
      const ci = cr + (ct - cr) * 0.25, co = cr + (ct - cr) * 0.75;
      boxes.push({ sx, o: [x0, 0, zr], szx, syx, szy: 0, lo: [0, -hy, -0.5 * ci], hi: [xm - x0, hy, 0.5 * ci], part });
      boxes.push({ sx, o: [x0, 0, zr], szx, syx, szy: 0, lo: [xm - x0, -hy, -0.5 * co], hi: [x1 - x0, hy, 0.5 * co], part });
    }
  }
  // empennage
  const finTop = Math.max(rf * 1.5, (g.height || L * 0.3) - (g.cgHeight || 1.5));
  const finChord = (big ? 0.13 : 0.17) * L;
  if (cat !== 'bomber' || def.id !== 'b2') {
    const zf = tailZ - finChord * 1.05;
    boxes.push({ sx: 1, o: [0, rf * 0.6, zf], szx: 0, syx: 0, szy: 0.55, lo: [-0.25, 0, 0], hi: [0.25, finTop - rf * 0.6, finChord], part: 'tail' });
    const hs = big ? 0.2 * span : 0.32 * span;
    const hc = (big ? 0.11 : 0.15) * L;
    const zh = tailZ - hc * 1.1;
    for (const sx of [-1, 1]) boxes.push({ sx, o: [rf * 0.5, 0, zh], szx: 0.5, syx: 0, szy: 0, lo: [0, -0.2, 0], hi: [hs - rf * 0.5, 0.2, hc], part: 'tail' });
  }
  const eye = g.pilotEye || [0, 1, noseZ + 0.25 * L];
  const bound = Math.max(Math.abs(noseZ), Math.abs(tailZ), Math.hypot(tipX, tipZ), finTop) + 1;
  return { sphere: 0, bound, rf, capsules, boxes, engines, cockpit: { z: eye[2], y: eye[1], half: big ? 2.2 : 1.3 } };
}

// ---- segment / capsule ----------------------------------------------------------------------------------------------
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _r = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
/** Closest points between segments p0p1 and q0q1 (Ericson). Returns squared distance; sets segClosest.s / .t. */
export const segClosest = { s: 0, t: 0 };
export function segSegDist2(p0, p1, q0, q1) {
  _d1.subVectors(p1, p0); _d2.subVectors(q1, q0); _r.subVectors(p0, q0);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) { s = t = 0; }
  else if (a <= 1e-12) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = _d1.dot(_r);
    if (e <= 1e-12) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = _d1.dot(_d2), den = a * e - b * b;
      s = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  segClosest.s = s; segClosest.t = t;
  _c1.copy(p0).addScaledVector(_d1, s); _c2.copy(q0).addScaledVector(_d2, t);
  return _c1.distanceToSquared(_c2);
}

/** Squared distance from the origin to segment p0p1, and the parameter of the closest point (segPoint.s). */
export const segPoint = { s: 0 };
export function segOriginDist2(p0, p1) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const L2 = dx * dx + dy * dy + dz * dz;
  let s = L2 > 1e-12 ? -(p0.x * dx + p0.y * dy + p0.z * dz) / L2 : 0;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  segPoint.s = s;
  const x = p0.x + dx * s, y = p0.y + dy * s, z = p0.z + dz * s;
  return x * x + y * y + z * z;
}

// ---- segment / sheared box (slab test in the box's local frame) -------------------------------------------------------
const _l0 = [0, 0, 0], _l1 = [0, 0, 0];
function toLocal(B, p, o) {
  const x = B.sx * p.x - B.o[0], y = p.y - B.o[1], z = p.z - B.o[2];
  o[0] = x; o[1] = y - B.syx * x; o[2] = z - B.szx * x - B.szy * y;
}
/** Entry parameter (0..1) of segment p0p1 into box B, or -1. */
export function segBox(B, p0, p1) {
  toLocal(B, p0, _l0); toLocal(B, p1, _l1);
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const a = _l0[k], d = _l1[k] - a;
    if (Math.abs(d) < 1e-12) { if (a < B.lo[k] || a > B.hi[k]) return -1; continue; }
    let ta = (B.lo[k] - a) / d, tb = (B.hi[k] - a) / d;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }
  return t0;
}

/** Which part a point on the fuselage capsule belongs to. Returns the part name; sets classify.index for engines. */
export const classify = { index: -1 };
export function classifyPoint(shape, p) {
  classify.index = -1;
  const c = shape.cockpit;
  if (c && Math.abs(p.z - c.z) < c.half && p.y > c.y - 0.9) return 'cockpit';
  let best = -1, bd = Infinity;
  for (let i = 0; i < shape.engines.length; i++) {
    const e = shape.engines[i];
    if (e.pod || p.z < e.z0 || p.z > e.z1) continue;
    const d = Math.abs(p.x - e.x);
    if (d < Math.max(e.r, 0.9) && d < bd) { bd = d; best = i; }
  }
  if (best >= 0) { classify.index = best; return 'engine'; }
  if (shape.boxes.length && p.z > shape.capsules[0].b[2] - 0.12 * (shape.capsules[0].b[2] - shape.capsules[0].a[2])) return 'tail';
  return 'fuselage';
}

/**
 * Swept test of the body-space segment p0 → p1 against `shape`. Returns true on a hit and fills
 * hit: { t (entry parameter 0..1), part, index (engine, else -1), point: Vector3 (body) }.
 */
export function hitShape(shape, p0, p1, hit) {
  hit.point ||= new THREE.Vector3();
  let bestT = 2, part = '', index = -1;
  if (shape.sphere) {
    const d2 = segOriginDist2(p0, p1), r = shape.sphere;
    if (d2 > r * r) return false;
    const len = p0.distanceTo(p1) || 1;
    bestT = Math.max(0, segPoint.s - Math.sqrt(r * r - d2) / len); part = 'hull';
  } else {
    const len = p0.distanceTo(p1) || 1e-6;
    for (let i = 0; i < shape.capsules.length; i++) {
      const C = shape.capsules[i];
      _a.fromArray(C.a); _b.fromArray(C.b);
      const d2 = segSegDist2(p0, p1, _a, _b);
      if (d2 <= C.r * C.r) {
        const t = Math.max(0, segClosest.s - Math.sqrt(C.r * C.r - d2) / len);
        if (t < bestT) { bestT = t; part = C.part; index = C.index ?? -1; }
      }
    }
    for (let i = 0; i < shape.boxes.length; i++) {
      const t = segBox(shape.boxes[i], p0, p1);
      if (t >= 0 && t < bestT) { bestT = t; part = shape.boxes[i].part; index = -1; }
    }
    if (bestT > 1) return false;
  }
  hit.t = bestT;
  hit.point.copy(p0).lerp(p1, bestT);
  if (part === 'fuselage') { part = classifyPoint(shape, hit.point); index = classify.index; }
  hit.part = part; hit.index = index;
  return true;
}

/** Nearest part to a body-space point (blast damage): distance-weighted classification without a ray. */
export function nearestPart(shape, p) {
  classify.index = -1;
  if (shape.sphere) return 'hull';
  const ax = Math.abs(p.x);
  const tipBox = shape.boxes.find((b) => b.part === 'wingR' || b.part === 'wingL');
  if (tipBox && ax > shape.rf * 1.6 && p.z < (shape.capsules[0].b[2] * 0.6)) return p.x < 0 ? 'wingL' : 'wingR';
  return classifyPoint(shape, p);
}
