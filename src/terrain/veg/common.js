// GLSL and uniforms shared by the near (mesh), far (impostor) and grass layers.
import * as THREE from 'three';
import { CURVATURE_GLSL } from '../../core/glsl.js';
import { clipmapGLSL } from '../material.js';
import { CELL_GLSL } from './placement.js';
import { SPECIES, NSPECIES, LEAF_OPTICS, TREE_CELL } from './species.js';

export function vegVertexCommon(L) {
  return /* glsl */`
${clipmapGLSL(L)}
${CURVATURE_GLSL}
${CELL_GLSL}
uniform highp sampler2D tVegMap;
uniform highp vec4 uVegWin;        // map window: xy = min world cell, z = G
uniform highp vec2 uVegCellOrg;    // world cell index of the render origin
uniform vec4 uVegSp[${NSPECIES}];  // per species: x = bounding centre y (units of H), y = bounding radius, z = conifer, w = shrub
uniform vec3 uVegLeaf[${NSPECIES}];
uniform vec3 uVegBark[${NSPECIES}];
uniform vec4 uVegWind;             // xy = unit direction the wind blows toward (world xz), z = strength 0..2, w = gustiness
uniform vec4 uVegRange;            // x = near radius, y = near/far blend width, z = far fade start, w = far end
uniform vec4 uVegSeason;           // x = autumn amount 0..1
uniform float uTerrCurv;
uniform float uTime;
uniform vec3 uOrigin;
vec2 vegCellRXZ(vec2 cell) { return (cell - uVegCellOrg) * ${TREE_CELL.toFixed(2)} + vegCellLocal(cell) - mod(uOrigin.xz, ${TREE_CELL.toFixed(2)}); }
vec4 vegMapAt(vec2 cell) { return texelFetch(tVegMap, ivec2(mod(cell, uVegWin.z)), 0); }
// height of the RENDERED terrain at render-space xz (the mesh's level blend; exact near the camera)
float vegGround(vec2 rxz) {
  float d = terrLodDist(rxz);
  float lf = terrLevelAt(d);
  vec4 g = terrTexH(rxz, lf);
  float h = g.x + g.y;
  if (lf < uTerrLod.z) {
    float kb = terrMorph(d / (uTerrLod.x * exp2(lf)));
    if (kb > 0.0) { vec4 g2 = terrTexH(rxz, lf + 1.0); h = mix(h, g2.x + g2.y, kb); }
  }
  return h;
}
// per-tree foliage colour: species mean, per-tree brightness / hue, autumn tint for broadleaf
vec3 vegTreeColour(int s, vec2 vh, vec2 vh2) {
  vec3 c = uVegLeaf[s] * (0.78 + 0.44 * vh.x);
  float broad = 1.0 - uVegSp[s].z;
  c = mix(c, c * vec3(1.30, 1.15, 0.80), smoothstep(0.55, 1.0, vh.y) * 0.6 * broad);      // yellower individuals
  c = mix(c, c * vec3(0.85, 1.0, 1.15), smoothstep(0.45, 0.0, vh.y) * 0.4);                // bluer individuals
  float aut = uVegSeason.x * broad * smoothstep(0.2, 0.9, vh2.x);
  c = mix(c, vec3(0.22, 0.10, 0.025) * (0.6 + 0.8 * vh2.y), aut * 0.8);
  return c;
}
// wind: whole-tree sway (low frequency, bends with height^2) + leaf flutter
vec3 vegWind(vec3 wp, float bend, float flutter, float size, float phase) {
  float s = uVegWind.z;
  float t = uTime;
  float sway = sin(t * (0.9 + 0.25 * phase) + phase * 6.28) * 0.6 + sin(t * 2.1 + phase * 11.0) * 0.25 + 0.5 * uVegWind.w * sin(t * 0.37 + wp.x * 0.01);
  vec3 off = vec3(uVegWind.x, 0.0, uVegWind.y) * (s * (0.35 + 0.65 * sway) * bend * size * 0.035);
  off += (flutter * s * 0.06 * min(size, 6.0)) * vec3(sin(t * 7.0 + wp.x * 1.7 + wp.y), sin(t * 8.3 + wp.z * 1.3) * 0.5, sin(t * 6.1 + wp.z * 1.9));
  return off;
}
`;
}

