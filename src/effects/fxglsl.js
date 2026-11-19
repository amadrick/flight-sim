// Shared GLSL + shared uniforms for every effects material.
// All effects output linear, scene-referred HDR radiance with PREMULTIPLIED alpha
// (blend ONE, ONE_MINUS_SRC_ALPHA): lit media write (L·a, a), pure emitters write (E, 0).
import * as THREE from 'three';
import { FRAME_UNIFORMS_GLSL, DEPTH_GLSL } from '../core/glsl.js';

/** Build the uniform block shared (by reference) by all effects materials. */
export function createSharedUniforms(ctx, tex) {
  const atm = ctx.pipeline?.atmosphere;
  const cl = ctx.clouds;
  const u = {
    ...ctx.uniforms.frame,
    ...(atm?.uniforms || {}),
    ...(cl?.shadowGLSL && cl?.shadowUniforms ? cl.shadowUniforms : {}),
    tFxNoise3D: { value: tex.noise3D },
    tFxPuff: { value: tex.puff },
    tFxDepth: ctx.pipeline?.postDepthUniform || ctx.uniforms.frame.tSceneDepth, // shared holder (follows resizes)
    uFxApOn: { value: ctx.pipeline?.postAerialPerspective ? 0 : 1 }, // pipeline does not fog POST objects → we do
    uFxPreviewTM: { value: 0 },          // debug: tone map in-shader (stub pipeline draws POST after tone mapping)
    uFxPreviewExposure: { value: 1 },
    uFxLightPos: { value: new THREE.Vector3() },   // render space; the dynamic fx point light (AB / fire)
    uFxLightColor: { value: new THREE.Color(0, 0, 0) }, // radiant intensity (irradiance at 1 m)
    uFxNight: { value: 0 },
    uFxExposure: { value: 1 },                   // ctx.env.exposure (exposure-aware soft limits)
    uFxAnchor: { value: new THREE.Vector3() }, // anchor world pos − origin (render offset of anchored data)
    uFxWind: { value: new THREE.Vector3() },   // world wind m/s at the player's altitude
  };
  return u;
}

