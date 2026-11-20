"""Debug / report images for the fireball data (pure numpy + zlib PNG writer).

    python viz.py data/run000.npz out.png            # x-z mid-plane + side projection of soot / temperature over time
    python viz.py --render data/run000.npz out.png   # quick emission-absorption render (side view) per saved time
"""
import sys, zlib, struct
import numpy as np


def write_png(fn, img):
    """img: HxWx3 float in [0,1] or uint8."""
    if img.dtype != np.uint8:
        img = (np.clip(img, 0, 1) ** (1 / 2.2) * 255 + 0.5).astype(np.uint8)
    h, w, _ = img.shape
    raw = b''.join(b'\x00' + img[y].tobytes() for y in range(h))
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')
    open(fn, 'wb').write(png)


def blackbody_rgb(T):
    """Very small blackbody -> linear sRGB approximation (normalised luminance), T in K (array)."""
    T = np.clip(T, 500, 4000)
    lam = np.array([610e-9, 550e-9, 465e-9])
    c2 = 1.4388e-2
    B = 1.0 / (lam[None] ** 5 * (np.exp(c2 / (lam[None] * T.reshape(-1, 1))) - 1))
    B = B / B[:, 1:2]
    return B.reshape(T.shape + (3,))


def render_side(S, T, ext=600.0, emis=0.15, sun=np.array([0.6, 0.5, 0.45])):
    """S, T: (NX, NY, NZ) half-domain (y >= 0). Emission-absorption along y (both halves). Returns (NZ, NX, 3)."""
    full_S = np.concatenate([S[:, ::-1], S], 1).astype(np.float64)
    full_T = np.concatenate([T[:, ::-1], T], 1).astype(np.float64)
    dx = 0.1
    tau = full_S * ext * dx
    # light from the side (+x,+z) approx: transmittance downwards from the top
    tr_sun = np.exp(-np.cumsum(tau[:, :, ::-1], axis=2)[:, :, ::-1] * 0.7)
    Tk = 300 * (1 + full_T)
    bb = blackbody_rgb(Tk)
    I = (Tk / 1500.0) ** 4
    em = bb * I[..., None] * emis
    L = np.zeros((full_S.shape[0], full_S.shape[2], 3)); trans = np.ones((full_S.shape[0], full_S.shape[2]))
    for j in range(full_S.shape[1]):
        a = 1 - np.exp(-tau[:, j])
        src = (0.06 + 0.25 * tr_sun[:, j])[..., None] * sun * 0.6 + em[:, j] * (1 + 0 * a[..., None])
        L += trans[..., None] * a[..., None] * src
        trans *= 1 - a
    bg = np.array([0.45, 0.6, 0.85]) * 0.8
    L += trans[..., None] * bg
    return np.transpose(L, (1, 0, 2))[::-1]


def tone(x):
    x = np.maximum(x, 0)
    return x / (1 + x)


def colormap(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo + 1e-12), 0, 1)
    return np.stack([np.clip(1.5 * t, 0, 1), np.clip(1.5 * t - 0.5, 0, 1), np.clip(3 * t - 2, 0, 1)], -1)


if __name__ == '__main__':
    if sys.argv[1] == '--render':
        d = np.load(sys.argv[2]); sn = d['snaps'].astype(np.float32)
        tiles = [np.repeat(np.repeat(tone(render_side(s[0], s[1]) * 1.5), 2, 0), 2, 1)[-110:] for s in sn]
        cols = 6
        h, w = tiles[0].shape[:2]
        rows = (len(tiles) + cols - 1) // cols
        img = np.ones((rows * (h + 2), cols * (w + 2), 3))
        for i, t in enumerate(tiles):
            r, c = divmod(i, cols); img[r * (h + 2):r * (h + 2) + h, c * (w + 2):c * (w + 2) + w] = t
        write_png(sys.argv[3], img)
    else:
        d = np.load(sys.argv[1]); sn = d['snaps'].astype(np.float32)
        tiles = []
        for s in sn:
            Sm = s[0, :, 0, :].T[::-1]; Tm = s[1, :, 0, :].T[::-1]; Sp = s[0].sum(1).T[::-1] * 0.1
            tiles.append(np.concatenate([colormap(Sm, 0, 0.02), colormap(Tm, 0, 5), colormap(Sp, 0, 0.03)], 0))
        cols = 9
        h, w = tiles[0].shape[:2]
        rows = (len(tiles) + cols - 1) // cols
        img = np.ones((rows * (h + 2), cols * (w + 2), 3))
        for i, t in enumerate(tiles):
            r, c = divmod(i, cols); img[r * (h + 2):r * (h + 2) + h, c * (w + 2):c * (w + 2) + w] = t
        write_png(sys.argv[2], img)
