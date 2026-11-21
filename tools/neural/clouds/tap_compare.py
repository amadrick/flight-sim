"""Round seven: shader debug views (clDbg=10..15) against the same quantities on the exported field, per fifth of the cloud rows.

    clDbg=11 (taps) -> default output; --tau (clDbg=10); --tau2 (clDbg=12, light march split); --dist (clDbg=13);
    --pt (clDbg=15, tap density at the sample); --net (network outputs with ideal / perturbed taps); --cam, --flip
    $VENV tap_compare.py harness.log [flags]     (log from tools/shot.mjs --eval "$(cat cmp_eval.js)")
"""
import sys, os, math, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pt, render as R, scenes as S, model as M, features as F
from game_compare import load, quat_rot
log = sys.argv[1]
d = load(log); im, f = d['img'], d['field']
W, H = im['w'], im['h']; n, nz = f['nx'], f['nz']
def grid(key):
    a = np.frombuffer(base64.b64decode(f[key]), np.uint8).reshape(nz, n, n).astype(np.float32) / 255.0
    a = np.ascontiguousarray(a.transpose(2, 0, 1))
    if abs(f['dx'] - f['dz']) > 0.5: a = S.resample(a, (f['dx'], f['dz'], f['dx']), f['dx'])
    return a * f['sigma']
sig = grid('full'); base = grid('base8')
cam = np.array(im['camAir'], float)
origin = (f['x0'] - cam[0], f['base'], f['z0'] - cam[2])
sc = pt.Scene(sig, f['dx'], origin, name='g'); sc.set_sun(np.array(im['sun'], float))
camp = np.array([0.0, cam[1], 0.0])
t = math.tan(math.radians(im['fov']) / 2)
xs = ((np.arange(W) + 0.5) / W * 2 - 1) * t * im['aspect']; ys = (1 - (np.arange(H) + 0.5) / H * 2) * t
X, Y = np.meshgrid(xs, ys)
dc = np.stack([X, Y, -np.ones_like(X)], -1).reshape(-1, 3)
rds = np.array([quat_rot(im['quat'], v) for v in dc]); rds /= np.linalg.norm(rds, axis=1, keepdims=True)
lo, hi = sc.extent
with np.errstate(divide='ignore', invalid='ignore'):
    ta = (lo[None] - camp[None]) / rds; tb = (hi[None] - camp[None]) / rds
