// Celestial bodies drawn by the composite pass on sky pixels: sun disc (limb darkening), moon (phase-correct
// sphere shading, maria), procedural stars (stable per direction, scintillating, extinguished by the air mass) and a
// faint Milky Way. Requires FRAME_UNIFORMS_GLSL + ATMOSPHERE_GLSL. All helpers are prefixed `sky_`.
import { ATM } from './atmosphere-glsl.js';

export const SKY_GLSL = /* glsl */`
uniform mat3 uSkyStarRot;     // render-space direction -> celestial frame (sidereal rotation about the pole)
uniform vec4 uSkyParams;      // x: angular size of a pixel (rad), y: star brightness (0 disables stars), z: moon angular radius (rad), w: moon disc radiance
uniform vec3 uSkySunDisc;     // sun disc radiance outside the atmosphere

float sky_hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 sky_hash32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float sky_hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float sky_noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sky_hash13(i), sky_hash13(i + vec3(1, 0, 0)), f.x), mix(sky_hash13(i + vec3(0, 1, 0)), sky_hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(sky_hash13(i + vec3(0, 0, 1)), sky_hash13(i + vec3(1, 0, 1)), f.x), mix(sky_hash13(i + vec3(0, 1, 1)), sky_hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float sky_fbm3(vec3 p) { return 0.5 * sky_noise3(p) + 0.25 * sky_noise3(p * 2.03 + 11.0) + 0.125 * sky_noise3(p * 4.01 + 23.0) + 0.0625 * sky_noise3(p * 8.05 + 5.0); }

// One layer of stars on a cube-face grid: at most one star per cell, kept away from the cell border so no
// neighbour lookups are needed. Returns radiance.
vec3 sky_starLayer(vec3 d, float N, float density, float seed, float airmass) {
  vec3 a = abs(d); vec3 q; float face;
  if (a.x >= a.y && a.x >= a.z) { q = vec3(d.y, d.z, d.x); face = d.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z) { q = vec3(d.z, d.x, d.y); face = d.y > 0.0 ? 2.0 : 3.0; }
  else { q = d; face = d.z > 0.0 ? 4.0 : 5.0; }
  vec2 uv = q.xy / abs(q.z);
  vec2 g = (uv * 0.5 + 0.5) * N, cell = min(floor(g), N - 1.0);
  vec3 rnd = sky_hash32(cell + face * 131.0 + seed);
  if (rnd.z > density) return vec3(0.0);
  vec2 sp = (cell + 0.18 + 0.64 * rnd.xy) / N * 2.0 - 1.0;
  float ang = length(normalize(vec3(uv, 1.0)) - normalize(vec3(sp, 1.0)));
  float m = sky_hash12(cell * 1.7 + face * 17.0 + seed + 3.1);
  float flux = 0.012 + 0.9 * pow(m, 11.0) + 0.07 * pow(m, 3.0);
  float sigma = max(uSkyParams.x * 0.8, 2.2e-4) * (1.0 + 0.9 * m * m * m);
  float core = exp(-0.5 * ang * ang / (sigma * sigma));
  // scintillation: stronger and slower through more air
  float tw = 1.0 + (0.10 + 0.5 * airmass) * sin(uTime * (5.0 + 9.0 * rnd.x) + rnd.y * 40.0) * sin(uTime * (2.3 + 3.0 * rnd.y) + rnd.x * 17.0);
  float temp = sky_hash12(cell * 3.3 + face * 7.0 + seed);
  vec3 tint = temp < 0.5 ? mix(vec3(1.0, 0.62, 0.38), vec3(1.0, 0.93, 0.85), temp * 2.0) : mix(vec3(1.0, 0.96, 0.92), vec3(0.68, 0.80, 1.0), temp * 2.0 - 1.0);
  return tint * (flux * core * max(tw, 0.2));
}
vec3 sky_stars(vec3 dir) {
  vec3 d = uSkyStarRot * dir;
  float airmass = pow(1.0 - clamp(dir.y, 0.0, 1.0), 5.0);
  vec3 c = sky_starLayer(d, 52.0, 0.24, 0.0, airmass) + sky_starLayer(d.zxy, 120.0, 0.30, 57.0, airmass) * 0.35;
  // Milky Way: a soft noisy band along a great circle
  float b = dot(d, vec3(0.2873, 0.1916, 0.9385));
  float band = exp(-b * b * 16.0);
  float n = sky_fbm3(d * 5.0 + 3.0);
  c += vec3(0.80, 0.86, 1.0) * (band * (0.25 + 1.6 * n * n * n) * 9e-4);
  return c * uSkyParams.y;
}

// rgb = radiance of the lunar disc, a = coverage. Lit by the real sun direction, so the phase is always right.
vec4 sky_moon(vec3 dir) {
  float R = uSkyParams.z;
  vec3 md = uMoonDir;
  float ang = length(dir - md);
  if (ang > R + 2.0 * uSkyParams.x) return vec4(0.0);
  vec3 ref = abs(md.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 right = normalize(cross(ref, md)), up = cross(md, right);
  vec2 p = vec2(dot(dir, right), dot(dir, up)) / R;
  float r2 = dot(p, p), z = sqrt(max(1.0 - r2, 0.0));
  vec3 n = p.x * right + p.y * up - z * md;
  float ndl = dot(n, uSunDir);
  // lunar regolith is strongly back-scattering: nearly flat disc at full moon, soft terminator
  float lit = smoothstep(-0.03, 0.12, ndl) * mix(1.0, pow(max(ndl, 0.0), 0.5), 0.55);
  vec3 mp = vec3(p, z);
  float maria = smoothstep(0.42, 0.62, sky_fbm3(mp * 1.9 + 4.3));
  float detail = sky_fbm3(mp * 9.0 + 1.7);
  float albedo = mix(1.0, 0.52, maria) * (0.86 + 0.28 * detail);
  float cover = 1.0 - smoothstep(1.0 - 1.5 * uSkyParams.x / R, 1.0 + 1.5 * uSkyParams.x / R, sqrt(r2));
  return vec4(vec3(1.0, 0.96, 0.88) * (albedo * (lit + 0.012) * uSkyParams.w), cover);
}

vec3 sky_sun(vec3 dir) {
  const float R = ${ATM.SUN_RADIUS};
  float ang = length(dir - uSunDir), px = uSkyParams.x;
  float edge = 1.0 - smoothstep(R - px, R + px, ang);
  if (edge <= 0.0) return vec3(0.0);
  float mu = sqrt(max(1.0 - ang * ang / (R * R), 0.0));
  vec3 limb = 1.0 - vec3(0.44, 0.58, 0.74) * (1.0 - mu);       // linear limb-darkening law, stronger in the blue
  return uSkySunDisc * limb * edge;
}

// Everything behind the clouds for a sky pixel.
vec3 sky_radiance(vec3 dir) {
  vec3 col = atmSkyRadiance(dir);
  float h = uAtmView.w;
  float muH = -sqrt(h * (2.0 * ATM_RG + h)) / (ATM_RG + h);
  if (dir.y < muH - 0.01) return col;                           // below the horizon: ground
  vec3 T = atmLightTransmittance(h, dir.y);
  col += sky_sun(dir) * T;
  vec4 moon = sky_moon(dir);
  col += moon.rgb * T * moon.a;
  if (uSkyParams.y > 0.0) {
    // stars drown in sky glow: visible once the sky itself is darker than them
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float vis = exp(-lum / 0.0045) * (1.0 - moon.a);
    if (vis > 0.002) col += sky_stars(dir) * T * vis;
  }
  return col;
}
`;
