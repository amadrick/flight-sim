"""Honest evaluation on the held-out TEST clouds: network vs. the standard real-time approximations, all given
the same three features (tauSun, tauUp, cosTheta).  Writes runs/eval.json and prints a markdown table.

  .venv/bin/python evaluate.py
"""
import json
import math
import os
import numpy as np
import torch

import model as M
import phase as ph
from clouds import KINDS

LUT_N = 32


def load(split):
    return M.load_split(split)


def load_net(name):
    ck = torch.load('runs/%s.pt' % name, weights_only=False)
    if ck['arch'] == 'factor':
        net = M.ScatterNet(tuple(ck['hidden']), ck['rank'])
        fx = M.features_main
    elif ck['arch'] == 'plain3':
        net = M.PlainNet(5, tuple(ck['hidden']))
        fx = M.features_main
    else:
        net = M.PlainNet(10, tuple(ck['hidden']))
        fx = M.features_oracle
    net.load_state_dict(ck['state'])
    net.eval()
    return net, fx, ck


def predict_ms(net, fx, feat):
    with torch.no_grad():
        out = []
        x = torch.from_numpy(fx(feat))
        for i in range(0, len(x), 200000):
            out.append(torch.exp(torch.clamp(net(x[i:i + 200000]), -25.0, 9.0)).numpy())
    return np.concatenate(out).astype(np.float64)


# ---------------------------------------------------------------------------------------------- LUT (as deployed)
def lut_axes(n=LUT_N):
    u = np.linspace(0.0, 1.0, n)
    tau = np.expm1(u * M.LOG_TAU)
    chord = M.T0 * np.expm1(u * M.LOG_ANG)
    cos_t = np.clip(1.0 - 0.5 * chord * chord, -1.0, 1.0)
    return u, tau, cos_t


def bake_lut(net, n=LUT_N, half=True):
    """ln J_ms on the (tauSun, tauUp, angle) grid, exactly as src/neural/cloud-scatter.js bakes it."""
    u, tau, cos_t = lut_axes(n)
    ts, tu, c = np.meshgrid(tau, tau, cos_t, indexing='ij')
    x = np.stack(M.encode(ts.ravel(), tu.ravel(), c.ravel()), axis=1).astype(np.float32)
    with torch.no_grad():
        y = net(torch.from_numpy(x)).numpy().reshape(n, n, n).astype(np.float64)
    y = np.clip(y, -30.0, 12.0)
    if half:
        y = y.astype(np.float16).astype(np.float64)
    return y


def sample_lut(lut, tau_sun, tau_up, cos_t):
    """Trilinear lookup, the numpy twin of the GLSL cloudSunScatter() (multiple-scattering part)."""
    n = lut.shape[0]
    x1, x2, x3, _, _ = M.encode(tau_sun, tau_up, cos_t)
    out = 0.0
    f = [np.clip(v, 0, 1) * (n - 1) for v in (x1, x2, x3)]
    i0 = [np.minimum(np.floor(v).astype(np.int64), n - 2) for v in f]
    fr = [v - i for v, i in zip(f, i0)]
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (fr[0] if dx else 1 - fr[0]) * (fr[1] if dy else 1 - fr[1]) * (fr[2] if dz else 1 - fr[2])
                out = out + w * lut[i0[0] + dx, i0[1] + dy, i0[2] + dz]
    return np.exp(out)


