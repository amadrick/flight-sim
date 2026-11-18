// Physically-based atmosphere — GLSL.
//
// Model: spherical planet, Rayleigh + Mie (haze, driven by ctx.weather.visibility) + ozone, following
//   S. Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique" (EGSR 2020), with
//   E. Bruneton's transmittance-LUT parameterisation ("Precomputed Atmospheric Scattering", 2008/2017).
//
//   tAtmTransmittance  256x64   T(altitude, cos zenith) to the top of the atmosphere          (on weather change)
//   multi-scattering   32x32    Psi(cos sun zenith, altitude), isotropic 2nd+ order            (on weather change)
//   tAtmSkyView        256x128  sky radiance around the camera, zenith → horizon (a = mean transmittance to space)  (per frame)
//   tAtmAerial         256x128  8x4 atlas of 32x32 tiles = 32 distance slices of a camera-centred SPHERICAL froxel
//                               volume: rgb = inscatter(d) / sky reference(dir), a = transmittance(d)            (per frame)
//
// The aerial-perspective volume stores a *ratio* against the sky-view LUT rather than radiance. The phase function
// is constant along a view ray, so the ratio is smooth in direction even where the sky has a sharp Mie peak around
// the sun; aerial perspective therefore inherits the sky-view LUT's angular resolution and converges exactly to the
// sky colour at the horizon (no seam between far terrain and sky). Being world-aligned and spherical (not
// frustum-aligned) it is valid for ANY render-space position: reflections, clouds, off-screen points, IBL capture.
//
// Everything in the public API below is a handful of LUT fetches: no loops.
// Requires FRAME_UNIFORMS_GLSL (core/glsl.js) to be declared first.
// Bind uniforms with: uniforms: { ...ctx.uniforms.frame, ...ctx.pipeline.atmosphere.uniforms }

