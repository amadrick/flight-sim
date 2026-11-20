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
// Requires VEG_NEURAL_GLSL (src/neural/veg.js) and the uniforms tVegCanopyLUT, uVegCanopyAlb, uVegLeafTint, uSunDir, plus
// cameraPosition (built in for MeshStandardMaterial). All of them are merged into the terrain's shared `uniforms`
// object by createTrees(), so the terrain material already receives them.
import { TREE_CELL } from './species.js';
export const VEG_CANOPY_GLSL = /* glsl */`
struct VegCanopy { vec3 albedo; vec3 directK; float gap; };
uniform vec3 uVegLeafTint[2];      // species.js LEAF_TINT (broadleaf, conifer): the 3-D trees' foliage darkening
uniform float uVegRelief;          // 1 = crown relief in the painted canopy (vegRelief=0: off)
// Crown relief of the painted canopy: the crowns of the SAME tree cells the 3-D layers draw (placement.js hashes:
// a forest tree stands in a cell when hash(cell + 40000).x < cover), as domes; sunlit crown sides, darker crown
// edges, shaded gaps between crowns. Returns (albedo factor, direct factor), both normalised to a mean of ~1 over
// the stand so the network's stand reflectance is kept; faded out as the pixel footprint outgrows a crown.
vec2 vcHash(vec2 p) {
  uvec2 q = uvec2(ivec2(p));
  uint h = q.x * 0x8da6b343u + q.y * 0xd8163841u + 0x9e3779b9u;
  h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
  return vec2(float(h & 0xffffu), float(h >> 16)) / 65536.0;
}
vec2 vegCrownRelief(vec2 w, float cover, float conifer) {
  float fp = length(fwidth(w));
  float k = smoothstep(3.2, 1.2, fp) * uVegRelief;
  if (k <= 0.0 || cover <= 0.01) return vec2(1.0);
  vec2 c0 = floor(w / ${TREE_CELL.toFixed(2)});
  float best = -1.0; vec2 bq = vec2(0.0); float bR = 1.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = c0 + vec2(float(i), float(j));
    vec2 hs = vcHash(c + 40000.0);
    if (hs.x >= cover) continue;
    vec2 ctr = (c + 0.12 + 0.76 * vcHash(c + 20000.0)) * ${TREE_CELL.toFixed(2)};
    vec2 h2 = vcHash(c + 70000.0);
    float R = mix(mix(2.6, 4.0, h2.y), mix(1.8, 2.8, h2.y), conifer);
    vec2 q = (w - ctr) / R;
    float r2 = dot(q, q);
    if (r2 >= 1.0) continue;
    float hgt = (0.75 + 0.25 * h2.y) * sqrt(1.0 - r2);         // crown top height (relative): taller trees win
    if (hgt > best) { best = hgt; bq = q; bR = R; }
  }
  vec3 L = uSunDir; float mu = max(L.y, 0.08);
  float F = 1.0 - exp(-0.9 * cover);                           // crown-covered share of the ground
  float a, d;
  if (best < 0.0) { a = 0.45; d = 0.35 * mu; }                 // gap: shaded floor between the crowns
  else {
    float r2 = dot(bq, bq);
    // dome normal; conifers are more pointed (steeper sides)
    vec3 n = normalize(vec3(bq * mix(1.0, 1.8, conifer), sqrt(max(1.0 - r2, 0.0))));
    a = 0.70 + 0.45 * sqrt(1.0 - r2);
    d = max(dot(n.xzy, L), 0.0) / mu;
  }
  float meanA = F * 1.0 + (1.0 - F) * 0.45;
  float meanD = F * (0.667 * mu + 0.2 * (1.0 - mu) * (1.0 - 0.3 * mu)) / mu + (1.0 - F) * 0.35;
  return mix(vec2(1.0), vec2(a / meanA, d / max(meanD, 0.05)), k);
}
VegCanopy vegCanopy(vec3 rp, float cover, float conifer) {
  VegCanopy K;
  vec3 v = normalize(cameraPosition - rp);
  vec2 vh = v.xz, sh = uSunDir.xz;
  float lv = length(vh), ls = length(sh);
  float cosAz = (lv > 1e-4 && ls > 1e-4) ? dot(vh / lv, sh / ls) : 0.0;
  vec4 brf = vegCanopyBRF(max(v.y, 0.03), cosAz, cover, conifer);
  K.albedo = vegCanopyAlbedo(cover, conifer);
  K.directK = brf.rgb / max(K.albedo, vec3(1e-4));
  K.albedo *= mix(uVegLeafTint[0], uVegLeafTint[1], clamp(conifer, 0.0, 1.0));
  vec2 rel = vegCrownRelief(rp.xz + uOrigin.xz, cover, conifer);
  K.albedo *= rel.x; K.directK *= rel.y;
  K.gap = brf.a;
  return K;
}
`;
