// Ocean — GPU FFT (Tessendorf) wave cascades + footprint-filtered microfacet shading on a camera-centred polar grid.
// API: createWater(ctx) -> { update(dt), object3D, heightAt(x, z) }   (heightAt = current wave height, world x/z, metres)
//
// Files: spectrum.js (wave physics, CPU tables), fft.js (GPU FFT), shaders.js (surface), textures.js (procedural
// noise/foam), harness.js (isolated test entry). See INTEGRATION.md for costs and integration notes.
import * as THREE from 'three';
import { createOceanFFT } from './fft.js';
import * as Spectrum from './spectrum.js';
const { makeSeaState, varianceTables, componentsFor, evalHeight, LEVELS } = Spectrum;
import { waterVertexShader, waterFragmentShader } from './shaders.js';
import * as Classic from './shaders-classic.js';
import { makeNoiseTexture, makeFoamTexture } from './textures.js';
import { createInlandWater } from './inland.js';

const EARTH_R = 6371000;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mod = (a, m) => ((a % m) + m) % m;

/** Polar grid: S segments; rings at k*c0 up to r ≈ c0/alpha, then geometric (1 + alpha) spacing out to `reach`. */
function buildPolarMesh(S, c0, reach) {
  const alpha = (2 * Math.PI) / S;
  const radii = [];
  const K0 = Math.ceil(1 / alpha);
  for (let k = 1; k <= K0; k++) radii.push(k * c0);
  let r = K0 * c0;
  while (r < reach) { r *= 1 + alpha; radii.push(r); }
  const nv = 1 + radii.length * S;
  const pos = new Float32Array(nv * 3);
  let v = 1;
  for (const rr of radii) for (let s = 0; s < S; s++) { const a = (s / S) * 2 * Math.PI; pos[v * 3] = Math.cos(a) * rr; pos[v * 3 + 2] = Math.sin(a) * rr; v++; }
  const idx = new Uint32Array(S * 3 + (radii.length - 1) * S * 6);
  let i = 0;
  for (let s = 0; s < S; s++) { idx[i++] = 0; idx[i++] = 1 + ((s + 1) % S); idx[i++] = 1 + s; }
  for (let ring = 0; ring < radii.length - 1; ring++) {
    const a0 = 1 + ring * S, b0 = 1 + (ring + 1) * S;
    for (let s = 0; s < S; s++) {
      const s1 = (s + 1) % S;
      idx[i++] = a0 + s; idx[i++] = a0 + s1; idx[i++] = b0 + s;
      idx[i++] = a0 + s1; idx[i++] = b0 + s1; idx[i++] = b0 + s;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return { geometry: g, alpha, c0, vertices: nv, triangles: idx.length / 3 };
}

function detailConfig(d) {
  d = d ?? 1;
  return {
    N: d >= 0.95 ? 256 : 128,
    S: d >= 0.95 ? 320 : d >= 0.7 ? 256 : 160,
    c0: d >= 0.95 ? 0.25 : d >= 0.7 ? 0.3 : 0.45,
  };
}

const CASCADE_L = [1000, 137, 19.3];   // non-commensurate patch sizes hide tiling

export async function createWater(ctx) {
  const { renderer } = ctx;
  const atm = ctx.pipeline?.atmosphere || { glsl: '', uniforms: {} };
  const terrainGLSL = ctx.terrain?.heightGLSL || 'float terrainHeight(vec2 w) { return -1000.0; }';
  const terrainUniforms = ctx.terrain?.heightUniforms || {};

  // SwiftShader (headless tests) implements anisotropic filtering with axis-aligned streak artifacts: disable there.
  let software = false;
  try {
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    software = /swiftshader|llvmpipe|software/i.test(String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)));
  } catch { /* ignore */ }
  const aniso = () => (ctx.params.raw?.waniso ? +ctx.params.raw.waniso : software ? 1 : Math.min(16, ctx.quality.anisotropy || 4));
  // water=classic restores the original look (A/B comparison); anything else = the current shading
  const classic = String(ctx.params.raw?.water || '') === 'classic';
  const noiseTex = makeNoiseTexture(256, (ctx.params.seed | 0) + 11);
  const foamTex = makeFoamTexture(256, (ctx.params.seed | 0) + 23);
  noiseTex.anisotropy = foamTex.anisotropy = Math.min(8, aniso());

  const cascadeDefs = CASCADE_L.map((L, i) => ({
    L,
    kLo: i === 0 ? 0 : (6 * 2 * Math.PI) / L,
    kHi: i === CASCADE_L.length - 1 ? 1e9 : (6 * 2 * Math.PI) / CASCADE_L[i + 1],
  }));

  const uniforms = {
    ...ctx.uniforms.frame, ...atm.uniforms, ...terrainUniforms,
    tDisp0: { value: null }, tDisp1: { value: null }, tDisp2: { value: null },
    tSlope0: { value: null }, tSlope1: { value: null }, tSlope2: { value: null },
    tFoamTex: { value: foamTex }, tNoise: { value: noiseTex },
    uCasc: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uMesh: { value: new THREE.Vector4(0, 0, 1, 40000) },
    uGrid: { value: new THREE.Vector2(0.25, 0.02) },
    uShoreFade: { value: 6 },
    uVar: { value: Array.from({ length: 30 }, () => new THREE.Vector2()) },
    uVarTail: { value: new THREE.Vector2(0.005, 0.005) },
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uOriginWrap: { value: new THREE.Vector4() },
    uFoamW: { value: new THREE.Vector3(1, 0.8, 0.15) },
    uSea: { value: new THREE.Vector4(5, 1, 0.5, 8) },
    uMoonK: { value: 0 },
    uFoam: { value: new THREE.Vector3(0.35, 2.5, 0) },
    uStreak: { value: new THREE.Vector3() },
    uSlickOff: { value: new THREE.Vector2() },
    uDispScale: { value: ctx.params.raw?.wdisp !== undefined ? +ctx.params.raw.wdisp : 1 },
    uDebug: { value: +(ctx.params.raw?.wdebug || 0) },
    uShore: { value: new THREE.Vector4(0.8, 10, 1.6, 0.5) },
    uWaveDir: { value: new THREE.Vector2(1, 0) },
    uCatOff: { value: new THREE.Vector2() },
    uWeather: { value: new THREE.Vector4(0, 200, 1, 0) },
    uWash: { value: new THREE.Vector4() },
    uWashV: { value: new THREE.Vector4(1, 0, 100, 10) },
  };

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: (classic ? Classic.waterVertexShader : waterVertexShader)(terrainGLSL, atm.glsl),
    fragmentShader: (classic ? Classic.waterFragmentShader : waterFragmentShader)(terrainGLSL, atm.glsl),
  });
  material.fog = false; material.toneMapped = false;
  if (!classic) {
    // premultiplied output: alpha = 1 - transmittance (the shallow seabed / wet beach show through); the target's own
    // alpha is left untouched
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor; material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.ZeroFactor; material.blendDstAlpha = THREE.OneFactor;
  }
  // Reflected clouds need the clouds module's shadow-map GLSL; clouds are created after the ocean, so the fragment
  // shader is rebuilt once when they appear (before the first frame in the sim, so it compiles only once).
  let cloudsHooked = classic;
  function hookClouds() {
    const cl = ctx.clouds;
    if (cloudsHooked || !cl || typeof cl.shadowGLSL !== 'string' || !cl.shadowGLSL.includes('cloudShadowTau')) return;
    cloudsHooked = true;
    if (ctx.params.raw?.wclouds === '0') return;
    Object.assign(uniforms, cl.shadowUniforms);
    material.fragmentShader = waterFragmentShader(terrainGLSL, atm.glsl, { cloudsGLSL: cl.shadowGLSL });
    material.needsUpdate = true;
    inland?.hookClouds(cl);
  }

  let cfg = null, fft = null, mesh = null, meshInfo = null;
  const object3D = new THREE.Group();
  object3D.name = 'ocean';
  ctx.scene.add(object3D);

  function build() {
    const next = detailConfig(ctx.quality.waterDetail);
    if (cfg && next.N === cfg.N && next.S === cfg.S && next.c0 === cfg.c0) return;
    if (!cfg || next.N !== cfg.N) {
      fft?.dispose();
      fft = createOceanFFT(renderer, { N: next.N, cascades: cascadeDefs, seed: ctx.params.seed | 0, anisotropy: aniso() });
      lastSea.U = -1;
    }
    if (!cfg || next.S !== cfg.S || next.c0 !== cfg.c0) {
      if (mesh) { object3D.remove(mesh); mesh.geometry.dispose(); }
      meshInfo = buildPolarMesh(next.S, next.c0, 40000);
      mesh = new THREE.Mesh(meshInfo.geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;     // after terrain/scenery: early-z rejects ocean fragments under land
      mesh.matrixAutoUpdate = false;
      object3D.add(mesh);
      uniforms.uGrid.value.set(meshInfo.c0, meshInfo.alpha);
    }
    cfg = next;
  }

  // ---- sea state from weather ----------------------------------------------------------------------------------
  const lastSea = { U: -1, angle: 0, t: -1e9 };
  let comps = new Float64Array(0);
  let sea = null;
  function windState() {
    const w = ctx.weather.wind;
    const forced = ctx.params.raw?.wwind;     // wwind=<m/s>: force the sea state (debug / glassy calm tests)
    const U = forced !== undefined && isFinite(+forced) ? Math.max(0.2, +forced) : Math.max(0.5, ctx.weather.windSpeed ?? Math.hypot(w.x, w.z));
    const angle = Math.hypot(w.x, w.z) > 1e-3 ? Math.atan2(w.z, w.x) : 0;
    return { U, angle };
  }
  function seaParams(U) {
    const k = smooth(4, 17, U);
    return {
      chop: 0.85 + 0.55 * k,
      foamBias: 0.76,      // per-cascade trail threshold (each cascade's own Jacobian rarely folds)
      foamGain: 3.0,
    };
  }
  function refreshSea(force) {
    const { U, angle } = windState();
    const now = ctx.time.real;
    const dA = Math.abs(Math.atan2(Math.sin(angle - lastSea.angle), Math.cos(angle - lastSea.angle)));
    const changed = Math.abs(U - lastSea.U) > 0.15 || dA > 0.01;
    if (!force && (!changed || now - lastSea.t < 0.4)) return;
    lastSea.U = U; lastSea.angle = angle; lastSea.t = now;
    sea = makeSeaState(U, angle);
    const sp = seaParams(U);
    fft.setSeaState(sea, sp);
    fft.foamLife = 2 + 5 * smooth(5, 17, U);    // whitecap foam lingers longer in strong wind
    const defs = cascadeDefs.map((c) => ({ ...c, N: cfg.N }));
    const vt = varianceTables(sea, defs);
    for (let c = 0; c < 3; c++) for (let l = 0; l < LEVELS; l++) uniforms.uVar.value[c * 10 + l].set(vt.table[(c * LEVELS + l) * 2], vt.table[(c * LEVELS + l) * 2 + 1]);
    uniforms.uVarTail.value.set(vt.tail[0], vt.tail[1]);
    uniforms.uWindDir.value.set(Math.cos(angle), Math.sin(angle));
    const hs = 4 * Math.sqrt(Math.max(1e-6, estimateVarH(sea)));
    uniforms.uSea.value.set(U, hs, 0.35 + 0.65 * smooth(2, 14, U), aniso());
    uniforms.uShoreFade.value = classic ? Math.max(4, 2.2 * hs) : Math.max(1.5, 1.3 * hs);
    // surf: breaker height from the incoming sea (swell + wind sea), period of the swell, run-up and wet beach
    const Hb = Math.min(3.5, 0.35 + 0.7 * hs);
    const Tp = Math.min(14, Math.max(5, (2 * Math.PI) / Math.max(sea.swell.wp, 1e-3)));
    const runup = 0.12 + 0.45 * Hb;
    uniforms.uShore.value.set(Hb, Tp, runup + 0.45 + 0.25 * Hb, runup);
    uniforms.uWaveDir.value.set(Math.cos(sea.swellAngle), Math.sin(sea.swellAngle));
    uniforms.uWeather.value.y = 0.6 * U;           // facets per m² that mirror the sun disc at the lobe peak
    uniforms.uWeather.value.w = 1 - smooth(1, 4, U);
    // Crest foam threshold from statistics: linearised J = 1 + chop·(Dxx + Dzz) and Dxx + Dzz = |k| h~, so
    // var(J) = chop² × slope variance of each cascade (weights as in the shader). Threshold at m standard deviations,
    // m(U) chosen so the Gaussian tail matches Monahan's whitecap fraction (0.3 % @ 7 m/s, 1.8 % @ 12, 6 % @ 17).
    const wJ = [1.3, 1.25, 0.45];
    let varJ = 0;
    const T = vt.table, at = (c, l) => T[(c * LEVELS + l) * 2] + T[(c * LEVELS + l) * 2 + 1];
    for (let c = 0; c < 3; c++) varJ += wJ[c] * wJ[c] * (at(c, LEVELS - 1) - at(c, 0));   // resolved part only
    const sigJ = sp.chop * Math.sqrt(varJ);
    const m = Math.min(4, Math.max(1.0, 2.9 - 0.12 * U));     // tuned against renders (mip blur, gust modulation)
    const monahan = Math.min(0.12, 3.84e-6 * Math.pow(U, 3.41));
    uniforms.uFoam.value.set(U < 3 ? -10 : 1 - m * sigJ, 1 / Math.max(0.02, 1.1 * sigJ), monahan * 2.0);
    comps = componentsFor(sea, defs.slice(0, 2), fft.cascades.slice(0, 2).map((c) => c.gauss), 64, 16, comps);
  }
  // height variance by radial integration (for crest normalisation / shore fade)
  function estimateVarH(s) {
    let v = 0; const nk = 80, nt = 24, l0 = Math.log(0.005), l1 = Math.log(30);
    for (let a = 0; a < nk; a++) {
      const k = Math.exp(l0 + ((a + 0.5) / nk) * (l1 - l0)), dk = k * (l1 - l0) / nk;
      for (let b = 0; b < nt; b++) { const t = (b / nt) * 2 * Math.PI; v += s.psi(k * Math.cos(t), k * Math.sin(t)) * k * dk * (2 * Math.PI / nt); }
    }
    return v;
  }

  build();
  // rivers (wriver=0 disables; off on low quality and in the classic look)
  let inland = null;
  if (!classic && ctx.params.raw?.wriver !== '0' && ctx.quality.level !== 'low') {
    inland = createInlandWater(ctx, { buildPolarMesh, uniforms, terrainGLSL, atm });
    if (inland) object3D.add(inland.mesh);
  }
  refreshSea(true);
  ctx.events.on('quality:change', () => { build(); refreshSea(true); });
  ctx.events.on('weather:change', () => { lastSea.t = -1e9; });

  const camW = new THREE.Vector3();
  const dispU = [uniforms.tDisp0, uniforms.tDisp1, uniforms.tDisp2], slopeU = [uniforms.tSlope0, uniforms.tSlope1, uniforms.tSlope2];
  const washPos = new THREE.Vector3();
  function update(dt) {
    hookClouds();
    build();
    refreshSea(false);
    fft.update(ctx.time.now, dt || 0);
    const o = ctx.world.origin;
    for (let c = 0; c < 3; c++) {
      const fc = fft.cascades[c];
      dispU[c].value = fc.disp; slopeU[c].value = fc.slope;
      uniforms.uCasc.value[c].set(mod(o.x, fc.L), mod(o.z, fc.L), 1 / fc.L, fc.N);
    }
    {
      const wd = uniforms.uWindDir.value;   // streak texture periods: 512 m along wind, 32 m across, 2048 m coarse mask
      const su = o.x * wd.x + o.z * wd.y, sv = -o.x * wd.y + o.z * wd.x;
      uniforms.uSlickOff.value.set(mod(su, 16384), mod(sv, 16384));
      uniforms.uStreak.value.set(mod(su, 2048), mod(sv, 2048), 0.9 * smooth(9, 17, uniforms.uSea.value.x));
    }
    {
      const wd = uniforms.uWindDir.value, U = uniforms.uSea.value.x, t = ctx.time.now;
      uniforms.uCatOff.value.set(mod(U * 0.6 * t, 16384), 0);
      uniforms.uWeather.value.x = Math.min(1, Math.max(0, ctx.weather.precipitation || 0));
      uniforms.uWeather.value.z = ctx.env.exposure || 1;
    }
    updateWash();
    inland?.update(fft);
    uniforms.uOriginWrap.value.set(mod(o.x, 4096), mod(o.z, 4096), mod(o.x, 32768), mod(o.z, 32768));
    const cam = ctx.camera;
    camW.setFromMatrixPosition(cam.matrixWorld);
    const alt = Math.max(1, camW.y);
    const horizon = Math.sqrt(2 * EARTH_R * alt + alt * alt);
    uniforms.uMesh.value.set(camW.x, camW.z, Math.max(1, alt / 30), Math.max(4000, 1.5 * horizon));
    // moon: irradiance scaled against the night sky so its glitter path reads at night
    const moonUp = smooth(-0.02, 0.1, ctx.env.moonDir.y);
    const night = ctx.env.nightFactor ?? 0;
    uniforms.uMoonK.value = moonUp * night;
  }

  // downwash / wake streak under a very low aircraft over water
  function updateWash() {
    const st = ctx.player?.state, u = uniforms.uWash.value;
    u.z = 0;
    if (!st || classic) return;
    const p = st.position, th = ctx.world.terrainHeightAt ? ctx.world.terrainHeightAt(p.x, p.z) : -100;
    const hw = p.y - Math.max(0, th);
    if (th > -0.5 || hw > 45) return;
    ctx.world.toRender(p, washPos);
    const v = st.velocity, gs = Math.hypot(v.x, v.z);
    const span = ctx.player.def?.geometry?.span || 12;
    u.set(washPos.x, washPos.z, Math.min(1, (1 - hw / 45) * 1.4), hw);
    const k = gs > 1 ? 1 / gs : 0;
    uniforms.uWashV.value.set(gs > 1 ? v.x * k : 1, gs > 1 ? v.z * k : 0, Math.min(1500, 15 + gs * 6), 0.6 * span + 0.3 * hw);
  }

  function heightAt(x, z) {
    let fade = 1;
    const th = ctx.world.terrainHeightAt ? ctx.world.terrainHeightAt(x, z) : -1000;
    if (th > -uniforms.uShoreFade.value) fade = smooth(0, uniforms.uShoreFade.value, -th);
    if (fade <= 0) return 0;
    return evalHeight(comps, x, z, ctx.time.now) * fade;
  }

  return {
    object3D, update, heightAt,
    get seaState() { return sea; },
    get _fft() { return fft; },
    get _debug() { return { fft, Spectrum, sea, cascadeDefs, time: ctx.time.now }; },
    get stats() { return { N: cfg.N, vertices: meshInfo.vertices, triangles: meshInfo.triangles, floatFFT: fft.floatOK }; },
    dispose() { inland?.dispose(); fft.dispose(); mesh?.geometry.dispose(); material.dispose(); noiseTex.dispose(); foamTex.dispose(); ctx.scene.remove(object3D); },
  };
}
