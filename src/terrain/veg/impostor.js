// Hemi-octahedral impostors baked at boot from the procedural tree meshes (treegen.js).
// Each species gets N x N views over the upper hemisphere (octahedral mapping); a frame is an orthographic view of
// the tree's bounding sphere. Two atlases, one draw call each for ALL species and frames (instanced by frame):
//   atlas A (RGBA8): rgb = sqrt(linear albedo), a = coverage
//   atlas B (RGBA8): rg = octahedral tree-local shading normal, b = crown-relative height h_rel, a = crown depth d_rel
//   (both cleared to 0, i.e. premultiplied by coverage: divide by A.a after filtering)
// At runtime the impostor fragment shader intersects the pixel's view ray with the planes of the 4 nearest frames
// (proper per-frame parallax, no swimming near the zenith) and blends them.
import * as THREE from 'three';
import { SPECIES, NSPECIES } from './species.js';
import { VMAX, VERTEX_PULL_GLSL } from './treegen.js';

export const IMP_N = 7;                  // views per side
export const IMP_COLS = 4;               // species blocks per atlas row

export const OCT_GLSL = /* glsl */`
// hemi-octahedral mapping: unit direction with y >= 0  <->  o in [-1, 1]^2
vec2 vegOctEnc(vec3 d) {
  d.y = max(d.y, 0.0);
  vec3 a = abs(d);
  vec2 p = d.xz / (a.x + a.y + a.z);
  return vec2(p.x + p.y, p.x - p.y);
}
vec3 vegOctDec(vec2 o) {
  vec2 p = vec2(o.x + o.y, o.x - o.y) * 0.5;
  return normalize(vec3(p.x, 1.0 - abs(p.x) - abs(p.y), p.y));
}
void vegFrameBasis(vec3 d, out vec3 r, out vec3 u) {
  r = normalize(cross(vec3(0.0, 1.0, 0.0), d) + vec3(1e-5, 0.0, 0.0));
  u = cross(d, r);
}
// full-sphere octahedral normal encoding (for the stored normals)
vec2 vegNrmEnc(vec3 n) {
  n /= abs(n.x) + abs(n.y) + abs(n.z);
  vec2 e = n.y >= 0.0 ? n.xz : (1.0 - abs(n.zx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.z >= 0.0 ? 1.0 : -1.0);
  return e * 0.5 + 0.5;
}
vec3 vegNrmDec(vec2 e) {
  e = e * 2.0 - 1.0;
  vec3 n = vec3(e.x, 1.0 - abs(e.x) - abs(e.y), e.y);
  float t = max(-n.y, 0.0);
  n.x += n.x >= 0.0 ? -t : t; n.z += n.z >= 0.0 ? -t : t;
  return normalize(n);
}
`;

/**
 * Bake the atlases. meshes = buildTreeMeshes() result, foliage = foliage atlas texture.
 * Returns { atlasA, atlasB, F, W, H, bytes, ms, dispose }.
 */
