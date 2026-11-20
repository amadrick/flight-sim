import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeTurfNet, turfForward, turfBRF, turfHDRF, turfAlbedo, TURF_CORNERS, TURF_EVAL } from './ground-turf.js';
import { TURF_SUN_NET, TURF_SKY_NET } from './ground-turf-weights.js';

const vec = JSON.parse(readFileSync(new URL('./turf-test-vectors.json', import.meta.url)));
const sun = decodeTurfNet(TURF_SUN_NET), sky = decodeTurfNet(TURF_SKY_NET);
const dir = (mu, ph) => ({ mu, ph });

test('turf networks: JS twin matches the Python reference', () => {
  for (const v of vec.sun) { const y = turfForward(sun, v.x); v.y.forEach((t, c) => assert.ok(Math.abs(y[c] - t) < 1e-5, `sun ${c} ${y[c]} ${t}`)); }
  for (const v of vec.sky) { const y = turfForward(sky, v.x); v.y.forEach((t, c) => assert.ok(Math.abs(y[c] - t) < 1e-5, `sky ${c}`)); }
});
test('turf network: better than the fitted analytic vegetation BRDF and far better than Lambert on held-out swards', () => {
  const e = Object.fromEntries(TURF_EVAL.filter((r) => r.rel_lum !== undefined && !r.model.includes('train')).map((r) => [r.model.split(' ')[0], r.ln_rmse]));
  assert.ok(e.mlp < e.rpv && e.rpv < e.lambert, JSON.stringify(e));
});
test('turf reflectance: physical sanity', () => {
  const [A, B] = TURF_CORNERS;
  // hot spot: looking down-sun (view = sun direction) at an upright sward is much brighter than looking into the sun
  // (a laid sward is not: its sheen and lay compete)
  const hot = turfBRF(sun, B.lean, B.H, 0.5, 1.0, 0.5, 1.0)[1], into = turfBRF(sun, B.lean, B.H, 0.5, 1.0, 0.5, 1.0 + Math.PI)[1];
  assert.ok(hot > 1.3 * into, `hot ${hot} into ${into}`);
  // mowing stripes: a laid sward looks lighter viewed along the lay (from behind, view azimuth pi) than against it
  const along = turfBRF(sun, A.lean, A.H, 0.6, Math.PI / 2, 0.3, Math.PI)[1], against = turfBRF(sun, A.lean, A.H, 0.6, Math.PI / 2, 0.3, 0)[1];
  assert.ok(along > 1.25 * against, `along ${along} against ${against}`);
  // green canopy: green channel dominates, albedos plausible for turf
  for (const C of TURF_CORNERS) { const a = turfAlbedo(sky, C.lean, C.H); assert.ok(a[1] > a[0] && a[1] > a[2] && a[1] > 0.03 && a[1] < 0.2, JSON.stringify(a)); }
  for (let i = 0; i < 200; i++) {
    const r = (k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
    const b = turfBRF(sun, r(1), 0.03 + 0.1 * r(2), 0.05 + 0.95 * r(3), 6.28 * r(4), 0.05 + 0.95 * r(5), 6.28 * r(6));
    b.forEach((v) => assert.ok(v > 0 && v < 1.5 && Number.isFinite(v)));
  }
});
