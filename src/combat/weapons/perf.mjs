// Per-frame cost of weapons.update with N aircraft holding the trigger (long bursts): node src/combat/weapons/perf.mjs [--n 8]
import * as THREE from 'three';
import { createBench } from '../../../tools/combat-bench.mjs';
const args = process.argv.slice(2), n = +(args[args.indexOf('--n') + 1] || 8) || 8;
const b = await createBench({ seed: 1 }); const c = b.combat, W = c.weapons, world = c.world;
const A = [];
for (let i = 0; i < n; i++) {
  const e = world.spawnAircraft({ aircraft: i % 2 ? 'a10' : 'f16', team: i % 2 ? 'red' : 'blue', position: new THREE.Vector3((i % 4) * 300, 5000 + (i >> 2) * 200, -(i % 2) * 600), heading: i % 2 ? 180 : 0, speed: 220, loadout: { gun: 1e6, invulnerable: true } });
  e.pilot = null; e.ownsSim = false; e.invulnerable = true; A.push(e);
}
const dt = 1 / 60; let tW = 0, frames = 0, maxB = 0;
const h0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 60 * 20; i++) {
  for (const e of A) { e.trigger = true; e.state.position.addScaledVector(e.state.velocity, dt); }
  c.clock += dt;
  const t0 = performance.now(); W.update(dt); const t1 = performance.now();
  if (i > 120) { tW += t1 - t0; frames++; }
  maxB = Math.max(maxB, W.bullets.n);
}
console.log(`${n} aircraft firing continuously for 20 s: weapons.update ${(tW / frames).toFixed(3)} ms/frame mean, live rounds up to ${maxB}, pool ${W.bullets.items.length}, heap +${((process.memoryUsage().heapUsed - h0) / 1e6).toFixed(1)} MB`);
