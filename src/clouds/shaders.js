// GLSL for the volumetric clouds: density model, lighting, ray march, temporal reconstruction, shadow map.
// Identifiers are prefixed cl*/uCl*/tCl* (and cloudShadow* for the chunk exported to the pipeline) so they cannot
// collide with the atmosphere module's GLSL, which is pasted into the same shaders.
//
// References (techniques, not code):
//  [Schneider15/17] A. Schneider, "The real-time volumetric cloudscapes of Horizon Zero Dawn" (SIGGRAPH 2015) and
//                   "Nubis: authoring real-time volumetric cloudscapes with the Decima engine" (SIGGRAPH 2017)
//  [Hillaire16]     S. Hillaire, "Physically based sky, atmosphere and cloud rendering in Frostbite" (SIGGRAPH 2016)
//  [Wrenninge13]    M. Wrenninge et al., "Oz: the great and volumetric" (multiple-scattering octaves)
//  [Bouthors08]     A. Bouthors et al., "Interactive multiple anisotropic scattering in clouds"

// ---------------------------------------------------------------------------------------------------------------
// Cloud shadow map lookup — exported to the pipeline as ctx.clouds.shadowGLSL (needs FRAME_UNIFORMS_GLSL).
// The map is a top-down, camera-centred "Beer shadow map": for the sun ray through each texel of a reference plane
// at the cloud base it stores the total optical depth and the first two moments of where along the ray (in altitude)
// that optical depth sits, so points INSIDE the layer get a plausible partial shadow too.
export const CLOUD_SHADOW_GLSL = /* glsl */`
uniform sampler2D tCloudShadowMap;
uniform vec4 uCloudShadowA;   // xy = map centre (air-mass metres), z = 1 / map size, w = reference altitude (cloud base, m)
uniform vec4 uCloudShadowB;   // xy = light slope (L.xz / L.y), z = 1 / layer thickness, w = optical depth assumed beyond the map
uniform vec4 uCloudShadowC;   // xy = world - air-mass offset (accumulated wind, m), z = strength (0 = no clouds), w = unused
// Cubic B-spline filtered fetch of the shadow map from 4 bilinear taps: C2-smooth, so the ~80 m texels of the map no
// longer print square / diamond facets along shadow edges on the ground (plain bilinear is only C0).
vec3 cloudShadowFetchSmooth(vec2 uv) {
  vec2 sz = vec2(textureSize(tCloudShadowMap, 0));
  vec2 p = uv * sz - 0.5, i = floor(p), f = p - i, f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0, w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0, w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 c0 = (i - 0.5 + w1 / g0) / sz, c1 = (i + 1.5 + w3 / g1) / sz;
  return g0.y * (g0.x * textureLod(tCloudShadowMap, vec2(c0.x, c0.y), 0.0).rgb + g1.x * textureLod(tCloudShadowMap, vec2(c1.x, c0.y), 0.0).rgb)
       + g1.y * (g0.x * textureLod(tCloudShadowMap, vec2(c0.x, c1.y), 0.0).rgb + g1.x * textureLod(tCloudShadowMap, vec2(c1.x, c1.y), 0.0).rgb);
}
// Optical depth of cloud between a point (world XZ in metres, altitude y) and the sun. smooth = B-spline filtering
// (4 fetches, for surfaces seen up close: the ground, aircraft); the march uses the single bilinear fetch.
float cloudShadowTauF(vec2 worldXZ, float y, bool smoothF) {
  vec2 q = worldXZ - uCloudShadowC.xy + uCloudShadowB.xy * (uCloudShadowA.w - y);
  vec2 uv = (q - uCloudShadowA.xy) * uCloudShadowA.z + 0.5;
  vec2 e = abs(uv - 0.5) * 2.0;
  float edge = smoothstep(0.8, 0.98, max(e.x, e.y));
  vec3 s = smoothF ? cloudShadowFetchSmooth(uv) : textureLod(tCloudShadowMap, uv, 0.0).rgb;
  float hN = (y - uCloudShadowA.w) * uCloudShadowB.z;
  float k = 1.73 * s.b + 0.015;                                   // uniform distribution with the stored variance
  float f = clamp((s.g + k - hN) / (2.0 * k), 0.0, 1.0);          // fraction of the optical depth that lies above y
  float far = uCloudShadowB.w * (1.0 - smoothstep(0.0, 0.25, hN));
  return mix(s.r * f, far, edge) * uCloudShadowC.z;
}
float cloudShadowTau(vec2 worldXZ, float y) { return cloudShadowTauF(worldXZ, y, false); }
// Direct-sun transmittance through the cloud layer to a render-space point (1 = unshadowed).
float cloudShadow(vec3 renderPos) {
  vec2 d = renderPos.xz - uCameraPos.xz;
  float y = renderPos.y + dot(d, d) * 7.848e-8;                   // undo the fake earth-curvature drop d^2 / 2R
  return exp(-cloudShadowTauF(renderPos.xz + uOrigin.xz, y, true));
}
// Diffuse (multiply scattered) light transmitted by the cloud layer, for scaling sky/ambient light under clouds:
// two-stream estimate T = 1 / (1 + 0.75 (1 - g) tau). Always >= cloudShadow().
float cloudDiffuseTransmittance(vec3 renderPos) {
  vec2 d = renderPos.xz - uCameraPos.xz;
  float y = renderPos.y + dot(d, d) * 7.848e-8;
  return 1.0 / (1.0 + 0.11 * cloudShadowTauF(renderPos.xz + uOrigin.xz, y, true));
}
`;

