// Unit tests for the pure-JS parts of the cloud module (CPU mirrors used by densityAt / lightning / audio queries).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoise2D, createCellField } from './noise.js';
import { makeWeatherFieldJS, deriveWeatherParams, densityFromField } from './weather-field.js';
import { WEATHER_PRESETS } from '../core/weather.js';

const noise = createNoise2D(1337);
const field = makeWeatherFieldJS(noise);
const bake = { sx: 1, sz: 0, streets: 0, convective: 0, time: 0 };
const N = (r) => [r, 0.48, 0.48, 0.5];          // base-noise RGBA with neutral billows
const NOCELL = [0, 0, 1, 0], CELLS = { dMin: 240, dMax: 4200 };

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
    for (const k in p) assert.ok(Array.isArray(p[k]) ? p[k].every(Number.isFinite) : Number.isFinite(p[k]), `${name}.${k}`);
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
  assert.equal(densityFromField(oc, o, N(0.8), oc.base - 10, NOCELL, CELLS), 0);
  assert.equal(densityFromField(oc, o, N(0.8), oc.top + 10, NOCELL, CELLS), 0);
  let filled = 0;
  for (let i = 0; i < 200; i++) {
    field(i * 1733.0, i * 911.0, bake, o);
    const d = densityFromField(oc, o, N(0.75), oc.base + 0.3 * oc.thickness, NOCELL, CELLS);
    assert.ok(d >= 0 && d <= 1);
    if (d > 0.2) filled++;
  }
  assert.ok(filled > 120, `overcast should be mostly filled (${filled}/200)`);
  const cl = deriveWeatherParams(WEATHER_PRESETS.clear);
  assert.equal(densityFromField(cl, o, N(1.0), cl.base + 0.3 * cl.thickness, [1, 1, 0, 0.5], CELLS), 0);
});

test('cell field: tiling, power-law sizes, clear air between cells', () => {
  const c = createCellField({ seed: 7, size: 256, period: 20480 });
  assert.ok(c.count > 50, `cells placed: ${c.count}`);
  const a = c.sample(0.31, 0.77, [0, 0, 0, 0]).slice(), b = c.sample(1.31, -0.23, [0, 0, 0, 0]);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-6);
  let inside = 0, n = 0, small = 0, big = 0;
  for (let i = 0; i < c.size * c.size; i++) {
    const r = c.data[i * 4]; n++;
    if (r >= 0.5) { inside++; const g = c.data[i * 4 + 1]; if (g < 0.3) small++; if (g > 0.7) big++; }
  }
  const f = inside / n;
  assert.ok(f > 0.3 && f < 0.6, `nominal disks cover ${f.toFixed(2)} of the area`);
  assert.ok(small > 0 && big > 0, 'both small and large cells');
});

test('CPU density with cells: fair weather has separate clouds with flat bases', () => {
  const c = createCellField({ seed: 1337, size: 512, period: 20480 });
  const p = deriveWeatherParams(WEATHER_PRESETS.fair), o = {}, cl = [0, 0, 0, 0];
  let cloudy = 0, n = 0, below = 0;
  for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) {
    const x = i * 97, z = j * 97;
    field(x, z, bake, o); o.m = 0.5; o.dev = 0.5;
    c.sample(x / c.period, z / c.period, cl);
    const d = densityFromField(p, o, N(0.6), p.base + 250, cl, c);
    n++; if (d > 0.1) cloudy++;
    if (densityFromField(p, o, N(0.6), p.base - 20, cl, c) > 0) below++;
  }
  assert.equal(below, 0, 'nothing below the condensation level');
  assert.ok(cloudy / n > 0.04 && cloudy / n < 0.5, `fair-weather cloud fraction ${(cloudy / n).toFixed(2)}`);
});

test('life cycle (round five): clouds change over minutes, without jumps, and the field keeps its cloud fraction', () => {
  const c = createCellField({ seed: 1337, size: 512, period: 20480 });
  const p = deriveWeatherParams(WEATHER_PRESETS.scattered), o = {}, cl = [0, 0, 0, 0];
  const frac = (t) => {
    let cloudy = 0, n = 0, maxJump = 0;
    for (let i = 0; i < 50; i++) for (let j = 0; j < 50; j++) {
      const x = i * 113, z = j * 113;
      field(x, z, bake, o); o.m = 0.5; o.dev = 0.5;
      c.sample(x / c.period, z / c.period, cl);
      const d = densityFromField(p, o, N(0.6), p.base + 200, cl, c, { on: 1, t });
      const d2 = densityFromField(p, o, N(0.6), p.base + 200, cl, c, { on: 1, t: t + 1 / 1400 });   // one second later
      maxJump = Math.max(maxJump, Math.abs(d2 - d));
      n++; if (d > 0.1) cloudy++;
    }
    return { f: cloudy / n, maxJump };
  };
  const a = frac(0), b = frac(0.37), c2 = frac(0.81);
  for (const r of [a, b, c2]) { assert.ok(r.f > 0.03 && r.f < 0.6, `cloud fraction ${r.f}`); assert.ok(r.maxJump < 0.35, `jump in 1 s: ${r.maxJump}`); }
  assert.ok(Math.abs(a.f - b.f) + Math.abs(b.f - c2.f) > 0.002, 'the field evolves');
  assert.ok(p.dropletN >= 50 && p.dropletN <= 1000);
});
