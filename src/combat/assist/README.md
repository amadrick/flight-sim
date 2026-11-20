# Player flight assist (`combat.assist`)

Point-to-fly steering for phones, keyboards and pads. `combat.pre(dt)` runs it after the input layer and before the
player's physics, only while a human flies. It reads `ctx.controls.pitch / roll` as the player's intent and rewrites
`pitch / roll / yaw`. Throttle and speedbrake stay the player's, except for the rookie auto-throttle.

## How it flies

- **Nose command `N`** (`assist.command`, world unit vector). The stick turns it at a nose rate in the stick frame:
  right moves the nose right, back moves it up, a diagonal does both.
  - The rate is `shapeRate(m) × the available turn rate`, where `shapeRate(m) = m·(0.7 + 0.3·m²)`, applied on top of
    the input layer's own dead zone and expo (pad 0.1 / 0.4, touch 0.07 / 0.4).
  - Full stick asks a little more than the G limit, so the turn is flown at the AoA / G limit.
  - The stick magnitude can rise at most 4 per second. A tap or a flick gives a small correction, and holding builds up
    to the full-rate turn.
  - `N` may lead the nose by up to 0.32 rad at full stick. Easing the stick shrinks that allowance only slowly
    (0.1 rad/s), so the reticle is never yanked back toward the nose.
