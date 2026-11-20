// Pure geometry for the AI: engagement classification, pursuit points, formation slots, intercepts.
// Works on entity-like objects { state: { position, velocity, quaternion?, acceleration? }, forward? }.
import * as THREE from 'three';
import { clamp, G0 } from '../util.js';

const _d = new THREE.Vector3(), _f = new THREE.Vector3(), _g = new THREE.Vector3(), _h = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, -1);

/** World nose vector of an entity (uses entity.forward when present). */
export function noseOf(e, out) {
  if (e.forward) return out.copy(e.forward);
  if (e.state.quaternion) return out.copy(FWD).applyQuaternion(e.state.quaternion);
  return out.copy(e.state.velocity).normalize();
}

/**
 * Engagement geometry of `me` against `bandit` (fills and returns `out`):
 *   range (m), closure (m/s, + closing), ata (rad, my nose off the line of sight), aa (aspect angle, rad:
 *   0 = I am dead astern of the bandit, π = I am in front of it), threatAta (rad, the bandit's nose off me = π − aa),
 *   hca (heading crossing angle between the velocity vectors, rad), dAlt (bandit − me, m),
 *   situation: 'offensive' | 'defensive' | 'head-on' | 'neutral'.
 */
export function classify(me, bandit, out = {}) {
  const pm = me.state.position, pb = bandit.state.position, vm = me.state.velocity, vb = bandit.state.velocity;
  _d.copy(pb).sub(pm);
  const range = _d.length() || 1e-6;
  _d.multiplyScalar(1 / range);
  out.range = range;
  out.closure = (vm.x - vb.x) * _d.x + (vm.y - vb.y) * _d.y + (vm.z - vb.z) * _d.z;
  noseOf(me, _f);
  out.ata = Math.acos(clamp(_f.dot(_d), -1, 1));
  noseOf(bandit, _g);
  out.aa = Math.acos(clamp(_g.dot(_d), -1, 1));
  out.threatAta = Math.PI - out.aa;
  const sm = vm.length(), sb = vb.length();
  out.hca = sm > 1 && sb > 1 ? Math.acos(clamp(vm.dot(vb) / (sm * sb), -1, 1)) : 0;
  out.dAlt = pb.y - pm.y;
  const D = Math.PI / 180;
  if (out.ata < 45 * D && out.threatAta < 45 * D) out.situation = 'head-on';
  else if (out.ata < 70 * D && out.aa < 75 * D) out.situation = 'offensive';
  else if (out.threatAta < 65 * D && out.ata > 100 * D) out.situation = 'defensive';
  else out.situation = 'neutral';
  return out;
}

/**
 * Pursuit aim point (world) of `me` on `tgt`: kind 'lead' (ahead of the target along its path, including its turn),
 * 'pure' (the target itself) or 'lag' (behind the target, along its flight path). `amount` scales the lead time / lag
 * distance (1 = default). Returns `out`.
 */
export function pursuitPoint(me, tgt, kind, out, amount = 1) {
  const pt = tgt.state.position, vt = tgt.state.velocity;
  out.copy(pt);
  if (kind === 'pure') return out;
  const range = _d.copy(pt).sub(me.state.position).length();
  if (kind === 'lead') {
    const V = Math.max(me.state.velocity.length(), 120);
    const t = clamp(range / V, 0, 3) * 0.75 * amount;
    out.addScaledVector(vt, t);
    const a = tgt.state.acceleration;
    if (a) { _h.copy(a); _h.y += 0; out.addScaledVector(_h, 0.5 * t * t * 0.8); }
    return out;
  }
  // lag: a point behind the target on its flight path
  const sv = vt.length();
  if (sv > 1) out.addScaledVector(vt, -clamp(range * 0.45, 120, 900) * amount / sv);
  return out;
}

/**
 * Velocity direction that puts the NOSE (not the velocity vector) on world point `aim`: the aim direction corrected
 * by the current nose–velocity offset (AoA / sideslip), normalised. Used for gun tracking.
 */
export function noseAimDir(me, aim, out) {
  out.copy(aim).sub(me.state.position).normalize();
  noseOf(me, _f);
  _g.copy(me.state.velocity).normalize();
  out.add(_g).sub(_f);
  return out.normalize();
}

