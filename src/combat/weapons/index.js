// WEAPONS + DAMAGE — guns, missiles and their seekers, flares, hit detection, damage model, per-aircraft loadouts.
// API (COMBAT.md §6, extended — see README.md in this directory):
//   specs, bullets { n, items }, missiles[], flares[], equip, setTrigger, launchMissile, dropFlares, cycleWeapon,
//   applyDamage, lockState, gunSolution, gunTrajectory, threatsTo, update, reset
// Pure logic (no DOM / WebGL); runs in node benches. Zero allocations per bullet per frame.
import * as THREE from 'three';
import { GUNS, MISSILES, FLARE, RADAR, PLAYER_WARNING, baseLoadout, gunPort, rcsOf } from './specs.js';
import { G, gunK, stepRound, rhoAt, solveGun, gunTrajectory as trajectory } from './ballistics.js';
import { buildShape, hitShape, segOriginDist2, segPoint } from './hitshape.js';
import { createKin, stepKin, pnCommand, pnInfo, buildTable, launchZone, irSignature, flareIntensity, notchFactor, burnTime } from './missile.js';
import { createDamageModel, createDamageState } from './damage.js';

export { GUNS, MISSILES, FLARE, LOADOUTS, DAMAGE_TAKEN, PLAYER_WARNING } from './specs.js';
export { gunK, solveGun, rhoAt } from './ballistics.js';

const DEG = Math.PI / 180;
/** Weapon data (COMBAT.md §6): specs.gun is the default gun (20 mm); per-aircraft guns are in specs.guns and loadout.gun.spec. */
export const SPECS = { gun: GUNS.m61, guns: GUNS, missiles: MISSILES, flare: FLARE, radar: RADAR };

const ACC_TAU = 0.3;
const BULLET_POOL = 2048, NEAR_MISS = 14, NEAR_THROTTLE = 0.35, GROUND_THROTTLE = 0.07;
const FWD = new THREE.Vector3(0, 0, -1);
/** Gameplay tuning for the late hard-turn evasion roll (see evadeRoll). */
export const EVADE = { g: 6, window: 2.5, base: { ir: 0.3, radar: 0.4 }, slowBonus: 0.45, fast: 750, slow: 400 };

function threatSlot(out, pool, i) {
  let o = pool[i];
  if (!o) o = pool[i] = { type: '', seeker: '', source: null, missile: null, range: 0 };
  out[i] = o;
  return o;
}

