// Neural air and sun: networks trained on a spectral Monte Carlo path tracer of the atmosphere
// (tools/neural/atmo/), evaluated on the CPU and baked into small textures that the atmosphere passes sample.
//
// 1. Sun network  ln T_rgb(D_R, D_O): band-integrated (30 wavelengths, CIE 1931 -> linear sRGB) transmittance of the
//    Rayleigh and ozone columns along a ray (km of sea-level / peak-density air). Aerosol stays an analytic grey
//    factor exp(-tau_M). Baked once at boot into a 40x40 half-float texture of ln T over D_R in [0, 600] km,
//    D_O in [0, 700] km; the atmosphere's transmittance pass accumulates the columns per texel and writes
//    exp(-tau_M) * exp(lnT) into the PUBLIC transmittance LUT, so every consumer of atmSunIlluminance(), the key light,
//    ctx.env.sunColor and the sun disc get the spectral sun colour through the existing shared uniforms.
// 2. Sky network  (sun elevation, view elevation, azimuth from the sun, camera altitude, aerosol, cos angle to the sun)
//    -> ln R_rgb, ln Cm_rgb. R is the ratio of the reference sky (without the narrow diffraction lobe) to the
//    classic LUT sky's sun-lit part; the sky-view and aerial-perspective passes multiply by it. Cm is the aerosol
//    single-scattering column along the view ray; the composite adds the circumsolar aureole per pixel as
//    phase_peak(cos) * Cm * sun illuminance (sharp, independent of the LUT resolution). Baked on the CPU into two
//    32x32 textures over (azimuth from the sun, elevation above the horizon) whenever the sun, the altitude or the
//    haze change noticeably (~1 ms per bake).
import * as THREE from 'three';
import { ATMO_MODEL } from './atmo-weights.js';
import { mlpForward } from './mlp.js';

export const ATMO_SUN_N = 40;
export const ATMO_SKY_N = 32;
const RG = 6371.0;

