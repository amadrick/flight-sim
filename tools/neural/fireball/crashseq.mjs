// Crash screenshot sequence: one page load, several shots at exact times after a test crash.
//
//   node tools/neural/fireball/crashseq.mjs --params "tod=12&crashtest=impact&crashdist=600" \
//        --times 0.2,1,3,10,40 --prefix shots/day_grass [--size 960x540] [--no-build]
//
// Boots dist/index.html with ?test=1&autostart=1&aircraft=f16&hud=0&crashat=1&<params>, steps until the crash has
// started, then advances the simulation to each requested time (seconds after the crash) and saves
// <prefix>_<t>s.png. main.js clamps a frame to 0.1 s, so longer gaps raise ctx.time.timeScale (each frame advances
// at most gap/12 s, capped at 1 s): particles, fire and the fireball all age in sim time. Uses the same render-slot
// semaphore as tools/shot.mjs. Prints effects stats (incl. crash warm-up ms) at the end.
import { execFileSync } from 'node:child_process';
import { openSync, closeSync, mkdirSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes('--' + n);
const [W, H] = flag('size', '960x540').split('x').map(Number);
const times = flag('times', '0.2,1,3,10,40').split(',').map(Number);
const prefix = resolve(root, flag('prefix', 'shots/crash'));
const html = resolve(root, 'dist/index.html');
if (!has('no-build')) execFileSync('node', ['tools/build.mjs', '--out', html], { cwd: root, stdio: 'inherit' });

const SLOTS = 2, LOCKDIR = '/tmp/flightsim-shot-locks';
mkdirSync(LOCKDIR, { recursive: true });
async function acquire() {
  for (const start = Date.now(); ;) {
    for (let i = 0; i < SLOTS; i++) {
      const f = `${LOCKDIR}/slot${i}`;
      try { const fd = openSync(f, 'wx'); writeFileSync(fd, String(process.pid)); closeSync(fd); return f; }
      catch { try { if (Date.now() - statSync(f).mtimeMs > 6 * 60 * 1000) unlinkSync(f); } catch {} }
    }
    if (Date.now() - start > 30 * 60 * 1000) throw new Error('no render slot in 30 min');
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1500));
  }
}
const slot = await acquire();
// keep the lock fresh (stale detection is by mtime) while a long sequence renders
const touch = setInterval(() => { try { writeFileSync(slot, String(process.pid)); } catch {} }, 60000);
const release = () => { clearInterval(touch); try { unlinkSync(slot); } catch {} };
process.on('exit', release); process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143));

let failed = false;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync'] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + (e.stack || e.message)));
  const url = pathToFileURL(html).href + '?test=1&autostart=1&aircraft=f16&hud=0&crashat=1&' + flag('params', '');
  await page.goto(url, { waitUntil: 'commit', timeout: 600000 });
  await page.waitForFunction(() => window.__sim && (window.__sim.ready || window.__sim.error), null, { timeout: 600000 });
  const bootErr = await page.evaluate(() => window.__sim.error || null);
  if (bootErr) throw new Error('boot: ' + bootErr);
  // frames until the test crash fired (crashat=1 → the first frame), then note its sim time
  const t0 = await page.evaluate(() => { const s = window.__sim; for (let i = 0; i < 40 && !window.__crashfx?.last; i++) s.step(1, 0.1); return s.ctx.time.now - 0.1; });
  const wall = Date.now();
  for (const T of times) {
    // advance to t0 + T in steps of at most max(0.05, gap/12) s (≤ 1 s)
    for (;;) {
      const done = await page.evaluate(([t0, T]) => {
        const ctx = window.__sim.ctx;
        for (let k = 0; k < 4; k++) {
          const rem = t0 + T - ctx.time.now;
          if (rem < 1e-4) { ctx.time.timeScale = 1; return true; }
          const step = Math.min(rem, Math.min(1, Math.max(0.05, T / 12)));
          ctx.time.timeScale = step / 0.1;
          window.__sim.step(1, 0.1);
        }
        return false;
      }, [t0, T]);
      if (done) break;
    }
    const out = `${prefix}_${String(T).replace('.', 'p')}s.png`;
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out, timeout: 180000 });
    console.log('screenshot', out, `(${((Date.now() - wall) / 1000).toFixed(0)} s)`);
  }
  const st = await page.evaluate(() => JSON.stringify(window.__sim.ctx.effects?.stats?.()?.crash || null));
  console.log('crash stats', st);
  if (errors.length) { failed = true; console.log('CONSOLE ERRORS:'); for (const e of errors.slice(0, 20)) console.log('  ' + e.slice(0, 800)); }
  else console.log('no console errors');
} catch (e) { failed = true; console.log('crashseq failure:', e.message); }
finally { await browser.close(); release(); }
process.exit(failed ? 1 : 0);