tmin = np.nanmax(np.minimum(ta, tb), 1).clip(0); tmax = np.nanmin(np.maximum(ta, tb), 1); tmax = np.where(tmax > tmin, tmax, tmin)
step = 0.5 * sc.h; maxs = int(np.max(tmax - tmin) / step) + 2; N = len(rds)
Ts = np.zeros((N, maxs)); Ps = np.zeros((N, maxs, 3)); taus = np.zeros((N, maxs)); tsun = np.zeros((N, maxs)); cnt = np.zeros(N, np.int64)
R.march(sc.sig, sc.ts, sc.o[0], sc.o[1], sc.o[2], sc.h, sc.per, camp, rds, tmin, tmax, step, maxs, Ts, Ps, taus, tsun, cnt)
keep = np.arange(maxs)[None] < cnt[:, None]
ri, si = np.nonzero(keep)
w = Ts[ri, si]; P = Ps[ri, si]; rd = rds[ri]
sub = w > 1e-3; ri, w, P, rd = ri[sub], w[sub], P[sub], rd[sub]
opac = np.bincount(ri, w, N).reshape(H, W)
g = np.frombuffer(base64.b64decode(im['px']), np.float16).astype(np.float32).reshape(H, W, 4)[::-1]
gA = 1 - g[..., 3]
m = (opac > 0.9) & (gA > 0.9)
rows = np.nonzero(m.any(1))[0]
def bands(img): return [round(float(img[b][m[b]].mean()), 3) for b in np.array_split(rows, 5)]
desc = M.load_final(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data/model_final.json'))['desc']
Dirs = M.dir_vectors(desc['dirs'], rd, sc.L)
taps = F.tap_segments(pt.Scene(base * 0.8, sc.h, sc.o, name='b'), P, Dirs, np.array(desc['ends']))
print('pixels', m.sum())
for k, nm in enumerate(desc['dirs']):
    print('ideal %-4s' % nm, bands(np.bincount(ri, w * taps[:, k].sum(1), N).reshape(H, W)), ' game', bands(g[..., k]))
if '--net' in sys.argv:
    ts_ = tsun[np.nonzero(keep)][sub]; tc = taus[np.nonzero(keep)][sub]
    for mp in ['model_final.json', 'model_final-r7.json']:
        net = M.load_final(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data/') + mp)
        def J(tp, tsv=ts_, k=0):
            y = M.predict(net, M.encode(tsv, tc, float(sc.L[1]), rd @ sc.L, tp, desc))
            return bands(np.bincount(ri, w * y[:, k], N).reshape(H, W))
        t2 = taps.copy(); t2[:, 2] *= 0.25
        t3 = taps.copy(); t3[:, 0] *= 1.3; t3[:, 1] *= 1.3
        print(mp, 'J ideal', J(taps), 'fwd x0.25', J(t2), 'up/dn x1.3', J(t3), 'tauSun x0.5', J(taps, ts_ * 0.5))
        print(mp, 'Vsky ideal', J(taps, k=1), 'fwd x0.25', J(t2, k=1))
if '--tau' in sys.argv:
    ts_ = tsun[np.nonzero(keep)][sub]
    print('ideal tauSun', bands(np.bincount(ri, w * np.minimum(ts_, 60), N).reshape(H, W)), ' game', bands(g[..., 0]))
    print('ideal tauCam', bands(np.bincount(ri, w * np.minimum(taus[np.nonzero(keep)][sub], 60), N).reshape(H, W)), ' game', bands(g[..., 1]))
if '--tau2' in sys.argv:
    ts_ = tsun[np.nonzero(keep)][sub]
    Lv = np.asarray(sc.L); acc = np.zeros(len(P)); accB = np.zeros(len(P))
    for k in range(50):
        s = (k + 0.5) * 20.0
        acc += F.local_sigma(sc, P + Lv[None] * s) * 20.0
    bsc = pt.Scene(base * 0.8, sc.h, sc.o, name='b')
    for k in range(50):
        accB += F.local_sigma(bsc, P + Lv[None] * ((k + 0.5) * 20.0)) * 20.0
    B = lambda v: bands(np.bincount(ri, w * np.minimum(v, 60), N).reshape(H, W))
    print('ideal tau 0-1km full', B(acc), ' base*0.8', B(accB), ' beyond', B(ts_ - acc))
    print('game  march', bands(g[..., 0]), ' map', bands(g[..., 1]), ' farflag', bands(g[..., 2]))
if '--flip' in sys.argv:
    print('sun', im['sun'])
    for fl in [(1,1,1), (1,1,-1), (-1,1,1), (-1,1,-1)]:
        Lv = np.asarray(sc.L) * np.array(fl); acc = np.zeros(len(P))
        for k in range(50):
            acc += F.local_sigma(sc, P + Lv[None] * ((k + 0.5) * 20.0)) * 20.0
        print('flip', fl, bands(np.bincount(ri, w * np.minimum(acc, 60), N).reshape(H, W)))
if '--dist' in sys.argv:
    tpos = np.linalg.norm(P - camp[None], axis=1)
    sg = F.local_sigma(sc, P); sb = F.local_sigma(pt.Scene(base, sc.h, sc.o, name='b'), P)
    B = lambda v: bands(np.bincount(ri, w * v, N).reshape(H, W))
    print('ideal dist km', B(tpos * 1e-3), ' full sig*100', B(sg * 100), ' base sig*100', B(sb * 100))
    print('game  dist km', bands(g[..., 0]), ' full', bands(g[..., 1]), ' base', bands(g[..., 2]))
if '--cam' in sys.argv:
    bsc = pt.Scene(base * 0.8, sc.h, sc.o, name='b')
    for nm, D in [('cam(-rd)', -rd), ('fwd', rd)]:
        t = F.tap_segments(bsc, P, D[:, None, :], np.array(desc['ends']))
        print('ideal', nm, bands(np.bincount(ri, w * t[:, 0].sum(1), N).reshape(H, W)))
if '--pt' in sys.argv:
    bsc = pt.Scene(base * 0.8, sc.h, sc.o, name='b')
    B = lambda v: bands(np.bincount(ri, w * v, N).reshape(H, W))
    print('ideal tapsig x100: at P', B(F.local_sigma(bsc, P) * 100), ' up50', B(F.local_sigma(bsc, P + np.array([0, 50.0, 0])) * 100), ' fwd50', B(F.local_sigma(bsc, P + rd * 50) * 100))
    print('game                at P', bands(g[..., 0]), ' up50', bands(g[..., 1]), ' fwd50', bands(g[..., 2]))
