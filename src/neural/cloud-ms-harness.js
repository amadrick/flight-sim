// Isolated WebGL2 check of the learned multiple-scattering GLSL (not part of the shipped bundle).
//   node tools/shot.mjs --entry src/neural/cloud-ms-harness.js --html dist/cloud-ms.html --out shots/cloud-ms.png \
//        --size 320x180 --frames 1 --eval "sim.results"
// Compiles createCloudMultiScatter().glsl (with CLOUD_MS_SIGMA defined, so the tap helper compiles too), evaluates
// cloudMsLight / cloudPhaseMie / cloudMsForwardPeak on the stored test vectors on the GPU and compares with the JS twins.
import * as THREE from 'three';
import { FULLSCREEN_VERT, FullscreenPass } from '../core/glsl.js';
import { createCloudMultiScatter } from './cloud-ms.js';
import { CLOUD_MS_MODEL } from './cloud-ms-weights.js';
import vec from './test-vectors-ms.json';

const sim = (window.__sim = { ready: false, step() {}, ctx: {}, results: null });
try {
  const canvas = document.getElementById('view');
  for (const id of ['boot', 'hud', 'ui']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const ms = createCloudMultiScatter({ reff: 10 });
  const N = vec.tauSun.length;
  const dirs = CLOUD_MS_MODEL.desc.dirs;
  const data = new Float32Array(N * 4 * (2 + dirs.length));      // rows: (tauSun, tauCam, muSun, cos), taps per dir
  for (let i = 0; i < N; i++) {
    data.set([vec.tauSun[i], vec.tauCam[i], vec.muSun[i], vec.cosTheta[i]], 4 * i);
    dirs.forEach((d, k) => data.set([...vec.taps[d][i], 0], 4 * (N * (1 + k) + i)));
  }
  const inTex = new THREE.DataTexture(data, N, 1 + dirs.length, THREE.RGBAFormat, THREE.FloatType);
  inTex.needsUpdate = true;
  const tapArgs = dirs.map((_, k) => `texelFetch(tIn, ivec2(i, ${k + 1}), 0).xyz`).join(', ');
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: { ...ms.uniforms, tIn: { value: inTex } },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */`
      precision highp float;
      in vec2 vUv;
      #define CLOUD_MS_SIGMA(p) (0.05 * smoothstep(800.0, 0.0, length(p)))
      ${ms.glsl}
      uniform highp sampler2D tIn;
      out vec4 outColor;
      void main() {
        int i = int(gl_FragCoord.x);
        int row = int(gl_FragCoord.y);
        vec4 a = texelFetch(tIn, ivec2(i, 0), 0);
        if (row == 0) { outColor = vec4(cloudMsLight(a.x, a.y, a.z, a.w, ${tapArgs}), 1.0); return; }
        vec3 p = cloudPhaseMie(a.w);
        vec3 tap = cloudMsTapSegments(vec3(0.0), vec3(0.0, 1.0, 0.0));
        outColor = vec4(p.g, cloudMsForwardPeak(a.x, p.g), tap.x, 1.0);
      }`,
  });
  const rt = new THREE.WebGLRenderTarget(N, 2, { type: THREE.FloatType, depthBuffer: false,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  new FullscreenPass(mat).render(renderer, rt);
  const buf = new Float32Array(N * 2 * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, N, 2, buf);
  let eNet = 0, ePh = 0, eFp = 0;
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 3; k++) eNet = Math.max(eNet, Math.abs(Math.log(buf[4 * i + k] / vec.out[i][k])));
    const p = ms.phase(vec.cosTheta[i])[1];
    ePh = Math.max(ePh, Math.abs(buf[4 * (N + i)] / p - 1));
    const fp = ms.forwardPeak(vec.tauSun[i], buf[4 * (N + i)]);
    eFp = Math.max(eFp, Math.abs(buf[4 * (N + i) + 1] - fp) / (fp + 1e-6));
  }
  sim.results = { vectors: N, netMaxLnDiffPpm: 1e6 * eNet, phaseMaxRelPpm: 1e6 * ePh, forwardPeakMaxRelPpm: 1e6 * eFp,
    tapCheck: buf[4 * N + 2], params: ms.info.params, buildMs: ms.info.buildMs };
  sim.ready = true;
} catch (e) {
  sim.error = String(e && e.stack ? e.stack : e);
}
