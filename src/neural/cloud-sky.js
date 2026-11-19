// Neural sky-light visibility inside clouds (ambient occlusion with multiple scattering).
//
//   float cloudSkyVisibility(float tauUp, float tauDown);
//
// V in [0,1]: the fraction of the light of a uniform sky dome (upper hemisphere) that reaches a point inside a
// cloud, including all orders of scattering, averaged over view directions.  Path-traced reference, tiny MLP
// (src/neural/weights-sky.js), baked to a 32x32 R16F texture at boot: one bilinear fetch per sample.
//
// Use in the cloud shader (per ray-march sample), next to the sun term:
//   radiance += uAmbientSky    * cloudSkyVisibility(tauUp, tauDown) * sigma_s * ds * viewTransmittance;
//   radiance += uAmbientGround * cloudSkyVisibility(tauDown, tauUp) * sigma_s * ds * viewTransmittance;  // bounce from below
// (uAmbientSky = sky irradiance / pi = mean sky radiance; the second line reuses the same function upside down.)
//   tauUp   >= 0  optical depth from the sample straight up to the cloud top
//   tauDown >= 0  optical depth from the sample straight down to the cloud base
import * as THREE from 'three';
import { CLOUD_SKY_MODEL } from './weights-sky.js';
import { mlpForward } from './mlp.js';

export const CLOUD_SKY_LUT_SIZE = 32;

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

let _net = null;
/** Decoded sky network: { layers, tauMax, params }. */
export function getCloudSkyNet() {
  if (_net) return _net;
  const f32 = b64ToFloat32(CLOUD_SKY_MODEL.b64);
  const sizes = [2, ...CLOUD_SKY_MODEL.hidden, 1];
  const layers = [];
  let p = 0, maxWidth = 2;
  for (let i = 0; i < sizes.length - 1; i++) {
    const nIn = sizes[i], nOut = sizes[i + 1];
    layers.push({ nIn, nOut, W: Float64Array.from(f32.subarray(p, p + nIn * nOut)), b: Float64Array.from(f32.subarray(p + nIn * nOut, p + nIn * nOut + nOut)) });
    p += nIn * nOut + nOut;
    maxWidth = Math.max(maxWidth, nOut);
  }
  if (p !== f32.length) throw new Error(`cloud sky weights: expected ${p} floats, got ${f32.length}`);
  _net = { layers, tauMax: CLOUD_SKY_MODEL.enc.tauMax, params: p,
    _x: new Float64Array(2), _o: new Float64Array(1), _a: new Float64Array(maxWidth), _b: new Float64Array(maxWidth) };
  return _net;
}

/** Direct network evaluation (JS twin of tools/neural/train_sky.py). */
export function skyVisibility(tauUp, tauDown, net = getCloudSkyNet()) {
  const k = 1 / Math.log1p(net.tauMax);
  net._x[0] = 2 * Math.log1p(Math.min(Math.max(tauUp, 0), net.tauMax)) * k - 1;
  net._x[1] = 2 * Math.log1p(Math.min(Math.max(tauDown, 0), net.tauMax)) * k - 1;
  mlpForward(net.layers, net._x, net._o, net._a, net._b);
  return 1 / (1 + Math.exp(-net._o[0]));
}

/** Analytic fallback: two-stream / diffusion solution of a conservative plane-parallel layer under a uniform sky. */
export function analyticSkyVisibility(tauUp, tauDown) {
  const { g, q } = CLOUD_SKY_MODEL.diffusion;
  const tu = Math.max(tauUp, 0), td = Math.max(tauDown, 0);
  return (td * (1 - g) + q) / ((tu + td) * (1 - g) + 2 * q);
}

const glf = (v) => { let s = Number(v).toPrecision(9); if (!/[.e]/.test(s)) s += '.0'; return s; };

export function analyticSkyVisibilityGLSL(opts = {}) {
  const { g, q } = CLOUD_SKY_MODEL.diffusion;
  const fn = opts.functionName || 'cloudSkyVisibility';
  return /* glsl */`
// ---- analytic sky-light visibility fallback (diffusion solution of a plane-parallel layer) ----
float ${fn}(float tauUp, float tauDown) {
  float tu = max(tauUp, 0.0), td = max(tauDown, 0.0);
  return (td * ${glf(1 - g)} + ${glf(q)}) / ((tu + td) * ${glf(1 - g)} + ${glf(2 * q)});
}
`;
}

export function createAnalyticCloudSkyVisibility(opts = {}) {
  return { glsl: analyticSkyVisibilityGLSL(opts), uniforms: {}, texture: null, info: { kind: 'analytic-diffusion' },
    sample: analyticSkyVisibility, dispose() {} };
}

/**
 * Bake the sky network into a 2-D texture and return the GLSL that samples it.
 * @returns {{ glsl: string, uniforms: { tCloudSkyVisLUT: { value: THREE.DataTexture } }, texture: THREE.DataTexture,
 *            info: object, sample: (tauUp:number, tauDown:number) => number, dispose: () => void }}
 */
export function createNeuralCloudSkyVisibility(opts = {}) {
  const n = opts.lutSize || CLOUD_SKY_LUT_SIZE;
  const fn = opts.functionName || 'cloudSkyVisibility';
  const net = getCloudSkyNet();
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const t0 = now();
  const logTau = Math.log1p(net.tauMax);
  const values = new Float32Array(n * n);          // [i (tauUp) + n * j (tauDown)]
  const half = new Uint16Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = skyVisibility(Math.expm1(i / (n - 1) * logTau), Math.expm1(j / (n - 1) * logTau), net);
    values[i + n * j] = v;
    half[i + n * j] = THREE.DataUtils.toHalfFloat(v);
  }
  const texture = new THREE.DataTexture(half, n, n);
  texture.name = 'cloudSkyVisLUT';
  texture.format = THREE.RedFormat;
  texture.type = THREE.HalfFloatType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  const buildMs = now() - t0;
  const k = 1 / logTau;
  const glsl = /* glsl */`
// ---- neural sky-light visibility (src/neural/cloud-sky.js): ${net.params}-parameter network baked to a ${n}x${n} LUT ----
uniform highp sampler2D tCloudSkyVisLUT;
float ${fn}(float tauUp, float tauDown) {
  vec2 u = log(1.0 + clamp(vec2(tauUp, tauDown), 0.0, ${glf(net.tauMax)})) * ${glf(k)};
  return texture(tCloudSkyVisLUT, u * ${glf((n - 1) / n)} + ${glf(0.5 / n)}).r;
}
`;
  const sample = (tauUp, tauDown) => {
    const f = [tauUp, tauDown].map((t) => Math.min(1, Math.max(0, Math.log1p(Math.min(Math.max(t, 0), net.tauMax)) * k)) * (n - 1));
    const i0 = f.map((v) => Math.min(Math.floor(v), n - 2));
    const fr = f.map((v, a) => v - i0[a]);
    let y = 0;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      y += (a ? fr[0] : 1 - fr[0]) * (b ? fr[1] : 1 - fr[1]) * THREE.DataUtils.fromHalfFloat(half[i0[0] + a + n * (i0[1] + b)]);
    }
    return y;
  };
  return {
    glsl,
    uniforms: { tCloudSkyVisLUT: { value: texture } },
    texture,
    values,
    info: { kind: 'neural-lut', params: net.params, lutSize: n, buildMs, meta: CLOUD_SKY_MODEL.meta },
    sample,
    dispose() { texture.dispose(); },
  };
}
