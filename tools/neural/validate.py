"""Validation of the reference solver against analytic / independent results.
Run:  NUMBA_NUM_THREADS=2 .venv/bin/python validate.py            (about 2-3 minutes)
Prints PASS/FAIL per check and writes validation.json (numbers quoted in src/neural/REPORT.md).
"""
import json
import math
import sys
import time
import numpy as np
from numba import njit

import phase as ph
from phase import PP_CLOUD, PP_ISOTROPIC, pp_hg
from mcrt import Medium, slab_medium, _sample_mu, _seed, _rand, _march_tau

RESULTS = {}
ALL_OK = True


def check(name, ok, **info):
    global ALL_OK
    ALL_OK &= bool(ok)
    RESULTS[name] = dict(ok=bool(ok), **info)
    print(('PASS  ' if ok else 'FAIL  ') + name + '  ' + '  '.join('%s=%s' % (k, _fmt(v)) for k, v in info.items()))
    sys.stdout.flush()


def _fmt(v):
    if isinstance(v, float):
        return '%.5g' % v
    if isinstance(v, (list, tuple)):
        return '[' + ', '.join(_fmt(x) for x in v) + ']'
    return str(v)


def mean_se(res):
    """Mean of J_ms estimates and its standard error from the two independent halves over N samples."""
    j = 0.5 * (res[:, 0] + res[:, 1])
    return float(j.mean()), float(j.std(ddof=1) / math.sqrt(len(j)))


# ------------------------------------------------------------------------------------------------------
@njit(cache=True)
def _sample_many(pp, n, seed):
    st = np.zeros(1, dtype=np.uint64)
    _seed(st, seed, 7)
    out = np.empty(n)
    for i in range(n):
        out[i] = _sample_mu(pp, st)
    return out


def test_phase_sampling():
    """Sampled cos(theta) histogram must match the integrated pdf (log-spaced bins in theta resolve the peak)."""
    n = 4_000_000
    mu = _sample_many(PP_CLOUD, n, 123)
    th = np.arccos(np.clip(mu, -1, 1))
    edges = np.concatenate([[0.0], np.logspace(math.log10(2e-3), math.log10(math.pi), 40)])
    cnt, _ = np.histogram(th, edges)
    # expected probability per bin by fine quadrature
    exp = np.empty(len(edges) - 1)
    for i in range(len(exp)):
        t = np.linspace(edges[i], edges[i + 1], 2001)
        exp[i] = np.trapezoid(ph.phase_np(np.cos(t)) * np.sin(t) * 2 * math.pi, t)
    z = (cnt - n * exp) / np.sqrt(n * exp * (1 - exp) + 1e-12)
    g_mc = float(mu.mean())
    check('phase sampling matches pdf (40 log-theta bins, 4e6 samples)', np.abs(z).max() < 4.5 and abs(exp.sum() - 1) < 1e-5,
          max_abs_z=float(np.abs(z).max()), pdf_integral=float(exp.sum()), g_sampled=g_mc, g_analytic=ph.G_MEAN)


def test_tracking():
    """Delta tracking with supercell majorants: P(no collision) along a ray = exp(-tau) (heterogeneous, sheared, periodic)."""
    rng = np.random.default_rng(5)
    sig = (rng.random((32, 32, 32)) ** 3 * 0.02).astype(np.float32)
    sig[rng.random((32, 32, 32)) < 0.4] = 0.0
    sig[:, :, :3] = 0.0
    med = Medium(sig, 20.0, 25.0, 15.0, 0.45)
    worst = 0.0
    rows = []
    for d in ([0.3, 0.2, -0.93], [0.9, -0.3, 0.3], [-0.6, 0.7, -0.4], [0.0, 0.0, -1.0], [-0.9, 0.0, -0.3]):
        d = np.array(d) / np.linalg.norm(d)
        o = np.array([333.3, 121.7, 32 * 15.0 - 1e-6]) if d[2] < 0 else np.array([333.3, 121.7, 1e-6])
        tau = _march_tau(med.sig, med.geo, o[0], o[1], o[2], d[0], d[1], d[2], 0.01, 1e9, 1e9)
        n = 400_000
        _, ok = med.camera_points(np.tile(o, (n, 1)), np.tile(d, (n, 1)), seed=11)
        p = 1.0 - ok.mean()
        pe = math.exp(-tau)
        z = (p - pe) / math.sqrt(pe * (1 - pe) / n)
        worst = max(worst, abs(z))
        rows.append([float(tau), float(p), float(math.exp(-tau))])
    check('delta tracking transmittance = exp(-tau) on 5 rays through a random heterogeneous lattice', worst < 4.0,
          max_abs_z=worst, tau_Pmc_Pexact=rows)


