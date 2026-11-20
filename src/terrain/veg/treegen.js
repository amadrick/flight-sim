// Procedural tree meshes (boot time): a trunk and branches (tapered tubes) clad in alpha-tested leaf-cluster cards.
// Every species is built ONCE at unit height (y = 0 ground .. 1 top) and packed into a float texture that the
// instanced vertex shaders read by gl_VertexID ("vertex pulling"), so one draw call renders any mix of species.
//
// Per vertex, 4 RGBA32F texels:
//   t0 = position.xyz (units of tree height), atlas u          t1 = shading normal.xyz, atlas v
//   t2 = h_rel (crown-relative height; < 0 below the crown), d_rel (crown depth: 0 surface .. 1 axis),
//        wind weight (bending), kind (0 = bark: uv wraps in the bark tile, 1 = leaf card)
//   t3 = baked visibility through this tree's own leaves, L1 SH: V(w) ~ t3.x + t3.yzw . w (tree-local w)
//
// Broadleaf trees and pines grow a space-colonisation skeleton (tree-skeleton.js) with pipe-model limbs and leaf
// cluster cards at the twig tips; spruce / fir are whorls of drooping boughs; palms and shrubs are rule-based.
// URL vegGen=classic builds the previous generation (envelope-scattered cards, no skeleton, no light bake).
import * as THREE from 'three';
import { SPECIES, crownRadius, rng32 } from './species.js';
import { tileRect } from './foliage.js';
import { growSkeleton, chains, leafGrid, bakeVisibility } from './tree-skeleton.js';

export const VMAX = 2560;               // vertices per species (853 triangles), non-indexed
export const VTEX_W = 2048;
export const VTEXELS = 4;               // texels per vertex

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

