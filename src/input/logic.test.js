import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeAxis, shapeStick, stepKeyAxis, stepThrottle, snapDetent, milLever, AB_DETENT } from './logic.js';
import { KEY_TABLE, CODE_MAP, BINDINGS } from './bindings.js';

const run = (fn, secs, dt = 1 / 60) => { for (let t = 0; t < secs - 1e-9; t += dt) fn(dt); };

test('dead zone and expo', () => {
  assert.equal(shapeAxis(0.05, 0.1), 0);
  assert.equal(shapeAxis(1, 0.1), 1);
  assert.equal(shapeAxis(-1, 0.1), -1);
  assert.ok(shapeAxis(0.5, 0.1, 0.5) < shapeAxis(0.5, 0.1, 0));
  const o = {}; shapeStick(0.03, 0.03, o, 0.1); assert.deepEqual(o, { x: 0, y: 0 });
  shapeStick(1, 0, o, 0.1, 0.3); assert.ok(Math.abs(o.x - 1) < 1e-9 && o.y === 0);
});

test('key axis: ramps in, taps stay fine, centres slower than ramp', () => {
  const st = { v: 0, t: 0, dir: 0 };
  run((dt) => stepKeyAxis(st, 1, dt), 0.1);
  assert.ok(st.v > 0.15 && st.v < 0.45, 'tap ' + st.v);
  run((dt) => stepKeyAxis(st, 1, dt), 0.6);
  assert.equal(st.v, 1);
  let tIn = 0, s2 = { v: 0, t: 0, dir: 0 }; while (s2.v < 1) { stepKeyAxis(s2, 1, 1 / 60); tIn += 1 / 60; }
  let tOut = 0; while (st.v > 0) { stepKeyAxis(st, 0, 1 / 60); tOut += 1 / 60; }
  assert.ok(tOut > tIn * 0.9);
  assert.equal(st.v, 0);
  // reversal is faster than a plain ramp
  const s3 = { v: 1, t: 0, dir: 1 }; run((dt) => stepKeyAxis(s3, -1, dt), 0.2); assert.ok(s3.v < 0);
});

test('throttle detent at MIL on AB aircraft', () => {
  const st = { t: 0, latched: false, extra: 0, dir: 0 }; let lever = 0.5;
  run((dt) => { lever = stepThrottle(st, lever, 1, dt, true); }, 3.0);
  assert.ok(Math.abs(lever - AB_DETENT) < 1e-9 || lever > AB_DETENT, 'lever ' + lever); // passed after 0.4 s extra hold
  // release and press again passes through
  lever = 0.85; const st2 = { t: 0, latched: false, extra: 0, dir: 0 };
  run((dt) => { lever = stepThrottle(st2, lever, 1, dt, true); }, 0.4);
  assert.equal(lever, AB_DETENT);
  stepThrottle(st2, lever, 0, 1 / 60, true);
  run((dt) => { lever = stepThrottle(st2, lever, 1, dt, true); }, 0.5);
  assert.ok(lever > AB_DETENT);
  // hold ~0.4 s releases the latch
  lever = 0.88; const st3 = { t: 0, latched: false, extra: 0, dir: 0 };
  run((dt) => { lever = stepThrottle(st3, lever, 1, dt, true); }, 0.3); assert.equal(lever, AB_DETENT);
  run((dt) => { lever = stepThrottle(st3, lever, 1, dt, true); }, 0.6); assert.ok(lever > AB_DETENT);
});

test('no detent on non-AB aircraft; clamps 0..1', () => {
  const st = { t: 0, latched: false, extra: 0, dir: 0 }; let lever = 0.5;
  run((dt) => { lever = stepThrottle(st, lever, 1, dt, false); }, 2.0);
  assert.equal(lever, 1);
  run((dt) => { lever = stepThrottle(st, lever, -1, dt, false); }, 5.0);
  assert.equal(lever, 0);
  assert.equal(milLever(true), 0.9); assert.equal(milLever(false), 1);
  assert.equal(snapDetent(0.88, true), 0.9); assert.equal(snapDetent(0.88, false), 0.88);
});

test('binding table matches ARCHITECTURE §10', () => {
  const find = (action) => BINDINGS.find((b) => b.action === action);
  const keys = (a) => find(a).keys.join('|');
  assert.equal(keys('Landing gear'), 'G');
  assert.equal(keys('Pitch nose up'), 'S|↓');
  assert.equal(keys('Pitch nose down'), 'W|↑');
  assert.equal(keys('Rudder left'), 'Q'); assert.equal(keys('Rudder right'), 'E');
  assert.equal(keys('Throttle up'), 'R|=|Page Up'); assert.equal(keys('Throttle down'), 'F|-|Page Down');
  const code = (c, id) => assert.ok(CODE_MAP.get(c).some((r) => r.id === id), c + ' -> ' + id);
  code('KeyG', 'gearToggle'); code('BracketLeft', 'flapsUp'); code('BracketRight', 'flapsDown'); code('KeyB', 'speedbrake');
  code('Space', 'brakes'); code('KeyK', 'parkingBrakeToggle'); code('KeyT', 'apToggle'); code('KeyH', 'hookToggle');
  code('KeyL', 'lightsToggle'); code('KeyC', 'cameraNext'); code('KeyC', 'cameraPrev'); code('KeyM', 'mouseYoke');
  code('KeyU', 'hudToggle'); code('KeyP', 'pause'); code('Escape', 'menu'); code('Backspace', 'reset'); code('KeyI', 'engineToggle');
  code('Comma', 'trimDown'); code('Period', 'trimUp'); code('PageUp', 'throttleUp'); code('Equal', 'throttleUp'); code('Minus', 'throttleDown');
  code('Digit1', 'throttleIdle'); code('Digit9', 'throttleMil'); code('Digit0', 'throttleMax');
});

test('no duplicate code per plain/shift variant', () => {
  const seen = new Set();
  for (const r of KEY_TABLE) for (const c of r.codes) { const k = c + (r.shift ? '+S' : ''); assert.ok(!seen.has(k), k); seen.add(k); }
});
