// Neural lens flare: ghosts + diffraction starburst + veiling glare of a real camera lens, learned from a physical
// simulation (tools/neural/flare: sequential ray tracing of a 50 mm f/2 double-Gauss stopped to f/4 with MgF2
// coatings and a 6-blade iris, Fraunhofer diffraction of the iris with dust and scratches, Harvey-Shack scatter).
//
// Three small networks (weights in ./flare-weights.js) are evaluated ONCE at boot and baked into two textures:
//   meta  r -> for each of 12 ghosts: centre on the flare axis, iris->ghost magnification (along / across), flux
//   ghost (r, q_al, q_ac) -> RGB image of ghost g in iris coordinates (one network per ghost)
//   star  (r, phi) -> log10 RGB point-spread density around the sun (diffraction (x) sun disc + veil)
// Per pixel the shader does one starburst fetch and, inside each ghost's footprint only, one 3-D fetch per ghost.
// The iris polygon outline of the ghosts is applied analytically (the networks were trained on the circular-iris
// images; see tools/neural/flare/README section in src/neural/INTEGRATION.md).
//
// Frame units: 1 = half the image height, origin at the image centre, +y up.  A point source of irradiance E at
// frame position s puts radiance  L = E * density / tan^2(fov/2)  on the screen, where density is the fraction of
// the collected flux per frame-unit^2 (the screen solid angle of one frame-unit^2 is tan^2(fov/2)).
import * as THREE from 'three';
import { FLARE_MODEL } from './flare-weights.js';
import { mlpForward } from './mlp.js';

export const FLARE_CONSTS = FLARE_MODEL.consts;
const C = FLARE_CONSTS;
export const STAR_TEX = { w: 128, h: 32 };
export const META_LUT_N = 97;
/** Default gains relative to the simulated lens (see createNeuralFlare). */
export const FLARE_GAINS = { ghost: 5, star: 0.5 };

function b64ToF32(b64) {
  let bytes;
  if (typeof atob === 'function') {
    const s = atob(b64);
    bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  } else bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
}

function stackFrom(f32, p, sizes) {
  const layers = [];
  for (let i = 0; i < sizes.length - 1; i++) {
    const nIn = sizes[i], nOut = sizes[i + 1];
    const W = Float64Array.from(f32.subarray(p, p + nIn * nOut)); p += nIn * nOut;
    const b = Float64Array.from(f32.subarray(p, p + nOut)); p += nOut;
    layers.push({ nIn, nOut, W, b });
  }
  return { layers, p };
}

let _net = null;
/** Decode the embedded weights (cached). */
export function getFlareNets() {
  if (_net) return _net;
  const N = FLARE_MODEL.nets;
  const dec = (spec, count = 1) => {
    const f32 = b64ToF32(spec.b64);
    const out = [];
    let p = 0;
    for (let g = 0; g < count; g++) { const s = stackFrom(f32, p, spec.sizes); out.push(s.layers); p = s.p; }
    if (p !== f32.length) throw new Error(`flare weights: expected ${p} floats, got ${f32.length}`);
    return out;
  };
  const meta = dec(N.meta)[0], ghost = dec(N.ghost, N.ghost.G), star = dec(N.star)[0];
  const count = (L) => L.reduce((s, l) => s + l.W.length + l.b.length, 0);
  const width = Math.max(...N.meta.sizes, ...N.ghost.sizes, ...N.star.sizes);
  _net = { meta, ghost, star, G: N.ghost.G, params: { meta: count(meta), ghost: count(ghost[0]) * N.ghost.G, star: count(star) },
    ta: new Float64Array(width), tb: new Float64Array(width) };
  return _net;
}

// ---- encodings (mirror tools/neural/flare/features.py) ------------------------------------------------------------
export function ghostFeatures(r, qa, qc, out) {
  const rho = Math.sqrt(qa * qa + qc * qc);
  out[0] = r / (C.R_MAX / 2) - 1; out[1] = qa / C.QMAX; out[2] = qc / C.QMAX; out[3] = rho / C.QMAX;
  for (let k = 1; k <= 3; k++) { out[2 + 2 * k] = Math.cos(k * Math.PI * rho); out[3 + 2 * k] = Math.sin(k * Math.PI * rho); }
  return out;
}
export function starFeatures(r, phi, out) {
  const t = (Math.log(r) - Math.log(C.STAR_R0)) / Math.log(C.STAR_R1 / C.STAR_R0) * 2 - 1;
  const d = r * Math.sin(phi) / C.STAR_S;
  out[0] = t; out[1] = Math.min(d, 8) / 4 - 1; out[2] = phi / (Math.PI / 6) * 2 - 1; out[3] = Math.exp(-0.5 * d * d); out[4] = t * t;
  return out;
}

