// One-shot sound effects and warning patterns. Every function schedules at absolute time `t` into `dest`
// and returns the pattern duration. Nodes self-destruct via shot().
import { gain, biquad, noiseSrc, chain, shot, envAD, rand, clamp, sat } from './dsp.js';

const MAXLIVE = 72;
import { liveShots } from './dsp.js';
const busy = () => liveShots() > MAXLIVE;

/** noise burst: kind, filter list [[type,f,q]...] (frequency may be [f0,f1] to sweep), peak, attack, decay */
export function burst(ac, dest, t, { kind = 'white', filters = [], peak = 1, atk = 0.004, dec = 0.1, sweepDur } = {}) {
  if (busy()) return 0;
  const n = noiseSrc(ac, kind, t), g = gain(ac, 0), fs = [];
  for (const [type, f, q = 0.7] of filters) {
    const bq = biquad(ac, type, Array.isArray(f) ? f[0] : f, q);
    if (Array.isArray(f)) { bq.frequency.setValueAtTime(f[0], t); bq.frequency.exponentialRampToValueAtTime(Math.max(20, f[1]), t + (sweepDur ?? (atk + dec))); }
    fs.push(bq);
  }
  chain(n, ...fs, g, dest); envAD(g.gain, t, peak, atk, dec);
  shot(ac, t, atk + dec, [n], [g, ...fs]);
  return atk + dec;
}
/** oscillator tone with optional pitch glide and envelope */
export function tone(ac, dest, t, { type = 'sine', f0 = 440, f1, dur = 0.2, peak = 0.3, atk = 0.006, rel = 0.03, filter, detune = 0 } = {}) {
  if (busy()) return 0;
  const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (detune) o.detune.value = detune;
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = gain(ac, 0); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + atk); g.gain.setValueAtTime(peak, Math.max(t + atk, t + dur - rel)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o.connect(g);
  if (filter) { const f = biquad(ac, filter[0], filter[1], filter[2] ?? 0.7); g.connect(f); node = f; }
  node.connect(dest); o.start(t); shot(ac, t, dur, [o], [g]);
  return dur;
}

// ---- mechanical ----------------------------------------------------------------------------------------
export function thunk(ac, dest, t, s = 1, f = 110) {            // door/uplock/lock clunk
  tone(ac, dest, t, { f0: f * 1.8, f1: f * 0.7, dur: 0.12, peak: 0.55 * s, atk: 0.002, rel: 0.1 });
  burst(ac, dest, t, { kind: 'brown', filters: [['lowpass', 500, 0.9]], peak: 1.1 * s, atk: 0.002, dec: 0.14 });
  burst(ac, dest, t, { kind: 'white', filters: [['bandpass', 1800, 1.5]], peak: 0.25 * s, atk: 0.001, dec: 0.03 });
}
export function click(ac, dest, t, s = 1) {
  burst(ac, dest, t, { kind: 'white', filters: [['bandpass', 3000, 1.2]], peak: 0.5 * s, atk: 0.0006, dec: 0.012 });
  tone(ac, dest, t + 0.004, { f0: 900, f1: 600, dur: 0.012, peak: 0.12 * s, atk: 0.001, rel: 0.006 });
}
export function tick(ac, dest, t, s = 1) {                       // runway joint thump
  burst(ac, dest, t, { kind: 'brown', filters: [['lowpass', 180, 0.8]], peak: 0.9 * s, atk: 0.003, dec: 0.07 });
}
export function tyreChirp(ac, dest, t, s = 1) {
  burst(ac, dest, t, { kind: 'white', filters: [['bandpass', [900, 1900], 3.5], ['highpass', 500, 0.7]], peak: 0.75 * s, atk: 0.012, dec: 0.28, sweepDur: 0.3 });
  tone(ac, dest, t, { type: 'sawtooth', f0: 760, f1: 1250, dur: 0.3, peak: 0.07 * s, atk: 0.02, rel: 0.2, filter: ['bandpass', 1100, 5] });
  burst(ac, dest, t + 0.04, { kind: 'pink', filters: [['bandpass', 450, 0.8]], peak: 0.4 * s, atk: 0.02, dec: 0.4 });
}
export function touchdown(ac, dest, t, s = 1) {                 // main-gear impact thump
  tone(ac, dest, t, { f0: 120, f1: 38, dur: 0.35, peak: 0.9 * s, atk: 0.003, rel: 0.3 });
  burst(ac, dest, t, { kind: 'brown', filters: [['lowpass', 400, 0.8]], peak: 1.4 * s, atk: 0.003, dec: 0.3 });
  burst(ac, dest, t, { kind: 'pink', filters: [['bandpass', 900, 0.7]], peak: 0.35 * s, atk: 0.002, dec: 0.1 });
  tyreChirp(ac, dest, t + 0.01, clamp(s, 0.25, 1.2));
}
export function noseThump(ac, dest, t, s = 1) {
  tone(ac, dest, t, { f0: 95, f1: 42, dur: 0.22, peak: 0.6 * s, atk: 0.003, rel: 0.18 });
  burst(ac, dest, t, { kind: 'brown', filters: [['lowpass', 320, 0.8]], peak: 0.85 * s, atk: 0.003, dec: 0.18 });
}

