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
