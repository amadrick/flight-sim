// Aircraft kit — lofted bodies (fuselages, nacelles, pods, tanks, canopies, ducts) from station tables.
//
// A station is a planar cross-section at body station `z` (sections are always perpendicular to the Z axis):
//   { z, x = 0, y = 0,          centre of the section (y = height of the max-width "side point" reference)
//     w,                        half-width at the side point
//     top, bot,                 height above / depth below the centre           (shorthand: h → top = bot = h, r → w = top = bot = r)
//     kTop = .5523, kBot,       fullness of the upper / lower quadrant: .55 = ellipse, .7 squarish, .9 boxy, .3 pointy/diamond
//                               (number, or [atSide, atCentre] to shape the two ends of the quadrant independently)
//     aTop = 90, aBot = 90,     tangent angle at the side point in degrees: 90 = round side, < 90 = sharp chined edge
//     sideY = 0,                side point height relative to y (move the max-width line up or down)
//     chine: { w, y = 0, t | tu, tl, k = .1, e = 1 }   thin blended shelf (strake / LERX / wing-body blend) out to half-span w at
//                               height y (relative to the station centre): root thickness above (tu) / below (tl), fillet radius k,
//                               shape exponent e (1 = straight wedge, < 1 concave blade, > 1 convex lens)
//     hard: true,               crease across this station (spline restarts)
//     sub: n }                  force n rings between this station and the next
// Between stations every parameter is interpolated with a monotone cubic (PCHIP) spline along the station sequence, so stations
// may fold back (z going forward again) to model intake lips and nozzle rims as one continuous skin.
//
// Ring parameter t ∈ [0, 1): 0 = bottom centre, 0.25 = right side (+X), 0.5 = top centre, 0.75 = left side.
import { Mesh } from './mesh.js';

const K_ELL = 0.5523;
const FIELDS = ['z', 'x', 'y', 'w', 'top', 'bot', 'kTS', 'kTC', 'kBS', 'kBC', 'aTop', 'aBot', 'sideY', 'chW', 'chY', 'chTu', 'chTl', 'chK', 'chE'];
const NF = FIELDS.length;

function normStation(st, prevChine) {
  const w = st.w ?? st.r ?? 0, top = st.top ?? st.h ?? st.r ?? w, bot = st.bot ?? st.h ?? st.r ?? w;
  const kT = st.kTop ?? K_ELL, kB = st.kBot ?? K_ELL, c = st.chine || null, pc = c || prevChine;
  const v = new Float64Array(NF);
  v[0] = st.z; v[1] = st.x ?? 0; v[2] = st.y ?? 0; v[3] = w; v[4] = top; v[5] = bot;
  v[6] = Array.isArray(kT) ? kT[0] : kT; v[7] = Array.isArray(kT) ? kT[1] : kT;
  v[8] = Array.isArray(kB) ? kB[0] : kB; v[9] = Array.isArray(kB) ? kB[1] : kB;
  v[10] = st.aTop ?? 90; v[11] = st.aBot ?? 90; v[12] = st.sideY ?? 0;
  v[13] = c ? c.w : 0; v[14] = pc ? (pc.y ?? 0) : 0;
  v[15] = pc ? (pc.tu ?? pc.t ?? 0.1) : 0.1; v[16] = pc ? (pc.tl ?? pc.t ?? 0.1) : 0.1; v[17] = pc ? (pc.k ?? 0.1) : 0.1; v[18] = pc ? (pc.e ?? 1) : 1;
  return v;
}

// ---- monotone cubic interpolation ------------------------------------------------------------------------------------
function endSlope(h0, h1, d0, d1) {
  let d = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
  if (Math.sign(d) !== Math.sign(d0)) d = 0; else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(d) > 3 * Math.abs(d0)) d = 3 * d0;
  return d;
}
export function pchipSlopes(xs, ys) {
  const n = xs.length, d = new Float64Array(n);
  if (n < 2) return d;
  const h = [], del = [];
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; del[i] = (ys[i + 1] - ys[i]) / h[i]; }
  if (n === 2) { d[0] = d[1] = del[0]; return d; }
  for (let i = 1; i < n - 1; i++) {
    if (del[i - 1] * del[i] <= 0) d[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; d[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i]); }
  }
  d[0] = endSlope(h[0], h[1], del[0], del[1]); d[n - 1] = endSlope(h[n - 2], h[n - 3], del[n - 2], del[n - 3]);
  return d;
}
function hermite(x0, x1, y0, y1, d0, d1, x) {
  const h = x1 - x0, t = (x - x0) / h, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * d0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * d1;
}
/** Monotone cubic interpolant through (xs, ys); returns f(x) (clamped outside). */
export function pchip(xs, ys) {
  const d = pchipSlopes(xs, ys), n = xs.length;
  return (x) => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (xs[i + 1] < x) i++;
    return hermite(xs[i], xs[i + 1], ys[i], ys[i + 1], d[i], d[i + 1], x);
  };
}

