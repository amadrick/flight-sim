"""Ground-truth comparison of the real-time clouds: shared pieces (numpy only, no numba / torch).

    gt_common.py   fields exported from the real cloud GLSL, the test cases (sun, sky, ground, camera), sun optical
                   depth on a sun-sheared lattice, image helpers
    gt_trace.py    reference: Monte Carlo path tracer (all orders, sky + ground light), exact single scattering
    gt_march.py    numpy port of the real-time march + lighting (src/clouds/shaders.js) with a choice of scatter model
    gt_compare.py  error tables and side-by-side images

Fields come from the clouds dev harness (src/clouds/harness.js, sim.exportDensity): the density GLSL of the march
sampled on a regular grid, so the path tracer renders exactly the clouds the game renders.

Conventions (as in the game): metres, +y up, x/z horizontal.  The sun azimuth is always +x (sun toward +x) so the
sun-sheared lattice only shears along x.  Light units: sun irradiance E_sun (RGB, on a plane facing the sun), sky
radiance L_sky(dir) (RGB).  Radiance in the images is in the same units.
"""
import json
import math
import os
import base64

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'gt_data')

import phase as ph  # noqa: E402  (numba optional)

W_D = ph.W_D
GROUND_ALBEDO = np.array([0.13, 0.12, 0.09])


# ------------------------------------------------------------------------------------------------ fields
class Field:
    """Density grid exported from the game.  Arrays are indexed [a (x), b (z), c (altitude)]."""

    def __init__(self, name):
        p = os.path.join(DATA, name + '.npz')
        if not os.path.exists(p):
            convert_export(name)
        z = np.load(p, allow_pickle=False)
        self.name = name
        self.full = z['full'].astype(np.float32) / 255.0          # with detail erosion (what the march sees)
        self.base = z['base8'].astype(np.float32) / 255.0         # cheap base density (light march / shadow map)
        self.ex = z['ex8'].astype(np.float32) / 127.5 - 0.5 if 'ex8' in z.files else None   # shape excess
        self.top2d = z['top2d'].astype(np.float32)               # info.y per column (local nominal cloud top, m)
        meta = json.loads(str(z['meta']))
        self.meta = meta
        self.nx, self.ny, self.nz = meta['nx'], meta['ny'], meta['nz']
        self.dx, self.dz = meta['dx'], meta['dz']
        self.base_alt, self.top_alt = meta['base'], meta['top']
        self.sigma = meta['sigma']                               # extinction at density 1 (1/m)
        # local frame: box centred on x = z = 0
        self.x0 = -0.5 * self.nx * self.dx
        self.z0 = -0.5 * self.ny * self.dx

    @property
    def extent(self):
        return (self.x0, self.x0 + self.nx * self.dx, self.base_alt, self.top_alt, self.z0, self.z0 + self.ny * self.dx)


def convert_export(name):
    """gt_data/export_<name>.txt (stdout of tools/shot.mjs --eval sim.exportDensity(...)) -> gt_data/<name>.npz"""
    txt = open(os.path.join(DATA, 'export_' + name + '.txt')).read()
    line = [ln for ln in txt.splitlines() if ln.startswith('eval: ')][0][6:]
    d = json.loads(json.loads(line)) if line.startswith('"') else json.loads(line)
    nx, ny, nz = d['nx'], d['ny'], d['nz']

    def grid(key):
        a = np.frombuffer(base64.b64decode(d[key]), dtype=np.uint8).reshape(nz, ny, nx)   # [c, b, a]
        return np.ascontiguousarray(a.transpose(2, 1, 0))                                  # [a, b, c]
    top = np.frombuffer(base64.b64decode(d['top2d']), dtype=np.uint16).reshape(ny, nx).T
    meta = {k: d[k] for k in ('nx', 'ny', 'nz', 'dx', 'dz', 'x0', 'z0', 'base', 'top', 'sigma', 'erosion', 'pick', 'params')}
    extra = {'ex8': grid('ex8')} if 'ex8' in d else {}
    np.savez_compressed(os.path.join(DATA, name + '.npz'), full=grid('full'), base8=grid('base8'), top2d=top, **extra,
                        meta=json.dumps(meta))


