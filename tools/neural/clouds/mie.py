"""Lorenz-Mie scattering by a population of liquid water droplets (Bohren & Huffman BHMIE, numba).

    VENV=/home/user/wt/neural/tools/neural/.venv/bin/python
    OMP_NUM_THREADS=1 $VENV tools/neural/clouds/mie.py            # writes tools/neural/clouds/data/mie_tables.npz

Physics
-------
* Droplets: homogeneous water spheres, complex refractive index of liquid water (Hale & Querry 1973 at ~20 C),
  m = n + i k with n = 1.343 (400 nm) ... 1.331 (700 nm), k = 1e-9 (450 nm) ... 3.4e-8 (700 nm).
* Size distribution: modified gamma n(r) ~ r^((1 - 3 v)/v) exp(-r / (r_eff v)) (Hansen 1971; Hansen & Travis 1974),
  effective variance v_eff = 0.1 (typical for cumulus / stratocumulus), effective radius r_eff a parameter
  (continental cumulus ~ 5-8 um, maritime ~ 10-15 um, drizzling ~ 15-20 um).
* Spectral bands: the phase function, extinction efficiency and single-scattering albedo are averaged over
  wavelengths with a flat weight in three bands standing for the R, G, B primaries (600-680, 500-570, 430-490 nm),
  each with 7 wavelengths. Averaging over size AND wavelength washes out the ripple structure of single sizes,
  leaving the robust features: the diffraction peak (width ~ lambda / (2 r)), the broad side-scattering minimum,
  the fogbow (cloudbow) near 140 deg scattering angle with its supernumerary fringes, and the glory at 180 deg.

Output table (per r_eff, per band): theta grid (non-uniform, fine at 0 and 180 deg), p(theta) in sr^-1 normalised
to 1 over the sphere, asymmetry g, single-scattering albedo, extinction efficiency Q_ext (-> sigma from LWC).
"""
import math
import os
import sys
import time

import numpy as np
from numba import njit, prange

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')

# Hale & Querry (1973) liquid water, interpolated: lambda (um), n, k
HQ = np.array([
    [0.400, 1.339, 1.86e-9], [0.425, 1.338, 1.30e-9], [0.450, 1.337, 1.02e-9], [0.475, 1.336, 9.35e-10],
    [0.500, 1.335, 1.00e-9], [0.525, 1.334, 1.32e-9], [0.550, 1.333, 1.96e-9], [0.575, 1.333, 3.60e-9],
    [0.600, 1.332, 1.09e-8], [0.625, 1.332, 1.39e-8], [0.650, 1.331, 1.64e-8], [0.675, 1.331, 2.23e-8],
    [0.700, 1.331, 3.35e-8]])
BANDS = {'R': (0.600, 0.680), 'G': (0.500, 0.570), 'B': (0.430, 0.490)}
NLAM = 7
V_EFF = 0.1


def water_index(lam):
    return np.interp(lam, HQ[:, 0], HQ[:, 1]) + 1j * np.exp(np.interp(lam, HQ[:, 0], np.log(HQ[:, 2])))


def theta_grid():
    """Scattering-angle grid (radians): 0.01 deg steps over 0-6 deg, 0.02 deg over 172-180 deg, 0.1 deg elsewhere."""
    a = np.arange(0.0, 6.0, 0.01)
    b = np.arange(6.0, 172.0, 0.1)
    c = np.arange(172.0, 180.0 + 1e-9, 0.02)
    return np.radians(np.concatenate([a, b, c]))


@njit(cache=True)
def bhmie(x, mre, mim, mu):
    """Bohren & Huffman (1983) appendix A, vectorised over mu = cos(theta).
    Returns (S11 = (|S1|^2 + |S2|^2)/2 per mu, Qext, Qsca)."""
    m = complex(mre, mim)
    y = x * m
    xstop = x + 4.0 * x ** (1.0 / 3.0) + 2.0
    nstop = int(xstop)
    nmx = int(max(xstop, abs(y))) + 15
    # logarithmic derivative D_n(mx) by downward recurrence
    d = np.zeros(nmx + 1, dtype=np.complex128)
    for n in range(nmx - 1, 0, -1):
        en = n + 1.0
        d[n] = en / y - 1.0 / (d[n + 1] + en / y)
    nang = mu.shape[0]
    s1 = np.zeros(nang, dtype=np.complex128)
    s2 = np.zeros(nang, dtype=np.complex128)
    pi0 = np.zeros(nang)
    pi1 = np.ones(nang)
    psi0 = math.cos(x)
    psi1 = math.sin(x)
    chi0 = -math.sin(x)
    chi1 = math.cos(x)
    xi1 = complex(psi1, -chi1)
    qsca = 0.0
    qext = 0.0
    for n in range(1, nstop + 1):
        en = float(n)
        fn = (2.0 * en + 1.0) / (en * (en + 1.0))
        psi = (2.0 * en - 1.0) * psi1 / x - psi0
        chi = (2.0 * en - 1.0) * chi1 / x - chi0
        xi = complex(psi, -chi)
        an = ((d[n] / m + en / x) * psi - psi1) / ((d[n] / m + en / x) * xi - xi1)
        bn = ((m * d[n] + en / x) * psi - psi1) / ((m * d[n] + en / x) * xi - xi1)
        qsca += (2.0 * en + 1.0) * (abs(an) ** 2 + abs(bn) ** 2)
        qext += (2.0 * en + 1.0) * (an.real + bn.real)
        for j in range(nang):
            p = pi1[j]
            t = en * mu[j] * p - (en + 1.0) * pi0[j]
            s1[j] += fn * (an * p + bn * t)
            s2[j] += fn * (an * t + bn * p)
            # next pi
            pn = ((2.0 * en + 1.0) * mu[j] * p - (en + 1.0) * pi0[j]) / en
            pi0[j] = p
            pi1[j] = pn
        psi0 = psi1
        psi1 = psi
        chi0 = chi1
        chi1 = chi
        xi1 = complex(psi1, -chi1)
    s11 = np.empty(nang)
    for j in range(nang):
        s11[j] = 0.5 * (abs(s1[j]) ** 2 + abs(s2[j]) ** 2)
    return s11, 2.0 * qext / (x * x), 2.0 * qsca / (x * x)


