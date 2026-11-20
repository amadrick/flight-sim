// Headless combat bench: runs a mission in node with every aircraft flown by the AI (flat ground at 0 m, calm ISA).
//
//   node tools/combat-bench.mjs [missionId] [--seconds 180] [--difficulty veteran] [--seed 1] [--runs 1] [--log] [--trace N]
//
// Prints what happened (kills, shots, hits, missiles, how the mission ended). No rendering — runs ~100× real time.
// `--log` prints every combat event; `--trace N` prints one line per aircraft every N seconds.
// Import createBench() from this file to script your own scenarios (see the bottom).
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window ??= globalThis;
globalThis.document ??= { createElement: () => ({ getContext: () => null, style: {} }), body: {}, addEventListener() {} };
const imp = (p) => import(pathToFileURL(resolve(root, p)).href);

/** A combat instance on a mock world. opts: { seed, groundHeight, groundFn, difficulty } */
export async function createBench(opts = {}) {
  const { createMockContext } = await imp('src/physics/testing.js');
  const { createCombat } = await imp('src/combat/index.js');
  const ctx = createMockContext({ seed: opts.seed ?? 1, groundHeight: opts.groundHeight ?? 0, groundFn: opts.groundFn, surface: 'terrain' });
  ctx.params.raw.difficulty = opts.difficulty;
  ctx.time = { now: 0, dt: 0, realDt: 0, paused: false };
  const combat = await createCombat(ctx, { headless: true });
  const log = [];
  for (const n of ['mission:start', 'mission:end', 'kill', 'missile:launch', 'missile:hit', 'missile:miss', 'missile:decoyed', 'flare', 'gun:start', 'damage', 'radio', 'objective:update', 'player:down', 'score', 'lock:locked', 'wreck:impact'])
    combat.events.on(n, (p) => log.push({ t: combat.clock, name: n, p }));
  return {
    ctx, combat, log,
    /** advance `seconds` at `dt`; fn(t) may return true to stop early */
    run(seconds, fn, dt = 1 / 60) {
      const n = Math.round(seconds / dt);
      for (let i = 0; i < n; i++) {
        ctx.time.dt = dt; ctx.time.realDt = dt; ctx.time.now += dt;
        combat.pre(dt); combat.step(dt);
        if (fn && fn(combat.clock) === true) return true;
      }
      return false;
    },
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
  const id = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--')) || 'instant-1v1';
  const seconds = +flag('seconds', 180), runs = +flag('runs', 1), seed0 = +flag('seed', 1), trace = +flag('trace', 0);
  const fmt = (e) => `${e.callsign || e.name || e.kind}#${e.id}`;
  for (let r = 0; r < runs; r++) {
    const b = await createBench({ seed: seed0 + r, difficulty: flag('difficulty', 'veteran') });
    const t0 = performance.now();
    if (!b.combat.start(id, { bot: true })) { console.log('unknown mission', id, '— known:', b.combat.director.missions.map((m) => m.id).join(', ')); process.exit(2); }
    let nextTrace = 0;
    const ended = b.run(seconds, (t) => {
      if (trace && t >= nextTrace) {
        nextTrace += trace;
        for (const e of b.combat.world.aircraft) {
          const s = e.state;
          console.log(`  t=${t.toFixed(0).padStart(4)} ${fmt(e).padEnd(14)} ${e.team.padEnd(4)} alt ${(s.position.y).toFixed(0).padStart(6)} m  ias ${(s.ias || 0).toFixed(0).padStart(4)} m/s  g ${(s.gLoad || 0).toFixed(1).padStart(4)}  hp ${String(Math.round(e.hp ?? 0)).padStart(4)}  ${e.pilot?.mode || ''} -> ${e.target ? fmt(e.target) : '-'}`);
        }
      }
      return !!b.combat.result && t > b.combat.result.time + 3;
    });
    if (args.includes('--log')) for (const l of b.log) {
      const p = l.p || {};
      const d = l.name === 'kill' ? `${fmt(p.victim)} by ${p.killer ? fmt(p.killer) : '-'} (${p.weapon})`
        : l.name === 'radio' ? `${p.from}: ${p.text}` : l.name === 'damage' ? `${fmt(p.target)} -${p.amount.toFixed(0)} (${p.weapon}) hp ${p.hp.toFixed(0)}`
        : l.name.startsWith('missile') ? `${p.missile ? fmt(p.missile) : ''} ${p.shooter ? 'from ' + fmt(p.shooter) : ''} ${p.target ? 'at ' + fmt(p.target) : ''} ${p.reason || ''}`
        : l.name === 'mission:end' ? `${p.outcome} — ${p.reason}` : '';
      if (l.name !== 'damage' || args.includes('--damage')) console.log(`  [${l.t.toFixed(1).padStart(6)}] ${l.name.padEnd(16)} ${d}`);
    }
    const kills = b.log.filter((l) => l.name === 'kill' && l.p.victim.kind === 'aircraft');
    const res = b.combat.result;
    console.log(`run ${r + 1} seed ${seed0 + r}: ${res ? res.outcome + ' (' + res.reason + ') at ' + res.time.toFixed(0) + ' s' : 'undecided after ' + seconds + ' s'}; ` +
      `kills: ${kills.map((k) => `${fmt(k.p.victim)}<-${k.p.killer ? fmt(k.p.killer) : 'ground'}/${k.p.weapon}`).join(', ') || 'none'}; ` +
      `missiles ${b.log.filter((l) => l.name === 'missile:launch').length} launched / ${b.log.filter((l) => l.name === 'missile:hit').length} hit; ` +
      `stats ${JSON.stringify(b.combat.director.stats)}; ${(performance.now() - t0).toFixed(0)} ms${ended ? '' : ''}`);
  }
}
