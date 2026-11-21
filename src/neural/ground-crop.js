// Learned crop canopy reflectance: how a field of cereal, maize, oilseed rape, stubble or long meadow grass reflects
// the sun relative to its look under the sky, as a function of the sun and view directions relative to the drill rows.
//
// Why: a crop is a canopy of stems, leaves and ears standing in rows over the soil, not paint. Looking down-sun every
// visible plant is lit (the hot spot), looking into the sun you see their shaded sides and the shadowed soil; across
// the rows at a low sun the rows shade the soil between them, along the rows you see down the sunlit furrows; a
// ripe cereal's drooping ears and a flowering rape's petals reflect differently again. That is why the same patchwork
// of fields looks different from every side and as the sun moves. Two small MLPs learned it from a plant-level Monte
// Carlo path tracer (tools/neural/ground/crop/trace.py: tapered stems, arching leaves, ears, petals and straw in
// rows over soil and litter, Lambertian reflection and transmission with a cuticle sheen, sun next-event estimation
// and sky escape up to six bounces):
//
//   SUN net  (mu_s, mu_v, sun / view azimuth from the rows, canopy numbers) -> ln BRF (RGB)
//   SKY net  (mu_v, view azimuth from the rows, canopy numbers)            -> ln HDRF under a uniform sky (RGB)
//   canopy numbers (measured on the built canopy, so the shader can name them): height, nadir cover, row contrast,
//   leaf angle, senescence, flower share, soil luminance.
//
// Runtime: the ground shader paints each crop's colour (its look under the sky); this module gives the factor its
// DIRECT SUN light is multiplied by: K = BRF_sun / HDRF_sky (Lambert = 1). It is baked for the current sun elevation
// for eight crop classes (CROP_CLASSES) into one RGBA16F 3-D texture: x = view azimuth relative to the sun (16,
// wrapping), y = mu_v (10), z = class x sun azimuth from the rows folded to [0, 90 deg] (7 per class). rgb = K,
// a = 1. Rebaked one class per frame when the sun moves. Cost in the terrain shader: 1 trilinear fetch on field pixels.
//
// This file is the JS twin of tools/neural/ground/crop/train.py (forward pass checked against exported vectors).
import * as THREE from 'three';
import { CROP_SUN_NET, CROP_SKY_NET, CROP_EVAL, CROP_META } from './ground-crop-weights.js';

export { CROP_EVAL, CROP_META };
export const CROP_CLASSES = ['cereal_young', 'cereal_green', 'cereal_ripe', 'stubble', 'maize', 'rape_flower', 'meadow_long', 'maize_young'];
export const NB = 16, NV = 10, NA = 7, MUV0 = 0.05;
const LUM = [0.2126, 0.7152, 0.0722];

function b64ToF32(b64) {
  let bytes;
  if (typeof atob === 'function') { const s = atob(b64); bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i); }
  else bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
