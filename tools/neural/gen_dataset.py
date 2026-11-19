"""Dataset generation: path-traced multiple-scattering source function J_ms at random points / view directions
inside procedural clouds, with the ray-integrated features the real-time renderer will have.

  NUMBA_NUM_THREADS=2 .venv/bin/python gen_dataset.py --split train --clouds 300 --samples 2500 --paths 48
  NUMBA_NUM_THREADS=2 .venv/bin/python gen_dataset.py --split val   --clouds 48  --samples 1500 --paths 192
  NUMBA_NUM_THREADS=2 .venv/bin/python gen_dataset.py --split test  --clouds 48  --samples 1500 --paths 192

Splits use disjoint cloud seeds (train 10000+, val 20000+, test 30000+), i.e. validation / test clouds are
shapes the network has never seen.  Output: data/<split>.npz with
  feat  (N,8)  tauSun, tauUp, cosTheta, tauDown, tauView, sigma_local, mu0, z/H
  ja,jb (N,)   two independent half-estimates of J_ms (sr^-1 per unit sun irradiance)
  j2    (N,)   mean square of single-path estimates (noise level), nsc mean scattering events per path
  cloud (N,)   cloud index, kind (N,) family index, stype (N,) 0 = camera first-collision sample, 1 = interior
"""
import argparse
import json
import math
import os
import sys
import time
import numpy as np

from clouds import make_cloud, KINDS

SEED0 = dict(train=10000, val=20000, test=30000)


def _unit(v):
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def _around(rng, axis, n, th_min_deg=0.03, th_max_deg=120.0):
    """Directions at log-uniform angle from `axis` (resolves the forward-scattering peak)."""
    th = np.exp(rng.uniform(math.log(math.radians(th_min_deg)), math.log(math.radians(th_max_deg)), n))
    phi = rng.uniform(0, 2 * math.pi, n)
    a = np.asarray(axis, dtype=np.float64)
    t1 = np.cross(a, [0.0, 1.0, 0.0])
    t1 /= np.linalg.norm(t1)
    t2 = np.cross(a, t1)
    return (np.sin(th) * np.cos(phi))[:, None] * t1 + (np.sin(th) * np.sin(phi))[:, None] * t2 + np.cos(th)[:, None] * a


def _lattice_to_world(med, u):
    z = u[:, 2] * med.dz
    return np.column_stack([u[:, 0] * med.dx + z * med.tan0, u[:, 1] * med.dy, z])


