// GLSL and uniforms shared by the near (mesh), far (impostor) and grass layers.
import * as THREE from 'three';
import { CURVATURE_GLSL } from '../../core/glsl.js';
import { clipmapGLSL } from '../material.js';
import { CELL_GLSL } from './placement.js';
import { SPECIES, SPECIES_INDEX, NSPECIES, LEAF_OPTICS, TREE_CELL } from './species.js';

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
// Understory layer (VEG_UNDER): a shrub or young tree in the gap between the trees of a stand, more and bigger at the
// stand's edge (the mantle of bushes and low growth that closes a real forest edge). Same hashes near and far, so
// the mesh and impostor layers agree. Returns the size (m, 0 = none) and moves base / species.
float vegUnder(vec2 cell, vec4 m, inout vec2 base, inout int s) {
  if (m.r <= 0.0 || m.a < 0.12 || uVegSp[s].w > 0.5) return 0.0;
  float occ = step(0.01, vegMapAt(cell + vec2(1.0, 0.0)).r) + step(0.01, vegMapAt(cell - vec2(1.0, 0.0)).r)
            + step(0.01, vegMapAt(cell + vec2(0.0, 1.0)).r) + step(0.01, vegMapAt(cell - vec2(0.0, 1.0)).r);
  float edge = min((4.0 - occ) * 0.6, 1.0);        // one open side already makes a stand edge
  vec2 uh = vegHash(cell + 130000.0), uh2 = vegHash(cell + 150000.0);
  float p = (0.5 + 0.5 * edge) * max(smoothstep(0.2, 0.5, m.a), edge);
  if (uh.x >= p) return 0.0;
  vec2 loc = vegCellLocal(cell);
  base += mod(loc + ${(TREE_CELL / 2).toFixed(2)} + (uh2 - 0.5) * 2.4, ${TREE_CELL.toFixed(2)}) - loc;
  // saplings of the stand's own species (more under conifers), bushes otherwise
  bool sap = uh.y < (uVegSp[s].z > 0.5 ? 0.5 : 0.3 + 0.25 * edge);
  s = sap ? s : (uh.y < 0.85 ? ${SPECIES_INDEX.bush} : ${SPECIES_INDEX.scrub});
  float sz = mix(1.3, 3.2, uh2.x) + edge * mix(1.5, 3.5, uh2.y);
  if (sap) sz = mix(3.0, 8.0, uh2.y) * (0.75 + 0.45 * edge);
  return sz;
}
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
  // individuals differ a lot in a real stand (age, vigour, light, genotype): brightness over about 2:1, yellower
  // and bluer greens, a few greyish ones
  float b = vh.x * 0.6 + fract(vh.x * 7.31 + vh2.y * 3.7) * 0.4;
  vec3 c = uVegLeaf[s] * (0.62 + 0.76 * b);
  float broad = 1.0 - uVegSp[s].z;
  c = mix(c, c * vec3(1.35, 1.18, 0.75), smoothstep(0.5, 1.0, vh.y) * 0.75 * broad);      // yellower individuals
  c = mix(c, c * vec3(0.82, 0.98, 1.2), smoothstep(0.5, 0.0, vh.y) * 0.55);                // bluer individuals
  c = mix(c, vec3(dot(c, vec3(0.3, 0.55, 0.15))), step(0.9, vh2.y) * 0.35);                 // greyish
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
    #ifdef VEG_BAKED
      // own crown: the per-tree visibility baked through its leaves (L1 SH, world-oriented); neighbours: the crown
      // network's stand term (its transfer at the crown surface for this cover relative to an open-grown tree)
      float vOwnSun = clamp(vVegVis.x + dot(vVegVis.yzw, uSunDir), 0.0, 1.0);
      float vOwnSky = clamp(vVegVis.x + 0.6667 * vVegVis.z, 0.0, 1.0);
      vec2 vNb = vegCrownTransfer(vVegHD.x, 0.0, vVegHD.z, vVegMisc.y, vVegMisc.z)
               / max(vegCrownTransfer(vVegHD.x, 0.0, vVegHD.z, 0.1, vVegMisc.z), vec2(0.05));
      vec2 vTr = vec2(vOwnSun, vOwnSky) * clamp(vNb, 0.0, 1.0);
    #else
      vec2 vTr = vegCrownTransfer(vVegHD.x, vVegHD.y, vVegHD.z, vVegMisc.y, vVegMisc.z);
    #endif
    vegDbgHD = vec3(vVegHD.xy, vTr.x);
    #ifdef VEG_SM_COVER
      // where the sun shadow map covers this point it already shadows the leaves (the trees cast into it): the crown
      // network's sun term would count the same occluders a second time
      #ifdef VEG_BAKED
        vTr.x = mix(vTr.x, sqrt(vTr.x), vegShadowMapCover(vVegWorld));   // the bake resolves the leaf-scale self shade the map cannot
      #else
        vTr.x = mix(vTr.x, 1.0, vegShadowMapCover(vVegWorld));
      #endif
    #endif
    // + light diffused through the foliage (leaf single-scattering albedo ~0.3: a floor of a tenth of the open value)
    vTr += (1.0 - vTr) * vec2(0.08, 0.20);
    #ifdef VEG_BAKED
      float sunV = vTr.x * vVegMisc.x;       // the bake covers bark too (trunks inside the crown are in its shade)
      float skyV = vTr.y;
    #else
      float sunV = mix(1.0, vTr.x, vVegMisc.w * 0.9 + 0.1) * vVegMisc.x;
      float skyV = mix(1.0, vTr.y, vVegMisc.w * 0.85 + 0.15);
    #endif
    vegDbgOut = vec4(sunV, skyV, dot(inverseTransformDirection(normal, viewMatrix), uSunDir), 0.0);
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

