"""Train the crop canopy reflectance networks on trace.py's tiles and compare them with analytic baselines (numpy only).

    python3 train.py ../../../../src/neural/ground-crop-weights.js data/crop_*.npz [--presets data/presets.json]

SUN net 14-32-32-3: (mu_s, mu_v, cos/sin of the sun azimuth from the rows, cos/sin of the view azimuth from the rows,
cos of the sun-view relative azimuth, ln height, nadir cover, row contrast, leaf angle, senescence, flower share,
ln soil luminance) -> ln BRF (RGB). Sun azimuths are folded into [0, pi/2] by the two mirror symmetries of a row
field (the view azimuth is mirrored with it).
SKY net 9-16-16-3: (mu_v, cos 2 phi_v, the 7 canopy numbers) -> ln HDRF under a uniform sky.

Errors on whole held-out tiles (1 in 6), ln RMSE of the BRF:
  lambert   one albedo per tile, an ORACLE (fitted to the held-out tile's own answers) - what the ground shader does
            without the network (a Lambertian painted albedo)
  rpv       Rahman-Pinty-Verstraete (the standard parametric vegetation BRDF: bowl shape, hot spot, forward / back
            scattering), 9 parameters per channel linear in the canopy numbers, fitted on the training tiles;
            azimuthally symmetric about the sun, so it cannot know the rows
  network   knows only the canopy numbers
"""
import sys, glob, base64, json, os
os.environ.setdefault("OMP_NUM_THREADS", "2"); os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")
import numpy as np

