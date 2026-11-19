"""Tap descriptors for the data points (what the shader can afford): optical depth segments from single density taps.

    NUMBA_NUM_THREADS=2 $VENV tools/neural/clouds/gen_tap.py [--gain 0.8] [--blur 40]    -> data/tap2/<config>.npz

For each of the 8 directions of features.directions (sun, up, down, cam, fwd, anti, sideA, sideB) and each segment
[e_{k-1}, e_k] of ENDS: ONE extinction tap at the segment midpoint times the segment length.
  tap_<ends>   taps of the TRUE field (round one)
  tapb_<ends>  taps of the CHEAP BASE DENSITY the shader samples (round two, descriptor v2):
               gain * base, base = the field's exported base density (game fields: clDensityBase * info.w * sigma1, as
               the light march sees it) or, for fields without one, the true field box-blurred over `blur` metres.
               gain = 0.8 is the light march's factor for the un-eroded base density (shaders.js clTauLight).
Parameterised so it can follow src/clouds/shaders.js: re-export the game fields, pass the shader's gain.
"""
import argparse
import glob
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pt  # noqa: E402
import gen  # noqa: E402
import scenes as S  # noqa: E402
import features as F  # noqa: E402

ENDS = {'e3': np.array([100.0, 350.0, 1000.0]), 'e2': np.array([150.0, 600.0]), 'e4': np.array([50.0, 170.0, 450.0, 1100.0])}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--gain', type=float, default=0.8)
    ap.add_argument('--blur', type=float, default=40.0)
    args = ap.parse_args()
    out_dir = os.path.join(pt.DATA, 'tap2')
    os.makedirs(out_dir, exist_ok=True)
    fs = sorted(glob.glob(os.path.join(pt.DATA, 'pts', '*.npz')))
    by_scene = {}
    for f in fs:
        if not os.path.exists(os.path.join(out_dir, os.path.basename(f))):
            by_scene.setdefault(str(np.load(f)['scene']), []).append(f)
    seen = set()
    for kind, kw, split in gen.SCENES + gen.SCENES2:
        if (kind, str(kw)) in seen:
            continue
        seen.add((kind, str(kw)))
        try:
            sc = gen.build(kind, kw)
        except FileNotFoundError as e:
            print('skip', kind, kw, e, flush=True)
            continue
        files = by_scene.get(sc.name, [])
        if not files:
            continue
        base = sc.base if sc.base is not None else S.base_emulation(sc.sig, sc.h, args.blur)
        scb = pt.Scene(base * args.gain, sc.h, sc.o, periodic=sc.per, name=sc.name + ':base')
        for f in files:
            z = np.load(f)
            Dirs = F.directions(z['L'], z['rd'])
            rec = {}
            for k, e in ENDS.items():
                rec['tap_' + k] = F.tap_segments(sc, z['P'], Dirs, e).astype(np.float32)
                rec['tapb_' + k] = F.tap_segments(scb, z['P'], Dirs, e).astype(np.float32)
            np.savez_compressed(os.path.join(out_dir, os.path.basename(f)), gain=args.gain, blur=args.blur,
                                has_base=sc.base is not None, **rec)
            print('tap', os.path.basename(f), 'base' if sc.base is not None else 'emulated', flush=True)


if __name__ == '__main__':
    main()
