// Instruments of the combat score: Web Audio voices driven by scheduled parameter automation. Works with a live
// AudioContext and with an OfflineAudioContext (harness). These run only inside an OfflineAudioContext (render.js renders
// each section once into stems); persistent voices are driven by envelopes, a few (bell, stabs, clean plucks) are per note.
import { mtof } from './theory.js';

// ---- helpers ------------------------------------------------------------------------------------------------
export const G = (ac, v = 1) => { const g = ac.createGain(); g.gain.value = v; return g; };
export function BQ(ac, type, f, q = 0.707, gain) { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; if (gain !== undefined) b.gain.value = gain; return b; }
export function OSC(ac, type, f = 110, detune = 0) { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune; return o; }
const chain = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; };
function PAN(ac, p) { const s = ac.createStereoPanner(); s.pan.value = p; return s; }

/** Gain-envelope helpers on an AudioParam, scheduled in time order. */
const tgt = (p, v, t, tc) => p.setTargetAtTime(v, t, Math.max(1e-4, tc));
function hit(p, t, peak, atk, dec, floor = 0.0001) {           // sharp percussive AD (exponential decay)
  p.setValueAtTime(floor, t); p.linearRampToValueAtTime(peak, t + atk); p.exponentialRampToValueAtTime(floor, t + atk + dec);
}

/** Distortion transfer curve: asymmetric tanh (tube-ish), normalised. */
export function driveCurve(k = 10, asym = 0.12, n = 4096) {
  const c = new Float32Array(n), off = Math.tanh(asym), norm = Math.tanh(k + asym) - off;
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = (Math.tanh(k * x + asym) - off) / norm; }
  return c;
}
function shaper(ac, curve, os = '2x') { const w = ac.createWaveShaper(); w.curve = curve; try { w.oversample = os; } catch {} return w; }

/** Looping noise buffer (white or pink), one per context. */
const noiseCache = new Map();                                // by sample rate
export function noise(ac, kind = 'white') {
  let c = noiseCache.get(ac.sampleRate); if (!c) { c = {}; noiseCache.set(ac.sampleRate, c); }
  if (!c[kind]) {
    const n = Math.floor(ac.sampleRate * 2.3), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    let s = 0x2545F491, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const w = ((s >>> 0) / 4294967296) * 2 - 1;
      if (kind === 'brown') { b0 = (b0 + 0.02 * w) / 1.02; d[i] = b0 * 3.5; }
      else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else d[i] = w * 0.5;
    }
    c[kind] = buf;
  }
  const src = ac.createBufferSource(); src.buffer = c[kind]; src.loop = true; return src;
}

// ---- effects ------------------------------------------------------------------------------------------------
/**
 * Stereo reverb built from feedback delays: pre-delay, two all-pass diffusers, then 4 damped feedback combs per side
 * (mutually prime lengths), summed and lightly cross-fed. {in, out}
 */
export function makeReverb(ac, { decay = 0.8, damp = 4200, pre = 0.018, size = 1, level = 1 } = {}) {
  const input = G(ac, 1), out = G(ac, level), merger = ac.createChannelMerger(2);
  const pd = ac.createDelay(0.2); pd.delayTime.value = pre;
  const ap1 = BQ(ac, 'allpass', 700, 0.6), ap2 = BQ(ac, 'allpass', 2100, 0.6), hp = BQ(ac, 'highpass', 180, 0.6);
  chain(input, hp, pd, ap1, ap2);
  const times = [[0.0297, 0.0371, 0.0411, 0.0437], [0.0313, 0.0353, 0.0429, 0.0457]];
  times.forEach((side, ch) => {
    const sum = G(ac, 0.25);
    for (const t0 of side) {
      const d = ac.createDelay(0.5); d.delayTime.value = t0 * size;
      // damping: a biquad low-pass with Q = -3.5 dB (linear Q 0.67 < 0.707: no resonant peak, gain <= 1 at every
      // frequency, so the loop stays stable). Cheaper to create than an IIRFilterNode, which costs ~2 ms each in Chromium.
      const lp = BQ(ac, 'lowpass', damp, -3.5);
      const g = Math.pow(0.001, (t0 * size) / Math.max(0.2, decay)), fb = G(ac, g), tap = G(ac, (1 - g) * 2.2);
      ap2.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(tap); tap.connect(sum);
    }
    sum.connect(merger, 0, ch);
  });
  merger.connect(out);
  return { in: input, out };
}
/** Tempo-synced ping-pong delay. {in, out, setTime(s)} */
export function makePingPong(ac, { time = 0.34, fb = 0.38, tone = 3200, level = 1 } = {}) {
  const input = G(ac, 1), out = G(ac, level), merger = ac.createChannelMerger(2);
  const dl = ac.createDelay(2), dr = ac.createDelay(2); dl.delayTime.value = time; dr.delayTime.value = time;
  const lp = BQ(ac, 'lowpass', tone, 0.5), hp = BQ(ac, 'highpass', 250, 0.5), g = G(ac, fb), g2 = G(ac, fb);
  chain(input, hp, lp, dl); dl.connect(g); g.connect(dr); dr.connect(g2); g2.connect(dl);
  dl.connect(merger, 0, 0); dr.connect(merger, 0, 1); merger.connect(out);
  return { in: input, out, setTime(s, t = 0) { dl.delayTime.setValueAtTime(s, t); dr.delayTime.setValueAtTime(s, t); } };
}
/** Stereo chorus (two LFO-modulated short delays). {in, out} */
export function makeChorus(ac, { rate = 0.8, depth = 0.0025, base = 0.012, mix = 0.6 } = {}) {
  const input = G(ac, 1), out = G(ac, 1), dry = G(ac, 1 - mix * 0.5);
  input.connect(dry); dry.connect(out);
  [-0.8, 0.8].forEach((p, k) => {
    const d = ac.createDelay(0.05); d.delayTime.value = base + k * 0.004;
    const l = OSC(ac, 'sine', rate * (1 + 0.27 * k)), lg = G(ac, depth); l.connect(lg); lg.connect(d.delayTime); l.start();
    const pan = PAN(ac, p), wet = G(ac, mix); chain(input, d, wet, pan, out);
  });
  return { in: input, out };
}

