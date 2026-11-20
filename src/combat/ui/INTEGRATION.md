# Combat UI / input — edits outside src/combat/ui and src/combat/input

All small, additive and behaviour-preserving when no mission is running. `ctx.combat` is created after the menu and
the input, so every access is lazy (`ctx.combat?.…` at call time).

## src/ui/menu/ (exception (a))
| file | change | why |
|---|---|---|
| `icons.js` | new `ICON.missions` (crosshair line icon) | icon for the Missions tab |
| `index.js` ~158 | **Missions** tab in the top bar (Hangar · Missions · Settings · Controls) → `ctx.combat.ui.openMissions()` | prominent entry to combat from the hangar |
| `index.js` ~344, ~354 | pause menu: restart button keeps its id but its label is a span; new **Mission select** button (`#menu-pause-missions`) → `openMissions()` | in-mission entry points |
| `index.js` `syncPause` | label reads **Restart mission** while `ctx.combat.active`; mission title above the aircraft line; Mission select hidden if `ctx.combat.ui` is missing | |
| `index.js` `restart()` | while `ctx.combat.active`: `close(); ctx.combat.restart()` instead of `ctx.session.restart()` | a plain session restart would abort the mission (core aborts on `session:start`) |
| `index.js` new `openMissions()` | guarded call into `ctx.combat?.ui?.openMissions?.()` | |
| `index.js` `renderKeys` | appends `ctx.combat.input.bindings` (group `Combat`) and `padBindings` (group `Combat gamepad`); re-rendered once the first time the Controls view is shown after combat exists | combat keys on the help screen |
| `index.js` `'crash'` listener and `showCrash()` | return early while `ctx.combat?.active` | the combat debrief owns the moment after a crash / shoot-down |
| `style.js` end | `@media (max-width: 460px) { .menu-tab { padding: 0 9px; font-size: 13px } }` | four tabs still fit at 400 px |

"Leave to hangar" is the pause menu's existing **Back to hangar** (core aborts the mission when the hangar session
starts). Gamepad LB / RB tab cycling still covers Hangar / Settings / Controls only.

## src/input/index.js (exception (b)) — `pollPad`, standard mapping only
```js
const owned = (i) => !!(ctx.combat && ctx.combat.input && ctx.combat.input.padOwns && ctx.combat.input.padOwns(i));
```
Every edge-triggered button (`A` gear, `B` speedbrake, `X` / `Y` flaps, Back / D-pad left-right camera, Start menu) and
the D-pad up / down trim are skipped when `owned(i)` is true. Why: without it the gamepad gun (A) would also cycle the
landing gear, missile (X) / target (Y) would move the flaps, flares (B) would toggle the speedbrake, and while a mission
screen is open (the menu is closed then) A / B / Start would fire gear / speedbrake / the pause menu underneath it.
`padOwns(i)` is true only (1) while a combat screen is open (any button: the screens navigate with the pad) or (2) during
a live mission, airborne, not in the menu, for buttons 0, 1, 2, 3, 11, 12, 13. On the ground and outside missions it
is always false, so the simulator's gamepad map is unchanged. Analog axes (sticks, triggers, LB / RB rudder) are never
touched. Keyboard and mouse needed no change: combat keys (`Enter X V Tab Y Z`) are not in the simulator's key table,
`Space` is shared on purpose (brake on the ground, gun airborne; braking in the air is harmless), left click is unused
by the simulator except to take pointer lock while the mouse yoke is on, and the combat screens capture keys at window
level before the simulator's listeners.

## Requests (not done — owned by others)
- **Simulator HUD** (`src/ui/hud/index.js:129`): it hides on `ctx.menu.isOpen` or the `showcase` camera. The combat
  screens switch the camera to `showcase` so the HUD hides today; a direct `|| ctx.combat?.ui?.isOpen` there would be
  more robust.
- **Combat HUD**: hide while `combat.ui.isOpen` (agreed).
- **Missions**: the screens read the fields listed in README.md; `instant-custom` receives `options.custom`.
