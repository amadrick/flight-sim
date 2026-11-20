// Combat camera maths — pure, allocation-free after module load, unit-tested in node (camera.test.js).
// Conventions: world +X east, +Y up, +Z south; body axes +X right wing, +Y up, -Z nose; camera looks down its -Z.
import * as THREE from 'three';
import { clamp, saturate, smoothstep, dampK, buildFrame } from '../../camera/cammath.js';

export const DEG = Math.PI / 180;
export const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
export const easeInOut = (t) => { t = saturate(t); return t * t * (3 - 2 * t); };

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _m = new THREE.Matrix4(), _Y = new THREE.Vector3(0, 1, 0);

/** World azimuth (heading convention: atan2(x, -z)) and elevation of a unit vector. */
export function azEl(v, out) { out.az = Math.atan2(v.x, -v.z); out.el = Math.asin(clamp(v.y, -1, 1)); return out; }
export function dirFromAzEl(az, el, out) { const c = Math.cos(el); return out.set(Math.sin(az) * c, Math.sin(el), -Math.cos(az) * c); }

// ------------------------------------------------------------------------------------------------ padlock (chase)
/**
 * Line-of-sight tracker for the outside padlock view. Keeps a smoothed azimuth / elevation of the player→target
 * direction in world axes, so the horizon stays level whatever the jet does.
 *  - elevation is limited to ±elMax (the camera never looks straight up or down: no gimbal flip overhead);
 *  - azimuth follows the target more slowly as it nears the vertical (azimuth is meaningless overhead) and holds there;
 *  - hysteresis at the 180° ambiguity: a swing keeps going the way it started until the other way is shorter by
 *    more than `hyst`, so a target crossing dead astern never makes the camera whip back and forth;
 *  - the angular rate is capped (rad/s).
 * s: { az, el, swing, valid }   dir: unit LOS (world)
 */
export function newLos() { return { az: 0, el: 0, swing: 0, valid: false }; }
const _ae = { az: 0, el: 0 };
export function stepLos(s, dir, dt, o = LOS_DEFAULTS) {
  azEl(dir, _ae);
  const tEl = clamp(_ae.el, -o.elMax, o.elMax);
  if (!s.valid) { s.az = _ae.az; s.el = tEl; s.swing = 0; s.valid = true; return s; }
  let d = wrapPi(_ae.az - s.az);
  if (s.swing !== 0 && Math.sign(d) !== s.swing && Math.abs(d) > Math.PI - o.hyst) d -= Math.sign(d) * 2 * Math.PI;
  const azK = dampK(o.lam * smoothstep(0.06, 0.35, Math.cos(_ae.el)), dt);
  let step = d * azK;
  const maxStep = o.maxRate * dt;
  step = clamp(step, -maxStep, maxStep);
  if (Math.abs(d) > 0.08) s.swing = Math.sign(d); else if (Math.abs(d) < 0.02) s.swing = 0;
  s.az = wrapPi(s.az + step);
  let e = (tEl - s.el) * dampK(o.lam, dt);
  e = clamp(e, -maxStep, maxStep);
  s.el += e;
  return s;
}
export const LOS_DEFAULTS = { elMax: 76 * DEG, hyst: 25 * DEG, lam: 3.2, maxRate: 2.6 };

/**
 * Camera "up" for the padlock: the world vertical, leaning toward the aircraft's own up as the bank steepens, so a
 * hard turn still reads as a turn and stick-right still looks like right. Inverted flight keeps the world up.
 */
export function padlockUp(out, bodyUp, rollRad, lean = 0.42) {
  const r = Math.abs(rollRad);
  const w = lean * smoothstep(35 * DEG, 95 * DEG, r) * (1 - smoothstep(120 * DEG, 165 * DEG, r));
  out.set(0, 1 - w, 0).addScaledVector(bodyUp, w);
  if (out.lengthSq() < 1e-6) out.set(0, 1, 0);
  return out.normalize();
}

/**
 * Padlock framing: the camera sits behind the player on the far side from the target, looking along the line of
 * sight `fwd`, raised along the camera's up so the player sits `frac` of the half-height below the centre and the
 * target (far away, on the line) near the centre. Writes out.pos (world) and out.quat. Returns out.
 * P: player position, fwd: unit LOS (smoothed), up: up hint, dist: camera distance behind the player (m).
 */