export function bakeImpostors(renderer, meshes, foliage, frameUniforms, { F = 72 } = {}) {
  const t0 = performance.now();
  const N = IMP_N, rows = Math.ceil(NSPECIES / IMP_COLS);
  const W = IMP_COLS * N * F, H = rows * N * F;
  const mkRT = () => {
    const rt = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false,
      generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace,
    });
    rt.texture.anisotropy = 4;
    return rt;
  };
  const rtA = mkRT(), rtB = mkRT();
  const info = meshes.info;
  const spData = new Float32Array(NSPECIES * 4);
  const spCol = [];
  info.forEach((s, i) => { spData.set([s.cy, s.radius, 0, 0], i * 4); });
  SPECIES.forEach((s) => { spCol.push(new THREE.Vector3(...s.leaf)); spCol.push(new THREE.Vector3(...s.bark)); });
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(VMAX * 3), 3));
  geo.instanceCount = NSPECIES * N * N;
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, side: THREE.DoubleSide,
    uniforms: {
      tVegVerts: { value: meshes.texture }, tVegFoliage: { value: foliage },
      uSp: { value: Array.from({ length: NSPECIES }, (_, i) => new THREE.Vector4(info[i].cy, info[i].radius, 0, 0)) },
      uCol: { value: spCol }, uPass: { value: 0 }, uDepthReversed: frameUniforms.uDepthReversed,
      uAtlas: { value: new THREE.Vector4(N, F, W, H) },
    },
    vertexShader: /* glsl */`
      precision highp float; precision highp int;
      ${VERTEX_PULL_GLSL}
      ${OCT_GLSL}
      uniform vec4 uSp[${NSPECIES}];
      uniform vec4 uAtlas;
      uniform float uDepthReversed;
      out vec2 vUv; out vec3 vN; out vec2 vHD; out float vKind; flat out int vS;
      void main() {
        int N = int(uAtlas.x);
        int s = gl_InstanceID / (N * N), f = gl_InstanceID % (N * N);
        int fx = f % N, fy = f / N;
        vec4 t0, t1, t2;
        vegFetch(s, gl_VertexID, t0, t1, t2);
        vec3 d = vegOctDec(vec2(float(fx), float(fy)) / (uAtlas.x - 1.0) * 2.0 - 1.0);
        vec3 r, u; vegFrameBasis(d, r, u);
        vec3 c = vec3(0.0, uSp[s].x, 0.0);
        float R = uSp[s].y;
        vec3 q = t0.xyz - c;
        vec2 l = vec2(dot(q, r), dot(q, u)) / R;              // -1..1 inside the frame
        float z = dot(q, d) / R;                              // +1 = toward the viewer
        int bx = s % ${IMP_COLS}, by = s / ${IMP_COLS};
        vec2 px = (vec2(float(bx * N + fx), float(by * N + fy)) + 0.5 + 0.5 * l * (1.0 - 1.0 / uAtlas.y)) * uAtlas.y;
        vec2 ndc = px / uAtlas.zw * 2.0 - 1.0;
        gl_Position = vec4(ndc, uDepthReversed > 0.5 ? 0.5 + 0.2 * z : -0.4 * z, 1.0);   // |z| up to 2.5: leaves past the bounding radius are not clipped
        if (all(equal(t0, vec4(0.0)))) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // unused vertex
        vUv = vec2(t0.w, t1.w); vN = t1.xyz; vHD = t2.xy; vKind = t2.w; vS = s;
      }`,
    fragmentShader: /* glsl */`
      precision highp float; precision highp int;
      ${OCT_GLSL}
      uniform sampler2D tVegFoliage;
      uniform vec3 uCol[${NSPECIES * 2}];
      uniform float uPass;
      uniform vec4 uAtlas;
      in vec2 vUv; in vec3 vN; in vec2 vHD; in float vKind; flat in int vS;
      out vec4 outColor;
      void main() {
        vec4 fo;
        vec3 alb;
        if (vKind < 0.5) {      // bark: wraps inside the bark tile (11)
          vec2 buv = vec2(0.75, 0.5) + fract(vUv * vec2(1.0, 0.25)) * 0.25;
          fo = textureLod(tVegFoliage, buv, 2.0);
          alb = uCol[vS * 2 + 1] * (0.6 + 0.8 * fo.r);
          fo.a = 1.0;
        } else {
          fo = texture(tVegFoliage, vUv, 0.5);
          alb = uCol[vS * 2] * (0.45 + 1.1 * fo.r) * mix(vec3(1.0), vec3(1.5, 1.1, 0.55), fo.g * 0.6) * (0.7 + 0.3 * fo.b);
          // coverage preserved under minification: sharpen the alpha by the mip level
          vec2 dx = dFdx(vUv * 1024.0), dy = dFdy(vUv * 1024.0);
          float mip = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
          fo.a *= 1.0 + mip * 0.3;
        }
        if (fo.a < 0.5) discard;
        if (uPass < 0.5) outColor = vec4(sqrt(clamp(alb, 0.0, 1.0)), 1.0);
        else outColor = vec4(vegNrmEnc(normalize(vN)), clamp(vHD.x, 0.0, 1.0), clamp(vHD.y, 0.0, 1.0));
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
  const prevCC = new THREE.Color(); renderer.getClearColor(prevCC); const prevCA = renderer.getClearAlpha();
  renderer.autoClear = true;
  // cleared to 0: both atlases are effectively premultiplied by coverage (A.a), so their mips average only covered
  // texels once divided by A.a at runtime (no dark / mid-crown h, d fringe at a distance)
  renderer.setClearColor(new THREE.Color(0, 0, 0), 0);
  mat.uniforms.uPass.value = 0; renderer.setRenderTarget(rtA); renderer.render(scene, cam);
  mat.uniforms.uPass.value = 1; renderer.setRenderTarget(rtB); renderer.render(scene, cam);
  renderer.setRenderTarget(prev); renderer.autoClear = prevAuto; renderer.setClearColor(prevCC, prevCA);
  geo.dispose(); mat.dispose();
  return {
    atlasA: rtA.texture, atlasB: rtB.texture, F, W, H, N, rtA, rtB,
    bytes: 2 * W * H * 4 * 4 / 3,
    ms: performance.now() - t0,
    dispose() { rtA.dispose(); rtB.dispose(); },
  };
}
