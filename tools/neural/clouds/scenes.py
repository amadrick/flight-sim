"""Cloud volumes for the reference: the game's own exported density fields, LES cumulus with microphysical
extinction, and synthetic test shapes (sphere, slab / deck, cumulus lumps, storm tower with anvil, thin wisps).

Every scene is an extinction grid (1/m) of cubic voxels: sig[i, j, k], i -> x, j -> y (up), k -> z; origin = the
corner of voxel (0,0,0) in metres. Microphysics where the shape comes with liquid water (LES, synthetic cumulus):
    sigma = 3 LWC / (2 rho_w r_e)                       (Q_ext ~ 2; RESEARCH.md 1.5)
    r_e   = (3 LWC / (4 pi rho_w k N))^(1/3), k = 0.8    (RESEARCH.md 1.1, Martin et al. 1994)
with droplet number N (maritime ~70-150 cm^-3, continental ~300-1000 cm^-3).
"""
import json
import math
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
GT_LOCAL = os.path.join(HERE, '..', 'gt_data')
GT_OTHER = '/home/user/wt/neural-clouds2/tools/neural/gt_data'
RHO_W = 1000.0


def _find(name):
    for d in (GT_LOCAL, GT_OTHER):
        p = os.path.join(d, name)
        if os.path.exists(p):
            return p
    raise FileNotFoundError(name)


def sigma_from_lwc(lwc_kgm3, n_cm3=150.0, k=0.8):
    """Extinction (1/m) and effective radius (m) from liquid water content (kg/m^3) and droplet number (cm^-3)."""
    n = n_cm3 * 1e6
    re = np.cbrt(3 * np.maximum(lwc_kgm3, 0) / (4 * math.pi * RHO_W * k * n))
    with np.errstate(divide='ignore', invalid='ignore'):
        sig = np.where(re > 0, 1.5 * lwc_kgm3 / (RHO_W * np.maximum(re, 1e-9)), 0.0)
    return sig.astype(np.float32), re


def resample(a, src_h, dst_h):
    """Trilinear resample of a [x, y, z] grid with voxel sizes src_h = (hx, hy, hz) to cubic voxels dst_h."""
    n_src = np.array(a.shape)
    ext = n_src * np.array(src_h)
    n_dst = np.maximum(1, np.round(ext / dst_h).astype(int))
    out = a
    for ax in range(3):
        xs = (np.arange(n_dst[ax]) + 0.5) * dst_h / src_h[ax] - 0.5
        i0 = np.clip(np.floor(xs).astype(int), 0, n_src[ax] - 1)
        i1 = np.clip(i0 + 1, 0, n_src[ax] - 1)
        f = np.clip(xs - np.floor(xs), 0, 1)
        sh = [1, 1, 1]; sh[ax] = -1
        f = f.reshape(sh)
        out = np.take(out, i0, axis=ax) * (1 - f) + np.take(out, i1, axis=ax) * f
    return out.astype(np.float32)


# --------------------------------------------------------------------------------------------- game fields
def game_field(name, scale=1.0, crop=None):
    """Field exported from the game (src/clouds/harness.js exportDensity): density x the game's sigma(density=1)."""
    z = np.load(_find(name + '.npz'), allow_pickle=False)
    meta = json.loads(str(z['meta']))
    full = z['full'].astype(np.float32) / 255.0             # [x, z, y]
    a = np.ascontiguousarray(full.transpose(0, 2, 1))       # -> [x, y, z]
    dx, dz = meta['dx'], meta['dz']
    if abs(dx - dz) > 0.5:
        a = resample(a, (dx, dz, dx), dx)
    sig = a * meta['sigma'] * scale
    base = None
    if 'base8' in z.files and z['base8'].shape == z['full'].shape and not np.array_equal(z['base8'], z['full']):
        b = np.ascontiguousarray((z['base8'].astype(np.float32) / 255.0).transpose(0, 2, 1))
        if abs(dx - dz) > 0.5:
            b = resample(b, (dx, dz, dx), dx)
        base = b * meta['sigma'] * scale           # the cheap base density the light march (and the taps) sample
    if crop is not None:
        sig = sig[crop]
        base = base[crop] if base is not None else None
    return dict(sig=sig, h=float(dx), origin=(-0.5 * sig.shape[0] * dx, float(meta['base']), -0.5 * sig.shape[2] * dx),
                name=f'{name}@{scale:g}', kind='game', sigma_ref=meta['sigma'] * scale, base=base)


