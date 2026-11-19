"""Crown envelopes and leaf optics of Skyward's procedural tree species (numpy, no other dependency).

This is the offline twin of the species table in src/terrain/veg/species.js: the same crown shapes (height
fractions, radius fractions), the same leaf-area densities and the same leaf / floor optics, so that the path
tracer measures the forests the browser actually draws.  Linear RGB, physically plausible values.

Crown envelope (per tree, axis vertical, ground at the tree's base):
    base  = crown base  as a fraction of tree height H
    top   = crown top   as a fraction of H (1.0 for all species)
    rad   = max crown radius as a fraction of H
    shape = 'cone'    radius falls linearly from the base to the apex   (spruce, fir)
            'ellip'   ellipsoid between base and top                     (oak, beech, birch, poplar, pine)
    peak  = height fraction (within the crown) of the widest point for 'ellip' (0.5 = symmetric)
    lad   = mean one-sided leaf area density inside the crown (m^2 / m^3)
    shell = fraction of the foliage concentrated in the outer shell (0 = uniform)
"""
import numpy as np

# leaf reflectance / transmittance (one side), linear RGB.  Broadleaf: PROSPECT-like visible bands; needles are
# darker and nearly opaque.  Forest floor: litter + understory.
LEAF = {
    'broad':   {'rho': np.array([0.075, 0.165, 0.048]), 'tau': np.array([0.055, 0.150, 0.028])},
    'conifer': {'rho': np.array([0.052, 0.100, 0.036]), 'tau': np.array([0.022, 0.060, 0.014])},
}
FLOOR = np.array([0.070, 0.072, 0.045])

SPECIES = {
    #            group       shape    base  rad   peak  lad  shell  height range (m)
    'spruce': dict(group='conifer', shape='cone',  base=0.08, rad=0.20, peak=0.0, lad=2.6, shell=0.55, h=(14.0, 27.0)),
    'fir':    dict(group='conifer', shape='cone',  base=0.12, rad=0.24, peak=0.0, lad=2.3, shell=0.50, h=(13.0, 25.0)),
    'pine':   dict(group='conifer', shape='ellip', base=0.52, rad=0.20, peak=0.45, lad=1.3, shell=0.30, h=(14.0, 26.0)),
    'oak':    dict(group='broad',   shape='ellip', base=0.30, rad=0.40, peak=0.45, lad=1.15, shell=0.60, h=(10.0, 20.0)),
    'beech':  dict(group='broad',   shape='ellip', base=0.25, rad=0.33, peak=0.50, lad=1.45, shell=0.65, h=(12.0, 22.0)),
    'birch':  dict(group='broad',   shape='ellip', base=0.32, rad=0.21, peak=0.50, lad=0.85, shell=0.40, h=(10.0, 18.0)),
    'poplar': dict(group='broad',   shape='ellip', base=0.12, rad=0.13, peak=0.40, lad=1.40, shell=0.50, h=(14.0, 24.0)),
}
# mixes used in a stand of the given group (weights)
MIX = {
    'conifer': (('spruce', 0.50), ('fir', 0.25), ('pine', 0.25)),
    'broad':   (('oak', 0.35), ('beech', 0.35), ('birch', 0.20), ('poplar', 0.10)),
}
CELL = 6.5      # placement grid (m): one candidate tree per cell, jittered (same as src/terrain/veg)


def crown_radius(sp, t):
    """Envelope radius (fraction of H) at crown-relative height t in [0, 1] (0 = crown base, 1 = top)."""
    t = np.clip(t, 0.0, 1.0)
    if sp['shape'] == 'cone':
        # slightly convex cone: the lowest boughs droop, the top is a spire
        return sp['rad'] * (1.0 - t) ** 0.9
    p = sp['peak']
    u = np.where(t < p, (t - p) / max(p, 1e-3), (t - p) / max(1.0 - p, 1e-3))
    return sp['rad'] * np.sqrt(np.clip(1.0 - u * u, 0.0, 1.0))
