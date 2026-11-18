// Procedural jet engine voices. One voice per engine, two families:
//   'jet-lowbypass'  (afterburning fighter turbofan: scream of the compressor, hard roar, violent afterburner)
//   'jet-highbypass' (airliner: fan hum -> buzz-saw, smooth bypass whoosh, reverse-thrust roar)
// A voice exposes three output GainNodes so the perspective stage can shape directivity:
//   whine (radiates forward from the intake), roar (radiates rearwards), rev (reverse-thrust, radiates forward).
import { gain, biquad, osc, noiseSrc, chain, set, sat, clamp, smooth, pulseCurve, shot, envAD, rand } from './dsp.js';

export function createEngineVoice(ac, kind, out, opts = {}) {
  return kind === 'jet-highbypass' ? highBypass(ac, out, opts) : lowBypass(ac, out, opts);
}

/** Shared bits: panners, a state memory for transitions, one-shot builders. */
function base(ac, out, pan) {
  const mkPan = (dest) => { const p = ac.createStereoPanner(); p.pan.value = pan; p.pan._ac = ac; p.connect(dest); return p; };
  const pW = mkPan(out.whine), pR = mkPan(out.roar), pV = mkPan(out.rev);
  return { pW, pR, pV, mem: { running: undefined, ab: 0, n1: 0, comb: 0, dn1: 0, dop: 1 }, nodes: [], srcs: [] };
}

// The "whump" of a combustor lighting off / a burner lighting: sub-bass sweep + band-limited blast.
function thump(ac, dest, t, strength, deep = 1) {
  if (strength <= 0.01) return;
  const o = ac.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(95 * deep, t); o.frequency.exponentialRampToValueAtTime(34 * deep, t + 0.4);
  const og = ac.createGain(); envAD(og.gain, t, 0.9 * strength, 0.006, 0.5);
  const n = noiseSrc(ac, 'brown'); const nf = biquad(ac, 'lowpass', 260, 0.8); const ng = ac.createGain(); envAD(ng.gain, t, 1.2 * strength, 0.008, 0.38);
  o.connect(og).connect(dest); chain(n, nf, ng, dest);
  o.start(t); shot(ac, t, 0.7, [o, n], [og, ng, nf]);
}

