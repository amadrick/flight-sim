"""Nonlinear vortex-lattice / lifting-surface reference solver (numpy only, batched over flight conditions).

What it is
----------
* Every lifting surface (wing, horizontal tail, fins) is cut into streamwise strips. Each strip carries one horseshoe
  vortex: bound segment on the local quarter-chord line (so sweep, taper, dihedral and cant are in the geometry), two
  semi-infinite trailing legs aligned with the free stream (so the wake moves relative to the tail with alpha and beta).
* Flow tangency is enforced at the three-quarter-chord point of every strip (Weissinger / Pistolesi), which reproduces
  the 2*pi*cos(sweep) section slope and the correct lift slope of swept and low-aspect-ratio planforms.
* Viscous coupling ("alpha-based decambering", van Dam 2001; Mukherjee & Gopalarathnam 2006; Gallay & Laurendeau 2015):
  every strip has a section model cl(alpha_e), cd(alpha_e), cm(alpha_e) that goes through the stall into fully
  separated flat-plate flow. The inviscid boundary condition of each strip is rotated by a decambering angle delta_i,
  iterated (under-relaxed, with a little spanwise artificial viscosity, Chattot 2004) until the circulation of the
  strip equals what its section gives at its effective angle of attack. Stall therefore starts where the local
  loading first reaches the local section limit and spreads from there: tip stall on swept / tapered wings, root
  stall on straight ones, with the matching change of downwash at the tail.
* Compressibility: Prandtl-Glauert (Goethert) stretching of the influence geometry, valid below the critical Mach number.
* Ground effect: a full mirror-image vortex system below the ground plane for any height, pitch and bank.
* Wake blanketing of the tail and fins: the dynamic-pressure deficit of the wing wake (USAF DATCOM 4.4.1 wake
  half-width and centre-line deficit, driven by the local section drag coefficient, so a stalled wing throws a wide,
  deep wake), convected along the free stream.
* Forces: Kutta-Joukowski on the bound segments with the full local velocity (near-field induced drag), plus the
  section profile / separation drag and the section pitching moment.

Axes (internal): x aft, y right, z up, origin at the moment reference (CG). Results are converted to the aerospace
body-axis convention of src/physics/aero.js: CX forward, CY right, CZ down, Cl (roll, right wing down +), Cm (nose up
+), Cn (nose right +); CL / CD in wind axes.

Everything is vectorised over B flight conditions; nothing here depends on the 16 aircraft (see planforms.py).
"""
import math
import numpy as np

PI = math.pi
DEG = PI / 180.0


# ---------------------------------------------------------------------------------------------------------------------
# geometry
# ---------------------------------------------------------------------------------------------------------------------
class Geometry:
    """Flat arrays over the N strips of an aircraft. Built by `build_geometry`."""

    def __init__(self):
        self.parts = []          # (name, kind, start, stop)

    def nstrips(self):
        return self.c.shape[0]


def _interp_sections(secs, y):
    """Linear interpolation of a section table [(y, xle, chord, z, inc_deg), ...] at span stations y (>= 0)."""
    s = np.asarray(secs, float)
    return [np.interp(y, s[:, 0], s[:, k]) for k in range(1, 5)]


def _stations(n, ytip, y0=0.0, cluster=0.3):
    k = np.arange(n + 1) / n
    eta = (1.0 - cluster) * k + cluster * np.sin(0.5 * PI * k)
    return y0 + (ytip - y0) * eta


def _strip_arrays(P1, P2, c1, c2, inc1, inc2):
    """P1/P2: leading-edge points of the two strip edges (ordered so that the bound vortex A->B is the positive span
    direction). Returns the per-strip arrays."""
    xa = np.array([1.0, 0.0, 0.0])
    A = P1 + 0.25 * c1[:, None] * xa
    B = P2 + 0.25 * c2[:, None] * xa
    c = 0.5 * (c1 + c2)
    le = 0.5 * (P1 + P2)
    BM = 0.5 * (A + B)
    CP = le + 0.75 * c[:, None] * xa
    TE = le + c[:, None] * xa
    dl = B - A
    t = np.tile(xa, (len(c), 1))
    sp = dl - (dl @ xa)[:, None] * xa               # span axis perpendicular to the chord direction
    w = np.linalg.norm(sp, axis=1)
    s = sp / w[:, None]
    n = np.cross(t, s)
    cosL = w / np.linalg.norm(dl, axis=1)
    TA = P1 + c1[:, None] * xa
    TB = P2 + c2[:, None] * xa
    return dict(A=A, B=B, TA=TA, TB=TB, BM=BM, CP=CP, TE=TE, t=t, s=s, n=n, c=c, w=w, cosL=cosL, inc=0.5 * (inc1 + inc2) * DEG)


