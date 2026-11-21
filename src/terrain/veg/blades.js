// Near-field grass: real geometry for the first metres of turf around the camera.
//
// From eye height a sward is thousands of single blades: lit tops over a shaded depth, every blade a slightly
// different green, a share of them yellowing or dead straw, light glowing through them when the sun is behind,
// a waxy sheen toward a low sun, clumps and gaps, and in the rough the odd seed stem, clover leaves and a few
// flowers. This layer draws that: one instanced draw where an instance is a TUFT of NB blades (a clump growing from
// one crown), laid out on two world-anchored jittered grids around the camera (a fine one inside R0, a coarser one
// out to R1 with fewer, wider blades). Everything per blade comes from the vertex shader: hashes from the tuft's world
// cell and the blade index, sward height / lay direction / lay from the airfield mowing plan (turfPlan in
// airfield.js, shared with the ground shader and the shells), lean from the lay, the blade's own habit and travelling
// wind gusts. Tufts thin out toward R1 (dithered by hash: nothing pops) where the shells carry on alone, and stop at
// the pavement edge.
//
// Blade kinds (by hash, per blade): grass blade (curved, tapered ribbon), dead / straw blade, seed stem with a head
// (rough grass), clover / plantain leaf (flat, near the ground, in weedy patches) and small flowers (daisy, buttercup,
// clover heads) in the weedy patches of the rough.
//
// Shading: MeshStandardMaterial (engine sun, sky, IBL) with a rounded blade cross-section normal pulled toward the
// sward normal (a lawn lit from above reads by its lit tops: the eye integrates the blades), occlusion inside the
// sward (darker bases), a waxy GGX sheen (the sun's only), and light transmitted through the blade toward the
// viewer when the sun is behind it (leaf transmittance ~ 0.75 x reflectance in green, yellower).
//
// Cost: medium R0 3 m / R1 8 m, high 3.6 / 10, ultra 4.5 / 13; NB = 7 blades per tuft, 7 vertices / 5 triangles per
// blade; one draw call, no textures; per vertex 2 noise + 1 airfield-map + 2 clipmap fetches. Off on low (blades=0).
import * as THREE from 'three';
import { AIRFIELD_GLSL } from '../airfield.js';
import { vegVertexCommon } from './common.js';

export const BLADE_TIERS = {
  low: null,
  medium: { R0: 3.0, s0: 0.065, R1: 8.0, s1: 0.14 },
  high: { R0: 3.6, s0: 0.060, R1: 10, s1: 0.13 },
  ultra: { R0: 4.5, s0: 0.055, R1: 13, s1: 0.12 },
};
export const BLADES_PER_TUFT = 7;
const S = 3;              // segments per blade
const HM = 4096;          // hash period of the world cell index (keeps the index exact in float32)

/** Tuft geometry: NB blades of (S + 1) vertex pairs + a tip; aB = (height fraction, side -1 / +1 / 0, blade index). */
export function tuftGeometry(NB = BLADES_PER_TUFT) {
  const nv = 2 * S + 1, aB = new Float32Array(NB * nv * 3), idx = [];
  for (let b = 0; b < NB; b++) {
    const o = b * nv;
    for (let k = 0; k < S; k++) aB.set([k / S, -1, b, k / S, 1, b], (o + 2 * k) * 3);
    aB.set([1, 0, b], (o + 2 * S) * 3);
    for (let k = 0; k < S; k++) {
      const a = o + 2 * k, c = a + 2;
      if (k < S - 1) idx.push(a, a + 1, c, c, a + 1, c + 1); else idx.push(a, a + 1, o + 2 * S);
    }
  }
  return { aB, idx, nv: NB * nv, tris: NB * (2 * S - 1) };
}

