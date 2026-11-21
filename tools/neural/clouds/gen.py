"""Training / validation data: path-traced J_ms, V_sky, V_gnd at the samples a camera actually sees.

    NUMBA_NUM_THREADS=2 nice $VENV tools/neural/clouds/gen.py [--only substr] [--pts 1200] [--nA 48 --nB 16]

Per config (scene x sun direction) -> data/pts/<config>.npz (skipped when present: re-running resumes).
Points: random camera rays through random cloudy voxels (directions uniform on the sphere, so every sun-view angle
and every camera altitude relative to the cloud occurs); along each ray ONE point drawn with pdf ~ T(t) sigma(t),
i.e. with the weight it has in the image; the ray's opacity (1 - T_total) is stored as the point's image weight.
Stored per point: position, ray direction, sun direction, scene meta, path-traced answers (pt.estimate), the exact
multi-scale optical depths (features.multi_tau) and column extents (for the shipped model's height proxies).
"""
import argparse
import math
import os
import sys
import time
import zlib

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pt  # noqa: E402
import scenes as S  # noqa: E402
import features as F  # noqa: E402

OUT = os.path.join(pt.DATA, 'pts')

# (builder, kwargs, split) ; split 'val' = held out scene (never trained on)
SCENES = [
    ('game', dict(name='near1', scale=1.0), 'train'),
    ('game', dict(name='near1', scale=0.5), 'train'),
    ('game', dict(name='near1', scale=1.6), 'val'),
    ('game', dict(name='scattered3', scale=1.0), 'train'),
    ('game', dict(name='scattered3', scale=2.5), 'train'),
    ('game', dict(name='broken3', scale=1.0), 'train'),
    ('game', dict(name='broken3', scale=2.5), 'val'),
    ('game', dict(name='brokenB', scale=1.6), 'train'),
    ('les', dict(case='les_bomex_hr', snap=-1, n_cm3=100.0), 'train'),
    ('les', dict(case='les_bomex_hr', snap=-12, n_cm3=500.0), 'train'),
    ('les', dict(case='les_congestus', snap=-1, n_cm3=150.0, h=30.0), 'val'),
    ('les', dict(case='les_congestus', snap=-15, n_cm3=600.0, h=30.0), 'train'),
    ('sphere', dict(radius=300.0, sigma=0.02, h=10.0), 'train'),
    ('sphere', dict(radius=600.0, sigma=0.06, h=20.0, noise=0.15, seed=1), 'val'),
    ('sphere', dict(radius=450.0, sigma=0.1, h=15.0, noise=0.3, seed=2), 'train'),
    ('deck', dict(thickness=400.0, sigma=0.04, holes=0.3, seed=0), 'train'),
    ('deck', dict(thickness=1500.0, sigma=0.06, h=30.0, size=3840.0, seed=1, base=600.0), 'train'),
    ('deck', dict(thickness=250.0, sigma=0.02, holes=0.1, seed=2, h=15.0, size=1920.0), 'val'),
    ('deck', dict(thickness=900.0, sigma=0.09, h=25.0, size=3200.0, top_noise=0.4, seed=3), 'train'),
    ('cumulus', dict(seed=0, sigma=0.05), 'train'),
    ('cumulus', dict(seed=1, sigma=0.1, height=1800.0, width=1600.0, h=25.0), 'train'),
    ('cumulus', dict(seed=2, sigma=0.03, height=800.0, width=1100.0, h=15.0), 'train'),
    ('cumulus', dict(seed=3, sigma=0.075, height=1400.0, width=1500.0), 'val'),
    ('cumulus', dict(seed=4, sigma=0.15, height=1000.0, width=1200.0, h=15.0), 'train'),
    ('storm', dict(seed=0, sigma=0.1), 'train'),
    ('storm', dict(seed=1, sigma=0.16, height=8000.0, width=4000.0, h=60.0), 'val'),
    ('wisp', dict(seed=0, sigma=0.006), 'train'),
    ('wisp', dict(seed=1, sigma=0.02), 'train'),
    ('wisp', dict(seed=2, sigma=0.012), 'val'),
]
SUN_ELEVS = [3.0, 8.0, 15.0, 25.0, 40.0, 60.0, 85.0]
# round two: the game's current fields (re-exported from src/clouds/shaders.js with their base density), multi-cloud
# boxes, more congestus, and more low sun (the weak regimes of round one)
SCENES2 = [
    ('game', dict(name='r5scattered', scale=1.0), 'train'),
    ('game', dict(name='r5broken', scale=1.0), 'train'),
    ('game', dict(name='r5near', scale=1.0), 'train'),
    ('game', dict(name='r5overcast', scale=1.0), 'train'),
    ('game', dict(name='r5storm', scale=1.0), 'train'),
    ('game', dict(name='r5scattered2', scale=1.0), 'val'),
    ('cumulus_field', dict(seed=0), 'train'),
    ('cumulus_field', dict(seed=1, n=10, sigma=(0.05, 0.15)), 'train'),
    ('cumulus_field', dict(seed=2, n=8), 'val'),
    ('les', dict(case='les_congestus', snap=-6, n_cm3=300.0, h=30.0), 'train'),
    ('les', dict(case='les_congestus', snap=-25, n_cm3=150.0, h=30.0), 'train'),
    ('game', dict(name='near1', scale=1.0), 'train'),
    ('game', dict(name='scattered3', scale=1.0), 'train'),
]
SUN_ELEVS2 = [2.0, 4.0, 6.0, 9.0, 13.0, 30.0, 55.0]
# round three (round seven of the cloud shapes): the game's eroded cauliflower fields with the base density the learned-MS
# taps actually sample (harness exportDensity noBub0: 1, i.e. without the bubble octave), at a ~10 m footprint
SCENES3 = [
    ('game', dict(name='r7fair', scale=1.0), 'train'),
    ('game', dict(name='r7scat', scale=1.0), 'train'),
    ('game', dict(name='r7near', scale=1.0), 'train'),
    ('game', dict(name='r7broken', scale=1.0), 'train'),
    ('game', dict(name='r7scat2', scale=1.0), 'val'),
]
SUN_ELEVS3 = [4.0, 8.0, 15.0, 25.0, 40.0, 60.0, 75.0]