def build_geometry(spec, n_wing=12, n_tail=6, n_fin=5):
    """spec: planform dictionary (see planforms.py). Lengths in metres, x = distance aft of the nose, z up, relative to
    spec['cg'] = (x, z) which is subtracted (the moment reference can be moved later with `shift_reference`)."""
    xcg, zcg = spec['cg']
    parts, arrs = [], []
    keys = ['A', 'B', 'TA', 'TB', 'BM', 'CP', 'TE', 't', 's', 'n', 'c', 'w', 'cosL', 'inc']
    extra = {k: [] for k in ['flap', 'ail', 'elev', 'rud', 'allmov', 'eta', 'side', 'kind']}

    def add(name, kind, d, flap=None, ail=None, elev=None, rud=None, allmov=None, eta=None, side=None):
        m = len(d['c'])
        z = np.zeros(m)
        parts.append((name, kind, sum(len(a['c']) for a in arrs), sum(len(a['c']) for a in arrs) + m))
        arrs.append(d)
        extra['flap'].append(z if flap is None else flap)
        extra['ail'].append(z if ail is None else ail)
        extra['elev'].append(z if elev is None else elev)
        extra['rud'].append(z if rud is None else rud)
        extra['allmov'].append(z if allmov is None else allmov)
        extra['eta'].append(z if eta is None else eta)
        extra['side'].append(z if side is None else side)
        extra['kind'].append(np.full(m, {'wing': 0, 'htail': 1, 'fin': 2}[kind]))

    def cover(eta_lo, eta_hi, rng):
        """Fraction of each strip [eta_lo, eta_hi] covered by a control surface spanning rng = (e0, e1)."""
        if rng is None:
            return np.zeros_like(eta_lo)
        ov = np.clip(np.minimum(eta_hi, rng[1]) - np.maximum(eta_lo, rng[0]), 0, None)
        return ov / (eta_hi - eta_lo)

    def tau(cf):
        """Thin-airfoil flap effectiveness d(alpha_L0)/d(delta) for a flap of chord fraction cf."""
        th = math.acos(2 * cf - 1)
        return 1 - (th - math.sin(th)) / PI

    def horizontal(name, kind, S):
        secs = S['sections']
        ytip = secs[-1][0]
        n = n_wing if kind == 'wing' else n_tail
        y = _stations(n, ytip, 0.0, 0.3)
        xle, ch, z, inc = _interp_sections(secs, y)
        if 'twist' in S:                                   # linear washout root -> tip added to the section incidence
            inc = inc + S['twist'] * (y / ytip)
        inc = inc + S.get('incidence', 0.0)
        Pr = np.stack([xle - xcg, y, z - zcg], 1)
        Pl = Pr * np.array([1, -1, 1])
        right = _strip_arrays(Pr[:-1], Pr[1:], ch[:-1], ch[1:], inc[:-1], inc[1:])
        left = _strip_arrays(Pl[1:][::-1], Pl[:-1][::-1], ch[1:][::-1], ch[:-1][::-1], inc[1:][::-1], inc[:-1][::-1])
        d = {k: np.concatenate([left[k], right[k]]) for k in keys}
        e_lo, e_hi = y[:-1] / ytip, y[1:] / ytip
        both = lambda a: np.concatenate([a[::-1], a])
        sgn = np.concatenate([-np.ones(n), np.ones(n)])
        fl = both(cover(e_lo, e_hi, S.get('flap')))
        al = both(cover(e_lo, e_hi, S.get('aileron', (0, 0, 0.25))[:2])) * tau(S.get('aileron', (0, 0, 0.25))[2]) * sgn
        if S.get('allMoving'):
            el = np.zeros(2 * n); am = np.ones(2 * n)
        else:
            ev = S.get('elevator')
            el = both(cover(e_lo, e_hi, ev[:2])) * tau(ev[2]) if ev else np.zeros(2 * n)
            am = np.zeros(2 * n)
        add(name, kind, d, flap=fl, ail=al, elev=el, allmov=am, eta=both(0.5 * (e_lo + e_hi)), side=sgn)

    horizontal('wing', 'wing', spec['wing'])
    if spec.get('htail'):
        horizontal('htail', 'htail', spec['htail'])
    for k, F in enumerate(spec.get('fins', [])):
        # F: root LE (x, y, z), height (along the fin), cr, ct, sweep (LE, deg), cant (deg, + = tip outboard), rudder cf
        s = _stations(n_fin, F['height'], 0.0, 0.3)
        sgn = 1.0 if F['root'][1] >= 0 else -1.0
        ck = F.get('cant', 0.0) * DEG
        ch = F['cr'] + (F['ct'] - F['cr']) * s / F['height']
        P = np.stack([F['root'][0] - xcg + s * math.tan(F['sweep'] * DEG),
                      F['root'][1] + sgn * s * math.sin(ck),
                      F['root'][2] - zcg + s * math.cos(ck)], 1)
        d = _strip_arrays(P[:-1], P[1:], ch[:-1], ch[1:], np.zeros(n_fin), np.zeros(n_fin))
        if F.get('allMoving'):
            rd = np.zeros(n_fin); am = np.ones(n_fin)
        else:
            rd = np.full(n_fin, tau(F.get('rudder', 0.28))); am = np.zeros(n_fin)
        add(f'fin{k}', 'fin', d, rud=rd, allmov=am, eta=0.5 * (s[:-1] + s[1:]) / F['height'], side=np.full(n_fin, sgn))

    g = Geometry()
    for k in keys:
        setattr(g, k, np.concatenate([a[k] for a in arrs]))
    for k in extra:
        setattr(g, k, np.concatenate(extra[k]))
    g.parts = parts
    g.kind = g.kind.astype(int)
    # elevons: wing strips that act in pitch as well
    ev = spec['wing'].get('elevon')
    if ev:
        i0, i1 = parts[0][2], parts[0][3]
        y = np.abs(g.BM[i0:i1, 1]); ytip = spec['wing']['sections'][-1][0]
        # coverage from the strip mid-points is good enough here
        inside = ((y / ytip) >= ev[0]) & ((y / ytip) <= ev[1])
        g.elev[i0:i1] = inside * tau(ev[2])
        g.ail[i0:i1] = inside * tau(ev[2]) * g.side[i0:i1]
    # neighbours for the spanwise smoothing (same part only)
    N = g.nstrips()
    g.left = np.arange(N) - 1; g.right = np.arange(N) + 1
    for (_, _, i0, i1) in parts:
        g.left[i0] = i0; g.right[i1 - 1] = i1 - 1
    # which part each strip belongs to (for the inter-surface vortex core)
    g.part = np.zeros(N, int)
    for k, (_, _, i0, i1) in enumerate(parts):
        g.part[i0:i1] = k
    # roll control by differential tailplane (the wing then has no 'aileron')
    g.dtail = np.zeros(N)
    if spec.get('roll') == 'tail':
        g.ail[:] = 0.0
        g.dtail = np.where(g.kind == 1, g.side, 0.0)
    g.Sref = spec['Sref']; g.bref = spec['bref']; g.cref = spec['cref']
    g.spec = spec
    return g


