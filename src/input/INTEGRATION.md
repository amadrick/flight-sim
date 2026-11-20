# Input integration notes
- No integrator-owned file changes required.
- `ctx.input`: `{ update(dt), bindings, gamepadBindings, mode, mouseYoke, touchEnabled, touch, gamepadConnected, lookDelta{x,y} px/frame, zoomDelta (wheel notches/frame, + = scroll toward user = zoom out), setMouseYoke(on), setTouch(on), dispose() }`.
- `controls.lookX/lookY`: right = +X, down = +Y (mouse drag / right stick); mouse look springs back to 0 on release. `controls.zoom` is a decaying impulse (+ = out).
- Menu help screen: render `ctx.input.bindings` (and `gamepadBindings`); both are plain `{group, action, keys[]}`.
- Input reads `ctx.menu.isOpen` and `ctx.cameraRig.mode === 'showcase'` (hides touch UI). Escape and P (and gamepad Start) are the only commands emitted while the menu is open.
- Gamepad: standard mapping — left stick roll/pitch, right stick look, RT/LT throttle rate, LB/RB rudder, A gear, B speedbrake, X flaps down, Y flaps up, D-pad up/down trim, left/right camera, Back camera next, Start menu, L3 brakes. Non-standard devices use a best-effort flight-stick layout (axes 0/1 stick, 2 twist rudder, 3 throttle slider, absolute only after it moves).

## Touch (phones, tablets)
Files: `touch.js` (DOM, pointer handling), `layout.js` (pure layout, tested in `layout.test.js`), `prefs.js` (Settings →
Touch controls, `localStorage skyward.touch`), `logic.js` (`touchRaw` / `touchShape` / `autoCoordYaw` / `throttleDetent`).

- Auto-enables on `(pointer: coarse)`; `?touch=1` forces it, `?touch=0` disables it. Hidden while the menu is open, in the hangar showcase and after a crash.
- Hybrid devices (touch screen + keyboard / gamepad): the first touch (`pointerType: 'touch'`) shows the touch controls; a flight
  key or gamepad input hides them again (not while the menu is open; `?touch=0/1` pins the choice).
- Every flight-time element owns a rectangle computed by `touchLayout(W, H, safeAreaInsets, opts)`; nothing overlaps at any
  size from 320×568 to 1366×1024, free flight or mission, right- or left-handed, with or without the rudder slider, 0–4 extra
  buttons, a dock and hinges (unit-tested). The real DOM is checked too: `node tools/mobile-shots.mjs [--ui] --overlap`
  measures every visible HUD, combat and touch element on every device in the matrix (free flight + mission) and fails on any
  intersection, off-screen part or element on a hinge.

  | region | landscape (primary) | portrait |
  |---|---|---|
  | stick zone (floating stick, right thumb) | right part below Cam / Menu (left of the fire cluster in a mission) | right of the throttle |
  | throttle (left thumb, relative drag, detents at idle / MIL, red AB zone above MIL) | bottom-left | bottom-left |
  | Sys (opens the systems drawer) + Gear · AP · Flaps − · Flaps + · Spd brk · Brake (hold) | Sys above the throttle, 2×3 grid beside it | one row (two under 360 px) above the controls |
  | rudder slider (only with the Settings switch; default = auto-coordinated) | bottom centre | under the stick zone |
  | Cam · Menu, View (missions: padlock / target view) | top-right | top-right |
  | fire cluster (missions): GUN (big) · MSL · TGT + FLR | right edge, bottom-aligned, under the right thumb beside the stick | beside the stick zone |
  | extra-button rail (`addButton`) | right edge under Cam/Menu | row above the action buttons |
  | `hud` (data strip) / `cbt` (combat objectives + stores) / `radar` / `subs` (radio) / `toast` | strip top-left; cbt under it; radar square above the fire cluster; subs bottom of `clear` | strip, cbt under it |
  | `clear` (free area for a centred conformal HUD; LOOK drags land here) | between the left block and the stick zone | under the HUD |
- Systems drawer (pref `drawer`, default `'auto'`): in the air only Sys shows; Gear and Flaps appear near the ground (on the
  ground, AGL < 300 m, gear down or flaps out), Brake on the ground or with the gear down. Sys opens all six for 8 s after
  the last use. `'open'` always shows them.
- LOOK: dragging on empty screen (`.inp-look`, under every control, touch / pen only) pans the view; the offset stays after
  release; a double tap recentres; camera changes and new flights recentre. Feeds `controls.lookX/lookY` and `input.lookDelta`.
- Stick shaping (exact): floating base where the thumb lands; full deflection at `throw = layout.stickR / sensitivity` px
  (the base trails the thumb beyond that); `raw = (dx, dy) / throw` clipped to the unit circle (`touch.raw`, +y = stick
  back); shaped = radial dead zone 0.06 (`m' = (m − 0.06) / 0.94`) then per-axis `0.65·v + 0.35·v³`
  (`TOUCH_STICK = { dead: 0.06, expo: 0.35, coord: 0.28 }`); roll = shaped x, pitch = −shaped y. Release returns to centre
  (pref `autoCentre`; off = the last deflection is held). Edge of throw = 6 ms haptic tick.
