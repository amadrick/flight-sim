"""Ghost reflections of the double-Gauss (Hullin et al. 2011 style): survey of all two-reflection paths, selection
of the visible ones, and the per-ghost image dataset the networks learn.

  cd tools/neural/flare
  OMP_NUM_THREADS=1 nice -n 10 python3 ghosts.py survey          # all 45 paths, paraxial check, selection
  OMP_NUM_THREADS=1 nice -n 10 python3 ghosts.py data 0 6         # images for selected ghosts [0, 6)
  OMP_NUM_THREADS=1 nice -n 10 python3 ghosts.py data 6 12
  OMP_NUM_THREADS=1 nice -n 10 python3 ghosts.py merge

Frame units: the renderer works in "frame units" (1 = half the image height).  Here 1 frame unit = U0 = 0.2 x EFL
on the sensor, i.e. a sun at frame radius r sits at field angle atan(0.2 r) (a 16:9 frame then spans the lens'
designed 22 deg half-diagonal field at r = 2.04).

For each ghost g and sun radius r the dataset stores
  meta  = (c, m_al, m_ac, E): the image of the iris centre on the flare axis (frame units, + = toward the sun),
          the magnification iris -> ghost along / across the axis (frame units per iris radius, signed), and the
          ghost's luminous flux as a fraction of the flux the lens collects from the sun (E);
  image = RGB flux density in ghost coordinates q = ((x - c) / |m_al|, y / |m_ac|) (iris coordinates up to sign)  (fraction per unit q-area, white
          equal-energy source), on a 32 x 16 grid (q_al in [-1.6, 1.6], |q_ac| in [0, 1.6]; mirror symmetric),
          blurred by the angular size of the sun.
The renderer converts with  L = E_sun * image / (|m_al m_ac| tan^2(fov / 2)).
"""
import json
import math
import os
import sys
import time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lens import Lens, spectral_rgb_weights   # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, 'results')
DATA = os.path.join(HERE, 'data')
U0_FRAC = 0.2
R_GRID = np.linspace(0.0, 2.4, 17)
R_HOLDOUT = np.array([0.375, 0.975, 1.575, 2.175])
LAMS = np.linspace(400, 700, 9)[:-1] + 300 / 16      # 8 band centres 418.75 ... 681.25 nm
QMAX, NQA, NQC = 1.6, 32, 16
SUN_RADIUS = 0.004654                                  # rad
NOMINAL_FOV = 58.0                                     # deg, vertical fov of the chase camera the blur is baked for
S_SUN = math.tan(SUN_RADIUS) / math.tan(math.radians(NOMINAL_FOV / 2))   # sun radius in frame units
M_MIN = 2.0 * S_SUN
N_GHOSTS = 12


def theta_of_r(r):
    return math.atan(U0_FRAC * r)


def ghost_list(L):
    idx = [k for k in range(L.nsurf) if not L.surf[k]['stop']]
    return [(idx[a], idx[b]) for a in range(len(idx)) for b in range(a + 1, len(idx))]


def gname(L, g):
    return L.surf[g[0]]['name'] + '-' + L.surf[g[1]]['name']


def survey():
    L = Lens()
    U0 = U0_FRAC * L.efl
    A_ep = math.pi * L.ep_radius ** 2
    rows = []
    t0 = time.time()
    for g in ghost_list(L):
        per = []
        for r in (0.0, 0.6, 1.2, 1.8):
            th = theta_of_r(r)
            p, d, dA = L.entrance_rays(th, 12.7, 128, centre=(L.z_ep * math.tan(th), 0))
            E, cs, ss = 0.0, [], []
            for lam in (450.0, 550.0, 650.0):
                xy, w, al = L.trace(p, d, lam, ghost=g)
                e = (w * dA).sum() / A_ep
                E += e / 3
                if lam == 550.0 and e > 0:
                    c = (xy[:, 0] * w).sum() / w.sum()
                    cs.append(c)
                    ss.append(math.sqrt((((xy[:, 0] - c) ** 2 + xy[:, 1] ** 2) * w).sum() / w.sum()))
            pg = L.para_ghost(g, th)
            per.append(dict(r=r, E=E, c_traced=cs[0] / U0 if cs else None, s_traced=ss[0] / U0 if ss else None,
                            c_paraxial=pg['centre'] / U0, radius_paraxial=pg['radius'] / U0))
        # visibility: flux per area (a ghost of size <~ sun is limited by the sun's size)
        vis = np.mean([q['E'] / (math.pi * (2 * (q['s_traced'] or 1e9) ** 2 + (2 * S_SUN) ** 2)) for q in per])
        rows.append(dict(ghost=list(g), name=gname(L, g), vis=vis, per=per))
    rows.sort(key=lambda q: -q['vis'])
    sel = [q['ghost'] for q in rows[:N_GHOSTS]]
    os.makedirs(RES, exist_ok=True)
    with open(os.path.join(RES, 'ghost_survey.json'), 'w') as f:
        json.dump(dict(selected=sel, rows=rows, frame_unit_mm=U0, seconds=time.time() - t0), f, indent=1)
    for q in rows:
        print('%-8s vis %.2e  E(r=0) %.2e  ' % (q['name'], q['vis'], q['per'][0]['E']) + '  '.join(
            'c %s/%.3f' % ('%.3f' % p['c_traced'] if p['c_traced'] is not None else '  -  ', p['c_paraxial'])
            for p in q['per']))
    print('selected', [gname(L, tuple(g)) for g in sel], 'in %.1fs' % (time.time() - t0))


