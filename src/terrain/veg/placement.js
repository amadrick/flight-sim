// Where every tree and shrub stands: a camera-centred, TOROIDAL G x G map of 6.5 m world cells evaluated on the GPU
// with the surface shader's own land-cover function (terrCover in surface.glsl.js), so 3-D trees stand exactly where
// the surface paints forest. A cell's content depends only on its world position (stable hash, cover evaluated on a
// FIXED clipmap level), so cells are written once when they enter the window, plus a slow rolling refresh (terrain
// shadow follows the sun). Ground heights are NOT stored: the instanced vertex shaders read them from the clipmap at
// the terrain mesh's own LOD, so trees always sit on the rendered ground.
//
// Texel (i mod G, j mod G) holds world cell (i, j):  R = tree height (m, 0 = none), G = species index,
// B = terrain shadow toward the sun (0..1), A = forest cover (stand density 0..1, network input)
import * as THREE from 'three';
import { FULLSCREEN_VERT, fullscreenTriangle } from '../../core/glsl.js';
import { COVER_GLSL } from '../surface.glsl.js';
import { clipmapGLSL, TILE_CONSTS_GLSL } from '../material.js';
import { SPECIES, SPECIES_INDEX as S, TREE_CELL } from './species.js';

const H = (id) => `vec2(${SPECIES[S[id]].h[0].toFixed(1)}, ${SPECIES[S[id]].h[1].toFixed(1)})`;

/** GLSL shared by the map pass and the instanced shaders: world-cell hashing. */
export const CELL_GLSL = /* glsl */`
vec2 vegHash(vec2 p) {
  uvec2 q = uvec2(ivec2(p));
  uint h = q.x * 0x8da6b343u + q.y * 0xd8163841u + 0x9e3779b9u;
  h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
  return vec2(float(h & 0xffffu), float(h >> 16)) / 65536.0;
}
// world cell index (integer-valued vec2) -> tree base, world xz (jittered inside the cell). Hash input wraps at 2^20
// cells (6800 km) which is far beyond the world.
vec2 vegCellLocal(vec2 cell) { return (0.12 + 0.76 * vegHash(cell + 20000.0)) * ${TREE_CELL.toFixed(2)}; }
`;

