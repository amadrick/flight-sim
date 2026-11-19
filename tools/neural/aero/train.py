"""Targets and training of the per-aircraft aerodynamic correction networks (numpy only).

    python3 tools/neural/aero/train.py [id ...]

Reads data/<id>.npz (gen_dataset.py), writes results/nets/<id>.npz (quantised weights, bounds, flags) and
results/fit.json (held-out fit errors). export.py turns the nets into the JS weight module.

Every aircraft gets nine tiny networks ("heads"), each 4 inputs -> H -> H -> n outputs with the ISRU activation
x / sqrt(1 + x^2) and bounded outputs B * isru(z):

  head   inputs                                   outputs
  beta   alpha_n, flap, Mach, |sin beta|/sin 25   rho(CY_beta) - 1, rho(Cn_beta) - 1, rho(Cl_beta) - 1
  p      alpha_n, flap, Mach, |p^|/0.25           rho(Cl_p) - 1,    residual Cn_p
  r      alpha_n, flap, Mach, |r^|/0.15           rho(Cn_r) - 1,    residual Cl_r
  da     alpha_n, flap, Mach, |da|                rho(Cl_da) - 1,   residual Cn_da
  dr     alpha_n, flap, Mach, |dr|                rho(Cn_dr) - 1
  de     alpha_n, flap, Mach, de (signed)         rho(Cm_de) - 1
  q      alpha_n, flap, Mach, q^/0.03 (signed)    rho(Cm_q) - 1
  m      alpha_n, flap, Mach, 0                   residual Cm(alpha) against the analytic functional form
  g      ln(h/b), alpha_n, flap, |bank|/12 deg    dCm in ground effect, Cl per sin(bank) in ground effect

alpha_n is the angle of attack as a fraction of the angle of maximum lift (positive or negative side). rho is the
solver's secant response divided by the solver's own attached-flow derivative at alpha_n = 0.5 (same flap, Mach):
the runtime multiplies the TUNED derivative by it (for Cl_beta the denominator is the solver's attached-flow form
d0 + d1 * CL, like the tuned clb + clbCl * CL). A "residual" is the solver's secant derivative minus the solver's
own attached-flow form d0 + d1 * CL (fitted through alpha_n = 0.2 and 0.5): the runtime adds it to the tuned form.
"""
import json
import os
import sys
import time
import numpy as np

import aircraft as AC
import planforms

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
NETS = os.path.join(HERE, 'results', 'nets')
FITFILE = os.path.join(HERE, 'results', 'fit.json')
DEG = np.pi / 180
H = 10                                         # hidden width
AN_LO, AN_HI, M_LO, M_HI = -1.6, 3.0, 0.1, 0.85
G0, G1 = 1.0, 1.25                             # gate on |alpha_n|: corrections are exactly zero below G0
RHO_B = 2.5                                    # bound of rho - 1
FADE0, FADE1 = 2.0, 2.8                        # all free-air corrections fade out over this range of |alpha_n|
CM_B = 0.6                                     # largest pitch correction, in units of full-travel pitch control power
HEADS = [('beta', 3), ('p', 2), ('r', 2), ('da', 2), ('dr', 1), ('de', 1), ('q', 1), ('m', 1), ('g', 2)]
OUT_NAMES = dict(beta=['cyb', 'cnb', 'clb'], p=['clp', 'cnp'], r=['cnr', 'clr'], da=['clda', 'cnda'], dr=['cndr'],
                 de=['cmde'], q=['cmq'], m=['cm'], g=['gcm', 'gcl'])
# smallest attached-flow solver derivative for which a ratio means anything (else the analytic term is kept)
# Outputs that are trained and reported but NOT used by the runtime (exported with the valid flag off, so the analytic
# term stays). Roll damping: quasi-steady strip theory turns Cl_p to zero or positive right past the stall (autorotation)
# for every straight or moderately swept wing; flown in the sim that rolls docile aircraft (A-10, 737) on their backs
# within seconds, which their real stall behaviour does not support. The tuned post-stall damping is kept instead.
ANALYTIC = {'clp'}
MIN_REF = dict(clb=0.04, cyb=0.08, cnb=0.012, clp=0.08, cnr=0.015, clda=0.012, cndr=0.006, cmde=0.03, cmq=0.8)


