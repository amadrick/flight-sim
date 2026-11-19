"""Ground-truth comparison: path-traced reference vs the numpy port of the real-time march, per case and model.

    python3 gt_compare.py scattered [--cases noon_above,low_toward] [--models classic,neural3,neural4] [--res 160x90]

Needs gt_data/ref_<field>_<case>_<res>.npz from gt_trace.py.  Writes gt_data/cmp_<field>_<case>.png
(reference | models ..., same exposure) and prints / appends the error table to gt_data/compare.json.

Metrics on cloud pixels (reference or model view transmittance < 0.9), both images 2x2 box-filtered first (MC noise):
  bias      mean luminance model / reference
  relMAE    mean |model - ref| / mean ref                       (luminance)
  lnRMSE    RMS of ln((model + e) / (ref + e)),  e = 2 % of the mean reference luminance
  contrast  std(ln model) / std(ln ref): < 1 = flatter, greyer than the truth
  chroma    mean |(rgb / lum)_model - (rgb / lum)_ref|            (colour error, e.g. warm bases at sunset)
"""
import argparse
import json
import os
import time

import numpy as np

from gt_common import DATA, Field, make_case, tonemap, save_png, luminance, SunDepth
import gt_march as gm

CASES = ['noon_above', 'noon_below', 'low_toward', 'low_away', 'sunset_base']


def box2(img, W, H):
    a = img.reshape(H, W, -1)
    # plain 2x2 mean (edge rows / columns keep fewer terms)
    out = a.copy()
    cnt = np.ones((H, W, 1))
    out[:-1] += a[1:]; cnt[:-1] += 1
    out[:, :-1] += a[:, 1:]; cnt[:, :-1] += 1
    out[:-1, :-1] += a[1:, 1:]; cnt[:-1, :-1] += 1
    return (out / cnt).reshape(H * W, -1)


def metrics(img, ref, mask, W, H):
    a, r = box2(img, W, H), box2(ref, W, H)
    la, lr = luminance(a)[mask], luminance(r)[mask]
    e = 0.02 * lr.mean()
    ca = a[mask] / np.maximum(luminance(a[mask]), 1e-9)[:, None]
    cr = r[mask] / np.maximum(luminance(r[mask]), 1e-9)[:, None]
    return dict(bias=float(la.mean() / lr.mean()), relMAE=float(np.abs(la - lr).mean() / lr.mean()),
                lnRMSE=float(np.sqrt(np.mean(np.log((la + e) / (lr + e)) ** 2))),
                contrast=float(np.std(np.log(la + e)) / np.std(np.log(lr + e))),
                chroma=float(np.abs(ca - cr).mean()))


def load_ref(field, case, W, H):
    z = np.load(os.path.join(DATA, 'ref_%s_%s_%dx%d.npz' % (field.name, case['name'], W, H)))
    img = z['acc'] / max(int(z['nspp']), 1) + z['lss'][:, None] * case['E'][None]
    return img, z['T'], int(z['nspp'])


def get_march(field, case, W, H, njit=8, cache=True):
    p = os.path.join(DATA, 'march_%s_%s_%dx%d.npz' % (field.name, case['name'], W, H))
    if cache and os.path.exists(p):
        z = np.load(p)
        return {k: z[k] for k in z.files}
    m = gm.March(field, case)
    R = m.run(W, H, njit=njit)
    np.savez(p, **{k: np.asarray(v) for k, v in R.items()})
    return R


def compare(field, case, models, W, H, ambients=None, label=''):
    ref, Tref, nspp = load_ref(field, case, W, H)
    R = get_march(field, case, W, H)
    tsf = SunDepth(field, field.full, field.sigma, case['L'])
    bg = gm.background(R, case, field, tsf)
    cov = field.meta['params']['coverage']
    mask = (Tref < 0.9) | (R['T'] < 0.9)
    rows, imgs = {}, [ref]
    for name in models:
        mod, amb = (name, None) if not isinstance(name, tuple) else name[1:]
        key = name if isinstance(name, str) else name[0]
        img = gm.shade(R, case, field, mod, ambient=amb, cov=cov, bg=bg)
        rows[key] = metrics(img, ref, mask, W, H)
        imgs.append(img)
    expo = 1.6 / max(case['E'].max(), 1e-3) * (1 if case['elev'] > 20 else 1.6)
    tiles = [tonemap(i.reshape(H, W, 3), expo) for i in imgs]
    grid = np.concatenate(tiles, 1)
    save_png(os.path.join(DATA, 'cmp_%s_%s%s.png' % (field.name, case['name'], label)), grid)
    stats = dict(nspp=nspp, cloud_px=int(mask.sum()), iters=float(R['iters'][mask].mean()),
                 lit=float(R['lit'][mask].mean()))
    return rows, stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('field')
    ap.add_argument('--cases', default=','.join(CASES))
    ap.add_argument('--models', default='classic,neural3,neural4')
    ap.add_argument('--res', default='160x90')
    ap.add_argument('--label', default='')
    a = ap.parse_args()
    W, H = map(int, a.res.split('x'))
    field = Field(a.field)
    out = {}
    for cn in a.cases.split(','):
        case = make_case(cn, field)
        rows, st = compare(field, case, a.models.split(','), W, H, label=a.label)
        out[cn] = dict(rows=rows, stats=st)
        print('%-12s spp %d  cloud px %d  iters %.1f  lit %.1f' % (cn, st['nspp'], st['cloud_px'], st['iters'], st['lit']))
        for k, r in rows.items():
            print('   %-12s bias %.3f  relMAE %.3f  lnRMSE %.3f  contrast %.3f  chroma %.3f' % (
                k, r['bias'], r['relMAE'], r['lnRMSE'], r['contrast'], r['chroma']))
    p = os.path.join(DATA, 'compare.json')
    allr = json.load(open(p)) if os.path.exists(p) else {}
    allr['%s%s@%s' % (a.field, a.label, time.strftime('%H%M%S'))] = out
    json.dump(allr, open(p, 'w'), indent=1)


if __name__ == '__main__':
    main()
