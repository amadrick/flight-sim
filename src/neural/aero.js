// Neural aerodynamics runtime: per-aircraft sets of tiny MLPs trained on an offline nonlinear vortex-lattice solver
// (tools/neural/aero). Pure typed-array arithmetic: no allocation after createAeroNet(), no three.js, no DOM.
// See AERO.md for what the heads mean and how src/physics/aero.js joins them to the tuned analytic model.
import { AERO_NETS } from './aero-weights.js';

const H = AERO_NETS.hidden;                    // hidden width of every head
const HEADS = AERO_NETS.heads;                 // [name, nOut] in evaluation order

/** Head indices (order of AERO_NETS.heads). */
export const HEAD = { beta: 0, p: 1, r: 2, da: 3, dr: 4, de: 5, q: 6, m: 7, g: 8 };
/** Offsets of each head's outputs in net.o: beta [cyb, cnb, clb], p [clp, cnp], r [cnr, clr], da [clda, cnda],
 *  dr [cndr], de [cmde], q [cmq], m [cm], g [gcm, gcl]. */
export const OUT = { cyb: 0, cnb: 1, clb: 2, clp: 3, cnp: 4, cnr: 5, clr: 6, clda: 7, cnda: 8, cndr: 9, cmde: 10, cmq: 11, cm: 12, gcm: 13, gcl: 14 };
/** Gate on |alpha / alpha_peak|: the corrections are exactly zero below GATE0 and fully on above GATE1. */
export const GATE0 = AERO_NETS.gate[0], GATE1 = AERO_NETS.gate[1];
/** All free-air corrections fade out over this range of |alpha / alpha_peak|: the deep stall stays analytic. */
export const FADE = AERO_NETS.fade;
/** Input ranges the heads were trained on (inputs are clamped to them). */
export const AN_MIN = -1.6, AN_MAX = 3.0, MACH_MIN = 0.1;
export const BETA_REF = Math.sin(25 * Math.PI / 180), P_REF = 0.25, R_REF = 0.15, Q_REF = 0.03, BANK_REF = 12 * Math.PI / 180;

function decodeInt16(b64) {
  let bytes;
  if (typeof atob === 'function') { const s = atob(b64); bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i); }
  else bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Int16Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = dv.getInt16(2 * i, true);
  return out;
}

export function headParams(nOut) { return 4 * H + H + H * H + H + H * nOut + nOut; }

/** Aircraft ids that have a trained network set. */
export function aeroNetIds() { return Object.keys(AERO_NETS.aircraft); }

/**
 * Build the evaluation record of one aircraft (or null when it has no networks).
 * Fields: W weights, off[head] weight offsets, oOff[head] output offsets, nOut[head], bound[output], valid[output]
 * (0 = the solver has no meaningful reference for this derivative: the analytic term is kept), o[output] results,
 * g[output] weight of each correction for the last evalFreeAir() call (valid flag times the flap fade),
 * hasFlap, hbMin (lowest trained height / span of the ground head).
 */
export function createAeroNet(id) {
  const rec = AERO_NETS.aircraft[id];
  if (!rec) return null;
  const q = decodeInt16(rec.w);
  const W = new Float32Array(q.length), off = new Int32Array(HEADS.length), oOff = new Int32Array(HEADS.length), nOut = new Int32Array(HEADS.length);
  let p = 0, po = 0;
  for (let k = 0; k < HEADS.length; k++) {
    const n = HEADS[k][1], np = headParams(n), s = Math.fround(rec.s[k]);
    off[k] = p; oOff[k] = po; nOut[k] = n;
    for (let j = 0; j < np; j++) W[p + j] = Math.fround(q[p + j] * s);
    p += np; po += n;
  }
  if (p !== q.length) throw new Error(`aero net ${id}: weight count ${q.length} != ${p}`);
  return { id, W, off, oOff, nOut, bound: Float64Array.from(rec.b), valid: Uint8Array.from(rec.v), o: new Float64Array(po),
    flapFade: Uint8Array.from(rec.f), g: Float64Array.from(rec.v),
    h1: new Float64Array(H), h2: new Float64Array(H), hasFlap: rec.flap ? 1 : 0, hbMin: rec.hbMin, lnHbMin: Math.log(rec.hbMin), kFlap: 0, gePitch: 0 };
}