class Builder {
  constructor(sp) { this.sp = sp; this.f = []; this.n = 0; this.cards = []; this.max = VMAX; }
  crownInfo(p) {
    const sp = this.sp;
    const t = (p.y - sp.base) / (1 - sp.base);
    const R = Math.max(crownRadius(sp, t), 1e-3);
    const rn = Math.hypot(p.x, p.z) / R;
    return [t, Math.min(Math.max(1 - rn, 0), 1)];
  }
  vert(p, n, u, v, kind, wind, hd) {
    const [h, d] = hd || this.crownInfo(p);
    this.f.push(p.x, p.y, p.z, u, n.x, n.y, n.z, v, h, d, wind, kind, 1, 0, 0.5, 0);
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
  const nCards = Math.floor((b.max - used) / 6);
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
  // two tiers of arching fronds with clear gaps between them: the star silhouette that makes a palm read as a palm
  const nf = 15;
  for (let i = 0; i < nf; i++) {
    const tier = i % 3;                                            // 0: young, rising; 1-2: mature, arching out and down
    const a = (i / nf) * Math.PI * 2 + (r() - 0.5) * 0.25;
    const up0 = tier === 0 ? 1.1 + (r() - 0.5) * 0.3 : 0.35 + (r() - 0.5) * 0.3;
    const L = sp.rad * (tier === 0 ? 0.75 : 1.0 + 0.2 * r());
    let p = crown.clone();
    const dir = v3(Math.cos(a), up0, Math.sin(a)).normalize();
    for (let s = 0; s < 4; s++) {
      const seg = dir.clone().multiplyScalar(L / 4);
      const q = p.clone().add(seg);
      dir.y -= tier === 0 ? 0.3 : 0.5; dir.normalize();
      const sub = [s / 4, 0.05, (s + 1) / 4, 0.95];
      const w = L * 0.36 * (1 - 0.2 * s);
      b.strip(p, q, w, 0.4, sp.tile, sub, shade, leafWind);
      b.strip(p, q, w, -0.4, sp.tile, sub, shade, leafWind);
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


// ---- skeletal broadleaf / pine (space colonisation) ----------------------------------------------------------------
function buildSkeletal(b, sp, r, o) {
  const { nodes, tips } = growSkeleton(sp, r, o);
  const P = (i) => v3(nodes[i].x, nodes[i].y, nodes[i].z);
  const wind = (p) => Math.pow(Math.max(p.y, 0), 2) * 0.6;
  const barkMax = Math.floor(b.max * (o.bark ?? 0.36));
  const rMin = o.rMin ?? 0.0028;
  // limbs, thickest first, until the bark budget is used; thin twigs live in the leaf-card texture
  for (const ch of chains(nodes)) {
    if (nodes[ch.idx[Math.min(1, ch.idx.length - 1)]].r < rMin) continue;
    // resample the chain: segment length grows with thinness (few rings on twigs), stop below rMin
    const pts = [], rs = [];
    let acc = 1e9;
    const segL = ch.order === 0 ? 0.07 : 0.055;
    for (let k = 0; k < ch.idx.length; k++) {
      const n = nodes[ch.idx[k]];
      if (k > 0 && n.r < rMin * 0.7) break;
      const p = P(ch.idx[k]);
      if (k > 0) acc += p.distanceTo(P(ch.idx[k - 1]));
      const last = k === ch.idx.length - 1 || nodes[ch.idx[k + 1]].r < rMin * 0.7;
      if (k === 0 || acc >= segL || last) { pts.push(p); rs.push(Math.max(n.r, rMin * 0.5)); acc = 0; }
    }
    if (pts.length < 2) continue;
    const S = rs[0] > 0.014 ? 7 : rs[0] > 0.006 ? 5 : 3;
    if (b.n + (pts.length - 1) * S * 6 > barkMax) continue;
    b.tube(pts, rs, S, wind);
  }
  // leaf cluster cards at the twig tips (and along the thinnest twigs when there are more cards than tips)
  const env = (p) => crownNormal(sp, p, o.upBias ?? 0.3);
  const leafWind = (p) => Math.pow(Math.max(p.y, 0), 1.5) * 0.8 + 0.2;
  const nCards = Math.floor((b.max - b.n) / 6);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const cand = shuffle(tips.slice());
  {      // more cards than tips: along the thin twigs too (repeatedly if need be)
    const extra = [];
    nodes.forEach((n, i) => { if (n.kids.length && n.r < rMin * 1.8 && n.y > sp.base * 0.9) extra.push(i); });
    shuffle(extra);
    for (let k = 0; k < extra.length; k++) cand.push(extra[k]);
    // still short (sparse skeletons such as pine): repeat tips with an offset (-1 - index marks a repeat)
    for (let k = 0; k < tips.length * 3; k++) cand.push(-1 - tips[k % tips.length]);
  }
  const UP = v3(0, 1, 0);
  // keep card centres apart (stacked cards make black knots in the crown and waste the budget)
  const placed = [];
  const minD2 = (o.card * (o.space ?? 0.42)) ** 2;
  let made = 0;
  for (let c = 0; c < cand.length && made < nCards; c++) {
    const rep = cand[c] < 0, i = rep ? -1 - cand[c] : cand[c], n = nodes[i];
    const p = P(i), q = n.parent >= 0 ? P(n.parent) : p.clone().sub(UP);
    if (rep) p.add(v3(r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5).multiplyScalar(o.card * 0.9));
    if (placed.some((z) => z.distanceToSquared(p) < minD2)) continue;
    placed.push(p.clone()); made++;
    const twig = p.clone().sub(q).normalize();
    const out = v3(p.x, 0, p.z); if (out.lengthSq() < 1e-6) out.set(1, 0, 0); out.normalize();
    // cards hang off the twig: the cluster grows along the twig, lifted toward the light; it faces outward
    const up = twig.clone().multiplyScalar(0.65).addScaledVector(UP, o.lift ?? 0.55).add(v3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.5)).normalize();
    const tTop = (p.y - sp.base) / (1 - sp.base);
    let nrm = out.clone().lerp(UP, Math.max(0, tTop - 0.55) * 1.2).add(v3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.9));
    nrm.addScaledVector(up, -nrm.dot(up));
    if (nrm.lengthSq() < 1e-4) nrm = new THREE.Vector3().crossVectors(up, v3(1, 0, 0));
    nrm.normalize();
    const s = o.card * (0.75 + 0.5 * r());
    const cc = p.clone().addScaledVector(up, s * 0.38);
    const nc = nrm.clone().multiplyScalar(nrm.dot(out) < 0 ? -0.35 : 0.35);
    b.card(cc, nrm, up, s * (o.aspect ?? 1), s, sp.tile, null, (pp) => env(pp).add(nc).normalize(), leafWind);
  }
}

// ---- spruce / fir: whorls of drooping, curved boughs with gaps; dead twigs below the crown ---------------------------
function buildConifer(b, sp, r, o) {
  const H0 = sp.base;
  const wind = (p) => Math.pow(Math.max(p.y, 0), 2) * 0.5;
  const tp = [], tr = [];
  for (let i = 0; i <= 5; i++) { const t = i / 5; tp.push(v3((r() - 0.5) * 0.004, t * 0.97, (r() - 0.5) * 0.004)); tr.push(o.trunkR * Math.pow(1 - 0.92 * t, 1.1) * (i === 0 ? 1.35 : 1)); }
  b.tube(tp, tr, 7, wind);
  // dead lower branches: thin bare stubs up the bole
  for (let i = 0; i < (o.dead ?? 10); i++) {
    const y = H0 * (0.25 + 0.75 * r()), a = r() * 6.283, L = 0.03 + 0.05 * r();
    b.tube([v3(0, y, 0), v3(Math.cos(a) * L, y - 0.01 - 0.02 * r(), Math.sin(a) * L)], [o.trunkR * 0.18, o.trunkR * 0.05], 3, wind);
  }
  const shade = (p) => crownNormal(sp, p, 0.5);
  const leafWind = (p) => Math.pow(Math.max(p.y, 0), 1.5) * 0.7 + 0.15;
  const nw = o.whorls, per = o.per;
  const budget = b.max - 12;
  const T = 12;                                        // conifer shoot-spray tile
  for (let w = 0; w < nw; w++) {
    const t = Math.pow((w + 0.3 * r()) / nw, 0.92);
    const y = H0 + (1 - H0) * t;
    const R = crownRadius(sp, t) * (0.95 + 0.15 * r()) + 0.012;
    const droop = o.droop + 0.3 * (1 - t) * (o.droopLow ?? 0.6);
    const nb = per - (t > 0.8 ? 2 : 0);
    for (let i = 0; i < nb; i++) {
      if (r() < (o.gap ?? 0.12) && t < 0.85) continue;                     // a missing bough: sky through the crown
      const a = (i / nb) * Math.PI * 2 + w * 2.4 + (r() - 0.5) * 0.7;
      const L = R * (0.75 + 0.35 * r());
      const ca = Math.cos(a), sa = Math.sin(a);
      // the bough rises a little, then its outer half droops (the spruce "skirt"); shoot sprays overlap along it
      const at = (u) => v3(ca * L * u, Math.max(y + L * 0.12 * u - Math.sin(droop) * L * 0.95 * u * u, 0.02), sa * L * u);
      const nc = L > 0.11 ? 3 : 2;
      for (let k = 0; k < nc; k++) {
        if (b.n + 6 > budget) break;
        const u0 = 0.04 + 0.92 * k / nc, u1 = Math.min(1, u0 + 1.45 / nc);
        const p0 = at(u0), p1 = at(u1);
        const up = p1.clone().sub(p0); const len = up.length() * 1.1; up.normalize();
        // spray plane: mostly horizontal (sprays spread flat), rolled so the side view still catches it
        const side = new THREE.Vector3().crossVectors(up, v3(0, 1, 0)).normalize();
        const flat = new THREE.Vector3().crossVectors(side, up).normalize();     // ~ up-facing normal
        const roll = (r() - 0.5) * 1.6 + (k & 1 ? 0.35 : -0.35);
        const nrm = flat.multiplyScalar(Math.cos(roll)).addScaledVector(side, Math.sin(roll)).normalize();
        const c = p0.clone().lerp(p1, 0.5);
        b.card(c, nrm, up, len * (0.85 + 0.3 * r()) * (1 + 0.5 * t), len * (1 + 0.25 * t), T, null, shade, leafWind);
      }
    }
  }
  // leader: a vertical shoot spray, and a crossed one
  for (let i = 0; i < 2; i++) {
    const a = i * Math.PI / 2 + 0.3;
    b.card(v3(0, 0.955, 0), v3(Math.cos(a), 0, Math.sin(a)), v3(0, 1, 0), 0.05, 0.09, T, null, shade, leafWind);
  }
}

// per-tree light bake: leaf-area grid from the cards, visibility of every card (centre) and bark quad
function bakeTreeLight(b, fill) {
  const F = b.f, n = b.n - (b.n % 6), STR = 16;
  let x0 = 1e9, y0 = 0, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (let v = 0; v < n; v++) { const k = v * STR; x0 = Math.min(x0, F[k]); x1 = Math.max(x1, F[k]); y1 = Math.max(y1, F[k + 1]); z0 = Math.min(z0, F[k + 2]); z1 = Math.max(z1, F[k + 2]); }
  const pad = 0.02;
  const bounds = [x0 - pad, y0 - pad, z0 - pad, x1 + pad, y1 + pad, z1 + pad];
  const cards = [];
  const tri = (k0, k1, k2) => {
    const ax = F[k1] - F[k0], ay = F[k1 + 1] - F[k0 + 1], az = F[k1 + 2] - F[k0 + 2];
    const bx = F[k2] - F[k0], by = F[k2 + 1] - F[k0 + 1], bz = F[k2 + 2] - F[k0 + 2];
    return 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
  };
  for (let v = 0; v < n; v += 6) {
    const k = v * STR;
    if (F[k + 11] < 0.5) continue;
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < 6; j++) { cx += F[k + j * STR]; cy += F[k + j * STR + 1]; cz += F[k + j * STR + 2]; }
    cards.push({ c: [cx / 6, cy / 6, cz / 6], area: tri(k, k + STR, k + 2 * STR) + tri(k + 3 * STR, k + 4 * STR, k + 5 * STR) });
  }
  const g = leafGrid(cards, bounds, 22);
  for (let v = 0; v < n; v += 6) {
    const k = v * STR;
    const leaf = F[k + 11] >= 0.5;
    if (leaf) {
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < 6; j++) { cx += F[k + j * STR]; cy += F[k + j * STR + 1]; cz += F[k + j * STR + 2]; }
      const sh = bakeVisibility(g, [cx / 6, cy / 6, cz / 6], null, fill, 0.8);
      for (let j = 0; j < 6; j++) for (let c = 0; c < 4; c++) F[k + j * STR + 12 + c] = sh[c];
    } else {
      for (let j = 0; j < 6; j++) {
        const q = k + j * STR;
        const p = [F[q] + F[q + 4] * 0.01, F[q + 1] + F[q + 5] * 0.01, F[q + 2] + F[q + 6] * 0.01];
        const sh = bakeVisibility(g, p, null, fill, 0.3); for (let c = 0; c < 4; c++) F[q + 12 + c] = sh[c];
      }
    }
  }
}

