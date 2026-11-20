import { duel } from '../duel.mjs';
const SK = { rookie: 0.25, veteran: 0.55, ace: 0.9 };
const [seed, sa, sb] = process.argv.slice(2);
let n = 0, last = {};
globalThis.__AIDBG = (e, d) => { const t = Math.floor(performance.now()); if (n++ % 15) return; console.log(`${e.callsign} r ${d.r.toFixed(0)} err ${(d.err*1000).toFixed(0)}mr tol ${(d.tol*1000).toFixed(0)} aa ${(d.aa*57.3).toFixed(0)} ata ${(d.ata*57.3).toFixed(0)} los ${(d.losRate*57.3).toFixed(1)}dps settle ${d.settleT.toFixed(2)} good ${d.good} g ${e.state.gLoad.toFixed(1)} aoa ${(e.state.aoa*57.3).toFixed(0)} ias ${e.state.ias.toFixed(0)}`); };
const r = await duel({ seed: +seed, typeA: 'f16', typeB: 'f16', skillA: SK[sa], skillB: SK[sb], guns: true, seconds: 240 });
console.log(r.winner, r.t, r.weapon);
