// CPU-side emitters: decide WHEN/WHERE to spawn GPU particles (ground interaction, crash, sonic boom…).
// No allocations in the per-frame paths (scratch vectors only).
import * as THREE from 'three';
import { KIND } from './particles.js';

const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
const rnd = Math.random;
const sgn = () => rnd() * 2 - 1;

function randDir(out, upBias = 0) {
  let x, y, z, l;
  do { x = sgn(); y = sgn(); z = sgn(); l = x * x + y * y + z * z; } while (l > 1 || l < 1e-4);
  l = Math.sqrt(l); return out.set(x / l, y / l + upBias, z / l);
}

/** body point (array [x,y,z]) → world position */
export function bodyToWorld(state, b, out) {
  return out.set(b[0], b[1], b[2]).applyQuaternion(state.quaternion).add(state.position);
}

// ---------------------------------------------------------------------------------------------------------------------
export function tyreSmoke(ps, state, wheelWorld, sink, gs, q) {
  // white-grey rubber smoke: initial burst blown backward a bit, spreading and rising slowly
  const n = Math.round((6 + Math.min(18, Math.abs(sink) * 6 + gs * 0.08)) * q);
  const scale = 0.6 + Math.min(1.4, Math.abs(sink) * 0.35 + gs / 120);
  const p = ps.p;
  for (let i = 0; i < n; i++) {
    p.life = 2.5 + rnd() * 3.0; p.size0 = 0.5 * scale; p.size1 = (3.5 + rnd() * 3) * scale;
    p.drag = 1.6; p.buoy = 0.6; p.kind = KIND.SMOKE; p.emissive = 0; p.aux = 0; p.delay = rnd() * 0.08;
    const c = 0.72 + rnd() * 0.12; p.r = c; p.g = c; p.b = c * 1.02; p.opacity = 0.55 + rnd() * 0.2;
    _v.copy(state.velocity).multiplyScalar(0.18 + rnd() * 0.15);
    _v.x += sgn() * 2.5; _v.y += 0.6 + rnd() * 1.6; _v.z += sgn() * 2.5;
    _p.copy(wheelWorld); _p.x += sgn() * 0.3; _p.z += sgn() * 0.3; _p.y += 0.2;
    ps.spawn(_p, _v);
  }
}

export function skidSmoke(ps, state, wheelWorld, skid, dt, q, acc) {
  acc.v += skid * (20 + state.groundSpeed * 0.6) * dt * q;
  const p = ps.p;
  while (acc.v >= 1) {
    acc.v -= 1;
    p.life = 2 + rnd() * 2; p.size0 = 0.4; p.size1 = 2.5 + rnd() * 2.5; p.drag = 2; p.buoy = 0.5;
    p.kind = KIND.SMOKE; p.emissive = 0; p.delay = 0; const c = 0.7 + rnd() * 0.1; p.r = c; p.g = c; p.b = c;
    p.opacity = 0.35 + 0.3 * skid;
    _v.copy(state.velocity).multiplyScalar(0.15); _v.x += sgn(); _v.y += 0.5 + rnd(); _v.z += sgn();
    ps.spawn(_p.copy(wheelWorld).setY(wheelWorld.y + 0.2), _v);
  }
}

export function dust(ps, pos, vel, rate, dt, q, acc, color, sizeK = 1) {
  acc.v += rate * dt * q;
  const p = ps.p;
  while (acc.v >= 1) {
    acc.v -= 1;
    p.life = 3 + rnd() * 3; p.size0 = 0.8 * sizeK; p.size1 = (5 + rnd() * 5) * sizeK; p.drag = 1.2; p.buoy = 0.8;
    p.kind = KIND.SMOKE; p.emissive = 0; p.delay = 0; const k = 0.85 + rnd() * 0.25;
    p.r = color[0] * k; p.g = color[1] * k; p.b = color[2] * k; p.opacity = 0.32 + rnd() * 0.2;
    _v.copy(vel); _v.x += sgn() * 1.5; _v.y += 0.4 + rnd() * 1.4; _v.z += sgn() * 1.5;
    _p.copy(pos); _p.x += sgn() * 0.8; _p.z += sgn() * 0.8;
    ps.spawn(_p, _v);
  }
}