# ------------------------------------------------------------------------------------------------------
def h_function(mu, albedo, n=400):
    """Chandrasekhar H-function for isotropic scattering by iteration of the stable form of the H-equation."""
    x, wq = np.polynomial.legendre.leggauss(n)
    x = 0.5 * (x + 1)
    wq = 0.5 * wq
    h = np.ones(n)
    for _ in range(2000):
        hn = 1.0 / (math.sqrt(1 - albedo) + 0.5 * albedo * (wq * x * h / (x[:, None] + x[None, :])).sum(axis=1))
        if np.abs(hn - h).max() < 1e-13:
            h = hn
            break
        h = hn
    return 1.0 / (math.sqrt(1 - albedo) + 0.5 * albedo * (wq * x * h / (mu + x)).sum())


def test_isotropic_exact():
    """Exact results for isotropic scattering in a (numerically) semi-infinite plane-parallel medium:
       J(tau=0) = albedo/(4 pi) * H(mu0)  [all orders];   J_2(0) = albedo^2/(8 pi) * mu0 * ln(1 + 1/mu0)  [2nd order]."""
    worst = 0.0
    rows = []
    for albedo, tau_slab in ((0.9, 80.0), (0.99, 250.0)):
        for mu0 in (1.0, 0.5, 0.2):
            med = slab_medium(tau_slab, mu0, nz=64)
            h = tau_slab / 0.05
            n = 4000
            pos = np.tile([0.0, 0.0, h * (1 - 1e-12)], (n, 1))
            w = np.tile([0.0, 0.0, 1.0], (n, 1))
            # the estimator returns J_ms without the last albedo factor convention check: J = J_ss + J_ms
            res = med.estimate(pos, w, 64, albedo=albedo, seed=3, pp=PP_ISOTROPIC)
            jms, se = mean_se(res)
            j_total = (1.0 / (4 * math.pi) + jms)         # per unit irradiance, source function without albedo
            exact = h_function(mu0, albedo) / (4 * math.pi)
            z = (j_total - exact) / se
            worst = max(worst, abs(z))
            rows.append([albedo, mu0, j_total * 4 * math.pi, exact * 4 * math.pi, z])
            res2 = med.estimate(pos, w, 64, max_bounce=1, albedo=albedo, seed=4, pp=PP_ISOTROPIC)
            j2, se2 = mean_se(res2)
            ex2 = albedo / (8 * math.pi) * mu0 * math.log(1 + 1 / mu0)
            z2 = (j2 - ex2) / se2
            worst = max(worst, abs(z2))
            rows.append([albedo, mu0, j2, ex2, z2])
    check('isotropic semi-infinite slab: 4pi*J(0) = H(mu0) (all orders) and analytic 2nd order', worst < 4.0,
          max_abs_z=worst, rows_albedo_mu0_mc_exact_z=rows)
    return rows


