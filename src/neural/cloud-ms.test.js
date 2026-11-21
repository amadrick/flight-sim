// node --test src/neural/cloud-ms.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLOUD_MS_MODEL } from './cloud-ms-weights.js';
import { CLOUD_MIE_TABLES } from './cloud-mie-weights.js';
import { createCloudMultiScatter, cloudMsLight, getCloudMsNet, cloudMieTable } from './cloud-ms.js';

const vec = JSON.parse(readFileSync(fileURLToPath(new URL('./test-vectors-ms.json', import.meta.url)), 'utf8'));

test('multiple-scattering network: small, JS forward pass == Python on stored vectors', () => {
  const net = getCloudMsNet();
  assert.ok(net.params < 1500, `network should stay small enough for per-sample GLSL: ${net.params}`);
  let worst = 0;
  for (let i = 0; i < vec.tauSun.length; i++) {
    const taps = {};
    for (const d of CLOUD_MS_MODEL.desc.dirs) taps[d] = vec.taps[d][i];
    const y = cloudMsLight(vec.tauSun[i], vec.tauCam[i], vec.muSun[i], vec.cosTheta[i], taps);
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(Math.log(y[k]) - Math.log(vec.out[i][k])));
  }
  console.log(`  max |ln y JS - Python| ${worst.toExponential(2)} over ${vec.tauSun.length} vectors`);
  assert.ok(worst < 1e-5);
});

test('multiple-scattering network: physically sane outputs', () => {
  const z3 = [0, 0, 0];
  const tap = (v) => Object.fromEntries(CLOUD_MS_MODEL.desc.dirs.map((d) => [d, v[d] ?? z3]));
  const K = CLOUD_MS_MODEL.desc.ends.length;
  const full = (t) => new Array(K).fill(t);
  for (const ts of [0, 1, 5, 20, 80]) for (const c of [-1, 0, 0.9]) for (const mu of [0.05, 0.5, 1]) {
    const y = cloudMsLight(ts, 2, mu, c, tap({ up: full(1), down: full(3), fwd: full(2) }));
    for (const v of y) assert.ok(Number.isFinite(v) && v >= 0 && v < 3, `y(${ts}, ${c}, ${mu}) = ${y}`);
  }
  // deep under a thick column the sky share falls; near the top it is large
  const top = cloudMsLight(1, 2, 0.7, 0, tap({ up: full(0), down: full(30), fwd: full(5) }))[1];
  const bottom = cloudMsLight(40, 2, 0.7, 0, tap({ up: full(30), down: full(0), fwd: full(5) }))[1];
  assert.ok(top > bottom, `V_sky top ${top} vs bottom ${bottom}`);
  // ground light reaches the base more than the top
  const gTop = cloudMsLight(1, 2, 0.7, 0, tap({ up: full(0), down: full(30), fwd: full(5) }))[2];
  const gBot = cloudMsLight(40, 2, 0.7, 0, tap({ up: full(30), down: full(0), fwd: full(5) }))[2];
  assert.ok(gBot > gTop, `V_gnd base ${gBot} vs top ${gTop}`);
});

test('Mie phase tables: normalised, forward peak, fogbow and glory where Mie puts them', () => {
  const m = cloudMieTable(10);
  const C = m.c, nu = m.nu;
  const thOf = (u) => Math.PI / 2 + Math.atan((u - 0.5) * 2 * Math.tan(C * Math.PI / 2)) / C;
  for (let b = 0; b < 3; b++) {
    // integral over the sphere by quadrature in theta on the u grid
    let s = 0;
    for (let k = 0; k < nu - 1; k++) {
      const t0 = thOf(k / (nu - 1)), t1 = thOf((k + 1) / (nu - 1));
      s += 0.5 * (m.table[b][k] * Math.sin(t0) + m.table[b][k + 1] * Math.sin(t1)) * (t1 - t0) * 2 * Math.PI;
    }
    assert.ok(Math.abs(s - 1) < 0.02, `band ${b}: integral ${s}`);
    assert.ok(m.table[b][0] > 300 && m.table[b][0] < 1500, `forward peak ${m.table[b][0]}`);
    // fogbow: local maximum between 130 and 150 deg above the side minimum
    let best = 0, bestTh = 0, minSide = 1e9;
    for (let k = 0; k < nu; k++) {
      const th = thOf(k / (nu - 1)) * 180 / Math.PI;
      if (th > 125 && th < 155 && m.table[b][k] > best) { best = m.table[b][k]; bestTh = th; }
      if (th > 90 && th < 120) minSide = Math.min(minSide, m.table[b][k]);
    }
    assert.ok(bestTh > 136 && bestTh < 146 && best > 3 * minSide, `fogbow at ${bestTh} deg, ${best} vs side ${minSide}`);
    assert.ok(m.table[b][nu - 1] > 10 * minSide, `glory ${m.table[b][nu - 1]}`);
  }
  assert.ok(Math.abs(m.g[1] - 0.864) < 0.01, `g ${m.g[1]}`);
  assert.equal(CLOUD_MIE_TABLES.reffs.length, 3);
  // larger droplets: sharper forward peak
  assert.ok(cloudMieTable(16).table[1][0] > cloudMieTable(6).table[1][0] * 3);
});