def smoothstep(x, a, b):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def separation(alpha, a0p, a0n, m):
    sp = np.exp(np.clip(-m * (alpha - a0p), -40, 40)); sn = np.exp(np.clip(m * (alpha + a0n), -40, 40))
    return (1 + sp + sn) / ((1 + sp) * (1 + sn))


def interp_ref(D, key, flap, mach):
    """Bilinear interpolation of a reference table (nFlap, nMach, 2) at the configuration points."""
    T = D[key]; fg = D['flap_grid']; mg = D['mach_grid']
    fi = np.clip(np.interp(flap, fg, np.arange(len(fg))), 0, len(fg) - 1.001); f0 = fi.astype(int); ft = (fi - f0)[:, None]
    mi = np.clip(np.interp(mach, mg, np.arange(len(mg))), 0, len(mg) - 1.001); m0 = mi.astype(int); mt = (mi - m0)[:, None]
    return ((T[f0, m0] * (1 - mt) + T[f0, m0 + 1] * mt) * (1 - ft) + (T[f0 + 1, m0] * (1 - mt) + T[f0 + 1, m0 + 1] * mt) * ft)


def mach_cap(flap):
    """Highest Mach number the networks see at a flap setting (flaps are a low-speed device): 0.85 clean, 0.45 from
    30 % flap. The runtime clamps its Mach input the same way."""
    return 0.45 + 0.4 * np.clip(1 - flap / 0.3, 0.0, 1.0)


def extend_refs(D):
    """The solver is not trusted with flaps down at high subsonic Mach numbers: there the reference tables take the
    flap effect from Mach 0.5 and the Mach effect from the clean configuration."""
    mg = D['mach_grid']; k5 = int(np.argmin(np.abs(mg - 0.5)))
    for key in list(D.keys()):
        if not key.startswith('ref_'):
            continue
        Tb = D[key].copy()
        for k in range(k5 + 1, len(mg)):
            if key in ('ref_CL', 'ref_Cm'):
                Tb[1:, k] = Tb[0, k][None] + (Tb[1:, k5] - Tb[0, k5][None])
            else:
                Tb[1:, k] = Tb[1:, k5] * (Tb[0, k] / np.where(np.abs(Tb[0, k5]) > 1e-9, Tb[0, k5], 1e-9))[None]
        D[key] = Tb


