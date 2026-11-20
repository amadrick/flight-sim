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

import { touchRaw, touchShape, autoCoordYaw, throttleDetent, TOUCH_STICK } from './logic.js';
import { createPrefs, sanitizePrefs, PREF_DEFAULTS, PREFS_KEY } from './prefs.js';

test('touch stick: raw deflection scales with sensitivity and stays in the unit circle', () => {
  const o = { x: 0, y: 0 };
  touchRaw(30, 0, 60, 1, o); assert.equal(o.x, 0.5);
  touchRaw(30, 0, 60, 2, o); assert.equal(o.x, 1);
  touchRaw(100, 100, 60, 1, o); assert.ok(Math.abs(Math.hypot(o.x, o.y) - 1) < 1e-9);
});
test('touch stick: dead zone, expo, full throw', () => {
  const s = { x: 0, y: 0 };
  touchShape({ x: TOUCH_STICK.dead * 0.9, y: 0 }, s); assert.equal(s.x, 0);
  touchShape({ x: 0.5, y: 0 }, s); assert.ok(s.x > 0.25 && s.x < 0.5, 'expo softens the centre: ' + s.x);
  touchShape({ x: 1, y: 0 }, s); assert.ok(Math.abs(s.x - 1) < 1e-9);
  assert.ok(Math.abs(autoCoordYaw(1) - TOUCH_STICK.coord) < 1e-9);
  assert.equal(autoCoordYaw(0), 0);
});
test('throttle detents: idle, MIL, afterburner, full', () => {
  assert.deepEqual(throttleDetent(0.2, 0.01, true), { v: 0, hit: 'idle' });
  assert.equal(throttleDetent(0.8, AB_DETENT + 0.01, true).v, AB_DETENT);
  assert.equal(throttleDetent(0.8, AB_DETENT + 0.01, true).hit, 'mil');
  assert.equal(throttleDetent(AB_DETENT, 0.97, true).hit, 'ab');
  assert.equal(throttleDetent(0.97, 0.995, false).hit, 'full');
  assert.equal(throttleDetent(0.5, 0.52, true).hit, null);
});
test('touch prefs: defaults, sanitising, persistence', () => {
  const mem = new Map(); const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const p = createPrefs(st);
  assert.deepEqual(p.get(), PREF_DEFAULTS);
  let seen = null; p.on((v) => { seen = v; });
  p.set({ sensitivity: 5, lefty: true, drawer: 'nope' });
  assert.equal(p.get().sensitivity, 2); assert.equal(p.get().lefty, true); assert.equal(p.get().drawer, 'auto');
  assert.equal(seen.lefty, true);
  assert.equal(JSON.parse(mem.get(PREFS_KEY)).lefty, true);
  assert.equal(createPrefs(st).get().lefty, true);
  assert.deepEqual(sanitizePrefs('x'), PREF_DEFAULTS);
  assert.equal(createPrefs(null).set({ haptics: false }).haptics, false);   // no storage: still works
});
