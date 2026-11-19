// Screen-space ambient occlusion for contact shading (gear, stores, aircraft on the ground, buildings).
//
// Half resolution, reconstructed from the scene depth (no normal buffer): a 12-tap "scalable ambient obscurance"
// estimator (McGuire et al. 2012) on a golden-angle spiral whose rotation follows a FIXED 4x4 Bayer pattern, then a 4x4
// depth-aware box blur at half resolution that removes that pattern exactly (so the result is stable without leaning on
// TAA), then a bilateral 2x2 upsample inside the composite. The image itself is never blurred.
//
// AO must darken only the ambient part of the lighting. The pass also estimates, per pixel, the share of DIRECT light
// (key-light shadow map x N.L against the frame's direct/ambient split), so sunlit faces keep their brightness and
// shadowed contact areas get the full occlusion. Output: R = ambient visibility, G = view distance (m), B = direct share.
//
// Cost (half res): AO 5 depth fetches for position/normal + 12 depth fetches + 9 shadow PCF taps; blur 16 fetches;
// composite 4 fetches. ≈ 0.4–0.7 ms at 1080p on a mid-range GPU. Off at quality=low or with ?ao=0.
import * as THREE from 'three';
import { FRAME_UNIFORMS_GLSL, DEPTH_GLSL, FULLSCREEN_VERT, FullscreenPass } from '../core/glsl.js';
import { SUN_SHADOW_API_GLSL } from './shadows.js';

const HEAD = /* glsl */`
precision highp float; precision highp sampler2D;
in vec2 vUv; out vec4 outColor;
`;

const AO_FRAG = HEAD + FRAME_UNIFORMS_GLSL + DEPTH_GLSL + SUN_SHADOW_API_GLSL + /* glsl */`
uniform vec4 uAOParams;      // x: radius scale, y: intensity, z: fade-out distance (m), w: aspect (w/h)
uniform vec4 uAOKey;         // xyz: key-light direction (view space), w: direct share of a horizontal surface (0..0.92)
uniform vec2 uAOFullTexel;   // 1 / full-resolution size
float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.x + q.y * 4;
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(b[i]) + 0.5) / 16.0;
}
vec3 vpos(vec2 uv) { return viewPosFromDepth(uv, sceneDepthRaw(uv)); }
void main() {
  float d = sceneDepthRaw(vUv);
  if (depthIsSky(d)) { outColor = vec4(1.0, 60000.0, 1.0, 1.0); return; }   // half-float safe
  vec3 P = viewPosFromDepth(vUv, d);
  float dist = length(P);
  if (dist > uAOParams.z) { outColor = vec4(1.0, min(dist, 60000.0), 1.0, 1.0); return; }
  // normal from depth: the smaller of the two one-sided differences on each axis (no halos at silhouettes)
  vec2 tx = uAOFullTexel;
  vec3 pr = vpos(vUv + vec2(tx.x, 0.0)) - P, pl = P - vpos(vUv - vec2(tx.x, 0.0));
  vec3 pu = vpos(vUv + vec2(0.0, tx.y)) - P, pd = P - vpos(vUv - vec2(0.0, tx.y));
  vec3 dx = dot(pr, pr) < dot(pl, pl) ? pr : pl;
  vec3 dy = dot(pu, pu) < dot(pd, pd) ? pu : pd;
  vec3 N = normalize(cross(dx, dy));
  if (dot(N, P) > 0.0) N = -N;
  // world radius grows gently with distance (contact detail up close, building/aircraft scale further out)
  float R = clamp(dist * 0.035, 0.22, 1.7) * uAOParams.x;
  float rUV = R * uProjMatrix[1][1] * 0.5 / max(-P.z, 0.05);
  rUV = clamp(rUV, 3.0 * tx.y, 0.12);
  float a0 = bayer4(gl_FragCoord.xy) * 6.2831853;
  float sum = 0.0, R2 = R * R, bias = 0.002 * dist + 0.01;
  for (int i = 0; i < 12; i++) {
    float f = (float(i) + 0.5) / 12.0;
    float ang = a0 + float(i) * 2.39996323;
    vec2 off = vec2(cos(ang) / uAOParams.w, sin(ang)) * rUV * sqrt(f);
    vec2 suv = vUv + off;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float sd = sceneDepthRaw(suv);
    if (depthIsSky(sd)) continue;
    vec3 v = viewPosFromDepth(suv, sd) - P;
    float vv = dot(v, v);
    float fall = max(1.0 - vv / R2, 0.0);
    sum += fall * fall * max((dot(v, N) - bias) * inversesqrt(vv + 1e-6) - 0.08, 0.0);
  }
  float ao = clamp(1.0 - sum * (2.0 / 12.0) * uAOParams.y, 0.0, 1.0);
  ao = mix(ao, 1.0, smoothstep(uAOParams.z * 0.45, uAOParams.z, dist));
  // share of direct (key) light at this pixel: shadow map x N.L relative to the horizontal reference of the frame
  vec3 Pw = (uCameraWorld * vec4(P, 1.0)).xyz;
  vec3 Nw = normalize(mat3(uCameraWorld) * N);
  float ndl = max(dot(N, uAOKey.xyz), 0.0);
#ifdef AO_NO_SHADOW
  float lit = 1.0;
#else
  float lit = ndl > 0.0 ? sunShadow(Pw, Nw) : 0.0;
#endif
  float kd = uAOKey.w;
  float keyUp = max(dot(mat3(uCameraWorld) * uAOKey.xyz, vec3(0.0, 1.0, 0.0)), 0.08);
  float ratio = kd / max(1.0 - kd, 0.05) * ndl * lit / keyUp;
  float share = ratio / (1.0 + ratio);
  outColor = vec4(ao, dist, share, 1.0);
}`;

