"""Shared atmosphere definition for the reference path tracer, the port of the classic LUT model and training.

The medium is the one in src/render/atmosphere.js / atmosphere-glsl.js (same planet, scale heights, coefficients at
the classic model's three wavelengths 680 / 550 / 440 nm), extended to a spectrum:

  Rayleigh   beta_R(lambda) = 13.558e-3 (550/lambda)^4 /km  (passes exactly through the classic 5.802 / 13.558 / 33.1e-3),
             density exp(-h / 8 km)
  aerosol    extinction e (1/km at sea level, from the weather visibility, Koschmieder), single-scattering albedo 0.92,
             grey (the classic model is grey too), density exp(-h / 1.2 km).  Phase: realistic forward-peaked mixture
             0.12 HG(0.97) [diffraction peak of the coarse mode] + 0.82 HG(0.75) + 0.06 HG(-0.3)  (asymmetry 0.71)
             instead of the classic Cornette-Shanks g = 0.78 (asymmetry 0.83, no diffraction peak).
  ozone      tent profile max(0, 1 - |h - 25| / 15), number density at the peak 5.374e18 /m^3 (the value that reproduces
             the classic 0.650 / 1.881 / 0.085e-3 /km), cross-sections of Serdyuchenko et al. (233 K) in 10 nm bins
  ground     Lambertian, albedo 0.14 (classic uAtmGroundAlbedo is 0.14/0.15/0.13)
  sun        extraterrestrial spectral irradiance (Bruneton's 10 nm table, ~1.36 kW/m^2 total), angular radius 0.2666 deg

Colour: 30 wavelengths 385..747.5 nm (12.5 nm bins) -> CIE 1931 XYZ (Wyman-Sloan-Shirley multi-lobe fit of the 2 deg
observer) -> linear sRGB (D65).
"""
import math
import numpy as np

RG = 6371.0
HT = 100.0
RT = RG + HT
H_R = 8.0
H_M = 1.2
MIE_SSA = 0.92
GROUND_ALBEDO = 0.14
SUN_RADIUS = 0.004654
BR_CLASSIC = np.array([5.802e-3, 13.558e-3, 33.1e-3])
BO_CLASSIC = np.array([0.650e-3, 1.881e-3, 0.085e-3])
CLASSIC_G = 0.78

LAMBDA = 385.0 + 12.5 * np.arange(30)
DLAMBDA = 12.5
NL = len(LAMBDA)

# --- tables at 360..830 nm, 10 nm (E. Bruneton, precomputed_atmospheric_scattering demo) --------------------------
_TAB_L = 360.0 + 10.0 * np.arange(48)
_SOLAR = np.array([
    1.11776, 1.14259, 1.01249, 1.14716, 1.72765, 1.73054, 1.6887, 1.61253, 1.91198, 2.03474, 2.02042, 2.02212,
    1.93377, 1.95809, 1.91686, 1.8298, 1.8685, 1.8931, 1.85149, 1.8504, 1.8341, 1.8345, 1.8147, 1.78158, 1.7533,
    1.6965, 1.68194, 1.64654, 1.6048, 1.52143, 1.55622, 1.5113, 1.474, 1.4482, 1.41018, 1.36775, 1.34188, 1.31429,
    1.28303, 1.26758, 1.2367, 1.2082, 1.18737, 1.14683, 1.12362, 1.1058, 1.07124, 1.04992])      # W m^-2 nm^-1
_O3 = np.array([
    1.18e-27, 2.182e-28, 2.818e-28, 6.636e-28, 1.527e-27, 2.763e-27, 5.52e-27, 8.451e-27, 1.582e-26, 2.316e-26,
    3.669e-26, 4.924e-26, 7.752e-26, 9.016e-26, 1.48e-25, 1.602e-25, 2.139e-25, 2.755e-25, 3.091e-25, 3.5e-25,
    4.266e-25, 4.672e-25, 4.398e-25, 4.701e-25, 5.019e-25, 4.305e-25, 3.74e-25, 3.215e-25, 2.662e-25, 2.238e-25,
    1.852e-25, 1.473e-25, 1.209e-25, 9.423e-26, 7.455e-26, 6.566e-26, 5.105e-26, 4.15e-26, 4.228e-26, 3.237e-26,
    2.451e-26, 2.801e-26, 2.534e-26, 1.624e-26, 1.465e-26, 2.078e-26, 1.383e-26, 7.105e-28])      # m^2
O3_PEAK = 1.881e-6 / 3.5e-25        # molecules / m^3 at the tent peak (-> 1.881e-3 /km at 550 nm)


def _g(x, mu, s1, s2):
    s = np.where(x < mu, s1, s2)
    return np.exp(-0.5 * ((x - mu) / s) ** 2)


