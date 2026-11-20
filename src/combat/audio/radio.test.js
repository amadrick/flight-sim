import test from 'node:test';
import assert from 'node:assert/strict';
import { createRadioQueue, roleOf, speechSeconds, ROLES, RADIO_CFG } from './radio-queue.js';

test('radio queue: priority order, urgent pre-emption, stale lines dropped, bounded length, dedupe', () => {
  const q = createRadioQueue();
  q.push({ text: 'a', priority: 0 }, 0); q.push({ text: 'b', priority: 1 }, 0.1); q.push({ text: 'c', priority: 0 }, 0.2);
  assert.deepEqual(q.items.map((i) => i.text), ['b', 'a', 'c']);
  const cur = q.next(0.3); assert.equal(cur.text, 'b');
  assert.equal(q.push({ text: 'MISSILE', priority: 2 }, 0.4, cur), true, 'urgent line pre-empts a normal one');
  assert.equal(q.items[0].text, 'MISSILE');
  assert.equal(q.push({ text: 'again', priority: 2 }, 0.5, { priority: 2 }), false, 'urgent does not pre-empt urgent');
  assert.equal(q.push({ text: 'a', priority: 0 }, 0.6), false); assert.equal(q.items.filter((i) => i.text === 'a').length, 1, 'duplicate within 2.5 s ignored');
  for (let i = 0; i < 10; i++) q.push({ text: 'x' + i, priority: 0 }, 1 + i);
  assert.ok(q.items.length <= RADIO_CFG.maxQueue);
  assert.ok(q.items.some((i) => i.text === 'MISSILE'), 'the urgent line survives the overflow');
  const late = q.next(100); assert.equal(late, null, 'everything is stale after 100 s');
  assert.ok(q.stats.dropped > 0);
});

test('radio roles: explicit voice wins, enemy team, AWACS, player, default wingman', () => {
  assert.equal(roleOf({ voice: 'tower', from: 'x' }), 'tower');
  assert.equal(roleOf({ from: 'Bandit 1', team: 'red' }), 'enemy');
  assert.equal(roleOf({ from: 'AWACS' }), 'awacs');
  assert.equal(roleOf({ from: 'Viper 1' }, 'Viper 1'), 'player');
  assert.equal(roleOf({ from: 'Viper 2' }, 'Viper 1'), 'wingman');
  for (const r of Object.values(ROLES)) assert.ok(r.pitch > 0 && r.rate > 0 && r.band[0] < r.band[1]);
  assert.ok(new Set(Object.values(ROLES).map((r) => `${r.pitch}/${r.rate}`)).size === Object.keys(ROLES).length, 'every role sounds different');
});

test('speech duration estimate is bounded', () => {
  assert.ok(speechSeconds('') >= 0.7); assert.ok(speechSeconds('x'.repeat(500)) <= 6);
  assert.ok(speechSeconds('Fox two, fox two.') > 0.7);
});
