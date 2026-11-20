# Combat cameras (`src/combat/camera/`)

Views that keep a dogfight readable and give it punch: the fight chase view (the default in a mission), padlock (outside
and cockpit, toggled or held as a "peek"), missile cam, kill cam, a victory shot, and a small "camera feel" layer (gun
shake, hit kicks, launch punch, buffet, near-miss jolts).

| file | what |
|---|---|
| `index.js` | `createCombatCamera(combat)`: the controller (modes, transitions, safety, feel, writing `ctx.camera`) |
| `math.js` | pure maths: LOS tracker with hysteresis, padlock framing, neck model, sphere blends, safety predicate, springs |
| `modes.js` | pure mode bookkeeping: a base view + one temporary overlay (+ one queued) |
| `camera.test.js` | pure maths tests |
| `controller.test.js` | the controller against a fake ctx (no DOM): fight view framing, gun zoom, padlock fallback, peek, kill cam suppression / quick cut / settle-back, feel amount |
Run: `node --test src/combat/camera/*.test.js`

## API

`createCombatCamera(combat) → { update(realDt), mode, setMode(m) }` (COMBAT.md §13), plus (additive):

| member | what |
|---|---|
| `mode` | `'fight' \| 'padlock' \| 'missile' \| 'kill' \| 'victory' \| null` — what is on screen now (`'fight'` = the fight chase view; `null` = the rig's own camera untouched) |
| `setMode(m)` | `'padlock'` (base view), `'missile'` (needs a player missile in flight), `'kill'` (replays on the last victim / current target; tests), `'victory'`, `null` (everything off). Returns true when the mode is now `m`. |
| `toggle(m)` | key behaviour: padlock on/off, missile cam on/off |
| `setKillCam(on)`, `killCam` | automatic kill cam (default on; remembered as `camKillCam` in the combat progress store when there is one; `?killcam=0` disables) |
| `setFeel(v)`, `feel`, `feelAmount` | camera feel: `true`/`false` or an amount `0..1` (slider); `feel` is a boolean (amount > 0), `feelAmount` the number. Saved as `camFeel` (boolean when set with a boolean). `?camfeel=0` / `?camfeel=0.5` |
| `setFightCam(on)`, `fightCam` | fight chase view on/off (default on; `camFight`; `?fightcam=0`). Off = the rig's plain chase camera |
| `setGunZoom(on)`, `gunZoom` | gun zoom in the fight view (default on; `camGunZoom`; `?gunzoom=0`) |
| `peek(on)`, `peeking` | hold-to-look: padlock while on, previous view when released (also combat `'cmd'` `peekOn` / `peekOff`) |
| `params` | the live fight-view parameters (`FIGHT` in `math.js`); assign fields to tune at run time |
| `reducedMotion` | `prefers-reduced-motion` as seen by the module |
| `modes` | the list above |

Event: `combat.events.emit('camera:combat', { mode, peek })` on every change of `mode` (for a HUD label; `'fight'`
needs no label).
Commands consumed (combat `'cmd'`): `padlock`, `missileCam`, `peekOn`, `peekOff`.

## Keys

| key | action |
|---|---|
| `O` | padlock view on / off (chase or cockpit; from any other rig view it switches the rig to chase first) |
| `;` | missile camera on / off (follows your newest missile in flight) |

`O` is the only free letter in the simulator + combat key maps; `;` is free in both. Gamepad: no free button (all owned
by the simulator or the combat map); touch: a button is requested in `INTEGRATION.md`.

## Fight chase view (default while a mission runs and the rig is in `chase`)

Behind the jet on its flight path, so "screen right = where the nose goes" stays true for the flight assist. Every number
is a field of `FIGHT` (`math.js`), live in `camera.params`:

| parameter | default | why |
|---|---|---|
| `dist` | 1.55 × size | a touch further than the rig's chase (1.5) so the jet never fills a phone screen |
| `rollFollow` | 0.3 | the camera takes 30 % of the bank: the horizon stays readable on a phone, yet a turn still looks like a turn |
| `biasMax` | 20° | lean toward the target. 26° (first try) pushed the jet and the target under the side panels / touch buttons |
| `biasStart` / `biasFull` | 6° / 70° | no lean near the nose (gun work stays still), full lean only when the target is well off |
| `biasUp` / `biasDown` | 15° / 8° | vertical lean limits: the jet must stay above the bottom flight-data strip |
| `biasFadeFrom` / `biasFadeTo` | 105° / 150° | no lean for targets behind: it only shoves the jet aside; edge cues and padlock cover those |
| `orbitShare` | 0.75 | three quarters of the sideways lean swings the camera round the jet (the jet stays near the centre, the target comes in from the edge); the rest turns the look |
| `turnLead` / `turnMax` | 0.5 / 7° | the view leads into the turn by half the flight path's lag, at most 7° |
| `fovBase` / `fovWide` | 56° / +12° | plus 7° with speed and 4° with afterburner (as the rig); +12° as the target goes 30°→120° off the nose |
| `zoom`, `zoomIn` / `zoomOut` | 24 %, 4° / 7° | gun zoom: with the lead solution (`weapons.gunSolution`) within 4° of the nose and in range the FOV closes by 24 % over ~1 s and the camera rises (fin drops clear of the pipper) and looks along the gun line; opens past 7° |
| `pullG` / `pullAB` | +12 % at 9 g / +8 % in full burner | speed feel: the camera drops back a little when you pull or light the burner |

The player's own look input (right-drag / right stick) hands the view to the rig's chase camera while held. The rig's
wheel zoom is not used by the fight view. Reduced motion: fixed FOV, no gun zoom.

## Views and the rig mode underneath

Every view is layered on top of the simulator rig (`ctx.cameraRig`), which keeps running untouched; this module only
overrides `ctx.camera` after it. `rig.isInterior` decides interior/exterior sound (simulator and combat audio) and the
simulator HUD style, so it is kept in step with what is on screen:

| view | rig mode underneath | interior? | what it does |
|---|---|---|---|
| fight | `chase` | no | the default fight chase view (above) |
| padlock (outside) | `chase` | no (rig's own value) | camera swings round the jet to look past it at the target |
| padlock (cockpit) | `cockpit` | **yes** (unchanged) | the pilot's head turns to the target; HUD stays conformal |
| missile cam | any flying view | no — set false while shown if needed | rides behind your newest missile |
| kill cam | any flying view | no — set false while shown if needed | short outside shot of your victim going down |
| victory | any flying view | no — set false while shown if needed | slow hero orbit of your jet until the debrief opens |

When a view overrides the camera position, `rig.worldPosition` and `rig.velocity` are written with the shown camera's
position / velocity (audio listener, HUD), and `rig.isInterior` is restored from the rig's mode when the view ends.

### Padlock, outside
- A smoothed line of sight player→target in **world azimuth/elevation**: horizon stays level; elevation is capped at
  ±76° so a target straight overhead never flips the frame (azimuth is held near the vertical); a swing past dead astern
  keeps going the way it started (25° hysteresis); angular rate capped at 2.6 rad/s; damping is frame-rate independent.
- The camera sits 1.75 × aircraft size behind the jet on that line, raised so the jet sits ~46 % below centre and the
  bandit near the centre ("look past my jet").
- Camera up = world vertical leaning up to ~40 % toward the jet's up between 35° and 95° of bank (back to world up when
  inverted), so stick-right still reads as right.
- FOV 60°, +11° when the target is far off the nose, and always widened enough to hold the target (≤ 88°).
- No target: the view rests on the fight view (or the rig's chase camera) and swings in again when targeting
  auto-selects the next one (within 0.5 s); after 4 s without any target the padlock switches itself off. Target
  changes ease to the new one. Releases on player death, on leaving chase/cockpit (e.g. `C` to orbit), on mission end/abort.
- `peek(on)` / cmd `peekOn` / `peekOff`: the same view while held, back to the previous view (fight / cockpit) on release.
- The player's look input is not used while the padlock holds (the rig's own look is back as soon as it is off).

### Padlock, cockpit
- The head yaw/pitch toward the target within ±150° yaw, +80° / −30° pitch, rate-limited (4.2 rad/s) and damped; a
  small head lean with the look. Shoulder hysteresis (stays on its side until the target is 22° past astern).
- Target within 16° of the nose (left again past 28°) → the head returns to the HUD and the rig's own cockpit view
  (with its look controls and shake) takes over completely.

### Missile cam (`;`)
- Only starts when safe to cut away (same rules as the kill cam).
- 9 m behind and 1.6 m above your newest missile, looking down its path and leaning toward its target when the target
  is ahead; lagged direction so hard pulls swing smoothly. Holds 1.4 s on the detonation / miss point, then returns
  (or chains to your next missile still in flight). Auto-returns (cut) if a missile is launched at you, you are hit,
  an enemy gets behind you, or you get low.

### Kill cam (automatic, default on)
- On `'kill'` with the player as killer (aircraft or ground victims), only when **safe to cut away**: no missile
  guiding on the player (`weapons.threatsTo`), no enemy behind the wing line within 1.8 km or nose-on (30°) within
  1.5 km, no rounds passing close (`'bullet:near'`) or launch warning in the last 2.5 s, not hit in the last 2 s,
  AGL ≥ 450 m and not sinking toward 350 m within 6 s, hull ≥ 15 %. Cooldown 7 s. Otherwise: no kill cam at all.
- Length (`killCamDuration`): 3.2 s when calm; a **quick cut of 1.2 s** while any bandit is within 4 km or anything
  holds a lock on the player.
- A cut to a camera standing off the victim's flight path on the far side from the player, riding along at 60 % of
  the victim's speed so the wreck passes through the frame; tracking zoom.
- Aborts at once if the situation stops being safe, on any hit, on rounds passing close, on a launch warning.
- **Return** (kill cam and missile cam, timed out or aborted): a cut to a pose 1.45× further back and 5° wider than the
  view you return to, which settles onto it in 0.6 s — no snap, and the frame is already aligned with your flight path
  so the stick means the same thing the moment you see your jet.
- No slow motion: `ctx.time.timeScale` changes raise the simulator HUD's "Sim rate" toast, and the world must keep
  its pace for the player anyway.

### Victory
- On `'mission:end'` success with the player alive (and not near the ground): a swoop (1.4 s) into a slow orbit
  (7°/s, 6° above, 2.6 × size) round the jet; with a kill in the last 8 s the orbit starts on the far side of the jet
  from the wreck so the smoke sits behind it. A kill cam already past 1 s finishes first, then cuts to it. Ends when
  the debrief opens (`combat.ui.isOpen` → the rig goes to `showcase`; nothing here runs in showcase). On player death
  nothing here runs: the simulator's crash camera is left alone.

### Camera feel
Layered on the fight view, the rig's chase / cockpit / wing views and the padlock; off in the cinematic views, off under
reduced motion; `setFeel(0..1)` scales every amplitude, `setFeel(false)` / `0` disables. Rotations only (≤ 3°), springs (≈ 3.5 Hz, damped) and band-limited noise:
- gun firing (`loadout.gun.firing`): 11–19 Hz shake, 0.12° in the cockpit / 0.07° outside, plus a slight nose-up bias;
- hit kick on `'damage'` to the player: away from the hit side, scaled by damage/maxHp;
- missile launch: small nose-up punch and a ~0.7° FOV punch;
- buffet: AoA 13–24° and above 6.5 g (scaled down when the rig already shakes for stall / stall warning);
- near miss: `'bullet:near'`, and a jolt as the closest missile (< 40 m) or aircraft (< 70 m) passes, by closing speed.
The rig already widens the chase FOV with speed / afterburner / g, so no FOV-with-speed is added here.

## Rules kept
- `mode === null` and no feel impulse → `ctx.camera` is not touched. Outside a mission nothing runs at all.
- No automatic glance at inbound missiles (disorienting); the HUD's warning arrow does that job.
- Pose state is world space or player-relative: no `'originShift'` handling needed.
- After an override: position, quaternion, `updateProjectionMatrix()` only when fov/near change, `updateMatrixWorld()`.
  The rig re-applies its own fov/near next frame (it compares against the camera).
- Outside views stay ≥ 2.5 m above the ground and outside 0.75 × the player's size; transitions between outside poses
  move on a sphere round the jet (never through it); interior↔exterior and long jumps are cuts. NaN → no override.
- Reduced motion: no shake / kicks / FOV pumping, transitions are cuts, the victory shot holds still.
- Zero per-frame allocation; no DOM at module top level (`matchMedia` is read inside `createCombatCamera`).
