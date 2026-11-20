import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBench } from '../../../tools/combat-bench.mjs';
import { getAircraft } from '../../aircraft/registry.js';
import { buildShape, hitShape } from './hitshape.js';
import { simDamageFrom, createDamageState } from './damage.js';
import { createKin, stepKin, pnCommand } from './missile.js';
import { MISSILES } from './specs.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

test('hit shape: fuselage, wings and near misses', () => {
  const sh = buildShape(getAircraft('f16'));
  const hit = {};
  // straight down the nose axis from behind: fuselage / engine
  assert.ok(hitShape(sh, V(0, 0, 40), V(0, 0, -40), hit));
  assert.ok(['engine', 'tail', 'fuselage'].includes(hit.part), hit.part);
  // vertical pass through the right wing
  assert.ok(hitShape(sh, V(3.5, 10, 0.8), V(3.5, -10, 0.8), hit));
  assert.equal(hit.part, 'wingR');
  assert.ok(hitShape(sh, V(-3.5, 10, 0.8), V(-3.5, -10, 0.8), hit));
  assert.equal(hit.part, 'wingL');
  // passing 3 m above the fuselage ahead of the fin: miss; beyond the wingtip: miss
  assert.equal(hitShape(sh, V(0, 3, -6), V(0, 3, 6).setZ(-1), hit), false);
  assert.equal(hitShape(sh, V(7, 10, 0.8), V(7, -10, 0.8), hit), false);
  // over the cockpit, downwards
  assert.ok(hitShape(sh, V(0, 5, -4.45), V(0, -5, -4.45), hit));
  assert.equal(hit.part, 'cockpit');
  // ground units are spheres
  const g = buildShape(null, 6);
  assert.ok(hitShape(g, V(-20, 2, 0), V(20, 2, 0), hit));
  assert.equal(hitShape(g, V(-20, 7, 0), V(20, 7, 0), hit), false);
});

test('damage → sim.damage mapping', () => {
  const d = createDamageState(2);
  const out = { engineOut: [] };
  simDamageFrom(d, 1, out);
  assert.equal(out.thrust, 1); assert.equal(out.ctrl, 1); assert.equal(out.rollBias, 0); assert.equal(out.drag, 0);
  d.parts.wingL = 0.8; d.engineOut[0] = true; d.parts.engines[1] = 0.5;
  simDamageFrom(d, 1, out);
  assert.ok(out.rollBias < 0, 'left wing hurt rolls left');
  assert.ok(out.ctrl < 1 && out.drag > 0);
  assert.equal(out.engineOut[0], true);
  assert.ok(out.thrust < 1 && out.thrust > 0.5);
});

test('proportional navigation intercepts a crossing target', () => {
  const S = MISSILES.radar, k = createKin(), a = V(0, 0, 0);
  k.pos.set(0, 6000, 0); k.vel.set(0, 0, -300);
  const tp = V(0, 6000, -8000), tv = V(250, 0, 0);
  let best = Infinity;
  for (let i = 0; i < 60 * 40; i++) {
    pnCommand(k.pos, k.vel, tp, tv, S.navGain, a);
    stepKin(k, S, a, 1 / 60, 0);
    tp.addScaledVector(tv, 1 / 60);
    best = Math.min(best, k.pos.distanceTo(tp));
    if (best < 3) break;
  }
  assert.ok(best < S.fuze, `miss ${best.toFixed(1)} m`);
});

async function pair(o = {}) {
  const b = await createBench({ seed: 3 });
  const c = b.combat, W = c.weapons, world = c.world;
  const a = world.spawnAircraft({ aircraft: 'f16', team: 'blue', position: V(0, 5000, 0), heading: 0, speed: 250, loadout: o.la });
  const t = world.spawnAircraft({ aircraft: o.tid || 'f16', team: 'red', position: V(0, 5000, -(o.range || 2500)), heading: 0, speed: 250, loadout: o.lt });
  a.pilot = null; t.pilot = null;
  const step = (n) => { for (let i = 0; i < n; i++) { c.clock += 1 / 60; world.stepAircraft(1 / 60); W.update(1 / 60); } };
  return { b, c, W, world, a, t, step };
}

