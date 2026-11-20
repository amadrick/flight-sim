// Near-field grass blades: real geometry for the first few metres of airfield turf around the camera.
//
// The shells (turf.js) give the sward its depth from a distance, but from eye height they read as fuzz: close up the
// eye wants single blades with a lit side and a dark side, a tip, a glossy cuticle and light coming through. This
// layer draws them: one instanced draw of a single tapered, curved blade (S segments), instance = blade, laid out on
// two world-anchored jittered grids around the camera (a fine one inside R0, a coarser one with wider blades out to
// R1). Everything per blade comes from the vertex shader: position and hashes from the instance id and the grid
// corner, sward height / lay direction / lay from the same mowing plan the ground shader and the shells use
// (turfPlan in airfield.js), lean from the lay, the blade's own habit and travelling wind gusts. Blades thin out
// (dithered by hash, so nothing pops) toward R1 where the shells carry on alone, and stop at the pavement edge.
//
// Shading: MeshStandardMaterial (engine sun, sky, aircraft shadow map) with a rounded blade cross-section (the normal
// turns across the width, so the cuticle highlight runs along the blade), low roughness for the waxy sheen, a base
// darkened by the sward around it (self shadowing / occlusion), and a transmitted-light term for a sun behind the
// blade (leaf transmittance ~ 0.3 of reflectance, yellow-green).
//
// Cost: medium 3.2 + 7.5 m, high 4.2 + 10 m, ultra 5.5 + 13 m; 7 vertices / 5 triangles per blade; ~110 k / 200 k /
// 330 k blades submitted (about 70 % survive the ring and pavement culls); one draw call, no textures, 2 noise + 1
// airfield-map + 2 clipmap fetches per vertex. Off on low (blades=0 turns it off).
import * as THREE from 'three';
import { AIRFIELD_GLSL } from '../airfield.js';
import { vegVertexCommon } from './common.js';

export const BLADE_TIERS = {
  low: null,
  medium: { R0: 2.8, s0: 0.022, R1: 7.5, s1: 0.05 },
  high: { R0: 3.8, s0: 0.020, R1: 10, s1: 0.046 },
  ultra: { R0: 5.0, s0: 0.019, R1: 13, s1: 0.042 },
};
const S = 3;              // segments per blade
const HM = 4096;          // hash period of the world cell index (keeps the index exact in float32)

