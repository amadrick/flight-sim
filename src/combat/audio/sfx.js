// Combat one-shots and the rotary-cannon voice. Pure Web Audio: works live and in an OfflineAudioContext (harness).
// Every one-shot takes a voice from the pool (capped), schedules at absolute time t into `dest`, and disconnects all of
// its nodes when its last source ends. Functions return the duration in seconds (0 when the pool refused).
import { G, BQ, OSC, noise, driveCurve } from './music/synth.js';

/** Voice pool: caps simultaneous one-shots and tracks node clean-up. */
export function createPool(max = 24) {
  const p = { max, live: 0, peak: 0, refused: 0,
    take() { if (p.live >= p.max) { p.refused++; return false; } p.live++; p.peak = Math.max(p.peak, p.live); return true; },
    done() { p.live = Math.max(0, p.live - 1); } };
  return p;
}
/** Finish a one-shot: stop sources at `end`, disconnect everything when the last one ends. */
function finish(pool, srcs, nodes, end) {
  let n = srcs.length;
  for (const s of srcs) {
    try { s.stop(end + 0.02); } catch {}
    s.onended = () => { if (--n > 0) return; for (const x of srcs) { try { x.disconnect(); } catch {} } for (const x of nodes) { try { x.disconnect(); } catch {} } pool.done(); };
  }
}
const nsrc = (ac, kind, t) => { const s = noise(ac, kind); s.start(t, Math.random() * 2); return s; };
function env(p, t, peak, atk, dec, floor = 0.0001) { p.setValueAtTime(floor, t); p.linearRampToValueAtTime(peak, t + atk); p.exponentialRampToValueAtTime(floor, t + atk + dec); }

// A narrow pulse train as a periodic wave: one "round" per cycle, rich in harmonics.
const waves = new WeakMap();
function pulseWave(ac, heavy) {
  let w = waves.get(ac); if (!w) { w = {}; waves.set(ac, w); }
  const k = heavy ? 'h' : 'l';
  if (!w[k]) {
    const N = 48, re = new Float32Array(N), im = new Float32Array(N);
    for (let i = 1; i < N; i++) { const roll = Math.exp(-i / (heavy ? 14 : 22)); re[i] = roll * (i % 2 ? 1 : 0.8); im[i] = 0.25 * roll * Math.sin(i * 1.7); }
    w[k] = ac.createPeriodicWave(re, im);
  }
  return w[k];
}

/**
 * Rotary cannon voice for one burst. o: { rof (rounds/s at full spin), heavy (30 mm), level, far (distant listener:
 * duller, no whine) }. Returns { setSpin(s, t), stop(t) } or null. The voice is one pool slot.
 */
