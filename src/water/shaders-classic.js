// CLASSIC ocean surface shaders (water=classic): the original look, kept verbatim for A/B comparison.
//
// Geometry: camera-centred polar grid (constant angular resolution, geometric ring spacing ≈ square cells growing
//   with distance) displaced by the FFT cascades with a texture LOD matched to the local vertex spacing, so the
//   sampled surface is band-limited and does not swim. Earth-curvature drop via CURVATURE_GLSL. Wave amplitude fades
//   to zero as water depth -> 0 (terrainHeight), so troughs never cut through the seabed / beaches.
// Shading (per pixel, world-anchored): mip-filtered slopes of the 3 cascades give the resolved normal; the slope
//   variance those mips cannot represent (computed from the spectrum per mip level, Bruneton et al. 2010) plus the
//   capillary tail (Cox-Munk calibrated) becomes the anisotropic Beckmann roughness of the sun/moon glitter BRDF and
//   of the mean Fresnel. Result: crisp sparkles up close, a stable, correctly widening sun road at distance, no
//   sparkle aliasing. Water body colour from a two-flow upwelling model with depth (bottom albedo attenuated by
//   exp(-2 Kd d)), whitecaps from the FFT Jacobian (persistent), shore foam and breaking bands from depth.
import { FRAME_UNIFORMS_GLSL, CURVATURE_GLSL } from '../core/glsl.js';

