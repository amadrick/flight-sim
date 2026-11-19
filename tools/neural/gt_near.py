"""Round four: near-field ground truth on a HIGH-RESOLUTION single cloud (lobes and creases resolved).

    OMP_NUM_THREADS=1 nice -n 10 python3 gt_near.py near1 --elev 35 --n 3000 --paths 64
    OMP_NUM_THREADS=1 nice -n 10 python3 gt_near.py near1 --elev 35 --image 160x90 --spp 24     (reference image)

Field: harness export with detail side channels, ~10 m grid, e.g.
    sim.exportDensity({ size: 1600, nxy: 160, find: 0, cx, cz, depth: 1500, edge: 0.01, detail: 1 })
which also stores, per voxel, the two side outputs of clDensityFull the shader's lighting uses: the depth below the
eroded surface (surf, km) and the crease pattern (cav).

Points: cameras a few hundred metres from the cloud; along every ray the samples are drawn with probability
proportional to their weight in the image (transmittance x opacity), i.e. the visible skin of the cloud.
Per point: the game's features
    tauSun (exact, along the sun through the full density), tauUp / tauDn (the march's height formula), cosT,
    mu0  = the march's estimate of cos(surface normal, sun) from two samples of surf along the sun,
    cav, surf
and the path-traced truth Jss + Jms (sun), Vup (sky), Vdn (ground) as in gt_points.py.
Saved to gt_data/near_<field>_<elev>.npz; gt_near_fit.py fits and compares the corrections.
"""
import argparse
import math
import os
import time

import numpy as np

from gt_common import DATA, Field, Sky, sun_dir, box_interval, tonemap, save_png
import gt_trace as gt
import phase as ph
from gt_points import estimate

S1, S2 = 62.5 * 0.17, 62.5 * 0.58          # mean distances of the two detailed light samples of clTauLight (m)


def make_case(elev, cam, yaw, pitch):
    k = np.clip((elev - 2.5) / 60.0, 0, 1) ** 0.5
    E = np.array([1.0, 0.55 + 0.45 * k, 0.25 + 0.75 * k]) * (0.4 + 0.6 * k)
    sky = Sky(np.array([0.02, 0.035, 0.08]) * (1 - k) + np.array([0.045, 0.085, 0.19]) * k,
              np.array([0.10, 0.075, 0.055]) * (1 - k) + np.array([0.13, 0.155, 0.19]) * k, sun_dir(elev), circ=2.0 - 1.4 * k)
    return dict(name='near', L=sun_dir(elev), E=E, sky=sky, cam=np.asarray(cam, float), yaw=yaw, pitch=pitch, fov=60.0, elev=elev)


def cameras(f, n, rng):
    """Cameras in clear air inside the box, 300-700 m from a cloud voxel they look at (first 150 m of the line clear)."""
    ii, jj, kk = np.nonzero(f.full > 0.5)
    out = []
    tries = 0
    while len(out) < n and tries < 20000:
        tries += 1
        q = rng.integers(len(ii))
        tgt = np.array([f.x0 + (ii[q] + 0.5) * f.dx, f.base_alt + (kk[q] + 0.5) * f.dz, f.z0 + (jj[q] + 0.5) * f.dx])
        v = rng.normal(size=3); v[1] *= 0.35; v /= np.linalg.norm(v)
        cam = tgt + v * (300.0 + 400.0 * rng.random())
        e = f.extent
        if not (e[0] + 20 < cam[0] < e[1] - 20 and e[2] - 300 < cam[1] < e[3] - 100 and e[4] + 20 < cam[2] < e[5] - 20):
            continue
        d = (tgt - cam) / np.linalg.norm(tgt - cam)
        line = cam[None] + d[None] * np.linspace(0, 150, 16)[:, None]
        if gt.trilinear(f.full, _vox(f, line) - 0.5).max() > 0.0:
            continue
        out.append((cam, math.degrees(math.atan2(d[2], d[0])), math.degrees(math.asin(d[1]))))
    return out, None


