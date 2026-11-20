# Missions (`src/combat/missions/`)

The mission director, a small scripting toolkit, the missions themselves, objectives, scoring and the radio script.
Pure logic, runs in node (`tools/combat-bench.mjs`).

| file | what |
|---|---|
| `index.js` | `createDirector(combat)`: the COMBAT.md §8 API plus the additions below; reactions to the fight (radio, score) |
| `runtime.js` | the scripting toolkit: the `s` object every mission script receives |
| `radio.js` | radio queue (priorities, spacing, expiry, dedupe), cast, `clockDir()` |
| `lines.js` | the line bank (several variants per situation) and the `ai:call` → line table |
| `scoring.js` | stats, points, rating, medals |
| `geo.js` | named places, terrain-aware altitude helpers |
| `defs/` | `training.js`, `campaign.js`, `instant.js`, `common.js` (cast, defaults, `briefMap`) |
| `missions.test.js` | `node --test src/combat/missions/missions.test.js` |

## Director API

COMBAT.md §8 is kept: `missions[]`, `getMission(id)`, `prepare(mission, options)`, `start(mission, options)`, `update(dt)`,
`stop()`, `objectives[]`, `stats`, `radio(from, text, opts)`. Additions:

- `director.waypoint = { position: Vector3, label, entity? } | null`: the current steer point. When it follows an entity the
  position is refreshed 4×/s and it clears when the entity dies.
- `director.timer = { label, seconds } | null`: countdown for the HUD (seconds remaining, or an estimate such as an ETA).
- `director.markers = [{ id, label, kind, position: Vector3, entity?, radius }]`. `kind` is one of `'target'`, `'protect'`,
  `'nav'`, `'zone'` or `'friendly'`. Markers on entities follow them and are removed when they die.
- `director.objectives[i] = { id, text, state: 'active'|'done'|'failed', optional, hidden, progress, points, standing, reason }`.
  Hidden objectives only appear once they are achieved. `standing` objectives ("keep X alive") count as done at the end unless they failed.
- `director.radio(from, text, { priority 0|1|2, delay, vars, key, window, voice, team, now })`: `from` is a cast key
  (`'awacs'`, `'tower'`, `'boat'`, `'instructor'`, `'ace'`, `'furnace'`, `'bundle'`, `'range'`, `'redrock'`), an entity,
  `'lead'` (the player) or any name. `text` may be an array of variants or `'@bank.key'`. Lines are queued; set `now: true`
  to emit at once.
- `director.anchor`: the player's start `{ x, y, z, hdg, aircraft, callsign, flight }`.
- `director.runtime`: the running script (see below). `director.scoring`, `director.radioQ`.
- `director.finish(outcome, reason)`: closes the books and calls `combat.end` once. The runtime calls it after the final radio beat.

`prepare()` returns `{ aircraft, airport, mode: 'air'|'runway', position {x,z}, alt, hdg, spd, tod, weather, livery, stores: 'a2a', callsign, loadout }`.
In the node bench, a `'runway'` start becomes an air start just past the far end of the runway, because the bot cannot take off.

### Events emitted

- `'radio' { from, text, priority, team, voice: 'awacs'|'wingman'|'lead'|'enemy'|'tower'|'player', entity? }`
- `'score' { points, reason, total }`
- `'objective:update' { objectives }`

### Events consumed

`kill`, `damage`, `missile:launch`, `missile:hit`, `missile:decoyed`, `rwr:launch`, `fire:start`, `engine:out`, `ai:call`,
and `bullet:hit` (in the BFM lesson). Scripts may also subscribe to any other event, and to `ctx.events 'touchdown'` through
`s.onTouchdown`.

## Mission definition

