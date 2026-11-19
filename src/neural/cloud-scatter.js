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
import * as WEIGHTS from './weights.js';
import { decodeModel, mlpForward, cloudPhase } from './mlp.js';
import { createNeuralCloudLight } from './cloud-light.js';

const CLOUD_SCATTER_MODEL = WEIGHTS.CLOUD_SCATTER_MODEL;

export const CLOUD_SCATTER_LUT_SIZE = 32;
const LN_MIN = -30, LN_MAX = 12;

const _nets = {};
/**
 * The decoded network (cached).
 * @param {'dataset'|'thick'} [prior='dataset'] which cloud-population prior the weights were trained with:
 *   'dataset' (default) the training population as generated (median column optical thickness ~5): lowest error
 *             on the held-out clouds, but biased ~40 % dark at the sun-lit tops of optically thick clouds;
 *   'thick'   samples re-weighted by column optical thickness (clip(tauUp + tauDown, 1, 64)): nearly unbiased for
 *             thick cumulus / stratocumulus decks, but over-brightens thin veils and cloud edges (2.5-3.4x).
 * Three features cannot tell a veil from the top of a thick cloud, so one of the two has to be assumed: see
 * INTEGRATION.md, "Accuracy and limits".  The 4-feature model (createNeuralCloudScatter4) removes the ambiguity.
 */
export function getCloudScatterNet(prior = 'dataset') {
  const key = prior === 'thick' && WEIGHTS.CLOUD_SCATTER_MODEL_THICK_PRIOR ? 'thick' : 'dataset';
  if (!_nets[key]) _nets[key] = decodeModel(key === 'thick' ? WEIGHTS.CLOUD_SCATTER_MODEL_THICK_PRIOR : CLOUD_SCATTER_MODEL);
  return _nets[key];
}
/** True if the thick-column-prior variant of the 3-feature network is embedded. */
export function hasThickPriorNet() { return !!WEIGHTS.CLOUD_SCATTER_MODEL_THICK_PRIOR; }

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
export function phaseGLSL(ph) {
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
 * family can do with these inputs; see tools/neural/results/eval.md for how far it is from the reference).  No texture needed.
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
 * @param {'dataset'|'thick'|number} [opts.prior='dataset'] cloud-population prior of the network (see
 *        getCloudScatterNet); a number t in [0,1] blends ln J_ms of the two trained networks at bake time
 *        (0 = dataset, 1 = thick), e.g. 0.5 if cloud tops read too dark against the rest of the scene
 * @returns {{ glsl: string, uniforms: { tCloudScatterLUT: { value: THREE.Data3DTexture } }, texture: THREE.Data3DTexture,
 *            info: object, sample: (tauSun:number, tauUp:number, cosTheta:number) => number, dispose: () => void }}
 */
export function createNeuralCloudScatter(opts = {}) {
  // Round two (default): networks trained on the game's own clouds and features, plus the learned sky / ground
  // ambient (cloudAmbientVis), see cloud-light.js. { version: 1 } builds the round-one network below.
  if ((opts.version ?? 2) >= 2) {
    const m = createNeuralCloudLight(opts);
    return { ...m, texture: m.textures.j, info: { ...m.info, params: m.info.paramsJ + m.info.paramsV } };
  }
  const n = opts.lutSize || CLOUD_SCATTER_LUT_SIZE;
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const t0 = now();
  const blend = !hasThickPriorNet() ? 0
    : typeof opts.prior === 'number' ? Math.min(1, Math.max(0, opts.prior)) : (opts.prior === 'thick' ? 1 : 0);
  const net = getCloudScatterNet(blend === 1 ? 'thick' : 'dataset');
  const lut = bakeScatterLUT(net, n);
  if (blend > 0 && blend < 1) {
    const other = bakeScatterLUT(getCloudScatterNet('thick'), n);
    for (let i = 0; i < lut.data.length; i++) lut.data[i] += blend * (other.data[i] - lut.data[i]);
    lut.ms += other.ms;
  }
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
      prior: blend === 0 ? 'dataset' : blend === 1 ? 'thick' : blend,
      lutSize: n,
      bakeMs: lut.ms,
      buildMs,
      phase: CLOUD_SCATTER_MODEL.phase,
      encoding: enc,
      meta: (blend === 1 ? WEIGHTS.CLOUD_SCATTER_MODEL_THICK_PRIOR : CLOUD_SCATTER_MODEL).meta,
    },
    sample,
    sampleMulti,
    dispose() { texture.dispose(); },
  };
}

