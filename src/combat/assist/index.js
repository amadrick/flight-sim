// PLAYER FLIGHT ASSIST — point-to-fly steering for phones, keyboards and pads (COMBAT.md §15).
//
// combat.pre(dt) calls update(dt) after the input layer and before the player's physics, only while a human flies.
// It reads ctx.controls.pitch / roll as the player's INTENT (a nose rate) and overwrites pitch / roll / yaw with what
// the aircraft needs; throttle and speedbrake stay the player's (rookie auto-throttle aside).
//
//   stick     → turns a commanded NOSE direction N (assist.command — the HUD can draw it as the "nose goes here"
//               reticle) at a nose rate in the stick frame: right = the nose goes right (a level turn in the default
//               horizon frame), back = nose up, diagonal = both. Rate = available turn rate × expo: taps give small
//               corrections, a held stick builds to the maximum-performance turn (AoA / G limit).
//   flying N  → the flight path P that puts the nose on N (N less the AoA along the commanded lift, plus a slow
//               integral), flown by ai/fly.js lift-vector steering with gravity compensation and the commanded rate as
//               feed-forward; gentle for small errors (small bank, no roll-pull-roll), pushes rather than rolls for
//               small or nose-down corrections.
//   keys      → tap = a fixed nose step, hold = a rate ramping to the full turn, the opposite key just after = stop.
//   release   → after a held hard turn: the turn's extra lift is shed at the rate the AoA can die away while the path
//               catches up, so the nose stops where it was let go (or a little beyond, never behind), then the path
//               holds; after a tap N simply stays. Near level the wings come back level; a dive or climb is kept.
//   gun help  → with a target selected, in gun range, and its lead solution a few degrees off the nose, N is drawn to
//               the solution, scaled by how close the player already is and faded by stick opposition.
//   pointer   → aim.active: N = the camera ray through screen point aim.{x, y} (mouse-aim style).
//   protects  → AoA / G limit, low-speed nose cap (rookie, veteran), ground pull-up cue (all) that takes over at the
//               last moment (rookie), auto-throttle after the throttle sits untouched (rookie).
//
// Pure logic: no DOM; allocations only when the player's aircraft changes.
import * as THREE from 'three';
import { clamp, G0 } from '../util.js';
import { profileOf, createFlightController } from '../ai/fly.js';
import { predictRecovery } from '../ai/safety.js';
import { KEY_AXIS } from '../../input/logic.js';

/** Per-difficulty defaults. alpha: × the fight AoA (ace: up to the FCS / stall AoA). */
export const ASSIST_DIFFICULTY = {
  rookie: { mode: 'assist', aim: 0.8, alpha: 0.92, g: 0.95, speed: true, ground: true, autoThrottle: true },
  veteran: { mode: 'assist', aim: 0.4, alpha: 1, g: 1, speed: true, ground: false, autoThrottle: true },   // a thumb that never touches the throttle fights 140 kt slower than the bandit
  ace: { mode: 'off', aim: 0, alpha: 0, g: 1, speed: false, ground: false, autoThrottle: false },
};

