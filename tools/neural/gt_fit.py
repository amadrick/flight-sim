"""Feature study + fits of the cloud lighting networks on the point-wise ground truth (gt_points.py / gt_analyze.py).
    python3 gt_fit.py study
"""
import sys

import numpy as np

import phase as ph
from gt_analyze import load_all, jerr
from gt_nn import MLP

PMAX = 20.0


def feats(D, names):
    cols = []
    for n in names:
        if n in ('tauSun', 'tauUp', 'tauDn', 'tauNear', 'tv', 'tuTrue', 'tdTrue', 'tsideMin'):
            cols.append(np.log1p(np.maximum(D[n], 0)) / 2.0 - 1.0)
        elif n == 'vy':
            cols.append(D['dirs'][:, 1])
        elif n == 'ly':
            cols.append(np.sin(np.radians(D['elev'])))
        elif n == 'ex':
            cols.append(D['ex'] * 4.0)
        elif n == 'hN':
            cols.append(D['hN'] * 2 - 1)
        else:
            cols.append(D[n])
    return np.stack(cols, 1)


def single(D):
    return np.minimum(ph.phase_np(D['cosT']), PMAX) * np.exp(-D['tauSun'])


def weights(D):
    w = D['wn'].copy()
    w = np.minimum(w, np.percentile(w, 99))
    return w / w.mean()


def fit_j(D, names, tr, seed=0, epochs=40, hidden=(16, 16)):
    X = feats(D, names)
    Jt = D['Jss'] + D['Jms']
    ss = single(D)
    w = weights(D)
    e = 0.004

    def loss(Y, idx):
        y = np.clip(Y[:, 0], -20, 5)
        p = ss[tr][idx] + np.exp(y)
        r = np.log((p + e) / (Jt[tr][idx] + e))
        ww = w[tr][idx]
        return float(np.mean(ww * r * r)), (2 * ww * r * np.exp(y) / (p + e) / len(idx))[:, None]
    net = MLP([X.shape[1], *hidden, 1], seed)
    net.b[-1][:] = np.log(0.05)
    net.fit(X[tr], loss, epochs=epochs)
    return net, (lambda Dx: single(Dx) + np.exp(np.clip(net(feats(Dx, names))[:, 0], -20, 5)))


def fit_v(D, names, tr, seed=0, epochs=40, hidden=(16, 16)):
    X = feats(D, names)
    T = np.stack([D['Vup'], D['Vdn']], 1)
    w = weights(D)
    e = 0.02

    def loss(Y, idx):
        y = np.clip(Y, -10, 3)
        p = np.exp(y)
        r = np.log((p + e) / (T[tr][idx] + e))
        ww = w[tr][idx][:, None]
        return float(np.mean(ww * r * r)), 2 * ww * r * p / (p + e) / len(idx)
    net = MLP([X.shape[1], *hidden, 2], seed)
    net.b[-1][:] = np.log(0.5)
    net.fit(X[tr], loss, epochs=epochs)
    return net, (lambda Dx: np.exp(np.clip(net(feats(Dx, names)), -10, 3)))


def subset(D, m):
    return {k: v[m] for k, v in D.items()}


def cv(D, fitter, names, target, **kw):
    """train on one field, test on the other (both directions); mean over cases of weighted lnRMSE / |bias-1|"""
    field = np.array([c.split('_')[0].split('@')[0].rstrip('B') for c in D['case']])
    out = []
    for f in np.unique(field):
        tr = field != f
        net, pred = fitter(D, names, tr, **kw)
        Dt = subset(D, ~tr)
        p = pred(Dt)
        tv = target(Dt)
        if p.ndim == 2:
            r = [jerr(p[:, k], tv[:, k], Dt['wn'], Dt['case']) for k in range(p.shape[1])]
            out += [x for rr in r for x in rr]
        else:
            out += jerr(p, tv, Dt['wn'], Dt['case'])
    return np.mean([x[2] for x in out]), np.mean([abs(x[1] - 1) for x in out]), out


def study():
    D = load_all()
    jt = lambda Dx: Dx['Jss'] + Dx['Jms']
    vt = lambda Dx: np.stack([Dx['Vup'], Dx['Vdn']], 1)
    J_SETS = {
        'tauSun,tauUp,cosT': ['tauSun', 'tauUp', 'cosT'],
        '+tauDn': ['tauSun', 'tauUp', 'cosT', 'tauDn'],
        'tauSun,cosT,ex': ['tauSun', 'cosT', 'ex'],
        'tauSun,cosT,ex,vy': ['tauSun', 'cosT', 'ex', 'vy'],
        'tauSun,cosT,ex,tv': ['tauSun', 'cosT', 'ex', 'tv'],
        'tauSun,cosT,ex,hN': ['tauSun', 'cosT', 'ex', 'hN'],
        'tauSun,cosT,ex,ly': ['tauSun', 'cosT', 'ex', 'ly'],
        'tauSun,cosT,tauNear,ex': ['tauSun', 'cosT', 'tauNear', 'ex'],
        'all cheap': ['tauSun', 'cosT', 'ex', 'tv', 'hN', 'vy', 'ly', 'tauNear', 'd', 'tauUp', 'tauDn'],
        'all + true taus': ['tauSun', 'cosT', 'ex', 'tv', 'hN', 'vy', 'ly', 'tauNear', 'd', 'tuTrue', 'tdTrue', 'tsideMin'],
    }
    which = sys.argv[2] if len(sys.argv) > 2 else 'jv'
    if 'j' in which:
        print('sun J (cross-field lnRMSE, |bias-1|):')
        for k, names in J_SETS.items():
            l, b, _ = cv(D, fit_j, names, jt)
            print('  %-28s %.3f  %.3f' % (k, l, b), flush=True)
    V_SETS = {
        'tauUp,tauDn': ['tauUp', 'tauDn'],
        'ex,hN': ['ex', 'hN'],
        'ex,hN,vy': ['ex', 'hN', 'vy'],
        'ex,tauUp,tauDn': ['ex', 'tauUp', 'tauDn'],
        'ex,hN,tv': ['ex', 'hN', 'tv'],
        'ex,hN,vy,tv': ['ex', 'hN', 'vy', 'tv'],
        'all cheap': ['tauSun', 'ex', 'tv', 'hN', 'vy', 'ly', 'd', 'tauUp', 'tauDn'],
        'true up/dn/side': ['tuTrue', 'tdTrue', 'tsideMin', 'vy'],
    }
    if 'v' in which:
        print('ambient V (cross-field lnRMSE, |bias-1|):')
        for k, names in V_SETS.items():
            l, b, _ = cv(D, fit_v, names, vt)
            print('  %-28s %.3f  %.3f' % (k, l, b), flush=True)


if __name__ == '__main__':
    globals()[sys.argv[1]]()
