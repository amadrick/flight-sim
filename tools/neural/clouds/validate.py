"""Validation of the reference path tracer (pt.py).

    NUMBA_NUM_THREADS=2 $VENV tools/neural/clouds/validate.py      -> data/validation.json + printed tables

1. Plane-parallel slabs, forward photon Monte Carlo with the FULL (untruncated) tabulated Mie phase function:
   albedo R and diffuse / direct transmittance vs optical thickness, energy conservation, comparison with the
   delta-Eddington two-stream solution (Joseph, Wiscombe & Weinman 1976) and the diffusion asymptote.
2. The same slabs with the truncated phase function in the scaled medium (what pt.py walks in): R and T must agree.
3. End to end: radiance leaving the top / bottom of the slab at several view zenith angles, from (a) the forward
   full-phase photon histogram and (b) the adjoint point estimator of pt.py integrated along the view ray
   (L = (1 - exp(-tau/mu_v)) E[J_ss + J_fp + J_ms], points drawn with pdf ~ transmittance x extinction).
"""
import json
import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pt  # noqa: E402


def full_cdf(ph, n=40001):
    tu = np.linspace(0, math.pi, n)
    pu = np.interp(tu, ph.theta, ph.p)
    w = pu * np.sin(tu) * 2 * math.pi
    c = np.concatenate([[0.0], np.cumsum(0.5 * (w[1:] + w[:-1]) * (tu[1] - tu[0]))])
    return c / c[-1]


def trunc_cdf(ph):
    return ph.cdf


def delta_eddington_R(tau, mu0, g):
    """Conservative delta-Eddington plane albedo (Joseph et al. 1976, omega = 1)."""
    gp = g / (1 + g)
    tp = (1 - g * g) * tau
    return ((1 - gp) * tp + (2.0 / 3.0 - mu0) * (1 - math.exp(-tp / mu0))) / (4.0 / 3.0 + (1 - gp) * tp)


def slab_tables(ph, taus, mu0s, nphot):
    rows = []
    cf = full_cdf(ph)
    for mu0 in mu0s:
        for tau in taus:
            t0 = time.time()
            cnt = np.zeros(4); hr = np.zeros(20); ht = np.zeros(20)
            pt.forward_slab(tau, mu0, cf, ph.albedo, nphot, 7, 20, hr, ht, cnt)
            cnt2 = np.zeros(4); hr2 = np.zeros(20); ht2 = np.zeros(20)
            pt.forward_slab((1 - ph.f) * tau, mu0, ph.cdf, ph.albedo_scaled, nphot, 8, 20, hr2, ht2, cnt2)
            rde = delta_eddington_R(tau, mu0, ph.g)
            rows.append(dict(mu0=mu0, tau=tau, R_full=cnt[0], T_diff_full=cnt[1], T_dir_full=cnt[3], A_full=cnt[2],
                             R_trunc=cnt2[0], T_total_trunc=cnt2[1] + cnt2[3], T_total_full=cnt[1] + cnt[3],
                             R_deltaEdd=rde, sum_full=cnt.sum(), secs=time.time() - t0))
            r = rows[-1]
            print(f'mu0 {mu0:.2f} tau {tau:6.1f}: R full {r["R_full"]:.4f} trunc {r["R_trunc"]:.4f} dEdd {rde:.4f} | '
                  f'T full {r["T_total_full"]:.4f} trunc {r["T_total_trunc"]:.4f} (direct {r["T_dir_full"]:.4f}) | '
                  f'R+T+A {r["sum_full"]:.6f}  [{r["secs"]:.1f}s]', flush=True)
    return rows


def slab_scene(tau, nvox=160, H=1000.0):
    sig = np.full((2, nvox, 2), tau / H, np.float32)
    sc = pt.Scene(sig, H / nvox, origin=(0.0, 0.0, 0.0), periodic=True, name=f'slab{tau}')
    return sc


