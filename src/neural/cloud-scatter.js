// Neural cloud multiple scattering for the real-time cloud ray-marcher.
//
// A small neural network (src/neural/weights.js, trained offline in tools/neural against a Monte Carlo path
// tracer) predicts the multiple-scattering source function inside sun-lit clouds.  At boot it is evaluated on a
// 32^3 grid and baked into a 3-D half-float texture, so at runtime the network costs ONE trilinear texture fetch
// per cloud sample.  The sharp single-scattering term (Mie-like phase function x Beer-Lambert) is added
// analytically in GLSL, so the LUT only has to hold the smooth part.
//
//   const scatter = createNeuralCloudScatter();
//   clouds.setScatterModel({ glsl: scatter.glsl, uniforms: scatter.uniforms });
//
// GLSL contract (both the neural model and the analytic fallback define it):
//   float cloudSunScatter(float tauSun, float tauUp, float cosTheta);
//     -> J: radiance scattered toward the viewer per unit sun irradiance at the cloud top (sr^-1), single +
//        multiple scattering.  The renderer accumulates  sunIrradiance * J * sigma_s * ds * viewTransmittance.
//     tauSun   >= 0  optical depth from the sample toward the sun
//     tauUp    >= 0  optical depth from the sample straight up to the cloud top
//     cosTheta       cos(angle between sunlight travel direction and the direction toward the viewer); 1 = forward
import * as THREE from 'three';
import { CLOUD_SCATTER_MODEL } from './weights.js';
import { decodeModel, mlpForward, cloudPhase } from './mlp.js';

export const CLOUD_SCATTER_LUT_SIZE = 32;
const LN_MIN = -30, LN_MAX = 12;

let _net = null;
/** The decoded network (cached). */
export function getCloudScatterNet() {
  if (!_net) _net = decodeModel(CLOUD_SCATTER_MODEL);
  return _net;
}

/** LUT axis values: optical depths and cos(theta) at the n grid nodes (inverse of the feature encoding). */
export function lutAxes(n, enc) {
  const tau = new Float64Array(n), cosT = new Float64Array(n), u = new Float64Array(n);
  const logTau = Math.log1p(enc.tauMax), logAng = Math.log1p(2 / enc.t0);
  for (let i = 0; i < n; i++) {
    u[i] = i / (n - 1);
    tau[i] = Math.expm1(u[i] * logTau);
    const chord = enc.t0 * Math.expm1(u[i] * logAng);
    cosT[i] = Math.min(1, Math.max(-1, 1 - 0.5 * chord * chord));
  }
  return { u, tau, cosT };
}

/**
 * Evaluate the network on the n^3 grid.  Thanks to the factorised architecture this is 2 n^2 small-MLP
 * evaluations plus an n^3 rank-R contraction (about 1-3 ms for n = 32).
 * @returns {{ data: Float32Array, size: number, ms: number }} data[i + n*(j + n*k)] = ln J_ms,
 *          i: tauSun axis, j: tauUp axis, k: angle axis.
 */
export function bakeScatterLUT(net = getCloudScatterNet(), n = CLOUD_SCATTER_LUT_SIZE) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const { u, tau, cosT } = lutAxes(n, net.enc);
  const R = net.rank;
  const B = new Float64Array(n * n * R), A = new Float64Array(n * n * R);
  const x = new Float64Array(3), out = new Float64Array(R);
  const ta = new Float64Array(net.maxWidth), tb = new Float64Array(net.maxWidth);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      x[0] = 2 * u[i] - 1; x[1] = 2 * u[j] - 1; x[2] = 2 * (tau[j] / (tau[j] + tau[i] + net.enc.ratioEps)) - 1;
      mlpForward(net.body, x, out, ta, tb);
      B.set(out, (i * n + j) * R);
      x[0] = 2 * u[i] - 1; x[1] = 2 * u[j] - 1; x[2] = cosT[j];
      mlpForward(net.ang, x, out, ta, tb);
      A.set(out, (i * n + j) * R);
    }
  }
  const data = new Float32Array(n * n * n);
  const bias = net.bias;
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      const row = n * (j + n * k);
      for (let i = 0; i < n; i++) {
        const bo = (i * n + j) * R, ao = (i * n + k) * R;
        let y = bias;
        for (let r = 0; r < R; r++) y += B[bo + r] * A[ao + r];
        data[row + i] = y < LN_MIN ? LN_MIN : (y > LN_MAX ? LN_MAX : y);
      }
    }
  }
  return { data, size: n, ms: (typeof performance !== 'undefined' ? performance : Date).now() - t0 };
}

const glf = (v) => {
  if (!Number.isFinite(v)) return '1.0e30';
  let s = Number(v).toPrecision(9);
  if (!/[.e]/.test(s)) s += '.0';
  return s;
};

