// The land surface: learned land cover, farmland, layered materials with detail across scales, ambient occlusion and
// terrain self-shadow.
//
//   land cover   comes from a small neural network (src/neural/ground-cover.js) trained on an offline ecosystem
//                simulation of this world's terrain. It is evaluated per VERTEX (material.js) and interpolated: forest
//                canopy, conifer share, shrub, grass, bare rock, scree, late snow, soil moisture, soil depth, active
//                wash, arable land. This file turns those smooth fractions into crisp, multi-scale patterns.
//   farmland     jittered parcels inside a warped section grid: crop classes and growth stages, drill rows,
//                tramlines, headlands, swaths, hedgerows (which carry 3D trees), tracks, farmsteads, centre pivots.
//   materials    eight GPU-baked detail layers (ground-detail.js: grass, soil, gravel, rock, sand, mud, canopy,
//                strata) sampled at four scales (110 m .. 0.7 m), side-projected on steep faces, each giving
//                height, normal, tint; roughness and wetness response per material.
// Albedos are linear and physically plausible (grass 0.05-0.14, forest 0.03-0.07, soil 0.10-0.20, dry sand 0.30-0.45,
// playa 0.50, fresh snow 0.88). No fog, no tone mapping here (the pipeline does aerial perspective).
// `?ground=classic` switches back to the previous hand-tuned shader (ground-classic.glsl.js).
import { groundEcoGLSL } from '../neural/ground-cover.js';
import { CLASSIC_COVER_GLSL, CLASSIC_SURFACE_GLSL } from './ground-classic.glsl.js';
import { SETTLE_GLSL } from './settle.js';
import { AIRFIELD_GLSL } from './airfield.js';

/** GLSL for the vertex stage of the terrain (and anything else that wants the learned cover): TerrEco terrEco(rxz, h). */
export const ECO_GLSL = groundEcoGLSL();

// Part 1 — VS-safe helpers shared by the surface shader and the 3D tree placement (trees.js): no derivatives,
// explicit-LOD lookups only. terrCover() decides where forest / farmland / airfield turf is.
const NEURAL_COVER_GLSL = /* glsl */`
${ECO_GLSL}
uniform sampler2D tTerrNoise;
uniform vec2 uTerrTile[7];       // uv offsets of the noise scales (floating-origin compensation)
uniform vec4 uTerrRw[8];         // runways: xy = centre (render-space xz), zw = unit direction
uniform float uTerrRwL[8];       // runway half lengths (0 = unused slot)
uniform vec3 uSunDir;
uniform float uTerrShadowOn;
${AIRFIELD_GLSL}

vec2 terrHash2(vec2 p) {
  uvec2 q = uvec2(ivec2(p));
  uint h = q.x * 0x8da6b343u + q.y * 0xd8163841u + 0x9e3779b9u;
  h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
  return vec2(float(h & 0xffffu), float(h >> 16)) / 65536.0;
}
vec2 terrUV(vec3 T, vec2 off, vec2 p) { return vec2(T.x * p.x - T.y * p.y, T.y * p.x + T.x * p.y) * T.z + off; }
vec2 terrUnrot(vec3 T, vec2 g) { return vec2(T.x * g.x + T.y * g.y, T.x * g.y - T.y * g.x); }
float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
//@SETTLE@

// Macro noise that never repeats (the tiled noise texture shows its 2.3 km period as a lattice from high altitude):
// two independent channels of value noise with 620 m and 250 m cells, mean 0.5, sigma ~0.14. dist = distance from
// the camera (m): each octave fades out before its cells shrink to a pixel.
vec2 terrVal(vec2 p) {
  vec2 i = floor(p), f = p - i;
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(terrHash2(i), terrHash2(i + vec2(1.0, 0.0)), f.x), mix(terrHash2(i + vec2(0.0, 1.0)), terrHash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec2 terrMacro(vec2 w, float dist) {
  vec2 a = terrVal(w / 620.0 + 1700.5) - 0.5;
  vec2 b = terrVal(vec2(0.8 * w.x - 0.6 * w.y, 0.6 * w.x + 0.8 * w.y) / 250.0 + 3300.5) - 0.5;
  return 0.5 + a * 0.62 * ss(240000.0, 110000.0, dist) + b * 0.36 * ss(90000.0, 40000.0, dist);
}

// ---- farmland parcels ----------------------------------------------------------------------------------------------
// A warped section grid (1340 m blocks between gravel roads); every block is split into 2-7 columns of uneven width
// and every column into 1-4 fields of uneven length, so parcels range from 100 m strips to 600 m squares.
struct TerrField {
  float edge;      // distance to the parcel boundary, m
  float road;      // distance to the section road centre line, m
  vec2 size;       // parcel size, m (x = across the block's split axis)
  vec2 pq;         // position inside the parcel from its low corner, m
  vec2 id;         // parcel hash
  vec4 blk;        // block hashes
  vec2 bf;         // position inside the block 0..1
  float flip;      // 1 if the block is split along z first
};
const float TERR_BLOCK = 1340.0;
float terrSplitEdge(float i, float n, vec2 seed) {
  return (i <= 0.0 || i >= n) ? i / n : (i + 0.56 * (terrHash2(seed + vec2(i * 17.0, 0.0)).x - 0.5)) / n;
}
float terrSplit(float a, float n, vec2 seed, out float lo, out float hi) {
  float i = min(floor(a * n), n - 1.0);
  lo = terrSplitEdge(i, n, seed); hi = terrSplitEdge(i + 1.0, n, seed);
  if (a < lo) { i -= 1.0; hi = lo; lo = terrSplitEdge(i, n, seed); }
  else if (a >= hi) { i += 1.0; lo = hi; hi = terrSplitEdge(i + 1.0, n, seed); }
  return i;
}
TerrField terrFieldAt(vec2 w) {
  TerrField F;
  // the survey grid is not perfectly straight: long gentle bends (smooth, so field edges stay locally straight)
  vec2 q = w + vec2(55.0 * sin(w.y * 0.0023 + 1.3) + 90.0 * sin(w.y * 0.00071 + w.x * 0.0004),
                    45.0 * sin(w.x * 0.0019 + 0.4) + 80.0 * sin(w.x * 0.00063 - w.y * 0.0005 + 2.0));
  q = vec2(0.978 * q.x - 0.208 * q.y, 0.208 * q.x + 0.978 * q.y);
  vec2 b = q / TERR_BLOCK, bi = floor(b), bf = b - bi;
  vec2 hb = terrHash2(bi + 4096.0), hb2 = terrHash2(bi + 5120.0);
  F.blk = vec4(hb, hb2); F.bf = bf;
  F.flip = step(0.5, hb2.y);
  vec2 a = F.flip > 0.5 ? bf.yx : bf;
  bool strips = hb2.x > 0.74;
  float n1 = strips ? 5.0 + floor(hb.x * 3.0) : 2.0 + floor(hb.x * 2.6);
  float lo1, hi1, lo2, hi2;
  float i1 = terrSplit(a.x, n1, bi * 13.0 + 100.0, lo1, hi1);
  vec2 hc = terrHash2(bi * 7.0 + vec2(i1 * 29.0 + 300.0, 77.0));
  float n2 = 1.0 + floor(hc.x * (strips ? 2.2 : 3.6));
  float i2 = terrSplit(a.y, n2, bi * 13.0 + vec2(i1 * 31.0 + 500.0, 900.0), lo2, hi2);
  F.size = vec2(hi1 - lo1, hi2 - lo2) * TERR_BLOCK;
  F.pq = vec2(a.x - lo1, a.y - lo2) * TERR_BLOCK;
  F.id = terrHash2(bi * 7.0 + vec2(i1 * 5.0 + i2 * 11.0, i1 * 3.0 + 8192.0));
  vec2 de = min(F.pq, F.size - F.pq);
  F.edge = min(de.x, de.y);
  vec2 db = min(bf, 1.0 - bf) * TERR_BLOCK;
  F.road = min(db.x, db.y);
  return F;
}

struct TerrCover {
  float pad; float treeline; float tropic; float forest; float conifer; float crop;
  float hedge;     // hedgerow / shelter-belt trees inside farmland (already included in forest)
  float woods;     // natural woodland only (forest without the hedgerows)
  TerrField fld;   // the farm parcel here (valid where crop > 0)
  vec2 mac;        // non-repeating macro noise (terrMacro) at this point
#ifdef TERR_SETTLE
  TerrRoad road;   // the nearest road of this grid cell
  TerrTown town;   // the settlement lot here
  float built;     // 1 on streets, roads and building footprints (nothing grows there)
#endif
};

// Fraction f of the area is covered where the (roughly normal, mean 0.5, sigma sg) noise value nz clears a threshold.
float terrThresh(float f, float sg) { f = clamp(f, 0.002, 0.998); return 0.5 - sg * 0.59 * log(f / (1.0 - f)); }

// n0..n3 = tTerrNoise at scales 0..3 at this point; n = terrain normal; curv = clipmap curvature; water = river mask;
// E = the learned ecosystem cover (terrEco) at this point.
// metres per pixel where the cover is being shaded (0 in the placement passes, which have no screen footprint).
// Hedgerows, avenues and woodlot edges are 5-10 m features: without this prefilter a pixel wider than that is either
// all hedge or all of the pale road beside it, and the boundary lines broke into regular dashes and steps (the
// "white staircase" from a few kilometres up).
float gTerrPx = 0.0;
TerrCover terrCoverEco(vec2 rxz, float h, vec3 n, float curv, float arid, float water, vec4 n0, vec4 n1, vec4 n2, vec4 n3, TerrEco E) {
  TerrCover C;
  float latK = (rxz.y + uOrigin.z) * 0.001;           // km south of the origin
  float slope = 1.0 - n.y;
  C.tropic = ss(35.0, 70.0, latK);
  C.mac = terrMacro(rxz + uOrigin.xz, distance(rxz, uTerrCam.xz));
  float macro2 = n0.g * 0.6 + C.mac.y * 0.4;
  // airfields: keep fields and woods clear of the runways (the scenery module builds on this ground)
  float rwd = 1.0e6, rwApp = 1.0e6;
  for (int i = 0; i < 8; i++) {
    if (uTerrRwL[i] > 0.0) {
      vec2 q = rxz - uTerrRw[i].xy;
      float al = dot(q, uTerrRw[i].zw);
      vec2 perp = q - uTerrRw[i].zw * clamp(al, -uTerrRwL[i] - 250.0, uTerrRwL[i] + 250.0);
      rwd = min(rwd, length(perp));
      rwApp = min(rwApp, length(q - uTerrRw[i].zw * clamp(al, -uTerrRwL[i] - 1100.0, uTerrRwL[i] + 1100.0)));
    }
  }
  float padR = mix(760.0, 230.0, C.tropic);           // small islands: only the strip itself is kept clear
  C.pad = 1.0 - ss(padR, padR * 1.32, rwd + mix(260.0, 70.0, C.tropic) * (n1.r - 0.5) + mix(120.0, 60.0, C.tropic) * (n2.r - 0.5));
  // around the mapped airport the airside ends at the perimeter fence (airfield.js): fields, hedges and woods come up
  // to it; the approach corridors (1.1 km beyond the runway ends, 150 m either side) stay open
  float aside = airSide(rxz);
  if (aside >= 0.0) C.pad = max(aside, (1.0 - ss(150.0, 230.0, rwApp + 60.0 * (n2.r - 0.5))) * (1.0 - C.tropic));
  // climatic tree line (trees near it are stunted); where trees actually stand is the network's business
  C.treeline = 2180.0 + 2.0 * clamp(latK + 95.0, -200.0, 200.0) + 260.0 * (C.mac.x - 0.5) + 90.0 * (n2.g - 0.5);
  float open = (1.0 - C.pad) * (1.0 - water) * ss(1.2, 3.2, h);
#ifdef TERR_SETTLE
  // roads and settlements (settle.js): fields and woods stop at them
  vec2 srel; uvec4 scell = terrSetCell(rxz, srel);
  C.road = terrRoadIn(scell, srel);
  C.town = terrTownIn(scell, rxz);
  float townK = C.town.on * ss(0.02, 0.22, C.town.dens);
  float roadK = 1.0 - ss(C.road.hw + 1.5, C.road.hw + 5.0, C.road.d);
  vec2 bdq = C.town.bh + 2.5 - abs(C.town.bq);
  C.built = max(max(roadK, C.town.on * (1.0 - ss(C.town.hwS + 1.0, C.town.hwS + 3.5, C.town.ds)) * ss(0.02, 0.22, C.town.dens)),
                step(0.001, C.town.bh.x) * step(0.0, min(bdq.x, bdq.y)));
  open *= (1.0 - townK) * (1.0 - roadK);
#endif

  // ---- farmland: arable land (deep soil, gentle, moist enough, warm enough) in the districts that are farmed ----
  // (in the mountains every scrap of level valley floor is meadow or pasture)
  float farmed = max(ss(0.42, 0.48, macro2 * 0.75 + n0.a * 0.25), ss(500.0, 900.0, h));
  C.crop = ss(0.30, 0.38, E.c.z + 0.12 * (n2.g - 0.5)) * farmed * ss(0.020, 0.010, slope) * ss(6.0, 12.0, h) * (1.0 - ss(0.35, 0.55, arid)) * open;
  C.hedge = 0.0;
  C.fld = TerrField(0.0, 0.0, vec2(1.0), vec2(0.0), vec2(0.0), vec4(0.0), vec2(0.0), 0.0);
  if (C.crop > 0.001) {
    C.fld = terrFieldAt(rxz + uOrigin.xz);
    // hedgerows with trees along some field boundaries, tree-lined section roads, shelter belts at the farmsteads
    float hasHedge = step(0.42, fract(C.fld.id.x * 7.31 + C.fld.blk.z));
    float hd = (1.0 - ss(2.0 - 0.5 * gTerrPx, 5.5 + 0.5 * gTerrPx, C.fld.edge)) * min(1.0, 9.0 / (gTerrPx + 3.0)) * hasHedge * ss(0.30, 0.50, n3.r * 0.6 + n2.r * 0.4);
    float avenue = (1.0 - ss(5.0 - 0.5 * gTerrPx, 8.0 + 0.5 * gTerrPx, abs(C.fld.road - 9.0))) * min(1.0, 15.0 / (gTerrPx + 3.0)) * step(0.62, C.fld.blk.y) * ss(0.35, 0.5, n2.g);
    C.hedge = max(hd, avenue) * C.crop;
  }

  // ---- woodland: the simulated canopy cover, broken into stands and groves by multi-scale noise ------------------
  float fnoise = 0.5 + (C.mac.x - 0.5) * 1.1 + (n2.g - 0.5) * 0.7 + (n0.r - 0.5) * 0.8 + (n3.r - 0.5) * 0.22;
  float dens = E.a.x * (1.0 + 0.10 * C.tropic);
  float fthr = terrThresh(dens, 0.25);
  float stand = ss(fthr - 0.03, fthr + 0.03, fnoise) * ss(0.02, 0.10, dens);
  float lot0 = step(0.895, fract(C.fld.id.y * 5.37 + C.fld.id.x)) * step(0.5, C.crop) * ss(0.15, 0.4, dens);
  // closed forest where the simulation says so; no trees on cliffs or in the water
  stand = max(max(stand, ss(0.94, 0.99, dens)), lot0) * (1.0 - ss(0.42, 0.60, slope)) * open;
  // woods that survive in farmed country: wet hollows and stream lines, the cores of the old stands, and whole
  // parcels left as woodlots (straight edges along the field boundaries)
  float lot = step(0.895, fract(C.fld.id.y * 5.37 + C.fld.id.x)) * ss(1.0 - 0.5 * gTerrPx, 6.0 + 0.5 * gTerrPx, C.fld.edge + 9.0 * (n3.g - 0.5));
  float core = ss(0.74, 0.80, fnoise) * ss(0.25, 0.5, dens);
  float keep = max(max(ss(0.86, 0.93, E.b.w + 0.06 * (n2.r - 0.5)), max(lot, core)), 1.0 - C.crop);
  C.woods = stand * keep;
  C.forest = max(C.woods, C.hedge * 0.9);
#ifdef TERR_SETTLE
  // garden and street trees: more in the leafy outskirts, few in the core and around farmyards
  float garden = townK * (1.0 - C.town.core) * (0.10 + 0.16 * ss(0.3, 0.8, C.town.rr) + 0.3 * step(1.5, C.town.btype)) * (1.0 - 0.8 * step(0.5, C.town.btype) * step(C.town.btype, 1.5)) * ss(0.25, 0.75, n3.g + 0.5 * (C.town.h1.y - 0.5))
               * ss(1.2, 3.2, h) * (1.0 - water) * (1.0 - ss(0.3, 0.7, arid));
  C.forest = max(C.forest, garden) * (1.0 - C.built);
  C.woods *= 1.0 - C.built;
#endif
  C.conifer = clamp(E.a.y + 0.35 * (n2.r - 0.5) * E.a.y * (1.0 - E.a.y) * 4.0, 0.0, 1.0);
  return C;
}
// Same, evaluating the network here (the 3D tree placement pass and other vertex/fragment users).
TerrCover terrCover(vec2 rxz, float h, vec3 n, float curv, float arid, float water, vec4 n0, vec4 n1, vec4 n2, vec4 n3) {
  return terrCoverEco(rxz, h, n, curv, arid, water, n0, n1, n2, n3, terrEco(rxz, h));
}

// Terrain self-shadow: march toward the sun through the height pyramid with geometrically growing steps, taking
// each sample from the level whose texels match the step length (coarse levels are band-limited = prefiltered).
float terrShadow(vec3 rp, vec3 ng, float lvl0, int steps) {
  if (steps <= 0 || uTerrShadowOn < 0.5 || uSunDir.y <= 0.0) return 1.0;
  float tex0 = 1.0 / (uTerrLvl[0].z * float(textureSize(tTerrH, 0).x));     // texel spacing of level 0
  float t = tex0 * exp2(lvl0) * 2.5;
  float grow = pow(40000.0 / t, 1.0 / float(steps));
  grow = clamp(grow, 1.25, 2.2);
  float res = 1.0;
  // start a little off the surface (along its normal) so a steep face does not shadow itself through the
  // coarser, smoother levels the march samples
  vec3 o = rp + (ng * 1.2 + vec3(0.0, 0.35, 0.0)) * (tex0 * exp2(lvl0));
  for (int i = 0; i < steps; i++) {
    vec3 p = o + uSunDir * t;
    float lv = clamp(max(ceil(log2(max(terrLodDist(p.xz), 1.0) / uTerrLod.x)), floor(log2(t / (tex0 * 5.0)))), uTerrLod.y, uTerrLod.z);
    vec4 s = terrTexH(p.xz, lv);
    float clear = (p.y - (s.x + s.y)) / t;            // tan of the clearance angle above the terrain
    res = min(res, clear * 22.0 + 0.5);
    if (res <= 0.0) break;
    t *= grow;
  }
  return smoothstep(0.0, 1.0, res);
}
`;