def les_field(case='les_bomex_hr', snap=-1, n_cm3=150.0, h=25.0, sub_adiabatic=1.0):
    z = np.load(_find(case + '.npz'))
    ql = z['ql'][snap].astype(np.float32)                   # [x, y(horizontal), z(up)] kg/kg
    a = np.ascontiguousarray(ql.transpose(0, 2, 1))         # -> [x, up, z]
    rho_air = 1.1
    lwc = a * rho_air * sub_adiabatic
    # trim empty levels
    col = lwc.max(axis=(0, 2))
    j = np.nonzero(col > 1e-6)[0]
    j0, j1 = max(j[0] - 2, 0), min(j[-1] + 3, a.shape[1])
    lwc = lwc[:, j0:j1, :]
    dz = float(z['dz']); dx = float(z['dx'])
    lwc = resample(lwc, (dx, dz, dx), h)
    sig, re = sigma_from_lwc(lwc, n_cm3)
    zb = float(z['z'][j0]) - 0.5 * dz
    return dict(sig=sig, h=h, origin=(-0.5 * sig.shape[0] * h, zb, -0.5 * sig.shape[2] * h),
                name=f'{case}[{snap}]N{n_cm3:g}', kind='les', periodic=True)


# --------------------------------------------------------------------------------------------- noise
def lattice_noise(shape, cell, rng, periodic=False):
    """Smooth value noise on a grid of `shape` voxels with feature size `cell` voxels (cubic interpolation weights)."""
    nc = [int(math.ceil(s / cell)) + 3 for s in shape]
    g = rng.standard_normal(nc).astype(np.float32)
    if periodic:
        pc = [max(1, int(round(s / cell))) for s in shape]
        g = g[:pc[0], :, :pc[2]]
        g = np.concatenate([g, g[:3]], 0)
        g = np.concatenate([g, g[:, :, :3]], 2)
        cellx = shape[0] / pc[0]; cellz = shape[2] / pc[2]
    else:
        cellx = cellz = cell
    cells = (cellx, cell, cellz)
    out = g
    for ax in range(3):
        xs = (np.arange(shape[ax]) + 0.5) / cells[ax] + 1.0
        i = np.floor(xs).astype(int)
        f = xs - i
        f = f * f * (3 - 2 * f)
        sh = [1, 1, 1]; sh[ax] = -1
        f = f.reshape(sh)
        out = np.take(out, i, axis=ax) * (1 - f) + np.take(out, np.minimum(i + 1, out.shape[ax] - 1), axis=ax) * f
    return out


def fbm(shape, cell, rng, octaves=4, periodic=False):
    s = np.zeros(shape, np.float32)
    a, tot = 1.0, 0.0
    for o in range(octaves):
        s += a * lattice_noise(shape, max(cell / 2 ** o, 1.0), rng, periodic)
        tot += a
        a *= 0.5
    return s / math.sqrt(sum(0.25 ** o for o in range(octaves)))


def _coords(shape, h):
    x = (np.arange(shape[0]) + 0.5) * h
    y = (np.arange(shape[1]) + 0.5) * h
    z = (np.arange(shape[2]) + 0.5) * h
    return np.meshgrid(x, y, z, indexing='ij')


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------------------------- synthetic shapes
def sphere(radius=500.0, sigma=0.05, h=20.0, edge=0.1, noise=0.0, seed=0):
    n = int(math.ceil(2.3 * radius / h))
    X, Y, Z = _coords((n, n, n), h)
    c = 0.5 * n * h
    r = np.sqrt((X - c) ** 2 + (Y - c) ** 2 + (Z - c) ** 2) / radius
    if noise > 0:
        r = r - noise * fbm((n, n, n), 0.25 * radius / h, np.random.default_rng(seed), 3)
    sig = sigma * smoothstep(1.0, 1.0 - edge, r)
    return dict(sig=sig.astype(np.float32), h=h, origin=(-c, 1500.0, -c), name=f'sphere{radius:g}s{sigma:g}n{noise:g}',
                kind='sphere')


