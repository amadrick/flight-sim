"""Train the round-two cloud lighting networks on the point-wise ground truth (gt_points.py -> gt_analyze.py cache)
and export them for the game (src/neural/weights-light.js + test vectors).

    python3 gt_train_light.py [--epochs 60] [--export]

Networks (plain MLPs, ISRU hidden activation, baked into LUTs at boot by src/neural/cloud-light.js):
  J net   (u_tauSun, u_tauUp, u_angle) -> ln J_ms      J = min(phase, PMAX) exp(-tauSun) + exp(net)
          inputs are the LUT axes of the round-one model (log1p(tau)/log1p(128), warped scattering angle), fed with
          the features the march REALLY computes (light-march tauSun, height-based tauUp) on the game's own clouds
  V net   (u_tauUp, u_tauDown) -> (ln Vup, ln Vdown)   sky / ground-bounce source per unit hemisphere radiance
"""
import argparse
import base64
import json
import math
import os

import numpy as np

import phase as ph
from gt_analyze import load_all, jerr
from gt_nn import MLP

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TAU_MAX, T0, AMB_TAU_MAX = 128.0, 0.02, 64.0
PMAX = 20.0
J_HIDDEN, V_HIDDEN = (16, 16), (12, 12)


def enc_j(ts, tu, c):
    u1 = np.log1p(np.clip(ts, 0, TAU_MAX)) / math.log1p(TAU_MAX)
    u2 = np.log1p(np.clip(tu, 0, TAU_MAX)) / math.log1p(TAU_MAX)
    u3 = np.log1p(np.sqrt(np.maximum(0, 2 - 2 * np.clip(c, -1, 1))) / T0) / math.log1p(2 / T0)
    return np.stack([u1, u2, u3], 1) * 2 - 1


def enc_v(tu, td):
    k = 1 / math.log1p(AMB_TAU_MAX)
    return np.stack([np.log1p(np.clip(tu, 0, AMB_TAU_MAX)) * k, np.log1p(np.clip(td, 0, AMB_TAU_MAX)) * k], 1) * 2 - 1


def single(ts, c):
    return np.minimum(ph.phase_np(c), PMAX) * np.exp(-ts)


def weights(D):
    w = D['wn'].copy()
    w = np.minimum(w, np.percentile(w, 99))
    return w / w.mean()


def train_j(D, tr, epochs, seed=0):
    X = enc_j(D['tauSun'], D['tauUp'], D['cosT'])
    Jt = D['Jss'] + D['Jms']
    ss = single(D['tauSun'], D['cosT'])
    w = weights(D)
    e = 0.004

    def loss(Y, idx):
        y = np.clip(Y[:, 0], -20, 5)
        p = ss[tr][idx] + np.exp(y)
        r = np.log((p + e) / (Jt[tr][idx] + e))
        ww = w[tr][idx]
        return float(np.mean(ww * r * r)), (2 * ww * r * np.exp(y) / (p + e) / len(idx))[:, None]
    net = MLP([3, *J_HIDDEN, 1], seed)
    net.b[-1][:] = math.log(0.05)
    net.fit(X[tr], loss, epochs=epochs, lr=4e-3)
    # the log-space fit is unbiased in ln J; images add radiance linearly: rescale the multiple-scattering part so the
    # importance-weighted mean of J is unbiased too
    y = np.exp(np.clip(net(X[tr])[:, 0], -20, 5))
    k = (np.sum(w[tr] * Jt[tr]) - np.sum(w[tr] * ss[tr])) / np.sum(w[tr] * y)
    net.b[-1][0] += math.log(max(k, 0.1))
    return net


def train_v(D, tr, epochs, seed=0):
    X = enc_v(D['tauUp'], D['tauDn'])
    T = np.stack([D['Vup'], D['Vdn']], 1)
    w = weights(D)
    e = 0.02

    def loss(Y, idx):
        y = np.clip(Y, -10, 3)
        p = np.exp(y)
        r = np.log((p + e) / (T[tr][idx] + e))
        ww = w[tr][idx][:, None]
        return float(np.mean(ww * r * r)), 2 * ww * r * p / (p + e) / len(idx)
    net = MLP([2, *V_HIDDEN, 2], seed)
    net.b[-1][:] = math.log(0.5)
    net.fit(X[tr], loss, epochs=epochs, lr=4e-3)
    p = np.exp(np.clip(net(X[tr]), -10, 3))
    for c in range(2):
        net.b[-1][c] += math.log(np.sum(w[tr] * T[tr][:, c]) / np.sum(w[tr] * p[:, c]))
    return net


def j_pred(net, D):
    return single(D['tauSun'], D['cosT']) + np.exp(np.clip(net(enc_j(D['tauSun'], D['tauUp'], D['cosT']))[:, 0], -20, 5))


def v_pred(net, D):
    return np.exp(np.clip(net(enc_v(D['tauUp'], D['tauDn'])), -10, 3))


def summary(name, res):
    print('  %-22s lnRMSE %.3f  |bias-1| %.3f' % (name, np.mean([x[2] for x in res]), np.mean([abs(x[1] - 1) for x in res])))


