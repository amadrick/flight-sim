"""Monte Carlo radiative transfer through forest stands built from Skyward's procedural tree species (numpy only).

A stand is a horizontally periodic tile (8 x 8 placement cells of 6.5 m, the browser's tree grid) in which every cell
holds a tree with probability `cover`; a tree is a conifer with probability `conifer`.  Each tree's crown envelope
(species.py) is voxelised (0.5 m voxels) into a field of leaf-area density with an outer-shell profile and
multiplicative clumping noise.  Foliage is a turbid medium of bi-Lambertian leaves with a spherical leaf-angle
distribution (Ross-Nilson): extinction sigma = G * LAD with G = 1/2, area scattering phase function

    Gamma(beta) = rho / (3 pi^2) (sin b - b cos b) + tau / (3 pi^2) (sin b + (pi - b) cos b),    cos b = Omega'.Omega

The forest floor is Lambertian (species.FLOOR).  Above the stand: vacuum with the sun.

Two things are measured:

1. The stand's bidirectional reflectance factor for direct sunlight, BRF = pi L / (E cos theta_s), RGB, for many
   (view direction, sun elevation) pairs, by adjoint path tracing from the viewer: rays enter at the top, fly by
   ray marching (0.3 m steps, jittered; tau accumulated exactly per step), scatter by sampling a leaf normal with
   probability ~ |d.n| and reflecting / transmitting cosine-distributed, and at every leaf / floor vertex do
   next-event estimation to each sun with the transmittance read from a precomputed *shadow volume*.  All orders
   of scattering up to MAX_BOUNCE (5) are included; floor bounce included.  Also recorded per view: the fraction
   of primary rays that reach the floor (gap fraction) and the mean sun transmittance at the first leaf hit
   (sunlit fraction of the visible foliage).

2. Light transfer inside individual crowns: at sample points inside crowns, the sun transmittance (all neighbours
   and the crown itself) and the cosine-weighted sky visibility, with the point's crown-relative coordinates.

Shadow volumes: for a light direction with elevation e and azimuth a, T(x, y, z) = T(x + dz cot e cos a, ..., z + dz)
* exp(-sigma dz / sin e), swept down from the top with bilinear periodic shifts.  The sun azimuth is fixed (+x);
stands are statistically isotropic, so the view azimuth relative to +x is the relative azimuth.
"""
import math
import numpy as np

from species import SPECIES, MIX, LEAF, FLOOR, CELL, crown_radius

DX = 0.5            # voxel size (m)
NCELL = 8           # placement cells per tile side
NX = int(round(NCELL * CELL / DX))   # 104
LT = NX * DX        # tile size (m)
STEP = 0.3          # ray-march step (m)
MAX_BOUNCE = 5
GROUPS = ('broad', 'conifer')


# ------------------------------------------------------------------------------------------------- stands
def tree_height(rng, sp, conif):
    """Height distribution as in the browser placement (src/terrain/veg/placement): hash-driven size in a range."""
    lo, hi = SPECIES[sp]['h']
    u = rng.random()
    return lo + (hi - lo) * (u * u * 0.5 + u * 0.5)