/** Fragment lighting hooks for MeshStandardMaterial (replaces aomap_fragment). Needs varyings
 *  vVegHD (h_rel, d_rel, cosAz), vVegMisc (terrain shadow, cover, conifer, leaf 0..1), vVegTrans (leaf transmittance). */
export const VEG_LIGHT_GLSL = /* glsl */`
  {
    vec2 vTr = vegCrownTransfer(vVegHD.x, vVegHD.y, vVegHD.z, vVegMisc.y, vVegMisc.z);
    // + light diffused through the foliage (leaf single-scattering albedo ~0.3: a floor of a tenth of the open value)
    vTr += (1.0 - vTr) * vec2(0.10, 0.25);
    float sunV = mix(1.0, vTr.x, vVegMisc.w * 0.9 + 0.1) * vVegMisc.x;
    float skyV = mix(1.0, vTr.y, vVegMisc.w * 0.85 + 0.15);
    reflectedLight.directDiffuse *= sunV;
    reflectedLight.directSpecular *= sunV * VEG_SPEC_DIRECT;
    reflectedLight.indirectDiffuse *= skyV;
    reflectedLight.indirectSpecular *= skyV * skyV * VEG_SPEC_SKY;
    vec3 nW = inverseTransformDirection(normal, viewMatrix);
    vec3 vW = normalize(cameraPosition - vVegWorld);
    // two-sided translucency: light through the leaves (back faces of the crown) and forward scattering at the rim
    float back = max(-dot(nW, uSunDir), 0.0) * 0.55 + 0.75 * pow(max(dot(-vW, uSunDir), 0.0), 5.0);
    reflectedLight.directDiffuse += vVegTrans * uSunColor * (back * vTr.x * vVegMisc.x * vVegMisc.w / PI);
  }
`;

export function createCommonUniforms(ctx, uniforms, placement, meshes, neural) {
  const F = ctx.uniforms.frame;
  const sp = SPECIES.map((s, i) => new THREE.Vector4(meshes.info[i].cy, meshes.info[i].radius, s.group === 'conifer' ? 1 : 0, s.shape === 'dome' ? 1 : 0));
  return {
    tTerrH: uniforms.tTerrH, uTerrLvl: uniforms.uTerrLvl, uTerrCam: uniforms.uTerrCam, uTerrLod: uniforms.uTerrLod,
    uTerrCurv: uniforms.uTerrCurv, uOrigin: F.uOrigin, uTime: F.uTime, uSunDir: F.uSunDir, uSunColor: F.uSunColor,
    tVegMap: { value: placement.texture }, uVegWin: placement.uniforms.uVegWin, uVegCellOrg: placement.uniforms.uVegCellOrg,
    uVegSp: { value: sp },
    uVegLeaf: { value: SPECIES.map((s) => new THREE.Vector3(...s.leaf)) },
    uVegBark: { value: SPECIES.map((s) => new THREE.Vector3(...s.bark)) },
    uVegWind: { value: new THREE.Vector4(1, 0, 0.3, 0.2) },
    uVegRange: { value: new THREE.Vector4(100, 20, 1000, 1200) },
    uVegSeason: { value: new THREE.Vector4(0, 0, 0, 0) },
    ...neural.uniforms,
  };
}

/** transmittance / reflectance ratio of the leaves per group (to turn a reflectance albedo into a translucency tint) */
export const TRANS_RATIO = {
  broad: LEAF_OPTICS.broad.tau.map((t, i) => t / LEAF_OPTICS.broad.rho[i]),
  conifer: LEAF_OPTICS.conifer.tau.map((t, i) => t / LEAF_OPTICS.conifer.rho[i]),
};
export const FRAG_DECL_GLSL = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uSunColor;
varying vec3 vVegHD; varying vec4 vVegMisc; varying vec3 vVegTrans; varying vec3 vVegWorld;
`;
export function transGLSL() {
  const b = TRANS_RATIO.broad.map((v) => v.toFixed(3)).join(', '), c = TRANS_RATIO.conifer.map((v) => v.toFixed(3)).join(', ');
  return `vec3 vegTransRatio(float conif) { return mix(vec3(${b}), vec3(${c}), conif); }`;
}
