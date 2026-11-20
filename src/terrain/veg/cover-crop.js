// Near-field crops: real plants in the farm fields around a low camera, so a field edge seen from eye height has a
// standing crop with height (wheat with its ears, maize taller than a man, flowering rape, beet leaves, straw
// stubble, long grass in a hay field) instead of a painted floor.
//
// One instanced draw: an instance is one plant (a clump of NB ribbons: stalks, leaves, ears, petals) on two
// world-anchored jittered grids around the camera (fine inside R0, coarser to R1). The crop class, height, cover
// and the row direction of the field come from the grass map (grass.js: kind 3 + class / 10, r = height, b = row
// angle / pi, a = cover), which evaluates the same land cover and parcel layout as the ground shader, so the plants
// stand where the ground paints that crop. Plants are snapped onto drill rows across the field's row direction
// (12.5 cm cereal, 25 cm rape, 50 cm beet, 75 cm maize) and thinned to the crop's plant density; they thin out
// (dithered by hash: nothing pops) toward R1, where the painted field carries on.
//
// Shading: MeshStandardMaterial (engine sun, sky, IBL, shadows received) with occlusion inside the canopy (darker
// toward the ground, more in dense crops), light transmitted through leaves toward the viewer with the sun behind,
// and a weak sheen. Colours match the field shader's (terrFieldColor) so the hand-over is seamless.
//
// Cost: medium R0 5 m / R1 16 m (~18 k plants), high 6 / 20, ultra 8 / 26; NB = 6 ribbons x 5 triangles; one draw call,
// only below ~40 m above the ground and where the grass map exists (medium and up); per vertex 1 map texel fetch
// + 2 clipmap fetches. cropPlants=0 turns it off.
import * as THREE from 'three';
import { vegVertexCommon } from './common.js';
import { tuftGeometry } from './blades.js';

export const CROP_TIERS = {
  low: null,
  medium: { R0: 5, s0: 0.12, R1: 16, s1: 0.30 },
  high: { R0: 6, s0: 0.11, R1: 20, s1: 0.30 },
  ultra: { R0: 8, s0: 0.10, R1: 26, s1: 0.28 },
};
const NB = 6;
const HM = 4096;