// 4x4 depth-aware box blur at half resolution (offsets -2..1: the output is centred half a texel down-left; the
// composite's upsample compensates).
const BLUR_FRAG = HEAD + /* glsl */`
uniform sampler2D tAO; uniform vec2 uTexel;
void main() {
  vec3 c = texture(tAO, vUv).rgb;
  float dc = c.g;
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int j = -2; j <= 1; j++) for (int i = -2; i <= 1; i++) {
    vec3 s = texture(tAO, vUv + vec2(float(i), float(j)) * uTexel).rgb;
    float w = exp(-min(abs(s.g - dc) / (0.04 * dc + 0.08), 40.0));
    acc += vec3(s.r, s.b, 0.0) * w; ws += w;
  }
  acc /= max(ws, 1e-4);
  outColor = vec4(acc.x, dc, acc.y, 1.0);
}`;

/** GLSL for the composite: float aoAmbient(vec2 uv, float dist, out float share). */
export const AO_COMPOSITE_GLSL = /* glsl */`
uniform sampler2D tAO;
uniform vec4 uAOSize;        // xy: AO texture size, z: 1 = on, w: strength
vec2 aoSample(vec2 uv, float dist) {
  if (uAOSize.z < 0.5) return vec2(1.0, 1.0);
  // the blur centred its output half a texel down-left: shift by +0.5 texel before the 2x2 bilateral fetch
  vec2 pos = uv * uAOSize.xy, b = floor(pos), f = pos - b;
  vec2 res = vec2(0.0); float ws = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 o = vec2(float(i), float(j));
    vec3 s = texture(tAO, (b + o + 0.5) / uAOSize.xy).rgb;
    vec2 bw = mix(1.0 - f, f, o);
    float w = bw.x * bw.y * exp(-min(abs(s.g - min(dist, 60000.0)) / (0.03 * dist + 0.1), 40.0)) + 1e-5;
    res += vec2(s.r, s.b) * w; ws += w;
  }
  res /= ws;
  return res;
}
// multiply the lit colour by this: occlusion applies to the ambient share only
float aoFactor(vec2 uv, float dist) {
  vec2 a = aoSample(uv, dist);
  float vis = mix(1.0, a.x, uAOSize.w);
  return a.y + (1.0 - a.y) * vis;
}
`;

export function createAO(ctx, shadowUniforms) {
  const F = ctx.uniforms.frame;
  const raw = ctx.params?.raw || {};
  const mkRT = () => new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, colorSpace: THREE.LinearSRGBColorSpace,
  });
  const rtA = mkRT(), rtB = mkRT();
  const params = new THREE.Vector4(+(raw.aoradius || 1), +(raw.aointensity || 1.4), 450, 1.777);
  const key = new THREE.Vector4(0, 1, 0, 0.5);
  const fullTexel = new THREE.Vector2(1, 1);
  const mk = (uniforms, frag) => new FullscreenPass(new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false, fog: false,
    uniforms, vertexShader: FULLSCREEN_VERT, fragmentShader: frag,
  }));
  const aoPass = mk({ ...F, ...shadowUniforms, uAOParams: { value: params }, uAOKey: { value: key }, uAOFullTexel: { value: fullTexel } }, AO_FRAG);
  aoPass.material.defines = { AO_NO_SHADOW: 1 };
  const blurPass = mk({ tAO: { value: rtA.texture }, uTexel: { value: new THREE.Vector2() } }, BLUR_FRAG);
  const white = new THREE.DataTexture(new Uint8Array([255, 0, 255, 255]), 1, 1); white.needsUpdate = true;
  // composite uniforms (shared by reference)
  const compositeUniforms = { tAO: { value: white }, uAOSize: { value: new THREE.Vector4(1, 1, 0, 0.85) } };
  const mode = raw.ao;                        // ?ao=0 off, ?ao=1 force on (also at quality=low)
  const enabled = () => mode === '1' || (mode !== '0' && ctx.quality.level !== 'low');
  const v3 = new THREE.Vector3();
  return {
    compositeUniforms,
    get enabled() { return enabled(); },
    /** Render the AO for this frame. w, h: full internal size; keyDir: world direction to the key light; kDirect: share. */
    render(renderer, w, h, camera, keyDir, kDirect) {
      if (!enabled()) { compositeUniforms.tAO.value = white; compositeUniforms.uAOSize.value.z = 0; return; }
      const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
      if (rtA.width !== hw || rtA.height !== hh) { rtA.setSize(hw, hh); rtB.setSize(hw, hh); }
      params.w = w / h;
      fullTexel.set(1 / w, 1 / h);
      v3.copy(keyDir).transformDirection(camera.matrixWorldInverse);
      key.set(v3.x, v3.y, v3.z, kDirect);
      const noShadow = !(shadowUniforms.uSunShadowParams.value.w > 0.5 && shadowUniforms.tSunShadowMap.value);
      const m = aoPass.material;
      if (!!m.defines.AO_NO_SHADOW !== noShadow) { if (noShadow) m.defines.AO_NO_SHADOW = 1; else delete m.defines.AO_NO_SHADOW; m.needsUpdate = true; }
      aoPass.render(renderer, rtA);
      blurPass.material.uniforms.uTexel.value.set(1 / hw, 1 / hh);
      blurPass.render(renderer, rtB);
      compositeUniforms.tAO.value = rtB.texture;
      compositeUniforms.uAOSize.value.set(hw, hh, 1, +(raw.aostrength || 0.85));
    },
    dispose() { rtA.dispose(); rtB.dispose(); aoPass.dispose?.(); blurPass.dispose?.(); white.dispose(); },
  };
}
