// Player flight assist: API, stay-out rules, point-to-fly response, release hold, gun help, protections, auto-throttle.
// Real flight model on the headless bench (no DOM); the player's aircraft is a human-flown entity (pilot null), so
// combat.pre() runs the assist before its physics step, exactly as in the game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSandbox } from '../ai/tools/sandbox.mjs';
import { spawnPlayer } from './tools/thumb.mjs';
import { shapeRate, rotateToward, ASSIST_DIFFICULTY } from './index.js';

const DEG = Math.PI / 180;
const fwd = new THREE.Vector3();
const heading = (e) => { fwd.set(0, 0, -1).applyQuaternion(e.state.quaternion); return Math.atan2(fwd.x, -fwd.z); };
const wrap = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;

async function setup({ difficulty = 'veteran', aircraft = 'f16', alt = 3000, speed = 190, heading: h = 0, loadout } = {}) {
  const b = await createSandbox({ seed: 3, difficulty });
  b.combat.difficulty = difficulty;
  b.combat.assist.reset();
  const e = spawnPlayer(b, { aircraft, position: new THREE.Vector3(0, alt, 0), heading: h, speed, loadout });
  e.controls.throttle = 0.9;
  return { b, c: b.combat, e };
}
/** Run with the stick held at (roll, pitch) — written each frame like the input layer does. */
function fly(b, e, seconds, roll = 0, pitch = 0, each) {
  b.run(seconds, (t) => { e.controls.roll = roll; e.controls.pitch = pitch; e.controls.yaw = 0; each?.(t); });
}

test('API: names, difficulty defaults, overrides', async () => {
  const { c } = await setup({ difficulty: 'rookie' });
  const a = c.assist;
  for (const k of ['mode', 'setMode', 'aim', 'aimAssist', 'setAimAssist', 'info', 'reset', 'update']) assert.ok(k in a, k);
  assert.equal(a.mode, 'assist');
  assert.equal(a.aimAssist, ASSIST_DIFFICULTY.rookie.aim);
  for (const k of ['mode', 'active', 'gunAssist', 'limiting']) assert.ok(k in a.info, k);
  c.difficulty = 'ace'; a.reset();
  assert.equal(a.mode, 'off');
  assert.equal(a.aimAssist, 0);
  a.setMode('assist'); a.setAimAssist(0.3);
  c.difficulty = 'veteran'; a.reset();
  assert.equal(a.mode, 'assist'); assert.equal(a.aimAssist, 0.3);           // the player's choice survives
  a.setAimAssist(7); assert.equal(a.aimAssist, 1);
  a.setMode(null); a.setAimAssist(null);
  assert.equal(a.mode, 'assist'); assert.equal(a.aimAssist, ASSIST_DIFFICULTY.veteran.aim);
  a.setMode('off'); assert.equal(a.info.mode, 'off');
});

test('shapeRate / rotateToward', () => {
  assert.equal(shapeRate(0), 0); assert.equal(shapeRate(1), 1);
  assert.ok(shapeRate(0.2) < 0.15, 'small deflection = fine aiming');
  for (let m = 0; m < 1; m += 0.1) assert.ok(shapeRate(m + 0.1) > shapeRate(m));
  const a = new THREE.Vector3(0, 0, -1), b = new THREE.Vector3(1, 0, 0);
  const left = rotateToward(a, b, 0.5);
  assert.ok(Math.abs(Math.acos(a.dot(new THREE.Vector3(0, 0, -1))) - 0.5) < 1e-6);
  assert.ok(Math.abs(left - (Math.PI / 2 - 0.5)) < 1e-6);
  assert.equal(rotateToward(a, b, 3), 0);
  assert.ok(a.distanceTo(b) < 1e-9);
});

