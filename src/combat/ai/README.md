# Combat AI pilots (`src/combat/ai/`)

The AI pilots fly the real flight model through `entity.controls`: stick, pedals, throttle and speedbrake. They also fly the player's aircraft when the bot is on (`ownsSim` false). This is pure logic with no DOM or WebGL, and it runs in node benches. `pilot.update` makes no per-frame allocations, and all randomness comes from `combat.rng`.

| file | what |
|---|---|
| `index.js` | `createAi(combat)`: the module API, the team service (target spreading) and event wiring (`kill`, `damage`) |
| `pilot.js` | one pilot: sense (5 Hz), think (skill cadence), act (manoeuvre), guard (safety), fly, weapons |
| `fly.js` | flight controller: lift-vector steering, nose tracking for guns, G and roll loops for FBW and conventional jets, speed hold, AoA and structure limits, battle-damage trim |
| `geom.js` | engagement geometry (ata, aa, hca, situation), pursuit points, formation slots, intercepts |
| `safety.js` | terrain look-ahead: a predicted recovery path sampled against the ground, turning escapes, the terrain fan ahead |
| `skill.js` | skill 0..1 and personality turned into numbers (reaction, aim, G use, flare timing, deck, …) |
| `radio.js` | `ai:call` names and their minimum gaps |
| `duel.mjs` | 1v1 bench across a matrix of skills and types: `node src/combat/ai/duel.mjs --runs 8 [--guns] [--terrain mountains] [--types f16,f15,…] [--skills rookie:ace,…] [--modes] [--verbose]` |
| `tools/` | `sandbox.mjs` (a bench without the director), `fc-test.mjs` (controller sweep over 10 types), `track-test.mjs` (gun tracking against a scripted target), `bfm-stats.mjs` (guns duels: time with angular advantage, in the control zone, nose-on, tracking; `MODES=1` adds the mode mix), `duel-trace.mjs` (one duel, one line per N s), `fight-log.mjs` (per-duel result, missile launches and the fight-length quartiles), `terrain-check.mjs` (duels over the mountain range; every ground loss with its last second of flight, damaged aircraft counted) |
| `*.test.js` | `node --test src/combat/ai` |

## API

The original API is kept; additions are marked ✚.

```js
const ai = createAi(combat);            // ✚ also returns { pilots, team }
const pilot = ai.createPilot(entity, { skill: 0.55, order: { type: 'engage' }, personality: 'energy' /* ✚ optional */, passive: false /* ✚ */ });
pilot.update(dt); pilot.setOrder(order); pilot.order; pilot.mode; pilot.skill;
```

✚ Additional pilot fields:
- `personality`: `'turn' | 'energy' | 'cautious' | 'balanced'`, picked from `combat.rng` unless given.
- `sub`: the sub-mode, e.g. `'lead'`, `'notch'`, `'terrain'`.
- `passive`: missions may set this directly.
- `profile`: what the AI knows about the airframe.
- `tuning`: the skill numbers.
- `debug`: `{ want, gun, recovering, activity, attacker, missile }`.
- `onKill(victim)` and `onDamage(amount, source)`: called by `index.js`.

✚ Exports: `CALLS`, `PERSONALITIES`, `DIFFICULTY_SKILL`, `isFightMode(mode)`.

## Orders

| type | fields | behaviour |
|---|---|---|
| `engage` | `target?` | Fights the target, or the best enemy (spread over the team, priority targets first). With nothing to fight it holds an orbit; the player bot flies to `director.waypoint`. |
| `intercept` | `target, heading?, alt?, engageRange?` | Lead-intercepts the target and fights it inside `engageRange` (15 km). Without a target it cruises on `heading`. |
| `escort` | `leader, offset?, engageRange?, weaponsHold?` | Holds the slot. Joins the fight when the leader fights or an enemy threatens the pair (`press` / `rejoin` calls). |
| `patrol` | `waypoints, loop, speed?, alt?, radius?, orbit?` | Flies the route. Weapons are free inside `engageRange` (20 km) unless `weaponsHold`. Orbit rings are patrols. |
| `orbit` | `center?, radius?, alt?, clockwise?` | Racetrack-free circle (default 6 km) around the centre, or around where the order was given. |
| `cruise` | `heading?, alt?, speed?` | Holds heading and altitude. Weapons are free inside 12 km unless `weaponsHold`. |
| `flee` / `rtb` | `heading?, alt?, home?/base?` | Runs (on the heading, home, or away from the nearest enemy) and defends if attacked. |
| any | `passive: true` (or `pilot.passive = true`) | Never attacks. Flies the order with mild evasive weaving and flares when threatened. Used for transports, airliners and drones. |
| any | `weaponsHold: true` | Does not start fights by itself. |
| any | `detectRange` | Maximum target selection range (80 km). |

Escort `offset` is a preset name (`'wing'`, `'spread'`, `'trail'`, `'echelon'`, `'close'`, add `'-left'` to mirror) or `{ x right, y up, z aft }` in metres.

**Teams are re-read every think.** Neutrals are never attacked. A neutral attacks only the target its own `engage` order names; train-missiles relies on this. When a target turns friendly or neutral it is dropped.

