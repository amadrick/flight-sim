"""Train the neural fireball on the simulation runs, evaluate on held-out runs, export weights + test vectors.

    python train.py sample              # data/run*.npz -> data/samples.npz (train / test split by run)
    python train.py fit [--epochs 60]   # -> data/model.pt
    python train.py eval                # held-out metrics -> results/eval.json, results/eval.md, side-by-side PNGs
    python train.py export              # -> src/neural/fireball-weights.js, src/neural/fireball-test-vectors.json

Network (JS twin: src/neural/fireball.js): features(x, |y|, z, t, Fw, Ui) -> 64 -> 64 -> 64 -> 3, tanh,
targets log1p(soot / 1e-3), log1p(theta), log1p(burn / 1e-2).
"""
import sys, os, json, glob, time, base64, math
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
DATA = os.path.join(HERE, 'data')
RES = os.path.join(HERE, 'results')
sys.path.insert(0, HERE)
import sim  # noqa: E402

TEST_RUNS = [4, 10, 18, 27, 33, 41]
S_REF, R_REF = 1e-3, 1e-2
ENC = dict(xc=2.8, xs=5.2, ys=2.6, zs=3.6, t0=0.25, tMax=20.0, nFreq=3, nFreqT=2, fwS=0.6, uiS=1.25, sootK=1.0, burnK=1.0)
HIDDEN = [64, 64, 64]


def features_np(x, y, z, t, fw, ui, e=ENC):
    xn = (x - e['xc']) / e['xs']; yn = np.abs(y) / e['ys'] * 2 - 1; zn = z / e['zs'] - 1
    tau = np.log1p(np.maximum(t, 0) / e['t0']) / np.log1p(e['tMax'] / e['t0'])
    tn = 2 * np.minimum(tau, 1) - 1
    cols = [xn, yn, zn]
    for f in range(1, e['nFreq'] + 1):
        w = np.pi * f
        cols += [np.sin(w * xn), np.cos(w * xn), np.sin(w * yn), np.cos(w * yn), np.sin(w * zn), np.cos(w * zn)]
    cols.append(tn)
    for f in range(1, e['nFreqT'] + 1):
        cols += [np.sin(np.pi * f * tn), np.cos(np.pi * f * tn)]
    cols += [fw / e['fwS'] - 1 + 0 * xn, ui / e['uiS'] - 1 + 0 * xn]
    return np.stack(cols, -1).astype(np.float32)


def targets_np(S, T, R):
    return np.stack([np.log1p(np.maximum(S, 0) / S_REF), np.log1p(np.maximum(T, 0)), np.log1p(np.maximum(R, 0) / R_REF)], -1).astype(np.float32)


def runs():
    return sorted(glob.glob(os.path.join(DATA, 'run*.npz')))


def run_index(fn):
    return int(os.path.basename(fn)[3:6])


# ------------------------------------------------------------------------------------------------- sampling
def sample(n_per=7000, seed=0):
    rng = np.random.default_rng(seed)
    x, y, z = sim.grid()
    X, Y, Z = np.meshgrid(x, y, z, indexing='ij')
    out = {'train': [], 'test': []}
    for fn in runs():
        d = np.load(fn); sn = d['snaps'].astype(np.float32); ts = d['t']; fw = float(d['fw']); ui = float(d['ui'])
        split = 'test' if run_index(fn) in TEST_RUNS else 'train'
        for it, t in enumerate(ts):
            S, T, R = sn[it]
            act = (S / S_REF > 0.02) | (T > 0.02) | (R / R_REF > 0.05)
            # importance: active cells (dilated by the eddy-scale) + a uniform share of empty space
            ia = np.flatnonzero(act.ravel())
            nu = n_per // 3
            idx_u = rng.integers(0, S.size, nu)
            idx_a = ia[rng.integers(0, len(ia), n_per - nu)] if len(ia) else rng.integers(0, S.size, n_per - nu)
            idx = np.concatenate([idx_u, idx_a])
            # jitter within the cell (trilinear interpolation of the target)
            px = X.ravel()[idx] + rng.uniform(-0.5, 0.5, len(idx)) * sim.DX
            py = np.abs(Y.ravel()[idx] + rng.uniform(-0.5, 0.5, len(idx)) * sim.DX)
            pz = np.maximum(Z.ravel()[idx] + rng.uniform(-0.5, 0.5, len(idx)) * sim.DX, 0.0)
            vals = trilinear(sn[it], px, py, pz)
            w = np.where(np.arange(len(idx)) < nu, S.size / nu, max(len(ia), 1) / (n_per - nu))
            # weight: proportional to the volume each sample represents, tempered (empty space matters less)
            w = np.sqrt(w / w.mean())
            out[split].append(np.concatenate([np.stack([px, py, pz, np.full_like(px, t), np.full_like(px, fw), np.full_like(px, ui)], -1),
                                              vals.T, w[:, None]], -1).astype(np.float32))
        print(fn, split, flush=True)
    cat = lambda L: np.concatenate(L) if L else np.zeros((0, 10), np.float32)
    np.savez(os.path.join(DATA, 'samples.npz'), train=cat(out['train']), test=cat(out['test']))


