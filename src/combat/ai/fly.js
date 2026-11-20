// AI flight controller: turns "where I want my flight path to go, how hard, how fast" into the same Controls a human
// writes (stick pitch / roll / pedals, throttle, speedbrake), for any aircraft definition and FCS type:
//   fbw-fighter   stick pitch = G command, stick roll = roll-rate command (src/physics/fcs.js) — inverted analytically
//   fbw-airliner  load-factor demand with bank / pitch protections — same inversion with the airliner's neutral G
//   conventional  stick = surface deflection — closed-loop G and roll-rate control around it (F-15, F-14, A-10, 737 …)
// Lift-vector control: the controller rolls the aircraft's lift vector onto the plane that contains the desired
// direction and pulls the G that turns the velocity vector at the requested rate (gravity included), limited by the
// structure, the AoA the pilot is willing to use, and the stall. Pure logic, no allocations per update.
import * as THREE from 'three';
import { clamp, G0 } from '../util.js';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _l = new THREE.Vector3(), _q = new THREE.Quaternion();

/** Inverse of fcs.js shape(): stick deflection that produces normalised command s (|s| <= 1) with shaping factor k. */
export function invShape(s, k) {
  const a = Math.abs(s) > 1 ? Math.sign(s) : s;
  if (k <= 1e-6) return a;
  const m = Math.abs(a);
  const x = (-(1 - k) + Math.sqrt((1 - k) * (1 - k) + 4 * k * m)) / (2 * k);
  return a < 0 ? -x : x;
}

/** Turn radius (m) at speed V (m/s) and load factor n (level turn). */
export const turnRadius = (V, n) => (V * V) / (G0 * Math.sqrt(Math.max(n * n - 1, 0.05)));
/** Turn rate (rad/s) at speed V and load factor n (level turn). */
export const turnRate = (V, n) => (G0 * Math.sqrt(Math.max(n * n - 1, 0))) / Math.max(V, 1);

/**
 * Performance profile of an aircraft definition, read once per pilot: what the controller and the tactics need.
 * Works for every def in the registry (fighters, attack, bombers, airliners) and degrades to safe defaults.
 */
export function profileOf(def, sim) {
  const P = def?.physics || {}, sp = def?.specs || {}, f = P.fcs || {}, model = sim?.model;
  const cat = def?.category || 'fighter';
  const heavy = cat === 'airliner' || cat === 'transport' || cat === 'bomber';
  const type = model?.fcs?.type || f.type || (heavy ? 'conventional' : 'fbw-fighter');
  const lim = model?.limits || {};
  const gMax = lim.gMax ?? P.limits?.gMax ?? sp.maxG ?? (heavy ? 2.5 : 9);
  const gMin = lim.gMin ?? P.limits?.gMin ?? sp.minG ?? (heavy ? -1 : -3);
  const fcsNzMax = model?.fcs?.nzMax ?? f.nzMax ?? gMax;
  const fcsNzMin = model?.fcs?.nzMin ?? f.nzMin ?? gMin;
  const eng = P.engines || {};
  const ab = /-ab$/.test(eng.type || '') || !!def?.sound?.afterburner;
  const stall = sp.stallSpeed ?? (heavy ? 70 : 65);
  const corner = P.targets?.instantTurnSpeed ?? sp.cornerSpeed ?? (heavy ? stall * 1.9 : Math.max(stall * 2.9, 170));
  const vmo = lim.vmo ?? P.limits?.vmo ?? sp.maxSpeedSeaLevel ?? 250;
  const mmo = lim.mmo ?? P.limits?.mmo ?? sp.maxMach ?? 0.85;
  // the highest AoA the pilot is willing to use in a fight (deg): below the stall, and short of the extreme
  // high-AoA corners of the F-35 / Super Hornet that cost all the energy
  const alphaFcs = (model?.fcs?.alphaMax != null ? model.fcs.alphaMax * 57.2958 : f.alphaMax) ?? (heavy ? 12 : 24);
  return {
    id: def?.id || '?', category: cat, heavy, fighter: !heavy && (cat === 'fighter' || cat === 'attack' || cat === 'recon'),
    fcsType: type, fbw: type !== 'conventional', airliner: type === 'fbw-airliner',
    stickShape: model?.fcs?.stickShape ?? f.stickShape ?? 0.5,
    gMax, gMin, fcsNzMax, fcsNzMin,
    rollRate: model?.fcs?.rollRate ?? ((f.rollRate ?? (heavy ? 15 : 240)) * Math.PI / 180),
    rollFade: model?.fcs?.rollAlphaFade ?? [0.26, 0.52],
    bankMax: model?.fcs?.bankMax || 0,
    ab, stall, corner, vmo, mmo,
    alphaFight: Math.min(alphaFcs - 1.5, heavy ? 12 : 26) * Math.PI / 180,
    alphaFcs: alphaFcs * Math.PI / 180,
    // throttle lever positions: MIL (max dry) and max
    mil: ab ? 0.9 : 1, max: 1,
    hasSpeedbrake: P.drag?.speedbrake != null || P.aero?.drag?.speedbrake != null || !heavy,
  };
}

