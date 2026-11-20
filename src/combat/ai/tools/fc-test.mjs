// Flight-controller check: steer each aircraft type through a set of direction changes and report G, AoA, stability.
//   node src/combat/ai/tools/fc-test.mjs [f16,f15,...]
import * as THREE from 'three';
import { createSandbox } from './sandbox.mjs';
import { createFlightController, profileOf } from '../fly.js';
import { headingVec } from '../../util.js';

const ids = (process.argv[2] || 'f16,f15,f14,fa18,f22,f35,a10,b738,a320,c17').split(',');
for (const id of ids) {
  const b = await createSandbox({ seed: 1 });
  const w = b.combat.world;
  const e = w.spawnAircraft({ aircraft: id, team: 'red', position: new THREE.Vector3(0, 4500, 0), heading: 0, speed: id.startsWith('b') || id.startsWith('a3') || id === 'c17' ? 180 : 220 });
  const prof = profileOf(e.def, e.sim);
  const fc = createFlightController(e, prof);
  const dir = new THREE.Vector3();
  const plan = [[0, 'h', 90], [10, 'h', 270], [22, 'h', 270, 25], [30, 'up', 0], [38, 'h', 0], [48, 'down', 0], [52, 'h', 180]];
  let maxG = 0, minG = 9, maxA = 0, stalled = 0, rollOsc = 0, lastSign = 0;
  const gl = prof.heavy ? 2.2 : prof.gMax * 0.9;
  e.pilot = { update(dt) {
    const t = b.combat.clock;
    let step = plan[0]; for (const p of plan) if (t >= p[0]) step = p;
    if (step[1] === 'h') { headingVec(step[2], dir); if (step[3]) dir.y = Math.tan(step[3] * Math.PI / 180); dir.normalize(); }
    else if (step[1] === 'up') dir.set(0, 1, 0).add(headingVec(0, new THREE.Vector3()).multiplyScalar(0.3)).normalize();
    else dir.set(0, -1, 0).add(headingVec(0, new THREE.Vector3()).multiplyScalar(0.5)).normalize();
    fc.steer(dir, gl, +(process.env.GAIN||1.5));
    fc.speed(prof.corner);
    fc.apply(dt);
  } };
  let log = '';
  b.run(62, (t) => {
    const s = e.state;
    if (t > 1) { maxG = Math.max(maxG, s.gLoad); minG = Math.min(minG, s.gLoad); maxA = Math.max(maxA, s.aoa * 57.3); if (s.stalled) stalled += 1 / 60; }
    const sg = Math.sign(e.controls.roll); if (Math.abs(e.controls.roll) > 0.3 && sg !== lastSign) { rollOsc++; lastSign = sg; }
    if (Math.abs(t % 4) < 1 / 60) log += `    t=${t.toFixed(0)} hdg ${(s.heading * 57.3).toFixed(0)} pitch ${(s.pitch * 57.3).toFixed(0)} roll ${(s.roll * 57.3).toFixed(0)} g ${s.gLoad.toFixed(1)} ias ${s.ias.toFixed(0)} alt ${s.position.y.toFixed(0)} aoa ${(s.aoa * 57.3).toFixed(1)}\n`;
    return !e.alive;
  });
  console.log(`${id.padEnd(5)} ${prof.fcsType.padEnd(13)} alive ${e.alive} crash '${e.state.crashReason}' maxG ${maxG.toFixed(1)} (lim ${gl.toFixed(1)}) minG ${minG.toFixed(1)} maxAoA ${maxA.toFixed(0)} stalled ${stalled.toFixed(1)}s rollFlips ${rollOsc}`);
  if (process.argv.includes('-v')) console.log(log);
}
