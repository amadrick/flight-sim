"""Train the flare networks (numpy, no torch) on the ray-traced / diffracted reference.

  cd tools/neural/flare
  OMP_NUM_THREADS=1 nice -n 10 python3 train.py meta      # ghost placement network
  OMP_NUM_THREADS=1 nice -n 10 python3 train.py ghost     # 12 ghost image networks
  OMP_NUM_THREADS=1 nice -n 10 python3 train.py star      # starburst + veil network

Networks (all ISRU hidden layers, linear output; encodings in `features.py`, mirrored in src/neural/flare.js):
  meta : r (sun distance from the frame centre, frame units)  ->  for each of the 12 ghosts
         (c / 2.4, asinh(m_al / 0.05), asinh(m_ac / 0.05), log10 E + 6)
  ghost: one network per ghost, (r, q_al, q_ac) -> sqrt(pi * image / E) per RGB channel (ghost image in iris
         coordinates, normalised by the ghost's flux so the networks see O(1) values)
  star : (r, phi from the nearest spike) -> log10 of the RGB point-spread density (diffraction (x) sun + veil)
"""
import json
import math
import os
import sys
import time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nn import MLP, train                    # noqa: E402
import features as FE                         # noqa: E402
from ghosts import DATA, RES                  # noqa: E402

MODELS = os.path.join(DATA, 'models')


def save(name, net, extra):
    os.makedirs(MODELS, exist_ok=True)
    net.round_f32()
    np.savez(os.path.join(MODELS, name + '.npz'), sizes=np.array(net.sizes), G=net.G,
             **{'W%d' % i: W for i, W in enumerate(net.W)}, **{'b%d' % i: b for i, b in enumerate(net.b)})
    with open(os.path.join(RES, 'train_%s.json' % name), 'w') as f:
        json.dump(extra, f, indent=1)


def load(name):
    z = np.load(os.path.join(MODELS, name + '.npz'))
    sizes = [int(s) for s in z['sizes']]
    net = MLP(sizes, G=int(z['G']))
    for i in range(len(sizes) - 1):
        net.W[i][...] = z['W%d' % i]; net.b[i][...] = z['b%d' % i]
    return net


def train_meta():
    d = np.load(os.path.join(DATA, 'ghosts.npz'))
    G = d['train_meta'].shape[0]
    K = FE.META_OUT
    def prep(meta):
        y = FE.meta_encode(meta)                                   # (G, R, K)
        w = np.ones_like(y)
        dead = meta[..., 3] <= 1e-9                                # vanished ghost: only its flux is meaningful
        w[dead, :K - 1] = 0.0
        return y.transpose(1, 0, 2).reshape(meta.shape[1], G * K), w.transpose(1, 0, 2).reshape(meta.shape[1], G * K)
    Yt, Wt = prep(d['train_meta'])
    Xt = FE.meta_features(d['r_grid'])
    Xh = FE.meta_features(d['r_hold'])
    net = MLP([Xt.shape[1], 32, 32, G * K], G=1, seed=3)
    t0 = time.time()
    train(net, Xt[None], Yt[None], Wt[None], epochs=20000, batch=len(Xt), lr=4e-3, lr_end=2e-5, log_every=4000)
    net.round_f32()
    pt = net.forward(Xt[None])[0].reshape(-1, G, K)
    ph = net.forward(Xh[None])[0].reshape(-1, G, K)
    dt = FE.meta_decode(pt); dh = FE.meta_decode(ph)
    res = {}
    for tag, dec, ref in (('train', dt, d['train_meta'].transpose(1, 0, 2)), ('holdout', dh, d['hold_meta'].transpose(1, 0, 2))):
        vis = ref[..., 3] > 1e-7
        res[tag] = dict(
            centre_abs_err_max=float(np.abs(dec[..., 0] - ref[..., 0])[vis].max()),
            centre_abs_err_rms=float(np.sqrt(((dec[..., 0] - ref[..., 0]) ** 2)[vis].mean())),
            scale_rel_err_rms=float(np.sqrt((((np.abs(dec[..., 1:3]) - np.abs(ref[..., 1:3])) / np.abs(ref[..., 1:3])) ** 2)[vis].mean())),
            sign_errors=int((np.sign(dec[..., 1:3]) != np.sign(ref[..., 1:3]))[vis].sum()),
            flux_log10_err_rms=float(np.sqrt(((np.log10(dec[..., 3] + 1e-12) - np.log10(ref[..., 3] + 1e-12)) ** 2)[vis].mean())),
        )
    print(json.dumps(res, indent=1))
    save('meta', net, dict(params=net.n_params(), seconds=time.time() - t0, fit=res))


