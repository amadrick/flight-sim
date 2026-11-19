"""Numpy port of the real-time cloud march and lighting (src/clouds/shaders.js marchFragment) for the ground-truth
comparison.  It marches the same exported density grid the path tracer renders, with the shader's step logic
(coarse search, fine steps ~ Kf * t, refine-on-hit cap, blue-noise jitter averaged over several frames as the
temporal filter does), the shader's light march (4 exponentially spaced base-density samples up to 1 km + the
shadow-map optical depth beyond), its tauUp / tauDown estimates and its ambient term.

The march only depends on the density, so it runs once per case and stores every lit sample; the scatter model
(J) and the ambient model are applied afterwards (shade()), which makes model A/B tests cheap.
"""
import math
import os
import subprocess
import tempfile

import numpy as np

from gt_common import DATA, GROUND_ALBEDO, Field, SunDepth, make_case, camera_rays, box_interval
from gt_trace import trilinear
import phase as ph

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


class March:
    def __init__(self, field, case, steps=80, light_steps=4, light_len=1000.0):
        self.f, self.c = field, case
        self.steps, self.lsteps, self.llen = steps, light_steps, light_len
        self.L = case['L']
        # optical depth of the cheap base density (x 0.8, as the light march and the shadow map use it)
        self.tsb = SunDepth(field, field.base, field.sigma * 0.8, self.L)
        self.Kf = 0.9 / steps
        self.minFine = 1200.0 / steps
        self.minCoarse = 110.0

    def vox(self, p):
        f = self.f
        return np.stack([(p[:, 0] - f.x0) / f.dx - 0.5, (p[:, 2] - f.z0) / f.dx - 0.5, (p[:, 1] - f.base_alt) / f.dz - 0.5], 1)

    def top_at(self, p):
        f = self.f
        a = np.clip(((p[:, 0] - f.x0) / f.dx).astype(int), 0, f.nx - 1)
        b = np.clip(((p[:, 2] - f.z0) / f.dx).astype(int), 0, f.ny - 1)
        return f.top2d[a, b]

    def run(self, W, H, njit=8, seed=3):
        f, cam = self.f, self.c['cam']
        dirs = camera_rays(self.c, W, H)
        n = len(dirs)
        rng = np.random.default_rng(seed)
        r_pix = rng.random(n)
        r_pix2 = rng.random(n)
        t0, t1 = box_interval(cam, dirs, f.extent)
        rec = {k: [] for k in ('pix', 'w', 'pos', 'jit', 'd', 'ds', 'tt', 'tv')}
        Tsum = np.zeros(n)
        iters = np.zeros(n)
        lit = np.zeros(n)
        Kf, minF = self.Kf, self.minFine
        for j in range(njit):
            blue = (r_pix + j / njit) % 1.0
            blue2 = (r_pix2 + j * 0.7548) % 1.0
            idx = np.nonzero(t1 > t0)[0]
            t = t0[idx].copy()
            te = t1[idx]
            T = np.ones(idx.size)
            fine = np.zeros(idx.size, bool)
            zeros = np.zeros(idx.size, int)
            cap = np.full(idx.size, 1e9)
            ndense = np.zeros(idx.size)
            tv = np.zeros(idx.size)          # optical depth along the view ray inside the current cloud
            Tfin = np.ones(n)
            for i in range(self.steps):
                act = (t < te) & (T >= 0.004)
                if not act.any():
                    break
                a = np.nonzero(act)[0]
                iters[idx[a]] += 1
                ta = t[a]
                left = self.steps - i
                need = np.log(np.minimum(te[a], np.maximum(40000.0, 8 * ta)) / np.maximum(ta, 1500.0)) / (0.8 * left)
                Kc = np.maximum(3 * Kf, need)
                dsC = np.maximum(self.minCoarse, Kc * ta)
                farK = smoothstep(700.0, 1800.0, dsC)
                dsF = np.maximum(minF, (Kf + (Kc - Kf) * farK) * ta)
                far = dsF > 0.6 * dsC
                ds = np.minimum(np.minimum(np.where(fine[a] | far, dsF, dsC), te[a] - ta), cap[a])
                ts = ta + ds * blue[idx[a]]
                p = cam[None] + dirs[idx[a]] * ts[:, None]
                dens = trilinear(f.full, self.vox(p))
                coarse = ~fine[a] & ~far
                # coarse search: a hit re-marches the same interval with fine steps
                hitc = coarse & (dens > 0)
                fine[a[hitc]] = True
                zeros[a[hitc]] = 0
                adv = coarse & ~hitc
                t[a[adv]] += ds[adv]
                m = ~coarse
                has = m & (dens > 0)
                sig = dens * f.sigma
                refine = has & (cap[a] > 1e8) & (sig * ds > 1.6) & (ds > 1.5 * minF)
                r = a[refine]
                if r.size:
                    cap[r] = np.maximum(1.0 / sig[refine], minF)
                    t[r] = np.maximum(t[r], ts[refine] - 0.5 * cap[r])
                    fine[r] = True
                    zeros[r] = 0
                ls = has & ~refine
                q = a[ls]
                if q.size:
                    zeros[q] = 0
                    ndense[q] += 1
                    Ts = np.exp(-sig[ls] * ds[ls])
                    w = T[q] * (1 - Ts)
                    rec['pix'].append(idx[q])
                    rec['w'].append(w / njit)
                    rec['pos'].append(p[ls])
                    rec['jit'].append((blue2[idx[q]] + ndense[q] * 0.618) % 1.0)
                    rec['d'].append(dens[ls])
                    rec['ds'].append(ds[ls])
                    rec['tt'].append(ts[ls])
                    rec['tv'].append(tv[q] + 0.5 * sig[ls] * ds[ls])
                    tv[q] += sig[ls] * ds[ls]
                    T[q] *= Ts
                    cap[q] *= 1.6
                    t[q] += ds[ls]
                    lit[idx[q]] += 1
                em = m & ~has
                e = a[em]
                if e.size:
                    zeros[e] += 1
                    back = zeros[e] > 5
                    fine[e[back]] = False
                    tv[e[back]] = 0
                    cap[e[back]] = 1e9
                    t[e] += ds[em]
            Tfin[idx] = T
            Tsum += np.clip((Tfin - 0.004) / 0.996, 0, 1)
        R = {k: np.concatenate(v) if v else np.zeros(0) for k, v in rec.items()}
        R['T'] = Tsum / njit
        R['dirs'] = dirs
        R['iters'] = iters / njit
        R['lit'] = lit / njit
        R['W'], R['H'] = W, H
        self.features(R)
        return R

    def features(self, R):
        """Shader inputs per lit sample: tauSun (light march + shadow map), tauUp, tauDown, cosTheta."""
        f, L = self.f, self.L
        p, jit, d = R['pos'], R['jit'], R['d']
        tau = np.zeros(len(p))
        d0 = 0.0
        for j in range(self.lsteps):
            u = (j + 1) / self.lsteps
            d1 = self.llen * u * u
            dl = d1 - d0
            pl = p + L[None] * (d0 + dl * (0.25 + 0.5 * jit))[:, None]
            tau += trilinear(f.base, self.vox(pl)) * dl
            d0 = d1
        tau *= f.sigma * 0.8
        tau_far = self.tsb.lookup(p + L[None] * self.llen)
        R['tauNear'] = tau
        R['tauSun'] = tau + tau_far
        h = p[:, 1]
        top = self.top_at(p)
        R['tauUp'] = f.sigma * (0.3 + 0.2 * d) * np.maximum(top - h, 0)
        R['tauDn'] = f.sigma * (0.3 + 0.2 * d) * np.maximum(h - f.base_alt, 0)
        R['cosT'] = R['dirs'][R['pix'].astype(int)] @ L
        R['h'] = h
        if f.ex is not None:
            R['ex'] = trilinear(f.ex, self.vox(p))