// ---- drums --------------------------------------------------------------------------------------------------
export function makeDrums(ac, bus, room, gateIn, white, { hats = 1 } = {}) {
  // each piece is built on its first hit, so building the kit never costs one long main-thread slice
  const sources = [], P = {};
  const st = (...o) => { for (const x of o) { x.start(); sources.push(x); } };
  const build = {
    // kick: pitched sine thump + beater click + mid "knock", slightly saturated, a touch of chest
    kick() {
      const kO = OSC(ac, 'sine', 50), kG = G(ac, 0), kSh = shaper(ac, driveCurve(1.6, 0), 'none'), kOut = G(ac, 0.78), kSub = BQ(ac, 'lowshelf', 70, 0.7, 0.5);
      chain(kO, kG, kSh, kOut, kSub, bus);
      const kcF = BQ(ac, 'bandpass', 3500, 0.9), kcG = G(ac, 0); chain(white, kcF, kcG, kOut);
      const kK = OSC(ac, 'triangle', 120), kKG = G(ac, 0), kKF = BQ(ac, 'lowpass', 900, 0.7); chain(kK, kKF, kKG, kOut);
      st(kO, kK); return { kO, kG, kcG, kK, kKG };
    },
    // snare: noise rattle + two-mode body, room and gated-reverb sends
    snare() {
      const gate = typeof gateIn === 'function' ? gateIn() : gateIn;
      const sF = BQ(ac, 'bandpass', 2100, 0.7), sH = BQ(ac, 'highpass', 400, 0.7), sG = G(ac, 0), sOut = G(ac, 0.9);
      chain(white, sF, sH, sG, sOut);
      const sB = OSC(ac, 'triangle', 185), sBG = G(ac, 0); chain(sB, sBG, sOut);
      const sB2 = OSC(ac, 'sine', 330), sB2G = G(ac, 0); chain(sB2, sB2G, sOut);
      sOut.connect(bus); const sRoom = G(ac, 0.55); sOut.connect(sRoom); sRoom.connect(room); const sGate = G(ac, 0.9); sOut.connect(sGate); sGate.connect(gate.in);
      st(sB, sB2); return { sG, sB, sBG, sB2G, gate };
    },
    // hats (closed/open share one voice so a closed hat chokes the open one)
    hat() { const hF = BQ(ac, 'highpass', 7200, 0.7), hF2 = BQ(ac, 'peaking', 10500, 1.2, 5), hG = G(ac, 0), hOut = G(ac, 1.15 * hats); chain(white, hF, hF2, hG, hOut, bus); return { hG }; },
    ride() {
      const rF = BQ(ac, 'bandpass', 5200, 1.6), rF2 = BQ(ac, 'highpass', 3000, 0.7), rG = G(ac, 0), rOut = G(ac, 0.5 * hats);
      chain(white, rF, rF2, rG, rOut, bus);
      const rP = OSC(ac, 'sine', 3150), rPG = G(ac, 0); chain(rP, rPG, rOut); st(rP); return { rG, rPG };
    },
    tom() {
      const tO = OSC(ac, 'sine', 110), tG = G(ac, 0), tO2 = OSC(ac, 'triangle', 110), tG2 = G(ac, 0), tOut = G(ac, 0.95);
      chain(tO, tG, tOut); chain(tO2, tG2, tOut); tOut.connect(bus); const tRoom = G(ac, 0.6); tOut.connect(tRoom); tRoom.connect(room);
      st(tO, tO2); return { tO, tG, tO2, tG2 };
    },
    // crash: bright noise wash
    crash() { const cF = BQ(ac, 'highpass', 4200, 0.6), cF2 = BQ(ac, 'peaking', 7000, 0.8, 6), cG = G(ac, 0), cOut = G(ac, 0.4); chain(white, cF, cF2, cG, cOut, bus); const cRoom = G(ac, 0.5); cOut.connect(cRoom); cRoom.connect(room); return { cG }; },
  };
  build.ohat = () => P.hat || (P.hat = build.hat());
  const get = (k) => P[k] || (P[k] = build[k]());
  const TOMF = [146, 110, 82];
  return {
    trigger(e, t) {
      const v = e.v; if (!build[e.i]) return;
      const p = get(e.i);
      switch (e.i) {
        case 'kick':
          p.kO.frequency.setValueAtTime(165, t); p.kO.frequency.exponentialRampToValueAtTime(58, t + 0.055); p.kO.frequency.exponentialRampToValueAtTime(43, t + 0.3);
          hit(p.kG.gain, t, v, 0.002, 0.42); hit(p.kcG.gain, t, 0.5 * v, 0.0008, 0.018);
          p.kK.frequency.setValueAtTime(240, t); p.kK.frequency.exponentialRampToValueAtTime(95, t + 0.04); hit(p.kKG.gain, t, 0.35 * v, 0.001, 0.07); return 'kick';
        case 'snare': {
          const ghost = v < 0.3;
          hit(p.sG.gain, t, 0.9 * v, 0.001, ghost ? 0.07 : 0.22); hit(p.sBG.gain, t, 0.7 * v, 0.001, 0.09); hit(p.sB2G.gain, t, 0.35 * v, 0.001, 0.05);
          p.sB.frequency.setValueAtTime(200, t); p.sB.frequency.exponentialRampToValueAtTime(165, t + 0.08);
          if (!ghost) p.gate.open(t, v);
          return;
        }
        case 'hat': hit(p.hG.gain, t, 0.8 * v, 0.0008, 0.045); return;
        case 'ohat': hit(p.hG.gain, t, 0.8 * v, 0.001, 0.32); return;
        case 'ride': hit(p.rG.gain, t, 0.7 * v, 0.001, 0.45); hit(p.rPG.gain, t, 0.12 * v, 0.001, 0.6); return;
        case 'tom': {
          const f = TOMF[e.n ?? 1];
          p.tO.frequency.setValueAtTime(f * 1.35, t); p.tO.frequency.exponentialRampToValueAtTime(f, t + 0.05); p.tO.frequency.exponentialRampToValueAtTime(f * 0.82, t + 0.5);
          p.tO2.frequency.setValueAtTime(f * 1.35, t); p.tO2.frequency.exponentialRampToValueAtTime(f * 0.85, t + 0.3);
          hit(p.tG.gain, t, 0.85 * v, 0.002, 0.55); hit(p.tG2.gain, t, 0.25 * v, 0.002, 0.18); return;
        }
        case 'crash': hit(p.cG.gain, t, 0.9 * v, 0.002, 2.2); return;
      }
    },
    /** build the pieces up front (the live band: no node creation during play) */
    warm(keys = ['kick', 'snare', 'hat', 'ride', 'tom', 'crash']) { for (const k of keys) get(k); },
    release() {},
    sources,
  };
}
/** 80s gated reverb for the snare: a dense short reverb whose output is opened by each snare hit and slammed shut. */
export function makeGatedVerb(ac, out) {
  const rv = makeReverb(ac, { decay: 1.4, damp: 6000, pre: 0.004, size: 0.7 }), gate = G(ac, 0), lvl = G(ac, 0.5);
  rv.out.connect(gate); gate.connect(lvl); lvl.connect(out);
  return { in: rv.in, open(t, v) { tgt(gate.gain, v, t, 0.002); tgt(gate.gain, 0, t + 0.2, 0.012); } };
}