// skeletal species (space colonisation): see growSkeleton for the parameters; card = leaf-cluster card size,
// bark = share of the vertex budget for limbs
const SKEL = {
  oak:    { attract: 1400, shell: 0.5,  seg: 0.022, infl: 0.18, kill: 0.04,  trunkUp: 0.15, trop: -0.06, trunkR: 0.030, card: 0.11, holes: 4, lift: 0.45, lean: 0.04 },
  beech:  { attract: 1400, shell: 0.45, seg: 0.022, infl: 0.17, kill: 0.04,  trunkUp: 0.30, trop: 0.08,  trunkR: 0.024, card: 0.105, holes: 3 },
  birch:  { attract: 1700, shell: 0.5,  seg: 0.018, infl: 0.14, kill: 0.03, space: 0.35, trunkUp: 0.70, trop: -0.12, trunkR: 0.016, card: 0.08, holes: 3, lift: 0.2, aspect: 0.8 },
  poplar: { attract: 1000, shell: 0.55, seg: 0.02,  infl: 0.14, kill: 0.036, trunkUp: 0.75, trop: 0.55,  trunkR: 0.018, card: 0.07, holes: 2, lift: 0.8, upBias: 0.15 },
  pine:   { attract: 900,  shell: 0.6,  seg: 0.026, infl: 0.2,  kill: 0.045, trunkUp: 0.60, trop: 0.10,  trunkR: 0.020, card: 0.13, space: 0.3, holes: 4, lift: 0.9, upBias: 0.45, bark: 0.30 },
  bush:   { attract: 900,  shell: 0.55, seg: 0.035, infl: 0.22, kill: 0.06,  trunkUp: 0.0,  trop: 0.15,  trunkR: 0.035, card: 0.26, holes: 2, lift: 0.5, bark: 0.22, rMin: 0.006, space: 0.38, yLo: 0.0 },
  scrub:  { attract: 900,  shell: 0.55, seg: 0.035, infl: 0.22, kill: 0.06,  trunkUp: 0.05, trop: 0.05,  trunkR: 0.04,  card: 0.24, holes: 3, lift: 0.4, bark: 0.25, rMin: 0.006, space: 0.38, yLo: 0.0 },
  tropic: { attract: 1400, shell: 0.45, seg: 0.024, infl: 0.19, kill: 0.045, trunkUp: 0.25, trop: -0.02, trunkR: 0.028, card: 0.13, holes: 3, lift: 0.6, upBias: 0.5, tPow: 0.6 },
};
const CONIF = {
  spruce: { trunkR: 0.017, whorls: 20, per: 8, droop: 0.45, droopLow: 0.8, gap: 0.10 },
  fir:    { trunkR: 0.017, whorls: 20, per: 8, droop: 0.22, droopLow: 0.5, gap: 0.08 },
};
export const treeGen = { classic: false };

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
  const rows = Math.ceil(SPECIES.length * VMAX * VTEXELS / VTEX_W);
  const data = new Float32Array(VTEX_W * rows * 4);
  const info = [];
  SPECIES.forEach((sp, si) => {
    const r = rng32(9001 + si * 7919);
    const b = new Builder(sp);
    const o = OPTS[sp.id];
    if (treeGen.classic) {
      b.max = 1152;
      if (o.kind === 'cone') buildCone(b, sp, r, o);
      else if (o.kind === 'palm') buildPalm(b, sp, r);
      else if (o.kind === 'dome') buildDome(b, sp, r, o);
      else buildBroadleaf(b, sp, r, o);
    } else {
      if (CONIF[sp.id]) buildConifer(b, sp, r, CONIF[sp.id]);
      else if (SKEL[sp.id]) buildSkeletal(b, sp, r, SKEL[sp.id]);
      else if (o.kind === 'palm') buildPalm(b, sp, r);
      else buildDome(b, sp, r, { ...o, maxV: Math.round(o.maxV * 1.6) });
      bakeTreeLight(b, sp.group === 'conifer' ? 0.7 : 0.5);
    }
    let n = Math.min(b.n, VMAX);
    n -= n % 3;
    let ymin = Infinity, ymax = -Infinity, rmax = 0;
    const STR = 16;
    let ytop = 0;
    for (let v = 0; v < n; v++) ytop = Math.max(ytop, b.f[v * STR + 1]);
    const ys = treeGen.classic ? 1 : 1 / ytop;          // the tree's top at exactly its placement height
    for (let v = 0; v < n; v++) {
      const f = b.f.slice(v * STR, v * STR + STR);
    f[0] *= ys; f[1] *= ys; f[2] *= ys;
      data.set(f, (si * VMAX + v) * VTEXELS * 4);
      ymin = Math.min(ymin, f[1]); ymax = Math.max(ymax, f[1]);
      rmax = Math.max(rmax, Math.hypot(f[0], f[2]));
    }
    // unused vertices: degenerate (all zero = collapsed at the base)
    const cy = (ymin + ymax) / 2;
    let R = 0;
    for (let v = 0; v < n; v++) { const k = v * STR; R = Math.max(R, Math.hypot(b.f[k] * ys, b.f[k + 1] * ys - cy, b.f[k + 2] * ys)); }
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
  int i = (s * ${VMAX} + v) * ${VTEXELS};
  t0 = texelFetch(tVegVerts, ivec2(i % ${VTEX_W}, i / ${VTEX_W}), 0); i++;
  t1 = texelFetch(tVegVerts, ivec2(i % ${VTEX_W}, i / ${VTEX_W}), 0); i++;
  t2 = texelFetch(tVegVerts, ivec2(i % ${VTEX_W}, i / ${VTEX_W}), 0);
}
vec4 vegFetchVis(int s, int v) {
  int i = (s * ${VMAX} + v) * ${VTEXELS} + 3;
  return texelFetch(tVegVerts, ivec2(i % ${VTEX_W}, i / ${VTEX_W}), 0);
}
`;
