// THE WORLD — single source of truth for the shape of the land.
//
// This file holds the terrain height function written in a strictly SCALAR subset of GLSL ES 3.00 (floats only,
// no vectors, results returned through globals). It is used twice:
//   * on the GPU, verbatim, by the clipmap generator (src/terrain/clipmap.js) that fills the height pyramid, and
//   * on the CPU: tools/gen-height.mjs transliterates it into src/terrain/height.gen.js (plain JS, doubles),
//     which is what heightAt(x, z) — physics, cameras, tests — calls.
// Both therefore describe the same surface by construction (float32 vs float64 rounding aside, i.e. millimetres).
// After editing this file run:  node src/terrain/tools/gen-height.mjs      (a unit test checks it is up to date)
//
// Subset rules (the transliterator is ~10 regexes): only `float`/`int`/`void`; one declaration statement per type
// keyword (`float a = 1.0, b = 2.0;` is fine); float literals always with a decimal point; no `out` params;
// helper builtins limited to those in gen-height.mjs's prelude; `ss()` (smoothstep that tolerates reversed edges).
//
// Techniques (see comments in place): quintic gradient noise with analytic derivatives; derivative-damped ridged
// multifractal ("eroded fBm", Quilez 2008 / Musgrave); slope-aligned gully noise for fluvial erosion (after
// Fewes/Clay John's "eroded terrain noise": phase-coherent cosine kernels whose stripes run down the local
// gradient, octaves bending along the accumulated erosion derivative => dendritic drainage); smooth-min/max CSG
// for coasts, basins and islands; terracing for mesas; band-limiting by level-of-detail (gLod) so coarse clipmap
// levels are prefiltered rather than aliased.
//
// World: +X east, +Z south, metres. Inside the function X, Z are kilometres.

// Integer lattice hash — hand-written per language so that both give identical bits.
export const HASH_GLSL = /* glsl */`
void hashI(float ix, float iy) {
  uint a = uint(int(ix)), b = uint(int(iy));
  uint h = a * 0x8da6b343u + b * 0xd8163841u + 0x9e3779b9u;
  h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
  gHa = float(h & 0xffffu) * (1.0 / 65536.0); gHb = float(h >> 16) * (1.0 / 65536.0);
}
`;
export const HASH_JS = `
function hashI(ix, iy) {
  let h = (Math.imul(ix | 0, 0x8da6b343 | 0) + Math.imul(iy | 0, 0xd8163841 | 0) + 0x9e3779b9) | 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  gHa = (h & 0xffff) / 65536; gHb = (h >>> 16) / 65536;
}
`;

// Globals shared by the scalar functions (results are returned through these):
//   gHa,gHb  hash outputs [0,1)            gDx,gDz  noised() derivative        gEx,gEz  gully() derivative
//   gMx,gMz  mount() gradient (per metre)  gLod     texel spacing of the level being generated (0 = full detail, CPU)
//   gArid    out: aridity 0 (lush) .. 1 (desert)
//   gSpec    out: special surface: > 0 open fresh water (river), < 0 playa / salt flat
//   gRivD,gRivW  nearest river: distance (m), half width (m)
export const GLOBAL_NAMES = ['gHa', 'gHb', 'gDx', 'gDz', 'gEx', 'gEz', 'gMx', 'gMz', 'gLod', 'gArid', 'gSpec', 'gRivD', 'gRivW'];
export const GLOBALS_GLSL = GLOBAL_NAMES.map((n) => `float ${n};`).join(' ') + '\n';

// Airport pads: exactly flat at `elevation` within flattenRadius, C1 blend out to flattenRadius * BLEND[id].
const BLEND = { KHVN: 2.0, KRDR: 1.9, KPNC: 1.9, PCRK: 1.45, KBAY: 1.9 };
const f1 = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
export function airportsCode(airports) {
  return airports.map((a) => `  h = flatten(h, x, z, ${f1(a.position.x)}, ${f1(a.position.z)}, ${f1(a.elevation)}, ${f1(a.flattenRadius)}, ${f1(Math.round(a.flattenRadius * (BLEND[a.id] || 2.0)))});`).join('\n');
}

