// node --test src/neural/flare.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FLARE_MODEL } from './flare-weights.js';
import { getFlareNets, evalMeta, evalGhost, evalStar, bakeFlare, flareGLSL, createNeuralFlare, FLARE_CONSTS, STAR_TEX } from './flare.js';

const vec = JSON.parse(readFileSync(fileURLToPath(new URL('./flare-test-vectors.json', import.meta.url)), 'utf8'));
const net = getFlareNets();

test('flare weights decode, finite, small', () => {
  const total = net.params.meta + net.params.ghost + net.params.star;
  assert.equal(net.params.meta, FLARE_MODEL.meta.params.meta);
  assert.equal(net.params.ghost, FLARE_MODEL.meta.params.ghost);
  assert.equal(net.params.star, FLARE_MODEL.meta.params.star);
  assert.ok(total < 40000, `flare networks should stay small, got ${total}`);
  for (const L of [net.meta, net.star, ...net.ghost]) for (const l of L) {
    for (const w of l.W) assert.ok(Number.isFinite(w));
    for (const b of l.b) assert.ok(Number.isFinite(b));
  }
});

test('JS forward passes reproduce Python on the exported test vectors', () => {
  let em = 0, eg = 0, es = 0;
  vec.meta.r.forEach((r, i) => {
    const y = evalMeta(r, net);
    y.forEach((v, k) => {
      const ref = vec.meta.out[i][k];
      em = Math.max(em, Math.abs(v - ref) / Math.max(Math.abs(ref), 1e-9));
    });
  });
  vec.ghost.g.forEach((g, i) => {
    const y = evalGhost(g, vec.ghost.r[i], vec.ghost.qa[i], vec.ghost.qc[i], net);
    for (let c = 0; c < 3; c++) eg = Math.max(eg, Math.abs(y[c] - vec.ghost.out[i][c]));
  });
  vec.star.r.forEach((r, i) => {
    const y = evalStar(r, vec.star.phi[i], net);
    for (let c = 0; c < 3; c++) es = Math.max(es, Math.abs(y[c] - vec.star.out[i][c]));
  });
  console.log(`  max rel diff meta ${em.toExponential(2)}, max abs diff ghost image ${eg.toExponential(2)}, star log10 ${es.toExponential(2)}`);
  assert.ok(em < 1e-6, `meta mismatch ${em}`);
  assert.ok(eg < 1e-6, `ghost mismatch ${eg}`);
  assert.ok(es < 1e-6, `star mismatch ${es}`);
});

test('bake: finite textures of the advertised size, plausible physics', () => {
  const b = bakeFlare(net);
  const G = net.G;
  assert.equal(b.ghost.length, FLARE_CONSTS.NQA * FLARE_CONSTS.NQC * G * FLARE_CONSTS.NR * 4);
  assert.equal(b.star.length, STAR_TEX.w * STAR_TEX.h * 4);
  for (const a of [b.ghost, b.star, b.meta]) for (const v of a) assert.ok(Number.isFinite(v));
  // ghost images are non-negative; ghost fluxes are 1e-6..1e-4 of the sun (two coated reflections)
  for (let i = 0; i < b.ghost.length; i++) assert.ok(b.ghost[i] >= 0);
  const m0 = evalMeta(0.3, net);
  for (let g = 0; g < G; g++) assert.ok(m0[4 * g + 3] > 1e-6 && m0[4 * g + 3] < 2e-4, `ghost ${g} flux ${m0[4 * g + 3]}`);
  // starburst: brighter on a spike than between spikes, falls with distance
  const on = evalStar(0.05, 0, net)[1], off = evalStar(0.05, Math.PI / 6, net)[1], far = evalStar(0.5, 0, net)[1];
  assert.ok(on > off + 0.3, `spike contrast ${on} vs ${off}`);
  assert.ok(far < on - 1, `falloff ${on} -> ${far}`);
  console.log(`  bake ${b.ms.toFixed(0)} ms (ghosts ${b.ghostMs.toFixed(0)} ms)`);
  assert.ok(b.ms < 3000, `bake too slow: ${b.ms} ms`);
});

test('GLSL chunk and runtime object', () => {
  const s = flareGLSL();
  assert.match(s, /vec3 flareNeural\(vec2 p, vec2 s, vec3 E\)/);
  assert.ok(!/NaN|undefined|Infinity/.test(s));
  const f = createNeuralFlare();
  f.update(0.8, 0.3, Math.tan(Math.PI / 6), 1);
  const P = f.uniforms.uFlareParams.value;
  assert.ok(Math.abs(P.x - 3) < 1e-9);
  for (const v of f.uniforms.uFlareGhost.value) assert.ok(Number.isFinite(v.x + v.y + v.z + v.w) && v.w >= 0);
  f.update(5, 5, 0.5);                          // far off screen: no ghosts
  for (const v of f.uniforms.uFlareGhost.value) assert.equal(v.w, 0);
  f.dispose();
});
