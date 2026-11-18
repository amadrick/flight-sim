// GPU Tessendorf FFT ocean: per cascade, every frame
//   (h0 pass only when the sea state changes)  h0(k) from spectrum + fixed gaussian noise   → RGBA32F
//   time pass     h~(k,t) for 8 real fields packed as 4 complex pairs (2 MRT attachments)
//   2·log2(N) radix-2 Stockham butterfly passes (no bit reversal; see E. Bainville, "OpenCL Fast Fourier Transform")
//   finalize      displacement (choppy, Tessendorf §4.6), displaced-surface gradient, Jacobian, persistent foam
//                 → RGBA16F mip-mapped, repeat-wrapped textures sampled by the ocean surface shaders.
// Cost (N = 256, 3 cascades): 3 × 18 fullscreen 256² passes ≈ 3.5 M fragments/frame, ~1 ms on a mid-range GPU.
import * as THREE from 'three';
import { FULLSCREEN_VERT, FullscreenPass } from '../core/glsl.js';
import { gaussianField, OMEGA0, TIME_PERIOD, SPREAD_BLEND } from './spectrum.js';

const COMMON = /* glsl */`
precision highp float; precision highp int;
const float PI = 3.14159265358979;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 imul(vec2 a) { return vec2(-a.y, a.x); }
`;

const H0_FRAG = /* glsl */`${COMMON}
uniform sampler2D tGauss; uniform float uN, uL, uKLo, uKHi;
uniform vec4 uWind;   // angle, wp, alpha, gamma
uniform vec4 uSwell;  // angle, wp, alpha, normalisation
uniform float uSwellS;
in vec2 vUv; layout(location = 0) out vec4 outH0;
const float G = 9.81;
const float SPREAD_BLEND = ${SPREAD_BLEND.toFixed(4)};
float jonswap(float w, float wp, float alpha, float gamma) {
  if (w < 1e-4) return 0.0;
  float sigma = w <= wp ? 0.07 : 0.09;
  float r = exp(-(w - wp) * (w - wp) / (2.0 * sigma * sigma * wp * wp));
  float iw = 1.0 / w, q = wp * iw, q2 = q * q;
  return alpha * G * G * iw * iw * iw * iw * iw * exp(-1.25 * q2 * q2) * pow(gamma, r);
}
float wrapPi(float a) { return a - 2.0 * PI * floor((a + PI) / (2.0 * PI)); }
float donelanBanner(float w, float wp, float th) {
  float r = w / wp;
  float beta = r < 0.95 ? 2.61 * pow(r, 1.3) : (r < 1.6 ? 2.28 * pow(r, -0.65) : pow(10.0, -0.4 + 0.8393 * exp(-0.567 * log(r * r))));
  float s = 1.0 / cosh(min(beta * abs(th), 40.0));
  return beta / (2.0 * tanh(beta * PI)) * s * s;
}
float psi(vec2 k) {
  float kl = length(k);
  float w = sqrt(G * kl), dwdk = G / (2.0 * w);
  // explicit axis cases: some GPUs (SwiftShader) mishandle atan(-0.0, x < 0), which breaks the Hermitian pairing
  float th = abs(k.y) < 1e-12 ? (k.x < 0.0 ? PI : 0.0) : atan(k.y, k.x);
  float sw = jonswap(w, uWind.y, uWind.z, uWind.w) * (donelanBanner(w, uWind.y, wrapPi(th - uWind.x)) * (1.0 - SPREAD_BLEND) + SPREAD_BLEND / (2.0 * PI));
  float ss = jonswap(w, uSwell.y, uSwell.z, 3.3) * uSwell.w * pow(abs(cos(wrapPi(th - uSwell.x) * 0.5)), 2.0 * uSwellS);
  return (sw + ss) * dwdk / kl;
}
float amp(vec2 m) {
  if (m.x == -uN * 0.5 || m.y == -uN * 0.5) return 0.0;
  float dk = 2.0 * PI / uL;
  vec2 k = m * dk; float kl = length(k);
  if (kl < max(uKLo, 1e-6) || kl >= uKHi) return 0.0;
  return sqrt(psi(k) * dk * dk * 0.5) * 0.70710678;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy); int N = int(uN);
  ivec2 pn = (ivec2(N) - p) % N;
  vec2 m = vec2(p); m -= uN * step(uN * 0.5, m);
  vec2 g = texelFetch(tGauss, p, 0).xy, gn = texelFetch(tGauss, pn, 0).xy;
  vec2 h0 = g * amp(m), h0n = gn * amp(-m);
  outH0 = vec4(h0, h0n.x, -h0n.y);
}`;

