// Static parked aircraft + ground vehicles (procedural, instanced). Generic silhouettes with fictional liveries.
// Model space: origin at the nose-wheel contact point, nose toward -Z, +X right wing, y up (aircraft body axes).
import * as THREE from 'three';
import { MultiBuilder, lin } from './builder.js';

const W = [1, 1, 1];

/** Lathe a fuselage along Z from a profile [[z, radius, yOffset]], seg sides. key 'b' body, colour per ring callback. */
function lathe(B, key, prof, seg, colFn, sx = 1) {
  for (let i = 0; i + 1 < prof.length; i++) {
    const [z0, r0, y0] = prof[i], [z1, r1, y1] = prof[i + 1];
    for (let s = 0; s < seg; s++) {
      const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
      const P = (z, r, y, a) => [Math.cos(a) * r * sx, y + Math.sin(a) * r, z];
      const dz = z1 - z0, dr = r1 - r0;
      const nl = Math.hypot(dz, dr) || 1;
      const n = [Math.cos(am) * dz / nl, Math.sin(am) * dz / nl, -dr / nl];
      const col = colFn ? colFn(i, Math.sin(am)) : W;
      B.quad(key, P(z0, r0, y0, a0), P(z0, r0, y0, a1), P(z1, r1, y1, a0), P(z1, r1, y1, a1), n, col, [0, 0, 1, 1]);
    }
  }
}

/** Flat lifting surface with thickness: root at (x0, y0, z0) chord c0, tip at span offset (dx, dy, dz) chord c1. */
function surface(B, key, root, rootChord, tip, tipChord, thick, col, vertical = false) {
  const [x0, y0, z0] = root, [x1, y1, z1] = tip;
  const t0 = thick, t1 = thick * 0.5;
  if (!vertical) {
    const A = [x0, y0 + t0, z0], Bp = [x0, y0 + t0, z0 + rootChord], Cp = [x1, y1 + t1, z1], D = [x1, y1 + t1, z1 + tipChord];
    const A2 = [x0, y0 - t0, z0], B2 = [x0, y0 - t0, z0 + rootChord], C2 = [x1, y1 - t1, z1], D2 = [x1, y1 - t1, z1 + tipChord];
    B.quad(key, A, Cp, Bp, D, [0, 1, 0], col, [0, 0, 1, 1]);
    B.quad(key, A2, C2, B2, D2, [0, -1, 0], col, [0, 0, 1, 1]);
    const ln = Math.sign(x1 - x0) || 1;
    B.quad(key, A2, C2, A, Cp, [0, 0, -1], col, [0, 0, 1, 1]);
    B.quad(key, B2, D2, Bp, D, [0, 0, 1], col, [0, 0, 1, 1]);
    B.quad(key, C2, D2, Cp, D, [ln, 0, 0], col, [0, 0, 1, 1]);
  } else {
    const A = [x0 + t0, y0, z0], Bp = [x0 + t0, y0, z0 + rootChord], Cp = [x1 + t1, y1, z1], D = [x1 + t1, y1, z1 + tipChord];
    const A2 = [x0 - t0, y0, z0], B2 = [x0 - t0, y0, z0 + rootChord], C2 = [x1 - t1, y1, z1], D2 = [x1 - t1, y1, z1 + tipChord];
    B.quad(key, A, Cp, Bp, D, [1, 0, 0], col, [0, 0, 1, 1]);
    B.quad(key, A2, C2, B2, D2, [-1, 0, 0], col, [0, 0, 1, 1]);
    B.quad(key, A2, C2, A, Cp, [0, 0, -1], col, [0, 0, 1, 1]);
    B.quad(key, B2, D2, Bp, D, [0, 0, 1], col, [0, 0, 1, 1]);
    B.quad(key, C2, D2, Cp, D, [0, 1, 0], col, [0, 0, 1, 1]);
  }
}

function cyl(B, key, x, y, z0, z1, r, seg, col) {
  for (let s = 0; s < seg; s++) {
    const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
    const P = (z, a) => [x + Math.cos(a) * r, y + Math.sin(a) * r, z];
    B.quad(key, P(z0, a0), P(z0, a1), P(z1, a0), P(z1, a1), [Math.cos(am), Math.sin(am), 0], col, [0, 0, 1, 1]);
  }
  // front disc (intake) dark
  for (let s = 0; s < seg; s++) {
    const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2;
    B.tri(key, [x, y, z0], [x + Math.cos(a0) * r, y + Math.sin(a0) * r, z0], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z0], [0, 0, -1], [0.04, 0.04, 0.05], [0, 0], [0, 0], [0, 0]);
  }
}

