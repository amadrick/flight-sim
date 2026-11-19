// Aerodynamic coefficient build-up: nonlinear lift/drag through and beyond the stall, Mach effects, stability and
// control derivatives, configuration increments, ground effect. Pure functions of a resolved model (see config.js);
// no allocation, no state.
//
// When the model carries a network set (A.neural, see src/neural/AERO.md) the stability/control derivatives are
// corrected near and beyond the stall and close to the ground with terms learned from an offline vortex-lattice solver.
// Lift and drag are never touched, and the corrections are exactly zero below 55 % of the angle of maximum lift, in
// the deep stall beyond 2.8 times that angle, above Mach 1.05 (free air) and above 1.5 spans of height (ground terms),
// so the tuned performance does not move.
//
// Internal axes are the classic AEROSPACE body axes: x forward, y right wing, z down. Moments L (roll, + right wing
// down), M (pitch, + nose up), N (yaw, + nose right). The sim core converts to/from the three.js-style export axes.

import { createAeroNet, evalFreeAir, evalGround, GATE0, GATE1, FADE, OUT } from '../neural/aero.js';

const GATE_INV = 1 / (GATE1 - GATE0), FADE0 = FADE[0], FADE_INV = 1 / (FADE[1] - FADE[0]);
const exp = Math.exp, sin = Math.sin, cos = Math.cos, sqrt = Math.sqrt, abs = Math.abs;

/** Flow-separation blend 0 (attached) .. 1 (fully separated) — smooth "sigmoid" stall model, both signs of alpha. */
export function separation(alpha, a0p, a0n, m) {
  let ep = -m * (alpha - a0p), en = m * (alpha + a0n);
  if (ep > 40) ep = 40; else if (ep < -40) ep = -40;
  if (en > 40) en = 40; else if (en < -40) en = -40;
  const sp = exp(ep), sn = exp(en);
  return (1 + sp + sn) / ((1 + sp) * (1 + sn));
}

/** Total lift coefficient of the wing-body for the given attached-flow line and separated-flow model. */
export function liftCurve(alpha, cl0, cla, a0p, a0n, m, clPost, dclFlap) {
  const s = separation(alpha, a0p, a0n, m);
  const ca = cos(alpha);
  const sep = clPost * 2 * sin(alpha) * ca + 0.5 * dclFlap * (ca > 0 ? ca : 0);
  return (1 - s) * (cl0 + dclFlap + cla * alpha) + s * sep;
}

/** Attach the trained network set of aircraft `id` (if there is one) to a resolved aero model: the neural layer is on
 *  for every computeAero() call with this model afterwards. Returns the set or null. */

export function attachNeural(A, id, off, gePitch) {
  const net = createAeroNet(id);
  if (net) {
    // `off`: comma-separated output names (see OUT in src/neural/aero.js) whose analytic term is kept, for A/B work
    // Default: the two roll-yaw cross-coupling residuals (Cnp, Clr) stay analytic. The strip-theory solver overstates
    // them past the stall (an A-10 in landing configuration rolled inverted in 6 s, which the real aircraft does not
    // do). `aeroOff=none` switches every learned output on.
    if (typeof off !== 'string' || off === '') off = 'cnp,clr';
    for (const k of off.split(',')) if (OUT[k] !== undefined) net.valid[OUT[k]] = 0;
    const F = A.flaps; let m = 0;
    for (let k = 0; k < F.n; k++) if (F.dcl0[k] > m) m = F.dcl0[k];
    net.gePitch = gePitch > 0 ? Math.min(+gePitch, 1) : 0;      // strength of the ground-effect pitch term (default off)
    net.kFlap = m > 0.02 ? 1 / m : 0;                           // flap input = low-speed flap lift increment / its maximum
  }
  A.neural = net;
  return net;
}

