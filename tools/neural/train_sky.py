"""Sky-light visibility network V(tauUp, tauDown): train, evaluate against simple baselines, export.

  .venv/bin/python train_sky.py        (needs data/sky_train.npz and data/sky_test.npz from gen_sky.py)

Writes src/neural/weights-sky.js, src/neural/test-vectors-sky.json and runs/sky_eval.json.
"""
import base64
import datetime
import json
import math
import os
import time
import numpy as np
import torch
import torch.nn as nn

import model as M
import phase as ph
from clouds import KINDS

OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'neural'))
LUT_N = 32
Q_EXTRAP = 0.71


class SkyNet(nn.Module):
    """V = sigmoid(MLP(2 ln(1+tauUp)/ln(1+tauMax) - 1, 2 ln(1+tauDown)/ln(1+tauMax) - 1))."""

    def __init__(self, hidden=(16, 16)):
        super().__init__()
        self.hidden = tuple(hidden)
        self.net = M.mlp([2, *hidden, 1])

    def forward(self, x):
        return torch.sigmoid(self.net(x).squeeze(1))


def enc(tau_up, tau_down):
    tau_up, tau_down = np.broadcast_arrays(tau_up, tau_down)
    return np.stack([2 * np.log1p(np.clip(tau_up, 0, M.TAU_MAX)) / M.LOG_TAU - 1,
                     2 * np.log1p(np.clip(tau_down, 0, M.TAU_MAX)) / M.LOG_TAU - 1], axis=-1)


def baseline_diffusion(tu, td, g=ph.G_MEAN):
    """Two-stream / diffusion solution for a plane-parallel conservative layer under a uniform sky."""
    return (td * (1 - g) + Q_EXTRAP) / ((tu + td) * (1 - g) + 2 * Q_EXTRAP)


def unscattered(tu):
    """Direct (unscattered) light of a uniform sky dome: (1/4pi) int_upper exp(-tauUp/mu) dOmega = E2(tauUp)/2."""
    x, w = np.polynomial.legendre.leggauss(48)
    mu = 0.5 * (x + 1)
    return 0.5 * (0.5 * w[None, :] * np.exp(-tu[:, None] / mu[None, :])).sum(axis=1)


def rmse(p, va, vb, mask=None):
    if mask is None:
        mask = np.ones(len(p), bool)
    return float(math.sqrt(max(np.mean((p[mask] - va[mask]) * (p[mask] - vb[mask])), 0.0)))


