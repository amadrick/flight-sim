import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBench } from '../../../tools/combat-bench.mjs';
import { DAMAGE_TAKEN, MISSILES } from './specs.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

async function pair(o = {}) {
  const b = await createBench({ seed: 5, difficulty: o.difficulty });
  const c = b.combat, W = c.weapons, world = c.world;
  const a = world.spawnAircraft({ aircraft: 'f16', team: 'blue', position: V(0, 5000, 0), heading: 0, speed: 250 });
  const t = world.spawnAircraft({ aircraft: 'f16', team: 'red', position: V(0, 5000, -(o.range || 400)), heading: 0, speed: 250 });
  a.pilot = null; t.pilot = null; a.ownsSim = false; t.ownsSim = false;
  return { c, W, world, a, t };
}

test('gunSolution: smoothed target acceleration keeps the aim point steady through jinks', async () => {
  const { c, W, a, t } = await pair({ range: 500 });
  const dt = 1 / 60, sol = {}, prev = V(0, 0, 0);
  let maxStep = 0, rawMax = 0;
  const raw = { point: V(0, 0, 0), dir: V(0, 0, 0) }, rawPrev = V(0, 0, 0);
  const { solveGun } = await import('./ballistics.js');
  for (let i = 0; i < 180; i++) {
    // target jinks: lateral acceleration flips ±6 g every 0.25 s
    const ay = (Math.floor(i / 15) % 2 ? 1 : -1) * 6 * 9.81;
    for (const e of [a, t]) { e.state.position.z -= 250 * dt; e.state.velocity.set(0, 0, -250); }
    t.state.acceleration.set(ay, 0, 0); a.state.acceleration.set(0, 0, 0);
    c.clock += dt; W.update(dt);
    W.gunSolution(a, t, sol);
    solveGun(a.state, t.state, W.specs.gun, a.wpn.port, raw);
    if (i > 30) { maxStep = Math.max(maxStep, sol.dir.angleTo(prev)); rawMax = Math.max(rawMax, raw.dir.angleTo(rawPrev)); }
    prev.copy(sol.dir); rawPrev.copy(raw.dir);
  }
  assert.ok(maxStep < rawMax * 0.25, `smoothed step ${maxStep} vs raw ${rawMax}`);
  // teleport resets the filter instead of smearing
  t.state.position.x += 5000; t.state.acceleration.set(0, 0, 0);
  W.update(dt);
  assert.ok(t.wpn.accS.length() < 1e-6);
});

test('threatsTo: pooled objects survive truncation, count is set, no new objects per call', async () => {
  const { c, W, a, t } = await pair({ range: 3000 });
  a.target = t;
  for (let i = 0; i < 90; i++) { c.clock += 1 / 60; W.update(1 / 60); }
  assert.equal(a.lock.state, 'locked');
  const out = [];
  W.threatsTo(t, out);
  assert.equal(out.length, 1); assert.equal(out.count, 1);
  const obj = out[0];
  out.length = 0;                    // what the HUD does before each call
  W.threatsTo(t, out);
  assert.equal(out[0], obj, 'same pooled object');
  a.target = null; c.clock += 1 / 60; W.update(1 / 60);
  W.threatsTo(t, out);
  assert.equal(out.length, 0); assert.equal(out.count, 0);
  a.target = t; for (let i = 0; i < 90; i++) { c.clock += 1 / 60; W.update(1 / 60); }
  W.threatsTo(t, out);
  assert.equal(out[0], obj);
});

test('fuel leak drives sim.damage.fuelLeak when the flight model has it', async () => {
  const { c, W, t } = await pair();
  t.sim.damage.fuelLeak = 0;              // the new physics hook
  t.damage.leak = 0.5;
  c.clock += 1 / 60; W.update(1 / 60);
  assert.ok(t.sim.damage.fuelLeak > 5, `${t.sim.damage.fuelLeak}`);
  assert.equal(t.damage.engineOut[0], false);
  W.rearm(t, { heal: 1 });
  assert.equal(t.sim.damage.fuelLeak, 0);
});

