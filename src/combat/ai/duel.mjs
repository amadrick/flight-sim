// AI duel bench: N seeded 1v1 fights for a matrix of skills and aircraft types, AI on both sides, real flight model,
// headless (~100× real time). Prints win rates, time to first kill, kills by weapon, terrain / structural losses,
// mean G, time stalled.
//
//   node src/combat/ai/duel.mjs [--runs 10] [--seconds 240] [--skills rookie:ace,ace:rookie,veteran:veteran]
//        [--types f16,f15,fa18,f22,f14,f35,a10] [--vs same|f16] [--guns] [--terrain mountains|flat] [--seed 1]
//        [--alt 5000] [--range 9000] [--verbose] [--json]
//
// --types lists the aircraft of side A; side B flies the same type (--vs same, default) or the given one.
// Side A is blue, side B red; skills are names (rookie 0.25, veteran 0.55, ace 0.9) or numbers.
import * as THREE from 'three';
import { createSandbox } from './tools/sandbox.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const has = (n) => args.includes('--' + n);
const runs = +flag('runs', 10), seconds = +flag('seconds', 240), seed0 = +flag('seed', 1);
const SK = { rookie: 0.25, veteran: 0.55, ace: 0.9 };
const skillOf = (x) => (x in SK ? SK[x] : +x);
const pairs = flag('skills', 'rookie:ace,veteran:veteran,ace:ace').split(',').map((p) => p.split(':'));
const types = flag('types', 'f16').split(',');
const vs = flag('vs', 'same');
const terrain = flag('terrain', 'flat');
const alt0 = +flag('alt', 5000), range0 = +flag('range', 9000);
const verbose = has('verbose');

/** Mountain range for terrain tests: ridges up to ~3000 m, smooth enough for the flight model's ground sampler. */
export function mountains(x, z) {
  const a = Math.sin(x * 0.00021) * Math.cos(z * 0.00017), b = Math.sin((x + z) * 0.00043 + 1.3), c = Math.cos(x * 0.0011 - z * 0.0007);
  return Math.max(0, 1200 + 1300 * a + 600 * b + 180 * c);
}
const groundFn = terrain === 'mountains' ? (x, z, out) => { out.height = mountains(x, z); } : undefined;

