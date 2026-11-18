// Development harness for the clouds module (NOT part of the shipped bundle).
//   node tools/shot.mjs --entry src/clouds/harness.js --html dist/clouds.html --out shots/x.png \
//        --params "weather=scattered&tod=12&cy=300&yaw=90&pitch=15" --size 480x270 --frames 12
// Boots the same core + stub pipeline/terrain as main.js but with a free debug camera:
//   cx, cy, cz   camera world position (m; cy = altitude MSL)      yaw (deg true, 0 = north), pitch (deg up), fov
//   vx, vy, vz   camera velocity (m/s)   yawRate (deg/s)           ac=1 also spawns the player aircraft (chase camera)
//   view=march|weather|shadow  show an internal buffer             wx=<preset> switch preset after `wxAt` frames
import * as THREE from 'three';
import { parseParams } from '../core/params.js';
import { createContext, attachFrameUniformUpdater } from '../core/context.js';
import { createSession } from '../core/session.js';
import { createPipeline } from '../render/index.js';
import { createTerrain } from '../terrain/index.js';
import { createClouds } from './index.js';
import { FULLSCREEN_VERT, FullscreenPass } from '../core/glsl.js';

const sim = (window.__sim = { ready: false, error: null, ctx: null, step: null });

async function boot() {
  const params = parseParams(), raw = params.raw;
  const num = (k, d) => (raw[k] !== undefined && isFinite(+raw[k]) ? +raw[k] : d);
  const ctx = createContext({ canvas: document.getElementById('view'), hudCanvas: document.getElementById('hud'), uiRoot: document.getElementById('ui'), params });
  sim.ctx = ctx;
  const updateFrameUniforms = attachFrameUniformUpdater(ctx);
  ctx.pipeline = await createPipeline(ctx);
  ctx.terrain = await createTerrain(ctx);
  const t0 = performance.now();
  ctx.clouds = await createClouds(ctx);
  sim.cloudBootMs = performance.now() - t0;
  ctx.session = createSession(ctx);
  ctx.input = { update() {} };

  const camPos = new THREE.Vector3(num('cx', 0), num('cy', 1500), num('cz', 0));
  const vel = new THREE.Vector3(num('vx', 0), num('vy', 0), num('vz', 0));
  let yaw = num('yaw', 0), pitch = num('pitch', 0);
  const yawRate = num('yawRate', 0), useAircraft = raw.ac === '1';
  ctx.camera.fov = num('fov', 60);
  const e = new THREE.Euler(0, 0, 0, 'YXZ'), tgt = new THREE.Vector3(), off = new THREE.Vector3(), q = new THREE.Quaternion();
  ctx.cameraRig = {
    update(dt) {
      if (useAircraft && ctx.player) {
        const p = ctx.player, g = p.def.geometry; ctx.world.toRender(p.state.position, tgt);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -p.state.heading + num('orbit', 0) * Math.PI / 180);
        off.set(0, g.length * num('camUp', 0.35), g.length * num('camBack', 2.2)).applyQuaternion(q);
        ctx.camera.position.copy(tgt).add(off); ctx.camera.lookAt(tgt);
        return;
      }
      camPos.addScaledVector(vel, dt); yaw += yawRate * dt;
      ctx.world.updateOrigin(camPos);
      ctx.world.toRender(camPos, ctx.camera.position);
      e.set(pitch * Math.PI / 180, -yaw * Math.PI / 180, 0); ctx.camera.quaternion.setFromEuler(e);
    },
  };

  const resize = () => {
    const w = Math.max(2, window.innerWidth), h = Math.max(2, window.innerHeight);
    ctx.camera.aspect = w / h; ctx.camera.updateProjectionMatrix();
    ctx.pipeline.setSize(w, h, 1);
  };
  window.addEventListener('resize', resize); resize();

  // optional debug view of an internal buffer, drawn over the canvas
  const view = raw.view;
  const viewPass = view ? new FullscreenPass(new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: { tex: { value: null }, uMode: { value: 0 } }, vertexShader: FULLSCREEN_VERT,
    fragmentShader: `precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D tex; uniform float uMode;
      void main() { vec4 c = texture(tex, vUv);
        if (uMode < 0.5) o = vec4(c.rgb, 1.0);
        else if (uMode < 1.5) o = vec4(1.0 - exp(-c.r * 0.2), c.g, c.b * 3.0, 1.0);
        else o = vec4(pow(c.rgb / (1.0 + c.rgb), vec3(0.45)) * (1.0 - c.a) + vec3(0.0, 0.0, 0.3) * c.a, 1.0); }`,
  })) : null;

  const wxSwitch = raw.wx, wxAt = num('wxAt', 3);
  function frame(realDt) {
    realDt = Math.min(Math.max(realDt, 0), 0.1);
    ctx.renderer.info.reset();
    ctx.time.advance(realDt);
    const dt = ctx.time.dt;
    if (wxSwitch && ctx.time.frame === wxAt) ctx.weather.setPreset(wxSwitch, raw.wxInstant === '1');
    ctx.weather.update(dt);
    ctx.session.update(dt);
    ctx.cameraRig.update(realDt);
    updateFrameUniforms();
    ctx.terrain.update?.(dt);
    ctx.clouds.update(dt);
    ctx.pipeline.render(dt);
    if (viewPass) {
      const d = ctx.clouds.debug;
      const t = view === 'weather' ? d.weatherRT.texture : view === 'shadow' ? d.shadowRT.texture : view === 'march' ? d.marchRT.textures[0] : ctx.clouds.texture;
      viewPass.material.uniforms.tex.value = t;
      viewPass.material.uniforms.uMode.value = view === 'weather' ? 0 : view === 'shadow' ? 1 : 2;
      viewPass.render(ctx.renderer, null);
    }
  }
  if (useAircraft) ctx.session.start({});
  sim.step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) frame(dt); return ctx.time.frame; };
  frame(0);
  document.getElementById('boot')?.remove();
  sim.ready = true;
  if (!params.test) {
    let last = performance.now();
    const loop = (now) => { const dt = (now - last) / 1000; last = now; try { frame(dt); } catch (err) { console.error(err); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
boot().catch((err) => { console.error(err); sim.error = String(err?.stack || err); });
