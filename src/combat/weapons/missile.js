// Missile kinematics (motor, drag, g limit, autopilot lag), proportional navigation, fly-out tables and the dynamic
// launch zone, plus the seeker physics (IR signature, flare intensity, radar notch). Pure functions over plain state.
import * as THREE from 'three';
import { rhoAt, soundAt, G } from './ballistics.js';

const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---- motor / mass / aerodynamics ------------------------------------------------------------------------------------
export function burnTime(spec) { return spec.motor.boost[1] + spec.motor.sustain[1]; }
export function thrustAt(spec, t) {
  const b = spec.motor.boost, s = spec.motor.sustain;
  if (t < 0) return 0;
  if (t < b[1]) return b[0];
  if (t < b[1] + s[1]) return s[0];
  return 0;
}
export function massAt(spec, t) { const bt = burnTime(spec); return spec.mass - spec.propellant * sat(t / bt); }
export function areaOf(spec) { return spec._A ??= Math.PI * spec.diameter * spec.diameter * 0.25; }
/** Zero-lift drag coefficient vs Mach (subsonic low, transonic rise, supersonic slow decay). */
export function cdMach(spec, M) {
  const c = spec.cd0;
  if (M < 0.8) return c * 0.62;
  if (M < 1.05) return c * (0.62 + (M - 0.8) / 0.25 * 0.68);
  if (M < 1.5) return c * (1.3 - (M - 1.05) / 0.45 * 0.3);
  return c * Math.max(0.72, 1.0 - (M - 1.5) * 0.12);
}
/** Max lateral acceleration (m/s²): aerodynamic limit q·A·CNmax/m, structural cap maxG. */
export function maxAccel(spec, speed, rho, mass) {
  const q = 0.5 * rho * speed * speed;
  return Math.min(q * areaOf(spec) * spec.cnMax / mass, spec.maxG * G);
}

/** Fresh kinematic state (also usable for fly-out simulations). */
export function createKin() {
  return { pos: new THREE.Vector3(), vel: new THREE.Vector3(), aLat: new THREE.Vector3(), t: 0, mass: 0, thrust: 0, speed: 0, mach: 0, aMax: 0, g: 0 };
}

const _vh = new THREE.Vector3(), _ac = new THREE.Vector3();
/**
 * Advance the missile body by dt. aCmd: commanded acceleration (world, m/s²) — the part along the velocity is dropped,
 * the rest is limited to the available g and follows a first-order autopilot lag (spec.tau). Gravity, thrust and drag
 * (zero-lift + induced from the lateral load) are applied. `motorDelay` s: ignition after release.
 */
export function stepKin(k, spec, aCmd, dt, motorDelay = 0) {
  const v = k.vel;
  const speed = v.length() || 1;
  _vh.copy(v).divideScalar(speed);
  const h = k.pos.y, rho = rhoAt(h), M = speed / soundAt(h);
  const tm = k.t - motorDelay;
  const thrust = thrustAt(spec, tm), mass = massAt(spec, Math.max(0, tm));
  const q = 0.5 * rho * speed * speed, A = areaOf(spec);
  const aMax = Math.min(q * A * spec.cnMax / mass, spec.maxG * G);
  // lateral command
  _ac.copy(aCmd).addScaledVector(_vh, -aCmd.dot(_vh));
  const ac = _ac.length();
  if (ac > aMax) _ac.multiplyScalar(aMax / ac);
  const lag = 1 - Math.exp(-dt / spec.tau);
  k.aLat.lerp(_ac, lag);
  k.aLat.addScaledVector(_vh, -k.aLat.dot(_vh));
  const al = k.aLat.length();
  if (al > aMax) k.aLat.multiplyScalar(aMax / al);
  const CN = q > 1 ? mass * Math.min(al, aMax) / (q * A) : 0;
  const cd = cdMach(spec, M) * (thrust > 0 ? 0.75 : 1) + 0.025 * CN * CN;
  const along = (thrust - q * A * cd) / mass;
  v.addScaledVector(_vh, along * dt).addScaledVector(k.aLat, dt);
  v.y -= G * dt;
  k.pos.addScaledVector(v, dt);
  k.t += dt; k.mass = mass; k.thrust = thrust; k.speed = v.length(); k.mach = M; k.aMax = aMax; k.g = al / G;
  return k;
}

