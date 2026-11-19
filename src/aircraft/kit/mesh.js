// Aircraft kit — mesh builder and primitives.
// A `Mesh` is a growable indexed triangle soup (positions, normals, uvs) in BODY axes (+X right, +Y up, -Z nose).
// Generators return Mesh objects; the rig merges them by material and turns them into BufferGeometry.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3(), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion();

export class Mesh {
  constructor() { this.p = []; this.n = []; this.uv = []; this.idx = []; this.p2 = null; this.occ = null; }
  get vertexCount() { return this.p.length / 3; }
  get triCount() { return this.idx.length / 3; }
  /** Add a vertex, return its index. */
  vert(x, y, z, nx, ny, nz, u = 0, v = 0) {
    const i = this.p.length / 3;
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v);
    if (this.p2) this.p2.push(x, y, z);
    if (this.occ) this.occ.push(0);
    return i;
  }
  /**
   * Baked ambient occlusion per vertex (0 = open … 1 = fully enclosed), for cavities that shadow maps cannot resolve: wheel
   * wells, intake ducts, jet pipes, cockpit tubs. `v` is a number or (x, y, z, i) => number; the larger of old and new wins.
   * The kit skin material darkens ambient light (and, partly, direct light) by it. well() and the propulsion parts set it.
   */
  occlude(v) {
    const nv = this.vertexCount, o = this._occ(), p = this.p, f = typeof v === 'function';
    for (let i = 0; i < nv; i++) { const q = f ? v(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], i) : v; if (q > o[i]) o[i] = q; }
    return this;
  }
  _occ() { const nv = this.vertexCount; if (!this.occ) this.occ = []; const o = this.occ; while (o.length < nv) o.push(0); if (o.length > nv) o.length = nv; return o; }
  tri(a, b, c) { this.idx.push(a, b, c); return this; }
  /** Quad a,b,c,d counter-clockwise seen from outside. */
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); return this; }
  /** Start recording a morph target (second position set, initially equal to the base). */
  enableMorph() { if (!this.p2) this.p2 = this.p.slice(); return this; }
  setMorph(i, x, y, z) { this.p2[i * 3] = x; this.p2[i * 3 + 1] = y; this.p2[i * 3 + 2] = z; }
  /** Append another mesh (optionally transformed by a Matrix4). */
  add(o, matrix) {
    if (!o) return this;
    if (matrix) o = o.clone().transform(matrix);
    const base = this.vertexCount;
    if (o.p2 && !this.p2) this.enableMorph();
    const { p, n, uv, idx } = this;
    for (let i = 0; i < o.p.length; i++) { p.push(o.p[i]); n.push(o.n[i]); }
    for (let i = 0; i < o.uv.length; i++) uv.push(o.uv[i]);
    for (let i = 0; i < o.idx.length; i++) idx.push(o.idx[i] + base);
    if (this.p2) { const s = o.p2 || o.p; for (let i = 0; i < s.length; i++) this.p2.push(s[i]); }
    if (o.occ || this.occ) { if (!this.occ) this.occ = []; const d = this.occ, so = o.occ, nb = o.p.length / 3; while (d.length < base) d.push(0); d.length = base; for (let i = 0; i < nb; i++) d.push(so ? so[i] || 0 : 0); }
    if (o.onPart && !this.onPart) this.onPart = o.onPart;             // animation hook of a kit part (e.g. the pilot's head) travels with it
    return this;
  }
  clone() {
    const m = new Mesh();
    m.p = this.p.slice(); m.n = this.n.slice(); m.uv = this.uv.slice(); m.idx = this.idx.slice(); m.p2 = this.p2 ? this.p2.slice() : null; m.occ = this.occ ? this.occ.slice() : null;
    if (this.onPart) m.onPart = this.onPart;
    return m;
  }
  /** Apply a Matrix4 in place (normals use the normal matrix; winding flips for mirroring transforms). */
  transform(m) {
    _m3.getNormalMatrix(m);
    const { p, n, p2 } = this;
    for (let i = 0; i < p.length; i += 3) {
      _v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(m); p[i] = _v.x; p[i + 1] = _v.y; p[i + 2] = _v.z;
      _n.set(n[i], n[i + 1], n[i + 2]).applyMatrix3(_m3).normalize(); n[i] = _n.x; n[i + 1] = _n.y; n[i + 2] = _n.z;
      if (p2) { _v.set(p2[i], p2[i + 1], p2[i + 2]).applyMatrix4(m); p2[i] = _v.x; p2[i + 1] = _v.y; p2[i + 2] = _v.z; }
    }
    if (m.determinant() < 0) this.flipWinding();
    return this;
  }
  translate(x, y, z) { const { p, p2 } = this; for (let i = 0; i < p.length; i += 3) { p[i] += x; p[i + 1] += y; p[i + 2] += z; if (p2) { p2[i] += x; p2[i + 1] += y; p2[i + 2] += z; } } return this; }
  scale(x, y = x, z = x) { return this.transform(_m4.makeScale(x, y, z)); }
  rotateX(a) { return this.transform(_m4.makeRotationX(a)); }
  rotateY(a) { return this.transform(_m4.makeRotationY(a)); }
  rotateZ(a) { return this.transform(_m4.makeRotationZ(a)); }
  /** Rotate so that the +Z axis of the mesh points along `dir` (array or Vector3). */
  aim(dir) {
    const d = Array.isArray(dir) ? _v.fromArray(dir) : _v.copy(dir); d.normalize();
    _q.setFromUnitVectors(_n.set(0, 0, 1), d);
    return this.transform(new THREE.Matrix4().makeRotationFromQuaternion(_q));
  }
  flipWinding() { const ix = this.idx; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } return this; }
  /** Reverse the surface (winding and normals) — turns an outer skin into an inner one. */
  flip() { this.flipWinding(); const n = this.n; for (let i = 0; i < n.length; i++) n[i] = -n[i]; return this; }
  /** Mirrored copy across the YZ plane (left/right pair). `fixUV(x, y, z, i)` may return a new [u, v] per vertex. */
  mirrorX(fixUV) {
    const m = this.clone();
    for (let i = 0; i < m.p.length; i += 3) { m.p[i] = -m.p[i]; m.n[i] = -m.n[i]; if (m.p2) m.p2[i] = -m.p2[i]; }
    m.flipWinding();
    if (fixUV) for (let i = 0, k = 0; i < m.p.length; i += 3, k += 2) { const r = fixUV(m.p[i], m.p[i + 1], m.p[i + 2], i / 3); if (r) { m.uv[k] = r[0]; m.uv[k + 1] = r[1]; } }
    return m;
  }
  /** Point every vertex at one atlas location (a swatch). */
  setUV(uv) { const a = this.uv; for (let i = 0; i < a.length; i += 2) { a[i] = uv[0]; a[i + 1] = uv[1]; } return this; }
  /** Offset every vertex along its normal. */
  inflate(d) { const { p, n } = this; for (let i = 0; i < p.length; i++) p[i] += n[i] * d; return this; }
  /** Re-compute normals: faces sharing a welded position are smoothed when within `creaseDeg` of each other. */
  smooth(creaseDeg = 40) {
    const { p, idx } = this, cosT = Math.cos(creaseDeg * Math.PI / 180);
    const nt = idx.length / 3, fn = new Float64Array(nt * 3);
    const key = (i) => `${Math.round(p[i * 3] * 5000)},${Math.round(p[i * 3 + 1] * 5000)},${Math.round(p[i * 3 + 2] * 5000)}`;
    const groups = new Map();
    for (let t = 0; t < nt; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      fn[t * 3] = uy * vz - uz * vy; fn[t * 3 + 1] = uz * vx - ux * vz; fn[t * 3 + 2] = ux * vy - uy * vx;   // area-weighted
      for (let k = 0; k < 3; k++) { const kk = key(idx[t * 3 + k]); let g = groups.get(kk); if (!g) groups.set(kk, g = []); g.push(t); }
    }
    const out = new Mesh(); out.p2 = this.p2 ? [] : null; const occ = this.occ ? this._occ() : null, occOut = occ ? [] : null;
    for (let t = 0; t < nt; t++) {
      const fx = fn[t * 3], fy = fn[t * 3 + 1], fz = fn[t * 3 + 2], fl = Math.hypot(fx, fy, fz) || 1;
      const ids = [];
      for (let k = 0; k < 3; k++) {
        const vi = idx[t * 3 + k]; let nx = 0, ny = 0, nz = 0;
        for (const o of groups.get(key(vi))) {
          const ox = fn[o * 3], oy = fn[o * 3 + 1], oz = fn[o * 3 + 2], ol = Math.hypot(ox, oy, oz) || 1;
          if ((fx * ox + fy * oy + fz * oz) / (fl * ol) >= cosT) { nx += ox; ny += oy; nz += oz; }
        }
        const l = Math.hypot(nx, ny, nz) || 1;
        const id = out.p.length / 3;
        out.p.push(p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2]); out.n.push(nx / l, ny / l, nz / l); out.uv.push(this.uv[vi * 2], this.uv[vi * 2 + 1]);
        if (out.p2) out.p2.push(this.p2[vi * 3], this.p2[vi * 3 + 1], this.p2[vi * 3 + 2]);
        if (occOut) occOut.push(occ[vi]);
        ids.push(id);
      }
      out.idx.push(ids[0], ids[1], ids[2]);
    }
    this.p = out.p; this.n = out.n; this.uv = out.uv; this.idx = out.idx; this.p2 = out.p2; this.occ = occOut;
    return this;
  }
  /** Axis-aligned bounds { min: [x,y,z], max: [x,y,z] }. */
  bounds() {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], p = this.p;
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { if (p[i + k] < mn[k]) mn[k] = p[i + k]; if (p[i + k] > mx[k]) mx[k] = p[i + k]; }
    return { min: mn, max: mx };
  }
  toGeometry() {
    const g = new THREE.BufferGeometry(), nv = this.vertexCount;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    if (this.p2) { g.morphAttributes.position = [new THREE.Float32BufferAttribute(this.p2, 3)]; g.morphTargetsRelative = false; }
    if (this.occ) {                                                   // baked occlusion (see occlude()); absent = unoccluded
      const o = new Uint8Array(nv), s = this.occ; for (let i = 0; i < nv && i < s.length; i++) o[i] = Math.max(0, Math.min(255, Math.round(s[i] * 255)));
      g.setAttribute('kitOcc', new THREE.BufferAttribute(o, 1, true));
    }
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** Merge several meshes into a new one. */
export function merge(...meshes) { const m = new Mesh(); for (const o of meshes.flat()) if (o) m.add(o); return m; }

const UV0 = [0, 0];

/**
 * Surface of revolution about the +Z axis. `profile` = [[r, z, hard?], ...]; walk it with z increasing for an
 * outward-facing skin (decreasing z gives an inward-facing duct wall). `hard` (truthy 3rd element) makes a crease.
 * opts: { segments = 16, uv = [u, v] | (k, j, r, z) => [u, v], arc = [0, 1] (fraction of the turn, 0 = bottom, .25 = +X side),
 *         sx = 1, sy = 1 (ellipse scaling), morph: profile2 (same length) }
 */
export function lathe(profile, opts = {}) {
  const seg = opts.segments ?? 16, uv = opts.uv ?? UV0, arc = opts.arc ?? [0, 1];
  const closed = arc[0] === 0 && arc[1] === 1, sx = opts.sx ?? 1, sy = opts.sy ?? 1;
  const m = new Mesh(), n = profile.length, P2 = opts.morph;
  if (P2) m.enableMorph();
  // expand hard points into two profile entries with one-sided normals
  const rows = [];
  for (let k = 0; k < n; k++) {
    const [r, z, hard] = profile[k];
    const prev = profile[Math.max(0, k - 1)], next = profile[Math.min(n - 1, k + 1)];
    const nrm = (a, b) => { const dr = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dr, dz) || 1; return [dz / l, -dr / l]; };
    if (hard && k > 0 && k < n - 1) { rows.push({ r, z, k, nn: nrm(prev, profile[k]), end: true }); rows.push({ r, z, k, nn: nrm(profile[k], next) }); }
    else rows.push({ r, z, k, nn: nrm(prev, next) });
  }
  const cols = seg + 1, first = [];
  for (const row of rows) {
    first.push(m.vertexCount);
    for (let j = 0; j <= seg; j++) {
      const t = arc[0] + (arc[1] - arc[0]) * (j / seg), phi = t * Math.PI * 2, s = Math.sin(phi), c = -Math.cos(phi);
      const u = typeof uv === 'function' ? uv(row.k, j / seg, row.r, row.z) : uv;
      let nx = row.nn[0] * s / sx, ny = row.nn[0] * c / sy, nz = row.nn[1]; const l = Math.hypot(nx, ny, nz) || 1;
      const i = m.vert(row.r * s * sx, row.r * c * sy, row.z, nx / l, ny / l, nz / l, u[0], u[1]);
      if (P2) m.setMorph(i, P2[row.k][0] * s * sx, P2[row.k][0] * c * sy, P2[row.k][1]);
    }
  }
  for (let a = 0; a < rows.length - 1; a++) {
    if (rows[a].end) continue;
    const r0 = rows[a].r, r1 = rows[a + 1].r, ia = first[a], ib = first[a + 1];
    for (let j = 0; j < seg; j++) {
      if (r0 > 1e-9) m.tri(ia + j, ia + j + 1, ib + j + 1);
      if (r1 > 1e-9) m.tri(ia + j, ib + j + 1, ib + j);
    }
  }
  void closed; void cols;
  return m;
}