/**
 * The per-pilot flight controller. Usage each frame:
 *   fc.steer(dirWorld, gLimit, gain[, ffAccelWorld])   or   fc.direct(nz, rollTarget)   then   fc.speed(ias, opts)
 *   fc.apply(dt)   → writes entity.controls
 */
export function createFlightController(e, prof) {
  const fc = {
    prof,
    // request (set by steer/direct/speed, consumed by apply)
    nzCmd: 1, rollErr: 0, rollValid: true, yawCmd: 0, thrCmd: 0.8, sbCmd: 0,
    gLimit: 5, alphaLimit: prof.alphaFight, rollGain: 4.5,
    // inner-loop state
    integ: 0, rollInt: 0, lastStickP: 0, liftWorld: new THREE.Vector3(0, 1, 0),
    reset() { fc.integ = 0; fc.rollInt = 0; },

    /**
     * Lift-vector steering: rotate the velocity vector toward world direction `dir` (unit), turning at
     * `gain` × angle-error (rad/s), plus an optional feed-forward acceleration perpendicular to the velocity
     * (world m/s², e.g. the line-of-sight rate of a target), limited to `gLimit`.
     * Returns the angle (rad) between the velocity vector and dir.
     */
    steer(dir, gLimit, gain = 2.5, ff = null) {
      const s = e.state, vel = s.velocity;
      const V = Math.max(vel.length(), 1);
      _v.copy(vel).multiplyScalar(1 / V);                       // v̂
      const c = clamp(_v.dot(dir), -1, 1), ang = Math.acos(c);
      _n.copy(dir).addScaledVector(_v, -c);                     // turn direction ⟂ v̂
      const nl = _n.length();
      if (nl > 1e-6) _n.multiplyScalar(1 / nl);
      else _n.set(0, 0, 0);
      // centripetal acceleration for the requested turn rate; beyond 90° of error turn at the limit
      const aMax = gLimit * G0;
      let ac = gain * (ang > 1.6 ? 1.6 + (ang - 1.6) * 3 : ang) * V;
      _l.copy(_n).multiplyScalar(ac);
      if (ff) { _l.add(ff); _l.addScaledVector(_v, -_v.dot(ff)); }
      // + gravity compensation (the lift must also hold the aircraft up): lift = a_turn − g⟂
      _l.y += G0; _l.addScaledVector(_v, -_v.y * G0);
      let L = _l.length();
      if (L > aMax) {
        // keep the gravity part, shorten the turn part so |lift| fits (prefer turning over holding altitude when it can't)
        _l.multiplyScalar(aMax / L); L = aMax;
      }
      fc.liftWorld.copy(_l);
      fc.setLift(_l, L / G0, gLimit);
      return ang;
    },

    /** Command a lift vector (world, any length) with load factor nz. Roll puts the lift vector on it. */
    setLift(lw, nz, gLimit) {
      const s = e.state;
      _q.copy(s.quaternion).invert();
      _v.copy(lw).applyQuaternion(_q);                          // in body axes
      const lat = _v.x, up = _v.y;
      fc.gLimit = gLimit;
      if (nz < 0.25 || Math.hypot(lat, up) < 1e-3) { fc.rollValid = false; fc.rollErr = 0; fc.nzCmd = clamp(nz * Math.sign(up || 1), -1, gLimit); return; }
      let re = Math.atan2(lat, up);
      // nearly inverted: keep rolling the way we started (atan2 flips sign at ±180°)
      if (Math.abs(re) > 2.6 && fc.rollValid && fc.rollErr * re < 0 && Math.abs(fc.rollErr) > 2.2) re = re > 0 ? re - 2 * Math.PI : re + 2 * Math.PI;
      fc.rollErr = re; fc.rollValid = true;
      // the G we can use right now is the part of the wanted lift along the current lift axis; pull only once the
      // lift vector is close, unload while rolling (rolls faster, as pilots do)
      const cr = Math.cos(re);
      fc.nzCmd = cr > 0 ? nz * cr * cr : Math.max(nz * cr, -1) * 0.5;
      if (Math.abs(re) > 0.6 && fc.nzCmd > 1.2) fc.nzCmd = Math.max(1.2, fc.nzCmd * 0.6);
    },

    /** Direct command: load factor and a target bank angle (rad, world-referenced). */
    direct(nz, bank, gLimit = 6) {
      fc.nzCmd = nz; fc.gLimit = gLimit; fc.rollErr = wrap(bank - e.state.roll); fc.rollValid = true;
    },

    /** Hold the current roll (no roll command). */
    holdRoll() { fc.rollValid = false; fc.rollErr = 0; },

    /** Speed hold: target IAS (m/s). opts: { ab: allow afterburner, brake: allow the speedbrake, min, max lever } */
    speed(ias, ab = true, brake = true, minLever = 0) {
      const s = e.state, err = ias - s.ias;
      const p = fc.prof;
      // lever: proportional on the speed error around a cruise setting, AB only when well short and allowed
      let lev = 0.72 + err * 0.02 + (fc.nzCmd - 1) * 0.04;
      const top = ab && p.ab ? (err > 15 || fc.nzCmd > 4 ? 1 : p.mil + 0.06) : p.mil;
      lev = clamp(lev, minLever, top);
      fc.thrCmd = lev;
      fc.sbCmd = brake && p.hasSpeedbrake && err < -35 ? clamp((-err - 35) / 30, 0, 1) : 0;
    },

    /** Convert the request into stick / pedal / throttle and write entity.controls. */
    apply(dt) {
      const s = e.state, c = e.controls, p = fc.prof;
      const V = Math.max(s.tas, 30);
      // ---- G request limits: structure, the pilot's G limit, AoA (stall / fight AoA)
      let nz = clamp(fc.nzCmd, Math.max(p.gMin * 0.5, -2), Math.min(fc.gLimit, p.gMax * (p.fbw ? 1 : 0.9)));
      const aLim = Math.min(fc.alphaLimit, p.fbw ? p.alphaFcs : fc.alphaLimit);
      const sm = e.sim?.debug?.aero?.stallMargin;              // rad to the angle of maximum lift (flight model)
      const aCap = sm != null && sm < 1 ? Math.min(aLim, s.aoa + sm - 0.05) : aLim;
      if (s.aoa > 0.03 && nz > 0) {
        const nzA = Math.max(s.gLoad, 0.3) * (aCap / s.aoa);
        if (nzA < nz) nz = Math.max(nzA, Math.min(nz, 0.6));
      }
      if (s.stalled && nz > 0.5) nz = 0.5;
      // ---- pitch
      const cth = Math.cos(s.pitch), cphi = Math.cos(s.roll);
      let stick;
      if (p.fbw) {
        let nComp = cth * cphi;
        if (p.airliner) { const cb = Math.cos(Math.min(Math.abs(s.roll), 33 * Math.PI / 180)); nComp = cth / (cb > 0.5 ? cb : 0.5); }
        const want = nz + fc.integ;
        const sN = want >= nComp ? (want - nComp) / Math.max(p.fcsNzMax - nComp, 0.5) : (want - nComp) / Math.max(nComp - p.fcsNzMin, 0.5);
        stick = invShape(clamp(sN, -1, 1), p.stickShape);
        // slow trim of the residual G error (FBW tracks well; this removes biases from damage / AoA limiting)
        if (!s.stallWarning && s.aoa < aCap - 0.03 && s.aoa > -0.08) fc.integ = clamp(fc.integ + (nz - s.gLoad) * 0.4 * dt, -0.8, 0.8);
        else fc.integ *= 1 - Math.min(1, 2 * dt);
      } else {
        // conventional: PI on the load factor + pitch-rate damping
        const err = nz - s.gLoad;
        const qbar = 0.5 * 1.225 * Math.exp(-s.position.y / 9000) * V * V;
        const k = clamp(9000 / Math.max(qbar, 2000), 0.4, 3);      // more stick for the same G when slow
        const aHi = s.aoa - aCap, aLo = -0.12 - s.aoa;               // AoA protection (both signs)
        let prot = 0;
        if (aHi > 0) prot = -aHi * 4; else if (aLo > 0) prot = aLo * 4;
        const KI = 0.15, KP = 0.06, KQ = 0.6;
        if (prot === 0 || (prot < 0 && err < 0) || (prot > 0 && err > 0)) fc.integ = clamp(fc.integ + err * KI * k * dt, -1, 1);
        else fc.integ = clamp(fc.integ + prot * 0.5 * dt, -1, 1);
        stick = clamp(fc.integ + err * KP * k - s.bodyRates.q * KQ + prot, -1, 1);
        if (s.stalled) fc.integ = Math.min(fc.integ, 0.0);
      }
      c.pitch = clamp(stick, -1, 1);
      // ---- roll: rate command from the roll error
      let pDes = 0;
      // roll-angle loop with lead on the current roll rate (conventional aircraft respond slower: more lead)
      const tau = p.fbw ? 0.06 : 0.3;
      if (fc.rollValid) pDes = clamp((fc.rollErr - s.bodyRates.p * tau) * fc.rollGain, -p.rollRate, p.rollRate);
      else pDes = 0;
      let rs;
      if (p.fbw) {
        const af = clamp((Math.abs(s.aoa) - p.rollFade[0]) / (p.rollFade[1] - p.rollFade[0]), 0, 1);
        const pMax = p.rollRate * (1 - 0.65 * af);
        rs = invShape(clamp(pDes / pMax, -1, 1), p.stickShape);
        if (p.airliner && fc.rollValid && Math.abs(fc.rollErr) < 0.02) rs = 0;
      } else {
        const pr = s.bodyRates.p;
        fc.rollInt = clamp(fc.rollInt + (pDes - pr) * 0.6 * dt, -0.5, 0.5);
        rs = clamp(pDes / p.rollRate + (pDes - pr) * 0.5 + fc.rollInt, -1, 1);
      }
      c.roll = clamp(rs, -1, 1);
      c.yaw = clamp(fc.yawCmd, -1, 1);
      c.throttle = clamp(fc.thrCmd, 0, 1);
      c.speedbrake = fc.sbCmd > 0.5 ? 1 : 0;
      fc.yawCmd = 0;
    },
  };
  return fc;
}

function wrap(a) { return a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI; }
