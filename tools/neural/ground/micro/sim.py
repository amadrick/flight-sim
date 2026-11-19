"""Reference simulation for the micro-relief transfer network (numpy only).

A rough Lambertian ground seen from far enough that its relief is below a pixel does not look like a flat Lambertian
sheet: facets tilted toward the sun are brighter, part of the surface lies in shadow, and the viewer sees a biased
selection of facets (the lit ones looking down-sun, the shadowed ones looking up-sun). This script measures that on
synthetic height fields: for a periodic Gaussian height field of RMS slope s it computes, for sun elevation, view
elevation and relative azimuth, the mean radiance toward the viewer divided by that of a flat Lambertian surface of
the same albedo:

    K = < (n.l)+ (n.v)+ S_l S_v / n_z >  /  ( cos(theta_s) cos(theta_v) )

with exact cast shadows S_l and view masking S_v from horizon marching on the field (direct light only; no
interreflection, which adds a few percent of the albedo in the shadowed part and is left to the ambient term).
Output: micro_dataset.npz (features: cos_s, cos_v, cos_phi, s; target: R = K cos_s).
"""
import numpy as np, time, sys

N = 192
DIRS = [(1, 0), (2, 1), (1, 1), (1, 2), (0, 1), (-1, 2), (-1, 1), (-2, 1), (-1, 0)]   # view azimuths 0..180 deg; sun along +x

def field(rng, slope, beta):
    kx = np.fft.fftfreq(N)[:, None] * N; ky = np.fft.fftfreq(N)[None, :] * N
    k = np.hypot(kx, ky); k[0, 0] = 1
    amp = k ** (-beta / 2.0) * (k <= N / 6) * (k >= 2)        # band-limited: the finest waves span 6 texels
    h = np.fft.ifft2(amp * np.exp(2j * np.pi * rng.random((N, N)))).real
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5; gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    h *= slope / np.sqrt(np.mean(gx * gx + gy * gy))
    return h

def horizon_tan(h, d):
    """max over the ray toward direction d (texel steps) of the rise / run: tan of the horizon elevation."""
    dx, dy = d; L = np.hypot(dx, dy)
    best = np.full(h.shape, -1e9)
    k = 1
    while k * L < N * 0.45:
        best = np.maximum(best, (np.roll(h, (-k * dy, -k * dx), (0, 1)) - h) / (k * L))
        k += 1 if k < 24 else 2 if k < 48 else 4
    return best

def run(seed0, n_fields, slopes, out_rows):
    cos_s_list = np.array([0.06, 0.12, 0.2, 0.3, 0.42, 0.55, 0.68, 0.8, 0.92, 1.0])
    cos_v_list = np.array([0.08, 0.16, 0.26, 0.38, 0.5, 0.63, 0.76, 0.88, 1.0])
    for si, s in enumerate(slopes):
        for f in range(n_fields):
            rng = np.random.default_rng(seed0 + 1000 * si + f)
            h = field(rng, s, rng.uniform(1.6, 2.6))
            gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5; gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
            nz = 1.0 / np.sqrt(1 + gx * gx + gy * gy); nx = -gx * nz; ny = -gy * nz
            hor = [horizon_tan(h, d) for d in DIRS]
            for cs in cos_s_list:
                sn = np.sqrt(1 - cs * cs)
                nl = np.maximum(nx * sn + nz * cs, 0) * (hor[0] <= cs / max(sn, 1e-6))
                for di, d in enumerate(DIRS):
                    L = np.hypot(*d); vx, vy = d[0] / L, d[1] / L
                    for cv in cos_v_list:
                        sv = np.sqrt(1 - cv * cv)
                        nv = np.maximum((nx * vx + ny * vy) * sv + nz * cv, 0) * (hor[di] <= cv / max(sv, 1e-6))
                        K = np.mean(nl * nv / nz) / (cs * cv)
                        out_rows.append((cs, cv, vx, s, K * cs))

if __name__ == '__main__':
    t0 = time.time()
    slopes = [0.05, 0.12, 0.2, 0.3, 0.42, 0.55, 0.7, 0.85, 1.0]
    tr, te = [], []
    run(100, 5, slopes, tr)
    run(90000, 2, slopes, te)                                  # held out: other random fields
    run(70000, 2, [0.16, 0.36, 0.62, 0.78], te)                # held out: roughness values between the trained ones
    np.savez(sys.argv[1] if len(sys.argv) > 1 else 'micro_dataset.npz', train=np.array(tr, np.float32), test=np.array(te, np.float32))
    print(f'{len(tr)} train, {len(te)} test rows in {time.time() - t0:.0f} s')
