"""Real camera lens for the flare reference: prescription, glass dispersion, AR coating, paraxial optics and a
vectorised sequential ray tracer (numpy only).

Lens: the classic 50 mm f/2 double-Gauss of Tronnier, US patent 2,673,491 ("D-GAUSS F/2 22deg HFOV"), as tabulated
in W. J. Smith, "Modern Lens Design" (1992), p. 312, scaled from 100 mm to 50 mm focal length.  This is the same
table that Kolb, Mitchell & Hanrahan (SIGGRAPH 1995) and pbrt ("dgauss.50mm.dat") use.  The table gives only the
d-line indices; the Abbe numbers below are those of catalogue glasses with the same nd (crowns for the positive
elements, flints for the negative ones), which is what a double-Gauss of that era used.

Units: millimetres, wavelengths in nanometres.  The optical axis is +z (light travels +z), the first vertex is z = 0.
Flare coordinates: the sun is in the x-z plane; everything is symmetric about that meridional plane.
"""
import math
import numpy as np

# --- prescription ---------------------------------------------------------------------------------------------
# radius of curvature (0 = plane), thickness to the next surface, nd of the medium AFTER the surface (1 = air),
# Abbe number of that medium, clear aperture diameter.  Row 'STOP' is the iris.
#                 R          t       nd      vd     diam   glass (same nd/vd, Schott catalogue name)
PRESCRIPTION = [
    (29.475,    3.76,   1.670,  47.1,  25.2),   # L1  BaF10-like crown
    (84.83,     0.12,   1.0,    0.0,   25.2),
    (19.275,    4.025,  1.670,  47.1,  23.0),   # L2  BaF10-like crown, cemented to
    (40.77,     3.275,  1.699,  30.1,  23.0),   # L3  SF15-like flint
    (12.75,     5.705,  1.0,    0.0,   18.0),
    ('STOP',    4.5,    1.0,    0.0,   17.1),   # iris (wide open = f/2)
    (-14.495,   1.18,   1.603,  38.0,  17.0),   # L4  F5-like flint, cemented to
    (40.77,     6.065,  1.658,  50.9,  20.0),   # L5  SSK5-like crown
    (-20.385,   0.19,   1.0,    0.0,   20.0),
    (437.065,   3.22,   1.717,  48.0,  20.0),   # L6  LaF3-like crown
    (-39.73,    0.0,    1.0,    0.0,   20.0),   # (thickness to the image plane is solved for: paraxial focus at 550 nm)
]
COATING_N = 1.38           # single-layer MgF2 quarter-wave anti-reflection coating on every air-glass surface
COATING_LAMBDA0 = 550.0    # design wavelength of the coating (nm)
LAMBDA_REF = 550.0
F_NUMBER = 4.0             # working aperture used for the flare (the lens is f/2 wide open)
IRIS_BLADES = 6            # straight-bladed iris (6 blades -> 6 diffraction spikes)

LD, LF, LC = 587.56, 486.13, 656.27


def cauchy(nd, vd):
    """Two-term Cauchy n(lambda) = A + B / lambda^2 matching nd and the Abbe number vd."""
    if vd <= 0:
        return lambda lam: np.ones_like(np.asarray(lam, np.float64))
    B = (nd - 1.0) / vd / (1.0 / LF ** 2 - 1.0 / LC ** 2)
    A = nd - B / LD ** 2
    return lambda lam: A + B / np.asarray(lam, np.float64) ** 2