/** Ghost placement at sun radius r: Float64Array(G*4) of (c, s_al, s_ac, E) per ghost: centre on the flare axis and
 *  signed ghost-frame scales (frame units; the sign is the iris orientation), flux as a fraction of the collected flux. */
export function evalMeta(r, net = getFlareNets()) {
  const K = 6;
  const x = new Float64Array([r / (C.R_MAX / 2) - 1]), y = new Float64Array(net.G * K), out = new Float64Array(net.G * 4);
  mlpForward(net.meta, x, y, net.ta, net.tb);
  for (let g = 0; g < net.G; g++) {
    const o = K * g;
    out[4 * g] = y[o] * C.R_MAX;
    out[4 * g + 1] = (y[o + 3] >= 0 ? 1 : -1) * Math.exp(y[o + 1]) * C.M_SCALE;
    out[4 * g + 2] = (y[o + 4] >= 0 ? 1 : -1) * Math.exp(y[o + 2]) * C.M_SCALE;
    out[4 * g + 3] = Math.max(10 ** (y[o + 5] - 6) - 1e-10, 0);
  }
  return out;
}

/** Normalised ghost image (pi * density / E) of ghost g, RGB, at iris coordinates (qa, qc) for sun radius r. */
export function evalGhost(g, r, qa, qc, net = getFlareNets(), out = new Float64Array(3), x = new Float64Array(10)) {
  ghostFeatures(r, qa, Math.abs(qc), x);
  mlpForward(net.ghost[g], x, out, net.ta, net.tb);
  out[0] *= out[0]; out[1] *= out[1]; out[2] *= out[2];
  return out;
}

/** log10 RGB starburst + veil density (fraction per frame-unit^2) at distance r from the sun, angle phi from a spike. */
export function evalStar(r, phi, net = getFlareNets(), out = new Float64Array(3), x = new Float64Array(5)) {
  starFeatures(r, phi, x);
  return mlpForward(net.star, x, out, net.ta, net.tb);
}

/** Bake the networks into texture data.  Returns Float32 RGBA arrays + the meta LUT and timings. */
export function bakeFlare(net = getFlareNets()) {
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const t0 = now();
  const G = net.G, NA = C.NQA, NC = C.NQC, NR = C.NR;
  const ghost = new Float32Array(NA * NC * G * NR * 4);
  const x = new Float64Array(10), o = new Float64Array(3);
  for (let g = 0; g < G; g++) {
    for (let k = 0; k < NR; k++) {
      const r = k * C.R_MAX / (NR - 1);
      const z = g * NR + k;
      for (let j = 0; j < NC; j++) {
        const qc = (j + 0.5) * C.QMAX / NC;
        for (let i = 0; i < NA; i++) {
          const qa = -C.QMAX + (i + 0.5) * 2 * C.QMAX / NA;
          evalGhost(g, r, qa, qc, net, o, x);
          const p = 4 * (i + NA * (j + NC * z));
          ghost[p] = o[0]; ghost[p + 1] = o[1]; ghost[p + 2] = o[2]; ghost[p + 3] = 1;
        }
      }
    }
  }
  const t1 = now();
  const { w: SW, h: SH } = STAR_TEX;
  const star = new Float32Array(SW * SH * 4);
  const xs = new Float64Array(5);
  for (let j = 0; j < SH; j++) {
    const v = j / (SH - 1), phi = v * v * Math.PI / 6;
    for (let i = 0; i < SW; i++) {
      const r = C.STAR_R0 * (C.STAR_R1 / C.STAR_R0) ** (i / (SW - 1));
      evalStar(r, phi, net, o, xs);
      const p = 4 * (i + SW * j);
      star[p] = o[0]; star[p + 1] = o[1]; star[p + 2] = o[2]; star[p + 3] = 1;
    }
  }
  const meta = new Float32Array(META_LUT_N * G * 4);
  for (let k = 0; k < META_LUT_N; k++) meta.set(evalMeta(k * C.R_MAX / (META_LUT_N - 1), net), k * G * 4);
  return { ghost, star, meta, ghostMs: t1 - t0, ms: now() - t0 };
}