export function gunVoice(ac, pool, dest, t, o = {}) {
  if (!pool.take()) return null;
  const rof = o.rof || 100, heavy = !!o.heavy, lvl = o.level ?? 1, far = !!o.far;
  const pulse = ac.createOscillator(); pulse.setPeriodicWave(pulseWave(ac, heavy));
  const f0 = rof * (o.spin0 ?? 0.45); pulse.frequency.setValueAtTime(f0, t); pulse.frequency.setTargetAtTime(rof, t, o.spinTc ?? 0.1);
  // punch: the firing-rate fundamental and its first partials (the "brrrt" body, below ~250 Hz)
  const punchF = BQ(ac, 'lowpass', heavy ? 210 : 260, 1.2), punch = G(ac, heavy ? 1.3 : 0.9);
  // body: low-mids
  const bodyF = BQ(ac, 'bandpass', heavy ? 520 : 750, 0.7), body = G(ac, 0.5);
  // bite: noise gated by every round (ring-modulated by the pulse train), high-passed: the crack of each shot
  const nz = nsrc(ac, 'white', t), biteHP = BQ(ac, 'highpass', heavy ? 1500 : 2000, 0.7), biteP = BQ(ac, 'peaking', heavy ? 2800 : 3800, 1, 6), am = G(ac, 0), bite = G(ac, far ? 0.25 : heavy ? 0.9 : 1.1);
  nz.connect(biteHP); biteHP.connect(biteP); biteP.connect(am); pulse.connect(am.gain); am.connect(bite);
  // barrel/drive whine
  const wh = OSC(ac, 'triangle', rof * 6.8), whF = BQ(ac, 'bandpass', rof * 6.8, 4), whG = G(ac, 0);
  wh.frequency.setValueAtTime(f0 * 6.8, t); wh.frequency.setTargetAtTime(rof * 6.8, t, o.spinTc ?? 0.1);
  wh.connect(whF); whF.connect(whG);
  const sum = G(ac, 1), sh = ac.createWaveShaper(); sh.curve = driveCurve(heavy ? 2.6 : 1.8, 0.05);
  const out = G(ac, 0), lp = BQ(ac, 'lowpass', far ? Math.min(o.cutoff || 3000, 6000) : 14000, 0.5), hp = BQ(ac, 'highpass', 30, 0.7);
  pulse.connect(punchF); punchF.connect(punch); punch.connect(sum);
  pulse.connect(bodyF); bodyF.connect(body); body.connect(sum);
  bite.connect(sum); whG.connect(sum);
  sum.connect(sh); sh.connect(lp); lp.connect(hp); hp.connect(out); out.connect(dest);
  out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(0.42 * lvl, t + 0.015);
  if (!far) { whG.gain.setValueAtTime(0, t); whG.gain.linearRampToValueAtTime(0.05, t + 0.05); whG.gain.setTargetAtTime(0.02, t + 0.1, 0.2); }
  pulse.start(t); wh.start(t);
  let stopped = false;
  const srcs = [pulse, nz, wh], nodes = [punchF, punch, bodyF, body, biteHP, biteP, am, bite, whF, whG, sum, sh, out, lp, hp];
  return {
    setSpin(s, tt) { if (!stopped) { const f = rof * Math.max(0.3, s); pulse.frequency.setTargetAtTime(f, tt, 0.05); wh.frequency.setTargetAtTime(f * 6.8, tt, 0.05); } },
    /** release the trigger at tt: the rate falls, the rounds stop, the barrels spin down (whine tail) */
    stop(tt) {
      if (stopped) return; stopped = true;
      pulse.frequency.cancelScheduledValues(tt); pulse.frequency.setTargetAtTime(rof * 0.35, tt, 0.08);
      out.gain.cancelScheduledValues(tt); out.gain.setTargetAtTime(0, tt + 0.025, 0.035);
      if (!far) { wh.frequency.cancelScheduledValues(tt); wh.frequency.setTargetAtTime(rof * 1.2, tt, 0.35); whG.gain.cancelScheduledValues(tt); whG.gain.setValueAtTime(0.03, tt); whG.gain.setTargetAtTime(0, tt + 0.2, 0.25); }
      // the spin-down whine continues after the rounds stop: route it around the closed gate
      const tail = G(ac, 1); whG.connect(tail); tail.connect(dest); nodes.push(tail);
      finish(pool, srcs, nodes, tt + (far ? 0.3 : 1.3));
    },
  };
}
/** Report of the trigger release: a short low "boom" decay so the burst ends with weight (one-shot). */
export function gunTail(ac, pool, dest, t, s = 1, heavy = false) {
  if (!pool.take()) return 0;
  const b = nsrc(ac, 'brown', t), f = BQ(ac, 'lowpass', heavy ? 260 : 340, 0.7), g = G(ac, 0);
  b.connect(f); f.connect(g); g.connect(dest);
  env(g.gain, t, 0.5 * s, 0.01, heavy ? 0.9 : 0.6);
  finish(pool, [b], [f, g], t + 1.0);
  return 1;
}