// ---- guitars ------------------------------------------------------------------------------------------------
/**
 * Rhythm guitar: one double-tracked power-chord voice. Each side: 3 strings x 2 band-limited saws (detuned), a pick
 * transient, pre-EQ (high-pass, mid push, a tracking "palm" low-pass that closes for mutes) into an asymmetric tanh
 * waveshaper (oversampled), then a 4x12-style cabinet filter: high-pass 80 Hz, low-mid bump, presence peak, two
 * low-passes at 4.8 kHz (24 dB/oct). Left and right are detuned differently, the right plays 9 ms late, panned hard.
 * Extras: slow vibrato on held chords, slides into a chord (e.sl semitones below), pick scrapes (e.i === 'scrape').
 */
export function makeRhythmGuitar(ac, out, white, { drive = 14, os = '2x', mono = false } = {}) {
  const curve = driveCurve(drive, 0.15);
  const sides = (mono ? [0] : [-1, 1]).map((pan, side) => {
    const lfo = OSC(ac, 'sine', side ? 4.3 : 4.7), vib = G(ac, 0); lfo.connect(vib); lfo.start();
    const strings = [0, 1, 2].map((k) => {
      const a = OSC(ac, 'sawtooth', 73, side ? 7 : -5), b = OSC(ac, 'sawtooth', 73, side ? -9 : 6), g = G(ac, 0.5);
      a.connect(g); b.connect(g); a.start(); b.start(); vib.connect(a.detune); vib.connect(b.detune);
      return { a, b, g };
    });
    const sum = G(ac, 1), pre = G(ac, 0);
    for (const s of strings) s.g.connect(sum);
    const pk = BQ(ac, 'bandpass', 2600, 0.8), pkG = G(ac, 0); chain(white, pk, pkG, pre);
    const hp = BQ(ac, 'highpass', 120, 0.7), palm = BQ(ac, 'lowpass', 6000, 0.9), mid = BQ(ac, 'peaking', 850, 0.8, 6);
    chain(sum, palm, pre, hp, mid);
    const sc = BQ(ac, 'bandpass', 2000, 5), scG = G(ac, 0); chain(white, sc, scG, hp);       // pick scrape into the amp
    const sh = shaper(ac, curve, os);
    const c1 = BQ(ac, 'highpass', 80, 0.8), c2 = BQ(ac, 'peaking', 240, 0.9, 2.5), c3 = BQ(ac, 'peaking', 2600, 0.9, 6),
      c4 = BQ(ac, 'lowpass', 4800, 0.9), c5 = BQ(ac, 'lowpass', 4800, 0.6), c6 = BQ(ac, 'lowshelf', 160, 0.7, -5);
    const gate = G(ac, 0), lvl = G(ac, 0.24), p = PAN(ac, pan);
    chain(mid, sh, c1, c2, c3, c4, c5, c6, gate, lvl, p, out);
    return { strings, pre, palm, gate, pkG, sc, scG, vib, lfo, delay: side ? 0.009 : 0 };
  });
  return {
    trigger(e, t0, sd) {
      const dur = Math.max(0.05, e.d * sd);
      if (e.i === 'scrape') {
        for (const S of sides) {
          const t = t0 + S.delay;
          S.sc.frequency.setValueAtTime(3200, t); S.sc.frequency.exponentialRampToValueAtTime(380, t + dur);
          S.scG.gain.setValueAtTime(0.0001, t); S.scG.gain.exponentialRampToValueAtTime(0.5 * e.v, t + 0.03); S.scG.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          tgt(S.gate.gain, 0.9, t, 0.004); tgt(S.gate.gain, 0, t + dur, 0.03);
        }
        return;
      }
      const notes = e.n, mute = !!e.m;
      for (const S of sides) {
        const t = t0 + S.delay;
        for (let k = 0; k < 3; k++) {
          const st = S.strings[k], m = notes[Math.min(k, notes.length - 1)], f = mtof(m);
          if (e.sl) {
            const f0 = f * Math.pow(2, -e.sl / 12);
            st.a.frequency.setValueAtTime(f0, t); st.b.frequency.setValueAtTime(f0, t);
            st.a.frequency.exponentialRampToValueAtTime(f, t + 0.08); st.b.frequency.exponentialRampToValueAtTime(f, t + 0.08);
          } else { st.a.frequency.setValueAtTime(f, t); st.b.frequency.setValueAtTime(f, t); }
          st.g.gain.setValueAtTime(k < notes.length ? (k === 0 ? 0.55 : 0.45) : 0, t);
        }
        S.vib.gain.setValueAtTime(0, t);
        if (!mute && dur > 0.9) tgt(S.vib.gain, 9, t + 0.45, 0.35);            // held chord: slow, shallow vibrato
        // palm mutes: the low-pass closes fast but not all the way (it keeps a 1-3 kHz edge for small speakers)
        S.palm.frequency.setValueAtTime(mute ? 1700 : 5200, t);
        if (mute) S.palm.frequency.setTargetAtTime(760, t + 0.012, 0.05);
        tgt(S.pre.gain, e.v * (mute ? 0.9 : 1), t, 0.0012);
        tgt(S.pre.gain, e.v * (mute ? 0.3 : 0.45), t + 0.004, mute ? 0.07 : 1.2);
        hit(S.pkG.gain, t, mute ? 0.4 : 0.3, 0.0008, mute ? 0.018 : 0.012);
        tgt(S.gate.gain, mute ? 0.85 : 1, t, 0.002);
        tgt(S.gate.gain, 0, t + dur - 0.01, mute ? 0.012 : 0.05);
      }
    },
    release(t) { for (const S of sides) { tgt(S.gate.gain, 0, t, 0.05); } },
    sources: sides.flatMap((s) => s.strings.flatMap((x) => [x.a, x.b]).concat([s.lfo])),
  };
}

