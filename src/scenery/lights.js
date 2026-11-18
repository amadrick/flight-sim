// Aeronautical ground lights as GPU-instanced, camera-facing sprites on LAYERS.POST (one draw call per airport).
// HDR radiance well above 1 so bloom picks them up; additive. Physically-motivated falloff (distance, atmospheric
// extinction from ctx.weather.visibility) with a minimum on-screen size so a lit runway reads from 30+ km.
// Directional fixtures only show inside their beam; PAPI colour comes from the viewer's real elevation angle.
// Occlusion: hardware depth test when the pipeline draws POST into a target that carries the scene depth; otherwise the
// vertex shader samples the scene depth texture at the light centre (whole sprite visible or hidden, never clipped).
import * as THREE from 'three';
import { CURVATURE_GLSL } from '../core/glsl.js';
import { LAYERS } from '../core/constants.js';
import { LIGHT_STRIDE } from './lightplan.js';

const VERT = /* glsl */`
precision highp float;
in vec4 aA; in vec4 aB; in vec4 aC; in vec4 aD;
uniform float uDbg, uTime, uOn, uDayK, uPixAngle, uMinPx, uVis, uGain, uManual, uDepthRev;
uniform mat4 uProjInv;
uniform highp sampler2D tDepthL;
out vec3 vCol; out vec2 vCorner;
${CURVATURE_GLSL}
const float HALO = 3.0;
void main() {
  vec3 lp = aA.xyz; vec3 col = vec3(aA.w, aB.x, aB.y); float I = aB.z;
  vec3 dir = vec3(aB.w, aC.x, aC.y); float cosW = aC.z; float mode = aC.w;
  float p1 = aD.x, p2 = aD.y, size = aD.z, dayK = aD.w;
  vec4 wp = modelMatrix * vec4(lp, 1.0);
  float hd = distance(wp.xz, cameraPosition.xz);
  float elev = atan(cameraPosition.y - wp.y, max(hd, 0.01));   // flat-earth viewing elevation (for PAPI)
  wp.y -= curvatureDrop(hd);
  vec3 toCam = cameraPosition - wp.xyz; float d = max(length(toCam), 0.01); vec3 V = toCam / d;
  float k = 1.0;
  if (cosW > -1.5) {
    float c = dot(V, normalize(dir));
    float soft = max(0.05, (1.0 - cosW) * 0.35);
    k = smoothstep(cosW - soft, cosW + soft, c);
    k *= 0.35 + 0.65 * smoothstep(cosW, 1.0, c);              // brighter in the beam centre
    // vertical beam spread: viewed from well above the beam axis only the weak omni component remains
    k *= mix(0.12, 1.0, 1.0 - smoothstep(0.14, 0.42, V.y - dir.y));  }
  if (mode > 0.5) {
    if (mode < 1.5) {                       // sequenced flasher (rabbit)
      float t = mod(uTime - p1, p2); k *= 1.0 - smoothstep(0.02, 0.06, t);
    } else if (mode < 2.5) {                // rotating beacon (two colours via phase)
      float ph = fract(uTime / p2 - p1); float a = cos(6.2831853 * ph); k *= pow(max(a, 0.0), 60.0);
    } else if (mode < 3.5) {                // PAPI: white above the unit's setting angle, red below (3' transition)
      float w = smoothstep(p1 - 0.0009, p1 + 0.0009, elev);
      col = mix(vec3(1.0, 0.05, 0.02), vec3(1.0, 0.92, 0.8), w);
    } else if (mode < 4.5) {                // slow obstruction blink
      float t = fract((uTime + p1) / p2); k *= 0.08 + 0.92 * (1.0 - smoothstep(0.3, 0.4, t)) * smoothstep(0.0, 0.05, t);
    } else if (mode < 5.5) {                // strobe (REIL)
      float t = mod(uTime - p1, p2); k *= 1.0 - smoothstep(0.03, 0.07, t);
    } else {                                // wig-wag
      k *= clamp(sin(6.2831853 * (uTime / p2 + p1)) * 3.0 + 0.5, 0.0, 1.0);
    }
  }
  float g = mix(dayK * uDayK, 1.0, uOn);
  float T = exp(-2.3 * d / uVis);
  float bright = uGain * I * k * g * T * pow(clamp(60.0 / d, 0.0, 1.0), 0.9);
  // occlusion (manual path) with a footprint-aware tolerance
  float tol = 0.8 + 2.0 * size + 1.5 * d * uPixAngle / max(abs(V.y), 0.03);
  vec4 vp = viewMatrix * wp;
  if (uManual > 0.5 && bright > 1e-3) {
    vec4 clip = projectionMatrix * vp;
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
    if (clip.w > 0.0 && uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
      // farthest of 5 taps around the centre: thin things in front (poles, wires, sub-pixel edges) don't hide a light
      vec2 px = 1.5 / vec2(textureSize(tDepthL, 0));
      float far = 0.0; bool sky = false;
      for (int t = 0; t < 5; t++) {
        vec2 o = t == 0 ? vec2(0.0) : t == 1 ? vec2(px.x, 0.0) : t == 2 ? vec2(-px.x, 0.0) : t == 3 ? vec2(0.0, px.y) : vec2(0.0, -px.y);
        vec2 uvt = clamp(uv + o, vec2(0.0), vec2(1.0));
        float dr = textureLod(tDepthL, uvt, 0.0).r;
        if (uDepthRev > 0.5 ? dr <= 0.0 : dr >= 1.0) { sky = true; break; }
        float zn = uDepthRev > 0.5 ? dr : dr * 2.0 - 1.0;
        vec4 sv = uProjInv * vec4(uvt * 2.0 - 1.0, zn, 1.0);
        far = max(far, -sv.z / sv.w);
      }
      if (!sky) {
        if (far < -vp.z * 0.97 - tol) bright = 0.0;
        if (uDbg > 0.5) { bright = 1.0; col = vec3(far / 1000.0, -vp.z / 1000.0, 0.0); }
      }
    }
  }
  if (bright < 1e-3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); vCorner = vec2(0.0); return; }
  float rp = size / (d * uPixAngle);
  float minPx = uMinPx * (0.7 + 0.3 * sqrt(I));
  float r = max(rp, minPx);
  vCol = col * bright;
  // pull toward the camera so the sprite is never cut by the surface it sits on (hardware depth path)
  float dv = length(vp.xyz);
  float pull = uManual > 0.5 ? 0.0 : min(tol, dv * 0.5);
  vec3 c = vp.xyz * ((dv - pull) / dv);
  float R = r * uPixAngle * (-c.z) * HALO;
  vCorner = position.xy;
  gl_Position = projectionMatrix * vec4(c.xy + position.xy * R, c.z, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
in vec3 vCol; in vec2 vCorner;
out vec4 outColor;
void main() {
  float r2 = dot(vCorner, vCorner) * 9.0;      // in units of the core radius (HALO = 3)
  if (r2 > 9.0) discard;
  float prof = exp(-r2 * 1.8) + 0.02 * exp(-r2 * 0.4) * (1.0 - r2 / 9.0);
  outColor = vec4(vCol * prof, 1.0);
}`;

