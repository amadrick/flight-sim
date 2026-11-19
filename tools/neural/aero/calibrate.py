"""Calibrate the section model of every aircraft against its tuned analytic model (see aircraft.py) and store the
result in results/calibration.json.

    python3 tools/neural/aero/calibrate.py [id ...]
"""
import json
import os
import sys
import time

import aircraft as AC
import planforms

if __name__ == '__main__':
    ids = sys.argv[1:] or planforms.IDS
    out = {}
    if os.path.exists(AC.CALFILE):
        with open(AC.CALFILE) as f:
            out = json.load(f)
    for aid in ids:
        t = time.time()
        ac = AC.Aircraft(aid)
        out[aid] = ac.cal
        c = ac.cal
        print(f"{aid:5} strips {c['n_strips']:2d}  wing {c['wing']['area']:.1f} m2 (ref {ac.model['S']:.1f})  CLa {c['cla']:.2f} (tuned {c['cla_tuned']})  "
              f"stall section {c['a_stall_deg']:.1f} deg, width {c['width_deg']:.1f}  peak {c['peak_deg']:.1f} (tuned {c['peak_tuned_deg']:.1f})  "
              f"CLmax {c['clmax']:.2f} (tuned {c['clmax_tuned']:.2f})  [{time.time() - t:.0f} s]", flush=True)
        with open(AC.CALFILE, 'w') as f:
            json.dump(out, f, indent=1)
