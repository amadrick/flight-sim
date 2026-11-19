// GLSL for the volumetric clouds: density model, lighting, ray march, temporal reconstruction, shadow map.
// Identifiers are prefixed cl*/uCl*/tCl* (and cloudShadow* for the chunk exported to the pipeline) so they cannot
// collide with the atmosphere module's GLSL, which is pasted into the same shaders.
//
// References (techniques, not code):
//  [Schneider15/17] A. Schneider, "The real-time volumetric cloudscapes of Horizon Zero Dawn" (SIGGRAPH 2015) and
//                   "Nubis: authoring real-time volumetric cloudscapes with the Decima engine" (SIGGRAPH 2017)
//  [Hillaire16]     S. Hillaire, "Physically based sky, atmosphere and cloud rendering in Frostbite" (SIGGRAPH 2016)
//  [Wrenninge13]    M. Wrenninge et al., "Oz: the great and volumetric" (multiple-scattering octaves)
//  [Bouthors08]     A. Bouthors et al., "Interactive multiple anisotropic scattering in clouds"

// ---------------------------------------------------------------------------------------------------------------
// Cloud shadow map lookup — exported to the pipeline as ctx.clouds.shadowGLSL (needs FRAME_UNIFORMS_GLSL).
// The map is a top-down, camera-centred "Beer shadow map": for the sun ray through each texel of a reference plane
// at the cloud base it stores the total optical depth and the first two moments of where along the ray (in altitude)
// that optical depth sits, so points INSIDE the layer get a plausible partial shadow too.
export const CLOUD_SHADOW_GLSL = /* glsl */`
uniform sampler2D tCloudShadowMap;
uniform vec4 uCloudShadowA;   // xy = map centre (air-mass metres), z = 1 / map size, w = reference altitude (cloud base, m)
uniform vec4 uCloudShadowB;   // xy = light slope (L.xz / L.y), z = 1 / layer thickness, w = optical depth assumed beyond the map
uniform vec4 uCloudShadowC;   // xy = world - air-mass offset (accumulated wind, m), z = strength (0 = no clouds), w = unused
// Optical depth of cloud between a point (world XZ in metres, altitude y) and the sun.
float cloudShadowTau(vec2 worldXZ, float y) {
  vec2 q = worldXZ - uCloudShadowC.xy + uCloudShadowB.xy * (uCloudShadowA.w - y);
  vec2 uv = (q - uCloudShadowA.xy) * uCloudShadowA.z + 0.5;
  vec2 e = abs(uv - 0.5) * 2.0;
  float edge = smoothstep(0.8, 0.98, max(e.x, e.y));
  vec3 s = textureLod(tCloudShadowMap, uv, 0.0).rgb;
  float hN = (y - uCloudShadowA.w) * uCloudShadowB.z;
  float k = 1.73 * s.b + 0.015;                                   // uniform distribution with the stored variance
  float f = clamp((s.g + k - hN) / (2.0 * k), 0.0, 1.0);          // fraction of the optical depth that lies above y
  float far = uCloudShadowB.w * (1.0 - smoothstep(0.0, 0.25, hN));
  return mix(s.r * f, far, edge) * uCloudShadowC.z;
}
// Direct-sun transmittance through the cloud layer to a render-space point (1 = unshadowed).
float cloudShadow(vec3 renderPos) {
  vec2 d = renderPos.xz - uCameraPos.xz;
  float y = renderPos.y + dot(d, d) * 7.848e-8;                   // undo the fake earth-curvature drop d^2 / 2R
  return exp(-cloudShadowTau(renderPos.xz + uOrigin.xz, y));
}
// Diffuse (multiply scattered) light transmitted by the cloud layer, for scaling sky/ambient light under clouds:
// two-stream estimate T = 1 / (1 + 0.75 (1 - g) tau). Always >= cloudShadow().
float cloudDiffuseTransmittance(vec3 renderPos) {
  vec2 d = renderPos.xz - uCameraPos.xz;
  float y = renderPos.y + dot(d, d) * 7.848e-8;
  return 1.0 / (1.0 + 0.11 * cloudShadowTau(renderPos.xz + uOrigin.xz, y));
}
`;

