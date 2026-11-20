# Combat UI / input — integration notes

**No file outside `src/combat/ui/` and `src/combat/input/` is modified.** (A first version edited `src/ui/menu/**` and
`src/input/index.js`; both were reverted because the mobile-layout rework touches those files in parallel.)
Everything that reaches into the simulator's UI is registered at runtime from one file, `ui/hooks.js`, and every hook
finds its anchor by id and silently does nothing if the anchor is gone.

## Runtime hooks (`ui/hooks.js`)
| hook | anchor | what |
|---|---|---|
| **Missions** tab | after `#menu-tab-hangar` | `button.menu-tab#menu-tab-missions` → `ctx.combat.ui.openMissions()` |
| **Mission select** | after `#menu-restart` (pause menu) | `button.menu-act#menu-pause-missions` → `openMissions()` |
| Restart restarts the mission | capture-phase click listener on `#menu-restart` | while `combat.active`: `ctx.menu.close(); combat.restart()` and stops the menu's own handler (a session restart would abort the mission); its text node reads "Restart mission" on each `menu:open` |
| Controls reference | appended to `#menu-root .menu-keys` | key groups "Combat" (`combat.input.bindings`) and "Combat gamepad" (`combat.input.padBindings`), built with the menu's classes |
| Crash card stands down | `html.cbt-active` while a mission runs + CSS `.cbt-active .menu-crash { display: none }` | the debrief owns that moment |
| Four tabs at phone width | CSS `@media (max-width: 460px) .menu-tabs .menu-tab { padding: 0 9px; font-size: 13px }` | |

While a combat screen is open, `html.cbt-ui-open` hides `.menu-corner`, `.menu-crash`, `.inp-yoke`, `.inp-touch` and
the combat touch buttons. "Leave to hangar" is the pause menu's existing **Back to hangar** (core aborts the mission
when the hangar session starts). When the menu is merged, the integrator may replace these hooks with real entry points
(the menu would call `ctx.combat?.ui?.openMissions?.()`, read `ctx.combat?.input?.bindings`, check
`ctx.combat?.active` in its crash listener) and delete `hooks.js`.

## Keyboard and mouse — handled from this side
- Combat keys `Enter X V Tab Y Z` are not in the simulator's key table. `Space` is shared on purpose (wheel brake on the
  ground, gun only when the press starts airborne; braking in the air is harmless). Left click on the canvas is unused by
  the simulator except to request pointer lock while the mouse yoke is on.
- While a combat screen is open, its `window` keydown listener runs in the **capture** phase and calls
  `stopPropagation()`, so neither the simulator's input nor the menu sees keys (no Backspace restart, no P pause, no Esc
  opening the pause menu under the screen). Keyups are swallowed only for keys pressed while the screen was open, so a
  key held before it opened cannot stick in the simulator's input.

## Gamepad — one optional patch for `src/input/index.js` (not applied)
Without it, combat uses only the free button: **right stick click = gun (hold)**; missiles / flares / targets are on
keyboard and touch. The combat screens navigate with the pad (D-pad / stick, A, B) and undo the simulator's own A (gear)
and B (speedbrake) toggles in the same frame (physics is paused then; both are toggles). With the patch, combat owns
A gun, B flares, X missile, Y next target, R3 nearest, D-pad up switch missile, D-pad down speedbrake — **only while
airborne in a live mission** (and every button while a combat screen is open); on the ground the simulator keeps its map.

In `pollPad`, standard-mapping branch (after `const open = menuOpen();`):
```js
const owned = (i) => !!(ctx.combat?.input?.padOwns?.(i));
// then guard each edge-triggered use, e.g.
if (press(0) && !open && !owned(0)) command('gearToggle');
if (press(1) && !open && !owned(1)) toggleSpeedbrake();
if (press(2) && !owned(2)) fire('flapsDown');   // likewise 3, 8, 9, 14, 15
const up = !!(bt[12] && bt[12].pressed) && !owned(12), dn = !!(bt[13] && bt[13].pressed) && !owned(13);
```
and once in `createInput`: `input.combatPadHook = true;` (combat switches to the full map when it sees it; the UI then
stops undoing A / B).

## Touch fire buttons
Own container `.cbt-inp-touch` (in `ctx.uiRoot`), placed by one CSS block at the top of `input/index.js`: right edge
(`right: max(16px, safe-area-inset-right)`), `top: clamp(64px + safe-area-inset-top, 28vh, 280px)` (64px + inset on
screens ≤ 520 px tall, where the grid becomes 2 × 2). That keeps it below top-right buttons and above any bottom-right
throttle up to ~44 % of the height, and away from a bottom-left stick. Buttons are built by
`createTouchButtons(parent, onPress, onHold)` (exported), so they can be re-parented into a future touch-slot API.

## Requests (owned by others)
- Simulator HUD (`src/ui/hud`): hides on `ctx.menu.isOpen` or the `showcase` camera; the combat screens switch the
  camera to `showcase`, so it hides today. A direct `|| ctx.combat?.ui?.isOpen` would be more robust.
- Combat HUD: hide while `combat.ui.isOpen` (agreed). The placeholder HUD still draws under the debrief.
