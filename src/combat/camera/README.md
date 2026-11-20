# Combat cameras (`src/combat/camera/`)

Views that keep a dogfight readable and give it punch: padlock (outside and cockpit), missile cam, kill cam, a victory
shot, and a small "camera feel" layer (gun shake, hit kicks, launch punch, buffet, near-miss jolts).

| file | what |
|---|---|
| `index.js` | `createCombatCamera(combat)`: the controller (modes, transitions, safety, feel, writing `ctx.camera`) |
| `math.js` | pure maths: LOS tracker with hysteresis, padlock framing, neck model, sphere blends, safety predicate, springs |
| `modes.js` | pure mode bookkeeping: a base view + one temporary overlay (+ one queued) |
| `camera.test.js` | `node --test src/combat/camera/*.test.js` |

## API

`createCombatCamera(combat) → { update(realDt), mode, setMode(m) }` (COMBAT.md §13), plus (additive):

| member | what |
|---|---|
| `mode` | `'padlock' \| 'missile' \| 'kill' \| 'victory' \| null` — what is on screen now |
| `setMode(m)` | `'padlock'` (base view), `'missile'` (needs a player missile in flight), `'kill'` (replays on the last victim / current target; tests), `'victory'`, `null` (everything off). Returns true when the mode is now `m`. |
| `toggle(m)` | key behaviour: padlock on/off, missile cam on/off |
| `setKillCam(on)`, `killCam` | automatic kill cam (default on; remembered as `camKillCam` in the combat progress store when there is one; `?killcam=0` disables) |
| `setFeel(on)`, `feel` | camera feel layer (default on; `camFeel`; `?camfeel=0`) |
| `reducedMotion` | `prefers-reduced-motion` as seen by the module |
| `modes` | the list above |

Event: `combat.events.emit('camera:combat', { mode })` on every change of `mode` (for a HUD label).
Commands consumed (combat `'cmd'`): `padlock`, `missileCam` — emitted by combat input for the keys below.

## Keys

| key | action |
|---|---|
| `O` | padlock view on / off (chase or cockpit; from any other rig view it switches the rig to chase first) |
| `;` | missile camera on / off (follows your newest missile in flight) |

`O` is the only free letter in the simulator + combat key maps; `;` is free in both. Gamepad: no free button (all owned
by the simulator or the combat map); touch: a button is requested in `INTEGRATION.md`.

## Views and the rig mode underneath

Every view is layered on top of the simulator rig (`ctx.cameraRig`), which keeps running untouched; this module only
overrides `ctx.camera` after it. `rig.isInterior` decides interior/exterior sound (simulator and combat audio) and the
simulator HUD style, so it is kept in step with what is on screen:

| view | rig mode underneath | interior? | what it does |
|---|---|---|---|
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
- The camera sits 1.75 × aircraft size behind the jet on that line, raised so the jet sits ~42 % below centre and the
  bandit near the centre ("look past my jet").
- Camera up = world vertical leaning up to ~40 % toward the jet's up between 35° and 95° of bank (back to world up when
  inverted), so stick-right still reads as right.
- FOV 60°, +11° when the target is far off the nose, and always widened enough to hold the target (≤ 88°).
- No target: the view rests on the rig's own chase camera and swings in again when one is designated; target changes
  ease to the new one. Releases on player death, on leaving chase/cockpit (e.g. `C` to orbit), on mission end/abort.
- The player's look input is not used while the padlock holds (the rig's own look is back as soon as it is off).

### Padlock, cockpit
- The head yaw/pitch toward the target within ±150° yaw, +80° / −30° pitch, rate-limited (4.2 rad/s) and damped; a
  small head lean with the look. Shoulder hysteresis (stays on its side until the target is 22° past astern).
- Target within 16° of the nose (left again past 28°) → the head returns to the HUD and the rig's own cockpit view
  (with its look controls and shake) takes over completely.

### Missile cam (`;`)
- 9 m behind and 1.6 m above your newest missile, looking down its path and leaning toward its target when the target
  is ahead; lagged direction so hard pulls swing smoothly. Holds 1.4 s on the detonation / miss point, then returns
  (or chains to your next missile still in flight). Auto-returns (cut) if a missile is launched at you, you are hit,
  an enemy gets behind you, or you get low.

### Kill cam (automatic, default on)
- On `'kill'` with the player as killer (aircraft or ground victims), only when **safe to cut away**: no missile
  guiding on the player (`weapons.threatsTo`), no enemy behind the wing line within 1.8 km or nose-on within 1.2 km,
  AGL ≥ 450 m and not sinking toward 350 m within 6 s, not hit in the last 2 s, hull ≥ 15 %. Cooldown 7 s.
- A cut to a camera standing off the victim's flight path on the far side from the player, riding along at 60 % of
  the victim's speed so the wreck passes through the frame; tracking zoom. 3.2 s, then a cut back to the view before.
- Aborts at once (cut back) if the situation stops being safe, on any hit, on a launch warning against the player.
- No slow motion: `ctx.time.timeScale` changes raise the simulator HUD's "Sim rate" toast, and the world must keep
  its pace for the player anyway.

### Victory
- On `'mission:end'` success with the player alive (and not near the ground): a swoop (1.4 s) into a slow orbit
  (7°/s, 6° above, 2.6 × size) round the jet; with a kill in the last 8 s the orbit starts on the far side of the jet
  from the wreck so the smoke sits behind it. A kill cam already past 1 s finishes first, then cuts to it. Ends when
  the debrief opens (`combat.ui.isOpen` → the rig goes to `showcase`; nothing here runs in showcase). On player death
  nothing here runs: the simulator's crash camera is left alone.

### Camera feel
Layered on the rig's chase / cockpit / wing views and on the padlock; off in the cinematic views, off under reduced
motion, `setFeel(false)` to disable. Rotations only (≤ 3°), springs (≈ 3.5 Hz, damped) and band-limited noise:
- gun firing (`loadout.gun.firing`): 11–19 Hz shake, 0.12° in the cockpit / 0.07° outside, plus a slight nose-up bias;
- hit kick on `'damage'` to the player: away from the hit side, scaled by damage/maxHp;
- missile launch: small nose-up punch and a ~0.7° FOV punch;
- buffet: AoA 13–24° and above 6.5 g (scaled down when the rig already shakes for stall / stall warning);
- near miss: `'bullet:near'`, and a jolt as the closest missile (< 40 m) or aircraft (< 70 m) passes, by closing speed.
The rig already widens the chase FOV with speed / afterburner / g, so no FOV-with-speed is added here.

## Rules kept
- `mode === null` and no feel impulse → `ctx.camera` is not touched. Outside a mission nothing runs at all.
- Pose state is world space or player-relative: no `'originShift'` handling needed.
- After an override: position, quaternion, `updateProjectionMatrix()` only when fov/near change, `updateMatrixWorld()`.
  The rig re-applies its own fov/near next frame (it compares against the camera).
- Outside views stay ≥ 2.5 m above the ground and outside 0.75 × the player's size; transitions between outside poses
  move on a sphere round the jet (never through it); interior↔exterior and long jumps are cuts. NaN → no override.
- Reduced motion: no shake / kicks / FOV pumping, transitions are cuts, the victory shot holds still.
- Zero per-frame allocation; no DOM at module top level (`matchMedia` is read inside `createCombatCamera`).
