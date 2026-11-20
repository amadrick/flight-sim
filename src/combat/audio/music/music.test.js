import test from 'node:test';
import assert from 'node:assert/strict';
import { CUES, CUE_IDS, DRUMS, GTR, BASS } from './cues.js';
import { genSection, createArranger, fillSteps } from './arranger.js';
import { createMood } from './mood.js';
import { createClock } from './clock.js';
import { chord, allowedPcs, keyPcs, voiceLead, pc, midi, mtof, hash } from './theory.js';

test('theory basics', () => {
  assert.equal(midi('A4'), 69); assert.equal(midi('D2'), 38); assert.equal(Math.round(mtof(69)), 440);
  const dm = chord(2, 'i'); assert.deepEqual(dm.tones, [2, 5, 9]);
  const A = chord(2, 'V'); assert.deepEqual(A.tones, [9, 1, 4]);
  const al = allowedPcs(2, A); assert.ok(al.has(1) && !al.has(0), 'C# replaces C over the A major chord');
  const v = voiceLead(chord(2, 'VI'), [57, 62, 65, 69], 55, 76, 4);
  assert.equal(v.length, 4); for (const m of v) assert.ok(chord(2, 'VI').tones.includes(pc(m)));
});

for (const id of CUE_IDS) {
  const cue = CUES[id];
  test(`${id}: every section generates 16-step bars with in-key, in-range notes`, () => {
    for (const name of Object.keys(cue.sections)) {
      const bars = genSection(cue, name);
      assert.equal(bars.length, cue.sections[name].bars);
      for (const bar of bars) {
        assert.equal(bar.steps.length, 16);
        for (let k = 0; k < 16; k++) for (const e of bar.steps[k]) {
          let ch = bar.chords[0].ch; for (const c of bar.chords) if (c.at <= k) ch = c.ch;
          const ok = allowedPcs(cue.tonic, ch);
          const notes = e.n === undefined || e.dr ? [] : Array.isArray(e.n) ? e.n : [e.n];
          for (const n of notes) {
            assert.ok(Number.isFinite(n), `${name} ${e.i} finite`);
            if (e.i === 'gtr' || e.i === 'bass') { assert.ok(n >= cue.gtrLow - 12 && n <= cue.gtrLow + 26, `${name} ${e.i} range ${n}`); continue; }  // riffs use chromatic passing roots
            if (e.i === 'lead' || e.i === 'lead2') assert.ok(n >= 55 && n <= 92, `${name} lead range ${n}`);
            assert.ok(ok.has(pc(n)) || ch.tones.includes(pc(n)), `${id}/${name} bar ${bar.index} step ${k} ${e.i} ${n} not in key over ${ch.sym}`);
          }
          if (e.i === 'lead' && k === 0 && e.d >= 4 && ch.quality !== '5') assert.ok(ch.tones.includes(pc(e.n)) || cue.sections[name].group === 'danger', `${id}/${name} bar ${bar.index}: downbeat lead note ${e.n} is a chord tone of ${ch.sym}`);
          if (e.d !== undefined) assert.ok(e.d > 0 && e.d <= 16, 'duration');
        }
      }
    }
  });
  test(`${id}: riff cells lie on the grid, hooks are 8 bars`, () => {
    for (const cell of Object.values(cue.riffs)) for (const [k, , len] of cell) assert.ok(k >= 0 && k + len <= 16);
    assert.equal(cue.hooks.hook.length, 8);
    assert.ok(cue.bpm >= 96 && cue.bpm <= 150);
  });
}

test('pattern strings are 16 steps', () => {
  for (const p of Object.values(DRUMS)) for (const s of Object.values(p)) assert.equal(s.length, 16);
  for (const s of Object.values(GTR)) assert.equal(s.length, 16);
  for (const s of Object.values(BASS)) assert.equal(s.length, 16);
  assert.ok(fillSteps('fillBig').slice(0, 8).every((a) => a.length === 0));
});

