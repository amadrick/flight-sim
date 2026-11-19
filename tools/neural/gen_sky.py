"""Dataset for the sky-light visibility network: V(tauUp, tauDown).

  NUMBA_NUM_THREADS=2 .venv/bin/python gen_sky.py --split train --clouds 300 --samples 2000 --paths 64
  NUMBA_NUM_THREADS=2 .venv/bin/python gen_sky.py --split test  --clouds 60  --samples 2000 --paths 256

V(x) = fraction of the light of a uniform sky dome (upper hemisphere, black ground) that reaches x, all orders of
scattering, direction-averaged (see mcrt.sky_visibility_batch).  Same procedural clouds and split seeds as the
sun-scattering dataset.  Output data/sky_<split>.npz: tau_up, tau_down, va, vb (independent halves), kind, cloud.
"""
import argparse
import os
import sys
import time
import numpy as np

from clouds import make_cloud, KINDS
from gen_dataset import SEED0, sample_points


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--split', default='train')
    ap.add_argument('--clouds', type=int, default=300)
    ap.add_argument('--samples', type=int, default=2000)
    ap.add_argument('--paths', type=int, default=64)
    a = ap.parse_args()
    os.makedirs('data', exist_ok=True)
    t0 = time.time()
    TU, TD, VA, VB, KD, CL = [], [], [], [], [], []
    for c in range(a.clouds):
        seed = SEED0[a.split] + c
        med, meta = make_cloud(seed)
        if med.sig.max() <= 0:
            continue
        rng = np.random.default_rng(seed * 104729 + 3)
        pos, w, _ = sample_points(med, a.samples, rng, seed)
        feat = med.features(pos, w)
        v = med.sky_visibility(pos, a.paths, seed=seed)
        TU.append(feat[:, 1].astype(np.float32))
        TD.append(feat[:, 3].astype(np.float32))
        VA.append(v[:, 0].astype(np.float32))
        VB.append(v[:, 1].astype(np.float32))
        KD.append(np.full(len(pos), KINDS.index(meta['kind']), dtype=np.int8))
        CL.append(np.full(len(pos), c, dtype=np.int32))
        if c % 20 == 0:
            print('[sky %s %4d] %-8s mean V %.3f  (%.1f min)' % (a.split, c, meta['kind'], v.mean(), (time.time() - t0) / 60))
            sys.stdout.flush()
    out = 'data/sky_%s.npz' % a.split
    np.savez_compressed(out, tau_up=np.concatenate(TU), tau_down=np.concatenate(TD), va=np.concatenate(VA),
                        vb=np.concatenate(VB), kind=np.concatenate(KD), cloud=np.concatenate(CL),
                        paths=np.int32(a.paths), minutes=np.float32((time.time() - t0) / 60))
    print('wrote %s: %d samples, %d clouds, %d paths each, %.1f min' % (
        out, sum(len(x) for x in VA), len(VA), a.paths, (time.time() - t0) / 60))


if __name__ == '__main__':
    main()