class Lens:
    def __init__(self, f_number=F_NUMBER, blades=IRIS_BLADES):
        self.surf = []
        z = 0.0
        for k, (R, t, nd, vd, diam) in enumerate(PRESCRIPTION):
            stop = R == 'STOP'
            self.surf.append(dict(z=z, R=0.0 if stop else float(R), stop=stop, nd=nd, vd=vd, n=cauchy(nd, vd),
                                  h=diam / 2.0, name='STOP' if stop else 'S%d' % (k + 1 - (k > 5))))
            z += t
        self.nsurf = len(self.surf)
        self.stop_idx = [k for k, s in enumerate(self.surf) if s['stop']][0]
        self.blades = blades
        # coated = air on one side, glass on the other
        for k, s in enumerate(self.surf):
            nb = 1.0 if k == 0 else self.surf[k - 1]['nd']
            s['coated'] = (not s['stop']) and ((nb == 1.0) != (s['nd'] == 1.0))
            s['cemented'] = (not s['stop']) and nb != 1.0 and s['nd'] != 1.0
        self.z_last = self.surf[-1]['z']
        p = self.paraxial(LAMBDA_REF)
        self.efl, self.bfl = p['efl'], p['bfl']
        self.z_img = self.z_last + self.bfl
        self.set_f_number(f_number)

    # --- indices -------------------------------------------------------------------------------------------
    def n_after(self, k, lam):
        return self.surf[k]['n'](lam) if k >= 0 else np.ones_like(np.asarray(lam, np.float64))

    def n_before(self, k, lam):
        return self.n_after(k - 1, lam)

    # --- paraxial optics -----------------------------------------------------------------------------------
    def _para_step(self, y, u, n, z, k, lam, mode):
        """Advance a paraxial ray (height y, slope u = dy/dz, signed index n, position z) to surface k and refract
        ('T') or reflect ('R') there.  Signed-index convention: n < 0 while travelling toward -z."""
        s = self.surf[k]
        y = y + (s['z'] - z) * u
        c = 0.0 if s['R'] == 0 else 1.0 / s['R']
        if mode == 'R':
            u = -u - 2.0 * y * c
            n = -n
        else:
            fwd = n > 0
            n2 = float(self.n_after(k, lam)) if fwd else -float(self.n_before(k, lam))
            u = (n * u - y * (n2 - n) * c) / n2
            n = n2
        return y, u, n, s['z']

    def path_ops(self, ghost=None):
        """Sequence of (surface, 'T'|'R') for the direct path (ghost None) or a two-reflection ghost (i, j), i < j:
        forward to j, reflect, back to i, reflect, forward to the image."""
        N = self.nsurf
        if ghost is None:
            return [(k, 'T') for k in range(N)]
        i, j = ghost
        ops = [(k, 'T') for k in range(j)] + [(j, 'R')]
        ops += [(k, 'T') for k in range(j - 1, i, -1)] + [(i, 'R')]
        ops += [(k, 'T') for k in range(i + 1, N)]
        return ops

    def para_trace(self, y, u, lam, ops, z0=None, record_stop=False):
        n, z = 1.0, (self.surf[0]['z'] if z0 is None else z0)
        stops = []
        for k, m in ops:
            y, u, n, z = self._para_step(y, u, n, z, k, lam, m)
            if record_stop and self.surf[k]['stop']:
                stops.append(y)
        return (y, u, z, stops) if record_stop else (y, u, z)

    def paraxial(self, lam):
        ops = self.path_ops()
        y, u, z = self.para_trace(1.0, 0.0, lam, ops)
        efl = -1.0 / u
        bfl = -y / u
        # entrance pupil: image of the stop centre in object space
        ks = self.stop_idx
        y, u, n = 0.0, 1.0, -1.0       # leave the stop centre toward -z
        zc = self.surf[ks]['z']
        for k in range(ks - 1, -1, -1):
            y, u, n, zc = self._para_step(y, u, n, zc, k, lam, 'T')
        z_ep = zc - y / u
        # pupil magnification: a ray parallel at height 1 reaches the stop at height ys
        y1, u1 = 1.0, 0.0
        n, zc = 1.0, self.surf[0]['z']
        for k in range(ks):
            y1, u1, n, zc = self._para_step(y1, u1, n, zc, k, lam, 'T')
        y1 = y1 + (self.surf[ks]['z'] - zc) * u1
        return dict(efl=efl, bfl=bfl, z_ep=z_ep, pupil_mag=1.0 / y1)

    def set_f_number(self, N):
        p = self.paraxial(LAMBDA_REF)
        self.f_number = N
        self.ep_radius = self.efl / (2.0 * N)
        self.z_ep = p['z_ep']
        self.stop_radius = self.ep_radius / p['pupil_mag']
        self.surf[self.stop_idx]['h'] = self.stop_radius

    def para_ghost(self, ghost, theta, lam=LAMBDA_REF):
        """Paraxial ghost centre and radius on the image plane for field angle theta (rad)."""
        ops = self.path_ops(ghost)
        z0 = self.z_ep
        res = []
        for (y, u) in ((1.0, 0.0), (0.0, 1.0)):
            yy, uu, z, stops = self.para_trace(y, u, lam, ops, z0=z0, record_stop=True)
            yy = yy + (self.z_img - z) * uu
            res.append((yy, stops))
        (S1, A), (S2, B) = res
        k = int(np.argmax(np.abs(A)))
        t = math.tan(theta)
        y0 = -t * B[k] / A[k]
        return dict(centre=y0 * S1 + t * S2, radius=abs(self.stop_radius * S1 / A[k]))

    # --- coatings --------------------------------------------------------------------------------------------
    def reflectance(self, k, cos_i, n1, n2, lam):
        """Unpolarised reflectance at surface k for a ray hitting it from medium n1 toward n2 (arrays)."""
        sin2_i = np.clip(1.0 - cos_i ** 2, 0.0, 1.0)
        if not self.surf[k]['coated']:
            return fresnel(cos_i, n1, n2)
        # coated air-glass surface: the film sits between air and glass. Work in the air side.
        n_air, n_glass = np.ones_like(n2), np.where(n1 > n2, n1, n2)
        sin2_air = sin2_i * (n1 / n_air) ** 2
        tir = sin2_air >= 1.0
        sin2_air = np.minimum(sin2_air, 0.999999)
        c0 = np.sqrt(1.0 - sin2_air)
        c1 = np.sqrt(1.0 - sin2_air / COATING_N ** 2)
        c2 = np.sqrt(np.clip(1.0 - sin2_air / n_glass ** 2, 0, 1))
        d = COATING_LAMBDA0 / (4.0 * COATING_N)
        delta = 2.0 * np.pi * COATING_N * d * c1 / lam
        e = np.exp(2j * delta)
        R = 0.0
        for pol in ('s', 'p'):
            if pol == 's':
                r01 = (n_air * c0 - COATING_N * c1) / (n_air * c0 + COATING_N * c1)
                r12 = (COATING_N * c1 - n_glass * c2) / (COATING_N * c1 + n_glass * c2)
            else:
                r01 = (COATING_N * c0 - n_air * c1) / (COATING_N * c0 + n_air * c1)
                r12 = (n_glass * c1 - COATING_N * c2) / (n_glass * c1 + COATING_N * c2)
            r = (r01 + r12 * e) / (1.0 + r01 * r12 * e)
            R = R + 0.5 * np.abs(r) ** 2
        return np.where(tir, 1.0, R)

    # --- exact ray tracing -------------------------------------------------------------------------------------
    def trace(self, pos, d, lam, ghost=None, polygon=False, want_stop=False):
        """Trace rays (pos, d: (N,3) arrays; d unit) along the direct path or a ghost path to the image plane.
        Returns (xy at image plane (N,2), weight (N,), alive (N,) bool[, stop-plane xy of the limiting pass])."""
        pos = pos.copy(); d = d.copy()
        Nr = pos.shape[0]
        w = np.ones(Nr)
        alive = np.ones(Nr, bool)
        lamv = np.full(Nr, float(lam))
        fwd = True
        stop_xy = []
        for k, m in self.path_ops(ghost):
            s = self.surf[k]
            zv = s['z']
            if s['R'] == 0.0:
                with np.errstate(divide='ignore', invalid='ignore'):
                    t = (zv - pos[:, 2]) / d[:, 2]
                ok = t > 1e-9
                hit = pos + t[:, None] * d
                nrm = np.zeros_like(d); nrm[:, 2] = -1.0
            else:
                R = s['R']
                C = np.array([0.0, 0.0, zv + R])
                oc = pos - C
                b = np.einsum('ij,ij->i', d, oc)
                c = np.einsum('ij,ij->i', oc, oc) - R * R
                disc = b * b - c
                ok = disc > 0
                sq = np.sqrt(np.maximum(disc, 0))
                t1, t2 = -b - sq, -b + sq
                # the root on the vertex-side cap of the sphere
                cap1 = (pos[:, 2] + t1 * d[:, 2] - C[2]) * (-np.sign(R)) > 0
                cap2 = (pos[:, 2] + t2 * d[:, 2] - C[2]) * (-np.sign(R)) > 0
                t = np.where(cap1 & (t1 > 1e-9), t1, np.where(cap2 & (t2 > 1e-9), t2, np.nan))
                ok &= np.isfinite(t)
                t = np.nan_to_num(t)
                hit = pos + t[:, None] * d
                nrm = (hit - C) / R
                nrm[:, 2] *= 1.0          # (x,y,z - zc)/R: points toward -z at the vertex for either sign of R
            r2 = hit[:, 0] ** 2 + hit[:, 1] ** 2
            if s['stop'] and polygon:
                ok &= inside_polygon(hit[:, 0], hit[:, 1], self.stop_radius, self.blades)
            else:
                ok &= r2 <= s['h'] ** 2
            alive &= ok
            if s['stop']:
                stop_xy.append(hit[:, :2].copy())
            pos = hit
            # orient the normal against the ray
            cdn = np.einsum('ij,ij->i', d, nrm)
            nrm = np.where((cdn > 0)[:, None], -nrm, nrm)
            cos_i = np.abs(cdn)
            if s['stop']:
                continue
            n1 = self.n_before(k, lamv) if fwd else self.n_after(k, lamv)
            n2 = self.n_after(k, lamv) if fwd else self.n_before(k, lamv)
            Rf = self.reflectance(k, cos_i, n1, n2, lamv)
            if m == 'R':
                d = d + 2.0 * cos_i[:, None] * nrm
                w *= Rf
                fwd = not fwd
            else:
                eta = n1 / n2
                kk = 1.0 - eta ** 2 * (1.0 - cos_i ** 2)
                alive &= kk > 0
                d = eta[:, None] * d + (eta * cos_i - np.sqrt(np.maximum(kk, 0)))[:, None] * nrm
                w *= 1.0 - Rf
            d /= np.linalg.norm(d, axis=1, keepdims=True)
        # to the image plane
        with np.errstate(divide='ignore', invalid='ignore'):
            t = (self.z_img - pos[:, 2]) / d[:, 2]
        alive &= t > 0
        xy = pos[:, :2] + np.nan_to_num(t)[:, None] * d[:, :2]
        w = np.where(alive, w, 0.0)
        if want_stop:
            return xy, w, alive, stop_xy
        return xy, w, alive

    def entrance_rays(self, theta, half, n, jitter=None, centre=(0.0, 0.0)):
        """Collimated rays from a source at field angle theta (in the x-z plane) on an n x n grid of a square of
        half-width `half` (mm) on the entrance-pupil plane, around `centre` there. Returns pos, d, cell area."""
        g = (np.arange(n) + 0.5) / n * 2 - 1
        X, Y = np.meshgrid(g * half + centre[0], g * half + centre[1], indexing='ij')
        X = X.ravel(); Y = Y.ravel()
        if jitter is not None:
            X = X + (jitter.random(X.size) - 0.5) * 2 * half / n
            Y = Y + (jitter.random(Y.size) - 0.5) * 2 * half / n
        d = np.array([math.sin(theta), 0.0, math.cos(theta)])
        # points on the entrance-pupil plane (perpendicular to the axis), moved back to z = -5 along -d
        z_start = -5.0
        p = np.stack([X, Y, np.full_like(X, self.z_ep)], 1)
        tback = (p[:, 2] - z_start) / d[2]
        p = p - tback[:, None] * d
        dd = np.broadcast_to(d, p.shape).copy()
        return p, dd, (2 * half / n) ** 2 * d[2]


