// Tiny dependency-free forward pass for the cloud multiple-scattering network.
// This is the JS twin of tools/neural/model.py (`encode`, `ScatterNet.forward`); the node test checks that it
// reproduces the Python outputs on stored test vectors.
//
//   ln J_ms(tauSun, tauUp, cosTheta) = bias + sum_r body_r(x1, x2, x5) * ang_r(x1, x3, x4)
//   x1 = ln(1+tauSun)/ln(1+tauMax)   x2 = ln(1+tauUp)/ln(1+tauMax)   x5 = tauUp/(tauUp+tauSun+eps)
//   x3 = ln(1 + chord/t0)/ln(1 + 2/t0), chord = sqrt(2 (1-cosTheta))   x4 = cosTheta
// Hidden activation: ISRU  f(z) = z / sqrt(1 + z^2).

/** Decode base64 → Uint8Array (works in browsers and node). */
function b64ToBytes(b64) {
  if (typeof atob === 'function') {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * Turn the embedded model description (src/neural/weights.js) into typed arrays.
 * @returns {{ body: Layer[], ang: Layer[], bias: number, rank: number, enc: object, phase: object }}
 *   Layer = { nIn, nOut, W: Float64Array(nOut*nIn) row-major [out][in], b: Float64Array(nOut) }
 */
export function decodeModel(model) {
  const bytes = b64ToBytes(model.b64);
  const f32 = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
  let p = 0;
  const take = (n) => { const a = Float64Array.from(f32.subarray(p, p + n)); p += n; return a; };
  const stack = (sizes) => {
    const layers = [];
    for (let i = 0; i < sizes.length - 1; i++) {
      const nIn = sizes[i], nOut = sizes[i + 1];
      layers.push({ nIn, nOut, W: take(nIn * nOut), b: take(nOut) });
    }
    return layers;
  };
  const sizes = [3, ...model.hidden, model.rank];
  const body = stack(sizes);
  const ang = stack(sizes);
  const bias = take(1)[0];
  if (p !== f32.length) throw new Error(`cloud scatter weights: expected ${p} floats, got ${f32.length}`);
  let maxWidth = 3;
  for (const s of sizes) maxWidth = Math.max(maxWidth, s);
  return { body, ang, bias, rank: model.rank, enc: model.enc, phase: model.phase, params: p, maxWidth,
    _a: new Float64Array(maxWidth), _b: new Float64Array(maxWidth), _ob: new Float64Array(model.rank),
    _oa: new Float64Array(model.rank), _x: new Float64Array(5) };
}

/** Run one MLP stack. `x` holds the inputs; result is written to `out` (length = last layer width). */
export function mlpForward(layers, x, out, tmpA, tmpB) {
  let src = x;
  for (let l = 0; l < layers.length; l++) {
    const { nIn, nOut, W, b } = layers[l];
    const last = l === layers.length - 1;
    const dst = last ? out : (src === tmpA ? tmpB : tmpA);
    for (let o = 0, w = 0; o < nOut; o++) {
      let s = b[o];
      for (let i = 0; i < nIn; i++, w++) s += W[w] * src[i];
      dst[o] = last ? s : s / Math.sqrt(1 + s * s);
    }
    src = dst;
  }
  return out;
}

/** Feature encoding (must match tools/neural/model.py:encode). Writes [x1, x2, x3, x4, x5] to `out`. */
export function encodeFeatures(tauSun, tauUp, cosTheta, enc, out) {
  const ts = Math.min(Math.max(tauSun, 0), enc.tauMax);
  const tu = Math.min(Math.max(tauUp, 0), enc.tauMax);
  const c = Math.min(Math.max(cosTheta, -1), 1);
  const logTau = Math.log1p(enc.tauMax);
  out[0] = Math.log1p(ts) / logTau;
  out[1] = Math.log1p(tu) / logTau;
  out[2] = Math.log1p(Math.sqrt(2 * (1 - c)) / enc.t0) / Math.log1p(2 / enc.t0);
  out[3] = c;
  out[4] = tu / (tu + ts + enc.ratioEps);
  return out;
}

const _in3 = new Float64Array(3);

/** ln J_ms from already encoded features x = [x1..x5]. */
export function logJmsEncoded(net, x) {
  _in3[0] = 2 * x[0] - 1; _in3[1] = 2 * x[1] - 1; _in3[2] = 2 * x[4] - 1;
  mlpForward(net.body, _in3, net._ob, net._a, net._b);
  _in3[0] = 2 * x[0] - 1; _in3[1] = 2 * x[2] - 1; _in3[2] = x[3];
  mlpForward(net.ang, _in3, net._oa, net._a, net._b);
  let y = net.bias;
  for (let r = 0; r < net.rank; r++) y += net._ob[r] * net._oa[r];
  return y;
}

/** Network output: natural log of the multiple-scattering source function J_ms (sr^-1 per unit sun irradiance). */
export function logJms(net, tauSun, tauUp, cosTheta) {
  return logJmsEncoded(net, encodeFeatures(tauSun, tauUp, cosTheta, net.enc, net._x));
}

/** Cloud-droplet phase function (Jendersie & d'Eon HG + Draine Mie fit), sr^-1, normalised to 1 over the sphere. */
export function cloudPhase(cosTheta, ph) {
  const c = Math.min(Math.max(cosTheta, -1), 1);
  const g1 = ph.gHG, g2 = ph.gD;
  const d1 = (1 - g1) * (1 - g1) + 2 * g1 * (1 - c);
  const d2 = (1 - g2) * (1 - g2) + 2 * g2 * (1 - c);
  const hg = (1 - g1 * g1) / (d1 * Math.sqrt(d1));
  const dr = (1 - g2 * g2) / (d2 * Math.sqrt(d2)) * (1 + ph.alpha * c * c) / (1 + ph.alpha * (1 + 2 * g2 * g2) / 3);
  return ((1 - ph.wD) * hg + ph.wD * dr) / (4 * Math.PI);
}

/** Full source function J = single scattering (analytic) + multiple scattering (network), evaluated directly. */
export function scatterJ(net, tauSun, tauUp, cosTheta) {
  return cloudPhase(cosTheta, net.phase) * Math.exp(-Math.max(tauSun, 0)) + Math.exp(logJms(net, tauSun, tauUp, cosTheta));
}
