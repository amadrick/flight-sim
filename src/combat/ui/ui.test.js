import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProgressStore, STORE_KEY } from './progress.js';
import { groupMissions, nextMission, normalise, paragraphs, fmtTime, fmtPct, fmtClock, conditionsLine, statRows, breakdownRows, cleanCustom, outcomeCopy, debriefDelay, nearestStep, fmtNm, fmtFt } from './logic.js';
import { mapScene } from './map.js';

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };

test('progress store works without storage and with storage that throws', () => {
  for (const s of [null, undefined, throwing, {}]) {
    const p = createProgressStore(s);
    assert.equal(p.completed('a'), false);
    const r = p.record('a', 'ace', { outcome: 'success', stats: { score: 1200, rating: 'B' }, time: 300 });
    assert.equal(r.firstClear, true);
    assert.equal(p.completed('a'), true);
    assert.deepEqual(p.best('a'), { score: 1200, rating: 'B', time: 300, difficulty: 'ace' });
    p.setSetting('difficulty', 'rookie');
    assert.equal(p.getSetting('difficulty'), 'rookie');
  }
});

test('progress store persists, keeps the best per difficulty and survives corrupt data', () => {
  const s = memStore();
  const p = createProgressStore(s);
  p.record('m1', 'veteran', { outcome: 'failure', stats: { score: 50 } });
  assert.equal(p.completed('m1'), false);
  assert.equal(p.mission('m1').attempts, 1);
  p.record('m1', 'veteran', { outcome: 'success', stats: { score: 3000, rating: 'A' }, time: 400 });
  const r = p.record('m1', 'veteran', { outcome: 'success', stats: { score: 2000, rating: 'B' }, time: 200 });
  assert.equal(r.newBest, false);
  assert.equal(p.mission('m1').best.veteran.score, 3000);
  const r2 = p.record('m1', 'veteran', { outcome: 'success', stats: { score: 4000, rating: 'S' } });
  assert.equal(r2.newBest, true);
  p.record('m1', 'rookie', { outcome: 'success', stats: { score: 9000, rating: 'A' } });
  assert.equal(p.best('m1').rating, 'S');          // rating ranks above score
  const again = createProgressStore(s);
  assert.equal(again.mission('m1').best.veteran.rating, 'S');
  assert.equal(again.mission('m1').attempts, 5);
  s.setItem(STORE_KEY, '{not json');
  const bad = createProgressStore(s);
  assert.equal(bad.completed('m1'), false);
  assert.deepEqual(bad.counts(['m1', 'm2']), { done: 0, total: 2 });
});

const LIST = [
  { id: 'i1', category: 'instant', title: 'Quick' },
  { id: 'c2', category: 'campaign', order: 2, title: 'Second' },
  { id: 't1', category: 'training', order: 1 },
  { id: 'c1', category: 'campaign', order: 1, title: 'First' },
  { id: 't2', category: 'training', order: 2 },
  { id: 'x1', category: 'special' },
  null,
];

test('missions are grouped by category in order', () => {
  const g = groupMissions(LIST);
  assert.deepEqual(g.map(x => x.id), ['training', 'campaign', 'instant', 'special']);
  assert.deepEqual(g[1].missions.map(m => m.id), ['c1', 'c2']);
  assert.equal(g[3].label, 'Special');
  assert.deepEqual(groupMissions(undefined), []);
});

test('next mission follows category order; training leads into the campaign; instant has none', () => {
  assert.equal(nextMission(LIST, 't1').id, 't2');
  assert.equal(nextMission(LIST, 't2').id, 'c1');
  assert.equal(nextMission(LIST, 'c1').id, 'c2');
  assert.equal(nextMission(LIST, 'c2'), null);
  assert.equal(nextMission(LIST, 'i1'), null);
  assert.equal(nextMission(LIST, 'nope'), null);
});

test('normalise accepts the placeholder shape and the full shape', () => {
  const a = normalise({ id: 'p', brief: 'One.\n\nTwo.', aircraft: 'f16', start: { airport: 'KHVN', tod: 15, weather: 'fair' } });
  assert.deepEqual(a.brief, ['One.', 'Two.']);
  assert.deepEqual(a.aircraftChoices, ['f16']);
  assert.equal(a.location, 'KHVN'); assert.equal(a.tod, 15); assert.equal(a.threat, null);
  const b = normalise({ id: 'q', brief: ['A', '', 'B'], aircraft: 'f15', aircraftChoices: ['f16', 'f15'], threat: 9, minutes: 6, objectivesPreview: ['Kill'] });
  assert.deepEqual(b.brief, ['A', 'B']);
  assert.deepEqual(b.aircraftChoices, ['f15', 'f16']);
  assert.equal(b.threat, 5);
  assert.equal(normalise({ id: 'instant-custom' }).custom, true);
  assert.deepEqual(paragraphs(42), []);
});