def adjoint_radiance(ph, tau, mu0, mu_v, up=True, npts=4000, nA=24, nB=12, seed0=3):
    """Azimuthally averaged radiance leaving the slab top (up=True) or bottom at view zenith cos mu_v."""
    H = 1000.0
    sc = slab_scene(tau)
    th0 = math.acos(mu0)
    sc.set_sun([math.sin(th0), mu0, 0.0])
    rng = np.random.default_rng(seed0)
    sigma = tau / H
    phi = rng.random(npts) * 2 * math.pi
    sv = math.sqrt(1 - mu_v * mu_v)
    # direction of light travel toward the viewer
    D = np.stack([sv * np.cos(phi), np.full(npts, mu_v if up else -mu_v), sv * np.sin(phi)], 1)
    # optical distance from the boundary along the view ray, truncated exponential on [0, tau/mu_v]
    Tm = math.exp(-tau / mu_v)
    u = rng.random(npts)
    tt = -np.log(1 - u * (1 - Tm))
    depth = tt * mu_v / sigma                         # metres below the top (or above the bottom)
    y = H - depth if up else depth
    P = np.stack([rng.random(npts) * sc.h * 2, y, rng.random(npts) * sc.h * 2], 1)
    out = pt.estimate(sc, ph, P, D, nA=nA, nB=nB, seed0=seed0)
    tau_sun = (H - y) * sigma / mu0
    cos_t = D @ sc.L * -1.0          # scattering cosine between sun travel (-L) and D
    jss, jfp = pt.deterministic_terms(ph, cos_t, tau_sun)
    J = jss + jfp + out[:, 1]
    L = (1 - Tm) * J
    return L.mean(), L.std() / math.sqrt(npts), (1 - Tm) * jss.mean(), (1 - Tm) * out[:, 1].mean()


def radiance_compare(ph, tau, mu0, nphot):
    cf = full_cdf(ph)
    nb = 10
    cnt = np.zeros(4); hr = np.zeros(nb); ht = np.zeros(nb)
    pt.forward_slab(tau, mu0, cf, ph.albedo, nphot, 11, nb, hr, ht, cnt)
    rows = []
    for b in (2, 4, 6, 8):
        mu_lo, mu_hi = b / nb, (b + 1) / nb
        mu_c = 0.5 * (mu_lo + mu_hi)
        # photon fraction -> radiance: flux per area in = mu0 (unit irradiance normal to the beam)
        Lf_r = mu0 * hr[b] / (math.pi * (mu_hi ** 2 - mu_lo ** 2))
        Lf_t = mu0 * ht[b] / (math.pi * (mu_hi ** 2 - mu_lo ** 2))
        # adjoint at a few mu inside the bin, averaged with weight mu (the histogram is flux weighted)
        mus = np.linspace(mu_lo, mu_hi, 4)[1:-1] if False else np.array([mu_lo + 0.25 * (mu_hi - mu_lo), mu_lo + 0.75 * (mu_hi - mu_lo)])
        ar = [adjoint_radiance(ph, tau, mu0, m, True) for m in mus]
        at = [adjoint_radiance(ph, tau, mu0, m, False) for m in mus]
        wts = mus / mus.sum()
        La_r = float(sum(w * a[0] for w, a in zip(wts, ar)))
        La_t = float(sum(w * a[0] for w, a in zip(wts, at)))
        er = float(math.sqrt(sum((w * a[1]) ** 2 for w, a in zip(wts, ar))))
        et = float(math.sqrt(sum((w * a[1]) ** 2 for w, a in zip(wts, at))))
        rows.append(dict(tau=tau, mu0=mu0, mu_bin=[mu_lo, mu_hi], L_refl_forward=Lf_r, L_refl_adjoint=La_r, err_refl=er,
                         L_trans_forward=Lf_t, L_trans_adjoint=La_t, err_trans=et,
                         ss_share_refl=float(sum(w * a[2] for w, a in zip(wts, ar)) / max(La_r, 1e-12))))
        r = rows[-1]
        print(f'tau {tau:5.1f} mu0 {mu0:.2f} mu_v {mu_lo:.1f}-{mu_hi:.1f}: reflected fwd {Lf_r:.4f} adj {La_r:.4f}+-{er:.4f} '
              f'({(La_r / Lf_r - 1) * 100:+.1f}%) | transmitted fwd {Lf_t:.4f} adj {La_t:.4f}+-{et:.4f} '
              f'({(La_t / max(Lf_t, 1e-9) - 1) * 100:+.1f}%)  [ss share {r["ss_share_refl"]:.2f}]', flush=True)
    return rows


