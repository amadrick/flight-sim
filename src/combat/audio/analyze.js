// Signal analysis for the offline harness (pure maths on Float32Arrays; also works in node).
export const SR = 44100;
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) {
      const a = i + j, b = i + j + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr; } }
  }
}
const seg = (x, t0, t1, sr) => [Math.max(0, Math.floor(t0 * sr)), Math.min(x.length, Math.floor(t1 * sr))];
/** averaged power spectrum over [t0,t1] (Hann, 50 % overlap) */
export function spectrum(x, t0, t1, N = 4096, sr = SR) {
  const [a, b] = seg(x, t0, t1, sr), mag = new Float64Array(N / 2); let cnt = 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let s = a; s + N <= b; s += N / 2) {
    for (let k = 0; k < N; k++) { re[k] = x[s + k] * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / N)); im[k] = 0; }
    fft(re, im); for (let k = 0; k < N / 2; k++) mag[k] += re[k] * re[k] + im[k] * im[k]; cnt++;
  }
  for (let k = 0; k < mag.length; k++) mag[k] /= Math.max(1, cnt);
  return { mag, df: sr / N };
}
export function rms(x, t0, t1, sr = SR) { const [a, b] = seg(x, t0, t1, sr); let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); }
export function peak(x, t0 = 0, t1 = Infinity, sr = SR) { const [a, b] = seg(x, t0, t1, sr); let p = 0; for (let i = a; i < b; i++) p = Math.max(p, Math.abs(x[i])); return p; }
export function mean(x, t0 = 0, t1 = Infinity, sr = SR) { const [a, b] = seg(x, t0, t1, sr); let s = 0; for (let i = a; i < b; i++) s += x[i]; return s / Math.max(1, b - a); }
export const db = (v) => 20 * Math.log10(Math.max(v, 1e-9));
export function centroid(x, t0, t1, sr = SR) { const { mag, df } = spectrum(x, t0, t1, 4096, sr); let n = 0, d = 0; for (let k = 1; k < mag.length; k++) { n += k * df * mag[k]; d += mag[k]; } return d ? n / d : 0; }
export function bandFrac(x, t0, t1, f0, f1, sr = SR) { const { mag, df } = spectrum(x, t0, t1, 4096, sr); let s = 0, tot = 0; for (let k = 1; k < mag.length; k++) { const f = k * df; tot += mag[k]; if (f >= f0 && f < f1) s += mag[k]; } return tot ? s / tot : 0; }
export function peakFreq(x, t0, t1, f0 = 50, f1 = 9000, sr = SR, N = 8192) { const { mag, df } = spectrum(x, t0, t1, N, sr); let best = 0, bk = 0; for (let k = 1; k < mag.length; k++) { const f = k * df; if (f >= f0 && f <= f1 && mag[k] > best) { best = mag[k]; bk = k; } } return bk * df; }
/** fraction of spectral energy within ±tol Hz of the strongest peak (purity of a tone) */
export function tonePurity(x, t0, t1, tol = 30, sr = SR) {
  const { mag, df } = spectrum(x, t0, t1, 8192, sr); let best = 0, bk = 0, tot = 0;
  for (let k = 1; k < mag.length; k++) { tot += mag[k]; if (mag[k] > best) { best = mag[k]; bk = k; } }
  let s = 0; for (let k = Math.max(1, bk - Math.ceil(tol / df)); k <= Math.min(mag.length - 1, bk + Math.ceil(tol / df)); k++) s += mag[k];
  return { f: bk * df, purity: tot ? s / tot : 0 };
}
/** short-window RMS envelope (dB) */
export function envelope(x, t0, t1, win = 0.01, sr = SR) {
  const w = Math.max(1, Math.floor(win * sr)), [a, b] = seg(x, t0, t1, sr), out = [];
  for (let i = a; i + w <= b; i += w) { let s = 0; for (let k = 0; k < w; k++) s += x[i + k] * x[i + k]; out.push(db(Math.sqrt(s / w))); }
  return out;
}
/** attack (time to reach within 3 dB of the max) and decay (time from max until 20 dB below it), seconds */
export function attackDecay(x, t0, t1, win = 0.002, sr = SR) {
  const e = envelope(x, t0, t1, win, sr); let mx = -Infinity, im = 0; e.forEach((v, i) => { if (v > mx) { mx = v; im = i; } });
  let ia = 0; while (ia < e.length && e[ia] < mx - 3) ia++;
  let id = im; while (id < e.length && e[id] > mx - 20) id++;
  let i0 = 0; while (i0 < e.length && e[i0] < mx - 40) i0++;
  return { attack: (ia - i0) * win, decay: (id - im) * win, peakDb: mx };
}
/** longest run (s) of windows quieter than `floorDb` inside [t0,t1] */
export function longestGap(x, t0, t1, floorDb = -60, win = 0.05, sr = SR) {
  const e = envelope(x, t0, t1, win, sr); let run = 0, best = 0; for (const v of e) { if (v < floorDb) { run++; best = Math.max(best, run); } else run = 0; }
  return best * win;
}
export const mono = (buf) => { const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a, m = new Float32Array(a.length); for (let i = 0; i < a.length; i++) m[i] = 0.5 * (a[i] + b[i]); return m; };
/** stereo width: side/mid energy ratio */
export function width(buf, t0, t1, sr = SR) {
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, [a, b] = seg(L, t0, t1, sr); let m = 0, s = 0;
  for (let i = a; i < b; i++) { const M = L[i] + R[i], S = L[i] - R[i]; m += M * M; s += S * S; }
  return m ? Math.sqrt(s / m) : 0;
}
/** dominant beat period (s) from the autocorrelation of the low-band onset envelope */
export function beatPeriod(x, t0, t1, lo = 0.25, hi = 1.2, sr = SR, cutoff = 150) {
  const w = Math.floor(0.005 * sr), [a, b] = seg(x, t0, t1, sr), env = [];
  let lp = 0; const k = 1 - Math.exp(-2 * Math.PI * cutoff / sr);
  let acc = 0, n = 0, prev = 0;
  for (let i = a; i < b; i++) { lp += k * (x[i] - lp); acc += lp * lp; if (++n === w) { const v = Math.sqrt(acc / w); env.push(Math.max(0, v - prev)); prev = v; acc = 0; n = 0; } }
  let best = 0, bl = 0;
  for (let lag = Math.floor(lo / 0.005); lag <= Math.floor(hi / 0.005); lag++) { let s = 0, c = 0; for (let i = 0; i + lag < env.length; i++) { s += env[i] * env[i + lag]; c++; } s /= Math.max(1, c); if (s > best) { best = s; bl = lag; } }
  return bl * 0.005;
}
