// node --test src/neural/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { CLOUD_SCATTER_MODEL } from './weights.js';
import { decodeModel, logJms, scatterJ, cloudPhase, encodeFeatures } from './mlp.js';
import {
  createNeuralCloudScatter, createAnalyticCloudScatter, bakeScatterLUT, getCloudScatterNet, lutAxes,
  neuralScatterGLSL, analyticScatterGLSL, analyticScatterJ, CLOUD_SCATTER_LUT_SIZE,
  hasCloudScatter4, getCloudScatterNet4, createNeuralCloudScatter4, hasThickPriorNet,
} from './cloud-scatter.js';

const vec = JSON.parse(readFileSync(fileURLToPath(new URL('./test-vectors.json', import.meta.url)), 'utf8'));
const net = decodeModel(CLOUD_SCATTER_MODEL);

test('weights decode to the advertised parameter count', () => {
  assert.equal(net.params, CLOUD_SCATTER_MODEL.meta.params);
  assert.ok(net.params <= 5000, `network should stay small, got ${net.params} parameters`);
  for (const l of [...net.body, ...net.ang]) {
    for (const w of l.W) assert.ok(Number.isFinite(w));
    for (const b of l.b) assert.ok(Number.isFinite(b));
  }
});

test('JS forward pass reproduces the Python model on stored test vectors (1e-4)', () => {
  let maxLn = 0, maxRel = 0;
  for (let i = 0; i < vec.lnJms.length; i++) {
    const y = logJms(net, vec.tauSun[i], vec.tauUp[i], vec.cosTheta[i]);
    maxLn = Math.max(maxLn, Math.abs(y - vec.lnJms[i]));
    const j = scatterJ(net, vec.tauSun[i], vec.tauUp[i], vec.cosTheta[i]);
    maxRel = Math.max(maxRel, Math.abs(j - vec.J[i]) / vec.J[i]);
  }
  console.log(`  max |ln J_ms (JS) - ln J_ms (Python)| = ${maxLn.toExponential(2)}, max rel diff of J = ${maxRel.toExponential(2)} over ${vec.lnJms.length} vectors`);
  assert.ok(maxLn < 1e-4, `ln J_ms mismatch ${maxLn}`);
  assert.ok(maxRel < 1e-4, `J mismatch ${maxRel}`);
});

test('phase function is normalised and matches the training phase function', () => {
  // integrate over the sphere with a log-spaced theta grid (the forward peak is ~1 degree wide)
  let sum = 0, mean = 0;
  const n = 200000;
  let prevT = 0, prevF = 0, prevM = 0;
  for (let i = 1; i <= n; i++) {
    const t = Math.exp(Math.log(1e-7) + (Math.log(Math.PI) - Math.log(1e-7)) * i / n);
    const c = Math.cos(t);
    const f = cloudPhase(c, net.phase) * Math.sin(t) * 2 * Math.PI;
    sum += 0.5 * (f + prevF) * (t - prevT);
    mean += 0.5 * (f * c + prevM) * (t - prevT);
    prevT = t; prevF = f; prevM = f * c;
  }
  assert.ok(Math.abs(sum - 1) < 1e-4, `phase integral ${sum}`);
  assert.ok(Math.abs(mean - net.phase.gMean) < 1e-4, `mean cosine ${mean} vs ${net.phase.gMean}`);
});

test('LUT bake: matches Python grid values, finite, fast', () => {
  const n = CLOUD_SCATTER_LUT_SIZE;
  assert.equal(vec.lutSize, n);
  const times = [];
  let lut;
  for (let r = 0; r < 7; r++) { lut = bakeScatterLUT(net, n); times.push(lut.ms); }
  times.sort((a, b) => a - b);
  let maxDiff = 0;
  for (const [i, j, k, v] of vec.lutSamples) maxDiff = Math.max(maxDiff, Math.abs(lut.data[i + n * (j + n * k)] - v));
  let mean = 0;
  for (const v of lut.data) { assert.ok(Number.isFinite(v)); mean += v; }
  mean /= lut.data.length;
  console.log(`  LUT ${n}^3 bake: median ${times[3].toFixed(2)} ms (min ${times[0].toFixed(2)}), max |JS - Python| on 64 nodes = ${maxDiff.toExponential(2)}`);
  assert.ok(maxDiff < 1e-4, `LUT node mismatch ${maxDiff}`);
  assert.ok(Math.abs(mean - vec.lutMean) < 1e-4, `LUT mean ${mean} vs ${vec.lutMean}`);
  assert.ok(times[3] < 50, `LUT bake too slow: ${times[3]} ms`);
});

