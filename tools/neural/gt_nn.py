"""Tiny numpy MLP (Adam, manual backprop) for the cloud lighting fits; no torch on this machine.

    net = MLP([n_in, 16, 16, n_out], seed); net.fit(X, loss_grad_fn, ...); y = net(X)

Hidden activation: ISRU-like softsign x / sqrt(1 + x^2) (smooth, cheap in GLSL, same as the round-one networks).
"""
import numpy as np


def act(x):
    return x / np.sqrt(1 + x * x)


def dact(x):
    return (1 + x * x) ** -1.5


class MLP:
    def __init__(self, sizes, seed=0):
        rng = np.random.default_rng(seed)
        self.W = [rng.normal(0, np.sqrt(1.0 / a), (a, b)) for a, b in zip(sizes[:-1], sizes[1:])]
        self.b = [np.zeros(b) for b in sizes[1:]]
        self.sizes = sizes

    def forward(self, X, keep=False):
        h = X
        cache = []
        for i, (W, b) in enumerate(zip(self.W, self.b)):
            z = h @ W + b
            cache.append((h, z))
            h = act(z) if i < len(self.W) - 1 else z
        return (h, cache) if keep else h

    __call__ = forward

    def grads(self, X, dY):
        _, cache = self.forward(X, keep=True)
        gW, gb = [None] * len(self.W), [None] * len(self.W)
        d = dY
        for i in range(len(self.W) - 1, -1, -1):
            h, z = cache[i]
            if i < len(self.W) - 1:
                d = d * dact(z)
            gW[i] = h.T @ d
            gb[i] = d.sum(0)
            d = d @ self.W[i].T
        return gW, gb

    def fit(self, X, loss_fn, epochs=60, batch=1024, lr=3e-3, seed=1, l2=1e-5, verbose=False, decay=0.97):
        """loss_fn(Y_pred, idx) -> (loss, dL/dY) for the rows idx of the training set."""
        rng = np.random.default_rng(seed)
        mW = [np.zeros_like(w) for w in self.W]; vW = [np.zeros_like(w) for w in self.W]
        mb = [np.zeros_like(b) for b in self.b]; vb = [np.zeros_like(b) for b in self.b]
        t = 0
        n = len(X)
        for ep in range(epochs):
            perm = rng.permutation(n)
            tot = 0
            for s in range(0, n, batch):
                idx = perm[s:s + batch]
                Y = self.forward(X[idx])
                loss, dY = loss_fn(Y, idx)
                tot += loss * len(idx)
                gW, gb = self.grads(X[idx], dY)
                t += 1
                for i in range(len(self.W)):
                    gW[i] = gW[i] + l2 * self.W[i]
                    for p, g, m, v in ((self.W, gW, mW, vW), (self.b, gb, mb, vb)):
                        m[i] = 0.9 * m[i] + 0.1 * g[i]
                        v[i] = 0.999 * v[i] + 0.001 * g[i] ** 2
                        p[i] -= lr * (m[i] / (1 - 0.9 ** t)) / (np.sqrt(v[i] / (1 - 0.999 ** t)) + 1e-8)
            lr *= decay
            if verbose and (ep % 10 == 0 or ep == epochs - 1):
                print('  epoch %d loss %.4f' % (ep, tot / n), flush=True)
        return self

    def n_params(self):
        return sum(w.size + b.size for w, b in zip(self.W, self.b))