// ------------------------------------------------------------------------------------------------------
function lowBypass(ac, out, { pan = 0, hasAB = true, level = 1 } = {}) {
  const b = base(ac, out, pan), { mem } = b;
  // --- whine: compressor (N2) + fan (N1) partials -----------------------------------------------------
  const whineBus = gain(ac, 1); whineBus.connect(b.pW);
  const hp = [[1, 0.6], [2, 0.28], [3, 0.12]].map(([m, g]) => ({ m, g, o: osc(ac, 'sine', 2000 * m), gn: gain(ac, 0) }));
  const fan = [[1, 0.5, -7], [1, 0.5, 6], [1.5, 0.22, 0], [2, 0.18, 3]].map(([m, g, d]) => ({ m, g, o: osc(ac, 'sine', 900 * m, d), gn: gain(ac, 0) }));
  for (const v of [...hp, ...fan]) { v.o.connect(v.gn); v.gn.connect(whineBus); b.srcs.push(v.o); }
  const spool = osc(ac, 'triangle', 60), spoolG = gain(ac, 0), spoolLP = biquad(ac, 'lowpass', 420, 0.7);
  chain(spool, spoolG, spoolLP, whineBus); b.srcs.push(spool);
  // --- starter air ----------------------------------------------------------------------------------
  const st = noiseSrc(ac, 'pink'), stF = biquad(ac, 'bandpass', 500, 1.1), stG = gain(ac, 0); chain(st, stF, stG, out.whine); b.srcs.push(st);
  // --- roar ------------------------------------------------------------------------------------------
  const rL = noiseSrc(ac, 'brown'), rLf = biquad(ac, 'lowpass', 230, 0.7), rLg = gain(ac, 0); chain(rL, rLf, rLg, b.pR);
  const rM = noiseSrc(ac, 'pink'), rMf = biquad(ac, 'bandpass', 600, 0.65), rMf2 = biquad(ac, 'lowpass', 4500, 0.5), rMg = gain(ac, 0); chain(rM, rMf, rMf2, rMg, b.pR);
  const rH = noiseSrc(ac, 'white'), rHf = biquad(ac, 'highpass', 2600, 0.7), rHf2 = biquad(ac, 'lowpass', 9000, 0.5), rHg = gain(ac, 0); chain(rH, rHf, rHf2, rHg, b.pR);
  // turbulence: slow random AM of the mid roar (shear-layer "breathing")
  const mod = noiseSrc(ac, 'brown'), modF = biquad(ac, 'lowpass', 11, 0.7), modG = gain(ac, 0); chain(mod, modF, modG); modG.connect(rMg.gain);
  b.srcs.push(rL, rM, rH, mod);
  // --- afterburner -----------------------------------------------------------------------------------
  let ab = null;
  if (hasAB) {
    const A1 = noiseSrc(ac, 'brown'), A1f = biquad(ac, 'lowpass', 120, 1.0), A1g = gain(ac, 0); chain(A1, A1f, A1g, b.pR);               // chest rumble
    const A2 = noiseSrc(ac, 'brown'), A2f = biquad(ac, 'bandpass', 70, 1.4), A2g = gain(ac, 0); chain(A2, A2f, A2g, b.pR);                // sub thump bed
    const A3 = noiseSrc(ac, 'pink'), A3f = biquad(ac, 'bandpass', 330, 0.8), A3f2 = biquad(ac, 'lowpass', 1400, 0.7), A3g = gain(ac, 0); chain(A3, A3f, A3f2, A3g, b.pR); // deep ripping roar
    // crackle: sparse random pulses (band-limited noise -> threshold shaper) gating a hissy and a woody layer
    const mkPulse = (f, q) => {
      const sd = 0.3 * Math.sqrt((f / q * 1.57) / (ac.sampleRate / 2));  // rms of the band-limited noise
      const n = noiseSrc(ac, 'white'), bp = biquad(ac, 'bandpass', f, q), pre = gain(ac, 0.3 / sd), ws = ac.createWaveShaper(); ws.curve = pulseCurve(0.32);
      const lvl = gain(ac, 0); chain(n, bp, pre, ws, lvl); b.srcs.push(n); return lvl;
    };
    const C1n = noiseSrc(ac, 'white'), C1f = biquad(ac, 'highpass', 1500, 0.7), C1f2 = biquad(ac, 'peaking', 3500, 0.8, 5), C1g = gain(ac, 0); chain(C1n, C1f, C1f2, C1g, b.pR);
    const P1 = mkPulse(31, 0.9); P1.connect(C1g.gain);
    const C2n = noiseSrc(ac, 'pink'), C2f = biquad(ac, 'bandpass', 210, 1.3), C2g = gain(ac, 0); chain(C2n, C2f, C2g, b.pR);
    const P2 = mkPulse(17, 0.8); P2.connect(C2g.gain);
    const C3n = noiseSrc(ac, 'white'), C3f = biquad(ac, 'bandpass', 900, 0.9), C3g = gain(ac, 0); chain(C3n, C3f, C3g, b.pR);
    const P3 = mkPulse(44, 1.0); P3.connect(C3g.gain);
    b.srcs.push(A1, A2, A3, C1n, C2n, C3n);
    ab = { A1g, A2g, A3g, A3f, P1, P2, P3, C1g, C2g, C3g };
  }

  function update(e, dop = 1, dt = 1 / 60) {
    const n1 = clamp(e.n1, 0, 1.1), n2 = clamp(e.n2, 0, 1.1), thr = sat(e.thr), abv = hasAB ? sat(e.ab) : 0;
    const running = e.running;
    // combustion factor: collapses quickly on flame-out, builds on light-off
    const comb = running ? 1 : 0;
    mem.comb += (comb - mem.comb) * (1 - Math.exp(-dt / (running ? 0.5 : 0.12)));
    const cb = mem.comb;
    const pa = sat(0.07 + 0.93 * Math.pow(thr, 0.85)) * cb + 0.02 * n2 * (1 - cb);
    // transitions: light-off / flame-out, afterburner light / cut
    if (mem.running !== undefined && e.running !== mem.running) { if (e.running) thump(ac, b.pR, ac.currentTime + 0.05, 0.35, 1.3); else thump(ac, b.pR, ac.currentTime, 0.18, 1.6); }
    mem.running = e.running;
    if (hasAB) {
      if (abv > 0.12 && mem.ab <= 0.12) thump(ac, b.pR, ac.currentTime, 0.55 + 0.45 * abv, 1);
      else if (abv < 0.1 && mem.ab >= 0.4) thump(ac, b.pR, ac.currentTime, 0.28, 1.15);
    }
    mem.ab = abv;
    // whine
    const fH = (1500 + 3300 * n2) * dop, fF = (480 + 1500 * n1) * dop, wsc = Math.pow(n2, 2.2) * (1 - 0.4 * thr) * (1 - 0.6 * abv) * 0.075 * level;
    hp.forEach((v) => { set(v.o.frequency, fH * v.m, 0.03); set(v.gn.gain, v.g * wsc / v.m, 0.05); });
    const fsc = Math.pow(n1, 1.8) * (0.4 + 0.6 * (1 - thr * 0.5)) * 0.06 * level;
    fan.forEach((v) => { set(v.o.frequency, fF * v.m, 0.03); set(v.gn.gain, v.g * fsc, 0.05); });
    set(spool.frequency, (38 + 160 * n2) * dop, 0.05); set(spoolG.gain, 0.2 * Math.pow(n2, 1.5) * level, 0.08);
    // starter air
    const bump = smooth(0, 0.12, n2) * (1 - smooth(0.32, 0.6, n2));
    set(stF.frequency, (260 + 2200 * n2) * dop, 0.06); set(stG.gain, 0.2 * bump * level, 0.08);
    // roar
    const roarK = level;
    set(rLg.gain, (0.12 * cb + 1.0 * Math.pow(pa, 1.25)) * 0.55 * roarK, 0.07);
    set(rMf.frequency, (320 + 2300 * pa) * (1 - 0.25 * abv), 0.07);
    const mid = (0.06 * cb + 0.9 * Math.pow(pa, 1.5)) * (1 + 0.45 * abv) * 0.6 * roarK;
    set(rMg.gain, mid, 0.07); set(modG.gain, mid * 2.5, 0.2);
    set(rHg.gain, (0.012 * cb + 0.5 * Math.pow(pa, 2.6)) * (1 + 0.3 * abv) * 0.5 * roarK, 0.07);
    set(rHf.frequency, 2200 + 800 * pa, 0.1);
    if (ab) {
      const x = abv;
      set(ab.A1g.gain, 1.5 * Math.pow(x, 0.8) * roarK, 0.05);
      set(ab.A2g.gain, 2.2 * Math.pow(x, 1.0) * roarK, 0.05);
      set(ab.A3g.gain, 0.95 * Math.pow(x, 1.1) * roarK, 0.05);
      set(ab.P1.gain, 0.55 * x * roarK, 0.1); set(ab.P2.gain, 1.5 * x * roarK, 0.1); set(ab.P3.gain, 0.8 * x * roarK, 0.1);
    }
    for (const s of b.srcs) if (s.playbackRate) set(s.playbackRate, dop, 0.08);
  }
  return {
    update, kind: 'jet-lowbypass',
    dispose() { for (const s of b.srcs) { try { s.stop(); } catch {} } for (const n of [b.pW, b.pR, b.pV, whineBus]) { try { n.disconnect(); } catch {} } },
  };
}