export function waterSpray(ps, pos, vel, back, intensity, dt, q, acc) {
  // white mist sheet + rooster tail thrown up and back (falls ballistically, then mists out)
  acc.v += intensity * 160 * dt * q;
  const p = ps.p;
  while (acc.v >= 1) {
    acc.v -= 1;
    const tail = rnd() < 0.55;
    p.life = tail ? 1.6 + rnd() * 1.2 : 2.5 + rnd() * 2.5; p.size0 = tail ? 0.8 : 2.0; p.size1 = tail ? 4 + rnd() * 4 : 9 + rnd() * 8;
    p.drag = tail ? 0.35 : 1.4; p.buoy = tail ? -24 : 0.2; p.kind = KIND.VAPOR; p.emissive = 0; p.delay = 0;
    p.r = 0.95; p.g = 0.97; p.b = 1.0; p.opacity = (tail ? 0.7 : 0.4) * Math.min(1, intensity * 1.5);
    _v.copy(vel).multiplyScalar(tail ? 0.45 : 0.2);
    if (tail) { _v.addScaledVector(back, 6 + rnd() * 10); _v.y += (8 + rnd() * 14) * Math.min(1.3, intensity + 0.3); }
    _v.x += sgn() * 3; _v.z += sgn() * 3; _v.y += rnd() * 2;
    _p.copy(pos); _p.x += sgn() * 1.5; _p.z += sgn() * 1.5;
    ps.spawn(_p, _v);
  }
}

export function sparks(ps, pos, vel, rate, dt, q, acc) {
  acc.v += rate * dt * q;
  const p = ps.p;
  while (acc.v >= 1) {
    acc.v -= 1;
    p.life = 0.4 + rnd() * 0.7; p.size0 = p.size1 = 0.05 + rnd() * 0.04; p.drag = 0.6; p.buoy = -16;
    p.kind = KIND.SPARK; p.emissive = 30 + rnd() * 40; p.aux = 0.03; p.delay = 0;
    p.r = 1.0; p.g = 0.6 + rnd() * 0.25; p.b = 0.25; p.opacity = 1;
    _v.copy(vel).multiplyScalar(0.7 + rnd() * 0.25); _v.x += sgn() * 5; _v.y += rnd() * 5; _v.z += sgn() * 5;
    ps.spawn(_p.copy(pos), _v);
  }
}