def targets(D, model):
    """-> {head: dict(X, T, W, bound, valid, names)} in runtime units."""
    extend_refs(D)
    # References are the CLEAN attached-flow derivatives at the same Mach number. Where the solver's flapped reference
    # differs much from the clean one (mostly the fin in the wake of the flapped wing, an engineering model that is not
    # trusted that far), the output is flagged and the runtime fades its correction out with flap extension.
    k3 = int(np.argmin(np.abs(D['mach_grid'] - 0.3)))
    flap_ratio = {}
    for key in list(D.keys()):
        if key.startswith('ref_'):
            Tb = D[key]
            with np.errstate(divide='ignore', invalid='ignore'):
                flap_ratio[key] = np.nan_to_num(Tb[1:, k3, 1] / Tb[0, k3, 1], nan=1.0, posinf=9.0, neginf=-9.0)
            D[key] = np.repeat(Tb[:1], Tb.shape[0], axis=0)
    an, flap, mach = D['cfg'].T
    inside = mach <= mach_cap(flap) + 1e-9
    gate = smoothstep(np.abs(an), G0, G1) * (1 - smoothstep(np.abs(an), FADE0, FADE1))     # the runtime's trust window
    wg = (0.05 + gate) * inside
    CL = D['base_CL']
    rCL = interp_ref(D, 'ref_CL', flap, mach)
    out = {}

    def attached(name, coef):
        r = interp_ref(D, f'ref_{name}_{coef}', flap, mach)
        d1 = (r[:, 1] - r[:, 0]) / (rCL[:, 1] - rCL[:, 0]); d0 = r[:, 0] - d1 * rCL[:, 0]
        return d0 + d1 * CL

    def rho(name, coef, key):
        r = interp_ref(D, f'ref_{name}_{coef}', flap, mach)[:, 1]
        rmin = np.min(np.abs(D[f'ref_{name}_{coef}'][..., 1]))
        ok = rmin > MIN_REF[key] and np.all(np.sign(D[f'ref_{name}_{coef}'][..., 1]) == np.sign(np.median(r)))
        return r, bool(ok)

    # The cross terms are residuals in coefficient units; they are scaled by tuned / solver size of the primary effect
    # that drives them (roll damping for Cn_p and Cl_r, roll-control power for the adverse yaw), so a solver whose
    # ailerons are twice as strong as the tuned ones does not also inject twice the adverse yaw.
    k0 = int(np.argmin(np.abs(D['mach_grid'] - 0.3)))
    roll_ctl = abs(model['clda'] * model['daMax']) + abs(model['cldt'] * model['dtMax'])
    kscale = dict(cnp=min(1.0, abs(model['clp']) / abs(D['ref_p_Cl'][0, k0, 1])), clr=min(1.0, abs(model['clp']) / abs(D['ref_p_Cl'][0, k0, 1])),
                  cnda=min(1.0, roll_ctl / abs(D['ref_da_Cl'][0, k0, 1])))
    spec = dict(beta=(25 * DEG, [('M', 'CY', 'cyb'), ('M', 'Cn', 'cnb'), ('F', 'Cl', 'clb')]),
                p=(0.25, [('M', 'Cl', 'clp'), ('A', 'Cn', 'cnp')]), r=(0.15, [('M', 'Cn', 'cnr'), ('A', 'Cl', 'clr')]),
                da=(1.0, [('M', 'Cl', 'clda'), ('A', 'Cn', 'cnda')]), dr=(1.0, [('M', 'Cn', 'cndr')]),
                de=(1.0, [('M', 'Cm', 'cmde')]), q=(0.03, [('M', 'Cm', 'cmq')]))
    for name, (umax, outs) in spec.items():
        u = D[f'chan_{name}_u']
        if name == 'beta':
            den = np.sin(u); amp = np.sin(np.abs(u)) / np.sin(umax)
        else:
            den = u; amp = u / umax
        X = np.stack([an, flap, mach, amp], 1)
        w = wg * np.clip(np.abs(amp) / 0.3, 0.25, 1.0)             # small amplitudes: noisy secants
        T, bound, valid, ff = [], [], [], []
        for kind, coef, key in outs:
            sec = D[f'chan_{name}_{coef}'] / den
            if kind == 'M':
                r, ok = rho(name, coef, key)
                t = np.clip(sec / r - 1.0, -0.9 * RHO_B, 0.6 * RHO_B) if ok else np.zeros_like(sec)
                T.append(t); bound.append(RHO_B); valid.append(ok)
                fr = flap_ratio[f'ref_{name}_{coef}']; ff.append(bool(np.any(fr < 0.75) or np.any(fr > 1.33)))
            elif kind == 'F':                                  # ratio to the solver's attached form d0 + d1 CL
                # positive angles of attack only (at negative lift the form passes through zero): no correction below
                a = attached(name, coef); act = (gate > 0) & inside & (an > 0)
                ok = bool(np.quantile(np.abs(a[act]), 0.02) > MIN_REF[key] and np.mean(np.sign(a[act]) == np.sign(np.median(a[act]))) > 0.99)
                t = np.clip(sec / np.where(np.abs(a) > 1e-6, a, 1e-6) - 1.0, -0.9 * RHO_B, 0.6 * RHO_B) if ok else np.zeros_like(sec)
                t = np.where(an > 0, t, 0.0)
                T.append(t); bound.append(RHO_B); valid.append(ok)
                fr = flap_ratio[f'ref_{name}_{coef}']; ff.append(bool(np.any(fr < 0.75) or np.any(fr > 1.33)))
            else:
                t = (sec - attached(name, coef)) * kscale[key]
                b = 1.25 * np.quantile(np.abs(t[gate > 0.5]), 0.99) + 1e-3
                T.append(np.clip(t, -0.9 * b, 0.9 * b)); bound.append(b); valid.append(True); ff.append(False)
        out[name] = dict(X=X, T=np.stack(T, 1), W=w, bound=np.array(bound), valid=valid, names=OUT_NAMES[name], ff=ff)

    # ---- pitching-moment break: what the analytic functional form cannot represent --------------------------------------
    # The analytic form (attached line * (1 - sigma) + post-stall term * sigma) is fitted to the solver where it is right
    # by construction (attached flow, deep stall); the residual in between is the pitch break. Unit: the solver's own
    # full-travel pitch control power (the runtime multiplies by the tuned one).
    al = D['alpha']
    fi = np.interp(flap, D['flap_grid'], np.arange(len(D['flap_grid'])))
    peak_p = np.array([np.interp(m, D['mach_grid'], [np.interp(f, np.arange(len(D['flap_grid'])), D['peak_pos'][:, k])
                                                    for k in range(len(D['mach_grid']))]) for f, m in zip(fi, mach)])
    peak_n = np.interp(mach, D['mach_grid'], D['peak_neg'][0])
    sig = separation(al, peak_p + model['peakOff'], peak_n + model['peakOff'], model['sharp'])
    att = 1 - sig
    Phi = np.stack([np.ones_like(al), flap, att * al, att * al * flap, att * al * mach ** 2, sig * np.sin(al), sig * np.sin(al) * flap], 1)
    fade = 1 - smoothstep(np.abs(an), FADE0, FADE1)
    wf = np.sqrt(inside * (0.03 + (1 - smoothstep(np.abs(an), 0.45, 0.7)) + 0.3 * (1 - fade)))
    coef, *_ = np.linalg.lstsq(Phi * wf[:, None], D['base_Cm'] * wf, rcond=None)
    de_ref = np.abs(interp_ref(D, 'ref_de_Cm', flap, mach)[:, 1])
    de_ok = out['de']['valid'][0]
    res = (D['base_Cm'] - Phi @ coef) / de_ref if de_ok else np.zeros_like(al)
    act = (gate > 0.5) & (fade > 0.5) & inside
    b = min(1.25 * np.quantile(np.abs(res[act]), 0.99) + 1e-3, CM_B)
    out['m'] = dict(X=np.stack([an, flap, mach, np.zeros_like(an)], 1), T=np.clip(res, -0.9 * b, 0.9 * b)[:, None],
                    W=(0.05 + gate * fade) * inside, bound=np.array([b]), valid=[de_ok], names=OUT_NAMES['m'],
                    form_rms=float(np.sqrt(np.mean(res[act] ** 2))))

    # ---- ground effect ----------------------------------------------------------------------------------------------------
    hb, gan, gflap, bank = D['g_in'].T
    X = np.stack([np.log(hb), gan, gflap, bank / (12 * DEG)], 1)
    de_g = np.abs(interp_ref(D, 'ref_de_Cm', gflap, np.full(len(hb), 0.2))[:, 1])
    dcm = (D['g_gnd_Cm'] - D['g_free_Cm']) / de_g if de_ok else np.zeros_like(hb)
    clb = (D['g_gnd_Cl'] - D['g_free_Cl']) / np.sin(bank)
    T = np.stack([dcm, clb], 1)
    bnd = np.minimum(1.25 * np.quantile(np.abs(T), 0.995, axis=0) + 1e-3, np.array([CM_B, 0.5]))
    out['g'] = dict(X=X, T=np.clip(T, -0.9 * bnd, 0.9 * bnd), W=np.ones(len(hb)), bound=bnd, valid=[de_ok, True],
                    names=OUT_NAMES['g'], hb_min=float(hb.min()))
    return out


