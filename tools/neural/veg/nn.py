"""A tiny numpy MLP with manual backprop and Adam (no torch).  Hidden activation ISRU z / sqrt(1 + z^2): smooth,
tanh-like, and one sqrt in GLSL / JS.  The JS twin is src/neural/veg-mlp.js (forward only)."""
import numpy as np


def isru(z):
    return z / np.sqrt(1.0 + z * z)


def isru_grad(z):
    return (1.0 + z * z) ** -1.5


class MLP:
    def __init__(self, sizes, rng):
        self.sizes = list(sizes)
        self.W, self.b = [], []
        for i in range(len(sizes) - 1):
            s = np.sqrt(2.0 / (sizes[i] + sizes[i + 1]))
            self.W.append(rng.standard_normal((sizes[i + 1], sizes[i])) * s)
            self.b.append(np.zeros(sizes[i + 1]))
        self.m = [np.zeros_like(p) for p in self.params()]
        self.v = [np.zeros_like(p) for p in self.params()]
        self.t = 0

    def params(self):
        out = []
        for W, b in zip(self.W, self.b):
            out += [W, b]
        return out

    def nparams(self):
        return sum(p.size for p in self.params())

    def forward(self, x, keep=False):
        zs, hs = [], [x]
        h = x
        for i, (W, b) in enumerate(zip(self.W, self.b)):
            z = h @ W.T + b
            if i < len(self.W) - 1:
                zs.append(z)
                h = isru(z)
            else:
                h = z
            hs.append(h)
        if keep:
            self._zs, self._hs = zs, hs
        return h

    def backward(self, gout):
        """gout = dLoss/dOutput (n, nout). Returns grads in params() order."""
        grads = [None] * (2 * len(self.W))
        g = gout
        for i in range(len(self.W) - 1, -1, -1):
            h = self._hs[i]
            grads[2 * i] = g.T @ h
            grads[2 * i + 1] = g.sum(0)
            if i > 0:
                g = (g @ self.W[i]) * isru_grad(self._zs[i - 1])
        return grads

    def adam(self, grads, lr, b1=0.9, b2=0.999, eps=1e-8):
        self.t += 1
        for k, (p, g) in enumerate(zip(self.params(), grads)):
            self.m[k] = b1 * self.m[k] + (1 - b1) * g
            self.v[k] = b2 * self.v[k] + (1 - b2) * g * g
            mh = self.m[k] / (1 - b1 ** self.t)
            vh = self.v[k] / (1 - b2 ** self.t)
            p -= lr * mh / (np.sqrt(vh) + eps)

    def round_f32(self):
        for k in range(len(self.W)):
            self.W[k] = self.W[k].astype(np.float32).astype(np.float64)
            self.b[k] = self.b[k].astype(np.float32).astype(np.float64)


def train(net, X, Y, Wt, loss_grad, epochs=200, batch=512, lr=3e-3, rng=None, log=None, Xv=None, Yv=None, Wv=None):
    """loss_grad(pred, Y, Wt) -> (loss, dpred). Cosine-decayed Adam."""
    n = len(X)
    steps = epochs * max(1, n // batch)
    st = 0
    for ep in range(epochs):
        perm = rng.permutation(n)
        tot = 0.0
        for i in range(0, n - batch + 1, batch):
            ix = perm[i:i + batch]
            pred = net.forward(X[ix], keep=True)
            l, g = loss_grad(pred, Y[ix], Wt[ix])
            tot += l
            cur = lr * (0.02 + 0.98 * 0.5 * (1 + np.cos(np.pi * st / steps)))
            net.adam(net.backward(g), cur)
            st += 1
        if log and (ep % 20 == 0 or ep == epochs - 1):
            msg = f'epoch {ep} train {tot / max(1, n // batch):.5f}'
            if Xv is not None:
                lv, _ = loss_grad(net.forward(Xv), Yv, Wv)
                msg += f' val {lv:.5f}'
            log(msg)
    return net
