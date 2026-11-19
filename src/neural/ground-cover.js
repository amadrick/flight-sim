// Learned land cover: a tiny MLP that predicts what an offline ecosystem simulation (tools/neural/ground/ecosim.py:
// insolation with cast shadows, flow accumulation, soil and scree transport, snow redistribution / avalanching / melt,
// plant competition and succession) produces on the simulator's own terrain, from features the terrain shader can
// read per vertex out of the height clipmap. It replaces the hand-tuned slope / height / noise thresholds that used
// to decide where forest, grass, rock, scree and snow go.
//
//   inputs (16)   height, slope, aspect (2), curvature and concavity at the 16 m "ecological" scale; slope, aspect,
//                 curvature, concavity 4x coarser; height relative to the 8x and 32x coarser (band-limited) surface;
//                 river proximity, aridity, latitude, level of detail
//   outputs (12)  forest canopy, conifer share, shrub, grass, bare rock, scree, late-summer snow, soil moisture,
//                 soil depth, active wash / flood channel, arable land, insolation
//
// The network is LOD-aware: it was trained at clipmap texel spacings from 16 m to 512 m against the simulation
// averaged over the matching footprint, so distant ground converges to the mean cover of what is seen close up.
// The weights are compiled into the shader as constants (no texture, no uniform), which lets any shader that
// includes the chunk (the terrain surface, the 3D tree placement pass) evaluate exactly the same function.
//
// This file is the JS twin of tools/neural/ground/features.py + train.py (`inputs`, `forward`); ground-cover.test.js
// checks it against Python on exported vectors. The GLSL below is generated from the same weights.
import { GROUND_COVER_MODEL } from './ground-weights.js';

export const GROUND_OUTPUTS = ['forest', 'conifer', 'shrub', 'grass', 'rock', 'scree', 'snow', 'wet', 'soil', 'wash', 'arable', 'sun'];
export const GROUND_N_IN = 16;
const CELL = 16, SMAX = 2048;

