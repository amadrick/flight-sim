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
  // generic touch devices by size (no name-specific code in the sim: these just exercise the layout)
  duo: [{ ...devices['Pixel 7'] }, { width: 540, height: 720 }, { width: 720, height: 540 }],
  duospan: [{ ...devices['Pixel 7'] }, { width: 720, height: 1114 }, { width: 1114, height: 720 },
    { portrait: { orientation: 'horizontal', offset: 540, maskLength: 34 }, landscape: { orientation: 'vertical', offset: 540, maskLength: 34 } }],
  large: [{ ...devices['Pixel 7'] }, { width: 430, height: 932 }, { width: 932, height: 430 }],
  fold: [{ ...devices['Pixel 7'] }, { width: 884, height: 1104 }, { width: 1104, height: 884 }],
  tab: [{ ...devices['Pixel 7'] }, { width: 800, height: 1280 }, { width: 1280, height: 800 }],
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
  const regs = [...document.querySelectorAll('.inp-region:not(.inp-zone), .inp-pnl, .inp-btn, .menu-corner > button, .hud-plate, .hud-toast.on, .hud-hint')].filter(vis);
  for (let i = 0; i < regs.length; i++) for (let j = i + 1; j < regs.length; j++) {
    const a = regs[i].getBoundingClientRect(), b = regs[j].getBoundingClientRect();
    if (regs[i].contains(regs[j]) || regs[j].contains(regs[i])) continue;
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > 2 && oy > 2) out.push('overlap: ' + name(regs[i]) + ' × ' + name(regs[j]));
  }
  // dual-screen: nothing visible may sit on or straddle the hinge
  const segs = window.viewport && window.viewport.segments;
  if (segs && segs.length === 2) {
    const a = segs[0], b = segs[1];
    const hg = Math.abs(a.y - b.y) < 1 ? { l: a.x + a.width, r: b.x, t: 0, b: vh } : { l: 0, r: vw, t: a.y + a.height, b: b.y };
    const els = [...document.querySelectorAll('#ui button, .inp-region, .menu-panel, .menu-flybar, .menu-cap, .menu-sheet, .hud-plate, .hud-toast.on, .menu-crash, .hud-crash, .hud-paused, .inp-tip, .inp-ring')].filter(vis);
    for (const el of els) {
      if (el.closest('.menu-scroll, .menu-aclist') && el.tagName === 'BUTTON') continue;
      if (el.parentElement && el.parentElement.closest('.menu-sheet')) continue;     // clipped by the sheet, which is checked itself
      const r = el.getBoundingClientRect();
      if (r.left < hg.r && r.right > hg.l && r.top < hg.b && r.bottom > hg.t) out.push('on the hinge: ' + name(el) + ` [${r.left | 0},${r.top | 0},${r.width | 0}x${r.height | 0}]`);
    }
  }
  if (document.scrollingElement.scrollHeight > vh + 1 || document.scrollingElement.scrollWidth > vw + 1) out.push('page scrolls');
  return out;
};

