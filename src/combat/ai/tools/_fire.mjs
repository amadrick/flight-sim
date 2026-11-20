import { duel } from '../duel.mjs';
import { classify } from '../geom.js';
const [seed = 1, sa = 0.25, sb = 0.9] = process.argv.slice(2);
const g = {}; let n = 0, hits = 0;
await duel({ seed: +seed, typeA: 'f16', typeB: 'f16', skillA: +sa, skillB: +sb, guns: true, seconds: 240, onStep(c, A, B) {
  if (!c._h) { c._h = 1; c.events.on('bullet:hit', (h) => { if (h.shooter === B) { hits++; console.log('   HIT', c.clock.toFixed(2)); } }); }
  if (!A.alive || !B.alive) return;
  if (B.controls.trigger || B.wpn?.trigger || B.pilot.debug.want.fire) { if (++n % 6) return;
    classify(B, A, g); const d = B.pilot.debug.gun;
    console.log(`${c.clock.toFixed(2)} ${B.pilot.mode}/${B.pilot.sub} r${g.range.toFixed(0)} ata${(g.ata*57.3).toFixed(0)} aa${(g.aa*57.3).toFixed(0)} err${(d.err*1000).toFixed(0)} tol${(d.tol*1000).toFixed(0)} los${d.losRate.toFixed(2)} Ag${A.state.gLoad.toFixed(1)} A:${A.pilot.mode}`); }
} });
