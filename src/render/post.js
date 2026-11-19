// Post-processing shaders: temporal AA, bloom pyramid, lens + tone map, final resample (FXAA / CAS) + dither.
import * as THREE from 'three';
import { FRAME_UNIFORMS_GLSL, DEPTH_GLSL, FULLSCREEN_VERT, FullscreenPass } from '../core/glsl.js';
import { createNeuralFlare, flareGLSL } from '../neural/flare.js';

const HEAD = /* glsl */`
precision highp float; precision highp sampler2D;
in vec2 vUv; out vec4 outColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
`;

const mat = (uniforms, frag, extra = {}) => new FullscreenPass(new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false, fog: false,
  uniforms, vertexShader: FULLSCREEN_VERT, fragmentShader: frag, ...extra,
}));

// ---------------------------------------------------------------------------------------------------------------
// Temporal AA. Karis, "High Quality Temporal Supersampling" (SIGGRAPH 2014): tonemapped-space neighbourhood
// clipping; Salvi variance clipping (GDC 2016); Jimenez's 5-tap Catmull-Rom history fetch; closest-depth velocity
// dilation. There is no velocity buffer: static geometry is reprojected from depth with uPrevViewProj (which core
// keeps correct across floating-origin shifts), and everything inside the player aircraft's oriented bounding box
// is reprojected with the aircraft's own rigid motion — so the aircraft stays sharp in chase and cockpit views.
const TAA_FRAG = HEAD + FRAME_UNIFORMS_GLSL + DEPTH_GLSL + /* glsl */`
uniform sampler2D tCurrent; uniform sampler2D tHistory;
uniform mat4 uTaaCurVP;        // this frame's UNJITTERED proj * view
uniform mat4 uTaaObjInv;       // render space -> aircraft body space (this frame)
uniform mat4 uTaaObjPrev;      // aircraft body space -> where that point was last frame, in this frame's render space
uniform vec3 uTaaBoxMin; uniform vec3 uTaaBoxMax;
uniform vec4 uTaaParams;       // x: history weight, y: 1 = reset history, z: variance gamma, w: 1 = motion-adaptive (0: previous TAA)
uniform vec2 uTaaJitter;       // this frame's jitter in pixels

vec3 taa_fwd(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 taa_inv(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-5); }
vec3 taa_ycocg(vec3 c) { return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
vec3 taa_rgb(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
vec3 taa_cur(vec2 uv) { return taa_ycocg(taa_fwd(max(texture(tCurrent, uv).rgb, 0.0))); }
vec3 taa_history(vec2 uv, vec2 texel) {
  vec2 pos = uv / texel, c = floor(pos - 0.5) + 0.5, f = pos - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2, t0 = (c - 1.0) * texel, t3 = (c + 2.0) * texel, t12 = (c + w2 / w12) * texel;
  vec4 r = vec4(texture(tHistory, vec2(t12.x, t0.y)).rgb, 1.0) * (w12.x * w0.y);
  r += vec4(texture(tHistory, vec2(t0.x, t12.y)).rgb, 1.0) * (w0.x * w12.y);
  r += vec4(texture(tHistory, vec2(t12.x, t12.y)).rgb, 1.0) * (w12.x * w12.y);
  r += vec4(texture(tHistory, vec2(t3.x, t12.y)).rgb, 1.0) * (w3.x * w12.y);
  r += vec4(texture(tHistory, vec2(t12.x, t3.y)).rgb, 1.0) * (w12.x * w3.y);
  return max(r.rgb / r.a, 0.0);
}
bool taa_closer(float a, float b) { return uDepthReversed > 0.5 ? a > b : a < b; }
void main() {
  vec2 texel = 1.0 / uResolution;
  // velocity of the closest surface in a 5-tap cross (computed first: the reconstruction filter depends on it)
  float d = sceneDepthRaw(vUv); vec2 uvD = vUv;
  vec2 offs[4] = vec2[4](vec2(texel.x, 0.0), vec2(-texel.x, 0.0), vec2(0.0, texel.y), vec2(0.0, -texel.y));
  for (int k = 0; k < 4; k++) { float dk = sceneDepthRaw(vUv + offs[k]); if (taa_closer(dk, d)) { d = dk; uvD = vUv + offs[k]; } }
  vec4 cc, cp;
  if (depthIsSky(d)) {
    vec3 dir = viewRay(uvD);
    cc = uTaaCurVP * vec4(dir, 0.0); cp = uPrevViewProj * vec4(dir, 0.0);
  } else {
    vec3 P = renderPosFromDepth(uvD, d);
    vec3 pb = (uTaaObjInv * vec4(P, 1.0)).xyz;
    bool inObj = all(greaterThan(pb, uTaaBoxMin)) && all(lessThan(pb, uTaaBoxMax));
    vec3 Pp = inObj ? (uTaaObjPrev * vec4(pb, 1.0)).xyz : P;
    cc = uTaaCurVP * vec4(P, 1.0); cp = uPrevViewProj * vec4(Pp, 1.0);
  }
  vec2 vel = (cc.xy / cc.w - cp.xy / cp.w) * 0.5;
  float speed = cp.w > 0.0 ? length(vel * uResolution) : 99.0;
  // motion 0 (still) .. 1 (fast): written to alpha so the final pass can sharpen moving pixels a little more
  float motion = clamp((speed - 0.5) / 12.0, 0.0, 1.0) * uTaaParams.w;

  // 3x3 neighbourhood (tonemapped YCoCg): statistics + an estimate of the current pixel centred on where the jittered
  // sample really is. Still pixels use a wide Gaussian (≈ Blackman-Harris, most anti-aliasing); moving pixels, which
  // rely mostly on the current frame, a narrow one so the frame is not blurred by the reconstruction filter itself.
  vec3 m1 = vec3(0.0), m2 = vec3(0.0), mn = vec3(1e9), mx = vec3(-1e9), cur = vec3(0.0);
  float wsum = 0.0, kf = mix(2.29, 5.5, motion);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    vec3 c = taa_cur(vUv + o * texel);
    m1 += c; m2 += c * c; mn = min(mn, c); mx = max(mx, c);
    vec2 dd = o - uTaaJitter;
    float w = exp(-kf * dot(dd, dd));
    cur += c * w; wsum += w;
  }
  cur /= wsum;
  if (uTaaParams.y > 0.5) { outColor = vec4(taa_inv(taa_rgb(cur)), motion); return; }

  vec2 huv = vUv - vel;
  if (cp.w <= 0.0 || huv.x < 0.0 || huv.x > 1.0 || huv.y < 0.0 || huv.y > 1.0) { outColor = vec4(taa_inv(taa_rgb(cur)), motion); return; }

  vec3 hist = taa_ycocg(taa_fwd(taa_history(huv, texel)));
  // variance clip toward the neighbourhood mean (tighter when moving: less ghosting / smearing)
  vec3 mu = m1 / 9.0, sigma = sqrt(max(m2 / 9.0 - mu * mu, 0.0));
  float gam = mix(uTaaParams.z, 1.0, motion);
  vec3 lo = max(mn, mu - gam * sigma), hi = min(mx, mu + gam * sigma);
  vec3 ctr = 0.5 * (lo + hi), ext = 0.5 * (hi - lo) + 1e-5;
  vec3 v = hist - ctr, a = abs(v / ext);
  float ma = max(a.x, max(a.y, a.z));
  hist = ma > 1.0 ? ctr + v / ma : hist;
  // trust history less under fast motion (less blur), more when still (more samples). The fractional part of the
  // motion decides how much the bicubic history resample (a slight low-pass) accumulates.
  float subpx = abs(fract(vel.x * uResolution.x + 0.5) - 0.5) + abs(fract(vel.y * uResolution.y + 0.5) - 0.5);
  float keep = uTaaParams.x * mix(1.0, 0.8, clamp(speed / 20.0, 0.0, 1.0)) * mix(1.0, 0.94, clamp(subpx * 2.0, 0.0, 1.0) * step(0.5, speed) * uTaaParams.w);
  vec3 res = mix(cur, hist, keep);
  outColor = vec4(taa_inv(taa_rgb(res)), motion);
}`;