def deck(thickness=500.0, sigma=0.04, h=20.0, size=2560.0, top_noise=0.25, holes=0.0, seed=0, base=1200.0,
         profile='adiabatic'):
    """Horizontally periodic stratiform deck (stratocumulus / nimbostratus) with a bumpy top and optional holes."""
    rng = np.random.default_rng(seed)
    nx = int(size / h); ny = int(math.ceil(thickness * (1 + 2 * top_noise) / h)) + 4
    X, Y, Z = _coords((nx, ny, nx), h)
    n2 = fbm((nx, 1, nx), 400.0 / h, rng, 4, periodic=True)
    top = thickness * (1 + top_noise * n2)
    hole = fbm((nx, 1, nx), 700.0 / h, rng, 3, periodic=True)
    z = Y - 2 * h
    frac = np.clip(z / np.maximum(top, 1.0), 0, None)
    shape = smoothstep(1.0, 0.92, frac) * smoothstep(0.0, 0.06, frac)
    prof = (0.25 + 0.75 * np.clip(frac, 0, 1) ** (2.0 / 3.0)) if profile == 'adiabatic' else 1.0
    detail = 1.0 + 0.3 * fbm((nx, ny, nx), 60.0 / h, rng, 3, periodic=True)
    sig = sigma * shape * prof * np.clip(detail, 0.2, 2)
    if holes > 0:
        sig *= smoothstep(-holes, -holes + 0.4, hole)
    return dict(sig=sig.astype(np.float32), h=h, origin=(-0.5 * nx * h, base - 2 * h, -0.5 * nx * h),
                name=f'deck{thickness:g}s{sigma:g}h{holes:g}', kind='deck', periodic=True)


def cumulus(height=1200.0, width=1400.0, sigma=0.06, h=20.0, seed=0, lumps=14, billow=0.22, base=1500.0,
            n_cm3=None):
    """Cumulus-like heap: flat base, stacked ellipsoidal lumps shrinking upward, billowy fbm erosion, extinction
    rising with height above base (adiabatic: LWC ~ z, r_e ~ z^(1/3) -> sigma ~ z^(2/3))."""
    rng = np.random.default_rng(seed)
    pad = 6
    nx = int(math.ceil(1.35 * width / h)) + 2 * pad
    ny = int(math.ceil(1.15 * height / h)) + 2 * pad
    X, Y, Z = _coords((nx, ny, nx), h)
    cx = 0.5 * nx * h
    y0 = pad * h
    field = np.full((nx, ny, nx), -1e9, np.float32)
    for i in range(lumps):
        t = rng.random() ** 0.8
        yy = y0 + t * height * 0.75
        rad = width * 0.5 * (1 - 0.6 * t) * (0.45 + 0.35 * rng.random())
        off = (width * 0.5 - rad) * (1 - 0.5 * t)
        a = rng.random() * 2 * math.pi
        px, pz = cx + off * math.cos(a) * rng.random(), cx + off * math.sin(a) * rng.random()
        ry = rad * (0.7 + 0.4 * rng.random())
        d = 1 - np.sqrt(((X - px) / rad) ** 2 + ((Y - yy) / ry) ** 2 + ((Z - pz) / rad) ** 2)
        field = np.maximum(field, d)
    n = fbm((nx, ny, nx), 160.0 / h, rng, 4)
    field = field + billow * (n - 0.3)
    field[Y < y0] = -1.0
    zrel = np.clip((Y - y0) / height, 0, 1)
    prof = 0.2 + 0.8 * zrel ** (2.0 / 3.0)
    sig = sigma * smoothstep(0.0, 0.12, field) * prof
    sig *= smoothstep(y0 - 1e-3, y0 + 2 * h, Y)
    return dict(sig=sig.astype(np.float32), h=h, origin=(-cx, base - y0, -cx), name=f'cumulus{seed}s{sigma:g}',
                kind='cumulus')


def storm(height=7000.0, width=3500.0, sigma=0.12, h=50.0, seed=0, base=900.0):
    """Cumulonimbus-like tower: a broad turreted column with an anvil spreading under the tropopause."""
    rng = np.random.default_rng(seed)
    anvil_w = 2.2 * width
    nx = int(math.ceil(1.1 * anvil_w / h)); ny = int(math.ceil(1.08 * height / h))
    X, Y, Z = _coords((nx, ny, nx), h)
    c = 0.5 * nx * h
    r = np.sqrt((X - c) ** 2 + (Z - c) ** 2)
    zr = Y / height
    col_r = 0.5 * width * (0.85 + 0.3 * zr)
    n = fbm((nx, ny, nx), 500.0 / h, rng, 4)
    col = 1 - r / col_r + 0.25 * n
    anv_r = 0.5 * anvil_w * smoothstep(0.72, 0.95, zr)
    anv = np.minimum(1 - r / np.maximum(anv_r, 1.0), smoothstep(0.7, 0.82, zr) * smoothstep(1.0, 0.94, zr) * 2 - 1) + 0.2 * n
    f = np.maximum(col * smoothstep(1.0, 0.9, zr), anv)
    sig = sigma * smoothstep(0.0, 0.15, f) * (0.35 + 0.65 * smoothstep(0.0, 0.3, zr))
    sig *= np.where(zr > 0.75, 0.45, 1.0)                    # glaciated anvil: lower extinction
    sig[Y < 2 * h] = 0
    return dict(sig=sig.astype(np.float32), h=h, origin=(-c, base, -c), name=f'storm{seed}s{sigma:g}', kind='storm')