export function waterVertexShader(terrainGLSL, atmGLSL) {
  return /* glsl */`
precision highp float; precision highp int;
${FRAME_UNIFORMS_GLSL}
${CURVATURE_GLSL}
${terrainGLSL}
${atmGLSL}
uniform sampler2D tDisp0, tDisp1, tDisp2;
uniform vec4 uCasc[3];          // xy = origin mod L, z = 1/L, w = N
uniform vec4 uMesh;             // xy = mesh centre (render space), z = scale, w = max reach (m)
uniform vec2 uGrid;             // x = core cell size, y = relative ring spacing (alpha)
uniform float uShoreFade;       // depth (m) at which waves reach full amplitude
uniform float uDispScale;
uniform float uMoonK;           // moon visibility factor (elevation × night)
out vec3 vPos; out vec2 vXZ; out vec3 vSunE; out float vHeight; out float vFade; out vec3 vMoonE;

vec3 dispAt(sampler2D t, vec4 c, vec2 xz, float spacing) {
  vec2 uv = (xz + c.xy) * c.z + 0.5 / c.w;
  // filter wavelengths shorter than ~4 vertex spacings (vertex-level band limiting, prevents swimming / aliasing)
  float lod = log2(max(4.0 * spacing * c.z * c.w, 1.0));
  return textureLod(t, uv, lod).xyz;
}

void main() {
  vec2 local = position.xz;
  float rl = length(local);
  float spacing = max(uGrid.x, uGrid.y * rl) * uMesh.z;
  vec2 off = local * uMesh.z;
  float r = rl * uMesh.z;
  if (r > uMesh.w) { off *= uMesh.w / r; }
  vec2 xz = uMesh.xy + off;
  float depth = -terrainHeight(xz + uOrigin.xz);
  float fade = smoothstep(0.0, uShoreFade, depth);
  vec3 d = vec3(0.0);
  if (fade > 0.0 && spacing < 400.0) {
    d = dispAt(tDisp0, uCasc[0], xz, spacing) + dispAt(tDisp1, uCasc[1], xz, spacing) + dispAt(tDisp2, uCasc[2], xz, spacing);
    d *= fade * uDispScale;
  }
  vec3 p = vec3(xz.x + d.x, d.y, xz.y + d.z);
  p.y = min(p.y, uCameraPos.y - 0.3);                 // never let a crest swallow the camera
  p.y -= curvatureDrop(length(p.xz - uCameraPos.xz));
  vPos = p; vXZ = xz; vHeight = d.y; vFade = fade;
  vSunE = atmSunIlluminance(vec3(p.x, max(p.y, 0.0), p.z));
  // moon irradiance ≈ 25·π × zenith sky radiance of a moonlit night (keeps the glitter path consistent with
  // whatever night sky/exposure the atmosphere produces)
  vMoonE = uMoonK > 0.0 ? uMoonK * 25.0 * 3.14159 * atmSkyRadiance(vec3(0.0, 1.0, 0.0)) * vec3(0.85, 0.92, 1.0) : vec3(0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
}

export function waterFragmentShader(terrainGLSL, atmGLSL) {
  return /* glsl */`
precision highp float; precision highp int;
${FRAME_UNIFORMS_GLSL}
${terrainGLSL}
${atmGLSL}
uniform sampler2D tSlope0, tSlope1, tSlope2, tFoamTex, tNoise;
uniform vec4 uCasc[3];
uniform vec2 uVar[30];          // unresolved (upwind, crosswind) slope variance per cascade × mip level
uniform vec2 uVarTail;          // capillary tail variance
uniform vec2 uWindDir;          // unit, direction the wind/waves travel (world x, z)
uniform vec4 uOriginWrap;       // xy = origin mod 4096, zw = origin mod 32768
uniform vec3 uFoamW;            // whitecap weight per cascade
uniform vec4 uSea;              // x = wind m/s, y = Hs (m), z = surf strength, w = anisotropy
uniform vec2 uSlickOff;         // wind-frame origin mod 16384
uniform vec3 uStreak;           // xy = wind-frame origin offset (wrapped), z = streak strength
uniform vec3 uFoam;             // x = crest Jacobian threshold, y = gain, z = mean whitecap coverage
uniform int uDebug;
in vec3 vPos; in vec2 vXZ; in vec3 vSunE; in float vHeight; in float vFade; in vec3 vMoonE;
layout(location = 0) out vec4 outColor;

const float PI = 3.14159265358979;

// mip level the (anisotropic) hardware filter picks for a texture of N texels per unit uv
float mipLod(vec2 uv, float N) {
  vec2 dx = dFdx(uv) * N, dy = dFdy(uv) * N;
  float a = length(dx), b = length(dy);
  return clamp(log2(max(max(min(a, b), max(a, b) / uSea.w), 1e-6)), 0.0, 9.0);
}
vec2 unresolvedVar(int c, float lod) {
  int i = int(lod); float f = lod - float(i);
  return mix(uVar[c * 10 + i], uVar[c * 10 + min(i + 1, 9)], f);
}

// Smith masking for Beckmann (Walter et al. 2007 rational fit)
float smithLambda(float cosT, float s2) {
  float v = cosT / sqrt(max(2.0 * s2 * (1.0 - cosT * cosT), 1e-7));
  return v < 1.6 ? (1.0 - 1.259 * v + 0.396 * v * v) / (3.535 * v + 2.181 * v * v) : 0.0;
}
float dirVar(vec3 d, vec3 tx, vec3 ty, vec2 s2) {
  vec2 a = vec2(dot(d, tx), dot(d, ty)); float c2 = a.x * a.x / max(dot(a, a), 1e-8);
  return s2.x * c2 + s2.y * (1.0 - c2);
}
// Anisotropic Beckmann glitter (Bruneton 2010, eq. for reflected sun radiance per unit irradiance)
float glitter(vec3 L, vec3 V, vec3 N, vec3 tx, vec3 ty, vec2 s2) {
  vec3 H = normalize(L + V);
  float zH = max(dot(H, N), 1e-3), zL = dot(L, N), zV = dot(V, N);
  float zx = dot(H, tx) / zH, zy = dot(H, ty) / zH;
  float p = exp(-0.5 * (zx * zx / s2.x + zy * zy / s2.y)) / (2.0 * PI * sqrt(s2.x * s2.y));
  float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, H), 0.0, 1.0), 5.0);
  float lam = smithLambda(max(zL, 0.01), dirVar(L, tx, ty, s2)) + smithLambda(max(zV, 0.01), dirVar(V, tx, ty, s2));
  float zH2 = zH * zH;
  return fres * p / ((1.0 + lam) * max(zV, 0.01) * zH2 * zH2 * 4.0) * smoothstep(-0.05, 0.05, zL);
}
// Fresnel averaged over the slope distribution (Bruneton 2010)
float meanFresnel(float cosV, float sigV) {
  return 0.02 + 0.98 * pow(1.0 - clamp(cosV, 0.0, 1.0), 5.0 * exp(-2.69 * sigV)) / (1.0 + 22.7 * pow(sigV, 1.5));
}

