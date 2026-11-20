import * as THREE from 'three';
import { createSandbox } from './sandbox.mjs';
import { createFlightController, profileOf } from '../fly.js';
import { classify } from '../geom.js';
const seed=+process.argv[2]||1, skill=+(process.argv[3]||0.9), tg=+(process.argv[4]||4);
const b = await createSandbox({ seed }); const w=b.combat.world;
const T = w.spawnAircraft({ aircraft: 'f16', team: 'red', position: new THREE.Vector3(0, 5000, 0), heading: 0, speed: 210, loadout: { ir: 0, radar: 0 } });
const fc = createFlightController(T, profileOf(T.def, T.sim)); const bank=Math.acos(1/tg);
T.pilot = { mode: 'target', update(dt) { fc.direct(tg, bank, 9); fc.speed(180); fc.apply(dt); } };
const A = w.spawnAircraft({ aircraft: 'f16', team: 'blue', position: new THREE.Vector3(0, 5000, 900), heading: 0, speed: 220, skill, loadout: { ir: 0, radar: 0 }, order: { type: 'cruise', heading: 0, alt: 5000, weaponsHold: true } });
let eng=false, k=0; const g={};
b.run(+(process.env.T||25),(t)=>{ if(!eng&&t>3){eng=true;A.pilot.setOrder({type:'engage',target:T});}
 if(++k%30===0){ classify(A,T,g); const d=A.pilot.debug.gun, f=A.pilot._fc; console.log(t.toFixed(1),A.pilot.mode+'/'+A.pilot.sub,'r',g.range.toFixed(0),'cl',g.closure.toFixed(0),'ata',(g.ata*57.3).toFixed(0),'aa',(g.aa*57.3).toFixed(0),'err',(d.err*1000).toFixed(0),'tol',(d.tol*1000).toFixed(0),'los',d.losRate.toFixed(2),'ias',A.state.ias.toFixed(0),'/',T.state.ias.toFixed(0),'g',A.state.gLoad.toFixed(1),'aoa',(A.state.aoa*57.3).toFixed(0),'aL',(f.alphaLimit*57.3).toFixed(0),'tv',f.trackValid?1:0,'re',(f.rollErr*57.3).toFixed(0),'ex',((f.dbgEx||0)*1000).toFixed(0),'ey',((f.dbgEy||0)*1000).toFixed(0),'nzc',f.nzCmd.toFixed(1)); }
});
