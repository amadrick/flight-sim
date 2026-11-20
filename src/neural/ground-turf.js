// Learned turf reflectance: how a sward of grass blades reflects sunlight and skylight, as a function of the sun and
// view directions relative to the way the blades lie, how far they are laid over and how tall the grass is.
//
// Why: grass is not a Lambertian green paint. A blade canopy is dark looking into the sun (you see the shaded sides
// and the gaps) and bright looking down-sun (every visible blade is sunlit: the hot spot); upright grass seen from
// above shows the dark soil between the blades; low sun puts a waxy sheen on it; and blades laid over by a mower look
// light when you look along the lay and dark when you look against it - which is what mowing stripes are. None of
// that comes from an albedo map. Two small MLPs learned it from a blade-level Monte Carlo path tracer
// (tools/neural/ground/turf/trace.py: tens of thousands of tapered two-segment blades per square metre in clumps,
// Lambertian reflection and transmission plus a GGX cuticle, thatch and soil below, sun next-event estimation and
// sky escape up to six bounces):
//
//   SUN net  (mu_s, mu_v, sun azimuth and view azimuth from the lay direction, lay, height) -> ln BRF (RGB)
//   SKY net  (mu_v, view azimuth from the lay direction, lay, height)                       -> ln HDRF under a uniform sky
//
// Runtime: only the sun ELEVATION is baked (azimuths are taken relative to the sun in the shader), so the LUT is
// rebuilt only as the sun climbs or sinks, a few slices per frame. Two corner swards are baked: A = mown
// (lay 0.65, 4.5 cm) and B = long (lay 0.18, 13 cm); the terrain blends them. One 3-D texture per corner,
// 12 (mu_v) x 24 (view azimuth - sun azimuth) x 24 (lay azimuth - sun azimuth), RGBA16F:
// rgb = BRF for the sun, a = sky HDRF (green). Cost in the terrain shader: 2 trilinear fetches on turf pixels.
//
// This file is the JS twin of tools/neural/ground/turf/train.py (forward pass checked against exported vectors).
import * as THREE from 'three';
import { TURF_SUN_NET, TURF_SKY_NET, TURF_EVAL, TURF_META } from './ground-turf-weights.js';

export { TURF_EVAL, TURF_META };
export const TURF_CORNERS = [{ lean: 0.65, H: 0.045 }, { lean: 0.18, H: 0.13 }];
export const NV = 12, NA = 24, MUV0 = 0.04;

function b64ToF32(b64) {
  let bytes;
  if (typeof atob === 'function') { const s = atob(b64); bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i); }
  else bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
export function decodeTurfNet(net) {
  const f = b64ToF32(net.b64), layers = [];
  let p = 0;
  for (let i = 0; i < net.sizes.length - 1; i++) {
    const nIn = net.sizes[i], nOut = net.sizes[i + 1];
    layers.push({ nIn, nOut, W: Float64Array.from(f.subarray(p, p + nIn * nOut)), b: Float64Array.from(f.subarray(p + nIn * nOut, p + nIn * nOut + nOut)) });
    p += nIn * nOut + nOut;
  }
  const wmax = Math.max(...net.sizes);
  return { layers, a: new Float64Array(wmax), b: new Float64Array(wmax), x: new Float64Array(net.sizes[0]) };
}
/** Forward pass on encoded inputs x (array); returns the output buffer (reused). tanh hidden layers, linear output. */
export function turfForward(net, x) {
  let src = x, dst = net.a;
  for (let l = 0; l < net.layers.length; l++) {
    const L = net.layers[l], last = l === net.layers.length - 1;
    for (let o = 0; o < L.nOut; o++) {
      let v = L.b[o];
      const row = o * L.nIn;
      for (let i = 0; i < L.nIn; i++) v += L.W[row + i] * src[i];
      dst[o] = last ? v : Math.tanh(v);
    }
    src = dst; dst = dst === net.a ? net.b : net.a;
  }
  return src;
}
export function sunFeatures(x, lean, H, mus, phs, muv, phv) {
  x[0] = mus * 2 - 1; x[1] = muv * 2 - 1; x[2] = Math.cos(phs); x[3] = Math.sin(phs); x[4] = Math.cos(phv); x[5] = Math.sin(phv);
  x[6] = Math.cos(phv - phs); x[7] = lean * 2 - 1; x[8] = (H - 0.08) / 0.05;
  return x;
}
export function skyFeatures(x, lean, H, muv, phv) {
  x[0] = muv * 2 - 1; x[1] = Math.cos(phv); x[2] = lean * 2 - 1; x[3] = (H - 0.08) / 0.05;
  return x;
}
/** BRF (rgb, relative to a white Lambertian plate) for azimuths measured from the lay direction. */
export function turfBRF(net, lean, H, mus, phs, muv, phv, out = [0, 0, 0]) {
  // mirror symmetry: the data cover sun azimuths in [0, pi]
  let s = 1;
  phs = Math.atan2(Math.sin(phs), Math.cos(phs));
  if (phs < 0) { phs = -phs; s = -1; }
  const y = turfForward(net, sunFeatures(net.x, lean, H, Math.max(mus, 0.04), phs, Math.max(muv, MUV0), phv * s));
  out[0] = Math.exp(y[0]); out[1] = Math.exp(y[1]); out[2] = Math.exp(y[2]);
  return out;
}
export function turfHDRF(net, lean, H, muv, phv, out = [0, 0, 0]) {
  const y = turfForward(net, skyFeatures(net.x, lean, H, Math.max(muv, MUV0), phv));
  out[0] = Math.exp(y[0]); out[1] = Math.exp(y[1]); out[2] = Math.exp(y[2]);
  return out;
}

