"""Round seven: the GAME SHADER against the path-traced reference on the identical cloud.

    node tools/shot.mjs --entry src/clouds/harness.js --html dist/clouds.html --out shots/x.png --size 320x180 --frames 24 \
        --params "weather=scattered&tod=15&cy=1500&yaw=200&pitch=4&standoff=1500&clRefL=1&boxS=3000&boxN=200" \
        --eval "$(cat cmp_eval.js)" > cmp.log
    NUMBA_NUM_THREADS=3 $VENV tools/neural/clouds/game_compare.py cmp.log out_prefix [--spp 8]

The harness log holds (a) the linear cloud output of the march + temporal resolve (premultiplied radiance, transmittance)
rendered with reference lighting (clRefL=1: sun irradiance 1, uniform sky radiance clRefS, ground clRefG, no aerial
perspective, no cirrus) and (b) the game's full density exported on a box in front of the camera (harness exportDensity).
The reference renders the box from the same camera with the same lighting: exact single scattering with the tabulated Mie
phase + forward peak, Monte Carlo for every higher order (pt.py). Writes <prefix>.png (game | reference | ratio) and
<prefix>.json (luminance statistics on the pixels both see as cloud).
"""
import base64
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pt  # noqa: E402
import scenes as S  # noqa: E402
import render as R  # noqa: E402


def load(log):
    for line in open(log):
        if line.startswith('eval: '):
            v = json.loads(line[6:])
            return json.loads(v) if isinstance(v, str) else v
    raise SystemExit('no eval line in ' + log)


def quat_rot(q, v):
    x, y, z, w = q
    u = np.array([x, y, z])
    return v + 2.0 * np.cross(u, np.cross(u, v) + w * v)


