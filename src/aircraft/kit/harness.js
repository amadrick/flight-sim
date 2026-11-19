// Aircraft viewer harness — a light stand-alone entry for modelling work (no terrain, clouds or physics).
//
//   node tools/shot.mjs --entry src/aircraft/kit/harness.js --html dist/viewer.html --size 1200x675 --frames 3 \
//        --params "aircraft=f16&view=sheet&gear=1&flaps=1" --out shots/f16-sheet.png --eval "sim.stats"
//
// URL parameters
//   aircraft=<id>        registry id (default: first aircraft)        livery=<name>
//   view=quarter|side|top|front|rear|rearq|below|cockpit|sheet        (sheet = 6 views in one image)
//   views=a,b,c          custom sheet                                 cam=az,el,dist   tgt=x,y,z   fov=deg   (free camera;
//                        az 0 = from the nose, 90 = from the right wing, 180 = from the tail; dist in metres)
//   gear=0..1 flaps slats spoiler sb(speedbrake) hook canopy sweep rev(reverser) = 0..1
//   surf=-1..1           all primary surfaces together; or ail= elev= rud= individually;  tvc=-1..1 nozzle pitch
//   n1=0..1 ab=0..1 noz=0..1 (nozzle; defaults to ab)   steer=deg   comp=0..1 (strut compression; implies airborne = no ground query)
//   air=1                airborne (hides the ground)                  lights=1 (landing + taxi on)   night=0..1
//   dims=1               overlay reference boxes / points from geometry.js
//   sun=az,el            sun direction in degrees                     t=seconds (advance the lamp clock)   bg=studio|dark
//   quality=low|medium|high|ultra
import * as K from './index.js';
import { Pen } from './atlas.js';
import * as THREE from 'three';
import { AIRCRAFT, getAircraft } from '../registry.js';
import { createAircraftState } from '../../core/state.js';
import { SUN_ILLUMINANCE } from '../../core/constants.js';

const sim = (window.__sim = { ready: false, error: null, ctx: null, step: null });
const DEG = Math.PI / 180;

