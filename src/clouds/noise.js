// Procedural noise textures for the volumetric clouds. Everything is generated at boot:
//   - 2D tiling fbm/cell noise + blue noise + curl noise on the CPU (small, a few ms),
//   - the tiling 3D Perlin-Worley "base" (128^3) and Worley "detail" (32^3) volumes on the GPU, slice by slice.
// The 3D volumes follow Schneider's Nubis recipe (SIGGRAPH 2015/2017 "Real-time volumetric cloudscapes of
// Horizon Zero Dawn"): a low-frequency Perlin noise dilated by inverted Worley fbm gives billowy connected
// shapes, and a small high-frequency Worley fbm volume erodes the edges.
// To keep the boot far below a second even on slow GPUs, the expensive analytic noises (27-cell Worley,
// gradient noise) are evaluated once into a small 64^3 "block" volume whose octaves are then recombined
// with cheap trilinear fetches.
import * as THREE from 'three';
import { FULLSCREEN_VERT, FullscreenPass } from '../core/glsl.js';

// ------------------------------------------------------------------------------------------------ CPU 2D noise

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Tileable 2D gradient-noise fbm, returns Float32Array(size*size) roughly in [-1, 1]. */
function fbm2D(size, lattice, octaves, seed, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const L = lattice << o, rnd = mulberry(seed + o * 101);
    const gx = new Float32Array(L * L), gy = new Float32Array(L * L);
    for (let i = 0; i < L * L; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    const s = L / size;
    for (let y = 0; y < size; y++) {
      const fy = (y + 0.5) * s, iy = Math.floor(fy), ty = fy - iy, y0 = iy % L, y1 = (iy + 1) % L;
      const wy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
      for (let x = 0; x < size; x++) {
        const fx = (x + 0.5) * s, ix = Math.floor(fx), tx = fx - ix, x0 = ix % L, x1 = (ix + 1) % L;
        const wx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
        const a = gx[y0 * L + x0] * tx + gy[y0 * L + x0] * ty;
        const b = gx[y0 * L + x1] * (tx - 1) + gy[y0 * L + x1] * ty;
        const c = gx[y1 * L + x0] * tx + gy[y1 * L + x0] * (ty - 1);
        const d = gx[y1 * L + x1] * (tx - 1) + gy[y1 * L + x1] * (ty - 1);
        out[y * size + x] += amp * 1.5 * (a + (b - a) * wx + ((c + (d - c) * wx) - (a + (b - a) * wx)) * wy);
      }
    }
    norm += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** Tileable 2D Worley (inverted F1: 1 at the feature points), Float32Array in [0, 1]. */
function worley2D(size, cells, seed) {
  const rnd = mulberry(seed), px = new Float32Array(cells * cells), py = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) { px[i] = rnd(); py[i] = rnd(); }
  const out = new Float32Array(size * size), s = cells / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x + 0.5) * s, fy = (y + 0.5) * s, ix = Math.floor(fx), iy = Math.floor(fy);
    let dm = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = ((ix + i) % cells + cells) % cells, cy = ((iy + j) % cells + cells) % cells;
      const dx = ix + i + px[cy * cells + cx] - fx, dy = iy + j + py[cy * cells + cx] - fy;
      dm = Math.min(dm, dx * dx + dy * dy);
    }
    out[y * size + x] = 1 - Math.min(1, Math.sqrt(dm));
  }
  return out;
}

/** Stretch a Float32Array to [0,1] by percentiles (so every channel uses the full range with mean ~0.5). */
function normalize01(a, lo = 0.01, hi = 0.99) {
  const s = Float32Array.from(a).sort();
  const v0 = s[Math.floor(lo * (s.length - 1))], v1 = s[Math.floor(hi * (s.length - 1))];
  for (let i = 0; i < a.length; i++) a[i] = Math.min(1, Math.max(0, (a[i] - v0) / (v1 - v0)));
  return a;
}

/**
 * Blue-noise dither array by void-and-cluster (Ulichney 1993), toroidal, size^2 values in [0,1).
 * 64x64 takes a few tens of ms. Animated in the shader by adding the golden ratio per frame.
 */
