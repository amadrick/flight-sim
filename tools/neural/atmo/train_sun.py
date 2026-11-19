"""Direct sunlight: spectral transmittance network + solar limb darkening.

Sun network  T_sun(D_R, D_O) -> ln(rgb), 3 outputs
  The classic model multiplies a white sun by exp(-tau) at 680 / 550 / 440 nm. The true colour of the attenuated sun is
  the band integral  k * XYZ->sRGB( sum_lambda S(lambda) cmf(lambda) exp(-tau(lambda)) ). Aerosol is grey in both
  models and stays an analytic factor exp(-tau_M), so the network only needs the Rayleigh and ozone columns along the
  ray (D_R, D_O in km of sea-level / peak-density air): a smooth, convex log-sum-exp of two variables. It is trained
  on the full rectangle D_R in [0, 600], D_O in [0, 700] (every reachable ray, from the ground to 100 km and grazing
  the ozone layer, lies inside), so the runtime can bake it into a texture over that rectangle.
  k makes the overhead sun at sea level exactly the classic colour (noon look unchanged).
Limb darkening: Eddington-Barbier on a grey atmosphere (T^4 = 3/4 Teff^4 (tau + 2/3), I(mu) = B(T(tau = mu))) per
  wavelength, band-integrated per sRGB channel and fitted with the linear law 1 - u (1 - mu).

  OMP_NUM_THREADS=1 nice -n 10 python3 train_sun.py      -> data/sun_net.npz
"""
import math
import os
import sys
import time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
import nn

HERE = os.path.dirname(os.path.abspath(__file__))
CLIP = 5.0


DR_MAX, DO_MAX = 600.0, 700.0
LOG_FLOOR = -12.0


def targets(DR, DO):
    """columns (N,) -> ln rgb (N,3) of the band-integrated Rayleigh + ozone transmittance, k-normalised."""
    k = C.classic_rgb_scale()
    tau = DR[:, None] * C.BETA_R + DO[:, None] * C.BETA_O
    rgb = C.spec_to_rgb(np.exp(-tau)) * k
    return np.log(np.maximum(rgb, 0.0) + 1e-4)     # floor: out-of-gamut (negative) or negligible channels


def classic_log(DR, DO):
    return -(DR[:, None] * C.BR_CLASSIC + DO[:, None] * C.BO_CLASSIC)


def enc(DR, DO):
    return np.stack([2 * DR / DR_MAX - 1, 2 * DO / DO_MAX - 1], 1)


def limb_darkening():
    Teff = 5772.0
    mu = np.linspace(0.02, 1, 50)
    T = (0.75 * Teff ** 4 * (mu + 2.0 / 3.0)) ** 0.25
    lam = C.LAMBDA * 1e-9
    hc_k = 6.62607e-34 * 2.99792e8 / 1.380649e-23
    B = 1.0 / (lam[None, :] ** 5 * (np.exp(hc_k / (lam[None, :] * T[:, None])) - 1))
    I = B / B[-1:]
    w = C.SPEC_TO_RGB                    # (NL, 3)
    Ic = (I @ w) / w.sum(0)              # (mu, 3)
    A = (1 - mu)[:, None]
    u = -(A * (Ic - 1)).sum(0) / (A * A).sum(0)
    return u, mu, Ic


def main():
    t0 = time.time()
    rng = np.random.default_rng(5)
    # training: uniform over the rectangle plus extra density at small columns (the bright, most visible sun)
    n = 60000
    DR = np.concatenate([rng.random(n) * DR_MAX, (rng.random(n) ** 2) * 120])
    DO = np.concatenate([rng.random(n) * DO_MAX, (rng.random(n) ** 2) * 250])
    y = targets(DR, DO)
    tDR, tDO = rng.random(20000) * DR_MAX, rng.random(20000) * DO_MAX
    yt = targets(tDR, tDO)
    # weight: accuracy matters where the sun still delivers light (max channel), floor for the deep-red tail
    wfun = lambda yy: np.clip(np.exp(yy.max(1)), 1e-3, 1) ** 0.3
    w, wt = wfun(y), wfun(yt)
    net = nn.MLP([2, 24, 24, 3], np.random.default_rng(0), out_bias=y.mean(0))
    nn.train(net, enc(DR, DO), y, w, epochs=500, batch=1024, lr=4e-3, lr_end=2e-5, val=(enc(tDR, tDO), yt, wt),
             log=lambda r: print(r, flush=True))
    net.to_f32()
    pt = net.forward(enc(tDR, tDO))
    err = pt - yt
    rms = float(np.sqrt((wt[:, None] * err ** 2).sum() / (wt.sum() * 3)))
    bright = yt.max(1) > math.log(0.01)
    # colour error relative to the brightest channel (what is visible): |rgb_net - rgb_ref| / max(rgb_ref)
    cerr = lambda p: np.abs(np.exp(p) - np.exp(yt)).max(1) / np.exp(yt).max(1)
    mx = float(cerr(pt)[bright].max())
    # the classic three-wavelength colour against the same reference (what the network replaces)
    ec = classic_log(tDR, tDO) - yt
    base = float(np.sqrt((wt[:, None] * np.clip(ec, -12, 12) ** 2).sum() / (wt.sum() * 3)))
    basemx = float(cerr(classic_log(tDR, tDO))[bright].max())
    p99 = float(np.percentile(cerr(pt)[bright], 99))
    u, mu, Ic = limb_darkening()
    print('sun net: %d params; held-out weighted RMS of ln rgb %.4f (classic 3-wavelength: %.4f); max colour error '
          '|rgb - ref| / max(ref) where the sun keeps > 1%%: %.4f, p99 %.4f (classic %.4f)' % (net.n_params(), rms, base, mx, p99, basemx))
    print('limb darkening u (r, g, b) =', u)
    np.savez(os.path.join(HERE, 'data', 'sun_net.npz'), flat=net.to_f32(), sizes=np.array(net.sizes), limb_u=u,
             rms=rms, base=base, maxerr=mx, p99=p99, basemax=basemx, secs=time.time() - t0, dr_max=DR_MAX, do_max=DO_MAX,
             log_floor=LOG_FLOOR)


if __name__ == '__main__':
    main()