test('createCloudMultiScatter: GLSL contract, uniforms, CPU twins, fast build', () => {
  const ms = createCloudMultiScatter({ reff: 10 });
  assert.ok(ms.info.buildMs < 200, `build ${ms.info.buildMs} ms`);
  const args = CLOUD_MS_MODEL.desc.dirs.map((d) => `tap${d[0].toUpperCase()}${d.slice(1)}`).join(', vec3 ');
  assert.ok(ms.glsl.includes(`vec3 cloudMsLight(float tauSun, float tauCam, float muSun, float cosTheta, vec3 ${args})`));
  assert.match(ms.glsl, /float cloudMsForwardPeak\(float tauSun, float phase\)/);
  assert.match(ms.glsl, /vec3 cloudPhaseMie\(float cosTheta\)/);
  assert.match(ms.glsl, /#ifdef CLOUD_MS_SIGMA/);
  assert.ok(ms.uniforms.tCloudMie.value.isDataTexture);
  // forward-peak term: zero without cloud, positive inside, never above the plain beam
  assert.equal(ms.forwardPeak(0, 1), 0);
  assert.ok(ms.forwardPeak(3, 0.5) > 0 && ms.forwardPeak(3, 0.5) < 0.5);
  // v2 aureole: large within ~2 deg of the sun behind a thin veil, gone by 10 deg
  const c1 = Math.cos(Math.PI / 180), c10 = Math.cos(10 * Math.PI / 180);
  const p1 = ms.phase(c1)[1];
  assert.ok(ms.forwardPeak(2, p1, c1) > 3 * ms.forwardPeak(2, p1), `aureole ${ms.forwardPeak(2, p1, c1)} vs ${ms.forwardPeak(2, p1)}`);
  assert.equal(ms.forwardPeak(2, ms.phase(c10)[1], c10), ms.forwardPeak(2, ms.phase(c10)[1]));
  assert.match(ms.glsl, /float cloudMsForwardPeak\(float tauSun, float phase, float cosTheta\)/);
  const p = ms.phase(1), pb = ms.phase(-1), ps = ms.phase(Math.cos(100 * Math.PI / 180));
  assert.ok(p[1] > 300 && pb[1] > 5 * ps[1]);
  assert.ok(!/\bNaN\b|Infinity/.test(ms.glsl));
  ms.dispose();
});

test('round-seven weights (game fields): JS forward pass == Python, same descriptor, sane, valid GLSL', async () => {
  const { CLOUD_MS_MODEL_R7 } = await import('./cloud-ms-weights-r7.js');
  const v7 = JSON.parse(readFileSync(fileURLToPath(new URL('./test-vectors-ms-r7.json', import.meta.url)), 'utf8'));
  assert.deepEqual(CLOUD_MS_MODEL_R7.desc.dirs, CLOUD_MS_MODEL.desc.dirs);
  assert.deepEqual(CLOUD_MS_MODEL_R7.desc.ends, CLOUD_MS_MODEL.desc.ends);
  assert.ok(getCloudMsNet(CLOUD_MS_MODEL_R7).params < 1500);
  let worst = 0;
  for (let i = 0; i < v7.tauSun.length; i++) {
    const taps = {};
    for (const d of CLOUD_MS_MODEL_R7.desc.dirs) taps[d] = v7.taps[d][i];
    const y = cloudMsLight(v7.tauSun[i], v7.tauCam[i], v7.muSun[i], v7.cosTheta[i], taps, CLOUD_MS_MODEL_R7);
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(Math.log(y[k]) - Math.log(v7.out[i][k])));
  }
  assert.ok(worst < 1e-5, `max |ln y JS - Python| ${worst}`);
  const full = (t) => new Array(CLOUD_MS_MODEL_R7.desc.ends.length).fill(t);
  const top = cloudMsLight(1, 2, 0.7, 0, { up: full(0), down: full(30), fwd: full(5) }, CLOUD_MS_MODEL_R7);
  const bot = cloudMsLight(40, 2, 0.7, 0, { up: full(30), down: full(0), fwd: full(5) }, CLOUD_MS_MODEL_R7);
  assert.ok(top[1] > bot[1] && bot[2] > top[2], `V_sky ${top[1]}/${bot[1]}, V_gnd ${top[2]}/${bot[2]}`);
  const ms = createCloudMultiScatter({ reff: 10, model: CLOUD_MS_MODEL_R7 });
  assert.ok(!/\bNaN\b|Infinity/.test(ms.glsl));
  ms.dispose();
});