/** Cylinder / cone frustum from point a to point b. opts: { segments = 12, caps = true, uv } */
export function tube(a, b, r0, r1 = r0, opts = {}) {
  const A = new THREE.Vector3().fromArray(a), B = new THREE.Vector3().fromArray(b), len = A.distanceTo(B);
  const caps = opts.caps ?? true;
  const prof = caps ? [[0, 0], [r0, 0, 1], [r1, len, 1], [0, len]] : [[r0, 0], [r1, len]];
  const m = lathe(prof, { segments: opts.segments ?? 12, uv: opts.uv });
  return m.aim(B.clone().sub(A)).translate(A.x, A.y, A.z);
}

/** Tube along a polyline with spherical-ish mitred joints. radius may be a number or per-point array. */
export function pipe(points, radius, opts = {}) {
  const m = new Mesh();
  for (let i = 0; i < points.length - 1; i++) {
    const r0 = Array.isArray(radius) ? radius[i] : radius, r1 = Array.isArray(radius) ? radius[i + 1] : radius;
    m.add(tube(points[i], points[i + 1], r0, r1, { segments: opts.segments ?? 8, uv: opts.uv, caps: i === 0 || i === points.length - 2 }));
    if (i > 0) m.add(ellipsoid(r0, r0, r0, { segments: opts.segments ?? 8, rings: 4, uv: opts.uv }).translate(...points[i]));
  }
  return m;
}

