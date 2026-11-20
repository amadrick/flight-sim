# HUD / flight instruments — integration notes

## Files
| file | what |
|---|---|
| `index.js` | `createHud(ctx)`: canvas sizing (devicePixelRatio, `resize`), visibility, mode dispatch, shared nav state, glow filter |
| `fighter.js` | conformal F-16-style HUD (cockpit camera, `def.hudType === 'fighter'`) |
| `airliner.js` | Boeing-style PFD / ND / upper EICAS deck (cockpit camera, `def.hudType === 'airliner'`); phone layouts |
| `external.js` | flight-data strip for every exterior camera |
| `notices.js` | DOM layer (`.hud-root` in `ctx.uiRoot`): glass toasts, crash card, paused tag, controls card |
| `nav.js` | pure maths: destination, bearing/distance, ILS deviations, ground-collision prediction |
| `projection.js` | conformal projection of world directions through `ctx.camera` |
| `hud.test.js` | `node --test src/ui/hud/` — projection, conformity of the drawn HUD, ILS, GCAS, formatters |
| `harness.js` | dev-only entry for screenshots with a frozen, posed aircraft (not part of the main bundle) |

## Glass
The external strip sits on a DOM glass plate (`.hud-plate.glass`, see the material in `index.template.html`) inserted
between `#view` and the HUD canvas, so the backdrop blur never touches the numbers; the canvas then draws only a light
scrim. `?glass=off` keeps the old opaque canvas panel. Toasts, the paused tag, the crash card and the controls card are
glass too. The fighter HUD stays green collimated symbology, and the airliner deck stays an instrument panel.

## Touch screens
When `ctx.input.touch.layout` is set (touch controls on screen), the HUD draws only inside the regions the touch layout
reserves, so it never sits under a thumb or a button:
- external views: the flight-data strip docks at the top-left of `layout.hud` and drops the cells the controls already
  show (throttle, gear / flaps / brakes / AP); the warning chip goes under the strip;
- airliner cockpit: PFD + compact engine/config strip inside `layout.hud` (side by side when wide, stacked when tall);
- fighter cockpit: the conformal HUD's tapes and blocks are limited to `layout.clear`; if that leaves less than
  220 × 180 px (portrait phones) the boxed strip is drawn instead;
- toasts start below whatever the HUD drew (`notices.setToastTop`).
The canvas also re-fits every frame when its CSS size changed (rotation; iOS can fire `resize` late or with old sizes).

## Controls card
Shown at the start of the first six flights (count in `localStorage` `skyward.hud.hint`; `hint=1` forces it, `hint=0`
suppresses it), up for 7 s of unpaused flying, then it fades. `F1`, or `cmd { name: 'help' }` (the menu's corner help
button), brings it back for 12 s or puts it away. Never shown while `ctx.input.touchEnabled` (input shows touch coach marks instead).

## Public API
```js
const hud = await createHud(ctx);
hud.update(dt);                 // every frame (main.js already does this)
hud.setVisible(bool);           // same switch as the `hudToggle` command
hud.toast(text, { tone: 'info'|'caution'|'warn', key, duration: 2.6, dedupe: 2.5 });
hud.setDestination('KBAY');     // null → back to the automatic destination
hud.destination;                // current destination airport object (from AIRPORTS)
```
Default destination: `ctx.player.airport` for `start: 'approach'`, otherwise the nearest other airport.

## What it reads (all defensively — missing fields are tolerated)
- `ctx.cameraRig.mode` (`showcase` hides everything), `ctx.cameraRig.isInterior` (falls back to `mode === 'cockpit'`),
  `ctx.cameraRig.worldPosition` (steerpoint diamond parallax; falls back to the aircraft position).
- `ctx.camera` matrices — the fighter HUD is projected through the real camera every frame (FOV, zoom, head look all register).
- `ctx.menu.isOpen`, `ctx.params.hud`, `ctx.params.raw.hint === '0'` (suppress the key hint), `ctx.env.nightFactor`,
  `ctx.weather.windFrom/windSpeed`, `ctx.time.{realDt, dt, paused, timeScale, timeOfDay}`, `ctx.world.groundHeightAt`,
  `ctx.session.options.start`, `ctx.quality.level` (`low` drops the glow filter).
- Events: `cmd {name:'hudToggle'}`, `session:start/end`, `resize`, `gear:moved`, `touchdown`, `camera:mode`, `crash`, `quality:change`.

## Requests to other modules (no integrator-owned file needs to change)
- **Input:** bind `U` → `cmd hudToggle` and `Backspace` → `cmd reset` (the crash banner tells the pilot to press Backspace).
- **Physics:** the HUD works with the stub, but these make it exact:
  - `state.flapsIndex` + `def.physics.flapDetents` (labels, e.g. `[0,1,2,5,10,15,25,30,40]`) for "FLAPS 15" toasts and the EICAS flap readout
    (otherwise the 737 detent nearest to `surfaces.flaps` is shown).
  - `state.ap.mode`: tokens recognised (case-insensitive substrings): `alt`, `hdg`, `vs`/`v/s`, `spd`, `loc`, `gs`, `lnav`, `vnav`, `lvl`/`chg`.
  - `state.stallWarning`, `stalled`, `overspeed`, `overG`, `engines[].{n1, n2, egt, fuelFlow, afterburner, reverser, running}`,
    `fuelCapacity`, `beta` (slip indicator), `touchdown { verticalSpeed }` event (toast with the sink rate).
  - Optional `def.specs.approachAoA` (deg, default 13) for the fighter AoA bracket.
- **Menu:** call `ctx.hud.setDestination(id)` if the menu lets the pilot pick a destination. The HUD hides itself while `ctx.menu.isOpen`.
- **Camera:** expose `isInterior` and `worldPosition` (already in the stub contract).

## Cost
Measured in headless Chrome (software raster, so an upper bound): fighter HUD ≈ 0.2 ms/frame at 960×540, airliner deck
≈ 0.4 ms at 1920×1080, external strip ≈ 0.07 ms. Static parts (panel, bezels, strip labels) are cached in offscreen canvases and
rebuilt only on resize / font load; numbers come from memoised string caches (no per-frame string building). The glow is a CSS
`drop-shadow` filter on the overlay canvas (GPU-composited, zero main-thread cost).
- Dual-screen devices spanned across a vertical hinge (viewport segments) without touch: the strip docks on the left screen;
  the conformal fighter HUD would sit on the hinge (the camera centre), so it falls back to the strip. Toasts, the paused tag,
  the crash card and the hint card stay on one screen (CSS `horizontal-/vertical-viewport-segments` + `env(viewport-segment-*)`).
- `ctx.hud.stripRect` → `{x, y, w, h, r}` of the exterior flight-data strip while it is drawn (else null), and
  `ctx.hud.hintVisible` (controls card up): for overlays that must sit around the strip (combat HUD request 1).
