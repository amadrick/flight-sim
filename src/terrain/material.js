// Terrain surface material: MeshStandardMaterial (so the engine's sun, shadow map, ambient and IBL apply unchanged)
// with the vertex stage replaced by clipmap displacement + CDLOD geomorphing and the fragment inputs (albedo,
// roughness, normal, AO, terrain self-shadow) replaced by a fully procedural biome shader.
import * as THREE from 'three';
import { CURVATURE_GLSL } from '../core/glsl.js';
import { COVER_GLSL, SURFACE_GLSL } from './surface.glsl.js';

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

export function createTerrainMaterial(ctx, { L, shadowSteps, uniforms }) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.defines = { ...(mat.defines || {}), TERR_SHADOW_STEPS: shadowSteps };
  const tileConsts = TILE_CONSTS_GLSL;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`#include <common>
        ${clipmapGLSL(L)}
        ${CURVATURE_GLSL}
        attribute vec4 iA;       // render x, render z, vertex spacing, texture level
        attribute vec4 iB;       // grid level, force-morph, -, -
        varying vec3 vTerrPos;   // render-space position before the curvature drop (y = true height)
        uniform float uTerrCurv;
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
        if (ta < uTerrLod.z) {
          float tka = terrMorph(td / (uTerrLod.x * exp2(ta)));
          if (tka > 0.0) { vec4 tb = terrTexH(tpxz, ta + 1.0); th = mix(th, tb.x + tb.y, tka); }
        }
        vTerrPos = vec3(tpxz.x, th, tpxz.y);
        vec3 transformed = vec3(tpxz.x, th - uTerrCurv * curvatureDrop(distance(tpxz, uTerrCam.xz)), tpxz.y);
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        ${clipmapGLSL(L)}
        ${tileConsts}
        varying vec3 vTerrPos;
        ${COVER_GLSL}
        ${SURFACE_GLSL}
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
        reflectedLight.directDiffuse *= tSurf.shadow;
        reflectedLight.directSpecular *= tSurf.shadow;
      `);
  };
  mat.customProgramCacheKey = () => 'skyward-terrain-' + L + '-' + shadowSteps;
  return mat;
}
