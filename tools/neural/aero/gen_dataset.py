"""Generate the training data of one aircraft from the reference solver.

    python3 tools/neural/aero/gen_dataset.py <id> [--cfg 2000] [--ground 1500] [--seed 1]

Output: data/<id>.npz (not committed; regenerate with this script). Contents, see `targets()` in dataset.py:
  cfg      (n, 3)   alpha_n, flap, mach of every configuration point
  base     dict of the six coefficients + CL, CD at the configuration points (symmetric, steady, free air)
  chan_*   amplitude and coefficient changes of one perturbed solve per channel and configuration point
  ref_*    attached-flow reference derivatives on the (flap, Mach) grid
  ground   height / bank samples with the in-ground-effect and free-air coefficients
"""
import argparse
import os
import time
import numpy as np

import aircraft as AC
import solver as S

DEG = S.DEG
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')

# perturbation channels: name, solver keyword, maximum amplitude (None = from the tuned control travel), signed?
BETA_MAX, P_MAX, R_MAX, Q_MAX = 25 * DEG, 0.25, 0.15, 0.03
AN_MIN, AN_MAX, ALPHA_CAP = -1.6, 3.0, 70 * DEG
COEFS = ['CX', 'CY', 'CZ', 'Cl', 'Cm', 'Cn', 'CL', 'CD']
REF_AN = (0.2, 0.5)                       # attached-flow reference angles (fractions of the angle of maximum lift)
REF_AMP = dict(beta=3 * DEG, p=0.02, r=0.02, da=0.15, dr=0.15, de=0.15, q=0.005)


def channels(ac):
    m = ac.model
    da_max = m['dtMax'] if ac.spec.get('roll') == 'tail' else m['daMax']
    return [('beta', 'beta', BETA_MAX, False, 1.0), ('p', 'p', P_MAX, False, 1.0), ('r', 'r', R_MAX, False, 1.0),
            ('da', 'da', 1.0, False, da_max), ('dr', 'dr', 1.0, False, m['drMax']),
            ('de', 'de', 1.0, True, m['deMax']), ('q', 'q', Q_MAX, True, 1.0)]


def alpha_of(ac, an, flap, mach):
    pp, pn = ac.peaks(flap, mach)
    return np.clip(np.where(an >= 0, an * pp, an * pn), -ALPHA_CAP, ALPHA_CAP), pp, pn