- Rudder: slider while touched (dead zone 0.06, expo 0.2), else `yaw = clamp(0.28 · roll)` (auto-coordination) unless
  `touch.autoCoord = false` (then 0).
- Throttle: relative drag; detents (haptic) at 0, at MIL (`AB_DETENT` 0.9, ±0.03, AB aircraft only) and at 1.
- Haptics (`navigator.vibrate`, pref `haptics`): system buttons, detents, stick edge, recentre. GUN / MSL do not buzz on tap
  (combat buzzes on fire and hits).
- Prefs (`touch.prefs`): `{ sensitivity 0.5–2, lefty (mirror everything), rudder (slider), autoCentre, haptics, drawer }`.
- Safe areas: insets read from `env(safe-area-inset-*)` (a probe element); every target is ≥ 44 px; `viewport-fit=cover`,
  `maximum-scale=1, user-scalable=no` are added to the viewport meta if missing; while the touch UI is up, pinch
  (`gesturestart`, two-finger `touchmove`), double-tap zoom, long-press callouts and text selection are suppressed.
- Dual-screen / foldable devices spanned across a hinge: `segments.js` reads the gap from `window.viewport.segments`, else
  `env(viewport-segment-*)`; the layout keeps every control and HUD region off the hinge. Nothing is keyed to device names:
  only viewport size, aspect, `(pointer: coarse)`, safe-area insets and segments.
- Pointer events with pointer capture; each control tracks its own `pointerId`, so stick + throttle + GUN work together.
- A coach card for the first three flights (`localStorage skyward.touch.coach`, `hint=0` suppresses, `hint=1` forces).

### Combat (missions)
While `ctx.combat.active` the layout switches to mission mode (`html.inp-mission`). When `ctx.combat.input.actions` exists
the dock owns GUN / MSL / TGT / FLR / VIEW and calls `combat.input.setTouchButtons(false)`:
GUN → `actions.gun(true/false)` (hold), MSL → `missile()`, TGT → `targetTap()` (else `targetNext()`), FLR → `flares()`,
VIEW → `toggleView()` (else `combat.camera.toggle('padlock')`, else `cmd padlock`). Button states come from
`combat.input.state` (gun/firing, rounds, lock + missile count, target, flares, padlock). Without `actions` the combat grid
`.cbt-inp-touch` is adopted and its buttons are seated in the same rectangles by CSS.

Rectangles are published as CSS custom properties on `<html>` (px, viewport coordinates), refreshed on every relayout:
`--inp-{hud,cbt,radar,subs,clear,zone,dock,view,gun,msl,tgt,flr}-{x,y,w,h}`; classes `inp-touch-on`, `inp-mission`,
`inp-lefty`, `inp-radar` (a radar square exists), `inp-subs`. Interim CSS in touch.js (`COMBAT_SEATS`, scoped to
`html.inp-touch-on.inp-mission`) seats `.cbt-hud-left` in `cbt`, `.cbt-hud-radar` in `radar`, `.cbt-hud-subs` in `subs`,
pops / banner in `clear`, and hides the key-hint line. Combat should move this into its seats (reading the vars) and then
the override can go.

### `ctx.input.touch`
Always present (even before / without the touch UI; buttons added early appear when it is built).
```js
ctx.input.touch.visible            // touch controls on screen now
ctx.input.touch.layout             // layout.js object while visible, else null: { W, H, portrait, b, g, safe, mission, hud,
                                   //   cbt, radar, subs, toast, clear, zone, home, stickR, thr, rud|null, more, cam, menu, view,
                                   //   fire: { gun, msl, tgt, flr } | null, btn: { gear, ap, flapUp, flapDn, sb, brake }, extra: [], dock }
ctx.input.touch.prefs              // { get(), set(patch), reset(), on(fn) → unsubscribe }
ctx.input.touch.raw                // { x, y, held }: the stick before dead zone / expo / assist (unit circle, +y = back)
ctx.input.touch.autoCoord = false  // stop auto-coordinated rudder (e.g. a flight-assist layer doing its own); default true
ctx.input.touch.recentreLook()
const h = ctx.input.touch.addButton({
  id: 'fire', label: 'Fire', icon: '<svg …>', aria: 'Fire gun',
  onDown() {}, onUp() {},          // pointer down / up (onUp also runs when the touch UI hides or the pointer is cancelled)
});                                // → { el, setActive(on), setLabel(text), setSub(text), remove() }, null when the rail is full (4)
ctx.input.touch.removeButton('fire');
ctx.input.touch.showHints(6);      // coach card for 6 s
const d = ctx.input.touch.addDock({ id, el });   // one block another module owns → { get rect(), remove() } | null
ctx.input.touch.removeDock(id);
```
Events: `touch:layout` (payload: the layout) after every relayout.

## Dev harness
`src/input/ui-harness.js` boots the real input, HUD and menu on a fake ctx without WebGL (seconds instead of minutes):
`node tools/mobile-shots.mjs --ui [--touch-test]`. Without `--ui` the same tool shoots the full sim (software GL, slow,
shares the `tools/shot.mjs` render semaphore). `--touch-test` drives multi-touch through CDP and checks `ctx.controls`.