// ---- cross-section -----------------------------------------------------------------------------------------------------
const M = 14;                                     // dense samples per quadrant
const _dx = new Float64Array(4 * M + 8), _dy = new Float64Array(4 * M + 8);

function bez(p0, p1, p2, p3, t) { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; }

/** Dense right-half outline of the core section (bottom centre → side → top centre), relative to the section centre. 2M+1 points. */
function coreDense(P, X, Y) {
  const w = P[3], top = P[4], bot = P[5], sy = P[12];
  const aB = P[11] * Math.PI / 180, aT = P[10] * Math.PI / 180;
  const hB = Math.max(0, bot + sy), hT = Math.max(0, top - sy);
  const LB = P[8] * (Math.abs(Math.cos(aB)) * w + Math.sin(aB) * hB), LT = P[6] * (Math.abs(Math.cos(aT)) * w + Math.sin(aT) * hT);
  // lower: B(0,-bot) → S(w, sy)
  const b1x = P[9] * w, b1y = -bot, b2x = w - Math.cos(aB) * LB, b2y = sy - Math.sin(aB) * LB;
  for (let i = 0; i <= M; i++) { const t = i / M; X[i] = bez(0, b1x, b2x, w, t); Y[i] = bez(-bot, b1y, b2y, sy, t); }
  // upper: S → T(0, top)
  const t1x = w - Math.cos(aT) * LT, t1y = sy + Math.sin(aT) * LT, t2x = P[7] * w, t2y = top;
  for (let i = 1; i <= M; i++) { const t = i / M; X[M + i] = bez(w, t1x, t2x, 0, t); Y[M + i] = bez(sy, t1y, t2y, top, t); }
  return 2 * M + 1;
}

const Q = 40;                                     // polar samples per half for chined sections
const _px = new Float64Array(2 * Q + 1), _py = new Float64Array(2 * Q + 1), _th = new Float64Array(4 * M + 8), _rr = new Float64Array(4 * M + 8);

/** Resample polyline X/Y[i0..i1] into n segments with curvature-weighted spacing; writes n+1 points to out at index o. */
function resample(X, Y, i0, i1, n, out, o) {
  const cnt = i1 - i0;
  let total = 0; const len = _th, cum = _rr;       // scratch (safe: polar arrays are no longer needed at this point)
  for (let i = 0; i < cnt; i++) { len[i] = Math.hypot(X[i0 + i + 1] - X[i0 + i], Y[i0 + i + 1] - Y[i0 + i]); total += len[i]; }
  if (total < 1e-9) { for (let k = 0; k <= n; k++) { out[o + 2 * k] = X[i0]; out[o + 2 * k + 1] = Y[i0]; } return; }
  const R = 0.12 * total; cum[0] = 0;
  for (let i = 0; i < cnt; i++) {
    let turn = 0;
    for (const j of [i, i + 1]) {
      if (j <= 0 || j >= cnt) continue;
      const ax = X[i0 + j] - X[i0 + j - 1], ay = Y[i0 + j] - Y[i0 + j - 1], bx = X[i0 + j + 1] - X[i0 + j], by = Y[i0 + j + 1] - Y[i0 + j];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la > 1e-9 && lb > 1e-9) turn += 0.5 * Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    }
    cum[i + 1] = cum[i] + len[i] + R * turn;
  }
  let seg = 0;
  for (let k = 0; k <= n; k++) {
    const target = cum[cnt] * (k / n);
    while (seg < cnt - 1 && cum[seg + 1] < target) seg++;
    const d = cum[seg + 1] - cum[seg], f = d > 1e-12 ? Math.min(1, Math.max(0, (target - cum[seg]) / d)) : 0;
    out[o + 2 * k] = X[i0 + seg] + (X[i0 + seg + 1] - X[i0 + seg]) * f;
    out[o + 2 * k + 1] = Y[i0 + seg] + (Y[i0 + seg + 1] - Y[i0 + seg]) * f;
  }
  out[o] = X[i0]; out[o + 1] = Y[i0]; out[o + 2 * n] = X[i1]; out[o + 2 * n + 1] = Y[i1];
}

