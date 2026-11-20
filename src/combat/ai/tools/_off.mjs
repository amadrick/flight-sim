import { duel } from '../duel.mjs';
import { classify } from '../geom.js';
const [sa = 0.25, sb = 0.9, n = 4] = process.argv.slice(2);
const g = {};
for (let i = 0; i < +n; i++) {
  const st = { A: 0, B: 0, Ag: 0, Bg: 0, vA: 0, vB: 0, k: 0 };
  const r = await duel({ seed: 1 + i * 7919, typeA: 'f16', typeB: 'f16', skillA: +sa, skillB: +sb, guns: true, seconds: 180, onStep(c, A, B) {
    if (!A.alive || !B.alive) return; st.k++;
    classify(B, A, g); if (g.aa < 60 * 0.01745 && g.ata < 30 * 0.01745 && g.range < 1500) st.B++; if (g.aa < 45 * 0.01745 && g.ata < 10 * 0.01745 && g.range < 900) st.Bg++;
    classify(A, B, g); if (g.aa < 60 * 0.01745 && g.ata < 30 * 0.01745 && g.range < 1500) st.A++; if (g.aa < 45 * 0.01745 && g.ata < 10 * 0.01745 && g.range < 900) st.Ag++;
    st.vA += A.state.ias; st.vB += B.state.ias; } });
  const f = (x) => (100 * x / st.k).toFixed(1);
  console.log(`seed ${r.seed}: A off ${f(st.A)}% gunpos ${f(st.Ag)}% v ${(st.vA / st.k).toFixed(0)} | B off ${f(st.B)}% gunpos ${f(st.Bg)}% v ${(st.vB / st.k).toFixed(0)} | ${r.winner} ${r.weapon} ${r.gunRounds}`);
}
