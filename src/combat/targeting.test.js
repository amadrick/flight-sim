// Target selection: nose-order cycling, threat pick, auto pick after a kill, friendlies excluded, mission priority.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Events } from '../core/events.js';
import { createTargeting, isTargetable, RETARGET_DELAY, START_DELAY } from './targeting.js';

// player at the origin flying north (-Z), identity quaternion
function rig() {
  const ev = new Events();
  const mk = (o) => ({ alive: true, kind: 'aircraft', team: 'red', state: { position: new THREE.Vector3(...o.pos), quaternion: new THREE.Quaternion() }, ...o });
  const p = mk({ pos: [0, 1000, 0], team: 'blue', isPlayer: true });
  const world = { player: p, entities: [p] };
  const combat = { events: ev, world, clock: 0, director: { markers: [] } };
  const tg = createTargeting(combat);
  const add = (o) => { const e = mk(o); world.entities.push(e); return e; };
  const cmd = (name) => ev.emit('cmd', { name });
  const step = (dt) => { combat.clock += dt; tg.update(dt); };
  return { ev, p, world, combat, tg, add, cmd, step };
}

test('Tab cycles nearest the nose first, Shift+Tab walks back', () => {
  const r = rig();
  const ahead = r.add({ pos: [100, 1000, -5000] });      // ~1° off the nose
  const right = r.add({ pos: [3000, 1000, -3000] });     // 45°
  const behind = r.add({ pos: [0, 1000, 2000] });        // 180°, but closest
  r.cmd('targetNext'); assert.equal(r.p.target, ahead);
  r.cmd('targetNext'); assert.equal(r.p.target, right);
  r.cmd('targetNext'); assert.equal(r.p.target, behind);
  r.cmd('targetNext'); assert.equal(r.p.target, ahead);  // wraps
  r.cmd('targetPrev'); assert.equal(r.p.target, behind);
  r.cmd('targetNearest'); assert.equal(r.p.target, ahead);
});

test('never friendlies, neutrals or munitions unless the mission marks them targetable', () => {
  const r = rig();
  const wing = r.add({ pos: [0, 1000, -1000], team: 'blue' });
  const civ = r.add({ pos: [0, 1000, -1200], team: 'neutral' });
  r.add({ pos: [0, 1000, -900], kind: 'missile' });
  const hidden = r.add({ pos: [0, 1000, -800], targetable: false });
  const bandit = r.add({ pos: [2000, 1000, -6000] });
  r.cmd('targetNext'); assert.equal(r.p.target, bandit);
  r.cmd('targetNext'); assert.equal(r.p.target, bandit);   // only one valid
  assert.equal(isTargetable(r.p, wing), false); assert.equal(isTargetable(r.p, civ), false); assert.equal(isTargetable(r.p, hidden), false);
  civ.targetable = true; assert.equal(isTargetable(r.p, civ), true);
});

test('auto pick at mission start, re-pick a moment after the kill, change events', () => {
  const r = rig();
  const far = r.add({ pos: [0, 1000, -12000] });
  const attacker = r.add({ pos: [4000, 1000, 6000] });
  attacker.target = r.p; attacker.lock = { target: r.p, state: 'locked' };   // locked on us: the most dangerous
  const seen = []; r.ev.on('target:change', (e) => seen.push(e.how));
  r.ev.emit('mission:start', {});
  r.step(START_DELAY / 2); assert.equal(r.p.target ?? null, null);
  r.step(START_DELAY); assert.equal(r.p.target, attacker);
  // the attacker dies: core clears entity.target before targeting sees it
  attacker.alive = false; r.p.target = null;
  r.step(0.1); assert.equal(r.p.target, null);             // the kill reads first
  r.step(RETARGET_DELAY); assert.equal(r.p.target, far);
  assert.deepEqual(seen, ['auto', 'auto']);
});

test('mission-priority targets win the threat pick; targetClear stops auto picks', () => {
  const r = rig();
  r.add({ pos: [0, 1000, -2000] });
  const hvt = r.add({ pos: [9000, 1000, -9000], kind: 'ground' });
  r.combat.director.markers.push({ kind: 'target', entity: hvt });
  r.cmd('targetThreat'); assert.equal(r.p.target, hvt);
  r.cmd('targetClear'); r.step(5); assert.equal(r.p.target, null);
  r.cmd('targetNext'); assert.ok(r.p.target);
});
