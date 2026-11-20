import { duel } from '../duel.mjs';
const [seed, type, sa, sb, t0] = process.argv.slice(2);
let n = 0;
await duel({ seed: +seed, typeA: type, typeB: type, skillA: +sa, skillB: +sb, seconds: 240, onStep(c, A, B) {
  if (!c._h) { c._h = 1; c.events.on('damage', (d) => console.log(`${c.clock.toFixed(1)} damage ${d.target === A ? 'A' : 'B'} ${d.amount?.toFixed?.(0)} ${d.part || ''} weapon ${d.weapon}`)); c.events.on('kill', (k) => console.log(`${c.clock.toFixed(1)} KILL ${k.victim === A ? 'A' : 'B'} ${k.weapon} ${k.victim.state.crashReason}`)); }
  if (c.clock < +t0 || ++n % 15) return;
  for (const [nm, e] of [['A', A], ['B', B]]) { if (!e.alive) continue; const s = e.state, d = e.sim.damage; console.log(`${c.clock.toFixed(2)} ${nm} ${e.pilot.mode}/${e.pilot.sub} rec ${e.pilot.debug.recovering} ias ${s.ias.toFixed(0)} h ${s.position.y.toFixed(0)} vy ${s.velocity.y.toFixed(0)} pitch ${(s.pitch*57.3).toFixed(0)} roll ${(s.roll*57.3).toFixed(0)} g ${s.gLoad.toFixed(1)} aoa ${(s.aoa*57.3).toFixed(0)} ctrl ${d.ctrl?.toFixed(2)} thr ${d.thrust?.toFixed(2)} rb ${d.rollBias?.toFixed(2)} pb ${d.pitchBias?.toFixed(2)} stick ${e.controls.pitch.toFixed(2)},${e.controls.roll.toFixed(2)}`); }
} });
