// The procedural weather field: large-scale structure of the sky (where clouds are, how tall they grow, where it rains).
// One formula, written twice — GLSL (baked into a camera-centred 2D "weather map" every ~second) and JS (CPU queries:
// densityAt, lightning placement). Both sample the same CPU-generated tiling noise texture, so they agree.
//
// Coordinates: "air-mass" metres = world XZ minus the accumulated wind offset, so the whole field drifts with the wind.
// Map channels:  R coverage potential   G vertical development (0 flat/small .. 1 towering)
//                B precipitation cells   A slow variation (density / base raggedness)
import { saturate, smoothstep, lerp } from '../core/math.js';

// Noise layers: [period (m), rotation (rad), offset u, offset v]
const L = {
  syn:    [310e3, 0.0, 0.13, 0.71],
  syn2:   [173e3, 0.6, 0.57, 0.29],
  meso:   [61e3, 1.1, 0.31, 0.83],
  small:  [23e3, 2.3, 0.77, 0.19],
  cellS:  [31e3, 0.4, 0.21, 0.47],
  cellB:  [104e3, 1.9, 0.63, 0.05],
  devBig: [140e3, 2.8, 0.41, 0.91],
  vari:   [51e3, 0.9, 0.09, 0.37],
};
const rotUV = (name) => {
  const [p, a, ou, ov] = L[name], c = Math.cos(a) / p, s = Math.sin(a) / p;
  return { c, s, ou, ov };
};
const glslLayer = (name) => {
  const { c, s, ou, ov } = rotUV(name);
  return `(vec2(${c.toExponential(6)} * x.x - ${s.toExponential(6)} * x.y, ${s.toExponential(6)} * x.x + ${c.toExponential(6)} * x.y) + vec2(${ou}, ${ov}))`;
};

/** GLSL: vec4 clWeatherField(vec2 x) — x in air-mass metres. Needs sampler2D tClNoise2D and the uClBake* uniforms. */
export const WEATHER_FIELD_GLSL = /* glsl */`
uniform sampler2D tClNoise2D;
uniform vec4 uClBakeA;   // xy = unit vector along the cloud streets (wind direction), z = street amount, w = convective (0..1)
uniform vec4 uClBakeB;   // x = evolution time (s), y = frontal banding amount
vec4 clN(vec2 uv) { return textureLod(tClNoise2D, uv, 0.0); }
vec4 clWeatherField(vec2 x) {
  float tm = uClBakeB.x;
  // slow evolution: layers slide against each other (different speeds / directions) so the pattern morphs over ~an hour
  float syn  = clN(${glslLayer('syn')} + tm * vec2(1.1e-6, 0.4e-6)).r;
  float syn2 = clN(${glslLayer('syn2')} - tm * vec2(1.7e-6, -0.9e-6)).g;
  float meso = clN(${glslLayer('meso')} + tm * vec2(-4.0e-6, 6.0e-6)).a;
  float small = clN(${glslLayer('small')} + tm * vec2(1.3e-5, 0.7e-5)).r;
  float m = syn * 0.42 + syn2 * 0.3 + meso * 0.28;
  m = clamp(0.5 + (m - 0.5) * 2.3, 0.0, 1.0);
  // cloud streets: rows parallel to the wind, a few km apart (horizontal convective rolls)
  vec2 sd = uClBakeA.xy; float along = dot(x, sd), across = dot(x, vec2(-sd.y, sd.x));
  float st = clN(vec2(along / 150e3, across / 30e3) + vec2(0.37, 0.59) + tm * vec2(2.0e-6, 0.0)).a;
  m = mix(m, clamp(m * 0.55 + st * 0.62 - 0.08, 0.0, 1.0), uClBakeA.z);
  m = clamp(m + (small - 0.5) * 0.3, 0.0, 1.0);
  // vertical development: cellular (convective cells), bigger cells when the air mass is unstable
  float cs = clN(${glslLayer('cellS')} + tm * vec2(5.0e-6, -3.0e-6)).b;
  float cb = clN(${glslLayer('cellB')} + tm * vec2(-1.2e-6, 1.6e-6)).b;
  float big = clN(${glslLayer('devBig')}).g;
  float dev = clamp(mix(cs, cb, uClBakeA.w) * 0.62 + big * 0.38 + (m - 0.5) * 0.35, 0.0, 1.0);
  float rain = clamp((dev - 0.42) * 3.2, 0.0, 1.0) * clamp((m - 0.3) * 3.5, 0.0, 1.0);
  float vari = clN(${glslLayer('vari')} + tm * vec2(3.0e-6, 2.0e-6)).r;
  return vec4(m, dev, rain, vari);
}`;

