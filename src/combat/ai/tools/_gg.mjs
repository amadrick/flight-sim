import { duel } from '../duel.mjs';
const [seed = 1, sa = 0.25, sb = 0.9] = process.argv.slice(2);
let k = 0, B0;
globalThis.__AIDBG = (e, d) => { if (e !== B0) return; if (k++ % 20) return; console.log(`${e.pilot ? '' : ''}t r ${d.r.toFixed(0)} err ${(d.err*1000).toFixed(0)} tol ${(d.tol*1000).toFixed(0)} aa ${(d.aa*57.3).toFixed(0)} good ${d.good} los ${d.losRate.toFixed(2)} g ${e.state.gLoad.toFixed(1)} v ${e.state.ias.toFixed(0)} tgt ${e.target.pilot.mode} ${e.target.state.gLoad.toFixed(1)}`); };
const r = await duel({ seed: +seed, typeA: 'f16', typeB: 'f16', skillA: +sa, skillB: +sb, guns: true, seconds: 240, onStep(c, A, B) { B0 = B; } });
console.log(r.winner, r.t, r.weapon);
