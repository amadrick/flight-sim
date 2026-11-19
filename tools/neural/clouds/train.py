"""Train / compare multiple-scattering models on the path-traced points (data/pts/*.npz).

    OMP_NUM_THREADS=2 $VENV tools/neural/clouds/train.py ablate             # feature-set study (exact optical depths)
    OMP_NUM_THREADS=2 $VENV tools/neural/clouds/train.py final --set D8tap  # deployed model -> data/model_final.pt/json
    OMP_NUM_THREADS=2 $VENV tools/neural/clouds/train.py compare            # tables vs shipped / classic / tuned analytic

Targets per point: J_ms (sun, all orders >= 2 minus the analytic forward-peak term), V_sky, V_gnd (all orders).
Loss: relative L2 with the denominator detached,  ((y_hat - y) / (y_hat + c))^2  weighted by the point's image
weight (opacity of its ray): unbiased under Monte Carlo noise in y (the minimiser is E[y]), insensitive to scale.
Split: by SCENE (gen.SCENES 'val' entries are never trained on, so the errors are for unseen clouds).
"""
import glob
import json
import math
import os
import sys
import time

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import baselines as BL  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
torch.set_num_threads(int(os.environ.get('OMP_NUM_THREADS', '2')))
C_FLOOR = np.array([0.01, 0.02, 0.02])          # relative-error floors (sr^-1 for J; per unit radiance for V)
LIGHT = dict(E=1.0, sky=0.06, gnd=0.025)       # noon-like weights for the combined source metric (game units / E_sun)


R1_VAL = ['broken3@2.5', 'cumulus3s0.075', 'deck250s0.02h0.1', 'les_congestus[-1]N150', 'near1@1.6', 'sphere600s0.06n0.15',
          'storm1s0.16', 'wisp2s0.012']   # round-one held-out scenes (cloud-ms-weights.js v1 meta.heldOut)


def load(pattern='*'):
    fs = sorted(glob.glob(os.path.join(DATA, 'pts', pattern + '.npz')))
    cols = {}
    for f in fs:
        z = np.load(f, allow_pickle=False)
        n = len(z['P'])
        rec = dict(P=z['P'], rd=z['rd'], L=np.repeat(z['L'][None], n, 0), opacity=z['opacity'], tau_cam=z['tau_cam'],
                   res=z['res'], mt=z['mt'], sig=z['sig'], ctop=z['ctop'], cbot=z['cbot'], jss=z['jss'], jfp=z['jfp'],
                   cos_t=z['cos_t'], elev=np.full(n, float(z['elev'])), sigma_ref=np.full(n, float(z['sigma_ref'])),
                   h=np.full(n, float(z['h'])), val=np.full(n, str(z['split']) == 'val'),
                   scene=np.full(n, str(z['scene'])), kind=np.full(n, str(z['kind'])),
                   cfg=np.full(n, os.path.basename(f)[:-4]), fpk=np.full(n, float(z['f'])))
        tf = f.replace('/pts/', '/tap2/')
        if os.path.exists(tf):
            zt = np.load(tf)
            for k in zt.files:
                if k.startswith('tap'):
                    rec[k] = zt[k]
            rec['has_base'] = np.full(n, bool(zt['has_base']))
        for k, v in rec.items():
            cols.setdefault(k, []).append(v)
    d = {k: np.concatenate(v) for k, v in cols.items()}
    d['mu_s'] = np.sin(np.radians(d['elev']))
    d['val_r1'] = d['val'] & np.isin(d['scene'], R1_VAL)            # the round-one held-out scenes (same points)
    d['val_multi'] = d['val'] & ~d['val_r1']                         # round-two held-out multi-cloud scenes
    return d


def enc_tau(t, scale=1.0):
    return np.log1p(np.maximum(t, 0) / scale)


def angle_feats(c):
    chord = np.sqrt(np.maximum(0, 2 - 2 * np.clip(c, -1, 1)))
    return [c, np.log1p(chord / 0.05) / math.log1p(2 / 0.05)]