function blueNoise(size, seed) {
  const N = size * size, rnd = mulberry(seed), R = 6, sigma2 = 2 * 1.9 * 1.9;
  const kernel = new Float32Array((2 * R + 1) * (2 * R + 1));
  for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) kernel[(j + R) * (2 * R + 1) + i + R] = Math.exp(-(i * i + j * j) / sigma2);
  const energy = new Float32Array(N), bits = new Uint8Array(N), rank = new Float32Array(N);
  const splat = (p, sign) => {
    const px = p % size, py = (p / size) | 0;
    for (let j = -R; j <= R; j++) {
      const y = (py + j + size) % size;
      for (let i = -R; i <= R; i++) energy[y * size + ((px + i + size) % size)] += sign * kernel[(j + R) * (2 * R + 1) + i + R];
    }
  };
  const extreme = (wantOne, tight) => { // tightest cluster among ones / largest void among zeros
    let best = -1, bv = tight ? -Infinity : Infinity;
    for (let i = 0; i < N; i++) if ((bits[i] === 1) === wantOne) { const e = energy[i]; if (tight ? e > bv : e < bv) { bv = e; best = i; } }
    return best;
  };
  const ones0 = Math.floor(N * 0.1);
  for (let k = 0; k < ones0;) { const p = Math.floor(rnd() * N); if (!bits[p]) { bits[p] = 1; splat(p, 1); k++; } }
  for (let it = 0; it < N; it++) { // relax the initial pattern
    const c = extreme(true, true); bits[c] = 0; splat(c, -1);
    const v = extreme(false, false); bits[v] = 1; splat(v, 1);
    if (v === c) break;
  }
  const saveBits = bits.slice(), saveEnergy = energy.slice();
  for (let r = ones0 - 1; r >= 0; r--) { const c = extreme(true, true); bits[c] = 0; splat(c, -1); rank[c] = r; }
  bits.set(saveBits); energy.set(saveEnergy);
  for (let r = ones0; r < N; r++) { const v = extreme(false, false); bits[v] = 1; splat(v, 1); rank[v] = r; }
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = Math.min(255, Math.floor((rank[i] / N) * 256));
  return out;
}

