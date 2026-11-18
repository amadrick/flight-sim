// Builds ctx — the single object handed to every module. Owned by the integrator.
import * as THREE from 'three';
import { Events } from './events.js';
import { createWorld } from './world.js';
import { createWeather } from './weather.js';
import { createTime } from './time.js';
import { createQuality } from './quality.js';
import { createControls } from './state.js';
import { createFrameUniforms } from './glsl.js';
import { makeRng } from './math.js';
import { SUN_ILLUMINANCE } from './constants.js';

export function createContext({ canvas, hudCanvas, uiRoot, params }) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false, depth: false, stencil: false,
    powerPreference: 'high-performance', reversedDepthBuffer: true,
  });
  renderer.setPixelRatio(1);                      // the pipeline owns resolution (ctx.quality.renderScale × devicePixelRatio)
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;     // the pipeline tone-maps in its final pass
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 600000);
  camera.layers.enable(0);

  const ctx = {
    params, canvas, hudCanvas, uiRoot,
    renderer, scene, camera,
    events: new Events(),
    rng: makeRng(params.seed),
    uniforms: { frame: createFrameUniforms() },
    controls: createControls(),
    // Environment lighting, written by core/time (directions) and the render pipeline (colours):
    env: {
      sunDir: new THREE.Vector3(0.3, 0.8, 0.5).normalize(),   // unit, TOWARD the sun, world == render axes
      moonDir: new THREE.Vector3(-0.3, -0.8, -0.5).normalize(),
      sunColor: new THREE.Color(SUN_ILLUMINANCE, SUN_ILLUMINANCE, SUN_ILLUMINANCE), // direct sun irradiance at the camera, after the atmosphere
      ambientSky: new THREE.Color(0.25, 0.4, 0.7),
      ambientGround: new THREE.Color(0.1, 0.09, 0.08),
      sunLight: null,        // THREE.DirectionalLight owned by the pipeline
      exposure: 1,
      nightFactor: 0,        // 0 day .. 1 full night (pipeline writes; lights/emissives read)
    },
    player: null,            // { id, def, sim, state, visual } — set by ctx.session.start()
    // modules (filled in main.js): pipeline, terrain, water, scenery, clouds, input, cameraRig, effects, audio, hud, menu, session
  };
  ctx.world = createWorld(ctx);
  ctx.time = createTime(ctx, params);
  ctx.weather = createWeather(ctx, params);
  ctx.quality = createQuality(ctx, params);
  return ctx;
}

/** Refresh the shared per-frame uniforms. Called by main right before the pipeline renders. */
const _vp = new THREE.Matrix4(), _shift = new THREE.Matrix4();
let _prevVP = null, _pendingShift = null;
export function attachFrameUniformUpdater(ctx) {
  ctx.events.on('originShift', ({ delta }) => { _pendingShift = (_pendingShift || new THREE.Vector3()).add(delta); });
  return function updateFrameUniforms() {
    const u = ctx.uniforms.frame, cam = ctx.camera;
    cam.updateMatrixWorld(true);
    u.uTime.value = ctx.time.now;
    u.uFrame.value = ctx.time.frame;
    u.uOrigin.value.copy(ctx.world.origin);
    u.uCameraPos.value.setFromMatrixPosition(cam.matrixWorld);
    u.uCameraWorld.value.copy(cam.matrixWorld);
    u.uViewMatrix.value.copy(cam.matrixWorldInverse);
    u.uProjMatrix.value.copy(cam.projectionMatrix);
    u.uProjInverse.value.copy(cam.projectionMatrixInverse);
    u.uNearFar.value.set(cam.near, cam.far);
    u.uSunDir.value.copy(ctx.env.sunDir);
    u.uMoonDir.value.copy(ctx.env.moonDir);
    u.uSunColor.value.copy(ctx.env.sunColor);
    u.uAmbientSky.value.copy(ctx.env.ambientSky);
    u.uAmbientGround.value.copy(ctx.env.ambientGround);
    u.uDepthReversed.value = ctx.renderer.capabilities.reversedDepthBuffer ? 1 : 0;
    // previous view-projection, expressed in the CURRENT render space (so reprojection survives origin shifts)
    if (_prevVP) {
      u.uPrevViewProj.value.copy(_prevVP);
      if (_pendingShift) { _shift.makeTranslation(_pendingShift.x, 0, _pendingShift.z); u.uPrevViewProj.value.multiply(_shift); }
    } else u.uPrevViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _pendingShift = null;
    _vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _prevVP = (_prevVP || new THREE.Matrix4()).copy(_vp);
  };
}
