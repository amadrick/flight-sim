// Procedural foliage atlas (boot time, pure JS rasteriser - no canvas, no images).
// 1024 x 1024 RGBA8, 4 x 4 tiles of 256 px. Channels (linear data, not colour):
//   R = leaf brightness variation (0..1, 0.5 = species mean)   G = autumn / dry tint amount (0..1)
//   B = cluster depth (1 = outer leaves, 0 = twig / inner)      A = coverage (alpha-tested at 0.5)
// Tiles: 0 oak cluster, 1 beech / poplar cluster, 2 birch, 3 spruce / fir bough, 4 pine tufts, 5 palm frond (u along
// the frond, v across), 6 tropical large leaves, 7 shrub, 8 desert shrub, 9 grass tuft, 10 reeds, 11 bark (tiling),
// 12 conifer shoot spray (second generation only).
import * as THREE from 'three';
import { rng32 } from './species.js';

export const ATLAS_SIZE = 1024, TILE = 256, TILES = 4;

export function tileRect(t) { return [(t % TILES) / TILES, Math.floor(t / TILES) / TILES, 1 / TILES]; }

function makeCanvas() {
  const N = ATLAS_SIZE;
  return { R: new Float32Array(N * N).fill(0.5), G: new Float32Array(N * N), B: new Float32Array(N * N), A: new Float32Array(N * N) };
}

// Stamp a leaf-like shape. (cx, cy) base of the leaf in tile pixels, ang direction, len / wid in px.
// prof(u) -> half width fraction (0..1) along the leaf; bright = brightness; tint = dry tint; depth = cluster depth.
function stamp(C, tile, cx, cy, ang, len, wid, prof, bright, tint, depth, midrib = 0.25) {
  const N = ATLAS_SIZE, ox = (tile % TILES) * TILE, oy = Math.floor(tile / TILES) * TILE;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const ex = Math.abs(ca) * len * 0.5 + Math.abs(sa) * wid + 2, ey = Math.abs(sa) * len * 0.5 + Math.abs(ca) * wid + 2;
  const PL = new Float32Array(33);
  for (let i = 0; i <= 32; i++) PL[i] = prof(i / 32);
  const mx = cx + ca * len * 0.5, my = cy + sa * len * 0.5;
  const x0 = Math.max(0, Math.floor(mx - ex)), x1 = Math.min(TILE - 1, Math.ceil(mx + ex));
  const y0 = Math.max(0, Math.floor(my - ey)), y1 = Math.min(TILE - 1, Math.ceil(my + ey));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const u = (dx * ca + dy * sa) / len, v = (-dx * sa + dy * ca);
    if (u < 0 || u > 1) continue;
    const fi = u * 32, i0 = fi | 0, hw = wid * (i0 >= 32 ? PL[32] : PL[i0] + (PL[i0 + 1] - PL[i0]) * (fi - i0));
    const e = hw - Math.abs(v);                       // px inside the edge
    if (e <= -0.5) continue;
    const a = Math.min(1, e + 0.5);
    const k = (oy + y) * N + ox + x;
    const rib = midrib > 0 ? 1 - midrib * Math.max(0, 1 - Math.abs(v) / 0.9) : 1;
    const vb = bright * rib * (0.9 + 0.2 * u) * (1 - 0.18 * Math.abs(v) / Math.max(hw, 0.5));
    C.R[k] = C.R[k] * (1 - a) + vb * a;
    C.G[k] = C.G[k] * (1 - a) + tint * a;
    C.B[k] = C.B[k] * (1 - a) + depth * a;
    C.A[k] = Math.max(C.A[k], a);
  }
}
const pointed = (u) => Math.pow(Math.sin(Math.PI * Math.min(u * 1.08, 1)), 0.75);
const oval = (u) => Math.sqrt(Math.max(0, Math.sin(Math.PI * u)));
const lobed = (u) => pointed(u) * (0.72 + 0.28 * Math.cos(u * 6 * Math.PI * 2 - 0.6));
const needle = (u) => 0.5 + 0.5 * (1 - u);
const blade = (u) => Math.pow(1 - u, 0.6);
const twig = () => 1;

