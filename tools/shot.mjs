// Headless screenshot + smoke test of the built simulator (software GL = SLOW: keep sizes small).
//
//   node tools/shot.mjs --out shots/a.png --params "aircraft=f16&start=air&tod=10&weather=scattered&cam=chase"
//        [--size 640x360] [--frames 20] [--dt 0.0333] [--eval "JS expression"] [--no-build] [--dev]
//        [--entry src/main.js] [--html dist/index.html] [--timeout 180] [--keys "KeyG,KeyF"] [--wait-ms 0]
//        [--skip 20] [--until "JS expression"] [--pre "JS statement(s)"]
// --skip S fast-forwards S simulated seconds WITHOUT rendering (cheap) before the rendered frames; --until stops the
// fast-forward early when the expression (with `ctx`) turns true; --pre runs JS in the page (with `sim`, `ctx`) after the skip.
//
// It builds, opens dist/index.html with ?test=1&autostart=1&<params>, waits for window.__sim.ready,
// steps the sim deterministically with __sim.step(frames, dt), saves a PNG, prints console errors,
// and prints the JSON of --eval (evaluated in the page; `sim` = window.__sim, `ctx` = sim.ctx).
// Exit code 1 if the page threw or logged console errors.
// A machine-wide semaphore (2 slots) keeps parallel agents from starving the CPU: you may wait in line.
import { execFileSync } from 'node:child_process';
import { openSync, closeSync, mkdirSync, existsSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes('--' + n);
const out = resolve(root, flag('out', 'shots/shot.png'));
const [W, H] = flag('size', '640x360').split('x').map(Number);
const frames = Number(flag('frames', 20));
const dt = Number(flag('dt', 1 / 30));
const html = resolve(root, flag('html', 'dist/index.html'));
const timeout = Number(flag('timeout', 240)) * 1000;

if (!has('no-build')) {
  const b = ['tools/build.mjs', '--out', html];
  if (has('dev')) b.push('--dev');
  if (flag('entry')) b.push('--entry', flag('entry'));
  execFileSync('node', b, { cwd: root, stdio: 'inherit' });
}

// ---- semaphore: N slots as lock files with stale detection -------------------------------
const SLOTS = 2, LOCKDIR = '/tmp/flightsim-shot-locks';
mkdirSync(LOCKDIR, { recursive: true });
async function acquire() {
  const start = Date.now();
  for (;;) {
    for (let i = 0; i < SLOTS; i++) {
      const f = `${LOCKDIR}/slot${i}`;
      try { const fd = openSync(f, 'wx'); writeFileSync(fd, String(process.pid)); closeSync(fd); return f; }
      catch { try { if (Date.now() - statSync(f).mtimeMs > 6 * 60 * 1000) unlinkSync(f); } catch {} }
    }
    if (Date.now() - start > 20 * 60 * 1000) throw new Error('shot.mjs: could not get a render slot in 20 min');
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
  }
}
const slot = await acquire();
const release = () => { try { unlinkSync(slot); } catch {} };
process.on('exit', release); process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143));

let failed = false;
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
         '--disable-gpu-vsync', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); else if (has('verbose')) console.log('[page]', m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + (e.stack || e.message)));
  const params = flag('params', '');
  const url = pathToFileURL(html).href + '?test=1&autostart=1' + (params ? '&' + params : '');
  await page.goto(url, { waitUntil: 'commit', timeout });   // a loaded machine can take over 30 s to reach 'load'
  await page.waitForFunction(() => window.__sim && (window.__sim.ready || window.__sim.error), null, { timeout });
  const bootErr = await page.evaluate(() => window.__sim.error || null);
  if (bootErr) { errors.push('BOOT ' + bootErr); }
  else {
    const keys = flag('keys', '');
    if (keys) for (const k of keys.split(',')) await page.keyboard.press(k);
    const skip = Number(flag('skip', 0));
    if (skip > 0) {
      const until = flag('until', '');
      let left = skip, tsim = 0;
      while (left > 0) {       // in slices, so one call cannot trip protocol timeouts
        const part = Math.min(5, left);
        const r = await page.evaluate(([part, until]) => {
          const sim = window.__sim; let hit = false;
          const fn = until ? (ctx) => { try { hit = !!eval(until); } catch { hit = false; } return hit; } : null;
          const t = sim.skip(part, 1 / 30, fn); return { t, hit };
        }, [part, until]);
        tsim += r.t; left -= part; if (r.hit) break;
      }
      console.log(`fast-forwarded ${tsim.toFixed(1)} s without rendering`);
    }
    const pre = flag('pre', '');
    if (pre) await page.evaluate((code) => { const sim = window.__sim, ctx = sim.ctx; eval(code); }, pre);
    const t0 = Date.now();
    // step in small batches so a slow software-GL frame can't trip protocol timeouts
    for (let done = 0; done < frames;) {
      const n = Math.min(5, frames - done);
      await page.evaluate(([n, dt]) => window.__sim.step(n, dt), [n, dt]);
      done += n;
    }
    const waitMs = Number(flag('wait-ms', 0)); if (waitMs) await page.waitForTimeout(waitMs);
    console.log(`stepped ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s (software GL)`);
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out, timeout: 180000 });
    console.log('screenshot', out);
    const expr = flag('eval');
    if (expr) {
      const v = await page.evaluate((e) => { const sim = window.__sim, ctx = sim.ctx; return JSON.stringify(eval(e), (k, x) => typeof x === 'number' ? +x.toFixed(4) : x); }, expr);
      console.log('eval:', v);
    }
  }
  if (errors.length) { failed = true; console.log('CONSOLE ERRORS (' + errors.length + '):'); for (const e of errors.slice(0, 25)) console.log('  ' + e.slice(0, 1500)); }
  else console.log('no console errors');
} catch (e) { failed = true; console.log('shot.mjs failure:', e.message); }
finally { await browser.close(); release(); }
process.exit(failed ? 1 : 0);
