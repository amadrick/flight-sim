// Pavement (runways, taxiways, aprons, shoulders, roads) and painted markings.
// Both are MeshStandardMaterial with onBeforeCompile hooks so sun, shadows and IBL work; detail is procedural in the
// fragment shader (world-anchored noise texture, slab joints, seams, patching, rubber deposits, cracks, wetness, apron
// floodlight pools). Paint quads widen to a minimum on-screen footprint (with matching alpha) so markings never alias.
import * as THREE from 'three';
import { CURVATURE_GLSL } from '../core/glsl.js';
import { glyphUV } from './textures.js';

const DEG = Math.PI / 180;
export const KIND_ID = { rwy: 0, rwyConcrete: 1, twy: 2, apron: 3, shoulder: 4, blast: 5, road: 6, lot: 7 };
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
          float crack = texture(tNoise, F / 6.3 + 0.13).a * smoothstep(0.45, 0.8, texture(tNoise, F / 90.0 + 0.4).g);
          float aggr = nA.r;
          vec3 col; float rough = 0.9; float hgt = aggr * 0.006;
          bool concrete = (kind > 0.5 && kind < 1.5) || (kind > 2.5 && kind < 3.5);
          if (concrete) {
            // portland cement concrete: slabs with sealed joints, per-slab tone, stains
            float slab = kind < 1.5 ? 7.5 : 6.0;
            vec2 sl = vLocal + vec2(plen, pwid) * 0.5;
            vec2 cell = floor(sl / slab);
            float tone = 0.92 + 0.14 * scnHash(cell + seed);
            float j = max(scnLines(sl.x, slab, 0.025), scnLines(sl.y, slab, 0.025));
            col = (kind < 1.5 ? vec3(0.42, 0.41, 0.385) : vec3(0.36, 0.355, 0.335)) * tone * (0.86 + 0.22 * aggr) * (0.88 + 0.24 * nB.g) * (0.9 + 0.2 * nC.b);
            col *= 1.0 - 0.4 * j;
            col *= 1.0 - 0.35 * smoothstep(0.62, 0.8, nB.b) * (kind > 2.5 ? 1.0 : 0.4);      // oil / fuel stains
            col *= 1.0 - 0.4 * crack * step(0.8, scnHash(cell * 1.7 + 3.1));
            hgt -= j * 0.01;
            rough = 0.82 + 0.1 * aggr;
          } else {
            // asphalt: aggregate, paving-lane seams, patching, sealed cracks
            float base = kind < 0.5 ? 0.115 : kind < 2.5 ? 0.125 : kind < 4.5 ? 0.15 : kind < 5.5 ? 0.13 : 0.1;
            col = vec3(base) * vec3(1.0, 0.99, 0.96) * (0.75 + 0.5 * aggr) * (0.85 + 0.3 * nB.g) * (0.88 + 0.24 * nC.b);
            float lane = kind < 2.5 ? 7.5 : 5.0;
            float seam = scnLines(vLocal.y + pwid * 0.5 + lane * 0.5, lane, 0.12);
            col *= 1.0 - 0.3 * seam;
            vec2 pc = floor((vLocal + vec2(plen, pwid) * 0.5) / vec2(55.0, lane)) + 0.5;
            float patchK = step(0.9, scnHash(pc + seed * 1.3));
            col *= mix(1.0, 0.72 + 0.1 * nB.r, patchK);
            col *= 1.0 - 0.4 * crack * (1.0 - patchK);
            rough = 0.88 + 0.08 * aggr;
          }
          // rubber deposits in the touchdown zones (runways only)
          if (kind < 1.5) {
            float streak = texture(tNoise, vec2(vLocal.x / 90.0, vLocal.y / 2.0)).g;
            float rub = rubberAmount(vLocal.x + plen * 0.5, vLocal.y, plen, pwid, streak + 0.25 * nB.g);
            col = mix(col, vec3(0.028, 0.027, 0.026), rub * (concrete ? 0.9 : 0.7));
            rough = mix(rough, 0.6, rub);
          }
          // shoulders: weathered, a little lighter, with loose debris
          if (kind > 3.5 && kind < 4.5) col *= 0.9 + 0.25 * nB.b;
          // wetness: darker, smoother, puddles in low spots
          float puddle = smoothstep(0.55, 0.72, nC.b * 0.7 + nB.g * 0.3);
          gWetMask = uWet * (0.55 + 0.45 * puddle);
          col *= mix(1.0, 0.55, gWetMask);
          rough = mix(rough, 0.12, gWetMask * (0.5 + 0.5 * puddle));
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
const PAINT_COLORS = { w: [0.8, 0.8, 0.78], y: [0.85, 0.58, 0.06], r: [0.55, 0.05, 0.04], k: [0.02, 0.02, 0.02] };

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
          float wear = 0.78 + 0.22 * smoothstep(0.2, 0.7, nA.g) * (0.7 + 0.3 * nB.b);
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
