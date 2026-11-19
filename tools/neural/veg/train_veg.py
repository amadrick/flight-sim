"""Train the two vegetation networks on the path-traced data and export them for the browser.

  OMP_NUM_THREADS=1 nice -n 10 timeout 600 python3 train_veg.py data/canopy_*.npz

Network 1 - canopy BRF ("VEG_CANOPY"):
  in  (7): 2mu_s-1, 2mu_v-1, cos(rel. azimuth), 2cover-1, 2conifer-1, cos(phase angle), sqrt(1 - cos(phase angle))
  out (5): ln(BRF_r + e), ln(BRF_g + e), ln(BRF_b + e), gap fraction, sunlit fraction of the visible foliage
Network 2 - crown light transfer ("VEG_CROWN"):
  in  (6): 2h_rel-1, 2d_rel-1, cos(azimuth to sun), 2mu_s-1, 2cover-1, 2conifer-1
  out (2): sun transmittance (neighbours + own crown), cosine-weighted sky visibility

Writes src/neural/veg-weights.js, src/neural/test-vectors-veg.json and tools/neural/veg/results/train.json.
"""
import json
import math
import os
import sys
import time
import numpy as np

from nn import MLP, train, isru

E_BRF = 0.002
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'src', 'neural'))
PER_STAND = 40 * 8


def enc_canopy(X):
    mus, muv, caz, cov, con = X.T
    cp = mus * muv + np.sqrt(np.maximum(1 - mus * mus, 0)) * np.sqrt(np.maximum(1 - muv * muv, 0)) * caz
    return np.stack([2 * mus - 1, 2 * muv - 1, caz, 2 * cov - 1, 2 * con - 1, cp, np.sqrt(np.maximum(1 - cp, 0))], 1)


def enc_crown(X):
    h, d, caz, mus, cov, g = X.T
    return np.stack([2 * h - 1, 2 * d - 1, caz, 2 * mus - 1, 2 * cov - 1, 2 * g - 1], 1)


def loss_canopy(pred, Y, W):
    # log-BRF channels weighted 1, gap / sunlit weighted 2
    t = np.concatenate([np.log(np.maximum(Y[:, :3], 0) + E_BRF), Y[:, 3:5]], 1)
    wch = np.array([1.0, 1.0, 1.0, 2.0, 2.0])
    r = (pred - t) * wch
    l = float((r * (pred - t) * W[:, None]).mean())
    g = 2 * r * W[:, None] / r.size
    return l, g


def loss_mse(pred, Y, W):
    r = pred - Y
    return float((r * r * W[:, None]).mean()), 2 * r * W[:, None] / r.size