/** One duel. Returns a record of what happened. */
export async function duel({ seed, typeA, typeB, skillA, skillB, guns = false, seconds = 240, ground = undefined, alt = 5000, range = 9000, personalityA, personalityB, onStep }) {
  const b = await createSandbox({ seed, groundFn: ground });
  const c = b.combat, w = c.world, rng = c.rng;
  const ang = (rng() - 0.5) * 0.6, off = (rng() - 0.5) * 2000;
  const loadout = guns ? { ir: 0, radar: 0 } : undefined;
  const gA = ground ? ground(0, 0, {}) : 0;
  const baseAlt = Math.max(alt, (ground ? Math.max(mountains(0, -range / 2), mountains(0, range / 2)) : 0) + 2500);
  void gA;
  const A = w.spawnAircraft({ aircraft: typeA, team: 'blue', position: new THREE.Vector3(off, baseAlt + (rng() - 0.5) * 600, range / 2), heading: (ang * 57.3 + 360) % 360, speed: 220, callsign: 'Blue', skill: skillA, loadout });
  const B = w.spawnAircraft({ aircraft: typeB, team: 'red', position: new THREE.Vector3(-off, baseAlt + (rng() - 0.5) * 600, -range / 2), heading: 180 + ang * 57.3, speed: 220, callsign: 'Red', skill: skillB, loadout });
  if (personalityA) A.pilot = c.ai.createPilot(A, { skill: skillA, personality: personalityA });
  if (personalityB) B.pilot = c.ai.createPilot(B, { skill: skillB, personality: personalityB });
  const rec = { seed, typeA, typeB, skillA, skillB, persA: A.pilot.personality, persB: B.pilot.personality, winner: null, t: null, weapon: null, loser: null,
    crash: { terrain: 0, structural: 0, other: 0 }, g: { sum: 0, n: 0, max: 0 }, stalled: 0, below500: 0, alive: 0, shots: 0, missiles: 0, calls: {}, modes: {} };
  const kills = [];
  c.events.on('kill', (k) => { if (k.victim.kind === 'aircraft') kills.push({ t: c.clock, victim: k.victim, killer: k.killer, weapon: k.weapon, reason: k.victim.state.crashReason }); });
  c.events.on('missile:launch', () => rec.missiles++);
  c.events.on('ai:call', (x) => { rec.calls[x.call] = (rec.calls[x.call] || 0) + 1; });
  const dt = 1 / 60;
  b.run(seconds, () => {
    if (onStep) onStep(c, A, B);
    for (const e of [A, B]) {
      if (!e.alive) continue;
      const s = e.state;
      rec.g.sum += Math.abs(s.gLoad); rec.g.n++; if (s.gLoad > rec.g.max) rec.g.max = s.gLoad;
      if (s.stalled) rec.stalled += dt;
      if (s.position.y - (ground ? mountains(s.position.x, s.position.z) : 0) < 500) rec.below500 += dt;
      const m = e.pilot?.mode || '?'; rec.modes[m] = (rec.modes[m] || 0) + dt;
    }
    return !A.alive || !B.alive ? (rec._end ??= c.clock) + 0.5 < c.clock : false;
  }, dt);
  for (const k of kills) {
    const terrainLoss = !k.killer && /terrain|ground|water|Ditched/i.test(k.reason + ' ' + k.weapon);
    const structural = /Structural/.test(k.reason || '');
    if (structural) rec.crash.structural++;
    else if (terrainLoss) rec.crash.terrain++;
    else if (!k.killer) rec.crash.other++;
  }
  const first = kills[0];
  if (first) {
    rec.t = first.t; rec.loser = first.victim === A ? 'A' : 'B'; rec.winner = rec.loser === 'A' ? 'B' : 'A';
    rec.weapon = first.killer ? first.weapon : /Structural/.test(first.reason || '') ? 'structural' : 'terrain';
  }
  rec.shots = (A.stats?.shots || 0) + (B.stats?.shots || 0);
  rec.gunRounds = [A, B].map((e) => e.loadout?.gun?.rounds);
  return rec;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const rows = [];
  const all = [];
  for (const typeA of types) {
    const typeB = vs === 'same' ? typeA : vs;
    for (const [sa, sb] of pairs) {
      const recs = [];
      for (let r = 0; r < runs; r++) {
        const rec = await duel({ seed: seed0 + r * 7919, typeA, typeB, skillA: skillOf(sa), skillB: skillOf(sb), guns: has('guns'), seconds, ground: groundFn, alt: alt0, range: range0 });
        recs.push(rec); all.push(rec);
        if (verbose) console.log(`  ${typeA}/${sa} vs ${typeB}/${sb} seed ${rec.seed}: ${rec.winner ? (rec.winner === 'A' ? 'A' : 'B') + ' wins at ' + rec.t.toFixed(0) + ' s by ' + rec.weapon : 'draw'}  [${rec.persA}/${rec.persB}] crashes ${JSON.stringify(rec.crash)} stalled ${rec.stalled.toFixed(1)} s, mean g ${(rec.g.sum / Math.max(rec.g.n, 1)).toFixed(2)}`);
      }
      const n = recs.length, wa = recs.filter((x) => x.winner === 'A').length, wb = recs.filter((x) => x.winner === 'B').length;
      const tk = recs.filter((x) => x.t != null).map((x) => x.t);
      const byW = {}; for (const x of recs) if (x.weapon) byW[x.weapon] = (byW[x.weapon] || 0) + 1;
      const terr = recs.reduce((a, x) => a + x.crash.terrain, 0), str = recs.reduce((a, x) => a + x.crash.structural, 0);
      const g = recs.reduce((a, x) => a + x.g.sum, 0) / Math.max(1, recs.reduce((a, x) => a + x.g.n, 0));
      const st = recs.reduce((a, x) => a + x.stalled, 0);
      const flown = recs.reduce((a, x) => a + x.g.n, 0) / 60;
      rows.push({ match: `${typeA} ${sa} v ${typeB} ${sb}`, n, A: wa, B: wb, draw: n - wa - wb, ttk: tk.length ? tk.reduce((a, b) => a + b, 0) / tk.length : null,
        ttkMin: tk.length ? Math.min(...tk) : null, weapons: byW, terrain: terr, structural: str, meanG: g, stalledPct: (100 * st) / Math.max(flown, 1), missiles: recs.reduce((a, x) => a + x.missiles, 0) / n });
    }
  }
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + pad('match', 28) + pad('n', 4) + pad('A win', 7) + pad('B win', 7) + pad('draw', 6) + pad('ttk s', 8) + pad('min', 6) + pad('kills by weapon', 30) + pad('terr', 6) + pad('struct', 7) + pad('mean g', 8) + pad('stall%', 8) + 'msl/fight');
  for (const r of rows) console.log(pad(r.match, 28) + pad(r.n, 4) + pad(r.A, 7) + pad(r.B, 7) + pad(r.draw, 6) + pad(r.ttk == null ? '-' : r.ttk.toFixed(0), 8) + pad(r.ttkMin == null ? '-' : r.ttkMin.toFixed(0), 6) +
    pad(Object.entries(r.weapons).map(([k, v]) => `${k} ${v}`).join(', ') || '-', 30) + pad(r.terrain, 6) + pad(r.structural, 7) + pad(r.meanG.toFixed(2), 8) + pad(r.stalledPct.toFixed(2), 8) + r.missiles.toFixed(1));
  if (has('modes')) {
    const mt = {}; let tot = 0;
    for (const x of all) for (const [k, v] of Object.entries(x.modes)) { mt[k] = (mt[k] || 0) + v; tot += v; }
    console.log('\nmode time share: ' + Object.entries(mt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / tot).toFixed(1)}%`).join(', '));
    console.log('gun rounds fired per duel: ' + (all.reduce((a, x) => a + x.shots, 0) / all.length).toFixed(0));
    const calls = {}; for (const x of all) for (const [k, v] of Object.entries(x.calls)) calls[k] = (calls[k] || 0) + v;
    console.log('radio calls per duel: ' + Object.entries(calls).map(([k, v]) => `${k} ${(v / all.length).toFixed(1)}`).join(', '));
  }
  const losses = all.reduce((a, x) => a + x.crash.terrain + x.crash.structural, 0);
  console.log(`\n${all.length} duels, ${2 * all.length} aircraft: terrain/structural losses ${losses} (${((100 * losses) / (2 * all.length)).toFixed(1)} % of aircraft)`);
  if (has('json')) console.log(JSON.stringify(rows));
}
