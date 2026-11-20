"""Write forward-pass test vectors for the JS twin (src/neural/ground-pave.js) from the exported weights.

    python3 vectors.py ../../../../src/neural/ground-pave-weights.js ../../../../src/neural/pave-test-vectors.json
"""
import sys, re, json, base64
import numpy as np

src = open(sys.argv[1]).read()
def net(name):
    m = re.search(name + r" = \{ sizes: \[([0-9, ]+)\].*?data: '([^']+)'", src)
    sizes = [int(x) for x in m.group(1).split(',')]
    f = np.frombuffer(base64.b64decode(m.group(2)), np.float32).astype(np.float64)
    L, p = [], 0
    for a, b in zip(sizes[:-1], sizes[1:]):
        W = f[p:p + a * b].reshape(b, a); p += a * b; bb = f[p:p + b]; p += b; L.append((W, bb))
    return sizes, L
def fwd(L, x):
    for i, (W, b) in enumerate(L):
        x = W @ x + b
        if i < len(L) - 1: x = np.tanh(x)
    return x
rng = np.random.default_rng(11)
out = {}
for name in ('PAVE_SUN', 'PAVE_SKY'):
    sizes, L = net(name)
    out[name] = [{'x': list(x), 'y': list(fwd(L, x))} for x in rng.uniform(-1, 1, (8, sizes[0]))]
json.dump(out, open(sys.argv[2], 'w'))
print('wrote', sys.argv[2])