// ---- big events -----------------------------------------------------------------------------------------
export function sonicBoom(ac, dest, t, s = 1) {                  // N-wave double thump
  for (let i = 0; i < 2; i++) {
    const tt = t + i * 0.14 + (i ? 0.02 * rand() : 0);
    tone(ac, dest, tt, { f0: 70, f1: 28, dur: 0.5, peak: (i ? 0.7 : 1) * s, atk: 0.002, rel: 0.45 });
    burst(ac, dest, tt, { kind: 'white', filters: [['bandpass', 600, 0.5], ['lowpass', 2500, 0.7]], peak: (i ? 0.9 : 1.5) * s, atk: 0.001, dec: 0.12 });
    burst(ac, dest, tt, { kind: 'brown', filters: [['lowpass', 220, 0.8]], peak: 1.8 * s, atk: 0.002, dec: 0.6 });
  }
  burst(ac, dest, t + 0.2, { kind: 'pink', filters: [['bandpass', 140, 0.6]], peak: 0.6 * s, atk: 0.1, dec: 2.2 });   // rolling rumble
  return 3;
}
export function explosion(ac, dest, t, s = 1) {
  tone(ac, dest, t, { f0: 85, f1: 20, dur: 1.4, peak: 1.0 * s, atk: 0.004, rel: 1.2 });
  burst(ac, dest, t, { kind: 'brown', filters: [['lowpass', [3000, 90], 0.7]], peak: 3.0 * s, atk: 0.003, dec: 1.8, sweepDur: 1.6 });
  burst(ac, dest, t, { kind: 'white', filters: [['bandpass', [4000, 400], 0.6]], peak: 1.1 * s, atk: 0.001, dec: 0.5, sweepDur: 0.5 });
  // debris tail: falling fragments and secondary crackle
  for (let i = 0; i < 28; i++) {
    const d = 0.15 + Math.pow(rand(), 0.7) * 4.2, a = (1 - d / 4.6) * (0.2 + 0.5 * rand());
    burst(ac, dest, t + d, { kind: rand() < 0.5 ? 'white' : 'pink', filters: [['bandpass', 250 + rand() * 2600, 1.2 + rand() * 2]], peak: a * s, atk: 0.001, dec: 0.03 + rand() * 0.12 });
  }
  for (let i = 0; i < 5; i++) thunk(ac, dest, t + 0.5 + rand() * 3, 0.5 * s, 70 + rand() * 80);
  burst(ac, dest, t + 0.2, { kind: 'brown', filters: [['lowpass', 160, 0.7]], peak: 0.9 * s, atk: 0.2, dec: 3.5 });
  return 5;
}
/** thunder: closer = sharper crack, farther = lower and longer. `dist` in metres. */
export function thunder(ac, dest, t, dist, intensity = 1) {
  const d = clamp(dist, 0, 25000), far = sat(d / 12000);
  const dur = 2.2 + 8 * far + 1.5 * intensity, cut = 2600 * Math.pow(1 - far, 1.5) + 260;
  if (d < 6000) burst(ac, dest, t, { kind: 'white', filters: [['bandpass', 1200 * (1 - far) + 400, 0.5], ['lowpass', cut, 0.7]], peak: 1.4 * intensity * (1 - far), atk: 0.002, dec: 0.25 });
  // rolling rumble: many staggered brown-noise swells
  const n = 7 + Math.floor(5 * intensity);
  for (let i = 0; i < n; i++) {
    const at = t + (i / n) * dur * 0.7 * rand() + 0.02 + i * 0.03;
    burst(ac, dest, at, { kind: 'brown', filters: [['lowpass', cut * (0.4 + 0.6 * rand()), 0.8]], peak: (0.9 - 0.7 * far * 0.5) * intensity * (0.3 + 0.7 * rand()) * 1.6, atk: 0.08 + 0.4 * far + 0.2 * rand(), dec: dur * (0.2 + 0.4 * rand()) });
  }
  return dur;
}

