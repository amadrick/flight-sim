import { duel } from '../duel.mjs';
const [seed = 1, sa = 0.25, sb = 0.9, t0 = 70, t1 = 82] = process.argv.slice(2).map(Number);
let n = 0;
await duel({ seed, typeA: 'f16', typeB: 'f16', skillA: sa, skillB: sb, guns: true, seconds: t1, onStep(c, A, B) {
  if (c.clock < t0 || ++n % 15) return;
  const w = B.pilot.debug.want, s = B.state;
  console.log(`${c.clock.toFixed(2)} ${B.pilot.mode}/${B.pilot.sub} dir.y ${w.dir.y.toFixed(2)} g ${w.g.toFixed(1)} spd ${w.spd.toFixed(0)} ab ${w.ab} | ias ${s.ias.toFixed(0)} vy ${s.velocity.y.toFixed(0)} pitch ${(s.pitch*57.3).toFixed(0)} roll ${(s.roll*57.3).toFixed(0)} gl ${s.gLoad.toFixed(1)} aoa ${(s.aoa*57.3).toFixed(0)} thr ${B.controls.throttle.toFixed(2)} pitchStick ${B.controls.pitch.toFixed(2)}`);
} });
