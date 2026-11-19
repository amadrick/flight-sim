// Night vision grade (scotopic / mesopic shift) that leaves light sources alone.
//
// Rods see no colour and are most sensitive to blue-green light (Purkinje shift), so a dim, moonlit landscape looks
// blue-grey and red things go dark. Light sources (lamps, lit windows, displays, flames) and surfaces lit brightly by
// them are seen with the cones and keep their colour. The grade therefore runs in the COMPOSITE, scene-referred:
//   * LAYERS.POST emitters (airport lights, aircraft lights, plumes, lightning) are drawn after the composite, so they
//     never pass through it;
//   * MAIN-layer emitters are protected by the "reflected share" the main pass writes into the alpha channel of the
//     scene target: a = 1 - lum(emitted) / lum(total) (1 = lit surface, 0 = pure emitter). Every opaque three.js
//     Standard / Physical / Lambert / Phong / Toon material writes it automatically from totalEmissiveRadiance
//     (patched opaque_fragment chunk, see installEmissiveMaskChunk); raw ShaderMaterials write it themselves
//     (src/render/INTEGRATION.md, "Emissive contributors").
// The weight also falls with the pixel's displayed luminance (mesopic range), so lamp pools stay in colour.
import * as THREE from 'three';

const MASK_TAG = 'SKYWARD_EMISSIVE_MASK';

/** Patch three's opaque_fragment chunk so lit opaque materials write their reflected share into alpha. Idempotent. */
export function installEmissiveMaskChunk() {
  const key = 'opaque_fragment';
  const src = THREE.ShaderChunk[key];
  if (!src || !src.includes('#ifdef OPAQUE') || !src.includes('diffuseColor.a = 1.0;')) return false;
  if (src.includes(MASK_TAG)) return true;
  THREE.ShaderChunk[key] = src.replace('diffuseColor.a = 1.0;', /* glsl */`diffuseColor.a = 1.0;
	// ${MASK_TAG}: alpha = share of the radiance that is reflected light (0 = pure emitter), read by the night grade
	#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG ) || defined( TOON )
	diffuseColor.a = clamp( 1.0 - dot( max( totalEmissiveRadiance, 0.0 ), vec3( 0.2126, 0.7152, 0.0722 ) ) / max( dot( max( outgoingLight, 0.0 ), vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-9 ), 0.0, 1.0 );
	#endif`);
  return true;
}

// GLSL for the composite. uNightK: x = strength (0 off), y = 1 / radiance of white paint under the night light
// (moon + sky), z = exposure, w = debug view (1 = show the mask: orange = emitter, grey = lit surface).
export const NIGHT_GRADE_GLSL = /* glsl */`
uniform vec4 uNightK;
// rod (scotopic) luminance of linear sRGB, normalised so grey keeps its photopic luminance
float ng_scotopic(vec3 c) { return dot(c, vec3(0.045, 0.555, 0.400)); }
// refl: the reflected (non-emitted) part of the pixel, total: the whole pixel (decides how dark-adapted it is seen)
vec3 ng_grade(vec3 refl, vec3 total) {
  float y = dot(total, vec3(0.2126, 0.7152, 0.0722));
  // mesopic: anything the moon and the night sky can light (up to a little above white paint) is seen by the rods;
  // surfaces lit far brighter (lamp pools, the landing-light patch) are seen by the cones and keep their colour
  float w = uNightK.x * (1.0 - smoothstep(2.0, 12.0, y * uNightK.y));
  // blue-grey moonlight look (luminance of the tint = 1) on the rod luminance
  vec3 rod = ng_scotopic(refl) * vec3(0.80, 1.00, 1.36);
  return mix(refl, rod, 0.8 * w);
}
`;
