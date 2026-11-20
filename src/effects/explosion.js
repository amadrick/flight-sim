// Volumetric fuel-air fireball + soot plume for crashes, driven by the neural fireball (src/neural/fireball.js).
//
// Per fireball:
//   1. field bake (GPU): the network is evaluated at every texel of a 40 x 16 x 40 RGBA16F 3-D texture spanning the
//      learned, time-dependent box (y mirrored) -> (soot density, temperature excess, burning rate). One draw per
//      slice, re-baked whenever the fireball time has advanced enough (every frame in the first seconds, then
//      every ~0.3-1 s; the field evolves slowly once the cap has formed).
//   2. light bake (GPU): sun/moon transmittance and sky visibility per texel by marching the baked soot toward the
//      key light and upward (10 + 5 fetches per texel).
//   3. view march: a box mesh (back faces, depth test off, manual occlusion against the scene depth) ray-marches the
//      field with 20-56 steps by quality; sub-grid turbulence from the shared 3-D noise (advected with the rising
//      gas) erodes the soot surface and breaks the hot core into cracks; soot emits as a blackbody at its
//      temperature (emission-absorption), scatters sun/moon/sky and the fire's own light (fx point light), and is
//      graded at night like every lit medium (fxFinish).
// Everything is on LAYERS.POST, premultiplied HDR.
import * as THREE from 'three';
import { LAYERS } from '../core/constants.js';
import { FULLSCREEN_VERT, FullscreenPass } from '../core/glsl.js';
import { premulMaterialOpts } from './fxglsl.js';
import { decodeFireball, fireballGLSL, packFireballWeights, fireballBox, fireballEval, FIREBALL_MODEL } from '../neural/fireball.js';

const NXB = 40, NYB = 16, NZB = 40;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const FIREBALL_T_END = FIREBALL_MODEL.enc.tMax;

// Normalised blackbody colour/brightness (Wien approximation at 610 / 550 / 465 nm, = 1 in G at 1500 K)
export function blackbody(TK, out = [0, 0, 0]) {
  const t = Math.max(TK, 300);
  out[0] = 0.5957 * Math.exp(17.44 - 23587 / t);
  out[1] = Math.exp(17.44 - 26160 / t);
  out[2] = 2.3125 * Math.exp(17.44 - 30942 / t);
  return out;
}

const BB_GLSL = /* glsl */`
vec3 fbBlackbody(float TK) {
  float t = max(TK, 300.0);
  return vec3(0.5957 * exp(17.44 - 23587.0 / t), exp(17.44 - 26160.0 / t), 2.3125 * exp(17.44 - 30942.0 / t));
}`;