function dataTex(data, size, format, repeat = true, mips = true) {
  const t = new THREE.DataTexture(data, size, size, format, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mips; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

/**
 * CPU-side 2D noises.
 *  noise2D (256^2 RGBA8, tiling): R,G = two independent fbm fields, B = cellular blobs, A = finer fbm. All ~uniform in [0,1].
 *  curl    (128^2 RGBA8, tiling): divergence-free 2D vector field in RG (+ a second one in BA), 0.5 = zero.
 *  blue    (64^2 R8).
 */
export function createNoise2D(seed = 1337) {
  const S = 256, data = new Uint8Array(S * S * 4);
  const r = normalize01(fbm2D(S, 4, 4, seed + 1)), g = normalize01(fbm2D(S, 4, 4, seed + 2));
  const w = worley2D(S, 6, seed + 3), wf = fbm2D(S, 8, 3, seed + 4);
  const b = new Float32Array(S * S); for (let i = 0; i < b.length; i++) b[i] = w[i] + 0.22 * wf[i];
  normalize01(b);
  const a = normalize01(fbm2D(S, 8, 4, seed + 5, 0.55));
  for (let i = 0; i < S * S; i++) { data[i * 4] = r[i] * 255; data[i * 4 + 1] = g[i] * 255; data[i * 4 + 2] = b[i] * 255; data[i * 4 + 3] = a[i] * 255; }

  const C = 128, curl = new Uint8Array(C * C * 4);
  const p1 = fbm2D(C, 4, 3, seed + 6), p2 = fbm2D(C, 4, 3, seed + 7);
  const at = (p, x, y) => p[((y + C) % C) * C + ((x + C) % C)];
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
    const i = (y * C + x) * 4, k = 9; // curl of a scalar potential: (dψ/dy, -dψ/dx)
    curl[i]     = 127.5 + 127.5 * Math.max(-1, Math.min(1, k * (at(p1, x, y + 1) - at(p1, x, y - 1))));
    curl[i + 1] = 127.5 + 127.5 * Math.max(-1, Math.min(1, -k * (at(p1, x + 1, y) - at(p1, x - 1, y))));
    curl[i + 2] = 127.5 + 127.5 * Math.max(-1, Math.min(1, k * (at(p2, x, y + 1) - at(p2, x, y - 1))));
    curl[i + 3] = 127.5 + 127.5 * Math.max(-1, Math.min(1, -k * (at(p2, x + 1, y) - at(p2, x - 1, y))));
  }

  const B = 64, bn = blueNoise(B, seed + 8);
  const blue = new THREE.DataTexture(bn, B, B, THREE.RedFormat, THREE.UnsignedByteType);
  blue.wrapS = blue.wrapT = THREE.RepeatWrapping; blue.magFilter = blue.minFilter = THREE.NearestFilter;
  blue.generateMipmaps = false; blue.needsUpdate = true;

  // Bilinear, wrapping CPU sampler matching the GPU's GL_LINEAR/REPEAT fetch of noise2D (out = [r,g,b,a] in 0..1).
  function sample(u, v, out) {
    let x = u * S - 0.5, y = v * S - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const xa = ((x0 % S) + S) % S, xb = (xa + 1) % S, ya = ((y0 % S) + S) % S, yb = (ya + 1) % S;
    const i00 = (ya * S + xa) * 4, i10 = (ya * S + xb) * 4, i01 = (yb * S + xa) * 4, i11 = (yb * S + xb) * 4;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy, k = 1 / 255;
    for (let c = 0; c < 4; c++) out[c] = (data[i00 + c] * w00 + data[i10 + c] * w10 + data[i01 + c] * w01 + data[i11 + c] * w11) * k;
    return out;
  }
  return { noise2D: dataTex(data, S, THREE.RGBAFormat), curl: dataTex(curl, C, THREE.RGBAFormat), blue, sample, size: S };
}

// ------------------------------------------------------------------------------------------------ cumulus cell field

/**
 * Tiling 2D field of individual convective cells (one cumulus per cell), generated on the CPU at boot (~30 ms).
 * Cells are disks placed largest first by dart throwing, with a power-law number density n(D) ~ D^-slope between
 * dMin and dMax (fields of shallow cumulus: Neggers et al. 2003, Wood & Field 2011), so one sky holds a few big
 * congestus-size cells and many small humilis / fractus, with clear air between them.
 * Texels (RGBA8, wrapping, mipmapped), for the cell whose scaled distance d / r is smallest (a power diagram):
 *   R = 0.5 + 0.5 (1 - d / r)   (1 at the centre, 0.5 on the nominal rim, 0 at two radii: cells can grow into it)
 *   G = log size: D = dMin * (dMax / dMin)^G
 *   B = random id (coverage selects cells with id below a threshold)
 *   A = random life-cycle phase (growing / mature / decaying)
 * Options: size (texels), period (m), dMin, dMax (m), slope, fill (area fraction covered by the nominal disks).
 */
export function createCellField({ seed = 1337, size = 512, period = 20480, dMin = 240, dMax = 4200, slope = 2.5, fill = 0.55, borderTaper = true } = {}) {
  const rnd = mulberry(seed * 31 + 7);
  const S = size, texel = period / S;
  // sizes: inverse CDF of D^-slope on [dMin, dMax], sorted descending, until the disk area reaches `fill`
  const a = 1 - slope, lo = Math.pow(dMin, a), hi = Math.pow(dMax, a);
  const want = [];
  let area = 0;
  while (area < fill * period * period && want.length < 20000) {
    const D = Math.pow(lo + (hi - lo) * rnd(), 1 / a);
    want.push(D); area += Math.PI * D * D / 4;
  }
  want.sort((x, y) => y - x);
  // dart throwing with a coarse grid for neighbour queries (toroidal)
  const GC = 32, cellM = period / GC, grid = Array.from({ length: GC * GC }, () => []);
  const placed = [];
  const wrapD = (d) => d - period * Math.round(d / period);
  for (const D of want) {
    const r = D / 2;
    for (let tries = 0; tries < 30; tries++) {
      const x = rnd() * period, z = rnd() * period;
      const gx = Math.floor(x / cellM), gz = Math.floor(z / cellM), reach = Math.ceil((r + dMax / 2) / cellM);
      let ok = true;
      for (let j = -reach; j <= reach && ok; j++) for (let i = -reach; i <= reach && ok; i++) {
        for (const c of grid[((gz + j + GC) % GC) * GC + ((gx + i + GC) % GC)]) {
          const dx = wrapD(c.x - x), dz = wrapD(c.z - z);
          if (dx * dx + dz * dz < Math.pow(0.92 * (c.r + r), 2)) { ok = false; break; }
        }
      }
      if (!ok) continue;
      const c = { x, z, r, g: Math.log(D / dMin) / Math.log(dMax / dMin), id: rnd(), ph: rnd() };
      placed.push(c); grid[gz * GC + gx].push(c);
      break;
    }
  }
  // rasterise each cell out to two radii, keeping the smallest scaled distance per texel
  const best = new Float32Array(S * S).fill(2), best2 = new Float32Array(S * S).fill(2), owner = new Int32Array(S * S).fill(-1);
  placed.forEach((c, k) => {
    const R = 2 * c.r / texel, cx = c.x / texel - 0.5, cz = c.z / texel - 0.5;
    const x0 = Math.floor(cx - R), x1 = Math.ceil(cx + R), z0 = Math.floor(cz - R), z1 = Math.ceil(cz + R);
    const inv = texel / c.r;
    for (let j = z0; j <= z1; j++) {
      const row = ((j % S) + S) % S, dz = (j - cz) * inv;
      for (let i = x0; i <= x1; i++) {
        const dx = (i - cx) * inv, d = Math.sqrt(dx * dx + dz * dz);
        if (d >= 2) continue;
        const idx = row * S + (((i % S) + S) % S);
        if (d < best[idx]) { best2[idx] = best[idx]; best[idx] = d; owner[idx] = k; }
        else if (d < best2[idx]) best2[idx] = d;
      }
    }
  });
  // Half float on the GPU (round four): with 8 bits the distance to the centre came in steps of radius / 128 (8 m for
  // a 2 km cell), which showed as vertical striations on the flanks of big clouds seen from a few hundred metres.
  const data = new Float32Array(S * S * 4), half = new Uint16Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const c = placed[owner[i]];
    // Round four: where a neighbour's territory begins, the owner (size, id, phase) switches within one 40 m texel.
    // A vigorous cloud that filled its cell was cut there by a smooth vertical cliff far steeper than anything the
    // detail erosion could move: the featureless walls of big cumulus seen from close by. The stored distance now
    // rises toward the border (to 1.25 radii on it), so the cloud tapers into a clear slot and its flank stays a
    // noise surface.
    const dEff = borderTaper ? Math.max(best[i], 1.25 - 2 * (best2[i] - best[i])) : best[i];
    data[i * 4] = Math.max(0, 0.5 + 0.5 * (1 - dEff));
    if (c) { data[i * 4 + 1] = c.g; data[i * 4 + 2] = c.id; data[i * 4 + 3] = c.ph; }
    else { data[i * 4 + 2] = 1; }
  }
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
  // Bilinear wrapping CPU sampler (same as the GPU fetch at mip 0); u, v in tiles.
  function sample(u, v, out) {
    const x = u * S - 0.5, y = v * S - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const xa = ((x0 % S) + S) % S, xb = (xa + 1) % S, ya = ((y0 % S) + S) % S, yb = (ya + 1) % S;
    const i00 = (ya * S + xa) * 4, i10 = (ya * S + xb) * 4, i01 = (yb * S + xa) * 4, i11 = (yb * S + xb) * 4;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy, k = 1;
    for (let c = 0; c < 4; c++) out[c] = (data[i00 + c] * w00 + data[i10 + c] * w10 + data[i01 + c] * w01 + data[i11 + c] * w11) * k;
    return out;
  }
  const texture = dataTex(half, S, THREE.RGBAFormat);
  texture.type = THREE.HalfFloatType;
  return { texture, data, size: S, period, dMin, dMax, count: placed.length, sample };
}