def fresnel(cos_i, n1, n2):
    sin2_t = (n1 / n2) ** 2 * (1.0 - cos_i ** 2)
    tir = sin2_t >= 1.0
    cos_t = np.sqrt(np.clip(1.0 - sin2_t, 0, 1))
    rs = (n1 * cos_i - n2 * cos_t) / (n1 * cos_i + n2 * cos_t)
    rp = (n2 * cos_i - n1 * cos_t) / (n2 * cos_i + n1 * cos_t)
    return np.where(tir, 1.0, 0.5 * (rs * rs + rp * rp))


def inside_polygon(x, y, radius, blades, rot=0.0):
    """Regular `blades`-gon with circumradius `radius`, one vertex at angle `rot`."""
    a = np.arctan2(y, x) - rot
    seg = 2 * np.pi / blades
    a = np.mod(a, seg) - seg / 2
    apo = radius * math.cos(math.pi / blades)
    return np.hypot(x, y) * np.cos(a) <= apo


def polygon_mask_soft(x, y, radius, blades, soft, rot=0.0):
    a = np.arctan2(y, x) - rot
    seg = 2 * np.pi / blades
    a = np.mod(a, seg) - seg / 2
    apo = radius * math.cos(math.pi / blades)
    dist = np.hypot(x, y) * np.cos(a) - apo
    return np.clip(0.5 - dist / soft, 0, 1)