// =====================================================================================================================
// Optional 4-feature model:  float cloudSunScatter4(float tauSun, float tauUp, float cosTheta, float tauDown)
//
// Adding tauDown (optical depth from the sample straight DOWN to the cloud base) lets the network tell a thin veil
// from the top of a thick cloud, which the three standard features cannot (see INTEGRATION.md, "Accuracy and limits": the unexplained error
// drops substantially).  A 4-D table would be large, so this model is deployed in factorised form, exactly as the
// network is built:   ln J_ms = bias + sum_r B_r(tauSun, tauUp, tauDown) * A_r(tauSun, cosTheta)
// B lives in RGBA16F 3-D texture(s), A in RGBA16F 2-D texture(s): two fetches per sample for rank 4.
// The main interface is unchanged; use this only if the cloud renderer has a cheap tauDown.
// =====================================================================================================================
let _net4 = null;
/** True if the 4-feature weights are embedded. */
export function hasCloudScatter4() { return !!WEIGHTS.CLOUD_SCATTER_MODEL4; }
export function getCloudScatterNet4() {
  if (!WEIGHTS.CLOUD_SCATTER_MODEL4) throw new Error('cloud-scatter: the 4-feature model is not embedded in weights.js');
  if (!_net4) _net4 = decodeModel(WEIGHTS.CLOUD_SCATTER_MODEL4);
  return _net4;
}

export const CLOUD_SCATTER4_BODY_SIZE = [24, 24, 12];   // tauSun x tauUp x tauDown
export const CLOUD_SCATTER4_ANG_SIZE = [32, 48];         // tauSun x angle

/** Evaluate the two factor networks on their grids. body[(i + n1*(j + n2*k))*R + r], ang[(i + m1*k)*R + r]. */
export function bakeScatterFactors4(net = getCloudScatterNet4(), bodySize = CLOUD_SCATTER4_BODY_SIZE, angSize = CLOUD_SCATTER4_ANG_SIZE) {
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const t0 = now();
  const R = net.rank, enc = net.enc;
  const [n1, n2, n3] = bodySize, [m1, m2] = angSize;
  const logTau = Math.log1p(enc.tauMax), logAng = Math.log1p(2 / enc.t0);
  const x = new Float64Array(4), out = new Float64Array(R);
  const ta = new Float64Array(net.maxWidth), tb = new Float64Array(net.maxWidth);
  const body = new Float32Array(n1 * n2 * n3 * R);
  for (let k = 0; k < n3; k++) {
    const u6 = k / (n3 - 1);
    for (let j = 0; j < n2; j++) {
      const u2 = j / (n2 - 1), tu = Math.expm1(u2 * logTau);
      for (let i = 0; i < n1; i++) {
        const u1 = i / (n1 - 1), ts = Math.expm1(u1 * logTau);
        x[0] = 2 * u1 - 1; x[1] = 2 * u2 - 1; x[2] = 2 * (tu / (tu + ts + enc.ratioEps)) - 1; x[3] = 2 * u6 - 1;
        mlpForward(net.body, x, out, ta, tb);
        body.set(out, (i + n1 * (j + n2 * k)) * R);
      }
    }
  }
  const ang = new Float32Array(m1 * m2 * R);
  for (let k = 0; k < m2; k++) {
    const u3 = k / (m2 - 1), chord = enc.t0 * Math.expm1(u3 * logAng);
    const c = Math.min(1, Math.max(-1, 1 - 0.5 * chord * chord));
    for (let i = 0; i < m1; i++) {
      x[0] = 2 * (i / (m1 - 1)) - 1; x[1] = 2 * u3 - 1; x[2] = c;
      mlpForward(net.ang, x, out, ta, tb);
      ang.set(out, (i + m1 * k) * R);
    }
  }
  return { body, ang, bodySize, angSize, rank: R, ms: now() - t0 };
}