/** Narrow-body airliner (~38 m). Returns { body, accent } geometries (accent = tail + cheatline, tinted per instance). */
export function makeAirliner() {
  const B = new MultiBuilder();
  const grey = lin(0xb8bcc0), dark = lin(0x2a2d31), win = lin(0x1b2430);
  const R = 1.95, cy = 3.0;   // fuselage radius, centreline height
  // z from nose (-4.5 ahead of nose gear) to tail (+33)
  const prof = [[-4.6, 0.05, cy - 0.3], [-4.1, 0.9, cy - 0.2], [-3.2, 1.5, cy - 0.1], [-1.8, 1.85, cy], [0, R, cy], [22, R, cy], [26, 1.6, cy + 0.35], [30, 0.9, cy + 0.9], [33.2, 0.25, cy + 1.3]];
  lathe(B, 'b', prof, 12, (i, sn) => (i === 2 && sn > 0.2 && sn < 0.75 ? dark : sn > 0.3 && sn < 0.5 && i >= 4 && i <= 4 ? win : W));
  // cheatline (accent): thin band along the window line on both sides
  for (const sx of [-1, 1]) B.quad('a', [sx * (R + 0.02), cy + 0.25, -1.5], [sx * (R + 0.02), cy + 0.25, 22], [sx * (R + 0.02), cy + 0.6, -1.5], [sx * (R + 0.02), cy + 0.6, 22], [sx, 0, 0], W, [0, 0, 1, 1]);
  for (const sx of [-1, 1]) B.quad('b', [sx * (R + 0.03), cy + 0.68, -1.0], [sx * (R + 0.03), cy + 0.68, 21.5], [sx * (R + 0.03), cy + 0.9, -1.0], [sx * (R + 0.03), cy + 0.9, 21.5], [sx, 0, 0], win, [0, 0, 1, 1]);
  // wings: root at z 9..16, low on the fuselage, 25° sweep, dihedral
  for (const sx of [-1, 1]) {
    surface(B, 'b', [sx * 1.4, cy - 1.2, 8.5], 7.2, [sx * 17.2, cy - 0.1, 8.5 + 8.4], 1.5, 0.28, grey);
    // winglet
    surface(B, 'a', [sx * 17.1, cy - 0.1, 16.6], 1.4, [sx * 17.5, cy + 2.2, 18.0], 0.7, 0.08, W, true);
    // engine nacelle + pylon
    cyl(B, 'b', sx * 5.6, cy - 2.05, 6.0, 10.2, 0.95, 10, W);
    B.box('b', sx * 5.6, cy - 1.4, 9.8, 0, 3.4, 0.25, 0.8, grey);
  }
  // horizontal tail
  for (const sx of [-1, 1]) surface(B, 'b', [sx * 0.5, cy + 0.9, 28.2], 4.0, [sx * 7.0, cy + 1.4, 28.2 + 3.6], 1.4, 0.15, W);
  // vertical tail (accent)
  surface(B, 'a', [0, cy + 1.2, 25.0], 6.2, [0, cy + 8.6, 30.6], 2.2, 0.2, W, true);
  // gear
  B.box('b', 0, 0, 0, 0, 0.5, 0.35, cy - R + 0.3, dark);
  for (const sx of [-1, 1]) { B.box('b', sx * 2.9, 0, 15.0, 0, 1.3, 0.9, 1.1, dark); B.box('b', sx * 2.9, 0.9, 15.0, 0, 0.3, 0.3, cy - 1.8, dark); }
  return B.build();
}

export function makeFighter() {
  const B = new MultiBuilder();
  const g = lin(0x8e959c), dark = lin(0x30343a), canopy = lin(0x2b3c33);
  const cy = 1.7;
  lathe(B, 'b', [[-2.5, 0.05, cy], [-1.5, 0.45, cy], [0, 0.65, cy], [2, 0.8, cy + 0.1], [4, 0.95, cy + 0.1], [9, 0.95, cy + 0.1], [12.5, 0.6, cy + 0.1]], 10, () => W);
  B.box('b', 0, cy + 0.45, 1.6, 0, 2.6, 0.55, 0.45, canopy);
  for (const sx of [-1, 1]) {
    surface(B, 'b', [sx * 0.8, cy - 0.1, 4.0], 5.0, [sx * 4.7, cy - 0.1, 7.6], 1.3, 0.1, W);
    surface(B, 'b', [sx * 0.7, cy, 10.2], 2.2, [sx * 2.8, cy - 0.1, 11.8], 0.9, 0.06, W);
  }
  surface(B, 'b', [0, cy + 0.8, 8.8], 3.0, [0, cy + 3.6, 11.6], 1.2, 0.07, W, true);
  B.box('b', 0, cy - 1.0, 4.0, 0, 3.4, 1.2, 0.5, W); // intake
  B.box('b', 0, 0, 0, 0, 0.25, 0.2, cy - 0.6, dark);
  for (const sx of [-1, 1]) B.box('b', sx * 1.2, 0, 5.4, 0, 0.6, 0.3, 1.1, dark);
  const gm = B.build();
  // tint: whole body grey via instance colour
  void g;
  return gm;
}

