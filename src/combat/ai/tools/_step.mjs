import * as THREE from 'three';
import { createSandbox } from './sandbox.mjs';
const id = process.argv[2] || 'f16';
const b = await createSandbox({ seed: 1 });
const e = b.combat.world.spawnAircraft({ aircraft: id, team: 'red', position: new THREE.Vector3(0, 5000, 0), heading: 0, speed: 220 });
e.pilot = { update() { const t = b.combat.clock; e.controls.pitch = t > 0.5 && t < 2 ? 0.6 : t >= 2 && t < 3 ? -0.2 : 0; e.controls.throttle = 1; e.controls.roll = 0; } };
let last = 0; b.run(3.5, (t) => { if (t - last >= 0.05) { last = t; console.log(`t ${t.toFixed(2)} st ${e.controls.pitch} g ${e.state.gLoad.toFixed(2)} q ${(e.state.bodyRates.q*57.3).toFixed(1)} aoa ${(e.state.aoa*57.3).toFixed(1)}`); } });
