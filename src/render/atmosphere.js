// Atmosphere LUT generation + the CPU mirror of the medium model. See atmosphere-glsl.js for the technique notes.
import * as THREE from 'three';
import { FRAME_UNIFORMS_GLSL, FULLSCREEN_VERT, FullscreenPass } from '../core/glsl.js';
import { ATM, ATMOSPHERE_GLSL, ATM_MODEL_GLSL } from './atmosphere-glsl.js';
import { createNeuralSun, createNeuralSky } from '../neural/atmo.js';
import { ATMO_MODEL } from '../neural/atmo-weights.js';

const CLASSIC_LIMB = [0.44, 0.58, 0.74];

const BR = [5.802e-3, 13.558e-3, 33.1e-3];
const BO = [0.650e-3, 1.881e-3, 0.085e-3];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const HEAD = /* glsl */`
precision highp float; precision highp sampler2D;
in vec2 vUv; out vec4 outColor;
${FRAME_UNIFORMS_GLSL}
${ATMOSPHERE_GLSL}
${ATM_MODEL_GLSL}
`;

// ATM_NEURAL_SUN: the public (spectral) variant. Rayleigh + ozone through the sun network, aerosol stays exp(-tau_M).
const TRANSMITTANCE_FRAG = (neuralGLSL) => HEAD + (neuralGLSL ? '#define ATM_NEURAL_SUN\n' + neuralGLSL : '') + /* glsl */`
void main() {
  vec2 x = clamp((vUv * ATM_TRANS_SIZE - 0.5) / (ATM_TRANS_SIZE - 1.0), 0.0, 1.0);
  float H = sqrt(ATM_HT * (2.0 * ATM_RG + ATM_HT));
  float rho = H * x.y, r = sqrt(rho * rho + ATM_RG * ATM_RG);
  float h = rho * rho / (r + ATM_RG);
  float dmin = ATM_HT - h, dmax = rho + H;
  float d = dmin + x.x * (dmax - dmin);
  float mu = d <= 0.0 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
  vec3 od = vec3(0.0), col = vec3(0.0);
  float t0 = 0.0;
  for (int i = 0; i < 40; i++) {
    float x1 = float(i + 1) / 40.0, t1 = d * x1 * x1;
    vec3 dens = atmDensity(atmAltitudeAt(h, mu, 0.5 * (t0 + t1)));
    od += atmExtinction(dens) * (t1 - t0);
    col += dens * (t1 - t0);
    t0 = t1;
  }
#ifdef ATM_NEURAL_SUN
  outColor = vec4(exp(-uAtmMie.y * col.y) * atmNeuralSunT(col.x, col.z), 1.0);
#else
  outColor = vec4(exp(-od), 1.0);
#endif
}`;

// Hillaire 2020 §5.5: second-order scattering L2 and the transfer factor f_ms, isotropic phase; Psi = L2 / (1 - f_ms).
const MULTISCAT_FRAG = HEAD + /* glsl */`
void main() {
  vec2 x = clamp((vUv * ${ATM.MS_N}.0 - 0.5) / ${ATM.MS_N - 1}.0, 0.0, 1.0);
  float muS = x.x * 2.0 - 1.0, h = x.y * x.y * ATM_HT;
  vec3 sunDir = vec3(sqrt(max(1.0 - muS * muS, 0.0)), muS, 0.0);
  float r = ATM_RG + h;
  vec3 L2 = vec3(0.0), fms = vec3(0.0);
  for (int i = 0; i < 8; i++) for (int j = 0; j < 8; j++) {
    float th = 6.2831853 * (float(i) + 0.5) / 8.0, cp = 1.0 - 2.0 * (float(j) + 0.5) / 8.0, sp = sqrt(max(1.0 - cp * cp, 0.0));
    vec3 dir = vec3(sp * cos(th), cp, sp * sin(th));
    float tG = atmDistToGround(h, dir.y);
    float tMax = tG >= 0.0 ? tG : atmDistToTop(h, dir.y);
    float dt = tMax / 20.0;
    vec3 T = vec3(1.0), L = vec3(0.0), F = vec3(0.0);
    for (int k = 0; k < 20; k++) {
      float t = (float(k) + 0.3) * dt;
      float hs = atmAltitudeAt(h, dir.y, t);
      vec3 P = vec3(0.0, r, 0.0) + dir * t;
      vec3 dens = atmDensity(hs);
      vec3 sS = ATM_BR * dens.x + vec3(uAtmMie.x * dens.y);
      vec3 ext = atmExtinction(dens);
      vec3 Ts = exp(-ext * dt);
      vec3 S = sS * atmLightTransmittance(hs, dot(P, sunDir) / length(P)) * 0.0795775;
      L += T * (S - S * Ts) / max(ext, vec3(1e-9));
      F += T * (sS - sS * Ts) / max(ext, vec3(1e-9));
      T *= Ts;
    }
    if (tG >= 0.0) {
      vec3 Pg = vec3(0.0, r, 0.0) + dir * tG;
      float nl = max(dot(Pg, sunDir) / length(Pg), 0.0);
      L += T * atmLightTransmittance(0.0, nl) * nl * uAtmGroundAlbedo / ATM_PI;
    }
    L2 += L; fms += F;
  }
  vec3 psi = (L2 / 64.0) / (1.0 - min(fms / 64.0, vec3(0.97)));
  outColor = vec4(uAtmEnc.x > 0.5 ? sqrt(clamp(psi, 0.0, 1.0)) : psi, 1.0);
}`;