export const ATM = {
  RG: 6371.0,          // planet radius, km
  HT: 100.0,           // atmosphere thickness, km
  TRANS_W: 256, TRANS_H: 64,
  MS_N: 32,
  SKY_W: 256, SKY_H: 128,
  AP_N: 32, AP_TX: 8, AP_TY: 4,   // 32 slices of 32x32, atlas 8x4
  AP_DMAX: 400.0,      // km covered by the aerial-perspective volume (slices are quadratic in distance)
  SUN_RADIUS: 0.004654, // rad (0.2666 deg)
};

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export const ATMOSPHERE_GLSL = /* glsl */`
#ifndef SKYWARD_ATMOSPHERE_API
#define SKYWARD_ATMOSPHERE_API
uniform float uAtmHaze;                       // 1 / visibility (1/m) — kept from the stub API
uniform highp sampler2D tAtmTransmittance;
uniform highp sampler2D tAtmSkyView;
uniform highp sampler2D tAtmAerial;
uniform vec4 uAtmView;                        // x: horizon dip below horizontal (rad), yz: cos/sin of the LUT reference azimuth, w: camera altitude (km)
uniform vec3 uAtmSunIllum;                    // sun illuminance outside the atmosphere (lighting units)
uniform vec3 uAtmMoonIllum;                   // moon illuminance outside the atmosphere (already scaled by phase)
uniform vec3 uAtmGround;                      // radiance of the generic ground seen far below (directions under the horizon)
uniform vec2 uAtmEnc;                         // x > 0.5: LUTs are 8-bit sqrt-encoded (no float render targets), y: scale

const float ATM_RG = ${f(ATM.RG)};
const float ATM_HT = ${f(ATM.HT)};
const float ATM_RT = ${f(ATM.RG + ATM.HT)};
const float ATM_PI = 3.14159265359;
const float ATM_AP_DMAX = ${f(ATM.AP_DMAX)};
const vec2 ATM_SKY_SIZE = vec2(${f(ATM.SKY_W)}, ${f(ATM.SKY_H)});
const vec2 ATM_TRANS_SIZE = vec2(${f(ATM.TRANS_W)}, ${f(ATM.TRANS_H)});

vec3 atmDecode(vec3 c) { return uAtmEnc.x > 0.5 ? c * c * uAtmEnc.y : c; }

// ---- transmittance LUT (Bruneton parameterisation, written in altitude form so float32 does not cancel) --------
vec2 atmTransUV(float h, float mu) {
  h = clamp(h, 0.0, ATM_HT);
  float H = sqrt(ATM_HT * (2.0 * ATM_RG + ATM_HT));
  float rho = sqrt(h * (2.0 * ATM_RG + h));
  float r = ATM_RG + h, rmu = r * mu;
  float d = max(0.0, -rmu + sqrt(max(rmu * rmu + (ATM_HT - h) * (ATM_RT + r), 0.0)));
  float dmin = ATM_HT - h, dmax = rho + H;
  vec2 x = clamp(vec2((d - dmin) / (dmax - dmin), rho / H), 0.0, 1.0);
  return (0.5 + x * (ATM_TRANS_SIZE - 1.0)) / ATM_TRANS_SIZE;
}
// Transmittance from altitude h (km) to space along cos-zenith mu (rays above the horizon).
vec3 atmTransmittanceLUT(float h, float mu) { return texture(tAtmTransmittance, atmTransUV(h, mu)).rgb; }
// Same, toward a light: also occluded by the planet, softened over the solar disc.
vec3 atmLightTransmittance(float h, float mu) {
  h = clamp(h, 0.0, ATM_HT);
  float muH = -sqrt(h * (2.0 * ATM_RG + h)) / (ATM_RG + h);       // cos zenith of the geometric horizon
  return atmTransmittanceLUT(h, max(mu, muH)) * smoothstep(-0.006, 0.006, mu - muH);
}

// ---- direction <-> LUT coordinates ------------------------------------------------------------------------------
// Azimuth is measured from the key light with a sqrt distribution (most texels near the sun, where the Mie peak is).
float atmAzToX(vec3 dir) {
  vec2 hd = vec2(dir.x * uAtmView.y + dir.z * uAtmView.z, dir.z * uAtmView.y - dir.x * uAtmView.z);
  float a = (abs(hd.x) + abs(hd.y)) < 1e-7 ? 0.0 : atan(hd.y, hd.x);
  return 0.5 + 0.5 * sign(a) * sqrt(abs(a) / ATM_PI);
}
vec3 atmDirFromAzEl(float x, float el) {
  float s = clamp(x, 0.0, 1.0) * 2.0 - 1.0, a = sign(s) * s * s * ATM_PI;
  vec2 hd = vec2(cos(a), sin(a)) * cos(el);
  return vec3(hd.x * uAtmView.y - hd.y * uAtmView.z, sin(el), hd.x * uAtmView.z + hd.y * uAtmView.y);
}
// Sky-view LUT: every row is above the horizon (row 0 = zenith, last row = the horizon itself), sqrt distribution
// in elevation so most texels sit at the horizon (Hillaire 2020 §5.3). Directions below the horizon clamp to it.
vec2 atmSkyUV(vec3 dir) {
  float beta = uAtmView.x;
  float e = max(asin(clamp(dir.y, -1.0, 1.0)) + beta, 0.0);
  float c = sqrt(min(e / (1.5707963 + beta), 1.0));
  return (0.5 + vec2(atmAzToX(dir), 1.0 - c) * (ATM_SKY_SIZE - 1.0)) / ATM_SKY_SIZE;
}
vec3 atmSkyUVToDir(vec2 uv) {
  float beta = uAtmView.x;
  vec2 x = clamp((uv * ATM_SKY_SIZE - 0.5) / (ATM_SKY_SIZE - 1.0), 0.0, 1.0);
  float c = 1.0 - x.y;
  return atmDirFromAzEl(x.x, c * c * (1.5707963 + beta) - beta);
}
// Aerial-perspective tiles: elevation measured from the horizon with a sqrt distribution on each side (upper half
// of the tile above the horizon, lower half below it).
vec2 atmDirToXY(vec3 dir, vec2 size) {
  float beta = uAtmView.x, halfRows = size.y * 0.5;
  float e = asin(clamp(dir.y, -1.0, 1.0)) + beta;
  float y;
  if (e >= 0.0) y = (0.5 + (1.0 - sqrt(clamp(e / (1.5707963 + beta), 0.0, 1.0))) * (halfRows - 1.0)) / size.y;
  else y = (halfRows + 0.5 + sqrt(clamp(-e / (1.5707963 - beta), 0.0, 1.0)) * (halfRows - 1.0)) / size.y;
  return vec2((0.5 + atmAzToX(dir) * (size.x - 1.0)) / size.x, y);
}
vec3 atmXYToDir(vec2 uv, vec2 size) {
  float beta = uAtmView.x, halfRows = size.y * 0.5;
  float row = uv.y * size.y - 0.5, e;
  if (row < halfRows - 0.5) { float c = 1.0 - clamp(row / (halfRows - 1.0), 0.0, 1.0); e = c * c * (1.5707963 + beta); }
  else { float c = clamp((row - halfRows) / (halfRows - 1.0), 0.0, 1.0); e = -c * c * (1.5707963 - beta); }
  return atmDirFromAzEl((uv.x * size.x - 0.5) / (size.x - 1.0), e - beta);
}

// Reference radiance the aerial-perspective volume is normalised against: the sky along dir, or — for directions
// below the horizon — the sky at the horizon in the same azimuth (smooth in elevation, keeps the Mie peak in azimuth).
vec3 atmSkyRef(vec3 dir) { return atmDecode(texture(tAtmSkyView, atmSkyUV(dir)).rgb); }

// In-scatter (rgb) and transmittance (a) over distKm kilometres from the camera along unit dir. 3 fetches.
vec4 atmAerialAt(vec3 dir, float distKm) {
  vec2 xy = atmDirToXY(dir, vec2(${f(ATM.AP_N)}));
  float s = sqrt(clamp(distKm / ATM_AP_DMAX, 0.0, 1.0)) * ${f(ATM.AP_N)} - 0.5;
  float k0 = clamp(floor(s), 0.0, ${f(ATM.AP_N - 1)}), k1 = min(k0 + 1.0, ${f(ATM.AP_N - 1)});
  const vec2 tiles = vec2(${f(ATM.AP_TX)}, ${f(ATM.AP_TY)});
  vec4 a0 = texture(tAtmAerial, (vec2(mod(k0, tiles.x), floor(k0 / tiles.x)) + xy) / tiles);
  vec4 a1 = texture(tAtmAerial, (vec2(mod(k1, tiles.x), floor(k1 / tiles.x)) + xy) / tiles);
  vec4 a = mix(a0, a1, clamp(s - k0, 0.0, 1.0));
  // before the first slice centre: in-scatter grows linearly from the camera
  if (s < 0.0) a = mix(vec4(0.0, 0.0, 0.0, 1.0), a0, clamp(distKm / (ATM_AP_DMAX * ${f(0.25 / (ATM.AP_N * ATM.AP_N))}), 0.0, 1.0));
  return vec4(a.rgb * (uAtmEnc.x > 0.5 ? 4.0 : 1.0) * atmSkyRef(dir), a.a);
}

// ================================= public API (names/signatures are a contract) =================================
// Direct sun irradiance arriving at a render-space point (same units as uSunColor), atmosphere only (no clouds/terrain shadow).
vec3 atmSunIlluminance(vec3 renderPos) { return uAtmSunIllum * atmLightTransmittance(renderPos.y * 0.001, uSunDir.y); }
// Addition: the same for the moon (direction uMoonDir). Use it to light things at night.
vec3 atmMoonIlluminance(vec3 renderPos) { return uAtmMoonIllum * atmLightTransmittance(renderPos.y * 0.001, uMoonDir.y); }

// Sky radiance seen from the camera along unit direction dir (no sun disc, no stars, no clouds). Below the horizon
// it returns a plausible sunlit ground seen through the atmosphere. 1 fetch (3 below the horizon).
vec3 atmSkyRadiance(vec3 dir) {
  float h = uAtmView.w, r = ATM_RG + h, rmu = r * dir.y;
  float disc = rmu * rmu - h * (2.0 * ATM_RG + h);
  if (dir.y >= 0.0 || disc < 0.0) return atmSkyRef(dir);
  vec4 ap = atmAerialAt(dir, -rmu - sqrt(disc));
  return ap.rgb + uAtmGround * ap.a;
}

// Aerial perspective between the camera and a render-space point: rgb = in-scattered radiance, a = transmittance.
// Usage: color = color * ap.a + ap.rgb;   3 fetches.
vec4 atmAerialPerspective(vec3 renderPos) {
  vec3 v = renderPos - uCameraPos; float d = length(v);
  return atmAerialAt(v / max(d, 1e-4), d * 0.001);
}

// Ambient (sky + ground bounce) irradiance/π at a point for a surface with the given normal: radiance = albedo * atmAmbient(...)
vec3 atmAmbient(vec3 renderPos, vec3 normal) { return mix(uAmbientGround, uAmbientSky, normal.y * 0.5 + 0.5); }
#endif
`;

