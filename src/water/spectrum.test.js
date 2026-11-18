import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from './spectrum.js';

test('significant wave height grows with wind (calm swell .. storm)', () => {
  const hs = (U) => {
    const sea = S.makeSeaState(U, 0.4);
    const cdfH = S.slopeCDF(sea); // just exercise
    assert.ok(cdfH.cu[cdfH.cu.length - 1] > 0);
    const N = 128, L = 2000, g = S.gaussianField(N * N, 3);
    return 4 * Math.sqrt(S.buildCascade(sea, N, L, 0, 1e9, g).varH);
  };
  const a = hs(3), b = hs(17);
  assert.ok(a > 0.4 && a < 1.2, 'calm Hs ' + a);
  assert.ok(b > 2.5 && b < 7, 'storm Hs ' + b);
});

test('h0 packing is Hermitian: direct inverse DFT is real and matches evalHeight', () => {
  const sea = S.makeSeaState(8, 1.1);
  const N = 16, L = 120, g = S.gaussianField(N * N, 9);
  const { h0 } = S.buildCascade(sea, N, L, 0, 1e9, g);
  const comps = S.strongestComponents([{ N, L, h0 }], 1e9);
  const t = 37.3, dk = 2 * Math.PI / L, tf = (t % S.TIME_PERIOD) / S.TIME_PERIOD;
  for (const [x, z] of [[3, 7], [55.5, -12], [100, 40]]) {
    let re = 0, im = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const mx = i < N / 2 ? i : i - N, mz = j < N / 2 ? j : j - N;
      const kx = mx * dk, kz = mz * dk, idx = (j * N + i) * 4;
      const wt = 2 * Math.PI * ((S.dispersionIndex(Math.hypot(kx, kz)) * tf) % 1);
      const c = Math.cos(wt), s = Math.sin(wt);
      // h~ = h0 e^{-iwt} + h0m e^{iwt}
      const hr = h0[idx] * c + h0[idx + 1] * s + h0[idx + 2] * c - h0[idx + 3] * s;
      const hi = h0[idx + 1] * c - h0[idx] * s + h0[idx + 3] * c + h0[idx + 2] * s;
      const ph = kx * x + kz * z;
      re += hr * Math.cos(ph) - hi * Math.sin(ph); im += hr * Math.sin(ph) + hi * Math.cos(ph);
    }
    assert.ok(Math.abs(im) < 1e-4, 'imaginary part ' + im);
    assert.ok(Math.abs(re - S.evalHeight(comps, x, z, t)) < 1e-4);
  }
});

test('analytic variance tables agree with the exact discrete sums', () => {
  const sea = S.makeSeaState(10, -0.7);
  const casc = [{ N: 128, L: 1000 }, { N: 128, L: 137 }, { N: 128, L: 19 }];
  casc[0].kLo = 0; casc[0].kHi = casc[1].kLo = 6 * 2 * Math.PI / 137; casc[1].kHi = casc[2].kLo = 6 * 2 * Math.PI / 19; casc[2].kHi = 1e9;
  const { table } = S.varianceTables(sea, casc);
  casc.forEach((c, ci) => {
    const g = S.gaussianField(c.N * c.N, 1);
    const { varRes } = S.buildCascade(sea, c.N, c.L, c.kLo, Math.min(c.kHi, Math.PI * c.N / c.L), g);
    const tot = varRes[0] + varRes[1];
    for (const l of [1, 3]) {
      const exactUnres = tot - (varRes[l * 2] + varRes[l * 2 + 1]);
      const est = table[(ci * S.LEVELS + l) * 2] + table[(ci * S.LEVELS + l) * 2 + 1];
      const est0 = table[(ci * S.LEVELS) * 2] + table[(ci * S.LEVELS) * 2 + 1];
      assert.ok(Math.abs((est - est0) - exactUnres) < 0.35 * tot + 1e-5, `cascade ${ci} level ${l}: ${est - est0} vs ${exactUnres} (tot ${tot})`);
    }
  });
});

test('components travel downwind', () => {
  const sea = S.makeSeaState(9, 0); // waves move toward +x
  const N = 64, L = 400, g = S.gaussianField(N * N, 5);
  const casc = [{ N, L, kLo: 0, kHi: 1e9 }];
  const comps = S.componentsFor(sea, casc, [g], 32, 12);
  // cross-correlate h(x, t) with h(x + d, t + 2): best d should be positive (phase speed of the peak ~ 10 m/s)
  let best = -1e9, bestD = 0;
  for (let d = -40; d <= 40; d += 2) {
    let s = 0; for (let x = 0; x < 400; x += 3) s += S.evalHeight(comps, x, 0, 10) * S.evalHeight(comps, x + d, 0, 12);
    if (s > best) { best = s; bestD = d; }
  }
  assert.ok(bestD > 0, 'phase shift ' + bestD);
});
