"""Spectral Monte Carlo path tracer of the Earth's atmosphere (numpy, vectorised over paths).

Backward paths from the camera, all orders of scattering, spherical shell geometry, Rayleigh + aerosol + ozone,
Lambertian ground, the planet's shadow (twilight) and a finite solar disc at the shadow edge. 30 wavelengths are carried
along every path (one shared geometric path, per-wavelength throughput: spectral tracking with a single sampling pdf).

Estimators ('expected value' path tracing, unbiased with respect to the per-segment quadrature):
  * every path segment (camera ray, then each scattered ray) is cut into K quadrature nodes; the in-scattered sunlight
    along the whole segment is accumulated deterministically with next-event estimation to the sun at every node
    (sun transmittance from a column-density table, exact up to interpolation). The single-scattering sky is
    therefore noise free; multiple scattering is a Monte Carlo sum.
  * the path continues from one node chosen proportionally to (transmittance x scattering) or from the ground
    (Lambertian bounce, with its own NEE to the sun), with a new direction drawn from the local phase-function
    mixture (Rayleigh / aerosol, weight = true spectral phase / sampling pdf); Russian roulette after 3 bounces.
Outputs per sample: spectral radiance per unit extraterrestrial solar irradiance (sr^-1), total and the parts that
are single scattering and single scattering by the narrow diffraction lobe (the aureole), and Cm, the aerosol
single-scattering column along the camera ray (Lpeak = phase_peak(cosTheta) * Cm).
"""
import math
import numpy as np
import common as C


def _frame(d):
    """Orthonormal basis (t, b) perpendicular to unit vectors d (N,3)."""
    a = np.where(np.abs(d[:, 1:2]) < 0.9, np.array([[0.0, 1.0, 0.0]]), np.array([[1.0, 0.0, 0.0]]))
    t = np.cross(a, d)
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    b = np.cross(d, t)
    return t, b


def _rotate(d, cos_t, phi):
    t, b = _frame(d)
    s = np.sqrt(np.maximum(1 - cos_t * cos_t, 0))[:, None]
    out = d * cos_t[:, None] + s * (np.cos(phi)[:, None] * t + np.sin(phi)[:, None] * b)
    return out / np.linalg.norm(out, axis=1, keepdims=True)


def _segment(p, d, s, mie, K, spacing, tab):
    """Quadrature along the ray p + t d up to the ground or the top of the atmosphere.
    Returns a dict with nodes, transmittances, scattering coefficients, sun transmittance and the end point."""
    r = np.linalg.norm(p, axis=1)
    h = r - C.RG
    mu = np.einsum('ij,ij->i', p, d) / r
    tg = C.dist_to_ground(h, mu)
    hit = tg >= 0
    tend = np.where(hit, tg, C.dist_to_top(h, mu))
    u = (np.arange(K) + 0.5) / K
    if spacing == 'quad':
        t = tend[:, None] * u[None, :] ** 2
        w = tend[:, None] * (2 * u[None, :] / K)
    else:
        t = tend[:, None] * (0.5 * (u + u * u))[None, :]
        w = tend[:, None] * ((0.5 + u) / K)[None, :]
    hs = C.altitude_at(h[:, None], mu[:, None], t)
    dR, dM, dO = C.dens_r(hs), C.dens_m(hs), C.dens_o(hs)
    mie_s = (mie * C.MIE_SSA)[:, None]
    ext = (dR[..., None] * C.BETA_R + (mie[:, None] * dM)[..., None] + dO[..., None] * C.BETA_O).astype(np.float32)
    ew = ext * w[..., None].astype(np.float32)
    tau = np.cumsum(ew, axis=1) - 0.5 * ew
    T = np.exp(-tau)
    T_end = np.exp(-ew.sum(axis=1))
    # sun: local cos zenith of the sun at every node
    pn = p[:, None, :] + t[..., None] * d[:, None, :]
    rn = np.linalg.norm(pn, axis=2)
    mus = np.einsum('nkj,j->nk', pn, s) / rn if s.ndim == 1 else np.einsum('nkj,nj->nk', pn, s) / rn
    D, vis = tab.lookup(hs, mus)
    Ts = (np.exp(-C.spectral_optical_depth(D, mie[:, None] * np.ones_like(hs))) * vis[..., None]).astype(np.float32)
    sR = (dR[..., None] * C.BETA_R).astype(np.float32)             # (N,K,NL)
    sM = (mie_s * dM).astype(np.float32)                           # (N,K)
    return dict(t=t, w=w.astype(np.float32), T=T, T_end=T_end, Ts=Ts, sR=sR, sM=sM, hit=hit, tend=tend,
                pend=p + tend[:, None] * d, dR=dR, dM=dM)


