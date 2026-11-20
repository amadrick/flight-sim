// Controller tests against a minimal fake ctx / combat (no DOM, no renderer). node --test src/combat/camera/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Events } from '../../core/events.js';
import { createCombatCamera } from './index.js';
import { FIGHT, fightBias, gunZoomGate, feelAmount, killCamDuration, DEG } from './math.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function aircraft(pos, opts = {}) {
  const q = opts.q || new THREE.Quaternion();
  const e = {
    kind: 'aircraft', alive: true, team: opts.team || 'red', isPlayer: !!opts.player,
    state: { position: pos.clone(), velocity: V(0, 0, -220).applyQuaternion(q), quaternion: q.clone(), roll: 0, gLoad: 1, aoa: 0.05, agl: 4000, verticalSpeed: 0, tas: 220, engines: [{ afterburner: 0 }] },
    forward: V(0, 0, -1).applyQuaternion(q), up: V(0, 1, 0).applyQuaternion(q), right: V(1, 0, 0).applyQuaternion(q),
    def: { geometry: { length: 15, span: 10, height: 5 }, specs: { cruiseSpeed: 240 } },
    hp: 100, maxHp: 100, loadout: { gun: { firing: false } }, target: null,
  };
  return e;
}

function setup() {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 600000);
  const rig = { mode: 'chase', worldPosition: V(), velocity: V(), isInterior: false, setMode(m) { this.mode = m; this.isInterior = m === 'cockpit'; } };
  const ctx = {
    camera, cameraRig: rig, controls: { lookX: 0, lookY: 0 }, time: { paused: false }, params: { raw: {} },
    world: { toRender: (w, o = V()) => o.copy(w), toWorld: (r, o = V()) => o.copy(r), groundHeightAt: () => 0 },
  };
  const player = aircraft(V(0, 4000, 0), { player: true, team: 'blue' });
  const bandit = aircraft(V(0, 4000, -1500));
  const world = {
    player, aircraft: [player, bandit], wrecks: [], entities: [player, bandit],
    enemiesOf(e, out = []) { out.length = 0; for (const a of this.aircraft) if (a.alive && a.team !== e.team) out.push(a); return out; },
  };
  const threats = [];
  const weapons = {
    missiles: [],
    threatsTo(e, out = []) { out.length = 0; for (const t of threats) out.push(t); return out; },
    gunSolution(s, t, out) { out.point.copy(t.state.position); out.inRange = s.state.position.distanceTo(t.state.position) < 900; return out; },
  };
  const combat = { ctx, events: new Events(), world, weapons, active: true, ui: null };
  return { ctx, rig, camera, combat, player, bandit, threats };
}
/** rig poses a plain chase camera 30 m behind and 6 m above the player, then the combat camera runs */
function frame(s, cc, n = 1, dt = 1 / 30) {
  for (let i = 0; i < n; i++) {
    s.camera.position.copy(s.player.state.position).add(V(0, 6, 30)); s.camera.quaternion.identity(); s.camera.fov = 55;
    s.camera.updateMatrixWorld();
    cc.update(dt);
  }
}
function onScreen(cam, p) {
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const v = p.clone().project(cam);
  const inFront = p.clone().applyMatrix4(cam.matrixWorldInverse).z < 0;
  return inFront && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 ? v : null;
}

test('no mission: the camera is never touched', async () => {
  const s = setup(); s.combat.active = false;
  const cc = await createCombatCamera(s.combat);
  s.camera.position.set(1, 2, 3); s.camera.quaternion.set(0.1, 0.2, 0.3, 0.927).normalize();
  const p = s.camera.position.clone(), q = s.camera.quaternion.clone();
  cc.update(1 / 60);
  assert.ok(s.camera.position.equals(p) && s.camera.quaternion.equals(q));
  assert.equal(cc.mode, null);
});

test('fight view off and no feel: the rig pose stands exactly', async () => {
  const s = setup(); const cc = await createCombatCamera(s.combat);
  cc.setFightCam(false); cc.setFeel(0);
  frame(s, cc, 5);
  assert.ok(s.camera.position.equals(s.player.state.position.clone().add(V(0, 6, 30))));
  assert.equal(s.camera.quaternion.w, 1);
  assert.equal(cc.mode, null);
});