def aureole_compare(ph, tau, nphot=4000000, out=None):
    """Transmitted radiance around the sun (sun at zenith) vs angle: forward full-phase photon MC against the
    estimator with and without the analytic aureole term."""
    cf = full_cdf(ph, 200001)
    dth = math.radians(0.5)
    nb = 20
    hist = np.zeros(nb); cnt = np.zeros(1)
    pt.forward_aureole(tau, cf, nphot, 21, dth, nb, hist, cnt)
    rows = []
    for b in (0, 1, 2, 3, 5, 7, 9, 13, 19):
        a0, a1 = b * dth, (b + 1) * dth
        dOm = 2 * math.pi * (math.cos(a0) - math.cos(a1))
        Lf = hist[b] / (dOm * math.cos(0.5 * (a0 + a1)))
        res = []
        for aur in (False, True):
            th_c = 0.5 * (a0 + a1)
            L = adjoint_radiance_dir(ph, tau, th_c, aur)
            res.append(L)
        rows.append(dict(tau=tau, theta_deg=math.degrees(0.5 * (a0 + a1)), L_forward=Lf, L_deltaM=res[0], L_aureole=res[1]))
        print(f'tau {tau:4.1f} theta {math.degrees(0.5 * (a0 + a1)):5.2f} deg: forward {Lf:9.4f} | delta-M {res[0]:9.4f} '
              f'({(res[0] / Lf - 1) * 100:+6.1f}%) | + aureole {res[1]:9.4f} ({(res[1] / Lf - 1) * 100:+6.1f}%)', flush=True)
    return rows


def adjoint_radiance_dir(ph, tau, theta, aur, npts=3000, nA=16, nB=8):
    """Radiance leaving the slab bottom at angle theta from the (zenith) sun beam."""
    H = 1000.0
    sc = slab_scene(tau)
    sc.set_sun([0.0, 1.0, 0.0])
    rng = np.random.default_rng(9)
    mu_v = math.cos(theta)
    sigma = tau / H
    phi = rng.random(npts) * 2 * math.pi
    sv = math.sin(theta)
    D = np.stack([sv * np.cos(phi), np.full(npts, -mu_v), sv * np.sin(phi)], 1)
    Tm = math.exp(-tau / mu_v)
    u = rng.random(npts)
    tt = -np.log(1 - u * (1 - Tm))
    y = tt * mu_v / sigma
    P = np.stack([rng.random(npts) * sc.h * 2, y, rng.random(npts) * sc.h * 2], 1)
    out = pt.estimate(sc, ph, P, D, nA=nA, nB=nB, seed0=5)
    tau_sun = (H - y) * sigma
    cos_t = -D[:, 1]
    jss, jfp = pt.deterministic_terms(ph, cos_t, tau_sun, aureole_term=aur)
    return float(((1 - Tm) * (jss + jfp + out[:, 1])).mean())


def main():
    if '--aureole' in sys.argv:
        ph = pt.Phase(10.0, 'G', 4.0)
        rows = []
        for tau in (0.5, 1.0, 2.0, 4.0):
            rows += aureole_compare(ph, tau)
        json.dump(rows, open(os.path.join(pt.DATA, 'aureole.json'), 'w'), indent=1)
        return
    quick = '--quick' in sys.argv
    out = {}
    for tc in (2.0, 4.0, 6.0):
        print('theta_c', tc, pt.Phase(10.0, 'G', tc).summary())
    ph = pt.Phase(10.0, 'G', 4.0)
    out['phase'] = ph.summary()
    taus = [0.5, 1, 2, 5, 10, 20, 50, 100] if not quick else [1, 10]
    out['slab'] = slab_tables(ph, taus, [1.0, 0.5, 0.17], 400000 if not quick else 50000)
    rad = []
    for tau, mu0 in ((2.0, 0.5), (10.0, 0.87), (40.0, 0.5)) if not quick else ((5.0, 0.5),):
        rad += radiance_compare(ph, tau, mu0, 2000000 if not quick else 200000)
    out['radiance'] = rad
    with open(os.path.join(pt.DATA, 'validation.json'), 'w') as f:
        json.dump(out, f, indent=1)


if __name__ == '__main__':
    main()
