// Phone / tablet / desktop screenshots of every screen, for checking the touch layout (software GL = SLOW).
//
//   node tools/mobile-shots.mjs --prefix mob-after- [--devices iphone14,pixel7,small,ipad,desktop]
//        [--screens chase,cockpit,help,pause,settings,controls,main,main-end] [--aircraft f16] [--no-build]
//        [--orient both|portrait|landscape] [--ui]   (--ui: WebGL-free harness, see src/input/ui-harness.js)
//
// One page boot per device (booting is the slow part); the orientation is switched with setViewportSize on the same
// page. Device emulation: isMobile + hasTouch (so `(pointer: coarse)` matches), CSS viewport from the Playwright device,
// deviceScaleFactor 1 (layout is in CSS px; a 3x backing store would only make software GL slower).
// Shares the machine-wide render semaphore of tools/shot.mjs (/tmp/flightsim-shot-locks, 2 slots).
// Writes shots/<prefix><device>-<orient>-<screen>.png and prints layout problems it can detect by itself
// (elements off-screen, overlapping touch controls, touch targets under 44 px).
import { execFileSync } from 'node:child_process';
import { openSync, closeSync, mkdirSync, unlinkSync, writeFileSync, statSync, utimesSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes('--' + n);
const prefix = flag('prefix', 'mob-');
const ui = has('ui');   // --ui: the WebGL-free harness (src/input/ui-harness.js): real input / HUD / menu, flat backdrop, seconds per shot
const html = resolve(root, flag('html', ui ? 'dist/ui.html' : 'dist/index.html'));
const aircraft = flag('aircraft', 'f16');
const orient = flag('orient', 'both');

// name → [base descriptor, portrait viewport, landscape viewport]
const D = {
  iphone14: [devices['iPhone 14'], devices['iPhone 14'].viewport, devices['iPhone 14 landscape'].viewport],
  pixel7: [devices['Pixel 7'], devices['Pixel 7'].viewport, devices['Pixel 7 landscape'].viewport],
  small: [{ ...devices['Pixel 7'] }, { width: 360, height: 640 }, { width: 640, height: 360 }],
  ipad: [devices['iPad Mini'], devices['iPad Mini'].viewport, devices['iPad Mini landscape'].viewport],
  desktop: [{ viewport: { width: 1280, height: 720 }, isMobile: false, hasTouch: false }, null, { width: 1280, height: 720 }],
};
const devList = flag('devices', 'iphone14,pixel7,small,ipad,desktop').split(',');
const screens = flag('screens', 'chase,cockpit,help,pause,settings,controls,main,main-end').split(',');

if (!has('no-build')) execFileSync('node', ['tools/build.mjs', '--out', html, ...(ui ? ['--entry', 'src/input/ui-harness.js'] : [])], { cwd: root, stdio: 'inherit' });

// ---- shared render semaphore (same files as tools/shot.mjs) ----------------------------------------------
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
    if (Date.now() - start > 30 * 60 * 1000) throw new Error('mobile-shots: no render slot in 30 min');
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
  }
}
const slot = ui ? null : await acquire();
const keepAlive = slot && setInterval(() => { try { const t = new Date(); utimesSync(slot, t, t); } catch {} }, 20000);
const release = () => { if (!slot) return; clearInterval(keepAlive); try { unlinkSync(slot); } catch {} };
process.on('exit', release); process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143));

const browser = ui ? await chromium.launch() : await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync'],
});
let failed = false;
const problems = [];

// in-page layout audit: visible interactive elements, off-screen parts, overlaps between flight-time UI regions
const AUDIT = () => {
  const vw = innerWidth, vh = innerHeight, out = [];
  const vis = (el) => { if (!el.isConnected) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest('[hidden]') && !el.closest('[inert]'); };
  const name = (el) => (el.id ? '#' + el.id : '') + '.' + String(el.className || el.tagName).split(' ')[0] + (el.textContent ? ' "' + el.textContent.trim().slice(0, 18) + '"' : '');
  const tgt = [...document.querySelectorAll('#ui button, #ui [role=button], #ui input, #ui [role=option], #ui [role=radio], #ui [role=switch]')].filter(vis);
  for (const el of tgt) {
    const r = el.getBoundingClientRect();
    // only things on screen count for size; inside a scroller, clipped is fine
    const scroller = el.closest('.menu-scroll, .menu-sheet, .menu-aclist');
    if (!scroller && (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1)) out.push('off-screen: ' + name(el) + ` [${r.left | 0},${r.top | 0},${r.width | 0}x${r.height | 0}]`);
    const min = Math.min(r.width, r.height);
    if (matchMedia('(pointer: coarse)').matches && min < 43.5 && el.type !== 'range' && !el.closest('.menu-aptwrap:not(.open)')) out.push('small target ' + (min | 0) + 'px: ' + name(el));
  }
  // flight-time regions must not overlap one another
  const regs = [...document.querySelectorAll('.inp-region, .inp-pnl, .inp-btn, .menu-corner > button, .hud-plate, .hud-toast.on, .hud-hint')].filter(vis);
  for (let i = 0; i < regs.length; i++) for (let j = i + 1; j < regs.length; j++) {
    const a = regs[i].getBoundingClientRect(), b = regs[j].getBoundingClientRect();
    if (regs[i].contains(regs[j]) || regs[j].contains(regs[i])) continue;
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > 2 && oy > 2) out.push('overlap: ' + name(regs[i]) + ' × ' + name(regs[j]));
  }
  if (document.scrollingElement.scrollHeight > vh + 1 || document.scrollingElement.scrollWidth > vw + 1) out.push('page scrolls');
  return out;
};

