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


EXTRA_BY_NAME = {'x_tauDown': '3', 'x_mu0': '6', 'x_sigma': '5', 'x_tauView': '4', 'x_tauDown_mu0': '3,6'}


def load_net(name):
    ck = torch.load('runs/%s.pt' % name, weights_only=False)
    st = ck['state']
    if ck['arch'] == 'factor':
        net = M.ScatterNet(tuple(ck['hidden']), ck['rank'])
        fx = M.features_factor
    elif ck['arch'] == 'factor4':
        net = M.ScatterNet(tuple(ck['hidden']), ck['rank'], n_extra=1)
        fx = M.features_factor4
    else:
        ws = [v for k, v in st.items() if k.endswith('weight')]
        hidden = tuple(int(w.shape[0]) for w in ws[:-1])
        n_in = int(ws[0].shape[1])
        net = M.PlainNet(n_in, hidden)
        if ck['arch'] == 'plain3':
            fx = M.features_main
        elif ck['arch'] == 'oracle8':
            fx = M.features_oracle
        else:
            cols = [int(c) for c in (ck.get('extra') or EXTRA_BY_NAME[name]).split(',')]
            fx = lambda feat: M.features_oracle(feat)[:, [0, 1, 2, 3, 4] + [5 + c - 3 for c in cols]]
    if ck.get('drop_up'):
        fx = M.drop_up(fx)
    net.load_state_dict(st)
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


def interp_grid(grid, coords):
    """N-linear interpolation of grid (n0, n1, ..., [channels]) at coords in [0,1] per axis (clamped)."""
    nd = len(coords)
    idx, fr = [], []
    for ax, v in enumerate(coords):
        n = grid.shape[ax]
        f = np.clip(v, 0.0, 1.0) * (n - 1)
        i = np.minimum(np.floor(f).astype(np.int64), n - 2)
        idx.append(i)
        fr.append(f - i)
    out = 0.0
    for corner in range(1 << nd):
        w = 1.0
        ii = []
        for ax in range(nd):
            bit = (corner >> ax) & 1
            w = w * (fr[ax] if bit else 1.0 - fr[ax])
            ii.append(idx[ax] + bit)
        g = grid[tuple(ii)]
        out = out + (w[:, None] * g if g.ndim == 2 else w * g)
    return out


BODY4_N = (24, 24, 12)     # (tauSun, tauUp, tauDown) resolution of the 4-feature body texture (as in cloud-scatter.js)
ANG4_N = (32, 48)          # (tauSun, angle) resolution of the 4-feature angular texture


def bake_factor4(net, half=True):
    """The optional 4-feature model as deployed: body factors on a 3-D grid, angular factors on a 2-D grid."""
    u = [np.linspace(0, 1, n) for n in BODY4_N]
    tau = [np.expm1(v * M.LOG_TAU) for v in u]
    ts, tu, td = np.meshgrid(tau[0], tau[1], tau[2], indexing='ij')
    x5 = tu / (tu + ts + M.RATIO_EPS)
    xb = np.stack([2 * np.log1p(ts) / M.LOG_TAU - 1, 2 * np.log1p(tu) / M.LOG_TAU - 1, 2 * x5 - 1,
                   2 * np.log1p(td) / M.LOG_TAU - 1], axis=-1).reshape(-1, 4).astype(np.float32)
    ua = [np.linspace(0, 1, n) for n in ANG4_N]
    chord = M.T0 * np.expm1(ua[1] * M.LOG_ANG)
    cos_t = np.clip(1 - 0.5 * chord * chord, -1, 1)
    a1, a3 = np.meshgrid(ua[0], ua[1], indexing='ij')
    _, a4 = np.meshgrid(ua[0], cos_t, indexing='ij')
    xa = np.stack([2 * a1 - 1, 2 * a3 - 1, a4], axis=-1).reshape(-1, 3).astype(np.float32)
    with torch.no_grad():
        B = net.body(torch.from_numpy(xb)).numpy().reshape(*BODY4_N, -1).astype(np.float64)
        A = net.ang(torch.from_numpy(xa)).numpy().reshape(*ANG4_N, -1).astype(np.float64)
    if half:
        B = B.astype(np.float16).astype(np.float64)
        A = A.astype(np.float16).astype(np.float64)
    return B, A, float(net.bias)


