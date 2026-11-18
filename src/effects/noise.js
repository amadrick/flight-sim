// Procedural noise textures shared by all effects (generated once at boot, ~20 ms).
//   noise3D : 32³ tileable RGBA8 Data3DTexture — R/G/B = gradient-ish value noise fBm at 3 frequencies,
//             A = "billow" (1-|n|). Used for plume turbulence, vapour streaks, contrail lumpiness.
//   puff2D  : 128² RGBA8 — R/G/B = three soft billowy smoke-puff variants (radial falloff × fBm),
//             A = smooth gaussian (glow / spark core).
import * as THREE from 'three';
import { makeRng } from '../core/math.js';

function lattice(n, seed) {
  const r = makeRng(seed); const a = new Float32Array(n * n * n);
  for (let i = 0; i < a.length; i++) a[i] = r() * 2 - 1;
  return a;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// periodic value noise sampled at (x,y,z) in lattice units, period p
function vnoise3(L, p, x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = fade(x - xi), fy = fade(y - yi), fz = fade(z - zi);
  const ix0 = ((xi % p) + p) % p, iy0 = ((yi % p) + p) % p, iz0 = ((zi % p) + p) % p;
  const ix1 = (ix0 + 1) % p, iy1 = (iy0 + 1) % p, iz1 = (iz0 + 1) % p;
  const N = 32; // L is always 32³; period p ≤ 32 uses a sub-lattice
  const v = (a, b, c) => L[a + N * (b + N * c)];
  const x00 = v(ix0, iy0, iz0) + (v(ix1, iy0, iz0) - v(ix0, iy0, iz0)) * fx;
  const x10 = v(ix0, iy1, iz0) + (v(ix1, iy1, iz0) - v(ix0, iy1, iz0)) * fx;
  const x01 = v(ix0, iy0, iz1) + (v(ix1, iy0, iz1) - v(ix0, iy0, iz1)) * fx;
  const x11 = v(ix0, iy1, iz1) + (v(ix1, iy1, iz1) - v(ix0, iy1, iz1)) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

export function createNoise3D() {
  const S = 32, L = lattice(32, 9127);
  const data = new Uint8Array(S * S * S * 4);
  const fbm = (x, y, z, p0, oct) => {
    let a = 0, amp = 0.5, p = p0, sum = 0;
    for (let o = 0; o < oct; o++) {
      const k = p / S;
      a += amp * vnoise3(L, p, x * k + o * 7.3, y * k + o * 3.1, z * k + o * 5.7); sum += amp;
      amp *= 0.5; p *= 2; if (p > 32) break;
    }
    return a / sum;
  };
  let i = 0;
  for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = fbm(x, y, z, 4, 3), g = fbm(x + 11, y + 5, z + 17, 8, 2), b = fbm(x + 3, y + 23, z + 9, 16, 2);
    const bil = 1 - Math.abs(fbm(x + 19, y + 13, z + 29, 4, 3));
    data[i++] = Math.max(0, Math.min(255, (r * 0.5 + 0.5) * 255));
    data[i++] = Math.max(0, Math.min(255, (g * 0.5 + 0.5) * 255));
    data[i++] = Math.max(0, Math.min(255, (b * 0.5 + 0.5) * 255));
    data[i++] = Math.max(0, Math.min(255, bil * 255));
  }
  const tex = new THREE.Data3DTexture(data, S, S, S);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1; tex.needsUpdate = true;
  return tex;
}

export function createPuffTexture() {
  const S = 128, L = lattice(32, 4441);
  const data = new Uint8Array(S * S * 4);
  const fbm2 = (x, y, z) => {
    let a = 0, amp = 0.5, f = 1, sum = 0;
    for (let o = 0; o < 5; o++) { a += amp * vnoise3(L, 32, x * f, y * f, z + o * 3.7); sum += amp; amp *= 0.55; f *= 2; }
    return a / sum;
  };
  let i = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
    const r = Math.sqrt(u * u + v * v);
    for (let c = 0; c < 3; c++) {
      // billowy blob: noise-perturbed radius, cauliflower edge, soft interior
      const n = fbm2(u * 2.2 + c * 9.1 + 4, v * 2.2 + c * 4.3 + 4, c * 5.0);
      const bil = 1 - Math.abs(fbm2(u * 4.5 + c * 2.7 + 8, v * 4.5 + 8, 11 + c));
      const edge = 0.62 + 0.32 * n;
      let d = 1 - smooth(edge * 0.45, edge, r);
      d *= 0.55 + 0.45 * bil;
      d = Math.pow(Math.max(0, d), 1.1);
      data[i + c] = Math.max(0, Math.min(255, d * 255));
    }
    data[i + 3] = Math.max(0, Math.min(255, Math.exp(-r * r * 5.5) * (1 - smooth(0.8, 1.0, r)) * 255));
    i += 4;
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
  return tex;
}
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