/**
 * Lead guitar: monophonic singing voice — two saws + an octave sine for feedback bloom, glide between notes,
 * pitch bends into notes, delayed vibrato, pre-EQ into a high-gain shaper and the cabinet filter. Feeds a
 * tempo-synced delay and the reverb.
 */
export function makeLeadGuitar(ac, out, sends, { pan = 0.12, detune = 0, os = '2x' } = {}) {
  const a = OSC(ac, 'sawtooth', 440, detune), b = OSC(ac, 'sawtooth', 440, detune + 9), fbO = OSC(ac, 'sine', 880), fbG = G(ac, 0);
  const sum = G(ac, 0.5); a.connect(sum); b.connect(sum); fbO.connect(fbG); fbG.connect(sum);
  const lfo = OSC(ac, 'sine', 5.4), vib = G(ac, 0); lfo.connect(vib); vib.connect(a.detune); vib.connect(b.detune); vib.connect(fbO.detune);
  [a, b, fbO, lfo].forEach((o) => o.start());
  const hp = BQ(ac, 'highpass', 220, 0.7), mid = BQ(ac, 'peaking', 1300, 0.9, 7), pre = G(ac, 0), sh = shaper(ac, driveCurve(22, 0.1), os);
  const c1 = BQ(ac, 'highpass', 140, 0.7), c2 = BQ(ac, 'peaking', 1800, 1, 3), c3 = BQ(ac, 'lowpass', 5200, 0.8), c4 = BQ(ac, 'lowpass', 5200, 0.6);
  const gate = G(ac, 0), lvl = G(ac, 0.21), p = PAN(ac, pan);
  chain(sum, hp, mid, pre, sh, c1, c2, c3, c4, gate, lvl, p, out);
  const dS = G(ac, 0.42), rS = G(ac, 0.35); lvl.connect(dS); dS.connect(sends.delay); lvl.connect(rS); rS.connect(sends.reverb);
  return {
    pan: p.pan,
    trigger(e, t, sd) {
      const f = mtof(e.n), dur = e.d * sd, fl = e.f || '';
      const set = (fr, tt) => { a.frequency.setValueAtTime(fr, tt); b.frequency.setValueAtTime(fr, tt); fbO.frequency.setValueAtTime(2 * fr, tt); };
      const glide = (fr, tt, tc) => { tgt(a.frequency, fr, tt, tc); tgt(b.frequency, fr, tt, tc); tgt(fbO.frequency, 2 * fr, tt, tc); };
      if (fl.includes('l')) { glide(f, t, 0.022); tgt(gate.gain, 1, t, 0.003); tgt(gate.gain, 0, t + Math.max(0.05, dur - 0.015), 0.06); return; }   // legato slide: no re-pick
      if (fl.includes('b') || fl.includes('s')) { set(f * Math.pow(2, (fl.includes('s') ? -1 : -2) / 12), t); glide(f, t + 0.06, 0.07); }
      else glide(f, t, 0.012);
      vib.gain.setValueAtTime(0, t); tgt(vib.gain, fl.includes('v') ? 32 : 9, t + Math.min(0.32, dur * 0.4), 0.18);
      tgt(fbG.gain, 0, t, 0.03);
      if (fl.includes('f')) tgt(fbG.gain, 0.6, t + 0.3, dur * 0.35);
      tgt(pre.gain, 0.9 * e.v, t, 0.004); tgt(pre.gain, 0.55 * e.v, t + 0.05, 0.5);
      tgt(gate.gain, 1, t, 0.003); tgt(gate.gain, 0, t + Math.max(0.05, dur - 0.015), 0.06);
    },
    release(t) { tgt(gate.gain, 0, t, 0.08); },
    sources: [a, b, fbO, lfo],
  };
}

