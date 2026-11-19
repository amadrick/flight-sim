// Aircraft kit — cockpit furniture: pilot figure, ejection / airline seats, HUD, sticks and yokes, simple tubs.
// Everything is positioned from the pilot eye point (geometry.pilotEye) so the eye-point camera sits inside the helmet.
import { Mesh, ellipsoid, tube, box, lathe } from './mesh.js';

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/**
 * Seated, helmeted pilot. opts: { eye: [x, y, z], uv: { suit, helmet, visor, dark, glove }, stick: 'side' | 'centre' | 'yoke' | [x, y, z] (right hand),
 *   throttle: [x, y, z] (left hand, relative to the eye), recline = 0 (deg), mask = true, scale = 1 }
 */
export function pilot(o) {
  const e = o.eye, uv = o.uv, m = new Mesh(), k = o.scale ?? 1, P = (x, y, z) => [e[0] + x * k, e[1] + y * k, e[2] + z * k];
  const rc = Math.tan((o.recline ?? 0) * Math.PI / 180);                 // torso leans back: z offset per metre of drop
  const H = P(0, -0.02, 0.085);
  m.add(ellipsoid(0.116 * k, 0.126 * k, 0.136 * k, { segments: 16, rings: 10, uv: uv.helmet }).translate(...H));
  m.add(ellipsoid(0.112 * k, 0.092 * k, 0.142 * k, { segments: 16, rings: 8, z0: -1, z1: -0.15, uv: uv.visor }).translate(H[0], H[1] + 0.012 * k, H[2] + 0.004 * k));
  if (o.mask !== false) {
    m.add(ellipsoid(0.05 * k, 0.052 * k, 0.062 * k, { segments: 10, rings: 6, uv: uv.dark }).translate(H[0], H[1] - 0.068 * k, H[2] - 0.098 * k));
    m.add(tube(P(0.02, -0.11, -0.06), P(0.07, -0.3, -0.07 + 0.3 * rc), 0.016 * k, 0.016 * k, { segments: 6, uv: uv.dark }));
  }
  m.add(tube(P(0, -0.12, 0.09), P(0, -0.2, 0.09 + 0.2 * rc), 0.055 * k, 0.065 * k, { segments: 8, uv: uv.suit, caps: false }));
  const tz = (y) => 0.07 + Math.abs(y) * rc;                               // torso centre-line z offset at a drop of y
  m.add(ellipsoid(0.235 * k, 0.085 * k, 0.11 * k, { segments: 12, rings: 6, uv: uv.suit }).translate(...P(0, -0.235, tz(0.235))));
  m.add(ellipsoid(0.19 * k, 0.27 * k, 0.125 * k, { segments: 12, rings: 8, uv: uv.suit }).translate(...P(0, -0.44, tz(0.44))));
  m.add(ellipsoid(0.185 * k, 0.12 * k, 0.16 * k, { segments: 12, rings: 6, uv: uv.suit }).translate(...P(0, -0.66, tz(0.66) - 0.04)));
  // harness
  for (const sx of [-1, 1]) m.add(tube(P(sx * 0.085, -0.19, tz(0.19) - 0.085), P(sx * 0.07, -0.56, tz(0.56) - 0.12), 0.018 * k, 0.018 * k, { segments: 5, uv: uv.dark, caps: false }));
  // arms
  const hipZ = tz(0.66);
  const hands = { side: [0.3, -0.5, -0.3], centre: [0.04, -0.52, -0.38], yoke: [0.16, -0.36, -0.52] };
  const rh = Array.isArray(o.stick) ? o.stick : hands[o.stick || 'centre'], lh = o.throttle || (o.stick === 'yoke' ? [-0.16, -0.36, -0.52] : [-0.3, -0.5, -0.36]);
  for (const [sx, hand] of [[1, rh], [-1, lh]]) {
    const sh = P(sx * 0.215, -0.245, tz(0.245)), el = P(sx * 0.27, -0.47, tz(0.47) - 0.1), hd = P(hand[0], hand[1], hand[2]);
    m.add(tube(sh, el, 0.05 * k, 0.042 * k, { segments: 7, uv: uv.suit }));
    m.add(tube(el, hd, 0.042 * k, 0.034 * k, { segments: 7, uv: uv.suit }));
    m.add(ellipsoid(0.04 * k, 0.04 * k, 0.05 * k, { segments: 7, rings: 4, uv: uv.glove || uv.dark }).translate(...hd));
  }
  // legs
  for (const sx of [-1, 1]) {
    const hip = P(sx * 0.1, -0.68, hipZ - 0.04), knee = P(sx * 0.15, -0.58, hipZ - 0.5), foot = P(sx * 0.15, -0.93, hipZ - 0.82);
    m.add(tube(hip, knee, 0.075 * k, 0.06 * k, { segments: 8, uv: uv.suit }));
    m.add(tube(knee, foot, 0.058 * k, 0.045 * k, { segments: 8, uv: uv.suit }));
    m.add(box(0.09 * k, 0.07 * k, 0.24 * k, uv.dark).translate(foot[0], foot[1] - 0.02 * k, foot[2] - 0.08 * k));
  }
  return m;
}

