// One duel, one line per N seconds: geometry from B's view, both pilots' mode / speed / G / altitude.
//   node src/combat/ai/tools/duel-trace.mjs [seed] [skillA] [skillB] [every s] [guns|missiles] [type]
import { duel } from '../duel.mjs';
import { classify } from '../geom.js';
const [seed = 1, sa = 0.25, sb = 0.9, every = 2, wpn = 'guns', type = 'f16'] = process.argv.slice(2);
const g = {};
let n = 0;
const r = await duel({ seed: +seed, typeA: type, typeB: type, skillA: +sa, skillB: +sb, guns: wpn === 'guns', seconds: +(process.env.T || 240), onStep(c, A, B) {
  if (++n % Math.round(+every * 60) || !A.alive || !B.alive) return;
  classify(B, A, g);
  const f = (e) => `${e.pilot.mode}/${e.pilot.sub} v${e.state.ias.toFixed(0)} g${e.state.gLoad.toFixed(1)} h${e.state.position.y.toFixed(0)}`;
  console.log(`${c.clock.toFixed(0)} r ${g.range.toFixed(0)} B.ata ${(g.ata * 57.3).toFixed(0)} B.aa ${(g.aa * 57.3).toFixed(0)} cl ${g.closure.toFixed(0)} | A ${f(A)} | B ${f(B)}`);
} });
console.log(r.winner, r.t, r.weapon);