function line(C, tile, x0, y0, x1, y1, w, bright, depth) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  stamp(C, tile, x0, y0, Math.atan2(y1 - y0, x1 - x0), Math.max(len, 1), w, twig, bright, 0, depth, 0);
}

// a broadleaf cluster: twigs radiating from the bottom centre, leaves along them
function cluster(C, tile, r, { n, len, wid, prof, spread = 1.0, bright = 0.5, var: vr = 0.35 }) {
  const cx = 128, cy = 236;
  const nb = 7;
  for (let b = 0; b < nb; b++) {
    const ang = -Math.PI / 2 + (b / (nb - 1) - 0.5) * 2.3 * spread + (r() - 0.5) * 0.3;
    const L = 150 + 70 * r();
    const ex = cx + Math.cos(ang) * L, ey = cy + Math.sin(ang) * L;
    line(C, tile, cx, cy, ex, ey, 1.6, 0.18, 0.1);
    const per = Math.round(n / nb);
    for (let i = 0; i < per; i++) {
      const t = 0.25 + 0.75 * (i / per) + 0.05 * r();
      const off = (r() - 0.5) * 50 * t;
      const px = cx + (ex - cx) * t - Math.sin(ang) * off, py = cy + (ey - cy) * t + Math.cos(ang) * off;
      const side = i & 1 ? 1 : -1;
      const la = ang + side * (0.6 + 0.5 * r());
      const s = 0.75 + 0.5 * r();
      const depth = 0.35 + 0.65 * t;
      stamp(C, tile, px, py, la, len * s, wid * s, prof, bright + vr * (r() - 0.5) + 0.12 * t, r() < 0.08 ? 0.6 + 0.4 * r() : 0.1 * r(), depth);
    }
  }
}

