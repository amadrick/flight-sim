// Aerodynamic, ground, mechanical, weather, cabin and ambient continuous layers.
import { gain, biquad, osc, noiseSrc, chain, set, sat, clamp, smooth, pulseCurve } from './dsp.js';

const bandPulse = (ac, f, q, thr = 0.3) => {      // sparse random pulses from band-limited noise (0..1 output)
  const sd = 0.3 * Math.sqrt((f / q * 1.57) / (ac.sampleRate / 2));
  const n = noiseSrc(ac, 'white'), bp = biquad(ac, 'bandpass', f, q), pre = gain(ac, 0.3 / sd), ws = ac.createWaveShaper(); ws.curve = pulseCurve(thr);
  const lvl = gain(ac, 0); chain(n, bp, pre, ws, lvl); return { out: lvl, src: n };
};

/** Airframe aero noise: wind rush, transonic rumble, buffet, configuration roar. Output -> aeroOut */
export function createAeroLayer(ac, aeroOut) {
  const srcs = [];
  const wind = noiseSrc(ac, 'pink'), windF = biquad(ac, 'bandpass', 800, 0.45), windG = gain(ac, 0); chain(wind, windF, windG, aeroOut);
  const hiss = noiseSrc(ac, 'white'), hissF = biquad(ac, 'highpass', 3200, 0.6), hissG = gain(ac, 0); chain(hiss, hissF, hissG, aeroOut);
  const trans = noiseSrc(ac, 'brown'), transF = biquad(ac, 'bandpass', 110, 0.9), transG = gain(ac, 0); chain(trans, transF, transG, aeroOut);
  const buf = noiseSrc(ac, 'brown'), bufF = biquad(ac, 'lowpass', 150, 0.8), bufG = gain(ac, 0); chain(buf, bufF, bufG, aeroOut);
  const buf2 = noiseSrc(ac, 'pink'), buf2F = biquad(ac, 'bandpass', 260, 1.1), buf2G = gain(ac, 0); chain(buf2, buf2F, buf2G, aeroOut);
  const lfo = osc(ac, 'sine', 9.5), lfoG = gain(ac, 0); chain(lfo, lfoG); lfoG.connect(buf2G.gain);          // shuddering at ~10 Hz
  const cfg = noiseSrc(ac, 'pink'), cfgF = biquad(ac, 'bandpass', 520, 0.5), cfgF2 = biquad(ac, 'highpass', 200, 0.7), cfgG = gain(ac, 0); chain(cfg, cfgF, cfgF2, cfgG, aeroOut);
  srcs.push(wind, hiss, trans, buf, buf2, lfo, cfg);
  return {
    srcs,
    update(a) {   // a: { v (IAS m/s), mach, buffet 0..1, gearOut, flapsOut, brakeOut }
      const vn = sat(a.v / 260);
      set(windG.gain, 0.5 * Math.pow(vn, 1.7), 0.1); set(windF.frequency, 450 + 1500 * vn, 0.15);
      set(hissG.gain, 0.22 * Math.pow(vn, 2.4) * (1 + 0.5 * smooth(0.7, 1.2, a.mach)), 0.1);
      const tr = Math.exp(-Math.pow((a.mach - 1.0) / 0.16, 2)) * 0.65 + 0.2 * smooth(0.8, 1.3, a.mach);
      set(transG.gain, tr * 1.1, 0.12);
      const bu = sat(a.buffet) * sat(a.v / 40);
      set(bufG.gain, bu * 0.9, 0.08); set(buf2G.gain, bu * 0.35, 0.08); set(lfoG.gain, bu * 0.35, 0.08);
      set(lfo.frequency, 7 + 6 * bu, 0.2);
      const cf = (0.5 * a.gearOut + 0.6 * a.flapsOut + 0.9 * a.brakeOut) * Math.pow(sat(a.v / 140), 2);
      set(cfgG.gain, 0.55 * cf, 0.12); set(cfgF.frequency, 380 + 5 * a.v, 0.2);
    },
  };
}

