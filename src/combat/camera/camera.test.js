// node --test src/combat/camera/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  DEG, newLos, stepLos, dirFromAzEl, padlockUp, padlockFrame, angleFromAxis, fovToContain,
  newNeck, neckTarget, stepNeck, NECK, slerpDir, blendOffset, shouldCut, gunThreat, safeToCutAway, victoryAzimuth, springStep, wrapPi,
} from './math.js';
import { createModeState, currentMode, setBase, pushOverlay, endOverlay, clearOverlays } from './modes.js';
import { keyAction, COMBAT_BINDINGS } from '../input/map.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b}`);

/** Project a world point into NDC for a camera at pos/quat with the given vfov / aspect. */
function ndc(pos, quat, fov, aspect, p) {
  const c = new THREE.PerspectiveCamera(fov, aspect, 0.5, 1e6);
  c.position.copy(pos); c.quaternion.copy(quat); c.updateMatrixWorld(); c.updateProjectionMatrix();
  const v = p.clone().applyMatrix4(c.matrixWorldInverse);
  const inFront = v.z < 0;
  v.applyMatrix4(c.projectionMatrix);
  return { x: v.x, y: v.y, inFront };
}

/** Run the full padlock-chase solution to convergence for player at the origin flying north, target at T. */
function solvePadlock(T, roll = 0) {
  const P = V(0, 3000, 0), los = newLos();
  const bodyUp = V(Math.sin(roll), Math.cos(roll), 0);
  const dir = T.clone().sub(P).normalize();
  for (let i = 0; i < 600; i++) stepLos(los, dir, 1 / 60);
  const F = dirFromAzEl(los.az, los.el, V());
  const up = padlockUp(V(), bodyUp, roll);
  const out = { pos: V(), quat: new THREE.Quaternion() };
  let fov = 60;
  padlockFrame(out, P, F, up, 26, fov);
  fov = Math.max(fov, Math.min(fovToContain(angleFromAxis(out.quat, out.pos, T), 16 / 9), 88));
  padlockFrame(out, P, F, up, 26, fov);
  return { P, out, fov };
}

for (const [name, T] of [
  ['ahead', V(0, 3000, -2000)], ['high off the right wing', V(1500, 4200, -200)], ['behind', V(200, 3000, 2500)],
  ['directly overhead', V(0, 5000, 0)], ['below and behind', V(-300, 1800, 1500)],
]) {
  test(`padlock frames player and target: ${name}`, () => {
    const { P, out, fov } = solvePadlock(T);
    assert.ok(Number.isFinite(out.pos.x + out.pos.y + out.pos.z + out.quat.w));
    const pp = ndc(out.pos, out.quat, fov, 16 / 9, P), tp = ndc(out.pos, out.quat, fov, 16 / 9, T);
    assert.ok(pp.inFront && tp.inFront, 'both in front');
    assert.ok(Math.abs(pp.x) < 0.95 && Math.abs(pp.y) < 0.95, `player on screen ${pp.x} ${pp.y}`);
    assert.ok(Math.abs(tp.x) < 0.97 && Math.abs(tp.y) < 0.97, `target on screen ${tp.x} ${tp.y}`);
    assert.ok(pp.y < -0.15, `player in the lower part ${pp.y}`);
    assert.ok(out.pos.distanceTo(P) > 20, 'camera outside the airframe');
    // horizon readable: camera right vector stays level when wings are level
    const right = V(1, 0, 0).applyQuaternion(out.quat);
    assert.ok(Math.abs(right.y) < 0.05, `roll ${right.y}`);
  });
}

test('padlock up leans toward the aircraft at high bank, world-up when level or inverted', () => {
  near(padlockUp(V(), V(0, 1, 0), 0).y, 1, 1e-9);
  const b = padlockUp(V(), V(1, 0, 0), 90 * DEG);
  assert.ok(b.x > 0.3 && b.y > 0.6, `${b.x} ${b.y}`);
  const inv = padlockUp(V(), V(0, -1, 0), 180 * DEG);
  near(inv.y, 1, 1e-9);
});

test('LOS tracker: target passing overhead never flips (elevation capped, azimuth held, rates capped)', () => {
  const los = newLos();
  const dt = 1 / 60; let prevAz = 0, prevEl = 0, maxStep = 0;
  for (let i = 0; i <= 360; i++) {
    const a = (i / 360) * Math.PI;                  // from ahead, over the top, to behind
    const d = V(0, Math.sin(a), -Math.cos(a));
    stepLos(los, d, dt);
    if (i > 0) maxStep = Math.max(maxStep, Math.abs(wrapPi(los.az - prevAz)), Math.abs(los.el - prevEl));
    prevAz = los.az; prevEl = los.el;
    assert.ok(Math.abs(los.el) <= 76 * DEG + 1e-9);
  }
  assert.ok(maxStep <= 2.6 * dt + 1e-9, `step ${maxStep}`);
});