**Priority targets** score higher in target selection, unless an escort is attacking me or my leader:
- markers in `director.markers` with `kind: 'target'`;
- `tags.role` bomber, striker, raider or hva;
- `def.category` bomber, transport or attack;
- passive aircraft.

## What a pilot does

- **Sense** (5 Hz): missiles guiding on it. Radar shots are seen via the RWR; IR shots are seen with a skill-scaled chance, or late from the smoke. It also senses attackers in the rear quarter (check six, with a spotting delay for poor pilots) and guns threats.
- **BFM:**
  - in front of the bandit's 3–9 line: nose to it; behind it: fly to its control zone (its position ~1–4 s ago on its curving path), pure to close, lead only to shoot; a straight or running bandit is pointed at;
  - overshoot management by time to go and closure: lag first (throttle and speedbrake), high yo-yo / lag roll only when the closure is more than the throttle can kill;
  - a flat stalemate (long neutral circle) is broken by the pilot with the energy going vertical;
  - merge with offset passes and one- or two-circle choice by energy and personality;
  - high and low yo-yo, lag roll, scissors, vertical re-attack;
  - extend and re-attack, a missile reset after a long close-in stalemate;
  - against targets that do not fight back, no BFM at all: just pursuit and guns.
- **Energy:**
  - fights near corner speed;
  - the AoA envelope a pilot dares to use grows with skill (rookies stay far from the limit, fearing a departure, and are out-turned);
  - when fast the turn is flattened (no nose-low spiral to the floor), when slow the pilot does not chase the bandit uphill; the flight controller keeps the gravity part of a saturated lift request, so hard turns stay level instead of dropping the nose;
  - stops climbing and eases the pull when slow;
  - afterburner and speedbrake by speed error, no afterburner below 30 % fuel except to survive, bugout at bingo.
- **Defence:**
  - break into an attacker, or split-S with altitude to spare;
  - out-of-plane guns jinks (skilled pilots; rookies just break);
  - missile defence:
    - IR missiles: beam, throttle out of afterburner, timed flare pairs at missile time-to-go `flareTgo` (aces about 3 s, rookies about 1.3 s, and some rookies flare far too early and waste them);
    - radar missiles: notch low into the clutter, or drag one fired from far out of energy; flares only by rookies;
    - every missile: a last-ditch break above 6 g inside about 2.2 s time-to-go.
  - Every reaction waits a human reaction time scaled by skill.
- **Offence:**
  - guns via `weapons.gunSolution`, with correlated aim wander that grows with line-of-sight rate; the nose tracker trims the steady lateral error with an integral term;
  - fire tolerance is the target's angular size plus a small skill term (aces 7 mrad, rookies 22); tracking bursts only once the bandit's manoeuvre plane has been steady for a moment (aces wait ~0.6 s, rookies not at all), snapshots as the pipper sweeps through, also from a pursuit;
  - closes to 340–560 m by skill (aces close in); never fires with a friendly in the line;
  - missiles only on a lock, after a skill-scaled hesitation, never outside `lock.rMax` and never inside `rMin`; aces wait for `rNe`; one missile in flight per target (aces may add a second after 10 s);
  - the merge: decided once per bandit, many pilots hold the head-on radar shot to the merge (rookies and veterans ~65–70 %, aces ~60 %; turn fighters more, cautious and energy pilots less);
  - after a missile of theirs misses, only a good rear-quarter shot for 15–35 s: the fight becomes a turning fight; in the turning fight skilled pilots wait for a rear-quarter IR shot with the seeker near the nose and the bandit not in a hard break;
  - a refused launch (the player-warning hold of `weapons`) is simply retried on the next think.
- **Safety guard:**
  - mid-air avoidance (wider for team-mates; formation station-keeping allowed);
  - soft floor (a dive-angle limit against the terrain ahead plus the deck) and a comfort floor that keeps fights 2–3.5 km above the deck;
  - predictive terrain recovery along the velocity and along ±turning escapes (3 km mountains), using the G that full aft stick actually gives right now (learned online, kept for the speed it was learned at) and battle damage (`sim.damage.ctrl`/`thrust`); a fast recovery pulls power back and uses the speedbrake; no transonic dashes within 3 km of the deck;
  - stall recovery, overspeed (vmo / mmo), ceiling.
  - The flight controller trims out `sim.damage` roll and pitch offsets and scales the stick by `1/ctrl`.
- **Skill and mistakes:** besides the numbers in `skill.js`, poor pilots make mistakes (more of them under pressure and as G fatigue builds in a long hard fight):
  - lose the bandit in the rear quarter for a few seconds and fly straight on, predictable (poor lookout);
  - lose sight;
  - get slow;
  - overshoot;
  - fixate on a target and ignore a threat;
  - ease the pull in the middle of a break.

## Radio (`ai:call` `{ entity, call, target }`)

`tally, engaging, fox2, fox3, guns, defending, missile-inbound, on-my-six, hit, splash, winchester, mayday, rejoin, press`. Each call has a minimum gap per pilot (`radio.js`) and there is a 1.2 s gap between any two calls of one pilot. `splash`, `fox2/3` and `mayday` are never dropped.
