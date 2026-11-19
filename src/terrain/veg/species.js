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
  { id: 'spruce',  group: 'conifer', shape: 'cone',  base: 0.08, rad: 0.20, peak: 0.0,  h: [14, 27], tile: 3, leaf: [0.042, 0.078, 0.032], bark: [0.075, 0.058, 0.045] },
  { id: 'fir',     group: 'conifer', shape: 'cone',  base: 0.12, rad: 0.24, peak: 0.0,  h: [13, 25], tile: 3, leaf: [0.038, 0.074, 0.036], bark: [0.090, 0.082, 0.072] },
  { id: 'pine',    group: 'conifer', shape: 'ellip', base: 0.52, rad: 0.20, peak: 0.45, h: [14, 26], tile: 4, leaf: [0.052, 0.086, 0.034], bark: [0.140, 0.075, 0.048] },
  { id: 'oak',     group: 'broad',   shape: 'ellip', base: 0.30, rad: 0.40, peak: 0.45, h: [10, 20], tile: 0, leaf: [0.062, 0.110, 0.034], bark: [0.085, 0.074, 0.062] },
  { id: 'beech',   group: 'broad',   shape: 'ellip', base: 0.25, rad: 0.33, peak: 0.50, h: [12, 22], tile: 1, leaf: [0.066, 0.128, 0.034], bark: [0.150, 0.150, 0.140] },
  { id: 'birch',   group: 'broad',   shape: 'ellip', base: 0.32, rad: 0.21, peak: 0.50, h: [10, 18], tile: 2, leaf: [0.085, 0.140, 0.040], bark: [0.420, 0.410, 0.390] },
  { id: 'poplar',  group: 'broad',   shape: 'ellip', base: 0.12, rad: 0.13, peak: 0.40, h: [14, 24], tile: 1, leaf: [0.060, 0.115, 0.036], bark: [0.120, 0.112, 0.095] },
  { id: 'palm',    group: 'broad',   shape: 'palm',  base: 0.78, rad: 0.36, peak: 0.30, h: [8, 16],  tile: 5, leaf: [0.070, 0.115, 0.034], bark: [0.160, 0.130, 0.100] },
  { id: 'tropic',  group: 'broad',   shape: 'ellip', base: 0.42, rad: 0.42, peak: 0.62, h: [10, 22], tile: 6, leaf: [0.048, 0.100, 0.030], bark: [0.130, 0.115, 0.095] },
  { id: 'scrub',   group: 'broad',   shape: 'dome',  base: 0.10, rad: 0.62, peak: 0.40, h: [2.5, 5], tile: 7, leaf: [0.060, 0.082, 0.036], bark: [0.110, 0.090, 0.070] },
  { id: 'desert',  group: 'broad',   shape: 'dome',  base: 0.05, rad: 0.70, peak: 0.35, h: [0.9, 2], tile: 8, leaf: [0.095, 0.105, 0.060], bark: [0.160, 0.130, 0.100] },
  { id: 'bush',    group: 'broad',   shape: 'dome',  base: 0.06, rad: 0.60, peak: 0.45, h: [2.0, 4.5], tile: 7, leaf: [0.055, 0.100, 0.032], bark: [0.090, 0.075, 0.060] },
];
export const SPECIES_INDEX = Object.fromEntries(SPECIES.map((s, i) => [s.id, i]));
export const NSPECIES = SPECIES.length;
// leaf optics of the two groups (path tracer values): rho = reflectance, tau = transmittance
export const LEAF_OPTICS = {
  broad:   { rho: [0.075, 0.165, 0.048], tau: [0.055, 0.150, 0.028] },
  conifer: { rho: [0.052, 0.100, 0.036], tau: [0.022, 0.060, 0.014] },
};
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
