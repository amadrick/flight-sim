// Procedural foliage atlas (boot time, pure JS rasteriser - no canvas, no images).
// 1024 x 1024 RGBA8, 4 x 4 tiles of 256 px. Channels (linear data, not colour):
//   R = leaf brightness variation (0..1, 0.5 = species mean)   G = autumn / dry tint amount (0..1)
//   B = cluster depth (1 = outer leaves, 0 = twig / inner)      A = coverage (alpha-tested at 0.5)
// Tiles: 0 oak cluster, 1 beech / poplar cluster, 2 birch, 3 spruce / fir bough, 4 pine tufts, 5 palm frond (u along
// the frond, v across), 6 tropical large leaves, 7 shrub, 8 desert shrub, 9 grass tuft, 10 reeds, 11 bark (tiling).
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
  const ex = Math.abs(ca) * len + Math.abs(sa) * wid + 2, ey = Math.abs(sa) * len + Math.abs(ca) * wid + 2;
  const mx = cx + ca * len * 0.5, my = cy + sa * len * 0.5;
  const x0 = Math.max(0, Math.floor(mx - ex)), x1 = Math.min(TILE - 1, Math.ceil(mx + ex));
  const y0 = Math.max(0, Math.floor(my - ey)), y1 = Math.min(TILE - 1, Math.ceil(my + ey));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const u = (dx * ca + dy * sa) / len, v = (-dx * sa + dy * ca);
    if (u < 0 || u > 1) continue;
    const hw = wid * prof(u);
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
      const px = cx + (ex - cx) * t, py = cy + (ey - cy) * t;
      const side = i & 1 ? 1 : -1;
      const la = ang + side * (0.6 + 0.5 * r());
      const s = 0.75 + 0.5 * r();
      const depth = 0.35 + 0.65 * t;
      stamp(C, tile, px, py, la, len * s, wid * s, prof, bright + vr * (r() - 0.5) + 0.12 * t, r() < 0.08 ? 0.6 + 0.4 * r() : 0.1 * r(), depth);
    }
  }
}

export function createFoliageAtlas() {
  const C = makeCanvas();
  const r = rng32(1234567);
  cluster(C, 0, r, { n: 150, len: 30, wid: 9, prof: lobed });
  cluster(C, 1, r, { n: 150, len: 28, wid: 11, prof: oval });
  cluster(C, 2, r, { n: 120, len: 17, wid: 7.5, prof: pointed, spread: 1.15, bright: 0.58, var: 0.45 });
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
  cluster(C, 6, r, { n: 60, len: 58, wid: 21, prof: oval, spread: 1.1, bright: 0.48 });
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