/** Ground + mechanical layers. Output -> mechOut */
export function createMechLayer(ac, mechOut) {
  const srcs = [];
  const rum = noiseSrc(ac, 'brown'), rumF = biquad(ac, 'lowpass', 140, 0.8), rumG = gain(ac, 0); chain(rum, rumF, rumG, mechOut);
  const rum2 = noiseSrc(ac, 'pink'), rum2F = biquad(ac, 'bandpass', 240, 0.9), rum2G = gain(ac, 0); chain(rum2, rum2F, rum2G, mechOut);
  const rumP = bandPulse(ac, 13, 1.2, 0.2); rumP.out.connect(rum2G.gain);
  const rolling = noiseSrc(ac, 'pink'), rollF = biquad(ac, 'bandpass', 1100, 0.6), rollG = gain(ac, 0); chain(rolling, rollF, rollG, mechOut);   // tyre hiss on tarmac
  const sk = noiseSrc(ac, 'white'), skF = biquad(ac, 'bandpass', 1500, 5), skG = gain(ac, 0); chain(sk, skF, skG, mechOut);
  const skO = osc(ac, 'sawtooth', 900), skOF = biquad(ac, 'bandpass', 1300, 6), skOG = gain(ac, 0); chain(skO, skOF, skOG, mechOut);
  const skLfo = osc(ac, 'sine', 11), skLfoG = gain(ac, 0); chain(skLfo, skLfoG); skLfoG.connect(skOG.gain);
  const br = osc(ac, 'square', 2100), brF = biquad(ac, 'bandpass', 2100, 14), brG = gain(ac, 0); chain(br, brF, brG, mechOut);
  const br2 = osc(ac, 'sawtooth', 3150), br2F = biquad(ac, 'bandpass', 3150, 20), br2G = gain(ac, 0); chain(br2, br2F, br2G, mechOut);
  const mk = (f, bp, q) => {
    const o = osc(ac, 'sawtooth', f), o2 = osc(ac, 'square', f * 2.003), f1 = biquad(ac, 'bandpass', bp, q), g = gain(ac, 0), n = noiseSrc(ac, 'pink'), nf = biquad(ac, 'bandpass', bp * 0.7, 0.8), ng = gain(ac, 0.35);
    chain(o, f1); chain(o2, gain(ac, 0.3), f1); chain(f1, g, mechOut); chain(n, nf, ng, g); srcs.push(o, o2, n); return { o, o2, f1, g, f };
  };
  const gearM = mk(150, 520, 2.2), flapM = mk(230, 750, 2.8), sbM = mk(110, 380, 1.6);
  srcs.push(rum, rum2, rumP.src, rolling, sk, skO, skLfo, br, br2);
  return {
    srcs, gearM, flapM, sbM,
    update(m) { // m: { gs, rough, skid, brake, gearRate, flapRate, sbRate, onGround }
      const gsn = sat(m.gs / 80);
      const og = m.onGround ? 1 : 0;
      set(rumG.gain, og * (0.25 + 0.5 * m.rough) * Math.pow(gsn, 0.8) * 0.9, 0.12);
      set(rum2G.gain, og * m.rough * Math.pow(gsn, 0.7) * 0.5, 0.12); set(rumP.out.gain, og * (0.3 + 0.7 * gsn), 0.12);
      set(rollG.gain, og * 0.22 * Math.pow(gsn, 1.2) * (1 - 0.5 * m.rough), 0.12); set(rollF.frequency, 700 + 900 * gsn, 0.2);
      const skid = sat(m.skid);
      set(skG.gain, skid * 0.5 * og, 0.04); set(skOG.gain, skid * 0.14 * og, 0.04); set(skLfoG.gain, skid * 0.1, 0.04); set(skO.frequency, 850 + 400 * gsn, 0.05);
      const bq = sat(m.brake) * smooth(3, 25, m.gs) * (1 - smooth(60, 90, m.gs)) * og;       // squeal in the mid speed range only
      set(brG.gain, bq * 0.045, 0.06); set(br2G.gain, bq * 0.018, 0.06); set(br.frequency, 1900 + 600 * (1 - smooth(3, 40, m.gs)), 0.08);
      const mot = (v, rate, base, gmax) => { const r = sat(rate); set(v.g.gain, gmax * r, 0.05); set(v.o.frequency, base * (0.85 + 0.35 * r), 0.1); set(v.o2.frequency, base * 2.003 * (0.85 + 0.35 * r), 0.1); };
      mot(gearM, m.gearRate * 4, 150, 0.1); mot(flapM, m.flapRate * 6, 230, 0.07); mot(sbM, m.sbRate * 5, 110, 0.08);
    },
  };
}