@njit(parallel=True, cache=True)
def _pop(radii, wts, lam, mre, mim, mu):
    """Sum over radii (weights = n(r) dr): returns sum w S11 / k^2, sum w Cext, sum w Csca, sum w Cabs."""
    nr = radii.shape[0]
    out = np.zeros((nr, mu.shape[0]))
    ce = np.zeros(nr)
    cs = np.zeros(nr)
    k = 2.0 * math.pi / lam
    for i in prange(nr):
        x = k * radii[i]
        s11, qe, qs = bhmie(x, mre, mim, mu)
        area = math.pi * radii[i] ** 2
        out[i] = wts[i] * s11 / (k * k)
        ce[i] = wts[i] * qe * area
        cs[i] = wts[i] * qs * area
    return out.sum(0), ce.sum(), cs.sum()


def gamma_dist(r_eff, v_eff=V_EFF, n=400):
    """Radii (um) and weights n(r) dr for the modified gamma distribution, normalised to unit number."""
    a = (1.0 - 3.0 * v_eff) / v_eff
    b = 1.0 / (r_eff * v_eff)
    r = np.linspace(0.02 * r_eff, 3.2 * r_eff, n)
    w = r ** a * np.exp(-b * r)
    w *= (r[1] - r[0])
    return r, w / w.sum()


def population(r_eff, band, theta):
    mu = np.cos(theta)
    lams = np.linspace(BANDS[band][0], BANDS[band][1], NLAM)
    r, w = gamma_dist(r_eff)
    S, CE, CS = 0.0, 0.0, 0.0
    for lam in lams:
        m = water_index(lam)
        s, ce, cs = _pop(r, w, lam, m.real, m.imag, mu)
        S = S + s / NLAM
        CE += ce / NLAM
        CS += cs / NLAM
    p = S / CS                      # = sum(n S11 / k^2) / sum(n Csca)  -> normalised to 1 over the sphere
    # renormalise numerically (removes the quadrature error of the band average; should be ~1e-3)
    norm = 2 * math.pi * np.trapezoid(p * np.sin(theta), theta)
    p = p / norm
    g = 2 * math.pi * np.trapezoid(p * mu * np.sin(theta), theta)
    area_mean = np.sum(w * math.pi * r ** 2)
    return dict(p=p, g=g, albedo=CS / CE, qext=CE / area_mean, norm_err=norm - 1.0)


def features(theta, p):
    """Fogbow / glory / side-minimum locations of a tabulated phase function (degrees)."""
    deg = np.degrees(theta)
    sel = (deg > 120) & (deg < 160)
    i_bow = np.argmax(np.where(sel, p, 0))
    sel2 = (deg > 80) & (deg < 130)
    i_min = np.argmin(np.where(sel2, p, 1e9))
    return dict(fogbow_deg=float(deg[i_bow]), fogbow_p=float(p[i_bow]), side_min_deg=float(deg[i_min]),
                side_min_p=float(p[i_min]), p0=float(p[0]), p180=float(p[-1]), p90=float(np.interp(90, deg, p)))


def main():
    os.makedirs(DATA, exist_ok=True)
    theta = theta_grid()
    reffs = [float(a) for a in sys.argv[1:]] or [5.0, 6.0, 8.0, 10.0, 12.0, 16.0, 20.0]
    out = dict(theta=theta, reff=np.array(reffs))
    P = np.zeros((len(reffs), 3, theta.size))
    G = np.zeros((len(reffs), 3)); A = np.zeros((len(reffs), 3)); Q = np.zeros((len(reffs), 3))
    for i, re in enumerate(reffs):
        for j, band in enumerate('RGB'):
            t0 = time.time()
            r = population(re, band, theta)
            P[i, j], G[i, j], A[i, j], Q[i, j] = r['p'], r['g'], r['albedo'], r['qext']
            f = features(theta, r['p'])
            print(f'r_eff {re:4.1f} um {band}: g={r["g"]:.4f} 1-albedo={1 - r["albedo"]:.2e} Qext={r["qext"]:.3f} '
                  f'norm_err={r["norm_err"]:+.1e} p0={f["p0"]:.0f} p90={f["p90"]:.4f} bow {f["fogbow_deg"]:.1f} '
                  f'({f["fogbow_p"]:.4f}) min {f["side_min_deg"]:.1f} p180={f["p180"]:.3f}  [{time.time() - t0:.1f}s]',
                  flush=True)
    np.savez_compressed(os.path.join(DATA, 'mie_tables.npz'), P=P, g=G, albedo=A, qext=Q, **out)


if __name__ == '__main__':
    main()
