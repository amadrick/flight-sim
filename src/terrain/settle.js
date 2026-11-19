// Settlements and roads: the data, the GLSL that paints them into the land surface, and the JS twin of the town
// layout that the instanced buildings (buildings.js) are generated from.
//
//   data     settle-data.js (generated offline by tools/gen-settle.mjs): ~800 settlements (cities, towns, villages,
//            hamlets) and a road network of ~11 k polyline vertices (highways, rural roads, lanes).
//   lookup   one RGBA16UI grid over the settled region (512 m cells): per cell a range of road-segment references and
//            the settlement that covers it. Segments are stored relative to their cell centre (RGBA32F), so the
//            distance to a road is exact to millimetres at any zoom and anywhere in the world (no float32 world
//            coordinates in the shader). Cost in the surface shader: 1 nearest fetch everywhere, + 2 per road segment
//            in the cell (0 in most cells), + 2 inside a settlement.
//   layout   a settlement is a street grid in its own rotated frame; blocks are split into two rows of lots; a lot
//            carries at most one building (house with a gable roof; flat-roofed blocks and towers in the core of
//            towns and cities). Every quantity is a pure function of integer block / lot indices and the settlement's
//            seed (integer hash, bit-identical in GLSL and JS), so the painted roofs and the 3-D buildings coincide.
import * as THREE from 'three';
import { SETTLE_DATA } from './settle-data.js';

export const SETTLE_CELL = 512;
const MARGIN = 46;            // a segment is known to every cell within this distance (verges, building clearance)
const MAX_SEG = 14;           // segment references per cell (GLSL loop bound)

/** Road classes: paved half width (m). 0 highway, 1 rural road, 2 lane. */
export const ROAD_HW = [6.6, 3.1, 1.9];

function b64(s) {
  if (typeof atob === 'function') { const b = atob(s), o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
  return new Uint8Array(Buffer.from(s, 'base64'));
}

// the integer hash of the surface shader (terrHash2), bit-exact
const _h = new Float64Array(2);
export function hash2(a, b) {
  let h = (Math.imul(a | 0, 0x8da6b343 | 0) + Math.imul(b | 0, 0xd8163841 | 0) + 0x9e3779b9) | 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  _h[0] = (h & 0xffff) / 65536; _h[1] = (h >>> 16) / 65536;
  return _h;
}
const ssf = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);

