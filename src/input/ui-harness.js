// Dev-only harness: the real input, HUD and menu modules on a fake ctx WITHOUT WebGL, so the phone / tablet layout
// can be checked in seconds instead of minutes (software GL). Not part of the main bundle.
//   node tools/build.mjs --entry src/input/ui-harness.js --out dist/ui.html
//   then open dist/ui.html?test=1&autostart=1&aircraft=f16&cam=chase  (same __sim API as main.js)
// The view is a flat sky / ground gradient; the aircraft state is a fixed cruise pose (or ?onground=1).
import * as THREE from 'three';
import { Events } from '../core/events.js';
import { createTime } from '../core/time.js';
import { createWeather } from '../core/weather.js';
import { createQuality } from '../core/quality.js';
import { createControls, createAircraftState } from '../core/state.js';
import { parseParams } from '../core/params.js';
import { AIRCRAFT } from '../aircraft/registry.js';
import { AIRPORTS, runwayEnd } from '../data/airports.js';
import { createInput } from './index.js';
import { createHud } from '../ui/hud/index.js';
import { createMenu } from '../ui/menu/index.js';

const sim = (window.__sim = { ready: false, error: null, ctx: null, step: null });

async function boot() {
  const params = parseParams();
  const view = document.getElementById('view');
  view.style.background = 'linear-gradient(#3b78c4 0%, #9cc3ea 52%, #6f8a4f 53%, #45603a 100%)';
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 600000);
  const ctx = {
    params, canvas: view, hudCanvas: document.getElementById('hud'), uiRoot: document.getElementById('ui'),
    camera, scene: new THREE.Scene(), events: new Events(), controls: createControls(),
    env: { sunDir: new THREE.Vector3(0.3, 0.8, 0.5).normalize(), moonDir: new THREE.Vector3(0, -1, 0), nightFactor: 0, exposure: 1 },
    world: { origin: new THREE.Vector3(), groundHeightAt: () => 0, terrainHeightAt: () => 0 },
    player: null,
    renderer: { info: { reset() {} } },
  };
  sim.ctx = ctx;
  ctx.time = createTime(ctx, params);
  ctx.weather = createWeather(ctx, params);
  ctx.quality = createQuality(ctx, params);
  const mode = { v: params.cam || 'chase' };
  ctx.cameraRig = {
    get mode() { return mode.v; }, get isInterior() { return mode.v === 'cockpit'; }, worldPosition: null,
    setMode(m) { if (m === mode.v) return; mode.v = m; ctx.events.emit('camera:mode', m); }, update() {},
  };
  ctx.audio = { resume() {}, setMasterVolume() {}, masterVolume: 0.8 };
  ctx.session = {
    active: false, options: {},
    start(opts = {}) {
      const def = AIRCRAFT.find((a) => a.id === (opts.aircraft || params.aircraft)) || AIRCRAFT[0];
      const airport = AIRPORTS.find((a) => a.id === (opts.airport || params.airport)) || AIRPORTS[0];
      const rw = airport.runways[opts.runway | 0] || airport.runways[0];
      const s = createAircraftState();
      const ground = params.raw.onground === '1' || opts.start === 'runway' || (!opts.start && params.start === 'runway');
      s.position.set(airport.position.x, ground ? 2 : 1500, airport.position.z + (ground ? 0 : 4000));
      s.altitude = s.position.y; s.agl = ground ? 0 : 1500; s.onGround = ground;
      s.tas = ground ? 0 : 160; s.ias = ground ? 0 : 150; s.mach = s.tas / 330; s.groundSpeed = s.tas; s.heading = 1.2; s.track = 1.2;
      s.pitch = ground ? 0 : 0.05; s.roll = ground ? 0 : 0.15; s.verticalSpeed = ground ? 0 : 2;
      s.velocity.set(Math.sin(1.2) * s.tas, 2, -Math.cos(1.2) * s.tas);
      s.throttle = ground ? 0 : 0.6; s.surfaces.gear = ground ? 1 : 0; s.fuel = 3000; s.fuelCapacity = 3200;
      s.engines = [{ running: true, n1: 0.82, n2: 0.9, egt: 600, fuelFlow: 1, afterburner: 0, thrust: 50000 }];
      ctx.controls.throttle = s.throttle;
      ctx.player = { id: def.id, def, state: s, sim: { step() {} }, visual: { liveries: [], livery: null }, airport, runway: runwayEnd(rw, opts.end | 0) };
      ctx.session.active = true; ctx.session.options = opts;
      ctx.events.emit('session:start', ctx.player);
      return ctx.player;
    },
    restart() { return ctx.session.start(ctx.session.options); },
    end() { ctx.session.active = false; ctx.player = null; ctx.events.emit('session:end', null); },
    update() {},
  };
  ctx.input = await createInput(ctx);
  ctx.hud = await createHud(ctx);
  ctx.menu = await createMenu(ctx);
  const resize = () => {
    const w = Math.max(2, innerWidth), h = Math.max(2, innerHeight);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    ctx.events.emit('resize', { width: w, height: h });
  };
  addEventListener('resize', resize); resize();
  ctx.events.on('cmd', ({ name }) => {
    if (name === 'pause') { ctx.time.paused = !ctx.time.paused; ctx.events.emit('pause', ctx.time.paused); }
    const s = ctx.player?.state; if (!s) return;
    if (name === 'gearToggle') s.surfaces.gear = s.surfaces.gear > 0.5 ? 0 : 1;
    if (name === 'flapsDown') s.surfaces.flaps = Math.min(1, s.surfaces.flaps + 0.25);
    if (name === 'flapsUp') s.surfaces.flaps = Math.max(0, s.surfaces.flaps - 0.25);
    if (name === 'apToggle') s.ap.engaged = !s.ap.engaged;
    if (name === 'cameraNext') ctx.cameraRig.setMode(ctx.cameraRig.mode === 'chase' ? 'cockpit' : 'chase');
  });
  function frame(dt) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    ctx.time.advance(dt);
    ctx.input.update(dt);
    const s = ctx.player?.state;
    if (s) {
      s.throttle = ctx.controls.throttle;
      // pose the camera along the aircraft for the conformal fighter HUD
      camera.position.set(0, s.position.y, 0);
      camera.rotation.set(s.pitch, -s.heading, -s.roll, 'YXZ');
      camera.updateMatrixWorld();
    }
    ctx.hud.update(ctx.time.dt);
    ctx.menu.update(ctx.time.dt);
  }
  if (params.autostart) ctx.session.start({ start: params.start });
  sim.step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) frame(dt); return ctx.time.frame; };
  frame(0);
  document.getElementById('boot')?.remove();
  sim.ready = true;
  ctx.events.emit('ready');
  if (!params.test) { let last = performance.now(); const loop = (now) => { frame((now - last) / 1000); last = now; requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
}
boot().catch((e) => { console.error(e); sim.error = String(e?.stack || e); });
