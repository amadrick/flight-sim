// Pavement (runways, taxiways, aprons, shoulders, roads) and painted markings.
// Both are MeshStandardMaterial with onBeforeCompile hooks so sun, shadows and IBL work; detail is procedural in the
// fragment shader (world-anchored noise texture, slab joints, seams, patching, rubber deposits, cracks, wetness, apron
// floodlight pools). Paint quads widen to a minimum on-screen footprint (with matching alpha) so markings never alias.
import * as THREE from 'three';
import { CURVATURE_GLSL } from '../core/glsl.js';
import { createPaveLUT, PNA, PNV, PMU0 } from '../neural/ground-pave.js';
import { glyphUV, makeAggregateTexture, makeRubberTexture, makeDefectTexture, RUBBER, DEFECT, AGGR_TILE } from './textures.js';

const DEG = Math.PI / 180;
export const KIND_ID = { rwy: 0, rwyConcrete: 1, twy: 2, apron: 3, shoulder: 4, blast: 5, road: 6, lot: 7, apronA: 8 };
export const LAYER_Y = { 0: 0.01, 1: 0.015, 2: 0.02, 3: 0.025, 4: 0.03 };
export const PAINT_Y = 0.032;
export const MAX_POOLS = 24;

// Shared GLSL ----------------------------------------------------------------------------------------------------------
const CURV_VERT = /* glsl */`
  { vec4 wpC = modelMatrix * vec4(transformed, 1.0);
    transformed.y -= curvatureDrop(distance(wpC.xz, cameraPosition.xz)); }
`;
export const RUBBER_GLSL = /* glsl */`
// rubber deposits from the simulated map: a0 = metres from the end-0 threshold, cr = metres from the centre line
// (+ = right of end 0), len / wid of the runway. Each end reads its own layer, mirrored; narrow runways see less traffic.
uniform highp sampler2DArray tRubber;
float rubberAt(float a0, float cr, float len, float wid) {
  float e = step(len * 0.5, a0);
  float a = mix(a0, len - a0, e), c = mix(cr, -cr, e);
  // (integers first: interpolated varyings of a constant are not exactly constant, a floor() of them flickers)
  float layer = mod(floor(len + 0.5) + floor(wid + 0.5) + e, ${RUBBER.layers.toFixed(1)});
  vec2 rb = texture(tRubber, vec3(c / ${RUBBER.span.toFixed(1)} + 0.5, (sqrt(0.0625 + 3.0 * max(a, 0.0) / ${RUBBER.len.toFixed(1)}) - 0.25) / 1.5, layer)).rg;
  return max(rb.r * 0.92, rb.g) * (0.3 + 0.7 * smoothstep(25.0, 45.0, wid)) * step(abs(c), wid * 0.5);
}
`;
const POOLS_GLSL = /* glsl */`
uniform vec4 uPools[${MAX_POOLS}];
uniform int uPoolCount;
uniform float uPoolGain;
vec3 poolLight(vec2 p) {
  float e = 0.0;
  for (int i = 0; i < ${MAX_POOLS}; i++) {
    if (i >= uPoolCount) break;
    vec4 L = uPools[i];
    vec2 d = p - vec2(L.x, L.z);
    float h = L.y;
    float r2 = dot(d, d) + h * h;
    e += L.w * h / (r2 * sqrt(r2));
  }
  return vec3(1.0, 0.9, 0.78) * e * uPoolGain;
}
`;
const BUMP_GLSL = /* glsl */`
vec3 scnBump(vec3 surf_pos, vec3 surf_norm, float h) {
  vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos);
  vec3 R1 = cross(sy, surf_norm), R2 = cross(surf_norm, sx);
  float det = dot(sx, R1);
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 grad = sign(det) * (dh.x * R1 + dh.y * R2);
  return normalize(abs(det) * surf_norm - grad);
}
// box-filtered periodic line: lines of width w every p metres (coverage 0..1), anti-aliased by the pixel footprint
float scnLines(float x, float p, float w) {
  float fw = max(fwidth(x), 1e-4);
  float x0 = x - 0.5 * fw, x1 = x + 0.5 * fw;
  float i0 = floor(x0 / p) * w + min(mod(x0, p), w);
  float i1 = floor(x1 / p) * w + min(mod(x1, p), w);
  return clamp((i1 - i0) / fw, 0.0, 1.0);
}
float scnHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

// ---------------------------------------------------------------------------------------------------------------------
/** Shared uniforms for all pavement/paint materials (global across airports). */
export function createPaveShared(ctx, noiseTex, atlasTex) {
  const aggr = makeAggregateTexture(ctx);
  return {
    tNoise: { value: noiseTex },
    tAtlas: { value: atlasTex },
    tAggr: { value: aggr },
    uAggrMean: { value: aggr.userData.meanR },
    tRubber: { value: makeRubberTexture(ctx) },
    tDefect: { value: makeDefectTexture(ctx) },
    uWet: { value: 0 },
    uNight: { value: 0 },
    uPixAngle: { value: 0.001 },
  };
}

/** Pavement material for one airport (its own pool uniforms). */
export function makePavementMaterial(ctx, shared, pools) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const poolArr = [];
  for (let i = 0; i < MAX_POOLS; i++) { const p = pools[i]; poolArr.push(p ? new THREE.Vector4(p.x, p.h, p.z, p.I) : new THREE.Vector4()); }
  const local = { uPools: { value: poolArr }, uPoolCount: { value: Math.min(MAX_POOLS, pools.length) }, uPoolGain: { value: 1 } };
  mat.userData.pools = local;
  // learned reflectance of grooved / rubbered / damp asphalt (neural/ground-pave.js): a LUT per airport, rebaked as
  // the sun moves; pavebrdf=0 (or quality low) = the classic shading with a fixed grazing occlusion
  const raw = ctx.params?.raw || {};
  const netOn = raw.pavebrdf !== '0' && ctx.quality?.level !== 'low';
  const lut = netOn ? createPaveLUT() : null;
  local.tPaveLUT = { value: lut ? lut.texture : null };
  local.uPaveAxis = { value: new THREE.Vector2(1, 0) };
  if (lut) {
    mat.onBeforeRender = (renderer, scene, camera, geometry) => {
      const ax = geometry.userData.rwyAxis || [1, 0];
      local.uPaveAxis.value.set(ax[0], ax[1]);
      if (ctx.env?.sunDir) lut.update(ctx.env.sunDir, ax, shared.uWet.value);
    };
  }
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, local);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aLocal; attribute vec4 aInfo; attribute vec4 aEdge;
        varying vec2 vLocal; varying vec4 vInfo; varying vec2 vField; varying vec4 vEdge;
        ${CURVATURE_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocal = aLocal; vInfo = aInfo; vField = position.xz; vEdge = aEdge;
        ${CURV_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        #define PAVE_DBG ${+(ctx.params?.raw?.pavedbg || 0)}
        #define PAVE_NET ${netOn ? 1 : 0}
        #if PAVE_NET
        uniform highp sampler2DArray tPaveLUT; uniform vec2 uPaveAxis;
        #endif
        float gGroove = 0.0, gNetK = 0.0;
        uniform sampler2D tNoise; uniform sampler2D tAggr; uniform sampler2D tDefect; uniform float uAggrMean; uniform float uWet; uniform float uNight;
        varying vec2 vLocal; varying vec4 vInfo; varying vec2 vField; varying vec4 vEdge;
        ${RUBBER_GLSL} ${POOLS_GLSL} ${BUMP_GLSL}
        float gWetMask; float gRough; float gHeight; float gRub = 0.0;`)
      .replace('#include <map_fragment>', `
        {
          float kind = floor(vInfo.x + 0.5); float plen = vInfo.y; float pwid = vInfo.z; float seed = floor(vInfo.w + 0.5);
          // runways: a seed the paint shader can reproduce from the runway's size (cracks continue under the paint)
          float rseed = kind < 1.5 ? mod(floor(plen + 0.5) * 7.0 + floor(pwid + 0.5) * 13.0, 97.0) : seed;
          vec2 F = vField;
          vec4 nA = texture(tNoise, F / 3.1);
          vec4 nB = texture(tNoise, F / 37.0 + 0.31);
          vec4 nC = texture(tNoise, F / 260.0 + 0.57);
          vec4 nD = texture(tNoise, F / 11.0 + 0.71);
          float crackNet = texture(tNoise, F / 7.3 + 0.13).a;
          float crackZone = smoothstep(0.42, 0.78, texture(tNoise, F / 140.0 + 0.4).g);
          float aggr = nA.r;
          vec2 sl = vLocal + vec2(plen, pwid) * 0.5;          // metres from the rectangle's corner
          vec3 col; float rough; float hgt = aggr * 0.004;
          float tarK = 0.0;                                  // tar sealant / fresh binder over the stones
          bool concrete = (kind > 0.5 && kind < 1.5) || (kind > 2.5 && kind < 3.5);
          gNetK = concrete ? 0.0 : 1.0;
          gGroove = kind < 1.5 ? step(abs(vLocal.y), pwid * 0.5 - 3.0) : 0.0;
          if (concrete) {
            // Portland cement concrete: 7.5 m (runway) / 6 m (apron) slabs, sealed joints, per-slab cure tone,
            // corner breaks, tar over-banding on re-sealed joints, oil and fuel stains, fine pitting
            // slabs: one paving lane (7.5 m) wide, 6 m long (aprons 6 x 6). Each lane was slip-formed in one pass, so
            // the tone follows the lane and drifts slowly along it; slab to slab it hardly changes (strongly varying
            // slabs read as floor tiles)
            vec2 slab = kind < 1.5 ? vec2(6.0, 7.5) : vec2(6.0);
            vec2 cell = floor(sl / slab);
            vec2 inC = sl - cell * slab;
            float h1 = scnHash(cell + seed), h2 = scnHash(cell * 1.37 + seed + 5.1), h3 = scnHash(cell * 2.11 + 9.7);
            float laneT = scnHash(vec2(cell.y, seed + 2.7));
            float drift = texture(tNoise, vec2(sl.x / 420.0, cell.y * 0.37 + 0.13)).g;
            float tone = 0.88 + 0.12 * laneT + 0.14 * (drift - 0.5) + 0.05 * (h1 - 0.5);
            vec3 base = kind < 1.5 ? vec3(0.235, 0.228, 0.214) : vec3(0.205, 0.20, 0.188);
            col = base * tone * (0.84 + 0.32 * aggr) * (0.9 + 0.2 * nB.g) * (0.92 + 0.16 * nC.b);
            col *= vec3(1.0, 0.99 + 0.02 * laneT, 0.97 + 0.04 * h3);                       // cement batches differ
            // later reconstruction: the odd block of slabs replaced, a touch paler / cleaner
            vec2 zc = floor(sl / (slab * vec2(9.0, 2.0)));
            col *= 1.0 + 0.07 * step(0.82, scnHash(zc * 3.1 + seed + 11.0));
            float jx = scnLines(sl.x + 0.01, slab.x, 0.022), jy = scnLines(sl.y + 0.01, slab.y, 0.028);
            float ob = max(scnLines(sl.x + 0.06, slab.x, 0.12) * step(0.8, h2), scnLines(sl.y + 0.06, slab.y, 0.12) * step(0.7, laneT));
            float j = max(jx, jy);
            // sealed joints: a thin dark sealant line, its edges a little chipped; old joints weathered paler
            col *= 1.0 - (0.5 - 0.18 * step(0.6, h3)) * j;
            // broom finish (transverse texture) and mottled curing: visible only up close / as a mean tone
            col *= 0.97 + 0.06 * texture(tNoise, vec2(sl.x / 0.9, sl.y / 23.0) + 0.29).r * (1.0 - smoothstep(0.01, 0.05, length(fwidth(sl))));
            col *= 0.92 + 0.16 * smoothstep(0.3, 0.7, texture(tNoise, sl / 2.7 + 0.61).g);
            col = mix(col, vec3(0.05, 0.048, 0.045), 0.8 * ob * (0.7 + 0.3 * nD.r));
            // spalled corners and the odd shattered slab (dark crack lines)
            float corner = (1.0 - smoothstep(0.0, 0.9, min(inC.x, slab.x - inC.x))) * (1.0 - smoothstep(0.0, 0.9, min(inC.y, slab.y - inC.y)));
            col *= 1.0 - 0.25 * corner * step(0.7, h1);
            float crk = smoothstep(0.75, 0.95, crackNet) * step(0.9, h3);
            col *= 1.0 - 0.3 * crk;
            // stains: oil and hydraulic fluid on aprons, tyre scuffs; rust streaks from tie-downs are rare
            float stain = smoothstep(0.62, 0.82, nB.b * 0.55 + nD.g * 0.45) * (kind > 2.5 ? 1.0 : 0.35);
            col *= 1.0 - 0.45 * stain;
            col *= 1.0 - 0.12 * smoothstep(0.5, 0.9, nD.b);
            // runways: tyre dust and drips darken the trafficked keel, the outer lanes stay clean and pale
            if (kind < 1.5) {
              float acr = abs(vLocal.y) + 3.0 * (nB.r - 0.5);
              col *= mix(1.04, 0.84, 1.0 - smoothstep(pwid * 0.12, pwid * 0.3, acr));
              col *= 1.0 - 0.18 * exp(-pow(vLocal.y / 1.8, 2.0)) * (0.5 + 0.5 * nD.r);
            }
            hgt -= (j + ob * 0.3) * 0.008 + crk * 0.004;
            rough = 0.80 + 0.1 * aggr - 0.3 * stain - 0.25 * ob;
          } else {
            // asphalt. Paving lanes (each from its own batch, sealed longitudinal joints), the odd transverse
            // construction joint, sealed crack networks, patches and stains (defect map, one lane-wide strip of it per
            // lane so cracks end at the joints), the trafficked keel darker and polished, the edges oxidised paler
            float base = kind < 0.5 ? 0.125 : kind < 2.5 ? 0.125 : kind < 4.5 ? 0.15 : kind < 5.5 ? 0.115 : kind < 6.5 ? 0.1 : kind < 7.5 ? 0.11 : 0.135;
            col = vec3(base) * vec3(1.0, 0.985, 0.955) * (0.82 + 0.36 * aggr) * (0.80 + 0.40 * nB.g) * (0.84 + 0.32 * nC.b);
            float lane = kind < 2.5 ? 7.5 : 5.0;
            float li = floor(sl.y / lane), yIn = sl.y - li * lane;
            float laneH = scnHash(vec2(li, rseed + 0.5)), laneH2 = scnHash(vec2(li + 7.1, rseed + 3.0));
            col *= 0.86 + 0.28 * laneH + 0.08 * (texture(tNoise, vec2(sl.x / 180.0, sl.y / 9.0) + 0.37).g - 0.5);
            vec2 fwS = fwidth(sl) + 1e-4;
            // longitudinal joint: a tar-sealed band of wandering width, ravelled (open, paler) on either side
            float dj = min(yIn, lane - yIn) + 0.05 * (nD.g - 0.5);
            float jhw = 0.07 + 0.06 * nB.r;
            float seam = clamp((jhw - dj) / fwS.y + 0.5, 0.0, 1.0) * min(1.0, 2.0 * jhw / fwS.y + 0.2);
            float ravel = (1.0 - smoothstep(jhw, jhw + 0.35, dj)) * (1.0 - seam) * smoothstep(0.4, 0.7, nA.g);
            col *= 1.0 + 0.16 * ravel;
            // transverse construction joints (end of a day's paving) every few hundred metres
            float tjS = 210.0 + 90.0 * laneH;
            float tjX = sl.x + 37.0 * laneH2 + 0.4 * (nB.g - 0.5);
            float tdj = abs(tjX - (floor(tjX / tjS) + 0.5) * tjS);
            float tj = clamp((0.06 - abs(tdj - 0.5 * tjS)) / fwS.x + 0.5, 0.0, 1.0) * min(1.0, 0.12 / fwS.x + 0.2) * step(0.35, scnHash(vec2(floor(tjX / tjS), li + rseed)));
            vec4 df = texture(tDefect, vec2((sl.x + 977.0 * laneH2) / ${DEFECT.len.toFixed(1)}, (yIn + 23.0 * laneH) / ${DEFECT.wid.toFixed(1)}));
            // patches: fresh ones black and smooth, old ones paler than their surroundings
            if (PAVE_DBG == 2) df = vec4(0.0, 0.5, 0.0, 0.0);
            if (PAVE_DBG == 3) df.g = 0.5;
            if (PAVE_DBG == 4) df.r = 0.0;
            if (PAVE_DBG == 5) df.b = 0.0;
            float pt = df.g * 2.0 - 1.0;
            float patchK = smoothstep(0.08, 0.2, abs(pt));
            col *= pt < 0.0 ? mix(1.0, 0.36, smoothstep(0.1, 0.45, -pt)) : 1.0 + 0.45 * smoothstep(0.1, 0.4, pt);
            float fresh = smoothstep(0.1, 0.5, -pt);
            // sealed cracks: black, glossy, slightly raised bands; denser on the older parts of the pavement
            float crackAmt = 0.45 + 0.55 * smoothstep(0.35, 0.65, nC.g * 0.7 + nB.b * 0.3);
            float crack = df.r * crackAmt;
            vec3 tar = vec3(0.028, 0.027, 0.026);
            tarK = max(seam, max(crack, tj));
            col = mix(col, tar, max(seam * 0.8, max(crack * 0.92, tj * 0.8)));
            // stains: drips and blots, mostly where aircraft stand or track (runway / taxiway keel, aprons)
            float stainW = kind < 2.5 ? 0.25 + 0.75 * exp(-pow(vLocal.y / (pwid * 0.18), 2.0)) : 0.8;
            col *= 1.0 - 0.5 * df.b * stainW;
            hgt += crack * 0.0012 - seam * 0.0015 - ravel * 0.001;
            rough = 0.76 + 0.08 * aggr - 0.42 * max(crack, max(seam, tj)) - 0.2 * fresh - 0.2 * df.b * stainW;
            if (kind < 2.5) {
              // keel: the trafficked central third darker (rubber dust, oil) and polished; the outer parts oxidised
              // pale grey; nose-gear line and oil drips along the centre line
              float acr = abs(vLocal.y) + 2.5 * (nB.r - 0.5) + 1.2 * (nD.b - 0.5);
              float keel = 1.0 - smoothstep(pwid * 0.16, pwid * 0.30, acr);
              float edgeB = smoothstep(pwid * 0.28, pwid * 0.47, acr);
              col *= mix(1.0, kind < 0.5 ? 0.74 : 0.82, keel) * (1.0 + 0.30 * edgeB);
              col *= mix(vec3(1.0), vec3(1.04, 1.02, 0.97), edgeB);
              float cl = exp(-pow(vLocal.y / 1.6, 2.0));
              float drip = smoothstep(0.62, 0.8, texture(tNoise, vec2(sl.x / 2.9, vLocal.y / 0.7) + 0.43).b * 0.7 + nD.r * 0.3);
              col *= 1.0 - cl * (0.16 + 0.45 * drip);
              rough += 0.10 * edgeB - 0.12 * keel - 0.2 * cl * drip;
            }
          }
          // close-range aggregate: crushed stone in the binder (asphalt) / exposed fines (concrete), 1 m tile at ~2 mm
          // per texel plus a rotated 2.37 m lookup; mip-filtered (converges to its mean, normalised to 1, instead of
          // shimmering) and the bump fades with the footprint before the derivatives can alias
          {
            float fp = length(fwidth(F));
            vec4 ag1 = texture(tAggr, F / ${AGGR_TILE.toFixed(2)});
            vec4 ag2 = texture(tAggr, vec2(0.8 * F.x - 0.6 * F.y, 0.6 * F.x + 0.8 * F.y) / 2.37 + 0.37);
            float agK = 1.0 - smoothstep(0.003, 0.012, fp);
            float stoneA = (concrete ? 0.45 : 1.0) * (1.0 - 0.85 * tarK);   // concrete shows less of its aggregate; sealant covers it
            float agF = (0.7 * ag1.r + 0.3 * ag2.r) / uAggrMean;
            col *= mix(1.0, agF, stoneA * 0.85);
            hgt += ((ag1.g - 0.5) * 0.005 + (ag2.g - 0.5) * 0.002) * agK * stoneA;
            rough = rough - 0.12 * (ag1.g - 0.45) * stoneA;  // polished stone tops
          }
          // grooving: 6 mm saw cuts every 38 mm across the runway (not the outer 3 m); box-filtered, so near the
          // camera they are crisp lines and further away a uniform ~4 % darker, rougher texture
          if (kind < 1.5) {
            float gK = step(abs(vLocal.y), pwid * 0.5 - 3.0);
            float gr = scnLines(sl.x, 0.038, 0.006) * gK;
            col *= 1.0 - (0.06 + 0.04 * nB.r) * gr * (1.0 - smoothstep(0.004, 0.02, length(fwidth(F))));   // grooves read in the shading, not the albedo
            hgt -= 0.0025 * gr * (1.0 - smoothstep(0.004, 0.012, length(fwidth(F))));
            rough += 0.06 * gr;
          }
          // runways: rubber in both touchdown zones from the simulated deposit map (textures.js simulateRubber),
          // fine tyre striations below its resolution near the camera; rubber is smoother (sheen toward a low sun)
          if (kind < 1.5) {
            float rub = rubberAt(sl.x, vLocal.y, plen, pwid);
            if (PAVE_DBG == 1) rub = 0.0;
            float fwc = fwidth(vLocal.y);
            float stri = texture(tNoise, vec2(sl.x / 47.0, vLocal.y / 0.11)).r;
            rub *= mix(1.0, 0.55 + 0.9 * stri, 1.0 - smoothstep(0.02, 0.1, fwc));
            col = mix(col, vec3(0.012, 0.0115, 0.011), clamp(rub, 0.0, 1.0) * (concrete ? 0.95 : 0.97));
            gRub = clamp(rub, 0.0, 1.0);
            rough = mix(rough, 0.5, gRub);
          }
          // shoulders and blast pads: weathered, paler, loose grit; soil blown and washed onto the outer margin, which
          // crumbles into the verge; runway shoulders carry the edge light bases and the sealed cable slot between them
          if (kind > 3.5 && kind < 5.5) {
            col *= 0.92 + 0.36 * nB.b;
            float side = vEdge.x;
            float ed = min(pwid * 0.5 - abs(vLocal.y), plen * 0.5 - abs(vLocal.x));
            float outer = side != 0.0 ? pwid * 0.5 + side * vLocal.y : ed;      // distance from the outer (verge) edge
            float brk = nD.g * 0.6 + nA.g * 0.4;
            float dirt = (1.0 - smoothstep(0.0, 0.6 + 1.4 * brk, min(outer, ed + 0.6))) * (0.55 + 0.45 * nA.g);
            col = mix(col, vec3(0.15, 0.125, 0.092) * (0.8 + 0.4 * nA.b), dirt * 0.75);
            // crumbled edge: broken asphalt and weeds in the last few decimetres
            float crum = (1.0 - smoothstep(0.0, 0.25 + 0.35 * brk, outer)) * smoothstep(0.45, 0.7, texture(tNoise, F / 0.9 + 0.3).g);
            col = mix(col, vec3(0.055, 0.075, 0.032) * (0.8 + 0.5 * nD.r), crum * 0.85);
            col = mix(col, vec3(0.06, 0.09, 0.035), (1.0 - smoothstep(0.0, 0.12, ed)) * smoothstep(0.55, 0.75, nD.r) * 0.8);
            rough = mix(rough, 0.95, max(dirt, crum));
            hgt -= crum * 0.01;
            if (vEdge.z > 0.0) {
              float yl = side * (pwid * 0.5 - vEdge.w);                      // lateral position of the light row
              float u = sl.x - vEdge.y;
              float du = u - vEdge.z * floor(u / vEdge.z + 0.5);
              vec2 dl = vec2(du, vLocal.y - yl);
              float r = length(dl);
              float fpx = length(fwidth(F)) + 1e-4;
              float onRun = step(-0.5, u) * step(u, plen - 2.0 * vEdge.y + 0.5);
              // concrete base (0.6 m) with a dark seal ring, a scorched / dirty halo
              float baseK = clamp((0.30 - r) / fpx + 0.5, 0.0, 1.0) * onRun;
              float ring = clamp((0.035 - abs(r - 0.31)) / fpx + 0.5, 0.0, 1.0) * onRun;
              float halo = (1.0 - smoothstep(0.3, 1.1, r)) * onRun;
              col *= 1.0 - 0.25 * halo;
              col = mix(col, vec3(0.30, 0.295, 0.28) * (0.85 + 0.3 * nA.r), baseK);
              col = mix(col, vec3(0.03), ring * 0.8);
              // cable slot along the light row, tar sealed
              float slot = clamp((0.025 - abs(vLocal.y - yl - 0.02 * (nB.g - 0.5))) / fwidth(vLocal.y) + 0.5, 0.0, 1.0) * min(1.0, 0.05 / fwidth(vLocal.y)) * onRun * (1.0 - baseK);
              col = mix(col, vec3(0.03), slot * 0.75);
              rough = mix(rough, 0.6, baseK);
            }
          }
          // wetness: darker, smoother, puddles in low spots (and along the sealed cracks)
          float puddle = smoothstep(0.55, 0.72, nC.b * 0.7 + nB.g * 0.3);
          gWetMask = uWet * (0.55 + 0.45 * puddle);
          col *= mix(1.0, 0.55, gWetMask);
          rough = mix(clamp(rough, 0.3, 1.0), 0.08, gWetMask * (0.5 + 0.5 * puddle));
          // specular anti-aliasing: the bump is derivative-based (constant per 2x2 pixel quad), so a glossy lobe on it
          // turns into blocky sparkle under the temporal filter; bumps fade with the footprint and the lobe widens with it
          float fpS = length(fwidth(F));
          gHeight = hgt * (1.0 - gWetMask * puddle) * (1.0 - smoothstep(0.02, 0.08, fpS));
          gRough = max(rough, mix(0.42, 0.62, smoothstep(0.004, 0.04, fpS)) * (1.0 - 0.75 * gWetMask));
          #if PAVE_DBG == 7
          if (kind < 1.5) col = vec3(0.12 * (1.0 - clamp(rubberAt(sl.x, vLocal.y, plen, pwid), 0.0, 1.0))) + vec3(0.03 * step(fract(sl.x / 50.0), 0.02), 0.0, 0.0);
          #endif
          #if PAVE_DBG == 6
          col = vec3(texture(tDefect, vec2(F.x / 64.0, F.y / 32.0)).g * 0.4);
          #endif
          diffuseColor.rgb *= col;
        }`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = gRough;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = scnBump(-vViewPosition, normal, gHeight);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        {
          // dry pavement is not a smooth dielectric with a few bumps: the stones and grooves shadow and mask the grazing
          // mirror image of the sky (horizon occlusion), which otherwise washes the runway out to a uniform pale grey
          // from the cockpit. Water fills the texture and brings the reflection back.
          float nvP = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          // Rubber fills the texture but is black and matte to the sky: its sheen is the sun's (direct) lobe only.
          float occ = mix(0.22, 1.0, smoothstep(0.02, 0.6, nvP)) * (1.0 - 0.75 * gRub);
          #if PAVE_NET
          // asphalt: factors from the learned reflectance (sun diffuse, sun specular, sky diffuse, sky specular) for
          // this view direction about the runway axis, groove / rubber state; standing water keeps the classic glint
          if (gNetK > 0.5) {
            vec3 vW = inverseTransformDirection(normalize(vViewPosition), viewMatrix);
            float muV = clamp(vW.y, ${PMU0.toFixed(3)}, 1.0);
            float phV = atan(-vW.x * uPaveAxis.y + vW.z * uPaveAxis.x, vW.x * uPaveAxis.x + vW.z * uPaveAxis.y);
            vec2 uvL = vec2(phV / 6.2831853, (sqrt((muV - ${PMU0.toFixed(3)}) / ${(1 - PMU0).toFixed(3)}) * ${(PNV - 1).toFixed(1)} + 0.5) / ${PNV.toFixed(1)});
            float lay = gGroove * 2.0;
            vec4 q = mix(texture(tPaveLUT, vec3(uvL, lay)), texture(tPaveLUT, vec3(uvL, lay + 1.0)), gRub);
            q.ga = mix(q.ga, vec2(1.0), gWetMask);
            reflectedLight.directDiffuse *= q.r; reflectedLight.directSpecular *= q.g;
            reflectedLight.indirectDiffuse *= q.b; reflectedLight.indirectSpecular *= q.a;
            occ = 1.0;
          }
          #endif
          reflectedLight.indirectSpecular *= mix(occ, 1.0, gWetMask);
          #if PAVE_DBG == 8
          reflectedLight.indirectSpecular *= 0.0;
          #endif
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uNight > 0.001) totalEmissiveRadiance += diffuseColor.rgb * poolLight(vField) * uNight;`);
  };
  mat.customProgramCacheKey = () => 'scn-pave';
  return mat;
}

/**
 * Pavement geometry for one airport from layout rects (+ roads + lots), positions airport-local.
 */
export function buildPavementGeometry(L) {
  const pos = [], loc = [], info = [], edge = [], idx = [];
  let seedN = 0, lastRwy = null;
  const addRect = (r, kindName, y, ed = [0, 0, 0, 0]) => {
    const kind = KIND_ID[kindName];
    const h = r.hdg * DEG, dx = Math.sin(h), dz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const nl = Math.max(1, Math.ceil(r.len / 120)), nw = Math.max(1, Math.ceil(r.wid / 120));
    const base = pos.length / 3;
    const seed = (seedN++ * 7) % 97;
    for (let j = 0; j <= nw; j++) for (let i = 0; i <= nl; i++) {
      const a = -r.len / 2 + (i / nl) * r.len, c = -r.wid / 2 + (j / nw) * r.wid;
      pos.push(r.x + dx * a + rx * c, y, r.z + dz * a + rz * c);
      loc.push(a, c);
      info.push(kind, r.len, r.wid, seed);
      edge.push(...ed);
    }
    for (let j = 0; j < nw; j++) for (let i = 0; i < nl; i++) {
      const a = base + j * (nl + 1) + i, b = a + 1, c = a + (nl + 1), d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  };
  // runway shoulders: which side the runway is on and where its edge lights stand (lightplan.js: 1.2 m outside the
  // edge, from threshold to threshold at <= 60 m spacing) -> light bases and the sealed cable slot between them
  for (const r of L.pave) {
    let ed;
    if (r.kind === 'rwy' || r.kind === 'rwyConcrete') lastRwy = r;
    if (r.kind === 'shoulder' && !r.edge && lastRwy) {
      const h = r.hdg * DEG, rx = Math.cos(h), rz = Math.sin(h);
      const side = Math.sign((lastRwy.x - r.x) * rx + (lastRwy.z - r.z) * rz) || 1;
      const n = Math.ceil(lastRwy.len / 60);
      ed = [side, (r.len - lastRwy.len) / 2, lastRwy.len / n, 1.2];
    }
    addRect(r, r.kind, LAYER_Y[r.layer] ?? 0.02, ed);
  }
  for (const R of L.roads) {
    for (let i = 0; i + 1 < R.pts.length; i++) {
      const a = R.pts[i], b = R.pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      addRect({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, hdg: Math.atan2(dx, -dz) / DEG, len: len + R.wid, wid: R.wid }, 'road', LAYER_Y[0]);
    }
  }
  for (const P of L.parkingLots) addRect({ ...P }, 'lot', LAYER_Y[0] + 0.002);
  for (const t of L.fillets) {
    const base = pos.length / 3;
    for (const p of t) { pos.push(p.x, LAYER_Y[3] - 0.002, p.z); loc.push(0, 0); info.push(KIND_ID.twy, 1, 1, 3); edge.push(0, 0, 0, 0); }
    // keep the winding facing up
    const cr = (t[1].x - t[0].x) * (t[2].z - t[0].z) - (t[1].z - t[0].z) * (t[2].x - t[0].x);
    if (cr < 0) idx.push(base, base + 1, base + 2); else idx.push(base, base + 2, base + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aLocal', new THREE.Float32BufferAttribute(loc, 2));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 4));
  // the first runway's axis in world xz: the pavement reflectance LUT is baked about it (grooves run across it)
  const r0 = L.pave.find((r) => r.kind === 'rwy' || r.kind === 'rwyConcrete');
  if (r0) g.userData.rwyAxis = [Math.sin(r0.hdg * DEG), -Math.cos(r0.hdg * DEG)];
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// --- paint ------------------------------------------------------------------------------------------------------------
const PAINT_COLORS = { w: [0.72, 0.72, 0.70], y: [0.8, 0.53, 0.05], r: [0.5, 0.05, 0.04], k: [0.02, 0.02, 0.02], s: [0.012, 0.011, 0.01] };

export function buildPaintGeometry(L, quads) {
  const n = quads.length;
  const pos = new Float32Array(n * 12), col = new Float32Array(n * 12), uv = new Float32Array(n * 8);
  const axis = new Float32Array(n * 16), corner = new Float32Array(n * 8), rub = new Float32Array(n * 16);
  const idx = new Uint32Array(n * 6);
  const rw = L.runways;
  quads.forEach((q, k) => {
    const h = q.hdg * DEG, dx = Math.sin(h), dz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const hl = q.len / 2, hw = q.wid / 2;
    const uvr = glyphUV(q.glyph ?? null, !!q.outline);
    const c = PAINT_COLORS[q.col] || PAINT_COLORS.w;
    const R = q.rw != null ? rw[q.rw] : null;
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]]; // [sl (along), sw (across)]
    corners.forEach(([sl, sw], j) => {
      const v = k * 4 + j;
      const x = q.x + dx * hl * sl + rx * hw * sw, z = q.z + dz * hl * sl + rz * hw * sw;
      pos.set([x, PAINT_Y, z], v * 3);
      col.set(c, v * 3);
      // glyph "up" = +along (sl = +1 → top of glyph = v1), glyph right = +across (sw = +1 → u1)
      uv.set([sw < 0 ? uvr[0] : uvr[2], sl < 0 ? uvr[1] : uvr[3]], v * 2);
      axis.set([dx, dz, hl, q.glyph != null ? -1 : hw], v * 4);
      corner.set([sl, sw], v * 2);
      if (R) {
        const E0 = R.ends[0];
        const ox = x - E0.thr.x, oz = z - E0.thr.z;
        rub.set([ox * E0.dir.x + oz * E0.dir.z, -ox * E0.dir.z + oz * E0.dir.x, R.len, R.wid], v * 4);
      } else rub.set([-1, 0, 1, 1], v * 4);
    });
    const b = k * 4;
    idx.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], k * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const nrm = new Float32Array(n * 12); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aAxis', new THREE.BufferAttribute(axis, 4));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aRub', new THREE.BufferAttribute(rub, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

export function makePaintMaterial(ctx, shared, poolsLocal) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, poolsLocal);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aAxis; attribute vec2 aCorner; attribute vec4 aRub;
        uniform float uPixAngle;
        varying vec2 vPUv; varying float vCover; varying vec4 vRub; varying vec2 vField;
        ${CURVATURE_GLSL}
        float footprint(vec2 u, vec3 toV, float p) {
          vec2 hdir = normalize(toV.xz + 1e-5);
          float dist = length(toV);
          float sinT = clamp(abs(toV.y) / dist, 0.0, 1.0);
          float c = dot(u, hdir);
          return p / sqrt(max(sinT * sinT * c * c + (1.0 - c * c), 0.0004));
        }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vPUv = uv; vCover = 1.0;
          vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
          vec3 toV = wp0.xyz - cameraPosition;
          float p = length(toV) * uPixAngle;
          if (aAxis.w > 0.0) {
            vec2 D = aAxis.xy; vec2 Rr = vec2(-D.y, D.x);
            float hl = aAxis.z, hw = aAxis.w;
            float fl = 0.75 * footprint(D, toV, p), fwd = 0.75 * footprint(Rr, toV, p);
            float hl2 = max(hl, fl), hw2 = max(hw, fwd);
            transformed.xz += D * aCorner.x * (hl2 - hl) + Rr * aCorner.y * (hw2 - hw);
            vCover = (hl / hl2) * (hw / hw2);
          }
          vRub = aRub; vField = position.xz;
        }
        ${CURV_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tAtlas; uniform sampler2D tNoise; uniform sampler2D tDefect; uniform float uWet; uniform float uNight;
        varying vec2 vPUv; varying float vCover; varying vec4 vRub; varying vec2 vField;
        float scnHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        ${RUBBER_GLSL} ${POOLS_GLSL}`)
      .replace('#include <map_fragment>', `
        {
          float a = texture(tAtlas, vPUv).a;
          vec4 nA = texture(tNoise, vField / 2.3);
          vec4 nB = texture(tNoise, vField / 31.0 + 0.7);
          // worn paint: thinner in blotches, chipped down to the pavement in small flakes (fades out with distance so
          // far markings keep their average coverage instead of shimmering)
          float wear = 0.74 + 0.26 * smoothstep(0.2, 0.7, nA.g) * (0.7 + 0.3 * nB.b);
          float chipN = texture(tNoise, vField / 0.83 + 0.21).r;
          float fwC = fwidth(vField.x) + fwidth(vField.y);
          float chip = smoothstep(0.66, 0.72, chipN) * (1.0 - smoothstep(0.02, 0.12, fwC));
          wear *= 1.0 - 0.75 * chip;
          diffuseColor.a *= a * vCover * wear;
          // crazing: old paint breaks up into a fine crack network (visible close up, a mean thinning further off)
          float craze = smoothstep(0.5, 0.8, texture(tNoise, vField / 0.61 + 0.17).a);
          diffuseColor.a *= 1.0 - mix(0.15, 0.7 * craze, 1.0 - smoothstep(0.01, 0.06, fwC));
          // uneven film: streaks along the direction the paint machine ran, grime
          diffuseColor.rgb *= 0.86 + 0.14 * smoothstep(0.25, 0.75, nB.g) - 0.06 * texture(tNoise, vField / 7.0 + 0.5).b;
          if (vRub.x >= 0.0) {
            // the pavement's sealed cracks run on through the markings (same lane strips of the defect map)
            vec2 sl = vec2(vRub.x, vRub.y + vRub.w * 0.5);
            float rseed = mod(floor(vRub.z + 0.5) * 7.0 + floor(vRub.w + 0.5) * 13.0, 97.0);
            float li = floor(sl.y / 7.5), yIn = sl.y - li * 7.5;
            float laneH = scnHash(vec2(li, rseed + 0.5)), laneH2 = scnHash(vec2(li + 7.1, rseed + 3.0));
            vec4 df = texture(tDefect, vec2((sl.x + 977.0 * laneH2) / ${DEFECT.len.toFixed(1)}, (yIn + 23.0 * laneH) / ${DEFECT.wid.toFixed(1)}));
            diffuseColor.a *= 1.0 - 0.9 * df.r;
            float rub = rubberAt(vRub.x, vRub.y, vRub.z, vRub.w);
            float stri = texture(tNoise, vec2(vRub.x / 47.0, vRub.y / 0.11)).r;
            rub *= mix(1.0, 0.55 + 0.9 * stri, 1.0 - smoothstep(0.02, 0.1, fwC));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02), clamp(rub, 0.0, 1.0) * 0.88);
          }
          diffuseColor.rgb *= (0.9 + 0.1 * nA.r) * mix(1.0, 0.7, uWet);
        }`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(roughness, 0.15, uWet);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uNight > 0.001) totalEmissiveRadiance += diffuseColor.rgb * poolLight(vField) * uNight;`);
  };
  mat.customProgramCacheKey = () => 'scn-paint';
  return mat;
}

// --- fringe -------------------------------------------------------------------------------------------------------------
/**
 * Soft verge around every paved rectangle: a ring of quads just above the ground, fading from trampled soil and
 * dead grass at the pavement edge to nothing a few metres out, so pavement sits in the turf instead of on it.
 * Drawn after the opaque pass with depthWrite off; where it runs under neighbouring pavement the depth test hides it.
 */
export function buildFringeGeometry(L) {
  const pos = [], fade = [], idx = [];
  const ring = (cx, cz, hdg, len, wid, w) => {
    const h = hdg * DEG, dx = Math.sin(h), dz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const P = (a, c) => [cx + dx * a + rx * c, 0.006, cz + dz * a + rz * c];
    const hl = len / 2, hw = wid / 2;
    const inner = [P(-hl, -hw), P(hl, -hw), P(hl, hw), P(-hl, hw)];
    const outer = [P(-hl - w, -hw - w), P(hl + w, -hw - w), P(hl + w, hw + w), P(-hl - w, hw + w)];
    for (let k = 0; k < 4; k++) {
      const base = pos.length / 3, k2 = (k + 1) % 4;
      for (const [p, f] of [[inner[k], 0], [inner[k2], 0], [outer[k], 1], [outer[k2], 1]]) { pos.push(...p); fade.push(f); }
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  };
  for (const r of L.pave) {
    const w = r.kind === 'rwy' || r.kind === 'rwyConcrete' ? 5 : r.kind === 'shoulder' ? 7 : r.kind === 'apron' || r.kind === 'apronA' ? 5 : r.kind === 'blast' ? 6 : 4;
    ring(r.x, r.z, r.hdg, r.len, r.wid, w);
  }
  for (const R of L.roads) for (let i = 0; i + 1 < R.pts.length; i++) {
    const a = R.pts[i], b = R.pts[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    ring((a.x + b.x) / 2, (a.z + b.z) / 2, Math.atan2(dx, -dz) / DEG, Math.hypot(dx, dz) + R.wid, R.wid, 2.5);
  }
  for (const P of L.parkingLots) ring(P.x, P.z, P.hdg, P.len, P.wid, 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function makeFringeMaterial(ctx, shared) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -1 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aFade; varying float vFade; varying vec2 vFField;\n${CURVATURE_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvFade = aFade; vFField = position.xz;\n${CURV_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tNoise; uniform float uWet; varying float vFade; varying vec2 vFField;')
      .replace('#include <map_fragment>', `
        {
          vec4 n1 = texture(tNoise, vFField / 5.3 + 0.17), n2 = texture(tNoise, vFField / 41.0 + 0.63);
          float edge = vFade + (n1.g - 0.5) * 0.55 + (n2.b - 0.5) * 0.35;
          // (the terrain draws the worn verge, mowing and thinning turf from the airfield distance map: this band only
          // adds the grit and dust thrown off the pavement within the first metre or two)
          float a = 1.0 - smoothstep(0.02, 0.45, edge);
          // trampled soil right at the edge, sun-bleached dead grass further out
          vec3 soil = vec3(0.12, 0.1, 0.075) * (0.8 + 0.4 * n1.r), dry = vec3(0.2, 0.18, 0.11) * (0.85 + 0.3 * n2.g);
          diffuseColor.rgb = mix(soil, dry, smoothstep(0.1, 0.6, vFade + 0.3 * n1.b)) * mix(1.0, 0.6, uWet);
          diffuseColor.a = a * 0.5;
        }`);
  };
  mat.customProgramCacheKey = () => 'scn-fringe';
  return mat;
}