/** Decode the embedded data and build the lookup structures (pure JS: also used by the node tests). */
export function decodeSettlements(data = SETTLE_DATA) {
  const [X0, Z0, X1, Z1] = data.bounds;
  const tb = b64(data.towns), rb = b64(data.roads);
  const tf = new Float32Array(tb.buffer, tb.byteOffset, data.nTowns * 6);
  const ri = new Int32Array(rb.buffer, rb.byteOffset, rb.byteLength >> 2);
  const NX = Math.ceil((X1 - X0) / SETTLE_CELL), NZ = Math.ceil((Z1 - Z0) / SETTLE_CELL);
  const towns = [];
  for (let i = 0; i < data.nTowns; i++) {
    const t = { x: tf[i * 6], z: tf[i * 6 + 1], r: tf[i * 6 + 2], rot: tf[i * 6 + 3], kind: tf[i * 6 + 4], seed: tf[i * 6 + 5], index: i };
    towns.push(townParams(t));
  }
  // segments
  const segs = [];      // ax, az, bx, bz, hw, s0, cls
  for (let p = 0; p < ri.length;) {
    const cls = ri[p++], n = ri[p++];
    let s = 0;
    for (let i = 0; i < n - 1; i++) {
      const ax = ri[p + i * 2] / 4, az = ri[p + i * 2 + 1] / 4, bx = ri[p + i * 2 + 2] / 4, bz = ri[p + i * 2 + 3] / 4;
      const len = Math.hypot(bx - ax, bz - az);
      if (len > 0.01) segs.push([ax, az, bx, bz, ROAD_HW[cls], s, cls]);
      s += len;
    }
    p += n * 2;
  }
  // grid: segment references per cell, settlement per cell
  const lists = new Map();
  const R = Math.SQRT1_2 * SETTLE_CELL + MARGIN;
  for (let si = 0; si < segs.length; si++) {
    const [ax, az, bx, bz] = segs[si];
    const i0 = Math.floor((Math.min(ax, bx) - MARGIN - X0) / SETTLE_CELL), i1 = Math.floor((Math.max(ax, bx) + MARGIN - X0) / SETTLE_CELL);
    const j0 = Math.floor((Math.min(az, bz) - MARGIN - Z0) / SETTLE_CELL), j1 = Math.floor((Math.max(az, bz) + MARGIN - Z0) / SETTLE_CELL);
    const ex = bx - ax, ez = bz - az, e2 = ex * ex + ez * ez;
    for (let j = Math.max(0, j0); j <= Math.min(NZ - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(NX - 1, i1); i++) {
      const px = X0 + (i + 0.5) * SETTLE_CELL - ax, pz = Z0 + (j + 0.5) * SETTLE_CELL - az;
      const t = Math.max(0, Math.min(1, (px * ex + pz * ez) / e2));
      if (Math.hypot(px - ex * t, pz - ez * t) > R) continue;
      const k = j * NX + i; let l = lists.get(k); if (!l) lists.set(k, l = []);
      if (l.length < MAX_SEG) l.push(si);
    }
  }
  const grid = new Uint16Array(NX * NZ * 4);
  let nRef = 0; for (const l of lists.values()) nRef += l.length;
  const SW = 1024, SH = Math.max(1, Math.ceil(nRef * 2 / SW));
  const segTex = new Float32Array(SW * SH * 4);
  const cellStart = new Int32Array(NX * NZ).fill(-1);
  let ref = 0;
  for (const [k, l] of lists) {
    const ccx = X0 + ((k % NX) + 0.5) * SETTLE_CELL, ccz = Z0 + (Math.floor(k / NX) + 0.5) * SETTLE_CELL;
    grid[k * 4] = ref & 0xffff; grid[k * 4 + 1] = ref >>> 16; grid[k * 4 + 2] = l.length; cellStart[k] = ref;
    for (const si of l) {
      const s = segs[si], o = ref * 8;
      segTex[o] = s[0] - ccx; segTex[o + 1] = s[1] - ccz; segTex[o + 2] = s[2] - ccx; segTex[o + 3] = s[3] - ccz;
      segTex[o + 4] = s[4]; segTex[o + 5] = s[5]; segTex[o + 6] = s[6]; segTex[o + 7] = si;
      ref++;
    }
  }
  // settlement per cell: the one whose centre is nearest among those that reach the cell
  const cellTown = new Int32Array(NX * NZ).fill(-1);
  for (const t of towns) {
    const m = t.r + 0.75 * SETTLE_CELL;
    const i0 = Math.max(0, Math.floor((t.x - m - X0) / SETTLE_CELL)), i1 = Math.min(NX - 1, Math.floor((t.x + m - X0) / SETTLE_CELL));
    const j0 = Math.max(0, Math.floor((t.z - m - Z0) / SETTLE_CELL)), j1 = Math.min(NZ - 1, Math.floor((t.z + m - Z0) / SETTLE_CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * NX + i, d = Math.hypot(X0 + (i + 0.5) * SETTLE_CELL - t.x, Z0 + (j + 0.5) * SETTLE_CELL - t.z);
      if (d > m) continue;
      const o = cellTown[k];
      if (o < 0 || d < Math.hypot(X0 + (i + 0.5) * SETTLE_CELL - towns[o].x, Z0 + (j + 0.5) * SETTLE_CELL - towns[o].z)) { cellTown[k] = t.index; grid[k * 4 + 3] = t.index + 1; }
    }
  }
  const TW = Math.max(2, towns.length * 2);
  const townTex = new Float32Array(TW * 4);
  for (const t of towns) townTex.set([t.x - X0, t.z - Z0, t.r, t.rot, t.kind, t.seed, 0, 0], t.index * 8);

  const S = { X0, Z0, NX, NZ, towns, segs, grid, segTex, SW, SH, townTex, TW, cellStart, cellTown, nRef };

  /** Clearance (m) from world (x, z) to the nearest road edge within reach (MARGIN); 1e3 if none. */
  S.roadClear = (x, z) => {
    const i = Math.floor((x - X0) / SETTLE_CELL), j = Math.floor((z - Z0) / SETTLE_CELL);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return 1e3;
    const k = j * NX + i, st = cellStart[k];
    if (st < 0) return 1e3;
    const n = grid[k * 4 + 2], px = x - (X0 + (i + 0.5) * SETTLE_CELL), pz = z - (Z0 + (j + 0.5) * SETTLE_CELL);
    let best = 1e3;
    for (let q = 0; q < n; q++) {
      const o = (st + q) * 8, ax = segTex[o], az = segTex[o + 1], ex = segTex[o + 2] - ax, ez = segTex[o + 3] - az;
      const t = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / (ex * ex + ez * ez)));
      const d = Math.hypot(px - ax - ex * t, pz - az - ez * t) - segTex[o + 4];
      if (d < best) best = d;
    }
    return best;
  };
  S.townAt = (x, z) => {
    const i = Math.floor((x - X0) / SETTLE_CELL), j = Math.floor((z - Z0) / SETTLE_CELL);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return null;
    const t = cellTown[j * NX + i];
    return t < 0 ? null : towns[t];
  };
  /**
   * The buildings whose centre lies in grid cell (ci, cj): calls emit(x, z, hx, hz, height, roofK, rot, h1x, h1y, h2x, h2y, kind)
   * (world centre, half sizes along / across the street, eaves height, 1 = gable roof, rotation of the street frame).
   */
  S.buildingsInCell = (ci, cj, emit, useRoads = true) => {
    if (ci < 0 || cj < 0 || ci >= NX || cj >= NZ) return;
    const ti = cellTown[cj * NX + ci];
    if (ti < 0) return;
    const T = towns[ti];
    const x0 = X0 + ci * SETTLE_CELL, z0 = Z0 + cj * SETTLE_CELL;
    // block index range covering the cell in the settlement's (warped) frame
    let ax0 = 1e9, ax1 = -1e9, az0 = 1e9, az1 = -1e9;
    for (let c = 0; c < 4; c++) {
      const dx = x0 + (c & 1) * SETTLE_CELL - T.x, dz = z0 + (c >> 1) * SETTLE_CELL - T.z;
      const lx = T.c * dx + T.s * dz, lz = -T.s * dx + T.c * dz;
      ax0 = Math.min(ax0, lx); ax1 = Math.max(ax1, lx); az0 = Math.min(az0, lz); az1 = Math.max(az1, lz);
    }
    ax0 -= T.wA + 20; ax1 += T.wA + 20; az0 -= T.wA + 20; az1 += T.wA + 20;
    const L = _lot;
    for (let bz = Math.floor(az0 / T.bd); bz <= Math.floor(az1 / T.bd); bz++) for (let bx = Math.floor(ax0 / T.bw); bx <= Math.floor(ax1 / T.bw); bx++) {
      blockAt(T, bx, bz, L);
      for (let row = 0; row < 2; row++) for (let li = 0; li < L.nl; li++) {
        if (!lotAt(T, bx, bz, li, row, L)) continue;
        // undo the warp: the point p of the plain frame with p + W(p) = (cx, cz)
        let px = L.cx, pz = L.cz;
        for (let it = 0; it < 4; it++) { const qx = L.cx - T.wA * Math.sin(pz * T.wF + T.wP1), qz = L.cz - T.wA * Math.sin(px * T.wF + T.wP2); px = qx; pz = qz; }
        const wx = T.x + T.c * px - T.s * pz, wz = T.z + T.s * px + T.c * pz;
        if (wx < x0 || wx >= x0 + SETTLE_CELL || wz < z0 || wz >= z0 + SETTLE_CELL) continue;
        if (useRoads && S.roadClear(wx, wz) < Math.max(L.hx, L.hz) * 1.2 + 2.0) continue;
        // the lot's street axis, turned by the warp
        const rot = T.rot - Math.atan(T.wA * T.wF * Math.cos(px * T.wF + T.wP2));
        emit(wx, wz, L.hx, L.hz, L.h, L.roofK, rot, L.h1x, L.h1y, L.h2x, L.h2y, T.kind);
      }
    }
  };
  return S;
}

