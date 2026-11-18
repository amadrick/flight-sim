// Merged-geometry builder: collects quads/triangles per material key (one draw call per key per airport).
// UVs are in metres divided by the key's texture tile size, so facades line up at any building size.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const _c = new THREE.Color();
export function lin(hex) { _c.set(hex); return [_c.r, _c.g, _c.b]; }

export class MultiBuilder {
  constructor(tiles = {}) { this.tiles = tiles; this.parts = {}; }
  part(key) { return this.parts[key] || (this.parts[key] = { pos: [], nrm: [], uv: [], col: [], idx: [] }); }
  /** Quad a(bl) b(br) c(tl) d(tr); n = outward normal; uv rect in metres [u0, v0, u1, v1] (or explicit uvs array). */
  quad(key, a, b, c, d, n, col, uvr, explicitUV) {
    const P = this.part(key), base = P.pos.length / 3;
    const t = this.tiles[key] || [1, 1];
    const uvs = explicitUV || [[uvr[0] / t[0], uvr[1] / t[1]], [uvr[2] / t[0], uvr[1] / t[1]], [uvr[0] / t[0], uvr[3] / t[1]], [uvr[2] / t[0], uvr[3] / t[1]]];
    for (const [i, p] of [a, b, c, d].entries()) {
      P.pos.push(p[0], p[1], p[2]); P.nrm.push(n[0], n[1], n[2]); P.uv.push(uvs[i][0], uvs[i][1]); P.col.push(col[0], col[1], col[2]);
    }
    // winding: make the face front-facing along n
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) P.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    else P.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  tri(key, a, b, c, n, col, uva, uvb, uvc) {
    const P = this.part(key), base = P.pos.length / 3;
    const t = this.tiles[key] || [1, 1];
    for (const [p, uv] of [[a, uva], [b, uvb], [c, uvc]]) { P.pos.push(p[0], p[1], p[2]); P.nrm.push(n[0], n[1], n[2]); P.uv.push(uv[0] / t[0], uv[1] / t[1]); P.col.push(col[0], col[1], col[2]); }
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) P.idx.push(base, base + 1, base + 2); else P.idx.push(base, base + 2, base + 1);
  }
  /** Vertical wall: bottom-centre (x,z), outward normal (nx,nz), width w, from y0 to y0+h. */
  wall(key, x, z, nx, nz, w, y0, h, col, u0 = 0) {
    const rx = nz, rz = -nx; // viewer's right when looking at the face
    const a = [x - rx * w / 2, y0, z - rz * w / 2], b = [x + rx * w / 2, y0, z + rz * w / 2];
    this.quad(key, a, b, [a[0], y0 + h, a[2]], [b[0], y0 + h, b[2]], [nx, 0, nz], col, [u0, 0, u0 + w, h]);
  }
  /** Horizontal rectangle (roof / slab) facing up (or down when up=false). */
  slab(key, cx, y, cz, hdg, len, wid, col, up = true) {
    const h = hdg * DEG, dx = Math.sin(h), dz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const p = (sa, sc) => [cx + dx * sa * len / 2 + rx * sc * wid / 2, y, cz + dz * sa * len / 2 + rz * sc * wid / 2];
    this.quad(key, p(-1, -1), p(1, -1), p(-1, 1), p(1, 1), [0, up ? 1 : -1, 0], col, [0, 0, len, wid]);
  }
  /** Oriented box. keys: string or { pa, na, pr, nr, top, bottom } (p/n = +/- along, r = right). */
  box(keys, cx, y0, cz, hdg, len, wid, h, col, opts = {}) {
    const K = typeof keys === 'string' ? { pa: keys, na: keys, pr: keys, nr: keys, top: keys } : keys;
    const hr = hdg * DEG, dx = Math.sin(hr), dz = -Math.cos(hr), rx = Math.cos(hr), rz = Math.sin(hr);
    const cols = opts.cols || {};
    if (K.pa) this.wall(K.pa, cx + dx * len / 2, cz + dz * len / 2, dx, dz, wid, y0, h, cols.pa || col);
    if (K.na) this.wall(K.na, cx - dx * len / 2, cz - dz * len / 2, -dx, -dz, wid, y0, h, cols.na || col);
    if (K.pr) this.wall(K.pr, cx + rx * wid / 2, cz + rz * wid / 2, rx, rz, len, y0, h, cols.pr || col);
    if (K.nr) this.wall(K.nr, cx - rx * wid / 2, cz - rz * wid / 2, -rx, -rz, len, y0, h, cols.nr || col);
    if (K.top) this.slab(K.top, cx, y0 + h, cz, hdg, len, wid, cols.top || col, true);
    if (K.bottom) this.slab(K.bottom, cx, y0, cz, hdg, len, wid, cols.bottom || col, false);
  }
  /** Vertical cylinder (seg sides) with optional top cap key. */
  cylinder(key, cx, y0, cz, r, h, seg, col, capKey, r2 = r) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
      const p = (a, rr, y) => [cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr];
      const slope = (r - r2) / h;
      const n = [Math.cos(am), slope, Math.sin(am)]; const nl = Math.hypot(...n);
      this.quad(key, p(a0, r, y0), p(a1, r, y0), p(a0, r2, y0 + h), p(a1, r2, y0 + h), n.map((v) => v / nl), col,
        [a0 * r, 0, a1 * r, h]);
    }
    if (capKey) for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a) => [cx + Math.cos(a) * r2, y0 + h, cz + Math.sin(a) * r2];
      const pa = p(a0), pb = p(a1);
      this.tri(capKey, [cx, y0 + h, cz], pa, pb, [0, 1, 0], col, [cx, cz], [pa[0], pa[2]], [pb[0], pb[2]]);
    }
  }
  /** Dome: upper part of a sphere from elevation angle e0 to the top. */
  dome(key, cx, y0, cz, r, col, e0 = 0, seg = 16, rings = 6) {
    for (let j = 0; j < rings; j++) {
      const t0 = e0 + (j / rings) * (Math.PI / 2 - e0), t1 = e0 + ((j + 1) / rings) * (Math.PI / 2 - e0);
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const P = (a, t) => [cx + Math.cos(a) * Math.cos(t) * r, y0 + Math.sin(t) * r, cz + Math.sin(a) * Math.cos(t) * r];
        const am = (a0 + a1) / 2, tm = (t0 + t1) / 2;
        const n = [Math.cos(am) * Math.cos(tm), Math.sin(tm), Math.sin(am) * Math.cos(tm)];
        this.quad(key, P(a0, t0), P(a1, t0), P(a0, t1), P(a1, t1), n, col, [a0 * r, t0 * r, a1 * r, t1 * r]);
      }
    }
  }
  /** Barrel vault along the box length axis: semi-elliptic section (half-width wid/2, rise h), from y0. */
  vault(key, endKeys, cx, y0, cz, hdg, len, wid, h, col, seg = 10, endCol) {
    const hr = hdg * DEG, dx = Math.sin(hr), dz = -Math.cos(hr), rx = Math.cos(hr), rz = Math.sin(hr);
    const sec = []; for (let i = 0; i <= seg; i++) { const t = (i / seg) * Math.PI; sec.push([Math.cos(t) * wid / 2, Math.sin(t) * h]); }
    const P = (sa, s) => [cx + dx * sa * len / 2 + rx * s[0], y0 + s[1], cz + dz * sa * len / 2 + rz * s[0]];
    let arc = 0;
    for (let i = 0; i < seg; i++) {
      const s0 = sec[i], s1 = sec[i + 1];
      // outward normal of the section edge (pointing away from the axis)
      let n = [-(s1[1] - s0[1]), (s1[0] - s0[0]), 0];
      const mid = [(s0[0] + s1[0]) / 2, (s0[1] + s1[1]) / 2];
      if (n[0] * mid[0] + n[1] * mid[1] < 0) n = [-n[0], -n[1], 0];
      const nl = Math.hypot(n[0], n[1]);
      const nw = [(rx * n[0]) / nl, n[1] / nl, (rz * n[0]) / nl];
      const seglen = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]);
      this.quad(key, P(-1, s0), P(1, s0), P(-1, s1), P(1, s1), nw, col, [0, arc, len, arc + seglen]);
      arc += seglen;
    }
    // end caps (fans)
    for (const [sa, key2] of [[1, endKeys?.pa], [-1, endKeys?.na]]) {
      if (!key2) continue;
      const n = [dx * sa, 0, dz * sa];
      const c0 = P(sa, [0, 0]);
      for (let i = 0; i < seg; i++) {
        const a = P(sa, sec[i]), b = P(sa, sec[i + 1]);
        this.tri(key2, c0, a, b, n, endCol || col, [wid / 2, 0], [sec[i][0] + wid / 2, sec[i][1]], [sec[i + 1][0] + wid / 2, sec[i + 1][1]]);
      }
    }
  }
  /** Gable roof prism on top of a box footprint: ridge along the length axis. */
  gable(key, endKey, cx, y0, cz, hdg, len, wid, rise, col, endCol) {
    const hr = hdg * DEG, dx = Math.sin(hr), dz = -Math.cos(hr), rx = Math.cos(hr), rz = Math.sin(hr);
    const P = (sa, sc, y) => [cx + dx * sa * len / 2 + rx * sc * wid / 2, y, cz + dz * sa * len / 2 + rz * sc * wid / 2];
    const slopeLen = Math.hypot(wid / 2, rise);
    for (const sc of [-1, 1]) {
      const n = [rx * sc * rise / slopeLen, (wid / 2) / slopeLen, rz * sc * rise / slopeLen];
      this.quad(key, P(-1, sc, y0), P(1, sc, y0), P(-1, 0, y0 + rise), P(1, 0, y0 + rise), n, col, [0, 0, len, slopeLen]);
    }
    if (endKey) for (const sa of [-1, 1]) {
      this.tri(endKey, P(sa, -1, y0), P(sa, 1, y0), P(sa, 0, y0 + rise), [dx * sa, 0, dz * sa], endCol || col, [0, 0], [wid, 0], [wid / 2, rise]);
    }
  }
  /** Thin oriented beam between two 3D points (square section s). */
  beam(key, p0, p1, s, col) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz); if (len < 1e-4) return;
    const u = [dx / len, dy / len, dz / len];
    let a = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let v = [u[1] * a[2] - u[2] * a[1], u[2] * a[0] - u[0] * a[2], u[0] * a[1] - u[1] * a[0]];
    const vl = Math.hypot(...v); v = v.map((x) => x / vl);
    const w = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const h = s / 2;
    const off = (p, sv, sw) => [p[0] + (v[0] * sv + w[0] * sw) * h, p[1] + (v[1] * sv + w[1] * sw) * h, p[2] + (v[2] * sv + w[2] * sw) * h];
    const faces = [[v, w], [v.map((x) => -x), w], [w, v], [w.map((x) => -x), v]];
    for (const [n, t] of faces) {
      const c = (p, st) => [p[0] + (n[0] + t[0] * st) * h, p[1] + (n[1] + t[1] * st) * h, p[2] + (n[2] + t[2] * st) * h];
      this.quad(key, c(p0, -1), c(p0, 1), c(p1, -1), c(p1, 1), n, col, [0, 0, s, len]);
    }
  }
  build() {
    const out = {};
    for (const [k, P] of Object.entries(this.parts)) {
      if (!P.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(P.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(P.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(P.col, 3));
      g.setIndex(P.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(P.idx, 1) : new THREE.Uint16BufferAttribute(P.idx, 1));
      g.computeBoundingSphere();
      out[k] = g;
    }
    return out;
  }
}
