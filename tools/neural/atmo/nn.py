"""Minimal numpy MLP (ISRU hidden activation, linear output) with Adam. Same arithmetic as src/neural/mlp.js:
hidden f(z) = z / sqrt(1 + z^2); weights W (out x in) row-major, then b, per layer."""
import base64
import math
import numpy as np


class MLP:
    def __init__(self, sizes, rng, out_bias=None):
        self.sizes = list(sizes)
        self.W, self.b = [], []
        for i in range(len(sizes) - 1):
            a, o = sizes[i], sizes[i + 1]
            self.W.append(rng.normal(0, math.sqrt(1.0 / a), (o, a)))
            self.b.append(np.zeros(o))
        if out_bias is not None:
            self.b[-1][:] = out_bias
        self.params = self.W + self.b
        self.m = [np.zeros_like(p) for p in self.params]
        self.v = [np.zeros_like(p) for p in self.params]
        self.t = 0

    def n_params(self):
        return int(sum(p.size for p in self.params))

    def forward(self, x, keep=False):
        acts = [x]
        pre = []
        h = x
        for i, (W, b) in enumerate(zip(self.W, self.b)):
            z = h @ W.T + b
            if i < len(self.W) - 1:
                pre.append(z)
                h = z / np.sqrt(1 + z * z)
                acts.append(h)
            else:
                h = z
        if keep:
            self._cache = (acts, pre)
        return h

    def backward(self, gout):
        acts, pre = self._cache
        gW = [None] * len(self.W)
        gb = [None] * len(self.W)
        g = gout
        for i in range(len(self.W) - 1, -1, -1):
            gW[i] = g.T @ acts[i]
            gb[i] = g.sum(0)
            if i > 0:
                g = g @ self.W[i]
                z = pre[i - 1]
                g = g * (1 + z * z) ** -1.5
        return gW + gb

    def adam(self, grads, lr, b1=0.9, b2=0.999, eps=1e-8):
        self.t += 1
        for p, g, m, v in zip(self.params, grads, self.m, self.v):
            m *= b1
            m += (1 - b1) * g
            v *= b2
            v += (1 - b2) * g * g
            mh = m / (1 - b1 ** self.t)
            vh = v / (1 - b2 ** self.t)
            p -= lr * mh / (np.sqrt(vh) + eps)

    def to_f32(self):
        """Round weights to float32 (what ships) in place and return the flat little-endian buffer."""
        flat = []
        for W, b in zip(self.W, self.b):
            W[...] = W.astype(np.float32)
            b[...] = b.astype(np.float32)
            flat += [W.ravel(), b.ravel()]
        return np.concatenate(flat).astype('<f4')

    def b64(self):
        return base64.b64encode(self.to_f32().tobytes()).decode('ascii')


def train(net, x, y, w=None, epochs=60, batch=2048, lr=3e-3, lr_end=3e-5, rng=None, log=None, val=None):
    """Weighted MSE. Cosine learning-rate decay. val = (xv, yv, wv) evaluated per epoch."""
    rng = rng or np.random.default_rng(0)
    n = len(x)
    w = np.ones(n) if w is None else w
    steps = epochs * max(1, n // batch)
    step = 0
    hist = []
    for ep in range(epochs):
        perm = rng.permutation(n)
        tot = 0.0
        for s in range(max(1, n // batch)):
            idx = perm[s * batch:(s + 1) * batch]
            out = net.forward(x[idx], keep=True)
            err = out - y[idx]
            ww = w[idx][:, None]
            tot += float((ww * err * err).sum())
            g = 2 * ww * err / (ww.sum() * y.shape[1])
            grads = net.backward(g)
            a = lr_end + 0.5 * (lr - lr_end) * (1 + math.cos(math.pi * step / steps))
            net.adam(grads, a)
            step += 1
        rec = dict(epoch=ep + 1, train=tot / (w.sum() * y.shape[1]))
        if val is not None:
            xv, yv, wv = val
            e = net.forward(xv) - yv
            rec['val'] = float((wv[:, None] * e * e).sum() / (wv.sum() * yv.shape[1]))
        hist.append(rec)
        if log and (ep % 10 == 9 or ep == 0):
            log(rec)
    return hist