// ---- proportional navigation ----------------------------------------------------------------------------------------
const _r = new THREE.Vector3(), _vr = new THREE.Vector3();
export const pnInfo = { range: 0, closure: 0, tgo: 0 };
/**
 * True proportional navigation: a = N · Vc · (relative velocity ⊥ LOS) / range, plus gravity compensation.
 * Fills out (world m/s²); pnInfo gets range, closure (+ = closing) and tgo.
 */
export function pnCommand(mPos, mVel, tPos, tVel, N, out) {
  _r.copy(tPos).sub(mPos);
  const R = _r.length() || 1e-3;
  _r.divideScalar(R);
  _vr.copy(tVel).sub(mVel);
  const vc = -_vr.dot(_r);
  _vr.addScaledVector(_r, -_vr.dot(_r));                // ⊥ LOS
  out.copy(_vr).multiplyScalar(N * Math.max(vc, 50) / R);
  out.y += G;                                           // fly against gravity
  pnInfo.range = R; pnInfo.closure = vc; pnInfo.tgo = vc > 1 ? R / vc : Infinity;
  return out;
}

// ---- fly-out tables & launch zone -----------------------------------------------------------------------------------
export const TABLE_ALTS = [0, 2000, 4000, 6000, 8000, 10000, 12500, 15000];
export const TABLE_SPEEDS = [100, 200, 300, 400, 550, 700];
export const TABLE_DT = 0.25;
const _cmd = new THREE.Vector3(0, G, 0);
/** Straight, level fly-out from altitude h at launch speed v0: distance D(t) and speed V(t) every TABLE_DT. */
export function flyout(spec, h, v0, out = {}) {
  const n = Math.ceil(spec.life / TABLE_DT) + 1;
  const D = out.D || new Float32Array(n), V = out.V || new Float32Array(n);
  const k = createKin();
  k.pos.set(0, h, 0); k.vel.set(0, 0, -v0);
  const sub = 5, dt = TABLE_DT / sub;
  D[0] = 0; V[0] = v0;
  for (let i = 1; i < n; i++) {
    for (let s = 0; s < sub; s++) { _cmd.set(0, G, 0); stepKin(k, spec, _cmd, dt); }
    D[i] = -k.pos.z; V[i] = k.speed;
  }
  out.D = D; out.V = V; out.n = n;
  return out;
}
/** Precompute the fly-out grid for a missile spec (≈ 50 fly-outs; a few ms). */
export function buildTable(spec) {
  const grid = [];
  for (const h of TABLE_ALTS) { const row = []; for (const v of TABLE_SPEEDS) row.push(flyout(spec, h, v)); grid.push(row); }
  return { spec, grid, n: grid[0][0].n };
}
function idx(xs, x) {
  if (x <= xs[0]) return 0; const n = xs.length;
  if (x >= xs[n - 1]) return n - 1.0001;
  let i = 0; while (x > xs[i + 1]) i++;
  return i + (x - xs[i]) / (xs[i + 1] - xs[i]);
}

/**
 * Dynamic launch zone for a shot fired now. g: { alt (m, mean of shooter and target), climb (target alt − shooter alt),
 * vLaunch (shooter speed along the LOS), vAway (target velocity along the LOS away from the shooter), vTarget (target
 * speed), range }. Fills out { rMax, rNe, tti } using the fly-out grid:
 *   rMax: largest range for which the missile reaches the target flying its current velocity with speed ≥ vMin;
 *   rNe : same if the target turns tail now and runs (after a 3 s turn) — the no-escape range;
 *   tti : time to intercept at the current range (0 when out of reach).
 */
