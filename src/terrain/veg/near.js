// Near trees: full procedural meshes, one instanced draw (vertex pulling: any species mix in one call), plus the
// shadow-map depth pass (the trees cast and receive the sim's sun shadows near the aircraft).
import * as THREE from 'three';
import { VERTEX_PULL_GLSL, VMAX } from './treegen.js';
import { vegVertexCommon, VEG_LIGHT_GLSL, FRAG_DECL_GLSL, transGLSL } from './common.js';
import { TREE_CELL } from './species.js';

export function createNearTrees(ctx, { L, Gn, U, neuralGLSL }) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(VMAX * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(VMAX * 3).fill(1), 3));
  geo.instanceCount = Gn * Gn;
  const NU = { uVegNear: { value: new THREE.Vector4(Gn, 0, 0, 0) } };     // y, z = min world cell of the near window

  // vertex body shared by the colour and the depth material: defines vegPos, vegNrm, vVeg* varyings
  const VERT = /* glsl */`
    float vG = uVegNear.x;
    vec2 vij = vec2(float(gl_InstanceID % int(vG)), float(gl_InstanceID / int(vG)));
    vec2 vCell = uVegNear.yz + vij;
    vec4 vM = vegMapAt(vCell);
    int vS = int(vM.g + 0.5);
    vec2 vBase = vegCellRXZ(vCell);
    float vDist = distance(vBase, uTerrCam.xz);
    float vSize = vM.r * step(vDist, uVegRange.x + 2.0);
    vec4 t0, t1, t2;
    vegFetch(vS, gl_VertexID, t0, t1, t2);
    vec2 vh = vegHash(vCell + 60000.0), vh2 = vegHash(vCell + 90000.0);
    float vAng = vh.x * 6.2831853, vc = cos(vAng), vs = sin(vAng);
    float vWide = mix(0.86, 1.18, vh.y);
    vec3 vLoc = vec3(t0.x * vWide, t0.y, t0.z * vWide);
    vLoc.xz = vec2(vc * vLoc.x - vs * vLoc.z, vs * vLoc.x + vc * vLoc.z);
    vLoc.xz += (vh2 - 0.5) * 0.05 * t0.y * t0.y;                                  // lean
    float vGround = vegGround(vBase);
    vec3 vegPos = vec3(vBase.x, vGround - 0.25, vBase.y) + vLoc * vSize;
    vegPos += vegWind(vegPos, t2.z, step(0.5, t2.w) * (t2.w - 1.0) * 2.0, vSize, vh.x);
    vegPos.y -= uTerrCurv * curvatureDrop(vDist);
    vec3 vegNrm = normalize(vec3(vc * t1.x - vs * t1.z, t1.y, vs * t1.x + vc * t1.z));
    vVegUv = vec2(t0.w, t1.w);
    vVegKind = t2.w;
    vVegFade = vec2(vDist, vh2.x);
  `;
  const VDECL = /* glsl */`
    ${vegVertexCommon(L)}
    ${VERTEX_PULL_GLSL}
    uniform vec4 uVegNear;
    varying vec2 vVegUv; varying float vVegKind; varying vec2 vVegFade;
  `;
  // alpha (leaf coverage, mip-sharpened) and the near -> impostor dithered hand-over
  const ALPHA = /* glsl */`
    float vegAlpha(out vec4 fo) {
      if (vVegKind < 0.5) { fo = textureLod(tVegFoliage, vec2(0.75, 0.5) + fract(vVegUv * vec2(1.0, 0.25)) * 0.25, 1.5); fo.a = 1.0; }
      else {
        fo = texture(tVegFoliage, vVegUv);
        vec2 dx = dFdx(vVegUv * 1024.0), dy = dFdy(vVegUv * 1024.0);
        fo.a *= 1.0 + 0.3 * max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
      }
      float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + vVegFade.y);
      float hand = smoothstep(uVegRange.x - uVegRange.y, uVegRange.x, vVegFade.x);
      return (ign < hand) ? 0.0 : fo.a;
    }
  `;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
  mat.defines = { VEG_SPEC_DIRECT: '0.5', VEG_SPEC_SKY: '0.2' };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, NU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        ${VDECL}
        uniform vec3 uSunDir;
        varying vec3 vVegAlb; varying vec3 vVegHD; varying vec4 vVegMisc; varying vec3 vVegTrans; varying vec3 vVegWorld;
        ${transGLSL()}`)
      .replace('#include <beginnormal_vertex>', `${VERT}
        vec3 objectNormal = vegNrm;
        vec2 vSunC = normalize(uSunDir.xz + 1e-4);
        float vOcc = step(0.01, vegMapAt(vCell + floor(vSunC + 0.5)).r) + step(0.01, vegMapAt(vCell + floor(vSunC * 2.3 + 0.5)).r);
        float vOcc4 = 0.25 * (step(0.01, vegMapAt(vCell + vec2(1.0, 0.0)).r) + step(0.01, vegMapAt(vCell - vec2(1.0, 0.0)).r)
                            + step(0.01, vegMapAt(vCell + vec2(0.0, 1.0)).r) + step(0.01, vegMapAt(vCell - vec2(0.0, 1.0)).r));
        // stand density seen by this tree: open sides (forest edges, clearings) and an open side toward the sun
        float vCover = vM.a * mix(0.3, 1.0, vOcc4) * mix(1.0, mix(0.25, 1.0, vOcc * 0.5), 1.0 - max(uSunDir.y, 0.0));
        float vConif = uVegSp[vS].z;
        vVegAlb = vVegKind < 0.5 ? uVegBark[vS] * (0.8 + 0.4 * vh2.y) : vegTreeColour(vS, vh, vh2);
        vVegTrans = vVegAlb * vegTransRatio(vConif);
        vec2 vSunH = normalize(uSunDir.xz + 1e-4);
        vec2 vRad = vLoc.xz; float vRl = length(vRad);
        vVegHD = vec3(max(t2.x, 0.0), t2.y, vRl > 1e-3 ? dot(vRad / vRl, vSunH) : 0.0);
        vVegMisc = vec4(mix(0.25, 1.0, vM.b), vCover, vConif, step(0.5, vVegKind));
        vVegWorld = vegPos;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vegPos;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${FRAG_DECL_GLSL}
        ${neuralGLSL}
        uniform sampler2D tVegFoliage; uniform vec4 uVegRange;
        varying vec2 vVegUv; varying float vVegKind; varying vec2 vVegFade; varying vec3 vVegAlb;
        ${ALPHA}`)
      .replace('#include <map_fragment>', `
        vec4 vFo;
        if (vegAlpha(vFo) < 0.5) discard;
        diffuseColor.rgb = vVegKind < 0.5 ? vVegAlb * (0.55 + 0.9 * vFo.r) : vVegAlb * (0.45 + 1.1 * vFo.r) * mix(vec3(1.0), vec3(1.5, 1.1, 0.55), vFo.g * 0.6) * (0.7 + 0.3 * vFo.b);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vVegKind < 0.5 ? 0.9 : mix(0.55, 0.8, vVegMisc.z);')
      .replace('#include <normal_fragment_maps>', 'normal = normalize(vNormal);')      // crown normals: no back-face flip
      .replace('#include <aomap_fragment>', VEG_LIGHT_GLSL);
  };
  mat.customProgramCacheKey = () => 'skyward-veg-near';

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, NU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VDECL}`)
      .replace('#include <begin_vertex>', `${VERT}\nvec3 transformed = vegPos;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tVegFoliage; uniform vec4 uVegRange;
        varying vec2 vVegUv; varying float vVegKind; varying vec2 vVegFade;
        ${ALPHA}`)
      .replace('void main() {', 'void main() {\n vec4 vFo; if (vegAlpha(vFo) < 0.5) discard;');
  };
  depth.customProgramCacheKey = () => 'skyward-veg-near-depth';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'veg-near'; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  mesh.castShadow = !!ctx.quality.shadows; mesh.receiveShadow = true;
  mesh.customDepthMaterial = depth;
  return {
    mesh, uniforms: NU,
    update(camWX, camWZ) {
      NU.uVegNear.value.set(Gn, Math.floor(camWX / TREE_CELL) - (Gn >> 1), Math.floor(camWZ / TREE_CELL) - (Gn >> 1), 0);
    },
    dispose() { geo.dispose(); mat.dispose(); depth.dispose(); },
  };
}