# ------------------------------------------------------------------------------------------------ scatter models
def hg(c, g):
    g2 = g * g
    return (1 - g2) * 0.0795775 / np.power(1 + g2 - 2 * g * c, 1.5)


def classic_J(ts, tu, c):
    """DEFAULT_SCATTER_GLSL (src/clouds/shaders.js), the hand-built model behind scatter=classic."""
    single = (hg(c, 0.82) * 0.8 + hg(c, -0.30) * 0.2) * np.exp(-ts)
    ms = np.zeros_like(ts)
    a = b = cc = 1.0
    for _ in range(3):
        a *= 0.42; b *= 0.55; cc *= 0.55
        ms += b * (hg(c, 0.82 * cc) * 0.8 + hg(c, -0.30 * cc) * 0.2) * np.exp(-a * ts)
    depth = ts + 0.35 * tu
    powder = 1 - 0.55 * np.exp(-0.8 * depth)
    fwd = 1 + (12.566 * hg(c, 0.35) - 1) * 0.55 * np.exp(-0.12 * ts)
    diffuse = 0.2546 * (0.5 / (1 + 0.1125 * ts) + 0.5 * np.exp(-0.3 * ts)) * powder * fwd
    return single + 0.5 * ms * powder + diffuse


def node_J(model, ts, tu, c, td):
    x = np.stack([ts, tu, c, td], 1).astype(np.float32)
    with tempfile.TemporaryDirectory() as tmp:
        fi, fo = os.path.join(tmp, 'in.f32'), os.path.join(tmp, 'out.f32')
        x.tofile(fi)
        subprocess.run(['node', os.path.join(HERE, 'gt_eval_j.mjs'), fi, fo, model], check=True, cwd=ROOT)
        return np.fromfile(fo, np.float32).astype(np.float64)


