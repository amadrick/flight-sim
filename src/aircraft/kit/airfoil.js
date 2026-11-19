// Aircraft kit — airfoil sections. An airfoil is { tc, camber(x), thick(x) } with x ∈ [0, 1] along the chord,
// camber(x) the mean line and thick(x) the HALF thickness, both in chord units. Wing stations scale the thickness
// distribution to their own t/c (`tc`), so one airfoil object can serve a whole tapered wing.

function finish(tc, camber, thick) {
  return { tc, camber, thick };
}

/** NACA 4-digit, e.g. naca4('2412') or naca4(2, 4, 12). */
export function naca4(a, b, c) {
  let m, p, t;
  if (typeof a === 'string') { m = +a[0] / 100; p = +a[1] / 10; t = +a.slice(2) / 100; } else { m = a / 100; p = b / 10; t = c / 100; }
  const thick = (x) => 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x) + 0.0012 * x * t / 0.12;
  const camber = (x) => (m === 0 || p === 0) ? 0 : (x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) * (1 - p)) * (1 - 2 * p + 2 * p * x - x * x));
  return finish(t, camber, thick);
}

/** NACA 5-digit (standard, non-reflexed) e.g. naca5('23012'). */
export function naca5(code) {
  const cl = +code[0] * 0.15, pIdx = +code[1], t = +code.slice(3) / 100;
  const tab = { 1: [0.0580, 361.4], 2: [0.1260, 51.64], 3: [0.2025, 15.957], 4: [0.2900, 6.643], 5: [0.3910, 3.230] }[pIdx] || [0.2025, 15.957];
  const r = tab[0], k1 = tab[1] * cl / 0.3;
  const thick = naca4(0, 0, t * 100).thick;
  const camber = (x) => x < r ? k1 / 6 * (x * x * x - 3 * r * x * x + r * r * (3 - r) * x) : k1 * r * r * r / 6 * (1 - x);
  return finish(t, camber, thick);
}

/**
 * Class-shape (Kulfan CST) airfoil from Bernstein weights for the upper and lower surface (lower weights negative for
 * a normal section). The basis of the supercritical / laminar approximations below; use it for any custom section.
 */
export function cst(upper, lower, te = 0.002) {
  const bern = (w, x) => { const n = w.length - 1; let s = 0, c = 1; for (let i = 0; i <= n; i++) { s += w[i] * c * Math.pow(x, i) * Math.pow(1 - x, n - i); c = c * (n - i) / (i + 1); } return s; };
  const yu = (x) => Math.sqrt(x) * (1 - x) * bern(upper, x) + x * te, yl = (x) => Math.sqrt(x) * (1 - x) * bern(lower, x) - x * te;
  let tmax = 0; for (let i = 1; i < 60; i++) tmax = Math.max(tmax, yu(i / 60) - yl(i / 60));
  return finish(tmax, (x) => 0.5 * (yu(x) + yl(x)), (x) => 0.5 * (yu(x) - yl(x)));
}

/** Supercritical transport section (flat roof, blunt nose, aft-loaded cusp), ≈ 12 % thick. Scale with the station's tc. */
export function supercritical() { return cst([0.150, 0.130, 0.205, 0.150, 0.225, 0.190], [-0.150, -0.110, -0.230, -0.060, -0.020, 0.060]); }

/** NACA 6-series-like thin laminar section with max thickness near 40–45 % chord (fighters: 64A2xx, 65A00x). camber in chord units. */
export function naca6(tc = 0.04, camberMax = 0.0) {
  const base = cst([0.11, 0.16, 0.15, 0.20, 0.12], [-0.11, -0.16, -0.15, -0.20, -0.12], 0.001);
  const k = tc / base.tc;
  return finish(tc, (x) => camberMax * 4 * x * (1 - x), (x) => base.thick(x) * k);
}

/** Biconvex (circular-arc) supersonic section with sharp edges. */
export function biconvex(tc = 0.04) { return { tc, camber: () => 0, thick: (x) => 2 * tc * x * (1 - x) + 0.0006, sharp: true }; }

/** Hexagonal / modified double-wedge supersonic section: wedges over the first and last `ramp` of the chord, flat between. */
export function hexagonal(tc = 0.04, ramp = 0.3) {
  return { tc, camber: () => 0, thick: (x) => 0.5 * tc * Math.min(1, x / ramp, (1 - x) / ramp) + 0.0006, sharp: true, breaks: [ramp, 1 - ramp] };
}

/** Flat plate with rounded edges (fences, antennas, simple fins). */
export function slab(tc = 0.03, edge = 0.08) {
  return { tc, camber: () => 0, thick: (x) => { const a = Math.min(1, x / edge), b = Math.min(1, (1 - x) / edge); return 0.5 * tc * Math.sqrt(Math.max(0, 1 - (1 - a) * (1 - a))) * Math.sqrt(Math.max(0, 1 - (1 - b) * (1 - b))) + 0.0004; } };
}
