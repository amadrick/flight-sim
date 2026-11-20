# Menu module: integration notes

Files: `index.js` (controller + DOM), `style.js` (the one injected stylesheet), `glass.js` (runtime side of the glass
material), `icons.js` (inline SVG glyphs), `data.js` (pure data and formatting, tested by `data.test.js`),
`harness.js` (test entry that pads the roster to 16 types).

## Look: Skyward glass
The material lives in `src/index.template.html` so the HUD can use it too:

| class | use | backdrop |
|---|---|---|
| `.glass` | panels, sheets, spec card, HUD strip plate, crash/paused cards | blur 24px, saturate 1.65, brightness by scene |
| `.glass-clear` | small floating controls: top-bar capsules, corner buttons, toasts | blur 14px |
| `.glass-tint` | the one primary action (Fly, Resume, Restart) | none (near-opaque amber) |
| `.glass-lens` | adds SVG edge refraction (`#sky-lens`) to a clear control, Chromium only | url(#sky-lens) + blur |

Each glass element gets a 1px specular rim (`::before`, masked gradient) and an inner sheen (`::after`), both oriented
by `--rim-angle`. Radii are concentric tokens (`--r-xl 30` panel → `--r-l 22` inner card at 8px padding, etc.); set
`--r` on an element to pick its radius.

`glass.js` writes, on `<html>`:
- `data-scene="day|dusk|night"` from `ctx.env.nightFactor` (tint, brightness and rim strength per scene; day glass
  darkens what is behind it enough that white text stays at least 4.5:1 over white cloud);
- `--rim-angle`: the sun's (moon's at night) direction in camera space, damped, written only when it moves > 1.5°;
- `.ui-lite`: no backdrop sampling at all. Set for quality `low`, for a sustained frame rate under 24 fps (4 s; retried
  after 10 s above 50 fps, at most twice), for `?glass=lite`, or when the user turns off Settings → Glass effects;
- `.ui-lens`: Chromium with quality medium or better and not lite. `?glass=plain` disables the refraction.
`prefers-reduced-transparency` swaps every glass for an opaque tint; `prefers-reduced-motion` drops all motion.

## API
`createMenu(ctx)` returns `{ isOpen, open(view?), close(), update(dt), view (getter), selection (getter), glass }`.
Views are `'main'` (hangar), `'settings'`, `'controls'` and `'pause'`. `open()` with no argument opens `pause` during a
flight and `main` otherwise. The menu emits `menu:open` / `menu:close`, and `pause` when it pauses or resumes. The
in-flight help button and `F1` emit `cmd { name: 'help' }` (the HUD toggles its controls card).

## What the menu expects from other modules
- **camera**: `ctx.cameraRig.setMode('showcase')` while the hangar is up, and `setMode('chase')` on FLY.
  Hangar layout (wide screens): aircraft panel on the left (≈ 300 px + 16 px gutter), flight setup on the right
  (≈ 340 px + gutter), the aircraft name and a spec card at the bottom centre (≈ 200 px tall). The free area for the
  aircraft is about 50–56 % of the width, centred, and the upper 70 % of the height. Sheet layout (phones, portrait
  tablets): a bottom sheet covers the lower 58 % of the screen, so the aircraft should sit in the upper 40 %.
- **input**: ignore flight keys while `ctx.menu?.isOpen`. On `Esc`, emit `cmd { name: 'menu' }` as §10 says.
  The menu also listens for Esc on `window` itself, so it works with the stub input. The two paths are de-duplicated
  within 300 ms, so either one or both can fire. If you expose `ctx.input.bindings` (`[{ keys: [...], action, group }]`),
  the Controls screen renders from it. Key codes such as `KeyG`, `ArrowUp` and `Digit1` are shown as `G`, `↑` and `1`.
  Gamepad: while the menu is open it reads the first standard gamepad itself (D-pad / left stick move focus, A
  activates, B goes back, LB / RB switch Hangar / Settings / Controls); input already ignores those buttons while the
  menu is open. If `ctx.input.touchEnabled`, the in-flight corner is hidden: input's touch layout owns the top-right
  corner (Cam + Menu); fullscreen stays in Settings. The Controls screen then lists the touch controls first
  (`TOUCH_HELP` in data.js), the keyboard table below.
- **Settings → Touch controls** (`#menu-touch-settings`, first section, shown when touch is enabled or the pointer is
  coarse): sensitivity 50–200 % (`#menu-touch-sens`), left-handed, rudder slider, stick auto-centre, haptics (only where
  `navigator.vibrate` exists) and "All systems buttons" (drawer open / auto). Reads and writes `ctx.input.touch.prefs`.
- **HUD**: hides itself while `ctx.menu.isOpen`. The Settings HUD switch emits `cmd hudToggle`, and the menu tracks
  every `hudToggle` to show its state.
- **audio**: `ctx.audio.resume()` runs on FLY and on the first pointer-down inside the menu (so the hangar can make
  sound). `ctx.audio.setMasterVolume(0..1)` comes from the volume slider. If `ctx.audio.masterVolume` exists it is
  read as the initial value.
- **physics**: `crash { reason }` brings up the Restart / Back to hangar dialog after 2 s (real time). Crashes
  during the hangar are ignored. While the hangar is up the menu holds `ctx.controls.throttle = 0` and
  `brakes = 1` every frame.

## Phones and tablets
- Landscape phones keep the side-by-side hangar (aircraft left, flight setup right, each scrolling inside its panel);
  the bottom sheet is for portrait (`max-aspect-ratio: 1/1` and ≤ 1100 px wide). Docked panels (pause, settings,
  controls) use the full height and scroll inside.
- `(pointer: coarse)`: every control is at least 44 px (tabs, segments, chips, runway signs, back, switches via a
  transparent border, sliders).
- First run without a saved quality and without `?quality=`: phones (touch, short screen side < 600 px) start at `low`,
  tablets at `medium` at most (`defaultQualityFor` in data.js).

## Persistence
Outside `test=1`, the last aircraft, airport, runway, start mode, liveries, quality, volume, spec-card state and the
glass-effects choice are kept in `localStorage` (`skyward.menu.v1`), with every access wrapped in try/catch. URL params
always take priority.

## Debug
`menu=main|pause|settings|controls|crash` opens that screen at boot, and works with `autostart=1`:
`node tools/shot.mjs --params "menu=main" --size 1280x720`. `glass=lite|plain` forces the cheap material or no refraction.
To check the 16-type roster:
`node tools/shot.mjs --entry src/ui/menu/harness.js --html dist/menu.html --params "menu=main&aircraft=sr71"`.
- Dual-screen devices (CSS `horizontal-/vertical-viewport-segments: 2`, `env(viewport-segment-*)`): side by side, the hangar
  list sits on the left screen and the plan + Fly dock on the right, Settings / Controls panels and the crash dialog keep to one
  screen; stacked, the sheet is limited to the bottom screen. Browsers without segment support get the normal layout.