// Part 2 — the fragment-stage surface shader. TERR_Q: 0 low, 1 medium, 2 high / ultra.
const NEURAL_SURFACE_GLSL = /* glsl */`
uniform mediump sampler2DArray tTerrMat;   // detail layers: rg = height gradient, b = height, a = tint
uniform vec4 uTerrTree;          // 3D trees: x = on, y = full radius, z = end radius
// anisotropy the detail fades may count on (below the texture setting of the quality level: 2 / 4 / 8+)
#if TERR_Q > 1
const float TERR_ANISO = 5.0;
#elif TERR_Q > 0
const float TERR_ANISO = 3.0;
#else
const float TERR_ANISO = 1.5;
#endif
uniform float uTerrWet;          // rain: 0 dry .. 1 soaked ground
// airfield turf (set by terrSurface, read by the turf reflectance): cover, lay direction (world xz), lay 0..1, sward height (m)
float gTurfAmt = 0.0; vec2 gTurfDir = vec2(1.0, 0.0); float gTurfLay = 0.0; float gTurfH = 0.06;
// diffuse albedo the turf colours are written relative to (hemispherical albedo of the traced reference sward)
const vec3 TURF_REF = vec3(0.060, 0.108, 0.034);
uniform vec4 uTurfShell;         // near-field turf shells (veg/turf.js): x = on, y = radius (m)
float gGrassK = 0.0;             // natural grass share of the pixel (gets the long-sward reflectance)

struct TerrSurf { vec3 albedo; float rough; vec3 n; float ao; float shadow; vec3 canopyK; vec3 emis; float specK; };   // canopyK: direct-sun factor of the painted forest (vegetation canopy network)

const float M_GRASS = 0.0, M_SOIL = 1.0, M_GRAVEL = 2.0, M_ROCK = 3.0, M_SAND = 4.0, M_MUD = 5.0, M_CANOPY = 6.0, M_STRATA = 7.0;
// per material: x = tint amplitude, y = cavity (height) darkening, z = detail normal strength, w = roughness
const vec4 TERR_MATP[8] = vec4[8](
  vec4(0.85, 1.00, 1.00, 0.93),    // grass
  vec4(0.60, 0.70, 0.90, 0.90),    // soil
  vec4(0.70, 0.80, 1.20, 0.84),    // gravel / scree
  vec4(0.50, 0.70, 1.40, 0.80),    // rock
  vec4(0.30, 0.40, 0.60, 0.86),    // sand
  vec4(0.35, 0.80, 0.60, 0.78),    // dried mud
  vec4(0.60, 0.95, 1.50, 0.95),    // forest canopy
  vec4(0.50, 0.70, 1.40, 0.80));   // bedded rock

// RMS slope of each material's relief at the scales the detail layers show (input of the micro-relief transfer)
const float TERR_SIG[8] = float[8](0.42, 0.30, 0.45, 0.45, 0.15, 0.08, 0.0, 0.45);
// Coverage of a line of half width hw whose centre is dist away, seen through a pixel px wide (box filter).
float terrLine(float dist, float hw, float px) { return clamp((hw - dist) / px + 0.5, 0.0, 1.0) * min(1.0, 2.0 * hw / px + 0.15); }
// Share of the ground covered when a fraction f is broken into patches by the noise value nz (mean 0.5, sigma sg);
// e = edge softness in noise units. As e grows (distance) the result converges to f itself.
float terrPatch(float f, float nz, float sg, float e) {
  float t = terrThresh(f, sg);
  // near-total cover goes to an even cover: the rare gaps left by a threshold would show the lattice of the noise tile
  float k = max(clamp(e * 2.2 - 0.1, 0.0, 1.0), ss(0.80, 0.95, f));
  return mix(clamp((nz - t) / (2.0 * e) + 0.5, 0.0, 1.0), clamp(f, 0.0, 1.0), k) * ss(0.012, 0.05, f);
}

// Lookups with explicit gradients (legal inside branches, keep anisotropic filtering). dx, dy = screen-space
// derivatives of the render-space xz position.
vec4 terrMatTex(vec3 T, vec2 off, vec2 p, vec2 warp, float layer, vec2 dx, vec2 dy) {
  return textureGrad(tTerrMat, vec3(terrUV(T, off, p) + warp, layer), terrUV(T, vec2(0.0), dx), terrUV(T, vec2(0.0), dy));
}
vec4 terrNoiseTex(vec3 T, vec2 off, vec2 p, vec2 dx, vec2 dy) {
  return textureGrad(tTerrNoise, terrUV(T, off, p), terrUV(T, vec2(0.0), dx), terrUV(T, vec2(0.0), dy));
}
// Detail layer \`layer\` at scale T projected from the side (the two vertical planes of a triplanar mapping).
// Top-down textures smear into streaks down the fall line of cliffs; steep faces use this instead.
void terrSide(vec3 T, vec2 off, vec3 rp, vec3 n, float layer, vec3 dpx, vec3 dpy, out vec4 tx, out vec3 dn) {
  vec2 uv = terrUV(T, off, rp.xz);
  float v = rp.y * T.z;
  vec3 gx = vec3(terrUV(T, vec2(0.0), dpx.xz), dpx.y * T.z), gy = vec3(terrUV(T, vec2(0.0), dpy.xz), dpy.y * T.z);
  vec2 a = vec2(T.x, -T.y), b = vec2(T.y, T.x);       // world directions of the two uv axes
  float na = dot(n.xz, a), nb = dot(n.xz, b);
  float wa = na * na, wb = nb * nb, ws = wa + wb + 1.0e-5;
  vec4 tA = textureGrad(tTerrMat, vec3(uv.y, v, layer), gx.yz, gy.yz), tB = textureGrad(tTerrMat, vec3(uv.x, v, layer), gx.xz, gy.xz);
  tx = (tA * wa + tB * wb) / ws;
  vec2 gA = tA.rg - 0.5, gB = tB.rg - 0.5;
  dn = (vec3(b.x * gA.r, gA.g, b.y * gA.r) * wa + vec3(a.x * gB.r, gB.g, a.y * gB.r) * wb) / ws;
}

// ---- farmland ------------------------------------------------------------------------------------------------------
// Colour of the farm parcel F. wet = soil moisture, n2/n3/n4 = noise, px = metres per pixel. Returns rgb + a = surface
// kind for the detail layers (0 crop canopy / grass, 1 bare soil, 2 gravel).
vec4 terrFieldColor(TerrField F, vec2 w, float h, float wet, vec4 n2, vec4 n3, vec4 n4, float px, vec2 vxz, out float rough, out vec2 fdn) {
  // regional crop mix per district, then the class of this field; mountain valleys grow grass (pasture, hay)
  float t = pow(F.id.x, mix(0.6, 1.7, terrHash2(floor(w / 4020.0) + 9000.0).x));
  if (ss(650.0, 1250.0, h) > fract(F.id.x * 3.7 + F.id.y)) t = F.id.y < 0.55 ? 0.60 : 0.82;
  float stage = F.id.y;
  bool wide = F.size.x > F.size.y;
  float along = wide ? F.pq.x : F.pq.y, across = wide ? F.pq.y : F.pq.x, len = wide ? F.size.x : F.size.y;
  // headlands: at both ends of the field the machine turns and works across
  float head = step(min(along, len - along), 13.0);
  float cr = mix(across, along, head);
  // world direction of the axis the rows are counted along (the field frame is the survey grid, turned 12 degrees)
  vec2 dAx = F.flip > 0.5 ? vec2(0.208, 0.978) : vec2(0.978, -0.208), dAy = F.flip > 0.5 ? vec2(0.978, -0.208) : vec2(0.208, 0.978);
  vec2 crDir = (head > 0.5) == wide ? dAx : dAy;
  fdn = vec2(0.0);
  // growth is uneven: wetter hollows are darker and lusher, dry knolls pale; drill misses and waterlogging
  float vig = clamp(0.5 + 1.1 * (wet - 0.52) + 0.9 * (n3.r - 0.5) + 0.5 * (n2.g - 0.5) + 0.35 * (n4.g - 0.5), 0.0, 1.0);
  vec3 soil = mix(vec3(0.165, 0.130, 0.080), vec3(0.090, 0.070, 0.045), clamp(wet * 1.3 - 0.25 + 0.5 * (n3.g - 0.5), 0.0, 1.0));
  vec3 c; float rowP = 0.0, rowA = 0.0, swP = 0.0, swA = 0.0, tram = 0.0, kind = 0.0;
  rough = 0.92;
  if (t < 0.25) {            // cereal, green: from thin young growth showing soil to dense blue-green
    c = mix(mix(soil, vec3(0.085, 0.150, 0.040), 0.55 + 0.3 * vig), vec3(0.040, 0.098, 0.036), ss(0.25, 0.8, stage));
    c *= 0.82 + 0.36 * vig; tram = 1.0; rowP = 0.25; rowA = 0.10;
  } else if (t < 0.39) {     // ripe grain; some fields are being harvested (stubble behind a straight line)
    c = mix(vec3(0.335, 0.265, 0.115), vec3(0.275, 0.200, 0.085), vig) * (0.9 + 0.2 * stage);
    tram = 1.0;
    float cut = step(0.55, stage) * step(across / max(wide ? F.size.y : F.size.x, 1.0), fract(stage * 9.7));
    c = mix(c, vec3(0.245, 0.215, 0.135), cut); swP = 7.5; swA = 0.10 * cut; tram *= 1.0 - cut;
  } else if (t < 0.50) {     // ploughed / harrowed earth
    c = soil * (0.9 + 0.3 * stage); rowP = 0.45; rowA = 0.30; swP = 6.0; swA = 0.06; kind = 1.0; rough = 0.88;
  } else if (t < 0.69) {     // pasture: mottled, grazed unevenly
    c = mix(vec3(0.105, 0.135, 0.050), vec3(0.052, 0.098, 0.030), vig);
    c = mix(c, vec3(0.180, 0.165, 0.080), ss(0.62, 0.85, n4.r * 0.5 + n3.g * 0.5) * 0.4);
  } else if (t < 0.79) {     // stubble
    c = mix(vec3(0.255, 0.220, 0.130), vec3(0.200, 0.170, 0.100), vig); rowP = 0.25; rowA = 0.12; swP = 7.5; swA = 0.09;
  } else if (t < 0.86) {     // hay: mown, swaths drying in rows
    c = mix(vec3(0.130, 0.160, 0.058), vec3(0.085, 0.125, 0.040), vig); swP = 5.0; swA = 0.22 * step(0.4, stage);
  } else if (t < 0.94) {     // maize: tall, dark, strong rows
    c = mix(vec3(0.060, 0.115, 0.032), vec3(0.034, 0.082, 0.026), vig); rowP = 0.75; rowA = 0.28;
  } else if (t < 0.962) {    // oilseed rape in flower
    c = mix(vec3(0.120, 0.160, 0.040), vec3(0.330, 0.300, 0.060), ss(0.2, 0.6, stage) * (0.6 + 0.4 * vig)); tram = 1.0;
  } else {                   // fallow: weeds over old stubble
    c = mix(vec3(0.190, 0.160, 0.100), vec3(0.075, 0.105, 0.045), ss(0.35, 0.65, n3.r * 0.5 + n4.g * 0.5)); kind = 0.5;
  }
  c *= 0.86 + 0.28 * F.id.y;
  // drill rows / furrows (close up), swaths (from pattern altitude), tramlines (two wheel tracks every 24 m)
  if (rowP > 0.0) {
    float rk = ss(rowP * 0.9, rowP * 0.3, px), ph = cr * 6.2831853 / rowP;
    c *= 1.0 - rowA * (0.5 + 0.5 * sin(ph)) * rk;
    fdn = crDir * (-(0.35 + 1.6 * rowA) * cos(ph) * rk);                 // ridges and furrows catch the light
  }
  // every pass of the machine lays the crop over the other way: alternate bands look lighter or darker depending on
  // which way you look along them (what makes fields read as striped from the air)
  float passW = 6.0 + 6.0 * floor(F.id.y * 3.0), passK = ss(passW * 0.7, passW * 0.2, px) * (1.0 - kind) * step(0.5, 1.0 - head);
  float passS = step(0.5, fract(cr / passW)) * 2.0 - 1.0;
  c *= 1.0 + passK * passS * (0.035 + 0.10 * dot(vxz, vec2(-crDir.y, crDir.x)));
  if (swP > 0.0) c *= 1.0 - swA * step(0.5, fract(cr / swP + 0.25)) * ss(swP * 0.8, swP * 0.25, px);
  if (tram > 0.0) {
    float tx = abs(abs(fract(cr / 24.0) - 0.5) * 24.0 - 0.95);
    c = mix(c, mix(c, soil, 0.75) * 1.05, terrLine(tx, 0.22, px) * tram * ss(5.0, 1.5, px));
  }
  // field margin: an unsown strip, a track along some sides, the hedge bank
  float margin = 1.0 - ss(1.0, 3.5 + px, F.edge);
  c = mix(c, vec3(0.110, 0.130, 0.055) * (0.8 + 0.4 * n4.r), margin * 0.8);
  float track = terrLine(abs(F.edge - 1.6), 0.9, px) * step(fract(F.id.x * 13.7), 0.45);
  c = mix(c, vec3(0.235, 0.205, 0.160), track * 0.8);
  // gravel section roads with grass verges
  float verge = terrLine(F.road, 7.0, px);
  c = mix(c, vec3(0.095, 0.125, 0.050) * (0.8 + 0.4 * n4.g), verge * 0.9);
  float rd = terrLine(F.road, 2.6, px);
  c = mix(c, vec3(0.285, 0.265, 0.225), rd);
  kind = mix(kind, 2.0, step(0.5, rd));
  // farmsteads: a gravel yard inside a shelter belt, near some block corners
  vec2 fpos = (F.bf - vec2(0.12 + 0.2 * F.blk.y, 0.10 + 0.2 * F.blk.z)) * TERR_BLOCK;
  float fd = max(abs(fpos.x), abs(fpos.y)) + 14.0 * (n3.g - 0.5);
  float farm = step(0.45, F.blk.x) * (1.0 - ss(52.0, 60.0 + px, fd));
  c = mix(c, mix(vec3(0.225, 0.205, 0.170) * (0.85 + 0.3 * n4.r), vec3(0.070, 0.105, 0.040), ss(22.0, 30.0, fd + 10.0 * (n4.r - 0.5))), farm);
  // far away a pixel holds many fields: converge to the district mean instead of shimmering
  float farK = ss(0.20, 0.9, px / max(min(F.size.x, F.size.y), 40.0));
  c = mix(c, vec3(0.135, 0.150, 0.068) * (0.9 + 0.2 * vig), farK);
  return vec4(c, kind);
}

TerrSurf terrSurface(vec3 rp) {
  TerrSurf S;
  vec2 w = rp.xz + uOrigin.xz;                        // world metres
  float h = rp.y;
  float d = terrLodDist(rp.xz);
  float pxa = length(dFdx(rp.xz)), pxb = length(dFdy(rp.xz));
  float px = max(pxa, pxb) + 0.001;                   // metres per pixel (map distance, long axis of the footprint)
  // what a texture lookup resolves: anisotropic filtering covers the long axis of a grazing footprint, so detail
  // stays sharp toward the horizon instead of fading with the foreshortening
  float pxt = max(min(pxa, pxb), px / TERR_ANISO) + 0.001;
  vec3 dpx = dFdx(rp), dpy = dFdy(rp);
  vec2 dxz = dpx.xz, dyz = dpy.xz;
  float px3 = max(length(dpx), length(dpy)) + 0.001;                  // metres per pixel on the surface

  // ---- clipmap data, blended across levels exactly like the geometry -------------------------------------
  float lf = terrLevelAt(d);
  vec4 D = terrTexD(rp.xz, lf), G = terrTexH(rp.xz, lf);
  if (lf < uTerrLod.z) {
    float kb = terrMorph(d / (uTerrLod.x * exp2(lf)));
    if (kb > 0.0) { D = mix(D, terrTexD(rp.xz, lf + 1.0), kb); G = mix(G, terrTexH(rp.xz, lf + 1.0), kb); }
  }
  vec3 n = terrDecodeN(D.xy);
  vec3 ng = n;                                        // geometric normal (before detail)
  float curv = (D.z - 0.5) / 1.25;                    // > 0 concave (gully), < 0 convex (spur), per texel of this level
  float conc = (D.w - 0.5) / 1.5;                     // > 0 hollow at ~4 texel scale
  float arid = min(G.z, 1.0), spec = G.w, dune = clamp(G.z - 1.0, 0.0, 1.0);   // (dune fields: height.glsl.js)
  float water = clamp(spec, 0.0, 1.0), playa = clamp(-spec, 0.0, 1.0);
  vec3 Vw = normalize(uTerrCam.xyz - rp);            // toward the camera
  float concW = vTerrAux.x;                           // valley-scale concavity, two levels up (per vertex)

  // ---- the learned ecosystem (per vertex) and the noise fields that break it into patches -----------------
  TerrEco E = TerrEco(vTerrEcoA, vTerrEcoB, vTerrEcoC);
  float eForest = E.a.x, eShrub = E.a.z, eGrass = E.a.w, eRock = E.b.x, eScree = E.b.y, eSnow = E.b.z;
  float wet = E.b.w, eSoil = E.c.x, eWash = E.c.y, eSun = E.c.w;
  vec4 n0 = vTerrN0;                                  // 19 km scale (per vertex)
  vec4 n1 = texture(tTerrNoise, terrUV(TERR_TILE1, uTerrTile[1], rp.xz));
  vec4 n2 = texture(tTerrNoise, terrUV(TERR_TILE2, uTerrTile[2], rp.xz));
  vec4 n3c = texture(tTerrNoise, terrUV(TERR_TILE3, uTerrTile[3], rp.xz));   // as the tree pass reads it (cover)
  // Anti-tiling: the noise that draws the patches is read through a warp by the next larger scales, so the 110 m,
  // 23 m and 4 m tiles never line up into a visible lattice (the warps cost no lookups except for the 110 m one).
#if TERR_Q > 0
  vec4 n3 = texture(tTerrNoise, terrUV(TERR_TILE3, uTerrTile[3], rp.xz) + 0.34 * (n2.rg - 0.5) + 0.8 * (n1.gr - 0.5));
#else
  vec4 n3 = n3c;
#endif
  vec4 n4 = vec4(0.5), n5 = vec4(0.5);
  float near4 = ss(46.0, 12.0, pxt), near5 = ss(8.0, 2.0, pxt);          // fine breakup fades before it can alias
  if (near4 > 0.0) n4 = mix(n4, textureGrad(tTerrNoise, terrUV(TERR_TILE4, uTerrTile[4], rp.xz) + 0.34 * (n3.rg - 0.5) + 0.6 * (n2.gr - 0.5),
                                            terrUV(TERR_TILE4, vec2(0.0), dxz), terrUV(TERR_TILE4, vec2(0.0), dyz)), near4);
#if TERR_Q > 0
  if (near5 > 0.0) n5 = mix(n5, textureGrad(tTerrNoise, terrUV(TERR_TILE5, uTerrTile[5], rp.xz) + 0.34 * (n4.rg - 0.5) + 0.6 * (n3.gr - 0.5),
                                            terrUV(TERR_TILE5, vec2(0.0), dxz), terrUV(TERR_TILE5, vec2(0.0), dyz)), near5);
#endif

  float slope = 1.0 - n.y;                            // 0.03 = 14 deg, 0.13 = 30 deg, 0.29 = 45 deg
  float latK = w.y * 0.001;                           // km south of the origin
  gTerrPx = px;
  TerrCover C = terrCoverEco(rp.xz, h, n, curv, arid, water, n0, n1, n2, n3c, E);
  float macro = n0.r * 0.6 + C.mac.x * 0.4;           // 0..1 large-scale variation
  // ---- rills, chutes and runnels: streaks running down the fall line ---------------------------------------------
  // Noise stretched 22:1 along three fixed directions 60 degrees apart, blended by how well each lines up with the
  // slope (a pattern in a frame that turns with the slope would shear; fixed frames cannot). rill: 0 = channel
  // floor .. 1 = rib between channels, mean 0.5. Only on slopes steeper than ~12 degrees, while resolved.
  float rill = 0.5, rillK = ss(0.022, 0.085, slope) * ss(110.0, 25.0, px) * (1.0 - water) * (1.0 - C.pad);
  if (rillK > 0.0) {
    vec2 sd = normalize(ng.xz + vec2(1.0e-5, 0.0));
    float acc = 0.0, wsum = 1.0e-4;
    for (int i = 0; i < 3; i++) {
      vec2 dI = i == 0 ? vec2(1.0, 0.0) : i == 1 ? vec2(0.5, 0.8660254) : vec2(-0.5, 0.8660254);
      float al = dot(sd, dI), wg = al * al; wg *= wg; wg *= wg;
      if (wg > 0.004) {
        vec2 pI = vec2(-dI.y, dI.x);
        // (the tile is 150 m across the fall line: at 37 m its repeat showed as a comb of identical snow streaks;
        // the larger noise scales bend the streaks so they are not ruled lines)
        vec2 uv = vec2(dot(w, pI) / 150.0 + 0.22 * (n1.r - 0.5) + 0.05 * (n2.g - 0.5), dot(w, dI) / 3300.0) + float(i) * 0.371;
        vec4 rt = textureGrad(tTerrNoise, uv, vec2(dot(dxz, pI) / 150.0, dot(dxz, dI) / 3300.0), vec2(dot(dyz, pI) / 150.0, dot(dyz, dI) / 3300.0));
        acc += wg * (0.6 * rt.g + 0.4 * rt.a); wsum += wg;
      }
    }
    rill = clamp(0.5 + (acc / wsum - 0.5) * 2.4, 0.0, 1.0);
  }
  float rillS = (rill - 0.5) * rillK;                  // signed, faded
  // patch noise: ~normal(0.5, 0.11) at nested scales; the fine part fades with distance and the non-repeating
  // macro noise takes over as the finer scales drop below a pixel, so the far field keeps its breakup
  float farN = ss(6.0, 60.0, px);
  float bk = 0.5 + 0.55 * (n2.r - 0.5) + 0.50 * (n3.g - 0.5) + 0.45 * (n4.r - 0.5) + 0.35 * (n5.g - 0.5) + (0.2 + 0.5 * farN) * (C.mac.y - 0.5);
  float bk2 = 0.5 + 0.55 * (n2.g - 0.5) + 0.50 * (n3.r - 0.5) + 0.45 * (n4.g - 0.5) + 0.35 * (n5.r - 0.5) + (0.2 + 0.5 * farN) * (C.mac.x - 0.5);
  float bk3 = 0.5 + 0.45 * (C.mac.y - C.mac.x) + 0.40 * (n2.r - n2.g) + 0.36 * (n3.g - n3.r) + 0.32 * (n4.r - n4.g) + 0.25 * (n5.g - n5.r);
  // edge softness of the patches: crisp close up, converging to the plain fraction once no noise scale is resolved
  float eps = 0.012 + 0.022 * ss(0.4, 3.0, px) + 0.06 * ss(4.0, 40.0, px) + 0.45 * ss(40.0, 400.0, px);

  float pad = C.pad, treeline = C.treeline, forest = C.forest, conifer = C.conifer, cropPot = C.crop, tropic = C.tropic;

  // ---- climate lines kept from the art direction (colour only) ---------------------------------------------
  float desertAmt = ss(0.42, 0.85, arid + 0.25 * (C.mac.x - 0.5) + 0.1 * (n3.r - 0.5));
  float alpine = ss(treeline - 150.0, treeline + 220.0, h) * (1.0 - desertAmt * 0.7);
  float mat = M_SOIL;                                 // which detail layer this pixel shows

  // ---- bare ground: soil of the humid country, desert earths -------------------------------------------------
  float damp = clamp(wet * 1.25 - 0.15 + 0.3 * (n3.g - 0.5), 0.0, 1.0);
  vec3 earth = mix(vec3(0.165, 0.130, 0.095), vec3(0.088, 0.069, 0.052), damp);
  earth = mix(earth, vec3(0.185, 0.180, 0.172) * (0.8 + 0.4 * n3.g), alpine * 0.9);   // above the trees bare ground is frost-shattered rubble
  vec3 sand = mix(vec3(0.285, 0.210, 0.138), vec3(0.395, 0.318, 0.215), ss(0.3, 0.7, C.mac.y * 0.45 + n2.r * 0.35 + n4.g * 0.2));
  vec3 redEarth = vec3(0.315, 0.170, 0.100);
  float redness = ss(0.45, 0.7, n0.r * 0.7 + n1.r * 0.3) * 0.75;
  vec3 desert = mix(sand, redEarth, redness);
  // desert pavement / darker gravel flats and pale alluvium in a mottled pattern
  desert = mix(desert, desert * vec3(0.74, 0.72, 0.72), ss(0.48, 0.74, C.mac.y * 0.55 + n0.b * 0.25 + n2.r * 0.2) * 0.55);
  // red-rock country: soils take the colour of the flat-lying beds they weather from (broad elevation bands)
  float mesaAmt = 1.0 - ss(26000.0, 60000.0, distance(w, vec2(190000.0, -88000.0)));
  float dh = abs(dFdx(h)) + abs(dFdy(h)) + 0.001;     // metres of height per pixel: bedding must fade before it aliases
  // bedding: beds of irregular thickness along height, tilted and bent a little so they do not read as contour
  // lines; the 1D lookup is mip-filtered by the height one pixel covers, so the layers fade to their mean
  float hb = h + 0.035 * dot(w, vec2(0.6, 0.8)) + 60.0 * (n1.r - 0.5) + 14.0 * (n2.g - 0.5);
  float bedLod = log2(max(dh / 7.4, 1.0)) + 0.6;
  vec4 beds = textureLod(tTerrNoise, vec2(0.37, hb / 1900.0), bedLod);
  vec4 beds2 = textureLod(tTerrNoise, vec2(0.71, hb / 420.0), log2(max(dh / 1.64, 1.0)) + 0.6);
  vec3 strataCol = mix(vec3(0.335, 0.175, 0.105), vec3(0.455, 0.365, 0.255), ss(0.30, 0.70, beds.r + 0.5 * (beds2.g - 0.5)));
  desert = mix(desert, strataCol * (0.9 + 0.2 * n2.g), 0.7 * mesaAmt);
  // grey fan gravels and dark varnished pavements break the red-and-tan; runnels streak the slopes pale and dark
  desert = mix(desert, vec3(0.265, 0.250, 0.225) * (0.85 + 0.3 * n2.g), ss(0.52, 0.66, n0.a * 0.55 + n1.g * 0.45) * 0.6 * (1.0 - mesaAmt));
  desert = mix(desert, desert * vec3(0.52, 0.50, 0.50), ss(0.60, 0.78, n1.b * 0.5 + C.mac.x * 0.5) * ss(0.02, 0.10, slope) * 0.55);
  desert *= 1.0 + 0.55 * rillS;
  desert = mix(desert, vec3(0.42, 0.37, 0.29), ss(0.10, 0.32, -rillS) * 0.7);          // sand and gravel in the runnel floors
  // dune sand: clean, warm, a little darker and coarser in the troughs between the dunes
  vec3 duneCol = mix(vec3(0.400, 0.290, 0.170), vec3(0.520, 0.405, 0.262), ss(-0.03, 0.05, -curv) * 0.6 + 0.4 * n1.r) * (0.94 + 0.12 * n3.r);
  desert = mix(desert, duneCol, dune);
  vec3 col = mix(earth, desert, desertAmt);
  float rough = mix(0.90, 0.86, desertAmt);
  mat = mix(M_SOIL, M_SAND, step(0.5, desertAmt * (0.35 + 0.65 * ss(0.40, 0.60, bk3))));
  if (alpine > 0.5) mat = M_GRAVEL;
  if (dune > 0.5) mat = M_SAND;
  // desert washes and torrent beds: pale gravel and sand where the simulation routes floods
  float washAmt = terrPatch(eWash * (0.55 + 0.45 * desertAmt), bk2 - 0.45 * rillS, 0.11, eps + 0.03) * (1.0 - dune);
  col = mix(col, mix(vec3(0.335, 0.315, 0.285), vec3(0.44, 0.38, 0.28), desertAmt) * (0.9 + 0.2 * n3.r), washAmt * 0.85);
  if (washAmt > 0.5) mat = M_GRAVEL;

  // ---- grass and herbs: lush where the soil holds water, straw-coloured where it dries out -----------------------
  float lush = clamp((wet - 0.34) * 2.6 + 0.9 * (n2.g - 0.5) + 0.5 * (n3.r - 0.5), 0.0, 1.0);
  vec3 grassDry = mix(vec3(0.250, 0.215, 0.105), vec3(0.185, 0.170, 0.080), n2.r);
  vec3 grassGreen = mix(vec3(0.098, 0.135, 0.046), vec3(0.046, 0.090, 0.027), ss(0.35, 0.95, lush));
  vec3 grass = mix(grassDry, grassGreen, ss(0.0, 0.5, lush));
  grass = mix(grass, mix(vec3(0.150, 0.150, 0.075), vec3(0.105, 0.125, 0.058), lush), alpine * 0.8);   // alpine turf
  grass = mix(grass, vec3(0.060, 0.115, 0.030), tropic * 0.5 * lush);
  grass *= 0.88 + 0.24 * clamp(0.5 + (n3.r - 0.5) + 0.8 * (n4.g - 0.5), 0.0, 1.0);
  // the simulated grass and shrub fractions are shares of all ground; trees take their share in separate stands,
  // so the open ground between the stands carries the rest
  float openFrac = max(1.0 - 0.95 * eForest, 0.06);
  float herb = clamp((eGrass + eShrub) / openFrac, 0.0, 1.0);
  // dry country: bunch grass between the bushes covers a fraction of the ground, the soil colour carries the scene
  herb *= (1.0 - 0.72 * desertAmt) * (1.0 - 0.95 * dune);
  // below the tree line in a humid climate, ground that carries soil is never bare for long
  herb = max(herb, 0.88 * ss(0.30, 0.50, wet) * ss(0.12, 0.35, eSoil) * (1.0 - alpine));
  float dry = ss(0.25, 0.60, arid);
  float grassAmt = terrPatch(herb, bk, 0.12, eps + 0.22 * dry);
  grassAmt *= 1.0 - washAmt * 0.8;
  col = mix(col, grass, grassAmt);
  rough = mix(rough, 0.93, grassAmt);
  if (grassAmt > 0.5) mat = M_GRASS;
  // shrubs and heath: dark clumps over the ground (sagebrush and creosote in the dry country, krummholz and heath
  // on the mountain, scrub regrowth in the lowland)
  // bushes are a metre or two across (the cells of the 23 m tile): single plants close up, irregular clumps and
  // finally a tint of the ground from further off. Stand density drifts over hundreds of metres. (The cells of the
  // larger tiles are not used: a jittered grid of 7 m cells shows as a weave from the air.)
  float bushes = ss(1.3, 0.4, pxt);
  float shrubN = 0.5 + 0.85 * (bk2 - 0.5) + (0.45 - n4.b) * 0.55 * bushes;
  float shrubF = (eShrub / openFrac * 1.1 * (1.0 - 0.5 * desertAmt) + 0.035 * desertAmt * (1.0 - playa)) * (1.0 - 0.92 * dune);
  shrubF *= mix(1.0, 0.5 + 1.0 * ss(0.25, 0.75, 0.5 + (C.mac.y - 0.5) + 0.6 * (n2.g - 0.5)), 0.5 + 0.5 * dry);
  float shrubAmt = terrPatch(clamp(shrubF, 0.0, 1.0), shrubN, 0.12, eps + 0.02 + 0.3 * dry * (1.0 - bushes));
  vec3 shrubCol = mix(mix(vec3(0.060, 0.082, 0.036), vec3(0.105, 0.104, 0.070), desertAmt), vec3(0.070, 0.075, 0.040), alpine);
  col = mix(col, shrubCol * (0.8 + 0.4 * n4.g), shrubAmt * 0.85);
  if (shrubAmt > 0.6) mat = M_GRASS;

  // ---- forest -------------------------------------------------------------------------------------------------
  vec3 fcol = mix(vec3(0.036, 0.066, 0.022), vec3(0.024, 0.045, 0.021), conifer);
  fcol = mix(fcol, fcol * vec3(1.30, 1.18, 0.9), ss(0.45, 0.8, n2.r) * (1.0 - conifer) * 0.4);
  fcol = mix(fcol, fcol * vec3(1.22, 1.10, 0.80), (1.0 - lush) * 0.35);         // drier stands are paler, yellower
  fcol = mix(fcol, vec3(0.030, 0.052, 0.016), tropic * 0.5);
#ifdef VEG_CANOPY
  // the stand reflectance the vegetation path tracer measured (src/terrain/veg/canopy.js): the painted forest takes the
  // stand's diffuse albedo (keeping its relative variation) and its view / sun dependence for direct light, so it
  // matches the 3-D trees it replaces at a distance
  VegCanopy vegK = vegCanopy(rp, clamp(forest * 1.1 - 0.05, 0.0, 1.0), conifer);
  fcol *= vegK.albedo / mix(vec3(0.036, 0.066, 0.022), vec3(0.024, 0.045, 0.021), conifer);
#endif
  // where 3D trees stand (trees.js) the ground shows as shaded forest floor instead of painted crowns
  float t3d = uTerrTree.x * (1.0 - ss(uTerrTree.y, uTerrTree.z, distance(rp.xz, uTerrCam.xz)));
  // painted canopy: crowns from the canopy detail layer at two scales; thin stands break up into single crowns
  float crown = 0.5, canopyAO = 1.0; vec2 crownG = vec2(0.0);
  float canopy = 0.0;
  if (forest > 0.004) {
    vec4 cn = terrMatTex(TERR_TILE3, uTerrTile[3], rp.xz, 0.035 * (n2.rg - 0.5), M_CANOPY, dxz, dyz);
    // crowns (8 m) resolve below ~3 m per pixel. (They used to start at 7 m per pixel: under-sampled, the crown
    // lattice chopped hedgerows and the roads beside them into regular dashes - the "white staircase" seen from
    // a few kilometres up.)
    float fine = ss(3.4, 1.3, pxt);
    crown = mix(0.5, cn.b, fine);
    crownG = terrUnrot(TERR_TILE3, cn.rg - 0.5) * fine;
    canopy = mix(forest, clamp((cn.b - (1.0 - forest * 1.04)) * 6.0 + 0.5, 0.0, 1.0) * ss(0.0, 0.08, forest), fine * 0.85);
    canopy = max(canopy, C.hedge * 0.8);               // a hedgerow is a continuous strip, not a row of dots
    // sunlit crown tops over the dark gaps between the trees; every crown its own shade of green
    fcol *= mix(1.0, (0.62 + 0.76 * cn.a) * (0.55 + 0.75 * ss(0.15, 0.75, cn.b)), fine) * mix(1.0, 0.86, conifer);
    canopyAO = mix(1.0, 0.30 + 0.92 * crown, fine);
    // from further off the canopy reads as an uneven, mottled surface (no cell pattern: it would show its grid)
    float fineF = ss(40.0, 8.0, pxt) * (1.0 - 0.7 * fine);
    fcol *= 1.0 + fineF * (0.9 * (n3.g - 0.5) + 0.5 * (n3.r - 0.5));
    canopyAO *= 1.0 + fineF * 0.8 * (n3.g - 0.5);
    fcol *= (0.84 + 0.32 * n2.g) * (0.80 + 0.40 * C.mac.y);   // stand-to-stand variety
  }
  float floorAmt = canopy * t3d;                       // forest floor under real trees
#ifdef VEG_CANOPY
  floorAmt = t3d * clamp(forest * 1.1 - 0.05, 0.0, 1.0);   // as much floor as there are 3-D trees (their cell occupancy)
#endif
  vec3 floorCol = mix(vec3(0.060, 0.050, 0.032), vec3(0.050, 0.072, 0.030), ss(0.4, 0.7, bk)) * (0.8 + 0.4 * n4.r);
  float paint = canopy * (1.0 - t3d);

  // ---- cropland patchwork ---------------------------------------------------------------------------------------
  float cropAmt = cropPot * (1.0 - C.hedge);
  vec2 fieldDn = vec2(0.0);
  if (cropPot > 0.001) {
    float fr;
    vec2 fdn;
    vec4 fc = terrFieldColor(C.fld, w, h, wet, n2, n3, n4, px, Vw.xz, fr, fdn);
    fieldDn = fdn * cropAmt;
    col = mix(col, fc.rgb, cropAmt);
    rough = mix(rough, fr, cropAmt);
    if (cropAmt > 0.5) mat = fc.a > 1.5 ? M_GRAVEL : fc.a > 0.75 ? M_SOIL : M_GRASS;
  }
  col = mix(col, floorCol, floorAmt * 0.9);
  if (floorAmt > 0.5) mat = M_SOIL;
  // centre-pivot irrigation in the dry margins
  float pivPot = ss(0.30, 0.45, arid) * ss(0.92, 0.75, arid) * ss(0.010, 0.004, slope) * ss(4.0, 10.0, h) * ss(900.0, 700.0, h)
               * (1.0 - pad) * (1.0 - playa) * (1.0 - water) * ss(0.50, 0.56, n0.g * 0.5 + C.mac.x * 0.5) * ss(0.25, 0.5, eSoil);
  if (pivPot > 0.001) {
    vec2 b = w / 830.0, bi = floor(b), bf = b - bi - 0.5;
    vec2 hp = terrHash2(bi + 2048.0);
    float r = length(bf) * 830.0;
    float disc = (1.0 - ss(385.0 - px, 390.0 + px, r)) * step(hp.x, 0.8);
    float ang = atan(bf.y, bf.x);
    // sectors at different stages, the wheel tracks of the pivot towers, the pivot pad
    float sector = step(0.5, fract(ang * 0.159155 * (1.0 + floor(hp.y * 3.0)) + hp.x * 4.0));
    vec3 c = mix(vec3(0.060, 0.128, 0.036), vec3(0.265, 0.225, 0.105), step(0.66, hp.y) * sector);
    c = mix(c, vec3(0.120, 0.150, 0.050), step(hp.y, 0.3) * sector * 0.6);
    c *= 0.9 + 0.2 * n3.r;
    c = mix(c, c * 0.72 + vec3(0.03, 0.025, 0.02), terrLine(abs(fract(r / 55.0 + 0.5) - 0.5) * 55.0, 0.5, px) * ss(4.0, 1.5, px));
    c = mix(c, vec3(0.26, 0.24, 0.20), 1.0 - ss(4.0, 6.0 + px, r));
    col = mix(col, c, disc * pivPot);
    if (disc * pivPot > 0.5) mat = M_GRASS;
  }
  // ---- airfield grass -----------------------------------------------------------------------------------------
  // Mown in long passes parallel to the runway (every other pass lays the blades the other way: the stripes are a
  // view-dependent effect, see the turf reflectance below), short in the graded strip next to the pavement and left
  // long further out (bird control), clumpy, with dry knolls, weedy patches and a worn, gritty verge at the pavement
  // edge. Distances to the pavement come from the airfield map (airfield.js).
  float turf = pad * (1.0 - desertAmt) * (1.0 - ss(1.0, 3.0, 4.0 - h));
  gTurfAmt = 0.0;
  if (turf > 0.001) {
    vec2 am = airMap(rp.xz);
    float dP = am.x;
    TurfP TP = turfPlan(w, dP, n2.r, n2.g, n3.r);
    float longG = TP.longG, since = TP.since, pf = TP.pf, passW = TP.passW;
    gTurfH = TP.H; gTurfLay = TP.lay; gTurfDir = TP.dir;
    vec3 tc = TURF_REF;
    // clumps and tussocks (0.3 - 4 m), patchy growth (20 - 100 m)
    float clump = 0.55 * (n5.g - 0.5) * near5 + 0.6 * (n4.r - 0.5) * near4 + 0.5 * (n3.g - 0.5) + 0.35 * (C.mac.y - 0.5);
    tc *= clamp(1.0 + 0.45 * clump, 0.6, 1.5);
    // dry, straw-coloured knolls; seed heads in the long grass; dark clover and weeds in the short sward
    float dryP = ss(0.56, 0.80, n2.r * 0.45 + n3.b * 0.35 + (near4 * (n4.g - 0.5) + 0.5) * 0.2) * (0.45 + 0.4 * longG) * (1.0 - 0.6 * lush * lush);
    tc = mix(tc, grassDry * 0.8, dryP);
    tc = mix(tc, vec3(0.150, 0.135, 0.078), longG * 0.28 * ss(0.35, 0.8, n4.b * near4 + 0.5 * (1.0 - near4)));
    tc = mix(tc, vec3(0.036, 0.080, 0.028), (1.0 - longG) * ss(0.60, 0.82, n4.a * 0.6 * near4 + 0.3 * (1.0 - near4) + n3.a * 0.4) * 0.55);
    // mower wheel tracks along the pass edges (flattened, a touch paler), only while resolved
    float trk = terrLine(abs(pf - 0.5) * passW - (0.5 * passW - 0.45), 0.18, px) * ss(1.5, 0.4, px) * (1.0 - longG) * (1.0 - since);
    tc *= 1.0 + 0.10 * trk;
    // worn verge: thin turf over soil and grit washed off the pavement, then the shadowed drop at the edge itself
    float edge = ss(2.6 + 1.6 * (n4.g - 0.5) * near4 + 1.0 * (n3.r - 0.5), 0.15, dP);
    vec3 grit = mix(vec3(0.150, 0.128, 0.094), vec3(0.205, 0.195, 0.175), ss(0.3, 0.7, n5.r * near5 + 0.5 * (1.0 - near5))) * (0.85 + 0.3 * n4.b);
    float bare = edge * (0.35 + 0.55 * ss(0.35, 0.75, n4.r * 0.5 * near4 + 0.25 + n5.b * 0.5 * near5 + 0.25 * (1.0 - near5)));
    tc = mix(tc, grit, bare);
    float lip = ss(0.40, 0.0, dP) * ss(-0.3, -0.05, dP);
    tc *= 1.0 - 0.5 * lip;
    // turf without an airfield map (other airports, classic fallback): the old diagonal stripe tint
    if (uAirInfo.z < 0.5) tc *= 0.94 + 0.12 * step(0.5, fract((w.x + w.y) / 14.0)) * ss(6.0, 1.0, px);
    // under the 3-D shells (near the camera) the ground between the blades is thatch and shade
    float shellK = uTurfShell.x * (1.0 - ss(uTurfShell.y * 0.45, uTurfShell.y * 0.85, distance(rp.xz, uTerrCam.xz))) * (1.0 - bare);
    tc = mix(tc, vec3(0.050, 0.052, 0.030), shellK * 0.55);
    col = mix(col, tc, turf * 0.95);
    rough = mix(rough, mix(0.95, 0.88, bare), turf);
    gTurfAmt = turf * (1.0 - bare);
    if (turf > 0.5) mat = bare > 0.45 ? M_GRAVEL : M_GRASS;
  }

  // ---- scree and bare rock: where the simulation strips the soil, plus anything too steep to hold it ------------
  // talus tongues run down the chutes; ribs of rock stand between them
  float screeAmt = terrPatch(clamp(eScree + 0.5 * max(-rillS, 0.0) * ss(0.10, 0.30, slope) * max(eRock, eScree), 0.0, 1.0), bk2 - 0.7 * rillS, 0.11, eps) * (1.0 - 0.7 * paint);
  float steepPix = ss(0.50, 0.66, slope + 0.16 * (n3.a - 0.5) + 0.08 * (n4.a - 0.5) + 0.12 * rillS);
  float rockAmt = max(terrPatch(eRock, bk3 + 0.5 * rillS, 0.11, eps), steepPix);
  // outcrops poke through thin soils on steeper ground
  // (needs real slope, and an edge as soft as the pixel: on the flat coastal plain this term used to scatter
  // hard-edged pale rock patches over the grass - the jagged white patches reported at the Haven coast)
  rockAmt = max(rockAmt, clamp((bk3 + 0.9 * slope + 0.35 * (1.0 - eSoil) - 1.10) / (0.05 + 2.0 * eps) + 0.5, 0.0, 1.0) * ss(0.012, 0.05, slope) * (1.0 - cropPot));
  rockAmt *= 1.0 - pad * 0.9;
  vec3 granite = mix(vec3(0.120, 0.118, 0.116), vec3(0.235, 0.226, 0.212), ss(0.2, 0.8, n2.r * 0.6 + n3.g * 0.4));
  granite *= 0.86 + 0.28 * beds.r + 0.16 * (beds2.r - 0.5);                             // bedding, filtered
  granite = mix(granite, granite * vec3(0.62, 0.60, 0.58), ss(0.55, 0.85, n3.a - 0.5 * rillS) * 0.6);   // dark seepage / lichen, water streaks down the runnels
  granite = mix(granite, granite * vec3(0.80, 0.86, 0.74), ss(0.5, 0.9, wet) * (1.0 - alpine) * 0.5);   // moss, lichen in damp shade
  // sandstone: colour follows the (tilted, mip-filtered) beds
  vec3 sandstone = mix(vec3(0.290, 0.130, 0.072), vec3(0.50, 0.315, 0.19), ss(0.25, 0.75, beds.g + 0.6 * (beds2.r - 0.5)));
  sandstone = mix(sandstone, vec3(0.50, 0.41, 0.31), ss(0.62, 0.72, beds.a) * 0.7);
  vec3 rockCol = mix(granite, sandstone, ss(0.45, 0.75, arid));
  vec3 screeCol = mix(rockCol * 1.15, vec3(0.30, 0.285, 0.265), 0.35);
  col = mix(col, screeCol, screeAmt * 0.92);
  if (screeAmt > 0.5) mat = M_GRAVEL;
  col = mix(col, rockCol, rockAmt);
  rough = mix(rough, 0.82, max(rockAmt, screeAmt));
  float steep = ss(0.24, 0.50, slope);
  if (rockAmt > 0.5) mat = M_ROCK;

  gGrassK = grassAmt * (1.0 - cropAmt) * (1.0 - washAmt) * (1.0 - rockAmt) * (1.0 - screeAmt) * (1.0 - turf) * (1.0 - 0.6 * shrubAmt);
  // painted forest canopy goes over ground, scree and low outcrops (but not over cliffs)
  paint *= 1.0 - steepPix;
  gGrassK *= 1.0 - paint;
  col = mix(col, fcol, paint);
  rough = mix(rough, 0.95, paint);
  if (paint > 0.5) mat = M_CANOPY;

  // ---- snow and glacier ice -------------------------------------------------------------------------------------
  // late-lying snow from the simulation (shaded faces, loaded gullies, avalanche cones); it cannot hold on the
  // steepest pixels, and drifts sit in the small hollows first
  eSnow *= ss(treeline - 1000.0, treeline - 650.0, h);      // no late snow in the warm lowlands, whatever the network extrapolates
  float snowF = clamp(eSnow * 1.25 + 0.9 * clamp(conc, -0.06, 0.12) * ss(0.02, 0.3, eSnow), 0.0, 1.0);
  // above the climatic firn line (not simulated: the simulation ends at the late-summer melt-out) snow is permanent
  // wherever the ground is not too steep to hold it
  float firn = ss(treeline + 650.0, treeline + 1350.0, h + 260.0 * (C.mac.x - 0.5)) * (1.0 - 0.8 * desertAmt);
  snowF = max(snowF, 0.92 * firn);
  // drifts linger in the hollows and gullies first; a little broad noise so the edges are not contour lines
  float bkS = 0.5 - 0.6 * rillS * ss(0.06, 0.2, slope) + 1.0 * clamp(conc, -0.10, 0.10) + 0.8 * clamp(curv, -0.06, 0.06) + 0.55 * (n2.r - 0.5) + 0.30 * (n3.g - 0.5) + 0.6 * farN * (C.mac.x - 0.5);
  float snow = terrPatch(snowF, bkS, 0.12, eps + 0.03) * max(ss(0.04, 0.14, eSnow), firn) * (1.0 - ss(0.40, 0.62, slope + 0.10 * (n3.r - 0.5)));
  snow *= 1.0 - 0.8 * paint * ss(0.9, 0.5, eSnow);
  vec3 snowCol = vec3(0.86, 0.88, 0.91) * (0.95 + 0.07 * n3.r);
  // old firn / glacier ice shows through in the big hollows; dust and debris bands near the snow margin
  float ice = snow * ss(0.03, 0.12, concW) * ss(0.10, 0.02, slope);
  snowCol = mix(snowCol, vec3(0.56, 0.68, 0.75) * (0.9 + 0.2 * n3.a), ice * 0.6);
  snowCol = mix(snowCol, snowCol * vec3(0.80, 0.77, 0.72), ss(0.75, 0.25, eSnow) * ss(0.45, 0.7, bk3) * 0.6);
  col = mix(col, snowCol, snow);
  rough = mix(rough, 0.60, snow);
  if (snow > 0.5) mat = M_SAND;                       // wind-rippled

  float wsurf0 = ss(0.3, 0.8, water);
  // ---- shore: beaches, wet sand, seabed -------------------------------------------------------------------------
  vec3 beachCol = mix(vec3(0.43, 0.375, 0.275), vec3(0.62, 0.585, 0.485), tropic) * (0.92 + 0.16 * n3.g);
  // dune grass behind the beach, then the sand itself
  col = mix(col, mix(grassDry * 1.15, beachCol, 0.35 + 0.3 * n3.r), ss(4.2 + 1.0 * n2.r, 2.6, h) * ss(0.2, 0.06, slope) * (1.0 - wsurf0) * 0.7);
  float beach = ss(2.5 + 1.2 * n3.r, 1.3, h) * ss(0.16, 0.05, slope);
  col = mix(col, beachCol, beach * (1.0 - wsurf0));
  if (beach > 0.5) mat = M_SAND;
  float tide = ss(0.9, 0.1, h) * ss(-1.2, -0.3, h);
  if (h < 0.5) {
    float depth = max(-h, 0.0);
    vec3 bed = mix(beachCol, vec3(0.20, 0.22, 0.17), ss(0.0, 25.0, depth));
    bed = mix(bed, vec3(0.07, 0.09, 0.08), ss(15.0, 90.0, depth));
    // reef rock, coral heads and seagrass in the shallows
    float reefP = ss(0.50, 0.62, n2.g * 0.6 + n3.g * 0.4) * ss(0.4, 1.5, depth) * ss(30.0, 8.0, depth);
    bed = mix(bed, mix(vec3(0.10, 0.11, 0.07), vec3(0.16, 0.13, 0.09), n3.r), reefP * (0.45 + 0.4 * tropic));
    col = mix(col, bed, ss(0.5, -0.3, h));
    if (reefP > 0.5) mat = M_ROCK;
  }

  // ---- playa (dry lake) and open fresh water -------------------------------------------------------------------
  if (playa > 0.001) {
    // pale silt and clay, a little whiter (salt crust) toward the middle of the pan; broad, faint tonal bands
    vec3 pc = mix(vec3(0.430, 0.380, 0.300), vec3(0.520, 0.485, 0.410), ss(0.30, 0.70, n0.g * 0.75 + n1.r * 0.25));
    // damp, darker clay where the last water stood; wind / sheet-flow streaks
    pc = mix(pc, pc * vec3(0.80, 0.78, 0.76), ss(0.55, 0.70, n0.r * 0.8 + n1.a * 0.2) * 0.6);
    pc *= 0.96 + 0.04 * sin((w.x * 0.8 + w.y * 0.6) * 0.004 + n0.g * 14.0) + 0.05 * (n1.g - 0.5);
    pc *= 1.0 - 0.10 * ss(0.78, 0.95, n3.b) * ss(5.0, 1.2, px);          // giant desiccation polygons
    col = mix(col, pc, playa);
    rough = mix(rough, 0.8, playa);
    if (playa > 0.5) mat = M_MUD;
  }
  // gravel bars beside the channel, then the water itself
  float bar = ss(0.02, 0.4, water) * (1.0 - ss(0.5, 0.8, water)) * 0.8 * ss(10.0, 2.5, px);
  col = mix(col, vec3(0.31, 0.295, 0.265) * (0.85 + 0.3 * n4.r), bar);
  if (bar > 0.5) mat = M_GRAVEL;
  float wsurf = ss(0.5, 0.8, water);


#ifdef TERR_SETTLE
  // ---- settlements and roads (settle.js) ------------------------------------------------------------------------
  float paved = 0.0, roofAmt = 0.0, bShade = 0.0;     // smooth man-made surface; painted roof; building shadow
  vec3 roofN = vec3(0.0, 1.0, 0.0), emis = vec3(0.0);
  {
    TerrTown T = C.town;
    float slant = distance(rp, uTerrCam.xyz);
    // where the buildings are real geometry (buildings.js) only their footprint is painted
    float b3d = uSetOn.w > 0.0 ? 1.0 - ss(0.8 * uSetOn.w, uSetOn.w, slant) : 0.0;
    if (T.on > 0.5) {
      float tk = ss(0.02, 0.22, T.dens) * ss(0.6, 1.8, h);
      float occ = step(0.001, T.bh.x);
      float farm = step(T.kind, 0.5);
      float shedB = step(0.5, T.btype) * step(T.btype, 1.5), green = step(1.5, T.btype);
      float hardY = max(T.core, shedB);
      // yards: lawn and garden beds, paved courts in the core, gravel farmyards in the hamlets
      vec3 lawn = mix(vec3(0.060, 0.104, 0.034), vec3(0.110, 0.128, 0.052), ss(0.3, 0.7, n4.g * 0.6 + T.h1.x * 0.4)) * (0.86 + 0.28 * T.h2.y);
      lawn = mix(lawn, grassDry * 0.9, 0.75 * desertAmt);
      vec3 court = vec3(0.150, 0.146, 0.138) * (0.85 + 0.3 * n4.r);
      vec3 yard = mix(lawn, court, max(hardY * 0.92, farm * 0.55 * ss(0.4, 0.6, T.h2.x)));
      yard = mix(yard, vec3(0.050, 0.095, 0.030) * (0.85 + 0.3 * n3.g), green);                     // parks and playing fields
      float lotAmt = tk * max(max(occ, hardY), green) * (1.0 - snow * 0.9);
      col = mix(col, yard, lotAmt * 0.92);
      rough = mix(rough, 0.92, lotAmt);
      if (lotAmt > 0.5) mat = hardY > 0.5 ? M_GRAVEL : M_GRASS;
      paved = max(paved, lotAmt * hardY * 0.8);
      // fences and hedges on the lot lines, a drive from the street to the house
      float nearK = ss(3.0, 0.7, px);
      col = mix(col, vec3(0.035, 0.055, 0.026), terrLine(T.lotEdge, 0.55, px) * occ * (1.0 - hardY) * tk * 0.75 * nearK * step(0.35, T.h1.y));
      vec2 dq = T.bh - abs(T.bq);
      float inside = min(dq.x, dq.y);
      float drive = terrLine(abs(T.bq.x - (T.h2.x - 0.5) * T.bh.x), 1.4, px) * step(0.0, -T.bq.y * T.front) * occ * (1.0 - hardY) * step(inside, 0.0);
      col = mix(col, vec3(0.185, 0.175, 0.160), drive * tk * 0.85 * ss(6.0, 1.5, px));
      // the building: a roof seen from above; gable roofs get their two planes (ridge along the street)
      float roof = clamp(inside / px + 0.5, 0.0, 1.0) * occ * tk;
      if (roof > 0.0) {
        vec3 rc = settleRoofColor(T.h1, T.h2, T.roofK, tropic);
        float rowK = ss(0.9, 0.25, px);
        rc *= 1.0 - 0.14 * rowK * T.roofK * step(0.5, fract(T.bq.y * 3.1));                           // courses of tiles
        rc *= 1.0 - 0.25 * (1.0 - T.roofK) * (1.0 - ss(0.0, 0.7, inside)) * ss(1.5, 0.4, px);        // parapet
        // roof plant and skylights on the flat roofs
        vec2 pl = floor((T.bq + T.bh) / 3.2);
        rc = mix(rc, vec3(0.30, 0.31, 0.32), (1.0 - T.roofK) * step(0.86, terrHash2(pl + T.h1 * 977.0).x) * ss(3.0, 1.0, px) * step(1.2, inside));
        rc *= 0.9 + 0.2 * n5.r;
        // far away single roofs are smaller than a pixel: converge to the mean roof instead of sparkling
        rc = mix(rc, mix(vec3(0.185, 0.180, 0.172), vec3(0.165, 0.105, 0.080), T.roofK), ss(3.0, 14.0, px) * 0.85);
        float lz = sign(T.bq.y) * 0.5 * T.roofK * ss(0.25, 0.6, abs(T.bq.y) / max(px, 0.05) * 0.5 + 0.3);
        vec3 rn = normalize(vec3(-T.ax.y * lz, 0.866, T.ax.x * lz));
        float paintRoof = roof * (1.0 - b3d);
        col = mix(col, mix(rc, col * 0.35, b3d), roof);
        roofN = rn; roofAmt = paintRoof;
        rough = mix(rough, 0.80, roof);
        paved = max(paved, roof);
      }
      // the shadow the building throws (analytic box shadow in the lot's frame); also under the 3-D buildings, which
      // the sun shadow map does not reach away from the aircraft
      if (occ > 0.5 && inside < 0.0 && uSunDir.y > 0.02) {
        vec2 sl = vec2(dot(uSunDir.xz, T.ax), dot(uSunDir.xz, vec2(-T.ax.y, T.ax.x)));
        float hl = length(sl) + 1.0e-4;
        vec2 dir = sl / hl + vec2(1.0e-4, -1.0e-4);
        float smax = (T.bH + 1.2 * T.roofK) * hl / uSunDir.y;
        vec2 t1 = (-T.bh - T.bq) / dir, t2 = (T.bh - T.bq) / dir;
        float tn = max(min(t1.x, t2.x), min(t1.y, t2.y)), tf = min(max(t1.x, t2.x), max(t1.y, t2.y));
        bShade = clamp((tf - max(tn, 0.0)) / px + 0.5, 0.0, 1.0) * clamp((smax - tn) / max(px, 0.3) + 0.5, 0.0, 1.0) * step(0.0, tf) * tk;
      }
      // streets: asphalt between pavements (kerb stones in towns), patched and worn
      float sAmt = terrLine(T.ds, T.hwS, px) * tk;
      float walk = terrLine(T.ds, T.hwS + 1.7, px) * tk * step(0.5, T.kind);
      col = mix(col, vec3(0.270, 0.262, 0.245) * (0.9 + 0.2 * n5.g), walk * 0.9);
      vec3 tar = mix(vec3(0.052, 0.054, 0.058), vec3(0.105, 0.102, 0.097), ss(0.3, 0.7, n3.r * 0.5 + n4.g * 0.5));
      tar = mix(tar, vec3(0.245, 0.225, 0.190), farm * 0.8);                                         // farm lanes are gravel
      tar *= 1.0 - 0.10 * ss(0.5, 0.2, abs(abs(T.ds) - 1.4)) * ss(1.2, 0.3, px);                    // wheel tracks
      tar = mix(tar, vec3(0.50), terrLine(T.ds, 0.07, px) * step(1.5, T.kind) * step(0.45, fract(T.along / 9.0)) * ss(2.0, 0.5, px) * 0.7);
      col = mix(col, tar, sAmt);
      rough = mix(rough, 0.86, sAmt);
      paved = max(paved, max(sAmt, walk) * (1.0 - farm));
      // street lamps: pools of light on the ground; lamps merge into lit streets and then into the town's glow with
      // distance (each stage keeps the area mean of the one before, so the town does not change brightness)
      if (uSetOn.z > 0.002) {
        float dens = T.dens * (farm > 0.5 ? 0.35 : 1.0) * (1.0 + 0.7 * T.core) * (1.0 - 0.85 * green);
        float al = (fract(T.along / 34.0) - 0.5) * 34.0;
        float sg2 = 2.0 * 6.0 * 6.0;
        float e1 = exp(-(al * al + T.ds * T.ds) / sg2);
        float e2 = 0.442 * exp(-T.ds * T.ds / sg2);                 // mean along the street: sqrt(2 pi) sigma / spacing
        float e3 = 0.442 * 15.04 * 0.0300;                           // mean over the blocks: x sqrt(2 pi) sigma (1 / bw + 1 / bd)
        float e = mix(mix(e1, e2, ss(5.0, 16.0, px)), e3, ss(24.0, 80.0, px));
        // (saturated on purpose: the night grade in post pulls everything dimmer than a lamp towards blue)
        vec3 lamp = mix(vec3(1.0, 0.40, 0.09), vec3(1.0, 0.58, 0.24), step(0.62, T.lamp));
        // lit windows and yard lights spill a little warm light around every other house
        float spill = occ * step(T.h2.y, 0.6) * exp(-max(-inside, 0.0) * 0.35) * step(inside, 0.0) * 0.5;
        spill = mix(spill, 0.05, ss(6.0, 30.0, px));
        // arterial streets carry taller, brighter, whiter lamps: the grid a city shows from the air
        lamp = mix(lamp, vec3(1.0, 0.52, 0.17), T.art * 0.7);
        e *= 1.0 + 1.6 * T.art * (1.0 - ss(24.0, 80.0, px)) + 0.4 * ss(24.0, 80.0, px) * step(1.5, T.kind);
        emis = (lamp * e * dens + vec3(1.0, 0.50, 0.16) * spill * dens) * tk * uSetOn.z;
      }
    }
    TerrRoad Rd = C.road;
    if (Rd.n > 0.5 && Rd.d < Rd.hw + 12.0 + px) {
      float farR = ss(160.0, 60.0, px);
      float gravelR = step(1.5, Rd.cls);
      float vergeW = Rd.cls < 0.5 ? 4.5 : Rd.cls < 1.5 ? 2.2 : 0.9;
      float verge = terrLine(Rd.d, Rd.hw + vergeW, px) * farR;
      vec3 vergeCol = mix(mix(vec3(0.092, 0.120, 0.048), grassDry * 0.85, 0.3 + 0.4 * n4.r), vec3(0.300, 0.250, 0.185), max(desertAmt, alpine * 0.6));
      col = mix(col, vergeCol * (0.85 + 0.3 * n4.g), verge * 0.85 * (1.0 - snow));
      float cov = terrLine(Rd.d, Rd.hw, px) * farR;
      vec3 tar = mix(vec3(0.050, 0.052, 0.056), vec3(0.112, 0.108, 0.102), ss(0.25, 0.75, n2.r * 0.4 + n3.g * 0.3 + n4.r * 0.3));
      tar = mix(tar, mix(vec3(0.255, 0.232, 0.195), vec3(0.330, 0.275, 0.205), desertAmt) * (0.85 + 0.3 * n4.r), gravelR);
      // bridges: a concrete deck where the road crosses water
      tar = mix(tar, vec3(0.30, 0.295, 0.28), ss(0.2, 0.5, water) * (1.0 - gravelR));
      float lane = Rd.cls < 0.5 ? 3.3 : 0.0;
      // traffic polishes two tracks per lane; oil down the middle of each lane
      float lpos = Rd.cls < 0.5 ? abs(abs(Rd.d) - 1.65 - (Rd.d > 3.3 ? 3.3 : 0.0)) : abs(abs(Rd.d - Rd.hw * 0.5) - 0.0);
      tar *= 1.0 - 0.08 * ss(0.9, 0.3, abs(lpos - 0.85)) * ss(1.5, 0.3, px) * (1.0 - gravelR);
      // gravel lanes: two bare wheel ruts, grass down the middle
      tar = mix(tar, vergeCol, gravelR * ss(0.45, 0.15, Rd.d) * 0.6 * ss(1.5, 0.4, px) * (1.0 - desertAmt));
      float mk = ss(5.0, 1.2, px) * (1.0 - gravelR);
      if (mk > 0.0) {
        vec3 white = vec3(0.56);
        float dash = step(0.5, fract(Rd.s / 12.0));
        float m = terrLine(abs(Rd.d - (Rd.hw - 0.45)), 0.08, px);                                   // edge lines
        if (Rd.cls < 0.5) {
          m = max(m, terrLine(abs(Rd.d - 3.3), 0.07, px) * dash);                                   // lane lines
          tar = mix(tar, vec3(0.50, 0.38, 0.06), max(terrLine(abs(Rd.d - 0.18), 0.06, px), 0.0) * mk * 0.9);   // double centre line
        } else {
          m = max(m, terrLine(Rd.d, 0.06, px) * dash);
        }
        tar = mix(tar, white, m * mk * 0.85);
      }
      col = mix(col, tar, cov);
      rough = mix(rough, mix(0.80, 0.90, gravelR), cov);
      paved = max(paved, cov * (1.0 - 0.6 * gravelR));
      if (cov * gravelR > 0.5) mat = M_GRAVEL;
      wsurf *= 1.0 - cov;
    }
  }
#endif
  // ---- detail layers of the material on top: height, normal, tint at up to four scales ----------------------------
  vec4 mp = TERR_MATP[int(mat)];
#ifdef TERR_SETTLE
  mp.xyz *= 1.0 - 0.78 * paved;
#endif
  vec2 dn = vec2(0.0);
  float hgt = 0.0, tint = 0.0;                         // accumulated height and tint, centred on 0
  // a scale is shown while its features (tile / 8 .. tile / 128) are resolved; beyond that only its mean remains
  float fade3 = ss(9.0, 2.2, pxt), fade4 = ss(1.9, 0.46, pxt), fade5 = ss(0.34, 0.08, pxt), fade6 = ss(0.06, 0.014, pxt);
  float top = 1.0;                                    // weight of the top-down projection
  vec3 dnSide = vec3(0.0);
#if TERR_Q > 0
  // rock and scree seen from kilometres away: crags and ledges from the 410 m scale (side-projected where steep)
  float hard = step(M_GRAVEL - 0.5, mat) * step(mat, M_ROCK + 0.5);
  float fade2 = ss(34.0, 8.0, px3) * hard;
  if (fade2 > 0.0) {
    float sd = steep;
    if (sd > 0.0) {
      vec4 s2; vec3 d2;
      terrSide(TERR_TILE2, uTerrTile[2], rp, n, M_STRATA, dpx, dpy, s2, d2);
      hgt += (s2.b - 0.5) * fade2 * sd; tint += (s2.a - 0.5) * fade2 * sd; dnSide += d2 * 1.6 * fade2 * sd;
    }
    if (sd < 1.0) {
      vec4 t2 = terrMatTex(TERR_TILE2, uTerrTile[2], rp.xz, 0.03 * (n1.rg - 0.5), mat, dxz, dyz);
      hgt += (t2.b - 0.5) * fade2 * (1.0 - sd); tint += (t2.a - 0.5) * fade2 * (1.0 - sd);
      dn += terrUnrot(TERR_TILE2, t2.rg - 0.5) * (fade2 * (1.0 - sd));
    }
  }
  // rock from cruise altitude and above: crags and couloirs at the 2.3 km scale keep the ranges from looking smooth
  float fade1 = ss(8.0, 30.0, px3) * ss(260.0, 110.0, px3) * hard;
  if (fade1 > 0.0) {
    vec4 t1 = terrMatTex(TERR_TILE1, uTerrTile[1], rp.xz, 0.5 * (n0.rg - 0.5), M_ROCK, dxz, dyz);
    hgt += (t1.b - 0.5) * fade1 * 1.2; tint += (t1.a - 0.5) * fade1;
    dn += terrUnrot(TERR_TILE1, t1.rg - 0.5) * (fade1 * 2.0);
  }
#endif
#if TERR_Q > 0
  // steep rock: bedded-rock layer projected from the side at the 110 m and 23 m scales
  float sideAmt = steep * step(M_GRAVEL - 0.5, mat) * step(mat, M_ROCK + 0.5);
  if (sideAmt > 0.0 && fade3 > 0.0) {
    vec4 s3; vec3 d3;
    terrSide(TERR_TILE3, uTerrTile[3], rp, n, M_STRATA, dpx, dpy, s3, d3);
    float a3 = sideAmt * ss(9.0, 2.2, px3);
    hgt += (s3.b - 0.5) * a3; tint += (s3.a - 0.5) * a3; dnSide += d3 * 1.5 * a3;
#if TERR_Q > 1
    if (fade4 > 0.0) {
      vec4 s4; vec3 d4;
      terrSide(TERR_TILE4, uTerrTile[4], rp, n, M_STRATA, dpx, dpy, s4, d4);
      float a4 = sideAmt * ss(1.9, 0.46, px3);
      hgt += (s4.b - 0.5) * a4 * 0.7; tint += (s4.a - 0.5) * a4 * 0.7; dnSide += d4 * 1.3 * a4;
    }
#endif
    top = 1.0 - sideAmt;
  }
#endif
  if (fade3 > 0.0 && mat != M_CANOPY) {
    vec4 t3 = terrMatTex(TERR_TILE3, uTerrTile[3], rp.xz, 0.03 * (n2.rg - 0.5), mat, dxz, dyz);
    hgt += (t3.b - 0.5) * fade3 * top * 0.8; tint += (t3.a - 0.5) * fade3 * top * 0.8;
    dn += terrUnrot(TERR_TILE3, t3.rg - 0.5) * (fade3 * top * 0.9);
  }
  // The finer scales are looked up through a parallax shift by the height of the coarser ones (clods and stones
  // stand in front of what lies behind them), and the two finest resolved scales shadow themselves: one extra tap
  // toward the sun tells whether the relief there rises above the sun ray.
  vec2 parV = Vw.xz / max(Vw.y, 0.30), par = vec2(0.0);
  float microSh = 1.0;
  vec2 sunXZ = uSunDir.xz / max(length(uSunDir.xz), 0.05);
  float sunTan = max(uSunDir.y, 0.0) / max(length(uSunDir.xz), 0.05);
  if (fade4 > 0.0) {
    vec2 wp4 = 0.03 * (n3.rg - 0.5);
    vec4 t4 = terrMatTex(TERR_TILE4, uTerrTile[4], rp.xz, wp4, mat, dxz, dyz);
    float k4 = fade4 * top * (mat == M_CANOPY ? 0.55 : 1.0);
    hgt += (t4.b - 0.5) * k4; tint += (t4.a - 0.5) * k4;
    dn += terrUnrot(TERR_TILE4, t4.rg - 0.5) * k4;
    par = parV * ((t4.b - 0.5) * 0.07 * mp.z * k4);
#if TERR_Q > 0
    if (uSunDir.y > 0.0 && mat != M_CANOPY) {
      float t4s = terrMatTex(TERR_TILE4, uTerrTile[4], rp.xz + sunXZ * 0.11, wp4, mat, dxz, dyz).b;
      microSh *= 1.0 - 0.8 * k4 * ss(0.25, 1.1, (t4s - t4.b) * 0.20 * mp.z / (0.11 * sunTan + 0.004)) * ss(0.9, 0.25, pxt);
    }
#endif
  }
#if TERR_Q > 0
  if (fade5 > 0.0) {
    vec2 wp5 = 0.03 * (n4.rg - 0.5);
    vec4 t5 = terrMatTex(TERR_TILE5, uTerrTile[5], rp.xz + par, wp5, mat, dxz, dyz);
    hgt += (t5.b - 0.5) * fade5 * 0.8; tint += (t5.a - 0.5) * fade5 * 0.8;
    dn += terrUnrot(TERR_TILE5, t5.rg - 0.5) * (fade5 * 0.9);
#if TERR_Q > 1
    if (uSunDir.y > 0.0) {
      float t5s = terrMatTex(TERR_TILE5, uTerrTile[5], rp.xz + par + sunXZ * 0.020, wp5, mat, dxz, dyz).b;
      microSh *= 1.0 - 0.7 * fade5 * ss(0.25, 1.1, (t5s - t5.b) * 0.035 * mp.z / (0.020 * sunTan + 0.001));
    }
#endif
    par += parV * ((t5.b - 0.5) * 0.012 * mp.z * fade5);
  }
#endif
#if TERR_Q > 1
  if (fade6 > 0.0) {
    vec4 t6 = terrMatTex(TERR_TILE6, uTerrTile[6], rp.xz + par, 0.03 * (n5.rg - 0.5), mat, dxz, dyz);
    hgt += (t6.b - 0.5) * fade6 * 0.6; tint += (t6.a - 0.5) * fade6 * 0.6;
    dn += terrUnrot(TERR_TILE6, t6.rg - 0.5) * (fade6 * 0.8);
  }
#endif
  float soft = 1.0 - 0.75 * snow;                     // snow smooths everything
  col *= clamp(1.0 + (mp.x * tint + mp.y * hgt) * soft, 0.35, 1.7);
  rough = clamp(rough + (mp.w - 0.9) * 0.6 - 0.10 * hgt * soft, 0.3, 1.0);
  dn = dn * mp.z * soft + crownG * 2.4 * paint + fieldDn * (1.0 - snow);
  // loose stones on bare, dry or frost-shattered ground (one per cell of the fine cellular noise, in drifts)
  float stoneP = max(max(desertAmt * (1.0 - dune) * (1.0 - playa), alpine), 0.5 * screeAmt) * (1.0 - snow) * (1.0 - paint) * (1.0 - cropPot) * (1.0 - wsurf0) * near5;
  if (stoneP > 0.01) {
    float st = ss(0.34, 0.18, n5.b) * ss(0.50, 0.62, n4.r * 0.6 + n3.g * 0.4) * stoneP;
    col = mix(col, rockCol * (0.75 + 0.6 * n5.r), st * 0.85);
    hgt += 0.5 * st; rough = mix(rough, 0.78, st);
  }

  // ---- water on the land: rain-wet ground, puddles in the hollows of the micro relief, tide line, rivers ---------
  float rainWet = uTerrWet * (1.0 - snow) * (1.0 - paint * 0.7);
  float puddle = rainWet * ss(0.10, -0.12, hgt - 0.25 * (uTerrWet - 0.5)) * ss(0.06, 0.01, slope) * step(mat, M_MUD + 0.5) * step(M_SOIL - 0.5, mat) * near4;
  float soak = max(max(rainWet * 0.8, tide), ss(0.82, 0.98, wet) * ss(0.05, 0.0, slope) * (1.0 - forest) * (1.0 - cropPot) * 0.6);
  col *= 1.0 - 0.36 * soak;
  rough = mix(rough, 0.34, soak * 0.75);
  col = mix(col, col * 0.45, puddle); rough = mix(rough, 0.06, puddle);
  dn *= (1.0 - puddle) * (1.0 - 0.8 * playa * (1.0 - near4)) * (1.0 - 0.6 * tide);
  // snow sparkle: close up, individual crystal facets catch the sun
  if (snow > 0.2 && px < 0.25) {
    vec2 sp = terrHash2(floor(rp.xz * 60.0) + 70000.0);
    float glint = step(0.955, sp.x) * snow * ss(0.25, 0.04, px);
    dn += (terrHash2(floor(rp.xz * 60.0) + 90000.0) - 0.5) * 1.4 * glint;
    rough = mix(rough, 0.18, glint);
  }
  col = mix(col, vec3(0.020, 0.034, 0.030), wsurf);
  rough = mix(rough, 0.07, wsurf);
  dn *= 1.0 - wsurf; dnSide *= 1.0 - wsurf;
  n = mix(n, vec3(0.0, 1.0, 0.0), wsurf);
  n = normalize(n - vec3(dn.x, 0.0, dn.y) - dnSide * mp.z * 0.8);
#ifdef TERR_SETTLE
  n = normalize(mix(n, roofN, roofAmt));
#endif

  // ---- ambient occlusion and self shadow -----------------------------------------------------------------------
  float ao = 1.0 - clamp(conc * 1.6 + concW * 2.2, -0.08, 0.62);
  ao *= mix(1.0, canopyAO, paint) * mix(1.0, 0.5, floorAmt);   // canopy self-occlusion, shade under real trees
  ao *= 1.0 - 0.3 * shrubAmt;
  ao *= clamp(1.0 + 0.5 * hgt * soft, 0.6, 1.15);              // cavities of the micro relief
  S.albedo = col; S.rough = rough; S.n = n; S.ao = ao;
#ifdef VEG_CANOPY
  S.canopyK = mix(vec3(1.0), vegK.directK, paint * (1.0 - snow));
#else
  S.canopyK = vec3(1.0);
#endif
  float nl = dot(ng, uSunDir);
  S.shadow = nl > 0.0 ? mix(1.0, terrShadow(rp, ng, lf, TERR_SHADOW_STEPS), ss(0.0, 0.10, nl)) : 1.0;
  S.emis = vec3(0.0);
  S.specK = 1.0;
  S.shadow *= microSh;
#ifdef TERR_TURF
  // grass is a canopy of blades, not paint: the learned turf reflectance (src/neural/ground-turf.js) gives the
  // directional behaviour (hot spot down-sun, dark and sheeny into the sun, mowing stripes from the lay) and the
  // sky-light response, both relative to the albedo the colours above are written against
  float turfK = clamp(gTurfAmt, 0.0, 1.0), grassK = clamp(gGrassK, 0.0, 1.0) * (1.0 - turfK);
  turfK *= (1.0 - snow) * (1.0 - wsurf); grassK *= (1.0 - snow) * (1.0 - wsurf);
  float bK = turfK + grassK;
  if (bK > 0.002 && uTurfSky.w > 0.5) {
    float tL = (turfK * clamp((gTurfH - 0.045) / 0.085, 0.0, 1.0) + grassK) / bK;
    vec4 TR = turfReflectance(ng, Vw, uSunDir, turfK > grassK ? gTurfDir : vec2(1.0, 0.0), tL);
    vec3 skyK = TR.a * uTurfSky.rgb, sunK = TR.rgb;
    vec3 ref = mix(uTurfRefA, uTurfRefB, tL);
    S.albedo = mix(S.albedo, S.albedo * skyK / ref, bK);
    S.canopyK *= mix(vec3(1.0), sunK / max(skyK, vec3(1.0e-4)), bK);
    S.specK = 1.0 - 0.85 * bK;                         // the cuticle sheen is part of the learned BRF
  }
#endif
#ifdef TERR_MICRO
  // relief this pixel no longer resolves (the 4 m detail scale has faded): the learned micro-relief transfer gives
  // its mean effect on direct light, so the far field keeps the directional behaviour of the near field
  float sig = TERR_SIG[int(mat)] * (1.0 - fade4) * (1.0 - 0.7 * snow) * (1.0 - wsurf) * (1.0 - playa);
#ifdef TERR_TURF
  sig *= 1.0 - clamp(gTurfAmt + gGrassK, 0.0, 1.0);    // the turf reflectance already holds the canopy's self-shadowing
#endif
#ifdef TERR_SETTLE
  sig *= 1.0 - paved;
#endif
  S.canopyK *= terrMicroK(ng, Vw, uSunDir, sig);
#endif
#ifdef TERR_SETTLE
  S.shadow *= (1.0 - 0.92 * bShade);
  S.ao *= 1.0 - 0.25 * bShade;
  S.emis = emis * (0.40 * col + 0.018);
#endif
  return S;
}
`;

