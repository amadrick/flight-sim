import { duel } from '../duel.mjs';
const [seed, sa, sb, t0, t1, type] = process.argv.slice(2);
const SK = { rookie: 0.25, veteran: 0.55, ace: 0.9 };
let last = -1;
const r = await duel({ seed: +seed, typeA: type || 'f16', typeB: type || 'f16', skillA: SK[sa] ?? +sa, skillB: SK[sb] ?? +sb, guns: !process.argv.includes('--msl'), seconds: +t1 + 1,
  onStep(c, A, B) {
    const t = c.clock; if (t < +t0 || t - last < (+process.env.DT || 0.25)) return; last = t;
    for (const e of [A, B]) { if (!e.alive) continue; const s = e.state, P = e.pilot;
      console.log(`t=${t.toFixed(2)} ${e.callsign.padEnd(4)} ${(P.mode + '/' + P.sub).padEnd(18)} alt ${s.position.y.toFixed(0).padStart(5)} vy ${s.verticalSpeed.toFixed(0).padStart(4)} pitch ${(s.pitch*57.3).toFixed(0).padStart(4)} roll ${(s.roll*57.3).toFixed(0).padStart(4)} g ${s.gLoad.toFixed(1).padStart(4)} ias ${s.ias.toFixed(0)} aoa ${(s.aoa*57.3).toFixed(0)} rec ${P.debug.recovering} want ${P.debug.want.dir.y.toFixed(2)} g${P.debug.want.g.toFixed(1)} st ${e.controls.pitch.toFixed(2)} thr ${e.controls.throttle.toFixed(2)}`); }
  } });
console.log(r.winner, r.t, r.weapon);
