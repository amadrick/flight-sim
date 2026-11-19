// Detail material layers for the terrain surface, generated on the GPU at boot (one small render per layer; no
// CPU work, a few milliseconds on a real GPU) into one mip-mapped RGBA8 texture array:
//     rg = height gradient (0.5 = flat),  b = height 0..1,  a = tint / variety 0..1
// Layers: 0 grass, 1 soil, 2 gravel / scree, 3 massive rock, 4 sand ripples (also wind-packed snow), 5 dried mud
// (desiccation polygons), 6 forest canopy (crowns), 7 bedded rock (used side-projected on cliffs: v = up).
// Every layer tiles exactly (periodic lattice noise); the surface shader samples it at four scales with different
// rotations and noise-warped coordinates. No layer holds structure larger than about 1/8 of the tile, so a tile has
// no large-scale pattern to repeat; the next scale up supplies the larger features.
import * as THREE from 'three';
import { FULLSCREEN_VERT, fullscreenTriangle } from '../core/glsl.js';

export const DETAIL_LAYERS = ['grass', 'soil', 'gravel', 'rock', 'sand', 'mud', 'canopy', 'strata'];

const GEN_FRAG = /* glsl */`
precision highp float; precision highp int;
out vec4 outColor;
uniform int uLayer; uniform float uSize;

uint hashU(uvec2 p, uint s) {
  uint h = p.x * 0x8da6b343u + p.y * 0xd8163841u + s * 0xcb1ab31fu + 0x9e3779b9u;
  h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
  return h;
}
vec2 h2(ivec2 p, ivec2 per, uint s) {
  p = p - per * ivec2(floor(vec2(p) / vec2(per)));      // (% is undefined for negative operands)
  uint h = hashU(uvec2(p), s);
  return vec2(float(h & 0xffffu), float(h >> 16)) / 65535.0;
}
// periodic gradient noise, ~[-0.7, 0.7]; x in lattice units, period per
float gnoise(vec2 x, ivec2 per, uint s) {
  ivec2 i = ivec2(floor(x)); vec2 f = x - floor(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(h2(i, per, s) * 2.0 - 1.0, f), b = dot(h2(i + ivec2(1, 0), per, s) * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float c = dot(h2(i + ivec2(0, 1), per, s) * 2.0 - 1.0, f - vec2(0.0, 1.0)), d = dot(h2(i + ivec2(1, 1), per, s) * 2.0 - 1.0, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 uv, int per, int oct, uint s, float gain) {
  float a = 0.5, v = 0.0;
  for (int o = 0; o < oct; o++) { v += a * gnoise(uv * float(per), ivec2(per), s + uint(o)); per *= 2; a *= gain; }
  return v;                                         // ~[-0.5, 0.5]
}
// periodic cellular noise: x = F1, y = F2 (distances), zw = hash of the nearest cell
vec4 worley(vec2 x, ivec2 per, uint s) {
  ivec2 i = ivec2(floor(x)); vec2 f = x - floor(x);
  float f1 = 9.0, f2 = 9.0; vec2 id = vec2(0.0);
  for (int b = -1; b <= 1; b++) for (int a = -1; a <= 1; a++) {
    ivec2 c = i + ivec2(a, b);
    vec2 dl = vec2(float(a), float(b)) + h2(c, per, s) - f;
    float dd = dot(dl, dl);
    if (dd < f1) { f2 = f1; f1 = dd; id = h2(c, per, s + 77u); } else if (dd < f2) f2 = dd;
  }
  return vec4(sqrt(f1), sqrt(f2), id);
}
float dome(float r, float R) { float q = r / R; return sqrt(max(0.0, 1.0 - q * q)); }

// each material returns (height, tint), both about 0..1
vec2 matGrass(vec2 uv) {
  vec4 w1 = worley(uv * 22.0, ivec2(22), 3u), w2 = worley(uv * 53.0, ivec2(53), 5u);
  float tuft = (1.0 - smoothstep(0.0, 0.75, w1.x)) * (0.45 + 0.55 * w1.z);
  float clump = (1.0 - smoothstep(0.0, 0.70, w2.x)) * (0.40 + 0.60 * w2.z);
  float low = fbm(uv, 9, 3, 11u, 0.55);
  // blades: thin ridges of stretched noise in four directions (each exactly periodic)
  float b1 = 1.0 - abs(gnoise(uv * vec2(96.0, 11.0), ivec2(96, 11), 13u)) * 3.2;
  float b2 = 1.0 - abs(gnoise(uv * vec2(11.0, 96.0), ivec2(11, 96), 15u)) * 3.2;
  float b3 = 1.0 - abs(gnoise(vec2((uv.x + uv.y) * 71.0, (uv.x - uv.y) * 9.0), ivec2(71, 9), 16u)) * 3.2;
  float b4 = 1.0 - abs(gnoise(vec2((uv.x - uv.y) * 67.0, (uv.x + uv.y) * 8.0), ivec2(67, 8), 18u)) * 3.2;
  float blade = max(max(b1, b2), max(b3, b4));
  float h = 0.16 + 0.40 * low + 0.22 * tuft + 0.16 * clump + 0.42 * clamp(blade, 0.0, 1.0) * (0.55 + 0.45 * tuft);
  float tint = 0.5 + 0.9 * fbm(uv, 8, 3, 17u, 0.5) + 0.35 * (w1.w - 0.5) + 0.30 * (w2.w - 0.5) + 0.25 * (clamp(blade, 0.0, 1.0) - 0.5);
  return vec2(h, tint);
}
vec2 matSoil(vec2 uv) {
  float low = fbm(uv, 9, 5, 21u, 0.55);
  vec4 w1 = worley(uv * 37.0, ivec2(37), 23u), w2 = worley(uv * 9.0, ivec2(9), 25u);
  float clod = (1.0 - smoothstep(0.0, 0.55, w1.x)) * step(0.5, w1.z) * (0.4 + 0.6 * w1.w);
  float crack = 1.0 - smoothstep(0.0, 0.07, w2.y - w2.x);
  float h = 0.45 + 0.7 * low + 0.30 * clod - 0.18 * crack + 0.10 * fbm(uv, 64, 2, 27u, 0.5);
  float tint = 0.5 + 0.8 * fbm(uv, 8, 3, 29u, 0.5) + 0.35 * clod * (w1.w - 0.3);
  return vec2(h, tint);
}
vec2 matGravel(vec2 uv) {
  vec4 a = worley(uv * 9.0, ivec2(9), 31u), b = worley(uv * 21.0, ivec2(21), 33u), c = worley(uv * 45.0, ivec2(45), 35u);
  float ha = dome(a.x, 0.66) * (0.6 + 0.4 * a.z), hb = dome(b.x, 0.62) * (0.5 + 0.5 * b.z) * 0.62, hc = dome(c.x, 0.60) * (0.5 + 0.5 * c.z) * 0.36;
  float h = max(ha, max(hb, hc));
  float tint = ha >= hb && ha >= hc ? a.w : (hb >= hc ? b.w : c.w);
  return vec2(0.10 + 0.86 * h + 0.06 * fbm(uv, 64, 2, 37u, 0.5), mix(0.5, tint, 0.85));
}
vec2 matRock(vec2 uv) {
  float low = fbm(uv, 8, 5, 41u, 0.55);
  vec4 w1 = worley(uv * 8.0, ivec2(8), 43u), w2 = worley(uv * 15.0, ivec2(15), 45u);
  float joint = 1.0 - smoothstep(0.0, 0.05, w1.y - w1.x), joint2 = 1.0 - smoothstep(0.0, 0.06, w2.y - w2.x);
  float h = 0.52 + 0.55 * low + 0.22 * (w1.z - 0.5) + 0.08 * (w2.z - 0.5) - 0.30 * joint - 0.14 * joint2 + 0.10 * fbm(uv, 48, 2, 47u, 0.5);
  float tint = 0.5 + 0.55 * (w1.z - 0.5) + 0.25 * (w2.w - 0.5) + 0.6 * fbm(uv, 8, 3, 49u, 0.5);
  return vec2(h, tint);
}
vec2 matSand(vec2 uv) {
  float warp = fbm(uv, 7, 3, 51u, 0.5);
  float ph = uv.y * 26.0 + warp * 3.2 + 0.6 * fbm(uv, 9, 2, 53u, 0.5);
  float r = 0.5 + 0.5 * sin(6.2831853 * ph);
  r = pow(r, 0.7) * (0.7 + 0.6 * (0.5 + fbm(uv, 7, 2, 55u, 0.5)));
  float h = 0.22 + 0.46 * r + 0.30 * fbm(uv, 9, 3, 57u, 0.5) + 0.05 * fbm(uv, 96, 2, 59u, 0.5);
  float tint = 0.5 + 0.30 * (r - 0.5) + 0.6 * fbm(uv, 8, 3, 58u, 0.5);
  return vec2(h, tint);
}
vec2 matMud(vec2 uv) {
  vec2 wp = vec2(fbm(uv, 6, 2, 60u, 0.5), fbm(uv, 6, 2, 62u, 0.5)) * 0.9;
  vec4 w1 = worley(uv * 8.0 + wp, ivec2(8), 61u), w2 = worley(uv * 21.0 + wp * 2.0, ivec2(21), 63u);
  float e1 = w1.y - w1.x;
  float crack1 = 1.0 - smoothstep(0.0, 0.085, e1), crack2 = (1.0 - smoothstep(0.0, 0.07, w2.y - w2.x)) * 0.5;
  float curl = smoothstep(0.38, 0.08, e1) * 0.12;
  float h = 0.62 + 0.10 * (w1.z - 0.5) + curl - 0.55 * crack1 - 0.20 * crack2 + 0.08 * fbm(uv, 32, 2, 65u, 0.5);
  float tint = 0.5 + 0.5 * (w1.z - 0.5) + 0.3 * fbm(uv, 8, 3, 67u, 0.5) - 0.3 * crack1;
  return vec2(h, tint);
}
vec2 matCanopy(vec2 uv) {
  vec4 w1 = worley(uv * 14.0, ivec2(14), 71u), w2 = worley(uv * 23.0, ivec2(23), 73u);
  float d1 = dome(w1.x, 0.78) * (0.6 + 0.4 * w1.z), d2 = dome(w2.x, 0.72) * (0.35 + 0.4 * w2.z);
  float leaf = fbm(uv, 40, 3, 75u, 0.6);
  float hh = max(d1, d2);
  float tint = d1 > d2 ? w1.w : w2.w;
  return vec2(0.05 + 0.86 * hh + 0.25 * leaf * hh, 0.5 + 0.7 * (tint - 0.5) + 0.3 * leaf);
}
vec2 matStrata(vec2 uv) {
  float v = uv.y + 0.035 * fbm(uv, 2, 3, 81u, 0.5);
  float b1 = gnoise(vec2(uv.x * 2.0, v * 11.0), ivec2(2, 11), 83u);
  float b2 = gnoise(vec2(uv.x * 3.0, v * 37.0), ivec2(3, 37), 85u);
  float b3 = gnoise(vec2(uv.x * 5.0, v * 97.0), ivec2(5, 97), 87u);
  vec4 w = worley(uv * vec2(13.0, 4.0), ivec2(13, 4), 89u);
  float crack = 1.0 - smoothstep(0.0, 0.06, w.y - w.x);
  float h = 0.5 + 0.38 * clamp(b1 * 3.0, -1.0, 1.0) + 0.30 * b2 + 0.16 * b3 - 0.25 * crack + 0.12 * fbm(uv, 24, 3, 91u, 0.5);
  float tint = 0.5 + 0.9 * b1 + 0.5 * b2 + 0.2 * (w.z - 0.5);
  return vec2(h, tint);
}
vec2 material(vec2 uv) {
  vec2 m = uLayer == 0 ? matGrass(uv) : uLayer == 1 ? matSoil(uv) : uLayer == 2 ? matGravel(uv) : uLayer == 3 ? matRock(uv)
         : uLayer == 4 ? matSand(uv) : uLayer == 5 ? matMud(uv) : uLayer == 6 ? matCanopy(uv) : matStrata(uv);
  return clamp(m, 0.0, 1.0);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float e = 1.0 / uSize;
  vec2 m = material(uv);
  float hx = material(uv + vec2(e, 0.0)).x - material(uv - vec2(e, 0.0)).x;
  float hy = material(uv + vec2(0.0, e)).x - material(uv - vec2(0.0, e)).x;
  outColor = vec4(clamp(0.5 + vec2(hx, hy) * (uSize / 512.0) * 2.4, 0.0, 1.0), m);
}`;

