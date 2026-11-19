// Static parked aircraft + ground support equipment (procedural, instanced). Real-type proportions, fictional liveries.
// Model space: origin at the nose-wheel contact point, nose toward -Z, +X right wing, y up (aircraft body axes).
//
// Aircraft geometries carry two livery weights per vertex (attribute aAcc: x = primary colour, y = secondary colour).
// The primary colour comes from the per-instance colour, the secondary from a per-instance attribute aLiv2, so one
// draw call renders every airline's tails, cheatlines and engine cowls (see makeParkedMaterial / aircraftInstances).
import * as THREE from 'three';
import { MultiBuilder, lin } from './builder.js';

const W = [1, 1, 1];
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------------------------------------------------
/** Minimal builder with the livery-weight attribute. */
class PB {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.acc = []; this.idx = []; }
  _v(p, n, c, a) { this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.col.push(c[0], c[1], c[2]); this.acc.push(a[0], a[1]); }
  quad(a, b, c, d, n, col, acc = [0, 0], nb, nc, nd) {
    const base = this.pos.length / 3;
    this._v(a, n, col, acc); this._v(b, nb || n, col, acc); this._v(c, nc || n, col, acc); this._v(d, nd || n, col, acc);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) this.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    else this.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  tri(a, b, c, n, col, acc = [0, 0]) {
    const base = this.pos.length / 3;
    this._v(a, n, col, acc); this._v(b, n, col, acc); this._v(c, n, col, acc);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) this.idx.push(base, base + 1, base + 2); else this.idx.push(base, base + 2, base + 1);
  }
  box(cx, y0, cz, lx, ly, lz, col, acc) {
    const x0 = cx - lx / 2, x1 = cx + lx / 2, z0 = cz - lz / 2, z1 = cz + lz / 2, y1 = y0 + ly;
    this.quad([x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1], [0, 0, 1], col, acc);
    this.quad([x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], col, acc);
    this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], col, acc);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z0], [x0, y1, z1], [-1, 0, 0], col, acc);
    this.quad([x0, y1, z0], [x1, y1, z0], [x0, y1, z1], [x1, y1, z1], [0, 1, 0], col, acc);
  }
  /**
   * Body of revolution along Z with smooth normals. prof = [[z, r, yc, sx?]] (sx = horizontal squash).
   * paint(i, a) → { col, acc } per ring segment i and angle a (0 = right, π/2 = top).
   */
  lathe(prof, seg, paint, ox = 0) {
    for (let i = 0; i + 1 < prof.length; i++) {
      const [z0, r0, y0, s0 = 1] = prof[i], [z1, r1, y1, s1 = 1] = prof[i + 1];
      const dz = z1 - z0, dr = r1 - r0, nl = Math.hypot(dz, dr) || 1;
      for (let s = 0; s < seg; s++) {
        const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2;
        const P = (z, r, y, sx, a) => [ox + Math.cos(a) * r * sx, y + Math.sin(a) * r, z];
        const N = (a) => [Math.cos(a) * dz / nl, Math.sin(a) * dz / nl, -dr / nl];
        const { col, acc } = paint(i, (a0 + a1) / 2);
        this.quad(P(z0, r0, y0, s0, a0), P(z0, r0, y0, s0, a1), P(z1, r1, y1, s1, a0), P(z1, r1, y1, s1, a1), N(a0), col, acc, N(a1), N(a0), N(a1));
      }
    }
  }
  /** Lifting surface with thickness. root/tip = leading-edge points; horizontal (span in x) or vertical (span in y). */
  wing(root, rootChord, tip, tipChord, thick, col, acc, vertical = false) {
    const [x0, y0, z0] = root, [x1, y1, z1] = tip, t0 = thick, t1 = thick * 0.45;
    const o = vertical ? (p, t) => [p[0] + t, p[1], p[2]] : (p, t) => [p[0], p[1] + t, p[2]];
    const r0 = [x0, y0, z0], r1 = [x0, y0, z0 + rootChord], q0 = [x1, y1, z1], q1 = [x1, y1, z1 + tipChord];
    const up = vertical ? [1, 0, 0] : [0, 1, 0], dn = vertical ? [-1, 0, 0] : [0, -1, 0];
    // upper / lower skins (leading half thicker than the trailing edge)
    const m0 = [x0, y0, z0 + rootChord * 0.3], m1 = [x1, y1, z1 + tipChord * 0.3];
    this.quad(o(r0, 0), o(q0, 0), o(m0, t0), o(m1, t1), up, col, acc);
    this.quad(o(m0, t0), o(m1, t1), o(r1, 0), o(q1, 0), up, col, acc);
    this.quad(o(r0, 0), o(q0, 0), o(m0, -t0 * 0.6), o(m1, -t1 * 0.6), dn, col, acc);
    this.quad(o(m0, -t0 * 0.6), o(m1, -t1 * 0.6), o(r1, 0), o(q1, 0), dn, col, acc);
    const side = vertical ? [0, 1, 0] : [Math.sign(x1 - x0) || 1, 0, 0];
    this.quad(o(q0, 0), o(q1, 0), o(m1, t1), o(m1, -t1 * 0.6), side, col, acc);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aAcc', new THREE.Float32BufferAttribute(this.acc, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const COL = {
  white: lin(0xf2f2f0), belly: lin(0xb9bdc1), wing: lin(0xb4b8bc), dark: lin(0x1e2125), tyre: lin(0x101010),
  win: lin(0x15191e), metal: lin(0x8a8f95), intake: lin(0x2a2d31), fan: lin(0x45484c), black: lin(0x0b0b0b),
  milGrey: lin(0x7d858c), milGreyD: lin(0x5f676e), canopy: lin(0x2c3a33), red: lin(0xa01818),
};
const A1 = [1, 0], A2 = [0, 1], A0 = [0, 0];

