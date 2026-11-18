// Bundles src/main.js (+ everything it imports) into ONE self-contained dist/index.html.
// Usage: node tools/build.mjs [--dev] [--entry src/main.js] [--out dist/index.html]
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const dev = args.includes('--dev');
const entry = resolve(root, flag('entry', 'src/main.js'));
const out = resolve(root, flag('out', 'dist/index.html'));

const t0 = Date.now();
const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  write: false,
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  target: 'es2022',
  loader: { '.glsl': 'text', '.vert': 'text', '.frag': 'text', '.txt': 'text', '.bin': 'binary' },
  define: { __DEV__: String(dev) },
  logLevel: 'warning',
});
let js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const template = readFileSync(resolve(root, 'src/index.template.html'), 'utf8');
const html = template.replace('/*__BUNDLE__*/', () => js);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`built ${out} (${(html.length / 1024).toFixed(0)} KB) in ${Date.now() - t0} ms`);
