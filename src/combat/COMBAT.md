# Skyward combat — module contract

Combat turns the simulator into a game: missions, AI aircraft that fly the **real flight model**, guns, missiles, flares,
damage, targeting, radio, scoring. It is a mode on top of the simulator: with no mission running, nothing here costs a
frame and free flight behaves exactly as before. `ARCHITECTURE.md` (repo root) still binds everything — coordinates,
floating origin, rendering/lighting rules, UI conventions, zero network, zero per-frame allocation. Read it first.

**Originality rule (from the user):** everything is original. No names, characters, call signs, squadrons, logos, music,
lines of dialogue, missions or set pieces from any existing film or game. Real aircraft types and generic military
brevity ("Fox two", "splash one", "bandit", "bingo") are fine. Enemy forces are a fictional adversary; no real nations.

## 1. Layout and ownership

```
src/combat/index.js, world.js, targeting.js, util.js, COMBAT.md, tools/combat-bench.mjs    CORE (integrator) — never edit
src/combat/ai/**        AI pilots: BFM, gunnery, missile employment and defence, formation, orders
src/combat/weapons/**   gun, missiles, seekers, flares, hit detection, damage model, loadouts
src/combat/missions/**  mission director, mission scripts, objectives, scoring, radio script
src/combat/hud/**       combat overlay: target markers, gun sight, lock, radar, threat warning, objectives, subtitles, kill feed
src/combat/input/**     combat keys / mouse / touch / gamepad
src/combat/ui/**        mission select, briefing, debrief screens
src/combat/audio/**     weapon sounds, tones, warnings, explosions, radio voice, music
src/combat/fx/**        tracers, missiles, smoke trails, flares, explosions, battle damage, AI engine plumes
src/combat/camera/**    combat cameras (padlock, missile cam, kill cam)
```

Each directory has an `index.js` written by the integrator as a small **working placeholder**. Its header and this
document define the API the rest of combat calls. Replace the internals, keep the API. Add files freely inside your
directory. If you need a change outside it, write it in `INTEGRATION.md` in your directory and in your final report
(unless your brief grants an exception). **No DOM / WebGL / AudioContext access at module top level** — the whole
`src/combat` tree is imported by node tools (`tools/combat-bench.mjs`), so only touch them inside `create…()` of the
non-headless modules (hud, input, ui, audio, fx, camera).

## 2. The `combat` object (`ctx.combat`)

```
combat.ctx          the simulator context (ARCHITECTURE.md §3)
combat.headless     true in node benches: no fx / hud / input / audio / ui modules, no aircraft visuals
combat.events       combat event bus: on(name, fn) → unsubscribe, emit(name, payload)        (§5; NOT ctx.events)
combat.rng          seeded () → [0,1) — use it instead of Math.random() for anything that affects the simulation
combat.active       a mission is loaded and its world is simulated
combat.mission      the running mission definition | null         combat.options   what it was started with
combat.result       null while undecided, else { outcome: 'success'|'failure', reason, stats, time }
combat.difficulty   'rookie' | 'veteran' | 'ace'
combat.clock        mission time in simulated seconds
combat.world        entities (§3)                 combat.targeting   player target selection
combat.ai  .weapons  .director  .fx  .hud  .input  .audio  .ui      the sub-modules (§6–§12)
combat.start(missionId, { aircraft, livery, difficulty, bot }) → boolean     combat.restart()     combat.abort()
combat.end(outcome, reason)       decide the mission (director only). The world keeps running afterwards.
combat.kill(victim, killer|null, weapon, info?)     destroy an entity (weapons / core). Emits 'kill'.
```

