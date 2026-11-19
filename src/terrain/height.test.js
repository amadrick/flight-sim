// node --test src/terrain/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { heightAt, sampleTerrain, heightAtLod } from './height.gen.js';
import { generate } from './tools/gen-height.mjs';
import { AIRPORTS, CARRIER, runwayEnd } from '../data/airports.js';

test('height.gen.js is up to date with height.glsl.js', () => {
  const cur = readFileSync(fileURLToPath(new URL('./height.gen.js', import.meta.url)), 'utf8');
  assert.equal(cur, generate(), 'run: node src/terrain/tools/gen-height.mjs');
});

test('airports are exactly flat at their elevation inside flattenRadius', () => {
  for (const a of AIRPORTS) {
    for (let i = 0; i < 4000; i++) {
      const r = a.flattenRadius * Math.sqrt((i + 0.5) / 4000) * 0.9999, th = i * 2.399963;
      const h = heightAt(a.position.x + r * Math.cos(th), a.position.z + r * Math.sin(th));
      assert.equal(h, a.elevation, `${a.id} at r=${r.toFixed(0)}`);
    }
  }
});

test('airport pads blend out smoothly (C1) and the surroundings are believable', () => {
  for (const a of AIRPORTS) {
    let worst = 0;
    for (let k = 0; k < 72; k++) {
      const th = (k / 72) * Math.PI * 2, cx = Math.cos(th), cz = Math.sin(th);
      // gradient just outside the pad edge must be ~0 (C1), and no cliffs ring the pad
      const R = a.flattenRadius;
      const g = (heightAt(a.position.x + cx * (R + 4), a.position.z + cz * (R + 4)) - a.elevation) / 4;
      assert.ok(Math.abs(g) < 0.02, `${a.id}: slope ${g.toFixed(4)} at pad edge`);
      for (let r = R; r < R * 1.5; r += 50) {
        const s = Math.abs(heightAt(a.position.x + cx * (r + 50), a.position.z + cz * (r + 50)) - heightAt(a.position.x + cx * r, a.position.z + cz * r)) / 50;
        worst = Math.max(worst, s);
      }
    }
    assert.ok(worst < 0.5, `${a.id}: steepest slope around the pad ${worst.toFixed(2)}`);
  }
});

test('approaches along every runway heading clear a 3 degree glide path', () => {
  for (const a of AIRPORTS) for (const rw of a.runways) for (const end of [0, 1]) {
    const e = runwayEnd(rw, end);
    for (let dist = 200; dist <= 15000; dist += 100) {
      const x = e.threshold.x - e.dir.x * dist, z = e.threshold.z - e.dir.z * dist;
      const glide = a.elevation + 15 + Math.tan(3 * Math.PI / 180) * dist;
      const h = Math.max(heightAt(x, z), 0);
      assert.ok(h < glide - Math.min(40, dist * 0.02), `${a.id} ${e.name}: terrain ${h.toFixed(0)} m vs glide path ${glide.toFixed(0)} m at ${dist} m`);
    }
  }
});

test('carrier station is deep open water with no land within 15 km', () => {
  const c = CARRIER.position;
  assert.ok(heightAt(c.x, c.z) <= -200, `depth at carrier ${heightAt(c.x, c.z)}`);
  let hi = -1e9;
  for (let dz = -15000; dz <= 15000; dz += 300) for (let dx = -15000; dx <= 15000; dx += 300) {
    if (dx * dx + dz * dz > 15000 * 15000) continue;
    hi = Math.max(hi, heightAt(c.x + dx, c.z + dz));
  }
  assert.ok(hi < -50, `shallowest point within 15 km of the carrier: ${hi.toFixed(1)} m`);
});