/** Ejection seat behind / under the pilot. opts: { eye, recline = 15 (deg), uv: { frame, cushion, accent }, width = .46 } */
export function ejectionSeat(o) {
  const e = o.eye, uv = o.uv, w = o.width ?? 0.46, rc = (o.recline ?? 15) * Math.PI / 180, m = new Mesh();
  const back = new Mesh();
  back.add(box(w, 1.02, 0.09, uv.frame).translate(0, 0.51, 0.06));                 // seat back, origin at its base
  back.add(box(w * 0.8, 0.62, 0.05, uv.cushion).translate(0, 0.42, 0));
  back.add(box(w * 0.62, 0.24, 0.13, uv.cushion).translate(0, 0.98, 0.0));         // headrest
  for (const sx of [-1, 1]) {
    back.add(box(0.035, 1.18, 0.07, uv.frame).translate(sx * (w / 2 + 0.01), 0.59, 0.1));   // rails
    back.add(box(0.03, 0.14, 0.09, uv.frame).translate(sx * w * 0.36, 1.16, 0.06));         // canopy breakers
  }
  back.rotateX(rc).translate(e[0], e[1] - 0.86, e[2] + 0.2);
  m.add(back);
  m.add(box(w, 0.12, 0.46, uv.frame).translate(e[0], e[1] - 0.84, e[2] - 0.04));
  m.add(box(w * 0.86, 0.05, 0.42, uv.cushion).translate(e[0], e[1] - 0.77, e[2] - 0.05));
  if (uv.accent) m.add(tube([e[0] - 0.07, e[1] - 0.74, e[2] - 0.27], [e[0] + 0.07, e[1] - 0.74, e[2] - 0.27], 0.014, 0.014, { segments: 6, uv: uv.accent }));
  return m;
}

/** Airline crew seat. opts: { eye, uv: { frame, cushion } } */
export function crewSeat(o) {
  const e = o.eye, uv = o.uv, m = new Mesh();
  m.add(box(0.5, 0.11, 0.48, uv.cushion).translate(e[0], e[1] - 0.8, e[2] + 0.02));
  m.add(box(0.48, 0.74, 0.1, uv.cushion).rotateX(0.14).translate(e[0], e[1] - 0.42, e[2] + 0.3));
  m.add(box(0.26, 0.2, 0.09, uv.cushion).translate(e[0], e[1] + 0.03, e[2] + 0.33));
  for (const sx of [-1, 1]) m.add(box(0.06, 0.05, 0.36, uv.frame).translate(e[0] + sx * 0.29, e[1] - 0.6, e[2] + 0.06));
  m.add(box(0.36, 0.34, 0.36, uv.frame).translate(e[0], e[1] - 1.02, e[2] + 0.05));
  return m;
}

/**
 * Head-up display: returns { glass, frame }. The combiner is a tilted plate centred on the pilot's forward sight line.
 * opts: { eye, dist = .62 (ahead of the eye), width = .17, height = .15, drop = .03, uv }
 */