# ---- tiny MLP -------------------------------------------------------------------------------------------------------------
def isru(x):
    return x / np.sqrt(1 + x * x)


def disru(x):
    return (1 + x * x) ** -1.5


def unpack(th, n_out):
    i = 0
    def take(shape):
        nonlocal i
        n = int(np.prod(shape)); v = th[i:i + n].reshape(shape); i += n
        return v
    return take((4, H)), take((H,)), take((H, H)), take((H,)), take((H, n_out)), take((n_out,))


def n_params(n_out):
    return 4 * H + H + H * H + H + H * n_out + n_out


def forward(th, X, bound):
    W1, b1, W2, b2, W3, b3 = unpack(th, len(bound))
    return bound * isru(isru(isru(X @ W1 + b1) @ W2 + b2) @ W3 + b3)


def jacobian(th, X, bound):
    n_out = len(bound); N = len(X)
    W1, b1, W2, b2, W3, b3 = unpack(th, n_out)
    z1 = X @ W1 + b1; a1 = isru(z1); z2 = a1 @ W2 + b2; a2 = isru(z2); z3 = a2 @ W3 + b3
    y = bound * isru(z3)
    J = np.zeros((N, n_out, len(th)))
    for k in range(n_out):
        g3 = bound[k] * disru(z3[:, k])
        d2 = g3[:, None] * W3[:, k][None] * disru(z2)
        d1 = (d2 @ W2.T) * disru(z1)
        dW3 = np.zeros((N, H, n_out)); dW3[:, :, k] = a2 * g3[:, None]
        db3 = np.zeros((N, n_out)); db3[:, k] = g3
        J[:, k] = np.concatenate([(X[:, :, None] * d1[:, None, :]).reshape(N, -1), d1,
                                  (a1[:, :, None] * d2[:, None, :]).reshape(N, -1), d2, dW3.reshape(N, -1), db3], 1)
    return y, J


