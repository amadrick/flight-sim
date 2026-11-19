"""Cloud-droplet phase function used by the reference solver AND by the deployed GLSL.

Choice: the Jendersie & d'Eon (SIGGRAPH 2023 Talks, "An Approximate Mie Scattering Function for
Fog and Cloud Rendering") fit to Lorenz-Mie scattering of water droplets: a mixture of a
Henyey-Greenstein lobe (the diffraction peak) and a Draine lobe (the broad body + back-scatter rise).
Their closed-form parameter fit for droplet diameters 5 um < d < 50 um is evaluated at
d = 10 um (effective radius 5 um: fair-weather continental cumulus).  It reproduces the Mie
asymmetry parameter (g ~ 0.86) *and* the narrow forward peak (~590 sr^-1), which a single HG
(peak 6.5 sr^-1 at g = 0.85) or the usual game "two-lobe HG" cannot.

    p(mu) = (1 - W_D) * HG(mu; G_HG) + W_D * Draine(mu; G_D, ALPHA)
    Draine(mu; g, a) = 1/(4 pi) * (1 - g^2) / (1 + g^2 - 2 g mu)^1.5 * (1 + a mu^2) / (1 + a (1 + 2 g^2) / 3)

Everything here is plain python/numpy + numba-jitted scalar versions.
"""
import math
import numpy as np
try:
    from numba import njit
except ImportError:          # numpy-only machines: the jitted scalar versions run as plain python
    def njit(*a, **k):
        return (lambda f: f) if not (len(a) == 1 and callable(a[0])) else a[0]

DROPLET_DIAMETER_UM = 10.0


def mie_fit_params(d):
    """Jendersie & d'Eon 2023, eq. for 5 um <= d <= 50 um."""
    g_hg = math.exp(-0.0990567 / (d - 1.67154))
    g_d = math.exp(-2.20679 / (d + 3.91029) - 0.428934)
    alpha = math.exp(3.62489 - 8.29288 / (d + 5.52825))
    w_d = math.exp(-0.599085 / (d - 0.641583) - 0.665888)
    return g_hg, g_d, alpha, w_d


G_HG, G_D, ALPHA, W_D = mie_fit_params(DROPLET_DIAMETER_UM)
INV4PI = 1.0 / (4.0 * math.pi)
DRAINE_NORM = 1.0 / (1.0 + ALPHA * (1.0 + 2.0 * G_D * G_D) / 3.0)
# mean cosine of the mixture
G_DRAINE_MEAN = G_D * (1.0 + ALPHA * (3.0 + 2.0 * G_D * G_D) / 5.0) * DRAINE_NORM
G_MEAN = (1.0 - W_D) * G_HG + W_D * G_DRAINE_MEAN


# Phase parameters travel as an array pp = [g_hg, g_d, alpha, w_d, draine_norm] so that the validation
# suite can run the same kernel with an isotropic or plain-HG phase function.
PP_CLOUD = np.array([G_HG, G_D, ALPHA, W_D, DRAINE_NORM], dtype=np.float64)
PP_ISOTROPIC = np.array([0.0, 0.0, 0.0, 0.0, 1.0], dtype=np.float64)


def pp_hg(g):
    return np.array([g, 0.0, 0.0, 0.0, 1.0], dtype=np.float64)


@njit(cache=True, inline='always')
def phase(pp, mu):
    """Phase function value (sr^-1), normalised so that its integral over the sphere is 1."""
    g1 = pp[0]
    d1 = 1.0 + g1 * g1 - 2.0 * g1 * mu
    hg = (1.0 - g1 * g1) / (d1 * math.sqrt(d1))
    wd = pp[3]
    if wd <= 0.0:
        return INV4PI * hg
    g2 = pp[1]
    d2 = 1.0 + g2 * g2 - 2.0 * g2 * mu
    dr = (1.0 - g2 * g2) / (d2 * math.sqrt(d2)) * (1.0 + pp[2] * mu * mu) * pp[4]
    return INV4PI * ((1.0 - wd) * hg + wd * dr)


@njit(cache=True, inline='always')
def _sample_hg(g, r):
    if abs(g) < 1e-6:
        return 1.0 - 2.0 * r
    s = (1.0 - g * g) / (1.0 - g + 2.0 * g * r)
    mu = (1.0 + g * g - s * s) / (2.0 * g)
    if mu > 1.0:
        mu = 1.0
    if mu < -1.0:
        mu = -1.0
    return mu


def phase_np(mu):
    mu = np.asarray(mu, dtype=np.float64)
    d1 = 1.0 + G_HG * G_HG - 2.0 * G_HG * mu
    hg = (1.0 - G_HG * G_HG) / d1 ** 1.5
    d2 = 1.0 + G_D * G_D - 2.0 * G_D * mu
    dr = (1.0 - G_D * G_D) / d2 ** 1.5 * (1.0 + ALPHA * mu * mu) * DRAINE_NORM
    return INV4PI * ((1.0 - W_D) * hg + W_D * dr)


def hg_np(mu, g):
    mu = np.asarray(mu, dtype=np.float64)
    return INV4PI * (1.0 - g * g) / (1.0 + g * g - 2.0 * g * mu) ** 1.5


if __name__ == '__main__':
    print('d=%.1f um  g_HG=%.6f  g_D=%.6f  alpha=%.4f  w_D=%.6f' % (DROPLET_DIAMETER_UM, G_HG, G_D, ALPHA, W_D))
    print('mean cosine g = %.5f   p(1) = %.2f sr^-1   p(-1) = %.5f   p(0) = %.5f' % (
        G_MEAN, float(phase_np(1.0)), float(phase_np(-1.0)), float(phase_np(0.0))))
    # numerical normalisation / mean cosine check (fine quadrature in theta, log-spaced near 0)
    th = np.concatenate([[0.0], np.logspace(-7, math.log10(math.pi), 400001)])
    mu = np.cos(th)
    f = phase_np(mu) * np.sin(th) * 2 * math.pi
    print('integral over sphere = %.6f' % np.trapezoid(f, th))
    print('numerical mean cosine = %.6f' % np.trapezoid(f * mu, th))
