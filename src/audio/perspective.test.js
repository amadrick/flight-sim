import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { listenerGeometry, distGain, distCutoff } from './perspective.js';
import { set, tanhCurve, pulseCurve } from './dsp.js';

const Q0 = new THREE.Quaternion();
const V = (x, y, z) => new THREE.Vector3(x, y, z);

test('Doppler: approaching source is shifted up, receding down', () => {
  const o = {};
  // aircraft at x=-500 flying +x at 200 m/s toward a static listener at origin
  listenerGeometry(V(-500, 0, 0), V(200, 0, 0), Q0, V(0, 0, 0), V(), Q0, o);
  assert.ok(o.dop > 1.2, `approach dop ${o.dop}`);
  listenerGeometry(V(500, 0, 0), V(200, 0, 0), Q0, V(0, 0, 0), V(), Q0, o);
  assert.ok(o.dop < 0.8, `recede dop ${o.dop}`);
});
test('Doppler: no shift for co-moving camera (chase)', () => {
  const o = {};
  listenerGeometry(V(0, 0, 0), V(200, 0, 0), Q0, V(0, 5, 80), V(200, 0, 0), Q0, o);
  assert.ok(Math.abs(o.dop - 1) < 0.02, `dop ${o.dop}`);
});
test('directivity: front is +1 when the camera is ahead of the nose', () => {
  const o = {};
  // identity quaternion: nose points -Z
  listenerGeometry(V(0, 0, 0), V(), Q0, V(0, 0, -100), V(), Q0, o); assert.ok(o.front > 0.99);
  listenerGeometry(V(0, 0, 0), V(), Q0, V(0, 0, 100), V(), Q0, o); assert.ok(o.front < -0.99);
});
test('pan follows the source side in camera space', () => {
  const o = {};
  listenerGeometry(V(100, 0, -100), V(), Q0, V(0, 0, 0), V(), Q0, o); assert.ok(o.pan > 0.3);
  listenerGeometry(V(-100, 0, -100), V(), Q0, V(0, 0, 0), V(), Q0, o); assert.ok(o.pan < -0.3);
});
test('distance rolloff is monotonic and bounded', () => {
  let prev = Infinity; for (const d of [0, 10, 100, 1000, 10000]) { const g = distGain(d); assert.ok(g <= prev && g > 0 && g <= 1); prev = g; }
  assert.ok(distCutoff(20000) >= 450 && distCutoff(0) <= 15000);
});
test('curves are bounded; set() ignores NaN', () => {
  assert.ok(tanhCurve(256).every((v) => Math.abs(v) <= 1.0000001));
  assert.ok(pulseCurve(0.3).every((v) => v >= 0 && v <= 1));
  const calls = []; const p = { setTargetAtTime: (...a) => calls.push(a), _ac: { currentTime: 1 } };
  set(p, NaN); set(p, Infinity); set(p, 0.5); assert.equal(calls.length, 1);
});
