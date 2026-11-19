// Continuous atmospheric turbulence: Dryden-form first-order gust filters (MIL-HDBK-1797 discrete forms) driven by a
// private deterministic RNG. Gust velocities are produced in aerospace body axes (u forward, v right, w down) plus a
// roll-rate gust from the spanwise gradient of w.
export function createTurbulence(seed) {
  let a = (seed * 4294967296) >>> 0 || 0x9e3779b9;
  const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // ~N(0,1): sum of 4 uniforms (variance 4/12) rescaled
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.7320508;
  const t = {
    u: 0, v: 0, w: 0, p: 0, sigma: 0, sigmaU: 0, Lu: 533, Lw: 533,
    slow: 0, fast: 0,          // extra unit-variance noises: slow (wing-drop bias) and fast (buffet)
    rnd, gauss,
    /** Set intensity for the frame. turb: 0..1 (ctx.weather.turbulence), wind10: m/s, agl: m, alt: m MSL, weather for cloud layer. */
    configure(turb, wind10, agl, alt, weather) {
      let s = turb * (1.2 + 0.18 * wind10);
      let f = 1;
      if (agl > 1500) f = agl > 6000 ? 0.45 : 1 - 0.55 * (agl - 1500) / 4500;
      if (alt > 10000) f = Math.min(f, 0.35);
      if (weather && alt > weather.cloudBase && alt < weather.cloudTop) f *= 1 + 0.8 * (weather.cloudCoverage || 0);
      s *= f;
      const h = agl < 3 ? 3 : agl;
      if (h < 305) { const d = 0.177 + 0.0027 * h; t.sigmaU = s / Math.pow(d, 0.4); t.Lw = h < 10 ? 10 : h; t.Lu = h / Math.pow(d, 1.2); }
      else { t.sigmaU = s; t.Lw = 533; t.Lu = 533; }
      t.sigma = s;
    },
    step(dt, V, span) {
      if (t.sigma < 1e-4) {
        if (t.u !== 0 || t.v !== 0 || t.w !== 0 || t.p !== 0) { const k = Math.exp(-dt); t.u *= k; t.v *= k; t.w *= k; t.p *= k; }
      } else {
        const Ve = V > 15 ? V : 15;
        const au = Math.exp((-Ve * dt) / t.Lu), aw = Math.exp((-Ve * dt) / t.Lw);
        const su = t.sigmaU * Math.sqrt(1 - au * au), sw = t.sigma * Math.sqrt(1 - aw * aw);
        t.u = au * t.u + su * gauss(); t.v = au * t.v + su * gauss(); t.w = aw * t.w + sw * gauss();
        const sp = t.sigma * Math.sqrt((0.1 * Math.PI * Math.cbrt(Math.PI / (4 * span))) / (span * Math.pow(t.Lw, 2 / 3)));
        const ap = Math.exp((-Math.PI * Ve * dt) / (4 * span));
        t.p = ap * t.p + sp * Math.sqrt(1 - ap * ap) * gauss();
      }
      const as = Math.exp(-dt / 1.5), af = Math.exp(-dt / 0.04);
      t.slow = as * t.slow + Math.sqrt(1 - as * as) * gauss();
      t.fast = af * t.fast + Math.sqrt(1 - af * af) * gauss();
    },
    reset() { t.u = t.v = t.w = t.p = 0; t.slow = gauss(); t.fast = 0; },
  };
  return t;
}
