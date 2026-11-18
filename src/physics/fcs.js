// Flight control systems + autopilot.
//   'fbw-fighter'   G / AoA-limited pitch-rate command, roll-rate command, turn coordination, departure resistance
//   'fbw-airliner'  "normal law": load-factor demand with flight-path hold, bank / pitch / AoA / overspeed protections
//   'conventional'  direct surfaces with artificial feel, stabiliser trim (+ optional trim follow-up), yaw damper;
//                   the same rate-command inner loops act as autopilot servos when the autopilot is engaged
// All three share: model-scheduled PI rate loops, rate-limited actuators, yaw SAS, roll-spoiler mixing.
// Normalised commands: de + = nose up (trailing edge up), da + = roll right, dr + = nose right.

const G0 = 9.80665;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export function createFcsState() {
  return {
    de: 0, da: 0, dr: 0, trim: 0, trimTarget: 0, integ: 0, law: 0,
    deCmd: 0, daCmd: 0, drCmd: 0, qCmd: 0, pCmd: 0, tvec: 0,
    alphaProt: false, apPitchPrev: false, yawInt: 0, steerCmd: 0,
  };
}

export function createApState() {
  return { alt: false, hdg: false, spd: false, altRef: 0, hdgRef: 0, spdRef: 0, vsCmd: 0, qCmd: 0, pCmd: 0, lever: 0, bankCmd: 0 };
}

function shape(s, k) { return s * (1 - k + k * Math.abs(s)); }

function actuator(pos, cmd, rate, tau, dt) {
  let d = (cmd - pos) * (dt / (tau + dt));
  const m = rate * dt;
  if (d > m) d = m; else if (d < -m) d = -m;
  return pos + d;
}

/**
 * Outer autopilot loops → pitch-rate / roll-rate commands and the autothrottle lever.
 * X = sensor record (see sim.js), a = autopilot state, P = model.ap
 */
export function updateAutopilot(P, a, X, dt) {
  const V = X.V > 30 ? X.V : 30;
  if (a.alt) {
    let vs = P.kh * (a.altRef - X.alt); vs = clamp(vs, -P.vsMax, P.vsMax);
    a.vsCmd = vs;
    const acc = clamp(P.kv * (vs - X.vs), -P.accMax, P.accMax);
    // pitch rate for the demanded vertical acceleration + the pitch rate a level turn needs at this bank;
    // beyond ~70° of bank the autopilot unloads and lets the roll channel bring the wings back first
    const cphi = X.cphi > 0.4 ? X.cphi : 0.4, up = X.cphi > 0.35 ? 1 : X.cphi < 0.1 ? 0 : (X.cphi - 0.1) * 4;
    a.qCmd = up * (acc / (V * cphi) + (G0 / V) * (X.sphi * X.sphi) / cphi);
  } else { a.qCmd = 0; a.vsCmd = 0; }
  if (a.hdg) {
    let err = a.hdgRef - X.psi; err -= Math.round(err / (2 * Math.PI)) * 2 * Math.PI;
    const rate = clamp(0.35 * err, -P.turnRate, P.turnRate);
    a.bankCmd = clamp(Math.atan((V * rate) / G0), -P.bankMax, P.bankMax);
    a.pCmd = clamp(P.kPhi * (a.bankCmd - X.phi), -P.pMax, P.pMax);
  } else if (a.alt) {
    a.bankCmd = 0; a.pCmd = 0;
  } else { a.pCmd = 0; a.bankCmd = 0; }
  if (a.spd) {
    const rate = clamp(P.thrKi * (a.spdRef - X.ias) - P.thrKp * X.iasDot, -0.3, 0.3);
    a.lever = clamp(a.lever + rate * dt, 0, P.thrMax);
  }
}

/**
 * One FCS step. model = resolved model, f = FCS state, X = sensors, stick = {pitch, roll, yaw} (-1..1),
 * a = autopilot state.
 */
