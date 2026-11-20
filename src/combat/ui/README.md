# Combat screens and combat controls

`src/combat/ui/` — mission select + briefing, combat settings, debrief.
`src/combat/input/` — combat keys, mouse, gamepad and touch fire controls.

## Files
| file | what |
|---|---|
| `ui/index.js` | controller + DOM (`createCombatUi`) |
| `ui/style.js` | the stylesheet (layout + combat-only pieces; everything else is the menu's own classes) |
| `ui/logic.js` | pure grouping / next-mission / formatting / custom-setup validation |
| `ui/progress.js` | saved progress + settings, one guarded localStorage key `skyward.combat.v1` |
| `ui/map.js` | briefing tactical map (canvas) |
| `ui/hooks.js` | menu entry points registered at runtime (see INTEGRATION.md) |
| `input/index.js` | controller (`createCombatInput`) |
| `input/map.js` | single source of truth for keys, pad buttons, touch buttons and the help rows |
| `*.test.js` | `node --test src/combat/ui/ui.test.js src/combat/input/input.test.js` |

## API
`createCombatUi(combat)` → `{ update(dt), openMissions(), isOpen }` (COMBAT.md §12), plus (additive):
- `openMissions(missionId?)` — with an id, opens straight into that mission's briefing.
- `debrief()` — show the debrief for the last decided mission now (skips the delay; tests / shots).
- `briefingMission` — id of the mission whose briefing is on screen, else null. Events: `combat.events` **`'briefing:open'` `{ missionId }`** when a briefing is shown (open or new selection) and **`'briefing:close'` `{ missionId, launched }`** when the screens leave it.
- `openSettings()` — open Combat settings (from mission select, the pause menu, or `?cbtui=settings`); Back returns there.
- `close()` — leave the screens (back to wherever they were opened from).
- `view` — `'missions' | 'settings' | 'debrief' | null`.
- `progress` — the progress store (`best(id)`, `completed(id)`, `mission(id)`, `record(id, difficulty, result)`, `getSetting`, `setSetting`).
- `settings` — `{ musicOn, musicVolume, radioVoice, radioVolume, sfxVolume, camKillCam, camFeel, flightMode (null = by difficulty | 'assist' | 'off'), aimHelp ('off'|'low'|'high'|'auto'), vibration }` as remembered (plus `difficulty`).

`createCombatInput(combat)` → `{ update(dt), trigger, bindings }` (COMBAT.md §9), plus (additive):
- `bindings` rows carry `id` (`gun, missile, flare, targetNext, targetPrev, targetNearest, weaponNext, restart`),
  `pad` (button names) and `touch` (button label) next to `group / action / keys` — the HUD's first-minute hints use them.
- `padBindings` — gamepad rows for the help screen (group `Combat gamepad`; PAD_MAP when hooked, else PAD_FREE).
- `padHooked()` — whether the simulator's input honours `padOwns` (`ctx.input.combatPadHook`).
- `padOwns(i)` — true when combat owns standard-gamepad button `i` this frame (src/input skips it).
- `touchVisible`, `release()` (drops the trigger). Export `createTouchButtons(parent, onPress, onHold)`.
- `actions` — plain functions for a touch dock: `gun(on)`, `missile()`, `flares()`, `targetNext()`, `targetPrev()`,
  `targetNearest()`, `targetThreat()`, `targetTap()` (tap = next, double tap = most dangerous), `toggleView()`,
  `switchMissile()`, `boost(on)`. All stand down unless a mission is live.
- `state` — refreshed every frame: `{ live, gun, firing, boost, target, targetName, lock, lockProgress, lockSeeker,
  missileMode ('auto'|'ir'|'radar'), missile (selected seeker), missiles { ir, radar }, rounds, flares, flareProgram,
  padlock, aim, aimLocked, lastNoLock }`.
- `setTouchButtons(false)` hides this module's own fire buttons (the dock owns them); `true` brings them back.
  The own buttons (and their CSS) are only built when `ctx.input.touch` does not exist (old base input): with the dock
  present nothing of `.cbt-inp-touch` / `TOUCH_PLACE` is created.
- Rail: on `mission:start` combat adds **Boost** (hold) and, with both IR and radar aboard, **Missile** (sub-label
  Auto / IR / Radar) via `ctx.input.touch.addButton`; removed on `mission:end` / `mission:abort`.
- `actions.viewDown()` / `actions.viewUp()`: tap = padlock toggle, hold > 0.3 s = `combat.camera.peek(true)` while held;
  `actions.peek(on)`; `state.peek`.

`combat.start(id, { aircraft, difficulty, custom })` is called with `custom` only for a custom mission
(`id === 'instant-custom'` or `def.custom`): `{ enemies 1..8, wingmen 0..3, enemyType id|'mixed', gunsOnly, startRange m,
altitude m, advantage 'neutral'|'offensive'|'defensive' }`.

Mission definition fields read (all optional): `id, category, order, title, tagline, brief (string or [paragraphs]),
location (airport id), tod, weather, aircraft, aircraftChoices, objectivesPreview, threat 1..5, minutes, custom`; for the map
also `start { airport, offset { bearing, distance }, hdg }`, `enemies / friends [{ bearing, distance }]` (placeholder
shape) or `map { center {x,z}, radius, player {x,z,hdg}, hostiles [{x,z}], friendlies [{x,z}] }`.
Result fields read (all optional): `combat.result = { outcome, reason, time, stats: { kills, assists, losses, shots, hits,
missiles, missileHits, damageTaken, score, rating, breakdown [{label, points}], medals [{id, title, text}] } }`.
Flight assist (COMBAT.md §15): `combat.assist.setMode('assist'|'off')` from `flightModeFor(settings.flightMode, difficulty)` (Assisted on rookie / veteran, Direct on ace, unless the player chose) and `setAimAssist(v)` from `aimHelpFor(aimHelp, difficulty)` (Off 0, Low 0.35, High 0.8, Auto: rookie 0.8 / veteran 0.45 / ace 0); applied at boot, live, on difficulty change and on `mission:start`. URL `?music=0` / `?radiovoice=0` override the stored sound switches.
Settings applied (every setter optional, called only when the value differs): `combat.audio.setMusicEnabled(on)` (or
`musicEnabled =`), `setMusicVolume(v)`, `setRadioVoice(on)`, `setRadioVolume(v)`, `setSfxVolume(v)`;
`combat.camera.setKillCam(on)`, `setFightCam(on)`, `setGunZoom(on)`, `setFeel(0..1)` (store keys camKillCam, camFight, camGunZoom, camFeel, shared with the camera). Applied at boot,
live on every change, and again on every `mission:start` (the camera is created after the UI). Default difficulty seeds
the briefing's difficulty selector.

## Behaviour
- **Entry**: a **Missions** tab in the menu's top bar (hangar, with a **New** badge until the first mission is
  attempted) and **Mission select** in the pause menu, both added at runtime by `hooks.js`. During a mission the pause
  menu also gets **Combat settings** and **Leave mission** (aborts to free flight: `html.cbt-active` removed, touch
  buttons gone, combat HUD hidden), and its Restart restarts the mission.