def trilinear(sn, px, py, pz):
    """sn: (3, NX, NY, NZ). Positions in domain units; y mirrored, x/z clamped."""
    fx = (px - sim.X0) / sim.DX - 0.5; fy = py / sim.DX - 0.5; fz = pz / sim.DX - 0.5
    fx = np.clip(fx, 0, sim.NX - 1.001); fz = np.clip(fz, 0, sim.NZ - 1.001)
    fy = np.clip(fy, -0.5, sim.NY - 1.001)
    i0 = np.floor(fx).astype(int); j0 = np.floor(fy).astype(int); k0 = np.floor(fz).astype(int)
    tx = fx - i0; ty = fy - j0; tz = fz - k0
    out = np.zeros((3, len(px)), np.float32)
    for dj in (0, 1):
        j = j0 + dj; j = np.where(j < 0, -j - 1, j); j = np.minimum(j, sim.NY - 1)
        wy = ty if dj else 1 - ty
        for di in (0, 1):
            wx = tx if di else 1 - tx
            for dk in (0, 1):
                wz = tz if dk else 1 - tz
                out += sn[:, i0 + di, j, k0 + dk] * (wx * wy * wz)
    return out


# ------------------------------------------------------------------------------------------------- model
def make_model():
    import torch
    nin = features_np(np.zeros(1), np.zeros(1), np.zeros(1), np.zeros(1), 0.0, 0.0).shape[1]
    layers = []; prev = nin
    for h in HIDDEN:
        layers += [torch.nn.Linear(prev, h), torch.nn.Tanh()]; prev = h
    layers.append(torch.nn.Linear(prev, 3))
    return torch.nn.Sequential(*layers), nin


