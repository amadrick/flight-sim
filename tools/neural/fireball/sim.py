"""Reference simulator for buoyant fuel-air fireballs (crash fires), Skyward.

A small 3-D incompressible-with-dilatation solver in Froude-scaled units:
    length unit  D   = fireball diameter (Roberts / HSE correlation D = 5.8 m_fuel^(1/3) m, m in kg)
    time unit    t*  = sqrt(D / g)
    velocity     sqrt(g D)
so for a given fuel mass the fireball evolution depends (ignoring Reynolds-number effects) only on
    Fw = wind speed at z = D           / sqrt(g D)      (power-law boundary layer, exponent 1/7)
    Ui = forward speed of the fuel spray / sqrt(g D)     (from the impact velocity, along +x)
The wind blows along +x, the impact throws fuel along +x as well, so the flow is symmetric about y = 0 and only
y >= 0 is simulated (mirror plane).

Fields (cell centred, shape (NX, NY, NZ)):
    u, v, w   velocity perturbation (the background wind U(z) x is added for advection / shear production)
    F         fuel mass fraction (1 = neat kerosene aerosol)
    O         oxygen, relative to air (1 = ambient air)
    T         temperature excess theta = (T - T0) / T0
    S         soot mass fraction (arbitrary units; rendered density = S / (1 + theta))
Physics per step:
    combustion   r = k F O ign(theta)          mixing-limited (a fuel-rich core burns from its surface inward)
    oxygen       dO = -s r  (s = 14.8: kerosene needs 3.4 kg O2 per kg, air is 23 % O2)
    heat         dtheta = Q r - radiative loss (soot-weighted, ~ T^4-ish)
    soot         produced ~ r (more in rich zones), oxidised where hot and lean
    dilatation   div u = (Q r - loss) / (1 + theta)    (ideal gas at constant pressure: the fast bright expansion)
    buoyancy     b = theta / (1 + theta)               (non-Boussinesq density ratio, g = 1)
    vorticity confinement, pool fire source on the ground, wind shear production, sponge layers at the outflow / lid
Numerics: semi-Lagrangian advection (RK2 back-trace, trilinear; numba), pressure projection done spectrally on
the mirror-extended domain (x periodic with a downwind sponge, mirror at y = 0 / y = Ymax, ground and lid as mirror
planes with w odd), which enforces the prescribed divergence exactly.

    python sim.py --fw 0.4 --ui 1.0 --seed 3 --out data/run.npz          # one run
    python sim.py --batch 0:64 --out data                                 # the training / test set
"""
import argparse, os, sys, time, json
import numpy as np
import numba as nb

# ----------------------------------------------------------------------------------------------- configuration
X0, X1 = -2.4, 8.0          # domain (units of D)
YM = 2.6
ZM = 7.2
DX = 0.1
NX, NY, NZ = int(round((X1 - X0) / DX)), int(round(YM / DX)), int(round(ZM / DX))
T_END = 20.0
DT = 0.04
SAVE_T = np.array([0.05, 0.1, 0.17, 0.25, 0.35, 0.5, 0.7, 0.9, 1.15, 1.45, 1.8, 2.2, 2.7, 3.3, 4.0, 4.8, 5.7,
                   6.7, 7.8, 9.0, 10.5, 12.0, 14.0, 16.0, 18.0, 20.0])

PHYS = dict(k=25.0, s=14.8, Q=95.0, ign0=0.35, ign1=1.1, rad=0.05, radS=0.9, ys=0.10, ysRich=0.35, kox=1.2,
            conf=0.8, pool=0.12, poolR=0.30, poolTau=40.0, F0=0.35, O0=0.6, R0=0.22, kernelT=3.0,
            kap=0.035, smag=0.3)


def grid():
    x = X0 + (np.arange(NX) + 0.5) * DX
    y = (np.arange(NY) + 0.5) * DX
    z = (np.arange(NZ) + 0.5) * DX
    return x, y, z


