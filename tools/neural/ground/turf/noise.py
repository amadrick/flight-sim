"""Monte Carlo noise floor of the turf dataset: the same (tile, sun, view) configurations rendered twice with
independent rays, at the dataset's ray count. The RMS difference / sqrt(2) is the noise in one sample; a model cannot
be judged below it.   python3 noise.py [n_configs=120] [rays=1536]"""
import sys, json, numpy as np
from trace import build_tile, grid_segments, render

n = int(sys.argv[1]) if len(sys.argv) > 1 else 120
nray = int(sys.argv[2]) if len(sys.argv) > 2 else 1536
rng = np.random.default_rng(99)
a, b = [], []
for t in range(6):
    segs, floor = build_tile(rng, rng.uniform(0, 1), rng.uniform(0.025, 0.14))
    cells, cs, cc = grid_segments(segs)
    hmax = float((segs[:, 2] + np.maximum(segs[:, 5], 0) + np.abs(segs[:, 8])).max() + 1e-4)
    fa = np.array([0.075, 0.062, 0.042]); fb = np.array([0.20, 0.17, 0.10])
    for k in range(n // 6):
        mus = 0.04 + 0.96 * rng.uniform() ** 1.3; muv = 0.04 + 0.96 * rng.uniform() ** 1.5
        phs = rng.uniform(0, np.pi); phv = rng.uniform(-np.pi, np.pi)
        sun = np.array([np.sqrt(1 - mus ** 2) * np.cos(phs), np.sqrt(1 - mus ** 2) * np.sin(phs), mus])
        view = np.array([np.sqrt(1 - muv ** 2) * np.cos(phv), np.sqrt(1 - muv ** 2) * np.sin(phv), muv])
        a.append(render(segs, cells, cs, cc, floor, hmax, sun, view, nray, 1000 + k, fa, fb)[0] / mus)
        b.append(render(segs, cells, cs, cc, floor, hmax, sun, view, nray, 5000 + k, fa, fb)[0] / mus)
a, b = np.array(a), np.array(b)
lum = np.array([0.2126, 0.7152, 0.0722])
la, lb = a @ lum, b @ lum
res = dict(configs=len(a), rays=nray, ln_rmse_one_sample=float(np.sqrt(np.mean((np.log(np.maximum(a, 1e-5)) - np.log(np.maximum(b, 1e-5))) ** 2) / 2)),
           rel_lum_one_sample=float(np.sqrt(np.mean(((la - lb) / (0.5 * (la + lb))) ** 2) / 2)))
print(json.dumps(res))
json.dump(res, open('results_noise.json', 'w'))