/** Derived layout parameters of a settlement (mirrors terrTownIn in the GLSL). */
function townParams(t) {
  const h = hash2(t.seed, 17);
  t.bw = 76 + 26 * h[0]; t.bd = 50 + 12 * h[1];
  t.hwS = t.kind >= 3 ? 4.2 : t.kind >= 2 ? 3.7 : 3.0;
  t.coreF = t.kind >= 3 ? 0.40 : t.kind >= 2 ? 0.26 : 0;
  t.c = Math.cos(t.rot); t.s = Math.sin(t.rot);
  t.sLo = t.seed % 256; t.sHi = Math.floor(t.seed / 256);
  // the street grid is not ruled with a straightedge: a gentle sinusoidal warp of the settlement's frame
  t.wA = Math.min(0.03 * t.r, 42); t.wF = 6.2831853 / Math.max(0.8 * t.r, 260);
  t.wP1 = h[0] * 6.2831853; t.wP2 = h[1] * 6.2831853;
  return t;
}
const _lot = { cx: 0, cz: 0, hx: 0, hz: 0, h: 0, roofK: 0, h1x: 0, h1y: 0, h2x: 0, h2y: 0, nl: 0 };
/** Lots per row of block (bx, bz) and its type (0 houses, 1 sheds / industry, 2 green). Mirrors the GLSL. */
function blockAt(T, bx, bz, L) {
  const h = hash2(bx + T.sLo * 4096 + 91, bz + T.sHi * 512 + 57);
  const rb = Math.hypot((bx + 0.5) * T.bw, (bz + 0.5) * T.bd) / T.r;
  L.bh0 = h[0]; L.bh1 = h[1];
  L.type = T.kind >= 1.5 && rb > 0.45 && h[0] < 0.11 ? 1 : T.kind >= 0.5 && h[0] > 0.93 ? 2 : 0;
  L.nl = L.type === 1 ? 2 : Math.floor(T.bw / 18);
  return L;
}
/** The lot (block bx, bz; lot li; row) of settlement T. Returns false if it carries no building. Mirrors terrTownIn. */
function lotAt(T, bx, bz, li, row, L) {
  const lw = T.bw / L.nl;
  const a = bx * 16 + li + T.sLo * 2048, b = bz * 2 + row + T.sHi * 512;
  let h = hash2(a, b); const h1x = h[0], h1y = h[1];
  h = hash2(a + 7777, b + 3333); const h2x = h[0], h2y = h[1];
  const lcx = bx * T.bw + (li + 0.5) * lw, lcz = bz * T.bd + (row + 0.5) * T.bd * 0.5;
  const rr = Math.hypot(lcx, lcz) / T.r + 0.14 * (L.bh1 - 0.5);
  if (L.type === 2) return false;
  const pOcc = (T.kind < 0.5 ? 0.6 : 0.94) * (1 - ssf(0.74, 1.0, rr));
  if (h1x >= pOcc) return false;
  let hx, hz, off, cxl, hgt, roofK;
  const ld = T.bd * 0.5;
  if (L.type === 1) {
    hx = lw * 0.5 - 4.5 - 4 * h1y; hz = (ld - T.hwS - 7) * 0.5; off = T.hwS + 5 + hz; cxl = (li + 0.5) * lw; roofK = 0; hgt = 6.5 + 5 * h2x;
  } else if (rr < T.coreF) {
    hx = lw * 0.5 - 1.0; hz = (ld - T.hwS - 3.5) * 0.5; off = T.hwS + 2.5 + hz; cxl = (li + 0.5) * lw; roofK = 0;
    hgt = T.kind >= 3 ? (rr < 0.17 ? 22 + 100 * h2x * h2x * h2x : 9 + 16 * h2x) : 6 + 8 * h2x;
  } else {
    hx = 4.6 + 2.6 * h1y; hz = 3.8 + 1.8 * h2x; off = T.hwS + 3.5 + 4 * h2y + hz;
    cxl = (li + 0.5) * lw + (fract(h1y * 7.3) - 0.5) * Math.max(lw - 2 * hx - 2.5, 0);
    hgt = 3.0 + 2.7 * (fract(h2y * 5.1) > 0.62 ? 1 : 0); roofK = 1;
  }
  cxl = Math.min(Math.max(cxl, T.hwS + 2 + hx), T.bw - T.hwS - 2 - hx);
  L.cx = bx * T.bw + cxl; L.cz = row < 0.5 ? bz * T.bd + off : (bz + 1) * T.bd - off;
  L.hx = hx; L.hz = hz; L.h = hgt; L.roofK = roofK; L.h1x = h1x; L.h1y = h1y; L.h2x = h2x; L.h2y = h2y;
  return true;
}