const TIME_FRAG = /* glsl */`${COMMON}
uniform sampler2D tH0; uniform float uN, uL, uTimeFrac;
in vec2 vUv; layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 h0 = texelFetch(tH0, p, 0);
  vec2 m = vec2(p); m -= uN * step(uN * 0.5, m);
  vec2 k = m * (2.0 * PI / uL); float kl = length(k);
  // quantised dispersion: w = n * OMEGA0, phase = 2pi * fract(n * t / T)  (exact in float32)
  float n = floor(sqrt(9.81 * kl) / ${OMEGA0.toFixed(10)});
  float ph = 2.0 * PI * fract(n * uTimeFrac);
  vec2 e = vec2(cos(ph), sin(ph));
  vec2 ht = cmul(h0.xy, vec2(e.x, -e.y)) + cmul(h0.zw, e);     // h0 e^{-iwt} + conj(h0(-k)) e^{iwt}
  float ik = kl > 1e-6 ? 1.0 / kl : 0.0;
  vec2 iht = imul(ht);
  vec2 Dx = -iht * k.x * ik, Dz = -iht * k.y * ik;            // horizontal displacement  -i k/|k| h
  vec2 Sx = iht * k.x, Sz = iht * k.y;                        // slopes                    i k h
  vec2 Dxx = ht * (k.x * k.x * ik), Dzz = ht * (k.y * k.y * ik), Dxz = ht * (k.x * k.y * ik);
  o0 = vec4(ht + imul(Dx), Dz + imul(Sx));                    // two real fields per complex IFFT
  o1 = vec4(Sz + imul(Dxx), Dzz + imul(Dxz));
}`;

const BUTTERFLY_FRAG = /* glsl */`${COMMON}
uniform sampler2D tA0, tA1; uniform int uNs, uHoriz, uN;
in vec2 vUv; layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int j = uHoriz == 1 ? p.x : p.y;
  int k = j % uNs;
  int t = (j / (2 * uNs)) * uNs + k;
  float s = (j % (2 * uNs)) >= uNs ? -1.0 : 1.0;
  ivec2 q0 = uHoriz == 1 ? ivec2(t, p.y) : ivec2(p.x, t);
  ivec2 q1 = uHoriz == 1 ? ivec2(t + uN / 2, p.y) : ivec2(p.x, t + uN / 2);
  float a = PI * float(k) / float(uNs);
  vec2 w = vec2(cos(a), sin(a)) * s;                          // inverse transform: e^{+i pi k / Ns}
  vec4 a0 = texelFetch(tA0, q0, 0), b0 = texelFetch(tA0, q1, 0);
  vec4 a1 = texelFetch(tA1, q0, 0), b1 = texelFetch(tA1, q1, 0);
  o0 = vec4(a0.xy + cmul(w, b0.xy), a0.zw + cmul(w, b0.zw));
  o1 = vec4(a1.xy + cmul(w, b1.xy), a1.zw + cmul(w, b1.zw));
}`;

const FINAL_FRAG = /* glsl */`${COMMON}
uniform sampler2D tB0, tB1, tPrev; uniform float uChop, uFoamBias, uFoamGain, uFoamDecay;
in vec2 vUv; layout(location = 0) out vec4 oDisp; layout(location = 1) out vec4 oSlope;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(tB0, p, 0), b = texelFetch(tB1, p, 0);
  float h = a.x, Dx = a.y, Dz = a.z, sx = a.w, sz = b.x, Dxx = b.y, Dzz = b.z, Dxz = b.w;
  float c = -uChop;                                           // negative: sharp crests, broad troughs (Gerstner-like)
  float jxx = 1.0 + c * Dxx, jzz = 1.0 + c * Dzz, jxz = c * Dxz;
  float J = jxx * jzz - jxz * jxz;                            // Jacobian of the horizontal map; < 0 = folded crest
  float Jc = max(J, 0.2);
  vec2 grad = vec2(jzz * sx - sz * jxz, sz * jxx - jxz * sx) / Jc;   // gradient of the displaced surface
  float prev = texelFetch(tPrev, p, 0).z;
  float foam = max(prev * uFoamDecay - 0.002, clamp((uFoamBias - J) * uFoamGain, 0.0, 1.0));
  oDisp = vec4(c * Dx, h, c * Dz, 0.0);
  oSlope = vec4(grad, foam, J);
}`;

function fsMaterial(frag, uniforms) {
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
}

/**
 * @param renderer THREE.WebGLRenderer
 * @param opts { N, cascades: [{ L, kLo, kHi }], seed, anisotropy }
 */