// ---------------------------------------------------------------------------------------------------------------
// Bloom: Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare" (SIGGRAPH 2014).
// 13-tap downsample (Karis partial average on the first level: no fireflies), 9-tap tent upsample, levels blended
// with a lerp so the result is a normalised (energy conserving) wide kernel; no threshold.
const DOWN_FRAG = HEAD + /* glsl */`
uniform sampler2D tSrc; uniform vec2 uSrcTexel; uniform float uKaris;     // > 0 on the first level
vec3 s(float x, float y) { return min(max(texture(tSrc, vUv + vec2(x, y) * uSrcTexel).rgb, 0.0), vec3(30000.0)); }
float kw(vec3 c) { return 1.0 / (1.0 + dot(c, LUMA) * uKaris); }      // uKaris = 0.2 * exposure: display-referred weight
void main() {
  vec3 a = s(-2.0, 2.0), b = s(0.0, 2.0), c = s(2.0, 2.0), d = s(-2.0, 0.0), e = s(0.0, 0.0), f = s(2.0, 0.0);
  vec3 g = s(-2.0, -2.0), h = s(0.0, -2.0), i = s(2.0, -2.0), j = s(-1.0, 1.0), k = s(1.0, 1.0), l = s(-1.0, -1.0), m = s(1.0, -1.0);
  vec3 col;
  if (uKaris > 0.0) {
    vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25, g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
    float w0 = kw(g0) * 0.5, w1 = kw(g1) * 0.125, w2 = kw(g2) * 0.125, w3 = kw(g3) * 0.125, w4 = kw(g4) * 0.125;
    col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  outColor = vec4(col, 1.0);
}`;
const UP_FRAG = HEAD + /* glsl */`
uniform sampler2D tLow; uniform sampler2D tHigh; uniform vec2 uLowTexel; uniform float uScatter;
vec3 s(float x, float y) { return texture(tLow, vUv + vec2(x, y) * uLowTexel).rgb; }
void main() {
  vec3 low = (s(-1.0, 1.0) + s(1.0, 1.0) + s(-1.0, -1.0) + s(1.0, -1.0)) * 0.0625
           + (s(0.0, 1.0) + s(0.0, -1.0) + s(-1.0, 0.0) + s(1.0, 0.0)) * 0.125 + s(0.0, 0.0) * 0.25;
  outColor = vec4(mix(texture(tHigh, vUv).rgb, low, uScatter), 1.0);
}`;

