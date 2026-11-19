// Ocean surface shaders (raw ShaderMaterial, linear HDR radiance out, no fog / tone mapping).
//
// Geometry: camera-centred polar grid (constant angular resolution, geometric ring spacing ≈ square cells growing
//   with distance) displaced by the FFT cascades with a texture LOD matched to the local vertex spacing, so the
//   sampled surface is band-limited and does not swim. Earth-curvature drop via CURVATURE_GLSL. Wave amplitude fades
//   to zero as water depth -> 0 (terrainHeight). Near the coast the grid is also draped over the beach up to the top
//   of the swash zone, so the swash film, the wet-sand band and the water's edge are drawn by this shader with a
//   soft, moving boundary instead of a hard plane/terrain intersection line.
// Output is PREMULTIPLIED (blend ONE, ONE_MINUS_SRC_ALPHA, alpha = 1 - transmittance): deep water is opaque; in the
//   shallows the real seabed the terrain drew is seen through the water column (per-channel extinction folded into a
//   scalar transmittance plus an additive colour correction), and over the beach only the wet darkening and sheen.
// Shading (per pixel, world-anchored):
//   - resolved normal from 3 mip-filtered FFT cascades; unresolved slope variance (Bruneton et al. 2010) + capillary
//     tail (Cox-Munk) = anisotropic Beckmann roughness of the sun/moon glitter BRDF and of the mean Fresnel;
//   - stochastic glints: the unresolved facets that reflect the sun are counted per world-space cell of about one
//     pixel footprint (Poisson, mean preserved) so the glitter path breaks into sparkles toward its edges and up close
//     and becomes the smooth Beckmann lobe far away; exposure-aware clamp, no fireflies;
//   - sky reflection + REFLECTED CLOUDS (the clouds module's top-down optical-depth map traced along the reflected
//     ray to the cloud base), horizon-safe;
//   - water body: per-region inherent optics (navy open ocean, green turbid temperate coast, clear tropical lagoons),
//     two-way extinction through the column, sand suspended in the surf, crest subsurface scattering, caustics;
//   - surf: breaker height limited by depth AND by the shallowest seabed seaward (reefs and bars shelter lagoons),
//     bores travelling shoreward with the shallow-water celerity, along-shore segmentation, swash run-up and wet sand;
//   - whitecaps from the FFT Jacobian (persistent), wind streaks, cat's-paw gust patches, slicks, rain rings, rotor /
//     wing downwash on the water under a very low aircraft.
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
uniform vec4 uShore;            // x = breaker height (m), y = period (s), z = top of the wet beach (m), w = run-up (m)
uniform vec2 uWaveDir;
uniform vec4 uOriginWrap;
uniform sampler2D tNoise;
out vec3 vPos; out vec2 vXZ; out vec3 vSunE; out float vHeight; out float vFade; out vec3 vMoonE;
out vec4 vShoreA;               // x = bore phase, y = surf-zone weight, z = breaking (dissipation), w = arriving height
out vec4 vShoreB;               // x = along-shore segment, y = shelter, z = local height, w = swash level (m)

