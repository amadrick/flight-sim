"""Plant-level Monte Carlo reference for field crops and long grass: the reflectance a patch of a crop canopy shows
as a function of sun and view direction relative to the drill rows, for cereals (young to ripe), maize, oilseed rape
(in leaf and in flower), stubble and long meadow grass. Extends tools/neural/ground/turf/trace.py (mown turf) to the
canopies the airfield turf net does not cover.

    OMP_NUM_THREADS=1 NUMBA_NUM_THREADS=1 python3 trace.py out.npz [n_tiles=48] [configs_per_tile=220] [rays=1536] [seed=1]
    python3 trace.py --presets presets.json        # build the runtime presets and print their measured features

Scene: a periodic tile, x across the rows (a whole number of row spacings), y along them. Every plant is built from
tapered flat ribbons (parallelograms whose width runs from tap0 to tap1 along their length): stems, arching leaves,
ears / heads, rape flowers (small flat petals) and straw. Optics per material (linear RGB, Lambertian reflection and
transmission on both faces, plus a GGX cuticle sheen on green leaves) blend from green to senescent with the tile's
senescence. Below the plants: soil of a random albedo with straw / litter patches.

Light transport as in the turf tracer: path tracing with next-event estimation toward the sun through the periodic
field, escape to a uniform sky, up to 6 bounces with Russian roulette. Per (sun, view) configuration we record
    BRF_sun = pi * L_sun / cos_s    (relative to a white Lambertian plate)
    HDRF_sky = L_sky                (per unit uniform sky radiance)
The canopy is described to the network only by numbers measured on the built tile, so the shader can give the same
numbers for its crop classes: height, nadir cover, row contrast (how much the cover varies across the rows), leaf
angle (area-weighted |n_z| of the plant surfaces), senescence, visible flower share and soil luminance.
"""
import sys, time, json, numpy as np
from numba import njit

# materials: 0 green leaf, 1 stem, 2 ear / seed head, 3 rape flower, 4 straw (dead stem / leaf)
R_GREEN = np.array([[0.050, 0.118, 0.032], [0.060, 0.120, 0.040], [0.075, 0.130, 0.045], [0.430, 0.360, 0.030], [0.300, 0.245, 0.120]])
T_GREEN = np.array([[0.030, 0.092, 0.018], [0.015, 0.040, 0.010], [0.030, 0.070, 0.015], [0.160, 0.120, 0.005], [0.110, 0.080, 0.025]])
R_SEN = np.array([[0.230, 0.200, 0.095], [0.290, 0.240, 0.120], [0.330, 0.260, 0.125], [0.430, 0.360, 0.030], [0.300, 0.245, 0.120]])
T_SEN = np.array([[0.090, 0.070, 0.020], [0.080, 0.060, 0.020], [0.080, 0.060, 0.020], [0.160, 0.120, 0.005], [0.110, 0.080, 0.025]])
SPEC_A = 0.30; SPEC_F0 = 0.045
STRAW = np.array([0.300, 0.250, 0.140])
CELL = 0.02                     # grid column size (m)


# ---------------------------------------------------------------------------------------------------------------
# geometry
def ribbon(segs, P, az, incl, lens, w0, w1, mat, twist=0.0):
    """Chain of flat segments from P: inclinations from vertical (rad) and lengths per segment, width w0 -> w1."""
    P = np.array(P, float)
    n = len(incl)
    tot = sum(lens)
    acc = 0.0
    for k in range(n):
        tt, L = incl[k], lens[k]
        d = np.array([np.sin(tt) * np.cos(az), np.sin(tt) * np.sin(az), np.cos(tt)])
        U = d * L
        a2 = az + np.pi / 2 + twist * (k + 1)
        side = np.array([np.cos(a2), np.sin(a2), 0.0])
        side -= d * np.dot(side, d)
        nn = np.linalg.norm(side)
        side = side / nn if nn > 1e-9 else np.array([1.0, 0.0, 0.0])
        ta = 1.0 + (w1 / w0 - 1.0) * acc / tot
        tb = 1.0 + (w1 / w0 - 1.0) * (acc + L) / tot
        Wv = side * w0
        segs.append(np.concatenate([P - Wv * 0.5 * ta, U, Wv, [ta, tb, mat, 0.0]]))
        P = P + U
        acc += L
    return P