def build(kind, kw):
    if kind == 'game':
        d = S.game_field(**kw)
    elif kind == 'les':
        d = S.les_field(**kw)
    else:
        d = getattr(S, kind)(**kw)
    sc = pt.Scene(d['sig'], d['h'], d['origin'], periodic=d.get('periodic', False), name=d['name'])
    sc.kind = d['kind']
    sc.base = d.get('base')
    sc.sigma_ref = float(d.get('sigma_ref', np.percentile(d['sig'][d['sig'] > 0], 99) if (d['sig'] > 0).any() else 1.0))
    return sc


def sample_rays(sc, n, rng, max_len=9000.0):
    """Rays through random cloudy voxels; returns camera positions, directions, sampled points, opacities."""
    sig = sc.sig
    thr = 0.05 * sig.max()
    idx = np.argwhere(sig > thr)
    sel = idx[rng.integers(0, len(idx), n * 2)]
    lo, hi = sc.extent
    cams, rds, pts, ops, tcam = [], [], [], [], []
    for v in sel:
        if len(pts) >= n:
            break
        tgt = sc.o + (v + rng.random(3)) * sc.h
        u = rng.random(2)
        z = 2 * u[0] - 1
        r = math.sqrt(1 - z * z)
        rd = np.array([r * math.cos(2 * math.pi * u[1]), z, r * math.sin(2 * math.pi * u[1])])
        # entry: back along -rd to the box (y-slab for periodic scenes), capped
        t_back = max_len
        for a in range(3):
            if a != 1 and sc.per:
                continue
            if rd[a] > 1e-9:
                t_back = min(t_back, (tgt[a] - lo[a]) / rd[a])
            elif rd[a] < -1e-9:
                t_back = min(t_back, (tgt[a] - hi[a]) / rd[a])
        t_fwd = max_len
        for a in range(3):
            if a != 1 and sc.per:
                continue
            if rd[a] > 1e-9:
                t_fwd = min(t_fwd, (hi[a] - tgt[a]) / rd[a])
            elif rd[a] < -1e-9:
                t_fwd = min(t_fwd, (lo[a] - tgt[a]) / rd[a])
        cam = tgt - rd * (t_back + 1.0)
        L = t_back + 1.0 + t_fwd
        ns = max(int(L / (0.5 * sc.h)), 8)
        ts = (np.arange(ns) + 0.5) * (L / ns)
        P = cam[None, :] + ts[:, None] * rd[None, :]
        s = F.local_sigma(sc, P)
        dt = L / ns
        tau = np.concatenate([[0.0], np.cumsum(s * dt)])
        w = np.exp(-tau[:-1]) * (1 - np.exp(-s * dt))
        tot = w.sum()
        if tot < 1e-3:
            continue
        k = rng.choice(ns, p=w / tot)
        # position inside the step, distributed ~ exp(-sigma t) within it
        sk = max(s[k], 1e-9)
        uu = rng.random()
        tin = -math.log(1 - uu * (1 - math.exp(-sk * dt))) / sk
        p = cam + rd * (ts[k] - 0.5 * dt + tin)
        cams.append(cam); rds.append(rd); pts.append(p); ops.append(tot); tcam.append(tau[k] + sk * tin)
    return np.array(cams), np.array(rds), np.array(pts), np.array(ops), np.array(tcam)