test('difficulty: one missile hit — rookie survives crippled, ace dies', async () => {
  for (const [diff, alive] of [['rookie', true], ['ace', false]]) {
    const { c, W, a, t, world } = await pair({ difficulty: diff });
    c.difficulty = diff;
    t.isPlayer = true; world.player = t;
    // worst case: radar warhead at zero distance, max random factor
    W.applyDamage(t, MISSILES.radar.damage * 1.15, { source: a, weapon: 'missile', blast: true, position: t.state.position, distance: 0 });
    assert.equal(t.alive, alive, `${diff}: hp ${t.hp}`);
    if (alive) assert.ok(t.hp < t.maxHp * 0.3 && t.damage.smoke > 0.5, 'crippled');
  }
  assert.ok(DAMAGE_TAKEN.player.rookie.missile * MISSILES.radar.damage * 1.15 < 100);
});

test('fairness: hostile radar launch at the human player waits for the warning hold', async () => {
  const { c, W, world, a, t } = await pair({ range: 6000, difficulty: 'veteran' });
  c.difficulty = 'veteran';
  a.isPlayer = true; world.player = a;     // human: no pilot
  t.target = a; t.loadout.selected = 'radar';
  t.state.quaternion.setFromAxisAngle(V(0, 1, 0), Math.PI); t.state.velocity.set(0, 0, 250);
  t.forward.set(0, 0, 1); t.right.set(-1, 0, 0);
  const ev = [];
  for (const n of ['rwr:spike', 'rwr:lock']) c.events.on(n, () => ev.push([n, c.clock]));
  let launched = null;
  for (let i = 0; i < 60 * 8 && !launched; i++) {
    c.clock += 1 / 60; W.update(1 / 60);
    if (W.launchMissile(t, 'radar')) launched = c.clock;
  }
  assert.ok(launched, 'eventually launches');
  assert.equal(ev[0][0], 'rwr:spike');
  const lockAt = ev.find((x) => x[0] === 'rwr:lock')[1];
  assert.ok(launched - lockAt >= 2.4, `warning ${launched - lockAt}`);
  assert.ok(launched - ev[0][1] >= 4, `spike to launch ${launched - ev[0][1]}`);
});

test('rearm and direct script writes keep state consistent', async () => {
  const { c, W, a, t } = await pair();
  W.applyDamage(t, 60, { source: a, weapon: 'gun', part: 'wingL' });
  t.loadout.missiles.ir = 0; t.loadout.missiles.radar = 0; t.loadout.gun.rounds = 3; t.loadout.flares = 0;
  // scripts writing directly
  t.loadout.missiles.ir = 9; t.hp += 500; t.loadout.flares = 80;
  c.clock += 1 / 60; W.update(1 / 60);
  assert.equal(t.hp, t.maxHp);
  assert.equal(t.loadout.missilesMax.ir, 9); assert.equal(t.loadout.flaresMax, 80);
  // selected rail empty, other has rounds → auto switch
  t.loadout.missiles.ir = 0; t.loadout.missiles.radar = 2; t.loadout.selected = 'ir';
  c.clock += 1 / 60; W.update(1 / 60);
  assert.equal(t.loadout.selected, 'radar');
  // rearm with full heal
  W.applyDamage(t, 70, { source: a, weapon: 'gun', part: 'engine', index: 0 });
  const lo = W.rearm(t, { heal: 1 });
  assert.equal(t.hp, t.maxHp); assert.equal(t.damage.parts.wingL, 0); assert.equal(t.damage.fire, 0);
  assert.equal(t.sim.damage.ctrl, 1); assert.equal(lo.gun.rounds, lo.gun.max);
  assert.equal(lo.missiles.ir, 9);
});