/** Karplus-Strong pluck rendered once per note (clean guitar), cached per context. */
const ksCache = new Map();                                   // by sample rate: AudioBuffers work in any context
export function ksBuffer(ac, m, seconds = 2.2) {
  let c = ksCache.get(ac.sampleRate); if (!c) { c = new Map(); ksCache.set(ac.sampleRate, c); }
  let buf = c.get(m); if (buf) return buf;
  const sr = ac.sampleRate, n = Math.floor(sr * seconds), out = new Float32Array(n);
  const f = mtof(m), P = sr / f, N = Math.floor(P - 0.5), frac = P - 0.5 - N;
  const C = (1 - frac) / (1 + frac);                                   // all-pass fractional delay for tuning
  const line = new Float32Array(N + 2); let s = (m * 2654435761) >>> 0, lp = 0;
  for (let i = 0; i < line.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const w = ((s >>> 0) / 4294967296) * 2 - 1; lp += 0.55 * (w - lp); line[i] = lp; }
  // pick position comb (picked at ~1/5 of the string) softens the attack
  const pp = Math.max(1, Math.floor(N / 5)); for (let i = line.length - 1; i >= pp; i--) line[i] -= 0.6 * line[i - pp];
  const loss = Math.pow(0.001, 1 / (f * (m > 64 ? 1.6 : 2.4)));        // ~60 dB decay in 1.6-2.4 s
  let idx = 0, apx = 0, apy = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const x = line[idx];
    const avg = 0.5 * (x + prev); prev = x;
    const y = C * avg + apx - C * apy; apx = avg; apy = y;                 // fractional delay
    line[idx] = y * loss; out[i] = x;
    idx++; if (idx >= N) idx = 0;
  }
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]));
  const k = 0.5 / (pk || 1); const fade = Math.floor(sr * 0.05);
  for (let i = 0; i < n; i++) out[i] *= k * (i > n - fade ? (n - i) / fade : 1);
  buf = ac.createBuffer(1, n, sr); buf.getChannelData(0).set(out); c.set(m, buf);
  return buf;
}
export function makeCleanGuitar(ac, out) {
  const bus = G(ac, 0.7), hp = BQ(ac, 'highpass', 120, 0.7), body = BQ(ac, 'peaking', 2600, 1, 3), lp = BQ(ac, 'lowpass', 7000, 0.6);
  const ch = makeChorus(ac, { rate: 0.7, depth: 0.0022, mix: 0.65 });
  chain(bus, hp, body, lp, ch.in); ch.out.connect(out);
  return {
    out: ch.out,
    trigger(e, t, sd) {
      const src = ac.createBufferSource(); src.buffer = ksBuffer(ac, e.n);
      const g = G(ac, e.v); src.connect(g); g.connect(bus);
      const end = t + Math.min(src.buffer.duration, e.d * sd + 1.2);
      g.gain.setValueAtTime(e.v, end - 0.25); g.gain.linearRampToValueAtTime(0, end);
      src.start(t); src.stop(end + 0.02);
    },
    release() {},
    sources: [],
  };
}