/** JS mirror of clWeatherField. `noise.sample(u, v, out4)` is the CPU bilinear sampler. bake = { sx, sz, streets, convective, time }. */
export function makeWeatherFieldJS(noise) {
  const t4 = [0, 0, 0, 0];
  const lay = {}; for (const k in L) lay[k] = rotUV(k);
  const N = (name, x, z, du, dv, ch) => {
    const l = lay[name];
    return noise.sample(l.c * x - l.s * z + l.ou + du, l.s * x + l.c * z + l.ov + dv, t4)[ch];
  };
  return function weatherField(x, z, bake, out) {
    const tm = bake.time;
    const syn = N('syn', x, z, tm * 1.1e-6, tm * 0.4e-6, 0);
    const syn2 = N('syn2', x, z, -tm * 1.7e-6, tm * 0.9e-6, 1);
    const meso = N('meso', x, z, -tm * 4.0e-6, tm * 6.0e-6, 3);
    const small = N('small', x, z, tm * 1.3e-5, tm * 0.7e-5, 0);
    let m = saturate(0.5 + (syn * 0.42 + syn2 * 0.3 + meso * 0.28 - 0.5) * 2.3);
    const along = x * bake.sx + z * bake.sz, across = -x * bake.sz + z * bake.sx;
    const st = noise.sample(along / 150e3 + 0.37 + tm * 2.0e-6, across / 30e3 + 0.59, t4)[3];
    m = lerp(m, saturate(m * 0.55 + st * 0.62 - 0.08), bake.streets);
    m = saturate(m + (small - 0.5) * 0.3);
    const cs = N('cellS', x, z, tm * 5.0e-6, -tm * 3.0e-6, 2);
    const cb = N('cellB', x, z, -tm * 1.2e-6, tm * 1.6e-6, 2);
    const big = N('devBig', x, z, 0, 0, 1);
    const dev = saturate(lerp(cs, cb, bake.convective) * 0.62 + big * 0.38 + (m - 0.5) * 0.35);
    const rain = saturate((dev - 0.42) * 3.2) * saturate((m - 0.3) * 3.5);
    const vari = N('vari', x, z, tm * 3.0e-6, tm * 2.0e-6, 0);
    out.m = m; out.dev = dev; out.rain = rain; out.vari = vari;
    return out;
  };
}

/**
 * Derive the cloud-model parameters from ctx.weather's (smoothed) numbers. Everything is a continuous function of
 * coverage / base / top / precipitation / lightning so preset transitions morph instead of popping.
 */
