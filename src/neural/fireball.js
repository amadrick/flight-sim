// Neural fireball: a compact MLP that reproduces a 3-D buoyant fuel-air fireball simulation.
//
// Offline (tools/neural/fireball/): a Froude-scaled LES of a burning kerosene spray (fuel, oxygen, temperature,
// soot, dilatation from heat release, buoyancy, vorticity confinement, a pool fire on the ground, a boundary-layer
// wind) was run for a grid of wind Froude numbers Fw and impact (spray) Froude numbers Ui; a network was trained to
// map (x, |y|, z, t, Fw, Ui) -> (soot density, temperature excess, burning rate). Units: length D (fireball
// diameter, D = 5.8 m^(1/3) m for m kg of fuel), time t* = sqrt(D / g); +x downwind, +z up, ground at z = 0.
//
// Runtime: the effect bakes the network into a small 3-D texture over a time-dependent box (GPU, one draw per
// slice, FIREBALL_BAKE_GLSL below), whenever the fireball time advanced enough; the ray-marcher only samples it.
// This file holds the JS reference forward pass (twin of tools/neural/fireball/train.py), the GLSL twin and the
// helpers both share (feature encoding, output decoding, bake box). Tests: fireball.test.js.
import { FIREBALL_MODEL } from './fireball-weights.js';