// ---------------------------------------------------------------------------------------------------------------
// Medium model + ray integration, used only by the LUT generation passes (src/render/atmosphere.js).
export const ATM_MODEL_GLSL = /* glsl */`
uniform highp sampler2D tAtmMultiScat;
uniform vec4 uAtmMie;          // x: scattering, y: extinction (1/km at sea level), z: phase g, w: 1 / scale height (1/km)
uniform vec3 uAtmL0Dir; uniform vec3 uAtmL0Illum;      // sun
uniform vec3 uAtmL1Dir; uniform vec3 uAtmL1Illum;      // moon (illuminance 0 disables it)
uniform vec3 uAtmGroundAlbedo;
uniform vec3 uAtmAirglow;      // emission per km of sea-level air (night readability)
uniform vec4 uAtmDeck;         // horizontally-averaged cloud deck: x: base (km), y: top (km), z: light removed below it (0..1)

const vec3 ATM_BR = vec3(5.802e-3, 13.558e-3, 33.1e-3);     // Rayleigh scattering at sea level, 1/km
const vec3 ATM_BO = vec3(0.650e-3, 1.881e-3, 0.085e-3);     // ozone absorption at the layer peak, 1/km

vec3 atmEncode(vec3 c) { return uAtmEnc.x > 0.5 ? sqrt(clamp(c / uAtmEnc.y, 0.0, 1.0)) : c; }

// x: Rayleigh (H = 8 km), y: Mie haze layer, z: ozone tent (25 ± 15 km)
vec3 atmDensity(float h) {
  h = max(h, 0.0);
  return vec3(exp(-h * 0.125), exp(-h * uAtmMie.w), max(0.0, 1.0 - abs(h - 25.0) / 15.0));
}
vec3 atmExtinction(vec3 dens) { return ATM_BR * dens.x + vec3(uAtmMie.y * dens.y) + ATM_BO * dens.z; }
// Altitude after travelling t km from altitude h along cos-zenith mu (cancellation-free form of |P| - Rg).
float atmAltitudeAt(float h, float mu, float t) {
  float r = ATM_RG + h, r1 = sqrt(max(r * r + t * t + 2.0 * r * t * mu, 0.0));
  return h + t * (t + 2.0 * r * mu) / (r1 + r);
}
float atmDistToTop(float h, float mu) {
  float r = ATM_RG + h, rmu = r * mu;
  return max(0.0, -rmu + sqrt(max(rmu * rmu + (ATM_HT - h) * (ATM_RT + r), 0.0)));
}
// < 0 when the ray misses the ground
float atmDistToGround(float h, float mu) {
  float r = ATM_RG + h, rmu = r * mu, disc = rmu * rmu - h * (2.0 * ATM_RG + h);
  return (mu < 0.0 && disc >= 0.0) ? -rmu - sqrt(disc) : -1.0;
}
float atmPhaseR(float c) { return 0.0596831 * (1.0 + c * c); }
// Cornette-Shanks
float atmPhaseM(float c, float g) {
  float g2 = g * g;
  return 0.1193662 * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
vec2 atmMsUV(float h, float mu) {
  vec2 x = clamp(vec2(mu * 0.5 + 0.5, sqrt(max(h, 0.0) / ATM_HT)), 0.0, 1.0);
  return (0.5 + x * ${f(ATM.MS_N - 1)}) / ${f(ATM.MS_N)};
}
vec3 atmMultiScat(float h, float mu) { vec3 c = texture(tAtmMultiScat, atmMsUV(h, mu)).rgb; return uAtmEnc.x > 0.5 ? c * c : c; }

// Single + multiple scattering from both lights along a ray that starts at altitude h (camera frame, +Y up) and
// runs tMax km along dir, n steps distributed quadratically (dense near the camera). Analytic integration per
// segment (Hillaire 2020 eq. 4-ish: energy conserving for thick media).
void atmIntegrate(float h, vec3 dir, float tMax, int n, out vec3 L, out vec3 T) {
  float r = ATM_RG + h, mu = dir.y;
  float c0 = dot(dir, uAtmL0Dir), c1 = dot(dir, uAtmL1Dir);
  float pR0 = atmPhaseR(c0), pM0 = atmPhaseM(c0, uAtmMie.z);
  float pR1 = atmPhaseR(c1), pM1 = atmPhaseM(c1, uAtmMie.z);
  bool moon = (uAtmL1Illum.r + uAtmL1Illum.g + uAtmL1Illum.b) > 0.0;
  bool sun = (uAtmL0Illum.r + uAtmL0Illum.g + uAtmL0Illum.b) > 0.0;
  L = vec3(0.0); T = vec3(1.0);
  float t0 = 0.0, inv = 1.0 / float(n);
  for (int i = 0; i < n; i++) {
    float x1 = float(i + 1) * inv, t1 = tMax * x1 * x1, dt = t1 - t0, t = t0 + 0.5 * dt;
    float hs = atmAltitudeAt(h, mu, t);
    vec3 P = vec3(0.0, r, 0.0) + dir * t;
    vec3 up = P / length(P);
    vec3 dens = atmDensity(hs);
    vec3 sR = ATM_BR * dens.x; float sM = uAtmMie.x * dens.y;
    vec3 ext = sR + vec3(uAtmMie.y * dens.y) + ATM_BO * dens.z;
    vec3 S = uAtmAirglow * dens.x;
    // Air under a cloud deck is lit by what the deck lets through on average. Baking this into the LUTs (rather than
    // darkening pixels afterwards) keeps terrain, water, clouds and sky consistent at the horizon on a grey day.
    float lit = 1.0 - uAtmDeck.z * (1.0 - smoothstep(uAtmDeck.x - 0.1, uAtmDeck.y, hs));
    if (sun) {
      float m = dot(up, uAtmL0Dir);
      S += uAtmL0Illum * lit * (atmLightTransmittance(hs, m) * (sR * pR0 + sM * pM0) + atmMultiScat(hs, m) * (sR + sM));
    }
    if (moon) {
      float m = dot(up, uAtmL1Dir);
      S += uAtmL1Illum * lit * (atmLightTransmittance(hs, m) * (sR * pR1 + sM * pM1) + atmMultiScat(hs, m) * (sR + sM));
    }
    vec3 Ts = exp(-ext * dt);
    L += T * (S - S * Ts) / max(ext, vec3(1e-9));
    T *= Ts;
    t0 = t1;
  }
}
`;
