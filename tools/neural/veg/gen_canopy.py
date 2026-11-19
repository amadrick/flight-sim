"""Generate the forest-canopy datasets with the path tracer (canopy_mc.py).

  OMP_NUM_THREADS=1 nice -n 10 timeout 600 python3 gen_canopy.py --seed 1 --stands 45 --out data/canopy_1.npz

Per stand (random cover, conifer share): 40 view directions x 2000 rays, 8 sun elevations ->
  brf rows:   [mu_s, mu_v, cos(rel. azimuth), cover, conifer] -> [BRF r, g, b, gap fraction, sunlit fraction]
  crown rows: [h_rel, d_rel, cos(azimuth to sun), mu_s, cover, group] -> [sun transmittance, sky visibility]
"""
import argparse
import math
import os
import time
import numpy as np

import canopy_mc as C

SUN_ELEVS = [math.radians(e) for e in (3.0, 7.0, 13.0, 21.0, 31.0, 44.0, 60.0, 80.0)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--stands', type=int, default=40)
    ap.add_argument('--views', type=int, default=40)
    ap.add_argument('--rays', type=int, default=2000)
    ap.add_argument('--out', default='data/canopy.npz')
    ap.add_argument('--crown-only', action='store_true', help='skip the path tracing (crown transfer data only)')
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    X, Y, CX, CY = [], [], [], []
    t0 = time.time()
    for s in range(a.stands):
        cover = float(np.clip(rng.random() ** 0.8 * 1.04, 0.03, 1.0))
        r = rng.random()
        conif = 0.0 if r < 0.33 else 1.0 if r < 0.66 else float(rng.random())
        st = C.make_stand(rng, cover, conif)
        # view directions: stratified in (mu_v, azimuth)
        nv = a.views
        mu_lo = math.sin(math.radians(3.0))
        u = (np.arange(nv) + rng.random(nv)) / nv
        mu = mu_lo + (1 - mu_lo) * (u ** 1.3)              # a little denser near the horizon (that is where it varies)
        az = math.pi * rng.permutation((np.arange(nv) + rng.random(nv)) / nv)
        sv = np.sqrt(1 - mu * mu)
        views = np.stack([sv * np.cos(az), sv * np.sin(az), mu], 1)
        if a.crown_only:
            brf = np.zeros((nv, len(SUN_ELEVS), 3)); gap = np.zeros(nv); sunlit = np.zeros((nv, len(SUN_ELEVS)))
        else:
            brf, gap, sunlit = C.trace_brf(st, views, a.rays, SUN_ELEVS, rng)
        for k, e in enumerate(SUN_ELEVS):
            if a.crown_only:
                break
            X.append(np.stack([np.full(nv, math.sin(e)), mu, np.cos(az), np.full(nv, cover), np.full(nv, conif)], 1))
            Y.append(np.concatenate([brf[:, k, :], gap[:, None], sunlit[:, k:k + 1]], 1))
        f, tsun, sky, g = C.crown_samples(st, SUN_ELEVS, rng, per_tree=24)
        if len(f):
            CX.append(np.concatenate([f, np.full((len(f), 1), cover), g[:, None]], 1))
            CY.append(np.stack([tsun, sky], 1))
        print(f'stand {s + 1}/{a.stands} cover {cover:.2f} conifer {conif:.2f} trees {len(st["trees"])} '
              f'brf(nadir-ish g) {brf[np.argmax(mu), 4, 1]:.4f}  {time.time() - t0:.0f}s', flush=True)
    np.savez_compressed(a.out, X=(np.concatenate(X) if X else np.zeros((0, 5))).astype(np.float32), Y=(np.concatenate(Y) if Y else np.zeros((0, 5))).astype(np.float32),
                        CX=np.concatenate(CX).astype(np.float32), CY=np.concatenate(CY).astype(np.float32))
    print('wrote', a.out)


if __name__ == '__main__':
    main()