export function jetExhaustHaze(ps, pos, vel, rate, dt, q, acc) {
  // faint heat-haze / kerosene haze puffs (nearly invisible by day, lit by the fx light at night)
  acc.v += rate * dt * q;
  const p = ps.p;
  while (acc.v >= 1) {
    acc.v -= 1;
    p.life = 1.5 + rnd(); p.size0 = 0.8; p.size1 = 4 + rnd() * 3; p.drag = 1.5; p.buoy = 1.2;
    p.kind = KIND.SMOKE; p.emissive = 0; p.delay = 0; p.r = 0.45; p.g = 0.45; p.b = 0.47; p.opacity = 0.06;
    _v.copy(vel); _v.x += sgn() * 2; _v.y += sgn() * 2; _v.z += sgn() * 2;
    ps.spawn(_p.copy(pos), _v);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
/** Big explosion at world pos. ps: short-lived system, smoke: long-lived system. scale ≈ aircraft size factor. */
export function explosion(ps, smoke, pos, vel, scale, q) {
  const p = ps.p;
  // 1. flash
  p.kind = KIND.GLOW; p.life = 0.35; p.size0 = 25 * scale; p.size1 = 45 * scale; p.drag = 1; p.buoy = 0; p.delay = 0;
  p.r = 1; p.g = 0.85; p.b = 0.6; p.opacity = 1; p.emissive = 400; p.aux = 0;
  ps.spawn(pos, _v.set(0, 0, 0));
  p.life = 0.12; p.size0 = 60 * scale; p.size1 = 80 * scale; p.emissive = 160; p.r = 1; p.g = 0.95; p.b = 0.85;
  ps.spawn(pos, _v);
  // 2. fireball: rolling flame balls bursting outward then rising, a second burst slightly delayed
  const nf = Math.round(46 * Math.max(0.5, q));
  for (let i = 0; i < nf; i++) {
    randDir(_w, 0.35).normalize();
    const late = i > nf * 0.7;
    p.kind = KIND.FIRE; p.life = 2.6 + rnd() * 2.2; p.size0 = (2.5 + rnd() * 3) * scale; p.size1 = (12 + rnd() * 12) * scale;
    p.drag = 2.2; p.buoy = 7 + rnd() * 5; p.delay = late ? 0.15 + rnd() * 0.35 : rnd() * 0.06;
    p.r = 0.16; p.g = 0.14; p.b = 0.13; p.opacity = 0.95; p.emissive = 22 + rnd() * 30; p.aux = 0;
    _v.copy(_w).multiplyScalar((10 + rnd() * 26) * scale).addScaledVector(vel, 0.25);
    _p.copy(pos).addScaledVector(_w, rnd() * 5 * scale);
    ps.spawn(_p, _v);
  }
  // 3. debris sparks / burning fragments
  const ns = Math.round(110 * Math.max(0.5, q));
  for (let i = 0; i < ns; i++) {
    randDir(_w, 0.5).normalize();
    p.kind = KIND.SPARK; p.life = 1.2 + rnd() * 2.4; p.size0 = p.size1 = 0.12 + rnd() * 0.18; p.drag = 0.25; p.buoy = -30;
    p.delay = rnd() * 0.1; p.r = 1; p.g = 0.55 + rnd() * 0.3; p.b = 0.2; p.opacity = 1; p.emissive = 40 + rnd() * 60; p.aux = 0.04;
    _v.copy(_w).multiplyScalar(18 + rnd() * 55).addScaledVector(vel, 0.4);
    ps.spawn(pos, _v);
  }
  // 4. dense dark smoke burst (long-lived system)
  const sp = smoke.p;
  const nb = Math.round(24 * Math.max(0.5, q));
  for (let i = 0; i < nb; i++) {
    randDir(_w, 0.6).normalize();
    sp.kind = KIND.SMOKE; sp.life = 14 + rnd() * 10; sp.size0 = 8 * scale; sp.size1 = (30 + rnd() * 20) * scale;
    sp.drag = 0.9; sp.buoy = 5 + rnd() * 4; sp.delay = 0.6 + rnd() * 1.2; const c = 0.05 + rnd() * 0.05;
    sp.r = c; sp.g = c; sp.b = c; sp.opacity = 0.85; sp.emissive = 0; sp.aux = 0;
    _v.copy(_w).multiplyScalar(6 + rnd() * 10);
    _p.copy(pos).addScaledVector(_w, 4 * scale);
    smoke.spawn(_p, _v);
  }
}

/** Splash when ditching / crashing into water. */
export function splash(ps, pos, vel, scale, q) {
  const p = ps.p;
  const n = Math.round(120 * Math.max(0.5, q));
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, up = 0.4 + rnd() * 0.9;
    _w.set(Math.cos(a), up * 2.2, Math.sin(a)).normalize();
    p.kind = KIND.VAPOR; p.life = 2 + rnd() * 2.5; p.size0 = 2 * scale; p.size1 = (9 + rnd() * 10) * scale;
    p.drag = 0.7; p.buoy = -9; p.delay = rnd() * 0.15; p.r = 0.95; p.g = 0.97; p.b = 1; p.opacity = 0.75; p.emissive = 0; p.aux = 0;
    _v.copy(_w).multiplyScalar(14 + rnd() * 28).addScaledVector(vel, 0.3);
    ps.spawn(pos, _v);
  }
}

/** Burning wreck: continuous dark smoke column + base flames. state = { t, pos (world Vector3), fireAcc, smokeAcc } */
export function wreckUpdate(ps, smoke, w, dt, q, scale) {
  w.t += dt;
  const fireRate = Math.max(0, 1 - w.t / 45) * 16 * scale;
  const smokeRate = (w.t < 90 ? 3.2 : Math.max(0, 3.2 * (1 - (w.t - 90) / 60))) * Math.max(0.6, scale);
  w.fireAcc += fireRate * dt * q; w.smokeAcc += smokeRate * dt * q;
  const p = ps.p, sp = smoke.p;
  while (w.fireAcc >= 1) {
    w.fireAcc -= 1;
    p.kind = KIND.FIRE; p.life = 1.2 + rnd() * 1.4; p.size0 = (1.2 + rnd() * 1.5) * scale; p.size1 = (5 + rnd() * 5) * scale;
    p.drag = 2; p.buoy = 5 + rnd() * 4; p.delay = 0; p.r = 0.12; p.g = 0.1; p.b = 0.1; p.opacity = 0.75;
    p.emissive = 18 + rnd() * 18; p.aux = 0;
    _v.set(sgn() * 1.5, 1 + rnd() * 2, sgn() * 1.5);
    _p.copy(w.pos); _p.x += sgn() * 5 * scale; _p.z += sgn() * 5 * scale; _p.y += 0.5;
    ps.spawn(_p, _v);
  }
  while (w.smokeAcc >= 1) {
    w.smokeAcc -= 1;
    sp.kind = KIND.SMOKE; sp.life = 22 + rnd() * 14; sp.size0 = (4 + rnd() * 3) * scale; sp.size1 = (28 + rnd() * 26) * scale;
    sp.drag = 0.6; sp.buoy = 6 + rnd() * 3; sp.delay = 0; const c = 0.04 + rnd() * 0.05 + Math.min(0.15, w.t / 600);
    sp.r = c; sp.g = c; sp.b = c * 1.05; sp.opacity = 0.8; sp.emissive = 0; sp.aux = 0;
    _v.set(sgn() * 1.5, 2 + rnd() * 2, sgn() * 1.5);
    _p.copy(w.pos); _p.x += sgn() * 3 * scale; _p.z += sgn() * 3 * scale; _p.y += 3;
    smoke.spawn(_p, _v);
  }
  return fireRate / (16 * scale);   // 0..1 fire intensity (for the fx light)
}

/** Sonic boom: expanding condensation ring perpendicular to the flight path. */
export function shockRing(ps, pos, vel, q) {
  const p = ps.p;
  const fwd = _fwd.copy(vel).normalize();
  _right.set(0, 1, 0).cross(fwd); if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0); _right.normalize();
  _up.copy(fwd).cross(_right).normalize();
  const n = Math.round(56 * Math.max(0.5, q));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    _w.copy(_right).multiplyScalar(Math.cos(a)).addScaledVector(_up, Math.sin(a));
    p.kind = KIND.VAPOR; p.life = 0.6 + rnd() * 0.4; p.size0 = 1.2; p.size1 = 5 + rnd() * 3; p.drag = 3; p.buoy = 0; p.delay = 0;
    p.r = 1; p.g = 1; p.b = 1; p.opacity = 0.55; p.emissive = 0; p.aux = 0;
    _v.copy(vel).multiplyScalar(0.92).addScaledVector(_w, 40 + rnd() * 10);
    _p.copy(pos).addScaledVector(_w, 3).addScaledVector(fwd, -2);
    ps.spawn(_p, _v);
  }
}

/** Engine-start puff (unburnt fuel). */
export function engineStartPuff(ps, pos, back, q) {
  const p = ps.p;
  for (let i = 0; i < Math.round(14 * q); i++) {
    p.kind = KIND.SMOKE; p.life = 3 + rnd() * 2; p.size0 = 0.8; p.size1 = 5 + rnd() * 3; p.drag = 1.5; p.buoy = 0.8; p.delay = rnd() * 0.4;
    const c = 0.35 + rnd() * 0.1; p.r = c; p.g = c; p.b = c; p.opacity = 0.4; p.emissive = 0; p.aux = 0;
    _v.copy(back).multiplyScalar(6 + rnd() * 6); _v.x += sgn(); _v.y += rnd(); _v.z += sgn();
    ps.spawn(pos, _v);
  }
}
export { _q as _scratch };