/** Picked bass guitar: saw + square through a tracking low-pass with a pick click, slightly driven. */
export function makeBass(ac, out, white) {
  const a = OSC(ac, 'sawtooth', 55), b = OSC(ac, 'square', 55, 4), mix = G(ac, 0.5); a.connect(mix); b.connect(mix); a.start(); b.start();
  const sub = OSC(ac, 'sine', 55), subG = G(ac, 0.15); sub.connect(subG); sub.start();
  const lp = BQ(ac, 'lowpass', 600, 1.1), env = G(ac, 0), sh = shaper(ac, driveCurve(2.2, 0.05), 'none'), lvl = G(ac, 0.17);
  chain(mix, lp, env); subG.connect(env); chain(env, sh, BQ(ac, 'highpass', 35, 0.7), lvl, out);
  const pk = BQ(ac, 'bandpass', 1800, 1), pkG = G(ac, 0); chain(white, pk, pkG, env);
  // overdriven mid layer (700 Hz-1.5 kHz) so the bass line reads on a phone speaker
  const mhp = BQ(ac, 'highpass', 300, 0.7), msh = shaper(ac, driveCurve(7, 0.1), 'none'), mbp = BQ(ac, 'bandpass', 1000, 0.8), mG = G(ac, 0.5);
  chain(env, mhp, msh, mbp, mG, lvl);
  return {
    trigger(e, t, sd) {
      const f = mtof(e.n), dur = Math.max(0.04, e.d * sd);
      a.frequency.setValueAtTime(f, t); b.frequency.setValueAtTime(f, t); sub.frequency.setValueAtTime(f, t);
      lp.frequency.setValueAtTime(2200, t); tgt(lp.frequency, 520, t + 0.005, 0.12);
      tgt(env.gain, e.v, t, 0.0015); tgt(env.gain, 0.65 * e.v, t + 0.006, 0.25);
      tgt(env.gain, 0, t + dur - 0.012, 0.02);
      hit(pkG.gain, t, 0.12 * e.v, 0.0005, 0.01);
    },
    release(t) { tgt(env.gain, 0, t, 0.05); },
    sources: [a, b, sub],
  };
}