DIR = dict(sun=0, up=1, down=2, cam=3, fwd=4, anti=5, sideA=6, sideB=7)


def feature_set(d, name):
    mt = d['mt']
    inf = lambda k: mt[:, DIR[k], -1]
    lim = lambda k, j: mt[:, DIR[k], j]
    ts = inf('sun')
    f = []
    if name == 'S3':        # the shipped inputs, but true optical depths
        f = [enc_tau(ts), enc_tau(inf('up'))] + angle_feats(d['cos_t'])
    elif name == 'S4':
        f = [enc_tau(ts), enc_tau(inf('up')), enc_tau(inf('down'))] + angle_feats(d['cos_t'])
    elif name == 'S5':
        f = [enc_tau(ts), enc_tau(inf('up')), enc_tau(inf('down')), d['mu_s']] + angle_feats(d['cos_t'])
    elif name == 'S6cam':
        f = [enc_tau(ts), enc_tau(inf('up')), enc_tau(inf('down')), d['mu_s'], enc_tau(np.minimum(d['tau_cam'], 60))] + angle_feats(d['cos_t'])
    elif name == 'S6fwd':
        f = [enc_tau(ts), enc_tau(inf('up')), enc_tau(inf('down')), d['mu_s'], enc_tau(inf('fwd'))] + angle_feats(d['cos_t'])
    elif name == 'S7':
        f = [enc_tau(ts), enc_tau(inf('up')), enc_tau(inf('down')), d['mu_s'], enc_tau(inf('fwd')),
             enc_tau(np.minimum(d['tau_cam'], 60))] + angle_feats(d['cos_t'])
    elif name == 'S9':
        f = [enc_tau(ts), enc_tau(inf('up')), enc_tau(inf('down')), d['mu_s'], enc_tau(inf('fwd')),
             enc_tau(np.minimum(d['tau_cam'], 60)), enc_tau(inf('anti')),
             enc_tau(inf('sideA') + inf('sideB'))] + angle_feats(d['cos_t'])
    elif name == 'S7lim':   # range-limited (1 km) optical depths: what a few taps can reach
        f = [enc_tau(lim('sun', 3) + 0 * ts), enc_tau(ts), enc_tau(lim('up', 3)), enc_tau(lim('down', 3)), d['mu_s'],
             enc_tau(lim('fwd', 3)), enc_tau(np.minimum(d['tau_cam'], 60))] + angle_feats(d['cos_t'])
    elif name == 'S7near':  # + near-field (120 m) optical depths in the six directions
        f = [enc_tau(ts), enc_tau(inf('up')), enc_tau(inf('down')), d['mu_s'], enc_tau(inf('fwd')),
             enc_tau(np.minimum(d['tau_cam'], 60))] + angle_feats(d['cos_t'])
        f += [enc_tau(lim(k, 1)) for k in ('up', 'down', 'fwd', 'anti', 'sideA', 'sideB')]
    elif name == 'ALL':     # oracle: every multi-scale optical depth
        f = [enc_tau(mt[:, i, j]) for i in range(8) for j in range(5)]
        f += [d['mu_s'], enc_tau(np.minimum(d['tau_cam'], 60)), enc_tau(d['sig'] * 30)] + angle_feats(d['cos_t'])
    elif name[:2] in ('T:', 'B:'):    # tap descriptor T|B:<ends>:<dir,dir,...>[:sum]  (gen_tap.py)
        # T: taps of the true field (descriptor v1), B: taps of the cheap base density the shader samples (v2)
        _, ends, dirs = name.split(':')[:3]
        t = d[('tapb_' if name[0] == 'B' else 'tap_') + ends]
        f = [enc_tau(ts), d['mu_s'], enc_tau(np.minimum(d['tau_cam'], 60))] + angle_feats(d['cos_t'])
        for k in dirs.split(','):
            if name.endswith(':sum'):
                f.append(enc_tau(t[:, DIR[k], :].sum(1)))
            else:
                f += [enc_tau(t[:, DIR[k], j]) for j in range(t.shape[2])]
    else:
        raise ValueError(name)
    return np.stack(f, 1).astype(np.float32)


