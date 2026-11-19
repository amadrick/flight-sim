"""Round four: does a learned near-field correction beat the hand-written one?  (data: gt_near.py)

    OMP_NUM_THREADS=1 nice -n 10 python3 gt_near_fit.py near1 [--export]

Baseline B0: the shipped round-three networks  J(tauSun, tauUp, cosT), V(tauUp, tauDn)  (src/neural/weights-light.js),
which know nothing about how the surface under a sample faces the sun or whether it sits on a lobe or in a crease.
Hand-written (shaders.js, round four):
    J *= occ.x * lam,  V *= occ.y      lam = 0.55 + 0.9 max(mu0, 0) + 0.2 min(mu0, 0),  occ = 1 - 0.6 (0.55, 1) (cav - 0.2) 1.25
    both faded with the depth below the surface (surfK)
Learned: a small MLP  (mu0, cav, surf)  ->  ln (cJ, cV)  multiplying the same baseline (3 inputs so it bakes into a
16^3 LUT; a 5-input variant with tauSun and cosT is reported too).
Errors: ln RMSE and mean ratio on cameras held out from training; with --export the 3-input network is written to
src/neural/cloud-near-weights.js.
"""
import argparse
import base64
import glob
import json
import os
import re

import numpy as np

from gt_common import DATA
from gt_nn import MLP, act

HERE = os.path.dirname(os.path.abspath(__file__))


def load_shipped():
    txt = open(os.path.join(HERE, '..', '..', 'src', 'neural', 'weights-light.js')).read()
    m = json.loads(txt[txt.index('{'):txt.rindex('}') + 1])

    def net(d):
        f = np.frombuffer(base64.b64decode(d['b64']), np.float32)
        Ws, p = [], 0
        for a, b in zip(d['sizes'][:-1], d['sizes'][1:]):
            Ws.append((f[p:p + a * b].reshape(b, a).astype(float), f[p + a * b:p + a * b + b].astype(float)))
            p += a * b + b
        return Ws
    return net(m['j']), net(m['v']), m['enc']


def fwd(Ws, X):
    h = X
    for i, (W, b) in enumerate(Ws):
        z = h @ W.T + b
        h = act(z) if i < len(Ws) - 1 else z
    return h


def baseline(D):
    nj, nv, enc = load_shipped()
    lt, la, lam = np.log1p(enc['tauMax']), np.log1p(2 / enc['t0']), np.log1p(enc['ambTauMax'])
    tau = lambda t, hi: np.log1p(np.clip(t, 0, hi)) / lt
    ang = np.log1p(np.sqrt(np.maximum(0, 2 - 2 * np.clip(D['cosT'], -1, 1))) / enc['t0']) / la
    X = np.stack([2 * tau(D['tauSun'], 95.0) - 1, 2 * tau(D['tauUp'], 26.0) - 1, 2 * ang - 1], 1)
    J = D['Jss'] + np.exp(fwd(nj, X)[:, 0])
    amb = lambda t: np.log1p(np.clip(t, 0, 26.0)) / lam
    V = np.exp(fwd(nv, np.stack([2 * amb(D['tauUp']) - 1, 2 * amb(D['tauDn']) - 1], 1)))
    return J, V


def hand(D):
    surfK = np.clip(1.3 - D['surf'] / 0.04, 0, 1)
    cav = 0.2 + (D['cav'] - 0.2) * surfK
    occx = np.clip(1 - 0.6 * 0.55 * (cav - 0.2) * 1.25, 0.25, 1.3)
    occy = np.clip(1 - 0.6 * 1.0 * (cav - 0.2) * 1.25, 0.25, 1.3)
    lam = 1 + (0.55 + 0.9 * np.maximum(D['mu0'], 0) + 0.2 * np.minimum(D['mu0'], 0) - 1) * surfK
    return occx * lam, occy


def feats(D, n):
    x = [D['mu0'], 2 * D['cav'] - 1, np.clip(D['surf'] / 0.04, -1, 2) / 1.5 - 0.33]
    if n == 5:
        x += [np.log1p(np.clip(D['tauSun'], 0, 95)) / np.log(96) * 2 - 1, D['cosT']]
    return np.stack(x, 1)


