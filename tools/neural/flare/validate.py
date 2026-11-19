"""Validation of the flare reference: lens first-order data, coatings, ghost positions vs paraxial theory, energy
bookkeeping.  Writes results/validation.json.

  cd tools/neural/flare && OMP_NUM_THREADS=1 nice -n 10 python3 validate.py
"""
import json
import math
import os
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lens import Lens            # noqa: E402
from ghosts import RES, ghost_list, gname, U0_FRAC   # noqa: E402


def main():
    L = Lens()
    out = {}
    p = {lam: L.paraxial(lam) for lam in (486.13, 550.0, 587.56, 656.27)}
    out['first_order'] = dict(
        efl_mm={str(k): v['efl'] for k, v in p.items()}, bfl_mm=L.bfl, total_track_mm=L.z_img,
        entrance_pupil_z_mm=L.z_ep, pupil_magnification=p[550.0]['pupil_mag'],
        f_number_wide_open=L.efl / (2 * 17.1 / 2 * p[550.0]['pupil_mag']),
        f_number_working=L.efl / (2 * L.ep_radius), stop_radius_mm=L.stop_radius,
        axial_colour_bfl_F_minus_C_mm=L.paraxial(486.13)['bfl'] - L.paraxial(656.27)['bfl'])
    # real-ray image quality and distortion (550 nm)
    rows = []
    for th in (0.0, 5.0, 10.0, 15.0, 20.0):
        t = math.radians(th)
        pp, d, dA = L.entrance_rays(t, L.ep_radius * 1.05, 96, centre=(0.0, 0.0))
        xy, w, al = L.trace(pp, d, 550.0)
        c = (xy[al] * w[al, None]).sum(0) / w[al].sum()
        rows.append(dict(field_deg=th, rms_spot_um=1e3 * float(np.sqrt(((xy[al] - c) ** 2).sum(1).mean())),
                         distortion_pct=100 * float(c[0] / (L.efl * math.tan(t)) - 1) if th > 0 else 0.0,
                         relative_illumination=float((w * dA).sum() / (math.pi * L.ep_radius ** 2) / math.cos(t))))
    out['imaging'] = rows
    # coatings: reflectance of an MgF2-coated surface on n = 1.67 glass at normal incidence
    lam = np.array([400.0, 450.0, 500.0, 550.0, 600.0, 650.0, 700.0])
    R = L.reflectance(0, np.ones_like(lam), np.ones_like(lam), L.surf[0]['n'](lam), lam)
    from lens import fresnel
    out['coating_R_normal_incidence_S1'] = dict(zip([str(int(x)) for x in lam], R.tolist()))
    out['uncoated_R_S1_550'] = float(fresnel(np.array([1.0]), np.array([1.0]), L.surf[0]['n'](np.array([550.0])))[0])
    # ghost centres and sizes: traced vs paraxial at small field (from the survey)
    sv = json.load(open(os.path.join(RES, 'ghost_survey.json')))
    errs, sizes = [], []
    for row in sv['rows']:
        q = row['per'][1]                      # r = 0.6 (6.8 deg)
        if q['c_traced'] is None or row['vis'] < 1e-5:
            continue
        errs.append(abs(q['c_traced'] - q['c_paraxial']) / max(abs(q['c_paraxial']), 1e-6))
        sizes.append(q['s_traced'] * math.sqrt(2) / max(q['radius_paraxial'], 1e-9))
    out['ghost_paraxial_check_r0.6'] = dict(n=len(errs), centre_rel_err_median=float(np.median(errs)),
                                           centre_rel_err_max=float(np.max(errs)),
                                           size_ratio_traced_over_paraxial_median=float(np.median(sizes)))
    # energy bookkeeping on axis, 550 nm, one paraxial-height ray bundle: direct + 1-bounce back + 2-bounce ghosts
    pp, d, dA = L.entrance_rays(0.0, L.ep_radius * 0.5, 24)
    lamv = 550.0
    _, wdir, _ = L.trace(pp, d, lamv)
    T = float(wdir.mean())
    # single reflections exit toward the object: R_j * prod_{k<j} (1 - R_k)^2 (normal incidence approximation)
    Rk = []
    for k, s in enumerate(L.surf):
        if s['stop']:
            continue
        n1 = L.n_before(k, np.array([lamv])); n2 = L.n_after(k, np.array([lamv]))
        Rk.append(float(L.reflectance(k, np.array([1.0]), n1, n2, np.array([lamv]))[0]))
    back1 = sum(R * np.prod([(1 - x) ** 2 for x in Rk[:j]]) for j, R in enumerate(Rk))
    g2 = 0.0
    for g in ghost_list(L):
        _, w, _ = L.trace(pp, d, lamv, ghost=g)
        g2 += float(w.mean())
    out['energy_bookkeeping_axis_550'] = dict(
        direct_transmission=T, single_reflections_back_out=float(back1), two_reflection_ghosts_forward=g2,
        sum=T + float(back1) + g2, residual=1 - (T + float(back1) + g2),
        note='residual = absorbed by rims (none on axis) + three-and-more reflections (O(R^3)) + ghosts leaving backward')
    os.makedirs(RES, exist_ok=True)
    with open(os.path.join(RES, 'validation.json'), 'w') as f:
        json.dump(out, f, indent=1)
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