NA, NB = 384, 128      # walks per point in gen.py (diffuse / peak strata)


def targets(d):
    """Targets and the variance of their Monte Carlo estimate. pt.estimate stores the second moment sum (w x)^2;
    the variance of the stratified mean subtracts each stratum's squared mean / n (exact for the sun term, whose
    stratum means are stored; for sky / ground the strata are assumed to have equal means)."""
    r = d['res']
    f = d['fpk']
    Y = np.stack([r[:, 1], r[:, 4], r[:, 7]], 1)
    q = np.stack([r[:, 9], r[:, 10], r[:, 11]], 1)
    k = (1 - f) ** 2 / NA + f ** 2 / NB
    vs = q[:, 0] - ((1 - f) * r[:, 12]) ** 2 / NA - (f * r[:, 13]) ** 2 / NB
    V = np.stack([vs, q[:, 1] - Y[:, 1] ** 2 * k, q[:, 2] - Y[:, 2] ** 2 * k], 1)
    return Y, np.maximum(V, 0)


class Net(torch.nn.Module):
    def __init__(self, nin, width=16, depth=2, nout=3):
        super().__init__()
        sizes = [nin] + [width] * depth
        self.hidden = torch.nn.ModuleList([torch.nn.Linear(a, b) for a, b in zip(sizes[:-1], sizes[1:])])
        self.out = torch.nn.Linear(sizes[-1], nout)
        self.register_buffer('mu', torch.zeros(nin))
        self.register_buffer('sd', torch.ones(nin))

    def forward(self, x):
        x = (x - self.mu) / self.sd
        for l in self.hidden:
            z = l(x)
            x = z * torch.rsqrt(1 + z * z)          # ISRU: cheap in GLSL (inversesqrt)
        return self.out(x)


def rel_loss(o, y, w, floor):
    yh = torch.exp(o)
    den = yh.detach() + floor
    return ((((yh - y) / den) ** 2).mean(1) * w).sum() / w.sum()


def fit(X, Y, W, Xv=None, Yv=None, Wv=None, width=16, depth=2, steps=6000, lr=3e-3, seed=0, log=False, init_bias=None):
    torch.manual_seed(seed)
    net = Net(X.shape[1], width, depth, Y.shape[1])
    Xt, Yt, Wt = torch.tensor(X), torch.tensor(Y, dtype=torch.float32), torch.tensor(W, dtype=torch.float32)
    net.mu.copy_(Xt.mean(0)); net.sd.copy_(Xt.std(0) + 1e-6)
    with torch.no_grad():
        net.out.bias.copy_(torch.log(torch.tensor((Y * W[:, None]).sum(0) / W.sum() + 1e-4, dtype=torch.float32)))
    fl = torch.tensor(C_FLOOR[:Y.shape[1]], dtype=torch.float32)
    opt = torch.optim.Adam(net.parameters(), lr=lr)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=steps, pct_start=0.1)
    n = len(X)
    bs = min(8192, n)
    g = torch.Generator().manual_seed(seed)
    best = (1e9, None)
    for it in range(steps):
        idx = torch.randint(0, n, (bs,), generator=g)
        loss = rel_loss(net(Xt[idx]), Yt[idx], Wt[idx], fl)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        if log and (it % 1000 == 0 or it == steps - 1) and Xv is not None:
            with torch.no_grad():
                lv = rel_loss(net(torch.tensor(Xv)), torch.tensor(Yv, dtype=torch.float32), torch.tensor(Wv, dtype=torch.float32), fl)
            print(f'   step {it:5d} train {loss.item():.4f} val {lv.item():.4f}', flush=True)
    return net


def predict(net, X):
    with torch.no_grad():
        return torch.exp(net(torch.tensor(X))).numpy().astype(np.float64)