/** 80s synth bass pulse (two detuned saws, resonant pluck filter). */
export function makeSynthBass(ac, out) {
  const a = OSC(ac, 'sawtooth', 110, -6), b = OSC(ac, 'sawtooth', 110, 7), m = G(ac, 0.5); a.connect(m); b.connect(m); a.start(); b.start();
  const lp = BQ(ac, 'lowpass', 500, 4), env = G(ac, 0), lvl = G(ac, 0.3); chain(m, lp, env, lvl, out);
  return {
    trigger(e, t, sd) {
      const f = mtof(e.n); a.frequency.setValueAtTime(f, t); b.frequency.setValueAtTime(f, t);
      lp.frequency.setValueAtTime(1800, t); tgt(lp.frequency, 300, t + 0.003, 0.06);
      env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(e.v, t + 0.003); tgt(env.gain, 0, t + 0.01, Math.min(0.09, e.d * sd * 0.5));
    },
    release(t) { tgt(env.gain, 0, t, 0.05); },
    sources: [a, b],
  };
}

/** Bright synth pad: 4 voices x 2 detuned saws, slow filter sweep, wide stereo. */
export function makePad(ac, out, sends) {
  const L = G(ac, 1), R = G(ac, 1), pl = PAN(ac, -0.7), pr = PAN(ac, 0.7);
  const filt = BQ(ac, 'lowpass', 2600, 1.2), env = G(ac, 0), lvl = G(ac, 0.12);
  const voices = [0, 1, 2, 3].map((k) => {
    const a = OSC(ac, 'sawtooth', 220, -11 + k), b = OSC(ac, 'sawtooth', 220, 10 - k), g = G(ac, 0.5);
    a.connect(g); b.connect(g); g.connect(k % 2 ? R : L); a.start(); b.start(); return { a, b };
  });
  L.connect(pl); R.connect(pr); pl.connect(filt); pr.connect(filt); chain(filt, env, lvl, out);
  const lfo = OSC(ac, 'sine', 0.11), lg = G(ac, 700); lfo.connect(lg); lg.connect(filt.frequency); lfo.start();
  const rS = G(ac, 0.5); lvl.connect(rS); rS.connect(sends.reverb);
  return {
    trigger(e, t, sd) {
      voices.forEach((v, k) => { const f = mtof(e.n[k % e.n.length]); tgt(v.a.frequency, f, t, 0.03); tgt(v.b.frequency, f, t, 0.03); });
      tgt(filt.frequency, e.dark ? 1100 : 2800, t, 0.4);
      tgt(env.gain, e.v, t, 0.18);
    },
    release(t) { tgt(env.gain, 0, t, 0.5); },
    sources: voices.flatMap((v) => [v.a, v.b]).concat([lfo]),
  };
}

/** Plucky synth arpeggio (square + saw an octave up, resonant decaying filter). */
export function makeArp(ac, out, sends) {
  const a = OSC(ac, 'square', 440), b = OSC(ac, 'sawtooth', 880, 5), m = G(ac, 0.5); a.connect(m); b.connect(m); a.start(); b.start();
  const lp = BQ(ac, 'lowpass', 1200, 5), env = G(ac, 0), lvl = G(ac, 0.17); chain(m, lp, env, lvl, out);
  const dS = G(ac, 0.5); lvl.connect(dS); dS.connect(sends.delay);
  return {
    trigger(e, t, sd) {
      const f = mtof(e.n); a.frequency.setValueAtTime(f, t); b.frequency.setValueAtTime(2 * f, t);
      lp.frequency.setValueAtTime(4200, t); tgt(lp.frequency, 700, t + 0.002, 0.05);
      env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(e.v, t + 0.002); tgt(env.gain, 0, t + 0.004, Math.min(0.07, e.d * sd * 0.6));
    },
    release(t) { tgt(env.gain, 0, t, 0.03); },
    sources: [a, b],
  };
}

/** Noise riser into a section change. */
export function makeRiser(ac, out, sends, white) {
  const bp = BQ(ac, 'bandpass', 400, 2.5), env = G(ac, 0), lvl = G(ac, 0.22); chain(white, bp, env, lvl, out);
  const rS = G(ac, 0.6); lvl.connect(rS); rS.connect(sends.reverb);
  return {
    trigger(e, t, sd) {
      const dur = e.d * sd;
      bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
      env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(e.v, t + dur - 0.01); env.gain.setValueAtTime(0.0001, t + dur);
    },
    release(t) { env.gain.cancelScheduledValues(t); env.gain.setTargetAtTime(0, t, 0.05); },
    sources: [],
  };
}

// ---- 80s layer -----------------------------------------------------------------------------------------------
/**
 * Two-operator FM bell / e-piano (DX-style): a 1:1 modulator for the tine body plus a 3.5:1 modulator for the bell
 * partial, both with decaying index, into a chorus. Per-note nodes (only ever rendered offline).
 */
