"""Input / output encodings of the flare networks.  Mirrored exactly in src/neural/flare.js (keep in sync)."""
import math
import numpy as np

R_MAX = 2.4             # sun distance from the frame centre covered by the ghost data (frame units)
QMAX, NQA, NQC = 1.6, 32, 16
STAR_R0, STAR_R1 = 0.012, 2.4
STAR_S = 0.0084         # perpendicular-distance unit for the starburst encoding (the baked sun radius, frame units)
M_SCALE = 0.05


def meta_features(r):
    r = np.asarray(r, np.float64)
    return np.stack([r / (R_MAX / 2) - 1], -1)


def meta_encode(meta):
    """(c, s_al, s_ac, E) -> (c / R_MAX, ln|s_al / M_SCALE|, ln|s_ac / M_SCALE|, sign s_al, sign s_ac, log10 E + 6)."""
    c, sa, sc, E = meta[..., 0], meta[..., 1], meta[..., 2], meta[..., 3]
    return np.stack([c / R_MAX, np.log(np.abs(sa) / M_SCALE), np.log(np.abs(sc) / M_SCALE), np.sign(sa), np.sign(sc),
                     np.log10(E + 1e-10) + 6], -1)


def meta_decode(y):
    sa = np.where(y[..., 3] >= 0, 1.0, -1.0) * np.exp(y[..., 1]) * M_SCALE
    sc = np.where(y[..., 4] >= 0, 1.0, -1.0) * np.exp(y[..., 2]) * M_SCALE
    return np.stack([y[..., 0] * R_MAX, sa, sc, np.maximum(10 ** (y[..., 5] - 6) - 1e-10, 0)], -1)


META_OUT = 6


def ghost_grid():
    qa = -QMAX + (np.arange(NQA) + 0.5) * (2 * QMAX / NQA)
    qc = (np.arange(NQC) + 0.5) * (QMAX / NQC)
    return qa, qc


def ghost_features(r, qa, qc):
    r, qa, qc = np.broadcast_arrays(np.asarray(r, np.float64), np.asarray(qa, np.float64), np.asarray(qc, np.float64))
    rho = np.sqrt(qa * qa + qc * qc)
    f = [r / (R_MAX / 2) - 1, qa / QMAX, qc / QMAX, rho / QMAX]
    for k in (1, 2, 3):
        f += [np.cos(k * math.pi * rho), np.sin(k * math.pi * rho)]
    return np.stack(f, -1)


def star_features(r, phi):
    r = np.asarray(r, np.float64); phi = np.asarray(phi, np.float64)
    t = (np.log(r) - math.log(STAR_R0)) / math.log(STAR_R1 / STAR_R0) * 2 - 1
    d = r * np.sin(phi) / STAR_S
    return np.stack([t, np.minimum(d, 8.0) / 4 - 1, phi / (math.pi / 6) * 2 - 1, np.exp(-0.5 * d * d), t * t], -1)
