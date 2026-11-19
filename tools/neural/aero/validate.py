"""Validation of the reference solver against classical results. Prints a table and writes results/validation.json.

    python3 tools/neural/aero/validate.py
"""
import json
import math
import os
import numpy as np

import solver as S

DEG = S.DEG
PI = math.pi
HERE = os.path.dirname(os.path.abspath(__file__))
rows = []


def rec(case, quantity, value, ref, source):
    err = (value - ref) / abs(ref) * 100 if ref else float('nan')
    rows.append(dict(case=case, quantity=quantity, solver=round(float(value), 4), reference=round(float(ref), 4), error_pct=round(float(err), 1), source=source))
    print(f'{case:34} {quantity:26} solver {value:8.4f}   reference {ref:8.4f}   {err:+6.1f} %   {source}')


def planform(b, chord, sweep_le=0.0, dihedral=0.0, n=60):
    """Sections of a wing with chord(eta) and a straight leading edge swept by sweep_le; reference area by quadrature."""
    y = np.linspace(0, b / 2, n)
    c = np.array([chord(t) for t in y / (b / 2)])
    return [(yy, yy * math.tan(sweep_le * DEG), cc, yy * math.tan(dihedral * DEG), 0.0) for yy, cc in zip(y, c)], 2 * float(np.sum(0.5 * (c[1:] + c[:-1]) * np.diff(y)))


def wing(b, chord, sweep_le=0.0, quarter_straight=False, dihedral=0.0, xcg=None, htail=None):
    secs, area = planform(b, chord, sweep_le, dihedral)
    if quarter_straight:                                   # straight quarter-chord line (elliptic wing)
        secs = [(y, -0.25 * c, c, z, i) for (y, _, c, z, i) in secs]
    cref = area / b
    spec = dict(cg=(0.25 * secs[0][2] + secs[0][1] if xcg is None else xcg, 0.0), wing=dict(sections=secs), Sref=area, bref=b, cref=cref)
    if htail:
        spec['htail'] = htail
    return spec, b * b / area


INV = S.Section(aL0=0.0, a_stall=60 * DEG, a_stall_neg=60 * DEG, cd0=0.0)


def slope(g, key='CL', **kw):
    a = np.array([-1.0, 1.0]) * DEG
    o = S.solve(g, INV, a, linear=True, **kw)
    return (o[key][1] - o[key][0]) / (2 * DEG)