async function shoot(page, file, label) {
  await page.screenshot({ path: file, timeout: 240000 });
  const issues = await page.evaluate(AUDIT);
  console.log('shot', file.replace(root + '/', ''), issues.length ? '\n   ' + issues.slice(0, 30).join('\n   ') : '');
  for (const s of issues) problems.push(label + ': ' + s);
}

try {
  for (const dn of devList) {
    const [desc, pv, lv] = D[dn] || [];
    if (!desc) { console.log('unknown device', dn); continue; }
    const orients = [];
    if (pv && orient !== 'landscape') orients.push(['portrait', pv]);
    if (lv && orient !== 'portrait') orients.push([pv ? 'landscape' : 'wide', lv]);
    if (!orients.length) continue;
    const ctxOpts = { ...desc, viewport: orients[0][1], deviceScaleFactor: 1, reducedMotion: 'reduce' };
    delete ctxOpts.defaultBrowserType; delete ctxOpts.screen;
    const bctx = await browser.newContext(ctxOpts);
    const page = await bctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('PAGEERROR ' + (e.stack || e.message)));
    const params = `test=1&autostart=1&aircraft=${aircraft}&start=air&tod=10&weather=fair&cam=chase&quality=low&hint=0`;
    const t0 = Date.now();
    await page.goto(pathToFileURL(html).href + '?' + params, { waitUntil: 'commit', timeout: 600000 });
    await page.waitForFunction(() => window.__sim && (window.__sim.ready || window.__sim.error), null, { timeout: 600000, polling: 500 });
    const bootErr = await page.evaluate(() => window.__sim.error);
    if (bootErr) { console.log(dn, 'BOOT', bootErr); failed = true; await bctx.close(); continue; }
    console.log(`${dn}: booted in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    const step = (n) => page.evaluate((n) => window.__sim.step(n, 1 / 30), n);
    const ev = (fn, a) => page.evaluate(fn, a);
    for (const [on, vp] of orients) {
      await page.setViewportSize(vp);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));   // let 'resize' fire first
      await step(2);
      const f = (s) => resolve(root, 'shots', `${prefix}${dn}-${on}-${s}.png`);
      const L = (s) => `${dn}-${on}-${s}`;
      mkdirSync(resolve(root, 'shots'), { recursive: true });
      // flight screens
      if (screens.includes('chase')) { await step(6); await shoot(page, f('chase'), L('chase')); }
      if (screens.includes('help')) {
        await ev(() => window.__sim.ctx.events.emit('cmd', { name: 'help' })); await step(1);
        await shoot(page, f('help'), L('help'));
        await ev(() => window.__sim.ctx.events.emit('cmd', { name: 'help' })); await step(2);
      }
      if (screens.includes('cockpit')) {
        await ev(() => window.__sim.ctx.cameraRig.setMode('cockpit')); await step(3);
        await shoot(page, f('cockpit'), L('cockpit'));
        await ev(() => window.__sim.ctx.cameraRig.setMode('chase')); await step(1);
      }
      // menus
      for (const v of ['pause', 'settings', 'controls']) {
        if (!screens.includes(v)) continue;
        await ev((v) => window.__sim.ctx.menu.open(v), v); await step(1); await page.waitForTimeout(150);
        await shoot(page, f(v), L(v));
      }
      if (screens.includes('main') || screens.includes('main-end')) {
        await ev(() => window.__sim.ctx.menu.open('main')); await step(4); await page.waitForTimeout(150);
        if (screens.includes('main')) await shoot(page, f('main'), L('main'));
        if (screens.includes('main-end')) {
          await ev(() => { for (const el of document.querySelectorAll('.menu-sheet, .menu-panel-plan > .menu-scroll')) el.scrollTop = 1e6; });
          await step(1); await page.waitForTimeout(150);
          await shoot(page, f('main-end'), L('main-end'));
        }
        // back to flying for the next orientation
        await ev(() => document.getElementById('menu-fly').click()); await step(4);
      } else {
        await ev(() => window.__sim.ctx.menu.close()); await step(1);
      }
    }
    if (errors.length) { failed = true; console.log(dn, 'CONSOLE ERRORS:', errors.slice(0, 10).map(e => e.slice(0, 400)).join('\n  ')); }
    await bctx.close();
  }
} catch (e) { failed = true; console.log('mobile-shots failure:', e.stack || e.message); }
finally { await browser.close(); release(); }
console.log(`\n${problems.length} layout issues detected automatically`);
process.exit(failed ? 1 : 0);