def shift_reference(g, dx, dz=0.0):
    """Move the moment reference (CG) aft by dx and up by dz."""
    for k in ['A', 'B', 'TA', 'TB', 'BM', 'CP', 'TE']:
        a = getattr(g, k); a[:, 0] -= dx; a[:, 2] -= dz


# ---------------------------------------------------------------------------------------------------------------------
# section model
# ---------------------------------------------------------------------------------------------------------------------
class Section:
    """Per-aircraft section parameters (see calibrate.py). Angles in radians."""

    def __init__(self, a_stall=15 * DEG, a_stall_neg=13 * DEG, width=2.0 * DEG, aL0=-2 * DEG, cd0=0.008, cn90=1.3,
                 tail_stall=15 * DEG, tail_width=2.5 * DEG, flap_dalpha=-12 * DEG, k_flap_stall=0.35, k_ctl_stall=0.5,
                 k_sep_ctl=0.35, mach_stall=0.45):
        self.a_stall = a_stall; self.a_stall_neg = a_stall_neg; self.width = width; self.aL0 = aL0; self.cd0 = cd0
        self.cn90 = cn90; self.tail_stall = tail_stall; self.tail_width = tail_width; self.flap_dalpha = flap_dalpha
        self.k_flap_stall = k_flap_stall; self.k_ctl_stall = k_ctl_stall; self.k_sep_ctl = k_sep_ctl
        self.mach_stall = mach_stall

    def copy(self):
        s = Section(); s.__dict__.update(self.__dict__); return s