export function makeBell(ac, out, sends) {
  const bus = G(ac, 0.15), ch = makeChorus(ac, { rate: 0.45, depth: 0.0016, mix: 0.5 });
  bus.connect(ch.in); ch.out.connect(out);
  const rS = G(ac, 0.45), dS = G(ac, 0.3); ch.out.connect(rS); rS.connect(sends.reverb); ch.out.connect(dS); dS.connect(sends.delay);
  return {
    trigger(e, t, sd) {
      const f = mtof(e.n), len = Math.max(0.4, e.d * sd) + 1.8;
      const car = OSC(ac, 'sine', f), m1 = OSC(ac, 'sine', f), m2 = OSC(ac, 'sine', f * 3.5), i1 = G(ac, 0), i2 = G(ac, 0), env = G(ac, 0);
      m1.connect(i1); m2.connect(i2); i1.connect(car.frequency); i2.connect(car.frequency); car.connect(env); env.connect(bus);
      i1.gain.setValueAtTime(1.6 * f, t); i1.gain.setTargetAtTime(0.25 * f, t, 0.35);
      i2.gain.setValueAtTime(2.2 * f, t); i2.gain.setTargetAtTime(0, t, 0.07);
      env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(e.v, t + 0.002); env.gain.setTargetAtTime(0, t + 0.01, len / 4.5);
      for (const o of [car, m1, m2]) { o.start(t); o.stop(t + len); }
    },
    release() {},
    sources: [],
  };
}
/** Synth-brass chord stab: detuned saw pairs per note, one swelling low-pass, quick scoop up into pitch. */
export function makeStab(ac, out, sends) {
  const bus = G(ac, 0.07), rS = G(ac, 0.5); bus.connect(out); bus.connect(rS); rS.connect(sends.reverb);
  return {
    trigger(e, t, sd) {
      const dur = Math.max(0.08, e.d * sd), lp = BQ(ac, 'lowpass', 500, 2), env = G(ac, 0);
      lp.connect(env); env.connect(bus);
      lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(4200 * Math.min(1, e.v + 0.2), t + 0.03); lp.frequency.setTargetAtTime(1600, t + 0.04, 0.12);
      env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(e.v, t + 0.012); env.gain.setTargetAtTime(0.7 * e.v, t + 0.05, 0.1); env.gain.setTargetAtTime(0, t + dur, 0.07);
      for (const m of e.n) for (const dt of [-8, 7]) {
        const f = mtof(m), o = OSC(ac, 'sawtooth', f * 0.985, dt); o.frequency.exponentialRampToValueAtTime(f, t + 0.035);
        o.connect(lp); o.start(t); o.stop(t + dur + 0.5);
      }
    },
    release() {},
    sources: [],
  };
}
/** Mono synth-brass lead (doubles the chorus melody an octave down): saws, swelling filter, delayed vibrato, glide. */
export function makeHorn(ac, out, sends) {
  const a = OSC(ac, 'sawtooth', 220, -6), b = OSC(ac, 'sawtooth', 220, 6), sq = OSC(ac, 'square', 110), sqG = G(ac, 0.25), m = G(ac, 0.4);
  a.connect(m); b.connect(m); sq.connect(sqG); sqG.connect(m);
  const lfo = OSC(ac, 'sine', 5.2), vib = G(ac, 0); lfo.connect(vib); vib.connect(a.detune); vib.connect(b.detune); vib.connect(sq.detune);
  [a, b, sq, lfo].forEach((o) => o.start());
  const lp = BQ(ac, 'lowpass', 800, 1.4), env = G(ac, 0), lvl = G(ac, 0.13); chain(m, lp, env, lvl, out);
  const rS = G(ac, 0.4); lvl.connect(rS); rS.connect(sends.reverb);
  return {
    trigger(e, t, sd) {
      const f = mtof(e.n), dur = e.d * sd, fl = e.f || '';
      const to = (x, tt, tc) => { tgt(a.frequency, x, tt, tc); tgt(b.frequency, x, tt, tc); tgt(sq.frequency, x / 2, tt, tc); };
      if (fl.includes('b') || fl.includes('s')) { const f0 = f * Math.pow(2, (fl.includes('s') ? -1 : -2) / 12); a.frequency.setValueAtTime(f0, t); b.frequency.setValueAtTime(f0, t); sq.frequency.setValueAtTime(f0 / 2, t); to(f, t + 0.06, 0.07); }
      else to(f, t, 0.02);
      vib.gain.setValueAtTime(0, t); tgt(vib.gain, fl.includes('v') ? 18 : 6, t + Math.min(0.35, dur * 0.4), 0.2);
      if (!fl.includes('l')) { lp.frequency.setValueAtTime(700, t); tgt(lp.frequency, 2600, t, 0.05); tgt(lp.frequency, 1700, t + 0.12, 0.3); }
      tgt(env.gain, e.v, t, 0.015);
      tgt(env.gain, 0, t + Math.max(0.06, dur - 0.02), 0.07);
    },
    release(t) { tgt(env.gain, 0, t, 0.1); },
    sources: [a, b, sq, lfo],
  };
}
