"""Reference renderer for the ground-truth comparison: vectorised numpy Monte Carlo path tracer.

    OMP_NUM_THREADS=1 nice -n 10 timeout 600 python3 gt_trace.py scattered noon_above --spp 32 --res 192x108

Accumulates into gt_data/ref_<field>_<case>.npz (re-running adds samples; every batch is checkpointed).

Physics: the exported density grid times the game's extinction (sigma at density 1), albedo 0.9999, the Mie-fit
droplet phase function of phase.py (HG diffraction peak + Draine body), white-ish sun at +x, analytic sky (gt_common.Sky)
above, Lambertian ground (albedo GROUND_ALBEDO) at y = 0 with full multiple bounces between ground and cloud, no air.

Method (TMS: Nakajima & Tanaka 1988):
    L = L_ss(exact)  +  [all orders of sky / ground light + sun orders >= 2, in the delta-M scaled medium]
  * L_ss: deterministic ray march of single scattering of the sun with the full phase function and the exact
    (full-extinction) sun and view transmittance: the silver lining / diffraction aureole is exact.
  * the rest: adjoint random walk with delta tracking (supercell majorants) in the scaled medium
    sigma' = W_D * sigma with the Draine phase function (the 52 % narrow diffraction peak, g = 0.988, is treated as
    unscattered: the standard delta-M similarity).  Next-event estimation to the sun at every vertex after the first
    (the first is L_ss), escape to the sky, Lambertian bounces at the ground with sun NEE.
  The scaled problem is what makes plain NEE usable (the Draine body has no 600 sr^-1 spike) and halves the collision
  count; delta-M is accurate to a few per cent for the diffuse field (validated against the exact slab solutions in
  validate.py for this phase function, see results/validation.json for the full-phase solver).
"""
import argparse
import math
import os
import sys
import time

import numpy as np

from gt_common import (DATA, W_D, GROUND_ALBEDO, Field, SunDepth, make_case, camera_rays, box_interval, tonemap,
                       save_png)
import phase as ph

ALBEDO = 0.9999
G_D, ALPHA = ph.G_D, ph.ALPHA
DRAINE_K = (1 - G_D * G_D) / (4 * math.pi) / (1 + ALPHA * (1 + 2 * G_D * G_D) / 3)
B = 4                       # supercell size (voxels) for the majorant grid


def draine(mu):
    d = 1 + G_D * G_D - 2 * G_D * mu
    return DRAINE_K * (1 + ALPHA * mu * mu) / (d * np.sqrt(d))


def sample_hg(g, r):
    s = (1 - g * g) / (1 - g + 2 * g * r)
    return np.clip((1 + g * g - s * s) / (2 * g), -1, 1)


def sample_draine(rng, n):
    mu = np.empty(n)
    todo = np.arange(n)
    while todo.size:
        m = sample_hg(G_D, rng.random(todo.size))
        acc = rng.random(todo.size) * (1 + ALPHA) <= 1 + ALPHA * m * m
        mu[todo[acc]] = m[acc]
        todo = todo[~acc]
    return mu


def rotate(d, mu, phi):
    """Directions at polar cosine mu, azimuth phi about the unit vectors d (N,3)."""
    s = np.sqrt(np.maximum(0, 1 - mu * mu))
    # orthonormal basis (Frisvad / Duff et al.)
    sign = np.where(d[:, 2] >= 0, 1.0, -1.0)
    a = -1.0 / (sign + d[:, 2])
    bb = d[:, 0] * d[:, 1] * a
    t1 = np.stack([1 + sign * d[:, 0] ** 2 * a, sign * bb, -sign * d[:, 0]], 1)
    t2 = np.stack([bb, sign + d[:, 1] ** 2 * a, -d[:, 1]], 1)
    cp, sp = np.cos(phi), np.sin(phi)
    return (mu[:, None] * d + (s * cp)[:, None] * t1 + (s * sp)[:, None] * t2)