/**
 * Right-half profile of a station (params vector P): 2·nq+1 points [x, y] from bottom centre via the side point (index nq)
 * to top centre, relative to the body axis (x) and absolute in y (station centre already added). Writes into `out`.
 */
function halfProfile(P, nq, out) {
  const w = P[3], cy0 = P[2], cx0 = P[1];
  if (w < 1e-7 && P[4] + P[5] < 1e-7) { for (let k = 0; k <= 2 * nq; k++) { out[2 * k] = cx0; out[2 * k + 1] = cy0; } return; }
  const X = _dx, Y = _dy;
  coreDense(P, X, Y);
  const chW = P[13];
  let srcX = X, srcY = Y, iS = M, iE = 2 * M;
  if (chW > 1e-6) {
    const cy = P[14], e = P[18];
    // polar description of the core about (0, cy)
    const n = 2 * M + 1;
    for (let i = 0; i < n; i++) { _th[i] = Math.atan2(Y[i] - cy, Math.max(X[i], 0)); _rr[i] = Math.hypot(X[i], Y[i] - cy); }
    _th[0] = -Math.PI / 2; _th[n - 1] = Math.PI / 2;
    // core radius straight out to the side
    let i0 = 0; while (i0 < n - 2 && _th[i0 + 1] < 0) i0++;
    const f0 = (0 - _th[i0]) / Math.max(1e-9, _th[i0 + 1] - _th[i0]), rCore0 = _rr[i0] + (_rr[i0 + 1] - _rr[i0]) * f0;
    const prot = chW - rCore0;
    if (prot > 1e-4) {
      const k = Math.min(P[17], prot);
      let seg = 0;
      for (let q = -Q; q <= Q; q++) {
        const u = q / Q, th = (Math.PI / 2) * Math.sign(u) * Math.pow(Math.abs(u), 1.7);
        while (seg < n - 2 && _th[seg + 1] < th) seg++;
        const f = Math.min(1, Math.max(0, (th - _th[seg]) / Math.max(1e-9, _th[seg + 1] - _th[seg])));
        const rc = _rr[seg] + (_rr[seg + 1] - _rr[seg]) * f;
        const c = Math.cos(th), s = Math.abs(Math.sin(th)), t2 = (th > 0 ? P[15] : P[16]) * 0.5;
        let rch = 0;
        if (c > 1e-6) { const a = c / chW, b = s / Math.max(1e-6, t2); rch = Math.pow(Math.pow(a, e) + Math.pow(b, e), -1 / e); }
        const hh = Math.max(k - Math.abs(rc - rch), 0) / Math.max(k, 1e-9);
        const r = Math.max(rc, rch) + hh * hh * k * 0.25;
        _px[q + Q] = r * c; _py[q + Q] = cy + r * Math.sin(th);
      }
      _px[0] = 0; _px[2 * Q] = 0; _px[Q] = chW; _py[Q] = cy;
      srcX = _px; srcY = _py; iS = Q; iE = 2 * Q;
    }
  }
  resample(srcX, srcY, 0, iS, nq, out, 0);
  resample(srcX, srcY, iS, iE, nq, out, 2 * nq);
  for (let k = 0; k <= 2 * nq; k++) { out[2 * k] += cx0; out[2 * k + 1] += cy0; }
}

/** Stations for a rounded (ellipsoidal) nose or tail cap: returns `n` stations between the tip at z0 and the full section `st` at z0 + len. */
export function roundEnd(st, len, n = 4) {
  const out = [], z1 = st.z, dir = Math.sign(len) || 1, z0 = z1 - len;
  const w = st.w ?? st.r ?? 0, top = st.top ?? st.h ?? st.r ?? w, bot = st.bot ?? st.h ?? st.r ?? w;
  for (let i = 0; i < n; i++) {
    const u = i === 0 ? 0 : Math.pow(i / n, 1.6), f = Math.sqrt(1 - (1 - u) * (1 - u));
    out.push({ ...st, z: z0 + (z1 - z0) * u, w: w * f, top: top * f, bot: bot * f, chine: undefined });
  }
  void dir;
  return len > 0 ? out : out.reverse();
}

