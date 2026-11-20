import { duel } from '../duel.mjs';
const [sa = 0.9, sb = 0.9, runs = 6] = process.argv.slice(2);
for (let i = 0; i < +runs; i++) {
  const ev = [];
  const r = await duel({ seed: 1 + i * 7919, typeA: 'f16', typeB: 'f16', skillA: +sa, skillB: +sb, seconds: 240, onStep(c, A, B) {
    if (!c._h) { c._h = 1; c.events.on('missile:launch', (m) => { const o = m.shooter === A ? B : A; ev.push(`${c.clock.toFixed(0)}s ${m.shooter === A ? 'A' : 'B'}:${m.type}@${(m.shooter.state.position.distanceTo(o.state.position)/1000).toFixed(1)}k(${m.shooter.pilot.personality[0]})`); }); }
  } });
  console.log(`seed ${r.seed}: ${r.winner || 'draw'} ${r.weapon || ''} ${r.t ? r.t.toFixed(0) : ''} | ${ev.join(' ')}`);
}