// Surf (per vertex: the coast varies over tens of metres, and the bores need real height to read at grazing angles)
void shore(vec2 wAbs, vec2 wq, float th, out vec4 A, out vec4 B, out float eta) {
  A = vec4(0.0); B = vec4(0.0, 0.0, 0.0, -10.0); eta = 0.0;
  // seabed slope and the seaward direction from two extra height taps
  // (central differences over 40 m: the regional slope, not the small relief)
  float e = 20.0;
  vec2 g = vec2(terrainHeight(wAbs + vec2(e, 0.0)) - terrainHeight(wAbs - vec2(e, 0.0)),
                terrainHeight(wAbs + vec2(0.0, e)) - terrainHeight(wAbs - vec2(0.0, e))) / (2.0 * e);
  float m = length(g);
  vec2 sea = m > 1e-5 ? -g / m : -uWaveDir;              // toward deeper water
  // shelter: the shallowest seabed between here and the open sea limits the waves that reach this point
  float th45 = terrainHeight(wAbs + sea * 45.0);
  m = clamp(max(m, (th - th45) / 45.0), 0.006, 0.25);
  float up = max(max(th45, terrainHeight(wAbs + sea * 140.0)), terrainHeight(wAbs + sea * 420.0));
  float Hin = uShore.x * mix(0.55, 1.0, smoothstep(-0.4, 0.6, dot(-sea, uWaveDir)));
  float Harr = min(Hin, 0.78 * max(-up, 0.0) + 0.06);          // what arrives from the open sea
  float dd = max(-th, 0.0);
  float Hloc = min(Harr, 0.78 * dd + 0.03);                    // depth-limited height here
  float Hsea = min(Harr, 0.78 * max(-th45, 0.0) + 0.03);        // ... and 45 m seaward
  // breaking = energy lost between there and here (strong on reef edges and bars, nil on the flat behind them)
  float diss = clamp((Hsea - Hloc) / max(0.2 * Hin, 0.05), 0.0, 1.0);
  // along-shore variation: breaking happens in segments (peaks and gaps), offsets bend the crest lines
  vec4 nm = textureLod(tNoise, wq / 4096.0, 0.0), nm2 = textureLod(tNoise, wq / 1024.0 + vec2(0.31, 0.17), 0.0);
  vec4 an = textureLod(tNoise, vec2(dot(wq, vec2(-sea.y, sea.x)) / 512.0, dot(wq, sea) / 4096.0) + nm.ba * 0.15, 0.0);
  float seg = smoothstep(0.25, 0.65, an.r * 0.7 + nm2.g * 0.3);
  // travel time to the shore over a uniform slope with the shallow-water celerity: tau = 2 sqrt(d / g) / m
  float tau = 2.0 * sqrt(dd / 9.81) / m;
  float ph = (tau + uTime) / uShore.y + 0.35 * an.g + 0.6 * an.b;
  float u = fract(ph);
  float zone = smoothstep(1.5 * Harr + 0.2, 0.8 * Harr, dd) * smoothstep(-0.05, 0.25, dd + 0.2);
  float strength = smoothstep(0.05, 0.4, Harr) * (0.55 + 0.45 * seg);
  // swash: run-up on the beach — fast uprush, slow backwash, in phase with the bores arriving at the shoreline
  float us = fract(uTime / uShore.y + 0.35 * an.g + 0.6 * an.b);
  float rise = us < 0.22 ? sin(us / 0.22 * 1.5708) : pow(cos((us - 0.22) / 0.78 * 1.5708), 1.6);
  float R = uShore.w * (Hloc / max(uShore.x, 1e-3)) * (0.7 + 0.3 * seg) + 0.05;
  A = vec4(ph, zone * strength, diss, Harr);
  B = vec4(seg, 1.0 - Harr / max(Hin, 1e-3), Hloc, R * rise - 0.08);
  // surface elevation: steepening swell lines outside the break point, a bore (steep shoreward face) inside it
  float shoal = smoothstep(2.6 * Harr + 0.6, 1.3 * Harr, dd) * (1.0 - zone);
  float boreH = smoothstep(0.0, 0.05, u) * exp(-u * 4.5) * zone * strength * clamp(diss * 1.6, 0.0, 1.0);
  float cr = 0.5 + 0.5 * cos(6.2832 * ph);
  eta = 0.5 * Harr * strength * shoal * (cr * cr * 1.6 - 0.55) + 0.6 * Hloc * boreH;
}

