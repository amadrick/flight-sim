// Volumetric clouds + sky weather visuals.
//   createClouds(ctx) -> { update(dt), render(frame), texture, shadowGLSL, shadowUniforms, setScatterModel(model),
//                          densityAt(worldPos), cameraInCloud, ... }
//   render(frame): called by the pipeline after the main scene pass; frame = { renderer, camera, depthTexture, width, height, dt }
//   texture: FULL-resolution RGBA16F, rgb = premultiplied in-scattered radiance (own aerial perspective included),
//            a = transmittance. Composite: scene * a + rgb. The texture object is stable (never swapped).
//
// Frame (see shaders.js for the techniques and references):
//   1. weather map  (1024^2 RGBA8, camera-centred, re-baked ~1 Hz)      — large-scale structure, wind-advected
//   2. shadow map   (Beer shadow map, camera-centred, 1/8 per frame)     — cloudShadow() for the pipeline + far self-shadowing
//   3. ray march    (1/N resolution, MRT)                                — blue-noise jittered, adaptive steps
//   4. resolve      (full resolution, MRT, ping-pong history)            — temporal upsampling + depth-aware reconstruction
//   5. output       (full resolution, stable target)                    — history + un-accumulated lightning glow
import * as THREE from 'three';
import { FRAME_UNIFORMS_GLSL, DEPTH_GLSL, FULLSCREEN_VERT, FullscreenPass } from '../core/glsl.js';
import { saturate, smoothstep, lerp, damp } from '../core/math.js';
import { createNoise2D, createNoise3D, createCellField, sampleLowRes } from './noise.js';
import { WEATHER_FIELD_GLSL, makeWeatherFieldJS, deriveWeatherParams, densityFromField } from './weather-field.js';
import {
  CLOUD_SHADOW_GLSL, DEFAULT_SCATTER_GLSL, marchFragment, resolveFragment, OUTPUT_FRAG,
  shadowBakeFragment, weatherBakeFragment, CIRRUS_BAKE_FRAG,
} from './shaders.js';

const FALLBACK_ATMOSPHERE_GLSL = /* glsl */`
vec3 atmSunIlluminance(vec3 p) { return uSunColor; }
vec3 atmSkyRadiance(vec3 d) { return mix(vec3(0.55, 0.68, 0.85), vec3(0.1, 0.24, 0.62), pow(max(d.y, 0.0), 0.45)); }
vec4 atmAerialPerspective(vec3 p) { float t = exp(-distance(p, uCameraPos) / 60000.0); return vec4(vec3(0.55, 0.68, 0.85) * (1.0 - t), t); }
vec3 atmAmbient(vec3 p, vec3 n) { return mix(uAmbientGround, uAmbientSky, n.y * 0.5 + 0.5); }
`;

const WEATHER_MAP_SIZE_M = 409600;       // weather map covers ±204.8 km around the camera
const SHADOW_MAP_SIZE_M = 81920;         // shadow map covers ±41 km
const BASE_NOISE_PERIOD = 9800;          // metres per tile of the 128^3 base volume (≈ 77 m voxels)
const DETAIL_NOISE_PERIOD = 1350;        // metres per tile of the 32^3 detail volume (≈ 42 m voxels): sub-turrets of ~100-450 m
const BASE_NOISE_VSTRETCH = 0.55;      // vertical frequency of the base noise relative to horizontal (taller billows)
const LEAN_TIME = 220;                  // s: tower lean = wind shear x this (LES: 390-520 s, tools/neural/les_stats.py; halved, see INTEGRATION.md)
const GOLDEN = 0.61803398875;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Order in which the NxN sub-pixel positions are visited (well spread in space and time).
function jitterSequence(N) {
  const cells = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) cells.push([x, y]);
  if (N === 1) return cells;
  const out = [], used = new Set();
  const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
  for (let i = 1; out.length < N * N && i < 4096; i++) {
    const x = Math.floor(halton(i, 2) * N), y = Math.floor(halton(i, 3) * N), k = y * N + x;
    if (!used.has(k)) { used.add(k); out.push([x, y]); }
  }
  for (const c of cells) if (!used.has(c[1] * N + c[0])) out.push(c);
  return out;
}