- **First run** (no attempt saved): the gunnery training mission is preselected, tagged **Start here** in the list, with
  a one-line hint in its briefing.
- **Combat settings**: Controls (flight controls Assisted / Direct, gun aim help Off / Low / High / Auto, vibration), Sound (music on/off + volume, radio voice on/off + volume, effects volume), Camera (kill cam, fight camera, gun zoom,
  shake 0..1), Default difficulty. Header button on mission select; pause menu during a mission. `?cbtui=missions[&cbtmission=<id>]` / `?cbtui=settings` open a screen at boot.
- **Mission select** lists `combat.director.missions` by category (Training, Campaign, Instant action, then anything
  else) in `order`, with completion ticks, best rating and threat. Wide screens show list and briefing side by side;
  at ≤ 720 px the list opens the briefing as its own page (Back / Esc returns).
- **Briefing**: category and number, title, tagline, threat / length / best, location · time · weather, tactical map,
  brief, objectives, custom setup (custom mission only), aircraft (choices, else "assigned"), difficulty
  (Rookie / Veteran / Ace → `combat.difficulty`, remembered), **Flight controls** (Assisted / Direct with a one-line
  explanation; a compact selector also sits in the always-visible footer above Fly, so no scrolling is needed), **Fly mission**.
- **Debrief**: 3.5 s after a success / 4.2 s after a failure (real time, counted only while unpaused and no menu is
  up), over the **frozen** world (the sim is paused; the camera slowly orbits the aircraft in `showcase`). Outcome +
  reason, rating badge, score count-up with "New best", breakdown, flight stats, awards. Primary action:
  **Next mission** after a campaign / training success with a next mission (labelled "Unlocked: …" on a first clear;
  opens its briefing), else **Retry**. Focus starts on it; Enter / Space activates it; **Esc goes to mission select**.
  Also Mission select, Hangar. Progress is saved on
  `mission:end` (completed, attempts, best score / rating per difficulty).
