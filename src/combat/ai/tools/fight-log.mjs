// Fight-length distribution: one line per duel (winner, weapon, time, every missile launch with range and the
// shooter's personality), then the quartiles of the decided fights.
//   node src/combat/ai/tools/fight-log.mjs [skillA=0.55] [skillB=0.55] [runs=12] [type=f16] [--guns] [--seed 1]
import { duel } from '../duel.mjs';
const args = process.argv.slice(2), guns = args.includes('--guns');
const si = args.indexOf('--seed'), seed0 = si >= 0 ? +args[si + 1] : 1;
const [sa = 0.55, sb = 0.55, runs = 12, type = 'f16'] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--seed');
const T = [];
let draws = 0;
for (let i = 0; i < +runs; i++) {
  const ev = [];
  const r = await duel({ seed: seed0 + i * 7919, typeA: type, typeB: type, skillA: +sa, skillB: +sb, guns, seconds: 240, onStep(c, A, B) {
    if (c._fl) return; c._fl = 1;
    c.events.on('missile:launch', (m) => { const o = m.shooter === A ? B : A; ev.push(`${c.clock.toFixed(0)}s ${m.shooter === A ? 'A' : 'B'} ${m.type} ${(m.shooter.state.position.distanceTo(o.state.position) / 1000).toFixed(1)} km (${m.shooter.pilot.personality})`); });
  } });
  if (r.winner) T.push(r.t); else draws++;
  console.log(`seed ${r.seed}: ${r.winner ? `${r.winner} by ${r.weapon} at ${r.t.toFixed(0)} s` : 'draw'}${ev.length ? ' | ' + ev.join(', ') : ''}`);
}
T.sort((a, b) => a - b);
const q = (p) => (T.length ? T[Math.min(T.length - 1, Math.floor(p * T.length))].toFixed(0) : '-');
console.log(`${T.length} decided, ${draws} draws; fight length s: min ${q(0)} q1 ${q(0.25)} median ${q(0.5)} q3 ${q(0.75)} max ${T.length ? T[T.length - 1].toFixed(0) : '-'}`);