def fit(X, T, W, bound, seed=0, iters=150, reg=3e-5):
    """Levenberg-Marquardt on the weighted, scale-normalised residuals with a small weight decay."""
    rng = np.random.default_rng(seed)
    n_out = T.shape[1]
    th = np.concatenate([(rng.standard_normal((4, H)) * np.array([1.2, 0.8, 0.8, 0.8])[:, None]).ravel(), rng.standard_normal(H) * 0.8,
                         (rng.standard_normal((H, H)) / np.sqrt(H)).ravel(), np.zeros(H),
                         (rng.standard_normal((H, n_out)) * 0.1).ravel(), np.zeros(n_out)])
    sc = np.sqrt(W / W.mean())[:, None] / (np.sqrt(np.average(T ** 2, axis=0, weights=W)) + 0.02 * bound)[None]
    N = len(X); lam = reg * N * n_out

    def cost(th):
        r = (forward(th, X, bound) - T) * sc
        return np.sum(r * r) + lam * np.sum(th * th)
    mu = 1e-2; c = cost(th)
    for _ in range(iters):
        y, J = jacobian(th, X, bound)
        r = ((y - T) * sc).ravel(); Jw = (J * sc[:, :, None]).reshape(N * n_out, -1)
        A = Jw.T @ Jw; g = Jw.T @ r + lam * th
        for _ in range(8):
            try:
                step = np.linalg.solve(A + (mu * np.diag(A) + lam) * np.eye(len(th)) + 1e-9 * np.eye(len(th)), -g)
            except np.linalg.LinAlgError:
                mu *= 10; continue
            c2 = cost(th + step)
            if c2 < c:
                th = th + step; c = c2; mu = max(mu / 3, 1e-7); break
            mu *= 4
        else:
            break
    return th