function b64ToBytes(b64) {
  if (typeof atob === 'function') {
    const s = atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Embedded model -> { sizes, layers: [{ nIn, nOut, W: Float64Array (row-major [out][in]), b }], params } */
export function decodeGroundModel(model = GROUND_COVER_MODEL) {
  const bytes = b64ToBytes(model.b64);
  const f32 = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  let p = 0;
  const take = (n) => { const a = Float64Array.from(f32.subarray(p, p + n)); p += n; return a; };
  const layers = [];
  for (let i = 0; i < model.sizes.length - 1; i++) {
    const nIn = model.sizes[i], nOut = model.sizes[i + 1];
    layers.push({ nIn, nOut, W: take(nIn * nOut), b: take(nOut) });
  }
  if (p !== f32.length) throw new Error(`ground cover weights: expected ${p} floats, got ${f32.length}`);
  const width = Math.max(...model.sizes);
  return { sizes: model.sizes, layers, params: p, _a: new Float64Array(width), _b: new Float64Array(width) };
}

const decodeN = (e) => Math.sign(e) * e * e;

/**
 * Network inputs from the raw clipmap features (see tools/neural/ground/features.py for the layout of `raw`).
 * @param {ArrayLike<number>} raw  14 raw features   @param {number} lod  log2(texel spacing / 16 m), 0..5
 * @param {number} latK  km south of the world origin  @param {Float64Array} out  16 inputs
 */
export function groundInputs(raw, lod, latK, out = new Float64Array(GROUND_N_IN)) {
  lod = Math.min(5, Math.max(0, lod));
  const s = CELL * 2 ** lod, sC = Math.min(8 * s, SMAX), sE = Math.min(32 * s, SMAX);
  const h = raw[0];
  const nx = decodeN(raw[1]), nz = decodeN(raw[2]), ny = Math.sqrt(Math.max(1 - nx * nx - nz * nz, 0.0004));
  const bx = decodeN(raw[5]), bz = decodeN(raw[6]), by = Math.sqrt(Math.max(1 - bx * bx - bz * bz, 0.0004));
  const cl = (v, a, b) => Math.min(b, Math.max(a, v));
  out[0] = h / 1500 - 1;
  out[1] = (1 - ny) * 4 - 1;
  out[2] = nz * 1.5;
  out[3] = nx * 1.5;
  out[4] = raw[3] * 6;
  out[5] = raw[4] * 6;
  out[6] = (1 - by) * 4 - 1;
  out[7] = bz * 1.5;
  out[8] = raw[7] * 6;
  out[9] = raw[8] * 6;
  out[10] = cl((h - raw[9]) / sC * 4, -2, 2);
  out[11] = cl((h - raw[11]) / sE * 4, -2, 2);
  out[12] = cl(raw[10], 0, 1) * 2 - 1;
  out[13] = raw[12] * 2 - 1;
  out[14] = cl(latK, -200, 200) / 100;
  out[15] = lod / 2.5 - 1;
  return out;
}

/** Forward pass: tanh hidden layers, logistic outputs. */
export function groundForward(net, x, out = new Float64Array(net.sizes[net.sizes.length - 1])) {
  let src = x;
  for (let l = 0; l < net.layers.length; l++) {
    const { nIn, nOut, W, b } = net.layers[l];
    const last = l === net.layers.length - 1;
    const dst = last ? out : (src === net._a ? net._b : net._a);
    for (let o = 0, w = 0; o < nOut; o++) {
      let s = b[o];
      for (let i = 0; i < nIn; i++) s += W[w++] * src[i];
      dst[o] = last ? 1 / (1 + Math.exp(-s)) : Math.tanh(s);
    }
    src = dst;
  }
  return out;
}

// ---- GLSL ---------------------------------------------------------------------------------------------------------
const lit = (v) => { let s = String(+Math.fround(v).toPrecision(7)); if (!/[.e]/.test(s)) s += '.0'; return s; };

/** The network as GLSL: void terrEcoNet(vec4 x0..x3, out vec4 oA, oB, oC). All layer widths must be multiples of 4. */
export function groundNetGLSL(net) {
  const lines = [];
  let prev = ['x0', 'x1', 'x2', 'x3'];
  net.layers.forEach((L, li) => {
    if (L.nIn % 4 || L.nOut % 4) throw new Error('ground cover net: layer widths must be multiples of 4');
    const last = li === net.layers.length - 1, cur = [];
    for (let i = 0; i < L.nOut / 4; i++) {
      const terms = [`vec4(${[0, 1, 2, 3].map((r) => lit(L.b[4 * i + r])).join(', ')})`];
      for (let j = 0; j < L.nIn / 4; j++) {
        const m = [];
        for (let k = 0; k < 4; k++) for (let r = 0; r < 4; r++) m.push(lit(L.W[(4 * i + r) * L.nIn + 4 * j + k]));   // column-major
        terms.push(`mat4(${m.join(', ')}) * ${prev[j]}`);
      }
      const name = last ? ['oA', 'oB', 'oC'][i] : `t${li}_${i}`;
      const expr = terms.join('\n      + ');
      lines.push(last ? `  ${name} = 1.0 / (1.0 + exp(-(${expr})));` : `  vec4 ${name} = tanh(${expr});`);
      cur.push(name);
    }
    prev = cur;
  });
  return `void terrEcoNet(vec4 x0, vec4 x1, vec4 x2, vec4 x3, out vec4 oA, out vec4 oB, out vec4 oC) {\n${lines.join('\n')}\n}`;
}

/**
 * GLSL chunk (valid in vertex and fragment shaders: explicit-LOD lookups only) that reads the features from the
 * height clipmap and evaluates the network. Requires clipmapGLSL() from terrain/material.js before it.
 *   TerrEco terrEco(vec2 rxz, float h)     rxz = render-space xz, h = height (m)
 *   a = (forest, conifer, shrub, grass)  b = (rock, scree, snow, wet)  c = (soil, wash, arable, sun)
 * Costs 4 texture fetches (8 inside the LOD morph band).
 */
export function groundEcoGLSL(net = decodeGroundModel()) {
  return /* glsl */`
uniform mediump sampler2DArray tTerrD;
uniform vec3 uOrigin;
vec4 terrTexD(vec2 rxz, float lvl) { vec3 l = uTerrLvl[int(lvl)]; return textureLod(tTerrD, vec3(rxz * l.z + l.xy, lvl), 0.0); }
vec3 terrDecodeN(vec2 enc) {
  vec2 e = enc * 2.0 - 1.0;
  vec3 n; n.xz = sign(e) * e * e; n.y = sqrt(max(1.0 - dot(n.xz, n.xz), 0.0004));
  return n;
}
struct TerrEco { vec4 a; vec4 b; vec4 c; };
${groundNetGLSL(net)}
TerrEco terrEco(vec2 rxz, float h) {
  float tex0 = 1.0 / (uTerrLvl[0].z * float(textureSize(tTerrH, 0).x));       // texel spacing of clipmap level 0
  float le = floor(log2(16.0 / tex0) + 0.5);                                 // the level with 16 m texels
  float d = terrLodDist(rxz), lf = terrLevelAt(d);
  float kb = lf < uTerrLod.z ? terrMorph(d / (uTerrLod.x * exp2(lf))) : 0.0;
  float a = max(lf, le), ka = lf >= le ? kb : 0.0;
  float top = max(min(floor(log2(2048.0 / tex0) + 0.5), uTerrLod.z), a);     // context levels stop at 2048 m texels
  vec4 Da = terrTexD(rxz, a), Db = terrTexD(rxz, min(a + 2.0, top));
  vec4 Hc = terrTexH(rxz, min(a + 3.0, top)), He = terrTexH(rxz, min(a + 5.0, top));
  if (ka > 0.0) {
    float t1 = max(top, min(a + 1.0, uTerrLod.z));
    Da = mix(Da, terrTexD(rxz, min(a + 1.0, uTerrLod.z)), ka); Db = mix(Db, terrTexD(rxz, min(a + 3.0, t1)), ka);
    Hc = mix(Hc, terrTexH(rxz, min(a + 4.0, t1)), ka); He = mix(He, terrTexH(rxz, min(a + 6.0, t1)), ka);
  }
  vec3 na = terrDecodeN(Da.xy), nb = terrDecodeN(Db.xy);
  float lod = clamp(a - le + ka, 0.0, 5.0), s = 16.0 * exp2(lod);
  float sC = min(8.0 * s, 2048.0), sE = min(32.0 * s, 2048.0);
  vec4 x0 = vec4(h / 1500.0 - 1.0, (1.0 - na.y) * 4.0 - 1.0, na.z * 1.5, na.x * 1.5);
  vec4 x1 = vec4((Da.z - 0.5) * 4.8, (Da.w - 0.5) * 4.0, (1.0 - nb.y) * 4.0 - 1.0, nb.z * 1.5);
  vec4 x2 = vec4((Db.z - 0.5) * 4.8, (Db.w - 0.5) * 4.0, clamp((h - Hc.x - Hc.y) / sC * 4.0, -2.0, 2.0), clamp((h - He.x - He.y) / sE * 4.0, -2.0, 2.0));
  vec4 x3 = vec4(clamp(Hc.w, 0.0, 1.0) * 2.0 - 1.0, min(Hc.z, 1.0) * 2.0 - 1.0, clamp((rxz.y + uOrigin.z) * 0.001, -200.0, 200.0) / 100.0, lod / 2.5 - 1.0);
  TerrEco E;
  terrEcoNet(x0, x1, x2, x3, E.a, E.b, E.c);
  return E;
}
`;
}
