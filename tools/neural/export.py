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


def np_forward(layers_body, layers_ang, bias, tau_sun, tau_up, cos_t, tau_down=None):
    """float64 numpy forward pass with the float32-rounded weights: the exact arithmetic of src/neural/mlp.js."""
    x1, x2, x3, x4, x5 = M.encode(np.asarray(tau_sun, np.float64), np.asarray(tau_up, np.float64),
                                  np.asarray(cos_t, np.float64))

    def run(layers, x):
        for i, (w, b) in enumerate(layers):
            x = x @ w.T + b
            if i < len(layers) - 1:
                x = isru(x)
        return x
    cols = [2 * x1 - 1, 2 * x2 - 1, 2 * x5 - 1]
    if tau_down is not None:
        cols.append(2 * M.encode_down(np.asarray(tau_down, np.float64)) - 1)
    xb = np.stack(cols, axis=-1)
    xa = np.stack([2 * x1 - 1, 2 * x3 - 1, x4], axis=-1)
    return bias + (run(layers_body, xb) * run(layers_ang, xa)).sum(axis=-1)


def pack(net):
    """Flatten a ScatterNet to float32 (little endian) in the layout src/neural/mlp.js expects."""
    flat, stacks = [], []
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
    return flat, stacks, float(bias32)


def test_inputs(rng, n=240):
    ts = np.expm1(rng.uniform(0, math.log1p(200.0), n))
    tu = np.expm1(rng.uniform(0, math.log1p(200.0), n))
    td = np.expm1(rng.uniform(0, math.log1p(200.0), n))
    c = np.cos(np.exp(rng.uniform(math.log(1e-3), math.log(math.pi), n)))
    edge = np.array([[0, 0, 1, 0], [0, 0, -1, 0], [0, 0, 0, 5], [1e-3, 0, 1, 1], [0, 5, 0.999, 0], [5, 0, 0.5, 20],
                     [50, 50, -0.3, 50], [128, 128, 1, 128], [500, 3, 0.2, 1], [3, 500, -1, 500],
                     [0.5, 0.2, 0.99999, 0.1], [2, 1, 0.9, 3]], dtype=np.float64)
    return (np.concatenate([edge[:, 0], ts]), np.concatenate([edge[:, 1], tu]), np.concatenate([edge[:, 2], c]),
            np.concatenate([edge[:, 3], td]))


def run_meta(name):
    out = {}
    if os.path.exists('runs/%s.json' % name):
        r = json.load(open('runs/%s.json' % name))
        out['valRelRmse'] = round(r['best_val_rel_rmse'], 4)
        out['epochs'] = r['epochs']
        out['trainSeconds'] = round(r['seconds'])
    return out