export function createFireballSystem(ctx, shared, header, maxCount = 2) {
  const net = decodeFireball();
  const packed = packFireballWeights(net);
  const wTex = new THREE.DataTexture(packed.data, packed.width, packed.rows, THREE.RGBAFormat, THREE.FloatType);
  wTex.minFilter = wTex.magFilter = THREE.NearestFilter; wTex.needsUpdate = true;
  const netGlsl = fireballGLSL(net);
  const raw = ctx.params?.raw || {};

  // ---- bake materials (shared by all fireballs; per-bake uniforms swapped in) ----
  const bakeU = {
    tFbWeights: { value: wTex }, uFbCond: { value: new THREE.Vector2() }, uFbTime: { value: 0 },
    uFbBox: { value: new THREE.Vector4(-1, 1, 1, 1) }, uFbLayer: { value: 0 }, uFbMirror: { value: 0 },
  };
  const bakeMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, uniforms: bakeU,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */`precision highp float; precision highp int;
in vec2 vUv; out vec4 outColor;
uniform float uFbTime; uniform vec4 uFbBox; uniform float uFbLayer;
${netGlsl}
void main() {
  vec3 uvw = vec3(gl_FragCoord.xy / vec2(${NXB}.0, ${NYB}.0), (uFbLayer + 0.5) / ${NZB}.0);
  vec3 p = vec3(mix(uFbBox.x, uFbBox.y, uvw.x), uvw.y * uFbBox.z, uvw.z * uFbBox.w);
  vec3 f = fireballFields(p, uFbTime);
  // fade to zero at the box faces (the box is fitted to 99.6 % of the mass; keeps the sampled field compact)
  vec3 e = min(uvw, 1.0 - uvw);
  float edge = smoothstep(0.0, 0.08, min(min(e.x, e.z), 1.0 - uvw.y));
  // the network's residual error is a faint haze everywhere (log-space RMSE ~0.05-0.1): cut it off
  f = max(f - vec3(0.12, 0.08, 0.06), 0.0);
  outColor = vec4(f.x * edge, f.y * edge, f.z * edge, 1.0);
}`,
  });
  const bakePass = new FullscreenPass(bakeMat);

  const lightU = {
    tFbField: { value: null }, uFbBox: bakeU.uFbBox, uFbLayer: bakeU.uFbLayer, uFbMirror: bakeU.uFbMirror,
    uFbLightDir: { value: new THREE.Vector3(0, 0, 1) }, uFbExt: { value: 6 }, uFbFireSim: { value: new THREE.Vector3(0, 0, 0.3) },
  };
  const lightMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, uniforms: lightU,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */`precision highp float; precision highp sampler3D;
in vec2 vUv; out vec4 outColor;
uniform highp sampler3D tFbField; uniform vec4 uFbBox; uniform float uFbLayer; uniform float uFbMirror;
uniform vec3 uFbLightDir; uniform float uFbExt; uniform vec3 uFbFireSim;
float soot(vec3 p) {
  if (uFbMirror > 0.5) p.z = abs(p.z);
  vec3 uvw = vec3((p.x - uFbBox.x) / (uFbBox.y - uFbBox.x), abs(p.y) / uFbBox.z, p.z / uFbBox.w);
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.0;
  return texture(tFbField, uvw).x;
}
void main() {
  vec3 uvw = vec3(gl_FragCoord.xy / vec2(${NXB}.0, ${NYB}.0), (uFbLayer + 0.5) / ${NZB}.0);
  vec3 p = vec3(mix(uFbBox.x, uFbBox.y, uvw.x), uvw.y * uFbBox.z, uvw.z * uFbBox.w);
  float diag = length(vec3(uFbBox.y - uFbBox.x, 2.0 * uFbBox.z, uFbBox.w));
  float ds = diag / 10.0, tauS = 0.0, tauU = 0.0;
  for (int i = 0; i < 10; i++) tauS += soot(p + uFbLightDir * ds * (float(i) + 0.5));
  float du = uFbBox.w / 5.0;
  for (int i = 0; i < 5; i++) tauU += soot(p + vec3(0.0, 0.0, du * (float(i) + 0.5)));
  // toward the fire (the emission centroid): self-shadowing of the fire light on its own smoke
  vec3 tf = uFbFireSim - p; float lf = length(tf), tauF = 0.0;
  for (int i = 0; i < 6; i++) tauF += soot(p + tf * ((float(i) + 0.5) / 6.0));
  outColor = vec4(exp(-tauS * ds * uFbExt), exp(-tauU * du * uFbExt * 0.6), exp(-tauF * lf / 6.0 * uFbExt * 0.5), 1.0);
}`,
  });
  const lightPass = new FullscreenPass(lightMat);

  // ---- view material template ----
  const steps = () => Math.round(clamp(20 + 40 * ((ctx.quality?.particles ?? 0.7) - 0.4) / 0.6, 18, 56));
  function makeViewMaterial(fb) {
    const u = {
      ...shared,
      tFbField: { value: fb.rtA.texture }, tFbLight: { value: fb.rtB.texture },
      uFbBox: { value: fb.box4 }, uFbToSim: { value: fb.toSim }, uFbFromSim: { value: fb.fromSim }, uFbTime: { value: 0 }, uFbAge: { value: 0 },
      uFbD: { value: fb.D }, uFbExt: lightU.uFbExt, uFbTempK: { value: 0.7 }, uFbEmisK: { value: 2.0 },
      uFbFade: { value: 1 }, uFbMirror: { value: fb.mirror ? 1 : 0 }, uFbSteps: { value: steps() },
      uFbCentre: { value: new THREE.Vector3() }, uFbLightSim: { value: new THREE.Vector3(0, 0, 1) },
      uFbSun: { value: new THREE.Vector3() }, uFbAmbUp: { value: new THREE.Vector3() }, uFbAmbDn: { value: new THREE.Vector3() },
      uFbFirePos: { value: new THREE.Vector3() }, uFbFireColor: { value: new THREE.Vector3() }, uFbSeed: { value: Math.random() * 10 }, uFbDbg: { value: +(raw.fbdbg || 0) },
    };
    const m = new THREE.ShaderMaterial({
      ...premulMaterialOpts(), side: THREE.BackSide, depthTest: false, uniforms: u,
      vertexShader: header + /* glsl */`
out vec3 vPos;
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: '#define FX_FRAG\n' + header + BB_GLSL + /* glsl */`
in vec3 vPos; out vec4 outColor;
uniform highp sampler3D tFbField; uniform highp sampler3D tFbLight;
uniform vec4 uFbBox; uniform mat4 uFbToSim; uniform mat4 uFbFromSim; uniform float uFbTime; uniform float uFbAge; uniform float uFbD;
uniform float uFbExt; uniform float uFbTempK; uniform float uFbEmisK; uniform float uFbFade; uniform float uFbMirror;
uniform float uFbSteps; uniform vec3 uFbCentre; uniform vec3 uFbLightSim; uniform vec3 uFbSun; uniform vec3 uFbAmbUp;
uniform vec3 uFbAmbDn; uniform vec3 uFbFirePos; uniform vec3 uFbFireColor; uniform float uFbSeed; uniform float uFbDbg;
vec2 boxHit(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
  vec3 inv = 1.0 / rd, t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  return vec2(max(max(tn.x, tn.y), tn.z), min(min(tf.x, tf.y), tf.z));
}
void main() {
  vec3 rdW = normalize(vPos - uCameraPos);
  vec3 ro = (uFbToSim * vec4(uCameraPos, 1.0)).xyz;
  vec3 rd = mat3(uFbToSim) * rdW;
  float simPerM = length(rd); rd /= simPerM;
  vec3 bmin = vec3(uFbBox.x, -uFbBox.z, uFbMirror > 0.5 ? -uFbBox.w : 0.0), bmax = vec3(uFbBox.y, uFbBox.z, uFbBox.w);
  vec2 th = boxHit(ro, rd, bmin, bmax);
  float sceneD = fxSceneDist() * simPerM;
  float t0 = max(th.x, 0.0), t1 = min(th.y, sceneD);
  if (t1 <= t0) discard;
  float n = uFbSteps;
  float dt = (t1 - t0) / n;
  // keep the step no longer than ~a quarter of the baked voxel; shorten the march instead of under-sampling
  float maxDt = (uFbBox.y - uFbBox.x) / ${NXB}.0 * 1.6;
  if (dt > maxDt) { dt = maxDt; }
  float jit = fxHash12(gl_FragCoord.xy + fract(uFrame * 0.618) * 97.0);
  float T = 1.0;
  vec3 lit = vec3(0.0), emis = vec3(0.0), dbgS = vec3(0.0);
  float cosT = dot(rd, uFbLightSim);
  float phase = mix(fxHG(cosT, 0.55), fxHG(cosT, -0.2), 0.35) * 4.0 * FX_PI;
  float ageK = smoothstep(4.0, 40.0, uFbAge);
  vec3 albedo = mix(vec3(0.16, 0.15, 0.14), vec3(0.34, 0.33, 0.32), ageK);
  float rise = 0.18 + 0.1 * (1.0 - ageK);
  float t = t0 + dt * jit;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= n || t > t1 || T < 0.01) break;
    vec3 p = ro + rd * t;
    vec3 q = p; if (uFbMirror > 0.5) q.z = abs(q.z);
    // domain warp (sub-grid billows): the learned field is sampled at a turbulently displaced point, which breaks
    // the smooth envelope into lobes without moving mass far from where the network put it
    vec4 w0 = fxNoise(q * 0.32 + vec3(uFbSeed * 1.3, uFbSeed, -uFbTime * 0.12));
    vec3 qw = q + (w0.xyz - 0.5) * vec3(0.55, 0.55, 0.45);
    qw.z = max(qw.z, 0.0);
    vec3 uvw = vec3((qw.x - uFbBox.x) / (uFbBox.y - uFbBox.x), abs(qw.y) / uFbBox.z, qw.z / uFbBox.w);
    vec4 f = texture(tFbField, uvw);
    if (f.x + f.y > 0.004) {
      vec3 L = texture(tFbLight, uvw).xyz;
      // sub-grid turbulence: two octaves of the shared noise, carried up with the gas and slowly churning
      vec3 np = q * vec3(1.0, 1.0, 0.85) + vec3(uFbSeed, uFbSeed * 0.7, -uFbTime * rise);
      vec4 n1 = fxNoise(np * 0.45);
      vec4 n2 = fxNoise(np * 1.6 + (n1.xyz - 0.5) * 0.9);
      vec4 n3 = fxNoise(np * 4.1 + (n2.xyz - 0.5) * 0.5);
      float turb = n1.w * 0.5 + n2.w * 0.33 + n3.w * 0.17;
      float dens = max(f.x * (0.1 + 1.8 * turb * turb) - 0.05, 0.0);
      // temperature: hot cracks where the turbulence opens the soot shell
      float theta = f.y * (0.75 + 0.3 * smoothstep(0.35, 0.8, 1.0 - turb) + 0.1 * n3.x);
      float burn = f.z * (0.5 + n2.x);
      // young soot in the hot gas is optically thinner than the agglomerated smoke it becomes as it cools
      float hotK = mix(0.3, 1.0, smoothstep(3.5, 1.0, theta));
      float sig = (dens * hotK + 0.25 * burn) * uFbExt;
      float a = 1.0 - exp(-sig * dt);
      if (a > 1e-4) {
        float TK = min(300.0 * (1.0 + uFbTempK * theta), 1650.0);
        float TKf = max(TK, 1380.0 * smoothstep(0.2, 1.5, burn));
        vec3 E = uFbEmisK * (fbBlackbody(TK) * dens * hotK + fbBlackbody(TKf) * 0.25 * burn * 2.0) / max(dens * hotK + 0.25 * burn, 1e-4);
        vec3 sun = uFbSun * L.x * phase / (4.0 * FX_PI);
        vec3 amb = mix(uFbAmbDn, uFbAmbUp, 0.35 + 0.65 * L.y) * (0.45 + 0.55 * L.y);
        vec3 pR = (uFbFromSim * vec4(p, 1.0)).xyz;
        vec3 dl = uFbFirePos - pR;
        vec3 fire = uFbFireColor / (dot(dl, dl) + 0.08 * uFbD * uFbD) * L.z * 1.0;
        lit += T * a * albedo * (sun + amb + fire / FX_PI);
        dbgS += T * a * vec3(sun.g, amb.g, fire.g / FX_PI);
        emis += T * a * E;
        T *= 1.0 - a;
      }
    }
    t += dt;
  }
  float alpha = (1.0 - T) * uFbFade;
  if (alpha < 0.002 && dot(emis, vec3(1.0)) < 0.002) discard;
  // exposure-aware soft limit of the emission (night: the auto-exposure is up to 40x; keep the core from turning
  // into a flat white disc while staying far above white)
  vec3 e = emis * uFbFade * uFxExposure;
  float le = dot(e, vec3(0.2126, 0.7152, 0.0722));
  e *= 1.0 / (1.0 + pow(max(le, 0.0) / 60.0, 0.75));
  if (uFbDbg > 4.5) { vec3 st = step(vec3(1.0), dbgS) * 0.5 + step(vec3(10.0), dbgS) * 0.5; outColor = vec4(st * 0.2, 1.0); return; }
  if (uFbDbg > 3.5) { float l = dot(lit, vec3(0.33)); bool bad = isnan(l) || isinf(l); vec3 fs = uFbFireColor / (0.04 * uFbD * uFbD + 1e-6); outColor = vec4(bad ? 1.0 : 0.0, clamp(log(1.0 + l) / 4.0, 0.0, 1.0), clamp(log(1.0 + fs.x) / 8.0, 0.0, 1.0), 1.0); return; }
  if (uFbDbg > 2.5) { outColor = vec4(lit, alpha); return; }
  if (uFbDbg > 1.5) { outColor = vec4(e / uFxExposure, 0.0); return; }
  if (uFbDbg > 0.5) { outColor = vec4(vec3(alpha) * 0.3, alpha); return; }
  outColor = fxFinish(lit * uFbFade, alpha, e / uFxExposure, uFbCentre);
}`,
    });
    return m;
  }

  // ---- fireball instances ----
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const pool = [];
  for (let i = 0; i < maxCount; i++) {
    const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    const rtA = new THREE.WebGL3DRenderTarget(NXB, NYB, NZB, opts);
    const rtB = new THREE.WebGL3DRenderTarget(NXB, NYB, NZB, opts);
    for (const rt of [rtA, rtB]) { rt.texture.wrapS = rt.texture.wrapT = rt.texture.wrapR = THREE.ClampToEdgeWrapping; }
    const fb = {
      active: false, rtA, rtB, box: {}, box4: new THREE.Vector4(), toSim: new THREE.Matrix4(), fromSim: new THREE.Matrix4(),
      worldPos: new THREE.Vector3(), dir: new THREE.Vector3(1, 0, 0), D: 50, tStar: 2.26, fw: 0, ui: 0, mirror: false,
      age: 0, bakedT: -1, bakedBox: new THREE.Vector4(), lightDirBaked: new THREE.Vector3(), fade: 1, life: 120, drift: new THREE.Vector3(),
      power: 0, centroid: new THREE.Vector3(), color: [1, 0.5, 0.2],
    };
    fb.mat = makeViewMaterial(fb);
    fb.mesh = new THREE.Mesh(unitBox, fb.mat);
    fb.mesh.frustumCulled = false; fb.mesh.layers.set(LAYERS.POST); fb.mesh.renderOrder = 12; fb.mesh.visible = false;
    fb.mesh.matrixAutoUpdate = false; fb.mesh.name = 'fx-fireball';
    ctx.scene.add(fb.mesh);
    pool.push(fb);
  }

  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _c = [0, 0, 0], _ev = {};
  const keyDir = new THREE.Vector3(), _lsim = new THREE.Vector3();

  function bake(fb, tSim) {
    const r = ctx.renderer;
    const prevRT = r.getRenderTarget(), prevFace = r.getActiveCubeFace(), prevMip = r.getActiveMipmapLevel();
    const tEval = fb.mirror ? Math.min(tSim, 3.0) : Math.min(tSim, FIREBALL_T_END);
    fireballBox(tEval, fb.fw, fb.box);
    fb.box4.set(fb.box.x0, fb.box.x1, fb.box.y1, fb.box.z1);
    bakeU.uFbBox.value.copy(fb.box4); bakeU.uFbTime.value = tEval; bakeU.uFbCond.value.set(fb.fw, fb.ui); bakeU.uFbMirror.value = fb.mirror ? 1 : 0;
    for (let k = 0; k < NZB; k++) { bakeU.uFbLayer.value = k; r.setRenderTarget(fb.rtA, k); r.render(bakePass.scene, bakeCam); }
    lightU.tFbField.value = fb.rtA.texture;
    lightU.uFbLightDir.value.copy(fb.lightDirBaked); lightU.uFbFireSim.value.copy(fb.centroid);
    for (let k = 0; k < NZB; k++) { bakeU.uFbLayer.value = k; r.setRenderTarget(fb.rtB, k); r.render(lightPass.scene, bakeCam); }
    r.setRenderTarget(prevRT, prevFace, prevMip);
    fb.bakedT = tSim;
    // CPU probe of the same network (4 x 2 x 4 points): hottest gas temperature, burning and the emission centroid,
    // which drive the fx point light (smooth in time; the emitted power itself is too spiky to sample this coarsely)
    let th = [0, 0, 0, 0], burn = 0, cx = 0, cz = 0, cw = 0;
    const b = fb.box, N = 4;
    for (let i = 0; i < N; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < N; k++) {
      const x = b.x0 + (b.x1 - b.x0) * (i + 0.5) / N, y = b.y1 * (j + 0.5) / 2 * 0.6, z = b.z1 * (k + 0.5) / N * 0.8;
      fireballEval(net, x, y, z, tEval, fb.fw, fb.ui, _ev);
      if (_ev.theta > th[3]) { th[3] = _ev.theta; th.sort((p, q) => q - p); }
      burn += _ev.burn;
      const w = _ev.theta * _ev.theta * (Math.min(_ev.soot, 2) + _ev.burn);
      cx += w * x; cz += w * z; cw += w;
    }
    const thm = (th[0] + th[1] + th[2] + th[3]) / 4;
    const TK = 300 * (1 + fb.mat.uniforms.uFbTempK.value * thm);
    blackbody(TK, _c);
    const lum = 0.2126 * _c[0] + 0.7152 * _c[1] + 0.0722 * _c[2];
    fb.power = clamp(lum / 1.42, 0, 3) + clamp(burn / (N * N * 2) * 4, 0, 1);
    if (cw > 1e-9) fb.centroid.set(cx / cw, 0, Math.max(0.15, cz / cw));
    // once the fireball has lifted off, what lights the smoke from below is the pool fire on the ground: move the
    // fire light down to it and keep a floor on its power (the coarse probe misses the thin burning layer)
    const pk = fb.mirror ? 0 : clamp((tEval - 2) / 4, 0, 1);
    if (pk > 0) { fb.centroid.lerp(_v2.set(0.1, 0, 0.12), pk); fb.power = Math.max(fb.power, 0.55 * pk); }
    const mx = Math.max(_c[0], _c[1], _c[2], 1e-9); fb.color = [_c[0] / mx, Math.max(0.25, _c[1] / mx), Math.max(0.05, _c[2] / mx)];
    if (pk > 0) { const w = pk * 0.7; fb.color = [fb.color[0] * (1 - w) + w, fb.color[1] * (1 - w) + 0.45 * w, fb.color[2] * (1 - w) + 0.12 * w]; }
  }
  const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function placeMatrices(fb) {
    // sim -> render: x = downwind dir, y = up x dir, z = world up; scaled by D
    ctx.world.toRender(fb.worldPos, _v);
    const d = fb.dir, D = fb.D;
    fb.fromSim.set(d.x * D, d.z * D, 0, _v.x, 0, 0, D, _v.y, d.z * D, -d.x * D, 0, _v.z, 0, 0, 0, 1);
    fb.toSim.copy(fb.fromSim).invert();
    // box mesh: unit cube -> sim box -> render
    const b = fb.box4, zmin = fb.mirror ? -b.w : 0;
    _m.makeScale(b.y - b.x, 2 * b.z, b.w - zmin).setPosition((b.x + b.y) / 2, 0, (b.w + zmin) / 2);
    fb.mesh.matrix.multiplyMatrices(fb.fromSim, _m);
    fb.mesh.matrixWorldNeedsUpdate = true;
    fb.mat.uniforms.uFbCentre.value.set((b.x + b.y) / 2, 0, (b.w + zmin) * 0.35).applyMatrix4(fb.fromSim);
  }

  const sys = {
    pool,
    /** opts: { worldPos (ground point, world), D (m), tStar (s), windDir (world unit, horizontal), fw, ui, mirror (airborne) } */
    spawn(o) {
      let fb = pool.find((f) => !f.active) || pool.reduce((a, f) => (f.age > a.age ? f : a), pool[0]);
      fb.active = true; fb.age = 0; fb.bakedT = -1; fb.fade = 1;
      fb.worldPos.copy(o.worldPos); fb.D = o.D; fb.tStar = o.tStar || Math.sqrt(o.D / 9.81);
      fb.dir.copy(o.windDir || _v2.set(1, 0, 0)).setY(0); if (fb.dir.lengthSq() < 1e-6) fb.dir.set(1, 0, 0); fb.dir.normalize();
      fb.fw = clamp(o.fw || 0, 0, 1.2); fb.ui = clamp(o.ui || 0, 0, 2.5); fb.mirror = !!o.mirror;
      fb.life = o.life ?? 150; fb.drift.copy(o.drift || _v2.set(0, 0, 0));
      const u = fb.mat.uniforms;
      u.uFbD.value = fb.D; u.uFbMirror.value = fb.mirror ? 1 : 0; u.uFbSeed.value = Math.random() * 10;
      if (raw.fbtemp) u.uFbTempK.value = +raw.fbtemp;
      if (raw.fbemis) u.uFbEmisK.value = +raw.fbemis;
      fb.mesh.visible = raw.fboff !== '1';
      sys.updateOne(fb, 0, true);
      return fb;
    },
    updateOne(fb, dt, force = false) {
      fb.age += dt;
      const tSim = fb.age / fb.tStar;
      if (fb.mirror && fb.age > 0) fb.worldPos.addScaledVector(fb.drift, dt);
      // past the end of the simulated window the field is frozen: carry the whole cloud with the wind (and a slow
      // residual rise) so a lingering cloud keeps drifting instead of hanging still
      else if (tSim > FIREBALL_T_END) { const w = fb.fw * Math.sqrt(9.81 * fb.D); fb.worldPos.addScaledVector(fb.dir, w * 0.8 * dt); fb.worldPos.y += 0.5 * dt; }
      // fade: airborne fireballs disperse after the burn; ground ones live as long as the smoke lingers
      const life = fb.life;
      fb.fade = fb.mirror ? clamp(1 - (fb.age - 25) / 35, 0, 1) : clamp(1 - (fb.age - life * 0.6) / (life * 0.4), 0, 1);
      if (fb.fade <= 0) { fb.active = false; fb.mesh.visible = false; return; }
      // key light in sim frame (sun by day, moon at night)
      keyDir.copy(ctx.pipeline?.lighting?.keyDir || ctx.env.sunDir || _v2.set(0, 1, 0));
      if (keyDir.y < 0.02) keyDir.y = 0.02;
      keyDir.normalize();
      const lsim = _lsim.set(keyDir.x * fb.dir.x + keyDir.z * fb.dir.z, keyDir.x * fb.dir.z - keyDir.z * fb.dir.x, keyDir.y);
      // re-bake when the time moved enough (log time) or the light moved
      const tl = Math.log1p(tSim / 0.25), tlB = Math.log1p(Math.max(fb.bakedT, 0) / 0.25);
      const need = force || fb.bakedT < 0 || Math.abs(tl - tlB) > (raw.fbbake ? +raw.fbbake : ctx.params?.test ? 0.05 : 0.02) || lsim.distanceTo(fb.lightDirBaked) > 0.05;
      if (need && (tSim <= FIREBALL_T_END + 0.5 || fb.bakedT < FIREBALL_T_END)) { fb.lightDirBaked.copy(lsim); bake(fb, tSim); }
      placeMatrices(fb);
      const u = fb.mat.uniforms;
      u.uFbTime.value = tSim; u.uFbAge.value = fb.age; u.uFbFade.value = fb.fade; u.uFbSteps.value = steps();
      u.uFbLightSim.value.copy(lsim);
      // sun/moon + ambient at the fireball centre (once per frame on the CPU side would need the atmosphere; use frame values)
      const night = ctx.env.nightFactor || 0;
      const sc = ctx.env.sunColor, ms = 0.004 * night;
      u.uFbSun.value.set(sc.r + ms, sc.g + ms, sc.b + ms * 1.1);
      const as = ctx.env.ambientSky, ag = ctx.env.ambientGround;
      u.uFbAmbUp.value.set(as.r, as.g, as.b); u.uFbAmbDn.value.set(ag.r, ag.g, ag.b);
      // the fire's own light on its smoke: from the emission centroid
      _v2.copy(fb.centroid).applyMatrix4(fb.fromSim);
      u.uFbFirePos.value.copy(_v2);
      const fl = sys.lightPower(fb);
      u.uFbFireColor.value.set(fb.color[0] * fl, fb.color[1] * fl, fb.color[2] * fl);
    },
    /** radiant intensity scale of the fire light (contract units: irradiance = I / d^2) */
    lightPower(fb) { return fb.power * fb.D * fb.D * 0.5 * fb.fade; },
    update(dt) { for (const fb of pool) if (fb.active) sys.updateOne(fb, dt); },
    /** brightest active fireball for the fx light: { pos (render), color, intensity, distance } or null */
    light(out) {
      let best = null, bi = 0;
      for (const fb of pool) if (fb.active) { const I = sys.lightPower(fb); if (I > bi) { bi = I; best = fb; } }
      if (!best || bi < 1) return null;
      out.pos.copy(best.centroid).applyMatrix4(best.fromSim);
      out.color.setRGB(best.color[0], best.color[1], best.color[2]);
      out.intensity = bi; out.distance = best.D * 12;
      return out;
    },
    active() { return pool.some((f) => f.active); },
    /** debug: read back slice `layer` of a fireball's field (or light) volume -> Float32Array RGBA NXB x NYB */
    debugRead(i = 0, layer = 10, light = false) {
      const fb = pool[i], r = ctx.renderer;
      if (!sys._dbg) {
        sys._dbgRT = new THREE.WebGLRenderTarget(NXB, NYB, { type: THREE.FloatType, depthBuffer: false });
        sys._dbgU = { tV: { value: null }, uW: { value: 0 } };
        sys._dbg = new FullscreenPass(new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, uniforms: sys._dbgU, vertexShader: FULLSCREEN_VERT,
          fragmentShader: 'precision highp float; precision highp sampler3D; in vec2 vUv; out vec4 o; uniform sampler3D tV; uniform float uW; void main() { o = texture(tV, vec3(gl_FragCoord.xy / vec2(' + NXB + '.0, ' + NYB + '.0), uW)); }' }));
      }
      sys._dbgU.tV.value = light ? fb.rtB.texture : fb.rtA.texture; sys._dbgU.uW.value = (layer + 0.5) / NZB;
      const prev = r.getRenderTarget();
      sys._dbg.render(r, sys._dbgRT);
      const out = new Float32Array(NXB * NYB * 4);
      r.readRenderTargetPixels(sys._dbgRT, 0, 0, NXB, NYB, out);
      r.setRenderTarget(prev);
      let mx = [0, 0, 0, 0]; for (let k = 0; k < out.length; k++) mx[k & 3] = Math.max(mx[k & 3], out[k]);
      return { max: mx, box: { ...fb.box }, age: fb.age, active: fb.active, visible: fb.mesh.visible, bakedT: fb.bakedT, power: fb.power, matrix: Array.from(fb.mesh.matrix.elements).map((v) => +v.toFixed(2)) };
    },
    clear() { for (const fb of pool) { fb.active = false; fb.mesh.visible = false; } },
    /** compile the programs and run one bake at boot so the first crash does not stall */
    warm() {
      const t0 = performance.now();
      const fb = pool[0];
      fb.worldPos.set(0, -5000, 0); fb.D = 50; fb.tStar = 2.26; fb.fw = 0.3; fb.ui = 1;
      fb.lightDirBaked.set(0, 0, 1);
      bake(fb, 0.5);
      placeMatrices(fb);
      fb.mesh.visible = true;
      try { ctx.renderer.compile(fb.mesh, ctx.camera); } catch { /* compile is an optimisation only */ }
      for (const f of pool) { if (f !== fb) { f.mat.needsUpdate = false; } }
      fb.mesh.visible = false;
      return performance.now() - t0;
    },
    dispose() {
      for (const fb of pool) { ctx.scene.remove(fb.mesh); fb.mat.dispose(); fb.rtA.dispose(); fb.rtB.dispose(); }
      unitBox.dispose(); bakePass.dispose(); lightPass.dispose(); wTex.dispose();
    },
  };
  return sys;
}
