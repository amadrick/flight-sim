"""Offline ecosystem simulation on patches of the simulator's own terrain (numpy only).

It simulates what the terrain shader cannot compute per pixel, because every step is non-local:

  insolation      direct sun integrated over the day for a summer and an equinox sun path, with cast shadows
                  (horizon ray-march over the height field) and a sky-view term
  hydrology       priority-flood depression filling, multiple-flow-direction flow accumulation of runoff,
                  topographic wetness, stream power, riparian distance
  regolith        soil production by weathering, depth-dependent creep, landsliding on steep slopes and overland-flow
                  wash, integrated to a quasi-steady soil mantle; rock-fall debris shed by cliffs sliding to its
                  angle of repose (scree aprons and fans)
  snow            winter accumulation by temperature, wind redistribution (scoured spurs, loaded lee hollows),
                  avalanching off steep faces into the gullies, radiation + degree-day melt to a late-summer residue
  vegetation      four competing plant types (grass, shrub, broadleaf, conifer) with logistic growth, light
                  competition, seed dispersal, moisture-limited carrying capacity and disturbance (avalanche tracks,
                  rock fall, floods, fire, wind exposure near the tree line), run to succession

The result (cover fractions) is what src/neural/ground-cover.js learns to predict from per-pixel terrain features.
Climate is anchored to the art direction of the world: summer mean 10 C (tree line) at 2180 m and the summer snow
line near 3080 m at the latitude of Pinecrest, both rising 2 m per km toward the south.

    simulate(H, arid, spec, x0, z0, cell) -> dict of N x N float32 fields
"""
import heapq
import math
import numpy as np

OUT_NAMES = ['forest', 'conifer', 'shrub', 'grass', 'rock', 'scree', 'snow', 'wet', 'soil', 'wash', 'arable', 'sun']
NB = [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0), (1, 1, math.sqrt(2)), (-1, 1, math.sqrt(2)),
      (1, -1, math.sqrt(2)), (-1, -1, math.sqrt(2))]          # (di, dj, distance in cells)


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def nb(a, di, dj):
    """a[j + dj, i + di] with edge clamping."""
    p = np.pad(a, 1, mode='edge')
    n0, n1 = a.shape
    return p[1 + dj:1 + dj + n0, 1 + di:1 + di + n1]


def shifted(a, di, dj):
    """a[j + dj, i + di] for any integer offset, edge clamped."""
    n0, n1 = a.shape
    jj = np.clip(np.arange(n0) + dj, 0, n0 - 1)
    ii = np.clip(np.arange(n1) + di, 0, n1 - 1)
    return a[jj][:, ii]


def scatter(dst, m, di, dj):
    """dst[j + dj, i + di] += m[j, i]  (what leaves the grid is lost)."""
    n0, n1 = m.shape
    js = slice(max(0, -dj), n0 - max(0, dj)); jd = slice(max(0, dj), n0 - max(0, -dj))
    is_ = slice(max(0, -di), n1 - max(0, di)); id_ = slice(max(0, di), n1 - max(0, -di))
    dst[jd, id_] += m[js, is_]


def blur(a, r):
    """Separable box blur of radius r cells applied twice (~ Gaussian, sigma ~ 0.8 r), edge clamped."""
    def box(x, axis):
        n = x.shape[axis]
        pad = [(0, 0), (0, 0)]; pad[axis] = (r + 1, r)
        c = np.cumsum(np.pad(x, pad, mode='edge'), axis=axis, dtype=np.float64)
        hi = np.take(c, np.arange(n) + 2 * r + 1, axis=axis)
        lo = np.take(c, np.arange(n), axis=axis)
        return (hi - lo) / (2 * r + 1)
    for _ in range(2):
        a = box(box(a, 0), 1)
    return a


def downslope_weights(H, cell, p=1.0):
    """Multiple-flow-direction weights to the 8 neighbours (sum 1 where any neighbour is lower, else all 0)."""
    w = np.zeros((8,) + H.shape, np.float64)
    for k, (di, dj, dist) in enumerate(NB):
        drop = (H - nb(H, di, dj)) / (dist * cell)
        w[k] = np.maximum(drop, 0.0) ** p
    tot = w.sum(axis=0)
    w /= np.maximum(tot, 1e-12)
    return w, tot