# ------------------------------------------------------------------------------------- metrics
def drel(pred, true, var, w, floor):
    """Image-weighted relative RMSE with the Monte Carlo noise of the reference removed, and the weighted bias."""
    den = (true + floor) ** 2
    e2 = ((pred - true) ** 2 - var) / den
    rmse = math.sqrt(max((w * e2).sum() / w.sum(), 0.0))
    bias = (w * pred).sum() / (w * true).sum()
    return rmse, bias


def report(name, d, mask, jtot_pred, vs_pred, vg_pred):
    Y, V = targets(d)
    w = d['opacity'][mask]
    jtrue = (d['jss'] + d['jfp'] + Y[:, 0])[mask]
    out = {}
    out['J'] = drel(jtot_pred[mask], jtrue, V[mask, 0], w, 0.05)
    out['Vsky'] = drel(vs_pred[mask], Y[mask, 1], V[mask, 1], w, 0.05)
    out['Vgnd'] = drel(vg_pred[mask], Y[mask, 2], V[mask, 2], w, 0.05)
    S_true = LIGHT['E'] * jtrue + LIGHT['sky'] * Y[mask, 1] + LIGHT['gnd'] * Y[mask, 2]
    S_pred = LIGHT['E'] * jtot_pred[mask] + LIGHT['sky'] * vs_pred[mask] + LIGHT['gnd'] * vg_pred[mask]
    S_var = V[mask, 0] + LIGHT['sky'] ** 2 * V[mask, 1] + LIGHT['gnd'] ** 2 * V[mask, 2]
    out['S'] = drel(S_pred, S_true, S_var, w, 0.02)
    # log-ratio statistics of the combined source (robust)
    lr = np.log(np.maximum(S_pred, 1e-6) / np.maximum(S_true, 1e-6))
    out['S_within_x1.25'] = float((w * (np.abs(lr) < math.log(1.25))).sum() / w.sum())
    return out


def fmt(o):
    return (f"J {o['J'][0]:.3f} (bias {o['J'][1]:.2f}) | Vsky {o['Vsky'][0]:.3f} ({o['Vsky'][1]:.2f}) | "
            f"Vgnd {o['Vgnd'][0]:.3f} ({o['Vgnd'][1]:.2f}) | S {o['S'][0]:.3f} ({o['S'][1]:.2f}) within1.25 {o['S_within_x1.25']:.2f}")


def shipped_preds(d, calibrated=True):
    tu, td = BL.height_proxies(d['sig'], d['sigma_ref'], d['ctop'], d['cbot'], d['P'][:, 1], None)
    return BL.shipped(d['mt'][:, 0, -1], tu, td, d['cos_t'], d['mu_s'], calibrated)


def classic_preds(d):
    tu, td = BL.height_proxies(d['sig'], d['sigma_ref'], d['ctop'], d['cbot'], d['P'][:, 1], None)
    return BL.classic(d['mt'][:, 0, -1], tu, td, d['cos_t'])


# ------------------------------------------------------------------------------------- tuned analytic baseline
class Analytic(torch.nn.Module):
    """Best-effort physically based closed form with TRUE optical depths, parameters fitted to the same data:
    J_ms = sum_k b^k HG(cos, g c^k) exp(-a^k tauSun) * (1 - q exp(-r (tauUp + tauDown + tauSun)))     (octaves x powder)
    V_sky = s1 * twoStream(tauUp, tauDown), V_gnd = s2 * twoStream(tauDown, tauUp)  (diffusion slab, Milne 0.71 l*)."""

    def __init__(self):
        super().__init__()
        self.p = torch.nn.Parameter(torch.tensor([math.log(0.5 / 0.5), 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]))

    def forward(self, ts, tu, td, c):
        a = torch.sigmoid(self.p[0]) * 0.9 + 0.05
        b = torch.sigmoid(self.p[1]) * 0.95 + 0.02
        cc = torch.sigmoid(self.p[2])
        g = 0.75 * torch.sigmoid(self.p[3]) + 0.2
        q = torch.sigmoid(self.p[4])
        r = torch.exp(self.p[5])
        s1 = torch.exp(self.p[6]); s2 = torch.exp(self.p[7])
        J = 0.0
        ak, bk, ck = 1.0, 1.0, 1.0
        for k in range(8):
            ak = ak * a; bk = bk * b; ck = ck * cc
            gg = g * ck
            hg = (1 - gg * gg) / (4 * math.pi) / (1 + gg * gg - 2 * gg * c) ** 1.5
            J = J + bk * hg * torch.exp(-ak * ts)
        J = J * (1 - q * torch.exp(-r * (tu + td + ts)))
        G = 0.864
        two = lambda u, d_: (d_ * (1 - G) + 0.71) / ((u + d_) * (1 - G) + 1.42)
        return torch.stack([J, s1 * two(tu, td), s2 * two(td, tu)], 1)


