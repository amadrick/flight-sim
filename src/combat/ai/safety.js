// Terrain look-ahead: predicts the path of a maximum-performance recovery (roll the lift vector up, pull to a climb)
// starting now, along the velocity vector and along turning escape paths, and returns how much clearance above the
// terrain it keeps. Real terrain has 3 km mountains: we sample the ground ALONG the predicted path, not just below.
// Pure: the ground is a function groundAt(x, z) → height (m MSL).
import { clamp, G0 } from '../util.js';

/**
 * Predict the minimum terrain clearance (m) of a recovery manoeuvre.
 * s: { x, y, z, vx, vy, vz, roll } (world position / velocity, bank angle rad)
 * p: { nz (load factor used for the pull), rollRate (rad/s), climb (target flight-path angle, rad),
 *      turn (rad/s heading rate applied while recovering, + right), horizon (s), dt (s), delay (s, reaction) }
 * Returns { clear (min height above ground on the path, m), at (time of the minimum, s), ground (max terrain height seen) }.
 */
export function predictRecovery(groundAt, s, p, out = {}) {
  const V = Math.max(Math.hypot(s.vx, s.vy, s.vz), 30);
  let gam = Math.asin(clamp(s.vy / V, -1, 1));
  let hx = s.vx, hz = s.vz;
  const hl = Math.hypot(hx, hz);
  let psi = hl > 1 ? Math.atan2(hx, -hz) : (s.psi || 0);
  let x = s.x, y = s.y, z = s.z;
  const tRoll = (p.delay || 0) + Math.abs(s.roll) / Math.max(p.rollRate, 0.3);
  const dt = p.dt || 0.35, T = p.horizon || 12;
  const climb = p.climb ?? 0.2;
  let minClear = Infinity, at = 0, gmax = -Infinity;
  for (let t = dt; t <= T + 1e-9; t += dt) {
    if (t > tRoll) {
      // pulling: the lift accelerates the flight path up (minus gravity's share), until the target climb angle
      if (gam < climb) {
        const n = 1 + (p.nz - 1) * clamp((t - tRoll) / (p.onset ?? 0.6), 0, 1);     // G onset
        const gd = (G0 * (n - Math.cos(gam))) / V;
        gam = Math.min(climb, gam + gd * dt);
      }
      psi += (p.turn || 0) * dt;
    } else {
      // still rolling: the path keeps curving downward with gravity at ~1 g of lift
      gam += (G0 * (Math.max(Math.cos(s.roll), 0) - Math.cos(gam)) / V) * dt;
    }
    const ch = Math.cos(gam) * V;
    x += Math.sin(psi) * ch * dt; z += -Math.cos(psi) * ch * dt; y += Math.sin(gam) * V * dt;
    const g = groundAt(x, z);
    if (g > gmax) gmax = g;
    const c = y - g;
    if (c < minClear) { minClear = c; at = t; }
  }
  out.clear = minClear; out.at = at; out.ground = gmax;
  return out;
}

/**
 * Straight-line look-ahead: minimum clearance (m) above the ground along the current velocity for `horizon` s.
 */
export function straightClearance(groundAt, s, horizon = 8, dt = 0.5) {
  let min = Infinity;
  for (let t = dt; t <= horizon + 1e-9; t += dt) {
    const x = s.x + s.vx * t, z = s.z + s.vz * t, y = s.y + s.vy * t;
    const c = y - groundAt(x, z);
    if (c < min) min = c;
  }
  return min;
}

/**
 * Highest terrain (m) in a fan ahead of a horizontal heading: samples at the given distances along the heading and
 * ±spread rad either side. Used for the soft floor (hard deck that follows the terrain).
 */
export function terrainAhead(groundAt, x, z, psi, dists, spread = 0.35) {
  let h = groundAt(x, z);
  for (let i = 0; i < dists.length; i++) {
    const d = dists[i];
    for (let k = -1; k <= 1; k++) {
      const a = psi + k * spread;
      const g = groundAt(x + Math.sin(a) * d, z - Math.cos(a) * d);
      if (g > h) h = g;
    }
  }
  return h;
}
