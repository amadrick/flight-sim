// WEAPONS + DAMAGE — placeholder implementation written by the integrator so the rest of combat runs.
// The weapons agent replaces the internals; the API below (documented in COMBAT.md §6) must be kept.
import * as THREE from 'three';
import { clamp, toBody, G0 } from '../util.js';

export const SPECS = {
  gun: { name: 'M61A1 20 mm', rof: 100, muzzleVelocity: 1030, range: 1800, damage: 9, dispersion: 0.003, tracerEvery: 5, life: 2.2 },
  missiles: {
    ir: { name: 'IR missile', short: 'HEAT', seeker: 'ir', rMin: 400, rMax: 9000, fov: 30, lockTime: 1.2, speed: 850, maxG: 30, life: 16, damage: 120, fuze: 9 },
    radar: { name: 'Radar missile', short: 'RDR', seeker: 'radar', rMin: 1500, rMax: 28000, fov: 45, lockTime: 2.2, speed: 1100, maxG: 22, life: 40, damage: 150, fuze: 12 },
  },
};
const DEFAULT_LOADOUT = { gun: 510, ir: 4, radar: 2, flares: 30 };

export function createWeapons(combat) {
  const world = combat.world, ev = combat.events, ctx = combat.ctx;
  const bullets = { n: 0, items: [] }, missiles = [], flares = [];
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), seg = new THREE.Vector3();
  const rng = combat.rng;

  function equip(e, loadout) {
    const L = { ...DEFAULT_LOADOUT, ...(loadout || {}) };
    e.maxHp = e.hp = L.hp ?? 100;
    e.loadout = { gun: { rounds: L.gun, firing: false, acc: 0, heat: 0 }, missiles: { ir: L.ir, radar: L.radar }, flares: L.flares, selected: L.ir > 0 ? 'ir' : 'radar' };
    e.lock = { target: null, state: 'none', progress: 0, seeker: e.loadout.selected, inRange: false, range: 0, rMin: 0, rMax: 0 };
    e.trigger = false; e.damage = { smoke: 0, fire: 0 };
  }
  function setTrigger(e, on) { if (e.loadout) e.trigger = !!on; }
  function cycleWeapon(e) {
    if (!e.loadout) return;
    e.loadout.selected = e.loadout.selected === 'ir' ? 'radar' : 'ir';
    e.lock.progress = 0; e.lock.state = 'none';
    ev.emit('weapon:select', { entity: e, selected: e.loadout.selected });
  }
  function newBullet() {
    if (bullets.n < bullets.items.length) return bullets.items[bullets.n++];
    const b = { position: new THREE.Vector3(), velocity: new THREE.Vector3(), prev: new THREE.Vector3(), age: 0, team: '', tracer: false, owner: null };
    bullets.items.push(b); bullets.n++; return b;
  }
  function muzzle(e, out) { return out.copy(e.forward).multiplyScalar((e.def?.geometry?.length || 15) * 0.4).add(e.state.position); }
  function fireGun(e, dt) {
    const g = e.loadout.gun, S = SPECS.gun;
    const firing = e.trigger && g.rounds > 0 && e.alive;
    if (firing !== g.firing) { g.firing = firing; ev.emit(firing ? 'gun:start' : 'gun:stop', { shooter: e }); }
    if (!firing) { g.acc = 0; return; }
    g.acc += dt * S.rof;
    while (g.acc >= 1 && g.rounds > 0) {
      g.acc -= 1; g.rounds--;
      const b = newBullet();
      muzzle(e, b.position); b.prev.copy(b.position);
      b.velocity.copy(e.forward).addScaledVector(e.up, (rng() - 0.5) * 2 * S.dispersion).addScaledVector(e.right, (rng() - 0.5) * 2 * S.dispersion)
        .normalize().multiplyScalar(S.muzzleVelocity).add(e.state.velocity);
      b.age = 0; b.team = e.team; b.owner = e; b.tracer = g.rounds % S.tracerEvery === 0;
      if (e.stats) e.stats.shots = (e.stats.shots || 0) + 1;
    }
  }
  function applyDamage(target, amount, info = {}) {
    if (!target || !target.alive || target.hp == null || target.invulnerable) return;
    if (target.isPlayer) amount *= combat.difficulty === 'rookie' ? 0.5 : combat.difficulty === 'ace' ? 1.25 : 0.85;
    target.hp -= amount; target.lastHitBy = info.source || null; target.lastHitWeapon = info.weapon || 'gun';
    const f = clamp(1 - target.hp / target.maxHp, 0, 1);
    if (target.damage) { target.damage.smoke = f > 0.35 ? f : 0; target.damage.fire = f > 0.7 ? f : 0; }
    if (target.sim?.damage) { const d = target.sim.damage; d.thrust = 1 - 0.5 * f; d.ctrl = 1 - 0.45 * f; d.drag = 0.02 * f; }
    ev.emit('damage', { target, amount, source: info.source || null, weapon: info.weapon || 'gun', position: info.position || target.state.position, hp: target.hp });
    if (target.hp <= 0) combat.kill(target, info.source || null, info.weapon || 'gun');
  }
  function stepBullets(dt) {
    const S = SPECS.gun;
    for (let i = bullets.n - 1; i >= 0; i--) {
      const b = bullets.items[i];
      b.prev.copy(b.position); b.velocity.y -= G0 * dt; b.position.addScaledVector(b.velocity, dt); b.age += dt;
      let dead = b.age > S.life || b.position.y < ctx.world.groundHeightAt(b.position.x, b.position.z);
      if (!dead) {
        seg.copy(b.position).sub(b.prev); const L2 = seg.lengthSq() || 1e-9;
        for (const t of world.aircraft) {
          if (t.team === b.team || t === b.owner) continue;
          const u = clamp(v1.copy(t.state.position).sub(b.prev).dot(seg) / L2, 0, 1);
          v2.copy(b.prev).addScaledVector(seg, u);
          if (v2.distanceToSquared(t.state.position) < t.radius * t.radius * 0.6) {
            ev.emit('bullet:hit', { shooter: b.owner, target: t, position: v2.clone() });
            if (b.owner?.stats) b.owner.stats.hits = (b.owner.stats.hits || 0) + 1;
            applyDamage(t, S.damage, { source: b.owner, weapon: 'gun', position: v2 });
            dead = true; break;
          }
        }
      }
      if (dead) { const last = bullets.items[--bullets.n]; bullets.items[bullets.n] = b; bullets.items[i] = last; }
    }
  }
  function updateLock(e, dt) {
    const L = e.lock, t = e.target, S = SPECS.missiles[e.loadout.selected];
    L.seeker = e.loadout.selected; L.rMin = S.rMin; L.rMax = S.rMax; L.target = t;
    if (!t || !t.alive) { L.state = 'none'; L.progress = 0; L.inRange = false; return; }
    toBody(e.state, t.state.position, v1);
    L.range = v1.length();
    const off = Math.atan2(Math.hypot(v1.x, v1.y), -v1.z) * 180 / Math.PI;
    L.inRange = L.range > S.rMin && L.range < S.rMax;
    const ok = L.inRange && off < S.fov && e.loadout.missiles[e.loadout.selected] > 0;
    const was = L.state;
    L.progress = clamp(L.progress + (ok ? dt / S.lockTime : -dt * 2), 0, 1);
    L.state = L.progress >= 1 ? 'locked' : L.progress > 0 ? 'acquiring' : 'none';
    if (L.state !== was) {
      ev.emit('lock:' + L.state, { shooter: e, target: t, seeker: L.seeker });
      if (L.state === 'locked' && L.seeker === 'radar') ev.emit('rwr:lock', { source: e, target: t });
    }
  }
  function launchMissile(e, type) {
    type = type || e.loadout?.selected;
    const S = SPECS.missiles[type]; if (!S || !e.alive || !(e.loadout.missiles[type] > 0)) return null;
    const t = e.lock.state === 'locked' ? e.target : null;
    if (!t) return null;
    e.loadout.missiles[type]--;
    const m = world.create({ kind: 'missile', team: e.team, owner: e, target: t, spec: S, type, radius: 1, age: 0, name: S.name });
    m.state.position.copy(e.state.position).addScaledVector(e.up, -1.5);
    m.state.velocity.copy(e.state.velocity).addScaledVector(e.forward, 30);
    m.state.quaternion.copy(e.state.quaternion);
    missiles.push(m); world.add(m);
    if (e.stats) e.stats.missiles = (e.stats.missiles || 0) + 1;
    ev.emit('missile:launch', { shooter: e, missile: m, target: t, type });
    ev.emit('rwr:launch', { source: e, target: t, missile: m });
    return m;
  }
  function dropFlares(e) {
    if (!e.loadout || e.loadout.flares <= 0 || !e.alive) return false;
    e.loadout.flares--;
    const f = world.create({ kind: 'flare', team: e.team, owner: e, radius: 1, age: 0, life: 4.5 });
    f.state.position.copy(e.state.position).addScaledVector(e.up, -2);
    f.state.velocity.copy(e.state.velocity).multiplyScalar(0.92).addScaledVector(e.up, -18).addScaledVector(e.right, (rng() - 0.5) * 20);
    flares.push(f); world.add(f);
    ev.emit('flare', { entity: e, flare: f });
    return true;
  }
  function stepMissiles(dt) {
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i], S = m.spec, s = m.state;
      m.age += dt;
      // IR seekers may be pulled onto a flare near the line of sight
      if (S.seeker === 'ir' && m.target?.alive && m.target.kind !== 'flare') {
        for (const f of flares) if (f.owner === m.target && !f.tested) { f.tested = true; if (rng() < 0.35) { m.target = f; ev.emit('missile:decoyed', { missile: m, flare: f }); } }
      }
      const t = m.target;
      const spd = Math.min(S.speed, s.velocity.length() + 220 * dt);
      if (t && t.alive) {
        // lead pursuit toward the predicted intercept point, turn-rate limited
        const d = v1.copy(t.state.position).sub(s.position), r = d.length();
        const tgo = r / Math.max(spd, 1);
        v2.copy(t.state.position).addScaledVector(t.state.velocity, tgo * 0.9).sub(s.position).normalize();
        v3.copy(s.velocity).normalize();
        const maxTurn = (S.maxG * G0 / Math.max(spd, 100)) * dt;
        const ang = Math.acos(clamp(v3.dot(v2), -1, 1));
        if (ang > 1e-4) v3.lerp(v2, Math.min(1, maxTurn / ang)).normalize();
        s.velocity.copy(v3).multiplyScalar(spd);
        if (r < S.fuze + t.radius * 0.5) {
          ev.emit('missile:hit', { missile: m, target: t, position: s.position.clone() });
          if (t.kind === 'aircraft') applyDamage(t, S.damage, { source: m.owner, weapon: 'missile', position: s.position });
          else world.remove(t);
          killMissile(m, i, null); continue;
        }
        if (ang > 1.4 && m.age > 2) m.target = null;        // overshot: the seeker loses the target
      } else s.velocity.setLength(spd).y -= G0 * dt * 0.3;
      s.position.addScaledVector(s.velocity, dt);
      v3.copy(s.velocity).normalize(); s.quaternion.setFromUnitVectors(v2.set(0, 0, -1), v3);
      if (m.age > S.life || s.position.y < ctx.world.groundHeightAt(s.position.x, s.position.z)) killMissile(m, i, m.age > S.life ? 'timeout' : 'ground');
    }
    for (let i = flares.length - 1; i >= 0; i--) {
      const f = flares[i]; f.age += dt;
      f.state.velocity.multiplyScalar(Math.exp(-0.9 * dt)).y -= G0 * dt * 0.6; f.state.position.addScaledVector(f.state.velocity, dt);
      if (f.age > f.life) { flares.splice(i, 1); world.remove(f); }
    }
  }
  function killMissile(m, i, reason) {
    missiles.splice(i, 1); world.remove(m);
    if (reason) ev.emit('missile:miss', { missile: m, reason, position: m.state.position.clone() });
  }
  /** Lead-computed aim point for a gun shot at `target` (world). out: { point, tof, inRange } */
  function gunSolution(shooter, target, out = {}) {
    const S = SPECS.gun;
    out.point = out.point || new THREE.Vector3();
    const r = v1.copy(target.state.position).sub(shooter.state.position).length();
    let tof = r / S.muzzleVelocity;
    for (let k = 0; k < 2; k++) {
      out.point.copy(target.state.position).addScaledVector(target.state.velocity, tof).addScaledVector(shooter.state.velocity, -tof);
      out.point.y += 0.5 * G0 * tof * tof;
      tof = out.point.distanceTo(shooter.state.position) / S.muzzleVelocity;
    }
    out.tof = tof; out.range = r; out.inRange = r < S.range;
    return out;
  }
  ev.on('cmd', ({ name } = {}) => {
    const p = world.player; if (!p || !p.alive || !p.loadout) return;
    if (name === 'missile') { if (!launchMissile(p)) ev.emit('weapon:nolock', { entity: p }); }
    else if (name === 'flare') dropFlares(p);
    else if (name === 'weaponNext') cycleWeapon(p);
  });
  return {
    specs: SPECS, bullets, missiles, flares,
    equip, setTrigger, launchMissile, dropFlares, cycleWeapon, applyDamage, gunSolution,
    lockState(e) { return e.lock; },
    update(dt) {
      const p = world.player;
      if (p && p.alive && combat.input && !p.pilot) setTrigger(p, combat.input.trigger);
      for (const e of world.aircraft) if (e.loadout) { fireGun(e, dt); updateLock(e, dt); }
      stepBullets(dt); stepMissiles(dt);
    },
    reset() { bullets.n = 0; missiles.length = 0; flares.length = 0; },
  };
}
