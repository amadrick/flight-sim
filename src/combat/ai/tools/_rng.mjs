import { duel } from '../duel.mjs';
import { classify } from '../geom.js';
const g = {};
for (let i = 0; i < 3; i++) {
  const h = { r1: 0, r3: 0, r6: 0, rx: 0, n: 0, hon: 0, Boff: 0 };
  await duel({ seed: 1 + i * 7919, typeA: 'f16', typeB: 'f16', skillA: 0.25, skillB: 0.9, guns: true, seconds: 200, onStep(c, A, B) {
    if (!A.alive || !B.alive) return; h.n++; classify(B, A, g);
    if (g.range < 1500) h.r1++; else if (g.range < 3000) h.r3++; else if (g.range < 6000) h.r6++; else h.rx++;
    if (g.situation === 'head-on') h.hon++; if (g.aa < 1.57 && g.ata < 1.0 && g.range < 2500) h.Boff++; } });
  const f = (x) => (100 * x / h.n).toFixed(0) + '%';
  console.log(`r<1.5k ${f(h.r1)} 1.5-3k ${f(h.r3)} 3-6k ${f(h.r6)} >6k ${f(h.rx)} head-on ${f(h.hon)} B rear-hemisphere&nose<57° ${f(h.Boff)}`);
}
