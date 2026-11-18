// Ocean wave spectrum (pure JS, no three.js) — shared by the GPU FFT initialisation, the CPU heightAt() and the
// slope-variance tables used for footprint-filtered sun glitter.
//
// References:
//  - J. Tessendorf, "Simulating Ocean Water" (2001): statistical FFT ocean, h~(k,t), choppy displacement, dispersion
//    quantisation so the field is periodic in time (we use T = 1000 s, which also keeps float32 phases exact).
//  - C. Horvath, "Empirical directional wave spectra for computer graphics" (DigiPro 2015): JONSWAP (fetch-limited)
//    + Donelan-Banner directional spreading + a separate narrow swell component.
//  - E. Bruneton, F. Neyret, N. Holzschuch, "Real-time Realistic Ocean Lighting using Seamless Transitions from
//    Geometry to BRDF" (EG 2010): slope variance that a mip level cannot resolve is computed from the spectrum and
//    moved into the BRDF roughness -> no glitter aliasing at distance.
//
// Conventions: wave vector k = (kx, kz) in WORLD axes (x east, z south), metres^-1. Grid index n in [0, N) maps to
// frequency m = n < N/2 ? n : n - N (standard FFT order) so the inverse FFT needs no sign flips:
//   h(x, t) = sum_k h~(k, t) exp(i k.x),  h~(k, t) = h0(k) e^{-i w t} + conj(h0(-k)) e^{+i w t}  (travels along +k).

export const G = 9.81;
export const TIME_PERIOD = 1000;                 // s; dispersion is quantised to multiples of 2pi/T
export const OMEGA0 = (2 * Math.PI) / TIME_PERIOD;
export const FETCH = 150000;                     // m (open-ocean wind fetch)
export const SPREAD_BLEND = 0.2;                 // Horvath 2015 'spread blend' toward isotropic: short-crested seas

/** quantised deep-water dispersion (integer multiple of OMEGA0, returned as the integer multiplier) */
export function dispersionIndex(k) { return Math.floor(Math.sqrt(G * k) / OMEGA0); }

/** JONSWAP frequency spectrum S(w) [m^2 s] for 10 m wind U (m/s), fetch F (m). Clamped to the Pierson-Moskowitz limit. */
export function jonswapParams(U, F = FETCH) {
  U = Math.max(U, 0.5);
  const wpJ = 22 * Math.pow((G * G) / (U * F), 1 / 3);
  const wpPM = (0.855 * G) / U;
  const wp = Math.max(wpJ, wpPM);
  const alpha = Math.max(0.076 * Math.pow((U * U) / (F * G), 0.22), 0.0081);
  return { wp, alpha, gamma: 3.3 };
}
export function jonswap(w, p) {
  if (w <= 1e-4) return 0;
  const sigma = w <= p.wp ? 0.07 : 0.09;
  const r = Math.exp(-((w - p.wp) ** 2) / (2 * sigma * sigma * p.wp * p.wp));
  return ((p.alpha * G * G) / w ** 5) * Math.exp(-1.25 * (p.wp / w) ** 4) * Math.pow(p.gamma, r);
}

/** Donelan-Banner directional spreading D(w, theta), normalised over theta in [-pi, pi]. */
export function donelanBanner(w, wp, theta) {
  const r = w / wp;
  let beta;
  if (r < 0.95) beta = 2.61 * Math.pow(r, 1.3);
  else if (r < 1.6) beta = 2.28 * Math.pow(r, -0.65);
  else beta = Math.pow(10, -0.4 + 0.8393 * Math.exp(-0.567 * Math.log(r * r)));
  const s = 1 / Math.cosh(beta * theta);
  return (beta / (2 * Math.tanh(beta * Math.PI))) * s * s;
}

// cos^{2s}(theta/2) spreading for swell, normalised numerically
const SWELL_S = 6;
let swellNorm = 0;
{ const n = 2048; let sum = 0; for (let i = 0; i < n; i++) { const t = -Math.PI + ((i + 0.5) / n) * 2 * Math.PI; sum += Math.pow(Math.abs(Math.cos(t / 2)), 2 * SWELL_S); } swellNorm = 1 / (sum * (2 * Math.PI / n)); }
const swellD = (theta) => swellNorm * Math.pow(Math.abs(Math.cos(theta / 2)), 2 * SWELL_S);

/** m0 of a unit-alpha JONSWAP with given wp/gamma (for scaling the swell to a target Hs) */
function jonswapM0(p) { let m0 = 0; const n = 600; const a = p.wp * 0.4, b = p.wp * 6; const dw = (b - a) / n; for (let i = 0; i < n; i++) m0 += jonswap(a + (i + 0.5) * dw, p) * dw; return m0; }

const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };

