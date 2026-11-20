# Combat audio — integration notes

## The one edit outside this directory: `src/audio/index.js` (granted exception)

Two read-only getters were added to the simulator audio API object (5 lines, additive, no behaviour change):

```js
let graphRef = null;   // next to the other state
/** add-on audio (combat): the live graph once the AudioContext exists, else null. Same object every call. */
get graph() { return ac && M ? (graphRef ||= { ac, flightIn: M.flightIn, ambIn: M.ambIn, master: M.master }) : null; },
/** interior/exterior blend of the flight sounds (0 = outside view, 1 = cockpit) */
get interiorMix() { return mixS; },
```

Combat audio polls `ctx.audio.graph` every frame (cheap getter, cached object) and builds its own graph the first time it
is non-null. So it starts the moment the simulator creates its AudioContext after the first user gesture, and it does
nothing at all before then.

## Routing into the simulator's mix

| combat bus | connects to | why |
|---|---|---|
| sfx bus → cockpit `Dual` (player's gun, launches, flares, hits on the airframe) and world `Dual` (explosions, other jets, distant guns, fly-bys) | `M.flightIn` | Same bus as the flight sounds, so it is muted in pause and ducked to 0.12 in menus by the simulator. It also goes through the same compressor/limiter. The `Dual`s follow `ctx.audio.interiorMix`. |
| warnings bus | `M.flightIn` | Tones play in every camera: full level in the cockpit, 0.75 outside. |
| radio bus (squelch, static, murmur) | `M.flightIn` | Paused or in menus, nothing is spoken. Queued lines go stale and are dropped. |
| music bus | `M.master` (after the user's master volume) | It has its own ducking: 0.35 while paused and 0.5 with the menu open. Music keeps playing under menus. |

## What it reads

- `combat.world.{player, aircraft}`, `combat.weapons.{threatsTo, missiles, specs}`, `combat.result`, `combat.mission.{id, music, start.tod}`, `combat.input.trigger`.
- `ctx.cameraRig.{worldPosition, velocity}`, `ctx.camera.quaternion`, `ctx.time.{paused, realDt, timeOfDay}`, `ctx.menu.isOpen`, `ctx.params.raw.{music, radiovoice}`.
- From the player entity: `lock.{state, seeker, target}`, `loadout.gun.{type, spec.rof, spec.spinUp, spin, rounds, max}`, `damage.fire`, `hp/maxHp`, `callsign`.

## Events it listens to

`gun:start/stop`, `missile:launch`, `flare`, `damage`, `bullet:hit`, `bullet:near`, `missile:hit`, `missile:miss` (only when `detonated`), `kill`, `wreck:impact`, `collision`, `rwr:lock`, `rwr:launch`, `missile:active`, `weapon:nolock`, `target:change`, `weapon:select`, `fire:start`, `engine:out`, `radio`, `mission:start`, `mission:abort`, `player:down`.

The player's own death is left to the simulator's crash audio. A kill where the victim `isPlayer` makes no explosion.

## For the UI agent (settings)

`ctx.combat.audio`:

- `setMusicVolume(0..1)` / `musicVolume` (default 0.8)
- `musicEnabled` (get/set) / `setMusicEnabled(bool)`. The URL parameter `music=0` turns music off.
- `setRadioVoice(bool)` / `radioVoice`: speech synthesis on or off. Off uses the procedural radio murmur. `radiovoice=0` in the URL turns it off.
- `setRadioVolume(0..1)`, `setSfxVolume(0..1)`
- `mood` and `info` are for diagnostics (cue, section, bar, voices, current radio line).

Nothing is persisted, so the UI should store these settings if it wants them to survive a reload.

## Requests for other modules (optional)

- Missions: set `mission.music = 'sweep' | 'nightfall'` to choose the cue. Otherwise night start times (before 06:30 or after 19:00) get Nightfall, and other missions are picked by a hash of the mission id. Put `voice` on `'radio'` events; without it the role is guessed from `team` / `from`.
- `node --test src/combat/audio` runs `tests.mjs` through the local `package.json` (`main`), the same pattern the weapons module uses.
