// Isolated ocean harness: pipeline + terrain + water only, free camera from URL params.
//   node tools/shot.mjs --entry src/water/harness.js --html dist/water.html --params "x=0&z=30000&alt=30&hdg=180&pitch=-5&tod=18.6&weather=clear"
// params: x, z (world m), alt (m), hdg (deg true), pitch (deg), fov (deg), tod, weather, quality
import * as THREE from 'three';
import { parseParams } from '../core/params.js';
import { createContext, attachFrameUniformUpdater } from '../core/context.js';
import { createPipeline } from '../render/index.js';
import { createTerrain } from '../terrain/index.js';
import { createWater } from './index.js';

const sim = (window.__sim = { ready: false, error: null, ctx: null, step: null });

async function boot() {
  const params = parseParams();
  const ctx = createContext({ canvas: document.getElementById('view'), hudCanvas: document.getElementById('hud'), uiRoot: document.getElementById('ui'), params });
  sim.ctx = ctx;
  const updateFrameUniforms = attachFrameUniformUpdater(ctx);
  ctx.pipeline = await createPipeline(ctx);
  ctx.terrain = await createTerrain(ctx);
  const t0 = performance.now();
  ctx.water = await createWater(ctx);
  sim.waterBootMs = performance.now() - t0;
  if (params.weather) ctx.weather.setPreset(params.weather, true);
  const raw = params.raw;
  const num = (k, d) => (raw[k] !== undefined && isFinite(+raw[k]) ? +raw[k] : d);
  const camWorld = new THREE.Vector3(num('x', 0), num('alt', 30), num('z', 30000));
  const hdg = num('hdg', 180) * Math.PI / 180, pitch = num('pitch', -4) * Math.PI / 180;
  ctx.camera.fov = num('fov', 60); ctx.camera.updateProjectionMatrix();
  const speed = num('spd', 0);
  const resize = () => {
    const w = Math.max(2, window.innerWidth), h = Math.max(2, window.innerHeight);
    ctx.camera.aspect = w / h; ctx.camera.updateProjectionMatrix();
    ctx.pipeline.setSize(w, h, 1);
  };
  window.addEventListener('resize', resize); resize();

  function frame(realDt) {
    ctx.renderer.info.reset();
    ctx.time.advance(realDt);
    const dt = ctx.time.dt;
    ctx.weather.update(dt);
    camWorld.x += Math.sin(hdg) * speed * dt; camWorld.z -= Math.cos(hdg) * speed * dt;
    ctx.world.updateOrigin(camWorld);
    ctx.world.toRender(camWorld, ctx.camera.position);
    ctx.camera.rotation.set(0, 0, 0); ctx.camera.rotation.order = 'YXZ';
    ctx.camera.rotation.y = -hdg; ctx.camera.rotation.x = pitch;
    updateFrameUniforms();
    ctx.terrain.update?.(dt);
    ctx.water.update(dt);
    ctx.pipeline.render(dt);
  }
  sim.step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) frame(dt); return ctx.time.frame; };
  frame(0);
  document.getElementById('boot')?.remove();
  sim.ready = true;
  if (!params.test) {
    let last = performance.now();
    const loop = (now) => { const d = Math.min(0.1, (now - last) / 1000); last = now; frame(d); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
boot().catch((e) => { console.error(e); sim.error = String(e?.stack || e); });