/** Ellipsoid centred at the origin. opts: { segments = 12, rings = 8, uv, z0 = -1, z1 = 1 (truncate along Z, unit fractions) } */
export function ellipsoid(rx, ry, rz, opts = {}) {
  const rings = opts.rings ?? 8, z0 = opts.z0 ?? -1, z1 = opts.z1 ?? 1, prof = [];
  const a0 = Math.asin(z0), a1 = Math.asin(z1);
  for (let i = 0; i <= rings; i++) { const a = a0 + (a1 - a0) * (i / rings); prof.push([Math.max(0, Math.cos(a)), Math.sin(a)]); }
  const m = lathe(prof, { segments: opts.segments ?? 12, uv: opts.uv });
  _m4.makeScale(rx, ry, rz);
  return m.transform(_m4);
}

/**
 * Skin over a stack of rings — the organic-shape primitive (limbs, torsos, helmets, cushions, rounded boxes).
 * ring: { c: [x, y, z], u: [x, y, z], v: [x, y, z] (the ring's two axes, need not be unit), rx = 1, ry = rx, n = 2 (superellipse
 *         exponent: 2 ellipse … 8 rounded rectangle), uv, hard (crease: do not share normals with the previous ring) }
 * Ring point at angle θ = c + u·rx·C(θ) + v·ry·S(θ); rx = ry = 0 makes a pole (end cap). The skin faces outward when the rings
 * advance along u × v. opts: { segments = 12, uv = [u, v] | (ringIndex, j / segments) => [u, v], occ: (ringIndex) => occlusion }
 * Normals are smooth (area-weighted) along and around; two rings at the same place with `hard` on the second make a crease.
 */
