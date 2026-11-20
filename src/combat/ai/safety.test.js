import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictRecovery, straightClearance, terrainAhead } from './safety.js';

const flat = () => 0;
const P = { nz: 6, rollRate: 3, climb: 0.3, turn: 0, horizon: 12, dt: 0.25, delay: 0.25 };

test('predictRecovery: level flight high up is clear, a steep dive low is not', () => {
  const lvl = predictRecovery(flat, { x: 0, y: 3000, z: 0, vx: 0, vy: 0, vz: -250, roll: 0 }, P, {});
  assert.ok(lvl.clear > 2900);
  const dive = predictRecovery(flat, { x: 0, y: 700, z: 0, vx: 0, vy: -200, vz: -150, roll: 0 }, P, {});
  assert.ok(dive.clear < 200, `clear ${dive.clear}`);
});

test('predictRecovery: inverted costs height (roll time), more G saves height', () => {
  const s = { x: 0, y: 3000, z: 0, vx: 0, vy: -120, vz: -200, roll: 0 };
  const up = predictRecovery(flat, s, P, {}).clear;
  const inv = predictRecovery(flat, { ...s, roll: Math.PI }, P, {}).clear;
  const soft = predictRecovery(flat, s, { ...P, nz: 3 }, {}).clear;
  assert.ok(inv < up);
  assert.ok(soft < up);
});

test('predictRecovery samples the terrain along the path (a ridge ahead)', () => {
  const ridge = (x, z) => (z < -2000 && z > -2600 ? 3200 : 0);
  const r = predictRecovery(ridge, { x: 0, y: 2000, z: 0, vx: 0, vy: 0, vz: -250, roll: 0 }, P, {});
  assert.ok(r.clear < 0, 'ridge is in the way');
  assert.equal(r.ground, 3200);
  // a turning escape avoids it
  const t = predictRecovery(ridge, { x: 0, y: 2000, z: 0, vx: 0, vy: 0, vz: -250, roll: 0 }, { ...P, turn: 0.4 }, {});
  assert.ok(t.clear > r.clear);
});

test('straightClearance and terrainAhead', () => {
  assert.ok(Math.abs(straightClearance(flat, { x: 0, y: 500, z: 0, vx: 0, vy: -50, vz: -200 }, 8) - 100) < 1e-6);
  const hill = (x, z) => (Math.hypot(x, z + 3000) < 400 ? 1800 : 0);
  assert.equal(terrainAhead(hill, 0, 0, 0, [1000, 3000, 5000]), 1800);
  assert.equal(terrainAhead(hill, 0, 0, Math.PI, [1000, 3000, 5000]), 0);
});