test('required geography', () => {
  // Haven: coastline 8-15 km to the south, open sea beyond
  let coast = null;
  for (let z = 0; z < 30000; z += 50) if (heightAt(0, z) < 0) { coast = z; break; }
  assert.ok(coast > 8000 && coast < 15000, `coast ${coast} m south of KHVN`);
  assert.ok(heightAt(-30000, 60000) < -200 && heightAt(0, 80000) < -200);
  // alpine range to the north: serious peaks, and Pinecrest ringed by high ground
  let peak = 0;
  for (let z = -140000; z < -60000; z += 400) for (let x = -160000; x < 80000; x += 400) peak = Math.max(peak, heightAt(x, z));
  assert.ok(peak > 3600 && peak < 4700, `highest peak ${peak.toFixed(0)} m`);
  const p = AIRPORTS.find((a) => a.id === 'KPNC');
  for (const [dx, dz] of [[0.866, -0.5], [-0.866, 0.5]]) {         // across the valley, both sides
    let m = 0; for (let r = 4000; r < 16000; r += 250) m = Math.max(m, heightAt(p.position.x + dx * r, p.position.z + dz * r));
    assert.ok(m > p.elevation + 700, `valley wall rises ${(m - p.elevation).toFixed(0)} m`);
  }
  // Redrock: a huge dry lakebed
  const k = AIRPORTS.find((a) => a.id === 'KRDR'), o = {};
  for (let i = 0; i < 200; i++) {
    const r = 8000 * Math.sqrt(i / 200), th = i * 2.4;
    sampleTerrain(k.position.x + r * Math.cos(th), k.position.z + r * Math.sin(th), o);
    assert.ok(Math.abs(o.height - 702) < 0.01 && o.arid > 0.9 && o.special < -0.5, 'playa');
  }
  // Coral Key: a small island in shallow reef water, deep ocean beyond
  const c = AIRPORTS.find((a) => a.id === 'PCRK');
  let land = 0, shallow = 0, n = 0;
  for (let dz = -12000; dz <= 12000; dz += 400) for (let dx = -12000; dx <= 12000; dx += 400) {
    const h = heightAt(c.position.x + dx, c.position.z + dz); n++;
    if (h > 0) land++; else if (h > -15) shallow++;
  }
  assert.ok(land / n > 0.03 && land / n < 0.25, `island share ${(land / n).toFixed(3)}`);
  assert.ok(shallow / n > 0.05, `reef share ${(shallow / n).toFixed(3)}`);
  assert.ok(heightAt(c.position.x + 30000, c.position.z + 30000) < -500);
  // Baywater: on the far shore of a large bay with hills behind
  const b = AIRPORTS.find((a) => a.id === 'KBAY');
  assert.ok(heightAt(b.position.x + 30000, b.position.z) < -10, 'the Sound lies east of KBAY');
  let hill = 0; for (let r = 12000; r < 45000; r += 500) hill = Math.max(hill, heightAt(b.position.x - r, b.position.z));
  assert.ok(hill > 350, `hills behind KBAY: ${hill.toFixed(0)} m`);
});

test('continuous, finite and deterministic everywhere', () => {
  let seed = 12345; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  let worst = 0;
  for (let i = 0; i < 60000; i++) {
    const far = i % 10 === 0 ? 4e6 : 320000;
    const x = (rnd() - 0.5) * 2 * far, z = (rnd() - 0.5) * 2 * far, a = rnd() * 6.283;
    const h0 = heightAt(x, z), h1 = heightAt(x + Math.cos(a), z + Math.sin(a));
    assert.ok(Number.isFinite(h0) && h0 > -6000 && h0 < 5600, `height ${h0} at ${x},${z}`);
    worst = Math.max(worst, Math.abs(h1 - h0));
    if (i % 97 === 0) assert.equal(heightAt(x, z), h0);
  }
  assert.ok(worst < 8, `largest change over 1 m: ${worst.toFixed(2)} m`);
  assert.ok(Number.isFinite(heightAt(1e7, -1e7)) && Number.isFinite(heightAt(-3.3e6, 2.2e6)));
  // band-limited levels stay close to the full-detail surface where it matters
  assert.ok(Math.abs(heightAtLod(1000, 2000, 2) - heightAt(1000, 2000)) < 0.05);
});

test('heightAt is fast and allocation-free enough for per-frame use', () => {
  const N = 300000; let s = 0;
  for (let i = 0; i < 20000; i++) s += heightAt(-20000 + i, -95000 + i);   // warm up
  const spots = [[-20000, -95000, 'mountains'], [0, 0, 'plain'], [150000, -60000, 'desert'], [15000, 45000, 'ocean']];
  let total = 0;
  for (const [cx, cz, name] of spots) {
    const t0 = performance.now();
    for (let i = 0; i < N; i++) s += heightAt(cx + (i % 600) * 37.3, cz + ((i / 600) | 0) * 41.7);
    const us = ((performance.now() - t0) * 1000) / N; total += us;
    console.log(`  heightAt ${name}: ${us.toFixed(2)} us/call`);
  }
  assert.ok(total / spots.length < 15, `mean ${(total / spots.length).toFixed(2)} us/call (target <= ~10)`);
  assert.ok(Number.isFinite(s));
});