def cie_xyz(lam):
    """CIE 1931 2-degree colour matching functions, multi-lobe Gaussian fit (Wyman, Sloan & Shirley 2013)."""
    x = 1.056 * _g(lam, 599.8, 37.9, 31.0) + 0.362 * _g(lam, 442.0, 16.0, 26.7) - 0.065 * _g(lam, 501.1, 20.4, 26.2)
    y = 0.821 * _g(lam, 568.8, 46.9, 40.5) + 0.286 * _g(lam, 530.9, 16.3, 31.1)
    z = 1.217 * _g(lam, 437.0, 11.8, 36.0) + 0.681 * _g(lam, 459.0, 26.0, 13.8)
    return np.stack([x, y, z], axis=-1)


XYZ_TO_SRGB = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]])

SOLAR = np.interp(LAMBDA, _TAB_L, _SOLAR)                    # W m^-2 nm^-1
BETA_R = 13.558e-3 * (550.0 / LAMBDA) ** 4                   # 1/km
BETA_O = np.interp(LAMBDA, _TAB_L, _O3) * O3_PEAK * 1000.0   # 1/km at the tent peak
CMF = cie_xyz(LAMBDA)                                        # (NL, 3)
# spectral radiance (per unit solar irradiance, i.e. L_lambda / E_sun_lambda) -> linear sRGB radiance (absolute,
# W-weighted luminous: Y = luminance / 683)
SPEC_TO_RGB = (SOLAR[:, None] * CMF * DLAMBDA) @ XYZ_TO_SRGB.T       # (NL, 3)
SPEC_TO_Y = SOLAR * CMF[:, 1] * DLAMBDA * 683.0                      # luminance (cd/m^2 or lux) weights
E_SUN_TOA_LUX = float(SPEC_TO_Y.sum())                               # extraterrestrial illuminance over the band


# --- density profiles ------------------------------------------------------------------------------------------------
def dens_r(h):
    return np.exp(-np.maximum(h, 0.0) / H_R)


def dens_m(h):
    return np.exp(-np.maximum(h, 0.0) / H_M)


def dens_o(h):
    return np.maximum(0.0, 1.0 - np.abs(h - 25.0) / 15.0)


# --- phase functions (sr^-1, cosTheta = dot(view ray dir, sun dir)) -----------------------------------------------------
def phase_r(c):
    return 3.0 / (16.0 * math.pi) * (1.0 + c * c)


def hg(c, g):
    d = 1.0 + g * g - 2.0 * g * c
    return (1.0 - g * g) / (4.0 * math.pi * d * np.sqrt(d))


def cornette_shanks(c, g):
    g2 = g * g
    return 0.1193662 * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * np.power(np.maximum(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5))


MIE_LOBES = ((0.12, 0.97), (0.82, 0.75), (0.06, -0.30))
PEAK_CUT_DEG = 20.0                                          # the 'aureole' part of the diffraction lobe ends here
_PEAK_CUT = hg(math.cos(math.radians(PEAK_CUT_DEG)), MIE_LOBES[0][1])


def phase_mie(c):
    return sum(w * hg(c, g) for w, g in MIE_LOBES)


def phase_peak(c):
    """Narrow part of the diffraction lobe (zero beyond PEAK_CUT_DEG): rendered per pixel as the aureole."""
    w, g = MIE_LOBES[0]
    return w * np.maximum(hg(c, g) - _PEAK_CUT, 0.0)


def mie_asymmetry():
    return sum(w * g for w, g in MIE_LOBES)


def sample_phase_mie(u1, u2):
    """Sample cosTheta from the Mie mixture."""
    cw = np.cumsum([w for w, _ in MIE_LOBES])
    gs = np.array([g for _, g in MIE_LOBES])
    idx = np.searchsorted(cw, u1 * cw[-1])
    idx = np.minimum(idx, len(gs) - 1)
    g = gs[idx]
    s = (1.0 - g * g) / (1.0 - g + 2.0 * g * u2)
    return np.clip((1.0 + g * g - s * s) / (2.0 * g), -1.0, 1.0)


def sample_phase_r(u):
    z = 4.0 * u - 2.0
    q = np.sqrt(z * z + 1.0)
    return np.clip(np.cbrt(z + q) + np.cbrt(z - q), -1.0, 1.0)


# --- geometry ------------------------------------------------------------------------------------------------------------
def altitude_at(h, mu, t):
    r = RG + h
    r1 = np.sqrt(np.maximum(r * r + t * t + 2.0 * r * t * mu, 0.0))
    return h + t * (t + 2.0 * r * mu) / (r1 + r)


def dist_to_top(h, mu):
    r = RG + h
    rmu = r * mu
    return np.maximum(0.0, -rmu + np.sqrt(np.maximum(rmu * rmu + (HT - h) * (RT + r), 0.0)))


def dist_to_ground(h, mu):
    """< 0 where the ray misses the ground."""
    r = RG + h
    rmu = r * mu
    disc = rmu * rmu - h * (2.0 * RG + h)
    return np.where((mu < 0.0) & (disc >= 0.0), -rmu - np.sqrt(np.maximum(disc, 0.0)), -1.0)