/**
 * Loft a body through a station table.
 * opts: {
 *   stations,                 see the header
 *   segments = 32,            points around the ring (rounded to a multiple of 4)
 *   step,                     max spacing between rings along the body (default: length / 48)
 *   tRange = [0, 1],          only build part of the ring (e.g. [0.25, 0.75] = upper half shell for a canopy)
 *   zRange,                   only build between two z values (monotonic lofts)
 *   capStart, capEnd,         'none' (default) | 'flat'
 *   creases = [],             ring positions with a hard edge: 'side' | 'top' | 'bottom' | t values
 *   cutouts = [],             [{ name, z: [z0, z1], t: [t0, t1], mirror = false, shape?: (z, t) => bool, keep = false }]
 *                             cells inside are removed from the main skin and returned as `patches[name]` (same surface,
 *                             same UVs — use as a door, canopy glass, speedbrake...). With mirror the region is given for the
 *                             right side and produces name+'R' and name+'L'. keep: the main skin is not cut.
 *   chart,                    unwrap or projected atlas chart for UVs; or uv: [u, v] constant (swatch); uAxis: 'z' | 's'
 *   inflate = 0,              push the skin out along its normals (canopy frames, appliqué panels)
 *   flip = false,             reverse the surface
 * }
 * Returns { mesh, patches, edges: { name: { tLo, tHi, zLo, zHi } } (corner point pairs of each cut-out: hinge lines),
 *           at(z, t) → { p, n }, ring(z), tAtY(z, y), yAtT, topAt(z), botAt(z), halfWidthAt(z), girthAt(z, t), sAtZ(z), zRange, K }
 * Orientation: the skin faces OUTWARD where z increases along the station list (nose → tail). Fold-over skins (intake lips,
 * nacelles) therefore start INSIDE the duct, run forward to the lip and back along the outside.
 */
