// Aircraft kit — lifting surfaces: wings, tailplanes, fins, canards, winglets, ventral fins, pylons…
// with hinged control surfaces cut out of the parent surface as separate meshes.
//
// A surface is a ruled skin through airfoil sections at span stations. Stations give the LEADING-EDGE point in body axes
// for the RIGHT-hand surface; `side: -1` mirrors the finished result to the left. The section's thickness direction is
// perpendicular to the local span direction in the X-Y plane, so the same function builds a wing (stations along +X),
// a fin (stations along +Y), a V-tail or a blended winglet (stations curving from +X up to +Y).
//
//   wing({
//     stations: [{ x, y, z, chord, twist = 0 (deg, + = LE up), tc (thickness/chord), airfoil?, hard? }, ...],
//     airfoil,                  default section (see airfoil.js)
//     side: 1 | -1,
//     chordPts = 12,            skin intervals per surface, LE → TE
//     spanAxis: 'x' | 'y' | 'u' coordinate used below for spans (u = distance along the span from the first station)
//     lines: { name: [[span, chordFraction], ...] },      feature lines the chordwise grid follows (hinge lines)
//     controls: [ ... ],        see below
//     tip: 'round' | 'flat' | 'none',  root: 'none' | 'flat',  tipLength = 1
//     charts: { upper, lower } | [{ from: span, upper, lower }, ...]   atlas charts (projected); or uv: [u, v]
//   })
// Controls (each becomes its own closed mesh, with the hinge line and a reference point for sign conventions):
//   { name, type: 'flap',  span: [a, b], from: line | 'LE' (default), to: line | 'TE' (default), nose = 1, tail = 0, cove = false, hinge: 'front' | 'rear', hingeDepth = .5 }
//       a full-depth block between two lines: ailerons, flaperons, elevators, rudders, plain/Fowler flap segments
//       (from: hinge line, to: 'te'), leading-edge flaps and slats (from: 'le', to: line; slats: cove: true).
//   { name, type: 'panel', span, from, to, surface: 'upper' | 'lower', thickness = .025, depth = .05, hinge: 'front' | 'rear' }
//       a skin panel on one surface: spoilers, lift dumpers, Krueger flaps, airbrake panels. The parent gets a recess.
//   { name, type: 'split', span, from, to: 'te' }
//       a trailing-edge block split into an upper and a lower half that open like a clamshell (drag rudders, decelerons):
//       result has parts.upper / parts.lower, each with its own mesh and hinge.
// Result: { mesh, controls: { name: { mesh, hinge: { a, b }, ref, chord, parts? } }, at(span, frac, 'upper'|'lower'|'mid'), spanToU }
import { Mesh, thicken, well } from './mesh.js';
import { naca4 } from './airfoil.js';