export function makeLightPlane() {
  const B = new MultiBuilder();
  const dark = lin(0x222222), glass = lin(0x24323c);
  const cy = 1.25;
  lathe(B, 'b', [[-1.0, 0.1, cy], [-0.6, 0.45, cy], [0.5, 0.6, cy + 0.1], [2.2, 0.55, cy + 0.2], [6.5, 0.15, cy + 0.4]], 8, () => W);
  B.box('b', 0, cy + 0.2, 1.2, 0, 1.6, 1.05, 0.55, glass);
  for (const sx of [-1, 1]) surface(B, 'a', [sx * 0.4, cy + 0.85, 0.9], 1.5, [sx * 5.5, cy + 0.95, 1.0], 1.2, 0.06, W);
  for (const sx of [-1, 1]) surface(B, 'b', [sx * 0.2, cy + 0.35, 5.6], 1.0, [sx * 1.7, cy + 0.35, 5.8], 0.7, 0.04, W);
  surface(B, 'a', [0, cy + 0.4, 5.3], 1.3, [0, cy + 1.6, 6.1], 0.7, 0.04, W, true);
  B.box('b', 0, 0, 0, 0, 0.12, 0.12, cy - 0.5, dark);
  for (const sx of [-1, 1]) B.box('b', sx * 1.1, 0, 1.8, 0, 0.3, 0.1, 0.8, dark);
  return B.build();
}

/** Ground support vehicles (tug, belt loader, fuel truck, catering) as one geometry set; returns geometries. */
export function makeVehicles() {
  const out = {};
  const mk = (fn) => { const B = new MultiBuilder(); fn(B); return B.build().b; };
  const dark = lin(0x1d1d1d), glass = lin(0x28323a);
  out.tug = mk((B) => { B.box('b', 0, 0.3, 0, 0, 4.2, 2.1, 1.0, W); B.box('b', 0.8, 1.3, 0, 0, 1.4, 1.9, 0.9, glass); for (const sz of [-1.4, 1.4]) for (const sx of [-1, 1]) B.box('b', sx * 1.0, 0, sz, 0, 0.7, 0.3, 0.7, dark); });
  out.belt = mk((B) => { B.box('b', 0, 0.3, 0, 0, 6.5, 1.8, 0.7, W); B.box('b', -2.4, 1.0, 0, 0, 1.4, 1.6, 1.1, glass); B.beam('b', [0, 1.1, -1.5], [0, 3.2, 3.6], 0.9, dark); for (const sz of [-2.2, 2.2]) for (const sx of [-1, 1]) B.box('b', sx * 0.9, 0, sz, 0, 0.6, 0.25, 0.6, dark); });
  out.fuel = mk((B) => { B.box('b', 0, 0.4, -3.3, 0, 2.2, 2.4, 2.0, W); B.box('b', 0, 1.1, -3.6, 0, 1.0, 2.2, 1.0, glass); B.cylinder('b', 0, 0.6, 1.2, 1.15, 0.01, 6, W); B.box('b', 0, 0.6, 1.2, 0, 7, 2.4, 2.2, W); for (const sz of [-3.3, 0.5, 3.0]) for (const sx of [-1, 1]) B.box('b', sx * 1.0, 0, sz, 0, 1.0, 0.35, 1.0, dark); });
  out.cart = mk((B) => { B.box('b', 0, 0.35, 0, 0, 3.0, 1.6, 1.4, W); for (const sz of [-1, 1]) for (const sx of [-1, 1]) B.box('b', sx * 0.7, 0, sz, 0, 0.4, 0.2, 0.4, dark); });
  return out;
}

/** Instanced placement helper: list of { x, z, hdg (deg, nose direction), color, scale } → InstancedMesh. */
export function instances(geo, mat, list) {
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
  list.forEach((o, i) => {
    q.setFromAxisAngle(up, -o.hdg * Math.PI / 180);
    m4.compose(p.set(o.x, o.y || 0, o.z), q, s.setScalar(o.scale || 1));
    m.setMatrixAt(i, m4);
    m.setColorAt(i, c.set(o.color ?? 0xffffff));
  });
  m.castShadow = true; m.receiveShadow = true;
  m.computeBoundingSphere();
  return m;
}