/** GPU side: textures + uniforms. opts: { towns: bool, roads: bool } */
export function createSettlements(renderer, opts = {}) {
  const t0 = performance.now();
  const S = decodeSettlements();
  const grid = new THREE.DataTexture(S.grid, S.NX, S.NZ, THREE.RGBAIntegerFormat, THREE.UnsignedShortType);
  grid.internalFormat = 'RGBA16UI'; grid.minFilter = grid.magFilter = THREE.NearestFilter; grid.generateMipmaps = false; grid.needsUpdate = true;
  const mkF = (data, w, h) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t;
  };
  const seg = mkF(S.segTex, S.SW, S.SH), town = mkF(S.townTex, S.TW, 1);
  const uniforms = {
    tSetGrid: { value: grid }, tSetSeg: { value: seg }, tSetTown: { value: town },
    uSetOrg: { value: new THREE.Vector4(0, 0, S.NX, S.NZ) },                   // xy = grid origin - render origin (exact integers)
    uSetOn: { value: new THREE.Vector4(opts.roads === false ? 0 : 1, opts.towns === false ? 0 : 1, 0, 0) },   // z = night lights 0..1, w = 3-D building fade radius
  };
  S.uniforms = uniforms;
  S.update = (org, night, bFar) => {
    uniforms.uSetOrg.value.x = S.X0 - org.x; uniforms.uSetOrg.value.y = S.Z0 - org.z;
    uniforms.uSetOn.value.z = night; uniforms.uSetOn.value.w = bFar;
  };
  S.dispose = () => { grid.dispose(); seg.dispose(); town.dispose(); };
  S.ms = performance.now() - t0;
  return S;
}