/**
 * Build the optional 4-feature scatter model.
 * @returns {{ glsl: string, uniforms: object, textures: THREE.Texture[], info: object,
 *            sample: (tauSun:number, tauUp:number, cosTheta:number, tauDown:number) => number, dispose: () => void }}
 */
export function createNeuralCloudScatter4(opts = {}) {
  // Round two folds the column-thickness information into the retrained default model (createNeuralCloudScatter):
  // trained on the march's own features, a tauDown input no longer helps (cross-field error 0.693 vs 0.688), so
  // there is no separate 4-feature model by default. { version: 1 } returns the round-one 4-feature network.
  if ((opts.version ?? 2) >= 2) return null;
  const net = getCloudScatterNet4();
  const model = WEIGHTS.CLOUD_SCATTER_MODEL4;
  const R = net.rank;
  if (R % 4 !== 0) throw new Error('cloud-scatter: 4-feature model rank must be a multiple of 4');
  const T = R / 4;
  const fn = opts.functionName || 'cloudSunScatter4';
  const phaseMax = opts.phaseMax ?? Infinity;
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const t0 = now();
  const f = bakeScatterFactors4(net, opts.bodySize || CLOUD_SCATTER4_BODY_SIZE, opts.angSize || CLOUD_SCATTER4_ANG_SIZE);
  const [n1, n2, n3] = f.bodySize, [m1, m2] = f.angSize;
  const bodyHalf = [], angHalf = [], textures = [], uniforms = {};
  for (let t = 0; t < T; t++) {
    const bh = new Uint16Array(n1 * n2 * n3 * 4), ah = new Uint16Array(m1 * m2 * 4);
    for (let i = 0; i < n1 * n2 * n3; i++) for (let ch = 0; ch < 4; ch++) bh[i * 4 + ch] = THREE.DataUtils.toHalfFloat(f.body[i * R + t * 4 + ch]);
    for (let i = 0; i < m1 * m2; i++) for (let ch = 0; ch < 4; ch++) ah[i * 4 + ch] = THREE.DataUtils.toHalfFloat(f.ang[i * R + t * 4 + ch]);
    const bt = new THREE.Data3DTexture(bh, n1, n2, n3);
    const at = new THREE.DataTexture(ah, m1, m2);
    for (const tex of [bt, at]) {
      tex.format = THREE.RGBAFormat;
      tex.type = THREE.HalfFloatType;
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.NoColorSpace;
      tex.needsUpdate = true;
    }
    bt.wrapR = THREE.ClampToEdgeWrapping;
    bt.name = `cloudScatterBody4_${t}`; at.name = `cloudScatterAng4_${t}`;
    uniforms[`tCloudScatterBody4_${t}`] = { value: bt };
    uniforms[`tCloudScatterAng4_${t}`] = { value: at };
    bodyHalf.push(bh); angHalf.push(ah); textures.push(bt, at);
  }
  const buildMs = now() - t0;
  const enc = net.enc;
  const kTau = 1 / Math.log1p(enc.tauMax), kAng = 1 / Math.log1p(2 / enc.t0);
  let decl = '', sum = '';
  for (let t = 0; t < T; t++) {
    decl += `uniform highp sampler3D tCloudScatterBody4_${t};\nuniform highp sampler2D tCloudScatterAng4_${t};\n`;
    sum += ` + dot(texture(tCloudScatterBody4_${t}, ub), texture(tCloudScatterAng4_${t}, ua))`;
  }
  const glsl = /* glsl */`
// ---- neural cloud scattering, optional 4-feature model (src/neural/cloud-scatter.js): ${model.meta.params} parameters ----
${decl}${phaseGLSL(model.phase)}
float ${fn}Multi(float tauSun, float tauUp, float cosTheta, float tauDown) {
  float x1 = log(1.0 + clamp(tauSun, 0.0, ${glf(enc.tauMax)})) * ${glf(kTau)};
  float x2 = log(1.0 + clamp(tauUp, 0.0, ${glf(enc.tauMax)})) * ${glf(kTau)};
  float x6 = log(1.0 + clamp(tauDown, 0.0, ${glf(enc.tauMax)})) * ${glf(kTau)};
  float x3 = clamp(log(1.0 + sqrt(max(0.0, 2.0 - 2.0 * cosTheta)) * ${glf(1 / enc.t0)}) * ${glf(kAng)}, 0.0, 1.0);
  vec3 ub = vec3(x1, x2, x6) * vec3(${glf((n1 - 1) / n1)}, ${glf((n2 - 1) / n2)}, ${glf((n3 - 1) / n3)}) + vec3(${glf(0.5 / n1)}, ${glf(0.5 / n2)}, ${glf(0.5 / n3)});
  vec2 ua = vec2(x1, x3) * vec2(${glf((m1 - 1) / m1)}, ${glf((m2 - 1) / m2)}) + vec2(${glf(0.5 / m1)}, ${glf(0.5 / m2)});
  return exp(clamp(${glf(net.bias)}${sum}, ${glf(LN_MIN)}, ${glf(LN_MAX)}));
}
// Source function J per unit sun irradiance (sr^-1); tauDown = optical depth straight down to the cloud base.
float ${fn}(float tauSun, float tauUp, float cosTheta, float tauDown) {
  float single = min(cloudScatterPhase(cosTheta), ${glf(phaseMax)}) * exp(-max(tauSun, 0.0));
  return single + ${fn}Multi(tauSun, tauUp, cosTheta, tauDown);
}
`;
  // CPU twin (multilinear interpolation of the half-float factors, then the rank-R contraction)
  const lerpN = (data, dims, coords, stride, ch) => {
    const nd = dims.length;
    let acc = 0;
    const i0 = [], fr = [];
    for (let a = 0; a < nd; a++) {
      const v = Math.min(1, Math.max(0, coords[a])) * (dims[a] - 1);
      i0[a] = Math.min(Math.floor(v), dims[a] - 2); fr[a] = v - i0[a];
    }
    for (let corner = 0; corner < (1 << nd); corner++) {
      let w = 1, idx = 0, mul = 1;
      for (let a = 0; a < nd; a++) {
        const bit = (corner >> a) & 1;
        w *= bit ? fr[a] : 1 - fr[a];
        idx += (i0[a] + bit) * mul; mul *= dims[a];
      }
      acc += w * THREE.DataUtils.fromHalfFloat(data[idx * stride + ch]);
    }
    return acc;
  };
  const sampleMulti = (tauSun, tauUp, cosTheta, tauDown) => {
    const c = Math.min(1, Math.max(-1, cosTheta));
    const x1 = Math.log1p(Math.min(Math.max(tauSun, 0), enc.tauMax)) * kTau;
    const x2 = Math.log1p(Math.min(Math.max(tauUp, 0), enc.tauMax)) * kTau;
    const x6 = Math.log1p(Math.min(Math.max(tauDown, 0), enc.tauMax)) * kTau;
    const x3 = Math.log1p(Math.sqrt(Math.max(0, 2 - 2 * c)) / enc.t0) * kAng;
    let y = net.bias;
    for (let t = 0; t < T; t++) for (let ch = 0; ch < 4; ch++) {
      y += lerpN(bodyHalf[t], [n1, n2, n3], [x1, x2, x6], 4, ch) * lerpN(angHalf[t], [m1, m2], [x1, x3], 4, ch);
    }
    return Math.exp(Math.min(LN_MAX, Math.max(LN_MIN, y)));
  };
  return {
    glsl,
    uniforms,
    textures,
    info: { kind: 'neural-factor-lut-4', params: net.params, rank: R, bodySize: f.bodySize, angSize: f.angSize,
      bakeMs: f.ms, buildMs, meta: model.meta },
    sampleMulti,
    sample: (tauSun, tauUp, cosTheta, tauDown) =>
      Math.min(cloudPhase(cosTheta, net.phase), phaseMax) * Math.exp(-Math.max(tauSun, 0)) + sampleMulti(tauSun, tauUp, cosTheta, tauDown),
    dispose() { for (const t of textures) t.dispose(); },
  };
}