def blur3(a):
    """Cheap periodic 3x3x3 box blur (twice) for correlated clumping noise."""
    for _ in range(2):
        a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0)) / 3.0
        a = (a + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 3.0
        a = (a + np.roll(a, 1, 2) + np.roll(a, -1, 2)) / 3.0
    return a


def make_stand(rng, cover, conifer):
    """Returns dict(sigma (NX,NX,NZ) 1/m, group (NX,NX,NZ) int8 (0 broad / 1 conifer), trees [..], ztop)."""
    trees = []
    for ci in range(NCELL):
        for cj in range(NCELL):
            if rng.random() >= cover:
                continue
            conif = rng.random() < conifer
            names, w = zip(*MIX['conifer' if conif else 'broad'])
            sp = names[rng.choice(len(names), p=np.array(w) / sum(w))]
            H = tree_height(rng, sp, conif)
            x = (ci + 0.12 + 0.76 * rng.random()) * CELL
            y = (cj + 0.12 + 0.76 * rng.random()) * CELL
            trees.append(dict(sp=sp, H=H, x=x, y=y, wide=0.82 + 0.40 * rng.random(), g=1 if conif else 0))
    hmax = max([t['H'] for t in trees], default=4.0)
    NZ = int(math.ceil((hmax + 1.0) / DX))
    lad = np.zeros((NX, NX, NZ), np.float32)
    grp = np.zeros((NX, NX, NZ), np.int8)
    owner = -np.ones((NX, NX, NZ), np.int32)
    noise = np.exp(0.75 * blur3(rng.standard_normal((NX, NX, NZ)).astype(np.float32)) * 2.2)
    noise /= noise.mean()
    noise = np.clip(noise, 0.0, 2.5)
    zc = (np.arange(NZ) + 0.5) * DX
    for ti, t in enumerate(trees):
        sp = SPECIES[t['sp']]
        H = t['H']
        R = sp['rad'] * H * t['wide']
        z0, z1 = sp['base'] * H, H
        nr = int(math.ceil(R / DX)) + 1
        ix = np.arange(int(t['x'] / DX) - nr, int(t['x'] / DX) + nr + 1)
        iy = np.arange(int(t['y'] / DX) - nr, int(t['y'] / DX) + nr + 1)
        iz = np.arange(max(int(z0 / DX), 0), min(int(z1 / DX) + 1, NZ))
        X, Y, Z = np.meshgrid((ix + 0.5) * DX - t['x'], (iy + 0.5) * DX - t['y'], zc[iz], indexing='ij')
        tc = (Z - z0) / (z1 - z0)
        rr = crown_radius(sp, tc) * H * t['wide']
        rn = np.sqrt(X * X + Y * Y) / np.maximum(rr, 1e-3)
        inside = (rn < 1.0) & (tc >= 0.0) & (tc <= 1.0)
        prof = (1.0 - sp['shell']) + 2.0 * sp['shell'] * rn * rn
        val = np.where(inside, sp['lad'] * prof, 0.0).astype(np.float32)
        I, J, K = np.meshgrid(ix % NX, iy % NX, iz, indexing='ij')
        cur = lad[I, J, K]
        take = val > cur * 0.5
        lad[I, J, K] = cur + val
        grp[I[take], J[take], K[take]] = t['g']
        owner[I[take], J[take], K[take]] = ti
    lad *= noise
    return dict(sigma=(0.5 * lad).astype(np.float32), group=grp, owner=owner, trees=trees, NZ=NZ, ztop=NZ * DX)


# ------------------------------------------------------------------------------------------------- shadow volumes
def shift_bilinear(a, sx, sy):
    """Periodic shift of a 2D array: out(x, y) = a(x + sx, y + sy) (sx, sy in voxels, fractional)."""
    fx, fy = math.floor(sx), math.floor(sy)
    tx, ty = sx - fx, sy - fy
    a0 = np.roll(a, (-fx, -fy), (0, 1))
    a1 = np.roll(a0, -1, 0)
    b0 = a0 * (1 - tx) + a1 * tx
    b1 = np.roll(b0, -1, 1)
    return b0 * (1 - ty) + b1 * ty


def shadow_volume(sigma, elev, azim=0.0):
    """Transmittance toward a light at elevation elev (rad), azimuth azim (rad, from +x toward +y) at voxel centres.
    Stored at voxel centres; each layer's own half thickness is included."""
    NZ = sigma.shape[2]
    se, ce = math.sin(elev), math.cos(elev)
    cot = ce / se
    sx, sy = cot * math.cos(azim), cot * math.sin(azim)      # horizontal offset per voxel of height (in voxels)
    T = np.empty_like(sigma)
    tau_above = np.zeros(sigma.shape[:2], np.float32)        # optical depth from the top of layer k to the sun
    for k in range(NZ - 1, -1, -1):
        s = sigma[:, :, k]
        # centre of layer k: half of its own thickness along the slant path (shifted half a layer)
        sh = shift_bilinear(s, 0.5 * sx, 0.5 * sy)
        T[:, :, k] = np.exp(-(tau_above + 0.5 * DX / se * 0.5 * (s + sh)))
        # optical depth at the bottom of layer k, then move to the layer below: shift by one voxel height
        tau_bot = tau_above + DX / se * 0.5 * (s + shift_bilinear(s, sx, sy))
        tau_above = shift_bilinear(tau_bot, sx, sy)
    return T


# ------------------------------------------------------------------------------------------------- phase function
def gamma_ross(cosb, rho, tau):
    """Area scattering phase function of bi-Lambertian spherical-distribution leaves; cosb (...), rho/tau (3,).
    Returns (..., 3).  Integral over the sphere = (rho + tau) / 2."""
    b = np.arccos(np.clip(cosb, -1.0, 1.0))[..., None]
    sb, cb = np.sin(b), np.cos(b)
    return (rho * (sb - b * cb) + tau * (sb + (math.pi - b) * cb)) / (3.0 * math.pi ** 2)


def cosine_dir(rng, n):
    """Cosine-distributed unit vectors about unit normals n (N, 3)."""
    N = n.shape[0]
    u1, u2 = rng.random(N), rng.random(N)
    r, phi = np.sqrt(u1), 2 * math.pi * u2
    lx, ly, lz = r * np.cos(phi), r * np.sin(phi), np.sqrt(np.maximum(1 - u1, 0))
    a = np.where(np.abs(n[:, 0:1]) > 0.9, np.array([[0.0, 1.0, 0.0]]), np.array([[1.0, 0.0, 0.0]]))
    t = np.cross(n, a)
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    b = np.cross(n, t)
    return t * lx[:, None] + b * ly[:, None] + n * lz[:, None]


# ------------------------------------------------------------------------------------------------- path tracer
def trace_brf(stand, views, rays_per_view, sun_elevs, rng):
    """views: (V, 3) unit vectors toward the viewer (z up, x toward the sun azimuth).
    Returns brf (V, K, 3), gap (V,), sunlit (V, K)."""
    sig = stand['sigma']
    grp = stand['group']
    NZ = stand['NZ']
    ztop = stand['ztop']
    V, K = len(views), len(sun_elevs)
    Ts = [shadow_volume(sig, e) for e in sun_elevs]
    Tflat = np.stack([t.reshape(-1) for t in Ts], 1)           # (nvox, K)
    Tg = np.stack([t[:, :, 0].reshape(-1) for t in Ts], 1)       # floor (bottom layer), (NX*NX, K)
    sunv = np.array([[math.cos(e), 0.0, math.sin(e)] for e in sun_elevs])   # toward the sun
    mus = sunv[:, 2]
    rhoG = np.stack([LEAF[g]['rho'] for g in GROUPS])            # (2, 3)
    tauG = np.stack([LEAF[g]['tau'] for g in GROUPS])
    sflat = sig.reshape(-1)
    gflat = grp.reshape(-1)

    N = V * rays_per_view
    vid = np.repeat(np.arange(V), rays_per_view)
    d = -views[vid].astype(np.float64)                           # travel direction (away from the viewer)
    p = np.empty((N, 3))
    p[:, 0] = rng.random(N) * LT
    p[:, 1] = rng.random(N) * LT
    p[:, 2] = ztop - 1e-6
    w = np.ones((N, 3))
    acc = np.zeros((N, K, 3))
    first_floor = np.zeros(N, bool)
    first_sun = np.zeros((N, K))
    idx = np.arange(N)                                           # alive rays (indices into the full arrays)

    def vox(pp):
        i = np.floor(pp[:, 0] / DX).astype(np.int64) % NX
        j = np.floor(pp[:, 1] / DX).astype(np.int64) % NX
        k = np.clip(np.floor(pp[:, 2] / DX).astype(np.int64), 0, NZ - 1)
        return (i * NX + j) * NZ + k, i * NX + j

    for bounce in range(MAX_BOUNCE + 1):
        if idx.size == 0:
            break
        # ---- free flight: march until accumulated tau exceeds -ln(u), the floor or the top
        n = idx.size
        pp, dd = p[idx], d[idx]
        target = -np.log(1.0 - rng.random(n))
        tau = np.zeros(n)
        tcur = np.zeros(n)
        # jittered first step
        h = STEP * rng.random(n)
        event = np.zeros(n, np.int8)           # 0 pending, 1 leaf, 2 floor, 3 escape
        hitpos = np.zeros((n, 3))
        act = np.arange(n)
        it = 0
        while act.size and it < 4000:
            it += 1
            q = pp[act] + dd[act] * (tcur[act] + 0.5 * h[act])[:, None]
            vi, _ = vox(q)
            s = sflat[vi]
            tnew = tau[act] + s * h[act]
            crossed = tnew >= target[act]
            # position of the collision inside the step (linear in tau)
            frac = np.where(crossed, (target[act] - tau[act]) / np.maximum(s * h[act], 1e-12), 1.0)
            tend = tcur[act] + frac * h[act]
            zend = pp[act, 2] + dd[act, 2] * tend
            floor_hit = (zend <= 0.0)
            top_hit = (zend >= ztop) & (dd[act, 2] > 0)
            # resolve: floor first (the medium never extends below z = 0 except the bottom layer)
            ef = act[floor_hit]
            tf = -pp[ef, 2] / dd[ef, 2]
            event[ef] = 2
            hitpos[ef] = pp[ef] + dd[ef] * tf[:, None]
            et = act[top_hit & ~floor_hit]
            event[et] = 3
            col = crossed & ~floor_hit & ~top_hit
            ec = act[col]
            event[ec] = 1
            hitpos[ec] = pp[ec] + dd[ec] * tend[col][:, None]
            keep = ~(floor_hit | top_hit | crossed)
            ka = act[keep]
            tau[ka] = tnew[keep]
            tcur[ka] = tcur[ka] + h[ka]
            h[ka] = STEP
            act = ka
        # anything still pending after the cap: drop
        # ---- leaf events: NEE + scatter
        L = idx[event == 1]
        li = np.nonzero(event == 1)[0]
        F = idx[event == 2]
        fi = np.nonzero(event == 2)[0]
        if bounce == 0:
            first_floor[F] = True
        new_alive = []
        if L.size:
            hp = hitpos[li]
            vi, _ = vox(hp)
            g = gflat[vi].astype(np.int64)
            rho, tauL = rhoG[g], tauG[g]                          # (n, 3)
            T = Tflat[vi]                                         # (n, K)
            cosb = d[L] @ sunv.T                                  # (n, K): Omega' = -sun, Omega = -d
            b = np.arccos(np.clip(cosb, -1, 1))[..., None]
            sb, cb = np.sin(b), np.cos(b)
            gam = (rho[:, None, :] * (sb - b * cb) + tauL[:, None, :] * (sb + (math.pi - b) * cb)) / (3 * math.pi ** 2)
            acc[L] += w[L][:, None, :] * gam * (2 * math.pi) * (T / mus[None, :])[..., None]
            if bounce == 0:
                first_sun[L] = T
            # scatter: leaf normal ~ |d.n|, reflect or transmit cosine-distributed
            nrm = cosine_dir(rng, d[L])                           # n.d > 0
            nf = -nrm                                             # face toward the incoming light
            rb, tb = rho.mean(1), tauL.mean(1)
            prefl = rb / (rb + tb)
            refl = rng.random(L.size) < prefl
            newd = cosine_dir(rng, np.where(refl[:, None], nf, -nf))
            fac = np.where(refl[:, None], rho * ((rb + tb) / rb)[:, None], tauL * ((rb + tb) / tb)[:, None])
            w[L] *= fac
            d[L] = newd
            p[L] = hp
            new_alive.append(L)
        if F.size:
            hp = hitpos[fi]
            _, ci = vox(hp)
            T = Tg[ci]
            acc[F] += w[F][:, None, :] * FLOOR[None, None, :] * T[..., None]
            w[F] *= FLOOR
            d[F] = cosine_dir(rng, np.tile(np.array([[0.0, 0.0, 1.0]]), (F.size, 1)))
            p[F] = hp + np.array([0.0, 0.0, 1e-4])
            new_alive.append(F)
        idx = np.concatenate(new_alive) if new_alive else np.zeros(0, np.int64)
        # Russian roulette on low-weight paths
        if idx.size and bounce >= 2:
            wm = w[idx].max(1)
            surv = np.minimum(1.0, wm / 0.02)
            keep = rng.random(idx.size) < surv
            w[idx[keep]] /= surv[keep][:, None]
            idx = idx[keep]

    brf = np.zeros((V, K, 3))
    gap = np.zeros(V)
    sunlit = np.zeros((V, K))
    for v in range(V):
        sl = slice(v * rays_per_view, (v + 1) * rays_per_view)
        brf[v] = acc[sl].mean(0)
        gap[v] = first_floor[sl].mean()
        hitl = ~first_floor[sl]
        sunlit[v] = first_sun[sl][hitl].mean(0) if hitl.any() else 0.0
    return brf, gap, sunlit


# ------------------------------------------------------------------------------------------------- crown transfer
SKY_DIRS = [(math.radians(e), math.radians(a)) for e in (12.0, 35.0, 60.0) for a in range(0, 360, 60)] + [(math.radians(84.0), 0.0)]


def crown_samples(stand, sun_elevs, rng, per_tree=60):
    """Rows: h_rel, d_rel, cos_az_to_sun, mu_s, cover-independent geometry; targets T_sun, sky_vis.
    Returns (feat (n, 4): h_rel, d_rel, cosaz, mus), (tsun (n,)), (sky (n,)), group (n,)."""
    sig = stand['sigma']
    NZ = stand['NZ']
    Ts = [shadow_volume(sig, e) for e in sun_elevs]
    skyw = np.array([math.sin(e) * (math.cos(e) if e < 1.4 else 1.0) for e, a in SKY_DIRS])
    # cosine-weighted irradiance: weight ~ sin(e) per direction, solid angle ~ cos(e) per elevation ring
    skyT = [shadow_volume(sig, e, a) for e, a in SKY_DIRS]
    skyw = skyw / skyw.sum()
    rows, ts, sv, gs = [], [], [], []
    for t in stand['trees']:
        sp = SPECIES[t['sp']]
        H = t['H']
        z0 = sp['base'] * H
        # sample points inside the envelope, denser near the surface (that is what impostors / leaves show)
        m = per_tree
        tc = rng.random(m)
        rn = 1.0 - rng.random(m) ** 2.0                      # 0 axis .. 1 surface, skewed to the surface
        az = rng.random(m) * 2 * math.pi
        rr = crown_radius(sp, tc) * H * t['wide']
        x = t['x'] + rn * rr * np.cos(az)
        y = t['y'] + rn * rr * np.sin(az)
        z = z0 + tc * (H - z0)
        i = np.floor(x / DX).astype(np.int64) % NX
        j = np.floor(y / DX).astype(np.int64) % NX
        k = np.clip(np.floor(z / DX).astype(np.int64), 0, NZ - 1)
        sky = sum(wk * T[i, j, k] for wk, T in zip(skyw, skyT))
        for e, T in zip(sun_elevs, Ts):
            rows.append(np.stack([tc, 1.0 - rn, np.cos(az), np.full(m, math.sin(e))], 1))
            ts.append(T[i, j, k])
            sv.append(sky)
            gs.append(np.full(m, t['g']))
    if not rows:
        return np.zeros((0, 4)), np.zeros(0), np.zeros(0), np.zeros(0)
    return np.concatenate(rows), np.concatenate(ts), np.concatenate(sv), np.concatenate(gs)