// ------------------------------------------------------------------------------------------------------
function highBypass(ac, out, { pan = 0, level = 1 } = {}) {
  const b = base(ac, out, pan), { mem } = b;
  const whineBus = gain(ac, 1); whineBus.connect(b.pW);
  // shaft-order hum + blade-pass tones
  const hum = [[1, 0.55], [2, 0.34], [3, 0.2], [4, 0.1]].map(([m, g]) => ({ m, g, o: osc(ac, 'sine', 40 * m), gn: gain(ac, 0) }));
  const blade = [[22, 0.5, -5], [22, 0.5, 5], [44, 0.2, 0]].map(([m, g, d]) => ({ m, g, o: osc(ac, 'sine', 900, d), gn: gain(ac, 0) }));
  for (const v of [...hum, ...blade]) { v.o.connect(v.gn); v.gn.connect(whineBus); b.srcs.push(v.o); }
  // buzz-saw: shock-induced multiple-pure-tones = dense harmonics of shaft frequency, slightly incoherent
  const bzBus = gain(ac, 0), bzBP = biquad(ac, 'bandpass', 1900, 1.1), bzLP = biquad(ac, 'lowpass', 6500, 0.7); chain(bzBus, bzBP, bzLP, b.pW);
  const saws = [1, 1.0045, 0.9962].map((d) => ({ d, o: osc(ac, 'sawtooth', 80) }));
  const bzAM = noiseSrc(ac, 'brown'), bzAMf = biquad(ac, 'lowpass', 14, 0.7), bzAMg = gain(ac, 0.0); chain(bzAM, bzAMf, bzAMg); // irregular flutter
  const sawSum = gain(ac, 0.33);
  for (const s of saws) { s.o.connect(sawSum); b.srcs.push(s.o); } sawSum.connect(bzBus); bzAMg.connect(bzBus.gain); b.srcs.push(bzAM);
  // HP compressor whine (faint)
  const hpw = osc(ac, 'sine', 3000), hpg = gain(ac, 0); chain(hpw, hpg, whineBus); b.srcs.push(hpw);
  // starter air
  const st = noiseSrc(ac, 'pink'), stF = biquad(ac, 'bandpass', 400, 1), stG = gain(ac, 0); chain(st, stF, stG, out.whine); b.srcs.push(st);
  // core roar + bypass whoosh
  const core = noiseSrc(ac, 'brown'), coreF = biquad(ac, 'lowpass', 500, 0.6), coreG = gain(ac, 0); chain(core, coreF, coreG, b.pR);
  const byp = noiseSrc(ac, 'pink'), bypF = biquad(ac, 'bandpass', 900, 0.5), bypF2 = biquad(ac, 'lowpass', 5000, 0.5), bypG = gain(ac, 0); chain(byp, bypF, bypF2, bypG, b.pR);
  const hiss = noiseSrc(ac, 'white'), hissF = biquad(ac, 'highpass', 3800, 0.6), hissF2 = biquad(ac, 'lowpass', 9500, 0.5), hissG = gain(ac, 0); chain(hiss, hissF, hissF2, hissG, b.pR);
  const mod = noiseSrc(ac, 'brown'), modF = biquad(ac, 'lowpass', 6, 0.7), modG = gain(ac, 0); chain(mod, modF, modG); modG.connect(bypG.gain);
  // reverse thrust: huge forward-radiated broadband roar
  const rv = noiseSrc(ac, 'pink'), rvF = biquad(ac, 'bandpass', 700, 0.45), rvF2 = biquad(ac, 'highpass', 150, 0.7), rvG = gain(ac, 0); chain(rv, rvF, rvF2, rvG, b.pV);
  const rv2 = noiseSrc(ac, 'white'), rv2F = biquad(ac, 'bandpass', 2400, 0.6), rv2G = gain(ac, 0); chain(rv2, rv2F, rv2G, b.pV);
  b.srcs.push(st, core, byp, hiss, mod, rv, rv2);

  function update(e, dop = 1, dt = 1 / 60) {
    const n1 = clamp(e.n1, 0, 1.1), n2 = clamp(e.n2, 0, 1.1), thr = sat(e.thr), rev = sat(e.rev);
    const running = e.running;
    mem.comb += ((running ? 1 : 0) - mem.comb) * (1 - Math.exp(-dt / (running ? 0.8 : 0.35)));
    const cb = mem.comb;
    // rate of change of N1 -> spool-up/down character
    mem.dn1 += ((n1 - mem.n1) / Math.max(dt, 1e-3) - mem.dn1) * (1 - Math.exp(-dt / 0.25)); mem.n1 = n1;
    const spoolAct = sat(Math.abs(mem.dn1) * 4);
    const pa = sat(0.06 + 0.94 * Math.pow(thr, 0.9)) * cb + 0.02 * n2 * (1 - cb);
    if (mem.running !== undefined && e.running !== mem.running) thump(ac, b.pR, ac.currentTime + (e.running ? 0.1 : 0), e.running ? 0.18 : 0.08, 1.4);
    mem.running = e.running;
    const f0 = (26 + 62 * n1) * dop;
    const hs = Math.pow(n1, 0.9) * 0.06 * level;
    hum.forEach((v) => { set(v.o.frequency, f0 * v.m, 0.03); set(v.gn.gain, v.g * hs, 0.06); });
    const bs = Math.pow(n1, 2.2) * 0.075 * level * (1 + 0.6 * spoolAct);
    blade.forEach((v) => { set(v.o.frequency, f0 * v.m, 0.03); set(v.gn.gain, v.g * bs, 0.06); });
    // buzz-saw only emerges above ~75% N1
    const bz = Math.pow(smooth(0.68, 1.0, n1), 1.4);
    saws.forEach((s) => set(s.o.frequency, f0 * s.d, 0.03));
    set(bzBus.gain, bz * 0.5 * level, 0.1); set(bzAMg.gain, bz * 0.22 * level, 0.1);
    set(bzBP.frequency, (1300 + 1100 * n1) * dop, 0.1);
    set(hpw.frequency, (2400 + 1500 * n2) * dop, 0.05); set(hpg.gain, 0.012 * Math.pow(n2, 2) * level, 0.06);
    const bump = smooth(0, 0.15, n2) * (1 - smooth(0.3, 0.55, n2));
    set(stF.frequency, (240 + 1800 * n2) * dop, 0.08); set(stG.gain, 0.16 * bump * level, 0.1);
    // roar
    set(coreG.gain, (0.1 * cb + 0.55 * Math.pow(pa, 1.2)) * 0.55 * level, 0.1); set(coreF.frequency, 300 + 800 * pa, 0.1);
    const by = (0.04 * cb + 0.7 * Math.pow(pa, 1.7) + 0.12 * spoolAct * pa) * 0.6 * level;
    set(bypG.gain, by, 0.1); set(modG.gain, by * 1.2, 0.25); set(bypF.frequency, 500 + 1500 * pa, 0.1);
    set(hissG.gain, (0.01 * cb + 0.2 * Math.pow(pa, 2.4)) * 0.5 * level, 0.1);
    // reverse thrust (blast forward: broadband, mid-heavy)
    const rg = rev * (0.15 + 0.85 * pa);
    set(rvG.gain, rg * 1.0 * level, 0.1); set(rv2G.gain, rg * 0.4 * level, 0.1);
    for (const s of b.srcs) if (s.playbackRate) set(s.playbackRate, dop, 0.08);
  }
  return {
    update, kind: 'jet-highbypass',
    dispose() { for (const s of b.srcs) { try { s.stop(); } catch {} } for (const n of [b.pW, b.pR, b.pV, whineBus, bzBus]) { try { n.disconnect(); } catch {} } },
  };
}
