"""Tiny numpy MLP trainer (no torch): G independent networks of identical shape trained side by side.

Hidden activation ISRU f(z) = z / sqrt(1 + z^2) (same as src/neural/mlp.js), linear output layer.
Weights: W[l] of shape (G, out, in) (row-major [out][in] per network, the layout mlp.js expects), b[l] (G, out).
"""
import numpy as np


def isru(z):
    return z / np.sqrt(1.0 + z * z)


class MLP:
    def __init__(self, sizes, G=1, seed=0):
        rng = np.random.default_rng(seed)
        self.sizes, self.G = list(sizes), G
        self.W, self.b = [], []
        for i in range(len(sizes) - 1):
            fan_in = sizes[i]
            self.W.append(rng.normal(0, 1.0 / np.sqrt(fan_in), (G, sizes[i + 1], sizes[i])))
            self.b.append(np.zeros((G, sizes[i + 1])))
        self.m = [np.zeros_like(p) for p in self.params()]
        self.v = [np.zeros_like(p) for p in self.params()]
        self.t = 0

    def params(self):
        out = []
        for W, b in zip(self.W, self.b):
            out += [W, b]
        return out

    def n_params(self):
        return sum(p.size for p in self.params()) // self.G

    def forward(self, x, keep=False):
        """x: (G, N, in) -> (G, N, out)."""
        acts = [x]
        h = x
        L = len(self.W)
        for l in range(L):
            z = np.einsum('gni,goi->gno', h, self.W[l]) + self.b[l][:, None, :]
            if l < L - 1:
                h = isru(z)
                if keep:
                    acts.append((z, h))
            else:
                h = z
        return (h, acts) if keep else h

    def backward(self, acts, dy):
        """dy: dLoss/dOutput (G, N, out). Returns grads in params() order."""
        L = len(self.W)
        grads = [None] * (2 * L)
        g = dy
        for l in range(L - 1, -1, -1):
            hin = acts[0] if l == 0 else acts[l][1]
            grads[2 * l] = np.einsum('gno,gni->goi', g, hin)
            grads[2 * l + 1] = g.sum(1)
            if l > 0:
                z = acts[l][0]
                g = np.einsum('gno,goi->gni', g, self.W[l])
                g = g * (1.0 + z * z) ** -1.5
        return grads

    def adam(self, grads, lr, b1=0.9, b2=0.999, eps=1e-8):
        self.t += 1
        for p, g, m, v in zip(self.params(), grads, self.m, self.v):
            m *= b1; m += (1 - b1) * g
            v *= b2; v += (1 - b2) * g * g
            mh = m / (1 - b1 ** self.t)
            vh = v / (1 - b2 ** self.t)
            p -= lr * mh / (np.sqrt(vh) + eps)

    def round_f32(self):
        for p in self.params():
            p[...] = p.astype(np.float32).astype(np.float64)

    def pack(self, g):
        """float32 flat array for network g: per layer W (row-major [out][in]) then b."""
        flat = []
        for W, b in zip(self.W, self.b):
            flat.append(W[g].astype(np.float32).ravel())
            flat.append(b[g].astype(np.float32).ravel())
        return np.concatenate(flat)


def train(net, X, Y, Wt=None, epochs=2000, batch=4096, lr=3e-3, lr_end=1e-4, seed=1, log_every=200, out_fn=None,
          loss_fn=None):
    """X: (G, N, in), Y: (G, N, out), Wt: optional sample weights (G, N, 1). MSE loss (weighted).
    out_fn(y_pred) -> (y_used, dy_used/dy_pred) lets the loss act on a transformed output.
    Cosine-decayed Adam, minibatches drawn per epoch."""
    rng = np.random.default_rng(seed)
    G, N, _ = X.shape
    if Wt is None:
        Wt = np.ones((G, N, 1))
    steps_per_epoch = max(1, N // batch)
    total = epochs * steps_per_epoch
    step = 0
    hist = []
    for ep in range(epochs):
        perm = rng.permutation(N)
        for s in range(steps_per_epoch):
            idx = perm[s * batch:(s + 1) * batch]
            xb, yb, wb = X[:, idx], Y[:, idx], Wt[:, idx]
            yp, acts = net.forward(xb, keep=True)
            if out_fn is not None:
                yu, dydp = out_fn(yp)
            else:
                yu, dydp = yp, 1.0
            err = yu - yb
            dy = 2.0 * wb * err * dydp / idx.size
            grads = net.backward(acts, dy)
            frac = step / max(1, total - 1)
            lr_t = lr_end + 0.5 * (lr - lr_end) * (1 + np.cos(np.pi * frac))
            net.adam(grads, lr_t)
            step += 1
        if log_every and (ep % log_every == 0 or ep == epochs - 1):
            yp = net.forward(X)
            yu = out_fn(yp)[0] if out_fn is not None else yp
            mse = (Wt * (yu - Y) ** 2).sum(axis=(1, 2)) / (Wt.sum(axis=(1, 2)) * Y.shape[2])
            hist.append((ep, mse.tolist()))
            print('  epoch %5d  rmse %s' % (ep, ' '.join('%.4f' % np.sqrt(m) for m in mse)), flush=True)
    return hist
