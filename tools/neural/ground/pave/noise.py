"""Monte Carlo noise of the sky term: the same tiles rendered twice with independent sky samples.

    python3 noise.py [n_tiles]
"""
import sys
import numpy as np
import trace as T

n = int(sys.argv[1]) if len(sys.argv) > 1 else 4
views = [(m, p) for m in [0.05, 0.1, 0.17, 0.27, 0.4, 0.58, 0.8, 0.98] for p in np.radians(np.arange(0, 360, 30))]
err = []
for t in range(n):
    rng = np.random.default_rng(7000 + t)
    surf = T.make_surface(rng, t % 2, rng.uniform(0.15, 1), 0.0 if t < 2 else 0.6, 0.0 if t % 3 else 0.2)
    _, K1, A = T.render_tile(*surf, [(0.5, 0.0)], views, np.random.default_rng(1))
    _, K2, _ = T.render_tile(*surf, [(0.5, 0.0)], views, np.random.default_rng(2))
    R1 = A * K1[:, 2] + K1[:, 3]; R2 = A * K2[:, 2] + K2[:, 3]
    err.append(np.log(R1) - np.log(R2))
e = np.concatenate(err)
print(f'sky term, one render vs another: ln RMSE {np.sqrt(np.mean(e ** 2)):.4f}  (per render: /sqrt2 = {np.sqrt(np.mean(e ** 2) / 2):.4f})')