export function createBlades(ctx, { L, tier, uniforms, U }) {
  const { R0, s0, R1, s1 } = tier;
  const G0 = Math.ceil(2 * R0 / s0) + 1, G1 = Math.ceil(2 * R1 / s1) + 1;
  const n0 = G0 * G0, n1 = G1 * G1;
  const NB = BLADES_PER_TUFT;
  const BU = {
    uBlGrid0: { value: new THREE.Vector4() },   // xy = render-space xz of the low corner, zw = world cell index of it (mod HM)
    uBlGrid1: { value: new THREE.Vector4() },
    uBlRing: { value: new THREE.Vector4(R0, R1, s0, s1) },
    uBlPix: { value: 0.001 },                   // radians per pixel (blade widening)
    tTerrNoise: uniforms.tTerrNoise, uTerrTile: uniforms.uTerrTile,
    tAirMap: uniforms.tAirMap, uAirMap: uniforms.uAirMap, uAirInfo: uniforms.uAirInfo,
    // grass map (grass.js, created before the blades); without one the blades stay on the airfield
    tVegGrass: uniforms.tVegGrass || { value: null }, uVegGrassWin: uniforms.uVegGrassWin || { value: new THREE.Vector4(0, 0, 1, 1) },
    uVegGrassOrg: uniforms.uVegGrassOrg || { value: new THREE.Vector2() }, uVegGrassOn: { value: uniforms.tVegGrass ? 1 : 0 },
  };
  const T = tuftGeometry(NB);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(T.nv * 3), 3));
  geo.setAttribute('aB', new THREE.BufferAttribute(T.aB, 3));
  // (unused, but without a normal attribute three compiles a Standard material FLAT_SHADED: the face normal of a
  // standing blade is horizontal, which is what made every blade seen toward the sun near black)
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(T.nv * 3), 3));
  geo.setIndex(T.idx);
  geo.instanceCount = n0 + n1;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const dbg = +(ctx.params?.raw?.blDbg || 0);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, BU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        #define BL_DBG ${dbg}
        ${vegVertexCommon(L)}
        ${AIRFIELD_GLSL}
        attribute vec3 aB;
        uniform vec4 uBlGrid0, uBlGrid1, uBlRing; uniform float uBlPix;
        uniform sampler2D tTerrNoise; uniform vec2 uTerrTile[7];
        uniform sampler2D tVegGrass; uniform vec4 uVegGrassWin; uniform vec2 uVegGrassOrg; uniform float uVegGrassOn;
        uniform vec3 uSunDir;
        varying vec4 vBl;                    // x = height fraction, y = occlusion at the base, z = sheen weight, w = translucency weight
        varying vec3 vBlC;                   // albedo
        varying vec3 vBlW;                   // render-space position
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
        vec2 cellW = mod(grid.zw + ij, ${HM.toFixed(1)}) + (ring0 ? 0.0 : 5000.0);
        vec4 h = blHash(cellW);                                   // per tuft
        float bi = aB.z;
        vec4 hb = blHash(cellW * 1.0 + vec2(9000.0 + bi * 613.0, 77.0 + bi * 1291.0));   // per blade
        vec4 hc = blHash(cellW * 1.0 + vec2(19000.0 + bi * 389.0, 3077.0 + bi * 911.0));
        vec2 rxz = grid.xy + (ij + 0.1 + 0.8 * h.xy) * sp;
        float dc = distance(rxz, cameraPosition.xz);
        // ring membership, dithered thinning toward the outer edge, pavement / outside the airside
        float keep = ring0 ? step(dc, uBlRing.x) : step(uBlRing.x, dc) * step(h.z, 1.0 - smoothstep(uBlRing.y * 0.45, uBlRing.y, dc));
        vec2 am = airMap(rxz);
        float onAir = step(0.10 + 0.6 * h.w, am.x) * step(0.5, airSide(rxz)) * step(0.5, uAirInfo.z);
        // off the airfield: meadows, pastures, verges and field margins, from the grass map (grass.js: kind 0 carries
        // the meadow share in 0..0.4; crops, reeds and bare ground carry none)
        vec2 gc = floor((rxz + mod(uOrigin.xz, uVegGrassWin.w)) / uVegGrassWin.w) + uVegGrassOrg - uVegGrassWin.xy;
        vec4 gm = texelFetch(tVegGrass, ivec2(clamp(gc, vec2(0.0), vec2(uVegGrassWin.z - 1.0))), 0);
        float inMap = step(0.0, min(gc.x, gc.y)) * step(max(gc.x, gc.y), uVegGrassWin.z - 1.0) * step(0.5, uVegGrassOn);
        float meadow = (1.0 - step(0.5, airSide(rxz))) * inMap * step(gm.g, 0.45) * clamp(gm.g / 0.4, 0.0, 1.0);
        keep *= max(onAir, step(h.w, meadow * 1.1 - 0.05));
        vec2 w = rxz + uOrigin.xz;
        vec4 n2 = textureLod(tTerrNoise, tnUV(${Math.cos(2.29).toFixed(6)}, ${Math.sin(2.29).toFixed(6)}, ${(1 / 410).toExponential(6)}, uTerrTile[2], rxz), 0.0);
        vec4 n3 = textureLod(tTerrNoise, tnUV(${Math.cos(0.71).toFixed(6)}, ${Math.sin(0.71).toFixed(6)}, ${(1 / 110).toExponential(6)}, uTerrTile[3], rxz), 0.0);
        TurfP TP = turfPlan(w, am.x, n2.r, n2.g, n3.r);
        if (onAir < 0.5) { TP.longG = 1.0; TP.H = mix(0.10, 0.30, n3.g) * (0.7 + 0.6 * n2.r); TP.lay = 0.1; TP.since = 1.0; }
        // clumps (4 m noise, as the shells and the ground use it): denser, taller tussocks, thin between them;
        // weedy patches (clover, plantain, flowers) and bare scuffs from the finer 0.7 m and 4 m noise
        vec4 n4 = textureLod(tTerrNoise, tnUV(${Math.cos(1.87).toFixed(6)}, ${Math.sin(1.87).toFixed(6)}, ${(1 / 23).toExponential(6)}, uTerrTile[4], rxz), 0.0);
        vec4 n5 = textureLod(tTerrNoise, tnUV(${Math.cos(2.93).toFixed(6)}, ${Math.sin(2.93).toFixed(6)}, ${(1 / 4.1).toExponential(6)}, uTerrTile[5], rxz), 0.0);
        float clump = smoothstep(0.30, 0.72, n5.g * 0.65 + n4.r * 0.35);
        float weedy = smoothstep(0.60, 0.78, n4.a * 0.55 + n5.b * 0.45) * (0.35 + 0.65 * TP.longG);
        float bareP = smoothstep(0.70, 0.86, n5.r * 0.6 + n4.b * 0.4) * (0.4 + 0.6 * (1.0 - TP.longG));
        float verge = smoothstep(0.1, 2.8, am.x);
        // tuft density: a tuft is kept by hash against the local cover (clumps, bare scuffs, worn verge)
        keep *= step(h.z * 0.999, mix(0.55, 1.0, clump) * (1.0 - 0.85 * bareP) * (0.35 + 0.65 * verge));
        // a blade narrower than ~1.2 pixels aliases into speckle: widen it to that and drop blades (by hash, no
        // popping) in proportion, so the area the blades cover - and the colour of the sward - stays the same
        float t = aB.x, side = aB.y;
        float longG = TP.longG;
        // ---- kind of this blade --------------------------------------------------------------------------------
        float isLeaf = step(hb.w, weedy * 0.75) * step(1.5, bi);                   // clover / plantain leaves
        float isFlower = (1.0 - isLeaf) * step(bi, 0.5) * step(hc.x, weedy * 0.28 + 0.008 * longG);
        float isSeed = (1.0 - isLeaf) * (1.0 - isFlower) * step(bi, 1.5) * step(hc.y, 0.05 + 0.32 * longG * longG);
        float isDead = (1.0 - isLeaf) * (1.0 - isFlower) * step(hb.z, 0.06 + 0.16 * longG + 0.12 * (1.0 - verge) + 0.25 * smoothstep(0.62, 0.85, n2.r * 0.6 + n3.b * 0.4));
        // ---- size and habit -------------------------------------------------------------------------------------
        float bw = mix(0.0032, 0.0055, hb.x) * (1.0 + 0.5 * longG);
        float bh = TP.H * (0.55 + 0.75 * hb.y * hb.y + 0.35 * clump) * (0.5 + 0.5 * verge) * 1.45;
        bh *= 1.0 + isSeed * (0.6 + 0.5 * hc.z) + isFlower * 0.35;
        bh = mix(bh, 0.018 + 0.03 * hb.y, isLeaf);
        bw = mix(bw, 0.009 + 0.006 * hb.x, isLeaf);
        bw = mix(bw, 0.0016, max(isSeed, isFlower));
        float bwMin = 1.2 * uBlPix * dc;
        float widen = max(1.0, bwMin / bw);
        keep *= step(hc.w * widen, 1.0 + 0.04 * (widen - 1.0));
        bw *= widen;
        bh *= keep;
        // habit: spread from the crown, own lean, then the lay of the mower pass and the wind, bending more toward the tip
        float phi = 6.2832 * hb.x + 2.4 * bi;
        float spread = mix(0.012, 0.035, longG) * sqrt(hc.z + 0.05);
        vec2 crown = vec2(cos(phi), sin(phi)) * spread;
        vec2 base2 = rxz + crown;
        vec2 own = vec2(cos(phi), sin(phi)) * (0.08 + 0.32 * hb.z * hb.z) * (1.0 - 0.6 * isSeed);
        vec2 lean = own + TP.dir * (TP.lay * 0.75 * (0.6 + 0.8 * hb.x));
        float ph = dot(w, uVegWind.xy) * 0.22 - uTime * 2.3;
        float gust = 0.55 + 0.45 * sin(ph) * sin(ph * 0.37 + 1.3) + 0.2 * sin(uTime * 6.3 + h.x * 40.0 + bi);
        lean += uVegWind.xy * (uVegWind.z * gust * (0.35 + 0.3 * isSeed));
        float ll = length(lean);
        lean *= min(ll, 1.0) / max(ll, 1e-4);
        lean = mix(lean, vec2(cos(phi), sin(phi)) * 3.5, isLeaf);                  // leaves lie nearly flat
        float tt = t * t;
        vec3 base = vec3(base2.x, vegGround(base2) - uTerrCurv * curvatureDrop(dc) + 0.002, base2.y);
        float lean2 = min(dot(lean, lean), 2.0);
        float up = bh * t * (1.0 - 0.30 * lean2 * t);
        vec2 off = lean * bh * tt * 0.72;
        if (isLeaf > 0.5) { up = bh * (0.35 + 0.65 * t) * (1.0 - t * 0.6); off = normalize(lean) * bh * 2.2 * t; }
        vec2 wax = vec2(-sin(phi + 0.6 * hb.w), cos(phi + 0.6 * hb.w));
        // width profile: tapering ribbon; leaves are ovals; seed stems thin with a spindle head on the top segment;
        // flowers a thin stem with a flat disc at the top
        float prof = 1.0 - pow(t, 1.5);
        if (isLeaf > 0.5) prof = 0.35 + 0.65 * sin(3.1416 * min(t * 1.15, 1.0));
        if (isSeed > 0.5) prof = t > 0.5 ? 3.2 : 1.0;
        float wd = bw * prof * side;
        vec3 tp = base + vec3(off.x + wax.x * wd, up, off.y + wax.y * wd);
        if (isFlower > 0.5) {
          float r = 0.006 + 0.006 * hc.z;
          vec3 top = base + vec3(off.x, bh, off.y);
          tp = t < 0.5 ? base + vec3(off.x * t * 2.0 + wax.x * wd, bh * t * 1.5, off.y * t * 2.0 + wax.y * wd)
             : t < 0.9 ? top + vec3(wax.x * r * side, 0.0, wax.y * r * side) + vec3(-wax.y, 0.0, wax.x) * r * 0.6
             : top + vec3(wax.y, 0.0, -wax.x) * r * 1.4;
        }
        if (keep < 0.5) tp = vec3(0.0, -1.0e5, 0.0);     // (a dropped blade leaves no sliver of its width behind)
        // normal: blade plane normal (facing the way it leans), turned across the width (rounded section) and pulled
        // up: a thin blade's shaded side glows with transmitted light and light from its neighbours, so in a sward the
        // blades are lit more like the canopy top than like isolated cards
        vec3 tang = normalize(vec3(lean.x * bh * 1.44 * t + 1e-4, bh * (1.0 - 0.6 * lean2 * t) + 1e-4, lean.y * bh * 1.44 * t));
        vec3 wv = vec3(wax.x, 0.0, wax.y);
        vec3 pn = normalize(cross(wv, tang));
        if (dot(pn.xz, cameraPosition.xz - base2) < 0.0) pn = -pn;     // face the viewer (two-sided)
        vec3 objectNormal = normalize(normalize(pn + wv * side * 0.5) + vec3(0.0, 1.8 + 2.0 * max(isLeaf, isFlower), 0.0));
        #if BL_DBG == 1
        objectNormal = vec3(0.0, 1.0, 0.0);
        #endif
        // ---- colour ---------------------------------------------------------------------------------------------
        // living blades: yellow-green young to blue-green old (linear albedo, close to measured grass leaves),
        // drier in the rough; dead straw; seed heads buff to purple-brown; clover darker blue-green
        vec3 young = vec3(0.105, 0.155, 0.048), old = vec3(0.072, 0.120, 0.048), olive = vec3(0.130, 0.140, 0.064);
        vec3 c = mix(young, old, hb.y);
        c = mix(c, olive, clamp(0.25 * longG + 0.35 * (n2.r - 0.4) + 0.3 * (hc.x - 0.5), 0.0, 0.7));
        c *= 0.85 + 0.3 * hc.z;
        c = mix(c, c * vec3(1.25, 1.12, 0.75), smoothstep(0.75, 1.0, t) * 0.5 * (0.3 + longG));     // browning tips
        vec3 straw = mix(vec3(0.32, 0.27, 0.15), vec3(0.24, 0.19, 0.11), hc.z);
        c = mix(c, straw, isDead);
        vec3 head = mix(vec3(0.30, 0.24, 0.15), vec3(0.20, 0.13, 0.12), hc.z);
        c = mix(c, t > 0.5 ? head : mix(c, straw, 0.5 * longG), isSeed);
        c = mix(c, vec3(0.055, 0.115, 0.050) * (0.9 + 0.2 * hc.x), isLeaf);
        vec3 petal = hc.z < 0.45 ? vec3(0.80, 0.80, 0.74) : hc.z < 0.8 ? vec3(0.72, 0.56, 0.03) : vec3(0.62, 0.40, 0.55);
        c = mix(c, t < 0.5 ? vec3(0.07, 0.12, 0.04) : petal, isFlower);
        float occ = mix(0.62, 1.0, smoothstep(0.0, 0.6, t));                      // inside the sward the base sees little sky
        occ = mix(occ, 0.75 + 0.25 * t, max(isLeaf, isFlower));
        vBl = vec4(t, occ, 1.0 - max(isDead, isFlower) * 0.7, (1.0 - isDead * 0.6) * (1.0 - isFlower * 0.5));
        vBlC = c;
        vBlW = tp;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = tp;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        #define BL_DBG ${dbg}
        uniform vec3 uSunDir; uniform vec3 uSunColor;
        varying vec4 vBl; varying vec3 vBlC; varying vec3 vBlW;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // (the vertex normal already faces the viewer and leans up: undo any two-sided flip by keeping it in the upper
        // hemisphere, whatever the face winding came out as)
        if (inverseTransformDirection(normal, viewMatrix).y < 0.0) normal = -normal;`)
      .replace('#include <map_fragment>', /* glsl */`
        diffuseColor.rgb = vBlC * vBl.y;`)
      .replace('#include <aomap_fragment>', /* glsl */`#include <aomap_fragment>
        // a blade mirrors little of the sky: most of the sky it would reflect at grazing angles is hidden by the
        // blades around it; the sun's sheen stays (only the sun's: at night the direct lights are lamps and fires
        // near the ground, whose grazing lobe on a field of tiny blades glitters)
        reflectedLight.indirectSpecular *= 0.2 * vBl.x;
        reflectedLight.directSpecular *= 0.35 * vBl.z * vBl.x * smoothstep(-0.02, 0.1, uSunDir.y);
        #if BL_DBG == 2
        reflectedLight.directDiffuse = vec3(0.0); reflectedLight.indirectDiffuse = diffuseColor.rgb * 3.0; reflectedLight.directSpecular = vec3(0.0); reflectedLight.indirectSpecular = vec3(0.0);
        #endif`)
      .replace('#include <dithering_fragment>', /* glsl */`#include <dithering_fragment>
        #if BL_DBG == 3
        { int cdb = int(gl_FragCoord.x) / 160;
          gl_FragColor.rgb = cdb == 0 ? vec3(vBl.x, vBl.y, 0.0) : cdb == 1 ? reflectedLight.directDiffuse * 3.0 : cdb == 2 ? reflectedLight.indirectDiffuse * 3.0 : (reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance) * 3.0; }
        #endif`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        {
          // light through the blade toward the eye: sun behind it (leaf transmittance ~0.75 x reflectance in the
          // green, yellower), strongest looking toward the sun, mostly the upper, exposed part of the blade
          vec3 vW = normalize(cameraPosition - vBlW);
          float fwd = pow(max(dot(-vW, uSunDir), 0.0), 3.0);
          float back = 0.25 + 0.75 * fwd;
          totalEmissiveRadiance += vBlC * vec3(0.9, 1.0, 0.55) * uSunColor * (back * 0.42 * vBl.w * smoothstep(0.1, 0.9, vBl.x) * smoothstep(0.0, 0.08, uSunDir.y) / PI);
        }`);
  };
  mat.customProgramCacheKey = () => `skyward-blades2-${G0}-${G1}-${dbg}`;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'veg-blades'; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  mesh.castShadow = false; mesh.receiveShadow = false;   // (thin blades a few cm above the ground self-shadow through the sun cascade's normal offset)

  const stats = { tufts: n0 + n1, blades: (n0 + n1) * NB, radius0: R0, radius1: R1, triangles: (n0 + n1) * T.tris };
  const setGrid = (u, camWX, camWZ, org, Rr, sp) => {
    const ix = Math.floor((camWX - Rr) / sp), iz = Math.floor((camWZ - Rr) / sp);
    const m = (v) => ((v % HM) + HM) % HM;
    u.set(ix * sp - org.x, iz * sp - org.z, m(ix), m(iz));
  };
  return {
    mesh, stats,
    update(camWX, camWZ, org, agl, airfield) {
      const on = agl < 25;
      mesh.visible = on;
      if (!on) return;
      const cam = ctx.camera, vh = ctx.renderer?.domElement?.height || 720;
      if (cam?.fov) BU.uBlPix.value = 2 * Math.tan(cam.fov * Math.PI / 360) / vh / (cam.zoom || 1);
      setGrid(BU.uBlGrid0.value, camWX, camWZ, org, R0, s0);
      setGrid(BU.uBlGrid1.value, camWX, camWZ, org, R1, s1);
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
