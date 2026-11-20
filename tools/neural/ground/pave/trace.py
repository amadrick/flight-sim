"""Reference renderer for the pavement reflectance network (numpy only).

Grooved runway asphalt is not a flat Lambert + GGX surface. Crushed stones stand out of a dark binder, 6 x 6 mm saw
grooves every 38 mm cut across it, rubber fills it in the touchdown zones, water fills it from the bottom up. Those
millimetre shapes shadow and mask each other: at grazing view the viewer sees only the stone tops (the lit ones looking
down-sun, the shadowed ones into the sun), the grooves hide the sky's mirror image at grazing angles across them and
show it along them, and a water film turns the surface into a mirror only where it covers the stones.

This script measures that on synthetic tiles (114 mm square = 3 groove periods, 256^2 height texels of 0.45 mm):

  surface   stones 2-14 mm (convex polygons, worn flat tops; dark basalt / mid limestone / pale quartz) in a binder of
            sand fines whose level sets how far they stand out ("exposure"); grooves 6 mm wide and deep (optional);
            rubber (fills the texture, albedo -> 0.025, smoother); wetness (porous albedo darkens and facets get a
            film, then free water fills the texture from the bottom: a flat water plane, n = 1.33)
  facets    Lambert (per-texel albedo) + GGX microfacets (per-material roughness), Schlick Fresnel F0 = 0.04
            (water: 0.02), Smith masking of the microfacets
  macro     exact cast shadows and masking on the height field from horizon maps (24 azimuths): every texel is
            weighted by its projected area toward the viewer when visible, lit when the sun is above its horizon
  sky       a uniform sky, Monte Carlo: one importance-sampled direction per texel per lobe (cosine for the diffuse,
            GGX half-vectors for the specular), visible when above the texel's horizon in that azimuth (24 bins)

Single scattering (no interreflection: the binder reflects ~5 %, stones 15-45 %; the missing second bounce is a few
per cent of the diffuse in the grooves). Output per tile and (sun, view):
  Kd = diffuse radiance / (A pi^-1 E mu_s)        A = the tile's mean albedo; 1 for a flat Lambert sheet
  Ks = pi * specular radiance / (E mu_s)           specular BRF
and per view: Hd = diffuse radiance under a unit sky / A, Hs = specular radiance under a unit sky.

    python3 trace.py out.npz seed0 n_tiles [--quick]
"""
import sys, time
import numpy as np

N = 256
TILE = 114.0                    # mm
DX = TILE / N                   # mm per texel
NAZ = 24                        # horizon map azimuth bins
AZ = np.arange(NAZ) * 2 * np.pi / NAZ


def hash_rng(seed):
    return np.random.default_rng(seed)