# ------------------------------------------------------------------------------------------------------
def slab_fluxes(tau_slab, mu0, pp, n=20000, npaths=16, albedo=1.0, seed=1, grid=None):
    """Plane albedo R and diffuse transmittance T of a slab from the source-function estimator:
       F_up(top)/mu0 = (1/mu0) int dOmega int_0^tau* J(tau, w) exp(-tau/mu) dtau, J = J_ss + J_ms.
       Directions are drawn from a mixture (uniform sphere + phase lobe about the sun) so the peak is resolved."""
    rng = np.random.default_rng(seed)
    med = slab_medium(tau_slab, mu0, nz=64) if grid is None else grid
    h = med.size[2]
    s = -med.sun_dir
    # mixture sampling of w
    u = rng.random(n) < 0.5
    w = rng.normal(size=(n, 3))
    w /= np.linalg.norm(w, axis=1, keepdims=True)
    mu_s = _sample_many(pp, n, seed + 100)
    phi = rng.random(n) * 2 * math.pi
    # build directions about s
    a = np.array([0.0, 1.0, 0.0])
    t1 = np.cross(s, a)
    t1 /= np.linalg.norm(t1)
    t2 = np.cross(s, t1)
    sn = np.sqrt(np.clip(1 - mu_s ** 2, 0, 1))
    w_s = sn[:, None] * (np.cos(phi)[:, None] * t1 + np.sin(phi)[:, None] * t2) + mu_s[:, None] * s
    w = np.where(u[:, None], w, w_s)
    cos_t = w @ s
    q = 0.5 / (4 * math.pi) + 0.5 * _phase_np_pp(pp, cos_t)
    mu = w[:, 2]
    amu = np.maximum(np.abs(mu), 1e-9)
    # optical distance from the exit face, truncated exponential
    span = 1 - np.exp(-tau_slab / amu)
    t_exit = -amu * np.log(1 - rng.random(n) * span)
    t_exit = np.minimum(t_exit, tau_slab * (1 - 1e-12))
    tau_top = np.where(mu > 0, t_exit, tau_slab - t_exit)
    pos = np.zeros((n, 3))
    pos[:, 0] = rng.random(n) * med.size[0]
    pos[:, 1] = rng.random(n) * med.size[1]
    pos[:, 2] = np.clip(h * (1 - tau_top / tau_slab), 1e-9 * h, h * (1 - 1e-12))
    res = med.estimate(pos, w, npaths, albedo=albedo, seed=seed, pp=pp)
    jms = 0.5 * (res[:, 0] + res[:, 1])
    jss = _phase_np_pp(pp, cos_t) * np.exp(-tau_top / mu0)
    wgt = amu * span / q / mu0
    up = mu > 0
    out = {}
    for name, m, j in (('R_ss', up, jss), ('R_ms', up, jms), ('T_ss', ~up, jss), ('T_ms', ~up, jms)):
        v = np.where(m, j * wgt, 0.0)
        out[name] = (float(v.mean()), float(v.std(ddof=1) / math.sqrt(n)))
    tot = np.where(up, 1.0, 1.0) * (jss + jms) * wgt
    out['R'] = out['R_ss'][0] + out['R_ms'][0]
    out['T_dif'] = out['T_ss'][0] + out['T_ms'][0]
    out['T_dir'] = math.exp(-tau_slab / mu0)
    out['sum'] = out['R'] + out['T_dif'] + out['T_dir']
    out['sum_se'] = float(tot.std(ddof=1) / math.sqrt(n))
    out['R_se'] = float(np.where(up, (jss + jms) * wgt, 0.0).std(ddof=1) / math.sqrt(n))
    out['mean_scatter'] = float(res[:, 3].mean())
    out['cut'] = float(res[:, 4].mean())
    return out


def _phase_np_pp(pp, mu):
    g1, g2, al, wd, dn = pp
    hg = (1 - g1 * g1) / (1 + g1 * g1 - 2 * g1 * mu) ** 1.5
    dr = (1 - g2 * g2) / (1 + g2 * g2 - 2 * g2 * mu) ** 1.5 * (1 + al * mu * mu) * dn
    return ((1 - wd) * hg + wd * dr) / (4 * math.pi)


