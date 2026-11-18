# Input integration notes
- No integrator-owned file changes required.
- `ctx.input`: `{ update(dt), bindings, gamepadBindings, mode, mouseYoke, touchEnabled, gamepadConnected, lookDelta{x,y} px/frame, zoomDelta (wheel notches/frame, + = scroll toward user = zoom out), setMouseYoke(on), setTouch(on), dispose() }`.
- `controls.lookX/lookY`: right = +X, down = +Y (mouse drag / right stick); mouse look springs back to 0 on release. `controls.zoom` is a decaying impulse (+ = out).
- Menu help screen: render `ctx.input.bindings` (and `gamepadBindings`); both are plain `{group, action, keys[]}`.
- Input reads `ctx.menu.isOpen` and `ctx.cameraRig.mode === 'showcase'` (hides touch UI). Escape and P (and gamepad Start) are the only commands emitted while the menu is open.
- Touch UI auto-enables on `(pointer: coarse)`; `?touch=1` forces, `?touch=0` disables.
- Gamepad: standard mapping — left stick roll/pitch, right stick look, RT/LT throttle rate, LB/RB rudder, A gear, B speedbrake, X flaps down, Y flaps up, D-pad up/down trim, left/right camera, Back camera next, Start menu, L3 brakes. Non-standard devices use a best-effort flight-stick layout (axes 0/1 stick, 2 twist rudder, 3 throttle slider, absolute only after it moves).
- Not implemented: device-tilt steering.
