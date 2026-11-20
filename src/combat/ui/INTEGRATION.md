# Combat UI / input — integration notes

**No file outside `src/combat/ui/` and `src/combat/input/` is modified.** (A first version edited `src/ui/menu/**` and
`src/input/index.js`; both were reverted because the mobile-layout rework touches those files in parallel.)
Everything that reaches into the simulator's UI is registered at runtime from one file, `ui/hooks.js`, and every hook
finds its anchor by id and silently does nothing if the anchor is gone.

## Runtime hooks (`ui/hooks.js`)
| hook | anchor (fallbacks) | what |
|---|---|---|
| **Missions** tab + New badge | after `#menu-tab-hangar` (its parent, `.menu-tabs`, `#menu-root [role="tablist"]`, `#menu-root nav`) | `button.menu-tab#menu-tab-missions` → `openMissions()`; `.cbt-ui-newbadge` until any attempt |
| **Mission select** | after `#menu-restart` (its parent, `[data-view="pause"] .menu-actions`, `#menu-resume`'s parent) | `button.menu-act#menu-pause-missions` |
| **Combat settings** | same list | `#menu-pause-combat` → `openSettings()`; shown only during a mission |
| **Leave mission** | same list | `#menu-pause-leave` → `ctx.menu.close(); combat.abort()`; shown only during a mission |
| Restart restarts the mission | capture click listener on `#menu-restart` | while `combat.active`: `ctx.menu.close(); combat.restart()`, stops the menu's handler; label "Restart mission" / "Restart flight" |
| Controls reference | appended to `#menu-root .menu-keys` (`.menu-keys`) | groups "Combat" and "Combat gamepad", built with the menu's classes |
| Crash card stands down | `html.cbt-active` (set at once on `mission:start` / `mission:abort`, re-checked every frame) + CSS `.cbt-active .menu-crash { display: none }` | the debrief owns that moment |
| Five tabs at phone width | CSS `@media (max-width: 460px) .menu-tabs .menu-tab { padding: 0 9px; font-size: 13px }` | |

Every hook finds its anchor through the fallbacks, does nothing if none exists, and a `MutationObserver` on
`ctx.uiRoot` (microtask-debounced) re-attaches anything the menu re-renders away. `DEPENDS` (exported from `hooks.js`)
is the authoritative list of base-UI dependencies:
- ids: `#menu-tab-hangar`, `#menu-restart`, `#menu-resume`, `#menu-root`
- classes: `.menu-tabs`, `.menu-tab`, `.menu-actions`, `.menu-act`, `.menu-act-chev`, `.menu-act-dim`, `.menu-keys`,
  `.menu-keygroup`, `.menu-h`, `.menu-group`, `.menu-keyrow`, `.menu-keyrow-a`, `.menu-keyrow-k`, `.menu-kbd`,
  `.menu-kor`, `.menu-crash`, `.menu-corner`, `[data-view="pause"]`; the combat screens reuse the menu's design
  classes (`.menu-root`, `menu-panel/scroll/sec/h/row/chip/seg/segbtn/switch/range/act/btn/fly`, `glass*`)
- simulator `.inp-yoke`, `.inp-touch` (hidden while a combat screen is open)
- API: `ctx.menu.isOpen`, `.view`, `.open(view)`, `.close()`, `'menu:open'`; `ctx.time.paused` + `'pause'`;
  `ctx.cameraRig.mode` (`'showcase'`); `ctx.input.touchEnabled`, optional `ctx.input.combatPadHook`; `ctx.uiRoot`.

While a combat screen is open, `html.cbt-ui-open` hides `.menu-corner`, `.menu-crash`, `.inp-yoke`, `.inp-touch` and
the combat touch buttons. When the menu is merged, the integrator may replace these hooks with real entry points and
delete `hooks.js`.

## Keyboard and mouse — handled from this side
- Combat keys `Enter X V Tab Y Z` are not in the simulator's key table. `Space` is shared on purpose (wheel brake on the
  ground, gun only when the press starts airborne; braking in the air is harmless). Left click on the canvas is unused by
  the simulator except to request pointer lock while the mouse yoke is on.
- While a combat screen is open, its `window` keydown listener runs in the **capture** phase and calls
  `stopPropagation()`, so neither the simulator's input nor the menu sees keys (no Backspace restart, no P pause, no Esc
  opening the pause menu under the screen). Keyups are swallowed only for keys pressed while the screen was open, so a
  key held before it opened cannot stick in the simulator's input.

