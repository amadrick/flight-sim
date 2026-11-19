// 3D trees near the camera. One instanced draw call of low-poly crowns on a camera-centred grid of G x G cells.
// Where a tree stands is decided on the GPU with the SAME land-cover function the surface shader paints forests with
// (terrCover in surface.glsl.js), so the 3D trees and the painted canopy further out always agree:
//   pass 1 (G x G fragments / frame): per cell -> ground height, tree height (0 = none), species, terrain shadow
//   pass 2: instanced crowns read their cell with one texelFetch; cells without a tree collapse to nothing.
// Cells are indexed in world space (stable hash => a tree never moves or changes when the camera or origin does).
import * as THREE from 'three';
import { CURVATURE_GLSL, FULLSCREEN_VERT, fullscreenTriangle } from '../core/glsl.js';
import { COVER_GLSL } from './surface.glsl.js';
import { clipmapGLSL, TILE_CONSTS_GLSL } from './material.js';

const SEG = 6;           // sides of a crown
// crown profiles (t = height fraction, r = radius fraction of the tree height): 3 rings + apex = 30 triangles
const CONIFER = [[0.03, 0.235], [0.47, 0.080], [0.44, 0.180], [1.0, 0.0]];      // two tiers of boughs
const BROADLEAF = [[0.0, 0.030], [0.46, 0.40], [0.80, 0.30], [1.0, 0.0]];       // trunk flaring into a round crown

function profileNormals(prof) {
  // smooth lathe normals: (radial, vertical) per ring, from the neighbouring profile points
  return prof.map((p, i) => {
    const a = prof[Math.max(i - 1, 0)], b = prof[Math.min(i + 1, prof.length - 1)];
    const dt = b[0] - a[0], dr = b[1] - a[1];
    let nr = dt, ny = -dr;                         // perpendicular to the profile tangent, pointing outward
    if (i === prof.length - 1) { nr = 0.3; ny = 1; }
    const l = Math.hypot(nr, ny) || 1;
    return [ny / l, nr / l];
  });
}

function crownGeometry() {
  const rings = CONIFER.length - 1, nv = rings * SEG + 1;
  const pos = new Float32Array(nv * 3), A = new Float32Array(nv * 4), Nn = new Float32Array(nv * 4);
  const nC = profileNormals(CONIFER), nB = profileNormals(BROADLEAF);
  for (let r = 0; r <= rings; r++) {
    const count = r === rings ? 1 : SEG;
    for (let s = 0; s < count; s++) {
      const v = r * SEG + s, a = (s + 0.5 * (r & 1)) / SEG * Math.PI * 2;     // alternate rings are twisted
      pos[v * 3] = Math.cos(a); pos[v * 3 + 1] = 0; pos[v * 3 + 2] = Math.sin(a);
      A.set([CONIFER[r][0], CONIFER[r][1], BROADLEAF[r][0], BROADLEAF[r][1]], v * 4);
      Nn.set([nC[r][0], nC[r][1], nB[r][0], nB[r][1]], v * 4);
    }
  }
  const idx = [];
  for (let r = 0; r < rings - 1; r++) for (let s = 0; s < SEG; s++) {
    const a = r * SEG + s, b = r * SEG + (s + 1) % SEG, c = a + SEG, d = b + SEG;
    // twisted rings: choose the diagonal that keeps the strip convex
    if (r & 1) idx.push(a, c, d, a, d, b); else idx.push(a, c, b, b, c, d);
  }
  const apex = rings * SEG;
  for (let s = 0; s < SEG; s++) idx.push((rings - 1) * SEG + s, apex, (rings - 1) * SEG + (s + 1) % SEG);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // (a normal attribute must exist or three falls back to flat shading; the real normal is built in the vertex shader)
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3).fill(1), 3));
  g.setAttribute('aTreeA', new THREE.BufferAttribute(A, 4));
  g.setAttribute('aTreeN', new THREE.BufferAttribute(Nn, 4));
  g.setIndex(idx);
  return { geometry: g, triangles: idx.length / 3 };
}

const TREE_COMMON = /* glsl */`
uniform highp sampler2D tTreeMap;
uniform highp vec2 uTreeCell;    // world cell index of map texel (0, 0)
uniform highp vec2 uTreeBase;    // render-space xz of that cell's corner
uniform highp vec4 uTreeGrid;    // x = cell size (m), y = cells per side
uniform highp vec4 uTerrTree;    // x = on (0..1), y = full radius, z = end radius
vec2 treeHash(vec2 p) {
  uvec2 q = uvec2(ivec2(p));
  uint h = q.x * 0x8da6b343u + q.y * 0xd8163841u + 0x9e3779b9u;
  h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
  return vec2(float(h & 0xffffu), float(h >> 16)) / 65536.0;
}
vec2 treeXZ(vec2 ij) { return uTreeBase + (ij + 0.12 + 0.76 * treeHash(uTreeCell + ij + 20000.0)) * uTreeGrid.x; }
`;