def pack(net):
    flat = np.concatenate([np.concatenate([W.T.ravel(), b]) for W, b in zip(net.W, net.b)]).astype(np.float32)
    return dict(sizes=list(net.sizes), b64=base64.b64encode(flat.tobytes()).decode())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--epochs', type=int, default=60)
    ap.add_argument('--export', action='store_true')
    a = ap.parse_args()
    D = load_all()
    field = np.array([c.split('_')[0] for c in D['case']])
    print('points', len(field), 'cases', len(np.unique(D['case'])))
    # cross-field validation
    cvj, cvv = [], []
    for f in np.unique(field):
        tr = field != f
        Dt = {k: v[~tr] for k, v in D.items()}
        nj = train_j(D, tr, a.epochs)
        nv = train_v(D, tr, a.epochs)
        cvj += jerr(j_pred(nj, Dt), Dt['Jss'] + Dt['Jms'], Dt['wn'], Dt['case'])
        pv = v_pred(nv, Dt)
        cvv += jerr(pv[:, 0], Dt['Vup'], Dt['wn'], Dt['case']) + jerr(pv[:, 1], Dt['Vdn'], Dt['wn'], Dt['case'])
    print('cross-field (train on one field, test on the other):')
    summary('J net', cvj)
    summary('V net', cvv)
    tr = np.ones(len(field), bool)
    nj = train_j(D, tr, a.epochs)
    nv = train_v(D, tr, a.epochs)
    np.savez(os.path.join(HERE, 'gt_data', 'light_nets.npz'),
             **{'j%d_%s' % (i, k): v for i, (W, b) in enumerate(zip(nj.W, nj.b)) for k, v in (('W', W), ('b', b))},
             **{'v%d_%s' % (i, k): v for i, (W, b) in enumerate(zip(nv.W, nv.b)) for k, v in (('W', W), ('b', b))})
    print('trained on all: J %d params, V %d params' % (nj.n_params(), nv.n_params()))
    if a.export:
        export(nj, nv, D, dict(cvJ=float(np.mean([x[2] for x in cvj])), cvV=float(np.mean([x[2] for x in cvv]))))


def export(nj, nv, D, cv):
    meta = dict(points=int(len(D['case'])), cases=sorted(set(str(c) for c in D['case'])), crossFieldLnRMSE=cv,
                trainedOn='path-traced points at the lit samples of the march on clouds exported from the game (tools/neural/gt_*.py)',
                pmax=PMAX)
    model = dict(j=pack(nj), v=pack(nv), enc=dict(tauMax=TAU_MAX, t0=T0, ambTauMax=AMB_TAU_MAX),
                 phase=dict(gHG=ph.G_HG, gD=ph.G_D, alpha=ph.ALPHA, wD=ph.W_D, dropletDiameterUm=ph.DROPLET_DIAMETER_UM),
                 meta=meta)
    js = ('// Generated by tools/neural/gt_train_light.py: round-two cloud lighting networks (see src/neural/cloud-light.js).\n'
          '// J net: (tauSun, tauUp, angle) -> ln J_ms; V net: (tauUp, tauDown) -> ln (Vsky, Vground).\n'
          'export const CLOUD_LIGHT_MODEL = ' + json.dumps(model, indent=1) + ';\n')
    open(os.path.join(ROOT, 'src', 'neural', 'weights-light.js'), 'w').write(js)
    # test vectors: network outputs (not LUT) at random inputs
    rng = np.random.default_rng(3)
    n = 64
    ts = np.expm1(rng.random(n) * math.log1p(60)); tu = np.expm1(rng.random(n) * math.log1p(40))
    td = np.expm1(rng.random(n) * math.log1p(40)); c = rng.random(n) * 2 - 1
    yj = nj(enc_j(ts, tu, c))[:, 0]
    yv = nv(enc_v(tu, td))
    tv = dict(tauSun=ts.tolist(), tauUp=tu.tolist(), tauDown=td.tolist(), cosTheta=c.tolist(), lnJms=yj.tolist(),
              lnVup=yv[:, 0].tolist(), lnVdown=yv[:, 1].tolist())
    json.dump(tv, open(os.path.join(ROOT, 'src', 'neural', 'test-vectors-light.json'), 'w'))
    print('exported src/neural/weights-light.js and test-vectors-light.json')


if __name__ == '__main__':
    main()


def load_nets(path=None):
    z = np.load(path or os.path.join(HERE, 'gt_data', 'light_nets.npz'))
    nj, nv = MLP([3, *J_HIDDEN, 1]), MLP([2, *V_HIDDEN, 2])
    for pre, net in (('j', nj), ('v', nv)):
        for i in range(len(net.W)):
            net.W[i] = z['%s%d_W' % (pre, i)]
            net.b[i] = z['%s%d_b' % (pre, i)]
    return nj, nv


def v2_models(path=None):
    """(J model, ambient model) callables for gt_march.shade()."""
    import gt_march as gm
    nj, nv = load_nets(path)

    def amb(R, case, cov):
        V = v_pred(nv, R)
        return case['sky'].amb_up[None] * V[:, :1] + gm.ground_ambient(case, cov)[None] * V[:, 1:]
    return (lambda R: j_pred(nj, R)), amb
