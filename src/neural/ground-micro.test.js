import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeMicroModel, microForward, microK, bakeMicroLUT, sampleMicroLUT } from './ground-micro.js';
import { GROUND_MICRO_MODEL } from './ground-micro-weights.js';

const vec = JSON.parse(readFileSync(new URL('./ground-micro-test-vectors.json', import.meta.url)));
const net = decodeMicroModel();

test('micro-relief network: JS twin matches the numpy reference', () => {
  vec.x.forEach((x, i) => assert.ok(Math.abs(microForward(net, x[0], x[1], x[2], x[3]) - vec.y[i]) < 2e-5, `vector ${i}`));
});
test('micro-relief network: clearly better than the analytic baselines on held-out fields', () => {
  const e = Object.fromEntries(GROUND_MICRO_MODEL.eval.map((r) => [r.model.split('(')[0].split(' ')[0], r.rmse]));
  assert.ok(e.mlp < 0.5 * e['oren-nayar'] && e['oren-nayar'] < e.lambert, JSON.stringify(e));
});
test('micro-relief network: physical sanity', () => {
  assert.ok(Math.abs(microK(net, 1, 1, 0, 0.05) - 1) < 0.05, 'smooth ground at normal incidence is Lambertian');
  // rough ground, low sun: brighter looking down-sun than up-sun
  assert.ok(microK(net, 0.3, 0.5, 1, 0.6) > 1.5 * microK(net, 0.3, 0.5, -1, 0.6));
  for (const s of [0.1, 0.4, 0.8]) for (const cs of [0.1, 0.5, 1]) for (const cv of [0.1, 0.5, 1]) { const k = microK(net, cs, cv, 0.3, s); assert.ok(k >= 0 && k <= 3); }
});
test('micro-relief LUT reproduces the network', () => {
  const lut = bakeMicroLUT(net);
  let max = 0, sum = 0, n = 0;
  for (let i = 0; i < 4000; i++) {
    const r = (k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
    const cs = 0.1 + 0.9 * r(1), cv = 0.1 + 0.9 * r(2), cp = r(3) * 2 - 1, s = [0.15, 0.4, 0.7][i % 3];
    const e = Math.abs(sampleMicroLUT(lut, cs, cv, cp, s) - microK(net, cs, cv, cp, s)); max = Math.max(max, e); sum += e; n++;
  }
  assert.ok(sum / n < 0.01 && max < 0.12, `mean ${sum / n} max ${max}`);
});
