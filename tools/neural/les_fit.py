"""Fit the cumulus width profile of the real-time density model (clShape in src/clouds/shaders.js) to the LES.

  g(h) = [gb + (1 - gb) (1 - (1 - min(h / hp, 1))^k)] * [1 - (max(h - hp, 0) / (1 - hp))^2]^p      h = height fraction

Each LES cloud's equivalent radius profile is normalised by its largest radius and averaged in 10 height bins
(volume weighted, les_stats.width_profile); the model profile is averaged over the same bins and scaled by a free
factor A (the bulges of individual clouds make each cloud's own maximum exceed the mean profile).
    python3 les_fit.py bomex_hr congestus
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


def g_model(h, gb, hp, k, p):
    rise = gb + (1 - gb) * (1 - (1 - np.minimum(h / hp, 1.0)) ** k)
    dome = np.clip(1 - (np.maximum(h - hp, 0) / (1 - hp)) ** 2, 0, 1) ** p
    return rise * dome


def binned(params, nb=10, n=400):
    h = (np.arange(n) + 0.5) / n
    g = g_model(h, *params)
    return g.reshape(nb, -1).mean(axis=1)


def fit(target):
    best = (1e9, None)
    for gb in np.linspace(0.3, 1.0, 15):
        for hp in np.linspace(0.15, 0.85, 15):
            for k in (1.0, 1.5, 2.0, 3.0, 4.0):
                for p in (0.3, 0.4, 0.5, 0.6, 0.8, 1.0):
                    m = binned((gb, hp, k, p))
                    A = float(np.dot(m, target) / np.dot(m, m))
                    e = float(np.sqrt(np.mean((A * m - target) ** 2)))
                    if e < best[0]:
                        best = (e, (gb, hp, k, p, A))
    return best


def main():
    stats = json.load(open(os.path.join(HERE, 'results', 'shape_stats.json')))
    out = {}
    for name in sys.argv[1:]:
        t = np.array(stats['les:' + name]['width_profile'])
        e, (gb, hp, k, p, A) = fit(t)
        out[name] = dict(gb=gb, hp=hp, k=k, p=p, A=A, rms=e, target=t.round(3).tolist(),
                         model=(A * binned((gb, hp, k, p))).round(3).tolist())
        print(name, json.dumps(out[name]))
    allt = np.mean([np.array(stats['les:' + n]['width_profile']) for n in sys.argv[1:]], axis=0)
    e, (gb, hp, k, p, A) = fit(allt)
    out['joint'] = dict(gb=gb, hp=hp, k=k, p=p, A=A, rms=e, target=allt.round(3).tolist(),
                        model=(A * binned((gb, hp, k, p))).round(3).tolist())
    print('joint', json.dumps(out['joint']))
    json.dump(out, open(os.path.join(HERE, 'results', 'profile_fit.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
