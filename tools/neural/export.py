"""Export the trained network for the browser: src/neural/weights.js (+ test vectors for the JS unit test).

  .venv/bin/python export.py            (after train.py --name main and evaluate.py)
"""
import base64
import datetime
import json
import math
import os
import numpy as np
import torch

import model as M
import phase as ph
from evaluate import load_net, lut_axes, LUT_N

OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'neural'))


def isru(z):
    return z / np.sqrt(1.0 + z * z)


def np_forward(layers_body, layers_ang, bias, tau_sun, tau_up, cos_t):
    """float64 numpy forward pass with the float32-rounded weights: the exact arithmetic of src/neural/mlp.js."""
    x1, x2, x3, x4, x5 = M.encode(np.asarray(tau_sun, np.float64), np.asarray(tau_up, np.float64),
                                  np.asarray(cos_t, np.float64))

    def run(layers, x):
        for i, (w, b) in enumerate(layers):
            x = x @ w.T + b
            if i < len(layers) - 1:
                x = isru(x)
        return x
    xb = np.stack([2 * x1 - 1, 2 * x2 - 1, 2 * x5 - 1], axis=-1)
    xa = np.stack([2 * x1 - 1, 2 * x3 - 1, x4], axis=-1)
    return bias + (run(layers_body, xb) * run(layers_ang, xa)).sum(axis=-1)