function boot() {
  const q = new URLSearchParams(location.search);
  const num = (k, d) => (q.has(k) && isFinite(+q.get(k)) ? +q.get(k) : d);
  const canvas = document.getElementById('view'), hudCanvas = document.getElementById('hud');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = num('exposure', 1);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 5000);
  camera.layers.enable(1);                                            // LAYERS.POST (glass)
  const night = num('night', 0), day = 1 - night;

  // ---- studio sky: gradient dome → PMREM environment ------------------------------------------------------------------
  const sunAz = (q.get('sun') || '-50,42').split(',').map(Number);
  const sunDir = new THREE.Vector3(Math.sin(sunAz[0] * DEG) * Math.cos(sunAz[1] * DEG), Math.sin(sunAz[1] * DEG), -Math.cos(sunAz[0] * DEG) * Math.cos(sunAz[1] * DEG)).normalize();
  const dark = q.get('bg') === 'dark';
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, toneMapped: false,
    uniforms: { uSun: { value: sunDir }, uDay: { value: day }, uDark: { value: dark ? 1 : 0 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vD; uniform vec3 uSun; uniform float uDay; uniform float uDark;
      void main(){ vec3 d = normalize(vD); float h = d.y;
        vec3 zen = vec3(0.16, 0.34, 0.78), hor = vec3(0.75, 0.86, 1.0), gnd = vec3(0.19, 0.185, 0.175);
        vec3 c = h > 0.0 ? mix(hor, zen, pow(h, 0.45)) : mix(hor * 0.55, gnd, smoothstep(0.0, 0.12, -h));
        c += vec3(1.0, 0.92, 0.8) * (pow(max(dot(d, uSun), 0.0), 600.0) * 30.0 + pow(max(dot(d, uSun), 0.0), 24.0) * 0.35);
        c *= mix(0.02, 1.0, uDay); if (uDark > 0.5) c = mix(c, vec3(dot(c, vec3(0.333))) * 0.35, 0.8);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const skyScene = new THREE.Scene(); skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(skyScene, 0, 1, 1000).texture;
  scene.environment = envTex; scene.background = envTex; scene.backgroundBlurriness = 0.0;
  const sun = new THREE.DirectionalLight(0xfff4e6, SUN_ILLUMINANCE * day);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // ---- mock ctx ---------------------------------------------------------------------------------------------------------
  const level = q.get('quality') || 'high';
  const ctx = {
    renderer, scene, camera, canvas, hudCanvas, params: { test: true, raw: Object.fromEntries(q) },
    quality: { level, anisotropy: 8, shadows: true },
    env: { sunDir, moonDir: sunDir.clone().negate(), sunColor: new THREE.Color(SUN_ILLUMINANCE * day, SUN_ILLUMINANCE * day, SUN_ILLUMINANCE * day), ambientSky: new THREE.Color(0.25 * day, 0.4 * day, 0.7 * day), ambientGround: new THREE.Color(0.1 * day, 0.09 * day, 0.08 * day), sunLight: sun, exposure: 1, nightFactor: night },
    world: { origin: new THREE.Vector3(), groundHeightAt: () => 0, groundAt: (x, z, out = {}) => { out.height = 0; out.type = 'runway'; return out; }, toRender: (w, out = new THREE.Vector3()) => out.copy(w), toWorld: (r, out = new THREE.Vector3()) => out.copy(r) },
    events: { on: () => () => {}, emit: () => {} }, time: { now: 0, dt: 0 }, uniforms: { frame: { uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) } } }, player: null,
  };
  sim.ctx = ctx;

  // ---- aircraft -----------------------------------------------------------------------------------------------------------
  const def = q.get('aircraft') ? getAircraft(q.get('aircraft')) : AIRCRAFT[0], g = def.geometry;
  if (q.get('prof') === '1') {                                        // prof=1: time spent in each pen method → sim.penProf
    const prof = (sim.penProf = {}), proto = Pen.prototype; let depth = 0;
    for (const k of Object.getOwnPropertyNames(proto)) if (k !== 'constructor' && k[0] !== '_' && k !== 'each' && typeof proto[k] === 'function') {
      const fn = proto[k];
      proto[k] = function (...a) { if (depth++) { try { return fn.apply(this, a); } finally { depth--; } } const t = performance.now(); try { return fn.apply(this, a); } finally { depth--; const e = (prof[k] = prof[k] || [0, 0]); e[0] += performance.now() - t; e[1]++; } };
    }
  }
  const t0 = performance.now();
  const visual = def.createVisual(ctx, { livery: q.get('livery') || undefined });
  const buildMs = performance.now() - t0;
  scene.add(visual.object3D);
  const airborne = q.get('air') === '1' || q.has('comp');
  const state = createAircraftState();
  state.position.set(0, g.cgHeight + (airborne ? 500 : 0), 0);
  const all = num('surf', 0), sf = state.surfaces;
  sf.aileronR = num('ail', all); sf.aileronL = -num('ail', all); sf.elevatorL = sf.elevatorR = num('elev', all); sf.rudder = num('rud', all);
  if (q.has('ailL')) sf.aileronL = num('ailL', 0);
  sf.flaps = num('flaps', 0); sf.slats = num('slats', sf.flaps > 0 ? 1 : 0); sf.spoilerL = sf.spoilerR = num('spoiler', 0); sf.speedbrake = num('sb', 0);
  sf.gear = num('gear', 1); sf.hook = num('hook', 0); sf.wingSweep = num('sweep', 0); sf.canopy = num('canopy', 0); sf.nozzlePitch = num('tvc', 0);
  const ab = num('ab', 0), n1 = num('n1', ab > 0 ? 1 : 0.3);
  state.engines = g.engines.map(() => ({ running: true, n1, n2: n1, thrust: 0, afterburner: ab, nozzle: num('noz', ab), fuelFlow: 0, egt: 500, reverser: num('rev', 0) }));
  const onGround = !airborne && sf.gear > 0.99;
  state.gear = g.gear.map((w) => ({ onGround, compression: num('comp', 0.35), wheelSpeed: 0, steer: w.steerable ? num('steer', 0) * DEG : 0, skid: 0 }));
  state.onGround = onGround; state.groundSpeed = num('gs', 0);
  if (q.get('lights') === '1') { state.lights.landing = true; state.lights.taxi = true; }
  if (q.get('lights') === '0') { state.lights.nav = state.lights.strobe = state.lights.beacon = false; }
  visual.object3D.position.copy(state.position); visual.object3D.quaternion.copy(state.quaternion);
  ctx.player = { id: def.id, def, state, visual };

  // ---- ground ----------------------------------------------------------------------------------------------------------------
  const size = Math.max(g.length, g.span);
  const gc = document.createElement('canvas'); gc.width = gc.height = 512;
  { const c = gc.getContext('2d'); c.fillStyle = '#8f9192'; c.fillRect(0, 0, 512, 512); c.strokeStyle = 'rgba(40,44,48,0.5)'; c.lineWidth = 1; for (let i = 0; i <= 5; i++) { c.beginPath(); c.moveTo(i * 102.4, 0); c.lineTo(i * 102.4, 512); c.moveTo(0, i * 102.4); c.lineTo(512, i * 102.4); c.stroke(); } c.lineWidth = 4; c.strokeRect(0, 0, 512, 512); }
  const gt = new THREE.CanvasTexture(gc); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(80, 80); gt.colorSpace = THREE.SRGBColorSpace; gt.anisotropy = 8;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: gt, roughness: 0.92, metalness: 0, envMapIntensity: 0.6 }));   // one tile = 5 m, one cell = 1 m
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.visible = !airborne && q.get('ground') !== '0';
  scene.add(ground);
  const centre = new THREE.Vector3(0, state.position.y - g.cgHeight + g.height * 0.45, (g.noseZ + g.tailZ) / 2);
  sun.target.position.copy(centre); sun.position.copy(centre).addScaledVector(sunDir, size * 3);
  const sc = sun.shadow.camera; sc.left = sc.bottom = -size * 0.75; sc.right = sc.top = size * 0.75; sc.near = size; sc.far = size * 5; sc.updateProjectionMatrix();

  // ---- reference overlay -----------------------------------------------------------------------------------------------------
  if (q.get('dims') === '1') {
    const y0 = state.position.y - g.cgHeight;
    const boxHelper = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-g.span / 2, y0, g.noseZ), new THREE.Vector3(g.span / 2, y0 + g.height, g.tailZ)), 0xffd400);
    scene.add(boxHelper);
    const mark = (p, color, s = size * 0.012) => { const m = new THREE.Mesh(new THREE.OctahedronGeometry(s), new THREE.MeshBasicMaterial({ color, toneMapped: false, depthTest: false })); m.position.set(p[0], p[1] + state.position.y, p[2]); m.renderOrder = 99; scene.add(m); };
    for (const w of g.gear) mark(w.pos, 0xff3030);
    mark(g.pilotEye, 0x30ff60); for (const e of g.engines) { mark(e.nozzle, 0xff9020); mark(e.intake, 0x30a0ff); }
    for (const t of g.wingtips || []) mark(t, 0xffffff); for (const k in g.lights || {}) mark(g.lights[k], 0xff40ff, size * 0.007);
  }

  // ---- cameras ---------------------------------------------------------------------------------------------------------------
  const VIEWS = {
    quarter: { az: 38, el: 16, d: 1.55, fov: 30 }, side: { az: 270, el: 1.5, d: 1.75, fov: 26 }, top: { az: 0, el: 89.9, d: 1.9, fov: 26 }, front: { az: 0, el: 3, d: 1.7, fov: 26 },
    rear: { az: 180, el: 6, d: 1.7, fov: 26 }, rearq: { az: 148, el: 14, d: 1.55, fov: 30 }, below: { az: 35, el: -38, d: 1.6, fov: 30, noGround: true }, sider: { az: 90, el: 1.5, d: 1.75, fov: 26 },
    bottom: { az: 0, el: -89.9, d: 1.9, fov: 26, noGround: true }, cockpit: { cockpit: true, fov: 75 }, noseq: { az: 25, el: 8, d: 0.75, fov: 30, tz: -0.28 }, tailq: { az: 155, el: 10, d: 0.8, fov: 30, tz: 0.3 },
  };
  {                                                                   // close-up views derived from geometry.js (photorealism review)
    const e = g.pilotEye, gm = (g.gear[1] || g.gear[0]), gn = g.gear[0], en = g.engines[0] || { nozzle: [0, 0, g.tailZ], nozzleRadius: 0.5 }, y0 = state.position.y;
    const nl = Math.abs(e[2] - g.noseZ);
    VIEWS.cnose = { az: 52, el: 10, dist: Math.max(4, nl * 2.3), fov: 30, tgt: [0, e[1] - 0.35 + y0, (g.noseZ + e[2]) / 2] };
    VIEWS.ccanopy = { az: 292, el: 12, dist: Math.max(3.2, nl * 1.1), fov: 30, tgt: [e[0], e[1] - 0.1 + y0, e[2] + 0.3] };
    VIEWS.croot = { az: 62, el: 24, dist: Math.max(5, g.length * 0.3), fov: 30, tgt: [g.span * 0.11, y0 + 0.1, (g.noseZ + g.tailZ) / 2 * 0.3] };
    VIEWS.cgear = { az: 305, el: 3, dist: Math.max(3.5, g.cgHeight * 3.2), fov: 30, tgt: [gm.pos[0] * 0.6, gm.pos[1] + y0 + g.cgHeight * 0.45, (gm.pos[2] * 2 + gn.pos[2]) / 3] };
    VIEWS.cwheel = { az: 252, el: 5, dist: Math.max(1.3, gm.wheelRadius * 5.2), fov: 30, tgt: [gm.pos[0], gm.pos[1] + y0 + gm.wheelRadius * 1.15, gm.pos[2]] };
    VIEWS.cnwheel = { az: 300, el: 5, dist: Math.max(1.2, gn.wheelRadius * 6), fov: 30, tgt: [gn.pos[0], gn.pos[1] + y0 + gn.wheelRadius * 1.3, gn.pos[2]] };
    VIEWS.ccrew = { az: 298, el: 9, dist: 2.3, fov: 30, tgt: [e[0], e[1] - 0.28 + y0, e[2] - 0.05] };
    VIEWS.cwell = { az: 262, el: -28, dist: Math.max(2.2, gm.wheelRadius * 7), fov: 34, noGround: true, tgt: [gm.pos[0] * 0.8, y0 - g.cgHeight * 0.25, gm.pos[2]] };
    VIEWS.cnoz = { az: 158, el: 10, dist: Math.max(3, (en.nozzleRadius || 0.5) * 9), fov: 30, tgt: [en.nozzle[0] * 0.8, en.nozzle[1] + y0, en.nozzle[2] - 0.5] };
    VIEWS.cwing = { az: 300, el: 32, dist: Math.max(4, g.span * 0.22), fov: 30, tgt: [-g.span * 0.27, y0 + 0.2, (g.noseZ + g.tailZ) / 2 * 0.3 + g.length * 0.05] };
  }
  function placeCamera(name, aspect) {
    let v = VIEWS[name] || VIEWS.quarter;
    if (q.has('cam') && !q.has('views') && q.get('view') !== 'sheet') { const c = q.get('cam').split(',').map(Number); v = { az: c[0], el: c[1], dist: c[2], fov: num('fov', 30), noGround: c[1] < 0 }; }
    camera.aspect = aspect; camera.fov = num('fov', v.fov);
    if (v.cockpit) {
      camera.near = num('near', 0.5); camera.position.set(g.pilotEye[0], g.pilotEye[1] + state.position.y, g.pilotEye[2]);
      const look = (q.get('look') || '0,-6').split(',').map(Number);
      camera.rotation.set(look[1] * DEG, -look[0] * DEG, 0, 'YXZ');
    } else {
      camera.near = 0.5;
      const tgt = centre.clone(); if (v.tz) tgt.z += v.tz * g.length; if (v.tgt) tgt.fromArray(v.tgt);
      if (q.has('tgt')) { const t = q.get('tgt').split(',').map(Number); tgt.set(t[0], t[1] + state.position.y, t[2]); }
      const fit = Math.max(size, 2.2 * g.height) / (2 * Math.tan(camera.fov * DEG / 2));
      const dist = v.dist ?? v.d * fit * Math.max(1, 1.6 / aspect) * 0.62;
      const az = v.az * DEG, el = v.el * DEG;
      camera.position.set(tgt.x + Math.sin(az) * Math.cos(el) * dist, tgt.y + Math.sin(el) * dist, tgt.z - Math.cos(az) * Math.cos(el) * dist);
      camera.up.set(0, 1, 0); if (Math.abs(v.el) > 85) camera.up.set(0, 0, v.el > 0 ? -1 : 1);
      camera.lookAt(tgt);
    }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    ground.visible = !airborne && q.get('ground') !== '0' && !v.noGround && camera.position.y > 0.05;
  }
  const viewParam = q.get('view') || 'quarter';
  const list = q.has('views') ? q.get('views').split(',') : viewParam === 'sheet' ? ['quarter', 'side', 'top', 'front', 'rearq', 'below'] : viewParam === 'closeups' ? ['cnose', 'croot', 'cgear', 'cnoz'] : [viewParam];
  const hud = hudCanvas.getContext('2d'), _invRoot = new THREE.Matrix4(), _eyeV = new THREE.Vector3();
  function render() {
    const W = window.innerWidth, H = window.innerHeight;
    renderer.setSize(W, H, false); hudCanvas.width = W; hudCanvas.height = H; hud.clearRect(0, 0, W, H);
    const cols = list.length > 4 ? 3 : list.length > 1 ? 2 : 1, rows = Math.ceil(list.length / cols);
    renderer.setScissorTest(true); renderer.info.reset();
    list.forEach((name, i) => {
      const cw = Math.floor(W / cols), chh = Math.floor(H / rows), cx = (i % cols) * cw, cy = Math.floor(i / cols) * chh;
      renderer.setViewport(cx, H - cy - chh, cw, chh); renderer.setScissor(cx, H - cy - chh, cw, chh);
      placeCamera(name, cw / chh);
      if (list.length > 1 && visual.rig) {                            // per-view cockpit state (pilot hidden only in the eye-point view of a sheet)
        const R = visual.rig; R.root.updateMatrixWorld(); camera.updateMatrixWorld();
        R.cameraBody.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_invRoot.copy(R.root.matrixWorld).invert());
        const was = R.cameraInCockpit; R.cameraInCockpit = R.cameraBody.distanceTo(_eyeV.fromArray(g.pilotEye || [0, 0, 0])) < 0.75;
        if (was !== R.cameraInCockpit) visual.update(state, 0);
      }
      renderer.render(scene, camera);
      if (list.length > 1) { hud.fillStyle = 'rgba(0,0,0,0.55)'; hud.fillRect(cx + 4, cy + 4, hud.measureText(name).width + 10, 16); hud.fillStyle = '#ffd400'; hud.font = '11px monospace'; hud.fillText(name, cx + 9, cy + 16); }
    });
    renderer.setScissorTest(false);
    const st = visual.stats || {};
    hud.font = '11px monospace'; const txt = `${def.id}  tris ${st.triangles ?? '?'}  draws ${st.drawCalls ?? '?'}  build ${Math.round(buildMs)} ms`;
    hud.fillStyle = 'rgba(0,0,0,0.55)'; hud.fillRect(4, H - 20, hud.measureText(txt).width + 10, 16); hud.fillStyle = '#e6edf3'; hud.fillText(txt, 9, H - 8);
    if (q.has('atlas')) {                                             // debug: show an atlas layer (atlas=color|orm|height|emis, atlasN=index)
      const at = (visual.rig?.disposables || []).filter(d => d && d.layers)[num('atlasN', 0)], L = at && at.layers[q.get('atlas')];
      if (L) { const s = Math.min(W, H); hud.fillStyle = '#000'; hud.fillRect(0, 0, W, H); hud.drawImage(L.canvas, 0, 0, s, s); for (const c of Object.values(at.charts || {})) { hud.fillStyle = '#ff0'; hud.font = '10px monospace'; const r = c.rect || c.strips?.[0]?.rect; if (r) hud.fillText(c.name, r.x / at.size * s + 2, r.y / at.size * s + 10); } }
    }
  }
  renderer.info.autoReset = false;
  let clock = num('t', 0);
  visual.update(state, clock);                                      // advance the lamp clock to t
  sim.visual = visual; sim.state = state; sim.def = def; sim.K = K;
  sim.stats = { ...(visual.stats || {}), buildMs: Math.round(buildMs) };
  sim.step = (n = 1, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) { ctx.time.now += dt; ctx.time.dt = dt; visual.update(state, dt); render(); }
    sim.stats.rendererCalls = renderer.info.render.calls / list.length; sim.stats.rendererTriangles = renderer.info.render.triangles / list.length;
    return ctx.time.now;
  };
  window.addEventListener('resize', render);
  sim.step(1, 0);
  document.getElementById('boot')?.remove();
  sim.ready = true;
  if (q.get('test') !== '1') {                                       // interactive: slow orbit + live surface animation
    let az = 38, last = performance.now();
    const loop = (now) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; az += dt * 12; if (list.length === 1 && !q.has('view')) { VIEWS.quarter.az = az; } ctx.time.now += dt; visual.update(state, dt); render(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
try { boot(); } catch (e) { console.error(e); sim.error = String(e?.stack || e); }
