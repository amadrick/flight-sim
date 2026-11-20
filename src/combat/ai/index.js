// AI PILOTS — enemy and friendly aircraft that fly the real 6-DOF flight model through the same Controls a human uses.
// API (COMBAT.md §7, kept): createAi(combat) → { createPilot(entity, { skill, order, personality? }) → pilot }
//   pilot.update(dt)  pilot.setOrder(order)  pilot.order  pilot.mode  pilot.skill   (+ pilot.sub, pilot.personality)
// Orders, calls and the rest: README.md in this directory.
import { createPilot as makePilot, isFightMode } from './pilot.js';
import { CALLS } from './radio.js';
import { PERSONALITIES, DIFFICULTY_SKILL } from './skill.js';

export { CALLS, PERSONALITIES, DIFFICULTY_SKILL, isFightMode };

export function createAi(combat) {
  const pilots = new Set();
  // team service shared by every pilot: target spreading
  const team = {
    /** how many live AI/player aircraft other than `except` currently have `target` designated */
    countTargeting(target, except) {
      let n = 0;
      const air = combat.world.aircraft;
      for (let i = 0; i < air.length; i++) { const a = air[i]; if (a !== except && a.target === target && a.team !== target.team) n++; }
      return n;
    },
  };
  combat.events.on('kill', ({ victim, killer } = {}) => {
    if (killer?.pilot && killer.alive && killer.pilot.onKill) killer.pilot.onKill(victim);
    if (victim?.pilot) pilots.delete(victim.pilot);
  });
  combat.events.on('damage', ({ target, amount, source } = {}) => {
    if (target?.pilot?.onDamage && target.alive) target.pilot.onDamage(amount, source);
  });
  combat.events.on('mission:abort', () => pilots.clear());

  /**
   * createPilot(entity, { skill 0..1, order, personality: 'turn'|'energy'|'cautious'|'balanced' (default: from combat.rng) })
   * The pilot writes entity.controls every update, chooses entity.target and uses combat.weapons like a human would.
   */
  function createPilot(e, o = {}) {
    const p = makePilot(combat, team, e, o);
    pilots.add(p);
    return p;
  }
  return { createPilot, pilots, team };
}