export function updateFcs(model, f, X, stick, a, dt) {
  const fc = model.fcs, A = model.aero, C = model.ctl;
  const V = X.V, Veff = V > 35 ? V : 35, qbar = X.qbar;
  const fCtrl = X.fCtrl;
  const apPitch = a.alt, apRoll = a.hdg;

  // flight-law blend: 0 with weight on the main wheels, 1 airborne
  f.law = clamp(f.law + (X.wow ? -dt / 0.4 : dt / 0.6), 0, 1);
  const law = f.law;
  const gearDn = X.gearHandle;

  // ------------------------------------------------------------------ pitch
  const grav = X.cth * X.cphi;
  const useRateLoop = fc.fbw || apPitch;
  let deCmd;
  const Md = (qbar * A.S * A.c * A.cmde * fCtrl * A.deMax) / X.iyy;      // rad/s² per unit command
  if (useRateLoop) {
    let qCmd;
    let aMax = gearDn && fc.gdAlphaMax > 0 ? fc.gdAlphaMax : fc.alphaMax;
    // optional: keep the limit a fixed margin below the current stall angle (follows flaps, slats and Mach)
    if (fc.alphaStallMargin > 0 && X.alphaStall - fc.alphaStallMargin < aMax) aMax = X.alphaStall - fc.alphaStallMargin;
    const qGam = (G0 / Veff) * (X.nz - grav);
    let qUp = fc.kAlpha * (aMax - X.alpha) + qGam, qDn = fc.kAlpha * (fc.alphaMin - X.alpha) + qGam;
    let qMax = gearDn && fc.gdQMax > 0 ? fc.gdQMax : fc.qMax;
    if (apPitch) qCmd = a.qCmd;
    else {
      const s = shape(clamp(stick.pitch + f.trim * 0.25, -1, 1), fc.stickShape);
      const nzMax = gearDn && fc.gdNz > 0 ? fc.gdNz : fc.nzMax;
      let nComp = grav;
      if (fc.airliner) { const cb = Math.cos(Math.min(Math.abs(X.phi), fc.bankNeutral)); nComp = X.cth / (cb > 0.5 ? cb : 0.5); }
      const dn = s >= 0 ? s * (nzMax - nComp) : s * (nComp - fc.nzMin);       // full stick = the G limit at any attitude
      // G command: kinematic pitch rate for the demanded load factor + load-factor error feedback
      qCmd = (G0 / Veff) * (nComp + dn - grav + fc.kNz * (nComp + dn - X.nz));
      // G onset protection: do not let a transient overshoot the limit
      if (X.nz > nzMax) qUp = Math.min(qUp, qGam - 1.5 * (G0 / Veff) * (X.nz - nzMax));
      if (X.nz < fc.nzMin) qDn = Math.max(qDn, qGam + 1.5 * (G0 / Veff) * (fc.nzMin - X.nz));
      if (fc.airliner) {
        if (fc.pitchMax > 0) qUp = Math.min(qUp, 1.2 * (fc.pitchMax - X.theta));
        if (fc.pitchMin < 0) qDn = Math.max(qDn, 1.2 * (fc.pitchMin - X.theta));
        const os = X.ias - model.limits.vmo - 3, osm = (X.mach - model.limits.mmo - 0.006) * 300;
        const o = os > osm ? os : osm;
        if (o > 0) qCmd = Math.max(qCmd, Math.min(0.04, 0.004 * o));     // high-speed protection pulls the nose up
      }
    }
    if (qCmd > qMax) qCmd = qMax; else if (qCmd < -qMax) qCmd = -qMax;
    f.alphaProt = qCmd > qUp;
    if (qCmd > qUp) qCmd = qUp; if (qCmd < qDn) qCmd = qDn;
    f.qCmd = qCmd;
    const Kp = Math.min(fc.kpMax, fc.wq / (Md > 1e-3 ? Md : 1e-3));
    const e = qCmd - X.q;
    const out = Kp * e + f.integ;
    if (law > 0.02) {
      if (!((out > 1 && e > 0) || (out < -1 && e < 0))) f.integ += Kp * fc.wi * e * dt;
      f.integ = clamp(f.integ, -1.3, 1.3);
    }
    const flight = clamp(out, -1, 1);
    let direct = clamp(stick.pitch * fc.groundPitchGain + (fc.fbw ? f.trim * 0.25 : 0), -1, 1);
    if (law <= 0.02) f.integ = direct;                  // bumpless hand-over at lift-off
    deCmd = direct + (flight - direct) * law;
    if (!fc.fbw) {
      // conventional aircraft under autopilot: the stabiliser trim slowly off-loads the elevator servo
      const off = clamp(f.integ * 0.4, -C.trimRate, C.trimRate) * dt * (A.deMax / A.trimMax);
      f.trim = clamp(f.trim + off, -C.trimAuth, C.trimAuth); f.integ -= off * (A.trimMax / A.deMax);
      f.trimTarget = f.trim;
    }
    f.apPitchPrev = apPitch;
  } else {
    if (f.apPitchPrev) {                                 // autopilot just released: hand the servo load to the trim
      f.trim = clamp(f.trim + f.integ * (A.deMax / A.trimMax), -C.trimAuth, C.trimAuth); f.trimTarget = f.trim; f.integ = 0; f.apPitchPrev = false;
    }
    const feel = clamp(fc.feelQ / (qbar > 1 ? qbar : 1), fc.feelMin, 1);
    const s = shape(stick.pitch, fc.stickShape);
    deCmd = clamp(s * feel, -1, 1);
    f.qCmd = 0; f.alphaProt = false;
    // trim follow-up: a held column is trimmed out, as a pilot would with the thumb switch
    // (never further nose-up once the stall warning is on, so that releasing the column always recovers)
    if (fc.trimFollow > 0 && law > 0.99 && Math.abs(stick.pitch) > 0.04 && !(s > 0 && X.stallMargin < A.warnMargin + 0.035)) {
      f.trimTarget = clamp(f.trimTarget + s * feel * fc.trimFollow * dt * (A.deMax / A.trimMax), -C.trimAuth, C.trimAuth);
    }
  }
  if (fc.rotAssist && law < 1 && deCmd > 0 && !apPitch) {
    // rotation assist: on the wheels a held-back stick is limited to a sensible rotation rate and kept short of the
    // tail-strike attitude (fades out with the flight-law blend after lift-off)
    let qLim = 2 * (fc.rotPitchMax - X.theta); if (qLim > fc.rotRate) qLim = fc.rotRate;
    const lim = clamp(1 + 18 * (qLim - X.q), -0.35, 1);
    const dl = deCmd + (lim - deCmd) * (1 - law);
    if (dl < deCmd) deCmd = dl;
  }
  if (!useRateLoop || fc.fbw) {
    // manual trim commands (trimTarget is stepped by the sim) run at the trim motor rate
    const m = C.trimRate * (fc.fbw ? 4 : 1) * dt;
    f.trim += clamp(f.trimTarget - f.trim, -m, m);
  }

  // ------------------------------------------------------------------ roll
  const clTot = (A.clda * A.daMax + A.cldt * A.dtMax + (C.spoilers ? A.clSpR * C.spoilers.rollMax : 0));
  let daCmd;
  if (fc.fbw || apRoll) {
    let pCmd;
    if (apRoll) pCmd = a.pCmd;
    else {
      let pMax = gearDn && fc.gdRoll > 0 ? fc.gdRoll : fc.rollRate;
      const af = (Math.abs(X.alpha) - fc.rollAlphaFade[0]) / (fc.rollAlphaFade[1] - fc.rollAlphaFade[0]);
      pMax *= 1 - 0.65 * clamp(af, 0, 1);
      pCmd = shape(stick.roll, fc.stickShape) * pMax;
      if (fc.bankMax > 0) {
        const phi = X.phi, ab = Math.abs(phi);
        if (ab > fc.bankNeutral && Math.abs(stick.roll) < 0.05) pCmd = clamp(-0.8 * (phi - Math.sign(phi) * fc.bankNeutral), -0.1, 0.1);
        pCmd = clamp(pCmd, 2 * (-fc.bankMax - phi), 2 * (fc.bankMax - phi));
      }
    }
    f.pCmd = pCmd;
    const Ld = (qbar * A.S * A.b * clTot * fCtrl) / X.ixx;
    const Kp = Math.min(fc.kpRollMax, fc.wp / (Ld > 1e-3 ? Ld : 1e-3));
    const ff = (-A.clp * X.fCla * A.b * pCmd) / (2 * Veff * clTot * fCtrl);
    const flight = clamp(ff + Kp * (pCmd - X.p), -1, 1);
    // on the wheels: direct stick plus a wings-level assist that works against roll-over in fast turns
    const direct = clamp(stick.roll * 0.6 - (fc.fbw ? 3 * X.phi + 0.8 * X.p : 0), -1, 1);
    daCmd = direct + (flight - direct) * law;
  } else {
    const feel = fc.rollFeelQ > 0 ? clamp(fc.rollFeelQ / (qbar > 1 ? qbar : 1), 0.25, 1) : 1;
    daCmd = clamp(shape(stick.roll, fc.stickShape) * feel, -1, 1);
    f.pCmd = 0;
  }

  // ------------------------------------------------------------------ yaw
  let blow = 1; if (C.drBlow > 0 && qbar > C.drBlow) blow = C.drBlow / qbar;
  let drCmd = stick.yaw * fc.pedalAuthority * blow;
  if (law > 0 && fc.yawDamper > 0) {
    const sa = Math.sin(clamp(X.alpha, 0, 0.6));
    const rCoord = (G0 / Veff) * X.sphi * X.cth + X.p * sa;
    const Nd = (qbar * A.S * A.b * A.cndr * fCtrl * A.drMax) / X.izz;
    const Kr = Math.min(fc.krMax, fc.wr / (Nd > 1e-3 ? Nd : 1e-3)) * fc.yawDamper;
    let sas = Kr * (rCoord - X.r) + fc.kBeta * X.beta + fc.ari * daCmd;
    sas = clamp(sas, -fc.sasAuthority, fc.sasAuthority);
    drCmd += sas * law;
  }
  f.steerCmd = stick.yaw;
  if (law < 1 && fc.groundYaw && X.gs > 8) {
    // ground yaw law (weight on wheels, above taxi speed): the pedals command a yaw rate that is limited to a
    // comfortable lateral acceleration; pedals centred it holds the heading against weathervaning and asymmetric
    // thrust within the rudder authority. It hands back to direct pedals below 8..16 m/s and at lift-off.
    const fade = clamp((X.gs - 8) / 8, 0, 1) * (1 - law);
    const rCmd = (stick.yaw * 0.9 * model.gear.steerLatAcc) / X.gs;
    const Nd = (qbar * A.S * A.b * A.cndr * fCtrl * A.drMax) / X.izz;
    const Kp = Math.min(50, 6 / (Nd > 1e-3 ? Nd : 1e-3)), e = rCmd - X.r;
    f.yawInt = clamp(f.yawInt + 2 * Kp * e * dt * fade, -0.8, 0.8);
    const cmd = clamp(Kp * e + f.yawInt, -1, 1);
    drCmd += (cmd - drCmd) * fade;
    f.steerCmd += (clamp(stick.yaw + f.yawInt, -1, 1) - stick.yaw) * fade;
  } else f.yawInt = 0;
  drCmd = clamp(drCmd, -blow, blow);

  // ------------------------------------------------------------------ actuators
  f.deCmd = deCmd; f.daCmd = daCmd; f.drCmd = drCmd;
  f.de = actuator(f.de, deCmd, C.deRate, C.deTau, dt);
  f.da = actuator(f.da, daCmd, C.daRate, C.daTau, dt);
  f.dr = actuator(f.dr, drCmd, C.drRate, C.drTau, dt);
  f.tvec = deCmd;
}
