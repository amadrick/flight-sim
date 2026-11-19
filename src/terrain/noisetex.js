// Tileable noise textures for the terrain surface shader, generated on the CPU at boot (~100 ms).
//   tNoise (RGBA8, mips, repeat):  R = fBm A, G = fBm B (independent), B = cellular F1 (0 at cell centres), A = ridged fBm
//   tNorm  (RGBA8, mips, repeat):  RG = d(fBm A)/d(u,v), BA = d(cellular bumps)/d(u,v)   (0.5 = flat)
// Both tile exactly; the shader samples them at several scales with different rotations (anti-tiling).
import * as THREE from 'three';

function hash2(x, y, seed) {
  let h = (Math.imul(x | 0, 0x8da6b343 | 0) + Math.imul(y | 0, 0xd8163841 | 0) + Math.imul(seed | 0, 0xcb1ab31f | 0)) | 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h;
}
// periodic gradient noise, period `per` lattice cells
function pnoise(x, y, per, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const x0 = ((ix % per) + per) % per, y0 = ((iy % per) + per) % per, x1 = (x0 + 1) % per, y1 = (y0 + 1) % per;
  const g = (cx, cy, dx, dy) => { const h = hash2(cx, cy, seed); return ((h & 0xffff) / 32768 - 1) * dx + ((h >>> 16) / 32768 - 1) * dy; };
  const a = g(x0, y0, fx, fy), b = g(x1, y0, fx - 1, fy), c = g(x0, y1, fx, fy - 1), d = g(x1, y1, fx - 1, fy - 1);
  return a + ux * (b - a) + uy * (c - a) + ux * uy * (a - b - c + d);
}
function pworley(x, y, per, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let best = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j, h = hash2(((cx % per) + per) % per, ((cy % per) + per) % per, seed);
    const px = cx + (h & 0xffff) / 65536, py = cy + (h >>> 16) / 65536;
    const d = (px - x) * (px - x) + (py - y) * (py - y);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function createNoiseTextures(anisotropy = 4) {
  const S = 256, n = S * S;
  const fa = new Float32Array(n), fb = new Float32Array(n), wo = new Float32Array(n), ri = new Float32Array(n), bump = new Float32Array(n);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, k = y * S + x;
    let a = 0, b = 0, r = 0, amp = 0.5, f = 4;
    for (let o = 0; o < 6; o++) {
      const na = pnoise(u * f, v * f, f, 11 + o), nb = pnoise(u * f + 0.37, v * f + 0.61, f, 47 + o);
      a += amp * na; b += amp * nb; r += amp * (1 - Math.min(1, Math.abs(pnoise(u * f + 0.5, v * f + 0.2, f, 83 + o)) * 2.2));
      amp *= 0.5; f *= 2;
    }
    fa[k] = a; fb[k] = b; ri[k] = r;
    const w1 = pworley(u * 16, v * 16, 16, 5), w2 = pworley(u * 37, v * 37, 37, 9);
    wo[k] = Math.min(1, w1 * 0.95);
    // bump field for canopies / cobbles: rounded domes at two sizes
    bump[k] = Math.max(0, 1 - w1 * w1 * 1.6) * 0.7 + Math.max(0, 1 - w2 * w2 * 1.6) * 0.3;
  }
  const noise = new Uint8Array(n * 4), norm = new Uint8Array(n * 4);
  const q = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const k = y * S + x, xl = y * S + ((x + S - 1) % S), xr = y * S + ((x + 1) % S), yd = ((y + S - 1) % S) * S + x, yu = ((y + 1) % S) * S + x;
    noise[k * 4] = q(0.5 + fa[k] * 1.15); noise[k * 4 + 1] = q(0.5 + fb[k] * 1.15); noise[k * 4 + 2] = q(wo[k]); noise[k * 4 + 3] = q(ri[k] * 1.02);
    norm[k * 4] = q(0.5 + (fa[xr] - fa[xl]) * 9); norm[k * 4 + 1] = q(0.5 + (fa[yu] - fa[yd]) * 9);
    norm[k * 4 + 2] = q(0.5 + (bump[xr] - bump[xl]) * 3.2); norm[k * 4 + 3] = q(0.5 + (bump[yu] - bump[yd]) * 3.2);
  }
  const mk = (data) => {
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = anisotropy; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
    return t;
  };
  return { noise: mk(noise), norm: mk(norm) };
}
