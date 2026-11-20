# Input integration notes
- No integrator-owned file changes required.
- `ctx.input`: `{ update(dt), bindings, gamepadBindings, mode, mouseYoke, touchEnabled, touch, gamepadConnected, lookDelta{x,y} px/frame, zoomDelta (wheel notches/frame, + = scroll toward user = zoom out), setMouseYoke(on), setTouch(on), dispose() }`.
- `controls.lookX/lookY`: right = +X, down = +Y (mouse drag / right stick); mouse look springs back to 0 on release. `controls.zoom` is a decaying impulse (+ = out).
- Menu help screen: render `ctx.input.bindings` (and `gamepadBindings`); both are plain `{group, action, keys[]}`.
- Input reads `ctx.menu.isOpen` and `ctx.cameraRig.mode === 'showcase'` (hides touch UI). Escape and P (and gamepad Start) are the only commands emitted while the menu is open.
- Gamepad: standard mapping — left stick roll/pitch, right stick look, RT/LT throttle rate, LB/RB rudder, A gear, B speedbrake, X flaps down, Y flaps up, D-pad up/down trim, left/right camera, Back camera next, Start menu, L3 brakes. Non-standard devices use a best-effort flight-stick layout (axes 0/1 stick, 2 twist rudder, 3 throttle slider, absolute only after it moves).

## Touch (phones, tablets)
Files: `touch.js` (DOM, pointer handling), `layout.js` (pure layout, tested in `layout.test.js`).

- Auto-enables on `(pointer: coarse)`; `?touch=1` forces it, `?touch=0` disables it. Hidden while the menu is open, in the hangar showcase and after a crash.
- Hybrid devices (touch screen + keyboard / gamepad): the first touch (`pointerType: 'touch'`) shows the touch controls; a flight
  key or gamepad input hides them again (not while the menu is open; `?touch=0/1` pins the choice).
- Every flight-time element owns a rectangle computed by `touchLayout(W, H, safeAreaInsets, { extra })`; nothing overlaps
  at any size from 320×568 to 1366×1024 (unit-tested, with and without notch insets, with 0–4 extra buttons).

  | region | landscape (primary) | portrait |
  |---|---|---|
  | stick zone (floating stick, right thumb) | right ~40 % below the top buttons | right of the throttle, above the rudder |
  | throttle (left thumb, relative drag, snaps at MIL) | bottom-left | bottom-left |
  | action buttons Gear · AP · Flaps − · Flaps + · Spd brk · Brake (hold) | 2×3 grid right of the throttle | one row of six (two rows of three under 360 px) above the controls |
  | rudder (springs to centre) | bottom centre, or above the grid when narrow | under the stick zone |
  | Cam · Menu (Menu pauses and opens the pause menu) | top-right | top-right |
  | extra-button rail (`addButton`) | right edge under Cam/Menu | row above the action buttons, right-aligned |
  | HUD box (`layout.hud`) | top-left, left of the stick zone | full width under Cam/Menu |
  | `layout.clear` (free area for a centred conformal HUD) | between the grid and the rail | same as the HUD box |
- Safe areas: insets read from `env(safe-area-inset-*)` (a probe element); every target is ≥ 44 px; `viewport-fit=cover`,
  `maximum-scale=1, user-scalable=no` are added to the viewport meta if missing; while the touch UI is up, pinch
  (`gesturestart`, two-finger `touchmove`), double-tap zoom, long-press callouts and text selection are suppressed.
- Dual-screen / foldable devices spanned across a hinge: `segments.js` reads the gap from `window.viewport.segments`, else
  `env(viewport-segment-*)`; `touchLayout(…, { hinge })` keeps every control, the HUD box and `clear` off the hinge
  (side-by-side screens: HUD box + throttle + buttons + rudder on the left screen, stick zone on the right; stacked screens:
  controls on the bottom screen, HUD on the top one). Zero-width folds (one continuous panel) are ignored. The layout also
  relayouts when the `(horizontal|vertical)-viewport-segments: 2` media queries change. Nothing is keyed to device names:
  only viewport size, aspect, `(pointer: coarse)`, safe-area insets and segments.
- Pointer events with pointer capture; each control tracks its own `pointerId`, so stick + throttle + a button work together.
- A single coach card (in the free area: top of the stick zone in landscape, bottom of `clear` in portrait) for the first three flights (`localStorage skyward.touch.coach`,
  `hint=0` suppresses, `hint=1` forces) and on `cmd { name: 'help' }`. The keyboard controls card stays hidden on touch.
- Not implemented: device-tilt steering (motion permission is often refused inside the artifact frame; the stick works everywhere).

### `ctx.input.touch`
Always present (even before / without the touch UI; buttons added early appear when it is built).
```js
ctx.input.touch.visible            // touch controls on screen now
ctx.input.touch.layout             // layout.js object while visible, else null: { W, H, portrait, b, g, safe, hud, clear,
                                   //   zone, home, thr, rud, cam, menu, btn: { gear, ap, flapUp, flapDn, sb, brake }, extra: [] }
const h = ctx.input.touch.addButton({
  id: 'fire',                      // unique
  label: 'Fire',                   // short, upper-cased by CSS; keep ≤ 5 characters
  icon: '<svg …>',                 // optional inline SVG (18 px)
  aria: 'Fire gun',                // optional accessible name
  onDown() {}, onUp() {},          // pointer down / up (onUp also runs when the touch UI hides or the pointer is cancelled)
});                                // → { el, setActive(on), setLabel(text), setSub(text), remove() }, null when the rail is full (4)
ctx.input.touch.removeButton('fire');
ctx.input.touch.showHints(6);      // coach marks for 6 s
```
Events: `touch:layout` (payload: the layout) after every relayout (rotation, resize, inset change, buttons added/removed).
The combat module would add `fire` (hold: onDown starts firing, onUp stops) and `target` (onDown cycles) buttons; the HUD's
targeting elements should stay inside `layout.hud` / `layout.clear` on touch.

## Dev harness
`src/input/ui-harness.js` boots the real input, HUD and menu on a fake ctx without WebGL (seconds instead of minutes):
`node tools/mobile-shots.mjs --ui [--touch-test]`. Without `--ui` the same tool shoots the full sim (software GL, slow,
shares the `tools/shot.mjs` render semaphore). `--touch-test` drives multi-touch through CDP and checks `ctx.controls`.