let foldCdp = null;     // set while a hinge is emulated: Playwright's own screenshot re-applies its device metrics (drops the fold)
async function shoot(page, file, label) {
  if (foldCdp) writeFileSync(file, Buffer.from((await foldCdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  else await page.screenshot({ path: file, timeout: 240000 });
  const issues = await page.evaluate(AUDIT);
  console.log('shot', file.replace(root + '/', ''), issues.length ? '\n   ' + issues.slice(0, 30).join('\n   ') : '');
  for (const s of issues) problems.push(label + ': ' + s);
}

// ---- --touch-test: multi-touch through CDP (real touch → pointer events), checks ctx.controls --------------------
async function touchTest() {
  const desc = devices['iPhone 14 landscape'];
  const bctx = await browser.newContext({ ...desc, deviceScaleFactor: 1, reducedMotion: 'reduce', defaultBrowserType: undefined, screen: undefined });
  const page = await bctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + (e.stack || e.message)));
  await page.goto(pathToFileURL(html).href + `?test=1&autostart=1&aircraft=${aircraft}&start=air&cam=chase&quality=low&hint=0`, { waitUntil: 'commit', timeout: 600000 });
  await page.waitForFunction(() => window.__sim && (window.__sim.ready || window.__sim.error), null, { timeout: 600000, polling: 500 });
  const cdp = await bctx.newCDPSession(page);
  const step = (n = 2) => page.evaluate((n) => window.__sim.step(n, 1 / 30), n);
  const C = () => page.evaluate(() => { const c = window.__sim.ctx.controls; return { roll: c.roll, pitch: c.pitch, yaw: c.yaw, throttle: c.throttle, brakes: c.brakes }; });
  const pts = new Map();
  const send = async (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...pts.values()].map(p => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 })) });
  const down = async (id, x, y) => { pts.set(id, { id, x, y }); await send('touchStart'); };
  const move = async (id, x, y, n = 4) => { const p = pts.get(id); const x0 = p.x, y0 = p.y; for (let i = 1; i <= n; i++) { p.x = x0 + (x - x0) * i / n; p.y = y0 + (y - y0) * i / n; await send('touchMove'); } };
  // CDP's touch emulation pairs points by list position, so single-finger releases are unreliable: lift all fingers
  const upAll = async () => { pts.clear(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  const results = [];
  const check = (name, ok, info) => { results.push([name, ok]); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + JSON.stringify(info) : '')); if (!ok) failed = true; };
  await step(2);
  const L = await page.evaluate(() => window.__sim.ctx.input.touch.layout);
  check('touch UI shown with a layout', !!L, L && { W: L.W, H: L.H });
  if (L) {
    const cmds = [];
    await page.exposeFunction('__cmdSeen', (n) => cmds.push(n));
    await page.evaluate(() => window.__sim.ctx.events.on('cmd', (e) => window.__cmdSeen(e.name)));
    const c0 = await C();
    const hx = L.home.x, hy = L.home.y, tx = L.thr.x + L.thr.w / 2, ty = L.thr.y + L.thr.h / 2;
    await down(1, hx, hy); await down(2, tx, ty);
    await move(1, hx + L.stickR * 0.8, hy - L.stickR * 0.6); await move(2, tx, ty - 50);
    await step(2);
    const c1 = await C();
    check('stick right → roll right', c1.roll > 0.3, c1);
    check('stick forward → nose down (pitch < 0)', c1.pitch < -0.2, c1);
    check('throttle slid up while the stick is held', c1.throttle > c0.throttle + 0.15, { before: c0.throttle, after: c1.throttle });
    // third finger: hold Brake while stick + throttle are held
    const br = L.btn.brake;
    await down(3, br.x + br.w / 2, br.y + br.h / 2); await step(3);
    const c2 = await C();
    check('brake button held with two other fingers down', c2.brakes > 0.2 && Math.abs(c2.roll) > 0.3 && c2.throttle > c0.throttle + 0.15, c2);
    await upAll(); await step(2);
    const c4 = await C();
    check('release: stick centres, brakes off, throttle stays', Math.abs(c4.roll) < 0.05 && Math.abs(c4.pitch) < 0.05 && c4.brakes < 0.9 && Math.abs(c4.throttle - c1.throttle) < 0.02, c4);
    const gr = L.btn.gear; await down(3, gr.x + gr.w / 2, gr.y + gr.h / 2); await upAll(); await step(1);
    check('gear button emits gearToggle', cmds.includes('gearToggle'), cmds);
    const rd = L.rud; await down(3, rd.x + rd.w / 2, rd.y + rd.h / 2); await move(3, rd.x + rd.w / 2 + rd.w * 0.3, rd.y + rd.h / 2); await step(1);
    const c3 = await C();
    check('rudder slider right → yaw right', c3.yaw > 0.3, c3);
    await upAll(); await step(1);
    const c5 = await C();
    check('rudder springs back to centre', Math.abs(c5.yaw) < 0.05, c5);
    const cm = L.cam; await down(4, cm.x + cm.w / 2, cm.y + cm.h / 2); await upAll(); await step(1);
    check('camera button emits cameraNext', cmds.includes('cameraNext'), cmds);
    // extra-button slot API
    const ex = await page.evaluate(() => {
      const t = window.__sim.ctx.input.touch; window.__fire = 0; window.__fireUp = 0;
      const hFire = t.addButton({ id: 'fire', label: 'Fire', onDown: () => window.__fire++, onUp: () => window.__fireUp++ });
      t.addButton({ id: 'target', label: 'Tgt', onDown: () => {} });
      hFire.setActive(true);
      return { ok: !!hFire, layout: t.layout };
    });
    check('addButton returns a handle and reserves rail slots', ex.ok && ex.layout.extra.length === 2, ex.layout && ex.layout.extra);
    const f = ex.layout.extra[0];
    await down(5, f.x + f.w / 2, f.y + f.h / 2); await step(1); await upAll(); await step(1);
    const fired = await page.evaluate(() => [window.__fire, window.__fireUp]);
    check('extra button onDown / onUp fire', fired[0] === 1 && fired[1] === 1, fired);
    const ov = await page.evaluate(AUDIT);
    check('no overlaps or small targets with two extra buttons', ov.length === 0, ov);
    const sc = await page.evaluate(() => ({ sx: scrollX, sy: scrollY, vv: window.visualViewport ? visualViewport.scale : 1 }));
    check('page did not scroll or zoom', sc.sx === 0 && sc.sy === 0 && sc.vv === 1, sc);
    await page.screenshot({ path: resolve(root, 'shots', `${prefix}touch-test.png`) });
    await page.evaluate(() => window.__sim.ctx.input.touch.removeButton('fire'));
    // hybrid device (touch screen + keyboard): flight keys hide the touch UI, the next touch brings it back
    await page.keyboard.down('ArrowLeft'); await step(2); await page.keyboard.up('ArrowLeft'); await step(2);
    const k = await page.evaluate(() => ({ on: window.__sim.ctx.input.touchEnabled, vis: window.__sim.ctx.input.touch.visible }));
    check('a flight key hides the touch controls', !k.on && !k.vis, k);
    await down(6, L.home.x, L.home.y); await step(2);
    const t2 = await page.evaluate(() => ({ on: window.__sim.ctx.input.touchEnabled, vis: window.__sim.ctx.input.touch.visible }));
    check('the next touch shows them again', t2.on && t2.vis, t2);
    await upAll(); await step(1);
  }
  if (errors.length) { failed = true; console.log('CONSOLE ERRORS:', errors.slice(0, 10).join('\n  ')); }
  console.log(`touch test: ${results.filter(r => r[1]).length}/${results.length} passed`);
  await bctx.close();
}