# ------------------------------------------------------------------------------------------------ sky / sun / cases
def sun_dir(elev_deg):
    e = math.radians(elev_deg)
    return np.array([math.cos(e), math.sin(e), 0.0])


class Sky:
    """Simple analytic clear sky (RGB radiance) around a sun at +x: zenith/horizon gradient + a soft circumsolar
    brightening.  The real-time march only sees its cosine-weighted mean (atmAmbient(up) = irradiance / pi)."""

    def __init__(self, zenith, horizon, sun, circ=0.6):
        self.zen = np.asarray(zenith, float)
        self.hor = np.asarray(horizon, float)
        self.sun = np.asarray(sun, float)
        self.circ = circ
        self.amb_up = self._cos_mean()

    def radiance(self, d):
        """d (N,3) unit vectors with d.y > 0 (below the horizon: the horizon value, it is never used there)."""
        dy = np.clip(d[:, 1], 0.0, 1.0)
        h = (1.0 - dy) ** 3
        base = self.zen[None, :] * (1.0 - h[:, None]) + self.hor[None, :] * h[:, None]
        cs = d @ self.sun
        boost = 1.0 + self.circ * np.exp((cs - 1.0) / 0.08)
        return base * boost[:, None]

    def _cos_mean(self, n=200000):
        rng = np.random.default_rng(5)
        u1, u2 = rng.random(n), rng.random(n)
        r = np.sqrt(u1)
        d = np.stack([r * np.cos(2 * np.pi * u2), np.sqrt(1 - u1), r * np.sin(2 * np.pi * u2)], 1)
        return self.radiance(d).mean(0)          # cosine-weighted mean radiance = irradiance / pi


def make_case(name, field):
    """Sun, sky, ground and camera of one comparison case (camera placed relative to the field's box)."""
    b, t = field.base_alt, field.top_alt
    half = 0.5 * field.nx * field.dx
    if name.startswith('g_'):
        # generic training view: g_<sun elevation>_<camera azimuth from the sun side, deg>_<altitude>_<pitch>
        el, az, alt, pitch = (float(v) for v in name[2:].split('_'))
        k = np.clip((el - 2.5) / 60.0, 0, 1) ** 0.5
        E = np.array([1.0, 0.55 + 0.45 * k, 0.25 + 0.75 * k]) * (0.4 + 0.6 * k)
        sky = Sky(np.array([0.02, 0.035, 0.08]) * (1 - k) + np.array([0.045, 0.085, 0.19]) * k,
                  np.array([0.10, 0.075, 0.055]) * (1 - k) + np.array([0.13, 0.155, 0.19]) * k, sun_dir(el), circ=2.0 - 1.4 * k)
        a = math.radians(az)
        r = half + 2600.0
        cam = np.array([r * math.cos(a), alt, r * math.sin(a)])
        yaw = math.degrees(math.atan2(-cam[2], -cam[0]))
        return dict(name=name, L=sun_dir(el), E=E, sky=sky, cam=cam, yaw=yaw, pitch=pitch, fov=60.0, elev=el)
    if name in ('noon_above', 'noon_below', 'noon_side'):
        elev, E = 65.0, np.array([1.0, 1.0, 1.0])
        sky = Sky([0.045, 0.085, 0.19], [0.13, 0.155, 0.19], sun_dir(elev))
    elif name in ('low_toward', 'low_away'):
        elev, E = 8.0, np.array([1.0, 0.80, 0.58]) * 0.75
        sky = Sky([0.03, 0.055, 0.12], [0.11, 0.105, 0.10], sun_dir(elev), circ=1.5)
    elif name in ('sunset_base',):
        elev, E = 2.5, np.array([1.0, 0.55, 0.25]) * 0.4
        sky = Sky([0.02, 0.035, 0.08], [0.10, 0.075, 0.055], sun_dir(elev), circ=2.0)
    else:
        raise KeyError(name)
    L = sun_dir(elev)
    if name == 'noon_above':        # above the layer, looking down at the cumulus field from the anti-sun side
        cam, yaw, pitch = np.array([-300.0, t + 1500.0, -half - 1800.0]), 90.0, -24.0
    elif name == 'noon_side':
        cam, yaw, pitch = np.array([-half - 6500.0, 0.5 * (b + t), 0.0]), 0.0, 3.0
    elif name == 'noon_below':      # below the base, looking up
        cam, yaw, pitch = np.array([0.0, 400.0, -half - 600.0]), 90.0, 26.0
    elif name == 'low_toward':      # looking toward the low sun (sun at +x)
        cam, yaw, pitch = np.array([-half - 2200.0, 0.5 * (b + t) + 200.0, 300.0]), 0.0, 3.0
    elif name == 'low_away':        # sun behind the camera
        cam, yaw, pitch = np.array([half + 2200.0, 0.5 * (b + t) + 200.0, 300.0]), 180.0, 3.0
    elif name == 'sunset_base':     # below the base, looking up and toward the setting sun
        cam, yaw, pitch = np.array([-half - 2500.0, 500.0, 0.0]), 0.0, 16.0
    return dict(name=name, L=L, E=E, sky=sky, cam=cam, yaw=yaw, pitch=pitch, fov=60.0, elev=elev)