def sample_points(med, n, rng, seed):
    """Returns pos (n,3), w (n,3) [direction of light travel toward the viewer], stype (n,)."""
    nx, ny, nz = med.shape
    H = med.size[2]
    L = med.sun_dir
    n_cam = int(round(0.55 * n))
    n_int = n - n_cam
    pos_l, w_l, st_l = [], [], []

    # ---- (a) camera samples: first collision of camera rays = distribution of image contributions sigma*T_view
    sig = med.sig
    clear = np.flatnonzero(sig.ravel() <= 0.0)
    got = 0
    tries = 0
    while got < n_cam and tries < 12:
        tries += 1
        m = int((n_cam - got) * 2.5) + 64
        v = _unit(rng.standard_normal((m, 3)))                 # camera-ray travel direction
        tow = rng.random(m) < 0.5                              # half of the rays look toward the sun (silver lining)
        v[tow] = _around(rng, L, int(tow.sum()))
        org = np.empty((m, 3))
        from_air = (rng.random(m) < 0.5) & (len(clear) > 0)
        # origins on the top / bottom plane
        org[:, 0] = rng.uniform(0, med.size[0], m)
        org[:, 1] = rng.uniform(0, med.size[1], m)
        org[:, 2] = np.where(v[:, 2] < 0, H * (1 - 1e-9), H * 1e-9)
        if from_air.any():
            idx = clear[rng.integers(0, len(clear), int(from_air.sum()))]
            ii, jj, kk = np.unravel_index(idx, sig.shape)
            u = np.column_stack([ii, jj, kk]) + rng.random((len(idx), 3))
            org[from_air] = _lattice_to_world(med, u)
        p, ok = med.camera_points(org, v, seed=seed + 17 * tries)
        p, v = p[ok][: n_cam - got], v[ok][: n_cam - got]
        pos_l.append(p)
        w_l.append(-v)
        st_l.append(np.zeros(len(p), dtype=np.int8))
        got += len(p)
    n_int = n - got

    # ---- (b) interior samples: uniform in optical mass (camera inside the cloud / deep march samples)
    pr = sig.ravel().astype(np.float64)
    pr /= pr.sum()
    idx = rng.choice(len(pr), size=n_int, p=pr)
    ii, jj, kk = np.unravel_index(idx, sig.shape)
    u = np.column_stack([ii, jj, kk]) + rng.random((n_int, 3))
    p = _lattice_to_world(med, u)
    w = _unit(rng.standard_normal((n_int, 3)))
    fw = rng.random(n_int) < 0.4
    w[fw] = _around(rng, -L, int(fw.sum()))
    pos_l.append(p)
    w_l.append(w)
    st_l.append(np.ones(n_int, dtype=np.int8))
    return np.concatenate(pos_l), np.concatenate(w_l), np.concatenate(st_l)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--split', default='train')
    ap.add_argument('--clouds', type=int, default=300)
    ap.add_argument('--samples', type=int, default=2500)
    ap.add_argument('--paths', type=int, default=48)
    ap.add_argument('--first', type=int, default=0, help='first cloud index (to extend a split)')
    ap.add_argument('--minutes', type=float, default=1e9, help='stop early after this wall time')
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    os.makedirs('data', exist_ok=True)
    out = a.out or 'data/%s.npz' % a.split
    t0 = time.time()
    F, JA, JB, J2, NS, CL, KD, ST, metas = [], [], [], [], [], [], [], [], []
    cut_total = 0.0
    for c in range(a.first, a.first + a.clouds):
        seed = SEED0[a.split] + c
        tc = time.time()
        med, meta = make_cloud(seed)
        if med.sig.max() <= 0 or med.sig.sum() * med.dz < 1e-3:
            continue
        rng = np.random.default_rng(seed * 7919 + 1)
        pos, w, stype = sample_points(med, a.samples, rng, seed)
        feat = med.features(pos, w)
        res = med.estimate(pos, w, a.paths, seed=seed)
        F.append(feat.astype(np.float32))
        JA.append(res[:, 0].astype(np.float32))
        JB.append(res[:, 1].astype(np.float32))
        J2.append(res[:, 2].astype(np.float32))
        NS.append(res[:, 3].astype(np.float32))
        CL.append(np.full(len(pos), c, dtype=np.int32))
        KD.append(np.full(len(pos), KINDS.index(meta['kind']), dtype=np.int8))
        ST.append(stype)
        cut_total += res[:, 4].sum()
        meta.update(index=c, n=len(pos), seconds=time.time() - tc, mean_scatter=float(res[:, 3].mean()),
                    cut_fraction=float(res[:, 4].mean()))
        metas.append(meta)
        print('[%s %4d] %-8s mu0=%.2f sig=%.3f tau_sun med/max=%6.1f/%6.1f  <scat>=%5.0f  %.1fs  (total %.1f min)' % (
            a.split, c, meta['kind'], meta['mu0'], meta['sig_peak'], np.median(feat[:, 0]), feat[:, 0].max(),
            res[:, 3].mean(), time.time() - tc, (time.time() - t0) / 60))
        sys.stdout.flush()
        if (time.time() - t0) / 60 > a.minutes:
            print('time budget reached, stopping after %d clouds' % (c - a.first + 1))
            break
    n = sum(len(x) for x in JA)
    np.savez_compressed(out, feat=np.concatenate(F), ja=np.concatenate(JA), jb=np.concatenate(JB), j2=np.concatenate(J2),
                        nsc=np.concatenate(NS), cloud=np.concatenate(CL), kind=np.concatenate(KD), stype=np.concatenate(ST),
                        paths=np.int32(a.paths))
    info = dict(split=a.split, clouds=len(metas), samples=int(n), paths_per_sample=a.paths, total_paths=int(n) * a.paths,
                scatter_events=float(sum(m['mean_scatter'] * m['n'] for m in metas) * a.paths),
                cut_fraction=float(cut_total / max(n, 1)), minutes=(time.time() - t0) / 60, clouds_meta=metas)
    with open(out.replace('.npz', '.json'), 'w') as f:
        json.dump(info, f)
    print('wrote %s: %d samples from %d clouds, %.2e paths, %.2e scattering events, %.1f min' % (
        out, n, len(metas), info['total_paths'], info['scatter_events'], info['minutes']))


if __name__ == '__main__':
    main()