def sample_factor4(B, A, bias, tau_sun, tau_up, cos_t, tau_down):
    x1, x2, x3, _, _ = M.encode(tau_sun, tau_up, cos_t)
    x6 = M.encode_down(tau_down)
    b = interp_grid(B, [x1, x2, x6])
    a = interp_grid(A, [x1, x3])
    return np.exp(np.clip(bias + (a * b).sum(axis=1), -30.0, 12.0))


def main():
    torch.set_num_threads(2)
    tr, te = load('train'), load('test')
    feat = te['feat']
    ts, tu, c = [feat[:, i].astype(np.float64) for i in range(3)]
    td = feat[:, 3].astype(np.float64)
    jss = M.j_single(feat)
    ja, jb = te['ja'].astype(np.float64), te['jb'].astype(np.float64)
    noise = M.mc_noise(jss, ja, jb, te['j2'].astype(np.float64), te['paths'])

    net, fx, ck = load_net('main')
    p_main = predict_ms(net, fx, feat)
    have = lambda n: os.path.exists('runs/%s.pt' % n)
    p_orc = predict_ms(*load_net('oracle8')[:2], feat) if have('oracle8') else None
    ref = jss + (p_orc if p_orc is not None else p_main)          # smooth noise-free weight for relative errors

    tuned = fit_octaves(tr, predict_ms(net, fx, tr['feat']))
    print('fitted octaves:', tuned)
    preds = {}
    preds['Single scattering only'] = M.baseline_single(ts, tu, c)
    preds['Beer-powder (Schneider 2015)'] = M.baseline_beer_powder(ts, tu, c)
    preds['Nubis 2017 attenuation clamp'] = M.baseline_nubis2017(ts, tu, c)
    preds['Octaves, stock a=b=c=0.5, N=8 (Wrenninge / Frostbite)'] = M.baseline_octaves(ts, tu, c)
    preds['Octaves, (a,b,c,gain) FITTED to our training set'] = M.baseline_octaves(
        ts, tu, c, a=tuned['a'], b=tuned['b'], c=tuned['c'], n=tuned['n'], gain=tuned['gain'])
    lut = bake_lut(net)
    p_lut = sample_lut(lut, ts, tu, c)
    k_net = '**NEURAL** (%d params), network evaluated directly' % ck['params']
    k_lut = '**NEURAL, as deployed** (32^3 half-float LUT, trilinear)'
    preds[k_net] = jss + p_main
    preds[k_lut] = jss + p_lut
    extra_info = {}
    if have('main_thick'):
        preds['NEURAL, thick-column prior variant (opts.prior = 1), direct'] = jss + predict_ms(*load_net('main_thick')[:2], feat)
    if have('main_noup'):
        preds['Ablation: NEURAL without tauUp (tauSun, cosTheta only)'] = jss + predict_ms(*load_net('main_noup')[:2], feat)
    if have('main4'):
        net4, fx4, ck4 = load_net('main4')
        p4 = predict_ms(net4, fx4, feat)
        B, A, bias4 = bake_factor4(net4)
        p4d = sample_factor4(B, A, bias4, ts, tu, c, td)
        preds['Stretch: NEURAL 4-feature (+tauDown, %d params), direct' % ck4['params']] = jss + p4
        preds['Stretch: NEURAL 4-feature, as deployed (2 textures)'] = jss + p4d
        extra_info['lut4_vs_mlp_rel_rms'] = float(np.sqrt(np.mean(((p4d - p4) / (jss + p4)) ** 2)))
    for nm, label in (('plain3', 'same 3 features'), ('x_mu0', '3 features + sun elevation mu0'),
                      ('x_sigma', '3 features + local extinction'), ('x_tauView', '3 features + tauView'),
                      ('x_tauDown', '3 features + tauDown'), ('x_tauDown_mu0', '3 features + tauDown + mu0'),
                      ('oracle8', 'all 8 recorded features')):
        if have(nm):
            preds['Oracle (not deployed): 9k-param MLP, %s' % label] = jss + predict_ms(*load_net(nm)[:2], feat)

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
    tv = tu + td
    subsets['thin column (tauUp+tauDown<2)'] = tv < 2
    subsets['medium column (2..16)'] = (tv >= 2) & (tv < 16)
    subsets['thick column (>=16)'] = tv >= 16
    for i, k in enumerate(KINDS):
        subsets['family: ' + k] = te['kind'] == i
    res = {name: {s: M.metrics(p, jss, ja, jb, ref, m, noise) for s, m in subsets.items()} for name, p in preds.items()}
    noise_rms = float(np.sqrt(np.mean(((ja - jb) / 2) ** 2 / ref ** 2)))
    zero_frac = float(np.mean((ja <= 0) | (jb <= 0)))
    ms_frac = float(np.mean((0.5 * (ja + jb)) / np.maximum(jss + 0.5 * (ja + jb), 1e-12)))
    lut_vs_mlp = float(np.sqrt(np.mean(((p_lut - p_main) / (jss + p_main)) ** 2)))
    lut_med = float(np.median(np.abs(p_lut - p_main) / (jss + p_main)))

    lines = []
    lines.append('TEST set: %d samples from %d unseen clouds, %d paths/sample.' % (len(ts), len(np.unique(te['cloud'])), int(te['paths'])))
    lines.append('MC noise of the reference: rel. RMS %.3f, median rel. std %.3f; %d low-noise samples (<10%%, both halves non-zero).' % (
        noise_rms, float(np.median(noise)), res[list(res.keys())[0]]['all']['n_lownoise']))
    lines.append('Mean multiple-scattering fraction of J: %.3f. LUT vs direct network: rel. RMS %.4f, median %.4f.' % (
        ms_frac, lut_vs_mlp, lut_med))
    lines.append('')
    lines.append('| model | display-rel. RMSE | rel. RMSE | energy-wtd RMSE | ln-RMSE (low-noise) | median abs rel. err (low-noise / all) | within 25 % (low-noise / all) | within x2 (low-noise / all) |')
    lines.append('|---|---|---|---|---|---|---|---|')
    for name, r in res.items():
        a = r['all']
        lines.append('| %s | %.3f | %.3f | %.3f | %.3f | %.3f / %.3f | %.1f %% / %.1f %% | %.1f %% / %.1f %% |' % (
            name, a['disp_rmse'], a['rel_rmse'], a['energy'], a['log_rmse'], a['med_abs'], a['med_abs_all'],
            100 * a['within25'], 100 * a['within25_all'], 100 * a['fac2'], 100 * a['fac2_all']))
    lines.append('')
    # the same headline metrics with the test population re-weighted toward optically thick columns
    pw = M.column_prior_weight(feat, 'thick').astype(np.float64)
    wres = {}
    lines.append('Population-weighted (thick-column prior, weight = clip(tauUp+tauDown, 1, 64)) noise-debiased errors:')
    lines.append('')
    lines.append('| model | display-rel. RMSE | rel. RMSE |')
    lines.append('|---|---|---|')
    for name, p in preds.items():
        num = (p - jss - ja) * (p - jss - jb)
        wres[name] = dict(disp_rmse=float(math.sqrt(max(np.mean(pw * num / (ref + M.J_FLOOR) ** 2), 0.0))),
                          rel_rmse=float(math.sqrt(max(np.mean(pw * num / ref ** 2), 0.0))))
        lines.append('| %s | %.3f | %.3f |' % (name, wres[name]['disp_rmse'], wres[name]['rel_rmse']))
    lines.append('')
    # brightness bias by column optical thickness: what a 3-feature model cannot know (REPORT.md, "The prior")
    yms = 0.5 * (ja + jb)
    bias_cols = [(k, lab) for k, lab in ((names_k, lab_k) for names_k, lab_k in (
        ('Octaves, (a,b,c,gain) FITTED to our training set', 'octaves fitted'), (k_lut, 'NEURAL (LUT)'),
        ('NEURAL, thick-column prior variant (opts.prior = 1), direct', 'NEURAL, thick prior'),
        ('Stretch: NEURAL 4-feature, as deployed (2 textures)', 'NEURAL-4'))) if k in preds]
    side_cam = (te['stype'] == 0) & (c < math.cos(math.radians(30)))
    lines.append('Brightness bias by column optical thickness tau_v = tauUp + tauDown (camera samples, theta > 30 deg): '
                 'sum of predicted J_ms / sum of path-traced J_ms.')
    lines.append('')
    lines.append('| tau_v | n | mean path-traced J_ms | ' + ' | '.join(lab for _, lab in bias_cols) + ' |')
    lines.append('|---|---|---|' + '---|' * len(bias_cols))
    bias_tab = []
    for lo, hi in ((0, 1), (1, 2), (2, 4), (4, 8), (8, 16), (16, 32), (32, 64), (64, 1e9)):
        m = side_cam & (tv >= lo) & (tv < hi)
        row = dict(lo=lo, hi=hi, n=int(m.sum()), mean=float(yms[m].mean()))
        for k, lab in bias_cols:
            row[lab] = float((preds[k][m] - jss[m]).sum() / yms[m].sum())
        bias_tab.append(row)
        lines.append('| %g - %s | %d | %.4f | ' % (lo, '%g' % hi if hi < 1e8 else 'inf', row['n'], row['mean'])
                     + ' | '.join('%.2f' % row[lab] for _, lab in bias_cols) + ' |')
    lines.append('')
    names = list(preds.keys())
    cols = [names[0], names[3], names[4], k_lut]
    short = ['single', 'octaves stock', 'octaves fitted', 'NEURAL (LUT)']
    for n in names:
        if 'thick-column prior' in n:
            cols.append(n)
            short.append('NEURAL, thick prior')
        elif n.startswith('Stretch') and 'deployed' in n:
            cols.append(n)
            short.append('NEURAL-4 (stretch)')
    for metric, title in (('disp_rmse', 'display-relative RMSE'), ('rel_rmse', 'relative RMSE'), ('fac2_all', 'fraction within a factor 2 (all samples)')):
        lines.append('Per-subset %s:' % title)
        lines.append('')
        lines.append('| subset | n | ' + ' | '.join(short) + ' |')
        lines.append('|---|---|' + '---|' * len(cols))
        for s in subsets:
            lines.append('| %s | %d | ' % (s, res[names[0]][s]['n']) + ' | '.join('%.3f' % res[n][s].get(metric, float('nan')) for n in cols) + ' |')
        lines.append('')
    txt = '\n'.join(lines)
    print(txt)
    with open('runs/eval.md', 'w') as f:
        f.write(txt + '\n')
    with open('runs/eval.json', 'w') as f:
        json.dump(dict(test_samples=int(len(ts)), test_clouds=int(len(np.unique(te['cloud']))),
                       paths_per_sample=int(te['paths']), mc_noise_rel_rms=noise_rms,
                       mc_noise_median=float(np.median(noise)), zero_half_fraction=zero_frac, ms_fraction=ms_frac,
                       lut_vs_mlp_rel_rms=lut_vs_mlp, lut_vs_mlp_median=lut_med, tuned_octaves=tuned,
                       key_net=k_net, key_lut=k_lut, results=res, thick_prior_results=wres, bias_by_column=bias_tab, **extra_info), f, indent=1)


if __name__ == '__main__':
    main()