def move(q, frac, w):
    """Send fraction `frac` of q downslope along weights w. Returns (new q, amount that passed through each cell)."""
    out = q * frac * (w.sum(axis=0) > 0)
    res = q - out
    for k, (di, dj, _) in enumerate(NB):
        scatter(res, out * w[k], di, dj)
    return res, out


def priority_flood(H, outlet, eps=2e-3):
    """Barnes' priority-flood with an epsilon gradient. Returns the filled surface and the pop order (ascending)."""
    n0, n1 = H.shape
    W = n1 + 2
    hp = np.full((n0 + 2, W), 1e30); hp[1:-1, 1:-1] = H
    hl = hp.ravel().tolist()
    inner = np.zeros((n0 + 2, W), bool); inner[1:-1, 1:-1] = True
    seed = np.zeros((n0 + 2, W), bool)
    seed[1, 1:-1] = seed[-2, 1:-1] = seed[1:-1, 1] = seed[1:-1, -2] = True
    seed[1:-1, 1:-1] |= outlet
    closed = bytearray((~inner | seed).ravel().astype(np.uint8))
    heap = [(hl[i], i) for i in np.flatnonzero(seed.ravel()).tolist()]
    heapq.heapify(heap)
    offs = [(1, eps), (-1, eps), (W, eps), (-W, eps), (W + 1, eps * 1.414), (W - 1, eps * 1.414), (-W + 1, eps * 1.414), (-W - 1, eps * 1.414)]
    order = []
    pop, push = heapq.heappop, heapq.heappush
    while heap:
        h, i = pop(heap)
        hl[i] = h
        order.append(i)
        for o, e in offs:
            j = i + o
            if not closed[j]:
                closed[j] = 1
                hj = hl[j]
                if hj < h + e:
                    hj = h + e
                push(heap, (hj, j))
    filled = np.array(hl).reshape(n0 + 2, W)[1:-1, 1:-1]
    return filled, order, W


def flow_accumulation(Hf, order, W, rain, cell, p=1.6):
    """MFD accumulation of `rain` over the filled surface, processed from the highest cell down."""
    n0, n1 = Hf.shape
    w, _ = downslope_weights(Hf, cell, p)
    pad = lambda a: np.pad(a, 1).ravel().tolist()
    acc = pad(rain.astype(np.float64))
    wl = [pad(w[k]) for k in range(8)]
    offs = [di + dj * W for (di, dj, _) in NB]
    w0, w1, w2, w3, w4, w5, w6, w7 = wl
    o0, o1, o2, o3, o4, o5, o6, o7 = offs
    for i in reversed(order):
        a = acc[i]
        x = w0[i]
        if x: acc[i + o0] += a * x
        x = w1[i]
        if x: acc[i + o1] += a * x
        x = w2[i]
        if x: acc[i + o2] += a * x
        x = w3[i]
        if x: acc[i + o3] += a * x
        x = w4[i]
        if x: acc[i + o4] += a * x
        x = w5[i]
        if x: acc[i + o5] += a * x
        x = w6[i]
        if x: acc[i + o6] += a * x
        x = w7[i]
        if x: acc[i + o7] += a * x
    return np.array(acc).reshape(n0 + 2, W)[1:-1, 1:-1]


def sun_dir(hour_angle_deg, decl_deg, lat_deg=34.0):
    """Unit vector toward the sun in world axes (+X east, +Y up, +Z south)."""
    w, d, ph = math.radians(hour_angle_deg), math.radians(decl_deg), math.radians(lat_deg)
    east = -math.cos(d) * math.sin(w)
    north = math.cos(ph) * math.sin(d) - math.sin(ph) * math.cos(d) * math.cos(w)
    up = math.sin(ph) * math.sin(d) + math.cos(ph) * math.cos(d) * math.cos(w)
    return east, up, -north


