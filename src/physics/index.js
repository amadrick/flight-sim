// Flight dynamics — public API of the physics module.
//
//   createSim(ctx, def, init) -> { state, step(dt, controls), reset(init), dispose(), command(name), model, trim, debug }
//     ctx   needs: events (on/emit), world.groundAt (+ groundHeightAt), weather (windAt, wind, turbulence, precipitation,
//           cloud*), rng, controls. No DOM / WebGL — runs in node (see testing.js, tools/flight-test.mjs).
//     def   aircraft definition (geometry + specs + physics config, see SCHEMA.md)
//     init  { position: Vector3 (world), heading (rad), speed (m/s TAS), onGround, gearDown, throttle (0..1), flaps (0..1) }
//           optional extras: gamma (rad flight-path angle for air starts), flapsIndex, fuel (0..1 fraction or kg),
//           parkingBrake, enginesRunning (default true), player (false = do not listen to 'cmd' events / ctx.controls)
//   isaAtmosphere(h [, out]) -> { T, p, rho, a }
//
// Start states: ground starts are settled in static equilibrium on the gear with engines idling and the take-off flap
// set; air starts are trimmed (AoA, pitch control, thrust) for level flight, or for a 3° descent when the gear is down
// and landing flap is requested. ctx.controls.throttle is set to the trimmed lever.
export { createSim } from './sim.js';
export { isaAtmosphere, casFromMach, machFromCas } from './atmosphere.js';
export { resolveConfig } from './config.js';