// ---- switch between the learned and the classic ground (live bindings: trees.js reads COVER_GLSL when it builds) ----
export let GROUND_MODE = 'neural';
let SETTLE_ON = false;
const coverGLSL = () => NEURAL_COVER_GLSL.replace('//@SETTLE@', SETTLE_ON ? SETTLE_GLSL : '');
export let COVER_GLSL = coverGLSL();
export let SURFACE_GLSL = NEURAL_SURFACE_GLSL;
/** 'neural' (default) or 'classic'. Call before the terrain / tree materials are created. */
export function setGroundMode(mode) {
  GROUND_MODE = mode === 'classic' ? 'classic' : 'neural';
  COVER_GLSL = GROUND_MODE === 'classic' ? CLASSIC_COVER_GLSL : coverGLSL();
  SURFACE_GLSL = GROUND_MODE === 'classic' ? CLASSIC_SURFACE_GLSL : NEURAL_SURFACE_GLSL;
  return GROUND_MODE;
}
/** Roads and settlements painted into the neural ground (settle.js). Call before materials are created, after setGroundMode. */
export function setSettleMode(on) {
  SETTLE_ON = !!on && GROUND_MODE !== 'classic';
  if (GROUND_MODE !== 'classic') COVER_GLSL = coverGLSL();
  return SETTLE_ON;
}
