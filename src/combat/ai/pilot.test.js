// Integration: real flight model + weapons on the headless bench (no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSandbox } from './tools/sandbox.mjs';

test('pilot API: createPilot → update / setOrder / order / mode / skill', async () => {
  const b = await createSandbox({ seed: 1 });
  const w = b.combat.world;
  const e = w.spawnAircraft({ aircraft: 'f16', team: 'blue', position: new THREE.Vector3(0, 4000, 0), heading: 0, speed: 200, skill: 0.5 });
  const p = b.combat.ai.createPilot(e, { skill: 0.7, order: { type: 'cruise', heading: 90, alt: 4000 } });
  assert.equal(typeof p.update, 'function');
  assert.equal(p.skill, 0.7);
  assert.equal(p.order.type, 'cruise');
  e.pilot = p;
  b.run(20);
  assert.equal(typeof p.mode, 'string');
  assert.ok(e.alive);
  assert.ok(Math.abs(e.state.position.y - 4000) < 400, `alt ${e.state.position.y}`);
  p.setOrder({ type: 'orbit', center: new THREE.Vector3(0, 4000, 0), radius: 5000 });
  assert.equal(p.order.type, 'orbit');
});

test('heavy transport on a passive patrol flies stably and never shoots', async () => {
  const b = await createSandbox({ seed: 2 });
  const w = b.combat.world;
  const wps = [new THREE.Vector3(0, 3000, -20000), new THREE.Vector3(20000, 3000, -20000), new THREE.Vector3(20000, 3000, 0)];
  const t = w.spawnAircraft({ aircraft: 'c17', team: 'red', position: new THREE.Vector3(0, 3000, 0), heading: 0, speed: 160, order: { type: 'patrol', waypoints: wps, loop: true, passive: true } });
  w.spawnAircraft({ aircraft: 'f16', team: 'blue', position: new THREE.Vector3(3000, 3000, 2000), heading: 0, speed: 200, order: { type: 'cruise', heading: 0, alt: 3000, weaponsHold: true } });
  let maxDev = 0;
  b.run(120, () => { if (t.alive) maxDev = Math.max(maxDev, Math.abs(t.state.position.y - 3000)); return !t.alive; });
  assert.ok(t.alive, t.state.crashReason);
  assert.ok(maxDev < 600, `altitude deviation ${maxDev}`);
  assert.equal(t.target ?? null, null);
  assert.ok(!t.state.stalled);
});

test('neutrals are not attacked until they turn hostile', async () => {
  const b = await createSandbox({ seed: 3 });
  const w = b.combat.world;
  const n = w.spawnAircraft({ aircraft: 'f16', team: 'neutral', position: new THREE.Vector3(0, 4000, -6000), heading: 0, speed: 200, order: { type: 'cruise', heading: 0, alt: 4000 } });
  const f = w.spawnAircraft({ aircraft: 'f16', team: 'blue', position: new THREE.Vector3(0, 4000, 0), heading: 0, speed: 200, order: { type: 'patrol', waypoints: [new THREE.Vector3(0, 4000, -30000)] } });
  b.run(8);
  assert.notEqual(f.target, n);
  assert.equal(n.target ?? null, null);
  n.team = 'red';
  b.run(4);
  assert.equal(f.target, n);
});

test('1v1 fight: no exceptions, nobody flies into the ground', async () => {
  const b = await createSandbox({ seed: 4 });
  const w = b.combat.world;
  const A = w.spawnAircraft({ aircraft: 'f16', team: 'blue', position: new THREE.Vector3(0, 3000, 5000), heading: 0, speed: 220, skill: 0.9 });
  const B = w.spawnAircraft({ aircraft: 'f15', team: 'red', position: new THREE.Vector3(0, 3000, -5000), heading: 180, speed: 220, skill: 0.25 });
  const crashes = [];
  b.combat.events.on('kill', (k) => { if (!k.killer) crashes.push(k.victim.state.crashReason); });
  const modes = new Set();
  b.run(150, () => { if (A.alive) modes.add(A.pilot.mode); if (B.alive) modes.add(B.pilot.mode); });
  assert.deepEqual(crashes.filter((r) => /terrain|Structural/i.test(r || '')), []);
  assert.ok(modes.has('pursuit') || modes.has('merge'), [...modes].join(','));
});