**Frame order** (`src/main.js`):
```
input.update → weather.update → combat.pre(dt) → session.update (player physics, floating origin, player visual)
→ combat.step(dt) → cameraRig.update → frame uniforms → terrain/…/effects/audio/hud/menu.update → combat.late(dt) → render
combat.pre   : combat.input.update, the bot pilot when it flies the player's aircraft
combat.step  : director.update → world.stepAircraft (AI pilot.update → flight model) → targeting.update → weapons.update
               → AI visuals placed in render space → fx.update
combat.late  : hud.update → audio.update → ui.update
```
`dt` is simulated seconds and is 0 while paused (use `ctx.time.realDt` for UI animation). `combat.step` does not run
its simulation part when `dt` is 0.

## 3. Entities (`combat.world`, `src/combat/world.js`)

Everything alive in a mission is an entity in one flat list — aircraft, missiles, flares, ground units.

```
world.entities   all live entities          world.aircraft   live aircraft (player included)
world.wrecks     shot-down aircraft still falling (alive === false; visuals still drawn)
world.player     the player's entity | null
world.spawnAircraft({ aircraft:'f16', team:'red'|'blue', position: Vector3 (world, y = alt MSL), heading (deg true),
                      speed (m/s), callsign, name, skill 0..1, livery, stores, loadout, order, tags }) → entity
world.create(fields) → entity record;  world.add(e);  world.remove(e)     for missiles, flares, ground units
world.enemiesOf(entityOrTeam, out[], kind='aircraft')   world.friendsOf(e, out[], kind)
world.nearestEnemy(e, maxRange, kind)   world.count(team, kind)   world.byId(id)
```

Entity fields (set by core unless noted):
```
id, kind ('aircraft'|'missile'|'flare'|'ground'|…), team ('blue'|'red'|'neutral'), alive, isPlayer, callsign, name
state      aircraft: the full AircraftState of core/state.js (position, velocity, quaternion in WORLD space, ias, mach,
           gLoad, aoa, altitude, agl, heading, pitch, roll, bodyRates, throttle, engines[], …)
           others: at least { position, velocity, quaternion }
forward, up, right   world unit vectors of the body axes (nose, up, right wing) — refreshed every step
radius     hit-sphere radius, m
def, sim, controls, visual, object3D     aircraft: definition, flight-model sim, the Controls object the pilot writes,
                                         visual + its THREE.Group (null when headless)
pilot      AI pilot (§7) | null for the human player
target     entity this one has designated | null (player: targeting.js; AI: its pilot)
skill      0..1          tags   free-form object for mission scripts          hidden   true → visual not drawn
— owned by weapons (§6): hp, maxHp, loadout, lock, trigger, damage, lastHitBy, lastHitWeapon, stats
— missiles: owner, target, spec, type, age        flares: owner, age, life
```

AI aircraft fly `createSim(…, { player: false })` — the same 6-DOF model as the player (≈ 15 µs per aircraft per frame),
with their own event bus, so `ctx.events` 'crash' / 'touchdown' always mean the player. Battle damage reaches the flight
model through `entity.sim.damage = { thrust, ctrl, drag, rollBias, pitchBias, engineOut[] }` and `entity.sim.destroy(reason)`
(see `src/physics/sim.js`, bottom). The player's entity wraps `ctx.player` (`ownsSim === false`).

Death: `combat.kill(victim, killer, weapon)` → aircraft leave `entities`/`aircraft` at once, `alive = false`, and fall as
wrecks (still stepped and drawn) until they hit the ground (`'wreck:impact'`) or 30 s pass. Set `entity.hidden = true`
to stop drawing the airframe (e.g. it disintegrated). The player's death also raises the simulator's own crash sequence.

## 4. Units and frames

World space: metres, +X east, +Y up (altitude MSL), +Z south; heading 0 = north = −Z (`util.js`: `headingVec`, `bearing`).
Body axes: +X right wing, +Y up, −Z nose (`util.js`: `toBody`, `toWorld`, `angleOff`, `geometry`). SI everywhere; show
pilots knots, feet, nautical miles, G. Positions of far-apart things are JS doubles in world space; convert to render
space with `ctx.world.toRender(worldPos, out)` every frame and handle the `'originShift'` event if you keep history.

