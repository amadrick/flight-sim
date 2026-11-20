import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { classify, resolveOffset, formationSlot, closestApproach, interceptPoint, pursuitPoint, FORMATION, energyHeight } from './geom.js';

const ent = (p, v, fwd) => ({ state: { position: new THREE.Vector3(...p), velocity: new THREE.Vector3(...v) }, forward: fwd ? new THREE.Vector3(...fwd).normalize() : null });

test('classify: dead astern is offensive, aa 0', () => {
  const me = ent([0, 1000, 1000], [0, 0, -200], [0, 0, -1]);
  const bandit = ent([0, 1000, 0], [0, 0, -180], [0, 0, -1]);
  const g = classify(me, bandit);
  assert.equal(g.situation, 'offensive');
  assert.ok(g.aa < 0.01 && g.ata < 0.01);
  assert.ok(Math.abs(g.range - 1000) < 1e-6);
  assert.ok(Math.abs(g.closure - 20) < 1e-6);
});

test('classify: bandit on my six is defensive, nose to nose is head-on', () => {
  const me = ent([0, 1000, 0], [0, 0, -200], [0, 0, -1]);
  const behind = ent([0, 1000, 800], [0, 0, -200], [0, 0, -1]);
  assert.equal(classify(me, behind).situation, 'defensive');
  const ahead = ent([0, 1000, -3000], [0, 0, 200], [0, 0, 1]);
  const g = classify(me, ahead);
  assert.equal(g.situation, 'head-on');
  assert.ok(g.hca > 3.1);
});

test('resolveOffset: presets, -left mirror, objects', () => {
  const o = {};
  resolveOffset('spread', o); assert.deepEqual(o, { ...FORMATION.spread });
  resolveOffset('wing-left', o); assert.equal(o.x, -FORMATION.wing.x); assert.equal(o.z, FORMATION.wing.z);
  resolveOffset({ x: 10, y: 5 }, o); assert.equal(o.x, 10); assert.equal(o.y, 5); assert.equal(o.z, FORMATION.wing.z);
  resolveOffset(undefined, o); assert.equal(o.x, FORMATION.wing.x);
});

test('formationSlot: right/aft in the leader frame for any heading', () => {
  const out = new THREE.Vector3();
  // leader heading north (−z): right is +x, aft is +z
  formationSlot(ent([0, 500, 0], [0, 0, -100]), { x: 100, y: 10, z: 50 }, out);
  assert.ok(out.distanceTo(new THREE.Vector3(100, 510, 50)) < 1e-6);
  // heading east (+x): right is +z, aft is −x
  formationSlot(ent([0, 500, 0], [100, 0, 0]), { x: 100, y: 0, z: 50 }, out);
  assert.ok(out.distanceTo(new THREE.Vector3(-50, 500, 100)) < 1e-6);
});

test('closestApproach and interceptPoint', () => {
  const ca = closestApproach(new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 0, 0), new THREE.Vector3(1000, 0, 30), new THREE.Vector3(-100, 0, 0));
  assert.ok(Math.abs(ca.t - 5) < 1e-6 && Math.abs(ca.miss - 30) < 1e-6);
  const ip = interceptPoint(new THREE.Vector3(0, 0, 0), 300, new THREE.Vector3(0, 0, -3000), new THREE.Vector3(200, 0, 0), new THREE.Vector3());
  // the chaser at 300 m/s reaches the point when the target does
  const tT = ip.clone().sub(new THREE.Vector3(0, 0, -3000)).length() / 200, tC = ip.length() / 300;
  assert.ok(Math.abs(tT - tC) < 0.01);
});

test('pursuit points: lead ahead of, lag behind the target', () => {
  const me = ent([0, 0, 2000], [0, 0, -200], [0, 0, -1]);
  const tg = ent([0, 0, 0], [200, 0, 0], [1, 0, 0]);
  const p = new THREE.Vector3();
  assert.ok(pursuitPoint(me, tg, 'lead', p).x > 0);
  assert.ok(pursuitPoint(me, tg, 'lag', p).x < 0);
  assert.equal(pursuitPoint(me, tg, 'pure', p).x, 0);
  assert.ok(Math.abs(energyHeight(1000, 100) - (1000 + 10000 / 19.6133)) < 0.1);
});