def make_surface(rng, groove, exposure, rubber, wet):
    """height (mm), albedo, GGX alpha, water mask. x = along the runway (grooves are lines of constant x)."""
    h = np.full((N, N), -50.0); alb = np.zeros((N, N)); top = np.zeros((N, N))
    yy, xx = np.mgrid[0:N, 0:N]
    # stones: 4 size classes, jittered grid, convex polygons
    for cells, rad, hk in [(10, 0.62, 1.0), (20, 0.58, 0.8), (40, 0.55, 0.55), (80, 0.5, 0.35)]:
        cp = N / cells
        for cy in range(cells):
            for cx in range(cells):
                if rng.random() < (0.45 if cells > 40 else 0.25):
                    continue
                R = rad * (0.55 + 0.6 * rng.random()) * cp
                mx = (cx + 0.2 + 0.6 * rng.random()) * cp; my = (cy + 0.2 + 0.6 * rng.random()) * cp
                ns = rng.integers(5, 8); a0 = rng.random() * 2 * np.pi
                r0 = int(np.ceil(R * 1.3))
                x0, y0 = int(mx) - r0, int(my) - r0
                sx = np.arange(x0, x0 + 2 * r0 + 1); sy = np.arange(y0, y0 + 2 * r0 + 1)
                ox = sx[None, :] + 0.5 - mx; oy = sy[:, None] + 0.5 - my
                d = np.zeros((len(sy), len(sx)))
                for k in range(ns):
                    a = a0 + (k + 0.5 * rng.random()) * 2 * np.pi / ns
                    d = np.maximum(d, (np.cos(a) * ox + np.sin(a) * oy) / (R * (0.75 + 0.45 * rng.random())))
                m = d < 1
                hz = (np.maximum(1 - d * d, 0) ** 0.35) * (0.55 + 0.45 * rng.random()) * hk * R * DX * 0.9
                rt = rng.random()
                ab = (0.12 + 0.08 * rng.random() if rt < 0.55 else 0.25 + 0.1 * rng.random() if rt < 0.88 else 0.45 + 0.15 * rng.random())
                iy = (sy % N)[:, None] * np.ones_like(m); ix = np.ones_like(m) * (sx % N)[None, :]
                iy, ix, hz = iy[m], ix[m], hz[m]
                up = hz > h[iy, ix]
                h[iy[up], ix[up]] = hz[up]; alb[iy[up], ix[up]] = ab * (0.92 + 0.16 * rng.random()); top[iy[up], ix[up]] = 1
    # binder level: stones stand out by `exposure` of their height distribution
    st = h > -10
    lvl = np.quantile(h[st], 0.85 - 0.6 * exposure)
    fines = rng.random((N, N)) * 0.12
    k = np.fft.fftfreq(N)[:, None] ** 2 + np.fft.fftfreq(N)[None, :] ** 2
    fines += np.fft.ifft2(np.fft.fft2(rng.standard_normal((N, N))) * np.exp(-k * 900)).real * 0.6
    binder = lvl + fines
    isb = binder >= h
    h = np.maximum(h, binder)
    alb = np.where(isb, 0.045 + 0.03 * rng.random((N, N)), alb)
    rough = np.where(isb, 0.65, 0.38 + 0.12 * rng.random())          # GGX alpha = rough^2
    # grooves: 6 mm wide, 6 mm deep, every 38 mm (3 per tile), slightly rounded edges; the saw cuts the stones (paler)
    if groove:
        gx = (xx * DX) % 38.0
        cut = np.clip(np.minimum(gx, 6.0 - gx) / 0.6, 0, 1) * (gx < 6.0)
        floor = lvl - 6.0 + fines * 0.5
        hg = h * (1 - cut) + floor * cut
        ing = (gx < 6.0) & (cut > 0)
        h = np.where(ing, np.minimum(h, hg), h)
        alb = np.where(ing & (cut > 0.9), np.where(top > 0, alb * 1.2, 0.07), alb)
        rough = np.where(ing & (cut > 0.9), 0.7, rough)
    # rubber: fills the texture toward its smoothed surface, black and smoother
    if rubber > 0:
        hs = np.fft.ifft2(np.fft.fft2(h) * np.exp(-k * 4000)).real
        h = h + rubber * 0.8 * np.maximum(hs - h, 0) * (1.0 - 0.7 * (groove and 1.0) * 0)
        alb = alb * (1 - 0.9 * rubber) + 0.022 * rubber
        rough = rough * (1 - rubber) + 0.45 * rubber
    # wetness: porous darkening and a film on the facets (0..0.35), then free water from the bottom (0.35..1)
    damp = min(wet / 0.35, 1.0)
    alb = alb * (1 - 0.45 * damp * (1 - 0.6 * rubber))
    rough = rough * (1 - 0.55 * damp)
    water = np.zeros((N, N), bool); wl = -1e9
    if wet > 0.35:
        wl = np.quantile(h, min(0.98, (wet - 0.35) / 0.65))
        water = h < wl
    return h, alb, np.maximum(rough, 0.05) ** 2, water, wl


