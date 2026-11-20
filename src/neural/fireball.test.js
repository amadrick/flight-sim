import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeFireball, fireballFeatures, fireballForwardRaw, fireballEval, fireballBox, fireballGLSL, packFireballWeights, FIREBALL_MODEL } from './fireball.js';

const vec = JSON.parse(readFileSync(new URL('./fireball-test-vectors.json', import.meta.url)));
const net = decodeFireball();

test('fireball net: feature encoding matches the Python reference', () => {
  const f = new Float64Array(FIREBALL_MODEL.sizes[0]);
  vec.inputs.forEach((p, i) => {
    fireballFeatures(net.enc, p[0], p[1], p[2], p[3], p[4], p[5], f);
    vec.features[i].forEach((v, k) => assert.ok(Math.abs(f[k] - v) < 1e-9, `vector ${i} feature ${k}: ${f[k]} vs ${v}`));
  });
});

test('fireball net: JS forward pass reproduces the trained network', () => {
  const f = new Float64Array(FIREBALL_MODEL.sizes[0]);
  vec.inputs.forEach((p, i) => {
    const o = fireballForwardRaw(net, fireballFeatures(net.enc, p[0], p[1], p[2], p[3], p[4], p[5], f));
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(o[c] - vec.outputs[i][c]) < 2e-5, `vector ${i} out ${c}: ${o[c]} vs ${vec.outputs[i][c]}`);
  });
});

test('fireball net: physical sanity of the learned fields', () => {
  const r = {};
  // early on the fireball is hot near the ground at the origin; nothing far up
  fireballEval(net, 0.2, 0, 0.3, 0.5, 0.3, 1, r);
  assert.ok(r.theta > 0.5, `hot core at t=0.5: theta ${r.theta}`);
  fireballEval(net, 0, 0, 6, 0.5, 0.3, 1, r);
  assert.ok(r.theta < 0.2 && r.soot < 0.2, 'nothing high up at t=0.5');
  // later the soot has risen: the soot centroid height increases with time
  const zc = (t) => { let m = 0, mz = 0; for (let x = -1; x <= 6; x += 0.5) for (let z = 0.1; z <= 7; z += 0.3) { fireballEval(net, x, 0.2, z, t, 0.3, 1, r); m += r.soot; mz += r.soot * z; } return mz / Math.max(m, 1e-9); };
  const z1 = zc(1), z6 = zc(6);
  assert.ok(z6 > z1 + 0.5, `soot rises: z(1)=${z1.toFixed(2)} z(6)=${z6.toFixed(2)}`);
  // wind carries it downwind
  const xc = (fw) => { let m = 0, mx = 0; for (let x = -2; x <= 8; x += 0.5) for (let z = 0.5; z <= 6; z += 0.5) { fireballEval(net, x, 0.2, z, 10, fw, 1, r); m += r.soot; mx += r.soot * x; } return mx / Math.max(m, 1e-9); };
  assert.ok(xc(1.0) > xc(0.0) + 0.5, 'wind shears the column downwind');
});

test('fireball bake box contains the domain origin and grows', () => {
  const b0 = fireballBox(0.2, 0.3), b1 = fireballBox(10, 0.3);
  assert.ok(b0.x0 < 0 && b0.x1 > 0 && b0.z1 > 0.3);
  assert.ok(b1.z1 >= b0.z1 && b1.x1 >= b0.x1);
});

test('fireball GLSL twin is generated from the same packed weights', () => {
  const g = fireballGLSL(net), p = packFireballWeights(net);
  assert.ok(g.includes('vec3 fireballFields(vec3 p, float t)') && g.includes('tFbWeights'));
  assert.equal(p.rows, FIREBALL_MODEL.sizes.slice(1).reduce((a, b) => a + b, 0));
  // spot check packing: first weight / bias of layer 0
  assert.equal(p.data[0], net.layers[0].W[0]);
  assert.equal(p.data[(p.width - 1) * 4], net.layers[0].b[0]);
});