def build(rng, kind, H, rs, dens, sen, extra):
    """kind: 0 cereal, 1 maize, 2 rape, 3 meadow, 4 stubble. Returns segs, TX, TY."""
    segs = []
    if kind == 3:
        TX = TY = 0.30
    else:
        k = max(1, int(np.ceil(0.24 / rs)))
        TX = rs * k
        TY = 0.32 if kind != 1 else 0.48
    nrow = int(round(TX / rs)) if kind != 3 else 0
    area = TX * TY
    G = lambda s: rng.normal(0, s)
    if kind == 0:                    # cereal: wheat / barley from tillering to ripe
        n = int(dens * area)
        for i in range(n):
            x = (rng.integers(nrow) + 0.5) * rs + G(0.010); y = rng.uniform(0, TY)
            h = H * rng.uniform(0.82, 1.08)
            az0 = rng.uniform(-np.pi, np.pi)
            tilt = abs(G(np.deg2rad(5 + 10 * sen)))
            young = H < 0.28
            if not young:
                top = ribbon(segs, [x, y, 0.0], az0, [tilt, tilt * 1.3], [h * 0.55, h * 0.37], 0.0045, 0.0035, 1)
                nl = 3 + int(rng.integers(2))
                for l in range(nl):
                    z = h * (0.12 + 0.6 * l / nl + 0.08 * rng.random())
                    L = min(0.10 + 0.14 * rng.random(), 0.5 * h + 0.06)
                    az = rng.uniform(-np.pi, np.pi)
                    dr = np.deg2rad(rng.uniform(0, 20)) + sen * 0.5
                    p0 = [x + np.sin(tilt) * np.cos(az0) * z, y + np.sin(tilt) * np.sin(az0) * z, z]
                    ribbon(segs, p0, az, [np.deg2rad(25) + dr, np.deg2rad(50) + dr, np.deg2rad(78) + dr], [L * 0.35, L * 0.35, L * 0.3], 0.011, 0.002, 4 if rng.random() < sen * 0.7 else 0, G(0.3))
                if extra > 0.5:     # ear (droops as it ripens)
                    ribbon(segs, top, az0, [tilt + np.deg2rad(5 + 50 * sen * rng.random())], [0.075], 0.013, 0.008, 2)
            else:
                nl = 3 + int(rng.integers(3))
                for l in range(nl):
                    L = h * rng.uniform(0.7, 1.25)
                    az = rng.uniform(-np.pi, np.pi)
                    ribbon(segs, [x + G(0.004), y + G(0.004), 0.0], az, [np.deg2rad(rng.uniform(10, 30)), np.deg2rad(rng.uniform(40, 70))], [L * 0.6, L * 0.4], 0.008, 0.002, 0, G(0.3))
    elif kind == 1:                  # maize
        sp = 1.0 / max(dens * rs, 1e-3)
        for r in range(nrow):
            for j in range(int(np.ceil(TY / sp))):
                x = (r + 0.5) * rs + G(0.02); y = (j + 0.5) * sp + G(0.03)
                h = H * rng.uniform(0.9, 1.05)
                ribbon(segs, [x, y, 0.0], 0.0, [abs(G(0.04))], [h], 0.024, 0.016, 1 if sen < 0.6 else 4)
                nl = int(4 + 8 * min(h / 2.0, 1.0))
                for l in range(nl):
                    z = h * (0.08 + 0.78 * l / nl)
                    L = (0.35 + 0.5 * min(h / 2.0, 1.0)) * rng.uniform(0.75, 1.05) * (1.0 - 0.4 * (l / nl) ** 2)
                    az = (np.pi / 2 if l % 2 else -np.pi / 2) + G(0.5)
                    ribbon(segs, [x, y, z], az, [np.deg2rad(30), np.deg2rad(55), np.deg2rad(80), np.deg2rad(110)], [L * 0.25] * 4, 0.075, 0.01, 4 if rng.random() < sen * 0.8 else 0, G(0.2))
                if extra > 0.5 and h > 1.4:
                    for b in range(5):
                        ribbon(segs, [x, y, h], rng.uniform(-np.pi, np.pi), [np.deg2rad(rng.uniform(10, 40))], [0.2], 0.006, 0.003, 2)
    elif kind == 2:                  # oilseed rape: leafy rosette -> tall branched stems with flowers on top
        n = int(dens * area)
        for i in range(n):
            x = (rng.integers(nrow) + 0.5) * rs + G(0.02); y = rng.uniform(0, TY)
            h = H * rng.uniform(0.85, 1.1)
            for l in range(5):
                L = min(0.10 + 0.12 * rng.random(), 0.6 * h + 0.05)
                ribbon(segs, [x, y, 0.02 + 0.25 * h * rng.random()], rng.uniform(-np.pi, np.pi), [np.deg2rad(45), np.deg2rad(75)], [L * 0.5, L * 0.5], 0.05, 0.015, 0)
            if h > 0.35:
                top = ribbon(segs, [x, y, 0.0], 0.0, [abs(G(0.08))], [h * 0.6], 0.008, 0.006, 1)
                for b in range(4):
                    az = rng.uniform(-np.pi, np.pi)
                    tip = ribbon(segs, top, az, [np.deg2rad(rng.uniform(15, 40))], [h * 0.4], 0.005, 0.004, 1)
                    if extra > 0.0:
                        for f in range(int(4 + 10 * extra)):
                            c = tip + np.array([G(0.025), G(0.025), G(0.03)])
                            ribbon(segs, c, rng.uniform(-np.pi, np.pi), [np.deg2rad(rng.uniform(50, 90))], [0.014], 0.014, 0.012, 3)
    elif kind == 3:                  # long meadow grass with seed heads and herbs
        n = int(dens * area)
        lay = np.deg2rad(rng.uniform(5, 25))
        for i in range(n):
            x, y = rng.uniform(0, TX), rng.uniform(0, TY)
            h = H * rng.uniform(0.45, 1.15)
            az = rng.uniform(-np.pi, np.pi)
            t1 = abs(lay + G(np.deg2rad(12))); t2 = min(t1 + np.deg2rad(rng.uniform(15, 50)), np.deg2rad(95))
            mat = 4 if rng.random() < 0.15 + 0.6 * sen else 0
            ribbon(segs, [x, y, 0.0], az, [t1, t2], [h * 0.6, h * 0.4], rng.uniform(0.003, 0.006), 0.0005, mat, G(0.35))
        for i in range(int(n * 0.06 * extra)):
            x, y = rng.uniform(0, TX), rng.uniform(0, TY)
            h = H * rng.uniform(1.0, 1.35)
            top = ribbon(segs, [x, y, 0.0], rng.uniform(-np.pi, np.pi), [abs(G(0.15))], [h], 0.002, 0.0015, 1 if sen < 0.5 else 4)
            ribbon(segs, top, rng.uniform(-np.pi, np.pi), [abs(G(0.3))], [0.05], 0.007, 0.003, 2)
        for i in range(int(area * 25)):      # herbs: flat leaves near the ground (clover, plantain, dandelion)
            x, y = rng.uniform(0, TX), rng.uniform(0, TY)
            for l in range(4):
                ribbon(segs, [x, y, H * 0.15 * rng.random()], rng.uniform(-np.pi, np.pi), [np.deg2rad(rng.uniform(60, 85))], [0.06], 0.03, 0.01, 0)
    else:                            # stubble: cut straw in rows, a few green weeds
        n = int(dens * area)
        for i in range(n):
            x = (rng.integers(nrow) + 0.5) * rs + G(0.012); y = rng.uniform(0, TY)
            ribbon(segs, [x, y, 0.0], rng.uniform(-np.pi, np.pi), [abs(G(np.deg2rad(12)))], [H * rng.uniform(0.6, 1.1)], 0.0045, 0.0042, 4)
        for i in range(int(area * 60 * extra)):
            x, y = rng.uniform(0, TX), rng.uniform(0, TY)
            ribbon(segs, [x, y, 0.0], rng.uniform(-np.pi, np.pi), [np.deg2rad(50), np.deg2rad(80)], [0.03, 0.03], 0.02, 0.008, 0)
    return np.array(segs), TX, TY