/** Roof and wall colours from the lot hashes: shared by the painted roofs and the 3-D buildings. */
export const SETTLE_COLOR_GLSL = /* glsl */`
// roof and wall colours of a building from its lot hashes (shared with the 3-D buildings)
vec3 settleRoofColor(vec2 h1, vec2 h2, float roofK, float tropic) {
  float u = fract(h1.y * 13.7 + h2.x * 3.1);
  vec3 tile = u < 0.34 ? vec3(0.300, 0.105, 0.060) : u < 0.52 ? vec3(0.215, 0.095, 0.065) : u < 0.80 ? vec3(0.075, 0.078, 0.086) : u < 0.92 ? vec3(0.150, 0.130, 0.110) : vec3(0.230, 0.235, 0.240);
  vec3 flatR = u < 0.45 ? vec3(0.200, 0.195, 0.185) : u < 0.75 ? vec3(0.135, 0.135, 0.140) : u < 0.9 ? vec3(0.270, 0.268, 0.258) : vec3(0.165, 0.125, 0.105);
  vec3 c = mix(flatR, tile, roofK);
  c = mix(c, mix(vec3(0.42, 0.40, 0.37), vec3(0.330, 0.130, 0.080), step(0.5, u)), tropic * roofK * 0.8);   // pale sheet metal and rust-red on the islands
  return c * (0.82 + 0.36 * h2.y);
}
vec3 settleWallColor(vec2 h1, vec2 h2, float roofK) {
  float u = fract(h2.x * 9.3 + h1.x * 5.7);
  vec3 house = u < 0.36 ? vec3(0.58, 0.55, 0.48) : u < 0.56 ? vec3(0.50, 0.42, 0.30) : u < 0.74 ? vec3(0.30, 0.135, 0.085) : u < 0.87 ? vec3(0.36, 0.38, 0.39) : vec3(0.44, 0.30, 0.18);
  vec3 block = u < 0.4 ? vec3(0.36, 0.35, 0.33) : u < 0.65 ? vec3(0.24, 0.25, 0.27) : u < 0.85 ? vec3(0.42, 0.37, 0.30) : vec3(0.28, 0.14, 0.09);
  return mix(block, house, roofK) * (0.85 + 0.3 * h1.y);
}
`;

