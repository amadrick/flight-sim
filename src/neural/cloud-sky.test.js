// node --test src/neural/cloud-sky.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  createNeuralCloudSkyVisibility, createAnalyticCloudSkyVisibility, skyVisibility, analyticSkyVisibility,
  getCloudSkyNet, CLOUD_SKY_LUT_SIZE,
} from './cloud-sky.js';

const vec = JSON.parse(readFileSync(fileURLToPath(new URL('./test-vectors-sky.json', import.meta.url)), 'utf8'));

test('sky network: JS forward pass reproduces Python (1e-4)', () => {
  let maxDiff = 0;
  for (let i = 0; i < vec.V.length; i++) maxDiff = Math.max(maxDiff, Math.abs(skyVisibility(vec.tauUp[i], vec.tauDown[i]) - vec.V[i]));
  console.log(`  sky: max |V (JS) - V (Python)| = ${maxDiff.toExponential(2)} over ${vec.V.length} vectors, ${getCloudSkyNet().params} parameters`);
  assert.ok(maxDiff < 1e-4);
  assert.ok(getCloudSkyNet().params < 1000);
});

test('sky LUT: texture, GLSL, values in [0,1], physically sensible, fast', () => {
  const times = [];
  let s;
  for (let r = 0; r < 5; r++) { const t0 = performance.now(); s = createNeuralCloudSkyVisibility(); times.push(performance.now() - t0); }
  times.sort((a, b) => a - b);
  const n = CLOUD_SKY_LUT_SIZE;
  console.log(`  sky: build median ${times[2].toFixed(2)} ms`);
  assert.ok(times[2] < 20);
  assert.ok(s.texture instanceof THREE.DataTexture);
  assert.equal(s.texture.type, THREE.HalfFloatType);
  assert.equal(s.texture.format, THREE.RedFormat);
  assert.equal(s.texture.minFilter, THREE.LinearFilter);
  assert.equal(s.uniforms.tCloudSkyVisLUT.value, s.texture);
  assert.match(s.glsl, /uniform highp sampler2D tCloudSkyVisLUT;/);
  assert.match(s.glsl, /float cloudSkyVisibility\(float tauUp, float tauDown\)/);
  assert.match(createAnalyticCloudSkyVisibility().glsl, /float cloudSkyVisibility\(float tauUp, float tauDown\)/);
  for (const [i, j, v] of vec.lutSamples) assert.ok(Math.abs(s.values[i + n * j] - v) < 1e-4);
  for (const v of s.values) assert.ok(v >= 0 && v <= 1 && Number.isFinite(v));
  // limits: free air sees half the sphere of sky; top of a thick cloud is bright; base of a thick cloud is dark
  assert.ok(Math.abs(s.sample(0, 0) - 0.5) < 0.12, `V(0,0) = ${s.sample(0, 0)}`);
  assert.ok(s.sample(0, 60) > 0.8, `V(top of thick cloud) = ${s.sample(0, 60)}`);
  assert.ok(s.sample(60, 0) < 0.15, `V(base of thick cloud) = ${s.sample(60, 0)}`);
  // monotone: more cloud above -> darker; more cloud below -> brighter (back-scatter), small tolerance for the fit
  let viol = 0, cnt = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i + 1 < n; i++) {
    cnt += 2;
    if (s.values[i + 1 + n * j] > s.values[i + n * j] + 0.01) viol++;
    if (s.values[j + n * (i + 1)] < s.values[j + n * i] - 0.01) viol++;
  }
  console.log(`  sky: V(0,0) = ${s.sample(0, 0).toFixed(3)}, V(0,60) = ${s.sample(0, 60).toFixed(3)}, V(60,0) = ${s.sample(60, 0).toFixed(3)}, V(10,10) = ${s.sample(10, 10).toFixed(3)}; monotonicity violations ${viol}/${cnt}`);
  assert.ok(viol <= 0.02 * cnt, `monotonicity violations ${viol}/${cnt}`);
  // LUT vs direct network and out-of-range inputs
  let maxErr = 0;
  for (let i = 0; i < 2000; i++) {
    const a = Math.expm1(Math.random() * Math.log1p(128)), b = Math.expm1(Math.random() * Math.log1p(128));
    maxErr = Math.max(maxErr, Math.abs(s.sample(a, b) - skyVisibility(a, b)));
  }
  assert.ok(maxErr < 0.01, `sky LUT interpolation error ${maxErr}`);
  assert.ok(Math.abs(s.sample(1e9, 1e9) - s.sample(128, 128)) < 1e-9);
  assert.ok(Number.isFinite(s.sample(-3, -3)));
  assert.ok(Math.abs(analyticSkyVisibility(0, 0) - 0.5) < 1e-9);
  s.dispose();
});
