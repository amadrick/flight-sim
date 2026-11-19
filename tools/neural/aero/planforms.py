"""Planform descriptions of the 16 aircraft for the reference solver.

Sources: the wing / tail tables in docs/aircraft/<id>.md (sections 4 and 5: section table y / leading-edge station /
chord, sweep, dihedral, twist, control-surface spans, tail and fin dimensions) and, for the two aircraft that have no
sheet (f16, b738), published three-view dimensions (wing 27.87 m2 / 40 deg LE sweep / taper 0.2 for the F-16; the
737-800 wing with 25 deg quarter-chord sweep, 6 deg dihedral, the 32.8 m2 tailplane and 26.4 m2 fin).

Conventions: x = distance aft of the nose tip (m), y = span station from the centre line, z = height above the body
origin (the CG of geometry.js). Wings are carried through the fuselage at the root chord (as in the sheets). The CG
x-position given here is only a starting point: calibrate.py moves the moment reference so that the solver's static
margin equals the tuned one of src/aircraft/<id>/physics.js.

Each entry:
  cg        x of the CG (distance aft of the nose)
  wing      rows [(y, xLE, chord)], z (root height), dihedral (deg, outboard of the first row), twist (deg, tip
            relative to root, washout negative), incidence (deg), aileron (eta0, eta1, chord fraction), flap (eta0,
            eta1), elevon (eta0, eta1, chord fraction) for tailless aircraft
  htail     the same keys + elevator (eta0, eta1, chord fraction) or allMoving
  fins      list of {x (root LE), y, z (root), height (along the fin), cr, ct, sweep (LE, deg), cant (deg, + = tip
            outboard), rudder (chord fraction) or allMoving}
  roll      'aileron' (default) or 'tail' (differential tailplane is the roll control the tuned model uses)
"""
import math

DEG = math.pi / 180.0

P = {}

P['f16'] = dict(
    cg=8.5,
    wing=dict(rows=[(0.0, 5.75, 5.04), (4.725, 9.715, 1.0)], z=0.0, dihedral=0, twist=-3, incidence=0,
              aileron=(0.25, 0.76, 0.22), flap=(0.25, 0.76)),
    htail=dict(rows=[(0.6, 12.0, 2.1), (2.79, 13.84, 0.6)], z=-0.1, dihedral=-10, allMoving=True),
    fins=[dict(x=10.6, y=0.0, z=0.6, height=2.6, cr=2.9, ct=1.0, sweep=47.5, cant=0, rudder=0.25)])

P['f15'] = dict(
    cg=11.95,
    wing=dict(rows=[(1.55, 9.6, 5.7), (6.52, 13.62, 1.8)], z=0.5, dihedral=-1, twist=-2, incidence=0,
              aileron=(0.48, 0.88, 0.27), flap=(0.12, 0.48)),
    htail=dict(rows=[(1.55, 16.0, 3.4), (4.3, 18.75, 1.4)], z=0.2, dihedral=-3, allMoving=True),
    fins=[dict(x=14.6, y=s * 1.55, z=1.0, height=2.8, cr=4.5, ct=1.8, sweep=36, cant=0, rudder=0.30) for s in (-1, 1)])

P['fa18'] = dict(
    cg=9.5,
    wing=dict(rows=[(1.3, 7.9, 4.7), (6.2, 9.7, 2.0)], z=0.05, dihedral=-3, twist=-3, incidence=0,
              aileron=(0.55, 0.92, 0.28), flap=(0.10, 0.50)),
    htail=dict(rows=[(1.3, 14.4, 3.4), (4.3, 16.5, 1.2)], z=-0.2, dihedral=-2, allMoving=True),
    fins=[dict(x=12.5, y=s * 1.2, z=0.7, height=2.77, cr=3.7, ct=1.3, sweep=35, cant=20, rudder=0.30) for s in (-1, 1)])

