// Damage model: hit points scaled by toughness, component damage by hit location, progressive smoke → fire → loss of
// control → destruction, mapping onto the flight model (sim.damage), kill credit with assists. Logic only.
import * as THREE from 'three';
import { DAMAGE_TAKEN } from './specs.js';
import { nearestPart } from './hitshape.js';

const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Share of maxHp each part soaks before it is destroyed, and the hp multiplier for hits there. */
export const PARTS = {
  fuselage: { share: 0.9, mult: 1.0, leak: 0.08, fire: 0.025 },
  cockpit: { share: 0.4, mult: 1.15, leak: 0, fire: 0.01, pilot: 0.035 },
  engine: { share: 0.38, mult: 1.15, leak: 0.03, fire: 0.07 },
  wingL: { share: 0.5, mult: 0.75, leak: 0.12, fire: 0.02 },
  wingR: { share: 0.5, mult: 0.75, leak: 0.12, fire: 0.02 },
  tail: { share: 0.35, mult: 0.7, leak: 0, fire: 0.005 },
  hull: { share: 1, mult: 1, leak: 0, fire: 0.03 },
};
const LEAK_RATE = 14;            // kg/s at leak = 1
const ASSIST_SHARE = 0.1, ASSIST_WINDOW = 90;

export function createDamageState(nEngines) {
  const engines = [], engineOut = [];
  for (let i = 0; i < nEngines; i++) { engines.push(0); engineOut.push(false); }
  return { smoke: 0, fire: 0, engineOut, leak: 0, fuelLost: 0, pilot: false,
    parts: { fuselage: 0, cockpit: 0, wingL: 0, wingR: 0, tail: 0, engines } };
}

/**
 * Flight-model degradation from component damage (pure): writes { thrust, ctrl, drag, rollBias, pitchBias, engineOut[] }.
 * thrust: mean health of the engines still running; ctrl: wings, tail, fuselage (hydraulics) and fire; rollBias from
 * asymmetric wing damage (left wing hurt → rolls left); pitchBias from the tail (sign per airframe).
 */
export function simDamageFrom(d, pitchSign, out) {
  const P = d.parts, E = P.engines;
  let sum = 0, n = 0;
  for (let i = 0; i < E.length; i++) {
    const outI = d.engineOut[i];
    if (out.engineOut) out.engineOut[i] = outI;
    if (!outI) { sum += Math.max(0.25, 1 - 0.65 * E[i]); n++; }
  }
  out.thrust = (n ? sum / n : 1) * (1 - 0.25 * d.fire);
  out.ctrl = Math.max(0.12, 1 - 0.32 * (P.wingL + P.wingR) - 0.45 * P.tail - 0.25 * P.fuselage - 0.3 * d.fire);
  out.rollBias = Math.max(-0.6, Math.min(0.6, 0.35 * (P.wingR - P.wingL)));
  out.pitchBias = pitchSign * 0.18 * P.tail;
  out.drag = 0.018 * (P.wingL + P.wingR) + 0.012 * P.fuselage + 0.01 * P.tail;
  return out;
}

