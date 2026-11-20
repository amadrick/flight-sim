// Shared helpers for the combat modules (pure math; safe in node).
import * as THREE from 'three';

export const DEG = Math.PI / 180, RAD = 180 / Math.PI, KT = 0.514444, FT = 0.3048, NM = 1852, G0 = 9.80665;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };

const _q = new THREE.Quaternion(), _v = new THREE.Vector3();

/** Unit vector of world heading `deg` (0 = north = -Z, 90 = east = +X). */
export function headingVec(deg, out = new THREE.Vector3()) { const a = deg * DEG; return out.set(Math.sin(a), 0, -Math.cos(a)); }
/** World heading in degrees [0, 360) of a world direction. */
export function headingOf(v) { const h = Math.atan2(v.x, -v.z) * RAD; return h < 0 ? h + 360 : h; }
/** Bearing in degrees from world point a to b. */
export function bearing(a, b) { const h = Math.atan2(b.x - a.x, -(b.z - a.z)) * RAD; return h < 0 ? h + 360 : h; }

/** World point/direction → the body axes of `state` (+X right wing, +Y up, -Z nose). `dir` = true skips the translation. */
export function toBody(state, world, out = new THREE.Vector3(), dir = false) {
  out.copy(world); if (!dir) out.sub(state.position);
  return out.applyQuaternion(_q.copy(state.quaternion).invert());
}
/** Body-axes point/direction → world. */
export function toWorld(state, body, out = new THREE.Vector3(), dir = false) {
  out.copy(body).applyQuaternion(state.quaternion); if (!dir) out.add(state.position);
  return out;
}
/** Angle (rad) between the nose of `state` and the line of sight to world point `p`. */
export function angleOff(state, p) {
  toBody(state, p, _v);
  return Math.atan2(Math.hypot(_v.x, _v.y), -_v.z);
}
/**
 * Aspect geometry between an attacker and a target (both AircraftState-like):
 *   range (m), closure (m/s, + = closing), ata (rad, attacker's nose off the target, 0 = pointing at it),
 *   aspect (rad, 0 = attacker dead astern of the target, π = head-on).
 */
export function geometry(att, tgt, out = {}) {
  _v.copy(tgt.position).sub(att.position);
  const range = _v.length() || 1e-6;
  const lx = _v.x / range, ly = _v.y / range, lz = _v.z / range;
  out.range = range;
  out.closure = (att.velocity.x - tgt.velocity.x) * lx + (att.velocity.y - tgt.velocity.y) * ly + (att.velocity.z - tgt.velocity.z) * lz;
  out.ata = angleOff(att, tgt.position);
  // target's nose vs the line from the target back to the attacker
  _v.set(0, 0, -1).applyQuaternion(tgt.quaternion);
  out.aspect = Math.acos(clamp(_v.x * lx + _v.y * ly + _v.z * lz, -1, 1));   // 0 = attacker behind the target (tail aspect)
  return out;
}
