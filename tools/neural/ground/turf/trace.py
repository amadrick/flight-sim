"""Blade-level Monte Carlo reference for mown turf: the reflectance a patch of grass shows as a function of sun and
view direction, how far the blades are laid over (mowing / rolling) and how tall the sward is.

    OMP_NUM_THREADS=2 NUMBA_NUM_THREADS=2 python3 trace.py turf_dataset.npz [n_tiles=40] [configs_per_tile=700] [rays=2048] [seed=7]

Scene (periodic tile, 0.24 m square): ~25 000 shoots / m^2 in clumps, each a tapered ribbon of two flat segments
(lower part leans by the stand's lay angle plus scatter, the tip droops further), width 2.5-4 mm, height = sward
height x 0.6-1.3, azimuth concentrated around the lay direction (+x) in proportion to the lay amount. Below the blades
a thatch / soil floor (dead blade litter over soil, albedo 0.08-0.20). Blade optics (linear RGB): Lambertian
reflectance r = (0.050, 0.118, 0.032), transmittance t = (0.030, 0.092, 0.018), both faces; a waxy cuticle adds GGX
specular reflection (alpha 0.28, F0 0.045, Schlick) on the side the light comes from.

Light transport: path tracing with next-event estimation toward the sun (shadow rays through the periodic blade field)
and escape to a uniform sky, up to 6 bounces with Russian roulette. Per (sun, view) configuration we shoot `rays`
orthographic primary rays at random points of the tile and record
    BRF_sun = pi * L_sun / cos_s          (radiance per unit sun irradiance, relative to a white Lambertian plate)
    HDRF_sky = L_sky                      (radiance per unit uniform sky radiance; white Lambert = 1)
    tip fraction = share of first hits on the upper third of the blades (the "sheen layer"), for diagnostics.
"""
import sys, time, numpy as np
from numba import njit, prange

TILE = 0.24
R_LEAF = np.array([0.050, 0.118, 0.032]); T_LEAF = np.array([0.030, 0.092, 0.018])
SPEC_A = 0.28; SPEC_F0 = 0.045
NC = 24                                   # grid cells per side (1 cm)


