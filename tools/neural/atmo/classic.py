"""numpy port of the classic real-time model in src/render/atmosphere.js + atmosphere-glsl.js (three wavelengths,
Hillaire 2020): the 256x64 transmittance LUT (40 quadratic steps, bilinear lookup), the 32x32 isotropic
multiple-scattering LUT (8x8 directions x 20 steps) and the sky-view integration (40 quadratic steps), for the
sun only (no moon, no airglow, no cloud deck). Radiance per unit (white) extraterrestrial sun illuminance.
"""
import math
import numpy as np
import common as C

TW, TH = 256, 64
MS_N = 32
BR = C.BR_CLASSIC
BO = C.BO_CLASSIC


def mie_params(ext, precipitation=0.0):
    """setWeather() in atmosphere.js."""
    wet = min(max(precipitation * 1.25, 0), 1)
    scat = ext * (0.92 + (0.985 - 0.92) * wet)
    g = 0.78 + (0.86 - 0.78) * wet
    inv_h = 1 / (1.2 + 0.4 * min(max((ext - 0.05) / 0.5, 0), 1))
    return scat, ext, g, inv_h


class Classic:
    def __init__(self, mie_ext):
        self.scat, self.ext, self.g, self.inv_h = mie_params(mie_ext)
        self._build_trans()
        self._build_ms()

    def density(self, h):
        h = np.maximum(h, 0.0)
        return np.exp(-h * 0.125), np.exp(-h * self.inv_h), np.maximum(0.0, 1.0 - np.abs(h - 25.0) / 15.0)

    def extinction(self, h):
        dR, dM, dO = self.density(h)
        return dR[..., None] * BR + (self.ext * dM)[..., None] + dO[..., None] * BO

    # ---- transmittance LUT ------------------------------------------------------------------------------------
    def _build_trans(self):
        H = math.sqrt(C.HT * (2 * C.RG + C.HT))
        xx = np.arange(TW) / (TW - 1)
        xy = np.arange(TH) / (TH - 1)
        rho = H * xy[:, None]
        r = np.sqrt(rho * rho + C.RG * C.RG)
        h = rho * rho / (r + C.RG)
        dmin = C.HT - h
        dmax = rho + H
        d = dmin + xx[None, :] * (dmax - dmin)
        mu = np.where(d <= 0, 1.0, np.clip((H * H - rho * rho - d * d) / (2 * r * d + 1e-30), -1, 1))
        od = np.zeros((TH, TW, 3))
        t0 = np.zeros_like(d)
        for i in range(40):
            x1 = (i + 1) / 40
            t1 = d * x1 * x1
            od += self.extinction(C.altitude_at(h, mu, 0.5 * (t0 + t1))) * (t1 - t0)[..., None]
            t0 = t1
        self.trans = np.exp(-od)
        self.H = H

    def trans_lut(self, h, mu):
        h = np.clip(h, 0.0, C.HT)
        H = self.H
        rho = np.sqrt(h * (2 * C.RG + h))
        d = C.dist_to_top(h, mu)
        dmin = C.HT - h
        dmax = rho + H
        x = np.clip((d - dmin) / (dmax - dmin), 0, 1) * (TW - 1)
        y = np.clip(rho / H, 0, 1) * (TH - 1)
        return _bilinear(self.trans, x, y)

    def light_trans(self, h, mu):
        h = np.clip(h, 0.0, C.HT)
        muH = C.mu_horizon(h)
        return self.trans_lut(h, np.maximum(mu, muH)) * C.smoothstep(-0.006, 0.006, mu - muH)[..., None]

    # ---- multiple scattering LUT --------------------------------------------------------------------------------
    def _build_ms(self):
        x = np.arange(MS_N) / (MS_N - 1)
        muS = (x * 2 - 1)[None, :] * np.ones((MS_N, 1))         # [j (h), i (mu)]
        h = ((x * x) * C.HT)[:, None] * np.ones((1, MS_N))
        sun = np.stack([np.sqrt(np.maximum(1 - muS * muS, 0)), muS, np.zeros_like(muS)], axis=-1)
        r = C.RG + h
        L2 = np.zeros((MS_N, MS_N, 3))
        fms = np.zeros((MS_N, MS_N, 3))
        for i in range(8):
            for j in range(8):
                th = 2 * math.pi * (i + 0.5) / 8
                cp = 1 - 2 * (j + 0.5) / 8
                sp = math.sqrt(max(1 - cp * cp, 0))
                dr = np.array([sp * math.cos(th), cp, sp * math.sin(th)])
                tG = C.dist_to_ground(h, np.full_like(h, cp))
                tMax = np.where(tG >= 0, tG, C.dist_to_top(h, np.full_like(h, cp)))
                dt = tMax / 20
                T = np.ones((MS_N, MS_N, 3))
                L = np.zeros((MS_N, MS_N, 3))
                F = np.zeros((MS_N, MS_N, 3))
                for k in range(20):
                    t = (k + 0.3) * dt
                    hs = C.altitude_at(h, cp, t)
                    P = np.stack([dr[0] * t, r + dr[1] * t, dr[2] * t], axis=-1)
                    dR, dM, dO = self.density(hs)
                    sS = dR[..., None] * BR + (self.scat * dM)[..., None]
                    ext = dR[..., None] * BR + (self.ext * dM)[..., None] + dO[..., None] * BO
                    Ts = np.exp(-ext * dt[..., None])
                    m = (P * sun).sum(-1) / np.linalg.norm(P, axis=-1)
                    S = sS * self.light_trans(hs, m) * 0.0795775
                    L += T * (S - S * Ts) / np.maximum(ext, 1e-9)
                    F += T * (sS - sS * Ts) / np.maximum(ext, 1e-9)
                    T *= Ts
                g = tG >= 0
                Pg = np.stack([dr[0] * tG, r + dr[1] * tG, dr[2] * tG], axis=-1)
                nl = np.maximum((Pg * sun).sum(-1) / np.linalg.norm(Pg, axis=-1), 0)
                L += np.where(g[..., None], T * self.light_trans(np.zeros_like(h), nl) * (nl[..., None] * np.array([0.14, 0.15, 0.13]) / math.pi), 0)
                L2 += L
                fms += F
        self.ms = (L2 / 64) / (1 - np.minimum(fms / 64, 0.97))

    def ms_lut(self, h, mu):
        x = np.clip(mu * 0.5 + 0.5, 0, 1) * (MS_N - 1)
        y = np.clip(np.sqrt(np.maximum(h, 0) / C.HT), 0, 1) * (MS_N - 1)
        return _bilinear(self.ms, x, y)

    # ---- sky view ------------------------------------------------------------------------------------------------
    def sky(self, h, d, s, n=40):
        """Sky radiance (N,3) for camera altitudes h (N,), unit view dirs d (N,3) and sun dirs s (N,3)."""
        r = C.RG + h
        mu = d[:, 1]
        tMax = C.dist_to_top(h, mu)
        c0 = (d * s).sum(1)
        pR = C.phase_r(c0)[:, None]
        pM = C.cornette_shanks(c0, self.g)[:, None]
        L = np.zeros((len(h), 3))
        T = np.ones((len(h), 3))
        t0 = np.zeros_like(h)
        for i in range(n):
            x1 = (i + 1) / n
            t1 = tMax * x1 * x1
            dt = t1 - t0
            t = t0 + 0.5 * dt
            hs = C.altitude_at(h, mu, t)
            P = d * t[:, None]
            P[:, 1] += r
            up = P / np.linalg.norm(P, axis=1, keepdims=True)
            dR, dM, dO = self.density(hs)
            sR = dR[:, None] * BR
            sM = (self.scat * dM)[:, None]
            ext = sR + (self.ext * dM)[:, None] + dO[:, None] * BO
            m = (up * s).sum(1)
            S = self.light_trans(hs, m) * (sR * pR + sM * pM) + self.ms_lut(hs, m) * (sR + sM)
            Ts = np.exp(-ext * dt[:, None])
            L += T * (S - S * Ts) / np.maximum(ext, 1e-9)
            T *= Ts
            t0 = t1
        return L


def _bilinear(tab, x, y):
    """tab (ny, nx, c); x, y in node units."""
    ny, nx = tab.shape[:2]
    i0 = np.clip(np.floor(x).astype(np.int64), 0, nx - 2)
    j0 = np.clip(np.floor(y).astype(np.int64), 0, ny - 2)
    fx = (x - i0)[..., None]
    fy = (y - j0)[..., None]
    return (tab[j0, i0] * (1 - fx) * (1 - fy) + tab[j0, i0 + 1] * fx * (1 - fy)
            + tab[j0 + 1, i0] * (1 - fx) * fy + tab[j0 + 1, i0 + 1] * fx * fy)