test('arranger: calm -> fight enters the riff with a big fill, kills bring the chorus, danger, victory sting then silence', () => {
  const a = createArranger(CUES.sweep);
  assert.equal(a.next('off'), null);
  let b = a.next('calm'); assert.equal(b.section, 'calm');
  assert.equal(a.fillFor('fight'), 'fillBig');
  b = a.next('fight'); assert.equal(b.section, 'riff'); assert.equal(b.index, 0);
  assert.ok(b.steps[0].some((e) => e.i === 'crash'));
  b = a.next('hero'); assert.equal(b.section, 'riff'); assert.equal(b.index, 1, 'waits for the 4-bar phrase');
  a.next('hero'); a.next('hero'); b = a.next('hero'); assert.equal(b.section, 'chorus');
  for (let i = 1; i < 8; i++) b = a.next('fight');
  assert.equal(b.section, 'chorus'); assert.equal(b.index, 7, 'the chorus is not cut off');
  b = a.next('fight'); assert.equal(b.section, 'riff');
  assert.equal(a.fillFor('danger'), 'fillBig');
  b = a.next('danger'); assert.equal(b.section, 'danger');
  assert.equal(a.fillFor('victory'), 'fillRoll');
  const seen = [];
  for (let i = 0; i < 8; i++) { b = a.next('victory'); seen.push(b ? b.section + b.index : null); }
  assert.deepEqual(seen, ['win0', 'win1', 'win2', 'win3', null, null, null, null]);
  b = a.next('calm'); assert.equal(b.section, 'calm', 'a new mission restarts the score');
});

test('arranger: fight sequence cycles riff -> riff2 -> bridge -> riff', () => {
  const a = createArranger(CUES.nightfall); const order = [];
  for (let i = 0; i < 24; i++) { const b = a.next('fight'); if (b.index === 0) order.push(b.section); }
  assert.deepEqual(order, ['riff', 'riff2', 'bridge', 'riff']);
});

test('mood: hysteresis and priorities', () => {
  const m = createMood(); const i = { dt: 0.5, active: true, alive: true, enemyDist: 40000, enemyCount: 2, friendCount: 1, hp: 1 };
  assert.equal(m.update({ ...i, active: false }), 'off');
  assert.equal(m.update(i), 'calm');
  assert.equal(m.update({ ...i, enemyDist: 15000 }), 'tension');
  assert.equal(m.update({ ...i, enemyDist: 4000 }), 'fight');
  for (let k = 0; k < 20; k++) assert.equal(m.update({ ...i, enemyDist: 15000 }), 'fight', 'fight is held');
  for (let k = 0; k < 30; k++) m.update({ ...i, enemyDist: 15000 });
  assert.equal(m.mood, 'tension');
  assert.equal(m.update({ ...i, enemyDist: 3000, threat: true }), 'danger');
  for (let k = 0; k < 4; k++) assert.equal(m.update({ ...i, enemyDist: 3000 }), 'danger', 'danger is held');
  for (let k = 0; k < 10; k++) m.update({ ...i, enemyDist: 3000 });
  assert.equal(m.mood, 'fight');
  assert.equal(m.update({ ...i, enemyDist: 3000, killAgo: 1 }), 'hero');
  assert.equal(m.update({ ...i, enemyDist: 3000, hp: 0.2 }), 'danger');
  assert.equal(m.update({ ...i, result: 'success' }), 'victory');
  assert.equal(m.update({ ...i, alive: false }), 'defeat');
});

test('clock: steps inside the look-ahead, late steps skipped, grid kept', () => {
  const c = createClock({ bpm: 120, lookahead: 0.2 }); c.start(1);
  const got = [];
  c.pump(0.95, (t, s) => got.push([t, s]));
  assert.deepEqual(got.map((g) => g[1]), [0, 1]);
  got.length = 0; c.pump(5, (t, s) => got.push(t));
  assert.ok(c.skipped > 0); assert.ok(got.every((t) => t >= 5 - 0.03 && t < 5.2));
  assert.ok(Math.abs(((got[0] - 1) / 0.125) - Math.round((got[0] - 1) / 0.125)) < 1e-9, 'still on the grid');
});

test('cue choice is a stable hash', () => { assert.equal(hash('instant-2v2'), hash('instant-2v2')); });