## 5. Events (`combat.events`)

| event | payload | emitted by |
|---|---|---|
| `mission:start` | `{ mission, options }` | core |
| `mission:end` | `{ outcome, reason, stats, time }` (= `combat.result`) | core (`combat.end`) |
| `mission:abort` | `{ mission }` — world cleared (player left / restart) | core |
| `spawn` / `despawn` | `{ entity }` | core/world |
| `kill` | `{ victim, killer, weapon, info }` | core (`combat.kill`) |
| `player:down` | `{ killer, weapon }` | core |
| `wreck:impact` | `{ entity, position }` — a falling wreck reached the ground | core/world |
| `target:change` | `{ entity, target }` — the player's designated target changed | targeting |
| `cmd` | `{ name }` — `missile, flare, targetNext, targetPrev, targetNearest, targetClear, weaponNext` | input, ui |
| `gun:start` / `gun:stop` | `{ shooter }` | weapons |
| `bullet:hit` | `{ shooter, target, position }` | weapons |
| `damage` | `{ target, amount, source, weapon, position, hp }` | weapons |
| `missile:launch` | `{ shooter, missile, target, type }` | weapons |
| `missile:hit` | `{ missile, target, position }` | weapons |
| `missile:miss` | `{ missile, reason, position }` | weapons |
| `missile:decoyed` | `{ missile, flare }` | weapons |
| `flare` | `{ entity, flare }` | weapons |
| `lock:none` / `lock:acquiring` / `lock:locked` | `{ shooter, target, seeker }` | weapons |
| `rwr:lock` / `rwr:launch` | `{ source, target, missile? }` — target is being locked / fired on | weapons |
| `weapon:select` | `{ entity, selected }` | weapons |
| `weapon:nolock` | `{ entity }` — launch refused | weapons |
| `objective:update` | `{ objectives }` | director |
| `radio` | `{ from, text, priority, team, voice? }` — one radio line | director, ai |
| `score` | `{ points, reason, total }` | director |

Add events when you need them — document them in your directory's README and in your report. Listeners must tolerate
unknown extra fields. Never emit simulator `ctx.events` from combat (except the documented commands).

## 6. Weapons (`combat.weapons`) — `src/combat/weapons/`

```
specs                     weapon data: specs.gun, specs.missiles.{ir, radar} (name, short, seeker, rMin, rMax, fov, …)
bullets                   { n, items[] } pooled; the first n are live: { position, velocity, prev, age, team, tracer, owner }
missiles[], flares[]      live missile / flare entities (they are also in world.entities)
equip(entity, loadout?)   called by core on spawn: sets entity.hp/maxHp, entity.loadout = { gun: { rounds, firing, … },
                          missiles: { ir, radar }, flares, selected: 'ir'|'radar' }, entity.lock, entity.damage
setTrigger(entity, on)    hold / release the gun trigger          launchMissile(entity, type?) → missile | null
dropFlares(entity) → boolean        cycleWeapon(entity)
applyDamage(target, amount, { source, weapon, position })
lockState(entity) → entity.lock = { target, state: 'none'|'acquiring'|'locked', progress 0..1, seeker, inRange, range, rMin, rMax }
gunSolution(shooter, target, out) → { point: Vector3 (world aim point with lead + drop), tof, range, inRange }
update(dt), reset()
```
The player's intents arrive as `combat.events 'cmd'` (`missile`, `flare`, `weaponNext`) and `combat.input.trigger`.
AI pilots call the same functions a human does. `entity.damage` (`{ smoke 0..1, fire 0..1, … }`) is what fx/hud read.

## 7. AI (`combat.ai`) — `src/combat/ai/`