// ---------------------------------------------------------------------------------------------------------------
// Lens + tone map. Exposure → analytic lens glare/flare around the sun → vignette → AgX (Sobotka; Filament/three.js
// fit) with a mild contrast/saturation look → sRGB OETF. Alpha carries luma for FXAA.
const TONEMAP_FRAG = HEAD + /* glsl */`
uniform sampler2D tHDR; uniform sampler2D tBloom;
uniform vec4 uTone;        // x: exposure, y: bloom strength, z: vignette strength, w: aspect (w / h)
uniform vec4 uLensSun;     // xy: sun position in uv, z: glare visibility (0..1), w: ghost strength
uniform vec3 uLensColor;   // sun irradiance at the camera (tints the glare)
uniform vec4 uGrade;       // x: AgX look power (contrast), y: saturation, z: 8-bit dither amplitude (0 = float target), w: frame
uniform float uDebug;
uniform float uNightGrade; // 0..1: rod-vision grade for dark-adapted scenes
uniform float uAlphaMotion; // 1: pass the TAA motion (tHDR.a) through alpha for the final sharpen, 0: luma for FXAA
${flareGLSL()}

vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 color) {
  const mat3 SRGB_TO_2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 R2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float minEv = -12.47393, maxEv = 4.026069;
  color = inset * (SRGB_TO_2020 * color);
  color = clamp((log2(max(color, 1e-10)) - minEv) / (maxEv - minEv), 0.0, 1.0);
  color = agxContrast(color);
  // look (ASC CDL power + saturation in the log-ish display domain)
  // contrast as a sigmoid symmetric about display mid-grey: keeps black, white and the AgX highlight roll-off, and
  // unlike a plain power does not darken the whole picture
  vec3 cp = pow(max(color, 0.0), vec3(uGrade.x)), cq = pow(max(1.0 - color, 0.0), vec3(uGrade.x));
  color = cp / max(cp + cq, 1e-6);
  float l = dot(color, LUMA);
  color = l + uGrade.y * (color - l);
  color = outset * color;
  color = pow(max(color, 0.0), vec3(2.2));
  return clamp(R2020_TO_SRGB * color, 0.0, 1.0);
}
vec3 oetf(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

// Classic (hand-tuned) flare, kept for A/B (?flare=classic): veiling glare + diffraction spikes + a few ghosts.
// p in aspect-corrected screen units (height = 1).
vec3 lensClassic(vec2 uv) {
  vec2 asp = vec2(uTone.w, 1.0);
  vec2 sp = (uLensSun.xy - 0.5) * asp, p = (uv - 0.5) * asp;
  vec2 dv = p - sp; float r = length(dv);
  // glare spread: tight core + wide veil (roughly 1/r^2..3 like real lens/eye scatter)
  float core = 1.0 / (1.0 + pow(r / 0.022, 2.6));
  float veil = 0.016 / (1.0 + pow(r / 0.16, 2.0)) + 0.004 / (1.0 + pow(r / 0.5, 2.0));
  // 6-blade diffraction spikes, fading with distance
  float ang = atan(dv.y, dv.x);
  float spikes = pow(abs(cos(ang * 3.0 + 0.4)), 90.0) / (1.0 + pow(r / 0.045, 2.2));
  vec3 g = uLensColor * (core * 1.3 + veil + spikes * 0.05);
  // ghosts on the axis through the image centre
  vec3 gh = vec3(0.0);
  gh += vec3(0.45, 0.8, 1.0) * smoothstep(0.075, 0.03, length(p + sp * 0.42));
  gh += vec3(1.0, 0.6, 0.35) * smoothstep(0.035, 0.02, length(p + sp * 0.78)) * 0.9;
  gh += vec3(0.5, 1.0, 0.6) * smoothstep(0.16, 0.10, length(p + sp * 1.35)) * 0.35;
  gh += vec3(0.8, 0.6, 1.0) * smoothstep(0.02, 0.012, length(p - sp * 0.35)) * 1.1;
  float halo = smoothstep(0.03, 0.0, abs(length(p + sp * 0.12) - 0.42));
  gh += vec3(0.9, 0.7, 0.5) * halo * 0.07;
  g += uLensColor * gh * (0.0045 * uLensSun.w);
  return g * uLensSun.z;
}
// Lens flare learned from a ray-traced double-Gauss (src/neural/flare.js): starburst + veil + 12 ghosts, physical
// brightness (sun irradiance x point-spread density / screen solid angle), faded by the sun's visibility.
vec3 lens(vec2 uv) {
  if (uFlareParams.y < 0.5) return lensClassic(uv);
  vec2 asp = vec2(uTone.w, 1.0) * 2.0;
  return flareNeural((uv - 0.5) * asp, (uLensSun.xy - 0.5) * asp, uLensColor) * uLensSun.z;
}

void main() {
  vec4 hdr = texture(tHDR, vUv);
  vec3 c = max(hdr.rgb, 0.0);
  if (uTone.y > 0.0) c = mix(c, texture(tBloom, vUv).rgb, uTone.y);
  if (uLensSun.z > 0.0005) c += lens(vUv);
  c *= uTone.x;
  vec2 q = (vUv - 0.5) * 2.0;
  c *= 1.0 - uTone.z * pow(dot(q, q) * 0.5, 1.4);
  if (uDebug > 0.5) { outColor = vec4(oetf(clamp(c, 0.0, 1.0)), 1.0); return; }
  if (uNightGrade > 0.0) {
    // Night vision is rod vision: dim surfaces lose colour and shift blue (Purkinje); lights keep their colour.
    float y = dot(c, LUMA);
    float w = uNightGrade * (1.0 - smoothstep(0.04, 0.7, y));
    c = mix(c, y * vec3(0.62, 0.84, 1.24), 0.78 * w);
  }
  c = oetf(agx(c));
  if (uGrade.z > 0.0) {   // 8-bit intermediate: triangular dither here too
    float n = hash12(gl_FragCoord.xy + uGrade.w * 7.31) + hash12(gl_FragCoord.yx * 1.37 + uGrade.w * 3.17 + 19.0) - 1.0;
    c += n * uGrade.z;
  }
  outColor = vec4(c, uAlphaMotion > 0.5 ? clamp(hdr.a, 0.0, 1.0) : dot(c, vec3(0.299, 0.587, 0.114)));
}`;

