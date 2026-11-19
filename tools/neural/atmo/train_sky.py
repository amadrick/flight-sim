"""Sky network: correction of the classic LUT sky + aerosol column for the aureole.

  inputs (6): sun elevation, view elevation above the (dipped) horizon, cos azimuth from the sun, camera altitude,
              aerosol extinction (weather), cos scattering angle  -- encoded to [-1, 1] by `encode` (JS twin: atmo.js)
  outputs (6): ln R_rgb   R = reference sky without the narrow diffraction lobe / classic LUT sky (sun part)
               ln Cm_rgb  aerosol single-scattering column along the view ray (per unit sun irradiance); the aureole
                          is rendered per pixel as phase_peak(cosTheta) * Cm * sun illuminance
Training data: gen_data.py (reference path tracer vs numpy port of the classic model).

  OMP_NUM_THREADS=1 nice -n 10 python3 train_sky.py [hidden]     -> data/sky_net.npz
"""
import glob
import json
import math
import os
import sys
import time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
import nn

HERE = os.path.dirname(os.path.abspath(__file__))
SUN_LO, SUN_HI = -18.0, 90.0
ALT_MAX = 26.0
MIE_LO, MIE_HI = 0.018, 0.10
R_CLIP = 3.0
C_FLOOR = 1e-7


def encode(sun, ef, az, h, mie, cosg):
    """sun: elevation (rad); ef: fraction of the way from the horizon to the zenith; az: azimuth from the sun (rad);
    h: altitude (km); mie: aerosol extinction at sea level (1/km); cosg: cos of the angle to the sun."""
    return np.stack([
        2 * (np.degrees(sun) - SUN_LO) / (SUN_HI - SUN_LO) - 1,
        2 * np.sqrt(np.clip(ef, 0, 1)) - 1,
        np.cos(az),
        2 * np.sqrt(np.clip(h, 0, ALT_MAX) / ALT_MAX) - 1,
        2 * np.log(np.clip(mie, MIE_LO, MIE_HI) / MIE_LO) / math.log(MIE_HI / MIE_LO) - 1,
        cosg,
    ], axis=1)


def load(split):
    files = sorted(glob.glob(os.path.join(HERE, 'data', '%s_*.npz' % split)))
    files = [f for f in files if not f.endswith('.tmp.npz')]
    keys = ['sun', 'el', 'az', 'h', 'ef', 'mie', 'Lcl', 'Ls', 'Lpk', 'Cm', 'L1', 'Y']
    parts = {k: [] for k in keys}
    for f in files:
        d = np.load(f)
        for k in keys:
            parts[k].append(d[k])
    if not files:
        return None, 0
    out = {k: np.concatenate(v) for k, v in parts.items()}
    return out, len(files)


def cosg_of(d):
    s = np.stack([np.cos(d['sun']), np.sin(d['sun']), np.zeros_like(d['sun'])], 1)
    v = np.stack([np.cos(d['el']) * np.cos(d['az']), np.sin(d['el']), np.cos(d['el']) * np.sin(d['az'])], 1)
    return (s * v).sum(1)


def targets(d):
    Ls = d['Ls']
    Ls = np.maximum(Ls, 0.01 * Ls.max(1, keepdims=True))
    Ls = np.maximum(Ls, 1e-30)
    Lc = np.maximum(d['Lcl'], 1e-30)
    lr = np.clip(np.log(Ls) - np.log(Lc), -R_CLIP, R_CLIP)
    lc = np.log(np.maximum(d['Cm'], C_FLOOR))
    return np.concatenate([lr, lc], 1)


def bands(d):
    sd = np.degrees(d['sun'])
    return {'day (sun > 15 deg)': sd > 15, 'low sun (0..15)': (sd > 0) & (sd <= 15),
            'sunset/civil twilight (-6..0)': (sd > -6) & (sd <= 0), 'nautical twilight (-12..-6)': (sd > -12) & (sd <= -6),
            'all (sun > -12)': sd > -12}


