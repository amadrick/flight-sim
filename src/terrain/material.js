// Terrain surface material: MeshStandardMaterial (so the engine's sun, shadow map, ambient and IBL apply unchanged)
// with the vertex stage replaced by clipmap displacement + CDLOD geomorphing and the fragment inputs (albedo,
// roughness, normal, AO, terrain self-shadow) replaced by the land-surface shader (surface.glsl.js).
// The learned land cover (src/neural/ground-cover.js) is evaluated here in the VERTEX stage and interpolated: its
// inputs are band-limited to several clipmap texels, so per-vertex evaluation loses nothing and keeps a ~900
// multiply-add network and its feature fetches out of the fragment shader.
import * as THREE from 'three';
import { CURVATURE_GLSL } from '../core/glsl.js';
import { COVER_GLSL, SURFACE_GLSL, ECO_GLSL, GROUND_MODE } from './surface.glsl.js';
import { VEG_NEURAL_GLSL } from '../neural/veg.js';
import { VEG_CANOPY_GLSL } from './veg/canopy.js';

// Noise sampling scales: period in metres and a rotation so the scales never line up (anti-tiling).
export const TILE_SCALES = [
  { period: 19000, angle: 0.31 }, { period: 2300, angle: 1.13 }, { period: 410, angle: 2.29 }, { period: 110, angle: 0.71 },
  { period: 23, angle: 1.87 }, { period: 4.1, angle: 2.93 }, { period: 0.71, angle: 0.47 },
];

/** GLSL shared by the vertex and fragment stages (and by the public terrainHeight hook): clipmap addressing.
 *  Valid in both stages: explicit LOD lookups only, no derivatives, explicit highp so VS/FS declarations always match. */
export function clipmapGLSL(L) {
  return /* glsl */`
uniform highp sampler2DArray tTerrH;
uniform highp vec3 uTerrLvl[${L}];   // per level: xy = uv offset (origin fraction + half texel), z = 1 / (N * texel spacing)
uniform highp vec4 uTerrCam;         // xyz = camera position (render space), w = LOD clearance Hd
uniform highp vec4 uTerrLod;         // x = LOD range of level 0, y = finest valid level, z = top level, w = morph start
float terrMorph(float x) { return clamp((x - uTerrLod.w) / (0.96 - uTerrLod.w), 0.0, 1.0); }
vec4 terrTexH(vec2 rxz, float lvl) { vec3 l = uTerrLvl[int(lvl)]; return textureLod(tTerrH, vec3(rxz * l.z + l.xy, lvl), 0.0); }
float terrLodDist(vec2 rxz) { vec2 q = rxz - uTerrCam.xz; return sqrt(dot(q, q) + uTerrCam.w * uTerrCam.w); }
float terrLevelAt(float d) { return clamp(ceil(log2(max(d, 1.0) / uTerrLod.x)), uTerrLod.y, uTerrLod.z); }
`;
}

export const TILE_CONSTS_GLSL = TILE_SCALES.map((s, i) => `const vec3 TERR_TILE${i} = vec3(${Math.cos(s.angle).toFixed(6)}, ${Math.sin(s.angle).toFixed(6)}, ${(1 / s.period).toExponential(6)});`).join('\n');