const DEG = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const mix = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function wing(o) {
  const side = o.side ?? 1, N = Math.max(6, o.chordPts ?? 12), defAf = o.airfoil || naca4('0010');
  // ---- stations ------------------------------------------------------------------------------------------------------
  const sts = o.stations.map(s => ({ x: s.x ?? 0, y: s.y ?? 0, z: s.z ?? 0, chord: s.chord, tw: (s.twist ?? 0) * DEG, af: s.airfoil || defAf, tc: s.tc ?? (s.airfoil || defAf).tc, hard: !!s.hard, camber: s.camber ?? 1 }));
  const tanXY = (i) => {                              // span tangent in the X-Y plane (averaged at smooth joints)
    const d = (a, b) => { const dx = sts[b].x - sts[a].x, dy = sts[b].y - sts[a].y, l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
    if (i === 0) return d(0, 1); if (i === sts.length - 1) return d(i - 1, i);
    const a = d(i - 1, i), b = d(i, i + 1), l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1; return [(a[0] + b[0]) / l, (a[1] + b[1]) / l];
  };
  for (let i = 0; i < sts.length; i++) { const t = tanXY(i); sts[i].t = t; sts[i].up = o.up ? o.up : [-t[1], t[0], 0]; }
  const tipMode = o.tip ?? 'round';
  const nReal = sts.length;
  if (tipMode === 'round') {
    const L = sts[nReal - 1], r = 0.5 * L.tc * L.chord * (o.tipLength ?? 1);
    for (const a of [30, 55, 75, 88]) {
      const sn = Math.sin(a * DEG), cs = Math.cos(a * DEG), inset = (1 - cs) * Math.min(0.35 * L.chord, 2.2 * r);
      const chord = L.chord - inset;
      sts.push({ ...L, x: L.x + L.t[0] * r * sn, y: L.y + L.t[1] * r * sn, z: L.z + inset * 0.45, chord, tc: Math.max(0.004, L.tc * cs * L.chord / chord), hard: false, rounded: true });
    }
  }
  const ns = sts.length, U = new Float64Array(ns);
  for (let i = 1; i < ns; i++) U[i] = U[i - 1] + Math.max(1e-6, Math.hypot(sts[i].x - sts[i - 1].x, sts[i].y - sts[i - 1].y));
  const axis = o.spanAxis || 'x';
  const spanToU = (v) => {
    if (axis === 'u') return v;
    const c = (i) => (axis === 'x' ? sts[i].x : sts[i].y);
    if (v <= c(0)) return U[0];
    for (let i = 0; i < nReal - 1; i++) { const a = c(i), b = c(i + 1); if ((v - a) * (v - b) <= 0 && Math.abs(b - a) > 1e-9) return U[i] + (U[i + 1] - U[i]) * (v - a) / (b - a); }
    return U[nReal - 1];
  };
  // section point at station k, chord fraction f, sigma = +1 upper / -1 lower / 0 camber line
  function sec(k, f, sg) {
    const s = sts[k], af = s.af, h = af.camber(f) * s.camber + sg * af.thick(f) * (s.tc / af.tc), c = s.chord;
    const ct = Math.cos(s.tw), sn = Math.sin(s.tw), up = s.up;
    const cd = [-up[0] * sn, -up[1] * sn, ct], td = [up[0] * ct, up[1] * ct, sn];
    return [s.x + cd[0] * c * f + td[0] * c * h, s.y + cd[1] * c * f + td[1] * c * h, s.z + cd[2] * c * f + td[2] * c * h];
  }

  // ---- feature lines → pinned columns ----------------------------------------------------------------------------------
  const F = []; for (let j = 0; j <= N; j++) F.push(1 - Math.cos(0.5 * Math.PI * Math.pow(j / N, 1.15)));
  F[N] = 1;
  const lines = Object.entries(o.lines || {}).map(([name, pts]) => {
    const p = pts.map(q => [spanToU(q[0]), q[1]]).sort((a, b) => a[0] - b[0]);
    const at = (u) => { if (u <= p[0][0]) return p[0][1]; for (let i = 0; i < p.length - 1; i++) if (u <= p[i + 1][0]) return p[i][1] + (p[i + 1][1] - p[i][1]) * (u - p[i][0]) / Math.max(1e-9, p[i + 1][0] - p[i][0]); return p[p.length - 1][1]; };
    return { name, p, at, mean: p.reduce((a, q) => a + q[1], 0) / p.length };
  }).sort((a, b) => a.mean - b.mean);
  lines.forEach((ln, li) => {
    let best = 1, bd = 1e9; const lo = li === 0 ? 1 : lines[li - 1].col + 1, hi = N - (lines.length - li);
    for (let j = lo; j <= hi; j++) { const d = Math.abs(F[j] - ln.mean); if (d < bd) { bd = d; best = j; } }
    ln.col = best;
  });
  const lineByName = Object.fromEntries(lines.map(l => [l.name, l]));
  const colOf = (ref, dflt) => (ref === undefined || ref === null ? dflt : lineByName[ref] ? lineByName[ref].col : ref === 'LE' || ref === 'le' ? 0 : ref === 'TE' || ref === 'te' ? N : dflt);
  const fracs = (u, out) => {
    let ca = 0, fa = 0, li = 0;
    for (let j = 0; j <= N; j++) {
      while (li < lines.length && lines[li].col < j) { ca = lines[li].col; fa = lines[li].at(u); li++; }
      const cb = li < lines.length ? lines[li].col : N, fb = li < lines.length ? lines[li].at(u) : 1;
      out[j] = j === cb ? fb : fa + (F[j] - F[ca]) / (F[cb] - F[ca]) * (fb - fa);
    }
    return out;
  };

  // ---- rows -------------------------------------------------------------------------------------------------------------
  const ctrls = (o.controls || []).map(c => ({ ...c, u0: spanToU(c.span[0]), u1: spanToU(c.span[1]) }));
  const chartSets = Array.isArray(o.charts) ? o.charts.map(c => ({ ...c, u: spanToU(c.from ?? -1e9) })) : (o.charts ? [{ ...o.charts, u: -1e9 }] : []);
  const uList = [];
  for (let i = 0; i < ns; i++) { uList.push({ u: U[i], st: i }); if (sts[i].hard && i > 0 && i < ns - 1) uList.push({ u: U[i], st: i, dup: true }); }
  const extra = [];
  for (const c of ctrls) extra.push(c.u0, c.u1);
  for (const l of lines) for (const q of l.p) extra.push(q[0]);
  for (const c of chartSets) if (c.u > -1e8) extra.push(c.u);
  for (const u of extra) if (u > U[0] + 1e-5 && u < U[nReal - 1] - 1e-5 && !uList.some(r => Math.abs(r.u - u) < 1e-4)) uList.push({ u });
  uList.sort((a, b) => a.u - b.u || (a.dup ? 1 : 0) - (b.dup ? 1 : 0));
  const R = uList.length, W = 2 * N + 1;
  const pos = new Float64Array(R * W * 3), fr = new Float64Array(N + 1), rowFr = [];
  const rowAt = (u) => { let b = 0, bd = 1e9; for (let i = 0; i < R; i++) { const d = Math.abs(uList[i].u - u); if (d < bd - 1e-9) { bd = d; b = i; } } return b; };
  for (let r = 0; r < R; r++) {
    const u = uList[r].u; let k = 0; while (k < ns - 2 && U[k + 1] < u - 1e-9) k++;
    const g = Math.min(1, Math.max(0, (u - U[k]) / (U[k + 1] - U[k])));
    fracs(u, fr); rowFr.push(Float64Array.from(fr));
    for (let j = 0; j <= N; j++) for (const sg of [1, -1]) {
      if (j === 0 && sg < 0) continue;
      const a = sec(k, fr[j], j === 0 ? 0 : sg), b = sec(k + 1, fr[j], j === 0 ? 0 : sg), p = g <= 0 ? a : g >= 1 ? b : mix(a, b, g);
      const kk = sg > 0 ? N + j : N - j, off = (r * W + kk) * 3; pos[off] = p[0]; pos[off + 1] = p[1]; pos[off + 2] = p[2];
    }
  }
  const Pt = (r, k) => [pos[(r * W + k) * 3], pos[(r * W + k) * 3 + 1], pos[(r * W + k) * 3 + 2]];
  const PU = (r, j) => Pt(r, N + j), PL = (r, j) => Pt(r, N - j);
  // smooth-run neighbours for the spanwise tangent
  const sameRun = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); for (let i = lo; i < hi; i++) if (uList[i + 1].dup) return false; return true; };
  const sharp = sts.some(s => s.af.sharp);
  const nrm = new Float32Array(R * (W + 1) * 3);
  for (let r = 0; r < R; r++) {
    let ra = r > 0 && sameRun(r - 1, r) ? r - 1 : r, rb = r < R - 1 && sameRun(r, r + 1) ? r + 1 : r;
    if (ra === rb) { ra = Math.max(0, r - 1); rb = Math.min(R - 1, r + 1); }
    for (let k = 0; k <= W; k++) {
      const kk = k === W ? N : k;
      let ka = Math.max(0, kk - 1), kb = Math.min(W - 1, kk + 1);
      if (sharp && kk === N) { if (k === W) kb = N; else ka = N; }     // k = N: upper-side LE normal, k = W: lower-side
      const T = sub(Pt(r, kb), Pt(r, ka)), S = sub(Pt(rb, kk), Pt(ra, kk));
      const n = norm(cross(T, S)), off = (r * (W + 1) + k) * 3; nrm[off] = n[0]; nrm[off + 1] = n[1]; nrm[off + 2] = n[2];
    }
  }
  const Nr = (r, k) => [nrm[(r * (W + 1) + k) * 3], nrm[(r * (W + 1) + k) * 3 + 1], nrm[(r * (W + 1) + k) * 3 + 2]];

  // ---- ownership ---------------------------------------------------------------------------------------------------------
  const own = [new Int16Array(R * N), new Int16Array(R * N)];            // [upper, lower] per (row interval, column interval)
  ctrls.forEach((c, ci) => {
    c.r0 = rowAt(c.u0); c.r1 = rowAt(c.u1);
    while (c.r0 < R - 1 && Math.abs(uList[c.r0 + 1].u - uList[c.r0].u) < 1e-9) c.r0++;
    while (c.r1 > 0 && Math.abs(uList[c.r1 - 1].u - uList[c.r1].u) < 1e-9) c.r1--;
    c.c0 = colOf(c.from, 0); c.c1 = colOf(c.to, N);
    const surf = c.type === 'panel' ? (c.surface === 'lower' ? [1] : [0]) : [0, 1];
    for (let r = c.r0; r < c.r1; r++) for (let j = c.c0; j < c.c1; j++) for (const s of surf) own[s][r * N + j] = ci + 1;
  });
  const setOf = (r) => { const um = 0.5 * (uList[r].u + uList[Math.min(R - 1, r + 1)].u); let k = 0; for (let i = 0; i < chartSets.length; i++) if (chartSets[i].u <= um) k = i; return k; };
  const uvConst = o.uv || [0, 0];
  const uvOf = (p, s, set) => {
    const cs = chartSets[set]; if (!cs) return uvConst;
    const ch = s === 0 ? cs.upper : (cs.lower || cs.upper);
    return ch.uv3(p[0] * side, p[1], p[2]);
  };
  const mk = () => ({ mesh: new Mesh(), map: new Map() });
  const vtx = (ow, r, j, s, set) => {
    const k = s === 0 ? N + j : N - j, key = ((r * W + k) * 2 + s) * 8 + set;
    let id = ow.map.get(key); if (id !== undefined) return id;
    const p = Pt(r, k), n = Nr(r, (s === 1 && j === 0) ? W : k), u = uvOf(p, s, set);
    id = ow.mesh.vert(p[0], p[1], p[2], n[0], n[1], n[2], u[0], u[1]); ow.map.set(key, id); return id;
  };
  const cell = (ow, r, j, s, set) => {
    const a = vtx(ow, r, j, s, set), b = vtx(ow, r, j + 1, s, set), c = vtx(ow, r + 1, j + 1, s, set), d = vtx(ow, r + 1, j, s, set);
    if (s === 0) { ow.mesh.tri(a, b, c); ow.mesh.tri(a, c, d); } else { ow.mesh.tri(a, c, b); ow.mesh.tri(a, d, c); }
  };
  const validRow = (r) => r >= 0 && r < R - 1 && uList[r + 1].u - uList[r].u > 1e-9;
  const flat = (mesh, pts, n, uv) => {                                    // flat polygon fan/quad with one normal and uv
    const i0 = mesh.vertexCount; for (const p of pts) mesh.vert(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]);
    for (let i = 1; i < pts.length - 1; i++) mesh.tri(i0, i0 + i, i0 + i + 1);
  };
  const chordDir = (r) => norm(sub(PU(r, N), Pt(r, N)));
  const spanDir = (r) => norm(cross(sub(PU(r, Math.ceil(N / 2)), PL(r, Math.ceil(N / 2))), chordDir(r)));
  const edgeUV = (r, j) => o.edgeUV || uvOf(PU(r, Math.min(N, Math.max(0, j))), 0, setOf(Math.min(r, R - 2)));

  // arc across the thickness at (row r, column c): from the upper skin point to the lower, bulging along dirSign·chord
  const ARC = 6;
  function arc(r, c, dirSign, bulge) {
    const Up = PU(r, c), Lo = PL(r, c), Mid = mix(Up, Lo, 0.5), h = sub(Up, Mid), hl = Math.hypot(h[0], h[1], h[2]) || 1e-9, hh = [h[0] / hl, h[1] / hl, h[2] / hl];
    let f = chordDir(r); f = [f[0] * dirSign, f[1] * dirSign, f[2] * dirSign]; const d = dot(f, hh); f = norm([f[0] - hh[0] * d, f[1] - hh[1] * d, f[2] - hh[2] * d]);
    const m = bulge > 1e-6 ? ARC : 1, pts = [], ns2 = [];
    for (let k = 0; k <= m; k++) {
      const a = Math.PI * k / m, ca = Math.cos(a), sa = Math.sin(a);
      pts.push([Mid[0] + h[0] * ca + f[0] * hl * bulge * sa, Mid[1] + h[1] * ca + f[1] * hl * bulge * sa, Mid[2] + h[2] * ca + f[2] * hl * bulge * sa]);
      ns2.push(bulge > 1e-6 ? norm([hh[0] * bulge * ca + f[0] * sa, hh[1] * bulge * ca + f[1] * sa, hh[2] * bulge * ca + f[2] * sa]) : f);
    }
    return { pts, n: ns2, mid: Mid, f };
  }
  // closure strip along column c between rows r0..r1. face: +1 = surface faces the bulge direction (convex), -1 = concave
  function closure(mesh, r0, r1, c, dirSign, bulge, face, uvCol) {
    let prev = null;
    for (let r = r0; r <= r1; r++) {
      const A = arc(r, c, dirSign, bulge), uv = edgeUV(r, uvCol), ids = [];
      for (let k = 0; k < A.pts.length; k++) ids.push(mesh.vert(A.pts[k][0], A.pts[k][1], A.pts[k][2], A.n[k][0] * face, A.n[k][1] * face, A.n[k][2] * face, uv[0], uv[1]));
      if (prev && validRow(r - 1)) for (let k = 0; k < ids.length - 1; k++) {
        if (dirSign * face < 0) mesh.quad(prev[k], ids[k], ids[k + 1], prev[k + 1]); else mesh.quad(prev[k], prev[k + 1], ids[k + 1], ids[k]);
      }
      prev = ids;
    }
  }
  // end rib of a block at row r between columns c0..c1, facing sgn·span; optional bulged ends (front / rear arcs)
  function rib(mesh, r, c0, c1, sgn, frontBulge, rearBulge, uvCol, surf = 2) {
    const sd = spanDir(r), n = [sd[0] * sgn, sd[1] * sgn, sd[2] * sgn], uv = edgeUV(r, uvCol);
    for (let j = c0; j < c1; j++) {
      const a = PU(r, j), b = PU(r, j + 1), c = PL(r, j + 1), d = PL(r, j);
      if (surf === 2) flat(mesh, sgn > 0 ? [a, b, c, d] : [d, c, b, a], n, uv);
      else { const ma = mix(a, d, 0.5), mb = mix(b, c, 0.5); const q = surf === 0 ? [a, b, mb, ma] : [ma, mb, c, d]; flat(mesh, sgn > 0 ? q : q.slice().reverse(), n, uv); }
    }
    const fan = (A, fwd) => { for (let k = 0; k < A.pts.length - 1; k++) { const ccw = fwd ? sgn < 0 : sgn > 0; flat(mesh, ccw ? [A.mid, A.pts[k], A.pts[k + 1]] : [A.mid, A.pts[k + 1], A.pts[k]], n, uv); } };
    if (frontBulge > 1e-6 && surf === 2) fan(arc(r, c0, -1, frontBulge), true);
    if (rearBulge > 1e-6 && surf === 2) fan(arc(r, c1, 1, rearBulge), false);
  }
  const teStrip = (mesh, r0, r1, uvCol) => {
    for (let r = r0; r < r1; r++) if (validRow(r)) { const cd = chordDir(r); flat(mesh, [PU(r, N), PL(r, N), PL(r + 1, N), PU(r + 1, N)], cd, edgeUV(r, uvCol)); }
  };

  // ---- main skin -----------------------------------------------------------------------------------------------------------
  const main = mk();
  for (let r = 0; r < R - 1; r++) {
    if (!validRow(r)) continue; const set = setOf(r);
    for (let j = 0; j < N; j++) for (const s of [0, 1]) if (own[s][r * N + j] === 0) cell(main, r, j, s, set);
    if (own[0][r * N + N - 1] === 0 && own[1][r * N + N - 1] === 0) teStrip(main.mesh, r, r + 1, N - 1);
  }
  if (tipMode !== 'none') rib(main.mesh, R - 1, 0, N, 1, 0, 0, Math.ceil(N / 2));
  if (o.root === 'flat') rib(main.mesh, 0, 0, N, -1, 0, 0, Math.ceil(N / 2));

  // ---- controls ---------------------------------------------------------------------------------------------------------
  const controls = {};
  const mainOwns = (r, j, s) => r >= 0 && r < R - 1 && j >= 0 && j < N && own[s][r * N + j] === 0;
  const hingeLine = (c, col, depth) => ({ a: mix(PU(c.r0, col), PL(c.r0, col), depth), b: mix(PU(c.r1, col), PL(c.r1, col), depth) });
  const midRow = (c) => Math.round((c.r0 + c.r1) / 2);
  ctrls.forEach((c, ci) => {
    const { r0, r1, c0, c1 } = c, id = ci + 1, rm = midRow(c);
    const meanChord = 0.5 * (Math.hypot(...sub(PU(r0, c1), PU(r0, c0))) + Math.hypot(...sub(PU(r1, c1), PU(r1, c0))));
    const upv = Nr(rm, N + Math.min(N, c0 + 1));
    if (c.type === 'panel') {
      const s = c.surface === 'lower' ? 1 : 0, patch = mk();
      for (let r = r0; r < r1; r++) if (validRow(r)) for (let j = c0; j < c1; j++) cell(patch, r, j, s, setOf(r));
      const th = c.thickness ?? 0.025;
      const inner = o.innerUV || null;
      controls[c.name] = { mesh: thicken(patch.mesh, th, inner), chord: meanChord, up: upv };
      main.mesh.add(well(patch.mesh, c.depth ?? 0.05, o.innerUV || null));
      const hc = c.hinge === 'rear' ? c1 : c0, fc = c.hinge === 'rear' ? c0 : c1, P = s === 0 ? PU : PL;
      controls[c.name].hinge = { a: P(r0, hc), b: P(r1, hc) };
      controls[c.name].ref = mix(P(r0, fc), P(r1, fc), 0.5);
      return;
    }
    if (c.type === 'split') {
      const parts = {};
      for (const s of [0, 1]) {
        const ow = mk(), m = ow.mesh, P = s === 0 ? PU : PL;
        for (let r = r0; r < r1; r++) if (validRow(r)) for (let j = c0; j < c1; j++) cell(ow, r, j, s, setOf(r));
        // inner face along the mid-surface, front wall, end ribs
        for (let r = r0; r < r1; r++) if (validRow(r)) for (let j = c0; j < c1; j++) {
          const a = mix(PU(r, j), PL(r, j), 0.5), b = mix(PU(r, j + 1), PL(r, j + 1), 0.5), cc = mix(PU(r + 1, j + 1), PL(r + 1, j + 1), 0.5), d = mix(PU(r + 1, j), PL(r + 1, j), 0.5);
          const nn = Nr(r, s === 0 ? N - j : N + j);         // faces the other half
          flat(m, s === 0 ? [a, cc, b] : [a, b, cc], nn, edgeUV(r, c0 + 1)); flat(m, s === 0 ? [a, d, cc] : [a, cc, d], nn, edgeUV(r, c0 + 1));
        }
        for (let r = r0; r < r1; r++) if (validRow(r)) {
          const cd = chordDir(r), f = [-cd[0], -cd[1], -cd[2]];
          const a = P(r, c0), b = P(r + 1, c0), ma = mix(PU(r, c0), PL(r, c0), 0.5), mb = mix(PU(r + 1, c0), PL(r + 1, c0), 0.5);
          flat(m, s === 0 ? [a, b, mb, ma] : [a, ma, mb, b], f, edgeUV(r, c0 + 1));
        }
        rib(m, r0, c0, c1, -1, 0, 0, c0 + 1, s); rib(m, r1, c0, c1, 1, 0, 0, c0 + 1, s);
        parts[s === 0 ? 'upper' : 'lower'] = { mesh: m, hinge: { a: P(r0, c0), b: P(r1, c0) }, ref: mix(P(r0, c1), P(r1, c1), 0.5), chord: meanChord };
      }
      for (let r = r0; r < r1; r++) if (validRow(r) && mainOwns(r, c0 - 1, 0)) { const cd = chordDir(r); flat(main.mesh, [PU(r, c0), PL(r, c0), PL(r + 1, c0), PU(r + 1, c0)], cd, o.innerUV || edgeUV(r, c0 - 1)); }
      if (mainOwns(r0 - 1, c0, 0)) rib(main.mesh, r0, c0, c1, 1, 0, 0, c0 + 1);
      if (mainOwns(r1, c0, 0)) rib(main.mesh, r1, c0, c1, -1, 0, 0, c0 + 1);
      controls[c.name] = { parts, chord: meanChord, hinge: hingeLine(c, c0, 0.5), ref: mix(PU(rm, c1), PL(rm, c1), 0.5), up: upv };
      return;
    }
    // 'flap' block
    const ow = mk(), m = ow.mesh;
    for (let r = r0; r < r1; r++) if (validRow(r)) for (let j = c0; j < c1; j++) { cell(ow, r, j, 0, setOf(r)); cell(ow, r, j, 1, setOf(r)); }
    const nose = c0 > 0 ? (c.nose ?? 1) : 0, cove = !!c.cove && c1 < N, tail = c1 < N ? (cove ? (c.coveBulge ?? 1.4) : (c.tail ?? (c0 === 0 ? 1 : 0))) : 0;
    const inUV = c0 + 1;
    if (c0 > 0) closure(m, r0, r1, c0, -1, nose, 1, inUV);
    if (c1 < N) { if (cove) closure(m, r0, r1, c1, -1, tail, -1, inUV); else closure(m, r0, r1, c1, 1, tail, 1, inUV); }
    else teStrip(m, r0, r1, N - 1);
    rib(m, r0, c0, c1, -1, nose, cove ? 0 : tail, inUV); rib(m, r1, c0, c1, 1, nose, cove ? 0 : tail, inUV);
    // parent closures
    const wallUV = (r) => o.innerUV || edgeUV(r, c0 > 0 ? c0 - 1 : c1 + 1);
    if (c0 > 0) for (let r = r0; r < r1; r++) if (validRow(r) && mainOwns(r, c0 - 1, 0)) flat(main.mesh, [PU(r, c0), PL(r, c0), PL(r + 1, c0), PU(r + 1, c0)], chordDir(r), wallUV(r));
    if (c1 < N) {
      if (cove) { let ra = r0; while (ra < r1) { let rb = ra; while (rb < r1 && mainOwns(rb, c1, 0)) rb++; if (rb > ra) closure(main.mesh, ra, rb, c1, -1, tail, 1, c1 + 1); ra = Math.max(rb, ra + 1); } }
      else for (let r = r0; r < r1; r++) if (validRow(r) && mainOwns(r, c1, 0)) { const cd = chordDir(r); flat(main.mesh, [PU(r, c1), PU(r + 1, c1), PL(r + 1, c1), PL(r, c1)], [-cd[0], -cd[1], -cd[2]], wallUV(r)); }
    }
    for (const [rr, sgn, nb] of [[r0, 1, r0 - 1], [r1, -1, r1]]) {
      // cavity side wall where the neighbouring bay belongs to the parent (or is the open root / tip)
      let ja = c0; while (ja < c1) { let jb = ja; while (jb < c1 && (mainOwns(nb, jb, 0) || nb < 0 || nb >= R - 1)) jb++; if (jb > ja) rib(main.mesh, rr, ja, jb, sgn, 0, 0, Math.min(N, jb + 1)); ja = Math.max(jb, ja + 1); }
    }
    const hc = (c.hinge ?? (c0 > 0 ? 'front' : 'rear')) === 'front' ? c0 : c1, fc = hc === c0 ? c1 : c0;
    controls[c.name] = { mesh: m, hinge: hingeLine(c, hc, c.hingeDepth ?? 0.5), ref: mix(PU(rm, fc), PL(rm, fc), 0.5), chord: meanChord, up: upv };
  });

  // ---- mirror for the left side ---------------------------------------------------------------------------------------------
  const mp = (p) => (side < 0 ? [-p[0], p[1], p[2]] : p);
  const fin = (c) => { if (c.mesh && side < 0) c.mesh = c.mesh.mirrorX(); if (c.hinge) c.hinge = { a: mp(c.hinge.a), b: mp(c.hinge.b) }; if (c.ref) c.ref = mp(c.ref); if (c.up) c.up = mp(c.up); if (c.parts) for (const k in c.parts) fin(c.parts[k]); };
  for (const k in controls) fin(controls[k]);
  const mesh = side < 0 ? main.mesh.mirrorX() : main.mesh;

  /** Point on the surface at a span coordinate and chord fraction: surf 'upper' | 'lower' | 'mid'. */
  function at(span, frac, surf = 'upper') {
    const u = spanToU(span); let k = 0; while (k < nReal - 2 && U[k + 1] < u) k++;
    const g = Math.min(1, Math.max(0, (u - U[k]) / (U[k + 1] - U[k]))), sg = surf === 'upper' ? 1 : surf === 'lower' ? -1 : 0;
    return mp(mix(sec(k, frac, sg), sec(k + 1, frac, sg), g));
  }
  return { mesh, controls, at, spanToU, lines: lineByName, stations: sts };
}