test('LOS tracker hysteresis: target jittering across dead astern keeps swinging one way', () => {
  const los = newLos();
  stepLos(los, V(0, 0, -1), 1 / 60);                // looking north
  // target jumps to just right of dead astern; the swing starts to the right (az increasing)
  for (let i = 0; i < 20; i++) stepLos(los, dirFromAzEl(Math.PI - 5 * DEG, 0, V()), 1 / 60);
  const dirStart = Math.sign(los.az);
  // now it wobbles to just left of astern: the camera must not reverse
  let prev = los.az, reversed = false;
  for (let i = 0; i < 40; i++) {
    stepLos(los, dirFromAzEl(-Math.PI + 5 * DEG, 0, V()), 1 / 60);
    const d = wrapPi(los.az - prev); if (Math.sign(d) === -dirStart && Math.abs(d) > 1e-6) reversed = true; prev = los.az;
  }
  assert.equal(reversed, false);
});

test('LOS damping is frame-rate independent', () => {
  const a = newLos(), b = newLos(); const d0 = V(0, 0, -1), d1 = dirFromAzEl(60 * DEG, 10 * DEG, V());
  stepLos(a, d0, 0.01); stepLos(b, d0, 0.01);
  for (let i = 0; i < 30; i++) stepLos(a, d1, 1 / 30);
  for (let i = 0; i < 120; i++) stepLos(b, d1, 1 / 120);
  near(a.az, b.az, 0.03); near(a.el, b.el, 0.03);
});

test('neck limits, forward quadrant and shoulder hysteresis', () => {
  const s = newNeck(), o = { yaw: 0, pitch: 0 };
  neckTarget(s, V(0, 0.1, -1), o); assert.equal(o.yaw, 0); assert.equal(o.pitch, 0);       // ahead: through the HUD
  neckTarget(s, V(1, 0, 0), o); near(o.yaw, 90 * DEG, 1e-6);                               // right wing
  neckTarget(s, V(0.2, 0, 1), o); near(o.yaw, NECK.yawMax, 1e-6);                            // behind right: limit
  neckTarget(s, V(-0.1, 0, 1), o); near(o.yaw, NECK.yawMax, 1e-6);                          // just past astern: stays right
  neckTarget(s, V(-1, 0, 0.3), o); assert.ok(o.yaw < 0);                                    // well left: switches shoulder
  neckTarget(s, V(0, 1, 0.001), o); near(o.pitch, NECK.pitchUp, 1e-6);                      // overhead: +80°
  neckTarget(s, V(0.5, -1, 0.2), o); near(o.pitch, -NECK.pitchDown, 1e-6);                   // below: −30°
  // eases back to forward only once well inside the forward cone (hysteresis)
  neckTarget(s, V(0, 0, -1).applyAxisAngle(V(0, 1, 0), -22 * DEG), o); assert.ok(o.yaw !== 0);
  neckTarget(s, V(0, 0, -1).applyAxisAngle(V(0, 1, 0), -12 * DEG), o); assert.equal(o.yaw, 0);
  neckTarget(s, V(0, 0, -1).applyAxisAngle(V(0, 1, 0), -22 * DEG), o); assert.equal(o.yaw, 0);
});

test('neck motion is rate limited and converges', () => {
  const s = newNeck();
  stepNeck(s, 2.5, 0, 1 / 60); assert.ok(s.yaw <= NECK.maxRate / 60 + 1e-9);
  for (let i = 0; i < 240; i++) stepNeck(s, 2.5, 0.5, 1 / 60);
  near(s.yaw, 2.5, 1e-3); near(s.pitch, 0.5, 1e-3);
});

test('offset blend goes round the jet, never through it', () => {
  const a = V(0, 3, 25), b = V(0, 3, -25), hint = V(1, 0, 0), out = V();
  for (let t = 0; t <= 1.0001; t += 0.05) { blendOffset(out, a, b, t, 20, hint); assert.ok(out.length() >= 20 - 1e-6, `${t}: ${out.length()}`); }
  slerpDir(out, V(0, 0, 1), V(0, 0, -1), 0.5, hint); assert.ok(Math.abs(out.x) > 0.99, 'antipodal swing goes sideways');
});

