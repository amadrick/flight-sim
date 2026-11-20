// Skill (0..1) and personality → the numbers that make one AI pilot fly differently from another.
// Rookie ≈ 0.25 (beatable by a new player), veteran ≈ 0.55, ace ≈ 0.9 (dangerous but fair: never an aimbot).
import { clamp, lerp } from '../util.js';

/**
 * Personalities (chosen from combat.rng unless the order / spawn names one):
 *   turn      aggressive turn fighter: stays in the turning fight, pulls hard, accepts low speed, closes to guns
 *   energy    boom-and-zoom: keeps speed and altitude, slashing attacks, extends and re-attacks, likes the vertical
 *   cautious  keeps its distance, prefers missiles, defends early, disengages when damaged
 *   balanced  a bit of everything
 */
export const PERSONALITIES = ['turn', 'energy', 'cautious', 'balanced'];

const PERS = {
  turn: { speedBias: -10, gBias: 0.04, aggression: 0.9, verticalPref: 0.25, missilePref: 0.6, bugout: 0.22, gunRange: 1.0, extendPref: 0.2, closeIn: 1 },
  energy: { speedBias: 45, gBias: -0.04, aggression: 0.6, verticalPref: 0.85, missilePref: 0.8, bugout: 0.3, gunRange: 1.1, extendPref: 0.85, closeIn: 0.8 },
  cautious: { speedBias: 25, gBias: -0.02, aggression: 0.35, verticalPref: 0.4, missilePref: 1, bugout: 0.5, gunRange: 0.85, extendPref: 0.6, closeIn: 0.6 },
  balanced: { speedBias: 15, gBias: 0, aggression: 0.65, verticalPref: 0.5, missilePref: 0.8, bugout: 0.33, gunRange: 1.0, extendPref: 0.45, closeIn: 0.85 },
};

/** Build the tuning record of a pilot. rng = combat.rng (deterministic). */
export function makeSkill(skill, personality, rng) {
  const s = clamp(skill, 0, 1);
  const p = PERS[personality] || PERS.balanced;
  const j = () => 0.85 + 0.3 * rng();           // individual variation ±15 %
  return {
    skill: s, personality: PERSONALITIES.includes(personality) ? personality : 'balanced', ...p,
    // human reaction time to a new threat / opportunity (s)
    reaction: lerp(1.25, 0.32, s) * j(),
    // decision cadence (s)
    think: lerp(0.55, 0.22, s),
    // how much of the airframe's G the pilot uses in a hard turn (fraction of gMax)
    gUse: clamp(lerp(0.66, 0.95, s) + p.gBias, 0.5, 0.97),
    // gun aim: tracking wander (rad, 1σ) and its correlation time (s); fire tolerance (rad) and settle time (s)
    aimSigma: lerp(0.016, 0.0045, s) * j(),
    aimTau: lerp(0.5, 0.9, s),
    fireTol: lerp(0.022, 0.007, s),
    settle: lerp(0.08, 0.15, s),
    burst: [lerp(0.9, 0.3, s), lerp(2.0, 0.7, s)],
    burstGap: [lerp(0.5, 0.8, s), lerp(1.2, 1.8, s)],
    // gun employment range (m) and the most head-on aspect the pilot will snapshot at (rad off the target's tail)
    gunMax: lerp(950, 700, s) * p.gunRange,
    // range the pilot tries to settle at behind a target before shooting (m): aces close to 300–400 m
    gunIdeal: lerp(560, 340, s) * p.closeIn ** -0.3,
    headOnGuns: lerp(2.3, 2.0, s),
    // chance per think of a mistake while fighting (lose sight / overshoot / get slow), and the flight-path precision
    mistake: lerp(0.06, 0.006, s),
    precision: lerp(0.55, 1, s),
    // missile shots: fraction of rMax used, minimum time between shots (s)
    shotRange: lerp(0.92, 0.6, s),
    shotGap: lerp(5, 9, s) * j(),
    // hesitation between getting a lock and pressing the pickle (s)
    shotDelay: lerp(3.5, 0.4, s) * j(),
    // missile defence: chance to see an IR shot, timing of the last-ditch break (time to go, s), flare discipline
    seeIr: lerp(0.45, 0.95, s), breakTgo: lerp(1.0, 2.2, s), defendQuality: lerp(0.4, 1, s),
    // flares: first pair at this missile time-to-go (s), number of pairs, gap between pairs (s)
    flareTgo: lerp(1.3, 3.0, s), flarePairs: s < 0.35 ? 1 : 2, flareGap: lerp(0.5, 0.75, s),
    // terrain: hard deck above the ground (m) during manoeuvring
    deck: lerp(650, 220, s),
    // speed discipline: how far below the fight speed before the pilot notices (m/s)
    slack: lerp(45, 10, s),
    // out-of-plane jink against a guns threat: chance to jink (vs. just turning), interval (s)
    jink: lerp(0.0, 0.85, clamp((s - 0.2) / 0.8, 0, 1)), jinkGap: [lerp(2.0, 0.8, s), lerp(3.5, 1.6, s)],
    // situational awareness: chance per check to notice an attacker in the rear quarter
    checkSix: lerp(0.35, 0.95, s),
  };
}

/** Skill for a difficulty name (missions usually pass `skill` per aircraft; this is the fallback). */
export const DIFFICULTY_SKILL = { rookie: 0.25, veteran: 0.55, ace: 0.9 };
