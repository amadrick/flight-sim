// 3-D buildings near the camera: ONE instanced draw call (+ one in the sun shadow pass) of a box with a gable roof
// (14 triangles; the ridge height is zero for flat-roofed blocks). Every instance comes from the settlement layout in
// settle.js (the same lot function the surface shader paints roofs from), generated per 512 m grid cell on demand and
// cached. Buildings grow out of their painted footprints over the outer fifth of the radius (slant distance), where
// the painted roof fades into a dark footprint, so there is no pop. Walls get procedural windows (lit at night).
import * as THREE from 'three';
import { CURVATURE_GLSL } from '../core/glsl.js';
import { SETTLE_CELL, SETTLE_COLOR_GLSL } from './settle.js';

const TIERS = {
  low: { radius: 650, cap: 2600 }, medium: { radius: 1000, cap: 6000 }, high: { radius: 1400, cap: 10500 }, ultra: { radius: 2000, cap: 16000 },
};
const STRIDE = 16, TRIS = 14, SINK = 3.0;

function unitBuilding() {
  const pos = [], nor = [], face = [], idx = [];
  const tri = (a, b, c, n, f) => {
    // wind counter-clockwise seen from outside (along n)
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const flip = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0;
    const base = pos.length / 3;
    for (const v of flip ? [a, c, b] : [a, b, c]) { pos.push(...v); nor.push(...n); face.push(f); }
    idx.push(base, base + 1, base + 2);
  };
  const quad = (a, b, c, d, n, f) => { tri(a, b, c, n, f); tri(a, c, d, n, f); };
  for (const s of [1, -1]) {
    quad([-1, 0, s], [1, 0, s], [1, 1, s], [-1, 1, s], [0, 0, s], 1);          // walls along the street
    quad([s, 0, -1], [s, 0, 1], [s, 1, 1], [s, 1, -1], [s, 0, 0], 0);          // end walls
    quad([-1, 1, s], [1, 1, s], [1, 2, 0], [-1, 2, 0], [0, 1, s], 2);          // roof planes
    tri([s, 1, -1], [s, 1, 1], [s, 2, 0], [s, 0, 0], 3);                       // gables
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), face: new Float32Array(face), idx: new Uint16Array(idx) };
}

const VERT_COMMON = /* glsl */`
  attribute vec4 iA;       // x, ground y, z (relative to the mesh), rotation of the street frame
  attribute vec4 iB;       // half size along / across the street, eaves height, ridge height above the eaves
  attribute vec4 iC;       // lot hashes
  attribute vec4 iD;       // kind, tropic, -, -
  attribute float aFace;
  uniform float uBFade;
  ${CURVATURE_GLSL}
  vec3 bldPos(out float cr, out float sr) {
    vec3 base = iA.xyz + modelMatrix[3].xyz;
    float grow = 1.0 - smoothstep(0.8 * uBFade, uBFade, distance(base, cameraPosition));
    float yy = position.y < 0.5 ? -${SINK.toFixed(1)} : (position.y < 1.5 ? iB.z : iB.z + iB.w) * grow;
    vec3 lp = vec3(position.x * iB.x, yy, position.z * iB.y);
    cr = cos(iA.w); sr = sin(iA.w);
    vec3 p = vec3(cr * lp.x - sr * lp.z, lp.y, sr * lp.x + cr * lp.z) + iA.xyz;
    p.y -= curvatureDrop(distance(base.xz, cameraPosition.xz));
    return p;
  }`;