def horizon(h, az):
    """tan of the horizon elevation toward azimuth az (radians, from +x toward +y) for every texel."""
    dx, dy = np.cos(az), np.sin(az)
    best = np.full(h.shape, -1e9)
    t = 1.0
    hmax = h.max()
    while t * DX < 140.0:
        # bilinear-free: shift by the rounded offset (periodic tile)
        ox, oy = int(round(dx * t)), int(round(dy * t))
        run = np.hypot(ox, oy) * DX
        if run > 0:
            best = np.maximum(best, (np.roll(h, (-oy, -ox), (0, 1)) - h) / run)
        if (hmax - h.min()) / (t * DX) < best.min():
            break
        t += 1.0 if t < 32 else 2.0 if t < 96 else 4.0
    return best


def normals(h):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * DX); gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * DX)
    nz = 1 / np.sqrt(1 + gx * gx + gy * gy)
    return -gx * nz, -gy * nz, nz


def ggx_D(nh, a2):
    d = nh * nh * (a2 - 1) + 1
    return a2 / (np.pi * d * d)


def smith_G1(nx, a2):
    return 2 * nx / (nx + np.sqrt(a2 + (1 - a2) * nx * nx))


def fresnel(c, f0):
    return f0 + (1 - f0) * (1 - c) ** 5


