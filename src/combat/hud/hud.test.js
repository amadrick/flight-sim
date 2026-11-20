// node --test src/combat/hud — pure parts of the combat HUD.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createProjector, edgeClamp, outsideEllipse, radarPoint, relBearing, autoRange, launchZone, aspectWord,
  createSubtitleQueue, subtitleDuration, stripTop, timeToImpact, NM } from './math.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ≉ ${b}`);

function camAt(pos, look, fov = 60, w = 1000, h = 500) {
  const cam = new THREE.PerspectiveCamera(fov, w / h, 0.5, 1e6);
  cam.position.copy(pos); cam.lookAt(look); cam.updateMatrixWorld(true);
  const P = createProjector(); P.set(cam, w, h);
  return { cam, P };
}

test('projector matches three.js Vector3.project for points in front', () => {
  const { cam, P } = camAt(new THREE.Vector3(10, 20, 30), new THREE.Vector3(200, 50, -400));
  for (const p of [[200, 50, -400], [150, 80, -300], [260, 10, -500]]) {
    assert.equal(P.point(...p), true);
    const v = new THREE.Vector3(...p).project(cam);
    near(P.x, (v.x + 1) / 2 * 1000, 1e-6); near(P.y, (1 - v.y) / 2 * 500, 1e-6);
  }
});

test('projector: points behind the camera give the turn direction', () => {
  const { P } = camAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));   // looking north (−Z)
  assert.equal(P.point(50, 0, 100), false);            // behind and to the right (east)
  assert.ok(P.dx > 0, 'turn right');
  assert.equal(P.point(-50, 0, 100), false);
  assert.ok(P.dx < 0, 'turn left');
  assert.equal(P.point(0, 30, 100), false);            // behind and above
  assert.ok(P.dy < 0, 'up on screen');
  P.point(0, 0, 100);                                  // dead astern
  near(P.dx, 0); assert.ok(P.dy > 0);
});

test('edge clamp lands on the ellipse in the right direction', () => {
  const o = {};
  edgeClamp(10, 0, 500, 250, 400, 200, o); near(o.x, 900); near(o.y, 250); near(o.a, 0);
  edgeClamp(0, -3, 500, 250, 400, 200, o); near(o.x, 500); near(o.y, 50);
  edgeClamp(1, 1, 500, 250, 400, 200, o);
  near(((o.x - 500) / 400) ** 2 + ((o.y - 250) / 200) ** 2, 1);
  assert.ok(o.x > 500 && o.y > 250);
  assert.equal(outsideEllipse(950, 250, 500, 250, 400, 200), true);
  assert.equal(outsideEllipse(600, 260, 500, 250, 400, 200), false);
});

test('radar transform is heading-up', () => {
  const o = {};
  // heading north: a contact 1 nm north is straight up, 1 nm east is right
  radarPoint(0, -NM, 0, 2 * NM, 100, o); near(o.x, 0); near(o.y, -50); assert.equal(o.clipped, false);
  radarPoint(NM, 0, 0, 2 * NM, 100, o); near(o.x, 50); near(o.y, 0);
  // heading east: a contact to the east is straight up, to the south is right
  radarPoint(NM, 0, Math.PI / 2, 2 * NM, 100, o); near(o.x, 0, 1e-9); near(o.y, -50);
  radarPoint(0, NM, Math.PI / 2, 2 * NM, 100, o); near(o.x, 50); near(o.y, 0, 1e-9);
  // beyond range: clipped to the rim
  radarPoint(0, -10 * NM, 0, 2 * NM, 100, o); assert.equal(o.clipped, true); near(Math.hypot(o.x, o.y), 100);
  near(relBearing(1, 0, 0), Math.PI / 2); near(Math.abs(relBearing(0, 1, 0)), Math.PI, 1e-9);
  near(Math.abs(relBearing(-1, 0, Math.PI / 2)), Math.PI, 1e-9);
});