export function createPlacement(ctx, { L, G, uniforms, level = 4 }) {
  const renderer = ctx.renderer;
  const rt = new THREE.WebGLRenderTarget(G, G, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false, colorSpace: THREE.NoColorSpace,
  });
  const U = {
    uVegWin: { value: new THREE.Vector4() },          // xy = window min cell (world index), z = G
    uVegCellOrg: { value: new THREE.Vector2() },      // world xz of the render origin (doubles -> split below)
    uVegLevel: { value: level },
  };
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: {
      tTerrH: uniforms.tTerrH, tTerrD: uniforms.tTerrD, tTerrNoise: uniforms.tTerrNoise, uTerrLvl: uniforms.uTerrLvl,
      uTerrCam: uniforms.uTerrCam, uTerrLod: uniforms.uTerrLod, uTerrTile: uniforms.uTerrTile, uTerrRw: uniforms.uTerrRw,
      uTerrRwL: uniforms.uTerrRwL, uOrigin: uniforms.uOrigin, uSunDir: uniforms.uSunDir, uTerrShadowOn: uniforms.uTerrShadowOn,
      tAirMap: uniforms.tAirMap, uAirMap: uniforms.uAirMap, uAirInfo: uniforms.uAirInfo,
      ...(uniforms.tSetGrid ? { tSetGrid: uniforms.tSetGrid, tSetSeg: uniforms.tSetSeg, tSetTown: uniforms.tSetTown, uSetOrg: uniforms.uSetOrg, uSetOn: uniforms.uSetOn } : {}),
      ...U,
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */`
      precision highp float; precision highp int; precision highp sampler2DArray;
      out vec4 outColor;
      ${clipmapGLSL(L)}
      ${TILE_CONSTS_GLSL}
      ${COVER_GLSL}
      ${CELL_GLSL}
      uniform vec4 uVegWin; uniform vec2 uVegCellOrg; uniform float uVegLevel;
      float pick(float u, vec4 w) { return u < w.x ? 0.0 : u < w.x + w.y ? 1.0 : u < w.x + w.y + w.z ? 2.0 : 3.0; }
      void main() {
        vec2 t = floor(gl_FragCoord.xy);
        vec2 cell = uVegWin.xy + mod(t - mod(uVegWin.xy, uVegWin.z) + uVegWin.z, uVegWin.z);
        // render-space xz of the tree (cell corner relative to the origin cell, computed in small numbers)
        vec2 rxz = (cell - uVegCellOrg) * ${TREE_CELL.toFixed(2)} + vegCellLocal(cell) - mod(uOrigin.xz, ${TREE_CELL.toFixed(2)});
        vec2 hs = vegHash(cell + 40000.0), h2 = vegHash(cell + 70000.0);
        float lf = max(uVegLevel, uTerrLod.y);
        vec4 Gh = terrTexH(rxz, lf), D = terrTexD(rxz, lf);
        float h = Gh.x + Gh.y;
        vec3 n = terrDecodeN(D.xy);
        vec4 n0 = textureLod(tTerrNoise, terrUV(TERR_TILE0, uTerrTile[0], rxz), 0.0);
        vec4 n1 = textureLod(tTerrNoise, terrUV(TERR_TILE1, uTerrTile[1], rxz), 0.0);
        vec4 n2 = textureLod(tTerrNoise, terrUV(TERR_TILE2, uTerrTile[2], rxz), 0.0);
        vec4 n3 = textureLod(tTerrNoise, terrUV(TERR_TILE3, uTerrTile[3], rxz), 0.0);
        float arid = min(Gh.z, 1.0), dune = clamp(Gh.z - 1.0, 0.0, 1.0), water = clamp(Gh.w, 0.0, 1.0), playa = clamp(-Gh.w, 0.0, 1.0);
        TerrCover C = terrCover(rxz, h, n, (D.z - 0.5) / 1.25, arid, water, n0, n1, n2, n3);
        float slope = 1.0 - n.y;
        float desertAmt = ss(0.42, 0.85, arid + 0.25 * (n1.r - 0.5) + 0.1 * (n3.r - 0.5));
        float pForest = clamp(C.forest * 1.1 - 0.05, 0.0, 1.0);
        float open = (1.0 - C.pad) * (1.0 - water) * (1.0 - playa) * ss(1.5, 4.0, h) * (1.0 - ss(0.3, 0.55, slope));
        float belowTL = ss(C.treeline + 60.0, C.treeline - 260.0, h);
        // solitary trees and bushes in open country (more along creeks and on rough ground), shrubs in the drylands
        float pSolo = open * (1.0 - desertAmt) * belowTL * (0.0012 + 0.010 * ss(0.55, 0.8, n2.g) + 0.10 * C.forest) * (1.0 - C.crop) * (1.0 + 2.5 * C.tropic);   // scattered palms all over tropical lowlands
        float pBush = open * (1.0 - desertAmt) * belowTL * (0.002 + 0.012 * ss(0.6, 0.85, n3.g) + 0.15 * C.forest) * (1.0 - C.crop) + open * ss(0.2, 0.45, arid) * (1.0 - desertAmt) * 0.08;
        // drylands: creosote / sage in loose drifts, denser along the runnels, almost none on moving dune sand
        float pShrub = open * desertAmt * (0.025 + 0.24 * ss(0.42, 0.78, n2.g * 0.6 + n1.r * 0.4) + 6.0 * max((D.z - 0.5) / 1.25, 0.0)) * (1.0 - 0.96 * dune);
        float u = hs.x, sp = -1.0, size = 0.0;
        vec2 hr = vec2(0.0);
        float u2 = fract(hs.x * 61.0 + hs.y * 17.0), u3 = h2.x, u4 = h2.y;
        if (u < pForest) {
          if (C.tropic > 0.5) {
            sp = u3 < 0.3 + 0.45 * ss(40.0, 5.0, h) + 0.25 * (1.0 - ss(0.3, 0.9, C.forest)) ? ${S.palm}.0 : ${S.tropic}.0;   // palms: coasts, edges, open stands
          } else if (u2 < C.conifer) {
            float pineW = 0.22 + 0.5 * ss(0.12, 0.4, arid);
            sp = pick(u3, vec4((1.0 - pineW) * 0.62, (1.0 - pineW) * 0.38, pineW, 0.0)) ;   // spruce, fir, pine
          } else {
            float dry = ss(0.22, 0.45, arid);
            float p = pick(u3, vec4(0.36 + 0.2 * dry, 0.34 - 0.25 * dry, 0.20, 0.10));
            sp = p < 0.5 ? ${S.oak}.0 : p < 1.5 ? ${S.beech}.0 : p < 2.5 ? ${S.birch}.0 : ${S.poplar}.0;
            if (dry > 0.6 && u4 < 0.4) sp = ${S.scrub}.0;
          }
        } else if (u < pForest + pSolo) {
          sp = C.tropic > 0.5 ? (u3 < 0.6 ? ${S.palm}.0 : ${S.tropic}.0) : (u3 < 0.45 ? ${S.oak}.0 : u3 < 0.7 ? ${S.beech}.0 : u3 < 0.85 ? ${S.poplar}.0 : ${S.pine}.0);
        } else if (u < pForest + pSolo + pBush) {
          sp = ss(0.2, 0.45, arid) > u3 ? ${S.scrub}.0 : ${S.bush}.0;
        } else if (u < pForest + pSolo + pBush + pShrub) {
          sp = u3 < 0.8 ? ${S.desert}.0 : ${S.scrub}.0;
        }
        if (sp >= 0.0) {
          int si = int(sp);
          ${SPECIES.map((s, i) => `if (si == ${i}) hr = ${H(s.id)};`).join(' ')}
          size = mix(hr.x, hr.y, u4 * u4 * 0.5 + u4 * 0.5);
          if (sp < ${S.scrub}.0) {
            size *= mix(0.45, 1.0, ss(C.treeline + 60.0, C.treeline - 320.0, h));       // stunted near the tree line
            size *= 0.78 + 0.22 * ss(0.3, 1.0, C.forest);                              // smaller at the forest edge
          }
        }
        float sh = size > 0.0 ? terrShadow(vec3(rxz.x, h + size * 0.6, rxz.y), vec3(0.0, 1.0, 0.0), lf, 8) : 1.0;
        outColor = vec4(size, max(sp, 0.0), clamp(sh, 0.0, 1.0), max(pForest, size > 0.0 ? 0.15 : 0.0));
      }`,
  });
  const tri = fullscreenTriangle();
  const scene = new THREE.Scene(), mesh = new THREE.Mesh(tri, mat), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  mesh.frustumCulled = false; scene.add(mesh);

  let wx0 = null, wz0 = null, roll = 0, valid = false;
  const BAND = Math.max(4, Math.ceil(G / 24));
  const rects = [];
  const mod = (a) => ((a % G) + G) % G;
  function addRows(z0, n) {     // world rows z0 .. z0+n-1 (full width)
    if (n >= G) { rects.push([0, 0, G, G]); return; }
    const a = mod(z0), b = a + n;
    if (b <= G) rects.push([0, a, G, n]); else { rects.push([0, a, G, G - a]); rects.push([0, 0, G, b - G]); }
  }
  function addCols(x0, n) {
    if (n >= G) { rects.push([0, 0, G, G]); return; }
    const a = mod(x0), b = a + n;
    if (b <= G) rects.push([a, 0, n, G]); else { rects.push([a, 0, G - a, G]); rects.push([0, 0, b - G, G]); }
  }
  return {
    texture: rt.texture, uniforms: U, G, texelsLastUpdate: 0,
    /** Returns true when the window has data. camWX/camWZ world camera position. */
    update(camWX, camWZ, org, force) {
      const nx0 = Math.floor(camWX / TREE_CELL) - (G >> 1), nz0 = Math.floor(camWZ / TREE_CELL) - (G >> 1);
      rects.length = 0;
      if (!valid || force || wx0 === null) { rects.push([0, 0, G, G]); }
      else {
        const dx = nx0 - wx0, dz = nz0 - wz0;
        if (dx > 0) addCols(wx0 + G, dx); else if (dx < 0) addCols(nx0, -dx);
        if (dz > 0) addRows(wz0 + G, dz); else if (dz < 0) addRows(nz0, -dz);
        addRows(nz0 + roll, BAND);             // rolling refresh (sun-dependent terrain shadow)
        roll = (roll + BAND) % G;
      }
      wx0 = nx0; wz0 = nz0; valid = true;
      U.uVegWin.value.set(nx0, nz0, G, 0);
      U.uVegCellOrg.value.set(Math.floor(org.x / TREE_CELL), Math.floor(org.z / TREE_CELL));
      const prev = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevSc = renderer.getScissorTest();
      renderer.autoClear = false;
      let tex = 0;
      for (const [x, y, w, h] of rects) {
        rt.viewport.set(x, y, w, h); rt.scissor.set(x, y, w, h); rt.scissorTest = true;
        renderer.setRenderTarget(rt);
        renderer.render(scene, cam);
        tex += w * h;
      }
      rt.viewport.set(0, 0, G, G); rt.scissor.set(0, 0, G, G); rt.scissorTest = false;
      renderer.setRenderTarget(prev); renderer.autoClear = prevAuto; renderer.setScissorTest(prevSc);
      this.texelsLastUpdate = tex;
      return true;
    },
    invalidate() { valid = false; },
    dispose() { rt.dispose(); mat.dispose(); tri.dispose(); },
  };
}
