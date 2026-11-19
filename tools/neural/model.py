"""Model, feature encoding and the real-time baselines (shared by train.py / evaluate.py / export.py).

J(tauSun, tauUp, cosTheta) = phase(cosTheta) * exp(-tauSun)  +  J_ms,      J_ms = exp(net(...))

The network is *factorised* so that baking it into a 32^3 lookup table costs 2 x 1024 small-MLP evaluations
instead of 32768:
    ln J_ms = bias + sum_r  B_r(tauSun, tauUp) * A_r(tauSun, cosTheta)
with two small MLPs ("body": how much diffuse light there is at this depth; "angular": how the multiply
scattered light is distributed in angle at this sun optical depth, including the aureole around the sun).
The JS twin lives in src/neural/mlp.js and must stay in sync with `encode` and `ScatterNet.forward`.
"""
import math
import numpy as np
import torch
import torch.nn as nn

import phase as ph

TAU_MAX = 128.0          # optical depths are clamped here (LUT edge)
T0 = 0.02                # angular warp scale (rad, ~1.1 deg): x3 = ln(1 + chord/T0) / ln(1 + 2/T0)
RATIO_EPS = 1.0          # x5 = tauUp / (tauUp + tauSun + RATIO_EPS)   (deployed, factorised network)
RATIO_EPS_PLAIN = 0.05   # legacy value used by the (non-deployed) PlainNet oracles
LOG_TAU = math.log1p(TAU_MAX)
LOG_ANG = math.log1p(2.0 / T0)


def encode(tau_sun, tau_up, cos_t, xp=np, ratio_eps=RATIO_EPS):
    """Returns the 5 raw encodings in [0,1] (x1, x2, x3) / [-1,1] (x4) / [0,1] (x5)."""
    ts = xp.clip(tau_sun, 0.0, TAU_MAX)
    tu = xp.clip(tau_up, 0.0, TAU_MAX)
    c = xp.clip(cos_t, -1.0, 1.0)
    x1 = xp.log1p(ts) / LOG_TAU
    x2 = xp.log1p(tu) / LOG_TAU
    chord = xp.sqrt(2.0 * (1.0 - c))
    x3 = xp.log1p(chord / T0) / LOG_ANG
    x5 = tu / (tu + ts + ratio_eps)
    return x1, x2, x3, c, x5


class ISRU(nn.Module):
    """x / sqrt(1 + x^2): a smooth tanh-like activation that is a single sqrt in JS."""

    def forward(self, x):
        return x * torch.rsqrt(1.0 + x * x)


def mlp(sizes):
    layers = []
    for i in range(len(sizes) - 1):
        layers.append(nn.Linear(sizes[i], sizes[i + 1]))
        if i < len(sizes) - 2:
            layers.append(ISRU())
    return nn.Sequential(*layers)


class ScatterNet(nn.Module):
    """Factorised network.  body: (x1, x2, x5 [, x6]) -> R ; angular: (x1, x3, x4) -> R ; out = bias + <body, angular>.
    n_extra = 1 adds x6 = ln(1+tauDown)/ln(1+tauMax) to the body net (the optional 4-feature model)."""

    def __init__(self, hidden=(32, 32), rank=12, n_extra=0):
        super().__init__()
        self.hidden = tuple(hidden)
        self.rank = rank
        self.n_extra = n_extra
        self.body = mlp([3 + n_extra, *hidden, rank])
        self.ang = mlp([3, *hidden, rank])
        self.bias = nn.Parameter(torch.tensor(math.log(0.07)))

    def forward(self, x):
        """x: (N,5+n_extra) columns x1..x5 as returned by encode() [+ x6]; inputs are recentred to [-1,1] here."""
        cols = [2 * x[:, 0] - 1, 2 * x[:, 1] - 1, 2 * x[:, 4] - 1]
        for e in range(self.n_extra):
            cols.append(2 * x[:, 5 + e] - 1)
        xb = torch.stack(cols, dim=1)
        xa = torch.stack([2 * x[:, 0] - 1, 2 * x[:, 2] - 1, x[:, 3]], dim=1)
        return self.bias + (self.body(xb) * self.ang(xa)).sum(dim=1)


class PlainNet(nn.Module):
    """Unfactorised MLP on arbitrary inputs: used as the 'what is learnable at all' oracle (not deployed)."""

    def __init__(self, n_in, hidden=(128, 128, 128)):
        super().__init__()
        self.net = mlp([n_in, *hidden, 1])
        with torch.no_grad():
            self.net[-1].bias.fill_(math.log(0.07))

    def forward(self, x):
        return self.net(x).squeeze(1)