export function createBuildings(ctx, { settle, heightAt }) {
  const tier = TIERS[ctx.quality.level] || TIERS.high;
  const raw = ctx.params.raw || {};
  const radius = raw.bldgR ? +raw.bldgR : tier.radius, cap = tier.cap;
  const u = unitBuilding();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(u.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(u.nor, 3));
  geo.setAttribute('aFace', new THREE.BufferAttribute(u.face, 1));
  geo.setIndex(new THREE.BufferAttribute(u.idx, 1));
  const data = new Float32Array(cap * STRIDE);
  const ib = new THREE.InstancedInterleavedBuffer(data, STRIDE, 1); ib.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(ib, 4, 0));
  geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(ib, 4, 4));
  geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(ib, 4, 8));
  geo.setAttribute('iD', new THREE.InterleavedBufferAttribute(ib, 4, 12));
  geo.instanceCount = 0;

  const U = { uBFade: { value: radius }, uBNight: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_COMMON}\n varying vec3 vBP; varying vec4 vBH; varying vec4 vBS; varying vec3 vBF;`)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        float bcr, bsr; vec3 bpos = bldPos(bcr, bsr);
        vec3 bn = normal;
        if (aFace > 1.5 && aFace < 2.5) bn = normalize(vec3(0.0, iB.y, sign(normal.z) * iB.w));
        vec3 objectNormal = vec3(bcr * bn.x - bsr * bn.z, bn.y, bsr * bn.x + bcr * bn.z);`)
      .replace('#include <begin_vertex>', /* glsl */`
        vec3 transformed = bpos;
        vBP = vec3(position.x * iB.x, bpos.y - iA.y, position.z * iB.y);
        vBP.y = position.y < 0.5 ? -${SINK.toFixed(1)} : position.y < 1.5 ? iB.z : iB.z + iB.w;
        vBH = iC; vBS = iB; vBF = vec3(aFace, iD.x, iD.y);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        varying vec3 vBP; varying vec4 vBH; varying vec4 vBS; varying vec3 vBF;
        uniform float uBNight;
        ${SETTLE_COLOR_GLSL}
        vec2 bldHash(vec2 p) {
          uvec2 q = uvec2(ivec2(p));
          uint h = q.x * 0x8da6b343u + q.y * 0xd8163841u + 0x9e3779b9u;
          h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
          return vec2(float(h & 0xffffu), float(h >> 16)) / 65536.0;
        }`)
      .replace('#include <map_fragment>', /* glsl */`
        float bRoofK = step(0.01, vBS.w), bFace = vBF.x;
        vec3 bcol; float brough = 0.9; vec3 bemis = vec3(0.0);
        if (bFace > 1.5 && bFace < 2.5) {
          bcol = settleRoofColor(vBH.xy, vBH.zw, bRoofK, vBF.z);
          float fw = fwidth(vBP.z) + 0.001;
          bcol *= 1.0 - 0.14 * bRoofK * step(0.5, fract(vBP.z * 3.1)) * smoothstep(0.9, 0.25, fw * 3.1);
          float inside = min(vBS.x - abs(vBP.x), vBS.y - abs(vBP.z));
          bcol *= 1.0 - 0.25 * (1.0 - bRoofK) * (1.0 - smoothstep(0.0, 0.7, inside));
          vec2 pl = floor((vBP.xz + vBS.xy) / 3.2);
          bcol = mix(bcol, vec3(0.30, 0.31, 0.32), (1.0 - bRoofK) * step(0.86, bldHash(pl + vBH.xy * 977.0).x) * step(1.2, inside));
          brough = 0.8;
        } else {
          bcol = settleWallColor(vBH.xy, vBH.zw, bRoofK);
          float tall = step(24.0, vBS.z);
          float wu = (bFace < 0.5 || bFace > 2.5) ? vBP.z : vBP.x, wv = vBP.y;
          float bay = mix(mix(3.1, 2.5, bRoofK), 1.6, tall), storey = mix(3.4, 2.7, bRoofK);
          vec2 wq = vec2(wu / bay + 0.5, wv / storey);
          vec2 wf = fract(wq), wi = floor(wq);
          float fwu = fwidth(wq.x) + fwidth(wq.y);
          vec2 lo = mix(vec2(0.26, 0.30), vec2(0.06, 0.28), tall), hi = mix(vec2(0.74, 0.80), vec2(0.94, 0.86), tall);
          float win = step(lo.x, wf.x) * step(wf.x, hi.x) * step(lo.y, wf.y) * step(wf.y, hi.y);
          win *= step(0.2, wv) * step(wv, vBS.z - 0.25);                         // not below ground, not in the gable
          float winMean = (hi.x - lo.x) * (hi.y - lo.y) * step(0.2, wv) * step(wv, vBS.z - 0.25);
          float wk = smoothstep(0.35, 1.1, fwu);                                  // windows merge into the wall with distance
          win = mix(win, winMean, wk);
          vec2 wh = bldHash(wi + vBH.zw * 811.0 + bFace * 37.0);
          // glass: dark, some panes showing curtains / blinds
          vec3 glass = mix(vec3(0.030, 0.036, 0.042), vec3(0.20, 0.19, 0.17), step(0.72, wh.y) * (1.0 - wk));
          bcol *= 1.0 - 0.22 * smoothstep(0.9, 0.0, wv);                          // dirt and damp at the foot of the wall
          bcol = mix(bcol, glass, win);
          brough = mix(0.9, 0.18, win * (1.0 - wk));
          // lit windows at night: about a third of them, warm in houses, cooler in offices
          float lit = mix(step(wh.x, mix(0.38, 0.30, tall)), mix(0.38, 0.30, tall), wk);
          bemis = mix(vec3(1.0, 0.66, 0.34), vec3(0.95, 0.88, 0.70), max(tall, (1.0 - bRoofK) * step(0.5, wh.y))) * (win * lit * uBNight * (0.55 + 0.9 * wh.y));
        }
        diffuseColor.rgb = bcol;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = brough;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += bemis * 1.6;');
  };
  mat.customProgramCacheKey = () => 'skyward-buildings';
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_COMMON}`)
      .replace('#include <begin_vertex>', 'float bcr, bsr; vec3 transformed = bldPos(bcr, bsr);');
  };
  depthMat.customProgramCacheKey = () => 'skyward-buildings-depth';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'buildings'; mesh.frustumCulled = false; mesh.castShadow = !!ctx.quality.shadows; mesh.receiveShadow = true;
  mesh.customDepthMaterial = depthMat;
  mesh.visible = false;

  // ---- chunks: the buildings of one grid cell, positions relative to the cell corner -------------------------------
  const cache = new Map();
  const tmp = [];
  function chunk(ci, cj) {
    const key = cj * settle.NX + ci;
    let c = cache.get(key);
    if (c) { cache.delete(key); cache.set(key, c); return c; }
    tmp.length = 0;
    const x0 = settle.X0 + ci * SETTLE_CELL, z0 = settle.Z0 + cj * SETTLE_CELL;
    settle.buildingsInCell(ci, cj, (wx, wz, hx, hz, h, roofK, rot, h1x, h1y, h2x, h2y, kind) => {
      const c = Math.cos(rot), s = Math.sin(rot);
      // stand on the lowest corner of the footprint (the walls reach SINK m below it); never build in water
      let g = 1e9, gmax = -1e9;
      for (let k = 0; k < 4; k++) {
        const lx = (k & 1 ? hx : -hx), lz = (k & 2 ? hz : -hz);
        const y = heightAt(wx + c * lx - s * lz, wz + s * lx + c * lz);
        if (y < g) g = y; if (y > gmax) gmax = y;
      }
      if (g < 0.6 || gmax - g > SINK + 1.5) return;
      tmp.push(wx - x0, gmax - 0.15, wz - z0, rot, hx, hz, h - (gmax - g) * 0, roofK * hz * 0.58, h1x, h1y, h2x, h2y, kind, wz > 52000 ? 1 : 0, 0, 0);
    });
    c = { data: new Float32Array(tmp), n: tmp.length / STRIDE };
    cache.set(key, c);
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return c;
  }

  const stats = { instances: 0, triangles: 0, chunks: 0, radius, cap, genMs: 0 };
  let lastKey = null, pending = false, ax = 0, az = 0;
  const cells = [];
  function update(wx, cy, wz, org, night) {
    U.uBNight.value = night;
    const alt = cy - Math.max(heightAt(wx, wz), 0);
    if (alt > radius * 1.05) { mesh.visible = false; stats.instances = 0; stats.triangles = 0; lastKey = null; return; }
    const ci = Math.floor((wx - settle.X0) / SETTLE_CELL), cj = Math.floor((wz - settle.Z0) / SETTLE_CELL);
    const key = ci + ',' + cj;
    if (key !== lastKey || pending) {
      const t0 = performance.now();
      lastKey = key; pending = false;
      const m = Math.ceil(radius / SETTLE_CELL) + 1;
      cells.length = 0;
      for (let j = cj - m; j <= cj + m; j++) for (let i = ci - m; i <= ci + m; i++) {
        if (i < 0 || j < 0 || i >= settle.NX || j >= settle.NZ || settle.cellTown[j * settle.NX + i] < 0) continue;
        const dx = settle.X0 + (i + 0.5) * SETTLE_CELL - wx, dz = settle.Z0 + (j + 0.5) * SETTLE_CELL - wz, d = Math.hypot(dx, dz);
        if (d < radius + 0.75 * SETTLE_CELL) cells.push([d, i, j]);
      }
      cells.sort((a, b) => a[0] - b[0]);
      let budget = ctx.params.test ? 1e9 : 5, n = 0;
      ax = settle.X0 + ci * SETTLE_CELL; az = settle.Z0 + cj * SETTLE_CELL;
      for (const [, i, j] of cells) {
        const k = j * settle.NX + i;
        if (!cache.has(k)) { if (budget-- <= 0) { pending = true; continue; } }
        const c = chunk(i, j);
        const take = Math.min(c.n, cap - n);
        if (take <= 0) continue;
        data.set(take === c.n ? c.data : c.data.subarray(0, take * STRIDE), n * STRIDE);
        const ox = (i - ci) * SETTLE_CELL, oz = (j - cj) * SETTLE_CELL;
        if (ox !== 0 || oz !== 0) for (let q = n; q < n + take; q++) { data[q * STRIDE] += ox; data[q * STRIDE + 2] += oz; }
        n += take;
      }
      geo.instanceCount = n; ib.needsUpdate = true;
      stats.instances = n; stats.triangles = n * TRIS; stats.chunks = cells.length; stats.genMs = performance.now() - t0;
    }
    mesh.visible = stats.instances > 0;
    mesh.position.set(ax - org.x, 0, az - org.z);
    mesh.updateMatrixWorld();
  }
  return {
    object3D: mesh, update, stats, fadeRadius: radius,
    dispose() { geo.dispose(); mat.dispose(); depthMat.dispose(); },
  };
}