export function padlockFrame(out, P, fwd, up, dist, vfovDeg, frac = 0.42) {
  buildFrame(out.quat, fwd, up);
  _a.set(0, 1, 0).applyQuaternion(out.quat);                    // camera up (perpendicular to fwd)
  const h = dist * Math.tan(frac * vfovDeg * DEG / 2);
  out.pos.copy(P).addScaledVector(fwd, -dist).addScaledVector(_a, h);
  return out;
}

/** Angle (rad) between the camera's forward (quat) and the direction from eye to point. */
export function angleFromAxis(quat, eye, point) {
  _b.set(0, 0, -1).applyQuaternion(quat);
  _c.copy(point).sub(eye); const l = _c.length(); if (l < 1e-6) return 0;
  return Math.acos(clamp(_b.dot(_c) / l, -1, 1));
}

/** Vertical FOV (deg) that keeps something `ang` rad off the axis inside `margin` of the smaller half-FOV. */
export function fovToContain(ang, aspect, margin = 0.82) {
  const half = Math.min(ang / margin, 85 * DEG);
  const tv = Math.tan(half);
  const v = aspect < 1 ? Math.atan(tv / Math.max(aspect, 0.3)) : half;    // portrait: horizontal is the tight one
  return 2 * v / DEG;
}

// ------------------------------------------------------------------------------------------------ padlock (cockpit)
/**
 * Where the pilot's head wants to point for a target at body-axes position v (yaw + = right, pitch + = up, rad).
 * Neck limits ±yawMax, +pitchUp / -pitchDown. Forward quadrant (target within fwdIn of the nose, left again past
 * fwdOut) → look through the HUD (0, 0). Shoulder hysteresis: the head stays on its side until the target is `hyst`
 * past dead astern. s: { side, fwd } persistent. Writes out.yaw / out.pitch.
 */
export function newNeck() { return { side: 1, fwd: true, yaw: 0, pitch: 0 }; }
export const NECK = { yawMax: 150 * DEG, pitchUp: 80 * DEG, pitchDown: 30 * DEG, fwdIn: 16 * DEG, fwdOut: 28 * DEG, hyst: 22 * DEG, lam: 7, maxRate: 4.2 };
export function neckTarget(s, v, out, o = NECK) {
  const hz = Math.hypot(v.x, v.z);
  const off = Math.atan2(Math.hypot(v.x, v.y), -v.z);
  if (s.fwd) { if (off > o.fwdOut) s.fwd = false; } else if (off < o.fwdIn) s.fwd = true;
  if (s.fwd) { out.yaw = 0; out.pitch = 0; return out; }
  let yaw = Math.atan2(v.x, -v.z);
  const pitch = Math.atan2(v.y, hz);
  // near-vertical: yaw is ill-defined, keep the current side's yaw
  if (hz < 1e-6 * (Math.abs(v.y) + 1)) yaw = s.yaw;
  if (s.side > 0 && yaw < -(Math.PI - o.hyst)) yaw = o.yawMax;
  else if (s.side < 0 && yaw > Math.PI - o.hyst) yaw = -o.yawMax;
  else if (Math.abs(yaw) > 0.05) s.side = yaw > 0 ? 1 : -1;
  out.yaw = clamp(yaw, -o.yawMax, o.yawMax);
  out.pitch = clamp(pitch, -o.pitchDown, o.pitchUp);
  return out;
}
/** Head motion: exponential approach with a rate cap (a real neck has a top speed). */
export function stepNeck(s, tYaw, tPitch, dt, o = NECK) {
  const k = dampK(o.lam, dt), m = o.maxRate * dt;
  s.yaw += clamp((tYaw - s.yaw) * k, -m, m);
  s.pitch += clamp((tPitch - s.pitch) * k, -m, m);
  return s;
}

// ------------------------------------------------------------------------------------------------ blends
/**
 * Slerp between unit directions; antipodal pairs rotate through `hint` (made perpendicular), so a swing from behind
 * the jet to in front of it goes round the side instead of through it.
 */
export function slerpDir(out, a, b, t, hint) {
  const d = clamp(a.dot(b), -1, 1);
  const th = Math.acos(d);
  if (th < 1e-4) return out.copy(a).lerp(b, t).normalize();
  const s = Math.sin(th);
  if (s < 0.02) {
    _c.copy(hint).addScaledVector(a, -hint.dot(a));
    if (_c.lengthSq() < 1e-8) { _c.set(1, 0, 0).addScaledVector(a, -a.x); if (_c.lengthSq() < 1e-8) _c.set(0, 0, 1); }
    _c.normalize();
    const ang = t * th;
    return out.copy(a).multiplyScalar(Math.cos(ang)).addScaledVector(_c, Math.sin(ang)).normalize();
  }
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return out.copy(a).multiplyScalar(wa).addScaledVector(b, wb).normalize();
}

