// International Standard Atmosphere (1976) to 86 km + airspeed conversions. Pure functions, no state.
// isaAtmosphere(h) -> { T [K], p [Pa], rho [kg/m^3], a [m/s] }   (pass `out` to avoid the allocation)
const R = 287.05287, GAMMA = 1.4, G0 = 9.80665, RE = 6356766;
export const P0 = 101325, T0 = 288.15, RHO0 = 1.225, A0 = 340.294;

// base geopotential altitude [m], base temperature [K], lapse rate [K/m]
const HB = [0, 11000, 20000, 32000, 47000, 51000, 71000, 84852];
const TB = [288.15, 216.65, 216.65, 228.65, 270.65, 270.65, 214.65, 186.946];
const LB = [-0.0065, 0, 0.001, 0.0028, 0, -0.0028, -0.002, 0];
const PB = [P0];
for (let i = 1; i < HB.length; i++) {
  const dh = HB[i] - HB[i - 1], L = LB[i - 1];
  PB[i] = L === 0 ? PB[i - 1] * Math.exp((-G0 * dh) / (R * TB[i - 1])) : PB[i - 1] * Math.pow(TB[i] / TB[i - 1], -G0 / (R * L));
}

export function isaAtmosphere(h, out = {}) {
  if (!(h === h)) h = 0;                       // NaN guard
  let z = (RE * h) / (RE + h);                 // geometric -> geopotential
  if (z < -2000) z = -2000; else if (z > 84852) z = 84852;
  let i = 0; while (i < 6 && z >= HB[i + 1]) i++;
  const dh = z - HB[i], L = LB[i];
  const T = TB[i] + L * dh;
  const p = L === 0 ? PB[i] * Math.exp((-G0 * dh) / (R * TB[i])) : PB[i] * Math.pow(T / TB[i], -G0 / (R * L));
  out.T = T; out.p = p; out.rho = p / (R * T); out.a = Math.sqrt(GAMMA * R * T);
  return out;
}

/** Impact pressure qc/p as a function of Mach (isentropic below M1, Rayleigh pitot formula above). */
export function impactPressureRatio(M) {
  if (M < 1) return Math.pow(1 + 0.2 * M * M, 3.5) - 1;
  const M2 = M * M;
  return (166.9215801 * M2 * M2 * M2 * M) / Math.pow(7 * M2 - 1, 2.5) - 1;
}

/** Calibrated airspeed [m/s] from true Mach number and static pressure [Pa] (what the airspeed indicator shows). */
export function casFromMach(M, p) {
  if (!(M > 0)) return 0;
  const x = (impactPressureRatio(M) * p) / P0;       // qc / p0
  if (x <= 0.892929) return A0 * Math.sqrt(5 * (Math.pow(x + 1, 2 / 7) - 1));
  let Mc = 1 + (x - 0.892929) * 0.4;                 // supersonic CAS: invert Rayleigh by fixed-point iteration
  for (let i = 0; i < 8; i++) Mc = 0.881285 * Math.sqrt((x + 1) * Math.pow(1 - 1 / (7 * Mc * Mc), 2.5));
  return A0 * Mc;
}

/** Mach number from calibrated airspeed [m/s] and static pressure [Pa] (subsonic CAS only; used by tools/trim). */
export function machFromCas(cas, p) {
  const qc = P0 * (Math.pow(1 + 0.2 * (cas / A0) * (cas / A0), 3.5) - 1);
  return Math.sqrt(5 * (Math.pow(qc / p + 1, 2 / 7) - 1));
}

/** Normal-shock total pressure recovery (pitot intake) for M >= 1. */
export function normalShockRecovery(M) {
  if (M <= 1) return 1;
  const M2 = M * M;
  return Math.pow((2.4 * M2) / (0.4 * M2 + 2), 3.5) * Math.pow(2.4 / (2.8 * M2 - 0.4), 2.5);
}
