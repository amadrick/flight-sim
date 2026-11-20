# Combat screens and combat controls

`src/combat/ui/` — mission select + briefing, combat sound settings, debrief.
`src/combat/input/` — combat keys, mouse, gamepad and touch fire controls.

## Files
| file | what |
|---|---|
| `ui/index.js` | controller + DOM (`createCombatUi`) |
| `ui/style.js` | the stylesheet (layout + combat-only pieces; everything else is the menu's own classes) |
| `ui/logic.js` | pure grouping / next-mission / formatting / custom-setup validation |
| `ui/progress.js` | saved progress + settings, one guarded localStorage key `skyward.combat.v1` |
| `ui/map.js` | briefing tactical map (canvas) |
| `input/index.js` | controller (`createCombatInput`) |
| `input/map.js` | single source of truth for keys, pad buttons, touch buttons and the help rows |
| `*.test.js` | `node --test src/combat/ui/ui.test.js src/combat/input/input.test.js` |

## API
`createCombatUi(combat)` → `{ update(dt), openMissions(), isOpen }` (COMBAT.md §12), plus (additive):
- `openMissions(missionId?)` — with an id, opens straight into that mission's briefing.
- `debrief()` — show the debrief for the last decided mission now (skips the delay; tests / shots).
- `close()` — leave the screens (back to wherever they were opened from).
- `view` — `'missions' | 'settings' | 'debrief' | null`.
- `progress` — the progress store (`best(id)`, `completed(id)`, `mission(id)`, `record(id, difficulty, result)`, `getSetting`, `setSetting`).
- `settings` — `{ musicOn, musicVolume, radioVoice }` as remembered.

`createCombatInput(combat)` → `{ update(dt), trigger, bindings }` (COMBAT.md §9), plus (additive):
- `bindings` rows carry `id` (`gun, missile, flare, targetNext, targetPrev, targetNearest, weaponNext, restart`),
  `pad` (button names) and `touch` (button label) next to `group / action / keys` — the HUD's first-minute hints use them.
- `padBindings` — gamepad rows for the help screen (group `Combat gamepad`).
- `padOwns(i)` — true when combat owns standard-gamepad button `i` this frame (src/input skips it).
- `touchVisible`, `release()` (drops the trigger).

`combat.start(id, { aircraft, difficulty, custom })` is called with `custom` only for a custom mission
(`id === 'instant-custom'` or `def.custom`): `{ enemies 1..8, wingmen 0..3, enemyType id|'mixed', gunsOnly, startRange m,
altitude m, advantage 'neutral'|'offensive'|'defensive' }`.

Mission definition fields read (all optional): `id, category, order, title, tagline, brief (string or [paragraphs]),
location (airport id), tod, weather, aircraft, aircraftChoices, objectivesPreview, threat 1..5, minutes, custom`; for the map
also `start { airport, offset { bearing, distance }, hdg }`, `enemies / friends [{ bearing, distance }]` (placeholder
shape) or `map { center {x,z}, radius, player {x,z,hdg}, hostiles [{x,z}], friendlies [{x,z}] }`.
Result fields read (all optional): `combat.result = { outcome, reason, time, stats: { kills, assists, losses, shots, hits,
missiles, missileHits, damageTaken, score, rating, breakdown [{label, points}], medals [{id, title, text}] } }`.
Audio (all optional): `combat.audio.setMusicVolume(v)`, `combat.audio.musicEnabled` (set) / `setMusicEnabled(on)`,
`combat.audio.setRadioVoice(on)`; applied at boot, on change and on every `mission:start`.

## Behaviour
- **Entry**: the menu's top bar has a **Missions** tab (hangar), the pause menu has **Mission select**; both call
  `ctx.combat.ui.openMissions()`. `?cbtui=missions[&cbtmission=<id>]` / `?cbtui=settings` open a screen at boot.
- **Mission select** lists `combat.director.missions` by category (Training, Campaign, Instant action, then anything
  else) in `order`, with completion ticks, best rating and threat. Wide screens show list and briefing side by side;
  at ≤ 720 px the list opens the briefing as its own page (Back / Esc returns).
- **Briefing**: category and number, title, tagline, threat / length / best, location · time · weather, tactical map,
  brief, objectives, custom setup (custom mission only), aircraft (choices, else "assigned"), difficulty
  (Rookie / Veteran / Ace → `combat.difficulty`, remembered), **Fly mission**.
- **Debrief**: 3.5 s after a success / 4.2 s after a failure (real time, counted only while unpaused and no menu is
  up), over the **frozen** world (the sim is paused; the camera slowly orbits the aircraft in `showcase`). Outcome +
  reason, rating badge, score count-up with "New best", breakdown, flight stats, awards. Actions: Next mission
  (successes with a next mission: opens its briefing), Retry, Mission select, Hangar. Progress is saved on
  `mission:end` (completed, attempts, best score / rating per difficulty).
- **While a screen is up**: `isOpen` true; sim paused (`ctx.time.paused` + `'pause'`); camera `showcase` (so the
  simulator HUD and its touch controls hide); the menu's corner buttons, crash card and the yoke ring are hidden; every
  key is captured at window level (capture phase, `stopPropagation`) so neither the simulator's input nor the menu sees
  it — Esc = back, arrows move within lists / radio groups, Tab moves focus, Enter / Space activate. Gamepad: D-pad /
  left stick move focus, A activates, B or Start goes back. Leaving resumes the flight (camera restored) or hands the
  pause over to the menu; if the menu opens on its own (`menu:open`) the screens step aside.
- `localStorage` may be missing or throw: progress and settings then live for the session only.

## Control map (combat, mission running)
| action | keyboard | mouse | gamepad (standard, airborne) | touch |
|---|---|---|---|---|
| Gun (hold) | `Space` (airborne; wheel brake on the ground) | left button on the 3D view (airborne) | A | GUN (hold) |
| Missile | `Enter`, `X` | | X | MSL |
| Flares | `V` | | B | FLR |
| Next / previous target | `Tab` / `Shift+Tab` | | Y | TGT |
| Target nearest the nose | `Y` | | R3 | |
| Switch missile type | `Z` | | D-pad up | |
| Speedbrake | `B` (simulator) | | D-pad down (moved from B) | (simulator) |
| Restart mission | `Backspace` (core) | | | |

On the ground the simulator keeps every gamepad button (A gear, B speedbrake, X / Y flaps, D-pad trim). Nothing uses
Ctrl / Alt / Meta. Keys are ignored while the menu or a combat screen is open, while paused and while typing in a field;
the trigger is released on window blur, tab switch, pause and menu open. Right-drag look, wheel zoom and the `M`
mouse-yoke toggle are unchanged (with the yoke on, the first left click also takes pointer lock).
Touch buttons (≥ 52 px) appear only on touch devices while a mission runs: a 2×2 cluster (MSL FLR / wide GUN) above the
simulator's button grid in portrait, to the left of it on short (≤ 520 px tall) screens.