export function hud(o) {
  const e = o.eye, dist = o.dist ?? 0.62, w = o.width ?? 0.17, h = o.height ?? 0.15, uv = o.uv, y = e[1] - (o.drop ?? 0.03), z = e[2] - dist;
  const glass = box(w, h, 0.006, [0, 0]).rotateX(-0.42).translate(e[0], y, z);
  const frame = new Mesh();
  for (const sx of [-1, 1]) frame.add(box(0.012, h * 1.05, 0.014, uv).rotateX(-0.42).translate(e[0] + sx * (w / 2 + 0.006), y, z));
  frame.add(box(w * 1.5, 0.09, 0.2, uv).translate(e[0], y - h / 2 - 0.06, z - 0.02));
  frame.add(lathe([[0.03, -0.03], [0.045, 0], [0.045, 0.02], [0, 0.02]], { segments: 10, uv }).rotateX(-Math.PI / 2).translate(e[0], y - h / 2 - 0.015, z + 0.02));
  return { glass, frame };
}

/** Control stick: opts { base: [x, y, z], height = .22, uv, uvGrip } */
export function stick(o) {
  const b = o.base, h = o.height ?? 0.22, m = new Mesh();
  m.add(tube(b, add3(b, [0, h * 0.6, 0]), 0.012, 0.012, { segments: 6, uv: o.uv }));
  m.add(tube(add3(b, [0, h * 0.55, 0]), add3(b, [0, h, -0.02]), 0.02, 0.024, { segments: 8, uv: o.uvGrip || o.uv }));
  return m;
}

/** Control yoke on a column: opts { base: [x, y, z] (floor), top: [x, y, z] (wheel centre), width = .34, uv } */
export function yoke(o) {
  const t = o.top, w = (o.width ?? 0.34) / 2, m = new Mesh(), uv = o.uv;
  m.add(tube(o.base, t, 0.025, 0.02, { segments: 8, uv }));
  m.add(tube([t[0] - w, t[1], t[2]], [t[0] + w, t[1], t[2]], 0.014, 0.014, { segments: 6, uv }));
  for (const sx of [-1, 1]) { m.add(tube([t[0] + sx * w, t[1] - 0.02, t[2]], [t[0] + sx * w, t[1] + 0.11, t[2] + 0.01], 0.017, 0.017, { segments: 6, uv })); m.add(tube([t[0] + sx * w, t[1] + 0.11, t[2] + 0.01], [t[0] + sx * w * 0.6, t[1] + 0.12, t[2] + 0.01], 0.013, 0.013, { segments: 6, uv })); }
  return m;
}

/**
 * Open-topped cockpit tub: floor, side walls, rear bulkhead, front bulkhead. opts: { x: halfWidth, y0 (floor), y1 (sill),
 *   z0 (front), z1 (rear), uv, taper = 1 (front width factor) }. Faces point inward (visible from the seat and through the canopy).
 */
export function tub(o) {
  const { x, y0, y1, z0, z1, uv } = o, f = o.taper ?? 1, m = new Mesh(), xf = x * f;
  const quad = (a, b, c, d) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]; let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; n = n.map(q => q / l); const i = m.vertexCount; for (const p of [a, b, c, d]) m.vert(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]); m.quad(i, i + 1, i + 2, i + 3); };
  quad([-xf, y0, z0], [-x, y0, z1], [x, y0, z1], [xf, y0, z0]);                 // floor (faces up)
  quad([xf, y0, z0], [x, y0, z1], [x, y1, z1], [xf, y1, z0]);                   // right wall (faces -X)
  quad([-xf, y0, z0], [-xf, y1, z0], [-x, y1, z1], [-x, y0, z1]);               // left wall (faces +X)
  quad([-x, y0, z1], [-x, y1, z1], [x, y1, z1], [x, y0, z1]);                   // rear bulkhead (faces forward)
  quad([-xf, y0, z0], [xf, y0, z0], [xf, y1, z0], [-xf, y1, z0]);               // front bulkhead (faces aft)
  return m;
}