// `//@AIRPORTS@` is replaced by generated flat() calls (from src/data/airports.js) by both consumers.
export const WORLD_GLSL = /* glsl */`
float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float smax(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return max(a, b) + h * h * k * 0.25; }
// band limit: 1 while a feature of wavelength w spans >= 8 texels of the current level, 0 below 4 texels
// (central-difference normals need that much headroom to stay free of grid artefacts)
float bl(float w) { return 1.0 - ss(w * 0.125, w * 0.25, gLod); }

// Gradient noise, quintic interpolant, value ~[-0.8, 0.8]; analytic derivative in gDx, gDz.
float noised(float x, float z) {
  float ix = floor(x), iz = floor(z);
  float fx = x - ix, fz = z - iz;
  float ux = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0), uz = fz * fz * fz * (fz * (fz * 6.0 - 15.0) + 10.0);
  float dux = 30.0 * fx * fx * (fx * (fx - 2.0) + 1.0), duz = 30.0 * fz * fz * (fz * (fz - 2.0) + 1.0);
  hashI(ix, iz);
  float ax = gHa * 2.0 - 1.0, az = gHb * 2.0 - 1.0;
  hashI(ix + 1.0, iz);
  float bx = gHa * 2.0 - 1.0, bz = gHb * 2.0 - 1.0;
  hashI(ix, iz + 1.0);
  float cx = gHa * 2.0 - 1.0, cz = gHb * 2.0 - 1.0;
  hashI(ix + 1.0, iz + 1.0);
  float dx = gHa * 2.0 - 1.0, dz = gHb * 2.0 - 1.0;
  float va = ax * fx + az * fz;
  float vb = bx * (fx - 1.0) + bz * fz;
  float vc = cx * fx + cz * (fz - 1.0);
  float vd = dx * (fx - 1.0) + dz * (fz - 1.0);
  float k1 = vb - va, k2 = vc - va, k3 = va - vb - vc + vd;
  gDx = ax + ux * (bx - ax) + uz * (cx - ax) + ux * uz * (ax - bx - cx + dx) + dux * (k1 + uz * k3);
  gDz = az + ux * (bz - az) + uz * (cz - az) + ux * uz * (az - bz - cz + dz) + duz * (k2 + ux * k3);
  return va + ux * k1 + uz * k2 + ux * uz * k3;
}

// Fractal coastline displacement, kilometres.
float coastFbm(float x, float z) {
  float s = 1.25 * noised(x * 0.000105 + 11.3, z * 0.000105 - 4.7);
  s += 0.60 * noised(x * 0.00024 - 3.1, z * 0.00024 + 8.2) * bl(4100.0);
  s += 0.30 * noised(x * 0.00056 + 1.7, z * 0.00056 + 2.9) * bl(1800.0);
  if (gLod < 400.0) s += 0.14 * noised(x * 0.0013 - 6.6, z * 0.0013 - 1.3) * bl(770.0);
  return s;
}

// Mountain relief 0..~1: two ridged octaves (the range-scale crest lines) plus damped smooth octaves, after a
// domain warp. Derivative damping (Quilez) keeps detail off steep faces. Gradient (1/m) in gMx, gMz.
float mount(float x, float z, float f0) {
  float px = x * f0, pz = z * f0;
  float w1 = noised(px * 0.6 + 5.2, pz * 0.6 + 1.3);
  float w2 = noised(px * 0.6 - 8.4, pz * 0.6 + 9.1);
  px += 0.45 * w1; pz += 0.45 * w2;
  float sum = 0.0, amp = 0.56, fr = 1.0, ax = 0.0, az = 0.0, gx = 0.0, gz = 0.0, rc = 1.0, rs = 0.0;
  for (int i = 0; i < 5; i++) {
    float f = bl(0.5 / (f0 * fr));
    if (f > 0.0) {
      float n = noised(px, pz);
      float v = 0.0, e = 0.0;
      if (i < 2) {
        float q = sqrt(n * n + 0.004);
        float r = clamp(1.098 - 1.55 * q, 0.0, 1.0);
        v = r * r * (3.0 - 2.0 * r); e = -9.3 * r * (1.0 - r) * n / q;
      } else {
        v = 0.5 + 0.7 * n; e = 0.7;
      }
      float dx = e * (rc * gDx + rs * gDz), dz = e * (rc * gDz - rs * gDx);
      ax += dx; az += dz;
      float damp = 1.0 / (1.0 + 0.30 * (ax * ax + az * az));
      sum += amp * mix(0.25, v * damp, f);
      gx += amp * fr * dx * damp * f; gz += amp * fr * dz * damp * f;
    } else {
      sum += amp * 0.25;
    }
    amp *= 0.47; fr *= 2.0;
    float nx = (0.8 * px - 0.6 * pz) * 2.0 + 13.7;
    pz = (0.6 * px + 0.8 * pz) * 2.0 - 7.3; px = nx;
    float nrc = 0.8 * rc - 0.6 * rs;
    rs = 0.6 * rc + 0.8 * rs; rc = nrc;
  }
  gMx = gx * f0; gMz = gz * f0;
  return sum;
}

// One octave of slope-aligned gully noise. (px,pz) in cell units, (dirx,dirz) = stripe wave vector (across-slope).
// Returns -1 (gully) .. 1 (spur); derivative w.r.t. p (up to 2*pi) in gEx, gEz. Compact kernel => 3x3 cells suffice.
float gully(float px, float pz, float dirx, float dirz) {
  float ix = floor(px), iz = floor(pz);
  float fx = px - ix, fz = pz - iz;
  float va = 0.0, vx = 0.0, vz = 0.0, wt = 0.0001;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      float ox = float(i), oz = float(j);
      hashI(ix - ox, iz - oz);
      float qx = fx + ox - gHa * 0.5, qz = fz + oz - gHb * 0.5;
      float d = qx * qx + qz * qz;
      if (d < 1.0) {
        float w = exp(-d * 2.0) - 0.135335;
        float mag = (qx * dirx + qz * dirz) * 6.2831853;
        float sn = -sin(mag) * w;
        wt += w; va += cos(mag) * w; vx += sn * dirx; vz += sn * dirz;
      }
    }
  }
  gEx = vx / wt; gEz = vz / wt;
  return va / wt;
}

// Fluvial dissection: 5 octaves of gully noise (cells 6 km .. 375 m), each octave's stripes following the slope
// left by the base relief plus the previous octaves (=> tributaries join trunk valleys at acute angles).
// (sx, sz) = slope of the surface being eroded. Returns ~[-1.9, 1.9]; negative = valley.
float dissect(float x, float z, float sx, float sz, float f0, float gain) {
  float sl = sqrt(sx * sx + sz * sz) + 0.0001;
  float dirx = sz / sl, dirz = -sx / sl;
  float ea = 1.0, ef = f0, es = 0.0, ex = 0.0, ez = 0.0;
  for (int i = 0; i < 5; i++) {
    // the stripe frequency grows with |direction|: limit it, and band-limit to the true stripe width
    float qx = dirx + ez, qz = dirz - ex;
    float qk = min(1.0, 1.6 / sqrt(qx * qx + qz * qz + 0.0001));
    float f = bl(0.6 / ef);
    if (f > 0.0) {
      float g = gully(x * ef + 17.0, z * ef - 9.0, qx * qk, qz * qk);
      es += g * ea * f;
      ex += gEx * ea * f * 0.8; ez += gEz * ea * f * 0.8;
    }
    ea *= gain; ef *= 2.0;
  }
  return es;
}

// Small-scale relief (metres at unit amplitude): 4 octaves, 210 m .. 17 m, band-limited.
float detail(float x, float z) {
  float s = 0.0;
  if (gLod < 105.0) s += noised(x * 0.00476 + 3.3, z * 0.00476 - 1.9) * bl(210.0);
  if (gLod < 45.0) s += 0.45 * noised(x * 0.0085 + z * 0.0071 - 5.1, z * 0.0085 - x * 0.0071 + 2.2) * bl(90.0);
  if (gLod < 19.5) s += 0.20 * noised(x * 0.0256 + 7.7, z * 0.0256 + 4.1) * bl(39.0);
  if (gLod < 8.5) s += 0.09 * noised(x * 0.045 - z * 0.038 + 1.4, z * 0.045 + x * 0.038 - 8.8) * bl(17.0);
  return s;
}

// distance to a river segment (all in km); keeps the nearest in gRivD (m) / gRivW (m)
void seg(float x, float z, float ax, float az, float bx, float bz, float w) {
  float ex = bx - ax, ez = bz - az, qx = x - ax, qz = z - az;
  float t = clamp((qx * ex + qz * ez) / (ex * ex + ez * ez), 0.0, 1.0);
  float dx = qx - ex * t, dz = qz - ez * t;
  float d = sqrt(dx * dx + dz * dz) * 1000.0;
  if (d < gRivD) { gRivD = d; gRivW = w; }
}

// Coral platform + low island: elliptical distance e (1 = shoreline). land = height of the island interior (m).
float atoll(float e, float land) {
  return land - (land + 1.5) * ss(0.9, 1.04, e) - 4.5 * ss(1.05, 1.35, e) + 5.3 * ss(1.45, 1.68, e)
    - 30.0 * ss(1.72, 1.95, e) - 500.0 * ss(1.9, 2.8, e) - 4000.0 * ss(2.6, 5.0, e);
}

// Islands: returns the island surface elevation (very negative away from any island). X, Z in km.
float islands(float X, float Z, float cw) {
  float h = -9000.0;
  // Coral Key (PCRK): long axis along runway 12/30 (heading 120)
  float dx = X + 85.0, dz = Z - 85.0;
  if (abs(dx) < 30.0 && abs(dz) < 30.0) {
    float u = dx * 0.866 + dz * 0.5, v = dz * 0.866 - dx * 0.5;
    float e = sqrt(u * u / 27.0 + v * v / 13.0) + 0.09 * cw + 0.05 * noised(X * 0.8 + 3.0, Z * 0.8 - 5.0);
    float hi = atoll(e, 5.0) + 75.0 * exp(-((u + 1.3) * (u + 1.3) + (v + 2.95) * (v + 2.95)) / 0.7) * ss(1.02, 0.8, e);
    h = max(h, hi);
  }
  // sand cays on reef platforms
  dx = X + 62.0; dz = Z - 117.0;
  if (abs(dx) < 14.0 && abs(dz) < 14.0) {
    float e = sqrt((dx * 0.8 + dz * 0.6) * (dx * 0.8 + dz * 0.6) / 5.0 + (dz * 0.8 - dx * 0.6) * (dz * 0.8 - dx * 0.6) / 1.5) + 0.1 * cw;
    h = max(h, atoll(e, 3.0));
  }
  dx = X + 113.0; dz = Z - 61.0;
  if (abs(dx) < 16.0 && abs(dz) < 16.0) {
    float e = sqrt(dx * dx / 8.5 + dz * dz / 2.4) + 0.1 * cw;
    h = max(h, atoll(e, 3.5));
  }
  dx = X + 99.0; dz = Z - 101.0;
  if (abs(dx) < 10.0 && abs(dz) < 10.0) {
    float e = sqrt(dx * dx / 1.2 + dz * dz / 2.6) + 0.12 * cw;
    h = max(h, atoll(e, 2.5));
  }
  // Mount Ember: volcanic island with a summit crater and a fringing shelf
  dx = X + 150.0; dz = Z - 128.0;
  if (abs(dx) < 30.0 && abs(dz) < 30.0) {
    float d = sqrt(dx * dx + dz * dz) * (1.0 + 0.16 * cw);
    float n = noised(X * 0.33 + 1.7, Z * 0.33 - 4.2) + 0.5 * noised(X * 0.9 - 3.3, Z * 0.9 + 6.1) * bl(1100.0);
    float hi = 1240.0 * exp(-d / 3.0) * (1.0 + 0.35 * n) - 62.0 - 170.0 * exp(-d * d / 0.3) - 3500.0 * ss(10.0, 22.0, d);
    h = max(h, hi);
  }
  // Gull Rock, off the Haven coast
  dx = X + 40.0; dz = Z - 31.0;
  if (abs(dx) < 12.0 && abs(dz) < 12.0) {
    float d = sqrt(dx * dx + dz * dz * 1.8) * (1.0 + 0.2 * cw);
    h = max(h, 210.0 * exp(-d / 0.9) - 26.0 - 2500.0 * ss(3.0, 9.0, d));
  }
  // Sound Island, in the bay
  dx = X + 214.0; dz = Z + 72.0;
  if (abs(dx) < 12.0 && abs(dz) < 12.0) {
    float d = sqrt(dx * dx * 1.6 + dz * dz) * (1.0 + 0.2 * cw);
    h = max(h, 190.0 * exp(-d / 1.7) - 24.0 - 400.0 * ss(4.5, 10.0, d));
  }
  return h;
}

float flatten(float h, float x, float z, float ax, float az, float e, float r0, float r1) {
  float dx = x - ax, dz = z - az;
  float d2 = dx * dx + dz * dz;
  if (d2 >= r1 * r1) return h;
  if (d2 <= r0 * r0) return e;
  float t = (sqrt(d2) - r0) / (r1 - r0);
  return e + (h - e) * t * t * (3.0 - 2.0 * t);
}

// Terrain elevation (m MSL) at world (x, z) metres. Also sets gArid, gSpec.
float terrain(float x, float z) {
  float X = x * 0.001, Z = z * 0.001;
  float L1 = noised(x * 0.0000111 + 3.1, z * 0.0000111 - 7.7);      // 90 km climate / province noise
  float l1x = gDx, l1z = gDz;                                        // (its derivatives double as warp fields)
  float L2 = noised(x * 0.000025 - 5.3, z * 0.000025 + 2.4);        // 40 km
  float l2x = gDx, l2z = gDz;
  float cw = coastFbm(x, z);
  gSpec = 0.0; gRivD = 100000.0; gRivW = 0.0;

  // ---- coast field c: kilometres inland (+) / offshore (-) ------------------------------------------------
  float zc = 8.5 + 3.5 * sin(X * 0.021 + 0.6) + 1.5 * sin(X * 0.083 + 2.0) + 15.0 * ss(-226.0, -240.0, X) + 8.0 * ss(60.0, 130.0, X);
  float kbx = X + 260.0, kbz = Z + 60.0;
  float dKB = sqrt(kbx * kbx + kbz * kbz);
  float kbf = 1.0 - 0.9 * exp(-dKB * dKB / 200.0);
  float wig = cw * kbf;
  float cS = zc - Z + wig;                                           // south coast
  float dW = (X + 254.55) * 0.940 - (Z + 61.98) * 0.342;             // the Sound: west shore (runs along hdg 160)
  float dE = -(X + 186.0) * 0.996 - (Z + 60.0) * 0.085;              // east shore
  float dN = Z + 112.0;                                              // head of the bay
  float fb = smin(smin(dW, dE, 8.0), dN, 8.0) + 2.3 * wig + (8.0 * L2 + 5.0 * l2x) * kbf;
  float c = smin(cS, -fb, 3.0);

  // ---- climate ---------------------------------------------------------------------------------------------
  float Zr = Z - 6.0 * sin(X * 0.018) + 9.0 * l1x;
  float Xm = X + 11.0 * l1z;
  float Pn = ss(-135.0, -175.0, Zr);                                 // northern high plateau
  float D = ss(45.0, 105.0, X + 12.0 * L1 + 8.0 * l1z + 0.12 * (Z + 40.0));   // rain-shadow desert
  gArid = clamp(D + 0.45 * Pn * (1.0 - D), 0.0, 1.0);

  float h = 0.0;
  float rough = 0.0;
  if (c > -0.6) {
    // ---- land ---------------------------------------------------------------------------------------------
    float inX = ss(-192.0, -140.0, Xm) * (1.0 - ss(70.0, 125.0, Xm));
    float M = ss(-40.0, -82.0, Zr) * (1.0 - 0.75 * Pn) * inX;        // the alpine range
    float dH = sqrt(X * X + (Z + 3.0) * (Z + 3.0));
    float plainMask = ss(26.0, 62.0, dH);                            // Haven coastal plain stays flat
    float W = ss(11.0, 30.0, -dW);                                   // coast range behind Baywater
    float krx = X - 140.0, krz = Z + 30.0;
    float ku = krx * 0.643 - krz * 0.766, kv = krx * 0.766 + krz * 0.643;
    float dK = sqrt(ku * ku / 2.4 + kv * kv);
    dK += 1.4 * cw * ss(5.0, 10.0, dK);
    float Bk = ss(9.0, 34.0, dK);                                    // Redrock basin
    float Ah = (220.0 + 520.0 * ss(-0.25, 0.45, L2)) * plainMask * (1.0 - D) * ss(7.0, 20.0, dKB);
    float mdx = X - 190.0, mdz = Z + 88.0;
    float Ms = D * (1.0 - ss(26.0, 60.0, sqrt(mdx * mdx + mdz * mdz) + 14.0 * L2)) * (1.0 - M);   // mesa country
    float A = 25.0 + 2650.0 * M + Ah * (1.0 - M) + 900.0 * W + D * (1.0 - M) * (650.0 + 1250.0 * ss(-0.2, 0.4, L1)) * Bk * (1.0 - 0.8 * Ms);
    float U = 1450.0 * M * sqrt(M) + 1000.0 * Pn * (1.0 - 0.4 * M) + 740.0 * D * (1.0 - 0.5 * Pn) + 120.0 * W + 60.0 * plainMask + 330.0 * Ms;
    float fade = ss(0.0, 10.0, c);

    // rivers (km polylines, meandered by a low-frequency warp)
    float mw = noised(x * 0.00031 + 9.1, z * 0.00031 + 4.4);
    float rX = X + 0.55 * mw, rZ = Z + 0.55 * gDx * 0.6;
    if (rX > -4.0 && rX < 24.0 && rZ > -60.0 && rZ < 22.0) {
      seg(rX, rZ, 1.645, -56.69, 4.06, -51.15, 55.0);
      seg(rX, rZ, 4.06, -51.15, 8.5, -41.0, 55.0);
      seg(rX, rZ, 8.5, -41.0, 13.5, -29.0, 55.0);
      seg(rX, rZ, 13.5, -29.0, 12.2, -18.0, 55.0);
      seg(rX, rZ, 12.2, -18.0, 14.8, -8.0, 55.0);
      seg(rX, rZ, 14.8, -8.0, 13.2, 1.0, 55.0);
      seg(rX, rZ, 13.2, 1.0, 15.2, 8.0, 60.0);
      seg(rX, rZ, 15.2, 8.0, 14.4, 17.0, 60.0);
    }
    if (rX > -212.0 && rX < -160.0 && rZ > -142.0 && rZ < -106.0) {
      seg(rX, rZ, -166.0, -138.0, -180.0, -127.0, 45.0);
      seg(rX, rZ, -180.0, -127.0, -195.0, -121.0, 45.0);
      seg(rX, rZ, -195.0, -121.0, -205.5, -109.0, 50.0);
    }
    if (rX > -112.0 && rX < -80.0 && rZ > -52.0 && rZ < 18.0) {
      seg(rX, rZ, -93.0, -48.0, -90.0, -31.0, 40.0);
      seg(rX, rZ, -90.0, -31.0, -99.0, -16.0, 40.0);
      seg(rX, rZ, -99.0, -16.0, -95.5, -1.0, 40.0);
      seg(rX, rZ, -95.5, -1.0, -100.0, 14.0, 45.0);
    }
    // Pinecrest valley frame: s along heading 150 (toward SSE), t across (toward ENE); the valley river
    float vx = X + 20.0, vz = Z + 95.0;
    float vs = vx * 0.5 + vz * 0.866, vt = vx * 0.866 - vz * 0.5;
    float inV = (abs(vs) < 62.0 && abs(vt) < 18.0) ? 1.0 : 0.0;
    float tt = 0.0, wf = 1.0;
    if (inV > 0.5) {
      tt = vt - 1.5 * sin(vs * 0.11 + 0.4) * ss(4.0, 14.0, abs(vs));
      wf = 1.4 + 1.6 * exp(-vs * vs / 40.0);
      if (vs > -24.0 && vs < 50.5) {
        float k = exp(-vs * vs / 30.0);
        float tr = 3.1 * k + (1.0 - k) * 0.5 * wf * sin(vs * 0.45);
        float dr = abs(tt - tr) * 1000.0 + 4000.0 * ss(-14.0, -24.0, vs) + 4000.0 * ss(45.0, 50.5, vs);
        if (dr < gRivD) { gRivD = dr; gRivW = 17.0; }
      }
    }
    float corridor = exp(-gRivD * gRivD / 1100000.0);                 // relief is subdued along river corridors

    // relief: alpine / hill country uses 16 km massifs; basin-and-range country uses longer wavelengths squeezed
    // east-west (ranges trend north-south). The two styles cross-fade over the rain-shadow transition.
    float Dm = ss(50.0, 100.0, X);
    float B = 0.0, sx = 0.0, sz = 0.0;
    if (Dm < 0.999) { B = mount(x, z, 0.0000625); sx = gMx; sz = gMz; }
    if (Dm > 0.001) {
      float Bd = mount(x * 2.3 + 51000.0, z, 0.0000385);
      B = mix(B, Bd, Dm); sx = mix(sx, gMx * 2.3, Dm); sz = mix(sz, gMz, Dm);
    }
    sx *= A; sz *= A;
    // desert basins fill with alluvium: flat floors, dry lakes at the lowest points
    float b0 = 0.17 * D;
    float fill = b0 - B;
    if (b0 > 0.001) B = smax(B, b0, 0.07);
    float basin = ss(-0.02, 0.07, fill) * D;
    float sl = sqrt(sx * sx + sz * sz) * (1.0 - basin);
    rough = ss(0.06, 0.5, sl);
    float relief = A * B;
    if (A > 100.0 && sl > 0.004 && gLod < 3000.0) {
      relief += (dissect(x, z, sx, sz, 0.0003125, 0.5) - 0.55) * ss(0.004, 0.05, sl) * min(A - 100.0, 2600.0) * 0.16;
    }
    relief *= 1.0 - 0.92 * corridor;
    h = 8.0 * (1.0 - exp(-max(c, 0.0) / 0.5)) + 36.0 * (1.0 - exp(-max(c, 0.0) / 80.0)) + fade * (U + relief);

    // red-rock mesa country: a tilted plateau dissected by a dendritic canyon system with benched walls
    if (Ms > 0.002) {
      float es = dissect(x + 31000.0, z - 7000.0, 0.02 + 0.10 * l2x + 0.3 * sx, 0.03 + 0.10 * l2z + 0.3 * sz, 0.000125, 0.36);
      float q = 3.0 * ss(0.12, -0.42, es);
      float fq = q - floor(q);
      // each tier: a talus apron below a cliff band, then a narrow bench (resistant layer over a soft one)
      h -= 140.0 * (floor(q) + 0.45 * ss(0.0, 0.62, fq) + 0.55 * ss(0.60, 0.80, fq)) * Ms * fade;
      rough = max(rough, Ms * ss(0.2, -0.3, es) * 0.7);
    }
    // Redrock dry lake: dead flat playa at 702 m
    float wP = 1.0 - ss(8.5, 26.0, dK);
    if (wP > 0.0) { h = mix(h, 702.0, wP); rough *= 1.0 - wP; }
    gSpec = -max(basin * ss(0.03, 0.11, fill), ss(0.55, 1.0, wP)) * fade;
    // dune fields on the gentle floors of the desert basins: transverse ridges (the wind is westerly, crest lines run
    // roughly north-south) about 260 m apart with smaller dunes riding on them. The surface shader reads the dune
    // mask from gArid > 1.
    if (D > 0.8 && gLod < 300.0) {
      float dm = ss(0.8, 0.97, D) * ss(0.10, 0.035, sl) * ss(-0.62, -0.22, fill) * (1.0 + gSpec) * (1.0 - Ms) * fade;
      if (dm > 0.001) {
        dm *= ss(-0.22, 0.12, noised(x * 0.00006 + 21.3, z * 0.00006 - 13.1));
        float dwv = noised(x * 0.0011 + 3.7, z * 0.0011 + 9.2);
        float du = x * 0.0038 + 1.6 * dwv, dv = z * 0.0013 + 0.8 * gDx;
        float d1 = noised(du, dv);
        float r1 = 1.0 - 1.25 * sqrt(d1 * d1 + 0.004);
        float d2 = noised(du * 3.1 + 5.0, dv * 3.1 - 2.0);
        float r2 = 1.0 - 1.25 * sqrt(d2 * d2 + 0.004);
        h += dm * (13.0 * mix(0.55, r1, bl(260.0)) + 2.6 * mix(0.55, r2, bl(85.0)) * (0.5 + 0.5 * r1));
        gArid = 1.0 + dm;
      }
    }

    // Pinecrest: a glacial trough through the range, pass to the NNW, draining SSE to the Haven plain
    if (inV > 0.5) {
      float q = abs(vs);
      float zf = vs > 0.0 ? 1650.0 - 21.0 * vs : 1650.0 + 9.0 * q - 31.0 * (q - 28.0) * ss(24.0, 34.0, q);
      float wv = (1.0 - ss(wf, wf + 4.2, abs(tt) + 1.1 * mw * ss(1.2, 3.2, abs(tt)))) * (1.0 - ss(38.0, 58.0, q));
      float fl = zf + (45.0 * min(tt * tt / (wf * wf), 4.0) + 14.0 * mw + 9.0 * L2) * (1.0 - exp(-vs * vs / 40.0));
      h = mix(h, fl, wv);
      rough *= 1.0 - 0.8 * wv;
    }
    // river beds: a broad shallow valley and an incised channel that carries water
    if (gRivD < 4000.0) {
      float re = max(7.0, gLod);                                       // band-limited channel edge
      float ch = (1.0 - ss(gRivW - re, gRivW + re, gRivD)) * min(1.0, 2.5 * gRivW / max(gLod, 1.0));
      h -= (5.0 * exp(-gRivD * gRivD / 500000.0) + 1.6 * ch) * ss(0.0, 1.5, c + 1.0);
      gSpec = mix(gSpec, 1.0, ch * ss(-0.4, 0.3, h));
      rough *= 1.0 - ch;
    }
  }
  if (c < 0.6) {
    // ---- sea ----------------------------------------------------------------------------------------------
    float cn = min(c, 0.0);
    float deep = ss(6.0, 40.0, -cS);
    float hs = -12.0 * (1.0 - exp(cn / 0.75)) + 6.0 * max(cn, -8.0) - deep * (2500.0 + 500.0 * L2) + 14.0 * L2 * ss(0.0, 6.0, -cn);
    if (cS < -160.0) {
      // open ocean far from the designed region: sparse volcanic islands and seamounts
      float sn = noised(x * 0.0000143 + 40.3, z * 0.0000143 - 12.9) + 0.35 * noised(x * 0.00006 + 5.0, z * 0.00006 + 5.0);
      hs += ss(0.34, 0.62, sn) * 4200.0 * ss(-160.0, -230.0, cS) * (0.75 + 0.5 * cw);
    }
    float isl = islands(X, Z, cw);
    if (isl > -8000.0) {
      hs = smax(hs, isl, 12.0);
      rough = max(rough, ss(40.0, 300.0, isl) * 0.8);
      gArid *= 1.0 - 0.75 * ss(-6.0, 1.0, isl);
    }
    h = mix(h, hs, ss(0.6, -0.6, c));
  }
  // ---- small-scale relief ---------------------------------------------------------------------------------
  if (gLod < 105.0) {
    float da = (0.5 + 4.5 * rough + 1.0 * min(gArid, 1.0)) * ss(0.0, 2.5, abs(h) + 0.4) * (1.0 - abs(gSpec));
    h += detail(x, z) * da;
  }
  //@AIRPORTS@
  return h;
}
`;