def _sigm(x):
    return 1.0 / (1.0 + np.exp(np.clip(x, -40.0, 40.0)))


def section_coeffs(ae, a_slope, aL0, aL0_ctl, as_p, as_n, width, cd0, cn90, k_sep):
    """Viscous section model. All arguments broadcast.
    ae       effective angle of attack measured from the chord line
    a_slope  attached lift-curve slope (2 pi cos(sweep))
    aL0      zero-lift angle (camber + control deflection); aL0_ctl is its control part (acts, weakened, when separated)
    as_p/n   positive / negative stall angles (attached fraction 0.5), width = sigmoid width
    Returns cl, cd, cm (about the quarter chord), f (attached fraction 0..1)."""
    f = _sigm((ae - as_p) / width) * _sigm((-ae - as_n) / width)
    cl_att = a_slope * np.sin(ae - aL0)
    an = ae - k_sep * aL0_ctl                              # a deflected surface keeps some effect in separated flow
    sn = np.sin(an)
    cn = cn90 * sn / (0.56 + 0.44 * np.abs(sn))            # Hoerner flat-plate normal force, scaled to cn90 broadside
    cl = f * cl_att + (1.0 - f) * cn * np.cos(ae)
    cd = cd0 + 0.006 * f * cl_att * cl_att + (1.0 - f) * np.abs(cn * np.sin(ae))
    xcp = 0.075 + 0.175 * np.minimum(np.abs(ae), 0.5 * PI) / (0.5 * PI)       # centre of pressure aft of c/4, separated
    cm = 0.17 * a_slope * aL0_ctl * f - (1.0 - f) * cn * xcp
    return cl, cd, cm, f


# ---------------------------------------------------------------------------------------------------------------------
# vortex kernels
# ---------------------------------------------------------------------------------------------------------------------
def _segment(r1, r2, core2):
    """Finite straight vortex segment X1 -> X2 (unit strength, without the 1/4pi); r1 = P - X1, r2 = P - X2."""
    n1 = np.sqrt(np.einsum('bmnk,bmnk->bmn', r1, r1))
    n2 = np.sqrt(np.einsum('bmnk,bmnk->bmn', r2, r2))
    cr = np.cross(r1, r2)
    cr2 = np.einsum('bmnk,bmnk->bmn', cr, cr)
    d12 = np.einsum('bmnk,bmnk->bmn', r1, r2)
    r0 = r1 - r2
    l2 = np.einsum('bmnk,bmnk->bmn', r0, r0)
    kb = (n1 + n2) * (n1 * n2 - d12) / (n1 * n2 * (cr2 + core2 * l2) + 1e-30)
    return cr * kb[..., None], n1, n2


def horseshoe(P, A, B, TA, TB, u, core2):
    """Velocity induced at points P by unit-strength horseshoe vortices: infinity -> TA (along -u), TA -> A (chordwise
    bound leg, from the trailing edge to the quarter chord), A -> B (bound vortex on the quarter-chord line),
    B -> TB, TB -> infinity (along u, the free stream). Shapes: P (B, M, 3); A, B, TA, TB (B, N, 3) or (N, 3);
    u (B, 3); core2 (M, N) squared vortex-core radius. Returns (B, M, N, 3)."""
    ex = lambda X: X[None] if X.ndim == 2 else X
    A, B, TA, TB = ex(A), ex(B), ex(TA), ex(TB)
    c2 = core2[None]
    rA = P[:, :, None, :] - A[:, None, :, :]
    rB = P[:, :, None, :] - B[:, None, :, :]
    rTA = P[:, :, None, :] - TA[:, None, :, :]
    rTB = P[:, :, None, :] - TB[:, None, :, :]
    v, _, _ = _segment(rA, rB, c2)
    v1, nTA, _ = _segment(rTA, rA, c2)
    v2, _, nTB = _segment(rB, rTB, c2)
    v = v + v1 + v2
    uu = np.broadcast_to(u[:, None, None, :], rA.shape)
    # semi-infinite legs: perpendicular distance^2 = r^2 - (u.r)^2
    for r, nr, sg in ((rTB, nTB, 1.0), (rTA, nTA, -1.0)):
        ur = np.einsum('bmnk,bmnk->bmn', uu, r)
        d2 = np.maximum(nr * nr - ur * ur, 0.0)
        k = sg * (nr + ur) / (nr * (d2 + c2) + 1e-30)
        v = v + np.cross(uu, r) * k[..., None]
    return v / (4.0 * PI)


