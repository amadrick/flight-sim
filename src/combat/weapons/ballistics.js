// Gun ballistics: quadratic drag + gravity. Numeric stepping for live rounds, closed forms for prediction (sight, AI aim).
// Pure functions; three.js math only.
import * as THREE from 'three';
import { isaAtmosphere } from '../../physics/atmosphere.js';

export const G = 9.80665;

// ---- air density lookup (ISA, 0..30 km every 100 m) — cheap enough to call per bullet per frame ----------------------
const RHO = new Float32Array(302), SOUND = new Float32Array(302);
{ const o = {}; for (let i = 0; i < RHO.length; i++) { isaAtmosphere(i * 100, o); RHO[i] = o.rho; SOUND[i] = o.a; } }
export function rhoAt(h) {
  let x = h / 100; if (!(x > 0)) x = 0; else if (x > 300) x = 300;
  const i = x | 0, f = x - i; return RHO[i] + (RHO[i + 1] - RHO[i]) * f;
}
export function soundAt(h) {
  let x = h / 100; if (!(x > 0)) x = 0; else if (x > 300) x = 300;
  const i = x | 0, f = x - i; return SOUND[i] + (SOUND[i + 1] - SOUND[i]) * f;
}

/** Drag constant k (1/m) of a gun round at density rho: acceleration = -k·|v|·v. */
export function gunK(spec, rho = 1.225) {
  const A = Math.PI * spec.caliber * spec.caliber * 0.25;
  return rho * spec.cd * A / (2 * spec.mass);
}

/** Advance one round (position/velocity Vector3s) by dt with drag constant k (implicit drag, trapezoid position). */
export function stepRound(pos, vel, k, dt) {
  const sp = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
  const f = 1 / (1 + k * sp * dt);              // implicit drag factor (stable at any dt)
  const ox = vel.x, oy = vel.y, oz = vel.z, h = 0.5 * dt;
  vel.x *= f; vel.y = vel.y * f - G * dt; vel.z *= f;
  pos.x += (ox + vel.x) * h; pos.y += (oy + vel.y) * h; pos.z += (oz + vel.z) * h;   // trapezoid: 2nd order
}

/**
 * Closed-form flight of a round launched at speed u0 with drag constant k (constant density), split into the distance
 * travelled along the launch direction and the extra drop due to gravity (both exact for |v| ≈ along-path speed):
 *   s(t)    = ln(1 + a t) / k,                    a = k·u0
 *   drop(t) = g·[ t²/4 + (t − ln(1 + a t)/a) / (2a) ]   (→ ½ g t² as k → 0)
 */
export function pathDistance(u0, k, t) { return k > 1e-12 ? Math.log1p(k * u0 * t) / k : u0 * t; }
export function pathDrop(u0, k, t) {
  const a = k * u0;
  if (a * t < 1e-4) return 0.5 * G * t * t;
  return G * (t * t * 0.25 + (t - Math.log1p(a * t) / a) / (2 * a));
}
/** Time to travel distance d along the path (inverse of pathDistance). Infinity if never (k = 0 handled). */
export function pathTime(u0, k, d) { return k > 1e-12 ? Math.expm1(k * d) / (k * u0) : d / u0; }

const _v0 = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Vector3();

/**
 * Displacement (world) of a round after tof, relative to where the shooter will be if it keeps its current velocity:
 *   B = port + ŵ·s(tof) − vs·tof − ŷ·drop(tof),   ŵ = unit(vs + mv·dir)
 * dir: unit world firing direction; port: world offset of the muzzle from the shooter's origin (or null).
 */
export function roundOffset(vs, dir, port, spec, k, tof, out) {
  _v0.copy(dir).multiplyScalar(spec.muzzleVelocity).add(vs);
  const u0 = _v0.length();
  _w.copy(_v0).divideScalar(u0 || 1);
  const s = pathDistance(u0, k, tof), d = pathDrop(u0, k, tof);
  out.copy(_w).multiplyScalar(s).addScaledVector(vs, -tof);
  out.y -= d;
  if (port) out.add(port);
  return out;
}

/**
 * gunTrajectory: where a round fired now (along the body nose axis) will be after tof seconds, relative to the shooter's
 * straight-line path (its position + velocity·tof) and expressed in the shooter's CURRENT body axes (+X right, +Y up,
 * −Z nose). This is what a lead-computing sight draws: a target flying the shooter's path sits on this point.
 * state: { position, velocity, quaternion }; portBody: [x,y,z] muzzle in body axes or null.
 */
