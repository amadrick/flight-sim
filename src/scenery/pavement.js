// Pavement (runways, taxiways, aprons, shoulders, roads) and painted markings.
// Both are MeshStandardMaterial with onBeforeCompile hooks so sun, shadows and IBL work; detail is procedural in the
// fragment shader (world-anchored noise texture, slab joints, seams, patching, rubber deposits, cracks, wetness, apron
// floodlight pools). Paint quads widen to a minimum on-screen footprint (with matching alpha) so markings never alias.
import * as THREE from 'three';
import { CURVATURE_GLSL } from '../core/glsl.js';
import { glyphUV } from './textures.js';

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
// rubber deposits: a0 = metres from end-0 threshold, cr = metres from centreline, len/wid of the runway
float rubberAmount(float a0, float cr, float len, float wid, float streak) {
  float a1 = len - a0;
  float z0 = smoothstep(90.0, 260.0, a0) * (1.0 - smoothstep(650.0, 1150.0, a0));
  float z1 = smoothstep(90.0, 260.0, a1) * (1.0 - smoothstep(650.0, 1150.0, a1));
  float zone = max(z0, z1);
  float lat = exp(-pow(cr / (wid * 0.2), 2.0));
  float gear = exp(-pow((abs(cr) - wid * 0.11) / (wid * 0.06), 2.0));
  return zone * clamp(0.55 * lat + 0.6 * gear, 0.0, 1.0) * smoothstep(0.25, 0.75, streak);
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
  return {
    tNoise: { value: noiseTex },
    tAtlas: { value: atlasTex },
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
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, local);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aLocal; attribute vec4 aInfo;
        varying vec2 vLocal; varying vec4 vInfo; varying vec2 vField;
        ${CURVATURE_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocal = aLocal; vInfo = aInfo; vField = position.xz;
        ${CURV_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tNoise; uniform float uWet; uniform float uNight;
        varying vec2 vLocal; varying vec4 vInfo; varying vec2 vField;
        ${RUBBER_GLSL} ${POOLS_GLSL} ${BUMP_GLSL}
        float gWetMask; float gRough; float gHeight;`)
      .replace('#include <map_fragment>', `
        {
          float kind = floor(vInfo.x + 0.5); float plen = vInfo.y; float pwid = vInfo.z; float seed = floor(vInfo.w + 0.5);
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
          bool concrete = (kind > 0.5 && kind < 1.5) || (kind > 2.5 && kind < 3.5);
          if (concrete) {
            // Portland cement concrete: 7.5 m (runway) / 6 m (apron) slabs, sealed joints, per-slab cure tone,
            // corner breaks, tar over-banding on re-sealed joints, oil and fuel stains, fine pitting
            float slab = kind < 1.5 ? 7.5 : 6.0;
            vec2 cell = floor(sl / slab);
            vec2 inC = sl - cell * slab;
            float h1 = scnHash(cell + seed), h2 = scnHash(cell * 1.37 + seed + 5.1), h3 = scnHash(cell * 2.11 + 9.7);
            float tone = 0.86 + 0.24 * h1;
            vec3 base = kind < 1.5 ? vec3(0.25, 0.245, 0.232) : vec3(0.215, 0.21, 0.198);
            col = base * tone * (0.8 + 0.4 * aggr) * (0.88 + 0.24 * nB.g) * (0.9 + 0.2 * nC.b);
            col *= vec3(1.0, 0.99 + 0.02 * h2, 0.97 + 0.05 * h3);                         // cement batches differ
            float jx = scnLines(sl.x + 0.01, slab, 0.02), jy = scnLines(sl.y + 0.01, slab, 0.02);
            float ob = max(scnLines(sl.x + 0.06, slab, 0.14) * step(0.55, h2), scnLines(sl.y + 0.06, slab, 0.14) * step(0.6, h3));
            float j = max(jx, jy);
            col *= 1.0 - 0.55 * j;
            col = mix(col, vec3(0.05, 0.048, 0.045), 0.8 * ob * (0.7 + 0.3 * nD.r));
            // spalled corners and the odd shattered slab (dark crack lines)
            float corner = (1.0 - smoothstep(0.0, 0.9, min(inC.x, slab - inC.x))) * (1.0 - smoothstep(0.0, 0.9, min(inC.y, slab - inC.y)));
            col *= 1.0 - 0.25 * corner * step(0.7, h1);
            float crk = smoothstep(0.75, 0.95, crackNet) * step(0.9, h3);
            col *= 1.0 - 0.3 * crk;
            // stains: oil and hydraulic fluid on aprons, tyre scuffs; rust streaks from tie-downs are rare
            float stain = smoothstep(0.62, 0.82, nB.b * 0.55 + nD.g * 0.45) * (kind > 2.5 ? 1.0 : 0.35);
            col *= 1.0 - 0.45 * stain;
            col *= 1.0 - 0.12 * smoothstep(0.5, 0.9, nD.b);
            hgt -= (j + ob * 0.3) * 0.008 + crk * 0.004;
            rough = 0.84 + 0.1 * aggr - 0.3 * stain - 0.25 * ob;
          } else {
            // asphalt: aggregate, paving-lane seams, patches (fresh = dark, old = grey), tar-sealed crack network
            float base = kind < 0.5 ? 0.12 : kind < 2.5 ? 0.125 : kind < 4.5 ? 0.15 : kind < 5.5 ? 0.115 : kind < 6.5 ? 0.1 : kind < 7.5 ? 0.11 : 0.135;
            col = vec3(base) * vec3(1.0, 0.985, 0.955) * (0.7 + 0.6 * aggr) * (0.84 + 0.32 * nB.g) * (0.88 + 0.24 * nC.b);
            float lane = kind < 2.5 ? 7.5 : 5.0;
            float seam = scnLines(sl.y + 0.06, lane, 0.12);
            col *= 1.0 - 0.28 * seam;
            // patches: random rectangles inside a coarse grid, soft-edged, with a sealed border
            vec2 pg = vec2(48.0, lane);
            vec2 pc = floor(sl / pg);
            float ph = scnHash(pc + seed * 1.3);
            float patchK = 0.0, border = 0.0;
            if (ph > 0.84) {
              vec2 lo = pc * pg + vec2(4.0 + 16.0 * scnHash(pc + 3.3), 0.25 + 1.2 * scnHash(pc + 7.7));
              vec2 hi = lo + vec2(7.0 + 22.0 * scnHash(pc + 1.9), lane - 0.5 - 1.6 * scnHash(pc + 4.4));
              vec2 fw = fwidth(sl) + 0.02;
              vec2 inn = smoothstep(lo, lo + fw, sl) * (1.0 - smoothstep(hi - fw, hi, sl));
              patchK = inn.x * inn.y;
              vec2 bo = smoothstep(lo - 0.08 - fw, lo - 0.08, sl) * (1.0 - smoothstep(hi + 0.08, hi + 0.08 + fw, sl));
              border = clamp(bo.x * bo.y - patchK, 0.0, 1.0);
            }
            float fresh = step(0.93, ph);
            col *= mix(1.0, mix(1.18 + 0.1 * nD.r, 0.62 + 0.08 * nD.r, fresh), patchK);
            col = mix(col, vec3(0.035), border * 0.85);
            // sealed cracks: black, glossy tar bands following the crack network
            float crack = smoothstep(0.5, 0.82, crackNet) * crackZone * (1.0 - patchK);
            col = mix(col, vec3(0.032, 0.031, 0.03), crack * 0.85);
            // transverse thermal cracks every few tens of metres on older surfaces
            float tcr = scnLines(sl.x + 3.0 * nB.g, 31.0, 0.05) * step(0.45, scnHash(vec2(floor(sl.x / 31.0), seed)));
            col = mix(col, vec3(0.035), tcr * 0.7 * (1.0 - patchK));
            hgt -= crack * 0.003 + seam * 0.002;
            rough = 0.9 + 0.06 * aggr - 0.35 * crack - 0.3 * border - 0.08 * fresh * patchK;
          }
          // runways: rubber deposits in both touchdown zones, streaked along the gear tracks; grooved surface is a
          // touch darker than the taxiways
          if (kind < 1.5) {
            float streak = texture(tNoise, vec2(vLocal.x / 140.0, vLocal.y / 1.1)).g;
            float streak2 = texture(tNoise, vec2(vLocal.x / 37.0 + 0.5, vLocal.y / 0.45)).r;
            float rub = rubberAmount(sl.x, vLocal.y, plen, pwid, streak + 0.25 * nB.g);
            rub = clamp(rub * (0.75 + 0.5 * streak2), 0.0, 1.0);
            col *= 0.94;
            col = mix(col, vec3(0.022, 0.021, 0.02), rub * (concrete ? 0.92 : 0.8));
            rough = mix(rough, 0.55, rub);
            // centreline wear: a darker band where nose gears track, faint oil drips along it
            col *= 1.0 - 0.12 * exp(-pow(vLocal.y / 2.2, 2.0)) * (0.6 + 0.4 * nB.r);
          }
          // shoulders and blast pads: weathered, lighter, loose grit
          if (kind > 3.5 && kind < 5.5) col *= 0.88 + 0.28 * nB.b;
          // wetness: darker, smoother, puddles in low spots (and along the sealed cracks)
          float puddle = smoothstep(0.55, 0.72, nC.b * 0.7 + nB.g * 0.3);
          gWetMask = uWet * (0.55 + 0.45 * puddle);
          col *= mix(1.0, 0.55, gWetMask);
          rough = mix(clamp(rough, 0.3, 1.0), 0.08, gWetMask * (0.5 + 0.5 * puddle));
          gRough = rough; gHeight = hgt * (1.0 - gWetMask * puddle);
          diffuseColor.rgb *= col;
        }`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = gRough;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = scnBump(-vViewPosition, normal, gHeight);`)
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
  const pos = [], loc = [], info = [], idx = [];
  let seedN = 0;
  const addRect = (r, kindName, y) => {
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
    }
    for (let j = 0; j < nw; j++) for (let i = 0; i < nl; i++) {
      const a = base + j * (nl + 1) + i, b = a + 1, c = a + (nl + 1), d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  };
  for (const r of L.pave) addRect(r, r.kind, LAYER_Y[r.layer] ?? 0.02);
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
    for (const p of t) { pos.push(p.x, LAYER_Y[3] - 0.002, p.z); loc.push(0, 0); info.push(KIND_ID.twy, 1, 1, 3); }
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
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// --- paint ------------------------------------------------------------------------------------------------------------
const PAINT_COLORS = { w: [0.78, 0.78, 0.76], y: [0.8, 0.53, 0.05], r: [0.5, 0.05, 0.04], k: [0.02, 0.02, 0.02], s: [0.012, 0.011, 0.01] };

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
        uniform sampler2D tAtlas; uniform sampler2D tNoise; uniform float uWet; uniform float uNight;
        varying vec2 vPUv; varying float vCover; varying vec4 vRub; varying vec2 vField;
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
          if (vRub.x >= 0.0) {
            float streak = texture(tNoise, vec2((vRub.x - vRub.z * 0.5) / 90.0, vRub.y / 2.0)).g;
            float rub = rubberAmount(vRub.x, vRub.y, vRub.z, vRub.w, streak + 0.25 * nB.g);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03), rub * 0.75);
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
          float a = 1.0 - smoothstep(0.05, 0.85, edge);
          // trampled soil right at the edge, sun-bleached dead grass further out
          vec3 soil = vec3(0.12, 0.1, 0.075) * (0.8 + 0.4 * n1.r), dry = vec3(0.2, 0.18, 0.11) * (0.85 + 0.3 * n2.g);
          diffuseColor.rgb = mix(soil, dry, smoothstep(0.1, 0.6, vFade + 0.3 * n1.b)) * mix(1.0, 0.6, uWet);
          diffuseColor.a = a * 0.85;
        }`);
  };
  mat.customProgramCacheKey = () => 'scn-fringe';
  return mat;
}