/** Tuning (exported for the tests / bench). */
export const ASSIST_TUNING = {
  mRise: 4,            // 1/s: fastest growth of the stick magnitude
  expo: 0.3,           // stick shaping: rate = m·(1 − expo + expo·m²) of the maximum (on top of the input layer's own expo)
  leadMin: 0.035,      // rad: how far N may sit ahead of the nose with the stick released
  leadMax: 0.32,       // rad: … at full stick
  ffTau: 2,            // s: smoothing of the stick's feed-forward (a held turn's rate is learned, a jittery thumb is not)
  ffTauRel: 1,         // s: … with the stick released (it dies away quickly)
  ffGain: 1,
  leadDecay: 0.1,      // rad/s: how fast the allowed lead shrinks when the stick is eased
  releaseClamp: 1,     // 1: on release N is pulled back to leadMin ahead of the nose; 0: N stays where the stick left it
  releaseClampKeys: 0, // … for keys (the reticle stays where the key left it)
  pushG: 0.5,          // g: below this much lift a small correction pushes instead of rolling
  gainSmall: 1.2,      // 1/s: flight-path steering gain for small errors (bank stays small)
  gainBig: 2.5,        // 1/s: … for large errors
  smallLo: 0.03, smallHi: 0.1,    // rad: path errors where the small gain hands over to the large one
  releaseNose: 0.7,    // × the roll-out time constant V·(AoA per g)/g (1 = the nose stops where it was let go)
  settleHold: 0.7,     // s: a hard turn held this long gets the roll-out on release (taps do not)
  settleMax: 4,        // s: longest roll-out after a release
  settleEnd: 0.08,     // the roll-out ends once the extra lift has decayed to this share
  settleBack: 0.08,    // rad: nose this far behind where it was let go = the extra lift is held (not shed)
  settleFollow: 1,     // the hold point follows the nose while it still swings on after the release
  settleDump: 0.45,    // share of the extra lift dropped at once on release
  settleKa: 0,        // 1/(rad·s): extra shedding rate per rad the nose runs past where it was let go
  aoaShare: 0.8,       // share of the AoA taken off nose aims (the integral below trims the rest)
  noseKi: 1.0,         // 1/s: integral of the nose error near the aim
  liftTau: 0.2,        // s: smoothing of the lift direction used for the same
  aoaTau: 0.15,        // s: smoothing of the AoA used to turn nose aims into path aims (faster = G oscillation)
  rudder: 0,         // rudder per rad of small lateral nose error
  frameRelax: 2.5,     // rad/s: the stick frame re-erects to the horizon when not pulling through the vertical
  touchPitch: 1,       // raw touch y → nose up (+y = drag down = stick back; checked in the page)
  touchDead: 0.04,     // radial dead zone of the raw touch stick
  expoTouch: 0,        // the assist's expo on the raw touch stick (linear: a phone thumb has no fine control to spend it on)
  mRiseTouch: 6,       // 1/s: fastest growth of the touch stick magnitude
  slowOn: 0.8, slowOff: 0.88,     // info.slow below this share of the fight speed (off again above the second)
  keyStep: 0.03,       // rad (1.7°): the nose step of one key tap
  keyStepRate: 0.45,   // rad/s: how fast a tap's step is applied
  keyTap: 0.15,        // s: a key held longer than this starts the continuous nose rate …
  keyRamp: 0.4,        // s: … which ramps to the full rate over this
  keyCancel: 0.4,      // s: an opposite key within this of letting a key go cancels the motion still to come
  gunWin: 0.1,         // rad: gun help acts inside this angle between the nose and the lead solution
  gunRate: 7,          // 1/s: how fast N is drawn to the solution at full help
  gunRange: 1400,      // m
  thrIdle: 3,          // s untouched before the rookie auto-throttle engages
  thrHold: 10,         // s off after any throttle input
  gearAgl: 61,         // m (200 ft): gear down below this = landing / takeoff, the assist stays out
  blendIn: 0.35,       // s: hand-over ramp when the assist engages
};

const COMBAT_CAMS = new Set(['missile', 'kill', 'victory']);
const _f = new THREE.Vector3(), _h = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();
const _vh = new THREE.Vector3(), _cr = new THREE.Vector3(), _cu = new THREE.Vector3(), _ff = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const SOL = { point: new THREE.Vector3(), dir: new THREE.Vector3(), tof: 0, range: 0, inRange: false };
const RS = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, roll: 0, psi: 0 }, REC = { clear: 0, at: 0, ground: 0 };
const RP = { nz: 4, rollRate: 2, climb: 0.3, turn: 0, horizon: 10, dt: 0.35, delay: 0.25 };

/** Stick magnitude 0..1 → fraction of the maximum nose rate. */
export function shapeRate(m, expo = ASSIST_TUNING.expo) { m = clamp(m, 0, 1); return m * (1 - expo + expo * m * m); }

/** Rotate unit vector `a` toward unit `b` by at most `ang` (rad), in place. Returns the angle that was left. */
export function rotateToward(a, b, ang) {
  const c = clamp(a.dot(b), -1, 1), full = Math.acos(c);
  if (full <= ang || full < 1e-6) { a.copy(b); return 0; }
  _p.copy(b).addScaledVector(a, -c);
  const pl = _p.length();
  if (pl < 1e-6) return full;
  _p.multiplyScalar(1 / pl);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  a.multiplyScalar(ca).addScaledVector(_p, sa).normalize();
  return full - ang;
}

/**
 * The key behind a key-ramped axis value (src/input/logic.js stepKeyAxis), from this frame's value and the last:
 * moving away from the centre (or pinned at ±1) = that key held; moving toward it faster than the auto-centring =
 * the opposite key; otherwise none. Also right for raw ±1 / 0 keys.
 */
export function keyDir(v, vp, dt) {
  const av = Math.abs(v);
  if (av >= 0.999) return Math.sign(v);
  if (av < 1e-6) return 0;
  const dv = v - vp;
  if (v * dv > 1e-9) return Math.sign(v);
  if (dv * (v || vp) < 0 && Math.abs(dv) > KEY_AXIS.centre * 1.1 * dt) return -Math.sign(v || vp);
  return 0;
}

