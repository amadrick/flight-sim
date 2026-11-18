import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  clamp, saturate, lerp, smoothstep, damp, wrapPi, wrap2Pi, moveToward, makeRng, interp1,
} from '../src/core/math.js';
import { Events } from '../src/core/events.js';
import { createWorld } from '../src/core/world.js';
import { sunDirection } from '../src/core/time.js';
import { createWeather } from '../src/core/weather.js';
import { AIRPORTS, headingVector, runwayEnd, runwayLocal } from '../src/data/airports.js';
import { createAircraftState, createControls } from '../src/core/state.js';

const PI = Math.PI;
const DEG = PI / 180;

/** assert |actual - expected| <= tol, with a readable message */
function closeTo(actual, expected, tol, msg = '') {
  assert.ok(Math.abs(actual - expected) <= tol,
    `${msg} expected ${actual} to be within ${tol} of ${expected}`);
}

// ---------------------------------------------------------------- core/math.js

test('clamp and saturate limit values to their ranges', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-1, 0, 1), 0);
  assert.equal(clamp(0.5, 0, 1), 0.5);
  assert.equal(saturate(2), 1);
  assert.equal(saturate(-3), 0);
  assert.equal(saturate(0.25), 0.25);
});

test('lerp interpolates linearly', () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  closeTo(lerp(0, 10, 0.3), 3, 1e-12, 'lerp midpoint');
});

test('smoothstep has correct endpoints and midpoint', () => {
  assert.equal(smoothstep(0, 1, 0), 0);
  assert.equal(smoothstep(0, 1, 1), 1);
  assert.equal(smoothstep(0, 1, -5), 0);
  assert.equal(smoothstep(0, 1, 5), 1);
  closeTo(smoothstep(0, 1, 0.5), 0.5, 1e-12, 'smoothstep midpoint');
});

test('damp converges towards the target', () => {
  let v = 0;
  for (let i = 0; i < 600; i++) v = damp(v, 1, 3, 1 / 60);
  closeTo(v, 1, 1e-6, 'damp convergence');
  // one large step never overshoots
  const big = damp(0, 1, 5, 100);
  assert.ok(big > 0 && big <= 1, 'damp must not overshoot');
});

test('damp is frame-rate independent: two half steps equal one full step', () => {
  const full = damp(0, 1, 2.5, 0.2);
  const half = damp(damp(0, 1, 2.5, 0.1), 1, 2.5, 0.1);
  closeTo(half, full, 1e-12, 'damp half steps');
});

test('wrapPi maps angles into [-pi, pi)', () => {
  closeTo(wrapPi(0), 0, 1e-12, 'wrapPi(0)');
  closeTo(wrapPi(3 * PI / 2), -PI / 2, 1e-12, 'wrapPi(3pi/2)');
  closeTo(wrapPi(-3 * PI / 2), PI / 2, 1e-12, 'wrapPi(-3pi/2)');
  closeTo(wrapPi(4), 4 - 2 * PI, 1e-12, 'wrapPi(4)');
  closeTo(wrapPi(-4), -4 + 2 * PI, 1e-12, 'wrapPi(-4)');
  for (const a of [-100, -7, -PI, 0, PI, 7, 100]) {
    const w = wrapPi(a);
    assert.ok(w >= -PI && w < PI, `wrapPi(${a}) = ${w} out of range`);
  }
});

test('wrap2Pi maps angles into [0, 2pi), including negative inputs', () => {
  closeTo(wrap2Pi(0), 0, 1e-12, 'wrap2Pi(0)');
  closeTo(wrap2Pi(-1), 2 * PI - 1, 1e-12, 'wrap2Pi(-1)');
  closeTo(wrap2Pi(7), 7 - 2 * PI, 1e-12, 'wrap2Pi(7)');
  closeTo(wrap2Pi(-2 * PI), 0, 1e-9, 'wrap2Pi(-2pi)');
  for (const a of [-100, -7, -0.5, 0, 1, 6.5, 100]) {
    const w = wrap2Pi(a);
    assert.ok(w >= 0 && w < 2 * PI, `wrap2Pi(${a}) = ${w} out of range`);
  }
});