// ---- second-generation tiles (trees.js default; vegGen=classic keeps the originals) ------------------------------
function clearTile(C, tile) {
  const N = ATLAS_SIZE, ox = (tile % TILES) * TILE, oy = Math.floor(tile / TILES) * TILE;
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) { const k = (oy + y) * N + ox + x; C.R[k] = 0.5; C.G[k] = 0; C.B[k] = 0; C.A[k] = 0; }
}
// polyline of a curving twig: start, direction angle, length, curvature; returns points
function twigPath(x, y, ang, len, curve, n = 10) {
  const pts = [[x, y]];
  for (let i = 1; i <= n; i++) { ang += curve / n; x += Math.cos(ang) * len / n; y += Math.sin(ang) * len / n; pts.push([x, y]); }
  return pts;
}
function drawPath(C, tile, pts, w0, w1, bright, depth) {
  for (let i = 0; i < pts.length - 1; i++) {
    const t = i / (pts.length - 1);
    line(C, tile, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w0 + (w1 - w0) * t, bright, depth);
  }
}
// a leafy spray seen from outside the crown: a curving main twig with alternate side twigs (and their side twigs),
// leaves alternate along every twig, inner leaves first so the outer ones overlap them. R carries the per-leaf
// brightness (tilt toward / away from the light), B the depth in the spray (1 = outer leaves).
function spray(C, tile, r, { len, wid, prof, leafEvery = 9, bright = 0.5, var: vr = 0.4, side = 7, spread = 0.95, mainLen = 215, sub = true }) {
  const leaves = [];
  const twigs = [];
  const main = twigPath(128 + (r() - 0.5) * 10, 252, -Math.PI / 2 + (r() - 0.5) * 0.3, mainLen, (r() - 0.5) * 0.6);
  twigs.push({ pts: main, w: 2.4, lvl: 0 });
  for (let k = 0; k < side; k++) {
    const t = 0.18 + 0.8 * (k / side) + 0.04 * (r() - 0.5);
    const pi = Math.min(main.length - 2, Math.floor(t * (main.length - 1)));
    const [px, py] = main[pi], [qx, qy] = main[pi + 1];
    const ma = Math.atan2(qy - py, qx - px), sgn = k & 1 ? 1 : -1;
    const a = ma + sgn * (0.55 + 0.35 * r()) * spread * 1.4;
    const L = mainLen * (0.62 - 0.42 * t) * (0.8 + 0.4 * r());
    const pts = twigPath(px, py, a, L, -sgn * (0.3 + 0.4 * r()), 8);
    twigs.push({ pts, w: 1.6, lvl: 1 });
    if (sub && L > 60) for (let j = 0; j < 2; j++) {
      const tt = 0.35 + 0.35 * j, qi = Math.floor(tt * (pts.length - 1));
      const [sx, sy] = pts[qi], [ux, uy] = pts[qi + 1];
      const sa = Math.atan2(uy - sy, ux - sx) + (j ? 1 : -1) * (0.6 + 0.3 * r());
      twigs.push({ pts: twigPath(sx, sy, sa, L * 0.45, (r() - 0.5) * 0.5, 5), w: 1.1, lvl: 2 });
    }
  }
  for (const tw of twigs) {
    drawPath(C, tile, tw.pts, tw.w, tw.w * 0.45, 0.16, 0.1);
    // leaves along the twig (and one at its tip)
    let acc = 0, alt = 1;
    for (let i = 1; i < tw.pts.length; i++) {
      const [x0, y0] = tw.pts[i - 1], [x1, y1] = tw.pts[i];
      const seg = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0);
      acc += seg;
      const t = i / (tw.pts.length - 1);
      if (tw.lvl === 0 && t < 0.2) continue;
      while (acc > leafEvery) {
        acc -= leafEvery; alt = -alt;
        const s = (0.7 + 0.5 * r()) * (0.75 + 0.35 * t);
        leaves.push({ x: x1, y: y1, a: a + alt * (0.7 + 0.5 * r()), s, d: 0.35 + 0.65 * t * (tw.lvl ? 0.8 + 0.2 * tw.lvl : 1) });
      }
    }
    const [ex, ey] = tw.pts[tw.pts.length - 1], [fx, fy] = tw.pts[tw.pts.length - 2];
    leaves.push({ x: ex, y: ey, a: Math.atan2(ey - fy, ex - fx) + (r() - 0.5) * 0.4, s: 1.0, d: 1 });
  }
  leaves.sort((p, q) => p.d - q.d);
  for (const l of leaves) {
    const tilt = (r() - 0.5) * 2;                                         // leaf facing the light or turned away
    stamp(C, tile, l.x, l.y, l.a, len * l.s, wid * l.s, prof, bright + vr * 0.5 * tilt + 0.12 * (l.d - 0.6), r() < 0.06 ? 0.55 + 0.4 * r() : 0.08 * r(), l.d);
  }
}
// conifer shoot spray (spruce / fir) for the bough cards: a main axis with alternate side shoots, every axis densely
// clad in short needles angled forward; the outline is the ovate shape of a real spray
function coniferSpray(C, tile, r, { needle: nl = 9, dense = 2.2, fir = 0 }) {
  const shoots = [];
  const main = twigPath(128, 254, -Math.PI / 2 + (r() - 0.5) * 0.15, 238, (r() - 0.5) * 0.3, 14);
  shoots.push({ pts: main, w: 2.2, d0: 0.4 });
  for (let k = 0; k < 15; k++) {
    const t = 0.06 + 0.9 * k / 15;
    const pi = Math.min(main.length - 2, Math.floor(t * (main.length - 1)));
    const [px, py] = main[pi], [qx, qy] = main[pi + 1], ma = Math.atan2(qy - py, qx - px), sgn = k & 1 ? 1 : -1;
    const L = 108 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)), 0.8) * (0.85 + 0.3 * r());
    const pts = twigPath(px, py, ma + sgn * (0.85 + 0.2 * r()), L, -sgn * 0.35, 6);
    shoots.push({ pts, w: 1.3, d0: 0.5 });
    if (L > 45) for (const tt of [0.45, 0.7]) {
      const qi = Math.floor(tt * (pts.length - 1)), [sx, sy] = pts[qi], [ux, uy] = pts[qi + 1];
      for (const s2 of [-1, 1]) shoots.push({ pts: twigPath(sx, sy, Math.atan2(uy - sy, ux - sx) + s2 * 0.8, L * 0.32, 0, 3), w: 0.9, d0: 0.7 });
    }
  }
  for (const sh of shoots) drawPath(C, tile, sh.pts, sh.w, sh.w * 0.5, 0.15, 0.1);
  for (const sh of shoots) {
    const P = sh.pts;
    let total = 0; for (let i = 1; i < P.length; i++) total += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    let run = 0;
    for (let i = 1; i < P.length; i++) {
      const [x0, y0] = P[i - 1], [x1, y1] = P[i], seg = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0);
      for (let s = 0; s < seg; s += dense) {
        const f = s / seg, x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f, u = (run + s) / total;
        const tip = u > 0.8 ? (u - 0.8) * 5 : 0;                       // this year's shoot: lighter, yellower
        for (const sg of [-1, 1]) {
          const na = a + sg * (fir ? 1.25 : 0.75 + 0.35 * r());
          stamp(C, tile, x, y, na, nl * (0.75 + 0.5 * r()) * (1 - 0.3 * tip), 1.15, needle, 0.32 + 0.3 * r() + 0.28 * tip, 0.15 * tip, sh.d0 + (1 - sh.d0) * u, 0);
        }
        if (!fir && r() < 0.5) stamp(C, tile, x, y, a + (r() - 0.5) * 0.6, nl * 0.7, 1.1, needle, 0.3 + 0.3 * r(), 0, sh.d0 + (1 - sh.d0) * u, 0);
      }
      run += seg;
    }
  }
}
// bark: furrowed ridges (anisotropic value noise, several octaves), plates and fine grain; tiles in u and v
function barkTile(C, tile, r) {
  const N = ATLAS_SIZE, ox = (tile % TILES) * TILE, oy = Math.floor(tile / TILES) * TILE;
  const G = 64, lat = Float32Array.from({ length: G * G }, () => r());
  const vn = (x, y) => {     // periodic value noise on a G x G lattice
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const L = (i, j) => lat[(((j % G) + G) % G) * G + (((i % G) + G) % G)];
    return (L(xi, yi) * (1 - sx) + L(xi + 1, yi) * sx) * (1 - sy) + (L(xi, yi + 1) * (1 - sx) + L(xi + 1, yi + 1) * sx) * sy;
  };
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const u = x / TILE, v = y / TILE;
    // ridges: noise stretched along the stem, warped
    const w = vn(u * 8, v * 2) * 0.6;
    const ridge = 1 - Math.abs(2 * vn(u * 14 + w, v * 2.5) - 1);
    const plates = vn(u * 28 + w * 2, v * 8);
    const grain = vn(u * 64, v * 64);
    const f = 0.30 + 0.55 * Math.pow(ridge, 1.6) * (0.7 + 0.3 * plates) + 0.12 * (grain - 0.5);
    const k = (oy + y) * N + ox + x;
    C.R[k] = Math.min(Math.max(f, 0), 1); C.G[k] = 0.15 * plates; C.B[k] = 1; C.A[k] = 1;
  }
}

