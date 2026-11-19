// Unit tests for the pure-JS parts of the cloud module (CPU mirrors used by densityAt / lightning / audio queries).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoise2D } from './noise.js';
import { makeWeatherFieldJS, deriveWeatherParams, densityFromField } from './weather-field.js';
import { WEATHER_PRESETS } from '../core/weather.js';

const noise = createNoise2D(1337);
const field = makeWeatherFieldJS(noise);
const bake = { sx: 1, sz: 0, streets: 0, convective: 0, time: 0 };

test('2D noise is tiling, deterministic and in range', () => {
  const a = noise.sample(0.123, 0.456, [0, 0, 0, 0]).slice(), b = noise.sample(1.123, -0.544, [0, 0, 0, 0]).slice();
  for (let i = 0; i < 4; i++) { assert.ok(a[i] >= 0 && a[i] <= 1); assert.ok(Math.abs(a[i] - b[i]) < 1e-6); }
  const again = createNoise2D(1337).sample(0.123, 0.456, [0, 0, 0, 0]);
  assert.deepEqual(Array.from(again), Array.from(a));
});

test('weather field stays in [0,1] and varies over 100 km', () => {
  let lo = 1, hi = 0; const o = {};
  for (let i = 0; i < 400; i++) {
    field(i * 937.0 - 150000, i * 411.0 + 20000, bake, o);
    for (const k of ['m', 'dev', 'rain', 'vari']) assert.ok(o[k] >= 0 && o[k] <= 1 && Number.isFinite(o[k]), k);
    lo = Math.min(lo, o.m); hi = Math.max(hi, o.m);
  }
  assert.ok(hi - lo > 0.3, 'coverage potential should have large-scale structure');
});

test('derived parameters are finite and ordered for every preset', () => {
  let prevBias = -1;
  for (const name of ['clear', 'fair', 'scattered', 'broken', 'overcast']) {
    const p = deriveWeatherParams(WEATHER_PRESETS[name]);
    for (const k in p) assert.ok(Number.isFinite(p[k]), `${name}.${k}`);
    assert.ok(p.covBias >= prevBias, `coverage bias grows towards ${name}`); prevBias = p.covBias;
    assert.ok(p.thickness >= 300 && p.sigma > 0 && p.topMin > 0 && p.topMin <= 1);
  }
  const storm = deriveWeatherParams(WEATHER_PRESETS.storm);
  assert.equal(storm.convective, 1); assert.equal(storm.stratus, 0); assert.ok(storm.anvil > 0.9);
  assert.equal(deriveWeatherParams(WEATHER_PRESETS.clear).covBias, 0);
});

test('CPU density: empty outside the layer and in clear weather, present in overcast', () => {
  const o = {}; field(1000, 2000, bake, o);
  const oc = deriveWeatherParams(WEATHER_PRESETS.overcast);
  assert.equal(densityFromField(oc, o, 0.8, oc.base - 10), 0);
  assert.equal(densityFromField(oc, o, 0.8, oc.top + 10), 0);
  let filled = 0;
  for (let i = 0; i < 200; i++) {
    field(i * 1733.0, i * 911.0, bake, o);
    const d = densityFromField(oc, o, 0.75, oc.base + 0.3 * oc.thickness);
    assert.ok(d >= 0 && d <= 1);
    if (d > 0.2) filled++;
  }
  assert.ok(filled > 120, `overcast should be mostly filled (${filled}/200)`);
  const cl = deriveWeatherParams(WEATHER_PRESETS.clear);
  assert.equal(densityFromField(cl, o, 1.0, cl.base + 0.3 * cl.thickness), 0);
});