test('moveToward steps by at most maxDelta and snaps when close', () => {
  assert.equal(moveToward(0, 10, 3), 3);
  assert.equal(moveToward(0, -10, 3), -3);
  assert.equal(moveToward(0, 2, 3), 2);
  assert.equal(moveToward(5, 5, 1), 5);
});

test('makeRng is deterministic per seed, yields [0,1) and differs across seeds', () => {
  const a = makeRng(42), b = makeRng(42), c = makeRng(43);
  const seqA = Array.from({ length: 50 }, () => a());
  const seqB = Array.from({ length: 50 }, () => b());
  const seqC = Array.from({ length: 50 }, () => c());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const v of seqA) assert.ok(v >= 0 && v < 1, `rng value ${v} outside [0,1)`);
});

test('interp1 interpolates inside, returns knots exactly and clamps outside', () => {
  const xs = [0, 1, 2], ys = [0, 10, 40];
  closeTo(interp1(xs, ys, 0.5), 5, 1e-12, 'inside first segment');
  closeTo(interp1(xs, ys, 1.5), 25, 1e-12, 'inside second segment');
  assert.equal(interp1(xs, ys, 0), 0);
  assert.equal(interp1(xs, ys, 1), 10);
  assert.equal(interp1(xs, ys, 2), 40);
  assert.equal(interp1(xs, ys, -5), 0);
  assert.equal(interp1(xs, ys, 99), 40);
});

// ------------------------------------------------------------- core/events.js

test('on returns an unsubscribe function that stops delivery', () => {
  const ev = new Events();
  let n = 0;
  const off = ev.on('tick', () => n++);
  assert.equal(typeof off, 'function');
  ev.emit('tick');
  off();
  ev.emit('tick');
  assert.equal(n, 1);
});

test('once fires exactly once', () => {
  const ev = new Events();
  let n = 0;
  ev.once('boot', () => n++);
  ev.emit('boot');
  ev.emit('boot');
  ev.emit('boot');
  assert.equal(n, 1);
});

test('emit passes the payload to handlers', () => {
  const ev = new Events();
  const got = [];
  ev.on('data', (p) => got.push(p));
  const payload = { delta: 1, tag: 'x' };
  ev.emit('data', payload);
  assert.equal(got.length, 1);
  assert.equal(got[0], payload);
});

test('a throwing handler does not stop the other handlers', (t) => {
  t.mock.method(console, 'error', () => {});
  const ev = new Events();
  const seen = [];
  ev.on('x', () => { throw new Error('boom'); });
  ev.on('x', (p) => seen.push(p));
  ev.emit('x', 42);
  assert.deepEqual(seen, [42]);
  assert.equal(console.error.mock.callCount(), 1);
});

// --------------------------------------------------------------- core/world.js

const makeWorld = () => {
  const events = new Events();
  const world = createWorld({ events });
  return { events, world };
};

test('toRender and toWorld round-trip after the origin has moved', () => {
  const { world } = makeWorld();
  world.updateOrigin(new THREE.Vector3(5000, 0, -3000));
  const w = new THREE.Vector3(5100, 120, -2900);
  const r = world.toRender(w);
  closeTo(r.x, w.x - world.origin.x, 1e-9, 'render x');
  closeTo(r.y, w.y, 1e-9, 'render y equals altitude');
  closeTo(r.z, w.z - world.origin.z, 1e-9, 'render z');
  const back = world.toWorld(r);
  closeTo(back.x, w.x, 1e-9, 'round-trip x');
  closeTo(back.y, w.y, 1e-9, 'round-trip y');
  closeTo(back.z, w.z, 1e-9, 'round-trip z');
});

test('updateOrigin does not move the origin for small offsets', () => {
  const { world } = makeWorld();
  const moved = world.updateOrigin(new THREE.Vector3(100, 50, 100));
  assert.equal(moved, false);
  assert.equal(world.origin.x, 0);
  assert.equal(world.origin.z, 0);
});