/** Missile launch: rail release clunk, ignition, motor roar receding (rumble, hiss, crackle), filter sweeping down. */
export function missileLaunch(ac, pool, dest, t, o = {}) {
  if (!pool.take()) return 0;
  const s = o.level ?? 1, dur = o.dur ?? 3.8, near = o.near !== false;
  const srcs = [], nodes = [];
  const out = G(ac, s), lp = BQ(ac, 'lowpass', near ? 12000 : (o.cutoff || 3000), 0.5); lp.connect(out); out.connect(dest); nodes.push(out, lp);
  if (near) {   // clunk: latch release + body thump
    const c = nsrc(ac, 'brown', t), cf = BQ(ac, 'lowpass', 500, 1), cg = G(ac, 0); c.connect(cf); cf.connect(cg); cg.connect(lp); env(cg.gain, t, 1.0, 0.002, 0.14);
    const k = nsrc(ac, 'white', t), kf = BQ(ac, 'bandpass', 1500, 6), kg = G(ac, 0); k.connect(kf); kf.connect(kg); kg.connect(lp); env(kg.gain, t, 0.5, 0.001, 0.08);
    srcs.push(c, k); nodes.push(cf, cg, kf, kg);
  }
  const ti = t + (near ? 0.12 : 0);
  // motor: rumble + roar + hiss
  const r = nsrc(ac, 'brown', ti), rf = BQ(ac, 'lowpass', 300, 0.8), rg = G(ac, 0);
  const m = nsrc(ac, 'pink', ti), mf = BQ(ac, 'bandpass', 900, 0.6), mg = G(ac, 0);
  const h = nsrc(ac, 'white', ti), hf = BQ(ac, 'highpass', 2600, 0.7), hg = G(ac, 0);
  r.connect(rf); rf.connect(rg); rg.connect(lp); m.connect(mf); mf.connect(mg); mg.connect(lp); h.connect(hf); hf.connect(hg); hg.connect(lp);
  srcs.push(r, m, h); nodes.push(rf, rg, mf, mg, hf, hg);
  // ignition whump
  const w = OSC(ac, 'sine', 120), wg = G(ac, 0); w.frequency.setValueAtTime(140, ti); w.frequency.exponentialRampToValueAtTime(40, ti + 0.3); w.connect(wg); wg.connect(lp); env(wg.gain, ti, 0.9, 0.004, 0.35); w.start(ti); srcs.push(w); nodes.push(wg);
  // receding: level ~ 1/(1+(t/0.7)^1.6), air absorption and a Doppler drop in the band
  const pts = 14;
  for (const [g, pk] of [[rg, 0.9], [mg, 1.1], [hg, 0.55]]) {
    g.gain.setValueAtTime(0.0001, ti); g.gain.linearRampToValueAtTime(pk, ti + 0.06);
    for (let i = 1; i <= pts; i++) { const tt = (i / pts) * dur; g.gain.linearRampToValueAtTime(pk / (1 + Math.pow(tt / 0.7, 1.6)), ti + 0.06 + tt); }
    g.gain.linearRampToValueAtTime(0.0001, ti + dur + 0.2);
  }
  if (near) { lp.frequency.setValueAtTime(12000, ti); lp.frequency.exponentialRampToValueAtTime(1600, ti + dur); }
  mf.frequency.setValueAtTime(1000, ti); mf.frequency.exponentialRampToValueAtTime(620, ti + 1.5);
  finish(pool, srcs, nodes, ti + dur + 0.25);
  return dur + 0.3;
}

/** Flare: cartridge pop + burning hiss. */
export function flare(ac, pool, dest, t, s = 1) {
  if (!pool.take()) return 0;
  const p = nsrc(ac, 'white', t), pf = BQ(ac, 'highpass', 1200, 0.7), pg = G(ac, 0); p.connect(pf); pf.connect(pg); pg.connect(dest); env(pg.gain, t, 0.7 * s, 0.001, 0.025);
  const o = OSC(ac, 'sine', 200), og = G(ac, 0); o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.06); o.connect(og); og.connect(dest); env(og.gain, t, 0.5 * s, 0.001, 0.07); o.start(t);
  const h = nsrc(ac, 'white', t + 0.02), hf = BQ(ac, 'bandpass', 3800, 0.8), hl = BQ(ac, 'lowpass', 9000, 0.5), hg = G(ac, 0); h.connect(hf); hf.connect(hl); hl.connect(hg); hg.connect(dest);
  env(hg.gain, t + 0.02, 0.22 * s, 0.03, 1.5); hl.frequency.setValueAtTime(9000, t); hl.frequency.exponentialRampToValueAtTime(2500, t + 1.6);
  finish(pool, [p, o, h], [pf, pg, og, hf, hl, hg], t + 1.7);
  return 1.7;
}