/** Turbofan nacelle along Z centred at (x, y), intake at z0. acc = livery weights of the cowl. */
function nacelle(B, x, y, z0, len, r, acc) {
  B.lathe([[z0, r * 0.92, y], [z0 + 0.12 * len, r, y], [z0 + 0.55 * len, r * 0.98, y], [z0 + 0.88 * len, r * 0.78, y], [z0 + len, r * 0.55, y]], 14,
    (i) => ({ col: i >= 3 ? COL.metal : COL.white, acc: i >= 3 ? A0 : acc }), x);
  // dark intake + fan face
  for (let s = 0; s < 14; s++) {
    const a0 = (s / 14) * Math.PI * 2, a1 = ((s + 1) / 14) * Math.PI * 2;
    B.tri([x, y, z0 + 0.25], [x + Math.cos(a0) * r * 0.92, y + Math.sin(a0) * r * 0.92, z0], [x + Math.cos(a1) * r * 0.92, y + Math.sin(a1) * r * 0.92, z0], [0, 0, -1], COL.fan);
  }
}

function gearLeg(B, x, z, h, wheels, wr = 0.55, spread = 0.9) {
  B.box(x, wr, z, 0.28, h - wr, 0.28, COL.dark);
  for (const [dx, dz] of wheels) B.box(x + dx * spread, 0, z + dz, 0.38, wr * 2, wr * 2, COL.tyre);
}

/**
 * Swept-wing jet airliner / transport. p: { len, R, cy, noseAft, span, rootChord, tipChord, sweep, wingZ, wingY,
 * dihedral, eng: [[x, len, r, zFront]], finH, finChord, finTip, stabSpan, mainZ, mainX, mainWheels, mil, winglet }
 */
