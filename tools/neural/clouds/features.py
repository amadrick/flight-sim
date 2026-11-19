"""Descriptors of a lit sample: exact multi-scale optical depths (for the ablation study) and the tap-based
descriptor the shader computes (the deployed model is trained on exactly the latter).

Conventions: rd = camera ray direction (from the camera outward), L = unit vector toward the sun,
cos_t = dot(L, rd) (+1 looking into the sun = the scattering cosine; same as the game's cosT).
"""
import math

import numpy as np
from numba import njit, prange

from pt import sample_grid, march_tau

DISTS = np.array([40.0, 120.0, 360.0, 1080.0, 4000.0])
DIR_NAMES = ['sun', 'up', 'down', 'cam', 'fwd', 'anti', 'sideA', 'sideB']


def directions(L, rd):
    """(n, 8, 3) unit vectors: sun, up, down, toward camera, forward along the ray, away from the sun, and the two
    horizontal directions perpendicular to the sun's azimuth."""
    n = rd.shape[0]
    L = np.broadcast_to(np.asarray(L, np.float64), (n, 3))
    up = np.broadcast_to(np.array([0.0, 1.0, 0.0]), (n, 3))
    side = np.stack([-L[:, 2], np.zeros(n), L[:, 0]], 1)
    nn = np.linalg.norm(side, axis=1, keepdims=True)
    side = np.where(nn > 1e-6, side / np.maximum(nn, 1e-9), np.array([1.0, 0.0, 0.0]))
    return np.ascontiguousarray(np.stack([L, up, -up, -rd, rd, -L, side, -side], 1))


@njit(parallel=True)
def _multi_tau(sig, ox, oy, oz, h, per, P, Dirs, dists, out):
    n, nd, _ = Dirs.shape
    nk = dists.shape[0]
    step = 0.5 * h
    for i in prange(n):
        for d in range(nd):
            dx, dy, dz = Dirs[i, d, 0], Dirs[i, d, 1], Dirs[i, d, 2]
            prev = 0.0
            acc = 0.0
            for k in range(nk):
                seg = march_tau(sig, ox, oy, oz, h, per, P[i, 0] + dx * prev, P[i, 1] + dy * prev, P[i, 2] + dz * prev,
                                dx, dy, dz, dists[k] - prev, step)
                acc += seg
                out[i, d, k] = acc
                prev = dists[k]


def multi_tau(scene, P, Dirs, dists=DISTS):
    out = np.zeros((len(P), Dirs.shape[1], len(dists)))
    _multi_tau(scene.sig, scene.o[0], scene.o[1], scene.o[2], scene.h, scene.per, np.ascontiguousarray(P, np.float64),
               np.ascontiguousarray(Dirs, np.float64), np.asarray(dists, np.float64), out)
    return out


@njit(parallel=True)
def _local_sigma(sig, ox, oy, oz, h, per, P, out):
    for i in prange(P.shape[0]):
        out[i] = sample_grid(sig, ox, oy, oz, h, per, P[i, 0], P[i, 1], P[i, 2])


def local_sigma(scene, P):
    out = np.zeros(len(P))
    _local_sigma(scene.sig, scene.o[0], scene.o[1], scene.o[2], scene.h, scene.per, np.ascontiguousarray(P, np.float64),
                 out)
    return out


# ------------------------------------------------------------------------------------- tap descriptor
# The deployed descriptor: optical depth along a direction estimated from K density taps at fixed distances with
# fixed segment weights (midpoint rule on exponentially growing segments), exactly as the GLSL helper does it.
# Segment ends (m) for K taps: TAP_ENDS[K]; tap k sits at the segment midpoint.
TAP_ENDS = {2: np.array([150.0, 600.0]), 3: np.array([100.0, 350.0, 1000.0]), 4: np.array([60.0, 220.0, 560.0, 1200.0])}


@njit(parallel=True)
def _tap_tau(sig, ox, oy, oz, h, per, P, Dirs, ends, out):
    n, nd, _ = Dirs.shape
    for i in prange(n):
        for d in range(nd):
            dx, dy, dz = Dirs[i, d, 0], Dirs[i, d, 1], Dirs[i, d, 2]
            prev = 0.0
            acc = 0.0
            for k in range(ends.shape[0]):
                m = 0.5 * (prev + ends[k])
                acc += sample_grid(sig, ox, oy, oz, h, per, P[i, 0] + dx * m, P[i, 1] + dy * m, P[i, 2] + dz * m) * (ends[k] - prev)
                prev = ends[k]
            out[i, d] = acc


def tap_tau(scene, P, Dirs, K):
    out = np.zeros((len(P), Dirs.shape[1]))
    _tap_tau(scene.sig, scene.o[0], scene.o[1], scene.o[2], scene.h, scene.per, np.ascontiguousarray(P, np.float64),
             np.ascontiguousarray(Dirs, np.float64), TAP_ENDS[K], out)
    return out


@njit(parallel=True)
def _tap_segments(sig, ox, oy, oz, h, per, P, Dirs, ends, out):
    """out[i, d, k] = sigma(p + dir * mid_k) * len_k, segments [ends[k-1], ends[k]] (ends[-1] = 0)."""
    n, nd, _ = Dirs.shape
    for i in prange(n):
        for d in range(nd):
            prev = 0.0
            for k in range(ends.shape[0]):
                m = 0.5 * (prev + ends[k])
                out[i, d, k] = sample_grid(sig, ox, oy, oz, h, per, P[i, 0] + Dirs[i, d, 0] * m,
                                           P[i, 1] + Dirs[i, d, 1] * m, P[i, 2] + Dirs[i, d, 2] * m) * (ends[k] - prev)
                prev = ends[k]


def tap_segments(scene, P, Dirs, ends):
    out = np.zeros((len(P), Dirs.shape[1], len(ends)))
    _tap_segments(scene.sig, scene.o[0], scene.o[1], scene.o[2], scene.h, scene.per, np.ascontiguousarray(P, np.float64),
                  np.ascontiguousarray(Dirs, np.float64), np.asarray(ends, np.float64), out)
    return out