def load_split(split):
    """Load data/<split>.npz, concatenated with any extension shards data/<split>_*.npz."""
    import glob
    files = sorted(glob.glob('data/%s.npz' % split) + glob.glob('data/%s_*.npz' % split))
    parts = [np.load(f) for f in files]
    out = {k: np.concatenate([p[k] for p in parts]) for k in parts[0].files if k != 'paths'}
    out['paths'] = int(parts[0]['paths'])
    out['files'] = files
    return out


def column_prior_weight(feat, mode='thick'):
    """Per-sample weight that re-weights the cloud population by the optical thickness of the vertical column
    through the sample, tau_v = tauUp + tauDown (a dataset column; NOT an input of the deployed 3-feature net).

    The raw dataset is dominated by thin columns (median tau_v ~ 5: cloud edges, veils, thin stratus), but a
    three-feature model cannot tell a thin veil from the top of a thick cloud, so it has to commit to a prior.
    'thick' weights each sample by clip(tau_v, 1, 64) (normalised to mean 1): the population the flight simulator
    mostly draws, cumulus and stratocumulus decks with tau_v of 10-100.  'dataset' leaves the samples unweighted.
    """
    if mode in (None, '', 'dataset'):
        return np.ones(len(feat), dtype=np.float32)
    tv = np.clip(feat[:, 1].astype(np.float64) + feat[:, 3].astype(np.float64), 1.0, 64.0)
    return (tv / tv.mean()).astype(np.float32)


def n_params(m):
    return sum(p.numel() for p in m.parameters())


def features_main(feat):
    """feat: (N,8) dataset features -> (N,5) inputs of the PlainNet oracles."""
    x = encode(feat[:, 0].astype(np.float64), feat[:, 1].astype(np.float64), feat[:, 2].astype(np.float64),
               ratio_eps=RATIO_EPS_PLAIN)
    return np.stack(x, axis=1).astype(np.float32)


def features_factor(feat):
    """feat: (N,8) dataset features -> (N,5) inputs of the deployed factorised network."""
    x = encode(feat[:, 0].astype(np.float64), feat[:, 1].astype(np.float64), feat[:, 2].astype(np.float64))
    return np.stack(x, axis=1).astype(np.float32)


def drop_up(fx):
    """Ablation wrapper: remove all tauUp information (x2 and x5) from the inputs."""
    def f(feat):
        x = fx(feat).copy()
        x[:, 1] = 0.0
        x[:, 4] = 0.0
        return x
    return f


def encode_down(tau_down, xp=np):
    return xp.log1p(xp.clip(tau_down, 0.0, TAU_MAX)) / LOG_TAU


def features_factor4(feat):
    """(N,6): the 5 encodings + x6 = ln(1+tauDown)/ln(1+tauMax) for the optional 4-feature model."""
    return np.concatenate([features_factor(feat), encode_down(feat[:, 3].astype(np.float64))[:, None].astype(np.float32)],
                          axis=1)


def features_oracle(feat):
    """All 8 recorded features (adds tauDown, tauView, local extinction, mu0, height fraction)."""
    base = features_main(feat)
    extra = np.stack([
        np.log1p(np.clip(feat[:, 3], 0, TAU_MAX)) / LOG_TAU,          # tauDown
        np.log1p(np.clip(feat[:, 4], 0, TAU_MAX)) / LOG_TAU,          # tauView
        np.log1p(feat[:, 5] * 100.0) / math.log1p(12.0),              # local extinction
        feat[:, 6],                                                   # mu0
        feat[:, 7],                                                   # z / H
    ], axis=1).astype(np.float32)
    return np.concatenate([base, extra], axis=1)


def j_single(feat):
    """Analytic single scattering: phase(cosTheta) * exp(-tauSun)."""
    return ph.phase_np(feat[:, 2].astype(np.float64)) * np.exp(-feat[:, 0].astype(np.float64))


# ----------------------------------------------------------------------------------------- game baselines
G_GAME = ph.G_MEAN      # eccentricity used for the higher octaves (the true mean cosine of the phase function)


def baseline_single(tau_sun, tau_up, cos_t):
    return ph.phase_np(cos_t) * np.exp(-tau_sun)


def baseline_octaves(tau_sun, tau_up, cos_t, a=0.5, b=0.5, c=0.5, n=8, gain=1.0):
    """Wrenninge 2013 / Frostbite (Hillaire 2016) multiple-scattering octaves:
       J = sum_i b^i * phase_i(cosTheta) * exp(-a^i * tauSun), phase_0 = true phase, phase_i = HG(g * c^i).
       Stock game parameters: a = b = c = 0.5."""
    j = ph.phase_np(cos_t) * np.exp(-tau_sun)
    for i in range(1, n):
        j = j + gain * (b ** i) * ph.hg_np(cos_t, G_GAME * c ** i) * np.exp(-(a ** i) * tau_sun)
    return j