rng = np.random.default_rng(3)
args = [a for a in sys.argv[2:] if not a.startswith('--')]
pre_path = sys.argv[sys.argv.index('--presets') + 1] if '--presets' in sys.argv else None
if pre_path in args: args.remove(pre_path)
files = sorted(sum([glob.glob(a) for a in args], []))
D = np.concatenate([np.load(f)['data'] for f in files])
D = D[np.all(np.isfinite(D), 1)]
tile = D[:, 0]; kind = D[:, 1]
CAN = D[:, 2:9]                      # H, fc, rowC, ala, sen, flower, soil
mus, phs, muv, phv = D[:, 9], D[:, 10], D[:, 11], D[:, 12]
S = np.maximum(D[:, 13:16], 1e-4); K = np.maximum(D[:, 16:19], 1e-4)
tiles = np.unique(tile)
test = rng.choice(tiles, max(2, len(tiles) // 6), replace=False)
te = np.isin(tile, test); tr = ~te
print(f'{len(D)} samples, {len(tiles)} tiles, {len(test)} held out ({te.sum()} samples)')


def fcan(C):
    H, fc, rowC, ala, sen, fl, soil = [C[:, i] for i in range(7)]
    return np.stack([(np.log(H) + 1.2) / 1.2, fc * 2 - 1, rowC * 2 - 1, ala * 4 - 2, sen * 2 - 1, fl * 4 - 1, (np.log(soil) + 2.2) / 0.6], 1)


def fsun(C, mus, phs, muv, phv):
    return np.concatenate([np.stack([mus * 2 - 1, muv * 2 - 1, np.cos(phs), np.sin(phs), np.cos(phv), np.sin(phv), np.cos(phv - phs)], 1), fcan(C)], 1).astype(np.float32)


def fsky(C, muv, phv):
    return np.concatenate([np.stack([muv * 2 - 1, np.cos(2 * phv)], 1), fcan(C)], 1).astype(np.float32)


Xs, Xk = fsun(CAN, mus, phs, muv, phv), fsky(CAN, muv, phv)
Ys, Yk = np.log(S).astype(np.float32), np.log(K).astype(np.float32)


def init(sizes):
    return [(rng.standard_normal((a, b)).astype(np.float32) * np.sqrt(1.0 / a), np.zeros(b, np.float32)) for a, b in zip(sizes[:-1], sizes[1:])]


def forward(P, X):
    hs = [X]
    for i, (W, b) in enumerate(P):
        z = hs[-1] @ W + b
        hs.append(np.tanh(z) if i < len(P) - 1 else z)
    return hs


def train(sizes, X, Y, steps, bs=2048, lr=3e-3):
    P = init(sizes)
    m = [(np.zeros_like(W), np.zeros_like(b)) for W, b in P]; v = [(np.zeros_like(W), np.zeros_like(b)) for W, b in P]
    for t in range(1, steps + 1):
        idx = rng.integers(0, len(X), bs)
        hs = forward(P, X[idx])
        g = 2 * (hs[-1] - Y[idx]) / bs
        a = lr * (0.5 * (1 + np.cos(np.pi * t / steps)) * 0.97 + 0.03)
        for i in range(len(P) - 1, -1, -1):
            W, b = P[i]
            gW = hs[i].T @ g; gb = g.sum(0)
            if i > 0: g = (g @ W.T) * (1 - hs[i] ** 2)
            for k, gr in ((0, gW), (1, gb)):
                m[i][k][...] = 0.9 * m[i][k] + 0.1 * gr; v[i][k][...] = 0.999 * v[i][k] + 0.001 * gr * gr
                mh = m[i][k] / (1 - 0.9 ** t); vh = v[i][k] / (1 - 0.999 ** t)
                P[i][k][...] -= a * mh / (np.sqrt(vh) + 1e-8)
        if t % 4000 == 0:
            print(f'  step {t}: batch mse {np.mean((hs[-1] - Y[idx]) ** 2):.4f}', flush=True)
    return P


def lnrmse(P, Y): return float(np.sqrt(np.mean((P - Y) ** 2)))


print('sun net'); Ps = train([14, 32, 32, 3], Xs[tr], Ys[tr], 24000)
print('sky net'); Pk = train([9, 16, 16, 3], Xk[tr], Yk[tr], 12000)
pred_s = forward(Ps, Xs)[-1]; pred_k = forward(Pk, Xk)[-1]

# ---- baselines -------------------------------------------------------------------------------------------------
lam = np.zeros_like(Ys)
for t in np.unique(tile):
    m = tile == t
    lam[m] = Ys[m].mean(0)                  # oracle: the best constant (in ln) for each tile, test tiles included
lamk = np.zeros_like(Yk)
for t in np.unique(tile):
    m = tile == t
    lamk[m] = Yk[m].mean(0)


def rpv_ln(p, Fc, mus, muv, dphi):
    """ln RPV; per channel 9 params: (rho0, k, theta) each = a + b . (2 canopy features: ln H, fc ... ) -> use all 7."""
    nf = Fc.shape[1] + 1
    Fx = np.concatenate([np.ones((len(Fc), 1)), Fc], 1)
    ts = np.sqrt(1 - mus ** 2) / mus; tv = np.sqrt(1 - muv ** 2) / muv
    cosg = mus * muv + np.sqrt(1 - mus ** 2) * np.sqrt(1 - muv ** 2) * np.cos(dphi)
    G = np.sqrt(np.maximum(ts ** 2 + tv ** 2 - 2 * ts * tv * np.cos(dphi), 0))
    out = []
    for c in range(3):
        a = p[c * 3 * nf:(c + 1) * 3 * nf].reshape(3, nf)
        lr0 = Fx @ a[0]; k = Fx @ a[1]; th = np.tanh(Fx @ a[2])
        out.append(lr0 + (k - 1) * np.log(mus * muv * (mus + muv)) + np.log(1 - th ** 2) - 1.5 * np.log(1 + 2 * th * cosg + th ** 2) + np.log(np.maximum(1 + (1 - np.exp(np.minimum(lr0, 0.5))) / (1 + G), 1e-3)))
    return np.stack(out, 1)


def fit_rpv():
    Fc = fcan(CAN[tr]); nf = Fc.shape[1] + 1
    p = np.zeros(3 * 3 * nf)
    for c in range(3): p[c * 3 * nf] = np.mean(Ys[tr, c]); p[c * 3 * nf + nf] = 0.8
    sub = rng.choice(np.where(tr)[0], min(3000, tr.sum()), replace=False)
    Fs = fcan(CAN[sub])
    args_ = (Fs, mus[sub], muv[sub], (phv - phs)[sub]); Y = Ys[sub]
    m = np.zeros_like(p); v = np.zeros_like(p)
    for it in range(1, 1201):          # Adam with numeric gradients (63 parameters)
        base = np.mean((rpv_ln(p, *args_) - Y) ** 2)
        g = np.zeros_like(p); h = 1e-4
        for j in range(len(p)):
            q = p.copy(); q[j] += h
            g[j] = (np.mean((rpv_ln(q, *args_) - Y) ** 2) - base) / h
        m = 0.9 * m + 0.1 * g; v = 0.999 * v + 0.001 * g * g
        p -= 0.02 * (m / (1 - 0.9 ** it)) / (np.sqrt(v / (1 - 0.999 ** it)) + 1e-8)
        if it % 300 == 0: print(f'  rpv {it}: {base:.4f}', flush=True)
    return p


print('rpv fit'); prpv = fit_rpv()
rp = rpv_ln(prpv, fcan(CAN), mus, muv, phv - phs)

graz = muv < 0.25
lowsun = mus < 0.3
res = {}
for name, P in (('lambert_oracle', lam), ('rpv', rp), ('network', pred_s)):
    res[name] = dict(ln_rmse=lnrmse(P[te], Ys[te]), ln_rmse_grazing_view=lnrmse(P[te & graz], Ys[te & graz]),
                     ln_rmse_low_sun=lnrmse(P[te & lowsun], Ys[te & lowsun]))
res['network_train'] = dict(ln_rmse=lnrmse(pred_s[tr], Ys[tr]))
res['sky'] = dict(lambert_oracle=lnrmse(lamk[te], Yk[te]), network=lnrmse(pred_k[te], Yk[te]))
per_kind = {}
for kd, nm in enumerate(['cereal', 'maize', 'rape', 'meadow', 'stubble']):
    m = te & (kind == kd)
    if m.sum(): per_kind[nm] = dict(lambert_oracle=lnrmse(lam[m], Ys[m]), rpv=lnrmse(rp[m], Ys[m]), network=lnrmse(pred_s[m], Ys[m]), n=int(m.sum()))
res['per_kind'] = per_kind
noise_p = os.path.join(os.path.dirname(files[0]), 'noise.json')
if os.path.exists(noise_p): res['mc_noise'] = json.load(open(noise_p))
print(json.dumps(res, indent=1))

presets = json.load(open(pre_path)) if pre_path else {}
# hemispherical-ish reference albedo of each preset: sky HDRF at mu_v = 0.7 averaged over azimuth
for k, f in presets.items():
    C = np.array([[f['H'], f['fc'], f['rowC'], f['ala'], f['sen'], f['flower'], f['soil']]] * 8)
    ph = np.linspace(-np.pi, np.pi, 8, endpoint=False)
    f['skyAlb'] = np.exp(forward(Pk, fsky(C, np.full(8, 0.7), ph))[-1]).mean(0).round(4).tolist()
    print(k, f['skyAlb'])


def pack(P):
    flat = np.concatenate([np.concatenate([W.T.ravel(), b]) for W, b in P]).astype(np.float32)
    return base64.b64encode(flat.tobytes()).decode(), flat


sb, sflat = pack(Ps); kb, kflat = pack(Pk)


def fwd32(flat, sizes, x):
    p = 0; a = np.array(x, np.float64)
    for i in range(len(sizes) - 1):
        n, m = sizes[i], sizes[i + 1]
        W = flat[p:p + n * m].astype(np.float64).reshape(m, n); p += n * m
        b = flat[p:p + m].astype(np.float64); p += m
        a = W @ a + b
        if i < len(sizes) - 2: a = np.tanh(a)
    return a.tolist()


idx = np.random.default_rng(9).choice(len(D), 16, replace=False)
vec = dict(sun=[dict(raw=[*CAN[i].tolist(), mus[i], phs[i], muv[i], phv[i]], x=Xs[i].tolist(), y=fwd32(sflat, [14, 32, 32, 3], Xs[i])) for i in idx],
           sky=[dict(x=Xk[i].tolist(), y=fwd32(kflat, [9, 16, 16, 3], Xk[i])) for i in idx])
out = sys.argv[1]
json.dump(vec, open(os.path.join(os.path.dirname(out), 'crop-test-vectors.json'), 'w'))
meta = dict(samples=int(len(D)), tiles=int(len(tiles)), heldOutTiles=int(len(test)), presets=presets)
with open(out, 'w') as f:
    f.write('// GENERATED by tools/neural/ground/crop/train.py - do not edit. Crop canopy reflectance networks (see ground-crop.js).\n')
    f.write(f"export const CROP_SUN_NET = {{ sizes: [14, 32, 32, 3], b64: '{sb}' }};\n")
    f.write(f"export const CROP_SKY_NET = {{ sizes: [9, 16, 16, 3], b64: '{kb}' }};\n")
    f.write(f"export const CROP_EVAL = {json.dumps(res)};\n")
    f.write(f"export const CROP_META = {json.dumps(meta)};\n")
print('wrote', out, len(sflat) + len(kflat), 'parameters')
