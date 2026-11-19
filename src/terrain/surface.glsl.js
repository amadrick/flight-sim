// Procedural land surface: biome / material splatting, detail normals, ambient occlusion and terrain self-shadow.
// Everything is derived from the clipmap (height, normal, curvature, concavity, aridity, special surface), the
// world position (latitude, altitude) and two small tileable noise textures sampled at seven rotated scales.
// Albedos are linear and physically plausible (grass 0.08-0.16, forest 0.03-0.07, soil 0.15-0.2, dry sand 0.35-0.45,
// playa 0.55, fresh snow 0.88). No fog, no tone mapping here (the pipeline does aerial perspective).
// Part 1 — VS-safe helpers shared by the surface shader and the 3D tree placement (trees.js): no derivatives,
// explicit-LOD lookups only. terrCover() decides where forest / farmland / airfield turf is.
export const COVER_GLSL = /* glsl */`
uniform mediump sampler2DArray tTerrD;
uniform sampler2D tTerrNoise;
uniform vec2 uTerrTile[7];       // uv offsets of the noise scales (floating-origin compensation)
uniform vec4 uTerrRw[8];         // runways: xy = centre (render-space xz), zw = unit direction
uniform float uTerrRwL[8];       // runway half lengths (0 = unused slot)
uniform vec3 uOrigin;
uniform vec3 uSunDir;
uniform float uTerrShadowOn;

vec2 terrHash2(vec2 p) {
  uvec2 q = uvec2(ivec2(p));
  uint h = q.x * 0x8da6b343u + q.y * 0xd8163841u + 0x9e3779b9u;
  h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
  return vec2(float(h & 0xffffu), float(h >> 16)) / 65536.0;
}
vec2 terrUV(vec3 T, vec2 off, vec2 p) { return vec2(T.x * p.x - T.y * p.y, T.y * p.x + T.x * p.y) * T.z + off; }
vec2 terrUnrot(vec3 T, vec2 g) { return vec2(T.x * g.x + T.y * g.y, T.x * g.y - T.y * g.x); }
vec4 terrTexD(vec2 rxz, float lvl) { vec3 l = uTerrLvl[int(lvl)]; return textureLod(tTerrD, vec3(rxz * l.z + l.xy, lvl), 0.0); }
float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec3 terrDecodeN(vec2 enc) {
  vec2 e = enc * 2.0 - 1.0;
  vec3 n; n.xz = sign(e) * e * e; n.y = sqrt(max(1.0 - dot(n.xz, n.xz), 0.0004));
  return n;
}

struct TerrCover { float pad; float treeline; float tropic; float forest; float conifer; float crop; };
// n0..n3 = tTerrNoise at scales 0..3 at this point; n = terrain normal; curv = clipmap curvature; water = river mask
TerrCover terrCover(vec2 rxz, float h, vec3 n, float curv, float arid, float water, vec4 n0, vec4 n1, vec4 n2, vec4 n3) {
  TerrCover C;
  float latK = (rxz.y + uOrigin.z) * 0.001;           // km south of the origin
  float slope = 1.0 - n.y;
  C.tropic = ss(35.0, 70.0, latK);
  float macro2 = n0.g * 0.6 + n1.g * 0.4;
  // airfields: keep fields and woods clear of the runways (the scenery module builds on this ground)
  float rwd = 1.0e6;
  for (int i = 0; i < 8; i++) {
    if (uTerrRwL[i] > 0.0) {
      vec2 q = rxz - uTerrRw[i].xy;
      float al = dot(q, uTerrRw[i].zw);
      vec2 perp = q - uTerrRw[i].zw * clamp(al, -uTerrRwL[i] - 250.0, uTerrRwL[i] + 250.0);
      rwd = min(rwd, length(perp));
    }
  }
  float padR = mix(760.0, 230.0, C.tropic);           // small islands: only the strip itself is kept clear
  C.pad = 1.0 - ss(padR, padR * 1.32, rwd + mix(260.0, 70.0, C.tropic) * (n1.r - 0.5) + mix(120.0, 60.0, C.tropic) * (n2.r - 0.5));
  C.treeline = 2180.0 + 2.0 * clamp(latK + 95.0, -200.0, 200.0) + 260.0 * (n1.r - 0.5) + 90.0 * (n2.g - 0.5);
  float forestPot = (1.0 - ss(0.28, 0.62, arid)) * ss(C.treeline + 60.0, C.treeline - 260.0, h) * (1.0 - ss(0.30, 0.50, slope))
                  * ss(mix(2.5, 1.8, C.tropic), mix(6.0, 3.6, C.tropic), h) * (1.0 - C.pad) * (1.0 - water);
  float wild = ss(0.50, 0.42, macro2 * 0.75 + n0.a * 0.25);          // country that is not farmed: more woodland
  float cover = clamp(0.14 + 0.62 * ss(0.006, 0.07, slope) + 0.14 * ss(80.0, 500.0, h) + 5.0 * max(curv, 0.0)
              + 0.30 * wild * ss(0.40, 0.60, n0.r) + 0.35 * C.tropic, 0.0, 0.93);
  float fnoise = 0.5 + (n1.r - 0.5) * 1.1 + (n2.g - 0.5) * 0.7 + (n0.r - 0.5) * 0.8 + (n3.r - 0.5) * 0.22;
  float fthr = mix(0.86, 0.06, cover);
  float forest = ss(fthr - 0.025, fthr + 0.025, fnoise) * forestPot;
  C.conifer = ss(600.0, 1500.0, h + 500.0 * (n1.g - 0.5) - 6.0 * latK);
  C.crop = (1.0 - ss(0.30, 0.50, arid)) * ss(0.014, 0.005, slope) * ss(9.0, 16.0, h) * ss(520.0, 380.0, h)
         * (1.0 - C.pad) * (1.0 - water) * ss(0.43, 0.49, macro2 * 0.75 + n0.a * 0.25);
  // wooded creeks winding through the farmland (iso-lines of the macro noise)
  float creekV = abs(n0.g + 0.10 * (n1.g - 0.5) + 0.03 * (n2.g - 0.5) - 0.5);
  float creek = (1.0 - ss(0.006, 0.014, creekV)) * forestPot;
  C.forest = max(forest * (1.0 - C.crop), creek * ss(0.3, 0.7, n3.r + 0.4));
  return C;
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

// Part 2 — the fragment-stage surface shader.
export const SURFACE_GLSL = /* glsl */`
uniform sampler2D tTerrNorm;
uniform vec4 uTerrTree;          // 3D trees: x = on, y = full radius, z = end radius

