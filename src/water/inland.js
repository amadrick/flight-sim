// Inland water: rivers drawn as a real water surface on top of the terrain's river channel.
//
// The terrain marks open fresh water in its height pyramid (clipmap alpha = "special" > 0, see terrain/clipmap.js)
// and paints the channel flat and dark. This module drapes a second camera-centred grid over the land, lifted a
// little above the ground, and shades only where that mask says "river" (soft, premultiplied bank edge; everything
// else is discarded after one fetch). Shading: sky + reflected clouds through Fresnel, sun / moon glitter with
// stochastic glints, flow-advected ripples (two-phase flow map along the channel, downhill), green-brown turbid
// water that shows the bed at the banks, flow foam lines, exposed sand bars at low water.
//
// Needs the terrain's `terrTexH()` (present in ctx.terrain.heightGLSL); if the hook is missing it does nothing.
// Cost: one draw; land pixels within reach run 1 fetch + discard, river pixels ~10 fetches (+ 4 for flow).
import * as THREE from 'three';
import { FRAME_UNIFORMS_GLSL, CURVATURE_GLSL } from '../core/glsl.js';
import { WATER_BRDF_GLSL } from './shaders.js';

const SPECIAL_GLSL = /* glsl */`
float waterSpecial(vec2 worldXZ) {
  vec2 rxz = worldXZ - uTerrOrg.xz;
  vec2 q = abs(rxz - uTerrCam.xz);
  float lvl = clamp(ceil(log2(max(max(q.x, q.y), 1.0) / uTerrWin)), uTerrLod.y, uTerrLod.z);
  return terrTexH(rxz, lvl).w;
}`;