/**
 * Sea state from wind. windSpeed m/s at 10 m, windAngle = atan2(dirZ, dirX) of the direction the air (and the waves) move.
 * Returns an object with psi(kx, kz) = 2D wavenumber spectrum [m^4] (variance = sum psi dk^2).
 */
export function makeSeaState(windSpeed, windAngle) {
  const U = Math.max(0.5, windSpeed);
  const wind = jonswapParams(U);
  // Swell: long, narrow, from ~35 deg off the local wind, present even on calm days (open-ocean look).
  const swellHs = 0.5 + 0.03 * U;
  const swell = { wp: Math.sqrt((G * 2 * Math.PI) / 170), alpha: 1, gamma: 3.3 };
  swell.alpha = (swellHs / 4) ** 2 / jonswapM0(swell);
  const swellAngle = windAngle + 0.6;
  const psi = (kx, kz) => {
    const k = Math.hypot(kx, kz);
    if (k < 1e-6) return 0;
    const w = Math.sqrt(G * k);
    const dwdk = G / (2 * w);
    const th = Math.atan2(kz, kx);
    const sw = jonswap(w, wind) * (donelanBanner(w, wind.wp, wrapPi(th - windAngle)) * (1 - SPREAD_BLEND) + SPREAD_BLEND / (2 * Math.PI));
    const ss = jonswap(w, swell) * swellD(wrapPi(th - swellAngle));
    return (sw + ss) * dwdk / k;
  };
  return { U, windAngle, wind, swell, swellAngle, swellHs, swellNorm, swellS: SWELL_S, psi };
}

/** Deterministic standard normal pairs (Box-Muller) from a seed, length 2*count. */
export function gaussianField(count, seed) {
  let a = seed >>> 0;
  const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const u1 = Math.max(1e-7, rnd()), u2 = rnd();
    const r = Math.sqrt(-2 * Math.log(u1));
    out[i * 2] = r * Math.cos(2 * Math.PI * u2); out[i * 2 + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  return out;
}

/**
 * Fill h0 for one cascade. Returns Float32Array(N*N*4): (h0.re, h0.im, conj(h0(-k)).re, conj(h0(-k)).im)
 * Only |k| in [kLo, kHi) is kept so the cascades partition the spectrum.
 * Also returns the slope-variance-per-mip table in the wind frame (upwind, crosswind) for Bruneton filtering.
 */
export function buildCascade(sea, N, L, kLo, kHi, gauss, out = new Float32Array(N * N * 4)) {
  const dk = (2 * Math.PI) / L;
  const amp = new Float32Array(N * N * 2);
  const levels = Math.log2(N) + 1;
  const varRes = new Float64Array(levels * 2);   // resolved (upwind, crosswind) slope variance per mip level
  const cu = Math.cos(sea.windAngle), su = Math.sin(sea.windAngle);
  let varH = 0;
  for (let j = 0; j < N; j++) {
    const mz = j < N / 2 ? j : j - N;
    for (let i = 0; i < N; i++) {
      const mx = i < N / 2 ? i : i - N;
      const kx = mx * dk, kz = mz * dk, k = Math.hypot(kx, kz);
      const idx = j * N + i;
      if (k < kLo || k >= kHi || k === 0 || mx === -N / 2 || mz === -N / 2) { amp[idx * 2] = 0; amp[idx * 2 + 1] = 0; continue; }
      const E = sea.psi(kx, kz) * dk * dk;            // expected |h~(k)|^2 (both h0 terms)
      const s = Math.sqrt(E / 2) / Math.SQRT2;
      amp[idx * 2] = gauss[idx * 2] * s; amp[idx * 2 + 1] = gauss[idx * 2 + 1] * s;
      varH += E;
      const ku = kx * cu + kz * su, kc = -kx * su + kz * cu;
      const mm = Math.max(Math.abs(mx), Math.abs(mz));
      for (let l = 0; l < levels; l++) {           // level l resolves |m| < N / 2^(l+1)
        if (mm >= N / 2 ** (l + 1)) break;
        varRes[l * 2] += ku * ku * E; varRes[l * 2 + 1] += kc * kc * E;
      }
    }
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const idx = j * N + i, nidx = ((N - j) % N) * N + ((N - i) % N);
    out[idx * 4] = amp[idx * 2]; out[idx * 4 + 1] = amp[idx * 2 + 1];
    out[idx * 4 + 2] = amp[nidx * 2]; out[idx * 4 + 3] = -amp[nidx * 2 + 1];
  }
  return { h0: out, varRes, varH, amp };
}

/** Slope variance (upwind, crosswind) of the spectrum for |k| in [k0, k1] (numerical polar integration). */
export function tailSlopeVariance(sea, k0, k1) {
  const nk = 96, nt = 48; let vu = 0, vc = 0;
  const l0 = Math.log(k0), l1 = Math.log(k1);
  for (let a = 0; a < nk; a++) {
    const k = Math.exp(l0 + ((a + 0.5) / nk) * (l1 - l0));
    const dkk = k * (l1 - l0) / nk;
    for (let b = 0; b < nt; b++) {
      const t = -Math.PI + ((b + 0.5) / nt) * 2 * Math.PI;
      const ku = k * Math.cos(t), kc = k * Math.sin(t);
      const kx = ku * Math.cos(sea.windAngle) - kc * Math.sin(sea.windAngle);
      const kz = ku * Math.sin(sea.windAngle) + kc * Math.cos(sea.windAngle);
      const e = sea.psi(kx, kz) * k * dkk * (2 * Math.PI / nt);
      vu += ku * ku * e; vc += kc * kc * e;
    }
  }
  return [vu, vc];
}

/** Cox & Munk (1954) clean-surface slope variances (upwind, crosswind) for comparison / floor. */
export function coxMunk(U) { return [0.00316 * U, 0.003 + 0.00192 * U]; }

/**
 * Pick the strongest components (half-plane, so each pair is counted once and doubled) for CPU height queries.
 * Returns Float64Array of [kx, kz, wIndex, re, im, reM, imM] * count.
 */
export function strongestComponents(cascades, count) {
  const cand = [];
  for (const c of cascades) {
    const { N, L, h0 } = c, dk = (2 * Math.PI) / L;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const mx = i < N / 2 ? i : i - N, mz = j < N / 2 ? j : j - N;
      if (mz < 0 || (mz === 0 && mx <= 0)) continue;
      const idx = (j * N + i) * 4;
      const e = h0[idx] ** 2 + h0[idx + 1] ** 2 + h0[idx + 2] ** 2 + h0[idx + 3] ** 2;
      if (e > 0) cand.push([e, mx * dk, mz * dk, h0[idx], h0[idx + 1], h0[idx + 2], h0[idx + 3]]);
    }
  }
  cand.sort((a, b) => b[0] - a[0]);
  const n = Math.min(count, cand.length), out = new Float64Array(n * 7);
  for (let q = 0; q < n; q++) {
    const c = cand[q];
    out.set([c[1], c[2], dispersionIndex(Math.hypot(c[1], c[2])), c[3], c[4], c[5], c[6]], q * 7);
  }
  return out;
}

