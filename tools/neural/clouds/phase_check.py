"""Check the Jendersie & d'Eon (2023) analytic Mie fit (RESEARCH.md 2.2, tools/neural/phase.py) against our own
Lorenz-Mie tables (mie.py), band-averaged over RGB, for the tabulated effective radii.

    $VENV tools/neural/clouds/phase_check.py     -> data/phase_check.json, printed table

The fit is parametrised by droplet DIAMETER d for a lognormal (sigma 0.25) in diameter; we compare at d = 2 r_eff
(the natural reading) for our modified-gamma populations (v_eff 0.1), and report errors of g, of the forward peak, of
the side minimum, and at the fogbow / glory angles (which the fit does not model by construction).
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')


def jd_params(d):
    return (math.exp(-0.0990567 / (d - 1.67154)), math.exp(-2.20679 / (d + 3.91029) - 0.428934),
            math.exp(3.62489 - 8.29288 / (d + 5.52825)), math.exp(-0.599085 / (d - 0.641583) - 0.665888))


def jd_phase(mu, d):
    ghg, gd, a, wd = jd_params(d)
    hg = (1 - ghg ** 2) / (1 + ghg ** 2 - 2 * ghg * mu) ** 1.5
    dr = (1 - gd ** 2) / (1 + gd ** 2 - 2 * gd * mu) ** 1.5 * (1 + a * mu * mu) / (1 + a * (1 + 2 * gd * gd) / 3)
    return ((1 - wd) * hg + wd * dr) / (4 * math.pi)


def main():
    z = np.load(os.path.join(DATA, 'mie_tables.npz'))
    th = z['theta']
    deg = np.degrees(th)
    rows = []
    for i, re in enumerate(z['reff']):
        p = z['P'][i].mean(0)
        best = None
        for d in np.linspace(5, 50, 181):
            q = jd_phase(np.cos(th), d)
            # log error over 2-178 deg (energy-weighted region where both are smooth)
            sel = (deg > 2) & (deg < 178)
            e = np.sqrt(np.mean(np.log(q[sel] / p[sel]) ** 2))
            if best is None or e < best[0]:
                best = (e, d)
        d2 = 2 * re
        q = jd_phase(np.cos(th), d2)
        g_fit = 2 * math.pi * np.trapezoid(q * np.cos(th) * np.sin(th), th)
        g_mie = 2 * math.pi * np.trapezoid(p * np.cos(th) * np.sin(th), th)
        at = lambda a, arr: float(np.interp(a, deg, arr))
        row = dict(reff=float(re), d=d2, g_mie=g_mie, g_fit=g_fit, p0_mie=float(p[0]), p0_fit=float(q[0]),
                   p30=(at(30, p), at(30, q)), p100=(at(100, p), at(100, q)), bow=(at(141.5, p), at(141.5, q)),
                   p180=(float(p[-1]), float(q[-1])),
                   log_rmse_2_178=float(np.sqrt(np.mean(np.log(q[(deg > 2) & (deg < 178)] / p[(deg > 2) & (deg < 178)]) ** 2))),
                   best_d=float(best[1]), best_log_rmse=float(best[0]))
        rows.append(row)
        print(f"r_eff {re:4.1f} (d={d2:4.1f}): g mie {g_mie:.4f} fit {g_fit:.4f} | p(0) {row['p0_mie']:.0f} vs {row['p0_fit']:.0f} | "
              f"p30 {row['p30'][0]:.3f}/{row['p30'][1]:.3f} p100 {row['p100'][0]:.4f}/{row['p100'][1]:.4f} "
              f"bow {row['bow'][0]:.4f}/{row['bow'][1]:.4f} p180 {row['p180'][0]:.3f}/{row['p180'][1]:.3f} | "
              f"ln-RMSE {row['log_rmse_2_178']:.3f} (best d {best[1]:.1f}: {best[0]:.3f})")
    json.dump(rows, open(os.path.join(DATA, 'phase_check.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