export function createOceanFFT(renderer, opts) {
  const { N } = opts;
  const floatOK = renderer.extensions.has('EXT_color_buffer_float');
  const workType = floatOK ? THREE.FloatType : THREE.HalfFloatType;
  const logN = Math.round(Math.log2(N));
  const rtOpts = (count, type) => ({ count, type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });

  const pH0 = new FullscreenPass(fsMaterial(H0_FRAG, {
    tGauss: { value: null }, uN: { value: N }, uL: { value: 1 }, uKLo: { value: 0 }, uKHi: { value: 1e9 },
    uWind: { value: new THREE.Vector4() }, uSwell: { value: new THREE.Vector4() }, uSwellS: { value: 20 },
  }));
  const pTime = new FullscreenPass(fsMaterial(TIME_FRAG, { tH0: { value: null }, uN: { value: N }, uL: { value: 1 }, uTimeFrac: { value: 0 } }));
  const pBfly = new FullscreenPass(fsMaterial(BUTTERFLY_FRAG, { tA0: { value: null }, tA1: { value: null }, uNs: { value: 1 }, uHoriz: { value: 1 }, uN: { value: N } }));
  const pFinal = new FullscreenPass(fsMaterial(FINAL_FRAG, {
    tB0: { value: null }, tB1: { value: null }, tPrev: { value: null },
    uChop: { value: 1 }, uFoamBias: { value: 0 }, uFoamGain: { value: 1 }, uFoamDecay: { value: 0.98 },
  }));

  const cascades = opts.cascades.map((c, i) => {
    const gauss = gaussianField(N * N, (opts.seed || 1) * 7919 + i * 104729);
    const gTex = new THREE.DataTexture(gauss, N, N, THREE.RGFormat, THREE.FloatType);
    gTex.minFilter = gTex.magFilter = THREE.NearestFilter; gTex.needsUpdate = true;
    const out = [0, 1].map(() => {
      const t = new THREE.WebGLRenderTarget(N, N, {
        count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
        minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
        wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, anisotropy: opts.anisotropy || 4,
      });
      return t;
    });
    return {
      ...c, N, gauss, gTex,
      h0: new THREE.WebGLRenderTarget(N, N, rtOpts(1, workType)),
      A: new THREE.WebGLRenderTarget(N, N, rtOpts(2, workType)),
      B: new THREE.WebGLRenderTarget(N, N, rtOpts(2, workType)),
      out, cur: 0,
      get disp() { return this.out[this.cur].textures[0]; },
      get slope() { return this.out[this.cur].textures[1]; },
      chop: 1, foamBias: 0, foamGain: 1, dirty: true,
    };
  });
  // texture objects the surface material binds: we swap the .out targets, so expose stable getters via update()

  let sea = null, lastT = -1;
  const fft = {
    N, cascades, floatOK,
    /** sea: from makeSeaState(); per-cascade choppiness & foam settings applied in finalize */
    setSeaState(s, { chop, foamBias, foamGain }) {
      sea = s;
      for (const c of cascades) { c.dirty = true; c.chop = chop; c.foamBias = foamBias; c.foamGain = foamGain; }
    },
    setFoam({ chop, foamBias, foamGain }) { for (const c of cascades) { c.chop = chop; c.foamBias = foamBias; c.foamGain = foamGain; } },
    /** t = simulated seconds (double), dt = frame step (foam decay) */
    update(t, dt) {
      if (!sea) return;
      // paused (same time, nothing to regenerate): the previous frame's textures are still exact
      if (t === lastT && !cascades.some((c) => c.dirty)) return;
      lastT = t;
      const prevTarget = renderer.getRenderTarget();
      const tf = (t % TIME_PERIOD) / TIME_PERIOD;
      const decay = Math.exp(-dt / (fft.foamLife || 2.5));
      for (const c of cascades) {
        if (c.dirty) {
          const u = pH0.material.uniforms;
          u.tGauss.value = c.gTex; u.uL.value = c.L; u.uKLo.value = c.kLo; u.uKHi.value = c.kHi;
          u.uWind.value.set(sea.windAngle, sea.wind.wp, sea.wind.alpha, sea.wind.gamma);
          u.uSwell.value.set(sea.swellAngle, sea.swell.wp, sea.swell.alpha, sea.swellNorm);
          u.uSwellS.value = sea.swellS;
          pH0.render(renderer, c.h0);
          c.dirty = false;
        }
        const ut = pTime.material.uniforms;
        ut.tH0.value = c.h0.texture; ut.uL.value = c.L; ut.uTimeFrac.value = tf;
        pTime.render(renderer, c.A);
        let src = c.A, dst = c.B;
        const ub = pBfly.material.uniforms;
        for (let dir = 1; dir >= 0; dir--) {
          for (let s = 0; s < logN; s++) {
            ub.tA0.value = src.textures[0]; ub.tA1.value = src.textures[1];
            ub.uNs.value = 1 << s; ub.uHoriz.value = dir;
            pBfly.render(renderer, dst);
            const tmp = src; src = dst; dst = tmp;
          }
        }
        const prev = c.out[c.cur]; c.cur ^= 1; const next = c.out[c.cur];
        const uf = pFinal.material.uniforms;
        uf.tB0.value = src.textures[0]; uf.tB1.value = src.textures[1]; uf.tPrev.value = prev.textures[1];
        uf.uChop.value = c.chop; uf.uFoamBias.value = c.foamBias; uf.uFoamGain.value = c.foamGain; uf.uFoamDecay.value = decay;
        pFinal.render(renderer, next);
      }
      renderer.setRenderTarget(prevTarget);
    },
    dispose() {
      for (const c of cascades) { c.gTex.dispose(); c.h0.dispose(); c.A.dispose(); c.B.dispose(); c.out.forEach(o => o.dispose()); }
      pH0.dispose(); pTime.dispose(); pBfly.dispose(); pFinal.dispose();
    },
  };
  return fft;
}