```js
mission({
  id, category: 'training'|'campaign'|'instant', order, title, tagline, brief: [paragraphs],
  location: 'KHVN' (airport id), locationName: 'free text', tod, weather, aircraft, aircraftChoices, objectivesPreview,
  threat: 1..5, minutes, map: briefMap(cx, cz, radius, [x, z, hdg], hostiles[[x, z]], friendlies[[x, z]]),
  start: { at: placeName | {x,z}, brg, dist, alt | agl, hdg, spd, mode: 'air'|'runway', airport } | (options) => start,
  loadout: { ir: 0, radar: 0, … } | (options) => loadout,       // weapons equip overrides for the player
  callsign: 'Halyard 1', cast: { key: { name, voice, team } },
  winReason, quietKills, noTimeBonus, noDamageBonus, par, toughness: { rookie, veteran, ace },
  custom: true,                                                   // instant-custom only: the UI shows the custom form
  script(s) { … },
})
```

## Scripting toolkit (`s`)

- **Context**: `s.player`, `s.t` (mission clock), `s.anchor` (start point, Vector3), `s.heading`, `s.callsign`, `s.custom`,
  `s.places`, `s.difficulty`.
- **Dice**: `s.n(rookie, veteran, ace)`, `s.skill('enemy'|'elite'|'wing'|'target', delta)`, `s.pick(arr)`, `s.chance(p)`, `s.between(a, b)`.
- **Placement**: `s.at({ from, brg | rel, dist, alt | agl, clear })` gives a terrain-safe Vector3. `rel` is relative to the
  player's heading. The other helpers are `s.lift(p, spec)`, `s.route(points, { alt | agl, clear })` (legs clear the ground),
  `s.zone(center, r, { floor, ceiling })`, `s.ground(x, z)` and `s.safeAlt(x, z, want, clearance)`.
- **Groups**:
  - `s.group(name, spec)` spawns now. `s.declare(name, spec)` and `g.spawn()` spawn later.
  - `s.wave(name, spec, trigger, onSpawn)` declares now and spawns when the trigger fires.
  - `s.wingmen(n, spec)` adds the player's wingmen. They escort the player and engage within 25 km, each taking a different bandit.
  - `spec` takes `{ team, type: id | [ids] | 'mixed', count, callsign, startIndex, single, at, heading: deg | 'player' | {rel} | {x,z},
    speed, formation: 'echelon'|'line'|'trail'|'wedge'|'box'|'wing', spacing, stack, skill, loadout, hp, invulnerable, passive,
    order: obj | fn(i, pos, g), engageWithin (m), sort, fair, mark, markKind, role, points, thrust, drag, toughness, call, noCount, onSpawn }`.
  - Red groups are **fair** by default: no closer than 4.5 km ahead, or 9 km behind. They also **sort** their opening targets
    across the blue side, and carry the difficulty's missile load (`ENEMY_LOADOUT`) unless `loadout` is given.
  - A group exposes `g.alive`, `g.lost`, `g.size`, `g.members`, `g.leader`, `g.order(o | fn)`, `g.each(fn)`, `g.mark()` and `g.engage(t)`.
  - `s.hostilesLeft()` counts the red aircraft still alive plus the declared red aircraft that have not spawned yet.
- **Orders** (`s.orders`):
  - Basic orders: `engage(t)`, `patrol(wps, { passive, loop, speed })`, `escort(leader, offset)` and `cruise(hdg, alt)`.
  - `orbit(center, r, alt)` is expressed as a patrol ring.
  - `flee(hdg, alt)`, `rtb(place, alt, from)` and `intercept(t, from)` carry `heading`/`alt` too, so an AI without those orders falls back to cruising the right way.
- **Triggers and timers**:
  - `s.after(sec, fn)`, `s.every(sec, fn)`, `s.when(cond, fn)` and `s.cancel(task)`.
  - `s.trigger(trig, fn)`, where `trig` is one of: seconds, `{ after }`, `{ dead: g, count? }`, `{ kills: n }`, `{ zone, who? }`, `{ or: [...] }` or a function.
  - `s.on(event, fn)` subscribes to a combat event and is removed when the mission stops. `s.onTouchdown(fn)` does the same for the player's touchdown.
