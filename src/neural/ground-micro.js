// Micro-relief transfer: what the relief a pixel no longer resolves does to its brightness.
//
// Close to the camera the terrain shader shades its detail layers explicitly (normals, self-shadow toward the sun).
// Further away that relief is smaller than a pixel and a plain Lambert term on the smooth normal gets the picture
// wrong in a systematic way: rough ground is brighter looking down-sun and darker looking up-sun, and it darkens
// earlier as the sun gets low (facet foreshortening, cast shadows, masking). A small MLP (4-20-20-1, 541 parameters)
// learned that factor from a height-field simulation (tools/neural/ground/micro/sim.py: periodic Gaussian height
// fields, exact horizon shadows and masking):
//
//     R(cos_s, cos_v, cos_phi, s) = K * cos_s,    K = radiance / radiance of a flat Lambertian surface
//
// cos_s / cos_v = cosines of the sun / view zenith angles about the smooth normal, phi = azimuth between them
// (0 = looking down-sun), s = RMS slope of the unresolved relief. Held-out error and the comparison with Lambert and
// a fitted Oren-Nayar are in GROUND_MICRO_MODEL.eval (RMSE of R: Lambert 0.126, Oren-Nayar 0.059, network 0.014).
// At boot the network is baked into a 16 x 16 x 8 RGBA16F 3-D texture (rgb = K at s = 0.15 / 0.40 / 0.70); the
// terrain shader pays one trilinear fetch. This file is the JS twin of train.py.
import * as THREE from 'three';
import { GROUND_MICRO_MODEL } from './ground-micro-weights.js';

export const MICRO_SLOPES = [0.15, 0.40, 0.70];
const NS = 16, NV = 16, NP = 8, CS0 = 0.04, CV0 = 0.06;