// ---------------------------------------------------------------------------------------------------------------
// Density model (shared by the ray march, the light march and the shadow-map bake).
export const CLOUD_DENSITY_GLSL = /* glsl */`
uniform highp sampler3D tClBase;      // 128^3: R Perlin-Worley shape, G mid Worley fbm, B high Worley fbm, A Perlin
uniform highp sampler3D tClDetail;    // 32^3:  R Worley erosion fbm, G finer, B finest, A Perlin
uniform sampler2D tClWeather;         // camera-centred weather map (see weather-field.js)
uniform sampler2D tClCurl;
uniform vec4 uClWx;        // xy = map centre (air-mass m), z = 1 / map size (1/m), w = 1 / texel size
uniform vec4 uClLayer;     // x = base altitude, y = top altitude, z = 1 / thickness, w = thickness (m)
uniform vec4 uClShape;     // x = coverage bias, y = coverage amplitude, z = min top fraction, w = stratus (0..1)
uniform vec4 uClShape2;    // x = dev lo, y = dev hi, z = anvil amount, w = base ramp (m)
uniform vec4 uClShape3;    // x = height taper (undeveloped cells), y = height taper (developed cells)
uniform vec4 uClNoise;     // x = base noise scale (1/m), y = detail scale (1/m), z = erosion strength, w = extinction at density 1 (1/m)
uniform vec4 uClNoiseOfs;  // xyz = base-noise scroll (noise units), w = detail scroll
uniform vec4 uClDebug;
uniform vec4 uClRain;      // x = rain extinction (1/m), y = cell threshold lo, z = cell threshold hi, w = reach toward the ground (0..1)

float clSat(float x) { return clamp(x, 0.0, 1.0); }

vec4 clWeather(vec2 airXZ, float lod) {
  return textureLod(tClWeather, (airXZ - uClWx.xy) * uClWx.z + 0.5, lod);
}

// Cloud "shape excess" at air-mass position pa (xz metres, y = altitude): > 0 inside the cloud, in units of the base
// noise (≈ 1 per kilometre across a cloud edge), before detail erosion. Density = saturate(excess / edgeWidth).
// info: x = height fraction within this cloud (0 base .. 1 its own top), y = local cloud-top altitude (m),
//       z = base-noise mid Worley (reused for erosion), w = density scale for this altitude.
// [Schneider15]: density = remap(shape * heightGradient, 1 - coverage, 1, 0, 1); the weather map supplies coverage and
// cloud type, here as a continuous "vertical development" instead of three discrete types.
float clShape(vec3 pa, vec4 wx, float lod, out vec4 info) {
  float hN = (pa.y - uClLayer.x) * uClLayer.z;
  info = vec4(0.0, uClLayer.y, 0.5, 1.0);
  if (hN <= 0.0 || hN >= 1.0) return -1.0;
  float cov = clSat(uClShape.x + (wx.r - 0.5) * uClShape.y);
  if (cov < 0.01) return -1.0;
  float dev = smoothstep(uClShape2.x, uClShape2.y, wx.g);
  float topN = mix(uClShape.z, 1.0, dev);          // nominal depth of this cell as a fraction of the layer
  float hRel = hN / topN;
  // anvil: around fully developed cells the cloud spreads out under the tropopause, far wider than the tower,
  // thick and solid near the core, thinning into ragged patches outward; the lid undulates and bulges over the
  // core (overshooting top)
  float am = uClShape2.z * smoothstep(uClShape2.x - 0.17, uClShape2.x + 0.03, wx.g);
  float lid = 0.89 + 0.06 * (wx.a - 0.5) + 0.05 * smoothstep(0.8, 1.0, dev);
  float aThick = 0.035 + 0.15 * am * am;
  float anvil = step(0.001, am) * smoothstep(lid - aThick - 0.025, lid - aThick + 0.025, hN);
  vec3 q = pa * uClNoise.x * vec3(1.0, uClDebug.w, 1.0) + uClNoiseOfs.xyz;
  // smoothstep the texel fraction: hardware trilinear filtering is only C0 and its creases at voxel boundaries
  // show up as terraces / contour lines on smooth cloud surfaces (worst along the stretched vertical axis)
  float vs = 128.0 * exp2(-floor(lod));
  vec3 qt = q * vs - 0.5, qi = floor(qt), qf = qt - qi;
  q = (qi + qf * qf * (3.0 - 2.0 * qf) + 0.5) / vs;
  vec4 n = textureLod(tClBase, q, lod);
  // billows: the volume's own mid / high Worley fbm bulges the low-frequency shape (they fade to their mean with
  // the mip LOD, so distant clouds keep their size while losing detail)
  float s = n.r * (1.0 + (n.g - 0.48) * uClDebug.x + (n.b - 0.48) * uClDebug.y);
  lid += 0.05 * (n.a - 0.5);
  // Vertical profile. Flat base: the shape fades in over a few tens of metres above the condensation level.
  // Top: a height penalty is SUBTRACTED from the shape, so every cell's height follows the strength of its
  // noise peak (big cells are tall, small ones stay humilis) and the outline is a dome: r(h) ~ peak - k h^2.
  // Nothing is cut at a height-field: tops and flanks are always noise surfaces (cauliflower, not mountains).
  float bottom = clSat(hN * uClLayer.w / uClShape2.w);
  float prof = mix(hRel * hRel, smoothstep(0.65, 1.0, hRel) + 4.0 * max(hRel - 1.0, 0.0), uClShape.w);   // dome / flat deck
  prof *= mix(uClShape3.x, uClShape3.y, dev);
  info = vec4(clSat(hRel), uClLayer.x + min(topN * 1.15, 1.0) * uClLayer.w, n.g, 1.0);
  // water content grows with height above the base (adiabatic), glaciated anvils are thinner
  info.w = mix(0.45, 1.0, clSat(hRel * 2.5 + 0.1)) * mix(1.0, mix(0.05, 0.45, am * am), anvil) * mix(0.75, 1.15, wx.a);
  // stratus decks keep a minimum threshold so the long base ramp turns the noise into an undulating, ragged base
  float ex = s * bottom - max(1.0 - cov, 0.22 * uClShape.w) - prof;
  // inside the anvil slab the threshold only depends on the distance from the core; the ice cloud thins out
  // toward the rim through its density (info.w), not through a soft threshold (which would reveal texel facets)
  ex = mix(ex, s - (1.0 - 0.95 * am), anvil);
  return ex - 3.0 * clSat((hN - lid) * 14.0);                    // lid at the tropopause / inversion
}
// Cheap density (no detail), used by the light march and the shadow map.
float clDensityBase(vec3 pa, vec4 wx, float lod, out vec4 info) {
  return clSat(clShape(pa, wx, lod, info) / 0.06);
}

// Full density: displace the cloud surface with high-frequency Worley fbm, distorted by curl noise near the base
// ([Schneider15] sec. "detail"): wispy at the bottom, billowy on top. edge = width of the density ramp in
// shape units (tied to the march step: crisp close to the camera, softer far away).
#define CL_EROSION_BIAS 0.3
float clDensityFull(vec3 pa, float excess, vec4 info, float lodD, float nearK, float edge) {
  vec3 q = pa * uClNoise.y;
  vec2 curl = textureLod(tClCurl, pa.xz * 1.9e-4, 0.0).xy * 2.0 - 1.0;
  q.xz += curl * (1.0 - info.x) * 0.07;
  q.y -= uClNoiseOfs.w; q.x += uClNoiseOfs.w * 0.4;
  vec4 dn = textureLod(tClDetail, q, lodD);
  float hf = dn.r;
  if (nearK > 0.0) {                         // extra octave close to the camera (flying through cloud)
    float fine = textureLod(tClDetail, q * 3.7 + 0.37, 0.0).g;
    hf = mix(hf, hf * 0.7 + fine * 0.3, nearK);
  }
  float m = mix(hf, 1.0 - hf, clSat(info.x * 5.0));
  m = (mix(m, 1.0 - info.z, 0.25) - CL_EROSION_BIAS) * uClNoise.z;
  return clSat((excess - m) / edge);
}

// Rain / virga below the cloud base (air-mass position pa with pa.y < base). Returns relative density 0..1.
float clRain(vec3 pa, vec4 wx) {
  float cell = smoothstep(uClRain.y, uClRain.z, wx.b);
  if (cell <= 0.0) return 0.0;
  float below = uClLayer.x - pa.y;
  // streaky curtains: noise stretched ~12x vertically
  float streak = textureLod(tClBase, vec3(pa.x, pa.y * 0.08, pa.z) * 2.6e-4 + uClNoiseOfs.xyz, 1.0).a;
  float curtain = smoothstep(0.3, 0.62, streak + cell * 0.3);
  // virga evaporates before reaching the ground; heavy rain reaches it
  float reach = uClLayer.x * mix(0.35, 1.3, uClRain.w * cell);
  float fall = clSat(1.0 - below / max(reach, 1.0));
  return cell * curtain * sqrt(fall) * clSat(below / 60.0 + 0.3);
}
`;