def main():
    import glob
    net, _, ck = load_net('main')
    assert ck['arch'] == 'factor'
    flat, stacks, bias = pack(net)
    assert len(flat) == ck['params'], (len(flat), ck['params'])
    rng = np.random.default_rng(42)
    ts, tu, c, td = test_inputs(rng)
    ln_jms = np_forward(stacks[0], stacks[1], bias, ts, tu, c)
    j_tot = ph.phase_np(np.clip(c, -1, 1)) * np.exp(-ts) + np.exp(ln_jms)
    with torch.no_grad():   # cross-check the numpy twin against the torch model (float32)
        tt = net(torch.from_numpy(np.stack(M.encode(ts, tu, c), axis=1).astype(np.float32))).numpy()
    assert np.abs(tt - ln_jms).max() < 2e-3, np.abs(tt - ln_jms).max()

    # LUT reference values (unquantised) on the bake grid
    u, tau, cos_t = lut_axes(LUT_N)
    gi, gj, gk = np.meshgrid(np.arange(LUT_N), np.arange(LUT_N), np.arange(LUT_N), indexing='ij')
    lut = np_forward(stacks[0], stacks[1], bias, tau[gi], tau[gj], cos_t[gk])
    pick = rng.integers(0, LUT_N, size=(64, 3))
    lut_samples = [[int(i), int(j), int(k), float(lut[i, j, k])] for i, j, k in pick]

    meta = dict(trained=datetime.date.today().isoformat(), params=int(ck['params']), arch='factorised MLP',
                hidden=list(ck['hidden']), rank=int(ck['rank']), prior=ck.get('prior', 'dataset'), **run_meta('main'))
    for split in ('train', 'val', 'test'):
        ds = [json.load(open(p)) for p in sorted(glob.glob('data/%s.json' % split) + glob.glob('data/%s_*.json' % split))]
        if ds:
            meta[split] = dict(clouds=sum(d['clouds'] for d in ds), samples=sum(d['samples'] for d in ds),
                               pathsPerSample=ds[0]['paths_per_sample'], totalPaths=sum(d['total_paths'] for d in ds),
                               scatterEvents=sum(d['scatter_events'] for d in ds),
                               minutes=round(sum(d['minutes'] for d in ds), 1))
    tuned = dict(a=0.5, b=0.5, c=0.5, gain=1.0, n=8)
    if os.path.exists('runs/eval.json'):
        ev = json.load(open('runs/eval.json'))
        tuned = ev['tuned_octaves']
        meta['testMcNoiseRelRms'] = round(ev['mc_noise_rel_rms'], 4)
        meta['testMetrics'] = {k: {m: round(v['all'][m], 4) for m in ('disp_rmse', 'rel_rmse', 'log_rmse', 'fac2_all')}
                               for k, v in ev['results'].items()}
    enc = dict(tauMax=M.TAU_MAX, t0=M.T0, ratioEps=M.RATIO_EPS)
    phase = dict(gHG=ph.G_HG, gD=ph.G_D, alpha=ph.ALPHA, wD=ph.W_D, gMean=ph.G_MEAN,
                 dropletDiameterUm=ph.DROPLET_DIAMETER_UM)
    model = dict(version=1, hidden=list(ck['hidden']), rank=int(ck['rank']), bodyExtra=0, enc=enc, phase=phase,
                 octaves=dict(a=tuned['a'], b=tuned['b'], c=tuned['c'], gain=tuned['gain'], n=int(tuned['n']), g=M.G_GAME),
                 meta=meta, b64=base64.b64encode(flat.tobytes()).decode('ascii'))
    js = ('// AUTO-GENERATED by tools/neural/export.py - do not edit by hand.\n'
          '// Trained weights of the cloud multiple-scattering networks (float32, base64 little-endian) plus the\n'
          '// feature-encoding constants, the phase function they were trained with, and training metadata.\n'
          '// Layout: body MLP [W(out x in) row-major, b] per layer, angular MLP likewise, then the output bias.\n'
          '\n// Main model: J_ms(tauSun, tauUp, cosTheta), %d parameters.\n'
          'export const CLOUD_SCATTER_MODEL = %s;\n' % (len(flat), json.dumps(model, indent=2)))
    vectors = dict(note='Python (numpy float64, float32-rounded weights) outputs of the exported networks.',
                   tauSun=ts.tolist(), tauUp=tu.tolist(), cosTheta=c.tolist(), tauDown=td.tolist(),
                   lnJms=ln_jms.tolist(), J=j_tot.tolist(), lutSize=LUT_N, lutSamples=lut_samples,
                   lutMean=float(lut.mean()))

    # ---- the same architecture trained with the thick-column population prior: createNeuralCloudScatter({ prior: 'thick' })
    if os.path.exists('runs/main_thick.pt'):
        netd, _, ckd = load_net('main_thick')
        flatd, std, biasd = pack(netd)
        assert ckd['arch'] == 'factor' and len(flatd) == ckd['params'] and ckd.get('prior') == 'thick'
        lnd = np_forward(std[0], std[1], biasd, ts, tu, c)
        metad = dict(trained=meta['trained'], params=int(ckd['params']), arch='factorised MLP', hidden=list(ckd['hidden']),
                     rank=int(ckd['rank']), prior='thick', **run_meta('main_thick'))
        if 'testMetrics' in meta:
            metad['testMetrics'] = {k: v for k, v in meta['testMetrics'].items() if 'thick-column prior' in k}
        modeld = dict(version=1, hidden=list(ckd['hidden']), rank=int(ckd['rank']), bodyExtra=0, enc=enc, phase=phase,
                      octaves=model['octaves'], meta=metad, b64=base64.b64encode(flatd.tobytes()).decode('ascii'))
        js += ('\n// Same network trained with the thick-column population prior (createNeuralCloudScatter({ prior: "thick" })).\n'
               'export const CLOUD_SCATTER_MODEL_THICK_PRIOR = %s;\n' % json.dumps(modeld, indent=2))
        vectors['lnJmsThickPrior'] = lnd.tolist()

    # ---- optional 4-feature model (adds tauDown)
    if os.path.exists('runs/main4.pt'):
        net4, _, ck4 = load_net('main4')
        flat4, st4, bias4 = pack(net4)
        assert len(flat4) == ck4['params']
        ln4 = np_forward(st4[0], st4[1], bias4, ts, tu, c, td)
        with torch.no_grad():
            x = np.concatenate([np.stack(M.encode(ts, tu, c), axis=1), M.encode_down(td)[:, None]], axis=1)
            tt = net4(torch.from_numpy(x.astype(np.float32))).numpy()
        assert np.abs(tt - ln4).max() < 2e-3, np.abs(tt - ln4).max()
        meta4 = dict(trained=meta['trained'], params=int(ck4['params']), arch='factorised MLP (+tauDown)',
                     hidden=list(ck4['hidden']), rank=int(ck4['rank']), prior=ck4.get('prior', 'dataset'), **run_meta('main4'))
        if 'testMetrics' in meta:
            meta4['testMetrics'] = {k: v for k, v in meta['testMetrics'].items() if 'Stretch' in k}
        model4 = dict(version=1, hidden=list(ck4['hidden']), rank=int(ck4['rank']), bodyExtra=1, enc=enc, phase=phase,
                      meta=meta4, b64=base64.b64encode(flat4.tobytes()).decode('ascii'))
        js += ('\n// Optional 4-feature model: J_ms(tauSun, tauUp, cosTheta, tauDown), %d parameters.\n'
               'export const CLOUD_SCATTER_MODEL4 = %s;\n' % (len(flat4), json.dumps(model4, indent=2)))
        vectors['lnJms4'] = ln4.tolist()
        vectors['J4'] = (ph.phase_np(np.clip(c, -1, 1)) * np.exp(-ts) + np.exp(ln4)).tolist()

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, 'weights.js'), 'w') as f:
        f.write(js)
    with open(os.path.join(OUT_DIR, 'test-vectors.json'), 'w') as f:
        json.dump(vectors, f)
    print('wrote %s (%d params%s, %.1f kB) and test-vectors.json' % (
        os.path.join(OUT_DIR, 'weights.js'), len(flat), ' + 4-feature model' if 'lnJms4' in vectors else '', len(js) / 1024))


if __name__ == '__main__':
    main()