function b64ToBytes(b64) {
  if (typeof atob === 'function') { const s = atob(b64), o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Decode the embedded model: layers [{ nIn, nOut, W (row-major [out][in]), b }]. */
export function decodeFireball(model = FIREBALL_MODEL) {
  const bytes = b64ToBytes(model.b64);
  const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  let p = 0; const layers = [];
  for (let i = 0; i < model.sizes.length - 1; i++) {
    const nIn = model.sizes[i], nOut = model.sizes[i + 1];
    layers.push({ nIn, nOut, W: f.subarray(p, p + nIn * nOut), b: f.subarray(p + nIn * nOut, p + nIn * nOut + nOut) });
    p += nIn * nOut + nOut;
  }
  if (p !== f.length) throw new Error(`fireball weights: expected ${p} floats, got ${f.length}`);
  const w = Math.max(...model.sizes);
  return { model, enc: model.enc, layers, a: new Float64Array(w), b: new Float64Array(w), x: new Float64Array(model.sizes[0]), out: new Float64Array(3) };
}

/** Feature vector (must match train.py:features). x, y, z in units of D (y >= 0 used as |y|), t in t*. */
export function fireballFeatures(enc, x, y, z, t, fw, ui, out) {
  const xn = (x - enc.xc) / enc.xs, yn = Math.abs(y) / enc.ys * 2 - 1, zn = z / enc.zs - 1;
  const tau = Math.log1p(Math.max(t, 0) / enc.t0) / Math.log1p(enc.tMax / enc.t0);
  let k = 0;
  out[k++] = xn; out[k++] = yn; out[k++] = zn;
  for (let f = 1; f <= enc.nFreq; f++) {
    const w = Math.PI * f;
    out[k++] = Math.sin(w * xn); out[k++] = Math.cos(w * xn);
    out[k++] = Math.sin(w * yn); out[k++] = Math.cos(w * yn);
    out[k++] = Math.sin(w * zn); out[k++] = Math.cos(w * zn);
  }
  const tn = 2 * Math.min(tau, 1) - 1;
  out[k++] = tn;
  for (let f = 1; f <= enc.nFreqT; f++) { out[k++] = Math.sin(Math.PI * f * tn); out[k++] = Math.cos(Math.PI * f * tn); }
  out[k++] = fw / enc.fwS - 1; out[k++] = ui / enc.uiS - 1;
  return out;
}

/** Raw network output (transformed targets) for a feature vector. */
export function fireballForwardRaw(net, x) {
  let src = x, dst = net.a;
  for (let l = 0; l < net.layers.length; l++) {
    const L = net.layers[l], last = l === net.layers.length - 1;
    if (last) dst = net.out;
    for (let o = 0; o < L.nOut; o++) {
      let s = L.b[o];
      for (let i = 0, w = o * L.nIn; i < L.nIn; i++, w++) s += L.W[w] * src[i];
      dst[o] = last ? s : Math.tanh(s);
    }
    src = dst; dst = src === net.a ? net.b : net.a;
  }
  return net.out;
}

/** Decoded fields at a point: { soot (normalised soot density, ~1 = dense smoke), theta (T/T0 - 1), burn (normalised burning rate) }. */
export function fireballEval(net, x, y, z, t, fw, ui, res = {}) {
  const o = fireballForwardRaw(net, fireballFeatures(net.enc, x, y, z, t, fw, ui, net.x));
  const e = net.enc;
  res.soot = Math.max(0, Math.expm1(o[0])) * e.sootK;
  res.theta = Math.max(0, Math.expm1(o[1]));
  res.burn = Math.max(0, Math.expm1(o[2])) * e.burnK;
  return res;
}

/** Bake box at time t (units of D): { x0, x1, y1, z1 } (y is mirrored, so the box spans -y1..y1). */
export function fireballBox(t, fw, out = {}) {
  const B = FIREBALL_MODEL.box, tt = B.t;
  let i = 0; while (i < tt.length - 2 && t > tt[i + 1]) i++;
  const a = Math.min(1, Math.max(0, (t - tt[i]) / (tt[i + 1] - tt[i])));
  const lerp = (arr) => arr[i] + (arr[i + 1] - arr[i]) * a;
  out.x0 = lerp(B.x0) - B.x0w * fw * 0;
  out.x1 = lerp(B.x1) + lerp(B.x1w) * fw;
  out.y1 = lerp(B.y1);
  out.z1 = lerp(B.z1);
  out.x0 = Math.max(out.x0, FIREBALL_MODEL.domain.x0); out.x1 = Math.min(out.x1, FIREBALL_MODEL.domain.x1);
  out.y1 = Math.min(out.y1, FIREBALL_MODEL.domain.y1); out.z1 = Math.min(out.z1, FIREBALL_MODEL.domain.z1);
  return out;
}

/** Pack the weights for the GLSL twin: RGBA32F texture rows = neurons, texels = 4 inputs, last texel .x = bias. */
export function packFireballWeights(net) {
  const width = Math.max(...net.layers.map((L) => Math.ceil(L.nIn / 4))) + 1;
  const rows = net.layers.reduce((s, L) => s + L.nOut, 0);
  const data = new Float32Array(width * rows * 4);
  let r = 0; const rowBase = [];
  for (const L of net.layers) {
    rowBase.push(r);
    for (let o = 0; o < L.nOut; o++, r++) {
      for (let i = 0; i < L.nIn; i++) data[(r * width + (i >> 2)) * 4 + (i & 3)] = L.W[o * L.nIn + i];
      data[(r * width + width - 1) * 4] = L.b[o];
    }
  }
  return { data, width, rows, rowBase };
}

/**
 * GLSL twin: defines `vec3 fireballNet(vec3 p, float t)` (p in units of D, raw transformed outputs) and
 * `vec3 fireballFields(vec3 p, float t)` = decoded (soot, theta, burn). Needs uniforms tFbWeights (highp sampler2D,
 * the packed texture), uFbCond (vec2: Fw, Ui).
 */
export function fireballGLSL(net) {
  const { width, rowBase } = packFireballWeights(net);
  const e = net.enc, sizes = net.model.sizes;
  const nIn4 = Math.ceil(sizes[0] / 4);
  const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  let s = `
uniform highp sampler2D tFbWeights;
uniform vec2 uFbCond;
const float FB_PI = 3.14159265358979;
vec4 fbW(int c, int r) { return texelFetch(tFbWeights, ivec2(c, r), 0); }
vec3 fireballNet(vec3 p, float t) {
  float xn = (p.x - ${f(e.xc)}) / ${f(e.xs)}, yn = abs(p.y) / ${f(e.ys)} * 2.0 - 1.0, zn = p.z / ${f(e.zs)} - 1.0;
  float tau = log(1.0 + max(t, 0.0) / ${f(e.t0)}) / log(1.0 + ${f(e.tMax)} / ${f(e.t0)});
  float tn = 2.0 * min(tau, 1.0) - 1.0;
  float x[${nIn4 * 4}];
  int k = 0;
  x[k++] = xn; x[k++] = yn; x[k++] = zn;
  for (int fq = 1; fq <= ${e.nFreq}; fq++) {
    float w = FB_PI * float(fq);
    x[k++] = sin(w * xn); x[k++] = cos(w * xn); x[k++] = sin(w * yn); x[k++] = cos(w * yn); x[k++] = sin(w * zn); x[k++] = cos(w * zn);
  }
  x[k++] = tn;
  for (int fq = 1; fq <= ${e.nFreqT}; fq++) { x[k++] = sin(FB_PI * float(fq) * tn); x[k++] = cos(FB_PI * float(fq) * tn); }
  x[k++] = uFbCond.x / ${f(e.fwS)} - 1.0; x[k++] = uFbCond.y / ${f(e.uiS)} - 1.0;
  for (int i = k; i < ${nIn4 * 4}; i++) x[i] = 0.0;
  vec4 h0[${nIn4}];
  for (int i = 0; i < ${nIn4}; i++) h0[i] = vec4(x[4 * i], x[4 * i + 1], x[4 * i + 2], x[4 * i + 3]);
`;
  // hidden layers
  let prev = 'h0', prevN4 = nIn4;
  for (let l = 0; l < sizes.length - 1; l++) {
    const nOut = sizes[l + 1], last = l === sizes.length - 2, base = rowBase[l];
    if (!last) {
      const n4 = Math.ceil(nOut / 4), name = 'h' + (l + 1);
      s += `  vec4 ${name}[${n4}];
  for (int o4 = 0; o4 < ${n4}; o4++) {
    int r = ${base} + 4 * o4;
    vec4 acc = vec4(fbW(${width - 1}, r).x, fbW(${width - 1}, r + 1).x, fbW(${width - 1}, r + 2).x, fbW(${width - 1}, r + 3).x);
    for (int i = 0; i < ${prevN4}; i++) {
      vec4 v = ${prev}[i];
      acc += vec4(dot(fbW(i, r), v), dot(fbW(i, r + 1), v), dot(fbW(i, r + 2), v), dot(fbW(i, r + 3), v));
    }
    ${name}[o4] = tanh(acc);
  }
`;
      prev = name; prevN4 = n4;
    } else {
      s += `  vec3 o = vec3(fbW(${width - 1}, ${base}).x, fbW(${width - 1}, ${base + 1}).x, fbW(${width - 1}, ${base + 2}).x);
  for (int i = 0; i < ${prevN4}; i++) {
    vec4 v = ${prev}[i];
    o += vec3(dot(fbW(i, ${base}), v), dot(fbW(i, ${base + 1}), v), dot(fbW(i, ${base + 2}), v));
  }
  return o;
}
vec3 fireballFields(vec3 p, float t) {
  vec3 o = fireballNet(p, t);
  return max(exp(o) - 1.0, 0.0) * vec3(${f(e.sootK)}, 1.0, ${f(e.burnK)});
}
`;
    }
  }
  return s;
}

export { FIREBALL_MODEL };