def insolation(H, nx, ny, nz, cell, decl_deg):
    """Daily direct irradiation on the sloping, shadowed surface relative to an open horizontal surface."""
    steps = [1, 2, 3, 4, 6, 8, 11, 15, 20, 27, 36, 48, 64, 85, 113, 150]
    tot = np.zeros_like(H); flat = 0.0
    for ha in range(-105, 106, 15):
        sx, sy, sz = sun_dir(ha, decl_deg)
        if sy < 0.05:
            continue
        trans = math.exp(-0.16 / sy)
        ch = math.hypot(sx, sz); dx, dz = sx / ch, sz / ch; tan_el = sy / ch
        res = np.ones_like(H)
        for t in steps:
            hs = shifted(H, int(round(dx * t)), int(round(dz * t)))
            clear = (H + t * cell * tan_el - hs) / (t * cell)
            res = np.minimum(res, clear * 10.0 + 0.5)
        shade = np.clip(res, 0.0, 1.0)
        tot += np.maximum(nx * sx + ny * sy + nz * sz, 0.0) * shade * trans
        flat += sy * trans
    return tot / flat


def simulate(H, arid, spec, x0, z0, cell=16.0, seed=0, verbose=False):
    H = H.astype(np.float64); arid = arid.astype(np.float64); spec = spec.astype(np.float64)
    n0, n1 = H.shape
    rng = np.random.default_rng(seed)
    sea = H <= 0.0
    river = spec > 0.3
    playa = np.clip(-spec, 0.0, 1.0)

    # ---- terrain derivatives ------------------------------------------------------------------------------
    gx = (nb(H, 1, 0) - nb(H, -1, 0)) / (2 * cell)
    gz = (nb(H, 0, 1) - nb(H, 0, -1)) / (2 * cell)
    gt = np.hypot(gx, gz)                                        # tan(slope), true
    nl = 1.0 / np.sqrt(1.0 + gt * gt)
    # The alpine range of this world is far steeper than real mountains (median 48 deg, a quarter above 60 deg at
    # 16 m): stability thresholds (angle of repose, landsliding, avalanche release) are applied to a compressed
    # gradient so that its mountainsides carry soil, scree and forest in realistic proportions.
    g = gt / (1.0 + 0.4 * gt)
    nx, ny, nz = -gx * nl, nl, -gz * nl
    c1 = (blur(H, 2) - H) / (2 * cell)                           # local hollow (+) / spur (-), ~60 m
    c2 = (blur(H, 8) - H) / (8 * cell)                           # ~250 m
    c3 = (blur(H, 24) - H) / (24 * cell)                         # ~800 m: valley floor vs ridge

    # ---- climate ------------------------------------------------------------------------------------------
    latk = (z0 + np.arange(n0) * cell)[:, None] * 0.001 + np.zeros((1, n1))
    tropic = ss(35.0, 70.0, latk)
    hk = np.maximum(H, 0.0) * 0.001
    Ts = 24.2 + 0.013 * np.clip(latk + 95.0, -200.0, 200.0) - 6.5 * hk          # summer mean, deg C
    Tw = Ts - 17.0 * (1.0 - 0.65 * tropic)                                      # winter mean
    P = 0.62 * (1.0 - 0.88 * arid) * (1.0 + 0.5 * np.minimum(hk, 3.0)) * (1.0 + 0.5 * tropic)   # m / yr

    ins_s = insolation(H, nx, ny, nz, cell, 23.44)               # midsummer
    ins_e = insolation(H, nx, ny, nz, cell, 0.0)                 # equinox (spring melt, growing season average)
    skyview = np.clip(0.5 * (1.0 + ny) - 1.2 * np.maximum(c2, 0.0) - 1.5 * np.maximum(c3, 0.0), 0.2, 1.0)
    ins = 0.5 * (0.8 * ins_s + 0.2 * skyview) + 0.5 * (0.8 * ins_e + 0.2 * skyview)
    PET = 0.55 * (0.3 + 0.9 * ins) * np.maximum(Ts, 0.0) / 20.0 * (1.0 + 0.6 * arid)
    m_base = P / (P + PET + 1e-6)

    # ---- hydrology ----------------------------------------------------------------------------------------
    Hf, order, W = priority_flood(H, sea | river)
    area = flow_accumulation(Hf, order, W, np.ones_like(H), cell)               # upslope cells
    spi = np.sqrt(area) * np.maximum(g, 0.004)                                  # stream power index
    twi = np.log((area * cell) / np.maximum(g, 0.01))
    wet_topo = ss(8.0, 13.5, twi)
    # riparian: distance to open fresh water (chamfer relaxation)
    dist = np.where(river, 0.0, 1e9)
    for _ in range(40):
        for di, dj, dd in NB:
            dist = np.minimum(dist, nb(dist, di, dj) + dd * cell)
    rb = blur(river.astype(np.float64), 8)
    above = np.where(rb > 1e-3, H - blur(np.where(river, H, 0.0), 8) / np.maximum(rb, 1e-4), 0.0)   # height above the river
    rip = np.exp(-dist / 110.0) * ss(10.0, 2.0, above)

    # ---- snow ---------------------------------------------------------------------------------------------
    wH, _ = downslope_weights(H, cell, 1.3)
    snowfall = 0.6 * P * ss(3.0, -7.0, Tw)
    windward = np.clip(gx, -0.6, 0.6)                                           # prevailing wind from the west
    windfac = np.clip(1.0 + 7.0 * c1 + 6.0 * c2 - 0.9 * windward, 0.2, 3.2)
    S = snowfall * windfac
    aval = np.zeros_like(H)
    inflow = np.zeros_like(H)
    for _ in range(24):
        f = np.clip((g - 0.55) / 0.40, 0.0, 0.9) + 0.6 * np.clip(inflow / (S + 0.05), 0.0, 1.0) * ss(0.2, 0.5, g)
        S2, out = move(S, np.clip(f, 0.0, 0.93), wH)
        inflow = S2 - (S - out)
        S = S2
        aval += out
    S = np.minimum(S, 3.5 * snowfall + 0.3)                                      # avalanche cones are not bottomless
    melt_full = (0.8 * ins_s + 0.6) * np.maximum(Ts + 4.0, 0.0) * 0.125
    resid = np.maximum(S - 0.85 * melt_full, 0.0)                               # what is left in late summer
    snow = ss(0.0, 0.45, resid)
    lsf = np.clip(1.0 - S / (melt_full + 0.02), 0.0, 1.0)                       # snow-free share of the season

    # ---- regolith: soil mantle and rock-fall debris -----------------------------------------------------------
    w1, _ = downslope_weights(H, cell, 1.0)
    soil = np.full_like(H, 0.3)
    debris = np.zeros_like(H)
    dflux = np.zeros_like(H)
    frost = np.exp(-((Ts - 9.0) / 7.0) ** 2)
    f_soil = np.clip(0.03 * g + 0.9 * ss(0.6, 1.1, g) + 0.5 * ss(3.0, 12.0, spi) * (1.0 - 0.5 * ss(0.2, 0.6, m_base)), 0.0, 0.92)
    f_deb = np.clip(0.02 * g + 0.9 * ss(0.62, 0.90, g) + 0.2 * ss(8.0, 22.0, spi), 0.0, 0.92)
    weather = (0.4 + 0.6 * m_base) * ss(-8.0, 4.0, Ts)
    src = 0.05 * ss(0.78, 1.25, g) * (0.35 + 0.65 * frost + 0.3 * arid)
    for it in range(150):
        soil += 0.012 * np.exp(-soil / 0.4) * weather + 0.003 * debris
        debris *= 0.997
        soil, _ = move(soil, f_soil, w1)
        debris += src * np.exp(-soil / 0.15)
        before = debris
        debris, out = move(debris, f_deb, w1)
        if it >= 100:
            dflux += debris - (before - out)                                     # debris arriving per step
    dflux /= 50.0
    # scree shows where debris is deep and either still being fed or not yet buried by soil
    scree = ss(0.10, 0.6, debris) * np.maximum(ss(0.002, 0.02, dflux), 1.0 - ss(0.5, 1.5, soil))
    rock = (1.0 - ss(0.04, 0.30, soil)) * (1.0 - scree)
    wash = ss(5.0, 13.0, spi) * (1.0 - river)

    # ---- soil moisture ----------------------------------------------------------------------------------------
    m = m_base + (1.0 - m_base) * wet_topo * (0.35 + 0.45 * (1.0 - arid))
    m = np.maximum(m, 0.92 * rip)
    m *= 0.45 + 0.55 * ss(0.05, 0.8, soil + 0.3 * debris)
    m = np.clip(m * (1.0 - 0.9 * playa), 0.0, 1.0)

    # ---- vegetation succession ------------------------------------------------------------------------------
    land = (~sea) & (~river)
    expo = np.clip(-(7.0 * c1 + 12.0 * c2 + 8.0 * c3), 0.0, 1.0) * ss(15.0, 9.0, Ts)        # wind-blasted spurs near the tree line
    snowbed = ss(0.25, 0.6, lsf) * (1.0 - snow)
    sdepth = soil + 0.25 * debris
    hold = ss(1.25, 0.8, g)
    suit = {
        'G': ss(1.5, 6.0, Ts) * ss(0.02, 0.25, soil + 0.1 * debris) * snowbed * ss(1.6, 1.0, g),
        'S': ss(4.0, 8.5, Ts) * ss(0.02, 0.22, sdepth) * snowbed * ss(1.5, 0.9, g) * (1.0 - 0.4 * expo),
        'C': ss(8.3, 11.3, Ts) * ss(0.10, 0.45, sdepth) * snowbed * hold * (1.0 - 0.85 * expo)
             * (1.0 - 0.6 * ss(13.0, 19.0, Ts) * ss(0.3, 0.6, m)) * (1.0 - 0.9 * tropic),
        'B': ss(11.0, 15.0, Ts) * ss(0.15, 0.70, sdepth) * snowbed * hold * (1.0 - 0.85 * expo),
    }
    cap = {'G': ss(0.07, 0.30, m), 'S': ss(0.04, 0.30, m) ** 1.3, 'T': ss(0.36, 0.56, m)}
    rate = {'G': 0.8, 'S': 0.35, 'B': 0.22, 'C': 0.18}
    mort = {'G': 0.08, 'S': 0.05, 'B': 0.020, 'C': 0.015}
    d_aval = ss(1.0, 6.0, aval)
    d_rock = ss(0.004, 0.04, dflux)
    fire = 0.05 * (1.0 - m) ** 2 * ss(10.0, 18.0, Ts)
    dist_t = 1.2 * d_aval + 0.8 * d_rock + 1.0 * wash + fire
    dist_s = 0.4 * d_aval + 0.6 * d_rock + 0.8 * wash + 0.6 * fire
    dist_g = 0.05 * d_aval + 0.4 * d_rock + 0.5 * wash
    G = np.full_like(H, 0.02); Sh = np.full_like(H, 0.01); B = np.full_like(H, 0.005); C = np.full_like(H, 0.005)
    for it in range(110):
        T = B + C
        if it % 4 == 0:
            sB, sC, sS, sG = (0.3 * blur(v, 2) + 0.002 for v in (B, C, Sh, G))
        room = np.maximum(cap['T'] - T, 0.0)
        B = B + rate['B'] * suit['B'] * (B + sB) * room - (mort['B'] + dist_t) * B
        C = C + rate['C'] * suit['C'] * (C + sC) * room - (mort['C'] + dist_t) * C
        B = np.clip(B, 0.0, 1.0); C = np.clip(C, 0.0, 1.0)
        T = B + C
        Sh = Sh + rate['S'] * suit['S'] * (Sh + sS) * np.maximum(cap['S'] - T - Sh, 0.0) - (mort['S'] + 0.25 * T + dist_s) * Sh
        Sh = np.clip(Sh, 0.0, 1.0)
        G = G + rate['G'] * suit['G'] * (G + sG) * np.maximum(cap['G'] - 0.95 * T - 0.8 * Sh - G, 0.0) - (mort['G'] + dist_g) * G
        G = np.clip(G, 0.0, 1.0)
    for v in (B, C, Sh, G):
        v *= land
    forest = np.clip(B + C, 0.0, 1.0)
    conifer = C / (B + C + 1e-4)
    arable = ss(0.45, 1.0, soil) * ss(0.09, 0.03, g) * ss(0.22, 0.40, m) * ss(11.0, 15.0, Ts) * (1.0 - wash) * land * (1.0 - playa)

    out = {
        'forest': forest, 'conifer': conifer, 'shrub': Sh, 'grass': G, 'rock': rock, 'scree': scree, 'snow': snow,
        'wet': m, 'soil': ss(0.0, 1.2, soil), 'wash': wash, 'arable': arable, 'sun': np.clip(ins / 1.4, 0.0, 1.0),
    }
    if verbose:
        dbg = {'Ts': Ts, 'area': area, 'spi': spi, 'twi': twi, 'S': S, 'aval': aval, 'soil_m': soil, 'debris': debris, 'g': g, 'ins_s': ins_s}
        out['_dbg'] = dbg
    return {k: (v.astype(np.float32) if k != '_dbg' else v) for k, v in out.items()}
