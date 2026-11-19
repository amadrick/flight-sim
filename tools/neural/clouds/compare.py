"""Round-two before/after on identical held-out points, per regime.

    OMP_NUM_THREADS=1 $VENV tools/neural/clouds/compare.py <set>[@width] ... [--steps N] [--seeds K] [--out name]
Rows: the deployed v1 net (results/model_v1.json) fed the TRUE-field taps it was trained on and fed the shader's
BASE-density taps (what it sees in the game), the round-3 shipped nets and the analytic baselines, and each candidate
(trained here on the round-one + round-two training scenes, mean and spread over seeds).
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import train as T  # noqa: E402
import model as MD  # noqa: E402


def masks(d):
    va, v1, vm = d['val'], d['val_r1'], d['val_multi']
    m = {'VAL1 (round-one held-out)': v1, 'VALM (new multi-cloud held-out)': vm,
         'VAL1 game fields': v1 & (d['kind'] == 'game'), 'VALM game field r5scattered2': vm & (d['kind'] == 'game'),
         'VALM cumulus field cufield2': vm & (d['kind'] == 'cufield'), 'VAL1 LES congestus': v1 & (d['kind'] == 'les'),
         'all held-out sun < 10 deg': va & (d['elev'] < 10), 'all held-out sun 10-30': va & (d['elev'] >= 10) & (d['elev'] < 30),
         'all held-out sun >= 30': va & (d['elev'] >= 30)}
    return {k: v for k, v in m.items() if v.sum() > 50}


def rows_for(d, M, pr):
    jt = d['jss'] + d['jfp'] + pr[:, 0]
    return {k: T.report('', d, m, jt, pr[:, 1], pr[:, 2]) for k, m in M.items()}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opt = dict(a[2:].split('=') for a in sys.argv[1:] if a.startswith('--'))
    steps, seeds = int(opt.get('steps', 8000)), int(opt.get('seeds', 2))
    d = T.load()
    M = masks(d)
    Y, _ = T.targets(d)
    tr = ~d['val']
    out = {}
    if opt.get('baselines', '1') == '1':
        v1 = MD.load_final(os.path.join(T.HERE, 'results', 'model_v1.json'))
        idx = [T.DIR[k] for k in v1['desc']['dirs']]
        for tag, key in (('v1 deployed, true-field taps (round-one eval)', 'tap_e3'), ('v1 deployed, base taps (in game)', 'tapb_e3')):
            X = MD.encode(d['mt'][:, 0, -1], d['tau_cam'], d['mu_s'], d['cos_t'], d[key][:, idx, :], v1['desc'])
            out[tag] = rows_for(d, M, MD.predict(v1, X))
        v2 = MD.load_final()
        if v2['desc'].get('version') == 2:
            for tag, key in (('v2 exported (model_final.json), base taps', 'tapb_e3'), ('v2 exported, fed true-field taps (misuse)', 'tap_e3')):
                X = MD.encode(d['mt'][:, 0, -1], d['tau_cam'], d['mu_s'], d['cos_t'], d[key][:, [T.DIR[k] for k in v2['desc']['dirs']], :], v2['desc'])
                out[tag] = rows_for(d, M, MD.predict(v2, X))
        rows, _ = T.baselines_table(d, M)
        for k in M:
            for n, o in rows[k].items():
                out.setdefault(n, {})[k] = o
    for a in args:
        s, w = (a.split('@') + ['16'])[:2]
        X = T.feature_set(d, s)
        per = []
        for seed in range(seeds):
            net = T.fit(X[tr], Y[tr], d['opacity'][tr], width=int(w), steps=steps, seed=seed)
            per.append(rows_for(d, M, T.predict(net, X)))
        name = f'{s} w{w} ({sum(p.numel() for p in net.parameters())} params)'
        out[name] = {k: {**per[0][k], 'S_seeds': [p[k]['S'][0] for p in per]} for k in M}
    for k in M:
        print(f'--- {k} ({M[k].sum()} points)')
        for n, r in out.items():
            sd = r[k].get('S_seeds')
            print(f'  {n:52s} {T.fmt(r[k])}' + (f'  S seeds {np.round(sd, 3).tolist()}' if sd else ''))
    json.dump(out, open(os.path.join(T.DATA, opt.get('out', 'compare') + '.json'), 'w'), indent=1,
              default=lambda o: list(o) if isinstance(o, tuple) else float(o))


if __name__ == '__main__':
    main()
