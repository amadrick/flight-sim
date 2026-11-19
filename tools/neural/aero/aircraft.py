"""One aircraft for the reference solver: planform + calibrated section model + helpers.

Calibration (the solver is tied to the tuned analytic model only through these few numbers, so that its *shapes* can
be transplanted onto the tuned magnitudes):
  * wing camber (zero-lift angle)      -> CL at zero body angle of attack = tuned cl0
  * moment reference (CG)              -> static margin dCm/dCL = -(tuned staticMargin)
  * flap zero-lift shift at full flap  -> lift increment at constant alpha = tuned dcl0 of the landing detent
  * section stall angle                -> angle of maximum lift, clean, low Mach = the tuned one
  * section stall width                -> from the tuned stall sharpness
Everything else (lift slope, downwash, stall progression, derivatives, control power, ground effect) is the solver's.
"""
import json
import math
import os
import numpy as np

import solver as S
import planforms

DEG = S.DEG
HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, 'results', 'models.json')

FLAP_GRID = np.array([0.0, 0.5, 1.0])
MACH_GRID = np.array([0.0, 0.4, 0.6, 0.75, 0.9])


CALFILE = os.path.join(HERE, 'results', 'calibration.json')


def load_aircraft(aid, **kw):
    """Aircraft with the stored calibration if there is one (run calibrate.py to refresh it)."""
    cal = None
    if os.path.exists(CALFILE):
        with open(CALFILE) as f:
            cal = json.load(f).get(aid)
    return Aircraft(aid, cal=cal, **kw)


def load_models():
    with open(MODELS) as f:
        return json.load(f)


def peak_alpha(al, cl, lo=4 * DEG):
    """Angle of the first local lift maximum above `lo` (parabolic refinement); the last angle if there is none."""
    for k in range(1, len(al) - 1):
        if al[k] >= lo and cl[k] >= cl[k - 1] and cl[k] > cl[k + 1]:
            d = cl[k - 1] - 2 * cl[k] + cl[k + 1]
            off = 0.5 * (cl[k - 1] - cl[k + 1]) / d if abs(d) > 1e-12 else 0.0
            return al[k] + off * (al[1] - al[0]), cl[k]
    return al[-1], cl[-1]


