import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invShape, turnRadius, turnRate } from './fly.js';
import { makeSkill, PERSONALITIES } from './skill.js';
import { CALLS, CALL_GAP } from './radio.js';

test('invShape inverts the FCS stick shaping s(1−k+k|s|)', () => {
  for (const k of [0, 0.3, 0.5, 0.9]) for (let s = -1; s <= 1; s += 0.125) {
    const y = s * (1 - k + k * Math.abs(s));
    assert.ok(Math.abs(invShape(y, k) - s) < 1e-9, `k ${k} s ${s}`);
  }
});

test('turn performance helpers', () => {
  assert.ok(Math.abs(turnRadius(200, 5) - 40000 / (9.80665 * Math.sqrt(24))) < 1);
  assert.ok(turnRate(150, 9) > turnRate(250, 9));
});

test('skill: an ace reacts faster, aims tighter and flares later than a rookie', () => {
  const rng = () => 0.5;
  const r = makeSkill(0.25, 'balanced', rng), a = makeSkill(0.9, 'balanced', rng);
  assert.ok(a.reaction < r.reaction && a.aimSigma < r.aimSigma && a.fireTol < r.fireTol);
  assert.ok(a.gUse > r.gUse && a.flareTgo > r.flareTgo && a.gunMax < r.gunMax);
  assert.equal(makeSkill(0.5, 'nonsense', rng).personality, 'balanced');
  for (const p of PERSONALITIES) assert.equal(makeSkill(0.5, p, rng).personality, p);
});

test('every radio call has a gap', () => { for (const c of CALLS) assert.ok(CALL_GAP[c] > 0, c); });
