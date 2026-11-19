// node --test src/neural/cloud-light.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLOUD_LIGHT_MODEL } from './weights-light.js';
import { createNeuralCloudLight, getCloudLightNets, lightNetJ, lightNetV, CLOUD_LIGHT_TRAINED } from './cloud-light.js';
import { createNeuralCloudScatter, createNeuralCloudScatter4 } from './cloud-scatter.js';

const vec = JSON.parse(readFileSync(fileURLToPath(new URL('./test-vectors-light.json', import.meta.url)), 'utf8'));

test('round-two networks: small, finite, JS forward pass == Python (1e-5)', () => {
  const { j, v } = getCloudLightNets();
  assert.ok(j.params + v.params < 1500, `networks should stay small: ${j.params} + ${v.params}`);
  let ej = 0, ev = 0;
  for (let i = 0; i < vec.tauSun.length; i++) {
    ej = Math.max(ej, Math.abs(lightNetJ(vec.tauSun[i], vec.tauUp[i], vec.cosTheta[i]) - vec.lnJms[i]));
    const o = lightNetV(vec.tauUp[i], vec.tauDown[i]);
    ev = Math.max(ev, Math.abs(o[0] - vec.lnVup[i]), Math.abs(o[1] - vec.lnVdown[i]));
  }
  console.log(`  max |ln J_ms JS - Python| ${ej.toExponential(2)}, max |ln V JS - Python| ${ev.toExponential(2)}`);
  assert.ok(ej < 1e-5 && ev < 1e-5);
});

test('round-two LUTs: CPU twin follows the network, sane physical ranges, fast build', () => {
  const m = createNeuralCloudLight({ phaseMax: 20 });
  assert.ok(m.info.buildMs < 1000, `build ${m.info.buildMs} ms`);
  let worst = 0;
  for (let i = 0; i < vec.tauSun.length; i++) {
    if (vec.tauUp[i] > CLOUD_LIGHT_TRAINED.tauUp || vec.tauSun[i] > CLOUD_LIGHT_TRAINED.tauSun) continue;   // clamped there
    const lut = Math.log(m.sampleMulti(vec.tauSun[i], vec.tauUp[i], vec.cosTheta[i]));
    worst = Math.max(worst, Math.abs(lut - vec.lnJms[i]));
  }
  console.log(`  LUT vs network: max |ln J_ms| difference ${worst.toFixed(3)} (32^3 trilinear)`);
  assert.ok(worst < 0.25, `LUT too coarse: ${worst}`);
  for (const [tu, td] of [[0, 0], [0.2, 30], [5, 5], [30, 0.2], [60, 60]]) {
    const [a, b] = m.sampleAmbient(tu, td);
    assert.ok(a > 0 && a < 1.3 && b > 0 && b < 1.3, `V(${tu}, ${td}) = ${a}, ${b}`);
  }
  // deep inside (much cloud above) the sky share drops, near the top it dominates
  assert.ok(m.sampleAmbient(0.1, 20)[0] > m.sampleAmbient(20, 0.1)[0]);
  // beyond the trained range (storm columns) the sky share keeps falling with the cloud above
  assert.ok(m.sampleAmbient(64, 10)[0] < 0.6 * m.sampleAmbient(20, 10)[0]);
  for (const c of [-1, -0.3, 0.5, 0.99]) for (const ts of [0, 1, 10, 60]) {
    const j = m.sample(ts, 3, c);
    assert.ok(Number.isFinite(j) && j > 0 && j < 25, `J(${ts}, 3, ${c}) = ${j}`);
  }
  assert.match(m.glsl, /float cloudSunScatter\(float tauSun, float tauUp, float cosTheta\)/);
  assert.match(m.glsl, /vec2 cloudAmbientVis\(float tauUp, float tauDown\)/);
  m.dispose();
});

test('createNeuralCloudScatter defaults to round two; the 4-feature model is folded into it', () => {
  const s = createNeuralCloudScatter({ phaseMax: 20 });
  assert.equal(s.info.kind, 'neural-light-v2');
  assert.ok(s.uniforms.tCloudLightJ && s.uniforms.tCloudLightAmb);
  assert.equal(createNeuralCloudScatter4({ phaseMax: 20 }), null);
  assert.ok(createNeuralCloudScatter4({ version: 1 }));
  assert.equal(CLOUD_LIGHT_MODEL.meta.pmax, 20);
  s.dispose();
});
