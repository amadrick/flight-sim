// Node driver: builds the offline harness, runs it in headless Chromium and prints the measurement table.
//   node src/audio/run-harness.mjs
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
execFileSync('node', ['tools/build.mjs', '--dev', '--entry', 'src/audio/harness.js', '--out', 'dist/audio-harness.html'], { cwd: root, stdio: 'inherit' });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.goto(pathToFileURL(resolve(root, 'dist/audio-harness.html')).href);
await page.waitForFunction(() => window.__sim && window.__sim.ready, null, { timeout: 600000 });
const out = await page.evaluate(() => ({ err: window.__sim.error, r: window.__sim.results }));
await browser.close();
if (out.err) { console.log('HARNESS ERROR', out.err); process.exit(1); }
const pad = (s, n) => String(s).padEnd(n);
console.log('\n' + pad('scenario', 54) + pad('peak', 8) + pad('rms dB', 9) + pad('dc', 10) + pad('nan', 5) + pad('jump', 8) + 'extra');
for (const r of out.r.rows) console.log(pad(r.name, 54) + pad(r.peak, 8) + pad(r.rms_db, 9) + pad(r.dc, 10) + pad(r.nan, 5) + pad(r.jump, 8) + [r.stepRatio !== undefined ? 'step=' + r.stepRatio : '', r.centroid ? 'centroid=' + r.centroid : '', r.bursts !== undefined ? 'bursts=' + r.bursts : ''].join(' '));
for (const k of ['fighter', 'interior', 'airliner', 'doppler', 'crackle', 'cpu']) if (out.r[k]) console.log('\n' + k + ':', JSON.stringify(out.r[k]));
console.log('\nchecks:'); let bad = 0;
for (const c of out.r.checks) { if (!c.ok) bad++; console.log((c.ok ? '  PASS ' : '  FAIL ') + pad(c.name, 78) + c.detail); }
if (errors.length) { console.log('console errors:', errors); bad++; }
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');
process.exit(bad ? 1 : 0);