export function loft(o) {
  const nq = Math.max(2, Math.round((o.segments ?? 32) / 4)), K = nq * 4;
  let pc = null;
  for (const st of o.stations) if (st.chine) { pc = st.chine; break; }
  const S = [];
  for (const st of o.stations) { if (st.chine) pc = st.chine; S.push(normStation(st, pc)); }
  const n = S.length;
  // spline parameter: cumulative station distance (monotonic even if z folds back)
  const sv = new Float64Array(n);
  for (let i = 1; i < n; i++) sv[i] = sv[i - 1] + Math.max(1e-5, Math.hypot(S[i][0] - S[i - 1][0], S[i][3] - S[i - 1][3], 0.5 * (S[i][4] + S[i][5] - S[i - 1][4] - S[i - 1][5]), S[i][2] - S[i - 1][2]));
  // runs between hard stations
  const runs = []; let a = 0;
  for (let i = 1; i < n; i++) if (o.stations[i].hard || i === n - 1) { runs.push([a, i]); a = i; }
  if (!runs.length) runs.push([0, n - 1]);
  const slopes = runs.map(([i0, i1]) => {
    const xs = Array.from(sv.subarray(i0, i1 + 1)), out = [];
    for (let f = 0; f < NF; f++) out.push(pchipSlopes(xs, S.slice(i0, i1 + 1).map(v => v[f])));
    return out;
  });
  const P = new Float64Array(NF);
  function evalAt(run, s, out = P) {
    const [i0, i1] = runs[run];
    let i = i0; while (i < i1 - 1 && sv[i + 1] < s) i++;
    const d = slopes[run];
    for (let f = 0; f < NF; f++) out[f] = hermite(sv[i], sv[i + 1], S[i][f], S[i + 1][f], d[f][i - i0], d[f][i + 1 - i0], Math.min(Math.max(s, sv[i]), sv[i + 1]));
    if (out[3] < 0) out[3] = 0; if (out[13] < 0) out[13] = 0;
    return out;
  }
  function sAtZ(z) {                               // first crossing along the station sequence
    for (let r = 0; r < runs.length; r++) for (let i = runs[r][0]; i < runs[r][1]; i++) {
      const za = S[i][0], zb = S[i + 1][0];
      if ((z - za) * (z - zb) > 0) continue;
      if (Math.abs(zb - za) < 1e-9) return { s: sv[i], run: r };
      let lo = sv[i], hi = sv[i + 1];
      for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2, zm = evalAt(r, mid)[0]; if ((zm - z) * (zb - za) < 0) lo = mid; else hi = mid; }
      return { s: (lo + hi) / 2, run: r };
    }
    const zf = S[0][0], zl = S[n - 1][0];
    return Math.abs(z - zf) < Math.abs(z - zl) ? { s: sv[0], run: 0 } : { s: sv[n - 1], run: runs.length - 1 };
  }

  // ---- ring list --------------------------------------------------------------------------------------------------------
  const zMin = Math.min(...S.map(v => v[0])), zMax = Math.max(...S.map(v => v[0]));
  const step = o.step ?? Math.max(0.02, (sv[n - 1]) / 48);
  const chart = o.chart || null, uAxis = o.uAxis || 'z';
  const cuts = (o.cutouts || []).map((c, ci) => ({ ...c, ci }));
  const extraZ = [];
  for (const c of cuts) if (c.z) extraZ.push(c.z[0], c.z[1]);
  if (chart && chart.splits && uAxis === 'z') extraZ.push(...chart.splits);
  if (o.zRange) extraZ.push(o.zRange[0], o.zRange[1]);
  const ringS = runs.map(() => []);
  runs.forEach(([i0, i1], r) => {
    for (let i = i0; i < i1; i++) {
      const sub = o.stations[i].sub ?? Math.max(1, Math.ceil((sv[i + 1] - sv[i]) / step));
      for (let k = 0; k < sub; k++) ringS[r].push(sv[i] + (sv[i + 1] - sv[i]) * (k / sub));
    }
    ringS[r].push(sv[i1]);
  });
  for (const z of extraZ) { if (z <= zMin + 1e-6 || z >= zMax - 1e-6) continue; const q = sAtZ(z); ringS[q.run].push(q.s); }
  const rings = [];
  ringS.forEach((list, r) => {
    list.sort((x, y) => x - y);
    let last = -1e9; const minGap = Math.min(step * 0.08, 0.004);
    for (const s of list) {
      if (s - last < minGap) continue;
      last = s; rings.push({ s, run: r });
    }
    // make sure the last station of the run is present exactly
    const end = sv[runs[r][1]], tail = rings[rings.length - 1];
    if (tail.run === r && end - tail.s > 1e-9) { if (end - tail.s < minGap) tail.s = end; else rings.push({ s: end, run: r }); }
  });
  const R = rings.length, half = new Float64Array(2 * (2 * nq + 1));
  const pos = new Float64Array(R * K * 3);
  function fillRing(run, s, out, off) {
    evalAt(run, s); halfProfile(P, nq, half);
    const z = P[0], cx = P[1];
    for (let j = 0; j <= 2 * nq; j++) {
      const x = half[2 * j], y = half[2 * j + 1];
      out[off + j * 3] = x; out[off + j * 3 + 1] = y; out[off + j * 3 + 2] = z;
      if (j > 0 && j < 2 * nq) { const jm = K - j; out[off + jm * 3] = 2 * cx - x; out[off + jm * 3 + 1] = y; out[off + jm * 3 + 2] = z; }
    }
    return z;
  }
  for (let i = 0; i < R; i++) { rings[i].z = fillRing(rings[i].run, rings[i].s, pos, i * K * 3); rings[i].u = uAxis === 's' ? rings[i].s : rings[i].z; }
  if (o.zRange) {                                   // drop rings outside the requested z interval
    const [za, zb] = o.zRange; let w = 0;
    for (let i = 0; i < R; i++) if (rings[i].z >= za - 1e-5 && rings[i].z <= zb + 1e-5) { if (w !== i) { pos.copyWithin(w * K * 3, i * K * 3, (i + 1) * K * 3); rings[w] = rings[i]; } w++; }
    rings.length = w;
  }
  const RN = rings.length;
  const collapsed = rings.map((_, i) => { let mx = 0; const b = i * K * 3; for (let j = 1; j < K; j++) mx = Math.max(mx, Math.abs(pos[b + j * 3] - pos[b]) + Math.abs(pos[b + j * 3 + 1] - pos[b + 1])); return mx < 1e-6; });

  // ---- columns, creases ---------------------------------------------------------------------------------------------------
  const tR = o.tRange || [0, 1], full = tR[0] <= 0 && tR[1] >= 1;
  const j0 = Math.round(tR[0] * K), j1 = Math.round(tR[1] * K);
  const crease = new Uint8Array(K + 1);
  for (const c of o.creases || []) {
    if (c === 'side') { crease[nq] = 1; crease[3 * nq] = 1; } else if (c === 'top') crease[2 * nq] = 1; else if (c === 'bottom') { crease[0] = 1; crease[K] = 1; }
    else { const j = Math.round(c * K); crease[j] = 1; if (j === 0) crease[K] = 1; }
  }
  if (!full) { crease[j0 % K] = 1; crease[j1 % K || K] = 1; crease[j1] = 1; }

  // ---- normals: variant 0 central, 1 forward (j..j+1), 2 backward (j-1..j) ------------------------------------------------
  const nrm = [new Float32Array(RN * K * 3), new Float32Array(RN * K * 3), new Float32Array(RN * K * 3)];
  const px = (i, j, k) => pos[(i * K + ((j % K) + K) % K) * 3 + k];
  for (let i = 0; i < RN; i++) {
    let ia = i > 0 && rings[i - 1].run === rings[i].run ? i - 1 : i, ib = i < RN - 1 && rings[i + 1].run === rings[i].run ? i + 1 : i;
    if (ia === ib) { ia = Math.max(0, i - 1); ib = Math.min(RN - 1, i + 1); }
    let ir = i;                                     // ring used for the around-the-ring tangent (skip collapsed tips)
    if (collapsed[i]) ir = (ib !== i && !collapsed[ib]) ? ib : ia;
    for (let j = 0; j < K; j++) {
      const sx = px(ib, j, 0) - px(ia, j, 0), sy = px(ib, j, 1) - px(ia, j, 1), sz = px(ib, j, 2) - px(ia, j, 2);
      for (let v = 0; v < 3; v++) {
        if (v > 0 && !crease[j] && !(j === 0 && crease[K])) { nrm[v][(i * K + j) * 3] = nrm[0][(i * K + j) * 3]; nrm[v][(i * K + j) * 3 + 1] = nrm[0][(i * K + j) * 3 + 1]; nrm[v][(i * K + j) * 3 + 2] = nrm[0][(i * K + j) * 3 + 2]; continue; }
        const ja = v === 1 ? j : j - 1, jb = v === 2 ? j : j + 1;
        const tx = px(ir, jb, 0) - px(ir, ja, 0), ty = px(ir, jb, 1) - px(ir, ja, 1), tz = px(ir, jb, 2) - px(ir, ja, 2);
        let nx = ty * sz - tz * sy, ny = tz * sx - tx * sz, nz = tx * sy - ty * sx;
        let l = Math.hypot(nx, ny, nz);
        if (l < 1e-12) { nx = tx === 0 && ty === 0 ? 0 : ty; ny = -tx; nz = 0; l = Math.hypot(nx, ny, nz) || 1; }
        const b = (i * K + j) * 3; nrm[v][b] = nx / l; nrm[v][b + 1] = ny / l; nrm[v][b + 2] = nz / l;
      }
    }
  }
  if (o.inflate) for (let i = 0; i < RN * K; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] += nrm[0][i * 3 + k] * o.inflate;

  // ---- emit -------------------------------------------------------------------------------------------------------------
  const sign = o.flip ? -1 : 1;
  const uvConst = o.uv || [0, 0];
  const stripOf = (u) => (chart && chart.stripAt ? chart.stripAt(u) : 0);
  const mkOwner = () => ({ mesh: new Mesh(), map: new Map() });
  const main = mkOwner(), patches = {}, owners = {};
  const vid = (ow, i, jj, variant, strip) => {
    const key = (((i * (K + 1) + jj) * 4 + variant) * 16) + strip;
    let id = ow.map.get(key);
    if (id !== undefined) return id;
    const j = jj % K, b = (i * K + j) * 3, nn = nrm[variant];
    let u = uvConst;
    if (chart) u = chart.type === 'unwrap' ? chart.uvUnwrap(rings[i].u, jj / K, strip) : chart.uv3(pos[b], pos[b + 1], pos[b + 2]);
    else if (o.uvFn) { const rg = rings[i]; if (rg.k === undefined) { let q = 0; while (q < n - 2 && sv[q + 1] < rg.s) q++; rg.k = q + (rg.s - sv[q]) / Math.max(1e-9, sv[q + 1] - sv[q]); } u = o.uvFn(pos[b], pos[b + 1], pos[b + 2], jj / K, rg); }
    id = ow.mesh.vert(pos[b], pos[b + 1], pos[b + 2], nn[b] * sign, nn[b + 1] * sign, nn[b + 2] * sign, u[0], u[1]);
    ow.map.set(key, id); return id;
  };
  const cutCols = cuts.map(c => { const t = c.t || [0, 1]; return [Math.round(t[0] * K), Math.round(t[1] * K)]; });
  function ownerOf(zc, j) {
    for (const c of cuts) {
      if (c.z && (zc < c.z[0] || zc > c.z[1])) continue;
      const [ja, jb] = cutCols[c.ci], tc = (j + 0.5) / K;
      const inR = j >= ja && j < jb, inL = c.mirror && j >= K - jb && j < K - ja;
      if (!inR && !inL) continue;
      if (c.shape && !c.shape(zc, inR ? tc : 1 - tc)) continue;
      return c.mirror ? c.name + (inR ? 'R' : 'L') : c.name;
    }
    return null;
  }
  const keepSet = new Set(cuts.filter(c => c.keep).flatMap(c => c.mirror ? [c.name + 'R', c.name + 'L'] : [c.name]));
  for (let i = 0; i < RN - 1; i++) {
    if (rings[i].run !== rings[i + 1].run) continue;
    const zc = (rings[i].z + rings[i + 1].z) / 2, strip = stripOf((rings[i].u + rings[i + 1].u) / 2);
    for (let j = j0; j < j1; j++) {
      const jl = j % K, jh = jl + 1;
      const name = cuts.length ? ownerOf(zc, jl) : null;
      const vl = crease[jl] ? 1 : 0, vh = crease[jh] || (jh === K && crease[0]) ? 2 : 0;
      const emit = (ow) => {
        const A = vid(ow, i, jl, vl, strip), B = vid(ow, i, jh, vh, strip), C = vid(ow, i + 1, jh, vh, strip), D = vid(ow, i + 1, jl, vl, strip);
        if (!collapsed[i]) { if (sign > 0) ow.mesh.tri(A, B, C); else ow.mesh.tri(A, C, B); }
        if (!collapsed[i + 1]) { if (sign > 0) ow.mesh.tri(A, C, D); else ow.mesh.tri(A, D, C); }
      };
      if (name) {
        const ow = owners[name] || (owners[name] = mkOwner());
        emit(ow); if (keepSet.has(name)) emit(main);
        const e = ow.ext || (ow.ext = { i0: i, i1: i + 1, j0: jl, j1: jh });
        e.i0 = Math.min(e.i0, i); e.i1 = Math.max(e.i1, i + 1); e.j0 = Math.min(e.j0, jl); e.j1 = Math.max(e.j1, jh);
      }
      else emit(main);
    }
  }
  const edges = {};
  for (const k in owners) {
    patches[k] = owners[k].mesh;
    const e = owners[k].ext, pt = (i, j) => [px(i, j, 0), px(i, j, 1), px(i, j, 2)];
    // boundary lines of the cut-out as point pairs: along the low-t / high-t edge, and across the first / last ring
    edges[k] = { tLo: [pt(e.i0, e.j0), pt(e.i1, e.j0)], tHi: [pt(e.i0, e.j1), pt(e.i1, e.j1)], zLo: [pt(e.i0, e.j0), pt(e.i0, e.j1)], zHi: [pt(e.i1, e.j0), pt(e.i1, e.j1)] };
  }
  const cap = (i, dir) => {
    if (collapsed[i]) return;
    const m = main.mesh, b = i * K * 3; let cx = 0, cy = 0;
    for (let j = 0; j < K; j++) { cx += pos[b + j * 3]; cy += pos[b + j * 3 + 1]; }
    cx /= K; cy /= K; const z = rings[i].z;
    const uvc = (x, y) => chart && chart.type !== 'unwrap' ? chart.uv3(x, y, z) : (o.capUV || (chart ? chart.uvUnwrap(rings[i].u, 0.25, stripOf(rings[i].u)) : uvConst));
    let u = uvc(cx, cy); const c = m.vert(cx, cy, z, 0, 0, dir * sign, u[0], u[1]), first = m.vertexCount;
    for (let j = 0; j < K; j++) { u = uvc(pos[b + j * 3], pos[b + j * 3 + 1]); m.vert(pos[b + j * 3], pos[b + j * 3 + 1], z, 0, 0, dir * sign, u[0], u[1]); }
    for (let j = 0; j < K; j++) { const p0 = first + j, p1 = first + (j + 1) % K; if (dir * sign < 0) m.tri(c, p1, p0); else m.tri(c, p0, p1); }
  };
  // start cap faces against the station direction, end cap along it
  if (o.capStart === 'flat') cap(0, Math.sign((rings[1]?.z ?? 1) - rings[0].z) > 0 ? -1 : 1);
  if (o.capEnd === 'flat') cap(RN - 1, Math.sign(rings[RN - 1].z - (rings[RN - 2]?.z ?? 0)) > 0 ? 1 : -1);

  // ---- samplers -----------------------------------------------------------------------------------------------------------
  const cache = new Map(), tmp = new Float64Array(K * 3);
  function ring(z) {
    const key = Math.round(z * 2000); let r = cache.get(key);
    if (r) return r;
    const q = sAtZ(z); fillRing(q.run, q.s, tmp, 0);
    r = Float64Array.from(tmp); if (cache.size < 4000) cache.set(key, r);
    return r;
  }
  function at(z, t) {
    const r = ring(z), f = (((t % 1) + 1) % 1) * K, j = Math.floor(f), g = f - j, a = (j % K) * 3, b = ((j + 1) % K) * 3;
    const p = [r[a] + (r[b] - r[a]) * g, r[a + 1] + (r[b + 1] - r[a + 1]) * g, z];
    const d = 0.02, r2 = ring(Math.min(zMax, z + d)), r1 = ring(Math.max(zMin, z - d));
    const zz = Math.min(zMax, z + d) - Math.max(zMin, z - d);
    const sx = (r2[a] + (r2[b] - r2[a]) * g) - (r1[a] + (r1[b] - r1[a]) * g), sy = (r2[a + 1] + (r2[b + 1] - r2[a + 1]) * g) - (r1[a + 1] + (r1[b + 1] - r1[a + 1]) * g);
    const tx = r[b] - r[a], ty = r[b + 1] - r[a + 1];
    let nx = ty * zz, ny = -tx * zz, nz = tx * sy - ty * sx; const l = Math.hypot(nx, ny, nz) || 1;
    return { p, n: [nx / l, ny / l, nz / l] };
  }
  /** Ring parameter (right side, 0..0.5) where the skin is at height y at station z. */
  function tAtY(z, y) {
    const r = ring(z);
    if (y <= r[1]) return 0; if (y >= r[2 * nq * 3 + 1]) return 0.5;
    for (let j = 0; j < 2 * nq; j++) { const ya = r[j * 3 + 1], yb = r[(j + 1) * 3 + 1]; if (y >= ya && y <= yb) return (j + (yb - ya > 1e-9 ? (y - ya) / (yb - ya) : 0)) / K; }
    return 0.25;
  }
  return {
    mesh: main.mesh, patches, edges, at, ring, tAtY, sAtZ: (z) => sAtZ(z).s, K, zRange: [zMin, zMax],
    yAtT: (z, t) => at(z, t).p[1],
    topAt: (z) => ring(z)[2 * nq * 3 + 1], botAt: (z) => ring(z)[1], halfWidthAt: (z) => { const r = ring(z); let m = 0; for (let j = 0; j <= 2 * nq; j++) m = Math.max(m, r[j * 3]); return m; },
    /** Local skin girth metric: metres of arc per unit t at (z, t). */
    girthAt: (z, t) => { const r = ring(z), j = Math.min(K - 1, Math.floor((((t % 1) + 1) % 1) * K)), a = j * 3, b = ((j + 1) % K) * 3; return Math.hypot(r[b] - r[a], r[b + 1] - r[a + 1]) * K; },
  };
}