export function launchZone(T, g, out) {
  const ia = idx(TABLE_ALTS, g.alt), iv = idx(TABLE_SPEEDS, Math.max(100, g.vLaunch));
  const a0 = Math.floor(ia), fa = ia - a0, v0 = Math.floor(iv), fv = iv - v0;
  const r00 = T.grid[a0][v0], r01 = T.grid[a0][v0 + 1], r10 = T.grid[a0 + 1][v0], r11 = T.grid[a0 + 1][v0 + 1];
  const w00 = (1 - fa) * (1 - fv), w01 = (1 - fa) * fv, w10 = fa * (1 - fv), w11 = fa * fv;
  const vMin = Math.max(T.spec.seeker === 'ir' ? 280 : 300, g.vTarget * 0.9 + 60);
  const climbLoss = Math.max(0, g.climb) * 1.5;      // climbing costs range, diving adds a little
  const diveGain = Math.max(0, -g.climb) * 0.5;
  let rMax = 0, rNe = 0, tti = 0;
  const run = g.vTarget + 20, tr = 3;
  for (let i = 1; i < T.n; i++) {
    const t = i * TABLE_DT;
    const V = r00.V[i] * w00 + r01.V[i] * w01 + r10.V[i] * w10 + r11.V[i] * w11;
    if (V < vMin && t > 3) break;
    const D = r00.D[i] * w00 + r01.D[i] * w01 + r10.D[i] * w10 + r11.D[i] * w11 - climbLoss + diveGain;
    const reach = D - g.vAway * t;
    if (reach > rMax) rMax = reach;
    const ne = D - (t < tr ? g.vAway * t : g.vAway * tr + run * (t - tr));
    if (ne > rNe) rNe = ne;
    if (!tti && reach >= g.range) tti = t;
  }
  out.rMax = rMax * 0.92; out.rNe = Math.min(rNe * 0.92, out.rMax); out.tti = tti;
  return out;
}

// ---- seekers --------------------------------------------------------------------------------------------------------
const _d = new THREE.Vector3(), _tail = new THREE.Vector3();
/**
 * IR signature of an aircraft seen from world point `from` (relative units: an F-16 at MIL power from dead astern ≈ 1.1).
 * Engine plume heat (n1, afterburner, fire) × an aspect factor (strongest from the tail, ≈ 15 % head-on) + airframe
 * heating (all aspect, grows with Mach).
 */
export function irSignature(t, from) {
  const s = t.state;
  let heat = 0, n = 0;
  const E = s.engines || [];
  for (let i = 0; i < E.length; i++) {
    const e = E[i]; n++;
    if (!e.running && !(e.n1 > 0.2)) continue;
    const n1 = Math.min(1.05, e.n1 || 0);
    heat += 0.18 + 0.82 * n1 * n1 + 2.4 * (e.afterburner || 0);
  }
  if (!n) heat = 1; else heat /= Math.sqrt(n);
  if (t.damage) heat += 1.5 * (t.damage.fire || 0);
  _d.copy(from).sub(s.position).normalize();
  if (t.forward) _tail.copy(t.forward).negate(); else _tail.set(0, 0, 1).applyQuaternion(s.quaternion);
  const c = _d.dot(_tail);
  const a = (1 + c) * 0.5;
  const aspect = 0.14 + 0.86 * a * a;
  const mach = s.mach || 0;
  return heat * aspect + 0.1 + 0.08 * mach * mach;
}
/** Flare intensity vs age (relative units as above). */
export function flareIntensity(F, age, life, eff = 1) {
  if (age < 0 || age > life) return 0;
  const rise = age < F.rise ? age / F.rise : 1;
  const fade = age > life - F.fade ? (life - age) / F.fade : 1;
  return F.peak * eff * rise * fade;
}
/**
 * Doppler notch of a radar track: how strongly the target hides in the clutter, 0..1. Beaming (small radial velocity
 * relative to the radar) × clutter behind it (target low, or the radar looking down on it).
 */
export function notchFactor(radarPos, tState, agl) {
  _d.copy(tState.position).sub(radarPos);
  const R = _d.length() || 1; _d.divideScalar(R);
  const vr = Math.abs(tState.velocity.dot(_d));
  const beam = sat(1 - (vr - 25) / 45);                  // ≤ 25 m/s radial: fully in the notch; ≥ 70 m/s: clear
  const lookDown = sat((radarPos.y - tState.position.y) / R * 5);
  const low = sat(1 - (agl - 300) / 4000);
  const clutter = Math.max(0.25, lookDown, low);
  return beam * clutter;
}
