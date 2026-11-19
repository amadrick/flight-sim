"""Train the cloud multiple-scattering network (CPU, 2 threads, a few minutes).

  .venv/bin/python train.py --name main                      # the deployed factorised net (3 features)
  .venv/bin/python train.py --name plain3 --arch plain3      # big unfactorised MLP on the same 3 features (oracle)
  .venv/bin/python train.py --name oracle8 --arch oracle8    # big MLP on all 8 recorded features (oracle)

Loss: relative MSE on J_ms with *noise-free* weights,
    L = mean[ (exp(net) - y)^2 / (J_ss + J_ref)^2 ],   y = Monte Carlo estimate of J_ms (unbiased, noisy)
where J_ref is the network's own earlier prediction (no gradient; updated per epoch, then frozen).  Because the weight depends only on the
inputs, the minimiser is the conditional MEAN of the path-traced J_ms given the features - i.e. the fit is
energy-preserving and is not biased by the Monte Carlo noise (a log-space loss would be biased low).
--prior thick additionally re-weights the cloud population toward optically thick columns (see
model.column_prior_weight; the reported train/val relRMSE then use the same weights):
  .venv/bin/python train.py --name main_thick --epochs 24 --prior thick   # the optional thick-prior variant
The first epochs use a log-space loss as a robust warm start.
"""
import argparse
import json
import math
import os
import time
import numpy as np
import torch

import model as M


