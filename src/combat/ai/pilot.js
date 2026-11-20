// One AI pilot: perception → decisions (orders, target, BFM manoeuvre) → steering request → safety guard → controls.
// Flies the real 6-DOF flight model through entity.controls exactly like a human, and uses combat.weapons the same way.
// No allocations in update(): every vector / record is created once per pilot (or module-wide scratch).
import * as THREE from 'three';
import { clamp, lerp, G0, headingVec, DEG } from '../util.js';
import { createFlightController, profileOf, turnRadius } from './fly.js';
import {
  classify, pursuitPoint, noseAimDir, losFeedForward, resolveOffset, formationSlot, closestApproach, interceptPoint, energyHeight,
} from './geom.js';
import { predictRecovery, terrainAhead } from './safety.js';
import { makeSkill, PERSONALITIES } from './skill.js';
import { CALL_GAP } from './radio.js';

const UP = new THREE.Vector3(0, 1, 0);
// module-wide scratch (pilots update one at a time; nothing here survives a call)
const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3(), E = new THREE.Vector3();
const CA = { t: 0, miss: 0 }, REC = { clear: 0, at: 0, ground: 0 }, RS = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, roll: 0, psi: 0 };
const RP = { nz: 4, rollRate: 3, climb: 0.3, turn: 0, horizon: 12, dt: 0.4, delay: 0.1 };
const DISTS = [400, 1000, 2000, 3500, 5500], FRAC = [0.15, 0.4, 0.8, 1.4, 2.2];
const SOL = { point: new THREE.Vector3(), tof: 0, range: 0, inRange: false }, solA = new THREE.Vector3();
const GUN_ENTER = 0.15, GUN_EXIT = 0.35;          // gun-solution error (rad) to start / give up tracking
const OFFENSE_MODES = new Set(['pursuit', 'guns', 'yoyo-high', 'yoyo-low', 'lag-roll', 'scissors', 'merge', 'vertical', 'intercept']);
const FIGHT_MODES = new Set(['pursuit', 'lead', 'pure', 'lag', 'guns', 'yoyo-high', 'yoyo-low', 'lag-roll', 'scissors', 'break', 'jink', 'extend',
  'merge', 'vertical', 'split-s', 'defend-missile', 'crank', 'reattack', 'bugout']);
export const isFightMode = (m) => FIGHT_MODES.has(m);

/**
 * createPilot(combat, team, entity, { skill, order, personality }) → pilot. `team` is the shared AI team service
 * (target spreading, call bookkeeping) from index.js.
 */