/**
 * Blend two camera offsets (relative to the player) on a sphere: direction slerped, distance lerped and never
 * below minR when both ends are outside it. Writes out (Vector3). Returns out.
 */
const _da = new THREE.Vector3(), _db = new THREE.Vector3();
export function blendOffset(out, a, b, t, minR, hint) {
  const la = a.length(), lb = b.length();
  if (la < 1e-3 || lb < 1e-3) return out.copy(a).lerp(b, t);
  _da.copy(a).multiplyScalar(1 / la); _db.copy(b).multiplyScalar(1 / lb);
  slerpDir(out, _da, _db, t, hint);
  let l = la + (lb - la) * t;
  if (la >= minR && lb >= minR) l = Math.max(l, minR);
  return out.multiplyScalar(l);
}

/** Should a transition be a cut rather than a move? (interior↔exterior, or too far apart to fly between). */
export function shouldCut(fromInterior, toInterior, dist, maxDist = 400) {
  return fromInterior !== toInterior || !(dist <= maxDist);
}

// ------------------------------------------------------------------------------------------------ safety
const _v = new THREE.Vector3(), _qi = new THREE.Quaternion(), _f = new THREE.Vector3();
/**
 * True when an enemy aircraft is a gun threat: inside `range` and behind the player's wing line, or closer than
 * `noseRange` with its nose on the player (within `noseCone`). player / enemies: { state: { position, quaternion } }.
 */
export function gunThreat(player, enemies, range = 1800, noseRange = 1500, noseCone = 30 * DEG) {
  const ps = player.state;
  _qi.copy(ps.quaternion).invert();
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i]; if (!e || e.alive === false || e === player) continue;
    _v.copy(e.state.position).sub(ps.position);
    const d = _v.length(); if (d > range) continue;
    const bz = _a.copy(_v).applyQuaternion(_qi).z;
    if (bz > 0) return true;                                       // behind the wing line
    if (d < noseRange) {
      _f.set(0, 0, -1).applyQuaternion(e.state.quaternion);
      if (d < 1e-3 || -_f.dot(_v) / d > Math.cos(noseCone)) return true;   // its nose is on us
    }
  }
  return false;
}

/**
 * "Safe to cut away" from the player's own view (kill cam, keeping the missile cam).
 * i: { alive, onGround, agl (m), vs (m/s), missileThreats (count of missiles guiding on the player), gunThreat,
 *      hpFrac (0..1), recentHit (s since the player was last damaged), shotAt (s since rounds passed close or a launch
 *      warning against the player) }
 */
export function safeToCutAway(i) {
  if (!i || !i.alive || i.onGround) return false;
  if ((i.missileThreats || 0) > 0 || i.gunThreat) return false;
  const agl = Number.isFinite(i.agl) ? i.agl : 0, vs = Number.isFinite(i.vs) ? i.vs : 0;
  if (agl < 450 || agl + Math.min(0, vs) * 6 < 350) return false;     // low, or sinking toward the ground
  if ((i.recentHit ?? 99) < 2) return false;
  if ((i.shotAt ?? 99) < 2.5) return false;                         // rounds passing close / a launch warning just now
  if ((i.hpFrac ?? 1) < 0.15) return false;
  return true;
}

// ------------------------------------------------------------------------------------------------ victory framing
/**
 * Azimuth (world, heading convention) of the hero camera's offset from the player. Default: a front quarter on the
 * side of `side`; with a recent wreck, on the far side of the player from the wreck so the smoke sits behind the jet.
 */
export function victoryAzimuth(nose, playerPos, wreckPos, side = 1) {
  if (wreckPos) {
    _v.copy(playerPos).sub(wreckPos); _v.y = 0;
    if (_v.lengthSq() > 25) return Math.atan2(_v.x, -_v.z) + side * 12 * DEG;
  }
  const hl = Math.hypot(nose.x, nose.z);
  const hdg = hl > 0.05 ? Math.atan2(nose.x, -nose.z) : 0;
  return hdg + side * 38 * DEG;
}

// ------------------------------------------------------------------------------------------------ feel
/** Damped angular spring per axis; stable for any dt (substeps). s: { x, v }. */
export function springStep(s, dt, w = 22, zeta = 0.55) {
  let t = dt;
  while (t > 1e-6) {
    const h = Math.min(t, 1 / 240);
    s.v += (-w * w * s.x - 2 * zeta * w * s.v) * h;
    s.x += s.v * h;
    t -= h;
  }
  if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) { s.x = 0; s.v = 0; }
  return s;
}