def model_J(model, R):
    ts, tu, c, td = R['tauSun'], R['tauUp'], R['cosT'], R['tauDn']
    if model == 'classic':
        return classic_J(ts, tu, c)
    if callable(model):
        return model(R)
    return node_J(model, ts, tu, c, td)


def game_ambient(R, case, cov):
    """Current shader ambient: S_amb = 0.5 (ambUp visUp + ambDn visDn)."""
    tu, td = R['tauUp'], R['tauDn']
    amb_up = case['sky'].amb_up
    amb_dn = ground_ambient(case, cov)
    vu = 0.35 * np.exp(-0.6 * tu) + 0.65 / (1 + 0.2 * tu)
    vd = 0.35 * np.exp(-0.6 * td) + 0.65 / (1 + 0.2 * td)
    return 0.5 * (amb_up[None] * vu[:, None] + amb_dn[None] * vd[:, None])


def ground_ambient(case, cov):
    """uAmbientGround (ground radiance: albedo x (sun + sky) / pi) x the march's ground-bounce scale."""
    E, L = case['E'], case['L']
    rad = GROUND_ALBEDO * (E * max(L[1], 0) / math.pi + case['sky'].amb_up)
    return rad * (1 + (0.35 - 1) * cov * cov)


def background(R, case, field, tsfull=None):
    d = R['dirs']
    sky = case['sky']
    bg = np.zeros((len(d), 3))
    up = d[:, 1] > 0
    bg[up] = sky.radiance(d[up])
    g = ~up
    if g.any():
        cam = case['cam']
        tg = -cam[1] / d[g, 1]
        pg = cam[None] + d[g] * tg[:, None]
        pg[:, 1] = 0
        tau = tsfull.lookup(pg) if tsfull is not None else 0
        E, L = case['E'], case['L']
        bg[g] = GROUND_ALBEDO[None] * (E[None] * max(L[1], 0) * np.exp(-tau)[:, None] / math.pi
                                       + sky.amb_up[None] / (1 + 0.11 * tau)[:, None])
    return bg


def shade(R, case, field, model='classic', ambient=None, cov=0.42, J=None, bg=None):
    """Image (H*W, 3) for one scatter model + ambient model."""
    if J is None:
        J = model_J(model, R)
    amb = (ambient or game_ambient)(R, case, cov)
    S = case['E'][None] * J[:, None] + amb
    n = len(R['dirs'])
    img = np.zeros((n, 3))
    np.add.at(img, R['pix'].astype(int), R['w'][:, None] * S)
    if bg is None:
        bg = background(R, case, field)
    return img + R['T'][:, None] * bg