def _vox(f, p):
    return np.stack([(p[:, 0] - f.x0) / f.dx, (p[:, 2] - f.z0) / f.dx, (p[:, 1] - f.base_alt) / f.dz], 1)


def rays(cam, yaw, pitch, W, H, fov=60.0):
    yaw, pitch = math.radians(yaw), math.radians(pitch)
    fwd = np.array([math.cos(pitch) * math.cos(yaw), math.sin(pitch), math.cos(pitch) * math.sin(yaw)])
    right = np.array([-math.sin(yaw), 0.0, math.cos(yaw)])
    up = np.cross(right, fwd)
    th = math.tan(math.radians(fov) / 2)
    ii, jj = np.meshgrid(np.arange(W) + 0.5, np.arange(H) + 0.5)
    sx = (2 * ii.ravel() / W - 1) * th * W / H
    sy = (1 - 2 * jj.ravel() / H) * th
    d = fwd[None] + sx[:, None] * right[None] + sy[:, None] * up[None]
    return d / np.linalg.norm(d, axis=1, keepdims=True)


def visible_samples(f, cam, dirs, rng, per_ray=1, h=3.0):
    """Per ray: `per_ray` points drawn with probability ~ transmittance x opacity along the ray (the lit skin)."""
    t0, t1 = box_interval(cam, dirs, f.extent)
    idx = np.nonzero(t1 > t0)[0]
    pts, pd, pw = [], [], []
    t = t0[idx].copy()
    T = np.ones(idx.size)
    # reservoir sampling of one step per ray, weight w = T (1 - exp(-sig h))
    wsum = np.zeros(idx.size)
    pick = np.full(idx.size, np.nan)
    tend = t1[idx]
    live = np.arange(idx.size)
    while live.size:
        tm = t[live] + h * rng.random(live.size)
        p = cam[None] + dirs[idx[live]] * tm[:, None]
        d = gt.trilinear(f.full, _vox(f, p) - 0.5) * f.sigma
        w = T[live] * (1 - np.exp(-d * h))
        wsum[live] += w
        take = rng.random(live.size) * wsum[live] < w
        pick[live[take]] = tm[take]
        T[live] *= np.exp(-d * h)
        t[live] += h
        live = live[(t[live] < tend[live]) & (T[live] > 0.003)]
    ok = ~np.isnan(pick) & (wsum > 0.05)
    return cam[None] + dirs[idx[ok]] * pick[ok][:, None], dirs[idx[ok]], wsum[ok]