export const GROUND_TURF_GLSL = /* glsl */`
uniform highp sampler3D tTurfA;
uniform highp sampler3D tTurfB;
uniform vec4 uTurfSky;     // rgb = sky HDRF chroma (rgb / g) of the swards, a = 1 when the LUT is valid
// Turf reflectance at a point: rgb = BRF for the sun, a = sky HDRF (green channel). n = ground normal, V toward the
// viewer, L toward the sun, lay = unit world xz direction the blades lie, t = 0 mown .. 1 long sward.
vec4 turfReflectance(vec3 n, vec3 V, vec3 L, vec2 lay, float t) {
  float muv = clamp(dot(n, V), ${MUV0}, 1.0);
  vec2 vh = V.xz, sh = L.xz;
  float as = atan(sh.y, sh.x + 1.0e-6);
  float av = atan(vh.y, vh.x + 1.0e-6) - as, al = atan(lay.y, lay.x) - as;
  const float I2PI = 0.15915494;
  vec3 uvw = vec3((muv - ${MUV0}) / ${(1 - MUV0).toFixed(2)} * ${((NV - 1) / NV).toFixed(6)} + ${(0.5 / NV).toFixed(6)}, av * I2PI + ${(0.5 / NA).toFixed(6)}, al * I2PI + ${(0.5 / NA).toFixed(6)});
  vec4 a = texture(tTurfA, uvw), b = texture(tTurfB, uvw);
  return mix(a, b, clamp(t, 0.0, 1.0));
}
`;

/** White-sky albedo of a sward: the sky HDRF averaged over the viewing hemisphere (cosine weighted). */
export function turfAlbedo(skyNet, lean, H) {
  const acc = [0, 0, 0], t = [0, 0, 0];
  let wsum = 0;
  for (let i = 0; i < 16; i++) for (let j = 0; j < 12; j++) {
    const mu = (i + 0.5) / 16, w = mu;
    turfHDRF(skyNet, lean, H, mu, 2 * Math.PI * j / 12, t);
    for (let c = 0; c < 3; c++) acc[c] += t[c] * w;
    wsum += w;
  }
  return acc.map((a) => a / wsum);
}

