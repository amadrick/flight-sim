// Particle spawn recipes for combat (CPU side; the GPU integrates the motion — see effects/particles.js).
// ps = short-lived system (sparks, flame, flashes, small puffs), smoke = long-lived system (big lingering smoke).
// Positions / velocities are WORLD vectors. q = quality factor (ctx.quality.particles). No allocations.
import * as THREE from 'three';
import { KIND } from '../../effects/particles.js';

const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _z = new THREE.Vector3();
const rnd = Math.random, sgn = () => rnd() * 2 - 1;
const Z = new THREE.Vector3();

export function randDir(out, upBias = 0) {
  let x, y, z, l;
  do { x = sgn(); y = sgn(); z = sgn(); l = x * x + y * y + z * z; } while (l > 1 || l < 1e-4);
  l = Math.sqrt(l); return out.set(x / l, y / l + upBias, z / l).normalize();
}

/** Short bright flash (additive glow particle). */
export function flash(ps, pos, vel, size, I, r = 1, g = 0.8, b = 0.55, life = 0.25) {
  const p = ps.p;
  p.kind = KIND.GLOW; p.life = life; p.size0 = size * 0.6; p.size1 = size; p.drag = 3; p.buoy = 0; p.delay = 0;
  p.r = r; p.g = g; p.b = b; p.opacity = 1; p.emissive = I; p.aux = 0;
  ps.spawn(pos, vel || Z);
}

export function sparkBurst(ps, pos, vel, n, speed, hot = 1, life = 1.2, size = 0.08) {
  const p = ps.p;
  for (let i = 0; i < n; i++) {
    randDir(_w, 0.15);
    p.kind = KIND.SPARK; p.life = life * (0.4 + rnd()); p.size0 = p.size1 = size * (0.6 + rnd() * 0.8); p.drag = 0.8 + rnd(); p.buoy = -9.8;
    p.delay = rnd() * 0.04; p.r = 1; p.g = 0.55 + rnd() * 0.35 * hot; p.b = 0.2 + 0.3 * hot * rnd(); p.opacity = 1;
    p.emissive = (40 + rnd() * 80) * hot; p.aux = 0.035;
    ps.spawn(pos, _v.copy(_w).multiplyScalar(speed * (0.25 + rnd())).addScaledVector(vel || Z, 0.85));
  }
}

/** Cannon shell hit on an airframe: white-hot flash, a spray of sparks, a small dark puff and a few dull fragments. */
export function bulletHit(ps, smoke, pos, vel, q, big = 1) {
  flash(ps, pos, vel ? _z.copy(vel).multiplyScalar(0.9) : Z, 2.2 * big, 260, 1, 0.9, 0.7, 0.12);
  sparkBurst(ps, pos, vel, Math.round(14 * big * Math.max(0.5, q)), 55, 1, 0.7, 0.06);
  const p = ps.p;
  // dull fragments: non-emissive "sparks" (dark streaks)
  for (let i = 0, n = Math.round(4 * big * Math.max(0.5, q)); i < n; i++) {
    randDir(_w, 0.1);
    p.kind = KIND.SPARK; p.life = 0.9 + rnd(); p.size0 = p.size1 = 0.05; p.drag = 0.5; p.buoy = -9.8; p.delay = 0;
    p.r = 0.6; p.g = 0.5; p.b = 0.4; p.opacity = 1; p.emissive = 2; p.aux = 0.02;
    ps.spawn(pos, _v.copy(_w).multiplyScalar(25 + rnd() * 25).addScaledVector(vel || Z, 0.9));
  }
  for (let i = 0, n = Math.round(3 * big * Math.max(0.6, q)); i < n; i++) {
    p.kind = KIND.SMOKE; p.life = 1.2 + rnd() * 1.4; p.size0 = 0.5 * big; p.size1 = (2.2 + rnd() * 1.5) * big; p.drag = 3.5; p.buoy = 0.5;
    p.delay = rnd() * 0.05; const c = 0.12 + rnd() * 0.1; p.r = c; p.g = c; p.b = c; p.opacity = 0.7; p.emissive = 0; p.aux = 0;
    _v.copy(vel || Z).multiplyScalar(0.9); _v.x += sgn() * 4; _v.y += sgn() * 4; _v.z += sgn() * 4;
    ps.spawn(pos, _v);
  }
}