class Aircraft:
    def __init__(self, aid, model=None, n_wing=12, n_tail=6, n_fin=5, calibrate=True, verbose=False, cal=None):
        self.id = aid
        self.model = model or load_models()[aid]
        self.spec = planforms.make_spec(aid, self.model)
        self.g = S.build_geometry(self.spec, n_wing=n_wing, n_tail=n_tail, n_fin=n_fin)
        m = self.model
        sharp = m['sharp']
        self.sec = S.Section(aL0=0.0, a_stall=15 * DEG, a_stall_neg=13 * DEG, width=max(1.0 * DEG, 0.7 / sharp),
                             cn90=m['cd90'], tail_stall=15 * DEG, tail_width=2.5 * DEG, flap_dalpha=0.0)
        self.has_flap = bool(self.spec['wing'].get('flap')) and m['flaps']['dcl0'][-1] > 0.02
        self.has_tail = any(k == 'htail' for _, k, _, _ in self.g.parts)
        self.has_fin = any(k == 'fin' for _, k, _, _ in self.g.parts)
        self.cal = {}
        if cal is not None:                                 # stored calibration (results/calibration.json)
            self.apply_cal(cal)
        elif calibrate:
            self.calibrate(verbose)

    def apply_cal(self, c):
        sec = self.sec
        sec.aL0 = c['aL0_deg'] * DEG; sec.flap_dalpha = c['flap_dalpha_deg'] * DEG
        sec.a_stall = c['a_stall_deg'] * DEG; sec.a_stall_neg = c['a_stall_neg_deg'] * DEG; sec.width = c['width_deg'] * DEG
        S.shift_reference(self.g, c['cg_shift'])
        self.cal = c

    # ---- tuned-model angles ----------------------------------------------------------------------------------------
    def tuned_peak(self, flap_index=0):
        """Tuned angle of maximum lift in a flap detent (what computeAero uses as a0p - peakOff; automatic leading-edge
        devices are fully out near the stall, scheduled slats follow the detent)."""
        m = self.model
        f = m['flaps']
        slat = 1.0 if m['slatAuto'] else f['slat'][flap_index]
        return f['a0'][flap_index] - (1.0 - slat) * m['slatDAlpha'] - m['peakOff']

    def tuned_peak_neg(self):
        m = self.model
        return m['a0n'] - m['peakOff']

    # ---- solver wrappers -------------------------------------------------------------------------------------------
    def run(self, alpha, **kw):
        return S.solve(self.g, self.sec, alpha, **kw)

    def calibrate(self, verbose=False):
        m, g, sec = self.model, self.g, self.sec
        a2 = np.array([0.0, 4 * DEG])
        # 1. camber: CL(alpha = 0) = cl0 (linear, clean)
        o0 = S.solve(g, sec, a2, mach=0.2)
        sec.aL0 = -1 * DEG
        o1 = S.solve(g, sec, a2, mach=0.2)
        dcl = (o1['CL'][0] - o0['CL'][0]) / (-1 * DEG)
        sec.aL0 = (m['cl0'] - o0['CL'][0]) / dcl
        # 2. moment reference: static margin
        o = S.solve(g, sec, a2, mach=0.2)
        dcm = (o['Cm'][1] - o['Cm'][0]) / (o['CL'][1] - o['CL'][0])
        dx = (-m['sm'] - dcm) * g.cref
        S.shift_reference(g, dx)
        o = S.solve(g, sec, a2, mach=0.2)
        cla = (o['CL'][1] - o['CL'][0]) / a2[1]
        sm = -(o['Cm'][1] - o['Cm'][0]) / (o['CL'][1] - o['CL'][0])
        # 3. flaps
        if self.has_flap:
            sec.flap_dalpha = -10 * DEG
            of = S.solve(g, sec, np.array([0.0]), flap=1.0, mach=0.2)
            k = (of['CL'][0] - o['CL'][0]) / (-10 * DEG)
            sec.flap_dalpha = float(np.clip(m['flaps']['dcl0'][-1] / k, -40 * DEG, 0.0))
        # 4. section stall angle and stall width: angle of maximum lift (clean, M 0.2) = the tuned one, and the same
        #    rounding of the lift curve (CLmax relative to the attached line) as the tuned curve
        target = self.tuned_peak(0)
        rn = float(np.clip(self.tuned_peak_neg() / target, 0.4, 1.0))
        al = np.arange(0.0, 70.01, 1.0) * DEG
        cl_goal = m['cl0'] + (m['flaps']['clMax'][0] - m['cl0']) * cla / m['cla']

        def fit_angle(width):
            sec.width = width
            lo, hi = 3 * DEG, 65 * DEG
            for _ in range(13):
                mid = 0.5 * (lo + hi)
                sec.a_stall = mid; sec.a_stall_neg = mid * rn
                if peak_alpha(al, S.solve(g, sec, al, mach=0.2)['CL'])[0] < target: lo = mid
                else: hi = mid
            sec.a_stall = 0.5 * (lo + hi); sec.a_stall_neg = sec.a_stall * rn
            return peak_alpha(al, S.solve(g, sec, al, mach=0.2)['CL'])
        wlo, whi = 1.0 * DEG, 8.0 * DEG
        ap, clmax = fit_angle(wlo)
        if clmax > cl_goal:
            for _ in range(6):
                wm = 0.5 * (wlo + whi)
                ap, clmax = fit_angle(wm)
                # wider = rounder; a width at which the stall peak disappears into the flat-plate hump is too wide
                if clmax > cl_goal and abs(ap - target) < 1.5 * DEG: wlo = wm
                else: whi = wm
            ap, clmax = fit_angle(wlo)
        self.cal = dict(aL0_deg=sec.aL0 / DEG, cg_shift=dx, cla=cla, cla_tuned=m['cla'], static_margin=sm,
                        flap_dalpha_deg=sec.flap_dalpha / DEG, a_stall_deg=sec.a_stall / DEG, a_stall_neg_deg=sec.a_stall_neg / DEG,
                        width_deg=sec.width / DEG, peak_deg=ap / DEG, peak_tuned_deg=target / DEG, clmax=clmax, clmax_goal=cl_goal, clmax_tuned=m['flaps']['clMax'][0],
                        wing=planforms.summary(self.spec), n_strips=int(g.nstrips()))
        if verbose:
            print(self.id, json.dumps(self.cal))
        return self.cal

    # ---- reference tables for the normalisation --------------------------------------------------------------------
    def peak_table(self):
        """Angle of maximum lift (positive and negative side) on the (flap, Mach) grid."""
        al = np.arange(0.0, 70.01, 0.5) * DEG
        F, M = np.meshgrid(FLAP_GRID, MACH_GRID, indexing='ij')
        pos = np.zeros(F.shape); neg = np.zeros(F.shape)
        for i in range(F.shape[0]):
            for j in range(F.shape[1]):
                fl = F[i, j] if self.has_flap else 0.0
                pos[i, j] = peak_alpha(al, S.solve(self.g, self.sec, al, mach=M[i, j], flap=fl)['CL'])[0]
                neg[i, j] = peak_alpha(al, -S.solve(self.g, self.sec, -al, mach=M[i, j], flap=fl)['CL'])[0]
        self.peak_pos, self.peak_neg = pos, neg
        return pos, neg

    def peaks(self, flap, mach):
        """Bilinear lookup of the solver's own angles of maximum lift (positive, negative) at (flap, Mach)."""
        def bil(T):
            fi = np.clip(np.searchsorted(FLAP_GRID, flap, side='right') - 1, 0, len(FLAP_GRID) - 2)
            mi = np.clip(np.searchsorted(MACH_GRID, mach, side='right') - 1, 0, len(MACH_GRID) - 2)
            tf = np.clip((flap - FLAP_GRID[fi]) / (FLAP_GRID[fi + 1] - FLAP_GRID[fi]), 0, 1)
            tm = np.clip((mach - MACH_GRID[mi]) / (MACH_GRID[mi + 1] - MACH_GRID[mi]), 0, 1)
            return (T[fi, mi] * (1 - tf) * (1 - tm) + T[fi + 1, mi] * tf * (1 - tm) + T[fi, mi + 1] * (1 - tf) * tm + T[fi + 1, mi + 1] * tf * tm)
        return bil(self.peak_pos), bil(self.peak_neg)