test('fight view: default in a mission, jet and a target 60° off the nose both on screen', async () => {
  const s = setup(); const cc = await createCombatCamera(s.combat);
  const modes = []; s.combat.events.on('camera:combat', (e) => modes.push(e.mode));
  s.bandit.state.position.set(1500 * Math.sin(60 * DEG), 4000, -1500 * Math.cos(60 * DEG));
  s.player.target = s.bandit;
  frame(s, cc, 120);
  assert.equal(cc.mode, 'fight'); assert.deepEqual(modes, ['fight']);
  const pj = onScreen(s.camera, s.player.state.position), pt = onScreen(s.camera, s.bandit.state.position);
  assert.ok(pj, 'own jet on screen'); assert.ok(pt, 'target on screen');
  assert.ok(pj.y < 0, 'jet in the lower half');
  // the view leans right toward the target, but not more than biasMax
  const fwd = V(0, 0, -1).applyQuaternion(s.camera.quaternion);
  const yaw = Math.atan2(fwd.x, -fwd.z) / DEG;
  assert.ok(yaw > 5 && yaw <= FIGHT.biasMax + 2, `yaw ${yaw}`);
  // horizon level with wings level
  assert.ok(Math.abs(V(1, 0, 0).applyQuaternion(s.camera.quaternion).y) < 0.05);
});

test('gun zoom: FOV tightens with the lead solution in the window, relaxes outside; setGunZoom(false) stops it', async () => {
  const s = setup(); const cc = await createCombatCamera(s.combat);
  s.bandit.state.position.set(0, 4000, -1500); s.player.target = s.bandit;
  frame(s, cc, 150); const fovNear = s.camera.fov;                 // ahead but out of gun range
  s.bandit.state.position.set(0, 4000, -600);
  frame(s, cc, 150); const fovZoom = s.camera.fov;
  assert.ok(fovZoom < fovNear * 0.9, `${fovNear} → ${fovZoom}`);
  cc.setGunZoom(false); frame(s, cc, 150);
  assert.ok(s.camera.fov > fovZoom + 5);
});

test('looking around with the rig look control hands the view back to the rig', async () => {
  const s = setup(); const cc = await createCombatCamera(s.combat);
  frame(s, cc, 30); assert.equal(cc.mode, 'fight');
  s.ctx.controls.lookX = 0.8; frame(s, cc, 60);
  assert.equal(cc.mode, null);
  assert.ok(s.camera.position.equals(s.player.state.position.clone().add(V(0, 6, 30))));
});

test('padlock: target behind stays in frame with the jet; falls back to the fight view when the target dies', async () => {
  const s = setup(); const cc = await createCombatCamera(s.combat);
  s.bandit.state.position.set(300, 4300, 1200); s.player.target = s.bandit;
  assert.equal(cc.setMode('padlock'), true);
  frame(s, cc, 150);
  assert.equal(cc.mode, 'padlock');
  assert.ok(onScreen(s.camera, s.bandit.state.position), 'target on screen');
  const pj = onScreen(s.camera, s.player.state.position); assert.ok(pj && pj.y < -0.1, 'jet low in frame');
  s.bandit.alive = false; s.player.target = null;
  frame(s, cc, 60); assert.equal(cc.mode, 'padlock');              // waits for the next auto-selected target
  frame(s, cc, 130); assert.equal(cc.mode, 'fight');               // then hands back to the fight view
});

test('peek: held look at the target, released back to the fight view', async () => {
  const s = setup(); const cc = await createCombatCamera(s.combat);
  s.bandit.state.position.set(-1200, 4200, 200); s.player.target = s.bandit;
  frame(s, cc, 30); assert.equal(cc.mode, 'fight');
  cc.peek(true); frame(s, cc, 90);
  assert.equal(cc.mode, 'padlock'); assert.equal(cc.peeking, true);
  assert.ok(onScreen(s.camera, s.bandit.state.position));
  cc.peek(false); frame(s, cc, 60);
  assert.equal(cc.mode, 'fight');
  s.combat.events.emit('cmd', { name: 'peekOn' }); assert.equal(cc.peeking, true);
  s.combat.events.emit('cmd', { name: 'peekOff' }); assert.equal(cc.peeking, false);
});

