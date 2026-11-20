// ace starts behind (dist m, offset deg) a rookie; who wins, how long
import * as THREE from 'three';
import { createSandbox } from './sandbox.mjs';
import { classify } from '../geom.js';
const [sa = 0.9, sb = 0.25, dist = 1500, side = 0, runs = 4] = process.argv.slice(2).map(Number);
const g = {};
for (let i = 0; i < runs; i++) {
  const b = await createSandbox({ seed: 3 + i * 101 });
  const w = b.combat.world;
  const T = w.spawnAircraft({ aircraft: 'f16', team: 'red', position: new THREE.Vector3(0, 5000, 0), heading: 0, speed: 200, skill: sb, loadout: { ir: 0, radar: 0 } });
  const A = w.spawnAircraft({ aircraft: 'f16', team: 'blue', position: new THREE.Vector3(Math.sin(side * 0.01745) * dist, 5000, Math.cos(side * 0.01745) * dist), heading: 0, speed: 200, skill: sa, loadout: { ir: 0, radar: 0 } });
  let end = null, off = 0, n = 0, gp = 0;
  b.combat.events.on('kill', (k) => { if (!end) end = `${k.victim === T ? 'attacker' : 'defender'} wins ${b.combat.clock.toFixed(0)}s ${k.weapon}`; });
  b.run(150, () => { if (!A.alive || !T.alive) return true; n++; classify(A, T, g); if (g.aa < 1.05 && g.ata < 0.52 && g.range < 1500) off++; if (g.aa < 0.8 && g.ata < 0.17 && g.range < 900) gp++;
    if (process.env.V && n % 60 === 0) console.log(`${(n/60).toFixed(0)} r ${g.range.toFixed(0)} ata ${(g.ata*57.3).toFixed(0)} aa ${(g.aa*57.3).toFixed(0)} | att ${A.pilot.mode}/${A.pilot.sub} v${A.state.ias.toFixed(0)} g${A.state.gLoad.toFixed(1)} h${A.state.position.y.toFixed(0)} | def ${T.pilot.mode}/${T.pilot.sub} v${T.state.ias.toFixed(0)} g${T.state.gLoad.toFixed(1)} h${T.state.position.y.toFixed(0)}`); });
  console.log(`run ${i}: ${end || 'draw'}  attacker offensive ${(100 * off / n).toFixed(0)}%, gun position ${(100 * gp / n).toFixed(0)}%, rounds ${A.loadout.gun.rounds}`);
}
