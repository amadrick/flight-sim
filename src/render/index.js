// Skyward render pipeline: physically-based atmosphere + HDR frame graph.
//
//   createPipeline(ctx) -> {
//     atmosphere: { uniforms, glsl },            // GLSL atmosphere API (see atmosphere-glsl.js)
//     setSize(w, h, dpr), render(dt),
//     sceneTarget, depthTexture,                 // HDR scene colour (before composite) + scene depth
//     ...additions: shadow { glsl, uniforms }, lighting {...}, exposure, internalSize, debug
//   }
//
// Frame (ARCHITECTURE §6):
//   atmosphere LUTs (sky-view + aerial volume) → light/ambient/IBL update → [shadow atlas] → main pass (layer 0, jittered)
//   → ctx.clouds.render(frame) → composite (sky, sun/moon/stars, cloud shadows, aerial perspective, clouds; also copies
//   depth) → LAYERS.POST objects (depth-tested) → TAA → bloom pyramid → light probe / metering (async read-back)
//   → lens + exposure + AgX tone map → FXAA|CAS resample + dither → canvas.
import * as THREE from 'three';
import { FRAME_UNIFORMS_GLSL, DEPTH_GLSL, FULLSCREEN_VERT, FullscreenPass } from '../core/glsl.js';
import { LAYERS, SUN_ILLUMINANCE } from '../core/constants.js';
import { ATM, ATMOSPHERE_GLSL } from './atmosphere-glsl.js';
import { createAtmosphere } from './atmosphere.js';
import { SKY_GLSL } from './sky-glsl.js';
import { createEnvironment } from './environment.js';
import { KeyLight, fitShadows, installSunShadowChunk, SUN_SHADOW_API_GLSL } from './shadows.js';
import { createPostPasses } from './post.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lum3 = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

// Night is compressed (a real full moon is 1e-6 of the sun): the moon delivers 0.4% of the sun and auto-exposure
// opens up ~5 stops, which keeps half-float precision and other modules' emissive values in a sane range.
const MOON_FULL = 0.004;
const MOON_TINT = new THREE.Vector3(0.80, 0.90, 1.0);
const AIRGLOW = new THREE.Vector3(0.55, 0.85, 1.0).multiplyScalar(2e-5);    // per km of sea-level air, × night
const GROUND_ALBEDO = new THREE.Vector3(0.14, 0.15, 0.13);
const MOON_RADIUS = 0.00452 * 1.7;       // drawn 1.7x larger than life, as every film does
const MOON_DISC_RADIANCE = 0.34;

const HEAD = /* glsl */`
precision highp float; precision highp sampler2D;
in vec2 vUv; out vec4 outColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
`;

const COMPOSITE_FRAG = (cloudShadowGLSL) => HEAD + FRAME_UNIFORMS_GLSL + DEPTH_GLSL + ATMOSPHERE_GLSL + SKY_GLSL + /* glsl */`
uniform sampler2D tScene; uniform sampler2D tClouds; uniform float uHasClouds;
uniform vec4 uCloudK;      // x: share of direct light in the scene lighting, y: cloud shadow at the player, z: same share for in-scatter, w: debug cloud shadow (<0 = off)
uniform vec4 uFlash;       // rgb: lightning colour * envelope, a: envelope
uniform vec3 uFlashDir;
// ---- clouds module: float cloudShadow(vec3 renderPos) ----
${cloudShadowGLSL}
// ----
void main() {
  float d = sceneDepthRaw(vUv);
  vec3 col;
  if (depthIsSky(d)) {
    vec3 dir = viewRay(vUv);
    col = sky_radiance(dir);
    col += uFlash.rgb * (0.02 + 0.10 * pow(max(dot(dir, uFlashDir), 0.0), 6.0));
  } else {
    vec3 P = renderPosFromDepth(vUv, d);
    col = texture(tScene, vUv).rgb;
    if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
    col = max(col, 0.0);
    // Cloud shadows in screen space: the main pass lit this pixel with the cloud occlusion measured at the player
    // (key light dimmed, ambient boosted to compensate); re-weight to the occlusion at THIS point.
    float s = uCloudK.w >= 0.0 ? uCloudK.w : clamp(cloudShadow(P), 0.0, 1.0);
    float F = 1.0 - uCloudK.x + uCloudK.x * s;
    col = mix(col, vec3(dot(col, LUMA)), 0.3 * uCloudK.x * (1.0 - s)) * F;
    col = col * (1.0 + 3.0 * uFlash.a) + uFlash.rgb * 0.012;
    // Aerial perspective; in-scatter under cloud is dimmer and greyer.
    vec4 ap = atmAerialPerspective(P);
    float sa = 0.5 * (s + uCloudK.y);
    vec3 ins = ap.rgb * (1.0 - uCloudK.z + uCloudK.z * sa);
    ins = mix(ins, vec3(dot(ins, LUMA)), 0.6 * uCloudK.z * (1.0 - sa));
    col = col * ap.a + ins;
  }
  if (uHasClouds > 0.5) {
    vec4 c = texture(tClouds, vUv);
    if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
    col = col * c.a + c.rgb * (1.0 + 2.0 * uFlash.a) + uFlash.rgb * (0.3 * (1.0 - c.a));
  }
  outColor = vec4(clamp(col, 0.0, 30000.0), 1.0);
  gl_FragDepth = d;     // depth copy: LAYERS.POST objects test against this while still being able to SAMPLE tSceneDepth
}`;