export async function createClouds(ctx) {
  const { renderer } = ctx;
  const raw = ctx.params?.raw || {};
  const dbg = (k, d) => (raw[k] !== undefined && isFinite(+raw[k]) ? +raw[k] : d);
  const rnd = mulberry((ctx.params?.seed ?? 1337) * 7919 + 17);

  // ------------------------------------------------------------------------------------------------ textures
  const noise2 = createNoise2D(ctx.params?.seed ?? 1337);
  const noise3 = createNoise3D(renderer);
  const cells = createCellField({ seed: ctx.params?.seed ?? 1337 });
  const weatherField = makeWeatherFieldJS(noise2);

  const atmGLSL = ctx.pipeline?.atmosphere?.glsl || FALLBACK_ATMOSPHERE_GLSL;
  const atmUniforms = ctx.pipeline?.atmosphere?.uniforms || {};

  const P = deriveWeatherParams(ctx.weather);              // current cloud-model parameters
  const bake = { sx: 1, sz: 0, streets: 0, convective: 0, time: 0 };   // parameters baked into the weather map
  const wind = new THREE.Vector3(), windOffset = new THREE.Vector2(), cirrusOffset = new THREE.Vector2();
  const streetDir = new THREE.Vector2(1, 0);
  let streetFade = 1;

  const mkRT = (w, h, opts = {}) => new THREE.WebGLRenderTarget(w, h, {
    depthBuffer: false, type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, ...opts,
  });

  const WX_RES = ctx.quality.level === 'low' ? 512 : 1024;
  // half float: 8 bits would quantise the smooth fields into visible contour lines along anvil / deck edges
  const weatherRT = mkRT(WX_RES, WX_RES, { minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true });
  const cirrusRT = mkRT(512, 512, { type: THREE.UnsignedByteType, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
  let shadowRes = 0, shadowFront = null, shadowBack = null;

  // ------------------------------------------------------------------------------------------------ uniforms
  const v4 = (x = 0, y = 0, z = 0, w = 0) => ({ value: new THREE.Vector4(x, y, z, w) });
  const shadowUniforms = {
    tCloudShadowMap: { value: null },
    uCloudShadowA: v4(0, 0, 1 / SHADOW_MAP_SIZE_M, 1000), uCloudShadowB: v4(0, 0, 1e-3, 0), uCloudShadowC: v4(0, 0, 0, 0),
  };
  const U = {
    tClBase: { value: noise3.base }, tClDetail: { value: noise3.detail }, tClWeather: { value: weatherRT.texture },
    tClCurl: { value: noise2.curl }, tClBlue: { value: noise2.blue }, tClCirrus: { value: cirrusRT.texture },
    tClNoise2D: { value: noise2.noise2D }, tClCells: { value: cells.texture },
    uClCell: v4(1 / cells.period, 0, 0, 0), uClCell2: v4(cells.dMin, Math.log2(cells.dMax / cells.dMin), 0.6, 1.4), uClProf: v4(0.75, 0.85, 1, 0.6), uClProf2: v4(0.4, 0.7, 4, 0.4),
    uClWx: v4(0, 0, 1 / WEATHER_MAP_SIZE_M, WX_RES / WEATHER_MAP_SIZE_M),
    uClLayer: v4(1500, 3000, 1 / 1500, 1500), uClShape: v4(), uClShape2: v4(), uClShape3: v4(), uClNoise: v4(), uClNoiseOfs: v4(), uClRain: v4(),
    uClJitter: v4(), uClFullRes: v4(1, 1, 0.001, 0), uClStep: v4(), uClOriginAir: { value: new THREE.Vector3() },
    uClLightDir: { value: new THREE.Vector3(0, 1, 0) }, uClLightSel: v4(1, 1, 1, 0), uClMoonE: { value: new THREE.Vector3() },
    uClFlash: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uClCirrus: v4(10000, 0, 0, 0), uClDebug: v4(),
    uClTemporal: v4(), uClWindVel: v4(), uClFlashColor: { value: new THREE.Vector3(18, 21, 26) }, uClN: { value: 2 },
    tClMarch: { value: null }, tClMarchAux: { value: null }, tClHist: { value: null }, tClHistAux: { value: null },
    uClBakeA: v4(1, 0, 0, 0), uClBakeB: v4(), uClBakeWx: v4(0, 0, WEATHER_MAP_SIZE_M, 0),
    uClBakeShadowA: v4(0, 0, SHADOW_MAP_SIZE_M, 0), uClBakeShadowB: v4(0, 0, 1, 0),
  };
  const allUniforms = () => ({ ...ctx.uniforms.frame, ...atmUniforms, ...shadowUniforms, ...U, ...(scatterModel?.uniforms || {}) });
  const mkPass = (frag, uniforms) => new FullscreenPass(new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
    uniforms: uniforms || allUniforms(), vertexShader: FULLSCREEN_VERT, fragmentShader: frag,
  }));

  // ------------------------------------------------------------------------------------------------ passes
  let scatterModel = null;
  let N = 2, steps = 80, lightSteps = 4, shadowSteps = 16, shadowStrips = 8, maxDistQ = 200000;
  let marchPass = null, resolvePass = null, shadowPass = null;
  const outputPass = mkPass(OUTPUT_FRAG);
  const weatherPass = mkPass(weatherBakeFragment(WEATHER_FIELD_GLSL));
  let jitterSeq = jitterSequence(2), jitterIdx = 0, frameCount = 0;

  function readQuality() {
    const q = ctx.quality;
    steps = Math.max(16, Math.round(dbg('cloudSteps', q.cloudSteps ?? 64)));
    N = Math.min(4, Math.max(1, Math.round(1 / dbg('cloudScale', q.cloudScale ?? 0.5))));
    lightSteps = steps >= 100 ? 6 : steps >= 50 ? 4 : 3;
    const lvl = q.level;
    shadowRes = lvl === 'low' ? 256 : lvl === 'medium' ? 512 : 1024;
    shadowSteps = lvl === 'low' ? 12 : lvl === 'medium' ? 16 : 24;
    shadowStrips = 8;
    maxDistQ = dbg('cloudDist', lvl === 'low' ? 150000 : 200000);
  }

  function buildMaterials() {
    marchPass?.dispose(); resolvePass?.dispose(); shadowPass?.dispose();
    marchPass = mkPass(marchFragment({
      frameGLSL: FRAME_UNIFORMS_GLSL, depthGLSL: DEPTH_GLSL, atmosphereGLSL: atmGLSL,
      scatterGLSL: scatterModel?.glsl || DEFAULT_SCATTER_GLSL, steps, lightSteps, N,
    }));
    resolvePass = mkPass(resolveFragment({ frameGLSL: FRAME_UNIFORMS_GLSL, depthGLSL: DEPTH_GLSL, N }));
    shadowPass = mkPass(shadowBakeFragment({ steps: shadowSteps }));
    jitterSeq = jitterSequence(N); jitterIdx = 0;
    U.uClN.value = N;
  }

  function buildShadowTargets() {
    shadowFront?.dispose(); shadowBack?.dispose();
    const mk = () => { const rt = mkRT(shadowRes, shadowRes); rt.clParams = { A: new THREE.Vector4(0, 0, 1 / SHADOW_MAP_SIZE_M, 1000), B: new THREE.Vector4(0, 0, 1e-3, 0) }; return rt; };
    shadowFront = mk(); shadowBack = mk();
    shadowUniforms.tCloudShadowMap.value = shadowFront.texture;
    shadowCursor = 0; shadowValid = false;
  }

  // march / history / output targets (rebuilt on resize)
  let marchRT = null, histA = null, histB = null, outRT = mkRT(2, 2);
  let fullW = 0, fullH = 0, marchN = 0, historyValid = false, outputCleared = false;
  function ensureTargets(w, h) {
    if (w === fullW && h === fullH && marchRT && marchN === N) return;
    fullW = w; fullH = h;
    marchRT?.dispose(); histA?.dispose(); histB?.dispose();
    const lw = Math.ceil(w / N), lh = Math.ceil(h / N);
    marchRT = mkRT(lw, lh, { count: 2 }); marchN = N;
    histA = mkRT(w, h, { count: 2 }); histB = mkRT(w, h, { count: 2 });
    outRT.setSize(w, h);
    historyValid = false; outputCleared = false;
  }

  // ------------------------------------------------------------------------------------------------ weather / shadow bakes
  const camWorld = new THREE.Vector3(), prevCamWorld = new THREE.Vector3(), camFwd = new THREE.Vector3(), prevCamFwd = new THREE.Vector3(0, 0, -1);
  const wxCentre = new THREE.Vector2(1e12, 1e12);
  let wxBakeTime = -1e9, wxDirty = true;
  let shadowCursor = 0, shadowValid = false;
  const lightDir = new THREE.Vector3(0, 1, 0), shadowDir = new THREE.Vector3(0, 1, 0);
  let sunW = 1, moonW = 0;

  function bakeWeather() {
    const texel = WEATHER_MAP_SIZE_M / WX_RES;
    // snap the centre to the texel grid in air-mass coordinates: the pattern never swims through the texels
    wxCentre.set(Math.round((camWorld.x - windOffset.x) / texel) * texel, Math.round((camWorld.z - windOffset.y) / texel) * texel);
    bake.sx = streetDir.x; bake.sz = streetDir.y; bake.streets = P.streets * streetFade; bake.convective = P.convective; bake.time = ctx.time.now;
    U.uClBakeA.value.set(bake.sx, bake.sz, bake.streets, bake.convective);
    U.uClBakeB.value.set(bake.time, 0, 0, 0);
    U.uClBakeWx.value.set(wxCentre.x, wxCentre.y, WEATHER_MAP_SIZE_M, 0);
    weatherPass.render(renderer, weatherRT);
    U.uClWx.value.set(wxCentre.x, wxCentre.y, 1 / WEATHER_MAP_SIZE_M, 1 / texel);
    wxBakeTime = ctx.time.now; wxDirty = false;
  }

  // Bake `count` horizontal strips of the back shadow map; swap when the map is complete.
  function bakeShadow(count) {
    for (let k = 0; k < count; k++) {
      if (shadowCursor === 0) {
        const texel = SHADOW_MAP_SIZE_M / shadowRes, A = shadowBack.clParams.A, B = shadowBack.clParams.B;
        A.set(Math.round((camWorld.x - windOffset.x) / texel) * texel, Math.round((camWorld.z - windOffset.y) / texel) * texel, 1 / SHADOW_MAP_SIZE_M, P.base);
        B.set(shadowDir.x / shadowDir.y, shadowDir.z / shadowDir.y, 1 / P.thickness, -Math.log(1 - 0.8 * Math.pow(P.coverage, 1.5)));
        U.uClBakeShadowA.value.set(A.x, A.y, SHADOW_MAP_SIZE_M, 0);
        U.uClBakeShadowB.value.set(B.x, B.y, 1 / shadowDir.y, 0);
      }
      const h = Math.ceil(shadowRes / shadowStrips), y = shadowCursor * h;
      shadowBack.scissorTest = true; shadowBack.scissor.set(0, y, shadowRes, Math.min(h, shadowRes - y));
      shadowPass.render(renderer, shadowBack);
      if (++shadowCursor >= shadowStrips) {
        shadowCursor = 0;
        const t = shadowFront; shadowFront = shadowBack; shadowBack = t;
        shadowUniforms.tCloudShadowMap.value = shadowFront.texture;
        shadowUniforms.uCloudShadowA.value.copy(shadowFront.clParams.A);
        shadowUniforms.uCloudShadowB.value.copy(shadowFront.clParams.B);
        shadowValid = true;
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ lightning
  const flashes = [null, null];
  let nextFlash = 3 + rnd() * 4;
  const tmpWf = {}, tmpV = new THREE.Vector3();
  function spawnFlash(forceX, forceZ) {
    let best = null, bestScore = 0.25;
    if (forceX !== undefined) best = { x: forceX, z: forceZ, dev: 0.8 };       // debug / scripted strikes
    else for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2, r = 4000 + rnd() * rnd() * 38000;
      const x = camWorld.x + Math.cos(a) * r, z = camWorld.z + Math.sin(a) * r;
      weatherField(x - windOffset.x, z - windOffset.y, bake, tmpWf);
      const dev = smoothstep(P.devLo, P.devHi, tmpWf.dev), cov = saturate(P.covBias + (tmpWf.m - 0.5) * P.covAmp);
      const score = dev * cov * (0.6 + 0.4 * tmpWf.rain) + rnd() * 0.05;
      if (score > bestScore) { bestScore = score; best = { x, z, dev }; }
    }
    if (!best) return;
    const slot = !flashes[0] ? 0 : !flashes[1] ? 1 : -1;
    if (slot < 0) return;
    const topN = lerp(P.topMin, 1, best.dev);
    const y = P.base + P.thickness * topN * (0.2 + 0.45 * rnd());
    const strokes = [0]; let t = 0;
    const n = 1 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) { t += 0.04 + rnd() * 0.11; strokes.push(t); }
    const energy = 0.45 + 0.55 * rnd();
    flashes[slot] = { pos: new THREE.Vector3(best.x, y, best.z), t: 0, strokes, amps: strokes.map(() => 0.5 + 0.5 * rnd()), end: t + 0.35, energy };
    ctx.events.emit('lightning', { worldPos: flashes[slot].pos.clone(), intensity: energy });
  }
  function updateLightning(dt) {
    if (P.lightning > 0.02 && P.coverage > 0.3 && dt > 0) {
      nextFlash -= dt;
      if (nextFlash <= 0) { spawnFlash(); nextFlash = (1.5 + 8 * rnd() * rnd() + 1.5 * rnd()) / Math.max(P.lightning, 0.1); }
    }
    for (let k = 0; k < 2; k++) {
      const f = flashes[k], u = U.uClFlash.value[k];
      if (!f) { u.set(0, 0, 0, 0); continue; }
      f.t += dt;
      let I = 0;
      for (let i = 0; i < f.strokes.length; i++) { const s = f.t - f.strokes[i]; if (s >= 0) I += f.amps[i] * Math.exp(-s / 0.05); }
      ctx.world.toRender(f.pos, tmpV);
      u.set(tmpV.x, tmpV.y, tmpV.z, I * f.energy);
      if (f.t > f.end) flashes[k] = null;
    }
  }

  // ------------------------------------------------------------------------------------------------ per-frame state
  const tmpW = new THREE.Vector3(), windLo = new THREE.Vector3(), windHi = new THREE.Vector3();
  let animTime = 0, firstUpdate = true;

  function update(dt) {
    deriveWeatherParams(ctx.weather, P);
    // clouds drift with the wind at mid-layer; cirrus rides the faster upper-level flow
    tmpW.set(0, P.base + 0.35 * P.thickness, 0); ctx.weather.windAt(tmpW, wind);
    windOffset.x += wind.x * dt; windOffset.y += wind.z * dt;
    cirrusOffset.x += wind.x * 1.6 * dt; cirrusOffset.y += wind.z * 1.6 * dt;
    animTime += dt;

    // cloud streets follow the wind; when the wind swings, fade them out, turn, fade back in
    const ws = Math.hypot(wind.x, wind.z);
    if (ws > 0.5) {
      const dx = wind.x / ws, dz = wind.z / ws;
      if (firstUpdate) streetDir.set(dx, dz);
      const align = Math.abs(dx * streetDir.x + dz * streetDir.y);
      if (align < 0.985) { streetFade = Math.max(0, streetFade - dt / 20); if (streetFade === 0) streetDir.set(dx, dz); }
      else streetFade = Math.min(1, streetFade + dt / 20);
    }
    firstUpdate = false;

    // dominant light: sun, handing over to the moon in deep twilight
    const sun = ctx.env.sunDir, moon = ctx.env.moonDir;
    sunW = smoothstep(-0.10, -0.06, sun.y);
    moonW = (1 - smoothstep(-0.14, -0.10, sun.y)) * smoothstep(-0.02, 0.15, moon.y);
    lightDir.copy(sunW > 0 ? sun : moon);
    shadowDir.set(lightDir.x, Math.max(lightDir.y, 0.15), lightDir.z).normalize();

    // camera world position (works before the first render too)
    ctx.camera.getWorldPosition(camWorld); camWorld.x += ctx.world.origin.x; camWorld.z += ctx.world.origin.z;

    updateLightning(dt);
    const d = densityAt(camWorld);
    api.cameraInCloud = dt > 0 ? damp(api.cameraInCloud, saturate(d * 3), 6, dt) : api.cameraInCloud;
  }

  const tmpN = [0, 0, 0, 0], tmpC = [0, 0, 0, 0];
  function densityAt(worldPos) {
    if (P.coverage < 0.01) return 0;
    const y = worldPos.y;
    if (y <= P.base || y >= P.top) return 0;
    const ax = worldPos.x - windOffset.x, az = worldPos.z - windOffset.y;
    weatherField(ax, az, bake, tmpWf);
    const s = 1 / BASE_NOISE_PERIOD, o = U.uClNoiseOfs.value;
    // same order as clShape: cell under the (leaned, warped) point, then the shape noise at the cell's frequency
    const lean = U.uClCell.value, h = y - P.base;
    const cx = ax - lean.y * h + 160 * Math.sin(az * 3.7e-3 + 1.3 * Math.sin(ax * 1.9e-3));
    const cz = az - lean.z * h + 160 * Math.sin(ax * 3.3e-3 + 1.1 * Math.sin(az * 2.3e-3));
    cells.sample(cx / cells.period, cz / cells.period, tmpC);
    const rad = 0.5 * cells.dMin * Math.pow(cells.dMax / cells.dMin, tmpC[1]);
    const dev = smoothstep(P.devLo, P.devHi, tmpWf.dev), layerW = Math.max(P.stratus, P.anvil);
    const kS = layerW > 0 ? 1 : lerp(Math.min(8, Math.max(0.8, 2400 / rad)), 1, P.sheet);
    const nu = ax * s * kS + o.x, nv = y * s * kS * dbg('clD', BASE_NOISE_VSTRETCH) + o.y, nw = az * s * kS + o.z;
    for (let c = 0; c < 4; c++) tmpN[c] = sampleLowRes(noise3.lowRes, nu, nv, nw, c);
    return densityFromField(P, tmpWf, tmpN, y, tmpC, cells) * 0.8;
  }

  function setUniforms(frame) {
    const o = ctx.world.origin;
    U.uClLayer.value.set(P.base, P.top, 1 / P.thickness, P.thickness);
    U.uClShape.value.set(P.covBias, P.covAmp, P.topMin, P.stratus);
    U.uClShape2.value.set(P.devLo, P.devHi, P.anvil, P.baseRamp);
    U.uClShape3.value.set(dbg('clTaper', P.taperLo), P.taperHi, dbg('clPt', P.turret), dbg('clPl', P.lobes));
    // towers lean downwind with the shear between the base and the top of the layer
    tmpW.set(0, P.base, 0); ctx.weather.windAt(tmpW, windLo);
    tmpW.set(0, P.base + Math.min(P.thickness, 3000), 0); ctx.weather.windAt(tmpW, windHi);
    const leanK = dbg('clLean', LEAN_TIME) / Math.min(P.thickness, 3000);
    U.uClCell.value.set(1 / cells.period, (windHi.x - windLo.x) * leanK, (windHi.z - windLo.z) * leanK, dbg('clSheet', P.sheet));
    U.uClCell2.value.z = dbg('clAspLo', P.aspectLo); U.uClCell2.value.w = dbg('clAspHi', P.aspectHi);
    U.uClProf.value.fromArray(P.profShallow); U.uClProf2.value.fromArray(P.profDeep);
    U.uClNoise.value.set(1 / dbg('clBase', BASE_NOISE_PERIOD), 1 / dbg('clDetail', DETAIL_NOISE_PERIOD), dbg('clErosion', P.erosion), dbg('clSigma', P.sigma));
    // slow internal evolution: the base volume drifts upward through the shapes, detail scrolls faster
    U.uClNoiseOfs.value.set(0, -animTime * 0.6 / BASE_NOISE_PERIOD, 0, (animTime * 2.5 / DETAIL_NOISE_PERIOD) % 1);
    const rainOn = P.precip > 0.02 && P.coverage > 0.3;
    U.uClRain.value.set(rainOn ? P.precip * 0.0011 : 0, lerp(0.75, 0.2, P.precip), lerp(1.0, 0.6, P.precip), P.precip);
    U.uClOriginAir.value.set(o.x - windOffset.x, 0, o.z - windOffset.y);
    U.uClDebug.value.set(dbg('clA', 1.0), dbg('clB', 0.6), dbg('clCount', 0), dbg('clD', BASE_NOISE_VSTRETCH));
    U.uClLightDir.value.copy(lightDir);
    U.uClLightSel.value.set(sunW, lerp(1, 0.35, P.coverage * P.coverage), 1, animTime);
    const mE = 0.05 * moonW;                         // artistic moonlight (same units as uSunColor ≈ 4 at noon)
    U.uClMoonE.value.set(0.62 * mE, 0.78 * mE, 1.0 * mE);
    const cirrusAlt = Math.max(9800, P.top + 1500);
    U.uClCirrus.value.set(cirrusAlt, P.cirrus, o.x - cirrusOffset.x, o.z - cirrusOffset.y);
    shadowUniforms.uCloudShadowC.value.set(windOffset.x, windOffset.y, volumetricOn() && shadowValid ? 1 : 0, 0);
    // march set-up
    const cam = frame.camera || ctx.camera;
    const tanHalf = Math.tan((cam.fov || 60) * Math.PI / 360);
    const focalPx = fullH / (2 * tanHalf);
    U.uClFullRes.value.set(fullW, fullH, N / focalPx, dbg('clLS', 1));
    // nothing is visible far beyond the haze: shorter rays in murky weather (the expensive presets)
    const maxDist = Math.min(maxDistQ, Math.max(60000, (ctx.weather.visibility || 60000) * 8));
    U.uClStep.value.set(dbg('clKf', 0.9 / steps), dbg('clMinFine', 1200 / steps), dbg('clMinCoarse', 110), maxDist);
    const j = jitterSeq[jitterIdx % jitterSeq.length];
    // blue-noise phase: stratified inside one NxN cycle (the neighbours blended by the upsample get evenly spaced
    // offsets), golden-ratio sequence from cycle to cycle (each pixel's own samples are well distributed over time)
    const nn = jitterSeq.length, sub = jitterIdx % nn, cycle = Math.floor(jitterIdx / nn);
    U.uClJitter.value.set(j[0], j[1], (cycle * GOLDEN + sub / nn) % 1, volumetricOn() ? 1 : 0);
    U.uClWindVel.value.set(wind.x * (frame.dt || 0), 0, wind.z * (frame.dt || 0), focalPx);
  }

  const volumetricOn = () => P.coverage > 0.012;
  const cirrusOn = () => P.cirrus > 0.004;

  function render(frame) {
    const r = frame?.renderer || renderer;
    const w = Math.max(2, frame?.width | 0 || ctx.uniforms.frame.uResolution.value.x | 0), h = Math.max(2, frame?.height | 0 || ctx.uniforms.frame.uResolution.value.y | 0);
    const prevTarget = r.getRenderTarget(), prevAuto = r.autoClear;
    r.autoClear = false;
    ensureTargets(w, h);

    const active = volumetricOn() || cirrusOn();
    if (!active) {
      // nothing in the sky: one clear of the output, then zero cost
      if (!outputCleared) { r.setRenderTarget(outRT); r.setClearColor(0x000000, 1); r.clear(true, false, false); outputCleared = true; }
      historyValid = false;
      shadowUniforms.uCloudShadowC.value.z = 0;
      r.setRenderTarget(prevTarget); r.autoClear = prevAuto;
      return;
    }
    outputCleared = false;

    // camera cut / teleport detection (history and the camera-centred maps cannot follow a jump)
    ctx.camera.getWorldPosition(camWorld); camWorld.x += ctx.world.origin.x; camWorld.z += ctx.world.origin.z;
    ctx.camera.getWorldDirection(camFwd);
    const moved = camWorld.distanceTo(prevCamWorld);
    if (moved > 600 || camFwd.dot(prevCamFwd) < 0.3) historyValid = false;
    const teleported = moved > 5000;
    prevCamWorld.copy(camWorld); prevCamFwd.copy(camFwd);

    if (volumetricOn()) {
      const ax = camWorld.x - windOffset.x, az = camWorld.z - windOffset.y;
      const offCentre = Math.max(Math.abs(ax - wxCentre.x), Math.abs(az - wxCentre.y));
      setUniforms(frame);
      if (wxDirty || teleported || offCentre > 6000 || ctx.time.now - wxBakeTime > 1.0) bakeWeather();
      if (!shadowValid || teleported) { shadowCursor = 0; bakeShadow(shadowStrips); }
      else if ((frame?.dt ?? 1) > 0 || !ctx.params?.test) bakeShadow(1);
    }
    setUniforms(frame);

    // 1. march (low res)
    marchPass.render(r, marchRT);
    // 2. temporal resolve (full res)
    const write = histA, read = histB;
    U.tClMarch.value = marchRT.textures[0]; U.tClMarchAux.value = marchRT.textures[1];
    U.tClHist.value = read.textures[0]; U.tClHistAux.value = read.textures[1];
    U.uClTemporal.value.set(historyValid ? 1 : 0, dbg('clAlpha', 0.06), dbg('clAlphaExact', 0.12), Math.min(moved, 600));
    resolvePass.render(r, write);
    // 3. output
    U.tClHist.value = write.textures[0];
    outputPass.render(r, outRT);
    U.tClHist.value = null; U.tClHistAux.value = null;
    histA = read; histB = write;
    historyValid = true;
    jitterIdx++; frameCount++;

    r.setRenderTarget(prevTarget); r.autoClear = prevAuto;
  }

  // ------------------------------------------------------------------------------------------------ boot
  readQuality();
  buildMaterials();
  buildShadowTargets();
  { // cirrus texture (once)
    const p = mkPass(CIRRUS_BAKE_FRAG, { tClNoise2D: U.tClNoise2D });
    const prev = renderer.getRenderTarget();
    p.render(renderer, cirrusRT); renderer.setRenderTarget(prev); p.dispose();
  }

  ctx.events.on('quality:change', () => { readQuality(); buildMaterials(); buildShadowTargets(); fullW = 0; });
  ctx.events.on('weather:change', ({ instant }) => { wxDirty = true; if (instant) { shadowValid = false; historyValid = false; } });
  ctx.events.on('camera:mode', () => { historyValid = false; });
  ctx.events.on('session:start', () => { historyValid = false; wxDirty = true; });

  const api = {
    get texture() { return outRT.texture; },
    shadowGLSL: CLOUD_SHADOW_GLSL,
    shadowUniforms,
    cameraInCloud: 0,
    update, render, densityAt,
    /**
     * Swap the sun in-scattering model. model = { glsl, uniforms } where glsl defines
     *   float cloudSunScatter(float tauSun, float tauUp, float cosTheta)
     * (and may declare its own uniforms/samplers and helpers; it must also define `float clHG(float c, float g)`
     * if it does not want the built-in one... see DEFAULT_SCATTER_GLSL). null restores the analytic default.
     */
    setScatterModel(model) {
      scatterModel = model && model.glsl ? { glsl: model.glsl, uniforms: model.uniforms || {} } : null;
      if (scatterModel && !/float\s+clHG\s*\(/.test(scatterModel.glsl)) {
        // cirrus / rain use the HG helper from the default chunk; keep it available for replacement models
        scatterModel.glsl = `float clHG(float c, float g) { float g2 = g * g; return (1.0 - g2) * 0.0795775 / pow(1.0 + g2 - 2.0 * g * c, 1.5); }\n${scatterModel.glsl}`;
      }
      // a model that also provides cloudSunScatter4(tauSun, tauUp, cosTheta, tauDown) is called with the column
      // thickness below the sample as well (see the march in shaders.js)
      if (scatterModel && /float\s+cloudSunScatter4\s*\(/.test(scatterModel.glsl)) scatterModel.glsl = `#define CL_SCATTER4 1\n${scatterModel.glsl}`;
      // a model that also provides vec2 cloudAmbientVis(tauUp, tauDown) replaces the hand-written sky / ground-bounce
      // visibility of the march (S = E J + ambUp V.x + ambDown V.y)
      if (scatterModel && /vec2\s+cloudAmbientVis\s*\(/.test(scatterModel.glsl)) scatterModel.glsl = `#define CL_AMBIENT_VIS 1\n${scatterModel.glsl}`;
      buildMaterials();
      historyValid = false;
    },
    // extras (not part of the pipeline contract)
    params: P,
    get windOffset() { return windOffset; },
    weatherAt(worldX, worldZ, out = {}) { return weatherField(worldX - windOffset.x, worldZ - windOffset.y, bake, out); },
    debug: { spawnFlash, noise3, noise2, cells, get weatherRT() { return weatherRT; }, get shadowRT() { return shadowFront; }, get marchRT() { return marchRT; }, get outRT() { return outRT; }, U },
  };
  return api;
}