# ------------------------------------------------------------------------------------------ tuned octave baseline
def fit_octaves(tr, ref_ms, n_oct=8, iters=400):
    """Best-case Wrenninge/Frostbite octaves: fit (a, b, c, gain) to the training set with the same loss as the net."""
    rng = np.random.default_rng(0)
    idx = rng.choice(len(tr['ja']), size=min(400000, len(tr['ja'])), replace=False)
    ts = torch.from_numpy(tr['feat'][idx, 0].astype(np.float64))
    c = torch.from_numpy(tr['feat'][idx, 2].astype(np.float64))
    y = torch.from_numpy(0.5 * (tr['ja'][idx] + tr['jb'][idx]).astype(np.float64))
    jss = torch.from_numpy(M.j_single(tr['feat'][idx]))
    w = 1.0 / (jss + torch.from_numpy(ref_ms[idx])) ** 2
    p = torch.tensor([0.0, 0.0, 0.0, 0.0], dtype=torch.float64, requires_grad=True)   # logits of a, b, c ; log gain
    opt = torch.optim.Adam([p], lr=0.05)

    def model(p):
        a, b, cc = torch.sigmoid(p[0]), torch.sigmoid(p[1]), torch.sigmoid(p[2])
        gain = torch.exp(p[3])
        j = torch.zeros_like(ts)
        for i in range(1, n_oct):
            g = M.G_GAME * cc ** i
            hg = (1 - g * g) / (1 + g * g - 2 * g * c) ** 1.5 / (4 * math.pi)
            j = j + gain * b ** i * hg * torch.exp(-(a ** i) * ts)
        return j

    for _ in range(iters):
        loss = (w * (model(p) - y) ** 2).mean()
        opt.zero_grad()
        loss.backward()
        opt.step()
    a, b, cc = [float(torch.sigmoid(v)) for v in p[:3]]
    return dict(a=a, b=b, c=cc, gain=float(torch.exp(p[3])), n=n_oct, loss=float(loss))


def binned_predictor(tr, n1=40, n2=40, n3=24):
    """Non-parametric 3-feature predictor: mean of the training J_ms in (x1, x2, x3) bins."""
    x = M.features_main(tr['feat'])
    y = 0.5 * (tr['ja'] + tr['jb']).astype(np.float64)

    def key(x):
        i = np.minimum((x[:, 0] * n1).astype(np.int64), n1 - 1)
        j = np.minimum((x[:, 1] * n2).astype(np.int64), n2 - 1)
        k = np.minimum((x[:, 2] * n3).astype(np.int64), n3 - 1)
        return (i * n2 + j) * n3 + k
    kk = key(x)
    s = np.bincount(kk, weights=y, minlength=n1 * n2 * n3)
    cnt = np.bincount(kk, minlength=n1 * n2 * n3)
    mean = s / np.maximum(cnt, 1)
    glob = y.mean()

    def predict(feat):
        k2 = key(M.features_main(feat))
        return np.where(cnt[k2] >= 8, mean[k2], glob), cnt[k2]
    return predict


