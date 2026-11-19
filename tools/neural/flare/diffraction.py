"""Starburst + glare kernel: Fraunhofer diffraction of the iris (FFT of the aperture mask with dust specks and
scratches), integrated over the visible spectrum, convolved with the sun's disc, plus veiling glare from the
micro-roughness scatter of the ten lens surfaces (Harvey-Shack model).

  cd tools/neural/flare && OMP_NUM_THREADS=1 nice -n 10 python3 diffraction.py

Output data/star.npz: RGB point-spread density (fraction of the collected sun flux per frame-unit^2, white
equal-energy source) on a polar grid folded by the iris symmetry:
  r   in frame units (1 = half the image height) from 0.012 to 2.4 (log spaced),
  phi angle from the nearest diffraction spike, 0 .. 30 deg (6 straight blades -> 6 spikes, mirror symmetric).
Separately: 'diff' (diffraction x sun) and 'veil' (scatter) parts, and validation numbers in results/.

Units of the diffraction pattern: on the sensor the pattern scales with lambda * N (N = f-number); in frame units
(1 = U0 = 0.2 EFL) one lambda/D is lambda N / U0.  This is independent of the focal length, so the same table holds
for any focal length with the same sensor and f-number, i.e. for the sim camera at any zoom.
"""
import json
import math
import os
import sys
import time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lens import Lens, spectral_rgb_weights, polygon_mask_soft   # noqa: E402
from ghosts import S_SUN, U0_FRAC, DATA, RES                        # noqa: E402

NFFT = 4096
PAD = 2                         # pupil (circumscribed) diameter = NFFT / PAD samples
RHO_MAX = 900.0                 # lambda/D: trusted radius of the FFT (aliasing beyond ~1000)
LAMS = np.linspace(400, 700, 31)
SPIKE0 = math.radians(15.0)     # direction of the first spike (display frame, counter-clockwise from +x)
BLADES = 6
DX = 0.001                      # frame-unit bin of the cartesian pattern
EXT = 0.17                      # half-extent of the cartesian pattern (frame units)
SIGMA_ROUGH = 2.0e-9 * 1e9      # nm rms surface micro-roughness of the polished glass
HARVEY_L, HARVEY_S = 0.004, 2.2  # Harvey-Shack shoulder (direction cosine) and slope
R_TAB = np.exp(np.linspace(math.log(0.012), math.log(2.4), 192))
PHI_TAB = np.linspace(0, math.pi / BLADES, 64)   # 0 .. 30 deg from a spike (half the spike spacing)


def aperture(rng):
    """Iris mask on the NFFT grid: hexagon (circumradius NFFT/(2 PAD)), edge spikes perpendicular to the blades,
    with dust specks and three hairline scratches.  Returns float32 mask and stats."""
    n = NFFT
    R = n / (2 * PAD)
    c = (np.arange(n) - n / 2 + 0.5).astype(np.float32)
    X, Y = np.meshgrid(c, c, indexing='xy')
    # vertices at SPIKE0 + 30 deg + k 60 deg so that the edge normals (spike directions) are SPIKE0 + k 60 deg
    m = polygon_mask_soft(X, Y, R, BLADES, 1.0, rot=SPIKE0 + math.pi / BLADES).astype(np.float32)
    open_area = m.sum()
    # dust: opaque specks, 25-100 um on a 12.6 mm pupil (radius 2-8 samples), covering ~0.2 % of the pupil
    nd = 0
    dust = 0.0
    while dust < 0.002 * open_area:
        rad = rng.uniform(2.0, 8.0)
        a, rr = rng.uniform(0, 2 * math.pi), R * 0.92 * math.sqrt(rng.uniform())
        cx, cy = rr * math.cos(a), rr * math.sin(a)
        i0, i1 = int(cy + n / 2 - rad - 2), int(cy + n / 2 + rad + 3)
        j0, j1 = int(cx + n / 2 - rad - 2), int(cx + n / 2 + rad + 3)
        sub = np.clip(rad + 0.5 - np.hypot(X[i0:i1, j0:j1] - cx, Y[i0:i1, j0:j1] - cy), 0, 1)
        before = m[i0:i1, j0:j1].sum()
        m[i0:i1, j0:j1] *= 1 - sub
        dust += before - m[i0:i1, j0:j1].sum()
        nd += 1
    # scratches: three hairlines 1 sample (6 um) wide, 0.3-0.6 R long
    scratch = 0.0
    for _ in range(3):
        a = rng.uniform(0, math.pi)
        ln = rng.uniform(0.3, 0.6) * R
        cx, cy = rng.uniform(-0.4, 0.4) * R, rng.uniform(-0.4, 0.4) * R
        ux, uy = math.cos(a), math.sin(a)
        box = int(ln / 2 + 3)
        i0, i1 = int(cy + n / 2 - box), int(cy + n / 2 + box)
        j0, j1 = int(cx + n / 2 - box), int(cx + n / 2 + box)
        dx, dy = X[i0:i1, j0:j1] - cx, Y[i0:i1, j0:j1] - cy
        along, across = dx * ux + dy * uy, -dx * uy + dy * ux
        sub = np.clip(1.0 - np.abs(across), 0, 1) * (np.abs(along) < ln / 2)
        before = m[i0:i1, j0:j1].sum()
        m[i0:i1, j0:j1] *= 1 - sub
        scratch += before - m[i0:i1, j0:j1].sum()
    return m, dict(open_area_samples=float(open_area), dust_specks=nd, dust_fraction=float(dust / open_area),
                   scratch_fraction=float(scratch / open_area), hexagon_vs_circle=float(open_area / (math.pi * R * R)))