test('createNeuralCloudScatter: texture, uniforms, GLSL and build time', () => {
  const times = [];
  let s;
  for (let r = 0; r < 5; r++) {
    const t0 = performance.now();
    s = createNeuralCloudScatter({ version: 1 });
    times.push(performance.now() - t0);
    if (r < 4) s.dispose();
  }
  times.sort((a, b) => a - b);
  console.log(`  createNeuralCloudScatter({ version: 1 }): median ${times[2].toFixed(2)} ms (bake ${s.info.bakeMs.toFixed(2)} ms), ${s.info.params} parameters`);
  assert.ok(times[2] < 50, `build too slow: ${times[2]} ms`);
  assert.ok(s.texture instanceof THREE.Data3DTexture);
  assert.equal(s.uniforms.tCloudScatterLUT.value, s.texture);
  assert.equal(s.texture.type, THREE.HalfFloatType);
  assert.equal(s.texture.format, THREE.RedFormat);
  assert.equal(s.texture.minFilter, THREE.LinearFilter);
  assert.equal(s.texture.magFilter, THREE.LinearFilter);
  assert.equal(s.texture.wrapR, THREE.ClampToEdgeWrapping);
  const { width, height, depth, data } = s.texture.image;
  assert.deepEqual([width, height, depth], [32, 32, 32]);
  assert.equal(data.length, 32 * 32 * 32);
  for (const g of [s.glsl, createAnalyticCloudScatter().glsl]) {
    assert.match(g, /float cloudSunScatter\(float tauSun, float tauUp, float cosTheta\)/);
    assert.doesNotMatch(g, /NaN|undefined|Infinity/);
    assert.equal((g.match(/{/g) || []).length, (g.match(/}/g) || []).length);
  }
  assert.match(s.glsl, /uniform highp sampler3D tCloudScatterLUT;/);
  assert.doesNotMatch(createAnalyticCloudScatter().glsl, /sampler3D/);
  // both chunks can live in one shader under different names (A/B) thanks to the phase-function guard
  const ab = neuralScatterGLSL() + analyticScatterGLSL(CLOUD_SCATTER_MODEL, { functionName: 'cloudSunScatterAnalytic' });
  assert.match(ab, /float cloudSunScatterAnalytic\(/);
});

test('LUT sampling (CPU twin of the GLSL): finite, non-negative, correct limits, close to the network', () => {
  const s = createNeuralCloudScatter({ version: 1 });
  const ph = net.phase;
  // random points inside the trained range: LUT interpolation error against the direct network
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const errs = [];
  for (let i = 0; i < 20000; i++) {
    const ts = Math.expm1(rnd() * Math.log1p(128)), tu = Math.expm1(rnd() * Math.log1p(128));
    const c = Math.cos(Math.exp(Math.log(1e-3) + rnd() * (Math.log(Math.PI) - Math.log(1e-3))));
    const a = s.sample(ts, tu, c), b = scatterJ(net, ts, tu, c);
    assert.ok(Number.isFinite(a) && a >= 0, `J(${ts}, ${tu}, ${c}) = ${a}`);
    assert.ok(a >= cloudPhase(c, ph) * Math.exp(-ts), 'J must not be below single scattering');
    errs.push(Math.abs(a - b) / b);
  }
  errs.sort((x, y) => x - y);
  const med = errs[errs.length >> 1], p99 = errs[Math.floor(errs.length * 0.99)], mx = errs[errs.length - 1];
  console.log(`  LUT (trilinear, half float) vs direct network: median rel err ${(med * 100).toFixed(3)} %, 99th pct ${(p99 * 100).toFixed(2)} %, max ${(mx * 100).toFixed(2)} %`);
  assert.ok(med < 0.01, `median LUT error ${med}`);
  assert.ok(p99 < 0.08, `99th percentile LUT error ${p99}`);

  // limits and out-of-range behaviour
  for (const c of [1, 0.5, 0, -1]) {
    // far outside the table: single scattering has vanished, J saturates at the table edge (no blow-up, no NaN)
    const big = s.sample(1e6, 1e6, c), edge = s.sample(128, 128, c);
    assert.ok(Number.isFinite(big) && big >= 0);
    assert.ok(Math.abs(big - edge) <= 1e-9 * Math.max(1, edge));
    // negative / garbage inputs are clamped
    assert.ok(Number.isFinite(s.sample(-1, -5, c * 3)));
    // single scattering present in full at the lit surface
    assert.ok(s.sample(0, 0, c) >= cloudPhase(c, ph));
  }
  // deep inside a cloud the sun-lit source function is small but strictly positive (diffuse light)
  const deep = s.sample(60, 30, 0);
  assert.ok(deep > 0 && deep < 0.2, `deep J = ${deep}`);
  // multiple scattering brightens optically thick cloud well beyond single scattering at side angles
  assert.ok(s.sample(3, 2, 0) > 5 * cloudPhase(0, ph) * Math.exp(-3));
  // forward scattering (looking toward the sun through thin cloud) is far brighter than side scattering
  assert.ok(s.sample(0.3, 0.2, 0.9999) > 50 * s.sample(0.3, 0.2, 0));
  s.dispose();
});

test('LUT axes invert the feature encoding', () => {
  const n = CLOUD_SCATTER_LUT_SIZE;
  const { u, tau, cosT } = lutAxes(n, net.enc);
  const x = new Float64Array(5);
  for (let i = 0; i < n; i++) {
    encodeFeatures(tau[i], tau[n - 1 - i], cosT[i], net.enc, x);
    assert.ok(Math.abs(x[0] - u[i]) < 1e-9 && Math.abs(x[1] - u[n - 1 - i]) < 1e-9 && Math.abs(x[2] - u[i]) < 1e-6);
  }
  assert.equal(getCloudScatterNet().params, net.params);
});

test('analytic fallback: finite, includes single scattering', () => {
  for (const ts of [0, 0.5, 4, 40, 400]) for (const c of [1, 0.9, 0, -1]) {
    const j = analyticScatterJ(ts, 1, c);
    assert.ok(Number.isFinite(j) && j >= cloudPhase(c, net.phase) * Math.exp(-ts));
  }
  assert.equal(createAnalyticCloudScatter().sample(2, 1, 0.3), analyticScatterJ(2, 1, 0.3));
});

// ---------------------------------------------------------------------------- optional 4-feature model (+ tauDown)
test('4-feature model: JS forward pass reproduces Python (1e-4)', { skip: !hasCloudScatter4() }, () => {
  const net4 = getCloudScatterNet4();
  assert.ok(net4.params <= 5000);
  let maxLn = 0, maxRel = 0;
  for (let i = 0; i < vec.lnJms4.length; i++) {
    const y = logJms(net4, vec.tauSun[i], vec.tauUp[i], vec.cosTheta[i], vec.tauDown[i]);
    maxLn = Math.max(maxLn, Math.abs(y - vec.lnJms4[i]));
    const j = scatterJ(net4, vec.tauSun[i], vec.tauUp[i], vec.cosTheta[i], vec.tauDown[i]);
    maxRel = Math.max(maxRel, Math.abs(j - vec.J4[i]) / vec.J4[i]);
  }
  console.log(`  4-feature: max |ln J_ms (JS) - (Python)| = ${maxLn.toExponential(2)}, max rel diff of J = ${maxRel.toExponential(2)}`);
  assert.ok(maxLn < 1e-4 && maxRel < 1e-4);
});

test('4-feature model: factor textures, GLSL, CPU twin close to the network, build time', { skip: !hasCloudScatter4() }, () => {
  const net4 = getCloudScatterNet4();
  const times = [];
  let s;
  for (let r = 0; r < 5; r++) {
    const t0 = performance.now();
    s = createNeuralCloudScatter4({ version: 1 });
    times.push(performance.now() - t0);
    if (r < 4) s.dispose();
  }
  times.sort((a, b) => a - b);
  assert.match(s.glsl, /float cloudSunScatter4\(float tauSun, float tauUp, float cosTheta, float tauDown\)/);
  assert.doesNotMatch(s.glsl, /NaN|undefined|Infinity/);
  assert.equal((s.glsl.match(/{/g) || []).length, (s.glsl.match(/}/g) || []).length);
  assert.equal(s.textures.length, net4.rank / 2);
  for (const name of Object.keys(s.uniforms)) assert.ok(s.glsl.includes(name), `uniform ${name} declared`);
  for (const t of s.textures) {
    assert.equal(t.type, THREE.HalfFloatType);
    assert.equal(t.format, THREE.RGBAFormat);
    assert.equal(t.minFilter, THREE.LinearFilter);
  }
  let seed = 4242;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const errs = [];
  for (let i = 0; i < 20000; i++) {
    const ts = Math.expm1(rnd() * Math.log1p(128)), tu = Math.expm1(rnd() * Math.log1p(128)), td = Math.expm1(rnd() * Math.log1p(128));
    const c = Math.cos(Math.exp(Math.log(1e-3) + rnd() * (Math.log(Math.PI) - Math.log(1e-3))));
    const a = s.sample(ts, tu, c, td), b = scatterJ(net4, ts, tu, c, td);
    assert.ok(Number.isFinite(a) && a >= cloudPhase(c, net4.phase) * Math.exp(-ts));
    errs.push(Math.abs(a - b) / b);
  }
  errs.sort((x, y) => x - y);
  const med = errs[errs.length >> 1], p99 = errs[Math.floor(errs.length * 0.99)];
  console.log(`  4-feature: build median ${times[2].toFixed(1)} ms (bake ${s.info.bakeMs.toFixed(1)} ms); factor textures vs direct network: median rel err ${(med * 100).toFixed(2)} %, 99th pct ${(p99 * 100).toFixed(1)} %`);
  assert.ok(med < 0.03, `median factor-LUT error ${med}`);
  assert.ok(p99 < 0.30, `99th percentile factor-LUT error ${p99}`);
  assert.ok(Number.isFinite(s.sample(1e6, 1e6, 0.3, 1e6)) && Number.isFinite(s.sample(-1, -1, 2, -1)));
  s.dispose();
});

test('prior option: thick-prior network reproduces Python; it is brighter at thick-cloud tops; numeric prior blends', () => {
  if (!hasThickPriorNet()) { console.log('  (thick-prior network not embedded - skipped)'); return; }
  const netT = getCloudScatterNet('thick');
  assert.notEqual(netT, getCloudScatterNet());
  assert.equal(getCloudScatterNet('dataset'), getCloudScatterNet());
  let maxLn = 0;
  for (let i = 0; i < vec.lnJmsThickPrior.length; i++) {
    maxLn = Math.max(maxLn, Math.abs(logJms(netT, vec.tauSun[i], vec.tauUp[i], vec.cosTheta[i]) - vec.lnJmsThickPrior[i]));
  }
  assert.ok(maxLn < 1e-4, `thick-prior ln J_ms mismatch ${maxLn}`);
  const data = createNeuralCloudScatter({ version: 1 }), thick = createNeuralCloudScatter({ version: 1, prior: 'thick' }), mid = createNeuralCloudScatter({ version: 1, prior: 0.5 });
  assert.equal(data.info.prior, 'dataset');
  assert.equal(thick.info.prior, 'thick');
  assert.equal(mid.info.prior, 0.5);
  assert.equal(data.info.meta.prior, 'dataset');
  assert.equal(thick.info.meta.prior, 'thick');
  // just below the sun-lit top, looking back from the sun side: the two priors must differ in the expected direction
  const a = thick.sampleMulti(0.5, 0.4, -0.7), b = data.sampleMulti(0.5, 0.4, -0.7), m = mid.sampleMulti(0.5, 0.4, -0.7);
  console.log(`  J_ms just below a sun-lit top (tauSun 0.5, tauUp 0.4, back-scatter): dataset prior ${b.toFixed(4)}, thick prior ${a.toFixed(4)}, blend 0.5 ${m.toFixed(4)}; max |JS - Python| = ${maxLn.toExponential(2)}`);
  assert.ok(a > 1.3 * b, 'thick-column prior should be clearly brighter near the top surface');
  assert.ok(Math.abs(m - Math.sqrt(a * b)) < 0.02 * m, 'numeric prior blends ln J_ms');
  // deep inside (tauUp large) the population prior hardly matters
  const da = thick.sampleMulti(40, 30, -0.2), db = data.sampleMulti(40, 30, -0.2);
  assert.ok(Math.abs(Math.log(da / db)) < 0.7, `deep interior should not depend strongly on the prior: ${da} vs ${db}`);
  thick.dispose(); data.dispose(); mid.dispose();
});
