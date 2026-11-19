"""Side-by-side renders: path-traced reference vs the new learned model vs what ships (round-three nets) vs classic.

    NUMBA_NUM_THREADS=2 OMP_NUM_THREADS=2 $VENV tools/neural/clouds/render.py [shot ...] [--res 160x90] [--spp 4]

Every image uses the same camera ray march through the same extinction grid; only the source function differs:
  reference : exact single scattering with the RGB Mie phase (quadrature) + forward-peak term + Monte Carlo J_ms,
              V_sky, V_gnd at K points per pixel drawn ~ T sigma (unbiased estimate of the in-scattered integral)
  new       : same single scattering + forward-peak term + cloudMsLight(descriptor from the shader's taps)
  shipped   : the round-three networks as the game feeds them (height proxies, calibration), JD-fit phase clipped at 20
  classic   : DEFAULT_SCATTER_GLSL with its hand-written ambient
Writes data/renders/<shot>.png (reference | new | shipped | classic, plus an error strip: |model - ref| / ref x 2, so full orange = 50 % error) and <shot>.json (errors).
"""
import json
import math
import os
import sys
import time

import numpy as np
import torch
from numba import njit, prange
import struct
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pt  # noqa: E402
import gen  # noqa: E402
import features as F  # noqa: E402
import baselines as BL  # noqa: E402
import scenes as S  # noqa: E402
import model as M  # noqa: E402

OUT = os.path.join(pt.DATA, 'renders')


def lighting(elev):
    k = np.clip((elev - 2.5) / 60.0, 0, 1) ** 0.5
    E = np.array([1.0, 0.62 + 0.38 * k, 0.32 + 0.68 * k]) * (0.45 + 0.55 * k)
    zen = np.array([0.02, 0.035, 0.08]) * (1 - k) + np.array([0.045, 0.085, 0.19]) * k
    hor = np.array([0.10, 0.075, 0.055]) * (1 - k) + np.array([0.13, 0.155, 0.19]) * k
    sky = 0.5 * (zen + hor)                       # mean radiance of the upper hemisphere (what V_sky multiplies)
    gnd = 0.12 * E * math.sin(math.radians(max(elev, 1))) / math.pi + 0.12 * sky
    return E, sky, gnd, zen, hor


SHOTS = {
    # name: scene builder, kwargs, sun elevation, sun azimuth (deg), camera position, look-at, fov
    'cumulus_noon': ('cumulus', dict(seed=3, sigma=0.075, height=1400.0, width=1500.0), 65.0, 30.0,
                     (-2600.0, 1700.0, -900.0), (0.0, 2150.0, 0.0), 36.0),
    'silver_lining': ('cumulus', dict(seed=3, sigma=0.075, height=1400.0, width=1500.0), 14.0, 0.0,
                      (-3000.0, 1900.0, 150.0), (0.0, 2100.0, 0.0), 36.0),
    'low_sun': ('game', dict(name='near1', scale=1.0), 6.0, 90.0, (2200.0, 1800.0, -1600.0), (0.0, 2050.0, 0.0), 55.0),
    'storm_base': ('storm', dict(seed=1, sigma=0.16, height=8000.0, width=4000.0, h=60.0), 50.0, 40.0,
                   (-9000.0, 300.0, -500.0), (0.0, 3200.0, 0.0), 62.0),
    'thin_wisp': ('wisp', dict(seed=2, sigma=0.012), 55.0, 120.0, (-1500.0, 2200.0, -1400.0), (0.0, 2700.0, 0.0), 60.0),
    # round two: a held-out multi-cloud field (8 cumuli, cloud-to-cloud shadowing and bounce) with a low sun
    'field_low_sun': ('cumulus_field', dict(seed=2, n=8), 8.0, 20.0, (-5600.0, 1900.0, -2600.0), (0.0, 2000.0, 0.0), 62.0),
}


def camera_rays(cam, look, fov, W, H):
    f = np.asarray(look, float) - cam
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 1, 0]); r /= np.linalg.norm(r)
    u = np.cross(r, f)
    t = math.tan(math.radians(fov) / 2)
    xs = ((np.arange(W) + 0.5) / W * 2 - 1) * t
    ys = (1 - (np.arange(H) + 0.5) / H * 2) * t * H / W
    X, Y = np.meshgrid(xs, ys)
    d = f[None, None] + X[..., None] * r[None, None] + Y[..., None] * u[None, None]
    return (d / np.linalg.norm(d, axis=-1, keepdims=True)).reshape(-1, 3)


