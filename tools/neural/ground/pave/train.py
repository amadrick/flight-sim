"""Train the pavement reflectance networks on trace.py's tiles and compare them with the classic model (numpy only).

    python3 train.py out_weights.js data/pave_*.npz

SUN net 11-32-32-2: (mu_s, mu_v, cos dphi, cos^2 phi_s, cos^2 phi_v, cos phi_s cos phi_v, sin phi_s sin phi_v, groove,
exposure, rubber, wet) -> (ln Kd, ln(Ks + 0.002)). The azimuths are measured from the runway axis; the features are the
invariants of the groove pattern's two mirror symmetries.
SKY net 6-8-8-2: (mu_v, cos^2 phi_v, groove, exposure, rubber, wet) -> (ln Hd, ln Hs).

Errors are reported on whole held-out tiles (1 in 6), in ln of the total reflectance R = A Kd + Ks (sun, BRF) and
A Hd + Hs (unit sky), A = the tile's mean albedo:
  classic        what the engine draws without the network: Lambert (A) + GGX / Smith / Schlick (F0 0.04) at the
                 pavement shader's roughness 0.6, and the same with three.js' DFG approximation under the sky
  classic-fit    the same model with roughness, F0 and a diffuse scale fitted to each held-out tile (an oracle: it is
                 given the test tile's own answers)
  network        knows only the tile's parameters (groove, exposure, rubber, wetness)
"""
import sys, glob, base64, json
import os
os.environ.setdefault("OMP_NUM_THREADS", "1"); os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
import numpy as np