// ---------------------------------------------------------------------------------------------------------------
// Density model (shared by the ray march, the light march and the shadow-map bake).
export const CLOUD_DENSITY_GLSL = /* glsl */`
uniform highp sampler3D tClBase;      // 128^3: R Perlin-Worley shape, G mid Worley fbm, B high Worley fbm, A Perlin
uniform highp sampler3D tClDetail;    // 32^3:  R Worley erosion fbm, G finer, B finest, A Perlin
uniform sampler2D tClWeather;         // camera-centred weather map (see weather-field.js)
uniform sampler2D tClCurl;
uniform vec4 uClWx;        // xy = map centre (air-mass m), z = 1 / map size (1/m), w = 1 / texel size
uniform vec4 uClLayer;     // x = base altitude, y = top altitude, z = 1 / thickness, w = thickness (m)
uniform vec4 uClShape;     // x = coverage bias, y = coverage amplitude, z = min top fraction, w = stratus (0..1)
uniform vec4 uClShape2;    // x = dev lo, y = dev hi, z = anvil amount, w = base ramp (m)
uniform vec4 uClShape3;    // x = height taper (undeveloped cells), y = height taper (developed cells)
uniform vec4 uClNoise;     // x = base noise scale (1/m), y = detail scale (1/m), z = erosion strength, w = extinction at density 1 (1/m)
uniform vec4 uClNoiseOfs;  // xyz = base-noise scroll (noise units), w = detail scroll
uniform vec4 uClDebug;
uniform vec4 uClRain;      // x = rain extinction (1/m), y = cell threshold lo, z = cell threshold hi, w = reach toward the ground (0..1)
uniform sampler2D tClCells;   // tiling field of individual convective cells (noise.js createCellField)
uniform vec4 uClCell;      // x = 1 / cell-field period (1/m), yz = tower lean (horizontal offset per metre of height), w = stratocumulus sheet amount
uniform vec4 uClCell2;     // x = smallest cell diameter (m), y = log2(largest / smallest), z = aspect (depth / diameter) of undeveloped cells, w = of developed cells
uniform vec4 uClProf;      // cumulus width profile g(h) of shallow cells (LES fit, tools/neural/les_fit.py): x = width at the base, y = height of the widest point, z = rise exponent, w = dome exponent
uniform vec4 uClDet;       // round four: x = detail cascade (0 = single round-three octave), y = detailed light samples near the camera, z = crease occlusion strength, w = surface refinement
uniform vec4 uClDet3;      // x = debug shading (0 = off; 1 = direct sun only, 2 = crease pattern, 3 = depth below the surface, 4 = surface / sun cosine), y = strength of the surface-orientation term, z = 1: light samples fetch the weather map under an anvil, w = share of the horizon band in the sky ambient
uniform vec4 uClDet5;      // x = gradient-normalised erosion of cumulus turrets (0 = round three), y = near-field GT calibration of the lighting networks, z = softness of marginal cells (1 = round three), w = stronger cirrus fibres
uniform vec4 uClDet4;      // x = decks: sky visibility from the column optical depth of the shadow map, y = quilted deck tops, z = pouches under the deck base, w = stepped cumulonimbus towers
uniform vec4 uClDet2;      // x = amplitude ratio between detail octaves, y = frequency ratio, z = sharpest density ramp (shape units), w = wisp warp
uniform vec4 uClProf2;     // the same for developed cells (congestus); uClShape3.z = turret amplitude (x radius)
uniform vec4 uClLife;      // round five: x = life-cycle time (s / nominal cell lifetime), y = life cycle on (0 = frozen round-four phases)
uniform vec4 uClPhys;      // round five: x = adiabatic liquid-water lapse (g m^-3 per m), y = (droplet number / 150 cm^-3)^(1/3),
                           //   z = liquid-water cap of layer clouds (g m^-3), w = 1: extinction from the microphysics (0 = round four)

float clSat(float x) { return clamp(x, 0.0, 1.0); }
// side outputs of clShape for the detail pass (globals: GLSL ES 3 functions may write them)
float clDecay = 0.0;       // 0 = growing / mature cell (crisp edges) .. 1 = decaying fragment (soft, frayed)
float clRadius = 1000.0;   // radius of the cell at this sample (m): erosion scales with the cloud (self-similar turrets)
float clDetailK = 1.0;     // frequency factor of the detail noise for this cell
float clGradK = 1.0;       // estimated |gradient| of the shape excess relative to the nominal 1 / km (see clShape)
float clCav = 0.2;         // side output of clDensityFull: 0 = tip of a lobe .. 1 = bottom of a crease (0.2 = mean / unresolved)
float clMu0 = 2.0;         // side output of clTauLight: cos between the local surface normal and the sun, estimated from the detail field (2 = not available)
float clSurf = 0.0;        // side output of clDensityFull: depth of the sample below the eroded surface (shape units, ~km)

vec4 clWeather(vec2 airXZ, float lod) {
  return textureLod(tClWeather, (airXZ - uClWx.xy) * uClWx.z + 0.5, lod);
}

// Cloud "shape excess" at air-mass position pa (xz metres, y = altitude): > 0 inside the cloud, in units of the base
// noise (≈ 1 per kilometre across a cloud edge), before detail erosion. Density = saturate(excess / edgeWidth).
// info: x = height fraction within this cloud (0 base .. 1 its own top), y = local cloud-top altitude (m),
//       z = base-noise mid Worley (reused for erosion), w = density scale for this altitude.
// [Schneider15]: density = remap(shape * heightGradient, 1 - coverage, 1, 0, 1); the weather map supplies coverage and
// cloud type, here as a continuous "vertical development" instead of three discrete types.
float clShape(vec3 pa, vec4 wx, float lod, out vec4 info) {
  float hN = (pa.y - uClLayer.x) * uClLayer.z;
  info = vec4(0.0, uClLayer.y, 0.5, 1.0);
  if (hN <= 0.0 || hN >= 1.0) return -1.0;
  float cov = clSat(uClShape.x + (wx.r - 0.5) * uClShape.y);
  if (cov < 0.01) return -1.0;
  float dev = smoothstep(uClShape2.x, uClShape2.y, wx.g);
  float topN = mix(uClShape.z, 1.0, dev);          // nominal depth of this cell as a fraction of the layer
  float hRel = hN / topN;
  float devRaw = dev;
  // anvil: around fully developed cells the cloud spreads out under the tropopause, far wider than the tower,
  // thick and solid near the core, thinning into ragged patches outward; the lid undulates and bulges over the
  // core (overshooting top)
  float am = uClShape2.z * smoothstep(uClShape2.x - 0.17, uClShape2.x + 0.03, wx.g);
  float lid = 0.89 + 0.06 * (wx.a - 0.5) + 0.05 * smoothstep(0.8, 1.0, dev);
  float aThick = 0.035 + 0.15 * am * am;
  float anvil = step(0.001, am) * smoothstep(lid - aThick - 0.025, lid - aThick + 0.025, hN);
  float h = pa.y - uClLayer.x;                                   // metres above the condensation level
  // the decks / Cb cores of the 3-D shape noise (below) take over from the cumulus cells where layerW > 0
  float layerW = max(uClShape.w, uClShape2.z);
  // cumulus cell under this point (the tower leans downwind with the shear; a cheap warp breaks the round outlines)
  vec2 pc = pa.xz - uClCell.yz * h + 160.0 * vec2(sin(pa.z * 3.7e-3 + 1.3 * sin(pa.x * 1.9e-3)), sin(pa.x * 3.3e-3 + 1.1 * sin(pa.z * 2.3e-3)));
  vec4 cl = textureLod(tClCells, pc * uClCell.x, lod + 1.0);
  float rad = 0.5 * uClCell2.x * exp2(cl.g * uClCell2.y);
  // Round five, life cycle: every cell is born small, its tower rises (~1-5 m/s), it matures, then dissolves (the
  // radius shrinks, the edges fray, the liquid water evaporates) and a new cloud is born in its place. Lifetime ~20 min
  // (bigger cells live longer), each cell with its own phase and rate; at the wrap the cloud has no water left, so
  // nothing pops.
  float age = fract(cl.a + uClLife.x * mix(0.75, 1.3, fract(cl.b * 7.31)) * inversesqrt(clamp(rad / 600.0, 0.3, 4.0)));
  float lgH = mix(1.0, mix(0.25, 1.0, smoothstep(0.0, 0.35, age)), uClLife.y);
  float lgR = mix(1.0, mix(0.6, 1.0, smoothstep(0.0, 0.25, age)) * mix(1.0, 0.45, smoothstep(0.66, 1.0, age)), uClLife.y);
  float lgW = mix(1.0, smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.7, 0.98, age)), uClLife.y);
  // Self-similar turrets: inside a cumulus cell the shape noise is sampled at a frequency that follows the cell size
  // (a 300 m humilis gets 100-300 m bulges, a 4 km congestus 1-2 km towers with sub-turrets), same single fetch.
  float kS = layerW > 0.0 ? 1.0 : mix(clamp(2400.0 / rad, 0.8, 8.0), 1.0, uClCell.w);
  clDetailK = clamp(sqrt(kS), 0.9, 2.2);
  vec3 q = pa * (uClNoise.x * kS) * vec3(1.0, uClDebug.w, 1.0) + uClNoiseOfs.xyz;
  float lodS = clamp(lod + log2(kS), 0.0, 5.0);
  // smoothstep the texel fraction: hardware trilinear filtering is only C0 and its creases at voxel boundaries
  // show up as terraces / contour lines on smooth cloud surfaces (worst along the stretched vertical axis)
  float vs = 128.0 * exp2(-floor(lodS));
  vec3 qt = q * vs - 0.5, qi = floor(qt), qf = qt - qi;
  q = (qi + mix(qf * qf * (3.0 - 2.0 * qf), qf, clSat(lodS - 1.5)) + 0.5) / vs;   // (coarse mips are smooth already)
  vec4 n = textureLod(tClBase, q, lodS);
  // billows: the volume's own mid / high Worley fbm bulges the low-frequency shape (they fade to their mean with
  // the mip LOD, so distant clouds keep their size while losing detail)
  float s = n.r * (1.0 + (n.g - 0.48) * uClDebug.x + (n.b - 0.48) * uClDebug.y);
  lid += 0.05 * (n.a - 0.5);
  // Cumulonimbus (round four): in convective weather the depth does not follow the development smoothly (that gave
  // broad noise mountains) but in two steps with narrow, noise-broken transitions: a shoulder of congestus at half
  // height around the storm (flanking towers) and the main tower with near-vertical cauliflower walls to the lid.
  if (uClShape2.z * uClDet4.w > 0.0) {
    float dn_ = devRaw + 0.3 * (n.r - 0.5) + 0.12 * (n.g - 0.5);
    float tN = uClShape.z + (0.5 - uClShape.z) * smoothstep(0.15, 0.4, dn_) + 0.5 * smoothstep(0.5, 0.7, dn_);
    topN = mix(topN, tN, uClShape2.z); hRel = hN / topN;
  }
  // Vertical profile. Flat base: the shape fades in over a few tens of metres above the condensation level.
  // Top: a height penalty is SUBTRACTED from the shape, so every cell's height follows the strength of its
  // noise peak (big cells are tall, small ones stay humilis) and the outline is a dome: r(h) ~ peak - k h^2.
  // Nothing is cut at a height-field: tops and flanks are always noise surfaces (cauliflower, not mountains).
  float bottom = clSat(hN * uClLayer.w / uClShape2.w);
  float wb = n.g * 0.6 + n.b * 0.4;

  // ---- (1) cumulus: one cloud per cell of the cell field ------------------------------------------------------
  // Each cell is a cloud with a flat base at the common condensation level, a width profile fitted to the LES
  // (tools/neural/les_*.py: widest a little above the base, dome-shaped top), a depth that follows its size
  // (aspect ratio, larger for developed cells: humilis .. congestus) and turrets from the base volume's Worley fbm
  // whose amplitude scales with the cell (billows on billows). Towers lean downwind with the shear.
  // coverage switches cells on by their random id (and grows them past their nominal rim when it is high)
  float sel = cov * 1.45 * (1.0 + 0.25 * uClLife.y);       // (with the life cycle some cells are always young or dying)
  float vig = clSat((sel - cl.b) * 8.0);
  float grow = mix(0.55, 1.0, vig) + 1.4 * max(cov - 0.62, 0.0);
  float H = min(2.0 * rad * mix(uClCell2.z, uClCell2.w, dev) * mix(0.75, 1.25, cl.a) * (0.6 + 0.4 * vig), 0.8 * lid * uClLayer.w);   // (room under the lid for the turrets)
  // stratocumulus weather (round four): the cells are low humps embedded in the sheet, only developed ones tower
  H *= mix(1.0, 0.4, uClCell.w * (1.0 - dev) * uClDet4.y) * lgH;
  float hc = h / max(H, 1.0);
  vec4 pf = mix(uClProf, uClProf2, dev);
  float g = (pf.x + (1.0 - pf.x) * (1.0 - pow(1.0 - min(hc / pf.y, 1.0), pf.z)))
          * pow(clSat(1.0 - pow(clSat((hc - pf.y) / (1.0 - pf.y)), 2.0)), pf.w);
  // turrets: Worley fbm (round bulges, cauliflower) plus the Perlin-Worley lobes of the shape noise (towers / shoulders)
  // (inverted Worley is a cone around each feature point; sqrt(2w - w^2) turns the cones into spherical caps, so the
  //  turrets are round bubbles separated by sharp creases instead of soft pyramids)
  float bil = (sqrt(clSat(2.0 * wb - wb * wb)) - 0.8) * uClShape3.z + (n.r - 0.5) * uClShape3.w;
  float turK = rad * lgR * grow * mix(0.35, 1.0, clSat(hc * 1.6));
  float rS = rad * lgR * grow * g + turK * bil;
  // Round four: how steep is this field? The turret term multiplies a Worley bubble by the cell radius, so on the wall
  // of a turret the excess rises 3-8 times faster than the nominal 1 unit / km. The detail erosion, which subtracts
  // from the excess, moved such a wall by a tenth of what it moves a plain flank: big cumulus were smooth balloons
  // up close. Estimate of |gradient| (m / m): the turret amplitude x d(cap)/dw x the Worley slope (~1.2 / cell,
  // cells of period / 8), plus ~1.2 for the radial and profile terms; the detail stage divides the excess by it.
  float wbc = clSat(wb), capD = min((1.0 - wbc) / sqrt(max(2.0 * wbc - wbc * wbc, 1e-3)), 2.5);
  float gT = turK * uClShape3.z * capD * (1.2 * 8.0 * uClNoise.x * kS);
  float gradC = min(sqrt(1.44 + gT * gT), 8.0) / 1.2;
  float d = rad * (1.0 - (2.0 * cl.r - 1.0));                    // distance from the cell centre (m)
  float exC = (rS - d) * 1e-3 - step(cl.r, 0.002) - (1.0 - bottom) * 0.4 - max(hc - 1.0, 0.0) * H * 3e-3;   // turrets may overshoot the dome a little, never reach the lid
  exC = vig > 0.0 ? mix(exC, -1.0, layerW) : -1.0;
  // (close to the camera the life-cycle phase is read from a coarser mip of the cell field: where two cells have merged
  //  a crisp growing cell and a soft decaying one would otherwise meet in a visible vertical seam)
  float phase = cl.a;
  if (uClDet.x > 0.5 && lod < 1.5) phase = mix(textureLod(tClCells, pc * uClCell.x, lod + 3.5).a, phase, clSat(lod * 2.0 - 2.0));
  float decay = max(mix(smoothstep(0.65, 0.92, phase), 0.45 * smoothstep(0.62, 0.9, age), uClLife.y), 0.6 * uClDet5.z * (1.0 - vig)) * (1.0 - uClShape.w);
  vec4 infoC = vec4(clSat(hc), uClLayer.x + H, n.g, 1.0);

  // ---- (2) layer clouds from the 3-D shape noise: stratus / nimbostratus deck, stratocumulus sheet, Cb core -----
  float prof = mix(hRel * hRel, smoothstep(0.65, 1.0, hRel) + 4.0 * max(hRel - 1.0, 0.0), uClShape.w);   // dome / flat deck
  prof *= mix(uClShape3.x, uClShape3.y, dev);
  // stratus decks keep a minimum threshold so the long base ramp turns the noise into an undulating, ragged base
  // round four: closed-cell quilting of a deck's top (the Worley cells of the volume raise the top at their centres and
  // sink it along their edges) and pouches hanging under its base (mammatus-like undulation of thick decks)
  float capW = sqrt(clSat(2.0 * wb - wb * wb));
  float bottomL = clSat((h + uClDet4.z * uClShape.w * 260.0 * (capW - 0.72)) / uClShape2.w);
  float exL = s * mix(bottom, bottomL, uClShape.w) - max(1.0 - cov, 0.22 * uClShape.w) - prof
            + uClDet4.y * uClShape.w * 0.3 * (capW - 0.78) * smoothstep(0.5, 0.95, hRel);
  vec4 infoL = vec4(clSat(hRel), uClLayer.x + min(topN * 1.15, 1.0) * uClLayer.w, n.g, 1.0);
  // stratocumulus: a sheet ~600 m deep at the base, cells and gaps from the same noise, flat top under the inversion
  float scTop = min(620.0 * uClLayer.z, 1.0), hs = hN / scTop;
  float exS = s * bottom - max(1.05 - cov, 0.12) - (smoothstep(0.55, 1.0, hs) * 0.6 + 4.0 * max(hs - 1.0, 0.0)) * 0.5
            + uClDet4.y * 0.3 * (capW - 0.78);       // closed cells: thick centres, thin edges that open into gaps
  // the cumulonimbus core of developed cells in convective weather (columnar by nature) and the decks
  float ex = exC; info = infoC; bool isCell = true;
  if (uClCell.w > 0.0 && exS * uClCell.w > ex) { ex = mix(-0.4, exS, uClCell.w); info = vec4(clSat(hs), uClLayer.x + scTop * uClLayer.w, n.g, 1.0); decay = 0.0; isCell = false; }
  if (layerW > 0.0) {
    float exLw = mix(-0.4, exL, layerW);
    if (exLw > ex || uClShape.w > 0.5) { ex = mix(ex, exL, uClShape.w > 0.5 ? uClShape.w : 1.0); info = infoL; decay = 0.0; isCell = false; }
  }
  // water content grows with height above the base (adiabatic), decaying fragments and glaciated anvils are thinner
  info.w = mix(0.45, 1.0, clSat(info.x * 2.5 + 0.1)) * mix(1.0, mix(0.05, 0.45, am * am), anvil) * mix(0.75, 1.15, wx.a)
         * mix(1.0, 0.6, decay);
  if (uClPhys.w > 0.5) {
    // Round five: extinction in real units from the microphysics. Liquid water rises adiabatically with the height above
    // the condensation level (~2 g m^-3 per km), diluted by entrainment: the adiabatic fraction falls from ~0.8 near the
    // base to ~0.3 at the top (more in dissolving clouds); layer clouds are capped. A droplet population of N per cm^3
    // with Q_ext = 2 and r_e from LWC and N has sigma = 0.119 (N / 150)^(1/3) LWC^(2/3) 1/m (LWC in g m^-3).
    // The anvil is ice (r_e ~ 40 um): sigma = 1.5 IWC / (rho_ice r_e) = 0.041 IWC, IWC ~0.3 g m^-3 near the core, 0.04 at the rim.
    float fad = mix(0.8, 0.3, info.x) * mix(1.0, 0.45, decay);
    float lwc = min(uClPhys.x * max(h, 0.0) * fad, isCell ? 3.0 : mix(uClPhys.z, 2.5, uClShape2.z * dev)) * mix(0.8, 1.2, wx.a) * (isCell ? lgW : mix(0.5, 1.5, clSat(s)));   // (decks: thick and thin patches -> textured base)
    float sigW = 0.119 * uClPhys.y * pow(max(lwc, 1e-4), 0.6667);
    float sigI = 0.041 * mix(0.04, 0.3, am * am) * mix(0.8, 1.2, wx.a);
    info.w = mix(sigW, sigI, anvil) / uClNoise.w;
  }
  clGradK = isCell ? mix(1.0, gradC, uClDet.x * uClDet5.x) : 1.0;
  clDecay = decay; clRadius = isCell ? rad * lgR * grow : 1000.0;      // (layer clouds: no cell, nominal size)
  // inside the anvil slab the threshold only depends on the distance from the core; the ice cloud thins out
  // toward the rim through its density (info.w), not through a soft threshold (which would reveal texel facets)
  ex = mix(ex, s - (1.0 - 0.95 * am), anvil);
  if (anvil > 0.5) { info.x = clSat(hRel); info.y = uClLayer.y; clDecay = 0.0; clRadius = 1000.0; clGradK = 1.0; }
  return ex - 3.0 * clSat((hN - lid) * 14.0);                    // lid at the tropopause / inversion
}
// Cheap density (no detail), used by the light march and the shadow map.
float clDensityBase(vec3 pa, vec4 wx, float lod, out vec4 info) {
  return clSat(clShape(pa, wx, lod, info) / 0.06);
}

// Full density: displace the cloud surface with high-frequency Worley fbm, distorted by curl noise near the base
// ([Schneider15] sec. "detail"): wispy at the bottom, billowy on top. edge = width of the density ramp in
// shape units (tied to the march step: crisp close to the camera, softer far away).
//
// Round four: the detail is a CASCADE of the same 32^3 volume at three scales (lobes of ~450-110 m, ~56-14 m and
// ~9-2 m at the default periods), each with an amplitude proportional to its wavelength (cauliflower: lobes on
// lobes). fp = footprint of the sample (m): every octave is fetched at the mip that matches it and is skipped
// once it is below the footprint, so nothing aliases and distant clouds cost one fetch as before. The finer
// octaves are warped by the coarser one (ragged, stringy fringes where the cloud evaporates).
// Side output clCav: where in the lobe / crease pattern the sample sits (for the lighting).
#define CL_EROSION_BIAS 0.3
#define CL_EROSION_MAXK 1.25        // largest size / decay factor of the erosion (keeps the march's hit test conservative)
#define CL_EROSION_LO (CL_EROSION_BIAS + 0.225 * uClDet2.x * (1.0 + uClDet2.x))   // most negative erosion value with the cascade, in units of uClNoise.z * size factor
float clCap(float w) { return sqrt(clSat(2.0 * w - w * w)); }     // inverted Worley cone -> spherical cap (round lobes, sharp creases)
float clDensityFull(vec3 pa, float excess, vec4 info, float fp, float edge) {
  excess /= clGradK;                                         // ~ signed distance to the un-eroded surface (km)
  float kD = uClNoise.y * clDetailK;
  vec3 q = pa * kD;
  vec2 curl = textureLod(tClCurl, pa.xz * 1.9e-4, 0.0).xy * 2.0 - 1.0;
  q.xz += curl * ((1.0 - info.x) * 0.07 + clDecay * 0.12);
  q.y -= uClNoiseOfs.w; q.x += uClNoiseOfs.w * 0.4;
  float l1 = log2(max(fp, 1e-3) * kD * 32.0);                 // footprint in voxels of the first octave
  vec4 dn = textureLod(tClDetail, q, clamp(l1, 0.0, 4.0));
  // all three channels of the detail volume from the one fetch (R: 3-6-12 cell Worley fbm, G: 6-12, B: 12)
  float hf = dn.r * 0.62 + dn.g * 0.23 + dn.b * 0.15;
  // growing / mature cells: billowy (inverted Worley = round bulges) above the base; decaying fragments: wispy
  float bil = clSat(info.x * 5.0) * (1.0 - clDecay);
  float m = mix(hf, 1.0 - clCap(hf), bil);
  float cav = m, cavW = 1.0;
  if (uClDet.x > 0.5) {
    float F = uClDet2.y, a = uClDet2.x, lF = log2(F);
    float l2 = l1 - lF;
    if (l2 < 3.5) {
      // second octave: rotated (hides the lattice of the first) and warped by the first (turbulent fringes)
      vec3 q2 = vec3(0.80 * q.x - 0.60 * q.z, q.y, 0.60 * q.x + 0.80 * q.z) * F + (dn.gba - 0.5) * (uClDet2.w * mix(1.0, 0.35, bil)) + 0.37;
      vec4 d2 = textureLod(tClDetail, q2, clamp(l2, 0.0, 4.0));
      float h2 = d2.r * 0.62 + d2.g * 0.23 + d2.b * 0.15;
      float e2 = mix(h2, 1.0 - clCap(h2), bil), w2 = clSat(3.5 - l2);
      m += a * w2 * (e2 - 0.3); cav += 0.6 * w2 * e2; cavW += 0.6 * w2;
      float l3 = l2 - lF;
      if (l3 < 3.5) {
        vec3 q3 = vec3(0.80 * q2.x + 0.60 * q2.y, -0.60 * q2.x + 0.80 * q2.y, q2.z) * F + (d2.gba - 0.5) * (0.6 * uClDet2.w) + 0.71;
        vec4 d3 = textureLod(tClDetail, q3, clamp(l3, 0.0, 4.0));
        float h3 = d3.r * 0.62 + d3.g * 0.23 + d3.b * 0.15;
        float e3 = mix(h3, 1.0 - clCap(h3), bil), w3 = clSat(3.5 - l3);
        m += a * a * w3 * (e3 - 0.3); cav += 0.35 * w3 * e3; cavW += 0.35 * w3;
      }
    }
  } else if (fp < 20.0) {                    // round three: one extra octave close to the camera
    float fine = textureLod(tClDetail, q * 3.7 + 0.37, 0.0).g;
    hf = mix(hf, hf * 0.7 + fine * 0.3, clSat(1.0 - fp / 20.0));
    m = mix(hf, 1.0 - clCap(hf), bil);
  }
  clCav = mix(0.2, cav / cavW, bil);
  // keep the condensation level flat: little erosion in the lowest ~8 % of the cell (cumulus bases are flat and
  // sharp; the wisps belong to the flanks). The erosion depth follows the size of the cloud (a 300 m humilis keeps
  // its shape, a 3 km congestus gets proportionally large sub-turrets) and grows on decaying fragments.
  float sizeK = clamp(clRadius / 700.0, 0.6, 1.0) * mix(1.0, 1.25, clDecay);
  m = (mix(m, 1.0 - info.z, 0.25) - CL_EROSION_BIAS) * uClNoise.z * sizeK * mix(0.35, 1.0, clSat(info.x * 12.0));
  clSurf = excess - m;
  // hard sunlit edges on growing towers, soft frayed edges on decaying fragments
  float dens = clSat((excess - m) / (edge * mix(1.0, uClPhys.w > 0.5 ? 2.0 : 3.5, clDecay)));
  // round five, entrainment: dry air mixed in through the surface dilutes the outer ~20 m of a growing turret a little
  // and the outer ~150 m of a dissolving cloud a lot (ragged, translucent edges vs crisp sunlit turrets)
  if (uClPhys.w > 0.5) dens *= mix(mix(0.6, 0.3, clDecay), 1.0, clSat((excess - m) / mix(0.02, 0.08, clDecay)));
  return dens;
}

// Rain / virga below the cloud base (air-mass position pa with pa.y < base). Returns relative density 0..1.
float clRain(vec3 pa, vec4 wx) {
  float cell = smoothstep(uClRain.y, uClRain.z, wx.b);
  if (cell <= 0.0) return 0.0;
  float below = uClLayer.x - pa.y;
  // streaky curtains: noise stretched ~12x vertically
  float streak = textureLod(tClBase, vec3(pa.x, pa.y * 0.08, pa.z) * 2.6e-4 + uClNoiseOfs.xyz, 1.0).a;
  float curtain = smoothstep(0.3, 0.62, streak + cell * 0.3);
  // virga evaporates before reaching the ground; heavy rain reaches it
  float reach = uClLayer.x * mix(0.35, 1.3, uClRain.w * cell);
  float fall = clSat(1.0 - below / max(reach, 1.0));
  return cell * curtain * sqrt(fall) * clSat(below / 60.0 + 0.3);
}
`;