def run_config(kind, kw, split, elev, az, args, rng):
    sc = build(kind, kw)
    name = f'{sc.name}_e{elev:g}'
    path = os.path.join(OUT, name + '.npz')
    if os.path.exists(path):
        return
    e, a = math.radians(elev), math.radians(az)
    L = np.array([math.cos(e) * math.cos(a), math.sin(e), math.cos(e) * math.sin(a)])
    t0 = time.time()
    sc.set_sun(L)
    t1 = time.time()
    cams, rds, P, ops, tcam = sample_rays(sc, args.pts, rng)
    D = -rds
    ph = pt.Phase(args.reff, 'G', 4.0)
    t2 = time.time()
    res = pt.estimate(sc, ph, P, D, nA=args.nA, nB=args.nB, seed0=int(rng.integers(1 << 30)))
    t3 = time.time()
    Dirs = F.directions(L, rds)
    mt = F.multi_tau(sc, P, Dirs)
    sig_p = F.local_sigma(sc, P)
    top, bot = S.column_extent(sc.sig, sc.h, sc.o[1])
    ii = np.clip(((P[:, 0] - sc.o[0]) / sc.h).astype(int), 0, sc.sig.shape[0] - 1)
    kk = np.clip(((P[:, 2] - sc.o[2]) / sc.h).astype(int), 0, sc.sig.shape[2] - 1)
    ctop, cbot = top[ii, kk], bot[ii, kk]
    tau_sun = mt[:, 0, -1]
    cos_t = rds @ L
    jss, jfp = pt.deterministic_terms(ph, cos_t, tau_sun)
    np.savez_compressed(path, P=P, rd=rds, cam=cams, L=L, opacity=ops, tau_cam=tcam, res=res, mt=mt, sig=sig_p,
                        ctop=ctop, cbot=cbot, jss=jss, jfp=jfp, cos_t=cos_t, elev=elev, sigma_ref=sc.sigma_ref,
                        h=sc.h, kind=sc.kind, split=split, scene=sc.name, reff=ph.reff, f=ph.f)
    print(f'{name:40s} {split:5s} n={len(P)} sun-grid {t1 - t0:.1f}s rays {t2 - t1:.1f}s walks {t3 - t2:.1f}s '
          f'feat {time.time() - t3:.1f}s | Jms med {np.median(res[:, 1]):.3f} Vsky med {np.median(res[:, 4]):.3f} '
          f'rel.err med {np.median(np.sqrt(res[:, 9]) / (res[:, 1] + 1e-3)):.3f}', flush=True)


def main():
    global OUT
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--pts', type=int, default=1200)
    ap.add_argument('--nA', type=int, default=48)
    ap.add_argument('--nB', type=int, default=16)
    ap.add_argument('--reff', type=float, default=10.0)
    ap.add_argument('--suns', type=int, default=3, help='sun elevations per scene')
    ap.add_argument('--shard', default='0/1')
    ap.add_argument('--out', default='')
    ap.add_argument('--round', type=int, default=1)
    args = ap.parse_args()
    OUT = args.out or OUT
    os.makedirs(OUT, exist_ok=True)
    si, sn = (int(v) for v in args.shard.split('/'))
    jobs = []
    if args.round == 1:
        for i, (kind, kw, split) in enumerate(SCENES):
            rng = np.random.default_rng(1000 + i)
            el = rng.choice(SUN_ELEVS, size=args.suns, replace=False)
            for e in el:
                jobs.append((kind, kw, split, float(e), float(rng.random() * 360)))
    elif args.round == 3:
        for i, (kind, kw, split) in enumerate(SCENES3):
            rng = np.random.default_rng(7000 + i)
            el = rng.choice(SUN_ELEVS3, size=args.suns, replace=False)
            for e in el:
                jobs.append((kind, kw, split, float(e), float(rng.random() * 360)))
    else:
        for i, (kind, kw, split) in enumerate(SCENES2):
            rng = np.random.default_rng(5000 + i)
            el = rng.choice(SUN_ELEVS2, size=args.suns, replace=False)
            for e in el:
                jobs.append((kind, kw, split, float(e), float(rng.random() * 360)))
    for j, (kind, kw, split, e, az) in enumerate(jobs):
        if j % sn != si:
            continue
        if args.only and args.only not in str(kw) and args.only != kind:
            continue
        try:
            run_config(kind, kw, split, e, az, args, np.random.default_rng(zlib.crc32(f'{kw}{e}'.encode())))
        except FileNotFoundError as err:
            print('missing field, skipped:', err, flush=True)


if __name__ == '__main__':
    main()