def main():
    torch.set_num_threads(2)
    torch.manual_seed(0)
    tr = np.load('data/sky_train.npz')
    te = np.load('data/sky_test.npz')
    xt = torch.from_numpy(enc(tr['tau_up'], tr['tau_down']).astype(np.float32))
    yt = torch.from_numpy(0.5 * (tr['va'] + tr['vb']).astype(np.float32))
    net = SkyNet()
    n = len(yt)
    batch, epochs = 4096, 30
    steps = epochs * (n // batch)
    opt = torch.optim.Adam(net.parameters(), lr=4e-3)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=4e-3, total_steps=steps, pct_start=0.1, final_div_factor=200)
    t0 = time.time()
    log = []
    tu, td = te['tau_up'].astype(np.float64), te['tau_down'].astype(np.float64)
    va, vb = te['va'].astype(np.float64), te['vb'].astype(np.float64)
    xe = torch.from_numpy(enc(tu, td).astype(np.float32))
    for ep in range(epochs):
        perm = torch.randperm(n)
        run = 0.0
        for s in range(n // batch):
            idx = perm[s * batch:(s + 1) * batch]
            loss = ((net(xt[idx]) - yt[idx]) ** 2).mean()      # plain MSE -> conditional mean, unbiased under MC noise
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            sched.step()
            run += loss.item()
        with torch.no_grad():
            pe = net(xe).numpy().astype(np.float64)
        log.append(dict(epoch=ep + 1, train_loss=run / (n // batch), test_rmse=rmse(pe, va, vb)))
        if ep % 5 == 4 or ep == 0:
            print('ep %2d  train mse %.5f  test RMSE (noise-debiased) %.4f' % (ep + 1, log[-1]['train_loss'], log[-1]['test_rmse']))

    # ---- export (float32 weights; numpy float64 twin = JS arithmetic)
    layers, flat = [], []
    for mod in net.net:
        if isinstance(mod, nn.Linear):
            w = mod.weight.detach().numpy().astype(np.float32)
            b = mod.bias.detach().numpy().astype(np.float32)
            flat += [w.ravel(), b.ravel()]
            layers.append((w.astype(np.float64), b.astype(np.float64)))
    flat = np.concatenate(flat).astype('<f4')

    def fwd(tau_up, tau_down):
        x = enc(np.asarray(tau_up, np.float64), np.asarray(tau_down, np.float64))
        for i, (w, b) in enumerate(layers):
            x = x @ w.T + b
            if i < len(layers) - 1:
                x = x / np.sqrt(1 + x * x)
        return 1.0 / (1.0 + np.exp(-x[..., 0]))

    # as deployed: 32x32 half-float LUT, bilinear
    u = np.linspace(0, 1, LUT_N)
    tau = np.expm1(u * M.LOG_TAU)
    lut = fwd(tau[:, None], tau[None, :])                       # [i (tauUp), j (tauDown)]
    lut16 = lut.astype(np.float16).astype(np.float64)

    def sample_lut(tau_up, tau_down):
        f = [np.clip(np.log1p(np.clip(t, 0, M.TAU_MAX)) / M.LOG_TAU, 0, 1) * (LUT_N - 1) for t in (tau_up, tau_down)]
        i0 = [np.minimum(np.floor(v).astype(np.int64), LUT_N - 2) for v in f]
        fr = [v - i for v, i in zip(f, i0)]
        out = 0.0
        for a in (0, 1):
            for b in (0, 1):
                out = out + (fr[0] if a else 1 - fr[0]) * (fr[1] if b else 1 - fr[1]) * lut16[i0[0] + a, i0[1] + b]
        return out

    preds = {
        'Beer from above: exp(-tauUp)': np.exp(-tu),
        'Constant 0.5': np.full(len(tu), 0.5),
        'Unscattered sky light only: E2(tauUp)/2  [no multiple scattering]': unscattered(tu),
        'Diffusion / two-stream slab formula (analytic fallback)': baseline_diffusion(tu, td),
        'NEURAL sky visibility (%d params), direct' % len(flat): fwd(tu, td),
        'NEURAL sky visibility, as deployed (32x32 half-float LUT)': sample_lut(tu, td),
    }
    subsets = {'all': np.ones(len(tu), bool)}
    for i, k in enumerate(KINDS):
        subsets[k] = te['kind'] == i
    res = {name: {s: rmse(p, va, vb, m) for s, m in subsets.items()} for name, p in preds.items()}
    noise = float(np.sqrt(np.mean(((va - vb) / 2) ** 2)))
    print('\nSky visibility, TEST: %d samples, %d unseen clouds, %d paths; MC noise of reference (RMS) %.4f; mean V %.3f' % (
        len(tu), len(np.unique(te['cloud'])), int(te['paths']), noise, float(np.mean(0.5 * (va + vb)))))
    print('| model | RMSE all | ' + ' | '.join(KINDS) + ' |')
    print('|---|---|' + '---|' * len(KINDS))
    for name, r in res.items():
        print('| %s | %.4f | ' % (name, r['all']) + ' | '.join('%.4f' % r[k] for k in KINDS) + ' |')

    meta = dict(trained=datetime.date.today().isoformat(), params=int(len(flat)), hidden=list(net.hidden),
                trainSamples=int(n), trainClouds=int(len(np.unique(tr['cloud']))), trainPaths=int(tr['paths']),
                testSamples=int(len(tu)), testClouds=int(len(np.unique(te['cloud']))), testPaths=int(te['paths']),
                testRmse={k: round(v['all'], 4) for k, v in res.items()}, mcNoiseRms=round(noise, 4),
                trainSeconds=round(time.time() - t0))
    model = dict(version=1, hidden=list(net.hidden), enc=dict(tauMax=M.TAU_MAX),
                 diffusion=dict(g=ph.G_MEAN, q=Q_EXTRAP), meta=meta,
                 b64=base64.b64encode(flat.tobytes()).decode('ascii'))
    with open(os.path.join(OUT_DIR, 'weights-sky.js'), 'w') as f:
        f.write('// AUTO-GENERATED by tools/neural/train_sky.py - do not edit by hand.\n'
                '// Sky-light visibility network V(tauUp, tauDown): %d float32 parameters (base64 little-endian).\n'
                '// Layout: [W(out x in) row-major, b] per layer; hidden activation ISRU, output sigmoid.\n'
                'export const CLOUD_SKY_MODEL = %s;\n' % (len(flat), json.dumps(model, indent=2)))
    rng = np.random.default_rng(7)
    a = np.concatenate([[0, 0, 5, 200, 1e-3, 128], np.expm1(rng.uniform(0, math.log1p(200), 200))])
    b = np.concatenate([[0, 5, 0, 200, 300, 0], np.expm1(rng.uniform(0, math.log1p(200), 200))])
    pick = rng.integers(0, LUT_N, size=(40, 2))
    with open(os.path.join(OUT_DIR, 'test-vectors-sky.json'), 'w') as f:
        json.dump(dict(tauUp=a.tolist(), tauDown=b.tolist(), V=fwd(a, b).tolist(), lutSize=LUT_N,
                       lutSamples=[[int(i), int(j), float(lut[i, j])] for i, j in pick]), f)
    os.makedirs('runs', exist_ok=True)
    with open('runs/sky_eval.json', 'w') as f:
        json.dump(dict(results=res, noise=noise, log=log, meta=meta), f, indent=1)
    print('wrote weights-sky.js (%d params)' % len(flat))


if __name__ == '__main__':
    main()
