// node --test src/neural/atmo.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  getAtmoNets, sunLogRGB, skyRaw, phasePeak, skyBlend, createNeuralSun, createNeuralSky, neuralSkyGLSL,
  ATMO_SUN_N, ATMO_SKY_N,
} from './atmo.js';
import { ATMO_MODEL } from './atmo-weights.js';

const vec = JSON.parse(readFileSync(fileURLToPath(new URL('./atmo-test-vectors.json', import.meta.url)), 'utf8'));
const BR = [5.802e-3, 13.558e-3, 33.1e-3], BO = [0.650e-3, 1.881e-3, 0.085e-3];

test('sun network: JS forward pass reproduces Python (1e-4)', () => {
  let maxDiff = 0;
  const o = [0, 0, 0];
  for (let i = 0; i < vec.sun.DR.length; i++) {
    sunLogRGB(vec.sun.DR[i], vec.sun.DO[i], o);
    for (let c = 0; c < 3; c++) maxDiff = Math.max(maxDiff, Math.abs(o[c] - vec.sun.y[i][c]));
  }
  console.log(`  sun: max |JS - Python| = ${maxDiff.toExponential(2)} over ${vec.sun.DR.length} vectors, ${getAtmoNets().sun.params} params`);
  assert.ok(maxDiff < 1e-4);
});

test('sky network: JS forward pass reproduces Python (1e-4)', () => {
  let maxDiff = 0;
  const s = vec.sky;
  for (let i = 0; i < s.sunEl.length; i++) {
    const o = skyRaw(s.sunEl[i], s.ef[i], s.az[i], s.h[i], s.mie[i], s.cosg[i]);
    for (let c = 0; c < 6; c++) maxDiff = Math.max(maxDiff, Math.abs(o[c] - s.y[i][c]));
  }
  console.log(`  sky: max |JS - Python| = ${maxDiff.toExponential(2)} over ${s.sunEl.length} vectors, ${getAtmoNets().sky.params} params`);
  assert.ok(maxDiff < 1e-4);
  for (let i = 0; i < vec.peak.cos.length; i++) assert.ok(Math.abs(phasePeak(vec.peak.cos[i]) - vec.peak.p[i]) < 1e-6 * Math.max(1, vec.peak.p[i]));
});

test('sun texture: boot cost, matches the network, noon equals the classic colour, reddens toward the horizon', () => {
  const times = [];
  let s;
  for (let r = 0; r < 3; r++) { const t0 = performance.now(); s = createNeuralSun(); times.push(performance.now() - t0); }
  times.sort((a, b) => a - b);
  console.log(`  sun texture ${ATMO_SUN_N}x${ATMO_SUN_N}: build median ${times[1].toFixed(2)} ms`);
  assert.ok(times[1] < 50);
  assert.ok(s.texture instanceof THREE.DataTexture);
  assert.equal(s.texture.type, THREE.HalfFloatType);
  assert.equal(s.uniforms.tAtmSunNet.value, s.texture);
  assert.match(s.glsl, /vec3 atmNeuralSunT\(float dR, float dO\)/);
  // texture interpolation vs direct network
  const v = new THREE.Vector3(), o = [0, 0, 0];
  let maxRel = 0;
  for (let i = 0; i < 500; i++) {
    const DR = Math.random() * 300, DO = Math.random() * 500;
    s.sample(DR, DO, v); sunLogRGB(DR, DO, o);
    const ref = o.map(Math.exp), m = Math.max(...ref);
    maxRel = Math.max(maxRel, Math.abs(v.x - ref[0]) / m, Math.abs(v.y - ref[1]) / m, Math.abs(v.z - ref[2]) / m);
  }
  console.log(`  sun texture vs network: max colour error ${(maxRel * 100).toFixed(2)} %`);
  assert.ok(maxRel < 0.01);
  // overhead sun at sea level: the columns are ~8 km of air and ~15 km of ozone -> classic colour (noon look unchanged)
  s.sample(8, 15, v);
  const cl = [0, 1, 2].map((c) => Math.exp(-(BR[c] * 8 + BO[c] * 15)));
  assert.ok(Math.abs(v.x / cl[0] - 1) < 0.01 && Math.abs(v.y / cl[1] - 1) < 0.01 && Math.abs(v.z / cl[2] - 1) < 0.01, `noon ${v.toArray()} vs ${cl}`);
  // low sun: red / blue grows monotonically with the air column
  let prev = 0;
  for (const DR of [8, 30, 80, 150, 250]) {
    s.sample(DR, DR * 2, v);
    const rb = v.x / Math.max(v.z, 1e-9);
    assert.ok(rb > prev, `red/blue at DR=${DR}: ${rb}`);
    prev = rb;
  }
  s.dispose();
});