/**
 * Stations for a blended winglet continuing from the tip station `tip` (same fields as wing stations).
 * opts: { height, cant = 15 (deg from vertical, outward), radius = height * .35, sweep = 55 (deg, LE), tipChord, tc, n = 5 }
 * Returns the extra stations to append after `tip`.
 */
export function blendedWinglet(tip, o = {}) {
  const h = o.height ?? 2, cant = (o.cant ?? 15) * DEG, rad = o.radius ?? h * 0.35, sw = Math.tan((o.sweep ?? 55) * DEG), n = o.n ?? 5;
  const tipChord = o.tipChord ?? tip.chord * 0.35, tc0 = tip.tc ?? 0.1, tcTip = o.tc ?? tc0, dih = (o.dihedral ?? 0) * DEG;
  const thEnd = Math.PI / 2 - cant, aEnd = thEnd - dih;          // turn from the wing plane up to the cant angle
  const arcH = rad * (Math.cos(dih) - Math.cos(thEnd)), straight = Math.max(0.05, (h - arcH) / Math.sin(thEnd)), total = rad * aEnd + straight;
  const zAt = (d) => tip.z + sw * d, chordAt = (d) => tip.chord + (tipChord - tip.chord) * Math.pow(d / total, o.taperPow ?? 0.8);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const a = aEnd * i / n, d = rad * a;
    out.push({ x: tip.x + rad * (Math.sin(dih + a) - Math.sin(dih)), y: tip.y + rad * (Math.cos(dih) - Math.cos(dih + a)), z: zAt(d), chord: chordAt(d), tc: tc0 + (tcTip - tc0) * (d / total), airfoil: tip.airfoil, twist: (tip.twist ?? 0) * (1 - i / n) });
  }
  const L = out[out.length - 1];
  out.push({ x: L.x + Math.cos(thEnd) * straight, y: L.y + Math.sin(thEnd) * straight, z: zAt(total), chord: tipChord, tc: tcTip, airfoil: tip.airfoil, twist: 0 });
  return out;
}