// 4x1 light probe: [0] metering, [1] sky irradiance/π, [2] sun visibility + cloud shadow, [3] mean sky radiance.
const PROBE_FRAG = (cloudShadowGLSL) => HEAD + FRAME_UNIFORMS_GLSL + DEPTH_GLSL + ATMOSPHERE_GLSL + /* glsl */`
uniform sampler2D tMeter; uniform sampler2D tClouds; uniform float uHasClouds;
uniform vec4 uProbeSun;      // xy: sun uv, z: 1 if in front of the camera, w: tap radius in uv.y
uniform vec4 uProbeFocus;    // xyz: render-space player position, w: aspect
${cloudShadowGLSL}
void main() {
  int px = int(gl_FragCoord.x);
  vec4 o = vec4(0.0, 0.0, 0.0, 1.0);
  if (px == 0) {
    float sum = 0.0, wsum = 0.0, lin = 0.0;
    for (int j = 0; j < 8; j++) for (int i = 0; i < 12; i++) {
      vec2 uv = (vec2(float(i), float(j)) + 0.5) / vec2(12.0, 8.0);
      float l = dot(texture(tMeter, uv).rgb, LUMA);
      vec2 c = uv - 0.5; float w = exp(-dot(c, c) * 4.0);
      sum += log(clamp(l, 1e-5, 40.0)) * w; wsum += w; lin += l;
    }
    o = vec4(sum / wsum, lin / 96.0, 0.0, 1.0);
  } else if (px == 1) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 64; i++) {
      float u = (float(i) + 0.5) / 64.0, phi = float(i) * 2.39996323;
      float st = sqrt(u), ct = sqrt(1.0 - u);                   // cosine-weighted hemisphere
      acc += atmSkyRadiance(vec3(st * cos(phi), ct, st * sin(phi)));
    }
    o = vec4(acc / 64.0, 1.0);
  } else if (px == 2) {
    float vis = 0.0, n = 0.0;
    for (int i = 0; i < 9; i++) {
      float a = float(i) * 0.785398, r = i == 8 ? 0.0 : (i % 2 == 0 ? 1.0 : 0.55);
      vec2 uv = uProbeSun.xy + vec2(cos(a) / uProbeFocus.w, sin(a)) * (r * uProbeSun.w);
      if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
        float v = depthIsSky(sceneDepthRaw(uv)) ? 1.0 : 0.0;
        if (uHasClouds > 0.5) v *= clamp(texture(tClouds, uv).a, 0.0, 1.0);
        vis += v; n += 1.0;
      }
    }
    float cs = 0.0;
    for (int i = 0; i < 5; i++) {
      float a = float(i) * 1.5708;
      vec3 p = uProbeFocus.xyz + (i == 4 ? vec3(0.0) : vec3(cos(a), 0.0, sin(a)) * 180.0);
      cs += clamp(cloudShadow(p), 0.0, 1.0);
    }
    o = vec4(n > 0.0 ? vis / n * uProbeSun.z : 0.0, cs / 5.0, clamp(cloudShadow(uCameraPos), 0.0, 1.0), 1.0);
  } else {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 32; i++) {
      float u = (float(i) + 0.5) / 32.0, phi = float(i) * 2.39996323;
      float ct = u, st = sqrt(1.0 - u * u);                     // uniform over the upper hemisphere
      acc += atmSkyRadiance(vec3(st * cos(phi), ct, st * sin(phi)));
    }
    o = vec4(acc / 32.0, 1.0);
  }
  outColor = o;
}`;