// ---------------------------------------------------------------------------------------------------------------
// Default sun-scattering model. The signature is a contract (a neural model can replace this function, see
// setScatterModel in index.js):
//   J = radiance scattered toward the viewer per unit sun irradiance at the cloud top (sr^-1), single + multiple.
//   tauSun   optical depth from the sample toward the sun through cloud (>= 0)
//   tauUp    optical depth from the sample straight up to the cloud top (>= 0)
//   cosTheta cos(angle between the light's travel direction and the direction toward the viewer); 1 = forward scattering
export const DEFAULT_SCATTER_GLSL = /* glsl */`
float clHG(float c, float g) { float g2 = g * g; return (1.0 - g2) * 0.0795775 / pow(1.0 + g2 - 2.0 * g * c, 1.5); }
// Round five: phase function of a cloud-droplet population, the HG + Draine blend fitted to Lorenz-Mie theory by
// Jendersie & d'Eon ("An approximate Mie scattering function for fog and cloud rendering", SIGGRAPH 2023 talk), for
// an effective droplet diameter d in um (5..50; cumulus ~15-25). The fit's sharp diffraction peak (g ~0.99) is the
// silver lining around a cloud edge in front of the sun; the Draine lobe carries the broad forward and the backward
// (glory / fogbow side) part. Normalised over the sphere (sr^-1).
float clDraine(float c, float g, float a) {
  float g2 = g * g;
  return ((1.0 - g2) * (1.0 + a * c * c)) / (12.566371 * (1.0 + a * (1.0 + 2.0 * g2) / 3.0) * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}
float clMiePhase(float c, float d) {
  float gHG = exp(-0.0990567 / (d - 1.67154));
  float gD = exp(-2.20679 / (d + 3.91029) - 0.428934);
  float aD = exp(3.62489 - 8.29288 / (d + 5.52825));
  float wD = exp(-0.599085 / (d - 0.641583) - 0.665888);
  return (1.0 - wD) * clDraine(c, gHG, 0.0) + wD * clDraine(c, gD, aD);
}
// parameters computed on the CPU (index.js mieParams) for the droplet size of the weather: x = gHG, y = gD, z = alpha, w = wD
uniform vec4 uClMie;
float clMiePhaseP(float c, vec4 p) { return mix(clDraine(c, p.x, 0.0), clDraine(c, p.y, p.z), p.w); }
float cloudSunScatter(float tauSun, float tauUp, float cosTheta) {
  // (1) Single scattering: dual-lobe Henyey-Greenstein — a tight forward lobe (silver lining) plus a weak
  //     backward lobe (glory side brightening) [Hillaire16]. Round five: the Mie fit above (uClPhys.w = 0: round four).
  float single = (uClPhys.w > 0.5 ? clMiePhaseP(cosTheta, uClMie) : mix(clHG(cosTheta, 0.82), clHG(cosTheta, -0.30), 0.2)) * exp(-tauSun);
  // (2) Low-order multiple scattering as octaves of attenuated extinction / contribution / anisotropy
  //     [Wrenninge13, Hillaire16]: light that has scattered a few times penetrates deeper and forgets direction.
  float ms = 0.0, a = 1.0, b = 1.0, c = 1.0;
  for (int i = 0; i < 3; i++) {
    a *= 0.42; b *= 0.55; c *= 0.55;
    ms += b * mix(clHG(cosTheta, 0.82 * c), clHG(cosTheta, -0.30 * c), 0.2) * exp(-a * tauSun);
  }
  // (3) Diffusion regime: deep inside an optically thick, conservative cloud the mean radiance follows the
  //     two-stream solution ~ (0.8 / pi) / (1 + 0.75 (1 - g) tau) — this is what keeps bases grey, not black.
  //     Weighted by a "powder" term [Schneider15]: thin wisps and the outermost skin have had no path length to
  //     build up multiply-scattered light, which gives the dark creases / bright bulges of cumulus.
  float depth = tauSun + 0.35 * tauUp;
  // (round five: angle dependent, research doc 2.4: the boundary depletion shows away from the sun; looking toward it
  //  the thin edge is the brightest part)
  float powder = 1.0 - 0.55 * exp(-0.8 * depth) * (uClPhys.w > 0.5 ? 1.0 - smoothstep(0.3, 0.9, cosTheta) : 1.0);
  float fwd = mix(1.0, 12.566 * clHG(cosTheta, 0.35), 0.55 * exp(-0.12 * tauSun));
  float diffuse = 0.2546 * (0.5 / (1.0 + 0.1125 * tauSun) + 0.5 * exp(-0.3 * tauSun)) * powder * fwd;
  return single + 0.5 * ms * powder + diffuse;
}
`;

