// Live-page cost of combat audio on the real (software-GL) build: stem preparation time and main-thread slices,
// per-frame cost of the combat-audio update and of the music scheduler, nodes and voices alive, frame times while the
// stems render vs after.
//   node src/combat/audio/perf-live.mjs [seconds=60]    (run after node tools/build.mjs)
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const seconds = +(process.argv[2] || 60), extra = process.argv[3] || '';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.goto(pathToFileURL(resolve(root, 'dist/index.html')).href + '?test=1&autostart=1&mission=instant-2v2&combatbot=1' + extra, { waitUntil: 'commit', timeout: 240000 });
await page.waitForFunction(() => window.__sim && window.__sim.ready, null, { timeout: 240000 });
const out = await page.evaluate(async (seconds) => {
  const sim = window.__sim, ctx = sim.ctx, a = ctx.combat.audio;
  await ctx.audio.resume?.();
  const orig = a.update.bind(a), upd = { calls: 0, ms: 0, max: 0 };
  a.update = (dt) => { const t0 = performance.now(); orig(dt); const d = performance.now() - t0; upd.calls++; upd.ms += d; if (d > upd.max) upd.max = d; };
  const frames = { during: [], after: [] }, t0 = performance.now();
  let maxNodes = 0, maxVoices = 0, maxSfx = 0, readyAt = null, firstPlay = null;
  const ac = ctx.audio.graph?.ac, all = [];
  while (performance.now() - t0 < seconds * 1000) {
    const f0 = performance.now();
    sim.step(1, 1 / 30);
    const ft = performance.now() - f0, inf = a.info; all.push(ft);
    if (inf) {
      maxNodes = Math.max(maxNodes, inf.nodes || 0); maxVoices = Math.max(maxVoices, inf.musicVoices || 0); maxSfx = Math.max(maxSfx, inf.voices ?? 0);
      const st = inf.stems; (st && st.sections < st.total ? frames.during : frames.after).push(ft);
      if (st && st.sections >= st.total && readyAt === null) readyAt = (performance.now() - t0) / 1000;
      if (inf.playing && firstPlay === null) firstPlay = { t: (performance.now() - t0) / 1000, section: inf.section, mood: inf.mood };
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  const q = (arr, p) => { const s = [...arr].sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) : null; };
  const inf = a.info, m = inf;
  if (!m) return { acState: ac?.state, frameMsAll: { n: all.length, p50: q(all, 0.5), p95: q(all, 0.95), max: q(all, 1) }, combatAudioUpdate: { calls: upd.calls, avgMs: +(upd.ms / upd.calls).toFixed(3), maxMs: +upd.max.toFixed(2) } };
  return { acState: ac?.state, sampleRate: ac?.sampleRate, info: { cue: m.cue, section: m.section, mood: m.mood, playing: m.playing, waiting: m.waiting, skipped: m.skipped, fills: m.fills, risers: m.risers },
    stems: m.stems, stemsReadyAfterSec: readyAt, firstPlay,
    combatAudioUpdate: { calls: upd.calls, avgMs: +(upd.ms / upd.calls).toFixed(3), maxMs: +upd.max.toFixed(2) },
    musicScheduler: { calls: m.cpu.calls, avgMs: +(m.cpu.ms / m.cpu.calls).toFixed(4), maxMs: +m.cpu.maxMs.toFixed(2) },
    musicNodesMax: maxNodes, musicVoicesMax: maxVoices, sfxVoicesMax: maxSfx,
    frameMsAll: { n: all.length, p50: q(all, 0.5), p95: q(all, 0.95), max: q(all, 1) },
    frameMs: { duringStems: { n: frames.during.length, p50: q(frames.during, 0.5), p95: q(frames.during, 0.95), max: q(frames.during, 1) }, after: { n: frames.after.length, p50: q(frames.after, 0.5), p95: q(frames.after, 0.95), max: q(frames.after, 1) } } };
}, seconds);
await browser.close();
console.log(JSON.stringify(out, null, 1));
if (errors.length) { console.log('console errors:', errors); process.exit(1); }