class Tracer:
    def __init__(self, field, case):
        self.f, self.c = field, case
        f = field
        self.sig = (f.full * (f.sigma * W_D)).astype(np.float32)          # scaled extinction, [a, b, c]
        nx, ny, nz = self.sig.shape
        mx, my, mz = -(-nx // B), -(-ny // B), -(-nz // B)
        pad = np.zeros((mx * B, my * B, mz * B), np.float32)
        pad[:nx, :ny, :nz] = self.sig
        self.maj = pad.reshape(mx, B, my, B, mz, B).max(axis=(1, 3, 5)) * 1.0001
        self.flat = self.sig.ravel()
        self.shape = np.array([nx, ny, nz])
        self.scale = np.array([f.dx, f.dx, f.dz])                            # metres per voxel along (x, z, y)
        self.L = case['L']
        self.E = case['E']
        self.sky = case['sky']
        self.ts = SunDepth(f, f.full, f.sigma, self.L)                      # full optical depth toward the sun
        self.ext = f.extent

    # world (x, y, z) <-> voxel (a, b, c) = (x, z, y)
    def to_vox(self, p):
        f = self.f
        return np.stack([(p[:, 0] - f.x0) / f.dx, (p[:, 2] - f.z0) / f.dx, (p[:, 1] - f.base_alt) / f.dz], 1)

    def to_world(self, u):
        f = self.f
        return np.stack([f.x0 + u[:, 0] * f.dx, f.base_alt + u[:, 2] * f.dz, f.z0 + u[:, 1] * f.dx], 1)

    # ------------------------------------------------------------------------------------------ single scattering
    def single_scatter(self, dirs, h=12.0):
        """Exact sun single scattering + view transmittance along camera rays (full phase, full extinction)."""
        cam = self.c['cam']
        t0, t1 = box_interval(cam, dirs, self.ext)
        n = len(dirs)
        Lss = np.zeros(n)
        T = np.ones(n)
        hit = t1 > t0
        idx = np.nonzero(hit)[0]
        if idx.size == 0:
            return Lss, T
        cosT = dirs @ self.L
        pf = ph.phase_np(cosT)
        t = t0[idx].copy()
        tend = t1[idx]
        Ti = np.ones(idx.size)
        Li = np.zeros(idx.size)
        f = self.f
        while idx.size:
            tm = t + 0.5 * h
            p = cam[None] + dirs[idx] * tm[:, None]
            d = trilinear(f.full, self.to_vox(p) - 0.5) * f.sigma
            ok = d > 0
            if ok.any():
                tau = self.ts.lookup(p[ok])
                step = np.minimum(h, tend[ok] - t[ok])
                Ts = np.exp(-d[ok] * step)
                Li[ok] += Ti[ok] * (1 - Ts) * pf[idx[ok]] * np.exp(-tau)
                Ti[ok] *= Ts
            t += h
            live = (t < tend) & (Ti > 1e-5)
            done = ~live
            Lss[idx[done]] = Li[done]
            T[idx[done]] = Ti[done]
            idx, t, tend, Ti, Li = idx[live], t[live], tend[live], Ti[live], Li[live]
        return Lss, T

    # ------------------------------------------------------------------------------------------ the random walk
    def walk(self, dirs, pix, rng, acc, max_coll=6000, start=None, light=None):
        """Adjoint paths from the camera (or, with start = points inside the box, from those points with nvert = 1,
        i.e. no sun NEE at the start: that is the exact single-scattering term); adds RGB radiance into acc[pix].
        light: None = the case's sun / sky / Lambertian ground, or dict(sun=bool, sky=fn|None, ground='lambert'|
        'black'|'emit1') for the decomposed per-point estimates."""
        n = len(dirs)
        cam = self.c['cam']
        d = dirs.copy()
        w = np.ones((n, 3))
        nvert = np.zeros(n, np.int32)
        nground = np.zeros(n, np.int32)
        stats = dict(dropped=0, iters=0)
        # state: 0 = outside the box (needs routing), 1 = inside the box (delta tracking)
        state = np.zeros(n, np.int8)
        u = np.zeros((n, 3))
        if start is None:
            pos = np.repeat(cam[None], n, 0).astype(np.float64)
        else:
            pos = start.astype(np.float64).copy()
            u[:] = np.clip(self.to_vox(pos), 1e-6, self.shape - 1e-6)
            state[:] = 1
            nvert[:] = 1
        alive = np.ones(n, bool)
        ids = np.arange(n)
        E, L, sky = self.E, self.L, self.sky
        light = light or {}
        sun_on = light.get('sun', True)
        sky_fn = light.get('sky', sky.radiance) if 'sky' in light else sky.radiance
        gmode = light.get('ground', 'lambert')
        if not sun_on:
            E = E * 0.0
        if 'E' in light:
            E = np.asarray(light['E'], float)
        g_emit = np.asarray(light.get('ground_emit', (1.0, 1.0, 1.0)), float)
        while ids.size:
            stats['iters'] += 1
            # ---- route the paths that are outside the box: enter it, escape to the sky, or hit the ground ----
            out = state[ids] == 0
            if out.any():
                o = ids[out]
                t0, t1 = box_interval(pos[o], d[o], self.ext)
                enter = t1 > t0 + 1e-6
                e = o[enter]
                if e.size:
                    pe = pos[e] + d[e] * (t0[enter] + 1e-4)[:, None]
                    u[e] = np.clip(self.to_vox(pe), 1e-6, self.shape - 1e-6)
                    state[e] = 1
                m = o[~enter]
                if m.size:
                    upw = d[m, 1] > 0
                    s = m[upw]
                    if s.size:                                        # escape: sky light
                        if sky_fn is not None:
                            np.add.at(acc, pix[s], w[s] * sky_fn(d[s]))
                        alive[s] = False
                    g = m[~upw]
                    if g.size and gmode != 'lambert':
                        if gmode == 'emit1':
                            np.add.at(acc, pix[g], w[g] * g_emit[None])
                        alive[g] = False
                        g = g[:0]
                    if g.size:                                        # ground hit
                        tg = -pos[g, 1] / d[g, 1]
                        pg = pos[g] + d[g] * tg[:, None]
                        pg[:, 1] = 0.0
                        mu0 = max(L[1], 0.0)
                        Tsun = np.exp(-W_D * self.ts.lookup(pg))
                        np.add.at(acc, pix[g], w[g] * (GROUND_ALBEDO * E)[None] * (mu0 / math.pi) * Tsun[:, None])
                        nground[g] += 1
                        w[g] *= GROUND_ALBEDO[None]
                        # cosine-weighted bounce
                        r1, r2 = rng.random(g.size), rng.random(g.size)
                        rr = np.sqrt(r1)
                        d[g] = np.stack([rr * np.cos(2 * np.pi * r2), np.sqrt(1 - r1), rr * np.sin(2 * np.pi * r2)], 1)
                        pos[g] = pg + d[g] * 0.01
                        # Russian roulette on the (small) ground-bounce weights
                        q = np.minimum(1.0, w[g].max(1) / 0.05)
                        surv = rng.random(g.size) < q
                        w[g[surv]] /= q[surv, None]
                        alive[g[~surv]] = False
                        alive[g[nground[g] > 4]] = False
                ids = ids[alive[ids]]
                continue_ids = ids[state[ids] == 1]
            else:
                continue_ids = ids
            j = continue_ids
            if j.size == 0:
                continue
            # ---- one delta-tracking event per path inside the box ----
            du = d[j][:, [0, 2, 1]] / self.scale[None]          # voxel units per metre
            uj = u[j]
            cell = np.floor(uj / B).astype(int)
            m = self.maj[cell[:, 0], cell[:, 1], cell[:, 2]]
            with np.errstate(divide='ignore', invalid='ignore'):
                bnd = np.where(du > 0, (cell + 1) * B, cell * B)
                tx = np.where(np.abs(du) > 1e-12, (bnd - uj) / du, np.inf)
            te = tx.min(1)
            ts = np.where(m > 0, -np.log(1 - rng.random(j.size)) / np.where(m > 0, m, 1), np.inf)
            coll = ts < te
            tstep = np.where(coll, ts, te + 1e-4)
            uj = uj + du * tstep[:, None]
            u[j] = uj
            inside = np.all((uj >= 0) & (uj < self.shape[None]), 1)
            # leaving the box: back to world space, re-route next iteration
            lv = j[~inside]
            if lv.size:
                pos[lv] = self.to_world(u[lv])
                state[lv] = 0
            jc = j[coll & inside]
            if jc.size:
                ui = np.floor(u[jc]).astype(int)
                s = self.sig[ui[:, 0], ui[:, 1], ui[:, 2]]
                real = rng.random(jc.size) * self.maj[ui[:, 0] // B, ui[:, 1] // B, ui[:, 2] // B] < s
                r = jc[real]
                if r.size:
                    nvert[r] += 1
                    w[r] *= ALBEDO
                    later = r[nvert[r] >= 2]
                    if later.size:                                    # sun NEE (orders >= 2)
                        p = self.to_world(u[later])
                        tau = W_D * self.ts.lookup(p)
                        val = draine(d[later] @ L) * np.exp(-tau)
                        np.add.at(acc, pix[later], w[later] * E[None] * val[:, None])
                    mu = sample_draine(rng, r.size)
                    d[r] = rotate(d[r], mu, rng.random(r.size) * 2 * np.pi)
                    d[r] /= np.linalg.norm(d[r], axis=1, keepdims=True)
                    over = r[nvert[r] > max_coll]
                    if over.size:
                        alive[over] = False
                        stats['dropped'] += over.size
            ids = ids[alive[ids]]
        return stats


def trilinear(grid, uc):
    """grid [a,b,c] sampled at continuous cell-centre coordinates uc (N,3) (0 = first cell centre), zero outside."""
    n = np.array(grid.shape)
    out = np.zeros(len(uc), np.float32)
    i0 = np.floor(uc).astype(int)
    f = uc - i0
    for di in (0, 1):
        for dj in (0, 1):
            for dk in (0, 1):
                ii = i0 + np.array([di, dj, dk])
                ok = np.all((ii >= 0) & (ii < n[None]), 1)
                w = (f[:, 0] if di else 1 - f[:, 0]) * (f[:, 1] if dj else 1 - f[:, 1]) * (f[:, 2] if dk else 1 - f[:, 2])
                iic = np.clip(ii, 0, n - 1)
                out += np.where(ok, w * grid[iic[:, 0], iic[:, 1], iic[:, 2]], 0)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('field')
    ap.add_argument('case')
    ap.add_argument('--spp', type=int, default=16)
    ap.add_argument('--batch', type=int, default=4, help='samples per pixel per checkpoint')
    ap.add_argument('--res', default='192x108')
    ap.add_argument('--budget', type=float, default=540, help='seconds; stops after the batch that crosses it')
    a = ap.parse_args()
    W, H = map(int, a.res.split('x'))
    field = Field(a.field)
    case = make_case(a.case, field)
    tr = Tracer(field, case)
    out = os.path.join(DATA, 'ref_%s_%s_%dx%d.npz' % (a.field, a.case, W, H))
    if os.path.exists(out):
        z = np.load(out)
        acc, nspp, Lss, T = z['acc'], int(z['nspp']), z['lss'], z['T']
    else:
        acc, nspp = np.zeros((W * H, 3)), 0
        t0 = time.time()
        # single scattering: 4 jittered rays per pixel
        Lss = np.zeros(W * H)
        T = np.zeros(W * H)
        for jx, jy in ((0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)):
            l, t = tr.single_scatter(camera_rays(case, W, H, (jx, jy)))
            Lss += l / 4
            T += t / 4
        print('single scattering %.1f s' % (time.time() - t0), flush=True)
    start = time.time()
    rng = np.random.default_rng(1000 + nspp)
    while nspp < a.spp and time.time() - start < a.budget:
        t0 = time.time()
        k = min(a.batch, a.spp - nspp)
        pix = np.repeat(np.arange(W * H), k)
        jx, jy = rng.random(pix.size), rng.random(pix.size)
        dirs = camera_rays(case, W, H, (jx.reshape(-1), jy.reshape(-1))) if False else None
        # per-sample jittered rays
        ii, jj = pix % W, pix // W
        dirs = _rays_px(case, W, H, ii + jx, jj + jy)
        acc_b = np.zeros((W * H, 3))
        st = tr.walk(dirs, pix, rng, acc_b)
        acc += acc_b
        nspp += k
        np.savez(out, acc=acc, nspp=nspp, lss=Lss, T=T)
        print('spp %d  (%.1f s, %d iterations, %d dropped)' % (nspp, time.time() - t0, st['iters'], st['dropped']), flush=True)
    img = acc / max(nspp, 1) + Lss[:, None] * case['E'][None]
    save_png(out.replace('.npz', '.png'), tonemap(img.reshape(H, W, 3), 1.6 / max(case['E'].max(), 1e-3) * (1 if case['elev'] > 20 else 1.6)))


def _rays_px(case, W, H, px, py):
    yaw, pitch = math.radians(case['yaw']), math.radians(case['pitch'])
    fwd = np.array([math.cos(pitch) * math.cos(yaw), math.sin(pitch), math.cos(pitch) * math.sin(yaw)])
    right = np.array([-math.sin(yaw), 0.0, math.cos(yaw)])
    up = np.cross(right, fwd)
    th = math.tan(math.radians(case['fov']) / 2)
    sx = (2 * px / W - 1) * th * W / H
    sy = (1 - 2 * py / H) * th
    d = fwd[None] + sx[:, None] * right[None] + sy[:, None] * up[None]
    return d / np.linalg.norm(d, axis=1, keepdims=True)


if __name__ == '__main__':
    main()