def generate(aid, n_cfg=3000, n_ground=3000, seed=1, verbose=True):
    t0 = time.time()
    ac = AC.load_aircraft(aid)
    ac.peak_table()
    rng = np.random.default_rng(seed)
    out = dict(peak_pos=ac.peak_pos, peak_neg=ac.peak_neg, flap_grid=AC.FLAP_GRID, mach_grid=AC.MACH_GRID)
    chans = channels(ac)

    # ---- attached-flow reference derivatives on the (flap, Mach) grid -------------------------------------------------
    F, M = np.meshgrid(AC.FLAP_GRID, AC.MACH_GRID, indexing='ij')
    Ff = np.repeat(F.ravel(), len(REF_AN)); Mf = np.repeat(M.ravel(), len(REF_AN))
    an = np.tile(np.array(REF_AN), F.size)
    if not ac.has_flap:
        Ff = Ff * 0.0
    al, _, _ = alpha_of(ac, an, Ff, Mf)
    base = ac.run(al, flap=Ff, mach=Mf)
    shape = F.shape + (len(REF_AN),)
    out['ref_CL'] = base['CL'].reshape(shape); out['ref_Cm'] = base['Cm'].reshape(shape)
    for name, kw, amax, signed, scale in chans:
        u = REF_AMP[name]
        o = ac.run(al, flap=Ff, mach=Mf, **{kw: u * scale})
        if signed:                                         # central difference for the longitudinal channels
            o2 = ac.run(al, flap=Ff, mach=Mf, **{kw: -u * scale})
            d = {c: (o[c] - o2[c]) / (2 * u) for c in COEFS}
        else:
            d = {c: (o[c] - base[c]) / (np.sin(u) if name == 'beta' else u) for c in COEFS}
        for c in COEFS:
            out[f'ref_{name}_{c}'] = d[c].reshape(shape)

    # ---- configuration points -----------------------------------------------------------------------------------------
    n = n_cfg
    flap = np.where(rng.random(n) < 0.5, 0.0, rng.random(n)) if ac.has_flap else np.zeros(n)
    mach = np.where(rng.random(n) < 0.35, 0.2, 0.1 + 0.75 * rng.random(n))
    mach = np.where(flap > 0.3, np.minimum(mach, 0.2 + 0.25 * rng.random(n)), mach)
    an = np.where(rng.random(n) < 0.6, 0.5 + 1.3 * rng.random(n), AN_MIN + (AN_MAX - AN_MIN) * rng.random(n))
    al, pp, pn = alpha_of(ac, an, flap, mach)
    an = np.where(al >= 0, al / pp, al / pn)               # after the cap
    out['cfg'] = np.stack([an, flap, mach], 1); out['alpha'] = al
    base = ac.run(al, flap=flap, mach=mach)
    for c in COEFS:
        out[f'base_{c}'] = base[c]
    out['base_asym'] = np.max(np.abs(np.stack([base['CY'], base['Cl'], base['Cn']])), axis=0)
    for name, kw, amax, signed, scale in chans:
        u = amax * (0.08 + 0.92 * rng.random(n))
        if signed:
            u = u * np.where(rng.random(n) < 0.5, -1.0, 1.0)
        o = ac.run(al, flap=flap, mach=mach, **{kw: u * scale})
        out[f'chan_{name}_u'] = u
        for c in COEFS:
            out[f'chan_{name}_{c}'] = o[c] - base[c]

    # ---- ground effect ------------------------------------------------------------------------------------------------
    n = n_ground
    b = ac.g.bref
    hmin = 0.85 * ac.model['cgHeight']
    hb = (hmin / b) * (1.5 * b / hmin) ** rng.random(n)
    flap = np.where(rng.random(n) < 0.4, 0.0, rng.random(n)) if ac.has_flap else np.zeros(n)
    mach = np.full(n, 0.2)
    an = 0.05 + 1.2 * rng.random(n)
    al, pp, pn = alpha_of(ac, an, flap, mach)
    bank = (0.5 + 11.5 * rng.random(n) ** 2) * DEG
    # keep every vortex point at least 2 % of the span above the ground: reduce the bank, then raise the aircraft
    pts = np.concatenate([ac.g.A, ac.g.B, ac.g.TA, ac.g.TB])

    def clearance(h, bk):
        th = np.arctan(np.cos(bk) * np.tan(al))
        up = np.stack([-np.sin(th), -np.sin(bk) * np.cos(th), np.cos(bk) * np.cos(th)], 1)
        return h + np.min(pts @ up.T, axis=0)
    h = hb * b
    for _ in range(6):
        bad = clearance(h, bank) < 0.02 * b
        bank = np.where(bad, bank * 0.6, bank)
    h = h + np.maximum(0.0, 0.02 * b - clearance(h, bank))
    hb = h / b
    free = ac.run(al, flap=flap, mach=mach)
    gnd = ac.run(al, flap=flap, mach=mach, h=h, bank=bank)
    lvl = ac.run(al, flap=flap, mach=mach, h=h, bank=0.0)                   # wings level at the same height
    out['g_in'] = np.stack([hb, an, flap, bank], 1)
    for c in COEFS + ['CDv']:
        out[f'g_free_{c}'] = free[c]; out[f'g_gnd_{c}'] = gnd[c]; out[f'g_lvl_{c}'] = lvl[c]

    os.makedirs(DATA, exist_ok=True)
    np.savez_compressed(os.path.join(DATA, f'{aid}.npz'), **out)
    if verbose:
        print(f'{aid}: {n_cfg} configuration points x {len(chans) + 1} solves + {3 * n_ground} ground solves in {time.time() - t0:.0f} s', flush=True)
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('ids', nargs='+')
    ap.add_argument('--cfg', type=int, default=2000)
    ap.add_argument('--ground', type=int, default=1500)
    ap.add_argument('--seed', type=int, default=1)
    a = ap.parse_args()
    for k, aid in enumerate(a.ids):
        generate(aid, a.cfg, a.ground, a.seed + 1000 * k)