export function gunTrajectory(state, spec, portBody, tof, out = new THREE.Vector3()) {
  const k = gunK(spec, rhoAt(state.position.y));
  _q.copy(state.quaternion);
  _m.set(0, 0, -1).applyQuaternion(_q);
  const port = portBody ? _pw.set(portBody[0], portBody[1], portBody[2]).applyQuaternion(_q) : null;
  roundOffset(state.velocity, _m, port, spec, k, tof, out);
  return out.applyQuaternion(_q.invert());
}
const _pw = new THREE.Vector3();

const _rt = new THREE.Vector3(), _B = new THREE.Vector3(), _err = new THREE.Vector3(), _f = new THREE.Vector3(),
  _M = new THREE.Vector3(), _ta = new THREE.Vector3(), _dB = new THREE.Vector3();

/**
 * Lead-computing gun solution. shooter/target state: { position, velocity, quaternion?, acceleration? }.
 * Finds the firing direction f and time of flight t so a round fired now along f meets the target (constant
 * acceleration prediction, drag + drop). out: { point (world aim point = shooter position + f·range), dir (unit f),
 * tof, range, inRange }.
 */
export function solveGun(sState, tState, spec, portBody, out, accel = null) {
  const k = gunK(spec, rhoAt(0.5 * (sState.position.y + tState.position.y)));
  const vs = sState.velocity, tp = tState.position, tv = tState.velocity;
  _M.copy(sState.position);
  if (portBody && sState.quaternion) _M.add(_pw.set(portBody[0], portBody[1], portBody[2]).applyQuaternion(sState.quaternion));
  // target acceleration (kinematic, includes manoeuvre), capped at 12 g
  _ta.set(0, 0, 0);
  const acc = accel || tState.acceleration;
  if (acc) { _ta.copy(acc); const a = _ta.length(); if (a > 12 * G) _ta.multiplyScalar(12 * G / a); }
  const range = _rt.copy(tp).sub(sState.position).length();
  _f.copy(tp).sub(_M); const r0 = _f.length() || 1; _f.divideScalar(r0);
  let t = Math.min(pathTime(spec.muzzleVelocity, k, r0), 6);
  if (!(t > 0)) t = r0 / spec.muzzleVelocity;
  for (let it = 0; it < 8; it++) {
    roundOffset(vs, _f, null, spec, k, t, _B);
    _rt.copy(tp).addScaledVector(tv, t).addScaledVector(_ta, 0.5 * t * t).sub(_M).addScaledVector(vs, -t);
    _err.copy(_rt).sub(_B);
    // d(err)/dt = (tv + ta t − vs) − dB/dt,  dB/dt = ŵ u(t) − vs − ŷ vdrop  ⇒  tv + ta t − ŵ u(t) − ŷ·(−vdrop)
    _v0.copy(_f).multiplyScalar(spec.muzzleVelocity).add(vs);
    const u0 = _v0.length(), a = k * u0;
    _dB.copy(_v0).multiplyScalar(1 / (1 + a * t));
    _dB.y -= G * (t + 0.5 * a * t * t) / (1 + a * t);
    const dErr = (tv.x + _ta.x * t - _dB.x) * _f.x + (tv.y + _ta.y * t - _dB.y) * _f.y + (tv.z + _ta.z * t - _dB.z) * _f.z;
    const ePar = _err.dot(_f);
    if (Math.abs(dErr) > 1e-3) t = Math.min(Math.max(t - ePar / dErr, 0.01), 8);
    const bl = Math.max(_B.length(), 1);
    _err.addScaledVector(_f, -ePar);
    _f.addScaledVector(_err, 1 / bl).normalize();
  }
  // one numeric correction pass: fly the round with the integrator and remove the residual miss (closed form is ~0.1 %)
  {
    _B.copy(_M); _v0.copy(_f).multiplyScalar(spec.muzzleVelocity).add(vs);
    const n = Math.max(4, Math.ceil(t * 120)), h = t / n;
    for (let i = 0; i < n; i++) stepRound(_B, _v0, gunK(spec, rhoAt(_B.y)), h);
    _rt.copy(tp).addScaledVector(tv, t).addScaledVector(_ta, 0.5 * t * t);
    _err.copy(_rt).sub(_B);
    const ePar = _err.dot(_f);
    _err.addScaledVector(_f, -ePar);
    const dist = Math.max(_B.distanceTo(_M), 1);
    _f.addScaledVector(_err, 1 / dist).normalize();
    const vAlong = _v0.dot(_f) - tv.dot(_f);
    if (vAlong > 50) t += ePar / vAlong;
  }
  out.point ||= new THREE.Vector3(); out.dir ||= new THREE.Vector3();
  out.dir.copy(_f);
  out.point.copy(sState.position).addScaledVector(_f, range);
  out.tof = t; out.range = range;
  out.inRange = range < spec.range && t < spec.life;
  return out;
}