def trace(h0, d0, s, mie, n_paths, rng, K0=128, K=48, max_orders=12, tab=None):
    """Radiance for N camera samples, n_paths paths each.
    h0 (N,) camera altitude km, d0 (N,3) unit view dirs (+y up at the camera), s (N,3) unit sun dirs, mie (N,) 1/km.
    Returns dict of arrays (N, NL): L (all orders), L1 (single scattering), Lpeak (single scattering, aureole lobe)."""
    tab = tab or C.column_table()
    N = len(h0)
    L = np.zeros((N, C.NL))
    L1 = np.zeros((N, C.NL))
    Lp = np.zeros((N, C.NL))
    Cm = None
    s = np.asarray(s, np.float64)
    p0 = np.stack([np.zeros(N), C.RG + np.maximum(h0, 1e-4), np.zeros(N)], axis=1)
    # --- first segment: shared by all paths of a sample (deterministic single scattering)
    seg = _segment(p0, d0, s, mie, K0, 'quad', tab)
    cos0 = np.einsum('ij,ij->i', d0, s)
    pR = C.phase_r(cos0)[:, None, None]
    pM = C.phase_mie(cos0)[:, None, None]
    pP = C.phase_peak(cos0)[:, None, None]
    TwTs = seg['T'] * seg['w'][..., None] * seg['Ts']
    L1 += (TwTs * (seg['sR'] * pR + seg['sM'][..., None] * pM)).sum(axis=1)
    Cm = (TwTs * seg['sM'][..., None]).sum(axis=1)
    Lp += Cm * pP[:, 0]
    L1 += _ground_nee(seg, s, tab, mie)
    if n_paths <= 0:
        return dict(L=L1.copy(), L1=L1, Lpeak=Lp, Cm=Cm)
    # --- replicate for paths
    rep = lambda a: np.repeat(a, n_paths, axis=0)
    idx = np.repeat(np.arange(N), n_paths)
    beta = np.ones((N * n_paths, C.NL), np.float32)
    ss = rep(s)
    mm = rep(mie)
    p, d = rep(p0), rep(d0)
    segs = {k: rep(v) for k, v in seg.items()}
    Lms = np.zeros((N * n_paths, C.NL))
    for order in range(1, max_orders + 1):
        if order > 1:
            # NEE of this segment (orders >= 2)
            cosn = np.einsum('ij,ij->i', d, ss)
            pR = C.phase_r(cosn)[:, None, None]
            pM = C.phase_mie(cosn)[:, None, None]
            contrib = (segs['T'] * segs['w'][..., None] * segs['Ts'] * (segs['sR'] * pR + segs['sM'][..., None] * pM)).sum(axis=1)
            contrib += _ground_nee(segs, ss, tab, mm)
            Lms[alive_idx] += beta * contrib
        else:
            alive_idx = np.arange(N * n_paths)
        # --- continuation
        n = len(alive_idx)
        m = (segs['T'] * (segs['sR'] + segs['sM'][..., None])).mean(axis=2) * segs['w']      # (n,K)
        S = m.sum(axis=1)
        G = np.where(segs['hit'], segs['T_end'].mean(axis=1) * C.GROUND_ALBEDO, 0.0)
        tot = S + G
        ok = tot > 1e-12
        u = rng.random(n)
        go_ground = ok & (u * tot < G)
        go_atm = ok & ~go_ground
        new_beta = beta.copy()
        new_p = p.copy()
        new_d = d.copy()
        # atmosphere: choose node
        cm = np.cumsum(m, axis=1)
        target = (rng.random(n) * S)[:, None]
        k = np.minimum((cm < target).sum(axis=1), m.shape[1] - 1)
        ia = np.nonzero(go_atm)[0]
        if len(ia):
            ka = k[ia]
            tk = segs['t'][ia, ka]
            pa = p[ia] + tk[:, None] * d[ia]
            # mixture pdf: a Rayleigh + (1-a) aerosol
            sRk = segs['sR'][ia, ka]               # (na, NL)
            sMk = segs['sM'][ia, ka]               # (na,)
            a = sRk.mean(axis=1) / (sRk.mean(axis=1) + sMk + 1e-30)
            useR = rng.random(len(ia)) < a
            u1, u2 = rng.random(len(ia)), rng.random(len(ia))
            cs = np.where(useR, C.sample_phase_r(u1), C.sample_phase_mie(u1, u2))
            phi = rng.random(len(ia)) * 2 * math.pi
            dn = _rotate(d[ia], cs, phi)
            pRc, pMc = C.phase_r(cs), C.phase_mie(cs)
            pdf = a * pRc + (1 - a) * pMc
            sel = m[ia, ka] / tot[ia]
            fac = segs['T'][ia, ka] * segs['w'][ia, ka][:, None] * (sRk * pRc[:, None] + sMk[:, None] * pMc[:, None])
            new_beta[ia] = beta[ia] * fac / (sel * pdf)[:, None]
            new_p[ia] = pa
            new_d[ia] = dn
        ig = np.nonzero(go_ground)[0]
        if len(ig):
            pg = segs['pend'][ig]
            nrm = pg / np.linalg.norm(pg, axis=1, keepdims=True)
            pg = nrm * (C.RG + 1e-6)
            u1, u2 = rng.random(len(ig)), rng.random(len(ig))
            ct = np.sqrt(1 - u1)
            dn = _rotate(nrm, ct, 2 * math.pi * u2)
            sel = G[ig] / tot[ig]
            new_beta[ig] = beta[ig] * segs['T_end'][ig] * C.GROUND_ALBEDO / sel[:, None]
            new_p[ig] = pg
            new_d[ig] = dn
        keep = go_atm | go_ground
        # Russian roulette
        if order >= 3:
            q = np.clip(new_beta.max(axis=1), 0.05, 1.0)
            surv = rng.random(n) < q
            new_beta = new_beta / q[:, None]
            keep &= surv
        if order == max_orders or not keep.any():
            break
        sel_i = np.nonzero(keep)[0]
        alive_idx = alive_idx[sel_i]
        beta = new_beta[sel_i]
        p, d = new_p[sel_i], new_d[sel_i]
        ss, mm = ss[sel_i], mm[sel_i]
        segs = _segment(p, d, ss, mm, K, 'mixed', tab)
    # reduce paths -> samples
    Lms_s = Lms.reshape(N, n_paths, C.NL).mean(axis=1)
    L = L1 + Lms_s
    return dict(L=L, L1=L1, Lpeak=Lp, Cm=Cm)


