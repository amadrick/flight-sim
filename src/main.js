// Boot + main loop. Owned by the integrator.
import { parseParams } from './core/params.js';
import { createContext, attachFrameUniformUpdater } from './core/context.js';
import { createSession } from './core/session.js';
import { createPipeline } from './render/index.js';
import { createTerrain } from './terrain/index.js';
import { createWater } from './water/index.js';
import { createScenery } from './scenery/index.js';
import { createClouds } from './clouds/index.js';
import { createNeuralCloudScatter, createNeuralCloudScatter4 } from './neural/cloud-scatter.js';
import { createInput } from './input/index.js';
import { createCameraRig } from './camera/index.js';
import { createEffects } from './effects/index.js';
import { createAudio } from './audio/index.js';
import { createHud } from './ui/hud/index.js';
import { createMenu } from './ui/menu/index.js';
import { createCombat } from './combat/index.js';

const sim = (window.__sim = { ready: false, error: null, ctx: null, step: null });

async function boot() {
  const params = parseParams();
  const ctx = createContext({
    canvas: document.getElementById('view'),
    hudCanvas: document.getElementById('hud'),
    uiRoot: document.getElementById('ui'),
    params,
  });
  sim.ctx = ctx;
  const updateFrameUniforms = attachFrameUniformUpdater(ctx);
  const setLoading = (t) => { const el = document.getElementById('boot-status'); if (el) el.textContent = t; };

  // Creation order matters: pipeline (lights, atmosphere API) → world content → player-facing systems.
  setLoading('Atmosphere'); ctx.pipeline = await createPipeline(ctx);
  setLoading('Terrain');    ctx.terrain = await createTerrain(ctx);
  setLoading('Ocean');      ctx.water = await createWater(ctx);
  setLoading('Airports');   ctx.scenery = await createScenery(ctx);
  setLoading('Clouds');     ctx.clouds = await createClouds(ctx);
  // Cloud lighting: multiple scattering from the network trained against the Monte Carlo path tracer (tools/neural),
  // baked into a small 3D texture at boot. `?scatter=classic` keeps the clouds module's hand-built approximation.
  if (params.raw.scatter !== 'classic') {
    try {
      // the 4-input network (sun depth, depth to top, view angle, depth to base) is the accurate one; the 3-input
      // network supplies the shared helpers and is what `?scatter=neural3` uses on its own
      const s3 = createNeuralCloudScatter({ phaseMax: 20 });
      const s4 = params.raw.scatter === 'neural3' ? null : createNeuralCloudScatter4({ phaseMax: 20 });
      ctx.clouds.setScatterModel(s4 ? { glsl: s3.glsl + '\n' + s4.glsl, uniforms: { ...s3.uniforms, ...s4.uniforms } } : { glsl: s3.glsl, uniforms: s3.uniforms });
      ctx.neural = { cloudScatter: s3, cloudScatter4: s4 };
    } catch (e) { console.warn('[neural] cloud scatter unavailable, using the classic model', e); }
  }
  setLoading('Systems');
  ctx.session = createSession(ctx);
  ctx.input = await createInput(ctx);
  ctx.cameraRig = await createCameraRig(ctx);
  ctx.effects = await createEffects(ctx);
  ctx.audio = await createAudio(ctx);
  ctx.hud = await createHud(ctx);
  ctx.menu = await createMenu(ctx);
  // combat mode (missions, AI aircraft, weapons): dormant until a mission starts — see src/combat/COMBAT.md
  setLoading('Combat'); ctx.combat = await createCombat(ctx);

  const resize = () => {
    const w = Math.max(2, window.innerWidth), h = Math.max(2, window.innerHeight);
    ctx.camera.aspect = w / h; ctx.camera.updateProjectionMatrix();
    ctx.pipeline.setSize(w, h, Math.min(window.devicePixelRatio || 1, 2));
    ctx.events.emit('resize', { width: w, height: h });
  };
  window.addEventListener('resize', resize); resize();

  ctx.events.on('cmd', ({ name }) => {
    if (name === 'pause') { ctx.time.paused = !ctx.time.paused; ctx.events.emit('pause', ctx.time.paused); }
  });

  const updatables = ['terrain', 'water', 'scenery', 'clouds', 'effects', 'audio', 'hud', 'menu'];
  function frame(realDt, noRender) {
    realDt = Math.min(Math.max(realDt, 0), 0.1);
    ctx.renderer.info.reset();
    ctx.time.advance(realDt);
    const dt = ctx.time.dt;
    ctx.input.update(realDt);
    ctx.weather.update(dt);
    ctx.combat.pre(dt);                // combat input, bot pilot (before the player's physics)
    ctx.session.update(dt);            // physics → origin → aircraft visual
    ctx.combat.step(dt);               // missions, AI aircraft, weapons, combat effects
    ctx.cameraRig.update(realDt);      // camera pose in render space
    updateFrameUniforms();
    for (const k of updatables) ctx[k]?.update?.(dt);
    ctx.combat.late(dt);               // combat HUD overlay, audio, mission screens
    if (!noRender) ctx.pipeline.render(dt);
  }

  if (params.autostart && params.raw.mission) ctx.combat.start(params.raw.mission) || ctx.session.start({});
  else if (params.autostart) ctx.session.start({});
  if (params.cam) ctx.cameraRig.setMode?.(params.cam);

  sim.step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) frame(dt); return ctx.time.frame; };
  // fast-forward without drawing (tests): simulate `seconds` in steps of dt; `until()` returning true stops early. Returns the simulated time.
  sim.skip = (seconds = 1, dt = 1 / 30, until = null) => {
    let t = 0;
    while (t < seconds) { frame(dt, true); t += dt; if (until && until(ctx)) break; }
    return t;
  };
  frame(0);
  document.getElementById('boot')?.remove();
  sim.ready = true;
  ctx.events.emit('ready');

  if (!params.test) {
    let last = performance.now();
    const loop = (now) => { const dt = (now - last) / 1000; last = now; try { frame(dt); } catch (e) { console.error(e); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}

boot().catch((e) => {
  console.error(e);
  sim.error = String(e?.stack || e);
  const el = document.getElementById('boot-status'); if (el) el.textContent = 'Failed to start: ' + (e?.message || e);
});