test('auto range picks a fitting scale with hysteresis', () => {
  assert.equal(autoRange(3 * NM), 5);
  assert.equal(autoRange(6 * NM), 10);
  assert.equal(autoRange(15 * NM), 20);
  assert.equal(autoRange(500 * NM), 80);
  assert.equal(autoRange(9.5 * NM, 10), 20);      // zoom out at once when the contact nears the rim
  assert.equal(autoRange(3.5 * NM, 10), 10);      // stays zoomed out while the contact is near the boundary
  assert.equal(autoRange(2 * NM, 10), 5);         // zooms in once well inside
});

test('launch zone scale', () => {
  const z = launchZone({ range: 5000, rMin: 400, rMax: 9000 });
  near(z.top, 11250); near(z.min, 400 / 11250); near(z.max, 0.8); near(z.cur, 5000 / 11250);
  assert.equal(z.inRange, true); assert.equal(z.ne, -1); assert.equal(z.inNe, false);
  const n = launchZone({ range: 3000, rMin: 400, rMax: 9000, rNe: 4000 });
  near(n.ne, 4000 / 11250); assert.equal(n.inNe, true);
  const far = launchZone({ range: 30000, rMin: 400, rMax: 9000 });
  assert.equal(far.cur, 1); assert.equal(far.inRange, false);
  const empty = launchZone(null); assert.equal(empty.inRange, false);
});

test('aspect brevity and time to impact', () => {
  assert.equal(aspectWord(Math.PI), 'HOT'); assert.equal(aspectWord(0), 'COLD'); assert.equal(aspectWord(Math.PI / 2), 'BEAM');
  near(timeToImpact(1000, 500), 2); assert.equal(timeToImpact(1000, -5), Infinity);
});

test('subtitle queue: two lines, urgent first, fade and expiry', () => {
  const q = createSubtitleQueue({ max: 2, fade: 0.4 });
  q.push({ from: 'AWACS', text: 'Bandits inbound, cleared hot.' });
  q.push({ from: 'Viper 2', text: 'Two, visual.' });
  q.push({ from: 'Viper 2', text: 'Tally two.' });
  q.update(0.016);
  assert.equal(q.visible.length, 2); assert.equal(q.waiting.length, 1);
  assert.equal(q.visible[0].from, 'AWACS');
  q.push({ from: 'Viper 2', text: 'Missile launch, break right!', priority: 2 });
  assert.equal(q.waiting[0].priority, 2, 'urgent jumps the queue');
  // urgent line hurries the showing ones: within ~1 s the urgent line is up
  for (let i = 0; i < 70; i++) q.update(0.016);
  assert.ok(q.visible.some((v) => v.priority === 2));
  for (let i = 0; i < 2000; i++) q.update(0.016);
  assert.equal(q.visible.length, 0); assert.equal(q.waiting.length, 0);
  assert.equal(q.push({ from: 'x', text: '' }), null, 'empty lines are ignored');
  assert.ok(subtitleDuration('short') >= 2.6 && subtitleDuration('x'.repeat(400)) <= 7.5);
});

test('subtitle queue caps the backlog', () => {
  const q = createSubtitleQueue({ max: 2, cap: 4 });
  for (let i = 0; i < 12; i++) q.push({ from: 'A', text: 'line ' + i });
  assert.ok(q.waiting.length <= 4);
});

test('strip estimate sits in the lower part of the screen', () => {
  const a = stripTop(1920, 1080), b = stripTop(400, 800);
  assert.ok(a > 900 && a < 1060, String(a));
  assert.ok(b > 550 && b < 760, String(b));      // phones wrap the strip into more rows
});

test('seat mode: phones and touch screens are narrow', async () => {
  const { seatMode } = await import('./seats.js');
  assert.equal(seatMode(1920, 1080, false), 'wide');
  assert.equal(seatMode(400, 800, false), 'narrow');
  assert.equal(seatMode(1366, 1024, true), 'narrow');
  assert.equal(seatMode(900, 480, false), 'narrow');
});

test('the whole hud module imports in node without touching the DOM', async () => {
  const m = await import('./index.js');
  assert.equal(typeof m.createCombatHud, 'function');
});