struct TerrSurf { vec3 albedo; float rough; vec3 n; float ao; float shadow; };

// Noise and bump gradient of scale T projected from the side (the two vertical planes of a triplanar mapping).
// Top-down textures smear into streaks down the fall line of cliffs; steep faces use this instead.
void terrSide(vec3 T, vec2 off, vec3 rp, vec3 n, float lod, out vec4 nz, out vec3 dn) {
  vec2 uv = terrUV(T, off, rp.xz);
  float v = rp.y * T.z;
  vec2 a = vec2(T.x, -T.y), b = vec2(T.y, T.x);       // world directions of the two uv axes
  float na = dot(n.xz, a), nb = dot(n.xz, b);
  float wa = na * na, wb = nb * nb, ws = wa + wb + 1.0e-5;
  vec2 uA = vec2(uv.y, v), uB = vec2(uv.x, v);
  nz = (textureLod(tTerrNoise, uA, lod) * wa + textureLod(tTerrNoise, uB, lod) * wb) / ws;
  vec4 gA = textureLod(tTerrNorm, uA, lod) - 0.5, gB = textureLod(tTerrNorm, uB, lod) - 0.5;
  dn = (vec3(b.x * gA.r, gA.g, b.y * gA.r) * wa + vec3(a.x * gB.r, gB.g, a.y * gB.r) * wb) / ws;
}

