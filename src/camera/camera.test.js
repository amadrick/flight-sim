import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Events } from '../core/events.js';
import { createWorld } from '../core/world.js';
import { createAircraftState, createControls } from '../core/state.js';
import f16geo from '../aircraft/f16/geometry.js';
import b738geo from '../aircraft/b738/geometry.js';
import { damp, dampK, buildFrame, framingDistance, trackFov, chaseFrameTarget } from './cammath.js';
import { createCameraRig } from './index.js';

function mockCtx(geo = f16geo, category = 'fighter') {
  const ctx = { events: new Events(), camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 600000), controls: createControls(), time: { dt: 1 / 60, paused: false }, params: {} };
  ctx.world = createWorld(ctx);
  ctx.world.setTerrainHeightFn(() => 12);
  const state = createAircraftState();
  state.position.set(1000, 800, -3000); state.velocity.set(0, 0, -200); state.engines = [{ afterburner: 0 }];
  ctx.player = { def: { geometry: geo, category, specs: { cruiseSpeed: 240 } }, state };
  return ctx;
}

test('damping is frame-rate independent', () => {
  const run = (fps) => { let x = 0; for (let i = 0; i < fps; i++) x = damp(x, 1, 4, 1 / fps); return x; };
  assert.ok(Math.abs(run(15) - run(240)) < 1e-9);
  assert.equal(damp(3, 5, 4, 0), 3);
  assert.ok(dampK(4, 1e9) <= 1);
});

test('framing math', () => {
  const d = framingDistance(10, 40, 16 / 9);
  assert.ok(Math.abs(Math.asin(10 / d) * 2 * 180 / Math.PI - 40) < 1e-6);
  assert.ok(trackFov(15, 1000, 0.2, 3, 50) < trackFov(15, 100, 0.2, 3, 50));
  assert.equal(trackFov(15, 1e6, 0.2, 3, 50), 3);
});

test('buildFrame is orthonormal and survives degenerate up', () => {
  const q = new THREE.Quaternion();
  buildFrame(q, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0));
  assert.ok(Number.isFinite(q.x + q.y + q.z + q.w)); assert.ok(Math.abs(q.length() - 1) < 1e-9);
});

function stepRig(ctx, rig, n, dt, fn) { for (let i = 0; i < n; i++) { fn?.(i); ctx.time.dt = dt; rig.update(dt); } }

test('origin shift causes no camera jump in world space', async () => {
  const ctx = mockCtx(); const rig = await createCameraRig(ctx);
  stepRig(ctx, rig, 60, 1 / 60);
  const before = rig.worldPosition.clone(); const rbefore = ctx.camera.position.clone();
  const delta = new THREE.Vector3(1024, 0, -2048);
  ctx.world.origin.add(delta);              // the origin moved, nothing else did
  rig.update(0);
  const w = new THREE.Vector3(); ctx.world.toWorld(ctx.camera.position, w);
  assert.ok(w.distanceTo(before) < 1e-6, 'world position preserved');
  assert.ok(Math.abs(ctx.camera.position.x - (rbefore.x - delta.x)) < 1e-6);
});

for (const mode of ['chase', 'cockpit', 'orbit', 'flyby', 'tower', 'wing', 'showcase']) {
  for (const [name, geo, cat] of [['f16', f16geo, 'fighter'], ['b738', b738geo, 'airliner']]) {
    test(`${mode}/${name}: finite, above ground, through a loop and roll`, async () => {
      const ctx = mockCtx(geo, cat); const rig = await createCameraRig(ctx);
      rig.setMode(mode);
      const st = ctx.player.state; const q = new THREE.Quaternion(), dq = new THREE.Quaternion();
      let pitch = 0, roll = 0; const pos = st.position, v = st.velocity;
      let maxStep = 0; const last = new THREE.Vector3(); let lastQ = new THREE.Quaternion(); let maxRot = 0;
      for (let i = 0; i < 1500; i++) {
        pitch += 0.025 * (i < 700 ? 1 : 0); roll += 0.03 * (i > 700 && i < 1000 ? 1 : 0);   // full loop then barrel-roll
        q.setFromEuler(new THREE.Euler(pitch, 0, roll, 'YXZ')); st.quaternion.copy(q);
        v.set(0, 0, -200).applyQuaternion(q); pos.addScaledVector(v, 1 / 60);
        if (pos.y < 300) pos.y = 300;
        st.roll = roll; st.gLoad = 4; ctx.time.dt = 1 / 60;
        ctx.world.updateOrigin(pos);
        rig.update(1 / 60);
        const c = ctx.camera;
        assert.ok(Number.isFinite(c.position.x + c.position.y + c.position.z + c.quaternion.w), 'finite');
        const wp = rig.worldPosition;
        assert.ok(wp.y >= ctx.world.groundHeightAt(wp.x, wp.z) + 0.5, 'above ground');
        if (i > 120) {
          const ang = lastQ.angleTo(c.quaternion); maxRot = Math.max(maxRot, ang);
          if (mode === 'chase' || mode === 'orbit') assert.ok(ang < 0.12, `chase rotation per frame ${ang} @${i}`);
        }
        lastQ.copy(c.quaternion); last.copy(wp);
      }
    });
  }
}

test('mode cycling, events and isInterior', async () => {
  const ctx = mockCtx(); const rig = await createCameraRig(ctx);
  const seen = []; ctx.events.on('camera:mode', (m) => seen.push(m));
  for (let i = 0; i < 6; i++) ctx.events.emit('cmd', { name: 'cameraNext' });
  assert.deepEqual(seen, ['cockpit', 'orbit', 'flyby', 'tower', 'wing', 'chase']);
  ctx.events.emit('cmd', { name: 'camera:cockpit' }); rig.update(1 / 60);
  assert.equal(rig.isInterior, true);
  ctx.events.emit('cmd', { name: 'cameraPrev' }); assert.equal(rig.mode, 'chase');
  ctx.events.emit('crash', {}); assert.equal(rig.mode, 'orbit');
  ctx.events.emit('session:start', ctx.player); assert.equal(rig.mode, 'chase');
});

test('no player: idle view, no throw', async () => {
  const ctx = mockCtx(); ctx.player = null; const rig = await createCameraRig(ctx);
  stepRig(ctx, rig, 10, 1 / 60);
  assert.ok(Number.isFinite(ctx.camera.position.y));
});

test('dt = 0 is stable and does not move the camera', async () => {
  const ctx = mockCtx(); const rig = await createCameraRig(ctx);
  stepRig(ctx, rig, 100, 1 / 60);
  const p = ctx.camera.position.clone(); ctx.time.dt = 0; rig.update(0); rig.update(0);
  assert.ok(ctx.camera.position.distanceTo(p) < 1e-6);
});

test('frame rate independence of chase (15 vs 240 fps)', async () => {
  const res = [];
  for (const fps of [15, 240]) {
    const ctx = mockCtx(); const rig = await createCameraRig(ctx); const st = ctx.player.state;
    const n = fps * 3;
    for (let i = 0; i < n; i++) {
      const t = i / fps; st.quaternion.setFromEuler(new THREE.Euler(0.3 * Math.min(t, 1), 0, 0, 'YXZ'));
      st.velocity.set(0, 0, -200).applyQuaternion(st.quaternion);
      ctx.time.dt = 1 / fps; rig.update(1 / fps);
    }
    res.push(ctx.camera.quaternion.clone());
  }
  assert.ok(res[0].angleTo(res[1]) < 0.02, 'angle diff ' + res[0].angleTo(res[1]));
});
