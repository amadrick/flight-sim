// Round four: learned multiple scattering for the cloud march, trained against a path-traced reference with the true
// Lorenz-Mie phase function of a droplet population (tools/neural/clouds/: mie.py, pt.py, validate.py, gen.py,
// train.py). Opt-in: nothing here changes the shipped lighting (cloud-light.js / cloud-scatter.js stay as they are).
// Integration contract, costs and limits: docs/clouds/NEURAL.md.
//
//   const ms = createCloudMultiScatter({ reff: 10 });     // ~2 ms: decodes weights, bakes the Mie phase LUT
//   material.uniforms = { ...material.uniforms, ...ms.uniforms };   // tCloudMie (512x1 RGBA16F)
//   fragmentShader = ms.glsl + ...;
//
// GLSL it defines (all per unit sun irradiance / unit sky or ground radiance, optical depths physical: sigma[1/m] x m):
//   vec3  cloudMsLight(float tauSun, float tauCam, float muSun, float cosTheta, vec3 tapUp, vec3 tapDown, vec3 tapFwd)
//         -> x: J_ms (sr^-1), sun light scattered 2+ times (WITHOUT the single scattering and the forward-peak term)
//            y: V_sky, all orders of a uniform sky (upper hemisphere radiance 1)
//            z: V_gnd, all orders of a uniform ground (lower hemisphere radiance 1)
//   float cloudMsForwardPeak(float tauSun, float phase)       sunlight carried along the beam by the diffraction peak
//   float cloudMsForwardPeak(float tauSun, float phase, float cosTheta)   v2: the same plus the aureole (use this one)
//   vec3  cloudPhaseMie(float cosTheta)                       tabulated Mie phase function, R G B (sr^-1)
//   vec3  cloudMsTapSegments(vec3 p, vec3 dir)                (only if CLOUD_MS_SIGMA(p) is #defined before ms.glsl)
//   #define CLOUD_MS_DESC_VERSION 2   descriptor v2: CLOUD_MS_SIGMA(p) is the cheap base density x 0.8 (the light march's
//                                     un-eroded density, shaders.js clMsSigma), not the full eroded field (v1)
// Source for the march:  S = E_sun * (min(p, pMax) e^-tauSun + cloudMsForwardPeak(tauSun, p) + ms.x)
//                            + L_sky * ms.y + L_gnd * ms.z,      p = cloudPhaseMie(cosTheta) (per channel)
import * as THREE from 'three';
import { CLOUD_MS_MODEL } from './cloud-ms-weights.js';
import { CLOUD_MIE_TABLES } from './cloud-mie-weights.js';

function b64ToF32(b64) {
  let bytes;
  if (typeof atob === 'function') {
    const s = atob(b64); bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  } else bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
}

const AUR_N = 6;
const glf = (v) => { let s = Number(v).toPrecision(8); if (!/[.e]/.test(s)) s += '.0'; if (/^-?\d+e/.test(s)) s = s.replace('e', '.0e'); return s; };

// ------------------------------------------------------------------------------------------------ network
let _net = null;
/** Decoded network: layers [{ nIn, nOut, W (row-major [out][in]), b }] (input normalisation folded into layer 0). */
export function getCloudMsNet() {
  if (_net) return _net;
  const m = CLOUD_MS_MODEL;
  const f = b64ToF32(m.b64);
  const layers = [];
  let p = 0;
  for (let i = 0; i < m.sizes.length - 1; i++) {
    const nIn = m.sizes[i], nOut = m.sizes[i + 1];
    layers.push({ nIn, nOut, W: Float64Array.from(f.subarray(p, p + nIn * nOut)), b: Float64Array.from(f.subarray(p + nIn * nOut, p + nIn * nOut + nOut)) });
    p += nIn * nOut + nOut;
  }
  if (p !== f.length) throw new Error(`cloud ms weights: expected ${p} floats, got ${f.length}`);
  _net = { layers, params: p, desc: m.desc, meta: m.meta };
  return _net;
}

/** Descriptor -> network inputs (must match tools/neural/clouds/export.py: encode). */
export function cloudMsEncode(tauSun, tauCam, muSun, cosTheta, taps, out = []) {
  const D = CLOUD_MS_MODEL.desc;
  const c = Math.min(1, Math.max(-1, cosTheta));
  const chord = Math.sqrt(Math.max(0, 2 - 2 * c));
  out.length = 0;
  out.push(Math.log1p(Math.max(tauSun, 0)), muSun, Math.log1p(Math.min(Math.max(tauCam, 0), D.tauCamMax)), c,
    Math.log1p(chord / D.chordT0) / Math.log1p(2 / D.chordT0));
  for (const dir of D.dirs) for (const t of taps[dir]) out.push(Math.log1p(Math.max(t, 0)));
  return out;
}

