// Terrain-loss check: duels over the mountain range; for every aircraft lost to the ground, prints its last mode,
// speed, pitch, hit points and the pilot's terrain-recovery state 1 s before impact.
//   node src/combat/ai/tools/terrain-check.mjs [runs=12] [types=f16,f15,f14] [skills=veteran:veteran,rookie:rookie,rookie:ace] [--guns]
import { duel, mountains } from '../duel.mjs';
const seeds = process.env.SEEDS ? process.env.SEEDS.split(',').map(Number) : null;
const [runs = 12, types = 'f16,f15,f14', skills = 'veteran:veteran,rookie:rookie,rookie:ace'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const SK = { rookie: 0.25, veteran: 0.55, ace: 0.9 };
const guns = process.argv.includes('--guns');
let n = 0, lost = 0, lostDamaged = 0, damagedN = 0;
for (const type of types.split(',')) for (const pair of skills.split(',')) {
  const [a, b] = pair.split(':').map((x) => SK[x] ?? +x);
  for (let i = 0; i < +runs; i++) {
    if (seeds && !seeds.includes(1 + i * 7919)) continue;
    const hist = new Map(), dmg = new Set();
    await duel({ seed: 1 + i * 7919, typeA: type, typeB: type, skillA: a, skillB: b, guns, ground: (x, z, out) => { out.height = mountains(x, z); }, alt: 3000, onStep(c, A, B) {
      if (!c._tc) { c._tc = 1; c.events.on('kill', (k) => { const v = k.victim; if (k.killer || !/terrain|ground|water|Ditched/i.test((k.reason || '') + ' ' + (k.weapon || ''))) return;
        const h = hist.get(v)?.[0]; lost++; if (dmg.has(v)) lostDamaged++;
        console.log(`${type} ${pair} seed ${1 + i * 7919} ${v === A ? 'A' : 'B'}: ${h || '?'} ${dmg.has(v) ? 'DAMAGED' : ''}`);
        if (process.env.DETAIL) hist.get(v).forEach((x, j) => { if (j % 30 === 0) console.log('    ', x); }); }); }
      for (const e of [A, B]) {
        if (!e.alive) continue;
        if (e.hp < (e.maxHp || 100) * 0.95) dmg.add(e);
        const s = e.state, agl = s.position.y - mountains(s.position.x, s.position.z);
        const q = hist.get(e) || []; q.push(`${e.pilot.mode}/${e.pilot.sub} v${s.ias.toFixed(0)} pitch${(s.pitch * 57.3).toFixed(0)} roll${(s.roll * 57.3).toFixed(0)} agl${agl.toFixed(0)} hp${(e.hp ?? 0).toFixed(0)} rec${e.pilot.debug.recovering ? 1 : 0} g${s.gLoad.toFixed(1)} stk${e.controls.pitch.toFixed(2)} nzc${e.pilot._fc.nzCmd.toFixed(1)} nzF${e.pilot._fc.nzFull.toFixed(1)} aoa${(s.aoa * 57.3).toFixed(0)} thr${e.controls.throttle.toFixed(2)}`);
        if (q.length > (process.env.DETAIL ? 1200 : 60)) q.shift(); hist.set(e, q);
      }
    } });
    n += 2;
  }
}
console.log(`${n} aircraft, ${lost} terrain losses (${(100 * lost / n).toFixed(1)} %), ${lostDamaged} of them damaged`);