// ---------------------------------------------------------------------------------------------------------------
// Default sun-scattering model. The signature is a contract (a neural model can replace this function, see
// setScatterModel in index.js):
//   J = radiance scattered toward the viewer per unit sun irradiance at the cloud top (sr^-1), single + multiple.
//   tauSun   optical depth from the sample toward the sun through cloud (>= 0)
//   tauUp    optical depth from the sample straight up to the cloud top (>= 0)
//   cosTheta cos(angle between the light's travel direction and the direction toward the viewer); 1 = forward scattering
export const DEFAULT_SCATTER_GLSL = /* glsl */`
float clHG(float c, float g) { float g2 = g * g; return (1.0 - g2) * 0.0795775 / pow(1.0 + g2 - 2.0 * g * c, 1.5); }
float cloudSunScatter(float tauSun, float tauUp, float cosTheta) {
  // (1) Single scattering: dual-lobe Henyey-Greenstein — a tight forward lobe (silver lining) plus a weak
  //     backward lobe (glory side brightening) [Hillaire16].
  float single = mix(clHG(cosTheta, 0.82), clHG(cosTheta, -0.30), 0.2) * exp(-tauSun);
  // (2) Low-order multiple scattering as octaves of attenuated extinction / contribution / anisotropy
  //     [Wrenninge13, Hillaire16]: light that has scattered a few times penetrates deeper and forgets direction.
  float ms = 0.0, a = 1.0, b = 1.0, c = 1.0;
  for (int i = 0; i < 3; i++) {
    a *= 0.42; b *= 0.55; c *= 0.55;
    ms += b * mix(clHG(cosTheta, 0.82 * c), clHG(cosTheta, -0.30 * c), 0.2) * exp(-a * tauSun);
  }
  // (3) Diffusion regime: deep inside an optically thick, conservative cloud the mean radiance follows the
  //     two-stream solution ~ (0.8 / pi) / (1 + 0.75 (1 - g) tau) — this is what keeps bases grey, not black.
  //     Weighted by a "powder" term [Schneider15]: thin wisps and the outermost skin have had no path length to
  //     build up multiply-scattered light, which gives the dark creases / bright bulges of cumulus.
  float depth = tauSun + 0.35 * tauUp;
  float powder = 1.0 - 0.55 * exp(-0.8 * depth);
  float fwd = mix(1.0, 12.566 * clHG(cosTheta, 0.35), 0.55 * exp(-0.12 * tauSun));
  float diffuse = 0.2546 * (0.5 / (1.0 + 0.1125 * tauSun) + 0.5 * exp(-0.3 * tauSun)) * powder * fwd;
  return single + 0.5 * ms * powder + diffuse;
}
`;