try {
  if (has('touch-test')) { await touchTest(); devList.length = 0; }
  for (const dn of devList) {
    const [desc, pv, lv, folds] = D[dn] || [];
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
      if (foldCdp) { await foldCdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {}); foldCdp = null; }
      await page.setViewportSize(vp);
      if (folds && folds[on]) {
        // a hinge between two screens: Chromium emulates it as a display feature → viewport segments (CSS + JS)
        const cdp = foldCdp = await bctx.newCDPSession(page);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: true, displayFeature: folds[on] });
      }
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));   // let 'resize' fire first
      await step(folds && folds[on] ? 31 : 2);     // the HUD polls the segments every 30 frames
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
      if (screens.includes('crash')) {
        await ev(() => { const c = window.__sim.ctx, s = c.player.state; s.crashed = true; s.crashReason = 'Impact with terrain at 212 kt'; c.events.emit('crash', { reason: s.crashReason }); });
        for (let i = 0; i < 13; i++) await step(5);      // the crash dialog comes up after 2 s
        await shoot(page, f('crash'), L('crash'));
        await ev(() => document.getElementById('menu-crash-restart')?.click()); await step(3);
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
    foldCdp = null; await bctx.close();
  }
} catch (e) { failed = true; console.log('mobile-shots failure:', e.stack || e.message); }
finally { await browser.close(); release(); }
console.log(`\n${problems.length} layout issues detected automatically`);
process.exit(failed ? 1 : 0);