/** Rounds striking the player's airframe: metallic rings + thud + crack, scaled by s (0..1.5). */
export function airframeHit(ac, pool, dest, t, s = 1, rnd = Math.random) {
  if (!pool.take()) return 0;
  const srcs = [], nodes = [];
  const n = 1 + Math.min(2, Math.floor(s * 2));
  for (let i = 0; i < n; i++) {
    const tt = t + i * (0.012 + 0.03 * rnd());
    const z = nsrc(ac, 'white', tt), f = BQ(ac, 'bandpass', 1700 + 2600 * rnd(), 7 + 8 * rnd()), g = G(ac, 0);
    z.connect(f); f.connect(g); g.connect(dest); env(g.gain, tt, (1.6 + rnd()) * s, 0.0008, 0.12 + 0.18 * rnd());
    srcs.push(z); nodes.push(f, g);
  }
  const b = nsrc(ac, 'brown', t), bf = BQ(ac, 'lowpass', 260, 0.9), bg = G(ac, 0); b.connect(bf); bf.connect(bg); bg.connect(dest); env(bg.gain, t, 1.1 * s, 0.002, 0.11);
  const c = nsrc(ac, 'white', t), cf = BQ(ac, 'highpass', 3000, 0.7), cg = G(ac, 0); c.connect(cf); cf.connect(cg); cg.connect(dest); env(cg.gain, t, 0.6 * s, 0.0005, 0.006);
  srcs.push(b, c); nodes.push(bf, bg, cf, cg);
  finish(pool, srcs, nodes, t + 0.45);
  return 0.45;
}

/** The player's rounds connect: a dry, subtle confirmation tick. */
export function hitTick(ac, pool, dest, t, s = 1) {
  if (!pool.take()) return 0;
  const z = nsrc(ac, 'white', t), f = BQ(ac, 'bandpass', 4200, 2.5), g = G(ac, 0); z.connect(f); f.connect(g); g.connect(dest); env(g.gain, t, 0.5 * s, 0.0005, 0.012);
  const o = OSC(ac, 'square', 2650), of = BQ(ac, 'lowpass', 5000, 0.5), og = G(ac, 0); o.connect(of); of.connect(og); og.connect(dest); env(og.gain, t, 0.07 * s, 0.0005, 0.018); o.start(t);
  finish(pool, [z, o], [f, g, of, og], t + 0.05);
  return 0.05;
}

/** Supersonic round passing close: an N-wave crack plus a short falling whizz. */
export function nearMiss(ac, pool, dest, t, s = 1, rnd = Math.random) {
  if (!pool.take()) return 0;
  const c = nsrc(ac, 'white', t), cf = BQ(ac, 'highpass', 1800, 0.7), cg = G(ac, 0); c.connect(cf); cf.connect(cg); cg.connect(dest); env(cg.gain, t, 1.1 * s, 0.0004, 0.007);
  const w = nsrc(ac, 'white', t), wf = BQ(ac, 'bandpass', 3200, 5), wg = G(ac, 0); w.connect(wf); wf.connect(wg); wg.connect(dest);
  const f0 = 2600 + 1400 * rnd(); wf.frequency.setValueAtTime(f0, t); wf.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + 0.14); env(wg.gain, t + 0.003, 0.5 * s, 0.01, 0.13);
  finish(pool, [c, w], [cf, cg, wf, wg], t + 0.2);
  return 0.2;
}

/**
 * Explosion. o: { size (1 = cannon kill, 1.6 = missile kill), ground (wreck impact: deeper, longer), cutoff (air absorption
 * at distance, Hz) }. Initial crack, body sweep, sub thump, crackling debris tail.
 */