// ---------------------------------------------------------------------------------------------------------------
// The ray march. Renders at 1/N resolution into two attachments:
//   0: rgb = in-scattered radiance (premultiplied, including aerial perspective), a = transmittance
//   1: r = mean cloud distance (km, for reprojection), g = scene distance used (km), b = lightning glow, a = unused
export function marchFragment({ frameGLSL, depthGLSL, atmosphereGLSL, scatterGLSL, steps, lightSteps, N, msGLSL = '' }) {
  return /* glsl */`
precision highp float; precision highp int; precision highp sampler3D;
#define CL_STEPS ${steps | 0}
#define CL_LIGHT_STEPS ${lightSteps | 0}
#define CL_N ${N | 0}
in vec2 vUv;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oAux;
${frameGLSL}
${depthGLSL}
${atmosphereGLSL}
${CLOUD_SHADOW_GLSL}
${CLOUD_DENSITY_GLSL}
${scatterGLSL}
${msGLSL ? `
// ---- round five: learned multiple scattering (docs/clouds/NEURAL.md). Taps = physical extinction of the cheap base
// density in air-mass space, with the sample's own weather fetch and a mip one level coarser than the light march.
#define CL_MS5 1
${/float\s+cloudMsForwardPeak\s*\(\s*float\s+\w+\s*,\s*float\s+\w+\s*,\s*float/.test(msGLSL) ? '#define CL_MS_AUREOLE 1' : ''}
vec4 clMsWx = vec4(0.0); float clMsLod = 1.0;
float clMsSigma(vec3 p) { vec4 info; return clDensityBase(p, clMsWx, clMsLod, info) * info.w * uClNoise.w * 0.8; }
#define CLOUD_MS_SIGMA(p) clMsSigma(p)
${msGLSL}
uniform vec4 uClMs;          // x = network evaluations per ray (deeper samples reuse the last), y = strength of lam / occ on this path
` : ''}

uniform sampler2D tClBlue;
uniform sampler2D tClCirrus;
uniform vec4 uClJitter;      // xy = sub-pixel offset of this frame's sample inside the NxN block (full-res px), z = temporal blue-noise shift, w = on/off of volumetrics
uniform vec4 uClFullRes;     // xy = full resolution (px), z = radians per low-res pixel, w = 1: B-spline shadow-map fetch in the light march
uniform vec4 uClStep;        // x = relative fine step, y = min fine step (m), z = min coarse step (m), w = max distance (m)
uniform vec3 uClOriginAir;   // xz: render-space -> air-mass offset (origin - wind offset), computed in doubles on the CPU
uniform vec3 uClLightDir;    // unit vector TOWARD the dominant light (sun, or moon at night)
uniform vec4 uClLightSel;    // x = sun weight, y = ground-bounce scale, z = ambient scale, w = time (s)
uniform vec3 uClMoonE;       // moon irradiance (zero while the sun is the light)
uniform vec4 uClFlash[2];    // lightning: xyz = render-space position, w = intensity
uniform vec4 uClCirrus;      // x = altitude (m), y = amount (0..1), zw = render-space -> cirrus air-mass offset
uniform vec4 uClAmbUp;       // rgb = clear-sky ambient irradiance / pi for the clouds (NOT divided by the player's cloud shadow), w = 1: use it
uniform vec4 uClAmbDn;       // rgb = ground-bounce radiance under the cloud field

const float CL_R = 6371000.0;

// Altitude above the (camera-tangent) spherical planet at distance t along a ray with vertical direction dy,
// starting at altitude c. Written to be stable in float32 (no R + h subtraction).
float clAlt(float t, float dy, float c) {
  float r0 = CL_R + c, num = 2.0 * r0 * dy * t + t * t;
  return c + num / (sqrt(max(r0 * r0 + num, 0.0)) + r0);
}
// Ray / sphere-of-altitude-H intersection distances (near, far); near > far when the ray misses.
vec2 clShell(float dy, float c, float H) {
  float r0 = CL_R + c, b = r0 * dy, cc = (c - H) * (2.0 * CL_R + c + H);
  float disc = b * b - cc;
  if (disc < 0.0) return vec2(1e12, -1e12);
  float q = -(b + (b >= 0.0 ? 1.0 : -1.0) * sqrt(disc));          // stable quadratic roots
  float t0 = q, t1 = abs(q) > 1e-6 ? cc / q : 0.0;
  return vec2(min(t0, t1), max(t0, t1));
}

uniform vec4 uClLight2;      // round five: x = moon weight, y = 1: physical light (pipeline sun / moon illuminance with the local
                             // horizon of the cloud, earth curvature included), 0 = round-four (camera-local sun, artistic moon)
// Light arriving at a cloud at render-space position renderPos and true altitude alt (m). Round five: the sun / moon
// elevation is measured against the LOCAL vertical of that point (a cloud 100 km toward a setting sun sees it ~0.9
// degrees higher, which is why distant sunward clouds stay pink after sunset) and the moon is the pipeline's own
// moon illuminance (phase, atmosphere), so moonlit clouds have the energy of moonlit white paint.
vec3 clLightE2(vec3 renderPos, float alt) {
#ifdef CL_ATM_LT
  if (uClLight2.y > 0.5) {
    vec2 d = (renderPos.xz - uCameraPos.xz) * (1.0 / CL_R);
    vec3 up = normalize(vec3(d.x, 1.0, d.y));
    float hk = max(alt, 0.0) * 0.001;
    return uAtmSunIllum * atmLightTransmittance(hk, dot(uSunDir, up)) * uClLightSel.x
         + uAtmMoonIllum * atmLightTransmittance(hk, dot(uMoonDir, up)) * uClLight2.x;
  }
#endif
  return atmSunIlluminance(renderPos) * uClLightSel.x + uClMoonE;
}
vec3 clLightE(vec3 renderPos) { vec2 d = renderPos.xz - uCameraPos.xz; return clLightE2(renderPos, renderPos.y + dot(d, d) * 7.848e-8); }

// Optical depth toward the light: a few exponentially spaced samples of the cheap density (cone/light march of
// [Schneider15], shortened), then the baked shadow map for everything farther away (other clouds, upper layers).
float clTauLight(vec3 pa, vec4 wx, float lod, float jit, float fp, float ex0, float edge) {
  float tau = 0.0, d0 = 0.0;
  vec4 info;
  // round four: close to the camera the first segment (0 .. 62 m at 4 steps) is sampled twice WITH the detail
  // erosion: the shadow one lobe casts on the next, i.e. the dark creases of a cauliflower surface under side light
  bool micro = uClDet.y > 0.5 && fp > 0.0;
  for (int j = 0; j < CL_LIGHT_STEPS; j++) {
    float u = (float(j) + 1.0) / float(CL_LIGHT_STEPS);
    float d1 = 1000.0 * u * u;                                     // segment ends: 62, 250, 562, 1000 m (4 steps)
    float dl = d1 - d0;
    if (j == 0 && micro) {
      float s2 = dl * (0.36 + 0.44 * jit), s1 = dl * (0.07 + 0.2 * jit);
      vec3 p2 = pa + uClLightDir * s2;
      float surf0 = clSurf, ex2 = clShape(p2, wx, lod, info);
      float dA = clDensityFull(p2, ex2, info, max(2.0 * fp, 6.0), max(edge, 0.008)) * info.w, surf2 = clSurf;
      // the shape excess between the sample and p2 is interpolated: only the detail is fetched again
      float dB = clDensityFull(pa + uClLightDir * s1, mix(ex0, ex2, s1 / s2), info, max(fp, 3.0), max(edge, 0.006)) * info.w;
      // How the surface faces the sun: (excess - erosion) is a rough signed depth below the surface (1 unit ~ 1 km),
      // so its decrease along the light direction is ~cos(normal, sun) x |gradient|; the gradient length is not
      // known (that would take three more samples), hence the soft normalisation.
      float g = 500.0 * ((surf0 - clSurf) / s1 + (surf0 - surf2) / s2);
      clMu0 = g / sqrt(g * g + 0.5);
      tau += (0.3 * dB + 0.7 * dA) * dl * 1.25;                    // 1.25: these are eroded densities (see the 0.8 below)
      d0 = d1; continue;
    }
    // half-cell jitter: hides the sample planes at half the variance. In layer clouds (anvil, decks) the sample planes
    // cut a nearly horizontal slab: the gaps a half-cell jitter leaves between the samples' ranges turn into steps of
    // the optical depth with the depth below the slab's top, i.e. contour bands on an anvil seen from above at low
    // sun. There the jitter covers the whole cell (a different phase per sample).
    float jw = (uClShape2.z + uClShape.w) * uClDet3.z > 0.0 ? 1.0 : 0.5;
    vec3 pl = pa + uClLightDir * (d0 + dl * (0.5 + jw * (fract(jit + 0.382 * float(j)) - 0.5)));
    // (the weather map varies over kilometres: the sample's own fetch serves the whole 1 km light path, which pays
    //  for the cell-field fetch each light sample now makes)
    // the first segments at full-ish resolution: the shadow of one turret on the next (the dark creases) is ~100 m scale
    // (under an anvil the lid and the anvil's extent come straight from the weather map: with the sample's own fetch
    //  the light samples see the anvil exactly as deep as it is above the SAMPLE, the shading turns into a function of
    //  the map alone and its iso-lines show as rings around the storm cores; there the light samples fetch their own)
    vec4 wl = uClShape2.z * uClDet3.z > 0.0 ? clWeather(pl.xz, 1.0) : wx;
    float d = clDensityBase(pl, wl, lod + 0.5 + float(j) * 0.6, info);
    tau += d * info.w * dl;
    d0 = d1;
  }
  tau *= uClNoise.w * 0.8;                                         // 0.8: base density is not eroded
  vec3 pe = pa + uClLightDir * 1000.0;
  // undo the air-mass offset: cloudShadowTau wants world XZ (it subtracts the wind offset itself)
  // At low sun the 2.5D shadow map projects its horizontal structure onto cloud faces compressed by tan(elevation),
  // which reads as horizontal striations. Jitter the lookup along the light slope (up to 1.2 km, i.e. a penumbra /
  // multiple-scattering blur); the temporal filter integrates it.
  // Round three: the striations were the C0 creases of the bilinear fetch, stretched across the face by the
  // slant of the lookup (one 80 m texel spans ~14 m of height at 10 deg sun). The cubic B-spline fetch (C2, 4 taps)
  // removes them without the noisy 1 km jitter; uClFullRes.w = 0 restores the single jittered tap (A/B, cost).
  if (uClFullRes.w > 0.5) {
    // plus a +-k texel jitter along the slope (k = uClFullRes.w, default 3): the B-spline alone is smooth but still
    // prints the map's own texel-scale structure as fine horizontal bands on faces lit at grazing sun (k=1 still
    // bands, k=3 is clean); the temporal filter integrates the jitter
    float sl = length(uCloudShadowB.xy);
    float texM = 1.0 / (uCloudShadowA.z * float(textureSize(tCloudShadowMap, 0).x));
    vec2 jo = uCloudShadowB.xy / max(sl, 1e-3) * ((jit - 0.5) * 2.0 * texM * uClFullRes.w);
    tau += cloudShadowTauF(pe.xz + uCloudShadowC.xy + jo, pe.y, true);
  } else {
    float sl = length(uCloudShadowB.xy);
    vec2 jo = uCloudShadowB.xy * ((jit - 0.5) * min(150.0, 1200.0 / max(sl, 1e-3)));
    tau += cloudShadowTau(pe.xz + uCloudShadowC.xy + jo, pe.y);
  }
  return tau;
}

// High thin cirrus / cirrostratus sheet at one altitude: a 2D fibrous texture on a spherical shell.
vec4 clCirrusLayer(vec3 rd, float c, float sceneD, out float tHit) {
  tHit = 0.0;
  float H = uClCirrus.x;
  vec2 hit = clShell(rd.y, c, H);
  float t = c < H ? hit.y : hit.x;
  if (uClCirrus.y <= 0.002 || hit.x > hit.y || t <= 0.0 || t > sceneD || t > 3.2e5) return vec4(0.0, 0.0, 0.0, 1.0);
  vec3 pr = uCameraPos + rd * t;
  vec2 x = pr.xz + uClCirrus.zw;
  float mu = clamp(abs((CL_R + c) * rd.y + t) / (CL_R + H), 0.06, 1.0);        // |cos| of the ray to the local vertical
  float lod = log2(max(t * uClFullRes.z / mu / 84.0, 1.0));
  float fib = textureLod(tClCirrus, x / 43000.0, lod).r;
  // a second, finer and slightly turned octave of the same fibres (the bundles split into strands up close)
  float fib2 = textureLod(tClCirrus, vec2(0.995 * x.x + 0.1 * x.y, -0.1 * x.x + 0.995 * x.y) / 9100.0 + 0.37, lod + 2.2).r;
  fib = fib * (0.55 + 0.75 * fib2);
  fib = mix(fib, min(2.4 * fib * fib, 1.3), 0.65 * uClDet5.w);                   // round four: bright strands, clearer gaps
  vec4 big = textureLod(tClCirrus, vec2(0.83 * x.x - 0.56 * x.y, 0.56 * x.x + 0.83 * x.y) / 167000.0, max(lod - 2.0, 0.0));
  float patches = smoothstep(1.0 - uClCirrus.y * 1.25, 1.25 - uClCirrus.y * 1.1, big.g * 0.75 + big.b * 0.45);
  float d = patches * (0.08 + 0.92 * fib) * smoothstep(0.04, 0.4, fib + patches * 0.15);   // fibres, little haze between
  float tauV = d * (0.12 + 0.5 * uClCirrus.y) * (1.0 + 0.7 * uClDet5.w);                                   // vertical optical depth
  float tau = min(tauV / mu, 3.0) * (1.0 - smoothstep(2.0e5, 3.2e5, t));
  if (tau <= 1e-4) return vec4(0.0, 0.0, 0.0, 1.0);
  float T = exp(-tau), op = 1.0 - T;
  vec3 E = clLightE2(pr, H);
  float cosT = dot(rd, uClLightDir);
  float mu0 = clamp(uClLightDir.y + 0.08, 0.08, 1.0);
  // ice crystals: strong forward lobe + broad floor; self-shadowing of the slanted sun path through the sheet
  float ph = mix(clHG(cosT, 0.72), 0.0796, 0.4) + 0.045 * mu0;
  vec3 phc = vec3(ph);
  if (uClPhys.w > 0.5) {
    // round five: 22 degree halo of hexagonal ice prisms (minimum deviation 21.84 deg: sharp, reddish inner edge, nothing
    // inside it, a bluish-white fade outward); roughened crystals of fibrous cirrus keep it weak (research doc 2.3)
    float th = degrees(acos(clamp(cosT, -1.0, 1.0)));
    vec3 inner = vec3(21.75, 21.95, 22.15);                         // dispersion: red refracts least
    vec3 halo = step(inner, vec3(th)) * exp(-max(vec3(th) - inner, 0.0) / vec3(1.6, 1.9, 2.3));
    phc += 0.09 * halo * (0.5 + 0.5 * fib);
  }
  vec3 L = E * phc * op * exp(-0.5 * tauV / mu0);
  // (round five: the raw clear-sky ambient when the pipeline provides it; uAmbientSky is divided by the player's cloud
  //  shadow and lit the cirrus over an overcast like day)
  vec3 aU = uClAmbUp.w > 0.5 && uClLight2.y > 0.5 ? uClAmbUp.rgb : atmAmbient(pr, vec3(0.0, 1.0, 0.0));
  vec3 aD = uClAmbUp.w > 0.5 && uClLight2.y > 0.5 ? uClAmbDn.rgb : atmAmbient(pr, vec3(0.0, -1.0, 0.0));
  L += 0.5 * (aU + aD) * uClLightSel.z * op;
  vec4 ap = atmAerialPerspective(pr);
  tHit = t;
  return vec4(L * ap.a + ap.rgb * op, T);
}

void main() {
  ivec2 lp = ivec2(gl_FragCoord.xy);
  vec2 uv = min((vec2(lp * CL_N) + uClJitter.xy + 0.5) / uClFullRes.xy, vec2(1.0) - 0.5 / uClFullRes.xy);
  vec3 rd = viewRay(uv);
  float sceneD = sceneDistance(uv);
  float c = uCameraPos.y;
  float blue = fract(texelFetch(tClBlue, lp & 63, 0).r + uClJitter.z);
  float blue2 = fract(texelFetch(tClBlue, (lp + ivec2(23, 41)) & 63, 0).r + uClJitter.z * 1.7548);

  vec3 L = vec3(0.0);
  float T = 1.0, wSum = 0.0, tSum = 0.0, flash = 0.0;
  float tFallback = 40000.0;
  float nIter = 0.0, nDense = 0.0;            // cost counters (debug read-back through aux.a)

  if (uClJitter.w > 0.5) {
    // ---- marching interval through the spherical cloud shell (first crossing only) --------------------------
    bool rain = uClRain.x > 0.0;
    float Hb = rain ? 0.0 : uClLayer.x, Ht = uClLayer.y;
    vec2 sTop = clShell(rd.y, c, Ht), sBot = clShell(rd.y, c, Hb);
    float t0 = 0.0, t1 = -1.0;
    if (c > Ht) { if (sTop.x < sTop.y && sTop.x > 0.0) { t0 = sTop.x; t1 = (sBot.x < sBot.y && sBot.x > 0.0) ? sBot.x : sTop.y; } }
    else if (c >= Hb) { t0 = 0.0; t1 = (sBot.x < sBot.y && sBot.x > 0.0) ? sBot.x : sTop.y; }
    else { t0 = sBot.y; t1 = sTop.y; }
    vec2 sGround = clShell(rd.y, c, -20.0);
    if (sGround.x < sGround.y && sGround.x > 0.0) t1 = min(t1, sGround.x);
    t1 = min(t1, min(sceneD, uClStep.w));
    tFallback = clamp(t0, 2000.0, 60000.0);

    if (t1 > t0) {
      // per-ray lighting inputs (atmosphere functions stay outside the loop: they may use implicit-LOD lookups)
      float tB = min(t1, t0 + 60000.0);
      // light at the two ends of the lit interval, each at the base and the top of the layer (bilinear per sample in
      // distance and altitude: at twilight the earth's shadow climbs through the layer)
      vec3 pA = uCameraPos + rd * t0, pB = uCameraPos + rd * tB;
      float eLo = uClLayer.x + 0.1 * uClLayer.w, eHi = uClLayer.x + 0.9 * uClLayer.w;
      vec3 EaL = clLightE2(pA, eLo), EaH = clLightE2(pA, eHi), EbL = clLightE2(pB, eLo), EbH = clLightE2(pB, eHi);
      vec3 Ea = 0.5 * (EaL + EaH), Eb = 0.5 * (EbL + EbH);
      vec3 pm = uCameraPos + rd * min(t0 + 3000.0, t1);
      // uAmbientSky / uAmbientGround are divided by the cloud shadow AT THE PLAYER (the composite multiplies it back
      // for the scene), which must not brighten the clouds when the player flies under one: use the uncompensated
      // values from ctx.pipeline.lighting when the pipeline provides them (uClAmbUp.w = 1)
      vec3 ambUp = (uClAmbUp.w > 0.5 ? uClAmbUp.rgb : atmAmbient(pm, vec3(0.0, 1.0, 0.0))) * uClLightSel.z;
      vec3 ambDn = (uClAmbUp.w > 0.5 ? uClAmbDn.rgb : atmAmbient(pm, vec3(0.0, -1.0, 0.0)) * uClLightSel.y) * uClLightSel.z;
      // Sky light enters a cumulus mostly through its SIDES, i.e. from the horizon band, which the cosine-weighted
      // irradiance of the probe (zenith-heavy: blue, and dim at low sun) under-represents; the lighting networks take
      // "the mean radiance of the hemisphere". Round four: half of it from four directions 12 degrees above the horizon
      // (towards / away from / across the sun). At sunset that is the warm band the inside of a cloud is lit by.
      if (uClDet3.w > 0.0) {
        vec2 sa = normalize(uSunDir.xz + vec2(1e-4, 0.0)) * 0.978;
        vec3 side = 0.25 * (atmSkyRadiance(vec3(sa.x, 0.208, sa.y)) + atmSkyRadiance(vec3(-sa.x, 0.208, -sa.y))
                          + atmSkyRadiance(vec3(-sa.y, 0.208, sa.x)) + atmSkyRadiance(vec3(sa.y, 0.208, -sa.x)));
        ambUp = mix(ambUp, side * uClLightSel.z * uClLightSel.x + ambUp * (1.0 - uClLightSel.x), uClDet3.w);
      }
      float cosT = dot(rd, uClLightDir);
      #ifdef CL_MS5
      vec3 msPhase = cloudPhaseMie(cosT), msLast = vec3(0.0);
      #endif
      float voxel = 1.0 / (uClNoise.x * 128.0), voxelD = 1.0 / (uClNoise.y * 32.0);

      // Step sizes. Inside cloud: fine steps ~ Kf * distance. Searching for cloud: coarse steps (~3 Kf * distance),
      // widened as the step budget is consumed so long grazing rays still reach the far field. Where the weather
      // map says the whole column is empty at this altitude (clear patch, or above the local tops): big free steps.
      float Kf = uClStep.x;
      float t = t0;
      bool fine = false; int zeros = 0;
      float cap = 1e9;                         // step cap while resolving an optically thick cloud surface

      for (int i = 0; i < CL_STEPS; i++) {
        if (t >= t1 || T < 0.004) break;
        nIter += 1.0;
        float left = float(CL_STEPS - i);
        float need = log(min(t1, max(40000.0, 8.0 * t)) / max(t, 1500.0)) / (0.8 * left);
        float Kc = max(3.0 * Kf, need);
        float dsC = max(uClStep.z, Kc * t);
        // far field (coarse step larger than a cloud): point-testing would miss clouds, so every step integrates
        // (unbiased optical depth) with steps blending from fine to coarse.
        float farK = smoothstep(700.0, 1800.0, dsC);
        float dsF = max(uClStep.y, mix(Kf, Kc, farK) * t);
        bool farField = dsF > 0.6 * dsC;
        float ds = min(min((fine || farField) ? dsF : dsC, t1 - t), cap);
        float ts = t + ds * blue;
        float h = clAlt(ts, rd.y, c);
        vec3 pr = uCameraPos + rd * ts;
        vec3 pa = vec3(pr.x + uClOriginAir.x, h, pr.z + uClOriginAir.z);
        float fadeFar = 1.0 - smoothstep(0.75 * uClStep.w, uClStep.w, ts);
        vec4 wx = clWeather(pa.xz, clamp(log2(ds * uClWx.w), 0.0, 5.0));
        if (!fine && h >= uClLayer.x) {
          // conservative column test on the (mip-filtered, smooth) weather fields
          float covC = uClShape.x + (wx.r - 0.5) * uClShape.y + 0.06;
          float devC = smoothstep(uClShape2.x, uClShape2.y, wx.g + 0.07);
          if (uClShape2.z * uClDet4.w > 0.0) devC = smoothstep(0.0, 0.25, devC) ;      // stepped Cb towers (clShape)
          // highest altitude the strongest possible noise peak (s ~ 1.25) can reach in this column
          float reach = sqrt(max(0.25 + covC, 0.0) / mix(uClShape3.x, uClShape3.y, devC));
          float topC = uClLayer.x + min(mix(uClShape.z, 1.0, devC) * reach, 1.0) * uClLayer.w + 100.0;
          // layer clouds only where they exist; cumulus cells: the deepest the largest cell can grow here
          if (uClShape.w <= 0.0 && uClShape2.z <= 0.0) topC = uClLayer.x + 100.0;
          if (uClCell.w > 0.0) topC = max(topC, uClLayer.x + 720.0);
          float hMaxC = uClCell2.x * exp2(uClCell2.y) * mix(uClCell2.z, uClCell2.w, devC) * 1.25 * (1.0 + 1.4 * max(covC - 0.62, 0.0)) * (1.0 + uClShape3.z * 0.6 + uClShape3.w * 0.5);
          topC = max(topC, uClLayer.x + min(hMaxC, uClLayer.w) + 100.0);
          if (uClShape2.z * smoothstep(uClShape2.x - 0.17, uClShape2.x + 0.03, wx.g + 0.07) > 0.0) topC = uClLayer.y;   // anvil overhead
          if (covC <= 0.0 || h > topC) {
            float big = max(ds, 0.14 * t);
            float dhdt = rd.y + ts / CL_R;                           // d(altitude)/dt along the ray
            if (covC > 0.0 && dhdt < 0.0) big = min(big, max((h - topC) / -dhdt, ds));   // do not dive through the tops
            t += min(big, t1 - t) ; continue;
          }
        }

        if (h < uClLayer.x) {
          // ---- below the base: rain shafts / virga (smooth, so coarse steps integrate directly) ----
          fine = false;
          float rd_ = rain ? clRain(pa, wx) * fadeFar : 0.0;
          if (rd_ > 0.0) {
            float sig = rd_ * uClRain.x;
            float tauS = cloudShadowTau(pa.xz + uCloudShadowC.xy, h);
            vec3 E = mix(EaL, EbL, clSat((ts - t0) / max(tB - t0, 1.0)));
            float diffT = 1.0 / (1.0 + 0.11 * tauS);
            vec3 S = E * (mix(0.0796, clHG(cosT, 0.6), 0.5) * exp(-tauS) + 0.05 * diffT) + 0.5 * (ambUp * diffT + ambDn);
            float Ts = exp(-sig * ds), w = T * (1.0 - Ts);
            for (int k = 0; k < 2; k++) { vec3 dv = pr - uClFlash[k].xyz; flash += w * uClFlash[k].w / (1.0 + dot(dv, dv) * 1.2e-6); }
            // rain is featureless: it must not drag the reprojection depth towards the camera (the cloud structure
            // seen through it would smear with wind drift / parallax), so it barely counts in the mean distance
            L += w * S * 0.92; tSum += 0.03 * w * ts; wSum += 0.03 * w; T *= Ts;
          }
          t += ds; continue;
        }

        float lod = clamp(log2(ds / (voxel * 2.0)), 0.0, 2.5);
        vec4 info;
        float exLo = (uClDet.x > 0.5 ? CL_EROSION_LO : CL_EROSION_BIAS) * CL_EROSION_MAXK * uClNoise.z;
        float exS_ = clShape(pa, wx, lod, info);
        exLo *= clGradK;
        float ex = exS_ + exLo;                                       // conservative: erosion can also add
        if (!fine && !farField) {
          if (ex > 0.0) { fine = true; zeros = 0; continue; }     // hit: re-march this interval with fine steps
          t += ds; continue;
        }
        float d = 0.0, pix = ts * uClFullRes.z, fp = ds, edge = 0.05;
        if (ex > 0.0) {
          // footprint of the sample: the (low-res) pixel across the ray, half a step along it (the temporal filter
          // integrates the step jitter); the detail octaves and the density ramp follow it: crisp near, soft far
          if (uClDet.x > 0.5) { fp = max(pix, 0.75 * ds); edge = clamp(fp * 0.001, uClDet2.z, 0.05); }
          else { fp = ds; edge = clamp(ds * 0.0005, 0.009, 0.05); }
          d = clDensityFull(pa, ex - exLo, info, fp, edge) * info.w * fadeFar;
        }
        if (d > 0.0) {
          float sig = d * uClNoise.w;
          // Refine on hit: a step that is optically thick (tau > 1.6) cannot shade the cloud surface properly (the
          // lit skin is ~1 mean free path deep). Back up to just before the sample and re-march with ~1 mfp steps;
          // the cap then relaxes geometrically, so a surface costs 4-5 lit samples whatever the distance.
          if (cap > 1e8 && sig * ds > 1.6 && ds > 1.5 * uClStep.y) {
            cap = max(1.0 / sig, uClStep.y); t = max(t, ts - 0.5 * cap); fine = true; zeros = 0; continue;
          }
          // Round four, close to the camera: the surface itself must be found to a few pixels, or the 20-100 m lobes
          // of the detail cascade dissolve in the step jitter. The interval of the first dense sample is re-marched
          // with steps of ~2.5 pixels (>= 4 m); the cap relaxes as above (about 4 extra lit samples per surface).
          float dsSurf = clamp(2.5 * pix, 4.0, uClStep.y);
          if (uClDet.w > 0.5 && cap > 1e8 && ds > 1.5 * dsSurf && left > 12.0) {
            cap = dsSurf; fine = true; zeros = 0; continue;
          }
          zeros = 0; nDense += 1.0;
          // (clTauLight overwrites the detail side outputs) the pattern only means something within a few tens of
          // metres of the surface: deeper samples take the mean
          float cav = mix(0.2, clCav, clSat(1.3 - clSurf / 0.04));
          float surfK = clSat(1.3 - clSurf / 0.04);
          clMu0 = 2.0;
          // (detailed light samples: within ~10 low-res pixels per metre... i.e. where a pixel is under 10 m, and only in the
          //  outer ~50 m of the cloud: deeper samples are in its shadow whatever the lobes do)
          float tauSun = clTauLight(pa, wx, lod, fract(blue2 + nDense * 0.618), pix < 10.0 && surfK > 0.0 ? min(fp, 12.0) : -1.0, ex - exLo, edge);
          // Lobes read as lit spheres (round four): an optically thick surface returns light in proportion to the sun
          // flux through it, i.e. ~cos(incidence), which the scatter model cannot know from its optical depths.
          float lam = clMu0 > 1.5 ? 1.0 : mix(1.0, 0.55 + 0.9 * max(clMu0, 0.0) + 0.2 * min(clMu0, 0.0), uClDet3.y * surfK * clSat(2.0 - pix / 5.0));
          // optical depth to the cloud top: mostly a smooth height-based estimate (using only the local density
          // would print the density field onto the ambient term: an "x-ray" look in diffuse light)
          float tauUp = uClNoise.w * (0.3 + 0.2 * d) * max(info.y - h, 0.0);
          // layer clouds (round four): the deck above a sample is as thick as it is, not as thick as the layer is
          // nominally: the column optical depth from the shadow map (slant path converted to vertical) lets thin
          // parts of an overcast glow and thick parts go dark when seen from below
          if (uClShape.w * uClDet4.x > 0.0) {
            float tCol = cloudShadowTau(pa.xz + uCloudShadowC.xy, h) / sqrt(1.0 + dot(uCloudShadowB.xy, uCloudShadowB.xy));
            tauUp = mix(tauUp, tCol * 0.75, uClShape.w * uClDet4.x);
          }
          // optical depth down to the cloud base (same smooth estimate): ambient from below, and the column-thickness
          // input of the 4-feature scatter model
          float tauDn = uClNoise.w * (0.3 + 0.2 * d) * max(h - uClLayer.x, 0.0);
          #if defined(CL_MS5)
          float J = 0.0;
          #elif defined(CL_SCATTER4)
          float J = cloudSunScatter4(tauSun, tauUp, cosT, tauDn);
          #else
          float J = cloudSunScatter(tauSun, tauUp, cosT);
          #endif
          float eS = clSat((ts - t0) / max(tB - t0, 1.0)), eH = clSat((h - eLo) / (eHi - eLo));
          vec3 E = mix(mix(EaL, EbL, eS), mix(EaH, EbH, eS), eH);
          #if defined(CL_AMBIENT_VIS) && !defined(CL_MS5)
          // Round four, calibration of the round-three network against a path-traced 10 m cumulus at the new
          // extinction (tools/neural/gt_near.py, 9600 points): with a low sun the light enters through the flanks
          // and the shaded interior is 1.4-2.2 x brighter than the network (trained on coarser, thinner fields)
          // says, 1.2 x at the lit skin; at 70 deg it is within 10 %. Without this the inside of a cloud at low sun
          // is lit by the blue sky term alone and reads cold grey.
          float muS_ = max(uClLightDir.y, 0.0);
          J *= 1.0 + uClDet5.y * (mix(0.22, -0.08, smoothstep(0.5, 0.95, muS_))
                                  + mix(1.0, 0.2, smoothstep(0.26, 0.71, muS_)) * clSat((tauSun - 4.0) / 20.0));
          #endif
          // Crease occlusion (round four): in the lobe / crease pattern of the detail cascade the tips of the lobes see
          // the whole sky and their multiply scattered light leaves freely; the creases between them are enclosed.
          // cav = where the sample sits in that pattern (0.2 = mean of the billow profile); x: sun term, y: ambient.
          vec2 occ = clamp(1.0 - uClDet.z * vec2(0.55, 1.0) * (cav - 0.2) * 1.25, 0.25, 1.3);
          // ambient: sky light diffusing down from the cloud top, ground bounce coming up through the base
          #if defined(CL_MS5)
          // Round five (NEURAL.md 2.1): single scattering with the tabulated Mie phase (forward peak, fogbow, glory), the
          // light kept in the beam by the diffraction peak, and every higher order of sun, sky and ground light from the
          // network fed with physical optical depths. Replaces J (octaves / diffusion / powder / round-three nets), the
          // ambient visibility and both round-four calibrations. lam / occ (sub-100 m lobe detail) at reduced strength.
          if (nDense <= uClMs.x) {
            clMsWx = wx; clMsLod = lod + 1.5;
            vec3 tU = cloudMsTapSegments(pa, vec3(0.0, 1.0, 0.0)), tD = cloudMsTapSegments(pa, vec3(0.0, -1.0, 0.0));
            vec3 tF = cloudMsTapSegments(pa, rd);
            msLast = cloudMsLight(tauSun, -log(max(T, 1e-30)), uClLightDir.y, cosT, tU, tD, tF);
          }
          #ifdef CL_MS_AUREOLE
          float msFwd = cloudMsForwardPeak(tauSun, msPhase.g, cosT);   // (v2: with the aureole near the sun)
          #else
          float msFwd = cloudMsForwardPeak(tauSun, msPhase.g);
          #endif
          vec3 occM = vec3(mix(1.0, occ.x * lam, uClMs.y), mix(1.0, occ.y, uClMs.y), 0.0);
          vec3 S = E * (msPhase * exp(-tauSun) +  msFwd + msLast.x) * occM.x
                 + (ambUp * msLast.y + ambDn * msLast.z) * occM.y;
          #elif defined(CL_AMBIENT_VIS)
          // learned (src/neural/cloud-light.js): source per unit hemisphere radiance, all orders of scattering
          vec2 vis = cloudAmbientVis(tauUp, tauDn) * mix(vec2(1.0), vec2(0.84, 1.17), uClDet5.y);   // (same calibration)
          vec3 S = E * J * (occ.x * lam) + (ambUp * vis.x + ambDn * vis.y) * occ.y;
          #else
          float visUp = 0.35 * exp(-0.6 * tauUp) + 0.65 / (1.0 + 0.2 * tauUp);
          float visDn = 0.35 * exp(-0.6 * tauDn) + 0.65 / (1.0 + 0.2 * tauDn);
          vec3 S = E * J * (occ.x * lam) + 0.5 * (ambUp * visUp + ambDn * visDn) * occ.y;
          #endif
          if (uClDet3.x > 0.5) S = uClDet3.x < 1.5 ? vec3(0.02 + 0.5 * exp(-tauSun)) : uClDet3.x < 2.5 ? vec3(cav) : uClDet3.x < 3.5 ? vec3(surfK, d, 0.2) * 0.6 : vec3(lam * 0.5);
          // energy-conserving integration over the step [Hillaire16]
          float Ts = exp(-sig * ds), w = T * (1.0 - Ts);
          L += w * S;
          // lightning glow from inside the cloud (kept separate: it must not be temporally accumulated)
          for (int k = 0; k < 2; k++) {
            vec3 dv = pr - uClFlash[k].xyz; float d2 = dot(dv, dv);
            flash += w * uClFlash[k].w / (1.0 + d2 * 1.2e-6) * exp(-sqrt(d2) * 2.2e-4);
          }
          tSum += w * ts; wSum += w; T *= Ts;
          cap *= 1.6;
        } else if (++zeros > 5) { fine = false; cap = 1e9; }
        t += ds;
      }
    }
  }

  // Remap the early-out threshold to full opacity, then aerial perspective at the opacity-weighted mean distance
  // (one evaluation per pixel, [Schneider15]/[Hillaire16]).
  T = clSat((T - 0.004) / 0.996);
  float tMean = wSum > 0.0 ? tSum / wSum : tFallback;
  vec4 ap = atmAerialPerspective(uCameraPos + rd * tMean);
  L = L * ap.a + ap.rgb * (1.0 - T);
  flash *= ap.a;

  // cirrus sheet: behind the low clouds when seen from below, in front when the camera is above it
  float tCi;
  vec4 ci = clCirrusLayer(rd, c, sceneD, tCi);
  if (c < uClCirrus.x) { L += T * ci.rgb; if (wSum <= 0.0 && tCi > 0.0) tMean = tCi; T *= ci.a; }
  else { L = ci.rgb + ci.a * L; T *= ci.a; if (tCi > 0.0 && ci.a < 0.5) tMean = tCi; }

  oColor = vec4(L, T);
  oAux = vec4(min(tMean * 1e-3, 1000.0), min(sceneD * 1e-3, 1000.0), flash, uClDebug.z > 0.5 ? nDense : nIter);
}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Round-three temporal reconstruction (kept as clTaa=0) at full resolution (temporal upsampling in the spirit of [Schneider15]'s 4x4 reprojection,
// with depth-aware (joint bilateral) spatial weights so scene silhouettes stay crisp):
//   current = bilateral blend of the 4 nearest low-res samples (which sit at this frame's jittered sub-pixel offset)
//   history = previous output, reprojected through the mean cloud distance with uPrevViewProj
//   output  = mix(history, current, alpha), alpha is high where this pixel was actually marched this frame.
export function resolveFragmentR3({ frameGLSL, depthGLSL, N }) {
  return /* glsl */`
precision highp float; precision highp int;
#define CL_N ${N | 0}
in vec2 vUv;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oAux;
${frameGLSL}
${depthGLSL}
uniform sampler2D tClMarch, tClMarchAux, tClHist, tClHistAux;
uniform vec4 uClJitter;      // xy = this frame's sub-pixel offset (full-res px)
uniform vec4 uClTemporal;    // x = history valid, y = alpha (interpolated pixels), z = alpha (freshly marched pixel), w = camera translation this frame (m)
uniform vec4 uClWindVel;     // xyz = cloud drift this frame (m, render space), w = focal length in pixels
uniform vec4 uClTemporal2;   // x = strength of the young-history spatial filter (0 = off)
void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  ivec2 lowSize = textureSize(tClMarch, 0);
  float dFull = min(sceneDistance(vUv) * 1e-3, 1000.0);
  vec2 g = (vec2(P) - uClJitter.xy) / float(CL_N);
  ivec2 i0 = ivec2(floor(g)); vec2 f = g - vec2(i0);
  vec4 cSum = vec4(0.0); float dSum = 0.0, wSum = 0.0, bestDz = 1e9; vec4 bestC = vec4(0.0, 0.0, 0.0, 1.0); float bestD = 40.0;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    ivec2 ip = clamp(i0 + o, ivec2(0), lowSize - 1);
    vec4 cc = texelFetch(tClMarch, ip, 0); vec4 a = texelFetch(tClMarchAux, ip, 0);
    float bw = (o.x == 0 ? 1.0 - f.x : f.x) * (o.y == 0 ? 1.0 - f.y : f.y);
    float dz = abs(log2(max(a.y, 1e-4) / max(dFull, 1e-4)));
    float w = (bw + 0.002) * exp2(-min(dz * 24.0, 60.0));
    cSum += cc * w; dSum += a.x * w; wSum += w;
    if (dz < bestDz) { bestDz = dz; bestC = cc; bestD = a.x; }
  }
  vec4 cur; float cloudKm;
  if (wSum > 1e-12) { cur = cSum / wSum; cloudKm = dSum / wSum; } else { cur = bestC; cloudKm = bestD; }

  // reproject: where was this piece of cloud on screen last frame?
  vec3 wp = uCameraPos + viewRay(vUv) * (cloudKm * 1000.0) - uClWindVel.xyz;
  vec4 pc = uPrevViewProj * vec4(wp, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  bool ok = uClTemporal.x > 0.5 && pc.w > 0.0 && all(greaterThan(puv, vec2(0.0))) && all(lessThan(puv, vec2(1.0)));
  float alpha = 1.0, count = 1.0;
  vec4 h = vec4(0.0), ha = vec4(0.0);
  if (ok) { h = texture(tClHist, puv); ha = texture(tClHistAux, puv); }
  // Young history (first frames after a cut, a disocclusion or boot): the running mean of a handful of jittered
  // samples still shows the per-pixel step jitter as dots in thin cloud. Widen the spatial reconstruction to a
  // depth-aware Gaussian over 4x4 low-res samples until ~6 samples have accumulated.
  float young = (ok ? clamp(1.0 - ha.z / 6.0, 0.0, 1.0) : 1.0) * uClTemporal2.x;
  if (young > 0.0) {
    vec4 wS = vec4(0.0); float wW = 0.0;
    for (int k = 0; k < 16; k++) {
      ivec2 o = ivec2(k & 3, k >> 2) - 1;
      ivec2 ip = clamp(i0 + o, ivec2(0), lowSize - 1);
      vec2 dd = vec2(o) - f;
      float dz = abs(log2(max(texelFetch(tClMarchAux, ip, 0).y, 1e-4) / max(dFull, 1e-4)));
      float w = exp(-0.6 * dot(dd, dd)) * exp2(-min(dz * 24.0, 60.0));
      wS += texelFetch(tClMarch, ip, 0) * w; wW += w;
    }
    if (wW > 1e-12) cur = mix(cur, wS / wW, 0.8 * young);
  }
  if (ok) {
    // disocclusion: the scene surface in front of / behind the cloud changed (aircraft edges, terrain silhouettes)
    // (only depth changes that can cut into the cloud matter: beyond ~3x the cloud distance, e.g. the terrain/sky
    //  boundary at the horizon seen through near cloud, the surface is irrelevant and must not reset the history)
    float capKm = cloudKm * 3.0 + 2.0;
    float dz = abs(log2(max(min(ha.x, capKm), 1e-4) / max(min(dFull, capKm), 1e-4)));
    float reject = smoothstep(0.15, 0.5, dz);
    float exact = max(f.x, 1.0 - f.x) * max(f.y, 1.0 - f.y);   // 1 when this pixel is one of this frame's samples
    exact *= exact; exact *= exact;
    alpha = mix(uClTemporal.y, uClTemporal.z, exact);
    // young history (after a cut / disocclusion) converges as a running mean instead of an exponential one
    alpha = max(alpha, 1.0 / (1.0 + ha.z));
    // parallax the single-depth reprojection cannot represent (flying fast past/through near cloud): trust history less
    float par = uClTemporal.w / max(cloudKm * 1000.0, 1.0) * uClWindVel.w;
    alpha = max(alpha, clamp(par * 0.04 - 0.1, 0.0, 0.35));
    alpha = mix(alpha, 1.0, reject);
    cur = mix(h, cur, alpha);
    count = mix(min(ha.z + 1.0, 48.0), 1.0, reject);
  }
  oColor = max(cur, vec4(0.0));
  oAux = vec4(dFull, cloudKm, count, 1.0);
}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Round-four temporal reconstruction (temporal upsampling with accumulated sample weights).
// The round-three resolve blended the BILINEAR upsample of every low-res frame into the history with a nearly
// constant weight: the result converges to the image convolved with a tent of +-N pixels (soft for good), and the
// bilinear history fetch blurred it a little more every frame the clouds drifted. Here
//   - each low-res sample counts where it was actually taken: weight = Gaussian (sigma ~0.5 px) of the distance
//     between this pixel and the sample, summed into a per-pixel history weight W; alpha = w / (W + w). A pixel that
//     has had its own sample keeps it; the bilinear fill of the neighbours only matters while W is ~0;
//   - W is capped (lower while the pixel moves on screen) so the image keeps following the clouds;
//   - the history is fetched with a 5-tap Catmull-Rom filter (no cumulative blur under sub-pixel drift) and, while
//     moving, clamped to the range of the current low-res neighbourhood (no trails);
//   - young pixels (W < 1: boot, cut, disocclusion) shrink towards a depth-aware 4x4 Gaussian of the low-res frame,
//     so a short capture is neither dotted nor blurred for long.
export function resolveFragment({ frameGLSL, depthGLSL, N }) {
  return /* glsl */`
precision highp float; precision highp int;
#define CL_N ${N | 0}
in vec2 vUv;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oAux;
${frameGLSL}
${depthGLSL}
uniform sampler2D tClMarch, tClMarchAux, tClHist, tClHistAux;
uniform vec4 uClJitter;      // xy = this frame's sub-pixel offset (full-res px)
uniform vec4 uClTemporal;    // x = history valid, y = 1 / (2 sigma^2) of the sample kernel (px^-2), z = largest history weight, w = camera translation this frame (m)
uniform vec4 uClWindVel;     // xyz = cloud drift this frame (m, render space), w = focal length in pixels
uniform vec4 uClTemporal2;   // x = strength of the young-history spatial filter (0 = off), y = unused, z = history clamp (0 = off), w = Catmull-Rom history (0 = bilinear)
vec4 clHistory(vec2 uv) {
  if (uClTemporal2.w < 0.5) return texture(tClHist, uv);
  vec2 size = vec2(textureSize(tClHist, 0));
  vec2 sp = uv * size, tc1 = floor(sp - 0.5) + 0.5, f = sp - tc1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2, t0 = (tc1 - 1.0) / size, t3 = (tc1 + 2.0) / size, t12 = (tc1 + w2 / w12) / size;
  vec4 r = texture(tClHist, vec2(t12.x, t0.y)) * (w12.x * w0.y) + texture(tClHist, vec2(t0.x, t12.y)) * (w0.x * w12.y)
         + texture(tClHist, vec2(t12.x, t12.y)) * (w12.x * w12.y) + texture(tClHist, vec2(t3.x, t12.y)) * (w3.x * w12.y)
         + texture(tClHist, vec2(t12.x, t3.y)) * (w12.x * w3.y);
  r /= w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return vec4(max(r.rgb, vec3(0.0)), clamp(r.a, 0.0, 1.0));
}
void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  ivec2 lowSize = textureSize(tClMarch, 0);
  float dFull = min(sceneDistance(vUv) * 1e-3, 1000.0);
  vec2 g = (vec2(P) - uClJitter.xy) / float(CL_N);
  ivec2 i0 = ivec2(floor(g)); vec2 f = g - vec2(i0);
  vec4 cSum = vec4(0.0); float dSum = 0.0, wSum = 0.0, bestDz = 1e9, conf = 0.0; vec4 bestC = vec4(0.0, 0.0, 0.0, 1.0); float bestD = 40.0;
  vec4 mn = vec4(1e9), mx = vec4(-1e9);
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    ivec2 ip = clamp(i0 + o, ivec2(0), lowSize - 1);
    vec4 cc = texelFetch(tClMarch, ip, 0); vec4 a = texelFetch(tClMarchAux, ip, 0);
    float bw = (o.x == 0 ? 1.0 - f.x : f.x) * (o.y == 0 ? 1.0 - f.y : f.y);
    float dz = abs(log2(max(a.y, 1e-4) / max(dFull, 1e-4)));
    float dw = exp2(-min(dz * 24.0, 60.0));
    float w = (bw + 0.002) * dw;
    cSum += cc * w; dSum += a.x * w; wSum += w;
    vec2 dd = (vec2(o) - f) * float(CL_N);                      // this pixel -> the sample (full-res px)
    conf += exp(-dot(dd, dd) * uClTemporal.y) * dw;
    if (dw > 0.05) { mn = min(mn, cc); mx = max(mx, cc); }
    if (dz < bestDz) { bestDz = dz; bestC = cc; bestD = a.x; }
  }
  vec4 cur; float cloudKm;
  if (wSum > 1e-12) { cur = cSum / wSum; cloudKm = dSum / wSum; } else { cur = bestC; cloudKm = bestD; mn = bestC; mx = bestC; }

  // reproject: where was this piece of cloud on screen last frame?
  vec3 wp = uCameraPos + viewRay(vUv) * (cloudKm * 1000.0) - uClWindVel.xyz;
  vec4 pc = uPrevViewProj * vec4(wp, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  bool ok = uClTemporal.x > 0.5 && pc.w > 0.0 && all(greaterThan(puv, vec2(0.0))) && all(lessThan(puv, vec2(1.0)));
  vec4 h = vec4(0.0), ha = vec4(0.0);
  float W = 0.0, par = 0.0;
  if (ok) {
    h = clHistory(puv); ha = texture(tClHistAux, puv);
    // disocclusion: the scene surface in front of / behind the cloud changed (aircraft edges, terrain silhouettes)
    // (only depth changes that can cut into the cloud matter: beyond ~3x the cloud distance the surface is irrelevant)
    float capKm = cloudKm * 3.0 + 2.0;
    float dz = abs(log2(max(min(ha.x, capKm), 1e-4) / max(min(dFull, capKm), 1e-4)));
    float vel = length((puv - vUv) * vec2(textureSize(tClHist, 0)));        // screen motion of this piece of cloud (px / frame)
    // parallax the single-depth reprojection cannot represent (flying fast past / through near cloud)
    par = clamp(uClTemporal.w / max(cloudKm * 1000.0, 1.0) * uClWindVel.w * 0.04 - 0.1, 0.0, 0.35);
    W = min(ha.z, mix(uClTemporal.z, 2.0, clamp(vel * 0.7, 0.0, 1.0))) * (1.0 - smoothstep(0.15, 0.5, dz)) * (1.0 - 2.0 * par);
    if (uClTemporal2.z > 0.0 && mx.a >= mn.a) {
      // while it moves, the history may not leave the range of the current neighbourhood by much (trails, ghosts)
      vec4 pad = (mx - mn) * mix(4.0, 0.25, clamp(vel * 0.5 + par * 3.0, 0.0, 1.0)) / uClTemporal2.z + 0.01 * (mx + 0.05);
      h = clamp(h, mn - pad, mx + pad);
    }
  }
  // Young history: shrink towards a depth-aware Gaussian over 4x4 low-res samples (variance for a little blur) until
  // about one own sample has accumulated; the pixel's own sample keeps the larger share
  float young = clamp(1.0 - W / 3.0, 0.0, 1.0) * uClTemporal2.x;
  if (young > 0.0) {
    vec4 wS = vec4(0.0); float wW = 0.0;
    for (int k = 0; k < 16; k++) {
      ivec2 o = ivec2(k & 3, k >> 2) - 1;
      ivec2 ip = clamp(i0 + o, ivec2(0), lowSize - 1);
      vec2 dd = vec2(o) - f;
      float dz = abs(log2(max(texelFetch(tClMarchAux, ip, 0).y, 1e-4) / max(dFull, 1e-4)));
      float w = exp(-0.6 * dot(dd, dd)) * exp2(-min(dz * 24.0, 60.0));
      wS += texelFetch(tClMarch, ip, 0) * w; wW += w;
    }
    if (wW > 1e-12) {
      // the pixel's own sample keeps the larger share, unless its opacity disagrees with the neighbourhood (a hole
      // or a dot of one jittered sample in a thin or distant cloud)
      vec4 wide = wS / wW;
      cur = mix(cur, wide, young * mix(0.8, mix(0.35, 0.8, clamp(abs(cur.a - wide.a) * 4.0, 0.0, 1.0)), clamp(conf, 0.0, 1.0)));
    }
  }
  float wc = conf + 0.004;
  cur = mix(h, cur, ok ? max(wc / (W + wc), par) : 1.0);
  oColor = max(cur, vec4(0.0));
  oAux = vec4(dFull, cloudKm, min(W + wc, 64.0), 1.0);
}`;
}

// Final copy into the stable output texture + un-accumulated lightning glow.
export const OUTPUT_FRAG = /* glsl */`
precision highp float;
in vec2 vUv; out vec4 oColor;
uniform sampler2D tClHist, tClMarchAux; uniform vec3 uClFlashColor;
uniform vec4 uClJitter; uniform vec4 uClFullRes; uniform float uClN;
void main() {
  vec4 c = texture(tClHist, vUv);
  // low-res texel i was marched through full-res pixel i*N + jitter
  vec2 lowUv = ((vUv * uClFullRes.xy - uClJitter.xy - 0.5) / uClN + 0.5) / vec2(textureSize(tClMarchAux, 0));
  float fl = texture(tClMarchAux, lowUv).b;
  oColor = vec4(c.rgb + uClFlashColor * fl, c.a);
}`;

// ---------------------------------------------------------------------------------------------------------------
// Shadow-map bake: march the sun ray through the layer for every texel of the reference plane.
export function shadowBakeFragment({ steps }) {
  return /* glsl */`
precision highp float; precision highp int; precision highp sampler3D;
#define CL_SHADOW_STEPS ${steps | 0}
in vec2 vUv; out vec4 oColor;
${CLOUD_DENSITY_GLSL}
uniform vec4 uClBakeShadowA;   // xy = centre (air-mass m), z = size (m), w = unused
uniform vec4 uClBakeShadowB;   // xy = light slope (L.xz / L.y), z = 1 / L.y, w = unused
void main() {
  vec2 q = uClBakeShadowA.xy + (vUv - 0.5) * uClBakeShadowA.z;
  float tau = 0.0, m1 = 0.0, m2 = 0.0, y0 = 0.0;
  vec4 info;
  // Round five: with an anvil the steps near the top (~560 m apart through a 9 km storm) cut the 0.3-1.5 km thick ice
  // slab with 1-3 samples; as the slab's height drifts with the distance from the core, the count of samples inside
  // it jumps and the optical depth comes in steps: rings around every storm core, on the anvil and on the ground.
  // The last 8 steps now cover the anvil's height range evenly (from the weather map of this column), the rest the
  // towers below. (uClDet4.w = 0: round four)
  // (one layout for the whole map: a per-texel layout printed the map's texels onto sunlit tower walls as ripples;
  //  the anvil steps are jittered per texel by a fraction of a step instead, which the filtered lookups integrate)
  float aTop = 1.0, jA = 0.5;
  int nA = 0;
  if (uClShape2.z * uClDet4.w > 0.0 && uClPhys.w > 0.5) {
    aTop = 0.6; nA = CL_SHADOW_STEPS / 2;
    jA = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));    // interleaved gradient noise
  }
  for (int i = 0; i < CL_SHADOW_STEPS; i++) {
    // denser sampling near the base, where most cloud mass is
    int nB = CL_SHADOW_STEPS - nA;
    float y1;
    if (i < nB) { float u1 = float(i + 1) / float(nB); y1 = u1 * sqrt(u1) * aTop; }
    else y1 = aTop + (1.0 - aTop) * float(i + 1 - nB) / float(nA);
    float hN = mix(y0, y1, i < nB ? 0.5 : jA), dy = (y1 - y0) * uClLayer.w;
    float y = uClLayer.x + hN * uClLayer.w;
    vec3 pa = vec3(q.x + uClBakeShadowB.x * (y - uClLayer.x), y, q.y + uClBakeShadowB.y * (y - uClLayer.x));
    vec4 wx = clWeather(pa.xz, 0.0);
    // band-limit the density to the sample spacing along the slanted ray (otherwise low sun angles alias into
    // stripes): pick the noise mip whose voxel matches the spacing
    float spacing = dy * uClBakeShadowB.z;
    float d = clDensityBase(pa, wx, clamp(log2(spacing * uClNoise.x * 128.0), 1.0, 4.0), info) * info.w;
    float dt = d * uClNoise.w * 0.8 * spacing;
    tau += dt; m1 += dt * hN; m2 += dt * hN * hN;
    y0 = y1;
  }
  float mean = tau > 1e-5 ? m1 / tau : 0.0;
  float var = tau > 1e-5 ? max(m2 / tau - mean * mean, 0.0) : 0.0;
  oColor = vec4(min(tau, 200.0), mean, sqrt(var), 1.0);
}`;
}

// Weather-map bake (see weather-field.js for the field itself).
export function weatherBakeFragment(fieldGLSL) {
  return /* glsl */`
precision highp float;
in vec2 vUv; out vec4 oColor;
${fieldGLSL}
uniform vec4 uClBakeWx;   // xy = centre (air-mass m), z = size (m)
void main() { oColor = clWeatherField(uClBakeWx.xy + (vUv - 0.5) * uClBakeWx.z); }`;
}

// Cirrus texture bake (512^2, tiling): R = fibrous streaks, G,B = smooth large-scale fields for patchiness.
// Fibrous cirrus (fibratus / uncinus) are fall streaks of ice crystals drawn out by the shear into long, thin,
// slightly curved filaments that start in denser heads. The fibres here are RIDGED anisotropic noise (bright where
// the noise crosses its mean: thin lines rather than soft bands), 1:12 to 1:30 anisotropy at three scales, all
// following one smooth, curving flow field (domain warp), each scale gated by the coarser one so fibres bundle;
// dense heads sit at the upwind end of a bundle.
export const CIRRUS_BAKE_FRAG = /* glsl */`
precision highp float;
in vec2 vUv; out vec4 oColor;
uniform sampler2D tClNoise2D;
float ridge(float n) { return 1.0 - abs(2.0 * n - 1.0); }
void main() {
  vec2 p = vUv;
  vec4 w1 = texture(tClNoise2D, p + vec2(0.11, 0.37)), w2 = texture(tClNoise2D, p * 2.0 + vec2(0.53, 0.19));
  // flow: a smooth bend of the streak direction (fibres stay roughly along +x, the jet direction)
  vec2 warp = (vec2(w1.r, w1.g) - 0.5) * 0.3 + (vec2(w2.g, w2.r) - 0.5) * 0.08;
  vec2 f = p + vec2(0.0, warp.x * 0.05 + warp.y * 0.012);   // gentle bends: fibres are long and only slightly curved
  float b1 = texture(tClNoise2D, vec2(f.x * 1.0, f.y * 12.0) + vec2(warp.y, 0.0)).r;
  float b2 = texture(tClNoise2D, vec2(f.x * 1.0, f.y * 41.0) + vec2(warp.y * 2.0, 0.31)).g;
  float b3 = texture(tClNoise2D, vec2(f.x * 2.0, f.y * 113.0) + vec2(warp.y * 3.0, 0.67)).r;
  float r1 = pow(ridge(b1), 2.0), r2 = pow(ridge(b2), 4.0), r3 = pow(ridge(b3), 6.0);
  // bundles: fine fibres only inside the coarse ones
  float fib = r1 * (0.45 + 0.55 * r2) * (0.6 + 0.4 * r3) * 1.3 + 0.35 * r2 * r3 * smoothstep(0.3, 0.7, b1);
  // uncinus heads: denser tufts at the upwind (-x) end of the bundles
  float head = smoothstep(0.62, 0.9, texture(tClNoise2D, vec2(f.x * 3.0, f.y * 9.0) + 0.5).b);
  float tail = smoothstep(0.0, 0.5, texture(tClNoise2D, vec2(f.x * 3.0 + 0.04, f.y * 9.0) + 0.5).b);
  fib = fib * (0.75 + 0.6 * head) * mix(0.6, 1.0, tail);
  oColor = vec4(clamp(fib, 0.0, 1.0), w1.a, w2.b, 1.0);
}`;
