"""Procedural cloud density fields for the reference solver (numpy).

Every cloud is a horizontally periodic extinction field (1/m) on the sun-sheared lattice of mcrt.Medium.
Families: cumulus (heaped metaball clusters with a flat base, eroded by fBm), stratus / stratocumulus
(broken or overcast layers), homogeneous slabs, and simple homogeneous shapes (sphere / ellipsoid / box).
Extinction 0.004-0.12 1/m, cloud depth 80 m - 2.5 km, sun elevation 7-90 degrees.
"""
import math
import numpy as np

from mcrt import Medium

KINDS = ('cumulus', 'stratus', 'slab', 'shape')
KIND_P = (0.50, 0.28, 0.07, 0.15)


def _loguniform(rng, a, b):
    return math.exp(rng.uniform(math.log(a), math.log(b)))


def _smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def fbm_sheared(rng, shape, d, tan0, kmin, slope, ridged=0.0):
    """Periodic Gaussian fBm (power-law spectrum, |k|^-slope amplitude above kmin [cycles/m]) evaluated at the
    sheared-lattice voxel centres.  The shear is an exact per-layer Fourier shift, so periodicity is preserved.
    Returns a unit-variance field; `ridged` blends in a billowy 1-2|n| variant."""
    nx, ny, nz = shape
    dx, dy, dz = d
    fx = np.fft.fftfreq(nx, dx)[:, None, None]
    fy = np.fft.fftfreq(ny, dy)[None, :, None]
    fz = np.fft.fftfreq(nz, dz)[None, None, :]
    k = np.sqrt(fx * fx + fy * fy + fz * fz)
    amp = np.where(k >= kmin, np.maximum(k, 1e-12) ** (-slope), 0.0)
    if nx == 1 and ny == 1:
        amp = np.where(np.abs(fz) >= kmin, np.maximum(np.abs(fz), 1e-12) ** (-slope), 0.0)
    amp.flat[0] = 0.0
    spec = np.fft.fftn(rng.standard_normal(shape)) * amp
    g = np.fft.ifft(spec, axis=2)                                  # (kx, ky, z)
    z = (np.arange(nz) + 0.5) * dz
    g = g * np.exp(2j * math.pi * fx * (z * tan0)[None, None, :])  # shift layer k by z_k * tan(theta0) in x
    n = np.fft.ifft2(g, axes=(0, 1)).real
    s = n.std()
    n = n / s if s > 0 else n
    if ridged > 0:
        r = 1.0 - 2.0 * np.abs(n)
        r = (r - r.mean()) / (r.std() + 1e-12)
        n = (1 - ridged) * n + ridged * r
        n /= n.std() + 1e-12
    return n


def _pdist(a, c, period):
    d = a - c
    return d - period * np.round(d / period)