def mu_horizon(h):
    h = np.maximum(h, 0.0)
    return -np.sqrt(h * (2.0 * RG + h)) / (RG + h)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


# --- column densities toward a light, tabulated (Bruneton parameterisation, finer than the classic 256x64) -----------
class ColumnTable:
    """D_R, D_M, D_O (km of sea-level / peak-density equivalent) from altitude h along cos-zenith mu to space, plus the
    planet's shadow. Bilinear lookup in (x_mu, x_r)."""

    def __init__(self, nmu=512, nr=160, steps=600, h_m=H_M):
        H = math.sqrt(HT * (2 * RG + HT))
        xr = np.linspace(0, 1, nr)
        xm = np.linspace(0, 1, nmu)
        rho = H * xr[:, None]
        r = np.sqrt(rho * rho + RG * RG)
        h = rho * rho / (r + RG)
        dmin = HT - h
        dmax = rho + H
        d = dmin + xm[None, :] * (dmax - dmin)
        mu = np.where(d <= 0, 1.0, np.clip((H * H - rho * rho - d * d) / (2 * r * d + 1e-30), -1, 1))
        D = np.zeros((3, nr, nmu))
        for i in range(steps):          # midpoint rule in u, t = d u^2 (dense at the start, where the air is)
            u = (i + 0.5) / steps
            t = d * u * u
            dt = d * 2 * u / steps
            hs = altitude_at(h, mu, t)
            D[0] += dens_r(hs) * dt
            D[1] += np.exp(-np.maximum(hs, 0) / h_m) * dt
            D[2] += dens_o(hs) * dt
        self.D = D
        self.nmu, self.nr, self.H = nmu, nr, H

    def lookup(self, h, mu):
        """Returns (D (3, ...), visibility) for altitude h (km) toward cos-zenith mu (arrays of equal shape)."""
        h = np.clip(h, 0.0, HT)
        muH = mu_horizon(h)
        vis = smoothstep(-SUN_RADIUS, SUN_RADIUS, mu - muH)
        mu = np.maximum(mu, muH)
        H = self.H
        rho = np.sqrt(h * (2 * RG + h))
        r = RG + h
        d = dist_to_top(h, mu)
        dmin = HT - h
        dmax = rho + H
        xm = np.clip((d - dmin) / (dmax - dmin), 0, 1) * (self.nmu - 1)
        xr = np.clip(rho / H, 0, 1) * (self.nr - 1)
        i0 = np.minimum(np.floor(xm).astype(np.int64), self.nmu - 2)
        j0 = np.minimum(np.floor(xr).astype(np.int64), self.nr - 2)
        fx = xm - i0
        fy = xr - j0
        D = self.D
        out = (D[:, j0, i0] * ((1 - fx) * (1 - fy)) + D[:, j0, i0 + 1] * (fx * (1 - fy))
               + D[:, j0 + 1, i0] * ((1 - fx) * fy) + D[:, j0 + 1, i0 + 1] * (fx * fy))
        return out, vis


_TABLE = None


def column_table():
    global _TABLE
    if _TABLE is None:
        _TABLE = ColumnTable()
    return _TABLE


def spectral_optical_depth(D, mie_ext):
    """D: (3, ...) columns -> optical depth (..., NL)."""
    return (D[0][..., None] * BETA_R + np.asarray(mie_ext)[..., None] * D[1][..., None] + D[2][..., None] * BETA_O)


# --- colour normalisation ------------------------------------------------------------------------------------------------
def spec_to_rgb(L):
    """L (..., NL) per unit solar spectral irradiance -> absolute linear sRGB (W-weighted; Y channel = lum / 683)."""
    return L @ SPEC_TO_RGB


def classic_rgb_scale():
    """Per-channel factor k so that k * spec_to_rgb(sun at the zenith, sea level, Rayleigh + ozone only) equals the
    classic model's exp(-(BR D_R + BO D_O)) for a white extraterrestrial sun of 1. Everything the reference produces is
    multiplied by k, so the reference is in the sim's lighting units and the noon sun colour matches by construction
    (aerosol is grey in both models and cancels)."""
    tab = column_table()
    D, _ = tab.lookup(np.array([0.0]), np.array([1.0]))
    tau = D[0][..., None] * BETA_R + D[2][..., None] * BETA_O
    rgb = spec_to_rgb(np.exp(-tau))[0]
    classic = np.exp(-(BR_CLASSIC * D[0][0] + BO_CLASSIC * D[2][0]))
    return classic / rgb


def cct_mccamy(xyz):
    s = xyz.sum(-1)
    x, y = xyz[..., 0] / s, xyz[..., 1] / s
    n = (x - 0.3320) / (0.1858 - y)
    return 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33
