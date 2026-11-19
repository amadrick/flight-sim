"""Small moist-Boussinesq large-eddy simulation of shallow / congestus cumulus (numpy only).

Purpose: a physical reference for cloud SHAPE (not lighting).  The real-time cloud density model
(src/clouds/shaders.js) is fitted to statistics of the clouds this produces: the cloud-fraction profile, how the
width of a cloud changes from base to top, how flat the bases are, how far towers lean in shear, how liquid water
grows with height, the size distribution.  See les_stats.py.

Model (in the spirit of the BOMEX shallow-cumulus intercomparison, Siebesma et al. 2003, and of the graphics cloud
simulation of Harris et al. 2003):
  * Boussinesq momentum, buoyancy b = g [(theta_v - <theta_v>) / theta_ref - q_l]
  * conserved thermodynamics: liquid-water potential temperature theta_l and total water q_t; q_l from a saturation
    adjustment (one Newton step on the Clausius-Clapeyron curve) -> condensation, latent heating, sharp cloud bases
    at the lifting condensation level
  * semi-Lagrangian MacCormack advection (unconditionally stable, little numerical diffusion), Leray projection by FFT
    (periodic horizontally, mirrored vertically so w = 0 at the ground and at the lid)
  * surface sensible / latent heat flux with a patchy pattern (seeds thermals), BOMEX-like large-scale subsidence and
    radiative cooling, mean wind with shear (towers lean), sponge layer under the lid
  * implicit LES: the numerical diffusion of the advection is the subgrid model

Cases:  'bomex'  trade-wind shallow cumulus (humilis / mediocris, tops ~1.5-2 km)
        'congestus' weaker inversion, moister cloud layer: deeper towers (congestus) in the same set-up

    OMP_NUM_THREADS=1 nice -n 10 python3 les_cumulus.py --case bomex --minutes 100
writes gt_data/les_<case>.npz (q_l snapshots, float16) and checkpoints in gt_data/les_<case>_ckpt.npz.
"""
import argparse
import os
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'gt_data')

G, CP, RD, RV, LV = 9.81, 1004.0, 287.0, 461.5, 2.5e6
TH_REF = 300.0


def qsat(T, p):
    es = 610.78 * np.exp(17.27 * (T - 273.15) / (T - 35.86))
    return 0.622 * es / (p - 0.378 * es)


def interp_profile(z, pts):
    zz, vv = zip(*pts)
    return np.interp(z, zz, vv)