def main():
    log, prefix = sys.argv[1], sys.argv[2]
    spp = int(next((a.split('=')[1] for a in sys.argv if a.startswith('--spp=')), 8))
    sky = float(next((a.split('=')[1] for a in sys.argv if a.startswith('--sky=')), 0.06))
    gnd = float(next((a.split('=')[1] for a in sys.argv if a.startswith('--gnd=')), 0.025))
    d = load(log)
    im, f = d['img'], d['field']
    W, H = im['w'], im['h']
    game = np.frombuffer(base64.b64decode(im['px']), np.float32).reshape(H, W, 4)[::-1].copy()
    # field: slices k (altitude) of rows (z) x cols (x) -> [x, y, z]
    n, nz = f['nx'], f['nz']
    full = np.frombuffer(base64.b64decode(f['full']), np.uint8).reshape(nz, n, n).astype(np.float32) / 255.0
    a = np.ascontiguousarray(full.transpose(2, 0, 1))
    dx, dz = f['dx'], f['dz']
    if abs(dx - dz) > 0.5:
        a = S.resample(a, (dx, dz, dx), dx)
    sig = a * f['sigma']
    cam = np.array(im['camAir'], float)
    origin = (f['x0'] - cam[0], f['base'], f['z0'] - cam[2])
    sc = pt.Scene(sig, dx, origin, name='game')
    sc.set_sun(np.array(im['sun'], float))
    camp = np.array([0.0, cam[1], 0.0])
    # camera rays (three.js camera looks along -z of its quaternion)
    t = math.tan(math.radians(im['fov']) / 2)
    xs = ((np.arange(W) + 0.5) / W * 2 - 1) * t * im['aspect']
    ys = (1 - (np.arange(H) + 0.5) / H * 2) * t
    X, Y = np.meshgrid(xs, ys)
    dc = np.stack([X, Y, -np.ones_like(X)], -1).reshape(-1, 3)
    rds = np.array([quat_rot(im['quat'], v) for v in dc])
    rds /= np.linalg.norm(rds, axis=1, keepdims=True)
    lo, hi = sc.extent
    with np.errstate(divide='ignore', invalid='ignore'):
        ta = (lo[None] - camp[None]) / rds
        tb = (hi[None] - camp[None]) / rds
    tmin = np.nanmax(np.minimum(ta, tb), 1).clip(0)
    tmax = np.nanmin(np.maximum(ta, tb), 1)
    tmax = np.where(tmax > tmin, tmax, tmin)
    step = 0.5 * sc.h
    maxs = int(np.max(tmax - tmin) / step) + 2
    N = len(rds)
    Ts = np.zeros((N, maxs)); Ps = np.zeros((N, maxs, 3)); taus = np.zeros((N, maxs)); tsun = np.zeros((N, maxs))
    cnt = np.zeros(N, np.int64)
    R.march(sc.sig, sc.ts, sc.o[0], sc.o[1], sc.o[2], sc.h, sc.per, camp, rds, tmin, tmax, step, maxs, Ts, Ps, taus, tsun, cnt)
    keep = np.arange(maxs)[None] < cnt[:, None]
    ri, si = np.nonzero(keep)
    w = Ts[ri, si]; P = Ps[ri, si]; rd = rds[ri]
    L = sc.L
    cos_t = rd @ L
    ts_ = tsun[ri, si]
    opac = np.bincount(ri, w, N)
    ph = pt.Phase(10.0, 'G', 4.0)
    z = np.load(os.path.join(pt.DATA, 'mie_tables.npz'))
    i10 = int(np.argmin(np.abs(z['reff'] - 10.0)))
    th = np.arccos(np.clip(cos_t, -1, 1))
    p_rgb = np.stack([np.interp(th, z['theta'], z['P'][i10, b]) for b in range(3)], 1)
    jfp = np.minimum(p_rgb, ph.pc) * (np.exp(-(1 - ph.f) * ts_) - np.exp(-ts_))[:, None]
    ss = p_rgb * np.exp(-ts_)[:, None] + jfp
    L_ss = np.stack([np.bincount(ri, w * ss[:, c], N) for c in range(3)], 1)
    rng = np.random.default_rng(5)
    starts = np.concatenate([[0], np.cumsum(cnt)])
    hit = np.nonzero(opac > 1e-3)[0]
    pP, pD, pix = [], [], []
    for r in hit:
        a0, a1 = starts[r], starts[r + 1]
        cdf = np.cumsum(w[a0:a1]); cdf /= cdf[-1]
        for k in np.searchsorted(cdf, rng.random(spp)):
            pP.append(P[a0 + k] + rds[r] * (rng.random() - 0.5) * step); pD.append(-rds[r]); pix.append(r)
    pP, pD, pix = np.array(pP), np.array(pD), np.array(pix)
    res = pt.estimate(sc, ph, pP, pD, nA=48, nB=16, seed0=17)
    Sms = res[:, 0:3] + res[:, 3:6] * sky + res[:, 6:9] * gnd
    L_ms = np.stack([np.bincount(pix, Sms[:, c], N) / spp for c in range(3)], 1) * opac[:, None]
    ref = (L_ss + L_ms).reshape(H, W, 3)
    opac = opac.reshape(H, W)
    gL = game[..., :3]; gA = 1 - game[..., 3]
    lum = lambda c: c @ np.array([0.2126, 0.7152, 0.0722])
    m = (opac > 0.9) & (gA > 0.9)
    gl, rl = lum(gL)[m], lum(ref)[m]
    q = [5, 25, 50, 75, 95, 99]
    st = dict(pixels=int(m.sum()), game_pct=np.percentile(gl, q).round(4).tolist(), ref_pct=np.percentile(rl, q).round(4).tolist(),
              game_mean=float(gl.mean()), ref_mean=float(rl.mean()),
              game_p95_p5=float(np.percentile(gl, 95) / max(np.percentile(gl, 5), 1e-6)),
              ref_p95_p5=float(np.percentile(rl, 95) / max(np.percentile(rl, 5), 1e-6)),
              rel_rmse=float(np.sqrt(np.mean((gl - rl) ** 2)) / rl.mean()),
              log_rmse=float(np.sqrt(np.mean(np.log((gl + 0.01) / (rl + 0.01)) ** 2))),
              corr=float(np.corrcoef(gl, rl)[0, 1]))
    # edge pixels: partially opaque in the reference
    e = (opac > 0.1) & (opac < 0.7) & (gA > 0.05)
    if e.any():
        st['edge_pixels'] = int(e.sum())
        st['edge_game_mean'] = float((lum(gL)[e] / np.maximum(gA[e], 1e-3)).mean())
        st['edge_ref_mean'] = float((lum(ref)[e] / np.maximum(opac[e], 1e-3)).mean())
    st['opacity_mean_game'] = float(gA[opac > 0.02].mean()); st['opacity_mean_ref'] = float(opac[opac > 0.02].mean())
    # rows from top to bottom of the cloud: mean luminance per band of the mask's vertical extent (top/base contrast)
    rows = np.nonzero(m.any(1))[0]
    if len(rows) > 4:
        bands = np.array_split(rows, 5)
        st['bands_game'] = [float(lum(gL)[b][m[b]].mean()) for b in bands]
        st['bands_ref'] = [float(lum(ref)[b][m[b]].mean()) for b in bands]
    print(json.dumps(st, indent=1))
    json.dump(st, open(prefix + '.json', 'w'), indent=1)
    # image: game | reference | log2 ratio (blue = game darker, red = game brighter), common exposure on the ref median
    k = 0.5 / max(np.median(rl), 1e-4)
    bg = np.array([0.35, 0.5, 0.75])
    tm = lambda c, a: np.clip((1 - np.exp(-(c + bg * 0.18 / k * (1 - a[..., None])) * k)) ** (1 / 2.2), 0, 1)
    A = tm(gL, gA); B = tm(ref, opac)
    rr = np.log2((lum(gL) + 0.003) / (lum(ref) + 0.003))
    C = np.zeros((H, W, 3))
    C[..., 0] = np.clip(rr, 0, 2) / 2; C[..., 2] = np.clip(-rr, 0, 2) / 2; C[..., 1] = 0.15 * ((opac > 0.02) | (gA > 0.02))
    img = (np.concatenate([A, B, C], 1) * 255).astype(np.uint8)
    R.save_png(prefix + '.png', img)


if __name__ == '__main__':
    main()