void main() {
  vec3 P = vPos;
  vec3 toCam = uCameraPos - P; float dist = length(toCam); vec3 V = toCam / dist;
  vec2 xz = vXZ;
  vec2 wq = xz + uOriginWrap.xy;

  // ---- resolved slopes (3 cascades, trilinear + anisotropic) + unresolved variance --------------------------
  vec2 uv0 = (xz + uCasc[0].xy) * uCasc[0].z + 0.5 / uCasc[0].w;
  vec2 uv1 = (xz + uCasc[1].xy) * uCasc[1].z + 0.5 / uCasc[1].w;
  vec2 uv2 = (xz + uCasc[2].xy) * uCasc[2].z + 0.5 / uCasc[2].w;
  vec4 s0 = texture(tSlope0, uv0), s1 = texture(tSlope1, uv1), s2 = texture(tSlope2, uv2);
  float lod0 = mipLod(uv0, uCasc[0].w), lod1 = mipLod(uv1, uCasc[1].w), lod2 = mipLod(uv2, uCasc[2].w);
  vec2 var = uVarTail + unresolvedVar(0, lod0) + unresolvedVar(1, lod1) + unresolvedVar(2, lod2);
  // Fine cascades repeat every 137 m / 19 m: once minified, their regular lattice becomes visible. Fade their
  // resolved slopes out with LOD and move the removed slope energy into the BRDF variance (energy-conserving).
  float w0 = 1.0 - 0.7 * smoothstep(3.0, 5.5, lod0);
  float w1 = 1.0 - smoothstep(2.0, 4.5, lod1), w2 = 1.0 - smoothstep(1.5, 3.5, lod2);
  var += (1.0 - w0 * w0) * (uVar[9] - unresolvedVar(0, lod0))
       + (1.0 - w1 * w1) * (uVar[19] - unresolvedVar(1, lod1)) + (1.0 - w2 * w2) * (uVar[29] - unresolvedVar(2, lod2));
  // per-cascade large-scale amplitude modulation hides FFT tile repetition (Tessendorf-style patch tiling is very
  // visible from altitude otherwise)
  vec4 nm = texture(tNoise, (xz + uOriginWrap.xy) / 4096.0);
  vec3 cm = vec3(0.55) + 0.9 * nm.rgb;
  vec2 grad = s0.xy * (cm.x * w0) + s1.xy * (cm.y * w1) + s2.xy * (cm.z * w2);
  // whitecaps: crests where the COMBINED horizontal map folds (linearised sum of the cascade Jacobians), plus
  // persistent per-cascade foam trails; when the crest field is minified, fall back to the statistical coverage
  // (Monahan & O'Muircheartaigh 1980: W = 3.84e-6 U^3.41).
  // breaking is driven by the big waves: weight the long cascades, the short one only adds texture
  float Jc = 1.0 + 1.3 * (s0.w - 1.0) + 1.25 * (s1.w - 1.0) + 0.45 * (s2.w - 1.0);
  float crestFoam = clamp((uFoam.x - Jc) * uFoam.y, 0.0, 1.0) * (0.5 + nm.g);
  float resolved = 1.0 - smoothstep(0.5, 2.5, lod1);
  float fresh = mix(uFoam.z, crestFoam, resolved);              // fresh, dense whitecap
  float residue = clamp(dot(vec3(s0.z, s1.z, s2.z), uFoamW), 0.0, 1.0);   // decaying foam left behind
  float cov = max(fresh, residue);

  // ---- large-scale sea-state variation: gust fronts, cat's paws and calm slicks (visible from altitude) ------
  vec2 nq = (xz + uOriginWrap.zw) / 32768.0 - uWindDir * (uTime * 0.0001);
  vec4 n1 = texture(tNoise, nq), n2 = texture(tNoise, nq * 4.0 + vec2(0.37, 0.71));
  float gust = clamp(0.6 * n1.r + 0.4 * n2.g, 0.0, 1.0);
  // surfactant slicks: long sinuous filaments stretched along the wind (wind-frame coords, origin wrapped on CPU)
  vec2 sw = vec2(dot(xz, uWindDir), dot(xz, vec2(-uWindDir.y, uWindDir.x))) + uSlickOff;
  float slick = smoothstep(0.72, 0.92, texture(tNoise, sw / vec2(16384.0, 4096.0)).a)
              * smoothstep(0.3, 0.6, n1.g) * (1.0 - smoothstep(5.0, 10.0, uSea.x));
  float rough = mix(0.75, 1.25, gust) * (1.0 - 0.5 * slick);
  var *= rough;
  grad *= 1.0 - 0.15 * slick;
  float gustF = mix(0.4, 1.6, gust) * (1.0 - slick);
  cov *= gustF; fresh *= gustF; residue *= gustF;

  // ---- depth, shore calming ----------------------------------------------------------------------------------
  float depth = max(-terrainHeight(xz + uOrigin.xz), 0.0);
  float calm = smoothstep(0.0, 6.0, depth);
  grad *= mix(0.4, 1.0, calm);                         // long waves feel the bottom...
  var = mix(var * 0.8, var, smoothstep(0.0, 1.5, depth)); // ...local wind ripples (most of the roughness) do not
  var = max(var, vec2(2e-4));

  // mean normal incl. earth curvature (sphere normal tilts away from the camera by d/R)
  vec2 rel = P.xz - uCameraPos.xz;
  vec3 N = normalize(vec3(-grad.x + rel.x / 6371000.0, 1.0, -grad.y + rel.y / 6371000.0));
  vec3 tx = vec3(uWindDir.x, 0.0, uWindDir.y), ty = vec3(-uWindDir.y, 0.0, uWindDir.x);
  float cosV = max(dot(V, N), 0.0);
  float varV = dirVar(V, tx, ty, var);

  // ---- sky reflection (horizon-safe: reflected rays that dip below the horizon are folded up; rough seas see
  //      a slightly higher, darker part of the sky because downward-facing facets are masked) ----------------------
  vec3 R = reflect(-V, N);
  float e = sqrt(R.y * R.y + 0.35 * varV) ;
  R = normalize(vec3(R.x, e, R.z));
  vec3 sky = atmSkyRadiance(R);
  float F = meanFresnel(cosV, sqrt(varV));

  // ---- water body (upwelling): deep navy offshore, green coastal water, turquoise over shallow sand ----------
  float coastal = 1.0 - smoothstep(12.0, 70.0, depth);
  vec3 rhoDeep = mix(vec3(0.0012, 0.0062, 0.0185), vec3(0.0035, 0.0145, 0.0155), coastal);
  vec3 Kd = mix(vec3(0.36, 0.065, 0.032), vec3(0.42, 0.085, 0.10), coastal * 0.6);
  vec3 att = exp(-2.0 * Kd * depth);
  float sand = 0.8 + 0.4 * n2.b;
  vec3 bottom = vec3(0.42, 0.40, 0.31) * sand * 0.55;
  vec3 rho = rhoDeep * (1.0 - att) + bottom * att;
  // aerated water (bubble clouds) under and around breaking crests glows turquoise-white
  rho += vec3(0.012, 0.04, 0.042) * clamp(cov * 2.5, 0.0, 1.0);
  vec3 L = uSunDir;
  vec3 Eamb = atmAmbient(P, vec3(0.0, 1.0, 0.0));
  vec3 Lw = rho * (vSunE * max(L.y, 0.0) / PI + Eamb + vMoonE * max(uMoonDir.y, 0.0) / PI);

  // light scattered through thin, sunlit wave crests (seen looking toward a low sun)
  vec3 Lh = normalize(vec3(L.x, 0.0, L.z) + 1e-5);
  float lowSun = smoothstep(-0.02, 0.08, L.y) * (1.0 - smoothstep(0.15, 0.5, L.y));
  float back = pow(clamp(dot(-V, Lh), 0.0, 1.0), 4.0) * lowSun * clamp(dot(N, -Lh) * 4.0 + 0.5, 0.0, 1.0);
  float crest = smoothstep(0.35, 1.0, vHeight / max(uSea.y * 0.5, 0.15));
  float steep = smoothstep(0.08, 0.3, length(grad));      // only thin, steep crest tops transmit visibly
  vec3 sss = vec3(0.01, 0.05, 0.042) * vSunE * crest * steep * back * calm;

  // ---- glitter: sun + moon --------------------------------------------------------------------------------
  vec3 spec = vSunE * glitter(L, V, N, tx, ty, var);
  if (uMoonDir.y > -0.02) spec += vMoonE * glitter(uMoonDir, V, N, tx, ty, var);

  // ---- foam: whitecaps (FFT Jacobian, persistent), shoreline foam and breaking bands -------------------------
  vec2 fuv = wq / 16.0;
  float ft = texture(tFoamTex, fuv).r * 0.65 + texture(tFoamTex, wq / 64.0 + 0.31).r * 0.35;
  float pxs = length(fwidth(fuv));
  float detailW = 1.0 - smoothstep(0.03, 0.25, pxs);
  cov = clamp(cov, 0.0, 1.0); fresh = clamp(fresh, 0.0, 1.0);
  // fresh crest foam: dense centres solid white, edges break up; residue: thin marbled lace that thins out as it decays
  float freshMask = smoothstep(0.0, 0.9, fresh) * (0.35 + 0.65 * smoothstep(0.15, 0.6, ft + 0.5 * fresh - 0.1));
  float resMask = residue * smoothstep(0.55 - 0.35 * residue, 0.75 - 0.3 * residue, ft) * 0.6;
  float wc = mix(cov * 0.8, max(freshMask, resMask), detailW);
  // wind-aligned foam streaks (Beaufort 6+), long thin lines in the wind frame (offset wrapped on the CPU)
  vec2 sq = vec2(dot(xz, uWindDir), dot(xz, vec2(-uWindDir.y, uWindDir.x))) + uStreak.xy;
  vec4 warp = texture(tNoise, sq / 256.0);
  sq.y += (warp.r - 0.5) * 18.0 + (warp.b - 0.5) * 5.0;
  vec2 stq = sq * vec2(1.0 / 64.0, 1.0 / 8.0);
  float stLod = length(fwidth(stq)) * 256.0;             // texels per pixel across the streaks
  float st = texture(tNoise, stq).a * (0.35 + 0.9 * texture(tNoise, sq / 2048.0).g);
  float streak = mix(smoothstep(0.66, 0.92, st), 0.07, smoothstep(0.6, 3.0, stLod));
  wc = max(wc, streak * uStreak.z * smoothstep(0.2, 0.6, ft) * 0.8);
  float shore = 0.0;
  if (depth < 9.0) {
    float nb = n2.b;
    float band = sin(depth * 1.9 + uTime * 0.85 + nb * 7.0 + n1.g * 9.0);
    float breakers = pow(clamp(band, 0.0, 1.0), 5.0) * smoothstep(8.0, 2.5, depth) * smoothstep(0.15, 0.9, depth);
    float edge = 1.0 - smoothstep(0.0, 0.5 + 0.7 * nb, depth);
    float s = max(edge, breakers * (0.45 + 0.55 * uSea.z));
    shore = s * mix(0.55, smoothstep(0.15, 0.6, ft), detailW);
  }
  float foam = clamp(max(wc, shore), 0.0, 1.0);
  vec3 foamRad = 0.8 * (vSunE * max(dot(N, L), 0.0) / PI + atmAmbient(P, N) + vMoonE * max(uMoonDir.y, 0.0) / PI);

  vec3 col = F * sky + (1.0 - F) * (Lw + sss) + spec;
  col = mix(col, foamRad, foam);
  if (uDebug == 1) col = vec3(cov, wc, shore);
  else if (uDebug == 2) col = vec3(depth / 50.0, fract(depth), 0.0);
  else if (uDebug == 3) col = vec3(var * 10.0, 0.0);
  else if (uDebug == 4) col = N * 0.5 + 0.5;
  else if (uDebug == 5) col = vec3(s0.w, s1.w, s2.w) * 0.5;
  outColor = vec4(max(col, vec3(0.0)), 1.0);
}`;
}