export function createBlades(ctx, { L, tier, uniforms, U }) {
  const { R0, s0, R1, s1 } = tier;
  const G0 = Math.ceil(2 * R0 / s0) + 1, G1 = Math.ceil(2 * R1 / s1) + 1;
  const n0 = G0 * G0, n1 = G1 * G1;
  const BU = {
    uBlGrid0: { value: new THREE.Vector4() },   // xy = render-space xz of the low corner, zw = world cell index of it (mod HM)
    uBlGrid1: { value: new THREE.Vector4() },
    uBlRing: { value: new THREE.Vector4(R0, R1, s0, s1) },
    uBlPix: { value: 0.001 },                   // radians per pixel (blade widening)
    tTerrNoise: uniforms.tTerrNoise, uTerrTile: uniforms.uTerrTile,
    tAirMap: uniforms.tAirMap, uAirMap: uniforms.uAirMap, uAirInfo: uniforms.uAirInfo,
  };
  // one blade: (S + 1) pairs of vertices up the blade and a tip; aB = (height fraction, side -1 / +1 / 0)
  const geo = new THREE.InstancedBufferGeometry();
  const nv = 2 * S + 1, aB = new Float32Array(nv * 2), pos = new Float32Array(nv * 3), idx = [];
  for (let k = 0; k < S; k++) { aB.set([k / S, -1, k / S, 1], k * 4); }
  aB.set([1, 0], S * 4);
  for (let k = 0; k < S; k++) {
    const a = 2 * k, b = a + 1, c = a + 2, d = a + 3;
    if (k < S - 1) idx.push(a, b, c, c, b, d); else idx.push(a, b, 2 * S);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aB', new THREE.BufferAttribute(aB, 2));
  geo.setIndex(idx);
  geo.instanceCount = n0 + n1;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, BU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        #define BL_DBG ${+(ctx.params?.raw?.blDbg || 0)}
        ${vegVertexCommon(L)}
        ${AIRFIELD_GLSL}
        attribute vec2 aB;
        uniform vec4 uBlGrid0, uBlGrid1, uBlRing; uniform float uBlPix;
        uniform sampler2D tTerrNoise; uniform vec2 uTerrTile[7];
        varying vec4 vBl;                    // x = height fraction, y = tint, z = dead, w = long-grass zone
        varying vec3 vBlW;                   // render-space position (translucency)
        vec2 tnUV(float c, float s, float inv, vec2 off, vec2 p) { return vec2(c * p.x - s * p.y, s * p.x + c * p.y) * inv + off; }
        vec4 blHash(vec2 c) {
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
        vec4 grid = ring0 ? uBlGrid0 : uBlGrid1;
        float sp = ring0 ? uBlRing.z : uBlRing.w;
        vec2 ij = vec2(float(li % G), float(li / G));
        vec2 cellW = mod(grid.zw + ij, ${HM.toFixed(1)});
        vec4 h = blHash(cellW + (ring0 ? 0.0 : 5000.0));
        vec4 h2 = blHash(cellW + vec2(9000.0, 77.0) + (ring0 ? 0.0 : 3000.0));
        vec2 rxz = grid.xy + (ij + 0.1 + 0.8 * h.xy) * sp;
        float dc = distance(rxz, cameraPosition.xz);
        // ring membership, dithered thinning toward the outer edge, pavement / outside the airside
        float keep = ring0 ? step(dc, uBlRing.x) : step(uBlRing.x, dc) * step(h.z, 1.0 - smoothstep(uBlRing.y * 0.35, uBlRing.y, dc));
        vec2 am = airMap(rxz);
        keep *= step(0.08 + 0.5 * h.w, am.x) * step(0.5, airSide(rxz)) * step(0.5, uAirInfo.z);
        vec2 w = rxz + uOrigin.xz;
        vec4 n2 = textureLod(tTerrNoise, tnUV(${Math.cos(2.29).toFixed(6)}, ${Math.sin(2.29).toFixed(6)}, ${(1 / 410).toExponential(6)}, uTerrTile[2], rxz), 0.0);
        vec4 n3 = textureLod(tTerrNoise, tnUV(${Math.cos(0.71).toFixed(6)}, ${Math.sin(0.71).toFixed(6)}, ${(1 / 110).toExponential(6)}, uTerrTile[3], rxz), 0.0);
        TurfP T = turfPlan(w, am.x, n2.r, n2.g, n3.r);
        // clumps: the sward is denser and taller in tussocks, thin between them (same 4 m noise as the shells' lean)
        vec4 n4 = textureLod(tTerrNoise, tnUV(${Math.cos(1.37).toFixed(6)}, ${Math.sin(1.37).toFixed(6)}, ${(1 / 3.7).toExponential(6)}, uTerrTile[4], rxz), 0.0);
        float clump = smoothstep(0.25, 0.75, n4.g * 0.7 + n4.r * 0.3);
        keep *= step(h2.w, 0.75 + 0.25 * clump + 0.3 * T.longG);
        // worn verge: thin, short turf along the pavement
        float verge = smoothstep(0.1, 2.6, am.x);
        float t = aB.x, side = aB.y;
        float bw = (ring0 ? 0.0082 : 0.013) * (0.7 + 0.6 * h2.x) * (1.0 + 0.6 * T.longG);
        // a blade narrower than ~1.3 pixels aliases into speckle: widen it to that and drop blades (by hash, no
        // popping) in proportion, so the area the blades cover - and the colour of the sward - stays the same
        float bwMin = 1.3 * uBlPix * dc;
        float widen = max(1.0, bwMin / bw);
        keep *= step(h2.z * widen, 1.0 + 0.03 * (widen - 1.0));
        bw *= widen;
        float bh = T.H * (0.6 + 0.8 * h.z * h.z + 0.3 * clump) * (0.45 + 0.55 * verge) * 1.5 * keep;
        // habit: own facing and lean, then the lay of the mower pass and the wind, bending more toward the tip
        float phi = 6.2832 * h.w;
        vec2 own = vec2(cos(6.2832 * h2.y), sin(6.2832 * h2.y)) * (0.15 + 0.35 * h2.z);
        vec2 lean = own + T.dir * (T.lay * 0.75 * (0.6 + 0.8 * h2.x));
        float ph = dot(w, uVegWind.xy) * 0.22 - uTime * 2.3;
        float gust = 0.55 + 0.45 * sin(ph) * sin(ph * 0.37 + 1.3) + 0.2 * sin(uTime * 6.3 + h.x * 40.0);
        lean += uVegWind.xy * (uVegWind.z * gust * 0.7);
        float ll = length(lean);
        lean *= min(ll, 1.3) / max(ll, 1e-4);
        float tt = t * t;
        vec3 base = vec3(rxz.x, vegGround(rxz) - uTerrCurv * curvatureDrop(dc) + 0.002, rxz.y);
        // arc length kept ~constant: the more it leans the lower the tip
        float up = bh * t * (1.0 - 0.32 * dot(lean, lean) * t);
        vec2 off = lean * bh * tt * 0.75;
        vec2 wax = vec2(cos(phi), sin(phi));
        float wd = bw * (1.0 - pow(t, 1.6)) * (side == 0.0 ? 0.0 : side);
        vec3 tp = base + vec3(off.x + wax.x * wd, up, off.y + wax.y * wd);
        // normal: blade plane normal (facing the way it leans), turned across the width (rounded section) and up a little
        vec3 tang = normalize(vec3(lean.x * bh * 1.5 * t + 1e-4, bh * (1.0 - 0.64 * dot(lean, lean) * t) + 1e-4, lean.y * bh * 1.5 * t));
        vec3 wv = vec3(wax.x, 0.0, wax.y);
        vec3 pn = normalize(cross(wv, tang));
        if (dot(pn.xz, cameraPosition.xz - rxz) < 0.0) pn = -pn;     // face the viewer (two-sided)
        // (half way to the ground normal: a sward lit from above reads by its lit tops, as the eye integrates the blades)
        vec3 objectNormal = normalize(normalize(pn + wv * side * 0.55) + vec3(0.0, 1.6, 0.0));
        #if BL_DBG == 1 || BL_DBG == 4
        objectNormal = vec3(0.0, 1.0, 0.0);
        #endif
        vBl = vec4(t, h2.x * 0.6 + h.y * 0.4, step(0.955, h.y) + step(h2.z, 0.03) * T.longG, T.longG);
        vBlW = tp;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = tp;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        #define BL_DBG ${+(ctx.params?.raw?.blDbg || 0)}
        uniform vec3 uSunDir; uniform vec3 uSunColor;
        varying vec4 vBl; varying vec3 vBlW;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // (the vertex normal already faces the viewer and leans up: undo any two-sided flip by keeping it in the upper
        // hemisphere, whatever the face winding came out as)
        if (inverseTransformDirection(normal, viewMatrix).y < 0.0) normal = -normal;`)
      .replace('#include <map_fragment>', /* glsl */`
        float bt = vBl.x;
        // turf colours (keep near TURF_REF so the blades sit in the ground and the shells): younger yellow-green
        // tips, darker older blades, the odd dead straw blade, browner in the long grass
        vec3 c = vec3(0.105, 0.175, 0.052) * (0.75 + 0.5 * vBl.y);
        c = mix(c, vec3(0.15, 0.20, 0.07), smoothstep(0.6, 1.0, bt) * 0.15);
        c = mix(c, vec3(0.26, 0.235, 0.13), clamp(vBl.z, 0.0, 1.0) * 0.85 + vBl.w * 0.15);
        // self shadowing / occlusion inside the sward: the base sees little sky or sun
        c *= mix(0.55, 1.1, smoothstep(0.0, 0.85, bt));
        diffuseColor.rgb = c;`)
      .replace('#include <aomap_fragment>', /* glsl */`#include <aomap_fragment>
        // a blade mirrors little of the sky: most of the sky it would reflect at grazing angles is hidden by the
        // blades around it; the sun's sheen stays
        reflectedLight.indirectSpecular *= 0.25;
        #if BL_DBG == 2
        reflectedLight.directDiffuse = vec3(0.0); reflectedLight.indirectDiffuse = diffuseColor.rgb * 3.0; reflectedLight.directSpecular = vec3(0.0); reflectedLight.indirectSpecular = vec3(0.0);
        #endif
        #if BL_DBG == 5
        reflectedLight.directSpecular = vec3(0.0); reflectedLight.indirectSpecular = vec3(0.0); reflectedLight.directDiffuse = vec3(0.0);
        #if NUM_SUN_LIGHTS > 0
        reflectedLight.indirectDiffuse = vec3(0.0, 0.3, 0.0) * max(dot(normal, sunLights[0].direction), 0.0) + vec3(0.0, 0.0, 0.05) * length(sunLights[0].color) / 10.0;
        #else
        reflectedLight.indirectDiffuse = vec3(0.3, 0.0, 0.0);
        #endif
        #endif
        #if BL_DBG == 3 || BL_DBG == 4
        reflectedLight.indirectDiffuse = vec3(0.0); reflectedLight.directSpecular = vec3(0.0); reflectedLight.indirectSpecular = vec3(0.0);
        #endif
        // (a sub-pixel glossy tip turns into sparkle; the sheen is kept for the blades big enough to show it)
        // (only the sun's: at night the direct lights are lamps and fires near the ground, whose grazing lobe on a
        // field of tiny blades glitters)
        reflectedLight.directSpecular *= 0.12 * smoothstep(-0.02, 0.1, uSunDir.y);`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        {
          // light through the blade: sun behind it (leaf transmittance ~0.3 x reflectance, yellower), mostly the
          // upper, exposed part of the blade
          vec3 nW = inverseTransformDirection(normal, viewMatrix);
          vec3 vW = normalize(cameraPosition - vBlW);
          float back = max(-dot(nW, uSunDir), 0.0) * 0.6 + 0.8 * pow(max(dot(-vW, uSunDir), 0.0), 4.0);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.1, 1.15, 0.6) * uSunColor * (back * 0.12 * smoothstep(0.15, 0.9, bt) * step(0.0, uSunDir.y) / PI);
        }`);
  };
  mat.customProgramCacheKey = () => `skyward-blades-${G0}-${G1}`;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'veg-blades'; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  mesh.castShadow = false; mesh.receiveShadow = false;   // (thin blades a few cm above the ground self-shadow through the sun cascade's normal offset) mesh.renderOrder = 1;

  const stats = { blades: n0 + n1, radius0: R0, radius1: R1, triangles: (n0 + n1) * (2 * S - 1) };
  const setGrid = (u, camWX, camWZ, org, Rr, sp, G) => {
    const ix = Math.floor((camWX - Rr) / sp), iz = Math.floor((camWZ - Rr) / sp);
    const m = (v) => ((v % HM) + HM) % HM;
    u.set(ix * sp - org.x, iz * sp - org.z, m(ix), m(iz));
  };
  return {
    mesh, stats,
    update(camWX, camWZ, org, agl, airfield) {
      const on = agl < 25 && airfield.stats.airport != null;
      mesh.visible = on;
      if (!on) return;
      const cam = ctx.camera, vh = ctx.renderer?.domElement?.height || 720;
      if (cam?.fov) BU.uBlPix.value = 2 * Math.tan(cam.fov * Math.PI / 360) / vh / (cam.zoom || 1);
      setGrid(BU.uBlGrid0.value, camWX, camWZ, org, R0, s0, G0);
      setGrid(BU.uBlGrid1.value, camWX, camWZ, org, R1, s1, G1);
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
