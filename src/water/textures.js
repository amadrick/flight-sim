// Procedural textures generated at boot (no network): tileable noise for large-scale sea-state variation and a
// tileable "bubbly lace" foam texture (Worley F2-F1 cell borders modulated by noise). ~15 ms total for 256².
import * as THREE from 'three';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// tileable value-noise fBm on an S×S grid with base period p cells
function fbm(S, p0, octaves, seed) {
  const out = new Float32Array(S * S);
  const r = rng(seed);
  let amp = 1, norm = 0;
  for (let o = 0, p = p0; o < octaves; o++, p *= 2, amp *= 0.5) {
    const lat = new Float32Array(p * p); for (let i = 0; i < p * p; i++) lat[i] = r();
    for (let y = 0; y < S; y++) {
      const fy = (y / S) * p, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < S; x++) {
        const fx = (x / S) * p, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const a = lat[(y0 % p) * p + (x0 % p)], b = lat[(y0 % p) * p + ((x0 + 1) % p)];
        const c = lat[((y0 + 1) % p) * p + (x0 % p)], d = lat[((y0 + 1) % p) * p + ((x0 + 1) % p)];
        out[y * S + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    norm += amp;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function toTexture(S, channels) {
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 4; c++) {
    const ch = channels[c]; data[i * 4 + c] = ch ? Math.max(0, Math.min(255, Math.round(ch[i] * 255))) : 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

function stretch(a) { // normalise to [0,1] with a mild contrast stretch
  let lo = 1e9, hi = -1e9; for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) / (hi - lo);
  return a;
}

/** RGBA noise: r,g = independent low-frequency fBm, b = higher-frequency fBm, a = ridged streak noise. */
export function makeNoiseTexture(S = 256, seed = 11) {
  const r = stretch(fbm(S, 4, 5, seed)), g = stretch(fbm(S, 4, 5, seed + 1)), b = stretch(fbm(S, 16, 4, seed + 2));
  const a = fbm(S, 8, 4, seed + 3); for (let i = 0; i < a.length; i++) a[i] = 1 - Math.abs(a[i] * 2 - 1); stretch(a);
  return toTexture(S, [r, g, b, a]);
}

/** Foam: r = bubbly lace (white = foam), g = soft blotches, b = fine bubbles. */
export function makeFoamTexture(S = 256, seed = 23) {
  const r = rng(seed);
  const lace = new Float32Array(S * S), fine = new Float32Array(S * S);
  const worley = (cells, target, weight, jitter) => {
    const pts = new Float32Array(cells * cells * 2);
    for (let i = 0; i < cells * cells; i++) { pts[i * 2] = 0.5 + (r() - 0.5) * jitter; pts[i * 2 + 1] = 0.5 + (r() - 0.5) * jitter; }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const fx = (x / S) * cells, fy = (y / S) * cells, cx = Math.floor(fx), cy = Math.floor(fy);
      let f1 = 9, f2 = 9;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const gx = cx + ox, gy = cy + oy, wx = ((gx % cells) + cells) % cells, wy = ((gy % cells) + cells) % cells;
        const px = gx + pts[(wy * cells + wx) * 2], py = gy + pts[(wy * cells + wx) * 2 + 1];
        const d = Math.hypot(px - fx, py - fy);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
      target[y * S + x] += weight * Math.exp(-(f2 - f1) * 7);
    }
  };
  worley(10, lace, 0.65, 0.9); worley(23, lace, 0.45, 0.9); worley(48, fine, 1.0, 0.8);
  const blot = stretch(fbm(S, 4, 5, seed + 5));
  const n = fbm(S, 16, 3, seed + 7);
  for (let i = 0; i < S * S; i++) lace[i] = lace[i] * (0.55 + 0.9 * n[i]);
  return toTexture(S, [stretch(lace), blot, stretch(fine), null]);
}