const SKYVIEW_FRAG = HEAD + /* glsl */`
void main() {
  vec3 dir = atmSkyUVToDir(vUv);
  float h = uAtmView.w;
  vec3 L, Ls, T;
  atmIntegrate2(h, dir, atmDistToTop(h, dir.y), 40, L, Ls, T);
  L += Ls * (atmNeuralSkyRatio(dir) - 1.0);
  outColor = vec4(atmEncode(L), dot(T, vec3(0.3333333)));
}`;

const AERIAL_FRAG = HEAD + /* glsl */`
void main() {
  vec2 tile = floor(gl_FragCoord.xy / ${ATM.AP_N}.0);
  float k = tile.x + tile.y * ${ATM.AP_TX}.0;
  vec2 tuv = (gl_FragCoord.xy - tile * ${ATM.AP_N}.0) / ${ATM.AP_N}.0;
  vec3 dir = atmXYToDir(tuv, vec2(${ATM.AP_N}.0));
  float h = uAtmView.w;
  float w = (k + 0.5) / ${ATM.AP_N}.0;
  float tEnd = min(ATM_AP_DMAX * w * w, atmDistToTop(h, dir.y));
  float tG = atmDistToGround(h, dir.y);
  if (tG >= 0.0) tEnd = min(tEnd, tG);            // below the horizon the volume saturates at the ground
  vec3 L, Ls, T;
  atmIntegrate2(h, dir, tEnd, int(clamp(4.0 + k * 0.75, 4.0, 26.0)), L, Ls, T);
  // same correction as the sky along this direction (the horizon's below it), so far haze converges to the sky
  L += Ls * (atmNeuralSkyRatio(dir) - 1.0);
  vec3 ratio = L / max(atmSkyRef(dir), vec3(1e-10));
  // 8-bit fallback stores ratio / 4
  outColor = vec4(uAtmEnc.x > 0.5 ? clamp(ratio * 0.25, 0.0, 1.0) : clamp(ratio, 0.0, 16.0), dot(T, vec3(0.3333333)));
}`;

