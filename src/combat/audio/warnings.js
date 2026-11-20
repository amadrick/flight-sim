// Cockpit warning system: seeker tones, radar-warning chirps, missile-launch warning, fire bell and the small cues.
// Persistent voices with scheduled automation (no allocation per frame); one-shots for blips. Works live and offline.
import { G, BQ, OSC, noise } from './music/synth.js';
import { createPool } from './sfx.js';

export const SEEKER_MODES = ['none', 'ir-search', 'ir-lock', 'rdr-search', 'rdr-lock'];
// level of each warning voice into the warning bus
export const WARN_LEVEL = { seeker: 0.16, launch: 0.2, rwr: 0.24, fire: 0.32, blip: 0.18 };

export function createWarnings(ac, dest) {
  const pool = createPool(10);
  const bus = G(ac, 1); bus.connect(dest);
  // ---- seeker tone voice ----
  const sk = OSC(ac, 'sine', 1250), skAm = G(ac, 1), skLp = BQ(ac, 'lowpass', 6000, 0.5), skOut = G(ac, 0);
  const lfo = OSC(ac, 'square', 5), lfoG = G(ac, 0); lfo.connect(lfoG); lfoG.connect(skAm.gain);
  const fmN = noise(ac, 'brown'), fmF = BQ(ac, 'lowpass', 40, -3), fmG = G(ac, 0); fmN.connect(fmF); fmF.connect(fmG); fmG.connect(sk.detune);
  sk.connect(skAm); skAm.connect(skLp); skLp.connect(skOut); skOut.connect(bus);
  sk.start(); lfo.start(); fmN.start();
  let mode = 'none';
  function setSeeker(m, t = ac.currentTime) {
    if (m === mode) return; mode = m;
    const P = {
      'none': null,
      'ir-search': { type: 'triangle', f: 430, lfoT: 'sawtooth', lfoF: 23, depth: 0.5, base: 0.5, fm: 2400, lp: 2200, lvl: 1.0 },
      'ir-lock': { type: 'sine', f: 1250, lfoT: 'sine', lfoF: 5, depth: 0, base: 1, fm: 0, lp: 6000, lvl: 0.8 },
      'rdr-search': { type: 'square', f: 880, lfoT: 'square', lfoF: 5, depth: 0.5, base: 0.5, fm: 0, lp: 2400, lvl: 0.5 },
      'rdr-lock': { type: 'square', f: 1560, lfoT: 'sine', lfoF: 5, depth: 0, base: 1, fm: 0, lp: 3200, lvl: 0.5 },
    }[m];
    if (!P) { skOut.gain.setTargetAtTime(0, t, 0.012); return; }
    sk.type = P.type; sk.frequency.setValueAtTime(P.f, t); lfo.type = P.lfoT; lfo.frequency.setValueAtTime(P.lfoF, t);
    lfoG.gain.setValueAtTime(P.depth, t); skAm.gain.setValueAtTime(P.base, t); fmG.gain.setValueAtTime(P.fm, t); skLp.frequency.setValueAtTime(P.lp, t);
    skOut.gain.setTargetAtTime(WARN_LEVEL.seeker * P.lvl, t, 0.01);
  }
  // ---- patterned warnings (persistent oscillators, cycles scheduled ahead) ----
  function pattern(build, cycle) {
    const st = { on: false, next: 0, ...build() };
    return {
      st,
      run(now, on, arg) {
        if (on && !st.on) { st.on = true; st.next = now + 0.01; }
        if (!on && st.on) { st.on = false; st.gain.cancelScheduledValues(now); st.gain.setTargetAtTime(0, now, 0.008); return; }
        if (!on) return;
        while (st.next < now + 0.12) { if (st.next < now) st.next = now + 0.005; st.next += cycle(st, st.next, arg); }
      },
    };
  }
  const launch = pattern(() => {
    const o = OSC(ac, 'square', 1350), lp = BQ(ac, 'lowpass', 3600, 0.5), g = G(ac, 0); o.connect(lp); lp.connect(g); g.connect(bus); o.start();
    return { o, gain: g.gain };
  }, (s, t, urgent) => {
    const on = urgent ? 0.055 : 0.07, n = 6; const L = WARN_LEVEL.launch;
    for (let i = 0; i < n; i++) {
      const tt = t + i * (on + 0.008);
      s.o.frequency.setValueAtTime(i % 2 ? 960 : 1360, tt);
      s.gain.setValueAtTime(0, tt); s.gain.linearRampToValueAtTime(L, tt + 0.003); s.gain.setValueAtTime(L, tt + on - 0.004); s.gain.linearRampToValueAtTime(0, tt + on);
    }
    return n * (on + 0.008) + (urgent ? 0.02 : 0.12);
  });
  const rwr = pattern(() => {
    const o = OSC(ac, 'sine', 2400), g = G(ac, 0); o.connect(g); g.connect(bus); o.start();
    return { o, gain: g.gain };
  }, (s, t) => {
    const L = WARN_LEVEL.rwr;
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.075;
      s.o.frequency.setValueAtTime(2200, tt); s.o.frequency.exponentialRampToValueAtTime(3100, tt + 0.045);
      s.gain.setValueAtTime(0, tt); s.gain.linearRampToValueAtTime(L, tt + 0.004); s.gain.setValueAtTime(L, tt + 0.04); s.gain.linearRampToValueAtTime(0, tt + 0.048);
    }
    return 1.05;
  });
  const fire = pattern(() => {
    const a = OSC(ac, 'triangle', 440), b = OSC(ac, 'sine', 1213), bg = G(ac, 0.35), g = G(ac, 0);
    a.connect(g); b.connect(bg); bg.connect(g); g.connect(bus); a.start(); b.start();
    return { gain: g.gain };
  }, (s, t) => {
    const L = WARN_LEVEL.fire;
    for (let i = 0; i < 2; i++) { const tt = t + i * 0.32; s.gain.setValueAtTime(0, tt); s.gain.linearRampToValueAtTime(L, tt + 0.004); s.gain.exponentialRampToValueAtTime(0.0005, tt + 0.3); s.gain.setValueAtTime(0, tt + 0.31); }
    return 1.6;
  });

  // ---- blips (one-shots) ----
  function blip(t, freqs, { type = 'square', dur = 0.07, gap = 0.02, lvl = 1, lp = 3000 } = {}) {
    if (!pool.take()) return 0;
    const o = OSC(ac, type, freqs[0]), f = BQ(ac, 'lowpass', lp, 0.5), g = G(ac, 0); o.connect(f); f.connect(g); g.connect(bus);
    const L = WARN_LEVEL.blip * lvl;
    freqs.forEach((fr, i) => { const tt = t + i * (dur + gap); o.frequency.setValueAtTime(fr, tt); g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(L, tt + 0.003); g.gain.setValueAtTime(L, tt + dur - 0.006); g.gain.linearRampToValueAtTime(0, tt + dur); });
    const end = t + freqs.length * (dur + gap);
    o.start(t); o.stop(end + 0.02); o.onended = () => { try { o.disconnect(); f.disconnect(); g.disconnect(); } catch {} pool.done(); };
    return end - t;
  }
  function tick(t, lvl = 1) {
    if (!pool.take()) return 0;
    const z = noise(ac, 'white'), f = BQ(ac, 'bandpass', 2600, 3), g = G(ac, 0); z.connect(f); f.connect(g); g.connect(bus);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5 * lvl, t + 0.0006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    z.start(t); z.stop(t + 0.03); z.onended = () => { try { z.disconnect(); f.disconnect(); g.disconnect(); } catch {} pool.done(); };
    return 0.03;
  }
  let lastNoLock = -1;
  return {
    pool,
    get seeker() { return mode; },
    setSeeker,
    /** per frame: s = { rwrLock, launch, urgent, fire } (booleans) */
    update(now, s) {
      launch.run(now, !!s.launch, !!s.urgent);
      rwr.run(now, !!s.rwrLock && !s.launch, null);
      fire.run(now, !!s.fire, null);
    },
    /** true while a warning is sounding (music ducks a little) */
    get busy() { return mode !== 'none' || launch.st.on || rwr.st.on || fire.st.on; },
    get launchOn() { return launch.st.on; },
    noLock(t) { if (t - lastNoLock < 0.25) return 0; lastNoLock = t; return blip(t, [330, 220], { dur: 0.08, gap: 0.015, lp: 1800, lvl: 0.9 }); },
    targetTick(t) { return tick(t, 0.8); },
    lowAmmo(t) { return blip(t, [1760, 1760, 1760], { type: 'sine', dur: 0.05, gap: 0.04, lvl: 0.8 }); },
    winchester(t) { return blip(t, [880, 660, 440], { type: 'triangle', dur: 0.09, gap: 0.02, lvl: 0.8 }); },
    dryClick(t) { return tick(t, 0.6); },
    caution(t) { return blip(t, [1175, 880], { type: 'triangle', dur: 0.16, gap: 0.02, lvl: 0.9, lp: 5000 }); },
    stopAll(t = ac.currentTime) { setSeeker('none', t); launch.run(t, false); rwr.run(t, false); fire.run(t, false); },
  };
}
