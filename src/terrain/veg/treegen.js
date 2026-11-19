// Procedural tree meshes (boot time): a trunk and branches (tapered tubes) clad in alpha-tested leaf-cluster cards.
// Every species is built ONCE at unit height (y = 0 ground .. 1 top) and packed into a float texture that the
// instanced vertex shaders read by gl_VertexID ("vertex pulling"), so one draw call renders any mix of species.
//
// Per vertex, 3 RGBA32F texels:
//   t0 = position.xyz (units of tree height), atlas u          t1 = shading normal.xyz, atlas v
//   t2 = h_rel (crown-relative height; < 0 below the crown), d_rel (crown depth: 0 surface .. 1 axis),
//        wind weight (bending), kind (0 = bark: uv wraps in the bark tile, 1 = leaf card)
import * as THREE from 'three';
import { SPECIES, crownRadius, rng32 } from './species.js';
import { tileRect } from './foliage.js';

export const VMAX = 1152;               // vertices per species (384 triangles), non-indexed
export const VTEX_W = 2048;

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

class Builder {
  constructor(sp) { this.sp = sp; this.f = []; this.n = 0; }
  crownInfo(p) {
    const sp = this.sp;
    const t = (p.y - sp.base) / (1 - sp.base);
    const R = Math.max(crownRadius(sp, t), 1e-3);
    const rn = Math.hypot(p.x, p.z) / R;
    return [t, Math.min(Math.max(1 - rn, 0), 1)];
  }
  vert(p, n, u, v, kind, wind, hd) {
    const [h, d] = hd || this.crownInfo(p);
    this.f.push(p.x, p.y, p.z, u, n.x, n.y, n.z, v, h, d, wind, kind);
    this.n++;
  }
  tri(a, b, c) { for (const q of [a, b, c]) this.vert(...q); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  /** Tapered tube along points pts (Vector3) with radii rs; sides S. */
  tube(pts, rs, S, windFn) {
    const frames = [];
    for (let i = 0; i < pts.length; i++) {
      const t = (i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
      const a = Math.abs(t.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
      const x = new THREE.Vector3().crossVectors(t, a).normalize(), z = new THREE.Vector3().crossVectors(t, x);
      frames.push([x, z]);
    }
    let len = 0;
    const vs = [0];
    for (let i = 1; i < pts.length; i++) { len += pts[i].distanceTo(pts[i - 1]); vs.push(len); }
    for (let i = 0; i < pts.length - 1; i++) for (let s = 0; s < S; s++) {
      const ring = (k, ss) => {
        const ang = ss / S * Math.PI * 2, [x, z] = frames[k];
        const n = x.clone().multiplyScalar(Math.cos(ang)).addScaledVector(z, Math.sin(ang));
        const p = pts[k].clone().addScaledVector(n, rs[k]);
        return [p, n, ss / S, vs[k] * 6, 0, windFn(pts[k]), [-1, 0]];
      };
      this.quad(ring(i, s), ring(i + 1, s), ring(i + 1, s + 1), ring(i, s + 1));
    }
  }
  /** Leaf card centred at c with normal n, up vector up, size w x h, atlas tile rect sub (u0,v0,u1,v1 in tile). */
  card(c, n, up, w, h, tile, sub, shadeN, windW, flutter = 1) {
    const right = new THREE.Vector3().crossVectors(up, n).normalize();
    const upv = new THREE.Vector3().crossVectors(n, right).normalize();
    const [tx, ty, ts] = tileRect(tile);
    const [u0, v0, u1, v1] = sub || [0, 0, 1, 1];
    // tile v = 0 is the top row of the raster (y down); card bottom = raster bottom (the twig base)
    const P = (sx, sy) => c.clone().addScaledVector(right, sx * w * 0.5).addScaledVector(upv, sy * h * 0.5);
    const UV = (sx, sy) => [tx + ts * (u0 + (u1 - u0) * (sx * 0.5 + 0.5)), ty + ts * (v0 + (v1 - v0) * (0.5 - sy * 0.5))];
    const mk = (sx, sy) => { const p = P(sx, sy); const [u, v] = UV(sx, sy); return [p, shadeN(p), u, v, 1 + 0.5 * flutter, windW(p), null]; };
    this.quad(mk(-1, -1), mk(1, -1), mk(1, 1), mk(-1, 1));
  }
  /** A card spanning from a (inner end) to b (outer end), width w, rotated `roll` around the a-b axis. */
  strip(a, b, w, roll, tile, sub, shadeN, windW) {
    const ax = b.clone().sub(a), L = ax.length(); ax.normalize();
    const side0 = new THREE.Vector3().crossVectors(ax, v3(0, 1, 0));
    if (side0.lengthSq() < 1e-6) side0.set(1, 0, 0);
    side0.normalize();
    const nrm0 = new THREE.Vector3().crossVectors(side0, ax).normalize();
    const side = side0.clone().multiplyScalar(Math.cos(roll)).addScaledVector(nrm0, Math.sin(roll));
    const [tx, ty, ts] = tileRect(tile);
    const [u0, v0, u1, v1] = sub;
    const mk = (t, s) => {
      const p = a.clone().addScaledVector(ax, t * L).addScaledVector(side, s * w * 0.5);
      return [p, shadeN(p), tx + ts * (u0 + (u1 - u0) * t), ty + ts * (v0 + (v1 - v0) * (0.5 + 0.5 * s)), 1.5, windW(p), null];
    };
    this.quad(mk(0, -1), mk(1, -1), mk(1, 1), mk(0, 1));
  }
}

function crownNormal(sp, p, upBias = 0.35) {
  // outward normal of the crown envelope (smooth "spherical" foliage normal), biased upward
  const cy = sp.base + (1 - sp.base) * (sp.shape === 'cone' ? 0.25 : sp.peak);
  const n = v3(p.x / Math.max(sp.rad, 0.05), (p.y - cy) / Math.max((1 - sp.base) * 0.5, 0.05), p.z / Math.max(sp.rad, 0.05));
  if (n.lengthSq() < 1e-6) n.set(0, 1, 0);
  n.normalize(); n.y += upBias;
  return n.normalize();
}

function buildBroadleaf(b, sp, r, o) {
  const H0 = sp.base, crownH = 1 - sp.base;
  const trunkTop = sp.base + crownH * (o.trunkUp ?? 0.55);
  const lean = v3((r() - 0.5) * 0.04, 0, (r() - 0.5) * 0.04);
  const tp = [], tr = [];
  const nseg = 4;
  for (let i = 0; i <= nseg; i++) {
    const t = i / nseg;
    tp.push(v3(lean.x * t * t + (r() - 0.5) * 0.006, t * trunkTop, lean.z * t * t + (r() - 0.5) * 0.006));
    tr.push(o.trunkR * (1 - 0.65 * t) * (i === 0 ? 1.35 : 1));
  }
  const wind = (p) => Math.pow(Math.max(p.y, 0), 2) * 0.6;
  b.tube(tp, tr, 6, wind);
  // main limbs
  const nl = o.limbs;
  for (let i = 0; i < nl; i++) {
    const a = (i / nl) * Math.PI * 2 + r() * 0.8;
    const y0 = H0 + crownH * (0.08 + 0.45 * r());
    const t1 = Math.min(1, (y0 - H0) / crownH + 0.25 + 0.2 * r());
    const R1 = crownRadius(sp, t1) * 0.7;
    const p0 = v3(lean.x * 0.5, y0, lean.z * 0.5);
    const p2 = v3(Math.cos(a) * R1, H0 + crownH * t1, Math.sin(a) * R1);
    const p1 = p0.clone().lerp(p2, 0.5); p1.y += 0.03;
    b.tube([p0, p1, p2], [o.trunkR * 0.45, o.trunkR * 0.3, o.trunkR * 0.12], 4, wind);
  }
  // leaf cards on and just inside the crown envelope
  const shade = (p) => crownNormal(sp, p, o.upBias ?? 0.3);
  const leafWind = (p) => Math.pow(Math.max(p.y, 0), 1.5) * 0.8 + 0.2;
  const used = b.n + 0;
  const nCards = Math.floor((VMAX - used) / 6);
  for (let i = 0; i < nCards; i++) {
    const t = Math.pow(r(), o.tPow ?? 0.85);
    const R = crownRadius(sp, t);
    const a = r() * Math.PI * 2;
    const rn = 1 - 0.55 * Math.pow(r(), 1.6);
    const c = v3(Math.cos(a) * R * rn, H0 + crownH * t, Math.sin(a) * R * rn);
    let n = crownNormal(sp, c, 0.15);
    const perp = r() < (o.perp ?? 0.25);
    n = n.clone().add(v3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.9)).normalize();
    let up = v3(0, 1, 0);
    if (perp) { up = n.clone(); n = new THREE.Vector3().crossVectors(n, v3(0, 1, 0)).normalize(); if (n.lengthSq() < 0.1) n.set(1, 0, 0); }
    if (Math.abs(n.dot(up)) > 0.95) up = v3(1, 0, 0);
    const s = o.card * (0.75 + 0.5 * r()) * (0.7 + 0.3 * rn);
    const nc = n.clone().multiplyScalar(n.dot(crownNormal(sp, c, 0)) < 0 ? -0.4 : 0.4);
    b.card(c, n, up, s, s, sp.tile, null, (p) => shade(p).add(nc).normalize(), leafWind);
  }
}

function buildCone(b, sp, r, o) {
  const H0 = sp.base;
  const wind = (p) => Math.pow(Math.max(p.y, 0), 2) * 0.5;
  const tp = [], tr = [];
  for (let i = 0; i <= 3; i++) { const t = i / 3; tp.push(v3((r() - 0.5) * 0.004, t * 0.97, (r() - 0.5) * 0.004)); tr.push(o.trunkR * (1 - 0.8 * t) * (i === 0 ? 1.3 : 1)); }
  b.tube(tp, tr, 6, wind);
  const shade = (p) => crownNormal(sp, p, 0.55);
  const leafWind = (p) => Math.pow(Math.max(p.y, 0), 1.5) * 0.7 + 0.15;
  // whorls of drooping boughs, each a V-folded pair of strips; the topmost whorls are short and steep
  const nw = o.whorls, per = o.per;
  let k = 0;
  for (let w = 0; w < nw; w++) {
    const t = Math.pow(w / nw, 0.9);
    const y = H0 + (1 - H0) * t;
    const R = crownRadius(sp, t) * (1.0 + 0.1 * r()) + 0.015;
    const droop = o.droop + 0.25 * t;
    for (let i = 0; i < per; i++) {
      const a = (i / per) * Math.PI * 2 + w * 2.4 + r() * 0.5;
      const L = R * (0.9 + 0.2 * r());
      const a0 = v3(Math.cos(a) * 0.01, y + 0.02, Math.sin(a) * 0.01);
      const b0 = v3(Math.cos(a) * L, y - Math.sin(droop) * L * 0.9 + 0.01, Math.sin(a) * L);
      const wdt = L * 0.85 + 0.02;
      const sub = (k++ & 1) ? [0.02, 0.5, 1, 1.0] : [0.02, 0.06, 1, 0.56];
      b.strip(a0, b0, wdt, 0.55, sp.tile, sub, shade, leafWind);
      b.strip(a0, b0, wdt, -0.55, sp.tile, sub, shade, leafWind);
    }
  }
  // spire: two crossed vertical cards at the top
  const top = v3(0, 0.93, 0);
  for (let i = 0; i < 2; i++) {
    const a = i * Math.PI / 2;
    b.card(top, v3(Math.cos(a), 0, Math.sin(a)), v3(0, 1, 0), 0.07, 0.14, sp.tile, [0.3, 0.05, 0.9, 0.55], shade, leafWind);
  }
}

function buildPalm(b, sp, r) {
  const wind = (p) => Math.pow(Math.max(p.y, 0), 2) * 0.9;
  const bend = v3((r() - 0.5) * 0.25, 0, (r() - 0.5) * 0.25);
  const tp = [], tr = [];
  const top = sp.base;
  for (let i = 0; i <= 6; i++) { const t = i / 6; tp.push(v3(bend.x * t * t, t * top, bend.z * t * t)); tr.push(0.028 * (1 - 0.3 * t) * (i === 0 ? 1.4 : 1)); }
  b.tube(tp, tr, 6, wind);
  const crown = tp[6];
  const shade = (p) => { const n = p.clone().sub(crown); n.y = Math.max(n.y, 0) + 0.6; return n.normalize(); };
  const leafWind = (p) => 0.9 + 0.6 * p.clone().sub(crown).length();
  const nf = 14;
  for (let i = 0; i < nf; i++) {
    const a = (i / nf) * Math.PI * 2 + r() * 0.3;
    const up0 = 0.9 - 1.5 * (i % 3) / 3 + (r() - 0.5) * 0.3;     // some fronds rise, some droop
    const L = sp.rad * (0.95 + 0.25 * r());
    let p = crown.clone();
    const dir = v3(Math.cos(a), up0, Math.sin(a)).normalize();
    for (let s = 0; s < 4; s++) {
      const seg = dir.clone().multiplyScalar(L / 4);
      const q = p.clone().add(seg);
      dir.y -= 0.35; dir.normalize();
      const sub = [s / 4, 0.05, (s + 1) / 4, 0.95];
      b.strip(p, q, L * 0.42 * (1 - 0.15 * s), 0.35, sp.tile, sub, shade, leafWind);
      b.strip(p, q, L * 0.42 * (1 - 0.15 * s), -0.35, sp.tile, sub, shade, leafWind);
      p = q;
    }
  }
}

function buildDome(b, sp, r, o) {
  const wind = (p) => Math.pow(Math.max(p.y, 0), 1.5) * 0.4;
  for (let i = 0; i < o.stems; i++) {
    const a = r() * Math.PI * 2, rr = sp.rad * 0.55;
    b.tube([v3(0, 0, 0), v3(Math.cos(a) * rr * 0.5, 0.45, Math.sin(a) * rr * 0.5), v3(Math.cos(a) * rr, 0.8, Math.sin(a) * rr)], [0.035, 0.02, 0.008], 3, wind);
  }
  const shade = (p) => crownNormal(sp, p, 0.4);
  const leafWind = (p) => 0.3 + 0.7 * p.y;
  const nCards = Math.floor((o.maxV - b.n) / 6);
  for (let i = 0; i < nCards; i++) {
    const t = Math.pow(r(), 0.8);
    const R = crownRadius(sp, t);
    const a = r() * Math.PI * 2, rn = 1 - 0.5 * r() * r();
    const c = v3(Math.cos(a) * R * rn, sp.base + (1 - sp.base) * t, Math.sin(a) * R * rn);
    const n = crownNormal(sp, c, 0.1).add(v3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.8)).normalize();
    const up = Math.abs(n.y) > 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
    const s = o.card * (0.75 + 0.5 * r());
    const nc = n.clone().multiplyScalar(0.4);
    b.card(c, n, up, s * 1.2, s, sp.tile, null, (p) => shade(p).add(nc).normalize(), leafWind);
  }
}

const OPTS = {
  spruce: { kind: 'cone', trunkR: 0.016, whorls: 13, per: 6, droop: 0.35 },
  fir:    { kind: 'cone', trunkR: 0.016, whorls: 13, per: 6, droop: 0.22 },
  pine:   { kind: 'broad', trunkR: 0.020, limbs: 5, card: 0.13, trunkUp: 0.5, tPow: 0.7, upBias: 0.45 },
  oak:    { kind: 'broad', trunkR: 0.032, limbs: 7, card: 0.16, trunkUp: 0.45 },
  beech:  { kind: 'broad', trunkR: 0.026, limbs: 6, card: 0.15, trunkUp: 0.5 },
  birch:  { kind: 'broad', trunkR: 0.018, limbs: 5, card: 0.10, trunkUp: 0.7, perp: 0.35 },
  poplar: { kind: 'broad', trunkR: 0.020, limbs: 4, card: 0.085, trunkUp: 0.8, perp: 0.4, upBias: 0.15 },
  palm:   { kind: 'palm' },
  tropic: { kind: 'broad', trunkR: 0.030, limbs: 7, card: 0.17, trunkUp: 0.55, tPow: 0.6, upBias: 0.5 },
  scrub:  { kind: 'dome', stems: 5, card: 0.30, maxV: 600 },
  desert: { kind: 'dome', stems: 6, card: 0.40, maxV: 420 },
  bush:   { kind: 'dome', stems: 4, card: 0.30, maxV: 600 },
};

/** Build all species. Returns { texture (RGBA32F vertex data), vcount per species, bounds per species, triangles }. */
export function buildTreeMeshes() {
  const rows = Math.ceil(SPECIES.length * VMAX * 3 / VTEX_W);
  const data = new Float32Array(VTEX_W * rows * 4);
  const info = [];
  SPECIES.forEach((sp, si) => {
    const r = rng32(9001 + si * 7919);
    const b = new Builder(sp);
    const o = OPTS[sp.id];
    if (o.kind === 'cone') buildCone(b, sp, r, o);
    else if (o.kind === 'palm') buildPalm(b, sp, r);
    else if (o.kind === 'dome') buildDome(b, sp, r, o);
    else buildBroadleaf(b, sp, r, o);
    let n = Math.min(b.n, VMAX);
    n -= n % 3;
    let ymin = Infinity, ymax = -Infinity, rmax = 0;
    for (let v = 0; v < n; v++) {
      const f = b.f.slice(v * 12, v * 12 + 12);
      const base = (si * VMAX + v) * 3 * 4;
      data.set(f.slice(0, 4), base); data.set(f.slice(4, 8), base + 4); data.set(f.slice(8, 12), base + 8);
      ymin = Math.min(ymin, f[1]); ymax = Math.max(ymax, f[1]);
      rmax = Math.max(rmax, Math.hypot(f[0], f[2]));
    }
    // unused vertices: degenerate (all zero = collapsed at the base)
    const cy = (ymin + ymax) / 2;
    let R = 0;
    for (let v = 0; v < n; v++) { const k = v * 12; R = Math.max(R, Math.hypot(b.f[k], b.f[k + 1] - cy, b.f[k + 2])); }
    info.push({ id: sp.id, vcount: n, tris: n / 3, cy, radius: R * 1.02, rmax, ymax });
  });
  const tex = new THREE.DataTexture(data, VTEX_W, rows, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { texture: tex, info, rows };
}

/** GLSL: fetch vertex v of species s from the vertex texture. */
export const VERTEX_PULL_GLSL = /* glsl */`
uniform highp sampler2D tVegVerts;
void vegFetch(int s, int v, out vec4 t0, out vec4 t1, out vec4 t2) {
  int i = (s * ${VMAX} + v) * 3;
  t0 = texelFetch(tVegVerts, ivec2(i % ${VTEX_W}, i / ${VTEX_W}), 0); i++;
  t1 = texelFetch(tVegVerts, ivec2(i % ${VTEX_W}, i / ${VTEX_W}), 0); i++;
  t2 = texelFetch(tVegVerts, ivec2(i % ${VTEX_W}, i / ${VTEX_W}), 0);
}
`;