/** Bake one azimuth-of-lay slice k of corner c for sun cosine mus into data (Float32, RGBA). */
function bakeSlice(sunNet, skyNet, data, c, k, mus) {
  const { lean, H } = TURF_CORNERS[c];
  const al = 2 * Math.PI * k / NA;                     // lay azimuth relative to the sun
  const rgb = [0, 0, 0], sky = [0, 0, 0];
  for (let j = 0; j < NA; j++) {
    const av = 2 * Math.PI * j / NA;                   // view azimuth relative to the sun
    for (let i = 0; i < NV; i++) {
      const muv = MUV0 + (1 - MUV0) * i / (NV - 1);
      // azimuths from the lay direction: sun at -al, view at av - al
      turfBRF(sunNet, lean, H, mus, -al, muv, av - al, rgb);
      turfHDRF(skyNet, lean, H, muv, av - al, sky);
      const o = ((k * NA + j) * NV + i) * 4;
      data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = sky[1];
    }
  }
}

export function createGroundTurf({ sliceBudget = 6 } = {}) {
  const t0 = performance.now();
  const sunNet = decodeTurfNet(TURF_SUN_NET), skyNet = decodeTurfNet(TURF_SKY_NET);
  const size = NV * NA * NA * 4;
  const data = [new Float32Array(size), new Float32Array(size)];
  const half = [new Uint16Array(size), new Uint16Array(size)];
  const tex = half.map((h) => {
    const t = new THREE.Data3DTexture(h, NV, NA, NA);
    t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType; t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = t.wrapR = THREE.RepeatWrapping; t.unpackAlignment = 1;
    return t;
  });
  // sky chroma of the corners (rgb / g, averaged over view directions; the sky HDRF is nearly grey-scaled green)
  const chroma = [0, 0, 0], tmp = [0, 0, 0];
  let n = 0;
  for (const C of TURF_CORNERS) for (let i = 0; i < 6; i++) { turfHDRF(skyNet, C.lean, C.H, 0.1 + 0.15 * i, i, tmp); chroma[0] += tmp[0] / tmp[1]; chroma[2] += tmp[2] / tmp[1]; n++; }
  const refs = TURF_CORNERS.map((C) => turfAlbedo(skyNet, C.lean, C.H));
  const uniforms = {
    tTurfA: { value: tex[0] }, tTurfB: { value: tex[1] },
    uTurfSky: { value: new THREE.Vector4(chroma[0] / n, 1, chroma[2] / n, 0) },
    uTurfRefA: { value: new THREE.Vector3(...refs[0]) }, uTurfRefB: { value: new THREE.Vector3(...refs[1]) },
  };
  let bakedMu = -1, pendingMu = -1, next = 0;
  const upload = (c) => {
    const d = data[c], h = half[c];
    for (let i = 0; i < size; i++) h[i] = THREE.DataUtils.toHalfFloat(d[i]);
    tex[c].needsUpdate = true;
  };
  function bakeAll(mus) {
    for (let c = 0; c < 2; c++) { for (let k = 0; k < NA; k++) bakeSlice(sunNet, skyNet, data[c], c, k, mus); upload(c); }
    bakedMu = mus; pendingMu = -1; uniforms.uTurfSky.value.w = 1;
  }
  const api = {
    uniforms, glsl: GROUND_TURF_GLSL, textures: tex, sunNet, skyNet,
    bootMs: 0, lastBakeMs: 0,
    /** sunY = sine of the sun elevation. Rebakes when it moved; all at once when `instant`, else a few slices per frame. */
    update(sunY, instant = false) {
      const mus = Math.min(1, Math.max(0.04, sunY));
      if (bakedMu < 0 || instant) { if (Math.abs(mus - bakedMu) > 1e-4) { const t = performance.now(); bakeAll(mus); api.lastBakeMs = performance.now() - t; } return; }
      if (pendingMu < 0 && Math.abs(mus - bakedMu) > 0.006) { pendingMu = mus; next = 0; }
      if (pendingMu >= 0) {
        const t = performance.now();
        for (let s = 0; s < sliceBudget && next < 2 * NA; s++, next++) bakeSlice(sunNet, skyNet, data[next < NA ? 0 : 1], next < NA ? 0 : 1, next % NA, pendingMu);
        if (next >= 2 * NA) { upload(0); upload(1); bakedMu = pendingMu; pendingMu = -1; }
        api.lastBakeMs = performance.now() - t;
      }
    },
    dispose() { tex.forEach((t) => t.dispose()); },
  };
  api.bootMs = performance.now() - t0;
  return api;
}
