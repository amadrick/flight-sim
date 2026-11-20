import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCrash, fireballScale, CRASH_TESTS } from './classify.js';

const k = (i) => classifyCrash(i).kind;

test('crash classes from impact states', () => {
  assert.equal(k(CRASH_TESTS.belly), 'belly');
  assert.equal(k(CRASH_TESTS.collapse), 'gearCollapse');
  assert.equal(k(CRASH_TESTS.breakup), 'breakup');
  assert.equal(k(CRASH_TESTS.impact), 'impact');
  assert.equal(k(CRASH_TESTS.fireball), 'impact');
  assert.equal(k(CRASH_TESTS.mountain), 'impact');
  assert.equal(k(CRASH_TESTS.ditch), 'ditch');
  assert.equal(k(CRASH_TESTS.water), 'waterImpact');
  assert.equal(k(CRASH_TESTS.airburst), 'airburst');
});

test('surfaces and outcomes', () => {
  const b = classifyCrash(CRASH_TESTS.belly);
  assert.ok(b.sparks && !b.fire && b.slide > 200, 'runway belly slide: sparks, long scrape, no fire');
  const g = classifyCrash({ ...CRASH_TESTS.belly, surface: 'terrain' });
  assert.ok(g.dust && !g.sparks && g.slide < b.slide, 'grass: dust, shorter slide');
  const i = classifyCrash(CRASH_TESTS.impact);
  assert.ok(i.fire && i.burnFuel > 1000 && i.crater > 3 && i.D > 50 && i.D < 120, JSON.stringify(i));
  const w = classifyCrash(CRASH_TESTS.water);
  assert.ok(w.water && !w.fire, 'water impact: spray, no fireball');
  const empty = classifyCrash({ ...CRASH_TESTS.impact, fuel: 0 });
  assert.ok(!empty.fire, 'no fuel, no fireball');
});

test('fireball scaling follows the hydrocarbon fireball correlation', () => {
  const s = fireballScale(1000);
  assert.ok(Math.abs(s.D - 58) < 0.5 && Math.abs(s.duration - 4.5) < 0.05);
  assert.ok(fireballScale(8000).D > s.D * 1.9);
});
