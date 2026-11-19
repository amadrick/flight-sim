// Headless harness helpers: a mock ctx (flat ground, calm ISA) so the flight model runs in node for unit tests and
// tools/flight-test.mjs. No DOM, no WebGL.
import * as THREE from 'three';
import { Events } from '../core/events.js';
import { createControls } from '../core/state.js';
import { makeRng } from '../core/math.js';

/**
 * opts: { groundHeight (m, default 0), surface ('runway'), wind: [x, y, z] m/s world (air mass velocity),
 *         turbulence 0..1, precipitation 0..1, seed, groundFn(x, z, out) custom surface,
 *         aero ('classic' switches the neural aerodynamics layer off; default from the env variable SKYWARD_AERO),
 *         aeroOff (comma-separated network outputs to switch off, default from SKYWARD_AERO_OFF),
 *         aeroGe (0..1 strength of the ground-effect pitch term, default from SKYWARD_AERO_GE, else off) }
 */
const ENV = typeof process !== 'undefined' && process.env ? process.env : {};

export function createMockContext(opts = {}) {
  const events = new Events();
  const wind = new THREE.Vector3(...(opts.wind || [0, 0, 0]));
  const ctx = {
    params: { seed: opts.seed ?? 1337, raw: { aero: opts.aero ?? ENV.SKYWARD_AERO, aeroOff: opts.aeroOff ?? ENV.SKYWARD_AERO_OFF, aeroGe: opts.aeroGe ?? ENV.SKYWARD_AERO_GE } },
    events,
    rng: makeRng(opts.seed ?? 1337),
    controls: createControls(),
    time: { now: 0, dt: 0 },
    weather: {
      wind, windSpeed: wind.length(), turbulence: opts.turbulence ?? 0, precipitation: opts.precipitation ?? 0,
      cloudBase: 1500, cloudTop: 3000, cloudCoverage: 0,
      windAt(p, out = new THREE.Vector3()) { return out.copy(wind); },
    },
    world: {
      surface: opts.surface || 'runway', height: opts.groundHeight ?? 0,
      groundAt(x, z, out = {}) {
        out.height = ctx.world.height; out.type = ctx.world.surface; out.friction = undefined; out.velocity = undefined;
        if (opts.groundFn) opts.groundFn(x, z, out);
        return out;
      },
      groundHeightAt(x, z) { return ctx.world.groundAt(x, z, {}).height; },
    },
    log: [],
  };
  for (const n of ['crash', 'touchdown', 'sonicBoom', 'gear:moved', 'flaps:moved']) events.on(n, (p) => ctx.log.push({ ...(p || {}), name: n }));
  return ctx;
}

export function makeInit(o = {}) {
  return { position: new THREE.Vector3(o.x || 0, o.alt ?? 0, o.z || 0), heading: o.heading || 0, speed: o.speed || 0,
    onGround: !!o.onGround, gearDown: o.gearDown ?? !!o.onGround, throttle: o.throttle || 0, flaps: o.flaps || 0, ...o.extra };
}
