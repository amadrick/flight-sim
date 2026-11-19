"""The deployed descriptor and network in numpy (shared by train.py final/export, render.py and the JS test vectors).

Descriptor (what the shader passes to cloudMsLight):
    tauSun   optical depth toward the sun (the march's light march + shadow map), physical units
    tauCam   optical depth from the camera to the sample along the view ray (= -ln T of the march), clamped at 60
    muSun    sin(sun elevation)
    cosTheta dot(sunDir, rayDir)
    tap<Dir> for each Dir in desc['dirs']: optical-depth segments sigma(p + dir m_k) (e_k - e_{k-1}), m_k = segment
             midpoints of desc['ends'] (metres); up = +y, down = -y, fwd = rayDir (beyond the sample, away from camera)
Encoding: [ln(1+tauSun), muSun, ln(1+tauCam), c, ln(1+chord/0.05)/ln(41), ln(1+tap...)]  (chord = sqrt(2-2c))
"""
import json
import math
import os

import numpy as np

import features as F

HERE = os.path.dirname(os.path.abspath(__file__))
FINAL = os.path.join(HERE, 'data', 'model_final.json')
DIRV = dict(up=np.array([0.0, 1.0, 0.0]), down=np.array([0.0, -1.0, 0.0]))


def encode(tau_sun, tau_cam, mu_s, cos_t, taps, desc):
    c = np.clip(cos_t, -1, 1)
    chord = np.sqrt(np.maximum(0, 2 - 2 * c))
    f = [np.log1p(np.maximum(tau_sun, 0)), mu_s * np.ones_like(c), np.log1p(np.clip(tau_cam, 0, desc['tauCamMax'])), c,
         np.log1p(chord / desc['chordT0']) / math.log1p(2 / desc['chordT0'])]
    for k in range(len(desc['dirs'])):
        for j in range(taps.shape[2]):
            f.append(np.log1p(np.maximum(taps[:, k, j], 0)))
    return np.stack(f, 1)


def dir_vectors(names, rd, L):
    n = len(rd)
    out = np.zeros((n, len(names), 3))
    for i, nm in enumerate(names):
        if nm in DIRV:
            out[:, i] = DIRV[nm]
        elif nm == 'fwd':
            out[:, i] = rd
        elif nm == 'cam':
            out[:, i] = -rd
        elif nm == 'anti':
            out[:, i] = -np.asarray(L)
        elif nm == 'sun':
            out[:, i] = np.asarray(L)
        else:
            raise ValueError(nm)
    return out


def tap_scene(sc, desc):
    """The field the descriptor taps: the scene itself (v1) or gain x its cheap base density (v2, see gen_tap.py)."""
    if desc.get('tapSource', 'full') != 'base':
        return sc
    import pt
    import scenes as S
    base = getattr(sc, 'base', None)
    if base is None:
        base = S.base_emulation(sc.sig, sc.h, 40.0)
    return pt.Scene(base * desc.get('tapGain', 0.8), sc.h, sc.o, periodic=sc.per, name=sc.name + ':base')


def descriptor(sc, P, rd, L, tau_cam, tau_sun, desc):
    Dirs = dir_vectors(desc['dirs'], rd, L)
    taps = F.tap_segments(sc, P, Dirs, np.array(desc['ends']))
    mu_s = float(np.asarray(L)[1])
    return encode(tau_sun, tau_cam, mu_s, rd @ np.asarray(L), taps, desc)


def forward(layers, x):
    for i, (W, b) in enumerate(layers):
        x = x @ W.T + b
        if i < len(layers) - 1:
            x = x / np.sqrt(1 + x * x)
    return np.exp(np.clip(x, -20, 4))


def predict(net, X):
    return forward(net['layers'], X)


def load_final(path=FINAL):
    m = json.load(open(path))
    m['layers'] = [(np.array(l['W']), np.array(l['b'])) for l in m['layers']]
    return m
