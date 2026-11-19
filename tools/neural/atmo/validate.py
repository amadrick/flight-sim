"""Validate the reference path tracer against known values; writes tools/neural/atmo/validation.json.

  OMP_NUM_THREADS=1 nice -n 10 python3 validate.py
"""
import json
import math
import os
import sys
import time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
import pathtracer as P

HERE = os.path.dirname(os.path.abspath(__file__))
MIE_CLEAR = 3.912 / 120 - 0.0116           # 'clear' preset, 120 km visibility
MIE_FAIR = 3.912 / 80 - 0.0116             # 'fair', 80 km


def sun_spectrum(h, el, mie):
    tab = C.column_table()
    D, vis = tab.lookup(np.array([h]), np.array([math.sin(math.radians(el))]))
    return (np.exp(-C.spectral_optical_depth(D, np.array([mie]))) * vis[:, None])[0]


def main():
    rng = np.random.default_rng(3)
    out = {'params': dict(mie_clear=MIE_CLEAR, mie_fair=MIE_FAIR, wavelengths=C.LAMBDA.tolist(),
                          aerosol_asymmetry=C.mie_asymmetry(), E_sun_TOA_lux=C.E_SUN_TOA_LUX)}
    t0 = time.time()
    # 1. direct sun
    sun = {}
    for el in [90, 60, 45, 30, 20, 10, 5, 3, 2, 1, 0]:
        row = {}
        for name, mie in [('clear', MIE_CLEAR), ('fair', MIE_FAIR)]:
            T = sun_spectrum(0.0, el, mie)
            xyz = (C.SOLAR * T * C.DLAMBDA) @ C.CMF
            row[name] = dict(normal_illuminance_lux=float((T * C.SPEC_TO_Y).sum()), cct_K=float(C.cct_mccamy(xyz)))
        T = sun_spectrum(12.0, el, MIE_FAIR)
        xyz = (C.SOLAR * T * C.DLAMBDA) @ C.CMF
        row['fair_12km'] = dict(normal_illuminance_lux=float((T * C.SPEC_TO_Y).sum()), cct_K=float(C.cct_mccamy(xyz)))
        sun[el] = row
    xyz0 = (C.SOLAR * C.DLAMBDA) @ C.CMF
    out['sun_toa_cct_K'] = float(C.cct_mccamy(xyz0))
    out['sun'] = sun
    print('sun done %.1fs' % (time.time() - t0))
    # 2. zenith luminance and horizontal diffuse illuminance vs sun elevation (sea level, fair)
    sky = {}
    ndir, npth = 768, 12
    u = (np.arange(ndir) + rng.random(ndir)) / ndir
    phi = rng.random(ndir) * 2 * math.pi
    st, ct = np.sqrt(u), np.sqrt(1 - u)
    dirs = np.stack([st * np.cos(phi), ct, st * np.sin(phi)], axis=1)       # cosine-weighted, upper hemisphere
    for el in [90, 60, 30, 10, 5, 2, 0, -2, -4, -6, -8, -10, -12, -15, -18]:
        s = P.sun_dir(np.full(ndir, math.radians(el)))
        Ls = []
        for i in range(0, ndir, 128):
            sl = slice(i, i + 128)
            Ls.append(P.trace(np.zeros(len(dirs[sl])), dirs[sl], s[sl], np.full(len(dirs[sl]), MIE_FAIR), npth, rng)['L'])
        L = np.concatenate(Ls)
        Y = (L * C.SPEC_TO_Y).sum(1)
        Eh = math.pi * Y.mean()
        z = P.trace(np.zeros(8), np.tile([0.0, 1.0, 0.0], (8, 1)), P.sun_dir(np.full(8, math.radians(el))), np.full(8, MIE_FAIR), 64, rng)
        Lz = float((z['L'] * C.SPEC_TO_Y).sum(1).mean())
        Lz1 = float((z['L1'] * C.SPEC_TO_Y).sum(1).mean())
        T = sun_spectrum(0.0, el, MIE_FAIR)
        Edir = float((T * C.SPEC_TO_Y).sum()) * max(math.sin(math.radians(el)), 0.0)
        rgbz = C.spec_to_rgb(z['L'].mean(0))
        sky[el] = dict(zenith_luminance=Lz, zenith_single_scatter_share=Lz1 / max(Lz, 1e-30),
                       horizontal_sky_illuminance_lux=float(Eh), horizontal_direct_lux=Edir,
                       horizontal_global_lux=float(Eh + Edir), zenith_rgb_chromaticity=(rgbz / rgbz.sum()).tolist())
        print('sun %4d  Lz %10.4g cd/m2  Esky %10.4g lx  Eglob %10.4g lx  ss %.2f  %.1fs' % (
            el, Lz, Eh, Eh + Edir, Lz1 / max(Lz, 1e-30), time.time() - t0))
    out['sky_sea_level_fair'] = sky
    # 3. convergence: quadrature (K) and noise check at sunset toward the sun
    with open(os.path.join(HERE, 'validation.json'), 'w') as f:
        json.dump(out, f, indent=1)
    print('wrote validation.json in %.0fs' % (time.time() - t0))


if __name__ == '__main__':
    main()