def build_tile(rng, lean, H, density=25000.0):
    """Blade segments as parallelograms: origin P, along U (length), across Wv (full width at the base), taper."""
    n = int(density * TILE * TILE)
    nclump = max(8, n // 14)
    cc = rng.uniform(0, TILE, (nclump, 2))
    segs = []
    lay = np.deg2rad(8 + 62 * lean)                       # mean tilt of the lower segment from vertical
    spread = np.deg2rad(180 * (1 - lean) ** 1.5 + 25)     # azimuth scatter around the lay direction
    for i in range(n):
        c = cc[rng.integers(nclump)]
        base = (c + rng.normal(0, 0.006, 2)) % TILE
        h = H * rng.uniform(0.6, 1.3)
        az = rng.normal(0, spread) if lean > 0.05 else rng.uniform(-np.pi, np.pi)
        t1 = np.clip(lay + rng.normal(0, np.deg2rad(12)), 0, np.deg2rad(80))
        t2 = np.clip(t1 + np.deg2rad(rng.uniform(10, 35)), 0, np.deg2rad(88))
        w = rng.uniform(0.0025, 0.004)
        twist = rng.normal(0, 0.35)
        P = np.array([base[0], base[1], 0.0])
        frac = rng.uniform(0.5, 0.65)
        for k, (tt, L, tap0, tap1) in enumerate(((t1, h * frac, 1.0, 0.75), (t2, h * (1 - frac), 0.75, 0.0))):
            d = np.array([np.sin(tt) * np.cos(az), np.sin(tt) * np.sin(az), np.cos(tt)])
            U = d * L
            a2 = az + np.pi / 2 + twist * (k + 1)
            side = np.array([np.cos(a2), np.sin(a2), 0.0])
            side -= d * np.dot(side, d); side /= np.linalg.norm(side)
            Wv = side * w
            segs.append(np.concatenate([P - Wv * 0.5 * tap0, U, Wv, [tap0, tap1, k, h]]))
            P = P + U
    segs = np.array(segs)
    # floor: thatch fraction map (coarse value noise) folded into a per-cell albedo scale
    floor = rng.uniform(0.0, 1.0, (8, 8))
    return segs, floor


@njit(cache=True)
def seg_hit(o, d, s, tmax):
    # parallelogram-ish quad: point = P + a U + b W (a in [0,1], b in [0,1]) with taper: |b - 0.5| <= 0.5 * taper(a)
    P = s[0:3]; U = s[3:6]; W = s[6:9]
    nx = U[1] * W[2] - U[2] * W[1]; ny = U[2] * W[0] - U[0] * W[2]; nz = U[0] * W[1] - U[1] * W[0]
    den = nx * d[0] + ny * d[1] + nz * d[2]
    if abs(den) < 1e-14:
        return -1.0, 0.0
    t = (nx * (P[0] - o[0]) + ny * (P[1] - o[1]) + nz * (P[2] - o[2])) / den
    if t <= 1e-7 or t >= tmax:
        return -1.0, 0.0
    qx = o[0] + d[0] * t - P[0]; qy = o[1] + d[1] * t - P[1]; qz = o[2] + d[2] * t - P[2]
    uu = U[0] * U[0] + U[1] * U[1] + U[2] * U[2]; ww = W[0] * W[0] + W[1] * W[1] + W[2] * W[2]; uw = U[0] * W[0] + U[1] * W[1] + U[2] * W[2]
    qu = qx * U[0] + qy * U[1] + qz * U[2]; qw = qx * W[0] + qy * W[1] + qz * W[2]
    det = uu * ww - uw * uw
    a = (qu * ww - qw * uw) / det; b = (qw * uu - qu * uw) / det
    if a < 0.0 or a > 1.0:
        return -1.0, 0.0
    tap = s[9] + (s[10] - s[9]) * a
    # W spans the base width; centre at b = 0.5 * s[9] (segment origin is offset by half the base width)
    bc = 0.5 * s[9]
    if abs(b - bc) > 0.5 * tap:
        return -1.0, 0.0
    return t, a


@njit(cache=True)
def trace_first(o, d, segs, cells, cstart, ccount, hmax, tmax0):
    """First hit through the periodic field. Returns (t, seg index or -1 for floor or -2 escape, a)."""
    ox = o[0] % TILE; oy = o[1] % TILE
    # march through 1 cm columns with a 3-D DDA in xy (z handled by bounds)
    cs = TILE / NC
    ix = int(ox / cs); iy = int(oy / cs)
    if ix >= NC: ix = NC - 1
    if iy >= NC: iy = NC - 1
    stx = 1 if d[0] > 0 else -1; sty = 1 if d[1] > 0 else -1
    tdx = cs / abs(d[0]) if abs(d[0]) > 1e-12 else 1e30
    tdy = cs / abs(d[1]) if abs(d[1]) > 1e-12 else 1e30
    nxb = (ix + (1 if stx > 0 else 0)) * cs; nyb = (iy + (1 if sty > 0 else 0)) * cs
    tx = (nxb - ox) / d[0] if abs(d[0]) > 1e-12 else 1e30
    ty = (nyb - oy) / d[1] if abs(d[1]) > 1e-12 else 1e30
    # end of travel: floor (z = 0) or top (z = hmax)
    if d[2] < 0:
        tend = -o[2] / d[2]
    elif d[2] > 0:
        tend = (hmax - o[2]) / d[2]
    else:
        tend = 1e30
    tend = min(tend, tmax0)
    t0 = 0.0
    lo = np.empty(3)
    # unwrapped offset of the current column's tile copy
    offx = o[0] - ox; offy = o[1] - oy
    wx = 0; wy = 0
    while t0 < tend:
        t1 = min(tx, ty, tend)
        c = iy * NC + ix
        best = 1e30; bi = -1; ba = 0.0
        lo[0] = o[0] - (offx + wx * TILE); lo[1] = o[1] - (offy + wy * TILE); lo[2] = o[2]
        for k in range(ccount[c]):
            si = cells[cstart[c] + k, 0]
            lo[0] = o[0] - (offx + wx * TILE) + cells[cstart[c] + k, 1] * TILE
            lo[1] = o[1] - (offy + wy * TILE) + cells[cstart[c] + k, 2] * TILE
            t, a = seg_hit(lo, d, segs[si], t1 + 1e-9)
            if t > 0 and t < best and t >= t0 - 1e-9:
                best = t; bi = si; ba = a
        if bi >= 0:
            return best, bi, ba
        if t1 >= tend:
            break
        t0 = t1
        if tx < ty:
            ix += stx; tx += tdx
            if ix >= NC: ix = 0; wx += 1
            elif ix < 0: ix = NC - 1; wx -= 1
        else:
            iy += sty; ty += tdy
            if iy >= NC: iy = 0; wy += 1
            elif iy < 0: iy = NC - 1; wy -= 1
    if d[2] < 0 and tend < tmax0:
        return tend, -1, 0.0
    return 1e30, -2, 0.0


@njit(cache=True)
def onb(n):
    if abs(n[2]) < 0.9:
        t = np.array([n[1], -n[0], 0.0])
    else:
        t = np.array([0.0, n[2], -n[1]])
    t /= np.sqrt(t[0] ** 2 + t[1] ** 2 + t[2] ** 2)
    b = np.array([n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]])
    return t, b