export function createCropPlants(ctx, { L, tier, uniforms }) {
  const { R0, s0, R1, s1 } = tier;
  const G0 = Math.ceil(2 * R0 / s0) + 1, G1 = Math.ceil(2 * R1 / s1) + 1;
  const n0 = G0 * G0, n1 = G1 * G1;
  const F = ctx.uniforms.frame;
  const CU = {
    tTerrH: uniforms.tTerrH, uTerrLvl: uniforms.uTerrLvl, uTerrCam: uniforms.uTerrCam, uTerrLod: uniforms.uTerrLod,
    uTerrCurv: uniforms.uTerrCurv, uOrigin: F.uOrigin, uTime: F.uTime, uSunDir: F.uSunDir, uSunColor: F.uSunColor,
    tVegGrass: uniforms.tVegGrass, uVegGrassWin: uniforms.uVegGrassWin, uVegGrassOrg: uniforms.uVegGrassOrg,
    uVegWind: { value: new THREE.Vector4(1, 0, 0.3, 0.2) },
    uCrGrid0: { value: new THREE.Vector4() }, uCrGrid1: { value: new THREE.Vector4() },
    uCrRing: { value: new THREE.Vector4(R0, R1, s0, s1) }, uCrPix: { value: 0.001 },
  };
  const T = tuftGeometry(NB);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(T.nv * 3), 3));
  geo.setAttribute('aB', new THREE.BufferAttribute(T.aB, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(T.nv * 3), 3));   // (else three shades FLAT_SHADED)
  geo.setIndex(T.idx);
  geo.instanceCount = n0 + n1;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, CU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        ${vegVertexCommon(L)}
        attribute vec3 aB;
        uniform sampler2D tVegGrass; uniform vec4 uVegGrassWin; uniform vec2 uVegGrassOrg;
        uniform vec4 uCrGrid0, uCrGrid1, uCrRing; uniform float uCrPix;
        varying vec4 vCr;        // x = height fraction, y = occlusion, z = translucency, w = sheen
        varying vec3 vCrC; varying vec3 vCrW;
        vec4 crHash(vec2 c) {
          uvec2 q = uvec2(ivec2(c));
          uint h = q.x * 0x8da6b343u + q.y * 0xd8163841u + 0x9e3779b9u;
          h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
          uint h2 = h * 0x9e3779b9u + 0x7f4a7c15u; h2 ^= h2 >> 13; h2 *= 0x5bd1e995u; h2 ^= h2 >> 15;
          return vec4(float(h & 0xffffu), float(h >> 16), float(h2 & 0xffffu), float(h2 >> 16)) / 65536.0;
        }`)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        int id = gl_InstanceID;
        bool ring0 = id < ${n0};
        int li = ring0 ? id : id - ${n0};
        int G = ring0 ? ${G0} : ${G1};
        vec4 grid = ring0 ? uCrGrid0 : uCrGrid1;
        float sp = ring0 ? uCrRing.z : uCrRing.w;
        vec2 ij = vec2(float(li % G), float(li / G));
        vec2 cellW = mod(grid.zw + ij, ${HM.toFixed(1)}) + (ring0 ? 0.0 : 5000.0);
        vec4 h = crHash(cellW);
        float bi = aB.z, t = aB.x, side = aB.y;
        vec4 hb = crHash(cellW + vec2(9000.0 + bi * 613.0, 77.0 + bi * 1291.0));
        vec2 rxz = grid.xy + (ij + 0.1 + 0.8 * h.xy) * sp;
        // the grass map cell of this point: crop class, height, rows, cover
        vec2 gc = floor((rxz + mod(uOrigin.xz, uVegGrassWin.w)) / uVegGrassWin.w) + uVegGrassOrg - uVegGrassWin.xy;
        vec4 gm = texelFetch(tVegGrass, ivec2(clamp(gc, vec2(0.0), vec2(uVegGrassWin.z - 1.0))), 0);
        float inMap = step(0.0, gc.x) * step(0.0, gc.y) * step(gc.x, uVegGrassWin.z - 1.0) * step(gc.y, uVegGrassWin.z - 1.0);
        float isCrop = step(2.5, gm.g) * inMap;
        float cls = floor((gm.g - 3.0) * 10.0 + 0.05);
        float ch = gm.r, cov = gm.a;
        float ang = gm.b * 3.14159265;
        vec2 rowD = vec2(cos(ang), sin(ang)), perp = vec2(-rowD.y, rowD.x);
        // drill rows: snap across the rows; plants per square metre by crop
        float rs = cls < 2.5 ? 0.125 : cls < 3.5 ? 0.75 : cls < 4.5 ? 0.25 : cls < 5.5 ? 0.5 : 0.0;
        if (rs > 0.0) {
          float ac = dot(rxz + uOrigin.xz, perp);
          rxz += perp * ((floor(ac / rs) + 0.5) * rs - ac + (h.z - 0.5) * rs * 0.15);
        }
        float perM2 = cls < 1.5 ? 160.0 : cls < 2.5 ? 120.0 : cls < 3.5 ? 9.0 : cls < 4.5 ? 45.0 : cls < 5.5 ? 10.0 : 200.0;
        float dc = distance(rxz, cameraPosition.xz);
        float keep = ring0 ? step(dc, uCrRing.x) : step(uCrRing.x, dc) * step(h.w, 1.0 - smoothstep(uCrRing.y * 0.5, uCrRing.y, dc));
        keep *= isCrop * step(h.z, perM2 * sp * sp * (0.6 + 0.4 * cov) * (ring0 ? 1.0 : 0.6));
        vec2 w = rxz + uOrigin.xz;
        // ---- plant layout: per ribbon (stalk, leaf, ear, petal) -----------------------------------------------
        float phi = 6.2832 * hb.x + 2.1 * bi;
        vec2 dirA = vec2(cos(phi), sin(phi));
        float hh = ch * (0.85 + 0.25 * hb.y) * keep;
        float bw = 0.004, H0 = 0.0, len = hh, incl0 = 0.05, incl1 = 0.12, prof = 1.0 - 0.3 * t;
        float isEar = 0.0, isLeaf = 0.0, isFlower = 0.0, sen = 0.0;
        vec2 dir = dirA;
        vec2 bofs = (hb.zw - 0.5) * 0.03;
        if (cls < 1.5) {                          // cereal: 4 stalks with ears, 2 leaves
          sen = cls;
          if (bi < 3.5) { bw = 0.0035; isEar = step(0.45, ch); incl0 = 0.04 + 0.08 * hb.w; incl1 = incl0 + 0.1 + 0.6 * sen * hb.z; }
          else { isLeaf = 1.0; len = min(0.18 + 0.12 * hb.y, hh * 0.7); H0 = hh * (0.2 + 0.35 * hb.z); bw = 0.011; incl0 = 0.5; incl1 = 1.4; }
          if (ch < 0.3) { isEar = 0.0; isLeaf = 1.0; H0 = 0.0; len = hh; bw = 0.007; incl0 = 0.25 + 0.2 * hb.z; incl1 = 0.9; }
        } else if (cls < 2.5) {                   // stubble: cut straw, a few green weeds
          sen = 1.0; bw = 0.0045; incl0 = 0.05 + 0.2 * hb.w; incl1 = incl0; prof = 1.0;
          if (bi > 4.5) { isLeaf = 1.0; sen = 0.0; len = 0.05; bw = 0.012; incl0 = 0.9; incl1 = 1.3; }
        } else if (cls < 3.5) {                   // maize: a stem and five arching leaves, alternately across the row
          if (bi < 0.5) { bw = 0.024; incl0 = 0.02; incl1 = 0.03; prof = 1.0 - 0.4 * t; }
          else {
            isLeaf = 1.0; H0 = hh * (0.10 + 0.15 * bi + 0.04 * hb.z); len = (0.45 + 0.45 * min(hh / 2.0, 1.0)) * (1.0 - 0.06 * bi);
            dir = perp * (mod(bi, 2.0) < 0.5 ? 1.0 : -1.0) + rowD * (hb.y - 0.5) * 0.8; dir = normalize(dir);
            bw = 0.075 * min(1.0, 0.4 + hh / 2.0); incl0 = 0.55; incl1 = 1.75; bofs = vec2(0.0);
          }
          sen = step(2.3, ch) * 0.0;
        } else if (cls < 4.5) {                   // oilseed rape: stem, broad leaves low, flower heads on top
          if (bi < 1.5) { bw = 0.007; incl0 = 0.08 + 0.15 * bi; incl1 = incl0 + 0.1; isFlower = step(0.6, ch); }
          else { isLeaf = 1.0; H0 = hh * 0.25 * hb.z; len = min(0.22, hh * 0.6); bw = 0.05; incl0 = 0.8; incl1 = 1.4; }
        } else if (cls < 5.5) {                   // beet: a rosette of broad leaves
          isLeaf = 1.0; len = hh * 1.2; bw = 0.07; incl0 = 0.35 + 0.25 * hb.z; incl1 = 1.25; bofs = vec2(0.0);
        } else {                                  // hay field: long grass with seed heads
          bw = 0.004; incl0 = 0.15 + 0.3 * hb.z; incl1 = incl0 + 0.5; isEar = step(4.5, bi) * 0.6; sen = 0.15;
        }
        float bwMin = 1.2 * uCrPix * dc;
        float widen = max(1.0, bwMin / bw);
        keep *= step(hb.w * widen, 1.0 + 0.04 * (widen - 1.0));
        bw *= widen; len *= keep; hh *= keep;
        // wind: travelling gusts bend the tops (whole crop waves), more for tall cereal
        float ph = dot(w, uVegWind.xy) * 0.35 - uTime * 2.0;
        float gust = 0.5 + 0.5 * sin(ph) * sin(ph * 0.41 + 1.7);
        float wind = uVegWind.z * gust * (0.25 + 0.35 * (1.0 - isLeaf));
        float incl = mix(incl0, incl1, t * t) + wind * t;
        vec2 wdir = normalize(dir * cos(incl) + uVegWind.xy * wind * 0.6 + 1e-4);
        // ribbon centreline: an arc from H0 with inclination growing from incl0 to incl1 (radians from vertical)
        float ia = incl0, ib = mix(incl0, incl1, t) + wind * t;
        float im = 0.5 * (ia + ib);
        vec2 hz = wdir * sin(im) * len * t;
        float vz = cos(im) * len * t;
        vec3 base = vec3(rxz.x + bofs.x, vegGround(rxz) - uTerrCurv * curvatureDrop(dc), rxz.y + bofs.y);
        vec3 c3 = base + vec3(hz.x, H0 + vz, hz.y);
        vec2 sideD = vec2(-wdir.y, wdir.x);
        if (isLeaf > 0.5) prof = 0.35 + 0.65 * sin(3.1416 * min(t * 1.1 + 0.08, 1.0));
        if (isEar > 0.5 && t > 0.6) prof = 3.4;
        float r = bw * prof * 0.5 * side;
        vec3 tp = c3 + vec3(sideD.x * r, 0.0, sideD.y * r);
        if (isFlower > 0.5 && t > 0.6) {                 // a flat cluster of flowers at the top of the stem
          vec3 top = base + vec3(wdir.x * sin(incl0) * len, cos(incl0) * len, wdir.y * sin(incl0) * len);
          float fr = 0.045 + 0.02 * hb.z;
          tp = t < 0.9 ? top + vec3(sideD.x, 0.0, sideD.y) * fr * side + vec3(wdir.x, 0.0, wdir.y) * fr * 0.3 : top + vec3(wdir.x, 0.02, wdir.y) * fr;
        }
        // a dropped plant must not leave its ribbon's width behind: a sliver at its base, widened to a pixel at range,
        // speckled every field and the turf with dark dots
        if (keep < 0.5) tp = vec3(0.0, -1.0e5, 0.0);
        vec3 tang = normalize(vec3(wdir.x * sin(ib), cos(ib), wdir.y * sin(ib)));
        vec3 sv = vec3(sideD.x, 0.0, sideD.y);
        vec3 pn = normalize(cross(sv, tang));
        if (dot(pn.xz, cameraPosition.xz - base.xz) < 0.0) pn = -pn;
        vec3 objectNormal = normalize(normalize(pn + sv * side * 0.4) + vec3(0.0, 0.6 + 1.5 * isFlower, 0.0));
        // ---- colour (linear albedo; matched to terrFieldColor) -------------------------------------------------
        vec3 green = mix(vec3(0.070, 0.120, 0.045), vec3(0.055, 0.105, 0.048), hb.y);
        vec3 ripe = mix(vec3(0.34, 0.27, 0.13), vec3(0.28, 0.21, 0.10), hb.y);
        vec3 c = mix(green, ripe, sen);
        if (cls > 2.5 && cls < 3.5) c = mix(vec3(0.060, 0.110, 0.038), vec3(0.050, 0.095, 0.035), hb.y);
        if (cls > 4.5 && cls < 5.5) c = vec3(0.050, 0.100, 0.045) * (0.9 + 0.2 * hb.z);
        if (isEar > 0.5 && t > 0.6) c = mix(vec3(0.10, 0.15, 0.06), vec3(0.36, 0.29, 0.15), sen) * (0.9 + 0.2 * hb.z);
        if (isFlower > 0.5 && t > 0.6) c = vec3(0.62, 0.52, 0.04) * (0.85 + 0.3 * hb.z);
        if (cls > 5.5 && isEar > 0.5 && t > 0.6) c = vec3(0.24, 0.20, 0.14);
        c *= 0.9 + 0.2 * h.x;
        float zrel = (tp.y - base.y) / max(ch, 0.05);
        float occ = mix(0.40 + 0.25 * (1.0 - cov), 1.0, smoothstep(0.0, 0.95, zrel));
        vCr = vec4(zrel, occ, (1.0 - sen * 0.7) * (isLeaf > 0.5 ? 1.0 : 0.5), 1.0 - sen * 0.5);
        vCrC = c; vCrW = tp;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = tp;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uSunDir; uniform vec3 uSunColor;
        varying vec4 vCr; varying vec3 vCrC; varying vec3 vCrW;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (inverseTransformDirection(normal, viewMatrix).y < -0.2) normal = -normal;`)
      .replace('#include <map_fragment>', 'diffuseColor.rgb = vCrC * vCr.y;')
      .replace('#include <aomap_fragment>', /* glsl */`#include <aomap_fragment>
        reflectedLight.indirectSpecular *= 0.25 * vCr.y;
        reflectedLight.directSpecular *= 0.3 * vCr.w * smoothstep(-0.02, 0.1, uSunDir.y);`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        {
          vec3 vW = normalize(cameraPosition - vCrW);
          float fwd = pow(max(dot(-vW, uSunDir), 0.0), 3.0);
          totalEmissiveRadiance += vCrC * vec3(0.9, 1.0, 0.6) * uSunColor * ((0.2 + 0.8 * fwd) * 0.35 * vCr.z * vCr.y * smoothstep(0.0, 0.08, uSunDir.y) / PI);
        }`);
  };
  mat.customProgramCacheKey = () => `skyward-crops-${G0}-${G1}`;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'veg-crops'; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  mesh.castShadow = false; mesh.receiveShadow = true;
  const stats = { plants: n0 + n1, radius0: R0, radius1: R1, triangles: (n0 + n1) * T.tris, visible: false };
  const setGrid = (u, camWX, camWZ, org, Rr, sp) => {
    const ix = Math.floor((camWX - Rr) / sp), iz = Math.floor((camWZ - Rr) / sp);
    const m = (v) => ((v % HM) + HM) % HM;
    u.set(ix * sp - org.x, iz * sp - org.z, m(ix), m(iz));
  };
  return {
    mesh, stats,
    update(camWX, camWZ, org, agl, treesVisible) {
      const on = agl < 40 && treesVisible && !!uniforms.tVegGrass;
      mesh.visible = on; stats.visible = on;
      if (!on) return;
      const cam = ctx.camera, vh = ctx.renderer?.domElement?.height || 720;
      if (cam?.fov) CU.uCrPix.value = 2 * Math.tan(cam.fov * Math.PI / 360) / vh / (cam.zoom || 1);
      setGrid(CU.uCrGrid0.value, camWX, camWZ, org, R0, s0);
      setGrid(CU.uCrGrid1.value, camWX, camWZ, org, R1, s1);
      const wt = ctx.weather;
      if (wt) {
        const ws = wt.windSpeed ?? (wt.wind ? Math.hypot(wt.wind.x, wt.wind.z) : 3);
        const dx = wt.wind?.x ?? 1, dz = wt.wind?.z ?? 0, l = Math.hypot(dx, dz) || 1;
        CU.uVegWind.value.set(dx / l, dz / l, Math.min(ws / 12, 2.2), Math.min(1, (wt.turbulence ?? 0.2) + ws / 30));
      }
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
