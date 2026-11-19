"""Tap descriptors for the data points (what the shader can afford): optical depth segments from single density taps.

    NUMBA_NUM_THREADS=2 $VENV tools/neural/clouds/gen_tap.py          -> data/tap/<config>.npz

For each direction in DIRS and each segment [e_{k-1}, e_k] of TAP_ENDS[K], ONE extinction tap at the segment
midpoint times the segment length: tap_k = sigma(p + dir * (e_{k-1} + e_k) / 2) * (e_k - e_{k-1}).
Stored: tap[n, ndir, K] for every variant below, plus the exact light-march-free quantities already in data/pts.
"""
import glob
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pt  # noqa: E402
import gen  # noqa: E402
import features as F  # noqa: E402

ENDS = {'e3': np.array([100.0, 350.0, 1000.0]), 'e2': np.array([150.0, 600.0]), 'e4': np.array([50.0, 170.0, 450.0, 1100.0])}


def main():
    os.makedirs(os.path.join(pt.DATA, 'tap'), exist_ok=True)
    fs = sorted(glob.glob(os.path.join(pt.DATA, 'pts', '*.npz')))
    by_scene = {}
    for f in fs:
        if not os.path.exists(f.replace('/pts/', '/tap/')):
            by_scene.setdefault(str(np.load(f)['scene']), []).append(f)
    for kind, kw, split in gen.SCENES:
        sc = gen.build(kind, kw)
        for f in by_scene.get(sc.name, []):
            z = np.load(f)
            Dirs = F.directions(z['L'], z['rd'])          # sun, up, down, cam, fwd, anti, sideA, sideB
            rec = {'tap_' + k: F.tap_segments(sc, z['P'], Dirs, e).astype(np.float32) for k, e in ENDS.items()}
            np.savez_compressed(f.replace('/pts/', '/tap/'), **rec)
            print('tap', os.path.basename(f), flush=True)


if __name__ == '__main__':
    main()
