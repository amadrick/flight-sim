# Combat weapons and damage (`src/combat/weapons/`)

Guns, missiles, flares, hit detection, the damage model and per-aircraft loadouts. This is pure logic (no DOM or WebGL) and runs in node benches.

| file | what |
|---|---|
| `index.js` | `createWeapons(combat)`: the module API (COMBAT.md §6, extended below) |
| `specs.js` | gun, missile and flare data, `LOADOUTS` per aircraft id, `DAMAGE_TAKEN` (the difficulty table), `RCS` |
| `ballistics.js` | air density table, round drag and drop, `solveGun`, `gunTrajectory` (closed forms plus one numeric correction) |
| `hitshape.js` | body-axes hit shapes from `def.geometry`: fuselage capsule, engine pods, sheared wing and tail boxes, swept segment tests |
| `missile.js` | motor, drag, g limit and lag; proportional navigation; fly-out tables and launch zone; IR signature, flare intensity, radar notch |
| `damage.js` | hit points, component damage, fire, fuel leaks, the `sim.damage` mapping, kill credit and assists |
| `range.mjs` | measuring tool: `node src/combat/weapons/range.mjs [gun] [ir] [radar] [flyout] [--n 6] [--quick]` |
| `*.test.js` | `node --test src/combat/weapons` (the local `package.json` points that at `tests.mjs`) |

## API (kept from the placeholder, plus additions)

- `specs` is `{ gun (default 20 mm), guns, missiles: { ir, radar }, flare, radar }`. Each aircraft's own gun is in `entity.loadout.gun.spec`.
- `bullets` is `{ n, items }`. Each item has `{ position, velocity, prev, age, team, tracer, owner }`, plus `life, damage, gun` (gun id).
- `missiles[]` holds missile entities: `owner, target, spec, type, seeker, age`, plus **`motor`** (bool, burning), `motorPhase` ('boost'|'sustain'|null), `speed`, `mach`, `g`, `tgo`, `active` (radar terminal or IR), `guiding`, `decoyed`, `lost`, `origTarget`.
- `flares[]` holds flare entities: `kind 'flare', owner, age, life`, plus `heat` (0..1 for fx) and `intensity`.
- `equip(e, overrides)`: overrides can include `{ gun (rounds), gunType, ir, radar, flares, hp, invulnerable }`.
  - `e.loadout = { gun: { type, name, spec, rounds, max, firing, spin, heat }, missiles: { ir, radar }, missilesMax, flares, flaresMax, selected }`
  - `e.lock = { target, state, progress, seeker, inRange, range, rMin, rMax, rNe, tti, closure, aspect (rad: 0 = shooter astern of the target / tail-on, π = head-on, same as `util.geometry`), offBoresight }`. `tti` is 0 when out of reach.
  - `e.damage = { smoke, fire, engineOut[], leak, fuelLost, pilot, parts: { fuselage, cockpit, wingL, wingR, tail, engines[] } }`, all 0..1.
- `launchMissile(e, type?)` needs a lock. A type other than the selected one is allowed only if `canLock` passes for it now. Launches are at least 0.6 s apart. Without a lock it emits `weapon:nolock` and returns null. There is no boresight or dumb launch.
- `dropFlares(e)` releases a pair. There is a 0.4 s cooldown.
- **`threatsTo(e, out[])`** fills `out` with `{ type: 'missile'|'lock', seeker, source, missile, range }` and returns `out`.
  It sets `out.length` and `out.count` to the number of threats, so existing callers that read `out.length` keep working.
  The objects live in a hidden pool on the array (`out.pool`), so truncating `out` (by you or by the call) never drops
  them. After the first few calls it allocates nothing. Pass the same array every frame.
- **`gunTrajectory(shooter, tof, outVec3)`** gives where a round fired now will be after `tof`, measured from the shooter's straight-line path (position + velocity·tof), in the shooter's current body axes.
- `gunSolution(shooter, target, out)` returns `{ point, dir, tof, range, inRange }`. It accounts for lead from target velocity and
  **smoothed** target acceleration (per target, τ = 0.3 s, in `target.wpn.accS`; reset on spawn and on a position jump), plus drop and drag.
  The aim point no longer jumps when the target jinks.
- **`rearm(e, { heal?, gun?, ir?, radar?, flares?, invulnerable? })`** is for mission scripts. It refills counts to the loadout maxima
  (or to the absolute numbers given). `heal` (0..1) restores that fraction of `maxHp` and repairs the same fraction of component
  damage. With `heal: 1` the aircraft is good as new: fire out, leak sealed, and engines that were shot out are no longer
  marked out (a flamed-out engine still needs a restart in the flight model). It emits `rearm` `{ entity, loadout }`.
  Writing the fields directly is also safe:
  - `loadout.gun.rounds`, `loadout.missiles.ir/radar` and `loadout.flares` raise their `max` / `missilesMax` / `flaresMax` when they go above them;
  - `hp` above `maxHp` is clamped, and smoke follows `hp`;
  - an empty selected rail switches to the other type automatically (`weapon:select`);
  - `invulnerable` can be toggled at any time.
