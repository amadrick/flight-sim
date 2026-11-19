"""Extra samples for the aerosol column Cm near the sun (the aureole): directions within 25 deg of the sun, single
scattering only (deterministic quadrature, no Monte Carlo paths), so this is cheap.

  OMP_NUM_THREADS=1 nice -n 10 timeout 600 python3 gen_aureole.py train 0 60
"""
import math
import os
import sys
import time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
import pathtracer as P
import gen_data as G

BATCH = 4096


def run_batch(split, b):
    path = os.path.join(G.DATA, 'aur%s_%04d.npz' % (split, b))
    if os.path.exists(path):
        return False
    rng = np.random.default_rng((7 if split == 'train' else 70001) * 104729 + b)
    n = BATCH
    sun = np.radians(np.where(rng.random(n) < 0.5, rng.uniform(-3, 90, n), rng.uniform(-3, 20, n)))
    h = np.where(rng.random(n) < 0.5, G.ALT_MAX * rng.random(n) ** 2, G.ALT_MAX * rng.random(n))
    mie = np.exp(rng.uniform(math.log(G.MIE_RANGE[0]), math.log(G.MIE_RANGE[1]), n))
    gam = np.radians(25.0 * rng.random(n) ** 1.5)
    psi = rng.random(n) * 2 * math.pi
    s = P.sun_dir(sun)
    # rotate the sun direction by gam around a random axis perpendicular to it
    a = np.stack([-np.sin(sun), np.cos(sun), np.zeros(n)], 1)        # 'up' in the sun's vertical plane
    bvec = np.cross(s, a)
    d = s * np.cos(gam)[:, None] + np.sin(gam)[:, None] * (np.cos(psi)[:, None] * a + np.sin(psi)[:, None] * bvec)
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    beta = np.arccos(C.RG / (C.RG + h))
    el = np.arcsin(np.clip(d[:, 1], -1, 1))
    ok = el > -beta
    d, sun, h, mie, el, beta = d[ok], sun[ok], h[ok], mie[ok], el[ok], beta[ok]
    s = P.sun_dir(sun)
    az = np.abs(np.arctan2(d[:, 2], d[:, 0]))
    ef = (el + beta) / (math.pi / 2 + beta)
    k = C.classic_rgb_scale()
    Cm = np.zeros((len(h), 3))
    for lo in range(0, len(h), 512):
        sl = slice(lo, lo + 512)
        r = P.trace(h[sl], d[sl], s[sl], mie[sl], 0, rng)
        Cm[sl] = C.spec_to_rgb(r['Cm']) * k
    tmp = path + '.tmp.npz'
    np.savez(tmp, sun=sun, el=el, az=az, h=h, ef=ef, mie=mie, Cm=Cm)
    os.replace(tmp, path)
    return True


def main():
    split, b0, b1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    t0 = time.time()
    for b in range(b0, b1):
        if run_batch(split, b):
            print('aureole %s batch %d (%.1fs)' % (split, b, time.time() - t0), flush=True)


if __name__ == '__main__':
    main()
