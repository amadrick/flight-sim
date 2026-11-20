# Combat cameras — integration notes

## Edits outside `src/combat/camera/` (granted exception (a))

`src/combat/input/map.js` — additive only:
- `KEY_MAP`: `{ code: 'KeyO', act: 'padlock' }`, `{ code: 'Semicolon', act: 'missileCam' }`. The existing keydown
  handler in `input/index.js` already turns any mapped action into `combat.events 'cmd' { name }` while a mission is
  live, so `input/index.js` needed no change.
- `COMBAT_BINDINGS`: rows `padlock` (`O`) and `missileCam` (`;`) for the help screen (inserted before `restart`).
No existing key, row or behaviour changed. `src/camera/index.js` was **not** edited.

## Runtime writes to the rig (no file edit)
While a combat view overrides the camera position, `ctx.cameraRig.worldPosition` / `.velocity` are overwritten after
the rig's update with the shown camera (audio listener + simulator HUD read them), and `ctx.cameraRig.isInterior` is
set false for the outside views (kill / missile / victory) when the rig sits in the cockpit; it is restored from
`rig.mode` when the view ends. The rig recomputes all three from its own state every frame, so nothing leaks.

## Requests (not done — other owners)
1. **Touch** (combat input / mobile layout owners): a small `VIEW` / padlock button emitting
   `combat.events.emit('cmd', { name: 'padlock' })`, optionally a missile-cam button (`'missileCam'`).
   Add to `TOUCH_BUTTONS` in `src/combat/input/map.js` when the touch layout has room (the input test currently pins the
   four labels).
2. **HUD** (`src/combat/hud`): a small mode label from `combat.events 'camera:combat' { mode }` — e.g. `PADLOCK`,
   `MISSILE CAM`, `KILL CAM`. In the outside padlock the jet's attitude is still readable from the frame (horizon held,
   jet in the lower third); a compact attitude cue (bank/pitch ladder tick) near the bottom of the screen while
   `mode === 'padlock'` and the rig is in chase would help further.
3. **Combat settings screen** (`src/combat/ui`): two toggles calling `ctx.combat.camera.setKillCam(on)` and
   `ctx.combat.camera.setFeel(on)` (state: `.killCam`, `.feel`; already persisted as `camKillCam` / `camFeel` through
   `combat.ui.progress.setSetting`).
4. **Gamepad**: no free standard button remains; if the pad map is reshuffled, padlock is the most useful one to add
   (cmd `'padlock'`).

## Round 2 — notes for HUD / input / UI owners
- `combat.camera.mode` can now be **`'fight'`** (the fight chase view, the default in a mission while the rig is in
  chase). It needs no label; treat it like `null` for symbology (it is seen from behind the jet, like the rig's chase).
  `'camera:combat'` payload is `{ mode, peek }`.
- **Peek** (hold to look at the target): `combat.camera.peek(true/false)` or combat `'cmd'` `peekOn` / `peekOff`.
  Request to input: a hold binding — e.g. long-press on the touch `VIEW` button = peek while held (tap stays the padlock
  toggle), and a keyboard hold key if one is wanted (none is free besides `O`/`;`; `Shift+O` held would work if the
  keydown/keyup handler emits `peekOn`/`peekOff`). During a peek `mode === 'padlock'` and `peeking === true`.
- **Settings**: `setFeel(v)` takes `true/false` or an amount `0..1` (slider); `feel` stays a boolean and `feelAmount`
  is the number. New toggles: `setFightCam(on)` / `fightCam` ("Fight camera: looks toward your target"),
  `setGunZoom(on)` / `gunZoom` ("Gun zoom"). Both are saved by the camera as `camFight` / `camGunZoom` in the combat
  progress store when the UI does not do it.
- The kill cam now never starts while the player is being shot at or a bandit is nose-on within 1.5 km / behind within
  1.8 km, and is a 1.2 s quick cut while any bandit is within 4 km.
- Flight assist: the fight view keeps the camera frame on the flight path with 30 % roll follow and leans at most 20°
  (orbiting, so the jet stays central); the assist's "screen frame" should read `ctx.camera` as usual.