def fit(epochs=60, bs=8192, lr=3e-3):
    import torch
    torch.set_num_threads(2); torch.manual_seed(0)
    d = np.load(os.path.join(DATA, 'samples.npz'))
    tr, te = d['train'], d['test']
    if len(te) == 0: te = tr[::20]
    def prep(a):
        X = features_np(a[:, 0], a[:, 1], a[:, 2], a[:, 3], a[:, 4], a[:, 5])
        Y = targets_np(a[:, 6], a[:, 7], a[:, 8])
        return torch.from_numpy(X), torch.from_numpy(Y), torch.from_numpy(a[:, 9].copy())
    Xtr, Ytr, Wtr = prep(tr); Xte, Yte, Wte = prep(te)
    model, nin = make_model()
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    steps = epochs * (len(Xtr) // bs)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=steps, pct_start=0.1)
    cw = torch.tensor([1.0, 1.0, 0.6])
    t0 = time.time()
    log = []
    for ep in range(epochs):
        perm = torch.randperm(len(Xtr))
        tot = 0.0
        model.train()
        for b in range(len(Xtr) // bs):
            ii = perm[b * bs:(b + 1) * bs]
            pred = model(Xtr[ii])
            loss = ((pred - Ytr[ii]) ** 2 * cw * Wtr[ii, None]).mean()
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
            tot += loss.item()
        model.eval()
        with torch.no_grad():
            pe = torch.cat([model(Xte[i:i + 65536]) for i in range(0, len(Xte), 65536)])
            vl = (((pe - Yte) ** 2 * cw * Wte[:, None]).mean()).item()
            per = (((pe - Yte) ** 2 * Wte[:, None]).mean(0) ** 0.5).tolist()
        log.append(dict(epoch=ep, train=tot / (len(Xtr) // bs), test=vl, rmse_fields=per))
        print(f'epoch {ep:3d} train {tot / (len(Xtr) // bs):.5f} test {vl:.5f} rmse(soot,T,burn) {per[0]:.4f} {per[1]:.4f} {per[2]:.4f}  {time.time() - t0:.0f}s', flush=True)
    torch.save({'state': model.state_dict(), 'nin': nin, 'log': log}, os.path.join(DATA, 'model.pt'))


def load_np_model():
    """Return a numpy forward function and the flat layer list."""
    import torch
    ck = torch.load(os.path.join(DATA, 'model.pt'), weights_only=False)
    model, nin = make_model(); model.load_state_dict(ck['state'])
    Ls = [(m.weight.detach().numpy().astype(np.float64), m.bias.detach().numpy().astype(np.float64)) for m in model if hasattr(m, 'weight')]
    def fwd(X):
        h = X.astype(np.float64)
        for i, (W, b) in enumerate(Ls):
            h = h @ W.T + b
            if i < len(Ls) - 1: h = np.tanh(h)
        return h
    return fwd, Ls, ck


def predict_grid(fwd, t, fw, ui, shape=None):
    x, y, z = sim.grid()
    X, Y, Z = np.meshgrid(x, y, z, indexing='ij')
    F = features_np(X.ravel(), Y.ravel(), Z.ravel(), np.full(X.size, t), fw, ui)
    o = np.concatenate([fwd(F[i:i + 200000]) for i in range(0, len(F), 200000)])
    S = np.expm1(o[:, 0]).clip(0) * S_REF; T = np.expm1(o[:, 1]).clip(0); R = np.expm1(o[:, 2]).clip(0) * R_REF
    return np.stack([S.reshape(X.shape), T.reshape(X.shape), R.reshape(X.shape)])


# ------------------------------------------------------------------------------------------------- evaluation
def moments(S, T):
    x, y, z = sim.grid()
    X, Y, Z = np.meshgrid(x, y, z, indexing='ij')
    m = S.sum() + 1e-12
    zc = (S * Z).sum() / m; xc = (S * X).sum() / m
    hot = (T > 0.5).sum() * 2 * sim.DX ** 3
    col = S.max(axis=(0, 1))
    ztop = z[np.flatnonzero(col > 0.15 * col.max()).max()] if col.max() > 0 else 0
    return dict(mass=float(m * 2 * sim.DX ** 3), zc=float(zc), xc=float(xc), hot=float(hot), ztop=float(ztop), Tmax=float(T.max()))


def evaluate():
    from viz import render_side, tone, write_png
    fwd, Ls, ck = load_np_model()
    os.makedirs(RES, exist_ok=True)
    rows = []; agg = {k: [] for k in ['soot', 'theta', 'burn']}
    tl = {k: [] for k in ['soot', 'theta', 'burn']}
    base = {k: [] for k in ['soot', 'theta']}
    mom = []
    # baseline: a spherical gaussian thermal following the run-average soot centroid (what "noise blobs" would give)
    for fn in runs():
        if run_index(fn) not in TEST_RUNS: continue
        d = np.load(fn); sn = d['snaps'].astype(np.float32); ts = d['t']; fw = float(d['fw']); ui = float(d['ui'])
        frames = []
        for it, t in enumerate(ts):
            ref = sn[it]; pr = predict_grid(fwd, t, fw, ui)
            for c, k in enumerate(['soot', 'theta', 'burn']):
                num = np.sqrt(((pr[c] - ref[c]) ** 2).sum()); den = np.sqrt((ref[c] ** 2).sum()) + 1e-12
                agg[k].append(num / den)
                sc = S_REF if c == 0 else (1 if c == 1 else R_REF)
                tl[k].append(np.sqrt(((np.log1p(pr[c] / sc) - np.log1p(ref[c] / sc)) ** 2).mean()))
            # baseline blob: same total soot / heat, gaussian at the true centroid with the true second moment
            for c, k in enumerate(['soot', 'theta']):
                blob = gaussian_like(ref[c])
                base[k].append(np.sqrt(((blob - ref[c]) ** 2).sum()) / (np.sqrt((ref[c] ** 2).sum()) + 1e-12))
            ms, mp = moments(ref[0], ref[1]), moments(pr[0], pr[1])
            mom.append(dict(run=run_index(fn), t=float(t), sim=ms, net=mp))
            if it in (2, 6, 10, 13, 16, 19, 22, 25):
                a = tone(render_side(ref[0], ref[1]) * 1.5); b = tone(render_side(pr[0], pr[1]) * 1.5)
                frames.append(np.concatenate([a[-56:], np.ones((1, a.shape[1], 3)), b[-56:]], 0))
        img = np.concatenate([np.concatenate([f, np.ones((f.shape[0], 2, 3))], 1) for f in frames], 1)
        img = np.repeat(np.repeat(img, 2, 0), 2, 1)
        write_png(os.path.join(RES, f'side_run{run_index(fn):03d}.png'), img)
        rows.append(dict(run=run_index(fn), fw=fw, ui=ui))
        print('eval', fn, flush=True)
    res = dict(test_runs=rows,
               rel_l2={k: float(np.mean(v)) for k, v in agg.items()},
               rel_l2_by_time={k: [float(x) for x in np.mean(np.array(v).reshape(len(rows), -1), 0)] for k, v in agg.items()},
               log_rmse={k: float(np.mean(v)) for k, v in tl.items()},
               baseline_gaussian_rel_l2={k: float(np.mean(v)) for k, v in base.items()},
               times=[float(x) for x in sim.SAVE_T],
               moments=mom, params=int(sum(W.size + b.size for W, b in Ls)), final_epoch=ck['log'][-1])
    # integral-quantity errors
    def err(key):
        e = [abs(m['net'][key] - m['sim'][key]) for m in mom]; s = [abs(m['sim'][key]) for m in mom]
        return float(np.mean(e)), float(np.mean(s))
    res['moment_err'] = {k: err(k) for k in ['zc', 'xc', 'ztop', 'hot', 'mass', 'Tmax']}
    json.dump(res, open(os.path.join(RES, 'eval.json'), 'w'), indent=1)
    print(json.dumps({k: res[k] for k in ['rel_l2', 'log_rmse', 'baseline_gaussian_rel_l2', 'moment_err', 'params']}, indent=1))


def gaussian_like(a):
    x, y, z = sim.grid()
    X, Y, Z = np.meshgrid(x, y, z, indexing='ij')
    m = a.sum()
    if m <= 0: return np.zeros_like(a)
    cx = (a * X).sum() / m; cz = (a * Z).sum() / m
    vx = (a * (X - cx) ** 2).sum() / m; vy = (a * Y ** 2).sum() / m; vz = (a * (Z - cz) ** 2).sum() / m
    g = np.exp(-0.5 * ((X - cx) ** 2 / vx + Y ** 2 / vy + (Z - cz) ** 2 / vz))
    return g * m / g.sum()


# ------------------------------------------------------------------------------------------------- export
def bake_box():
    """Time-dependent bake box from all runs: soot / heat extent (99.7 % of the mass), padded; linear in Fw for x1."""
    x, y, z = sim.grid()
    rows = []
    for fn in runs():
        d = np.load(fn); sn = d['snaps'].astype(np.float32); fw = float(d['fw'])
        for it, t in enumerate(d['t']):
            S, T, _ = sn[it]
            a = S / S_REF + T * 2
            tot = a.sum()
            def ext(axis_vals, axes):
                prof = a.sum(axis=axes); c = np.cumsum(prof) / tot
                return axis_vals[min(np.searchsorted(c, 0.002), len(c) - 1)], axis_vals[min(np.searchsorted(c, 0.998), len(c) - 1)]
            x0, x1 = ext(x, (1, 2)); _, y1 = ext(y, (0, 2)); _, z1 = ext(z, (0, 1))
            rows.append((it, fw, x0, x1, y1, z1))
    rows = np.array(rows)
    tt = sim.SAVE_T
    box = dict(t=[0.0] + [float(v) for v in tt], x0=[], x1=[], x1w=[], y1=[], z1=[], x0w=0.0)
    for it in range(len(tt)):
        r = rows[rows[:, 0] == it]
        A = np.stack([np.ones(len(r)), r[:, 1]], 1)
        # upper envelope: least squares then shift so ~all runs are inside
        c, *_ = np.linalg.lstsq(A, r[:, 3], rcond=None); c[0] += max(0, (r[:, 3] - A @ c).max())
        box['x0'].append(float(r[:, 2].min() - 0.35)); box['x1'].append(float(c[0] + 0.35)); box['x1w'].append(float(c[1]))
        box['y1'].append(float(r[:, 4].max() + 0.3)); box['z1'].append(float(r[:, 5].max() + 0.35))
    for k in ['x0', 'x1', 'x1w', 'y1', 'z1']:
        box[k] = [box[k][0]] + box[k]
    return box


def export():
    fwd, Ls, ck = load_np_model()
    flat = np.concatenate([np.concatenate([W.astype(np.float32).ravel(), b.astype(np.float32)]) for W, b in Ls])
    b64 = base64.b64encode(flat.astype('<f4').tobytes()).decode()
    sizes = [Ls[0][0].shape[1]] + [W.shape[0] for W, _ in Ls]
    ev = json.load(open(os.path.join(RES, 'eval.json'))) if os.path.exists(os.path.join(RES, 'eval.json')) else {}
    box = bake_box()
    model = dict(sizes=sizes, params=int(flat.size), enc=ENC, box=box,
                 domain=dict(x0=sim.X0, x1=sim.X1, y1=sim.YM, z1=sim.ZM),
                 eval={k: ev.get(k) for k in ['rel_l2', 'log_rmse', 'baseline_gaussian_rel_l2', 'moment_err', 'test_runs']},
                 b64=b64)
    js = ('// GENERATED by tools/neural/fireball/train.py export - do not edit. Neural fireball (see fireball.js).\n'
          'export const FIREBALL_MODEL = ' + json.dumps(model) + ';\n')
    open(os.path.join(ROOT, 'src', 'neural', 'fireball-weights.js'), 'w').write(js)
    # test vectors: features computed in float64 from raw inputs, outputs from the float32 weights in float64
    rng = np.random.default_rng(5)
    n = 48
    P = np.stack([rng.uniform(sim.X0, sim.X1, n), rng.uniform(-2.0, 2.0, n), rng.uniform(0, 5, n), rng.uniform(0, 20, n) ** 1.0,
                  rng.uniform(0, 1.2, n), rng.uniform(0, 2.5, n)], 1)
    P[:8, 3] = [0, 0.05, 0.3, 1, 2.5, 6, 12, 20]
    F = features_np(P[:, 0], P[:, 1], P[:, 2], P[:, 3], P[:, 4], P[:, 5]).astype(np.float64)
    F64 = np.stack([features64(*p) for p in P])
    Lf = [(W.astype(np.float32).astype(np.float64), b.astype(np.float32).astype(np.float64)) for W, b in Ls]
    h = F64
    for i, (W, b) in enumerate(Lf):
        h = h @ W.T + b
        if i < len(Lf) - 1: h = np.tanh(h)
    json.dump(dict(inputs=P.tolist(), features=F64.tolist(), outputs=h.tolist()), open(os.path.join(ROOT, 'src', 'neural', 'fireball-test-vectors.json'), 'w'))
    print('exported', sizes, flat.size, 'params', len(js) // 1024, 'kB')


def features64(x, y, z, t, fw, ui, e=ENC):
    xn = (x - e['xc']) / e['xs']; yn = abs(y) / e['ys'] * 2 - 1; zn = z / e['zs'] - 1
    tau = math.log1p(max(t, 0) / e['t0']) / math.log1p(e['tMax'] / e['t0'])
    tn = 2 * min(tau, 1) - 1
    c = [xn, yn, zn]
    for f in range(1, e['nFreq'] + 1):
        w = math.pi * f
        c += [math.sin(w * xn), math.cos(w * xn), math.sin(w * yn), math.cos(w * yn), math.sin(w * zn), math.cos(w * zn)]
    c.append(tn)
    for f in range(1, e['nFreqT'] + 1):
        c += [math.sin(math.pi * f * tn), math.cos(math.pi * f * tn)]
    c += [fw / e['fwS'] - 1, ui / e['uiS'] - 1]
    return np.array(c)


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'sample': sample()
    elif cmd == 'fit':
        ep = int(sys.argv[sys.argv.index('--epochs') + 1]) if '--epochs' in sys.argv else 60
        fit(epochs=ep)
    elif cmd == 'eval': evaluate()
    elif cmd == 'export': export()