TerrSurf terrSurface(vec3 rp) {
  TerrSurf S;
  vec2 w = rp.xz + uOrigin.xz;                        // world metres
  float h = rp.y;
  float d = terrLodDist(rp.xz);
  float px = max(length(dFdx(rp.xz)), length(dFdy(rp.xz))) + 0.001;   // metres per pixel (map distance)
  float px3 = max(length(dFdx(rp)), length(dFdy(rp))) + 0.001;        // metres per pixel on the surface

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
  float arid = G.z, spec = G.w;
  float water = clamp(spec, 0.0, 1.0), playa = clamp(-spec, 0.0, 1.0);
  // broader concavity from two levels up (valley-scale ambient occlusion)
  float lc = min(lf + 2.0, uTerrLod.z);
  float concW = (terrTexD(rp.xz, lc).w - 0.5) / 1.5;

  // ---- noise at seven scales ------------------------------------------------------------------------------
  vec4 n0 = texture(tTerrNoise, terrUV(TERR_TILE0, uTerrTile[0], rp.xz));
  vec4 n1 = texture(tTerrNoise, terrUV(TERR_TILE1, uTerrTile[1], rp.xz));
  vec4 n2 = texture(tTerrNoise, terrUV(TERR_TILE2, uTerrTile[2], rp.xz));
  vec4 n3 = texture(tTerrNoise, terrUV(TERR_TILE3, uTerrTile[3], rp.xz));
  vec4 n4 = texture(tTerrNoise, terrUV(TERR_TILE4, uTerrTile[4], rp.xz));
  vec4 n5 = texture(tTerrNoise, terrUV(TERR_TILE5, uTerrTile[5], rp.xz));
  vec4 n6 = texture(tTerrNoise, terrUV(TERR_TILE6, uTerrTile[6], rp.xz));
  vec4 g3 = texture(tTerrNorm, terrUV(TERR_TILE3, uTerrTile[3], rp.xz)) - 0.5;
  vec4 g4 = texture(tTerrNorm, terrUV(TERR_TILE4, uTerrTile[4], rp.xz)) - 0.5;
  vec4 g5 = texture(tTerrNorm, terrUV(TERR_TILE5, uTerrTile[5], rp.xz)) - 0.5;
  vec4 g6 = texture(tTerrNorm, terrUV(TERR_TILE6, uTerrTile[6], rp.xz)) - 0.5;

  float slope = 1.0 - n.y;                            // 0.03 = 14 deg, 0.13 = 30 deg, 0.29 = 45 deg
  float latK = w.y * 0.001;                           // km south of the origin
  float tropic = ss(35.0, 70.0, latK);
  float macro = n0.r * 0.6 + n1.r * 0.4;              // 0..1 large-scale variation
  float macro2 = n0.g * 0.6 + n1.g * 0.4;

  TerrCover C = terrCover(rp.xz, h, n, curv, arid, water, n0, n1, n2, n3);
  float pad = C.pad, treeline = C.treeline, forest = C.forest, conifer = C.conifer, cropPot = C.crop;

  // ---- steep faces: side-projected noise for the 110 m and 23 m scales ---------------------------------------
  float steep = ss(0.22, 0.50, slope);
  vec3 dnSide = vec3(0.0);
  if (steep > 0.0) {
    vec4 s3, s4; vec3 d3, d4;
    float lod3 = log2(max(px3 * TERR_TILE3.z * 256.0, 1.0)), lod4 = log2(max(px3 * TERR_TILE4.z * 256.0, 1.0));
    terrSide(TERR_TILE3, uTerrTile[3], rp, n, lod3, s3, d3);
    terrSide(TERR_TILE4, uTerrTile[4], rp, n, lod4, s4, d4);
    n3 = mix(n3, s3, steep); n4 = mix(n4, s4, steep);
    dnSide = (d3 * 1.3 + d4 * 1.2) * steep;
    g3 *= 1.0 - steep; g4 *= 1.0 - steep;
  }

  // ---- climate lines ---------------------------------------------------------------------------------------
  // summer snow line: lower on north faces and in gullies / cirques where drifts survive
  float snowline = 3080.0 + 2.5 * clamp(latK + 95.0, -200.0, 200.0) + 380.0 * (n1.g - 0.5) + 160.0 * (n2.r - 0.5)
                 + 520.0 * n.z - 1500.0 * clamp(curv, 0.0, 0.25) - 900.0 * clamp(conc, -0.1, 0.4) - 1400.0 * clamp(concW, -0.05, 0.3);

  // ---- ground: grass / steppe / desert ---------------------------------------------------------------------
  vec3 grass = mix(vec3(0.046, 0.082, 0.024), vec3(0.092, 0.128, 0.042), ss(0.25, 0.75, n1.g * 0.5 + n2.r * 0.5));
  grass = mix(grass, vec3(0.150, 0.160, 0.066), ss(0.55, 0.9, n2.g * 0.6 + n4.g * 0.4) * 0.45);
  vec3 dryGrass = mix(vec3(0.235, 0.200, 0.095), vec3(0.175, 0.160, 0.075), n2.r);
  float dryness = clamp(ss(0.08, 0.5, arid) + 0.5 * (macro - 0.5) + ss(1300.0, 2200.0, h) * 0.45, 0.0, 1.0);
  grass = mix(grass, dryGrass, dryness);
  grass *= (0.80 + 0.40 * n4.r) * (0.86 + 0.28 * n5.g) * (0.88 + 0.24 * n6.r);
  // bare soil showing through thin turf close up
  grass = mix(grass, vec3(0.150, 0.115, 0.080), ss(0.62, 0.80, n5.r * 0.6 + n4.a * 0.4) * 0.35 * ss(3.0, 0.3, px));
  vec3 sand = mix(vec3(0.285, 0.210, 0.138), vec3(0.395, 0.318, 0.215), ss(0.3, 0.7, n1.g * 0.45 + n2.r * 0.35 + n4.g * 0.2));
  vec3 redEarth = vec3(0.315, 0.170, 0.100);
  float redness = ss(0.45, 0.7, n0.r * 0.7 + n1.r * 0.3) * 0.75;
  vec3 desert = mix(sand, redEarth, redness);
  desert *= (0.88 + 0.24 * n5.r) * (0.92 + 0.16 * n6.g);
  // desert pavement / darker gravel flats and pale alluvium in a mottled pattern
  desert = mix(desert, desert * vec3(0.74, 0.72, 0.72), ss(0.48, 0.74, n1.g * 0.55 + n0.b * 0.25 + n2.r * 0.2) * 0.55);
  // red-rock country: soils take the colour of the flat-lying beds they weather from (broad elevation bands)
  float mesaAmt = 1.0 - ss(26000.0, 60000.0, distance(w, vec2(190000.0, -88000.0)));
  float sb = h / 105.0 + n1.g * 1.0 + n0.r * 2.0;
  float sbi = floor(sb);
  vec3 st0 = mix(vec3(0.335, 0.175, 0.105), vec3(0.455, 0.365, 0.255), terrHash2(vec2(sbi, 11.0)).x);
  vec3 st1 = mix(vec3(0.335, 0.175, 0.105), vec3(0.455, 0.365, 0.255), terrHash2(vec2(sbi + 1.0, 11.0)).x);
  desert = mix(desert, mix(st0, st1, ss(0.3, 0.7, sb - sbi)) * (0.85 + 0.3 * n4.r) * (0.9 + 0.2 * n2.g), 0.7 * mesaAmt);
  float desertAmt = ss(0.42, 0.85, arid + 0.25 * (n1.r - 0.5) + 0.1 * (n3.r - 0.5));
  vec3 col = mix(grass, desert, desertAmt);
  float rough = mix(0.92, 0.86, desertAmt);
  // desert scrub: dark dots (creosote / sagebrush), denser along washes
  float shrubDens = desertAmt * (1.0 - playa) * ss(0.30, 0.10, slope) * (0.30 + 0.60 * ss(0.3, 0.7, n2.g) + 8.0 * max(curv, 0.0));
  float shrub = (1.0 - ss(0.10, 0.27, n4.b)) * clamp(shrubDens, 0.0, 1.0);
  col = mix(col, vec3(0.080, 0.090, 0.042), shrub * 0.75);
  // dry washes: pale sand where water runs (concave lines) in arid country
  col = mix(col, vec3(0.44, 0.38, 0.28), desertAmt * ss(0.004, 0.025, curv) * 0.6);

  // ---- alpine tundra above the tree line ----------------------------------------------------------------------
  float alpine = ss(treeline - 150.0, treeline + 220.0, h) * (1.0 - desertAmt * 0.7);
  vec3 tundra = mix(vec3(0.120, 0.120, 0.062), vec3(0.185, 0.170, 0.125), n3.r * 0.6 + n4.g * 0.4);
  col = mix(col, tundra, alpine);

  // ---- forest -------------------------------------------------------------------------------------------------
  vec3 fcol = mix(vec3(0.044, 0.078, 0.027), vec3(0.027, 0.049, 0.023), conifer);
  fcol = mix(fcol, fcol * vec3(1.35, 1.2, 0.9), ss(0.45, 0.8, n2.r) * (1.0 - conifer) * 0.6);
  fcol = mix(fcol, vec3(0.030, 0.050, 0.016), tropic * 0.5);
  float crown = 1.0 - n3.b;                           // cell centres = crown tops
  fcol *= (0.38 + 0.95 * crown * crown + 0.22 * n4.r) * mix(1.0, 0.84, conifer);
  // where 3D trees stand (trees.js) the ground shows as shaded forest floor instead of painted crowns
  float t3d = uTerrTree.x * (1.0 - ss(uTerrTree.y, uTerrTree.z, distance(rp.xz, uTerrCam.xz)));
  fcol = mix(fcol, mix(vec3(0.034, 0.046, 0.020), vec3(0.064, 0.056, 0.032), n4.g) * (0.7 + 0.6 * n5.r), t3d * 0.85);

  // ---- cropland patchwork ---------------------------------------------------------------------------------------
  if (cropPot > 0.001) {
    // the survey grid is not perfectly straight: long gentle bends (smooth, so field edges stay locally straight)
    vec2 q = w + vec2(55.0 * sin(w.y * 0.0023 + 1.3) + 90.0 * sin(w.y * 0.00071 + w.x * 0.0004),
                      45.0 * sin(w.x * 0.0019 + 0.4) + 80.0 * sin(w.x * 0.00063 - w.y * 0.0005 + 2.0));
    q = vec2(0.978 * q.x - 0.208 * q.y, 0.208 * q.x + 0.978 * q.y);
    vec2 b = q / 1340.0, bi = floor(b), bf = b - bi;
    vec2 hb = terrHash2(bi + 4096.0);
    vec2 hb2 = terrHash2(bi + 5120.0);
    vec2 nsub = vec2(2.0 + floor(hb.x * 3.0), 1.0 + floor(hb.y * 3.0));
    if (hb2.x > 0.72) nsub = vec2(5.0 + floor(hb.x * 4.0), 1.0 + floor(hb.y * 2.0));   // strip fields
    if (hb2.y > 0.5) nsub = nsub.yx;
    vec2 f = bf * nsub, fi = floor(f), ff = f - fi;
    vec2 hf = terrHash2(bi * 7.0 + fi + 8192.0);
    vec2 cell = 1340.0 / nsub;
    vec2 de = min(ff, 1.0 - ff) * cell;
    float edge = min(de.x, de.y);
    vec2 db = min(bf, 1.0 - bf) * 1340.0;
    float road = min(db.x, db.y);
    float t = pow(hf.x, mix(0.55, 1.8, terrHash2(floor(bi / 3.0) + 9000.0).x));   // regional crop mix (per district)
    vec3 c = t < 0.30 ? vec3(0.062, 0.122, 0.034)       // green crop
           : t < 0.42 ? vec3(0.255, 0.210, 0.098)       // ripe grain
           : t < 0.54 ? vec3(0.135, 0.098, 0.056)       // ploughed earth
           : t < 0.76 ? vec3(0.082, 0.120, 0.044)       // pasture
           : t < 0.88 ? vec3(0.215, 0.190, 0.115)       // stubble / hay
           :            vec3(0.105, 0.172, 0.042);      // bright young crop
    c *= 0.80 + 0.40 * hf.y;
    c *= (0.84 + 0.32 * n3.r) * (0.92 + 0.16 * n2.r); // uneven growth, soil moisture
    // crop rows along the long side of the field (fade out before they can alias)
    float rowc = cell.x > cell.y ? q.y : q.x;
    float rowsF = 0.5 + 0.5 * sin(rowc * 6.2831853 / 4.5);
    c *= 1.0 - 0.22 * rowsF * ss(2.2, 0.7, px) * step(t, 0.88);
    float rowsC = 0.5 + 0.5 * sin(rowc * 6.2831853 / 36.0 + 6.0 * n3.g);
    c *= 1.0 - 0.10 * rowsC * ss(18.0, 6.0, px);
    c *= (0.88 + 0.24 * n5.g) * (0.9 + 0.2 * n6.r);
    // hedgerows / field margins and gravel section roads
    float hedge = (1.0 - ss(1.5 + 3.0 * hb2.x, 4.5 + 3.0 * hb2.x + px, edge)) * clamp(6.0 / px, 0.0, 1.0);
    c = mix(c, vec3(0.040, 0.064, 0.027) * (0.6 + 0.8 * n4.r), hedge * (0.45 + 0.5 * hb2.y));
    float rd = (1.0 - ss(2.0, 3.0 + px, road)) * clamp(6.0 / px, 0.0, 1.0);
    c = mix(c, vec3(0.27, 0.25, 0.215), rd);
    // farmsteads: a yard and a shelter belt near some block corners
    vec2 fpos = (bf - vec2(0.12 + 0.2 * hb.y, 0.10 + 0.2 * hb2.x)) * 1340.0;
    float fd = max(abs(fpos.x), abs(fpos.y)) + 14.0 * (n3.g - 0.5);
    float farm = step(0.45, hb.x) * (1.0 - ss(52.0, 60.0 + px, fd));
    // a gravel yard inside a shelter belt of trees
    c = mix(c, mix(vec3(0.21, 0.19, 0.16) * (0.85 + 0.3 * n4.r), vec3(0.034, 0.058, 0.022) * (0.6 + 0.8 * n4.g), ss(24.0, 30.0, fd + 10.0 * (n4.r - 0.5))), farm);
    col = mix(col, c, cropPot);
    rough = mix(rough, 0.9, cropPot);
  }
  col = mix(col, fcol, forest);
  rough = mix(rough, 0.95, forest);
  // centre-pivot irrigation in the dry margins
  float pivPot = ss(0.30, 0.45, arid) * ss(0.92, 0.75, arid) * ss(0.010, 0.004, slope) * ss(4.0, 10.0, h) * ss(900.0, 700.0, h)
               * (1.0 - pad) * (1.0 - playa) * (1.0 - water) * ss(0.50, 0.56, n0.g * 0.5 + n1.r * 0.5);
  if (pivPot > 0.001) {
    vec2 b = w / 830.0, bi = floor(b), bf = b - bi - 0.5;
    vec2 hp = terrHash2(bi + 2048.0);
    float r = length(bf) * 830.0;
    float disc = (1.0 - ss(385.0 - px, 390.0 + px, r)) * step(hp.x, 0.8);
    float ang = atan(bf.y, bf.x);
    vec3 c = mix(vec3(0.066, 0.135, 0.038), vec3(0.25, 0.215, 0.10), step(0.62, hp.y));
    c *= 0.85 + 0.2 * step(0.5, fract(ang * 0.159 * 3.0 + hp.x * 4.0)) * step(hp.y, 0.3);
    c *= 0.9 + 0.2 * n3.r;
    col = mix(col, c, disc * pivPot);
  }
  // airport turf: mown grass where the climate grows any (elsewhere the pad keeps its natural surface)
  float turf = pad * (1.0 - desertAmt) * (1.0 - ss(1.0, 3.0, 4.0 - h));
  vec3 turfCol = vec3(0.070, 0.112, 0.036) * (0.86 + 0.28 * n3.r) * (0.9 + 0.2 * n5.g) * (0.9 + 0.2 * n6.r);
  turfCol *= 0.94 + 0.12 * step(0.5, fract((w.x + w.y) / 14.0)) * ss(6.0, 1.0, px);      // mowing stripes
  turfCol = mix(turfCol, dryGrass * 0.9, ss(0.5, 0.75, n2.r * 0.6 + n4.g * 0.4) * 0.35);
  col = mix(col, turfCol, turf * 0.85);

  // ---- bare rock, scree -----------------------------------------------------------------------------------------
  float rockN = slope + 0.20 * (n2.a - 0.5) + 0.10 * (n4.a - 0.5) - 0.05 * forest + 0.13 * alpine - 1.5 * clamp(curv, -0.05, 0.05) * alpine;
  float rockAmt = ss(0.20, 0.34, rockN);
  float dh = abs(dFdx(h)) + abs(dFdy(h)) + 0.001;     // metres of height per pixel: strata must fade before they alias
  // bedding: beds of irregular thickness (1D noise along height, bent a little by the macro noise); mip-filtered
  // by the height covered per pixel so the layers fade to their mean instead of aliasing
  float strata = (textureLod(tTerrNoise, vec2(0.37 + 0.04 * n1.r, h / 2800.0 + 0.012 * n2.r), log2(max(dh / 11.0, 1.0)) + 0.8).r - 0.5) * 2.0;
  vec3 granite = mix(vec3(0.150, 0.146, 0.142), vec3(0.275, 0.262, 0.245), ss(0.2, 0.8, n2.r * 0.6 + n4.g * 0.4));
  granite *= 0.90 + 0.22 * strata;
  granite = mix(granite, granite * vec3(0.62, 0.60, 0.58), ss(0.55, 0.85, n3.a) * 0.6);   // dark seepage / lichen
  granite *= 0.9 + 0.2 * n5.a;
  // sandstone: colour bands follow elevation (sedimentary layers)
  float band = h / 38.0 + n1.g * 2.5 + n3.r * 0.35;
  float bi2 = floor(band), bfr = band - bi2;
  vec2 hs = terrHash2(vec2(bi2, 7.0));
  vec3 sandstone = mix(vec3(0.290, 0.130, 0.072), vec3(0.50, 0.315, 0.19), hs.x);
  sandstone = mix(sandstone, vec3(0.58, 0.48, 0.36), step(0.82, hs.y));
  sandstone *= 0.86 + 0.14 * ss(0.0, 0.12, bfr) * ss(1.0, 0.88, bfr) + 0.12 * (n5.r - 0.5);
  sandstone = mix(vec3(0.39, 0.215, 0.125), sandstone, ss(16.0, 5.0, dh));   // layers merge to their mean far away
  vec3 rockCol = mix(granite, sandstone, ss(0.45, 0.75, arid));
  float scree = ss(0.08, 0.20, rockN) * (1.0 - rockAmt) * max(alpine, desertAmt * 0.8);
  col = mix(col, mix(rockCol * 1.12, vec3(0.29, 0.275, 0.255), 0.35) * (0.85 + 0.3 * n5.g), scree * 0.8);
  col = mix(col, rockCol, rockAmt);
  rough = mix(rough, 0.82, max(rockAmt, scree));

  // ---- snow and glacier ice -------------------------------------------------------------------------------------
  float snow = ss(-140.0, 140.0, h - snowline) * (1.0 - ss(0.13, 0.30, slope + 0.10 * (n3.r - 0.5) + 0.06 * (n4.r - 0.5)));
  snow = max(snow, ss(-80.0, 250.0, h - snowline - 650.0) * (1.0 - ss(0.22, 0.42, slope)));   // the highest summits stay white
  vec3 snowCol = vec3(0.86, 0.88, 0.91) * (0.95 + 0.07 * n4.r);
  // old firn / glacier ice shows through in the big hollows
  float ice = snow * ss(0.03, 0.12, concW) * ss(0.10, 0.02, slope);
  snowCol = mix(snowCol, vec3(0.56, 0.68, 0.75) * (0.9 + 0.2 * n3.a), ice * 0.6);
  col = mix(col, snowCol, snow);
  rough = mix(rough, 0.62, snow);

  float wsurf0 = ss(0.3, 0.8, water);
  // ---- shore: beaches, wet sand, seabed -------------------------------------------------------------------------
  vec3 beachCol = mix(vec3(0.43, 0.375, 0.275), vec3(0.62, 0.585, 0.485), tropic) * (0.92 + 0.16 * n4.r);
  // dune grass behind the beach, then the sand itself
  col = mix(col, mix(dryGrass * 1.15, beachCol, 0.35 + 0.3 * n3.r), ss(4.2 + 1.0 * n2.r, 2.6, h) * ss(0.2, 0.06, slope) * (1.0 - wsurf0) * 0.7);
  float beach = ss(2.5 + 1.2 * n3.r, 1.3, h) * ss(0.16, 0.05, slope);
  col = mix(col, beachCol, beach * (1.0 - wsurf0));
  float wet = ss(0.9, 0.1, h) * ss(-1.2, -0.3, h);
  col *= 1.0 - 0.38 * wet; rough = mix(rough, 0.35, wet * 0.8);
  if (h < 0.5) {
    float depth = max(-h, 0.0);
    vec3 bed = mix(beachCol, vec3(0.20, 0.22, 0.17), ss(0.0, 25.0, depth));
    bed = mix(bed, vec3(0.07, 0.09, 0.08), ss(15.0, 90.0, depth));
    // reef rock, coral heads and seagrass in the shallows
    float reefP = ss(0.50, 0.62, n2.b * 0.6 + n3.g * 0.4) * ss(0.4, 1.5, depth) * ss(30.0, 8.0, depth);
    bed = mix(bed, mix(vec3(0.10, 0.11, 0.07), vec3(0.16, 0.13, 0.09), n4.r), reefP * (0.45 + 0.4 * tropic));
    col = mix(col, bed, ss(0.5, -0.3, h));
  }

  // ---- playa (dry lake) and open fresh water -------------------------------------------------------------------
  if (playa > 0.001) {
    // pale silt and clay, a little whiter (salt crust) toward the middle of the pan; broad, faint tonal bands
    vec3 pc = mix(vec3(0.430, 0.380, 0.300), vec3(0.520, 0.485, 0.410), ss(0.30, 0.70, n0.g * 0.75 + n1.r * 0.25));
    // damp, darker clay where the last water stood; wind / sheet-flow streaks
    pc = mix(pc, pc * vec3(0.80, 0.78, 0.76), ss(0.55, 0.70, n0.r * 0.8 + n1.a * 0.2) * 0.6);
    pc *= 0.96 + 0.04 * sin((w.x * 0.8 + w.y * 0.6) * 0.004 + n0.g * 14.0) + 0.05 * (n1.g - 0.5);
    pc *= (0.95 + 0.10 * n4.r) * (1.0 - 0.10 * ss(0.78, 0.95, n3.b));             // giant desiccation polygons
    // desiccation polygons, visible close up
    float crack = ss(0.80, 0.97, n5.b) * ss(3.0, 0.4, px) * 0.45 + ss(0.84, 0.98, n6.b) * ss(0.5, 0.05, px) * 0.35;
    pc *= 1.0 - crack;
    col = mix(col, pc, playa);
    rough = mix(rough, 0.8, playa);
  }
  // gravel bars beside the channel, then the water itself
  col = mix(col, vec3(0.31, 0.295, 0.265) * (0.85 + 0.3 * n5.r), ss(0.02, 0.4, water) * (1.0 - ss(0.5, 0.8, water)) * 0.8 * ss(10.0, 2.5, px));
  float wsurf = ss(0.5, 0.8, water);
  col = mix(col, vec3(0.020, 0.034, 0.030), wsurf);
  rough = mix(rough, 0.07, wsurf);

  // ---- detail normals -------------------------------------------------------------------------------------------
  float hard = clamp(max(rockAmt, scree * 0.7) + desertAmt * 0.35, 0.0, 1.0);
  float soft = (1.0 - hard) * (1.0 - snow * 0.7);
  vec2 dn = vec2(0.0);
  dn += terrUnrot(TERR_TILE3, g3.ba) * (forest * 2.6 * ss(60.0, 4.0, px) * (1.0 - t3d));     // tree crowns
  dn += terrUnrot(TERR_TILE3, g3.rg) * (hard * 1.3 + soft * 0.12);
  dn += terrUnrot(TERR_TILE4, g4.rg) * (hard * 1.2 + soft * 0.30 + forest * 0.6);
  dn += terrUnrot(TERR_TILE5, g5.rg) * (hard * 0.9 + soft * 0.45);
  dn += terrUnrot(TERR_TILE6, g6.rg) * (hard * 0.6 + soft * 0.40) + terrUnrot(TERR_TILE6, g6.ba) * hard * 0.5;
  dn *= (1.0 - wsurf) * (1.0 - 0.8 * playa) * (1.0 - 0.6 * wet);
  n = mix(n, vec3(0.0, 1.0, 0.0), wsurf);
  n = normalize(n - vec3(dn.x, 0.0, dn.y) - dnSide * hard * (1.0 - wsurf));

  // ---- ambient occlusion and self shadow -----------------------------------------------------------------------
  float ao = 1.0 - clamp(conc * 1.6 + concW * 2.2, -0.08, 0.62);
  ao *= mix(1.0, mix(0.55 + 0.45 * crown, 0.5, t3d), forest);   // canopy self-occlusion
  ao *= 1.0 - 0.3 * shrub;
  S.albedo = col; S.rough = rough; S.n = n; S.ao = ao;
  float nl = dot(ng, uSunDir);
  S.shadow = nl > 0.0 ? mix(1.0, terrShadow(rp, ng, lf, TERR_SHADOW_STEPS), ss(0.0, 0.10, nl)) : 1.0;
  return S;
}
`;