def blur_axis(img, sigma, axis):
    """Gaussian blur (sigma in bins) along one axis, zero padded."""
    if sigma < 0.05:
        return img
    rad = int(math.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-rad, rad + 1) / sigma) ** 2)
    k /= k.sum()
    img = np.moveaxis(img, axis, -1)
    pad = np.zeros(img.shape[:-1] + (img.shape[-1] + 2 * rad,))
    pad[..., rad:-rad] = img
    out = np.zeros_like(img)
    for i, kv in enumerate(k):
        out += kv * pad[..., i:i + img.shape[-1]]
    return np.moveaxis(out, -1, axis)


def ghost_at(L, g, r, rgbw, rng, n_dense=200, kp=None):
    """Trace one ghost at sun radius r for all wavelengths. Returns meta (c, m_al, m_ac, E) and image (NQA,NQC,3)."""
    U0 = U0_FRAC * L.efl
    A_ep = math.pi * L.ep_radius ** 2
    th = theta_of_r(r)
    hits = []
    for li, lam in enumerate(LAMS):
        # coarse pass over the whole front element to find where the surviving rays enter
        cen = (L.z_ep * math.tan(th), 0.0)
        p, d, dA = L.entrance_rays(th, 12.8, 56, centre=cen)
        _, w, al = L.trace(p, d, lam, ghost=g)
        if not al.any():
            continue
        # entrance-plane coordinates of survivors (rays were placed on the EP plane: recover them)
        tb = (L.z_ep - p[:, 2]) / d[:, 2]
        ep = p[:, :2] + tb[:, None] * d[:, :2]
        cell = 2 * 12.8 / 56
        lo = ep[al].min(0) - cell
        hi = ep[al].max(0) + cell
        half = max(hi[0] - lo[0], hi[1] - lo[1]) / 2
        cen2 = ((lo + hi) / 2).tolist()
        p, d, dA = L.entrance_rays(th, half, n_dense, jitter=rng, centre=cen2)
        xy, w, al, stops = L.trace(p, d, lam, ghost=g, want_stop=True)
        if not al.any():
            continue
        flux = w[al] * dA / A_ep
        st = [s[al] / L.stop_radius for s in stops]
        hits.append((li, xy[al] / U0, flux, st))
    if not hits:
        return np.array([0.0, 1.0, 1.0, 0.0]), np.zeros((NQA, NQC, 3)), 0.0, 0
    # Ghost frame from the iris mapping: trace the same path with only the iris clipping (no element rims), find
    # the iris pass that limits the bundle, and fit x = c + m_al a_x, y = m_ac a_y over the inner part of the iris
    # (|a| < 0.7) at 550 nm.  c is then the image of the iris centre (stable even when rims cut the ghost).
    cen = (L.z_ep * math.tan(th), 0.0)
    p, d, _ = L.entrance_rays(th, 12.8, 96, centre=cen)
    xy0, _, al0, st0 = L.trace(p, d, 550.0, ghost=g, want_stop=True, rims=False)
    st0 = [s[al0] / L.stop_radius for s in st0]
    xy0 = xy0[al0] / U0
    if kp is None:
        reach = [np.percentile(np.hypot(*s.T), 99.5) for s in st0]
        kp = int(np.argmax(reach))
    A = st0[kp]
    if len(A) < 20:
        return np.array([0.0, 1.0, 1.0, 0.0]), np.zeros((NQA, NQC, 3)), 0.0, 0
    inner = np.hypot(*A.T) < 0.7
    if inner.sum() < 20:
        inner = np.ones(len(A), bool)
    A, X = A[inner], xy0[inner]
    M = np.stack([np.ones_like(A[:, 0]), A[:, 0]], 1)
    c, m_al = np.linalg.lstsq(M, X[:, 0], rcond=None)[0]
    m_ac = (X[:, 1] * A[:, 1]).sum() / max((A[:, 1] ** 2).sum(), 1e-30)
    # flare-axis coordinates: + toward the sun. The sensor image is inverted (sun at +x on the sensor for theta>0),
    # and so is the display; the along-axis coordinate measured toward the sun is x itself.
    # ghost frame scale: the iris magnification, enlarged where aberrations / line foci spread the light further
    # than the iris image (2 x rms = radius of a uniform disc), never below the sun's size
    Xa = np.concatenate([h[1] for h in hits])
    Fw = np.concatenate([h[2] * (rgbw[h[0]] @ np.array([0.2126, 0.7152, 0.0722])) for h in hits])
    Fw = np.maximum(Fw, 0)
    rms_al = math.sqrt((Fw * (Xa[:, 0] - c) ** 2).sum() / max(Fw.sum(), 1e-30))
    rms_ac = math.sqrt((Fw * Xa[:, 1] ** 2).sum() / max(Fw.sum(), 1e-30))
    m_al = math.copysign(max(abs(m_al), 2.0 * rms_al, M_MIN), m_al)
    m_ac = math.copysign(max(abs(m_ac), 2.0 * rms_ac, M_MIN), m_ac)
    img = np.zeros((NQA, 2 * NQC, 3))
    E = 0.0
    cover = 0.0
    for li, xy, flux, _ in hits:
        qa = (xy[:, 0] - c) / abs(m_al)     # image in |scale| units: continuous when a scale changes sign
        qc = xy[:, 1] / abs(m_ac)
        for sgn in (1.0, -1.0):          # mirror symmetry about the flare axis
            ia = np.floor((qa + QMAX) / (2 * QMAX) * NQA).astype(int)
            ic = np.floor((sgn * qc + QMAX) / (2 * QMAX) * 2 * NQC).astype(int)
            ok = (ia >= 0) & (ia < NQA) & (ic >= 0) & (ic < 2 * NQC)
            for ch in range(3):
                np.add.at(img[:, :, ch], (ia[ok], ic[ok]), 0.5 * flux[ok] * rgbw[li, ch])
            cover += 0.5 * (flux[ok] * (rgbw[li] @ np.array([0.2126, 0.7152, 0.0722]))).sum()
        E += (flux * (rgbw[li] @ np.array([0.2126, 0.7152, 0.0722]))).sum()
    bin_area = (2 * QMAX / NQA) * (2 * QMAX / (2 * NQC))
    img /= bin_area
    # extended source: blur by the sun's disc (Gaussian of equal second moment) plus half a bin against noise
    bin_w = 2 * QMAX / NQA
    for axis, m in ((0, m_al), (1, m_ac)):
        sig = math.sqrt((0.5 * S_SUN / abs(m)) ** 2 + (0.45 * bin_w) ** 2) / bin_w
        img = blur_axis(img, sig, axis)
    img = img[:, NQC:, :]              # keep |q_ac| >= 0 (the grid is symmetric)
    return np.array([c, m_al, m_ac, E]), img, cover / max(E, 1e-30), sum(len(h[2]) for h in hits)