def quantise(th):
    s = np.float32(np.max(np.abs(th)) / 32767.0)
    q = np.clip(np.round(th / s), -32767, 32767).astype(np.int16)
    return q, s


def dequantise(q, s):
    return (q.astype(np.float32) * np.float32(s)).astype(np.float64)


def train_aircraft(aid, models, verbose=True):
    D = dict(np.load(os.path.join(DATA, f'{aid}.npz')))
    tg = targets(D, models[aid])
    rng = np.random.default_rng(7)
    save = dict(peak_pos=D['peak_pos'], peak_neg=D['peak_neg']); report = {}
    for name, n_out in HEADS:
        t = tg[name]
        X, T, W, bound = t['X'], t['T'], t['W'], t['bound']
        ok = np.all(np.isfinite(T), 1) & np.all(np.isfinite(X), 1)
        X, T, W = X[ok], T[ok], W[ok]
        idx = rng.permutation(len(X)); nv = len(X) // 6
        iv, it = idx[:nv], idx[nv:]
        best = None
        for seed in range(2):
            th = fit(X[it], T[it], W[it], bound, seed=seed)
            q, s = quantise(th)
            e = forward(dequantise(q, s), X[iv], bound) - T[iv]
            score = np.sum(np.average(e ** 2, axis=0, weights=W[iv]) / (np.average(T[iv] ** 2, axis=0, weights=W[iv]) + 1e-12))
            if best is None or score < best[0]:
                best = (score, q, s, e)
        _, q, s, e = best
        wv = W[iv]
        rms = np.sqrt(np.average(e ** 2, axis=0, weights=wv))
        mean = np.average(T[iv], axis=0, weights=wv)
        sd = np.sqrt(np.average((T[iv] - mean) ** 2, axis=0, weights=wv))
        r2 = 1 - rms ** 2 / np.maximum(sd ** 2, 1e-12)
        save[f'{name}_q'] = q; save[f'{name}_s'] = s; save[f'{name}_bound'] = bound
        save[f'{name}_valid'] = np.array([v and nm not in ANALYTIC for v, nm in zip(t['valid'], t['names'])], dtype=np.int8)
        save[f'{name}_ff'] = np.array(t.get('ff', [False] * n_out), dtype=np.int8)
        report[name] = {nm: dict(rms=float(rms[k]), sd=float(sd[k]), r2=float(r2[k]) if t['valid'][k] else None, valid=bool(t['valid'][k]), used=bool(t['valid'][k] and nm not in ANALYTIC), flap_fade=bool(t.get('ff', [False] * n_out)[k]),
                                 bound=float(bound[k])) for k, nm in enumerate(t['names'])}
        if name == 'g':
            save['g_hbmin'] = t['hb_min']
        if name == 'm':
            report['m']['cm']['form_rms'] = t['form_rms']
    os.makedirs(NETS, exist_ok=True)
    np.savez(os.path.join(NETS, f'{aid}.npz'), **save)
    if verbose:
        txt = '  '.join(f"{nm} {v['rms']:.3f}/{v['sd']:.3f}" + ('' if v['valid'] else '(off)') + ('(ff)' if v['flap_fade'] else '') for h in report.values() for nm, v in h.items())
        print(f'{aid:5} hold-out rms/sd: {txt}', flush=True)
    return report


if __name__ == '__main__':
    ids = sys.argv[1:] or planforms.IDS
    models = AC.load_models()
    rep = {}
    if os.path.exists(FITFILE):
        with open(FITFILE) as f:
            rep = json.load(f)
    for aid in ids:
        t0 = time.time()
        rep[aid] = train_aircraft(aid, models)
        print(f'      [{time.time() - t0:.0f} s]', flush=True)
        with open(FITFILE, 'w') as f:
            json.dump(rep, f, indent=1)