/** Weather: rain on the canopy/airframe and ambient wind. Rain -> rainOut, ambience -> ambOut */
export function createWeatherLayer(ac, rainOut, ambOut) {
  const bed = noiseSrc(ac, 'white'), bedF = biquad(ac, 'highpass', 1800, 0.6), bedF2 = biquad(ac, 'bandpass', 4200, 0.4), bedG = gain(ac, 0); chain(bed, bedF, bedF2, bedG, rainOut);
  const p1 = bandPulse(ac, 55, 0.7, 0.28), p2 = bandPulse(ac, 38, 0.8, 0.3);
  const d1 = noiseSrc(ac, 'white'), d1f = biquad(ac, 'bandpass', 2600, 1.4), d1g = gain(ac, 0); chain(d1, d1f, d1g, rainOut); p1.out.connect(d1g.gain);     // droplet ticks
  const d2 = noiseSrc(ac, 'pink'), d2f = biquad(ac, 'bandpass', 900, 1.8), d2g = gain(ac, 0); chain(d2, d2f, d2g, rainOut); p2.out.connect(d2g.gain);       // fat drops thudding the canopy
  const w = noiseSrc(ac, 'pink'), wf = biquad(ac, 'lowpass', 650, 0.6), wg = gain(ac, 0); chain(w, wf, wg, ambOut);
  const gust = noiseSrc(ac, 'brown'), gustF = biquad(ac, 'lowpass', 0.6, 0.7), gustG = gain(ac, 0); chain(gust, gustF, gustG); gustG.connect(wg.gain);
  const w2 = noiseSrc(ac, 'pink'), w2f = biquad(ac, 'bandpass', 1900, 0.9), w2g = gain(ac, 0); chain(w2, w2f, w2g, ambOut);
  const hum = osc(ac, 'sine', 50), hum2 = osc(ac, 'sine', 100.2), humG = gain(ac, 0); chain(hum, humG); chain(hum2, humG); humG.connect(ambOut);
  const far = noiseSrc(ac, 'brown'), farF = biquad(ac, 'bandpass', 70, 0.8), farG = gain(ac, 0); chain(far, farF, farG, ambOut);
  return {
    srcs: [bed, p1.src, p2.src, d1, d2, w, gust, w2, hum, hum2, far],
    update(x) { // x: { precip, wind, speed }
      const r = sat(x.precip), sp = sat(x.speed / 150);
      set(bedG.gain, 0.2 * Math.pow(r, 1.1) * (1 + 0.6 * sp), 0.3);
      set(p1.out.gain, 0.5 * r * (0.5 + 0.5 * sp), 0.3); set(d1g.gain, 0.5 * Math.pow(r, 0.8), 0.3);
      set(p2.out.gain, 0.8 * r * r, 0.3); set(d2g.gain, 0.55 * Math.pow(r, 1.0), 0.3);
      const ws = sat(x.wind / 18);
      set(wg.gain, 0.03 + 0.4 * Math.pow(ws, 1.3), 0.5); set(gustG.gain, 0.04 + 0.5 * ws, 0.5); set(wf.frequency, 350 + 700 * ws, 0.5);
      set(w2g.gain, 0.015 * ws + 0.12 * Math.pow(ws, 2.5), 0.5);
      set(humG.gain, 0.012, 1); set(farG.gain, 0.05, 1);
    },
  };
}

/** Interior bed: ECS/airflow hiss and avionics/air-conditioning hum. Output -> cabinOut */
export function createCabinLayer(ac, cabinOut, airliner) {
  const hiss = noiseSrc(ac, 'white'), hissF = biquad(ac, 'bandpass', airliner ? 3600 : 4200, 0.5), hissG = gain(ac, 0); chain(hiss, hissF, hissG, cabinOut);
  const ac1 = noiseSrc(ac, 'pink'), ac1f = biquad(ac, 'lowpass', airliner ? 1400 : 700, 0.6), ac1g = gain(ac, 0); chain(ac1, ac1f, ac1g, cabinOut);
  const h1 = osc(ac, 'sine', airliner ? 118 : 400), h2 = osc(ac, 'sine', airliner ? 236.4 : 800.5), h3 = osc(ac, 'triangle', airliner ? 60 : 1200), hg = gain(ac, 0);
  chain(h1, hg); const g2 = gain(ac, 0.5); chain(h2, g2, hg); chain(h3, gain(ac, 0.2), hg); hg.connect(cabinOut);
  return {
    srcs: [hiss, ac1, h1, h2, h3],
    update(c) { // c: { power 0..1 (systems alive), v }
      const vs = sat(c.v / 200);
      set(hissG.gain, c.power * (airliner ? 0.07 : 0.1) * (0.6 + 0.6 * vs), 0.3);
      set(ac1g.gain, c.power * (airliner ? 0.22 : 0.1), 0.3);
      set(hg.gain, c.power * (airliner ? 0.012 : 0.006), 0.3);
    },
  };
}
