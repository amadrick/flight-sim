// Isolated WebGL2 harness for the neural cloud-scatter model (not part of the shipped bundle).
//   node tools/shot.mjs --entry src/neural/harness.js --html dist/neural.html --out shots/neural.png \
//        --size 640x360 --frames 1 --eval "sim.results"
// 1. compiles the generated GLSL (neural LUT + analytic fallback, both in one shader),
// 2. renders cloudSunScatter() over a grid of inputs into a float target, reads it back and compares it with the
//    CPU twin (`scatter.sample`), i.e. verifies the texture upload, LUT coordinates and filtering on a real GPU path,
// 3. draws a picture of J (left: neural, right: fitted octaves) for a visual sanity check:
//    x = optical depth toward the sun (log), y = scattering angle (log, forward at the bottom), 3 tauUp/tauSun ratios.
import * as THREE from 'three';
import { FULLSCREEN_VERT, FullscreenPass } from '../core/glsl.js';
import { createNeuralCloudScatter, analyticScatterGLSL, analyticScatterJ } from './cloud-scatter.js';

const sim = (window.__sim = { ready: false, step() {}, ctx: {}, results: null });
try {
  const canvas = document.getElementById('view');
  for (const id of ['boot', 'hud', 'ui']) { const el = document.getElementById(id); if (el) el.hidden = true; }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  const W = window.innerWidth, H = window.innerHeight;
  renderer.setSize(W, H, false);
  const scatter = createNeuralCloudScatter();
  const common = /* glsl */`
    precision highp float;
    in vec2 vUv;
    ${scatter.glsl}
    ${analyticScatterGLSL(undefined, { functionName: 'cloudSunScatterAnalytic' })}
    const float PI = 3.14159265358979;
    // uv -> inputs: x: tauSun in [0, 160] (log1p), y: theta in [1e-3, pi] (log)
    void inputsFromUv(vec2 uv, out float tauSun, out float cosTheta) {
      tauSun = exp(uv.x * log(161.0)) - 1.0;
      cosTheta = cos(exp(mix(log(1.0e-3), log(PI), uv.y)));
    }`;
  // ---- numeric pass: R = neural J, G = analytic J, B = neural multi part
  const NX = 48, NY = 40;
  const ratios = [0.15, 0.6, 2.0];
  const numMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: { ...scatter.uniforms, uRatio: { value: 1 } },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: common + /* glsl */`
      uniform float uRatio;
      out vec4 outColor;
      void main() {
        float ts, c; inputsFromUv(vUv, ts, c);
        float tu = ts * uRatio;
        outColor = vec4(cloudSunScatter(ts, tu, c), cloudSunScatterAnalytic(ts, tu, c), cloudSunScatterMulti(ts, tu, c), 1.0);
      }`,
  });
  const rt = new THREE.WebGLRenderTarget(NX, NY, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const pass = new FullscreenPass(numMat);
  const buf = new Float32Array(NX * NY * 4);
  const errs = [], errsA = [];
  let worst = null;
  for (const ratio of ratios) {
    numMat.uniforms.uRatio.value = ratio;
    pass.render(renderer, rt);
    renderer.readRenderTargetPixels(rt, 0, 0, NX, NY, buf);
    for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
      const u = (x + 0.5) / NX, v = (y + 0.5) / NY;
      const ts = Math.exp(u * Math.log(161)) - 1;
      const c = Math.cos(Math.exp(Math.log(1e-3) + v * (Math.log(Math.PI) - Math.log(1e-3))));
      const o = 4 * (y * NX + x);
      const ref = scatter.sample(ts, ts * ratio, c);
      const e = Math.abs(buf[o] - ref) / ref;
      errs.push(e);
      if (!worst || e > worst.err) worst = { err: e, tauSun: ts, ratio, cosTheta: c, gpu: buf[o], cpu: ref };
      const refA = analyticScatterJ(ts, ts * ratio, c);
      errsA.push(Math.abs(buf[o + 1] - refA) / refA);
    }
  }
  errs.sort((a, b) => a - b); errsA.sort((a, b) => a - b);
  const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  sim.results = {
    samples: errs.length,
    neuralGpuVsCpu: { median: q(errs, 0.5), p99: q(errs, 0.99), max: errs[errs.length - 1] },
    analyticGpuVsCpu: { median: q(errsA, 0.5), p99: q(errsA, 0.99), max: errsA[errsA.length - 1] },
    worst,
    bakeMs: scatter.info.bakeMs, buildMs: scatter.info.buildMs, params: scatter.info.params,
    floatLinear: !!renderer.getContext().getExtension('OES_texture_float_linear'),
  };

  // ---- picture: 3 rows (tauUp/tauSun ratios), left neural / right analytic, log-encoded brightness
  const visMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: { ...scatter.uniforms },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: common + /* glsl */`
      out vec4 outColor;
      vec3 ramp(float t) {   // dark blue -> white -> orange for values spanning 1e-3 .. 1e3
        t = clamp(t, 0.0, 1.0);
        return mix(mix(vec3(0.02, 0.03, 0.10), vec3(0.95), smoothstep(0.0, 0.6, t)), vec3(1.0, 0.55, 0.1), smoothstep(0.6, 1.0, t));
      }
      void main() {
        vec2 uv = vUv;
        float row = floor(uv.y * 3.0);
        float ratio = row < 0.5 ? 0.15 : (row < 1.5 ? 0.6 : 2.0);
        vec2 cell = vec2(fract(uv.x * 2.0), fract(uv.y * 3.0));
        float ts, c; inputsFromUv(cell, ts, c);
        float j = uv.x < 0.5 ? cloudSunScatter(ts, ts * ratio, c) : cloudSunScatterAnalytic(ts, ts * ratio, c);
        float t = (log(max(j, 1.0e-6)) / log(10.0) + 3.0) / 6.0;
        vec3 col = ramp(t);
        float iso = abs(fract(log(max(j, 1.0e-6)) / log(10.0) + 0.5) - 0.5);   // decade contours
        col = mix(col, vec3(0.0), 0.5 * (1.0 - smoothstep(0.0, 0.03, iso)));
        if (cell.x < 0.005 || cell.y < 0.01) col = vec3(0.3);
        outColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
      }`,
  });
  const vis = new FullscreenPass(visMat);
  sim.step = () => { vis.render(renderer, null); };
  sim.step();
  sim.ready = true;
} catch (e) {
  sim.error = String(e && e.stack ? e.stack : e);
}
