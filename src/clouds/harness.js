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
import { FULLSCREEN_VERT, FullscreenPass, FRAME_UNIFORMS_GLSL, DEPTH_GLSL } from '../core/glsl.js';
import { CLOUD_DENSITY_GLSL } from './shaders.js';
import { createNeuralCloudScatter, createNeuralCloudScatter4 } from '../neural/cloud-scatter.js';

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
  // cloud lighting as in main.js: the neural model unless scatter=classic
  if (raw.scatter !== 'classic') {
    const s3 = createNeuralCloudScatter({ phaseMax: 20 });
    const s4 = raw.scatter === 'neural3' ? null : createNeuralCloudScatter4({ phaseMax: 20 });
    ctx.clouds.setScatterModel(s4 ? { glsl: s3.glsl + '\n' + s4.glsl, uniforms: { ...s3.uniforms, ...s4.uniforms } } : { glsl: s3.glsl, uniforms: s3.uniforms });
  }
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
    uniforms: { tex: { value: null }, tex3: { value: null }, uMode: { value: 0 }, uLod: { value: num('lod', 0) } }, vertexShader: FULLSCREEN_VERT,
    fragmentShader: `precision highp float; precision highp sampler3D; in vec2 vUv; out vec4 o; uniform sampler2D tex; uniform sampler3D tex3; uniform float uMode, uLod;
      void main() { vec4 c = texture(tex, vUv);
        if (uMode > 2.5) { vec4 v = textureLod(tex3, vec3(vUv * vec2(1.7778, 1.0), 0.3), uLod); o = vec4(vUv.x < 0.5 ? v.rrr : (vUv.y < 0.5 ? v.ggg : v.bbb), 1.0); }
        else if (uMode < 0.5) o = vec4(c.rgb, 1.0);
        else if (uMode < 1.5) o = vec4(1.0 - exp(-c.r * 0.2), c.g, c.b * 3.0, 1.0);
        else o = vec4(pow(c.rgb / (1.0 + c.rgb), vec3(0.45)) * (1.0 - c.a) + vec3(0.0, 0.0, 0.3) * c.a, 1.0); }`,
  })) : null;

  // harness composite (replaces the stub pipeline's final image): adds cloud shadows on the terrain and an exposure control
  const comp = new FullscreenPass(new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: { ...ctx.uniforms.frame, ...ctx.pipeline.atmosphere.uniforms, ...ctx.clouds.shadowUniforms,
      tScene: { value: ctx.pipeline.sceneTarget.texture }, tClouds: { value: null }, uExposure: { value: num('exp', 0.7) }, uNoClouds: { value: raw.noclouds === '1' ? 1 : 0 } },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: `precision highp float; in vec2 vUv; out vec4 outColor;
      uniform sampler2D tScene, tClouds; uniform float uExposure, uNoClouds;
      ${FRAME_UNIFORMS_GLSL} ${DEPTH_GLSL} ${ctx.pipeline.atmosphere.glsl} ${ctx.clouds.shadowGLSL}
      vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      void main() {
        float d = sceneDepthRaw(vUv); vec3 col;
        if (depthIsSky(d)) { vec3 dir = viewRay(vUv); col = atmSkyRadiance(dir) + uSunColor * 40.0 * smoothstep(0.99996, 0.99999, dot(dir, uSunDir)); }
        else { vec3 rp = renderPosFromDepth(vUv, d); col = texture(tScene, vUv).rgb * mix(0.25 * cloudDiffuseTransmittance(rp) + 0.1, 1.0, cloudShadow(rp));
          vec4 ap = atmAerialPerspective(rp); col = col * ap.a + ap.rgb; }
        if (uNoClouds < 0.5) { vec4 c = texture(tClouds, vUv); col = col * c.a + c.rgb; }
        outColor = vec4(pow(aces(col * uExposure), vec3(1.0 / 2.2)), 1.0);
      }`,
  }));

  // standoff=D: march the view direction (CPU density mirror) and move the camera so the first cloud along it sits
  // D metres ahead (reproducible "cloud at 2 km" / "turret at 200 m" views); standoffMin skips clouds nearer than that
  // and aimUp=1 tilts the camera to the cloud's mid-height
  function standoff(D) {
    const dir = ctx.camera.getWorldDirection(new THREE.Vector3()), p = new THREE.Vector3();
    dir.y = 0; dir.normalize();
    const y = camPos.y, tMin = num('standoffMin', 0);
    // (the first cloud whose D metres in front are clear air, so the camera never starts inside a cloud; the CPU
    //  mirror has no detail erosion, so 25 % extra clearance)
    let clearFrom = tMin;
    for (let t = tMin; t < 60000; t += 20) {
      p.set(camPos.x + dir.x * t, y, camPos.z + dir.z * t);
      const d = ctx.clouds.densityAt(p);
      if (d > num('standoffD', 0.2) && t - clearFrom >= D * 1.25) {
        camPos.addScaledVector(dir, t - D);
        sim.standoff = { t, D, x: camPos.x, z: camPos.z };
        return;
      }
      if (d > 0) clearFrom = t;
    }
    sim.standoff = { miss: true };
  }
  const wxSwitch = raw.wx, wxAt = num('wxAt', 3), flashAt = num('flashAt', -1);
  sim.lightning = [];
  ctx.events.on('lightning', (e) => sim.lightning.push({ x: e.worldPos.x, y: e.worldPos.y, z: e.worldPos.z, intensity: e.intensity, frame: ctx.time.frame }));
  function frame(realDt) {
    realDt = Math.min(Math.max(realDt, 0), 0.1);
    ctx.renderer.info.reset();
    ctx.time.advance(realDt);
    const dt = ctx.time.dt;
    if (wxSwitch && ctx.time.frame === wxAt) ctx.weather.setPreset(wxSwitch, raw.wxInstant === '1');
    if (raw.standoff && !tour && ctx.time.frame === num('standoffAt', 2)) standoff(+raw.standoff);
    if (ctx.time.frame === flashAt) {
      const f = ctx.camera.getWorldDirection(new THREE.Vector3()), r = num('flashDist', 9000);
      ctx.clouds.debug.spawnFlash(ctx.world.origin.x + ctx.camera.position.x + f.x * r, ctx.world.origin.z + ctx.camera.position.z + f.z * r);
    }
    ctx.weather.update(dt);
    ctx.session.update(dt);
    ctx.cameraRig.update(realDt);
    updateFrameUniforms();
    ctx.terrain.update?.(dt);
    ctx.clouds.update(dt);
    // the stub pipeline keeps its ambient constant at night; dim it like a real one would (so moonlight can be judged)
    const day = THREE.MathUtils.smoothstep(ctx.env.sunDir.y, -0.12, 0.1);
    ctx.env.ambientSky.setRGB(0.25, 0.4, 0.7).multiplyScalar(Math.max(day, 0.004)); ctx.env.ambientGround.setRGB(0.1, 0.09, 0.08).multiplyScalar(Math.max(day, 0.004));
    ctx.uniforms.frame.uAmbientSky.value.copy(ctx.env.ambientSky); ctx.uniforms.frame.uAmbientGround.value.copy(ctx.env.ambientGround);
    ctx.pipeline.render(dt);
    comp.material.uniforms.tClouds.value = ctx.clouds.texture; comp.render(ctx.renderer, null);
    if (view === 'slice') drawSlice();
    else if (viewPass) {
      const d = ctx.clouds.debug;
      const t = view === 'cirrus' ? d.cirrusRT.texture : view === 'weather' ? d.weatherRT.texture : view === 'shadow' ? d.shadowRT.texture : view === 'march' ? d.marchRT.textures[0] : ctx.clouds.texture;
      viewPass.material.uniforms.tex.value = t;
      viewPass.material.uniforms.uMode.value = (view === 'weather' || view === 'cirrus') ? 0 : view === 'shadow' ? 1 : (view === 'base' || view === 'detail' || view === 'bubble') ? 3 : 2;
      viewPass.material.uniforms.tex3.value = view === 'detail' ? d.noise3.detail : view === 'bubble' ? d.noise3.bubble : d.noise3.base;
      viewPass.render(ctx.renderer, null);
    }
  }
  // view=slice: vertical cross-section of the full density along the view direction (slT0 = start distance, slW = width,
  // m), from the condensation level up; red = shape excess > 0 (un-eroded envelope), white = eroded density
  let slicePass = null;
  function drawSlice() {
    const U = ctx.clouds.debug.U, L = U.uClLayer.value;
    if (!slicePass) slicePass = new FullscreenPass(new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
      uniforms: { ...U, uSl: { value: new THREE.Vector4() }, uSl2: { value: new THREE.Vector4() } }, vertexShader: FULLSCREEN_VERT,
      fragmentShader: `precision highp float; precision highp int; precision highp sampler3D; in vec2 vUv; out vec4 o;
        ${raw.slDbg === '1' ? '#define SL_DBG 1' : ''}
        ${CLOUD_DENSITY_GLSL}
        uniform vec4 uSl, uSl2;
        void main() {
          float t = uSl2.x + vUv.x * uSl2.y, y = uSl2.z + vUv.y * uSl2.w;
          vec3 pa = vec3(uSl.x + uSl.z * t, y, uSl.y + uSl.w * t); vec4 info;
          float ex = clShape(pa, clWeather(pa.xz, 0.0), 0.0, info);
          float d = ex > -0.6 ? clDensityFull(pa, ex, info, 2.0, 0.004) : 0.0;
          o = vec4(mix(vec3(ex > 0.0 ? 0.35 : 0.0, 0.0, 0.08), vec3(1.0), d), 1.0);
          #ifdef SL_DBG
          float cv; float bd = clBubbles(pa, 3.0, cv);
          o = vec4(clThermal / 2000.0, 0.5 + bd * 3.0, ex > 0.0 ? 1.0 : 0.0, 1.0);
          #endif
        }` }));
    const dir = ctx.camera.getWorldDirection(new THREE.Vector3()); dir.y = 0; dir.normalize();
    const ax = ctx.world.origin.x + ctx.camera.position.x - ctx.clouds.windOffset.x, az = ctx.world.origin.z + ctx.camera.position.z - ctx.clouds.windOffset.y;
    // (in a tour only the top-left tile of the canvas is kept: scale the section so the tile shows slW x its aspect)
    const tW = tw || window.innerWidth, tH = th || window.innerHeight;
    const w = num('slW', 2400), hgt = w * tH / tW, sx = window.innerWidth / tW, sy = window.innerHeight / tH;
    slicePass.material.uniforms.uSl.value.set(ax, az, dir.x, dir.z);
    slicePass.material.uniforms.uSl2.value.set(num('slT0', 0), w * sx, L.x - 0.05 * hgt, hgt * sy);
    slicePass.render(ctx.renderer, null);
  }
  sim.exportDensity = (opts) => exportDensity(ctx, opts);
  // round seven: the linear cloud output (premultiplied radiance, transmittance) of the last frame as base64 float32, and
  // the camera / sun / layer state, for the reference comparison (tools/neural/clouds/game_compare.py)
  sim.readClouds = () => {
    const rt = ctx.clouds.debug.outRT, w = rt.width, h = rt.height, px = new Float32Array(w * h * 4);
    ctx.renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    let s = ''; const u8 = new Uint8Array(px.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    const c = ctx.camera, U = ctx.clouds.debug.U;
    return { w, h, px: btoa(s), fov: c.fov, aspect: c.aspect, quat: c.quaternion.toArray(),
      camAir: [ctx.world.origin.x + c.position.x - ctx.clouds.windOffset.x, c.position.y, ctx.world.origin.z + c.position.z - ctx.clouds.windOffset.y],
      sun: U.uClLightDir.value.toArray(), layer: U.uClLayer.value.toArray() };
  };
  if (useAircraft) ctx.session.start({});
  // Tour: several views in one run, tiled into one screenshot (software GL + a shared render queue make single
  // shots expensive):  tour=weather:scattered,tod:12,cy:2000,yaw:0|tod:17.5,clCav:0|...  tiles=3x2  tourFrames=20
  // Keys: cx cy cz yaw pitch fov weather tod exp, anything else is set as a (per-frame) debug parameter for that view.
  const tour = raw.tour ? raw.tour.split('|').map((v) => Object.fromEntries(v.split(',').filter(Boolean).map((kv) => kv.split(':')))) : null;
  let tourK = 0, tile2d = null, tw = 0, th = 0, cols = 1, rows = 1, tourMs = 0;
  sim.tour = [];
  const tourFrames = num('tourFrames', 20), raw0 = { ...raw };
  function tourStep(dt) {
    const vi = Math.floor(tourK / tourFrames);
    if (vi >= tour.length) return;
    if (tourK === 0) {
      [cols, rows] = (raw.tiles || `${Math.ceil(Math.sqrt(tour.length))}x${Math.ceil(tour.length / Math.ceil(Math.sqrt(tour.length)))}`).split('x').map(Number);
      tw = Math.floor(window.innerWidth / cols); th = Math.floor(window.innerHeight / rows);
      window.removeEventListener('resize', resize);
      ctx.camera.aspect = tw / th; ctx.camera.updateProjectionMatrix(); ctx.pipeline.setSize(tw, th, 1);
      const c = document.createElement('canvas'); c.width = window.innerWidth; c.height = window.innerHeight;
      c.style.cssText = 'position:fixed;left:0;top:0;z-index:99999'; document.body.appendChild(c); tile2d = c.getContext('2d');
      tile2d.fillStyle = '#000'; tile2d.fillRect(0, 0, c.width, c.height);
    }
    if (tourK % tourFrames === 0) {
      const v = tour[vi];
      for (const k in raw) if (!(k in raw0)) delete raw[k];
      Object.assign(raw, raw0);
      for (const k in v) {
        const x = +v[k];
        if (k === 'cx') camPos.x = x; else if (k === 'cy') camPos.y = x; else if (k === 'cz') camPos.z = x;
        else if (k === 'yaw') yaw = x; else if (k === 'pitch') pitch = x;
        else if (k === 'fov') { ctx.camera.fov = x; ctx.camera.updateProjectionMatrix(); }
        else if (k === 'weather') ctx.weather.setPreset(v[k], true);
        else if (k === 'tod') ctx.time.setTimeOfDay(x);
        else if (k === 'exp') comp.material.uniforms.uExposure.value = x;
        else raw[k] = v[k];
      }
      ctx.events.emit('weather:change', { preset: ctx.weather.preset, instant: true });
    }
    if (tourK % tourFrames === 2 && raw.standoff) standoff(+raw.standoff);
    const tf0 = performance.now();
    frame(dt);
    if (tourK % tourFrames >= 2) tourMs += performance.now() - tf0;      // (the first frames re-bake the maps)
    if (tourK % tourFrames === tourFrames - 1) {
      // cost of this view: wall time per frame and the march's own counter (loop iterations per ray, or lit samples
      // per ray with clCount=1), read back from the aux target
      const rt = ctx.clouds.debug.marchRT, buf = new Uint16Array(rt.width * rt.height * 4);
      ctx.renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf, undefined, 1);
      let sum = 0, mx = 0;
      for (let i = 3; i < buf.length; i += 4) { const v = THREE.DataUtils.fromHalfFloat(buf[i]); sum += v; mx = Math.max(mx, v); }
      sim.tour.push({ view: raw.tour.split('|')[vi], msPerFrame: tourMs / (tourFrames - 2), count: sum / (rt.width * rt.height), max: mx });
      tourMs = 0;
      const x = (vi % cols) * tw, y = Math.floor(vi / cols) * th;
      tile2d.drawImage(ctx.renderer.domElement, 0, 0, tw, th, x, y, tw, th);
      tile2d.font = '11px monospace'; tile2d.fillStyle = '#000'; tile2d.fillText(raw.tour.split('|')[vi].slice(0, Math.floor(tw / 7)), x + 5, y + 13);
      tile2d.fillStyle = '#ff0'; tile2d.fillText(raw.tour.split('|')[vi].slice(0, Math.floor(tw / 7)), x + 4, y + 12);
    }
    tourK++;
  }
  sim.step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { if (tour) tourStep(dt); else frame(dt); } return ctx.time.frame; };
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