test('updateOrigin snaps to a multiple of 1024 for large offsets, keeps y at 0, emits originShift', () => {
  const { world, events } = makeWorld();
  const shifts = [];
  events.on('originShift', (p) => shifts.push(p));
  const moved = world.updateOrigin(new THREE.Vector3(3000, 5000, -5000));
  assert.equal(moved, true);
  assert.equal(world.origin.x, 3072);
  assert.equal(world.origin.z, -5120);
  assert.equal(world.origin.y, 0);
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0].delta.x, 3072);
  assert.equal(shifts[0].delta.y, 0);
  assert.equal(shifts[0].delta.z, -5120);
});

test('anchored objects are repositioned when the origin shifts', () => {
  const { world } = makeWorld();
  const obj = new THREE.Object3D();
  world.anchor(obj, new THREE.Vector3(3000, 10, -5000));
  assert.equal(obj.position.x, 3000);
  world.updateOrigin(new THREE.Vector3(3000, 0, -5000));
  assert.equal(obj.position.x, 3000 - 3072);
  assert.equal(obj.position.y, 10);
  assert.equal(obj.position.z, -5000 + 5120);
});

test('groundAt reports water below sea level and terrain above it', () => {
  const { world } = makeWorld();
  world.setTerrainHeightFn(() => -5);
  const wet = world.groundAt(0, 0);
  assert.equal(wet.type, 'water');
  assert.equal(wet.height, 0);
  world.setTerrainHeightFn(() => 100);
  const dry = world.groundAt(0, 0);
  assert.equal(dry.type, 'terrain');
  assert.equal(dry.height, 100);
});

test('surface providers can override type and friction, and can be removed', () => {
  const { world } = makeWorld();
  world.setTerrainHeightFn(() => 100);
  const off = world.addSurfaceProvider((x, z, out) => {
    if (Math.abs(x) < 100 && Math.abs(z) < 100) { out.type = 'runway'; out.friction = 0.4; }
  });
  const onRunway = world.groundAt(0, 0);
  assert.equal(onRunway.type, 'runway');
  assert.equal(onRunway.friction, 0.4);
  assert.equal(world.groundAt(5000, 0).type, 'terrain');
  off();
  assert.equal(world.groundAt(0, 0).type, 'terrain');
});

test('groundNormalAt is up on flat ground and tilts downhill on slopes', () => {
  const { world } = makeWorld();
  world.setTerrainHeightFn(() => 50);
  const flat = world.groundNormalAt(10, 20);
  closeTo(flat.x, 0, 1e-9, 'flat normal x');
  closeTo(flat.y, 1, 1e-9, 'flat normal y');
  closeTo(flat.z, 0, 1e-9, 'flat normal z');

  // height rises towards +X (east): the surface faces up and west (-X).
  // Heights kept above sea level so the water clamp in groundAt does not affect the samples.
  world.setTerrainHeightFn((x) => 100 + 0.1 * x);
  const eastRising = world.groundNormalAt(0, 0);
  assert.ok(eastRising.x < 0, 'normal should tilt west on an east-rising slope');
  assert.ok(eastRising.y > 0);
  closeTo(eastRising.x, -0.1 / Math.hypot(0.1, 1), 1e-6, 'east slope normal');

  // height rises towards +Z (south): the surface faces up and north (-Z)
  world.setTerrainHeightFn((x, z) => 100 + 0.1 * z);
  const southRising = world.groundNormalAt(0, 0);
  assert.ok(southRising.z < 0, 'normal should tilt north on a south-rising slope');
  closeTo(southRising.z, -0.1 / Math.hypot(0.1, 1), 1e-6, 'south slope normal');
});

// ----------------------------------------------------------------- core/time.js

test('sunDirection returns a unit vector', () => {
  for (const h of [0, 6, 9.5, 12, 17, 23.9]) {
    const s = sunDirection(h, 172, 34);
    closeTo(s.length(), 1, 1e-9, `length at ${h}h`);
  }
});

test('sun at 34N in June: highest at noon, due south, elevation about 79 degrees', () => {
  const noon = sunDirection(12, 172, 34);
  const elevation = Math.asin(noon.y) / DEG;
  closeTo(elevation, 79, 2, 'noon elevation');
  assert.ok(noon.z > 0, 'noon sun should be to the south (+Z)');
  closeTo(noon.x, 0, 1e-6, 'noon sun has no east-west component');
  assert.ok(noon.y > sunDirection(10, 172, 34).y, 'noon higher than 10h');
  assert.ok(noon.y > sunDirection(14, 172, 34).y, 'noon higher than 14h');
});