export function createPilot(combat, team, e, o = {}) {
  const rng = combat.rng;
  const skill = clamp(o.skill ?? e.skill ?? 0.5, 0, 1);
  const personality = PERSONALITIES.includes(o.personality) ? o.personality
    : PERSONALITIES.includes(o.order?.personality) ? o.order.personality
      : PERSONALITIES[Math.floor(rng() * PERSONALITIES.length) % PERSONALITIES.length];
  const sk = makeSkill(skill, personality, rng);
  const prof = profileOf(e.def, e.sim);
  const fc = createFlightController(e, prof);
  const gFight = Math.min(prof.gMax * sk.gUse, prof.fbw ? prof.fcsNzMax : prof.gMax * 0.9);

  // ---- persistent per-pilot state
  const geo = { range: 0, closure: 0, ata: 0, aa: 0, threatAta: 0, hca: 0, dAlt: 0, situation: 'neutral' };
  const ageo = { range: 0, closure: 0, ata: 0, aa: 0, threatAta: 0, hca: 0, dAlt: 0, situation: 'neutral' };
  const tmpGeo = { range: 0, closure: 0, ata: 0, aa: 0, threatAta: 0, hca: 0, dAlt: 0, situation: 'neutral' };
  const want = { dir: new THREE.Vector3(1, 0, 0), g: 3, gain: 1.4, ff: new THREE.Vector3(), useFF: false, spd: 200, ab: true, brake: true,
    direct: false, nz: 1, bank: 0, fire: false, minLever: 0, track: false, kp: 2, kd: 0.4, w0: new THREE.Vector3(), bias: 0 };
  const off = { x: 0, y: 0, z: 0 };
  const slot = new THREE.Vector3(), lastKnown = new THREE.Vector3(), home = new THREE.Vector3().copy(e.state.position), orbitC = new THREE.Vector3();
  let aoaS = 0;
  const tAccS = new THREE.Vector3(); let planeT = 0;
  let mergeHold = -1, mergeHoldTgt = null, prevInFlight = 0, missedT = -99;   // missile employment: hold to the merge, after a miss    // target manoeuvre-plane steadiness (gunnery)
  const manDir = new THREE.Vector3(), aim = new THREE.Vector3(), ffv = new THREE.Vector3(), escDir = new THREE.Vector3();
  const mslots = [];                                   // missile threat memory: { m, onset, seen }
  for (let i = 0; i < 6; i++) mslots.push({ m: null, onset: 0, seen: false, flares: 0, flareAt: 0, flareNext: 0, plan: '', breakAt: 0 });
  const enemies = [], friends = [];
  const lastCall = Object.create(null);
  let order = o.order || { type: 'engage' };
  let thinkT = rng() * 0.3, senseT = rng() * 0.2, safeT = rng() * 0.1, floorT = rng() * 0.5;
  let activity = 'cruise', man = '', manT = 0, manSide = 1, manChoice = '', lockMan = 0;
  let attacker = null, attackerOnset = -1, gunOnset = -1, missile = null, missileTgo = 99, missileOnset = 0, missileSlot = null;
  let targetSince = 0, lastTarget = null, lastTally = null, fighting = false, wasFighting = false;
  let fineTrack = false, aimNX = 0, aimNY = 0, aimX = 0, aimY = 0, settleT = 0, burstT = 0, gapT = 0, firing = false, lastShot = -99, lastCycle = -99;
  let prevGunErr = 1, gunErrS = 0, lockSince = -1, flareT = 0, jinkT = 0, jinkBank = 0, jinkNz = 0, recovering = false, recT = 0, escTurn = 0, floorAlt = -1e9, mistakeT = 0, mistake = '';
  let stalemateT = 0, holdSet = false, extendT = 0, lastHp = e.hp ?? 100, bugout = false, maydaySent = false, winchesterSent = false, lostSightT = 0, defendSide = 1, lookT = 0, neutralT = 0, neutralLim = 30;

  const gunDbg = { err: 0, tol: 0, r: 0, good: false, losRate: 0 };      // last gun fire-control numbers (tools)
  const pilot = {
    entity: e, skill, personality, mode: 'cruise', sub: '', profile: prof, tuning: sk, _fc: fc,
    /** true = never attacks, flies its order and evades (missions may set this directly, as well as order.passive) */
    passive: !!o.passive,
    /** debugging / tools: current steering request and safety state */
    debug: { want, gun: gunDbg, get recovering() { return recovering; }, get activity() { return activity; }, get attacker() { return attacker; }, get missile() { return missile; }, get mistake() { return mistake; } },
    setOrder(ord) {
      order = ord || { type: 'engage' };
      if (order.type === 'orbit' && !order.center) orbitC.copy(e.state.position);
      if (order.type === 'patrol') order.index = order.index || 0;
      thinkT = 0;
    },
    get order() { return order; },
    update,
    /** notification from the team service (index.js) */
    onKill(victim) { if (victim.kind === 'aircraft') call('splash', victim, true); },
    onDamage(amount, source) {
      if (!e.alive) return;
      call('hit', source || null);
      const f = hpFrac();
      if (f < 0.3 && !maydaySent) { maydaySent = true; call('mayday', source || null, true); }
    },
  };
  pilot.setOrder(order);

  function fuelFrac() { const s = e.state; return s.fuelCapacity > 0 ? s.fuel / s.fuelCapacity : 1; }
  function hpFrac() { return e.maxHp ? clamp((e.hp ?? e.maxHp) / e.maxHp, 0, 1) : 1; }
  function call(name, target = null, force = false) {
    const t = combat.clock, gap = CALL_GAP[name] ?? 10;
    if (!force && lastCall[name] != null && t - lastCall[name] < gap) return;
    if (!force && lastCall._any != null && t - lastCall._any < 1.2) return;
    lastCall[name] = t; lastCall._any = t;
    combat.events.emit('ai:call', { entity: e, call: name, target: target || null });
  }
  function gauss() { let u = rng(); if (u < 1e-9) u = 1e-9; return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }
  const ground = (x, z) => combat.ctx.world.groundHeightAt(x, z);
  function aglAt() { return e.state.position.y - ground(e.state.position.x, e.state.position.z); }

  // =====================================================================================================  update
  function update(dt) {
    if (!e.alive || !e.state || e.state.crashed || !(dt > 0)) return;
    const s = e.state;
    if ((senseT -= dt) <= 0) { senseT = 0.2; sense(); }
    if ((thinkT -= dt) <= 0) { thinkT = sk.think * (0.8 + 0.4 * rng()); think(); }
    manT -= dt; lockMan -= dt; mistakeT -= dt; lostSightT -= dt;
    // ---- default request
    want.direct = false; want.useFF = false; want.fire = false; want.ab = true; want.brake = true; want.minLever = 0; want.track = false; want.bias = 0;
    want.g = 3; want.gain = 1.3;
    act(dt);
    // fuel discipline: afterburner only to survive once the fuel runs low (it burns 3–4× the fuel)
    if (want.ab && fuelFrac() < 0.3 && !recovering && pilot.mode !== 'break' && pilot.mode !== 'defend-missile' && pilot.mode !== 'jink' && s.ias > prof.stall * 1.5) want.ab = false;
    if (mistake === 'relax' && (pilot.mode === 'break' || pilot.mode === 'jink')) { want.g = Math.min(want.g, 2.2); want.nz = Math.min(want.nz, 2.2); }
    guard(dt);
    // ---- AoA discipline (energy): offensive manoeuvring at the best sustained-turn AoA, the full fight AoA only to
    // defend, to recover, or to pull the last degrees onto a gun solution. Rookies pull to the limit and bleed
    const offensive = OFFENSE_MODES.has(pilot.mode) && pilot.sub !== 'terrain' && !(pilot.mode === 'guns' && gunErrS < 0.12) &&
      Math.abs(s.pitch) < 0.45 && want.dir.y > -0.3 && !recovering;
    // how much of the envelope the pilot dares to use: rookies stay well clear of the AoA limit (fear of departing),
    // aces fly on it; terrain recovery always uses everything
    const aUse = recovering ? 1 : lerp(0.6, 1.0, clamp((skill - 0.15) / 0.75, 0, 1));
    // (the best sustained turn rate is found near the AoA limit at low speed, so skilled pilots do not back off there)
    void offensive;
    fc.alphaLimit = prof.alphaFight * aUse;
    // ---- fly
    if (want.direct) fc.direct(want.nz, want.bank, want.g);
    else if (want.track) fc.track(want.dir, want.useFF ? want.ff : null, want.g, want.kp, want.kd, dt, want.w0, want.bias);
    else { fc.trackValid = false; fc.steer(want.dir, want.g, want.gain, want.useFF ? want.ff : null, want.bias); }
    fc.speed(want.spd, want.ab, want.brake, want.minLever);
    fc.apply(dt);
    // ---- weapons
    const W = combat.weapons;
    if (W && e.loadout) {
      if (firing !== want.fire) { firing = want.fire; if (firing) call('guns', e.target); }
      W.setTrigger(e, want.fire);
    }
    if (s.ias < 1) return;
  }

  // =====================================================================================================  sense
  // threats: missiles guiding on us, aircraft in the rear quarter pointing at us
  function sense() {
    const W = combat.weapons, s = e.state, t = combat.clock;
    // ---- missiles
    for (const sl of mslots) if (sl.m && (!sl.m.alive || sl.m.target !== e)) { sl.m = null; sl.seen = false; }
    const list = W?.missiles || [];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m.alive || m.target !== e) continue;
      let sl = null;
      for (const q of mslots) if (q.m === m) { sl = q; break; }
      if (sl) continue;
      for (const q of mslots) if (!q.m) { sl = q; break; }
      if (!sl) break;
      sl.m = m; sl.onset = t; sl.flares = 0; sl.flareNext = 0; sl.plan = ''; sl.breakAt = sk.breakTgo * lerp(0.7, 1.15, rng());
      // radar shots ring the RWR; IR shots are passive: seen with a probability (missile warning / eyes)
      const seeker = m.seeker || m.spec?.seeker || m.type || 'ir';
      // flare plan for this missile (IR): first pair at time-to-go flareAt, then up to sk.flarePairs pairs flareGap apart.
      // Rookies flare late (or too early and spend them), aces at the last few seconds, in time with the break
      sl.flareAt = seeker === 'radar' ? -1 : skill < 0.4 && rng() < 0.35 ? 5 + 2 * rng() : sk.flareTgo * (0.8 + 0.4 * rng());
      sl.seen = seeker === 'radar' ? rng() < 0.6 + 0.4 * skill : rng() < sk.seeIr;
      sl.seenAt = t + (sl.seen ? 0 : 1e9);
    }
    // late detection of an unseen IR shot when it gets close (the smoke trail)
    missile = null; missileTgo = 99; missileSlot = null;
    for (const q of mslots) {
      if (!q.m) continue;
      const m = q.m;
      A.copy(m.state.position).sub(s.position);
      const r = A.length();
      if (!q.seen && r < 1800 + 2500 * skill && rng() < 0.3 + 0.5 * skill) { q.seen = true; q.onset = t; }
      if (!q.seen || t - q.onset < sk.reaction * 0.8) continue;
      const tgo = liveTgo(m, r);
      if (tgo < missileTgo) { missileTgo = tgo; missile = m; missileOnset = q.onset; missileSlot = q; }
    }
    // ---- attackers: enemies behind us with their nose on us
    const prev = attacker;
    attacker = null;
    let best = 0;
    combat.world.enemiesOf(e, enemies);
    for (let i = 0; i < enemies.length; i++) {
      const x = enemies[i];
      if (!x.state) continue;
      classify(e, x, tmpGeo);
      if (tmpGeo.range > 6000) continue;
      if (tmpGeo.threatAta > 50 * DEG) continue;
      // in front of us we see them anyway; in the rear quarter it depends on the lookout (check six)
      const behind = tmpGeo.ata > 100 * DEG;
      const score = (1 - tmpGeo.range / 6000) * (1 - tmpGeo.threatAta / (50 * DEG)) * (behind ? 1.4 : 0.7) + (x.target === e ? 0.4 : 0);
      if (score > best) { best = score; attacker = x; }
    }
    if (attacker && attacker !== prev) {
      // spotting delay: rear-quarter attackers are noticed later by poor pilots
      classify(e, attacker, ageo);
      const behind = ageo.ata > 100 * DEG;
      attackerOnset = t + (behind && rng() > sk.checkSix ? 1.5 + 2 * (1 - skill) : 0);
      if (behind && ageo.range < 3000) call('on-my-six', attacker);
    }
    if (attacker) {
      classify(e, attacker, ageo);
      // poor lookout: now and then a rookie loses the bandit in its rear quarter for a few seconds and flies
      // straight on, predictable (the opening a human attacker is waiting for)
      if (t > lookT) {
        lookT = t + lerp(5, 12, skill) * (0.7 + 0.6 * rng());
        if (skill < 0.7 && ageo.ata > 110 * DEG && ageo.range < 2500 && rng() < (1 - sk.checkSix) * 0.6 && activity === 'fight') {
          const lose = lerp(3.2, 1.2, skill) * (0.7 + 0.6 * rng());
          attackerOnset = t + lose;
          if (e.target === attacker && mistakeT <= 0) { mistake = 'lost'; mistakeT = lostSightT = lose; lastKnown.copy(e.state.position).addScaledVector(e.forward, 3000); }
        }
      }
      const gunsThreat = ageo.range < 1700 && ageo.threatAta < 12 * DEG;
      if (gunsThreat) { if (gunOnset < 0) gunOnset = t; } else gunOnset = -1;
    } else gunOnset = -1;
  }

  /** Time to go (s) of missile m: the weapon's own estimate when it has one, else range / closing speed. */
  function liveTgo(m, r) {
    if (m.tgo > 0) return m.tgo;
    const s = e.state;
    A.copy(m.state.position).sub(s.position);
    if (r < 0) r = A.length();
    B.copy(m.state.velocity).sub(s.velocity);
    const closing = -B.dot(A) / Math.max(r, 1);
    return closing > 30 ? r / closing : 40;
  }

  // =====================================================================================================  think
  function think() {
    const t = combat.clock;
    const W = combat.weapons;
    const hp = hpFrac();
    const dmg = e.sim?.damage;
    const fuel = fuelFrac();
    bugout = order.type !== 'flee' && order.type !== 'rtb' && (hp < sk.bugout || fuel < 0.08 || (dmg && (dmg.thrust < 0.55 || dmg.ctrl < 0.55)));
    // ---- what are we doing overall
    const ot = order.type;
    let wantFight = false, autoTarget = true;
    if (order.passive || pilot.passive || (e.team === 'neutral' && !(order.target && isHostile(order.target)))) activity = 'passive';
    else if (ot === 'flee' || ot === 'rtb') activity = 'flee';
    else {
      if (ot === 'engage') { wantFight = true; activity = 'fight'; }
      else if (ot === 'intercept') {
        const tg = order.target;
        if (tg && tg.alive) {
          const r = tg.state.position.distanceTo(e.state.position);
          if (r < (order.engageRange ?? 15000) || fighting) { wantFight = true; activity = 'fight'; } else activity = 'intercept';
        } else { wantFight = true; activity = 'fight'; }
      } else if (ot === 'escort') {
        const L = order.leader;
        if (!L || !L.alive) { wantFight = true; activity = 'fight'; }
        else {
          // the wingman joins the fight when the leader is in one, or an enemy comes close to the pair
          const lp = L.pilot;
          const leaderFighting = (lp && isFightMode(lp.mode)) || !!(L.target && L.target.alive && L.target.kind === 'aircraft');
          const near = combat.world.nearestEnemy(L, order.engageRange ?? 14000);
          const threatened = !!near && (near.target === L || near.target === e || near.state.position.distanceTo(L.state.position) < 9000);
          if (!order.weaponsHold && (leaderFighting || threatened || (fighting && near))) { wantFight = true; activity = 'fight'; }
          else activity = 'formation';
        }
      } else {
        // patrol / orbit / cruise: weapons free inside the engagement radius unless told to hold
        const near = order.weaponsHold ? null : combat.world.nearestEnemy(e, order.engageRange ?? (ot === 'cruise' ? 12000 : 20000));
        if (near) { wantFight = true; activity = 'fight'; } else activity = ot === 'patrol' || ot === 'orbit' ? ot : 'cruise';
      }
    }
    if (bugout && activity === 'fight') activity = 'bugout';
    // ---- target
    if (wantFight) {
      const forced = (ot === 'engage' || ot === 'intercept') && order.target && order.target.alive && isHostile(order.target) ? order.target : null;
      e.target = forced || selectTarget();
      if (!e.target) { wantFight = false; activity = ot === 'escort' && order.leader?.alive ? 'formation' : ot === 'engage' ? 'hold' : 'cruise'; }
      else holdSet = false;
    } else if (activity !== 'passive' && activity !== 'flee' && activity !== 'bugout') e.target = null;
    if (e.target && !isHostile(e.target)) e.target = null;      // teams can change at runtime (neutral → red)
    void autoTarget;
    fighting = activity === 'fight';
    const T = e.target && e.target.alive ? e.target : null;
    if (T !== lastTarget) {
      targetSince = t; lastTarget = T;
      if (T && fighting) {
        if (lastTally !== T) { call('tally', T); lastTally = T; }
        if (ot === 'escort' && order.leader?.alive && (T.target === order.leader || order.leader.target === T)) call('press', T);
        else call('engaging', T);
      }
    }
    if (wasFighting && !fighting && activity === 'formation') call('rejoin', order.leader);
    wasFighting = fighting;
    // ---- weapon selection + missile shots
    if (W && e.loadout && T && fighting) {
      classify(e, T, geo);
      chooseWeapon(geo.range);
      if (!missile || skill > 0.8) tryMissile(T);
      const L = e.loadout.missiles;
      if (L && (L.ir || 0) + (L.radar || 0) === 0 && lastShot > 0 && !winchesterSent) { winchesterSent = true; call('winchester'); }
    }
    // ---- manoeuvre decision
    if (fighting && T) { classify(e, T, geo); rollMistake(T); }
    decide(T);
  }

  /** Hostility is re-read every time (teams change at runtime); neutrals are never attacked and never attack. */
  function isHostile(x) {
    if (!x || x.team === e.team || x.team === 'neutral') return false;
    // a neutral attacks only what its order names explicitly (a mission's scripted surprise)
    return e.team !== 'neutral' || ((order.type === 'engage' || order.type === 'intercept') && order.target === x);
  }

  /** A target that does not fight back (drone, transport, bomber, passive): flown at without BFM. */
  function isEasy(x) {
    if (x.pilot?.passive || x.pilot?.order?.passive) return true;
    const cat = x.def?.category;
    if (cat === 'transport' || cat === 'bomber' || cat === 'airliner') return true;
    const lo = x.loadout;
    return !!lo && !(lo.gun?.rounds > 0) && !((lo.missiles?.ir || 0) + (lo.missiles?.radar || 0) > 0);
  }

  /** 0..1.5: how much the mission wants `x` dead (marked target, bomber / striker / transport role or category). */
  function priorityOf(x) {
    let p = 0;
    const mk = combat.director?.markers;
    if (mk) for (let i = 0; i < mk.length; i++) if (mk[i].kind === 'target' && mk[i].entity === x) { p = 1.5; break; }
    const role = x.tags?.role;
    if (role === 'bomber' || role === 'striker' || role === 'raider' || role === 'hva') p = Math.max(p, 1.2);
    const cat = x.def?.category;
    if (cat === 'bomber' || cat === 'transport' || cat === 'attack') p = Math.max(p, 1);
    if (x.pilot?.passive || x.pilot?.order?.passive) p = Math.max(p, 0.5);
    return p;
  }

  function selectTarget() {
    if (e.team === 'neutral') return null;
    combat.world.enemiesOf(e, enemies);
    const L = order.type === 'escort' ? order.leader : null;
    let best = null, bs = Infinity;
    const cur = e.target;
    for (let i = 0; i < enemies.length; i++) {
      const x = enemies[i];
      if (!x.state || x.kind !== 'aircraft') continue;
      classify(e, x, tmpGeo);
      if (tmpGeo.range > (order.detectRange ?? 80000)) continue;
      let sc = tmpGeo.range / 1000 + (tmpGeo.ata / Math.PI) * 4;
      if (x.target === e) sc -= 3 + (tmpGeo.range < 4000 ? 4 : 0);      // whoever is attacking me
      if (L && L.alive && x.target === L) sc -= 6;                       // whoever is attacking my leader
      if (L && L.alive && L.target === x) sc -= 1;                       // support the leader's attack a little
      sc -= 4 * priorityOf(x);                                           // mission objectives: bombers, strikers, marked targets
      sc += 3.5 * team.countTargeting(x, e);                             // spread over the enemies
      if (x === cur) sc -= 2.5;                                          // hysteresis
      if (sc < bs) { bs = sc; best = x; }
    }
    return best;
  }

  function chooseWeapon(range) {
    const W = combat.weapons, L = e.loadout?.missiles;
    if (!L || !W.cycleWeapon) return;
    const ir = L.ir || 0, rd = L.radar || 0;
    let want = e.loadout.selected;
    if (rd > 0 && (range > 9000 || ir === 0)) want = 'radar';
    else if (ir > 0) want = 'ir';
    if (want !== e.loadout.selected && combat.clock - lastCycle > 3) { lastCycle = combat.clock; W.cycleWeapon(e); }
  }

  function tryMissile(T) {
    const W = combat.weapons, t = combat.clock;
    const L = e.lock;
    // own missiles in flight at this target; one just gone with the target still alive = a miss
    let inFlight = 0;
    for (const m of W.missiles) if (m.owner === e && m.target === T && m.alive) inFlight++;
    if (prevInFlight > 0 && inFlight === 0 && T.alive) missedT = t;
    prevInFlight = inFlight;
    // the merge: many pilots do not take the head-on radar shot the moment it is valid. Decided once per bandit:
    // hold it to the merge and fight (turn fighters, unsure pilots) or shoot (aces early, cautious pilots)
    if (mergeHoldTgt !== T) {
      mergeHoldTgt = T;
      const pBase = skill > 0.75 ? 0.5 : skill > 0.4 ? 0.65 : 0.7;
      const pPers = personality === 'turn' ? 0.25 : personality === 'cautious' ? -0.3 : personality === 'energy' ? -0.1 : 0;
      mergeHold = rng() < clamp(pBase + pPers, 0.05, 0.95) ? 1 : 0;
    }
    if (!L || L.state !== 'locked' || L.target !== T) { lockSince = -1; return; }
    if (lockSince < 0) lockSince = t;
    if (t - lockSince < sk.shotDelay) return;                // time to decide to shoot (rookies hesitate)
    const type = e.loadout.selected, spec = W.specs?.missiles?.[type];
    if (!spec || !(e.loadout.missiles[type] > 0)) return;
    if (t - lastShot < sk.shotGap) return;
    const r = L.range || geo.range;
    // aspect: angle off the target's tail (0 = from astern, 180° = head-on). (lock.aspect is not used: its value
    // is the reverse of its comment, see INTEGRATION.md)
    classify(e, T, tmpGeo); const asp = tmpGeo.aa;
    const seeker = spec.seeker || type;
    // launch zone from the weapon (rMin arming distance, rMax kinematic reach, rNe no-escape); never outside rMax.
    // Aces wait for the no-escape zone; others shoot at a skill fraction of rMax
    const rMax = L.rMax || 0, rNe = L.rNe || 0;
    if (!(rMax > 0) || !(L.tti > 0)) return;
    const rMin = Math.max(L.rMin || 0, 300) * 1.2;
    let rShot = Math.max(rNe, rMax * sk.shotRange);
    if (rNe > rMin * 1.5 && skill > 0.5) rShot = lerp(rMax * sk.shotRange, rNe, (skill - 0.5) / 0.4);
    if (seeker === 'ir') {
      if (asp > 140 * DEG && r > 1500) return;           // head-on IR shots only very close (the seeker sees the hot nose badly)
      if (geo.ata > 35 * DEG) return;
    } else if (geo.closure < -100 && r > rNe) return;          // running target: wait for the no-escape zone
    if (r < rMin || r > Math.min(rShot, rMax)) return;
    // holding to the merge: no shots in the forward hemisphere until the pass is over
    if (mergeHold === 1) { if (tmpGeo.range < 2000 || tmpGeo.ata > 90 * DEG) mergeHold = 0; else if (asp > 100 * DEG) return; }
    // first exchange defeated: it becomes a turning fight; only a good rear-quarter shot for a while
    if (t - missedT < lerp(35, 15, skill) && !(asp < 70 * DEG && r < Math.max(rNe, rMin * 2))) return;
    // one missile at a time at the same target (aces fire a second after a while)
    if (inFlight > (skill > 0.75 && t - lastShot > 10 ? 1 : 0)) return;
    // do not shoot when a friendly is close to the target (IR seekers switch, radar fuzes)
    combat.world.friendsOf(e, friends);
    for (let i = 0; i < friends.length; i++) if (friends[i].state.position.distanceToSquared(T.state.position) < 700 * 700) return;
    // personality: cautious pilots love missiles, turn fighters save them for good shots
    if (rng() > sk.missilePref + (r < rNe ? 0.4 : 0)) { lastShot = t - sk.shotGap * 0.6; return; }
    const m = W.launchMissile(e, type);
    if (m) {
      lastShot = t;
      call(seeker === 'radar' ? 'fox3' : 'fox2', T, true);
    }
  }

  // ---------------------------------------------------------------------------------------- BFM decision
  function decide(T) {
    const t = combat.clock, s = e.state;
    if (activity !== 'fight' && activity !== 'bugout' && activity !== 'passive' && activity !== 'flee') {
      // non-fighting: still defend against missiles and guns
      if (missile && t - missileOnset > sk.reaction) { setMode('defend-missile'); return; }
      if (attacker && gunOnset >= 0 && t - gunOnset > sk.reaction && t > attackerOnset) { setMode('break'); return; }
      setMode(activity);
      return;
    }
    if (activity === 'passive') { setMode('passive'); return; }
    // 1. missiles
    if (missile && t - missileOnset > sk.reaction) { if (pilot.mode !== 'defend-missile') call('missile-inbound', missile.owner || null); setMode('defend-missile'); return; }
    // 2. guns threat
    if (attacker && gunOnset >= 0 && t - gunOnset > sk.reaction && t > attackerOnset && mistake !== 'fixate') {
      if (pilot.mode !== 'jink' && pilot.mode !== 'break') call('defending', attacker);
      setMode(rng() < sk.jink || pilot.mode === 'jink' ? 'jink' : 'break');
      return;
    }
    if (activity === 'flee' || activity === 'bugout') {
      if (attacker && t > attackerOnset && ageo.range < 3500 && ageo.ata > 100 * DEG) { setMode('break'); return; }
      setMode(activity === 'flee' ? 'flee' : 'bugout'); return;
    }
    if (!T) { setMode(order.type === 'engage' ? 'hold' : 'cruise'); return; }
    classify(e, T, geo);
    const V = s.ias, corner = prof.corner, agl = aglAt();
    // locked manoeuvres finish unless something above interrupts
    if (lockMan > 0 && (pilot.mode === 'split-s' || pilot.mode === 'vertical' || pilot.mode === 'merge' || pilot.mode === 'yoyo-high' ||
      pilot.mode === 'yoyo-low' || pilot.mode === 'lag-roll' || pilot.mode === 'extend')) return;
    // 3. defensive: somebody in our rear quarter pointing at us
    if (attacker && t > attackerOnset && ageo.range < 4500 && ageo.ata > 95 * DEG && ageo.threatAta < 40 * DEG && mistake !== 'fixate') {
      if (pilot.mode !== 'break' && pilot.mode !== 'split-s') call('defending', attacker);
      const room = agl - sk.deck - (V * V) / (G0 * Math.max(gFight - 1, 1)) * 2.2;
      if (room > 500 && V < corner + 40 && V > prof.stall * 1.6 && s.pitch > -0.3 && rng() < sk.verticalPref * 0.5 && pilot.mode !== 'break') {
        setMode('split-s', 6); manDir.set(e.forward.x, 0, e.forward.z).normalize(); return;
      }
      setMode('break');
      return;
    }
    // easy target (transport, bomber, drone, passive): no BFM, just get behind it and shoot
    if (isEasy(T)) {
      if (geo.range < Math.max(sk.gunMax * 1.5, 1200) && geo.ata < 40 * DEG) { setMode('guns'); return; }
      setMode('pursuit', 0, geo.range < 900 && geo.closure > 40 ? 'lag' : geo.range > 3000 ? 'lead' : 'pure');
      return;
    }
    // missile reset: a long close-in stalemate with IR missiles left: separate, come back for a shot
    stalemateT = geo.situation === 'offensive' || geo.range > 2500 ? 0 : stalemateT + sk.think;
    if (stalemateT > lerp(60, 25, skill) && ((e.loadout?.missiles?.ir || 0) + (e.loadout?.missiles?.radar || 0)) > 0 && geo.threatAta > 70 * DEG && V > corner * 0.7) {
      stalemateT = 0; setMode('extend', 8); return;
    }
    // flat stalemate (an endless circle or scissors): break the symmetry. With the energy, go vertical and come down
    // on the bandit; without it, wait for him to make the move (or a mistake)
    neutralT = geo.situation === 'offensive' && geo.range < 1500 || geo.range > 3500 ? 0 : neutralT + sk.think;
    if (neutralT > neutralLim) {
      neutralT = 0; neutralLim = lerp(45, 18, skill) * (0.7 + 0.6 * rng());
      const myE = energyHeight(s.position.y, s.tas), hisE = energyHeight(T.state.position.y, T.state.tas);
      if (myE > hisE - 150 && agl > sk.deck + 2500 && V > corner * 0.8 && geo.threatAta > 30 * DEG) {
        setMode('vertical', 6); A.copy(T.state.position).sub(s.position); A.y = 0; if (A.lengthSq() > 1) manDir.copy(A.normalize()); return;
      }
    }
    // 4. out of energy and not winning: extend, then come back
    const slow = V < corner * 0.55 - sk.slack * 0.3;
    if (slow && geo.situation !== 'offensive' && geo.threatAta < 70 * DEG && geo.range > 1200 && rng() < 0.1 + sk.extendPref * 0.25) { setMode('extend', 9); return; }
    // energy fighters disengage from a slow turning fight to come back with speed
    if (personality === 'energy' && geo.situation === 'neutral' && V < corner - 10 && geo.range > 1500 && geo.range < 4000 && geo.threatAta < 90 * DEG && rng() < 0.04) { setMode('extend', 9); return; }
    // 5. head-on: merge handling
    if (geo.situation === 'head-on' && geo.range < 7000 && (geo.range > 1500 && geo.hca > 120 * DEG && geo.closure > 80 || pilot.mode === 'merge')) {
      if (pilot.mode !== 'merge') {
        // pass to the side the bandit already is on; one-circle (turn away, nose-to-nose) if we out-rate it slow,
        // two-circle (turn toward, nose-to-tail) if we have the energy / sustained turn
        A.copy(T.state.position).sub(s.position);
        manSide = A.dot(e.right) >= 0 ? 1 : -1;
        const myE = energyHeight(s.position.y, s.tas), hisE = energyHeight(T.state.position.y, T.state.tas);
        manChoice = personality === 'turn' || (myE < hisE - 300 && personality !== 'energy') ? 'one-circle' : 'two-circle';
        setMode('merge', 12);
      }
      return;
    }
    // vertical re-attack: fast energy fighter with altitude to spare and the bandit low or far
    if (V > corner + 50 && geo.range > 2500 && geo.range < 7000 && geo.situation !== 'defensive' && rng() < sk.verticalPref * 0.25 && s.position.y < 12000 && agl > sk.deck + 2500) {
      setMode('vertical', 5); return;
    }
    // 6. offensive / neutral pursuit
    if (mistake === 'lost' && lostSightT > 0) { setMode('pursuit', 0, 'lost'); return; }
    // guns: in range with the nose near the target; give it up when the lead can't be pulled (the target out-rates us):
    // lag, keep the energy, wait for it to bleed its speed, then convert
    if (geo.range < Math.max(sk.gunMax * 1.5, 1200) && geo.aa < 120 * DEG && geo.ata < 50 * DEG) {
      // the angle the nose still has to move to the gun solution decides between tracking and pulling lead
      combat.weapons.gunSolution(e, T, SOL);
      A.copy(SOL.point).sub(s.position).normalize();
      const lead = Math.acos(clamp(A.dot(e.forward), -1, 1));
      if (pilot.mode === 'guns' ? gunErrS < GUN_EXIT || lead < 0.3 : lead < GUN_ENTER) { if (pilot.mode !== 'guns') gunErrS = lead; setMode('guns'); return; }
      if (geo.aa < 90 * DEG && !(geo.range < 600 && geo.closure > 60)) { setMode('pursuit', 0, 'lead'); return; }
    }
    // overshoot coming: closing fast with angle off and little time to go. Lag first (throttle and speedbrake solve
    // most of it); out of plane (high yo-yo) only when the closure is more than the throttle can kill
    const tgoC = geo.closure > 1 ? geo.range / geo.closure : 99;
    if (geo.aa < 100 * DEG && geo.range < 1500 && geo.closure > 30 && tgoC < 7 && (geo.hca > 35 * DEG || geo.ata > 25 * DEG) && mistake !== 'overshoot') {
      if (geo.closure > 90 && agl > sk.deck + 900 && rng() < 0.3 + 0.6 * sk.verticalPref) setMode('yoyo-high', 2.5 + rng());
      else if (geo.closure > 120 && geo.range < 500) setMode('lag-roll', 2 + rng());
      else setMode('pursuit', 0, 'lag');
      return;
    }
    // bandit out-rating us (range opening, nose falling behind): low yo-yo to cut across with gravity, with altitude
    if (geo.aa < 100 * DEG && geo.range > 1200 && geo.range < 3000 && geo.closure < -30 && geo.ata > 40 * DEG && V < corner && agl > sk.deck + 3000) {
      setMode('yoyo-low', 2.5 + rng()); return;
    }
    // slow, close, neutral, crossing: scissors
    if (geo.situation === 'neutral' && geo.range < 900 && geo.hca > 100 * DEG && V < corner * 0.85) { setMode('scissors'); return; }
    // pursuit geometry by range / aspect. Turn-circle thinking (skilled pilots): in front of the bandit's 3–9 line, fly
    // to its tail instead of pointing at it (that only buys another head-on pass); rookies point their nose at it.
    // Behind it: fly to the control zone (lag) while the aspect or closure is wrong, pure to close, lead only to shoot
    const circle = skill > 0.4 || (skill > 0.3 && personality === 'turn');
    if (geo.range > 4000) setMode('pursuit', 0, geo.aa > 50 * DEG ? 'lead' : 'pure');
    else if (circle && geo.aa > 95 * DEG && geo.range > 400) setMode('pursuit', 0, 'tail');
    else if (geo.aa < 100 * DEG && circle) {
      // far behind and not closing: lead cuts across the circle; close with closure or aspect: lag; else pure / lead
      // outside the control zone: fly to it (the bandit's trail); inside: pure to close, lead to shoot
      const inZone = geo.range < 950 && geo.aa < 45 * DEG;
      const running = geo.aa < 50 * DEG && (geo.closure < 0 || (T.state.gLoad || 1) < 2.2);   // straight or running away: point at it
      const sub = running ? (geo.range > 1500 ? 'lead' : 'pure') : !inZone ? (geo.ata > 60 * DEG ? 'pure' : 'zone') : geo.range > sk.gunIdeal * 1.6 && geo.closure < 20 ? 'pure' : 'lead';
      setMode('pursuit', 0, sub);
    }
    else if (geo.range < 900 && geo.closure > 25) setMode('pursuit', 0, 'lag');
    else setMode('pursuit', 0, geo.ata > 12 * DEG ? 'lead' : 'pure');
  }

  /** Occasional human mistakes while fighting (rolled every think, attacking or defending). */
  function rollMistake(T) {
    if (mistakeT > 0) return;
    mistake = '';
    const defending = pilot.mode === 'break' || pilot.mode === 'jink' || pilot.mode === 'split-s';
    // poor pilots under pressure make more mistakes (the opening a human attacker can use)
    if (!T || rng() >= sk.mistake * (defending ? 2.2 : 1)) return;
    const r = rng();
    if (defending) mistake = r < 0.6 ? 'relax' : 'fixate';           // eases the pull / keeps looking at the wrong thing
    else mistake = r < 0.35 && geo.ata > 60 * DEG ? 'lost' : r < 0.55 ? 'slow' : r < 0.8 ? 'overshoot' : 'fixate';
    mistakeT = 2 + 3 * rng();
    if (mistake === 'lost') { lostSightT = mistakeT; lastKnown.copy(T.state.position); }
  }

  function setMode(m, lock = 0, sub = '') {
    if (pilot.mode !== m) { pilot.mode = m; manT = lock; if (lock) lockMan = lock; onEnter(m); }
    pilot.sub = sub;
  }
  function onEnter(m) {
    if (m === 'jink') jinkT = 0;
    if (m === 'extend') extendT = 0;
    if (m === 'vertical') manDir.set(e.forward.x, 0, e.forward.z).normalize();
    if (m === 'defend-missile') defendSide = 0;
  }

  // =====================================================================================================  act
  function act(dt) {
    const s = e.state, T = e.target && e.target.alive ? e.target : null;
    const corner = prof.corner;
    want.spd = corner + 30;
    switch (pilot.mode) {
      case 'pursuit': case 'guns': case 'yoyo-high': case 'yoyo-low': case 'lag-roll': case 'scissors': case 'merge': case 'vertical':
        if (!T) { cruise(); break; }
        bfm(dt, T); break;
      case 'break': doBreak(); break;
      case 'jink': doJink(dt); break;
      case 'split-s': doSplitS(); break;
      case 'extend': doExtend(T); break;
      case 'defend-missile': if (missile && missile.alive) defendMissile(dt); else { pilot.mode = 'cruise'; cruise(); } break;
      case 'bugout': doFlee(true); break;
      case 'flee': doFlee(false); break;
      case 'passive': doPassive(dt); break;
      case 'formation': doFormation(); break;
      case 'orbit': doOrbit(); break;
      case 'patrol': doPatrol(); break;
      case 'intercept': doIntercept(); break;
      case 'hold': doHold(); break;
      default: cruise();
    }
    // flares against a close IR missile even outside the defensive manoeuvre (and by passive aircraft)
    // timed flare pairs against a seen IR missile (each rejected flare makes the next one weaker: no spamming)
    if (missile && missile.alive) {
      missileTgo = liveTgo(missile, -1);
      const q = missileSlot;
      if (q && q.flareAt > 0 && q.flares < sk.flarePairs + (q.flareAt > 4 ? 2 : 0) && missileTgo < q.flareAt && missileTgo > 0.25 && combat.clock >= q.flareNext) {
        if (combat.weapons?.dropFlares?.(e)) { q.flares++; q.flareNext = combat.clock + sk.flareGap * (0.8 + 0.4 * rng()); }
      }
    }
  }

  // ---- shared speed rule while fighting: close the range, keep corner speed, avoid overshoots
  function fightSpeed(T) {
    const corner = prof.corner + sk.speedBias;
    let v;
    if (geo.range > 4000) v = Math.max(corner + 70, (T.state.ias || 0) + 50);
    else if (geo.range > 1300 || geo.aa > 100 * DEG) v = clamp((T.state.ias || 0) + (geo.range - 650) * 0.05 - geo.closure * 0.15, corner * lerp(0.8, 1.02, skill), corner + 110);
    else if (geo.range > 700) v = clamp((T.state.ias || 0) + (geo.range - sk.gunIdeal) * 0.08 - geo.closure * lerp(0.2, 0.5, skill), corner * lerp(0.7, 0.85, skill), corner + 60);
    else v = clamp((T.state.ias || 0) + (geo.range - sk.gunIdeal) * 0.1 - geo.closure * lerp(0.3, 0.6, skill), corner * lerp(0.6, 0.8, skill), corner + 40);
    // turning fight (nose well off the bandit): fly corner speed, the best turn rate; poor pilots drift off it
    if (geo.ata > 40 * DEG && geo.range < 4000) v = prof.corner + sk.speedBias * 0.5 + (1 - skill) * 35;
    if (mistake === 'slow') v -= 40;
    return clamp(v, prof.stall * 1.5, Math.min(prof.vmo * 0.9, corner + 160));
  }

  function bfm(dt, T) {
    const s = e.state;
    classify(e, T, geo);
    const gHard = gFight * (pilot.mode === 'guns' ? 1 : lerp(0.8, 1, sk.precision));
    want.g = gHard; want.gain = lerp(1.2, 2.0, sk.precision);
    want.spd = fightSpeed(T);
    want.ab = want.spd > s.ias + 12;
    switch (pilot.mode) {
      case 'guns': guns(dt, T); return;
      case 'pursuit': {
        if (pilot.sub === 'lost') { aimAt(lastKnown); want.g = gHard * 0.7; return; }
        if (pilot.sub === 'tail') {
          // aim at a point well behind the bandit on its flight path (its turn circle), toward its six
          pursuitPoint(e, T, 'lag', aim, 2.2);
          aimAt(aim); want.g = gHard; want.spd = prof.corner + sk.speedBias * 0.5;
          energyTilt(want.spd);
          return;
        }
        if (pilot.sub === 'zone') {
          // the bandit's position ~2 s ago on its turn: behind it, inside its circle
          const sv = Math.max(T.state.velocity.length(), 60), tz = clamp(Math.max(geo.range * 0.45, sk.gunIdeal + 150) / sv, 1.2, 4);
          pursuitPoint(e, T, 'trail', aim, tz);
          const dz = aim.distanceTo(s.position);
          aimAt(aim);
          want.spd = clamp(T.state.ias + (dz - 300) * 0.06, prof.corner * 0.8, prof.corner + 80);
          want.ab = want.spd > s.ias + 10;
          // no point bleeding below the bandit's speed to point at its trail: keep the energy, it will come round
          if (skill > 0.35) want.g = Math.min(want.g, gHard * clamp(s.ias / want.spd, 0.55, 1) ** 2);
        } else pursuitPoint(e, T, pilot.sub || 'pure', aim, 1);
        if (pilot.sub !== 'zone') aimAt(aim);
        energyTilt(prof.corner + sk.speedBias * 0.5);
        // slow: a skilled pilot eases the pull (max AoA at low speed only bleeds more) and unloads to get the speed back
        // slow: a skilled pilot eases the pull (max AoA at low speed only bleeds more) and unloads to get the speed back
        { const vs = prof.corner * 0.72, v = s.ias;
          if (v < vs && skill > 0.3 && mistake !== 'slow') want.g = Math.min(want.g, Math.max(1.3, gHard * (v / vs) ** (2 + 3 * skill))); }
        snapshot(dt, T);
        if ((pilot.sub === 'lead' || pilot.sub === 'pure') && T.state.acceleration && geo.range < 3000) { want.ff.copy(T.state.acceleration).multiplyScalar(pilot.sub === 'lead' ? 0.7 : 0.4); want.useFF = true; }
        // radar crank: own radar missile in flight and the target still far: hold it near the edge of the radar cone
        if (geo.range > 7000 && ownMissileInFlight(T, 'radar')) crank(T);
        return;
      }
      case 'yoyo-high': {
        // out of the plane, above the bandit's turn: trade speed for altitude, then back down behind it
        pursuitPoint(e, T, 'lag', aim, 1);
        aim.addScaledVector(UP, clamp(geo.range * 0.6, 300, 900) * clamp(manT / 2, 0, 1));
        aimAt(aim); want.spd = T.state.ias - 20; want.ab = false;
        if (manT <= 0) pilot.mode = 'pursuit';
        return;
      }
      case 'lag-roll': {
        // lag displacement roll: go to the outside / above of the bandit's turn, then fall in behind
        pursuitPoint(e, T, 'lag', aim, 1.4);
        A.copy(T.up).multiplyScalar(-1).addScaledVector(UP, 1.2).normalize();
        aim.addScaledVector(A, clamp(geo.range * 0.4, 150, 500));
        aimAt(aim); want.spd = T.state.ias - 30; want.ab = false; want.brake = true;
        if (manT <= 0) pilot.mode = 'pursuit';
        return;
      }
      case 'yoyo-low': {
        // drop the nose inside the bandit's turn to gain speed and cut across, then pull back up into lead
        pursuitPoint(e, T, 'lead', aim, 1.2);
        aim.addScaledVector(UP, -clamp(geo.range * 0.35, 250, 700) * clamp(manT / 2, 0, 1));
        aimAt(aim); want.spd = prof.corner + 60; want.ab = true;
        if (manT <= 0) pilot.mode = 'pursuit';
        return;
      }
      case 'scissors': {
        // slow and close: reverse toward the bandit every time it crosses, bleed speed to make it overshoot
        pursuitPoint(e, T, 'pure', aim, 1);
        aim.addScaledVector(UP, 80);
        aimAt(aim); want.spd = Math.max(prof.stall * 1.45, prof.corner * 0.55); want.ab = s.ias < prof.stall * 1.6; want.brake = true;
        return;
      }
      case 'merge': { merge(T); return; }
      case 'vertical': {
        // zoom, then pull over the top toward the bandit (Immelmann-style re-attack); stop if slow
        if (s.pitch < 1.0 && manT > 2.5) { A.copy(manDir).multiplyScalar(0.5).add(UP).normalize(); want.dir.copy(A); want.g = gHard; want.gain = 2; }
        else { pursuitPoint(e, T, 'lead', aim, 1); aimAt(aim); }
        want.spd = prof.corner + 80; want.ab = true;
        if (manT <= 0 || s.ias < prof.corner * 0.65) pilot.mode = 'pursuit';
        return;
      }
      default: pursuitPoint(e, T, 'pure', aim, 1); aimAt(aim);
    }
  }

  // energy plane: when fast, tilt the turn up out of the horizontal (trade the excess speed for height and turn
  // rate instead of spiralling nose-low to the floor); when slow with height to spare, let the nose fall. Skilled
  // pilots do this much more than poor ones
  function energyTilt(vT) {
    // fast and pointing down: flatten the turn (no nose-low spiral to the floor); low: pull it above the horizon.
    // Slow: do not chase the bandit uphill beyond the climb angle the speed can pay for. Poor pilots do neither
    const dv = e.state.ias - vT, agl = aglAt(), d = want.dir, h = Math.hypot(d.x, d.z);
    if (h < 0.05 || skill < 0.3) return;
    const w = clamp((skill - 0.3) / 0.5, 0, 1);
    let el = Math.asin(clamp(d.y, -1, 1));
    // the dive allowed shrinks to nothing as the speed rises past the fight speed (above the bandit = energy)
    if (el < 0) el = Math.max(el, -lerp(1.2, 0.05, w * clamp((dv + 30) / 40, 0, 1)));
    if (dv > 0 && agl < sk.deck + 1500) el = Math.max(el, 0.25 * w);
    el = Math.min(el, lerp(1.4, lerp(0.1, 1.2, clamp((e.state.ias / prof.corner - 0.55) / 0.45, 0, 1)), w));
    const k = Math.cos(el) / h;
    d.x *= k; d.z *= k; d.y = Math.sin(el);
  }
  function aimAt(p) { want.dir.copy(p).sub(e.state.position); const l = want.dir.length(); if (l > 1e-3) want.dir.multiplyScalar(1 / l); else want.dir.copy(e.forward); }

  function ownMissileInFlight(T, type) {
    const W = combat.weapons;
    for (const m of W.missiles) if (m.owner === e && m.target === T && (m.spec?.seeker || m.type) === type) return true;
    return false;
  }

  function crank(T) {
    // fly ~40° off the target in the horizontal plane (side we are already turning to)
    A.copy(T.state.position).sub(e.state.position); A.y *= 0.3; A.normalize();
    const side = A.dot(e.right) > 0 ? -1 : 1;
    B.crossVectors(UP, A).multiplyScalar(side);          // horizontal perpendicular
    want.dir.copy(A).multiplyScalar(0.77).addScaledVector(B, 0.64).normalize();
    want.useFF = false; pilot.sub = 'crank';
  }

  // ---- gunnery: track the lead-computed aim point with human error, fire short bursts when the solution is good
  function guns(dt, T) {
    const W = combat.weapons, s = e.state;
    W.gunSolution(e, T, SOL);
    const r = SOL.range;
    // tracking error: correlated wander that grows when the target moves fast across the sight
    losFeedForward(e, T, ffv);
    const losRate = ffv.length() / Math.max(s.tas, 50);           // rad/s
    const sig = sk.aimSigma * (1 + lerp(6, 2.5, skill) * losRate) * (mistake === 'lost' ? 3 : 1);
    const a = Math.exp(-dt / sk.aimTau), b = sig * Math.sqrt(1 - a * a);
    aimNX = aimNX * a + b * gauss(); aimNY = aimNY * a + b * gauss();
    const k2 = 1 - Math.exp(-dt / 0.25);                  // smooth the wander (a hand, not white noise)
    aimX += (aimNX - aimX) * k2; aimY += (aimNY - aimY) * k2;
    aim.copy(SOL.point).addScaledVector(e.right, aimX * r).addScaledVector(e.up, aimY * r);
    aimAt(aim);
    if (T.state.acceleration) want.ff.copy(T.state.acceleration); else want.ff.set(0, 0, 0);
    want.useFF = true;
    // steer the velocity vector at the aim point corrected by the (smoothed) nose–velocity offset, so the NOSE ends
    // on the aim point; smoothing keeps the AoA change of the pull from feeding back into the roll
    aimAt(aim);
    D.copy(s.velocity).normalize();
    aoaS += (Math.acos(clamp(D.dot(e.forward), -1, 1)) - aoaS) * Math.min(1, dt / 0.3);
    want.bias = aoaS;
    want.track = true; want.kp = lerp(1.8, 2.6, sk.precision); want.kd = 0.6;
    if (!fc.trackValid) { D.copy(T.state.position).sub(s.position); E.copy(T.state.velocity).sub(s.velocity); want.w0.crossVectors(D, E).multiplyScalar(1 / Math.max(D.lengthSq(), 100)); }
    // closure control in the gun envelope
    want.spd = clamp(T.state.ias + (r - sk.gunIdeal) * 0.08 - geo.closure * 0.4, Math.max(prof.stall * 1.4, prof.corner * (r < 900 ? lerp(0.55, 0.75, skill) : lerp(0.6, 1.0, skill))), Math.max(prof.corner + 30, T.state.ias + 45));
    want.ab = want.spd > s.ias + 20; want.brake = true;
    if (r < 180 && geo.closure > 0) { pursuitPoint(e, T, 'lag', aim, 1); aimAt(aim); want.useFF = false; want.track = false; }
    // fire control
    A.copy(SOL.point).sub(s.position).normalize();
    const err = Math.acos(clamp(A.dot(e.forward), -1, 1));
    gunErrS += (err - gunErrS) * Math.min(1, dt / 0.6);
    const tol = sk.fireTol + (T.radius || 5) / Math.max(r, 50);
    const good = err < tol && r < sk.gunMax * (losRate < 0.05 && geo.aa < 40 * DEG ? 1.35 : 1) && SOL.inRange !== false && geo.aa < sk.headOnGuns && e.loadout?.gun?.rounds !== 0 && !friendlyInLine(T, r);
    { const g = gunDbg; g.err = err; g.tol = tol; g.r = r; g.good = good; g.losRate = losRate; }
    // the bandit's manoeuvre steady for a moment (its acceleration close to its recent mean)? Skilled pilots only
    // saddle up for a tracking burst then; during jinks they take snapshots as the pipper crosses
    const ta = T.state.acceleration;
    if (ta) { const dev = C.copy(ta).sub(tAccS).length() / Math.max(ta.length(), 25); tAccS.lerp(ta, Math.min(1, dt / 0.5)); planeT = dev < 0.35 ? planeT + dt : 0; } else planeT += dt;
    const steady = planeT > lerp(0, 0.6, skill);
    settleT = good && steady ? settleT + dt : 0;
    gapT -= dt;
    if (burstT > 0) {
      burstT -= dt; want.fire = good || err < tol * lerp(2.5, 1.25, skill);
      if (burstT <= 0) gapT = lerp(sk.burstGap[0], sk.burstGap[1], rng());
    } else if (good && settleT > sk.settle && gapT <= 0) {
      burstT = lerp(sk.burst[0], sk.burst[1], rng()); want.fire = true;
    } else if (gapT <= 0 && err < tol * lerp(2.2, 1.3, skill) && err < prevGunErr && r < sk.gunMax * 0.8 && geo.aa < sk.headOnGuns && e.loadout?.gun?.rounds !== 0 && !friendlyInLine(T, r)) {
      // snapshot: the pipper sweeps through the target while we can't track it: a short burst as it passes
      burstT = lerp(0.25, 0.45, rng()); want.fire = true;
    }
    prevGunErr = err;
  }

  // snapshot from a pursuit (no tracking): a short burst as the lead point sweeps through the nose, close in
  function snapshot(dt, T) {
    gapT -= dt;
    if (burstT > 0) { burstT -= dt; want.fire = true; if (burstT <= 0) gapT = lerp(sk.burstGap[0], sk.burstGap[1], rng()); return; }
    if (geo.range > sk.gunMax * 0.8 || geo.ata > 0.25 || geo.aa > sk.headOnGuns || e.loadout?.gun?.rounds === 0 || !combat.weapons) { prevGunErr = 9; return; }
    combat.weapons.gunSolution(e, T, SOL);
    A.copy(SOL.point).sub(e.state.position).normalize();
    const err = Math.acos(clamp(A.dot(e.forward), -1, 1)), tol = sk.fireTol + (T.radius || 5) / Math.max(SOL.range, 50);
    if (gapT <= 0 && err < tol * 1.6 && err < prevGunErr && SOL.inRange !== false && !friendlyInLine(T, SOL.range)) {
      burstT = lerp(0.2, 0.4, rng()); want.fire = true;
    }
    prevGunErr = err;
  }

  function friendlyInLine(T, r) {
    combat.world.friendsOf(e, friends);
    const p = e.state.position;
    for (let i = 0; i < friends.length; i++) {
      const f = friends[i];
      B.copy(f.state.position).sub(p);
      const d = B.length();
      if (d > r + 400 || d < 1) continue;
      if (B.dot(e.forward) / d > Math.cos(Math.max(0.06, 60 / d))) return true;
    }
    return false;
  }

  function merge(T) {
    const s = e.state;
    const myR = turnRadius(Math.max(s.tas, 60), gFight);
    const passing = geo.range < myR * 1.3 || geo.ata > 50 * DEG;
    if (!passing) {
      // offset the pass by ~350 m to the bandit's side (no head-on guns, no collisions), lead-turn as it closes
      A.copy(T.state.position).addScaledVector(e.right, manSide * 350);
      aimAt(A);
      want.spd = prof.corner + sk.speedBias + 30; want.g = 4; pilot.sub = 'pass';
    } else {
      // after the pass: two-circle = turn toward the bandit's side, one-circle = away from it
      const dirSide = manChoice === 'two-circle' ? manSide : -manSide;
      B.set(e.forward.x, 0, e.forward.z).normalize();
      C.crossVectors(B, UP).multiplyScalar(dirSide);             // horizontal right (dirSide=+1) / left
      want.dir.copy(B).multiplyScalar(-0.35).add(C).addScaledVector(UP, personality === 'energy' ? 0.45 : 0.1).normalize();
      want.g = gFight; want.spd = prof.corner; pilot.sub = manChoice;
      if (geo.ata < 60 * DEG && geo.range > 600 || manT < 6) { pilot.mode = 'pursuit'; lockMan = 0; }
    }
  }

  // ---- defensive manoeuvres
  function doBreak() {
    const s = e.state, X = attacker && attacker.alive ? attacker : e.target;
    want.g = gFight; want.gain = 2.4; want.spd = prof.corner; want.ab = true; want.brake = false;
    if (!X) { cruise(); return; }
    // put the lift vector on the attacker and pull: turn into him
    A.copy(X.state.position).sub(s.position);
    const r = A.length(); A.multiplyScalar(1 / Math.max(r, 1));
    if (A.dot(e.forward) < -0.95) {
      // dead astern: break in the direction we are already banked
      B.set(e.forward.x, 0, e.forward.z).normalize();
      C.crossVectors(B, UP).multiplyScalar(s.roll >= 0 ? 1 : -1);
      A.copy(C).addScaledVector(B, -0.3).addScaledVector(UP, -0.1).normalize();
    }
    want.dir.copy(A);
    if (classify(e, X, ageo).threatAta > 70 * DEG && pilot.mode === 'break' && ageo.range > 600) thinkT = Math.min(thinkT, 0.05);
  }

  function doJink(dt) {
    const s = e.state;
    want.direct = true; want.spd = prof.corner + 10; want.ab = true; want.brake = false;
    if ((jinkT -= dt) <= 0) {
      jinkT = lerp(sk.jinkGap[0], sk.jinkGap[1], rng());
      // a new, unpredictable plane: roll 60–150° either way from where we are and pull hard (sometimes unload)
      const d = (60 + 90 * rng()) * DEG * (rng() < 0.5 ? -1 : 1);
      jinkBank = s.roll + d; jinkNz = rng() < 0.15 ? 0.5 : gFight * (0.75 + 0.25 * rng());
    }
    // keep the jink sane near the ground: never roll the lift vector below the horizon there
    const agl = aglAt();
    let bank = jinkBank;
    if (agl < sk.deck + 1500) bank = clamp(((bank + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI, -1.3, 1.3);
    want.nz = jinkNz; want.bank = bank; want.g = gFight;
  }

  function doSplitS() {
    const s = e.state;
    // roll inverted and pull through the vertical, exit the other way
    A.copy(manDir).multiplyScalar(-0.7).addScaledVector(UP, -0.7).normalize();
    want.dir.copy(A); want.g = gFight; want.gain = 2.2; want.spd = prof.corner; want.ab = false; want.brake = true;
    if (e.forward.dot(manDir) < -0.5 && s.pitch > -0.5) { pilot.mode = 'break'; lockMan = 0; }
    if (manT <= 0) { pilot.mode = 'break'; lockMan = 0; }
  }

  function doExtend(T) {
    const s = e.state;
    // unload, run away from the nearest threat, afterburner; a shallow dive buys speed when there is room
    const X = attacker && attacker.alive ? attacker : T;
    if (X) { A.copy(s.position).sub(X.state.position); A.y = 0; A.normalize(); } else A.set(e.forward.x, 0, e.forward.z).normalize();
    const agl = aglAt();
    A.y = agl > sk.deck + 2000 ? -0.12 : agl < sk.deck + 600 ? 0.12 : 0;
    want.dir.copy(A).normalize(); want.g = 3; want.gain = 1.2;
    want.spd = prof.vmo; want.ab = true; want.brake = false;
    const r = X ? X.state.position.distanceTo(s.position) : 1e9;
    if ((s.ias > prof.corner + 40 && r > 3500) || manT <= 0) { pilot.mode = 'pursuit'; lockMan = 0; pilot.sub = 'reattack'; }
  }

  function defendMissile(dt) {
    const s = e.state, m = missile;
    const seeker = m.spec?.seeker || m.type || 'ir';
    A.copy(m.state.position).sub(s.position);
    const r = A.length(); A.multiplyScalar(1 / Math.max(r, 1));      // LOS to the missile
    want.g = gFight; want.gain = 2.2; want.brake = false;
    const q = sk.defendQuality;
    if (missileTgo < (missileSlot ? missileSlot.breakAt : sk.breakTgo)) {
      // last-ditch break: max G perpendicular to the missile's velocity, the way needing the least roll
      B.copy(m.state.velocity).normalize();
      C.copy(e.up).addScaledVector(B, -e.up.dot(B));
      if (C.lengthSq() < 1e-4) C.crossVectors(B, UP);
      C.normalize();
      want.dir.copy(s.velocity).normalize().addScaledVector(C, 3).normalize();
      want.g = prof.fbw ? prof.fcsNzMax : prof.gMax * 0.9; want.gain = 4;
      want.spd = prof.corner; want.ab = seeker === 'radar';
      pilot.sub = 'break';
      return;
    }
    // horizontal LOS and its perpendiculars
    B.copy(A); B.y = 0; if (B.lengthSq() < 1e-6) B.set(e.forward.x, 0, e.forward.z); B.normalize();
    if (!defendSide) { C.crossVectors(B, UP); defendSide = C.dot(e.forward) >= 0 ? 1 : -1; }
    C.crossVectors(B, UP).multiplyScalar(defendSide);          // beam direction (missile at 3 or 9 o'clock)
    const agl = aglAt(), q2 = missileSlot;
    // radar plan, chosen once per missile: drag it out of energy when it comes from far, otherwise beam / notch
    if (q2 && !q2.plan) q2.plan = seeker === 'radar' && (r > 15000 || missileTgo > 22) && rng() < 0.4 + 0.6 * q ? 'drag' : 'beam';
    const plan = q2?.plan || 'beam';
    if (seeker === 'radar' && plan === 'drag' && missileTgo > 6) {
      // drag: turn the tail to it and run (kinematic defeat), descend to thicker air
      want.dir.copy(B).multiplyScalar(-1); want.dir.y = agl > sk.deck + 1500 ? -0.15 : 0;
      want.dir.normalize(); want.spd = prof.vmo; want.ab = true; want.g = Math.min(gFight, 5); pilot.sub = 'drag';
    } else if (seeker === 'radar') {
      // notch: put the missile exactly on the wing line (no closing speed for its doppler) and go low into the clutter;
      // keep the speed for the last-ditch break (5 g, afterburner)
      want.dir.copy(C).addScaledVector(B, 0.05); want.dir.y = agl > sk.deck + 900 ? -clamp((agl - sk.deck) / 4000, 0.12, 0.5) * q : 0.03;
      want.dir.normalize(); want.spd = prof.corner + 60; want.ab = true; want.g = Math.min(gFight, lerp(7, 5, q)); pilot.sub = 'notch';
    } else {
      // IR: beam and pull the throttle back out of afterburner (less heat), flares come from the timed plan in act()
      want.dir.copy(C).addScaledVector(B, -0.25 * q); want.dir.y = agl > sk.deck + 1200 ? -0.12 * q : 0.05;
      want.dir.normalize(); want.spd = Math.min(prof.corner + 40, s.ias); want.ab = false; want.minLever = 0;
      want.g = Math.min(gFight, lerp(7.5, 5.5, q)); pilot.sub = 'beam';
    }
  }

  function doFlee(damaged) {
    const s = e.state;
    // run on the ordered heading (or home / away from the nearest enemy) at full speed; defend if attacked (decide())
    if (order.heading != null && !damaged) headingVec(order.heading, A);
    else {
      const X = combat.world.nearestEnemy(e, 30000);
      if (X) { A.copy(s.position).sub(X.state.position); A.y = 0; A.normalize(); }
      else if (order.home || order.base) { A.copy(order.home || order.base).sub(s.position); A.y = 0; A.normalize(); }
      else A.copy(home).sub(s.position).setY(0).normalize();
      if (A.lengthSq() < 0.5) A.set(e.forward.x, 0, e.forward.z).normalize();
    }
    holdAlt(A, order.alt ?? Math.max(s.position.y, ground(s.position.x, s.position.z) + 1200));
    want.g = 3; want.spd = damaged ? prof.corner + 40 : Math.min(prof.vmo * 0.9, prof.corner + 150); want.ab = !damaged || hpFrac() > 0.2;
    if (damaged && !maydaySent && hpFrac() < 0.3) { maydaySent = true; call('mayday', null, true); }
  }

  function doPassive(dt) {
    const s = e.state;
    // fly the route; when threatened, gentle jinks and flares (transport / bomber targets)
    if (order.waypoints?.length) routeStep(); else if (order.type === 'orbit') doOrbit(); else cruise();
    const threatened = !!missile || (attacker && ageo.range < 2500);
    if (threatened) {
      if ((jinkT -= dt) <= 0) { jinkT = 2 + 2 * rng(); jinkBank = (rng() < 0.5 ? -1 : 1) * (20 + 25 * rng()) * DEG; }
      want.direct = true; want.bank = jinkBank; want.nz = prof.heavy ? 1.3 : 2; want.g = prof.heavy ? 1.6 : 3;
      pilot.sub = 'evade';
      if ((flareT -= dt) <= 0) { combat.weapons?.dropFlares?.(e); flareT = 1.2 + rng(); }
    } else pilot.sub = '';
  }

  // ---- orders
  function holdAlt(hdir, alt) {
    const s = e.state;
    const err = alt - s.position.y;
    const gmax = prof.heavy ? 0.12 : 0.3;
    const gam = clamp(err * 0.004, -gmax, gmax);
    want.dir.set(hdir.x, 0, hdir.z).normalize().multiplyScalar(Math.cos(gam)); want.dir.y = Math.sin(gam);
    want.g = prof.heavy ? 1.5 : 3; want.gain = 0.9;
  }
  function cruise() {
    const s = e.state;
    const hdg = order.heading != null ? order.heading : null;
    if (hdg != null) headingVec(hdg, A); else A.set(e.forward.x, 0, e.forward.z).normalize();
    holdAlt(A, order.alt ?? Math.max(s.position.y, ground(s.position.x, s.position.z) + 1000));
    want.spd = order.speed ?? (prof.heavy ? Math.min(prof.vmo * 0.8, (e.def?.specs?.cruiseSpeed || 200) * 0.75) : prof.corner + 20);
    want.ab = false;
    if (pilot.mode === 'cruise') pilot.sub = '';
  }
  function routeStep() {
    const s = e.state, wps = order.waypoints;
    const i = (order.index || 0) % wps.length, wp = wps[i];
    A.copy(wp).sub(s.position); A.y = 0;
    const d = A.length();
    if (d < (order.radius ?? 1500)) { order.index = order.loop === false ? Math.min(i + 1, wps.length - 1) : (i + 1) % wps.length; }
    if (d > 1) A.multiplyScalar(1 / d);
    holdAlt(A, order.alt ?? (wp.y > 50 ? wp.y : s.position.y));
    want.spd = order.speed ?? (prof.heavy ? Math.min(prof.vmo * 0.8, (e.def?.specs?.cruiseSpeed || 200) * 0.75) : prof.corner + 10);
    want.ab = false;
  }
  /** Nothing to fight on an engage order: the player bot flies to the mission steer point, everybody else holds an
   *  orbit over the start of the fight instead of flying off the map. */
  function doHold() {
    const w = e.isPlayer ? combat.director?.waypoint : null;
    if (w && w.position) {
      A.copy(w.position).sub(e.state.position); A.y = 0;
      if (A.lengthSq() > 2500 * 2500) {
        holdAlt(A.normalize(), Math.max(w.position.y > 100 ? w.position.y : e.state.position.y, ground(e.state.position.x, e.state.position.z) + 1500));
        want.spd = prof.corner + 40; want.ab = false; pilot.sub = 'steer';
        return;
      }
    }
    if (!holdSet) { holdSet = true; orbitC.copy(e.isPlayer ? home : e.state.position); }
    const c = orbitC, R = 5000;
    A.copy(e.state.position).sub(c); A.y = 0;
    const d = Math.max(A.length(), 1); A.multiplyScalar(1 / d);
    B.set(-A.z, 0, A.x).addScaledVector(A, -clamp((d - R) / R, -1, 1) * 1.2).normalize();
    holdAlt(B, Math.max(e.state.position.y, ground(e.state.position.x, e.state.position.z) + 1500));
    want.spd = prof.corner; want.ab = false; pilot.sub = 'orbit';
  }
  function doPatrol() { if (order.waypoints?.length) routeStep(); else doOrbit(); }
  function doOrbit() {
    const s = e.state;
    const c = order.center || orbitC, R = order.radius ?? 6000;
    A.copy(s.position).sub(c); A.y = 0;
    const d = Math.max(A.length(), 1); A.multiplyScalar(1 / d);
    const cw = order.clockwise !== false ? 1 : -1;
    B.set(-A.z * cw, 0, A.x * cw);                          // tangent
    B.addScaledVector(A, -clamp((d - R) / R, -1, 1) * 1.2).normalize();
    holdAlt(B, order.alt ?? (c.y > 50 ? c.y : s.position.y));
    want.spd = order.speed ?? (prof.heavy ? Math.min(prof.vmo * 0.75, (e.def?.specs?.cruiseSpeed || 200) * 0.7) : prof.corner);
    want.ab = false;
  }
  function doIntercept() {
    const s = e.state, T = order.target;
    if (!T || !T.alive) { cruise(); return; }
    interceptPoint(s.position, Math.max(s.tas, 200), T.state.position, T.state.velocity, A);
    A.sub(s.position);
    holdAlt(A, Math.max(T.state.position.y, ground(s.position.x, s.position.z) + 600));
    want.spd = Math.min(prof.vmo * 0.92, prof.corner + 160); want.ab = true;
  }
  function doFormation() {
    const s = e.state, L = order.leader;
    if (!L || !L.alive) { cruise(); return; }
    resolveOffset(order.offset, off);
    formationSlot(L, off, slot);
    A.copy(slot).sub(s.position);                           // position error
    const dist = A.length();
    const lv = L.state.velocity;
    if (dist > 4000) {
      // far: intercept the slot fast
      interceptPoint(s.position, Math.max(s.tas + 60, 220), slot, lv, B);
      aimAt(B); want.g = 4; want.spd = Math.min(prof.vmo * 0.9, (L.state.ias || 200) + 120); want.ab = true;
      pilot.sub = 'rejoin';
      return;
    }
    // station keeping: desired velocity = leader's velocity + a correction toward the slot (gentle, saturating)
    const k = dist > 600 ? 0.12 : 0.22;
    B.copy(A).multiplyScalar(k);
    const cmax = dist > 600 ? 80 : 35;
    if (B.length() > cmax) B.setLength(cmax);
    B.add(lv);
    const vs = B.length();
    want.dir.copy(B).multiplyScalar(1 / Math.max(vs, 1));
    want.g = prof.heavy ? 1.6 : 4; want.gain = dist < 300 ? 1.6 : 1.1;
    const ratio = s.tas > 1 ? s.ias / s.tas : 1;
    want.spd = vs * ratio;
    want.ab = want.spd > s.ias + 25; want.brake = want.spd < s.ias - 25;
    pilot.sub = dist < 150 ? 'on-station' : 'join';
  }

  // =====================================================================================================  guard
  // Survival layer: collision avoidance, terrain floor, hard terrain recovery, stall, overspeed. Always wins.
  function guard(dt) {
    const s = e.state, p = s.position;
    const V = Math.max(s.tas, 30);
    // ---- mid-air collision avoidance
    const air = combat.world.aircraft;
    for (let i = 0; i < air.length; i++) {
      const x = air[i];
      if (x === e || !x.state) continue;
      const d2 = x.state.position.distanceToSquared(p);
      if (d2 > 1200 * 1200) continue;
      closestApproach(p, s.velocity, x.state.position, x.state.velocity, CA);
      const mate = x.team === e.team, station = pilot.mode === 'formation' && pilot.sub === 'on-station';
      const sep = (e.radius || 5) + (x.radius || 5) + (station ? 20 : mate ? 70 : 35);
      const dNow = Math.sqrt(d2);
      if ((CA.t > 0 && CA.t < (mate ? 3.5 : 2.5) && CA.miss < sep && dNow - CA.miss > 8) || dNow < sep * 0.5) {
        // turn away from the other aircraft's position at closest approach, preferring up
        A.copy(x.state.position).addScaledVector(x.state.velocity, CA.t).sub(B.copy(p).addScaledVector(s.velocity, CA.t));
        A.multiplyScalar(-1);
        if (A.lengthSq() < 1) A.copy(e.up);
        A.normalize().addScaledVector(UP, 0.4).normalize();
        want.direct = false; want.track = false; want.dir.copy(s.velocity).normalize().addScaledVector(A, 1.5).normalize();
        want.g = Math.max(want.g, Math.min(5, gFight)); want.gain = 3; want.useFF = false; want.fire = false;
        break;
      }
    }
    // ---- soft floor: terrain ahead + hard deck. Limits the dive angle to what can still be recovered above the deck
    // (altitude lost pulling out of a dive γ at load factor n: R·(1 − cos γ), R = V²/(g(n−1)), plus the roll-upright time)
    if ((floorT -= dt) <= 0) {
      floorT = 0.25;
      const hd = s.velocity.x * s.velocity.x + s.velocity.z * s.velocity.z > 100 ? Math.atan2(s.velocity.x, -s.velocity.z) : s.heading;
      for (let i = 0; i < DISTS.length; i++) DISTS[i] = FRAC[i] * V * 5;
      floorAlt = terrainAhead(ground, p.x, p.z, hd, DISTS, 0.35);
    }
    {
      const deck = prof.heavy ? 500 : sk.deck;
      const nS = Math.max(1.6, Math.min(gFight * 0.7, prof.heavy ? 1.8 : 6, fc.nzFull * 0.75));
      const R = (V * V) / (G0 * (nS - 1));
      const gamNow = Math.asin(clamp(s.velocity.y / V, -1, 1));
      const rollT = Math.abs(s.roll) > 1.2 ? Math.abs(s.roll) / Math.max(prof.rollRate * 0.7, 0.5) + 0.3 : 0.3;
      const aglA = p.y - floorAlt - deck - 60 + Math.min(s.velocity.y, 0) * rollT;
      const room = aglA / (1.6 * R);
      // lowest flight-path angle allowed now
      const gMin = room <= 0 ? clamp(-room * 0.6, 0.05, 0.35) : room >= 1 ? -1.5 : -Math.acos(1 - room);
      const gWant = Math.asin(clamp(want.dir.y, -1, 1));
      if (gWant < gMin || gamNow < gMin) {
        if (want.direct) { want.direct = false; want.dir.copy(e.forward); }
        want.track = false;
        if (gWant < gMin) {
          const h = Math.hypot(want.dir.x, want.dir.z);
          if (h < 1e-3) { want.dir.x = e.forward.x; want.dir.z = e.forward.z; }
          const hh = Math.hypot(want.dir.x, want.dir.z) || 1;
          want.dir.x *= Math.cos(gMin) / hh; want.dir.z *= Math.cos(gMin) / hh; want.dir.y = Math.sin(gMin);
        }
        if (gamNow < gMin - 0.05) { want.g = Math.max(want.g, nS); want.gain = Math.max(want.gain, 2); want.useFF = false; }
        if (pilot.sub !== 'terrain') pilot.sub = pilot.sub || 'deck';
      }
    }
    // ---- energy discipline: slow in a fight, stop climbing and ease the pull until the speed comes back (rookies
    // notice late). Not while a guns solution is settling
    if (FIGHT_MODES.has(pilot.mode) && !want.direct && !(pilot.mode === 'guns' && gunErrS < 0.08)) {
      const slowF = clamp((prof.stall * 2.1 - s.ias) / (prof.stall * 0.6), 0, 1) * lerp(0.45, 1, skill);
      if (slowF > 0) {
        const yMax = lerp(0.6, -0.12, slowF);
        if (want.dir.y > yMax) {
          const k = Math.sqrt(Math.max(1 - yMax * yMax, 0)) / (Math.hypot(want.dir.x, want.dir.z) || 1);
          if (Math.hypot(want.dir.x, want.dir.z) < 1e-3) { want.dir.x = e.forward.x; want.dir.z = e.forward.z; }
          want.dir.x *= k; want.dir.z *= k; want.dir.y = yMax; want.track = false;
        }
        want.g = Math.min(want.g, lerp(gFight, 3.5, slowF)); want.ab = true; want.brake = false;
        want.spd = Math.max(want.spd, prof.corner);
      }
    }
    // ---- comfort floor: fighters keep the fight off the ground. Below deck + ~2.5 km the lowest flight-path angle
    // the BFM may ask for rises smoothly (to a slight climb at the deck), so fights drift up instead of down
    if (FIGHT_MODES.has(pilot.mode) && !want.direct && !(want.track && p.y - floorAlt - sk.deck > 800)) {
      const h = p.y - floorAlt - (prof.heavy ? 500 : sk.deck);
      if (h < 3500) {
        const gC = lerp(0.12, -0.7, clamp(h / 3500, 0, 1));
        const yC = Math.sin(gC);
        if (want.dir.y < yC) {
          const hh = Math.hypot(want.dir.x, want.dir.z);
          if (hh < 1e-3) { want.dir.x = e.forward.x; want.dir.z = e.forward.z; }
          const k = Math.cos(gC) / (Math.hypot(want.dir.x, want.dir.z) || 1);
          want.dir.x *= k; want.dir.z *= k; want.dir.y = yC; want.track = false;
        }
      }
    }
    // ---- no transonic dashes near the ground: the stick runs out of authority (heavy, conventional jets) and the
    // recovery needs more room than the look-ahead sees
    if (FIGHT_MODES.has(pilot.mode) && p.y - floorAlt < sk.deck + 3000 && s.ias > prof.corner + 70 && s.velocity.y < 20) {
      want.spd = Math.min(want.spd, prof.corner + 50); want.ab = false; want.brake = true;
    }
    // ---- hard terrain recovery (predictive)
    safeT -= dt;
    if (safeT <= 0 || recovering) {
      safeT = 0.1;
      RS.x = p.x; RS.y = p.y - 3; RS.z = p.z; RS.vx = s.velocity.x; RS.vy = s.velocity.y; RS.vz = s.velocity.z; RS.roll = s.roll; RS.psi = s.heading;
      // battle damage: less control authority (G and roll rate) and less thrust → assume a weaker pull, start earlier
      const dm = e.sim?.damage, ctrl = dm ? clamp(dm.ctrl ?? 1, 0.12, 1) : 1, thr = dm ? clamp(dm.thrust ?? 1, 0, 1) : 1;
      const auth = Math.min(1, ctrl * 1.6);                    // the pilot's extra stick recovers some authority
      const nzAvail = Math.min((prof.fbw ? prof.fcsNzMax * 0.95 : prof.gMax * 0.85) * auth, Math.max(1.3, (s.ias / Math.max(prof.stall, 40)) ** 2 * 0.9));
      RP.nz = Math.max(1.2, Math.min(nzAvail, fc.nzFull * 0.9)); RP.rollRate = Math.min(prof.rollRate, 3) * 0.8 * auth; RP.climb = prof.heavy ? 0.15 : thr < 0.6 ? 0.15 : 0.35; RP.turn = 0;
      RP.horizon = clamp(V / 22, 8, 18); RP.dt = 0.35; RP.delay = 0.25; RP.nz *= 0.85;
      predictRecovery(ground, RS, RP, REC);
      const margin = (100 + V * 0.9) * (1 + (1 - auth) * 1.5 + (1 - thr) * 0.5);
      if (REC.clear < margin) {
        if (!recovering) { recovering = true; recT = 0; escTurn = 0; }
        // can a turning escape do better? (mountain ahead)
        if (REC.clear < margin * 0.6) {
          let bestC = REC.clear, bestT = 0;
          for (let k = -1; k <= 1; k += 2) {
            RP.turn = k * 0.22;
            predictRecovery(ground, RS, RP, REC);
            if (REC.clear > bestC + 30) { bestC = REC.clear; bestT = RP.turn; }
          }
          escTurn = bestT;
        }
      } else if (recovering && REC.clear > margin * 1.6 && s.velocity.y > -5) recovering = false;
    }
    if (recovering) {
      recT += dt;
      const hd = Math.hypot(s.velocity.x, s.velocity.z) > 10 ? Math.atan2(s.velocity.x, -s.velocity.z) : s.heading;
      const h = hd + escTurn * 2;
      const climb = prof.heavy ? 0.2 : 0.5;
      want.direct = false; want.useFF = false; want.track = false;
      want.dir.set(Math.sin(h) * Math.cos(climb), Math.sin(climb), -Math.cos(h) * Math.cos(climb));
      want.g = prof.fbw ? prof.fcsNzMax : prof.gMax * 0.85; want.gain = 4;
      // fast: power back and boards out (more speed only adds to the pull-out radius; heavy-stick jets lose authority)
      if (s.ias > prof.corner + 60) { want.spd = prof.corner; want.ab = false; want.brake = true; }
      else { want.spd = prof.vmo; want.ab = true; want.brake = false; }
      want.fire = false;
      pilot.sub = 'terrain';
    }
    // ---- stall / departure
    if ((s.stalled || s.ias < prof.stall * 1.08) && !recovering) {
      want.direct = false; want.useFF = false; want.track = false;
      B.set(e.forward.x, 0, e.forward.z);
      if (B.lengthSq() < 1e-4) B.set(s.velocity.x, 0, s.velocity.z);
      B.normalize(); B.y = s.pitch > 0.6 ? -0.4 : -0.1; B.normalize();
      want.dir.copy(B); want.g = 1.5; want.gain = 0.8;
      want.spd = prof.corner; want.ab = true; want.brake = false;
      if (pilot.mode !== 'stall') pilot.sub = 'stall';
    }
    // ---- overspeed / ceiling
    const mmoMargin = prof.mmo - 0.06;
    if (s.ias > prof.vmo * 0.93 || s.mach > mmoMargin) {
      want.spd = Math.min(want.spd, prof.vmo * 0.85); want.brake = true; want.ab = false;
      if (want.direct) { want.direct = false; want.dir.copy(e.forward); }
      if (want.dir.y < 0.05 && !recovering) { want.dir.y = 0.08; want.dir.normalize(); }
    }
    if (p.y > (prof.heavy ? 12500 : 15000) && want.dir.y > -0.05) { want.dir.y = -0.08; want.dir.normalize(); }
  }

  return pilot;
}