// ---------------------------------------------------------------------------------------------------------------
// The ray march. Renders at 1/N resolution into two attachments:
//   0: rgb = in-scattered radiance (premultiplied, including aerial perspective), a = transmittance
//   1: r = mean cloud distance (km, for reprojection), g = scene distance used (km), b = lightning glow, a = unused
export function marchFragment({ frameGLSL, depthGLSL, atmosphereGLSL, scatterGLSL, steps, lightSteps, N }) {
  return /* glsl */`
precision highp float; precision highp int; precision highp sampler3D;
#define CL_STEPS ${steps | 0}
#define CL_LIGHT_STEPS ${lightSteps | 0}
#define CL_N ${N | 0}
in vec2 vUv;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oAux;
${frameGLSL}
${depthGLSL}
${atmosphereGLSL}
${CLOUD_SHADOW_GLSL}
${CLOUD_DENSITY_GLSL}
${scatterGLSL}

uniform sampler2D tClBlue;
uniform sampler2D tClCirrus;
uniform vec4 uClJitter;      // xy = sub-pixel offset of this frame's sample inside the NxN block (full-res px), z = temporal blue-noise shift, w = on/off of volumetrics
uniform vec4 uClFullRes;     // xy = full resolution (px), z = radians per low-res pixel, w = unused
uniform vec4 uClStep;        // x = relative fine step, y = min fine step (m), z = min coarse step (m), w = max distance (m)
uniform vec3 uClOriginAir;   // xz: render-space -> air-mass offset (origin - wind offset), computed in doubles on the CPU
uniform vec3 uClLightDir;    // unit vector TOWARD the dominant light (sun, or moon at night)
uniform vec4 uClLightSel;    // x = sun weight, y = ground-bounce scale, z = ambient scale, w = time (s)
uniform vec3 uClMoonE;       // moon irradiance (zero while the sun is the light)
uniform vec4 uClFlash[2];    // lightning: xyz = render-space position, w = intensity
uniform vec4 uClCirrus;      // x = altitude (m), y = amount (0..1), zw = render-space -> cirrus air-mass offset

const float CL_R = 6371000.0;

// Altitude above the (camera-tangent) spherical planet at distance t along a ray with vertical direction dy,
// starting at altitude c. Written to be stable in float32 (no R + h subtraction).
float clAlt(float t, float dy, float c) {
  float r0 = CL_R + c, num = 2.0 * r0 * dy * t + t * t;
  return c + num / (sqrt(max(r0 * r0 + num, 0.0)) + r0);
}
// Ray / sphere-of-altitude-H intersection distances (near, far); near > far when the ray misses.
vec2 clShell(float dy, float c, float H) {
  float r0 = CL_R + c, b = r0 * dy, cc = (c - H) * (2.0 * CL_R + c + H);
  float disc = b * b - cc;
  if (disc < 0.0) return vec2(1e12, -1e12);
  float q = -(b + (b >= 0.0 ? 1.0 : -1.0) * sqrt(disc));          // stable quadratic roots
  float t0 = q, t1 = abs(q) > 1e-6 ? cc / q : 0.0;
  return vec2(min(t0, t1), max(t0, t1));
}

vec3 clLightE(vec3 renderPos) { return atmSunIlluminance(renderPos) * uClLightSel.x + uClMoonE; }

// Optical depth toward the light: a few exponentially spaced samples of the cheap density (cone/light march of
// [Schneider15], shortened), then the baked shadow map for everything farther away (other clouds, upper layers).
float clTauLight(vec3 pa, float lod, float jit) {
  float tau = 0.0, d0 = 0.0;
  vec4 info;
  for (int j = 0; j < CL_LIGHT_STEPS; j++) {
    float u = (float(j) + 1.0) / float(CL_LIGHT_STEPS);
    float d1 = 1000.0 * u * u;                                     // segment ends: 62, 250, 562, 1000 m (4 steps)
    float dl = d1 - d0;
    vec3 pl = pa + uClLightDir * (d0 + dl * (0.25 + 0.5 * jit));    // half-cell jitter: hides the sample planes at half the variance
    vec4 wx = clWeather(pl.xz, max(lod - 1.0, 0.0));
    float d = clDensityBase(pl, wx, lod + 1.0 + float(j) * 0.5, info);
    tau += d * info.w * dl;
    d0 = d1;
  }
  tau *= uClNoise.w * 0.8;                                         // 0.8: base density is not eroded
  vec3 pe = pa + uClLightDir * 1000.0;
  // undo the air-mass offset: cloudShadowTau wants world XZ (it subtracts the wind offset itself)
  // At low sun the 2.5D shadow map projects its horizontal structure onto cloud faces compressed by tan(elevation),
  // which reads as horizontal striations. Jitter the lookup along the light slope (up to 1.2 km, i.e. a penumbra /
  // multiple-scattering blur); the temporal filter integrates it.
  float sl = length(uCloudShadowB.xy);
  vec2 jo = uCloudShadowB.xy * ((jit - 0.5) * min(150.0, 1200.0 / max(sl, 1e-3)));
  tau += cloudShadowTau(pe.xz + uCloudShadowC.xy + jo, pe.y);
  return tau;
}

// High thin cirrus / cirrostratus sheet at one altitude: a 2D fibrous texture on a spherical shell.
vec4 clCirrusLayer(vec3 rd, float c, float sceneD, out float tHit) {
  tHit = 0.0;
  float H = uClCirrus.x;
  vec2 hit = clShell(rd.y, c, H);
  float t = c < H ? hit.y : hit.x;
  if (uClCirrus.y <= 0.002 || hit.x > hit.y || t <= 0.0 || t > sceneD || t > 3.2e5) return vec4(0.0, 0.0, 0.0, 1.0);
  vec3 pr = uCameraPos + rd * t;
  vec2 x = pr.xz + uClCirrus.zw;
  float mu = clamp(abs((CL_R + c) * rd.y + t) / (CL_R + H), 0.06, 1.0);        // |cos| of the ray to the local vertical
  float lod = log2(max(t * uClFullRes.z / mu / 84.0, 1.0));
  float fib = textureLod(tClCirrus, x / 43000.0, lod).r;
  vec4 big = textureLod(tClCirrus, vec2(0.83 * x.x - 0.56 * x.y, 0.56 * x.x + 0.83 * x.y) / 167000.0, max(lod - 2.0, 0.0));
  float patches = smoothstep(1.0 - uClCirrus.y * 1.25, 1.25 - uClCirrus.y * 1.1, big.g * 0.75 + big.b * 0.45);
  float d = patches * (0.25 + 0.75 * fib) * smoothstep(0.1, 0.55, fib + patches * 0.35);
  float tauV = d * (0.12 + 0.5 * uClCirrus.y);                                   // vertical optical depth
  float tau = min(tauV / mu, 3.0) * (1.0 - smoothstep(2.0e5, 3.2e5, t));
  if (tau <= 1e-4) return vec4(0.0, 0.0, 0.0, 1.0);
  float T = exp(-tau), op = 1.0 - T;
  vec3 E = clLightE(pr);
  float cosT = dot(rd, uClLightDir);
  float mu0 = clamp(uClLightDir.y + 0.08, 0.08, 1.0);
  // ice crystals: strong forward lobe + broad floor; self-shadowing of the slanted sun path through the sheet
  float ph = mix(clHG(cosT, 0.72), 0.0796, 0.4) + 0.045 * mu0;
  vec3 L = E * ph * op * exp(-0.5 * tauV / mu0);
  L += 0.5 * (atmAmbient(pr, vec3(0.0, 1.0, 0.0)) + atmAmbient(pr, vec3(0.0, -1.0, 0.0))) * uClLightSel.z * op;
  vec4 ap = atmAerialPerspective(pr);
  tHit = t;
  return vec4(L * ap.a + ap.rgb * op, T);
}

void main() {
  ivec2 lp = ivec2(gl_FragCoord.xy);
  vec2 uv = min((vec2(lp * CL_N) + uClJitter.xy + 0.5) / uClFullRes.xy, vec2(1.0) - 0.5 / uClFullRes.xy);
  vec3 rd = viewRay(uv);
  float sceneD = sceneDistance(uv);
  float c = uCameraPos.y;
  float blue = fract(texelFetch(tClBlue, lp & 63, 0).r + uClJitter.z);
  float blue2 = fract(texelFetch(tClBlue, (lp + ivec2(23, 41)) & 63, 0).r + uClJitter.z * 1.7548);

  vec3 L = vec3(0.0);
  float T = 1.0, wSum = 0.0, tSum = 0.0, flash = 0.0;
  float tFallback = 40000.0;
  float nIter = 0.0, nDense = 0.0;            // cost counters (debug read-back through aux.a)

  if (uClJitter.w > 0.5) {
    // ---- marching interval through the spherical cloud shell (first crossing only) --------------------------
    bool rain = uClRain.x > 0.0;
    float Hb = rain ? 0.0 : uClLayer.x, Ht = uClLayer.y;
    vec2 sTop = clShell(rd.y, c, Ht), sBot = clShell(rd.y, c, Hb);
    float t0 = 0.0, t1 = -1.0;
    if (c > Ht) { if (sTop.x < sTop.y && sTop.x > 0.0) { t0 = sTop.x; t1 = (sBot.x < sBot.y && sBot.x > 0.0) ? sBot.x : sTop.y; } }
    else if (c >= Hb) { t0 = 0.0; t1 = (sBot.x < sBot.y && sBot.x > 0.0) ? sBot.x : sTop.y; }
    else { t0 = sBot.y; t1 = sTop.y; }
    vec2 sGround = clShell(rd.y, c, -20.0);
    if (sGround.x < sGround.y && sGround.x > 0.0) t1 = min(t1, sGround.x);
    t1 = min(t1, min(sceneD, uClStep.w));
    tFallback = clamp(t0, 2000.0, 60000.0);

    if (t1 > t0) {
      // per-ray lighting inputs (atmosphere functions stay outside the loop: they may use implicit-LOD lookups)
      float tB = min(t1, t0 + 60000.0);
      vec3 Ea = clLightE(uCameraPos + rd * t0), Eb = clLightE(uCameraPos + rd * tB);
      vec3 pm = uCameraPos + rd * min(t0 + 3000.0, t1);
      vec3 ambUp = atmAmbient(pm, vec3(0.0, 1.0, 0.0)) * uClLightSel.z;
      vec3 ambDn = atmAmbient(pm, vec3(0.0, -1.0, 0.0)) * uClLightSel.z * uClLightSel.y;
      float cosT = dot(rd, uClLightDir);
      float voxel = 1.0 / (uClNoise.x * 128.0), voxelD = 1.0 / (uClNoise.y * 32.0);

      // Step sizes. Inside cloud: fine steps ~ Kf * distance. Searching for cloud: coarse steps (~3 Kf * distance),
      // widened as the step budget is consumed so long grazing rays still reach the far field. Where the weather
      // map says the whole column is empty at this altitude (clear patch, or above the local tops): big free steps.
      float Kf = uClStep.x;
      float t = t0;
      bool fine = false; int zeros = 0;
      float cap = 1e9;                         // step cap while resolving an optically thick cloud surface

      for (int i = 0; i < CL_STEPS; i++) {
        if (t >= t1 || T < 0.004) break;
        nIter += 1.0;
        float left = float(CL_STEPS - i);
        float need = log(min(t1, max(40000.0, 8.0 * t)) / max(t, 1500.0)) / (0.8 * left);
        float Kc = max(3.0 * Kf, need);
        float dsC = max(uClStep.z, Kc * t);
        // far field (coarse step larger than a cloud): point-testing would miss clouds, so every step integrates
        // (unbiased optical depth) with steps blending from fine to coarse.
        float farK = smoothstep(700.0, 1800.0, dsC);
        float dsF = max(uClStep.y, mix(Kf, Kc, farK) * t);
        bool farField = dsF > 0.6 * dsC;
        float ds = min(min((fine || farField) ? dsF : dsC, t1 - t), cap);
        float ts = t + ds * blue;
        float h = clAlt(ts, rd.y, c);
        vec3 pr = uCameraPos + rd * ts;
        vec3 pa = vec3(pr.x + uClOriginAir.x, h, pr.z + uClOriginAir.z);
        float fadeFar = 1.0 - smoothstep(0.75 * uClStep.w, uClStep.w, ts);
        vec4 wx = clWeather(pa.xz, clamp(log2(ds * uClWx.w), 0.0, 5.0));
        if (!fine && h >= uClLayer.x) {
          // conservative column test on the (mip-filtered, smooth) weather fields
          float covC = uClShape.x + (wx.r - 0.5) * uClShape.y + 0.06;
          float devC = smoothstep(uClShape2.x, uClShape2.y, wx.g + 0.07);
          // highest altitude the strongest possible noise peak (s ~ 1.25) can reach in this column
          float reach = sqrt(max(0.25 + covC, 0.0) / mix(uClShape3.x, uClShape3.y, devC));
          float topC = uClLayer.x + min(mix(uClShape.z, 1.0, devC) * reach, 1.0) * uClLayer.w + 100.0;
          if (uClShape2.z * smoothstep(uClShape2.x - 0.17, uClShape2.x + 0.03, wx.g + 0.07) > 0.0) topC = uClLayer.y;   // anvil overhead
          if (covC <= 0.0 || h > topC) {
            float big = max(ds, 0.14 * t);
            float dhdt = rd.y + ts / CL_R;                           // d(altitude)/dt along the ray
            if (covC > 0.0 && dhdt < 0.0) big = min(big, max((h - topC) / -dhdt, ds));   // do not dive through the tops
            t += min(big, t1 - t) ; continue;
          }
        }

        if (h < uClLayer.x) {
          // ---- below the base: rain shafts / virga (smooth, so coarse steps integrate directly) ----
          fine = false;
          float rd_ = rain ? clRain(pa, wx) * fadeFar : 0.0;
          if (rd_ > 0.0) {
            float sig = rd_ * uClRain.x;
            float tauS = cloudShadowTau(pa.xz + uCloudShadowC.xy, h);
            vec3 E = mix(Ea, Eb, clSat((ts - t0) / max(tB - t0, 1.0)));
            float diffT = 1.0 / (1.0 + 0.11 * tauS);
            vec3 S = E * (mix(0.0796, clHG(cosT, 0.6), 0.5) * exp(-tauS) + 0.05 * diffT) + 0.5 * (ambUp * diffT + ambDn);
            float Ts = exp(-sig * ds), w = T * (1.0 - Ts);
            for (int k = 0; k < 2; k++) { vec3 dv = pr - uClFlash[k].xyz; flash += w * uClFlash[k].w / (1.0 + dot(dv, dv) * 1.2e-6); }
            // rain is featureless: it must not drag the reprojection depth towards the camera (the cloud structure
            // seen through it would smear with wind drift / parallax), so it barely counts in the mean distance
            L += w * S * 0.92; tSum += 0.03 * w * ts; wSum += 0.03 * w; T *= Ts;
          }
          t += ds; continue;
        }

        float lod = clamp(log2(ds / (voxel * 2.0)), 0.0, 2.5);
        vec4 info;
        float ex = clShape(pa, wx, lod, info) + CL_EROSION_BIAS * uClNoise.z;   // conservative: erosion can also add
        if (!fine && !farField) {
          if (ex > 0.0) { fine = true; zeros = 0; continue; }     // hit: re-march this interval with fine steps
          t += ds; continue;
        }
        float d = 0.0;
        if (ex > 0.0) {
          float lodD = clamp(log2(ds / voxelD), 0.0, 4.0);
          float edge = clamp(ds * 0.0007, 0.012, 0.06);
          d = clDensityFull(pa, ex - CL_EROSION_BIAS * uClNoise.z, info, lodD, clSat(1.0 - ts / 2500.0), edge) * info.w * fadeFar;
        }
        if (d > 0.0) {
          float sig = d * uClNoise.w;
          // Refine on hit: a step that is optically thick (tau > 1.6) cannot shade the cloud surface properly (the
          // lit skin is ~1 mean free path deep). Back up to just before the sample and re-march with ~1 mfp steps;
          // the cap then relaxes geometrically, so a surface costs 4-5 lit samples whatever the distance.
          if (cap > 1e8 && sig * ds > 1.6 && ds > 1.5 * uClStep.y) {
            cap = max(1.0 / sig, uClStep.y); t = max(t, ts - 0.5 * cap); fine = true; zeros = 0; continue;
          }
          zeros = 0; nDense += 1.0;
          float tauSun = clTauLight(pa, lod, fract(blue2 + nDense * 0.618));
          // optical depth to the cloud top: mostly a smooth height-based estimate (using only the local density
          // would print the density field onto the ambient term: an "x-ray" look in diffuse light)
          float tauUp = uClNoise.w * (0.3 + 0.2 * d) * max(info.y - h, 0.0);
          float J = cloudSunScatter(tauSun, tauUp, cosT);
          vec3 E = mix(Ea, Eb, clSat((ts - t0) / max(tB - t0, 1.0)));
          // ambient: sky light diffusing down from the cloud top, ground bounce coming up through the base
          float tauDn = uClNoise.w * (0.3 + 0.2 * d) * max(h - uClLayer.x, 0.0);
          float visUp = 0.35 * exp(-0.6 * tauUp) + 0.65 / (1.0 + 0.2 * tauUp);
          float visDn = 0.35 * exp(-0.6 * tauDn) + 0.65 / (1.0 + 0.2 * tauDn);
          vec3 S = E * J + 0.5 * (ambUp * visUp + ambDn * visDn);
          // energy-conserving integration over the step [Hillaire16]
          float Ts = exp(-sig * ds), w = T * (1.0 - Ts);
          L += w * S;
          // lightning glow from inside the cloud (kept separate: it must not be temporally accumulated)
          for (int k = 0; k < 2; k++) {
            vec3 dv = pr - uClFlash[k].xyz; float d2 = dot(dv, dv);
            flash += w * uClFlash[k].w / (1.0 + d2 * 1.2e-6) * exp(-sqrt(d2) * 2.2e-4);
          }
          tSum += w * ts; wSum += w; T *= Ts;
          cap *= 1.6;
        } else if (++zeros > 5) { fine = false; cap = 1e9; }
        t += ds;
      }
    }
  }

  // Remap the early-out threshold to full opacity, then aerial perspective at the opacity-weighted mean distance
  // (one evaluation per pixel, [Schneider15]/[Hillaire16]).
  T = clSat((T - 0.004) / 0.996);
  float tMean = wSum > 0.0 ? tSum / wSum : tFallback;
  vec4 ap = atmAerialPerspective(uCameraPos + rd * tMean);
  L = L * ap.a + ap.rgb * (1.0 - T);
  flash *= ap.a;

  // cirrus sheet: behind the low clouds when seen from below, in front when the camera is above it
  float tCi;
  vec4 ci = clCirrusLayer(rd, c, sceneD, tCi);
  if (c < uClCirrus.x) { L += T * ci.rgb; if (wSum <= 0.0 && tCi > 0.0) tMean = tCi; T *= ci.a; }
  else { L = ci.rgb + ci.a * L; T *= ci.a; if (tCi > 0.0 && ci.a < 0.5) tMean = tCi; }

  oColor = vec4(L, T);
  oAux = vec4(min(tMean * 1e-3, 1000.0), min(sceneD * 1e-3, 1000.0), flash, uClDebug.z > 0.5 ? nDense : nIter);
}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Temporal reconstruction at full resolution (temporal upsampling in the spirit of [Schneider15]'s 4x4 reprojection,
// with depth-aware (joint bilateral) spatial weights so scene silhouettes stay crisp):
//   current = bilateral blend of the 4 nearest low-res samples (which sit at this frame's jittered sub-pixel offset)
//   history = previous output, reprojected through the mean cloud distance with uPrevViewProj
//   output  = mix(history, current, alpha), alpha is high where this pixel was actually marched this frame.
export function resolveFragment({ frameGLSL, depthGLSL, N }) {
  return /* glsl */`
precision highp float; precision highp int;
#define CL_N ${N | 0}
in vec2 vUv;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oAux;
${frameGLSL}
${depthGLSL}
uniform sampler2D tClMarch, tClMarchAux, tClHist, tClHistAux;
uniform vec4 uClJitter;      // xy = this frame's sub-pixel offset (full-res px)
uniform vec4 uClTemporal;    // x = history valid, y = alpha (interpolated pixels), z = alpha (freshly marched pixel), w = camera translation this frame (m)
uniform vec4 uClWindVel;     // xyz = cloud drift this frame (m, render space), w = focal length in pixels
void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  ivec2 lowSize = textureSize(tClMarch, 0);
  float dFull = min(sceneDistance(vUv) * 1e-3, 1000.0);
  vec2 g = (vec2(P) - uClJitter.xy) / float(CL_N);
  ivec2 i0 = ivec2(floor(g)); vec2 f = g - vec2(i0);
  vec4 cSum = vec4(0.0); float dSum = 0.0, wSum = 0.0, bestDz = 1e9; vec4 bestC = vec4(0.0, 0.0, 0.0, 1.0); float bestD = 40.0;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    ivec2 ip = clamp(i0 + o, ivec2(0), lowSize - 1);
    vec4 cc = texelFetch(tClMarch, ip, 0); vec4 a = texelFetch(tClMarchAux, ip, 0);
    float bw = (o.x == 0 ? 1.0 - f.x : f.x) * (o.y == 0 ? 1.0 - f.y : f.y);
    float dz = abs(log2(max(a.y, 1e-4) / max(dFull, 1e-4)));
    float w = (bw + 0.002) * exp2(-min(dz * 24.0, 60.0));
    cSum += cc * w; dSum += a.x * w; wSum += w;
    if (dz < bestDz) { bestDz = dz; bestC = cc; bestD = a.x; }
  }
  vec4 cur; float cloudKm;
  if (wSum > 1e-12) { cur = cSum / wSum; cloudKm = dSum / wSum; } else { cur = bestC; cloudKm = bestD; }

  // reproject: where was this piece of cloud on screen last frame?
  vec3 wp = uCameraPos + viewRay(vUv) * (cloudKm * 1000.0) - uClWindVel.xyz;
  vec4 pc = uPrevViewProj * vec4(wp, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  bool ok = uClTemporal.x > 0.5 && pc.w > 0.0 && all(greaterThan(puv, vec2(0.0))) && all(lessThan(puv, vec2(1.0)));
  float alpha = 1.0, count = 1.0;
  if (ok) {
    vec4 h = texture(tClHist, puv); vec4 ha = texture(tClHistAux, puv);
    // disocclusion: the scene surface in front of / behind the cloud changed (aircraft edges, terrain silhouettes)
    // (only depth changes that can cut into the cloud matter: beyond ~3x the cloud distance, e.g. the terrain/sky
    //  boundary at the horizon seen through near cloud, the surface is irrelevant and must not reset the history)
    float capKm = cloudKm * 3.0 + 2.0;
    float dz = abs(log2(max(min(ha.x, capKm), 1e-4) / max(min(dFull, capKm), 1e-4)));
    float reject = smoothstep(0.15, 0.5, dz);
    float exact = max(f.x, 1.0 - f.x) * max(f.y, 1.0 - f.y);   // 1 when this pixel is one of this frame's samples
    exact *= exact; exact *= exact;
    alpha = mix(uClTemporal.y, uClTemporal.z, exact);
    // young history (after a cut / disocclusion) converges as a running mean instead of an exponential one
    alpha = max(alpha, 1.0 / (1.0 + ha.z));
    // parallax the single-depth reprojection cannot represent (flying fast past/through near cloud): trust history less
    float par = uClTemporal.w / max(cloudKm * 1000.0, 1.0) * uClWindVel.w;
    alpha = max(alpha, clamp(par * 0.04 - 0.1, 0.0, 0.35));
    alpha = mix(alpha, 1.0, reject);
    cur = mix(h, cur, alpha);
    count = mix(min(ha.z + 1.0, 48.0), 1.0, reject);
  }
  oColor = max(cur, vec4(0.0));
  oAux = vec4(dFull, cloudKm, count, 1.0);
}`;
}

// Final copy into the stable output texture + un-accumulated lightning glow.
export const OUTPUT_FRAG = /* glsl */`
precision highp float;
in vec2 vUv; out vec4 oColor;
uniform sampler2D tClHist, tClMarchAux; uniform vec3 uClFlashColor;
uniform vec4 uClJitter; uniform vec4 uClFullRes; uniform float uClN;
void main() {
  vec4 c = texture(tClHist, vUv);
  // low-res texel i was marched through full-res pixel i*N + jitter
  vec2 lowUv = ((vUv * uClFullRes.xy - uClJitter.xy - 0.5) / uClN + 0.5) / vec2(textureSize(tClMarchAux, 0));
  float fl = texture(tClMarchAux, lowUv).b;
  oColor = vec4(c.rgb + uClFlashColor * fl, c.a);
}`;

// ---------------------------------------------------------------------------------------------------------------
// Shadow-map bake: march the sun ray through the layer for every texel of the reference plane.
export function shadowBakeFragment({ steps }) {
  return /* glsl */`