def load(split):
    return M.load_split(split)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--name', default='main')
    ap.add_argument('--arch', default='factor', choices=['factor', 'factor4', 'plain3', 'oracle8', 'plainx'])
    ap.add_argument('--extra', default='', help="plainx: comma list of extra dataset feature columns (3 tauDown, 4 tauView, 5 sigma, 6 mu0, 7 z/H)")
    ap.add_argument('--hidden', default='32,32')
    ap.add_argument('--rank', type=int, default=12)
    ap.add_argument('--epochs', type=int, default=40)
    ap.add_argument('--batch', type=int, default=8192)
    ap.add_argument('--freeze', type=float, default=0.3, help='fraction of epochs after which loss weights are frozen')
    ap.add_argument('--lr', type=float, default=3e-3)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--drop-up', action='store_true', help='ablation: hide tauUp from the network')
    ap.add_argument('--prior', default='dataset', choices=['dataset', 'thick'],
                    help="cloud-population prior: 'thick' re-weights samples by column optical thickness (model.column_prior_weight)")
    ap.add_argument('--threads', type=int, default=2)
    a = ap.parse_args()
    torch.set_num_threads(a.threads)
    torch.manual_seed(a.seed)
    np.random.seed(a.seed)
    os.makedirs('runs', exist_ok=True)

    tr, va = load('train'), load('val')
    hidden = tuple(int(h) for h in a.hidden.split(','))
    if a.arch == 'factor':
        net = M.ScatterNet(hidden, a.rank)
        fx = M.features_factor
    elif a.arch == 'factor4':
        net = M.ScatterNet(hidden, a.rank, n_extra=1)
        fx = M.features_factor4
    elif a.arch == 'plain3':
        net = M.PlainNet(5, hidden if a.hidden != '32,32' else (64, 64, 64))
        fx = M.features_main
    elif a.arch == 'plainx':
        cols = [int(c) for c in a.extra.split(',') if c]
        net = M.PlainNet(5 + len(cols), hidden if a.hidden != '32,32' else (64, 64, 64))
        fx = lambda feat: M.features_oracle(feat)[:, [0, 1, 2, 3, 4] + [5 + c - 3 for c in cols]]
    else:
        net = M.PlainNet(10, hidden if a.hidden != '32,32' else (64, 64, 64))
        fx = M.features_oracle
    if a.drop_up:
        fx = M.drop_up(fx)
    print('arch %s, %d parameters' % (a.arch, M.n_params(net)))

    xt = torch.from_numpy(fx(tr['feat']))
    yt = torch.from_numpy(0.5 * (tr['ja'] + tr['jb']).astype(np.float32))
    jss_t = torch.from_numpy(M.j_single(tr['feat']).astype(np.float32))
    xv = torch.from_numpy(fx(va['feat']))
    jss_v = M.j_single(va['feat'])
    pw_t = torch.from_numpy(M.column_prior_weight(tr['feat'], a.prior))    # population prior (mean 1)
    pw_tn = pw_t.numpy().astype(np.float64)
    pw_v = M.column_prior_weight(va['feat'], a.prior).astype(np.float64)
    print('prior %s: effective sample fraction %.3f' % (a.prior, 1.0 / float(np.mean(pw_tn ** 2))))
    n = len(yt)
    ref = torch.full((n,), 0.08)                     # J_ms reference for the weights (updated every epoch)
    steps_per_epoch = n // a.batch
    opt = torch.optim.Adam(net.parameters(), lr=a.lr)
    total = a.epochs * steps_per_epoch
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=total, pct_start=0.08,
                                                final_div_factor=300.0)
    warm = 2                                         # epochs of log-space warm start
    freeze = max(warm + 1, int(round(a.freeze * a.epochs)))   # after this epoch the loss weights stay fixed
    ja_v, jb_v = va['ja'].astype(np.float64), va['jb'].astype(np.float64)
    ja_t, jb_t = tr['ja'].astype(np.float64), tr['jb'].astype(np.float64)
    jss_tn = jss_t.numpy().astype(np.float64)
    ref_v = None
    log = []
    best = (1e9, None)
    t0 = time.time()
    for ep in range(a.epochs):
        net.train()
        perm = torch.randperm(n)
        run = 0.0
        for s in range(steps_per_epoch):
            idx = perm[s * a.batch:(s + 1) * a.batch]
            out = torch.clamp(net(xt[idx]), -25.0, 9.0)
            y = yt[idx]
            if ep < warm:
                loss = (pw_t[idx] * (out - torch.log(torch.clamp(y, min=1e-4))) ** 2).mean()
            else:
                w = pw_t[idx] / (jss_t[idx] + ref[idx]) ** 2
                loss = (w * (torch.exp(out) - y) ** 2).mean()
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
            opt.step()
            sched.step()
            run += loss.item()
        net.eval()
        with torch.no_grad():
            pt = torch.exp(torch.clamp(net(xt), -25.0, 9.0))
            pv = torch.exp(torch.clamp(net(xv), -25.0, 9.0)).numpy().astype(np.float64)
        if ep < freeze:
            ref = torch.clamp(pt, min=1e-4)          # lagged self-prediction as the (noise-free) relative weight
            ref_v = np.maximum(pv, 1e-4)
        # noise-debiased relative RMSE of total J with the current (frozen after `freeze`) weights
        ptn = pt.numpy().astype(np.float64)
        v = float(np.mean(pw_v * (pv - ja_v) * (pv - jb_v) / (jss_v + ref_v) ** 2))
        t = float(np.mean(pw_tn * (ptn - ja_t) * (ptn - jb_t) / (jss_tn + ref.numpy().astype(np.float64)) ** 2))
        rec = dict(epoch=ep + 1, train_loss=run / steps_per_epoch, train_rel_rmse=math.sqrt(max(t, 0)),
                   val_rel_rmse=math.sqrt(max(v, 0)), lr=sched.get_last_lr()[0], seconds=time.time() - t0,
                   weights_frozen=bool(ep >= freeze))
        log.append(rec)
        print('ep %3d%s loss %.4f  train relRMSE %.4f  val relRMSE %.4f  lr %.2e  %.0fs' % (
            rec['epoch'], '*' if ep >= freeze else ' ', rec['train_loss'], rec['train_rel_rmse'], rec['val_rel_rmse'],
            rec['lr'], rec['seconds']), flush=True)
        if ep >= freeze and v < best[0]:
            best = (v, {k: t_.clone() for k, t_ in net.state_dict().items()})
    net.load_state_dict(best[1])
    torch.save(dict(state=net.state_dict(), arch=a.arch, hidden=list(getattr(net, 'hidden', hidden)),
                    rank=a.rank, params=M.n_params(net), extra=a.extra, drop_up=a.drop_up, prior=a.prior), 'runs/%s.pt' % a.name)
    with open('runs/%s.json' % a.name, 'w') as f:
        json.dump(dict(name=a.name, arch=a.arch, params=M.n_params(net), epochs=a.epochs, batch=a.batch, lr=a.lr, prior=a.prior,
                       train_samples=int(n), val_samples=int(len(xv)), best_val_rel_rmse=math.sqrt(max(best[0], 0)),
                       seconds=time.time() - t0, log=log), f, indent=1)
    print('best val relRMSE %.4f, saved runs/%s.pt (%.0f s)' % (math.sqrt(max(best[0], 0)), a.name, time.time() - t0))


if __name__ == '__main__':
    main()