def err(pred, true):
    r = np.log(np.maximum(pred, 1e-6) / np.maximum(true, 1e-6))
    return dict(lnRMSE=float(np.sqrt(np.mean(r * r))), bias=float(np.exp(np.mean(r))), corr=float(np.corrcoef(np.log(np.maximum(pred, 1e-6)), np.log(np.maximum(true, 1e-6)))[0, 1]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('field')
    ap.add_argument('--export', action='store_true')
    ap.add_argument('--epochs', type=int, default=300)
    a = ap.parse_args()
    parts = []
    for p in sorted(glob.glob(os.path.join(DATA, 'near_%s_*.npz' % a.field))):
        if p.endswith('_img.npz'):
            continue
        z = dict(np.load(p))
        n = len(z['d'])
        z = {k: v for k, v in z.items() if np.ndim(v) >= 1 and len(v) == n}
        z['elev'] = np.full(n, float(re.findall(r'_([0-9.]+)\.npz', p)[0]))
        parts.append(z)
    D = {k: np.concatenate([q[k] for q in parts]) for k in parts[0]}
    n = len(D['d'])
    Jt, Vt = D['Jss'] + D['Jms'], D['Vup']
    Jb, Vb = baseline(D)
    hj, hv = hand(D)
    te = D['cam'] >= D['cam'].max() - 1          # last two cameras of every sun elevation: held out
    tr = ~te
    res = {'points': int(n), 'test_points': int(te.sum()), 'elevations': sorted(set(D['elev'].tolist()))}
    res['J'] = {'baseline_r3': err(Jb[te], Jt[te]), 'hand': err((Jb * hj)[te], Jt[te])}
    res['Vsky'] = {'baseline_r3': err(Vb[te, 0], Vt[te]), 'hand': err((Vb[:, 0] * hv)[te], Vt[te])}
    res['Vground'] = {'baseline_r3': err(Vb[te, 1], D['Vdn'][te]), 'hand': err((Vb[:, 1] * hv)[te], D['Vdn'][te])}
    # how much of the residual do the new features explain at all?
    rJ = np.log(np.maximum(Jt, 1e-6) / Jb)
    res['residual_corr'] = {k: float(np.corrcoef(D[k], rJ)[0, 1]) for k in ('mu0', 'cav', 'surf', 'tauSun', 'd')}
    nets = {}
    for nin in (3, 5):
        X = feats(D, nin)
        Y = np.stack([rJ, np.log(np.maximum(Vt, 1e-6) / Vb[:, 0])], 1)
        Y = np.clip(Y, -3, 3)
        Xt, Yt = X[tr], Y[tr]
        net = MLP([nin, 12, 12, 2], seed=1)

        def loss(P, idx):
            d = P - Yt[idx]
            return float(np.mean(d * d)), 2 * d / d.size
        net.fit(Xt, loss, epochs=a.epochs, batch=512, lr=4e-3, decay=0.99)
        C = np.exp(net(X))
        res['J']['mlp%d' % nin] = err((Jb * C[:, 0])[te], Jt[te])
        res['Vsky']['mlp%d' % nin] = err((Vb[:, 0] * C[:, 1])[te], Vt[te])
        res['J']['mlp%d_train' % nin] = err((Jb * C[:, 0])[tr], Jt[tr])
        nets[nin] = net
    # what the 3-input network learned: correction of J against mu0 at the surface, lobe tip vs crease
    net = nets[3]
    grid = {}
    for cav in (0.0, 0.2, 0.6, 1.0):
        X = np.stack([np.linspace(-1, 1, 9), np.full(9, 2 * cav - 1), np.full(9, -0.33)], 1)
        grid['cav%.1f' % cav] = [round(float(v), 3) for v in np.exp(net(X))[:, 0]]
    res['learned_cJ_vs_mu0_at_surface'] = grid
    X = np.stack([np.zeros(6) + 0.5, np.full(6, -0.6), np.array([-0.5, 0, 0.5, 1, 1.5, 2]) / 1.5 - 0.33], 1)
    res['learned_cJ_vs_depth'] = [round(float(v), 3) for v in np.exp(net(X))[:, 0]]
    print(json.dumps(res, indent=1))
    json.dump(res, open(os.path.join(HERE, 'results', 'near_fit_%s.json' % a.field), 'w'), indent=1)
    if a.export:
        flat = np.concatenate([np.concatenate([W.T.ravel(), b]) for W, b in zip(net.W, net.b)]).astype(np.float32)
        js = ('// Generated by tools/neural/gt_near_fit.py: near-field lighting correction (see src/neural/cloud-near.js).\n'
              '// (mu0, cav, surf) -> ln (cJ, cV): multiplies the sun source function and the sky visibility of the lighting networks.\n'
              'export const CLOUD_NEAR_MODEL = ' + json.dumps({'sizes': net.sizes, 'b64': base64.b64encode(flat.tobytes()).decode(),
                                                               'meta': {'points': int(tr.sum()), 'heldout': res['J']}}, indent=1) + ';\n')
        open(os.path.join(HERE, '..', '..', 'src', 'neural', 'cloud-near-weights.js'), 'w').write(js)


if __name__ == '__main__':
    main()