test('loadouts and mission overrides', async () => {
  const { a, world, W } = await pair({ la: { ir: 0, radar: 0, hp: 400 } });
  assert.equal(a.loadout.missiles.ir, 0); assert.equal(a.loadout.missiles.radar, 0);
  assert.equal(a.maxHp, 400); assert.equal(a.loadout.gun.rounds, 511);
  const hog = world.spawnAircraft({ aircraft: 'a10', team: 'blue', position: V(0, 3000, 5000), heading: 0, speed: 180 });
  assert.equal(hog.loadout.gun.type, 'gau8'); assert.ok(hog.maxHp > a.maxHp / 2 && hog.maxHp > 200);
  const liner = world.spawnAircraft({ aircraft: 'b738', team: 'neutral', position: V(0, 9000, 9000), heading: 0, speed: 220 });
  assert.equal(liner.loadout.gun.spec, null); assert.equal(liner.loadout.missiles.ir, 0);
  assert.equal(W.launchMissile(liner), null);
  assert.ok(Array.isArray(a.damage.engineOut) && 'smoke' in a.damage && 'fire' in a.damage);
});

test('lock-on, launch, threat picture, missile kill with credit', async () => {
  const { c, W, a, t, step } = await pair({ range: 2500 });
  a.target = t;
  const kills = [];
  c.events.on('kill', (p) => kills.push(p));
  step(90);
  assert.equal(a.lock.state, 'locked');
  assert.ok(a.lock.inRange && a.lock.rMax > a.lock.range && a.lock.rMin < a.lock.range);
  const m = W.launchMissile(a);
  assert.ok(m && m.kind === 'missile');
  step(2);
  const th = W.threatsTo(t, []);
  assert.ok(th.some((x) => x.type === 'missile' && x.missile === m && x.seeker === 'ir' && x.source === a));
  step(60 * 12);
  assert.ok(kills.length === 1 && kills[0].victim === t && kills[0].killer === a && kills[0].weapon === 'missile');
  assert.ok(Array.isArray(kills[0].info.assists));
});

test('no launch without a lock', async () => {
  const { c, W, a } = await pair();
  let refused = 0; c.events.on('weapon:nolock', () => refused++);
  assert.equal(W.launchMissile(a), null);
  assert.equal(refused, 1);
});

test('gun burst kills, records hits, credits the shooter and the assist', async () => {
  const { c, W, a, t, step, world } = await pair({ range: 300 });
  const helper = world.spawnAircraft({ aircraft: 'f16', team: 'blue', position: V(500, 5000, 0), heading: 0, speed: 250 });
  helper.pilot = null;
  W.applyDamage(t, 30, { source: helper, weapon: 'gun' });
  assert.equal(t.lastHitBy, helper);
  a.stats = {};
  const kills = [];
  c.events.on('kill', (p) => kills.push(p));
  // kinematic: both fly straight and level at 250 m/s, the shooter's nose on the gun solution
  a.ownsSim = false; t.ownsSim = false;
  const sol = {}, FWD = V(0, 0, -1);
  for (let i = 0; i < 60 * 3 && t.alive; i++) {
    for (const e of [a, t]) { e.state.velocity.set(0, 0, -250); e.state.position.z -= 250 / 60; e.state.acceleration.set(0, 0, 0); }
    W.gunSolution(a, t, sol);
    a.state.quaternion.setFromUnitVectors(FWD, sol.dir);
    a.forward.copy(sol.dir); a.up.set(0, 1, 0).applyQuaternion(a.state.quaternion); a.right.set(1, 0, 0).applyQuaternion(a.state.quaternion);
    a.trigger = true; c.clock += 1 / 60; W.update(1 / 60);
  }
  assert.equal(t.alive, false);
  assert.equal(kills[0].killer, a);
  assert.ok(kills[0].info.assists.includes(helper));
  assert.ok(a.stats.hits > 3 && a.stats.shots > a.stats.hits && a.stats.damageDealt > 0);
});

test('flares are released in pairs, fall, and fade', async () => {
  const { W, t, step } = await pair();
  const n0 = t.loadout.flares;
  assert.ok(W.dropFlares(t));
  assert.equal(t.loadout.flares, n0 - 2);
  assert.equal(W.dropFlares(t), false, 'cooldown');
  const f = W.flares[0];
  assert.equal(f.kind, 'flare'); assert.equal(f.owner, t);
  const y0 = f.state.position.y;
  step(30);
  assert.ok(f.heat > 0.5 && f.state.position.y < y0);
  step(60 * 5);
  assert.equal(W.flares.length, 0);
});

test('invulnerable targets and difficulty table', async () => {
  const { W, t, c, a } = await pair({ lt: { invulnerable: true } });
  W.applyDamage(t, 500, { source: a });
  assert.ok(t.alive && t.hp === t.maxHp);
  a.isPlayer = true; c.world.player = a; c.difficulty = 'rookie';
  W.applyDamage(a, 10, { source: t, part: 'fuselage' });
  const rookieLoss = a.maxHp - a.hp;
  assert.ok(rookieLoss < 6, `rookie took ${rookieLoss}`);
});