def ghost_xy(d, tag):
    imgs, meta, rs = d[tag + '_img'], d[tag + '_meta'], d['r_grid' if tag == 'train' else 'r_hold']
    G, R, NA, NC, _ = imgs.shape
    qa, qc = FE.ghost_grid()
    X = FE.ghost_features(rs[:, None, None], qa[None, :, None], qc[None, None, :])   # (R, NA, NC, F)
    X = np.broadcast_to(X, (G,) + X.shape).reshape(G, R * NA * NC, -1)
    E = meta[..., 3][:, :, None, None, None]
    Y = np.sqrt(np.maximum(imgs, 0) * math.pi / np.maximum(E, 1e-30))
    Y = np.where(E > 1e-12, Y, 0.0).reshape(G, R * NA * NC, 3)
    return X, Y


def train_ghost():
    d = np.load(os.path.join(DATA, 'ghosts.npz'))
    X, Y = ghost_xy(d, 'train')
    Xh, Yh = ghost_xy(d, 'hold')
    G = X.shape[0]
    net = MLP([X.shape[2], 32, 32, 3], G=G, seed=5)
    t0 = time.time()
    epochs = int(os.environ.get('EPOCHS', 1500))
    train(net, X, Y, epochs=epochs, batch=2048, lr=3e-3, lr_end=3e-5, log_every=250)
    net.round_f32()
    res = {}
    for tag, xx, yy in (('train', X, Y), ('holdout_r', Xh, Yh)):
        p = net.forward(xx)
        # error measured on the image itself (normalised: pi * image / E, i.e. ~1 inside the ghost)
        ip, it = p ** 2, yy ** 2
        rms = np.sqrt(((ip - it) ** 2).mean(axis=(1, 2)))
        rel_energy = np.abs(ip.sum(axis=(1, 2)) - it.sum(axis=(1, 2))) / np.maximum(it.sum(axis=(1, 2)), 1e-12)
        res[tag] = dict(image_rmse_per_ghost=rms.tolist(), image_rmse_mean=float(rms.mean()),
                        mean_level_inside=float(it[it > 0.05].mean()), energy_rel_err_per_ghost=rel_energy.tolist())
    print(json.dumps({k: (v['image_rmse_mean'], v['mean_level_inside']) for k, v in res.items()}))
    save('ghost', net, dict(params_per_ghost=net.n_params(), ghosts=G, seconds=time.time() - t0, fit=res))


def train_star():
    d = np.load(os.path.join(DATA, 'star.npz'))
    r, phi, tot = d['r'], d['phi'], d['total']
    Rg, Pg = np.meshgrid(r, phi, indexing='ij')
    X = FE.star_features(Rg.ravel(), Pg.ravel())
    Y = np.log10(np.maximum(tot.reshape(-1, 3), 1e-12))
    net = MLP([X.shape[1], 48, 48, 3], G=1, seed=9)
    t0 = time.time()
    epochs = int(os.environ.get('EPOCHS', 1500))
    train(net, X[None], Y[None], epochs=epochs, batch=1024, lr=3e-3, lr_end=2e-5, log_every=250)
    net.round_f32()
    p = net.forward(X[None])[0]
    err = p - Y
    # held-out: points between the grid nodes (mid r, mid phi), compared to bilinear interpolation of the table
    res = dict(log10_rmse=float(np.sqrt((err ** 2).mean())), log10_maxabs=float(np.abs(err).max()),
               factor_rmse=float(10 ** np.sqrt((err ** 2).mean())))
    print(res)
    save('star', net, dict(params=net.n_params(), seconds=time.time() - t0, fit=res))


if __name__ == '__main__':
    dict(meta=train_meta, ghost=train_ghost, star=train_star)[sys.argv[1]]()