const PROF_SHALLOW = [0.75, 0.3, 2, 1.0], PROF_DEEP = [0.75, 0.7, 4, 0.4];   // [gb, hp, k, p]
export function deriveWeatherParams(w, out = {}) {
  const cov = saturate(w.cloudCoverage);
  const base = w.cloudBase, top = Math.max(w.cloudTop, base + 300), th = top - base;
  const convective = saturate(Math.max(w.lightning, smoothstep(4500, 7500, th)));
  const stratus = smoothstep(0.72, 0.92, cov) * (1 - convective);
  out.coverage = cov; out.base = base; out.top = top; out.thickness = th;
  out.convective = convective; out.stratus = stratus;
  // local coverage c = saturate(covBias + (map.r - 0.5) * covAmp): the map modulates strongly in broken skies,
  // weakly when overcast; gated to zero for clear skies.
  out.covAmp = lerp(lerp(1.0, 0.3, smoothstep(0.3, 0.95, cov)), 0.7, convective * smoothstep(0.5, 0.9, cov));
  out.covBias = (cov * 0.9 + 0.06 - 0.1 * convective) * smoothstep(0.0, 0.12, cov);
  // local layer depth available to the least-developed cells (their actual height then follows the noise peak)
  const minTopM = Math.min(th, lerp(900 + 700 * cov, 0.7 * th, stratus) + w.precipitation * 1500);
  out.topMin = minTopM / th;
  out.taperLo = lerp(0.42, 0.3, stratus);                 // height penalty for undeveloped / fully developed cells
  out.taperHi = lerp(0.3, 0.14, convective);
  // development thresholds on map.g: few towers in fair weather, many when convective
  out.devLo = lerp(lerp(0.5, 0.38, smoothstep(0.2, 0.7, cov)), 0.5, convective);
  out.devHi = lerp(0.98, 0.72, convective);
  out.anvil = convective;
  out.baseRamp = lerp(90, 420, stratus);                 // metres over which the base fades in (flat cumulus bases, ragged stratus)
  // extinction (1/m) at density 1. Round four: cumulus 0.028 -> 0.075 (mean free path 36 m -> 13 m; measured in
  // real cumulus: 0.05-0.13). With 36 m the 20-60 m lobes of the detail cascade were translucent: cotton wool.
  out.sigma = lerp(0.075, 0.03, stratus) * (1 + 0.2 * convective);
  out.erosion = lerp(0.28, 0.14, stratus);       // surface displacement by the detail noise, in shape units
  // cumulus cells (see clShape): depth / diameter of undeveloped and developed cells (humilis ~0.5, congestus ~1.5+),
  // stratocumulus sheet at the base in broken skies, width profile fitted to the LES (tools/neural/les_stats.py)
  out.aspectLo = lerp(1.0, 1.1, convective);
  out.aspectHi = lerp(2.0, 3.0, convective);
  out.sheet = smoothstep(0.5, 0.68, cov) * (1 - smoothstep(0.8, 0.92, cov)) * (1 - convective);
  // g(h) = [gb + (1 - gb)(1 - (1 - h / hp)^k)] [1 - ((h - hp) / (1 - hp))^2]^p, fitted to the LES (results/profile_fit.json):
  // shallow trade cumulus (BOMEX) and congestus; mixed by the local development in the shader
  out.profShallow = PROF_SHALLOW; out.profDeep = PROF_DEEP;
  out.turret = 2.6; out.lobes = 0.35;           // turret / lobe amplitude (x cell radius)
  out.precip = saturate(w.precipitation);
  out.streets = (1 - smoothstep(0.45, 0.7, cov)) * smoothstep(0.05, 0.2, cov);
  out.cirrus = saturate(w.cirrus);
  out.lightning = saturate(w.lightning);
  return out;
}

/**
 * CPU cloud density (0..1, before detail erosion) at an air-mass position. Mirrors clDensityBase() in shaders.js
 * (without the billow modulation of the layer shape and the anvil details).
 * p = derived params, wf = weatherField sample, n = base-noise RGBA at that point, y = altitude,
 * cl = cell-field RGBA at the leaned / warped position, cells = { dMin, dMax }.
 */