/** Packed weights (per layer W row-major [out][in], then b) -> net with scratch buffers. */
export function decodeCropNet(net) {
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
export function cropForward(net, x) {
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
/** canopy = { H, fc, rowC, ala, sen, flower, soil } -> the 7 encoded canopy inputs, written at x[o..o+6]. */
function canopyFeatures(x, o, c) {
  x[o] = (Math.log(c.H) + 1.2) / 1.2; x[o + 1] = c.fc * 2 - 1; x[o + 2] = c.rowC * 2 - 1; x[o + 3] = c.ala * 4 - 2;
  x[o + 4] = c.sen * 2 - 1; x[o + 5] = c.flower * 4 - 1; x[o + 6] = (Math.log(c.soil) + 2.2) / 0.6;
}
/** Fold azimuths (from the row direction) by the two mirror symmetries of a row field: sun into [0, pi/2]. */
export function foldAz(phs, phv) {
  let s = Math.atan2(Math.sin(phs), Math.cos(phs)), v = phv;
  if (s < 0) { s = -s; v = -v; }
  if (s > Math.PI / 2) { s = Math.PI - s; v = Math.PI - v; }
  return [s, Math.atan2(Math.sin(v), Math.cos(v))];
}
export function cropBRF(net, canopy, mus, phs, muv, phv, out = [0, 0, 0]) {
  const [s, v] = foldAz(phs, phv), x = net.x;
  mus = Math.max(mus, 0.06); muv = Math.max(muv, MUV0);
  x[0] = mus * 2 - 1; x[1] = muv * 2 - 1; x[2] = Math.cos(s); x[3] = Math.sin(s); x[4] = Math.cos(v); x[5] = Math.sin(v); x[6] = Math.cos(v - s);
  canopyFeatures(x, 7, canopy);
  const y = cropForward(net, x);
  out[0] = Math.exp(y[0]); out[1] = Math.exp(y[1]); out[2] = Math.exp(y[2]);
  return out;
}
export function cropHDRF(net, canopy, muv, phv, out = [0, 0, 0]) {
  const x = net.x;
  x[0] = Math.max(muv, MUV0) * 2 - 1; x[1] = Math.cos(2 * phv);
  canopyFeatures(x, 2, canopy);
  const y = cropForward(net, x);
  out[0] = Math.exp(y[0]); out[1] = Math.exp(y[1]); out[2] = Math.exp(y[2]);
  return out;
}

export const GROUND_CROP_GLSL = /* glsl */`
uniform highp sampler3D tCropLUT;
uniform float uCropOn;
// Direct-sun factor of a crop canopy (Lambert = 1): cls = crop class 0..7, row = unit world xz direction along the
// rows, V toward the viewer, L toward the sun (both world space; the field is taken as level).
vec3 cropSunK(float cls, vec2 row, vec3 V, vec3 L) {
  vec2 perp = vec2(-row.y, row.x);
  vec2 s = vec2(dot(L.xz, perp), dot(L.xz, row)), v = vec2(dot(V.xz, perp), dot(V.xz, row));
  // fold by the row field's mirror symmetries: the sun into the first quadrant, the view with it
  v *= vec2(s.x < 0.0 ? -1.0 : 1.0, s.y < 0.0 ? -1.0 : 1.0);
  s = abs(s);
  float as = atan(s.x, s.y + 1.0e-6), av = atan(v.x, v.y + 1.0e-6);
  float muv = clamp(V.y, ${MUV0}, 1.0);
  const float I2PI = 0.15915494;
  float z = (cls * ${NA}.0 + clamp(as / 1.5707963, 0.0, 1.0) * ${(NA - 1).toFixed(1)} + 0.5) / ${(8 * NA).toFixed(1)};
  vec3 uvw = vec3((av - as) * I2PI + ${(0.5 / NB).toFixed(6)}, (muv - ${MUV0}) / ${(1 - MUV0).toFixed(2)} * ${((NV - 1) / NV).toFixed(6)} + ${(0.5 / NV).toFixed(6)}, z);
  return texture(tCropLUT, uvw).rgb;
}
`;

/** Canopy numbers of the runtime classes (measured on the preset canopies by trace.py --presets). */
export function cropClasses() {
  const P = CROP_META.presets || {};
  return CROP_CLASSES.map((k) => P[k] || { H: 0.5, fc: 0.8, rowC: 0.2, ala: 0.45, sen: 0.1, flower: 0, soil: 0.12 });
}

/** Bake class c for sun cosine mus into data (Float32 RGBA, layout [z][y][x]). */
function bakeClass(sunNet, skyNet, data, cls, c, mus) {
  const brf = [0, 0, 0], sky = [0, 0, 0];
  for (let a = 0; a < NA; a++) {
    const as = (Math.PI / 2) * a / (NA - 1);
    for (let i = 0; i < NV; i++) {
      const muv = MUV0 + (1 - MUV0) * i / (NV - 1);
      for (let j = 0; j < NB; j++) {
        const dv = 2 * Math.PI * j / NB;           // view azimuth relative to the sun
        cropBRF(sunNet, cls, mus, as, muv, as + dv, brf);
        cropHDRF(skyNet, cls, muv, as + dv, sky);
        const k = 1 / Math.max(sky[0] * LUM[0] + sky[1] * LUM[1] + sky[2] * LUM[2], 1e-4);
        const o = (((c * NA + a) * NV + i) * NB + j) * 4;
        data[o] = Math.min(brf[0] * k, 8); data[o + 1] = Math.min(brf[1] * k, 8); data[o + 2] = Math.min(brf[2] * k, 8); data[o + 3] = 1;
      }
    }
  }
}

export function createGroundCrop() {
  const t0 = performance.now();
  const sunNet = decodeCropNet(CROP_SUN_NET), skyNet = decodeCropNet(CROP_SKY_NET);
  const classes = cropClasses();
  const size = NB * NV * NA * 8 * 4;
  const data = new Float32Array(size), half = new Uint16Array(size);
  const tex = new THREE.Data3DTexture(half, NB, NV, NA * 8);
  tex.format = THREE.RGBAFormat; tex.type = THREE.HalfFloatType; tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping; tex.unpackAlignment = 1;
  const uniforms = { tCropLUT: { value: tex }, uCropOn: { value: 0 } };
  let bakedMu = -1, pendingMu = -1, next = 0;
  const upload = () => { for (let i = 0; i < size; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]); tex.needsUpdate = true; };
  const api = {
    uniforms, glsl: GROUND_CROP_GLSL, texture: tex, sunNet, skyNet, classes, data,
    bootMs: 0, lastBakeMs: 0,
    /** sunY = sine of the sun elevation. Rebakes when it moved; all at once when `instant`, else one class per frame. */
    update(sunY, instant = false) {
      const mus = Math.min(1, Math.max(0.06, sunY));
      const t = performance.now();
      if (bakedMu < 0 || instant) {
        if (Math.abs(mus - bakedMu) > 1e-4) { for (let c = 0; c < 8; c++) bakeClass(sunNet, skyNet, data, classes[c], c, mus); upload(); bakedMu = mus; pendingMu = -1; uniforms.uCropOn.value = 1; api.lastBakeMs = performance.now() - t; }
        return;
      }
      if (pendingMu < 0 && Math.abs(mus - bakedMu) > 0.008) { pendingMu = mus; next = 0; }
      if (pendingMu >= 0) {
        bakeClass(sunNet, skyNet, data, classes[next], next, pendingMu);
        if (++next >= 8) { upload(); bakedMu = pendingMu; pendingMu = -1; }
        api.lastBakeMs = performance.now() - t;
      }
    },
    dispose() { tex.dispose(); },
  };
  api.bootMs = performance.now() - t0;
  return api;
}