def make_cloud(seed, kind=None, mu0=None, nxy=None):
    """Returns (Medium, meta dict)."""
    rng = np.random.default_rng(seed)
    if kind is None:
        kind = KINDS[rng.choice(len(KINDS), p=KIND_P)]
    if mu0 is None:
        mu0 = rng.uniform(0.12, 1.0)
    tan0 = math.sqrt(1 - mu0 * mu0) / mu0
    meta = dict(seed=int(seed), kind=kind, mu0=float(mu0))
    # thin / wispy variants: a third of the clouds get a strongly reduced extinction
    sig_peak = _loguniform(rng, 0.02, 0.12)
    if rng.random() < 0.3:
        sig_peak = _loguniform(rng, 0.004, 0.03)

    if kind == 'slab':
        tau = _loguniform(rng, 0.3, 160.0)
        nz = 64
        h = tau / sig_peak
        sig = np.full((1, 1, nz), sig_peak, dtype=np.float32)
        if rng.random() < 0.5:                                   # vertically stratified slab (same optical depth)
            prof = np.linspace(rng.uniform(0.2, 1.0), 1.0, nz) ** rng.uniform(0.5, 2.0)
            if rng.random() < 0.3:
                prof = prof[::-1]
            sig[0, 0, :] = sig_peak * prof / prof.mean()
        meta.update(sig_peak=float(sig.max()), tau_vertical=float(tau), height=float(h))
        return Medium(sig, 1e7, 1e7, h / nz, mu0), meta

    nx = ny = int(nxy or rng.choice([96, 128]))
    nz = 64

    if kind == 'cumulus':
        hc = _loguniform(rng, 200.0, 2500.0)                     # cloud depth
        lxy = max(_loguniform(rng, 1500.0, 6000.0), 1.6 * hc)
        H = hc * rng.uniform(1.25, 1.5)
        zb = 0.06 * H
        d = (lxy / nx, lxy / ny, H / nz)
        med0 = Medium(np.zeros((nx, ny, nz), np.float32), d[0], d[1], d[2], mu0)
        X, Y, Z = med0.voxel_centres()
        s = np.full((nx, ny, nz), -10.0)
        ncl = int(rng.integers(1, 5))
        for _ in range(ncl):
            cx, cy = rng.uniform(0, lxy, 2)
            rc = rng.uniform(0.18, 0.45) * min(lxy, 2.5 * hc)
            top = rng.uniform(0.55, 1.0) * hc
            for _b in range(int(rng.integers(4, 11))):
                ang = rng.uniform(0, 2 * math.pi)
                rad = rc * math.sqrt(rng.random()) * 0.8
                rb = rng.uniform(0.35, 0.8) * min(rc, top)
                bz = zb + rng.uniform(0.15, 1.0) * max(top - rb, 0.2 * rb)
                bx, by = cx + rad * math.cos(ang), cy + rad * math.sin(ang)
                rr = (_pdist(X, bx, lxy) ** 2 + _pdist(Y, by, lxy) ** 2 + ((Z - bz) * rng.uniform(0.8, 1.3)) ** 2) / (rb * rb)
                s = np.maximum(s, 1.0 - rr)
        amp = rng.uniform(0.25, 0.75)
        n = fbm_sheared(rng, (nx, ny, nz), d, tan0, kmin=1.0 / min(lxy, 3 * hc), slope=rng.uniform(1.5, 2.0),
                        ridged=rng.uniform(0, 0.7))
        edge = rng.uniform(0.12, 0.6)
        dens = _smoothstep(0.0, edge, s + amp * n) * _smoothstep(zb, zb + rng.uniform(0.02, 0.12) * hc, Z)
        hrel = np.clip((Z - zb) / hc, 0, 1)
        prof = (rng.uniform(0.25, 1.0) + (1 - rng.uniform(0.0, 0.6)) * hrel)          # LWC growing with height
        dens = dens * prof / prof.max()
        meta.update(depth=float(hc), lxy=float(lxy))
    elif kind == 'stratus':
        th = _loguniform(rng, 80.0, 900.0)
        lxy = _loguniform(rng, 2000.0, 9000.0)
        H = th * rng.uniform(1.5, 2.0)
        zc = 0.5 * H
        d = (lxy / nx, lxy / ny, H / nz)
        med0 = Medium(np.zeros((nx, ny, nz), np.float32), d[0], d[1], d[2], mu0)
        X, Y, Z = med0.voxel_centres()
        n2 = fbm_sheared(rng, (nx, ny, nz), d, tan0, kmin=1.0 / lxy, slope=rng.uniform(1.6, 2.2))
        # 2-D thickness modulation: take the mid layer of an fBm, un-shear is irrelevant for a random field
        n3 = fbm_sheared(rng, (nx, ny, nz), d, tan0, kmin=2.0 / lxy, slope=rng.uniform(1.4, 1.9),
                         ridged=rng.uniform(0, 0.8))
        cover = rng.uniform(-0.35, 0.9)                           # < 0.2: broken stratocumulus, > 0.5 overcast
        half = 0.5 * th * np.clip(1.0 + 0.35 * n2, 0.25, 1.8)
        s = (1.0 - np.abs(Z - zc) / half) + cover - 0.5 + rng.uniform(0.2, 0.6) * n3
        s = np.where(np.abs(Z - zc) < 0.5 * th * 1.45, s, -10.0)  # keep a clear margin above and below
        dens = _smoothstep(0.0, rng.uniform(0.15, 0.6), s)
        if rng.random() < 0.6:
            hrel = np.clip((Z - (zc - 0.5 * th)) / th, 0, 1)
            dens = dens * (0.4 + 0.6 * hrel)
        meta.update(depth=float(th), lxy=float(lxy), cover=float(cover))
    else:  # simple homogeneous shapes, for validation-style coverage
        r = _loguniform(rng, 80.0, 900.0)
        asp = rng.uniform(0.4, 1.0)                               # vertical semi-axis / horizontal semi-axis
        lxy = r * rng.uniform(2.6, 6.0)
        H = 2 * r * asp * 1.15
        d = (lxy / nx, lxy / ny, H / nz)
        med0 = Medium(np.zeros((nx, ny, nz), np.float32), d[0], d[1], d[2], mu0)
        X, Y, Z = med0.voxel_centres()
        px, py, pz = _pdist(X, lxy / 2, lxy) / r, _pdist(Y, lxy / 2, lxy) / r, (Z - H / 2) / (r * asp)
        which = rng.integers(0, 3)
        if which == 0:
            rr = np.sqrt(px * px + py * py + pz * pz)
        elif which == 1:
            rr = np.maximum(np.maximum(np.abs(px), np.abs(py)), np.abs(pz))
        else:
            rr = np.maximum(np.sqrt(px * px + py * py), np.abs(pz))  # cylinder
        if rng.random() < 0.5:
            dens = (rr < 1.0).astype(np.float64)
        else:
            dens = _smoothstep(1.0, rng.uniform(0.2, 0.8), rr)        # soft radial fall-off
        meta.update(depth=float(2 * r * asp), lxy=float(lxy), shape=int(which))

    sig = (sig_peak * np.clip(dens, 0, 1)).astype(np.float32)
    sig[sig < 1e-5] = 0.0
    med = Medium(sig, d[0], d[1], d[2], mu0)
    col = sig.sum(axis=2) * d[2] / 1.0
    meta.update(sig_peak=float(sig.max()), tau_vertical_max=float(col.max()),
                tau_vertical_mean_cloudy=float(col[col > 0.05].mean()) if (col > 0.05).any() else 0.0,
                cover_fraction=float((col > 0.5).mean()), height=float(H))
    return med, meta


if __name__ == '__main__':
    import time
    for sd in range(12):
        t = time.time()
        med, meta = make_cloud(1000 + sd)
        print('%.2fs' % (time.time() - t), {k: (round(v, 3) if isinstance(v, float) else v) for k, v in meta.items()})
