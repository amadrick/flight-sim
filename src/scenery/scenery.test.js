// node --test src/scenery/  — pure-logic tests: layout geometry, markings, light plan, surface provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIRPORTS, runwayEnd, runwayLocal } from '../data/airports.js';
import { buildLayout, parseDesignator, aimingPointDistance, KIND_SPECS } from './layout.js';
import { buildMarkings, thresholdStripeCount } from './markings.js';
import { buildLightPlan, LIGHT_STRIDE, MODE } from './lightplan.js';
import { createSurfaceProvider } from './surface.js';

const layouts = AIRPORTS.map((a) => buildLayout(a));
const surface = createSurfaceProvider(AIRPORTS, layouts);
const q = (x, z) => { const o = { height: -999, type: 'terrain' }; surface(x, z, o); return o; };

test('designators: FAA style without leading zero, L/R letters', () => {
  assert.deepEqual(parseDesignator('09L'), { digits: '9', letter: 'L', number: 9 });
  assert.deepEqual(parseDesignator('27R'), { digits: '27', letter: 'R', number: 27 });
  assert.deepEqual(parseDesignator('04'), { digits: '4', letter: '', number: 4 });
});

test('runway ends match the shared airport data (threshold positions and headings)', () => {
  AIRPORTS.forEach((ap, i) => {
    ap.runways.forEach((rw, j) => {
      const R = layouts[i].runways[j];
      for (const e of [0, 1]) {
        const ref = runwayEnd(rw, e);
        const E = R.ends[e];
        assert.ok(Math.abs(E.thr.x + ap.position.x - ref.threshold.x) < 1e-6);
        assert.ok(Math.abs(E.thr.z + ap.position.z - ref.threshold.z) < 1e-6);
        assert.equal(E.heading, ref.heading);
        assert.equal(E.name, ref.name);
      }
    });
  });
});

test('surface: every runway centreline point reports runway at airport elevation', () => {
  for (const ap of AIRPORTS) for (const rw of ap.runways) {
    for (const e of [0, 1]) {
      const E = runwayEnd(rw, e);
      for (let u = 1; u < rw.length; u += 97) {
        const x = E.threshold.x + E.dir.x * u, z = E.threshold.z + E.dir.z * u;
        const o = q(x, z);
        assert.equal(o.type, 'runway', `${ap.id} ${rw.id} u=${u}`);
        assert.equal(o.height, ap.elevation);
      }
      // the session spawn point (80 m in) and the runway edges
      const x = E.threshold.x + E.dir.x * 80, z = E.threshold.z + E.dir.z * 80;
      assert.equal(q(x, z).type, 'runway');
    }
    const c = rw.center, hl = runwayLocal(rw, c.x, c.z);
    assert.ok(Math.abs(hl.along) < 1e-9 && Math.abs(hl.cross) < 1e-9);
  }
});

test('surface: far from airports the provider leaves the terrain answer untouched', () => {
  const o = q(60000, 60000);
  assert.equal(o.type, 'terrain'); assert.equal(o.height, -999);
  const o2 = q(AIRPORTS[0].position.x + 4400, AIRPORTS[0].position.z + 4400);
  assert.equal(o2.type, 'terrain');
});

test('surface: parallel taxiway and apron are reported; runway wins where they overlap', () => {
  AIRPORTS.forEach((ap, i) => {
    const L = layouts[i];
    for (const R of L.runways) {
      const p = L.frame.P(R.a, R.twyC);
      assert.equal(q(ap.position.x + p.x, ap.position.z + p.z).type, 'taxiway', ap.id + ' twy');
    }
    for (const c of L.connectors) {
      const R = L.runways[c.rwy];
      for (const t of [0.35, 0.5, 0.8]) {
        const p = L.frame.P(c.a, R.c + (R.twyC - R.c) * t);
        assert.equal(q(ap.position.x + p.x, ap.position.z + p.z).type, 'taxiway', ap.id + ' connector ' + c.name);
      }
    }
    for (const A of L.aprons) {
      const p = L.frame.P(A.a, A.c);
      assert.equal(q(ap.position.x + p.x, ap.position.z + p.z).type, 'apron', ap.id + ' apron');
    }
  });
});