def fit_analytic(d, mask, steps=3000):
    Y, _ = targets(d)
    m = Analytic()
    T = lambda a: torch.tensor(a[mask], dtype=torch.float64)
    ts, tu, td, c = T(d['mt'][:, 0, -1]), T(d['mt'][:, 1, -1]), T(d['mt'][:, 2, -1]), T(d['cos_t'])
    y = torch.tensor(Y[mask]); w = torch.tensor(d['opacity'][mask])
    m.double()
    opt = torch.optim.Adam(m.parameters(), lr=0.03)
    fl = torch.tensor(C_FLOOR)
    for it in range(steps):
        o = m(ts, tu, td, c)
        loss = ((((o - y) / (o.detach() + fl)) ** 2).mean(1) * w).sum() / w.sum()
        opt.zero_grad(); loss.backward(); opt.step()
    return m


def analytic_preds(m, d):
    with torch.no_grad():
        T = lambda a: torch.tensor(a, dtype=torch.float64)
        return m(T(d['mt'][:, 0, -1]), T(d['mt'][:, 1, -1]), T(d['mt'][:, 2, -1]), T(d['cos_t'])).numpy()


# ------------------------------------------------------------------------------------- commands
def ablate(d, sets, widths=(16,), steps=5000):
    """Each set trained on the training scenes; reported on the round-one held-out scenes (VAL1), the round-two
    held-out multi-cloud scenes (VALM) and, for a T: set, also fed the shader's base-density taps (the run-time gap)."""
    Y, V = targets(d)
    tr = ~d['val']
    W = d['opacity']
    res = {}
    for s in sets:
        X = feature_set(d, s)
        Xb = feature_set(d, 'B' + s[1:]) if s.startswith('T:') else None
        for wd in widths:
            t0 = time.time()
            net = fit(X[tr], Y[tr], W[tr], width=wd, steps=steps)
            r = dict(nin=X.shape[1], params=sum(p.numel() for p in net.parameters()))
            for tag, XX in (('', X), ('fed base taps ', Xb)):
                if XX is None:
                    continue
                pr = predict(net, XX)
                jt = d['jss'] + d['jfp'] + pr[:, 0]
                for mk, m in (('VAL1', d['val_r1']), ('VALM', d['val_multi']), ('TRAIN', tr)):
                    if tag and mk == 'TRAIN':
                        continue
                    o = report(s, d, m, jt, pr[:, 1], pr[:, 2])
                    r[tag + mk] = o
                    print(f'{s:22s} w{wd:<3d} nin {X.shape[1]:2d} [{time.time() - t0:4.0f}s] {tag}{mk:5s} {fmt(o)}', flush=True)
            res[f'{s}/w{wd}'] = r
    return res


def baselines_table(d, masks):
    rows = {}
    sj, ss, sg = shipped_preds(d, True)
    rj, rs, rg = shipped_preds(d, False)
    cj, cs, cg = classic_preds(d)
    tr = ~d['val']
    am = fit_analytic(d, tr)
    a = analytic_preds(am, d)
    aj = d['jss'] + d['jfp'] + a[:, 0]
    for mname, m in masks.items():
        rows[mname] = {
            'shipped (round 3, calibrated)': report('', d, m, sj, ss, sg),
            'shipped (round 3, raw nets)': report('', d, m, rj, rs, rg),
            'classic analytic': report('', d, m, cj, cs, cg),
            'tuned analytic, true taus': report('', d, m, aj, a[:, 1], a[:, 2]),
        }
    return rows, am