def render_tile(h, alb, a2, water, wl, sun_list, view_list, rng, sky_samples=2):
    he = np.where(water, wl, h)
    nx, ny, nz = normals(h)
    wnx = np.where(water, 0.0, nx); wny = np.where(water, 0.0, ny); wnz = np.where(water, 1.0, nz)   # facet the eye sees
    HZ = np.stack([horizon(he, a) for a in AZ])            # NAZ x N x N
    A = alb.mean()

    def vis(mu, az):
        b = int(round(az / (2 * np.pi) * NAZ)) % NAZ
        s = np.sqrt(max(1 - mu * mu, 0))
        return HZ[b] <= mu / max(s, 1e-6)

    def shade(lx, ly, lz, vx, vy, vz, mu_l, mu_v):
        """diffuse (albedo-weighted) and specular facet radiance x cos for one light direction, per texel."""
        nl = np.maximum(nx * lx + ny * ly + nz * lz, 0)
        # dry facet
        hx, hy, hz = lx + vx, ly + vy, lz + vz; hn = np.sqrt(hx * hx + hy * hy + hz * hz); hx, hy, hz = hx / hn, hy / hn, hz / hn
        nh = np.maximum(nx * hx + ny * hy + nz * hz, 0); vh = np.maximum(vx * hx + vy * hy + vz * hz, 0)
        nv = np.maximum(nx * vx + ny * vy + nz * vz, 1e-4)
        spec = ggx_D(nh, a2) * smith_G1(np.maximum(nl, 1e-4), a2) * smith_G1(nv, a2) * fresnel(vh, 0.04) / (4 * nv) * (nl > 0)
        dif = alb / np.pi * nl
        # water surface (flat): mirror-ish lobe with alpha 0.03^2; the bed below lit through the interface
        if water.any():
            aw = 0.0009
            hzw = (lz + vz) / np.sqrt((lx + vx) ** 2 + (ly + vy) ** 2 + (lz + vz) ** 2)
            vhw = max((vx * (lx + vx) + vy * (ly + vy) + vz * (lz + vz)) / np.sqrt((lx + vx) ** 2 + (ly + vy) ** 2 + (lz + vz) ** 2), 0)
            sw = ggx_D(hzw, aw) * smith_G1(max(lz, 1e-4), aw) * smith_G1(max(vz, 1e-4), aw) * fresnel(vhw, 0.02) / (4 * max(vz, 1e-4)) * max(lz, 0)
            trans = (1 - fresnel(max(lz, 0), 0.02)) * (1 - fresnel(max(vz, 0), 0.02)) / 1.33 ** 2 * 1.33 ** 2
            dif = np.where(water, alb / np.pi * nl * trans * 0.9, dif)
            spec = np.where(water, sw, spec)
        return dif, spec

    # projected area of each texel toward the viewer (masking by the micro geometry is in vis())
    out_sun, out_sky = [], []
    for (mu_v, ph_v) in view_list:
        sv = np.sqrt(1 - mu_v * mu_v); vx, vy, vz = sv * np.cos(ph_v), sv * np.sin(ph_v), mu_v
        Vv = vis(mu_v, ph_v)
        wv = np.maximum(wnx * vx + wny * vy + wnz * vz, 0) / wnz * Vv              # projected area weight
        norm = mu_v * N * N
        for (mu_s, ph_s) in sun_list:
            ss = np.sqrt(1 - mu_s * mu_s); lx, ly, lz = ss * np.cos(ph_s), ss * np.sin(ph_s), mu_s
            Vl = vis(mu_s, ph_s)
            dif, spec = shade(lx, ly, lz, vx, vy, vz, mu_s, mu_v)
            # (dif / spec: facet radiance per unit irradiance; wv: its projected area toward the viewer)
            Ld = np.sum(wv * Vl * dif) / norm
            Ls = np.sum(wv * Vl * spec) / norm
            out_sun.append((mu_s, ph_s, mu_v, ph_v, Ld * np.pi / (A * mu_s), Ls * np.pi / mu_s))
        # sky: one cosine-weighted and one GGX-sampled direction per texel per pass
        Hd = 0.0; Hs = 0.0
        nvf = np.maximum(wnx * vx + wny * vy + wnz * vz, 1e-4)
        for _ in range(sky_samples):
            # diffuse: cosine-weighted about the facet normal (approximated by sampling about +z then testing n.l)
            u1, u2 = rng.random((N, N)), rng.random((N, N))
            r = np.sqrt(u1); phi = 2 * np.pi * u2
            # build a frame around the facet normal
            tx, ty, tz = np.where(np.abs(nz) < 0.9, 0, 1) * 0 + 1, 0 * nx, -nx / np.maximum(nz, 1e-3)
            tn = np.sqrt(tx * tx + ty * ty + tz * tz); tx, ty, tz = tx / tn, ty / tn, tz / tn
            bx, by, bz = ny * tz - nz * ty, nz * tx - nx * tz, nx * ty - ny * tx
            lz_ = np.sqrt(np.maximum(1 - u1, 0))
            dx_ = r * np.cos(phi) * tx + r * np.sin(phi) * bx + lz_ * nx
            dy_ = r * np.cos(phi) * ty + r * np.sin(phi) * by + lz_ * ny
            dz_ = r * np.cos(phi) * tz + r * np.sin(phi) * bz + lz_ * nz
            ok = dz_ > 0
            azd = np.arctan2(dy_, dx_); b = np.round(azd / (2 * np.pi) * NAZ).astype(int) % NAZ
            sd = np.sqrt(np.maximum(1 - dz_ * dz_, 0))
            hz = np.take_along_axis(HZ, b[None], 0)[0]
            vsky = ok & (hz <= dz_ / np.maximum(sd, 1e-6))
            dwat = np.where(water, (1 - fresnel(np.clip(dz_, 0, 1), 0.02)) * (1 - fresnel(vz, 0.02)) * 0.9, 1.0)
            Hd += np.sum(wv * alb * vsky * dwat) / norm / A
            # specular: GGX half vector about the facet normal (water: about +z with alpha 0.03)
            a2s = np.where(water, 0.0009, a2)
            fnx, fny, fnz = wnx, wny, wnz
            e1, e2 = rng.random((N, N)), rng.random((N, N))
            th = np.arctan(np.sqrt(a2s * e1 / np.maximum(1 - e1, 1e-9))); ph = 2 * np.pi * e2
            # frame around the facet normal
            t2x, t2y, t2z = np.ones_like(fnx), np.zeros_like(fnx), -fnx / np.maximum(fnz, 1e-3)
            tn = np.sqrt(t2x * t2x + t2y * t2y + t2z * t2z); t2x, t2y, t2z = t2x / tn, t2y / tn, t2z / tn
            b2x, b2y, b2z = fny * t2z - fnz * t2y, fnz * t2x - fnx * t2z, fnx * t2y - fny * t2x
            st, ct = np.sin(th), np.cos(th)
            hx = st * np.cos(ph) * t2x + st * np.sin(ph) * b2x + ct * fnx
            hy = st * np.cos(ph) * t2y + st * np.sin(ph) * b2y + ct * fny
            hz_ = st * np.cos(ph) * t2z + st * np.sin(ph) * b2z + ct * fnz
            vh = vx * hx + vy * hy + vz * hz_
            lx_, ly_, lz2 = 2 * vh * hx - vx, 2 * vh * hy - vy, 2 * vh * hz_ - vz
            nl = fnx * lx_ + fny * ly_ + fnz * lz2
            okl = (nl > 0) & (lz2 > 0) & (vh > 0)
            az2 = np.arctan2(ly_, lx_); b2 = np.round(az2 / (2 * np.pi) * NAZ).astype(int) % NAZ
            s2 = np.sqrt(np.maximum(1 - lz2 * lz2, 0))
            hz2 = np.take_along_axis(HZ, b2[None], 0)[0]
            vis2 = okl & (hz2 <= lz2 / np.maximum(s2, 1e-6))
            # weight = F G2 (v.h) / ((n.v)(n.h)) for GGX-distributed half vectors
            G2 = smith_G1(np.clip(nl, 1e-4, 1), a2s) * smith_G1(nvf, a2s)
            wgt = fresnel(np.clip(vh, 0, 1), np.where(water, 0.02, 0.04)) * G2 * np.clip(vh, 0, 1) / (nvf * np.maximum(ct, 1e-4))
            Hs += np.sum(wv * wgt * vis2) / norm
        out_sky.append((mu_v, ph_v, Hd / sky_samples, Hs / sky_samples))
    return np.array(out_sun), np.array(out_sky), A