precision highp float; precision highp int; precision highp sampler3D;
#define CL_SHADOW_STEPS ${steps | 0}
in vec2 vUv; out vec4 oColor;
${CLOUD_DENSITY_GLSL}
uniform vec4 uClBakeShadowA;   // xy = centre (air-mass m), z = size (m), w = unused
uniform vec4 uClBakeShadowB;   // xy = light slope (L.xz / L.y), z = 1 / L.y, w = unused
void main() {
  vec2 q = uClBakeShadowA.xy + (vUv - 0.5) * uClBakeShadowA.z;
  float tau = 0.0, m1 = 0.0, m2 = 0.0, y0 = 0.0;
  vec4 info;
  for (int i = 0; i < CL_SHADOW_STEPS; i++) {
    // denser sampling near the base, where most cloud mass is
    float u1 = float(i + 1) / float(CL_SHADOW_STEPS); float y1 = u1 * sqrt(u1);
    float hN = 0.5 * (y0 + y1), dy = (y1 - y0) * uClLayer.w;
    float y = uClLayer.x + hN * uClLayer.w;
    vec3 pa = vec3(q.x + uClBakeShadowB.x * (y - uClLayer.x), y, q.y + uClBakeShadowB.y * (y - uClLayer.x));
    vec4 wx = clWeather(pa.xz, 0.0);
    // band-limit the density to the sample spacing along the slanted ray (otherwise low sun angles alias into
    // stripes): pick the noise mip whose voxel matches the spacing
    float spacing = dy * uClBakeShadowB.z;
    float d = clDensityBase(pa, wx, clamp(log2(spacing * uClNoise.x * 128.0), 1.0, 4.0), info) * info.w;
    float dt = d * uClNoise.w * 0.8 * spacing;
    tau += dt; m1 += dt * hN; m2 += dt * hN * hN;
    y0 = y1;
  }
  float mean = tau > 1e-5 ? m1 / tau : 0.0;
  float var = tau > 1e-5 ? max(m2 / tau - mean * mean, 0.0) : 0.0;
  oColor = vec4(min(tau, 200.0), mean, sqrt(var), 1.0);
}`;
}

// Weather-map bake (see weather-field.js for the field itself).
export function weatherBakeFragment(fieldGLSL) {
  return /* glsl */`
