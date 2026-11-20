import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GUNS } from './specs.js';
import { G, gunK, stepRound, pathDistance, pathDrop, pathTime, solveGun, gunTrajectory, rhoAt } from './ballistics.js';

const S = GUNS.m61;

function simulate(pos, vel, k, t, dt = 1 / 600) {
  const n = Math.round(t / dt);
  for (let i = 0; i < n; i++) stepRound(pos, vel, k, dt);
}

test('no drag: drop is ½ g t² and range is v t', () => {
  const p = new THREE.Vector3(), v = new THREE.Vector3(0, 0, -1000);
  simulate(p, v, 0, 1.5);
  assert.ok(Math.abs(-p.z - 1500) < 0.5, `range ${-p.z}`);
  assert.ok(Math.abs(-p.y - 0.5 * G * 1.5 * 1.5) < 0.1, `drop ${-p.y}`);
  assert.ok(Math.abs(pathDrop(1000, 0, 1.5) - 0.5 * G * 2.25) < 1e-9);
});

test('drag: closed form distance and drop match the integrator', () => {
  const k = gunK(S, 1.225);
  assert.ok(k > 3e-4 && k < 9e-4, `k ${k}`);
  for (const t of [0.5, 1, 2]) {
    const p = new THREE.Vector3(), v = new THREE.Vector3(0, 0, -1050);
    simulate(p, v, k, t);
    const s = pathDistance(1050, k, t), d = pathDrop(1050, k, t);
    assert.ok(Math.abs(-p.z - s) < 0.01 * s, `t=${t} dist ${-p.z} vs ${s}`);
    assert.ok(Math.abs(-p.y - d) < 0.05 * d + 0.05, `t=${t} drop ${-p.y} vs ${d}`);
    assert.ok(Math.abs(pathTime(1050, k, s) - t) < 1e-6);
  }
  // velocity decays as v0 / (1 + k v0 t): about 60 % left after 1 km at sea level for a 20 mm round
  const t1 = pathTime(1050, k, 1000);
  assert.ok(t1 > 1.1 && t1 < 1.5, `tof to 1 km ${t1}`);
});

test('density falls with altitude', () => {
  assert.ok(Math.abs(rhoAt(0) - 1.225) < 0.001);
  assert.ok(rhoAt(10000) < 0.45 && rhoAt(10000) > 0.38);
});

function state(px, py, pz, vx, vy, vz) {
  return { position: new THREE.Vector3(px, py, pz), velocity: new THREE.Vector3(vx, vy, vz), quaternion: new THREE.Quaternion(), acceleration: new THREE.Vector3() };
}

test('gun solution: a round fired along the solution meets a crossing target', () => {
  for (const [range, tvx, tvy] of [[400, 200, 0], [800, -150, 30], [1200, 250, -20]]) {
    const sh = state(0, 3000, 0, 0, 0, -230);
    const tg = state(0, 3050, -range, tvx, tvy, -200);
    const out = solveGun(sh, tg, S, null, {});
    // fire a round along out.dir and fly it for out.tof
    const k = gunK(S, rhoAt(3000));
    const p = sh.position.clone(), v = out.dir.clone().multiplyScalar(S.muzzleVelocity).add(sh.velocity);
    simulate(p, v, k, out.tof, 1 / 1200);
    const tp = tg.position.clone().addScaledVector(tg.velocity, out.tof);
    assert.ok(p.distanceTo(tp) < 1.0, `range ${range}: miss by ${p.distanceTo(tp).toFixed(2)} m (tof ${out.tof.toFixed(2)})`);
    assert.ok(Math.abs(out.point.distanceTo(sh.position) - tg.position.distanceTo(sh.position)) < 1e-6);
  }
});

test('gun trajectory: a round fired now sits ahead, drops, and matches the solution for a co-moving target', () => {
  const sh = state(0, 2000, 0, 0, 0, -250);
  const b = gunTrajectory(sh, S, null, 1.0, new THREE.Vector3());
  assert.ok(b.z < -700 && b.z > -1000, `ahead ${b.z}`);
  assert.ok(b.y < -3 && b.y > -6, `drop ${b.y}`);
  assert.ok(Math.abs(b.x) < 1e-6);
  // a target flying exactly the shooter's path at that offset is hit by a round fired straight ahead
  const tg = state(b.x, 2000 + b.y, b.z, 0, 0, -250);
  const out = solveGun(sh, tg, S, null, {});
  assert.ok(Math.abs(out.tof - 1.0) < 0.02, `tof ${out.tof}`);
  assert.ok(out.dir.angleTo(new THREE.Vector3(0, 0, -1)) < 0.002, 'fires along the nose');
});