def wind_profile(z, fw):
    return fw * np.clip(z, 0.02, None) ** (1.0 / 7.0)


# ----------------------------------------------------------------------------------------------- advection (numba)
@nb.njit(cache=True, fastmath=True, inline='always')
def _sample(a, fx, fy, fz, sy):
    """trilinear sample at fractional cell coords; x periodic, y mirrored at 0 (sign sy for odd fields), z clamped."""
    nx, ny, nz = a.shape
    i0 = int(np.floor(fx)); tx = fx - i0
    j0 = int(np.floor(fy)); ty = fy - j0
    k0 = int(np.floor(fz)); tz = fz - k0
    acc = 0.0
    for dj in range(2):
        j = j0 + dj
        s = 1.0
        if j < 0:
            j = -j - 1; s = sy
        if j > ny - 1:
            j = 2 * ny - 1 - j; s = sy
        wy = ty if dj == 1 else 1.0 - ty
        for dk in range(2):
            k = k0 + dk
            if k < 0: k = 0
            if k > nz - 1: k = nz - 1
            wz = tz if dk == 1 else 1.0 - tz
            for di in range(2):
                i = (i0 + di) % nx
                wx = tx if di == 1 else 1.0 - tx
                acc += s * wx * wy * wz * a[i, j, k]
    return acc


@nb.njit(parallel=True, cache=True, fastmath=True)
def advect_all(u, v, w, Ubg, dt, dx, fields, signs, out):
    """Back-trace every cell (RK2 midpoint) with the total velocity and sample all fields there."""
    nx, ny, nz = u.shape
    nf = fields.shape[0]
    for i in nb.prange(nx):
        for j in range(ny):
            for k in range(nz):
                ux = u[i, j, k] + Ubg[k]; uy = v[i, j, k]; uz = w[i, j, k]
                mx = i - 0.5 * dt * ux / dx; my = j - 0.5 * dt * uy / dx; mz = k - 0.5 * dt * uz / dx
                kk = min(max(mz, 0.0), nz - 1.0)
                k0 = int(kk); t = kk - k0; k1 = min(k0 + 1, nz - 1)
                ub = Ubg[k0] * (1 - t) + Ubg[k1] * t
                ux = _sample(u, mx, my, mz, 1.0) + ub
                uy = _sample(v, mx, my, mz, -1.0)
                uz = _sample(w, mx, my, mz, 1.0)
                px = i - dt * ux / dx; py = j - dt * uy / dx; pz = k - dt * uz / dx
                for f in range(nf):
                    out[f, i, j, k] = _sample(fields[f], px, py, pz, signs[f])


# ----------------------------------------------------------------------------------------------- projection
class Projector:
    def __init__(self):
        kx = 2 * np.pi * np.fft.fftfreq(NX, DX)
        ky = 2 * np.pi * np.fft.fftfreq(2 * NY, DX)
        kz = 2 * np.pi * np.fft.rfftfreq(2 * NZ, DX)
        self.KX, self.KY, self.KZ = np.meshgrid(kx, ky, kz, indexing='ij')
        k2 = self.KX ** 2 + self.KY ** 2 + self.KZ ** 2
        k2[0, 0, 0] = 1.0
        self.ik2 = 1.0 / k2
        # 2/3 de-aliasing-ish low-pass (keeps the spectral projection from ringing on sharp fronts)
        kmax = np.pi / DX
        kr = np.sqrt(self.KX ** 2 + self.KY ** 2 + self.KZ ** 2) / kmax
        self.filt = np.exp(-36.0 * np.clip(kr - 0.55, 0, None) ** 4)

    @staticmethod
    def ext(a, sy, sz):
        e = np.empty((NX, 2 * NY, 2 * NZ), np.float64)
        e[:, :NY, :NZ] = a
        e[:, NY:, :NZ] = sy * a[:, ::-1, :]
        e[:, :, NZ:] = sz * e[:, :, :NZ][:, :, ::-1]
        return e

    def project(self, u, v, w, D):
        U = np.fft.rfftn(self.ext(u, 1, 1)); V = np.fft.rfftn(self.ext(v, -1, 1)); W = np.fft.rfftn(self.ext(w, 1, -1))
        Dh = np.fft.rfftn(self.ext(D, 1, 1))
        kd = (self.KX * U + self.KY * V + self.KZ * W) * self.ik2
        corr = -1j * Dh * self.ik2
        U = (U - self.KX * kd + self.KX * corr) * self.filt
        V = (V - self.KY * kd + self.KY * corr) * self.filt
        W = (W - self.KZ * kd + self.KZ * corr) * self.filt
        U[0, 0, 0] = 0
        s = (NX, 2 * NY, 2 * NZ)
        u[:] = np.fft.irfftn(U, s, axes=(0, 1, 2))[:, :NY, :NZ]
        v[:] = np.fft.irfftn(V, s, axes=(0, 1, 2))[:, :NY, :NZ]
        w[:] = np.fft.irfftn(W, s, axes=(0, 1, 2))[:, :NY, :NZ]


