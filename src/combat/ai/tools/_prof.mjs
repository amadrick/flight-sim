import * as THREE from 'three';
import { createSandbox } from './sandbox.mjs';
import { profileOf } from '../fly.js';
const b = await createSandbox({ seed: 1 });
for (const t of ['f16','f15','fa18','f22','f14','f35','a10']) { const e = b.combat.world.spawnAircraft({ aircraft: t, team: 'red', position: new THREE.Vector3(0, 5000, 0), heading: 0, speed: 200 }); const p = profileOf(e.def, e.sim); console.log(t, 'corner', p.corner, 'stall', p.stall, 'gMax', p.gMax, 'vmo', p.vmo, 'ab', p.ab); }
