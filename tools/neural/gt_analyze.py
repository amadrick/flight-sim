"""Point-wise analysis of the scatter / ambient models on gt_points.py data (game features vs path-traced truth).
    python3 gt_analyze.py
"""
import glob
import os

import numpy as np

from gt_common import DATA, Field
from gt_trace import trilinear
import gt_march as gm

CACHE = os.path.join(DATA, 'pts_all.npz')


def tau_dir(f, p, d, L=4000.0, h=15.0):
    t = np.zeros(len(p))
    s = h / 2
    while s < L:
        q = p + d[None] * s
        v = np.stack([(q[:, 0] - f.x0) / f.dx - 0.5, (q[:, 2] - f.z0) / f.dx - 0.5, (q[:, 1] - f.base_alt) / f.dz - 0.5], 1)
        t += trilinear(f.full, v) * f.sigma * h
        s += h
    return t


def load_all(refresh=False):
    if os.path.exists(CACHE) and not refresh:
        z = np.load(CACHE)
        return {k: z[k] for k in z.files}
    out = {}
    fields = {}
    for p in sorted(glob.glob(os.path.join(DATA, 'pts_*_*.npz'))):
        if p.endswith('pts_all.npz'):
            continue
        name = os.path.basename(p)[4:-4]
        fname = name.split('_')[0]
        case = name[len(fname) + 1:]
        z = np.load(p)
        f = fields.setdefault(fname, Field(fname))
        pos = z['pos']
        d = dict((k, z[k]) for k in z.files if z[k].ndim >= 1 and len(z[k]) == len(pos))
        d['tuTrue'] = tau_dir(f, pos, np.array([0, 1.0, 0]))
        d['tdTrue'] = tau_dir(f, pos, np.array([0, -1.0, 0]))
        side = [tau_dir(f, pos, np.array([np.cos(a), 0, np.sin(a)]), L=3000) for a in np.linspace(0, 2 * np.pi, 6, endpoint=False)]
        d['tsideMin'] = np.min(side, 0)
        d['tsideMean'] = np.mean(np.exp(-np.array(side)), 0)
        d['wn'] = z['w'] / z['w'].sum()                       # importance, normalised per case
        d['case'] = np.array([name] * len(pos))
        d['elev'] = np.full(len(pos), float(z['elev']))
        d['hN'] = (pos[:, 1] - float(z['base'])) / (float(z['top']) - float(z['base']))
        for k, v in d.items():
            out.setdefault(k, []).append(v)
    out = {k: np.concatenate(v) for k, v in out.items()}
    np.savez(CACHE, **out)
    return out


def jerr(pred, true, w, case):
    """per case: weighted bias (sum w pred / sum w true) and weighted ln RMSE; returns means over cases"""
    res = []
    for c in np.unique(case):
        m = case == c
        e = 0.02 * np.average(true[m], weights=w[m])
        b = np.sum(w[m] * pred[m]) / np.sum(w[m] * true[m])
        l = np.sqrt(np.average(np.log((pred[m] + e) / (true[m] + e)) ** 2, weights=w[m]))
        res.append((c, b, l))
    return res


def show(name, pred, true, D):
    r = jerr(pred, true, D['wn'], D['case'])
    print('%-26s lnRMSE %.3f  |bias-1| %.3f   ' % (name, np.mean([x[2] for x in r]), np.mean([abs(x[1] - 1) for x in r]))
          + ' '.join('%s %.2f/%.2f' % (c.replace('scattered_', 's:').replace('broken_', 'b:')[:12], b, l) for c, b, l in r))


def main():
    D = load_all(refresh=True)
    Jt = D['Jss'] + D['Jms']
    print('points', len(Jt))
    R = dict(tauSun=D['tauSun'], tauUp=D['tauUp'], tauDn=D['tauDn'], cosT=D['cosT'])
    show('classic (game feats)', gm.classic_J(D['tauSun'], D['tauUp'], D['cosT']), Jt, D)
    for mod in ('neural3', 'neural4', 'neural3full', 'neural4full'):
        show(mod + ' (game feats)', gm.node_J(mod, D['tauSun'], D['tauUp'], D['cosT'], D['tauDn']), Jt, D)
    show('neural4full true up/dn', gm.node_J('neural4full', D['tauSun'], D['tuTrue'], D['cosT'], D['tdTrue']), Jt, D)
    show('neural4full true all', gm.node_J('neural4full', D['tauSunTrue'], D['tuTrue'], D['cosT'], D['tdTrue']), Jt, D)
    print('ambient (sky, Vup):')
    vu_game = 0.5 * (0.35 * np.exp(-0.6 * D['tauUp']) + 0.65 / (1 + 0.2 * D['tauUp']))
    vd_game = 0.5 * (0.35 * np.exp(-0.6 * D['tauDn']) + 0.65 / (1 + 0.2 * D['tauDn']))
    show('game visUp', vu_game, D['Vup'], D)
    show('game visDn', vd_game, D['Vdn'], D)
    g = 0.864
    ts = lambda u, d: (d * (1 - g) + 0.71) / ((u + d) * (1 - g) + 1.42)
    show('2-stream true', ts(D['tuTrue'], D['tdTrue']), D['Vup'], D)
    show('2-stream game', ts(D['tauUp'], D['tauDn']), D['Vup'], D)
    show('const 0.5', 0.5 + 0 * D['Vup'], D['Vup'], D)


if __name__ == '__main__':
    main()