vec3 dispAt(sampler2D t, vec4 c, vec2 xz, float spacing) {
  vec2 uv = (xz + c.xy) * c.z + 0.5 / c.w;
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
  float th = terrainHeight(xz + uOrigin.xz);
  float fade = smoothstep(0.0, uShoreFade, -th);
  vec3 d = vec3(0.0);
  if (fade > 0.0 && spacing < 400.0) {
    d = dispAt(tDisp0, uCasc[0], xz, spacing) + dispAt(tDisp1, uCasc[1], xz, spacing) + dispAt(tDisp2, uCasc[2], xz, spacing);
    d *= fade * uDispScale;
  }
  vec4 sA = vec4(0.0), sB = vec4(0.0, 0.0, 0.0, -10.0);
  float eta = 0.0;
  if (th > -14.0 && th < uShore.z + 0.5 && spacing < 30.0) shore(xz + uOrigin.xz, xz + uOriginWrap.xy, th, sA, sB, eta);
  vShoreA = sA; vShoreB = sB;
  d.y += eta * uDispScale;
  vec3 p = vec3(xz.x + d.x, d.y, xz.y + d.z);
  float dc = length(p.xz - uCameraPos.xz);
  // drape the grid over the beach up to the top of the wet zone (the fragment shader decides what is water, wet sand
  // or nothing); the lift grows with distance because the far terrain mesh is coarser than its height pyramid
  if (th > -1.5 && th < uShore.z && spacing < 60.0) p.y = max(p.y, th + 0.04 + 0.0008 * dc * smoothstep(-0.3, 0.3, th));
  p.y = min(p.y, uCameraPos.y - 0.3);
  p.y -= curvatureDrop(dc);
  vPos = p; vXZ = xz; vHeight = d.y; vFade = fade;
  vSunE = atmSunIlluminance(vec3(p.x, max(p.y, 0.0), p.z));
  vMoonE = uMoonK > 0.0 ? uMoonK * 25.0 * 3.14159 * atmSkyRadiance(vec3(0.0, 1.0, 0.0)) * vec3(0.85, 0.92, 1.0) : vec3(0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
}

// Shared lighting helpers (also used by the inland-water material).
export const WATER_BRDF_GLSL = /* glsl */`
const float PI = 3.14159265358979;
float smithLambda(float cosT, float s2) {
  float v = cosT / sqrt(max(2.0 * s2 * (1.0 - cosT * cosT), 1e-7));
  return v < 1.6 ? (1.0 - 1.259 * v + 0.396 * v * v) / (3.535 * v + 2.181 * v * v) : 0.0;
}
float dirVar(vec3 d, vec3 tx, vec3 ty, vec2 s2) {
  vec2 a = vec2(dot(d, tx), dot(d, ty)); float c2 = a.x * a.x / max(dot(a, a), 1e-8);
  return s2.x * c2 + s2.y * (1.0 - c2);
}
// Anisotropic Beckmann glitter (Bruneton 2010). lobe = exp(...) term alone (1 at the lobe peak): the normalised
// density of facets that reflect the light into the eye, used to count stochastic glints.
float glitter(vec3 L, vec3 V, vec3 N, vec3 tx, vec3 ty, vec2 s2, out float lobe) {
  vec3 H = normalize(L + V);
  float zH = max(dot(H, N), 1e-3), zL = dot(L, N), zV = dot(V, N);
  float zx = dot(H, tx) / zH, zy = dot(H, ty) / zH;
  lobe = exp(-0.5 * (zx * zx / s2.x + zy * zy / s2.y));
  float p = lobe / (2.0 * PI * sqrt(s2.x * s2.y));
  float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, H), 0.0, 1.0), 5.0);
  float lam = smithLambda(max(zL, 0.01), dirVar(L, tx, ty, s2)) + smithLambda(max(zV, 0.01), dirVar(V, tx, ty, s2));
  float zH2 = zH * zH;
  return fres * p / ((1.0 + lam) * max(zV, 0.01) * zH2 * zH2 * 4.0) * smoothstep(-0.05, 0.05, zL);
}
float meanFresnel(float cosV, float sigV) {
  return 0.02 + 0.98 * pow(1.0 - clamp(cosV, 0.0, 1.0), 5.0 * exp(-2.69 * sigV)) / (1.0 + 22.7 * pow(sigV, 1.5));
}
vec3 whash3(vec3 p) {
  uvec3 q = uvec3(ivec3(p) + 65536);
  q = q * uvec3(1597334673u, 3812015801u, 2798796415u);
  q = (q.x ^ q.y ^ q.z) * uvec3(1597334673u, 3812015801u, 2798796415u);
  return vec3(q >> 8u) * (1.0 / 16777216.0);
}
// One octave of glints: cells of size 'cell' (m); lam = expected number of glinting facets per cell. A cell holds a
// glint with probability q = 1 - exp(-lam); the glint is a small round spot whose brightness keeps the mean at 1.
float glintCells(vec2 p, float cell, float lam, float epoch) {
  vec2 q = p / cell, c = floor(q), f = q - c;
  vec3 h = whash3(vec3(c, epoch));
  float pr = 1.0 - exp(-lam);
  float g = 0.0;
  if (h.x < pr) {
    float dd = length(f - (0.15 + 0.7 * h.yz));
    g = (1.0 - smoothstep(0.08, 0.26, dd)) * min(1.0 / (pr * 0.12), 30.0);   // 0.12 ≈ ∫ spot over the cell
  }
  // many facets per cell are spread evenly: the count's relative fluctuation falls as 1 / sqrt(lam)
  return 1.0 + (g - 1.0) / sqrt(max(lam, 1.0));
}
// Glint factor (mean 1) for a world point, pixel footprint fp (m), normalised lobe density, facets per m² at the peak.
// Two octaves of cells on lattices rotated against the world axes and each other, cross-faded by footprint and in time.
float glints(vec2 p, float fp, float lobe, float density, float t) {
  float lvl = log2(max(fp * 1.2, 0.03));
  float l0 = floor(lvl), fr = lvl - l0;
  float c0 = exp2(l0), c1 = c0 * 2.0;
  float e = t * 6.0, e0 = floor(e), ef = smoothstep(0.25, 0.75, e - e0);
  float lam0 = density * c0 * c0 * lobe, lam1 = lam0 * 4.0;
  float ka = mod(l0, 2.0) < 0.5 ? 0.0 : 1.0;
  mat2 ra = mat2(0.8, 0.6, -0.6, 0.8), rb = mat2(0.28, -0.96, 0.96, 0.28);
  vec2 pa = (ka < 0.5 ? ra : rb) * p, pb = (ka < 0.5 ? rb : ra) * p;
  float g0 = mix(glintCells(pa, c0, lam0, e0 + l0 * 37.0), glintCells(pa + 17.3, c0, lam0, e0 + 1.0 + l0 * 37.0), ef);
  float g1 = mix(glintCells(pb, c1, lam1, e0 + l0 * 37.0 + 91.0), glintCells(pb + 17.3, c1, lam1, e0 + 92.0 + l0 * 37.0), ef);
  return mix(g0, g1, fr);
}
`;

export function waterFragmentShader(terrainGLSL, atmGLSL, opts = {}) {
  const clouds = opts.cloudsGLSL || '';
  return /* glsl */`
precision highp float; precision highp int;
${clouds ? '#define WATER_CLOUDS 1' : ''}
${FRAME_UNIFORMS_GLSL}
${terrainGLSL}
${atmGLSL}
${clouds}
uniform sampler2D tSlope0, tSlope1, tSlope2, tFoamTex, tNoise;
uniform vec4 uCasc[3];
uniform vec2 uVar[30];
uniform vec2 uVarTail;
uniform vec2 uWindDir;
uniform vec4 uOriginWrap;       // xy = origin mod 4096, zw = origin mod 32768
uniform vec3 uFoamW;
uniform vec4 uSea;              // x = wind m/s, y = Hs (m), z = surf strength, w = anisotropy
uniform vec2 uSlickOff;
uniform vec3 uStreak;
uniform vec3 uFoam;
uniform vec4 uShore;            // x = breaker height (m), y = period (s), z = top of the wet beach (m), w = run-up (m)
uniform vec2 uWaveDir;          // dominant (swell) propagation direction
uniform vec2 uCatOff;           // cat's-paw field advection offset (m, wrapped)
uniform vec4 uWeather;          // x = rain 0..1, y = glint density (facets / m² at the lobe peak), z = exposure, w = calm
uniform vec4 uWash;             // xy = aircraft render xz, z = strength, w = height above water (m)
uniform vec4 uWashV;            // xy = unit ground track, z = trail length (m), w = half width (m)
uniform int uDebug;
in vec3 vPos; in vec2 vXZ; in vec3 vSunE; in float vHeight; in float vFade; in vec3 vMoonE;
in vec4 vShoreA; in vec4 vShoreB;
layout(location = 0) out vec4 outColor;

${WATER_BRDF_GLSL}

float mipLod(vec2 uv, float N) {
  vec2 dx = dFdx(uv) * N, dy = dFdy(uv) * N;
  float a = length(dx), b = length(dy);
  return clamp(log2(max(max(min(a, b), max(a, b) / uSea.w), 1e-6)), 0.0, 9.0);
}
vec2 unresolvedVar(int c, float lod) {
  int i = int(lod); float f = lod - float(i);
  return mix(uVar[c * 10 + i], uVar[c * 10 + min(i + 1, 9)], f);
}

float gCloudA = -1.0;
#ifdef WATER_CLOUDS
// Clouds seen in the reflection: trace the reflected ray to the cloud base and read the clouds module's optical-depth
// map there (stored along the sun slope; × sun elevation ≈ vertical). Underside radiance: ambient sky light plus a
// little transmitted sun through thin cloud; faded into the horizon haze with distance.
vec3 reflectClouds(vec3 P, vec3 R, vec3 sky, vec3 sunE) {
  if (uCloudShadowC.z <= 0.0 || R.y < 0.003) return sky;
  float base = uCloudShadowA.w;
  float t = max(base - max(P.y, 0.0), 30.0) / R.y;
  vec2 hit = P.xz + uOrigin.xz + R.xz * t;
  float tau = cloudShadowTau(hit, base) * clamp(uSunDir.y, 0.12, 1.0);
  float a = 1.0 - exp(-0.6 * tau);
  a *= exp(-t / 70000.0) * smoothstep(0.003, 0.05, R.y);
  gCloudA = a + 0.001 * tau;
  vec3 up = atmSkyRadiance(vec3(0.0, 1.0, 0.0));
  // near the horizon the reflection sees the clouds' sunlit flanks, overhead their shaded bases
  float sunUp = smoothstep(-0.05, 0.15, uSunDir.y);
  vec3 side = up * 1.1 + sunE * sunUp * (0.10 + 0.12 * max(dot(normalize(vec3(R.x, 0.0, R.z) + 1e-5), -normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-5)), 0.0));
  vec3 bse = up * 0.95 + sunE * sunUp * 0.05 * exp(-0.25 * tau);
  vec3 Lc = mix(side, bse, smoothstep(0.08, 0.45, R.y));
  return mix(sky, Lc, a);
}
#endif

// rain: expanding rings in 0.5 m cells, two staggered layers; returns a slope (gradient) perturbation
vec2 rainRings(vec2 p, float t) {
  vec2 g = vec2(0.0);
  for (int l = 0; l < 2; l++) {
    vec2 q = p * 2.2 + float(l) * vec2(0.37, 0.61);
    vec2 c = floor(q), f = q - c;
    vec3 h = whash3(vec3(c, float(l) * 13.0));
    float ph = fract(t * 1.3 + h.z);
    vec2 dv = f - (0.3 + 0.4 * h.xy);
    float r = length(dv) + 1e-4;
    float w = (r - ph * 0.3) / 0.035;
    float env = (1.0 - ph) * (1.0 - ph) * step(h.x + h.y, 1.6);
    g += dv / r * (w * exp(-w * w)) * env * 0.35;
  }
  return g;
}

void main() {
  vec3 P = vPos;
  vec3 toCam = uCameraPos - P; float dist = length(toCam); vec3 V = toCam / dist;
  vec2 xz = vXZ;
  vec2 wq = xz + uOriginWrap.xy;
  vec2 wAbs = xz + uOrigin.xz;

  // ---- resolved slopes (3 cascades) + unresolved variance ----------------------------------------------------
  vec2 uv0 = (xz + uCasc[0].xy) * uCasc[0].z + 0.5 / uCasc[0].w;
  vec2 uv1 = (xz + uCasc[1].xy) * uCasc[1].z + 0.5 / uCasc[1].w;
  vec2 uv2 = (xz + uCasc[2].xy) * uCasc[2].z + 0.5 / uCasc[2].w;
  vec4 s0 = texture(tSlope0, uv0), s1 = texture(tSlope1, uv1), s2 = texture(tSlope2, uv2);
  float lod0 = mipLod(uv0, uCasc[0].w), lod1 = mipLod(uv1, uCasc[1].w), lod2 = mipLod(uv2, uCasc[2].w);
  vec2 var = uVarTail + unresolvedVar(0, lod0) + unresolvedVar(1, lod1) + unresolvedVar(2, lod2);
  float w0 = 1.0 - 0.7 * smoothstep(3.0, 5.5, lod0);
  float w1 = 1.0 - smoothstep(2.0, 4.5, lod1), w2 = 1.0 - smoothstep(1.5, 3.5, lod2);
  var += (1.0 - w0 * w0) * (uVar[9] - unresolvedVar(0, lod0))
       + (1.0 - w1 * w1) * (uVar[19] - unresolvedVar(1, lod1)) + (1.0 - w2 * w2) * (uVar[29] - unresolvedVar(2, lod2));
  // two non-commensurate amplitude-modulation fields per cascade hide the FFT tile lattice from altitude
  vec4 nm = texture(tNoise, wq / 4096.0);
  vec4 nm2 = texture(tNoise, wq / 1024.0 + vec2(0.31, 0.17));
  vec3 cm = vec3(0.5) + 0.75 * nm.rgb + 0.25 * nm2.gbr;
  vec2 grad = s0.xy * (cm.x * w0) + s1.xy * (cm.y * w1) + s2.xy * (cm.z * w2);
  float Jc = 1.0 + 1.3 * (s0.w - 1.0) + 1.25 * (s1.w - 1.0) + 0.45 * (s2.w - 1.0);
  float crestFoam = clamp((uFoam.x - Jc) * uFoam.y, 0.0, 1.0) * (0.5 + nm.g);
  float resolved = 1.0 - smoothstep(0.5, 2.5, lod1);
  float fresh = mix(uFoam.z, crestFoam, resolved);
  float residue = clamp(dot(vec3(s0.z, s1.z, s2.z), uFoamW), 0.0, 1.0);
  // foam patches spread and drift beyond the folded crest: a blurred (biased mip) copy of the persistent foam
  float spread = clamp((texture(tSlope0, uv0, 2.0).z * uFoamW.x + texture(tSlope1, uv1, 2.0).z * uFoamW.y) * 1.6, 0.0, 1.0);
  residue = max(residue, spread * 0.75);
  float cov = max(fresh, residue);

  // ---- large-scale sea-state variation: gust fronts, cat's paws, slicks --------------------------------------
  vec2 nq = (xz + uOriginWrap.zw) / 32768.0 - uWindDir * (uTime * 0.0001);
  vec4 n1 = texture(tNoise, nq), n2 = texture(tNoise, nq * 4.0 + vec2(0.37, 0.71));
  float gust = clamp(0.6 * n1.r + 0.4 * n2.g, 0.0, 1.0);
  vec2 sw = vec2(dot(xz, uWindDir), dot(xz, vec2(-uWindDir.y, uWindDir.x))) + uSlickOff;
  float slick = smoothstep(0.72, 0.92, texture(tNoise, sw / vec2(16384.0, 4096.0)).a)
              * smoothstep(0.3, 0.6, n1.g) * (1.0 - smoothstep(5.0, 10.0, uSea.x));
  // cat's paws: patches of ruffled water a few hundred metres across racing downwind over a smoother sea
  // (dominant in light air, merged into the general roughness by ~8 m/s)
  // (wind frame, stretched downwind; the small paws average out once a pixel spans tens of metres)
  vec2 cq = vec2(sw.x - uCatOff.x, sw.y) / vec2(2048.0, 512.0);
  float catN = texture(tNoise, cq).b * 0.65 + texture(tNoise, cq * vec2(2.0, 4.0) + vec2(0.43, 0.29)).r * 0.35;
  float lightAir = 1.0 - smoothstep(4.0, 9.0, uSea.x);
  float cat = mix(smoothstep(0.42, 0.68, catN + 0.25 * (gust - 0.5)), 0.5, smoothstep(6.0, 30.0, length(fwidth(xz))));
  float rough = mix(0.75, 1.25, gust) * (1.0 - 0.5 * slick) * mix(1.0, mix(0.6, 1.45, cat), lightAir * 0.8);
  var *= rough;
  grad *= 1.0 - 0.15 * slick;
  float gustF = mix(0.4, 1.6, gust) * (1.0 - slick);
  cov *= gustF; fresh *= gustF; residue *= gustF;

  // ---- depth, shore ---------------------------------------------------------------------------------------------
  float th = terrainHeight(wAbs);
  float depth = max(-th, 0.0);
  float calm = smoothstep(0.0, 6.0, depth);
  grad *= mix(0.4, 1.0, calm);
  var = mix(var * 0.8, var, smoothstep(0.0, 1.5, depth));

  float pxm = length(fwidth(xz));                         // metres per pixel
  float surfF = 0.0, boreF = 0.0, swashLvl = vShoreB.w, susp = 0.0, Hloc = vShoreB.z;
  float sheltered = vShoreB.y;
  if (vShoreA.y > 0.0) {
    float u = fract(vShoreA.x), dph = fwidth(vShoreA.x);
    float diss = vShoreA.z;
    // bores (fronts at u = 0) leave foam that decays behind them; filtered when the bands get sub-pixel
    float front = smoothstep(0.0, 0.025, u) * exp(-u * 4.0) + 0.3 * exp(-(1.0 - u) * 40.0);
    float bore = mix(front, 0.38, smoothstep(0.3, 0.9, dph));
    boreF = bore * vShoreA.y * clamp(diss * 1.6, 0.0, 1.0);
    surfF = vShoreA.y * (0.1 + 0.9 * diss);               // general aerated surf-zone water
    susp = vShoreA.y * smoothstep(0.1, 0.7, Hloc);          // sand stirred up by the breakers
    // the bore / swell-line relief is geometry: take its slope from the displaced surface itself
    vec3 ng = cross(dFdx(P), dFdy(P));
    if (abs(ng.y) > 1e-6) grad += clamp(-ng.xz / ng.y, -1.0, 1.0) * clamp(vShoreA.y * 3.0, 0.0, 1.0) * (1.0 - smoothstep(1.0, 6.0, pxm));
  }

  // ---- normal ---------------------------------------------------------------------------------------------------
  var += vec2(0.006) * uWeather.x;                     // rain roughens the whole surface (matte, duller glitter)
  if (uWeather.x > 0.01 && dist < 120.0) grad += rainRings(wq, uTime) * uWeather.x * (1.0 - smoothstep(40.0, 120.0, dist));
  // downwash / wake: a roughened, foamy streak behind and under a very low aircraft
  float washF = 0.0;
  if (uWash.z > 0.0) {
    vec2 rel = xz - uWash.xy;
    float along = -dot(rel, uWashV.xy);
    float ac = clamp(along, 0.0, uWashV.z);
    float across = length(rel + uWashV.xy * ac);
    float wdt = uWashV.w * (1.0 + along / max(uWashV.z, 1.0) * 1.5);
    washF = uWash.z * exp(-across * across / (wdt * wdt)) * (1.0 - smoothstep(0.0, uWashV.z, along)) * step(-wdt, along);
    var += vec2(0.08) * washF;
    float ring = sin(length(rel) * 1.3 - uTime * 9.0);
    grad += normalize(rel + 1e-3) * ring * 0.06 * washF;
  }
  var = max(var, vec2(2e-4));
  vec2 rel = P.xz - uCameraPos.xz;
  vec3 N = normalize(vec3(-grad.x + rel.x / 6371000.0, 1.0, -grad.y + rel.y / 6371000.0));
  vec3 tx = vec3(uWindDir.x, 0.0, uWindDir.y), ty = vec3(-uWindDir.y, 0.0, uWindDir.x);
  float cosV = max(dot(V, N), 0.0);
  float varV = dirVar(V, tx, ty, var);

  // ---- sky (+ clouds) reflection ------------------------------------------------------------------------------
  vec3 R = reflect(-V, N);
  float er = sqrt(R.y * R.y + 0.35 * varV);
  R = normalize(vec3(R.x, er, R.z));
  vec3 sky = atmSkyRadiance(R);
#ifdef WATER_CLOUDS
  sky = reflectClouds(P, R, sky, vSunE);
#endif
  float F = meanFresnel(cosV, sqrt(varV));

  // ---- water body ----------------------------------------------------------------------------------------------
  float tropic = smoothstep(35.0, 70.0, wAbs.y * 0.001);
  float coastal = 1.0 - smoothstep(10.0, 80.0, depth);
  vec3 rhoOcean = vec3(0.0011, 0.0055, 0.0170);
  vec3 rhoCoast = mix(vec3(0.0060, 0.0145, 0.0115), vec3(0.0030, 0.0150, 0.0185), tropic);
  vec3 rhoDeep = mix(rhoOcean, rhoCoast, coastal);
  vec3 Kd = mix(vec3(0.36, 0.065, 0.032), mix(vec3(0.5, 0.2, 0.24), vec3(0.34, 0.07, 0.055), tropic), coastal);
  // suspended sand in the surf: browner, brighter, murkier
  rhoDeep = mix(rhoDeep, vec3(0.020, 0.021, 0.015), susp * 0.6);
  Kd += vec3(0.5, 0.5, 0.6) * susp;
  vec3 L = uSunDir;
  vec3 Eamb = atmAmbient(P, vec3(0.0, 1.0, 0.0));
  vec3 Edown = vSunE * max(L.y, 0.0) / PI + Eamb + vMoonE * max(uMoonDir.y, 0.0) / PI;
  vec3 rhoAer = vec3(0.012, 0.04, 0.042) * clamp(cov * 2.5, 0.0, 1.0);

  // water column above the bed (the swash film rides above the beach)
  float level = max(vHeight, swashLvl);
  float dW = level - th;
  float covW = smoothstep(0.0, 0.035, dW);
  // down (refracted sun) + up (refracted view) path lengths per metre of depth
  float cosVw = sqrt(1.0 - (1.0 - cosV * cosV) / 1.777), cosLw = sqrt(1.0 - (1.0 - L.y * L.y) / 1.777);
  float pathK = 1.0 / max(cosLw, 0.66) + 1.0 / cosVw;
  vec3 att = exp(-Kd * max(dW, 0.0) * pathK);
  att *= 1.0 - smoothstep(30.0, 60.0, depth);             // far / deep: opaque (the coarse seabed is not trusted)
  float aS = sqrt(att.r * att.g);                          // scalar transmittance shown through blending
  vec3 bedEst = mix(vec3(0.30, 0.29, 0.22), vec3(0.50, 0.47, 0.37), tropic);
  vec3 Lbody = rhoDeep * (1.0 - att) * Edown + bedEst * max(att - aS, 0.0) * Edown + rhoAer * Edown;

  // caustics on the shallow seabed: two drifting cell-border networks, min() = the bright focal lines
  if (depth > 0.1 && depth < 9.0 && pxm < 0.12) {
    vec2 cp = wq / 22.0;
    float c1 = texture(tFoamTex, cp + uWindDir * uTime * 0.05).b, c2 = texture(tFoamTex, cp * 1.37 - vec2(-uWindDir.y, uWindDir.x) * uTime * 0.04 + 0.5).b;
    float caus = pow(min(c1, c2), 2.0) * 2.2;
    Lbody += bedEst * att * vSunE * max(L.y, 0.0) / PI * caus * smoothstep(0.1, 0.8, depth) * (1.0 - smoothstep(4.0, 9.0, depth)) * (1.0 - smoothstep(0.04, 0.12, pxm));
  }

  // light through thin, sunlit crests seen toward a low sun
  vec3 Lh = normalize(vec3(L.x, 0.0, L.z) + 1e-5);
  float lowSun = smoothstep(-0.02, 0.08, L.y) * (1.0 - smoothstep(0.15, 0.5, L.y));
  float back = pow(clamp(dot(-V, Lh), 0.0, 1.0), 4.0) * lowSun * clamp(dot(N, -Lh) * 4.0 + 0.5, 0.0, 1.0);
  float crest = smoothstep(0.35, 1.0, vHeight / max(uSea.y * 0.5, 0.15));
  float steep = smoothstep(0.08, 0.3, length(grad));
  vec3 sss = vec3(0.01, 0.05, 0.042) * vSunE * crest * steep * back * calm;

  // ---- glitter: sun + moon, with stochastic glints ------------------------------------------------------------
  float lobeS, lobeM = 0.0;
  vec3 spec = vSunE * glitter(L, V, N, tx, ty, var, lobeS);
  if (uMoonDir.y > -0.02) { float gm = glitter(uMoonDir, V, N, tx, ty, var, lobeM); spec += vMoonE * gm; }
  float fpG = sqrt(length(dFdx(xz)) * length(dFdy(xz)));
  float gl = glints(wq, max(fpG, 1e-3), max(lobeS, lobeM), uWeather.y, uTime);
  float gk = smoothstep(0.004, 0.02, var.x + var.y);       // glassy water: no unresolved facets to sparkle
  spec *= mix(1.0, gl, gk);
  float sl = dot(spec, vec3(0.2126, 0.7152, 0.0722));
  float smax = 24.0 / max(uWeather.z, 1e-4);               // ≤ 24 after exposure: a glint blooms a little, no fireflies
  spec *= min(1.0, smax / max(sl, 1e-6));

  // ---- foam: whitecaps, streaks, surf --------------------------------------------------------------------------
  vec2 fuv = wq / 16.0;
  float ft = texture(tFoamTex, fuv).r * 0.65 + texture(tFoamTex, wq / 64.0 + 0.31).r * 0.35;
  float pxs = length(fwidth(fuv));
  float detailW = 1.0 - smoothstep(0.03, 0.25, pxs);
  cov = clamp(cov, 0.0, 1.0); fresh = clamp(fresh, 0.0, 1.0);
  float freshMask = smoothstep(0.05, 0.9, fresh) * (0.25 + 0.75 * smoothstep(0.2, 0.65, ft + 0.45 * fresh - 0.1));
  float resMask = residue * smoothstep(0.6 - 0.45 * residue, 0.8 - 0.35 * residue, ft) * 0.75;
  float wc = mix(cov * 0.75, max(freshMask, resMask), detailW);
  vec2 sq = vec2(dot(xz, uWindDir), dot(xz, vec2(-uWindDir.y, uWindDir.x))) + uStreak.xy;
  vec4 warp = texture(tNoise, sq / 256.0);
  sq.y += (warp.r - 0.5) * 18.0 + (warp.b - 0.5) * 5.0;
  vec2 stq = sq * vec2(1.0 / 64.0, 1.0 / 8.0);
  float stLod = length(fwidth(stq)) * 256.0;
  float st = texture(tNoise, stq).a * (0.35 + 0.9 * texture(tNoise, sq / 2048.0).g);
  float streak = mix(smoothstep(0.66, 0.92, st), 0.07, smoothstep(0.6, 3.0, stLod));
  wc = max(wc, streak * uStreak.z * smoothstep(0.2, 0.6, ft) * 0.8);
  // surf: the bore is dense white, the surf zone behind it a marbled lace that thins out
  float ftS = texture(tFoamTex, wq / 9.0 + vec2(0.0, uTime * 0.02)).r;
  float lace = smoothstep(0.42, 0.7, ftS * 0.7 + ft * 0.3);
  float surfFoam = max(boreF * mix(0.8, smoothstep(0.15, 0.55, ftS + boreF * 0.4), detailW),
                       surfF * mix(0.4, lace * 0.55, detailW));
  // swash front: a thin foam line at the leading edge of the run-up
  float edgeFoam = (1.0 - smoothstep(0.0, 0.06 + 0.04 * Hloc, dW)) * covW * smoothstep(0.1, 0.5, Hloc) * (1.0 - sheltered) * mix(0.6, smoothstep(0.3, 0.6, ftS), detailW);
  float foam = clamp(max(max(wc * (1.0 - 0.7 * sheltered), surfFoam), max(edgeFoam, washF * (0.18 + 0.4 * smoothstep(0.3, 0.75, ftS * 0.6 + ft * 0.4)))), 0.0, 1.0);
  vec3 foamRad = 0.82 * (vSunE * max(dot(N, L), 0.0) / PI + atmAmbient(P, N) + vMoonE * max(uMoonDir.y, 0.0) / PI);

  // ---- compose (premultiplied: rgb = emitted/reflected light, a = 1 - transmittance of what lies below) --------
  vec3 colW = F * sky + spec + (1.0 - F) * (Lbody + sss);
  float aW = 1.0 - (1.0 - F) * aS;
  colW = mix(colW, foamRad, foam); aW = mix(aW, 1.0, foam);
  // wet sand above the water's edge: darker (water in the pores) with a faint sky sheen, drying up the beach
  float wet = (th > 0.0 ? 1.0 - smoothstep(uShore.w * 0.9 + 0.15, uShore.z, th) : 1.0) * (1.0 - smoothstep(4000.0, 9000.0, dist));
  float Fw = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  vec3 colD = wet * 0.6 * Fw * atmSkyRadiance(reflect(-V, vec3(0.0, 1.0, 0.0)));
  float aD = wet * 0.38;
  vec3 col = mix(colD, colW, covW);
  float a = mix(aD, aW, covW);

  if (uDebug == 1) { col = vec3(cov, wc, surfFoam); a = 1.0; }
  else if (uDebug == 2) { col = vec3(depth / 50.0, fract(depth), sheltered); a = 1.0; }
  else if (uDebug == 3) { col = vec3(var * 10.0, 0.0); a = 1.0; }
  else if (uDebug == 4) { col = N * 0.5 + 0.5; a = 1.0; }
  else if (uDebug == 5) { col = vec3(s0.w, s1.w, s2.w) * 0.5; a = 1.0; }
  else if (uDebug == 6) { col = vec3(gl * 0.1, lobeS, 0.0); a = 1.0; }
  else if (uDebug == 7) { col = vec3(gCloudA, -gCloudA, 0.0); a = 1.0; }
  outColor = vec4(max(col, vec3(0.0)), clamp(a, 0.0, 1.0));
}`;
}