def camera_rays(case, W, H, jitter=None):
    """Unit ray directions (H*W, 3).  yaw 0 = looking along +x (toward the sun), 90 = +z; pitch up positive."""
    yaw, pitch = math.radians(case['yaw']), math.radians(case['pitch'])
    fwd = np.array([math.cos(pitch) * math.cos(yaw), math.sin(pitch), math.cos(pitch) * math.sin(yaw)])
    right = np.array([-math.sin(yaw), 0.0, math.cos(yaw)])
    up = np.cross(right, fwd)
    th = math.tan(math.radians(case['fov']) / 2)
    jx, jy = (0.5, 0.5) if jitter is None else jitter
    if np.ndim(jx) == 0:
        ii, jj = np.meshgrid(np.arange(W) + jx, np.arange(H) + jy)
    else:
        ii = np.tile(np.arange(W), H) + jx
        jj = np.repeat(np.arange(H), W) + jy
    sx = (2 * ii.ravel() / W - 1) * th * W / H
    sy = (1 - 2 * jj.ravel() / H) * th
    d = fwd[None] + sx[:, None] * right[None] + sy[:, None] * up[None]
    return d / np.linalg.norm(d, axis=1, keepdims=True)


def box_interval(o, d, ext):
    """Slab test against the field box; o (3,) or (N,3), d (N,3). Returns t0, t1 (t1 <= t0: miss)."""
    lo = np.array([ext[0], ext[2], ext[4]])
    hi = np.array([ext[1], ext[3], ext[5]])
    with np.errstate(divide='ignore', invalid='ignore'):
        inv = 1.0 / np.where(np.abs(d) < 1e-12, 1e-12, d)
        ta = (lo - o) * inv
        tb = (hi - o) * inv
    t0 = np.max(np.minimum(ta, tb), axis=1)
    t1 = np.min(np.maximum(ta, tb), axis=1)
    return np.maximum(t0, 0.0), t1