def baseline_beer_powder(tau_sun, tau_up, cos_t):
    """Schneider 2015 (Horizon Zero Dawn) Beer-Powder: 2 exp(-tau) (1 - exp(-2 tau)) * phase."""
    return ph.phase_np(cos_t) * 2.0 * np.exp(-tau_sun) * (1.0 - np.exp(-2.0 * tau_sun))


def baseline_nubis2017(tau_sun, tau_up, cos_t):
    """Schneider 2017 (Nubis) attenuation clamp: phase * max(exp(-tau), 0.7 exp(-0.25 tau))."""
    return ph.phase_np(cos_t) * np.maximum(np.exp(-tau_sun), 0.7 * np.exp(-0.25 * tau_sun))


# ------------------------------------------------------------------------------------- noise-aware metrics
J_FLOOR = 0.05   # "display floor": J of a mid-grey cloud / clear-sky radiance per unit sun irradiance (see REPORT.md)


def mc_noise(jss, ja, jb, j2, paths):
    """Estimated relative standard error of the reference J per sample (from the single-path second moment)."""
    mean = 0.5 * (ja + jb)
    var = np.maximum(j2 - mean * mean, 0.0) / max(int(paths), 1)
    return np.sqrt(var) / np.maximum(jss + mean, 1e-12)


def metrics(pred_total, jss, ja, jb, ref_total, mask=None, noise=None):
    """Error metrics of a prediction of total J against the path-traced reference.
    ja / jb are two INDEPENDENT Monte Carlo half-estimates of J_ms, so (p - Ja)(p - Jb) is an unbiased estimate
    of (p - J)^2 per sample: the RMSE-type metrics below are free of Monte Carlo noise bias.
    ref_total is a smooth noise-free stand-in for the true J (the 8-feature oracle network), used only as weight.
      rel_rmse   sqrt(mean[(p-Ja)(p-Jb) / ref^2])              per-sample relative RMS error
      disp_rmse  sqrt(mean[(p-Ja)(p-Jb) / (ref + J_FLOOR)^2])  relative to J plus a display floor
      energy     sqrt(sum (p-Ja)(p-Jb) / sum Ja Jb)            energy-weighted (dominated by the forward peak)
      rel_bias   mean[(p - J) / ref]                           mean signed relative error
      disp_bias  mean[(p - J) / (ref + J_FLOOR)]
    and, on the low-noise samples only (estimated MC standard error < 10 %):
      log_rmse   sqrt(mean[ln(p/Ja) ln(p/Jb)])                 RMS error in ln space
      med_abs    median |p/J - 1|,   within25 / fac2: fraction with |p/J - 1| < 0.25 / 0.5 < p/J < 2
    """
    if mask is None:
        mask = np.ones(len(jss), dtype=bool)
    p = pred_total[mask].astype(np.float64)
    a = (jss + ja)[mask].astype(np.float64)
    b = (jss + jb)[mask].astype(np.float64)
    r = ref_total[mask].astype(np.float64)
    num = (p - a) * (p - b)
    jm = 0.5 * (a + b)
    out = dict(n=int(mask.sum()))
    out['rel_rmse'] = float(math.sqrt(max(np.mean(num / (r * r)), 0.0)))
    out['disp_rmse'] = float(math.sqrt(max(np.mean(num / (r + J_FLOOR) ** 2), 0.0)))
    out['energy'] = float(math.sqrt(max(num.sum() / (a * b).sum(), 0.0)))
    out['rel_bias'] = float(np.mean((p - jm) / r))
    out['disp_bias'] = float(np.mean((p - jm) / (r + J_FLOOR)))
    # low-noise subset: both half-estimates non-zero (a zero Monte Carlo estimate is "unresolved", not "dark")
    # and an estimated standard error of the reference below 10 %
    ok = (ja[mask] > 0) & (jb[mask] > 0) & (p > 0)
    if noise is not None:
        ok &= noise[mask] < 0.10
    out['n_lownoise'] = int(ok.sum())
    if ok.sum() > 10:
        lg = np.log(p[ok] / a[ok]) * np.log(p[ok] / b[ok])
        out['log_rmse'] = float(math.sqrt(max(np.mean(lg), 0.0)))
        ratio = p[ok] / jm[ok]
        out['med_abs'] = float(np.median(np.abs(ratio - 1.0)))
        out['within25'] = float(np.mean(np.abs(ratio - 1.0) < 0.25))
        out['fac2'] = float(np.mean((ratio > 0.5) & (ratio < 2.0)))
    # the same three on ALL samples (includes the Monte Carlo noise of the reference: see the oracle rows for the floor)
    ratio = p / np.maximum(jm, 1e-30)
    out['med_abs_all'] = float(np.median(np.abs(ratio - 1.0)))
    out['within25_all'] = float(np.mean(np.abs(ratio - 1.0) < 0.25))
    out['fac2_all'] = float(np.mean((ratio > 0.5) & (ratio < 2.0)))
    return out
