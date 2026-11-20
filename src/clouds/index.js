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
  CLOUD_SHADOW_GLSL, DEFAULT_SCATTER_GLSL, marchFragment, resolveFragment, resolveFragmentR3, OUTPUT_FRAG,
  shadowBakeFragment, weatherBakeFragment, CIRRUS_BAKE_FRAG,
} from './shaders.js';
import { createCloudMultiScatter } from '../neural/cloud-ms.js';

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
const VSTRETCH_CELL = 0.9;             // round six: the same inside cumulus cells (0.55 drew vertically stretched turrets: curtains)
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
  // round six b: lumpy bubble volume (clBubV=0: round six spheres)
  const noise3 = createNoise3D(renderer, { bubbleV: dbg('clBubV', 1) });
  // round six (clField=0: round five): broken power law of sizes, clustered placement, gentler border taper
  const field6 = dbg('clField', 1) > 0;
  const cells = createCellField({ seed: ctx.params?.seed ?? 1337, borderTaper: String(raw.clBorder ?? 1) !== '0',
    ...(field6 ? { slope: 1.7, slope2: 3.2, dBreak: 1100, cluster: dbg('clClu', 1.2), taperK: 1, taperTo: 1.6, fill: dbg('clFill', 0.55), satellite: dbg('clSatl', 0) } : {}) });
  const weatherField = makeWeatherFieldJS(noise2);

  const atmGLSL = ctx.pipeline?.atmosphere?.glsl || FALLBACK_ATMOSPHERE_GLSL;
  const atmUniforms = ctx.pipeline?.atmosphere?.uniforms || {};
  // round five: physical sun / moon light (needs the pipeline atmosphere's transmittance LUT and illuminance uniforms)
  const physLight = /vec3\s+atmLightTransmittance\s*\(/.test(atmGLSL) && 'uAtmSunIllum' in atmUniforms && 'uAtmMoonIllum' in atmUniforms;

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
    tClNoise2D: { value: noise2.noise2D }, tClCells: { value: cells.texture }, tClBubble: { value: noise3.bubble }, uClBub: v4(), uClBub2: v4(), uClBub3: v4(), uClBub4: v4(), uClBub5: v4(), uClNub: v4(), uClNub2: v4(), uClNub3: v4(), uClCost: v4(0.004, 0, 0, 0),
    uClCell: v4(1 / cells.period, 0, 0, 0), uClCell2: v4(cells.dMin, Math.log2(cells.dMax / cells.dMin), 0.6, 1.4), uClProf: v4(0.75, 0.85, 1, 0.6), uClProf2: v4(0.4, 0.7, 4, 0.4),
    uClDet: v4(1, 1, 1, 1), uClLife: v4(0, 1, 0, 0), uClPhys: v4(2e-3, 1, 0.6, 1), uClMie: v4(0.9946, 0.594, 27.1, 0.498), uClDet2: v4(0.5, 4, 0.004, 0.3), uClDet3: v4(), uClDet4: v4(), uClDet5: v4(),
    uClWx: v4(0, 0, 1 / WEATHER_MAP_SIZE_M, WX_RES / WEATHER_MAP_SIZE_M),
    uClLayer: v4(1500, 3000, 1 / 1500, 1500), uClShape: v4(), uClShape2: v4(), uClShape3: v4(), uClNoise: v4(), uClNoiseOfs: v4(), uClRain: v4(),
    uClJitter: v4(), uClFullRes: v4(1, 1, 0.001, 0), uClStep: v4(), uClOriginAir: { value: new THREE.Vector3() },
    uClLightDir: { value: new THREE.Vector3(0, 1, 0) }, uClLightSel: v4(1, 1, 1, 0), uClMoonE: { value: new THREE.Vector3() }, uClLight2: v4(0, 1, 0, 0),
    uClFlash: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uClCirrus: v4(10000, 0, 0, 0), uClDebug: v4(), uClAmbUp: v4(), uClAmbDn: v4(),
    uClTemporal: v4(), uClTemporal2: v4(1, 0, 0, 0), uClWindVel: v4(), uClFlashColor: { value: new THREE.Vector3(18, 21, 26) }, uClN: { value: 2 },
    tClMarch: { value: null }, tClMarchAux: { value: null }, tClHist: { value: null }, tClHistAux: { value: null },
    uClBakeA: v4(1, 0, 0, 0), uClBakeB: v4(), uClBakeWx: v4(0, 0, WEATHER_MAP_SIZE_M, 0),
    uClBakeShadowA: v4(0, 0, SHADOW_MAP_SIZE_M, 0), uClBakeShadowB: v4(0, 0, 1, 0),
  };
  // Round five: learned multiple scattering (src/neural/cloud-ms.js, docs/clouds/NEURAL.md) is the default light model.
  // ?clMs=0 falls back to the model main.js installs with setScatterModel (round-three nets), ?scatter=classic to the
  // analytic one. reff from the droplet number of the starting weather (only the phase LUT depends on it).
  let msModel = null;
  if (raw.clMs !== '0' && raw.scatter !== 'classic') {
    try {
      const reff = Math.min(16, Math.max(6, 12 * Math.cbrt(150 / P.dropletN)));
      msModel = createCloudMultiScatter({ reff });
    } catch (e) { console.warn('[clouds] learned multiple scattering unavailable', e); msModel = null; }
  }
  U.uClMs = v4(dbg('clMsN', 2), dbg('clMsDetail', 0.5), 0, 0);
  const allUniforms = () => ({ ...ctx.uniforms.frame, ...atmUniforms, ...shadowUniforms, ...U, ...(scatterModel?.uniforms || {}), ...(msModel?.uniforms || {}) });
  const mkPass = (frag, uniforms) => new FullscreenPass(new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
    uniforms: uniforms || allUniforms(), vertexShader: FULLSCREEN_VERT, fragmentShader: frag,
  }));

  // ------------------------------------------------------------------------------------------------ passes
  let scatterModel = null;
  let N = 2, steps = 80, lightSteps = 4, shadowSteps = 16, shadowStrips = 8, maxDistQ = 200000;
  let marchPass = null, resolvePass = null, shadowPass = null;
  // round-four stages (each can be switched off for A/B): clTaa (resolve), clDet (detail cascade), clMicro (detailed
  // light samples), clCav (crease occlusion strength), clRef (surface refinement)
  const taaR4 = dbg('clTaa', 1) > 0;
  let detailLevel = 2;                    // 0 = low (cascade only), 1 = medium, 2 = high / ultra
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
    detailLevel = lvl === 'low' ? 0 : lvl === 'medium' ? 1 : 2;
    maxDistQ = dbg('cloudDist', lvl === 'low' ? 150000 : 200000);
  }

  function buildMaterials() {
    marchPass?.dispose(); resolvePass?.dispose(); shadowPass?.dispose();
    marchPass = mkPass(marchFragment({
      frameGLSL: FRAME_UNIFORMS_GLSL, depthGLSL: DEPTH_GLSL, atmosphereGLSL: (physLight ? '#define CL_ATM_LT 1\n' : '') + atmGLSL,
      scatterGLSL: scatterModel?.glsl || DEFAULT_SCATTER_GLSL, steps, lightSteps, N, msGLSL: msModel?.glsl || '',
    }));
    resolvePass = mkPass((taaR4 ? resolveFragment : resolveFragmentR3)({ frameGLSL: FRAME_UNIFORMS_GLSL, depthGLSL: DEPTH_GLSL, N }));
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

    // (the first session starts before this module listens: take the player of the first update as well)
    if (spawnFirst && ctx.player?.state?.position) { spawnFirst = false; spawnPending = spawnPending || ctx.player; }
    if (spawnPending) { computeLean(P); clearSpawn(spawnPending); spawnPending = null; }
    computeLean(P);
    updateLightning(dt);
    const d = densityAt(camWorld);
    api.cameraInCloud = dt > 0 ? damp(api.cameraInCloud, saturate(d * 3), 6, dt) : api.cameraInCloud;
  }

  // A session should not begin in the shadow of a cloud when the sky has gaps (fair / scattered / broken): the whole
  // air mass is shifted by the smallest offset (<= ~8 km) that leaves the sun's path to the spawn point clear, with a
  // margin around it. It is a phase shift of the entire field, so clouds and their shadows stay consistent.
  // Round five ("the start must be sunlit"): the test uses the TARGET weather (the menu may have just switched the
  // preset, whose coverage then eases in over seconds), the tower lean the GPU uses, the cells' life cycle, and looks
  // 90 s ahead (the wind carries upwind clouds over the runway); it re-runs when the time of day or the weather is
  // changed while the player still stands at the spawn point; and once the shadow map is baked the GPU's own
  // shadow at the player is read back (one 4x4 read) and the field is shifted again with a wider margin if any
  // cloud still touches the sun path.
  let spawnPending = null, spawnFirst = true, spawnVerify = null, spawnInfo = null;
  const spawnP = new THREE.Vector3(), spawnPos0 = new THREE.Vector3();
  let spawnTime = -1e9;
  const Pt = {};
  function clearSpawn(player, marginK = 1) {
    const pos = player?.state?.position;
    if (!pos || dbg('clSpawn', 1) <= 0) return false;
    deriveWeatherParams({ ...ctx.weather, ...(ctx.weather.target || {}) }, Pt);
    if (Pt.coverage < 0.02 || Pt.coverage > 0.8) return false;
    const L = shadowDir;
    if (sunW <= 0 || ctx.env.sunDir.y < 0.02) return false;
    computeLean(Pt);
    bake.sx = streetDir.x; bake.sz = streetDir.y; bake.streets = Pt.streets * streetFade; bake.convective = Pt.convective; bake.time = ctx.time.now;
    spawnPos0.copy(pos); spawnTime = ctx.time.now;
    const ox0 = windOffset.x, oz0 = windOffset.y;
    const look = dbg('clSpawnAhead', 90), r1 = 500 * marginK, r2 = 800 * marginK;
    // round six b: an airborne start inside the layer also needs clear air AROUND the aircraft (otherwise the chase
    // camera opens on grey cloud walls a few tens of metres away): no cloud within ~0.9 km at the player's level
    let clearR = dbg('clSpawnClear', 1800);
    const inLayer = pos.y > Pt.base - 150 && pos.y < Pt.top + 150;
    const crowded = (ox, oz) => {
      if (!inLayer || clearR <= 0) return false;
      for (const rr of [0.35, 0.7, 1]) for (let k = 0; k < 12; k++) for (const dy of [-120, 0, 120]) {
        const a = k * Math.PI / 6;
        spawnP.set(pos.x + Math.cos(a) * rr * clearR, pos.y + dy, pos.z + Math.sin(a) * rr * clearR);
        if (densityAtP(spawnP, Pt, ox, oz, ctx.time.now) > 0) return true;
      }
      return false;
    };
    const shaded = (ox, oz) => {
      if (crowded(ox, oz)) return true;
      // (the CPU density has no detail erosion and only approximates the turrets: fine vertical steps and two rings
      //  of margin keep the eroded GPU cloud off the sun path too)
      for (let ta = 0; ta <= look; ta += 30) {
        const oxT = ox + wind.x * ta, ozT = oz + wind.z * ta, tm = ctx.time.now + ta;
        for (let y = Pt.base + 30; y < Pt.top; y += 60) {
          const t = (y - pos.y) / L.y, x = pos.x + L.x * t, z = pos.z + L.z * t;
          for (let k = 0; k < 9; k++) {
            const m = k === 0 ? 0 : k < 5 ? r1 : r2 * 0.7071;
            const ux = k === 0 ? 0 : k < 5 ? (k === 1 ? 1 : k === 2 ? -1 : 0) : (k < 7 ? 1 : -1);
            const uz = k === 0 ? 0 : k < 5 ? (k === 3 ? 1 : k === 4 ? -1 : 0) : (k % 2 ? 1 : -1);
            spawnP.set(x + m * ux, y, z + m * uz);
            if (densityAtP(spawnP, Pt, oxT, ozT, tm) > 0) return true;
          }
        }
      }
      return false;
    };
    // (a second pass without the clear-air ring when no candidate within ~9 km has both)
    for (let pass = 0; pass < 2; pass++, clearR = 0) for (let i = 0; i < 400; i++) {
      // sunflower spiral: candidates in order of distance
      const r = 450 * Math.sqrt(i), a = i * 2.39996;
      const ox = ox0 + r * Math.cos(a), oz = oz0 + r * Math.sin(a);
      if (!shaded(ox, oz)) {
        windOffset.set(ox, oz);
        wxDirty = true; shadowValid = false; historyValid = false;
        spawnVerify = { player, marginK, tries: spawnVerify?.tries ?? 0 };
        spawnInfo = { shift: r, candidates: i + 1, marginK, clearAir: clearR > 0 };
        return true;
      }
    }
    spawnInfo = { failed: true, marginK };
    return false;
  }
  // GPU check of the spawn: optical depth of the baked shadow map on the sun path at the player (4x4 texels)
  let verifyBuf = null;
  function verifySpawn(r) {
    const v = spawnVerify; spawnVerify = null;
    const pos = v.player?.state?.position;
    if (!pos || !shadowFront) return;
    const A = shadowFront.clParams.A, B = shadowFront.clParams.B, res = shadowRes;
    const qx = pos.x - windOffset.x + B.x * (A.w - pos.y), qz = pos.z - windOffset.y + B.y * (A.w - pos.y);
    const u = (qx - A.x) * A.z + 0.5, w = (qz - A.y) * A.z + 0.5;
    const ix = Math.max(0, Math.min(res - 4, Math.round(u * res) - 2)), iy = Math.max(0, Math.min(res - 4, Math.round(w * res) - 2));
    verifyBuf = verifyBuf || new Uint16Array(16 * 4);
    try { r.readRenderTargetPixels(shadowFront, ix, iy, 4, 4, verifyBuf); } catch { return; }
    let tau = 0;
    for (let i = 0; i < 16; i++) tau = Math.max(tau, THREE.DataUtils.fromHalfFloat(verifyBuf[i * 4]));
    if (spawnInfo) spawnInfo.gpuTau = tau;
    if (tau > 0.03 && v.tries < 3) { spawnVerify = { tries: v.tries + 1 }; clearSpawn(v.player, v.marginK + 0.6); }
  }
  function spawnGuardActive() {
    const pos = ctx.player?.state?.position;
    return !!pos && ctx.time.now - spawnTime < 120 && pos.distanceTo(spawnPos0) < 150;
  }

  const tmpN = [0, 0, 0, 0], tmpC = [0, 0, 0, 0];
  function densityAt(worldPos) { return densityAtP(worldPos, P, windOffset.x, windOffset.y, ctx.time.now); }
  function densityAtP(worldPos, Pp, offX, offZ, time) {
    if (Pp.coverage < 0.01) return 0;
    const y = worldPos.y;
    if (y <= Pp.base || y >= Pp.top) return 0;
    const ax = worldPos.x - offX, az = worldPos.z - offZ;
    weatherField(ax, az, bake, tmpWf);
    const s = 1 / BASE_NOISE_PERIOD, o = U.uClNoiseOfs.value;
    // same order as clShape: cell under the (leaned, warped) point, then the shape noise at the cell's frequency
    const h = y - Pp.base;
    const wall = dbg('clWall', 45);
    const cx = ax - leanXZ.x * h + 160 * Math.sin(az * 3.7e-3 + 1.3 * Math.sin(ax * 1.9e-3)) + wall * Math.sin(h * 9.1e-3 + az * 2.9e-3 + 2 * Math.sin(ax * 1.3e-3));
    const cz = az - leanXZ.y * h + 160 * Math.sin(ax * 3.3e-3 + 1.1 * Math.sin(az * 2.3e-3)) + wall * Math.sin(h * 7.7e-3 + ax * 3.1e-3 + 2 * Math.sin(az * 1.7e-3));
    cells.sample(cx / cells.period, cz / cells.period, tmpC);
    if (wall > 0) {           // (round six, as clShape: owner cell's size / id / phase, not a blend of two neighbours)
      const S = cells.size, u = cx / cells.period, v = cz / cells.period;
      const i = (((Math.floor((u - Math.floor(u)) * S) % S) + S) % S) + (((Math.floor((v - Math.floor(v)) * S) % S) + S) % S) * S;
      tmpC[1] = cells.data[i * 4 + 1]; tmpC[2] = cells.data[i * 4 + 2]; tmpC[3] = cells.data[i * 4 + 3];
    }
    const rad = 0.5 * cells.dMin * Math.pow(cells.dMax / cells.dMin, tmpC[1]);
    const dev = smoothstep(Pp.devLo, Pp.devHi, tmpWf.dev), layerW = Math.max(Pp.stratus, Pp.anvil);
    const kS = layerW > 0 ? 1 : lerp(Math.min(8, Math.max(0.8, 2400 / rad)), 1, Pp.sheet);
    const vs = layerW > 0 || dbg('clVs', VSTRETCH_CELL) <= 0 ? dbg('clD', BASE_NOISE_VSTRETCH) : dbg('clVs', VSTRETCH_CELL);
    const nu = ax * s * kS + o.x, nv = y * s * kS * vs + o.y, nw = az * s * kS + o.z;
    for (let c = 0; c < 4; c++) tmpN[c] = sampleLowRes(noise3.lowRes, nu, nv, nw, c);
    return densityFromField(Pp, tmpWf, tmpN, y, tmpC, cells, lifeParams(time), { cong: dbg('clCong', 0.35), turretK: turretK() }) * 0.8;
  }

  // life cycle of the cumulus cells (shared by the GPU and the CPU mirror): t in nominal lifetimes
  const lifeObj = { t: 0, on: 1 };
  function lifeParams(time) { lifeObj.on = dbg('clLife', 1) > 0 ? 1 : 0; lifeObj.t = (time / dbg('clLifeT', 1400)) % 4096; return lifeObj; }
  // towers lean downwind with the shear between the base and the top of the layer (shared by the GPU and the CPU mirror)
  const leanXZ = new THREE.Vector2();
  function computeLean(Pp) {
    tmpW.set(0, Pp.base, 0); ctx.weather.windAt(tmpW, windLo);
    tmpW.set(0, Pp.base + Math.min(Pp.thickness, 3000), 0); ctx.weather.windAt(tmpW, windHi);
    const leanK = dbg('clLean', LEAN_TIME) / Math.min(Pp.thickness, 3000);
    leanXZ.set((windHi.x - windLo.x) * leanK, (windHi.z - windLo.z) * leanK);
  }

  function setUniforms(frame) {
    const o = ctx.world.origin;
    U.uClLayer.value.set(P.base, P.top, 1 / P.thickness, P.thickness);
    U.uClShape.value.set(P.covBias, P.covAmp, P.topMin, P.stratus);
    U.uClShape2.value.set(P.devLo, P.devHi, P.anvil, P.baseRamp);
    U.uClShape3.value.set(dbg('clTaper', P.taperLo), P.taperHi, dbg('clPt', P.turret * turretK()), dbg('clPl', P.lobes));
    computeLean(P);
    U.uClCell.value.set(1 / cells.period, leanXZ.x, leanXZ.y, dbg('clSheet', P.sheet));
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
    const mE = 0.05 * moonW;                         // round four: artistic moonlight (same units as uSunColor ≈ 4 at noon)
    U.uClMoonE.value.set(0.62 * mE, 0.78 * mE, 1.0 * mE);
    // round five (clLight=0: round four): the pipeline's own moon illuminance; the moon only while it is the light
    U.uClLight2.value.set(sunW > 0 ? 0 : moonW, physLight && dbg('clLight', 1) > 0 ? 1 : 0, 0, 0);
    // ambient for the clouds from the pipeline's raw (clear-sky) probe, without the player-shadow compensation
    const lt = ctx.pipeline?.lighting;
    if (lt?.ambientRaw && lt.sunIrradiance && dbg('clRawAmb', 1) > 0) {
      const a = lt.ambientRaw, sE = lt.sunIrradiance, mu = Math.max(ctx.env.sunDir.y, 0) / Math.PI;
      // the ground under a cloud field: sunlit where the clouds let the sun through, plus the sky ambient
      const lit = mu * (1 - 0.8 * Math.pow(P.coverage, 1.5)) * sunW;
      U.uClAmbUp.value.set(a.x, a.y, a.z, 1);
      // (round four: the sky light reaching the ground is attenuated by a deck as well; with the full sky term the
      //  ground bounce flooded the underside of an overcast and hid its thickness variations)
      const skyT = 1 - 0.7 * Math.pow(P.coverage, 1.5) * dbg('clColTau', 1);
      U.uClAmbDn.value.set((sE.x * lit + a.x * skyT) * 0.14, (sE.y * lit + a.y * skyT) * 0.15, (sE.z * lit + a.z * skyT) * 0.13, 1);
    } else U.uClAmbUp.value.w = 0;
    const cirrusAlt = Math.max(9800, P.top + 1500);
    U.uClCirrus.value.set(cirrusAlt, P.cirrus, o.x - cirrusOffset.x, o.z - cirrusOffset.y);
    shadowUniforms.uCloudShadowC.value.set(windOffset.x, windOffset.y, volumetricOn() && shadowValid ? 1 : 0, 0);
    // march set-up
    const cam = frame.camera || ctx.camera;
    const tanHalf = Math.tan((cam.fov || 60) * Math.PI / 360);
    const focalPx = fullH / (2 * tanHalf);
    U.uClFullRes.value.set(fullW, fullH, N / focalPx, dbg('clLS', 3));
    // nothing is visible far beyond the haze: shorter rays in murky weather (the expensive presets)
    const maxDist = Math.min(maxDistQ, Math.max(60000, (ctx.weather.visibility || 60000) * 8));
    U.uClStep.value.set(dbg('clKf', 0.9 / steps), dbg('clMinFine', 1200 / steps), dbg('clMinCoarse', 110), maxDist);
    const j = jitterSeq[jitterIdx % jitterSeq.length];
    // blue-noise phase: stratified inside one NxN cycle (the neighbours blended by the upsample get evenly spaced
    // offsets), golden-ratio sequence from cycle to cycle (each pixel's own samples are well distributed over time)
    const nn = jitterSeq.length, sub = jitterIdx % nn, cycle = Math.floor(jitterIdx / nn);
    U.uClJitter.value.set(j[0], j[1], (cycle * GOLDEN + sub / nn) % 1, volumetricOn() ? 1 : 0);
    U.uClWindVel.value.set(wind.x * (frame.dt || 0), 0, wind.z * (frame.dt || 0), focalPx);
    U.uClTemporal2.value.set(dbg('clYoung', 1), dbg('clClampC', 1), dbg('clClamp', 1), dbg('clCR', detailLevel > 0 ? 1 : 0));
    // detail cascade, detailed light samples (not at `low`), crease occlusion, surface refinement
    U.uClDet.value.set(dbg('clDet', 1), dbg('clMicro', detailLevel > 0 ? 1 : 0), dbg('clCav', 1.0), dbg('clRef', 1));
    U.uClDet3.value.set(dbg('clDbg', 0), dbg('clLam', dbg('clPhys', 1) > 0 ? 0.7 : 0), dbg('clWxL', 1), dbg('clAmbSide', 0.5));
    U.uClDet5.value.set(dbg('clGrad', 1), dbg('clCal', 1), dbg('clSoft', 0.35), dbg('clCirK', 1));
    U.uClDet4.value.set(dbg('clColTau', 1), dbg('clQuilt', 1), dbg('clPouch', 1), dbg('clCb', 1));
    // round five: life cycle (clLife=0 freezes it; clLifeT = nominal lifetime in s) and microphysical extinction
    // (clPhys=0: round four; clN = droplets per cm^3, clLwc = adiabatic liquid-water lapse in g m^-3 per km)
    const life = lifeParams(ctx.time.now);
    U.uClLife.value.set(life.t, life.on, 0, 0);
    // droplet diameter at the cloud top from N (r_e ~ 12 um at 150 per cm^3, r_e ~ N^(-1/3)) -> Jendersie-d'Eon parameters
    const dDrop = Math.min(50, Math.max(5, dbg('clDrop', 24 * Math.cbrt(150 / dbg('clN', P.dropletN)))));
    U.uClMie.value.set(Math.exp(-0.0990567 / (dDrop - 1.67154)), Math.exp(-2.20679 / (dDrop + 3.91029) - 0.428934),
      Math.exp(3.62489 - 8.29288 / (dDrop + 5.52825)), Math.exp(-0.599085 / (dDrop - 0.641583) - 0.665888));
    U.uClPhys.value.set(dbg('clLwc', 2.0) * 1e-3, Math.cbrt(dbg('clN', P.dropletN) / 150), dbg('clLwcCap', 0.45), dbg('clPhys', 1));
    // round five: amplitude ratio between detail octaves 0.5 -> 0.28 (~1 / frequency ratio): with 0.5 the 30-110 m octave
    // displaced the surface by ~100 m and the 7-28 m one by ~50 m, more than their own size, which shredded every turret
    // into fuzz (cotton wool); with amplitude ~ wavelength each octave adds round lobes on lobes (cauliflower)
    U.uClDet2.value.set(dbg('clDetA', dbg('clPhys', 1) > 0 ? 0.28 : 0.5), dbg('clDetF', 4), dbg('clEdge', 0.004), dbg('clWarp', 0.3));
    // round six (docs/clouds/SHAPE.md): bubble cascade (clBub = amplitude, 0 = round-five detail; clBubR = size ratio between
    // octaves; clBubL = largest sub-turret / cell radius), turret noise vertical frequency in cells (clVs, 0 = clD),
    // congestus among humilis (clCong), far fade of sub-pixel cells (clFar), height-dependent wall warp (clWall, m),
    // growing-edge width factor (clBubE)
    U.uClBub.value.set(dbg('clBub', 1.1), dbg('clBubR', 0.42), dbg('clBubL', 0.3), dbg('clVs', VSTRETCH_CELL));
    U.uClBub2.value.set(dbg('clCong', 0.35), dbg('clFar', 1), dbg('clWall', 45), dbg('clBubE', 1));
    // entrainment skin of growing turrets (clSkin x round five's 20 m), lobe lighting in the learned-MS path and the
    // bubble-field lobe orientation (clLobe), the largest bubble octave in the cheap density (light march, shadow map: lobe
    // self-shadowing; clLobeSh), analytic sun path through the anvil slab (clAnvL: no contour arcs under the anvil)
    U.uClBub5.value.set(dbg('clMsOffR', 2), dbg('clLOffR', 2), dbg('clSunK', 1), 0);
    U.uClBub4.value.set(dbg('clSph', 0), dbg('clBubS', 1.6), dbg('clBubMu', 1), dbg('clLOff', 1));
    // round six c (docs/clouds/SHAPE.md): profile erosion (clNub=0: round six b bubble cascade): profile depth (clNubP, x largest
    // bubble cell), erosion depth (clNubE, share of the profile), erosion noise tile (clNubT, x largest bubble cell), sharpening
    // of growing tops / of flanks and dissolving cells (clNubS, clNubW), bubble octaves kept (clNubB), wispy share of low flanks (clNubF),
    // share of the erosion the light march sees (clNubL)
    U.uClNub.value.set(dbg('clNub', 1), dbg('clNubP', 0.6), dbg('clNubE', 1.4), dbg('clNubT', 1.6));
    U.uClNub2.value.set(dbg('clNubS', 0.45), dbg('clNubW', 1.0), dbg('clNubB', 3), dbg('clNubF', 0.6));
    U.uClNub3.value.set(dbg('clNubL', 0.8), dbg('clNubWP', 3), dbg('clNubCb', 0), 0);
    U.uClBub3.value.set(dbg('clSkin', 0.3), dbg('clLobe', 1), dbg('clAnvL', 1), dbg('clLobeSh', 1));
    // cost (round six): rays stop at transmittance clTmin (round five 0.004), far-field light from the shadow map alone beyond
    // clFarL m low-res pixels (0 = off; `low` quality from 25 m), learned-MS taps without the bubble octave (clMsBub=1 keeps it), bubble octaves 2 / 3 / 4 at low / medium / high (clBubN)
    U.uClCost.value.set(dbg('clTmin', 0.01), dbg('clFarL', detailLevel === 0 ? 25 : 40), dbg('clMsBub', 0) > 0 ? 0 : 1, dbg('clBubN', [2, 3, 4][detailLevel]));
  }

  // round six: with the bubble cascade the base-noise turrets are lower (clPtK x round five's amplitude): the cascade's big
  // octave makes the turrets, and a smooth envelope keeps the displacement isotropic
  const turretK = () => (dbg('clBub', 1.1) > 0 ? dbg('clPtK', 0.4) : 1);
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
      if (spawnVerify && shadowValid) verifySpawn(r);
    }
    setUniforms(frame);

    // 1. march (low res)
    marchPass.render(r, marchRT);
    // 2. temporal resolve (full res)
    const write = histA, read = histB;
    U.tClMarch.value = marchRT.textures[0]; U.tClMarchAux.value = marchRT.textures[1];
    U.tClHist.value = read.textures[0]; U.tClHistAux.value = read.textures[1];
    if (taaR4) { const sg = dbg('clSig', 0.5); U.uClTemporal.value.set(historyValid ? 1 : 0, 0.5 / (sg * sg), dbg('clWmax', 6), Math.min(moved, 600)); }
    else U.uClTemporal.value.set(historyValid ? 1 : 0, dbg('clAlpha', 0.06), dbg('clAlphaExact', 0.12), Math.min(moved, 600));
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
  ctx.events.on('weather:change', ({ instant }) => {
    wxDirty = true; if (instant) { shadowValid = false; historyValid = false; }
    if (spawnGuardActive()) spawnPending = ctx.player;       // (menu changes before take-off: keep the start sunlit)
  });
  ctx.events.on('time:change', () => { if (spawnGuardActive()) spawnPending = ctx.player; });
  ctx.events.on('camera:mode', () => { historyValid = false; });
  ctx.events.on('session:start', (pl) => { historyValid = false; wxDirty = true; spawnPending = pl || ctx.player || null; });

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
    get lightModel() { return msModel ? 'ms5' : scatterModel ? 'scatter-model' : 'classic'; },
    get windOffset() { return windOffset; },
    weatherAt(worldX, worldZ, out = {}) { return weatherField(worldX - windOffset.x, worldZ - windOffset.y, bake, out); },
    debug: { spawnFlash, get spawnInfo() { return spawnInfo; }, noise3, noise2, cells, get weatherRT() { return weatherRT; }, get cirrusRT() { return cirrusRT; }, get shadowRT() { return shadowFront; }, get marchRT() { return marchRT; }, get outRT() { return outRT; }, U },
  };
  return api;
}