@njit(cache=True)
def ggx_spec(n, wi, wo):
    # wi, wo on the same side as n (cosines > 0)
    hx = wi[0] + wo[0]; hy = wi[1] + wo[1]; hz = wi[2] + wo[2]
    hl = np.sqrt(hx * hx + hy * hy + hz * hz)
    hx /= hl; hy /= hl; hz /= hl
    nh = n[0] * hx + n[1] * hy + n[2] * hz
    ni = n[0] * wi[0] + n[1] * wi[1] + n[2] * wi[2]; no = n[0] * wo[0] + n[1] * wo[1] + n[2] * wo[2]
    a2 = SPEC_A * SPEC_A
    dd = nh * nh * (a2 - 1) + 1
    D = a2 / (np.pi * dd * dd)
    k = SPEC_A * 0.5
    G = (ni / (ni * (1 - k) + k)) * (no / (no * (1 - k) + k))
    vh = wo[0] * hx + wo[1] * hy + wo[2] * hz
    F = SPEC_F0 + (1 - SPEC_F0) * (1 - vh) ** 5
    return D * G * F / (4 * ni * no + 1e-9)


@njit(cache=True)
def render(segs, cells, cstart, ccount, floor, hmax, sun, view, nray, seed, floorAlb, floorAlb2):
    np.random.seed(seed)
    Ls = np.zeros(3); Lk = np.zeros(3); tips = 0.0
    wo0 = -view  # ray direction
    for r in range(nray):
        o = np.array([np.random.random() * TILE, np.random.random() * TILE, hmax + 1e-6])
        d = wo0.copy()
        thr = np.ones(3)
        for bounce in range(7):
            t, si, a = trace_first(o, d, segs, cells, cstart, ccount, hmax, 1e30)
            if si == -2:
                if bounce > 0:
                    for c in range(3): Lk[c] += thr[c]
                break
            p = o + d * t
            wo = -d
            if si == -1:
                n = np.array([0.0, 0.0, 1.0])
                fx = int((p[0] % TILE) / TILE * 8) % 8; fy = int((p[1] % TILE) / TILE * 8) % 8
                f = floor[fy, fx]
                alb = floorAlb * (1 - f) + floorAlb2 * f
                trn = np.zeros(3)
                spec_on = False
            else:
                s = segs[si]
                U = s[3:6]; W = s[6:9]
                n = np.array([U[1] * W[2] - U[2] * W[1], U[2] * W[0] - U[0] * W[2], U[0] * W[1] - U[1] * W[0]])
                n /= np.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2)
                if n[0] * wo[0] + n[1] * wo[1] + n[2] * wo[2] < 0:
                    n = -n
                alb = R_LEAF; trn = T_LEAF
                spec_on = True
                if bounce == 0:
                    zrel = p[2] / max(s[12], 1e-4)
                    if zrel > 0.67: tips += 1.0
            # next event: sun
            ns = n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]
            if sun[2] > 0:
                o2 = p + n * (1e-6 if ns > 0 else -1e-6)
                t2, s2, a2 = trace_first(o2, sun, segs, cells, cstart, ccount, hmax, 1e30)
                if s2 == -2:
                    if ns > 0:
                        f = abs(ns) / np.pi
                        sp = 0.0
                        if spec_on:
                            sp = ggx_spec(n, sun, wo) * abs(ns)
                        for c in range(3): Ls[c] += thr[c] * (alb[c] * f + sp)
                    else:
                        f = abs(ns) / np.pi
                        for c in range(3): Ls[c] += thr[c] * trn[c] * f
            # continue the path: choose reflection or transmission (cosine-weighted)
            pr = (alb[0] + alb[1] + alb[2]) / 3.0; pt = (trn[0] + trn[1] + trn[2]) / 3.0
            tot = pr + pt
            if tot <= 0: break
            q = min(1.0, tot * 1.6)                     # Russian roulette survival
            if np.random.random() > q: break
            side = 1.0
            if np.random.random() < pt / tot:
                side = -1.0
                for c in range(3): thr[c] *= trn[c] / (pt / tot * q) * (1.0 if pt > 0 else 0.0)
            else:
                for c in range(3): thr[c] *= alb[c] / (pr / tot * q)
            # throughput uses albedo / prob (the cosine pdf cancels the BRDF cosine / pi)
            tb, bb = onb(n)
            u1 = np.random.random(); u2 = np.random.random()
            rr = np.sqrt(u1); ph = 2 * np.pi * u2
            lx = rr * np.cos(ph); ly = rr * np.sin(ph); lz = np.sqrt(max(0.0, 1 - u1))
            nd = (tb * lx + bb * ly + n * lz) * side
            o = p + n * (1e-6 * side)
            d = nd
    return Ls / nray * np.pi, Lk / nray, tips / nray