- **While a screen is up**: `isOpen` true; sim paused (`ctx.time.paused` + `'pause'`); camera `showcase` (so the
  simulator HUD and its touch controls hide); the menu's corner buttons, crash card and the yoke ring are hidden; every
  key is captured at window level (capture phase, `stopPropagation`) so neither the simulator's input nor the menu sees
  it — Esc = back, arrows move within lists / radio groups, Tab moves focus, Enter / Space activate. Gamepad: D-pad /
  left stick move focus, A activates, B or Start goes back. Leaving resumes the flight (camera restored) or hands the
  pause over to the menu; if the menu opens on its own (`menu:open`) the screens step aside.
- `localStorage` may be missing or throw: progress and settings then live for the session only.

## Control map (combat, mission running)
Simulator keys (src/input/bindings.js), left alone: W/S/↑/↓ pitch, A/D/←/→ roll, Q/E rudder, `,` `.` `/` trim, T autopilot,
R = PgUp / F - PgDn throttle, 1 idle, 9 MIL, 0 max, I engines, G gear, [ ] flaps, B speedbrake, Space wheel brakes,
K parking brake, H hook, L lights, N canopy, J wing sweep, C / Shift+C camera, M mouse yoke, U HUD, P pause,
Backspace restart, Esc menu; right-drag look, wheel zoom.

| action | keyboard | mouse | gamepad: PAD_MAP (needs `combatPadHook`) | gamepad: today (PAD_FREE) | touch |
|---|---|---|---|---|---|
| Gun (hold; safe on the ground) | `Space` | left button | RT | right stick click | GUN (hold) |
| Missile, best for the shot | `X`, `Enter` | right click | RB | – | MSL |
| Flares (3 releases over ~1 s) | `V` | | B | – | FLR |
| Next target, nearest the nose first / back | `Tab` / `Shift+Tab` | wheel (mouse aim on) | X / – | – | TGT |
| Most dangerous target | hold `Tab` | | | | double-tap TGT |
| Target nearest the nose | `Y` | middle click | Y | – | |
| Missile type Auto / IR / radar | `Z` | | LB | – | |
| Boost (afterburner while held) | `Shift` | | | | BOOST (rail) |
| Missile type Auto / IR / radar (two types aboard) | `Z` | | | | Missile (rail, sub-label) |
| Target view: tap = padlock, hold > 0.3 s = peek while held | `O` | | right stick click | Home | VIEW (dock) |
| Missile camera | `;` | | | | |

Two hands: right on the arrows or the mouse, left on Space (gun), Shift (boost), Tab (target), X (missile), V (flares),
Z, O. Only overlap with the simulator: Space (wheel brake on the ground, gun in the air) and Shift+C (camera previous
while boosting). A right / middle *drag* stays camera look; only a click (< 350 ms, < 6 px) fires / targets.
**Mouse aim** (Assisted mode, mouse user, simulator mouse yoke off): the pointer's offset from the screen centre is
written to `combat.assist.aim` and a small reticle shows it; a left click on the view also takes pointer lock (motion
then accumulates into a clamped aim point; Esc frees the mouse). Arrow / WASD keys suspend mouse aim until the mouse moves.
With the yoke on (M), mouse aim stays inactive and the yoke flies.
**Missile**: Auto fires IR inside its envelope, else radar; a held shot emits `weapon:nolock { entity, reason, text }`
(no target / no missiles / off boresight / out of range / too close / locking / no lock) and a press with no target
designates the most dangerous one. **Haptics** (Vibration setting): touch buzz while the gun fires and a thump when hit
(navigator.vibrate); gamepad dual-rumble likewise.

Restart is `Backspace` (core reset) or the pause menu, not `R` (simulator throttle). PAD_MAP applies only airborne in a
live mission; on the ground the simulator keeps every button. PAD_FREE uses only buttons the simulator does not map, so
nothing double-fires (a test scans src/input to prove it). Nothing
uses Ctrl / Alt / Meta. Keys are ignored while the menu or a combat screen is open, while paused and while typing in a
field; the trigger is released on window blur, tab switch, pause and menu open. Right-drag look, wheel zoom and the `M`
mouse-yoke toggle are unchanged (with the yoke on, the first left click also takes pointer lock).
Touch buttons (≥ 52 px; GUN largest at 72 px, red, bottom of the group under the right thumb) appear only on touch
devices while a mission runs and no screen is open, in their own container on the right edge, upper half (VIEW TGT /
FLR MSL / GUN GUN; 3 columns on screens ≤ 520 px tall), clear of the centre of the view and both bottom corners.
Placement is one block in `input/index.js`: `TOUCH_PLACE` (CSS) + `mountTouch()` (parent).