/** Height (m) at world (x, z), time t (s) from a component list (approximation of the GPU field). */
export function evalHeight(comps, x, z, t) {
  const tf = (t % TIME_PERIOD) / TIME_PERIOD;
  let h = 0;
  for (let q = 0; q < comps.length; q += 7) {
    const kx = comps[q], kz = comps[q + 1];
    const wt = 2 * Math.PI * ((comps[q + 2] * tf) % 1);
    const cw = Math.cos(wt), sw = Math.sin(wt);
    // h~ = h0 e^{-iwt} + h0m e^{iwt}
    const re = comps[q + 3] * cw + comps[q + 4] * sw + comps[q + 5] * cw - comps[q + 6] * sw;
    const im = comps[q + 4] * cw - comps[q + 3] * sw + comps[q + 6] * cw + comps[q + 5] * sw;
    const ph = kx * x + kz * z;
    h += 2 * (re * Math.cos(ph) - im * Math.sin(ph));
  }
  return h;
}

/**
 * Cumulative slope variance (upwind, crosswind) for |k| < K on a log grid: returns { ks, cu, cc } with
 * cu[i] = variance of components with |k| < ks[i]. Cheap (~4k spectrum evaluations).
 */
export function slopeCDF(sea, kMin = 1e-3, kMax = 2 * Math.PI / 0.01, nk = 120, nt = 24) {
  const ks = new Float64Array(nk + 1), cu = new Float64Array(nk + 1), cc = new Float64Array(nk + 1);
  const l0 = Math.log(kMin), l1 = Math.log(kMax);
  const ca = Math.cos(sea.windAngle), sa = Math.sin(sea.windAngle);
  ks[0] = kMin;
  for (let a = 0; a < nk; a++) {
    const kA = Math.exp(l0 + (a / nk) * (l1 - l0)), kB = Math.exp(l0 + ((a + 1) / nk) * (l1 - l0));
    const k = Math.sqrt(kA * kB), dkk = kB - kA;
    let vu = 0, vc = 0;
    for (let b = 0; b < nt; b++) {
      const t = -Math.PI + ((b + 0.5) / nt) * 2 * Math.PI;
      const ku = k * Math.cos(t), kc = k * Math.sin(t);
      const e = sea.psi(ku * ca - kc * sa, ku * sa + kc * ca) * k * dkk * (2 * Math.PI / nt);
      vu += ku * ku * e; vc += kc * kc * e;
    }
    ks[a + 1] = kB; cu[a + 1] = cu[a] + vu; cc[a + 1] = cc[a] + vc;
  }
  return { ks, cu, cc };
}
export function cdfAt(cdf, k, out, o = 0) {
  const { ks, cu, cc } = cdf, n = ks.length - 1;
  if (k <= ks[0]) { out[o] = 0; out[o + 1] = 0; return out; }
  if (k >= ks[n]) { out[o] = cu[n]; out[o + 1] = cc[n]; return out; }
  const f = (Math.log(k) - Math.log(ks[0])) / (Math.log(ks[n]) - Math.log(ks[0])) * n;
  const i = Math.min(n - 1, Math.floor(f)), t = f - i;
  out[o] = cu[i] + (cu[i + 1] - cu[i]) * t; out[o + 1] = cc[i] + (cc[i + 1] - cc[i]) * t;
  return out;
}

