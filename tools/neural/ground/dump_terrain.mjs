// Dump patches of the simulator's own terrain for the offline ecosystem simulation, plus — for training samples
// inside every patch — the raw per-pixel terrain features exactly as the GPU reads them from the height clipmap
// (same band-limited height function per level, same stencils as src/terrain/clipmap.js, bilinear filtering).
//
//   node tools/neural/ground/dump_terrain.mjs [--out tools/neural/ground/data] [--from 0] [--to 999]
//
// Per patch p it writes
//   patch_<p>.f32   3 x N x N float32: height (level spacing CELL, i.e. what the 16 m clipmap level holds), aridity,
//                   special surface (> 0 river, < 0 playa)
//   samp_<p>.f32    rows of ROW float32: [i, j, level, rawA(14), rawB(14)]  (rawA at the sample's own level, rawB at
//                   the next coarser level: the GPU cross-fades the two inside the LOD morph band)
//   patches.json    the patch list and the layout constants
// raw = [h, ex, ez, curv, conc, Bex, Bez, Bcurv, Bconc, hC, specC, hE, arid, spec]   (see features.py / ground-cover.js)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const outDir = resolve(flag('out', resolve(here, 'data')));
mkdirSync(outDir, { recursive: true });

// height.gen.js does not export the generator's aridity / special outputs per LOD: load a private copy that does.
const src = readFileSync(resolve(root, 'src/terrain/height.gen.js'), 'utf8')
  + '\nexport function sampleLod(x, z, lod, out) { gLod = lod; out.h = terrain(x, z); out.arid = gArid; out.spec = gSpec; gLod = 0; return out; }\n';
const tmp = resolve(outDir, '_height_private.mjs');
writeFileSync(tmp, src);
const { sampleLod } = await import(pathToFileURL(tmp).href);

export const CELL = 16;          // simulation cell = the "ecological" clipmap level, metres
export const N = 512;            // cells per patch side (8.2 km)
export const MARGIN = 56;        // samples keep this far from the patch edge (simulation boundary effects)
export const LEVELS = 6;         // sample levels: spacing CELL * 2^j, j = 0..5 (16 m .. 512 m)
export const SMAX = 2048;        // context levels are clamped to this spacing (exists at every quality setting)
export const RAW = 14, ROW = 3 + 2 * RAW;

