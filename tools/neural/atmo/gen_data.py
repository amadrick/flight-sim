"""Generate the sky dataset: reference path tracer vs the classic LUT model at random (sun elevation, view elevation,
azimuth from the sun, camera altitude, aerosol extinction). Checkpointed: one .npz per batch in data/, skipped when it
already exists, so the job can be re-run under a time limit until complete.

  OMP_NUM_THREADS=1 nice -n 10 timeout 600 python3 gen_data.py train 0 300     # batches [0, 300) of the train split
  OMP_NUM_THREADS=1 nice -n 10 timeout 600 python3 gen_data.py test 0 12
"""
import math
import os
import sys
import time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
import pathtracer as P
import classic as K

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
BATCH = 512
MIE_RANGE = (0.018, 0.10)
ALT_MAX = 26.0
SUN_RANGE = (-18.0, 90.0)


def sample_inputs(rng, n):
    u = rng.random(n)
    sun = np.where(rng.random(n) < 0.5, SUN_RANGE[0] + (SUN_RANGE[1] - SUN_RANGE[0]) * u, -14.0 + 30.0 * u)
    h = np.where(rng.random(n) < 0.5, ALT_MAX * rng.random(n) ** 2, ALT_MAX * rng.random(n))
    c = rng.random(n)
    ef = np.where(rng.random(n) < 0.6, c * c, c)                     # fraction of the way from the horizon to the zenith
    beta = np.arccos(C.RG / (C.RG + h))
    el = ef * (math.pi / 2 + beta) - beta
    a = rng.random(n)
    az = np.where(rng.random(n) < 0.5, math.pi * a * a, math.pi * a)
    return np.radians(sun), el, az, h, ef


def run_batch(split, b):
    path = os.path.join(DATA, '%s_%04d.npz' % (split, b))
    if os.path.exists(path):
        return False
    seed = (1 if split == 'train' else 1000003) * 7919 + b
    rng = np.random.default_rng(seed)
    mie = math.exp(rng.uniform(math.log(MIE_RANGE[0]), math.log(MIE_RANGE[1])))
    sun, el, az, h, ef = sample_inputs(rng, BATCH)
    o = np.argsort(sun)                     # sub-chunks of similar sun elevation: twilight chunks get more paths
    sun, el, az, h, ef = sun[o], el[o], az[o], h[o], ef[o]
    s = P.sun_dir(sun)
    d = P.view_dir(el, az)
    cl = K.Classic(mie)
    Lcl = cl.sky(h, d, s)
    k = C.classic_rgb_scale()
    base = 16 if split == 'train' else 64
    out = {n: np.zeros((BATCH, 3)) for n in ('Ls', 'Lpk', 'Cm', 'L1')}
    Y = np.zeros(BATCH)
    for lo in range(0, BATCH, 64):
        sl = slice(lo, lo + 64)
        npth = base * (3 if np.median(sun[sl]) < math.radians(-3) else 1)
        r = P.trace(h[sl], d[sl], s[sl], np.full(len(h[sl]), mie), npth, rng)
        out['Ls'][sl] = C.spec_to_rgb(r['L'] - r['Lpeak']) * k
        out['Lpk'][sl] = C.spec_to_rgb(r['Lpeak']) * k
        out['Cm'][sl] = C.spec_to_rgb(r['Cm']) * k
        out['L1'][sl] = C.spec_to_rgb(r['L1']) * k
        Y[sl] = (r['L'] * C.SPEC_TO_Y).sum(1)
    tmp = path + '.tmp.npz'
    np.savez(tmp, sun=sun, el=el, az=az, h=h, ef=ef, mie=np.full(BATCH, mie), Lcl=Lcl, Y=Y, **out)
    os.replace(tmp, path)
    return True


def main():
    split, b0, b1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    os.makedirs(DATA, exist_ok=True)
    t0 = time.time()
    done = 0
    for b in range(b0, b1):
        if run_batch(split, b):
            done += 1
            print('%s batch %d  (%.1fs total)' % (split, b, time.time() - t0), flush=True)
    print('finished %d new batches in %.0fs' % (done, time.time() - t0))


if __name__ == '__main__':
    main()
