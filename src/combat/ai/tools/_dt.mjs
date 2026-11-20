import { duel } from '../duel.mjs';
import { classify } from '../geom.js';
const [seed = 1, sa = 0.25, sb = 0.9, every = 0.5, t0 = 0] = process.argv.slice(2);
const g = {}; let n = 0;
const r = await duel({ seed: +seed, typeA: 'f16', typeB: 'f16', skillA: +sa, skillB: +sb, guns: true, seconds: +(process.env.T || 240), onStep(c, A, B) {
  if (++n % Math.round(+every * 60) || !A.alive || !B.alive || c.clock < +t0) return;
  classify(B, A, g); const d = B.pilot.debug.gun, f = B.pilot._fc;
  console.log(`${c.clock.toFixed(1)} r${g.range.toFixed(0)} ata${(g.ata*57.3).toFixed(0)} aa${(g.aa*57.3).toFixed(0)} hca${(g.hca*57.3).toFixed(0)} cl${g.closure.toFixed(0)} | A ${A.pilot.mode} ${A.pilot.debug.mistake} v${A.state.ias.toFixed(0)} g${A.state.gLoad.toFixed(1)} hA${A.state.position.y.toFixed(0)} hB${B.state.position.y.toFixed(0)} pB${(B.state.pitch*57.3).toFixed(0)} thr${B.controls.throttle.toFixed(2)} | B ${B.pilot.mode}/${B.pilot.sub} v${B.state.ias.toFixed(0)} g${B.state.gLoad.toFixed(1)}/${B.pilot.debug.want.g.toFixed(1)} a${(B.state.aoa*57.3).toFixed(0)} err${(d.err*1000).toFixed(0)} tol${(d.tol*1000).toFixed(0)} los${d.losRate.toFixed(2)} ex${((f.dbgEx||0)*1000).toFixed(0)} ey${((f.dbgEy||0)*1000).toFixed(0)} nzc${f.nzCmd.toFixed(1)}`);
} });
console.log(r.winner, r.t, r.weapon);
