"""Round three: point-wise accuracy of the lighting networks on the NEW density fields (cell-based cumulus).

    python3 gt_eval_r3.py
For each new field (scattered3, broken3): the round-two networks as shipped (gt_data/light_nets_r2.npz), the
round-three networks trained on everything (light_nets.npz, in-sample) and networks trained with that field held out
(the honest number), plus the classic analytic model. ln RMSE of J and of the two ambient visibilities, importance
weighted per case (gt_analyze.jerr), and the mean ratio (bias). Writes results/eval_r3.json.
"""
import json
import os

import numpy as np

import gt_train_light as tl
import gt_march as gm
from gt_analyze import load_all, jerr

HERE = os.path.dirname(os.path.abspath(__file__))


def stats(res):
    return dict(lnRMSE=float(np.mean([x[2] for x in res])), bias=float(np.mean([x[1] for x in res])))


def main():
    D = load_all()
    field = np.array([c.split('_')[0].split('@')[0].rstrip('B') for c in D['case']])
    r2j, r2v = tl.load_nets(os.path.join(HERE, 'gt_data', 'light_nets_r2.npz'))
    r3j, r3v = tl.load_nets()
    out = {}
    for f in ('scattered3', 'broken3'):
        te = field == f
        Dt = {k: v[te] for k, v in D.items()}
        Jt = Dt['Jss'] + Dt['Jms']
        hj = tl.train_j(D, ~te, 50)
        hv = tl.train_v(D, ~te, 50)
        row = {}
        row['classic'] = stats(jerr(gm.classic_J(Dt['tauSun'], Dt['tauUp'], Dt['cosT']), Jt, Dt['wn'], Dt['case']))
        for name, nj, nv in (('r2', r2j, r2v), ('r3_heldout', hj, hv), ('r3', r3j, r3v)):
            pv = tl.v_pred(nv, Dt)
            row[name] = dict(J=stats(jerr(tl.j_pred(nj, Dt), Jt, Dt['wn'], Dt['case'])),
                             Vup=stats(jerr(pv[:, 0], Dt['Vup'], Dt['wn'], Dt['case'])),
                             Vdn=stats(jerr(pv[:, 1], Dt['Vdn'], Dt['wn'], Dt['case'])))
        out[f] = row
        print(f, json.dumps(row))
    json.dump(out, open(os.path.join(HERE, 'results', 'eval_r3.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
