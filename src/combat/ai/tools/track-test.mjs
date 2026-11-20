// Gun-tracking check: a scripted target flies a steady level turn (or a jinking pattern); an AI attacker starts
// in its six o'clock. Reports the nose-error statistics, time with a firing solution, hits and time to kill.
//   node src/combat/ai/tools/track-test.mjs [skill=0.55] [targetG=4] [jink]
import * as THREE from 'three';
import { createSandbox } from './sandbox.mjs';
import { createFlightController, profileOf } from '../fly.js';

const skill = +(process.argv[2] || 0.55), tg = +(process.argv[3] || 4), jink = process.argv.includes('jink');
const res = [];
for (let seed = 1; seed <= +(process.env.RUNS || 4); seed++) {
  const b = await createSandbox({ seed });
  const w = b.combat.world;
  const T = w.spawnAircraft({ aircraft: 'f16', team: 'red', position: new THREE.Vector3(0, 5000, 0), heading: 0, speed: 210, loadout: { ir: 0, radar: 0 } });
  const fc = createFlightController(T, profileOf(T.def, T.sim));
  let jt = 0, bank = Math.acos(1 / tg);
  T.pilot = { mode: 'target', update(dt) { if (jink && (jt -= dt) <= 0) { jt = 2 + 2 * b.combat.rng(); bank = (b.combat.rng() < 0.5 ? -1 : 1) * Math.acos(1 / tg); } fc.direct(tg, bank, 9); fc.speed(+(process.env.TSPD || 180)); fc.apply(dt); } };
  const A = w.spawnAircraft({ aircraft: 'f16', team: 'blue', position: new THREE.Vector3(0, 5000, 900), heading: 0, speed: 220, skill, loadout: { ir: 0, radar: 0 }, order: { type: 'cruise', heading: 0, alt: 5000, weaponsHold: true } });
  let engaged = false;
  let n = 0, sum = 0, good = 0, hits = 0, kill = null, shots = 0;
  globalThis.__AIDBG = (e, d) => { if (e !== A) return; n++; sum += d.err; if (d.good) good++; };
  b.combat.events.on('bullet:hit', (h) => { if (h.shooter === A) hits++; });
  b.combat.events.on('kill', (k) => { if (k.victim === T) kill = b.combat.clock; });
  let rounds0 = A.loadout.gun.rounds;
  b.run(40, (t) => { if (!engaged && t > 3) { engaged = true; A.pilot.setOrder({ type: 'engage', target: T }); } return kill != null; });
  shots = rounds0 - A.loadout.gun.rounds;
  res.push({ seed, meanErr: n ? (sum / n) * 1000 : NaN, goodPct: n ? (100 * good) / n : 0, gunsTime: n / 60, hits, shots, kill, attackerAlive: A.alive, modeEnd: A.pilot.mode });
}
for (const r of res) console.log(`seed ${r.seed}: guns ${r.gunsTime.toFixed(1)} s, mean err ${r.meanErr.toFixed(0)} mrad, solution ${r.goodPct.toFixed(0)} %, rounds ${r.shots}, hits ${r.hits}, kill ${r.kill == null ? '-' : r.kill.toFixed(1) + ' s'}`);