def _ground_nee(seg, s, tab, mie):
    """Sunlight reflected by the Lambertian ground at the end of segments that hit it, times the segment transmittance."""
    out = np.zeros((len(seg['hit']), C.NL), np.float64)
    ih = np.nonzero(seg['hit'])[0]
    if len(ih) == 0:
        return out
    pg = seg['pend'][ih]
    nrm = pg / np.linalg.norm(pg, axis=1, keepdims=True)
    sv = s[ih] if s.ndim == 2 else np.broadcast_to(s, (len(ih), 3))
    mus = np.einsum('ij,ij->i', nrm, sv)
    D, vis = tab.lookup(np.zeros(len(ih)), mus)
    Ts = np.exp(-C.spectral_optical_depth(D, mie[ih])) * vis[:, None]
    out[ih] = seg['T_end'][ih] * Ts * (C.GROUND_ALBEDO / math.pi * np.maximum(mus, 0))[:, None]
    return out


def view_dir(el, az):
    """Unit view direction for elevation el and azimuth az from the sun (radians); the sun is in the x-y plane."""
    ce = np.cos(el)
    return np.stack([ce * np.cos(az), np.sin(el), ce * np.sin(az)], axis=-1)


def sun_dir(el):
    el = np.asarray(el, np.float64)
    return np.stack([np.cos(el), np.sin(el), np.zeros_like(el)], axis=-1)