// ---------------------------------------------------------------------------------------------------------------
// Final pass → canvas: resample from the internal resolution, FXAA 3.11 (Lottes) when temporal AA is off or
// contrast-adaptive sharpening (AMD FidelityFX CAS) when it is on, then triangular-PDF dither against banding.
const FINAL_FRAG = HEAD + /* glsl */`
uniform sampler2D tLDR; uniform vec2 uSrcTexel;
uniform vec4 uFinal;       // x: mode (0 plain, 1 FXAA, 2 CAS), y: sharpness 0..1, z: frame, w: dither amplitude
uniform vec4 uFinal2;      // x: 1 = upscaling (bicubic centre tap), y: extra sharpness for moving pixels (CAS, alpha = motion)
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

vec3 fxaa(vec2 uv) {
  vec4 M = texture(tLDR, uv);
  float lM = M.a;
  float lN = texture(tLDR, uv + vec2(0.0, uSrcTexel.y)).a, lS = texture(tLDR, uv - vec2(0.0, uSrcTexel.y)).a;
  float lE = texture(tLDR, uv + vec2(uSrcTexel.x, 0.0)).a, lW = texture(tLDR, uv - vec2(uSrcTexel.x, 0.0)).a;
  float lMax = max(lM, max(max(lN, lS), max(lE, lW))), lMin = min(lM, min(min(lN, lS), min(lE, lW)));
  float range = lMax - lMin;
  if (range < max(0.0312, lMax * 0.125)) return M.rgb;
  float lNW = texture(tLDR, uv + vec2(-uSrcTexel.x, uSrcTexel.y)).a, lNE = texture(tLDR, uv + uSrcTexel).a;
  float lSW = texture(tLDR, uv - uSrcTexel).a, lSE = texture(tLDR, uv + vec2(uSrcTexel.x, -uSrcTexel.y)).a;
  float lNS = lN + lS, lWE = lW + lE;
  float subpix = (2.0 * (lNS + lWE) + lNW + lNE + lSW + lSE) / 12.0;
  subpix = clamp(abs(subpix - lM) / range, 0.0, 1.0); subpix = subpix * subpix * (3.0 - 2.0 * subpix); subpix = subpix * subpix * 0.75;
  float edgeH = abs(lNW + lSW - 2.0 * lW) + 2.0 * abs(lNS - 2.0 * lM) + abs(lNE + lSE - 2.0 * lE);
  float edgeV = abs(lNW + lNE - 2.0 * lN) + 2.0 * abs(lWE - 2.0 * lM) + abs(lSW + lSE - 2.0 * lS);
  bool horz = edgeH >= edgeV;      // edge runs horizontally → step vertically
  float l1 = horz ? lS : lW, l2 = horz ? lN : lE;
  float g1 = l1 - lM, g2 = l2 - lM;
  bool steep1 = abs(g1) >= abs(g2);
  float grad = 0.25 * max(abs(g1), abs(g2));
  float stepLen = horz ? uSrcTexel.y : uSrcTexel.x;
  float lAvg;
  if (steep1) { stepLen = -stepLen; lAvg = 0.5 * (l1 + lM); } else lAvg = 0.5 * (l2 + lM);
  vec2 cuv = uv; if (horz) cuv.y += stepLen * 0.5; else cuv.x += stepLen * 0.5;
  vec2 off = horz ? vec2(uSrcTexel.x, 0.0) : vec2(0.0, uSrcTexel.y);
  vec2 uv1 = cuv - off, uv2 = cuv + off;
  float e1 = texture(tLDR, uv1).a - lAvg, e2 = texture(tLDR, uv2).a - lAvg;
  bool r1 = abs(e1) >= grad, r2 = abs(e2) >= grad;
  for (int i = 0; i < 10; i++) {
    if (r1 && r2) break;
    float q = i < 4 ? 1.0 : (i < 7 ? 2.0 : 4.0);
    if (!r1) { uv1 -= off * q; e1 = texture(tLDR, uv1).a - lAvg; r1 = abs(e1) >= grad; }
    if (!r2) { uv2 += off * q; e2 = texture(tLDR, uv2).a - lAvg; r2 = abs(e2) >= grad; }
  }
  float d1 = horz ? uv.x - uv1.x : uv.y - uv1.y, d2 = horz ? uv2.x - uv.x : uv2.y - uv.y;
  bool dir1 = d1 < d2;
  float dist = min(d1, d2), len = d1 + d2;
  bool mLess = lM < lAvg;
  bool good = ((dir1 ? e1 : e2) < 0.0) != mLess;
  float pixOff = good ? 0.5 - dist / len : 0.0;
  float o = max(pixOff, subpix);
  vec2 fuv = uv; if (horz) fuv.y += o * stepLen; else fuv.x += o * stepLen;
  return texture(tLDR, fuv).rgb;
}
// Catmull-Rom (5 taps, Jimenez) — used for the centre tap when the internal resolution is below the output
vec4 bicubic(vec2 uv) {
  vec2 pos = uv / uSrcTexel, c = floor(pos - 0.5) + 0.5, f = pos - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2, t0 = (c - 1.0) * uSrcTexel, t3 = (c + 2.0) * uSrcTexel, t12 = (c + w2 / w12) * uSrcTexel;
  vec4 r = texture(tLDR, vec2(t12.x, t0.y)) * (w12.x * w0.y) + texture(tLDR, vec2(t0.x, t12.y)) * (w0.x * w12.y)
         + texture(tLDR, t12) * (w12.x * w12.y) + texture(tLDR, vec2(t3.x, t12.y)) * (w3.x * w12.y)
         + texture(tLDR, vec2(t12.x, t3.y)) * (w12.x * w3.y);
  return r / ((w12.x * w0.y) + (w0.x * w12.y) + (w12.x * w12.y) + (w3.x * w12.y) + (w12.x * w3.y));
}
vec3 cas(vec2 uv) {
  vec4 c4 = uFinal2.x > 0.5 ? bicubic(uv) : texture(tLDR, uv);
  vec3 c = c4.rgb;
  vec3 a = texture(tLDR, uv - vec2(0.0, uSrcTexel.y)).rgb, b = texture(tLDR, uv - vec2(uSrcTexel.x, 0.0)).rgb;
  vec3 d = texture(tLDR, uv + vec2(uSrcTexel.x, 0.0)).rgb, e = texture(tLDR, uv + vec2(0.0, uSrcTexel.y)).rgb;
  vec3 mn = min(c, min(min(a, b), min(d, e))), mx = max(c, max(max(a, b), max(d, e)));
  mn = min(mn, c); mx = max(mx, c);
  vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
  float sharp = clamp(uFinal.y + uFinal2.y * clamp(c4.a, 0.0, 1.0), 0.0, 1.0);
  vec3 w = amp * (-1.0 / mix(8.0, 4.5, sharp));
  return clamp((c + (a + b + d + e) * w) / (1.0 + 4.0 * w), 0.0, 1.0);
}
void main() {
  vec3 c = uFinal.x > 1.5 ? cas(vUv) : (uFinal.x > 0.5 ? fxaa(vUv) : texture(tLDR, vUv).rgb);
  float n = hash12(gl_FragCoord.xy + uFinal.z * 5.39) + hash12(gl_FragCoord.yx * 1.21 + uFinal.z * 2.71 + 11.0) - 1.0;
  outColor = vec4(c + n * uFinal.w, 1.0);
}`;

