// The JS twins of the vegetation networks reproduce the Python (numpy) outputs on exported test vectors, and the
// baked LUT / CPU helpers behave physically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { vegDecode, canopyEval, crownEval, classicCrown, VEG_NET_META } from './veg.js';
import { VEG_CANOPY_NET, VEG_CROWN_NET } from './veg-weights.js';

const TV = JSON.parse(readFileSync(new URL('./test-vectors-veg.json', import.meta.url), 'utf8'));

test('canopy network: JS forward pass matches Python', () => {
  const net = vegDecode(VEG_CANOPY_NET);
  let worst = 0;
  TV.canopy.x.forEach((x, i) => {
    const o = canopyEval(net, x[0], x[1], x[2], x[3], x[4]);
    for (let k = 0; k < 5; k++) worst = Math.max(worst, Math.abs(o[k] - TV.canopy.y[i][k]));
  });
  assert.ok(worst < 1e-6, `max abs diff ${worst}`);
});

test('crown network: JS forward pass matches Python', () => {
  const net = vegDecode(VEG_CROWN_NET);
  let worst = 0;
  TV.crown.x.forEach((x, i) => {
    const o = crownEval(net, x[0], x[1], x[2], x[3], x[4], x[5]);
    for (let k = 0; k < 2; k++) worst = Math.max(worst, Math.abs(o[k] - TV.crown.y[i][k]));
  });
  assert.ok(worst < 1e-6, `max abs diff ${worst}`);
});

test('canopy BRF: hotspot brighter than the forward direction, conifers darker, values plausible', () => {
  const net = vegDecode(VEG_CANOPY_NET);
  const brf = (mus, muv, caz, c, k) => Math.exp(canopyEval(net, mus, muv, caz, c, k)[1]) - VEG_NET_META.eBrf;
  const mus = Math.sin(30 * Math.PI / 180);
  const hot = brf(mus, mus, 1, 0.9, 0), fwd = brf(mus, mus, -1, 0.9, 0);
  assert.ok(hot > 1.8 * fwd, `hotspot ${hot} vs forward ${fwd}`);
  const nadirB = brf(0.8, 1, 0, 0.9, 0), nadirC = brf(0.8, 1, 0, 0.9, 1);
  assert.ok(nadirC < nadirB, 'conifer canopies are darker');
  assert.ok(nadirB > 0.02 && nadirB < 0.15, `green BRF ${nadirB}`);
});

test('crown transfer: the sunlit top of a sparse stand gets more sun than the shaded core of a dense one', () => {
  const net = vegDecode(VEG_CROWN_NET);
  const top = crownEval(net, 0.95, 0.05, 1, 0.7, 0.2, 0)[0];
  const core = crownEval(net, 0.2, 0.9, -1, 0.3, 1.0, 1)[0];
  assert.ok(top > core + 0.3, `top ${top} core ${core}`);
  const [ts, sky] = classicCrown(0.5, 0.5, 0, 0.5, 0.5, 0);
  assert.ok(ts > 0 && ts < 1 && sky > 0 && sky < 1);
});
