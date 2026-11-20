"""Train the turf reflectance networks on trace.py's data and compare them with analytic baselines.

    python3 train.py out_weights.js data/turf_*.npz

SUN net: 9 inputs (mu_s, mu_v, cos/sin of sun azimuth from the lay direction, cos/sin of view azimuth from the lay
direction, cos of the sun-view relative azimuth, lay amount, sward height) -> 32 tanh -> 32 tanh -> 3 = ln BRF (RGB).
SKY net: 4 inputs (mu_v, cos of view azimuth from the lay direction, lay, height) -> 16 tanh -> 16 tanh -> 3 = ln HDRF.
(The y -> -y mirror symmetry of a laid sward is built into the sampling: sun azimuths in [0, pi].)

Baselines, fitted to the same training tiles by least squares in ln space:
  lambert      one albedo per tile (an oracle: it knows each test tile's mean colour)
  rpv          Rahman-Pinty-Verstraete, the standard parametric vegetation BRDF (hot spot, bowl shape, forward /
               back scattering), parameters linear in (lay, height) per channel; azimuthally symmetric about the sun,
               so it cannot know which way the blades lie
Noise floor: trace.py --noise (the same configurations rendered twice with independent rays)."""
import sys, json, base64, time, glob
import numpy as np
import torch

torch.set_num_threads(2)
out_js = sys.argv[1]
files = sorted(sum([glob.glob(a) for a in sys.argv[2:]], []))
D = np.concatenate([np.load(f)['data'] for f in files])
D = D[np.all(np.isfinite(D), 1)]
tile, lean, H, mus, phs, muv, phv = [D[:, i] for i in range(7)]
S = np.maximum(D[:, 7:10], 1e-4); K = np.maximum(D[:, 10:13], 1e-4)
tiles = np.unique(tile)
rng = np.random.default_rng(5)
test_tiles = rng.choice(tiles, max(1, len(tiles) // 7), replace=False)
te = np.isin(tile, test_tiles); tr = ~te
print(f'{len(D)} samples, {len(tiles)} tiles, {te.sum()} test samples in {len(test_tiles)} held-out tiles')

def feats_sun(lean, H, mus, phs, muv, phv):
    return np.stack([mus * 2 - 1, muv * 2 - 1, np.cos(phs), np.sin(phs), np.cos(phv), np.sin(phv), np.cos(phv - phs), lean * 2 - 1, (H - 0.08) / 0.05], 1)
def feats_sky(lean, H, muv, phv):
    return np.stack([muv * 2 - 1, np.cos(phv), lean * 2 - 1, (H - 0.08) / 0.05], 1)

Xs = feats_sun(lean, H, mus, phs, muv, phv); Xk = feats_sky(lean, H, muv, phv)
Ys = np.log(S); Yk = np.log(K)

def train(X, Y, sizes, iters=8000, lr0=3e-3, seed=0):
    torch.manual_seed(seed)
    layers = []
    for i in range(len(sizes) - 1):
        layers.append(torch.nn.Linear(sizes[i], sizes[i + 1]))
        if i < len(sizes) - 2: layers.append(torch.nn.Tanh())
    net = torch.nn.Sequential(*layers).double()
    Xt = torch.tensor(X[tr]); Yt = torch.tensor(Y[tr])
    # (float64 throughout: the exported float32 weights are then checked against a float64 reference)
    opt = torch.optim.Adam(net.parameters(), lr=lr0)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, iters)
    g = torch.Generator().manual_seed(seed)
    for it in range(iters):
        idx = torch.randint(0, len(Xt), (2048,), generator=g)
        loss = torch.mean((net(Xt[idx]) - Yt[idx]) ** 2)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    return net

def pred(net, X):
    with torch.no_grad(): return net(torch.tensor(X)).numpy()

t0 = time.time()
sun = train(Xs, Ys, [9, 32, 32, 3])
sky = train(Xk, Yk, [4, 16, 16, 3], iters=4000)
print(f'trained in {time.time() - t0:.0f}s')

# ---- baselines ---------------------------------------------------------------------------------------------------
def lambert_oracle(mask):
    P = np.zeros_like(S)
    for t in np.unique(tile[mask]):
        m = mask & (tile == t)
        P[m] = np.exp(np.mean(np.log(S[m]), 0))
    return P

def rpv(params, lean, H, mus, muv, dphi):
    # params per channel: rho0 = exp(a0 + a1 lean + a2 h), k = b0 + b1 lean + b2 h, theta = c0 + c1 lean + c2 h
    h = (H - 0.08) / 0.05
    out = []
    ts = np.sqrt(1 - mus ** 2) / mus; tv = np.sqrt(1 - muv ** 2) / muv
    cosg = mus * muv + np.sqrt(1 - mus ** 2) * np.sqrt(1 - muv ** 2) * np.cos(dphi)   # phase angle (backscatter g=0)
    G = np.sqrt(np.maximum(ts ** 2 + tv ** 2 - 2 * ts * tv * np.cos(dphi), 0))
    for c in range(3):
        a = params[c * 9:(c + 1) * 9]
        rho0 = np.exp(a[0] + a[1] * lean + a[2] * h); k = a[3] + a[4] * lean + a[5] * h; th = np.tanh(a[6] + a[7] * lean + a[8] * h)
        M = (mus * muv * (mus + muv)) ** (k - 1)
        F = (1 - th ** 2) / (1 + 2 * th * cosg + th ** 2) ** 1.5
        R = 1 + (1 - rho0) / (1 + G)
        out.append(rho0 * M * F * R)
    return np.stack(out, 1)

def fit_rpv():
    p = torch.zeros(27, dtype=torch.float64, requires_grad=True)
    with torch.no_grad():
        for c in range(3): p[c * 9] = np.log(np.mean(S[tr, c])); p[c * 9 + 3] = 0.8
    L_, H_, ms, mv = [torch.tensor(a[tr]) for a in (lean, H, mus, muv)]
    dph = torch.tensor((phv - phs)[tr]); Y = torch.tensor(np.log(S[tr]))
    opt = torch.optim.Adam([p], lr=0.02)
    h = (H_ - 0.08) / 0.05
    ts = torch.sqrt(1 - ms ** 2) / ms; tv = torch.sqrt(1 - mv ** 2) / mv
    cosg = ms * mv + torch.sqrt(1 - ms ** 2) * torch.sqrt(1 - mv ** 2) * torch.cos(dph)
    G = torch.sqrt(torch.clamp(ts ** 2 + tv ** 2 - 2 * ts * tv * torch.cos(dph), min=0))
    for it in range(3000):
        loss = 0
        for c in range(3):
            a = p[c * 9:(c + 1) * 9]
            lr0 = a[0] + a[1] * L_ + a[2] * h; k = a[3] + a[4] * L_ + a[5] * h; th = torch.tanh(a[6] + a[7] * L_ + a[8] * h)
            lnB = lr0 + (k - 1) * torch.log(ms * mv * (ms + mv)) + torch.log(1 - th ** 2) - 1.5 * torch.log(1 + 2 * th * cosg + th ** 2) + torch.log(1 + (1 - torch.exp(lr0)) / (1 + G))
            loss = loss + torch.mean((lnB - Y[:, c]) ** 2)
        opt.zero_grad(); loss.backward(); opt.step()
    return p.detach().numpy()

prpv = fit_rpv()

def report(name, P, mask):
    e = P[mask] - S[mask]; y = S[mask]
    lum = lambda a: a @ np.array([0.2126, 0.7152, 0.0722])
    el = lum(P[mask]) - lum(y)
    graz = (muv[mask] < 0.3)
    return dict(model=name, rmse_g=float(np.sqrt(np.mean(e[:, 1] ** 2))), rmse_lum=float(np.sqrt(np.mean(el ** 2))),
                rel_lum=float(np.sqrt(np.mean((el / lum(y)) ** 2))), ln_rmse=float(np.sqrt(np.mean((np.log(np.maximum(P[mask], 1e-5)) - np.log(y)) ** 2))),
                rel_lum_grazing_view=float(np.sqrt(np.mean((el[graz] / lum(y)[graz]) ** 2))), mean_lum=float(np.mean(lum(y))))

res = [report('lambert (oracle albedo per tile)', lambert_oracle(te), te),
       report('rpv (fitted, sun-symmetric)', rpv(prpv, lean, H, mus, muv, phv - phs), te),
       report('mlp 9-32-32-3', np.exp(pred(sun, Xs)), te),
       report('mlp (train tiles)', np.exp(pred(sun, Xs)), tr)]
sky_te = np.exp(pred(sky, Xk))
res.append(dict(model='sky mlp 4-16-16-3', ln_rmse=float(np.sqrt(np.mean((np.log(sky_te[te]) - np.log(K[te])) ** 2))),
                rel_lum_const=float(np.sqrt(np.mean(((K[te].mean(0) - K[te]) / K[te]) ** 2)))))
# stripe contrast: brightness ratio of the two lay directions (view along vs against the lay), held-out tiles, lay > 0.5
for r in res: print(json.dumps(r))

def pack(net):
    ws = []
    sizes = []
    for m in net:
        if isinstance(m, torch.nn.Linear):
            ws.append(np.concatenate([m.weight.detach().numpy().ravel(), m.bias.detach().numpy()]))
            sizes.append(m.in_features)
    sizes.append(net[-1].out_features)
    flat = np.concatenate(ws).astype(np.float32)
    return sizes, base64.b64encode(flat.tobytes()).decode(), flat

ss_, sb64, sflat = pack(sun); ks_, kb64, kflat = pack(sky)
# test vectors for the JS twin
tv_idx = np.random.default_rng(9).choice(len(D), 24, replace=False)
vec = dict(sun=[dict(x=Xs[i].tolist(), y=(np.log(np.exp(pred(sun, Xs[i:i + 1])))[0]).tolist(), raw=[lean[i], H[i], mus[i], phs[i], muv[i], phv[i]]) for i in tv_idx],
           sky=[dict(x=Xk[i].tolist(), y=pred(sky, Xk[i:i + 1])[0].tolist()) for i in tv_idx])
# float32 weights: recompute the vectors with the rounded weights so the JS twin can be compared exactly
def fwd32(flat, sizes, x):
    p = 0; a = np.array(x, np.float64)
    for i in range(len(sizes) - 1):
        n, m = sizes[i], sizes[i + 1]
        W = flat[p:p + n * m].astype(np.float64).reshape(m, n); p += n * m
        b = flat[p:p + m].astype(np.float64); p += m
        a = W @ a + b
        if i < len(sizes) - 2: a = np.tanh(a)
    return a.tolist()
for v in vec['sun']: v['y'] = fwd32(sflat, ss_, v['x'])
for v in vec['sky']: v['y'] = fwd32(kflat, ks_, v['x'])
json.dump(vec, open(out_js.replace('ground-turf-weights.js', 'turf-test-vectors.json'), 'w'))
meta = dict(samples=int(len(D)), tiles=int(len(tiles)), heldOutTiles=int(len(test_tiles)), rpv=prpv.tolist())
js = f"""// GENERATED by tools/neural/ground/turf/train.py - do not edit. Turf reflectance networks (see ground-turf.js).
export const TURF_SUN_NET = {{ sizes: {ss_}, b64: '{sb64}' }};
export const TURF_SKY_NET = {{ sizes: {ks_}, b64: '{kb64}' }};
export const TURF_EVAL = {json.dumps(res)};
export const TURF_META = {json.dumps(meta)};
"""
open(out_js, 'w').write(js)
print('wrote', out_js, len(sflat) + len(kflat), 'parameters')