function makeJet(p) {
  const B = new PB();
  const { len, R, cy } = p;
  const body = p.mil ? COL.milGrey : COL.white, belly = p.mil ? COL.milGrey : COL.belly, wingC = p.mil ? COL.milGreyD : COL.wing;
  const n0 = -p.noseAft;                       // nose tip z
  const tail = n0 + len;
  const prof = [
    [n0, 0.08, cy - 0.32 * R], [n0 + 0.12 * R, 0.42 * R, cy - 0.24 * R], [n0 + 0.35 * R, 0.66 * R, cy - 0.15 * R],
    [n0 + 0.75 * R, 0.85 * R, cy - 0.07 * R], [n0 + 1.3 * R, 0.96 * R, cy - 0.02 * R], [n0 + 2.1 * R, R, cy],
    [tail - 5.2 * R, R, cy], [tail - 3.6 * R, 0.86 * R, cy + 0.14 * R], [tail - 2.1 * R, 0.58 * R, cy + 0.38 * R],
    [tail - 0.8 * R, 0.3 * R, cy + 0.58 * R], [tail, 0.1 * R, cy + 0.66 * R],
  ];
  B.lathe(prof, 16, (i, a) => {
    const sn = Math.sin(a), cs = Math.cos(a);
    if (i === 2 && sn > 0.32 && sn < 0.66 && Math.abs(cs) > 0.1) return { col: COL.win, acc: A0 };   // flight-deck windows
    if (sn < -0.42) return { col: belly, acc: p.mil ? A0 : A2 };                                     // belly in the secondary colour
    if (!p.mil && i >= 7 && sn > 0.55) return { col: body, acc: A1 };                                  // tail colour sweeps onto the rear crown
    return { col: body, acc: A0 };
  });
  // cheatline + passenger windows (continuous dark band; doors read at distance as breaks)
  if (!p.mil) {
    const zA = n0 + 2.3 * R, zB = tail - 5.6 * R, yw = cy + 0.32 * R;
    for (const sx of [-1, 1]) {
      const x = sx * (R * 0.955 + 0.02);
      const nx = [sx, 0, 0];
      const segs = [[zA, zA + 0.22 * len], [zA + 0.22 * len + 1.2, zB - 0.25 * len], [zB - 0.25 * len + 1.2, zB]];
      for (const [a, b] of segs) B.quad([x, yw - 0.13 * R, a], [x, yw - 0.13 * R, b], [x, yw + 0.06 * R, a], [x, yw + 0.06 * R, b], nx, COL.win);
      B.quad([x, yw - 0.36 * R, zA - 1], [x, yw - 0.36 * R, zB + 2], [x, yw - 0.22 * R, zA - 1], [x, yw - 0.22 * R, zB + 2], nx, COL.white, A2);
    }
  }
  // wings: low-mounted, swept, with dihedral; flap-track fairings underneath
  const sw = Math.tan(p.sweep * DEG);
  for (const sx of [-1, 1]) {
    const rx = sx * R * 0.7, tx = sx * p.span / 2;
    const ty = p.wingY + (p.span / 2) * Math.tan(p.dihedral * DEG);
    B.wing([rx, p.wingY, p.wingZ], p.rootChord, [tx, ty, p.wingZ + (p.span / 2 - R * 0.7) * sw], p.tipChord, p.rootChord * 0.06, wingC, A0);
    if (p.winglet) B.wing([tx, ty, p.wingZ + (p.span / 2 - R * 0.7) * sw + 0.1], p.tipChord * 0.9, [tx + sx * 0.4, ty + p.winglet, p.wingZ + (p.span / 2 - R * 0.7) * sw + p.tipChord * 0.7], p.tipChord * 0.45, 0.06, body, p.mil ? A0 : A1, true);
    // belly fairing (wing-body) as a flattened box
    for (const f of [0.3, 0.55, 0.78]) {
      const fx = sx * (R * 0.7 + (p.span / 2 - R * 0.7) * f * 0.75), fz = p.wingZ + (fx * sx - R * 0.7) * sw + p.rootChord * (0.85 - 0.45 * f);
      B.box(fx, p.wingY + (fx * sx) * Math.tan(p.dihedral * DEG) - 0.35, fz, 0.3, 0.35, 2.4 * R / 2, wingC);
    }
  }
  B.box(0, cy - R * 0.98, p.wingZ + p.rootChord * 0.45, R * 1.5, R * 0.35, p.rootChord * 1.1, belly);
  // engines + pylons
  for (const [ex, el, er, ez] of p.eng) for (const sx of [-1, 1]) {
    const x = sx * ex, wy = p.wingY + ex * Math.tan(p.dihedral * DEG);
    const y = wy - er * 1.15 - (p.engDrop || 0);
    nacelle(B, x, y, ez + (ex - R * 0.7) * sw, el, er, p.mil ? A0 : (p.engLivery ? A1 : A0));
    B.box(x, y + er * 0.6, ez + (ex - R * 0.7) * sw + el * 0.55, 0.28, wy - y - er * 0.4, el * 0.8, wingC);
  }
  // horizontal tail (swept, dihedral) and fin in the primary livery colour
  const zT = tail - 4.3 * R;
  for (const sx of [-1, 1]) B.wing([sx * 0.4 * R, cy + 0.42 * R, zT], p.finChord * 0.75, [sx * p.stabSpan / 2, cy + 0.42 * R + p.stabSpan * 0.06, zT + p.stabSpan / 2 * 0.65], p.finChord * 0.3, 0.12, wingC, A0);
  B.wing([0, cy + 0.55 * R, tail - 5.6 * R], p.finChord, [0, cy + 0.55 * R + p.finH, tail - 5.6 * R + p.finH * 0.85], p.finTip, 0.16 * R / 2, body, p.mil ? A0 : A1, true);
  // landing gear: nose leg + main bogies
  gearLeg(B, 0, 0, cy - R * 0.9, [[-0.5, 0], [0.5, 0]], p.noseWr || 0.42, 0.35);
  for (const sx of [-1, 1]) gearLeg(B, sx * p.mainX, p.mainZ, cy - R * 0.6, p.mainWheels, p.mainWr || 0.6, 0.55);
  if (p.boom) { // tanker refuelling boom under the tail
    const g = B; g.box(0, cy - 0.9 * R, tail - 2.5 * R - 3, 0.35, 0.35, 7, COL.metal);
  }
  return B.build();
}

