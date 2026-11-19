// Ground-cover network: the JS runtime must reproduce the Python reference (tools/neural/ground) on exported
// vectors, and the generated GLSL must contain exactly the embedded weights.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GROUND_COVER_MODEL } from './ground-weights.js';
import { decodeGroundModel, groundInputs, groundForward, groundNetGLSL, groundEcoGLSL, GROUND_OUTPUTS, GROUND_N_IN } from './ground-cover.js';

const vectors = JSON.parse(readFileSync(new URL('./ground-test-vectors.json', import.meta.url), 'utf8'));
const net = decodeGroundModel();

test('ground cover: model layout', () => {
  assert.deepEqual(GROUND_COVER_MODEL.sizes[0], GROUND_N_IN);
  assert.equal(GROUND_COVER_MODEL.sizes.at(-1), GROUND_OUTPUTS.length);
  assert.deepEqual(GROUND_COVER_MODEL.outputs, GROUND_OUTPUTS);
  assert.deepEqual(vectors.outputs, GROUND_OUTPUTS);
  assert.equal(net.params, GROUND_COVER_MODEL.params);
  assert.ok(net.params < 4000, 'the network must stay tiny');
  for (const s of GROUND_COVER_MODEL.sizes) assert.equal(s % 4, 0, 'layer widths are multiples of 4 (vec4 / mat4 GLSL)');
});

test('ground cover: feature encoding matches Python', () => {
  assert.ok(vectors.vectors.length >= 40);
  const x = new Float64Array(GROUND_N_IN);
  let worst = 0;
  for (const v of vectors.vectors) {
    groundInputs(v.raw, v.lod, v.latK, x);
    for (let i = 0; i < GROUND_N_IN; i++) worst = Math.max(worst, Math.abs(x[i] - v.x[i]));
  }
  assert.ok(worst < 1e-9, `max input error ${worst}`);
});

test('ground cover: forward pass matches Python', () => {
  const x = new Float64Array(GROUND_N_IN), y = new Float64Array(GROUND_OUTPUTS.length);
  let worst = 0;
  for (const v of vectors.vectors) {
    groundForward(net, groundInputs(v.raw, v.lod, v.latK, x), y);
    for (let i = 0; i < y.length; i++) {
      assert.ok(y[i] >= 0 && y[i] <= 1);
      worst = Math.max(worst, Math.abs(y[i] - v.y[i]));
    }
  }
  assert.ok(worst < 1e-9, `max output error ${worst}`);
});

test('ground cover: outputs respond to the terrain as the simulation does', () => {
  // the same gentle, soil-covered slope at 1200 m (forest belt) and at 3600 m (above the snow line)
  const raw = (h) => [h, 0.2, 0.2, 0, 0, 0.2, 0.2, 0, 0, h, 0, h, 0, 0];
  const lo = groundForward(net, groundInputs(raw(1200), 0, -95), new Float64Array(12));
  const hi = groundForward(net, groundInputs(raw(3600), 0, -95), new Float64Array(12));
  const F = GROUND_OUTPUTS.indexOf('forest'), S = GROUND_OUTPUTS.indexOf('snow');
  assert.ok(lo[F] > 0.5 && hi[F] < 0.05, `forest ${lo[F]} -> ${hi[F]}`);
  assert.ok(hi[S] > lo[S] + 0.3, `snow ${lo[S]} -> ${hi[S]}`);
  // desert: no forest
  const dry = [...raw(900)]; dry[12] = 1;
  assert.ok(groundForward(net, groundInputs(dry, 0, -30), new Float64Array(12))[F] < 0.1);
});

test('ground cover: GLSL is generated from the same weights', () => {
  const glsl = groundNetGLSL(net);
  assert.match(glsl, /void terrEcoNet\(vec4 x0, vec4 x1, vec4 x2, vec4 x3, out vec4 oA, out vec4 oB, out vec4 oC\)/);
  const mats = glsl.match(/mat4\(/g).length;
  let expect = 0;
  for (const l of net.layers) expect += (l.nIn / 4) * (l.nOut / 4);
  assert.equal(mats, expect);
  // every literal is a valid GLSL float, and the weights appear in order
  const nums = [...glsl.matchAll(/(?:mat4|vec4)\(([^()]*)\)/g)].flatMap((m) => m[1].split(',').map((t) => t.trim()));
  assert.equal(nums.length, net.params);
  for (const t of nums) assert.ok(/^-?(\d+\.\d*|\.\d+|\d+)(e[-+]?\d+)?$/.test(t) && /[.e]/.test(t), `bad literal ${t}`);
  assert.ok(Math.abs(parseFloat(nums[0]) - net.layers[0].b[0]) < 1e-6 * Math.max(1, Math.abs(net.layers[0].b[0])));
  const full = groundEcoGLSL(net);
  assert.match(full, /TerrEco terrEco\(vec2 rxz, float h\)/);
  assert.ok(full.length < 60000);
});