- **Objectives**:
  - `s.objective(id, text, { optional, hidden, points, progress, standing, quiet })` returns `ob`, with `ob.done()`, `ob.fail(reason)` and `ob.set(progress)`.
  - The shortcuts are `s.destroy(id, text, groups, { count })`, `s.protect(id, text, groupOrList, { min, optional })`,
    `s.reach(id, text, zone)` and `s.hold(id, text, seconds)`.
  - When every primary objective is done, the mission is won (`s.autoWin = false` turns that off). A failed primary objective loses it.
- **Fail conditions**: `s.countdown(sec, label, onExpire, { warn, dynamic })`, `s.boundary(center, r, { grace })` (after a
  warning, a countdown before "Left the area") and `s.failIf(cond, reason)`. When the player is shot down the mission is lost,
  unless `s.onPlayerDown(killer, weapon)` decides otherwise.
- **HUD**: `s.steer(pointOrEntity | null, label)`, `s.mark(pointOrEntity, label, kind)` and `s.unmark(m | entity | label)`.
- **Radio**: `s.say(who, text, opts)`, `s.chat([[delay, who, text, opts], …])` (delays add up), `s.picture(group)` (a
  bearing/range call), `s.cast(map)` and `s.wingman()`.
- **Score and ending**: `s.score(points, label, reason)`, `s.medal(id, title, text)`, `s.win(reason, chat?)` and
  `s.lose(reason, chat?)`. `s.winChat` and `s.loseChat` set the default closing lines. The ending happens once, after the final radio beat.

Endless survival is the one mission that does not declare everything up front: its waves are generated as it goes.

## Scoring

`director.stats` is shared as `world.player.stats`, and the weapons module adds `shots, hits, missiles, missileHits, damageDealt, damageTaken` to it.
The director keeps its own `missileHits`, `damageDealt` and `damageTaken` from events and takes the larger value at the end.

| Item | Points |
|---|---|
| Kill | Fighter or attack 100, recon 150, bomber 160, transport 120, or `tags.points` (Quillon 600) |
| Gun kill | ×1.5 |
| Assist | 40 |
| Objective | 250 by default; optional 150, hidden 200 |
| Time bonus | Up to 300, against `minutes` |
| Gun accuracy | Up to 250, needs at least 60 rounds fired |
| Missile accuracy | Up to 150 |
| Wingmen home | 75 each |
| No damage taken | 250 |
| Friendly kill | −500 |
| Wingman lost | −100 |
| Difficulty | ×0.75 on rookie, ×1.5 on ace |

The rating compares the score with a par computed from what the mission offers: S ≥ 100% of par, A ≥ 75%, B ≥ 50%, C ≥ 30%,
and D below that. A failed mission is rated C at best. The medals are `untouchable`, `gunfighter`, `ace-in-a-day`,
`sharpshooter`, `every-shot`, `shepherd`, `quick-draw`, `thorough` and `ace-difficulty`, plus mission medals:
`close-shave` (c5) and `broken-quillon` (c9).

`combat.result.stats` is `{ kills, assists, losses, shots, hits, missiles, missileHits, damageDealt, damageTaken, gunKills, missileKills,
friendlyFire, objectives, objectivesFailed, time, score, rating, breakdown: [{ label, points }], medals: [{ id, title, text }], outcome }`.

## Difficulty

`s.skill` uses these values:

| Role | Rookie | Veteran | Ace |
|---|---|---|---|
| Enemy | 0.18 | 0.5 | 0.8 |
| Elite | 0.32 | 0.66 | 0.95 |
| Wingman | 0.8 | 0.62 | 0.48 |

Enemy missile racks are rookie `{ ir 1 }`, veteran `{ ir 2 }` and ace `{ ir 2, radar 2 }`. Group sizes come from `s.n()`.
Damage scaling is the weapons module's job (`DAMAGE_TAKEN`), so missions do not scale hit points (`toughness` is optional, per mission).