const NARROW = { len: 38, R: 1.95, cy: 3.05, noseAft: 4.4, span: 34.3, rootChord: 7.0, tipChord: 1.6, sweep: 26, wingZ: 9.2, wingY: 1.9, dihedral: 5.5,
  eng: [[5.8, 4.2, 0.98, 5.6]], finH: 7.2, finChord: 6.0, finTip: 2.0, stabSpan: 14.2, mainZ: 15.4, mainX: 2.85, mainWheels: [[-1, 0], [1, 0]], winglet: 2.2, engLivery: true };
const WIDE = { len: 64, R: 3.1, cy: 4.75, noseAft: 6.5, span: 61, rootChord: 12.5, tipChord: 2.4, sweep: 31, wingZ: 21.5, wingY: 2.7, dihedral: 6,
  eng: [[9.8, 7.2, 1.75, 16.8]], finH: 11.5, finChord: 10, finTip: 3.4, stabSpan: 21, mainZ: 32, mainX: 5.5, mainWheels: [[-1, -1.4], [1, -1.4], [-1, 0], [1, 0], [-1, 1.4], [1, 1.4]], mainWr: 0.68, noseWr: 0.6, engLivery: false, engDrop: 0.2 };
const TANKER = { len: 41.5, R: 1.85, cy: 3.6, noseAft: 4.0, span: 39.9, rootChord: 7.6, tipChord: 2.0, sweep: 35, wingZ: 10.5, wingY: 2.6, dihedral: 6.5,
  eng: [[7.3, 4.5, 0.95, 8.2], [12.8, 4.5, 0.95, 9.0]], finH: 8.5, finChord: 6.2, finTip: 2.0, stabSpan: 13.4, mainZ: 17.0, mainX: 3.4, mainWheels: [[-1, -0.7], [1, -0.7], [-1, 0.7], [1, 0.7]], mil: true, boom: true, engDrop: 0.5 };

export function makeAirliner() { return makeJet(NARROW); }
export function makeWidebody() { return makeJet(WIDE); }
export function makeTanker() { return makeJet(TANKER); }