/** GLSL for the phase function shared by the neural model and the analytic fallback (guarded against redefinition). */
function phaseGLSL(ph) {
  const g1 = ph.gHG, g2 = ph.gD;
  const k1 = (1 - ph.wD) * (1 - g1 * g1) / (4 * Math.PI);
  const k2 = ph.wD * (1 - g2 * g2) / (4 * Math.PI) / (1 + ph.alpha * (1 + 2 * g2 * g2) / 3);
  return /* glsl */`
#ifndef CLOUD_SCATTER_PHASE
#define CLOUD_SCATTER_PHASE
// Cloud-droplet phase function (sr^-1): Jendersie & d'Eon 2023 HG + Draine fit to Mie scattering, d = ${ph.dropletDiameterUm} um.
float cloudScatterPhase(float cosTheta) {
  float m = 1.0 - clamp(cosTheta, -1.0, 1.0);
  float d1 = ${glf((1 - g1) * (1 - g1))} + ${glf(2 * g1)} * m;
  float d2 = ${glf((1 - g2) * (1 - g2))} + ${glf(2 * g2)} * m;
  float c = 1.0 - m;
  return ${glf(k1)} / (d1 * sqrt(d1)) + ${glf(k2)} * (1.0 + ${glf(ph.alpha)} * c * c) / (d2 * sqrt(d2));
}
float cloudScatterHG(float cosTheta, float g) {
  float d = 1.0 + g * g - 2.0 * g * cosTheta;
  return ${glf(1 / (4 * Math.PI))} * (1.0 - g * g) / (d * sqrt(d));
}
#endif
`;
}

/** GLSL of the neural model: LUT fetch for the multiple-scattering part + analytic single scattering. */
export function neuralScatterGLSL(model = CLOUD_SCATTER_MODEL, n = CLOUD_SCATTER_LUT_SIZE, opts = {}) {
  const enc = model.enc;
  const fn = opts.functionName || 'cloudSunScatter';
  const phaseMax = opts.phaseMax ?? Infinity;
  return /* glsl */`
// ---- neural cloud scattering (src/neural/cloud-scatter.js): ${model.meta.params}-parameter network baked to a ${n}^3 LUT ----
uniform highp sampler3D tCloudScatterLUT;
${phaseGLSL(model.phase)}
// Multiple-scattering part of the source function (all orders >= 2), sr^-1 per unit sun irradiance.
float ${fn}Multi(float tauSun, float tauUp, float cosTheta) {
  vec3 u = vec3(
    log(1.0 + clamp(tauSun, 0.0, ${glf(enc.tauMax)})) * ${glf(1 / Math.log1p(enc.tauMax))},
    log(1.0 + clamp(tauUp, 0.0, ${glf(enc.tauMax)})) * ${glf(1 / Math.log1p(enc.tauMax))},
    log(1.0 + sqrt(max(0.0, 2.0 - 2.0 * cosTheta)) * ${glf(1 / enc.t0)}) * ${glf(1 / Math.log1p(2 / enc.t0))});
  u = clamp(u, 0.0, 1.0) * ${glf((n - 1) / n)} + ${glf(0.5 / n)};
  return exp(texture(tCloudScatterLUT, u).r);
}
// Source function J per unit sun irradiance (sr^-1): analytic single scattering + neural multiple scattering.
float ${fn}(float tauSun, float tauUp, float cosTheta) {
  float single = min(cloudScatterPhase(cosTheta), ${glf(phaseMax)}) * exp(-max(tauSun, 0.0));
  return single + ${fn}Multi(tauSun, tauUp, cosTheta);
}
`;
}

/**
 * GLSL of the analytic fallback with the same signature: the Wrenninge / Frostbite "octave" multiple-scattering
 * approximation, with its parameters FITTED to the same path-traced training set (so it is the best that this
 * family can do with these inputs; see REPORT.md for how far it is from the reference).  No texture needed.
 */
export function analyticScatterGLSL(model = CLOUD_SCATTER_MODEL, opts = {}) {
  const o = { ...model.octaves, ...(opts.octaves || {}) };
  const fn = opts.functionName || 'cloudSunScatter';
  const phaseMax = opts.phaseMax ?? Infinity;
  return /* glsl */`
// ---- analytic cloud scattering fallback (src/neural/cloud-scatter.js): fitted multiple-scattering octaves ----
${phaseGLSL(model.phase)}
float ${fn}(float tauSun, float tauUp, float cosTheta) {
  float ts = max(tauSun, 0.0);
  float c = clamp(cosTheta, -1.0, 1.0);
  float j = min(cloudScatterPhase(c), ${glf(phaseMax)}) * exp(-ts);
  float att = 1.0, amp = ${glf(o.gain)}, g = ${glf(o.g)};
  for (int i = 1; i < ${o.n | 0}; i++) {
    att *= ${glf(o.a)}; amp *= ${glf(o.b)}; g *= ${glf(o.c)};
    j += amp * cloudScatterHG(c, g) * exp(-att * ts);
  }
  return j;
}
`;
}