P['f22'] = dict(
    cg=10.9,
    wing=dict(rows=[(1.6, 8.0, 8.3), (6.78, 12.66, 1.8)], z=-0.2, dihedral=0, twist=-2, incidence=0,
              aileron=(0.52, 0.90, 0.25), flap=(0.15, 0.52)),
    htail=dict(rows=[(1.6, 15.4, 3.3), (4.42, 17.94, 1.1)], z=-0.2, dihedral=0, allMoving=True),
    fins=[dict(x=13.4, y=s * 1.1, z=0.6, height=3.0, cr=4.6, ct=1.7, sweep=25, cant=27, rudder=0.30) for s in (-1, 1)])

P['f35'] = dict(
    cg=9.25,
    wing=dict(rows=[(0.95, 7.2, 5.5), (5.35, 10.06, 1.5)], z=-0.1, dihedral=0, twist=-2, incidence=0,
              aileron=(0.55, 0.95, 0.28), flap=(0.08, 0.55)),
    htail=dict(rows=[(0.95, 12.9, 2.9), (3.05, 14.37, 1.0)], z=-0.1, dihedral=0, allMoving=True),
    fins=[dict(x=11.8, y=s * 1.0, z=0.6, height=2.02, cr=3.4, ct=1.1, sweep=35, cant=20, rudder=0.35) for s in (-1, 1)])

# wings forward (20 deg): the glove / fuselage "pancake" inboard of the pivot is carried as wing
P['f14'] = dict(
    cg=11.5,
    wing=dict(rows=[(0.0, 8.6, 6.2), (3.2, 10.5, 4.3), (9.78, 12.9, 1.5)], z=0.35, dihedral=0, twist=-2, incidence=0,
              aileron=(0.40, 0.80, 0.15), flap=(0.36, 0.88)),
    htail=dict(rows=[(1.45, 16.0, 3.4), (4.95, 19.75, 1.4)], z=0.0, dihedral=0, allMoving=True),
    fins=[dict(x=14.0, y=s * 1.9, z=0.9, height=2.6, cr=4.5, ct=1.7, sweep=40, cant=3, rudder=0.35) for s in (-1, 1)],
    roll='tail')

P['a10'] = dict(
    cg=7.35,
    wing=dict(rows=[(0.8, 6.3, 3.2), (4.0, 6.3, 3.1), (8.77, 7.5, 1.6)], z=-0.5, zrows=[-0.5, -0.5, 0.09], twist=-2,
              incidence=1, aileron=(0.50, 0.95, 0.27), flap=(0.10, 0.50)),
    htail=dict(rows=[(0.3, 14.0, 2.4), (2.75, 14.2, 1.9)], z=0.3, dihedral=0, elevator=(0.0, 1.0, 0.40), incidence=-1),
    fins=[dict(x=13.3, y=s * 2.75, z=-0.5, height=2.6, cr=3.0, ct=1.5, sweep=15, cant=0, rudder=0.35) for s in (-1, 1)])

P['sr71'] = dict(
    cg=20.0,
    wing=dict(rows=[(0.9, 11.0, 18.0), (3.0, 17.5, 11.5), (8.47, 26.5, 2.5)], z=-0.1, dihedral=0, twist=0, incidence=0,
              elevon=(0.18, 0.95, 0.15)),
    fins=[dict(x=22.6, y=s * 3.7, z=0.9, height=3.1, cr=6.4, ct=1.6, sweep=55, cant=-15, allMoving=True) for s in (-1, 1)])

P['b2'] = dict(
    cg=9.4,
    wing=dict(rows=[(0.0, 0.0, 20.9), (3.4, 2.2, 15.0), (10.0, 6.5, 11.9), (26.2, 17.0, 0.6)], z=0.0, dihedral=0.5,
              twist=-4, incidence=0, elevon=(0.13, 0.80, 0.25)))