// ---- GLSL -----------------------------------------------------------------------------------------------------------
// VS / FS safe (texelFetch only). Needs terrHash2 and ss from the cover chunk.
export const SETTLE_GLSL = /* glsl */`
#define TERR_SETTLE 1
uniform highp usampler2D tSetGrid;
uniform highp sampler2D tSetSeg;
uniform highp sampler2D tSetTown;
uniform highp vec4 uSetOrg;      // xy = grid origin - render origin, zw = grid size (cells)
uniform highp vec4 uSetOn;       // x = roads, y = settlements, z = night lights, w = radius inside which buildings are 3-D

struct TerrRoad { float d; float hw; float cls; float s; float n; };   // distance to the centre line, half width, class, arc length, segments seen
struct TerrTown {
  float on;        // 1 inside the settlement (0 outside its radius)
  float kind;      // 0 hamlet .. 3 city
  float rr;        // distance from the centre / radius
  float ds;        // distance to the nearest street centre line, m
  float hwS;       // street half width
  float along;     // coordinate along that street, m
  float lotEdge;   // distance to the lot boundary, m
  vec2 bq;         // position relative to the building centre in street axes, m
  vec2 bh;         // building half size (0 = no building on this lot)
  float bH;        // eaves height, m
  float roofK;     // 1 gable roof, 0 flat
  float core;      // 1 in the commercial core
  vec2 h1; vec2 h2;
  vec2 ax;         // world direction of the street x axis
  float btype;     // block: 0 houses, 1 sheds, 2 green
  float dens;      // how built-up the place is, 1 .. 0 at the edge
  float front;     // +1 / -1: which way the lot faces (street side along local z)
};

// grid cell of render-space xz and the position relative to its centre
uvec4 terrSetCell(vec2 rxz, out vec2 rel) {
  vec2 g = rxz - uSetOrg.xy;
  vec2 ci = floor(g / ${SETTLE_CELL}.0);
  rel = rxz - (ci * ${SETTLE_CELL}.0 + ${SETTLE_CELL / 2}.0 + uSetOrg.xy);
  if (ci.x < 0.0 || ci.y < 0.0 || ci.x >= uSetOrg.z || ci.y >= uSetOrg.w) return uvec4(0u);
  return texelFetch(tSetGrid, ivec2(ci), 0);
}
TerrRoad terrRoadIn(uvec4 cell, vec2 rel) {
  TerrRoad R = TerrRoad(1.0e4, 0.0, 0.0, 0.0, 0.0);
  int n = int(cell.z);
  if (n == 0 || uSetOn.x < 0.5) return R;
  int st = int(cell.x) + (int(cell.y) << 16);
  float best = 1.0e4;
  for (int i = 0; i < ${MAX_SEG}; i++) {
    if (i >= n) break;
    int q = (st + i) * 2;
    vec4 a = texelFetch(tSetSeg, ivec2(q & 1023, q >> 10), 0);
    vec4 b = texelFetch(tSetSeg, ivec2((q + 1) & 1023, (q + 1) >> 10), 0);
    vec2 e = a.zw - a.xy, p = rel - a.xy;
    float t = clamp(dot(p, e) / dot(e, e), 0.0, 1.0);
    float d = length(p - e * t);
    // the widest road wins where two meet
    if (d - b.x < best) { best = d - b.x; R.d = d; R.hw = b.x; R.cls = b.z; R.s = b.y + t * length(e); }
  }
  R.n = float(n);
  return R;
}
// clearance to the nearest road edge at another point (building centres)
float terrRoadClear(vec2 rxz) {
  vec2 rel; uvec4 c = terrSetCell(rxz, rel);
  TerrRoad R = terrRoadIn(c, rel);
  return R.d - R.hw;
}
TerrTown terrTownIn(uvec4 cell, vec2 rxz) {
  TerrTown T;
  T.on = 0.0; T.kind = 0.0; T.rr = 2.0; T.ds = 1.0e3; T.hwS = 0.0; T.along = 0.0; T.lotEdge = 0.0; T.bq = vec2(0.0); T.bh = vec2(0.0);
  T.bH = 0.0; T.roofK = 0.0; T.core = 0.0; T.h1 = vec2(0.0); T.h2 = vec2(0.0); T.ax = vec2(1.0, 0.0); T.front = 1.0; T.btype = 0.0; T.dens = 0.0;
  if (cell.w == 0u || uSetOn.y < 0.5) return T;
  int ti = (int(cell.w) - 1) * 2;
  vec4 A = texelFetch(tSetTown, ivec2(ti, 0), 0), B = texelFetch(tSetTown, ivec2(ti + 1, 0), 0);
  vec2 d = rxz - (A.xy + uSetOrg.xy);
  float cr = cos(A.w), sr = sin(A.w);
  vec2 p = vec2(cr * d.x + sr * d.y, -sr * d.x + cr * d.y);
  float R = A.z, kind = B.x, seed = B.y;
  T.kind = kind; T.rr = length(p) / R; T.ax = vec2(cr, sr);
  if (T.rr > 1.06) return T;
  T.on = 1.0;
  vec2 hs = terrHash2(vec2(seed, 17.0));
  float bw = 76.0 + 26.0 * hs.x, bd = 50.0 + 12.0 * hs.y;
  float hwS = kind >= 3.0 ? 4.2 : kind >= 2.0 ? 3.7 : 3.0;
  float coreF = kind >= 3.0 ? 0.40 : kind >= 2.0 ? 0.26 : 0.0;
  float sLo = mod(seed, 256.0), sHi = floor(seed / 256.0);
  // gentle warp of the street grid (settle.js undoes it for the 3-D buildings)
  float wA = min(0.03 * R, 42.0), wF = 6.2831853 / max(0.8 * R, 260.0);
  vec2 wc = cos(p.yx * wF + hs * 6.2831853) * (wA * wF);                // d(warp)/d(p): x' = x + A sin(y f + p1), y' = y + A sin(x f + p2)
  p += wA * sin(p.yx * wF + hs * 6.2831853);
  // street axis in the world, turned by the warp
  float wa = -atan(wc.y); float cw = cos(A.w + wa), sw = sin(A.w + wa);
  T.ax = vec2(cw, sw);
  T.hwS = hwS;
  vec2 bs = vec2(bw, bd);
  vec2 bi = floor(p / bs), f = p - bi * bs;
  vec2 de = min(f, bs - f);
  T.ds = min(de.x, de.y);
  T.along = de.x < de.y ? p.y : p.x;
  // the block: houses, sheds (industry, big stores) or green
  vec2 hbk = terrHash2(vec2(bi.x + sLo * 4096.0 + 91.0, bi.y + sHi * 512.0 + 57.0));
  float rb = length((bi + 0.5) * bs) / R;
  float btype = (kind >= 1.5 && rb > 0.45 && hbk.x < 0.11) ? 1.0 : (kind >= 0.5 && hbk.x > 0.93) ? 2.0 : 0.0;
  T.btype = btype;
  float nl = btype > 0.5 && btype < 1.5 ? 2.0 : floor(bw / 18.0), lw = bw / nl;
  float row = f.y < bd * 0.5 ? 0.0 : 1.0;
  float li = min(floor(f.x / lw), nl - 1.0);
  T.front = row < 0.5 ? 1.0 : -1.0;
  T.lotEdge = min(min(f.x - li * lw, (li + 1.0) * lw - f.x), abs(f.y - bd * 0.5));
  vec2 ab = vec2(bi.x * 16.0 + li + sLo * 2048.0, bi.y * 2.0 + row + sHi * 512.0);
  vec2 h1 = terrHash2(ab), h2 = terrHash2(ab + vec2(7777.0, 3333.0));
  T.h1 = h1; T.h2 = h2;
  vec2 lc = vec2(bi.x * bw + (li + 0.5) * lw, bi.y * bd + (row + 0.5) * bd * 0.5);
  float rr = length(lc) / R + 0.14 * (hbk.y - 0.5);
  T.core = step(rr, coreF) * step(btype, 0.5);
  T.dens = 1.0 - ss(0.74, 1.0, rr);
  if (btype > 1.5) return T;
  float pOcc = (kind < 0.5 ? 0.6 : 0.94) * T.dens;
  if (h1.x >= pOcc) return T;
  float hx, hz, off, cxl, hgt, ld = bd * 0.5;
  if (btype > 0.5) {
    hx = lw * 0.5 - 4.5 - 4.0 * h1.y; hz = (ld - hwS - 7.0) * 0.5; off = hwS + 5.0 + hz; cxl = (li + 0.5) * lw; T.roofK = 0.0; hgt = 6.5 + 5.0 * h2.x;
  } else if (rr < coreF) {
    hx = lw * 0.5 - 1.0; hz = (ld - hwS - 3.5) * 0.5; off = hwS + 2.5 + hz; cxl = (li + 0.5) * lw; T.roofK = 0.0;
    hgt = kind >= 3.0 ? (rr < 0.17 ? 22.0 + 100.0 * h2.x * h2.x * h2.x : 9.0 + 16.0 * h2.x) : 6.0 + 8.0 * h2.x;
  } else {
    hx = 4.6 + 2.6 * h1.y; hz = 3.8 + 1.8 * h2.x; off = hwS + 3.5 + 4.0 * h2.y + hz;
    cxl = (li + 0.5) * lw + (fract(h1.y * 7.3) - 0.5) * max(lw - 2.0 * hx - 2.5, 0.0);
    hgt = 3.0 + 2.7 * step(0.62, fract(h2.y * 5.1)); T.roofK = 1.0;
  }
  cxl = clamp(cxl, hwS + 2.0 + hx, bw - hwS - 2.0 - hx);
  vec2 c = vec2(bi.x * bw + cxl, row < 0.5 ? bi.y * bd + off : (bi.y + 1.0) * bd - off);
  // no building where a through road runs (tested at the building's centre, like the JS twin)
  vec2 cu = c;
  for (int it = 0; it < 4; it++) cu = c - wA * sin(cu.yx * wF + hs * 6.2831853);
  vec2 cwp = vec2(cr * cu.x - sr * cu.y, sr * cu.x + cr * cu.y) + A.xy + uSetOrg.xy;
  if (uSetOn.x > 0.5 && terrRoadClear(cwp) < max(hx, hz) * 1.2 + 2.0) return T;
  T.bq = p - c; T.bh = vec2(hx, hz); T.bH = hgt;
  return T;
}
${SETTLE_COLOR_GLSL}
`;