/** quality: 0 low, 1 medium, 2 high / ultra (detail scales and side projection of the surface shader). */
export function createTerrainMaterial(ctx, { L, shadowSteps, uniforms, quality = 2 }) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.defines = { ...(mat.defines || {}), TERR_SHADOW_STEPS: shadowSteps, TERR_Q: quality };
  const tileConsts = TILE_CONSTS_GLSL;
  const neural = GROUND_MODE !== 'classic';
  const cover = COVER_GLSL, surface = SURFACE_GLSL;

  // painted distant forest lit by the vegetation canopy network (its LUT uniforms are merged into `uniforms` by
  // trees.js before the first render; without 3-D trees, or with ground=classic, the forest stays Lambertian)
  const vegCanopyOn = () => neural && !!uniforms.tVegCanopyLUT;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const vegK = vegCanopyOn();
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`#include <common>
        ${clipmapGLSL(L)}
        ${CURVATURE_GLSL}
        attribute vec4 iA;       // render x, render z, vertex spacing, texture level
        attribute vec4 iB;       // grid level, force-morph, -, -
        varying vec3 vTerrPos;   // render-space position before the curvature drop (y = true height)
        uniform float uTerrCurv;
        ${neural ? /* glsl */`
        ${tileConsts}
        ${ECO_GLSL}
        uniform sampler2D tTerrNoise;
        uniform vec2 uTerrTile[7];
        varying vec4 vTerrEcoA; varying vec4 vTerrEcoB; varying vec4 vTerrEcoC;   // learned land cover
        varying vec4 vTerrN0;    // province-scale noise (19 km)
        varying vec4 vTerrAux;   // x = valley-scale concavity` : ''}
      `)
      .replace('#include <begin_vertex>', /* glsl */`
        vec2 tg = position.xy;
        vec2 tp0 = iA.xy + tg * iA.z;
        float td = terrLodDist(tp0);
        float trl = uTerrLod.x * exp2(iB.x);
        // CDLOD geomorph, two stages: grid level -> parent grid -> grandparent grid
        float tk1 = max(iB.y, terrMorph(td / trl));
        float tk2 = terrMorph(td / (2.0 * trl));
        vec2 tg1 = tg - fract(tg * 0.5) * 2.0 * tk1;
        vec2 tg2 = tg1 - mod(tg1, 4.0) * tk2;
        vec2 tpxz = iA.xy + tg2 * iA.z;
        // height: a function of position and LOD distance only, so every patch agrees at shared vertices
        float ta = clamp(max(iA.w, ceil(log2(max(td, 1.0) / uTerrLod.x))), iA.w, uTerrLod.z);
        vec4 th4 = terrTexH(tpxz, ta);
        float th = th4.x + th4.y;
        float tka = 0.0;
        if (ta < uTerrLod.z) {
          tka = terrMorph(td / (uTerrLod.x * exp2(ta)));
          if (tka > 0.0) { vec4 tb = terrTexH(tpxz, ta + 1.0); th = mix(th, tb.x + tb.y, tka); }
        }
        vTerrPos = vec3(tpxz.x, th, tpxz.y);
        vec3 transformed = vec3(tpxz.x, th - uTerrCurv * curvatureDrop(distance(tpxz, uTerrCam.xz)), tpxz.y);
        ${neural ? /* glsl */`
        TerrEco tE = terrEco(tpxz, th);
        vTerrEcoA = tE.a; vTerrEcoB = tE.b; vTerrEcoC = tE.c;
        vec2 tnuv = vec2(TERR_TILE0.x * tpxz.x - TERR_TILE0.y * tpxz.y, TERR_TILE0.y * tpxz.x + TERR_TILE0.x * tpxz.y) * TERR_TILE0.z + uTerrTile[0];
        vTerrN0 = textureLod(tTerrNoise, tnuv, max(ta - 6.0, 0.0));
        float tcw = terrTexD(tpxz, min(ta + 2.0, uTerrLod.z)).w;
        if (tka > 0.0) tcw = mix(tcw, terrTexD(tpxz, min(ta + 3.0, uTerrLod.z)).w, tka);
        vTerrAux = vec4((tcw - 0.5) / 1.5, 0.0, 0.0, 0.0);` : ''}
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        ${clipmapGLSL(L)}
        ${tileConsts}
        varying vec3 vTerrPos;
        ${neural ? 'varying vec4 vTerrEcoA; varying vec4 vTerrEcoB; varying vec4 vTerrEcoC; varying vec4 vTerrN0; varying vec4 vTerrAux;' : ''}
        ${cover}
        ${vegK ? '#define VEG_CANOPY 1\n' + VEG_NEURAL_GLSL + VEG_CANOPY_GLSL : ''}
        ${surface}
      `)
      .replace('#include <map_fragment>', /* glsl */`
        TerrSurf tSurf = terrSurface(vTerrPos);
        diffuseColor.rgb = tSurf.albedo;
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tSurf.rough;')
      .replace('#include <normal_fragment_maps>', /* glsl */`
        normal = normalize(mat3(viewMatrix) * tSurf.n);
        nonPerturbedNormal = normal;
      `)
      .replace('#include <aomap_fragment>', /* glsl */`
        reflectedLight.indirectDiffuse *= tSurf.ao;
        reflectedLight.indirectSpecular *= tSurf.ao * tSurf.ao;
        reflectedLight.directDiffuse *= tSurf.shadow${neural ? ' * tSurf.canopyK' : ''};
        reflectedLight.directSpecular *= tSurf.shadow;
      `);
  };
  mat.customProgramCacheKey = () => `skyward-terrain-${GROUND_MODE}-${L}-${shadowSteps}-${quality}-${vegCanopyOn() ? 1 : 0}`;
  return mat;
}