const COPY_FRAG = HEAD + /* glsl */`
uniform sampler2D tSrc;
void main() { outColor = texture(tSrc, vUv); }`;

export function createPostPasses(ctx) {
  const F = ctx.uniforms.frame;
  const taa = mat({
    ...F, tCurrent: { value: null }, tHistory: { value: null },
    uTaaCurVP: { value: new THREE.Matrix4() }, uTaaObjInv: { value: new THREE.Matrix4() }, uTaaObjPrev: { value: new THREE.Matrix4() },
    uTaaBoxMin: { value: new THREE.Vector3(1, 1, 1) }, uTaaBoxMax: { value: new THREE.Vector3(-1, -1, -1) },
    uTaaParams: { value: new THREE.Vector4(0.9, 1, 1.25, 1) }, uTaaJitter: { value: new THREE.Vector2() },
  }, TAA_FRAG);
  const down = mat({ tSrc: { value: null }, uSrcTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } }, DOWN_FRAG);
  const up = mat({ tLow: { value: null }, tHigh: { value: null }, uLowTexel: { value: new THREE.Vector2() }, uScatter: { value: 0.65 } }, UP_FRAG);
  const flare = createNeuralFlare();      // bakes the flare networks into two small textures (once)
  const tonemap = mat({
    tHDR: { value: null }, tBloom: { value: null },
    uTone: { value: new THREE.Vector4(1, 0.05, 0.2, 1.777) }, uLensSun: { value: new THREE.Vector4(0.5, 0.5, 0, 1) },
    uLensColor: { value: new THREE.Vector3() }, uGrade: { value: new THREE.Vector4(1.18, 1.16, 0, 0) }, uDebug: { value: 0 }, uNightGrade: { value: 0 }, uAlphaMotion: { value: 0 },
    ...flare.uniforms,
  }, TONEMAP_FRAG);
  const final = mat({ tLDR: { value: null }, uSrcTexel: { value: new THREE.Vector2() }, uFinal: { value: new THREE.Vector4(0, 0.5, 0, 1 / 255) }, uFinal2: { value: new THREE.Vector4(0, 0, 0, 0) } }, FINAL_FRAG);
  const copy = mat({ tSrc: { value: null } }, COPY_FRAG);
  return { taa, down, up, tonemap, final, copy, flare };
}
