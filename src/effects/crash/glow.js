// Air glow around a crash fire: single scattering of the fire's light (the fx point light) by the haze between the
// camera and the scene. For a point source of radiant intensity I in air with scattering coefficient σ, the radiance
// scattered toward the camera along a ray that passes at distance b from the source is
//     L = σ·p·I · ∫ ds / (b² + s²) = σ·p·I / b · [atan(s1/b) − atan(s0/b)]
// (p = phase function, taken isotropic with a forward bias). That integral is evaluated per pixel in closed form over
// the visible part of the ray (up to the scene depth), so the glow is occluded by terrain and the wreck and wraps
// correctly when the camera is inside it. At night with ~10 km visibility it is a wide orange dome over the fire,
// by day it is far below the sky and invisible: the physics does the day/night switch, no special casing.
// One back-faced sphere on LAYERS.POST, a few dozen ALU per covered pixel, pure emission (premultiplied, alpha 0).
import * as THREE from 'three';
import { LAYERS } from '../../core/constants.js';
import { premulMaterialOpts } from '../fxglsl.js';

export function createFireGlow(ctx, shared, header) {
  const u = {
    ...shared,
    uGlowPos: { value: new THREE.Vector3() }, uGlowI: { value: new THREE.Vector3() }, uGlowSigma: { value: 2e-4 },
    uGlowCore: { value: 10 },
  };
  const mat = new THREE.ShaderMaterial({
    ...premulMaterialOpts(), side: THREE.BackSide, depthTest: false, uniforms: u,
    vertexShader: header + /* glsl */`
out vec3 vPos;
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: '#define FX_FRAG\n' + header + /* glsl */`
in vec3 vPos; out vec4 outColor;
uniform vec3 uGlowPos; uniform vec3 uGlowI; uniform float uGlowSigma; uniform float uGlowCore;
void main() {
  vec3 rd = normalize(vPos - uCameraPos);
  vec3 oc = uGlowPos - uCameraPos;
  float sc = dot(oc, rd);                         // ray parameter of the closest approach
  float b2 = max(dot(oc, oc) - sc * sc, 0.0) + uGlowCore * uGlowCore;   // soft core: the source has a size
  float b = sqrt(b2);
  float s1 = min(fxSceneDist(), 2.0 * length(oc) + 4000.0);
  float J = (atan((s1 - sc) / b) - atan(-sc / b)) / b;
  // phase: isotropic + a forward-scattering haze lobe toward the camera when looking at the fire
  float cosT = clamp(sc / max(length(oc), 1e-3), -1.0, 1.0);
  float ph = 0.65 / (4.0 * FX_PI) + 0.35 * fxHG(cosT, 0.5);
  vec3 L = uGlowSigma * ph * uGlowI * J;
  // extinction of the glow by the same air on the way back (cheap: at the closest approach)
  L *= exp(-uGlowSigma * max(sc, 0.0));
  if (dot(L, vec3(1.0)) * uFxExposure < 1e-3) discard;
  outColor = vec4(L, 0.0);
}`,
  });
  const geo = new THREE.SphereGeometry(1, 24, 16);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.layers.set(LAYERS.POST); mesh.renderOrder = 11; mesh.visible = false; mesh.name = 'fx-fireglow';
  ctx.scene.add(mesh);
  return {
    mesh,
    /** l = { pos (render), color, intensity } or null; size of the source (m) for the soft core */
    set(l, core = 10) {
      if (!l || !(l.intensity > 1)) { mesh.visible = false; return; }
      const vis = Math.max(200, ctx.weather?.visibility || 30000);
      const sigma = Math.min(0.02, Math.max(4e-5, 3.912 / vis - 1.16e-5) + 1.5e-3 * (ctx.weather?.precipitation || 0));
      u.uGlowSigma.value = sigma;
      u.uGlowI.value.set(l.color.r, l.color.g, l.color.b).multiplyScalar(l.intensity);
      u.uGlowPos.value.copy(l.pos); u.uGlowCore.value = core;
      // radius where the glow has faded to ~1e-3 of the scene's white at the current exposure, bounded
      const exp = Math.max(ctx.env?.exposure || 1, 0.2);
      const R = THREE.MathUtils.clamp(sigma * l.intensity * 0.12 * exp * 1000, 60, 4000);
      mesh.position.copy(l.pos); mesh.scale.setScalar(R); mesh.updateMatrix(); mesh.visible = true;
    },
    hide() { mesh.visible = false; },
    dispose() { ctx.scene.remove(mesh); geo.dispose(); mat.dispose(); },
  };
}