export function shell(rings, opts = {}) {
  const seg = opts.segments ?? 12, m = new Mesh(), nr = rings.length, P = new Float64Array(nr * seg * 3), uvO = opts.uv ?? UV0;
  for (let a = 0; a < nr; a++) {
    const R = rings[a], rx = R.rx ?? 1, ry = R.ry ?? rx, e = 2 / (R.n ?? 2), c = R.c, u = R.u, v = R.v;
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
      const x = rx * Math.sign(cs) * Math.pow(Math.abs(cs), e), y = ry * Math.sign(sn) * Math.pow(Math.abs(sn), e), o = (a * seg + j) * 3;
      P[o] = c[0] + u[0] * x + v[0] * y; P[o + 1] = c[1] + u[1] * x + v[1] * y; P[o + 2] = c[2] + u[2] * x + v[2] * y;
    }
  }
  // smoothing groups: rows of rings between creases share normals; vertices of one row are welded around the seam
  const N = new Float64Array(nr * seg * 3), N2 = new Float64Array(nr * seg * 3);   // N: normal from the band after the ring, N2: from the band before
  const quads = [];
  for (let a = 0; a < nr - 1; a++) for (let j = 0; j < seg; j++) {
    const j1 = (j + 1) % seg, i0 = a * seg + j, i1 = a * seg + j1, i2 = (a + 1) * seg + j1, i3 = (a + 1) * seg + j;
    const ax = P[i2 * 3] - P[i0 * 3], ay = P[i2 * 3 + 1] - P[i0 * 3 + 1], az = P[i2 * 3 + 2] - P[i0 * 3 + 2];
    const bx = P[i3 * 3] - P[i1 * 3], by = P[i3 * 3 + 1] - P[i1 * 3 + 1], bz = P[i3 * 3 + 2] - P[i1 * 3 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;                 // diagonal cross product = quad normal × area
    if (nx * nx + ny * ny + nz * nz < 1e-20) continue;
    for (const i of [i0, i1]) { N[i * 3] += nx; N[i * 3 + 1] += ny; N[i * 3 + 2] += nz; }
    for (const i of [i2, i3]) { N2[i * 3] += nx; N2[i * 3 + 1] += ny; N2[i * 3 + 2] += nz; }
    quads.push(a, j);
  }
  // emit: each ring row once (plus a seam column so UV functions may vary around); creased rings get their own normals
  const row = [];
  for (let a = 0; a < nr; a++) {
    const R = rings[a], hardHere = !!R.hard, hardNext = a + 1 < nr && !!rings[a + 1].hard, pole = (R.rx ?? 1) === 0 && (R.ry ?? R.rx ?? 1) === 0;
    let px = 0, py = 0, pz = 0;
    if (pole) for (let j = 0; j < seg; j++) { const o = (a * seg + j) * 3; px += N[o] + N2[o]; py += N[o + 1] + N2[o + 1]; pz += N[o + 2] + N2[o + 2]; }
    row.push(m.vertexCount);
    for (let j = 0; j <= seg; j++) {
      const o = (a * seg + (j % seg)) * 3;
      let nx = pole ? px : (hardHere ? 0 : N2[o]) + (hardNext ? 0 : N[o]), ny = pole ? py : (hardHere ? 0 : N2[o + 1]) + (hardNext ? 0 : N[o + 1]), nz = pole ? pz : (hardHere ? 0 : N2[o + 2]) + (hardNext ? 0 : N[o + 2]);
      if (hardHere && hardNext) { nx = N[o]; ny = N[o + 1]; nz = N[o + 2]; }
      const l = Math.hypot(nx, ny, nz) || 1, uv = R.uv || (typeof uvO === 'function' ? uvO(a, j / seg) : uvO);
      m.vert(P[o], P[o + 1], P[o + 2], nx / l, ny / l, nz / l, uv[0], uv[1]);
    }
  }
  for (let q = 0; q < quads.length; q += 2) { const a = quads[q], j = quads[q + 1], i0 = row[a] + j, i3 = row[a + 1] + j; m.quad(i0, i0 + 1, i3 + 1, i3); }
  if (opts.occ) { const o = m._occ(); for (let a = 0; a < nr; a++) { const v = opts.occ(a); for (let j = 0; j <= seg; j++) o[row[a] + j] = v; } }
  return m;
}

const _X = [1, 0, 0], _Z = [0, 0, 1];
/**
 * Rounded box ("pillow") centred at the origin: size sx × sy × sz, edge radius r, built as a shell along Y.
 * opts: { segments = 16, n = 6 (corner squareness in plan), uv }
 */
export function rbox(sx, sy, sz, r = 0.02, opts = {}) {
  const a = sx / 2, b = sz / 2, h = sy / 2, n = opts.n ?? 6; r = Math.min(r, h * 0.98, a * 0.9, b * 0.9);
  const ring = (y, k) => ({ c: [0, y, 0], u: _Z, v: _X, rx: Math.max(0, b - r * (1 - k)), ry: Math.max(0, a - r * (1 - k)), n });
  const R = [{ c: [0, -h, 0], u: _Z, v: _X, rx: 0, ry: 0 }, ring(-h, 0), ring(-h + r * 0.3, 0.7), ring(-h + r, 1), ring(h - r, 1), ring(h - r * 0.3, 0.7), ring(h, 0), { c: [0, h, 0], u: _Z, v: _X, rx: 0, ry: 0 }];
  return shell(R, { segments: opts.segments ?? 16, uv: opts.uv });
}

/**
 * Smooth tube through points with per-point radii — arms, legs, hoses, padded rolls. points: [[x, y, z], …];
 * radii: number | [r | [rx, ry], …] (rx along `side`, ry along the other ring axis).
 * opts: { segments = 8, sub = 3 (rings per span, Catmull-Rom), side = [1, 0, 0] (reference for the ring's X axis), caps = 'round' | 'flat' | 'none', n = 2,
 *         ripple = 0 (alternate ring radii by ± this fraction: corrugated hoses), uv }
 */