/** Band-limited shake sample in about [-1, 1]: three incommensurate sines around `f` Hz. */
export function band(t, f, k) {
  return (Math.sin(t * f * 6.2832 + k * 1.7) + 0.7 * Math.sin(t * f * 1.37 * 6.2832 + k * 4.1) + 0.5 * Math.sin(t * f * 0.71 * 6.2832 + k * 2.3)) / 2.2;
}

/** Look-at quaternion with an up hint (eye, target, up in one space). */
export function lookAtQuat(out, eye, target, up) {
  _m.lookAt(eye, target, up || _Y);
  return out.setFromRotationMatrix(_m);
}

export function finitePose(pos, quat, fov) {
  return Number.isFinite(pos.x + pos.y + pos.z + quat.x + quat.y + quat.z + quat.w + fov);
}
export { clamp, saturate, smoothstep, dampK };

// ------------------------------------------------------------------------------------------------ fight chase view
/**
 * Fight-view defaults (see README "Fight chase view" for the reasoning). Distances are multiples of the aircraft size.
 *  rollFollow   fraction of the jet's bank the camera takes (0 = horizon locked, 1 = rolls with the jet)
 *  biasMax      most the view turns toward the target (deg); biasStart / biasFull: target angle off the view where the
 *               bias starts / reaches full; biasUp / biasDown: vertical limits (the jet must stay in frame)
 *  turnLead     fraction of the flight path's turn the view leads into; turnMax its limit (deg)
 *  fovWide      extra FOV (deg) with the target far off the nose (30°→120°)
 *  zoom         gun zoom: FOV shrinks by this fraction with the lead solution within zoomIn deg and in range (leaves at zoomOut)
 *  pullG, pullAB pull-back fractions at 9 g / full afterburner
 */
export const FIGHT = {
  dist: 1.55, rollFollow: 0.3, biasMax: 26, biasStart: 6, biasFull: 55, biasUp: 17, biasDown: 9,
  turnLead: 0.5, turnMax: 7, fovBase: 56, fovWide: 8, zoom: 0.24, zoomIn: 4, zoomOut: 7, pullG: 0.12, pullAB: 0.08,
};

/**
 * Bounded look bias toward a target seen at (yawT, pitchT) rad from the view axis (+ right / + up).
 * Zero near the axis, full past biasFull, limited to biasMax overall, biasUp / biasDown vertically and maxYaw sideways.
 * Writes out.yaw / out.pitch (rad).
 */
export function fightBias(out, yawT, pitchT, o = FIGHT, maxYaw = Infinity) {
  const off = Math.hypot(yawT, pitchT);
  if (!(off > 1e-6)) { out.yaw = 0; out.pitch = 0; return out; }
  const k = smoothstep(o.biasStart * DEG, o.biasFull * DEG, off);
  const mag = Math.min(off, o.biasMax * DEG) * k;
  out.yaw = clamp(yawT / off * mag, -Math.min(o.biasMax * DEG, maxYaw), Math.min(o.biasMax * DEG, maxYaw));
  out.pitch = clamp(pitchT / off * mag, -o.biasDown * DEG, o.biasUp * DEG);
  return out;
}

/** Gun-zoom gate with hysteresis: in when the lead solution is within zoomIn deg and in range, out past zoomOut. */
export function gunZoomGate(s, angRad, inRange, o = FIGHT) {
  if (!inRange || !Number.isFinite(angRad)) { s.on = false; return false; }
  if (s.on) { if (angRad > o.zoomOut * DEG) s.on = false; } else if (angRad < o.zoomIn * DEG) s.on = true;
  return s.on;
}

/** Normalise a feel setting: boolean → 0 / 1, number → clamped 0..1, anything else → 1. */
export function feelAmount(v) {
  if (v === true) return 1; if (v === false || v == null) return v == null ? 1 : 0;
  const n = +v; return Number.isFinite(n) ? clamp(n, 0, 1) : 1;
}

/**
 * How long the kill cam may hold the view: 0 = not at all (not safe), `quick` (≤ 1.2 s) while any bandit is within
 * `calmRange` or anything has a lock on the player, else `full`. i: safeToCutAway fields + nearestEnemy (m), locks (count).
 */
export function killCamDuration(i, full = 3.2, quick = 1.2, calmRange = 4000) {
  if (!safeToCutAway(i)) return 0;
  if ((i.locks || 0) > 0 || (i.nearestEnemy ?? Infinity) < calmRange) return quick;
  return full;
}
