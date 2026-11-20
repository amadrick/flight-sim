// Node driver: builds the combat-audio harness, runs it in headless Chromium and prints the measurement table.
//   node src/combat/audio/run-harness.mjs [only-substring]
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const only = process.argv[2] || '';
execFileSync('node', ['tools/build.mjs', '--dev', '--entry', 'src/combat/audio/harness.js', '--out', 'dist/cbt-audio.html'], { cwd: root, stdio: 'inherit' });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const throttle = +(process.env.THROTTLE || 1);
if (throttle > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); console.log('CPU throttle x' + throttle); }
const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.goto(pathToFileURL(resolve(root, 'dist/cbt-audio.html')).href + (only ? '?only=' + encodeURIComponent(only) : ''));
await page.waitForFunction(() => window.__sim && window.__sim.ready, null, { timeout: 1800000, polling: 1000 });
const out = await page.evaluate(() => ({ err: window.__sim.error, r: window.__sim.results }));
await browser.close();
if (out.err) { console.log('HARNESS ERROR', out.err); process.exit(1); }
const pad = (s, n) => String(s).padEnd(n);
console.log('\n' + pad('scenario', 56) + pad('peak', 8) + pad('rms dB', 9) + pad('dc', 10) + 'extra');
for (const r of out.r.rows) { const { name, peak, rms_db, dc, nan, ...rest } = r; console.log(pad(name, 56) + pad(peak ?? '', 8) + pad(rms_db ?? '', 9) + pad(dc ?? '', 10) + (Object.keys(rest).length ? JSON.stringify(rest) : '')); }
for (const k of ['music', 'sfx']) for (const [n, v] of Object.entries(out.r[k] || {})) console.log(`\n${k}.${n}: ${JSON.stringify(v)}`);
console.log('\nchecks:'); let bad = 0;
for (const c of out.r.checks) { if (!c.ok) bad++; console.log((c.ok ? '  PASS ' : '  FAIL ') + pad(c.name, 80) + c.detail); }
if (errors.length) { console.log('console errors:', errors); bad++; }
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');
process.exit(bad ? 1 : 0);
