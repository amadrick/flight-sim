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
  acc.v += rate * dt * Math.max(0.5, q);
  const p = ps.p;
  while (acc.v >= 1) {
    acc.v -= 1;
    const f = rnd();
    p.kind = KIND.SMOKE; p.life = 1.0 + rnd() * 1.2; p.size0 = 0.4 * big; p.size1 = (2.2 + rnd() * 1.6) * big; p.drag = 2.4; p.buoy = 0.3;
    p.delay = 0; const c = 0.6 + rnd() * 0.15; p.r = c; p.g = c; p.b = c * 1.02; p.opacity = 0.2 * Math.min(1.3, big);
    p.emissive = 0; p.aux = 0;
    // spread along the path flown this frame so a 250 m/s shooter leaves a continuous stream, not beads
    _p.copy(pos).addScaledVector(vel, -dt * f);
    _v.copy(vel).multiplyScalar(0.9); _v.x += sgn() * 2.5; _v.y += sgn() * 2.5; _v.z += sgn() * 2.5;
    ps.spawn(_p, _v);
  }
}

/** Flame licks (fire particles) streaming behind a burning aircraft. */
export function fireLicks(ps, pos, vel, back, rate, dt, q, acc, size) {
  acc.v += rate * dt * Math.max(0.5, q);
  const p = ps.p;
  while (acc.v >= 1) {
    acc.v -= 1;
    const f = rnd();
    p.kind = KIND.FIRE; p.life = 0.3 + rnd() * 0.4; p.size0 = size * (0.4 + rnd() * 0.3); p.size1 = size * (1.3 + rnd() * 1.2); p.drag = 1.2; p.buoy = 2;
    p.delay = 0; p.r = 0.08; p.g = 0.07; p.b = 0.06; p.opacity = 0.8; p.emissive = 5 + rnd() * 7; p.aux = 0;
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
  flash(ps, pos, Z, 6 * big, 400 * big, 1, 0.95, 0.85, 0.1);
  flash(ps, pos, Z, 14 * big, 14 * big, 1, 0.7, 0.4, 0.3);
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
export function airFireball(ps, smoke, pos, vel, scale, q, withVolume, dur = 1) {
  const qq = Math.max(0.5, q);
  const p = ps.p;
  // 1. flash: a brief white-hot point (blooms) and a short orange glow — small, so it does not wash the frame
  _z.copy(vel).multiplyScalar(0.35);
  flash(ps, pos, _z, 9 * scale, 350, 1, 0.95, 0.85, 0.12);
  flash(ps, pos, _z, 11 * scale, 5, 1, 0.6, 0.3, 0.3);
  // 2. white-hot core: few, short-lived, very hot (fxFlame → white-yellow), cools to orange within ~0.2 s
  for (let i = 0, n = Math.round(10 * qq); i < n; i++) {
    randDir(_w, 0.1);
    p.kind = KIND.FIRE; p.life = 0.2 + rnd() * 0.12; p.size0 = 2.5 * scale; p.size1 = (7 + rnd() * 4) * scale;
    p.drag = 3; p.buoy = 2; p.delay = rnd() * 0.03; p.r = 0.2; p.g = 0.18; p.b = 0.16; p.opacity = 0.9; p.emissive = 140 + rnd() * 80; p.aux = 0;
    ps.spawn(_p.copy(pos).addScaledVector(_w, rnd() * 2 * scale), _v.copy(_w).multiplyScalar((4 + rnd() * 8) * scale).addScaledVector(vel, 0.35));
  }
  // 3. fireball: burst outward fast then stall (drag), varied sizes, rolling orange/red that turns into soot
  // many overlapping, moderately hot puffs (orange, not white) so the ball reads as one rolling mass
  const nf = Math.round((withVolume ? 36 : 48) * qq);
  for (let i = 0; i < nf; i++) {
    randDir(_w, 0.1);
    const big = rnd(), sp = rnd();
    p.kind = KIND.FIRE; p.life = (0.75 + rnd() * 0.75) * dur; p.size0 = (1.5 + rnd() * 1.5) * scale; p.size1 = (5 + big * 6) * scale;
    p.drag = 2.8 + rnd(); p.buoy = 3 + rnd() * 3; p.delay = i > nf * 0.7 ? (0.05 + rnd() * 0.18) * dur * dur : rnd() * 0.04;
    p.r = 0.07; p.g = 0.065; p.b = 0.06; p.opacity = 0.97; p.emissive = 22 + rnd() * 18; p.aux = 0;
    _v.copy(_w).multiplyScalar((8 + sp * sp * 30) * scale).addScaledVector(vel, 0.3 + rnd() * 0.15);
    ps.spawn(_p.copy(pos).addScaledVector(_w, rnd() * 2.5 * scale), _v);
  }
  // 4. sparks / burning fragments: fast bright streaks with short trails, and slower falling embers
  const pp = ps.p;
  for (let i = 0, n = Math.round(34 * qq); i < n; i++) {
    randDir(_w, 0.1);
    pp.kind = KIND.SPARK; pp.life = 0.35 + rnd() * 0.5; pp.size0 = pp.size1 = 0.22 + rnd() * 0.14; pp.drag = 1.2 + rnd() * 0.8; pp.buoy = -9.8;
    pp.delay = rnd() * 0.05; pp.r = 1; pp.g = 0.5 + rnd() * 0.15; pp.b = 0.12 + rnd() * 0.08; pp.opacity = 1; pp.emissive = 220 + rnd() * 180; pp.aux = 0.06;
    ps.spawn(pos, _v.copy(_w).multiplyScalar(35 + rnd() * 45).addScaledVector(vel, 0.4));
  }
  for (let i = 0, n = Math.round(22 * qq); i < n; i++) {
    randDir(_w, 0.3);
    pp.kind = KIND.SPARK; pp.life = 1.5 + rnd() * 1.6; pp.size0 = pp.size1 = 0.12 + rnd() * 0.1; pp.drag = 0.4; pp.buoy = -9.8;
    pp.delay = rnd() * 0.15; pp.r = 1; pp.g = 0.5 + rnd() * 0.2; pp.b = 0.15; pp.opacity = 1; pp.emissive = 25 + rnd() * 25; pp.aux = 0.03;
    ps.spawn(pos, _v.copy(_w).multiplyScalar(15 + rnd() * 30).addScaledVector(vel, 0.45));
  }
  // 5. lingering smoke: dark grey (soot), appears as the fire dies, grows and drifts with the wind for ~half a minute
  const s = smoke.p;
  for (let i = 0, n = Math.round(22 * qq); i < n; i++) {
    randDir(_w, 0.2);
    s.kind = KIND.SMOKE; s.life = 18 + rnd() * 14; s.size0 = 4 * scale; s.size1 = (14 + rnd() * 14) * scale; s.drag = 1.6; s.buoy = 1.2 + rnd() * 1.8;
    s.delay = 0.15 + rnd() * 0.6; const c = 0.06 + rnd() * 0.07; s.r = c; s.g = c; s.b = c * 1.03; s.opacity = 0.8; s.emissive = 0; s.aux = 0;
    smoke.spawn(_p.copy(pos).addScaledVector(_w, 4 * scale).addScaledVector(vel, 0.15), _v.copy(_w).multiplyScalar((5 + rnd() * 9) * scale).addScaledVector(vel, 0.25));
  }
}

/** Crash on land: a thick dark smoke column that climbs and leans with the wind for most of a minute. */
export function sootColumn(smoke, pos, scale, q) {
  const s = smoke.p;
  for (let i = 0, n = Math.round(16 * Math.max(0.5, q)); i < n; i++) {
    randDir(_w, 0.4); _w.y = Math.abs(_w.y) * 0.3;
    s.kind = KIND.SMOKE; s.life = 28 + rnd() * 20; s.size0 = 14 * scale; s.size1 = (22 + rnd() * 18) * scale; s.drag = 0.8; s.buoy = 3 + rnd() * 4;
    s.delay = 0.3 + i * 0.12 + rnd() * 0.2; const c = 0.05 + rnd() * 0.06; s.r = c; s.g = c; s.b = c * 1.03; s.opacity = 0.85; s.emissive = 0; s.aux = 0;
    smoke.spawn(_p.copy(pos).addScaledVector(_w, 5 * scale), _v.set(_w.x * 4, 6 + rnd() * 8, _w.z * 4));
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