P['c17'] = dict(
    cg=25.5,
    wing=dict(rows=[(3.4, 20.0, 10.0), (25.88, 30.5, 2.5)], z=2.2, dihedral=-3, twist=-3, incidence=1,
              aileron=(0.72, 0.95, 0.25), flap=(0.14, 0.68)),
    htail=dict(rows=[(0.0, 49.0, 5.0), (9.9, 54.7, 2.0)], z='T', dihedral=0, elevator=(0.0, 1.0, 0.32), incidence=-1),
    fins=[dict(x=41.5, y=0.0, z=2.6, height='T', cr=9.5, ct=3.3, sweep=40, cant=0, rudder=0.30, tipAboveGround=16.0)])

P['b738'] = dict(
    cg=18.4,
    wing=dict(rows=[(1.88, 13.9, 7.0), (5.9, 15.99, 4.0), (17.16, 21.85, 1.5)], z=-1.0, dihedral=6, twist=-3.5,
              incidence=1, aileron=(0.72, 0.93, 0.22), flap=(0.11, 0.70)),
    htail=dict(rows=[(0.9, 33.3, 3.6), (7.17, 37.4, 1.0)], z=1.0, dihedral=7, elevator=(0.0, 1.0, 0.28), incidence=-1),
    fins=[dict(x=29.6, y=0.0, z=2.0, height=7.2, cr=5.7, ct=1.7, sweep=38, cant=0, rudder=0.28)])

P['a320'] = dict(
    cg=17.7,
    wing=dict(rows=[(1.98, 14.0, 6.3), (6.4, 16.5, 3.9), (17.9, 22.0, 1.2)], z=-1.5, dihedral=5.1, twist=-3,
              incidence=1, aileron=(0.80, 0.98, 0.22), flap=(0.12, 0.78)),
    htail=dict(rows=[(1.0, 32.0, 4.0), (6.225, 35.5, 1.2)], z=0.8, dihedral=5, elevator=(0.0, 1.0, 0.30), incidence=-1),
    fins=[dict(x=28.5, y=0.0, z=2.1, height=6.0, cr=7.0, ct=2.2, sweep=40, cant=0, rudder=0.28)])

P['b748'] = dict(
    cg=38.5,
    wing=dict(rows=[(3.25, 27.8, 14.7), (11.2, 35.0, 9.0), (34.2, 51.7, 3.0)], z=-2.5, dihedral=6.5, twist=-4,
              incidence=1, aileron=(0.82, 0.96, 0.22), flap=(0.13, 0.70)),
    htail=dict(rows=[(2.0, 61.5, 8.0), (11.1, 68.5, 2.8)], z=1.0, dihedral=7, elevator=(0.0, 1.0, 0.30), incidence=-1),
    fins=[dict(x=56.5, y=0.0, z=3.9, height=10.3, cr=12.5, ct=4.2, sweep=45, cant=0, rudder=0.30)])

P['b77w'] = dict(
    cg=36.3,
    wing=dict(rows=[(3.1, 27.8, 11.5), (12.0, 34.0, 7.2), (32.4, 46.5, 2.6)], z=-2.4, dihedral=6, twist=-5,
              incidence=1, aileron=(0.84, 0.99, 0.22), flap=(0.12, 0.71)),
    htail=dict(rows=[(2.0, 61.0, 7.8), (10.65, 67.3, 2.2)], z=1.0, dihedral=7, elevator=(0.0, 1.0, 0.32), incidence=-1),
    fins=[dict(x=56.0, y=0.0, z=3.4, height='G', cr=11.5, ct=3.8, sweep=43, cant=0, rudder=0.28, tipAboveGround=18.5)])

P['b789'] = dict(
    cg=29.9,
    wing=dict(rows=[(2.9, 22.0, 10.6), (11.0, 27.6, 6.8), (30.06, 39.4, 2.4)], z=-1.9, dihedral=5.5, twist=-4,
              incidence=1, aileron=(0.86, 0.98, 0.22), flap=(0.10, 0.73)),
    htail=dict(rows=[(1.8, 50.8, 6.2), (9.6, 56.3, 1.9)], z=1.0, dihedral=6, elevator=(0.0, 1.0, 0.30), incidence=-1),
    fins=[dict(x=45.5, y=0.0, z=3.2, height='G', cr=9.5, ct=3.3, sweep=43, cant=0, rudder=0.28, tipAboveGround=17.0)])