precision highp float;
in vec2 vUv; out vec4 oColor;
${fieldGLSL}
uniform vec4 uClBakeWx;   // xy = centre (air-mass m), z = size (m)
void main() { oColor = clWeatherField(uClBakeWx.xy + (vUv - 0.5) * uClBakeWx.z); }`;
}

// Cirrus texture bake (512^2, tiling): R = fibrous streaks (domain-warped, strongly anisotropic fbm),
// G,B = smooth large-scale fields for patchiness.
export const CIRRUS_BAKE_FRAG = /* glsl */`
precision highp float;
in vec2 vUv; out vec4 oColor;
uniform sampler2D tClNoise2D;
void main() {
  vec2 p = vUv;
  vec4 w1 = texture(tClNoise2D, p + vec2(0.11, 0.37)), w2 = texture(tClNoise2D, p * 2.0 + vec2(0.53, 0.19));
  vec2 warp = (vec2(w1.r, w1.g) - 0.5) * 0.22 + (vec2(w2.g, w2.r) - 0.5) * 0.07;
  // fibres run along +x (the jet-stream direction is applied when sampling); 1:7 anisotropy
  float s1 = texture(tClNoise2D, vec2(p.x * 1.0, p.y * 7.0) + warp * vec2(1.0, 3.0)).a;
  float s2 = texture(tClNoise2D, vec2(p.x * 2.0, p.y * 17.0) + warp * vec2(2.0, 7.0) + 0.31).r;
  float s3 = texture(tClNoise2D, vec2(p.x * 5.0, p.y * 41.0) + warp * vec2(4.0, 15.0) + 0.67).a;
  float fib = s1 * 0.5 + s2 * 0.32 + s3 * 0.18;
  fib = clamp((fib - 0.3) / 0.5, 0.0, 1.0);
  // uncinus hooks / denser heads
  float heads = smoothstep(0.55, 0.9, texture(tClNoise2D, p * 3.0 + warp + 0.5).b);
  oColor = vec4(clamp(fib * (0.7 + 0.5 * heads), 0.0, 1.0), w1.a, w2.b, 1.0);
}`;