def main():
    files = sys.argv[1:]
    rng = np.random.default_rng(7)
    X, Y, CX, CY, SID = [], [], [], [], []
    base = 0
    for f in files:
        z = np.load(f)
        X.append(z['X']); Y.append(z['Y']); CX.append(z['CX']); CY.append(z['CY'])
        SID.append(base + np.arange(len(z['X'])) // PER_STAND)
        base += len(z['X']) // PER_STAND
    X, Y, CX, CY, SID = map(np.concatenate, (X, Y, CX, CY, SID))
    X, Y, CX, CY = (a.astype(np.float64) for a in (X, Y, CX, CY))
    val = (SID % 7) == 3
    log = lambda m: print(m, flush=True)
    log(f'canopy rows {len(X)} ({base} stands, {val.sum()} held out); crown rows {len(CX)}')
    res = {}
    t0 = time.time()

    # ---- network 1
    E = enc_canopy(X)
    net1 = MLP([7, 32, 32, 5], rng)
    W = np.ones(len(X))
    train(net1, E[~val], Y[~val], W[~val], loss_canopy, epochs=260, batch=256, lr=4e-3, rng=rng, log=log,
          Xv=E[val], Yv=Y[val], Wv=W[val])
    net1.round_f32()
    P = net1.forward(E[val])
    brf_p = np.exp(P[:, :3]) - E_BRF
    brf_t = Y[val, :3]
    rel = np.abs(brf_p - brf_t) / (brf_t + 0.005)
    # noise floor: two halves of the same stand cannot be compared directly; report error vs reference
    res['canopy'] = dict(params=net1.nparams(), rows=int(len(X)), stands=int(base),
                         val_rmse_ln=float(np.sqrt(((P[:, :3] - np.log(np.maximum(brf_t, 0) + E_BRF)) ** 2).mean())),
                         val_rel_mae=float(rel.mean()), val_rel_median=float(np.median(rel)),
                         val_gap_rmse=float(np.sqrt(((P[:, 3] - Y[val, 3]) ** 2).mean())),
                         val_sunlit_rmse=float(np.sqrt(((P[:, 4] - Y[val, 4]) ** 2).mean())),
                         brf_mean_ref=brf_t.mean(0).tolist(), brf_mean_net=brf_p.mean(0).tolist())
    # Lambertian baseline (one albedo per stand composition, fitted): how much the angular structure matters
    lam = np.zeros_like(brf_t)
    for s in np.unique(SID[val]):
        m = SID[val] == s
        lam[m] = brf_t[m].mean(0)
    res['canopy']['lambert_rel_mae'] = float((np.abs(lam - brf_t) / (brf_t + 0.005)).mean())
    log(json.dumps(res['canopy']))

    # ---- network 2
    CE = enc_crown(CX)
    nc = len(CX)
    cval = rng.random(nc) < 0.12
    net2 = MLP([6, 24, 24, 2], rng)
    W2 = np.ones(nc)
    # subsample for speed
    tr = np.nonzero(~cval)[0]
    if len(tr) > 300000:
        tr = rng.choice(tr, 300000, replace=False)
    train(net2, CE[tr], CY[tr], W2[tr], loss_mse, epochs=60, batch=512, lr=4e-3, rng=rng, log=log,
          Xv=CE[cval], Yv=CY[cval], Wv=W2[cval])
    net2.round_f32()
    P2 = net2.forward(CE[cval])
    # baseline: the "plain" impostor model, exp(-k * depth) * Lambert-like facing term, fitted by least squares
    d = CX[cval, 1]; caz = CX[cval, 2]; mus = CX[cval, 3]
    feats = np.stack([np.ones_like(d), d, caz * np.sqrt(1 - mus ** 2), mus, d * d], 1)
    coef, *_ = np.linalg.lstsq(feats, CY[cval, 0], rcond=None)
    base_t = feats @ coef
    res['crown'] = dict(params=net2.nparams(), rows=int(nc),
                        val_rmse_tsun=float(np.sqrt(((P2[:, 0] - CY[cval, 0]) ** 2).mean())),
                        val_rmse_sky=float(np.sqrt(((P2[:, 1] - CY[cval, 1]) ** 2).mean())),
                        baseline_linear_rmse_tsun=float(np.sqrt(((base_t - CY[cval, 0]) ** 2).mean())),
                        tsun_std=float(CY[cval, 0].std()), sky_std=float(CY[cval, 1].std()))
    log(json.dumps(res['crown']))
    res['seconds'] = time.time() - t0

    # ---- export
    def pack(net):
        return dict(sizes=net.sizes, W=[w.astype(np.float32).reshape(-1).tolist() for w in net.W],
                    b=[b.astype(np.float32).tolist() for b in net.b])
    os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
    with open(os.path.join(HERE, 'results', 'train.json'), 'w') as f:
        json.dump(res, f, indent=1)
    meta = dict(trained=time.strftime('%Y-%m-%d'), eBrf=E_BRF, canopy=res['canopy'], crown=res['crown'])
    js = ('// Generated by tools/neural/veg/train_veg.py - do not edit.  Two tiny MLPs trained on a Monte Carlo path tracer\n'
          '// of forest stands built from the browser\'s own procedural tree species (tools/neural/veg/canopy_mc.py).\n'
          f'export const VEG_CANOPY_NET = {json.dumps(pack(net1))};\n'
          f'export const VEG_CROWN_NET = {json.dumps(pack(net2))};\n'
          f'export const VEG_NET_META = {json.dumps(meta)};\n')
    with open(os.path.join(SRC, 'veg-weights.js'), 'w') as f:
        f.write(js)
    # test vectors: raw inputs and the float64 outputs of the float32-rounded weights
    ti = rng.choice(len(X), 64, replace=False)
    tj = rng.choice(nc, 64, replace=False)
    tv = dict(canopy=dict(x=X[ti].tolist(), y=net1.forward(E[ti]).tolist()),
              crown=dict(x=CX[tj].tolist(), y=net2.forward(CE[tj]).tolist()))
    with open(os.path.join(SRC, 'test-vectors-veg.json'), 'w') as f:
        json.dump(tv, f)
    log('exported')


if __name__ == '__main__':
    main()