test('cuts: interior/exterior changes and long distances', () => {
  assert.equal(shouldCut(true, false, 1), true);
  assert.equal(shouldCut(false, false, 50), false);
  assert.equal(shouldCut(false, false, 1200), true);
  assert.equal(shouldCut(false, false, NaN), true);
});

test('safe to cut away', () => {
  const ok = { alive: true, onGround: false, agl: 3000, vs: 0, missileThreats: 0, gunThreat: false, hpFrac: 1, recentHit: 30 };
  assert.equal(safeToCutAway(ok), true);
  assert.equal(safeToCutAway({ ...ok, missileThreats: 1 }), false);
  assert.equal(safeToCutAway({ ...ok, gunThreat: true }), false);
  assert.equal(safeToCutAway({ ...ok, agl: 300 }), false);
  assert.equal(safeToCutAway({ ...ok, agl: 900, vs: -120 }), false);    // diving at the ground
  assert.equal(safeToCutAway({ ...ok, recentHit: 0.5 }), false);
  assert.equal(safeToCutAway({ ...ok, alive: false }), false);
  assert.equal(safeToCutAway(null), false);
});

test('gun threat: enemy behind, or nose-on and close', () => {
  const st = (p, q = new THREE.Quaternion()) => ({ state: { position: p, quaternion: q } });
  const me = st(V(0, 3000, 0));                            // flying north (-Z)
  assert.equal(gunThreat(me, [st(V(0, 3000, 600))]), true);                       // 600 m behind
  assert.equal(gunThreat(me, [st(V(0, 3000, 3000))]), false);                     // too far
  assert.equal(gunThreat(me, [st(V(0, 3000, -800))]), false);                     // ahead, flying away
  const facing = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI);    // pointing south, at me
  assert.equal(gunThreat(me, [st(V(0, 3000, -800), facing)]), true);              // head-on inside 1200 m
});

test('victory framing puts the wreck behind the jet', () => {
  const P = V(0, 2000, 0), W = V(0, 1500, -2000);
  const az = victoryAzimuth(V(0, 0, -1), P, W, 1);
  const camDir = dirFromAzEl(az, 0, V());
  assert.ok(camDir.z > 0.9, 'camera on the far side from the wreck');
  const az2 = victoryAzimuth(V(0, 0, -1), P, null, 1);
  near(az2, 38 * DEG, 1e-9);
});

test('feel spring is stable for long frames and settles', () => {
  const s = { x: 0, v: 1 };
  springStep(s, 0.1); springStep(s, 0.1);
  for (let i = 0; i < 60; i++) springStep(s, 1 / 60);
  assert.ok(Math.abs(s.x) < 1e-3 && Number.isFinite(s.x));
});

test('mode bookkeeping: overlays return to the previous view', () => {
  const s = createModeState();
  setBase(s, 'padlock'); assert.equal(currentMode(s), 'padlock');
  assert.ok(pushOverlay(s, 'missile')); assert.equal(currentMode(s), 'missile');
  assert.ok(pushOverlay(s, 'kill')); assert.equal(currentMode(s), 'kill');
  endOverlay(s, 'kill'); assert.equal(currentMode(s), 'padlock');
  assert.ok(pushOverlay(s, 'victory')); assert.equal(pushOverlay(s, 'kill'), false);
  clearOverlays(s); assert.equal(currentMode(s), 'padlock');
  pushOverlay(s, 'kill'); pushOverlay(s, 'victory', { queue: true });
  endOverlay(s, 'kill'); assert.equal(currentMode(s), 'victory');
  endOverlay(s, 'missile'); assert.equal(currentMode(s), 'victory');            // ending something else is a no-op
  endOverlay(s, 'victory'); assert.equal(currentMode(s), 'padlock');
  setBase(s, null); assert.equal(currentMode(s), null);
});

test('camera keys: O padlock, ; missile camera, with help rows; free in the simulator map', async () => {
  assert.equal(keyAction({ code: 'KeyO' }), 'padlock');
  assert.equal(keyAction({ code: 'Semicolon' }), 'missileCam');
  assert.equal(keyAction({ code: 'KeyO', ctrlKey: true }), null);
  const ids = COMBAT_BINDINGS.map(b => b.id);
  assert.ok(ids.includes('padlock') && ids.includes('missileCam'));
  const { CODE_MAP } = await import('../../input/bindings.js');
  assert.equal(CODE_MAP.has('KeyO'), false); assert.equal(CODE_MAP.has('Semicolon'), false);
});

test('module imports in node without DOM (headless tools import the tree)', async () => {
  const m = await import('./index.js');
  assert.equal(typeof m.createCombatCamera, 'function');
});
