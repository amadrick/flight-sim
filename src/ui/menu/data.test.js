import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKeys, specRows, metar, fmtClock, prettyKey, bindingSegments, DEFAULT_BINDINGS, clearanceLine } from './data.js';
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