export function createWeapons(combat) {
  const world = combat.world, ev = combat.events, ctx = combat.ctx;
  const rng = combat.rng;
  const bullets = { n: 0, items: [] }, missiles = [], flares = [];
  const dm = createDamageModel(combat);
  const tables = {};
  const table = (type) => tables[type] || (tables[type] = buildTable(MISSILES[type]));
  const targets = [];
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
  const r0 = new THREE.Vector3(), r1 = new THREE.Vector3(), b0 = new THREE.Vector3(), b1 = new THREE.Vector3();
  const aCmd = new THREE.Vector3(), aim = new THREE.Vector3(), aimV = new THREE.Vector3();
  const hit = { t: 0, part: '', index: -1, point: new THREE.Vector3() };
  const zone = { rMax: 0, rNe: 0, tti: 0 }, zg = { alt: 0, climb: 0, vLaunch: 0, vAway: 0, vTarget: 0, range: 0 };
  const sol = { point: new THREE.Vector3(), dir: new THREE.Vector3(), tof: 0, range: 0, inRange: false };

  for (let i = 0; i < BULLET_POOL; i++) bullets.items.push(newBullet());
  function newBullet() {
    return { position: new THREE.Vector3(), velocity: new THREE.Vector3(), prev: new THREE.Vector3(), age: 0, life: 2, team: '', tracer: false,
      owner: null, k0: 0, damage: 0, gun: '' };
  }
  function allocBullet() {
    if (bullets.n >= bullets.items.length) bullets.items.push(newBullet());
    return bullets.items[bullets.n++];
  }

  // ---- equip / loadout -----------------------------------------------------------------------------------------------
  /**
   * Arm an entity (core calls it on spawn). o: mission overrides merged over the aircraft's table entry —
   * { gun (rounds), gunType ('m61'|'gau22'|'gau8'|null), ir, radar, flares, hp, invulnerable }.
   */
  function equip(e, o) {
    o = o || {};
    const base = e.kind === 'aircraft' || e.def ? baseLoadout(e.def) : { gun: null, rounds: 0, ir: 0, radar: 0, flares: 0, hp: e.hp ?? 100 };
    const gunType = o.gunType !== undefined ? o.gunType : base.gun;
    const gspec = gunType ? GUNS[gunType] || null : null;
    const rounds = gspec ? (typeof o.gun === 'number' ? o.gun : o.rounds ?? base.rounds) : 0;
    const ir = o.ir ?? base.ir, radar = o.radar ?? base.radar, nfl = o.flares ?? base.flares;
    e.maxHp = e.hp = o.hp ?? base.hp;
    e.invulnerable = !!o.invulnerable;
    e.loadout = {
      gun: { type: gunType || null, name: gspec ? gspec.name : '', spec: gspec, rounds, max: rounds, firing: false, spin: 0, heat: 0, acc: 0, count: 0 },
      missiles: { ir, radar }, missilesMax: { ir, radar }, flares: nfl, flaresMax: nfl,
      selected: ir > 0 ? 'ir' : radar > 0 ? 'radar' : 'ir',
    };
    e.lock = { target: null, state: 'none', progress: 0, seeker: e.loadout.selected, inRange: false, range: 0, rMin: 0, rMax: 0, rNe: 0, tti: 0,
      closure: 0, aspect: 0, offBoresight: 0, heldT: 0 };
    e.trigger = false;
    const nEng = e.state?.engines?.length || e.def?.geometry?.engines?.length || 0;
    e.damage = createDamageState(nEng);
    e.lastHitBy = null; e.lastHitWeapon = null;
    const w = dm.scratch(e);
    w.shape = buildShape(e.def, e.radius || 5);
    w.port = gunPort(e.def); w.gun = gspec;
    w.flareT = -1; w.launchT = -1; w.rail = 0; w.nearT = -1; w.groundT = -1; w.spawnT = combat.clock || 0;
    w.qi = new THREE.Quaternion(); w.pp = new THREE.Vector3();
    if (w.accS) w.accInit = false;
    w.ledger.length = 0;
    w.hpSeen = e.hp;
    dm.reset(e);
    if (e.sim?.damage) { e.sim.damage.engineOut = e.sim.damage.engineOut || []; for (let i = 0; i < nEng; i++) e.sim.damage.engineOut[i] = false; }
    return e.loadout;
  }

  function setTrigger(e, on) { if (e.loadout) e.trigger = !!on; }

  function cycleWeapon(e) {
    const lo = e.loadout; if (!lo) return;
    const next = lo.selected === 'ir' ? 'radar' : 'ir';
    if (lo.missiles[next] > 0 || !(lo.missiles[lo.selected] > 0)) lo.selected = next;
    e.lock.progress = 0;
    if (e.lock.state !== 'none') { e.lock.state = 'none'; ev.emit('lock:none', { shooter: e, target: e.lock.target, seeker: e.lock.seeker }); }
    e.lock.seeker = lo.selected;
    ev.emit('weapon:select', { entity: e, selected: lo.selected });
  }

  // ---- gun ------------------------------------------------------------------------------------------------------------
  function gauss() { let u = rng(); if (u < 1e-9) u = 1e-9; return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }

  /** Mission scripts may write counts / hp directly: keep maxima and derived state consistent. */
  function sanitize(e) {
    const lo = e.loadout, g = lo.gun, M = lo.missiles, MM = lo.missilesMax;
    if (!(g.rounds >= 0)) g.rounds = 0; if (g.rounds > g.max) g.max = g.rounds;
    if (!(M.ir >= 0)) M.ir = 0; if (M.ir > (MM.ir || 0)) MM.ir = M.ir;
    if (!(M.radar >= 0)) M.radar = 0; if (M.radar > (MM.radar || 0)) MM.radar = M.radar;
    if (!(lo.flares >= 0)) lo.flares = 0; if (lo.flares > (lo.flaresMax || 0)) lo.flaresMax = lo.flares;
    const w = e.wpn;
    if (w && w.hpSeen !== e.hp) { dm.refresh(e); w.hpSeen = e.hp; }
  }

  function fireGun(e, dt) {
    const g = e.loadout.gun, S = g.spec;
    if (!S) return;
    const want = e.trigger && g.rounds > 0 && e.alive;
    g.spin = want ? Math.min(1, g.spin + dt / S.spinUp) : Math.max(0, g.spin - dt / (S.spinUp * 2));
    if (want !== g.firing) { g.firing = want; ev.emit(want ? 'gun:start' : 'gun:stop', { shooter: e }); }
    if (!want) { g.acc = 0; g.heat = Math.max(0, g.heat - dt * 0.2); return; }
    g.heat = Math.min(1, g.heat + dt / 4);
    const rate = S.rof * (0.3 + 0.7 * g.spin);
    g.acc += dt * rate;
    const w = e.wpn, s = e.state;
    const k0 = gunK(S, 1.225);
    while (g.acc >= 1 && g.rounds > 0) {
      g.acc -= 1; g.rounds--; g.count++;
      const ahead = g.acc / rate;                       // this round left the muzzle `ahead` s ago (even spacing)
      const b = allocBullet();
      b.position.set(w.port[0], w.port[1], w.port[2]).applyQuaternion(s.quaternion).add(s.position);
      const sx = gauss() * S.dispersion, sy = gauss() * S.dispersion;
      b.velocity.copy(e.forward).addScaledVector(e.right, sx).addScaledVector(e.up, sy).normalize().multiplyScalar(S.muzzleVelocity).add(s.velocity);
      b.position.addScaledVector(b.velocity, ahead);
      b.prev.copy(b.position);
      b.age = ahead; b.life = S.life; b.team = e.team; b.owner = e; b.k0 = k0; b.damage = S.damage; b.gun = S.id;
      b.tracer = g.count % S.tracerEvery === 0;
      if (e.stats) e.stats.shots = (e.stats.shots || 0) + 1;
    }
  }

  function refreshTargets(dt) {
    targets.length = 0;
    const E = world.entities;
    for (let i = 0; i < E.length; i++) {
      const t = E[i];
      if (!t.alive || t.hp == null) continue;
      if (t.kind !== 'aircraft' && t.kind !== 'ground') continue;
      const w = t.wpn || dm.scratch(t);
      if (!w.shape) w.shape = buildShape(t.kind === 'aircraft' ? t.def : null, t.radius || 5);
      if (!w.qi) { w.qi = new THREE.Quaternion(); w.pp = new THREE.Vector3(); }
      const q = t.state.quaternion;
      if (q) w.qi.copy(q).invert(); else w.qi.identity();
      const vel = t.state.velocity;
      w.pp.copy(t.state.position); if (vel) w.pp.addScaledVector(vel, -dt);
      if (t.kind === 'aircraft') smoothAccel(t, dt);
      targets.push(t);
    }
  }

  function stepBullets(dt) {
    const clock = combat.clock;
    for (let i = bullets.n - 1; i >= 0; i--) {
      const b = bullets.items[i];
      b.prev.copy(b.position);
      const rho = rhoAt(b.position.y);
      stepRound(b.position, b.velocity, b.k0 * rho / 1.225, dt);
      b.age += dt;
      let dead = b.age > b.life;
      if (!dead && b.position.y < 9000) {
        const gh = ctx.world.groundHeightAt(b.position.x, b.position.z);
        if (b.position.y <= gh) {
          dead = true;
          const ow = b.owner?.wpn;
          if (!ow || clock - ow.groundT > GROUND_THROTTLE) {
            if (ow) ow.groundT = clock;
            const h0 = b.prev.y - gh, h1 = b.position.y - gh;
            const f = h0 > h1 ? Math.min(1, Math.max(0, h0 / (h0 - h1))) : 1;
            const p = b.prev.clone().lerp(b.position, f); p.y = gh;
            ev.emit('bullet:ground', { position: p, shooter: b.owner, gun: b.gun });
          }
        }
      }
      if (!dead) {
        for (let j = 0; j < targets.length; j++) {
          const t = targets[j];
          if (t === b.owner || t.team === b.team || !t.alive) continue;
          const w = t.wpn, shape = w.shape;
          r0.copy(b.prev).sub(w.pp); r1.copy(b.position).sub(t.state.position);
          const d2 = segOriginDist2(r0, r1), R = shape.bound;
          if (d2 > (R + NEAR_MISS) * (R + NEAR_MISS)) continue;
          if (d2 <= R * R) {
            b0.copy(r0).applyQuaternion(w.qi); b1.copy(r1).applyQuaternion(w.qi);
            if (hitShape(shape, b0, b1, hit)) {
              const pos = b.prev.clone().lerp(b.position, hit.t);
              const sh = b.owner;
              if (sh?.stats) sh.stats.hits = (sh.stats.hits || 0) + 1;
              const amount = b.damage * (0.75 + 0.5 * rng());
              const removed = dm.apply(t, amount, { source: sh, weapon: 'gun', position: pos, part: hit.part, index: hit.index });
              ev.emit('bullet:hit', { shooter: sh, target: t, position: pos, part: hit.part, bodyPosition: hit.point.clone(), gun: b.gun,
                damage: removed, hp: t.hp, killed: !t.alive });
              dead = true; break;
            }
          }
          if (clock - w.nearT > NEAR_THROTTLE) {
            w.nearT = clock;
            const s = segPoint.s;
            const pos = b.prev.clone().lerp(b.position, s);
            ev.emit('bullet:near', { target: t, shooter: b.owner, position: pos, distance: Math.sqrt(d2) });
          }
        }
      }
      if (dead) { const last = bullets.items[--bullets.n]; bullets.items[bullets.n] = b; bullets.items[i] = last; }
    }
  }

  // ---- lock-on & launch zone ------------------------------------------------------------------------------------------
  function aglOf(t) { const s = t.state; return s.agl ?? (s.position.y - ctx.world.groundHeightAt(s.position.x, s.position.z)); }
  function sunBlind(dir) {
    const sd = ctx.env?.sunDir; if (!sd || sd.y < -0.05) return false;
    return dir.dot(sd) > Math.cos(4 * DEG);
  }
  /** Can `e`'s `type` seeker/radar see `t` right now? Sets lockInfo.range / off. Pure check, no lock time. */
  const lockInfo = { range: 0, off: 0, sig: 0 };
  function canSee(e, t, type) {
    const S = MISSILES[type], s = e.state;
    v1.copy(t.state.position).sub(s.position);
    const range = v1.length() || 1; v1.divideScalar(range);
    const off = Math.acos(Math.max(-1, Math.min(1, v1.dot(e.forward))));
    lockInfo.range = range; lockInfo.off = off;
    if (S.seeker === 'ir') {
      if (off > S.fov * DEG) return false;
      const sig = irSignature(t, s.position); lockInfo.sig = sig;
      if (range > S.detectRange * Math.sqrt(sig / 1.1)) return false;
      if (sunBlind(v1)) return false;
      return true;
    }
    if (off > RADAR.cone * DEG) return false;
    if (range > RADAR.range * Math.pow(rcsOf(t.def), 0.25)) return false;
    return notchFactor(s.position, t.state, aglOf(t)) < 0.6;
  }

  function setLockState(e, L, state) {
    if (L.state === state) return;
    if (state === 'acquiring' && L.state === 'none' && L.seeker === 'radar' && L.target) ev.emit('rwr:spike', { source: e, target: L.target });
    L.state = state;
    if (state !== 'locked') L.heldT = 0;
    ev.emit('lock:' + state, { shooter: e, target: L.target, seeker: L.seeker });
    if (state === 'locked' && L.seeker === 'radar') ev.emit('rwr:lock', { source: e, target: L.target });
  }

  function updateLock(e, dt) {
    const L = e.lock, lo = e.loadout, sel = lo.selected, S = MISSILES[sel];
    let t = e.target;
    if (t && (!t.alive || t.kind === 'missile' || t.kind === 'flare' || t.team === e.team)) t = null;
    if (L.target !== t) { L.progress = 0; if (L.state !== 'none') setLockState(e, L, 'none'); L.target = t; }
    L.seeker = sel;
    if (!(lo.missiles[sel] > 0)) {
      const other = sel === 'ir' ? 'radar' : 'ir';
      if (lo.missiles[other] > 0) { cycleWeapon(e); return; }
    }
    if (!t || !(lo.missiles[sel] > 0) || !e.alive) {
      L.progress = 0; L.inRange = false; L.rMin = L.rMax = L.rNe = L.tti = 0; L.range = t ? t.state.position.distanceTo(e.state.position) : 0;
      setLockState(e, L, 'none'); return;
    }
    const s = e.state, ts = t.state;
    const ok = canSee(e, t, sel);
    const range = lockInfo.range;
    // v1 = LOS unit (from canSee)
    const closure = s.velocity.dot(v1) - ts.velocity.dot(v1);
    zg.alt = 0.5 * (s.position.y + ts.position.y); zg.climb = ts.position.y - s.position.y;
    zg.vLaunch = Math.max(100, s.velocity.dot(v1)); zg.vAway = ts.velocity.dot(v1); zg.vTarget = ts.velocity.length(); zg.range = range;
    launchZone(table(sel), zg, zone);
    L.range = range; L.closure = closure; L.offBoresight = lockInfo.off;
    L.aspect = t.forward ? Math.acos(Math.max(-1, Math.min(1, t.forward.dot(v1)))) : 0;   // 0 = shooter astern of the target (tail-on), π = head-on (same as util.geometry)
    L.rMax = zone.rMax; L.rNe = zone.rNe; L.tti = zone.tti;
    L.rMin = S.armDist + Math.max(0, closure) * S.armTime + 150;
    L.inRange = range >= L.rMin && range <= L.rMax;
    L.progress = Math.max(0, Math.min(1, L.progress + (ok ? dt / S.lockTime : -dt * 1.5)));
    // the selected rail ran dry (or was emptied by a script) while the other type has rounds: switch
    let st = 'none';
    if (L.progress >= 1) st = 'locked';
    else if (L.progress > 0) st = !ok && L.state === 'locked' && L.progress >= 0.7 ? 'locked' : 'acquiring';   // brief drop-outs keep the lock
    setLockState(e, L, st);
    if (L.state === 'locked') L.heldT = (L.heldT || 0) + dt;
  }

  // ---- missiles -------------------------------------------------------------------------------------------------------
  /**
   * Fire a missile of `type` (default: selected) at the locked target. Requires a lock (entity.lock.state 'locked' on
   * the selected seeker); a different type than the selected one launches only if that seeker can see the target now.
   * Returns the missile entity or null (and emits 'weapon:nolock' when refused for want of a lock).
   */
  function launchMissile(e, type) {
    const lo = e?.loadout; if (!lo || !e.alive) return null;
    type = type || lo.selected;
    const S = MISSILES[type]; if (!S || !(lo.missiles[type] > 0)) return null;
    const w = e.wpn, L = e.lock, t = L.target;
    if (combat.clock - w.launchT < 0.6 && w.launchT >= 0) return null;
    const locked = t && t.alive && ((L.state === 'locked' && L.seeker === type) || (L.seeker !== type && canSee(e, t, type)));
    if (!locked) { ev.emit('weapon:nolock', { entity: e }); return null; }
    // fairness: a hostile shooter must have held its lock on the human player long enough for the warning to register
    if (t.isPlayer && !t.pilot && t.team !== e.team) {
      const pw = PLAYER_WARNING[combat.difficulty] || PLAYER_WARNING.veteran;
      if ((L.heldT || 0) < (S.seeker === 'radar' ? pw.radarHold : pw.irHold)) return null;
    }
    lo.missiles[type]--;
    w.launchT = combat.clock;
    const m = world.create({ kind: 'missile', team: e.team, owner: e, target: t, spec: S, type, seeker: S.seeker, radius: 1, age: 0, name: S.name,
      motor: false, motorPhase: null, speed: 0, mach: 0, g: 0, tgo: 0, active: S.seeker === 'ir', guiding: true, decoyed: false, lost: false,
      origTarget: t, missReason: null });
    const k = createKin();
    k.pos = m.state.position; k.vel = m.state.velocity;
    m.kin = k;
    // rail: IR on the wingtips (alternating), radar under the fuselage
    const g = e.def?.geometry, side = (w.rail++ % 2) ? 1 : -1;
    if (S.seeker === 'ir' && g?.wingtips) v1.set(side * Math.abs(g.wingtips[1][0]) * 0.92, g.wingtips[1][1] - 0.25, g.wingtips[1][2]);
    else v1.set(side * 0.7, -1.1, 0.8);
    v1.applyQuaternion(e.state.quaternion);
    k.pos.copy(e.state.position).add(v1);
    k.vel.copy(e.state.velocity);
    if (S.seeker === 'radar') k.vel.addScaledVector(e.up, -7);
    m.motorDelay = S.seeker === 'radar' ? 0.35 : 0.05;
    m.state.quaternion.copy(e.state.quaternion);
    m.launchPos = k.pos.clone();
    m.trk = new THREE.Vector3().copy(t.state.position).sub(k.pos).normalize();
    m.lk = { pos: t.state.position.clone(), vel: t.state.velocity.clone() };
    m.trackQ = 1; m.rejected = 0; m.lostT = 0; m.openT = 0; m.seen = new Set(); m.prevPos = k.pos.clone(); m.travel = 0;
    missiles.push(m); world.add(m);
    if (e.stats) e.stats.missiles = (e.stats.missiles || 0) + 1;
    ev.emit('missile:launch', { shooter: e, missile: m, target: t, type, seeker: S.seeker });
    ev.emit('rwr:launch', { source: e, target: t, missile: m, seeker: S.seeker });
    return m;
  }

  function loseTrack(m, reason) {
    if (m.lost) return;
    m.lost = true; m.guiding = false; m.missReason = m.missReason || reason;
    m.lostT = 0;
  }

  /** Seeker head slew limit: a line-of-sight rate above spec.trackRate (outside the last ~0.3 s) breaks the track. */
  function overRate(m, t, rT, dt) {
    v2.copy(t.state.velocity).sub(m.state.velocity);
    const vc = -v2.dot(v1);
    v2.addScaledVector(v1, -v2.dot(v1));
    const rate = v2.length() / rT;
    m.losRate = rate;
    if (vc > 0 && rT / vc < 0.3) return false;
    m.rateT = rate > m.spec.trackRate * DEG ? (m.rateT || 0) + dt : 0;
    return m.rateT > 0.12;
  }

  /**
   * Gameplay rule (not physics): a hard turn late in the missile's flight gives the target one roll to shake it.
   * Taken once per missile, the first time the target pulls past EVADE.g with the missile inside EVADE.window s.
   * The chance grows as the missile slows down. Tune it in EVADE.
   */
  function evadeRoll(m, t, rT) {
    if (m.evaded || !(t.state.gLoad > EVADE.g)) return false;
    const spd = m.state.velocity.length() || 1;
    if (rT / spd > EVADE.window) return false;
    m.evaded = true;
    const slow = Math.max(0, Math.min(1, (EVADE.fast - spd) / (EVADE.fast - EVADE.slow)));
    return rng() < EVADE.base[m.seeker] + EVADE.slowBonus * slow;
  }

  /** IR seeker: track the target, judge flares that enter the gate, sun capture. Sets aim/aimV; false if not tracking. */
  function seekIR(m, dt) {
    const S = m.spec, t = m.target, mp = m.state.position, mv = m.state.velocity;
    const spd = mv.length() || 1;
    if (t.kind === 'flare') {
      if (t.alive && t.age < t.life) { aim.copy(t.state.position); aimV.copy(t.state.velocity); return true; }
      // the flare burnt out: look for the original target near where the seeker points
      const o = m.origTarget;
      if (o && o.alive) {
        v1.copy(o.state.position).sub(mp); const r = v1.length(); v1.divideScalar(r);
        if (v1.dot(m.trk) > Math.cos(S.gate * 4 * DEG) && v1.dot(mv) / spd > Math.cos(S.gimbal * DEG) && r < S.detectRange * Math.sqrt(irSignature(o, mp) / 1.1)) {
          m.target = o; m.decoyed = false; m.missReason = null;
          ev.emit('missile:reacquired', { missile: m, target: o });
          aim.copy(o.state.position); aimV.copy(o.state.velocity); return true;
        }
      }
      loseTrack(m, 'decoyed'); return false;
    }
    if (!t.alive) { loseTrack(m, 'lost'); return false; }
    if (t.kind !== 'aircraft') { aim.copy(t.state.position); aimV.copy(t.state.velocity || v4.set(0, 0, 0)); return true; }
    v1.copy(t.state.position).sub(mp); const rT = v1.length() || 1; v1.divideScalar(rT);
    if (v1.dot(mv) / spd < Math.cos(S.gimbal * DEG)) { loseTrack(m, 'lost'); return false; }
    if (overRate(m, t, rT, dt) || evadeRoll(m, t, rT)) { loseTrack(m, 'lost'); return false; }
    const sigT = irSignature(t, mp);
    if (rT > S.detectRange * Math.sqrt(sigT / 1.1) * 1.35) { loseTrack(m, 'lost'); return false; }
    if (sunBlind(v1)) { m.decoyed = true; loseTrack(m, 'decoyed'); ev.emit('missile:decoyed', { missile: m, flare: null, sun: true, target: t }); return false; }
    m.trk.copy(v1);
    // flares in the gate: decide once per flare, when it resolves from the target (or after ~1.2 s together)
    const gate = S.gate * DEG, cosGate = Math.cos(gate), cosHalf = Math.cos(gate * 0.5);
    const wT = sigT / (rT * rT * 1e-6 + 0.01);
    for (let i = 0; i < flares.length; i++) {
      const f = flares[i];
      if (f.age < 0.03 || m.seen.has(f.id)) continue;
      v2.copy(f.state.position).sub(mp); const rF = v2.length() || 1; v2.divideScalar(rF);
      const c = v2.dot(v1);
      if (c < cosGate) { if (f.age > 0.3) m.seen.add(f.id); continue; }       // outside the gate: never competes
      if (c > cosHalf && f.age < 1.2) continue;                                  // not resolved yet
      m.seen.add(f.id);
      // counter-countermeasures: spectral (quality) + kinematic (the older the flare, the more it has slowed and dropped)
      const rej = Math.min(0.95, S.quality * (0.3 + Math.min(1, f.age / 1.2)));
      const wF = f.intensity * (1 - rej) / (rF * rF * 1e-6 + 0.01);
      const rho = wF / (wF + wT);
      // each flare already rejected makes the seeker's logic warier: timing beats spamming
      const p = rho * rho / (rho * rho + (1 - rho) * (1 - rho)) * Math.pow(0.7, m.rejected);
      if (rng() >= p) { m.rejected++; continue; }
      {
        m.target = f; m.decoyed = true; m.missReason = 'decoyed';
        ev.emit('missile:decoyed', { missile: m, flare: f, target: t });
        aim.copy(f.state.position); aimV.copy(f.state.velocity); return true;
      }
    }
    aim.copy(t.state.position); aimV.copy(t.state.velocity);
    return true;
  }

  /** Radar seeker: datalink midcourse (launcher must keep the target in its radar cone), then active terminal. */
  function seekRadar(m, dt) {
    const S = m.spec, t = m.target, mp = m.state.position, mv = m.state.velocity, o = m.owner;
    const spd = mv.length() || 1;
    if (!t.alive) { loseTrack(m, 'lost'); return false; }
    if (t.kind !== 'aircraft') { aim.copy(t.state.position); aimV.copy(t.state.velocity || v4.set(0, 0, 0)); return true; }
    if (!m.active) {
      const link = o && o.alive && o.lock && o.lock.target === t && o.lock.state !== 'none' && canSee(o, t, 'radar');
      if (link) { m.lk.pos.copy(t.state.position); m.lk.vel.copy(t.state.velocity); m.linkLost = false; }
      else { m.lk.pos.addScaledVector(m.lk.vel, dt); m.linkLost = true; }
      const rp = v2.copy(m.lk.pos).sub(mp).length();
      if (rp < S.activeRange) {
        v1.copy(t.state.position).sub(mp); const rT = v1.length() || 1; v1.divideScalar(rT); v2.divideScalar(rp || 1);
        const basket = Math.max(S.gate * DEG, Math.atan2(1500, rp));
        if (v1.dot(v2) > Math.cos(basket) && v1.dot(mv) / spd > Math.cos(S.gimbal * DEG) && rT < S.detectRange * Math.pow(rcsOf(t.def), 0.25)) {
          m.active = true; ev.emit('missile:active', { missile: m, target: t });
        } else { loseTrack(m, 'lost'); return false; }
      } else {
        aim.copy(m.lk.pos); aimV.copy(m.lk.vel);
        // loft: climb toward thinner air on long shots
        if (rp > 12000) aim.y += Math.min(0.14 * (rp - 12000), 5000);
        return true;
      }
    }
    v1.copy(t.state.position).sub(mp); const rT = v1.length() || 1; v1.divideScalar(rT);
    if (v1.dot(mv) / spd < Math.cos(S.gimbal * DEG)) { loseTrack(m, 'lost'); return false; }
    if (overRate(m, t, rT, dt) || evadeRoll(m, t, rT)) { loseTrack(m, 'lost'); return false; }
    const nf = notchFactor(mp, t.state, aglOf(t));
    m.trackQ = Math.min(1, m.trackQ + dt * (0.5 - nf * 3.2 * (1 - 0.5 * S.quality)));
    if (m.trackQ <= 0) { loseTrack(m, 'lost'); ev.emit('missile:notched', { missile: m, target: t }); return false; }
    aim.copy(t.state.position); aimV.copy(t.state.velocity);
    return true;
  }

  /** Warhead burst at pos: damage falls off linearly to spec.blast. Returns true if the intended target was hurt. */
  function blast(m, pos, direct) {
    const S = m.spec;
    let hurt = false;
    for (let j = 0; j < targets.length; j++) {
      const t = targets[j];
      if (!t.alive || t.team === m.team) continue;
      const shape = t.wpn.shape;
      const ext = shape.sphere ? shape.sphere * 0.7 : shape.rf * 1.2;
      const d = Math.max(0, t.state.position.distanceTo(pos) - ext);
      if (d > S.blast) continue;
      const f = 1 - d / S.blast;
      const dmg = S.damage * f * (0.85 + 0.3 * rng());
      if (t === direct || t === m.origTarget) {
        hurt = true;
        ev.emit('missile:hit', { missile: m, target: t, position: pos.clone(), distance: d });
        if (m.owner?.stats) m.owner.stats.missileHits = (m.owner.stats.missileHits || 0) + 1;
      }
      dm.apply(t, dmg, { source: m.owner, weapon: 'missile', position: pos, blast: true, distance: d, disintegrate: d < 1.5 && t.kind === 'aircraft' });
    }
    return hurt;
  }

  function endMissile(m, i, reason, detonated) {
    missiles.splice(i, 1); world.remove(m);
    if (reason) ev.emit('missile:miss', { missile: m, reason, position: m.state.position.clone(), detonated: !!detonated, target: m.origTarget });
  }

  function stepMissiles(dt) {
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i], S = m.spec, k = m.kin;
      m.age += dt;
      m.prevPos.copy(k.pos);
      let guiding = false;
      if (!m.lost && !m.target) loseTrack(m, 'lost');     // core clears .target when the target dies
      if (!m.lost && m.target) guiding = S.seeker === 'ir' ? seekIR(m, dt) : seekRadar(m, dt);
      if (guiding) pnCommand(k.pos, k.vel, aim, aimV, S.navGain, aCmd);
      else aCmd.set(0, 0, 0);
      stepKin(k, S, aCmd, dt, m.motorDelay);
      m.motor = k.thrust > 0;
      m.motorPhase = !m.motor ? null : (k.t - m.motorDelay) < S.motor.boost[1] ? 'boost' : 'sustain';
      m.speed = k.speed; m.mach = k.mach; m.g = k.g;
      m.tgo = guiding ? pnInfo.tgo : 0;
      m.travel += k.speed * dt;
      v3.copy(k.vel).divideScalar(k.speed || 1);
      m.state.quaternion.setFromUnitVectors(FWD, v3);
      // proximity fuze: closest approach to the tracked object over this step (both moved)
      const t = m.target;
      if (t && t.alive && m.age > S.armTime && m.travel > S.armDist) {
        const tp = t.state.position, tv = t.state.velocity;
        r0.copy(m.prevPos).sub(tp); if (tv) r0.addScaledVector(tv, dt);
        r1.copy(k.pos).sub(tp);
        const d2 = segOriginDist2(r0, r1), s = segPoint.s;
        const ext = t.kind === 'aircraft' ? (t.wpn?.shape?.rf || 1) * 1.2 : t.kind === 'flare' ? 0 : (t.radius || 3) * 0.7;
        const dEff = Math.max(0, Math.sqrt(d2) - ext);
        if (dEff < S.fuze && (s < 1 || dEff < S.fuze * 0.25)) {
          v4.copy(m.prevPos).lerp(k.pos, s);
          k.pos.copy(v4);
          if (t.kind === 'flare') { const hurt = blast(m, v4, null); endMissile(m, i, hurt ? null : 'decoyed', true); }
          else { blast(m, v4, t); endMissile(m, i, null, true); }
          continue;
        }
      }
      if (m.lost) { m.lostT += dt; if (m.lostT > 2.0) { endMissile(m, i, m.missReason || 'lost', true); continue; } }
      // out of energy: motor out and too slow, or the target is outrunning it
      if (!m.motor && m.age > m.motorDelay + 0.5) {
        const closing = guiding ? pnInfo.closure : 1;
        m.openT = closing < 0 ? m.openT + dt : 0;
        if (k.speed < 240 || m.openT > 1.5) { endMissile(m, i, m.missReason || 'energy', true); continue; }
      }
      if (k.pos.y < ctx.world.groundHeightAt(k.pos.x, k.pos.z)) { endMissile(m, i, m.missReason || 'ground', true); continue; }
      if (m.age > S.life) { endMissile(m, i, m.missReason || 'timeout', true); continue; }
    }
  }

  // ---- flares ---------------------------------------------------------------------------------------------------------
  /** Release a flare salvo (a pair; AI and scripts). Limited count, short cooldown. Returns true if any flare left. */
  function dropFlares(e, count = FLARE.salvo) {
    const lo = e?.loadout; if (!lo || !e.alive || !(lo.flares > 0)) return false;
    const w = e.wpn;
    if (w.flareT >= 0 && combat.clock - w.flareT < FLARE.cooldown) return false;
    w.flareT = combat.clock;
    const n = Math.min(Math.max(1, count | 0), lo.flares);
    const g = e.def?.geometry, zAft = g ? (g.tailZ ?? 5) * 0.6 : 3;
    for (let k = 0; k < n; k++) {
      lo.flares--;
      const side = n === 1 ? ((w.rail++ % 2) ? 1 : -1) : k % 2 ? 1 : -1;
      const f = world.create({ kind: 'flare', team: e.team, owner: e, radius: 1, age: 0, life: FLARE.life * (0.9 + 0.2 * rng()),
        eff: 0.75 + 0.5 * rng(), heat: 0, intensity: 0 });
      v1.set(side * 0.8, -1.0, zAft).applyQuaternion(e.state.quaternion);
      f.state.position.copy(e.state.position).add(v1);
      v1.set(side * (0.35 + 0.3 * rng()), -1, 0.15).normalize().multiplyScalar(FLARE.eject).applyQuaternion(e.state.quaternion);
      f.state.velocity.copy(e.state.velocity).add(v1);
      f.state.quaternion.copy(e.state.quaternion);
      flares.push(f); world.add(f);
      ev.emit('flare', { entity: e, flare: f, remaining: lo.flares });
    }
    return true;
  }

  function stepFlares(dt) {
    for (let i = flares.length - 1; i >= 0; i--) {
      const f = flares[i], p = f.state.position, v = f.state.velocity;
      f.age += dt;
      const sp = v.length();
      const fd = 1 / (1 + FLARE.drag * sp * dt);
      v.multiplyScalar(fd); v.y -= G * dt;
      p.addScaledVector(v, dt);
      f.intensity = flareIntensity(FLARE, f.age, f.life, f.eff);
      f.heat = f.intensity / FLARE.peak;
      if (f.age > f.life || p.y < ctx.world.groundHeightAt(p.x, p.z)) { flares.splice(i, 1); world.remove(f); }
    }
  }

  // ---- collisions -----------------------------------------------------------------------------------------------------
  function collisions(dt) {
    const A = world.aircraft;
    for (let i = 0; i < A.length; i++) {
      const a = A[i]; if (!a.alive || !a.wpn?.shape) continue;
      for (let j = i + 1; j < A.length; j++) {
        const b = A[j]; if (!b.alive || !b.wpn?.shape) continue;
        if (a.team === b.team && combat.clock - Math.max(a.wpn.spawnT, b.wpn.spawnT) < 6) continue;
        const th = 0.42 * ((a.radius || 5) + (b.radius || 5));
        r1.copy(a.state.position).sub(b.state.position);
        if (r1.lengthSq() > (th + 80) * (th + 80)) continue;
        r0.copy(r1).addScaledVector(a.state.velocity, -dt).addScaledVector(b.state.velocity, dt);
        if (segOriginDist2(r0, r1) < th * th) {
          const ia = !a.invulnerable, ib = !b.invulnerable;
          ev.emit('collision', { a, b, position: a.state.position.clone().lerp(b.state.position, 0.5) });
          if (ia) dm.kill(a, null, 'collision', { other: b, cause: 'collision', part: 'airframe' });
          if (ib) dm.kill(b, null, 'collision', { other: a, cause: 'collision', part: 'airframe' });
        }
      }
    }
  }

  // ---- queries --------------------------------------------------------------------------------------------------------
  /** Lead-computed gun solution: { point (world aim point with lead, drop, drag), dir, tof, range, inRange }. */
  function gunSolution(shooter, target, out = {}) {
    const S = shooter.loadout?.gun?.spec || GUNS.m61;
    const acc = target.wpn?.accS || null;            // smoothed (τ ACC_TAU) — no jumps at every jink
    return solveGun(shooter.state, target.state, S, shooter.wpn?.port || null, out, acc);
  }
  /** Per-target smoothed acceleration for gunSolution; resets on spawn and on teleports. */
  function smoothAccel(t, dt) {
    const w = t.wpn, s = t.state;
    if (!w.accS) { w.accS = new THREE.Vector3(); w.accP = new THREE.Vector3().copy(s.position); w.accInit = false; }
    const jump = w.accP.distanceToSquared(s.position), lim = Math.max(200, (s.velocity ? s.velocity.length() : 0) * dt * 5);
    if (!w.accInit || jump > lim * lim) { w.accS.set(0, 0, 0); if (s.acceleration) w.accS.copy(s.acceleration); w.accInit = true; }
    else if (s.acceleration) w.accS.lerp(s.acceleration, 1 - Math.exp(-dt / ACC_TAU));
    w.accP.copy(s.position);
  }
  /** Round fired now, after tof: offset from the shooter's straight-line path, in its current body axes. */
  function gunTrajectory(shooter, tof, out = new THREE.Vector3()) {
    const S = shooter.loadout?.gun?.spec || GUNS.m61;
    return trajectory(shooter.state, S, shooter.wpn?.port || null, tof, out);
  }
  /** Missiles guiding on `e` and aircraft holding a lock on it → out[] of { type, seeker, source, missile, range }. */
  function threatsTo(e, out = []) {
    let n = 0;
    const p = e.state.position;
    // objects live in a hidden pool on the array, so `out.length = 0` by the caller (or the truncation below) never drops them
    const pool = out.pool || (out.pool = []);
    for (let i = 0; i < missiles.length; i++) {
      const m = missiles[i];
      if (m.target !== e || m.lost) continue;
      const o = threatSlot(out, pool, n); n++;
      o.type = 'missile'; o.seeker = m.seeker; o.source = m.owner; o.missile = m; o.range = m.state.position.distanceTo(p);
    }
    const A = world.aircraft;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (a === e || !a.lock || a.lock.state !== 'locked' || a.lock.target !== e) continue;
      const o = threatSlot(out, pool, n); n++;
      o.type = 'lock'; o.seeker = a.lock.seeker; o.source = a; o.missile = null; o.range = a.state.position.distanceTo(p);
    }
    out.length = n; out.count = n;
    return out;
  }

  /**
   * Rearm (and optionally repair) an entity — for mission scripts. o: { heal 0..1 (fraction of maxHp restored and of
   * component damage repaired; 1 = good as new, engines that were shot out are restored, fire out), gun, ir, radar,
   * flares (absolute counts; default: back to the loadout maxima), invulnerable (bool, optional) }. Returns the loadout.
   */
  function rearm(e, o = {}) {
    if (!e || !e.loadout) return null;
    const lo = e.loadout;
    lo.gun.rounds = o.gun ?? Math.max(lo.gun.rounds, lo.gun.max);
    lo.missiles.ir = o.ir ?? Math.max(lo.missiles.ir, lo.missilesMax.ir || 0);
    lo.missiles.radar = o.radar ?? Math.max(lo.missiles.radar, lo.missilesMax.radar || 0);
    lo.flares = o.flares ?? Math.max(lo.flares, lo.flaresMax || 0);
    if (o.invulnerable != null) e.invulnerable = !!o.invulnerable;
    if (e.alive && o.heal > 0) dm.repair(e, Math.min(1, o.heal));
    sanitize(e);
    if (!(lo.missiles[lo.selected] > 0) && lo.missiles[lo.selected === 'ir' ? 'radar' : 'ir'] > 0) cycleWeapon(e);
    ev.emit('rearm', { entity: e, loadout: lo });
    return lo;
  }

  /** Public applyDamage(target, amount, { source, weapon, position, part? }) → hp removed. */
  function applyDamage(target, amount, info = {}) { return dm.apply(target, amount, info); }

  ev.on('cmd', ({ name } = {}) => {
    const p = world.player; if (!p || !p.alive || !p.loadout) return;
    if (name === 'missile') launchMissile(p);
    else if (name === 'flare') dropFlares(p, 1);     // input runs a programme (3 releases per press): one flare each
    else if (name === 'weaponNext') cycleWeapon(p);
  });
  ev.on('mission:abort', () => { const p = world.player; if (p) dm.reset(p); });

  return {
    specs: SPECS, bullets, missiles, flares,
    equip, setTrigger, launchMissile, dropFlares, cycleWeapon, applyDamage, gunSolution, gunTrajectory, threatsTo,
    lockState(e) { return e.lock; },
    /** flare(entity, { count }) — release `count` flares (default: a pair). Same rules as dropFlares. */
    flare(e, o = {}) { return dropFlares(e, o.count ?? FLARE.salvo); },
    /**
     * Gun muzzle of `e` in world space: fills outPos (and outDir, the firing direction = nose) and returns outPos,
     * or null when the entity has no gun.
     */
    muzzleOf(e, outPos = new THREE.Vector3(), outDir = null) {
      const w = e?.wpn; if (!w || !w.gun || !e.state) return null;
      outPos.set(w.port[0], w.port[1], w.port[2]).applyQuaternion(e.state.quaternion).add(e.state.position);
      if (outDir) outDir.copy(e.forward);
      return outPos;
    },
    rearm,
    /** Could `e`'s `type` seeker (or radar) lock `target` right now (geometry, signature, notch — no lock time)? */
    canLock(e, target, type = e.loadout?.selected || 'ir') { return !!(target && target.alive && target.state && canSee(e, target, type)); },
    /** Launch-zone numbers for an arbitrary shooter/target pair without touching entity.lock (AI planning). */
    launchZone(shooter, target, type = 'ir', out = {}) {
      const s = shooter.state, ts = target.state;
      v1.copy(ts.position).sub(s.position); const range = v1.length() || 1; v1.divideScalar(range);
      zg.alt = 0.5 * (s.position.y + ts.position.y); zg.climb = ts.position.y - s.position.y;
      zg.vLaunch = Math.max(100, s.velocity.dot(v1)); zg.vAway = ts.velocity.dot(v1); zg.vTarget = ts.velocity.length(); zg.range = range;
      launchZone(table(type), zg, out);
      out.range = range; out.rMin = MISSILES[type].armDist + Math.max(0, s.velocity.dot(v1) - ts.velocity.dot(v1)) * MISSILES[type].armTime + 150;
      return out;
    },
    update(dt) {
      if (!(dt > 0)) return;
      const p = world.player;
      if (p && p.alive && combat.input && !p.pilot) setTrigger(p, combat.input.trigger);
      refreshTargets(dt);
      const A = world.aircraft;
      for (let i = 0; i < A.length; i++) { const e = A[i]; if (e.loadout) { sanitize(e); fireGun(e, dt); updateLock(e, dt); } }
      stepBullets(dt);
      stepMissiles(dt);
      stepFlares(dt);
      collisions(dt);
      dm.update(dt, A);
      for (let i = 0; i < A.length; i++) if (A[i].wpn) A[i].wpn.hpSeen = A[i].hp;
    },
    reset() {
      bullets.n = 0; missiles.length = 0; flares.length = 0;
      if (ctx.player) dm.reset(ctx.player);
    },
    /** internals for tools/tests */
    _dm: dm, _table: table,
  };
}