def trefftz(P, TA, TB, u, core2):
    """Induced velocity for the force calculation, taken from the cross-flow (Trefftz) plane: every trailing leg is
    an infinite line vortex along u seen in the plane normal to u, and the bound vortex gets half of that velocity
    (Munk's stagger theorem: the induced drag does not depend on the streamwise position of the lifting elements,
    which avoids the well-known errors of near-field Kutta-Joukowski drag on swept, kinked bound vortices).
    Shapes as in `horseshoe`; returns (B, M, N, 3)."""
    ex = lambda X: X[None] if X.ndim == 2 else X
    TA, TB = ex(TA), ex(TB)
    v = 0.0
    for S_, sg in ((TB, 1.0), (TA, -1.0)):
        r = P[:, :, None, :] - S_[:, None, :, :]
        uu = np.broadcast_to(u[:, None, None, :], r.shape)
        ur = np.einsum('bmnk,bmnk->bmn', uu, r)
        d2 = np.maximum(np.einsum('bmnk,bmnk->bmn', r, r) - ur * ur, 0.0)
        v = v + np.cross(uu, r) * (sg / (d2 + core2[None] + 1e-30))[..., None]
    return v / (4.0 * PI)


# ---------------------------------------------------------------------------------------------------------------------
# solver
# ---------------------------------------------------------------------------------------------------------------------
def _col(x, B):
    x = np.asarray(x, float)
    return np.broadcast_to(x, (B,)).copy() if x.ndim == 0 else x


def solve(g, sec, alpha, beta=0.0, mach=0.0, p=0.0, q=0.0, r=0.0, da=0.0, de=0.0, dr=0.0, flap=0.0,
          h=None, bank=0.0, iters=90, relax=0.35, visc=0.3, linear=False, wake=True, detail=False, chunk=384):
    """Solve B flight conditions.

    alpha, beta   radians (aerodynamic angles of the CG)
    p, q, r       non-dimensional body rates  p b / 2V, q c / 2V, r b / 2V  (aerospace signs)
    da, de, dr    control deflections in radians; da > 0 rolls right, de > 0 pitches up (trailing edge up),
                  dr > 0 yaws the nose right
    flap          0..1 (fraction of sec.flap_dalpha)
    h             CG height above the ground in metres (None or inf = free air); the flight path is level
    bank          bank angle in radians (right wing down +), used for the ground image only
    linear        inviscid, attached (decambering off): the classical linear VLM
    Returns a dict of arrays (B,) with CL, CD, CY, Cl, Cm, Cn, CX, CZ (+ per-strip detail when asked)."""
    alpha = np.atleast_1d(np.asarray(alpha, float)); Bn = alpha.shape[0]
    args = [_col(x, Bn) for x in (beta, mach, p, q, r, da, de, dr, flap, bank)]
    hh = np.full(Bn, np.inf) if h is None else _col(h, Bn)
    outs = []
    for i0 in range(0, Bn, chunk):
        sl = slice(i0, min(Bn, i0 + chunk))
        outs.append(_solve_chunk(g, sec, alpha[sl], *[a[sl] for a in args], hh[sl], iters, relax, visc, linear, wake, detail))
    return {k: np.concatenate([o[k] for o in outs]) for k in outs[0]}