// ------------------------------------------------------------------------------------------------ GPU 3D noise

const NOISE_LIB = /* glsl */`
precision highp float; precision highp int; precision highp sampler3D;
// PCG3D hash (Jarzynski & Olano 2020) — integer hash, identical on every GPU.
vec3 hash33(ivec3 p, int seed) {
  uvec3 v = uvec3(p + ivec3(seed, seed * 7 + 3, seed * 13 + 5));
  v = v * 1664525u + 1013904223u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return vec3(v) * (1.0 / 4294967296.0);
}
ivec3 wrapi(ivec3 c, int n) { return ((c % n) + n) % n; }
// Tiling inverted Worley F1 with n cells per axis; p in [0,1)^3.
float worley(vec3 p, int n, int seed) {
  p *= float(n); ivec3 ip = ivec3(floor(p)); vec3 f = fract(p); float dm = 9.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec3 o = ivec3(x, y, z); vec3 r = vec3(o) + hash33(wrapi(ip + o, n), seed) - f; dm = min(dm, dot(r, r));
  }
  return 1.0 - clamp(sqrt(dm), 0.0, 1.0);
}
// Tiling gradient (Perlin) noise with an n-cell lattice; roughly [-1, 1].
float gnoise(vec3 p, int n, int seed) {
  p *= float(n); ivec3 ip = ivec3(floor(p)); vec3 f = fract(p); vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float v[8];
  for (int i = 0; i < 8; i++) {
    ivec3 o = ivec3(i & 1, (i >> 1) & 1, (i >> 2) & 1);
    vec3 g = normalize(hash33(wrapi(ip + o, n), seed) * 2.0 - 1.0 + 1e-4);
    v[i] = dot(g, f - vec3(o));
  }
  return 1.5 * mix(mix(mix(v[0], v[1], u.x), mix(v[2], v[3], u.x), u.y), mix(mix(v[4], v[5], u.x), mix(v[6], v[7], u.x), u.y), u.z);
}
float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
`;

