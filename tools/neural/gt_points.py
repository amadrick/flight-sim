"""Point-wise ground truth at the samples the real-time march actually lights.

    python3 gt_points.py scattered noon_above [--n 4000] [--paths 96]

Runs the march port for the case, draws n of its lit samples with probability proportional to their weight in the
image (the points that matter), and estimates at each point, with the path tracer of gt_trace.py:
    Jsun  sun source function toward the camera (sr^-1, per unit sun irradiance): exact single scattering with the
          full phase function + all higher orders (delta-M scaled walk), black ground
    Vup   source function for a uniform sky of radiance 1 above the horizon (black ground)  = sky "visibility"
    Vdn   source function for a uniform ground of radiance 1 (no sky)                       = ground-bounce visibility
Together with the game's features of the same sample (tauSun, tauUp, tauDown, cosTheta, density, shape excess,
optical depth along the view ray, ...) this is a training / evaluation set on the real cloud shapes and on the
features the shader can actually compute.  Saved to gt_data/pts_<field>_<case>.npz.
"""
import argparse
import os
import time

import numpy as np

from gt_common import DATA, W_D, Field, make_case
import gt_march as gm
import gt_trace as gt
import phase as ph

KEYS = ('tauSun', 'tauNear', 'tauUp', 'tauDn', 'cosT', 'd', 'tv', 'ex', 'h', 'w', 'pos', 'pix', 'ds', 'tt')


def sample_full_phase(rng, d):
    n = len(d)
    peak = rng.random(n) > W_D
    mu = np.empty(n)
    mu[peak] = gt.sample_hg(ph.G_HG, rng.random(peak.sum()))
    mu[~peak] = gt.sample_draine(rng, (~peak).sum())
    out = gt.rotate(d, mu, rng.random(n) * 2 * np.pi)
    return out / np.linalg.norm(out, axis=1, keepdims=True)


def estimate(tr, pos, dirs, paths, rng, chunk=200000):
    n = len(pos)
    acc = np.zeros((n, 3))
    per = max(1, chunk // paths)
    for s in range(0, n, per):
        e = min(n, s + per)
        idx = np.repeat(np.arange(s, e), paths)
        d0 = sample_full_phase(rng, dirs[idx])
        a = np.zeros((e - s, 3))
        tr.walk(d0, idx - s, rng, a, start=pos[idx],
                light=dict(E=(1.0, 0.0, 0.0), sky=lambda d: np.tile([0.0, 1.0, 0.0], (len(d), 1)),
                           ground='emit1', ground_emit=(0.0, 0.0, 1.0)))
        acc[s:e] = a / paths
    return acc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('field')
    ap.add_argument('case')
    ap.add_argument('--n', type=int, default=4000)
    ap.add_argument('--paths', type=int, default=96)
    ap.add_argument('--res', default='160x90')
    ap.add_argument('--seed', type=int, default=7)
    a = ap.parse_args()
    W, H = map(int, a.res.split('x'))
    f = Field(a.field)
    case = make_case(a.case, f)
    m = gm.March(f, case)
    t0 = time.time()
    R = m.run(W, H, njit=4, seed=a.seed)
    rng = np.random.default_rng(a.seed)
    p = R['w'] / R['w'].sum()
    sel = rng.choice(len(p), size=min(a.n, len(p)), replace=False, p=p)
    pts = {k: R[k][sel] for k in KEYS if k in R}
    dirs = R['dirs'][pts['pix'].astype(int)]
    print('march %.1f s, %d lit samples, %d points' % (time.time() - t0, len(p), len(sel)), flush=True)
    tr = gt.Tracer(f, case)
    t0 = time.time()
    tau_full = tr.ts.lookup(pts['pos'])
    jss = ph.phase_np(pts['cosT']) * np.exp(-tau_full)
    acc = estimate(tr, pts['pos'], dirs, a.paths, rng)
    print('paths %.1f s' % (time.time() - t0), flush=True)
    out = dict(pts, dirs=dirs, Jss=jss, Jms=acc[:, 0], Vup=acc[:, 1], Vdn=acc[:, 2], tauSunTrue=tau_full,
               elev=case['elev'], paths=a.paths, sigma=f.sigma, base=f.base_alt, top=f.top_alt,
               coverage=f.meta['params']['coverage'])
    np.savez(os.path.join(DATA, 'pts_%s_%s.npz' % (a.field, a.case)), **out)
    print('Jss mean %.4f  Jms mean %.4f  Vup mean %.3f  Vdn mean %.3f' % (jss.mean(), acc[:, 0].mean(), acc[:, 1].mean(), acc[:, 2].mean()))


if __name__ == '__main__':
    main()