def main():
    # 1. elliptic wings: lifting-line theory and Helmbold's lifting-surface formula; span efficiency
    for AR in (6.0, 10.0, 20.0):
        b = 10.0; c0 = 4 * b / (PI * AR)
        spec, ar = wing(b, lambda e: c0 * math.sqrt(max(1 - e * e, 1e-4)), quarter_straight=True)
        for n in (12, 40):
            g = S.build_geometry(spec, n_wing=n)
            a = slope(g)
            o = S.solve(g, INV, np.array([5 * DEG]), linear=True)
            e = o['CL'][0] ** 2 / (PI * ar * (o['CD'][0] - o['CDv'][0]))
            rec(f'elliptic AR {AR:.0f}, {n} strips/half', 'CL_alpha vs Helmbold', a, 2 * PI * ar / (2 + math.sqrt(ar * ar + 4)), 'Helmbold lifting surface')
            if n == 12:
                rec(f'elliptic AR {AR:.0f}, {n} strips/half', 'CL_alpha vs lifting line', a, 2 * PI * ar / (ar + 2), 'Prandtl lifting line')
            rec(f'elliptic AR {AR:.0f}, {n} strips/half', 'span efficiency e', e, 1.0, 'elliptic loading')
    # 2. rectangular wing AR 6: Glauert's lifting-line series (tau = 0.163, delta = 0.046)
    spec, ar = wing(6.0, lambda e: 1.0)
    g = S.build_geometry(spec, n_wing=12)
    a = slope(g); o = S.solve(g, INV, np.array([5 * DEG]), linear=True)
    rec('rectangular AR 6', 'CL_alpha', a, 2 * PI / (1 + 2 * 1.163 / 6), 'Glauert lifting line')
    rec('rectangular AR 6', 'CL_alpha', a, 2 * PI * 6 / (2 + math.sqrt(40)), 'Helmbold')
    rec('rectangular AR 6', 'span efficiency e', o['CL'][0] ** 2 / (PI * 6 * (o['CD'][0] - o['CDv'][0])), 1 / 1.046, 'Glauert lifting line')
    # 3. Warren-12 planform (span 2 sqrt 2, root 1.5, tip 0.5, leading-edge sweep 53.54 deg), moments about the apex
    b = 2 * math.sqrt(2)
    secs = [(0.0, 0.0, 1.5, 0.0, 0.0), (b / 2, b / 2 * math.tan(53.54 * DEG), 0.5, 0.0, 0.0)]
    spec = dict(cg=(0.0, 0.0), wing=dict(sections=secs), Sref=b * 1.0, bref=b, cref=1.0)
    g = S.build_geometry(spec, n_wing=12)
    rec('Warren-12 swept wing', 'CL_alpha', slope(g), 2.743, 'standard VLM test case')
    rec('Warren-12 swept wing', 'Cm_alpha (apex)', slope(g, 'Cm'), -3.10, 'standard VLM test case')
    # 4. Bertin & Smith: AR 5, 45 deg sweep, untapered, four panels per half span
    b = 5.0
    secs = [(0.0, 0.0, 1.0, 0.0, 0.0), (b / 2, b / 2, 1.0, 0.0, 0.0)]
    spec = dict(cg=(0.0, 0.0), wing=dict(sections=secs), Sref=5.0, bref=b, cref=1.0)
    g = S.build_geometry(spec, n_wing=4)
    g4 = S.build_geometry(dict(spec), n_wing=4)
    rec('swept 45 deg AR 5, 4 strips/half', 'CL_alpha', slope(g4), 3.443, 'Bertin & Smith VLM example (measured 3.4, Weber & Brebner)')
    rec('swept 45 deg AR 5, 12 strips/half', 'CL_alpha', slope(S.build_geometry(spec, n_wing=12)), 3.4, 'Weber & Brebner wind tunnel')
    # 5. roll damping and dihedral effect
    spec, ar = wing(8.0, lambda e: 1.0)
    g = S.build_geometry(spec, n_wing=12)
    o = S.solve(g, INV, np.array([2 * DEG, 2 * DEG]), p=np.array([-0.01, 0.01]), linear=True)
    a0 = 2 * PI
    rec('rectangular AR 8', 'Cl_p', (o['Cl'][1] - o['Cl'][0]) / 0.02, -a0 * 8 / (8 * (8 + 4)), 'lifting line, elliptic loading (-a0 A / 8(A+4))')
    spec, ar = wing(8.0, lambda e: 1.0, dihedral=5.0)
    g = S.build_geometry(spec, n_wing=12)
    o = S.solve(g, INV, np.array([2 * DEG, 2 * DEG]), beta=np.array([-2 * DEG, 2 * DEG]), linear=True)
    clb = (o['Cl'][1] - o['Cl'][0]) / (np.sin(2 * DEG) * 2)
    acl = slope(S.build_geometry(wing(8.0, lambda e: 1.0)[0], n_wing=12))
    rec('rectangular AR 8, 5 deg dihedral', 'Cl_beta', clb, -acl * 5 * DEG / 4 * (1 + 2 * 1) / (3 * (1 + 1)) * 2, 'strip theory -(a Gamma / 4), an upper bound')
    # 6. far-wake downwash behind an elliptic wing: 2 CL / (pi A) on the centreline far downstream
    AR = 8.0; b = 10.0; c0 = 4 * b / (PI * AR)
    spec, ar = wing(b, lambda e: c0 * math.sqrt(max(1 - e * e, 1e-4)), quarter_straight=True)
    g = S.build_geometry(spec, n_wing=24)
    al = np.array([5 * DEG])
    o = S.solve(g, INV, al, linear=True, detail=True)
    U = np.array([[math.cos(al[0]), 0.0, math.sin(al[0])]])
    for xb in (0.5, 1.0, 5.0):
        P = np.array([[[xb * b * U[0, 0], 0.0, xb * b * U[0, 2]]]])
        V = S.horseshoe(P, g.A, g.B, g.TA, g.TB, U, np.full((1, g.nstrips()), (0.02 * g.w) ** 2))
        w = np.einsum('bmnk,bn->bmk', V, o['G'])[0, 0]
        eps = -(w[2] * U[0, 0] - w[0] * U[0, 2])
        ref = 2 * o['CL'][0] / (PI * ar)
        if xb == 5.0:
            rec('elliptic AR 8 wake', f'downwash at {xb:.0f} spans aft', eps, ref, '2 CL / (pi A), far wake')
        else:                                              # lifting line with a rolled-up bound vortex: finite distance
            rec('elliptic AR 8 wake', f'downwash at {xb:.1f} span aft', eps, ref * (0.5 + 0.5 * math.sqrt(1 + (0.5 * PI / 4 / xb) ** 2)), 'horseshoe of span pi b / 4')
    # 7. ground effect, rectangular AR 8: induced-drag factor at equal CL against Prandtl's biplane interference factor
    spec, ar = wing(10.0, lambda e: 1.25)
    g = S.build_geometry(spec, n_wing=12)
    sigma = {0.1: 0.655, 0.15: 0.561, 0.2: 0.485, 0.3: 0.370, 0.4: 0.290, 0.5: 0.230}         # Prandtl, gap / span
    hb = np.array([0.075, 0.1, 0.15, 0.2, 0.25])
    al = np.full(len(hb), 4 * DEG)
    f = S.solve(g, INV, al[:1], linear=True); o = S.solve(g, INV, al, linear=True, h=hb * 10.0)
    kf = (f['CD'][0] - f['CDv'][0]) / f['CL'][0] ** 2
    k = (o['CD'] - o['CDv']) / o['CL'] ** 2 / kf
    for i, x in enumerate(hb):
        rec('ground effect, rect AR 8, 4 deg', f'CDi/CL^2 ratio, h/b {x}', k[i], 1 - sigma[round(2 * x, 2)], 'Prandtl biplane sigma (Wieselsberger)')
        rec('ground effect, rect AR 8, 4 deg', f'CDi/CL^2 ratio, h/b {x}', k[i], (16 * x) ** 2 / (1 + (16 * x) ** 2), 'McCormick formula (the analytic model)')
    for i, x in enumerate(hb):
        rows.append(dict(case='ground effect, rect AR 8, 4 deg', quantity=f'CL / CL free, h/b {x}', solver=round(float(o['CL'][i] / f['CL'][0]), 4)))
        print(f"{'ground effect, rect AR 8, 4 deg':34} CL / CL free, h/b {x:<8} solver {o['CL'][i] / f['CL'][0]:8.4f}")
    # 8. stall progression: where the wing lets go first, and the pitch break
    sec = S.Section(aL0=-2 * DEG, a_stall=14 * DEG, a_stall_neg=12 * DEG, width=2 * DEG)
    for name, sw, lam in (('rectangular AR 7', 0.0, 1.0), ('tapered 0.4, unswept', 0.0, 0.4), ('swept 35 deg, taper 0.3, AR 8', 35.0, 0.3)):
        b = 10.0; AR = 8.0 if sw else 7.0
        cr = 2 * b / (AR * (1 + lam))
        secs = [(0.0, 0.0, cr, 0.0, 0.0), (b / 2, b / 2 * math.tan(sw * DEG) if sw else 0.25 * cr * (1 - lam), cr * lam, 0.0, 0.0)]
        area = b * cr * (1 + lam) / 2
        mac = 2 / 3 * cr * (1 + lam + lam * lam) / (1 + lam); ymac = b / 6 * (1 + 2 * lam) / (1 + lam)
        xac = ymac * (secs[1][1] / (b / 2)) + 0.25 * mac
        spec = dict(cg=(xac - 0.05 * mac, 0.0), wing=dict(sections=secs), Sref=area, bref=b, cref=mac)
        g = S.build_geometry(spec, n_wing=12)
        al = np.arange(4, 30.01, 0.5) * DEG
        o = S.solve(g, sec, al, detail=True)
        k = int(np.argmax(o['CL']))
        f = o['f'][k][g.side > 0]; eta = g.eta[g.side > 0]
        first = float(eta[np.argmin(f)])
        dcm = float(o['Cm'][k + 4] - o['Cm'][k] - (o['Cm'][k - 6] - o['Cm'][k - 10]))
        rows.append(dict(case=f'stall progression, {name}', quantity='CLmax, alpha, most separated station eta, Cm break over 2 deg past CLmax',
                         solver=[round(float(o['CL'][k]), 3), round(float(al[k] / DEG), 1), round(first, 2), round(dcm, 4)]))
        print(f"stall progression, {name:30} CLmax {o['CL'][k]:.3f} at {al[k] / DEG:.1f} deg; separation starts at eta = {first:.2f}; "
              f"pitch break {dcm:+.4f} ({'nose up' if dcm > 0 else 'nose down'})")
    with open(os.path.join(HERE, 'results', 'validation.json'), 'w') as fjs:
        json.dump(rows, fjs, indent=1)


if __name__ == '__main__':
    main()