def delta_eddington_T(tau, mu0, g):
    """Total transmittance (direct+diffuse) of a conservative slab, delta-Eddington (Joseph et al. 1976)."""
    f = g * g
    taup = (1 - f) * tau
    gp = (g - f) / (1 - f)
    return (2.0 / 3 + mu0 + (2.0 / 3 - mu0) * math.exp(-taup / mu0)) / (4.0 / 3 + (1 - gp) * taup)


def asymptotic_T(tau, mu0, g):
    """Asymptotic theory for thick conservative layers (King & Harshvardhan 1986): T = 4K(mu0)/(3(1-g)(tau+2q0)),
    q0 = 0.714/(1-g), escape function K(mu0) ~ 3/7 (1 + 2 mu0)."""
    return 4 * (3.0 / 7) * (1 + 2 * mu0) / (3 * ((1 - g) * tau + 2 * 0.714))


@njit(cache=True)
def forward_slab_mc(pp, tau_slab, mu0, nphot, seed):
    """Independent solver: analog FORWARD photon random walk in a conservative homogeneous slab (optical units).
    Returns (reflected fraction, transmitted fraction incl. the direct beam). Shares only the phase sampler."""
    st = np.zeros(1, dtype=np.uint64)
    _seed(st, seed, 99)
    nr = 0
    nt = 0
    for _ in range(nphot):
        tau = 0.0                       # depth below the top
        mu = mu0                        # downward direction cosine
        while True:
            tau += mu * (-math.log(1.0 - _rand(st)))
            if tau < 0.0:
                nr += 1
                break
            if tau > tau_slab:
                nt += 1
                break
            c = _sample_mu(pp, st)
            phi = 2.0 * math.pi * _rand(st)
            mu = mu * c + math.sqrt(max(0.0, (1.0 - mu * mu) * (1.0 - c * c))) * math.cos(phi)
    return nr / nphot, nt / nphot


def test_slab_energy_and_diffusion():
    """Plane albedo / transmittance of conservative slabs with the cloud phase function:
       adjoint source-function estimator (this solver)  vs  independent forward photon MC  vs  two-stream theory."""
    rows = []
    worst_z = 0.0
    worst_zf = 0.0
    worst_diff = 0.0
    g = ph.G_MEAN
    for tau, mu0 in ((0.5, 1.0), (2.0, 0.5), (8.0, 1.0), (8.0, 0.3), (32.0, 0.6667), (32.0, 0.25), (100.0, 1.0), (100.0, 0.5)):
        o = slab_fluxes(tau, mu0, PP_CLOUD, n=60000, npaths=16, albedo=1.0, seed=int(tau * 10 + mu0 * 100))
        nph = 400000
        rf, tf = forward_slab_mc(PP_CLOUD, tau, mu0, nph, 17)
        z = (o['sum'] - 1.0) / o['sum_se']
        zf = (o['R'] - rf) / math.hypot(o['R_se'], math.sqrt(rf * (1 - rf) / nph))
        worst_z = max(worst_z, abs(z))
        worst_zf = max(worst_zf, abs(zf))
        de = delta_eddington_T(tau, mu0, g)
        asy = asymptotic_T(tau, mu0, g)
        rows.append(dict(tau=tau, mu0=mu0, R=o['R'], R_se=o['R_se'], T_dif=o['T_dif'], T_dir=o['T_dir'], sum=o['sum'],
                         sum_se=o['sum_se'], R_forwardMC=rf, T_forwardMC=tf, T_deltaEddington=de, T_asymptotic=asy,
                         mean_scatter=o['mean_scatter'], cut=o['cut']))
        if tau >= 32:
            worst_diff = max(worst_diff, abs(tf - asy) / asy)
        print('   slab tau=%5.1f mu0=%.3f  adjoint: R=%.4f+-%.4f T=%.4f sum=%.4f+-%.4f | forward MC: R=%.4f T=%.4f | '
              'dEdd T=%.4f  asym T=%.4f  <scat>=%.0f cut=%.1e'
              % (tau, mu0, o['R'], o['R_se'], o['T_dif'] + o['T_dir'], o['sum'], o['sum_se'], rf, tf, de, asy,
                 o['mean_scatter'], o['cut']))
    check('slab energy conservation R + T_dif + T_dir = 1 (albedo 1, cloud phase function, 8 cases)', worst_z < 4.0,
          max_abs_z=worst_z)
    check('slab albedo: adjoint J estimator == independent forward photon MC (8 cases)', worst_zf < 4.0,
          max_abs_z=worst_zf)
    check('thick-slab transmittance agrees with asymptotic diffusion theory within 6% (tau >= 32)', worst_diff < 0.06,
          max_rel_diff=worst_diff)
    RESULTS['slab_table'] = rows