- **Keys** (`assist.device` `'keys'`, or `'auto'` while the simulator's input mode is keyboard / mouse without the yoke).
  The key behind each axis is recovered from the key-ramped value (`keyDir`). Then:
  - a tap moves `N` one fixed step (1.7°);
  - a hold longer than 0.15 s adds a rate that ramps to the full turn over 0.4 s;
  - the opposite key within 0.4 s of letting go is a stop: the motion still to come and `N`'s lead on that axis are
    dropped, and that press makes no step;
  - on release `N` stays where the key left it (after a long hard hold the roll-out below applies).
- **Path `P`** (`assist.path`) is the flight path that puts the nose on `N`.
  - `P` is `N` less 0.8 × the smoothed AoA, taken along the smoothed commanded lift direction, plus a slow integral of
    the remaining nose error.
  - The commanded lift is used, not the measured body axes. Measured axes tie the aim to the roll, and the two chase
    each other.
- **Steering.** The lift vector is rolled toward `P` (`ai/fly.js` `steer`), with gravity compensation and the commanded
  rate as feed-forward.
  - The feed-forward is smoothed (2 s while the stick is held, 1 s once released): a held turn's rate is learned, a
    shaky or jabbing thumb does not shake the lift vector. The reticle itself follows the stick at once.
  - The gain is gentle for small errors (1.2/s) and firm for large ones (2.5/s).
  - When a correction needs less than ½ g of lift, or negative lift, the aircraft eases off or pushes with its wings
    where they are. A forward stick never rolls the aircraft inverted.
- **Release.**
  - After a hard turn held for more than 0.7 s, the aircraft rolls out so that the nose stops where it was let go:
    `N` freezes at the nose, 45 % of the turn's extra lift is dropped at once and the rest is shed over
    `τ = 0.7 × V × (AoA per g) / g`, the time in which the path catches up with the nose as the AoA dies away. The
    shedding pauses while the nose falls back, and the hold point follows the nose while it still swings on, so the
    nose ends up at, or a little beyond, where it was let go, never behind.
  - After a tap, `N` simply stays where it is.
  - A dive or climb the player set up is kept. Near level flight the gravity-compensated lift brings the wings level.
- **Stick frame** (`assist.frame`):
  - `'horizon'` (default): right is horizontal, so holding right flies a level turn. Up is perpendicular to it. The
    frame re-erects to the horizon unless the player is pulling through the vertical.
  - `'view'`: the frame follows the camera's own right and up. Without a camera it follows the aircraft's axes.
- **Gun help** (`aimAssist` 0..1).
  - It acts only when all of these hold: a target is selected, the target is within 1.4 km and in gun range, and the
    lead solution is within 0.1 rad of the nose.
  - `N` is drawn toward the solution at `aimAssist × closeness × (1 − stick opposition)`, and the target's acceleration
    is fed forward.
  - A big deflection fades it out. It never flies the aircraft by itself. While it acts, `info.gunAssist` is true.
- **Pointer aim.** When `aim.active` is set, `N` is the ray from `ctx.camera` through the screen point `aim.x, aim.y`.
  Combat cameras (missile, kill, victory) are ignored, and the last command stays.
- **Protections.**
  - AoA and G limits by difficulty.
  - Rookie and veteran get a low-speed cap on how far the nose can be raised.
  - Every difficulty gets the ground pull-up cue (`info.pullUp`), from `ai/safety.js predictRecovery` with the
    aircraft's learned full-stick G.
  - Rookie also gets a takeover at the last moment.
  - `info.limiting` reports `'ground' | 'speed' | 'aoa' | 'g' | ''`.
- **Auto-throttle** (rookie only).
  - It engages after the throttle has been left alone for 3 s, or for 10 s after any player throttle input.
  - It holds corner speed in a fight (corner + 40 otherwise) and uses afterburner below 1.6 × the stall speed.
- **Stays out**:
  - on the ground;
  - with gear down below 200 ft AGL;
  - with the autopilot engaged;
  - when the player is dead or the mission has ended;
  - when paused (`dt = 0`);
  - in mode `'off'`.

  On entry it blends in over 0.35 s.

## API

```
mode, setMode('assist' | 'off' | null)      null = the difficulty default (assist on rookie / veteran, off on ace)
aimAssist, setAimAssist(0..1 | null)        null = the difficulty default (0.8 / 0.4 / 0)
aim { x, y, active }                        pointer aim, -1..1 from the screen centre, +y up
frame 'horizon' | 'view'
device 'auto' | 'analog' | 'keys'
info { mode, active, gunAssist, limiting, pullUp, autoThrottle, aimPoint, keys }
command, path, frameRight, frameUp          world vectors for HUD cues (draw `command` as the "nose goes here" reticle)
reset(), update(dt)
```

## Tools

```
node --test src/combat/assist
node src/combat/assist/tools/thumb.mjs steps [--types f16,f15,fa18,f14,a10] [--speeds 250,350,450] [--sticks analog,digital] [--hold 4]
node src/combat/assist/tools/thumb.mjs track [--patterns turn,weave] [--aims 0,0.4,0.8] [--modes assist,direct] [--sticks analog,touch,digital] [--seeds 3]
node src/combat/assist/tools/thumb.mjs duel  [--types …] [--ai rookie,veteran] [--sticks analog,touch,digital] [--runs 8] [--throttle 0.9]
```

`steps --hold 4` holds full stick for 4 s instead of to an angle and reports the give-back: how far the nose heading
comes back in the 4 s after release (negative = it ends beyond where it was let go).

The **virtual thumb** only sees the screen.
- It sees the target, or the lead point inside 1.6 km, relative to the point it steers:
  - with the assist, the reticle of `N`;
  - with direct controls, the gun cross.
- What it sees is late and noisy: 150–250 ms for a pad thumb, 100–150 ms for touch.
- With the assist it wants a reticle rate (proportional plus a leaky integral) and pushes as far as the stick's curve
  needs for it (a practised player knows the curve). Its gain follows McRuer's crossover model: full rate at
  `2.6 × delay × full rate` off, the gain a human settles on to keep the loop steady for their reaction time. On
  direct controls it rolls the target above the canopy and pulls, full stick at 5° off.
- `analog`: a pad stick through the simulator's shaping (dead zone 0.1, expo 0.4).
- `touch`: a phone's virtual stick. It is 8-bit and shaky (σ 0.03), pinned at the rim above 0.6, has no fine control
  below 0.15, and the thumb lifts off now and then (output 0 at once, also after 0.4 s with nothing to do). It lands
  again with an offset of 0.04–0.14 and a gain error of ±25 % until the next lift. The simulator's touch shaping follows
  (dead zone 0.07, expo 0.4).
- `digital`: arrow keys through the real key ramp (`src/input/logic.js`). With the assist it holds a key while more
  than 6° off and lets go early by what the reticle will still move in its reaction time. Near the aim it taps (a few
  per second at most).
- It fires when it sees the gun cross on the lead point, and it pulls out of dives it sees heading into the ground.

## Using it outside a mission (free flight)

`createAssist(combat)` reads only these from `combat`, so a free-flight caller can pass a small adapter object:

| field | used for |
|---|---|
| `world.player` | the flown entity: `state` (position, velocity, quaternion, aoa, gLoad, ias, tas, roll, heading, onGround, crashed, overspeed, `surfaces.gear`, `ap.engaged`), `controls` (written), `def` and `sim` (for `ai/fly.js profileOf`), `pilot` (null = a human flies), `alive`, `up` / `right`, optional `target` / `loadout` |
| `difficulty` | the defaults (`'rookie' \| 'veteran' \| 'ace'`); or call `setMode` / `setAimAssist` explicitly |
| `ctx.world.groundHeightAt(x, z)` | the ground protection (0 without it) |
| `ctx.camera`, `camera.mode` | pointer aim and the `'view'` frame (optional) |
| `ctx.input.mode`, `ctx.input.mouseYoke` | key detection with `device: 'auto'` (optional) |
| `result` | truthy = the mission has ended, the assist stays out (leave undefined) |
| `weapons.gunSolution` | gun help (optional) |

Call `update(dt)` after the input layer has written `ctx.controls` and before the physics step, only while a human
flies, and `reset()` when the flight starts.