export function createAtmosphere(ctx, caps) {
  const { renderer } = ctx;
  const type = caps.hdrType;
  const rt = (w, h) => {
    const t = new THREE.WebGLRenderTarget(w, h, {
      type, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    return t;
  };
  // Neural air + sun (default) vs the classic LUT model (?atmo=classic) for A/B comparison.
  const neuralOn = (ctx.params?.raw?.atmo ?? '') !== 'classic';
  const nSun = neuralOn ? createNeuralSun() : null;
  const nSky = neuralOn ? createNeuralSky() : null;
  const transRT = rt(ATM.TRANS_W, ATM.TRANS_H);                  // classic: used by the LUT generation passes
  const transPubRT = neuralOn ? rt(ATM.TRANS_W, ATM.TRANS_H) : transRT;   // what every consumer sees
  if (neuralOn) transPubRT.texture.name = 'atm.transmittance.spectral';
  const white = neuralOn ? null : new THREE.DataTexture(new Uint16Array([15360, 15360, 15360, 15360]), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  if (white) white.needsUpdate = true;
  const msRT = rt(ATM.MS_N, ATM.MS_N);
  const skyRT = rt(ATM.SKY_W, ATM.SKY_H);
  const aerialRT = rt(ATM.AP_N * ATM.AP_TX, ATM.AP_N * ATM.AP_TY);
  transRT.texture.name = 'atm.transmittance'; msRT.texture.name = 'atm.multiscat'; skyRT.texture.name = 'atm.skyview'; aerialRT.texture.name = 'atm.aerial';

  // Uniforms every consumer of the GLSL API needs (shared {value} holders — never replace the holders).
  const uniforms = {
    uAtmHaze: { value: 1 / 60000 },
    tAtmTransmittance: { value: transPubRT.texture },
    tAtmSkyView: { value: skyRT.texture },
    tAtmAerial: { value: aerialRT.texture },
    uAtmView: { value: new THREE.Vector4(0, 1, 0, 0.001) },
    uAtmSunIllum: { value: new THREE.Vector3(4, 4, 4) },
    uAtmMoonIllum: { value: new THREE.Vector3(0, 0, 0) },
    uAtmGround: { value: new THREE.Vector3(0.05, 0.05, 0.05) },
    uAtmEnc: { value: new THREE.Vector2(caps.float ? 0 : 1, 16) },
    tAtmNeuralSky: { value: neuralOn ? nSky.ratio : white },
    tAtmNeuralAur: { value: neuralOn ? nSky.column : white },
    uAtmNeural: { value: new THREE.Vector4(neuralOn ? 1 : 0, neuralOn ? 1 : 0, 0, 0) },
    uAtmSunLimb: { value: new THREE.Vector3(...(neuralOn ? ATMO_MODEL.limb : CLASSIC_LIMB)) },
  };
  // Uniforms of the medium model (LUT generation only).
  const model = {
    tAtmMultiScat: { value: msRT.texture },
    uAtmMie: { value: new THREE.Vector4(0.02, 0.022, 0.8, 1 / 1.2) },
    uAtmL0Dir: { value: new THREE.Vector3(0, 1, 0) }, uAtmL0Illum: { value: new THREE.Vector3(4, 4, 4) },
    uAtmL1Dir: { value: new THREE.Vector3(0, -1, 0) }, uAtmL1Illum: { value: new THREE.Vector3(0, 0, 0) },
    uAtmGroundAlbedo: { value: new THREE.Vector3(0.14, 0.15, 0.13) },
    uAtmAirglow: { value: new THREE.Vector3(0, 0, 0) },
    uAtmDeck: { value: new THREE.Vector4(1.5, 3, 0, 0) },
  };
  // the generation passes read the classic transmittance (the sky network corrects exactly that model)
  const classicT = { tAtmTransmittance: { value: transRT.texture } };
  const mk = (frag, extra = {}) => new FullscreenPass(new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false, fog: false,
    uniforms: { ...ctx.uniforms.frame, ...uniforms, ...model, ...classicT, ...extra },
    vertexShader: FULLSCREEN_VERT, fragmentShader: frag,
  }));
  const transPass = mk(TRANSMITTANCE_FRAG(null)), msPass = mk(MULTISCAT_FRAG), skyPass = mk(SKYVIEW_FRAG), aerialPass = mk(AERIAL_FRAG);
  const transPubPass = neuralOn ? mk(TRANSMITTANCE_FRAG(nSun.glsl), nSun.uniforms) : null;

  const mie = { scat: 0, ext: 0, g: 0.8, invH: 1 / 1.2 };
  const state = { camH: 0.001, beta: 0, deck: 1 };   // deck: 0 disables the cloud-deck dimming (no cloud shadows available)
  let lutMie = -1, lutG = -1, lutInvH = -1;

  function setWeather(w) {
    const visKm = clamp(w.visibility ?? 60000, 300, 500000) / 1000;
    // Koschmieder: visibility = 3.912 / extinction(550 nm); the Rayleigh share is ~0.0116 /km at sea level.
    const ext = Math.max(3.912 / visKm - 0.0116, 0.0012);
    const wet = clamp((w.precipitation ?? 0) * 1.25, 0, 1);       // rain / mist: whiter, more forward-peaked
    mie.ext = ext; mie.scat = ext * lerp(0.92, 0.985, wet); mie.g = lerp(0.78, 0.86, wet);
    mie.invH = 1 / lerp(1.2, 1.6, clamp((ext - 0.05) / 0.5, 0, 1)); // a thick murk reaches a little higher
    model.uAtmMie.value.set(mie.scat, mie.ext, mie.g, mie.invH);
    uniforms.uAtmHaze.value = 1 / Math.max(2000, w.visibility ?? 60000);
    // mean light removed below the cloud layer: nothing for fair-weather cumulus, ~70 % under a solid overcast
    const base = (w.cloudBase ?? 1500) * 0.001, top = Math.max((w.cloudTop ?? 3000) * 0.001, base + 0.5);
    model.uAtmDeck.value.set(base, Math.min(top, base + 2.5), state.deck * 0.72 * smooth(0.2, 0.92, w.cloudCoverage ?? 0), 0);
  }

  // ---- CPU mirror (used for the light colour at the camera; ~40 exp() per call) --------------------------------
  const od = [0, 0, 0], colm = [0, 0, 0];
  function transmittance(h, mu, out) {
    h = clamp(h, 0, ATM.HT);
    const r = ATM.RG + h, rmu = r * mu;
    const d = Math.max(0, -rmu + Math.sqrt(Math.max(rmu * rmu + (ATM.HT - h) * (ATM.RG + ATM.HT + r), 0)));
    od[0] = od[1] = od[2] = 0; colm[0] = colm[1] = colm[2] = 0;
    let t0 = 0;
    const N = 48;
    for (let i = 0; i < N; i++) {
      const x1 = (i + 1) / N, t1 = d * x1 * x1, t = 0.5 * (t0 + t1), dt = t1 - t0;
      const r1 = Math.sqrt(Math.max(r * r + t * t + 2 * r * t * mu, 0));
      const hs = Math.max(0, h + t * (t + 2 * r * mu) / (r1 + r));
      const dR = Math.exp(-hs * 0.125), dM = Math.exp(-hs * mie.invH) * mie.ext, dO = Math.max(0, 1 - Math.abs(hs - 25) / 15);
      od[0] += (BR[0] * dR + dM + BO[0] * dO) * dt; od[1] += (BR[1] * dR + dM + BO[1] * dO) * dt; od[2] += (BR[2] * dR + dM + BO[2] * dO) * dt;
      colm[0] += dR * dt; colm[1] += dM * dt; colm[2] += dO * dt;
      t0 = t1;
    }
    if (nSun) return nSun.sample(colm[0], colm[2], out).multiplyScalar(Math.exp(-colm[1]));   // colm[1] already has mie.ext
    out.x = Math.exp(-od[0]); out.y = Math.exp(-od[1]); out.z = Math.exp(-od[2]);
    return out;
  }
  /** Transmittance from altitude hKm toward a light at cos-zenith mu, including the planet's shadow. out: Vector3 */
  function lightTransmittance(hKm, mu, out) {
    const h = clamp(hKm, 0, ATM.HT);
    const muH = -Math.sqrt(h * (2 * ATM.RG + h)) / (ATM.RG + h);
    transmittance(h, Math.max(mu, muH), out);
    return out.multiplyScalar(smooth(-0.006, 0.006, mu - muH));
  }

  let refAz = 0;

  /**
   * Refresh the LUTs. p = { camAltitude (m), sunDir, moonDir, sunIllum: Vector3, moonIllum: Vector3, keyDir: Vector3, airglow: Vector3 }
   */
  function update(p) {
    const prevRT = renderer.getRenderTarget();
    setWeather(ctx.weather);
    // (1) medium changed → transmittance + multiple scattering
    if (Math.abs(mie.ext - lutMie) > lutMie * 0.004 || Math.abs(mie.g - lutG) > 0.002 || Math.abs(mie.invH - lutInvH) > 0.002) {
      lutMie = mie.ext; lutG = mie.g; lutInvH = mie.invH;
      transPass.render(renderer, transRT);
      if (transPubPass) transPubPass.render(renderer, transPubRT);
      msPass.render(renderer, msRT);
    }
    // (2) per-frame view-dependent LUTs
    const h = clamp(p.camAltitude * 0.001, 0.0005, ATM.HT - 1);
    state.camH = h;
    state.beta = Math.atan(Math.sqrt(h * (2 * ATM.RG + h)) / ATM.RG);
    const hl = Math.hypot(p.keyDir.x, p.keyDir.z);
    if (hl > 1e-3) refAz = Math.atan2(p.keyDir.z, p.keyDir.x);
    uniforms.uAtmView.value.set(state.beta, Math.cos(refAz), Math.sin(refAz), h);
    model.uAtmL0Dir.value.copy(p.sunDir); model.uAtmL0Illum.value.copy(p.sunIllum);
    model.uAtmL1Dir.value.copy(p.moonDir); model.uAtmL1Illum.value.copy(p.moonIllum);
    model.uAtmAirglow.value.copy(p.airglow);
    uniforms.uAtmSunIllum.value.copy(p.sunIllum);
    uniforms.uAtmMoonIllum.value.copy(p.moonIllum);
    if (nSky) nSky.update(Math.asin(clamp(p.sunDir.y, -1, 1)), h, mie.ext);
    skyPass.render(renderer, skyRT);
    aerialPass.render(renderer, aerialRT);
    renderer.setRenderTarget(prevRT);
  }

  return {
    uniforms, model, glsl: ATMOSPHERE_GLSL, mie, state,
    neural: neuralOn ? { sun: nSun, sky: nSky } : null,
    sunLimb: neuralOn ? ATMO_MODEL.limb.slice() : CLASSIC_LIMB.slice(),     // linear limb-darkening coefficients (r, g, b)
    targets: { transmittance: transPubRT, transmittanceClassic: transRT, multiscat: msRT, skyView: skyRT, aerial: aerialRT },
    setWeather, update, transmittance, lightTransmittance,
    dispose() {
      for (const t of new Set([transRT, transPubRT, msRT, skyRT, aerialRT])) t.dispose();
      for (const p of [transPass, transPubPass, msPass, skyPass, aerialPass]) p?.dispose();
      nSun?.dispose(); nSky?.dispose(); white?.dispose();
    },
  };
}