export function densityFromField(p, wf, n, y, cl, cells) {
  const shape = n[0];
  const hN = (y - p.base) / p.thickness;
  if (hN <= 0 || hN >= 1) return 0;
  let cov = saturate(p.covBias + (wf.m - 0.5) * p.covAmp);
  if (cov < 0.01) return 0;
  const dev = smoothstep(p.devLo, p.devHi, wf.dev);
  let topN = lerp(p.topMin, 1, dev);
  if (p.anvil > 0) {            // stepped cumulonimbus towers (clShape, round four)
    const dn = dev + 0.3 * (n[0] - 0.5) + 0.12 * (n[1] - 0.5);
    topN = lerp(topN, p.topMin + (0.5 - p.topMin) * smoothstep(0.15, 0.4, dn) + 0.5 * smoothstep(0.5, 0.7, dn), p.anvil);
  }
  const hRel = hN / topN;
  const am = p.anvil * smoothstep(p.devLo - 0.17, p.devLo + 0.03, wf.dev);
  const lid = 0.89 + 0.06 * (wf.vari - 0.5) + 0.05 * smoothstep(0.8, 1.0, dev), aThick = 0.035 + 0.15 * am * am;
  const anvil = am > 0.001 ? smoothstep(lid - aThick - 0.025, lid - aThick + 0.025, hN) : 0;
  const bottom = saturate((hN * p.thickness) / p.baseRamp);
  let prof = lerp(hRel * hRel, smoothstep(0.65, 1.0, hRel) + 4 * Math.max(hRel - 1, 0), p.stratus);
  prof *= lerp(p.taperLo, p.taperHi, dev);
  const exL = shape * bottom - Math.max(1 - cov, 0.22 * p.stratus) - prof;
  // cumulus cell
  const h = y - p.base;
  const rad = 0.5 * cells.dMin * Math.pow(cells.dMax / cells.dMin, cl[1]);
  const vig = saturate((cov * 1.45 - cl[2]) * 8), grow = lerp(0.55, 1, vig) + 1.4 * Math.max(cov - 0.62, 0);
  const H = Math.min(2 * rad * lerp(p.aspectLo, p.aspectHi, dev) * lerp(0.75, 1.25, cl[3]) * (0.6 + 0.4 * vig), 0.8 * lid * p.thickness);
  const hc = h / Math.max(H * lerp(1, 0.4, p.sheet * (1 - dev)), 1);
  const pf = p.profShallow.map((v, i) => lerp(v, p.profDeep[i], dev));
  const g = (pf[0] + (1 - pf[0]) * (1 - Math.pow(1 - Math.min(hc / pf[1], 1), pf[2])))
          * Math.pow(saturate(1 - Math.pow(saturate((hc - pf[1]) / (1 - pf[1])), 2)), pf[3]);
  const wb = n[1] * 0.6 + n[2] * 0.4, bil = (Math.sqrt(saturate(2 * wb - wb * wb)) - 0.8) * p.turret + (n[0] - 0.5) * p.lobes;
  const rS = rad * grow * (g + bil * lerp(0.35, 1, saturate(hc * 1.6)));
  const d = rad * (2 - 2 * cl[0]);
  let ex = vig > 0 ? (rS - d) * 1e-3 - (cl[0] <= 0.002 ? 1 : 0) - (1 - bottom) * 0.4 - Math.max(hc - 1, 0) * H * 3e-3 : -1;
  const layerW = Math.max(p.stratus, p.anvil);
  ex = lerp(ex, -1, layerW);
  if (p.sheet > 0) {
    const hs = hN / Math.min(620 / p.thickness, 1);
    const exS = shape * bottom - Math.max(1.05 - cov, 0.12) - (smoothstep(0.55, 1, hs) * 0.6 + 4 * Math.max(hs - 1, 0)) * 0.5;
    if (exS * p.sheet > ex) ex = lerp(-0.4, exS, p.sheet);
  }
  if (layerW > 0) {
    const exLw = lerp(-0.4, exL, layerW);
    if (exLw > ex || p.stratus > 0.5) ex = lerp(ex, exL, p.stratus > 0.5 ? p.stratus : 1);
  }
  ex = lerp(ex, shape - (1 - 0.95 * am), anvil) - 3 * saturate((hN - lid) * 14);
  return saturate(ex / 0.06);
}
