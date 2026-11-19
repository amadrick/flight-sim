"""Network inputs from the raw clipmap features. Twin of `groundInputs` in src/neural/ground-cover.js and of the
GLSL in the same file: keep all three in sync (the unit test compares JS with stored Python vectors).

raw (per sample, 14 floats, as the GPU reads them at the feature level `a` with texel spacing s):
  0 h        height (m)                          1,2 ex, ez   normal xz, signed-sqrt encoded (level a)
  3 curv     Laplacian * s (level a)             4 conc       mean rise to a ring 4 texels out / (4 s) (level a)
  5,6 Bex,Bez  normal of the level 4x coarser    7 Bcurv      8 Bconc   (same, level 4x coarser)
  9 hC       height of the level 8x coarser      10 specC     special surface there (> 0 river)
  11 hE      height of the level 32x coarser     12 arid      13 spec (level a; < 0 playa)
plus lod = log2(s / 16 m) (0..5, fractional inside the LOD morph band) and latK = km south of the origin.
"""
import numpy as np

N_IN = 16
SMAX = 2048.0
CELL = 16.0


def decode_n(ex, ez):
    nx = np.sign(ex) * ex * ex
    nz = np.sign(ez) * ez * ez
    ny = np.sqrt(np.maximum(1.0 - nx * nx - nz * nz, 0.0004))
    return nx, ny, nz


def inputs(raw, lod, latk):
    raw = np.asarray(raw, np.float64)
    lod = np.clip(np.asarray(lod, np.float64), 0.0, 5.0)
    s = CELL * 2.0 ** lod
    sC = np.minimum(8.0 * s, SMAX)
    sE = np.minimum(32.0 * s, SMAX)
    h = raw[..., 0]
    nx, ny, nz = decode_n(raw[..., 1], raw[..., 2])
    bx, by, bz = decode_n(raw[..., 5], raw[..., 6])
    x = np.empty(raw.shape[:-1] + (N_IN,), np.float64)
    x[..., 0] = h / 1500.0 - 1.0
    x[..., 1] = (1.0 - ny) * 4.0 - 1.0
    x[..., 2] = nz * 1.5
    x[..., 3] = nx * 1.5
    x[..., 4] = raw[..., 3] * 6.0
    x[..., 5] = raw[..., 4] * 6.0
    x[..., 6] = (1.0 - by) * 4.0 - 1.0
    x[..., 7] = bz * 1.5
    x[..., 8] = raw[..., 7] * 6.0
    x[..., 9] = raw[..., 8] * 6.0
    x[..., 10] = np.clip((h - raw[..., 9]) / sC * 4.0, -2.0, 2.0)
    x[..., 11] = np.clip((h - raw[..., 11]) / sE * 4.0, -2.0, 2.0)
    x[..., 12] = np.clip(raw[..., 10], 0.0, 1.0) * 2.0 - 1.0
    x[..., 13] = raw[..., 12] * 2.0 - 1.0
    x[..., 14] = np.clip(latk, -200.0, 200.0) / 100.0
    x[..., 15] = lod / 2.5 - 1.0
    return x