/** High-wing twin turboprop (ATR 72 class): T-tail, propeller discs, livery on the fin and engine cowls. */
export function makeTurboprop() {
  const B = new PB();
  const R = 1.4, cy = 2.05, n0 = -2.6, tail = n0 + 27.2;
  const prof = [[n0, 0.06, cy - 0.35], [n0 + 0.3, 0.6, cy - 0.25], [n0 + 1.0, 1.05, cy - 0.12], [n0 + 2.0, 1.32, cy - 0.03], [n0 + 3.2, R, cy],
    [tail - 7.5, R, cy], [tail - 4.8, 1.05, cy + 0.3], [tail - 2.2, 0.55, cy + 0.75], [tail, 0.15, cy + 0.95]];
  B.lathe(prof, 14, (i, a) => {
    const sn = Math.sin(a), cs = Math.cos(a);
    if (i === 1 && sn > 0.1 && sn < 0.8 && Math.abs(cs) > 0.1) return { col: COL.win, acc: A0 };
    if (sn < -0.45) return { col: COL.belly, acc: A2 };
    return { col: COL.white, acc: A0 };
  });
  for (const sx of [-1, 1]) {
    const x = sx * (R * 0.955 + 0.02), yw = cy + 0.35;
    B.quad([x, yw - 0.18, n0 + 4], [x, yw - 0.18, tail - 8], [x, yw + 0.08, n0 + 4], [x, yw + 0.08, tail - 8], [sx, 0, 0], COL.win);
    B.quad([x, yw - 0.5, n0 + 3], [x, yw - 0.5, tail - 6], [x, yw - 0.32, n0 + 3], [x, yw - 0.32, tail - 6], [sx, 0, 0], COL.white, A2);
  }
  const wy = cy + R * 0.95;
  for (const sx of [-1, 1]) {
    B.wing([sx * 0.6, wy, 8.0], 2.6, [sx * 13.5, wy - 0.25, 8.4], 1.4, 0.16, COL.wing, A0);
    // nacelle + prop disc
    const x = sx * 4.1;
    B.lathe([[5.6, 0.25, wy - 0.4], [6.0, 0.55, wy - 0.4], [7.5, 0.62, wy - 0.35], [10.5, 0.45, wy - 0.2], [11.6, 0.2, wy - 0.15]], 10, () => ({ col: COL.white, acc: A1 }), x);
    for (let s = 0; s < 12; s++) {
      const a0 = (s / 12) * Math.PI * 2, a1 = ((s + 1) / 12) * Math.PI * 2, rp = 1.95;
      B.tri([x, wy - 0.4, 5.5], [x + Math.cos(a0) * rp, wy - 0.4 + Math.sin(a0) * rp, 5.5], [x + Math.cos(a1) * rp, wy - 0.4 + Math.sin(a1) * rp, 5.5], [0, 0, -1], [0.05, 0.05, 0.05]);
    }
    // main gear sponson
    B.box(sx * 1.45, 0.5, 11.2, 0.8, 1.2, 3.2, COL.belly);
    gearLeg(B, sx * 1.6, 11.2, 1.0, [[-0.3, 0], [0.3, 0]], 0.45, 0.4);
  }
  B.wing([0, cy + 0.6, tail - 6.0], 4.0, [0, cy + 5.1, tail - 2.6], 2.4, 0.13, COL.white, A1, true);
  for (const sx of [-1, 1]) B.wing([0, cy + 5.0, tail - 2.9], 2.2, [sx * 3.9, cy + 5.1, tail - 1.9], 1.2, 0.08, COL.white, A1);
  gearLeg(B, 0, 0, cy - R * 0.85, [[-0.3, 0], [0.3, 0]], 0.33, 0.3);
  return B.build();
}