export function createFoliageAtlas({ classic = false } = {}) {
  const C = makeCanvas();
  const r = rng32(1234567);
  cluster(C, 0, r, { n: 300, len: 19, wid: 6, prof: lobed });
  cluster(C, 1, r, { n: 300, len: 17, wid: 7, prof: oval });
  cluster(C, 2, r, { n: 260, len: 12, wid: 5.5, prof: pointed, spread: 1.15, bright: 0.58, var: 0.45 });
  // spruce / fir bough: a drooping main twig with side twiglets, densely clad in short needles
  {
    const t = 3;
    for (let k = 0; k < 2; k++) {
      const y0 = 70 + k * 100;
      const pts = [];
      for (let i = 0; i <= 20; i++) { const u = i / 20; pts.push([8 + u * 240, y0 + 40 * u * u + (k ? 10 : 0)]); }
      for (let i = 0; i < 20; i++) line(C, t, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 1.8, 0.15, 0.1);
      for (let i = 1; i < 20; i++) for (const side of [-1, 1]) {
        const [px, py] = pts[i];
        const u = i / 20;
        const L = (55 - 30 * u) * (0.8 + 0.4 * r());
        const a = (side < 0 ? -1.0 : 0.9) + 0.25 * (r() - 0.5) + 0.35 * u;
        const ex = px + Math.cos(a) * L, ey = py + Math.sin(a) * L;
        line(C, t, px, py, ex, ey, 1.0, 0.2, 0.3);
        for (let j = 0; j < 16; j++) {
          const tt = j / 16, qx = px + (ex - px) * tt, qy = py + (ey - py) * tt;
          for (const s2 of [-1, 1]) stamp(C, t, qx, qy, a + s2 * (0.9 + 0.3 * r()), 7 + 4 * r(), 1.0, needle, 0.42 + 0.3 * r() + 0.15 * tt, 0.04 * r(), 0.4 + 0.6 * tt, 0);
        }
      }
    }
  }
  // pine: twigs ending in dense tufts of long needles
  {
    const t = 4;
    for (let k = 0; k < 9; k++) {
      const bx = 30 + r() * 196, by = 60 + r() * 170;
      const a0 = -Math.PI / 2 + (r() - 0.5) * 1.6;
      const tx = bx + Math.cos(a0) * 40, ty = by + Math.sin(a0) * 40;
      line(C, t, bx, by, tx, ty, 2.0, 0.2, 0.2);
      for (let j = 0; j < 46; j++) {
        const a = a0 + (r() - 0.5) * 3.4;
        stamp(C, t, tx, ty, a, 26 + 18 * r(), 1.1, needle, 0.45 + 0.35 * r(), 0.05 * r(), 0.6 + 0.4 * r(), 0);
      }
    }
  }
  // palm frond: midrib along u, leaflets angled out on both sides, drooping tips
  {
    const t = 5;
    line(C, t, 4, 128, 252, 128, 2.2, 0.35, 0.3);
    for (let i = 0; i < 60; i++) {
      const u = i / 60, x = 10 + u * 236;
      const L = 110 * Math.sin(Math.PI * (0.12 + 0.88 * u)) * (0.85 + 0.3 * r()) * (1 - 0.35 * u);
      for (const s of [-1, 1]) stamp(C, t, x, 128, s * (1.05 - 0.35 * u) + 0.12 * (r() - 0.5), Math.max(L, 8), 3.2, pointed, 0.45 + 0.3 * r(), r() < 0.07 ? 0.8 : 0.08 * r(), 0.5 + 0.5 * u, 0.15);
    }
  }
  cluster(C, 6, r, { n: 110, len: 40, wid: 15, prof: oval, spread: 1.1, bright: 0.48 });
  cluster(C, 7, r, { n: 220, len: 14, wid: 6, prof: oval, spread: 1.25, bright: 0.5, var: 0.4 });
  // desert shrub: wiry grey twigs, sparse tiny leaves
  {
    const t = 8;
    for (let b = 0; b < 16; b++) {
      let x = 128 + (r() - 0.5) * 40, y = 250, a = -Math.PI / 2 + (r() - 0.5) * 2.0;
      for (let s = 0; s < 8; s++) {
        const L = 22 + 10 * r();
        const nx = x + Math.cos(a) * L, ny = y + Math.sin(a) * L;
        line(C, t, x, y, nx, ny, 1.4, 0.35, 0.2);
        for (let j = 0; j < 5; j++) stamp(C, t, nx + (r() - 0.5) * 10, ny + (r() - 0.5) * 10, r() * 6.28, 6 + 4 * r(), 2.6, oval, 0.5 + 0.3 * r(), 0.25 + 0.3 * r(), 0.8, 0);
        x = nx; y = ny; a += (r() - 0.5) * 0.9;
      }
    }
  }
  // grass tuft: blades from the bottom (u = up)
  for (let i = 0; i < 70; i++) {
    const x = 20 + r() * 216, a = -Math.PI / 2 + (r() - 0.5) * 0.7, L = 150 + 100 * r();
    stamp(C, 9, x, 255, a, L, 3.0 + 2 * r(), blade, 0.35 + 0.45 * r(), r() < 0.25 ? 0.5 + 0.5 * r() : 0.1 * r(), 0.3 + 0.7 * r(), 0.1);
  }
  for (let i = 0; i < 40; i++) {
    const x = 20 + r() * 216, a = -Math.PI / 2 + (r() - 0.5) * 0.3, L = 200 + 55 * r();
    stamp(C, 10, x, 255, a, L, 3.5 + 2 * r(), blade, 0.35 + 0.4 * r(), 0.25 + 0.5 * r(), 0.5 + 0.5 * r(), 0.1);
  }
  // bark tile: vertical fissures (R = brightness), fully opaque
  {
    const t = 11, N = ATLAS_SIZE, ox = (t % TILES) * TILE, oy = Math.floor(t / TILES) * TILE;
    const ph = Array.from({ length: 24 }, () => r() * 6.28);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const u = x / TILE * Math.PI * 2;
      let f = 0;
      for (let k = 0; k < 6; k++) f += Math.sin(u * (k + 3) + ph[k] + 0.6 * Math.sin(y / TILE * Math.PI * 2 * (1 + (k % 3)) + ph[k + 6])) / (k + 1);
      const k2 = (oy + y) * N + ox + x;
      C.R[k2] = 0.5 + 0.28 * Math.tanh(f * 1.4); C.G[k2] = 0; C.B[k2] = 1; C.A[k2] = 1;
    }
  }
  if (!classic) {
    // own random streams (the grass tiles above keep their content)
    const r2 = rng32(424242);
    for (const t of [0, 1, 2, 6, 7, 11, 12]) clearTile(C, t);
    spray(C, 0, r2, { len: 20, wid: 7.5, prof: lobed, leafEvery: 7.5 });                                  // oak
    spray(C, 1, r2, { len: 18, wid: 8.5, prof: oval, leafEvery: 7.5, side: 8 });                          // beech / poplar
    spray(C, 2, r2, { len: 13, wid: 6, prof: pointed, leafEvery: 6, bright: 0.56, side: 8, spread: 0.7, mainLen: 225 });   // birch
    spray(C, 6, r2, { len: 42, wid: 16, prof: oval, leafEvery: 16, side: 6, bright: 0.48 });              // tropical
    spray(C, 7, r2, { len: 15, wid: 6.5, prof: oval, leafEvery: 6.5, side: 9, spread: 1.15 });            // shrubs
    barkTile(C, 11, r2);
    coniferSpray(C, 12, r2, { needle: 11, dense: 1.6 });                                                    // spruce / fir
  }
  // pack
  const N = ATLAS_SIZE, data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round(Math.min(Math.max(C.R[i], 0), 1) * 255);
    data[i * 4 + 1] = Math.round(Math.min(Math.max(C.G[i], 0), 1) * 255);
    data[i * 4 + 2] = Math.round(Math.min(Math.max(C.B[i], 0), 1) * 255);
    data[i * 4 + 3] = Math.round(Math.min(Math.max(C.A[i], 0), 1) * 255);
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