def main():
    out, seed0, n = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    quick = '--quick' in sys.argv
    mus_s = [0.08, 0.17, 0.3, 0.45, 0.62, 0.8, 0.97] if not quick else [0.2, 0.7]
    phs_s = np.radians([0, 30, 60, 90]) if not quick else np.radians([0, 90])
    mus_v = [0.05, 0.1, 0.17, 0.27, 0.4, 0.58, 0.8, 0.98] if not quick else [0.1, 0.6]
    phs_v = np.radians(np.arange(0, 360, 30)) if not quick else np.radians([0, 90, 180])
    suns = [(m, p) for m in mus_s for p in phs_s]
    views = [(m, p) for m in mus_v for p in phs_v]
    rows_sun, rows_sky = [], []
    for t in range(n):
        rng = hash_rng(seed0 * 1000 + t)
        groove = int(rng.random() < 0.6)
        exposure = rng.uniform(0.15, 1.0)
        rubber = 0.0 if rng.random() < 0.55 else rng.uniform(0.2, 1.0)
        wet = 0.0 if rng.random() < 0.4 else rng.uniform(0.05, 1.0)
        t0 = time.time()
        h, alb, a2, water, wl = make_surface(rng, groove, exposure, rubber, wet)
        S, K, A = render_tile(h, alb, a2, water, wl, suns, views, rng)
        tid = seed0 * 1000 + t
        p = [tid, groove, exposure, rubber, wet, A]
        rows_sun += [p + list(r) for r in S]
        rows_sky += [p + list(r) for r in K]
        print(f'tile {tid}: groove {groove} exp {exposure:.2f} rub {rubber:.2f} wet {wet:.2f} A {A:.3f}  '
              f'Kd {S[:, 4].min():.2f}..{S[:, 4].max():.2f} Ks {S[:, 5].max():.3f}  Hd {K[:, 2].mean():.2f} Hs {K[:, 3].mean():.3f}  {time.time() - t0:.0f} s', flush=True)
        np.savez(out, sun=np.array(rows_sun), sky=np.array(rows_sky))


if __name__ == '__main__':
    main()