test('mode off and autopilot: the controls are left alone', async () => {
  const { b, c, e } = await setup();
  c.assist.setMode('off');
  fly(b, e, 0.5, 0.4, 0.2);
  b.run(1 / 60, () => {});
  e.controls.roll = 0.4; e.controls.pitch = 0.2; c.assist.update(1 / 60);
  assert.equal(e.controls.roll, 0.4); assert.equal(e.controls.pitch, 0.2);
  assert.equal(c.assist.info.active, false);
  c.assist.setMode('assist');
  e.state.ap = { engaged: true };
  e.controls.roll = 0.4; e.controls.pitch = 0.2; c.assist.update(1 / 60);
  assert.equal(e.controls.roll, 0.4); assert.equal(e.controls.pitch, 0.2);
  assert.equal(c.assist.info.active, false);
  e.state.ap = { engaged: false };
  c.assist.update(1 / 60);
  assert.equal(c.assist.info.active, true);
});

test('gear down low (landing / takeoff): stays out', async () => {
  const { c, e } = await setup({ alt: 40 });
  e.state.surfaces = { ...(e.state.surfaces || {}), gear: 1 };
  e.controls.roll = 0.3; e.controls.pitch = 0.1; c.assist.update(1 / 60);
  assert.equal(c.assist.info.active, false);
  assert.equal(e.controls.roll, 0.3);
});

test('stick right = the nose goes right in a level turn; release holds the path', async () => {
  const { b, e } = await setup();
  fly(b, e, 2);
  const h0 = heading(e), y0 = e.state.position.y;
  fly(b, e, 3, 1, 0);
  const turned = wrap(heading(e) - h0) / DEG;
  assert.ok(turned > 35, `turned ${turned.toFixed(1)}°`);
  assert.ok(Math.abs(e.state.position.y - y0) < 250, `altitude change ${(e.state.position.y - y0).toFixed(0)} m`);
  // release: after the roll-out the path holds (heading and climb angle steady, wings near level)
  fly(b, e, 3);
  const h1 = heading(e), g1 = e.state.velocity.y / e.state.velocity.length();
  fly(b, e, 4);
  const drift = Math.abs(wrap(heading(e) - h1)) / DEG / 4;
  const dGam = Math.abs(Math.asin(e.state.velocity.y / e.state.velocity.length()) - Math.asin(g1)) / DEG;
  assert.ok(drift < 0.6, `heading drift ${drift.toFixed(2)}°/s`);
  assert.ok(dGam < 3, `climb angle change ${dGam.toFixed(1)}°`);
  assert.ok(Math.abs(e.state.roll) < 12 * DEG, `bank ${(e.state.roll / DEG).toFixed(0)}°`);
});

test('stick back = nose up; a released dive is kept, not fought', async () => {
  const { b, e } = await setup({ alt: 5000 });
  fly(b, e, 1.5);
  fly(b, e, 1.2, 0, 1);
  assert.ok(e.state.velocity.y > 15, `climbing ${e.state.velocity.y.toFixed(0)} m/s`);
  fly(b, e, 6, 0, -1);                                         // pushes (no roll inverted) into a dive
  assert.ok(Math.abs(e.state.roll) < 30 * DEG, `pushed, not rolled: bank ${(e.state.roll / DEG).toFixed(0)}°`);
  fly(b, e, 2);
  const g0 = Math.asin(e.state.velocity.y / e.state.velocity.length());
  assert.ok(g0 < -8 * DEG, `diving ${(g0 / DEG).toFixed(1)}°`);
  fly(b, e, 2);
  const g1 = Math.asin(e.state.velocity.y / e.state.velocity.length());
  assert.ok(Math.abs(g1 - g0) < 4 * DEG, `dive kept: ${(g0 / DEG).toFixed(1)}° → ${(g1 / DEG).toFixed(1)}°`);
});

