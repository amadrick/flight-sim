// BFM diagnostics for guns-only duels: per side, time with angular advantage, in the control zone, nose-on, valid
// tracking, mean turn rate / speed / G, and the result.   node src/combat/ai/tools/bfm-stats.mjs [skillA] [skillB] [runs] [type]
import { duel } from '../duel.mjs';
import { classify } from '../geom.js';
const [sa = 0.25, sb = 0.9, runs = 4, type = 'f16'] = process.argv.slice(2);
const g = {}, D = Math.PI / 180;
const tot = { A: {}, B: {} };
for (let i = 0; i < +runs; i++) {
  const st = { A: { adv: 0, zone: 0, nose: 0, track: 0, w: 0, v: 0, g: 0, low: 0 }, B: { adv: 0, zone: 0, nose: 0, track: 0, w: 0, v: 0, g: 0, low: 0 } };
  let n = 0; const hits = [0, 0]; const md = {}; const E = { n: 0, t1: 0, t2: 0, t4: 0, r: 0, l: 0 };
  const r = await duel({ seed: 1 + i * 7919, typeA: type, typeB: type, skillA: +sa, skillB: +sb, guns: true, seconds: 240, onStep(c, A, B) {
    if (!c._hh) { c._hh = 1; c.events.on('bullet:hit', (h) => { hits[h.shooter === A ? 0 : 1]++; }); }
    if (!A.alive || !B.alive) return; n++;
    for (const [k, me, x] of [['A', A, B], ['B', B, A]]) {
      classify(me, x, g); const s = st[k];
      if (g.ata + g.aa < Math.PI * 0.6 && g.range < 3000) s.adv++;
      if (g.range > 250 && g.range < 900 && g.aa < 40 * D && g.hca < 45 * D) s.zone++;
      if (g.ata < 10 * D && g.range < 1200) s.nose++;
      if (me.pilot.mode === 'guns' && me.pilot.debug.gun.err < 0.05) s.track++;
      if (k === 'B' && me.pilot.mode === 'guns') { const d = me.pilot.debug.gun; E.n++; if (d.err < d.tol) E.t1++; if (d.err < 2 * d.tol) E.t2++; if (d.err < 4 * d.tol) E.t4++; E.r += d.r; E.l += d.losRate; }
      const V = me.state.velocity.length(), a = me.state.acceleration; s.w += a ? Math.sqrt(Math.max(a.lengthSq() - (a.dot(me.state.velocity) / V) ** 2, 0)) / V : 0;
      if (k === 'B') { const m = me.pilot.mode + '/' + me.pilot.sub; const q = md[m] || (md[m] = { n: 0, g: 0, wg: 0, ata: 0, al: 0, re: 0 }); q.n++; q.al += me.state.aoa / me.pilot._fc.alphaLimit; q.re += Math.abs(me.pilot._fc.rollErr); q.nc = (q.nc || 0) + me.pilot._fc.nzCmd; q.nd = (q.nd || 0) + me.pilot._fc.dbgNz; q.g += me.state.gLoad; q.wg += me.pilot.debug.want.g; q.ata += g.ata; }
      s.v += me.state.ias; s.g += me.state.gLoad; if (me.state.position.y < 1500) s.low++;
    }
  } });
  const f = (s) => `adv ${(100 * s.adv / n).toFixed(0)}% zone ${(100 * s.zone / n).toFixed(0)}% nose ${(100 * s.nose / n).toFixed(0)}% track ${(100 * s.track / n).toFixed(1)}% ω ${(57.3 * s.w / n).toFixed(1)}°/s v ${(s.v / n).toFixed(0)} g ${(s.g / n).toFixed(1)} low ${(100 * s.low / n).toFixed(0)}%`;
  console.log(`B in guns ${(E.n / 60).toFixed(0)} s: err<tol ${(100 * E.t1 / E.n).toFixed(0)}% <2tol ${(100 * E.t2 / E.n).toFixed(0)}% <4tol ${(100 * E.t4 / E.n).toFixed(0)}% mean r ${(E.r / E.n).toFixed(0)} los ${(E.l / E.n).toFixed(2)}`);
  if (process.env.MODES) console.log(Object.entries(md).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([m, q]) => `${m} ${(100 * q.n / n).toFixed(0)}% g${(q.g / q.n).toFixed(1)}/${(q.wg / q.n).toFixed(1)} ata${(57.3 * q.ata / q.n).toFixed(0)} a/aL ${(q.al / q.n).toFixed(2)} re ${(57.3 * q.re / q.n).toFixed(0)} nzCmd ${(q.nc / q.n).toFixed(1)} nzLim ${(q.nd / q.n).toFixed(1)}`).join(' | '));
  console.log(`seed ${r.seed}: rounds ${r.gunRounds} hits ${hits} ${r.winner ? r.winner + ' ' + r.weapon + ' ' + r.t.toFixed(0) + 's' : 'draw'} | A ${f(st.A)} | B ${f(st.B)}`);
}