# ---------------------------------------------------------------------------------------------------------------
# tracing (periodic TX x TY tile, columns of CELL)
@njit(cache=True)
def seg_hit(o, d, s, tmax):
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
    if abs(b - 0.5 * s[9]) > 0.5 * tap:
        return -1.0, 0.0
    return t, a


@njit(cache=True)
def trace_first(o, d, segs, cells, cstart, ccount, hmax, TX, TY, NX, NY):
    ox = o[0] % TX; oy = o[1] % TY
    csx = TX / NX; csy = TY / NY
    ix = min(int(ox / csx), NX - 1); iy = min(int(oy / csy), NY - 1)
    stx = 1 if d[0] > 0 else -1; sty = 1 if d[1] > 0 else -1
    tdx = csx / abs(d[0]) if abs(d[0]) > 1e-12 else 1e30
    tdy = csy / abs(d[1]) if abs(d[1]) > 1e-12 else 1e30
    nxb = (ix + (1 if stx > 0 else 0)) * csx; nyb = (iy + (1 if sty > 0 else 0)) * csy
    tx = (nxb - ox) / d[0] if abs(d[0]) > 1e-12 else 1e30
    ty = (nyb - oy) / d[1] if abs(d[1]) > 1e-12 else 1e30
    if d[2] < 0:
        tend = -o[2] / d[2]
    elif d[2] > 0:
        tend = (hmax - o[2]) / d[2]
    else:
        tend = 1e30
    t0 = 0.0
    lo = np.empty(3)
    offx = o[0] - ox; offy = o[1] - oy
    wx = 0; wy = 0
    while t0 < tend:
        t1 = min(tx, ty, tend)
        c = iy * NX + ix
        best = 1e30; bi = -1; ba = 0.0
        lo[2] = o[2]
        for k in range(ccount[c]):
            si = cells[cstart[c] + k, 0]
            lo[0] = o[0] - (offx + wx * TX) + cells[cstart[c] + k, 1] * TX
            lo[1] = o[1] - (offy + wy * TY) + cells[cstart[c] + k, 2] * TY
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
            if ix >= NX: ix = 0; wx += 1
            elif ix < 0: ix = NX - 1; wx -= 1
        else:
            iy += sty; ty += tdy
            if iy >= NY: iy = 0; wy += 1
            elif iy < 0: iy = NY - 1; wy -= 1
    if d[2] < 0:
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
def render(segs, cells, cstart, ccount, floor, hmax, TX, TY, NX, NY, sun, view, nray, seed, Rm, Tm, soil, straw):
    np.random.seed(seed)
    Ls = np.zeros(3); Lk = np.zeros(3)
    wo0 = -view
    for r in range(nray):
        o = np.array([np.random.random() * TX, np.random.random() * TY, hmax + 1e-6])
        d = wo0.copy()
        thr = np.ones(3)
        for bounce in range(7):
            t, si, a = trace_first(o, d, segs, cells, cstart, ccount, hmax, TX, TY, NX, NY)
            if si == -2:
                if bounce > 0:
                    for c in range(3): Lk[c] += thr[c]
                break
            p = o + d * t
            wo = -d
            if si == -1:
                n = np.array([0.0, 0.0, 1.0])
                fx = int((p[0] % TX) / TX * 8) % 8; fy = int((p[1] % TY) / TY * 8) % 8
                f = floor[fy, fx]
                alb = soil * (1 - f) + straw * f
                trn = np.zeros(3)
                spec_on = False
            else:
                s = segs[si]
                U = s[3:6]; W = s[6:9]
                n = np.array([U[1] * W[2] - U[2] * W[1], U[2] * W[0] - U[0] * W[2], U[0] * W[1] - U[1] * W[0]])
                n /= np.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2)
                if n[0] * wo[0] + n[1] * wo[1] + n[2] * wo[2] < 0:
                    n = -n
                m = int(s[11])
                alb = Rm[m]; trn = Tm[m]
                spec_on = m == 0 or m == 1
            ns = n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]
            if sun[2] > 0:
                o2 = p + n * (1e-6 if ns > 0 else -1e-6)
                t2, s2, a2 = trace_first(o2, sun, segs, cells, cstart, ccount, hmax, TX, TY, NX, NY)
                if s2 == -2:
                    f = abs(ns) / np.pi
                    if ns > 0:
                        sp = 0.0
                        if spec_on:
                            sp = ggx_spec(n, sun, wo) * abs(ns)
                        for c in range(3): Ls[c] += thr[c] * (alb[c] * f + sp)
                    else:
                        for c in range(3): Ls[c] += thr[c] * trn[c] * f
            pr = (alb[0] + alb[1] + alb[2]) / 3.0; pt = (trn[0] + trn[1] + trn[2]) / 3.0
            tot = pr + pt
            if tot <= 0: break
            q = min(1.0, tot * 1.6)
            if np.random.random() > q: break
            side = 1.0
            if np.random.random() < pt / tot:
                side = -1.0
                for c in range(3): thr[c] *= trn[c] / (pt / tot * q)
            else:
                for c in range(3): thr[c] *= alb[c] / (pr / tot * q)
            tb, bb = onb(n)
            u1 = np.random.random(); u2 = np.random.random()
            rr = np.sqrt(u1); ph = 2 * np.pi * u2
            lx = rr * np.cos(ph); ly = rr * np.sin(ph); lz = np.sqrt(max(0.0, 1 - u1))
            nd = (tb * lx + bb * ly + n * lz) * side
            o = p + n * (1e-6 * side)
            d = nd
    return Ls / nray * np.pi, Lk / nray