/** Shells hitting the ground: dust spout (land) or water spout (sea). */
export function groundStrike(ps, pos, water, q, dust) {
  const p = ps.p;
  const n = Math.round((water ? 7 : 6) * Math.max(0.5, q));
  for (let i = 0; i < n; i++) {
    if (water) {
      p.kind = KIND.VAPOR; p.life = 1.2 + rnd() * 1.2; p.size0 = 0.5; p.size1 = 2.5 + rnd() * 2.5; p.drag = 0.6; p.buoy = -9;
      p.r = 0.95; p.g = 0.97; p.b = 1; p.opacity = 0.75;
      _v.set(sgn() * 3, 14 + rnd() * 16, sgn() * 3);
    } else {
      p.kind = KIND.SMOKE; p.life = 2 + rnd() * 2.5; p.size0 = 0.6; p.size1 = 3 + rnd() * 3; p.drag = 1.6; p.buoy = 0.4;
      const k = 0.85 + rnd() * 0.3; p.r = dust[0] * k; p.g = dust[1] * k; p.b = dust[2] * k; p.opacity = 0.6;
      _v.set(sgn() * 4, 6 + rnd() * 10, sgn() * 4);
    }
    p.delay = rnd() * 0.05; p.emissive = 0; p.aux = 0;
    ps.spawn(pos, _v);
  }
  if (!water) { flash(ps, _p.copy(pos).setY(pos.y + 0.5), Z, 1.2, 90, 1, 0.8, 0.5, 0.08); sparkBurst(ps, pos, Z, Math.round(3 * Math.max(0.5, q)), 15, 0.6, 0.5, 0.05); }
}

/** Gun smoke streaming from the muzzle (the particles keep most of the shooter's speed, then drag stops them). */
export function gunSmoke(ps, pos, vel, rate, dt, q, acc, big = 1) {
  acc.v += rate * dt * q;
  const p = ps.p;
  while (acc.v >= 1) {
    acc.v -= 1;
    p.kind = KIND.SMOKE; p.life = 1.0 + rnd() * 1.2; p.size0 = 0.3 * big; p.size1 = (2.0 + rnd() * 1.5) * big; p.drag = 2.8; p.buoy = 0.3;
    p.delay = rnd() * dt; const c = 0.55 + rnd() * 0.15; p.r = c; p.g = c; p.b = c * 1.02; p.opacity = 0.35 * Math.min(1.3, big);
    p.emissive = 0; p.aux = 0;
    _v.copy(vel).multiplyScalar(0.92); _v.x += sgn() * 2; _v.y += sgn() * 2; _v.z += sgn() * 2;
    ps.spawn(pos, _v);
  }
}

/** Flame licks (fire particles) streaming behind a burning aircraft. */
export function fireLicks(ps, pos, vel, back, rate, dt, q, acc, size) {
  acc.v += rate * dt * Math.max(0.5, q);
  const p = ps.p;
  while (acc.v >= 1) {
    acc.v -= 1;
    const f = rnd();
    p.kind = KIND.FIRE; p.life = 0.35 + rnd() * 0.45; p.size0 = size * (0.5 + rnd() * 0.4); p.size1 = size * (1.6 + rnd() * 1.4); p.drag = 1.2; p.buoy = 2;
    p.delay = 0; p.r = 0.12; p.g = 0.1; p.b = 0.09; p.opacity = 0.85; p.emissive = 30 + rnd() * 30; p.aux = 0;
    // back along the frame's path so a fast aircraft still leaves a continuous tongue
    _p.copy(pos).addScaledVector(vel, -dt * f);
    _v.copy(vel).multiplyScalar(0.88 + rnd() * 0.06).addScaledVector(back, 6 + rnd() * 8); _v.x += sgn() * 2; _v.y += sgn() * 2; _v.z += sgn() * 2;
    ps.spawn(_p, _v);
  }
}