def features(f, tr, p, dirs):
    L = tr.L
    d = gt.trilinear(f.full, _vox(f, p) - 0.5)
    s0 = gt.trilinear(f.surf + 0.1, _vox(f, p) - 0.5) - 0.1          # (zero outside the box -> -0.1)
    s1 = gt.trilinear(f.surf + 0.1, _vox(f, p + L[None] * S1) - 0.5) - 0.1
    s2 = gt.trilinear(f.surf + 0.1, _vox(f, p + L[None] * S2) - 0.5) - 0.1
    g = 500.0 * ((s0 - s1) / S1 + (s0 - s2) / S2)
    mu0 = g / np.sqrt(g * g + 0.5)
    cav = gt.trilinear(f.cav, _vox(f, p) - 0.5)
    a = np.clip(((p[:, 0] - f.x0) / f.dx).astype(int), 0, f.nx - 1)
    b = np.clip(((p[:, 2] - f.z0) / f.dx).astype(int), 0, f.ny - 1)
    top = f.top2d[a, b]
    k = f.sigma * (0.3 + 0.2 * d)
    return dict(d=d, surf=s0, mu0=mu0, g=g, cav=cav, tauSun=tr.ts.lookup(p), tauUp=k * np.maximum(top - p[:, 1], 0),
                tauDn=k * np.maximum(p[:, 1] - f.base_alt, 0), cosT=dirs @ L, h=p[:, 1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('field')
    ap.add_argument('--elev', type=float, default=35.0)
    ap.add_argument('--n', type=int, default=3000)
    ap.add_argument('--paths', type=int, default=64)
    ap.add_argument('--cams', type=int, default=8)
    ap.add_argument('--seed', type=int, default=3)
    ap.add_argument('--image', default='')
    ap.add_argument('--spp', type=int, default=16)
    ap.add_argument('--cam', default='50,2100,-500', help='image mode: camera x,y,z in the box frame (sun at +x)')
    ap.add_argument('--look', default='50,2150,0')
    ap.add_argument('--tag', default='a')
    a = ap.parse_args()
    f = Field(a.field)
    rng = np.random.default_rng(a.seed)
    if a.image:
        W, H = map(int, a.image.split('x'))
        cam = np.array([float(v) for v in a.cam.split(',')])
        dd = np.array([float(v) for v in a.look.split(',')]) - cam
        case = make_case(a.elev, cam, math.degrees(math.atan2(dd[2], dd[0])), math.degrees(math.atan2(dd[1], math.hypot(dd[0], dd[2]))))
        tr = gt.Tracer(f, case)
        dirs = rays(cam, case['yaw'], case['pitch'], W, H)
        t0 = time.time()
        lss, T = tr.single_scatter(dirs, h=4.0)
        acc = np.zeros((W * H, 3))
        for s in range(a.spp):
            tr.walk(dirs, np.arange(W * H), rng, acc)
            print('spp %d  %.0f s' % (s + 1, time.time() - t0), flush=True)
        img = acc / a.spp + np.minimum(lss, 1e9)[:, None] * case['E'][None]
        sky = case['sky'].radiance(np.where(dirs[:, 1:2] > 0, dirs, dirs * [1, 0, 1] + [0, 1e-3, 0]))
        tag = 'near_%s_%g_%s' % (a.field, a.elev, a.tag)
        np.savez(os.path.join(DATA, tag + '_img.npz'), img=img, T=T, W=W, H=H, cam=cam, yaw=case['yaw'], pitch=case['pitch'])
        img = img + T[:, None] * sky                      # sky behind the cloud
        save_png(os.path.join(DATA, tag + '.png'), tonemap(img.reshape(H, W, 3), 0.7 / max(case['E'].max(), 1e-3)))
        return
    cams, c = cameras(f, a.cams, rng)
    per = max(1, a.n // len(cams))
    out = {}
    t0 = time.time()
    for ci, (cam, yaw, pitch) in enumerate(cams):
        case = make_case(a.elev, cam, yaw, pitch)
        tr = gt.Tracer(f, case) if ci == 0 else tr
        tr.c = case
        dirs = rays(cam, yaw, pitch, 96, 54)
        p, pd, pw = visible_samples(f, cam, dirs, rng)
        if len(p) > per:
            sel = rng.choice(len(p), per, replace=False)
            p, pd, pw = p[sel], pd[sel], pw[sel]
        F = features(f, tr, p, pd)
        acc = estimate(tr, p, pd, a.paths, rng)
        F.update(Jss=np.minimum(ph.phase_np(F['cosT']), 20.0) * np.exp(-F['tauSun']), Jms=acc[:, 0], Vup=acc[:, 1], Vdn=acc[:, 2],
                 cam=np.full(len(p), ci), pos=p, w=pw)
        for k, v in F.items():
            out.setdefault(k, []).append(v)
        print('camera %d: %d points, %.0f s' % (ci, len(p), time.time() - t0), flush=True)
    out = {k: np.concatenate(v) for k, v in out.items()}
    np.savez(os.path.join(DATA, 'near_%s_%g.npz' % (a.field, a.elev)), **out, elev=a.elev, sigma=f.sigma, paths=a.paths)
    print('saved', len(out['d']), 'points; mean Jss %.4f Jms %.4f Vup %.3f Vdn %.3f' % (out['Jss'].mean(), out['Jms'].mean(), out['Vup'].mean(), out['Vdn'].mean()))


if __name__ == '__main__':
    main()
