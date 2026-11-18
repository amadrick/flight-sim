// Canonical shapes of the data that flows between modules. Owned by the integrator.
// Physics WRITES AircraftState; everything else READS it. Input WRITES Controls; physics READS it.
import * as THREE from 'three';

/**
 * AircraftState — one object per aircraft, mutated in place every physics step.
 * Body axes used everywhere outside physics internals: +X right wing, +Y up, -Z nose (three.js style).
 * Angles in radians, SI units throughout.
 */
export function createAircraftState() {
  return {
    // --- rigid body (WORLD space; see core/world.js) ---
    position: new THREE.Vector3(),        // of the body origin (nominal CG). y = altitude MSL
    quaternion: new THREE.Quaternion(),   // body -> world
    velocity: new THREE.Vector3(),        // world, m/s (inertial; includes wind drift)
    acceleration: new THREE.Vector3(),    // world, m/s^2 (for camera shake / effects)
    bodyRates: { p: 0, q: 0, r: 0 },      // rad/s. p: roll rate (+ = right wing down), q: pitch rate (+ = nose up), r: yaw rate (+ = nose right)
    // --- air data / attitude (derived each step) ---
    tas: 0,            // true airspeed m/s
    ias: 0,            // indicated (≈ calibrated/equivalent) airspeed m/s
    mach: 0,
    aoa: 0,            // angle of attack, rad
    beta: 0,           // sideslip, rad (+ = wind from the right)
    altitude: 0,       // m MSL (== position.y)
    agl: 0,            // m above the surface under the aircraft (radar altitude of the body origin minus rest height ≈ wheel height)
    verticalSpeed: 0,  // m/s, + up
    groundSpeed: 0,    // m/s
    heading: 0,        // true heading rad, 0 = north (-Z), π/2 = east (+X), range [0, 2π)
    track: 0,          // ground track rad
    pitch: 0,          // rad, + nose up
    roll: 0,           // rad, + right wing down
    gLoad: 1,          // normal load factor Nz (1 in level flight, felt by pilot)
    gLateral: 0,
    // --- controls as actually applied (after FBW/actuators) ---
    throttle: 0,       // pilot lever 0..1 (for AB aircraft: > 0.9 is afterburner range)
    engines: [],       // [{ running, n1 (0..1.05), n2, thrust (N), afterburner (0..1), nozzle (0..1 open), fuelFlow (kg/s), egt (°C), reverser (0..1) }]
    surfaces: {        // normalized deflections for the visual model + effects
      aileronL: 0, aileronR: 0,     // -1..1, + = trailing edge UP on that side (roll right => R +, L -)
      elevatorL: 0, elevatorR: 0,   // -1..1, + = trailing edge UP (nose-up). Stabilators/tailerons use these too (may differ L/R for roll)
      rudder: 0,                    // -1..1, + = trailing edge RIGHT (nose right)
      flaps: 0, slats: 0,           // 0..1 extended
      spoilerL: 0, spoilerR: 0,     // 0..1 raised (roll spoilers + ground spoilers)
      speedbrake: 0,                // 0..1
      gear: 1,                      // 0 = up & locked, 1 = down & locked
      hook: 0, wingSweep: 0, canopy: 0, // 0..1
      nozzlePitch: 0,               // -1..1 thrust vectoring (F-22)
    },
    gear: [],          // per wheel unit, same order as def.geometry.gear: [{ onGround, compression (0..1), wheelSpeed (rad/s), steer (rad), skid (0..1) }]
    onGround: false,
    brakes: 0, parkingBrake: false,
    flapsIndex: 0,     // current detent index into def flap schedule
    // --- mass / systems ---
    mass: 0, fuel: 0, fuelCapacity: 0,   // kg
    stalled: false, stallWarning: false, overspeed: false, overG: false,
    crashed: false, crashReason: '',
    ap: { engaged: false, mode: '', altitude: 0, heading: 0, speed: 0, verticalSpeed: 0, autothrottle: false },
    lights: { nav: true, strobe: true, beacon: true, landing: false, taxi: false },
  };
}

/** Controls — written by the input module every frame, read by physics. */
export function createControls() {
  return {
    pitch: 0,      // -1..1, + = stick BACK (nose up)
    roll: 0,       // -1..1, + = stick RIGHT (roll right)
    yaw: 0,        // -1..1, + = right pedal (nose right)
    throttle: 0,   // 0..1 lever. Aircraft with afterburner: 0..0.9 = idle..MIL, 0.9..1 = min..max AB. Others: 1 = TOGA
    brakes: 0,     // 0..1 wheel brakes (held)
    speedbrake: 0, // 0..1 commanded (input toggles this between 0 and 1)
    lookX: 0, lookY: 0,  // head/camera look, -1..1
    zoom: 0,       // -1..1
    // Discrete actions are NOT here — they are events: ctx.events.emit('cmd', { name }) — see ARCHITECTURE.md §Commands
  };
}