# ------------------------------------------------------------------------------------------------ sun optical depth
class SunDepth:
    """Optical depth from any point toward the sun (at +x, elevation e) through a density grid, on a lattice sheared
    along the sun direction: for each altitude layer c the row is resampled at x + (c - c_ref) * shift once (one
    linear interpolation) and the optical depth is an exact cumulative sum along c."""

    def __init__(self, field, dens, sigma, L):
        self.f = field
        nx, ny, nz = dens.shape
        self.Ly = L[1]
        self.slope = L[0] / L[1]                              # horizontal metres per metre of altitude
        self.sh = field.dz / field.dx * self.slope            # cells of x per layer
        self.pad = int(math.ceil(self.sh * nz)) + 2
        na = nx + self.pad
        c = np.arange(nz)
        # sheared column a' (index ap = a' + pad) of layer c samples original x index a = a' + c * sh
        ap = np.arange(na) - self.pad
        a = ap[:, None] + c[None, :] * self.sh                 # (na, nz)
        a0 = np.floor(a).astype(int)
        fa = (a - a0).astype(np.float32)
        sig = dens.astype(np.float32) * sigma
        sh_s = np.zeros((na, ny, nz), np.float32)
        for k in range(nz):
            i0 = a0[:, k]
            ok0 = (i0 >= 0) & (i0 < nx)
            ok1 = (i0 + 1 >= 0) & (i0 + 1 < nx)
            v0 = np.where(ok0[:, None], sig[np.clip(i0, 0, nx - 1), :, k], 0.0)
            v1 = np.where(ok1[:, None], sig[np.clip(i0 + 1, 0, nx - 1), :, k], 0.0)
            sh_s[:, :, k] = v0 * (1 - fa[:, k, None]) + v1 * fa[:, k, None]
        ds = field.dz / self.Ly                                 # path length per layer
        # tau at the cell centre: half of its own layer + everything above
        cum = np.cumsum(sh_s[:, :, ::-1], axis=2)[:, :, ::-1]
        self.tau = (cum - 0.5 * sh_s) * ds                      # (na, ny, nz)
        self.tau_base = cum[:, :, 0] * ds                       # at the base plane (y = base)
        self.na, self.ny_, self.nz_ = na, ny, nz

    def lookup(self, p):
        """p (N,3) world points -> optical depth toward the sun (trilinear on the sheared lattice)."""
        f = self.f
        c = (p[:, 1] - f.base_alt) / f.dz - 0.5
        a = (p[:, 0] - f.x0) / f.dx - 0.5
        b = (p[:, 2] - f.z0) / f.dx - 0.5
        out = np.zeros(len(p), np.float32)
        above = c > self.nz_ - 0.5
        below = c < -0.5
        cc = np.clip(c, 0.0, self.nz_ - 1.0)
        # below the box: follow the sun ray up to the base plane first
        a_b = np.where(below, a + (f.base_alt - p[:, 1]) * self.slope / f.dx, a)
        ap = a_b - cc * self.sh + self.pad
        inside = (~above) & (ap > -1) & (ap < self.na) & (b > -1) & (b < self.ny_)
        if not inside.any():
            return out
        ap, bb, cc, bl = ap[inside], b[inside], cc[inside], below[inside]
        i0 = np.floor(ap).astype(int); fi = ap - i0
        j0 = np.floor(bb).astype(int); fj = bb - j0
        k0 = np.minimum(np.floor(cc).astype(int), self.nz_ - 2); fk = cc - k0
        T = self.tau
        acc = np.zeros(len(ap), np.float32)
        for di in (0, 1):
            ii = i0 + di; wi = fi if di else 1 - fi; oki = (ii >= 0) & (ii < self.na); ii = np.clip(ii, 0, self.na - 1)
            for dj in (0, 1):
                jj = j0 + dj; wj = fj if dj else 1 - fj; okj = (jj >= 0) & (jj < self.ny_); jj = np.clip(jj, 0, self.ny_ - 1)
                w = wi * wj * oki * okj
                if bl.any() or True:
                    vb = self.tau_base[ii, jj]
                v = (T[ii, jj, k0] * (1 - fk) + T[ii, jj, k0 + 1] * fk)
                acc += w * np.where(bl, vb, v)
        out[inside] = acc
        return out


# ------------------------------------------------------------------------------------------------ images
def tonemap(rgb, exposure):
    x = np.maximum(rgb * exposure, 0)
    y = np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)
    return (np.power(y, 1 / 2.2) * 255 + 0.5).astype(np.uint8)


def save_png(path, img_u8):
    from PIL import Image
    Image.fromarray(img_u8).save(path)


def luminance(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