/** Debug (tools only, URL vegDbg=1): interleaved columns show albedo x 4 | sun factor | N.L (use notaa=1). */
export const vegDebug = { mode: 0 };
export const VEG_DBG_GLSL = /* glsl */`
  #include <dithering_fragment>
  #ifdef VEG_DBG
  { int c = int(gl_FragCoord.x) % 3;
    #if VEG_DBG == 2
    gl_FragColor.rgb = vec3(c == 0 ? vegDbgHD.x : c == 1 ? vegDbgHD.y : vegDbgHD.z);
    #else
    gl_FragColor.rgb = c == 0 ? diffuseColor.rgb * 4.0 : c == 1 ? vec3(vegDbgOut.x) : vec3(max(vegDbgOut.z, 0.0));
    #endif
  }
  #endif
`;

/** Coverage (0..1) of the engine's wide sun-shadow cascade at a render-space point (render/shadows.js layout). */
export const VEG_SM_COVER_GLSL = /* glsl */`
uniform mat4 uSunShadowMatrix[2]; uniform vec4 uSunShadowRect[2]; uniform vec4 uSunShadowParams;
float vegShadowMapCover(vec3 p) {
  vec4 r = uSunShadowRect[1];
  vec3 c = (uSunShadowMatrix[1] * vec4(p, 1.0)).xyz;
  vec2 e = min(c.xy - r.xy, r.zw - c.xy);
  float inside = min(e.x, e.y) / max(r.w - r.y, 1e-6);
  return (inside > 0.0 && c.z > 0.0 && c.z < 1.0) ? smoothstep(0.0, 0.1, inside) * step(0.5, uSunShadowParams.w) : 0.0;
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
vec4 vegDbgOut; vec3 vegDbgHD;
varying vec3 vVegHD; varying vec4 vVegMisc; varying vec3 vVegTrans; varying vec3 vVegWorld; varying vec4 vVegVis;
`;
export function transGLSL() {
  const b = TRANS_RATIO.broad.map((v) => v.toFixed(3)).join(', '), c = TRANS_RATIO.conifer.map((v) => v.toFixed(3)).join(', ');
  return `vec3 vegTransRatio(float conif) { return mix(vec3(${b}), vec3(${c}), conif); }`;
}
