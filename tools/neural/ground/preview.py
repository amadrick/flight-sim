"""Preview of one simulated patch: a PNG montage of the terrain (hillshade) and the simulated cover fields.

    python3 preview.py <patch index> <out.png> [--composite]
"""
import json, os, struct, sys, time, zlib
import numpy as np
import ecosim

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')


def write_png(path, rgb):
    h, w, _ = rgb.shape
    raw = b''.join(b'\x00' + rgb[y].tobytes() for y in range(h))
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


def load_patch(p):
    meta = json.load(open(os.path.join(DATA, 'patches.json')))
    n = meta['N']
    a = np.fromfile(os.path.join(DATA, f'patch_{p}.f32'), np.float32).reshape(3, n, n)
    return meta, a[0], a[1], a[2]


def hillshade(H, cell):
    gx = np.gradient(H, axis=1) / cell; gz = np.gradient(H, axis=0) / cell
    nl = 1 / np.sqrt(1 + gx * gx + gz * gz)
    return np.clip((-gx * -0.5 + 0.6 + -gz * 0.55) * nl / 1.0, 0, 1)


def composite(H, out, cell):
    """A crude true-colour rendering of the simulated cover (for judging the simulation, not the shader)."""
    sh = hillshade(H, cell)[..., None]
    col = np.zeros(H.shape + (3,)) + np.array([0.42, 0.36, 0.27])                      # bare soil
    mix = lambda c, t, a: c * (1 - a[..., None]) + np.array(t) * a[..., None]
    col = mix(col, [0.40, 0.44, 0.22], out['grass'])
    col = mix(col, [0.30, 0.33, 0.20], out['shrub'])
    col = mix(col, [0.52, 0.50, 0.47], out['scree'])
    col = mix(col, [0.38, 0.37, 0.36], out['rock'])
    col = mix(col, [0.16, 0.30, 0.12], out['forest'] * (1 - out['conifer']))
    col = mix(col, [0.08, 0.19, 0.10], out['forest'] * out['conifer'])
    col = mix(col, [0.95, 0.96, 0.98], out['snow'])
    col = col * (0.35 + 0.9 * sh)
    return (np.clip(col, 0, 1) ** (1 / 1.6) * 255).astype(np.uint8)


if __name__ == '__main__':
    p = int(sys.argv[1]); outp = sys.argv[2]
    meta, H, arid, spec = load_patch(p)
    P = meta['patches'][p]
    t0 = time.time()
    out = ecosim.simulate(H, arid, spec, P['x0'], P['z0'], meta['CELL'], verbose=True)
    print(P['name'], 'sim %.1f s' % (time.time() - t0))
    for k in ecosim.OUT_NAMES:
        print('  %-8s mean %.3f  p10 %.3f  p90 %.3f' % (k, out[k].mean(), np.percentile(out[k], 10), np.percentile(out[k], 90)))
    if '--composite' in sys.argv:
        img = composite(H, out, meta['CELL'])
    else:
        tiles = [np.repeat((hillshade(H, meta['CELL'])[..., None] * 255).astype(np.uint8), 3, axis=2), composite(H, out, meta['CELL'])]
        for k in ['forest', 'conifer', 'shrub', 'grass', 'rock', 'scree', 'snow', 'wet', 'soil', 'wash']:
            tiles.append(np.repeat((np.clip(out[k], 0, 1)[::1, ::1, None] * 255).astype(np.uint8), 3, axis=2))
        tiles = [t[::2, ::2] for t in tiles]
        rows = [np.concatenate(tiles[i:i + 4], axis=1) for i in range(0, 12, 4)]
        img = np.concatenate(rows, axis=0)
    write_png(outp, img)