// ---- GPU-equivalent clipmap node values (memoised per spacing) ---------------------------------------------
const o = { h: 0, arid: 0, spec: 0 };
const caches = new Map();
function cacheFor(s) { let c = caches.get(s); if (!c) { c = { H: new Map(), D: new Map() }; caches.set(s, c); } return c; }
const key = (i, j) => (i + 40000) * 100000 + (j + 40000);
function nodeH(s, i, j) {            // [h, arid, spec] at node (i, j) of the level with spacing s
  const c = cacheFor(s), k = key(i, j);
  let v = c.H.get(k);
  if (!v) { sampleLod(i * s, j * s, s, o); v = [o.h, o.arid, o.spec]; c.H.set(k, v); }
  return v;
}
const Hh = (s, i, j) => nodeH(s, i, j)[0];
function nodeD(s, i, j) {            // [ex, ez, curv, conc] exactly as the derivative pass of clipmap.js
  const c = cacheFor(s), k = key(i, j);
  let v = c.D.get(k);
  if (!v) {
    const hc = Hh(s, i, j), hl = Hh(s, i - 1, j), hr = Hh(s, i + 1, j), hd = Hh(s, i, j - 1), hu = Hh(s, i, j + 1);
    let nx = hl - hr, ny = 2 * s, nz = hd - hu;
    const l = Math.hypot(nx, ny, nz); nx /= l; nz /= l;
    const curv = (hl + hr + hd + hu - 4 * hc) / s;
    const ring = (Hh(s, i + 4, j) + Hh(s, i - 4, j) + Hh(s, i, j + 4) + Hh(s, i, j - 4)
      + Hh(s, i + 3, j + 3) + Hh(s, i - 3, j + 3) + Hh(s, i + 3, j - 3) + Hh(s, i - 3, j - 3)) * 0.125;
    const conc = (ring - hc) / (4 * s);
    const q = (x, k2) => Math.min(1, Math.max(0, x * k2 + 0.5));      // the RGBA8 range of the D texture
    v = [Math.sign(nx) * Math.sqrt(Math.abs(nx)), Math.sign(nz) * Math.sqrt(Math.abs(nz)),
      (q(curv, 1.25) - 0.5) / 1.25, (q(conc, 1.5) - 0.5) / 1.5];
    c.D.set(k, v);
  }
  return v;
}
function bilin(fn, s, x, z, n, out, at) {
  const fx = x / s, fz = z / s, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const a = fn(s, i, j), b = u > 0 ? fn(s, i + 1, j) : a, c = v > 0 ? fn(s, i, j + 1) : a, d = (u > 0 && v > 0) ? fn(s, i + 1, j + 1) : (u > 0 ? b : c);
  for (let k = 0; k < n; k++) out[at + k] = (a[k] * (1 - u) + b[k] * u) * (1 - v) + (c[k] * (1 - u) + d[k] * u) * v;
}
const t4 = new Float64Array(4), t3 = new Float64Array(3);
/** raw feature set of the level with texel spacing s at world (x, z) -> out[at .. at+13] */
export function rawFeatures(s, x, z, out, at) {
  bilin(nodeH, s, x, z, 3, t3, 0);
  out[at] = t3[0]; out[at + 12] = t3[1]; out[at + 13] = t3[2];
  bilin(nodeD, s, x, z, 4, t4, 0);
  out[at + 1] = t4[0]; out[at + 2] = t4[1]; out[at + 3] = t4[2]; out[at + 4] = t4[3];
  bilin(nodeD, Math.min(4 * s, SMAX), x, z, 4, t4, 0);
  out[at + 5] = t4[0]; out[at + 6] = t4[1]; out[at + 7] = t4[2]; out[at + 8] = t4[3];
  bilin(nodeH, Math.min(8 * s, SMAX), x, z, 3, t3, 0);
  out[at + 9] = t3[0]; out[at + 10] = t3[2];
  bilin(nodeH, Math.min(32 * s, SMAX), x, z, 3, t3, 0);
  out[at + 11] = t3[0];
}

