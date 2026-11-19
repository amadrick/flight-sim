# Physics module — integration notes

Public API (`src/physics/index.js`): `createSim(ctx, def, init) → { state, step(dt, controls), reset(init), dispose() }`
and `isaAtmosphere(h[, out])` exactly as in ARCHITECTURE.md. Additions that do not change the contract:

- `sim.command(name)` (same names as the `cmd` event), `sim.model` (resolved config), `sim.trim` (last trim solution),
  `sim.debug` (internal aero / FCS / engine / wheel state for tools), and the exports `casFromMach`, `machFromCas`,
  `resolveConfig`. `init.player === false` creates a sim that does not listen to `cmd` events or write `ctx.controls`
  (for AI traffic / replays). Other optional `init` fields: `gamma`, `flapsIndex`, `fuel`, `parkingBrake`,
  `enginesRunning`.
- Pure JS, no DOM/WebGL, no module-level mutable state; `src/physics/testing.js` provides a mock `ctx` for node.

## Requested changes in integrator-owned files

1. **`package.json` → `"test": "node --test"`**. The current script (`node --test tests/ src/`) fails on Node 22
   (directory arguments are loaded as modules, and `tests/` does not exist). Plain `node --test` discovers
   `src/**/*.test.js` and also `tools/flight-test.mjs` (its name matches the runner's `*-test.mjs` pattern), which then
   flight-tests every aircraft that has a tuned config.
2. Nothing else is required. Optional: `Controls` could gain `trim` / `nosewheel` axes later; the engine ignores unknown
   fields.

## Behaviour other modules should know about

- **Ground starts get the take-off flap** (`aero.flaps.takeoff` detent) when `init.flaps` is 0, and the engines idle.
  Air starts with gear down and `init.flaps > 0.5` are trimmed on a 3° descent with the `landing` detent.
- **`ctx.controls.throttle` is written by physics** at (re)start (trimmed lever) and while the autothrottle (`apSpdHold`
  / `apToggle`) is engaged, so the input module's lever follows. Moving the lever by more than a small amount
  disengages the autothrottle; a large stick input disengages ALT/HDG hold.
- **Speedbrake**: the `Controls.speedbrake` field wins whenever it changes; the `speedbrakeToggle` command flips the
  current state and is mirrored back into `ctx.controls.speedbrake`. Either interface works alone.
- **Automatic systems**: ground spoilers and thrust reversers deploy by themselves after touchdown with the lever at
  idle (stow below ~25 m/s or when the lever is advanced); F-16 flaps follow the gear handle, its leading-edge flaps
  follow AoA/Mach; gear retraction is refused with weight on wheels.
- **Keyboard aids** (config flags `fcs.rotationAssist`, `fcs.groundYawAssist`): rotation-rate / tail-strike protection
  on the wheels and in the flare, and a runway yaw-rate law (heading held against crosswind with pedals centred).
- **Events emitted**: `crash { reason, speed }`, `touchdown { verticalSpeed (≤0), sinkRate, gear (index), hard, speed }`,
  `sonicBoom`, `gear:moved { target }`, `flaps:moved { target, index, name }`; extras: `catapult`, `hook:trap`.
- **Extra `state` fields** (beyond `createAircraftState()`): `buffet` (0..1 shake cue), `tailStrike`, `reverse`,
  `groundSpoilers`, `arrested`, `nanRecoveries`, `surfaces.trim`, `engines[i].starting`, `ap.altHold`, `ap.hdgHold`.
- **Crash handling**: after `crash` the engines stop, the wreck follows a ballistic path to the surface, slides to a
  stop and settles on its belly; `state.crashed` stays true until `reset()`.
- **Surfaces**: `groundAt().type` `runway | taxiway | apron` (hard), `terrain` (soft, rough, higher rolling drag),
  `water` (ditching = crash), `deck` (hard; `velocity` honoured, hook traps). `friction`, if given, overrides μ.
  Rain (`weather.precipitation`) lowers tyre friction.
- `state.agl` is the height of the wheels above the surface under the origin (0 at rest on the gear).