export function createTrees(ctx, { L, G, cell, uniforms }) {
  const renderer = ctx.renderer;
  const rt = new THREE.WebGLRenderTarget(G, G, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false, colorSpace: THREE.NoColorSpace,
  });
  const R = G * cell * 0.5;
  const U = {
    tTreeMap: { value: rt.texture },
    uTreeCell: { value: new THREE.Vector2() }, uTreeBase: { value: new THREE.Vector2() },
    uTreeGrid: { value: new THREE.Vector4(cell, G, 0, 0) },
    uTerrTree: uniforms.uTerrTree,
  };
  uniforms.uTerrTree.value.set(0, R * 0.70, R * 0.96, 0);

  // ---- pass 1: where the trees are ------------------------------------------------------------------------------
  const mapMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: {
      tTerrH: uniforms.tTerrH, tTerrD: uniforms.tTerrD, tTerrNoise: uniforms.tTerrNoise, uTerrLvl: uniforms.uTerrLvl,
      uTerrCam: uniforms.uTerrCam, uTerrLod: uniforms.uTerrLod, uTerrTile: uniforms.uTerrTile, uTerrRw: uniforms.uTerrRw,
      uTerrRwL: uniforms.uTerrRwL, uOrigin: uniforms.uOrigin, uSunDir: uniforms.uSunDir, uTerrShadowOn: uniforms.uTerrShadowOn,
      ...U,
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */`
      precision highp float; precision highp int; precision highp sampler2DArray;
      out vec4 outColor;
      ${clipmapGLSL(L)}
      ${TILE_CONSTS_GLSL}
      ${COVER_GLSL}
      ${TREE_COMMON}
      void main() {
        vec2 ij = floor(gl_FragCoord.xy);
        vec2 rxz = treeXZ(ij);
        vec2 hs = treeHash(uTreeCell + ij + 40000.0);
        float d = terrLodDist(rxz);
        float lf = terrLevelAt(d);
        vec4 Gh = terrTexH(rxz, lf), D = terrTexD(rxz, lf);
        if (lf < uTerrLod.z) {
          float kb = terrMorph(d / (uTerrLod.x * exp2(lf)));
          if (kb > 0.0) { Gh = mix(Gh, terrTexH(rxz, lf + 1.0), kb); D = mix(D, terrTexD(rxz, lf + 1.0), kb); }
        }
        float h = Gh.x + Gh.y;
        vec3 n = terrDecodeN(D.xy);
        vec4 n0 = textureLod(tTerrNoise, terrUV(TERR_TILE0, uTerrTile[0], rxz), 0.0);
        vec4 n1 = textureLod(tTerrNoise, terrUV(TERR_TILE1, uTerrTile[1], rxz), 0.0);
        vec4 n2 = textureLod(tTerrNoise, terrUV(TERR_TILE2, uTerrTile[2], rxz), 0.0);
        vec4 n3 = textureLod(tTerrNoise, terrUV(TERR_TILE3, uTerrTile[3], rxz), 0.0);
        TerrCover C = terrCover(rxz, h, n, (D.z - 0.5) / 1.25, Gh.z, clamp(Gh.w, 0.0, 1.0), n0, n1, n2, n3);
        float exists = step(hs.x, C.forest * 1.1 - 0.05);
        float conif = step(fract(hs.x * 61.0 + hs.y * 17.0), C.conifer);
        float size = mix(mix(8.5, 17.0, hs.y), mix(13.0, 27.0, hs.y * hs.y + 0.25 * hs.y), conif);
        size *= mix(0.4, 1.0, ss(C.treeline + 60.0, C.treeline - 320.0, h));       // stunted near the tree line
        size *= mix(1.0, 0.8, C.tropic) * (0.75 + 0.25 * ss(0.3, 1.0, C.forest));
        size *= exists;
        float sh = size > 0.0 ? terrShadow(vec3(rxz.x, h + size * 0.6, rxz.y), vec3(0.0, 1.0, 0.0), lf, 10) : 1.0;
        float hi = floor(h * 0.25 + 0.5) * 4.0;
        outColor = vec4(hi, h - hi, size, conif + clamp(sh, 0.0, 1.0) * 0.9);
      }`,
  });
  const tri = fullscreenTriangle();
  const mapScene = new THREE.Scene(), mapMesh = new THREE.Mesh(tri, mapMat), mapCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  mapMesh.frustumCulled = false; mapScene.add(mapMesh);

  // ---- pass 2: the crowns -----------------------------------------------------------------------------------------
  const { geometry, triangles } = crownGeometry();
  geometry.instanceCount = G * G;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, { uTerrCam: uniforms.uTerrCam, uTerrCurv: uniforms.uTerrCurv, uOrigin: uniforms.uOrigin });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`#include <common>
        ${CURVATURE_GLSL}
        ${TREE_COMMON}
        uniform highp vec4 uTerrCam; uniform float uTerrCurv; uniform vec3 uOrigin;
        attribute vec4 aTreeA; attribute vec4 aTreeN;
        varying vec3 vTreeCol; varying vec2 vTreeLit;
      `)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        float tG = uTreeGrid.y;
        vec2 tij = vec2(float(gl_InstanceID % int(tG)), float(gl_InstanceID / int(tG)));
        vec4 tM = texelFetch(tTreeMap, ivec2(tij), 0);
        vec2 tBase = treeXZ(tij);
        vec2 tH3 = treeHash(uTreeCell + tij + 60000.0);
        float tDist = distance(tBase, uTerrCam.xz);
        float tSize = tM.z * uTerrTree.x * (1.0 - smoothstep(uTerrTree.y, uTerrTree.z, tDist));
        float tConif = step(0.95, tM.w);
        float tShadow = fract(tM.w) / 0.9;
        vec4 tProf = tConif > 0.5 ? vec4(aTreeA.xy, aTreeN.xy) : vec4(aTreeA.zw, aTreeN.zw);
        float tAng = tH3.x * 6.2831853, tc = cos(tAng), ts = sin(tAng);
        vec2 tDir = vec2(tc * position.x - ts * position.z, ts * position.x + tc * position.z);
        float tWide = mix(0.82, 1.22, tH3.y) * mix(1.0, 1.0 + 0.5 * (treeHash(uTreeCell + tij + float(gl_VertexID) * 7.0).x - 0.5), 1.0 - tConif);
        vec3 tLocal = vec3(tDir.x * tProf.y * tWide, tProf.x, tDir.y * tProf.y * tWide) * tSize;
        vec3 tPos = vec3(tBase.x, tM.x + tM.y - 0.4, tBase.y) + tLocal;
        tPos.y -= uTerrCurv * curvatureDrop(tDist);
        // soft foliage normal: lathe normal bent upward
        vec3 objectNormal = normalize(vec3(tDir.x * tProf.w, tProf.z + mix(1.0, 0.45, tConif), tDir.y * tProf.w));
        // colour: species, per-tree variety, darker inside / low in the canopy
        float tTropic = smoothstep(35.0, 70.0, (tBase.y + uOrigin.z) * 0.001);
        vec3 tCol = mix(vec3(0.050, 0.086, 0.030), vec3(0.030, 0.053, 0.026), tConif);
        tCol = mix(tCol, tCol * vec3(1.40, 1.22, 0.85), smoothstep(0.55, 1.0, tH3.y) * (1.0 - tConif) * 0.7);
        tCol = mix(tCol, vec3(0.036, 0.062, 0.020), tTropic * 0.5 * (1.0 - tConif));
        tCol *= 0.80 + 0.45 * tH3.x;
        float tUp = smoothstep(0.08, 0.95, tProf.x);
        vTreeCol = tCol * mix(0.95, 2.1, tConif);
        float tLow = mix(0.30, 0.42, tConif);
        vTreeLit = vec2(tShadow * mix(tLow, 1.0, tUp), mix(tLow + 0.05, 1.0, tUp));
      `)
      .replace('#include <begin_vertex>', 'vec3 transformed = tPos;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTreeCol; varying vec2 vTreeLit;')
      .replace('#include <map_fragment>', 'diffuseColor.rgb = vTreeCol;')
      .replace('#include <aomap_fragment>', /* glsl */`
        reflectedLight.indirectDiffuse *= vTreeLit.y;
        reflectedLight.indirectSpecular *= vTreeLit.y * vTreeLit.y;
        reflectedLight.directDiffuse *= vTreeLit.x;
        reflectedLight.directSpecular *= vTreeLit.x;
      `);
  };
  mat.customProgramCacheKey = () => 'skyward-terrain-trees';
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = 'terrain-trees'; mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false;
  mesh.matrixAutoUpdate = false; mesh.visible = false;

  return {
    object3D: mesh,
    triangles: G * G * triangles,
    radius: R,
    /** camWX/camWZ: camera world position; org: world origin; Hd: camera clearance above the ground. */
    update(camWX, camWZ, org, Hd, minLevel) {
      // only worth drawing low down, and only once the fine clipmap levels exist
      const on = minLevel <= 3 ? 1 - Math.min(Math.max((Hd - 650) / 250, 0), 1) : 0;
      uniforms.uTerrTree.value.x = on;
      mesh.visible = on > 0;
      if (!mesh.visible) return;
      const cx = Math.floor(camWX / cell) - (G >> 1), cz = Math.floor(camWZ / cell) - (G >> 1);
      U.uTreeCell.value.set(cx, cz);
      U.uTreeBase.value.set(cx * cell - org.x, cz * cell - org.z);
      const prev = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(rt);
      renderer.render(mapScene, mapCam);
      renderer.setRenderTarget(prev); renderer.autoClear = prevAuto;
    },
    dispose() { rt.dispose(); mapMat.dispose(); mat.dispose(); geometry.dispose(); tri.dispose(); uniforms.uTerrTree.value.x = 0; },
  };
}
