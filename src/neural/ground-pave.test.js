import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paveNets, paveSun, paveSky, bakePaveLUT, ggxBRF, dfgSpec, PAVE_EVAL, PNA, PNV } from './ground-pave.js';
import { turfForward } from './ground-turf.js';

const vec = JSON.parse(readFileSync(new URL('./pave-test-vectors.json', import.meta.url)));
const nets = paveNets();

test('pavement networks: JS twin matches the Python reference', () => {
  for (const [k, net] of [['PAVE_SUN', nets.sun], ['PAVE_SKY', nets.sky]]) {
    for (const v of vec[k]) { const y = turfForward(net, v.x); v.y.forEach((t, c) => assert.ok(Math.abs(y[c] - t) < 1e-5, `${k} ${c} ${y[c]} ${t}`)); }
  }
});
test('pavement network: beats the classic model, even fitted per tile, on held-out tiles', () => {
  for (const k of ['sun', 'sky']) {
    const e = PAVE_EVAL[k];
    assert.ok(e.network < e.classic_fit_oracle && e.network < e.classic, `${k} ${JSON.stringify(e)}`);
  }
});
test('pavement reflectance: physical sanity', () => {
  const s = [0, 0], k = [0, 0];
  for (let i = 0; i < 300; i++) {
    const r = (j) => { const x = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453; return x - Math.floor(x); };
    paveSun(nets, r(1) < 0.5 ? 0 : 1, 0.2 + 0.8 * r(2), r(3), r(4) * 0.3, 0.05 + 0.95 * r(5), 6.28 * r(6), 0.03 + 0.97 * r(7), 6.28 * r(8), s);
    assert.ok(s[0] > 0.1 && s[0] < 6 && s[1] >= 0 && s[1] < 20, JSON.stringify(s));
    paveSky(nets, r(1) < 0.5 ? 0 : 1, 0.2 + 0.8 * r(2), r(3), r(4) * 0.3, 0.03 + 0.97 * r(7), 6.28 * r(8), k);
    assert.ok(k[0] > 0.3 && k[0] < 2 && k[1] > 0 && k[1] < 0.5, JSON.stringify(k));
  }
  // grazing sky: the stones and grooves hide much of the sky's mirror image that a flat GGX surface shows
  paveSky(nets, 1, 0.6, 0, 0, 0.05, 0, k);
  assert.ok(k[1] < 0.8 * dfgSpec(0.05, 0.6), `Hs ${k[1]} vs ${dfgSpec(0.05, 0.6)}`);
  // classic helpers: GGX peaks in the mirror direction
  assert.ok(ggxBRF(0.5, 0, 0.5, Math.PI, 0.5) > 3 * ggxBRF(0.5, 0, 0.5, 0, 0.5));
  // LUT: finite factors in range
  const d = bakePaveLUT(new Float32Array(PNA * PNV * 16), 0.6, 1.0, 0.1);
  for (const v of d) assert.ok(Number.isFinite(v) && v >= 0 && v <= 8);
});