/** Output record of computeAero (reused). */
export function createAeroOut() {
  return { X: 0, Y: 0, Z: 0, L: 0, M: 0, N: 0, V: 0, alpha: 0, beta: 0, mach: 0, qbar: 0, CL: 0, CD: 0, CY: 0, Cm: 0,
    sigma: 0, buffet: 0, alphaStall: 0.3, stallMargin: 1, fCtrl: 1, fCla: 1, cla: 0, Cl: 0, Cn: 0, nnGate: 0 };
}

/** Input record of computeAero (reused). */
export function createAeroIn() {
  return { u: 0, v: 0, w: 0, p: 0, q: 0, r: 0, rho: 1.225, a: 340, de: 0, da: 0, dr: 0, trim: 0, flap: 0, slat: 0,
    spL: 0, spR: 0, sb: 0, gear: 0, sweep: 0, hWing: 1e4, bank: 0, geAir: 1, nBuffet: 0, nDrop: 0, drSplit: 0 };
}

/**
 * @param A   resolved aero model (model.aero from config.js)
 * @param i   inputs (createAeroIn): air-relative velocity u,v,w and body rates p,q,r in aerospace body axes, air
 *            density/sound speed, normalised surface positions (de/da/dr: + = nose up / roll right / nose right),
 *            hWing = height of the CG above the ground [m], bank = roll angle [rad] and geAir = 1 airborne .. 0 on
 *            the wheels (ground-effect terms only)
 * @param o   outputs (createAeroOut): forces X,Y,Z [N] and moments L,M,N [N·m] about the body origin
 */
