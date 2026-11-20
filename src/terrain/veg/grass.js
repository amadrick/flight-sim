// Ground vegetation near the camera: instanced grass tufts (three alpha-tested cards each) on a camera-centred
// grid of 1 m cells. A small map pass decides per cell: meadow grass, mown airfield turf (short) or reeds (river banks),
// using the same land cover as the surface shader. Nothing grows on runways, taxiways or aprons: the pavement
// rectangles of the airport layouts near the camera are tested per cell (plus a margin), and the cropland, forest
// floor, desert, rock, snow, beach and water get none.
import * as THREE from 'three';
import { FULLSCREEN_VERT, fullscreenTriangle } from '../../core/glsl.js';
import { COVER_GLSL } from '../surface.glsl.js';
import { clipmapGLSL, TILE_CONSTS_GLSL } from '../material.js';
import { CELL_GLSL } from './placement.js';
import { vegVertexCommon, FRAG_DECL_GLSL } from './common.js';
import { tileRect } from './foliage.js';

const MAXR = 48;

export function createGrass(ctx, { L, Gg, cell = 1.0, uniforms, U }) {
  const renderer = ctx.renderer;
  const rt = new THREE.WebGLRenderTarget(Gg, Gg, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false, colorSpace: THREE.NoColorSpace,
  });
  const GU = {
    tVegGrass: { value: rt.texture },
    uVegGrassWin: { value: new THREE.Vector4(0, 0, Gg, cell) },      // xy = min cell (world index), z = Gg, w = cell size
    uVegGrassOrg: { value: new THREE.Vector2() },                     // world cell of the origin
    uVegPave: { value: Array.from({ length: MAXR }, () => new THREE.Vector4()) },     // centre (render xz), unit dir
    uVegPaveS: { value: Array.from({ length: MAXR }, () => new THREE.Vector2()) },    // half length, half width (0 = unused)
    uVegGrassOn: { value: 1 },
  };
  const mapMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: {
      tTerrH: uniforms.tTerrH, tTerrD: uniforms.tTerrD, tTerrNoise: uniforms.tTerrNoise, uTerrLvl: uniforms.uTerrLvl,
      uTerrCam: uniforms.uTerrCam, uTerrLod: uniforms.uTerrLod, uTerrTile: uniforms.uTerrTile, uTerrRw: uniforms.uTerrRw,
      uTerrRwL: uniforms.uTerrRwL, uOrigin: uniforms.uOrigin, uSunDir: uniforms.uSunDir, uTerrShadowOn: uniforms.uTerrShadowOn,
      tAirMap: uniforms.tAirMap, uAirMap: uniforms.uAirMap, uAirInfo: uniforms.uAirInfo,
      ...GU,
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */`
      precision highp float; precision highp int; precision highp sampler2DArray;
      out vec4 outColor;
      ${clipmapGLSL(L)}
      ${TILE_CONSTS_GLSL}
      ${COVER_GLSL}
      ${CELL_GLSL}
      uniform vec4 uVegGrassWin; uniform vec2 uVegGrassOrg;
      uniform vec4 uVegPave[${MAXR}]; uniform vec2 uVegPaveS[${MAXR}];
      void main() {
        vec2 cellI = uVegGrassWin.xy + floor(gl_FragCoord.xy);
        vec2 rxz = (cellI - uVegGrassOrg) * uVegGrassWin.w + (0.15 + 0.7 * vegHash(cellI + 3000.0)) * uVegGrassWin.w - mod(uOrigin.xz, uVegGrassWin.w);
        float d = terrLodDist(rxz);
        float lf = terrLevelAt(d);
        vec4 Gh = terrTexH(rxz, lf), D = terrTexD(rxz, lf);
        float h = Gh.x + Gh.y;
        vec3 n = terrDecodeN(D.xy);
        vec4 n0 = textureLod(tTerrNoise, terrUV(TERR_TILE0, uTerrTile[0], rxz), 0.0);
        vec4 n1 = textureLod(tTerrNoise, terrUV(TERR_TILE1, uTerrTile[1], rxz), 0.0);
        vec4 n2 = textureLod(tTerrNoise, terrUV(TERR_TILE2, uTerrTile[2], rxz), 0.0);
        vec4 n3 = textureLod(tTerrNoise, terrUV(TERR_TILE3, uTerrTile[3], rxz), 0.0);
        vec4 n4 = textureLod(tTerrNoise, terrUV(TERR_TILE4, uTerrTile[4], rxz), 0.0);
        float arid = min(Gh.z, 1.0), water = clamp(Gh.w, 0.0, 1.0), playa = clamp(-Gh.w, 0.0, 1.0);
        TerrCover C = terrCover(rxz, h, n, (D.z - 0.5) / 1.25, arid, water, n0, n1, n2, n3);
        float slope = 1.0 - n.y;
        float desertAmt = ss(0.42, 0.85, arid + 0.25 * (n1.r - 0.5) + 0.1 * (n3.r - 0.5));
        float alpine = ss(C.treeline - 150.0, C.treeline + 220.0, h);
        // pavement (runways, taxiways, aprons) + 4 m margin: nothing grows
        float pave = 1.0e6;
        for (int i = 0; i < ${MAXR}; i++) {
          if (uVegPaveS[i].x > 0.0) {
            vec2 q = rxz - uVegPave[i].xy;
            vec2 l = vec2(dot(q, uVegPave[i].zw), dot(q, vec2(-uVegPave[i].w, uVegPave[i].z)));
            vec2 e = abs(l) - uVegPaveS[i];
            pave = min(pave, length(max(e, 0.0)) + min(max(e.x, e.y), 0.0));
          }
        }
        float meadow = (1.0 - desertAmt) * (1.0 - ss(0.25, 0.55, slope)) * (1.0 - 0.9 * ss(0.3, 0.6, C.crop)) * (1.0 - playa)
                     * ss(2.5, 4.5, h) * (1.0 - ss(0.3, 0.6, water)) * (1.0 - 0.7 * alpine) * (1.0 - 0.75 * C.forest);
        float dens = meadow * ss(0.2, 0.7, n4.g * 0.6 + n3.r * 0.4 + 0.25) * ss(4.0, 12.0, pave);
        float hgt = mix(0.35, 0.75, n3.g) * (1.0 - 0.5 * alpine);
        float kind = 0.0;
        float turf = C.pad * (1.0 - desertAmt);
        if (turf > 0.5) {
          // airfield: the mown sward is the turf shells' (veg/turf.js); tufts only stand in the long-grass zones
          // (seed heads, docks, thistles), sparse, never on or right beside the pavement
          float dA = min(airMap(rxz).x, pave);
          float longZ = ss(60.0, 130.0, dA + 40.0 * (n2.r - 0.5));
          hgt = mix(0.22, 0.45, n4.r); kind = 1.0;
          dens = (1.0 - desertAmt) * ss(3.0, 8.0, dA) * longZ * (0.18 + 0.30 * n3.r);
        }
        float reedP = ss(0.03, 0.15, water) * (1.0 - ss(0.45, 0.6, water)) * (1.0 - C.pad);
        vec2 hh = vegHash(cellI + 5000.0);
        if (reedP > hh.y * 0.8) { hgt = mix(1.3, 2.1, n4.b); kind = 2.0; dens = reedP; }
        float dry = clamp(ss(0.08, 0.5, arid) + 0.5 * (n0.r - 0.5) + ss(1300.0, 2200.0, h) * 0.45, 0.0, 1.0);
        float exists = step(hh.x, dens);
        outColor = vec4(hgt * exists, kind, dry, n2.r * 0.6 + n1.g * 0.4);
      }`,
  });
  const tri = fullscreenTriangle();
  const mapScene = new THREE.Scene(), mapMesh = new THREE.Mesh(tri, mapMat), mapCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  mapMesh.frustumCulled = false; mapScene.add(mapMesh);

  // tuft: three cards at 60 degrees
  const geo = new THREE.InstancedBufferGeometry();
  const P = [], N = [], UV = [], I = [];
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI / 3, cx = Math.cos(a), cz = Math.sin(a), o = k * 4;
    for (const [sx, sy] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) { P.push(sx * 0.5 * cx, sy, sx * 0.5 * cz); N.push(0, 1, 0); UV.push(sx * 0.5 + 0.5, sy); }
    I.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(UV), 2));
  geo.setIndex(I);
  geo.instanceCount = Gg * Gg;
  const [g9x, g9y, gts] = tileRect(9), [r10x, r10y] = tileRect(10);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, GU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        ${vegVertexCommon(L)}
        uniform sampler2D tVegGrass; uniform vec4 uVegGrassWin; uniform vec2 uVegGrassOrg; uniform float uVegGrassOn;
        varying vec2 vGUv; varying vec4 vGM; varying vec2 vGFade; varying vec3 vVegWorld; varying float vGVar;`)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        float gG = uVegGrassWin.z;
        vec2 gij = vec2(float(gl_InstanceID % int(gG)), float(gl_InstanceID / int(gG)));
        vec4 gM = texelFetch(tVegGrass, ivec2(gij), 0);
        vec2 gCell = uVegGrassWin.xy + gij;
        vec2 gh = vegHash(gCell + 3000.0), gh2 = vegHash(gCell + 7000.0);
        vec2 gBase = (gCell - uVegGrassOrg) * uVegGrassWin.w + (0.15 + 0.7 * gh) * uVegGrassWin.w - mod(uOrigin.xz, uVegGrassWin.w);
        float gDist = distance(gBase, uTerrCam.xz);
        float gR = gG * uVegGrassWin.w * 0.5;
        float gH = gM.r * uVegGrassOn * (1.0 - smoothstep(gR * 0.55, gR * 0.95, gDist)) * mix(0.55, 1.35, gh2.x * gh2.x);
        float gAng = gh2.y * 6.2831853, gc = cos(gAng), gs = sin(gAng);
        float gW = gM.g > 1.5 ? 0.6 : (gM.g > 0.5 ? mix(1.1, 1.5, gh.y) : mix(0.6, 1.0, gh.y));
        vec3 gl = vec3(position.x * gW, position.y * gH, position.z * gW);
        gl.xz += vec2(0.6, 0.8) * (position.y * gH * 0.45);      // lean: seen from above the cards show their faces
        gl.xz = vec2(gc * gl.x - gs * gl.z, gs * gl.x + gc * gl.z);
        vec3 vegPos = vec3(gBase.x, vegGround(gBase) - 0.03, gBase.y) + gl;
        vegPos += vegWind(vegPos, position.y * position.y * 3.0, position.y * 0.3, max(gH, 0.3), gh.x);
        vegPos.y -= uTerrCurv * curvatureDrop(gDist);
        if (gH < 0.02) vegPos = vec3(0.0, -1.0e5, 0.0);
        vec3 objectNormal = normalize(vec3(gc * position.x * 0.0, 1.0, 0.0) + vec3(gs, 0.0, gc) * 0.15 * (uv.x - 0.5));
        float gTile = gM.g > 1.5 ? 1.0 : 0.0;
        vGUv = vec2(mix(${g9x.toFixed(4)}, ${r10x.toFixed(4)}, gTile) + (uv.x * (gM.g > 0.5 && gM.g < 1.5 ? 0.7 : 0.9) + 0.05 * gh.x) * ${gts.toFixed(4)},
                    mix(${g9y.toFixed(4)}, ${r10y.toFixed(4)}, gTile) + (1.0 - uv.y * 0.98) * ${gts.toFixed(4)});
        vGM = gM; vGM.w = gh2.x; vGFade = vec2(gDist / gR, uv.y);
        vVegWorld = vegPos;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vegPos;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tVegFoliage;
        varying vec2 vGUv; varying vec4 vGM; varying vec2 vGFade; varying vec3 vVegWorld;`)
      .replace('#include <map_fragment>', /* glsl */`
        vec4 fo = texture(tVegFoliage, vGUv);
        vec2 dx = dFdx(vGUv * 1024.0), dy = dFdy(vGUv * 1024.0);
        fo.a *= 1.0 + 0.3 * max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
        if (fo.a < 0.5) discard;
        // the surface shader's grass colours (meadow / turf / reeds), slightly brighter toward the tips
        vec3 gc = mix(vec3(0.046, 0.082, 0.024), vec3(0.092, 0.128, 0.042), vGM.a);
        gc = mix(gc, mix(vec3(0.235, 0.200, 0.095), vec3(0.175, 0.160, 0.075), vGM.a), vGM.b);
        if (vGM.g > 0.5 && vGM.g < 1.5) gc = mix(vec3(0.062, 0.105, 0.034), vec3(0.150, 0.135, 0.075), 0.45 * vGM.a + 0.2) * (0.9 + 0.2 * vGM.a);
        if (vGM.g > 1.5) gc = vec3(0.080, 0.100, 0.040);
        gc *= (0.5 + 0.8 * fo.r) * mix(vec3(1.0), vec3(1.5, 1.25, 0.7), fo.g * 0.5) * mix(0.8, 1.08, vGFade.y);
        gc *= 0.8 + 0.4 * vGM.w;      // per-tuft variation
        diffuseColor.rgb = gc;`)
      .replace('#include <normal_fragment_maps>', 'normal = normalize(vNormal);');
  };
  mat.customProgramCacheKey = () => 'skyward-veg-grass';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'veg-grass'; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  mesh.castShadow = false; mesh.receiveShadow = true;

  // pavement rectangles from the airport layouts (scenery) near the camera
  let rects = null, lastX = 1e18, lastZ = 1e18;
  const near = [];
  function collect() {
    const sc = ctx.scenery;
    if (!sc || !sc.airports) return null;
    const out = [];
    for (const ap of sc.airports) {
      const pos = ap.data?.position, pave = ap.layout?.pave;
      if (!pos || !pave) continue;
      for (const r of pave) {
        if (!r.surf) continue;
        const h = r.hdg * Math.PI / 180;
        out.push({ x: pos.x + r.x, z: pos.z + r.z, dx: Math.sin(h), dz: -Math.cos(h), hl: r.len / 2, hw: r.wid / 2 });
      }
    }
    return out;
  }
  return {
    mesh, uniforms: GU, Gg,
    /** debug: grass map as base64 RGBA8 (height*255, kind*80, dry*255, 255) */
    read() {
      const buf = new Uint16Array(Gg * Gg * 4); ctx.renderer.readRenderTargetPixels(rt, 0, 0, Gg, Gg, buf);
      const out = new Uint8Array(Gg * Gg * 4);
      for (let i = 0; i < Gg * Gg; i++) { out[i * 4] = Math.min(255, THREE.DataUtils.fromHalfFloat(buf[i * 4]) * 255); out[i * 4 + 1] = THREE.DataUtils.fromHalfFloat(buf[i * 4 + 1]) * 80; out[i * 4 + 2] = THREE.DataUtils.fromHalfFloat(buf[i * 4 + 2]) * 255; out[i * 4 + 3] = 255; }
      let str = ''; for (let i = 0; i < out.length; i += 8192) str += String.fromCharCode.apply(null, out.subarray(i, i + 8192));
      return JSON.stringify({ w: Gg, h: Gg, b64: btoa(str), visible: mesh.visible, rects: near.length });
    },
    update(camWX, camWZ, org, agl) {
      const on = agl < 150;
      mesh.visible = on;
      if (!on) return;
      if (!rects) rects = collect();
      if (rects && (Math.abs(camWX - lastX) > 60 || Math.abs(camWZ - lastZ) > 60)) {
        lastX = camWX; lastZ = camWZ;
        near.length = 0;
        const R = Gg * cell;
        for (const r of rects) {
          const d = Math.hypot(r.x - camWX, r.z - camWZ) - Math.hypot(r.hl, r.hw);
          if (d < R + 80) near.push([d, r]);
        }
        near.sort((a, b) => a[0] - b[0]);
        for (let i = 0; i < MAXR; i++) {
          const r = near[i]?.[1];
          GU.uVegPaveS.value[i].set(r ? r.hl : 0, r ? r.hw : 0);
        }
      }
      for (let i = 0; i < MAXR; i++) {
        const r = near[i]?.[1];
        if (r) GU.uVegPave.value[i].set(r.x - org.x, r.z - org.z, r.dx, r.dz);
      }
      const cx = Math.floor(camWX / cell) - (Gg >> 1), cz = Math.floor(camWZ / cell) - (Gg >> 1);
      GU.uVegGrassWin.value.set(cx, cz, Gg, cell);
      GU.uVegGrassOrg.value.set(Math.floor(org.x / cell), Math.floor(org.z / cell));
      const prev = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(rt);
      renderer.render(mapScene, mapCam);
      renderer.setRenderTarget(prev); renderer.autoClear = prevAuto;
    },
    dispose() { rt.dispose(); mapMat.dispose(); tri.dispose(); geo.dispose(); mat.dispose(); },
  };
}
