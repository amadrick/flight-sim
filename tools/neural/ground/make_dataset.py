"""Run the ecosystem simulation on every dumped patch and pair its outcome with the GPU-equivalent features.

    python3 make_dataset.py [first] [last]        -> data/ds_<p>.npz  (resumable; one patch takes ~15-25 s)

Targets for a sample at LOD level j are the simulated cover averaged over two texels of that level (the clipmap
level is band-limited to about that), so the network learns the *mean* cover a coarse texel stands for and distant
ground converges to the right average.
"""
import json, os, sys, time
import numpy as np
import ecosim

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
NAMES = ecosim.OUT_NAMES


def box(a, r):
    def one(x, axis):
        n = x.shape[axis]
        pad = [(0, 0), (0, 0)]; pad[axis] = (r + 1, r)
        c = np.cumsum(np.pad(x, pad, mode='edge'), axis=axis, dtype=np.float64)
        return (np.take(c, np.arange(n) + 2 * r + 1, axis=axis) - np.take(c, np.arange(n), axis=axis)) / (2 * r + 1)
    return one(one(a, 0), 1)


def main():
    meta = json.load(open(os.path.join(DATA, 'patches.json')))
    n, row, rawn, levels = meta['N'], meta['ROW'], meta['RAW'], meta['LEVELS']
    first = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    last = int(sys.argv[2]) if len(sys.argv) > 2 else len(meta['patches']) - 1
    for p in range(first, last + 1):
        dst = os.path.join(DATA, f'ds_{p}.npz')
        if os.path.exists(dst) and '--force' not in sys.argv:
            continue
        P = meta['patches'][p]
        t0 = time.time()
        g = np.fromfile(os.path.join(DATA, f'patch_{p}.f32'), np.float32).reshape(3, n, n)
        out = ecosim.simulate(g[0], g[1], g[2], P['x0'], P['z0'], meta['CELL'], seed=p)
        fields = {k: out[k].astype(np.float64) for k in NAMES}
        fields['conifer'] = fields['conifer'] * fields['forest']          # pooled as conifer canopy, share = / forest
        pooled = []                                                          # pooled[j][k] = field k at level j
        for j in range(levels + 1):
            r = max(1, 2 ** j)
            pooled.append(np.stack([box(fields[k], r) for k in NAMES]))
        s = np.fromfile(os.path.join(DATA, f'samp_{p}.f32'), np.float32).reshape(-1, row)
        i, jj, lv = s[:, 0].astype(int), s[:, 1].astype(int), s[:, 2].astype(int)
        ya = np.stack([pooled[l][:, b, a] for a, b, l in zip(i, jj, lv)])
        yb = np.stack([pooled[l + 1][:, b, a] for a, b, l in zip(i, jj, lv)])
        latk = (P['z0'] + jj * meta['CELL']) * 0.001
        np.savez_compressed(dst, rawA=s[:, 3:3 + rawn], rawB=s[:, 3 + rawn:3 + 2 * rawn], lv=lv.astype(np.int8), latk=latk.astype(np.float32),
                            ya=ya.astype(np.float32), yb=yb.astype(np.float32), patch=np.full(len(s), p, np.int16))
        print(f'{p:2d} {P["name"]:14s} {time.time() - t0:5.1f} s  ' + ' '.join(f'{k[:4]} {out[k].mean():.2f}' for k in NAMES), flush=True)


if __name__ == '__main__':
    main()