export function createAssist(combat) {
  const T = ASSIST_TUNING;
  const st = {
    ent: null, prof: null, fc: null, engaged: false, t: 0, blend: 0,
    A: new THREE.Vector3(0, 0, -1), P: new THREE.Vector3(0, 0, -1), R: new THREE.Vector3(1, 0, 0), U: new THREE.Vector3(0, 1, 0),
    aoaS: 0, safeT: 0, clear: 1e9, mPrev: 0, mEff: 0, holdT: 0, holdHi: 0, settle: 0, Ps: new THREE.Vector3(), E: new THREE.Vector3(), eMag: 0, settleTau: 1, settleT: 0, vPrev: new THREE.Vector3(), nAero: 9, nI: new THREE.Vector3(), Ld: new THREE.Vector3(0, 1, 0), recovering: false, recHdg: 0,
    thrWritten: -1, thrTouchT: -1e9, thrTouched: false, auto: false,
    modeSet: false, aimSet: false,
    coordTaken: false, coordSaved: true, touchHeld: false, lead: 0, wMax: 0.4, ffS: new THREE.Vector3(), kv: [0, 0], kd: [0, 0], kt: [0, 0], kpend: [0, 0], kEnd: [-9, -9], kLast: [0, 0], keys: false,
  };

  const assist = {
    mode: 'off',
    aim: { x: 0, y: 0, active: false },
    aimAssist: 0,
    /** Stick frame: 'horizon' (default) or 'view' (see update). */
    frame: 'horizon',
    /** What the stick is: 'auto' (keys when the simulator's input mode is keyboard / mouse without the mouse yoke),
     *  'analog' or 'keys'. Keys get their own law: tap = a small fixed nose step, hold = a rate ramping to the full
     *  turn, the opposite key right after = stop. */
    device: 'auto',
    info: { mode: 'off', active: false, gunAssist: false, limiting: '', pullUp: false, autoThrottle: false, aimPoint: false, keys: false, touch: false, fightSpeed: 0, slow: false },
    /** The commanded nose direction, the flight path that gives it (world, unit) and the stick frame (right / up,
     *  world) — for HUD cues (e.g. a reticle where the nose is going). */
    command: st.A, path: st.P, frameRight: st.R, frameUp: st.U,

    /** 'assist' | 'off'; null / 'auto' returns to the difficulty default (assist on rookie and veteran). */
    setMode(m) {
      if (m == null || m === 'auto') { st.modeSet = false; defaults(); return; }
      st.modeSet = true; assist.mode = m === 'assist' ? 'assist' : 'off'; assist.info.mode = assist.mode;
      if (assist.mode === 'off') disengage();
    },
    /** 0..1 gun aim help; null returns to the difficulty default. */
    setAimAssist(v) {
      if (v == null) { st.aimSet = false; defaults(); return; }
      st.aimSet = true; assist.aimAssist = clamp(+v || 0, 0, 1);
    },
    reset() {
      disengage(); st.ent = null; st.t = 0; st.thrTouchT = -1e9; st.thrTouched = false; st.thrWritten = -1;
      assist.aim.active = false; defaults();
    },
    update,
    /** Internal state (tools / tests). */
    _st: st,
  };

  function diff() { return ASSIST_DIFFICULTY[combat.difficulty] || ASSIST_DIFFICULTY.veteran; }
  function defaults() {
    const d = diff();
    if (!st.modeSet) assist.mode = d.mode;
    if (!st.aimSet) assist.aimAssist = d.aim;
    assist.info.mode = assist.mode;
  }
  /** The touch stick: while the assist steers it reads ctx.input.touch.raw and turns the simulator's own rudder
   *  auto-coordination off; this gives it back. */
  function restoreCoord() {
    if (!st.coordTaken) return;
    st.coordTaken = false;
    const t = combat.ctx?.input?.touch;
    if (t) t.autoCoord = st.coordSaved;
  }
  function disengage() {
    restoreCoord();
    st.engaged = false; st.recovering = false; st.auto = false;
    const i = assist.info; i.active = false; i.gunAssist = false; i.limiting = ''; i.pullUp = false; i.autoThrottle = false; i.aimPoint = false; i.keys = false; i.touch = false; i.slow = false;
    st.kd[0] = st.kd[1] = 0; st.kpend[0] = st.kpend[1] = 0;
  }
  function bind(e) {
    st.ent = e; st.prof = profileOf(e.def, e.sim); st.fc = createFlightController(e, st.prof);
    st.engaged = false; st.thrTouchT = st.t; st.thrTouched = false; st.thrWritten = -1;
  }
  /** Flight path direction → the nose direction that flies it (in place; inverse of noseToPath). */
  function pathToNose(v) {
    const vh = _vh, fl = st.Ld, a = st.aoaS;
    _cu.copy(fl).addScaledVector(vh, -vh.dot(fl));
    const l = _cu.length();
    if (l > 1e-3 && a > 0) v.addScaledVector(_cu, Math.tan(a) * ASSIST_TUNING.aoaShare / l);
    return v.normalize();
  }
  /** Nose direction → the flight path direction that puts the nose there (in place). */
  function noseToPath(v) {
    const vh = _vh, fl = st.Ld, a = st.aoaS;
    _cu.copy(fl).addScaledVector(vh, -vh.dot(fl));
    const l = _cu.length();
    if (l > 1e-3 && a > 0) v.addScaledVector(_cu, -Math.tan(a) * ASSIST_TUNING.aoaShare / l);
    return v.normalize();
  }
  const ground = (x, z) => combat.ctx?.world?.groundHeightAt?.(x, z) ?? 0;

  function update(dt) {
    defaults();
    const info = assist.info;
    info.gunAssist = false; info.limiting = ''; info.pullUp = false; info.aimPoint = false;
    const e = combat.world?.player;
    if (!e || !e.alive || e.pilot || !(dt > 0) || assist.mode !== 'assist') { if (st.engaged) disengage(); info.active = false; return; }
    if (e !== st.ent) bind(e);
    const s = e.state, c = e.controls, prof = st.prof, fc = st.fc, d = diff();
    st.t += dt;
    // throttle: the input layer only moves the lever on player input — any difference to what we wrote is the player
    if (st.thrWritten >= 0 && Math.abs(c.throttle - st.thrWritten) > 1e-4) { st.thrTouchT = st.t; st.thrTouched = true; }
    // ---- stay out: ground, takeoff / landing, autopilot, mission over
    const p = s.position, agl = p.y - ground(p.x, p.z);
    const gearDown = (s.surfaces?.gear ?? (s.gearDown ? 1 : 0)) > 0.5;
    if (s.onGround || s.crashed || s.ap?.engaged || combat.result || (gearDown && agl < T.gearAgl)) {
      if (st.engaged) disengage();
      info.active = false; st.thrWritten = c.throttle; return;
    }
    const F = _f.set(0, 0, -1).applyQuaternion(s.quaternion);
    const N = st.A, P = st.P, R = st.R, U = st.U;       // N: commanded NOSE direction; P: the flight path that gives it
    const vh = _vh.copy(s.velocity).normalize();
    if (!st.engaged) {
      st.engaged = true; st.blend = 0; st.nAero = 9; st.mPrev = 0; fc.reset(); fc.trackValid = false; st.recovering = false;
      N.copy(F); st.aoaS = Math.max(s.aoa || 0, 0); st.nI.set(0, 0, 0); st.Ld.copy(e.up || UP); st.settle = 0; st.vPrev.copy(vh);
      R.crossVectors(N, UP); if (R.lengthSq() < 1e-4) R.set(1, 0, 0).applyQuaternion(s.quaternion); R.normalize();
    }
    st.aoaS += (Math.max(s.aoa || 0, 0) - st.aoaS) * Math.min(1, dt / T.aoaTau);
    // the commanded lift direction, smoothed (where the nose sits off the path; a raw one flips with each correction)
    {
      const fl = fc.liftWorld, L = fl.length();
      if (L > 0.5 * G0) _d.copy(fl).multiplyScalar(1 / L); else _d.copy(e.up || UP);
      st.Ld.lerp(_d, Math.min(1, dt / T.liftTau)).normalize();
    }
    info.active = true;
    st.blend = Math.min(1, st.blend + dt / T.blendIn);
    // ---- the stick. Touch: the raw floating stick (unit circle, +y = drag down = stick back = nose up), with the
    // simulator's rudder auto-coordination off; the assist shapes it itself. Otherwise ctx.controls as the input
    // layer shaped it.
    const inp = combat.ctx?.input, tch = inp?.touch, raw = tch?.raw;
    const touch = !!(raw && tch.visible && (inp.mode === 'touch' || raw.held));
    let sx, sy, rz;
    if (touch) {
      const first = !st.coordTaken;
      if (first) { st.coordSaved = tch.autoCoord !== false; st.coordTaken = true; tch.autoCoord = false; }
      const rx = clamp(raw.x || 0, -1, 1), ry = clamp(raw.y || 0, -1, 1) * T.touchPitch, rm = Math.hypot(rx, ry);
      // radial dead zone only: the expo is the assist's own (shapeRate with expoTouch)
      const k = rm > T.touchDead ? Math.min(1, (rm - T.touchDead) / (1 - T.touchDead)) / rm : 0;
      sx = rx * k; sy = ry * k;
      rz = first ? 0 : clamp(c.yaw || 0, -1, 1);                    // the rudder slider when used (else 0 now)
      // the thumb lifted: a real release, at once (also with the simulator's auto-centre off)
      if (!raw.held) { sx = 0; sy = 0; }
      st.touchHeld = !!raw.held;
    } else {
      restoreCoord();
      sx = clamp(c.roll || 0, -1, 1); sy = clamp(c.pitch || 0, -1, 1); rz = clamp(c.yaw || 0, -1, 1);
    }
    info.touch = touch;
    const thr0 = c.throttle, sb0 = c.speedbrake;
    const V = Math.max(s.tas || s.velocity.length(), 40), ias = Math.max(s.ias || V, 1);
    const gLim = Math.min(prof.gMax, prof.fbw ? prof.fcsNzMax : prof.gMax) * d.g;
    fc.alphaLimit = d.alpha > 0 ? prof.alphaFight * d.alpha : prof.alphaFcs;

    // ---- stick frame (R right, U up, both ⟂ N).
    //   'horizon': R horizontal (re-erected to the horizon unless pulling through the vertical) — hold right = a
    //              level turn; matches the screen when the view keeps its horizon level.
    //   'view':    R / U follow the view's own right / up (the camera, or the aircraft's axes without one) — the stick
    //              moves the nose exactly as the screen shows it, also when the view rolls with the aircraft.
    R.addScaledVector(N, -R.dot(N));
    if (R.lengthSq() < 1e-6) R.crossVectors(N, UP);
    R.normalize();
    const cam = combat.ctx?.camera, camOk = !!(cam && cam.quaternion && !COMBAT_CAMS.has(combat.camera?.mode));
    let k = 0;
    if (assist.frame === 'view') {
      if (camOk) _h.set(1, 0, 0).applyQuaternion(cam.quaternion); else _h.set(1, 0, 0).applyQuaternion(s.quaternion);
      _h.addScaledVector(N, -_h.dot(N));
      const hl = _h.length();
      if (hl > 0.05) { _h.multiplyScalar(1 / hl); k = 1e9; }
    } else {
      _h.crossVectors(N, UP);
      const hl = _h.length();
      if (hl > 0.05) { _h.multiplyScalar(1 / hl); k = T.frameRelax * Math.min(1, hl * 3) * (1 - 0.95 * Math.abs(sy)) * dt; }
    }
    if (k > 0) {
      const phi = Math.atan2(_d.crossVectors(R, _h).dot(N), clamp(R.dot(_h), -1, 1));
      const th = clamp(phi, -k, k);
      if (th !== 0) { _d.crossVectors(N, R); R.multiplyScalar(Math.cos(th)).addScaledVector(_d, Math.sin(th)).normalize(); }
    }
    U.crossVectors(R, N).normalize();

    // ---- stick → nose rate
    const nAvail = Math.max(1.05, Math.min(gLim, (ias / Math.max(prof.stall, 40)) ** 2 * 0.95));
    // full stick asks a little more than the G limit (the AoA / G limiters in fly.js cut it to the best turn)
    const wMax = Math.max(0.2, gLim * 1.1 * G0 / V);
    st.wMax = wMax;
    // stick magnitude, rising at most at mRise per second (a tapped or flicked stick gives a small correction; holding it
    // builds to the full-rate turn), falling at once
    const keys = !touch && assist.device === 'keys' || (assist.device === 'auto' && !!inp && (inp.mode === 'keyboard' || inp.mode === 'mouse') && !inp.mouseYoke);
    info.keys = keys;
    _ff.set(0, 0, 0);
    let m, sh;
    if (keys) {
      // keys: per axis, recover the key from the key-ramped axis value, then tap = a fixed nose step, hold = a rate
      // ramping to the full turn, the opposite key just after = stop (the motion still to come is dropped)
      let mx = 0, my = 0, rx = 0, ry = 0;
      for (let i = 0; i < 2; i++) {
        const v = i ? sy : sx, vp = st.kv[i], dir = keyDir(v, vp, dt), A = i ? U : R;
        st.kv[i] = v;
        const was = st.kd[i];
        if (dir !== was) {
          if (was !== 0) { st.kEnd[i] = st.t; st.kLast[i] = was; }
          if (dir !== 0) {
            st.kt[i] = 0;
            if (st.kLast[i] === -dir && st.t - st.kEnd[i] < T.keyCancel) {
              // stop: drop the pending step and N's lead along this axis (the nose stops about where it is)
              st.kpend[i] = 0;
              const lead = _d.copy(N).sub(F).dot(A);
              if (lead * dir < 0) N.addScaledVector(A, -lead).normalize();
              st.kLast[i] = 0; st.kEnd[i] = -9;
              st.kt[i] = -T.keyTap * 0.5;                                     // a cancelling tap does not step
            } else st.kpend[i] += dir * T.keyStep;
          }
          st.kd[i] = dir;
        }
        let r = 0;
        if (dir !== 0) { st.kt[i] += dt; r = clamp((st.kt[i] - T.keyTap) / T.keyRamp, 0, 1); }
        const pend = st.kpend[i], stp = Math.sign(pend) * Math.min(Math.abs(pend), T.keyStepRate * dt);
        st.kpend[i] -= stp;
        const mv = dir * r * wMax * dt + stp;
        if (i) { my = mv; ry = dir * r; } else { mx = mv; rx = dir * r; }
      }
      if (mx !== 0 || my !== 0) N.addScaledVector(R, mx).addScaledVector(U, my).normalize();
      _ff.copy(R).multiplyScalar(rx * wMax * V).addScaledVector(U, ry * wMax * V);
      m = Math.min(1, Math.hypot(rx, ry)); sh = m; st.mEff = m;
    } else {
      st.kd[0] = st.kd[1] = 0; st.kv[0] = sx; st.kv[1] = sy; st.kpend[0] = st.kpend[1] = 0;
      const mRaw = Math.min(1, Math.hypot(sx, sy));
      st.mEff = mRaw < st.mEff ? mRaw : Math.min(mRaw, st.mEff + (touch ? T.mRiseTouch : T.mRise) * dt);
      m = st.mEff; sh = shapeRate(m, touch ? T.expoTouch : T.expo);
      const w = sh * wMax;
      if (m > 1e-3) {
        const ux = sx / Math.max(mRaw, 1e-6), uy = sy / Math.max(mRaw, 1e-6);
        _d.copy(R).multiplyScalar(ux).addScaledVector(U, uy);          // direction the nose is asked to move (world)
        N.addScaledVector(_d, w * dt).normalize();
        _ff.copy(_d).multiplyScalar(w * V);                           // feed-forward: turn the flight path at that rate
      }
    }
    st.holdT = m > 0.6 ? st.holdT + dt : m < 0.3 ? 0 : st.holdT;     // how long a hard turn has been held
    // rudder pedals: a small yaw rate about the frame up axis (fine aim)
    if (rz !== 0) N.addScaledVector(R, rz * 0.12 * dt).normalize();

    if (assist.aim.active && camOk) {
      // ---- pointer aim (mouse-aim): the nose goes to the camera ray through the screen point
      const tv = Math.tan(((cam.fov || 60) * Math.PI / 360)), th = tv * (cam.aspect || 1);
      _cr.set(1, 0, 0).applyQuaternion(cam.quaternion); _cu.set(0, 1, 0).applyQuaternion(cam.quaternion);
      N.set(0, 0, -1).applyQuaternion(cam.quaternion)
        .addScaledVector(_cr, clamp(assist.aim.x, -1, 1) * th).addScaledVector(_cu, clamp(assist.aim.y, -1, 1) * tv).normalize();
      _ff.set(0, 0, 0); info.aimPoint = true;
    } else if (m >= 0.05 || st.mPrev >= 0.05) {
      // lead clamp while the stick is in use and on release: N never runs far ahead of the nose (release = the nose
      // stops about where it was let go); released, N stays put in the world
      // the allowed lead grows at once with the stick but shrinks only slowly (easing the stick must not yank the
      // reticle back toward the nose: the player steers by it)
      const Lw = T.leadMin + (T.leadMax - T.leadMin) * sh;
      st.lead = Math.max(Lw, Math.min(st.lead, T.leadMax) - T.leadDecay * dt);
      const L = m >= 0.05 || !(keys ? T.releaseClampKeys : T.releaseClamp) ? st.lead : T.leadMin;
      if (N.dot(F) < Math.cos(L)) { _d.copy(N); N.copy(F); rotateToward(N, _d, L); }
      st.settle = 0;
      if (m > 0.3) st.holdHi = st.holdT;
      // released after a real manoeuvre: roll out on the flight path first (below)
      if (m < 0.05 && st.holdHi > T.settleHold) {
        // the turn's extra lift (beyond what holds a straight path), to be shed over tau = V·(AoA per g)/g: the AoA
        // then dies away exactly as fast as the path catches up with the nose, so the nose stops where it was let go
        const n = Math.max(Math.abs(s.gLoad || 1), 1);
        st.E.copy(st.Ld).multiplyScalar(n * G0);
        st.E.y -= G0; st.E.addScaledVector(vh, vh.y * G0 - vh.dot(st.E));
        st.eMag = st.E.length();
        st.settleTau = clamp(V * (Math.max(s.aoa || 0, 0) / n) / G0 * T.releaseNose, 0.2, 2.5);
        st.Ps.copy(F); st.settle = 1 - T.settleDump; st.settleT = 0;
      }
    }

    // ---- gun aim help: the nose drawn onto the lead solution
    const tgt = e.target;
    if (assist.aimAssist > 0 && tgt && tgt.alive && tgt.kind === 'aircraft' && combat.weapons?.gunSolution && e.loadout?.gun) {
      combat.weapons.gunSolution(e, tgt, SOL);
      if (SOL.inRange !== false && SOL.range < T.gunRange) {
        const eg = Math.acos(clamp(F.dot(SOL.dir), -1, 1));
        if (eg < T.gunWin) {
          const close = 1 - eg / T.gunWin, closeK = close * close * (3 - 2 * close);
          // opposition: the stick pushing away from the solution (screen frame); big deflections = manoeuvring
          let opp = 0;
          if (m > 0.05) {
            _p.copy(SOL.dir).addScaledVector(F, -F.dot(SOL.dir));
            const pl = _p.length();
            if (pl > 1e-5) { const dx = _p.dot(R) / pl, dy = _p.dot(U) / pl; opp = Math.max(0, -(sx * dx + sy * dy)); }
          }
          const fade = clamp(1 - 2.5 * opp, 0, 1) * clamp(2.2 - 1.6 * m, 0, 1);
          const kk = assist.aimAssist * closeK * fade;
          if (kk > 0.01) {
            rotateToward(N, SOL.dir, Math.acos(clamp(N.dot(SOL.dir), -1, 1)) * Math.min(1, kk * T.gunRate * dt));
            // feed-forward: follow the target's manoeuvre (its smoothed acceleration across our path)
            const ta = tgt.wpn?.accS || tgt.state.acceleration;
            if (ta) { _ff.addScaledVector(ta, kk); _ff.addScaledVector(vh, -vh.dot(ta) * kk); }
            info.gunAssist = true;
          }
        }
      }
    }

    // roll-out after a release: the path aim sits a little ahead of the flight path (part of the turn's extra AoA) and
    // is never left behind it (no reversal while the turn dies away); the nose command follows the nose. Ends when the
    // path has stopped turning; from then on N holds.
    let decay = 0;
    if (st.settle > 0 && m < 0.05 && !info.aimPoint) {
      st.settleT += dt;
      st.E.addScaledVector(vh, -vh.dot(st.E));
      const el = st.E.length();
      if (el > 1e-6) st.E.multiplyScalar(1 / el);
      // closed on the nose: shed faster while the nose runs past where it was let go, hold the turn while it falls back
      let ahead = F.dot(st.E) - st.Ps.dot(st.E);
      // the nose still swinging on (the aircraft's own lag): the hold point goes with it — never pulled back
      if (ahead > 0 && T.settleFollow) { st.Ps.addScaledVector(st.E, ahead).normalize(); ahead = 0; }
      const rate = Math.max(0, 1 + ahead / T.settleBack) / st.settleTau + Math.max(0, ahead) * T.settleKa;
      st.settle *= Math.exp(-rate * dt);
      decay = st.settle;
      if (decay < T.settleEnd || st.settleT > T.settleMax) { st.settle = 0; decay = 0; pathToNose(N.copy(vh)); }
      else {
        // shed the extra lift (kept ⟂ the path as it turns); the nose command stays where the nose was let go
        _ff.addScaledVector(st.E, st.eMag * decay);
        N.copy(st.Ps);
      }
    } else st.settle = 0;
    st.vPrev.copy(vh);

    // ---- protections
    let gUse = gLim;
    if (d.speed && !st.recovering) {
      // slow: cap how far above the horizon the nose may be commanded (path from 30° at 1.6 Vs to −6° at 1.15 Vs)
      const vs = Math.max(prof.stall, 40), r = clamp((ias / vs - 1.15) / 0.45, 0, 1);
      if (r < 1) {
        const gmax = -0.1 + 0.62 * r + (s.aoa || 0), el = Math.asin(clamp(N.y, -1, 1));
        if (el > gmax && s.velocity.y > -5) {
          _h.set(N.x, 0, N.z); if (_h.lengthSq() < 1e-6) _h.copy(F).setY(0); _h.normalize();
          N.copy(_h).multiplyScalar(Math.cos(gmax)).setY(Math.sin(gmax)).normalize();
          info.limiting = 'speed';
        }
      }
    }
    // the flight path that puts the nose on N: N less the AoA (a share of it — the full AoA feeds the G back into the
    // aim and the G oscillates) plus a slow integral of the remaining nose error
    _d.copy(N).sub(F);
    if (N.dot(F) > Math.cos(T.smallHi)) st.nI.addScaledVector(_d, T.noseKi * dt); else st.nI.multiplyScalar(Math.exp(-3 * dt));
    st.nI.addScaledVector(N, -st.nI.dot(N));
    if (st.nI.length() > 0.1) st.nI.setLength(0.1);
    if (st.settle > 0) { P.copy(vh); st.nI.set(0, 0, 0); } else noseToPath(P.copy(N).add(st.nI).normalize());
    // ground: predict a max-performance recovery starting now (with reaction delay); cue on every difficulty, take over
    // at the last moment on rookie
    st.safeT -= dt;
    if (st.safeT <= 0) {
      st.safeT = 0.1;
      RS.x = p.x; RS.y = p.y - 3; RS.z = p.z; RS.vx = s.velocity.x; RS.vy = s.velocity.y; RS.vz = s.velocity.z; RS.roll = s.roll; RS.psi = s.heading || 0;
      RP.nz = Math.max(1.3, Math.min(gLim * 0.85, nAvail * 0.85, fc.nzFull * 0.9));   // nzFull: what full stick gives now (heavy jets run out of elevator when fast) RP.rollRate = Math.min(prof.rollRate, 3) * 0.8;
      RP.climb = 0.3; RP.turn = 0; RP.horizon = clamp(V / 22, 6, 16); RP.delay = st.recovering ? 0 : 0.3;
      predictRecovery(ground, RS, RP, REC);
      st.clear = REC.clear;
    }
    const cue = st.clear < 80 + V * 0.8, last = st.clear < 30 + V * 0.25;
    if (cue && s.velocity.y < 0) info.pullUp = true;
    if (d.ground && (last && s.velocity.y < 0) && !st.recovering) { st.recovering = true; st.recHdg = Math.atan2(s.velocity.x, -s.velocity.z); }
    if (st.recovering) {
      if (st.clear > 60 + V * 0.6 && s.velocity.y > -2) st.recovering = false;
      else {
        P.set(Math.sin(st.recHdg) * Math.cos(0.35), Math.sin(0.35), -Math.cos(st.recHdg) * Math.cos(0.35));
        N.copy(F); _ff.set(0, 0, 0);
      }
    }
    if (info.pullUp || st.recovering) info.limiting = 'ground';

    // ---- fly P
    st.mPrev = m;
    // the G the wing can give right now (AoA headroom): steering must know it, or a turn asked beyond it banks too far
    // and the nose drops (the gravity part of the lift is kept when the request saturates)
    const aoa = s.aoa || 0, nNow = aoa > 0.04 ? Math.max(1.1, Math.abs(s.gLoad || 1) * fc.alphaLimit / aoa) : gLim;
    st.nAero += (Math.min(nNow, gLim) - st.nAero) * Math.min(1, dt / 0.25);
    gUse = Math.min(gUse, Math.max(1.2, st.nAero * 1.05));
    // lift-vector steering of the flight path toward P: gentle for small errors (a small bank, no roll-pull-roll),
    // firm for large ones; the commanded rate goes in as feed-forward
    const err = Math.acos(clamp(vh.dot(P), -1, 1));
    const wBig = clamp((err - T.smallLo) / (T.smallHi - T.smallLo), 0, 1);
    // the stick's feed-forward, smoothed (a shaky or jabbing thumb must not shake the lift vector; the reticle itself
    // follows the stick at once)
    if (T.ffTau > 0 && st.settle <= 0) { st.ffS.lerp(_ff, Math.min(1, dt / (m >= 0.05 ? T.ffTau : T.ffTauRel))); _ff.copy(st.ffS).multiplyScalar(T.ffGain); } else st.ffS.copy(_ff);
    fc.steer(P, gUse, T.gainSmall + (T.gainBig - T.gainSmall) * wBig, _ff, 0);
    // small corrections, and nose-down requests, that need less than ~1/2 g of lift (or negative lift) are made by easing
    // off / pushing with the wings where they are, not by rolling the lift vector round (at low G its direction means
    // nothing, and a push on the stick should not roll the aircraft inverted)
    {
      const Lw = fc.liftWorld, up = Lw.dot(e.up || UP), lat = Lw.dot(e.right || R);
      if (up < T.pushG * G0 && (wBig < 1 || Math.abs(lat) < 0.5 * (G0 - up)) && !st.recovering) {
        _d.copy(e.up || UP).multiplyScalar(T.pushG * G0).addScaledVector(e.right || R, lat * clamp(up / (T.pushG * G0), 0, 1));
        fc.setLift(_d, T.pushG, gUse);
        fc.nzCmd = clamp(up / G0, -1, gUse);
      }
    }
    fc.yawCmd = 0;
    const en = Math.acos(clamp(F.dot(N), -1, 1));
    if (en < T.smallHi && !st.recovering) {
      // rudder: the quick part of a small lateral nose correction (the bank does the slow part)
      _h.crossVectors(F, UP);
      const hl2 = _h.length();
      if (hl2 > 0.2) fc.yawCmd = clamp(T.rudder * N.dot(_h) / hl2 * (1 - en / T.smallHi), -0.35, 0.35);
    }
    fc.yawCmd = clamp(fc.yawCmd + rz, -1, 1);
    // ---- throttle: the player's, or the rookie auto-throttle once untouched for a while
    const idle = st.t - st.thrTouchT;
    st.auto = d.autoThrottle && idle > (st.thrTouched ? T.thrHold : T.thrIdle);
    info.autoThrottle = st.auto;
    // the fight speed (corner speed, never below 1.6 × stall): the auto-throttle's aim and the HUD energy cue
    const fight = s.gLoad > 2.5 || m > 0.5 || !!tgt;
    const safe = Math.max(prof.stall, 40) * 1.6;
    info.fightSpeed = Math.max(safe, prof.corner);
    info.slow = ias < info.fightSpeed * (info.slow ? T.slowOff : T.slowOn);
    if (st.auto) {
      const want = Math.max(safe, fight ? prof.corner : prof.corner + 40);
      fc.speed(want, true, true, 0.45);
      if (ias < safe) fc.thrCmd = 1;
    }
    fc.apply(dt);
    if (!st.auto) { c.throttle = thr0; c.speedbrake = sb0; }
    // limits reached (for the HUD)
    if (!info.limiting) {
      if (s.aoa > fc.alphaLimit * 0.93 && fc.nzCmd > s.gLoad + 0.2) info.limiting = 'aoa';
      else if (s.gLoad > gUse * 0.93) info.limiting = 'g';
      else if (s.overspeed) info.limiting = 'speed';
    }
    // hand-over ramp from the raw stick
    if (st.blend < 1) {
      const b = st.blend;
      c.pitch = sy + (c.pitch - sy) * b; c.roll = sx + (c.roll - sx) * b; c.yaw = rz + (c.yaw - rz) * b;
    }
    st.thrWritten = c.throttle;
  }

  // the mission is over or left, or the player is down: give the touch stick's rudder auto-coordination back at once
  // (combat.pre stops calling update outside a mission)
  for (const ev of ['mission:end', 'mission:abort', 'player:down']) combat.events?.on?.(ev, () => { if (st.engaged || st.coordTaken) disengage(); });

  defaults();
  return assist;
}
