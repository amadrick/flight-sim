"""Reference solver: Monte Carlo volumetric path tracer for sun-lit clouds (numba-compiled kernel).

Geometry
--------
World: metres, +z up.  The sun is at zenith angle theta0 in the x-z plane:
    L = (sin theta0, 0, cos theta0)   unit vector TOWARD the sun,  s = -L direction of sunlight travel.
The medium is a horizontally periodic box of height H = Nz*dz, stored on a *sheared lattice* whose third
axis runs along the sun direction: lattice coords  u = ((x - z*tan theta0)/dx, y/dy, z/dz).
Extinction is piecewise constant per lattice voxel.  Because every lattice column is a sun ray, the
optical depth to the sun is an exact cumulative sum along the third axis (one lookup per next-event
estimate) for any sun elevation, and horizontal periodicity is exact (Nx=Ny=1 gives a plane-parallel slab).
Above the box is vacuum with the sun; below is a black ground (ground bounce is the renderer's job).

Estimator
---------
J(x, w) = source function per unit sun irradiance: radiance scattered at x into direction w (direction of
light travel toward the viewer) per unit irradiance on a plane normal to the sun beam above the cloud.
    J = phase(w.s) exp(-tau_sun(x))            (single scattering, analytic, not Monte Carlo)
      + J_ms                                    (all higher orders: estimated here)
J_ms is estimated with an adjoint random walk started at x: sample the direction the light came from
with the phase function, free-flight with delta tracking (local majorants on a supercell grid), and at
every collision do next-event estimation to the sun, p(.)*exp(-tau_sun) with the exact tau_sun lookup.
Because the Mie-like phase function has a ~600 sr^-1 forward peak, plain NEE has fireflies (chains of
narrow forward scatterings of the sun beam); each vertex therefore uses two-sample MIS with importance
splitting (see _estimate).  Single-scattering albedo is applied as a weight; importance-aware Russian
roulette guarantees termination without bias.  tau_mis = 0 switches all of that off (plain NEE) and is
used by validate.py to confirm that both estimators agree.
"""
import math
import numpy as np
from numba import njit, prange

from phase import phase, _sample_hg, PP_CLOUD

TAU_MIS = 12.0     # default: beyond this sun optical depth the sun-lobe MIS branch is skipped (still unbiased)
TAU_CUT = 80.0     # exp(-80) ~ 1e-35: contributions below this are dropped
ONE53 = 1.0 / 9007199254740992.0


# ----------------------------------------------------------------------------------------------- RNG
@njit(cache=True, inline='always')
def _rand(st):
    """xorshift64* ; st is a uint64[1] array. Returns a double in [0,1)."""
    x = st[0]
    x ^= x >> np.uint64(12)
    x ^= x << np.uint64(25)
    x ^= x >> np.uint64(27)
    st[0] = x
    return np.float64((x * np.uint64(2685821657736338717)) >> np.uint64(11)) * ONE53


@njit(cache=True, inline='always')
def _seed(st, a, b):
    """splitmix64 of (a, b) -> non-zero state."""
    z = np.uint64(a) * np.uint64(0x9E3779B97F4A7C15) + np.uint64(b) + np.uint64(0x632BE59BD9B4E019)
    z = (z ^ (z >> np.uint64(30))) * np.uint64(0xBF58476D1CE4E5B9)
    z = (z ^ (z >> np.uint64(27))) * np.uint64(0x94D049BB133111EB)
    z = z ^ (z >> np.uint64(31))
    if z == np.uint64(0):
        z = np.uint64(0x9E3779B97F4A7C15)
    st[0] = z
    for _ in range(4):
        _rand(st)


# ------------------------------------------------------------------------------------- phase sampling
@njit(cache=True, inline='always')
def _sample_mu(pp, st):
    """Sample cos(angle) from the mixture phase function (exact: HG inversion, Draine by rejection from HG)."""
    if pp[3] > 0.0 and _rand(st) < pp[3]:
        while True:
            mu = _sample_hg(pp[1], _rand(st))
            if _rand(st) * (1.0 + pp[2]) <= 1.0 + pp[2] * mu * mu:
                return mu
    return _sample_hg(pp[0], _rand(st))


@njit(cache=True, inline='always')
def _rotate(ax, ay, az, mu, phi):
    """Unit vector at polar cosine mu / azimuth phi about the unit axis a."""
    st2 = 1.0 - mu * mu
    if st2 < 0.0:
        st2 = 0.0
    sn = math.sqrt(st2)
    cp = math.cos(phi)
    sp = math.sin(phi)
    # orthonormal basis (Duff et al. 2017)
    sign = 1.0 if az >= 0.0 else -1.0
    a = -1.0 / (sign + az)
    b = ax * ay * a
    t1x = 1.0 + sign * ax * ax * a
    t1y = sign * b
    t1z = -sign * ax
    t2x = b
    t2y = sign + ay * ay * a
    t2z = -ay
    dx = sn * (cp * t1x + sp * t2x) + mu * ax
    dy = sn * (cp * t1y + sp * t2y) + mu * ay
    dz = sn * (cp * t1z + sp * t2z) + mu * az
    n = 1.0 / math.sqrt(dx * dx + dy * dy + dz * dz)
    return dx * n, dy * n, dz * n


# ---------------------------------------------------------------------------------------- the medium
@njit(cache=True, inline='always')
def _wrap(i, n):
    i = i % n
    if i < 0:
        i += n
    return i


@njit(cache=True, inline='always')
def _tau_sun(sig, cum, ux, uy, uz, dz_mu):
    nx, ny, nz = sig.shape
    k = int(math.floor(uz))
    if k >= nz:
        return 0.0
    if k < 0:
        k = 0
        uz = 0.0
    i = _wrap(int(math.floor(ux)), nx)
    j = _wrap(int(math.floor(uy)), ny)
    return cum[i, j, k] + sig[i, j, k] * ((k + 1) - uz) * dz_mu


@njit(cache=True)
def _flight(sig, maj, bsz, ux, uy, uz, dux, duy, duz, st):
    """Delta tracking from lattice point u along lattice direction du (du = d(lattice)/d(metre)).
    Returns (hit, ux, uy, uz)."""
    nx, ny, nz = sig.shape
    mx, my, mz = maj.shape
    bx = bsz[0]
    by = bsz[1]
    bz = bsz[2]
    adx = abs(dux)
    ady = abs(duy)
    adz = abs(duz)
    eps = 1e-7 / max(adx, max(ady, adz))
    INF = 1e300
    while True:
        if uz >= nz or uz < 0.0:
            return False, ux, uy, uz
        cx = math.floor(ux / bx)
        cy = math.floor(uy / by)
        cz = math.floor(uz / bz)
        if dux > 0.0:
            tx = ((cx + 1.0) * bx - ux) / dux
        elif dux < 0.0:
            tx = (cx * bx - ux) / dux
        else:
            tx = INF
        if duy > 0.0:
            ty = ((cy + 1.0) * by - uy) / duy
        elif duy < 0.0:
            ty = (cy * by - uy) / duy
        else:
            ty = INF
        if duz > 0.0:
            tz = ((cz + 1.0) * bz - uz) / duz
        elif duz < 0.0:
            tz = (cz * bz - uz) / duz
        else:
            tz = INF
        te = min(tx, min(ty, tz))
        icz = int(cz)
        if icz >= mz:
            icz = mz - 1
        m = maj[_wrap(int(cx), mx), _wrap(int(cy), my), icz]
        if m <= 0.0:
            t = te + eps
            ux += dux * t
            uy += duy * t
            uz += duz * t
            continue
        # tentative collisions inside this supercell
        t_in = 0.0
        hit = False
        while True:
            t_in -= math.log(1.0 - _rand(st)) / m
            if t_in >= te:
                break
            px = ux + dux * t_in
            py = uy + duy * t_in
            pz = uz + duz * t_in
            k = int(math.floor(pz))
            if k < 0 or k >= nz:
                break
            s = sig[_wrap(int(math.floor(px)), nx), _wrap(int(math.floor(py)), ny), k]
            if _rand(st) * m < s:
                hit = True
                break
        if hit:
            return True, ux + dux * t_in, uy + duy * t_in, uz + duz * t_in
        t = te + eps
        ux += dux * t
        uy += duy * t
        uz += duz * t


STACK = 48        # max simultaneously pending split walkers per path
IMIN = 0.3        # Russian-roulette threshold on (weight x alignment importance)


@njit(cache=True, inline='always')
def _hg(g, mu):
    d = 1.0 + g * g - 2.0 * g * mu
    return 0.07957747154594767 * (1.0 - g * g) / (d * math.sqrt(d))


@njit(cache=True)
def _estimate(sig, cum, maj, bsz, geo, pp, x, y, z, wx, wy, wz, npaths, max_bounce, albedo, tau_mis, st, out):
    """J_ms(x, w) estimate. geo = (dx, dy, dz, tan0, mu0).
    out[0], out[1]: means of the two independent halves (even / odd paths); out[2]: mean of squares of
    single-path estimates; out[3]: mean number of scattering events per path; out[4]: fraction of paths cut.

    Adjoint walk with importance splitting.  At a vertex with walk axis a (= minus the direction in which light
    leaves the vertex) the remaining transport is  S = int p(d.a) E_flight[ albedo * (p(d.L) T_sun(y) + S(y, d)) ] dd.
    The bracket is sharply peaked for d ~ L (chains of narrow-lobe forward scatterings of the sun beam), so the
    d-integral is estimated with two-sample MIS (balance heuristic) over
        A: d ~ p(. ; a)   (the phase function about the walk axis)          weight wA = p1/(p1+pN)
        B: d ~ N(. ; L)   (the narrow diffraction lobe about the sun)       weight wB = p1/(p1+pN)
    and BOTH samples continue as walkers carrying their MIS weight.  Walkers are pruned by Russian roulette on
    weight x (1 + phase(d.L)), i.e. sun-aligned walkers (large expected pay-off) are kept at small weights.
    Beyond tau_sun > tau_mis the B sample is skipped (wA = 1): still unbiased, just cheaper."""
    dx = geo[0]
    dy = geo[1]
    dz = geo[2]
    tan0 = geo[3]
    mu0 = geo[4]
    sin0 = math.sqrt(max(0.0, 1.0 - mu0 * mu0))
    Lx = sin0
    Ly = 0.0
    Lz = mu0
    dz_mu = dz / mu0
    gN = pp[0]
    ux0 = (x - z * tan0) / dx
    uy0 = y / dy
    uz0 = z / dz
    tau0 = _tau_sun(sig, cum, ux0, uy0, uz0, dz_mu)
    acc0 = 0.0
    acc1 = 0.0
    acc2 = 0.0
    nsc = 0.0
    ncut = 0.0
    twopi = 2.0 * math.pi
    stk = np.empty((STACK, 8))
    stb = np.empty(STACK, dtype=np.int64)
    for ip in range(npaths):
        tot = 0.0
        sp = 1
        stk[0, 0] = ux0
        stk[0, 1] = uy0
        stk[0, 2] = uz0
        stk[0, 3] = wx
        stk[0, 4] = wy
        stk[0, 5] = wz
        stk[0, 6] = 1.0
        stk[0, 7] = tau0
        stb[0] = 0
        while sp > 0:
            sp -= 1
            ux = stk[sp, 0]
            uy = stk[sp, 1]
            uz = stk[sp, 2]
            ox = stk[sp, 3]
            oy = stk[sp, 4]
            oz = stk[sp, 5]
            wt = stk[sp, 6]
            tau_v = stk[sp, 7]
            b = stb[sp]
            while True:
                if b >= max_bounce:
                    ncut += 1.0
                    break
                ax = -ox
                ay = -oy
                az = -oz
                # ---- sample A: phase lobe about the walk axis
                muA = _sample_mu(pp, st)
                dAx, dAy, dAz = _rotate(ax, ay, az, muA, twopi * _rand(st))
                p1A = phase(pp, muA)
                cA = dAx * Lx + dAy * Ly + dAz * Lz
                p2A = phase(pp, cA)
                use_b = tau_v < tau_mis and sp < STACK - 1
                wA = 1.0
                if use_b:
                    wA = p1A / (p1A + _hg(gN, cA))
                    # ---- sample B: narrow lobe about the sun direction
                    muB = _sample_hg(gN, _rand(st))
                    dBx, dBy, dBz = _rotate(Lx, Ly, Lz, muB, twopi * _rand(st))
                    cB = dBx * Lx + dBy * Ly + dBz * Lz
                    p1B = phase(pp, dBx * ax + dBy * ay + dBz * az)
                    wc = wt * albedo * p1B / (p1B + _hg(gN, cB))
                    p2B = phase(pp, cB)
                    # roulette BEFORE the flight for the cheap common case of a negligible child
                    imp = wc * (1.0 + p2B)
                    alive = True
                    if imp < IMIN:
                        if _rand(st) * IMIN < imp:
                            wc *= IMIN / imp
                        else:
                            alive = False
                    if alive:
                        hitB, bx_, by_, bz_ = _flight(sig, maj, bsz, ux, uy, uz,
                                                      (dBx - dBz * tan0) / dx, dBy / dy, dBz / dz, st)
                        if hitB:
                            nsc += 1.0
                            tb = _tau_sun(sig, cum, bx_, by_, bz_, dz_mu)
                            if tb < TAU_CUT:
                                tot += wc * p2B * math.exp(-tb)
                            stk[sp, 0] = bx_
                            stk[sp, 1] = by_
                            stk[sp, 2] = bz_
                            stk[sp, 3] = -dBx
                            stk[sp, 4] = -dBy
                            stk[sp, 5] = -dBz
                            stk[sp, 6] = wc
                            stk[sp, 7] = tb
                            stb[sp] = b + 1
                            sp += 1
                hitA, ux, uy, uz = _flight(sig, maj, bsz, ux, uy, uz,
                                           (dAx - dAz * tan0) / dx, dAy / dy, dAz / dz, st)
                if not hitA:
                    break
                b += 1
                nsc += 1.0
                tau_v = _tau_sun(sig, cum, ux, uy, uz, dz_mu)
                wt *= albedo * wA
                if tau_v < TAU_CUT:
                    tot += wt * p2A * math.exp(-tau_v)
                imp = wt * (1.0 + p2A)
                if imp < IMIN:                      # Russian roulette (importance aware)
                    if _rand(st) * IMIN >= imp:
                        break
                    wt *= IMIN / imp
                ox = -dAx
                oy = -dAy
                oz = -dAz
        if ip & 1:
            acc1 += tot
        else:
            acc0 += tot
        acc2 += tot * tot
    n0 = (npaths + 1) // 2
    n1 = npaths // 2
    out[0] = acc0 / max(n0, 1)
    out[1] = acc1 / max(n1, 1)
    out[2] = acc2 / npaths
    out[3] = nsc / npaths
    out[4] = ncut / npaths


@njit(cache=True, parallel=True)
def estimate_batch(sig, cum, maj, bsz, geo, pp, pos, w, npaths, max_bounce, albedo, tau_mis, seed):
    """pos (N,3) world positions, w (N,3) unit directions of light travel toward the viewer.
    Returns (N,5): halfA, halfB, mean-square, mean scatter count, cut fraction."""
    n = pos.shape[0]
    res = np.zeros((n, 5))
    for i in prange(n):
        st = np.zeros(1, dtype=np.uint64)
        _seed(st, seed, i)
        _estimate(sig, cum, maj, bsz, geo, pp, pos[i, 0], pos[i, 1], pos[i, 2], w[i, 0], w[i, 1], w[i, 2],
                  npaths, max_bounce, albedo, tau_mis, st, res[i])
    return res


# ------------------------------------------------------------------------- deterministic ray integrals
@njit(cache=True)
def _march_tau(sig, geo, x, y, z, dxw, dyw, dzw, step, smax, taumax):
    """Optical depth from (x,y,z) along unit world direction d until leaving the slab (midpoint rule, fine steps)."""
    nx, ny, nz = sig.shape
    dx = geo[0]
    dy = geo[1]
    dz = geo[2]
    tan0 = geo[3]
    tau = 0.0
    s = 0.5 * step
    while s < smax:
        pz = z + dzw * s
        if pz < 0.0 or pz >= nz * dz:
            break
        px = x + dxw * s
        py = y + dyw * s
        i = _wrap(int(math.floor((px - pz * tan0) / dx)), nx)
        j = _wrap(int(math.floor(py / dy)), ny)
        k = int(math.floor(pz / dz))
        if k >= nz:
            k = nz - 1
        tau += sig[i, j, k] * step
        if tau > taumax:
            break
        s += step
    return tau


@njit(cache=True, parallel=True)
def features_batch(sig, cum, geo, pos, w):
    """Per-sample ray-integrated features, computed the way a renderer would:
    0 tauSun, 1 tauUp, 2 cosTheta, 3 tauDown, 4 tauView (toward the viewer), 5 local extinction (1/m),
    6 mu0, 7 height fraction z/H."""
    n = pos.shape[0]
    nx, ny, nz = sig.shape
    dx = geo[0]
    dy = geo[1]
    dz = geo[2]
    tan0 = geo[3]
    mu0 = geo[4]
    sin0 = math.sqrt(max(0.0, 1.0 - mu0 * mu0))
    f = np.zeros((n, 8))
    hstep = 0.25 * min(dz, min(dx, dy))
    for i in prange(n):
        x = pos[i, 0]
        y = pos[i, 1]
        z = pos[i, 2]
        ux = (x - z * tan0) / dx
        uy = y / dy
        uz = z / dz
        f[i, 0] = _tau_sun(sig, cum, ux, uy, uz, dz / mu0)
        f[i, 1] = _march_tau(sig, geo, x, y, z, 0.0, 0.0, 1.0, 0.25 * dz, 1e9, 1e9)
        f[i, 2] = -(w[i, 0] * sin0 + w[i, 2] * mu0)          # w . s,  s = -L
        f[i, 3] = _march_tau(sig, geo, x, y, z, 0.0, 0.0, -1.0, 0.25 * dz, 1e9, 1e9)
        f[i, 4] = _march_tau(sig, geo, x, y, z, w[i, 0], w[i, 1], w[i, 2], hstep, 60000.0, 60.0)
        k = int(math.floor(uz))
        if k < 0:
            k = 0
        if k >= nz:
            k = nz - 1
        f[i, 5] = sig[_wrap(int(math.floor(ux)), nx), _wrap(int(math.floor(uy)), ny), k]
        f[i, 6] = mu0
        f[i, 7] = z / (nz * dz)
    return f


@njit(cache=True, parallel=True)
def camera_points(sig, maj, bsz, geo, origins, dirs, seed):
    """First-collision points of camera rays (origin, direction of camera-ray travel).
    Returns positions (N,3) and a hit mask.  This is the image-contribution distribution sigma*T_view."""
    n = origins.shape[0]
    dx = geo[0]
    dy = geo[1]
    dz = geo[2]
    tan0 = geo[3]
    pos = np.zeros((n, 3))
    ok = np.zeros(n, dtype=np.bool_)
    for i in prange(n):
        st = np.zeros(1, dtype=np.uint64)
        _seed(st, seed, i)
        x = origins[i, 0]
        y = origins[i, 1]
        z = origins[i, 2]
        hit, ux, uy, uz = _flight(sig, maj, bsz, (x - z * tan0) / dx, y / dy, z / dz,
                                  (dirs[i, 0] - dirs[i, 2] * tan0) / dx, dirs[i, 1] / dy, dirs[i, 2] / dz, st)
        if hit:
            pz = uz * dz
            pos[i, 0] = ux * dx + pz * tan0
            pos[i, 1] = uy * dy
            pos[i, 2] = pz
            ok[i] = True
    return pos, ok


# ----------------------------------------------------------------------- python-side medium container
class Medium:
    """Horizontally periodic piecewise-constant medium on the sun-sheared lattice."""

    def __init__(self, sig, dx, dy, dz, mu0, block=8):
        sig = np.ascontiguousarray(sig, dtype=np.float32)
        nx, ny, nz = sig.shape
        self.sig = sig
        self.dx, self.dy, self.dz, self.mu0 = float(dx), float(dy), float(dz), float(mu0)
        self.tan0 = math.sqrt(max(0.0, 1.0 - mu0 * mu0)) / mu0
        self.geo = np.array([dx, dy, dz, self.tan0, mu0], dtype=np.float64)
        # optical depth to the sun from the TOP face of voxel k (sum over the voxels above it in the column)
        above = np.cumsum(sig[:, :, ::-1].astype(np.float64), axis=2)[:, :, ::-1] - sig
        self.cum = np.ascontiguousarray(above * (dz / mu0), dtype=np.float32)
        bx = block if nx % block == 0 else 1
        by = block if ny % block == 0 else 1
        bz = block if nz >= block else 1
        mz = int(math.ceil(nz / bz))
        pad = mz * bz - nz
        s = np.pad(sig, ((0, 0), (0, 0), (0, pad)))
        maj = s.reshape(nx // bx, bx, ny // by, by, mz, bz).max(axis=(1, 3, 5))
        self.maj = np.ascontiguousarray(maj, dtype=np.float32)
        self.bsz = np.array([bx, by, bz], dtype=np.float64)
        self.shape = (nx, ny, nz)
        self.size = (nx * dx, ny * dy, nz * dz)

    def voxel_centres(self):
        """World coordinates of the lattice voxel centres, arrays broadcastable to (nx,ny,nz)."""
        nx, ny, nz = self.shape
        z = (np.arange(nz) + 0.5) * self.dz
        x = (np.arange(nx) + 0.5)[:, None, None] * self.dx + (z * self.tan0)[None, None, :]
        y = ((np.arange(ny) + 0.5) * self.dy)[None, :, None]
        return x, y, z[None, None, :]

    def estimate(self, pos, w, npaths, max_bounce=20000, albedo=0.9999, seed=1, pp=PP_CLOUD, tau_mis=TAU_MIS):
        """Returns (N,5): [half A mean, half B mean, mean square, mean #scatterings, fraction cut] of J_ms."""
        pos = np.ascontiguousarray(pos, dtype=np.float64)
        w = np.ascontiguousarray(w, dtype=np.float64)
        return estimate_batch(self.sig, self.cum, self.maj, self.bsz, self.geo, pp, pos, w,
                              int(npaths), int(max_bounce), float(albedo), float(tau_mis), int(seed))

    def features(self, pos, w):
        return features_batch(self.sig, self.cum, self.geo, np.ascontiguousarray(pos, dtype=np.float64),
                              np.ascontiguousarray(w, dtype=np.float64))

    def camera_points(self, origins, dirs, seed=1):
        return camera_points(self.sig, self.maj, self.bsz, self.geo,
                             np.ascontiguousarray(origins, dtype=np.float64),
                             np.ascontiguousarray(dirs, dtype=np.float64), int(seed))

    @property
    def sun_dir(self):
        return np.array([math.sqrt(max(0.0, 1.0 - self.mu0 ** 2)), 0.0, self.mu0])


def slab_medium(tau_total, mu0, nz=64, sigma=0.05):
    """Homogeneous plane-parallel slab of optical thickness tau_total (Nx=Ny=1, periodic)."""
    h = tau_total / sigma
    sig = np.full((1, 1, nz), sigma, dtype=np.float32)
    return Medium(sig, 1e7, 1e7, h / nz, mu0)
