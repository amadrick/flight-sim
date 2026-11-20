// Radio voice: speechSynthesis for the words (it cannot be routed through Web Audio), framed by procedural radio colour
// on the Web Audio side — squelch click in, band-limited static bed while the line plays, squelch tail and roger beep out.
// Without speech (unsupported, no voices, or turned off) a formant "radio murmur" stands in so chatter is still felt.
import { G, BQ, OSC, noise, driveCurve } from './music/synth.js';
import { createPool } from './sfx.js';
import { createRadioQueue, ROLES, speechSeconds } from './radio-queue.js';

export const RADIO_LEVEL = 0.5;
const VOWELS = [[730, 1090], [270, 2290], [530, 1840], [300, 870], [660, 1720], [440, 1020], [570, 840], [390, 1990]];

function getSpeech() {
  try {
    const ss = typeof window !== 'undefined' && window.speechSynthesis;
    if (!ss || typeof SpeechSynthesisUtterance === 'undefined' || !ss.getVoices) return null;
    return ss;
  } catch { return null; }
}

export function createRadio(ac, dest, opts = {}) {
  const pool = createPool(6);
  const out = G(ac, RADIO_LEVEL); out.connect(dest);
  const queue = createRadioQueue();
  const speechOf = opts.speech === undefined ? getSpeech : () => opts.speech;
  let voiceOn = opts.voice !== false, volume = 1, cur = null, nextOk = 0, voices = null, voicesAt = -99;
  const rnd = opts.rng || Math.random;
  const stats = { speechFallbacks: 0 };

  // static bed: band-limited hiss with slow crackle, opened while a line is on air
  const sN = noise(ac, 'white'), sB = BQ(ac, 'bandpass', 1800, 0.6), sH = BQ(ac, 'highpass', 400, 0.7), sL = BQ(ac, 'lowpass', 3400, 0.7), sG = G(ac, 0);
  const cr = noise(ac, 'brown'), crF = BQ(ac, 'lowpass', 9, 0.5), crG = G(ac, 0); cr.connect(crF); crF.connect(crG); crG.connect(sG.gain);
  sN.connect(sB); sB.connect(sH); sH.connect(sL); sL.connect(sG); sG.connect(out); sN.start(); cr.start();

  function burst(t, f0, f1, q, peak, dur) {
    if (!pool.take()) return;
    const z = noise(ac, 'white'), f = BQ(ac, 'bandpass', f0, q), g = G(ac, 0); z.connect(f); f.connect(g); g.connect(out);
    if (f1 !== f0) { f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur); }
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    z.start(t, rnd()); z.stop(t + dur + 0.02); z.onended = () => { try { z.disconnect(); f.disconnect(); g.disconnect(); } catch {} pool.done(); };
  }
  function beep(t, f, dur, lvl) {
    if (!pool.take()) return;
    const o = OSC(ac, 'sine', f), g = G(ac, 0); o.connect(g); g.connect(out);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl, t + 0.004); g.gain.setValueAtTime(lvl, t + dur - 0.006); g.gain.linearRampToValueAtTime(0, t + dur);
    o.start(t); o.stop(t + dur + 0.01); o.onended = () => { try { o.disconnect(); g.disconnect(); } catch {} pool.done(); };
  }
  function squelchIn(t, R) { burst(t, 3000, 3000, 1.2, 0.5, 0.012); burst(t + 0.01, 2000, 1500, 0.7, 0.25, 0.07); sG.gain.setTargetAtTime(R.staticLvl * 2.2, t + 0.02, 0.02); crG.gain.setValueAtTime(R.staticLvl * 1.2, t); sB.frequency.setValueAtTime((R.band[0] + R.band[1]) / 2, t); }
  function squelchOut(t, R) {
    sG.gain.setTargetAtTime(0, t, 0.015); crG.gain.setValueAtTime(0, t + 0.05);
    if (R.roger) beep(t + 0.01, R.roger[0], R.roger[1] + 0.03, 0.22);
    burst(t + (R.roger ? 0.08 : 0.01), 2200, 900, 0.6, 0.35, 0.14);
  }
  /** formant murmur standing in for words: a buzzy source through two jumping formants, gated in syllables */
  function murmur(t, dur, R) {
    if (!pool.take()) return;
    const src = OSC(ac, 'sawtooth', R.f0), f1 = BQ(ac, 'bandpass', 600, 6), f2 = BQ(ac, 'bandpass', 1500, 8), g1 = G(ac, 1), g2 = G(ac, 0.6);
    const syl = G(ac, 0), band1 = BQ(ac, 'highpass', R.band[0], 0.7), band2 = BQ(ac, 'lowpass', R.band[1], 0.7), sh = ac.createWaveShaper(); sh.curve = driveCurve(R.drive, 0);
    const lvl = G(ac, 0.5);
    src.connect(f1); src.connect(f2); f1.connect(g1); f2.connect(g2); g1.connect(syl); g2.connect(syl);
    const cz = noise(ac, 'white'), czF = BQ(ac, 'highpass', 2500, 0.7), czG = G(ac, 0); cz.connect(czF); czF.connect(czG); czG.connect(syl);
    syl.connect(band1); band1.connect(band2); band2.connect(sh); sh.connect(lvl); lvl.connect(out);
    let tt = t, k = 0;
    src.frequency.setValueAtTime(R.f0, t);
    while (tt < t + dur - 0.08) {
      const sd = 0.09 + 0.09 * rnd(), v = VOWELS[Math.floor(rnd() * VOWELS.length)], word = rnd() < 0.18;
      f1.frequency.setTargetAtTime(v[0], tt, 0.015); f2.frequency.setTargetAtTime(v[1], tt, 0.015);
      src.frequency.setTargetAtTime(R.f0 * (1 + 0.18 * (rnd() - 0.4) - 0.1 * (tt - t) / dur), tt, 0.03);
      syl.gain.setTargetAtTime(0.9, tt, 0.01); syl.gain.setTargetAtTime(0.05, tt + sd * 0.7, 0.02);
      if (rnd() < 0.45) { czG.gain.setValueAtTime(0.0001, tt); czG.gain.linearRampToValueAtTime(0.25, tt + 0.006); czG.gain.exponentialRampToValueAtTime(0.0001, tt + 0.04); }
      tt += sd + (word ? 0.07 + 0.06 * rnd() : 0.01); k++;
    }
    syl.gain.setTargetAtTime(0, tt, 0.02);
    src.start(t); cz.start(t, rnd()); const end = tt + 0.15; src.stop(end); cz.stop(end);
    let n = 2; const done = () => { if (--n) return; for (const x of [src, f1, f2, g1, g2, syl, band1, band2, sh, lvl, cz, czF, czG]) { try { x.disconnect(); } catch {} } pool.done(); };
    src.onended = done; cz.onended = done;
  }
  function pickVoice(ss, R) {
    try {
      if (!voices || ac.currentTime - voicesAt > 10) { voicesAt = ac.currentTime; const all = ss.getVoices() || []; const en = all.filter((v) => /^en/i.test(v.lang || '')); voices = (en.length ? en : all).slice().sort((a, b) => String(a.name).localeCompare(String(b.name))); }
      return voices.length ? voices[R.pick % voices.length] : null;
    } catch { return null; }
  }
  function start(item, t) {
    const R = ROLES[item.role] || ROLES.wingman;
    squelchIn(t, R);
    const ss = voiceOn ? speechOf() : null;
    const est = speechSeconds(item.text, R.rate);
    cur = { item, R, t, end: t + 0.1 + est, speech: false, done: false };
    if (ss && (ss.getVoices?.() || []).length) {
      try {
        const u = new SpeechSynthesisUtterance(item.text); const v = pickVoice(ss, R); if (v) u.voice = v;
        u.pitch = R.pitch; u.rate = R.rate; u.volume = Math.max(0, Math.min(1, volume));
        const me = cur; u.onend = u.onerror = () => { me.done = true; }; u.onstart = () => { me.started = true; };
        ss.speak(u); cur.speech = true; cur.end = t + 2.5 + est * 1.6;      // onend normally fires first; this is a safety net
        return;
      } catch { /* fall through to the murmur */ }
    }
    murmur(t + 0.06, est, R);
  }
  function finish(t) {
    if (!cur) return;
    if (cur.speech) { try { speechOf()?.cancel?.(); } catch {} }
    squelchOut(t, cur.R); cur = null; nextOk = t + 0.35;
  }
  return {
    queue, pool, stats,
    get speaking() { return !!cur; },
    get current() { return cur?.item || null; },
    /** queue a 'radio' event: { text, from, priority, role } */
    say(line, now = ac.currentTime) {
      const pre = queue.push(line, now, cur?.item || null);
      if (pre && cur) { finish(now); nextOk = now + 0.05; }
    },
    setVoice(on) { voiceOn = !!on; if (!voiceOn && cur?.speech) finish(ac.currentTime); },
    get voiceEnabled() { return voiceOn; },
    setVolume(v) { volume = Math.max(0, Math.min(1, +v || 0)); out.gain.setTargetAtTime(RADIO_LEVEL * volume, ac.currentTime, 0.05); },
    /** per frame. hold: paused / menu open (nothing is spoken; queued lines go stale) */
    update(now, hold) {
      if (hold) { if (cur) finish(now); return; }
      if (cur) {
        // mobile browsers may accept speak() and never start (no voices yet, no user activation): after 1.5 s without
        // onstart, cancel it and fall back to the procedural murmur under the squelch, for the line's estimated length
        if (cur.speech && !cur.started && !cur.done && now - cur.t > 1.5) {
          try { speechOf()?.cancel?.(); } catch {}
          const est = speechSeconds(cur.item.text, cur.R.rate);
          cur.speech = false; cur.end = now + est; murmur(now + 0.02, est, cur.R); stats.speechFallbacks++;
        }
        const over = cur.speech ? (cur.done || now > cur.end) : now > cur.end;
        if (over) finish(now);
      }
      if (!cur && now >= nextOk) { const it = queue.next(now); if (it) start(it, now + 0.01); }
    },
    stop(now = ac.currentTime) { queue.clear(); if (cur) finish(now); },
  };
}