def _solve_chunk(g, sec, alpha, beta, mach, p, q, r, da, de, dr, flap, bank, h, iters, relax, visc, linear, wake, detail):
    Bn, N = alpha.shape[0], g.nstrips()
    ca, sa, cb, sb = np.cos(alpha), np.sin(alpha), np.cos(beta), np.sin(beta)
    # free-stream direction (relative wind) in solver axes
    U = np.stack([ca * cb, -sb, sa * cb], 1)
    bpg = np.sqrt(np.maximum(1.0 - np.minimum(mach, 0.92) ** 2, 0.05))
    # Prandtl-Glauert: x' = x / beta_pg (influence geometry only)
    st = np.ones((Bn, 1, 3)); st[:, 0, 0] = 1.0 / bpg
    Us = U * st[:, 0, :]; Us /= np.linalg.norm(Us, axis=1)[:, None]
    A = g.A[None] * st; B = g.B[None] * st; TA = g.TA[None] * st; TB = g.TB[None] * st; CP = g.CP[None] * st
    BMp = np.broadcast_to(g.BM[None], (Bn, N, 3))
    # vortex cores: tight on the same surface, wide between surfaces (the wing wake is a sheet, not N filaments)
    same = g.part[:, None] == g.part[None, :]
    core = np.where(same, 0.02 * g.w[None, :], 0.6 * g.w[None, :])
    core2 = core * core
    Vcp = horseshoe(CP, A, B, TA, TB, Us, core2)
    Vbm = trefftz(BMp, g.TA, g.TB, U, core2)              # physical cross-flow plane
    ground = np.isfinite(h)
    if ground.any():
        # mirror-image system below the ground plane (level flight path: the free stream is parallel to the ground)
        th = np.arctan(np.cos(bank) * np.tan(alpha))
        up = np.stack([-np.sin(th), -np.sin(bank) * np.cos(th), np.cos(bank) * np.cos(th)], 1)      # world up in body axes
        hs = np.where(ground, h, 1e9)

        def mirror(X):                                    # physical coordinates
            Pt = np.broadcast_to(X[None], (Bn, N, 3))
            d = np.einsum('bnk,bk->bn', Pt, up) + hs[:, None]
            return Pt - 2.0 * d[..., None] * up[:, None, :]
        Ai, Bi, TAi, TBi = mirror(g.A), mirror(g.B), mirror(g.TA), mirror(g.TB)
        Ui = U - 2.0 * np.einsum('bk,bk->b', U, up)[:, None] * up
        Uis = Ui * st[:, 0, :]; Uis /= np.linalg.norm(Uis, axis=1)[:, None]
        tight = np.broadcast_to((0.02 * g.w[None, :]) ** 2, core2.shape)
        gm = ground[:, None, None, None]
        Vcp = Vcp - np.where(gm, horseshoe(CP, Ai * st, Bi * st, TAi * st, TBi * st, Uis, tight), 0.0)
        Vbm = Vbm - np.where(gm, trefftz(BMp, TAi, TBi, Ui, tight), 0.0)
    # back to physical perturbation velocities: (u, v, w) = (u'/beta, v', w')
    Vcp[..., 0] /= bpg[:, None, None]

    # onset velocity (unit free stream + body rotation); omega in solver axes = (-p, q, -r) scaled to rad per (V/m)
    om = np.stack([-p * 2.0 / g.bref, q * 2.0 / g.cref, -r * 2.0 / g.bref], 1)
    Vo_cp = U[:, None, :] - np.cross(om[:, None, :], g.CP[None])
    Vo_bm = U[:, None, :] - np.cross(om[:, None, :], g.BM[None])

    # section set-up -------------------------------------------------------------------------------------------------
    wing = g.kind == 0
    tailfin = ~wing
    # control part of the zero-lift angle: flaps / ailerons / elevator / rudder (plain surfaces lose effectiveness
    # beyond ~12 deg of deflection)
    def eff(d):
        ad = np.abs(d)
        return d * (1.0 - 0.35 * np.clip((ad - 12 * DEG) / (25 * DEG), 0.0, 1.0))
    a_flap = g.flap[None] * (flap[:, None] * sec.flap_dalpha)        # trailing-edge flaps (zero-lift angle shift)
    # ailerons (da > 0: right trailing edge up), elevator / elevons (de > 0: trailing edge up), rudder (dr > 0: nose right)
    a_other = g.ail[None] * eff(da)[:, None] + g.elev[None] * eff(de)[:, None] - g.rud[None] * eff(dr)[:, None]
    aL0_ctl = a_flap + a_other
    camber = np.where(wing, sec.aL0, 0.0)[None]
    aL0 = camber + aL0_ctl
    # all-moving surfaces: incidence changes (stabilator leading edge down for nose-up; all-moving fin acts like a rudder)
    inc = g.inc[None] + g.allmov[None] * (np.where(g.kind == 1, 1.0, 0.0)[None] * -de[:, None] + np.where(g.kind == 2, 1.0, 0.0)[None] * dr[:, None]) \
        - g.dtail[None] * da[:, None]
    a_slope = 2.0 * PI * g.cosL[None]
    mfac = 1.0 - sec.mach_stall * np.clip((mach - 0.25) / 0.65, 0.0, 1.0)[:, None] ** 1.5
    kst = sec.k_flap_stall * a_flap + sec.k_ctl_stall * a_other      # a trailing edge going down lowers the stall angle
    as_p = np.where(wing, sec.a_stall, sec.tail_stall)[None] * mfac + kst
    as_n = np.where(wing, sec.a_stall_neg, sec.tail_stall)[None] * mfac - kst
    as_p = np.maximum(as_p, 2 * DEG); as_n = np.maximum(as_n, 2 * DEG)
    width = np.where(wing, sec.width, sec.tail_width)[None]
    cd0 = sec.cd0

    # section-plane onset flow at the control points
    Vt = np.einsum('bnk,nk->bn', Vo_cp, g.t); Vn = np.einsum('bnk,nk->bn', Vo_cp, g.n)
    Vsec = np.sqrt(Vt * Vt + Vn * Vn)

    Wn_n = np.einsum('bmnk,mk->bmn', Vcp, g.n)           # induced velocity normal to the chord plane, per unit circulation

    # wake blanketing geometry (targets: tail + fin strips, sources: wing strips) ---------------------------------
    use_wake = wake and tailfin.any() and not linear
    if use_wake:
        ti = np.where(tailfin)[0]; wi = np.where(wing)[0]
        ey = g.s[wi][None] - np.einsum('nk,bk->bn', g.s[wi], U)[..., None] * U[:, None, :]
        ey /= np.linalg.norm(ey, axis=2)[..., None]
        ez = np.cross(np.broadcast_to(U[:, None, :], ey.shape), ey)
        d = g.BM[ti][None, :, None, :] - g.TE[wi][None, None, :, :]            # (1, T, W, 3)
        xw = np.einsum('btwk,bk->btw', np.broadcast_to(d, (Bn,) + d.shape[1:]), U)
        yw = np.einsum('btwk,bwk->btw', np.broadcast_to(d, (Bn,) + d.shape[1:]), ey)
        zw = np.einsum('btwk,bwk->btw', np.broadcast_to(d, (Bn,) + d.shape[1:]), ez)
        lat = np.clip(1.0 - np.abs(yw) / g.w[wi][None, None, :], 0.0, 1.0)
        xc = np.maximum(xw, 0.0) / g.c[wi][None, None, :]
        behind = (xw > 0.0)

    # nonlinear iteration ---------------------------------------------------------------------------------------------
    # Tangency with the decambered zero-lift line pitched up by th above the chord plane, using the induced velocity
    # normal to the chord plane (the usual VLM boundary condition):   sum_j G_j (v_ij . n_i) = -(Vn_i + Vt_i tan th_i)
    # so the influence matrix is fixed and each iteration is one matrix-vector product. In two dimensions this gives
    # cl = a sin(alpha_loc + th) / cos(th), which is inverted below for the effective angle of attack.
    Ainv = np.linalg.inv(Wn_n)
    delta = np.zeros((Bn, N))
    qr = np.ones((Bn, N))
    TH = 80.0 * DEG
    n_it = 1 if linear else iters
    for it in range(n_it):
        th = np.clip(inc - aL0 - delta, -TH, TH)          # pitch of the (decambered) zero-lift line above the chord plane
        rhs = -(Vn + Vt * np.tan(th))
        G = np.einsum('bij,bj->bi', Ainv, rhs)
        if linear:
            break
        cl_inv = 2.0 * G / (Vsec * g.c[None])
        x = np.clip(cl_inv / a_slope * np.cos(th), -1.0, 1.0)
        ae = np.arcsin(x) - th + inc                      # effective angle of attack from the chord line
        cl_v, cd_v, cm_v, f = section_coeffs(ae, a_slope, aL0, aL0_ctl, as_p, as_n, width, cd0, sec.cn90, sec.k_sep_ctl)
        if use_wake:
            cdw = cd_v[:, wi]; fw = f[:, wi]; aw = np.abs(np.sin(ae[:, wi]))
            cw = g.c[wi][None, None, :]
            half = 0.68 * cw * np.sqrt(cdw[:, None, :] * (xc + 0.15)) + 0.5 * (1.0 - fw[:, None, :]) * cw * aw[:, None, :]
            dq0 = np.minimum(0.9, 2.42 * np.sqrt(cdw[:, None, :]) / (xc + 0.30))
            zc = zw - 0.5 * (1.0 - fw[:, None, :]) * cw * np.sin(ae[:, wi])[:, None, :]       # wake centre between the shear layers
            prof = np.cos(0.5 * PI * np.clip(np.abs(zc) / half, 0.0, 1.0)) ** 2
            dq = np.sum(dq0 * prof * lat * behind, axis=2)
            qn = np.clip(1.0 - dq, 0.1, 1.0)
            qr[:, ti] += 0.5 * (qn - qr[:, ti])
        # decambering that makes the inviscid strip carry the viscous section lift at this effective angle
        tgt = np.clip(cl_v * qr / a_slope, -0.999, 0.999)
        aloc = ae - inc                                   # flow angle relative to the chord plane
        th_new = np.arctan2(tgt - np.sin(aloc), np.cos(aloc))          # solves sin(aloc + th) / cos(th) = tgt
        dnew = inc - aL0 - th_new
        delta = delta + relax * (dnew - delta)
        if visc > 0:
            delta = delta + visc * (delta[:, g.left] - 2.0 * delta + delta[:, g.right])

    # forces -----------------------------------------------------------------------------------------------------------
    if linear:
        ae = np.zeros((Bn, N)); cd_v = np.zeros((Bn, N)); cm_v = np.zeros((Bn, N)); f = np.ones((Bn, N)); cl_v = 2.0 * G / (Vsec * g.c[None])
    Vtot = Vo_bm + np.einsum('bmnk,bn->bmk', Vbm, G)
    dl = (g.B - g.A)[None]
    F = np.cross(Vtot, np.broadcast_to(dl, Vtot.shape)) * G[..., None] * 2.0            # / (0.5 rho V^2): rho G V x dl
    Vs_bm = Vo_bm - np.einsum('bnk,nk->bn', Vo_bm, g.s)[..., None] * g.s[None]
    q_loc = np.einsum('bnk,bnk->bn', Vs_bm, Vs_bm) * qr
    vdir = Vtot / np.linalg.norm(Vtot, axis=2)[..., None]
    area = (g.c * g.w)[None]
    F = F + vdir * (cd_v * q_loc * area)[..., None]
    Mom = np.cross(np.broadcast_to(g.BM[None], F.shape), F)
    # chordwise bound legs (trailing edge -> quarter chord and back): they carry load when the onset flow crosses them
    # (sideslip, yaw rate): the tip-edge part of the dihedral effect and of the roll / yaw cross derivatives
    for X1, X2 in ((g.TA, g.A), (g.B, g.TB)):
        mid = 0.5 * (X1 + X2)
        Vm = U[:, None, :] - np.cross(om[:, None, :], mid[None])
        Fl = np.cross(Vm, np.broadcast_to((X2 - X1)[None], Vm.shape)) * G[..., None] * 2.0
        F = F + Fl
        Mom = Mom + np.cross(np.broadcast_to(mid[None], Fl.shape), Fl)
    # section pitching moment: nose-up turns the chord vector t towards -n, i.e. a rotation about +s
    Mom = Mom + g.s[None] * (cm_v * q_loc * area * g.c[None])[..., None]
    Ft = F.sum(1); Mt = Mom.sum(1)
    S, b, c = g.Sref, g.bref, g.cref
    CX = -Ft[:, 0] / S; CY = Ft[:, 1] / S; CZ = -Ft[:, 2] / S
    out = dict(CX=CX, CY=CY, CZ=CZ,
               Cl=-Mt[:, 0] / (S * b), Cm=Mt[:, 1] / (S * c), Cn=-Mt[:, 2] / (S * b))
    # wind axes
    D = np.einsum('bk,bk->b', Ft, U) / S
    lift_dir = np.stack([-sa, np.zeros(Bn), ca], 1)
    out['CL'] = np.einsum('bk,bk->b', Ft, lift_dir) / S
    out['CD'] = D
    if detail:
        out['G'] = G; out['f'] = f; out['ae'] = ae; out['cl'] = cl_v; out['qr'] = qr; out['delta'] = delta
        out['Fz'] = F[:, :, 2] / area
        # downwash angle at the strips (from the normal velocity induced at the bound mid-points)
        wi_n = np.einsum('bnk,nk->bn', Vtot - Vo_bm, g.n)
        out['eps'] = -wi_n
    return out
