// Procedural tree skeletons (boot time, pure JS): space colonisation inside the species' crown envelope, pipe-model
// branch radii, and the per-tree light bake (leaf-area voxel grid -> per-vertex sky / sun visibility as L1 spherical
// harmonics). Units are tree heights (ground y = 0, top y ~ 1). Used by treegen.js.
//
// Space colonisation (Runions et al. 2007): attraction points fill the crown; every iteration each point pulls the
// nearest branch node within the influence radius, each pulled node grows one segment toward the mean pull, points
// closer than the kill distance to a node are consumed. Branches therefore fill the crown the way real limbs compete
// for light: forks where space opens up, bare interior, clumped twigs at the periphery with gaps between them.
import { crownRadius } from './species.js';

/**
 * Grow a skeleton. sp = species row, r = rng (0..1), o = options:
 *   attract  number of attraction points     shell  radial exponent (smaller = points nearer the envelope surface)
 *   seg      segment length                   infl / kill  influence / kill radius
 *   trunkUp  trunk leader height (fraction of the crown height above the crown base) before the crown is colonised
 *   trop     vertical tropism added to each growth direction (+ up, - spreading / drooping)
 *   iters    maximum iterations               lean   trunk lean
 * Returns { nodes: [{ x, y, z, parent, kids: [], r, depth }], tips: [node indices] }.
 */