/** F-16-class single-engine fighter: blended body, LERX, cropped-delta wing, all-moving tails, ventral intake. */
export function makeFighter() {
  const B = new PB();
  const g = COL.milGrey, gd = COL.milGreyD, cy = 1.75;
  B.lathe([[-2.8, 0.04, cy + 0.05, 1], [-2.2, 0.28, cy + 0.05, 1], [-1.2, 0.5, cy + 0.08, 1.05], [0.2, 0.66, cy + 0.12, 1.15], [2.2, 0.82, cy + 0.12, 1.3],
    [5.0, 0.92, cy + 0.08, 1.45], [8.5, 0.9, cy + 0.05, 1.35], [10.8, 0.66, cy + 0.05, 1.05], [12.2, 0.48, cy + 0.05, 1]], 12, (i, a) => ({ col: Math.sin(a) < -0.3 ? gd : g, acc: A0 }));
  // canopy bubble
  B.lathe([[-0.8, 0.05, cy + 0.55, 1], [-0.2, 0.36, cy + 0.6, 1], [1.0, 0.45, cy + 0.66, 1], [2.4, 0.38, cy + 0.62, 1], [3.4, 0.08, cy + 0.6, 1]], 10, (i, a) => ({ col: Math.sin(a) > 0 ? COL.canopy : g, acc: A0 }));
  // ventral intake
  B.box(0, cy - 1.0, 2.2, 1.0, 0.75, 3.6, g);
  B.box(0, cy - 0.98, 0.42, 0.9, 0.62, 0.05, COL.black);
  for (const sx of [-1, 1]) {
    B.wing([sx * 0.5, cy, 0.8], 4.2, [sx * 1.2, cy, 3.8], 1.6, 0.06, g, A0);                 // LERX
    B.wing([sx * 1.1, cy - 0.02, 4.0], 4.3, [sx * 4.7, cy - 0.02, 7.6], 1.1, 0.1, g, A0);   // wing
    B.box(sx * 4.75, cy - 0.12, 7.2, 0.12, 0.12, 2.6, gd);                                    // wingtip rail
    B.wing([sx * 0.8, cy - 0.05, 9.6], 2.6, [sx * 2.8, cy - 0.32, 11.3], 1.0, 0.06, g, A0);  // stabilator (anhedral)
    B.wing([sx * 0.5, cy - 0.7, 9.0], 1.4, [sx * 0.9, cy - 1.15, 9.8], 0.8, 0.04, gd, A0, true); // ventral fin
  }
  B.wing([0, cy + 0.65, 8.0], 3.4, [0, cy + 3.6, 10.8], 1.25, 0.08, g, A0, true);
  B.lathe([[11.7, 0.5, cy + 0.05], [12.4, 0.42, cy + 0.05], [12.9, 0.36, cy + 0.05]], 10, () => ({ col: COL.metal, acc: A0 }));
  gearLeg(B, 0, 0, cy - 0.5, [[0, 0]], 0.28, 0.0);
  for (const sx of [-1, 1]) gearLeg(B, sx * 1.15, 4.0, cy - 0.6, [[0, 0]], 0.36, 0.0);
  return B.build();
}

/** High-wing single-engine light aircraft (C172 class). */
export function makeLightPlane() {
  const B = new PB();
  const cy = 1.25;
  B.lathe([[-1.0, 0.12, cy], [-0.6, 0.45, cy], [0.5, 0.6, cy + 0.1], [2.2, 0.55, cy + 0.2], [6.5, 0.15, cy + 0.4]], 10, (i, a) => ({ col: i === 1 && Math.sin(a) > 0.2 ? COL.win : COL.white, acc: i >= 2 && Math.abs(Math.sin(a)) < 0.25 ? A1 : A0 }));
  B.box(0, cy + 0.2, 1.2, 1.05, 0.55, 1.6, COL.win);
  for (const sx of [-1, 1]) B.wing([sx * 0.4, cy + 0.85, 0.9], 1.5, [sx * 5.5, cy + 0.95, 1.0], 1.2, 0.07, COL.white, A0);
  for (const sx of [-1, 1]) B.wing([sx * 0.2, cy + 0.35, 5.6], 1.0, [sx * 1.7, cy + 0.35, 5.8], 0.7, 0.04, COL.white, A0);
  B.wing([0, cy + 0.4, 5.3], 1.3, [0, cy + 1.6, 6.1], 0.7, 0.05, COL.white, A1, true);
  for (let s = 0; s < 8; s++) { const a0 = s / 8 * 6.283, a1 = (s + 1) / 8 * 6.283; B.tri([0, cy, -1.05], [Math.cos(a0) * 0.9, cy + Math.sin(a0) * 0.9, -1.05], [Math.cos(a1) * 0.9, cy + Math.sin(a1) * 0.9, -1.05], [0, 0, -1], [0.06, 0.06, 0.06]); }
  gearLeg(B, 0, 0, cy - 0.45, [[0, 0]], 0.18, 0);
  for (const sx of [-1, 1]) gearLeg(B, sx * 1.1, 1.8, 0.7, [[0, 0]], 0.22, 0);
  return B.build();
}