@njit(parallel=True)
def march(sig, ts, ox, oy, oz, h, per, cam, rds, t0s, t1s, step, maxs, Ts, Ps, taus, tsun, cnt):
    """Per ray: midpoints of the steps (with sigma > 0) and their transmittance-weighted step opacities."""
    for r in prange(rds.shape[0]):
        n = 0
        tau = 0.0
        t = t0s[r]
        while t < t1s[r] and n < maxs:
            dt = min(step, t1s[r] - t)
            tm = t + 0.5 * dt
            x = cam[0] + rds[r, 0] * tm; y = cam[1] + rds[r, 1] * tm; z = cam[2] + rds[r, 2] * tm
            s = sample_grid(sig, ox, oy, oz, h, per, x, y, z)
            if s > 0:
                a = math.exp(-tau) * (1.0 - math.exp(-s * dt))
                Ts[r, n] = a
                Ps[r, n, 0] = x; Ps[r, n, 1] = y; Ps[r, n, 2] = z
                taus[r, n] = tau + 0.5 * s * dt
                tsun[r, n] = sample_grid(ts, ox, oy, oz, h, per, x, y, z)
                n += 1
                tau += s * dt
            t += dt
        cnt[r] = n


sample_grid = pt.sample_grid


def save_png(path, img):
    """Minimal RGB8 PNG writer (the numba venv has no Pillow)."""
    h, w, _ = img.shape
    raw = b''.join(b'\x00' + img[y].tobytes() for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + \
        chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(png)


def render(shot, W=160, H=90, spp=4, nA=48, nB=16, net=None):
    kind, kw, elev, az, cam, look, fov = SHOTS[shot]
    sc = gen.build(kind, kw)
    e, a = math.radians(elev), math.radians(az)
    Ls = np.array([math.cos(e) * math.cos(a), math.sin(e), math.cos(e) * math.sin(a)])
    sc.set_sun(Ls)
    E, sky, gnd, zen, hor = lighting(elev)
    cam = np.asarray(cam, float)
    rds = camera_rays(cam, look, fov, W, H)
    lo, hi = sc.extent
    # ray-box interval
    with np.errstate(divide='ignore', invalid='ignore'):
        ta = (lo[None] - cam[None]) / rds
        tb = (hi[None] - cam[None]) / rds
    tmin = np.nanmax(np.minimum(ta, tb), 1).clip(0)
    tmax = np.nanmin(np.maximum(ta, tb), 1)
    tmax = np.where(tmax > tmin, tmax, tmin)
    step = 0.5 * sc.h
    maxs = int(np.max(tmax - tmin) / step) + 2
    n = len(rds)
    Ts = np.zeros((n, maxs)); Ps = np.zeros((n, maxs, 3)); taus = np.zeros((n, maxs)); tsun = np.zeros((n, maxs))
    cnt = np.zeros(n, np.int64)
    march(sc.sig, sc.ts, sc.o[0], sc.o[1], sc.o[2], sc.h, sc.per, cam, rds, tmin, tmax, step, maxs, Ts, Ps, taus, tsun, cnt)
    keep = np.arange(maxs)[None] < cnt[:, None]
    ri, si = np.nonzero(keep)
    w = Ts[ri, si]
    P = Ps[ri, si]
    rd = rds[ri]
    cos_t = rd @ Ls
    ts_ = tsun[ri, si]
    opac = np.bincount(ri, w, n)
    ph = pt.Phase(10.0, 'G', 4.0)
    z = np.load(os.path.join(pt.DATA, 'mie_tables.npz'))
    i10 = int(np.argmin(np.abs(z['reff'] - 10.0)))
    th = np.arccos(np.clip(cos_t, -1, 1))
    p_rgb = np.stack([np.interp(th, z['theta'], z['P'][i10, b]) for b in range(3)], 1)
    jfp = np.minimum(p_rgb, ph.pc) * (np.exp(-(1 - ph.f) * ts_) - np.exp(-ts_))[:, None]
    ss_rgb = p_rgb * np.exp(-ts_)[:, None]
    acc = lambda vals: np.stack([np.bincount(ri, w * vals[:, c], n) for c in range(3)], 1)
    L_ss = acc(ss_rgb + jfp) * E[None]
    # ---- reference Monte Carlo part: spp points per pixel ~ T sigma
    t0 = time.time()
    rng = np.random.default_rng(5)
    starts = np.concatenate([[0], np.cumsum(cnt)])
    hit = np.nonzero(opac > 1e-3)[0]
    pick_P, pick_D, pick_pix = [], [], []
    for r in hit:
        a0, a1 = starts[r], starts[r + 1]
        ww = w[a0:a1]
        cdf = np.cumsum(ww); cdf /= cdf[-1]
        ks = np.searchsorted(cdf, rng.random(spp))
        for k in ks:
            pp = P[a0 + k] + rds[r] * (rng.random() - 0.5) * step
            pick_P.append(pp); pick_D.append(-rds[r]); pick_pix.append(r)
    pick_P, pick_D, pick_pix = np.array(pick_P), np.array(pick_D), np.array(pick_pix)
    def mc(seed):
        res = pt.estimate(sc, ph, pick_P, pick_D, nA=nA, nB=nB, seed0=seed)
        Sms = res[:, 0:3] * E[None] + res[:, 3:6] * sky[None] + res[:, 6:9] * gnd[None]
        Lm = np.zeros((n, 3))
        for c in range(3):
            Lm[:, c] = np.bincount(pick_pix, Sms[:, c], n) / spp
        return Lm * opac[:, None]
    L_ms = mc(17)
    L_ms2 = mc(18)       # independent second estimate (same points): its difference measures the reference's noise
    t_ref = time.time() - t0
    bg = np.where(rds[:, 1:2] > 0, hor[None] + (zen - hor)[None] * np.clip(rds[:, 1:2], 0, 1) ** 0.5, gnd[None] * 0.6)
    T_tot = 1 - opac
    ref = L_ss + L_ms
    # ---- new model: shader-like descriptor at every step
    out = {}
    if net is not None:
        D = M.descriptor(M.tap_scene(sc, net['desc']), P, rd, Ls, taus[ri, si], ts_, net['desc'])
        y = M.predict(net, D)
        S_new = y[:, 0:1] * E[None] + y[:, 1:2] * sky[None] + y[:, 2:3] * gnd[None]
        out['new'] = L_ss + acc(S_new)
    # ---- shipped / classic
    sig_p = F.local_sigma(sc, P)
    top, bot = S.column_extent(sc.sig, sc.h, sc.o[1])
    ii = np.clip(((P[:, 0] - sc.o[0]) / sc.h).astype(int), 0, sc.sig.shape[0] - 1)
    kk = np.clip(((P[:, 2] - sc.o[2]) / sc.h).astype(int), 0, sc.sig.shape[2] - 1)
    tu, td = BL.height_proxies(sig_p, sc.sigma_ref, top[ii, kk], bot[ii, kk], P[:, 1], None)
    J, vs, vg = BL.shipped(ts_, tu, td, cos_t, math.sin(e), True)
    out['shipped'] = acc(J[:, None] * E[None] + vs[:, None] * sky[None] + vg[:, None] * gnd[None])
    J, vs, vg = BL.classic(ts_, tu, td, cos_t)
    out['classic'] = acc(J[:, None] * E[None] + vs[:, None] * sky[None] + vg[:, None] * gnd[None])
    # ---- metrics (cloud pixels only, radiance-weighted)
    m = opac > 0.02
    stats = {}
    ref2 = L_ss + L_ms2
    den = ref[m].sum(1) + 0.02 * E.sum()
    noise2 = np.average((np.abs(ref2[m] - ref[m]).sum(1) / den) ** 2, weights=opac[m]) / 2   # per-image noise^2 of ref
    stats['_ref_noise_rel'] = float(math.sqrt(noise2))
    for k, img in out.items():
        rel = np.abs(img[m] - ref[m]).sum(1) / den
        r2 = np.average(rel ** 2, weights=opac[m])
        stats[k] = dict(rmse_rel=float(math.sqrt(r2)), rmse_rel_denoised=float(math.sqrt(max(r2 - noise2, 0.0))),
                        brightness_ratio=float(img[m].sum() / ref[m].sum()))
    stats['_ref_mc_seconds'] = t_ref
    # ---- images: composite over the background, tone map with a shared exposure
    comp = lambda img: img + T_tot[:, None] * bg
    lum = (comp(ref)[m] @ np.array([0.2126, 0.7152, 0.0722]))
    expo = 0.18 / max(np.exp(np.mean(np.log(lum + 1e-4))), 1e-4) if m.any() else 1.0
    tm = lambda x: np.clip(1 - np.exp(-x * expo * 1.6), 0, 1) ** (1 / 2.2)
    cols = [('reference', ref)] + [(k, out[k]) for k in ('new', 'shipped', 'classic') if k in out]
    tiles = [tm(comp(img)).reshape(H, W, 3) for _, img in cols]
    errs = [np.zeros((H, W, 3))] + [np.clip(2 * np.abs(img - ref).sum(1) / (ref.sum(1) + 0.02 * E.sum()), 0, 1).reshape(H, W)[..., None] * np.array([1.0, 0.45, 0.1]) for _, img in cols[1:]]
    top_row = np.concatenate(tiles, 1)
    bot_row = np.concatenate(errs, 1) ** 0.5
    imgarr = (np.concatenate([top_row, bot_row], 0) * 255).astype(np.uint8)
    os.makedirs(OUT, exist_ok=True)
    save_png(os.path.join(OUT, shot + '.png'), np.repeat(np.repeat(imgarr, 2, 0), 2, 1))
    json.dump(dict(shot=shot, columns=[c for c, _ in cols], stats=stats, res=[W, H], spp=spp, nA=nA, nB=nB),
              open(os.path.join(OUT, shot + '.json'), 'w'), indent=1)
    print(shot, json.dumps(stats), flush=True)
    return stats


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    W, H = 160, 90
    spp = 4
    for a in sys.argv[1:]:
        if a.startswith('--res='):
            W, H = (int(v) for v in a[6:].split('x'))
        if a.startswith('--spp='):
            spp = int(a[6:])
    net = M.load_final() if os.path.exists(M.FINAL) else None
    for shot in args or list(SHOTS):
        render(shot, W, H, spp, net=net)


if __name__ == '__main__':
    main()