/**
 * Bruneton-style unresolved slope variance tables. cascades: [{ N, L, kLo, kHi }].
 * Returns { table: Float32Array(cascades * LEVELS * 2), tail: [u, c] } where table[(c*LEVELS + l)*2 + {0,1}] is the
 * variance of cascade c that mip level l can NOT represent (to be added to the BRDF roughness), and tail is the variance
 * of everything finer than the last cascade (calibrated up to the Cox-Munk capillary total).
 */
export const LEVELS = 10;
export function varianceTables(sea, cascades, out = new Float32Array(cascades.length * LEVELS * 2)) {
  const cdf = slopeCDF(sea);
  const a = [0, 0], b = [0, 0], r = [0, 0];
  let resU = 0, resC = 0;
  cascades.forEach((c, ci) => {
    cdfAt(cdf, c.kLo, a); cdfAt(cdf, c.kHi, b);
    const totU = b[0] - a[0], totC = b[1] - a[1];
    resU += totU; resC += totC;
    const dk = (2 * Math.PI) / c.L;
    for (let l = 0; l < LEVELS; l++) {
      // mip level l represents |m| < N / 2^(l+1) along each axis; circle of equal area
      const kl = 1.128 * dk * c.N / 2 ** (l + 1);
      cdfAt(cdf, Math.max(c.kLo, Math.min(c.kHi, kl)), r);
      out[(ci * LEVELS + l) * 2] = Math.max(0, totU - (r[0] - a[0]));
      out[(ci * LEVELS + l) * 2 + 1] = Math.max(0, totC - (r[1] - a[1]));
    }
  });
  const last = cascades[cascades.length - 1];
  cdfAt(cdf, last.kHi, a); cdfAt(cdf, 1e9, b);
  const cm = coxMunk(sea.U);
  const tail = [Math.max(b[0] - a[0], cm[0] - resU, 0.002), Math.max(b[1] - a[1], cm[1] - resC, 0.002)];
  return { table: out, tail, resolved: [resU, resC] };
}

/**
 * Strongest few components (exactly the GPU's h0 values: same gaussian field, same spectrum) for CPU heightAt().
 * Searches low |m| of the given cascades. gauss[c] = Float32Array(N*N*2) as uploaded to the GPU.
 */
export function componentsFor(sea, cascades, gauss, count = 64, mMax = 20, out = []) {
  const cand = [];
  cascades.forEach((c, ci) => {
    const { N, L, kLo, kHi } = c, dk = (2 * Math.PI) / L, g = gauss[ci];
    const amp = (mx, mz) => {
      const kx = mx * dk, kz = mz * dk, k = Math.hypot(kx, kz);
      if (k < kLo || k >= kHi || k === 0 || mx === -N / 2 || mz === -N / 2) return 0;
      return Math.sqrt(sea.psi(kx, kz) * dk * dk / 2) / Math.SQRT2;
    };
    for (let mz = 0; mz <= mMax; mz++) for (let mx = -mMax; mx <= mMax; mx++) {
      if (mz === 0 && mx <= 0) continue;
      const i = (mx + N) % N, j = mz, ni = (N - i) % N, nj = (N - j) % N;
      const a0 = amp(mx, mz), a1 = amp(-mx, -mz);
      if (a0 === 0 && a1 === 0) continue;
      const idx = (j * N + i) * 2, nidx = (nj * N + ni) * 2;
      const re = g[idx] * a0, im = g[idx + 1] * a0, reM = g[nidx] * a1, imM = -g[nidx + 1] * a1;
      cand.push([re * re + im * im + reM * reM + imM * imM, mx * dk, mz * dk, re, im, reM, imM]);
    }
  });
  cand.sort((x, y) => y[0] - x[0]);
  const n = Math.min(count, cand.length);
  const arr = out.length === n * 7 ? out : new Float64Array(n * 7);
  for (let q = 0; q < n; q++) { const c = cand[q]; arr.set([c[1], c[2], dispersionIndex(Math.hypot(c[1], c[2])), c[3], c[4], c[5], c[6]], q * 7); }
  return arr;
}