def wisp(size=2400.0, thick=400.0, sigma=0.01, h=15.0, seed=0, base=2500.0):
    rng = np.random.default_rng(seed)
    nx = int(size / h); ny = int(thick / h)
    X, Y, Z = _coords((nx, ny, nx), h)
    n = fbm((nx, ny, nx), 300.0 / h, rng, 5)
    yy = (Y - 0.5 * ny * h) / (0.5 * thick)
    env = smoothstep(1.0, 0.3, np.abs(yy))
    c = 0.5 * nx * h
    r = np.sqrt((X - c) ** 2 + (Z - c) ** 2) / (0.5 * size)
    env *= smoothstep(1.0, 0.7, r)
    sig = sigma * smoothstep(0.3, 1.2, n * env + 0.25 * env)
    return dict(sig=sig.astype(np.float32), h=h, origin=(-c, base, -c), name=f'wisp{seed}s{sigma:g}', kind='wisp')


def column_extent(sig, h, oy):
    """Per column (x, z): altitude of the highest and lowest cloudy voxel (nan where the column is clear)."""
    m = sig > 1e-6
    any_ = m.any(axis=1)
    ny = sig.shape[1]
    top_i = ny - 1 - np.argmax(m[:, ::-1, :], axis=1)
    bot_i = np.argmax(m, axis=1)
    top = np.where(any_, oy + (top_i + 1) * h, np.nan)
    bot = np.where(any_, oy + bot_i * h, np.nan)
    return top.astype(np.float32), bot.astype(np.float32)


def blur(a, r_vox):
    """Separable box blur of radius r_vox voxels (zero outside)."""
    r = int(round(r_vox))
    if r <= 0:
        return a.copy()
    out = a.astype(np.float32)
    for ax in range(3):
        c = np.cumsum(np.pad(out, [(r + 1, r) if i == ax else (0, 0) for i in range(3)]), axis=ax)
        hi = np.take(c, np.arange(2 * r + 1, c.shape[ax]), axis=ax)
        lo = np.take(c, np.arange(0, c.shape[ax] - 2 * r - 1), axis=ax)
        out = (hi - lo) / (2 * r + 1)
    return out.astype(np.float32)


def base_emulation(sig, h, blur_m=40.0):
    """Stand-in for the game's cheap base density where a field has none (LES, synthetic): the field without its
    sub-blur_m detail, mass preserving (the exported game fields show base ~ full at large scales: sum ratio 0.7-1.06)."""
    return blur(sig, blur_m / h)


def cumulus_field(size=6000.0, n=7, h=30.0, seed=0, sigma=(0.03, 0.12), base=1400.0):
    """Several cumulus heaps of different size and extinction in one box: cloud-to-cloud shadowing and bounce."""
    rng = np.random.default_rng(seed)
    nx = int(size / h)
    parts = []
    hmax = 0
    for i in range(n):
        H = rng.uniform(500, 2200)
        Wd = H * rng.uniform(0.8, 1.6)
        c = cumulus(height=H, width=Wd, sigma=float(np.exp(rng.uniform(np.log(sigma[0]), np.log(sigma[1])))), h=h,
                    seed=1000 * seed + i, base=base)
        parts.append(c)
        hmax = max(hmax, c['sig'].shape[1])
    grid = np.zeros((nx, hmax, nx), np.float32)
    for c in parts:
        a = c['sig']
        px = rng.integers(0, max(nx - a.shape[0], 1)); pz = rng.integers(0, max(nx - a.shape[2], 1))
        sx, sz = min(a.shape[0], nx - px), min(a.shape[2], nx - pz)
        grid[px:px + sx, :a.shape[1], pz:pz + sz] = np.maximum(grid[px:px + sx, :a.shape[1], pz:pz + sz], a[:sx, :, :sz])
    pad = 6
    return dict(sig=grid, h=h, origin=(-0.5 * nx * h, base - pad * h, -0.5 * nx * h), name=f'cufield{seed}', kind='cufield')