export function computeAero(A, i, o) {
  const u = i.u, v = i.v, w = i.w;
  const V2 = u * u + v * v + w * w;
  if (!(V2 > 0.01)) {
    o.X = o.Y = o.Z = o.L = o.M = o.N = 0; o.V = 0; o.alpha = 0; o.beta = 0; o.mach = 0; o.qbar = 0; o.CL = 0; o.CD = 0;
    o.sigma = 0; o.buffet = 0; o.stallMargin = 1; o.Cl = 0; o.Cn = 0; o.nnGate = 0;
    return o;
  }
  const V = sqrt(V2), hxz = sqrt(u * u + w * w);
  const alpha = Math.atan2(w, u);
  const sb = v / V;                                   // sin(beta)
  const beta = Math.asin(sb < -1 ? -1 : sb > 1 ? 1 : sb);
  const mach = V / i.a, qbar = 0.5 * i.rho * V2;
  const sa = hxz > 1e-3 ? w / hxz : 0, ca = hxz > 1e-3 ? u / hxz : 1;
  const c2b = (hxz * hxz) / V2, cb = hxz / V;          // cos²β, cosβ: in-plane share of the dynamic pressure

  // ---- Mach tables (uniform grid) ---------------------------------------------------------------------------------
  let mi = mach * A.mInv; if (mi > A.mN - 1.001) mi = A.mN - 1.001;
  const m0 = mi | 0, mf = mi - m0, m1 = m0 + 1;
  let fCla = A.tCla[m0] + (A.tCla[m1] - A.tCla[m0]) * mf;
  let fClmax = A.tClmax[m0] + (A.tClmax[m1] - A.tClmax[m0]) * mf;
  let cd0 = A.tCd0[m0] + (A.tCd0[m1] - A.tCd0[m0]) * mf;
  let kInd = A.tK[m0] + (A.tK[m1] - A.tK[m0]) * mf;
  let dxac = A.tXac[m0] + (A.tXac[m1] - A.tXac[m0]) * mf;
  const fCtrl = A.tCtrl[m0] + (A.tCtrl[m1] - A.tCtrl[m0]) * mf;
  let fDamp = fCla, spanF = 1;

  // ---- variable sweep (0 = forward, 1 = fully aft) ----------------------------------------------------------------
  const sw = A.sweep;
  if (sw !== null) {
    const s = i.sweep;
    fCla *= 1 + (sw.cla - 1) * s; fClmax *= 1 + (sw.clMax - 1) * s;
    cd0 = A.tCd0[0] + sw.cd0 * s + (cd0 - A.tCd0[0]) * (1 + (sw.wave - 1) * s);
    kInd *= 1 + (sw.k - 1) * s; dxac += sw.xac * s; fDamp *= 1 + (sw.damp - 1) * s; spanF = 1 + (sw.span - 1) * s;
  }

  // ---- flap/slat schedule interpolation ---------------------------------------------------------------------------
  const F = A.flaps;
  let dcl0 = 0, a0 = F.a0[0], dcd0 = 0, dcm0 = 0, kf = 1;
  if (F.n > 1) {
    let k = 0; const fp = i.flap;
    while (k < F.n - 2 && fp > F.pos[k + 1]) k++;
    let t = (fp - F.pos[k]) / (F.pos[k + 1] - F.pos[k]); if (t < 0) t = 0; else if (t > 1) t = 1;
    dcl0 = F.dcl0[k] + (F.dcl0[k + 1] - F.dcl0[k]) * t;
    a0 = F.a0[k] + (F.a0[k + 1] - F.a0[k]) * t;
    dcd0 = F.dcd0[k] + (F.dcd0[k + 1] - F.dcd0[k]) * t;
    dcm0 = F.dcm0[k] + (F.dcm0[k + 1] - F.dcm0[k]) * t;
    kf = F.kf[k] + (F.kf[k + 1] - F.kf[k]) * t;
  }
  // Flap lift increment fades with compressibility (flaps are not used fast; avoids silly transonic numbers).
  const dcl0Low = dcl0;                                       // low-speed flap lift increment: the flap input of the network
  if (mach > 0.5) { const f = mach > 0.9 ? 0.3 : 1 - 1.75 * (mach - 0.5); dcl0 *= f; dcm0 *= f; }

  // ---- ground effect ----------------------------------------------------------------------------------------------
  const b = A.b * spanF;
  let geK = 1, geL = 1;
  const inGe = A.groundEffect && i.hWing < 1.5 * b;
  if (inGe) {
    const hb = 16 * (i.hWing > 0.02 * b ? i.hWing : 0.02 * b) / b, phi = (hb * hb) / (1 + hb * hb);
    geK = phi; geL = 1 + 0.10 * (1 - phi);
  }

  // ---- lift -------------------------------------------------------------------------------------------------------
  const cla = A.cla * fCla * geL;
  const a0p = (a0 - (1 - i.slat) * A.slatDAlpha) * fClmax;    // stall-blend centre, positive side
  const a0n = A.a0n * fClmax;
  const sig = separation(alpha, a0p, a0n, A.sharp);
  const att = 1 - sig;
  const clAtt = A.cl0 + dcl0 + cla * alpha;
  const clSep = A.clPost * 2 * sa * ca + 0.5 * dcl0 * (ca > 0 ? ca : 0);
  const spAvg = 0.5 * (i.spL + i.spR), spDiff = i.spR - i.spL;
  const deRad = i.de * A.deMax + i.trim * A.trimMax;          // total pitch-surface deflection, + = trailing edge up
  let CL = att * clAtt + sig * clSep - A.clde * fCtrl * deRad - A.clSp * spAvg * att * (clAtt > 0 ? clAtt : 0);

  // stall proximity (for buffet / warning / FCS): margin [rad] to the angle of maximum lift
  const margin = a0p - A.peakOff - alpha;
  let buffet = 1 - (margin + A.buffetEnd) / (A.buffetMargin + A.buffetEnd);
  buffet = buffet < 0 ? 0 : buffet > 1 ? 1 : buffet;
  if (alpha < 0) { const bn = 1 - (a0n - A.peakOff + alpha) / A.buffetMargin; buffet = bn < 0 ? 0 : bn > 1 ? 1 : bn; }
  buffet *= buffet;
  CL += A.buffetCl * buffet * i.nBuffet;

  // ---- drag -------------------------------------------------------------------------------------------------------
  const cdProfile = cd0 + dcd0 + A.cdGear * i.gear + A.cdSb * i.sb + A.cdSp * spAvg + A.slatCd * i.slat
    + A.cdde * deRad * deRad + A.cdda * i.da * i.da + A.cddr * abs(i.dr) + A.cdSplit * i.drSplit;
  const cle = clAtt - A.clMinD;
  const cdAtt = cdProfile + kInd * kf * geK * cle * cle;
  const cdSep = cdProfile + A.cd90 * sa * sa;
  CL *= c2b;
  const CD = (att * cdAtt + sig * cdSep) * c2b + A.cdBeta * sb * sb;

  // ---- neural layer: learned corrections to the derivatives (src/neural/AERO.md) --------------------------------------
  const i2V = 1 / (2 * (V > 5 ? V : 5));
  const ph = i.p * b * i2V, qh = i.q * A.c * i2V, rh = i.r * b * i2V;
  const drRad = i.dr * A.drMax;
  const sdir = smooth01((abs(alpha) - A.aDir0) * A.aDirInv);       // directional blanking at high alpha
  // analytic factors; the network replaces or scales them as its gate opens
  let fCyb = 1, fClb = 1, fCnr = 1, fCmde = 1, fCmq = 1, dCl = 0, dCm = 0, dCn = 0;
  let rudF = 1 - A.rudLoss * sdir, rollLoss = 1 - A.ailLoss * sig;
  let cnbA = A.cnb * (1 - sdir) + A.cnbPost * sdir, clpA = A.clp * fDamp * att + A.clpPost * sig;
  const NN = A.neural;
  let nG = 0;
  if (NN) {
    const pk = alpha >= 0 ? a0p - A.peakOff : a0n - A.peakOff;
    const an = alpha / (pk > 0.05 ? pk : 0.05), aan = an < 0 ? -an : an;   // fraction of the angle of maximum lift
    const fl = dcl0Low * NN.kFlap, O = NN.o, vv = NN.g, cmU = abs(A.cmde) * A.deMax;
    // trust window of the solver: from the first separation to about 2.8 times the angle of maximum lift; the deep
    // stall beyond stays with the analytic model
    nG = smooth01((aan - GATE0) * GATE_INV) * (1 - smooth01((aan - FADE0) * FADE_INV));
    if (mach > 0.85) nG *= 1 - smooth01((mach - 0.85) * 5);       // subsonic solver: fade back to the analytic model
    if (sw !== null) nG *= 1 - i.sweep;                           // networks know the forward-sweep planform only
    if (nG > 0) {
      evalFreeAir(NN, an, fl, mach, sb, ph, rh, i.da, i.dr, deRad / A.deMax, qh);
      // vv[k]: weight of output k (0 where the analytic term is kept, reduced with flap for flap-sensitive outputs)
      fCyb = 1 + nG * vv[OUT.cyb] * O[OUT.cyb]; fClb = 1 + nG * vv[OUT.clb] * O[OUT.clb]; fCnr = 1 + nG * vv[OUT.cnr] * O[OUT.cnr];
      fCmde = 1 + nG * vv[OUT.cmde] * O[OUT.cmde]; fCmq = 1 + nG * vv[OUT.cmq] * O[OUT.cmq];
      // rate damping may fade to nothing in separated flow but is never reversed: the solver's quasi-steady strip
      // theory is not trusted with negative damping (for the same reason roll damping stays analytic altogether)
      if (fCnr < 0) fCnr = 0; if (fCmq < 0) fCmq = 0;
      cnbA += nG * vv[OUT.cnb] * (A.cnb * (1 + O[OUT.cnb]) - cnbA);
      clpA += nG * vv[OUT.clp] * (A.clp * fDamp * (1 + O[OUT.clp]) - clpA);
      rollLoss += nG * vv[OUT.clda] * (1 + O[OUT.clda] - rollLoss);
      rudF += nG * vv[OUT.cndr] * (1 + O[OUT.cndr] - rudF);
      dCl = nG * O[OUT.clr] * rh;
      dCn = nG * (O[OUT.cnp] * ph + O[OUT.cnda] * i.da * fCtrl);
      dCm = nG * O[OUT.cm] * cmU;
    }
    if (inGe) {                                                   // pitch trim change and roll stiffness near the ground
      const hb = i.hWing / b, wg = 1 - smooth01((hb - 0.9) * 1.6666666666666667);
      const bk = i.bank > 0.20943951 ? 0.20943951 : i.bank < -0.20943951 ? -0.20943951 : i.bank;
      evalGround(NN, hb, an, fl, bk);
      // the pitch term acts in the air only (geAir): on the wheels the tuned rotation is kept as it is
      dCm += wg * i.geAir * NN.gePitch * O[OUT.gcm] * cmU; dCl += wg * O[OUT.gcl] * sin(bk);
    }
  }

  // ---- side force -------------------------------------------------------------------------------------------------
  const CY = A.cyb * fCyb * sb * cb - A.cyCross * sb * abs(sb) - A.cydr * fCtrl * drRad * rudF * cb;

  // ---- moments ----------------------------------------------------------------------------------------------------
  const clw = CL > 2.5 ? 2.5 : CL < -1.5 ? -1.5 : CL;
  const sm = A.sm + dxac;
  const Cm = (A.cm0 + dcm0 + att * (-sm * cla * alpha) + sig * A.cmPost * sa + A.cmde * fCtrl * fCmde * deRad + A.cmSb * i.sb + A.cmGear * i.gear + A.cmSp * spAvg + dCm) * c2b
    + A.cmq * fDamp * fCmq * qh;

  let wd = 1 - margin * 11.5; wd = wd < 0 ? 0 : wd > 1 ? 1 : wd;            // asymmetric stall (wing drop) within ~5° of CLmax
  let qe = 1; if (A.qRev > 0) { qe = 1 - qbar / A.qRev; if (qe < 0.15) qe = 0.15; }
  const daRad = i.da * A.daMax, dtRad = i.da * A.dtMax;
  const Cl = (A.clb + A.clbCl * clw) * fClb * sb + clpA * ph + (A.clr + A.clrCl * clw) * rh
    + (A.clda * daRad * qe + A.cldt * dtRad) * fCtrl * rollLoss + A.cldr * drRad * fCtrl + A.clSpR * spDiff * att
    + A.wingDrop * wd * wd * i.nDrop + dCl;
  const cnb = cnbA * (A.cnbMach > 0 && mach > 1 ? 1 / (1 + A.cnbMach * (mach - 1)) : 1);
  const Cn = cnb * sb + (A.cnp + A.cnpCl * clw) * ph + A.cnr * fDamp * fCnr * rh
    + A.cndr * fCtrl * drRad * rudF - (A.cnda + A.cndaCl * clw) * daRad * fCtrl + A.cnSpR * spDiff + dCn;

  // ---- dimensional forces/moments in body axes ---------------------------------------------------------------------
  const qS = qbar * A.S, D = qS * CD, Lf = qS * CL;
  o.X = -D * (u / V) + Lf * sa;
  o.Y = -D * sb + qS * CY;
  o.Z = -D * (w / V) - Lf * ca;
  o.L = qS * b * Cl; o.M = qS * A.c * Cm; o.N = qS * b * Cn;
  o.V = V; o.alpha = alpha; o.beta = beta; o.mach = mach; o.qbar = qbar; o.CL = CL; o.CD = CD; o.CY = CY; o.Cm = Cm;
  o.sigma = sig; o.buffet = buffet; o.alphaStall = a0p; o.stallMargin = margin; o.fCtrl = fCtrl; o.fCla = fCla; o.cla = cla; o.Cl = Cl; o.Cn = Cn; o.nnGate = nG;
  return o;
}

function smooth01(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }
