"""Reference: Monte Carlo volumetric path tracer for cloud volumes (numba, CPU).

Medium
------
Extinction sigma (1/m) on a regular grid of cubic voxels, trilinear between voxel centres, zero outside (or
horizontally periodic for plane-parallel validation). Single-scattering albedo from Mie (0.9999995 at 550 nm for
r_eff = 10 um: hundreds to thousands of scattering orders survive). Phase function: the TABULATED Lorenz-Mie phase
function of a droplet population (mie.py), not a fit.

Sources: the sun (collimated, irradiance 1 on a plane normal to the beam), a uniform sky dome of radiance 1 over the
upper hemisphere and a uniform "ground" of radiance 1 over the lower hemisphere. The three answers are kept
separate so the renderer can weight them with its own sun colour, sky and ground radiances (the cloud contract).

What is estimated (per point x and viewing direction d = direction of light travel toward the viewer):
    J(x, d) = integral p(d . w) L(x, w) dw          (in-scattered radiance per unit extinction, sr^-1 per unit E_sun)
split into
    J_ss  = p(theta) exp(-tau_sun(x))                (single scattering of the sun: exact, computed by the shader)
    J_fp  = p(theta) [exp(-(1 - f) tau_sun) - exp(-tau_sun)]
                                                     (sunlight scattered one or more times into the narrow forward
                                                      diffraction peak and still travelling with the beam, then
                                                      scattered toward the viewer: analytic, see below)
    J_ms  = everything else from the sun             (Monte Carlo: this is what the network learns)
    V_sky, V_gnd = all orders of sky / ground light  (Monte Carlo)

Method: delta-M style truncation of the Mie forward peak (Wiscombe 1977; the "TMS" correction of Nakajima & Tanaka
1988). The tabulated phase function is cut flat inside theta_c (a few degrees), the removed fraction f is treated as
unscattered: sigma' = (1 - f) sigma, p' = p* / (1 - f). In the scaled medium the random walk is cheap (half the
collisions, no 600-2000 sr^-1 spike under next-event estimation). The answer is mapped back to the true medium
(the shader marches with the full sigma):
    J = (1 - f) Int p' L' + f L'(x, d)          L' = scaled-medium radiance
so every point gets two kinds of adjoint walks: "diffuse" walks whose first direction is drawn from p', weighted
(1 - f), and "peak" walks that start straight back along -d (the light the truncated peak passes on unchanged),
weighted f. Each walk: delta tracking with supercell majorants, next-event estimation to the sun at every vertex
with a precomputed sun optical-depth grid, albedo as a weight, escape to sky (going up) or ground (going down).
The first-order term of the diffuse walks with p' is replaced exactly by J_ss + J_fp.

Validation: validate.py (forward photon MC with the FULL untruncated Mie phase vs this estimator, slab albedo /
transmittance vs optical depth, delta-Eddington two-stream, energy conservation).
"""
import math
import os

import numpy as np
from numba import njit, prange

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
B = 4                  # supercell size in voxels (majorant grid)
NT = 4096              # uniform-theta table of the truncated phase function
MAX_COLL = 40000       # safety cap on collisions per walk (never reached below optical thickness ~ 400)


# ------------------------------------------------------------------------------------------- phase tables
class Phase:
    """Tabulated Mie phase function (one band or the band average) and its truncated version."""

    def __init__(self, reff=10.0, band='G', theta_c_deg=4.0, tables=None):
        z = np.load(tables or os.path.join(DATA, 'mie_tables.npz'))
        i = int(np.argmin(np.abs(z['reff'] - reff)))
        self.reff = float(z['reff'][i])
        th = z['theta']
        if band == 'avg':
            p = z['P'][i].mean(0)
            self.albedo = float(z['albedo'][i].mean())
            self.qext = float(z['qext'][i].mean())
        else:
            j = 'RGB'.index(band)
            p = z['P'][i, j]
            self.albedo = float(z['albedo'][i, j])
            self.qext = float(z['qext'][i, j])
        self.theta, self.p = th, p
        self.g = float(2 * math.pi * np.trapezoid(p * np.cos(th) * np.sin(th), th))
        self.theta_c = math.radians(theta_c_deg)
        pc = float(np.interp(self.theta_c, th, p))
        pstar = np.where(th < self.theta_c, pc, p)
        one_minus_f = float(2 * math.pi * np.trapezoid(pstar * np.sin(th), th))
        self.f = 1.0 - one_minus_f
        self.pc = pc
        # uniform-theta tables of p' (normalised) and its CDF over the sphere
        tu = np.linspace(0, math.pi, NT)
        pu = np.interp(tu, th, pstar) / one_minus_f
        self.tab = pu.astype(np.float64)
        w = pu * np.sin(tu) * 2 * math.pi
        cdf = np.concatenate([[0.0], np.cumsum(0.5 * (w[1:] + w[:-1]) * (tu[1] - tu[0]))])
        self.cdf = cdf / cdf[-1]
        self.g_trunc = float(2 * math.pi * np.trapezoid(pu * np.cos(tu) * np.sin(tu), tu))
        a = self.albedo
        self.albedo_scaled = a * (1 - self.f) / (1 - a * self.f)
        a3 = z['albedo'][i]
        self.albedo_rgb = a3.astype(np.float64)
        self.alb3 = (a3 * (1 - self.f) / (1 - a3 * self.f)).astype(np.float64)
        # full phase on a fine uniform-in-theta table for the exact single scattering (and the deterministic terms)
        # the excised peak q = (p - p_c)+ inside theta_c (integral f): its mean square angle per scattering, for the
        # small-angle (Gaussian) aureole of sunlight scattered several times inside the peak (deterministic_terms)
        q = np.where(th < self.theta_c, p - pc, 0.0)
        wq = q * np.sin(th) * 2 * math.pi
        self.aur_v = float(np.trapezoid(wq * th ** 2, th) / np.trapezoid(wq, th) / 2.0)
        self.full_t = np.linspace(0, math.pi, 36001)
        self.full = np.interp(self.full_t, th, p)

    def p_full(self, mu):
        return np.interp(np.arccos(np.clip(mu, -1, 1)), self.th_safe(), self.p)

    def th_safe(self):
        return self.theta

    def p_trunc(self, mu):
        return np.interp(np.arccos(np.clip(mu, -1, 1)), np.linspace(0, math.pi, NT), self.tab)

    def summary(self):
        return dict(reff=self.reff, g=self.g, f=self.f, theta_c_deg=math.degrees(self.theta_c), g_trunc=self.g_trunc,
                    albedo=self.albedo, albedo_scaled=self.albedo_scaled, qext=self.qext, p_c=self.pc)


# ------------------------------------------------------------------------------------------- RNG
@njit(inline='always')
def rnd(st):
    x = st[0]
    x ^= x >> np.uint64(12)
    x ^= x << np.uint64(25)
    x ^= x >> np.uint64(27)
    st[0] = x
    return float((x * np.uint64(2685821657736338717)) >> np.uint64(11)) * (1.0 / 9007199254740992.0)


@njit(inline='always')
def seed(st, a, b):
    z = np.uint64(a) * np.uint64(0x9E3779B97F4A7C15) + np.uint64(b) * np.uint64(0xD1B54A32D192ED03) + np.uint64(1)
    z = (z ^ (z >> np.uint64(30))) * np.uint64(0xBF58476D1CE4E5B9)
    z = (z ^ (z >> np.uint64(27))) * np.uint64(0x94D049BB133111EB)
    z = z ^ (z >> np.uint64(31))
    if z == np.uint64(0):
        z = np.uint64(88172645463325252)
    st[0] = z


# ------------------------------------------------------------------------------------------- grid access
@njit(inline='always')
def _wrap(i, n):
    i = i % n
    return i + n if i < 0 else i


@njit
def sample_grid(g, ox, oy, oz, h, per, x, y, z):
    """Trilinear sample between voxel centres; zero outside (x/z wrap if per)."""
    nx, ny, nz = g.shape
    u = (x - ox) / h - 0.5
    v = (y - oy) / h - 0.5
    w = (z - oz) / h - 0.5
    i0 = int(math.floor(u)); j0 = int(math.floor(v)); k0 = int(math.floor(w))
    fu = u - i0; fv = v - j0; fw = w - k0
    s = 0.0
    for dk in range(2):
        k = k0 + dk
        if per:
            k = _wrap(k, nz)
        elif k < 0 or k >= nz:
            continue
        ww = fw if dk else 1.0 - fw
        for dj in range(2):
            j = j0 + dj
            if j < 0 or j >= ny:
                continue
            wv = fv if dj else 1.0 - fv
            for di in range(2):
                i = i0 + di
                if per:
                    i = _wrap(i, nx)
                elif i < 0 or i >= nx:
                    continue
                s += (fu if di else 1.0 - fu) * wv * ww * g[i, j, k]
    return s


def build_majorant(sig, per=False):
    nx, ny, nz = sig.shape
    mx, my, mz = -(-nx // B), -(-ny // B), -(-nz // B)
    pad = np.pad(sig, 1, mode='wrap' if per else 'constant')
    if per:   # y is never periodic
        pad[:, 0, :] = 0
        pad[:, -1, :] = 0
    out = np.zeros((mx, my, mz), np.float32)
    for a in range(mx):
        for b in range(my):
            for c in range(mz):
                blk = pad[a * B: a * B + B + 2, b * B: b * B + B + 2, c * B: c * B + B + 2]
                out[a, b, c] = blk.max() if blk.size else 0.0
    return out


@njit(parallel=True)
def _majorant_fast(sig, out, per):
    nx, ny, nz = sig.shape
    mx, my, mz = out.shape
    for a in prange(mx):
        for b in range(my):
            for c in range(mz):
                m = 0.0
                for i in range(a * B - 1, a * B + B + 1):
                    ii = i
                    if per:
                        ii = _wrap(i, nx)
                    elif i < 0 or i >= nx:
                        continue
                    for j in range(b * B - 1, b * B + B + 1):
                        if j < 0 or j >= ny:
                            continue
                        for k in range(c * B - 1, c * B + B + 1):
                            kk = k
                            if per:
                                kk = _wrap(k, nz)
                            elif k < 0 or k >= nz:
                                continue
                            v = sig[ii, j, kk]
                            if v > m:
                                m = v
                out[a, b, c] = m


def majorant(sig, per=False):
    nx, ny, nz = sig.shape
    out = np.zeros((-(-nx // B), -(-ny // B), -(-nz // B)), np.float32)
    _majorant_fast(sig, out, per)
    return out


@njit
def march_tau(g, ox, oy, oz, h, per, x, y, z, dx, dy, dz, tmax, step):
    """Optical depth from (x,y,z) along unit (dx,dy,dz) to the box exit (or tmax): midpoint rule, step in metres."""
    nx, ny, nz = g.shape
    # distance to the y-slab exit (and x/z for an isolated box)
    t1 = tmax
    y0, y1 = oy, oy + ny * h
    if dy > 1e-12:
        t1 = min(t1, (y1 - y) / dy)
    elif dy < -1e-12:
        t1 = min(t1, (y0 - y) / dy)
    if not per:
        for (p, d, lo, n) in ((x, dx, ox, nx), (z, dz, oz, nz)):
            if d > 1e-12:
                t1 = min(t1, (lo + n * h - p) / d)
            elif d < -1e-12:
                t1 = min(t1, (lo - p) / d)
    if t1 <= 0:
        return 0.0
    n = int(math.ceil(t1 / step))
    dt = t1 / n
    s = 0.0
    for i in range(n):
        t = (i + 0.5) * dt
        s += sample_grid(g, ox, oy, oz, h, per, x + dx * t, y + dy * t, z + dz * t)
    return s * dt


@njit(parallel=True)
def sun_tau_grid(sig, ox, oy, oz, h, per, Lx, Ly, Lz, out):
    """Optical depth toward the sun at every voxel centre that has cloud within one voxel (else 0 is fine: such
    voxels are only touched by trilinear weights next to cloud, where their own value matters little)."""
    nx, ny, nz = sig.shape
    for i in prange(nx):
        for j in range(ny):
            for k in range(nz):
                near = False
                for a in range(max(i - 1, 0), min(i + 2, nx)):
                    for b in range(max(j - 1, 0), min(j + 2, ny)):
                        for c in range(max(k - 1, 0), min(k + 2, nz)):
                            if sig[a, b, c] > 0:
                                near = True
                if near or per:
                    out[i, j, k] = march_tau(sig, ox, oy, oz, h, per, ox + (i + 0.5) * h, oy + (j + 0.5) * h,
                                             oz + (k + 0.5) * h, Lx, Ly, Lz, 1e9, 0.5 * h)


class Scene:
    """Extinction grid + sun. sig[i, j, k]: i -> x, j -> y (up), k -> z. Origin = corner of voxel (0,0,0)."""

    def __init__(self, sig, h, origin=(0.0, 0.0, 0.0), periodic=False, name='scene'):
        self.sig = np.ascontiguousarray(sig, dtype=np.float32)
        self.h = float(h)
        self.o = np.asarray(origin, np.float64)
        self.per = bool(periodic)
        self.name = name
        self.maj = majorant(self.sig, self.per)
        self.ts = None
        self.L = None

    def set_sun(self, L):
        L = np.asarray(L, np.float64)
        self.L = L / np.linalg.norm(L)
        self.ts = np.zeros_like(self.sig)
        sun_tau_grid(self.sig, self.o[0], self.o[1], self.o[2], self.h, self.per, self.L[0], self.L[1], self.L[2],
                     self.ts)

    @property
    def extent(self):
        n = np.array(self.sig.shape)
        return self.o, self.o + n * self.h

    def args(self):
        return (self.sig, self.maj, self.ts, self.o[0], self.o[1], self.o[2], self.h, self.per)


# ------------------------------------------------------------------------------------------- transport kernels
@njit(inline='always')
def p_tab(tab, mu):
    if mu > 1.0:
        mu = 1.0
    elif mu < -1.0:
        mu = -1.0
    x = math.acos(mu) * ((tab.shape[0] - 1) / math.pi)
    i = int(x)
    if i >= tab.shape[0] - 1:
        return tab[tab.shape[0] - 1]
    f = x - i
    return tab[i] * (1.0 - f) + tab[i + 1] * f


@njit(inline='always')
def sample_mu(cdf, u):
    lo, hi = 0, cdf.shape[0] - 1
    while hi - lo > 1:
        m = (lo + hi) >> 1
        if cdf[m] <= u:
            lo = m
        else:
            hi = m
    c0, c1 = cdf[lo], cdf[hi]
    f = (u - c0) / (c1 - c0) if c1 > c0 else 0.5
    th = (lo + f) * (math.pi / (cdf.shape[0] - 1))
    return math.cos(th)


@njit(inline='always')
def rotate(dx, dy, dz, mu, phi):
    """Direction at angle acos(mu) from (dx,dy,dz), azimuth phi."""
    s = math.sqrt(max(0.0, 1.0 - mu * mu))
    if abs(dz) < 0.999:
        ax, ay, az = -dy, dx, 0.0        # cross(d, z)
    else:
        ax, ay, az = 0.0, -dz, dy        # cross(d, x)
    n = math.sqrt(ax * ax + ay * ay + az * az)
    ax /= n; ay /= n; az /= n
    bx = dy * az - dz * ay
    by = dz * ax - dx * az
    bz = dx * ay - dy * ax
    c, sn = math.cos(phi), math.sin(phi)
    return (mu * dx + s * (c * ax + sn * bx), mu * dy + s * (c * ay + sn * by), mu * dz + s * (c * az + sn * bz))


@njit
def free_flight(sig, maj, ox, oy, oz, h, per, scale, px, py, pz, rx, ry, rz, st):
    """Delta tracking in scale*sigma along r from p. Returns (collided, x, y, z)."""
    nx, ny, nz = sig.shape
    mx, my, mz = maj.shape
    hb = h * B
    Wx, Wz = nx * h, nz * h
    ytop = oy + ny * h
    for _ in range(100000):
        if py < oy or py > ytop:
            return False, px, py, pz
        if per:
            if px < ox or px >= ox + Wx:
                px = ox + ((px - ox) % Wx)
            if pz < oz or pz >= oz + Wz:
                pz = oz + ((pz - oz) % Wz)
        elif px < ox or px > ox + Wx or pz < oz or pz > oz + Wz:
            return False, px, py, pz
        ci = min(int((px - ox) / hb), mx - 1)
        cj = min(int((py - oy) / hb), my - 1)
        ck = min(int((pz - oz) / hb), mz - 1)
        # exit distance of this supercell
        te = 1e30
        if rx > 1e-12:
            te = min(te, (ox + (ci + 1) * hb - px) / rx)
        elif rx < -1e-12:
            te = min(te, (ox + ci * hb - px) / rx)
        if ry > 1e-12:
            te = min(te, (oy + (cj + 1) * hb - py) / ry)
        elif ry < -1e-12:
            te = min(te, (oy + cj * hb - py) / ry)
        if rz > 1e-12:
            te = min(te, (oz + (ck + 1) * hb - pz) / rz)
        elif rz < -1e-12:
            te = min(te, (oz + ck * hb - pz) / rz)
        te = max(te, 0.0)
        m = maj[ci, cj, ck] * scale
        if m > 0.0:
            t = -math.log(1.0 - rnd(st)) / m
            if t < te:
                px += rx * t; py += ry * t; pz += rz * t
                s = sample_grid(sig, ox, oy, oz, h, per, px, py, pz) * scale
                if rnd(st) * m < s:
                    return True, px, py, pz
                continue
        eps = 1e-4 * h
        px += rx * (te + eps); py += ry * (te + eps); pz += rz * (te + eps)
    return False, px, py, pz


@njit
def walk(sig, maj, ts, ox, oy, oz, h, per, scale, alb, Lx, Ly, Lz, tab, cdf,
         px, py, pz, wx, wy, wz, st, res):
    """Adjoint walk from p: the light arriving at p travels along w (first incoming propagation direction).
    Adds to res[c, s] (c = R, G, B single-scattering albedo alb[c] of the scaled medium; s = sun, sky, ground)
    the contributions per unit E_sun / unit sky radiance / unit ground radiance. The three colours share one walk
    (the phase function is the green one; only absorption differs, applied as a weight per collision)."""
    w0 = 1.0
    w1 = 1.0
    w2 = 1.0
    for n in range(MAX_COLL):
        hit, px, py, pz = free_flight(sig, maj, ox, oy, oz, h, per, scale, px, py, pz, -wx, -wy, -wz, st)
        if not hit:
            s = 1 if -wy > 0.0 else 2
            res[0, s] += w0
            res[1, s] += w1
            res[2, s] += w2
            return
        w0 *= alb[0]
        w1 *= alb[1]
        w2 *= alb[2]
        # next-event estimation toward the sun: light travelling along s = -L scattered into w
        tau = sample_grid(ts, ox, oy, oz, h, per, px, py, pz) * scale
        if tau < 60.0:
            e = p_tab(tab, -(Lx * wx + Ly * wy + Lz * wz)) * math.exp(-tau)
            res[0, 0] += w0 * e
            res[1, 0] += w1 * e
            res[2, 0] += w2 * e
        mu = sample_mu(cdf, rnd(st))
        wx, wy, wz = rotate(wx, wy, wz, mu, 2.0 * math.pi * rnd(st))


@njit(parallel=True)
def estimate_points(sig, maj, ts, ox, oy, oz, h, per, f, alb, Lx, Ly, Lz, tab, cdf, P, D, nA, nB, seed0, out):
    """Points P[i], view D[i] (direction of light travel toward the viewer). out[i] (15 values):
    [0:3]  J_ms R, G, B      [3:6] V_sky R, G, B     [6:9] V_gnd R, G, B
    [9:12] variance of the mean of J_ms, V_sky, V_gnd (green)   [12] diffuse-walk sun mean  [13] peak-walk sun mean"""
    scale = 1.0 - f
    n = P.shape[0]
    for i in prange(n):
        st = np.zeros(1, np.uint64)
        seed(st, seed0, i)
        px, py, pz = P[i, 0], P[i, 1], P[i, 2]
        dx, dy, dz = D[i, 0], D[i, 1], D[i, 2]
        res = np.zeros((3, 3))
        acc = np.zeros((3, 3))
        q = np.zeros(3)
        sumA = 0.0
        sumB = 0.0
        for k in range(nA + nB):
            res[:, :] = 0.0
            if k < nA:
                mu = sample_mu(cdf, rnd(st))
                wx, wy, wz = rotate(dx, dy, dz, mu, 2.0 * math.pi * rnd(st))
                wt = (1.0 - f) / nA
            else:
                wx, wy, wz = dx, dy, dz
                wt = f / nB
            walk(sig, maj, ts, ox, oy, oz, h, per, scale, alb, Lx, Ly, Lz, tab, cdf, px, py, pz, wx, wy, wz, st, res)
            for c in range(3):
                for s_ in range(3):
                    acc[c, s_] += wt * res[c, s_]
            # variance of the weighted sum (green), per-sample contribution wt*res, two strata
            for s_ in range(3):
                q[s_] += (wt * res[1, s_]) ** 2
            if k < nA:
                sumA += res[1, 0]
            else:
                sumB += res[1, 0]
        for c in range(3):
            for s_ in range(3):
                out[i, 3 * s_ + c] = acc[c, s_]
        # crude variance of the mean (ignores the stratum means: slight overestimate, fine for weighting)
        for s_ in range(3):
            out[i, 9 + s_] = q[s_]
        out[i, 12] = sumA / max(nA, 1)
        out[i, 13] = sumB / max(nB, 1)


def estimate(scene, phase, P, D, nA=64, nB=32, seed0=1):
    out = np.zeros((len(P), 15))
    L = scene.L
    estimate_points(*scene.args(), phase.f, phase.alb3, L[0], L[1], L[2], phase.tab, phase.cdf,
                    np.ascontiguousarray(P, np.float64), np.ascontiguousarray(D, np.float64), nA, nB, seed0, out)
    return out


@njit(parallel=True)
def tau_points(sig, ox, oy, oz, h, per, P, Dir, step, out):
    for i in prange(P.shape[0]):
        out[i] = march_tau(sig, ox, oy, oz, h, per, P[i, 0], P[i, 1], P[i, 2], Dir[i, 0], Dir[i, 1], Dir[i, 2], 1e9,
                           step)


def tau_to(scene, P, Dir, step=None):
    out = np.zeros(len(P))
    Dir = np.broadcast_to(np.asarray(Dir, np.float64), P.shape)
    tau_points(scene.sig, scene.o[0], scene.o[1], scene.o[2], scene.h, scene.per, np.ascontiguousarray(P, np.float64),
               np.ascontiguousarray(Dir), step or 0.5 * scene.h, out)
    return out


AUR_N = 6


def aureole(f, v, cos_t, tau_sun, n_max=AUR_N):
    """Sunlight scattered n >= 1 times inside the narrow diffraction peak (Poisson weights e^-tau (f tau)^n / n!) has a
    small-angle spread of variance n v per axis; the last scattering toward the viewer adds the peak once more. The
    delta-M split treats all of it as collimated (it only keeps the broad part min(p, p_c)); this adds the peak part
    f G_{(n+1) v}(theta), G_v(theta) = exp(-theta^2 / (2 v)) / (2 pi v) (per steradian, small angles)."""
    th2 = 2.0 * (1.0 - np.clip(cos_t, -1, 1))          # ~ theta^2 for small angles
    t = np.maximum(tau_sun, 0.0)
    out = np.zeros_like(th2)
    term = np.exp(-t)
    for n in range(1, n_max + 1):
        term = term * f * t / n
        vn = (n + 1) * v
        out = out + term * np.exp(-th2 / (2 * vn)) / (2 * math.pi * vn)
    return f * out


def deterministic_terms(phase, cos_t, tau_sun, aureole_term=True):
    """J_ss (exact single scattering, full phase) and J_fp (forward-peak transport), per unit E_sun."""
    th = np.arccos(np.clip(cos_t, -1, 1))
    p = np.interp(th, phase.theta, phase.p)
    pt_ = np.interp(th, np.linspace(0, math.pi, NT), phase.tab) * (1 - phase.f)   # = p outside theta_c, p_c inside
    jss = p * np.exp(-tau_sun)
    jfp = pt_ * (np.exp(-(1 - phase.f) * tau_sun) - np.exp(-tau_sun))
    if aureole_term:
        jfp = jfp + aureole(phase.f, phase.aur_v, cos_t, tau_sun)
    return jss, jfp


# ------------------------------------------------------------------------------------------- forward photon MC
@njit(parallel=True)
def forward_slab(tau, mu0, pcdf, alb, nphot, seed0, nbins, hist_r, hist_t, counts):
    """Plane-parallel slab of optical thickness tau (unit extinction), sun at cos zenith mu0 from above, phase
    function given by its CDF over a uniform theta grid (the FULL Mie function for validation). counts = [R, T,
    absorbed, T_direct] photon fractions; hist_r / hist_t: scattered photons leaving the top / bottom binned by
    |cos(zenith)| (azimuthally averaged)."""
    nthr = 64
    acc = np.zeros((nthr, 4))
    hr = np.zeros((nthr, nbins))
    ht = np.zeros((nthr, nbins))
    per = nphot // nthr
    for tid in prange(nthr):
        st = np.zeros(1, np.uint64)
        seed(st, seed0, tid)
        for k in range(per):
            z = tau
            dx, dy, dz = math.sqrt(max(0.0, 1 - mu0 * mu0)), 0.0, -mu0
            w = 1.0
            nsc = 0
            while True:
                s = -math.log(1.0 - rnd(st))
                z += dz * s
                if z >= tau:
                    acc[tid, 0] += w
                    hr[tid, min(int(dz * nbins), nbins - 1)] += w
                    break
                if z <= 0.0:
                    if nsc == 0:
                        acc[tid, 3] += w
                    else:
                        acc[tid, 1] += w
                        ht[tid, min(int(-dz * nbins), nbins - 1)] += w
                    break
                acc[tid, 2] += w * (1.0 - alb)
                w *= alb
                nsc += 1
                mu = sample_mu(pcdf, rnd(st))
                dx, dy, dz = rotate(dx, dy, dz, mu, 2.0 * math.pi * rnd(st))
    tot = per * nthr
    for t in range(nthr):
        for c in range(4):
            counts[c] += acc[t, c] / tot
        for b in range(nbins):
            hist_r[b] += hr[t, b] / tot
            hist_t[b] += ht[t, b] / tot


@njit(parallel=True)
def forward_aureole(tau, cdf, nphot, seed0, dth, nbins, hist, counts):
    """Sun at zenith on a slab of optical thickness tau, FULL phase: scattered photons leaving the bottom binned by
    their angle from the beam (bins of dth radians)."""
    nthr = 64
    h = np.zeros((nthr, nbins))
    per = nphot // nthr
    for tid in prange(nthr):
        st = np.zeros(1, np.uint64)
        seed(st, seed0, tid)
        for k in range(per):
            z = tau
            dx, dy, dz = 0.0, 0.0, -1.0
            nsc = 0
            while True:
                z += dz * (-math.log(1.0 - rnd(st)))
                if z >= tau:
                    break
                if z <= 0.0:
                    if nsc > 0:
                        a = math.acos(min(1.0, -dz))
                        b = int(a / dth)
                        if b < nbins:
                            h[tid, b] += 1.0
                    break
                nsc += 1
                mu = sample_mu(cdf, rnd(st))
                dx, dy, dz = rotate(dx, dy, dz, mu, 2.0 * math.pi * rnd(st))
    for t in range(nthr):
        for b in range(nbins):
            hist[b] += h[t, b] / (per * nthr)