P['a388'] = dict(
    cg=37.5,
    wing=dict(rows=[(3.6, 26.0, 17.5), (14.5, 33.6, 12.2), (39.88, 49.9, 4.0)], z=-3.0, dihedral=5.6, twist=-3.5,
              incidence=1, aileron=(0.75, 0.99, 0.20), flap=(0.12, 0.75)),
    htail=dict(rows=[(3.0, 59.0, 11.0), (15.2, 68.5, 3.5)], z=1.5, dihedral=6, elevator=(0.0, 1.0, 0.28), incidence=-1),
    fins=[dict(x=54.0, y=0.0, z=4.5, height='G', cr=13.0, ct=5.5, sweep=45, cant=0, rudder=0.28, tipAboveGround=24.09)])

IDS = ['f16', 'f15', 'fa18', 'f22', 'f35', 'f14', 'a10', 'sr71', 'b2', 'c17', 'b738', 'a320', 'b748', 'b77w', 'b789', 'a388']


def _surface(S, zt=None):
    rows = list(S['rows'])
    y0 = rows[0][0]
    if y0 > 1e-6:
        rows = [(0.0, rows[0][1], rows[0][2])] + rows                     # carried through the fuselage
    z0 = S['z'] if zt is None else zt
    dih = math.tan(S.get('dihedral', 0.0) * DEG)
    secs = []
    zr = S.get('zrows')
    for k, (y, xle, ch) in enumerate(rows):
        if zr is not None:
            z = zr[max(0, k - (1 if y0 > 1e-6 else 0))]
        else:
            z = z0 + dih * max(0.0, y - y0)
        secs.append((y, xle, ch, z, 0.0))
    out = dict(sections=secs, twist=S.get('twist', 0.0), incidence=S.get('incidence', 0.0))
    for k in ('aileron', 'flap', 'elevon', 'elevator', 'allMoving'):
        if k in S:
            out[k] = S[k]
    return out


def make_spec(aid, model):
    """Solver spec for aircraft `aid`; `model` is its entry of results/models.json (tuned reference area / span /
    chord and the gear geometry for heights above the ground)."""
    p = P[aid]
    spec = dict(id=aid, cg=(p['cg'], 0.0), Sref=model['S'], bref=model['b'], cref=model['c'], roll=p.get('roll', 'aileron'))
    spec['wing'] = _surface(p['wing'])
    fins = []
    ttail = None
    for F in p.get('fins', []):
        h = F['height']
        if 'tipAboveGround' in F:
            h = F['tipAboveGround'] - model['cgHeight'] - F['z']
        if p.get('htail') and p['htail'].get('z') == 'T':
            ttail = F['z'] + h
        f = dict(root=(F['x'], F['y'], F['z']), height=h, cr=F['cr'], ct=F['ct'], sweep=F['sweep'], cant=F.get('cant', 0.0))
        if F.get('allMoving'):
            f['allMoving'] = True
        else:
            f['rudder'] = F.get('rudder', 0.28)
        fins.append(f)
    if p.get('htail'):
        spec['htail'] = _surface(p['htail'], zt=ttail if p['htail'].get('z') == 'T' else None)
    spec['fins'] = fins
    return spec


def summary(spec):
    """Planform area / aspect ratio / mean chord of the solver wing (for the check against the reference area)."""
    s = spec['wing']['sections']
    area = 2 * sum(0.5 * (a[2] + b[2]) * (b[0] - a[0]) for a, b in zip(s[:-1], s[1:]))
    span = 2 * s[-1][0]
    return dict(area=area, span=span, AR=span * span / area)
