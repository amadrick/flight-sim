# Menu module: integration notes

Files: `index.js` (controller + DOM), `style.js` (the one injected stylesheet), `data.js` (pure data and formatting,
tested by `data.test.js`), `harness.js` (test entry that pads the roster to 16 types).

## API
`createMenu(ctx)` returns `{ isOpen, open(view?), close(), update(dt), view (getter), selection (getter) }`.
Views are `'main'` (hangar), `'settings'`, `'controls'` and `'pause'`. `open()` with no argument opens `pause` during a
flight and `main` otherwise. The menu emits `menu:open` / `menu:close`, and `pause` when it pauses or resumes.

## What the menu expects from other modules
- **camera**: `ctx.cameraRig.setMode('showcase')` while the hangar is up, and `setMode('chase')` on FLY.
  The aircraft is parked on the runway (`session.start({ start: 'runway' })`). On phones a bottom sheet covers the
  lower ~56% of the screen, so `showcase` framing should put the aircraft in the upper half when the viewport is
  portrait (for example a vertical view offset), otherwise it sits right at the edge of the sheet.
- **input**: ignore flight keys while `ctx.menu?.isOpen`. On `Esc`, emit `cmd { name: 'menu' }` as §10 says.
  The menu also listens for Esc on `window` itself, so it works with the stub input. The two paths are de-duplicated
  within 300 ms, so either one or both can fire. If you expose `ctx.input.bindings` (`[{ keys: [...], action, group }]`),
  the Controls screen renders from it. Key codes such as `KeyG`, `ArrowUp` and `Digit1` are shown as `G`, `↑` and `1`.
- **HUD**: hide the HUD while `ctx.menu.isOpen`, or on `menu:open` / `menu:close`. The stub HUD text currently
  shows through at the top left. The Settings HUD switch emits `cmd hudToggle`, and the menu tracks every
  `hudToggle` to show ON/OFF. The HUD should show its own paused indicator for the `P` key, because the menu shows
  nothing in that case.
- **audio**: `ctx.audio.resume()` runs on FLY and on the first pointer-down inside the menu (so the hangar can make
  sound). `ctx.audio.setMasterVolume(0..1)` comes from the volume slider. If `ctx.audio.masterVolume` exists it is
  read as the initial value.
- **physics**: `crash { reason }` brings up the Restart / Back to hangar dialog after 2 s (real time). Crashes
  during the hangar are ignored. While the hangar is up the menu holds `ctx.controls.throttle = 0` and
  `brakes = 1` every frame.

## Persistence
Outside `test=1`, the last aircraft, airport, runway, start mode, quality and volume are kept in `localStorage`
(`skyward.menu.v1`), with every access wrapped in try/catch. URL params always take priority.

## Debug
`menu=main|pause|settings|controls|crash` opens that screen at boot, and works with `autostart=1`:
`node tools/shot.mjs --params "menu=main" --size 1280x720`.
To check the 16-type roster:
`node tools/shot.mjs --entry src/ui/menu/harness.js --html dist/menu.html --params "menu=main&aircraft=sr71"`.