class LES:
    def __init__(self, case='bomex', nx=48, nz=56, dx=100.0, dz=50.0, seed=1):
        self.case, self.nx, self.nz, self.dx, self.dz = case, nx, nz, dx, dz
        self.z = (np.arange(nz) + 0.5) * dz
        z = self.z
        self.rng = np.random.default_rng(seed)
        # hydrostatic reference pressure / Exner function
        self.p = 101500.0 * (1.0 - G * z / (CP * TH_REF)) ** (CP / RD)     # BOMEX surface pressure 1015 hPa
        self.exner = (self.p / 1e5) ** (RD / CP)
        if case == 'bomex':
            th = [(0, 298.7), (520, 298.7), (1480, 302.4), (2000, 308.2), (4000, 315.5)]
            qt = [(0, 17.0e-3), (520, 16.3e-3), (1480, 10.7e-3), (2000, 4.2e-3), (4000, 3.0e-3)]
            u = [(0, -8.75), (700, -8.75), (3000, -4.61)]
            self.sub_top = 1500.0
            self.shf, self.lhf = 8e-3, 5.2e-5          # K m/s, kg/kg m/s
        else:  # congestus: conditionally unstable deeper layer, inversion near 2.4 km
            th = [(0, 298.7), (520, 298.7), (2300, 304.6), (2600, 309.0), (4000, 314.0)]
            qt = [(0, 17.5e-3), (520, 16.8e-3), (2300, 11.0e-3), (2600, 4.0e-3), (4000, 3.0e-3)]
            u = [(0, -6.0), (700, -6.0), (3000, 0.0)]
            self.sub_top = 1800.0
            self.shf, self.lhf = 1.6e-2, 8.0e-5
        self.th0 = interp_profile(z, th)
        self.qt0 = interp_profile(z, qt)
        self.u0 = interp_profile(z, u)
        shp = (nx, nx, nz)
        self.thl = np.broadcast_to(self.th0, shp).copy()
        self.qt = np.broadcast_to(self.qt0, shp).copy()
        low = z < 500
        self.thl[:, :, low] += self.rng.uniform(-0.1, 0.1, (nx, nx, low.sum()))
        self.qt[:, :, low] += self.rng.uniform(-2.5e-5, 2.5e-5, (nx, nx, low.sum()))
        self.u = np.broadcast_to(self.u0, shp).copy()
        self.v = np.zeros(shp)
        self.w = np.zeros(shp)
        self.t = 0.0
        # spectral projection set-up (x, y periodic; z mirrored to 2 nz)
        kx = 2 * np.pi * np.fft.fftfreq(nx, dx)
        kz = 2 * np.pi * np.fft.fftfreq(2 * nz, dz)
        self.KX, self.KY, self.KZ = np.meshgrid(kx, kx, kz, indexing='ij')
        K2 = self.KX ** 2 + self.KY ** 2 + self.KZ ** 2
        K2[0, 0, 0] = 1.0
        self.iK2 = 1.0 / K2
        # sponge in the top 20 % of the domain
        self.sponge = np.clip((z - 0.8 * z[-1]) / (0.2 * z[-1]), 0, 1) ** 2 / 300.0
        # patchy surface flux pattern (renewed slowly)
        self.flux_pat = self._pattern()
        self.idx = np.indices(shp).astype(np.float64)

    def _pattern(self):
        n = self.nx
        f = np.fft.fft2(self.rng.standard_normal((n, n)))
        k = np.sqrt(np.add.outer(np.fft.fftfreq(n) ** 2, np.fft.fftfreq(n) ** 2)) * n * self.dx
        f *= np.exp(-(k / 1500.0) ** 2) * (k > 0)       # ~1-2 km patches
        pat = np.real(np.fft.ifft2(f))
        return 1.0 + 0.6 * pat / (pat.std() + 1e-12)

    # -------------------------------------------------------------------------------------------- thermodynamics
    def ql(self, thl=None, qt=None):
        thl = self.thl if thl is None else thl
        qt = self.qt if qt is None else qt
        Tl = thl * self.exner
        qs = qsat(Tl, self.p)
        dqs = qs * 17.27 * (273.15 - 35.86) / (Tl - 35.86) ** 2
        ql = np.maximum(qt - qs, 0.0) / (1.0 + LV / CP * dqs)
        return ql

    def buoyancy(self):
        ql = self.ql()
        th = self.thl + LV / (CP * self.exner) * ql
        thv = th * (1.0 + 0.61 * self.qt - 1.61 * ql)
        return G * (thv - thv.mean(axis=(0, 1))) / TH_REF, ql

    # -------------------------------------------------------------------------------------------- advection
    def _interp(self, fields, X, Y, Z, minmax=False):
        nx, nz = self.nx, self.nz
        Z = np.clip(Z, 0.0, nz - 1.0)
        x0 = np.floor(X); y0 = np.floor(Y); z0 = np.minimum(np.floor(Z), nz - 2)
        fx = X - x0; fy = Y - y0; fz = Z - z0
        x0 = x0.astype(np.int64) % nx; y0 = y0.astype(np.int64) % nx; z0 = z0.astype(np.int64)
        x1 = (x0 + 1) % nx; y1 = (y0 + 1) % nx; z1 = z0 + 1
        out, lo, hi = [], [], []
        for f in fields:
            c = [f[x0, y0, z0], f[x1, y0, z0], f[x0, y1, z0], f[x1, y1, z0],
                 f[x0, y0, z1], f[x1, y0, z1], f[x0, y1, z1], f[x1, y1, z1]]
            a = c[0] + (c[1] - c[0]) * fx; b = c[2] + (c[3] - c[2]) * fx
            d = c[4] + (c[5] - c[4]) * fx; e = c[6] + (c[7] - c[6]) * fx
            out.append((a + (b - a) * fy) + ((d + (e - d) * fy) - (a + (b - a) * fy)) * fz)
            if minmax:
                lo.append(np.minimum.reduce(c)); hi.append(np.maximum.reduce(c))
        return out, lo, hi

    def advect(self, dt):
        I, J, K = self.idx
        sx, sz = dt / self.dx, dt / self.dz
        # departure points (midpoint rule with the current velocity)
        Xm, Ym, Zm = I - 0.5 * sx * self.u, J - 0.5 * sx * self.v, K - 0.5 * sz * self.w
        (um, vm, wm), _, _ = self._interp([self.u, self.v, self.w], Xm, Ym, Zm)
        X, Y, Z = I - sx * um, J - sx * vm, K - sz * wm
        flds = [self.u, self.v, self.w, self.thl, self.qt]
        fwd, lo, hi = self._interp(flds, X, Y, Z, minmax=True)
        # MacCormack: trace the advected field forward again, correct half the round-trip error, clamp
        back, _, _ = self._interp(fwd, I + sx * um, J + sx * vm, K + sz * wm)
        res = []
        for f, a, b, l, h in zip(flds, fwd, back, lo, hi):
            res.append(np.clip(a + 0.5 * (f - b), l, h))
        self.u, self.v, self.w, self.thl, self.qt = res

    # -------------------------------------------------------------------------------------------- projection
    def project(self):
        nz = self.nz
        def ext(f, odd):
            return np.concatenate([f, -f[:, :, ::-1] if odd else f[:, :, ::-1]], axis=2)
        U = np.fft.fftn(ext(self.u, False)); V = np.fft.fftn(ext(self.v, False)); W = np.fft.fftn(ext(self.w, True))
        div = (self.KX * U + self.KY * V + self.KZ * W) * self.iK2
        U -= self.KX * div; V -= self.KY * div; W -= self.KZ * div
        self.u = np.real(np.fft.ifftn(U))[:, :, :nz]
        self.v = np.real(np.fft.ifftn(V))[:, :, :nz]
        self.w = np.real(np.fft.ifftn(W))[:, :, :nz]

    # -------------------------------------------------------------------------------------------- subgrid mixing
    def _d(self, f, ax, h):
        if ax < 2:
            return (np.roll(f, -1, ax) - np.roll(f, 1, ax)) / (2 * h)
        return np.gradient(f, h, axis=2)

    def _lap(self, f):
        dx2, dz2 = self.dx ** 2, self.dz ** 2
        out = (np.roll(f, 1, 0) + np.roll(f, -1, 0) + np.roll(f, 1, 1) + np.roll(f, -1, 1) - 4 * f) / dx2
        fz = np.concatenate([f[:, :, :1], f, f[:, :, -1:]], axis=2)      # zero-gradient top / bottom
        return out + (fz[:, :, 2:] - 2 * f + fz[:, :, :-2]) / dz2

    def mix(self, dt, cs=0.2, pr=1.0 / 3.0):
        """Smagorinsky-Lilly eddy viscosity K = (Cs D)^2 |S| (scalars: K / Pr): entrainment and detrainment at the
        cloud edges, without which undiluted parcels overshoot the trade inversion."""
        dx, dz = self.dx, self.dz
        g = [[self._d(c, a, dx if a < 2 else dz) for a in range(3)] for c in (self.u, self.v, self.w)]
        S2 = 0.0
        for i in range(3):
            for j in range(3):
                sij = 0.5 * (g[i][j] + g[j][i])
                S2 = S2 + 2.0 * sij * sij
        delta = (dx * dx * dz) ** (1.0 / 3.0)
        K = np.minimum((cs * delta) ** 2 * np.sqrt(S2), 0.12 * dz * dz / dt * pr)   # explicit stability
        self.u += dt * K * self._lap(self.u); self.v += dt * K * self._lap(self.v); self.w += dt * K * self._lap(self.w)
        Kh = K / pr
        self.thl += dt * Kh * self._lap(self.thl); self.qt += dt * Kh * self._lap(self.qt)

    # -------------------------------------------------------------------------------------------- step
    def step(self, dt):
        z = self.z
        self.advect(dt)
        self.mix(dt)
        b, ql = self.buoyancy()
        self.w += dt * b
        # large-scale forcing (BOMEX): subsidence of the mean gradients, radiative cooling, drying near the surface
        ws = -0.0065 * np.clip(z / self.sub_top, 0, 1) * np.clip((self.sub_top + 600 - z) / 600, 0, 1)
        dthl = np.gradient(self.thl.mean(axis=(0, 1)), self.dz)
        dqt = np.gradient(self.qt.mean(axis=(0, 1)), self.dz)
        self.thl -= dt * ws * dthl
        self.qt -= dt * ws * dqt
        self.thl -= dt * (2.0 / 86400.0) * (z < self.sub_top)
        self.qt -= dt * 1.2e-8 * (z < 300)
        # surface fluxes into the lowest layer (patchy)
        if int(self.t / 600) != int((self.t - dt) / 600):
            self.flux_pat = 0.7 * self.flux_pat + 0.3 * self._pattern()
        self.thl[:, :, 0] += dt * self.shf / self.dz * self.flux_pat
        self.qt[:, :, 0] += dt * self.lhf / self.dz * self.flux_pat
        # mean wind relaxation (no Coriolis), sponge
        relax = dt / 1800.0
        self.u += relax * (self.u0 - self.u.mean(axis=(0, 1)))
        self.v -= relax * self.v.mean(axis=(0, 1))
        sp = dt * self.sponge
        self.w -= sp * self.w
        self.thl -= sp * (self.thl - self.thl.mean(axis=(0, 1)))
        self.qt -= sp * (self.qt - self.qt.mean(axis=(0, 1)))
        self.project()
        self.t += dt
        return ql

    def save(self, path):
        np.savez(path, u=self.u, v=self.v, w=self.w, thl=self.thl, qt=self.qt, t=self.t, flux_pat=self.flux_pat)

    def load(self, path):
        d = np.load(path)
        self.u, self.v, self.w, self.thl, self.qt = d['u'], d['v'], d['w'], d['thl'], d['qt']
        self.t = float(d['t']); self.flux_pat = d['flux_pat']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--case', default='bomex')
    ap.add_argument('--minutes', type=float, default=100)
    ap.add_argument('--spinup', type=float, default=50, help='minutes before snapshots are kept')
    ap.add_argument('--every', type=float, default=2.5, help='minutes between snapshots')
    ap.add_argument('--dt', type=float, default=4.0)
    ap.add_argument('--nx', type=int, default=48)
    ap.add_argument('--nz', type=int, default=56)
    ap.add_argument('--dx', type=float, default=100.0)
    ap.add_argument('--dz', type=float, default=50.0)
    ap.add_argument('--tag', default='')
    ap.add_argument('--budget', type=float, default=540, help='wall-clock seconds; checkpoint and stop after')
    ap.add_argument('--resume', action='store_true')
    a = ap.parse_args()
    os.makedirs(DATA, exist_ok=True)
    les = LES(a.case, nx=a.nx, nz=a.nz, dx=a.dx, dz=a.dz)
    ck = os.path.join(DATA, f'les_{a.case}{a.tag}_ckpt.npz')
    out = os.path.join(DATA, f'les_{a.case}{a.tag}.npz')
    snaps, times, ws = [], [], []
    if a.resume and os.path.exists(ck):
        les.load(ck)
        if os.path.exists(out):
            d = np.load(out); snaps = list(d['ql']); times = list(d['t']); ws = list(d['w'])
        print(f'resumed at t = {les.t / 60:.1f} min, {len(snaps)} snapshots')
    t0 = time.time()
    while les.t < a.minutes * 60:
        ql = les.step(a.dt)
        m = les.t / 60
        if m >= a.spinup and int(les.t / (a.every * 60)) != int((les.t - a.dt) / (a.every * 60)):
            snaps.append(les.ql().astype(np.float16)); times.append(les.t); ws.append(les.w.astype(np.float16))
        if int(les.t / 300) != int((les.t - a.dt) / 300):
            cf = (ql > 1e-5).mean(axis=(0, 1))
            k = np.nonzero(cf > 0.002)[0]
            rng = f'{les.z[k[0]]:.0f}-{les.z[k[-1]]:.0f} m' if len(k) else '-'
            print(f't = {m:5.1f} min  cloud cover {np.any(ql > 1e-5, axis=2).mean():.2f}  layer {rng}  '
                  f'max ql {ql.max() * 1e3:.2f} g/kg  max w {les.w.max():.1f} m/s  ({time.time() - t0:.0f} s)', flush=True)
        if time.time() - t0 > a.budget:
            print('wall-clock budget reached: checkpointing')
            break
    les.save(ck)
    if snaps:
        np.savez_compressed(out, ql=np.array(snaps), w=np.array(ws), t=np.array(times), z=les.z, dx=les.dx, dz=les.dz,
                            u0=les.u0)
    print(f'saved {len(snaps)} snapshots to {out}')


if __name__ == '__main__':
    main()
