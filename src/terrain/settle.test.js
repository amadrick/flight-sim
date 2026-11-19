import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSettlements, SETTLE_CELL } from './settle.js';
import { heightAt, sampleTerrain } from './height.gen.js';
import { AIRPORTS, headingVector } from '../data/airports.js';

const S = decodeSettlements();
function rwDist(x, z) {
  let best = 1e9;
  for (const a of AIRPORTS) for (const r of a.runways) {
    const d = headingVector(r.heading), qx = x - r.center.x, qz = z - r.center.z;
    const al = Math.max(-r.length / 2, Math.min(r.length / 2, qx * d.x + qz * d.z));
    best = Math.min(best, Math.hypot(qx - d.x * al, qz - d.z * al));
  }
  return best;
}

test('settlements: on dry land, clear of the airfields', () => {
  assert.ok(S.towns.length > 300);
  const o = {};
  for (const t of S.towns) {
    sampleTerrain(t.x, t.z, o);
    assert.ok(o.height > 2.5, `settlement at ${t.x},${t.z} is at ${o.height} m`);
    assert.ok(o.special < 0.3 && o.special > -0.3, `settlement at ${t.x},${t.z} on water / playa`);
    assert.ok(rwDist(t.x, t.z) > t.r + 450, `settlement at ${t.x},${t.z} r=${t.r} too close to a runway (${rwDist(t.x, t.z)})`);
  }
  for (const a of AIRPORTS.filter((q) => q.kind === 'international')) {
    assert.ok(S.towns.some((t) => t.kind === 3 && Math.hypot(t.x - a.position.x, t.z - a.position.z) < 16000), `no city near ${a.id}`);
  }
});

test('roads: never over the sea or an airfield', () => {
  let n = 0, wet = 0;
  for (const s of S.segs) {
    const len = Math.hypot(s[2] - s[0], s[3] - s[1]), m = Math.max(1, Math.ceil(len / 120));
    for (let i = 0; i <= m; i++) {
      const x = s[0] + (s[2] - s[0]) * i / m, z = s[1] + (s[3] - s[1]) * i / m;
      n++;
      if (heightAt(x, z) < 0.3) wet++;                      // river crossings are bridges; the sea is not crossed
      assert.ok(rwDist(x, z) > 480, `road at ${x | 0},${z | 0} inside an airfield (${rwDist(x, z) | 0} m from a runway)`);
    }
  }
  assert.ok(wet / n < 0.004, `${wet} of ${n} road samples below sea level`);
});

test('road lookup grid: every segment is found from points on it', () => {
  for (let i = 0; i < S.segs.length; i += 7) {
    const s = S.segs[i], x = (s[0] + s[2]) / 2, z = (s[1] + s[3]) / 2;
    assert.ok(S.roadClear(x, z) < -0.9 * 1.9, `segment ${i} not in its cell`);
  }
  assert.equal(S.roadClear(0, -900), 1e3);                  // the middle of a runway
});

test('buildings: generated from the lot layout, off the roads, deterministic', () => {
  const city = S.towns.find((t) => t.kind === 3);
  const ci = Math.floor((city.x - S.X0) / SETTLE_CELL), cj = Math.floor((city.z - S.Z0) / SETTLE_CELL);
  const run = () => { const out = []; for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) S.buildingsInCell(i, j, (...a) => out.push(a)); return out; };
  const a = run(), b = run();
  assert.deepEqual(a, b);
  assert.ok(a.length > 1500 && a.length < 9000, `${a.length} buildings in the 9 central cells`);
  let tall = 0;
  for (const [x, z, hx, hz, h] of a) {
    assert.ok(S.roadClear(x, z) >= Math.max(hx, hz) * 1.2 + 2 - 1e-6);
    assert.ok(hx > 2 && hz > 2 && h >= 3 && h <= 125);
    if (h > 40) tall++;
  }
  assert.ok(tall > 10, 'the city core has towers');
  // a hamlet is a handful of houses
  const ham = S.towns.find((t) => t.kind === 0);
  let n = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) S.buildingsInCell(Math.floor((ham.x - S.X0) / SETTLE_CELL) + i, Math.floor((ham.z - S.Z0) / SETTLE_CELL) + j, () => n++);
  assert.ok(n >= 3 && n < 120, `${n} houses in a hamlet`);
});