- **`canLock(e, target, type)`** and **`launchZone(shooter, target, type, out)`**: queries for the AI. They do not touch `e.lock`.
- `applyDamage(target, amount, { source, weapon, position, part? })` returns the hp removed. It works on anything with `hp` and `state.position`. Ground units use a sphere of `radius`.

## Events

These are new or extended; every listener tolerates extra fields.

- `bullet:hit` `{ shooter, target, position, part, bodyPosition, gun, damage (hp removed), hp, killed }`, emitted after the damage is applied
- `bullet:near` `{ target, shooter, position, distance }`: fires for any aircraft, the player included, when a round passes within about 14 m of its hit shape without hitting. Throttled to once per 0.35 s per target
- `bullet:ground` `{ position, shooter, gun }`: throttled to once per 0.07 s per shooter
- `damage` `{ …, part }`
- `kill` info: `{ part, cause, assists[], disintegrated?, pilotKilled?, distance? }`. Collisions give `weapon: 'collision'` and `info.other`.
- `missile:launch` / `rwr:launch` add `seeker`
- `missile:hit` adds `distance`
- `missile:miss` `{ missile, reason: 'timeout'|'ground'|'decoyed'|'energy'|'lost', position, detonated, target }`
- `missile:decoyed` `{ missile, flare, target, sun? }`
- `missile:reacquired`, `missile:active` (radar seeker goes autonomous), `missile:notched`
- `flare` adds `remaining`
- `fire:start` `{ target }`, `engine:out` `{ target, index }`, `collision` `{ a, b, position }`
- `rwr:spike` `{ source, target }`: a radar starts acquiring `target` (the earliest warning, about 1.8 s before `rwr:lock`)
- `rearm` `{ entity, loadout }`

## Kill credit

`lastHitBy` / `lastHitWeapon` / `lastHitT` are set on every hit that has a source (gun, missile blast, scripted damage with
`source`). Fire damage over time keeps the attacker who started it. Credit expires `CREDIT_WINDOW` (30 s, in `damage.js`)
after the last hit, but not while the aircraft is still burning. A clean terrain crash long after a scratch is therefore credited to nobody.

## Gun lethality

Damage per round: 20 mm 13, 25 mm 19, 30 mm 34 (× 0.75–1.25, × part multiplier). Hits to kill, perfect tracking from 300 m astern:
F-16 ≈ 7, F-15 ≈ 10, A-10 ≈ 20, C-17 ≈ 36, 737 ≈ 16 with the 20 mm; the 30 mm needs about 3 / 5 / 8 / 14 / 6. Visible damage
(smoke, leak or fire) shows from the first or second hit on fighters.

## Fairness for the human player

- `PLAYER_WARNING` in `specs.js` sets how long a hostile aircraft must hold its lock on the human player (an entity with
  `isPlayer` and no `pilot`) before `launchMissile` succeeds:
  - radar hold: rookie 4 s, veteran 2.5 s, ace 1 s;
  - IR hold: rookie 2 s, veteran 1 s, ace 0 s.

  The sequence the player experiences is `rwr:spike` → about 1.8 s → `rwr:lock` → the hold → `rwr:launch`. An 8 km head-on
  radar shot then takes about 7–8 s to arrive.
- `DAMAGE_TAKEN.player[difficulty] = { gun, missile, fire }`:
  - rookie: 0.45 / 0.25 / 0.3. One missile hit removes at most about 86 hp from a 100 hp fighter, so the player survives crippled;
  - veteran: 0.8 / 0.65 / 0.8. One hit removes about 65–200 hp, so usually crippled or dead;
  - ace: 1.1 for all three. One hit is a kill.

  Collisions are not scaled. A rookie player is also never killed by a pilot hit.

## Model notes

- **Gun.** Rounds have spin-up, Gaussian dispersion, quadratic drag that depends on air density, gravity, a tracer every Nth round and a self-destruct time. Hits are swept segment tests in the target's frame, using relative motion over the frame. Each part has its own damage multiplier.
- **IR missile.** Lock depends on engine heat (n1, afterburner, fire), aspect and airframe heating, plus a sun check.
  - Each flare is judged once, when it separates from the target in the seeker gate. The result depends on relative intensity, flare age (kinematic rejection) and missile quality. Each flare the missile rejects makes the next one less likely to work, so good timing beats spamming flares.
  - A decoyed missile chases its flare. When the flare burns out, the missile may re-acquire the original target.
- **Radar missile.** It flies on datalink while the launcher's radar holds the target in its cone. Once active it is autonomous. Beaming against clutter (target low, or the missile looking down on it) drains track quality.
- **Both missiles.** A seeker slew-rate limit applies. There is also a deliberately simple **gameplay** rule (`EVADE` in `index.js`): a hard turn (above 6 g) inside the missile's last ~2.5 s gets one roll to shake it, and the odds are better when the missile is slow. This is tuning for fun, not physics.
- **Damage.** See `PARTS` in `damage.js`. Fire burns hp over time. Leaks lose fuel, and the engines flame out when the lost fuel reaches the fuel left. Missile blasts fall off linearly to `spec.blast`, and a burst within 1.5 m disintegrates the airframe.