export function createLightSystem(ctx) {
  const dummyDepth = new THREE.DataTexture(new Float32Array([0]), 1, 1, THREE.RedFormat, THREE.FloatType);
  dummyDepth.minFilter = dummyDepth.magFilter = THREE.NearestFilter; dummyDepth.needsUpdate = true;
  const uniforms = {
    uTime: { value: 0 }, uOn: { value: 0 }, uDayK: { value: 0.06 }, uPixAngle: { value: 0.001 }, uMinPx: { value: 1.0 },
    uDbg: { value: +(ctx.params.raw?.sldbg || 0) }, uVis: { value: 60000 }, uGain: { value: 140 }, uManual: { value: 0 }, uDepthRev: { value: 1 },
    uProjInv: { value: new THREE.Matrix4() }, tDepthL: { value: dummyDepth },
  };
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    fog: false, toneMapped: false,
  });
  const vp = new THREE.Vector4();
  // decide hardware vs manual depth once per render call (first light mesh drawn)
  function onBeforeRender(renderer) {
    const depthTex = ctx.uniforms.frame.tSceneDepth.value;
    const rt = renderer.getRenderTarget();
    const hw = !!(rt && depthTex && rt.depthTexture === depthTex);
    const manual = !hw && !!depthTex && ctx.params.raw?.slocc !== '0';
    material.depthTest = hw;
    uniforms.uManual.value = manual ? 1 : 0;
    uniforms.tDepthL.value = manual ? depthTex : dummyDepth;
    renderer.getCurrentViewport(vp);
    const cam = ctx.camera;
    uniforms.uPixAngle.value = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, vp.w) / (cam.zoom || 1);
    uniforms.uProjInv.value.copy(cam.projectionMatrixInverse);
    uniforms.uDepthRev.value = ctx.renderer.capabilities.reversedDepthBuffer ? 1 : 0;
  }

  const quad = new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]);
  function build(plan) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(quad, 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(plan.data), LIGHT_STRIDE, 1);
    g.setAttribute('aA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    g.setAttribute('aB', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    g.setAttribute('aC', new THREE.InterleavedBufferAttribute(buf, 4, 8));
    g.setAttribute('aD', new THREE.InterleavedBufferAttribute(buf, 4, 12));
    g.instanceCount = plan.count;
    let r = 0, cx = 0, cz = 0;
    const d = plan.data;
    for (let i = 0; i < plan.count; i++) { cx += d[i * LIGHT_STRIDE]; cz += d[i * LIGHT_STRIDE + 2]; }
    cx /= Math.max(1, plan.count); cz /= Math.max(1, plan.count);
    for (let i = 0; i < plan.count; i++) r = Math.max(r, Math.hypot(d[i * LIGHT_STRIDE] - cx, d[i * LIGHT_STRIDE + 2] - cz));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 20, cz), r + 200);
    const mesh = new THREE.Mesh(g, material);
    mesh.layers.set(LAYERS.POST);
    mesh.renderOrder = 10;
    mesh.onBeforeRender = onBeforeRender;
    mesh.matrixAutoUpdate = true;
    return mesh;
  }

  const gainMul = +(ctx.params.raw?.slgain || 1);
  function update() {
    uniforms.uTime.value = ctx.time.now;
    uniforms.uGain.value = 140 * gainMul;
    const night = ctx.env.nightFactor ?? 0;
    const vis = ctx.weather.visibility ?? 60000;
    const lowVis = 1 - THREE.MathUtils.smoothstep(vis, 3000, 9000);   // lights on by day in low visibility
    uniforms.uOn.value = Math.max(THREE.MathUtils.smoothstep(night, 0.15, 0.7), lowVis);
    uniforms.uVis.value = Math.max(800, vis);
  }
  return { material, uniforms, build, update };
}