export function explosion(ac, pool, dest, t, o = {}) {
  if (!pool.take()) return 0;
  const s = o.size ?? 1, ground = !!o.ground, cut = o.cutoff ?? 15000, dur = ground ? 5.5 : 3.5 + s;
  const srcs = [], nodes = [];
  const out = G(ac, 1), air = BQ(ac, 'lowpass', cut, 0.5); air.connect(out); out.connect(dest); nodes.push(out, air);
  // crack
  const c = nsrc(ac, 'white', t), cf = BQ(ac, 'highpass', 900, 0.7), cg = G(ac, 0); c.connect(cf); cf.connect(cg); cg.connect(air); env(cg.gain, t, 1.2 * s, 0.002, 0.09);
  // body: brown noise with a falling low-pass
  const b = nsrc(ac, 'brown', t), bf = BQ(ac, 'lowpass', 2800, 0.7), bg = G(ac, 0); b.connect(bf); bf.connect(bg); bg.connect(air);
  bf.frequency.setValueAtTime(3200, t); bf.frequency.exponentialRampToValueAtTime(ground ? 90 : 130, t + 1.4 * s);
  env(bg.gain, t, 2.2 * s, 0.004, (ground ? 2.6 : 1.6) * s);
  // sub thump
  const o1 = OSC(ac, 'sine', 80), og = G(ac, 0); o1.frequency.setValueAtTime(ground ? 70 : 90, t); o1.frequency.exponentialRampToValueAtTime(24, t + 0.9); o1.connect(og); og.connect(air); env(og.gain, t, (ground ? 1.4 : 1.0) * s, 0.005, ground ? 1.4 : 0.9); o1.start(t);
  // debris crackle: band-limited noise through a threshold shaper (sparse pulses), decaying
  const d = nsrc(ac, 'white', t + 0.08), df = BQ(ac, 'bandpass', 1400, 0.9), dpre = G(ac, 6), ds = ac.createWaveShaper(), dg = G(ac, 0);
  const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1, a = Math.max(0, Math.abs(x) - 0.55) / 0.45; curve[i] = Math.sign(x) * Math.min(1, a * 1.5); } ds.curve = curve;
  d.connect(df); df.connect(dpre); dpre.connect(ds); ds.connect(dg); dg.connect(air);
  dg.gain.setValueAtTime(0.0001, t + 0.08); dg.gain.linearRampToValueAtTime(0.5 * s, t + 0.2); dg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  // rolling rumble tail
  const r = nsrc(ac, 'brown', t + 0.1), rf = BQ(ac, 'lowpass', 160, 0.7), rg = G(ac, 0); r.connect(rf); rf.connect(rg); rg.connect(air);
  rg.gain.setValueAtTime(0.0001, t + 0.1); rg.gain.linearRampToValueAtTime(0.9 * s, t + 0.35); rg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  srcs.push(c, b, o1, d, r); nodes.push(cf, cg, bf, bg, og, df, dpre, ds, dg, rf, rg);
  finish(pool, srcs, nodes, t + dur + 0.1);
  return dur;
}

/**
 * Fly-by: an aircraft (or missile) passes the camera. o: { tca (s until closest approach), dopIn, dopOut (Doppler
 * ratios approaching/receding), level, missile }. A swelling roar whose band slides down through the pass.
 */
export function flyby(ac, pool, dest, t, o = {}) {
  if (!pool.take()) return 0;
  const tca = Math.max(0.05, o.tca ?? 0.4), lv = o.level ?? 1, mis = !!o.missile, after = mis ? 0.7 : 1.6;
  const fC = mis ? 3000 : 1100, end = t + tca + after;
  const p = nsrc(ac, mis ? 'white' : 'pink', t), bp = BQ(ac, 'bandpass', fC, mis ? 1.2 : 0.7), pg = G(ac, 0);
  p.connect(bp); bp.connect(pg); pg.connect(dest);
  bp.frequency.setValueAtTime(fC * (o.dopIn ?? 1.4), t); bp.frequency.setValueAtTime(fC * (o.dopIn ?? 1.4), t + tca * 0.8); bp.frequency.exponentialRampToValueAtTime(fC * (o.dopOut ?? 0.7), t + tca + 0.15);
  pg.gain.setValueAtTime(0.0001, t); pg.gain.exponentialRampToValueAtTime(0.9 * lv, t + tca); pg.gain.exponentialRampToValueAtTime(0.0001, end);
  const srcs = [p], nodes = [bp, pg];
  if (!mis) {
    const r = nsrc(ac, 'brown', t), rf = BQ(ac, 'lowpass', 280, 0.9), rg = G(ac, 0); r.connect(rf); rf.connect(rg); rg.connect(dest);
    rg.gain.setValueAtTime(0.0001, t); rg.gain.exponentialRampToValueAtTime(1.3 * lv, t + tca + 0.05); rg.gain.exponentialRampToValueAtTime(0.0001, end + 0.4);
    srcs.push(r); nodes.push(rf, rg);
  }
  finish(pool, srcs, nodes, end + 0.45);
  return end + 0.45 - t;
}
