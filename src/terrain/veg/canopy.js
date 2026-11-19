// Distant forest canopy shading for the SURFACE shader (surface.glsl.js / material.js are owned by the ground agent;
// this chunk is delivered for the integrator to wire in, see src/terrain/veg/INTEGRATION.md).
//
// The painted forest beyond the 3-D trees is a flat Lambertian green today. Seen from the air a forest is not: it has
// a hotspot with the sun behind the viewer, darkens strongly looking toward the sun (you see the shaded sides of the
// crowns), and its brightness depends on crown cover and species. VEG_CANOPY_GLSL turns the painted forest into the
// stand reflectance the path tracer measured (neural network baked into tVegCanopyLUT for the current sun):
//
//   VegCanopy vegCanopy(vec3 rp, float cover, float conifer)   rp = render-space surface point
//     .albedo   diffuse (sky-light) albedo of the stand        -> use as the forest albedo (keep the painted texture's
//                                                                relative variation: fcol *= albedo / mean(fcol))
//     .directK  multiplier for the DIRECT sun term             -> reflectedLight.directDiffuse *= mix(1, directK, w)
//               (= BRF / albedo: hotspot > 1, toward the sun < 1)
//     .gap      fraction of the floor visible from this view   (optional: blend toward floor colour)
// Requires VEG_NEURAL_GLSL (src/neural/veg.js) and the uniforms tVegCanopyLUT, uVegCanopyAlb, uSunDir, plus
// cameraPosition (built in for MeshStandardMaterial). All of them are merged into the terrain's shared `uniforms`
// object by createTrees(), so the terrain material already receives them.
export const VEG_CANOPY_GLSL = /* glsl */`
struct VegCanopy { vec3 albedo; vec3 directK; float gap; };
VegCanopy vegCanopy(vec3 rp, float cover, float conifer) {
  VegCanopy K;
  vec3 v = normalize(cameraPosition - rp);
  vec2 vh = v.xz, sh = uSunDir.xz;
  float lv = length(vh), ls = length(sh);
  float cosAz = (lv > 1e-4 && ls > 1e-4) ? dot(vh / lv, sh / ls) : 0.0;
  vec4 brf = vegCanopyBRF(max(v.y, 0.03), cosAz, cover, conifer);
  K.albedo = vegCanopyAlbedo(cover, conifer);
  K.directK = brf.rgb / max(K.albedo, vec3(1e-4));
  K.gap = brf.a;
  return K;
}
`;