test('sky bake: fast, sane values, fades out at night, throttles', () => {
  const sky = createNeuralSky();
  const times = [];
  for (let r = 0; r < 5; r++) { const t0 = performance.now(); sky.bake((10 + r) * Math.PI / 180, 1.0, 0.04); times.push(performance.now() - t0); }
  times.sort((a, b) => a - b);
  console.log(`  sky bake ${ATMO_SKY_N}x${ATMO_SKY_N}: median ${times[2].toFixed(2)} ms`);
  assert.ok(times[2] < 25);
  for (const [sun, h] of [[60, 0], [5, 0], [-3, 0], [30, 20], [0.5, 10]]) {
    sky.bake(sun * Math.PI / 180, h, 0.04);
    let lo = Infinity, hi = 0, cmax = 0;
    for (let i = 0; i < sky.ratioData.length; i++) { lo = Math.min(lo, sky.ratioData[i]); hi = Math.max(hi, sky.ratioData[i]); cmax = Math.max(cmax, sky.columnData[i]); }
    assert.ok(lo > 0.05 && hi < 20 && Number.isFinite(hi), `ratio range at sun ${sun}: ${lo}..${hi}`);
    assert.ok(cmax >= 0 && cmax < 5, `column at sun ${sun}: ${cmax}`);
  }
  // the folded progressive evaluator equals the plain network
  {
    const sunEl = 0.3, h = 2.0, mie = 0.05, N = ATMO_SKY_N, beta = Math.acos(6371 / (6371 + h));
    sky.bake(sunEl, h, mie);
    const w = skyBlend(sunEl), lnN = ATMO_MODEL.skyNorm.map(Math.log);
    let md = 0;
    for (const [i, j] of [[0, 0], [5, 7], [31, 31], [17, 3], [2, 30]]) {
      const ef = (j / (N - 1)) ** 2, az = Math.PI * (i / (N - 1)) ** 2, el = ef * (Math.PI / 2 + beta) - beta;
      const cosg = Math.cos(el) * Math.cos(sunEl) * Math.cos(az) + Math.sin(el) * Math.sin(sunEl);
      const o = skyRaw(sunEl, ef, az, h, mie, cosg);
      for (let c = 0; c < 3; c++) {
        md = Math.max(md, Math.abs(sky.ratioData[(i + N * j) * 3 + c] - Math.exp(w * (o[c] - lnN[c]))));
        md = Math.max(md, Math.abs(sky.columnData[(i + N * j) * 3 + c] - Math.exp(o[3 + c])) / Math.exp(o[3 + c]));
      }
    }
    assert.ok(md < 1e-6, `bake vs network ${md}`);
  }
  // noon: the correction stays close to 1 on average (exposure / white balance unchanged)
  sky.bake(60 * Math.PI / 180, 0, 0.04);
  const mean = [0, 0, 0];
  for (let k = 0; k < ATMO_SKY_N * ATMO_SKY_N; k++) for (let c = 0; c < 3; c++) mean[c] += sky.ratioData[k * 3 + c] / (ATMO_SKY_N * ATMO_SKY_N);
  console.log(`  noon mean ratio ${mean.map((x) => x.toFixed(3)).join(' ')}`);
  for (const m of mean) assert.ok(Math.abs(m - 1) < 0.15);
  // night: no correction, no aureole
  sky.bake(-30 * Math.PI / 180, 0, 0.04);
  for (let i = 0; i < sky.ratioData.length; i++) { assert.equal(sky.ratioData[i], 1); assert.equal(sky.columnData[i], 0); }
  assert.equal(skyBlend(-30 * Math.PI / 180), 0);
  assert.ok(skyBlend(0) > 0.99);
  // throttle + progressive bake (8 rows per update: 4 calls per bake), matching the synchronous bake
  sky.bake(0.2, 1, 0.04);
  const ref = Float32Array.from(sky.ratioData);
  sky.bake(0.5, 3, 0.04);
  const n0 = sky.bakes;
  let done = 0;
  for (let i = 0; i < 4; i++) done += sky.update(0.2, 1, 0.04) ? 1 : 0;
  assert.equal(done, 1);
  assert.equal(sky.pending, false);
  for (let i = 0; i < ref.length; i++) assert.ok(Math.abs(ref[i] - sky.ratioData[i]) < 1e-9);
  assert.equal(sky.update(0.2 + 1e-5, 1.0001, 0.04), false);
  assert.equal(sky.pending, false);
  assert.equal(sky.update(0.25, 1, 0.04), false);
  assert.equal(sky.pending, true);
  assert.equal(sky.bakes, n0 + 1);
  assert.ok(sky.ratio instanceof THREE.DataTexture && sky.column instanceof THREE.DataTexture);
  sky.dispose();
});

test('GLSL chunk and model metadata', () => {
  const g = neuralSkyGLSL('model'), a = neuralSkyGLSL('sky');
  assert.match(g, /vec3 atmNeuralSkyRatio\(vec3 dir\)/);
  assert.match(a, /vec3 atmAureole\(vec3 dir\)/);
  assert.match(g, /uniform highp sampler2D tAtmNeuralSky;/);
  assert.match(a, /uniform highp sampler2D tAtmNeuralAur;/);
  assert.equal(ATMO_MODEL.limb.length, 3);
  assert.ok(ATMO_MODEL.limb[0] < ATMO_MODEL.limb[1] && ATMO_MODEL.limb[1] < ATMO_MODEL.limb[2]);
  assert.ok(phasePeak(1) > 10 && phasePeak(Math.cos(25 * Math.PI / 180)) === 0);
});