test('sun rises in the east, sets in the west and is below horizon at midnight', () => {
  assert.ok(sunDirection(8, 172, 34).x > 0, '8h sun in the east (+X)');
  assert.ok(sunDirection(18, 172, 34).x < 0, '18h sun in the west (-X)');
  assert.ok(sunDirection(0, 172, 34).y < 0, 'midnight sun below horizon');
});

// --------------------------------------------------------------- core/weather.js

test('createWeather starts from the default preset with its values', () => {
  const ctx = { events: new Events() };
  const w = createWeather(ctx, {});
  assert.equal(w.preset, 'fair');
  assert.equal(w.cloudCoverage, 0.22);
  assert.equal(w.visibility, 80000);
  assert.equal(typeof w.windFrom, 'number');
  assert.equal(typeof w.windSpeed, 'number');
});

test('setPreset with instant=true applies the preset values immediately', () => {
  const ctx = { events: new Events() };
  const w = createWeather(ctx, {});
  const seen = [];
  ctx.events.on('weather:change', (p) => seen.push(p));
  w.setPreset('storm', true);
  assert.equal(w.preset, 'storm');
  assert.equal(w.cloudCoverage, 0.97);
  assert.equal(w.lightning, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].preset, 'storm');
  assert.equal(seen[0].instant, true);
});

test('wind FROM the west blows toward +X (east)', () => {
  const ctx = { events: new Events() };
  const w = createWeather(ctx, {});
  w.target = { ...w.target, windFrom: 270 };
  w.windSpeed = 10; // smoothed value; update(0) does not move it
  w.update(0);
  closeTo(w.wind.x, 10, 1e-9, 'wind x from west');
  closeTo(w.wind.z, 0, 1e-9, 'wind z from west');
  closeTo(w.wind.y, 0, 1e-12, 'wind y');
});

test('wind FROM the north blows toward +Z (south)', () => {
  const ctx = { events: new Events() };
  const w = createWeather(ctx, {});
  w.target = { ...w.target, windFrom: 0 };
  w.windSpeed = 10;
  w.update(0);
  closeTo(w.wind.x, 0, 1e-9, 'wind x from north');
  closeTo(w.wind.z, 10, 1e-9, 'wind z from north');
});

test('windAt increases with altitude and never returns NaN', () => {
  const ctx = { events: new Events() };
  const w = createWeather(ctx, {});
  const speedAt = (y) => w.windAt(new THREE.Vector3(0, y, 0)).length();
  const low = speedAt(10), mid = speedAt(1000), high = speedAt(3000);
  assert.ok(low < mid, `wind at 10 m (${low}) should be below 1000 m (${mid})`);
  assert.ok(mid < high, `wind at 1000 m (${mid}) should be below 3000 m (${high})`);
  for (const y of [-50, 0, 2, 10, 600, 1e5]) {
    const v = w.windAt(new THREE.Vector3(0, y, 0));
    assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z), `NaN at y=${y}`);
  }
});

// --------------------------------------------------------------- data/airports.js

test('every airport has a unique id, at least one runway with positive dimensions', () => {
  const ids = AIRPORTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'airport ids must be unique');
  for (const ap of AIRPORTS) {
    assert.ok(ap.runways.length >= 1, `${ap.id} has no runways`);
    for (const rwy of ap.runways) {
      assert.ok(rwy.length > 0, `${ap.id} ${rwy.id} length`);
      assert.ok(rwy.width > 0, `${ap.id} ${rwy.id} width`);
    }
  }
});

test('headingVector: north is -Z and east is +X', () => {
  const n = headingVector(0);
  closeTo(n.x, 0, 1e-12, 'north x');
  closeTo(n.z, -1, 1e-12, 'north z');
  const e = headingVector(90);
  closeTo(e.x, 1, 1e-12, 'east x');
  closeTo(e.z, 0, 1e-9, 'east z');
});

