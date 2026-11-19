"""End-to-end check in image terms: brightness of a plane-parallel cloud layer as a renderer would compute it
with each scattering model, against the path-traced reference.

  .venv/bin/python render_slab.py        (after train.py / evaluate.py; writes runs/slab_render.{json,md})

A camera looks straight down at the layer from above (reflected light) or straight up from below (transmitted
light).  The pixel radiance is  I = int J(tau) exp(-tau_view) dtau_view  with J from the model, evaluated with the
exact features of the slab (tauSun = tau/mu0, tauUp = tau, tauDown = tau* - tau).  Reported as the reflectance /
transmittance factor  pi I / (mu0 E_sun)  (1 = a white Lambertian surface under the same sun).
"""
import json
import math
import os
import numpy as np
import torch

import model as M
import phase as ph
from mcrt import slab_medium
from evaluate import load_net, bake_lut, sample_lut, bake_factor4, sample_factor4


def main():
    torch.set_num_threads(2)
    ev = json.load(open('runs/eval.json'))
    tuned = ev['tuned_octaves']
    net, _, _ = load_net('main')
    lut = bake_lut(net)
    have4 = os.path.exists('runs/main4.pt')
    if have4:
        B, A, bias4 = bake_factor4(load_net('main4')[0])
    models = {
        'single': lambda ts, tu, c, td: M.baseline_single(ts, tu, c),
        'octaves stock': lambda ts, tu, c, td: M.baseline_octaves(ts, tu, c),
        'octaves fitted': lambda ts, tu, c, td: M.baseline_octaves(ts, tu, c, a=tuned['a'], b=tuned['b'], c=tuned['c'],
                                                                 n=tuned['n'], gain=tuned['gain']),
        'NEURAL (LUT)': lambda ts, tu, c, td: M.baseline_single(ts, tu, c) + sample_lut(lut, ts, tu, c),
    }
    if have4:
        models['NEURAL-4 (+tauDown)'] = lambda ts, tu, c, td: M.baseline_single(ts, tu, c) + sample_factor4(B, A, bias4, ts, tu, c, td)
    rows = []
    rng = np.random.default_rng(3)
    n, paths = 6000, 64
    for view in ('above', 'below'):
        for mu0 in (0.9, 0.4):
            for tau_s in (0.25, 1.0, 4.0, 16.0, 64.0):
                med = slab_medium(tau_s, mu0, nz=64)
                h = med.size[2]
                span = 1.0 - math.exp(-tau_s)
                t_view = np.minimum(-np.log(1.0 - rng.random(n) * span), tau_s * (1 - 1e-12))   # optical distance from the exit face
                tau = t_view if view == 'above' else tau_s - t_view                                # depth below the top
                w = np.tile([0.0, 0.0, 1.0 if view == 'above' else -1.0], (n, 1))
                pos = np.column_stack([np.zeros(n), np.zeros(n), np.clip(h * (1 - tau / tau_s), 1e-9 * h, h * (1 - 1e-12))])
                cos_t = -mu0 if view == 'above' else mu0
                c = np.full(n, cos_t)
                res = med.estimate(pos, w, paths, albedo=0.9999, seed=int(1000 * mu0 + 10 * tau_s) + (view == 'below'))
                jss = ph.phase_np(c) * np.exp(-tau / mu0)
                jref = jss + 0.5 * (res[:, 0] + res[:, 1])
                k = span * math.pi / mu0
                row = dict(view=view, mu0=mu0, tau=tau_s, reference=float(jref.mean() * k),
                           reference_se=float(jref.std(ddof=1) / math.sqrt(n) * k))
                for name, f in models.items():
                    row[name] = float(np.mean(f(tau / mu0, tau, c, tau_s - tau)) * k)
                rows.append(row)
    names = list(models.keys())
    lines = ['| view | sun mu0 | layer tau | path-traced reference | ' + ' | '.join(names) + ' |',
             '|---|---|---|---|' + '---|' * len(names)]
    for r in rows:
        lines.append('| %s | %.1f | %g | %.4f +- %.4f | ' % (r['view'], r['mu0'], r['tau'], r['reference'], r['reference_se'])
                     + ' | '.join('%.4f (%+.0f %%)' % (r[k], 100 * (r[k] / r['reference'] - 1)) for k in names) + ' |')
    # summary: RMS of ln(model/reference) over all rows
    lines.append('')
    lines.append('RMS of ln(model / reference) over the %d cases: ' % len(rows) + ', '.join(
        '%s %.2f' % (k, math.sqrt(np.mean([math.log(max(r[k], 1e-12) / r['reference']) ** 2 for r in rows]))) for k in names))
    txt = '\n'.join(lines)
    print(txt)
    with open('runs/slab_render.md', 'w') as f:
        f.write(txt + '\n')
    with open('runs/slab_render.json', 'w') as f:
        json.dump(rows, f, indent=1)


if __name__ == '__main__':
    main()