// ---- cockpit warnings -------------------------------------------------------------------------------------
export function stallFighter(ac, dest, t) {                      // low-speed warning bleeps
  tone(ac, dest, t, { type: 'square', f0: 660, dur: 0.13, peak: 0.1, filter: ['lowpass', 2400] });
  tone(ac, dest, t + 0.16, { type: 'square', f0: 495, dur: 0.13, peak: 0.1, filter: ['lowpass', 2400] });
  return 0.55;
}
export function stickShaker(ac, dest, t, dur = 0.5) {            // rotary shaker motor rattle
  if (busy()) return 0;
  const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = 27;
  const am = gain(ac, 0), bp = biquad(ac, 'bandpass', 110, 1.6), n = noiseSrc(ac, 'brown', t), nb = biquad(ac, 'bandpass', 600, 1.2), ng = gain(ac, 0);
  const o2 = ac.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 54; const o2g = gain(ac, 0.25);
  const out = gain(ac, 0); out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(0.9, t + 0.02); out.gain.setValueAtTime(0.9, t + dur - 0.03); out.gain.linearRampToValueAtTime(0.0001, t + dur);
  chain(o, am, bp, out); chain(o2, o2g, bp); chain(n, nb, ng, out); am.gain.value = 0.9; ng.gain.value = 0.5; out.connect(dest);
  const lfo = ac.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 27; const lg = gain(ac, 0.5); lfo.connect(lg); lg.connect(ng.gain);
  o.start(t); o2.start(t); lfo.start(t); shot(ac, t, dur, [n, o2, lfo, o], [out, am, bp, nb, ng]);
  return dur;
}
export function clacker(ac, dest, t) {                           // overspeed clacker: hammered bell
  for (let i = 0; i < 3; i++) {
    const tt = t + i * 0.125;
    burst(ac, dest, tt, { kind: 'white', filters: [['bandpass', 1100, 1.6]], peak: 0.9, atk: 0.0008, dec: 0.05 });
    tone(ac, dest, tt, { type: 'triangle', f0: 520, f1: 470, dur: 0.07, peak: 0.28, atk: 0.001, rel: 0.05 });
  }
  return 0.4;
}
export function overG(ac, dest, t) { for (let i = 0; i < 3; i++) tone(ac, dest, t + i * 0.13, { f0: 1040, dur: 0.07, peak: 0.16 }); return 0.7; }
export function masterCaution(ac, dest, t) {
  tone(ac, dest, t, { f0: 1175, dur: 0.35, peak: 0.16, atk: 0.003, rel: 0.3 }); tone(ac, dest, t + 0.002, { f0: 2351, dur: 0.2, peak: 0.04, rel: 0.18 });
  tone(ac, dest, t + 0.2, { f0: 880, dur: 0.45, peak: 0.16, atk: 0.003, rel: 0.4 }); tone(ac, dest, t + 0.202, { f0: 1762, dur: 0.25, peak: 0.04, rel: 0.2 });
  return 1.1;
}
export function gearHorn(ac, dest, t, airliner) {
  if (airliner) { tone(ac, dest, t, { type: 'square', f0: 480, dur: 0.22, peak: 0.1, filter: ['lowpass', 1500] }); tone(ac, dest, t + 0.3, { type: 'square', f0: 480, dur: 0.22, peak: 0.1, filter: ['lowpass', 1500] }); return 1.2; }
  tone(ac, dest, t, { type: 'sawtooth', f0: 210, dur: 0.55, peak: 0.14, atk: 0.02, rel: 0.1, filter: ['lowpass', 900] }); tone(ac, dest, t, { type: 'square', f0: 105, dur: 0.55, peak: 0.1, atk: 0.02, rel: 0.1, filter: ['lowpass', 500] });
  return 1.4;
}
export function whoop(ac, dest, t, n = 2) {                      // GPWS "whoop whoop"
  for (let i = 0; i < n; i++) tone(ac, dest, t + i * 0.42, { type: 'sawtooth', f0: 380, f1: 1000, dur: 0.34, peak: 0.14, atk: 0.03, rel: 0.05, filter: ['lowpass', 2600] });
  return n * 0.42 + 0.1;
}
export function pullUpTones(ac, dest, t) {
  for (let i = 0; i < 3; i++) tone(ac, dest, t + i * 0.16, { type: 'square', f0: 740 + i * 90, dur: 0.12, peak: 0.1, filter: ['lowpass', 2800] });
  return 0.6;
}
/** distinct tone signature per radio-altitude call-out (when speech is unavailable) */
export function calloutTones(ac, dest, t, ft) {
  const seq = { 1000: [523, 659], 500: [587, 740, 880], 100: [880, 880], 50: [1047], 40: [988], 30: [932], 20: [880], 10: [784] }[ft] || [700];
  seq.forEach((f, i) => tone(ac, dest, t + i * 0.13, { f0: f, dur: 0.11, peak: 0.12, atk: 0.004, rel: 0.05, type: 'triangle' }));
  return seq.length * 0.13 + 0.05;
}
export function apDisconnect(ac, dest, t) {                      // autopilot disconnect wail
  if (busy()) return 0;
  const o = ac.createOscillator(); o.type = 'square'; const f = biquad(ac, 'lowpass', 2600, 0.8), g = gain(ac, 0);
  const o2 = ac.createOscillator(); o2.type = 'sawtooth'; const g2 = gain(ac, 0.5);
  const dur = 1.9; let tt = t, hi = false;
  while (tt < t + dur) { const fr = hi ? 1020 : 640; o.frequency.setValueAtTime(fr, tt); o2.frequency.setValueAtTime(fr * 1.005, tt); tt += 0.15; hi = !hi; }
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.14, t + 0.02); g.gain.setValueAtTime(0.14, t + dur - 0.06); g.gain.linearRampToValueAtTime(0.0001, t + dur);
  chain(o, f, g, dest); chain(o2, g2, f); o.start(t); o2.start(t); shot(ac, t, dur, [o2, o], [f, g, g2]);
  return dur;
}