/** Puff of smoke + flash at a missile launch rail. */
export function launchPuff(ps, smoke, pos, vel, back, q) {
  flash(ps, pos, _z.copy(vel), 4, 220, 1, 0.75, 0.45, 0.18);
  const p = smoke.p;
  for (let i = 0, n = Math.round(10 * Math.max(0.5, q)); i < n; i++) {
    p.kind = KIND.SMOKE; p.life = 3 + rnd() * 3; p.size0 = 0.8; p.size1 = 5 + rnd() * 4; p.drag = 2.2; p.buoy = 0.2; p.delay = rnd() * 0.15;
    const c = 0.8 + rnd() * 0.1; p.r = c; p.g = c; p.b = c; p.opacity = 0.55; p.emissive = 0; p.aux = 0;
    _v.copy(vel).multiplyScalar(0.85 + rnd() * 0.1).addScaledVector(back, 10 + rnd() * 20); _v.x += sgn() * 3; _v.y += sgn() * 3; _v.z += sgn() * 3;
    smoke.spawn(pos, _v);
  }
}

/** Warhead detonation: flash, fragment ring, small fireball, dark-grey burst puff. big: 1 hit, 0.5 self-destruct. */
export function warhead(ps, smoke, pos, vel, q, big = 1) {
  const qq = Math.max(0.5, q);
  flash(ps, pos, Z, 18 * big, 600 * big, 1, 0.9, 0.75, 0.16);
  flash(ps, pos, Z, 40 * big, 90 * big, 1, 0.7, 0.4, 0.35);
  // fragments: fast, short white-hot streaks
  sparkBurst(ps, pos, vel, Math.round(70 * big * qq), 260, 1.2, 0.5, 0.07);
  sparkBurst(ps, pos, vel, Math.round(30 * big * qq), 90, 0.8, 1.6, 0.1);
  const p = ps.p;
  for (let i = 0, n = Math.round(14 * big * qq); i < n; i++) {
    randDir(_w, 0.2);
    p.kind = KIND.FIRE; p.life = 0.6 + rnd() * 0.7; p.size0 = 1.5 * big; p.size1 = (5 + rnd() * 4) * big; p.drag = 3.5; p.buoy = 2;
    p.delay = rnd() * 0.04; p.r = 0.14; p.g = 0.13; p.b = 0.12; p.opacity = 0.9; p.emissive = 40 + rnd() * 40; p.aux = 0;
    ps.spawn(_p.copy(pos).addScaledVector(_w, rnd() * 2 * big), _v.copy(_w).multiplyScalar((12 + rnd() * 18) * big).addScaledVector(vel || Z, 0.3));
  }
  const s = smoke.p;
  for (let i = 0, n = Math.round(12 * qq); i < n; i++) {
    randDir(_w, 0.1);
    s.kind = KIND.SMOKE; s.life = 9 + rnd() * 8; s.size0 = 3 * big; s.size1 = (12 + rnd() * 8) * big; s.drag = 2.2; s.buoy = 0.6;
    s.delay = 0.05 + rnd() * 0.25; const c = big < 0.8 ? 0.45 + rnd() * 0.15 : 0.16 + rnd() * 0.1; s.r = c; s.g = c; s.b = c; s.opacity = 0.75; s.emissive = 0; s.aux = 0;
    smoke.spawn(_p.copy(pos).addScaledVector(_w, 2 * big), _v.copy(_w).multiplyScalar((6 + rnd() * 8) * big).addScaledVector(vel || Z, 0.15));
  }
}

/**
 * Mid-air kill fireball (particle part; the volumetric neural fireball is layered on top when available):
 * a hot rolling core that bursts, carries some of the aircraft's momentum, cools to orange and turns into black smoke.
 */