/** JS twin of the analytic fallback (for tests / CPU-side use). */
export function analyticScatterJ(tauSun, tauUp, cosTheta, model = CLOUD_SCATTER_MODEL) {
  const o = model.octaves;
  const ts = Math.max(tauSun, 0), c = Math.min(1, Math.max(-1, cosTheta));
  let j = cloudPhase(c, model.phase) * Math.exp(-ts);
  let att = 1, amp = o.gain, g = o.g;
  for (let i = 1; i < o.n; i++) {
    att *= o.a; amp *= o.b; g *= o.c;
    const d = 1 + g * g - 2 * g * c;
    j += amp * (1 - g * g) / (4 * Math.PI * d * Math.sqrt(d)) * Math.exp(-att * ts);
  }
  return j;
}

/** Analytic fallback packaged like the neural model: `{ glsl, uniforms, texture: null, info }`. */
export function createAnalyticCloudScatter(opts = {}) {
  return {
    glsl: analyticScatterGLSL(CLOUD_SCATTER_MODEL, opts),
    uniforms: {},
    texture: null,
    info: { kind: 'analytic-octaves', octaves: { ...CLOUD_SCATTER_MODEL.octaves, ...(opts.octaves || {}) } },
    sample: (tauSun, tauUp, cosTheta) => analyticScatterJ(tauSun, tauUp, cosTheta),
    dispose() {},
  };
}

/**
 * Build the neural scatter model: bakes the network into a 3-D texture and returns the GLSL that samples it.
 * @param {object} [opts]
 * @param {number} [opts.lutSize=32]      LUT resolution per axis
 * @param {number} [opts.phaseMax=Infinity] optional clamp (sr^-1) of the single-scattering forward peak (~587 sr^-1
 *                                         within ~1 degree of the sun) if the aureole overwhelms bloom
 * @param {string} [opts.functionName='cloudSunScatter']
 * @returns {{ glsl: string, uniforms: { tCloudScatterLUT: { value: THREE.Data3DTexture } }, texture: THREE.Data3DTexture,
 *            info: object, sample: (tauSun:number, tauUp:number, cosTheta:number) => number, dispose: () => void }}
 */
export function createNeuralCloudScatter(opts = {}) {
  const n = opts.lutSize || CLOUD_SCATTER_LUT_SIZE;
  const net = getCloudScatterNet();
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const t0 = now();
  const lut = bakeScatterLUT(net, n);
  const half = new Uint16Array(lut.data.length);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(lut.data[i]);
  const texture = new THREE.Data3DTexture(half, n, n, n);
  texture.name = 'cloudScatterLUT';
  texture.format = THREE.RedFormat;
  texture.type = THREE.HalfFloatType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  const buildMs = now() - t0;

  const enc = net.enc;
  const invLogTau = 1 / Math.log1p(enc.tauMax), invLogAng = 1 / Math.log1p(2 / enc.t0);
  const phaseMax = opts.phaseMax ?? Infinity;
  // CPU twin of the GLSL (same LUT coordinates, trilinear filtering of the half-float values).
  const texel = (i, j, k) => THREE.DataUtils.fromHalfFloat(half[i + n * (j + n * k)]);
  const sampleMulti = (tauSun, tauUp, cosTheta) => {
    const c = Math.min(1, Math.max(-1, cosTheta));
    const f = [
      Math.log1p(Math.min(Math.max(tauSun, 0), enc.tauMax)) * invLogTau,
      Math.log1p(Math.min(Math.max(tauUp, 0), enc.tauMax)) * invLogTau,
      Math.log1p(Math.sqrt(Math.max(0, 2 - 2 * c)) / enc.t0) * invLogAng,
    ].map((v) => Math.min(1, Math.max(0, v)) * (n - 1));
    const i0 = f.map((v) => Math.min(Math.floor(v), n - 2));
    const fr = f.map((v, a) => v - i0[a]);
    let y = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const w = (dx ? fr[0] : 1 - fr[0]) * (dy ? fr[1] : 1 - fr[1]) * (dz ? fr[2] : 1 - fr[2]);
      y += w * texel(i0[0] + dx, i0[1] + dy, i0[2] + dz);
    }
    return Math.exp(y);
  };
  const sample = (tauSun, tauUp, cosTheta) =>
    Math.min(cloudPhase(cosTheta, net.phase), phaseMax) * Math.exp(-Math.max(tauSun, 0)) + sampleMulti(tauSun, tauUp, cosTheta);

  return {
    glsl: neuralScatterGLSL(CLOUD_SCATTER_MODEL, n, opts),
    uniforms: { tCloudScatterLUT: { value: texture } },
    texture,
    info: {
      kind: 'neural-lut',
      params: net.params,
      lutSize: n,
      bakeMs: lut.ms,
      buildMs,
      phase: CLOUD_SCATTER_MODEL.phase,
      encoding: enc,
      meta: CLOUD_SCATTER_MODEL.meta,
    },
    sample,
    sampleMulti,
    dispose() { texture.dispose(); },
  };
}