export function limb(points, radii, opts = {}) {
  const sub = opts.sub ?? 3, np = points.length, side = opts.side || _X, caps = opts.caps ?? 'round';
  const rad = (i) => { const r = Array.isArray(radii) ? radii[i] : radii; return Array.isArray(r) ? r : [r, r]; };
  const cr = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); };
  const pts = [];
  for (let i = 0; i < np - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(np - 1, i + 2)], r1 = rad(i), r2 = rad(i + 1);
    for (let k = 0; k < sub + (i === np - 2 ? 1 : 0); k++) { const t = k / sub; pts.push({ c: [cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t), cr(p0[2], p1[2], p2[2], p3[2], t)], rx: r1[0] + (r2[0] - r1[0]) * t, ry: r1[1] + (r2[1] - r1[1]) * t }); }
  }
  if (opts.ripple) pts.forEach((q, i) => { const f = 1 + opts.ripple * (i % 2 ? 1 : -1); q.rx *= f; q.ry *= f; });   // corrugated hoses
  const rings = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)].c, b = pts[Math.min(n - 1, i + 1)].c; let w = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const wl = Math.hypot(...w) || 1; w = w.map(q => q / wl);
    // ring axes: u ≈ side made perpendicular to the tangent, v = w × u (so u × v = w and the skin faces outward)
    let d = side[0] * w[0] + side[1] * w[1] + side[2] * w[2], u = [side[0] - w[0] * d, side[1] - w[1] * d, side[2] - w[2] * d]; let ul = Math.hypot(...u);
    if (ul < 1e-3) { u = Math.abs(w[1]) < 0.9 ? [-w[2], 0, w[0]] : [1, 0, 0]; d = u[0] * w[0] + u[1] * w[1] + u[2] * w[2]; u = [u[0] - w[0] * d, u[1] - w[1] * d, u[2] - w[2] * d]; ul = Math.hypot(...u); }
    u = u.map(q => q / ul);
    const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
    rings.push({ c: pts[i].c, u, v, rx: pts[i].rx, ry: pts[i].ry, n: opts.n ?? 2, w });
  }
  const round = (R, sgn) => {                                         // three shrinking rings ending in a pole, moving away along sgn × tangent
    const k = Math.min(R.rx, R.ry), out = [];
    for (const [f, e] of [[0.5, 0.87], [0.87, 0.5], [1, 0]]) out.push({ ...R, c: [R.c[0] + R.w[0] * k * f * sgn, R.c[1] + R.w[1] * k * f * sgn, R.c[2] + R.w[2] * k * f * sgn], rx: R.rx * e, ry: R.ry * e });
    return out;
  };
  const R0 = rings[0], Rn = rings[n - 1];
  let all = rings;
  if (caps === 'flat') all = [{ ...R0, rx: 0, ry: 0 }, { ...R0 }, { ...R0, hard: true }, ...rings.slice(1), { ...Rn, hard: true }, { ...Rn, rx: 0, ry: 0 }];
  else if (caps !== 'none') all = [...round(R0, -1).reverse(), ...rings, ...round(Rn, 1)];
  return shell(all, { segments: opts.segments ?? 8, uv: opts.uv });
}

/** Box centred at the origin with flat faces. */
export function box(sx, sy, sz, uv = UV0) {
  const m = new Mesh(), x = sx / 2, y = sy / 2, z = sz / 2;
  const face = (nx, ny, nz, pts) => { const i = m.vertexCount; for (const q of pts) m.vert(q[0], q[1], q[2], nx, ny, nz, uv[0], uv[1]); m.quad(i, i + 1, i + 2, i + 3); };
  face(1, 0, 0, [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]]);
  face(-1, 0, 0, [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]]);
  face(0, 1, 0, [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]]);
  face(0, -1, 0, [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]]);
  face(0, 0, 1, [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]);
  face(0, 0, -1, [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]]);
  return m;
}

/** Box given by min/max corners. */
export function boxBetween(min, max, uv) {
  return box(max[0] - min[0], max[1] - min[1], max[2] - min[2], uv).translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
}

/**
 * Extruded polygon: `outline` = [[z, y], ...] (any winding, may be concave) in the Z-Y plane, extruded along X from x0 to x1.
 * Flat-shaded side walls and caps. Useful for brackets, panel slabs, fairings, HUD frames.
 */
export function prism(outline, x0, x1, uv = UV0) {
  const m = new Mesh();
  let area = 0; const n = outline.length;
  for (let i = 0; i < n; i++) { const a = outline[i], b = outline[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const pts = area > 0 ? outline : outline.slice().reverse();          // counter-clockwise in (z, y) => seen from -X
  const tris = THREE.ShapeUtils.triangulateShape(pts.map(q => new THREE.Vector2(q[0], q[1])), []);
  for (const t of tris) {                                               // force ccw triangles
    const a = pts[t[0]], b = pts[t[1]], c = pts[t[2]];
    if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0) { const s = t[1]; t[1] = t[2]; t[2] = s; }
  }
  // cap at x0 faces -X (ccw in (z,y) seen from -X), cap at x1 faces +X
  let base = m.vertexCount; for (const q of pts) m.vert(x0, q[1], q[0], -1, 0, 0, uv[0], uv[1]);
  for (const t of tris) m.tri(base + t[0], base + t[1], base + t[2]);
  base = m.vertexCount; for (const q of pts) m.vert(x1, q[1], q[0], 1, 0, 0, uv[0], uv[1]);
  for (const t of tris) m.tri(base + t[0], base + t[2], base + t[1]);
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], dz = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dz, dy) || 1;
    const ny = -dz / l, nz = dy / l;                                   // outward for a ccw (z,y) polygon
    const i0 = m.vert(x0, a[1], a[0], 0, ny, nz, uv[0], uv[1]), i1 = m.vert(x0, b[1], b[0], 0, ny, nz, uv[0], uv[1]);
    const i2 = m.vert(x1, b[1], b[0], 0, ny, nz, uv[0], uv[1]), i3 = m.vert(x1, a[1], a[0], 0, ny, nz, uv[0], uv[1]);
    m.quad(i0, i3, i2, i1);
  }
  return m;
}

