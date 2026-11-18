// Shared DSP helpers for the procedural audio engine. Everything here works with BOTH a live AudioContext and an
// OfflineAudioContext (the verification harness renders the very same graphs offline).

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Deterministic RNG so offline renders are repeatable (live audio just seeds differently).
export function rng(seed = 12345) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const rand = rng((Math.random() * 4294967296) >>> 0);

// ---- noise buffers (generated once per context, shared by every voice) ---------------------------------
// The buffers are made circularly seamless (equal-power crossfade of the tail into the head) so loops never click.
const cache = new WeakMap();
function seamless(d, xf) {
  const n = d.length;
  for (let i = 0; i < xf; i++) {
    const t = i / xf, a = Math.cos(t * Math.PI / 2), b = Math.sin(t * Math.PI / 2);
    // head sample i blends with the (virtual) continuation from the tail
    d[i] = d[i] * b + d[n - xf + i] * a;
  }
  return d.subarray(0, n - xf);
}
function makeBuf(ac, seconds, fill, seed) {
  const sr = ac.sampleRate, xf = Math.floor(sr * 0.05), n = Math.floor(sr * seconds) + xf, r = rng(seed);
  const raw = new Float32Array(n); fill(raw, r);
  const d = seamless(raw, xf);
  let e = 0; for (let i = 0; i < d.length; i++) e += d[i] * d[i]; const k = 0.3 / Math.sqrt(e / d.length + 1e-12);
  for (let i = 0; i < d.length; i++) d[i] *= k;
  const buf = ac.createBuffer(1, d.length, sr); buf.getChannelData(0).set(d); return buf;
}
export function noiseBuffers(ac) {
  let c = cache.get(ac); if (c) return c;
  const white = makeBuf(ac, 3.7, (d, r) => { for (let i = 0; i < d.length; i++) d[i] = (r() * 2 - 1) * 0.7; }, 11);
  const pink = makeBuf(ac, 4.3, (d, r) => { // Paul Kellet's refined pink filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
  }, 23);
  const brown = makeBuf(ac, 5.3, (d, r) => {
    let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (r() * 2 - 1)) / 1.02; d[i] = l * 3.2; }
    // remove DC / very slow drift so the loop is centred
    let m = 0; for (let i = 0; i < d.length; i++) m += d[i]; m /= d.length; for (let i = 0; i < d.length; i++) d[i] -= m;
  }, 37);
  c = { white, pink, brown }; cache.set(ac, c); return c;
}

/** Looping noise source starting at a random offset; returns the AudioBufferSourceNode (already started). */
export function noiseSrc(ac, kind = 'white', when = 0) {
  const s = ac.createBufferSource(); s.buffer = noiseBuffers(ac)[kind]; s.loop = true;
  s.start(when, rand() * s.buffer.duration); return tagAll(ac, s);
}

// ---- node helpers --------------------------------------------------------------------------------------
const PARAMS = ['gain', 'frequency', 'Q', 'detune', 'playbackRate', 'pan', 'delayTime'];
export function tagAll(ac, node) { for (const k of PARAMS) { const p = node[k]; if (p && typeof p === 'object' && 'value' in p) p._ac = ac; } return node; }
export const gain = (ac, v = 1) => { const g = ac.createGain(); g.gain.value = v; return tagAll(ac, g); };
export function biquad(ac, type, f, q = 0.707, g) {
  const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; if (g !== undefined) b.gain.value = g; return tagAll(ac, b);
}
export function osc(ac, type, f, detuneCents = 0) {
  const o = ac.createOscillator(); o.type = type; o.frequency.value = f; if (detuneCents) o.detune.value = detuneCents; o.start(); return tagAll(ac, o);
}
export function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
/** noise → filters… → gain; returns { src, out (gain), nodes } */
export function noiseVoice(ac, kind, filters, g = 0) {
  const src = noiseSrc(ac, kind), out = gain(ac, g), list = filters.map((f) => biquad(ac, ...f));
  chain(src, ...list, out); return { src, out, filters: list };
}

/** Smooth parameter write: ramp towards v with time constant tc (seconds). Skips tiny changes. */
export function set(param, v, tc = 0.05) {
  if (!(v === v) || !isFinite(v)) return;           // never feed NaN/Inf into the graph
  const last = param._last;
  if (last !== undefined && Math.abs(last - v) < 1e-5 + 1e-4 * Math.abs(v)) return;
  param._last = v;
  const ctxTime = param._ac ? param._ac.currentTime : 0;
  param.setTargetAtTime(v, ctxTime, tc);
}

// ---- one-shot scheduling helpers -------------------------------------------------------------------------
let live = 0;
export const liveShots = () => live;
/** Run builder(t) -> {nodes to stop, end time}; guards against runaway voice counts. */
export function shot(ac, t0, dur, stopFns, discon) {
  live++;
  const total = Math.max(0.02, dur);
  for (const s of stopFns) { try { s.stop(t0 + total + 0.05); } catch {} }
  const last = stopFns[stopFns.length - 1];
  if (last) last.onended = () => { live = Math.max(0, live - 1); for (const n of discon || []) { try { n.disconnect(); } catch {} } };
  else live--;
}
/** Exponential-ish AD envelope on a gain param. */
export function envAD(param, t, peak, atk, dec, floor = 0.0001) {
  param.cancelScheduledValues(t); param.setValueAtTime(floor, t);
  param.linearRampToValueAtTime(peak, t + atk);
  param.exponentialRampToValueAtTime(floor, t + atk + dec);
}

/** Soft clip curve (tanh) for the final limiter stage. */
export function tanhCurve(n = 2048, drive = 1) {
  const c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / Math.tanh(drive); }
  return c;
}
/** Hard crackle shaper: passes only peaks (random sparse pulses from a band-limited noise). */
export function pulseCurve(threshold = 0.35, n = 1024) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1, a = Math.max(0, Math.abs(x) - threshold) / (1 - threshold); c[i] = Math.min(1, a * 1.6); }
  return c;
}