const BLOCK_FRAG = /* glsl */`
${NOISE_LIB}
in vec2 vUv; out vec4 o; uniform float uZ;
void main() {
  vec3 p = vec3(vUv, uZ);
  o = vec4(0.5 + 0.5 * gnoise(p, 4, 1), worley(p, 4, 11), 0.5 + 0.5 * gnoise(p, 4, 2), worley(p, 4, 22));
}`;

// Base volume. R: Perlin-Worley shape (low frequency, well spread over [0,1]); G: medium Worley fbm;
// B: high Worley fbm; A: plain low-frequency Perlin fbm (used for slow variation).
const BASE_FRAG = /* glsl */`
${NOISE_LIB}
in vec2 vUv; out vec4 o; uniform float uZ; uniform sampler3D tBlock;
void main() {
  vec3 p = vec3(vUv, uZ);
  vec4 b1 = texture(tBlock, p), b2 = texture(tBlock, p * 2.0 + vec3(0.37, 0.11, 0.73));
  vec4 b4 = texture(tBlock, p * 4.0 + vec3(0.19, 0.61, 0.43)), b8 = texture(tBlock, p * 8.0 + vec3(0.71, 0.29, 0.07));
  float perlin = b1.r * 0.56 + b2.b * 0.29 + b4.r * 0.15;                 // lattice 4, 8, 16
  float w4 = b1.g, w8 = b2.a, w16 = b4.g, w32 = b8.a;
  float wLow = w4 * 0.625 + w8 * 0.25 + w16 * 0.125;
  float wMid = w8 * 0.625 + w16 * 0.25 + w32 * 0.125;
  float wHigh = w16 * 0.6 + w32 * 0.4;
  float pw = remap(perlin, 0.0, 1.0, wLow * 0.75, 1.0);                    // Perlin dilated by Worley → billows
  float shape = remap(pw, wMid - 1.0, 1.0, 0.0, 1.0);
  // contrast-stretch so the stored value is ~uniform on [0,1] (measured percentiles of the raw shape)
  shape = clamp((shape - 0.63) / (0.93 - 0.63), 0.0, 1.0);
  o = vec4(shape, wMid, wHigh, perlin);
}`;

// Detail volume: analytic Worley fbm at 3,6,12 (and 12,24) cells. R: erosion fbm; G: finer fbm; B: finest; A: Perlin.
const DETAIL_FRAG = /* glsl */`
${NOISE_LIB}
in vec2 vUv; out vec4 o; uniform float uZ;
void main() {
  vec3 p = vec3(vUv, uZ);
  float a = worley(p, 3, 31), b = worley(p, 6, 32), c = worley(p, 12, 33);
  // contrast-stretched so each channel spans ~[0,1] (inverted Worley fbm is otherwise bunched around 0.45)
  float r = clamp((a * 0.45 + b * 0.33 + c * 0.22 - 0.24) / 0.46, 0.0, 1.0);
  float g = clamp((b * 0.6 + c * 0.4 - 0.2) / 0.55, 0.0, 1.0);
  o = vec4(r, g, c, 0.5 + 0.5 * gnoise(p, 4, 34));
}`;

// Copies the low mip of the base volume into a 2D atlas for a single CPU read-back (used by densityAt()).
const ATLAS_FRAG = /* glsl */`
precision highp float; precision highp sampler3D;
in vec2 vUv; out vec4 o; uniform sampler3D tBase; uniform vec3 uGrid; // tiles x, tiles y, slices
void main() {
  vec2 t = vUv * uGrid.xy; vec2 cell = floor(t);
  float z = (cell.y * uGrid.x + cell.x + 0.5) / uGrid.z;
  o = textureLod(tBase, vec3(fract(t), z), 2.0);
}`;