// ---- patch list: hand-picked places plus a balanced random draw over the land --------------------------------
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function patchStats(x0, z0) {
  let land = 0, hs = 0, hmin = 1e9, hmax = -1e9, ar = 0;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    sampleLod(x0 + (i + 0.5) * N * CELL / 8, z0 + (j + 0.5) * N * CELL / 8, 64, o);
    if (o.h > 1) { land++; hs += o.h; ar += o.arid; hmin = Math.min(hmin, o.h); hmax = Math.max(hmax, o.h); }
  }
  return { land: land / 64, mean: land ? hs / land : 0, relief: land ? hmax - hmin : 0, arid: land ? ar / land : 0 };
}
const snap = (v) => Math.round(v / 2048) * 2048;
function buildPatchList() {
  const list = [];
  const add = (name, cxKm, czKm) => { const x0 = snap(cxKm * 1000 - N * CELL / 2), z0 = snap(czKm * 1000 - N * CELL / 2); list.push({ name, x0, z0, ...patchStats(x0, z0) }); };
  add('pinecrest', -20, -95); add('pinecrest-n', -30, -110); add('pinecrest-e', -8, -92);
  add('haven-n', 6, -10); add('haven-river', 13, -24); add('haven-hills', 20, -50);
  add('redrock', 148, -24); add('redrock-range', 125, -45); add('mesa', 190, -88); add('mesa-2', 176, -70);
  add('baywater', -266, -66); add('coral-key', -85, 85); add('mount-ember', -150, 128); add('plateau', -40, -190);
  const r = rng(20261119);
  const want = { alpine: 9, high: 4, hills: 6, plain: 4, desert: 7, steppe: 4 }, got = {};
  for (let tries = 0; tries < 4000 && Object.keys(want).some((k) => (got[k] || 0) < want[k]); tries++) {
    const cx = -290 + 550 * r(), cz = -235 + 250 * r();
    const x0 = snap(cx * 1000 - N * CELL / 2), z0 = snap(cz * 1000 - N * CELL / 2);
    const st = patchStats(x0, z0);
    if (st.land < 0.75) continue;
    const kind = st.arid > 0.6 ? 'desert' : st.arid > 0.25 ? 'steppe' : st.mean > 2400 ? 'high' : st.mean > 1200 ? 'alpine' : st.relief > 250 ? 'hills' : 'plain';
    if ((got[kind] || 0) >= want[kind]) continue;
    if (list.some((p) => Math.abs(p.x0 - x0) < N * CELL && Math.abs(p.z0 - z0) < N * CELL)) continue;
    got[kind] = (got[kind] || 0) + 1;
    list.push({ name: `${kind}-${got[kind]}`, x0, z0, ...st });
  }
  return list;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const patches = buildPatchList();
  writeFileSync(resolve(outDir, 'patches.json'), JSON.stringify({ CELL, N, MARGIN, LEVELS, SMAX, RAW, ROW, patches }, null, 1));
  const from = +flag('from', 0), to = Math.min(+flag('to', patches.length - 1), patches.length - 1);
  const perLevel = [5200, 2600, 1300, 650, 400, 400];
  for (let p = from; p <= to; p++) {
    const P = patches[p], t0 = performance.now();
    const fP = resolve(outDir, `patch_${p}.f32`), fS = resolve(outDir, `samp_${p}.f32`);
    if (existsSync(fP) && existsSync(fS) && !args.includes('--force')) { console.log(`patch ${p} ${P.name}: exists`); continue; }
    caches.clear();
    const grid = new Float32Array(3 * N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const v = nodeH(CELL, P.x0 / CELL + i, P.z0 / CELL + j), k = j * N + i;
      grid[k] = v[0]; grid[N * N + k] = v[1]; grid[2 * N * N + k] = v[2];
    }
    const r = rng(1000 + p), rows = [];
    for (let lv = 0; lv < LEVELS; lv++) {
      const step = 1 << lv, s = CELL * step;
      const lo = Math.ceil(MARGIN / step), hi = Math.floor((N - MARGIN) / step), span = hi - lo + 1;
      const total = span * span, take = Math.min(perLevel[lv], total);
      const pick = new Set();
      if (take >= total) for (let q = 0; q < total; q++) pick.add(q);
      else while (pick.size < take) pick.add(Math.floor(r() * total));
      for (const q of pick) {
        const i = (lo + (q % span)) * step, j = (lo + Math.floor(q / span)) * step;
        if (grid[j * N + i] < 0.3) continue;                          // sea floor: not land cover
        const row = new Float32Array(ROW);
        row[0] = i; row[1] = j; row[2] = lv;
        const x = P.x0 + i * CELL, z = P.z0 + j * CELL;
        rawFeatures(s, x, z, row, 3);
        rawFeatures(2 * s, x, z, row, 3 + RAW);
        rows.push(row);
      }
    }
    const samp = new Float32Array(rows.length * ROW);
    rows.forEach((row, q) => samp.set(row, q * ROW));
    writeFileSync(fP, Buffer.from(grid.buffer));
    writeFileSync(fS, Buffer.from(samp.buffer));
    console.log(`patch ${p} ${P.name} (${P.x0 / 1000}, ${P.z0 / 1000}) km  land ${P.land.toFixed(2)} mean ${P.mean.toFixed(0)} m relief ${P.relief.toFixed(0)} arid ${P.arid.toFixed(2)}: ${rows.length} samples, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
}