test('full stick = the turn at the AoA / G limit (limiting reported)', async () => {
  const { b, c, e } = await setup({ speed: 250 });
  fly(b, e, 1);
  let maxG = 0; const seen = new Set();
  fly(b, e, 4, 1, 0, () => { maxG = Math.max(maxG, e.state.gLoad); if (c.assist.info.limiting) seen.add(c.assist.info.limiting); });
  assert.ok(maxG > 7, `max G ${maxG.toFixed(1)}`);
  assert.ok(maxG < 9.6, `G limit held: ${maxG.toFixed(1)}`);
  assert.ok(seen.has('g') || seen.has('aoa'), [...seen].join(','));
  assert.ok(!e.state.stalled);
});

test('gun help draws the nose onto the solution, only near it, not with aimAssist 0', async () => {
  const run = async (aim) => {
    const { b, c, e } = await setup({ loadout: { ir: 0, radar: 0 } });
    c.assist.setAimAssist(aim);
    const t = c.world.spawnAircraft({ aircraft: 'f16', team: 'red', position: new THREE.Vector3(25, 3015, -500), heading: 0, speed: 185, skill: 0.1, loadout: { ir: 0, radar: 0 } });
    t.pilot = null; t.controls.throttle = 0.85; t.invulnerable = true;
    e.target = t;
    const sol = {};
    let acted = false;
    fly(b, e, 2.5, 0, 0, () => { if (c.assist.info.gunAssist) acted = true; });
    c.weapons.gunSolution(e, t, sol);
    fwd.set(0, 0, -1).applyQuaternion(e.state.quaternion);
    return { err: Math.acos(Math.min(1, fwd.dot(sol.dir))) / DEG, acted };
  };
  const off = await run(0), on = await run(1);
  assert.equal(off.acted, false);
  assert.equal(on.acted, true);
  assert.ok(on.err < 1 && on.err < off.err, `with help ${on.err.toFixed(2)}°, without ${off.err.toFixed(2)}°`);
});

test('rookie: auto-throttle engages when the throttle is left alone; any input turns it off for a while', async () => {
  const { b, c, e } = await setup({ difficulty: 'rookie', speed: 120 });
  e.controls.throttle = 0.5;
  fly(b, e, 1);
  assert.equal(c.assist.info.autoThrottle, false);
  fly(b, e, 3);
  assert.equal(c.assist.info.autoThrottle, true);
  assert.ok(e.controls.throttle > 0.5, `slow: power up (${e.controls.throttle.toFixed(2)})`);
  e.controls.throttle = 0.3;                                   // the player moves the lever
  fly(b, e, 2);
  assert.equal(c.assist.info.autoThrottle, false);
  assert.ok(Math.abs(e.controls.throttle - 0.3) < 1e-6, 'the player\'s lever is kept');
  // veteran: never
  const v = await setup({ difficulty: 'veteran' });
  fly(v.b, v.e, 5);
  assert.equal(v.c.assist.info.autoThrottle, false);
});

test('rookie: the ground protection pulls out of a dive at the last moment; veteran gets the cue', async () => {
  const dive = async (difficulty) => {
    const { b, c, e } = await setup({ difficulty, alt: 2600, speed: 230 });
    // start in a 45° dive, hands off (the assist holds the dive the player set up)
    e.state.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 4, 0, 0, 'YXZ'));
    e.state.velocity.set(0, 0, -1).applyQuaternion(e.state.quaternion).multiplyScalar(230);
    let cue = false, ground = false, minY = 1e9;
    fly(b, e, 16, 0, 0, () => { if (c.assist.info.pullUp) cue = true; if (c.assist.info.limiting === 'ground') ground = true; minY = Math.min(minY, e.state.position.y); });
    return { alive: e.alive && !e.state.crashed, cue, ground, minY };
  };
  const r = await dive('rookie');
  assert.ok(r.alive, `rookie survives the dive (lowest ${r.minY.toFixed(0)} m)`);
  assert.ok(r.cue && r.ground);
  assert.ok(r.minY < 900, `takes over late, not early (lowest ${r.minY.toFixed(0)} m)`);
  const v = await dive('veteran');
  assert.ok(v.cue, 'veteran sees the pull-up cue');
});