def grid_segments(segs):
    """Assign segments to 1 cm columns (with periodic copies) by their xy bounding box."""
    cs = TILE / NC
    lists = [[] for _ in range(NC * NC)]
    for i, s in enumerate(segs):
        P, U, W = s[0:3], s[3:6], s[6:9]
        pts = np.array([P, P + U, P + W, P + U + W])
        lo = pts[:, :2].min(0) - 1e-4; hi = pts[:, :2].max(0) + 1e-4
        for gx in range(int(np.floor(lo[0] / cs)), int(np.floor(hi[0] / cs)) + 1):
            for gy in range(int(np.floor(lo[1] / cs)), int(np.floor(hi[1] / cs)) + 1):
                lists[(gy % NC) * NC + (gx % NC)].append((i, gx // NC, gy // NC))
    cstart = np.zeros(NC * NC, np.int64); ccount = np.zeros(NC * NC, np.int64)
    flat = []
    for c, l in enumerate(lists):
        cstart[c] = len(flat); ccount[c] = len(l); flat.extend(l)
    return np.array(flat, np.int64).reshape(-1, 3), cstart, ccount


def main():
    out = sys.argv[1]
    n_tiles = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    per = int(sys.argv[3]) if len(sys.argv) > 3 else 700
    nray = int(sys.argv[4]) if len(sys.argv) > 4 else 2048
    seed = int(sys.argv[5]) if len(sys.argv) > 5 else 7
    rng = np.random.default_rng(seed)
    rows = []
    t0 = time.time()
    for ti in range(n_tiles):
        lean = rng.uniform(0, 1) if ti % 5 else (0.0 if ti % 10 == 0 else 1.0)
        H = rng.uniform(0.025, 0.14)
        segs, floor = build_tile(rng, lean, H)
        # the segment coordinates were built unwrapped from wrapped bases; for the grid we need the
        # tile-local frame, which they are (bases in [0, TILE)); periodic copies handled by the DDA
        cells, cstart, ccount = grid_segments(segs)
        hmax = float((segs[:, 2] + np.maximum(segs[:, 5], 0) + np.abs(segs[:, 8])).max() + 1e-4)
        floorAlb = np.array([0.075, 0.062, 0.042]) * rng.uniform(0.8, 1.2)
        floorAlb2 = np.array([0.20, 0.17, 0.10]) * rng.uniform(0.8, 1.2)
        for k in range(per):
            # sun and view: cosine of the zenith angle spread toward grazing (where the behaviour is richest)
            mus = 0.04 + 0.96 * rng.uniform(0, 1) ** 1.3
            muv = 0.04 + 0.96 * rng.uniform(0, 1) ** 1.5
            phs = rng.uniform(0, np.pi)                    # mirror symmetry y -> -y
            phv = rng.uniform(-np.pi, np.pi)
            ss = np.sqrt(1 - mus * mus); sv = np.sqrt(1 - muv * muv)
            sun = np.array([ss * np.cos(phs), ss * np.sin(phs), mus])
            view = np.array([sv * np.cos(phv), sv * np.sin(phv), muv])
            Ls, Lk, tip = render(segs, cells, cstart, ccount, floor, hmax, sun, view, nray, int(seed * 7919 + ti * 100003 + k), floorAlb, floorAlb2)
            rows.append([ti + 1000 * seed, lean, H, mus, phs, muv, phv, *(Ls / mus), *Lk, tip])
        el = time.time() - t0
        print(f'tile {ti + 1}/{n_tiles} lean {lean:.2f} H {H * 100:.1f} cm blades {len(segs) // 2}  {el:.0f}s  last BRF {rows[-1][7:10]}', flush=True)
        np.savez(out, data=np.array(rows, np.float64), cols=np.array(['tile', 'lean', 'H', 'mus', 'phs', 'muv', 'phv', 'sr', 'sg', 'sb', 'kr', 'kg', 'kb', 'tip']))


if __name__ == '__main__':
    main()