def main():
    net, _, ck = load_net('main')
    assert ck['arch'] == 'factor'
    flat = []
    stacks = []
    for seq in (net.body, net.ang):
        layers = []
        for mod in seq:
            if isinstance(mod, torch.nn.Linear):
                w = mod.weight.detach().numpy().astype(np.float32)
                b = mod.bias.detach().numpy().astype(np.float32)
                flat += [w.ravel(), b.ravel()]
                layers.append((w.astype(np.float64), b.astype(np.float64)))
        stacks.append(layers)
    bias32 = np.float32(net.bias.detach().numpy())
    flat.append(np.array([bias32], dtype=np.float32))
    flat = np.concatenate(flat).astype('<f4')
    assert len(flat) == ck['params'], (len(flat), ck['params'])
    b64 = base64.b64encode(flat.tobytes()).decode('ascii')

    def fwd(ts, tu, c):
        return np_forward(stacks[0], stacks[1], float(bias32), ts, tu, c)

    # ---- test vectors
    rng = np.random.default_rng(42)
    n = 240
    ts = np.expm1(rng.uniform(0, math.log1p(200.0), n))
    tu = np.expm1(rng.uniform(0, math.log1p(200.0), n))
    c = np.cos(np.exp(rng.uniform(math.log(1e-3), math.log(math.pi), n)))
    edge = np.array([[0, 0, 1], [0, 0, -1], [0, 0, 0], [1e-3, 0, 1], [0, 5, 0.999], [5, 0, 0.5], [50, 50, -0.3],
                     [128, 128, 1], [500, 3, 0.2], [3, 500, -1], [0.5, 0.2, 0.99999], [2, 1, 0.9]], dtype=np.float64)
    ts, tu, c = np.concatenate([edge[:, 0], ts]), np.concatenate([edge[:, 1], tu]), np.concatenate([edge[:, 2], c])
    ln_jms = fwd(ts, tu, c)
    j_tot = ph.phase_np(np.clip(c, -1, 1)) * np.exp(-ts) + np.exp(ln_jms)
    # cross-check the numpy twin against the torch model (float32)
    with torch.no_grad():
        x = torch.from_numpy(np.stack(M.encode(ts, tu, c), axis=1).astype(np.float32))
        tt = net(x).numpy()
    assert np.abs(tt - ln_jms).max() < 2e-3, np.abs(tt - ln_jms).max()

    # ---- LUT reference values (unquantised) on the bake grid
    u, tau, cos_t = lut_axes(LUT_N)
    gi, gj, gk = np.meshgrid(np.arange(LUT_N), np.arange(LUT_N), np.arange(LUT_N), indexing='ij')
    lut = fwd(tau[gi], tau[gj], cos_t[gk])
    pick = rng.integers(0, LUT_N, size=(64, 3))
    lut_samples = [[int(i), int(j), int(k), float(lut[i, j, k])] for i, j, k in pick]

    meta = dict(trained=datetime.date.today().isoformat(), params=int(ck['params']), arch='factorised MLP',
                hidden=list(ck['hidden']), rank=int(ck['rank']))
    tuned = dict(a=0.5, b=0.5, c=0.5, gain=1.0, n=8)
    import glob
    for split in ('train', 'val', 'test'):
        ds = [json.load(open(p)) for p in sorted(glob.glob('data/%s.json' % split) + glob.glob('data/%s_*.json' % split))]
        if ds:
            meta[split] = dict(clouds=sum(d['clouds'] for d in ds), samples=sum(d['samples'] for d in ds),
                               pathsPerSample=ds[0]['paths_per_sample'], totalPaths=sum(d['total_paths'] for d in ds),
                               scatterEvents=sum(d['scatter_events'] for d in ds),
                               minutes=round(sum(d['minutes'] for d in ds), 1))
    if os.path.exists('runs/main.json'):
        r = json.load(open('runs/main.json'))
        meta['valRelRmse'] = round(r['best_val_rel_rmse'], 4)
        meta['epochs'] = r['epochs']
    if os.path.exists('runs/eval.json'):
        e = json.load(open('runs/eval.json'))
        tuned = e['tuned_octaves']
        meta['test'] = dict(meta.get('test', {}), mcNoiseRelRms=round(e['mc_noise_rel_rms'], 4))
        meta['testRelRmse'] = {k: round(v['all']['rel_rmse'], 4) for k, v in e['results'].items()}
        meta['testLogRmse'] = {k: round(v['all']['log_rmse'], 4) for k, v in e['results'].items()}

    model = dict(version=1, hidden=list(ck['hidden']), rank=int(ck['rank']),
                 enc=dict(tauMax=M.TAU_MAX, t0=M.T0, ratioEps=M.RATIO_EPS),
                 phase=dict(gHG=ph.G_HG, gD=ph.G_D, alpha=ph.ALPHA, wD=ph.W_D, gMean=ph.G_MEAN,
                            dropletDiameterUm=ph.DROPLET_DIAMETER_UM),
                 octaves=dict(a=tuned['a'], b=tuned['b'], c=tuned['c'], gain=tuned['gain'], n=int(tuned['n']), g=M.G_GAME),
                 meta=meta)
    js = ('// AUTO-GENERATED by tools/neural/export.py - do not edit by hand.\n'
          '// Trained weights of the cloud multiple-scattering network (%d float32 parameters, base64 little-endian)\n'
          '// plus the feature-encoding constants, the phase function it was trained with, and training metadata.\n'
          '// Layout: body MLP [W(out x in) row-major, b] per layer, angular MLP likewise, then the output bias.\n'
          'export const CLOUD_SCATTER_MODEL = %s;\n' % (len(flat), json.dumps(dict(model, b64=b64), indent=2)))
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, 'weights.js'), 'w') as f:
        f.write(js)
    with open(os.path.join(OUT_DIR, 'test-vectors.json'), 'w') as f:
        json.dump(dict(note='Python (numpy float64, float32-rounded weights) outputs of the exported network.',
                       tauSun=ts.tolist(), tauUp=tu.tolist(), cosTheta=c.tolist(), lnJms=ln_jms.tolist(),
                       J=j_tot.tolist(), lutSize=LUT_N, lutSamples=lut_samples,
                       lutMean=float(lut.mean())), f)
    print('wrote %s (%d params, %.1f kB) and test-vectors.json' % (os.path.join(OUT_DIR, 'weights.js'), len(flat),
                                                                  len(js) / 1024))


if __name__ == '__main__':
    main()
