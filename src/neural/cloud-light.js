// Round-two neural cloud lighting: sun scattering + sky / ground ambient, trained on the game's own clouds.
//
// Round one (cloud-scatter.js) trained on synthetic clouds with exact optical depths as inputs. The ground-truth
// comparison of round two (tools/neural/gt_*.py: clouds exported from the real density GLSL, path traced, and the
// real-time march ported to numpy) showed that the networks are fed something else in the game: the light march's
// tauSun and, above all, a height-based tauUp that is ~5x the true optical depth to the cloud top (median 10.6 vs
// 1.9 at the lit samples). These networks are trained on exactly the features the march computes, at the samples
// the march actually lights (importance = their weight in the image), on the game's own cumulus shapes:
//
//   J net  (tauSun, tauUp, cosTheta) -> ln J_ms      3 -> 16 -> 16 -> 1, baked into a 32^3 R16F LUT  (1 fetch)
//   V net  (tauUp, tauDown) -> (Vsky, Vground)       2 -> 12 -> 12 -> 2, baked into a 32^2 RG16F LUT (1 fetch)
//
// GLSL (drop-in for the setScatterModel contract, plus the optional ambient hook the march looks for):
//   float cloudSunScatter(float tauSun, float tauUp, float cosTheta);   // J (sr^-1) per unit sun irradiance
//   vec2  cloudAmbientVis(float tauUp, float tauDown);                  // x: source per unit sky radiance (upper
//         hemisphere), y: per unit ground radiance (lower hemisphere); all orders of scattering
// The march then uses  S = E_sun * J + ambUp * V.x + ambDown * V.y  (ambUp / ambDown = mean hemisphere radiances).
import * as THREE from 'three';
import { CLOUD_LIGHT_MODEL } from './weights-light.js';
import { cloudPhase, mlpForward } from './mlp.js';
import { phaseGLSL } from './cloud-scatter.js';

export const CLOUD_LIGHT_LUT_SIZE = 32;
export const CLOUD_AMB_LUT_SIZE = 32;

function b64ToF32(b64) {
  let bytes;
  if (typeof atob === 'function') {
    const s = atob(b64); bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  } else bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
}

/** Plain MLP from { sizes, b64 } (per layer: W row-major [out][in], then b). */
export function decodePlainMLP(m) {
  const f = b64ToF32(m.b64);
  const layers = [];
  let p = 0, maxWidth = 1;
  for (let i = 0; i < m.sizes.length - 1; i++) {
    const nIn = m.sizes[i], nOut = m.sizes[i + 1];
    layers.push({ nIn, nOut, W: Float64Array.from(f.subarray(p, p + nIn * nOut)), b: Float64Array.from(f.subarray(p + nIn * nOut, p + nIn * nOut + nOut)) });
    p += nIn * nOut + nOut; maxWidth = Math.max(maxWidth, nIn, nOut);
  }
  if (p !== f.length) throw new Error(`cloud light weights: expected ${p} floats, got ${f.length}`);
  const params = p;
  return { layers, params, out: new Float64Array(m.sizes[m.sizes.length - 1]), a: new Float64Array(maxWidth), b: new Float64Array(maxWidth) };
}

let _nets = null;
export function getCloudLightNets() {
  if (!_nets) _nets = { j: decodePlainMLP(CLOUD_LIGHT_MODEL.j), v: decodePlainMLP(CLOUD_LIGHT_MODEL.v) };
  return _nets;
}

const ENC = CLOUD_LIGHT_MODEL.enc;
const LOG_TAU = Math.log1p(ENC.tauMax), LOG_ANG = Math.log1p(2 / ENC.t0), LOG_AMB = Math.log1p(ENC.ambTauMax);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
/** LUT / network coordinates in [0,1]. */
export const lightAxes = {
  tau: (t) => Math.log1p(clamp(t, 0, ENC.tauMax)) / LOG_TAU,
  ang: (c) => Math.log1p(Math.sqrt(Math.max(0, 2 - 2 * clamp(c, -1, 1))) / ENC.t0) / LOG_ANG,
  amb: (t) => Math.log1p(clamp(t, 0, ENC.ambTauMax)) / LOG_AMB,
};