def main():
    hidden = [int(a) for a in sys.argv[1].split(',')] if len(sys.argv) > 1 else [48, 48]
    t0 = time.time()
    tr, ntr = load('train')
    te, nte = load('test')
    if nte == 0:                                     # preliminary runs before the test split exists: hold out 8 batches
        n = len(tr['sun']) - 8 * 512
        te = {k: v[n:] for k, v in tr.items()}
        tr = {k: v[:n] for k, v in tr.items()}
    print('train %d samples (%d batches), test %d samples' % (len(tr['sun']), ntr, len(te['sun'])))
    x = encode(tr['sun'], tr['ef'], tr['az'], tr['h'], tr['mie'], cosg_of(tr))
    y = targets(tr)
    xt = encode(te['sun'], te['ef'], te['az'], te['h'], te['mie'], cosg_of(te))
    yt = targets(te)
    # the column only matters within 20 deg of the sun (where the aureole lobe is non-zero) and while the sun is up
    def weights(d):
        cg = cosg_of(d)
        wc = np.where(cg > math.cos(math.radians(25)), 1.0, 0.15) * np.where(d['sun'] > math.radians(-3), 1.0, 0.1)
        return wc
    wc, wct = weights(tr), weights(te)
    # combined loss: equal weight per R channel, wc per C channel -> implement by scaling targets/outputs columnwise
    # (MSE with per-sample weights for C only): duplicate via a per-element weight matrix
    # R: below -12 deg the reference is Monte Carlo noise and 1e-4 of the sim's airglow; the runtime fades it out there
    wr = lambda d: np.clip((np.degrees(d['sun']) + 13.0) / 1.5, 0, 1)
    W = np.concatenate([np.repeat(wr(tr)[:, None], 3, 1), np.repeat(wc[:, None], 3, 1)], 1)
    Wt = np.concatenate([np.repeat(wr(te)[:, None], 3, 1), np.repeat(wct[:, None], 3, 1)], 1)
    net = nn.MLP([6, *hidden, 6], np.random.default_rng(1), out_bias=y.mean(0))
    hist = train_elementwise(net, x, y, W, xt, yt, Wt, epochs=int(os.environ.get('EPOCHS', 80)))
    net.to_f32()
    p = net.forward(xt)
    res = evaluate(te, p, yt)
    meta = dict(params=net.n_params(), hidden=hidden, train_samples=int(len(y)), test_samples=int(len(yt)),
                secs=round(time.time() - t0), history=hist[-5:], eval=res)
    print(json.dumps(res, indent=1))
    np.savez(os.path.join(HERE, 'data', 'sky_net.npz'), flat=net.to_f32(), sizes=np.array(net.sizes),
             meta=json.dumps(meta))
    print('sky net %s: %d params, %.0fs' % (hidden, net.n_params(), time.time() - t0))


def train_elementwise(net, x, y, W, xt, yt, Wt, epochs=80, batch=2048, lr=3e-3, lr_end=2e-5):
    rng = np.random.default_rng(0)
    n = len(x)
    steps = epochs * (n // batch)
    step = 0
    hist = []
    for ep in range(epochs):
        perm = rng.permutation(n)
        tot = 0.0
        for s in range(n // batch):
            idx = perm[s * batch:(s + 1) * batch]
            out = net.forward(x[idx], keep=True)
            err = out - y[idx]
            ww = W[idx]
            tot += float((ww * err * err).sum())
            g = 2 * ww * err / ww.sum()
            a = lr_end + 0.5 * (lr - lr_end) * (1 + math.cos(math.pi * step / steps))
            net.adam(net.backward(g), a)
            step += 1
        e = net.forward(xt) - yt
        rec = dict(epoch=ep + 1, train=tot / W.sum(), val_R=float(np.sqrt((Wt[:, :3] * e[:, :3] ** 2).sum() / Wt[:, :3].sum())),
                   val_C=float(np.sqrt((Wt[:, 3:] * e[:, 3:] ** 2).sum() / Wt[:, 3:].sum())))
        hist.append(rec)
        if ep % 10 == 9 or ep == 0:
            print(rec, flush=True)
    return hist


def evaluate(te, p, yt):
    """Errors of the final sky radiance (rgb) against the reference, in ln units, per sun-elevation band.
    'classic' = LUT sky alone; 'neural' = LUT sky x network ratio. 'noise' = what is left at the test set's MC noise."""
    Ls = np.maximum(te['Ls'], 0.01 * te['Ls'].max(1, keepdims=True))
    ln_ref = np.log(np.maximum(Ls, 1e-30))
    ln_cl = np.log(np.maximum(te['Lcl'], 1e-30))
    ln_nn = ln_cl + p[:, :3]
    out = {}
    lum = lambda a: 0.2126 * a[:, 0] + 0.7152 * a[:, 1] + 0.0722 * a[:, 2]
    near = (cosg_of(te) > math.cos(math.radians(20))) & (te['sun'] > math.radians(-1))
    for name, m in bands(te).items():
        if not m.any():
            continue
        mn = m & near
        e_cl = (ln_cl - ln_ref)[m]
        e_nn = (ln_nn - ln_ref)[m]
        # luminance and chroma separately (chroma = ln rgb minus mean)
        el_cl = np.log(np.maximum(lum(np.exp(ln_cl[m])), 1e-30)) - np.log(np.maximum(lum(Ls[m]), 1e-30))
        el_nn = np.log(np.maximum(lum(np.exp(ln_nn[m])), 1e-30)) - np.log(np.maximum(lum(Ls[m]), 1e-30))
        ch = lambda e: e - e.mean(1, keepdims=True)
        out[name] = dict(n=int(m.sum()),
                         rms_ln_rgb_classic=float(np.sqrt((np.clip(e_cl, -5, 5) ** 2).mean())),
                         rms_ln_rgb_neural=float(np.sqrt((e_nn ** 2).mean())),
                         rms_ln_lum_classic=float(np.sqrt((np.clip(el_cl, -5, 5) ** 2).mean())),
                         rms_ln_lum_neural=float(np.sqrt((el_nn ** 2).mean())),
                         rms_chroma_classic=float(np.sqrt((ch(np.clip(e_cl, -5, 5)) ** 2).mean())),
                         rms_chroma_neural=float(np.sqrt((ch(e_nn) ** 2).mean())),
                         n_near_sun=int(mn.sum()),
                         rms_ln_Cm_near_sun=float(np.sqrt(((p[:, 3:] - yt[:, 3:])[mn] ** 2).mean())) if mn.any() else None)
    return out


if __name__ == '__main__':
    main()
