// node --test src/ui/hud/hud.test.js — conformity of the HUD projection and the navigation maths.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createProjector, bodyToWorld, dirFromElAz } from './projection.js';
import { findIls, ilsFor, runwayEnds, bearingTo, nearestAirport, predictGroundCollision, GS_ANGLE } from './nav.js';
import { AIRPORTS, runwayEnd } from '../../data/airports.js';
import { F } from './common.js';

const DEG = Math.PI / 180;
function cockpitCamera(hdg, pitch, roll, W = 960, H = 540, fov = 60) {
  const cam = new THREE.PerspectiveCamera(fov, W / H, 0.5, 600000);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * DEG, -hdg * DEG, -roll * DEG, 'YXZ'));
  cam.quaternion.copy(q); cam.position.set(10, 2000, -30);
  cam.updateMatrixWorld(true);
  return { cam, q };
}

test('projection matches three.js Vector3.project for arbitrary directions', () => {
  const { cam } = cockpitCamera(37, 8, -25);
  const P = createProjector(); P.set(cam, 960, 540);
  const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  for (const [el, az] of [[0, 37], [5, 40], [-10, 20], [8, 37], [2, 60]]) {
    const d = dirFromElAz(el * DEG, az * DEG, {});
    assert.ok(P.dir(d.x, d.y, d.z));
    const v = new THREE.Vector3(d.x, d.y, d.z).multiplyScalar(1e5).add(camPos).project(cam);
    assert.ok(Math.abs(P.x - (v.x + 1) / 2 * 960) < 0.05, 'x');
    assert.ok(Math.abs(P.y - (1 - v.y) / 2 * 540) < 0.05, 'y');
  }
});

test('wings-level, pitch 0: horizon passes through the screen centre, horizontal', () => {
  const { cam } = cockpitCamera(90, 0, 0);
  const P = createProjector(); P.set(cam, 960, 540);
  P.dir(...Object.values(dirFromElAz(0, 90 * DEG, {})));
  assert.ok(Math.abs(P.x - 480) < 1e-6 && Math.abs(P.y - 270) < 1e-6);
  P.dir(...Object.values(dirFromElAz(0, 100 * DEG, {})));
  assert.ok(Math.abs(P.y - 270) < 1e-6);
});

test('pitch 10° up: horizon sits 10° (f·tan10°) below the screen centre', () => {
  const { cam } = cockpitCamera(0, 10, 0);
  const P = createProjector(); P.set(cam, 960, 540);
  const f = 270 / Math.tan(30 * DEG);
  P.dir(...Object.values(dirFromElAz(0, 0, {})));
  assert.ok(Math.abs(P.y - (270 + f * Math.tan(10 * DEG))) < 1e-6, `horizon y ${P.y}`);
  // the 5° rung is f·tan5° above the horizon only approximately (gnomonic); exact: elevation 5 at az 0 -> tan(5° below boresight)
  P.dir(...Object.values(dirFromElAz(5 * DEG, 0, {})));
  assert.ok(Math.abs(P.y - (270 + f * Math.tan(5 * DEG))) < 1e-6);
});

test('bank 30° right: horizon line slopes up to the right by 30° on screen', () => {
  const { cam } = cockpitCamera(0, 0, 30);
  const P = createProjector(); P.set(cam, 960, 540);
  P.dir(...Object.values(dirFromElAz(0, -5 * DEG, {}))); const x1 = P.x, y1 = P.y;
  P.dir(...Object.values(dirFromElAz(0, 5 * DEG, {}))); const x2 = P.x, y2 = P.y;
  const slope = Math.atan2(-(y2 - y1), x2 - x1) / DEG;    // + = rising to the right
  assert.ok(Math.abs(slope - 30) < 0.01, `slope ${slope}`);
});

test('flight-path marker: velocity 4° below the nose, 3° right lands at the right pixel', () => {
  const { cam, q } = cockpitCamera(120, 6, 0);
  const P = createProjector(); P.set(cam, 960, 540);
  const v = dirFromElAz(2 * DEG, 123 * DEG, {});   // 4° below the 6° pitch, 3° right of heading
  P.dir(v.x, v.y, v.z);
  const f = 270 / Math.tan(30 * DEG);
  // body-frame direction of the velocity
  const vb = new THREE.Vector3(v.x, v.y, v.z).applyQuaternion(q.clone().invert());
  assert.ok(Math.abs(P.x - (480 + f * vb.x / -vb.z)) < 1e-6);
  assert.ok(Math.abs(P.y - (270 - f * vb.y / -vb.z)) < 1e-6);
  assert.ok(P.x > 480 && P.y > 270);
});

