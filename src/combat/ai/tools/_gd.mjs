import { duel } from '../duel.mjs';
import { classify } from '../geom.js';
const [seed = 1, sa = 0.25, sb = 0.9, every = 2] = process.argv.slice(2);
const g = {};
const r = await duel({ seed: +seed, typeA: 'f16', typeB: 'f16', skillA: +sa, skillB: +sb, guns: true, seconds: +(process.env.T || 240), onStep(c, A, B) {
  const t = c.clock; if (((c._n = (c._n || 0) + 1) % Math.round(every * 60)) === 0 && A.alive && B.alive) {
    classify(B, A, g);
    const f = (e) => `${e.pilot.mode}/${e.pilot.sub} v${e.state.ias.toFixed(0)} g${e.state.gLoad.toFixed(1)} h${e.state.position.y.toFixed(0)}`;
    console.log(`${t.toFixed(0)} r ${g.range.toFixed(0)} B.ata ${(g.ata*57.3).toFixed(0)} B.aa ${(g.aa*57.3).toFixed(0)} | A ${f(A)} | B ${f(B)} rnd ${A.loadout.gun.rounds}/${B.loadout.gun.rounds}`);
  } } });
console.log(r.winner, r.t, r.weapon);