const glf = (v) => { let s = Number(v).toPrecision(9); if (!/[.e]/.test(s)) s += '.0'; return s; };

/** GLSL of the neural flare (pure function of the constants; needs uTone.w = aspect, uLensSun, uLensColor). */
export function flareGLSL() {
  const G = FLARE_MODEL.nets.ghost.G, NR = C.NR;
  const { w: SW, h: SH } = STAR_TEX;
  return /* glsl */`
// ---- neural lens flare (src/neural/flare.js) ----
uniform highp sampler3D tFlareGhost;   // ${C.NQA} x ${C.NQC} x (${G} ghosts x ${NR} sun radii) RGBA16F: ghost images (pi * density / E)
uniform highp sampler2D tFlareStar;    // ${SW} x ${SH} RGBA16F: log10 starburst + veil density (log r, sqrt(phi / 30 deg))
uniform vec4 uFlareGhost[${G}];        // per ghost: centre on the axis, s_al, s_ac (signed scales, frame units), amplitude E / (pi |s_al s_ac|)
uniform vec4 uFlareParams;             // x: 1 / tan^2(fov / 2), y: mode (1 neural, 0 classic), z: ghost gain, w: sun-radius slice
uniform vec4 uFlareParams2;            // x: starburst gain, y: veil-scale gain (unused), z,w: 0
float flareIris(vec2 q) {              // ${C.BLADES}-blade iris, circumradius 1, soft edge
  float a = atan(q.y, q.x) - ${glf(C.SPIKE0 + Math.PI / C.BLADES)};
  const float seg = ${glf(2 * Math.PI / C.BLADES)};
  a = mod(a, seg) - 0.5 * seg;
  float d = length(q) * cos(a) - ${glf(Math.cos(Math.PI / C.BLADES))};
  return clamp(0.5 - d * 14.0, 0.0, 1.0);
}
vec3 flareStar(vec2 dv) {              // starburst + veil density around the sun
  float rs = max(length(dv), 1e-6);
  float a = mod(atan(dv.y, dv.x) - ${glf(C.SPIKE0)}, ${glf(2 * Math.PI / C.BLADES)});
  float phi = min(a, ${glf(2 * Math.PI / C.BLADES)} - a);
  float tx = clamp(log(rs * ${glf(1 / C.STAR_R0)}) * ${glf(1 / Math.log(C.STAR_R1 / C.STAR_R0))}, 0.0, 1.0);
  float ty = sqrt(clamp(phi * ${glf(6 / Math.PI)}, 0.0, 1.0));
  vec3 l10 = texture(tFlareStar, vec2(tx * ${glf((SW - 1) / SW)} + ${glf(0.5 / SW)}, ty * ${glf((SH - 1) / SH)} + ${glf(0.5 / SH)})).rgb;
  return exp2(l10 * 3.321928095) * (1.0 - smoothstep(${glf(C.STAR_R1 * 0.7)}, ${glf(C.STAR_R1)}, rs));
}
vec3 flareGhosts(vec2 p, vec2 s) {     // sum of the ghost images
  float r = length(s);
  vec2 e = r > 1e-5 ? s / r : vec2(1.0, 0.0), n = vec2(-e.y, e.x);
  vec3 acc = vec3(0.0);
  for (int g = 0; g < ${G}; g++) {
    vec4 G = uFlareGhost[g];
    if (G.w <= 0.0) continue;
    vec2 d = p - G.x * e;
    vec2 q = vec2(dot(d, e) / abs(G.y), dot(d, n) / abs(G.z));
    if (max(abs(q.x), abs(q.y)) >= ${glf(C.QMAX)}) continue;
    vec2 a = q * sign(G.yz);             // iris coordinates (the iris image may be mirrored)
    float iris = flareIris(a.x * e + a.y * n);
    if (iris <= 0.0) continue;
    vec3 tc = vec3(q.x * ${glf(0.5 / C.QMAX)} + 0.5, abs(q.y) * ${glf(1 / C.QMAX)}, (float(g * ${NR}) + uFlareParams.w + 0.5) * ${glf(1 / (G * NR))});
    acc += G.w * iris * texture(tFlareGhost, tc).rgb;
  }
  return acc;
}
// Radiance added by the lens: p, s in frame units (half image height = 1); E = sun irradiance (rgb).
vec3 flareNeural(vec2 p, vec2 s, vec3 E) {
  vec3 dens = uFlareParams2.x * flareStar(p - s) + uFlareParams.z * flareGhosts(p, s);
  return E * dens * uFlareParams.x;
}
`;
}