/** MeshStandardMaterial with the two-colour livery blend (instance colour + aLiv2). */
export function makeParkedMaterial(opts) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, ...opts });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aAcc; attribute vec3 aLiv2;')
      .replace('#include <color_vertex>', `
        vColor = vec4(1.0); vColor.rgb *= color.rgb;
        #ifdef USE_INSTANCING_COLOR
        vColor.xyz = mix(vColor.xyz, instanceColor.xyz, aAcc.x);
        #endif
        vColor.xyz = mix(vColor.xyz, aLiv2, aAcc.y);`);
  };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => (key ? key() : '') + 'livery';
  return m;
}

/** Instanced aircraft: list of { x, z, hdg, color (primary), color2, scale }. Geometry attributes are shared. */
export function aircraftInstances(geo, mat, list) {
  const g = new THREE.BufferGeometry();
  for (const k of Object.keys(geo.attributes)) g.setAttribute(k, geo.attributes[k]);
  g.setIndex(geo.index); g.boundingSphere = geo.boundingSphere;
  const c2 = new Float32Array(list.length * 3), c = new THREE.Color();
  list.forEach((o, i) => { c.set(o.color2 ?? 0xb9bdc1); c2.set([c.r, c.g, c.b], i * 3); });
  g.setAttribute('aLiv2', new THREE.InstancedBufferAttribute(c2, 3));
  return instances(g, mat, list);
}