function b64ToBytes(b64) {
  if (typeof atob === 'function') { const s = atob(b64), o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
export function decodeMicroModel(model = GROUND_MICRO_MODEL) {
  const bytes = b64ToBytes(model.b64);
  const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  let p = 0; const layers = [];
  for (let i = 0; i < model.sizes.length - 1; i++) {
    const nIn = model.sizes[i], nOut = model.sizes[i + 1];
    layers.push({ nIn, nOut, W: f.subarray(p, p + nIn * nOut), b: f.subarray(p + nIn * nOut, p + nIn * nOut + nOut) }); p += nIn * nOut + nOut;
  }
  return { layers, a: new Float64Array(32), b: new Float64Array(32) };
}
/** R = K cos_s for sun cosine cs, view cosine cv, cos of the relative azimuth, RMS slope s. */
export function microForward(net, cs, cv, cphi, s) {
  let x = net.a, y = net.b;
  x[0] = cs * 2 - 1; x[1] = cv * 2 - 1; x[2] = cphi; x[3] = s * 2 - 1;
  for (let l = 0; l < net.layers.length; l++) {
    const L = net.layers[l], last = l === net.layers.length - 1;
    for (let o = 0; o < L.nOut; o++) { let v = L.b[o]; for (let i = 0; i < L.nIn; i++) v += L.W[o * L.nIn + i] * x[i]; y[o] = last ? v : Math.tanh(v); }
    const t = x; x = y; y = t;
  }
  return x[0];
}
/** K (ratio to flat Lambert), clamped to a sane range. */
export function microK(net, cs, cv, cphi, s) { return Math.min(3, Math.max(0, microForward(net, cs, cv, cphi, s) / Math.max(cs, 1e-3))); }

/** Float32 RGBA volume NS x NV x NP: rgb = K at MICRO_SLOPES. Axes: cos_s, cos_v (both linear from their minimum), cos_phi. */
export function bakeMicroLUT(net = decodeMicroModel()) {
  const out = new Float32Array(NS * NV * NP * 4);
  for (let k = 0; k < NP; k++) for (let j = 0; j < NV; j++) for (let i = 0; i < NS; i++) {
    const cs = CS0 + (1 - CS0) * i / (NS - 1), cv = CV0 + (1 - CV0) * j / (NV - 1), cp = -1 + 2 * k / (NP - 1), o = ((k * NV + j) * NS + i) * 4;
    for (let c = 0; c < 3; c++) out[o + c] = microK(net, cs, cv, cp, MICRO_SLOPES[c]);
    out[o + 3] = 1;
  }
  return { data: out, size: [NS, NV, NP] };
}
/** CPU twin of the GLSL lookup (trilinear in the baked volume, piecewise linear in the slope). */
export function sampleMicroLUT(lut, cs, cv, cphi, s) {
  const fx = Math.min(NS - 1, Math.max(0, (cs - CS0) / (1 - CS0) * (NS - 1))), fy = Math.min(NV - 1, Math.max(0, (cv - CV0) / (1 - CV0) * (NV - 1))), fz = Math.min(NP - 1, Math.max(0, (cphi + 1) * 0.5 * (NP - 1)));
  const x0 = Math.min(NS - 2, Math.floor(fx)), y0 = Math.min(NV - 2, Math.floor(fy)), z0 = Math.min(NP - 2, Math.floor(fz));
  const k = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let v = 0;
    for (let d = 0; d < 8; d++) {
      const dx = d & 1, dy = (d >> 1) & 1, dz = d >> 2;
      v += lut.data[(((z0 + dz) * NV + y0 + dy) * NS + x0 + dx) * 4 + c] * (dx ? fx - x0 : 1 - fx + x0) * (dy ? fy - y0 : 1 - fy + y0) * (dz ? fz - z0 : 1 - fz + z0);
    }
    k[c] = v;
  }
  const [s0, s1, s2] = MICRO_SLOPES;
  if (s < s0) return 1 + (k[0] - 1) * s / s0;
  const a = Math.min(1, (s - s0) / (s1 - s0)), b = Math.min(1, Math.max(0, (s - s1) / (s2 - s1)));
  return (k[0] + (k[1] - k[0]) * a) * (1 - b) + k[2] * b;
}

export const GROUND_MICRO_GLSL = /* glsl */`
uniform highp sampler3D tTerrMicro;
// Direct-light factor (relative to Lambert on the smooth normal n) of relief of RMS slope sig that the pixel does not
// resolve. V toward the viewer, L toward the sun.
float terrMicroK(vec3 n, vec3 V, vec3 L, float sig) {
  float cs = dot(n, L), cvr = dot(n, V);
  if (cs <= 0.0) return 1.0;
  vec3 lt = L - n * cs, vt = V - n * cvr;
  float cphi = dot(lt, vt) / max(length(lt) * length(vt), 1.0e-4);
  vec3 uvw = vec3((cs - ${CS0}) / ${(1 - CS0).toFixed(2)}, (max(cvr, ${CV0}) - ${CV0}) / ${(1 - CV0).toFixed(2)}, cphi * 0.5 + 0.5);
  uvw = clamp(uvw, 0.0, 1.0) * (vec3(${NS - 1}.0, ${NV - 1}.0, ${NP - 1}.0) / vec3(${NS}.0, ${NV}.0, ${NP}.0)) + 0.5 / vec3(${NS}.0, ${NV}.0, ${NP}.0);
  vec3 k = texture(tTerrMicro, uvw).rgb;
  float a = clamp((sig - ${MICRO_SLOPES[0]}) / ${(MICRO_SLOPES[1] - MICRO_SLOPES[0]).toFixed(2)}, 0.0, 1.0), b = clamp((sig - ${MICRO_SLOPES[1]}) / ${(MICRO_SLOPES[2] - MICRO_SLOPES[1]).toFixed(2)}, 0.0, 1.0);
  return sig < ${MICRO_SLOPES[0]} ? mix(1.0, k.r, sig / ${MICRO_SLOPES[0]}) : mix(mix(k.r, k.g, a), k.b, b);
}
`;

export function createGroundMicro() {
  const t0 = performance.now();
  const net = decodeMicroModel(), lut = bakeMicroLUT(net);
  const half = new Uint16Array(lut.data.length);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(lut.data[i]);
  const tex = new THREE.Data3DTexture(half, NS, NV, NP);
  tex.format = THREE.RGBAFormat; tex.type = THREE.HalfFloatType; tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping; tex.unpackAlignment = 1; tex.needsUpdate = true;
  return { texture: tex, uniforms: { tTerrMicro: { value: tex } }, glsl: GROUND_MICRO_GLSL, lut, ms: performance.now() - t0, dispose() { tex.dispose(); } };
}
