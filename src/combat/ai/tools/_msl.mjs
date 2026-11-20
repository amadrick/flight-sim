import { duel } from '../duel.mjs';
const [seed = 1, sa = 0.9, sb = 0.9, guns] = process.argv.slice(2);
await duel({ seed: +seed, typeA: 'f16', typeB: 'f16', skillA: +sa, skillB: +sb, guns: guns === 'guns', seconds: 240, onStep(c, A, B) {
  if (!c._h) { c._h = 1; const ev = c.events; const nm = (x) => x === A ? 'A' : x === B ? 'B' : x?.kind;
    ev.on('missile:launch', (x) => { const L = x.shooter?.lock || x.missile?.owner?.lock; const m = x.missile; console.log(`${c.clock.toFixed(1)} launch ${m.seeker} by ${nm(m.owner)} r ${L?.range?.toFixed(0)} rMax ${L?.rMax?.toFixed(0)} rNe ${L?.rNe?.toFixed(0)} aspect ${(L?.aspect*57.3).toFixed(0)}`); });
    ev.on('missile:miss', (x) => console.log(`${c.clock.toFixed(1)} miss ${x.reason} -> ${nm(x.target)}`));
    ev.on('missile:hit', (x) => console.log(`${c.clock.toFixed(1)} HIT -> ${nm(x.target)}`));
    ev.on('flare', (x) => console.log(`${c.clock.toFixed(1)} flare ${nm(x.entity || x.owner)}`));
    ev.on('kill', (x) => console.log(`${c.clock.toFixed(1)} KILL ${nm(x.victim)} by ${x.weapon}`));
  }
  const t = c.clock; if (Math.abs(t * 2 - Math.round(t * 2)) < 0.008) for (const [n, e] of [['A', A], ['B', B]]) if (e.alive && e.pilot) process.env.V && console.log(`  ${t.toFixed(1)} ${n} ${e.pilot.mode}/${e.pilot.sub} ias ${e.state.ias.toFixed(0)} g ${e.state.gLoad.toFixed(1)} alt ${e.state.position.y.toFixed(0)}`);
} });
