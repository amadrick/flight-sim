# Player flight assist (`combat.assist`)

Point-to-fly steering for phones, keyboards and pads. `combat.pre(dt)` runs it after the input layer and before the
player's physics, only while a human flies. It reads `ctx.controls.pitch / roll` as the player's intent and rewrites
`pitch / roll / yaw`. Throttle and speedbrake stay the player's, except for the rookie auto-throttle.

## How it flies

- **Nose command `N`** (`assist.command`, world unit vector). The stick turns it at a nose rate in the stick frame:
  right moves the nose right, back moves it up, a diagonal does both.
  - The rate is `shapeRate(m) × the available turn rate`, where `shapeRate(m) = m·(0.25 + 0.75·m²)`. Small deflections
    give fine aim (0.2 stick ≈ 2 °/s at 350 kt).
  - Full stick asks a little more than the G limit, so the turn is flown at the AoA / G limit.
  - The stick magnitude can rise at most 4 per second. A tap or a flick gives a small correction, and holding builds up
    to the full-rate turn.
  - `N` may lead the nose by up to 0.32 rad at full stick.
- **Path `P`** (`assist.path`) is the flight path that puts the nose on `N`.
  - `P` is `N` less 0.8 × the smoothed AoA, taken along the smoothed commanded lift direction, plus a slow integral of
    the remaining nose error.
  - The commanded lift is used, not the measured body axes. Measured axes tie the aim to the roll, and the two chase
    each other.
- **Steering.** The lift vector is rolled toward `P` (`ai/fly.js` `steer`), with gravity compensation and the commanded
  rate as feed-forward.
  - The gain is gentle for small errors (1.2/s) and firm for large ones (2.5/s).
  - When a correction needs less than ½ g of lift, or negative lift, the aircraft eases off or pushes with its wings
    where they are. A forward stick never rolls the aircraft inverted.
- **Release.**
  - After a hard turn held for more than 0.7 s, the aircraft rolls out on the flight path. During the roll-out, `P`
    keeps half of the turn's extra AoA ahead and is never left behind the path, so the aircraft does not reverse. The
    path then holds.
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
info { mode, active, gunAssist, limiting, pullUp, autoThrottle, aimPoint }
command, path, frameRight, frameUp          world vectors for HUD cues (draw `command` as the "nose goes here" reticle)
reset(), update(dt)
```

## Tools

```
node --test src/combat/assist
node src/combat/assist/tools/thumb.mjs steps [--types f16,f15,fa18,f14,a10] [--speeds 250,350,450] [--sticks analog,digital]
node src/combat/assist/tools/thumb.mjs track [--patterns turn,weave] [--aims 0,0.4,0.8] [--modes assist,direct]
node src/combat/assist/tools/thumb.mjs duel  [--types …] [--ai rookie,veteran] [--runs 8]
```

The **virtual thumb** only sees the screen.
- It sees the target, or the lead point inside 1.6 km, relative to the point it steers:
  - with the assist, the reticle of `N`;
  - with direct controls, the gun cross.
- What it sees is 150–250 ms late and noisy.
- Analog sticks are proportional plus a leaky integral. Digital input is arrow keys through the real key ramp
  (`src/input/logic.js`), held when far off and tapped near the aim.
- On direct controls it rolls the target above the canopy and pulls.
- It fires when it sees the gun cross on the lead point, and it pulls out of dives it sees heading into the ground.