export async function createPipeline(ctx) {
  const { renderer, scene, camera } = ctx;
  const F = ctx.uniforms.frame;
  const dbg = ctx.params?.raw || {};
  const ext = renderer.extensions;
  const canFloat = dbg.nofloat !== '1' && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
  const caps = {
    float: canFloat,
    hdrType: canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
    float32: canFloat && ext.has('EXT_color_buffer_float'),
  };
  if (!canFloat) console.warn('[render] no float render targets: running the LDR fallback path');

  renderer.shadowMap.type = THREE.PCFShadowMap;
  const csm = installSunShadowChunk();
  if (!csm) console.warn('[render] three.js sun-shadow chunks not found: single shadow cascade');

  // ------------------------------------------------------------------------------------------------ targets
  const mkDepth = () => { const t = new THREE.DepthTexture(2, 2); t.type = THREE.FloatType; t.minFilter = t.magFilter = THREE.NearestFilter; return t; };
  const mkRT = (type, opts = {}) => new THREE.WebGLRenderTarget(2, 2, {
    type, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.LinearSRGBColorSpace, ...opts,
  });
  const depthTexture = mkDepth();
  const sceneTarget = mkRT(caps.hdrType, { depthBuffer: true, depthTexture });
  sceneTarget.texture.name = 'scene.hdr';
  const hdrTarget = mkRT(caps.hdrType, { depthBuffer: true, depthTexture: mkDepth() });      // composite + POST layer
  const history = [mkRT(caps.hdrType), mkRT(caps.hdrType)];
  const ldrTarget = mkRT(caps.hdrType);
  const bloomDown = [], bloomUp = [];
  const probeType = caps.float32 ? THREE.FloatType : caps.hdrType;
  const probeRT = new THREE.WebGLRenderTarget(4, 1, { type: probeType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  F.tSceneDepth.value = depthTexture;

  // ------------------------------------------------------------------------------------------------ modules
  const atmosphere = createAtmosphere(ctx, caps);
  const env = createEnvironment(ctx, atmosphere, caps);
  const post = createPostPasses(ctx);

  const key = new KeyLight(csm);
  key.castShadow = !!ctx.quality.shadows;
  key.layers.enable(LAYERS.POST);
  scene.add(key);
  ctx.env.sunLight = key;

  // Shadow lookup for raw ShaderMaterials (addition to the contract): float sunShadow(vec3 renderPos, vec3 normal)
  const shadowUniforms = {
    tSunShadowMap: { value: null },
    uSunShadowMatrix: { value: [new THREE.Matrix4(), new THREE.Matrix4()] },
    uSunShadowRect: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    uSunShadowParams: { value: new THREE.Vector4(0, 0, 1, 0) },     // x: depth bias, y: normal bias (m), z: cascade texel ratio, w: enabled
    uSunShadowSize: { value: new THREE.Vector2(4096, 2048) },
  };

  // ------------------------------------------------------------------------------------------------ state
  const size = { cssW: 2, cssH: 2, dpr: 1, outW: 2, outH: 2, w: 2, h: 2 };
  let drs = 1, drsAcc = 0, drsN = 0, drsGood = 0, drsWait = 6, drsHold = 0, lastFrameT = 0;
  let frameNo = 0, taaReset = true, histIdx = 0, jitterIdx = 0;
  let composite = null, probe = null, hasCloudShadow = false;
  let snapFrames = 3, discontinuity = true;

  const sunT = new THREE.Vector3(), moonT = new THREE.Vector3(), sunE = new THREE.Vector3(), moonE = new THREE.Vector3();
  const moonIllum = new THREE.Vector3(), sunIllum = new THREE.Vector3(SUN_ILLUMINANCE, SUN_ILLUMINANCE, SUN_ILLUMINANCE);
  const keyDir = new THREE.Vector3(0, 1, 0), keyE = new THREE.Vector3(), airglow = new THREE.Vector3();
  const ambRaw = new THREE.Vector3(0.05, 0.09, 0.2), skyMean = new THREE.Vector3(0.1, 0.15, 0.3), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
  const groundRad = new THREE.Vector3();
  let keyIsMoon = false, keyFade = 1, lightsInit = false;
  let occl = 1, occlTarget = 1, occlCam = 1, kDirect = 0.8, Fpl = 1;
  let exposure = 1, logLum = Math.log(0.2), meterValid = false, probeValid = false, probePending = false, probeFails = 0;
  let sunVis = 0, sunVisTarget = 0;
  let flash = 0; const flashes = []; const flashDir = new THREE.Vector3(0, 1, 0); const flashCol = new THREE.Vector3(0.75, 0.82, 1.0);
  const fixedExposure = dbg.exposure !== undefined && isFinite(+dbg.exposure) ? +dbg.exposure : null;
  const dbgShadow = dbg.dbgshadow !== undefined && isFinite(+dbg.dbgshadow) ? +dbg.dbgshadow : -1;

  const lighting = {      // read-only snapshot for other modules / debugging
    keyIsMoon: false, keyDir, keyColor: keyE, sunIrradiance: sunE, moonIrradiance: moonE, cloudOcclusion: 1, directShare: 0.8,
    ambientRaw: ambRaw, sceneLuminance: 0.2, sunVisibility: 0,
  };
  const envSnap = { dir: new THREE.Vector3(), alt: -1e9, mie: -1, occl: -1, deck: -1, night: -1 };

  const projSaved = new THREE.Matrix4(), projInvSaved = new THREE.Matrix4(), curVP = new THREE.Matrix4();
  const objCur = new THREE.Matrix4(), objPrevPos = new THREE.Vector3(), objPrevQuat = new THREE.Quaternion(), objPos = new THREE.Vector3(), objQuat = new THREE.Quaternion(), objScale = new THREE.Vector3(1, 1, 1);
  let objPrevValid = false, objPlayer = null;
  const focusWorld = new THREE.Vector3(), camWorld = new THREE.Vector3(), camFwd = new THREE.Vector3(), v4 = new THREE.Vector4();
  const starRot = new THREE.Matrix4(), poleAxis = new THREE.Vector3();

  const compositeUniforms = {
    tScene: { value: sceneTarget.texture }, tClouds: { value: null }, uHasClouds: { value: 0 },
    uSkyStarRot: { value: new THREE.Matrix3() }, uSkyParams: { value: new THREE.Vector4(0.001, 0, MOON_RADIUS, MOON_DISC_RADIANCE) },
    uSkySunDisc: { value: new THREE.Vector3() },
    uCloudK: { value: new THREE.Vector4(0.8, 1, 0.75, dbgShadow) }, uFlash: { value: new THREE.Vector4() }, uFlashDir: { value: flashDir },
  };
  {
    // sun disc radiance so that its integral over the disc is the illuminance (per channel, with limb darkening)
    const area = Math.PI * ATM.SUN_RADIUS * ATM.SUN_RADIUS, u = [0.44, 0.58, 0.74];
    compositeUniforms.uSkySunDisc.value.set(SUN_ILLUMINANCE / area / (1 - u[0] / 3), SUN_ILLUMINANCE / area / (1 - u[1] / 3), SUN_ILLUMINANCE / area / (1 - u[2] / 3));
  }
  const probeUniforms = { tMeter: { value: null }, tClouds: compositeUniforms.tClouds, uHasClouds: compositeUniforms.uHasClouds, uProbeSun: { value: new THREE.Vector4() }, uProbeFocus: { value: new THREE.Vector4(0, 0, 0, 1.777) } };
  const probeBufF = new Float32Array(16), probeBufH = new Uint16Array(16), probeVals = new Float32Array(16);

  function buildLazy() {
    const clouds = ctx.clouds;
    const glsl = typeof clouds?.shadowGLSL === 'string' && clouds.shadowGLSL.includes('cloudShadow') ? clouds.shadowGLSL : 'float cloudShadow(vec3 renderPos) { return 1.0; }';
    hasCloudShadow = glsl.length > 60;      // more than the trivial stub
    const cu = clouds?.shadowUniforms || {};
    const mk = (uniforms, frag, extra) => new FullscreenPass(new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, blending: THREE.NoBlending, toneMapped: false, fog: false,
      uniforms: { ...F, ...atmosphere.uniforms, ...cu, ...uniforms }, vertexShader: FULLSCREEN_VERT, fragmentShader: frag, ...extra,
    }));
    composite = mk(compositeUniforms, COMPOSITE_FRAG(glsl), { depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true });
    probe = mk(probeUniforms, PROBE_FRAG(glsl), { depthTest: false, depthWrite: false });
  }

  // ------------------------------------------------------------------------------------------------ sizing
  function allocate() {
    const s = clamp((ctx.quality.renderScale || 1) * drs, 0.25, 2);
    const w = Math.max(2, Math.round(size.outW * s / 2) * 2), h = Math.max(2, Math.round(size.outH * s / 2) * 2);
    if (w === size.w && h === size.h && bloomDown.length) return;
    size.w = w; size.h = h;
    sceneTarget.setSize(w, h); hdrTarget.setSize(w, h); history[0].setSize(w, h); history[1].setSize(w, h); ldrTarget.setSize(w, h);
    for (const t of bloomDown) t.dispose(); for (const t of bloomUp) t.dispose();
    bloomDown.length = 0; bloomUp.length = 0;
    let bw = w, bh = h;
    for (let i = 0; i < 7; i++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      const d = mkRT(caps.hdrType); d.setSize(bw, bh); bloomDown.push(d);
      if (Math.min(bw, bh) <= 6) break;
    }
    for (let i = 0; i < bloomDown.length - 1; i++) { const u = mkRT(caps.hdrType); u.setSize(bloomDown[i].width, bloomDown[i].height); bloomUp.push(u); }
    F.uResolution.value.set(w, h);
    taaReset = true;
  }
  function setSize(w, h, dpr = 1) {
    size.cssW = w; size.cssH = h; size.dpr = dpr;
    renderer.setDrawingBufferSize(w, h, dpr);
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    size.outW = Math.max(2, db.x); size.outH = Math.max(2, db.y);
    allocate();
  }

  // Dynamic resolution: hold ~60 fps by trading internal resolution (TAA/CAS + the final resample hide most of it).
  function updateDRS() {
    const now = performance.now(), ft = now - lastFrameT; lastFrameT = now;
    if (!ctx.quality.dynamicResolution || ctx.params.test || dbg.nodrs === '1') { if (drs !== 1) { drs = 1; allocate(); } return; }
    if (ft <= 0 || ft > 250 || (typeof document !== 'undefined' && document.hidden)) return;
    drsAcc += ft; drsN++;
    if (drsN < 20) return;
    const avg = drsAcc / drsN; drsAcc = 0; drsN = 0;
    if (drsHold > 0) { drsHold--; return; }
    if (avg > 20.5 && drs > 0.5) {
      drs = Math.max(0.5, drs - (avg > 30 ? 0.16 : 0.08)); drsGood = 0; drsWait = Math.min(drsWait * 2, 48); drsHold = 2; allocate();
    } else if (avg < 17.4 && drs < 1) {
      if (++drsGood >= drsWait) { drs = Math.min(1, drs + 0.08); drsGood = 0; drsHold = 2; allocate(); }
    } else drsGood = 0;
  }

  // ------------------------------------------------------------------------------------------------ lighting
  function updateLighting(realDt) {
    const sunDir = ctx.env.sunDir, moonDir = ctx.env.moonDir;
    const camAlt = Math.max(F.uCameraPos.value.y, 0.5), hKm = camAlt * 0.001;
    atmosphere.setWeather(ctx.weather);
    atmosphere.lightTransmittance(hKm, sunDir.y, sunT);
    atmosphere.lightTransmittance(hKm, moonDir.y, moonT);
    sunE.copy(sunT).multiplyScalar(SUN_ILLUMINANCE);
    // moon: illuminated fraction from the sun-moon elongation; its sky scatter is irrelevant by day so it fades out (saves LUT work)
    const frac = 0.5 * (1 - sunDir.dot(moonDir));
    const moonDay = 1 - smooth(-0.035, 0.105, sunDir.y);
    moonIllum.copy(MOON_TINT).multiplyScalar(SUN_ILLUMINANCE * MOON_FULL * Math.pow(clamp(frac, 0, 1), 1.6) * moonDay);
    moonE.copy(moonIllum).multiply(moonT);
    const night = 1 - smooth(-0.105, 0.035, sunDir.y);
    ctx.env.nightFactor = night;
    airglow.copy(AIRGLOW).multiplyScalar(night);

    // key light hand-over (sun <-> moon) through a short fade so shadows never flip at full strength
    const ls = lum3(sunE), lm = lum3(moonE);
    const wantMoon = lm > ls * 1.2 ? true : (ls > lm * 1.2 ? false : keyIsMoon);
    if (!lightsInit || discontinuity) { keyIsMoon = wantMoon; keyFade = 1; lightsInit = true; }
    else if (wantMoon !== keyIsMoon) { keyFade -= realDt * 1.5; if (keyFade <= 0) { keyFade = 0; keyIsMoon = wantMoon; } }
    else keyFade = Math.min(1, keyFade + realDt * 1.5);
    keyDir.copy(keyIsMoon ? moonDir : sunDir);

    // cloud occlusion at the player (probe read-back), smoothed
    occl = discontinuity ? occlTarget : lerp(occl, occlTarget, 1 - Math.exp(-realDt / 0.35));
    const keyRaw = keyIsMoon ? moonE : sunE;
    // share of direct light in the lighting of a horizontal surface
    const D = lum3(keyRaw) * Math.max(keyDir.y, 0) / Math.PI * keyFade, A = Math.max(lum3(ambRaw), 1e-7);
    kDirect = clamp(D / (D + A), 0, 0.92);
    Fpl = 1 - kDirect + kDirect * occl;
    keyE.copy(keyRaw).multiplyScalar(keyFade * occl);

    const m = Math.max(keyE.x, keyE.y, keyE.z);
    if (m > 1e-9) { key.color.setRGB(keyE.x / m, keyE.y / m, keyE.z / m); key.intensity = m; } else { key.color.setRGB(1, 1, 1); key.intensity = 0; }

    // ambient for raw shaders (irradiance/π). Under cloud it is greyer; it is divided by F because the composite
    // multiplies the lit pixel by F(cloud shadow at that pixel).
    const greyK = 0.8 * (1 - occl);
    const la = lum3(ambRaw);
    tmpV.set(lerp(ambRaw.x, la, greyK), lerp(ambRaw.y, la, greyK), lerp(ambRaw.z, la, greyK));
    // generic ground radiance (true value) → sky-view "ground", IBL lower hemisphere
    groundRad.copy(keyE).multiplyScalar(Math.max(keyDir.y, 0) / Math.PI).add(tmpV).multiply(GROUND_ALBEDO);
    atmosphere.uniforms.uAtmGround.value.copy(groundRad);
    const fl = 1 + 4 * flash;
    ctx.env.sunColor.setRGB(sunE.x, sunE.y, sunE.z);
    ctx.env.ambientSky.setRGB(tmpV.x / Fpl * fl, tmpV.y / Fpl * fl, tmpV.z / Fpl * fl);
    ctx.env.ambientGround.setRGB(groundRad.x / Fpl * fl, groundRad.y / Fpl * fl, groundRad.z / Fpl * fl);
    scene.environmentIntensity = fl / Fpl;
    // zero-lag copy into the shared frame uniforms (core copied last frame's values before we ran)
    F.uSunColor.value.copy(ctx.env.sunColor); F.uAmbientSky.value.copy(ctx.env.ambientSky); F.uAmbientGround.value.copy(ctx.env.ambientGround);

    lighting.keyIsMoon = keyIsMoon; lighting.cloudOcclusion = occl; lighting.directShare = kDirect;
    const u = compositeUniforms;
    u.uCloudK.value.set(kDirect, occl, 0.8 * clamp(kDirect * 1.2, 0, 1), dbgShadow);
    // stars: celestial sphere turns about the pole (latitude) once per sidereal day
    const lat = (ctx.time.latitude ?? 34) * Math.PI / 180;
    poleAxis.set(0, Math.sin(lat), -Math.cos(lat));
    starRot.makeRotationAxis(poleAxis, ((ctx.time.timeOfDay || 0) / 24 + (ctx.time.dayOfYear || 0) / 365.25) * Math.PI * 2);
    u.uSkyStarRot.value.setFromMatrix4(starRot);
    u.uSkyParams.value.set(2 * Math.tan((camera.fov * Math.PI / 180) / 2) / size.h, smooth(0.45, 1, night), MOON_RADIUS, MOON_DISC_RADIANCE);
  }

  function fitKeyShadows() {
    key.castShadow = !!ctx.quality.shadows;
    const p = ctx.player;
    camWorld.copy(F.uCameraPos.value).add(ctx.world.origin);
    camera.getWorldDirection(camFwd);
    let radius = 14, agl = 0;
    if (p?.visual?.object3D) {
      const g = p.def?.geometry || {};
      const len = g.length || 16, span = g.span || 12, hgt = g.height || 5;
      radius = 0.5 * Math.hypot(len, span, hgt * 0.6) * 1.06 + 0.5;
      tmpV2.set(0, (hgt * 0.5 - (g.cgHeight ?? hgt * 0.3)) * 0.5, ((g.noseZ ?? -len / 2) + (g.tailZ ?? len / 2)) / 2).applyQuaternion(p.visual.object3D.quaternion);
      focusWorld.copy(p.state.position).add(tmpV2);
      agl = Math.max(0, p.state.agl ?? (p.state.position.y - ctx.world.groundHeightAt(p.state.position.x, p.state.position.z)));
    } else {
      focusWorld.copy(camWorld).addScaledVector(camFwd, 30);
      agl = Math.max(0, camWorld.y - ctx.world.groundHeightAt(camWorld.x, camWorld.z));
    }
    fitShadows({ light: key, dir: keyDir, focusWorld, focusRadius: radius, agl, origin: ctx.world.origin, cameraWorld: camWorld, cameraFwd: camFwd, mapSize: ctx.quality.shadowMapSize || 2048 });
  }
  function publishShadowUniforms() {
    const sh = key.shadow, u = shadowUniforms;
    const on = key.castShadow && csm && sh.map;
    u.uSunShadowParams.value.set(sh.bias, sh.normalBias, sh.radius, on ? 1 : 0);
    if (!on) return;
    u.tSunShadowMap.value = sh.map.depthTexture || null;
    u.uSunShadowMatrix.value[0].copy(sh.getMatrix(0)); u.uSunShadowMatrix.value[1].copy(sh.getMatrix(1));
    u.uSunShadowRect.value[0].copy(sh._cascadeData[0]); u.uSunShadowRect.value[1].copy(sh._cascadeData[1]);
    u.uSunShadowSize.value.set(sh.mapSize.x * 2, sh.mapSize.y);
    if (!u.tSunShadowMap.value) u.uSunShadowParams.value.w = 0;
  }

  // ------------------------------------------------------------------------------------------------ IBL
  function updateEnvironment() {
    const w = ctx.weather, camAlt = F.uCameraPos.value.y;
    const cov = clamp(((w.cloudCoverage ?? 0) - 0.35) / 0.5, 0, 1);
    const deck = cov * smooth(w.cloudBase ?? 1500, (w.cloudTop ?? 3000) + 200, camAlt);
    env.uniforms.uEnvWeather.value.set(1 - occl, deck, 1, 0);
    // cloud tops seen from above: bright diffuse reflector of sun + sky
    tmpV2.copy(sunE).multiplyScalar(Math.max(ctx.env.sunDir.y, 0) / Math.PI).addScaledVector(moonE, Math.max(ctx.env.moonDir.y, 0) / Math.PI).add(ambRaw).multiplyScalar(0.7);
    env.uniforms.uEnvCloudDeck.value.copy(tmpV2);
    if (!env.texture) { env.allocate(); snapEnv(deck); return; }
    if (discontinuity) { env.full(); snapEnv(deck); return; }
    if (env.busy) { env.tick(); return; }
    const s = envSnap, real = ctx.time.real;
    const moved = s.dir.dot(keyDir) < 0.99997                      // ~0.45 deg
      || Math.abs(camAlt - s.alt) > 40 + 0.04 * Math.abs(s.alt)
      || Math.abs(atmosphere.mie.ext - s.mie) > 0.02 * s.mie
      || Math.abs(occl - s.occl) > 0.03 || Math.abs(deck - s.deck) > 0.04 || Math.abs(ctx.env.nightFactor - s.night) > 0.02;
    if ((moved && real - env.lastStart > 0.35) || real - env.lastStart > 6) { snapEnv(deck); env.request(); env.tick(); }
  }
  function snapEnv(deck) {
    envSnap.dir.copy(keyDir); envSnap.alt = F.uCameraPos.value.y; envSnap.mie = atmosphere.mie.ext; envSnap.occl = occl; envSnap.deck = deck; envSnap.night = ctx.env.nightFactor;
  }

  // ------------------------------------------------------------------------------------------------ probe / exposure
  function exposureFor(L) {
    // Partial adaptation: bright scenes stay bright, dark scenes stay dark (the eye does not grey-card the world).
    const Lr = 0.2;
    const e = L > Lr ? Math.pow(L / Lr, -0.6) : Math.pow(L / Lr, -0.8);
    return clamp(e * 0.95, 0.22, 40);
  }
  function applyProbe(v, early) {
    for (let i = 0; i < 16; i++) if (!Number.isFinite(v[i])) return;
    if (!early) {
      const l = clamp(Math.exp(v[0]), 1e-5, 40);
      logLum = Math.log(l); meterValid = true; lighting.sceneLuminance = l;
    }
    ambRaw.set(Math.max(v[4], 0), Math.max(v[5], 0), Math.max(v[6], 0));
    if (!early) sunVisTarget = clamp(v[8], 0, 1);
    occlTarget = hasCloudShadow ? clamp(v[9], 0, 1) : 1;
    if (dbgShadow >= 0) occlTarget = dbgShadow;
    occlCam = clamp(v[10], 0, 1);
    skyMean.set(Math.max(v[12], 0), Math.max(v[13], 0), Math.max(v[14], 0));
    probeValid = true;
  }
  function decodeProbe(early) {
    if (probeType === THREE.FloatType) probeVals.set(probeBufF);
    else for (let i = 0; i < 16; i++) probeVals[i] = THREE.DataUtils.fromHalfFloat(probeBufH[i]);
    applyProbe(probeVals, early);
  }
  function runProbe(early) {
    if (!caps.float || !probe) return;
    const p = ctx.player, u = probeUniforms;
    if (p) u.uProbeFocus.value.set(p.visual.object3D.position.x, p.visual.object3D.position.y, p.visual.object3D.position.z, size.w / size.h);
    else u.uProbeFocus.value.set(F.uCameraPos.value.x, F.uCameraPos.value.y, F.uCameraPos.value.z, size.w / size.h);
    u.tMeter.value = early ? null : bloomDown[Math.min(3, bloomDown.length - 1)].texture;
    probe.render(renderer, probeRT);
    const buf = probeType === THREE.FloatType ? probeBufF : probeBufH;
    const sync = early || ctx.params.test || !probeValid || !meterValid || snapFrames > 0 || probeFails > 3 || typeof renderer.readRenderTargetPixelsAsync !== 'function';
    if (sync) {
      renderer.readRenderTargetPixels(probeRT, 0, 0, 4, 1, buf);
      decodeProbe(early);
    } else if (!probePending && frameNo % 3 === 0) {
      probePending = true;
      renderer.readRenderTargetPixelsAsync(probeRT, 0, 0, 4, 1, buf)
        .then(() => { probePending = false; decodeProbe(false); })
        .catch(() => { probePending = false; probeFails++; });
    }
  }
  function updateExposure(realDt) {
    if (fixedExposure !== null) { exposure = fixedExposure; ctx.env.exposure = exposure; return; }
    let target;
    if (meterValid) target = exposureFor(Math.exp(logLum));
    else {
      // no metering (first frame / no float targets): estimate from the lights
      const est = 0.9 * lum3(ambRaw) + 0.05 * lum3(keyE) * Math.max(keyDir.y, 0.1);
      target = exposureFor(Math.max(est, 1e-5));
    }
    if (snapFrames > 0 || !Number.isFinite(exposure)) exposure = target;
    else {
      // eyes stop down fast and open up slowly
      const tau = target < exposure ? 0.35 : 1.3;
      exposure = Math.exp(lerp(Math.log(exposure), Math.log(target), 1 - Math.exp(-realDt / tau)));
    }
    ctx.env.exposure = exposure;
  }

  // ------------------------------------------------------------------------------------------------ events
  ctx.events.on('quality:change', () => { key.castShadow = !!ctx.quality.shadows; allocate(); env.allocate(); taaReset = true; });
  ctx.events.on('time:change', () => { discontinuity = true; snapFrames = 3; });
  ctx.events.on('weather:change', (e) => { if (e?.instant) { discontinuity = true; snapFrames = 3; } });
  ctx.events.on('session:start', () => { taaReset = true; objPrevValid = false; snapFrames = Math.max(snapFrames, 2); });
  ctx.events.on('camera:mode', () => { taaReset = true; snapFrames = Math.max(snapFrames, 1); });
  ctx.events.on('lightning', (e) => {
    const i = clamp(e?.intensity ?? 1, 0, 2);
    let k = i;
    if (e?.worldPos) {
      tmpV.set(e.worldPos.x - ctx.world.origin.x, e.worldPos.y, e.worldPos.z - ctx.world.origin.z).sub(F.uCameraPos.value);
      const dist = tmpV.length();
      if (dist > 1) flashDir.copy(tmpV).multiplyScalar(1 / dist);
      k *= Math.exp(-dist / 18000);
    }
    // a stroke plus one or two dimmer re-strikes
    const t = ctx.time.real;
    flashes.push({ t, a: k }, { t: t + 0.06 + 0.05 * Math.random(), a: k * 0.55 });
    if (Math.random() < 0.6) flashes.push({ t: t + 0.17 + 0.08 * Math.random(), a: k * 0.35 });
    if (flashes.length > 12) flashes.splice(0, flashes.length - 12);
  });
  function updateFlash() {
    const t = ctx.time.real; let v = 0;
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i], dt = t - f.t;
      if (dt > 0.45) { flashes.splice(i, 1); continue; }
      if (dt >= 0) v += f.a * Math.exp(-dt / 0.05);
    }
    flash = Math.min(v, 2);
    compositeUniforms.uFlash.value.set(flashCol.x * flash, flashCol.y * flash, flashCol.z * flash, flash);
  }

  // ------------------------------------------------------------------------------------------------ frame helpers
  function taaOn() { return !!ctx.quality.taa && caps.float && dbg.notaa !== '1'; }
  function applyJitter(on) {
    projSaved.copy(camera.projectionMatrix); projInvSaved.copy(camera.projectionMatrixInverse);
    curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    post.taa.material.uniforms.uTaaJitter.value.set(0, 0);
    if (!on) return;
    jitterIdx = (jitterIdx % 16) + 1;
    const jx = halton(jitterIdx, 2) - 0.5, jy = halton(jitterIdx, 3) - 0.5;
    const tx = (2 * jx) / size.w, ty = (2 * jy) / size.h, e = camera.projectionMatrix.elements;
    e[0] += tx * e[3]; e[4] += tx * e[7]; e[8] += tx * e[11]; e[12] += tx * e[15];
    e[1] += ty * e[3]; e[5] += ty * e[7]; e[9] += ty * e[11]; e[13] += ty * e[15];
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    F.uProjMatrix.value.copy(camera.projectionMatrix); F.uProjInverse.value.copy(camera.projectionMatrixInverse);
    post.taa.material.uniforms.uTaaJitter.value.set(jx, jy);
  }
  // three flips the camera to a reversed-Z projection lazily inside its first render(); do it up front so the
  // matrices we save/jitter/restore (and the frame uniforms) are the ones the depth buffer is really rendered with.
  function syncReversedDepth() {
    if (!renderer.capabilities.reversedDepthBuffer || camera.reversedDepth === true) return;
    camera._reversedDepth = true;
    camera.updateProjectionMatrix();
    F.uProjMatrix.value.copy(camera.projectionMatrix); F.uProjInverse.value.copy(camera.projectionMatrixInverse);
    F.uDepthReversed.value = 1;
  }
  function restoreProjection() { camera.projectionMatrix.copy(projSaved); camera.projectionMatrixInverse.copy(projInvSaved); }

  function updateTaaObject() {
    const u = post.taa.material.uniforms, p = ctx.player, o = p?.visual?.object3D;
    if (!o) { u.uTaaBoxMin.value.set(1, 1, 1); u.uTaaBoxMax.value.set(-1, -1, -1); objPrevValid = false; objPlayer = null; return; }
    o.updateMatrixWorld();
    objPos.setFromMatrixPosition(o.matrixWorld); objQuat.setFromRotationMatrix(o.matrixWorld);
    objCur.compose(objPos, objQuat, objScale);
    u.uTaaObjInv.value.copy(objCur).invert();
    if (!objPrevValid || objPlayer !== p) { objPrevPos.copy(objPos).add(ctx.world.origin); objPrevQuat.copy(objQuat); }
    tmpV.copy(objPrevPos).sub(ctx.world.origin);
    u.uTaaObjPrev.value.compose(tmpV, objPrevQuat, objScale);
    const g = p.def?.geometry || {}, len = g.length || 16, span = g.span || 12, hgt = g.height || 5, cg = g.cgHeight ?? hgt * 0.3;
    u.uTaaBoxMin.value.set(-span * 0.53, -cg + 0.1, (g.noseZ ?? -len / 2) - 0.6);
    u.uTaaBoxMax.value.set(span * 0.53, hgt - cg + 0.6, (g.tailZ ?? len / 2) + 0.6);
    objPrevPos.copy(objPos).add(ctx.world.origin); objPrevQuat.copy(objQuat); objPrevValid = true; objPlayer = p;
  }

  function debugLook() {
    // debug: ?lookyaw=deg&lookpitch=deg turn the camera after the rig has placed it (use with notaa=1)
    if (dbg.lookyaw === undefined && dbg.lookpitch === undefined) return;
    const yaw = (+dbg.lookyaw || 0) * Math.PI / 180, pitch = (+dbg.lookpitch || 0) * Math.PI / 180;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    camera.quaternion.premultiply(q);
    camera.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
    camera.updateMatrixWorld(true);
    F.uCameraWorld.value.copy(camera.matrixWorld); F.uViewMatrix.value.copy(camera.matrixWorldInverse);
    F.uPrevViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  }

  // ------------------------------------------------------------------------------------------------ render
  function render(dt) {
    const realDt = ctx.time.realDt || 0;
    frameNo++;
    if (!composite) buildLazy();
    syncReversedDepth();
    updateDRS();
    if (size.w < 2 || !bloomDown.length) allocate();
    debugLook();

    const prevAutoClear = renderer.autoClear, prevShadowAuto = renderer.shadowMap.autoUpdate;
    renderer.autoClear = false;

    // --- atmosphere + lights -------------------------------------------------------------------------------
    updateFlash();
    updateLighting(realDt);
    atmosphere.update({ camAltitude: Math.max(F.uCameraPos.value.y, 0.5), sunDir: ctx.env.sunDir, moonDir: ctx.env.moonDir, sunIllum, moonIllum, keyDir, airglow });
    if (!probeValid && caps.float) { runProbe(true); updateLighting(0); }      // first frame: get the sky ambient before lighting anything
    updateEnvironment();
    fitKeyShadows();

    // --- main pass -----------------------------------------------------------------------------------------
    const useTaa = taaOn();
    applyJitter(useTaa);
    camera.layers.set(LAYERS.MAIN);
    renderer.shadowMap.autoUpdate = true;
    renderer.setRenderTarget(sceneTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    publishShadowUniforms();

    // --- clouds --------------------------------------------------------------------------------------------
    const clouds = ctx.clouds;
    if (clouds?.render) {
      clouds.render({ renderer, camera, depthTexture, width: size.w, height: size.h, dt });
      renderer.autoClear = false;
    }
    const cu = compositeUniforms;
    cu.tClouds.value = clouds?.texture || null;
    cu.uHasClouds.value = clouds?.texture ? 1 : 0;

    // --- composite (+ depth copy) → hdrTarget, then the POST layer on top, depth-tested --------------------------
    composite.render(renderer, hdrTarget);
    camera.layers.set(LAYERS.POST);
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(hdrTarget);
    renderer.render(scene, camera);
    camera.layers.set(LAYERS.MAIN);
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    restoreProjection();

    // --- temporal AA ---------------------------------------------------------------------------------------
    let hdr = hdrTarget;
    if (useTaa) {
      const u = post.taa.material.uniforms, dst = history[histIdx], src = history[1 - histIdx];
      updateTaaObject();
      u.tCurrent.value = hdrTarget.texture; u.tHistory.value = src.texture; u.uTaaCurVP.value.copy(curVP);
      u.uTaaParams.value.set(0.9, taaReset ? 1 : 0, 1.25, 0);
      post.taa.render(renderer, dst);
      hdr = dst; histIdx = 1 - histIdx; taaReset = false;
    } else taaReset = true;

    // --- bloom pyramid (always built: the metering reads it; the up-chain only when bloom is on) -----------------
    const bloomOn = !!ctx.quality.bloom && bloomDown.length > 1;
    {
      const u = post.down.material.uniforms;
      let src = hdr;
      const levels = bloomOn ? bloomDown.length : Math.min(4, bloomDown.length);
      for (let i = 0; i < levels; i++) {
        u.tSrc.value = src.texture; u.uSrcTexel.value.set(1 / src.width, 1 / src.height); u.uKaris.value = i === 0 ? 1 : 0;
        post.down.render(renderer, bloomDown[i]);
        src = bloomDown[i];
      }
    }
    let bloomTex = null;
    if (bloomOn) {
      const u = post.up.material.uniforms;
      let low = bloomDown[bloomDown.length - 1];
      for (let i = bloomDown.length - 2; i >= 0; i--) {
        u.tLow.value = low.texture; u.tHigh.value = bloomDown[i].texture; u.uLowTexel.value.set(1 / low.width, 1 / low.height);
        u.uScatter.value = 0.62;
        post.up.render(renderer, bloomUp[i]);
        low = bloomUp[i];
      }
      bloomTex = low.texture;
    }

    // --- probe: metering + sky ambient + sun visibility ----------------------------------------------------------
    {
      const sd = ctx.env.sunDir, u = probeUniforms.uProbeSun.value;
      v4.set(sd.x, sd.y, sd.z, 0).applyMatrix4(curVP);
      const front = v4.w > 1e-6;
      u.set(front ? (v4.x / v4.w) * 0.5 + 0.5 : -10, front ? (v4.y / v4.w) * 0.5 + 0.5 : -10, front ? 1 : 0, Math.max(2.5 / size.h, 0.012));
    }
    runProbe(false);
    updateExposure(realDt);
    if (snapFrames > 0) snapFrames--;

    // --- lens + tone map ---------------------------------------------------------------------------------------
    {
      const u = post.tonemap.material.uniforms, ps = probeUniforms.uProbeSun.value;
      // glare only while the sun is on (or just off) screen
      const off = Math.max(0, -ps.x, ps.x - 1, -ps.y, ps.y - 1);
      const tgt = ps.z > 0 ? sunVisTarget * (1 - smooth(0, 0.25, off)) : 0;
      sunVis = snapFrames > 0 ? tgt : lerp(sunVis, tgt, 1 - Math.exp(-realDt / 0.12));
      lighting.sunVisibility = sunVis;
      u.tHDR.value = dbg.rdebug === 'scene' ? sceneTarget.texture : (dbg.rdebug === 'hdr' ? hdrTarget.texture : hdr.texture); u.tBloom.value = bloomTex;
      u.uTone.value.set(exposure, bloomTex ? 0.055 : 0, 0.22, size.w / size.h);
      u.uLensSun.value.set(ps.x, ps.y, dbg.noflare === '1' ? 0 : sunVis, 1);
      u.uLensColor.value.copy(sunE);
      u.uGrade.value.set(1.16, 1.14, caps.float ? 0 : 1 / 255, frameNo % 64);
      u.uDebug.value = dbg.rdebug === 'notonemap' ? 1 : 0;
      u.uNightGrade.value = smooth(0.4, 1, ctx.env.nightFactor) * (1 - smooth(0.004, 0.03, lighting.sceneLuminance));
      post.tonemap.render(renderer, ldrTarget);
    }

    // --- final resample → canvas -----------------------------------------------------------------------------------
    {
      const u = post.final.material.uniforms;
      u.tLDR.value = ldrTarget.texture; u.uSrcTexel.value.set(1 / size.w, 1 / size.h);
      u.uFinal.value.set(useTaa ? 2 : 1, 0.55, frameNo % 64, 1 / 255);
      post.final.render(renderer, null);
    }

    renderer.autoClear = prevAutoClear;
    discontinuity = false;
  }

  // ------------------------------------------------------------------------------------------------ boot
  // Give the modules created after us sensible lighting values and a valid environment map right away.
  syncReversedDepth();
  size.h = Math.max(size.h, 360);
  F.uCameraPos.value.setFromMatrixPosition(camera.matrixWorld);
  updateLighting(0);
  atmosphere.update({ camAltitude: Math.max(F.uCameraPos.value.y, 0.5), sunDir: ctx.env.sunDir, moonDir: ctx.env.moonDir, sunIllum, moonIllum, keyDir, airglow });
  updateEnvironment();
  size.h = 2;

  const pipeline = {
    atmosphere: { uniforms: atmosphere.uniforms, glsl: ATMOSPHERE_GLSL },
    sceneTarget, depthTexture,
    setSize, render,
    // ---- additions (compatible) ----
    shadow: { glsl: SUN_SHADOW_API_GLSL, uniforms: shadowUniforms },
    hdrTarget, lighting, keyLight: key,
    get exposure() { return exposure; },
    get internalSize() { return { width: size.w, height: size.h, scale: drs }; },
    resetHistory() { taaReset = true; snapFrames = Math.max(snapFrames, 2); },
    debug: { atmosphere, env, caps, get state() { return { exposure, logLum, occl, kDirect, Fpl, keyIsMoon, keyFade, sunVis, drs, flash, probeValid, meterValid, csm }; } },
  };
  return pipeline;
}