export function growSkeleton(sp, r, o) {
  const base = sp.base, ch = 1 - sp.base;
  const env = (y) => crownRadius(sp, (y - base) / ch);
  // attraction points: inside the envelope, denser toward its surface; a few leave holes (missing sectors)
  const A = [];
  const holes = [];
  for (let i = 0; i < (o.holes ?? 3); i++) {
    const t = 0.15 + 0.7 * r();
    holes.push([Math.cos(r() * 6.283) * env(base + ch * t) * 0.8, base + ch * t, 0, 0.12 + 0.1 * r()]);
    const a = r() * 6.283; holes[i][0] = Math.cos(a) * env(holes[i][1]) * 0.85; holes[i][2] = Math.sin(a) * env(holes[i][1]) * 0.85;
  }
  let guard = 0;
  while (A.length < o.attract && guard++ < o.attract * 40) {
    const t = Math.pow(r(), o.tPow ?? 0.9);
    const y = base + ch * (o.yLo ?? 0.04) + ch * (1 - (o.yLo ?? 0.04)) * t;
    const R = env(y);
    if (R < 1e-3) continue;
    const a = r() * Math.PI * 2, rr = R * Math.pow(r(), o.shell ?? 0.45);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    let inHole = false;
    for (const h of holes) if ((x - h[0]) ** 2 + (y - h[1]) ** 2 + (z - h[2]) ** 2 < h[3] * h[3]) inHole = true;
    if (inHole) continue;
    A.push(x, y, z);
  }
  const nA = A.length / 3;
  const alive = new Uint8Array(nA).fill(1);
  const live = Array.from({ length: nA }, (_, i) => i);
  const nodes = [];
  const add = (x, y, z, parent) => {
    const n = { x, y, z, parent, kids: [], r: 0, depth: parent >= 0 ? nodes[parent].depth + 1 : 0 };
    if (parent >= 0) nodes[parent].kids.push(nodes.length);
    nodes.push(n);
    return nodes.length - 1;
  };
  // trunk leader up into the crown (slight lean and wobble)
  const lean = [(r() - 0.5) * (o.lean ?? 0.05), (r() - 0.5) * (o.lean ?? 0.05)];
  const topY = base + ch * (o.trunkUp ?? 0.3);
  const nT = Math.max(3, Math.ceil(topY / o.seg));
  let prev = add(0, 0, 0, -1);
  for (let i = 1; i <= nT; i++) {
    const t = i / nT;
    prev = add(lean[0] * t * t + (r() - 0.5) * 0.004, topY * t, lean[1] * t * t + (r() - 0.5) * 0.004, prev);
  }
  // incremental nearest-node search: every attraction point keeps its nearest node; only nodes added in an iteration
  // are tested, against the points in the neighbouring cells of a point grid (cell = influence radius)
  const cs = o.infl, grid = new Map();
  const ck = (gx, gy, gz) => ((gx + 512) * 1024 + (gy + 512)) * 1024 + (gz + 512);
  for (let a = 0; a < nA; a++) {
    const k = ck(Math.floor(A[a * 3] / cs), Math.floor(A[a * 3 + 1] / cs), Math.floor(A[a * 3 + 2] / cs));
    let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(a);
  }
  const kill2 = o.kill * o.kill, infl2 = o.infl * o.infl;
  const best = new Int32Array(nA).fill(-1), bestD = new Float64Array(nA).fill(infl2);
  const touch = (i) => {
    const n = nodes[i], gx = Math.floor(n.x / cs), gy = Math.floor(n.y / cs), gz = Math.floor(n.z / cs);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const c = grid.get(ck(gx + dx, gy + dy, gz + dz));
      if (!c) continue;
      for (let q = 0; q < c.length; q++) {
        const a = c[q];
        if (!alive[a]) continue;
        const d = (n.x - A[a * 3]) ** 2 + (n.y - A[a * 3 + 1]) ** 2 + (n.z - A[a * 3 + 2]) ** 2;
        if (d < bestD[a]) { bestD[a] = d; best[a] = i; }
      }
    }
  };
  for (let i = 0; i < nodes.length; i++) touch(i);
  const pull = new Map();
  for (let it = 0; it < (o.iters ?? 90); it++) {
    pull.clear();
    let any = false;
    if ((it & 7) === 7) { let w = 0; for (let q = 0; q < live.length; q++) if (alive[live[q]]) live[w++] = live[q]; live.length = w; }
    for (let li = 0; li < live.length; li++) {
      const a = live[li];
      if (!alive[a] || best[a] < 0) continue;
      if (bestD[a] < kill2) { alive[a] = 0; continue; }
      any = true;
      const i = best[a], n = nodes[i], l = Math.sqrt(bestD[a]);
      let p = pull.get(i); if (!p) pull.set(i, p = [0, 0, 0, 0]);
      p[0] += (A[a * 3] - n.x) / l; p[1] += (A[a * 3 + 1] - n.y) / l; p[2] += (A[a * 3 + 2] - n.z) / l; p[3]++;
    }
    if (!any) break;
    const added = [];
    for (const [i, p] of pull) {
      const n = nodes[i];
      let dx = p[0] / p[3], dy = p[1] / p[3] + (o.trop ?? 0), dz = p[2] / p[3];
      // keep some of the parent direction (branches do not kink back)
      if (n.parent >= 0) { const q = nodes[n.parent]; const ql = Math.hypot(n.x - q.x, n.y - q.y, n.z - q.z) || 1; dx += (n.x - q.x) / ql * 0.55; dy += (n.y - q.y) / ql * 0.55; dz += (n.z - q.z) / ql * 0.55; }
      const l = Math.hypot(dx, dy, dz);
      if (l < 1e-4) continue;
      added.push(add(n.x + dx / l * o.seg, Math.max(n.y + dy / l * o.seg, 0.02), n.z + dz / l * o.seg, i));
    }
    if (!added.length) break;
    for (const j of added) touch(j);
  }
  // pipe model radii from the tips down: r_parent^e = sum r_child^e
  const e = o.pipe ?? 2.4;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (!n.kids.length) n.r = 1;
    else { let s = 0; for (const k of n.kids) s += Math.pow(nodes[k].r, e); n.r = Math.pow(s, 1 / e) * 1.02; }
  }
  const k = o.trunkR / nodes[0].r;
  for (const n of nodes) n.r *= k;
  nodes[0].r *= 1.25;      // root flare
  const tips = [];
  nodes.forEach((n, i) => { if (!n.kids.length) tips.push(i); });
  return { nodes, tips };
}

/**
 * Split a skeleton into branches (chains following the thickest child). Returns [{ idx: [node indices], order }]
 * sorted thickest first; each chain starts at its parent node so tubes join.
 */