// ------------------------------------------------------------------------------------------------ density export
// Ground-truth comparison (tools/neural/gt_*.py): sample the REAL density GLSL of the march (same noise volumes, weather
// map and uniforms) on a regular grid and return it as base64 so a path tracer can render the identical clouds.
//   sim.exportDensity({ size: 5760, nxy: 192, find: 1 })  (after a few frames so the weather map is baked)
// Returns JSON { nx, ny, nz, dx, dz, x0, z0, base, top, sigma, full, base8, top2d } in air-mass metres; `full` = uint8
// density with detail erosion (lod 0, march edge width at ~1-3 km), `base8` = cheap base density at lod 1 (what the
// light march sees, before its 0.8 factor), both already multiplied by info.w; `ex8` = shape excess (clShape, before erosion) as (ex + 0.5) * 127.5; `top2d` = info.y per column (uint16 m).
// Round four: `depth` limits the box to base .. base + depth; `detail: 1` adds surf8 = (depth below the eroded surface (km) + 0.1) * 510
// and cav8 = crease pattern * 255 (the side outputs of clDensityFull the lighting uses) and leaves out base8.
function exportDensity(ctx, { size = 5760, nxy = 192, find = 1, cx, cz, edge = 0.03, fp, depth, detail = 0 } = {}) {
  const r = ctx.renderer, U = ctx.clouds.debug.U, P = ctx.clouds.params;
  const L = U.uClLayer.value, base = L.x, th = Math.min(L.w, depth || 1e9), top = base + th;
  const nz = Math.ceil(th / (size / nxy));
  const frag = `precision highp float; precision highp int; precision highp sampler3D;
    in vec2 vUv; layout(location = 0) out vec4 o;
    ${CLOUD_DENSITY_GLSL}
    uniform vec4 uEx;   // xy = corner (air-mass m), z = extent (m), w = altitude (m) or < -1e5 for column mode
    uniform float uEdge, uFp, uSide;
    void main() {
      vec2 xz = uEx.xy + vUv * uEx.z;
      if (uEx.w < -1e5) {           // column optical depth (base density) for picking a window
        float tau = 0.0;
        for (int i = 0; i < 32; i++) {
          float y = uClLayer.x + (float(i) + 0.5) / 32.0 * uClLayer.w; vec3 pa = vec3(xz.x, y, xz.y); vec4 info;
          tau += clDensityBase(pa, clWeather(pa.xz, 0.0), 1.0, info) * info.w * uClLayer.w / 32.0 * uClNoise.w;
        }
        o = vec4(tau, 0.0, 0.0, 1.0); return;
      }
      vec3 pa = vec3(xz.x, uEx.w, xz.y); vec4 wx = clWeather(pa.xz, 0.0), info, info1;
      float ex = clShape(pa, wx, 0.0, info);
      float d = (uSide > 0.5 || ex + CL_EROSION_LO * CL_EROSION_MAXK * uClNoise.z > 0.0) ? clDensityFull(pa, ex, info, uFp, uEdge) * info.w : 0.0;
      float db = clDensityBase(pa, wx, 1.0, info1) * info1.w;
      o = uSide > 0.5 ? vec4(clSurf, clCav, clDecay, d) : vec4(d, db, info.y, ex);
    }`;
  const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: { ...U, uEx: { value: new THREE.Vector4() }, uEdge: { value: edge }, uFp: { value: fp ?? size / nxy }, uSide: { value: 0 } }, vertexShader: FULLSCREEN_VERT, fragmentShader: frag });
  const pass = new FullscreenPass(mat);
  const read = (n, ex) => {
    const rt = new THREE.WebGLRenderTarget(n, n, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    mat.uniforms.uEx.value.copy(ex); pass.render(r, rt);
    const px = new Float32Array(n * n * 4); r.readRenderTargetPixels(rt, 0, 0, n, n, px); rt.dispose(); return px;
  };
  const prev = r.getRenderTarget();
  const camAir = { x: ctx.world.origin.x + ctx.camera.position.x - ctx.clouds.windOffset.x, z: ctx.world.origin.z + ctx.camera.position.z - ctx.clouds.windOffset.y };
  let x0 = (cx ?? camAir.x) - size / 2, z0 = (cz ?? camAir.z) - size / 2, pick = null;
  if (find && cx === undefined) {
    // 48 km column map, pick the window whose cloud fraction is closest to 40 % with the most optical depth spread
    const n = 256, ext = 48000, px = read(n, new THREE.Vector4(camAir.x - ext / 2, camAir.z - ext / 2, ext, -1e6));
    const w = Math.round(size / ext * n); let best = -1e9;
    for (let j = 0; j + w <= n; j += 4) for (let i = 0; i + w <= n; i += 4) {
      let c = 0, s = 0, mx = 0;
      for (let b = j; b < j + w; b++) for (let a = i; a < i + w; a++) { const t = px[(b * n + a) * 4]; if (t > 2) c++; s += t; mx = Math.max(mx, t); }
      const f = c / (w * w), score = -Math.abs(f - (typeof find === 'number' && find < 1 ? find : 0.4)) * 4 + Math.min(mx, 120) / 120;
      // keep the edges of the window clear so no cloud is cut by the box
      let edgeT = 0; for (let k = 0; k < w; k++) edgeT += px[(j * n + i + k) * 4] + px[((j + w - 1) * n + i + k) * 4] + px[((j + k) * n + i) * 4] + px[((j + k) * n + i + w - 1) * 4];
      const sc = score - edgeT / (4 * w) * 0.15;
      if (sc > best) { best = sc; pick = { i, j, f, mx }; }
    }
    x0 = camAir.x - ext / 2 + pick.i / n * ext; z0 = camAir.z - ext / 2 + pick.j / n * ext;
  }
  const full = new Uint8Array(nxy * nxy * nz), b8 = new Uint8Array(detail ? 0 : nxy * nxy * nz), ex8 = new Uint8Array(nxy * nxy * nz), top2d = new Uint16Array(nxy * nxy);
  const surf8 = new Uint8Array(detail ? nxy * nxy * nz : 0), cav8 = new Uint8Array(detail ? nxy * nxy * nz : 0);
  const dz = th / nz;
  for (let k = 0; k < nz; k++) {
    const px = read(nxy, new THREE.Vector4(x0, z0, size, base + (k + 0.5) * dz));
    for (let i = 0; i < nxy * nxy; i++) {
      full[k * nxy * nxy + i] = Math.min(255, Math.round(px[i * 4] * 255));
      if (!detail) b8[k * nxy * nxy + i] = Math.min(255, Math.round(px[i * 4 + 1] * 255));
      ex8[k * nxy * nxy + i] = Math.max(0, Math.min(255, Math.round((px[i * 4 + 3] + 0.5) * 127.5)));
      if (k === nz >> 1) top2d[i] = Math.round(px[i * 4 + 2]);
    }
    if (detail) {
      mat.uniforms.uSide.value = 1;
      const ps = read(nxy, new THREE.Vector4(x0, z0, size, base + (k + 0.5) * dz));
      mat.uniforms.uSide.value = 0;
      for (let i = 0; i < nxy * nxy; i++) {
        surf8[k * nxy * nxy + i] = Math.max(0, Math.min(255, Math.round((ps[i * 4] + 0.1) * 510)));
        cav8[k * nxy * nxy + i] = Math.max(0, Math.min(255, Math.round(ps[i * 4 + 1] * 255)));
      }
    }
  }
  r.setRenderTarget(prev); pass.dispose();
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  return { nx: nxy, ny: nxy, nz, dx: size / nxy, dz, x0, z0, base, top, sigma: U.uClNoise.value.w, erosion: U.uClNoise.value.z,
    pick, params: { ...P }, full: b64(full), base8: b64(b8), ex8: b64(ex8), ...(detail ? { surf8: b64(surf8), cav8: b64(cav8) } : {}), top2d: b64(new Uint8Array(top2d.buffer)) };
}