export function sharedHeader(ctx) {
  const atmGlsl = ctx.pipeline?.atmosphere?.glsl || /* glsl */`
    vec3 atmSunIlluminance(vec3 p) { return uSunColor; }
    vec4 atmAerialPerspective(vec3 p) { return vec4(0.0, 0.0, 0.0, 1.0); }
    vec3 atmAmbient(vec3 p, vec3 n) { return mix(uAmbientGround, uAmbientSky, n.y * 0.5 + 0.5); }`;
  const cl = ctx.clouds;
  const shadowGlsl = cl?.shadowGLSL && cl?.shadowUniforms ? cl.shadowGLSL : 'float cloudShadow(vec3 p) { return 1.0; }';
  // DEPTH_GLSL reads tSceneDepth; we route it through tFxDepth so the pipeline can hand us a copy.
  const depth = DEPTH_GLSL.replace('texture(tSceneDepth, uv)', 'texture(tFxDepth, uv)');
  return /* glsl */`
precision highp float; precision highp sampler3D;
${FRAME_UNIFORMS_GLSL}
uniform highp sampler2D tFxDepth;
${depth}
${atmGlsl}
${shadowGlsl}
uniform highp sampler3D tFxNoise3D; uniform sampler2D tFxPuff;
uniform float uFxApOn; uniform float uFxPreviewTM; uniform float uFxPreviewExposure;
uniform vec3 uFxLightPos; uniform vec3 uFxLightColor; uniform float uFxNight; uniform float uFxExposure;
uniform vec3 uFxAnchor; uniform vec3 uFxWind;
#define FX_PI 3.14159265
float fxHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float fxHash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float fxHG(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * FX_PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
vec4 fxNoise(vec3 p) { return texture(tFxNoise3D, p); }
// Distance from the camera to the opaque scene behind this fragment (m; 1e9 for sky).
#ifdef FX_FRAG
float fxSceneDist() { return sceneDistance(gl_FragCoord.xy / uResolution); }
#endif
// Direct sun at a point, including cloud shadow.
vec3 fxSun(vec3 p) { return atmSunIlluminance(p) * cloudShadow(p); }
// Point fx light (afterburner / fire) irradiance at p.
vec3 fxLocal(vec3 p) { vec3 d = uFxLightPos - p; return uFxLightColor / (dot(d, d) + 4.0); }
vec3 fxACES(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 fxTM(vec3 x) { return pow(fxACES(x * uFxPreviewExposure), vec3(1.0 / 2.2)); }
// lit: premultiplied lit radiance (L·a); a: coverage; emis: additive emission. Applies aerial perspective.
vec4 fxFinish(vec3 lit, float a, vec3 emis, vec3 renderPos) {
  if (uFxApOn > 0.5) { vec4 ap = atmAerialPerspective(renderPos); lit = lit * ap.a + ap.rgb * a; emis *= ap.a; }
  vec3 rgb = lit + emis;
  if (uFxPreviewTM > 0.5) rgb = fxTM(lit / max(a, 1e-3)) * a + fxTM(emis) * (1.0 - a * 0.5);
  return vec4(max(rgb, 0.0), clamp(a, 0.0, 1.0));
}
vec4 fxAP(vec3 renderPos) { return uFxApOn > 0.5 ? atmAerialPerspective(renderPos) : vec4(0.0, 0.0, 0.0, 1.0); }
// Same as fxFinish with a precomputed aerial perspective (per vertex / per instance).
vec4 fxFinishAP(vec3 lit, float a, vec3 emis, vec4 ap) {
  lit = lit * ap.a + ap.rgb * a; emis *= ap.a;
  vec3 rgb = lit + emis;
  if (uFxPreviewTM > 0.5) rgb = fxTM(lit / max(a, 1e-3)) * a + fxTM(emis) * (1.0 - a * 0.5);
  return vec4(max(rgb, 0.0), clamp(a, 0.0, 1.0));
}
// Media lighting with sun / ambient precomputed per vertex (cheap: no atmosphere/cloud-shadow calls per pixel).
vec3 fxMediaLightPre(vec3 albedo, vec3 sun, vec3 ambUp, vec3 ambDn, vec3 p, vec3 n, vec3 rd, float dens, float g) {
  float ndl = dot(n, uSunDir);
  float wrap = clamp((ndl + 0.6) / 1.6, 0.0, 1.0);
  float selfShadow = mix(1.0, 0.72, dens);
  float cosT = dot(rd, uSunDir);
  float phase = mix(1.0 / (4.0 * FX_PI), fxHG(cosT, g), 0.6) * 4.0 * FX_PI;
  vec3 direct = sun * (wrap * selfShadow * mix(1.0, phase, 0.35 + 0.65 * (1.0 - dens))) / FX_PI;
  vec3 amb = mix(ambDn, ambUp, n.y * 0.5 + 0.5) * (0.75 + 0.25 * (1.0 - dens));
  return albedo * (direct + amb + fxLocal(p) * (0.5 + 0.5 * max(dot(n, normalize(uFxLightPos - p)), 0.0)) / FX_PI);
}
// Approximate volumetric shading of a smoke/vapour puff: n = pseudo normal (world), dens = local density 0..1.
vec3 fxMediaLight(vec3 albedo, vec3 p, vec3 n, vec3 rd, float dens, float g) {
  vec3 sun = fxSun(p);
  float ndl = dot(n, uSunDir);
  float wrap = clamp((ndl + 0.6) / 1.6, 0.0, 1.0);
  float selfShadow = mix(1.0, 0.72, dens);
  float cosT = dot(rd, uSunDir);
  float phase = mix(1.0 / (4.0 * FX_PI), fxHG(cosT, g), 0.6) * 4.0 * FX_PI; // 1 = isotropic
  vec3 direct = sun * (wrap * selfShadow * mix(1.0, phase, 0.35 + 0.65 * (1.0 - dens))) / FX_PI;
  vec3 amb = atmAmbient(p, n) * (0.75 + 0.25 * (1.0 - dens));
  return albedo * (direct + amb + fxLocal(p) * (0.5 + 0.5 * max(dot(n, normalize(uFxLightPos - p)), 0.0)) / FX_PI);
}
// Blackbody-ish colour ramp for flames, t = 0 (dull red) .. 1 (white-yellow).
vec3 fxFlame(float t) {
  t = clamp(t, 0.0, 1.0);
  return mix(mix(vec3(0.5, 0.06, 0.01), vec3(1.0, 0.36, 0.06), smoothstep(0.0, 0.45, t)), vec3(1.0, 0.86, 0.6), smoothstep(0.45, 1.0, t));
}
`;
}

/** Premultiplied-alpha transparent material defaults. */
export function premulMaterialOpts() {
  return {
    glslVersion: THREE.GLSL3, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    fog: false, toneMapped: false, side: THREE.DoubleSide,
  };
}
