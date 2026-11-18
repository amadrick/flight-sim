// Procedural land surface: biome / material splatting, detail normals, ambient occlusion and terrain self-shadow.
// Everything is derived from the clipmap (height, normal, curvature, concavity, aridity, special surface), the
// world position (latitude, altitude) and two small tileable noise textures sampled at seven rotated scales.
// Albedos are linear and physically plausible (grass 0.08-0.16, forest 0.03-0.07, soil 0.15-0.2, dry sand 0.35-0.45,
// playa 0.55, fresh snow 0.88). No fog, no tone mapping here (the pipeline does aerial perspective).
export const SURFACE_GLSL = /* glsl */`
uniform mediump sampler2DArray tTerrD;
uniform sampler2D tTerrNoise;
uniform sampler2D tTerrNorm;
uniform vec2 uTerrTile[7];       // uv offsets of the noise scales (floating-origin compensation)
uniform vec4 uTerrAp[5];         // airports: xy = render-space xz, z = flatten radius, w = kind
uniform vec3 uOrigin;
uniform vec3 uSunDir;
uniform float uTerrShadowOn;

struct TerrSurf { vec3 albedo; float rough; vec3 n; float ao; float shadow; };

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

// Terrain self-shadow: march toward the sun through the height pyramid with geometrically growing steps, taking
// each sample from the level whose texels match the step length (coarse levels are band-limited = prefiltered).
float terrShadow(vec3 rp, float lvl0) {
#if TERR_SHADOW_STEPS > 0
  if (uTerrShadowOn < 0.5 || uSunDir.y <= 0.0) return 1.0;
  float tex0 = 1.0 / (uTerrLvl[0].z * float(textureSize(tTerrH, 0).x));     // texel spacing of level 0
  float t = tex0 * exp2(lvl0) * 2.5;
  float grow = pow(40000.0 / t, 1.0 / float(TERR_SHADOW_STEPS));
  grow = clamp(grow, 1.25, 2.2);
  float res = 1.0;
  vec3 o = rp + vec3(0.0, tex0 * exp2(lvl0) * 0.35, 0.0);
  for (int i = 0; i < TERR_SHADOW_STEPS; i++) {
    vec3 p = o + uSunDir * t;
    float lv = clamp(max(ceil(log2(max(terrLodDist(p.xz), 1.0) / uTerrLod.x)), floor(log2(t / (tex0 * 5.0)))), uTerrLod.y, uTerrLod.z);
    vec4 s = terrTexH(p.xz, lv);
    float clear = (p.y - (s.x + s.y)) / t;            // tan of the clearance angle above the terrain
    res = min(res, clear * 22.0 + 0.5);
    if (res <= 0.0) break;
    t *= grow;
  }
  return smoothstep(0.0, 1.0, res);
#else
  return 1.0;
#endif
}

TerrSurf terrSurface(vec3 rp) {
  TerrSurf S;
  vec2 w = rp.xz + uOrigin.xz;                        // world metres
  float h = rp.y;
  float d = terrLodDist(rp.xz);
  float px = max(length(dFdx(rp.xz)), length(dFdy(rp.xz))) + 0.001;   // metres per pixel

  // ---- clipmap data, blended across levels exactly like the geometry -------------------------------------
  float lf = terrLevelAt(d);
  vec4 D = terrTexD(rp.xz, lf), G = terrTexH(rp.xz, lf);
  if (lf < uTerrLod.z) {
    float kb = terrMorph(d / (uTerrLod.x * exp2(lf)));
    if (kb > 0.0) { D = mix(D, terrTexD(rp.xz, lf + 1.0), kb); G = mix(G, terrTexH(rp.xz, lf + 1.0), kb); }
  }
  vec2 e = D.xy * 2.0 - 1.0;
  vec3 n; n.xz = sign(e) * e * e; n.y = sqrt(max(1.0 - dot(n.xz, n.xz), 0.0004));
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

  // ---- airports: keep fields and woods off the pads --------------------------------------------------------
  float pad = 0.0;
  for (int i = 0; i < 5; i++) {
    float da = distance(rp.xz, uTerrAp[i].xy);
    pad = max(pad, 1.0 - ss(uTerrAp[i].z * 0.98, uTerrAp[i].z * 1.18, da));
  }

  // ---- climate lines ---------------------------------------------------------------------------------------
  float treeline = 2150.0 + 2.0 * clamp(latK + 95.0, -200.0, 200.0) + 260.0 * (n1.r - 0.5) + 90.0 * (n2.g - 0.5);
  float snowline = 2720.0 + 2.5 * clamp(latK + 95.0, -200.0, 200.0) + 320.0 * (n1.g - 0.5) + 140.0 * (n2.r - 0.5)
                 + 420.0 * n.z - 2600.0 * curv * step(0.0, curv) - 500.0 * conc;

  // ---- ground: grass / steppe / desert ---------------------------------------------------------------------
  vec3 grass = mix(vec3(0.050, 0.090, 0.026), vec3(0.105, 0.140, 0.048), ss(0.25, 0.75, n1.g * 0.5 + n2.r * 0.5));
  grass = mix(grass, vec3(0.16, 0.17, 0.07), ss(0.55, 0.9, n2.g) * 0.5);
  vec3 dryGrass = mix(vec3(0.25, 0.21, 0.10), vec3(0.19, 0.17, 0.08), n2.r);
  float dryness = clamp(ss(0.08, 0.5, arid) + 0.5 * (macro - 0.5) + ss(1200.0, 2100.0, h) * 0.5, 0.0, 1.0);
  grass = mix(grass, dryGrass, dryness);
  grass *= 0.82 + 0.36 * n4.r;
  vec3 sand = mix(vec3(0.36, 0.27, 0.18), vec3(0.47, 0.385, 0.265), ss(0.3, 0.7, n1.g * 0.45 + n2.r * 0.35 + n4.g * 0.2));
  vec3 redEarth = vec3(0.37, 0.205, 0.125);
  float redness = ss(0.45, 0.7, n0.r * 0.7 + n1.r * 0.3) * 0.75;
  vec3 desert = mix(sand, redEarth, redness);
  desert *= 0.88 + 0.24 * n5.r;
  float desertAmt = ss(0.42, 0.85, arid + 0.25 * (n1.r - 0.5) + 0.1 * (n3.r - 0.5));
  vec3 col = mix(grass, desert, desertAmt);
  float rough = mix(0.92, 0.86, desertAmt);
  // desert scrub: dark dots (creosote / sagebrush), denser along washes
  float shrubDens = desertAmt * (1.0 - playa) * ss(0.30, 0.10, slope) * (0.35 + 0.65 * ss(0.3, 0.7, n2.g) + 6.0 * max(curv, 0.0));
  float shrub = (1.0 - ss(0.10, 0.26, n4.b)) * clamp(shrubDens, 0.0, 1.0);
  col = mix(col, vec3(0.085, 0.095, 0.045), shrub * 0.75);
  // dry washes: pale sand where water runs (concave lines) in arid country
  col = mix(col, vec3(0.52, 0.45, 0.33), desertAmt * ss(0.006, 0.03, curv) * 0.6);

  // ---- alpine tundra above the tree line ----------------------------------------------------------------------
  float alpine = ss(treeline - 150.0, treeline + 200.0, h) * (1.0 - desertAmt * 0.7);
  vec3 tundra = mix(vec3(0.14, 0.135, 0.075), vec3(0.20, 0.185, 0.14), n3.r);
  col = mix(col, tundra, alpine);

  // ---- forest -------------------------------------------------------------------------------------------------
  float forestPot = (1.0 - ss(0.28, 0.62, arid)) * ss(treeline + 60.0, treeline - 260.0, h) * (1.0 - ss(0.30, 0.52, slope))
                  * ss(1.5, 7.0, h) * (1.0 - pad) * (1.0 - water);
  float hills = ss(30.0, 420.0, h) * 0.30 + ss(0.01, 0.10, slope) * 0.30;
  float fnoise = n1.r * 0.50 + n2.g * 0.28 + n0.r * 0.34 + n3.r * 0.10 + hills + max(curv, 0.0) * 4.0;
  float forest = ss(0.60, 0.66, fnoise) * forestPot;
  float conifer = ss(600.0, 1500.0, h + 500.0 * (n1.g - 0.5) - 6.0 * latK);
  vec3 fcol = mix(vec3(0.040, 0.072, 0.024), vec3(0.020, 0.040, 0.019), conifer);
  fcol = mix(fcol, fcol * vec3(1.35, 1.2, 0.9), ss(0.45, 0.8, n2.r) * (1.0 - conifer) * 0.6);
  float crown = 1.0 - n3.b;                           // cell centres = crown tops
  fcol *= 0.45 + 1.0 * crown * crown + 0.25 * n4.r;
  col = mix(col, fcol, forest);
  rough = mix(rough, 0.95, forest);

  // ---- cropland patchwork ---------------------------------------------------------------------------------------
  float cropPot = (1.0 - ss(0.30, 0.50, arid)) * ss(0.014, 0.005, slope) * ss(3.0, 7.0, h) * ss(520.0, 380.0, h)
                * (1.0 - pad) * (1.0 - water) * ss(0.40, 0.47, macro2 * 0.75 + n0.r * 0.25);
  if (cropPot > 0.001) {
    vec2 q = w + (n1.rg - 0.5) * 240.0;               // the survey grid is not perfectly straight
    q = vec2(0.978 * q.x - 0.208 * q.y, 0.208 * q.x + 0.978 * q.y);
    vec2 b = q / 1340.0, bi = floor(b), bf = b - bi;
    vec2 hb = terrHash2(bi + 4096.0);
    vec2 nsub = vec2(2.0 + floor(hb.x * 3.0), 1.0 + floor(hb.y * 3.0));
    if (fract(hb.x * 7.0) > 0.5) nsub = nsub.yx;
    vec2 f = bf * nsub, fi = floor(f), ff = f - fi;
    vec2 hf = terrHash2(bi * 7.0 + fi + 8192.0);
    vec2 cell = 1340.0 / nsub;
    vec2 de = min(ff, 1.0 - ff) * cell;
    float edge = min(de.x, de.y);
    vec2 db = min(bf, 1.0 - bf) * 1340.0;
    float road = min(db.x, db.y);
    float t = hf.x;
    vec3 c = t < 0.26 ? vec3(0.075, 0.150, 0.040)       // green crop
           : t < 0.44 ? vec3(0.300, 0.245, 0.105)       // ripe grain
           : t < 0.58 ? vec3(0.150, 0.105, 0.070)       // ploughed earth
           : t < 0.76 ? vec3(0.095, 0.135, 0.050)       // pasture
           : t < 0.90 ? vec3(0.250, 0.215, 0.125)       // stubble
           :            vec3(0.120, 0.200, 0.045);      // bright young crop
    c *= 0.78 + 0.44 * hf.y;
    c *= 0.86 + 0.28 * n3.r;                            // uneven growth within a field
    // crop rows along the long side of the field (fade out before they can alias)
    float rowc = cell.x > cell.y ? q.y : q.x;
    float rowsF = 0.5 + 0.5 * sin(rowc * 6.2831853 / 4.5);
    c *= 1.0 - 0.22 * rowsF * ss(2.2, 0.7, px) * step(t, 0.9);
    float rowsC = 0.5 + 0.5 * sin(rowc * 6.2831853 / 36.0 + 6.0 * n3.g);
    c *= 1.0 - 0.10 * rowsC * ss(18.0, 6.0, px);
    // hedgerows / field margins and gravel section roads
    float hedge = (1.0 - ss(2.0, 4.5 + px, edge)) * clamp(5.0 / px, 0.0, 1.0);
    c = mix(c, vec3(0.045, 0.070, 0.030) * (0.6 + 0.8 * n4.r), hedge * 0.85);
    float rd = (1.0 - ss(3.0, 4.0 + px, road)) * clamp(7.0 / px, 0.0, 1.0);
    c = mix(c, vec3(0.30, 0.275, 0.235), rd);
    col = mix(col, c, cropPot);
    rough = mix(rough, 0.9, cropPot);
    forest *= 1.0 - cropPot;
  }
  // centre-pivot irrigation in the dry margins
  float pivPot = ss(0.30, 0.45, arid) * ss(0.92, 0.75, arid) * ss(0.010, 0.004, slope) * ss(4.0, 10.0, h) * ss(900.0, 700.0, h)
               * (1.0 - pad) * (1.0 - playa) * (1.0 - water) * ss(0.50, 0.56, n0.g * 0.5 + n1.r * 0.5);
  if (pivPot > 0.001) {
    vec2 b = w / 830.0, bi = floor(b), bf = b - bi - 0.5;
    vec2 hp = terrHash2(bi + 2048.0);
    float r = length(bf) * 830.0;
    float disc = (1.0 - ss(385.0 - px, 390.0 + px, r)) * step(hp.x, 0.8);
    float ang = atan(bf.y, bf.x);
    vec3 c = mix(vec3(0.070, 0.145, 0.040), vec3(0.27, 0.23, 0.11), step(0.62, hp.y));
    c *= 0.85 + 0.2 * step(0.5, fract(ang * 0.159 * 3.0 + hp.x * 4.0)) * step(hp.y, 0.3);
    c *= 0.9 + 0.2 * n3.r;
    col = mix(col, c, disc * pivPot);
  }

  // ---- bare rock, scree -----------------------------------------------------------------------------------------
  float rockN = slope + 0.20 * (n2.a - 0.5) + 0.10 * (n4.a - 0.5) - 0.05 * forest;
  float rockAmt = ss(0.20, 0.36, rockN);
  float strata = sin(h * 0.085 + n1.r * 14.0 + n2.r * 3.0);
  vec3 granite = mix(vec3(0.165, 0.160, 0.155), vec3(0.290, 0.275, 0.255), ss(0.2, 0.8, n2.r * 0.6 + n4.g * 0.4));
  granite *= 0.90 + 0.10 * strata;
  granite = mix(granite, granite * vec3(0.62, 0.60, 0.58), ss(0.55, 0.85, n3.a) * 0.6);   // dark seepage / lichen
  // sandstone: colour bands follow elevation (sedimentary layers)
  float band = h / 38.0 + n1.g * 2.5 + n3.r * 0.35;
  float bi2 = floor(band), bfr = band - bi2;
  vec2 hs = terrHash2(vec2(bi2, 7.0));
  vec3 sandstone = mix(vec3(0.30, 0.135, 0.075), vec3(0.52, 0.33, 0.20), hs.x);
  sandstone = mix(sandstone, vec3(0.60, 0.50, 0.38), step(0.82, hs.y));
  sandstone *= 0.86 + 0.14 * ss(0.0, 0.12, bfr) * ss(1.0, 0.88, bfr) + 0.12 * (n5.r - 0.5);
  vec3 rockCol = mix(granite, sandstone, ss(0.45, 0.75, arid));
  float scree = ss(0.10, 0.20, rockN) * (1.0 - rockAmt) * max(alpine, desertAmt * 0.8);
  col = mix(col, mix(rockCol * 1.12, vec3(0.30, 0.285, 0.265), 0.35) * (0.85 + 0.3 * n5.g), scree * 0.8);
  col = mix(col, rockCol, rockAmt);
  rough = mix(rough, 0.82, max(rockAmt, scree));

  // ---- snow and glacier ice -------------------------------------------------------------------------------------
  float snow = ss(-110.0, 130.0, h - snowline) * (1.0 - ss(0.26, 0.50, slope + 0.08 * (n4.r - 0.5)));
  snow = max(snow, ss(-60.0, 200.0, h - snowline - 500.0) * 0.85);       // the highest summits stay white
  vec3 snowCol = vec3(0.86, 0.88, 0.91) * (0.94 + 0.08 * n4.r);
  float ice = snow * ss(0.004, 0.02, conc) * ss(snowline + 100.0, snowline + 500.0, h + 800.0 * conc) * 0.0;
  snowCol = mix(snowCol, vec3(0.52, 0.66, 0.74), ice);
  col = mix(col, snowCol, snow);
  rough = mix(rough, 0.62, snow);

  // ---- shore: beaches, wet sand, seabed -------------------------------------------------------------------------
  vec3 beachCol = mix(vec3(0.47, 0.41, 0.30), vec3(0.70, 0.66, 0.55), tropic) * (0.92 + 0.16 * n4.r);
  float beach = ss(3.4 + 2.0 * n3.r, 1.0, h) * ss(0.16, 0.05, slope);
  col = mix(col, beachCol, beach);
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
    vec3 pc = mix(vec3(0.50, 0.44, 0.35), vec3(0.64, 0.60, 0.52), ss(0.25, 0.75, n1.r * 0.5 + n2.g * 0.3 + n0.g * 0.3));
    pc *= 0.94 + 0.10 * n4.r;
    // desiccation polygons, visible close up
    float crack = ss(0.80, 0.97, n5.b) * ss(3.0, 0.4, px) * 0.45 + ss(0.84, 0.98, n6.b) * ss(0.5, 0.05, px) * 0.35;
    pc *= 1.0 - crack;
    col = mix(col, pc, playa);
    rough = mix(rough, 0.8, playa);
  }
  // gravel bars beside the channel, then the water itself
  col = mix(col, vec3(0.33, 0.31, 0.28) * (0.85 + 0.3 * n5.r), ss(0.02, 0.4, water) * (1.0 - ss(0.5, 0.8, water)) * 0.8);
  float wsurf = ss(0.5, 0.8, water);
  col = mix(col, vec3(0.020, 0.034, 0.030), wsurf);
  rough = mix(rough, 0.07, wsurf);

  // ---- airport turf ---------------------------------------------------------------------------------------------
  // (mown grass where the climate grows any; elsewhere the pad keeps its natural surface: playa, sand, meadow)

  // ---- detail normals -------------------------------------------------------------------------------------------
  float hard = clamp(max(rockAmt, scree * 0.7) + desertAmt * 0.35, 0.0, 1.0);
  float soft = (1.0 - hard) * (1.0 - snow * 0.7);
  vec2 dn = vec2(0.0);
  dn += terrUnrot(TERR_TILE3, g3.ba) * (forest * 2.6 * ss(60.0, 4.0, px));                    // tree crowns
  dn += terrUnrot(TERR_TILE3, g3.rg) * (hard * 1.3 + soft * 0.12);
  dn += terrUnrot(TERR_TILE4, g4.rg) * (hard * 1.2 + soft * 0.30 + forest * 0.6);
  dn += terrUnrot(TERR_TILE5, g5.rg) * (hard * 0.9 + soft * 0.45);
  dn += terrUnrot(TERR_TILE6, g6.rg) * (hard * 0.6 + soft * 0.40) + terrUnrot(TERR_TILE6, g6.ba) * hard * 0.5;
  dn *= (1.0 - wsurf) * (1.0 - 0.8 * playa) * (1.0 - 0.6 * wet);
  n = mix(n, vec3(0.0, 1.0, 0.0), wsurf);
  n = normalize(n + vec3(dn.x, 0.0, dn.y) * -1.0);

  // ---- ambient occlusion and self shadow -----------------------------------------------------------------------
  float ao = 1.0 - clamp(conc * 1.6 + concW * 2.2, -0.08, 0.62);
  ao *= mix(1.0, 0.55 + 0.45 * crown, forest);          // canopy self-occlusion
  ao *= 1.0 - 0.3 * shrub;
  S.albedo = col; S.rough = rough; S.n = n; S.ao = ao;
  S.shadow = terrShadow(rp, lf);
  return S;
}
`;