# ----------------------------------------------------------------------------------------------- helpers
def ddx(a):
    return (np.roll(a, -1, 0) - np.roll(a, 1, 0)) / (2 * DX)


def ddy(a, s):
    p = np.concatenate([s * a[:, :1], a, s * a[:, -1:]], 1)
    return (p[:, 2:] - p[:, :-2]) / (2 * DX)


def ddz(a, s):
    p = np.concatenate([s * a[:, :, :1], a, s * a[:, :, -1:]], 2)
    return (p[:, :, 2:] - p[:, :, :-2]) / (2 * DX)


def lap(a):
    p = np.pad(a, ((0, 0), (1, 1), (1, 1)), mode='edge')
    return (np.roll(a, 1, 0) + np.roll(a, -1, 0) + p[:, 2:, 1:-1] + p[:, :-2, 1:-1] + p[:, 1:-1, 2:] + p[:, 1:-1, :-2] - 6 * a) / (DX * DX)


def smooth01(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def run(fw, ui, seed, phys=PHYS, verbose=False, save_t=SAVE_T):
    rng = np.random.default_rng(seed)
    P = phys
    x, y, z = grid()
    X, Y, Z = np.meshgrid(x, y, z, indexing='ij')
    f32 = np.float32
    u = np.zeros((NX, NY, NZ)); v = np.zeros_like(u); w = np.zeros_like(u)
    Ubg = wind_profile(z, fw)
    dUdz = np.gradient(Ubg, DX)
    # initial fuel cloud: ellipsoid thrown forward by the impact, sitting on the ground, lumpy
    ax = P['R0'] * (1.0 + 0.55 * ui); ay = P['R0'] * (1.0 + 0.12 * ui); az = P['R0'] * (0.75 + 0.1 * ui)
    cx = 0.15 * ui
    lump = np.zeros_like(u)
    for _ in range(14):   # random lumps (a spray of fuel is not a smooth ellipsoid)
        px, py, pz = cx + rng.normal(0, ax * 0.7), abs(rng.normal(0, ay * 0.6)), abs(rng.normal(az * 0.6, az * 0.4))
        rr = rng.uniform(0.35, 0.8) * P['R0']
        lump += np.exp(-((X - px) ** 2 + (Y - py) ** 2 + (Z - pz) ** 2) / (rr * rr))
    ell = np.exp(-(((X - cx) / ax) ** 2 + (Y / ay) ** 2 + ((Z - az * 0.6) / az) ** 2) ** 1.5)
    F = P['F0'] * np.clip(ell * (0.6 + 0.4 * np.minimum(lump, 1.5)), 0, 1)
    O = 1.0 - (1.0 - P['O0']) * np.clip(ell * 1.4, 0, 1)
    # ignition kernel at the impact point (the spray ignites on contact)
    Tt = P['kernelT'] * np.exp(-(((X - cx + 0.3 * ax) ** 2 + Y ** 2 + (Z - 0.12) ** 2) / (0.12 ** 2)))
    S = np.zeros_like(u)
    # initial spray momentum: forward ui, slight upward and outward splash
    ww = np.clip(ell * 1.2, 0, 1)
    u += ww * ui * 0.9
    w += ww * (0.25 + 0.2 * ui)
    v += ww * 0.35 * ui * (Y / (ay + 1e-6)) * 0.5
    proj = Projector()
    # sponge masks
    sp = (smooth01(X1 - 1.6, X1, X) + smooth01(X0 + 0.9, X0, X) + smooth01(ZM - 1.2, ZM, Z) + smooth01(YM - 0.5, YM, Y))
    sp = np.clip(sp, 0, 1) * 3.0
    pool = np.exp(-((X - cx * 0.6) ** 2 / (P['poolR'] * (1 + 0.6 * ui)) ** 2 + Y ** 2 / P['poolR'] ** 2)) * (Z < 0.16)
    fields = np.empty((7, NX, NY, NZ), np.float64); outb = np.empty_like(fields)
    signs = np.array([1.0, -1.0, 1.0, 1.0, 1.0, 1.0, 1.0])
    snaps = []; si = 0; t = 0.0; step = 0
    tw = time.time()
    noise_phase = rng.uniform(0, 6.28, 6)
    while si < len(save_t):
        dt = DT if t > 0.5 else 0.02
        # --- reaction
        ign = smooth01(P['ign0'], P['ign1'], Tt)
        r = P['k'] * F * np.clip(O, 0, 1) * ign
        r = np.minimum(r, F / dt * 0.9)
        r = np.minimum(r, np.clip(O, 0, None) / (P['s'] * dt) * 0.9)
        heat = P['Q'] * r
        # radiative loss: ~soot-weighted T^4 (normalised), plus a weak gas term
        loss = P['rad'] * Tt * (1 + Tt) ** 2 / 25.0 * (1 + P['radS'] * np.minimum(S * 20, 3))
        D = (heat - loss) / (1 + Tt)
        rich = np.clip(F / (F + O / P['s'] + 1e-6), 0, 1)
        S = S + dt * (P['ys'] * r * (1 + P['ysRich'] * 10 * rich) - P['kox'] * S * np.clip(O, 0, 1) * smooth01(2.5, 5.0, Tt))
        F = F - r * dt
        O = O - P['s'] * r * dt
        Tt = Tt + dt * (heat - loss)
        # pool fire on the ground (burning fuel left in the wreck), slowly decaying
        if t > 0.3:
            pr = P['pool'] * np.exp(-t / P['poolTau']) * dt
            flick = 1 + 0.3 * np.sin(1.7 * t + noise_phase[0]) * np.sin(0.63 * t + noise_phase[1])
            F = F + pool * pr * flick
            Tt = np.maximum(Tt, pool * 1.5)
        # --- forces
        b = Tt / (1 + Tt)
        w += dt * b
        u -= dt * w * dUdz[None, None, :]
        # vorticity confinement
        ox = ddy(w, 1) - ddz(v, 1)
        oy = ddz(u, 1) - ddx(w)
        oz = ddx(v) - ddy(u, 1)
        om = np.sqrt(ox * ox + oy * oy + oz * oz)
        gx, gy, gz = ddx(om), ddy(om, 1), ddz(om, 1)
        gn = np.sqrt(gx * gx + gy * gy + gz * gz) + 1e-8
        nx_, ny_, nz_ = gx / gn, gy / gn, gz / gn
        e = P['conf'] * DX
        u += dt * e * (ny_ * oz - nz_ * oy)
        v += dt * e * (nz_ * ox - nx_ * oz)
        w += dt * e * (nx_ * oy - ny_ * ox)
        # sponge
        damp = np.exp(-sp * dt)
        u *= damp; v *= damp; w *= damp
        S *= damp; Tt *= damp; F *= damp
        O = 1 - (1 - O) * damp
        # --- turbulent mixing of the scalars (constant floor + Smagorinsky-like eddy diffusivity from |vorticity|)
        kap = P['kap'] + (P['smag'] * DX) ** 2 * om
        kap = np.minimum(kap, 0.3 * DX * DX / dt)
        for _ in range(2):
            for a_ in (F, S, Tt):
                a_ += 0.5 * dt * kap * lap(a_)
            O = O + 0.5 * dt * kap * lap(O - 1.0)
        # --- project (prescribed dilatation)
        proj.project(u, v, w, D)
        # --- advect
        fields[0] = u; fields[1] = v; fields[2] = w; fields[3] = F; fields[4] = O; fields[5] = Tt; fields[6] = S
        advect_all(u, v, w, Ubg, dt, DX, fields, signs, outb)
        u, v, w, F, O, Tt, S = [outb[i].copy() for i in range(7)]
        F = np.clip(F, 0, None); S = np.clip(S, 0, None); Tt = np.clip(Tt, 0, None); O = np.clip(O, 0, 1)
        t += dt; step += 1
        if t >= save_t[si] - 1e-6:
            snaps.append(np.stack([S / (1 + Tt), Tt, r]).astype(np.float16))
            if verbose:
                print(f't={t:6.2f} step={step} wall={time.time() - tw:6.1f}s  Tmax={Tt.max():.2f} Smax={S.max():.3f} Fsum={F.sum() * DX ** 3:.4f} '
                      f'wmax={w.max():.2f} rmax={r.max():.2f}', flush=True)
            si += 1
    return np.stack(snaps)   # (nt, 3, NX, NY, NZ)


# ----------------------------------------------------------------------------------------------- batch design
def design(n=48, seed=7):
    """Latin-hypercube-ish design over (Fw, Ui) plus a few corners; index -> (fw, ui, seed)."""
    rng = np.random.default_rng(seed)
    pts = [(0.0, 0.0), (0.0, 2.5), (1.2, 0.0), (1.2, 2.5), (0.5, 1.2), (0.0, 1.0), (0.8, 0.5), (0.25, 2.0)]
    m = n - len(pts)
    a = (rng.permutation(m) + rng.uniform(0, 1, m)) / m
    b = (rng.permutation(m) + rng.uniform(0, 1, m)) / m
    pts += [(1.2 * a[i] ** 1.2, 2.5 * b[i]) for i in range(m)]
    return [(float(fw), float(ui), 1000 + i) for i, (fw, ui) in enumerate(pts)]


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--fw', type=float, default=0.4)
    ap.add_argument('--ui', type=float, default=1.0)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--batch', default=None, help='a:b  range of design indices')
    ap.add_argument('--stride', type=int, default=1)
    ap.add_argument('--out', default='data/run.npz')
    ap.add_argument('--tend', type=float, default=None)
    a = ap.parse_args()
    if a.batch:
        lo, hi = map(int, a.batch.split(':'))
        os.makedirs(a.out, exist_ok=True)
        D = design()
        for i in range(lo, hi, a.stride):
            fn = os.path.join(a.out, f'run{i:03d}.npz')
            if os.path.exists(fn):
                continue
            fw, ui, sd = D[i]
            t0 = time.time()
            snaps = run(fw, ui, sd)
            np.savez_compressed(fn, snaps=snaps, fw=fw, ui=ui, seed=sd, t=SAVE_T, dx=DX, x0=X0, shape=np.array([NX, NY, NZ]))
            print(f'run {i}: fw={fw:.2f} ui={ui:.2f} {time.time() - t0:.0f}s', flush=True)
    else:
        st = SAVE_T if a.tend is None else SAVE_T[SAVE_T <= a.tend]
        snaps = run(a.fw, a.ui, a.seed, verbose=True, save_t=st)
        os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
        np.savez_compressed(a.out, snaps=snaps, fw=a.fw, ui=a.ui, seed=a.seed, t=st, dx=DX, x0=X0, shape=np.array([NX, NY, NZ]))
