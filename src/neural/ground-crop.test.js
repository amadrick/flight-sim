import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeCropNet, cropForward, cropBRF, cropHDRF, cropClasses, foldAz, createGroundCrop, CROP_EVAL, NB, NV, NA } from './ground-crop.js';
import { CROP_SUN_NET, CROP_SKY_NET } from './ground-crop-weights.js';

const vec = JSON.parse(readFileSync(new URL('./crop-test-vectors.json', import.meta.url)));
const sun = decodeCropNet(CROP_SUN_NET), sky = decodeCropNet(CROP_SKY_NET);

test('crop networks: JS twin matches the Python reference', () => {
  for (const v of vec.sun) { const y = cropForward(sun, v.x); v.y.forEach((t, c) => assert.ok(Math.abs(y[c] - t) < 1e-5, `sun ${c} ${y[c]} ${t}`)); }
  for (const v of vec.sky) { const y = cropForward(sky, v.x); v.y.forEach((t, c) => assert.ok(Math.abs(y[c] - t) < 1e-5, `sky ${c}`)); }
});

test('crop network: beats the oracle Lambert albedo and the fitted RPV vegetation BRDF on held-out canopies', () => {
  const e = CROP_EVAL;
  assert.ok(e.network.ln_rmse < e.rpv.ln_rmse && e.network.ln_rmse < e.lambert_oracle.ln_rmse, JSON.stringify(e));
  assert.ok(e.sky.network < e.sky.lambert_oracle, JSON.stringify(e.sky));
});

test('crop features: folding by the row symmetries', () => {
  for (const [s, v] of [[0.3, 1.0], [-0.3, -1.0], [Math.PI - 0.3, Math.PI - 1.0], [0.3 - Math.PI, 1.0 - Math.PI]]) {
    const [fs, fv] = foldAz(s, v);
    assert.ok(Math.abs(fs - 0.3) < 1e-9 && Math.abs(Math.atan2(Math.sin(fv - 1.0), Math.cos(fv - 1.0))) < 1e-9, `${s},${v} -> ${fs},${fv}`);
  }
});

test('crop reflectance: physical sanity', () => {
  const C = cropClasses();
  const [young, green, ripe, , maize, rape] = C;
  // hot spot: looking down-sun is brighter than looking into the sun (tall green cereal, maize)
  for (const c of [green, maize]) {
    const hot = cropBRF(sun, c, 0.5, 0.6, 0.5, 0.6)[1], into = cropBRF(sun, c, 0.5, 0.6, 0.5, 0.6 + Math.PI)[1];
    assert.ok(hot > 1.2 * into, `hot ${hot} into ${into}`);
  }
  // colour: green crops reflect most in green, ripe cereal is redder than green cereal, flowering rape is yellow
  const a = (c) => cropHDRF(sky, c, 0.7, 0.3);
  assert.ok(a(green)[1] > a(green)[0] && a(green)[1] > a(green)[2], JSON.stringify(a(green)));
  assert.ok(a(ripe)[0] / a(ripe)[1] > a(green)[0] / a(green)[1]);
  assert.ok(a(rape)[0] > 2 * a(rape)[2] && a(rape)[1] > 2 * a(rape)[2]);
  for (let i = 0; i < 300; i++) {
    const r = (k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
    const c = C[i % 8];
    const b = cropBRF(sun, c, 0.06 + 0.94 * r(1), 6.28 * r(2), 0.05 + 0.95 * r(3), 6.28 * r(4));
    b.forEach((v) => assert.ok(v > 0 && v < 2 && Number.isFinite(v), `${v}`));
  }
  void young;
});

test('crop LUT: bakes finite factors around 1 for every class', () => {
  const g = createGroundCrop();
  g.update(0.6, true);
  assert.equal(g.data.length, NB * NV * NA * 8 * 4);
  let lo = 1e9, hi = -1e9, sum = 0;
  for (let i = 0; i < g.data.length; i += 4) { const k = g.data[i + 1]; lo = Math.min(lo, k); hi = Math.max(hi, k); sum += k; }
  const mean = sum / (g.data.length / 4);
  assert.ok(lo > 0.05 && hi < 8 && mean > 0.5 && mean < 2.5, `${lo} ${hi} ${mean}`);
  g.dispose();
});