const _x = new Float64Array(3);
/** Network outputs (exact, no LUT): ln J_ms and [ln Vsky, ln Vground]. */
export function lightNetJ(tauSun, tauUp, cosTheta) {
  const n = getCloudLightNets().j;
  _x[0] = 2 * lightAxes.tau(tauSun) - 1; _x[1] = 2 * lightAxes.tau(tauUp) - 1; _x[2] = 2 * lightAxes.ang(cosTheta) - 1;
  return mlpForward(n.layers, _x, n.out, n.a, n.b)[0];
}
export function lightNetV(tauUp, tauDown) {
  const n = getCloudLightNets().v;
  _x[0] = 2 * lightAxes.amb(tauUp) - 1; _x[1] = 2 * lightAxes.amb(tauDown) - 1;
  const o = mlpForward(n.layers, _x, n.out, n.a, n.b);
  return [o[0], o[1]];
}

const glf = (v) => { let s = Number(v).toPrecision(9); if (!/[.e]/.test(s)) s += '.0'; return s; };

function tex3D(data, n) {
  const t = new THREE.Data3DTexture(data, n, n, n);
  t.format = THREE.RedFormat; t.type = THREE.HalfFloatType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false; t.unpackAlignment = 1; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
function tex2D(data, n) {
  const t = new THREE.DataTexture(data, n, n, THREE.RGFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false; t.unpackAlignment = 2; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

/**
 * Build the round-two lighting model (bakes both networks, ~5-20 ms).
 * @param {{ phaseMax?: number, lutSize?: number, ambSize?: number }} [opts]  phaseMax clamps the single-scattering
 *   diffraction peak (sr^-1); the networks were trained with the game's value, 20.
 */
export function createNeuralCloudLight(opts = {}) {
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const t0 = now();
  const n = opts.lutSize || CLOUD_LIGHT_LUT_SIZE, na = opts.ambSize || CLOUD_AMB_LUT_SIZE;
  const toH = THREE.DataUtils.toHalfFloat, fromH = THREE.DataUtils.fromHalfFloat;
  // J LUT: [tauSun (x), tauUp (y), angle (z)] node values = ln J_ms
  const jl = new Uint16Array(n * n * n);
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const net = getCloudLightNets().j;
    _x[0] = 2 * i / (n - 1) - 1; _x[1] = 2 * j / (n - 1) - 1; _x[2] = 2 * k / (n - 1) - 1;
    jl[i + n * (j + n * k)] = toH(clamp(mlpForward(net.layers, _x, net.out, net.a, net.b)[0], -30, 12));
  }
  // ambient LUT: [tauUp (x), tauDown (y)] -> (Vsky, Vground), stored linear
  const vl = new Uint16Array(na * na * 2);
  for (let j = 0; j < na; j++) for (let i = 0; i < na; i++) {
    const net = getCloudLightNets().v;
    _x[0] = 2 * i / (na - 1) - 1; _x[1] = 2 * j / (na - 1) - 1;
    const o = mlpForward(net.layers, _x, net.out, net.a, net.b);
    vl[2 * (i + na * j)] = toH(Math.exp(clamp(o[0], -12, 3)));
    vl[2 * (i + na * j) + 1] = toH(Math.exp(clamp(o[1], -12, 3)));
  }
  const texJ = tex3D(jl, n), texV = tex2D(vl, na);
  texJ.name = 'cloudLightJ'; texV.name = 'cloudLightAmb';
  const phaseMax = opts.phaseMax ?? CLOUD_LIGHT_MODEL.meta.pmax ?? Infinity;
  const ph = CLOUD_LIGHT_MODEL.phase;

  const glsl = /* glsl */`
// ---- neural cloud lighting, round two (src/neural/cloud-light.js): J ${getCloudLightNets().j.params} + V ${getCloudLightNets().v.params} parameters ----
uniform highp sampler3D tCloudLightJ;
uniform highp sampler2D tCloudLightAmb;
${phaseGLSL(ph)}
float cloudSunScatterMulti(float tauSun, float tauUp, float cosTheta) {
  vec3 u = vec3(
    log(1.0 + clamp(tauSun, 0.0, ${glf(ENC.tauMax)})) * ${glf(1 / LOG_TAU)},
    log(1.0 + clamp(tauUp, 0.0, ${glf(ENC.tauMax)})) * ${glf(1 / LOG_TAU)},
    log(1.0 + sqrt(max(0.0, 2.0 - 2.0 * cosTheta)) * ${glf(1 / ENC.t0)}) * ${glf(1 / LOG_ANG)});
  u = clamp(u, 0.0, 1.0) * ${glf((n - 1) / n)} + ${glf(0.5 / n)};
  return exp(texture(tCloudLightJ, u).r);
}
float cloudSunScatter(float tauSun, float tauUp, float cosTheta) {
  return min(cloudScatterPhase(cosTheta), ${glf(phaseMax)}) * exp(-max(tauSun, 0.0)) + cloudSunScatterMulti(tauSun, tauUp, cosTheta);
}
vec2 cloudAmbientVis(float tauUp, float tauDown) {
  vec2 u = log(1.0 + clamp(vec2(tauUp, tauDown), 0.0, ${glf(ENC.ambTauMax)})) * ${glf(1 / LOG_AMB)};
  return texture(tCloudLightAmb, u * ${glf((na - 1) / na)} + ${glf(0.5 / na)}).rg;
}
`;
  // CPU twins (same LUTs, same filtering)
  const lerp = (a, b, t) => a + (b - a) * t;
  const sampleMulti = (tauSun, tauUp, cosTheta) => {
    const f = [lightAxes.tau(tauSun), lightAxes.tau(tauUp), lightAxes.ang(cosTheta)].map((v) => v * (n - 1));
    const i0 = f.map((v) => Math.min(Math.floor(v), n - 2)), fr = f.map((v, a) => v - i0[a]);
    let y = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const w = (dx ? fr[0] : 1 - fr[0]) * (dy ? fr[1] : 1 - fr[1]) * (dz ? fr[2] : 1 - fr[2]);
      y += w * fromH(jl[i0[0] + dx + n * (i0[1] + dy + n * (i0[2] + dz))]);
    }
    return Math.exp(y);
  };
  const sample = (tauSun, tauUp, cosTheta) =>
    Math.min(cloudPhase(cosTheta, ph), phaseMax) * Math.exp(-Math.max(tauSun, 0)) + sampleMulti(tauSun, tauUp, cosTheta);
  const sampleAmbient = (tauUp, tauDown) => {
    const x = lightAxes.amb(tauUp) * (na - 1), y = lightAxes.amb(tauDown) * (na - 1);
    const i = Math.min(Math.floor(x), na - 2), j = Math.min(Math.floor(y), na - 2), fx = x - i, fy = y - j;
    const at = (a, b, c) => fromH(vl[2 * (a + na * b) + c]);
    return [0, 1].map((c) => lerp(lerp(at(i, j, c), at(i + 1, j, c), fx), lerp(at(i, j + 1, c), at(i + 1, j + 1, c), fx), fy));
  };
  return {
    glsl,
    uniforms: { tCloudLightJ: { value: texJ }, tCloudLightAmb: { value: texV } },
    textures: { j: texJ, amb: texV },
    info: { kind: 'neural-light-v2', paramsJ: getCloudLightNets().j.params, paramsV: getCloudLightNets().v.params, lutSize: n, ambSize: na,
      buildMs: now() - t0, phaseMax, meta: CLOUD_LIGHT_MODEL.meta },
    sample, sampleMulti, sampleAmbient,
    dispose() { texJ.dispose(); texV.dispose(); },
  };
}
