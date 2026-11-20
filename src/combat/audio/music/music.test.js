import test from 'node:test';
import assert from 'node:assert/strict';
import { CUES, CUE_IDS, DRUMS, GTR, BASS, STABS } from './cues.js';
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
            if (e.i === 'lead' || e.i === 'lead2' || e.i === 'bell') assert.ok(n >= 55 && n <= 92, `${name} lead range ${n}`);
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
    assert.equal(cue.hooks.hook.length, 8); assert.equal(cue.hooks.solo.length, 8); assert.equal(cue.hooks.bell.length, 8); assert.equal(cue.hooks.pre.length, 4);
    assert.ok(cue.bpm >= 96 && cue.bpm <= 150);
  });
}

test('pattern strings are 16 steps', () => {
  for (const p of Object.values(DRUMS)) for (const s of Object.values(p)) assert.equal(s.length, 16);
  for (const s of Object.values(GTR)) assert.equal(s.length, 16);
  for (const s of Object.values(BASS)) assert.equal(s.length, 16);
  for (const s of Object.values(STABS)) assert.equal(s.length, 16);
  assert.ok(fillSteps('fillBig').slice(0, 8).every((a) => a.length === 0));
});

const walk = (a, moods, sig) => moods.map((m) => { const b = a.next(m, sig); return b ? b.section + b.index : null; });
const starts = (seq) => seq.filter((x) => x && /^(chorus2|[a-z]+)0$/.test(x)).map((x) => x.slice(0, -1));

test('arranger: the fight is a song (intro, verse, pre, chorus, interlude, verse, pre, chorus 2, solo, chorus 2)', () => {
  const a = createArranger(CUES.sweep);
  assert.equal(a.next('off'), null);
  assert.equal(a.next('calm').section, 'calm');
  assert.equal(a.fillFor('fight'), 'fillBig', 'big fill into the band');
  assert.equal(a.entering('fight'), true, 'riser into the first merge');
  const seq = walk(a, Array(4 + 8 + 4 + 8 + 4 + 8 + 4 + 8 + 8 + 8 + 4).fill('fight'));
  assert.deepEqual(starts(seq), ['intro', 'verse', 'pre', 'chorus', 'intro', 'verse', 'pre', 'chorus2', 'solo', 'chorus2', 'intro']);
});

test('arranger: a lock pushes the verse to the pre-chorus at the phrase; hero after a chorus brings the solo', () => {
  const a = createArranger(CUES.sweep);
  walk(a, Array(4).fill('fight'));                                   // intro
  let seq = walk(a, ['fight', 'fight'], { push: true });              // verse 0, 1
  assert.deepEqual(seq, ['verse0', 'verse1']);
  seq = walk(a, ['fight', 'fight', 'fight'], { push: true });
  assert.deepEqual(seq, ['verse2', 'verse3', 'pre0'], 'jumps at the 4-bar phrase, not mid-phrase');
  seq = walk(a, Array(3 + 8).fill('hero'));
  assert.equal(seq[3], 'chorus0');
  assert.equal(a.next('hero').section, 'solo', 'hero at the end of a chorus: solo');
  seq = walk(a, Array(7 + 8).fill('hero'));
  assert.equal(seq[7], 'chorus20', 'solo -> chorus 2');
  assert.equal(a.next('hero').section, 'intro', 'only one solo per chorus');
});

test('arranger: mood flickers never restart the song; danger resumes the interrupted section', () => {
  const a = createArranger(CUES.nightfall);
  walk(a, Array(4 + 8 + 4 + 2).fill('fight'));                       // into the chorus (bar 1)
  assert.equal(a.current.name, 'chorus');
  assert.equal(a.fillFor('danger'), 'fillBig');
  assert.equal(a.next('danger').section, 'danger', 'danger cuts in on the next bar');
  walk(a, ['danger', 'danger']);
  assert.equal(a.fillFor('fight'), 'fillBig');
  const b = a.next('fight'); assert.equal(b.section + b.index, 'chorus0', 'back to the interrupted chorus, not the intro');
  // the fight dies down: cool-down, then tension; coming back soon resumes at a verse
  const cool = walk(a, ['tension', 'tension', 'tension']);
  assert.deepEqual(cool, ['cool0', 'cool1', 'tension0']);
  assert.equal(a.next('fight').section, 'verse', 'a quick return skips the intro');
});

test('arranger: victory and defeat tags play once, then silence; a new mission restarts', () => {
  const a = createArranger(CUES.sweep);
  walk(a, Array(6).fill('fight'));
  assert.equal(a.fillFor('victory'), 'fillRoll');
  assert.deepEqual(walk(a, Array(6).fill('victory')), ['win0', 'win1', 'win2', null, null, null]);
  assert.equal(a.next('calm').section, 'calm');
  const b = createArranger(CUES.sweep); walk(b, Array(5).fill('fight'));
  assert.equal(b.fillFor('defeat'), null);
  assert.deepEqual(walk(b, Array(5).fill('defeat')), ['lose0', 'lose1', 'lose2', null, null]);
});

test('sections: song parts carry their layers (gated snare, verse synth pulse, chorus brass and melody, calm FM bell)', () => {
  for (const id of CUE_IDS) {
    const has = (name, inst) => genSection(CUES[id], name).some((bar) => bar.steps.some((s) => s.some((e) => e.i === inst)));
    for (const [name, inst] of [['verse', 'sbass'], ['verse', 'arp'], ['chorus', 'stab'], ['chorus', 'lead'], ['chorus', 'horn'], ['chorus2', 'lead2'], ['calm', 'bell'], ['solo', 'lead'], ['pre', 'riser'], ['chorus', 'ohat'], ['intro', 'crash'], ['solo', 'scrape']])
      assert.ok(has(name, inst), `${id}/${name} has ${inst}`);
    const v = genSection(CUES[id], 'verse')[0];
    assert.ok(v.steps[8].some((e) => e.i === 'snare') && !v.steps[4].some((e) => e.i === 'snare'), 'verse drums are half-time');
    assert.ok(genSection(CUES[id], 'verse')[0].steps.flat().filter((e) => e.i === 'gtr' && e.m).length >= 8, 'verse guitars are palm-muted chugs');
  }
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