/** Line-of-sight feed-forward: the acceleration (world, ⟂ my velocity) that keeps my velocity turning with the LOS. */
export function losFeedForward(me, tgt, out) {
  _d.copy(tgt.state.position).sub(me.state.position);
  const r2 = Math.max(_d.lengthSq(), 100);
  _g.copy(tgt.state.velocity).sub(me.state.velocity);
  _h.crossVectors(_d, _g).multiplyScalar(1 / r2);            // ω_LOS (rad/s)
  return out.crossVectors(_h, me.state.velocity);            // ω × v
}

/**
 * Formation offset presets, metres in the leader's horizontal frame: x right, y up, z aft (+ = behind the leader).
 * 'wing' fighting wing, 'spread' combat spread, 'trail', 'echelon' (close, for show), '-left' mirrors any of them.
 */
export const FORMATION = {
  wing: { x: 260, y: 15, z: 220 },
  spread: { x: 1300, y: 0, z: 60 },
  trail: { x: 0, y: -40, z: 650 },
  echelon: { x: 45, y: -8, z: 35 },
  close: { x: 70, y: 0, z: 70 },
};
export const DEFAULT_OFFSET = FORMATION.wing;

/** Resolve an escort offset (preset name, {x,y,z} or Vector3) to {x,y,z}. Returns `out`. */
export function resolveOffset(offset, out) {
  if (typeof offset === 'string') {
    const left = /-left$|^left-/.test(offset);
    const b = FORMATION[offset.replace(/-left$|^left-|-right$/, '')] || DEFAULT_OFFSET;
    out.x = left ? -b.x : b.x; out.y = b.y; out.z = b.z;
  } else if (offset && typeof offset === 'object') {
    out.x = +offset.x || 0; out.y = +offset.y || 0; out.z = offset.z != null ? +offset.z : DEFAULT_OFFSET.z;
  } else { out.x = DEFAULT_OFFSET.x; out.y = DEFAULT_OFFSET.y; out.z = DEFAULT_OFFSET.z; }
  return out;
}

/** World position of a formation slot behind `leader` ({x,y,z} offset as above). Returns `out`. */
export function formationSlot(leader, off, out) {
  const v = leader.state.velocity;
  let hx = v.x, hz = v.z;
  let hl = Math.hypot(hx, hz);
  if (hl < 5) { noseOf(leader, _f); hx = _f.x; hz = _f.z; hl = Math.hypot(hx, hz) || 1; }
  hx /= hl; hz /= hl;
  // right of a horizontal heading (hx, hz) is (−hz, hx)
  const p = leader.state.position;
  out.set(p.x + (-hz) * off.x - hx * off.z, p.y + off.y, p.z + hx * off.x - hz * off.z);
  return out;
}

/** Time of closest approach (s, ≥ 0) and miss distance (m) between two moving points. Returns { t, miss } in out. */
export function closestApproach(p1, v1, p2, v2, out = {}) {
  _d.copy(p2).sub(p1); _g.copy(v2).sub(v1);
  const vv = _g.lengthSq();
  const t = vv > 1e-6 ? Math.max(0, -_d.dot(_g) / vv) : 0;
  out.t = t; out.miss = _h.copy(_d).addScaledVector(_g, t).length();
  return out;
}

/** Lead-intercept point for a chaser at speed `speed` (m/s) on a target (constant velocity). Returns `out`. */
export function interceptPoint(chaserPos, speed, tgtPos, tgtVel, out) {
  _d.copy(tgtPos).sub(chaserPos);
  const a = tgtVel.lengthSq() - speed * speed, b = 2 * _d.dot(tgtVel), c = _d.lengthSq();
  let t;
  if (Math.abs(a) < 1e-6) t = b < 0 ? -c / b : 0;
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) t = 0;
    else { const r = Math.sqrt(disc); const t1 = (-b - r) / (2 * a), t2 = (-b + r) / (2 * a); t = t1 > 0 && t2 > 0 ? Math.min(t1, t2) : Math.max(t1, t2, 0); }
  }
  t = clamp(t, 0, 120);
  return out.copy(tgtPos).addScaledVector(tgtVel, t);
}

/** Specific energy height (m): altitude + V²/2g. */
export const energyHeight = (alt, V) => alt + (V * V) / (2 * G0);