test('layout: separations and clearances follow the kind specs; buildings stay clear of the runway strip', () => {
  AIRPORTS.forEach((ap, i) => {
    const L = layouts[i];
    const spec = KIND_SPECS[ap.kind];
    for (const R of L.runways) assert.equal(Math.abs(R.twyC - R.c), spec.T);
    for (const b of [...L.buildings, ...(L.tower ? [{ ...L.tower, len: 10, wid: 10 }] : [])]) {
      for (const R of L.runways) {
        const E = R.ends[0];
        const ox = b.x - R.x, oz = b.z - R.z;
        const al = ox * E.dir.x + oz * E.dir.z, cr = Math.abs(-ox * E.dir.z + oz * E.dir.x);
        if (Math.abs(al) > R.len / 2 + 300) continue;
        const dA = ((b.hdg || 0) - R.heading) * Math.PI / 180;
        const reach = Math.abs((b.len || 0) / 2 * Math.sin(dA)) + Math.abs((b.wid || 0) / 2 * Math.cos(dA));
        assert.ok(cr - reach > 150, `${ap.id} ${b.type} too close to ${R.id}: ${cr.toFixed(0)} m`);
      }
    }
    // everything within the flattened area
    for (const b of L.buildings) assert.ok(Math.hypot(b.x, b.z) < ap.flattenRadius, `${ap.id} ${b.type} outside flat area`);
    assert.ok(L.tower, 'tower');
    assert.ok(L.stands.length > 0, 'parking');
  });
});

test('markings: threshold stripe counts by width and designators painted at both ends', () => {
  assert.equal(thresholdStripeCount(60), 16);
  assert.equal(thresholdStripeCount(45), 12);
  assert.equal(thresholdStripeCount(30), 8);
  assert.equal(aimingPointDistance(3800), 400);
  assert.equal(aimingPointDistance(2100), 300);
  AIRPORTS.forEach((ap, i) => {
    const Q = buildMarkings(layouts[i]);
    for (const R of layouts[i].runways) {
      for (const E of R.ends) {
        const glyphs = Q.filter((m) => m.glyph && m.rw === R.i && !m.outline && Math.abs(m.hdg - E.heading) < 1e-6);
        const txt = glyphs.map((g) => g.glyph).sort().join('');
        assert.equal(txt, (E.digits + E.letter).split('').sort().join(''), `${ap.id} ${E.name}`);
      }
      // threshold stripes: white quads 45/30 m long near each threshold
      const stripes = Q.filter((m) => m.rw === R.i && m.col === 'w' && !m.glyph && m.len === (R.precision ? 45 : 30) && m.wid < 3);
      assert.equal(stripes.length, 2 * thresholdStripeCount(R.wid), `${ap.id} ${R.id} stripes`);
    }
  });
});

test('light plan: PAPI settings, colours by direction, ALSF flashers sequence toward the threshold', () => {
  const L = layouts[0];
  const P = buildLightPlan(L);
  assert.equal(P.data.length, P.count * LIGHT_STRIDE);
  const lights = [];
  for (let i = 0; i < P.count; i++) lights.push(P.data.slice(i * LIGHT_STRIDE, (i + 1) * LIGHT_STRIDE));
  const papi = lights.filter((l) => l[11] === MODE.PAPI);
  assert.equal(papi.length, L.runways.length * 2 * 4 * 2);
  const angles = [...new Set(papi.map((l) => +(l[12] * 180 / Math.PI).toFixed(3)))].sort();
  assert.deepEqual(angles, [2.5, 2.833, 3.167, 3.5]);
  // PAPI on the pilot's left of each landing direction
  const R = L.runways[0], E = R.ends[0];
  for (const u of E.papi) {
    const ox = u.x - E.thr.x, oz = u.z - E.thr.z;
    assert.ok(ox * E.left.x + oz * E.left.z > R.wid / 2, 'PAPI left of runway');
  }
  // flashers: farther ones fire first (smaller phase)
  const fl = lights.filter((l) => l[11] === MODE.SEQ);
  assert.ok(fl.length >= 14 * 4);
  // every approach flasher belongs to an end; group by the light direction and check phase vs distance
  const byDir = new Map();
  for (const l of fl) { const k = l[7].toFixed(2) + l[9].toFixed(2) + (l[2] < 0 ? 'n' : 's'); if (!byDir.has(k)) byDir.set(k, []); byDir.get(k).push(l); }
  for (const g of byDir.values()) {
    const thrDist = (l) => Math.hypot(l[0], l[2]);
    g.sort((a, b) => a[12] - b[12]);
    assert.ok(thrDist(g[0]) > thrDist(g[g.length - 1]), 'sequence runs toward the threshold');
  }
  // edge lights: yellow toward the pilot in the last 600 m only on instrument runways
  const yellow = lights.filter((l) => l[3] === 1 && Math.abs(l[4] - 0.6) < 1e-6 && Math.abs(l[5] - 0.1) < 1e-6 && l[10] === 0);
  assert.ok(yellow.length > 0);
});
