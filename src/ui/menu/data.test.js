import test from 'node:test';
import assert from 'node:assert/strict';
import { phaseOf, AC_FILTERS, parseKeys, specRows, metar, fmtClock, prettyKey, bindingSegments, DEFAULT_BINDINGS, clearanceLine } from './data.js';
import f16 from '../../aircraft/f16/index.js';
import b738 from '../../aircraft/b738/index.js';
import { AIRPORTS } from '../../data/airports.js';
import { WEATHER_PRESETS } from '../../core/weather.js';

test('parseKeys splits segments and alternatives', () => {
  assert.deepEqual(parseKeys('S|↓ / W|↑'), [['S', '↓'], ['W', '↑']]);
  assert.deepEqual(parseKeys(', / .'), [[','], ['.']]);
  assert.deepEqual(parseKeys('C / Shift+C'), [['C'], ['Shift+C']]);
  assert.deepEqual(parseKeys('R|=|PageUp / F|-|PageDown'), [['R', '=', 'PageUp'], ['F', '-', 'PageDown']]);
});
test('default bindings cover the §10 table (22 rows)', () => {
  assert.equal(DEFAULT_BINDINGS.length, 22);
  assert.equal(bindingSegments({ keys: ['KeyG'] })[0][0], 'G');
  assert.equal(prettyKey('ArrowUp'), '↑');
  assert.equal(prettyKey('Digit9'), '9');
});
test('spec rows in pilot units', () => {
  const r = Object.fromEntries(specRows(f16).map(x => [x.k, x.v + ' ' + (x.u || '')]));
  assert.match(r['Max speed'], /^M 2\.05/);
  assert.equal(r['Ceiling'], '50,000 ft');
  assert.equal(r['Thrust A/B'], '29,450 lbf');
  assert.equal(r['MTOW'], '42,300 lb');
  assert.equal(r['Stall'], '121 kt');
  assert.equal(r['G limits'], '+9 / -3 G');
  const b = Object.fromEntries(specRows(b738).map(x => [x.k, x.v]));
  assert.equal(b['Thrust'], '2×27,290');
  assert.equal(b['Climb'], '3,000');
});
test('metar + clock', () => {
  assert.equal(fmtClock(10.5), '10:30');
  assert.equal(fmtClock(23.999), '00:00');
  const m = metar(AIRPORTS[0], WEATHER_PRESETS.scattered, 14);
  assert.match(m, /^KHVN 211400Z 23014KT 9999 SCT046 \d\d\/\d\d Q\d{4}$/);
  assert.match(metar(AIRPORTS[0], WEATHER_PRESETS.storm, 3), /\+TSRA OVC016CB/);
  assert.match(clearanceLine(AIRPORTS[0], '09L', 'runway', f16), /RWY 09L/);
});
test('day phases and picker filters', () => {
  assert.equal(phaseOf(12), 'Midday');
  assert.equal(phaseOf(23), 'Night');
  assert.equal(phaseOf(-1), 'Night');
  assert.equal(phaseOf(18.3), 'Golden hour');
  assert.deepEqual(AC_FILTERS.map(f => f.id), ['all', 'military', 'commercial']);
});
import { rimAngle, sceneOf } from './glass.js';
test('glass: rim light direction and scene tint', () => {
  assert.equal(rimAngle(0, 1), 180);     // light from above: gradient runs downward, bright edge on top
  assert.equal(rimAngle(1, 0), 270);     // light from the right: bright edge on the right
  assert.equal(rimAngle(-1, 0), 90);
  assert.equal(rimAngle(0, -1), 0);
  assert.equal(sceneOf(0), 'day'); assert.equal(sceneOf(0.4), 'dusk'); assert.equal(sceneOf(0.9), 'night');
});

import { defaultQualityFor, TOUCH_HELP } from './data.js';
test('phones start at low quality, tablets at medium, desktops keep theirs', () => {
  assert.equal(defaultQualityFor(true, 390, 844, 'high'), 'low');
  assert.equal(defaultQualityFor(true, 844, 390, 'medium'), 'low');
  assert.equal(defaultQualityFor(true, 768, 1024, 'high'), 'medium');
  assert.equal(defaultQualityFor(true, 768, 1024, 'low'), 'low');
  assert.equal(defaultQualityFor(false, 390, 844, 'high'), 'high');
  assert.equal(defaultQualityFor(true, 1440, 2560, 'high'), 'high');
  assert.ok(TOUCH_HELP.length >= 6);
});