/**
 * Interior lining patch that follows the inside of a lofted body: a bilinear quad in (z, t) space, offset inward and
 * facing inward. Use several patches that share edges to line a flight deck around its (painted) windows, so the pilot's
 * view shows posts, sills and roof while the outside world stays visible through the gaps.
 * corners: [[z, t], [z, t], [z, t], [z, t]] in order around the patch; opts: { inset = .05, nu = 4, nv = 4, uv, mirror = false }
 * mirror: also emit the left-hand copy (t → 1 − t).
 */
export function liner(body, corners, o = {}) {
  const nu = o.nu ?? 4, nv = o.nv ?? 4, inset = o.inset ?? 0.05, uv = o.uv || [0, 0], m = new Mesh();
  const one = (flip) => {
    const i0 = m.vertexCount, pts = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv, c = corners;
      const z = (c[0][0] * (1 - u) + c[1][0] * u) * (1 - v) + (c[3][0] * (1 - u) + c[2][0] * u) * v;
      let t = (c[0][1] * (1 - u) + c[1][1] * u) * (1 - v) + (c[3][1] * (1 - u) + c[2][1] * u) * v;
      if (flip) t = 1 - t;
      const s = body.at(z, t), p = [s.p[0] - s.n[0] * inset, s.p[1] - s.n[1] * inset, s.p[2] - s.n[2] * inset];
      pts.push(p); m.vert(p[0], p[1], p[2], -s.n[0], -s.n[1], -s.n[2], uv[0], uv[1]);
    }
    // orient the faces inward whatever the corner order
    const a = pts[0], b = pts[1], d = pts[nu + 1], e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const inward = nx * m.n[i0 * 3] + ny * m.n[i0 * 3 + 1] + nz * m.n[i0 * 3 + 2] > 0;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const q = i0 + j * (nu + 1) + i;
      if (inward) m.quad(q, q + 1, q + nu + 2, q + nu + 1); else m.quad(q, q + nu + 1, q + nu + 2, q + 1);
    }
  };
  one(false); if (o.mirror) one(true);
  return m;
}

/**
 * Flat bulkhead filling a lofted body's cross-section at station z (cockpit door wall, pressure bulkhead, well end wall).
 * opts: { inset = .05, uv, facing = -1 (-1: faces the nose, +1: faces aft), n = 24 }
 */
export function bulkhead(body, z, o = {}) {
  const n = o.n ?? 24, inset = o.inset ?? 0.05, uv = o.uv || [0, 0], f = o.facing ?? -1, m = new Mesh();
  let cx = 0, cy = 0; const pts = [];
  for (let i = 0; i < n; i++) { const s = body.at(z, i / n); pts.push([s.p[0] - s.n[0] * inset, s.p[1] - s.n[1] * inset]); cx += pts[i][0] / n; cy += pts[i][1] / n; }
  const c = m.vert(cx, cy, z, 0, 0, f, uv[0], uv[1]);
  const ids = pts.map(p => m.vert(p[0], p[1], z, 0, 0, f, uv[0], uv[1]));
  // ring parameter t runs bottom → right (+X) → top → left: clockwise when seen from the nose
  for (let i = 0; i < n; i++) { const a = ids[i], b = ids[(i + 1) % n]; if (f < 0) m.tri(c, b, a); else m.tri(c, a, b); }
  return m;
}

/** Floor (or ceiling) panel inside a lofted body at height y between stations z0..z1, trimmed to the body width. opts: { inset = .05, uv, n = 6, up = true } */
export function deck(body, z0, z1, y, o = {}) {
  const n = o.n ?? 6, inset = o.inset ?? 0.05, uv = o.uv || [0, 0], up = o.up ?? true, m = new Mesh(), rows = [];
  for (let i = 0; i <= n; i++) {
    const z = z0 + (z1 - z0) * i / n, x = Math.max(0.02, body.at(z, body.tAtY(z, y)).p[0] - inset);
    rows.push([m.vert(-x, y, z, 0, up ? 1 : -1, 0, uv[0], uv[1]), m.vert(x, y, z, 0, up ? 1 : -1, 0, uv[0], uv[1])]);
  }
  for (let i = 0; i < n; i++) { const [a, b] = rows[i], [c, d] = rows[i + 1]; if (up) m.quad(a, c, d, b); else m.quad(a, b, d, c); }
  return m;
}
