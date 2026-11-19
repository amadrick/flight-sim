"""The lighting models that ship today, ported to numpy for the comparison against the path tracer.

shipped:  src/neural/cloud-light.js (round-three networks, default in the game) with the features the march feeds it
          (src/clouds/shaders.js): tauSun, the height proxy tauUp = sigma1 (0.3 + 0.2 d) (top - h) and tauDn alike,
          cosT, plus the round-four calibration (clCal = 1): J *= 1 + (...) and V *= (0.84, 1.17).
          Sun source  S_sun = J ; ambient  S_amb = Lsky V.x + Lgnd V.y.
classic:  DEFAULT_SCATTER_GLSL (the hand-built octave + diffusion model, uClPhys.w = 0) with the hand-written
          ambient visibility  0.5 (Lsky visUp + Lgnd visDn).
The weights are read from src/neural/weights-light.js (node dumps them to JSON once).
"""
import json
import math
import os
import subprocess

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
_CACHE = os.path.join(HERE, 'data', 'light_model.json')


def _load():
    if not os.path.exists(_CACHE):
        js = ("import('./src/neural/weights-light.js').then(m=>{require('fs').writeFileSync(%r, "
              "JSON.stringify(m.CLOUD_LIGHT_MODEL))})" % _CACHE)
        subprocess.run(['node', '-e', js], cwd=ROOT, check=True)
    return json.load(open(_CACHE))


def _decode(m):
    import base64
    f = np.frombuffer(base64.b64decode(m['b64']), dtype=np.float32).astype(np.float64)
    layers, p = [], 0
    s = m['sizes']
    for i in range(len(s) - 1):
        W = f[p:p + s[i] * s[i + 1]].reshape(s[i + 1], s[i]); p += s[i] * s[i + 1]
        b = f[p:p + s[i + 1]]; p += s[i + 1]
        layers.append((W, b))
    return layers


def _mlp(layers, x):
    for i, (W, b) in enumerate(layers):
        x = x @ W.T + b
        if i < len(layers) - 1:
            x = x / np.sqrt(1 + x * x)
    return x


_M = None


def model():
    global _M
    if _M is None:
        m = _load()
        _M = dict(j=_decode(m['j']), v=_decode(m['v']), enc=m['enc'], phase=m['phase'], pmax=m['meta']['pmax'])
    return _M


def jd_phase(c, ph):
    g1, g2, a, wd = ph['gHG'], ph['gD'], ph['alpha'], ph['wD']
    d1 = 1 + g1 * g1 - 2 * g1 * c
    d2 = 1 + g2 * g2 - 2 * g2 * c
    hg = (1 - g1 * g1) / d1 ** 1.5
    dr = (1 - g2 * g2) / d2 ** 1.5 * (1 + a * c * c) / (1 + a * (1 + 2 * g2 * g2) / 3)
    return ((1 - wd) * hg + wd * dr) / (4 * math.pi)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def two_stream(u, d, g=0.864):
    return (d * (1 - g) + 0.71) / ((u + d) * (1 - g) + 1.42)


def shipped(tau_sun, tau_up, tau_dn, cos_t, mu_s, calibrated=True):
    """Returns (J_total (sun source per unit E, sr^-1), Vsky, Vgnd) of the round-three networks as the game calls them."""
    M = model()
    enc = M['enc']
    LT = math.log1p(enc['tauMax']); LA = math.log1p(2 / enc['t0']); LB = math.log1p(enc['ambTauMax'])
    ts = np.minimum(tau_sun, 95.0); tu = np.minimum(tau_up, 26.0)
    x = np.stack([2 * np.log1p(np.clip(ts, 0, enc['tauMax'])) / LT - 1,
                  2 * np.log1p(np.clip(tu, 0, enc['tauMax'])) / LT - 1,
                  2 * np.log1p(np.sqrt(np.maximum(0, 2 - 2 * np.clip(cos_t, -1, 1))) / enc['t0']) / LA - 1], 1)
    jms = np.exp(np.clip(_mlp(M['j'], x)[:, 0], -30, 12))
    J = np.minimum(jd_phase(cos_t, M['phase']), M['pmax']) * np.exp(-tau_sun) + jms
    uc, dc = np.minimum(tau_up, 26.0), np.minimum(tau_dn, 26.0)
    xv = np.stack([2 * np.log1p(np.clip(uc, 0, enc['ambTauMax'])) / LB - 1, 2 * np.log1p(np.clip(dc, 0, enc['ambTauMax'])) / LB - 1], 1)
    o = np.exp(np.clip(_mlp(M['v'], xv), -12, 3))
    vs = o[:, 0] * two_stream(tau_up, tau_dn) / two_stream(uc, dc)
    vg = o[:, 1] * two_stream(tau_dn, tau_up) / two_stream(dc, uc)
    if calibrated:
        J = J * (1 + (0.22 + (-0.08 - 0.22) * smoothstep(0.5, 0.95, mu_s))
                 + (1.0 + (0.2 - 1.0) * smoothstep(0.26, 0.71, mu_s)) * np.clip((tau_sun - 4) / 20, 0, 1))
        vs, vg = vs * 0.84, vg * 1.17
    return J, vs, vg


def hg(c, g):
    return (1 - g * g) * 0.0795775 / (1 + g * g - 2 * g * c) ** 1.5


def classic(tau_sun, tau_up, tau_dn, cos_t):
    single = (0.8 * hg(cos_t, 0.82) + 0.2 * hg(cos_t, -0.3)) * np.exp(-tau_sun)
    ms = 0.0
    a = b = c = 1.0
    for _ in range(3):
        a *= 0.42; b *= 0.55; c *= 0.55
        ms = ms + b * (0.8 * hg(cos_t, 0.82 * c) + 0.2 * hg(cos_t, -0.3 * c)) * np.exp(-a * tau_sun)
    depth = tau_sun + 0.35 * tau_up
    powder = 1 - 0.55 * np.exp(-0.8 * depth)
    fwd = 1 + (12.566 * hg(cos_t, 0.35) - 1) * 0.55 * np.exp(-0.12 * tau_sun)
    diffuse = 0.2546 * (0.5 / (1 + 0.1125 * tau_sun) + 0.5 * np.exp(-0.3 * tau_sun)) * powder * fwd
    J = single + 0.5 * ms * powder + diffuse
    vu = 0.35 * np.exp(-0.6 * tau_up) + 0.65 / (1 + 0.2 * tau_up)
    vd = 0.35 * np.exp(-0.6 * tau_dn) + 0.65 / (1 + 0.2 * tau_dn)
    return J, 0.5 * vu, 0.5 * vd


def height_proxies(sig, sigma_ref, ctop, cbot, y, base_alt):
    """The march's tauUp / tauDn: sigma1 (0.3 + 0.2 d) (top - h), d = density = sigma / sigma1; tauDn uses the
    layer base (we use the column's lowest cloud)."""
    d = sig / sigma_ref
    k = sigma_ref * (0.3 + 0.2 * d)
    top = np.where(np.isfinite(ctop), ctop, y)
    bot = np.where(np.isfinite(cbot), cbot, y)
    return k * np.maximum(top - y, 0), k * np.maximum(y - bot, 0)
