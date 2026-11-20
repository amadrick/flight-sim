import { GUNS } from '../../weapons/specs.js';
for (const k in GUNS) GUNS[k].damage *= +(process.env.DMG || 2.5);
globalThis.__AU = process.env.AU;
const { duel } = await import('../duel.mjs');
const [sa, sb, runs = 12, seed0 = 1] = process.argv.slice(2);
let w = { A: 0, B: 0, d: 0 }, t = [];
for (let i = 0; i < +runs; i++) { const r = await duel({ seed: +seed0 + i * 7919, typeA: 'f16', typeB: 'f16', skillA: +sa, skillB: +sb, guns: true, seconds: 240 }); if (r.winner) { w[r.winner]++; t.push(r.t); } else w.d++; }
t.sort((a, b) => a - b);
console.log(sa, sb, JSON.stringify(w), 'median', t.length ? t[t.length >> 1].toFixed(0) : '-');