# --- colour --------------------------------------------------------------------------------------------------
def cie_xyz(lam):
    """CIE 1931 2-degree colour matching functions, multi-lobe Gaussian fit (Wyman, Sloan & Shirley 2013)."""
    lam = np.asarray(lam, np.float64)

    def g(x, mu, s1, s2):
        s = np.where(x < mu, s1, s2)
        return np.exp(-0.5 * ((x - mu) / s) ** 2)
    x = 1.056 * g(lam, 599.8, 37.9, 31.0) + 0.362 * g(lam, 442.0, 16.0, 26.7) - 0.065 * g(lam, 501.1, 20.4, 26.2)
    y = 0.821 * g(lam, 568.8, 46.9, 40.5) + 0.286 * g(lam, 530.9, 16.3, 31.1)
    z = 1.217 * g(lam, 437.0, 11.8, 36.0) + 0.681 * g(lam, 459.0, 26.0, 13.8)
    return np.stack([x, y, z], -1)


XYZ_TO_SRGB = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]])


def spectral_rgb_weights(lams):
    """Per-wavelength linear-sRGB weights for a flat (equal-energy) spectrum, normalised so that the sum over the
    samples is white (1,1,1).  The renderer multiplies by the actual sun colour, so a white source maps to 1."""
    lams = np.asarray(lams, np.float64)
    rgb = cie_xyz(lams) @ XYZ_TO_SRGB.T
    tot = rgb.sum(0)
    return rgb / tot[None, :]