def test_grid_vs_slab_and_mis():
    """(a) A 3-D homogeneous lattice (sheared, periodic, supercells) must reproduce the 1x1xN plane-parallel slab.
       (b) The MIS estimator must agree with plain next-event estimation (both unbiased)."""
    tau, mu0 = 12.0, 0.4
    sigma = 0.05
    h = tau / sigma
    slab = slab_medium(tau, mu0, nz=48)
    grid = Medium(np.full((16, 24, 48), sigma, dtype=np.float32), 37.0, 23.0, h / 48, mu0)
    rng = np.random.default_rng(1)
    worst = 0.0
    rows = []
    for depth, wdir in ((0.2, [0.3, 0.1, 0.95]), (3.0, [-0.5, 0.5, -0.7]), (9.0, [0.0, 0.0, -1.0]), (1.0, [-0.39, 0.0, -0.92])):
        wdir = np.array(wdir) / np.linalg.norm(wdir)
        n = 3000
        z = h * (1 - depth / tau)
        pos = np.column_stack([rng.random(n) * 500, rng.random(n) * 500, np.full(n, z)])
        w = np.tile(wdir, (n, 1))
        a, sa = mean_se(slab.estimate(pos, w, 32, seed=5))
        b, sb = mean_se(grid.estimate(pos, w, 32, seed=6))
        c, sc = mean_se(slab.estimate(pos, w, 32, seed=7, tau_mis=0.0))
        z1 = (a - b) / math.hypot(sa, sb)
        z2 = (a - c) / math.hypot(sa, sc)
        worst = max(worst, abs(z1), abs(z2))
        rows.append(dict(depth=depth, J_slab=a, J_grid=b, J_plainNEE=c, se_mis=sa, se_plain=sc, z_grid=z1, z_plain=z2))
        print('   depth %.1f: slab %.5f+-%.5f  grid %.5f+-%.5f  plainNEE %.5f+-%.5f (variance ratio plain/MIS %.1f)'
              % (depth, a, sa, b, sb, c, sc, (sc / sa) ** 2))
    check('3-D sheared lattice == plane-parallel slab, and MIS == plain NEE (4 points)', worst < 4.0, max_abs_z=worst)
    RESULTS['grid_mis_table'] = rows


if __name__ == '__main__':
    t0 = time.time()
    print('phase: d=%.0f um g_HG=%.5f g_D=%.5f alpha=%.3f w_D=%.5f  <cos>=%.4f' % (
        ph.DROPLET_DIAMETER_UM, ph.G_HG, ph.G_D, ph.ALPHA, ph.W_D, ph.G_MEAN))
    test_phase_sampling()
    test_tracking()
    test_isotropic_exact()
    test_grid_vs_slab_and_mis()
    test_slab_energy_and_diffusion()
    RESULTS['all_ok'] = bool(ALL_OK)
    RESULTS['seconds'] = time.time() - t0
    with open('validation.json', 'w') as f:
        json.dump(RESULTS, f, indent=1)
    print('ALL OK' if ALL_OK else 'SOME CHECKS FAILED', ' (%.0f s)' % (time.time() - t0))
    sys.exit(0 if ALL_OK else 1)
