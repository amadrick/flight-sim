"""Train the ground-cover network (numpy only): 16 terrain features -> 12 cover fractions.

    python3 train.py [--hidden 16] [--epochs 40] [--out data/model.npz]

MLP 16 -> H -> H -> 12, tanh hidden units, logistic outputs, weighted squared error, Adam with cosine decay.
Whole patches are held out for validation so the score measures generalisation to unseen terrain.
"""
import glob, json, os, sys, time
import numpy as np
import features as F
import ecosim

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
NAMES = ecosim.OUT_NAMES
HOLDOUT = [2, 9, 15, 22, 30, 37, 41]       # alpine, mesa, hills, desert, hills, alpine, plain
# loss weights per output (the conifer share only matters where there is forest: weighted per sample below)
OUT_W = np.array([2.0, 1.0, 1.0, 1.5, 1.5, 1.5, 2.0, 1.0, 0.7, 0.7, 1.0, 0.5])


def arg(name, default):
    return type(default)(sys.argv[sys.argv.index('--' + name) + 1]) if '--' + name in sys.argv else default


def load(rng, patches=None):
    xs, ys, ws, ps = [], [], [], []
    for f in sorted(glob.glob(os.path.join(DATA, 'ds_*.npz'))):
        d = np.load(f)
        p = int(d['patch'][0])
        if patches is not None and p not in patches:
            continue
        for rep in range(2):
            n = len(d['lv'])
            kb = np.zeros(n) if rep == 0 else rng.random(n)
            raw = d['rawA'] * (1 - kb[:, None]) + d['rawB'] * kb[:, None]
            y = d['ya'] * (1 - kb[:, None]) + d['yb'] * kb[:, None]
            x = F.inputs(raw, d['lv'] + kb, d['latk'])
            y = y.astype(np.float64).copy()
            w = np.tile(OUT_W, (n, 1))
            forest = y[:, 0]
            y[:, 1] = np.clip(y[:, 1] / np.maximum(forest, 1e-3), 0.0, 1.0)      # conifer share of the canopy
            w[:, 1] *= np.clip(forest * 2.0, 0.0, 1.0)
            xs.append(x); ys.append(y); ws.append(w); ps.append(np.full(n, p))
    return np.concatenate(xs), np.concatenate(ys), np.concatenate(ws), np.concatenate(ps)


def init(sizes, rng):
    return [(rng.standard_normal((sizes[i + 1], sizes[i])) * np.sqrt(1.0 / sizes[i]), np.zeros(sizes[i + 1])) for i in range(len(sizes) - 1)]


def forward(layers, x):
    acts = [x]
    for i, (w, b) in enumerate(layers):
        z = acts[-1] @ w.T + b
        acts.append(np.tanh(z) if i < len(layers) - 1 else 1.0 / (1.0 + np.exp(-z)))
    return acts


def main():
    hidden, epochs, bs = arg('hidden', 16), arg('epochs', 40), 1024
    rng = np.random.default_rng(7)
    allp = sorted(int(os.path.basename(f)[3:-4]) for f in glob.glob(os.path.join(DATA, 'ds_*.npz')))
    train_p = [p for p in allp if p not in HOLDOUT] if '--all' not in sys.argv else allp
    X, Y, Wt, _ = load(rng, train_p)
    Xv, Yv, Wv, Pv = load(rng, [p for p in allp if p in HOLDOUT])
    print(f'train {len(X)} samples from {len(train_p)} patches, validation {len(Xv)} from {len(HOLDOUT)} patches', flush=True)
    sizes = [F.N_IN, hidden, hidden, len(NAMES)]
    layers = init(sizes, rng)
    m = [(np.zeros_like(w), np.zeros_like(b)) for w, b in layers]
    v = [(np.zeros_like(w), np.zeros_like(b)) for w, b in layers]
    steps = epochs * (len(X) // bs); t = 0; lr0 = 4e-3
    t0 = time.time()
    for ep in range(epochs):
        perm = rng.permutation(len(X))
        tot = 0.0
        for k in range(len(X) // bs):
            idx = perm[k * bs:(k + 1) * bs]
            x, y, w = X[idx], Y[idx], Wt[idx]
            acts = forward(layers, x)
            o = acts[-1]
            err = (o - y) * w
            tot += float((err * (o - y)).mean())
            delta = 2.0 * err * o * (1.0 - o) / bs
            t += 1
            lr = lr0 * (0.02 + 0.98 * 0.5 * (1 + np.cos(np.pi * t / steps)))
            for i in range(len(layers) - 1, -1, -1):
                gw, gb = delta.T @ acts[i], delta.sum(axis=0)
                if i > 0:
                    delta = (delta @ layers[i][0]) * (1.0 - acts[i] ** 2)
                for j, (g, par) in enumerate(((gw, layers[i][0]), (gb, layers[i][1]))):
                    mm = m[i][j]; vv = v[i][j]
                    mm *= 0.9; mm += 0.1 * g
                    vv *= 0.999; vv += 0.001 * g * g
                    par -= lr * (mm / (1 - 0.9 ** t)) / (np.sqrt(vv / (1 - 0.999 ** t)) + 1e-8)
        if ep % 5 == 4 or ep == epochs - 1:
            ov = forward(layers, Xv)[-1]
            print(f'epoch {ep + 1:3d}  train loss {tot / (len(X) // bs):.5f}  val wmse {float((Wv * (ov - Yv) ** 2).mean()):.5f}  {time.time() - t0:.0f} s', flush=True)
    # ---- report ---------------------------------------------------------------------------------------------
    report = {'hidden': hidden, 'params': int(sum(w.size + b.size for w, b in layers)), 'train_samples': int(len(X)), 'val_samples': int(len(Xv)),
              'train_patches': train_p, 'holdout_patches': HOLDOUT, 'outputs': {}}
    ot, ov = forward(layers, X)[-1], forward(layers, Xv)[-1]
    print('%-8s %8s %8s %8s %8s %8s' % ('output', 'mean', 'rmse_tr', 'rmse_val', 'R2_tr', 'R2_val'))
    for k, name in enumerate(NAMES):
        def score(o, y, w):
            w = w[:, k] / OUT_W[k]
            mse = float((w * (o[:, k] - y[:, k]) ** 2).sum() / w.sum())
            mu = float((w * y[:, k]).sum() / w.sum())
            var = float((w * (y[:, k] - mu) ** 2).sum() / w.sum())
            return np.sqrt(mse), 1.0 - mse / max(var, 1e-9), mu
        rt, r2t, mu = score(ot, Y, Wt); rv, r2v, _ = score(ov, Yv, Wv)
        report['outputs'][name] = {'mean': mu, 'rmse_train': rt, 'rmse_val': rv, 'r2_train': r2t, 'r2_val': r2v}
        print('%-8s %8.3f %8.3f %8.3f %8.3f %8.3f' % (name, mu, rt, rv, r2t, r2v))
    out = arg('out', os.path.join(DATA, 'model.npz'))
    np.savez(out, sizes=np.array(sizes), **{f'w{i}': w for i, (w, b) in enumerate(layers)}, **{f'b{i}': b for i, (w, b) in enumerate(layers)})
    json.dump(report, open(out.replace('.npz', '.json'), 'w'), indent=1)
    print('saved', out)


if __name__ == '__main__':
    main()