function b64ToFloat32(b64) {
  let bytes;
  if (typeof atob === 'function') {
    const s = atob(b64);
    bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  } else {
    bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
}

function decode(m) {
  const f32 = b64ToFloat32(m.b64);
  const layers = [];
  let p = 0, maxWidth = 1;
  for (let i = 0; i < m.sizes.length - 1; i++) {
    const nIn = m.sizes[i], nOut = m.sizes[i + 1];
    layers.push({ nIn, nOut, W: Float64Array.from(f32.subarray(p, p + nIn * nOut)), b: Float64Array.from(f32.subarray(p + nIn * nOut, p + nIn * nOut + nOut)) });
    p += nIn * nOut + nOut;
    maxWidth = Math.max(maxWidth, nOut, nIn);
  }
  if (p !== f32.length) throw new Error(`atmo weights: expected ${p} floats, got ${f32.length}`);
  return { layers, params: p, _a: new Float64Array(maxWidth), _b: new Float64Array(maxWidth), _x: new Float64Array(m.sizes[0]), _o: new Float64Array(m.sizes[m.sizes.length - 1]) };
}

let _nets = null;
/** Decoded networks { sun, sky } (lazy, shared). */
export function getAtmoNets() {
  if (!_nets) _nets = { sun: decode(ATMO_MODEL.sun), sky: decode(ATMO_MODEL.sky) };
  return _nets;
}

/** ln of the band-integrated Rayleigh + ozone transmittance (linear sRGB, normalised to the classic noon sun). */
export function sunLogRGB(DR, DO, out = [0, 0, 0]) {
  const n = getAtmoNets().sun, e = ATMO_MODEL.sun.enc;
  n._x[0] = 2 * Math.min(Math.max(DR, 0), e.drMax) / e.drMax - 1;
  n._x[1] = 2 * Math.min(Math.max(DO, 0), e.doMax) / e.doMax - 1;
  mlpForward(n.layers, n._x, n._o, n._a, n._b);
  out[0] = n._o[0]; out[1] = n._o[1]; out[2] = n._o[2];
  return out;
}

/** Sky network inputs (JS twin of tools/neural/atmo/train_sky.py:encode). Angles in radians, h in km, mie in 1/km. */
export function encodeSky(sunEl, ef, az, hKm, mie, cosg, out) {
  const e = ATMO_MODEL.sky.enc;
  const deg = sunEl * 180 / Math.PI;
  out[0] = 2 * (deg - e.sunLo) / (e.sunHi - e.sunLo) - 1;
  out[1] = 2 * Math.sqrt(Math.min(Math.max(ef, 0), 1)) - 1;
  out[2] = Math.cos(az);
  out[3] = 2 * Math.sqrt(Math.min(Math.max(hKm, 0), e.altMax) / e.altMax) - 1;
  out[4] = 2 * Math.log(Math.min(Math.max(mie, e.mieLo), e.mieHi) / e.mieLo) / Math.log(e.mieHi / e.mieLo) - 1;
  out[5] = cosg;
  return out;
}

/** Raw sky network: [ln R r, g, b, ln Cm r, g, b]. */
export function skyRaw(sunEl, ef, az, hKm, mie, cosg, out = new Float64Array(6)) {
  const n = getAtmoNets().sky;
  encodeSky(sunEl, ef, az, hKm, mie, cosg, n._x);
  mlpForward(n.layers, n._x, out, n._a, n._b);
  return out;
}

/** Narrow diffraction lobe of the aerosol phase function (sr^-1), zero beyond ATMO_MODEL.peak.cutDeg. */
export function phasePeak(cosT) {
  const { w, g, cut } = ATMO_MODEL.peak;
  const d = 1 + g * g - 2 * g * Math.min(Math.max(cosT, -1), 1);
  return w * Math.max((1 - g * g) / (4 * Math.PI * d * Math.sqrt(d)) - cut, 0);
}

/** Weight of the sky correction vs sun elevation (radians): see ATMO_MODEL.skyBlend. */
export function skyBlend(sunEl) {
  const b = ATMO_MODEL.skyBlend, deg = sunEl * 180 / Math.PI;
  const t = (x, a, c) => { const u = Math.min(Math.max((x - a) / (c - a), 0), 1); return u * u * (3 - 2 * u); };
  return (1 - t(deg, b.dayFrom, b.dayTo) * (1 - b.day)) * t(deg, b.nightTo, b.nightFrom);
}

const glf = (v) => { let s = Number(v).toPrecision(9); if (!/[.e]/.test(s)) s += '.0'; return s; };

function halfTexture(data, w, h, name) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  t.name = name;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Sun: bake the network into a 40x40 table of ln T over (D_R, D_O).
 * @returns {{ texture, table: Float32Array, sample(DR, DO, out): out (linear rgb T), uniforms, glsl, buildMs }}
 */
export function createNeuralSun() {
  const t0 = performance.now();
  const n = ATMO_SUN_N, e = ATMO_MODEL.sun.enc;
  const table = new Float32Array(n * n * 3);
  const half = new Uint16Array(n * n * 4);
  const o = [0, 0, 0];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    sunLogRGB(i / (n - 1) * e.drMax, j / (n - 1) * e.doMax, o);
    const k = i + n * j;
    for (let c = 0; c < 3; c++) { table[k * 3 + c] = o[c]; half[k * 4 + c] = THREE.DataUtils.toHalfFloat(o[c]); }
    half[k * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const texture = halfTexture(half, n, n, 'atm.neuralSun');
  // bilinear lookup of the same table (CPU twin of the GPU fetch), returns linear transmittance
  function sample(DR, DO, out) {
    const x = Math.min(Math.max(DR / e.drMax, 0), 1) * (n - 1), y = Math.min(Math.max(DO / e.doMax, 0), 1) * (n - 1);
    const i0 = Math.min(Math.floor(x), n - 2), j0 = Math.min(Math.floor(y), n - 2), fx = x - i0, fy = y - j0;
    for (let c = 0; c < 3; c++) {
      const a = table[(i0 + n * j0) * 3 + c], b = table[(i0 + 1 + n * j0) * 3 + c];
      const d = table[(i0 + n * (j0 + 1)) * 3 + c], f = table[(i0 + 1 + n * (j0 + 1)) * 3 + c];
      o[c] = Math.exp((a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + f * fx) * fy);
    }
    out.x = o[0]; out.y = o[1]; out.z = o[2];
    return out;
  }
  const uniforms = { tAtmSunNet: { value: texture } };
  // used by the transmittance pass: columns (km) -> spectral Rayleigh + ozone transmittance
  const glsl = /* glsl */`
uniform highp sampler2D tAtmSunNet;
vec3 atmNeuralSunT(float dR, float dO) {
  vec2 x = clamp(vec2(dR * ${glf(1 / e.drMax)}, dO * ${glf(1 / e.doMax)}), 0.0, 1.0);
  return exp(texture(tAtmSunNet, (0.5 + x * ${glf(n - 1)}) / ${glf(n)}).rgb);
}
`;
  return { texture, table, sample, uniforms, glsl, buildMs: performance.now() - t0, dispose() { texture.dispose(); } };
}

/**
 * Sky: CPU bake of the correction ratio and the aerosol column for the current sun / altitude / haze.
 * Texture layout (both): x = sqrt(azimuth from the sun / pi), y = sqrt(elevation above the dipped horizon / (pi/2 + dip)).
 * A bake is spread over frames (`rowsPerStep` rows per update call, double-buffered: the textures switch to the new
 * bake when it is complete), so no frame pays for all of it.
 * @returns {{ ratio: DataTexture, column: DataTexture, update(sunEl, hKm, mie, force?): boolean, bake(sunEl, hKm, mie),
 *            ratioData, columnData, lastMs, bakes, pending }}
 */
export function createNeuralSky(opts = {}) {
  const N = ATMO_SKY_N;
  const rowsPerStep = opts.rowsPerStep || 8;
  const ratioHalf = new Uint16Array(N * N * 4), colHalf = new Uint16Array(N * N * 4);
  const ratio = new Float32Array(N * N * 3), column = new Float32Array(N * N * 3);       // last completed bake
  const nRatio = new Float32Array(N * N * 3), nColumn = new Float32Array(N * N * 3);     // bake in progress
  const ratioTex = halfTexture(ratioHalf, N, N, 'atm.neuralSkyRatio');
  const colTex = halfTexture(colHalf, N, N, 'atm.neuralSkyColumn');
  const norm = ATMO_MODEL.skyNorm;
  const lnN = [Math.log(norm[0]), Math.log(norm[1]), Math.log(norm[2])];
  const net = getAtmoNets().sky, L = net.layers;
  const H1 = L[0].nOut;
  const x = new Float64Array(6), z1c = new Float64Array(H1), z1r = new Float64Array(H1), o6 = new Float64Array(6);
  const want = { sunEl: 1e9, h: -1e9, mie: -1 };       // inputs of the latest requested bake
  const job = { active: false, row: 0, sunEl: 0, h: 0, mie: 0, w: 0, beta: 0, t: 0 };
  const self = { ratio: ratioTex, column: colTex, ratioData: ratio, columnData: column, lastMs: 0, bakes: 0, blend: 0,
    get pending() { return job.active; }, bake, update, dispose };
  const H = THREE.DataUtils.toHalfFloat;

  // layer 1 with the per-bake inputs (sun, altitude, haze) folded into a constant
  function forward(ef, ca, cosg) {
    const W = L[0].W, nIn = L[0].nIn;
    for (let o = 0; o < H1; o++) {
      const z = z1r[o] + W[o * nIn + 2] * ca + W[o * nIn + 5] * cosg;
      net._a[o] = z / Math.sqrt(1 + z * z);
    }
    let src = net._a, dst = net._b;
    for (let l = 1; l < L.length; l++) {
      const { nIn: ni, nOut, W: Wl, b } = L[l];
      const last = l === L.length - 1, out = last ? o6 : dst;
      for (let o = 0, wi = 0; o < nOut; o++) {
        let sum = b[o];
        for (let i = 0; i < ni; i++, wi++) sum += Wl[wi] * src[i];
        out[o] = last ? sum : sum / Math.sqrt(1 + sum * sum);
      }
      if (!last) { const t = src; src = dst; dst = t; }
    }
    return o6;
  }
  function start(sunEl, hKm, mie) {
    job.active = true; job.row = 0; job.sunEl = sunEl; job.h = hKm; job.mie = mie; job.t = 0;
    job.w = skyBlend(sunEl);
    job.beta = Math.acos(RG / (RG + Math.max(hKm, 0)));
    // constant part of layer 1
    encodeSky(sunEl, 0, 0, hKm, mie, 0, x);
    const W = L[0].W, b = L[0].b, nIn = L[0].nIn;
    for (let o = 0; o < H1; o++) z1c[o] = b[o] + W[o * nIn] * x[0] + W[o * nIn + 3] * x[3] + W[o * nIn + 4] * x[4];
  }
  function rows(n) {
    const t0 = performance.now();
    const { w, beta } = job, cs = Math.cos(job.sunEl), ss = Math.sin(job.sunEl);
    const W = L[0].W, nIn = L[0].nIn;
    const end = Math.min(N, job.row + n);
    for (let j = job.row; j < end; j++) {
      const yv = j / (N - 1), ef = yv * yv;
      const el = ef * (Math.PI / 2 + beta) - beta, ce = Math.cos(el), se = Math.sin(el);
      const xe = 2 * Math.sqrt(ef) - 1;
      for (let o = 0; o < H1; o++) z1r[o] = z1c[o] + W[o * nIn + 1] * xe;
      for (let i = 0; i < N; i++) {
        const xv = i / (N - 1), az = Math.PI * xv * xv, ca = Math.cos(az);
        const cosg = ce * cs * ca + se * ss;
        const k = (i + N * j) * 3;
        if (w > 0) {
          forward(ef, ca, cosg);
          for (let c = 0; c < 3; c++) { nRatio[k + c] = Math.exp(w * (o6[c] - lnN[c])); nColumn[k + c] = Math.min(Math.exp(o6[3 + c]), 60000); }
        } else {
          for (let c = 0; c < 3; c++) { nRatio[k + c] = 1; nColumn[k + c] = 0; }
        }
      }
    }
    job.row = end;
    job.t += performance.now() - t0;
    if (job.row >= N) finish();
  }
  function finish() {
    ratio.set(nRatio); column.set(nColumn);
    for (let k = 0; k < N * N; k++) {
      for (let c = 0; c < 3; c++) { ratioHalf[k * 4 + c] = H(ratio[k * 3 + c]); colHalf[k * 4 + c] = H(column[k * 3 + c]); }
      ratioHalf[k * 4 + 3] = 15360; colHalf[k * 4 + 3] = 15360;
    }
    ratioTex.needsUpdate = true; colTex.needsUpdate = true;
    job.active = false;
    self.blend = job.w;
    self.bakes++;
    self.lastMs = job.t;
  }
  /** Synchronous full bake. */
  function bake(sunEl, hKm, mie) {
    want.sunEl = sunEl; want.h = hKm; want.mie = mie;
    start(sunEl, hKm, mie);
    rows(N);
  }
  /** Call once per frame. Starts a new bake when the inputs moved enough to matter, then advances the current one.
   * Returns true when a bake completed during this call. */
  function update(sunEl, hKm, mie, force = false) {
    const dS = Math.abs(sunEl - want.sunEl) * 180 / Math.PI;
    const thrS = sunEl < 0.3 ? 0.05 : 0.25;                       // degrees; finer at low sun where things change fast
    const dH = Math.abs(hKm - want.h), thrH = Math.max(0.03, 0.03 * hKm);
    const dM = Math.abs(mie - want.mie) / Math.max(mie, 1e-6);
    const first = self.bakes === 0 && !job.active;
    if (force || first || dS > thrS || dH > thrH || dM > 0.01) {
      want.sunEl = sunEl; want.h = hKm; want.mie = mie;
      start(sunEl, hKm, mie);
      if (force || first) { rows(N); return true; }
    }
    if (!job.active) return false;
    const before = self.bakes;
    rows(rowsPerStep);
    return self.bakes !== before;
  }
  function dispose() { ratioTex.dispose(); colTex.dispose(); }
  return self;
}

// GLSL (needs uAtmView, uSunDir, uAtmSunIllum from the atmosphere API chunk).
//   part 'model' (atmosphere LUT passes): vec3 atmNeuralSkyRatio(vec3 dir)    tAtmNeuralSky rgb: sky correction ratio
//   part 'sky'   (composite, sky pixels): vec3 atmAureole(vec3 dir)           tAtmNeuralAur rgb: aerosol column
//   uAtmNeural   x: 1 when the neural sky is on, y: aureole on, zw: unused
// Kept out of the public atmosphere API chunk so its consumers' sampler count does not change.
export function neuralSkyGLSL(part = 'model') {
  const p = ATMO_MODEL.peak, N = ATMO_SKY_N;
  const common = /* glsl */`
#ifndef SKYWARD_ATM_NEURAL_COMMON
#define SKYWARD_ATM_NEURAL_COMMON
uniform vec4 uAtmNeural;
vec2 atmNeuralUV(vec3 dir) {
  float beta = uAtmView.x;
  float ef = clamp((asin(clamp(dir.y, -1.0, 1.0)) + beta) / (1.5707963 + beta), 0.0, 1.0);
  vec2 hs = uSunDir.xz, hd = dir.xz;
  float ls = dot(hs, hs), ld = dot(hd, hd);
  float ca = (ls > 1e-8 && ld > 1e-8) ? clamp(dot(hs, hd) * inversesqrt(ls * ld), -1.0, 1.0) : 1.0;
  return (0.5 + vec2(sqrt(acos(ca) * 0.31830989), sqrt(ef)) * ${glf(N - 1)}) / ${glf(N)};
}
#endif
`;
  if (part === 'model') return common + /* glsl */`
uniform highp sampler2D tAtmNeuralSky;
vec3 atmNeuralSkyRatio(vec3 dir) { return uAtmNeural.x > 0.5 ? texture(tAtmNeuralSky, atmNeuralUV(dir)).rgb : vec3(1.0); }
`;
  return common + /* glsl */`
uniform highp sampler2D tAtmNeuralAur;
// narrow diffraction lobe of the aerosol phase function, zero beyond ${p.cutDeg} deg
float atmPhasePeak(float c) {
  float d = ${glf(1 + p.g * p.g)} - ${glf(2 * p.g)} * c;
  return ${glf(p.w)} * max(${glf((1 - p.g * p.g) / (4 * Math.PI))} / (d * sqrt(d)) - ${glf(p.cut)}, 0.0);
}
// circumsolar aureole radiance along dir (sky pixels above the horizon)
vec3 atmAureole(vec3 dir) {
  float c = dot(dir, uSunDir);
  if (uAtmNeural.y < 0.5 || c < ${glf(Math.cos(p.cutDeg * Math.PI / 180))}) return vec3(0.0);
  return uAtmSunIllum * atmPhasePeak(c) * texture(tAtmNeuralAur, atmNeuralUV(dir)).rgb;
}
`;
}