function vs(terrainGLSL) {
  return /* glsl */`
precision highp float; precision highp int;
${FRAME_UNIFORMS_GLSL}
${CURVATURE_GLSL}
${terrainGLSL}
${SPECIAL_GLSL}
uniform vec4 uMesh;   // xy = centre, z = scale, w = reach
uniform vec2 uGrid;
out vec3 vPos; out vec2 vXZ; out float vSpec;
void main() {
  vec2 local = position.xz;
  float rl = length(local);
  vec2 off = local * uMesh.z;
  float r = rl * uMesh.z;
  if (r > uMesh.w) off *= uMesh.w / r;
  vec2 xz = uMesh.xy + off;
  float th = terrainHeight(xz + uOrigin.xz);
  float dc = length(xz - uCameraPos.xz);
  vSpec = waterSpecial(xz + uOrigin.xz);
  // float above the channel (more far away, where the terrain mesh is coarser than its height pyramid); land well
  // below sea level is the ocean's: push it down out of sight
  vec3 p = vec3(xz.x, th + 0.3 + 0.0012 * dc, xz.y);
  if (th < -1.0) p.y = th - 30.0;
  p.y -= curvatureDrop(dc);
  vPos = p; vXZ = xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
}

function fs(terrainGLSL, atmGLSL, cloudsGLSL) {
  return /* glsl */`
precision highp float; precision highp int;
${cloudsGLSL ? '#define WATER_CLOUDS 1' : ''}
${FRAME_UNIFORMS_GLSL}
${terrainGLSL}
${atmGLSL}
${cloudsGLSL || ''}
${SPECIAL_GLSL}
uniform sampler2D tSlope2, tNoise, tFoamTex;
uniform vec4 uCasc2;          // the ocean's finest cascade: xy = origin mod L, z = 1/L
uniform vec4 uOriginWrap;
uniform vec2 uWindDir;
uniform vec4 uSea;
uniform vec4 uWeather;        // x = rain, y = glint density, z = exposure
uniform float uMoonK;
in vec3 vPos; in vec2 vXZ; in float vSpec;
layout(location = 0) out vec4 outColor;
${WATER_BRDF_GLSL}

void main() {
  vec2 xz = vXZ, wAbs = xz + uOrigin.xz, wq = xz + uOriginWrap.xy;
  float pxm = length(fwidth(xz));
  float fpG = sqrt(length(dFdx(xz)) * length(dFdy(xz)));
  if (vSpec < 0.05 && fwidth(vSpec) < 0.02) discard;      // cheap early out from the interpolated vertex mask
  float sp = waterSpecial(wAbs);
  if (sp < 0.3) discard;
  vec3 P = vPos;
  vec3 toCam = uCameraPos - P; float dist = length(toCam); vec3 V = toCam / dist;

  // ---- flow: along the channel (perpendicular to the mask gradient), pointing downhill -------------------------
  float e = max(4.0, pxm * 1.5);
  vec2 g = vec2(waterSpecial(wAbs + vec2(e, 0.0)) - sp, waterSpecial(wAbs + vec2(0.0, e)) - sp);
  vec2 fl = length(g) > 1e-5 ? normalize(vec2(-g.y, g.x)) : uWindDir;
  float down = terrainHeight(wAbs - fl * 250.0) - terrainHeight(wAbs + fl * 250.0);
  fl *= down >= 0.0 ? 1.0 : -1.0;
  float centre = smoothstep(0.55, 1.0, sp);
  float speed = 0.5 + 1.1 * centre;                      // m/s, fastest mid-channel
  // two-phase flow map (no stretching): two copies of the ripple field advected and cross-faded
  float T = 6.0, t0 = fract(uTime / T), t1 = fract(uTime / T + 0.5);
  float wgt = abs(t0 * 2.0 - 1.0);
  vec2 o0 = fl * speed * T * t0, o1 = fl * speed * T * t1;
  vec2 uv = (xz + uCasc2.xy) * uCasc2.z;
  vec4 r0 = texture(tSlope2, uv - o0 * uCasc2.z), r1 = texture(tSlope2, uv - o1 * uCasc2.z + 0.37);
  vec2 grad = mix(r0.xy, r1.xy, wgt) * (0.55 + 0.3 * smoothstep(2.0, 9.0, uSea.x));
  // standing ripples where the current meets the bed: streaks along the flow
  vec2 fq = vec2(dot(wq, fl), dot(wq, vec2(-fl.y, fl.x)));
  vec4 sn = texture(tNoise, fq / vec2(96.0, 12.0) - vec2(uTime * speed / 96.0, 0.0));
  grad += vec2(-fl.y, fl.x) * (sn.a - 0.5) * 0.05 * centre;
  vec2 var = vec2(0.003 + 0.0012 * uSea.x) * (0.8 + 0.5 * sn.b);
  var += vec2(dot(grad, grad)) * smoothstep(0.5, 4.0, pxm);  // ripples below a pixel turn into roughness
  grad *= 1.0 - smoothstep(0.5, 4.0, pxm);
  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 tx = vec3(1.0, 0.0, 0.0), ty = vec3(0.0, 0.0, 1.0);
  float cosV = max(dot(V, N), 0.0);

  // ---- reflection ------------------------------------------------------------------------------------------
  vec3 R = reflect(-V, N);
  R = normalize(vec3(R.x, max(R.y, 0.02), R.z));
  vec3 sky = atmSkyRadiance(R);
  vec3 sunE = atmSunIlluminance(vec3(P.x, max(P.y, 0.0), P.z));
#ifdef WATER_CLOUDS
  if (uCloudShadowC.z > 0.0) {
    float base = uCloudShadowA.w, t = max(base - P.y, 30.0) / R.y;
    float tau = cloudShadowTau(wAbs + R.xz * t, base) * clamp(uSunDir.y, 0.12, 1.0);
    float a = (1.0 - exp(-0.6 * tau)) * exp(-t / 70000.0) * smoothstep(0.003, 0.05, R.y);
    vec3 up = atmSkyRadiance(vec3(0.0, 1.0, 0.0));
    sky = mix(sky, up * 1.0 + sunE * 0.08 * smoothstep(-0.05, 0.15, uSunDir.y), a);
  }
#endif
  float F = meanFresnel(cosV, sqrt(var.x));

  // ---- water body: turbid green-brown; the bed shows through at the banks ------------------------------------
  vec3 Edown = sunE * max(uSunDir.y, 0.0) / PI + atmAmbient(P, vec3(0.0, 1.0, 0.0));
  float dW = 1.8 * smoothstep(0.3, 1.0, sp);
  vec3 Kd = vec3(1.1, 0.55, 0.75);
  float cosVw = sqrt(1.0 - (1.0 - cosV * cosV) / 1.777);
  vec3 att = exp(-Kd * dW * (1.1 + 1.0 / cosVw));
  float aS = sqrt(att.r * att.g);
  vec3 rho = vec3(0.0048, 0.0062, 0.0040);
  vec3 Lbody = rho * (1.0 - att) * Edown + vec3(0.30, 0.28, 0.21) * max(att - aS, 0.0) * Edown;

  // ---- glitter ---------------------------------------------------------------------------------------------
  float lobe, lobeM = 0.0;
  vec3 spec = sunE * glitter(uSunDir, V, N, tx, ty, var, lobe);
  vec3 moonE = uMoonK > 0.0 ? uMoonK * 25.0 * PI * atmSkyRadiance(vec3(0.0, 1.0, 0.0)) * vec3(0.85, 0.92, 1.0) : vec3(0.0);
  if (uMoonDir.y > -0.02) spec += moonE * glitter(uMoonDir, V, N, tx, ty, var, lobeM);
  spec *= glints(wq, max(fpG, 1e-3), max(lobe, lobeM), uWeather.y * 0.6, uTime);
  spec *= min(1.0, (24.0 / max(uWeather.z, 1e-4)) / max(dot(spec, vec3(0.2126, 0.7152, 0.0722)), 1e-6));

  // ---- foam lines carried by the current, sand bars ---------------------------------------------------------
  float ft = texture(tFoamTex, (fq - vec2(uTime * speed, 0.0)) / vec2(40.0, 9.0)).r;
  float foam = smoothstep(0.72, 0.9, ft) * 0.35 * (0.3 + 0.7 * sn.g) * (1.0 - smoothstep(0.3, 1.5, pxm));
  // sand bars: long, low, irregular, hugging the banks (inner bends), never mid-channel
  vec4 bn = texture(tNoise, fq / vec2(1400.0, 300.0) + 0.21);
  vec4 bn2 = texture(tNoise, fq / vec2(170.0, 40.0) + 0.57);
  float barN = bn.r * 0.75 + bn2.b * 0.25 + 0.45 * (1.0 - smoothstep(0.45, 0.85, sp));
  float bar = smoothstep(0.80, 0.86, barN) * smoothstep(0.35, 0.5, sp);
  vec3 foamRad = 0.8 * (sunE * max(dot(N, uSunDir), 0.0) / PI + atmAmbient(P, N));
  vec3 col = F * sky + spec + (1.0 - F) * Lbody;
  float a = 1.0 - (1.0 - F) * aS;
  col = mix(col, foamRad, foam); a = mix(a, 1.0, foam);
  vec3 sand = vec3(0.40, 0.37, 0.30) * (0.85 + 0.3 * bn.b) * (1.0 - 0.4 * (1.0 - smoothstep(0.86, 0.95, barN)));
  col = mix(col, sand * (sunE * max(uSunDir.y, 0.0) / PI + atmAmbient(P, vec3(0.0, 1.0, 0.0))), bar); a = mix(a, 1.0, bar);
  float edge = smoothstep(0.3, 0.6, sp);
  outColor = vec4(max(col, vec3(0.0)) * edge, a * edge);
}`;
}

/**
 * @param ctx  sim context
 * @param deps { buildPolarMesh, uniforms (the ocean's, shared by reference), terrainGLSL, atm, foamTex, noiseTex }
 */
export function createInlandWater(ctx, deps) {
  const { terrainGLSL, atm, uniforms: ou } = deps;
  if (!/terrTexH\s*\(/.test(terrainGLSL) || !/uTerrWin/.test(terrainGLSL) || !/uTerrLod/.test(terrainGLSL)) return null;
  const uniforms = {
    ...ctx.uniforms.frame, ...atm.uniforms, ...(ctx.terrain?.heightUniforms || {}),
    tSlope2: ou.tSlope2, tNoise: ou.tNoise, tFoamTex: ou.tFoamTex,
    uOriginWrap: ou.uOriginWrap, uWindDir: ou.uWindDir, uSea: ou.uSea, uWeather: ou.uWeather, uMoonK: ou.uMoonK,
    uCasc2: { value: new THREE.Vector4() },
    uMesh: { value: new THREE.Vector4(0, 0, 1, 20000) },
    uGrid: { value: new THREE.Vector2(1, 0.05) },
  };
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms,
    vertexShader: vs(terrainGLSL),
    fragmentShader: fs(terrainGLSL, atm.glsl, ''),
  });
  material.fog = false; material.toneMapped = false;
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor; material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = THREE.ZeroFactor; material.blendDstAlpha = THREE.OneFactor;
  material.depthWrite = false;     // a film over the bank: never occludes what is drawn later

  const info = deps.buildPolarMesh(128, 0.6, 20000);
  const mesh = new THREE.Mesh(info.geometry, material);
  mesh.frustumCulled = false; mesh.renderOrder = 11; mesh.matrixAutoUpdate = false;
  mesh.name = 'inland-water';
  uniforms.uGrid.value.set(info.c0, info.alpha);

  let cloudsHooked = false;
  const camW = new THREE.Vector3();
  return {
    mesh, info,
    hookClouds(cl) {
      if (cloudsHooked) return; cloudsHooked = true;
      Object.assign(uniforms, cl.shadowUniforms);
      material.fragmentShader = fs(terrainGLSL, atm.glsl, cl.shadowGLSL);
      material.needsUpdate = true;
    },
    update(fft) {
      camW.setFromMatrixPosition(ctx.camera.matrixWorld);
      const alt = Math.max(1, camW.y - Math.max(0, ctx.world.terrainHeightAt ? ctx.world.terrainHeightAt(camW.x + ctx.world.origin.x, camW.z + ctx.world.origin.z) : 0));
      uniforms.uMesh.value.set(camW.x, camW.z, Math.max(1, alt / 40), Math.max(6000, Math.min(40000, alt * 12)));
      const c = fft.cascades[2];
      uniforms.uCasc2.value.copy(ou.uCasc.value[2]);
      uniforms.tSlope2.value = c.slope;
    },
    dispose() { info.geometry.dispose(); material.dispose(); },
  };
}