/**
 * Build the neural flare: bakes the networks into textures (once) and returns the uniforms the GLSL needs plus a
 * per-frame update.
 * @returns {{ glsl: string, uniforms: object, update: (sunX:number, sunY:number, tanHalfFov:number) => void,
 *            info: object, dispose: () => void }}
 */
export function createNeuralFlare(opts = {}) {
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const t0 = now();
  const net = getFlareNets();
  const bake = bakeFlare(net);
  const G = net.G, NR = C.NR;
  const toHalf = (f32) => { const h = new Uint16Array(f32.length); for (let i = 0; i < h.length; i++) h[i] = THREE.DataUtils.toHalfFloat(f32[i]); return h; };
  const ghostTex = new THREE.Data3DTexture(toHalf(bake.ghost), C.NQA, C.NQC, G * NR);
  const starTex = new THREE.DataTexture(toHalf(bake.star), STAR_TEX.w, STAR_TEX.h, THREE.RGBAFormat, THREE.HalfFloatType);
  for (const t of [ghostTex, starTex]) {
    t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false; t.unpackAlignment = 1; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  }
  ghostTex.name = 'flareGhosts'; starTex.name = 'flareStar';
  const ghostU = Array.from({ length: G }, () => new THREE.Vector4());
  const uniforms = {
    tFlareGhost: { value: ghostTex }, tFlareStar: { value: starTex },
    uFlareGhost: { value: ghostU },
    uFlareParams: { value: new THREE.Vector4(3, 1, 1, 0) },
    uFlareParams2: { value: new THREE.Vector4(1, 1, 0, 0) },
  };
  // Taste on top of the physics (the only hand-set numbers in the flare): ghost and starburst gains relative to the
  // simulated lens.  1 = exactly the simulated f/4 double-Gauss with single-layer MgF2 coatings.
  const baseGhost = opts.ghostGain ?? FLARE_GAINS.ghost, baseStar = opts.starGain ?? FLARE_GAINS.star;
  const meta = bake.meta;
  const hexComp = C.HEX_COMP;
  /** Per frame: sun position in frame units, tan(vertical fov / 2), ghost gain (e.g. lower in the cockpit). */
  function update(sx, sy, tanHalfFov, ghostGain = 1, starGain = 1) {
    const r = Math.hypot(sx, sy);
    const u = Math.min(Math.max(r / C.R_MAX, 0), 1);
    const kf = u * (META_LUT_N - 1), k0 = Math.min(Math.floor(kf), META_LUT_N - 2), f = kf - k0;
    for (let g = 0; g < G; g++) {
      const a = (k0 * G + g) * 4, b = a + G * 4;
      const c = meta[a] + f * (meta[b] - meta[a]);
      // magnitudes interpolate, the sign (iris orientation) comes from the nearer node
      const ma = Math.sign(f < 0.5 ? meta[a + 1] : meta[b + 1]) * (Math.abs(meta[a + 1]) + f * (Math.abs(meta[b + 1]) - Math.abs(meta[a + 1])));
      const mc = Math.sign(f < 0.5 ? meta[a + 2] : meta[b + 2]) * (Math.abs(meta[a + 2]) + f * (Math.abs(meta[b + 2]) - Math.abs(meta[a + 2])));
      const E = meta[a + 3] + f * (meta[b + 3] - meta[a + 3]);
      const amp = r > C.R_MAX ? 0 : E * hexComp / (Math.PI * Math.abs(ma * mc));
      ghostU[g].set(c, ma, mc, amp);
    }
    const P = uniforms.uFlareParams.value;
    P.set(1 / Math.max(tanHalfFov * tanHalfFov, 1e-6), 1, baseGhost * ghostGain, u * (NR - 1));
    uniforms.uFlareParams2.value.x = baseStar * starGain;
  }
  update(0, 0, Math.tan(Math.PI / 6));
  return {
    glsl: flareGLSL(), uniforms, update,
    info: { params: net.params, bakeMs: bake.ms, ghostBakeMs: bake.ghostMs, buildMs: now() - t0, ghosts: C.ghostNames, training: FLARE_MODEL.meta },
    dispose() { ghostTex.dispose(); starTex.dispose(); },
  };
}
