// Offline generator of the settlement pattern and the road network (-> src/terrain/settle-data.js).
//   node src/terrain/tools/gen-settle.mjs [--map shots/settle-map.ppm]
// Deterministic. Works on a 500 m analysis grid of the real world function (heightAt / sampleTerrain):
//   1. site suitability: flat, not arid, low, close to a river or the coast; never on water, playa or an airfield
//   2. settlements by greedy priority sampling: a city beside each international airport, towns, villages, hamlets
//   3. roads grown as a network (highways between cities / towns / airfields first, then rural roads, then lanes to
//      the hamlets): least-cost paths over the grid (slope and water crossing penalties), every new road stops where it
//      meets the network; paths are simplified and smoothed into polylines.
// The runtime (settle.js) only decodes the result; nothing of this runs at boot.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { heightAt, sampleTerrain } from '../height.gen.js';
import { AIRPORTS, headingVector } from '../../data/airports.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };

const X0 = -330000, X1 = 215000, Z0 = -180000, Z1 = 135000, C = 500;
const NX = Math.round((X1 - X0) / C), NZ = Math.round((Z1 - Z0) / C), N = NX * NZ;
const SUB = 4;

function hash(a, b, s = 0) {
  let h = (Math.imul(a | 0, 0x8da6b343 | 0) + Math.imul(b | 0, 0xd8163841 | 0) + Math.imul(s | 0, 0xcb1ab31f | 0) + 0x9e3779b9) | 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- 1. analysis grid ---------------------------------------------------------------------------------------------
const H = new Float32Array(N), SL = new Float32Array(N), AR = new Float32Array(N), WAT = new Uint8Array(N), PLAYA = new Uint8Array(N), SEA = new Uint8Array(N);
{
  const o = {};
  const t0 = Date.now();
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i;
    let lo = 1e9, hi = -1e9, sum = 0, wat = 0, pl = 0, ar = 0;
    for (let b = 0; b < SUB; b++) for (let a = 0; a < SUB; a++) {
      sampleTerrain(X0 + (i + (a + 0.5) / SUB) * C, Z0 + (j + (b + 0.5) / SUB) * C, o);
      const h = o.height; sum += h; if (h < lo) lo = h; if (h > hi) hi = h;
      if (o.special > 0.3) wat++; if (o.special < -0.3) pl++; ar += o.arid;
    }
    H[k] = sum / (SUB * SUB); SL[k] = (hi - lo) / (C * 0.9); AR[k] = ar / (SUB * SUB);
    WAT[k] = wat > 0 ? 1 : 0; PLAYA[k] = pl > SUB ? 1 : 0; SEA[k] = lo < 1.2 ? 1 : 0;
  }
  console.log(`grid ${NX}x${NZ} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
// distance transforms (cells), chamfer
function distTo(mask) {
  const D = new Float32Array(N).fill(1e9);
  for (let k = 0; k < N; k++) if (mask[k]) D[k] = 0;
  const pass = (i0, i1, di, j0, j1, dj) => {
    for (let j = j0; j !== j1; j += dj) for (let i = i0; i !== i1; i += di) {
      const k = j * NX + i; let d = D[k];
      if (i - di >= 0 && i - di < NX) d = Math.min(d, D[k - di] + 1);
      if (j - dj >= 0 && j - dj < NZ) {
        d = Math.min(d, D[k - dj * NX] + 1);
        if (i - di >= 0 && i - di < NX) d = Math.min(d, D[k - dj * NX - di] + 1.414);
        if (i + di >= 0 && i + di < NX) d = Math.min(d, D[k - dj * NX + di] + 1.414);
      }
      D[k] = d;
    }
  };
  pass(0, NX, 1, 0, NZ, 1); pass(NX - 1, -1, -1, NZ - 1, -1, -1);
  return D;
}
const dSea = distTo(SEA), dRiv = distTo(WAT);
// airfields: distance (m) to the nearest runway centre line (extended 400 m)
const RW = [];
for (const a of AIRPORTS) for (const r of a.runways) { const d = headingVector(r.heading); RW.push({ x: r.center.x, z: r.center.z, dx: d.x, dz: d.z, half: r.length / 2, ap: a }); }
function rwDist(x, z) {
  let best = 1e9;
  for (const r of RW) {
    const qx = x - r.x, qz = z - r.z, al = Math.max(-r.half - 400, Math.min(r.half + 400, qx * r.dx + qz * r.dz));
    best = Math.min(best, Math.hypot(qx - r.dx * al, qz - r.dz * al));
  }
  return best;
}
const KEEP = (x, z) => (z > 60000 ? 520 : 1150);          // keep-out distance from the centre lines (islands: tighter)
const PAD = new Uint8Array(N);
for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const x = X0 + (i + 0.5) * C, z = Z0 + (j + 0.5) * C; if (rwDist(x, z) < KEEP(x, z) + 250) PAD[j * NX + i] = 1; }

const cellOf = (x, z) => Math.floor((z - Z0) / C) * NX + Math.floor((x - X0) / C);
const cx = (k) => X0 + ((k % NX) + 0.5) * C, cz = (k) => Z0 + (Math.floor(k / NX) + 0.5) * C;

// suitability 0..~1.6
const SUIT = new Float32Array(N);
for (let k = 0; k < N; k++) {
  if (SEA[k] || WAT[k] || PLAYA[k] || PAD[k] || H[k] < 4) continue;
  const flat = ss(0.07, 0.012, SL[k]);
  const climate = 1 - 0.88 * ss(0.25, 0.7, AR[k]);
  const alt = ss(2000, 900, H[k]);
  const water = Math.exp(-dRiv[k] * C / 3500) + 0.55 * Math.exp(-dSea[k] * C / 5000);
  SUIT[k] = flat * climate * alt * (0.38 + water) * (0.75 + 0.5 * hash(k % NX, (k / NX) | 0, 7));
}

// ---- 2. settlements -------------------------------------------------------------------------------------------------
/** kind: 0 hamlet, 1 village, 2 town, 3 city */
const towns = [];
const taken = new Uint8Array(N);           // analysis cells covered by a settlement (+ margin)
function footprintOK(x, z, r, maxSlope) {
  for (let dz = -r; dz <= r; dz += Math.min(250, r)) for (let dx = -r; dx <= r; dx += Math.min(250, r)) {
    if (dx * dx + dz * dz > r * r * 1.05) continue;
    const xx = x + dx, zz = z + dz;
    if (xx < X0 + C || xx > X1 - C || zz < Z0 + C || zz > Z1 - C) return false;
    const k = cellOf(xx, zz);
    if (SEA[k] || PAD[k] || PLAYA[k] || SL[k] > maxSlope || taken[k]) return false;
    if (rwDist(xx, zz) < KEEP(xx, zz) + 150) return false;
  }
  return true;
}
function addTown(x, z, r, kind) {
  // lay the street grid along the local grain: parallel to the nearest coast / river where there is one
  const k = cellOf(x, z);
  let rot = hash(Math.round(x), Math.round(z), 3) * Math.PI;
  const gx = (dSea[k + 1] ?? 0) - (dSea[k - 1] ?? 0), gz = (dSea[k + NX] ?? 0) - (dSea[k - NX] ?? 0);
  if (dSea[k] * C < 6000 && Math.hypot(gx, gz) > 0.5) rot = Math.atan2(gz, gx);
  const t = { x: Math.round(x), z: Math.round(z), r: Math.round(r), rot, kind, seed: Math.floor(hash(Math.round(x), Math.round(z), 5) * 65535) };
  towns.push(t);
  const m = Math.ceil((r + 260) / C);
  const ci = Math.floor((x - X0) / C), cj = Math.floor((z - Z0) / C);
  for (let j = cj - m; j <= cj + m; j++) for (let i = ci - m; i <= ci + m; i++) if (i >= 0 && j >= 0 && i < NX && j < NZ) taken[j * NX + i] = 1;
  return t;
}
function bestNear(px, pz, rMin, rMax, r, bonus) {
  let best = -1, bs = -1;
  for (let k = 0; k < N; k++) {
    const x = cx(k), z = cz(k), d = Math.hypot(x - px, z - pz);
    if (d < rMin || d > rMax || SUIT[k] <= 0) continue;
    const s = SUIT[k] + (bonus ? bonus(x, z, k) : 0);
    if (s > bs && footprintOK(x, z, r, 0.05)) { bs = s; best = k; }
  }
  return best;
}
// forced: cities by the international airports, a base town at Redrock, villages at Pinecrest and on Coral Key
const forced = [];
for (const a of AIRPORTS) {
  const P = a.position;
  if (a.kind === 'international') {
    const k = bestNear(P.x, P.z, 7000, 12500, 3000, (x, z, kk) => 1.2 * Math.exp(-dSea[kk] * C / 4000));
    if (k >= 0) forced.push(addTown(cx(k), cz(k), a.id === 'KHVN' ? 3100 : 2700, 3));
  }
}
{
  const a = AIRPORTS.find((q) => q.id === 'KRDR');
  // the base town sits off the playa, on the alluvial apron
  let best = -1, bs = 1e9;
  for (let k = 0; k < N; k++) {
    const x = cx(k), z = cz(k), d = Math.hypot(x - a.position.x, z - a.position.z);
    if (d < 5000 || d > 22000 || SEA[k] || PLAYA[k] || SL[k] > 0.03) continue;
    if (d < bs && footprintOK(x, z, 800, 0.035)) { bs = d; best = k; }
  }
  if (best >= 0) forced.push(addTown(cx(best), cz(best), 800, 2));
}
{
  const a = AIRPORTS.find((q) => q.id === 'KPNC');
  let best = -1, bs = 1e9;
  for (let k = 0; k < N; k++) {
    const x = cx(k), z = cz(k), d = Math.hypot(x - a.position.x, z - a.position.z);
    if (d < 2600 || d > 9000 || SEA[k] || WAT[k] || SL[k] > 0.05) continue;
    if (d < bs && footprintOK(x, z, 420, 0.06)) { bs = d; best = k; }
  }
  if (best >= 0) forced.push(addTown(cx(best), cz(best), 430, 1));
}
{
  const a = AIRPORTS.find((q) => q.id === 'PCRK');
  let best = -1, bs = 1e9;
  for (let k = 0; k < N; k++) {
    const x = cx(k), z = cz(k), d = Math.hypot(x - a.position.x, z - a.position.z);
    if (d < 1200 || d > 4500 || SEA[k] || H[k] < 3 || SL[k] > 0.05) continue;
    if (d < bs && footprintOK(x, z, 280, 0.06)) { bs = d; best = k; }
  }
  if (best >= 0) forced.push(addTown(cx(best), cz(best), 300, 1));
}
// the rest by priority
const order = Array.from({ length: N }, (_, k) => k).filter((k) => SUIT[k] > 0.12).sort((a, b) => SUIT[b] - SUIT[a]);
function sow(kind, rLo, rHi, spacing, minSuit, maxSlope) {
  let n = 0;
  for (const k of order) {
    if (SUIT[k] < minSuit) break;
    const x = cx(k) + (hash(k, 1, 11) - 0.5) * C * 0.8, z = cz(k) + (hash(k, 2, 11) - 0.5) * C * 0.8;
    const r = rLo + (rHi - rLo) * hash(k, 3, 11) ** 1.5;
    // sparser where the land is poorer
    const sp = spacing * (1.6 - 0.75 * Math.min(1, SUIT[k]));
    let ok = true;
    for (const t of towns) {
      const need = t.kind >= kind ? sp : Math.max(sp * 0.45, t.r + r + 700);
      if (Math.abs(t.x - x) < need && Math.abs(t.z - z) < need && Math.hypot(t.x - x, t.z - z) < Math.max(need, t.r + r + 700)) { ok = false; break; }
    }
    if (ok && footprintOK(x, z, r, maxSlope)) { addTown(x, z, r, kind); n++; }
  }
  return n;
}
console.log('towns', sow(2, 850, 1400, 26000, 0.62, 0.035), 'villages', sow(1, 360, 620, 7500, 0.34, 0.045), 'hamlets', sow(0, 130, 230, 3800, 0.2, 0.06));

// ---- 3. roads ---------------------------------------------------------------------------------------------------------
const ROAD = new Int32Array(N).fill(-1);         // road id occupying the cell
const roads = [];                                // { cls, cells: [k...], endRoad }
const heap = { k: new Int32Array(N * 4), f: new Float64Array(N * 4), n: 0 };
function hpush(k, f) { let i = heap.n++; while (i > 0) { const p = (i - 1) >> 1; if (heap.f[p] <= f) break; heap.k[i] = heap.k[p]; heap.f[i] = heap.f[p]; i = p; } heap.k[i] = k; heap.f[i] = f; }
function hpop() {
  const k = heap.k[0]; const lk = heap.k[--heap.n], lf = heap.f[heap.n];
  let i = 0;
  for (;;) { let c = 2 * i + 1; if (c >= heap.n) break; if (c + 1 < heap.n && heap.f[c + 1] < heap.f[c]) c++; if (heap.f[c] >= lf) break; heap.k[i] = heap.k[c]; heap.f[i] = heap.f[c]; i = c; }
  heap.k[i] = lk; heap.f[i] = lf;
  return k;
}
const gS = new Float64Array(N), came = new Int32Array(N), stamp = new Int32Array(N); let stampNo = 0;
const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
/** Least-cost path from cell `from` to the first cell for which isGoal(k) holds. cls: 0 highway (gentler grades). */
function route(from, isGoal, cls, maxCost = 400) {
  stampNo++; heap.n = 0;
  gS[from] = 0; came[from] = -1; stamp[from] = stampNo; hpush(from, 0);
  const gradeK = cls === 0 ? 900 : 420;
  while (heap.n) {
    const k = hpop();
    if (k !== from && isGoal(k)) { const path = []; for (let q = k; q >= 0; q = came[q]) path.push(q); return path.reverse(); }
    const g = gS[k];
    if (g > maxCost) break;
    const i = k % NX, j = (k / NX) | 0;
    for (const [di, dj, dl] of NB) {
      const a = i + di, b = j + dj;
      if (a < 1 || b < 1 || a >= NX - 1 || b >= NZ - 1) continue;
      const q = b * NX + a;
      if (SEA[q] || PAD[q]) continue;
      const grade = Math.abs(H[q] - H[k]) / (dl * C);
      let c = dl * (1 + gradeK * grade * grade + 14 * Math.min(SL[q], 0.3) + (WAT[q] ? 5 : 0) + (PLAYA[q] ? 0.5 : 0));
      if (grade > (cls === 0 ? 0.09 : 0.14)) c += 30 * dl;
      const ng = g + c;
      if (stamp[q] !== stampNo || ng < gS[q]) { stamp[q] = stampNo; gS[q] = ng; came[q] = k; hpush(q, ng); }
    }
  }
  return null;
}
function addRoad(path, cls) {
  if (!path || path.length < 2) return -1;
  const id = roads.length;
  const endRoad = ROAD[path[path.length - 1]];
  roads.push({ cls, cells: path, endRoad, startRoad: ROAD[path[0]] });
  for (const k of path) if (ROAD[k] < 0) ROAD[k] = id;
  return id;
}
// airfield gates: the nearest routable cell abeam the middle of the first runway
const gates = [];
for (const a of AIRPORTS) {
  const r = a.runways[0], d = headingVector(r.heading);
  let best = -1, bs = 1e9;
  for (const side of [-1, 1]) for (let off = 1400; off <= 3200; off += 300) {
    const x = r.center.x - d.z * side * off, z = r.center.z + d.x * side * off;
    if (x < X0 + C || x > X1 - C || z < Z0 + C || z > Z1 - C) continue;
    const k = cellOf(x, z);
    if (!SEA[k] && !PAD[k] && H[k] > 2 && off + (WAT[k] ? 5000 : 0) < bs) { bs = off; best = k; }
  }
  if (best >= 0) gates.push({ k: best, ap: a });
}
// highways: Prim-style growth over cities, towns and the mainland airfield gates
{
  const nodes = [...towns.filter((t) => t.kind >= 2).map((t) => cellOf(t.x, t.z)), ...gates.filter((g) => g.ap.kind !== 'island').map((g) => g.k)];
  const inNet = new Set([nodes[0]]);
  const rest = new Set(nodes.slice(1));
  const netCell = new Uint8Array(N); netCell[nodes[0]] = 1;
  while (rest.size) {
    let bk = -1, bd = 1e18;
    for (const k of rest) for (const q of inNet) { const d = Math.hypot(cx(k) - cx(q), cz(k) - cz(q)); if (d < bd) { bd = d; bk = k; } }
    rest.delete(bk); inNet.add(bk);
    const gate = gates.find((g) => g.k === bk);
    const isGate = !!gate && gate.ap.kind !== 'international';      // the big airports get a highway of their own
    const path = route(bk, (k) => netCell[k] === 1, isGate ? 1 : 0, 3000);
    if (!path) { console.log('no highway route for node', cx(bk), cz(bk)); netCell[bk] = 1; continue; }
    addRoad(path, isGate ? 1 : 0);
    for (const k of path) netCell[k] = 1;
  }
  // island airfields: a road from the gate to the village
  for (const g of gates.filter((q) => q.ap.kind === 'island')) {
    const v = towns.find((t) => Math.hypot(t.x - g.ap.position.x, t.z - g.ap.position.z) < 6000);
    if (v) { const goal = cellOf(v.x, v.z); addRoad(route(g.k, (k) => k === goal, 1, 400), 1); }
  }
}
// rural roads: villages, then hamlets, each to the nearest point of the existing network (nearest first)
for (const kind of [1, 0]) {
  const list = towns.filter((t) => t.kind === kind && ROAD[cellOf(t.x, t.z)] < 0);
  list.sort((a, b) => (b.r - a.r));
  let fail = 0;
  for (const t of list) {
    const from = cellOf(t.x, t.z);
    if (ROAD[from] >= 0) continue;
    const path = route(from, (k) => ROAD[k] >= 0, kind === 1 ? 1 : 2, kind === 1 ? 260 : 120);
    if (path) addRoad(path, kind === 1 ? 1 : 2); else fail++;
  }
  console.log(`kind ${kind}: ${list.length} to connect, ${fail} unreachable`);
}
// a second link for villages whose way round through the network is long (closes loops)
{
  const vs = towns.filter((t) => t.kind === 1);
  let loops = 0;
  for (let a = 0; a < vs.length; a++) {
    const A = vs[a]; let B = null, bd = 9000;
    for (let b = 0; b < vs.length; b++) if (b !== a) { const d = Math.hypot(vs[b].x - A.x, vs[b].z - A.z); if (d < bd && hash(a, b, 21) < 0.5) { bd = d; B = vs[b]; } }
    if (!B) continue;
    const from = cellOf(A.x, A.z), goal = cellOf(B.x, B.z), own = ROAD[from];
    // leave along cells that are not yet road, arrive anywhere on another road that is not the one we started on
    const path = route(from, (k) => k === goal || (ROAD[k] >= 0 && ROAD[k] !== own && Math.hypot(cx(k) - A.x, cz(k) - A.z) > 2500), 1, 200);
    if (path && path.filter((k) => ROAD[k] >= 0).length < path.length * 0.35) { addRoad(path, 1); loops++; }
  }
  console.log('loop roads', loops);
}

// ---- polylines: cut where a road runs along an older one, simplify, smooth -----------------------------------------
function simplify(pts, tol) {
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let bi = -1, bd = tol;
    const ax = pts[a][0], az = pts[a][1], ex = pts[b][0] - ax, ez = pts[b][1] - az, el = Math.hypot(ex, ez) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * ez - (pts[i][1] - az) * ex) / el; if (d > bd) { bd = d; bi = i; } }
    if (bi >= 0) { keep[bi] = 1; st.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function chaikin(pts) {
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (i > 0) out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
    if (i < pts.length - 2) out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
const lines = [];
for (const r of roads) {
  // drop the part that runs over cells owned by older roads (keep the first such cell at each end as the junction)
  const id = roads.indexOf(r);
  let a = 0, b = r.cells.length - 1;
  while (a < b && ROAD[r.cells[a + 1]] !== id && ROAD[r.cells[a + 1]] >= 0) a++;
  while (b > a && ROAD[r.cells[b - 1]] !== id && ROAD[r.cells[b - 1]] >= 0) b--;
  const cells = r.cells.slice(a, b + 1);
  if (cells.length < 2) { lines.push(null); continue; }
  let pts = cells.map((k) => [cx(k), cz(k)]);
  // roads start in the middle of their settlement
  const t0 = towns.find((t) => cellOf(t.x, t.z) === cells[0]); if (t0) pts[0] = [t0.x, t0.z];
  const t1 = towns.find((t) => cellOf(t.x, t.z) === cells[cells.length - 1]); if (t1) pts[pts.length - 1] = [t1.x, t1.z];
  pts = simplify(pts, 260);
  pts = chaikin(chaikin(chaikin(pts)));
  pts = simplify(pts, 2.5);
  lines.push({ cls: r.cls, pts, endCell: cells[cells.length - 1], startCell: cells[0], endsOnRoad: ROAD[cells[cells.length - 1]] !== id ? ROAD[cells[cells.length - 1]] : -1,
               startsOnRoad: ROAD[cells[0]] !== id ? ROAD[cells[0]] : -1 });
}
// junctions: move the loose end onto the road it meets
function snap(p, line) {
  let best = null, bd = 1e18;
  for (let i = 0; i < line.pts.length - 1; i++) {
    const a = line.pts[i], b = line.pts[i + 1], ex = b[0] - a[0], ez = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / (ex * ex + ez * ez || 1)));
    const q = [a[0] + ex * t, a[1] + ez * t], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}
for (const l of lines) {
  if (!l) continue;
  if (l.endsOnRoad >= 0 && lines[l.endsOnRoad]) { const q = snap(l.pts[l.pts.length - 1], lines[l.endsOnRoad]); if (q) l.pts[l.pts.length - 1] = q; }
  if (l.startsOnRoad >= 0 && lines[l.startsOnRoad]) { const q = snap(l.pts[0], lines[l.startsOnRoad]); if (q) l.pts[0] = q; }
}
const out = lines.filter(Boolean);
let nv = 0, km = [0, 0, 0];
for (const l of out) { nv += l.pts.length; for (let i = 0; i < l.pts.length - 1; i++) km[l.cls] += Math.hypot(l.pts[i + 1][0] - l.pts[i][0], l.pts[i + 1][1] - l.pts[i][1]) / 1000; }
console.log(`settlements ${towns.length} (cities ${towns.filter((t) => t.kind === 3).length}, towns ${towns.filter((t) => t.kind === 2).length}, villages ${towns.filter((t) => t.kind === 1).length}, hamlets ${towns.filter((t) => t.kind === 0).length})`);
console.log(`roads ${out.length}, vertices ${nv}, km highway ${km[0].toFixed(0)} rural ${km[1].toFixed(0)} lane ${km[2].toFixed(0)}`);

// ---- write -----------------------------------------------------------------------------------------------------------
const tf = new Float32Array(towns.length * 6);
towns.forEach((t, i) => tf.set([t.x, t.z, t.r, t.rot, t.kind, t.seed], i * 6));
const ri = new Int32Array(out.length * 2 + nv * 2);
{ let p = 0; for (const l of out) { ri[p++] = l.cls; ri[p++] = l.pts.length; for (const q of l.pts) { ri[p++] = Math.round(q[0] * 4); ri[p++] = Math.round(q[1] * 4); } } }
const b64 = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const js = `// GENERATED by src/terrain/tools/gen-settle.mjs - do not edit. Settlements and the road network of the world.
// towns: Float32 x 6 per settlement (x, z, radius m, grid rotation rad, kind 0 hamlet / 1 village / 2 town / 3 city, seed)
// roads: Int32 stream of polylines: class (0 highway, 1 rural road, 2 lane), n, then n x (x, z) in quarter metres
export const SETTLE_DATA = {
  bounds: [${X0}, ${Z0}, ${X1}, ${Z1}],
  nTowns: ${towns.length}, nRoads: ${out.length}, nVerts: ${nv},
  towns: '${b64(tf)}',
  roads: '${b64(ri)}',
};
`;
writeFileSync(resolve(here, '../settle-data.js'), js);
console.log(`wrote settle-data.js (${(js.length / 1024).toFixed(0)} kB)`);

// optional overview map (PPM)
const mapOut = flag('map');
if (mapOut) {
  const img = new Uint8Array(N * 3);
  for (let k = 0; k < N; k++) {
    const s = SUIT[k]; let c = SEA[k] ? [20, 40, 90] : [60 + 120 * AR[k], 90 + 60 * Math.min(1, s), 50];
    if (H[k] > 2200) c = [220, 220, 225]; if (WAT[k]) c = [40, 90, 200]; if (PLAYA[k]) c = [210, 200, 170]; if (PAD[k]) c = [120, 60, 120];
    img.set(c, k * 3);
  }
  const put = (x, z, c) => { const i = Math.floor((x - X0) / C), j = Math.floor((z - Z0) / C); if (i >= 0 && j >= 0 && i < NX && j < NZ) img.set(c, (j * NX + i) * 3); };
  for (const l of out) for (let i = 0; i < l.pts.length - 1; i++) {
    const a = l.pts[i], b = l.pts[i + 1], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 250) + 1;
    for (let s = 0; s <= n; s++) put(a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n, l.cls === 0 ? [255, 230, 60] : l.cls === 1 ? [255, 255, 255] : [190, 190, 190]);
  }
  for (const t of towns) { const m = Math.max(0, Math.round(t.r / C)); for (let j = -m; j <= m; j++) for (let i = -m; i <= m; i++) if (i * i + j * j <= m * m + 1) put(t.x + i * C, t.z + j * C, t.kind === 3 ? [255, 60, 60] : t.kind === 2 ? [255, 120, 40] : t.kind === 1 ? [255, 60, 220] : [0, 0, 0]); }
  writeFileSync(resolve(process.cwd(), mapOut), Buffer.concat([Buffer.from(`P6\n${NX} ${NZ}\n255\n`), Buffer.from(img)]));
  console.log('map', mapOut);
}