## Gamepad
Combat reads `navigator.getGamepads()` itself (first connected pad with `mapping === 'standard'`), from `combat.pre`,
edge-detected per button, nothing touched in src/input.

**Default, PAD_FREE (no patch):** right stick click (11) = gun (hold), Home (16) = padlock. The simulator maps every
other standard button (A gear, B speedbrake, X / Y flaps, LB / RB rudder, LT / RT throttle, Back camera, Start menu,
L3 brakes, D-pad trim / camera), so these are the only two that cannot double-fire. Missiles / flares / targets stay on
keyboard and touch. The combat screens navigate with the pad (D-pad / stick, A, B / Start back) and undo the simulator's
own A (gear) and B (speedbrake) toggles in the same frame (physics is paused; both are toggles).

**Full map, PAD_MAP (only if src/input opts in):** RT gun (analog, on 0.35 / off 0.2), RB missile, B flares, X next
target, Y nearest target, LB switch missile, R3 padlock, airborne in a live mission only. Conflicts with the base map,
which src/input must skip while `ctx.combat.input.padOwns(i)` is true: RT throttle-up, RB right rudder, B speedbrake,
X / Y flaps, LB left rudder. Patch in `pollPad` (standard branch):
```js
const owned = (i) => !!(ctx.combat?.input?.padOwns?.(i));
// guard each use of buttons 1 2 3 4 5 7, e.g.
if (press(1) && !open && !owned(1)) toggleSpeedbrake();
const rt = owned(7) ? 0 : (bt[7]?.value || 0);
```
plus `input.combatPadHook = true;` once in `createInput` (combat switches to PAD_MAP and the UI stops undoing A / B).

## Touch fire buttons
Own container `.cbt-inp-touch`. Placement is **one block** in `input/index.js`: `TOUCH_PLACE` (CSS: right edge,
`right: max(16px, safe-area-inset-right)`, `top: clamp(64px + safe-area-inset-top, 24vh, 260px)`, 60 px + inset on
screens ≤ 520 px tall) and `mountTouch()` (returns the parent, today `ctx.uiRoot`). For a base touch-slot API, make
`mountTouch()` return the slot and drop `TOUCH_PLACE`; `createTouchButtons(parent, onPress, onHold)` (exported) does not
care where it lives. Layout VIEW TGT / FLR MSL / GUN GUN (GUN 72 px, under the thumb); short screens 3 columns. Nothing
sits in the bottom corners or over the centre of the view. Shown only on touch devices with a mission running, no
screen open and not in the showcase camera; hidden at once on `mission:abort`. VIEW toggles padlock and lights while the
padlock camera is on.

## Touch dock hand-over
The mobile thread's dock can own the fire buttons: call `combat.input.setTouchButtons(false)` and wire its buttons to
`combat.input.actions` (`gun(on)`, `missile()`, `flares()`, `targetTap()` / `targetNext()` / `targetThreat()`,
`toggleView()`, `switchMissile()`, `boost(on)`); read `combat.input.state` for lit states and counts. Layout of the
existing buttons is unchanged this round.

## Requests (owned by others)
- Touch dock (src/input/touch.js): VIEW has only `onDown → actions.toggleView()`. For long-press peek, wire
  `onDown → actions.viewDown()` and `onUp → actions.viewUp()` (both exist; tap still toggles padlock on release,
  hold > 0.3 s peeks while held); light VIEW from `state.padlock || state.peek`.
- Simulator HUD (`src/ui/hud`): hides on `ctx.menu.isOpen` or the `showcase` camera; the combat screens switch the
  camera to `showcase`, so it hides today. A direct `|| ctx.combat?.ui?.isOpen` would be more robust.
- Combat HUD: hide while `combat.ui.isOpen` (agreed). The placeholder HUD still draws under the debrief.
- Combat HUD: show `weapon:nolock`'s `text` (e.g. NO TARGET / OUT OF RANGE / TOO CLOSE / NOSE ON TARGET / LOCKING)
  instead of the fixed "NO LOCK"; use `HUD_HINTS` from `src/combat/input/map.js` for the hint card (panels.js keeps a
  copy today); show 'AUTO SELECTED' for `weapon:select { selected: 'auto' }` (it already does, by falling back).
- Weapons: a single-flare release (the programme is 3 releases of the weapons' 2-flare salvo today).