export function createDamageModel(combat) {
  const ev = combat.events;
  const tmp = new THREE.Vector3(), qi = new THREE.Quaternion();

  function scratch(e) { return e.wpn || (e.wpn = { ledger: [], pitchSign: combat.rng() < 0.5 ? -1 : 1, shape: null, nearT: -1, fireT: 0 }); }

  /** Difficulty: multiplier on damage `target` takes (the DAMAGE_TAKEN table). */
  function takenMult(t) {
    const d = combat.difficulty || 'veteran';
    const p = combat.world.player;
    if (t.isPlayer) return DAMAGE_TAKEN.player[d] ?? 1;
    if (p && t.team === p.team) return DAMAGE_TAKEN.playerWingman[d] ?? 1;
    return DAMAGE_TAKEN.enemy[d] ?? 1;
  }

  function syncSim(e) {
    const sd = e.sim?.damage; if (!sd || !e.damage?.parts) return;
    if (!sd.engineOut) sd.engineOut = [];
    simDamageFrom(e.damage, scratch(e).pitchSign, sd);
  }

  function credit(t, src, amount) {
    const L = scratch(t).ledger;
    if (!src) return;
    for (let i = 0; i < L.length; i++) if (L[i].src === src) { L[i].amt += amount; L[i].t = combat.clock; return; }
    L.push({ src, amt: amount, t: combat.clock });
  }
  function assistsFor(t, killer) {
    const out = [], L = scratch(t).ledger, min = ASSIST_SHARE * (t.maxHp || 100);
    for (const l of L) if (l.src !== killer && l.amt >= min && combat.clock - l.t < ASSIST_WINDOW && l.src.team !== t.team) out.push(l.src);
    return out;
  }

  function kill(t, src, weapon, info) {
    if (!t.alive) return;
    info.assists = assistsFor(t, src);
    const d = t.damage;
    if (d) { d.smoke = 1; if (!info.disintegrated) d.fire = Math.max(d.fire, 0.75); }
    if (info.disintegrated) t.hidden = true;
    combat.kill(t, src || null, weapon, info);
  }

  function startFire(t, level) {
    const d = t.damage; if (!d) return;
    if (d.fire <= 0) ev.emit('fire:start', { target: t });
    d.fire = Math.max(d.fire, Math.min(1, level));
  }

  function engineOut(t, i) {
    const d = t.damage; if (!d || d.engineOut[i]) return;
    d.engineOut[i] = true;
    ev.emit('engine:out', { target: t, index: i });
  }

  /**
   * Apply `amount` hp of damage. info: { source, weapon, position (world), part, index (engine), blast (true for
   * missiles: spread over parts), noCredit }. Returns the hp actually removed.
   */
  function apply(t, amount, info = {}) {
    if (!t || !t.alive || t.hp == null || !(amount > 0)) return 0;
    const src = info.source || null, weapon = info.weapon || 'gun';
    if (src) { t.lastHitBy = src; t.lastHitWeapon = weapon; }
    t.lastHitT = combat.clock;
    if (t.invulnerable) return 0;
    const w = scratch(t), d = t.damage, rng = combat.rng;
    let part = info.part || null, index = info.index ?? -1;
    if (!part && info.position && w.shape && t.state?.quaternion) {
      tmp.copy(info.position).sub(t.state.position).applyQuaternion(qi.copy(t.state.quaternion).invert());
      part = nearestPart(w.shape, tmp);
      if (part === 'engine') index = Math.max(0, nearestEngine(w.shape, tmp));
    }
    const P = PARTS[part] || PARTS.fuselage;
    let dmg = amount * (info.blast ? 1 : P.mult) * takenMult(t);
    const hp0 = t.hp;
    t.hp -= dmg;
    const killInfo = { part: part || 'hull', cause: weapon };
    if (d && d.parts) {
      const mx = t.maxHp || 100;
      const share = info.blast ? 0.6 : 1;
      const hitPart = (name, i, frac) => {
        const pp = PARTS[name] || PARTS.fuselage;
        const inc = dmg * frac / (mx * pp.share);
        if (name === 'engine') {
          const E = d.parts.engines; if (!E.length) { d.parts.fuselage = sat(d.parts.fuselage + inc); return; }
          const k = i >= 0 && i < E.length ? i : (rng() * E.length) | 0;
          E[k] = sat(E[k] + inc);
          if (E[k] >= 1) engineOut(t, k);
          if (E[k] > 0.35 && rng() < pp.fire * (dmg / 7) * frac) startFire(t, 0.3 + 0.4 * E[k]);
        } else if (d.parts[name] != null) d.parts[name] = sat(d.parts[name] + inc);
        if (pp.leak && rng() < pp.leak * Math.min(3, dmg / 7) * frac) d.leak = sat(d.leak + 0.15 + 0.25 * rng());
        if (name !== 'engine' && rng() < pp.fire * Math.min(4, dmg / 7) * frac * (0.5 + d.leak)) startFire(t, 0.25 + 0.3 * rng());
      };
      if (part && part !== 'hull') hitPart(part, index, share);
      if (info.blast) {
        // fragments: spread over the airframe, fire likely
        hitPart('fuselage', -1, 0.15); hitPart('wingL', -1, 0.08); hitPart('wingR', -1, 0.08); hitPart('tail', -1, 0.06);
        hitPart('engine', -1, 0.12);
        if (rng() < 0.4 + 0.6 * sat(dmg / mx)) startFire(t, 0.35 + 0.5 * sat(dmg / mx));
      }
      // pilot: rare, instant
      if (part === 'cockpit' && !d.pilot && rng() < (P.pilot || 0) * Math.min(3, dmg / 7)) { d.pilot = true; killInfo.pilotKilled = true; t.hp = Math.min(t.hp, 0); }
      updateSmoke(t);
      syncSim(t);
    }
    const removed = Math.min(hp0, dmg);
    if (!info.noCredit) credit(t, src, removed);
    if (src?.stats) src.stats.damageDealt = (src.stats.damageDealt || 0) + removed;
    if (t.stats) t.stats.damageTaken = (t.stats.damageTaken || 0) + removed;
    ev.emit('damage', { target: t, amount: dmg, source: src, weapon, position: info.position || t.state.position, hp: t.hp, part: part || 'hull' });
    if (t.hp <= 0) {
      if (info.disintegrate || (info.blast && dmg > 1.5 * (t.maxHp || 100))) killInfo.disintegrated = true;
      if (info.distance != null) killInfo.distance = info.distance;
      kill(t, src, weapon, killInfo);
    }
    return removed;
  }

  function nearestEngine(shape, p) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < shape.engines.length; i++) { const e = shape.engines[i]; const dd = Math.abs(p.x - e.x) + 0.3 * Math.abs(p.z - e.z1); if (dd < bd) { bd = dd; best = i; } }
    return best;
  }

  function updateSmoke(t) {
    const d = t.damage, mx = t.maxHp || 100;
    let eng = 0; for (const x of d.parts.engines) eng = Math.max(eng, x);
    const f = sat(1 - t.hp / mx);
    d.smoke = Math.max(sat((f - 0.12) * 1.4), eng * 0.8, d.fire > 0 ? 0.55 + 0.45 * d.fire : 0, d.leak * 0.35);
  }

  /** Per-frame: fire grows and burns hp, fuel leaks, smoke follows damage. */
  function update(dt, aircraft) {
    for (let i = aircraft.length - 1; i >= 0; i--) {
      const t = aircraft[i], d = t.damage;
      if (!d || !d.parts || !t.alive) continue;
      let changed = false;
      if (d.fire > 0) {
        changed = true;
        d.fire = Math.min(1, d.fire + dt * 0.018 * (1 + 2 * d.leak));
        const P = d.parts;
        for (let k = 0; k < P.engines.length; k++) if (P.engines[k] > 0.3) { P.engines[k] = sat(P.engines[k] + dt * 0.012 * d.fire); if (P.engines[k] >= 1) engineOut(t, k); }
        P.fuselage = sat(P.fuselage + dt * 0.012 * d.fire);
        if (!t.invulnerable) t.hp -= dt * (t.maxHp || 100) * 0.03 * d.fire * takenMult(t);
        if (d.fire < 0.35 && combat.rng() < dt * 0.04) d.fire = 0;          // blew out
        if (t.alive && d.fire > 0.85 && d.leak > 0.3 && combat.rng() < dt * 0.08 && !t.invulnerable) {
          kill(t, t.lastHitBy || null, t.lastHitWeapon || 'gun', { cause: 'fire', part: 'fuel', disintegrated: true });
          continue;
        }
        if (t.hp <= 0) { kill(t, t.lastHitBy || null, t.lastHitWeapon || 'gun', { cause: 'fire', part: 'fire' }); continue; }
      }
      if (d.leak > 0) {
        changed = true;
        d.fuelLost += dt * LEAK_RATE * d.leak;
        const fuel = t.state.fuel;
        if (fuel != null && fuel > 0 && d.fuelLost >= fuel) for (let k = 0; k < d.engineOut.length; k++) engineOut(t, k);
      }
      if (changed) { updateSmoke(t); syncSim(t); }
    }
  }

  function reset(e) {
    const sd = e?.sim?.damage; if (!sd) return;
    sd.thrust = 1; sd.ctrl = 1; sd.drag = 0; sd.rollBias = 0; sd.pitchBias = 0;
    if (sd.engineOut) sd.engineOut.length = 0;
  }

  return { apply, update, syncSim, reset, scratch, kill, takenMult };
}