def polygon_ft2(kx, ky, R, blades, rot):
    """|FT|^2 of a regular polygon (circumradius R, area-normalised so that |FT(0)|^2 = area^2), exact (Green)."""
    v = [(R * math.cos(rot + 2 * math.pi * i / blades), R * math.sin(rot + 2 * math.pi * i / blades)) for i in range(blades + 1)]
    k2 = kx * kx + ky * ky
    F = np.zeros(kx.shape, complex)
    for i in range(blades):
        ax, ay = v[i]; bx, by = v[i + 1]
        ex, ey = bx - ax, by - ay
        ln = math.hypot(ex, ey); tx, ty = ex / ln, ey / ln
        nx, ny = ty, -tx            # outward normal for counter-clockwise vertices
        kt = kx * tx + ky * ty
        kn = kx * nx + ky * ny
        ph = np.exp(-1j * (kx * ax + ky * ay))
        small = np.abs(kt * ln) < 1e-6
        seg = np.where(small, ln + 0j, (1 - np.exp(-1j * ln * kt)) / np.where(small, 1, 1j * kt))
        F += kn * ph * seg
    return np.abs(1j * F / k2) ** 2


def main():
    t0 = time.time()
    L = Lens()
    N = L.f_number
    U0 = U0_FRAC * L.efl            # mm
    rng = np.random.default_rng(7)
    mask, stats = aperture(rng)
    print('aperture', stats, '%.1fs' % (time.time() - t0), flush=True)
    F = np.fft.fftshift(np.fft.fft2(mask))
    del mask
    I = (F.real ** 2 + F.imag ** 2).astype(np.float32)
    del F
    I /= I.sum()
    n = NFFT
    fr = (np.arange(n) - n / 2).astype(np.float32) / PAD     # lambda/D per FFT pixel = 1/PAD
    FX, FY = np.meshgrid(fr, fr, indexing='xy')
    rho = np.hypot(FX, FY)
    keep = rho <= RHO_MAX
    fx, fy, w = FX[keep], FY[keep], I[keep]
    frac_kept = float(w.sum())
    # energy bookkeeping of the diffraction pattern
    ee = {}
    for rr in (2.0, 10.0, 50.0, 200.0, 900.0):
        ee['outside_%g_lambda_over_D' % rr] = float(I[rho > rr].sum())
    del FX, FY, I, rho
    print('fft done %.1fs, energy inside rho<=%g: %.6f' % (time.time() - t0, RHO_MAX, frac_kept), flush=True)
    # spectral integration: bin the monochromatic pattern (rescaled by lambda) onto a frame-unit grid
    nb = int(round(2 * EXT / DX))
    rgbw = spectral_rgb_weights(LAMS)
    cart = np.zeros((3, nb, nb))
    for li, lam in enumerate(LAMS):
        s = lam * 1e-6 * N / U0                      # frame units per lambda/D
        ix = np.floor((fx * s + EXT) / DX).astype(np.int32)
        iy = np.floor((fy * s + EXT) / DX).astype(np.int32)
        ok = (ix >= 0) & (ix < nb) & (iy >= 0) & (iy < nb)
        h = np.bincount(iy[ok] * nb + ix[ok], weights=w[ok], minlength=nb * nb).reshape(nb, nb)
        for ch in range(3):
            cart[ch] += rgbw[li, ch] * h
    cart /= DX * DX                                  # density per frame-unit^2
    print('spectral binning %.1fs' % (time.time() - t0), flush=True)
    # extended source: convolve with the sun's limb-darkened disc
    c = (np.arange(nb) - nb / 2 + 0.5) * DX
    XX, YY = np.meshgrid(c, c, indexing='xy')
    rr = np.hypot(XX, YY) / S_SUN
    mu = np.sqrt(np.clip(1 - rr * rr, 0, 1))
    disc = np.where(rr < 1, 1 - 0.6 * (1 - mu), 0.0)
    disc /= disc.sum()
    P = 2 * nb
    Dk = np.fft.rfft2(np.fft.ifftshift(np.pad(disc, ((nb // 2, nb - nb // 2), (nb // 2, nb - nb // 2)))), s=(P, P))
    conv = np.zeros_like(cart)
    for ch in range(3):
        big = np.zeros((P, P)); big[:nb, :nb] = cart[ch]
        out = np.fft.irfft2(np.fft.rfft2(big) * Dk, s=(P, P))
        conv[ch] = out[:nb, :nb]
    # (pad/shift bookkeeping: the disc kernel is centred, so out[:nb,:nb] is aligned with cart)
    conv = np.maximum(conv, 0)
    # polar, folded by the 12-element symmetry group (6 rotations x mirror)
    def sample(img, r, phi):
        vals = 0.0
        cnt = 0
        for k in range(BLADES):
            for sg in (1, -1):
                a = SPIKE0 + k * 2 * math.pi / BLADES + sg * phi
                x = r * np.cos(a); y = r * np.sin(a)
                u = (x + EXT) / DX - 0.5; v = (y + EXT) / DX - 0.5
                i0 = np.clip(np.floor(u).astype(int), 0, nb - 2); j0 = np.clip(np.floor(v).astype(int), 0, nb - 2)
                fu = np.clip(u - i0, 0, 1); fv = np.clip(v - j0, 0, 1)
                vals = vals + ((1 - fu) * (1 - fv) * img[j0, i0] + fu * (1 - fv) * img[j0, i0 + 1]
                               + (1 - fu) * fv * img[j0 + 1, i0] + fu * fv * img[j0 + 1, i0 + 1])
                cnt += 1
        return vals / cnt
    Rg, Pg = np.meshgrid(R_TAB, PHI_TAB, indexing='ij')
    r_trust = 0.97 * RHO_MAX * 400e-6 * N / U0       # blue end of the spectrum sets the trusted radius
    r_trust = min(r_trust, EXT * 0.95)
    diff = np.stack([sample(conv[ch], np.minimum(Rg, r_trust), Pg) for ch in range(3)], -1)
    # Beyond the trusted radius: power-law extrapolation fitted over r in [0.55, 0.97] r_trust.  Near a spike the
    # fit runs at constant perpendicular distance d = r sin(phi) from the spike (a spike keeps its width, set by the
    # sun's disc, and its amplitude falls as a power of r); away from the spikes it runs at constant angle.
    out = Rg > r_trust
    ro, po = Rg[out], Pg[out]
    rf = r_trust * np.linspace(0.55, 0.97, 6)
    lr = np.log(rf / r_trust)
    def fit(img, rr_list, pp_list):
        ly = np.stack([np.log(np.maximum(sample(img, rr, pp), 1e-30)) for rr, pp in zip(rr_list, pp_list)], 0)
        lm = lr.mean(); ym = ly.mean(0)
        b = ((lr - lm)[:, None] * (ly - ym)).sum(0) / ((lr - lm) ** 2).sum()
        return ym - b * lm, b                          # log value at r_trust, slope
    dperp = ro * np.sin(po)
    slope_sp, slope_bg = [], []
    for ch in range(3):
        a1, b1 = fit(conv[ch], [np.full_like(ro, x) for x in rf], [np.arcsin(np.minimum(dperp / x, 0.5)) for x in rf])
        a2, b2 = fit(conv[ch], [np.full_like(ro, x) for x in rf], [po for x in rf])
        # straight-edge diffraction falls as r^-2 along a spike and faster elsewhere: a fitted slope shallower than
        # that is an artefact of the fit window (points approaching a spike in angle), so clamp it
        b1 = np.minimum(b1, -2.0); b2 = np.minimum(b2, -2.0)
        v1 = a1 + b1 * np.log(ro / r_trust)
        v2 = a2 + b2 * np.log(ro / r_trust)
        t = np.clip((dperp / r_trust - 0.2) / 0.15, 0, 1)
        diff[..., ch][out] = np.exp(np.maximum(v1, v2) * (1 - t) + v2 * t)
        slope_sp.append(float(b1[po < 1e-3].mean())); slope_bg.append(float(b2[po > math.radians(29)].mean()))
    slopes = np.array([slope_sp, slope_bg])
    print('polar + extrapolation %.1fs (r_trust %.3f, spike slope %s, between-spike slope %s)' % (
        time.time() - t0, r_trust, slopes[0], slopes[1]), flush=True)
    # validation of the extrapolation with the exact polygon transform (clean hexagon, 550 nm, along a spike and
    # between spikes, averaged over a narrow angular window and a small band of radii)
    val = {}
    Rp = 1.0                          # circumradius; D = 2 -> lambda/D units: k = 2 pi rho / D = pi rho
    for rho0 in (300.0, 600.0, 1800.0, 3600.0):
        out_v = []
        for phi_off in (0.0, math.radians(30)):
            rr_ = rho0 * np.exp(np.linspace(-0.05, 0.05, 41))
            aa = SPIKE0 + phi_off + np.linspace(-1, 1, 401) * (3.0 / rho0)
            RR, AA = np.meshgrid(rr_, aa, indexing='ij')
            kx, ky = math.pi * RR * np.cos(AA), math.pi * RR * np.sin(AA)
            I2 = polygon_ft2(kx, ky, Rp, BLADES, SPIKE0 + math.pi / BLADES).mean()
            area = 0.5 * BLADES * Rp * Rp * math.sin(2 * math.pi / BLADES)
            # normalise: fraction per (lambda/D)^2:  |F|^2 / (area * (D/lambda)^2 normalisation) -> Parseval
            out_v.append(float(I2 / area * (math.pi ** 2) / (2 * math.pi) ** 2 * 4))
        val['rho_%g' % rho0] = dict(spike=out_v[0], between=out_v[1])
    s_sp = math.log(val['rho_3600']['spike'] / val['rho_1800']['spike']) / math.log(2)
    s_mid = math.log(val['rho_600']['spike'] / val['rho_300']['spike']) / math.log(2)
    print('exact hexagon spike slope (rho 1800->3600) %.2f, (300->600) %.2f' % (s_sp, s_mid), flush=True)
    # veiling glare: Harvey-Shack micro-roughness scatter of every refracting surface
    rgbl = spectral_rgb_weights(LAMS)
    veil = np.zeros(R_TAB.shape + (3,))
    tis_tot = np.zeros(len(LAMS))
    per_surface = []
    bb = np.exp(np.linspace(math.log(1e-5), 0, 4000))
    pb = (1 + (bb / HARVEY_L) ** 2) ** (-HARVEY_S / 2)
    norm = np.trapezoid(pb * 2 * math.pi * bb, bb)
    for k, s in enumerate(L.surf):
        if s['stop']:
            continue
        # sensor displacement per unit scatter slope: paraxial ray leaving surface k with slope 1
        y, u = 0.0, 1.0
        nn = float(L.n_after(k, 550.0))
        z = s['z']
        u = u / nn                       # slope in the medium for an angle of 1 (direction cosine) in air units
        n_signed = nn
        for kk in range(k + 1, L.nsurf):
            y, u, n_signed, z = L._para_step(y, u, n_signed, z, kk, 550.0, 'T')
        b = abs(y + (L.z_img - z) * u) / U0   # frame units per unit direction-cosine change
        dn = abs(float(L.n_after(k, 550.0)) - float(L.n_before(k, 550.0)))
        tis = (2 * math.pi * SIGMA_ROUGH * dn / LAMS) ** 2
        tis_tot += tis
        per_surface.append(dict(surface=s['name'], frame_units_per_rad=b, tis_550=float(np.interp(550, LAMS, tis))))
        beta = R_TAB / b
        dens = (1 + (beta / HARVEY_L) ** 2) ** (-HARVEY_S / 2) / norm / (b * b)
        for ch in range(3):
            veil[:, ch] += dens * (tis * rgbl[:, ch]).sum()
    total = diff + veil[:, None, :]
    os.makedirs(DATA, exist_ok=True)
    np.savez_compressed(os.path.join(DATA, 'star.npz'), r=R_TAB, phi=PHI_TAB, total=total, diff=diff, veil=veil,
                        r_trust=r_trust, slopes=slopes)
    info = dict(aperture=stats, nfft=NFFT, pad=PAD, rho_max=RHO_MAX, energy_within_rho_max=frac_kept,
                encircled=ee, f_number=N, frame_unit_mm=U0, lambda_over_D_frame_units_550=550e-6 * N / U0,
                sun_radius_frame_units=S_SUN, r_trust=r_trust,
                extrapolated_slopes_spike=slopes[0].tolist(), extrapolated_slopes_between=slopes[1].tolist(),
                exact_hexagon=val, exact_spike_slope_far=s_sp, exact_spike_slope_mid=s_mid,
                veil_tis_total_550=float(np.interp(550, LAMS, tis_tot)), veil_surfaces=per_surface,
                harvey=dict(l=HARVEY_L, s=HARVEY_S, sigma_nm=SIGMA_ROUGH), seconds=time.time() - t0)
    os.makedirs(RES, exist_ok=True)
    with open(os.path.join(RES, 'star_info.json'), 'w') as f:
        json.dump(info, f, indent=1)
    print(json.dumps({k: info[k] for k in ('energy_within_rho_max', 'encircled', 'veil_tis_total_550', 'r_trust')}, indent=1))
    print('done %.1fs' % (time.time() - t0))


if __name__ == '__main__':
    main()
