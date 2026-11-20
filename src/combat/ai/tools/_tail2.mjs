import * as THREE from 'three';
import { createSandbox } from './sandbox.mjs';
const b = await createSandbox({ seed: 3 });
const w = b.combat.world;
const T = w.spawnAircraft({ aircraft: 'f16', team: 'red', position: new THREE.Vector3(0, 5000, 0), heading: 0, speed: 200, skill: 0.25, loadout: { ir: 0, radar: 0 } });
const A = w.spawnAircraft({ aircraft: 'f16', team: 'blue', position: new THREE.Vector3(0, 5000, 1500), heading: 0, speed: 200, skill: 0.9, loadout: { ir: 0, radar: 0 } });
let k = 0;
globalThis.__AIDBG = (e, d) => { if (e !== A || k++ % 12) return; console.log(`${b.combat.clock.toFixed(1)} r ${d.r.toFixed(0)} err ${(d.err*1000).toFixed(0)} ex ${(d.ex*1000).toFixed(0)} ey ${(d.ey*1000).toFixed(0)} tol ${(d.tol*1000).toFixed(0)} good ${d.good} settle ${d.settleT.toFixed(2)} burst ${d.burstT.toFixed(2)} gap ${d.gapT.toFixed(2)} los ${d.losRate.toFixed(2)} g ${A.state.gLoad.toFixed(1)} tg ${T.state.gLoad.toFixed(1)} fire ${A.pilot.debug.want.fire} rnd ${A.loadout.gun.rounds}`); };
b.run(40, () => !T.alive);
