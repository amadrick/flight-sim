// STUB atmosphere API (analytic). The render-pipeline agent replaces the implementation with LUT-based
// physically-based scattering but MUST keep these function names/signatures — clouds, water and terrain call them.
// Requires FRAME_UNIFORMS_GLSL (core/glsl.js) to be declared first.
// Bind uniforms with: uniforms: { ...ctx.uniforms.frame, ...ctx.pipeline.atmosphere.uniforms }
export const ATMOSPHERE_GLSL = /* glsl */`
uniform float uAtmHaze; // 1/visibility-ish extinction scale (stub)
// Direct sun irradiance arriving at a render-space point (same units as uSunColor), atmosphere only (no clouds/terrain shadow).
vec3 atmSunIlluminance(vec3 renderPos) { return uSunColor; }
// Sky radiance seen from the camera along unit direction dir (no sun disc, no clouds).
vec3 atmSkyRadiance(vec3 dir) {
  float mu = clamp(dir.y, -1.0, 1.0);
  float day = smoothstep(-0.12, 0.15, uSunDir.y);
  vec3 zenith = vec3(0.10, 0.24, 0.62), horizon = vec3(0.55, 0.68, 0.85);
  vec3 sky = mix(horizon, zenith, pow(max(mu, 0.0), 0.45));
  float sunAmt = max(dot(dir, uSunDir), 0.0);
  sky += vec3(1.0, 0.75, 0.5) * pow(sunAmt, 24.0) * 0.35;
  vec3 ground = vec3(0.32, 0.36, 0.42);
  sky = mix(sky, ground, smoothstep(0.0, -0.08, mu));
  return sky * day * 1.1 + vec3(0.002, 0.003, 0.006);
}
// Aerial perspective between the camera and a render-space point: rgb = in-scattered radiance, a = transmittance.
// Usage: color = color * ap.a + ap.rgb;
vec4 atmAerialPerspective(vec3 renderPos) {
  vec3 d = renderPos - uCameraPos; float dist = length(d);
  float t = exp(-dist * uAtmHaze * exp(-max(0.5 * (renderPos.y + uCameraPos.y), 0.0) / 3500.0));
  return vec4(atmSkyRadiance(normalize(vec3(d.x, max(d.y, 0.0) * 0.2 + 0.02 * dist, d.z))) * (1.0 - t), t);
}
// Ambient (sky + ground bounce) irradiance/π at a point for a surface with the given normal: radiance = albedo * atmAmbient(...)
vec3 atmAmbient(vec3 renderPos, vec3 normal) { return mix(uAmbientGround, uAmbientSky, normal.y * 0.5 + 0.5); }
`;