/**
 * @returns {{ texture: THREE.DataArrayTexture-like, size: number, ms: number, dispose(): void }}
 */
export function createGroundDetail(renderer, { size = 512, anisotropy = 4 } = {}) {
  const t0 = performance.now();
  const rt = new THREE.WebGLArrayRenderTarget(size, size, DETAIL_LAYERS.length, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, depthBuffer: false, stencilBuffer: false,
    generateMipmaps: true, colorSpace: THREE.NoColorSpace,
  });
  rt.texture.anisotropy = anisotropy;
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: { uLayer: { value: 0 }, uSize: { value: size } },
    vertexShader: FULLSCREEN_VERT, fragmentShader: GEN_FRAG,
  });
  const tri = fullscreenTriangle();
  const scene = new THREE.Scene(), mesh = new THREE.Mesh(tri, mat), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  mesh.frustumCulled = false; scene.add(mesh);
  const prev = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
  renderer.autoClear = false;
  for (let l = 0; l < DETAIL_LAYERS.length; l++) {
    mat.uniforms.uLayer.value = l;
    renderer.setRenderTarget(rt, l);
    renderer.render(scene, cam);
  }
  renderer.setRenderTarget(prev); renderer.autoClear = prevAuto;
  mat.dispose(); tri.dispose();
  return { texture: rt.texture, size, ms: performance.now() - t0, dispose() { rt.dispose(); } };
}