// ---------------------------------------------------------------------------------------------------------------------
/** Ground support equipment: geometries keyed by type (vertex-coloured; instance colour tints the white parts). */
export function makeVehicles() {
  const out = {};
  const mk = (fn) => { const B = new MultiBuilder(); fn(B); return B.build().b; };
  const dark = lin(0x1d1d1d), glass = lin(0x28323a), grey = lin(0x6f7378), steel = lin(0x9aa0a6), orange = lin(0xe06a10);
  const wheels = (B, xs, zs, r = 0.35, w = 0.28) => { for (const z of zs) for (const x of xs) B.box('b', x, 0, z, 0, r * 2, w, r * 2, dark); };
  // pushback tug: low, wide, cab offset
  out.tug = mk((B) => { B.box('b', 0, 0.3, 0, 0, 4.6, 2.4, 0.9, W); B.box('b', 1.2, 1.2, 0.5, 0, 1.4, 1.2, 0.95, glass); B.box('b', 1.2, 2.15, 0.5, 0, 1.5, 1.3, 0.08, W); wheels(B, [-1.05, 1.05], [-1.5, 1.5], 0.4); });
  // belt loader: chassis, inclined belt with side rails
  out.belt = mk((B) => { B.box('b', 0, 0.3, 0, 0, 6.8, 1.9, 0.6, W); B.box('b', -2.6, 0.9, 0.5, 0, 1.3, 0.9, 1.1, glass); B.beam('b', [0, 1.0, -1.8], [0, 3.4, 3.4], 0.8, grey); B.beam('b', [0.5, 1.4, -1.8], [0.5, 3.8, 3.4], 0.08, steel); B.beam('b', [-0.5, 1.4, -1.8], [-0.5, 3.8, 3.4], 0.08, steel); wheels(B, [-0.85, 0.85], [-2.3, 2.3]); });
  // fuel truck: cab + elliptical tank
  out.fuel = mk((B) => { B.box('b', 0, 0.45, -4.0, 0, 2.3, 2.5, 2.0, W); B.box('b', 0, 1.6, -4.6, 0, 0.9, 2.3, 0.75, glass); B.box('b', 0, 0.9, 1.0, 0, 8.0, 2.45, 2.15, W); B.box('b', 0, 3.05, 1.0, 0, 7.6, 1.6, 0.25, W); B.box('b', 0, 0.5, 1.0, 0, 8.2, 2.1, 0.4, grey); wheels(B, [-1.05, 1.05], [-4.0, 2.2, 3.6], 0.5, 0.4); });
  // baggage cart (with canvas sides)
  out.cart = mk((B) => { B.box('b', 0, 0.35, 0, 0, 3.0, 1.6, 0.25, grey); B.box('b', 0, 0.6, 0, 0, 2.9, 1.5, 1.2, W); B.box('b', 1.8, 0.4, 0, 0, 0.8, 0.08, 0.08, steel); wheels(B, [-0.7, 0.7], [-1, 1], 0.2, 0.18); });
  // air stairs truck
  out.stairs = mk((B) => { B.box('b', 0, 0.35, -2.4, 0, 2.2, 2.1, 1.6, W); B.box('b', 0, 1.3, -2.9, 0, 0.7, 2.0, 0.6, glass); B.box('b', 0, 0.5, 1.0, 0, 5.2, 2.1, 0.5, grey);
    for (let k = 0; k < 9; k++) B.box('b', 0, 1.0 + k * 0.33, -0.6 + k * 0.45, 0, 0.45, 1.4, 0.12, steel);
    for (const sx of [-0.75, 0.75]) B.beam('b', [sx, 1.9, -0.8], [sx, 4.9, 3.4], 0.07, W); B.box('b', 0, 3.85, 3.6, 0, 1.4, 1.6, 0.12, steel); wheels(B, [-0.9, 0.9], [-2.4, 2.6]); });
  // apron bus (articulated look: long low body, glazed)
  out.bus = mk((B) => { B.box('b', 0, 0.35, 0, 0, 13.5, 2.9, 0.65, W); B.box('b', 0, 1.0, 0, 0, 13.5, 2.9, 1.5, glass); B.box('b', 0, 2.5, 0, 0, 13.5, 2.9, 0.4, W); wheels(B, [-1.25, 1.25], [-4.8, 4.8], 0.45, 0.4); });
  // catering high-loader: truck with a raised box body
  out.catering = mk((B) => { B.box('b', 0, 0.45, -3.4, 0, 2.2, 2.4, 2.0, W); B.box('b', 0, 1.5, -3.9, 0, 0.8, 2.2, 0.7, glass); B.box('b', 0, 0.5, 1.0, 0, 6.0, 2.3, 0.5, grey);
    B.box('b', 0, 2.6, 1.0, 0, 5.6, 2.5, 2.4, W); for (const z of [-1, 3]) for (const sx of [-0.8, 0.8]) B.box('b', sx, 1.0, z, 0, 0.12, 0.12, 1.6, steel); wheels(B, [-1, 1], [-3.4, 2.6], 0.48, 0.38); });
  // ground power unit cart
  out.gpu = mk((B) => { B.box('b', 0, 0.35, 0, 0, 2.6, 1.5, 1.3, W); B.box('b', 1.6, 0.45, 0, 0, 0.9, 0.08, 0.08, steel); wheels(B, [-0.6, 0.6], [-0.9, 0.9], 0.25, 0.2); });
  // follow-me car (pickup) with a light bar
  out.follow = mk((B) => { B.box('b', 0, 0.35, 0, 0, 5.2, 1.9, 0.75, W); B.box('b', 0, 1.1, -0.6, 0, 2.4, 1.75, 0.65, glass); B.box('b', 0, 1.75, -0.6, 0, 2.3, 1.75, 0.08, W); B.box('b', 0, 1.83, -0.6, 0, 0.3, 1.3, 0.14, orange); wheels(B, [-0.85, 0.85], [-1.6, 1.6], 0.36, 0.25); });
  // ARFF crash tender (big 6x6)
  out.arff = mk((B) => { B.box('b', 0, 0.55, 0, 0, 11.5, 3.0, 2.7, W); B.box('b', 0, 2.1, -4.6, 0, 1.6, 2.8, 1.0, glass); B.box('b', 0, 3.25, 2.0, 0, 0.6, 0.6, 0.5, steel); wheels(B, [-1.3, 1.3], [-3.8, 1.5, 3.8], 0.65, 0.5); });
  // traffic cone and wheel chock pair
  out.cone = mk((B) => { B.cylinder('b', 0, 0.02, 0, 0.16, 0.7, 6, orange, 'b', 0.03); B.box('b', 0, 0, 0, 0, 0.4, 0.4, 0.04, orange); B.cylinder('b', 0, 0.32, 0, 0.115, 0.12, 6, W, null, 0.09); });
  out.chock = mk((B) => { for (const sx of [-0.45, 0.45]) B.box('b', sx, 0, 0, 0, 0.25, 0.3, 0.22, [0.85, 0.75, 0.1]); B.box('b', 0, 0.1, 0, 0, 0.8, 0.05, 0.05, dark); });
  return out;
}

/** Instanced placement helper: list of { x, z, y?, hdg (deg, nose direction), color, scale } → InstancedMesh. */
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
