// Vegetation species table. Crown envelopes, leaf-area densities and leaf optics are the SAME numbers as the
// offline path tracer (tools/neural/veg/species.py), so the trained canopy / crown networks describe what we draw.
//
// Per species:
//   group    'broad' | 'conifer'  (selects the leaf optics and the network's conifer input)
//   shape    'cone' | 'ellip' | 'palm' | 'dome'
//   base     crown base, fraction of tree height H        rad  max crown radius, fraction of H
//   peak     height fraction (inside the crown) of the widest point ('ellip')
//   h        height range in metres (placement draws sizes in it)
//   leaf     linear albedo of the foliage (sunlit leaves, front side) ; trans = transmittance tint
//   bark     linear albedo of the bark
//   tile     foliage atlas tile used by the leaf cards
export const SPECIES = [
  { id: 'spruce',  group: 'conifer', shape: 'cone',  base: 0.08, rad: 0.20, peak: 0.0,  h: [14, 27], tile: 3, leaf: [0.046, 0.068, 0.038], bark: [0.075, 0.058, 0.045] },
  { id: 'fir',     group: 'conifer', shape: 'cone',  base: 0.12, rad: 0.24, peak: 0.0,  h: [13, 25], tile: 3, leaf: [0.042, 0.065, 0.041], bark: [0.090, 0.082, 0.072] },
  { id: 'pine',    group: 'conifer', shape: 'ellip', base: 0.52, rad: 0.20, peak: 0.45, h: [14, 26], tile: 4, leaf: [0.056, 0.075, 0.041], bark: [0.140, 0.075, 0.048] },
  { id: 'oak',     group: 'broad',   shape: 'ellip', base: 0.30, rad: 0.40, peak: 0.45, h: [10, 20], tile: 0, leaf: [0.067, 0.096, 0.045], bark: [0.085, 0.074, 0.062] },
  { id: 'beech',   group: 'broad',   shape: 'ellip', base: 0.25, rad: 0.33, peak: 0.50, h: [12, 22], tile: 1, leaf: [0.072, 0.111, 0.047], bark: [0.150, 0.150, 0.140] },
  { id: 'birch',   group: 'broad',   shape: 'ellip', base: 0.32, rad: 0.21, peak: 0.50, h: [10, 18], tile: 2, leaf: [0.090, 0.122, 0.055], bark: [0.420, 0.410, 0.390] },
  { id: 'poplar',  group: 'broad',   shape: 'ellip', base: 0.12, rad: 0.13, peak: 0.40, h: [14, 24], tile: 1, leaf: [0.066, 0.100, 0.047], bark: [0.120, 0.112, 0.095] },
  { id: 'palm',    group: 'broad',   shape: 'palm',  base: 0.82, rad: 0.30, peak: 0.30, h: [12, 22], tile: 5, leaf: [0.074, 0.101, 0.046], bark: [0.230, 0.200, 0.160] },
  { id: 'tropic',  group: 'broad',   shape: 'ellip', base: 0.42, rad: 0.42, peak: 0.62, h: [9, 18],  tile: 6, leaf: [0.054, 0.087, 0.040], bark: [0.130, 0.115, 0.095] },
  { id: 'scrub',   group: 'broad',   shape: 'dome',  base: 0.10, rad: 0.62, peak: 0.40, h: [2.5, 5], tile: 7, leaf: [0.062, 0.073, 0.043], bark: [0.110, 0.090, 0.070] },
  { id: 'desert',  group: 'broad',   shape: 'dome',  base: 0.05, rad: 0.70, peak: 0.35, h: [0.9, 2], tile: 8, leaf: [0.135, 0.138, 0.098], bark: [0.160, 0.130, 0.100] },
  { id: 'bush',    group: 'broad',   shape: 'dome',  base: 0.06, rad: 0.60, peak: 0.45, h: [2.0, 4.5], tile: 7, leaf: [0.060, 0.087, 0.042], bark: [0.090, 0.075, 0.060] },
];
export const SPECIES_INDEX = Object.fromEntries(SPECIES.map((s, i) => [s.id, i]));
export const NSPECIES = SPECIES.length;
// leaf optics of the two groups (path tracer values): rho = reflectance, tau = transmittance
export const LEAF_OPTICS = {
  broad:   { rho: [0.085, 0.160, 0.052], tau: [0.070, 0.135, 0.035] },
  conifer: { rho: [0.066, 0.118, 0.046], tau: [0.036, 0.074, 0.026] },
};
// The `leaf` colours in the table are per-species TINTS. They are rescaled here so that the mean rendered leaf
// albedo of each group (tint x mean foliage-atlas modulation) equals the path tracer's leaf reflectance rho: the
// meshes and impostors then reflect what the canopy network was trained on (shrubs / palms keep their relative tint).
const TINT_REF = {
  broad: ['oak', 'beech', 'birch', 'poplar'],
  conifer: ['spruce', 'fir', 'pine'],
};
const ATLAS_MOD = [0.93, 0.91, 0.87];    // mean of (0.45 + 1.1 R)(0.7 + 0.3 B)(dry tint) over covered atlas texels
for (const g of Object.keys(TINT_REF)) {
  const ref = [0, 1, 2].map((c) => TINT_REF[g].reduce((m, id) => m + SPECIES.find((s) => s.id === id).leaf[c], 0) / TINT_REF[g].length);
  for (const s of SPECIES) if (s.group === g) s.leaf = s.leaf.map((v, c) => +(v / ref[c] * LEAF_OPTICS[g].rho[c] / ATLAS_MOD[c]).toFixed(4));
}
export const TREE_CELL = 6.5;   // placement grid (m): at most one tree per cell, jittered inside it

/** Envelope radius (fraction of H) at crown-relative height t in [0, 1]. Same as species.py:crown_radius. */
export function crownRadius(sp, t) {
  t = Math.min(Math.max(t, 0), 1);
  if (sp.shape === 'cone') return sp.rad * Math.pow(1 - t, 0.9);
  const p = sp.peak;
  const u = t < p ? (t - p) / Math.max(p, 1e-3) : (t - p) / Math.max(1 - p, 1e-3);
  return sp.rad * Math.sqrt(Math.max(1 - u * u, 0));
}

/** Small deterministic PRNG (mulberry32). */
export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