test('runwayEnd thresholds are one runway length apart along the heading', () => {
  for (const ap of AIRPORTS) {
    for (const rwy of ap.runways) {
      const e = runwayEnd(rwy, 0);
      const dx = e.farEnd.x - e.threshold.x, dz = e.farEnd.z - e.threshold.z;
      closeTo(Math.hypot(dx, dz), rwy.length, 1e-6, `${ap.id} ${rwy.id} threshold spacing`);
      const hv = headingVector(rwy.heading);
      closeTo(dx / rwy.length, hv.x, 1e-9, `${ap.id} ${rwy.id} direction x`);
      closeTo(dz / rwy.length, hv.z, 1e-9, `${ap.id} ${rwy.id} direction z`);
    }
  }
});

test('runwayEnd(…, 1) is the reciprocal with swapped thresholds', () => {
  for (const ap of AIRPORTS) {
    for (const rwy of ap.runways) {
      const a = runwayEnd(rwy, 0), b = runwayEnd(rwy, 1);
      assert.equal((b.heading - a.heading + 360) % 360, 180, `${ap.id} ${rwy.id} reciprocal heading`);
      closeTo(b.threshold.x, a.farEnd.x, 1e-6, `${ap.id} ${rwy.id} swapped x`);
      closeTo(b.threshold.z, a.farEnd.z, 1e-6, `${ap.id} ${rwy.id} swapped z`);
    }
  }
});

test('runwayLocal: centre is on the centreline, far end of end 0 is at +length/2', () => {
  const rwy = AIRPORTS[0].runways[0];
  const c = runwayLocal(rwy, rwy.center.x, rwy.center.z);
  closeTo(c.along, 0, 1e-9, 'centre along');
  closeTo(c.cross, 0, 1e-9, 'centre cross');
  const far = runwayEnd(rwy, 0).farEnd;
  const f = runwayLocal(rwy, far.x, far.z);
  closeTo(f.along, rwy.length / 2, 1e-6, 'far end along');
  closeTo(f.cross, 0, 1e-6, 'far end cross');
});

test('every runway centre lies within its airport flattenRadius', () => {
  for (const ap of AIRPORTS) {
    for (const rwy of ap.runways) {
      const d = Math.hypot(rwy.center.x - ap.position.x, rwy.center.z - ap.position.z);
      assert.ok(d <= ap.flattenRadius, `${ap.id} ${rwy.id} centre ${d} m from airport > ${ap.flattenRadius}`);
    }
  }
});

test('runway designator numbers agree with headings (within 5 degrees, true headings)', () => {
  const circDiff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
  for (const ap of AIRPORTS) {
    for (const rwy of ap.runways) {
      const [n0, n1] = rwy.id.split('/').map((s) => parseInt(s, 10) * 10);
      assert.ok(circDiff(n0, rwy.heading) <= 5, `${ap.id} ${rwy.id}: first end ${n0} vs heading ${rwy.heading}`);
      assert.ok(circDiff(n1, (rwy.heading + 180) % 360) <= 5,
        `${ap.id} ${rwy.id}: second end ${n1} vs reciprocal ${(rwy.heading + 180) % 360}`);
    }
  }
});

// ----------------------------------------------------------------- core/state.js

test('createAircraftState returns independent objects with finite numeric defaults', () => {
  const a = createAircraftState();
  const b = createAircraftState();
  a.position.x = 5;
  a.bodyRates.p = 1;
  a.surfaces.flaps = 1;
  a.engines.push({ running: true });
  assert.equal(b.position.x, 0, 'position must not be shared');
  assert.equal(b.bodyRates.p, 0, 'bodyRates must not be shared');
  assert.equal(b.surfaces.flaps, 0, 'surfaces must not be shared');
  assert.equal(b.engines.length, 0, 'engines array must not be shared');
  for (const k of ['tas', 'ias', 'mach', 'aoa', 'beta', 'altitude', 'agl', 'verticalSpeed',
    'groundSpeed', 'heading', 'track', 'pitch', 'roll', 'throttle', 'mass', 'fuel', 'brakes']) {
    assert.ok(Number.isFinite(b[k]), `${k} default must be a finite number`);
  }
});

test('createControls starts with pitch, roll, yaw, throttle and brakes at zero', () => {
  const c = createControls();
  for (const k of ['pitch', 'roll', 'yaw', 'throttle', 'brakes']) {
    assert.equal(c[k], 0, `${k} should default to 0`);
  }
});