/** Flat double-sided quad plate with thickness: corners p0..p3 (ccw seen from the front), extruded by `t` behind. */
export function plate(p0, p1, p2, p3, t = 0.01, uv = UV0) {
  const a = new THREE.Vector3().fromArray(p0), b = new THREE.Vector3().fromArray(p1), c = new THREE.Vector3().fromArray(p2), d = new THREE.Vector3().fromArray(p3);
  const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
  const m = new Mesh();
  const f = [a, b, c, d], k = f.map(q => q.clone().addScaledVector(nrm, -t));
  const face = (q, nn) => { const i = m.vertexCount; for (const w of q) m.vert(w.x, w.y, w.z, nn.x, nn.y, nn.z, uv[0], uv[1]); m.quad(i, i + 1, i + 2, i + 3); };
  face(f, nrm); face([k[3], k[2], k[1], k[0]], nrm.clone().negate());
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, e = new THREE.Vector3().subVectors(f[j], f[i]), nn = e.cross(nrm).normalize();
    face([f[i], k[i], k[j], f[j]], nn);
  }
  return m;
}

// ---- operations on open surface patches (cut-outs of lofts / wings) -------------------------------------------------
function boundaryEdges(mesh) {
  const { p, idx } = mesh, key = (i) => `${Math.round(p[i * 3] * 20000)},${Math.round(p[i * 3 + 1] * 20000)},${Math.round(p[i * 3 + 2] * 20000)}`;
  const count = new Map(), edges = [];
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = idx[t + k], b = idx[t + (k + 1) % 3], ka = key(a), kb = key(b);
    if (ka === kb) continue;
    const kk = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    count.set(kk, (count.get(kk) || 0) + 1); edges.push([a, b, kk]);
  }
  return edges.filter(e => count.get(e[2]) === 1);
}

/**
 * Give an open skin patch thickness: adds an inner face (offset by `t` against the normals) and edge walls.
 * `uvInner` (optional [u, v]) recolours the inner face and the walls (e.g. interior primer); with it the inner face also gets
 * stiffeners (see ribs()): opts.ribs = false switches them off, an object passes { pitch, height, longerons, uv } on.
 */
export function thicken(patch, t = 0.02, uvInner = null, opts = {}) {
  const m = patch.clone(), nv = patch.vertexCount, { p, n, uv } = patch;
  for (let i = 0; i < nv; i++) {
    const u = uvInner || [uv[i * 2], uv[i * 2 + 1]];
    m.vert(p[i * 3] - n[i * 3] * t, p[i * 3 + 1] - n[i * 3 + 1] * t, p[i * 3 + 2] - n[i * 3 + 2] * t, -n[i * 3], -n[i * 3 + 1], -n[i * 3 + 2], u[0], u[1]);
  }
  for (let k = 0; k < patch.idx.length; k += 3) m.tri(patch.idx[k] + nv, patch.idx[k + 2] + nv, patch.idx[k + 1] + nv);
  for (const [a, b] of boundaryEdges(patch)) wall(m, patch, a, b, t, uvInner, false);
  // the inside of a door is structure, not a flat panel: stiffeners by default when the inner face has its own finish
  if (uvInner && opts.ribs !== false) {
    const o = m._occ(); for (let i = nv; i < 2 * nv; i++) o[i] = Math.max(o[i], 0.16);
    m.add(ribs(patch, { uv: uvInner, base: t, lip: false, ...(typeof opts.ribs === 'object' ? opts.ribs : {}) }));
  }
  return m;
}

/**
 * Recess behind a removed skin patch (wheel well, spoiler tray, speedbrake bay): floor = the patch pushed in by `depth`
 * (along -normal, or along `dir` if given), plus walls facing into the cavity. Returns a new Mesh. With a `uv` the bay also
 * gets frames across its roof and stiffeners down its walls (opts.ribs = false: bare; an object passes { pitch, height, longerons }).
 */