def export_final(net, setname, d, rows):
    """Fold the input normalisation into layer 0, write data/model_final.json, src/neural/cloud-ms-weights.js and the
    JS test vectors (src/neural/test-vectors-ms.json)."""
    import base64
    _, ends_key, dirs = setname.split(':')[:3]
    import gen_tap
    desc = dict(dirs=dirs.split(','), ends=[float(v) for v in gen_tap.ENDS[ends_key]], tauCamMax=60.0, chordT0=0.05)
    tkey = ('tapb_' if setname[0] == 'B' else 'tap_') + ends_key
    if setname[0] == 'B':
        # descriptor v2: the taps sample the cheap base density (shaders.js clMsSigma), not the full field
        desc = dict(version=2, tapSource='base', tapGain=float(np.unique(d['tap_gain'])[0]) if 'tap_gain' in d else 0.8, **desc)
    else:
        desc = dict(version=1, tapSource='full', **desc)
    mu, sd = net.mu.numpy().astype(np.float64), net.sd.numpy().astype(np.float64)
    layers = []
    for i, l in enumerate(list(net.hidden) + [net.out]):
        W = l.weight.detach().numpy().astype(np.float64); b = l.bias.detach().numpy().astype(np.float64)
        if i == 0:
            W = W / sd[None]
            b = b - W @ mu
        layers.append((W.astype(np.float32), b.astype(np.float32)))
    flat = np.concatenate([np.concatenate([W.ravel(), b]) for W, b in layers]).astype(np.float32)
    sizes = [layers[0][0].shape[1]] + [W.shape[0] for W, _ in layers]
    meta = dict(trainedOn='tools/neural/clouds: path-traced points (Mie phase, delta-M, sun + sky + ground) on '
                          'game fields, LES cumulus and synthetic shapes', points=int((~d['val']).sum()),
                configs=int(len(np.unique(d['cfg'][~d['val']]))), heldOut=sorted(set(d['scene'][d['val']].tolist())),
                validation=rows, set=setname)
    js_model = dict(desc=desc, sizes=sizes, b64=base64.b64encode(flat.tobytes()).decode(), meta=meta)
    root = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
    open(os.path.join(root, 'src', 'neural', 'cloud-ms-weights.js'), 'w').write(
        '// Generated by tools/neural/clouds/train.py final: learned cloud multiple scattering (src/neural/cloud-ms.js).\n'
        '// Do not edit; see docs/clouds/NEURAL.md.\nexport const CLOUD_MS_MODEL = ' + json.dumps(js_model, indent=1) + ';\n')
    L64 = [(W.astype(np.float64), b.astype(np.float64)) for W, b in layers]
    json.dump(dict(desc=desc, layers=[dict(W=W.tolist(), b=b.tolist()) for W, b in L64], sizes=sizes),
              open(os.path.join(DATA, 'model_final.json'), 'w'))
    # test vectors from held-out points
    import model as MD
    rng = np.random.default_rng(3)
    idx = rng.choice(np.nonzero(d['val'])[0], 48, replace=False)
    t = d[tkey][idx][:, [DIR[k] for k in desc['dirs']], :]
    X = MD.encode(d['mt'][idx, 0, -1], d['tau_cam'][idx], d['mu_s'][idx], d['cos_t'][idx], t, desc)
    Y = MD.forward(L64, X)
    vec = dict(tauSun=d['mt'][idx, 0, -1].tolist(), tauCam=d['tau_cam'][idx].tolist(), muSun=d['mu_s'][idx].tolist(),
               cosTheta=d['cos_t'][idx].tolist(), taps={k: t[:, i, :].tolist() for i, k in enumerate(desc['dirs'])},
               out=Y.tolist(), ref=[[float(d['res'][i, 1]), float(d['res'][i, 4]), float(d['res'][i, 7])] for i in idx])
    json.dump(vec, open(os.path.join(root, 'src', 'neural', 'test-vectors-ms.json'), 'w'))
    print('exported', sizes, len(flat), 'floats')


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'ablate'
    d = load()
    print(f'{len(d["P"])} points, {len(np.unique(d["cfg"]))} configs, val points {d["val"].sum()}', flush=True)
    if cmd == 'ablate':
        sets = sys.argv[2].split(';') if len(sys.argv) > 2 else ['S3', 'S4', 'S5', 'S6cam', 'S6fwd', 'S7', 'S9', 'S7lim', 'S7near', 'ALL']
        rows, _ = baselines_table(d, {'VAL1': d['val_r1'], 'VALM': d['val_multi']}) if os.environ.get('BASELINES', '1') == '1' else ({}, None)
        for mk, rr in rows.items():
            for k, v in rr.items():
                print(f'{k:32s} {mk} {fmt(v)}', flush=True)
        res = ablate(d, sets, widths=tuple(int(v) for v in os.environ.get('WIDTHS', '16').split(',')))
        json.dump(dict(baselines=rows, ablation=res), open(os.path.join(DATA, os.environ.get('ABL_OUT', 'ablation') + '.json'), 'w'), indent=1)
    elif cmd == 'final':
        setname = sys.argv[2]
        width = int(sys.argv[3]) if len(sys.argv) > 3 else 16
        steps = int(sys.argv[4]) if len(sys.argv) > 4 else 20000
        Y, V = targets(d)
        tr, va = ~d['val'], d['val']
        X = feature_set(d, setname)
        best = None
        for seed in range(int(os.environ.get('SEEDS', '3'))):
            net = fit(X[tr], Y[tr], d['opacity'][tr], X[va], Y[va], d['opacity'][va], width=width, steps=steps, seed=seed, log=True)
            pr = predict(net, X)
            o = report('', d, va, d['jss'] + d['jfp'] + pr[:, 0], pr[:, 1], pr[:, 2])
            print('seed', seed, 'VAL', fmt(o), flush=True)
            # select on the TRAIN loss (the held-out scenes stay untouched by model selection)
            ot = report('', d, tr, d['jss'] + d['jfp'] + pr[:, 0], pr[:, 1], pr[:, 2])
            if best is None or ot['S'][0] < best[0]:
                best = (ot['S'][0], net, o)
        net = best[1]
        torch.save(net.state_dict(), os.path.join(DATA, 'model_final.pt'))
        pr = predict(net, X)
        masks = {'val': va, 'VAL1 (round-one held-out)': d['val_r1'], 'VALM (round-two multi-cloud held-out)': d['val_multi'], 'train': tr}
        for kd in np.unique(d['kind']):
            masks[f'val/{kd}'] = va & (d['kind'] == kd)
        for lo, hi in ((0, 10), (10, 30), (30, 90)):
            masks[f'val/elev{lo}-{hi}'] = va & (d['elev'] >= lo) & (d['elev'] < hi)
        masks['val/backlit(cos>0.7)'] = va & (d['cos_t'] > 0.7)
        masks['val/frontlit(cos<-0.3)'] = va & (d['cos_t'] < -0.3)
        masks = {k: v for k, v in masks.items() if v.sum() > 50}
        rows, am = baselines_table(d, masks)
        for k, m in masks.items():
            rows[k]['NEW: ' + setname] = report('', d, m, d['jss'] + d['jfp'] + pr[:, 0], pr[:, 1], pr[:, 2])
        for k in masks:
            print(f'--- {k} ({masks[k].sum()} points)')
            for name, o in rows[k].items():
                print(f'  {name:34s} {fmt(o)}')
        json.dump(dict(rows=rows, analytic_params=am.p.detach().tolist()), open(os.path.join(DATA, 'final_eval.json'), 'w'), indent=1)
        export_final(net, setname, d, {k: {n: {m: list(v) if isinstance(v, tuple) else v for m, v in o.items()} for n, o in r.items()} for k, r in rows.items()})


if __name__ == '__main__':
    main()