@njit(cache=True)
def nadir_profile(segs, cells, cstart, ccount, hmax, TX, TY, NX, NY, nray, seed, rs, Rm):
    """Nadir hits: cover, cover per 8 bins across the rows, visible flower share."""
    np.random.seed(seed)
    prof = np.zeros(8); cnt = np.zeros(8); fl = 0.0; hit = 0.0
    d = np.array([1e-4, 1e-4, -1.0]); d /= np.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2)
    for r in range(nray):
        o = np.array([np.random.random() * TX, np.random.random() * TY, hmax + 1e-6])
        t, si, a = trace_first(o, d, segs, cells, cstart, ccount, hmax, TX, TY, NX, NY)
        b = int((o[0] % rs) / rs * 8) % 8
        cnt[b] += 1
        if si >= 0:
            hit += 1; prof[b] += 1
            if int(segs[si, 11]) == 3: fl += 1
    return hit / nray, prof / np.maximum(cnt, 1), fl / nray


def grid_segments(segs, TX, TY, NX, NY):
    csx, csy = TX / NX, TY / NY
    lists = [[] for _ in range(NX * NY)]
    for i, s in enumerate(segs):
        P, U, W = s[0:3], s[3:6], s[6:9]
        pts = np.array([P, P + U, P + W, P + U + W])
        lo = pts[:, :2].min(0) - 1e-4; hi = pts[:, :2].max(0) + 1e-4
        for gx in range(int(np.floor(lo[0] / csx)), int(np.floor(hi[0] / csx)) + 1):
            for gy in range(int(np.floor(lo[1] / csy)), int(np.floor(hi[1] / csy)) + 1):
                lists[(gy % NY) * NX + (gx % NX)].append((i, gx // NX, gy // NY))
    cstart = np.zeros(NX * NY, np.int64); ccount = np.zeros(NX * NY, np.int64)
    flat = []
    for c, l in enumerate(lists):
        cstart[c] = len(flat); ccount[c] = len(l); flat.extend(l)
    return np.array(flat, np.int64).reshape(-1, 3), cstart, ccount


def prepare(rng, kind, H, rs, dens, sen, extra, soilLum, litter):
    segs, TX, TY = build(rng, kind, H, rs, dens, sen, extra)
    NX, NY = max(4, int(round(TX / CELL))), max(4, int(round(TY / CELL)))
    cells, cstart, ccount = grid_segments(segs, TX, TY, NX, NY)
    hmax = float((segs[:, 2] + np.maximum(segs[:, 5], 0) + np.abs(segs[:, 8])).max() + 1e-3)
    Rm = R_GREEN * (1 - sen) + R_SEN * sen
    Tm = T_GREEN * (1 - sen) + T_SEN * sen
    soil = np.array([1.18, 1.0, 0.74]) * soilLum
    floor = np.clip(rng.uniform(0, 1, (8, 8)) * 2 * litter, 0, 1)
    rsm = rs if kind != 3 else TX
    fc, prof, fl = nadir_profile(segs, cells, cstart, ccount, hmax, TX, TY, NX, NY, 4096, 11, rsm, Rm)
    # leaf angle: area-weighted |n_z| (1 = flat leaves facing up, 0 = vertical stems)
    nrm = np.cross(segs[:, 3:6], segs[:, 6:9]); ar = np.linalg.norm(nrm, axis=1) * 0.5 * (segs[:, 9] + segs[:, 10])
    ala = float(np.sum(np.abs(nrm[:, 2]) / np.maximum(np.linalg.norm(nrm, axis=1), 1e-12) * ar) / max(ar.sum(), 1e-12))
    rowC = float(prof.max() - prof.min()) if kind != 3 else 0.0
    feat = dict(H=H, fc=float(fc), rowC=rowC, ala=ala, sen=sen, flower=float(fl), soil=soilLum)
    return dict(segs=segs, TX=TX, TY=TY, NX=NX, NY=NY, cells=cells, cstart=cstart, ccount=ccount, hmax=hmax, Rm=Rm, Tm=Tm, soil=soil, floor=floor, feat=feat)


def sample_tile(rng, ti):
    kind = [0, 0, 0, 1, 2, 3, 3, 4][ti % 8]
    if kind == 0:
        H = float(np.exp(rng.uniform(np.log(0.08), np.log(1.05)))); rs = rng.uniform(0.11, 0.18); dens = rng.uniform(250, 750)
        sen = float(np.clip(rng.uniform(-0.3, 1.0) if H > 0.5 else rng.uniform(-0.5, 0.25), 0, 1)); extra = float(H > 0.5 and rng.random() < 0.85)
    elif kind == 1:
        H = float(np.exp(rng.uniform(np.log(0.25), np.log(2.6)))); rs = rng.uniform(0.70, 0.80); dens = rng.uniform(7, 10)
        sen = float(np.clip(rng.uniform(-0.6, 0.8), 0, 1)); extra = 1.0
    elif kind == 2:
        H = float(np.exp(rng.uniform(np.log(0.15), np.log(1.5)))); rs = rng.uniform(0.15, 0.30); dens = rng.uniform(35, 80)
        sen = float(np.clip(rng.uniform(-0.6, 0.6), 0, 1)); extra = float(rng.uniform(0, 1) if H > 0.5 else 0.0)
    elif kind == 3:
        H = float(np.exp(rng.uniform(np.log(0.12), np.log(0.75)))); rs = 0.3; dens = rng.uniform(2500, 9000)
        sen = float(np.clip(rng.uniform(-0.3, 0.9), 0, 1)); extra = rng.uniform(0.3, 1.0)
    else:
        H = rng.uniform(0.06, 0.22); rs = rng.uniform(0.11, 0.18); dens = rng.uniform(250, 600)
        sen = 1.0; extra = rng.uniform(0, 1)
    soilLum = float(np.exp(rng.uniform(np.log(0.05), np.log(0.24))))
    litter = rng.uniform(0.0, 0.6) if kind != 4 else rng.uniform(0.3, 0.8)
    return kind, H, rs, dens, sen, extra, soilLum, litter


# runtime presets (the shader's crop classes); kind, H, rs, dens, sen, extra, soil, litter
PRESETS = {
    'cereal_young':  (0, 0.12, 0.125, 500, 0.0, 0.0, 0.12, 0.2),
    'cereal_green':  (0, 0.70, 0.125, 550, 0.05, 1.0, 0.11, 0.2),
    'cereal_ripe':   (0, 0.85, 0.125, 500, 0.95, 1.0, 0.13, 0.3),
    'stubble':       (4, 0.14, 0.125, 450, 1.0, 0.4, 0.14, 0.6),
    'maize':         (1, 2.20, 0.75, 9, 0.05, 1.0, 0.11, 0.1),
    'rape_flower':   (2, 1.20, 0.20, 60, 0.0, 1.0, 0.11, 0.1),
    'meadow_long':   (3, 0.45, 0.30, 5000, 0.25, 0.8, 0.10, 0.3),
    'maize_young':   (1, 0.45, 0.75, 9, 0.0, 0.0, 0.13, 0.1),
}


def main():
    if sys.argv[1] == '--presets':
        out = {}
        for k, (kind, H, rs, dens, sen, extra, soil, lit) in PRESETS.items():
            T = prepare(np.random.default_rng(100 + len(out)), kind, H, rs, dens, sen, extra, soil, lit)
            out[k] = T['feat']
            print(k, json.dumps(T['feat']), len(T['segs']), 'segs', flush=True)
        json.dump(out, open(sys.argv[2], 'w'), indent=1)
        return
    if sys.argv[1] == '--noise':
        # Monte Carlo noise of one sample: the same configurations rendered twice with independent rays
        rng = np.random.default_rng(77); nray = int(sys.argv[3]) if len(sys.argv) > 3 else 1536
        a, b = [], []
        for ti in range(8):
            T = prepare(rng, *sample_tile(rng, ti))
            for k in range(12):
                mus = 0.06 + 0.94 * rng.uniform(0, 1) ** 1.2; muv = 0.05 + 0.95 * rng.uniform(0, 1) ** 1.4
                phs = rng.uniform(0, np.pi / 2); phv = rng.uniform(-np.pi, np.pi)
                sn = np.sqrt(1 - mus * mus); sv = np.sqrt(1 - muv * muv)
                sun = np.array([sn * np.sin(phs), sn * np.cos(phs), mus]); view = np.array([sv * np.sin(phv), sv * np.cos(phv), muv])
                for lst, sd in ((a, 1), (b, 2)):
                    Ls, Lk = render(T['segs'], T['cells'], T['cstart'], T['ccount'], T['floor'], T['hmax'], T['TX'], T['TY'], T['NX'], T['NY'],
                                    sun, view, nray, 1000 * ti + 10 * k + sd, T['Rm'], T['Tm'], T['soil'], STRAW)
                    lst.append(np.concatenate([Ls / mus, Lk]))
        a, b = np.maximum(np.array(a), 1e-4), np.maximum(np.array(b), 1e-4)
        lum = np.array([0.2126, 0.7152, 0.0722])
        r = dict(configs=len(a), rays=nray, ln_rmse_sun=float(np.sqrt(np.mean((np.log(a[:, :3]) - np.log(b[:, :3])) ** 2) / 2)),
                 ln_rmse_sky=float(np.sqrt(np.mean((np.log(a[:, 3:]) - np.log(b[:, 3:])) ** 2) / 2)),
                 rel_lum_sun=float(np.sqrt(np.mean(((a[:, :3] - b[:, :3]) @ lum / (b[:, :3] @ lum)) ** 2) / 2)))
        print(json.dumps(r)); json.dump(r, open(sys.argv[2], 'w'))
        return
    out = sys.argv[1]
    n_tiles = int(sys.argv[2]) if len(sys.argv) > 2 else 48
    per = int(sys.argv[3]) if len(sys.argv) > 3 else 220
    nray = int(sys.argv[4]) if len(sys.argv) > 4 else 1536
    seed = int(sys.argv[5]) if len(sys.argv) > 5 else 1
    rng = np.random.default_rng(seed)
    rows = []
    t0 = time.time()
    for ti in range(n_tiles):
        kind, H, rs, dens, sen, extra, soilLum, litter = sample_tile(rng, ti + seed)
        T = prepare(rng, kind, H, rs, dens, sen, extra, soilLum, litter)
        f = T['feat']
        for k in range(per):
            mus = 0.06 + 0.94 * rng.uniform(0, 1) ** 1.2
            muv = 0.05 + 0.95 * rng.uniform(0, 1) ** 1.4
            phs = rng.uniform(0, np.pi / 2)              # sun azimuth from the row direction (two mirror symmetries)
            phv = rng.uniform(-np.pi, np.pi)
            sn = np.sqrt(1 - mus * mus); sv = np.sqrt(1 - muv * muv)
            # rows run along +y: azimuth measured from +y toward +x
            sun = np.array([sn * np.sin(phs), sn * np.cos(phs), mus])
            view = np.array([sv * np.sin(phv), sv * np.cos(phv), muv])
            Ls, Lk = render(T['segs'], T['cells'], T['cstart'], T['ccount'], T['floor'], T['hmax'], T['TX'], T['TY'], T['NX'], T['NY'],
                            sun, view, nray, int(seed * 7919 + ti * 100003 + k), T['Rm'], T['Tm'], T['soil'], STRAW)
            rows.append([ti + 1000 * seed, kind, f['H'], f['fc'], f['rowC'], f['ala'], f['sen'], f['flower'], f['soil'], mus, phs, muv, phv, *(Ls / mus), *Lk])
        el = time.time() - t0
        print(f'tile {ti + 1}/{n_tiles} kind {kind} H {H:.2f} fc {f["fc"]:.2f} rowC {f["rowC"]:.2f} ala {f["ala"]:.2f} sen {sen:.2f} fl {f["flower"]:.2f} segs {len(T["segs"])} {el:.0f}s last {np.round(rows[-1][13:19], 3)}', flush=True)
        np.savez(out, data=np.array(rows, np.float64), cols=np.array(['tile', 'kind', 'H', 'fc', 'rowC', 'ala', 'sen', 'flower', 'soil', 'mus', 'phs', 'muv', 'phv', 'sr', 'sg', 'sb', 'kr', 'kg', 'kb']))


if __name__ == '__main__':
    main()