rng = np.random.default_rng(3)
files = sorted(sum([glob.glob(a) for a in sys.argv[2:]], []))
SUN = np.concatenate([np.load(f)['sun'] for f in files]); SKY = np.concatenate([np.load(f)['sky'] for f in files])
SUN = SUN[np.all(np.isfinite(SUN), 1)]; SKY = SKY[np.all(np.isfinite(SKY), 1)]
# columns: tid, groove, exposure, rubber, wet, A, | mu_s, ph_s, mu_v, ph_v, Kd, Ks   /  mu_v, ph_v, Hd, Hs
tiles = np.unique(SUN[:, 0])
test = rng.choice(tiles, max(2, len(tiles) // 6), replace=False)
print(f'{len(tiles)} tiles, {len(test)} held out; {len(SUN)} sun rows, {len(SKY)} sky rows')


def fsun(D):
    g, e, r, w = D[:, 1], D[:, 2], D[:, 3], D[:, 4]
    ms, ps, mv, pv = D[:, 6], D[:, 7], D[:, 8], D[:, 9]
    return np.stack([ms * 2 - 1, mv * 2 - 1, np.cos(pv - ps), np.cos(ps) ** 2 * 2 - 1, np.cos(pv) ** 2 * 2 - 1,
                     np.cos(ps) * np.cos(pv), np.sin(ps) * np.sin(pv), g * 2 - 1, e * 2 - 1, r * 2 - 1, w * 2 - 1], 1).astype(np.float32)


def fsky(D):
    g, e, r, w = D[:, 1], D[:, 2], D[:, 3], D[:, 4]
    mv, pv = D[:, 6], D[:, 7]
    return np.stack([mv * 2 - 1, np.cos(pv) ** 2 * 2 - 1, g * 2 - 1, e * 2 - 1, r * 2 - 1, w * 2 - 1], 1).astype(np.float32)


EPS_S = 0.002
Ysun = np.stack([np.log(np.maximum(SUN[:, 10], 1e-3)), np.log(SUN[:, 11] + EPS_S)], 1).astype(np.float32)
Ysky = np.stack([np.log(np.maximum(SKY[:, 8], 1e-3)), np.log(np.maximum(SKY[:, 9], 1e-4))], 1).astype(np.float32)


def init(sizes):
    return [(rng.standard_normal((a, b)).astype(np.float32) * np.sqrt(1.0 / a), np.zeros(b, np.float32)) for a, b in zip(sizes[:-1], sizes[1:])]


def forward(P, X):
    hs = [X]
    for i, (W, b) in enumerate(P):
        z = hs[-1] @ W + b
        hs.append(np.tanh(z) if i < len(P) - 1 else z)
    return hs


def train(sizes, X, Y, steps, bs=4096, lr=3e-3, wts=None):
    P = init(sizes)
    m = [(np.zeros_like(W), np.zeros_like(b)) for W, b in P]; v = [(np.zeros_like(W), np.zeros_like(b)) for W, b in P]
    for t in range(1, steps + 1):
        idx = rng.integers(0, len(X), bs)
        hs = forward(P, X[idx])
        g = 2 * (hs[-1] - Y[idx]) / bs
        if wts is not None: g *= wts
        a = lr * (0.5 * (1 + np.cos(np.pi * t / steps)) * 0.97 + 0.03)
        for i in range(len(P) - 1, -1, -1):
            W, b = P[i]
            gW = hs[i].T @ g; gb = g.sum(0)
            if i > 0: g = (g @ W.T) * (1 - hs[i] ** 2)
            for k, gr in ((0, gW), (1, gb)):
                m[i][k][...] = 0.9 * m[i][k] + 0.1 * gr; v[i][k][...] = 0.999 * v[i][k] + 0.001 * gr * gr
                mh = m[i][k] / (1 - 0.9 ** t); vh = v[i][k] / (1 - 0.999 ** t)
                P[i][k][...] -= a * mh / (np.sqrt(vh) + 1e-8)
        if t % 2000 == 0:
            print(f'  step {t}: batch mse {np.mean((hs[-1] - Y[idx]) ** 2):.4f}', flush=True)
    return P


# ---------------------------------------------------------------- classic model (three.js MeshStandardMaterial)
def ggx_brf(ms, ps, mv, pv, rough, f0=0.04):
    """pi * f_GGX(l, v) as three.js evaluates it on a flat surface (D_GGX, V_GGX_SmithCorrelated, F_Schlick)."""
    a2 = rough ** 4
    sl, sv = np.sqrt(1 - ms ** 2), np.sqrt(1 - mv ** 2)
    l = np.stack([sl * np.cos(ps), sl * np.sin(ps), ms]); v = np.stack([sv * np.cos(pv), sv * np.sin(pv), mv])
    h = l + v; h /= np.linalg.norm(h, axis=0)
    nh, vh = h[2], np.sum(v * h, 0)
    D = a2 / (np.pi * (nh * nh * (a2 - 1) + 1) ** 2)
    gv = ms * np.sqrt(a2 + (1 - a2) * mv * mv); gl = mv * np.sqrt(a2 + (1 - a2) * ms * ms)
    V = 0.5 / np.maximum(gv + gl, 1e-6)
    F = f0 + (1 - f0) * (1 - vh) ** 5
    return np.pi * F * V * D


def dfg_spec(mv, rough, f0=0.04):
    c0 = np.array([-1, -0.0275, -0.572, 0.022]); c1 = np.array([1, 0.0425, 1.04, -0.04])
    r = rough[..., None] * c0 + c1 if np.ndim(rough) else rough * c0 + c1
    r = np.broadcast_to(r, np.shape(mv) + (4,))
    a004 = np.minimum(r[..., 0] ** 2, np.exp2(-9.28 * mv)) * r[..., 0] + r[..., 1]
    fa = -1.04 * a004 + r[..., 2]; fb = 1.04 * a004 + r[..., 3]
    return f0 * fa + fb


def classic_sun(D, rough=0.6, f0=0.04, kd=1.0):
    return D[:, 5] * kd + ggx_brf(D[:, 6], D[:, 7], D[:, 8], D[:, 9], rough, f0)


def classic_sky(D, rough=0.6, f0=0.04, kd=1.0):
    return D[:, 5] * kd + dfg_spec(D[:, 6], rough, f0)


def lnrmse(a, b):
    return float(np.sqrt(np.mean((np.log(np.maximum(a, 1e-4)) - np.log(np.maximum(b, 1e-4))) ** 2)))


def fit_tile_sun(D):
    tgt = D[:, 5] * D[:, 10] + D[:, 11]; best = (1e9, None)
    for rough in np.linspace(0.2, 1.0, 9):
        for f0 in (0.02, 0.04, 0.08):
            gg = ggx_brf(D[:, 6], D[:, 7], D[:, 8], D[:, 9], rough, f0)
            # diffuse scale by least squares in ln space (1-D search)
            for kd in np.exp(np.linspace(-0.7, 0.7, 15)):
                e = lnrmse(D[:, 5] * kd + gg, tgt)
                if e < best[0]: best = (e, (rough, f0, kd))
    return best


def fit_tile_sky(D):
    tgt = D[:, 5] * D[:, 8] + D[:, 9]; best = (1e9, None)
    for rough in np.linspace(0.05, 1.0, 11):
        for f0 in (0.02, 0.04, 0.08):
            for kd in np.exp(np.linspace(-0.7, 0.7, 15)):
                e = lnrmse(classic_sky(D, rough, f0, kd), tgt)
                if e < best[0]: best = (e, (rough, f0, kd))
    return best


te_s = np.isin(SUN[:, 0], test); te_k = np.isin(SKY[:, 0], test)
Xs, Xk = fsun(SUN), fsky(SKY)
print('training SUN net'); Ps = train([11, 32, 32, 2], Xs[~te_s], Ysun[~te_s], int(sys.argv[-1]) if sys.argv[-1].isdigit() else 30000)
print('training SKY net'); Pk = train([6, 8, 8, 2], Xk[~te_k], Ysky[~te_k], 5000)


def pred_sun(D, P):
    o = forward(P, fsun(D))[-1]
    return D[:, 5] * np.exp(o[:, 0]) + np.maximum(np.exp(o[:, 1]) - EPS_S, 0)


def pred_sky(D, P):
    o = forward(P, fsky(D))[-1]
    return D[:, 5] * np.exp(o[:, 0]) + np.exp(o[:, 1])


res = {}
for name, D, tgtf, cls, fit, pred, P in (
        ('sun', SUN, lambda D: D[:, 5] * D[:, 10] + D[:, 11], classic_sun, fit_tile_sun, pred_sun, Ps),
        ('sky', SKY, lambda D: D[:, 5] * D[:, 8] + D[:, 9], classic_sky, fit_tile_sky, pred_sky, Pk)):
    Dt = D[np.isin(D[:, 0], test)]; Dr = D[~np.isin(D[:, 0], test)]
    e_cls = lnrmse(cls(Dt), tgtf(Dt))
    e_fit = []; e_net = []
    for t in test:
        Di = Dt[Dt[:, 0] == t]
        e_fit.append(fit(Di)[0] ** 2 * len(Di)); e_net.append(lnrmse(pred(Di, P), tgtf(Di)) ** 2 * len(Di))
    e_fit = float(np.sqrt(np.sum(e_fit) / len(Dt))); e_net = float(np.sqrt(np.sum(e_net) / len(Dt)))
    e_tr = lnrmse(pred(Dr, P), tgtf(Dr))
    # wet / grazing subsets (where the classic model is expected to fail)
    sub = {}
    for sn, m in (('dry', Dt[:, 4] == 0), ('wet', Dt[:, 4] > 0.35), ('grazing view mu_v<0.2', Dt[:, 8 if name == 'sun' else 6] < 0.2)):
        if m.sum(): sub[sn] = (lnrmse(cls(Dt[m]), tgtf(Dt[m])), lnrmse(pred(Dt[m], P), tgtf(Dt[m])))
    res[name] = dict(classic=e_cls, classic_fit_oracle=e_fit, network=e_net, network_train=e_tr, subsets=sub)
    print(f'{name}: held-out ln RMSE  classic {e_cls:.3f}  classic-fit (oracle) {e_fit:.3f}  network {e_net:.3f}  (train {e_tr:.3f})')
    for k, (a, b) in sub.items(): print(f'    {k:24s} classic {a:.3f}  network {b:.3f}')

# noise floor: the sky term is Monte Carlo; the sun term is deterministic given the tile
def pack(P):
    flat = np.concatenate([np.concatenate([W.T.ravel(), b]) for W, b in P]).astype(np.float32)
    return base64.b64encode(flat.tobytes()).decode()


with open(sys.argv[1], 'w') as f:
    f.write('// Generated by tools/neural/ground/pave/train.py - pavement reflectance networks (see src/neural/ground-pave.js).\n')
    f.write(f'// Held-out tiles, ln RMSE of the total reflectance: {json.dumps({k: {kk: round(vv, 4) for kk, vv in v.items() if not isinstance(vv, dict)} for k, v in res.items()})}\n')
    f.write(f"export const PAVE_EVAL = {json.dumps(res)};\n")
    f.write(f"export const PAVE_SUN = {{ sizes: [11, 32, 32, 2], eps: {EPS_S}, data: '{pack(Ps)}' }};\n")
    f.write(f"export const PAVE_SKY = {{ sizes: [6, 8, 8, 2], data: '{pack(Pk)}' }};\n")
json.dump(res, open(sys.argv[1] + '.json', 'w'), indent=1)
print('wrote', sys.argv[1])