def main():
    torch.set_num_threads(2)
    tr, te = load('train'), load('test')
    feat = te['feat']
    ts, tu, c = [feat[:, i].astype(np.float64) for i in range(3)]
    jss = M.j_single(feat)
    ja, jb = te['ja'].astype(np.float64), te['jb'].astype(np.float64)

    net, fx, ck = load_net('main')
    p_main = predict_ms(net, fx, feat)
    preds = {}
    have = {n: os.path.exists('runs/%s.pt' % n) for n in ('plain3', 'oracle8')}
    p_plain = predict_ms(*load_net('plain3')[:2], feat) if have['plain3'] else None
    p_orc = predict_ms(*load_net('oracle8')[:2], feat) if have['oracle8'] else None
    ref = jss + (p_orc if p_orc is not None else p_main)          # smooth noise-free weight for relative errors

    # baselines
    tuned = fit_octaves(tr, predict_ms(net, fx, tr['feat']))
    print('tuned octaves:', tuned)
    preds['Single scattering only'] = M.baseline_single(ts, tu, c)
    preds['Beer-powder (Schneider 2015)'] = M.baseline_beer_powder(ts, tu, c)
    preds['Nubis 2017 attenuation clamp'] = M.baseline_nubis2017(ts, tu, c)
    preds['Octaves, stock a=b=c=0.5, N=8 (Wrenninge/Frostbite)'] = M.baseline_octaves(ts, tu, c)
    preds['Octaves, parameters FITTED to our training set'] = M.baseline_octaves(
        ts, tu, c, a=tuned['a'], b=tuned['b'], c=tuned['c'], n=tuned['n'], gain=tuned['gain'])
    binp, bcnt = binned_predictor(tr)(feat)
    preds['Binned mean of training data (40x40x24 bins, non-parametric)'] = jss + binp
    lut = bake_lut(net)
    p_lut = sample_lut(lut, ts, tu, c)
    preds['NEURAL (%d params), direct MLP' % ck['params']] = jss + p_main
    preds['NEURAL, baked 32^3 half-float LUT (as deployed)'] = jss + p_lut
    if p_plain is not None:
        preds['Oracle: large MLP, same 3 features (not deployed)'] = jss + p_plain
    if p_orc is not None:
        preds['Oracle: large MLP, 8 features (not deployed)'] = jss + p_orc

    subsets = {
        'all': np.ones(len(ts), dtype=bool),
        'camera (image-weighted)': te['stype'] == 0,
        'interior': te['stype'] == 1,
        'thin (tauSun<1)': ts < 1,
        'mid (1<=tauSun<8)': (ts >= 1) & (ts < 8),
        'deep (tauSun>=8)': ts >= 8,
        'forward (theta<10deg)': c > math.cos(math.radians(10)),
        'side/back (theta>30deg)': c < math.cos(math.radians(30)),
    }
    for i, k in enumerate(KINDS):
        subsets['family: ' + k] = te['kind'] == i
    res = {name: {s: M.metrics(p, jss, ja, jb, ref, m) for s, m in subsets.items()} for name, p in preds.items()}
    noise = float(np.sqrt(np.mean(((ja - jb) / 2) ** 2 / ref ** 2)))
    ms_frac = float(np.mean((0.5 * (ja + jb)) / np.maximum(jss + 0.5 * (ja + jb), 1e-12)))
    lut_vs_mlp = float(np.sqrt(np.mean(((p_lut - p_main) / (jss + p_main)) ** 2)))

    print('\nTEST set: %d samples, %d unseen clouds, %d paths/sample; MC noise of the reference (rel. RMS of the mean) = %.3f'
          % (len(ts), len(np.unique(te['cloud'])), int(te['paths']), noise))
    print('mean multiple-scattering fraction of J: %.3f ; LUT vs direct MLP rel RMS diff: %.4f' % (ms_frac, lut_vs_mlp))
    hdr = '| model | rel. RMSE | log-RMSE (x factor) | energy-wtd RMSE | bias | camera rel. RMSE | deep rel. RMSE |'
    print('\n' + hdr + '\n|' + '---|' * 7)
    for name, r in res.items():
        a = r['all']
        print('| %s | %.3f | %.3f (x%.2f) | %.3f | %+.3f | %.3f | %.3f |' % (
            name, a['rel_rmse'], a['log_rmse'], math.exp(a['log_rmse']), a['energy'], a['bias'],
            r['camera (image-weighted)']['rel_rmse'], r['deep (tauSun>=8)']['rel_rmse']))
    print('\nper-subset rel. RMSE (neural direct | fitted octaves | stock octaves | single):')
    names = list(preds.keys())
    for s in subsets:
        print('  %-28s n=%6d  %.3f | %.3f | %.3f | %.3f' % (
            s, res[names[6]][s]['n'], res[names[6]][s]['rel_rmse'], res[names[4]][s]['rel_rmse'],
            res[names[3]][s]['rel_rmse'], res[names[0]][s]['rel_rmse']))
    with open('runs/eval.json', 'w') as f:
        json.dump(dict(test_samples=int(len(ts)), test_clouds=int(len(np.unique(te['cloud']))),
                       paths_per_sample=int(te['paths']), mc_noise_rel_rms=noise, ms_fraction=ms_frac,
                       lut_vs_mlp_rel_rms=lut_vs_mlp, tuned_octaves=tuned, results=res), f, indent=1)


if __name__ == '__main__':
    main()