/** JS reference of cloudMsLight: [J_ms, V_sky, V_gnd]. taps = { up: [..], down: [..], fwd: [..] } segment depths. */
export function cloudMsLight(tauSun, tauCam, muSun, cosTheta, taps) {
  const net = getCloudMsNet();
  let x = cloudMsEncode(tauSun, tauCam, muSun, cosTheta, taps);
  for (let l = 0; l < net.layers.length; l++) {
    const { nIn, nOut, W, b } = net.layers[l];
    const y = new Array(nOut);
    for (let o = 0; o < nOut; o++) {
      let s = b[o];
      for (let i = 0; i < nIn; i++) s += W[o * nIn + i] * x[i];
      y[o] = l < net.layers.length - 1 ? s / Math.sqrt(1 + s * s) : Math.exp(Math.min(Math.max(s, -20), 4));
    }
    x = y;
  }
  return x;
}

// GLSL: inputs in vec4 blocks, each layer as mat4 blocks (column-major), ISRU between layers.
function netGLSL(net, name) {
  const blocks = (n) => Math.ceil(n / 4);
  const lines = [];
  const L = net.layers;
  // input assembly is done by the caller into vec4 x0[..]
  let cur = 'x', nCur = L[0].nIn;
  L.forEach((ly, li) => {
    const bi = blocks(ly.nIn), bo = blocks(ly.nOut);
    const nxt = li === L.length - 1 ? 'o' : `h${li}`;
    for (let j = 0; j < bo; j++) {
      const bias = [0, 1, 2, 3].map((r) => (4 * j + r < ly.nOut ? ly.b[4 * j + r] : 0));
      let expr = `vec4(${bias.map(glf).join(', ')})`;
      for (let i = 0; i < bi; i++) {
        const cols = [];
        for (let c = 0; c < 4; c++) {
          const col = [];
          for (let r = 0; r < 4; r++) {
            const o = 4 * j + r, k = 4 * i + c;
            col.push(o < ly.nOut && k < ly.nIn ? ly.W[o * ly.nIn + k] : 0);
          }
          cols.push(col.map(glf).join(', '));
        }
        expr += `\n    + mat4(${cols.join(',\n           ')}) * ${cur}${i}`;
      }
      lines.push(`  vec4 ${nxt}${j} = ${expr};`);
      if (li < L.length - 1) lines.push(`  ${nxt}${j} *= inversesqrt(1.0 + ${nxt}${j} * ${nxt}${j});`);
    }
    cur = nxt; nCur = ly.nOut;
  });
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------------ Mie phase LUT
let _mie = null;
function mieTables() {
  if (!_mie) {
    const T = CLOUD_MIE_TABLES;
    const f = b64ToF32(T.b64);
    _mie = { T, rows: T.reffs.map((_, i) => [0, 1, 2].map((b) => f.subarray((3 * i + b) * T.nu, (3 * i + b + 1) * T.nu))) };
  }
  return _mie;
}

/** RGB Mie phase table for effective radius reff (um), log-interpolated between the tabulated radii. */
export function cloudMieTable(reff = 10) {
  const { T, rows } = mieTables();
  const rs = T.reffs;
  const r = Math.min(Math.max(reff, rs[0]), rs[rs.length - 1]);
  let i = 0;
  while (i < rs.length - 2 && r > rs[i + 1]) i++;
  const t = (Math.log(r) - Math.log(rs[i])) / (Math.log(rs[i + 1]) - Math.log(rs[i]));
  const out = [0, 1, 2].map(() => new Float64Array(T.nu));
  for (let b = 0; b < 3; b++) for (let k = 0; k < T.nu; k++) {
    out[b][k] = Math.exp((1 - t) * Math.log(rows[i][b][k]) + t * Math.log(rows[i + 1][b][k]));
  }
  const lerpMeta = (key) => {
    const a = T.meta[i][key], c = T.meta[i + 1][key];
    return Array.isArray(a) ? a.map((v, j) => v + (c[j] - v) * t) : a + (c - a) * t;
  };
  return { table: out, nu: T.nu, c: T.c, reff: r, g: lerpMeta('g'), f: lerpMeta('f'), pC: lerpMeta('pC'), aurV: lerpMeta('aurV'),
    thetaC: T.meta[i].thetaC };
}

const mieU = (cosTheta, C) => {
  const th = Math.acos(Math.min(1, Math.max(-1, cosTheta)));
  return 0.5 + Math.tan(C * (th - Math.PI / 2)) / (2 * Math.tan(C * Math.PI / 2));
};

// ------------------------------------------------------------------------------------------------ factory
/**
 * @param {{ reff?: number, pMax?: number }} [opts] reff: droplet effective radius in um (5-20; 6 continental, 10
 *   typical, 14 maritime): only the phase function depends on it (the network is insensitive within +-5 %, see docs).
 */
export function createCloudMultiScatter(opts = {}) {
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const t0 = now();
  const net = getCloudMsNet();
  const D = net.desc;
  const mie = cloudMieTable(opts.reff ?? 10);
  const nu = mie.nu;
  const toH = THREE.DataUtils.toHalfFloat;
  const data = new Uint16Array(nu * 4);
  for (let k = 0; k < nu; k++) {
    for (let b = 0; b < 3; b++) data[4 * k + b] = toH(Math.min(mie.table[b][k], 65000));
    data[4 * k + 3] = toH(1);
  }
  const tex = new THREE.DataTexture(data, nu, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true; tex.name = 'cloudMie';
  const K = D.ends.length;
  const vecK = K === 1 ? 'float' : `vec${K}`;
  const nIn = net.layers[0].nIn;
  const comps = ['x', 'y', 'z', 'w'];
  // input assembly
  const ins = ['log(1.0 + max(tauSun, 0.0))', 'muSun', `log(1.0 + clamp(tauCam, 0.0, ${glf(D.tauCamMax)}))`, 'c',
    `log(1.0 + sqrt(max(0.0, 2.0 - 2.0 * c)) * ${glf(1 / D.chordT0)}) * ${glf(1 / Math.log1p(2 / D.chordT0))}`];
  for (const dir of D.dirs) {
    const nm = 'tap' + dir[0].toUpperCase() + dir.slice(1);
    for (let k = 0; k < K; k++) ins.push(`log(1.0 + max(${K === 1 ? nm : `${nm}.${comps[k]}`}, 0.0))`);
  }
  if (ins.length !== nIn) throw new Error(`cloud ms: descriptor has ${ins.length} inputs, network ${nIn}`);
  const xs = [];
  for (let i = 0; i < Math.ceil(nIn / 4); i++) {
    const v = [0, 1, 2, 3].map((r) => ins[4 * i + r] ?? '0.0');
    xs.push(`  vec4 x${i} = vec4(${v.join(',\n                 ')});`);
  }
  const args = D.dirs.map((d) => `${vecK} tap${d[0].toUpperCase()}${d.slice(1)}`).join(', ');
  const ends = D.ends;
  const glsl = /* glsl */`
// ---- learned cloud multiple scattering (src/neural/cloud-ms.js, ${net.params} parameters; docs/clouds/NEURAL.md) ----
#ifndef CLOUD_MS_GLSL
#define CLOUD_MS_GLSL
// descriptor v${D.version || 1}: taps of the ${(D.tapSource || 'full') === 'base' ? `cheap BASE density x ${D.tapGain} (CLOUD_MS_SIGMA = the light march's un-eroded density)` : 'full eroded density'}
#define CLOUD_MS_DESC_VERSION ${D.version || 1}
uniform highp sampler2D tCloudMie;
const float CLOUD_MS_F = ${glf(mie.f)};          // forward-peak fraction removed by the truncation (theta_c = ${mie.thetaC} deg)
const float CLOUD_MS_PC = ${glf(mie.pC)};        // phase value at theta_c (sr^-1)
vec3 cloudPhaseMie(float cosTheta) {
  float th = acos(clamp(cosTheta, -1.0, 1.0));
  float u = 0.5 + tan(${glf(mie.c)} * (th - 1.5707963)) * ${glf(1 / (2 * Math.tan(mie.c * Math.PI / 2)))};
  return texture(tCloudMie, vec2(u * ${glf((nu - 1) / nu)} + ${glf(0.5 / nu)}, 0.5)).rgb;
}
// Sunlight scattered (once or several times) into the narrow diffraction peak keeps travelling with the beam and is
// then scattered toward the viewer: the extra single-scattering-like term of a delta-M split. phase = the full phase
// value toward the viewer (cloudPhaseMie or the shader's own fit). Add it to the single scattering.
float cloudMsForwardPeak(float tauSun, float phase) {
  float t = max(tauSun, 0.0);
  return min(phase, CLOUD_MS_PC) * (exp(-(1.0 - CLOUD_MS_F) * t) - exp(-t));
}
// v2 (round two): plus the aureole. Sunlight scattered n times inside the diffraction peak spreads by ~sqrt(n) peak
// widths; the 2-argument form treats it as collimated and is up to 70 % dark within ~4 deg of the sun behind a thin
// veil. Small-angle Gaussian sum over n = 1..${AUR_N} (validated against full-phase photon Monte Carlo: within +-13 %).
const float CLOUD_MS_AURV = ${glf(mie.aurV)};     // mean square angle per peak scattering / 2 (rad^2)
float cloudMsForwardPeak(float tauSun, float phase, float cosTheta) {
  float j = cloudMsForwardPeak(tauSun, phase);
  float th2 = 2.0 * (1.0 - clamp(cosTheta, -1.0, 1.0));
  if (th2 > ${glf(2 * (AUR_N + 1) * 12)} * CLOUD_MS_AURV) return j;            // beyond ~5 deg: nothing left
  float t = max(tauSun, 0.0), term = exp(-t), a = 0.0;
  for (int n = 1; n <= ${AUR_N}; n++) {
    term *= CLOUD_MS_F * t / float(n);
    float vn = float(n + 1) * CLOUD_MS_AURV;
    a += term * exp(-th2 / (2.0 * vn)) / (6.2831853 * vn);
  }
  return j + CLOUD_MS_F * a;
}
vec3 cloudMsLight(float tauSun, float tauCam, float muSun, float cosTheta, ${args}) {
  float c = clamp(cosTheta, -1.0, 1.0);
${xs.join('\n')}
${netGLSL(net)}
  return exp(clamp(o0.xyz, -20.0, 4.0));
}
#ifdef CLOUD_MS_SIGMA
// tap segments along dir: sigma at the segment midpoints x segment lengths, segments ending at ${ends.join(', ')} m
${vecK} cloudMsTapSegments(vec3 p, vec3 dir) {
  return ${vecK}(${ends.map((e, k) => { const lo = k ? ends[k - 1] : 0; return `CLOUD_MS_SIGMA(p + dir * ${glf(0.5 * (lo + e))}) * ${glf(e - lo)}`; }).join(',\n    ')});
}
#endif
#endif
`;
  const sampleMie = (cosTheta) => {
    const x = Math.min(Math.max(mieU(cosTheta, mie.c), 0), 1) * (nu - 1);
    const i = Math.min(Math.floor(x), nu - 2), f = x - i;
    return [0, 1, 2].map((b) => mie.table[b][i] * (1 - f) + mie.table[b][i + 1] * f);
  };
  const forwardPeak = (tauSun, phase, cosTheta) => {
    const t = Math.max(tauSun, 0);
    let j = Math.min(phase, mie.pC) * (Math.exp(-(1 - mie.f) * t) - Math.exp(-t));
    if (cosTheta === undefined) return j;
    const th2 = 2 * (1 - Math.min(1, Math.max(-1, cosTheta)));
    if (th2 > 2 * (AUR_N + 1) * 12 * mie.aurV) return j;
    let term = Math.exp(-t), a = 0;
    for (let n = 1; n <= AUR_N; n++) { term *= mie.f * t / n; const vn = (n + 1) * mie.aurV; a += term * Math.exp(-th2 / (2 * vn)) / (2 * Math.PI * vn); }
    return j + mie.f * a;
  };
  return {
    glsl,
    uniforms: { tCloudMie: { value: tex } },
    texture: tex,
    descriptor: { version: D.version || 1, tapSource: D.tapSource || 'full', tapGain: D.tapGain ?? 1, dirs: D.dirs.slice(),
      ends: ends.slice(), tauCamMax: D.tauCamMax },
    light: cloudMsLight,
    phase: sampleMie,
    forwardPeak,
    info: { kind: 'cloud-ms-r4', params: net.params, sizes: CLOUD_MS_MODEL.sizes, reff: mie.reff, g: mie.g, f: mie.f,
      buildMs: now() - t0, meta: net.meta },
    dispose() { tex.dispose(); },
  };
}