test('bodyToWorld matches THREE quaternion rotation', () => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -1.1, 0.4, 'YXZ'));
  const o = bodyToWorld(q, 0.2, -0.5, -1, {});
  const r = new THREE.Vector3(0.2, -0.5, -1).applyQuaternion(q);
  assert.ok(Math.abs(o.x - r.x) < 1e-12 && Math.abs(o.y - r.y) < 1e-12 && Math.abs(o.z - r.z) < 1e-12);
});

test('ILS: on the 3° glidepath and centreline gives ~zero deviations', () => {
  const ap = AIRPORTS[0], rw = ap.runways[0];
  const E = runwayEnd(rw, 0);
  const dist = 9000;
  const gsx = E.threshold.x + E.dir.x * 300, gsz = E.threshold.z + E.dir.z * 300;
  const x = gsx - E.dir.x * dist, z = gsz - E.dir.z * dist;
  const y = ap.elevation + Math.tan(GS_ANGLE * DEG) * dist;
  const r = findIls(x, y, z, E.heading, ap.id);
  assert.ok(r.active);
  assert.equal(r.rwy.name, E.name);
  assert.ok(Math.abs(r.locDev) < 1e-6, 'loc ' + r.locDev);
  assert.ok(Math.abs(r.gsDev) < 1e-6, 'gs ' + r.gsDev);
});

test('ILS: right of centreline / above glidepath have positive deviations', () => {
  const ap = AIRPORTS[0], E = runwayEnds().find(e => e.airport === ap && e.end === 0 && e.runway === ap.runways[0]);
  const right = { x: -E.dir.z, z: E.dir.x };
  const x = E.threshold.x - E.dir.x * 8000 + right.x * 200, z = E.threshold.z - E.dir.z * 8000 + right.z * 200;
  const r = ilsFor(E, x, ap.elevation + 600, z);
  assert.ok(r.locDev > 0.5 && r.locDev < 2, 'loc ' + r.locDev);
  assert.ok(r.gsDev > 0.5, 'gs ' + r.gsDev);
});

test('ILS: not active when pointing away from the runway or far away', () => {
  const ap = AIRPORTS[0], E = runwayEnd(ap.runways[0], 0);
  const x = E.threshold.x - E.dir.x * 8000, z = E.threshold.z - E.dir.z * 8000;
  assert.equal(findIls(x, 500, z, (E.heading + 180) % 360, null).active, false);
  assert.equal(findIls(x - 300000, 500, z, E.heading, null).active, false);
});

test('bearing / nearest airport', () => {
  assert.equal(bearingTo(0, 0, 0, -10), 0);
  assert.equal(bearingTo(0, 0, 10, 0), 90);
  assert.equal(bearingTo(0, 0, 0, 10), 180);
  assert.equal(nearestAirport(0, 0, 'KHVN').id, 'KPNC');
});

test('ground collision: steep dive at low altitude warns, level cruise does not', () => {
  const s = { position: new THREE.Vector3(0, 600, 0), velocity: new THREE.Vector3(0, -120, -200), surfaces: { gear: 0 }, agl: 600, onGround: false };
  assert.equal(predictGroundCollision(s, () => 0, 5).pullUp, true);
  s.velocity.set(0, 0, -200);
  assert.equal(predictGroundCollision(s, () => 0, 5).pullUp, false);
  // rising terrain straight ahead
  s.position.set(0, 600, 0);
  assert.equal(predictGroundCollision(s, (x, z) => (z < -400 ? 900 : 0), 5).pullUp, true);
  // stabilised approach: gear down, 3° path, ~700 fpm
  const a = { position: new THREE.Vector3(0, 150, 0), velocity: new THREE.Vector3(0, -3.6, -70), surfaces: { gear: 1 }, agl: 150, onGround: false };
  const r = predictGroundCollision(a, () => 0, 1.6);
  assert.equal(r.pullUp, false); assert.equal(r.sinkRate, false);
});

test('string caches return identical strings and correct formats', () => {
  assert.equal(F.comma(12450), '12,450');
  assert.equal(F.tenth(97), '9.7');
  assert.equal(F.mach(85), '.85'); assert.equal(F.mach(120), '1.20');
  assert.equal(F.deg3(0), '360'); assert.equal(F.deg3(5), '005'); assert.equal(F.deg3(365), '005');
  assert.equal(F.mmss(125), '2:05'); assert.equal(F.mmss(3725), '1:02:05');
  assert.equal(F.signed(-1200), '−1,200');
  assert.strictEqual(F.int(42), F.int(42));
});