/** Evaluate head k at inputs (x0..x3); results in net.o[net.oOff[k] ...]. Outputs are bounded by net.bound. */
export function evalHead(net, k, x0, x1, x2, x3) {
  const W = net.W, h1 = net.h1, h2 = net.h2;
  let o = net.off[k];
  for (let j = 0; j < H; j++) {
    const z = W[o + j] * x0 + W[o + H + j] * x1 + W[o + 2 * H + j] * x2 + W[o + 3 * H + j] * x3 + W[o + 4 * H + j];
    h1[j] = z / Math.sqrt(1 + z * z);
  }
  o += 5 * H;
  const ob = o + H * H;
  for (let j = 0; j < H; j++) {
    let z = W[ob + j];
    for (let i = 0; i < H; i++) z += h1[i] * W[o + i * H + j];
    h2[j] = z / Math.sqrt(1 + z * z);
  }
  o = ob + H;
  const n = net.nOut[k], oo = net.oOff[k], out = net.o, bound = net.bound, valid = net.valid;
  for (let c = 0; c < n; c++) {
    let z = W[o + H * n + c];
    for (let i = 0; i < H; i++) z += h2[i] * W[o + i * n + c];
    out[oo + c] = valid[oo + c] ? bound[oo + c] * z / Math.sqrt(1 + z * z) : 0;
  }
}

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

/**
 * Evaluate the eight free-air heads for one flight condition (inputs are clamped to the trained ranges here).
 * an = alpha / alpha_peak, flap = flap lift fraction 0..1, sb = sin(beta), ph/rh/qh = non-dimensional rates,
 * da/dr = normalised roll / yaw control, de = total pitch-surface deflection / full travel.
 */
export function evalFreeAir(net, an, flap, mach, sb, ph, rh, da, dr, de, qh) {
  const a = clamp(an, AN_MIN, AN_MAX), f = net.hasFlap ? clamp(flap, 0, 1) : 0;
  // flaps are a low-speed device: the trained Mach range shrinks from 0.85 clean to 0.45 at 30 % flap and beyond
  const m = clamp(mach, MACH_MIN, f >= 0.3 ? 0.45 : 0.45 + 0.4 * (1 - f / 0.3));
  let t;
  t = (sb < 0 ? -sb : sb) / BETA_REF; evalHead(net, 0, a, f, m, t > 1 ? 1 : t);
  t = (ph < 0 ? -ph : ph) / P_REF; evalHead(net, 1, a, f, m, t > 1 ? 1 : t);
  t = (rh < 0 ? -rh : rh) / R_REF; evalHead(net, 2, a, f, m, t > 1 ? 1 : t);
  t = da < 0 ? -da : da; evalHead(net, 3, a, f, m, t > 1 ? 1 : t);
  t = dr < 0 ? -dr : dr; evalHead(net, 4, a, f, m, t > 1 ? 1 : t);
  evalHead(net, 5, a, f, m, clamp(de, -1, 1));
  evalHead(net, 6, a, f, m, clamp(qh / Q_REF, -1, 1));
  evalHead(net, 7, a, f, m, 0);
  const g = net.g, valid = net.valid, ff = net.flapFade;
  for (let k = 0; k < 13; k++) g[k] = ff[k] ? valid[k] * (1 - f) : valid[k];
}

/** Evaluate the ground-effect head: hb = CG height / span, an as above (clamped to 0.05..1.25), |bank| in radians. */
export function evalGround(net, hb, an, flap, bank) {
  let x0 = Math.log(hb > 1e-6 ? hb : 1e-6); x0 = clamp(x0, net.lnHbMin, 0.4054651081081644);
  const b = bank < 0 ? -bank : bank;
  evalHead(net, 8, x0, clamp(an, 0.05, 1.25), net.hasFlap ? clamp(flap, 0, 1) : 0, b > BANK_REF ? 1 : b / BANK_REF);
}