def make_data(lo, hi):
    L = Lens()
    sel = json.load(open(os.path.join(RES, 'ghost_survey.json')))['selected']
    rgbw = spectral_rgb_weights(LAMS)
    os.makedirs(DATA, exist_ok=True)
    for gi in range(lo, min(hi, len(sel))):
        g = tuple(sel[gi])
        t0 = time.time()
        rng = np.random.default_rng(100 + gi)
        out = {}
        # the iris pass that limits the bundle near the axis defines the ghost frame at every sun radius
        th = theta_of_r(0.3)
        p, dd, _ = L.entrance_rays(th, 12.8, 96, centre=(L.z_ep * math.tan(th), 0.0))
        _, _, al0, st0 = L.trace(p, dd, 550.0, ghost=g, want_stop=True, rims=False)
        kp = int(np.argmax([np.percentile(np.hypot(*(s[al0] / L.stop_radius).T), 99.5) for s in st0]))
        for tag, rs in (('train', R_GRID), ('hold', R_HOLDOUT)):
            metas, imgs, covs = [], [], []
            for r in rs:
                meta, img, cov, nr = ghost_at(L, g, float(r), rgbw, rng, kp=kp)
                metas.append(meta); imgs.append(img); covs.append(cov)
            out[tag + '_meta'] = np.array(metas)
            out[tag + '_img'] = np.array(imgs)
            out[tag + '_cover'] = np.array(covs)
        np.savez_compressed(os.path.join(DATA, 'ghost_%02d.npz' % gi), ghost=np.array(g), **out)
        m = out['train_meta']
        print('%2d %-8s %.0fs  E %s  c %s  cover %.3f' % (gi, gname(L, g), time.time() - t0,
              ' '.join('%.1e' % e for e in m[::4, 3]), ' '.join('%.2f' % e for e in m[::4, 0]),
              out['train_cover'].min()), flush=True)


def merge():
    L = Lens()
    sel = json.load(open(os.path.join(RES, 'ghost_survey.json')))['selected']
    parts = [np.load(os.path.join(DATA, 'ghost_%02d.npz' % i)) for i in range(len(sel))]
    keys = ['train_meta', 'train_img', 'train_cover', 'hold_meta', 'hold_img', 'hold_cover']
    np.savez_compressed(os.path.join(DATA, 'ghosts.npz'), ghosts=np.array(sel), r_grid=R_GRID, r_hold=R_HOLDOUT,
                        names=np.array([gname(L, tuple(g)) for g in sel]),
                        **{k: np.stack([p[k] for p in parts]) for k in keys})
    print('merged', len(parts))


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'survey':
        survey()
    elif cmd == 'data':
        make_data(int(sys.argv[2]), int(sys.argv[3]))
    elif cmd == 'merge':
        merge()