test('formatters', () => {
  assert.equal(fmtTime(0), '0:00'); assert.equal(fmtTime(75.4), '1:15'); assert.equal(fmtTime(3725), '1:02:05');
  assert.equal(fmtPct(3, 0), '–'); assert.equal(fmtPct(21, 50), '42%'); assert.equal(fmtPct(9, 5), '100%');
  assert.equal(fmtClock(17.25), '17:15'); assert.equal(fmtClock(23.999), '00:00');
  assert.equal(conditionsLine(normalise({ id: 'x', location: 'KHVN', tod: 6.5, weather: 'storm' }), [{ id: 'KHVN', name: 'Haven' }], { storm: 'Thunderstorm' }), 'Haven  ·  06:30 LCL  ·  Thunderstorm');
  assert.equal(conditionsLine(normalise({ id: 'y' })), '');
  assert.equal(fmtNm(18520), '10 NM'); assert.equal(fmtNm(5000), '2.7 NM'); assert.equal(fmtFt(1524), '5,000 ft');
  assert.equal(nearestStep([1, 5, 10], 6), 1);
});

test('debrief rows only for reported stats', () => {
  assert.deepEqual(statRows({}, undefined), []);
  const rows = statRows({ kills: 2, shots: 200, hits: 30, missiles: 4, missileHits: 1, damageTaken: 33.4 }, 251);
  assert.deepEqual(rows.map(r => r.k), ['Kills', 'Gun accuracy', 'Missiles', 'Damage taken', 'Time']);
  assert.equal(rows[1].v, '15%'); assert.equal(rows[2].v, '1 / 4'); assert.equal(rows[4].v, '4:11');
  assert.deepEqual(breakdownRows({ breakdown: [{ label: 'Kill', points: 1000.4 }, null, { label: 'Time', points: '-50' }] }), [{ label: 'Kill', points: 1000 }, { label: 'Time', points: -50 }]);
  assert.equal(outcomeCopy({ outcome: 'success' }).ok, true);
  assert.equal(outcomeCopy(null).title, 'Mission failed');
  assert.ok(debriefDelay({ outcome: 'success' }) >= 3 && debriefDelay({ outcome: 'failure' }) >= 4);
});

test('custom setup is clamped', () => {
  const c = cleanCustom({ enemies: 20, wingmen: -1, gunsOnly: 1, startRange: 'x', advantage: 'sideways', enemyType: '' });
  assert.equal(c.enemies, 8); assert.equal(c.wingmen, 0); assert.equal(c.gunsOnly, true);
  assert.equal(c.startRange, 18520); assert.equal(c.advantage, 'neutral'); assert.equal(c.enemyType, 'mixed');
  assert.deepEqual(cleanCustom(null), cleanCustom({}));
});

test('tactical map scene from the placeholder mission shape', () => {
  const sc = mapScene({ start: { airport: 'KHVN', offset: { bearing: 180, distance: 10000 }, hdg: 20 }, enemies: [{ bearing: 0, distance: 8000 }], friends: [{ bearing: 90, distance: 250 }] });
  assert.ok(Math.abs(sc.player.z - 10000) < 1e-6 && Math.abs(sc.player.x) < 1e-6);
  assert.ok(Math.abs(sc.hostiles[0].z - 2000) < 1e-6);
  assert.ok(sc.radius >= 12000);
  assert.equal(mapScene({}).player, null);
});

test('first run: gunnery training preselected, anyAttempt flips after a flight', async () => {
  const { firstRunMission } = await import('./logic.js');
  assert.equal(firstRunMission([{ id: 'c1', category: 'campaign' }, { id: 'train-bfm', category: 'training', order: 3 }, { id: 'train-gunnery', category: 'training', order: 1 }]).id, 'train-gunnery');
  assert.equal(firstRunMission([{ id: 'c1', category: 'campaign' }, { id: 't9', category: 'training' }]).id, 't9');
  assert.equal(firstRunMission([]), null);
  const p = createProgressStore(null);
  assert.equal(p.anyAttempt(), false);
  p.record('x', 'rookie', { outcome: 'failure' });
  assert.equal(p.anyAttempt(), true);
});

test('menu hooks list their base-UI dependencies', async () => {
  const { DEPENDS } = await import('./hooks.js');
  assert.ok(DEPENDS.tabAnchor && DEPENDS.pauseAnchor && DEPENDS.tabBar.length && DEPENDS.pauseList.length && DEPENDS.keys.length);
});