```
createPilot(entity, { skill, order }) → pilot
pilot.update(dt)         writes entity.controls (pitch, roll, yaw, throttle, speedbrake), picks entity.target, uses weapons
pilot.setOrder(order)    pilot.order     pilot.mode (short label: 'pursuit', 'evade', 'formation', …)     pilot.skill
orders: { type: 'engage', target? } | { type: 'patrol', waypoints: [Vector3], index } | { type: 'escort', leader, offset }
        | { type: 'cruise', heading (deg), alt } | (add more — document them)
```

## 8. Missions (`combat.director`) — `src/combat/missions/`

```
missions[]                mission definitions for the menu: { id, category, title, tagline, brief, aircraft, … }
getMission(id)            prepare(mission, options) → { aircraft, airport, mode:'air'|'runway', position {x,z}, alt, hdg,
                          spd, tod, weather, livery, stores, callsign, loadout }   (core starts the flight with it)
start(mission, options)   spawn the opening forces, set objectives        update(dt)        stop()
objectives[]              [{ id, text, state: 'active'|'done'|'failed', optional?, progress? }]
stats                     { kills, losses, shots, hits, missiles, score, … } (also world.player.stats)
radio(from, text, opts)   emits 'radio'
```
The director calls `combat.end('success'|'failure', reason)` once.

## 9. HUD and input — `src/combat/hud/`, `src/combat/input/`

`createCombatHud(combat) → { update(dt) }` draws the combat overlay (own canvas / DOM above the simulator HUD) from
`world`, `player.target`, `player.lock`, `weapons.gunSolution`, `director.objectives`, and the events.
`createCombatInput(combat) → { update(dt), trigger, bindings }` emits `'cmd'` and holds `trigger` (gun).
Keys (never Ctrl/Alt/Meta; ignored while the menu is open): gun `Space` (airborne; it stays the wheel brake on the
ground) or left mouse, missile `Enter` / `X`, flares `V`, next / previous target `Tab` / `Shift+Tab`, target nearest the
nose `Y`, switch missile `Z`.

## 10. Effects — `src/combat/fx/`

`createCombatFx(combat) → { update(dt) }`: tracers (from `weapons.bullets`), missile bodies and smoke trails, flares,
hits, explosions, battle-damage smoke/fire (`entity.damage`), falling wrecks, AI engine plumes/contrails. Draw on
`LAYERS.POST` with HDR radiance; follow ARCHITECTURE.md §6.

## 11. Audio — `src/combat/audio/`

`createCombatAudio(combat) → { update(dt) }`: gun, launches, fly-bys, hits, explosions, lock/launch warning tones, radio
voice for `'radio'` lines, music. Procedural Web Audio only; shares the simulator's AudioContext.

## 12. Screens — `src/combat/ui/`

`createCombatUi(combat) → { update(dt), openMissions(), isOpen }`: mission select, briefing, debrief; calls `combat.start`.

## 13. Testing

- **Headless bench (fast, no rendering):** `node tools/combat-bench.mjs <missionId> --seconds 240 --log --trace 10
  [--runs 20] [--seed 1] [--difficulty ace]` flies a mission in node with every aircraft on the AI, ~100× real time.
  `import { createBench } from '../../tools/combat-bench.mjs'` to script your own scenarios and `node --test` tests
  (`*.test.js` next to your code).
- **Screenshots (slow, software GL — one at a time, small sizes):**
  `node tools/shot.mjs --out shots/x.png --size 640x360 --params "mission=instant-2v2&combatbot=1&cam=chase" --skip 14 --frames 3`
  `mission=<id>` starts a mission, `combatbot=1` lets the AI fly the player's aircraft (action without a human),
  `--skip S` fast-forwards S simulated seconds without rendering, `--until "<expr with ctx>"` stops the fast-forward
  early, `--pre "<js>"` runs code in the page first (place the camera, spawn things, force a state), `--eval` prints a value.
  One rendered frame costs 4–5 s here: keep `--frames` at 2–4. **Look at your screenshots.**
- `node tools/build.mjs` must succeed and the page must boot with no console errors, with and without a mission.
