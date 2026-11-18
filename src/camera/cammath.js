// Pure camera math (no ctx) — unit-tested in node. All helpers are allocation-free after module load.
import * as THREE from 'three';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const saturate = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = saturate((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** Exponential damping factor: fraction of the remaining error removed in dt (frame-rate independent). */
export const dampK = (lambda, dt) => 1 - Math.exp(-lambda * dt);
export const damp = (cur, target, lambda, dt) => cur + (target - cur) * dampK(lambda, dt);
export const dampAngle = (cur, target, lambda, dt) => {
  let d = (target - cur) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
  return cur + d * dampK(lambda, dt);
};
export const easeInOut = (t) => { t = saturate(t); return t * t * (3 - 2 * t); };
export const dampV3 = (cur, target, lambda, dt) => cur.lerp(target, dampK(lambda, dt));
export const dampQuat = (cur, target, lambda, dt) => cur.slerp(target, dampK(lambda, dt));

/** Smooth pseudo-noise in about [-1, 1] (sum of incommensurate sines). */
export const noise = (t, k) =>
  (Math.sin(t * 1.0 + k * 12.9898) + 0.6 * Math.sin(t * 2.31 + k * 78.233) + 0.4 * Math.sin(t * 5.17 + k * 37.719)) / 2;

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4(), _u = new THREE.Vector3();

/**
 * Orthonormal camera-style frame (-Z = fwd, +Y ≈ upHint made perpendicular to fwd) as a quaternion.
 * Never flips: if upHint is parallel to fwd, falls back to a stable axis.
 */
export function buildFrame(out, fwd, upHint) {
  _z.copy(fwd).negate();                       // camera looks down -Z
  _u.copy(upHint).addScaledVector(fwd, -upHint.dot(fwd));
  if (_u.lengthSq() < 1e-8) { _u.set(0, 1, 0).addScaledVector(fwd, -fwd.y); if (_u.lengthSq() < 1e-8) _u.set(0, 0, 1); }
  _u.normalize();
  _x.crossVectors(_u, _z).normalize();
  _y.crossVectors(_z, _x);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/** Camera quaternion looking from eye to target with the given up (all in one space). */
export function lookQuat(out, eye, target, up) {
  _m.lookAt(eye, target, up);
  return out.setFromRotationMatrix(_m);
}

/** Chase-frame target: forward blends nose→velocity with speed, up partially follows the aircraft's roll. */
const _f = new THREE.Vector3(), _hu = new THREE.Vector3();
export function chaseFrameTarget(out, nose, velDir, speed, bodyUp, rollFollow) {
  const w = smoothstep(8, 35, speed) * 0.85;
  _f.copy(nose).multiplyScalar(1 - w).addScaledVector(velDir, w);
  if (_f.lengthSq() < 1e-6) _f.copy(nose);
  _f.normalize();
  _hu.set(0, 1 - rollFollow, 0).addScaledVector(bodyUp, rollFollow);
  return buildFrame(out, _f, _hu);
}

/** Distance at which a sphere of radius r fits inside the smaller of the vertical / horizontal FOV. */
export function framingDistance(radius, vfovDeg, aspect) {
  const v = vfovDeg * Math.PI / 360;
  const h = Math.atan(Math.tan(v) * Math.max(aspect, 0.2));
  return radius / Math.sin(Math.min(v, h));
}

/** Vertical FOV (deg) so an object of `size` metres at `dist` spans `frac` of the screen height. */
export function trackFov(size, dist, frac, minDeg, maxDeg) {
  const f = 2 * Math.atan(size / (2 * frac * Math.max(dist, 1e-3))) * 180 / Math.PI;
  return clamp(f, minDeg, maxDeg);
}

/** Size-dependent distances for an aircraft (metres) so every type is framed alike. */
export function sizeFor(geo) {
  const L = geo?.length > 0 ? geo.length : 15, span = geo?.span > 0 ? geo.span : 10, H = geo?.height > 0 ? geo.height : 4;
  const big = Math.max(L, span * 1.1);
  return { L, span, H, big };
}