test('kill cam: full when calm, quick when a bandit is near, none under fire; returns with a settle (no snap)', async () => {
  const s = setup(); const cc = await createCombatCamera(s.combat);
  const victim = s.bandit;
  frame(s, cc, 10);
  // calm: the only bandit is the victim, far away after it dies
  victim.state.position.set(0, 4000, -6000); s.combat.world.aircraft = [s.player]; victim.alive = false;
  s.combat.events.emit('kill', { victim, killer: s.player });
  assert.equal(cc.mode, 'kill');
  frame(s, cc, 60); assert.equal(cc.mode, 'kill');                  // 2 s in: still running (full length)
  frame(s, cc, 40); assert.notEqual(cc.mode, 'kill');
  // the return eases: the first frames back are not yet on the fight pose
  const d0 = s.camera.position.distanceTo(s.player.state.position);
  frame(s, cc, 30); const d1 = s.camera.position.distanceTo(s.player.state.position);
  assert.ok(d0 > d1 + 1, `settles in ${d0} → ${d1}`);

  // a live bandit 2.5 km away: quick cut ≤ 1.2 s
  const s2 = setup(); const c2 = await createCombatCamera(s2.combat);
  const other = s2.bandit; other.state.position.set(2500, 4000, -1000);
  const v2 = aircraft(V(0, 4000, -1200)); v2.alive = false;
  frame(s2, c2, 5);
  s2.combat.events.emit('kill', { victim: v2, killer: s2.player });
  assert.equal(c2.mode, 'kill'); frame(s2, c2, 38); assert.notEqual(c2.mode, 'kill');

  // under fire (missile guiding) → no kill cam at all
  const s3 = setup(); const c3 = await createCombatCamera(s3.combat);
  s3.bandit.state.position.set(0, 4000, -9000);
  s3.threats.push({ type: 'missile', range: 3000 });
  const v3 = aircraft(V(0, 4000, -1200)); v3.alive = false;
  frame(s3, c3, 5);
  s3.combat.events.emit('kill', { victim: v3, killer: s3.player });
  assert.notEqual(c3.mode, 'kill');
  // bandit nose-on inside gun range → none
  const s4 = setup(); const c4 = await createCombatCamera(s4.combat);
  s4.bandit.state.position.set(0, 4000, -1000); s4.bandit.state.quaternion.setFromAxisAngle(V(0, 1, 0), Math.PI);
  const v4 = aircraft(V(0, 4000, -1200)); v4.alive = false;
  frame(s4, c4, 5);
  s4.combat.events.emit('kill', { victim: v4, killer: s4.player });
  assert.notEqual(c4.mode, 'kill');
});

test('kill cam aborts at once when rounds pass close', async () => {
  const s = setup(); const cc = await createCombatCamera(s.combat);
  s.bandit.state.position.set(0, 4000, -9000);
  const v = aircraft(V(0, 4000, -1200)); v.alive = false;
  frame(s, cc, 5);
  s.combat.events.emit('kill', { victim: v, killer: s.player }); assert.equal(cc.mode, 'kill');
  s.combat.events.emit('bullet:near', { target: s.player, distance: 8 });
  assert.notEqual(cc.mode, 'kill');
});

test('setFeel: boolean and 0..1 amount', async () => {
  const s = setup(); const cc = await createCombatCamera(s.combat);
  assert.equal(cc.setFeel(false), 0); assert.equal(cc.feel, false);
  assert.equal(cc.setFeel(true), 1); assert.equal(cc.feel, true);
  assert.equal(cc.setFeel(0.4), 0.4); assert.equal(cc.feelAmount, 0.4); assert.equal(cc.feel, true);
  assert.equal(cc.setFeel(7), 1);
});

test('pure helpers: fight bias, gun zoom gate, feel amount, kill cam duration', () => {
  const o = { yaw: 0, pitch: 0 };
  fightBias(o, 2 * DEG, 0); assert.equal(o.yaw, 0);
  fightBias(o, 80 * DEG, 0); assert.ok(Math.abs(o.yaw - FIGHT.biasMax * DEG) < 1e-9);
  fightBias(o, 0, 80 * DEG); assert.ok(o.pitch <= FIGHT.biasUp * DEG + 1e-9);
  fightBias(o, 0, -80 * DEG); assert.ok(o.pitch >= -FIGHT.biasDown * DEG - 1e-9);
  fightBias(o, 175 * DEG, 0); assert.ok(Math.abs(o.yaw) < 1e-9, 'no lean for a target dead astern');
  fightBias(o, 90 * DEG, 0, FIGHT, 10 * DEG); assert.ok(o.yaw <= 10 * DEG + 1e-9);
  const g = { on: false };
  assert.equal(gunZoomGate(g, 5 * DEG, true), false);
  assert.equal(gunZoomGate(g, 3 * DEG, true), true);
  assert.equal(gunZoomGate(g, 6 * DEG, true), true);
  assert.equal(gunZoomGate(g, 8 * DEG, true), false);
  assert.equal(gunZoomGate(g, 1 * DEG, false), false);
  assert.equal(feelAmount(true), 1); assert.equal(feelAmount(false), 0); assert.equal(feelAmount(0.3), 0.3); assert.equal(feelAmount('x'), 1);
  const calm = { alive: true, agl: 3000, vs: 0, missileThreats: 0, gunThreat: false, nearestEnemy: 9000 };
  assert.equal(killCamDuration(calm), 3.2);
  assert.equal(killCamDuration({ ...calm, nearestEnemy: 2500 }), 1.2);
  assert.equal(killCamDuration({ ...calm, locks: 1 }), 1.2);
  assert.equal(killCamDuration({ ...calm, shotAt: 1 }), 0);
  assert.equal(killCamDuration({ ...calm, missileThreats: 1 }), 0);
});
