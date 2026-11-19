"""Droplet-size sensitivity: the same points path traced with the r_eff = 6 / 10 / 16 um Mie phase functions.

    $VENV tools/neural/clouds/reff_eval.py      -> results/reff_sensitivity.json
Compares the targets (J_ms, V_sky, V_gnd) between droplet sizes on identical points, and the error of the deployed
network (trained at 10 um) against each size's reference.
"""
import glob
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model as MD  # noqa: E402
import train as T  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    net = MD.load_final()
    desc = net['desc']
    out = {}
    rows = {}
    for r in (6, 16):
        fs = sorted(glob.glob(os.path.join(HERE, 'data', f'pts_r{r}', '*.npz')))
        acc = {k: [] for k in ('y10', 'yr', 'pred', 'w', 'jfp10', 'jfpr', 'jss', 'jss10', 'v10', 'vr')}
        for f in fs:
            f10 = os.path.join(HERE, 'data', 'pts', os.path.basename(f))
            tf = os.path.join(HERE, 'data', 'tap2', os.path.basename(f))
            if not (os.path.exists(f10) and os.path.exists(tf)):
                continue
            a, b, t = np.load(f), np.load(f10), np.load(tf)
            assert np.allclose(a['P'], b['P'])
            taps = t[('tapb_' if desc.get('tapSource') == 'base' else 'tap_') + 'e3'][:, [1, 2, 4], :]
            X = MD.encode(b['mt'][:, 0, -1], b['tau_cam'], np.sin(np.radians(float(b['elev']))), b['cos_t'], taps, desc)
            acc['pred'].append(MD.predict(net, X))
            acc['y10'].append(b['res'][:, [1, 4, 7]]); acc['yr'].append(a['res'][:, [1, 4, 7]])
            acc['w'].append(b['opacity']); acc['jfp10'].append(b['jfp']); acc['jfpr'].append(a['jfp']); acc['jss'].append(a['jss'])
            acc['jss10'].append(b['jss'])
            for z, k in ((b, 'v10'), (a, 'vr')):
                acc[k].append(T.targets(dict(res=z['res'], fpk=np.full(len(z['P']), float(z['f']))))[1])
        A = {k: np.concatenate(v) for k, v in acc.items()}
        w = A['w']
        res = {}
        for i, nm in enumerate(['J_ms', 'V_sky', 'V_gnd']):
            ratio = (w * A['yr'][:, i]).sum() / (w * A['y10'][:, i]).sum()
            # point-wise relative difference between sizes (both noisy: an upper bound on the true difference)
            d = (A['yr'][:, i] - A['y10'][:, i]) / (0.5 * (A['yr'][:, i] + A['y10'][:, i]) + 0.02)
            e_r = (A['pred'][:, i] - A['yr'][:, i]) / (A['yr'][:, i] + 0.05)
            e_10 = (A['pred'][:, i] - A['y10'][:, i]) / (A['y10'][:, i] + 0.05)
            res[nm] = dict(bias_vs_10um=float(ratio), pointwise_rel_rms_diff=float(math.sqrt(np.average(d ** 2, weights=w))),
                           net_rel_rmse_vs_this_size=float(math.sqrt(np.average(e_r ** 2, weights=w))),
                           net_rel_rmse_vs_10um=float(math.sqrt(np.average(e_10 ** 2, weights=w))))
        # the quantity the renderer uses: total sun source J = J_ss + J_fp + J_ms (each size with its own phase function
        # and truncation) and the combined source S; MC noise of both references removed from the differences
        L = T.LIGHT
        tot = lambda y, jss, jfp: L['E'] * (jss + jfp + y[:, 0]) + L['sky'] * y[:, 1] + L['gnd'] * y[:, 2]
        var = lambda v: v[:, 0] + L['sky'] ** 2 * v[:, 1] + L['gnd'] ** 2 * v[:, 2]
        S10, Sr = tot(A['y10'], A['jss10'], A['jfp10']), tot(A['yr'], A['jss'], A['jfpr'])
        Sn10, Snr = tot(A['pred'], A['jss10'], A['jfp10']), tot(A['pred'], A['jss'], A['jfpr'])
        den = lambda x: (x + 0.02) ** 2
        rms = lambda e2: float(math.sqrt(max(np.average(e2, weights=w), 0)))
        res['S_total'] = dict(
            bias_vs_10um=float((w * Sr).sum() / (w * S10).sum()),
            rel_rms_diff_vs_10um_denoised=rms(((Sr - S10) ** 2 - var(A['vr']) - var(A['v10'])) / den(S10)),
            net_rel_rmse_vs_this_size=rms(((Snr - Sr) ** 2 - var(A['vr'])) / den(Sr)),
            net_rel_rmse_at_10um_same_points=rms(((Sn10 - S10) ** 2 - var(A['v10'])) / den(S10)))
        res['J_ms']['rel_rms_diff_denoised'] = rms(((A['yr'][:, 0] - A['y10'][:, 0]) ** 2 - A['vr'][:, 0] - A['v10'][:, 0]) / (A['y10'][:, 0] + 0.02) ** 2)
        res['points'] = int(len(w))
        rows[f'{r}um'] = res
        print(r, json.dumps(res, indent=1))
    json.dump(rows, open(os.path.join(HERE, 'results', 'reff_sensitivity.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