export function chains(nodes) {
  const out = [];
  const walk = (start, order) => {
    const idx = nodes[start].parent >= 0 ? [nodes[start].parent, start] : [start];
    let i = start;
    for (;;) {
      const n = nodes[i];
      if (!n.kids.length) break;
      let main = n.kids[0];
      for (const kk of n.kids) if (nodes[kk].r > nodes[main].r) main = kk;
      for (const kk of n.kids) if (kk !== main) walk(kk, order + 1);
      idx.push(main);
      i = main;
    }
    out.push({ idx, order, r0: nodes[idx[Math.min(1, idx.length - 1)]].r });
  };
  walk(0, 0);
  out.sort((a, b) => b.r0 - a.r0);
  return out;
}

// ---- light bake --------------------------------------------------------------------------------------------------
const FIB = (() => {          // 32 directions on the sphere (Fibonacci)
  const d = [], n = 32;
  for (let i = 0; i < n; i++) {
    const y = 1 - 2 * (i + 0.5) / n, rr = Math.sqrt(1 - y * y), a = i * 2.39996323;
    d.push([Math.cos(a) * rr, y, Math.sin(a) * rr]);
  }
  return d;
})();

/**
 * Leaf-area voxel grid of a tree. cards: [{ c: [x,y,z], area }] (area in tree-height units^2, one side).
 * Returns { lad (leaf area density), N, lo, size, sample(x, y, z) }.
 */
export function leafGrid(cards, bounds, N = 22) {
  const [x0, y0, z0, x1, y1, z1] = bounds;
  const size = Math.max(x1 - x0, y1 - y0, z1 - z0) / N;
  const lad = new Float32Array(N * N * N);
  const vol = size * size * size;
  for (const cd of cards) {
    // trilinear splat
    const fx = (cd.c[0] - x0) / size - 0.5, fy = (cd.c[1] - y0) / size - 0.5, fz = (cd.c[2] - z0) / size - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const tx = fx - ix, ty = fy - iy, tz = fz - iz;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
      const X = ix + a, Y = iy + b, Z = iz + c;
      if (X < 0 || Y < 0 || Z < 0 || X >= N || Y >= N || Z >= N) continue;
      const w = (a ? tx : 1 - tx) * (b ? ty : 1 - ty) * (c ? tz : 1 - tz);
      lad[(Z * N + Y) * N + X] += cd.area * w / vol;
    }
  }
  return { lad, N, lo: [x0, y0, z0], size };
}

/**
 * Visibility from point p through this tree's leaf grid, as L1 SH over the sphere: V(w) ~ c0 + c1 . w (the ground
 * is not an occluder here: the lighting adds it). G = 0.5 (spherical leaf angle distribution), the leaf
 * cards' clumping (texture coverage ~ 55 %) is folded into `fill`. Returns [c0, c1x, c1y, c1z].
 */
export function bakeVisibility(g, p, n, fill = 0.55, skip = 0.7) {
  const { lad, N, lo, size } = g;
  const step = size * 0.7;
  let s0 = 0, sx = 0, sy = 0, sz = 0;
  for (const d of FIB) {
    let tau = 0;
    // start a little off the point (its own card)
    let x = p[0] + d[0] * size * skip, y = p[1] + d[1] * size * skip, z = p[2] + d[2] * size * skip;
    for (let k = 0; k < 3 * N; k++) {
      const X = Math.floor((x - lo[0]) / size), Y = Math.floor((y - lo[1]) / size), Z = Math.floor((z - lo[2]) / size);
      if (X < 0 || Y < 0 || Z < 0 || X >= N || Y >= N || Z >= N) break;
      tau += lad[(Z * N + Y) * N + X] * 0.5 * fill * step;
      if (tau > 6) break;
      x += d[0] * step; y += d[1] * step; z += d[2] * step;
    }
    const v = Math.exp(-tau);
    s0 += v; sx += v * d[0]; sy += v * d[1]; sz += v * d[2];
  }
  const m = FIB.length;
  // projection onto 1 and w (|w|^2 averages 1/3 over the sphere)
  return [s0 / m, 3 * sx / m, 3 * sy / m, 3 * sz / m];
}