export function well(patch, depth = 0.3, uv = null, dir = null, opts = {}) {
  const m = new Mesh(), nv = patch.vertexCount, { p, n } = patch;
  for (let i = 0; i < nv; i++) {
    const u = uv || [patch.uv[i * 2], patch.uv[i * 2 + 1]];
    const dx = dir ? dir[0] : -n[i * 3], dy = dir ? dir[1] : -n[i * 3 + 1], dz = dir ? dir[2] : -n[i * 3 + 2];
    m.vert(p[i * 3] + dx * depth, p[i * 3 + 1] + dy * depth, p[i * 3 + 2] + dz * depth, n[i * 3], n[i * 3 + 1], n[i * 3 + 2], u[0], u[1]);
  }
  for (let k = 0; k < patch.idx.length; k++) m.idx.push(patch.idx[k]);
  const nFloor = m.vertexCount;
  for (const [a, b] of boundaryEdges(patch)) wall(m, patch, a, b, depth, uv, true, dir);
  // baked occlusion: the floor of the cavity is dark, the walls fade from the rim to the floor (i2, i3 of each wall quad are deep)
  const deep = Math.min(0.78, 0.5 + Math.abs(depth) * 0.6), o = m._occ();
  for (let i = 0; i < m.vertexCount; i++) o[i] = i < nFloor ? deep : ((i - nFloor) % 4 < 2 ? 0.18 : deep);
  // structure: frames and a longeron across the roof of the bay, continued down the walls as stiffeners
  if (uv && opts.ribs !== false && Math.abs(depth) > 0.12) {
    const ro = typeof opts.ribs === 'object' ? opts.ribs : {}, hh = ro.height ?? Math.min(0.07, Math.max(0.025, Math.abs(depth) * 0.09));
    const back = dir ? [-dir[0], -dir[1], -dir[2]] : null;           // fins stand off the floor toward the opening
    const floor = new Mesh(); floor.p = m.p.slice(0, nv * 3); floor.n = patch.n.map(q => -q); floor.uv = m.uv.slice(0, nv * 2); floor.idx = patch.idx.slice();
    const r = ribs(floor, { uv, height: hh, dir: back, lip: false, occ: [deep, Math.max(0.3, deep - 0.25)], ...ro });
    m.add(r);
    if (r.vertexCount) wallRibs(m, patch, depth, dir, uv, hh * 0.8, ro, deep);
  }
  return m;
}

// stiffeners down the walls of a well where the roof frames meet them
function wallRibs(m, patch, depth, dir, uv, h, ro, deep) {
  const { p, n } = patch, b = patch.bounds(), ext = [0, 1, 2].map(k => b.max[k] - b.min[k]), order = [0, 1, 2].sort((i, j) => ext[j] - ext[i]), aL = order[0];
  const L = ext[aL], pitch = ro.pitch ?? Math.min(0.5, Math.max(0.17, L / 5)), nF = Math.max(1, Math.round(L / pitch) - 1), c0 = centroid(patch), O = m._occ();
  for (const [ia, ib] of boundaryEdges(patch)) for (let k = 1; k <= nF; k++) {
    const c = b.min[aL] + L * k / (nF + 1), sa = p[ia * 3 + aL] - c, sb = p[ib * 3 + aL] - c;
    if ((sa < 0) === (sb < 0)) continue;
    const f = sa / (sa - sb), q = [0, 0, 0], d = [0, 0, 0];
    for (let e = 0; e < 3; e++) { q[e] = p[ia * 3 + e] + (p[ib * 3 + e] - p[ia * 3 + e]) * f; d[e] = dir ? dir[e] : -(n[ia * 3 + e] + (n[ib * 3 + e] - n[ia * 3 + e]) * f); }
    // into the cavity: toward the patch centroid, perpendicular to the frame plane normal and (roughly) to the wall
    const w = [c0[0] - q[0], c0[1] - q[1], c0[2] - q[2]]; w[aL] = 0; const dl = Math.hypot(...d) || 1, dd = (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / (dl * dl);
    for (let e = 0; e < 3; e++) w[e] -= d[e] * dd; const wl = Math.hypot(...w); if (wl < 1e-4) continue;
    for (let e = 0; e < 3; e++) w[e] *= h / wl;
    const A = [q[0] + d[0] * 0.02, q[1] + d[1] * 0.02, q[2] + d[2] * 0.02], B = [q[0] + d[0] * depth, q[1] + d[1] * depth, q[2] + d[2] * depth], N = [0, 0, 0]; N[aL] = 1;
    for (const sg of [1, -1]) {
      const i0 = m.vertexCount;
      for (const v of [A, B, [B[0] + w[0], B[1] + w[1], B[2] + w[2]], [A[0] + w[0], A[1] + w[1], A[2] + w[2]]]) m.vert(v[0], v[1], v[2], N[0] * sg, N[1] * sg, N[2] * sg, uv[0], uv[1]);
      O[i0] = 0.3; O[i0 + 1] = O[i0 + 2] = deep; O[i0 + 3] = 0.2;
      if (sg > 0) m.quad(i0, i0 + 1, i0 + 2, i0 + 3); else m.quad(i0 + 3, i0 + 2, i0 + 1, i0);
    }
  }
}

function wall(m, patch, a, b, t, uvW, inward, dir) {
  const { p, n, uv } = patch;
  const A = [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]], B = [p[b * 3], p[b * 3 + 1], p[b * 3 + 2]];
  const off = (i) => dir ? [dir[0] * t, dir[1] * t, dir[2] * t] : [-n[i * 3] * t, -n[i * 3 + 1] * t, -n[i * 3 + 2] * t];
  const oa = off(a), ob = off(b);
  const A2 = [A[0] + oa[0], A[1] + oa[1], A[2] + oa[2]], B2 = [B[0] + ob[0], B[1] + ob[1], B[2] + ob[2]];
  // outward wall normal = d x N (see derivation in README); inward = opposite
  const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
  const Nx = -(oa[0] + ob[0]), Ny = -(oa[1] + ob[1]), Nz = -(oa[2] + ob[2]);
  let wx = dy * Nz - dz * Ny, wy = dz * Nx - dx * Nz, wz = dx * Ny - dy * Nx; const l = Math.hypot(wx, wy, wz) || 1;
  const s = inward ? -1 / l : 1 / l; wx *= s; wy *= s; wz *= s;
  const ua = uvW || [uv[a * 2], uv[a * 2 + 1]], ub = uvW || [uv[b * 2], uv[b * 2 + 1]];
  const i0 = m.vert(A[0], A[1], A[2], wx, wy, wz, ua[0], ua[1]), i1 = m.vert(B[0], B[1], B[2], wx, wy, wz, ub[0], ub[1]);
  const i2 = m.vert(B2[0], B2[1], B2[2], wx, wy, wz, ub[0], ub[1]), i3 = m.vert(A2[0], A2[1], A2[2], wx, wy, wz, ua[0], ua[1]);
  if (inward) m.quad(i0, i1, i2, i3); else m.quad(i1, i0, i3, i2);
}