const _cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

function volumeTarget(size) {
  const rt = new THREE.WebGL3DRenderTarget(size, size, size, { depthBuffer: false });
  const t = rt.texture;
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.mipmapsAutoUpdate = false;   // mip chain is built once, after the last slice
  return rt;
}

function renderSlices(renderer, rt, pass) {
  const n = rt.depth;
  for (let z = 0; z < n; z++) {
    pass.material.uniforms.uZ.value = (z + 0.5) / n;
    if (z === n - 1) rt.texture.mipmapsAutoUpdate = true;
    renderer.setRenderTarget(rt, z);
    renderer.render(pass.scene, _cam);
  }
  rt.texture.mipmapsAutoUpdate = false;
}

function slicePass(frag, uniforms = {}) {
  return new FullscreenPass(new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
    uniforms: { uZ: { value: 0 }, ...uniforms }, vertexShader: FULLSCREEN_VERT, fragmentShader: frag,
  }));
}

/**
 * Build the 3D noise volumes. Returns { base, detail, lowRes: { data: Uint8Array (N^3 RGBA), n } }.
 * `lowRes` is a CPU copy of the base volume's mip 2 (32^3) for CPU density queries.
 */
export function createNoise3D(renderer) {
  const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
  renderer.autoClear = false;

  const blockRT = volumeTarget(64), baseRT = volumeTarget(128), detailRT = volumeTarget(32);
  const blockPass = slicePass(BLOCK_FRAG);
  renderSlices(renderer, blockRT, blockPass);
  const basePass = slicePass(BASE_FRAG, { tBlock: { value: blockRT.texture } });
  renderSlices(renderer, baseRT, basePass);
  const detailPass = slicePass(DETAIL_FRAG);
  renderSlices(renderer, detailRT, detailPass);

  // CPU copy (32^3) via an 8x4 atlas of 32x32 tiles.
  const n = 32, gx = 8, gy = 4;
  const atlasRT = new THREE.WebGLRenderTarget(n * gx, n * gy, { depthBuffer: false, type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
  const atlasPass = slicePass(ATLAS_FRAG, { tBase: { value: baseRT.texture }, uGrid: { value: new THREE.Vector3(gx, gy, n) } });
  atlasPass.render(renderer, atlasRT);
  const px = new Uint8Array(n * gx * n * gy * 4);
  renderer.readRenderTargetPixels(atlasRT, 0, 0, n * gx, n * gy, px);
  const data = new Uint8Array(n * n * n * 4);
  for (let z = 0; z < n; z++) {
    const tx = z % gx, ty = (z / gx) | 0;
    for (let y = 0; y < n; y++) {
      const src = ((ty * n + y) * n * gx + tx * n) * 4;
      data.set(px.subarray(src, src + n * 4), (z * n + y) * n * 4);
    }
  }

  renderer.setRenderTarget(prevTarget); renderer.autoClear = prevAuto;
  blockPass.dispose(); basePass.dispose(); detailPass.dispose(); atlasPass.dispose();
  blockRT.dispose(); atlasRT.dispose();
  return { base: baseRT.texture, detail: detailRT.texture, baseRT, detailRT, lowRes: { data, n } };
}

/** Trilinear, wrapping sample of channel `c` of the CPU low-res volume at normalised coords. */
export function sampleLowRes(lowRes, u, v, w, c = 0) {
  const n = lowRes.n, d = lowRes.data;
  const x = u * n - 0.5, y = v * n - 0.5, z = w * n - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), fx = x - x0, fy = y - y0, fz = z - z0;
  const m = (i) => ((i % n) + n) % n;
  const xa = m(x0), xb = m(x0 + 1), ya = m(y0), yb = m(y0 + 1), za = m(z0), zb = m(z0 + 1);
  const at = (xi, yi, zi) => d[((zi * n + yi) * n + xi) * 4 + c];
  const a = at(xa, ya, za) * (1 - fx) + at(xb, ya, za) * fx, b = at(xa, yb, za) * (1 - fx) + at(xb, yb, za) * fx;
  const e = at(xa, ya, zb) * (1 - fx) + at(xb, ya, zb) * fx, f = at(xa, yb, zb) * (1 - fx) + at(xb, yb, zb) * fx;
  return ((a * (1 - fy) + b * fy) * (1 - fz) + (e * (1 - fy) + f * fy) * fz) / 255;
}