export function airFireball(ps, smoke, pos, vel, scale, q, withVolume) {
  const qq = Math.max(0.5, q);
  flash(ps, pos, _z.copy(vel).multiplyScalar(0.3), 30 * scale, 500, 1, 0.85, 0.6, 0.3);
  flash(ps, pos, _z, 70 * scale, 120, 1, 0.7, 0.4, 0.5);
  const p = ps.p;
  const nf = Math.round((withVolume ? 22 : 46) * qq);
  for (let i = 0; i < nf; i++) {
    randDir(_w, 0.15);
    p.kind = KIND.FIRE; p.life = 1.8 + rnd() * 2.2; p.size0 = (2.5 + rnd() * 2.5) * scale; p.size1 = (9 + rnd() * 9) * scale;
    p.drag = 1.6; p.buoy = 4 + rnd() * 3; p.delay = i > nf * 0.7 ? 0.1 + rnd() * 0.3 : rnd() * 0.05;
    p.r = 0.13; p.g = 0.12; p.b = 0.11; p.opacity = 0.95; p.emissive = 28 + rnd() * 30; p.aux = 0;
    _v.copy(_w).multiplyScalar((8 + rnd() * 20) * scale).addScaledVector(vel, 0.45 + rnd() * 0.2);
    ps.spawn(_p.copy(pos).addScaledVector(_w, rnd() * 4 * scale), _v);
  }
  sparkBurst(ps, pos, vel, Math.round(120 * qq), 70, 1, 2.2, 0.12);
  const s = smoke.p;
  for (let i = 0, n = Math.round(22 * qq); i < n; i++) {
    randDir(_w, 0.2);
    s.kind = KIND.SMOKE; s.life = 16 + rnd() * 12; s.size0 = 6 * scale; s.size1 = (22 + rnd() * 18) * scale; s.drag = 1.2; s.buoy = 2.5 + rnd() * 2;
    s.delay = 0.4 + rnd() * 1.0; const c = 0.04 + rnd() * 0.05; s.r = c; s.g = c; s.b = c; s.opacity = 0.85; s.emissive = 0; s.aux = 0;
    smoke.spawn(_p.copy(pos).addScaledVector(_w, 3 * scale).addScaledVector(vel, 0.25), _v.copy(_w).multiplyScalar((4 + rnd() * 8) * scale).addScaledVector(vel, 0.3));
  }
}

/** Water impact: a tall spray column and a ring of falling spray. */
export function splashColumn(ps, smoke, pos, vel, scale, q) {
  const p = ps.p, qq = Math.max(0.5, q);
  for (let i = 0, n = Math.round(140 * qq); i < n; i++) {
    const a = rnd() * Math.PI * 2, col = rnd() < 0.55;
    if (col) _w.set(Math.cos(a) * 0.25, 1, Math.sin(a) * 0.25).normalize();
    else _w.set(Math.cos(a), 0.6 + rnd() * 0.6, Math.sin(a)).normalize();
    p.kind = KIND.VAPOR; p.life = 2.5 + rnd() * 3; p.size0 = 2 * scale; p.size1 = (8 + rnd() * 10) * scale; p.drag = 0.5; p.buoy = -9.8;
    p.delay = rnd() * 0.2; p.r = 0.95; p.g = 0.97; p.b = 1; p.opacity = 0.8; p.emissive = 0; p.aux = 0;
    ps.spawn(pos, _v.copy(_w).multiplyScalar((col ? 35 + rnd() * 40 : 14 + rnd() * 20) * scale).addScaledVector(vel, 0.05));
  }
  const s = smoke.p;
  for (let i = 0, n = Math.round(20 * qq); i < n; i++) {
    const a = rnd() * Math.PI * 2;
    s.kind = KIND.VAPOR; s.life = 8 + rnd() * 6; s.size0 = 8 * scale; s.size1 = (25 + rnd() * 15) * scale; s.drag = 1.5; s.buoy = 0.5;
    s.delay = 0.3 + rnd() * 0.8; s.r = 0.93; s.g = 0.95; s.b = 0.98; s.opacity = 0.45; s.emissive = 0; s.aux = 0;
    smoke.spawn(_p.set(pos.x + Math.cos(a) * 6 * scale, pos.y + 2, pos.z + Math.sin(a) * 6 * scale), _v.set(Math.cos(a) * 5, 1 + rnd() * 2, Math.sin(a) * 5));
  }
}
