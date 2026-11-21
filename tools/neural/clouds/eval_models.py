"""Round seven: evaluate exported MS models (data/model_final*.json) on the same held-out points.

    $VENV eval_models.py data/model_final.json data/model_final-r7.json
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import train as T, model as MD
d = T.load()
va = d['val']; r7 = np.char.startswith(d['cfg'].astype(str), 'r7')
masks = {'val/r7 game fields': va & r7, 'val all': va, 'VAL1': d['val_r1'], 'VALM': d['val_multi'],
         'val non-r7': va & ~r7, 'val r7 elev<10': va & r7 & (d['elev'] < 10), 'val r7 backlit': va & r7 & (d['cos_t'] > 0.7)}
print({k: int(v.sum()) for k, v in masks.items()})
print('r7 val scenes', sorted(set(d['scene'][va & r7].tolist())), 'r7 train', sorted(set(d['scene'][~va & r7].tolist())))
for p in sys.argv[1:]:
    m = MD.load_final(p); desc = m['desc']
    tkey = 'tapb_e3'
    t = d[tkey][:, [T.DIR[k] for k in desc['dirs']], :]
    X = MD.encode(d['mt'][:, 0, -1], d['tau_cam'], d['mu_s'], d['cos_t'], t, desc)
    Y = MD.forward(m['layers'] if isinstance(m['layers'][0], tuple) else m['layers'], X)
    for k, mk in masks.items():
        o = T.report('', d, mk, d['jss'] + d['jfp'] + Y[:, 0], Y[:, 1], Y[:, 2])
        print(f'{os.path.basename(p):24s} {k:20s} {T.fmt(o)}')
