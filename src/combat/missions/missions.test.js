// Mission definitions and invariants, run headless in the combat bench.
//   node --test src/combat/missions
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBench } from '../../../tools/combat-bench.mjs';
import { MISSIONS } from './index.js';
import { createRadio } from './radio.js';
import { LINES } from './lines.js';

const CATS = ['training', 'campaign', 'instant'];
const TODS = new Set();

// rugged mountains everywhere (up to ~3000 m): spawns must clear them
const mountains = (x, z, out) => { out.height = 1500 + 900 * Math.sin(x / 3100) * Math.cos(z / 2700) + 600 * Math.sin((x + z) / 1300); };

test('every definition carries the fields the menu needs', () => {
  const ids = new Set();
  for (const m of MISSIONS) {
    assert.ok(m.id && !ids.has(m.id), `unique id ${m.id}`); ids.add(m.id);
    assert.ok(CATS.includes(m.category), `${m.id} category`);
    for (const k of ['title', 'tagline', 'location', 'weather', 'aircraft']) assert.equal(typeof m[k], 'string', `${m.id}.${k}`);
    assert.ok(Array.isArray(m.brief) && m.brief.length > 0, `${m.id}.brief`);
    assert.ok(Array.isArray(m.aircraftChoices) && m.aircraftChoices.includes(m.aircraft), `${m.id}.aircraftChoices`);
    assert.ok(Array.isArray(m.objectivesPreview) && m.objectivesPreview.length > 0, `${m.id}.objectivesPreview`);
    assert.ok(Number.isFinite(m.order) && Number.isFinite(m.tod), `${m.id} order/tod`);
    assert.ok(m.threat >= 1 && m.threat <= 5, `${m.id}.threat`);
    assert.ok(m.minutes >= 3 && m.minutes <= 10, `${m.id}.minutes`);
    assert.equal(typeof m.script, 'function', `${m.id}.script`);
    if (m.map) assert.ok(m.map.center && m.map.radius > 0 && m.map.player, `${m.id}.map`);
    TODS.add(Math.round(m.tod));
  }
  for (const id of ['instant-1v1', 'instant-2v2', 'instant-custom', 'instant-survival']) assert.ok(ids.has(id), id);
  assert.ok(MISSIONS.filter((m) => m.category === 'campaign').length >= 8);
  assert.ok(TODS.size >= 5, 'spread over the day');
});

test('radio never repeats a variant twice in a row and fills placeholders', async () => {
  const b = await createBench({ seed: 3 });
  const r = createRadio(b.combat);
  for (const k of Object.keys(LINES)) {
    let last = null;
    for (let i = 0; i < 12; i++) { const t = r.pick(k); if (LINES[k].length > 1) assert.notEqual(t, last, k); last = t; }
  }
  const got = [];
  b.combat.events.on('radio', (m) => got.push(m));
  r.reset({}, 'Halyard 1');
  r.say('awacs', 'Hello {cs}, {n} left.', { vars: { n: 3 } });
  r.say('awacs', 'Urgent!', { priority: 2 });
  for (let i = 0; i < 600; i++) r.update(1 / 60);
  assert.equal(got[0].text, 'Urgent!');
  assert.equal(got[1].text, 'Hello Halyard 1, 3 left.');
  assert.equal(got[1].voice, 'awacs');
});

for (const m of MISSIONS) {
  test(`${m.id}: runs in the bench with sane spawns, objectives, one ending and a finite score`, async () => {
    const errors = [];
    const oe = console.error; console.error = (...a) => { errors.push(a.join(' ')); };
    try {
      const b = await createBench({ seed: 7, groundFn: mountains, difficulty: 'veteran' });
      const c = b.combat, gw = b.ctx.world;
      const bad = [];
      let ends = 0;
      c.events.on('mission:end', () => ends++);
      c.events.on('spawn', ({ entity: e }) => {
        if (e.kind !== 'aircraft') return;
        const p = e.state.position, g = gw.groundHeightAt(p.x, p.z);
        if (p.y < g + 150) bad.push(`${e.callsign} spawned ${Math.round(p.y - g)} m above ground`);
        const pl = c.world.player;
        if (!pl || e === pl || e.team === 'blue') return;
        const pp = pl.state.position, dx = p.x - pp.x, dz = p.z - pp.z, d = Math.hypot(dx, dz);
        if (d < 2000) bad.push(`${e.callsign} spawned ${Math.round(d)} m from the player`);
        let rel = Math.atan2(dx, -dz) - pl.state.heading; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        if (Math.abs(rel) > Math.PI / 2 && d < 5000) bad.push(`${e.callsign} spawned behind the player at ${Math.round(d)} m`);
      });
      assert.ok(c.start(m.id, { bot: true, difficulty: 'veteran', custom: m.id === 'instant-custom' ? { enemies: 3, wingmen: 1 } : undefined }));
      const pl = c.world.player;
      const g0 = gw.groundHeightAt(pl.state.position.x, pl.state.position.z);
      assert.ok(pl.state.position.y > g0 + 150, `player starts ${Math.round(pl.state.position.y - g0)} m above ground`);
      assert.ok(c.director.objectives.length > 0, 'objectives published');
      b.run(150, (t) => !!c.result && t > c.result.time + 3);
      assert.deepEqual(bad, []);
      assert.ok(ends <= 1, 'mission:end at most once');
      const st = c.director.stats;
      assert.ok(Number.isFinite(st.score), 'score finite');
      if (c.result) {
        assert.ok(['success', 'failure'].includes(c.result.outcome));
        assert.ok(['S', 'A', 'B', 'C', 'D'].includes(st.rating));
        assert.ok(Array.isArray(st.breakdown) && Array.isArray(st.medals));
        assert.equal(c.result.stats, st);
      }
      assert.deepEqual(errors.filter((e) => /threw/.test(e)), []);
    } finally { console.error = oe; }
  });
}

test('a mission always ends, and ends exactly once (instant-1v1, long run)', async () => {
  const b = await createBench({ seed: 2 });
  let ends = 0;
  b.combat.events.on('mission:end', () => ends++);
  b.combat.start('instant-1v1', { bot: true });
  b.run(600, (t) => !!b.combat.result && t > b.combat.result.time + 10);
  assert.equal(ends, 1);
  assert.ok(b.combat.result.stats.score !== 0 || b.combat.result.outcome === 'failure');
});
