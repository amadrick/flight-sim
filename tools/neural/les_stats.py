"""Cloud-shape statistics, computed the same way for the LES (les_cumulus.py) and for density fields exported from
the game (gt_data/<name>.npz, see gt_common.Field), so the procedural density model can be fitted to the simulation.

Per cloud (3-D connected component of the cloud mask, periodic horizontally for the LES):
  base / top / depth, maximum equivalent diameter, aspect ratio (depth / diameter)
  width profile: equivalent radius sqrt(A(z) / pi) against the height fraction (z - base) / depth, normalised by the
                 cloud's largest radius  ->  'dome' vs 'column' vs 'anvil-like' widening
  base flatness: spread (std) of the per-column base heights over the lowest 30 % of the cloud's footprint
  lean: slope of the centroid offset with height (m / m), to compare with the wind shear
Whole field:
  cloud-fraction profile, projected cover, footprint size distribution (power-law slope),
  'top roughness' spectrum: horizontal power spectrum of the cloud-top height inside clouds

    python3 les_stats.py les:bomex             (all LES snapshots)
    python3 les_stats.py field:scatteredB      (an exported game field, density > 0.05 = cloud)
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'gt_data')


def label3d(mask, periodic=True):
    """Connected components (6-neighbourhood) by iterative minimum-label propagation. Returns int labels (-1 = none)."""
    n = mask.size
    lab = np.where(mask, np.arange(n).reshape(mask.shape), n)
    big = n
    for _ in range(4000):
        m = lab.copy()
        for ax in range(3):
            for s in (1, -1):
                if ax < 2 and periodic:
                    r = np.roll(lab, s, axis=ax)
                else:
                    r = np.full_like(lab, big)
                    sl_src = [slice(None)] * 3; sl_dst = [slice(None)] * 3
                    if s == 1:
                        sl_dst[ax] = slice(1, None); sl_src[ax] = slice(None, -1)
                    else:
                        sl_dst[ax] = slice(None, -1); sl_src[ax] = slice(1, None)
                    r[tuple(sl_dst)] = lab[tuple(sl_src)]
                m = np.minimum(m, r)
        m = np.where(mask, m, big)
        if np.array_equal(m, lab):
            break
        lab = m
    lab = np.where(mask, lab, -1)
    u, inv = np.unique(lab, return_inverse=True)
    inv = inv.reshape(lab.shape) - (1 if u[0] == -1 else 0)
    return np.where(mask, inv, -1)


def circ_centroid(idx, n):
    a = idx * (2 * np.pi / n)
    return (np.arctan2(np.sin(a).mean(), np.cos(a).mean()) % (2 * np.pi)) * n / (2 * np.pi)


def cloud_stats(mask, dx, dz, z, periodic=True, min_depth=150.0):
    lab = label3d(mask, periodic)
    nx, ny, nz = mask.shape
    clouds = []
    for c in range(lab.max() + 1):
        pts = np.nonzero(lab == c)
        if len(pts[0]) < 4:
            continue
        k0, k1 = pts[2].min(), pts[2].max()
        depth = (k1 - k0 + 1) * dz
        areas = np.bincount(pts[2] - k0, minlength=k1 - k0 + 1) * dx * dx
        rad = np.sqrt(areas / np.pi)
        cd = {'base': z[k0] - 0.5 * dz, 'top': z[k1] + 0.5 * dz, 'depth': depth, 'dmax': 2 * rad.max(),
              'rad': rad.tolist(), 'vol': len(pts[0]) * dx * dx * dz}
        # footprint and per-column base height
        col = {}
        for i, j, k in zip(*pts):
            key = (i, j)
            col[key] = min(col.get(key, 1 << 30), k)
        cb = np.array(list(col.values()))
        cd['foot'] = len(col) * dx * dx
        cd['base_std'] = float(np.std(cb[cb <= k0 + max(2, int(0.3 * (k1 - k0)))]) * dz)
        cd['base_std_all'] = float(np.std(cb) * dz)
        # lean: centroid per level (periodic)
        if depth >= min_depth and k1 - k0 >= 3:
            cx, cy, zz = [], [], []
            for k in range(k0, k1 + 1):
                s = pts[2] == k
                if s.sum() >= 2:
                    cx.append(circ_centroid(pts[0][s], nx) if periodic else pts[0][s].mean())
                    cy.append(circ_centroid(pts[1][s], ny) if periodic else pts[1][s].mean())
                    zz.append(z[k])
            cx = np.unwrap(np.array(cx) * 2 * np.pi / nx) * nx / (2 * np.pi) * dx
            cy = np.unwrap(np.array(cy) * 2 * np.pi / ny) * ny / (2 * np.pi) * dx
            zz = np.array(zz)
            if len(zz) >= 3:
                cd['lean_x'] = float(np.polyfit(zz, cx, 1)[0]); cd['lean_y'] = float(np.polyfit(zz, cy, 1)[0])
        clouds.append(cd)
    return clouds


def width_profile(clouds, min_depth=200.0, nb=10):
    """Mean normalised radius against height fraction, volume weighted, for clouds deeper than min_depth."""
    acc, wts = np.zeros(nb), np.zeros(nb)
    for c in clouds:
        if c['depth'] < min_depth:
            continue
        r = np.array(c['rad']); r = r / r.max()
        h = (np.arange(len(r)) + 0.5) / len(r)
        b = np.minimum((h * nb).astype(int), nb - 1)
        np.add.at(acc, b, r * c['vol'])
        np.add.at(wts, b, c['vol'])
    return acc / np.maximum(wts, 1e-12)


def summary(clouds, mask, dx, dz, z):
    deep = [c for c in clouds if c['depth'] >= 200]
    foot = np.array([c['foot'] for c in clouds])
    d_eq = np.sqrt(4 * foot / np.pi)
    out = {
        'n_clouds': len(clouds), 'n_deep': len(deep),
        'cover': float(np.any(mask, axis=2).mean()),
        'cf_profile': mask.mean(axis=(0, 1)).tolist(),
        'width_profile': width_profile(clouds).tolist(),
        'aspect_median': float(np.median([c['depth'] / c['dmax'] for c in deep])) if deep else None,
        'base_std_median_m': float(np.median([c['base_std'] for c in deep])) if deep else None,
        'base_std_all_median_m': float(np.median([c['base_std_all'] for c in deep])) if deep else None,
        'lean_x_median': float(np.median([c['lean_x'] for c in deep if 'lean_x' in c])) if deep else None,
        'lean_abs_median': float(np.median([np.hypot(c.get('lean_x', 0), c.get('lean_y', 0)) for c in deep])) if deep else None,
        'deq_percentiles_m': np.percentile(d_eq, [10, 50, 90, 99]).tolist() if len(d_eq) else None,
    }
    # size distribution slope n(D) ~ D^-b over the resolved range (D >= 3 dx)
    if len(d_eq) > 8:
        sel = d_eq >= 3 * dx
        if sel.sum() > 5:
            bins = np.geomspace(d_eq[sel].min(), d_eq[sel].max() * 1.001, 8)
            hcount, e = np.histogram(d_eq[sel], bins)
            dens = hcount / np.diff(e)
            ok = hcount > 0
            if ok.sum() >= 3:
                out['size_slope'] = float(np.polyfit(np.log(np.sqrt(e[:-1] * e[1:])[ok]), np.log(dens[ok]), 1)[0])
    # top-height spectrum inside cloudy columns (1-D, averaged over rows): slope of log P vs log k
    cloudy = np.any(mask, axis=2)
    ktop = np.where(cloudy, mask.shape[2] - 1 - np.argmax(mask[:, :, ::-1], axis=2), -1)
    top = np.where(cloudy, z[np.maximum(ktop, 0)], 0.0)
    if cloudy.mean() > 0.02:
        P = np.abs(np.fft.rfft(top - top.mean(), axis=0)) ** 2
        P = P.mean(axis=1)
        k = np.arange(len(P))
        sel = (k >= 2) & (k <= len(P) // 2)
        out['top_spectrum_slope'] = float(np.polyfit(np.log(k[sel]), np.log(P[sel] + 1e-12), 1)[0])
    return out


def les_case(case, thr=1e-5):
    d = np.load(os.path.join(DATA, f'les_{case}.npz'))
    ql, z, dx, dz = d['ql'].astype(np.float32), d['z'], float(d['dx']), float(d['dz'])
    allc, masks, adi = [], [], []
    for s in range(ql.shape[0]):
        m = ql[s] > thr
        cl = cloud_stats(m, dx, dz, z)
        allc += cl; masks.append(m)
        # liquid water against height above the local base, cloud cores (top 10 % ql per level)
        adi.append([float(np.percentile(ql[s][:, :, k][m[:, :, k]], 90)) if m[:, :, k].sum() > 5 else np.nan
                    for k in range(len(z))])
    M = np.concatenate(masks, axis=0)
    out = summary(allc, M, dx, dz, z)
    out['ql90_profile_gkg'] = (np.nanmean(np.array(adi), axis=0) * 1e3).tolist()
    out['z'] = z.tolist()
    du = np.gradient(d['u0'], dz)
    kb = int(np.argmax(M.mean(axis=(0, 1)) > 0.002))
    out['shear_cloud_layer'] = float(du[kb:kb + 20].mean())
    return out, allc


def field_case(name, thr=0.05):
    sys.path.insert(0, HERE)
    from gt_common import Field
    f = Field(name)
    z = f.base_alt + (np.arange(f.nz) + 0.5) * f.dz
    m = f.full > thr
    cl = cloud_stats(m, f.dx, f.dz, z, periodic=False)
    out = summary(cl, m, f.dx, f.dz, z)
    out['z'] = z.tolist()
    return out, cl


def main():
    res = {}
    for arg in sys.argv[1:]:
        kind, _, name = arg.partition(':')
        out, _ = les_case(name) if kind == 'les' else field_case(name)
        res[arg] = out
        short = {k: (np.round(v, 3).tolist() if isinstance(v, list) else v) for k, v in out.items()
                 if k not in ('cf_profile', 'z', 'ql90_profile_gkg')}
        print(arg, json.dumps(short, indent=1))
    os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
    p = os.path.join(HERE, 'results', 'shape_stats.json')
    old = json.load(open(p)) if os.path.exists(p) else {}
    old.update(res)
    json.dump(old, open(p, 'w'), indent=1)


if __name__ == '__main__':
    main()