/**
 * Stiffeners for the hidden side of a skin patch (gear doors, wheel wells, speedbrakes): thin sheet fins standing off the
 * surface where planes at a regular pitch cut it — frames across the long axis and one or two longerons along it — plus a lip
 * around the open edge. Returns a new Mesh (double-sided fins, occluded at their roots).
 * opts: { uv, base = 0 (offset of the fin root from the patch along the stand-off direction), height = .03,
 *         dir = null ([x, y, z] stand-off direction; default: against the patch normals), pitch (default from the patch size),
 *         longerons (default 1 or 2), lip = true, occ = [root, tip] occlusion }
 */
export function ribs(patch, o = {}) {
  const m = new Mesh(), { p, n, idx } = patch, nv = patch.vertexCount, uv = o.uv || [0, 0];
  if (!nv) return m;
  const b = patch.bounds(), ext = [0, 1, 2].map(k => b.max[k] - b.min[k]), order = [0, 1, 2].sort((i, j) => ext[j] - ext[i]), aL = order[0], aW = order[1];
  const L = ext[aL], W = ext[aW];
  if (W < (o.minWidth ?? 0.14) || L < 0.2) return m;
  const h = o.height ?? Math.min(0.05, Math.max(0.016, W * 0.06)), base = o.base ?? 0, dir = o.dir || null, occ = o.occ || [0.55, 0.12];
  const off = (i, d) => dir ? [dir[0] * d, dir[1] * d, dir[2] * d] : [-n[i * 3] * d, -n[i * 3 + 1] * d, -n[i * 3 + 2] * d];
  const O = m._occ();
  const fin = (A, B, a2, b2, nx, ny, nz) => {                            // quad A, B (roots) → a2, b2 (tips), both faces
    for (const sg of [1, -1]) {
      const i0 = m.vertexCount;
      for (const q of [A, B, b2, a2]) m.vert(q[0], q[1], q[2], nx * sg, ny * sg, nz * sg, uv[0], uv[1]);
      O[i0] = O[i0 + 1] = occ[0]; O[i0 + 2] = O[i0 + 3] = occ[1];
      if (sg > 0) m.quad(i0, i0 + 1, i0 + 2, i0 + 3); else m.quad(i0 + 3, i0 + 2, i0 + 1, i0);
    }
  };
  const slice = (axis, c, hh) => {
    const N = [0, 0, 0]; N[axis] = 1;
    for (let t = 0; t < idx.length; t += 3) {
      const pts = [];
      for (let k = 0; k < 3; k++) {
        const i = idx[t + k], j = idx[t + (k + 1) % 3], si = p[i * 3 + axis] - c, sj = p[j * 3 + axis] - c;
        if ((si < 0) === (sj < 0)) continue;
        const f = si / (si - sj), oi = off(i, 1), oj = off(j, 1), q = [0, 0, 0], d = [0, 0, 0];
        for (let e = 0; e < 3; e++) { q[e] = p[i * 3 + e] + (p[j * 3 + e] - p[i * 3 + e]) * f; d[e] = oi[e] + (oj[e] - oi[e]) * f; }
        pts.push([q, d]);
      }
      if (pts.length !== 2) continue;
      const [[qa, da], [qb, db]] = pts;
      if (Math.hypot(qa[0] - qb[0], qa[1] - qb[1], qa[2] - qb[2]) < 1e-5) continue;
      const at = (q, d, k) => [q[0] + d[0] * k, q[1] + d[1] * k, q[2] + d[2] * k];
      fin(at(qa, da, base), at(qb, db, base), at(qa, da, base + hh), at(qb, db, base + hh), N[0], N[1], N[2]);
    }
  };
  const pitch = o.pitch ?? Math.min(0.5, Math.max(0.17, L / 5)), nF = Math.max(1, Math.round(L / pitch) - 1);
  for (let k = 1; k <= nF; k++) slice(aL, b.min[aL] + L * k / (nF + 1), h);
  const nLg = o.longerons ?? (W > 0.7 ? 2 : 1);
  for (let k = 1; k <= nLg; k++) slice(aW, b.min[aW] + W * k / (nLg + 1), h * 0.7);
  if (o.lip !== false) for (const [a, c] of boundaryEdges(patch)) {
    const A = [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]], B = [p[c * 3], p[c * 3 + 1], p[c * 3 + 2]], oa = off(a, 1), ob = off(c, 1);
    const e = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], nn = [e[1] * oa[2] - e[2] * oa[1], e[2] * oa[0] - e[0] * oa[2], e[0] * oa[1] - e[1] * oa[0]], l = Math.hypot(...nn) || 1;
    const at = (q, d, k) => [q[0] + d[0] * k, q[1] + d[1] * k, q[2] + d[2] * k];
    fin(at(A, oa, base), at(B, ob, base), at(A, oa, base + h * 0.8), at(B, ob, base + h * 0.8), nn[0] / l, nn[1] / l, nn[2] / l);
  }
  return m;
}

/** Centroid of a mesh's vertices as [x, y, z]. */
export function centroid(mesh) {
  const p = mesh.p, c = [0, 0, 0], n = p.length / 3 || 1;
  for (let i = 0; i < p.length; i += 3) { c[0] += p[i]; c[1] += p[i + 1]; c[2] += p[i + 2]; }
  return [c[0] / n, c[1] / n, c[2] / n];
}
